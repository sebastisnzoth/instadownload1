import express from "express";
import path from "path";
import { ZipArchive } from "archiver";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";

const INSTAGRAM_REGEX =
  /https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/([a-zA-Z0-9_-]+)/i;

function parseInstagramUrl(url: string) {
  const match = String(url).trim().match(INSTAGRAM_REGEX);
  if (!match) return null;
  const rawKind = match[1].toLowerCase();
  const kind = rawKind === "reels" ? "reel" : rawKind;
  const shortcode = match[2];
  const segment = kind === "stories" ? "p" : kind;
  return {
    original: String(url).trim(),
    shortcode,
    kind,
    canonicalUrl: `https://www.instagram.com/${segment}/${shortcode}/`,
    thumbnailUrl: `https://www.instagram.com/${segment}/${shortcode}/media/?size=l`,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Descarga real de medios públicos
// Solo contenido público, sin login ni evasión de controles: se pide el medio
// como lo haría un navegador y se transmite al cliente. Si Instagram exige
// login o bloquea al servidor, se informa con un error claro (502).
// ---------------------------------------------------------------------------
const IG_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_SINGLE_BYTES = 100 * 1024 * 1024; // 100 MB por archivo suelto
const MAX_ZIP_ITEM_BYTES = 30 * 1024 * 1024; // 30 MB por ítem dentro del ZIP

class MediaError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function fetchWithTimeout(url: string, ms = 12000, accept = "*/*"): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": IG_USER_AGENT,
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.instagram.com/",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeEscapedUrl(raw: string): string {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }
}

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].replace(/&amp;/g, "&");
  }
  return null;
}

/** Extrae URLs directas de medio desde el HTML público (embed / página). */
function extractDirectMedia(html: string, preferVideo: boolean): string[] {
  const found: string[] = [];
  const push = (u: string | null) => {
    if (u && /^https?:\/\//i.test(u) && !found.includes(u)) found.push(u);
  };
  const videoJson = html.match(/"video_url"\s*:\s*"([^"]+)"/);
  const displayJson = html.match(/"display_url"\s*:\s*"([^"]+)"/);
  const videoTag = html.match(/<video[^>]+src=["']([^"']+)["']/i);
  const ogVideo = metaContent(html, "og:video:secure_url") || metaContent(html, "og:video");
  const ogImage = metaContent(html, "og:image");
  if (preferVideo) {
    if (videoJson) push(decodeEscapedUrl(videoJson[1]));
    push(ogVideo);
    if (videoTag) push(videoTag[1]);
    if (displayJson) push(decodeEscapedUrl(displayJson[1]));
    push(ogImage);
  } else {
    if (displayJson) push(decodeEscapedUrl(displayJson[1]));
    push(ogImage);
    if (videoJson) push(decodeEscapedUrl(videoJson[1]));
    push(ogVideo);
  }
  return found;
}

function extensionFor(contentType: string, url = ""): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  if (byType[type]) return byType[type];
  const fromUrl = url.split("?")[0].match(/\.([a-z0-9]{3,4})$/i);
  return fromUrl ? fromUrl[1].toLowerCase() : "jpg";
}

interface ResolvedMedia {
  response: Response;
  contentType: string;
  extension: string;
  sourceUrl: string;
}

async function fetchDirectMedia(mediaUrl: string): Promise<ResolvedMedia> {
  const response = await fetchWithTimeout(mediaUrl, 20000);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !/^(image|video)\//i.test(contentType)) {
    throw new MediaError(`El CDN devolvió ${response.status || "una respuesta no válida"}.`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_SINGLE_BYTES) throw new MediaError("El archivo supera el límite de 100 MB.", 413);
  return { response, contentType, extension: extensionFor(contentType, mediaUrl), sourceUrl: mediaUrl };
}

/** Resuelve el medio descargable de una publicación pública. */
async function resolveMedia(parsed: NonNullable<ReturnType<typeof parseInstagramUrl>>): Promise<ResolvedMedia> {
  const preferVideo = parsed.kind === "reel" || parsed.kind === "tv";
  const errors: string[] = [];

  // Intento 1 (reels primero por embed para obtener el video, no solo la tapa)
  // e intento principal para fotos: endpoint /media/?size=l
  const tryMediaEndpoint = async (): Promise<ResolvedMedia> => {
    const response = await fetchWithTimeout(
      `https://www.instagram.com/${parsed.kind === "stories" ? "p" : parsed.kind}/${parsed.shortcode}/media/?size=l`,
      12000,
      "image/*,video/*"
    );
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && /^(image|video)\//i.test(contentType)) {
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_SINGLE_BYTES) throw new MediaError("El archivo supera el límite de 100 MB.", 413);
      return { response, contentType, extension: extensionFor(contentType), sourceUrl: parsed.canonicalUrl };
    }
    if (response.status === 404) throw new MediaError("La publicación no existe o fue eliminada.", 404);
    if (/text\/html/i.test(contentType)) {
      const candidates = extractDirectMedia(await response.text(), preferVideo);
      if (candidates[0]) return fetchDirectMedia(candidates[0]);
    }
    throw new MediaError(`Instagram respondió ${response.status} en /media/.`);
  };

  const tryEmbed = async (): Promise<ResolvedMedia> => {
    const segment = parsed.kind === "stories" ? "p" : parsed.kind;
    const response = await fetchWithTimeout(
      `https://www.instagram.com/${segment}/${parsed.shortcode}/embed/captioned/`,
      12000,
      "text/html"
    );
    if (response.status === 404) throw new MediaError("La publicación no existe o fue eliminada.", 404);
    if (!response.ok) throw new MediaError(`Instagram respondió ${response.status} en el embed.`);
    const candidates = extractDirectMedia(await response.text(), preferVideo);
    if (!candidates[0]) throw new MediaError("No se encontró medio público en la publicación (puede ser privada o de un carrusel).");
    return fetchDirectMedia(candidates[0]);
  };

  const attempts = preferVideo ? [tryEmbed, tryMediaEndpoint] : [tryMediaEndpoint, tryEmbed];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof MediaError && error.status === 404) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.warn(`[media] ${parsed.canonicalUrl}: ${errors.join(" | ")}`);
  throw new MediaError(
    "Instagram bloqueó la descarga desde el servidor (suele pedir login para esta publicación). Probá más tarde, con otra publicación pública, o abrila en Instagram."
  );
}

// ---------------------------------------------------------------------------
// Buscador por usuario (perfil público)
// Lee solo los metadatos públicos que Instagram expone sin sesión. Si sirve
// su pared de login, devolvemos el perfil como "bloqueado" con lo básico,
// en vez de un error opaco. Cache breve en memoria para no martillar.
// ---------------------------------------------------------------------------
const USERNAME_REGEX = /^[A-Za-z0-9._]{1,30}$/;
interface CachedUser { at: number; body: unknown }
const userCache = new Map<string, CachedUser>();
const USER_CACHE_MS = 5 * 60 * 1000;

function parseCount(text: string): number | null {
  const match = text.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function jsonStringField(html: string, field: string): string | null {
  const match = html.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  return match ? decodeEscapedUrl(match[1]) : null;
}

function jsonBoolField(html: string, field: string): boolean | null {
  const match = html.match(new RegExp(`"${field}"\\s*:\\s*(true|false)`));
  return match ? match[1] === "true" : null;
}

interface UserPost { shortcode: string; url: string; thumbnailUrl: string; isVideo: boolean; likes: number | null; takenAt: number | null }

function extractTimelinePosts(html: string, username: string): UserPost[] {
  const posts: UserPost[] = [];
  const seen = new Set<string>();
  const push = (shortcode: string, isVideo = false, likes: number | null = null, takenAt: number | null = null) => {
    if (!shortcode || seen.has(shortcode) || posts.length >= 12) return;
    seen.add(shortcode);
    posts.push({
      shortcode,
      url: `https://www.instagram.com/p/${shortcode}/`,
      thumbnailUrl: `https://www.instagram.com/p/${shortcode}/media/?size=m`,
      isVideo,
      likes,
      takenAt,
    });
  };

  // Camino estructurado: nodos del timeline embebidos en el HTML
  const timelineAt = html.indexOf("edge_owner_to_timeline_media");
  if (timelineAt >= 0) {
    const slice = html.slice(timelineAt, timelineAt + 400_000);
    const nodeRegex = /"shortcode"\s*:\s*"([A-Za-z0-9_-]+)"[^}]*?"is_video"\s*:\s*(true|false)/g;
    let m: RegExpExecArray | null;
    while ((m = nodeRegex.exec(slice)) !== null) push(m[1], m[2] === "true");
  }
  // Respaldo: campos shortcode sueltos del HTML del perfil
  if (posts.length === 0) {
    const looseRegex = /"shortcode"\s*:\s*"([A-Za-z0-9_-]{6,})"/g;
    let m: RegExpExecArray | null;
    while ((m = looseRegex.exec(html)) !== null) push(m[1]);
  }
  return posts;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Deny cross-origin API use except explicitly authorized web clients.
  const allowedOrigins = new Set([
    "https://sebastisnzoth.github.io",
    ...((process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)),
  ]);
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) return res.status(403).json({ error: "Origen no autorizado." });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // Light per-IP rate limiting, appropriate for a single-process server.
  const requestCounters = new Map<string, { count: number; reset: number }>();
  app.use("/api", (req, res, next) => {
    if (req.path === "/health") return next();
    const now = Date.now();
    const key = req.ip ?? "unknown";
    const saved = requestCounters.get(key);
    const item = saved && saved.reset > now ? saved : { count: 0, reset: now + 60_000 };
    item.count++;
    requestCounters.set(key, item);
    if (requestCounters.size > 10000) {
      for (const [ip, value] of requestCounters) if (value.reset < now) requestCounters.delete(ip);
    }
    if (item.count > 60) {
      res.setHeader("Retry-After", String(Math.ceil((item.reset - now) / 1000)));
      return res.status(429).json({ error: "Demasiadas solicitudes. Reintentá en un minuto." });
    }
    next();
  });

  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "instatool-suite", timestamp: new Date().toISOString() });
  });

  // --- Descarga por lote de enlaces -------------------------------------
  app.post("/api/download", async (req, res) => {
    const { urls, startDate, endDate } = req.body ?? {};
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Se requiere un arreglo de URLs con al menos un enlace." });
    }
    if (urls.length > 100) {
      return res.status(400).json({ error: "El lote supera el máximo de 100 enlaces por solicitud." });
    }
    if (startDate && endDate && String(startDate) > String(endDate)) {
      return res.status(400).json({ error: "La fecha de inicio no puede ser posterior a la fecha de fin." });
    }

    // Deduplicar por URL canónica conservando el orden de llegada
    const seen = new Set<string>();
    const parsed = urls
      .map((u: unknown) => parseInstagramUrl(String(u)))
      .filter((p): p is NonNullable<typeof p> => {
        if (!p || seen.has(p.canonicalUrl)) return false;
        seen.add(p.canonicalUrl);
        return true;
      });

    const invalidCount = urls.length - parsed.length;
    if (parsed.length === 0) {
      return res.status(400).json({ error: "Ninguno de los enlaces es un enlace válido de Instagram." });
    }

    const batchId = `batch_${Date.now().toString(36)}`;
    console.log(
      `[download] ${batchId}: ${parsed.length} válidos, ${invalidCount} descartados. Filtros: ${startDate || "—"} → ${endDate || "—"}`
    );

    // Resolvemos canónica + miniatura por ítem. La descarga binaria real
    // ocurre en GET /api/media y POST /api/download-zip (solo medios
    // públicos, sin login ni evasión de controles de acceso).
    res.json({
      status: "success",
      batchId,
      processedAt: new Date().toISOString(),
      dateFilter: { startDate: startDate || null, endDate: endDate || null },
      summary: { requested: urls.length, ready: parsed.length, discarded: invalidCount },
      items: parsed.map((p) => ({ ...p, url: p.canonicalUrl, status: "ready" as const })),
    });
  });

  // --- Descarga real de UNA publicación (archivo) -------------------------
  app.get("/api/media", async (req, res) => {
    const parsed = parseInstagramUrl(String(req.query.url || ""));
    if (!parsed) {
      return res.status(400).json({ error: "Parámetro 'url' con un enlace válido de Instagram requerido." });
    }
    try {
      const media = await resolveMedia(parsed);
      const filename = `instagram-${parsed.shortcode}.${media.extension}`;
      res.setHeader("Content-Type", media.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "no-store");
      const length = media.response.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);
      if (!media.response.body) throw new MediaError("Respuesta de Instagram sin contenido.");
      const stream = Readable.fromWeb(media.response.body as never);
      stream.on("error", () => res.destroy());
      req.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error instanceof MediaError ? error.status : 502;
      res.status(status).json({
        error: error instanceof Error ? error.message : "No se pudo descargar la publicación.",
      });
    }
  });

  // --- Descarga real de TODO el lote (ZIP) --------------------------------
  app.post("/api/download-zip", async (req, res) => {
    const { urls } = req.body ?? {};
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Se requiere un arreglo 'urls' no vacío para armar el ZIP." });
    }
    if (urls.length > 20) {
      return res.status(400).json({ error: "El ZIP admite hasta 20 publicaciones por lote." });
    }
    const seen = new Set<string>();
    const parsedList = urls
      .map((u: unknown) => parseInstagramUrl(String(u)))
      .filter((p): p is NonNullable<typeof p> => {
        if (!p || seen.has(p.canonicalUrl)) return false;
        seen.add(p.canonicalUrl);
        return true;
      });
    if (parsedList.length === 0) {
      return res.status(400).json({ error: "Ninguno de los enlaces es válido para descargar." });
    }

    // Resolver todo ANTES de abrir el ZIP: si nada se pudo bajar, JSON de error.
    type ZipOk = { name: string; buffer: Buffer; source: string };
    const successes: ZipOk[] = [];
    const failures: { url: string; error: string }[] = [];
    const usedNames = new Set<string>();
    for (const parsed of parsedList) {
      try {
        const media = await resolveMedia(parsed);
        const declared = Number(media.response.headers.get("content-length") || 0);
        if (declared > MAX_ZIP_ITEM_BYTES) throw new MediaError("Supera los 30 MB por ítem del ZIP.", 413);
        const buffer = Buffer.from(await media.response.arrayBuffer());
        if (buffer.byteLength > MAX_ZIP_ITEM_BYTES) throw new MediaError("Supera los 30 MB por ítem del ZIP.", 413);
        let name = `instagram-${parsed.shortcode}.${media.extension}`;
        let n = 2;
        while (usedNames.has(name)) name = `instagram-${parsed.shortcode}-${n++}.${media.extension}`;
        usedNames.add(name);
        successes.push({ name, buffer, source: parsed.canonicalUrl });
      } catch (error) {
        failures.push({
          url: parsed.canonicalUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (successes.length === 0) {
      return res.status(502).json({
        error: "Ninguna publicación se pudo descargar. Instagram puede estar bloqueando al servidor (login) o los enlaces no son públicos.",
        failures,
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="instagram-lote-${stamp}.zip"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", () => res.destroy());
    archive.pipe(res);
    for (const item of successes) archive.append(item.buffer, { name: item.name });
    const manifest = [
      "URL,Tipo de resultado,Detalle",
      ...successes.map((s) => `"${s.source}","descargado","${s.name}"`),
      ...failures.map((f) => `"${f.url}","error","${f.error.replace(/"/g, '""')}"`),
    ].join("\n");
    archive.append(manifest, { name: "manifiesto.csv" });
    archive.append(
      `InstaTool Suite — lote ${stamp}\nDescargados: ${successes.length}\nCon error: ${failures.length}\nSolo medios públicos; si Instagram pide login, la descarga se omite y queda registrada en manifiesto.csv.\n`,
      { name: "LEEME.txt" }
    );
    await archive.finalize();
  });

  // Instagram does not provide a public geographic search endpoint here.
  // Never synthesize posts, usernames or locations and present them as real.
  app.post("/api/download-location", (_req, res) => {
    res.status(503).json({ error: "La extracción geográfica real de Instagram todavía no está conectada. No se generan publicaciones ni usuarios ficticios." });
  });

  app.get("/api/users-by-location", (_req, res) => {
    res.status(503).json({ error: "La búsqueda real de usuarios por ubicación todavía no está conectada." });
  });

  // --- Validación de URLs -------------------------------------------------
  app.post("/api/validate-urls", async (req, res) => {
    const { urls } = req.body ?? {};
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: "Se requiere un arreglo 'urls' no vacío." });
    }
    if (urls.length > 50) {
      return res.status(400).json({ error: "Máximo 50 URLs por validación." });
    }

    const results = await Promise.all(
      urls.map(async (rawUrl: unknown) => {
        const url = String(rawUrl);
        const parsed = parseInstagramUrl(url);
        if (!parsed) {
          return { url, status: "invalid" as const, isValid: false, isPublic: false, reason: "Formato de enlace inválido" };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        try {
          const response = await fetch(parsed.canonicalUrl, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
          });
          if (response.status === 404) {
            return { url, status: "invalid" as const, isValid: false, isPublic: false, reason: "No existe o fue eliminado" };
          }
          if (response.ok || [301, 302, 303, 307, 308].includes(response.status)) {
            return { url, status: "valid" as const, isValid: true, isPublic: true, reason: "Enlace público accesible" };
          }
          // 403 / 429 / login wall: Instagram bloquea la comprobación automática.
          // No afirmamos que sea privado: lo marcamos como "sin confirmar".
          return { url, status: "unknown" as const, isValid: true, isPublic: false, reason: "Instagram bloqueó la comprobación automática" };
        } catch {
          return { url, status: "unknown" as const, isValid: true, isPublic: false, reason: "No se pudo comprobar (red o timeout)" };
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    res.json({ results });
  });

  // --- Buscador por usuario ------------------------------------------------
  app.get("/api/user/:username", async (req, res) => {
    const username = String(req.params.username || "").replace(/^@+/, "").toLowerCase();
    if (!USERNAME_REGEX.test(username) || username.startsWith(".") || username.endsWith(".")) {
      return res.status(400).json({ error: "Nombre de usuario inválido (letras, números, puntos y guiones bajos, máx. 30)." });
    }
    const cached = userCache.get(username);
    if (cached && Date.now() - cached.at < USER_CACHE_MS) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached.body);
    }

    // Servicio interno Instaloader (binding de Vercel app → instaloader-master).
    // INSTALOADER_MASTER_URL lo inyecta Vercel en runtime; sin él (local),
    // se sigue con el parseo HTML de abajo. Nunca se define a mano.
    const instaloaderBase = process.env.INSTALOADER_MASTER_URL;
    if (instaloaderBase) {
      try {
        const svcUrl = new URL(`api/profile?username=${encodeURIComponent(username)}`, instaloaderBase).toString();
        const svcResponse = await fetchWithTimeout(svcUrl, 15000, "application/json");
        if (svcResponse.ok) {
          const svcBody = (await svcResponse.json()) as { status?: string };
          if (svcBody && svcBody.status === "success") {
            userCache.set(username, { at: Date.now(), body: svcBody });
            res.setHeader("X-Profile-Source", "instaloader-service");
            return res.json(svcBody);
          }
        }
      } catch { /* el servicio interno no respondió: fallback al HTML */ }
    }

    const profileUrl = `https://www.instagram.com/${username}/`;
    const blockedBody = (reason: string) => ({
      status: "blocked" as const,
      blocked: true,
      reason,
      username,
      profileUrl,
      fullName: null,
      biography: null,
      avatarUrl: null,
      isPrivate: null,
      isVerified: null,
      counts: { followers: null, following: null, posts: null },
      posts: [] as UserPost[],
    });

    let html = "";
    let httpStatus = 0;
    try {
      const response = await fetchWithTimeout(profileUrl, 12000, "text/html");
      httpStatus = response.status;
      html = await response.text();
    } catch {
      const body = blockedBody("No se pudo contactar a Instagram desde el servidor. Probá abrir el perfil directamente.");
      userCache.set(username, { at: Date.now(), body });
      return res.json(body);
    }

    if (httpStatus === 404 || /page not found|doesn't exist/i.test(html.slice(0, 5000)) && httpStatus >= 400) {
      return res.status(404).json({ error: `El usuario @${username} no existe o fue eliminado.` });
    }

    const ogDescription = metaContent(html, "og:description") || "";
    const ogImage = metaContent(html, "og:image");
    const ogTitle = metaContent(html, "og:title") || "";
    const statsMatch = ogDescription.match(/([\d,.]+)\s*Followers?,\s*([\d,.]+)\s*Following,\s*([\d,.]+)\s*Posts?/i);
    const hasProfileData = Boolean(ogImage || statsMatch || html.includes("edge_owner_to_timeline_media"));
    const looksLikeLoginWall = !hasProfileData && (/\/accounts\/login/i.test(html) || httpStatus === 403 || httpStatus === 429);

    if (looksLikeLoginWall || !hasProfileData) {
      const body = blockedBody("Instagram exige iniciar sesión para mostrar este perfil al servidor. Abrilo en Instagram y pegá los enlaces de sus publicaciones en la pestaña de descargas.");
      userCache.set(username, { at: Date.now(), body });
      return res.json(body);
    }

    const titleName = ogTitle.match(/^(.+?)\s*\(@/)?.[1]?.trim();
    const body = {
      status: "success" as const,
      blocked: false,
      username,
      profileUrl,
      fullName: jsonStringField(html, "full_name") || titleName || null,
      biography: jsonStringField(html, "biography"),
      avatarUrl: ogImage,
      isPrivate: jsonBoolField(html, "is_private"),
      isVerified: jsonBoolField(html, "is_verified"),
      counts: {
        followers: statsMatch ? parseCount(statsMatch[1]) : null,
        following: statsMatch ? parseCount(statsMatch[2]) : null,
        posts: statsMatch ? parseCount(statsMatch[3]) : null,
      },
      posts: extractTimelinePosts(html, username),
    };
    userCache.set(username, { at: Date.now(), body });
    res.json(body);
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint no encontrado." }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

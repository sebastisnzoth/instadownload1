/**
 * Utilidades compartidas para enlaces de Instagram.
 * Sin dependencias: se usa tanto para parsear, normalizar, deduplicar
 * y exportar, manteniendo App.tsx más chico y testeable.
 */

export const INSTAGRAM_REGEX =
  /https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/([a-zA-Z0-9_-]+)/i;

/** Busca URLs de Instagram incluso dentro de texto pegado con comentarios. */
const INSTAGRAM_GLOBAL_REGEX =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|stories)\/[a-zA-Z0-9_-]+[^\s"'<>]*/gi;

export type InstagramKind = 'p' | 'reel' | 'tv' | 'stories';

export interface ParsedInstagramUrl {
  original: string;
  shortcode: string;
  kind: InstagramKind;
  canonicalUrl: string;
  thumbnailUrl: string;
}

export function parseInstagramUrl(url: string): ParsedInstagramUrl | null {
  const match = url.trim().match(INSTAGRAM_REGEX);
  if (!match || match.index !== 0) return null;
  const rawKind = match[1].toLowerCase();
  const kind: InstagramKind = rawKind === 'reels' ? 'reel' : (rawKind as InstagramKind);
  const shortcode = match[2];
  // stories no tiene segmento canónico /p/, se conserva su propia ruta
  const segment = kind;
  const canonicalUrl = `https://www.instagram.com/${segment}/${shortcode}/`;
  return {
    original: url.trim(),
    shortcode,
    kind,
    canonicalUrl,
    thumbnailUrl: `https://www.instagram.com/${segment}/${shortcode}/media/?size=l`,
  };
}

/**
 * Extrae enlaces de un texto libre (uno por línea o pegados con texto),
 * normaliza a URL canónica y elimina duplicados conservando el orden.
 */
export function extractInstagramUrls(text: string): string[] {
  if (!text.trim()) return [];
  const fromLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const found = line.match(INSTAGRAM_GLOBAL_REGEX);
      return found ? found.map((u) => u.replace(/[),.;]+$/, '')) : [line];
    });

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of fromLines) {
    const parsed = parseInstagramUrl(candidate);
    const key = parsed ? parsed.canonicalUrl : candidate;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

export function isValidInstagramUrl(url: string): boolean {
  return INSTAGRAM_REGEX.test(url.trim());
}

/** Descarga un archivo de texto en el navegador usando Blob (seguro para CSV/JSON grandes). */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Liberar en el próximo tick para que el navegador inicie la descarga
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function filenameFromDisposition(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1].trim()) : fallback;
}

function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

async function throwApiError(response: Response, fallback: string): Promise<never> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error || `${fallback} (${response.status})`);
}

/**
 * Descarga real de UNA publicación: el servidor resuelve el medio público
 * (foto o video) y lo transmite; acá lo guardamos como archivo.
 */
export async function downloadMediaFile(canonicalUrl: string): Promise<string> {
  const parsed = parseInstagramUrl(canonicalUrl);
  const fallback = parsed ? `instagram-${parsed.shortcode}.jpg` : 'instagram-media.jpg';
  const response = await fetch(`/api/media?url=${encodeURIComponent(canonicalUrl)}`);
  if (!response.ok) await throwApiError(response, 'No se pudo descargar la publicación');
  const filename = filenameFromDisposition(response, fallback);
  saveBlob(await response.blob(), filename);
  return filename;
}

/** Descarga real de TODO el lote en un único ZIP (con manifiesto adentro). */
export async function downloadBatchZip(canonicalUrls: string[]): Promise<string> {
  const response = await fetch('/api/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: canonicalUrls }),
  });
  if (!response.ok) await throwApiError(response, 'No se pudo generar el ZIP');
  const filename = filenameFromDisposition(response, 'instagram-lote.zip');
  saveBlob(await response.blob(), filename);
  return filename;
}

const RESERVED_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);

/**
 * Normaliza un buscador por usuario: acepta `usuario`, `@usuario` o la URL
 * completa del perfil (`instagram.com/usuario/`). Devuelve null si no sirve.
 */
export function normalizeInstagramUsername(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  const urlMatch = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (urlMatch) {
    if (RESERVED_SEGMENTS.has(urlMatch[1].toLowerCase())) return null;
    value = urlMatch[1];
  }
  value = value.replace(/^@+/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value) || value.startsWith('.') || value.endsWith('.')) return null;
  return value.toLowerCase();
}

export const KIND_LABEL: Record<InstagramKind, string> = {
  p: 'Foto / Post',
  reel: 'Reel',
  tv: 'Video',
  stories: 'Historia',
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch, API_CONFIGURED } from './lib/api';
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import {
  Download,
  MapPin,
  Trash2,
  FileJson,
  FileText,
  Search,
  Loader2,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  X,
  Compass,
  Link2,
  ChevronRight,
  Info,
  ClipboardPaste,
  Copy,
  ExternalLink,
  LocateFixed,
  Eraser,
  FileDown,
  Archive,
  History,
  SearchX,
  AtSign,
  BadgeCheck,
  Lock,
  Plus,
  Play,
  Camera,
  Video as VideoIcon,
  Users,
} from 'lucide-react';
import {
  parseInstagramUrl,
  extractInstagramUrls,
  normalizeInstagramUsername,
  isValidInstagramUrl,
  downloadTextFile,
  downloadMediaFile,
  downloadBatchZip,
  toCsv,
  KIND_LABEL,
  type InstagramKind,
} from './lib/instagram';
import {
  searchPlaces,
  placeTypeLabel,
  placeTitle,
  placeSubtitle,
  placeBounds,
  loadRecentPlaces,
  rememberPlace,
  clearRecentPlaces,
  PLACE_FILTERS,
  type GeoSuggestion,
  type PlaceFilter,
} from './lib/geocode';

// Pin estándar de Leaflet con rutas CDN (evita assets rotos con el bundler)
const customMarkerIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function MapClickHandler({ onClick }: { onClick: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function MapController({ center }: { center: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom());
  }, [center, map]);
  return null;
}

/** Encuadra el mapa en la extensión del lugar elegido (ciudad, provincia, país…). */
function MapFitBounds({ bounds }: { bounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 15 });
  }, [bounds, map]);
  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

/** Barra de progreso reutilizable para los estados de carga. */
function ProgressBar({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2" role="status" aria-live="polite">
      <div className="flex justify-between items-center text-xs">
        <span className="text-indigo-800 font-medium flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {label}
        </span>
        <span className="text-indigo-600 font-mono font-semibold">{progress}%</span>
      </div>
      <div className="w-full bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
        <div className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function useFakeProgress(active: boolean, setProgress: (fn: (p: number) => number) => void, cap: number, step: number, ms: number) {
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setProgress((prev) => (prev >= cap ? cap : prev + step)), ms);
    return () => clearInterval(id);
  }, [active, setProgress, cap, step, ms]);
}

type ValidationStatus = 'checking' | 'valid' | 'unknown' | 'invalid' | 'syntax';
interface ValidationEntry { status: ValidationStatus; reason?: string }
interface DownloadedItem { url: string; canonicalUrl: string; shortcode: string; kind: InstagramKind; thumbnailUrl: string }
interface LocationItem {
  url: string; lat: number; lng: number; distanceKm?: number;
  author?: string; mediaType?: 'photo' | 'video'; tagged?: boolean;
  caption?: string; likes?: number; daysAgo?: number;
}
type Suggestion = GeoSuggestion;
interface UserPostItem { shortcode: string; url: string; thumbnailUrl: string; isVideo: boolean; likes: number | null; takenAt: number | null }
interface UserProfile {
  status: 'success' | 'blocked';
  blocked: boolean;
  reason?: string;
  username: string;
  profileUrl: string;
  fullName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  counts: { followers: number | null; following: number | null; posts: number | null };
  posts: UserPostItem[];
}

export default function App() {
  const [activeView, setActiveView] = useState<'download' | 'location' | 'user'>('download');

  // --- Buscador por usuario ---
  const [usernameInput, setUsernameInput] = useState('');
  const [userStatus, setUserStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [userProgress, setUserProgress] = useState(0);
  const [userError, setUserError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [recentUsers, setRecentUsers] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('instatool.recentUsers.v1') || '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string').slice(0, 6) : [];
    } catch { return []; }
  });

  // --- Descarga por enlaces ---
  const [rawUrlInput, setRawUrlInput] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadedItems, setDownloadedItems] = useState<DownloadedItem[]>([]);
  const [lastBatchCount, setLastBatchCount] = useState(0);
  const [downloadingMedia, setDownloadingMedia] = useState<Record<string, boolean>>({});
  const [mediaFeedback, setMediaFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [zipStatus, setZipStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [autoDownloadZip, setAutoDownloadZip] = useState(false);
  const [urlValidation, setUrlValidation] = useState<Record<string, ValidationEntry>>({});
  const validatedKeysRef = useRef<Set<string>>(new Set());

  // --- Ubicación ---
  const [locationQuery, setLocationQuery] = useState('Buenos Aires');
  const [limit, setLimit] = useState(20);
  const [radiusKm, setRadiusKm] = useState(5);
  const [markerPosition, setMarkerPosition] = useState({ lat: -34.6090264, lng: -58.3732215 });
  const [latInput, setLatInput] = useState('-34.6090264');
  const [lngInput, setLngInput] = useState('-58.3732215');
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationProgress, setLocationProgress] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [placeFilter, setPlaceFilter] = useState<PlaceFilter>('all');
  const [recentPlaces, setRecentPlaces] = useState<Suggestion[]>(() => loadRecentPlaces());
  const [mapBounds, setMapBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [noResultsQuery, setNoResultsQuery] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);
  const [historyQuery, setHistoryQuery] = useState('');
  const [locationSubmitStatus, setLocationSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationSubmitProgress, setLocationSubmitProgress] = useState(0);
  const [locationSubmitError, setLocationSubmitError] = useState<string | null>(null);
  const [locationDownloadedItems, setLocationDownloadedItems] = useState<LocationItem[]>([]);
  const [lastLocationCount, setLastLocationCount] = useState(0);
  const [locationUserQuery, setLocationUserQuery] = useState('');
  const [locationMediaFilter, setLocationMediaFilter] = useState<'all' | 'photo' | 'video'>('all');
  const [locationTaggedOnly, setLocationTaggedOnly] = useState(false);
  const suppressSearchRef = useRef(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Enlaces derivados: extracción tolerante + deduplicación (memo, sin estado duplicado)
  const pendingUrls = useMemo(() => extractInstagramUrls(rawUrlInput), [rawUrlInput]);
  const parsedPending = useMemo(() => pendingUrls.map((u) => parseInstagramUrl(u)), [pendingUrls]);
  const validSyntaxCount = parsedPending.filter(Boolean).length;
  const invalidSyntaxCount = pendingUrls.length - validSyntaxCount;
  const dateError = startDate && endDate && startDate > endDate ? 'La fecha de inicio no puede ser posterior a la fecha de fin.' : null;

  const singlePreview = useMemo(() => {
    if (pendingUrls.length !== 1) return null;
    return parsedPending[0];
  }, [pendingUrls, parsedPending]);

  // Búsqueda dentro del historial de descargas (por enlace, código o tipo)
  const filteredDownloadedItems = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return downloadedItems;
    return downloadedItems.filter(
      (i) => i.canonicalUrl.toLowerCase().includes(q) || i.shortcode.toLowerCase().includes(q) || KIND_LABEL[i.kind].toLowerCase().includes(q)
    );
  }, [downloadedItems, historyQuery]);

  // Descubrimiento por ubicación: filtro en vivo sobre lo ya recopilado
  const filteredLocationItems = useMemo(() => {
    const q = locationUserQuery.trim().toLowerCase().replace(/^@+/, '');
    return locationDownloadedItems.filter((item) =>
      (locationMediaFilter === 'all' || item.mediaType === locationMediaFilter) &&
      (!locationTaggedOnly || item.tagged) &&
      (!q || (item.author || '').toLowerCase().includes(q))
    );
  }, [locationDownloadedItems, locationUserQuery, locationMediaFilter, locationTaggedOnly]);

  const locationUsers = useMemo(() => {
    const byUser = new Map<string, { username: string; posts: number; photos: number; videos: number; tagged: number; nearestKm: number }>();
    for (const item of filteredLocationItems) {
      if (!item.author) continue;
      const entry = byUser.get(item.author) ?? { username: item.author, posts: 0, photos: 0, videos: 0, tagged: 0, nearestKm: item.distanceKm ?? 0 };
      entry.posts += 1;
      if (item.mediaType === 'video') entry.videos += 1; else entry.photos += 1;
      if (item.tagged) entry.tagged += 1;
      entry.nearestKm = Math.min(entry.nearestKm, item.distanceKm ?? entry.nearestKm);
      byUser.set(item.author, entry);
    }
    return [...byUser.values()].sort((a, b) => b.posts - a.posts || a.nearestKm - b.nearestKm);
  }, [filteredLocationItems]);

  // Mantener inputs de coordenadas en sincronía cuando el pin se mueve en el mapa
  useEffect(() => {
    setLatInput(markerPosition.lat.toFixed(7));
    setLngInput(markerPosition.lng.toFixed(7));
  }, [markerPosition]);

  // Cerrar el desplegable al hacer clic fuera
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setIsDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Validación remota: solo depende de la lista; ref evita bucles y duplicados en vuelo
  useEffect(() => {
    const canonicals = pendingUrls
      .map((u) => parseInstagramUrl(u)?.canonicalUrl)
      .filter((c): c is string => Boolean(c))
      .filter((c) => !validatedKeysRef.current.has(c));
    if (canonicals.length === 0) return;
    canonicals.forEach((c) => validatedKeysRef.current.add(c));

    setUrlValidation((prev) => {
      const next = { ...prev };
      canonicals.forEach((c) => (next[c] = { status: 'checking' }));
      return next;
    });

    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch('/api/validate-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: canonicals }),
        });
        if (!response.ok) throw new Error('Validation API Error');
        const { results } = await response.json();
        setUrlValidation((prev) => {
          const next = { ...prev };
          (results as { url: string; status: ValidationStatus; reason?: string }[]).forEach((r) => {
            const key = parseInstagramUrl(r.url)?.canonicalUrl ?? r.url;
            next[key] = { status: r.status, reason: r.reason };
          });
          return next;
        });
      } catch {
        // Sin conexión: "sin confirmar", nunca falso error; se permite reintentar
        canonicals.forEach((c) => validatedKeysRef.current.delete(c));
        setUrlValidation((prev) => {
          const next = { ...prev };
          canonicals.forEach((c) => (next[c] = { status: 'unknown', reason: 'No se pudo comprobar' }));
          return next;
        });
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrls]);

  useFakeProgress(downloadStatus === 'loading', setDownloadProgress, 92, 4, 150);
  useFakeProgress(locationStatus === 'loading', setLocationProgress, 90, 6, 120);
  useFakeProgress(locationSubmitStatus === 'loading', setLocationSubmitProgress, 95, 3, 180);
  useFakeProgress(userStatus === 'loading', setUserProgress, 90, 5, 140);

  // --- Handlers: descarga ---
  const removeUrl = (index: number) => {
    setRawUrlInput(pendingUrls.filter((_, i) => i !== index).join('\n'));
  };

  const clearInvalidUrls = () => {
    setRawUrlInput(pendingUrls.filter((u) => isValidInstagramUrl(u)).join('\n'));
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setRawUrlInput((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim()));
    } catch {
      setDownloadStatus('error');
      setDownloadError('El navegador bloqueó el acceso al portapapeles. Pegá los enlaces con Ctrl+V.');
    }
  };

  // Descarga real de una publicación (foto/video público) como archivo
  const handleDownloadMedia = async (canonicalUrl: string) => {
    if (downloadingMedia[canonicalUrl]) return;
    setDownloadingMedia((prev) => ({ ...prev, [canonicalUrl]: true }));
    setMediaFeedback(null);
    try {
      const filename = await downloadMediaFile(canonicalUrl);
      setMediaFeedback({ type: 'success', text: `Se descargó ${filename} en tu dispositivo.` });
    } catch (e) {
      setMediaFeedback({ type: 'error', text: e instanceof Error ? e.message : 'No se pudo descargar la publicación.' });
    } finally {
      setDownloadingMedia((prev) => ({ ...prev, [canonicalUrl]: false }));
    }
  };

  // Descarga real de un conjunto de enlaces en un solo ZIP (máx. 20 por ZIP)
  const runZipDownload = async (canonicalUrls: string[]) => {
    if (zipStatus === 'loading' || canonicalUrls.length === 0) return;
    setZipStatus('loading');
    setMediaFeedback(null);
    try {
      const limited = canonicalUrls.slice(0, 20);
      const filename = await downloadBatchZip(limited);
      setZipStatus('success');
      setMediaFeedback({
        type: 'success',
        text: canonicalUrls.length > 20
          ? `Se descargó ${filename} con las primeras 20 publicaciones. Quedan ${canonicalUrls.length - 20} fuera de este ZIP (límite por lote).`
          : `Se descargó ${filename} con ${limited.length} publicación(es). Si alguna falló, quedó registrada en manifiesto.csv dentro del ZIP.`,
      });
    } catch (e) {
      setZipStatus('error');
      setMediaFeedback({ type: 'error', text: e instanceof Error ? e.message : 'No se pudo generar el ZIP de descarga.' });
    }
  };

  const handleDownload = async () => {
    if (pendingUrls.length === 0 || dateError) return;
    if (invalidSyntaxCount > 0) {
      setDownloadStatus('error');
      setDownloadError(`Hay ${invalidSyntaxCount} enlace(s) con formato inválido. Quitalos con "Limpiar inválidos" y reintentá.`);
      return;
    }
    setDownloadStatus('loading');
    setDownloadProgress(20);
    setDownloadError(null);
    try {
      const canonicalUrls = parsedPending.filter(Boolean).map((p) => p!.canonicalUrl);
      const response = await apiFetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: canonicalUrls, startDate: startDate || undefined, endDate: endDate || undefined }),
      });
      setDownloadProgress(80);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ocurrió un error al procesar el lote en el servidor.');
      const items: DownloadedItem[] = (data.items ?? []).map((i: DownloadedItem) => ({
        url: i.url, canonicalUrl: i.canonicalUrl, shortcode: i.shortcode, kind: i.kind, thumbnailUrl: i.thumbnailUrl,
      }));
      setDownloadedItems((prev) => {
        const known = new Set(prev.map((p) => p.canonicalUrl));
        return [...prev, ...items.filter((i) => !known.has(i.canonicalUrl))];
      });
      setLastBatchCount(items.length);
      setDownloadStatus('success');
      setDownloadProgress(100);
      setRawUrlInput('');
      if (autoDownloadZip && items.length > 0) {
        void runZipDownload(items.map((i) => i.canonicalUrl));
      }
    } catch (e) {
      setDownloadStatus('error');
      setDownloadError(e instanceof Error ? e.message : 'Error de red. No se pudo establecer conexión con el servidor.');
    }
  };

  const clearDownloads = () => {
    setRawUrlInput('');
    setStartDate('');
    setEndDate('');
    setDownloadStatus('idle');
    setDownloadProgress(0);
    setDownloadError(null);
  };

  const handleExport = (format: 'json' | 'csv') => {
    if (format === 'json') {
      downloadTextFile('instagram_downloaded_items.json', JSON.stringify(downloadedItems, null, 2), 'application/json;charset=utf-8');
    } else {
      downloadTextFile(
        'instagram_downloaded_items.csv',
        toCsv([['URL', 'Tipo', 'Codigo'], ...downloadedItems.map((i) => [i.canonicalUrl, KIND_LABEL[i.kind], i.shortcode])]),
        'text/csv;charset=utf-8'
      );
    }
  };

  const handleLocationExport = (format: 'json' | 'csv') => {
    if (format === 'json') {
      downloadTextFile('instagram_location_items.json', JSON.stringify(locationDownloadedItems, null, 2), 'application/json;charset=utf-8');
    } else {
      downloadTextFile(
        'instagram_location_items.csv',
        toCsv([['URL', 'Autor', 'Tipo', 'EtiquetadoEnUbicacion', 'Latitud', 'Longitud', 'DistanciaKm'], ...locationDownloadedItems.map((i) => [i.url, i.author ?? '', i.mediaType ?? '', i.tagged ? 'si' : 'no', String(i.lat), String(i.lng), String(i.distanceKm ?? '')])]),
        'text/csv;charset=utf-8'
      );
    }
  };

  // --- Handlers: buscador por usuario ---
  const rememberUser = (username: string) => {
    setRecentUsers((prev) => {
      const next = [username, ...prev.filter((u) => u !== username)].slice(0, 6);
      try { localStorage.setItem('instatool.recentUsers.v1', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  const handleUserSearch = async (raw?: string) => {
    const username = normalizeInstagramUsername(raw ?? usernameInput);
    if (!username) {
      setUserStatus('error');
      setUserError('Ingresá un usuario válido: letras, números, puntos y guiones bajos (o pegá la URL del perfil).');
      setUserProfile(null);
      return;
    }
    setUsernameInput(`@${username}`);
    setUserStatus('loading');
    setUserProgress(15);
    setUserError(null);
    setAvatarBroken(false);
    try {
      const response = await apiFetch(`/api/user/${encodeURIComponent(username)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `No se pudo buscar a @${username}.`);
      setUserProfile(data as UserProfile);
      setUserStatus('success');
      setUserProgress(100);
      rememberUser(username);
    } catch (e) {
      setUserStatus('error');
      setUserProfile(null);
      setUserError(e instanceof Error ? e.message : 'Error de red al buscar el usuario.');
    }
  };

  const addPostsToQueue = (posts: UserPostItem[]) => {
    if (posts.length === 0) return;
    const urls = posts.map((p) => p.url);
    setRawUrlInput((prev) => {
      const existing = new Set(extractInstagramUrls(prev));
      const fresh = urls.filter((u) => !existing.has(u));
      return prev.trim() ? `${prev.trim()}\n${fresh.join('\n')}` : fresh.join('\n');
    });
    setDownloadStatus('idle');
    setMediaFeedback({ type: 'success', text: `Se agregaron ${urls.length} publicación(es) de @${userProfile?.username ?? 'usuario'} a la cola de descarga.` });
    setActiveView('download');
  };

  const formatCount = (value: number | null): string =>
    value === null ? '—' : new Intl.NumberFormat('es', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);

  // --- Handlers: ubicación ---
  const fetchSuggestions = (query: string, signal?: AbortSignal): Promise<Suggestion[]> =>
    searchPlaces(query, placeFilter, signal);

  // Autocompletado en vivo: debounce + cancelación de la petición anterior
  // para que una respuesta lenta nunca pise sugerencias más nuevas.
  useEffect(() => {
    if (suppressSearchRef.current) { suppressSearchRef.current = false; return; }
    const q = locationQuery.trim();
    if (q.length < 2) {
      searchAbortRef.current?.abort();
      setSuggestions([]);
      setNoResultsQuery(null);
      setHighlightedIndex(-1);
      setIsSearchingPlaces(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setIsSearchingPlaces(true);
    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const data = await fetchSuggestions(q, controller.signal);
        if (searchSeqRef.current !== seq) return; // llegó tarde: se descarta
        setSuggestions(data);
        setHighlightedIndex(data.length > 0 ? 0 : -1);
        setNoResultsQuery(data.length === 0 ? q : null);
        setIsDropdownOpen(true);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        if (searchSeqRef.current !== seq) return;
        setNoResultsQuery(q); // el panel muestra el aviso; Buscar reporta el error en detalle
        setIsDropdownOpen(true);
      } finally {
        if (searchSeqRef.current === seq) setIsSearchingPlaces(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationQuery, placeFilter]);

  const handleLocationSearch = async () => {
    const q = locationQuery.trim();
    if (!q) return;
    setLocationStatus('loading');
    setLocationProgress(15);
    setLocationError(null);
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      const data = await fetchSuggestions(q, controller.signal);
      setLocationProgress(60);
      if (data.length === 0) {
        setSuggestions([]);
        setNoResultsQuery(q);
        setIsDropdownOpen(true);
        setLocationStatus('error');
        setLocationError(
          placeFilter === 'all'
            ? `Sin resultados para “${q}”. Revisá la ortografía o probá con el nombre en su idioma original.`
            : `Sin resultados para “${q}” con el filtro actual. Probá con el filtro “Todos”.`
        );
        return;
      }
      setSuggestions(data);
      selectSuggestion(data[0]);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setLocationStatus('error');
      setLocationError('Error al consultar el servicio de geolocalización. Probá de nuevo.');
    }
  };

  const selectSuggestion = (item: Suggestion) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    suppressSearchRef.current = true;
    searchAbortRef.current?.abort();
    setMarkerPosition({ lat, lng });
    setMapBounds(placeBounds(item));
    setLocationQuery(item.display_name);
    setSuggestions([]);
    setNoResultsQuery(null);
    setHighlightedIndex(-1);
    setIsDropdownOpen(false);
    setRecentPlaces((prev) => rememberPlace(prev, item));
    setLocationStatus('success');
    setLocationProgress(100);
  };

  const handleReverseGeocode = async (lat: number, lng: number) => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
        headers: { 'Accept-Language': 'es,en' },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.display_name) {
        suppressSearchRef.current = true;
        setLocationQuery(data.display_name);
      }
    } catch { /* las coordenadas ya quedaron actualizadas */ }
  };

  const handleMapPoint = (lat: number, lng: number) => {
    setMarkerPosition({ lat, lng });
    setMapBounds(null);
    setLocationStatus('success');
    setLocationProgress(100);
    void handleReverseGeocode(lat, lng);
  };

  const handleUseMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('error');
      setLocationError('Tu navegador no soporta geolocalización.');
      return;
    }
    setLocationStatus('loading');
    setLocationProgress(30);
    navigator.geolocation.getCurrentPosition(
      (pos) => handleMapPoint(pos.coords.latitude, pos.coords.longitude),
      () => {
        setLocationStatus('error');
        setLocationError('No se pudo obtener tu ubicación (permiso denegado o sin señal).');
      },
      { timeout: 10000 }
    );
  };

  const commitCoordinates = () => {
    const lat = parseFloat(latInput.replace(',', '.'));
    const lng = parseFloat(lngInput.replace(',', '.'));
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationStatus('error');
      setLocationError('Coordenadas inválidas: latitud entre -90 y 90, longitud entre -180 y 180.');
      setLatInput(markerPosition.lat.toFixed(7));
      setLngInput(markerPosition.lng.toFixed(7));
      return;
    }
    setMarkerPosition({ lat, lng });
    setMapBounds(null);
    setLocationStatus('success');
    void handleReverseGeocode(lat, lng);
  };

  const copyCoordinates = async () => {
    try { await navigator.clipboard.writeText(`${markerPosition.lat.toFixed(7)}, ${markerPosition.lng.toFixed(7)}`); } catch { /* noop */ }
  };

  const handleLocationSubmit = async () => {
    setLocationSubmitStatus('loading');
    setLocationSubmitProgress(20);
    setLocationSubmitError(null);
    try {
      const response = await apiFetch('/api/download-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: markerPosition.lat, lng: markerPosition.lng, limit, radiusKm, media: locationMediaFilter, taggedOnly: locationTaggedOnly, q: locationUserQuery }),
      });
      setLocationSubmitProgress(80);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ocurrió un error al procesar la extracción geográfica.');
      if (!Array.isArray(data.items)) throw new Error('El servidor devolvió una respuesta incorrecta para la extracción geográfica.');
      const items: LocationItem[] = data.items;
      setLocationDownloadedItems((prev) => {
        const known = new Set(prev.map((p) => p.url));
        return [...prev, ...items.filter((i) => !known.has(i.url))];
      });
      setLastLocationCount(items.length);
      setLocationSubmitStatus('success');
      setLocationSubmitProgress(100);
    } catch (e) {
      setLocationSubmitStatus('error');
      setLocationSubmitError(e instanceof Error ? e.message : 'Error de red al conectar con el servidor.');
    }
  };

  const validationVisual = (url: string, parsed: ReturnType<typeof parseInstagramUrl>) => {
    if (!parsed) return { Icon: AlertCircle, cls: 'text-red-500', label: 'Formato de enlace inválido', error: true };
    const v = urlValidation[parsed.canonicalUrl];
    if (!v || v.status === 'checking') return { Icon: Loader2, cls: 'text-slate-400 animate-spin', label: 'Validando enlace…', error: false };
    if (v.status === 'valid') return { Icon: CheckCircle, cls: 'text-emerald-500', label: v.reason || 'Enlace público válido', error: false };
    if (v.status === 'invalid') return { Icon: AlertCircle, cls: 'text-red-500', label: v.reason || 'Enlace inexistente', error: true };
    return { Icon: HelpCircle, cls: 'text-amber-500', label: v.reason || 'Sin confirmar (Instagram bloqueó la comprobación)', error: false };
  };

  const hasValidationWarning = pendingUrls.some((u, i) => {
    const parsed = parsedPending[i];
    if (!parsed) return true;
    return urlValidation[parsed.canonicalUrl]?.status === 'invalid';
  });

  // Paneles del buscador de lugares: resultados, recientes o "sin resultados"
  const showRecentPanel =
    isDropdownOpen && suggestions.length === 0 && !isSearchingPlaces && locationQuery.trim().length < 2 && recentPlaces.length > 0;
  const showEmptyPanel =
    isDropdownOpen && suggestions.length === 0 && !showRecentPanel && !isSearchingPlaces && noResultsQuery !== null;
  const showSearchPanel = isDropdownOpen && (suggestions.length > 0 || showRecentPanel || showEmptyPanel);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-100 shadow-xl shadow-slate-100/50 flex flex-col">
        {/* Header */}
        <div className="p-6 bg-slate-900 text-white relative overflow-hidden rounded-t-2xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-6 -mt-6" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <Compass className="w-5 h-5 text-indigo-100 animate-spin-slow" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">InstaTool Suite</h1>
                <p className="text-xs text-slate-400">Herramienta estratégica para profesionales</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(downloadedItems.length + locationDownloadedItems.length) > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-slate-800 text-[10px] font-semibold text-indigo-300 border border-slate-700">
                  {downloadedItems.length + locationDownloadedItems.length} en historial
                </span>
              )}
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-[10px] uppercase font-semibold tracking-wider text-emerald-400 border border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Hugo Activo
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-col sm:flex-row border-b border-slate-100 bg-slate-50 p-1.5 gap-2" role="tablist" aria-label="Vistas">
          <button
            onClick={() => setActiveView('download')} role="tab" aria-selected={activeView === 'download'} id="tab-download"
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${activeView === 'download' ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <Download className="w-4 h-4" />
            Descarga de Lotes (Instagram)
            {downloadedItems.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{downloadedItems.length}</span>}
          </button>
          <button
            onClick={() => setActiveView('location')} role="tab" aria-selected={activeView === 'location'} id="tab-location"
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${activeView === 'location' ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <MapPin className="w-4 h-4" />
            Mapa de Ubicación
            {locationDownloadedItems.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{locationDownloadedItems.length}</span>}
          </button>
          <button
            onClick={() => setActiveView('user')} role="tab" aria-selected={activeView === 'user'} id="tab-user"
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${activeView === 'user' ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <AtSign className="w-4 h-4" />
            Por Usuario
            {userProfile && !userProfile.blocked && userProfile.posts.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold">{userProfile.posts.length}</span>}
          </button>
        </div>

        <div className="p-6 sm:p-8 flex-1">
          <AnimatePresence mode="wait">
            {activeView === 'download' && (
              <motion.div key="download-view" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }} className="space-y-5" id="view-download-container">
                <div>
                  <div className="flex items-end justify-between gap-2 mb-2 flex-wrap">
                    <label htmlFor="input-urls" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Enlaces de Instagram (uno por línea)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button onClick={pasteFromClipboard} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition">
                        <ClipboardPaste className="w-3 h-3" /> Pegar
                      </button>
                      {invalidSyntaxCount > 0 && (
                        <button onClick={clearInvalidUrls} className="flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition">
                          <Eraser className="w-3 h-3" /> Limpiar inválidos ({invalidSyntaxCount})
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <textarea
                      id="input-urls"
                      className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-y text-sm text-slate-800 placeholder:text-slate-400 bg-slate-50/50 transition duration-150 min-h-[110px]"
                      placeholder={'https://www.instagram.com/p/CnM9B21S2-b/\nhttps://www.instagram.com/reel/C3m8hP8M_1H/'}
                      value={rawUrlInput}
                      onChange={(e) => setRawUrlInput(e.target.value)}
                      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void handleDownload(); }}
                      rows={4}
                      aria-describedby="urls-help"
                    />
                    <div className="absolute top-3 right-3 text-slate-400 pointer-events-none"><Link2 className="w-4 h-4 opacity-50" /></div>
                  </div>
                  <p id="urls-help" className="text-[11px] text-slate-400 mt-1.5">Podés pegar texto con enlaces mezclados: se extraen y deduplican solos. <kbd className="font-mono bg-slate-100 px-1 rounded">Ctrl</kbd>+<kbd className="font-mono bg-slate-100 px-1 rounded">Enter</kbd> para enviar.</p>
                </div>

                {pendingUrls.length > 0 && (
                  <div className="space-y-2 border border-slate-100 p-4 rounded-xl bg-slate-50/50 max-h-56 overflow-y-auto">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-200/60 flex-wrap gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Enlaces en Cola ({pendingUrls.length})</span>
                      <span className="flex gap-1.5">
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">{validSyntaxCount} con formato válido</span>
                        {invalidSyntaxCount > 0 && <span className="text-[10px] text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-semibold">{invalidSyntaxCount} inválidos</span>}
                      </span>
                    </div>
                    <div className="space-y-1.5 pt-1.5">
                      {pendingUrls.map((url, index) => {
                        const parsed = parsedPending[index];
                        const v = validationVisual(url, parsed);
                        const StatusIcon = v.Icon;
                        return (
                          <div key={`${url}-${index}`} className={`flex items-center justify-between p-2 bg-white border ${v.error ? 'border-red-200 bg-red-50/50' : 'border-slate-100'} rounded-lg text-xs transition duration-200`}>
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${v.cls}`} aria-label={v.label} />
                              <span className={`truncate font-mono text-[11px] ${v.error ? 'text-red-600 font-medium' : 'text-slate-600'}`}>{url}</span>
                              {parsed && <span className="hidden sm:inline shrink-0 text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{KIND_LABEL[parsed.kind]}</span>}
                            </div>
                            <button onClick={() => removeUrl(index)} className="bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded p-1 transition shrink-0" title="Remover enlace" aria-label={`Remover ${url}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hasValidationWarning && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200/60 rounded-xl text-xs text-amber-800 flex items-start gap-2.5" role="alert">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed"><strong className="font-bold">Advertencia de Validación:</strong> algunos enlaces tienen formato inválido o parecen inexistentes. Los marcados como «sin confirmar» no son un error: Hugo no pudo verificarlos automáticamente.</p>
                  </div>
                )}

                {singlePreview && (
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-600" /> Vista previa · {KIND_LABEL[singlePreview.kind]} · <span className="font-mono">{singlePreview.shortcode}</span>
                      </span>
                      <a href={singlePreview.canonicalUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">Abrir <ExternalLink className="w-3 h-3" /></a>
                    </div>
                    <img src={singlePreview.thumbnailUrl} alt="Vista previa de Instagram" className="w-full max-h-52 object-cover rounded-xl border border-slate-100 shadow-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <button
                      onClick={() => void handleDownloadMedia(singlePreview.canonicalUrl)}
                      disabled={Boolean(downloadingMedia[singlePreview.canonicalUrl])}
                      className="mt-3 w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl text-xs font-semibold transition disabled:opacity-50 shadow-sm shadow-indigo-600/20"
                    >
                      {downloadingMedia[singlePreview.canonicalUrl] ? (<><Loader2 className="w-4 h-4 animate-spin" /> Descargando…</>) : (<><FileDown className="w-4 h-4" /> Descargar esta publicación</>)}
                    </button>
                    <p className="text-[10px] text-slate-400 mt-1.5 text-center">Foto en máxima calidad o video si es Reel. Solo funciona si la publicación es pública.</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="start-date" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Fecha Inicio (Opcional)</label>
                    <input id="start-date" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50" />
                  </div>
                  <div>
                    <label htmlFor="end-date" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Fecha Fin (Opcional)</label>
                    <input id="end-date" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50" />
                  </div>
                </div>
                {dateError && <p className="text-xs text-red-600 flex items-center gap-1.5 -mt-2" role="alert"><AlertCircle className="w-3.5 h-3.5" />{dateError}</p>}

                <AnimatePresence>
                  {downloadStatus !== 'idle' && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="space-y-3" aria-live="polite">
                      {downloadStatus === 'loading' && <ProgressBar progress={downloadProgress} label="Hugo está procesando la descarga…" />}
                      {downloadStatus === 'success' && (
                        <motion.div layout initial={{ height: 0, opacity: 0, scale: 0.95 }} animate={{ height: 'auto', opacity: 1, scale: 1 }} exit={{ height: 0, opacity: 0, scale: 0.95 }} transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }} className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800 origin-top overflow-hidden">
                          <motion.div initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 15 }} className="shrink-0 mt-0.5">
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                          </motion.div>
                          <div className="space-y-2 flex-1">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-sm">¡Lote listo para descargar!</p>
                              <p className="text-emerald-700/80">Hugo procesó {lastBatchCount} publicación(es). Descargalas ahora en un ZIP o de a una en el historial.</p>
                            </div>
                            <button
                              onClick={() => void runZipDownload(downloadedItems.map((i) => i.canonicalUrl))}
                              disabled={zipStatus === 'loading' || downloadedItems.length === 0}
                              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition disabled:opacity-50 shadow-sm"
                            >
                              {zipStatus === 'loading' ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Armado el ZIP…</>) : (<><Archive className="w-3.5 h-3.5" /> Descargar todo (.zip)</>)}
                            </button>
                          </div>
                        </motion.div>
                      )}
                      {downloadStatus === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-800" role="alert">
                          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5"><p className="font-semibold">Fallo en la Solicitud</p><p className="text-red-700/80">{downloadError}</p></div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {mediaFeedback && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className={`flex items-start gap-3 p-4 rounded-xl text-xs border ${mediaFeedback.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'}`} role="alert" aria-live="polite">
                      {mediaFeedback.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
                      <p className="flex-1 leading-relaxed">{mediaFeedback.text}</p>
                      <button onClick={() => setMediaFeedback(null)} aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <label className="flex items-center gap-2.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5 cursor-pointer select-none">
                  <input type="checkbox" checked={autoDownloadZip} onChange={(e) => setAutoDownloadZip(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                  <span><strong className="font-semibold text-slate-700">Descargar ZIP automáticamente</strong> al procesar el lote (hasta 20 publicaciones).</span>
                </label>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button onClick={clearDownloads} className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-3 rounded-xl font-medium hover:bg-slate-200 hover:text-slate-900 transition-all text-xs">
                    <Trash2 className="w-4 h-4 opacity-75" /> Limpiar Todo
                  </button>
                  <button onClick={() => void handleDownload()} disabled={downloadStatus === 'loading' || pendingUrls.length === 0 || Boolean(dateError)} className="flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-800 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-slate-900/15">
                    {downloadStatus === 'loading' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Procesando…</>) : (<><Download className="w-4 h-4" /> Preparar descarga</>)}
                  </button>
                </div>

                {downloadedItems.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                    <div className="bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-xl flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs text-indigo-950"><span className="font-semibold">{downloadedItems.length} publicaciones</span> en el historial.</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => void runZipDownload(downloadedItems.map((i) => i.canonicalUrl))} disabled={zipStatus === 'loading'} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50">{zipStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />} {zipStatus === 'loading' ? 'Armado ZIP…' : 'Descargar todo (.zip)'}</button>
                        <button onClick={() => handleExport('csv')} className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-slate-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><FileText className="w-3.5 h-3.5" /> CSV</button>
                        <button onClick={() => handleExport('json')} className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><FileJson className="w-3.5 h-3.5" /> JSON</button>
                        <button onClick={() => { setDownloadedItems([]); setHistoryQuery(''); }} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><Trash2 className="w-3.5 h-3.5" /> Vaciar</button>
                      </div>
                    </div>
                    {downloadedItems.length > 3 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                        <input
                          type="text" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)}
                          placeholder="Buscar en el historial (código, tipo o enlace)…"
                          aria-label="Buscar en el historial de descargas"
                          className="w-full p-2.5 pl-9 pr-8 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-xs text-slate-800 bg-slate-50/50"
                        />
                        {historyQuery && (
                          <button onClick={() => setHistoryQuery('')} aria-label="Limpiar búsqueda del historial" className="absolute right-2 top-2.5 text-slate-300 hover:text-slate-500"><X className="w-4 h-4" /></button>
                        )}
                      </div>
                    )}
                    {historyQuery && (
                      <p className="text-[11px] text-slate-400">{filteredDownloadedItems.length} de {downloadedItems.length} publicaciones{filteredDownloadedItems.length === 0 ? ' — probá con otro término' : ''}</p>
                    )}
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {filteredDownloadedItems.map((item) => (
                        <li key={item.canonicalUrl} className="flex items-center gap-3 p-2 bg-white border border-slate-100 rounded-xl text-xs">
                          <img src={item.thumbnailUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-[11px] text-slate-700 truncate">{item.canonicalUrl}</p>
                            <p className="text-[10px] text-slate-400">{KIND_LABEL[item.kind]} · {item.shortcode}</p>
                          </div>
                          <button onClick={() => void handleDownloadMedia(item.canonicalUrl)} disabled={Boolean(downloadingMedia[item.canonicalUrl])} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50 shrink-0" title="Descargar archivo (foto o video público)" aria-label={`Descargar ${item.shortcode}`}>{downloadingMedia[item.canonicalUrl] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}<span className="hidden sm:inline">{downloadingMedia[item.canonicalUrl] ? 'Bajando…' : 'Descargar'}</span></button>
                          <a href={item.canonicalUrl} target="_blank" rel="noreferrer" className="p-1.5 text-slate-400 hover:text-indigo-600" aria-label="Abrir en Instagram"><ExternalLink className="w-3.5 h-3.5" /></a>
                          <button onClick={() => setDownloadedItems((prev) => prev.filter((p) => p.canonicalUrl !== item.canonicalUrl))} className="p-1.5 text-slate-400 hover:text-red-500" aria-label="Quitar del historial"><Trash2 className="w-3.5 h-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeView === 'location' && (
              <motion.div key="location-view" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }} className="space-y-5" id="view-location-container">
                <div className="space-y-2 relative" ref={searchBoxRef}>
                  <label htmlFor="location-search-input" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Buscar Ubicación / Ciudad</label>

                  {/* Filtro por tipo de lugar */}
                  <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Tipo de lugar">
                    {PLACE_FILTERS.map((f) => (
                      <button
                        key={f.id} type="button" onClick={() => { setPlaceFilter(f.id); setSuggestions([]); setNoResultsQuery(null); setHighlightedIndex(-1); }}
                        aria-pressed={placeFilter === f.id}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${placeFilter === f.id ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/25' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text" id="location-search-input" value={locationQuery} autoComplete="off"
                        role="combobox" aria-expanded={showSearchPanel} aria-controls="search-suggestions-panel" aria-autocomplete="list"
                        aria-activedescendant={highlightedIndex >= 0 && suggestions[highlightedIndex] ? `place-option-${highlightedIndex}` : undefined}
                        onChange={(e) => { setLocationQuery(e.target.value); setNoResultsQuery(null); }}
                        onFocus={() => { if (suggestions.length > 0 || recentPlaces.length > 0) setIsDropdownOpen(true); }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' && suggestions.length > 0) {
                            e.preventDefault();
                            setIsDropdownOpen(true);
                            setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
                          } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
                            e.preventDefault();
                            setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                          } else if (e.key === 'Enter') {
                            const chosen = (highlightedIndex >= 0 ? suggestions[highlightedIndex] : undefined) || suggestions[0];
                            if (isDropdownOpen && chosen) selectSuggestion(chosen);
                            else void handleLocationSearch();
                          } else if (e.key === 'Escape') {
                            setIsDropdownOpen(false);
                            setHighlightedIndex(-1);
                          }
                        }}
                        placeholder="Ciudad, provincia, país o dirección… sugiere mientras escribís"
                        className="w-full p-3.5 pl-10 pr-9 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50 transition duration-150"
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-4" />
                      {isSearchingPlaces ? (
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin absolute right-3 top-4" />
                      ) : locationQuery.trim() !== '' ? (
                        <button type="button" aria-label="Limpiar búsqueda" onClick={() => { setLocationQuery(''); setSuggestions([]); setNoResultsQuery(null); setHighlightedIndex(-1); }} className="absolute right-2.5 top-3.5 text-slate-300 hover:text-slate-500 p-0.5"><X className="w-4 h-4" /></button>
                      ) : null}
                    </div>
                    <button onClick={() => void handleLocationSearch()} disabled={isSearchingPlaces || !locationQuery.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 sm:px-5 rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-600/25 transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Search className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Buscar</span>
                    </button>
                    <button onClick={handleUseMyLocation} title="Usar mi ubicación" aria-label="Usar mi ubicación" className="bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-500 px-3.5 rounded-xl transition cursor-pointer flex items-center justify-center">
                      <LocateFixed className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {showSearchPanel && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute w-full bg-white border border-slate-200 rounded-xl shadow-xl mt-1 max-h-72 overflow-y-auto" style={{ zIndex: 1000 }} id="search-suggestions-panel" role="listbox" aria-label="Sugerencias de lugares">
                        {suggestions.length > 0 && (
                          <>
                            <div className="p-2.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center sticky top-0">
                              <span>{suggestions.length} resultado{suggestions.length !== 1 ? 's' : ''} · ↑↓ para navegar, Enter para elegir</span>
                              <button onClick={() => setIsDropdownOpen(false)} aria-label="Cerrar sugerencias"><X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" /></button>
                            </div>
                            {suggestions.map((item, index) => (
                              <button
                                key={item.place_id ?? `${item.lat}-${item.lon}-${index}`} id={`place-option-${index}`} role="option" aria-selected={index === highlightedIndex}
                                onClick={() => selectSuggestion(item)} onMouseEnter={() => setHighlightedIndex(index)}
                                className={`w-full text-left px-3 py-2.5 transition text-xs flex items-start gap-2.5 leading-snug border-t border-slate-50 ${index === highlightedIndex ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                              >
                                <MapPin className={`w-4 h-4 shrink-0 mt-0.5 ${index === highlightedIndex ? 'text-indigo-600' : 'text-indigo-400'}`} />
                                <span className="flex-1 min-w-0">
                                  <span className="block font-semibold text-slate-800 truncate">{placeTitle(item)}</span>
                                  {placeSubtitle(item) && <span className="block text-[11px] text-slate-400 truncate">{placeSubtitle(item)}</span>}
                                </span>
                                <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${index === highlightedIndex ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{placeTypeLabel(item)}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-slate-300 self-center shrink-0" />
                              </button>
                            ))}
                          </>
                        )}

                        {showRecentPanel && (
                          <>
                            <div className="p-2.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                              <span className="flex items-center gap-1"><History className="w-3 h-3" /> Búsquedas recientes</span>
                              <button onClick={() => { clearRecentPlaces(); setRecentPlaces([]); setIsDropdownOpen(false); }} className="flex items-center gap-1 normal-case tracking-normal font-semibold text-slate-400 hover:text-red-500"><Trash2 className="w-3 h-3" /> Borrar</button>
                            </div>
                            {recentPlaces.map((item) => (
                              <button key={`recent-${item.display_name}`} onClick={() => selectSuggestion(item)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition text-xs flex items-start gap-2.5 leading-snug border-t border-slate-50">
                                <History className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                                <span className="flex-1 min-w-0">
                                  <span className="block font-medium text-slate-700 truncate">{placeTitle(item)}</span>
                                  {placeSubtitle(item) && <span className="block text-[11px] text-slate-400 truncate">{placeSubtitle(item)}</span>}
                                </span>
                                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{placeTypeLabel(item)}</span>
                              </button>
                            ))}
                          </>
                        )}

                        {showEmptyPanel && (
                          <div className="p-4 text-center space-y-1.5">
                            <SearchX className="w-5 h-5 text-slate-300 mx-auto" />
                            <p className="text-xs font-semibold text-slate-600">Sin resultados para “{noResultsQuery}”</p>
                            <p className="text-[11px] text-slate-400 leading-relaxed">Revisá la ortografía, probá el nombre en su idioma original{placeFilter !== 'all' ? ' o quitá el filtro de tipo (Todos)' : ''}.</p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="w-full h-72 overflow-hidden rounded-2xl border border-slate-200/80 shadow-inner relative bg-slate-100">
                  <MapContainer center={[-34.6090264, -58.3732215]} zoom={12} zoomControl style={{ width: '100%', height: '100%', zIndex: 1 }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                    <MapClickHandler onClick={(latlng) => handleMapPoint(latlng.lat, latlng.lng)} />
                    <Marker
                      position={[markerPosition.lat, markerPosition.lng]} icon={customMarkerIcon} draggable
                      eventHandlers={{ dragend: (e) => { const m = e.target as L.Marker; const p = m.getLatLng(); handleMapPoint(p.lat, p.lng); } }}
                    />
                    <Circle center={[markerPosition.lat, markerPosition.lng]} radius={radiusKm * 1000} pathOptions={{ color: '#4f46e5', weight: 1.5, fillColor: '#6366f1', fillOpacity: 0.08 }} />
                    {filteredLocationItems.map((item) => (
                      <CircleMarker key={item.url} center={[item.lat, item.lng]} radius={6} pathOptions={{ color: item.mediaType === 'video' ? '#7c3aed' : '#4f46e5', weight: 2, fillColor: item.mediaType === 'video' ? '#a78bfa' : '#818cf8', fillOpacity: 0.9 }}>
                        <Popup>
                          {item.author && <p className="text-xs font-bold">@{item.author} · {item.mediaType === 'video' ? 'Video' : 'Foto'}{item.tagged ? ' · Tagged' : ''}</p>}
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-xs font-semibold">Abrir publicación</a>
                          {typeof item.distanceKm === 'number' && <p className="text-[11px]">a {item.distanceKm} km del centro</p>}
                        </Popup>
                      </CircleMarker>
                    ))}
                    <MapController center={markerPosition} />
                    <MapFitBounds bounds={mapBounds} />
                    <MapResizer />
                  </MapContainer>
                  <div className="absolute bottom-3 left-3 bg-slate-900/80 border border-slate-800 text-[10px] text-white px-2.5 py-1 rounded-full pointer-events-none flex items-center gap-1 backdrop-blur-sm shadow-md" style={{ zIndex: 500 }}>
                    <Info className="w-3 h-3 text-indigo-300" />
                    <span>Clic en el mapa o arrastrá el pin · el círculo es el radio de búsqueda</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs font-medium">
                  <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-xl focus-within:border-indigo-400">
                    <label htmlFor="lat-input" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Latitud (editable)</label>
                    <input id="lat-input" type="text" inputMode="decimal" value={latInput} onChange={(e) => setLatInput(e.target.value)} onBlur={commitCoordinates} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="w-full bg-transparent border-none p-0 focus:ring-0 outline-none font-mono text-slate-700 font-semibold text-xs" />
                  </div>
                  <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-xl focus-within:border-indigo-400 flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <label htmlFor="lng-input" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Longitud (editable)</label>
                      <input id="lng-input" type="text" inputMode="decimal" value={lngInput} onChange={(e) => setLngInput(e.target.value)} onBlur={commitCoordinates} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="w-full bg-transparent border-none p-0 focus:ring-0 outline-none font-mono text-slate-700 font-semibold text-xs" />
                    </div>
                    <button onClick={() => void copyCoordinates()} title="Copiar coordenadas" aria-label="Copiar coordenadas" className="text-slate-400 hover:text-indigo-600 mt-3 shrink-0"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                <AnimatePresence>
                  {locationStatus !== 'idle' && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} aria-live="polite">
                      {locationStatus === 'loading' && <ProgressBar progress={locationProgress} label="Actualizando mapa…" />}
                      {locationStatus === 'success' && (
                        <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium">
                          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /><span>Ubicación detectada correctamente. Lat/Lng establecidas.</span>
                        </div>
                      )}
                      {locationStatus === 'error' && (
                        <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-xs text-red-800 font-medium animate-shake" role="alert">
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" /><span>{locationError}</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label htmlFor="radius-input" className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"><span>Radio de búsqueda</span><span className="text-indigo-600 font-mono normal-case">{radiusKm} km</span></label>
                    <input id="radius-input" type="range" min={1} max={25} step={1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-full accent-indigo-600" />
                    <div className="flex justify-between text-[10px] text-slate-400"><span>1 km</span><span>25 km</span></div>
                  </div>
                  <div>
                    <label htmlFor="limit-input" className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"><span>Límite de publicaciones</span><span className="text-indigo-600 font-mono normal-case">{limit}</span></label>
                    <input id="limit-input" type="range" min={1} max={50} step={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-indigo-600" />
                    <div className="flex justify-between text-[10px] text-slate-400"><span>1</span><span>50 por lote</span></div>
                  </div>
                </div>

                {/* Descubrimiento: usuarios por ubicación + fotos/videos tagged */}
                <div className="p-4 bg-indigo-50/40 border border-indigo-100/70 rounded-xl space-y-3">
                  <h3 className="font-bold text-slate-800 flex items-center gap-1.5 text-[13px]"><Users className="w-4 h-4 text-indigo-500" /> Usuarios por ubicación · fotos y videos tagged</h3>
                  <div className="relative">
                    <AtSign className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text" value={locationUserQuery} onChange={(e) => setLocationUserQuery(e.target.value)}
                      placeholder="Buscar usuarios por @nombre (filtra en vivo)…"
                      aria-label="Buscar usuarios por nombre en esta ubicación"
                      className="w-full p-2.5 pl-9 pr-8 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-xs text-slate-800 bg-white"
                    />
                    {locationUserQuery && (
                      <button onClick={() => setLocationUserQuery('')} aria-label="Limpiar búsqueda de usuarios" className="absolute right-2 top-2.5 text-slate-300 hover:text-slate-500"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex bg-white border border-slate-200 rounded-lg p-0.5" role="group" aria-label="Tipo de medio">
                      {([['all', 'Todos', null], ['photo', 'Fotos', Camera], ['video', 'Videos', VideoIcon]] as const).map(([id, label, Icon]) => (
                        <button
                          key={id} type="button" onClick={() => setLocationMediaFilter(id)} aria-pressed={locationMediaFilter === id}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${locationMediaFilter === id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                          {Icon && <Icon className="w-3 h-3" />} {label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-2 cursor-pointer select-none">
                      <input type="checkbox" checked={locationTaggedOnly} onChange={(e) => setLocationTaggedOnly(e.target.checked)} className="accent-indigo-600 w-3.5 h-3.5" />
                      <MapPin className="w-3 h-3 text-indigo-500" /> Solo tagged en el lugar
                    </label>
                    {locationDownloadedItems.length > 0 && (
                      <span className="text-[11px] text-slate-400">{filteredLocationItems.length} de {locationDownloadedItems.length} publicaciones · {locationUsers.length} usuarios</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">Los filtros se aplican al buscar y también en vivo sobre lo ya recopilado. Desde cada usuario podés abrir su perfil en la pestaña “Por Usuario”.</p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl text-xs text-slate-600 space-y-2.5 leading-relaxed">
                  <h3 className="font-bold text-slate-800 flex items-center gap-1.5 text-[13px]"><Compass className="w-4 h-4 text-indigo-500" /> Funcionamiento del Orbe de Ubicación</h3>
                  <ul className="list-disc pl-4 space-y-1.5 text-slate-500">
                    <li>Escribí y elegí una sugerencia, usá «mi ubicación», o hacé clic / arrastrá el pin en el mapa.</li>
                    <li>Ajustá el radio con el círculo violeta y el límite de publicaciones por lote.</li>
                    <li>El lote extraerá hasta <span className="font-semibold text-slate-800">{limit} publicaciones</span> en un radio de <span className="font-semibold text-slate-800">{radiusKm} km</span> y las verás como puntos en el mapa.</li>
                  </ul>
                </div>

                <AnimatePresence>
                  {locationSubmitStatus !== 'idle' && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="space-y-3" aria-live="polite">
                      {locationSubmitStatus === 'loading' && <ProgressBar progress={locationSubmitProgress} label="Hugo procesando extracción por ubicación…" />}
                      {locationSubmitStatus === 'success' && (
                        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800">
                          <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">¡Comando enviado exitosamente!</p>
                            <p className="text-emerald-700/80">Se recopilaron {lastLocationCount} post(s) en {radiusKm} km de ({markerPosition.lat.toFixed(4)}, {markerPosition.lng.toFixed(4)}). Revisalos en el mapa y la lista.</p>
                          </div>
                        </div>
                      )}
                      {locationSubmitStatus === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-800" role="alert">
                          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5"><p className="font-semibold">Fallo en la Solicitud</p><p className="text-red-700/80">{locationSubmitError}</p></div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="pt-2">
                  {!API_CONFIGURED && <p role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">No hay un backend configurado. El mapa funciona, pero las búsquedas de usuarios y publicaciones de Instagram necesitan una API HTTPS real. No se muestran resultados simulados.</p>}
                  <button onClick={() => void handleLocationSubmit()} disabled={locationSubmitStatus === 'loading' || !API_CONFIGURED} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-xl font-medium hover:bg-slate-800 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-slate-900/15">
                    {locationSubmitStatus === 'loading' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Buscando en la zona…</>) : (<><Users className="w-4 h-4" /> Buscar usuarios y publicaciones en esta ubicación</>)}
                  </button>
                </div>

                {locationDownloadedItems.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                    <div className="bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-xl flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs text-indigo-950"><span className="font-semibold">{locationDownloadedItems.length} publicaciones</span> recopiladas.</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleLocationExport('csv')} className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-slate-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><FileText className="w-3.5 h-3.5" /> CSV</button>
                        <button onClick={() => handleLocationExport('json')} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><FileJson className="w-3.5 h-3.5" /> JSON</button>
                        <button onClick={() => setLocationDownloadedItems([])} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><Trash2 className="w-3.5 h-3.5" /> Vaciar</button>
                      </div>
                    </div>
                    {/* Usuarios encontrados en la ubicación */}
                    {locationUsers.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-indigo-500" /> Usuarios en esta ubicación ({locationUsers.length})</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {locationUsers.slice(0, 8).map((user) => (
                            <div key={user.username} className="flex items-center gap-2.5 p-2.5 bg-white border border-slate-100 rounded-xl">
                              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shrink-0">{user.username.charAt(0).toUpperCase()}</div>
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-slate-700 text-xs truncate">@{user.username}</p>
                                <p className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                                  <span className="flex items-center gap-0.5"><Camera className="w-2.5 h-2.5" /> {user.photos}</span>
                                  <span className="flex items-center gap-0.5"><VideoIcon className="w-2.5 h-2.5" /> {user.videos}</span>
                                  <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {user.tagged} tagged</span>
                                  <span>· a {user.nearestKm} km</span>
                                </p>
                              </div>
                              <div className="flex flex-col gap-1 shrink-0">
                                <button onClick={() => { setActiveView('user'); void handleUserSearch(user.username); }} className="text-[10px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded-md transition">Perfil</button>
                                <button onClick={() => setLocationUserQuery(user.username)} className="text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-500 px-2 py-1 rounded-md transition">Filtrar</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {filteredLocationItems.length === 0 ? (
                      <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-xl p-3.5">Ninguna publicación coincide con los filtros actuales (usuario, tipo o solo tagged). Probá ampliarlos o quitar el texto de búsqueda.</p>
                    ) : (
                      <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {filteredLocationItems.map((item) => (
                          <li key={item.url} className="flex items-center gap-2.5 p-2.5 bg-white border border-slate-100 rounded-xl text-xs">
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.mediaType === 'video' ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'}`} title={item.mediaType === 'video' ? 'Video' : 'Foto'}>
                              {item.mediaType === 'video' ? <VideoIcon className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 flex-wrap">
                                {item.author && <button onClick={() => { setActiveView('user'); void handleUserSearch(item.author); }} className="font-bold text-indigo-700 hover:underline">@{item.author}</button>}
                                {item.tagged && <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded"><MapPin className="w-2.5 h-2.5" /> Tagged</span>}
                                {typeof item.likes === 'number' && <span className="text-[10px] text-slate-300">♥ {item.likes.toLocaleString('es')}</span>}
                              </p>
                              <a href={item.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-slate-500 hover:text-indigo-700 hover:underline truncate block">{item.url}</a>
                              <p className="text-[10px] text-slate-400 truncate">{item.caption ? `${item.caption} · ` : ''}{item.lat.toFixed(5)}, {item.lng.toFixed(5)}{typeof item.distanceKm === 'number' ? ` · a ${item.distanceKm} km` : ''}{typeof item.daysAgo === 'number' ? ` · hace ${item.daysAgo} d` : ''}</p>
                            </div>
                            <button onClick={() => { setMarkerPosition({ lat: item.lat, lng: item.lng }); setMapBounds(null); }} className="text-[10px] font-semibold text-slate-500 hover:text-indigo-600 bg-slate-50 px-2 py-1 rounded-lg shrink-0">Ver</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeView === 'user' && (
              <motion.div key="user-view" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }} className="space-y-5" id="view-user-container">
                <div>
                  <label htmlFor="username-input" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Usuario de Instagram</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text" id="username-input" value={usernameInput} autoComplete="off" spellCheck={false}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleUserSearch(); }}
                        placeholder="@usuario o instagram.com/usuario"
                        className="w-full p-3.5 pl-10 pr-9 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50 transition"
                        aria-describedby="username-help"
                      />
                      <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-4" />
                      {usernameInput && (
                        <button onClick={() => { setUsernameInput(''); setUserProfile(null); setUserStatus('idle'); setUserError(null); }} aria-label="Limpiar usuario" className="absolute right-2.5 top-3.5 text-slate-300 hover:text-slate-500 p-0.5"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                    <button onClick={() => void handleUserSearch()} disabled={userStatus === 'loading' || !usernameInput.trim()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 sm:px-5 rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-600/25 transition flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      {userStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} <span className="hidden sm:inline">Buscar</span>
                    </button>
                  </div>
                  <p id="username-help" className="text-[11px] text-slate-400 mt-1.5">Solo perfiles públicos, sin iniciar sesión. Trae datos del perfil y hasta 12 publicaciones recientes (si Instagram las expone).</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">Perfil destacado</p>
                    <p className="text-sm font-bold text-slate-800">@pao.arandaok</p>
                    <p className="text-[11px] text-slate-500">Solo se mostrarán datos públicos verificables.</p>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <button onClick={() => void handleUserSearch('pao.arandaok')} disabled={userStatus === 'loading'} className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg disabled:opacity-40">Consultar perfil</button>
                    <a href="https://www.instagram.com/pao.arandaok/" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold border border-indigo-200 text-indigo-700 bg-white px-3 py-2 rounded-lg hover:bg-indigo-50">Abrir Instagram ↗</a>
                  </div>
                </div>

                {recentUsers.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1"><History className="w-3 h-3" /> Recientes:</span>
                    {recentUsers.map((u) => (
                      <button key={u} onClick={() => void handleUserSearch(u)} className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-full transition">@{u}</button>
                    ))}
                    <button onClick={() => { setRecentUsers([]); try { localStorage.removeItem('instatool.recentUsers.v1'); } catch { /* noop */ } }} className="text-[11px] font-medium text-slate-300 hover:text-red-500 px-1 transition">Borrar</button>
                  </div>
                )}

                {userStatus === 'loading' && <ProgressBar progress={userProgress} label={`Buscando el perfil público de ${usernameInput || 'usuario'}…`} />}

                {userStatus === 'error' && userError && (
                  <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-800" role="alert">
                    <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    <div className="space-y-0.5"><p className="font-semibold">No se pudo buscar el usuario</p><p className="text-red-700/80">{userError}</p></div>
                  </div>
                )}

                {userStatus === 'idle' && !userProfile && (
                  <div className="p-6 border border-dashed border-slate-200 rounded-2xl text-center space-y-2">
                    <AtSign className="w-6 h-6 text-slate-300 mx-auto" />
                    <p className="text-xs font-semibold text-slate-500">Buscá un usuario para ver su perfil público</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">Desde ahí podés descargar sus publicaciones recientes o mandarlas todas a la cola de descargas.</p>
                  </div>
                )}

                {userProfile?.blocked && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-amber-50 border border-amber-200/70 rounded-2xl space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold text-lg shrink-0">{userProfile.username.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">@{userProfile.username} <Lock className="w-3.5 h-3.5 text-amber-500" /></p>
                        <p className="text-xs text-amber-800/80 leading-relaxed mt-0.5">{userProfile.reason}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <a href={userProfile.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition">Abrir perfil <ExternalLink className="w-3.5 h-3.5" /></a>
                      <button onClick={() => setActiveView('download')} className="flex items-center gap-1.5 bg-white border border-amber-200 hover:bg-amber-100/50 text-amber-800 px-3.5 py-2 rounded-lg text-xs font-semibold transition"><Download className="w-3.5 h-3.5" /> Ir a pegar enlaces</button>
                    </div>
                  </motion.div>
                )}

                {userProfile && !userProfile.blocked && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                    <div className="p-4 bg-slate-50/70 border border-slate-100 rounded-2xl space-y-3">
                      <div className="flex items-start gap-3.5">
                        <div className="relative w-16 h-16 shrink-0">
                          <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-2xl">{userProfile.username.charAt(0).toUpperCase()}</div>
                          {userProfile.avatarUrl && !avatarBroken && (
                            <img src={userProfile.avatarUrl} alt={`Foto de perfil de @${userProfile.username}`} className="absolute inset-0 w-16 h-16 rounded-full object-cover border border-white shadow-sm" onError={() => setAvatarBroken(true)} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-bold text-slate-900 text-[15px] flex items-center gap-1.5 flex-wrap">
                            {userProfile.fullName || `@${userProfile.username}`}
                            {userProfile.isVerified && <BadgeCheck className="w-4 h-4 text-indigo-500" aria-label="Cuenta verificada" />}
                            {userProfile.isPrivate && <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded"><Lock className="w-2.5 h-2.5" /> Privada</span>}
                          </p>
                          <p className="text-xs text-slate-400 font-mono">@{userProfile.username}</p>
                          {userProfile.biography && <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{userProfile.biography}</p>}
                        </div>
                        <a href={userProfile.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0">Abrir <ExternalLink className="w-3 h-3" /></a>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {([['Publicaciones', userProfile.counts.posts], ['Seguidores', userProfile.counts.followers], ['Seguidos', userProfile.counts.following]] as const).map(([label, value]) => (
                          <div key={label} className="bg-white border border-slate-100 rounded-xl py-2.5">
                            <p className="font-bold text-slate-800 text-sm">{formatCount(value)}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {userProfile.isPrivate && userProfile.posts.length === 0 && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 shrink-0" /> Es una cuenta privada: no se listan sus publicaciones.</p>
                      )}
                    </div>

                    {userProfile.posts.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">Publicaciones recientes ({userProfile.posts.length})</h3>
                          <button onClick={() => addPostsToQueue(userProfile.posts)} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><Plus className="w-3.5 h-3.5" /> Agregar todas a la cola</button>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {userProfile.posts.map((post) => (
                            <div key={post.shortcode} className="group relative rounded-xl overflow-hidden border border-slate-100 bg-slate-100">
                              <a href={post.url} target="_blank" rel="noreferrer" aria-label={`Abrir publicación ${post.shortcode}`}>
                                <img src={post.thumbnailUrl} alt="" loading="lazy" className="w-full aspect-square object-cover group-hover:scale-105 transition duration-300" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                              </a>
                              {post.isVideo && <span className="absolute top-1.5 right-1.5 bg-slate-900/70 text-white p-1 rounded-full pointer-events-none"><Play className="w-2.5 h-2.5" /></span>}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/80 to-transparent p-1.5 pt-5 flex gap-1 justify-end">
                                <button onClick={() => void handleDownloadMedia(post.url)} disabled={Boolean(downloadingMedia[post.url])} className="flex items-center gap-1 bg-white/95 hover:bg-white text-slate-800 px-2 py-1 rounded-md text-[10px] font-bold transition disabled:opacity-50" title="Descargar esta publicación" aria-label={`Descargar ${post.shortcode}`}>{downloadingMedia[post.url] ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />} Bajar</button>
                                <button onClick={() => addPostsToQueue([post])} className="flex items-center gap-0.5 bg-indigo-600/95 hover:bg-indigo-600 text-white px-2 py-1 rounded-md text-[10px] font-bold transition" title="Agregar a la cola de descarga" aria-label={`Agregar ${post.shortcode} a la cola`}><Plus className="w-3 h-3" /> Cola</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      !userProfile.isPrivate && (
                        <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-xl p-3.5 leading-relaxed">Instagram no expuso publicaciones recientes de este perfil en su HTML público. Abrí el perfil, copiá los enlaces de las publicaciones y pegalos en la pestaña de descargas.</p>
                      )
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-4 text-center max-w-3xl leading-relaxed">
        Descarga solo de publicaciones públicas (foto o video), sin iniciar sesión. Si Instagram pide login para una publicación, esa descarga se omite y queda registrada en el manifiesto del ZIP. Descargá solo contenido que tengas derecho a guardar.
      </p>
    </div>
  );
}

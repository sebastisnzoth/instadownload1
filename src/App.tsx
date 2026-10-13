/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import {
  parseInstagramUrl,
  extractInstagramUrls,
  isValidInstagramUrl,
  downloadTextFile,
  downloadMediaFile,
  downloadBatchZip,
  toCsv,
  KIND_LABEL,
  type InstagramKind,
} from './lib/instagram';

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
interface LocationItem { url: string; lat: number; lng: number; distanceKm?: number }
interface Suggestion { display_name: string; lat: string; lon: string }

export default function App() {
  const [activeView, setActiveView] = useState<'download' | 'location'>('download');

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
  const [locationSubmitStatus, setLocationSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationSubmitProgress, setLocationSubmitProgress] = useState(0);
  const [locationSubmitError, setLocationSubmitError] = useState<string | null>(null);
  const [locationDownloadedItems, setLocationDownloadedItems] = useState<LocationItem[]>([]);
  const [lastLocationCount, setLastLocationCount] = useState(0);
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
        const response = await fetch('/api/validate-urls', {
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
      const response = await fetch('/api/download', {
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
        toCsv([['URL', 'Latitud', 'Longitud', 'DistanciaKm'], ...locationDownloadedItems.map((i) => [i.url, String(i.lat), String(i.lng), String(i.distanceKm ?? '')])]),
        'text/csv;charset=utf-8'
      );
    }
  };

  // --- Handlers: ubicación ---
  const fetchSuggestions = async (query: string): Promise<Suggestion[]> => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'es,en' } }
    );
    if (!response.ok) throw new Error(`Geocoding ${response.status}`);
    return (await response.json()) as Suggestion[];
  };

  // Autocompletado en vivo con debounce (no dispara al elegir una sugerencia)
  useEffect(() => {
    if (suppressSearchRef.current) { suppressSearchRef.current = false; return; }
    const q = locationQuery.trim();
    if (q.length < 3) { setSuggestions([]); setIsDropdownOpen(false); return; }
    setIsSearchingPlaces(true);
    const timer = setTimeout(async () => {
      try {
        const data = await fetchSuggestions(q);
        setSuggestions(data);
        setIsDropdownOpen(data.length > 0);
      } catch { /* silencioso: el botón Buscar reporta el error */ }
      finally { setIsSearchingPlaces(false); }
    }, 450);
    return () => clearTimeout(timer);
  }, [locationQuery]);

  const handleLocationSearch = async () => {
    if (!locationQuery.trim()) return;
    setLocationStatus('loading');
    setLocationProgress(15);
    setLocationError(null);
    try {
      const data = await fetchSuggestions(locationQuery.trim());
      setLocationProgress(60);
      if (data.length === 0) {
        setLocationStatus('error');
        setLocationError('No se encontraron resultados para la ubicación especificada.');
        return;
      }
      setSuggestions(data);
      setIsDropdownOpen(true);
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('bad-coords');
      setMarkerPosition({ lat, lng });
      setLocationStatus('success');
      setLocationProgress(100);
    } catch {
      setLocationStatus('error');
      setLocationError('Error al consultar el servicio de geolocalización. Probá de nuevo.');
    }
  };

  const selectSuggestion = (item: Suggestion) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    suppressSearchRef.current = true;
    setMarkerPosition({ lat, lng });
    setLocationQuery(item.display_name);
    setIsDropdownOpen(false);
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
      const response = await fetch('/api/download-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: markerPosition.lat, lng: markerPosition.lng, limit, radiusKm }),
      });
      setLocationSubmitProgress(80);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ocurrió un error al procesar la extracción geográfica.');
      const items: LocationItem[] = data.items ?? [];
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
                        <button onClick={() => setDownloadedItems([])} className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"><Trash2 className="w-3.5 h-3.5" /> Vaciar</button>
                      </div>
                    </div>
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {downloadedItems.map((item) => (
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
                <div className="space-y-1.5 relative" ref={searchBoxRef}>
                  <label htmlFor="location-search-input" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Buscar Ubicación / Ciudad</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text" id="location-search-input" value={locationQuery} autoComplete="off"
                        onChange={(e) => setLocationQuery(e.target.value)}
                        onFocus={() => { if (suggestions.length > 0) setIsDropdownOpen(true); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { if (isDropdownOpen && suggestions[0]) selectSuggestion(suggestions[0]); else void handleLocationSearch(); }
                          if (e.key === 'Escape') setIsDropdownOpen(false);
                        }}
                        placeholder="Escribe un lugar (ej: París, Santiago…) — sugiere mientras escribís"
                        className="w-full p-3.5 pl-10 pr-9 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50 transition duration-150"
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-4" />
                      {isSearchingPlaces && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin absolute right-3 top-4" />}
                    </div>
                    <button onClick={() => void handleLocationSearch()} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 sm:px-5 rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-600/25 transition cursor-pointer flex items-center justify-center gap-1.5">
                      <Search className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Buscar</span>
                    </button>
                    <button onClick={handleUseMyLocation} title="Usar mi ubicación" aria-label="Usar mi ubicación" className="bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 text-slate-500 px-3.5 rounded-xl transition cursor-pointer flex items-center justify-center">
                      <LocateFixed className="w-4 h-4" />
                    </button>
                  </div>

                  <AnimatePresence>
                    {isDropdownOpen && suggestions.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="absolute w-full bg-white border border-slate-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto divide-y divide-slate-100" style={{ zIndex: 1000 }} id="search-suggestions-panel">
                        <div className="p-2.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                          <span>Resultados encontrados</span>
                          <button onClick={() => setIsDropdownOpen(false)} aria-label="Cerrar sugerencias"><X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" /></button>
                        </div>
                        {suggestions.map((item, index) => (
                          <button key={`${item.lat}-${item.lon}-${index}`} onClick={() => selectSuggestion(item)} className="w-full text-left p-3 hover:bg-slate-50 transition text-xs text-slate-700 flex items-start gap-2.5 leading-relaxed">
                            <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                            <span className="truncate flex-1">{item.display_name}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 self-center" />
                          </button>
                        ))}
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
                    {locationDownloadedItems.map((item) => (
                      <CircleMarker key={item.url} center={[item.lat, item.lng]} radius={6} pathOptions={{ color: '#4f46e5', weight: 2, fillColor: '#818cf8', fillOpacity: 0.9 }}>
                        <Popup>
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-xs font-semibold">Abrir publicación</a>
                          {typeof item.distanceKm === 'number' && <p className="text-[11px]">a {item.distanceKm} km del centro</p>}
                        </Popup>
                      </CircleMarker>
                    ))}
                    <MapController center={markerPosition} />
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
                  <button onClick={() => void handleLocationSubmit()} disabled={locationSubmitStatus === 'loading'} className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-xl font-medium hover:bg-slate-800 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-slate-900/15">
                    {locationSubmitStatus === 'loading' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Procesando extracción…</>) : (<><Download className="w-4 h-4" /> Descargar publicaciones por Ubicación</>)}
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
                    <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {locationDownloadedItems.map((item) => (
                        <li key={item.url} className="flex items-center gap-2.5 p-2.5 bg-white border border-slate-100 rounded-xl text-xs">
                          <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <a href={item.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-indigo-700 hover:underline truncate block">{item.url}</a>
                            <p className="text-[10px] text-slate-400 font-mono">{item.lat.toFixed(5)}, {item.lng.toFixed(5)}{typeof item.distanceKm === 'number' ? ` · a ${item.distanceKm} km` : ''}</p>
                          </div>
                          <button onClick={() => setMarkerPosition({ lat: item.lat, lng: item.lng })} className="text-[10px] font-semibold text-slate-500 hover:text-indigo-600 bg-slate-50 px-2 py-1 rounded-lg shrink-0">Ver</button>
                        </li>
                      ))}
                    </ul>
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

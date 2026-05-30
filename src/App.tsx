/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
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
  Map,
  X,
  Compass,
  Link,
  ChevronRight,
  Info
} from 'lucide-react';

// Flawless standard Leaflet pin icon setup to prevent broken asset paths
const customMarkerIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Capture lat/lng of manual map clicks
function MapClickHandler({ onClick }: { onClick: (latlng: { lat: number, lng: number }) => void }) {
  useMapEvents({
    click: (e) => {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Seamlessly update map view when the coordinates state changes
function MapController({ center }: { center: { lat: number, lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom());
  }, [center, map]);
  return null;
}

// Invalidate size to cure leaflet's partial-rendering bug inside reactive/flex containers
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

// Consistent Instagram Regex literal
const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv|stories)\/([a-zA-Z0-9_-]+)/i;

export default function App() {
  // Navigation
  const [activeView, setActiveView] = useState<'download' | 'location'>('download');

  // --- Download State ---
  const [rawUrlInput, setRawUrlInput] = useState('');
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadedItems, setDownloadedItems] = useState<string[]>([]);

  // --- Location Search State ---
  const [locationQuery, setLocationQuery] = useState('Buenos Aires');
  const [limit, setLimit] = useState(1000);
  const [markerPosition, setMarkerPosition] = useState({ lat: -34.6090264, lng: -58.3732215 });
  
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationProgress, setLocationProgress] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // --- Location Submit State ---
  const [locationSubmitStatus, setLocationSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationSubmitProgress, setLocationSubmitProgress] = useState(0);
  const [locationSubmitError, setLocationSubmitError] = useState<string | null>(null);
  const [locationDownloadedItems, setLocationDownloadedItems] = useState<{lat: number, lng: number, url: string}[]>([]);

  // --- URL Validation State ---
  const [urlValidation, setUrlValidation] = useState<Record<string, { isValid: boolean, isPublic: boolean, isLoading: boolean }>>({});

  // Sync download textarea with individual URL chunks
  useEffect(() => {
    const urls = rawUrlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u !== '');
    setPendingUrls(urls);
  }, [rawUrlInput]);

  // URL Real-time Validation Engine
  useEffect(() => {
    const validateUrls = async () => {
      // Filter out invalid syntax
      const validSyntaxUrls = pendingUrls.filter(u => INSTAGRAM_REGEX.test(u));
      const urlsToValidate = validSyntaxUrls.filter(url => !urlValidation[url]);
      
      if (urlsToValidate.length === 0) return;
      
      // Mark as validating
      setUrlValidation(prev => {
        const next = { ...prev };
        urlsToValidate.forEach(u => next[u] = { isValid: true, isPublic: true, isLoading: true });
        return next;
      });

      try {
        const response = await fetch('/api/validate-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlsToValidate }),
        });
        
        if (response.ok) {
          const { results } = await response.json();
          setUrlValidation(prev => {
             const next = { ...prev };
             results.forEach((r: any) => {
               next[r.url] = { isValid: r.isValid, isPublic: r.isPublic, isLoading: false };
             });
             return next;
          });
        } else {
          throw new Error('Validation API Error');
        }
      } catch (error) {
        console.error('Validation error:', error);
        // Clean up loading state smoothly without interrupting the main UX
        setUrlValidation(prev => {
             const next = { ...prev };
             urlsToValidate.forEach(u => {
                 if (next[u]) next[u].isLoading = false;
             });
             return next;
        });
      }
    };
    
    // Debounce to respect server loading capacity
    const timer = setTimeout(() => {
      validateUrls();
    }, 800);
    
    return () => clearTimeout(timer);
  }, [pendingUrls, urlValidation]);

  // Trigger real-time visual preview for singular valid Instagram links
  useEffect(() => {
    if (pendingUrls.length === 1) {
      const match = pendingUrls[0].match(INSTAGRAM_REGEX);
      if (match && match[1]) {
        setPreviewUrl(`https://www.instagram.com/p/${match[1]}/media/?size=t`);
        return;
      }
    }
    setPreviewUrl(null);
  }, [pendingUrls]);

  // Auto-increment progress during loading states
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (downloadStatus === 'loading') {
      intervalId = setInterval(() => {
        setDownloadProgress((prev) => (prev >= 92 ? 92 : prev + 4));
      }, 150);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [downloadStatus]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (locationStatus === 'loading') {
      intervalId = setInterval(() => {
        setLocationProgress((prev) => (prev >= 90 ? 90 : prev + 6));
      }, 120);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [locationStatus]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (locationSubmitStatus === 'loading') {
      intervalId = setInterval(() => {
        setLocationSubmitProgress((prev) => (prev >= 95 ? 95 : prev + 3));
      }, 180);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [locationSubmitStatus]);

  // --- Download handlers ---
  const removeUrl = (index: number) => {
    const updatedUrls = pendingUrls.filter((_, i) => i !== index);
    setPendingUrls(updatedUrls);
    setRawUrlInput(updatedUrls.join('\n'));
  };

  const handleDownload = async () => {
    if (pendingUrls.length === 0) return;
    
    // Strict URL validation
    const invalidUrls = pendingUrls.filter(u => !INSTAGRAM_REGEX.test(u));
    if (invalidUrls.length > 0) {
      setDownloadStatus('error');
      setDownloadError(`Detectamos ${invalidUrls.length} enlace(s) inválidos de Instagram.`);
      return;
    }
    
    setDownloadStatus('loading');
    setDownloadProgress(20);
    setDownloadError(null);

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ urls: pendingUrls, startDate, endDate }),
      });
      
      setDownloadProgress(80);

      if (response.ok) {
        setDownloadStatus('success');
        setDownloadProgress(100);
        setDownloadedItems(prev => [...prev, ...pendingUrls]);
        // Leave message visible, clean raw inputs
        setRawUrlInput('');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Download error:', errorData);
        setDownloadStatus('error');
        setDownloadError(errorData.error || 'Ocurrió un error al procesar el lote en el servidor.');
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setDownloadStatus('error');
      setDownloadError('Error de red. No se pudo establecer conexión con el servidor.');
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
    let dataStr = "";
    let fileName = "";
    let mimeType = "";

    if (format === 'json') {
      dataStr = encodeURIComponent(JSON.stringify(downloadedItems, null, 2));
      mimeType = "text/json;charset=utf-8";
      fileName = "instagram_downloaded_items.json";
    } else if (format === 'csv') {
      const csvContent = "URL\n" + downloadedItems.map(item => `"${item}"`).join("\n");
      dataStr = encodeURIComponent(csvContent);
      mimeType = "text/csv;charset=utf-8";
      fileName = "instagram_downloaded_items.csv";
    }

    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", `data:${mimeType},${dataStr}`);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleLocationExport = (format: 'json' | 'csv') => {
    let dataStr = "";
    let fileName = "";
    let mimeType = "";

    if (format === 'json') {
      dataStr = encodeURIComponent(JSON.stringify(locationDownloadedItems, null, 2));
      mimeType = "text/json;charset=utf-8";
      fileName = "instagram_location_items.json";
    } else if (format === 'csv') {
      const csvContent = "URL,Latitud,Longitud\n" + locationDownloadedItems.map(item => `"${item.url}",${item.lat},${item.lng}`).join("\n");
      dataStr = encodeURIComponent(csvContent);
      mimeType = "text/csv;charset=utf-8";
      fileName = "instagram_location_items.csv";
    }

    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", `data:${mimeType},${dataStr}`);
    downloadAnchor.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // --- Location Search Handlers ---
  const handleLocationSearch = async () => {
    if (!locationQuery.trim()) return;
    setLocationStatus('loading');
    setLocationProgress(15);
    setLocationError(null);
    setSuggestions([]);
    setIsDropdownOpen(false);

    try {
      // Pull multiple matches to build interactive search autocomplete selector
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationQuery)}&limit=5`, {
        headers: {
          'Accept-Language': 'es,en'
        }
      });
      setLocationProgress(60);

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          setSuggestions(data);
          setIsDropdownOpen(true);
          
          // Pre-select the direct match
          const first = data[0];
          const lat = parseFloat(first.lat);
          const lng = parseFloat(first.lon);
          
          if (!isNaN(lat) && !isNaN(lng)) {
            setMarkerPosition({ lat, lng });
            setLocationStatus('success');
            setLocationProgress(100);
          } else {
            setLocationStatus('error');
            setLocationError('Los datos geoespaciales devueltos son incorrectos.');
          }
        } else {
          setLocationStatus('error');
          setLocationError('No se encontraron resultados para la ubicación especificada.');
        }
      } else {
        setLocationStatus('error');
        setLocationError(`Error del servidor de geolocalización (${response.status})`);
      }
    } catch (e) {
      console.error('Geolocation search error:', e);
      setLocationStatus('error');
      setLocationError('Error de red al consultar el mapa de geolocalización.');
    }
  };

  // Click handler to select and center on a suggested match
  const selectSuggestion = (item: any) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      setMarkerPosition({ lat, lng });
      setLocationQuery(item.display_name);
      setIsDropdownOpen(false);
      setLocationStatus('success');
      setLocationProgress(100);
    }
  };

  // Advanced feature: reverse-geocode clicks directly on the map so the text input resets dynamically!
  const handleReverseGeocode = async (lat: number, lng: number) => {
    setLocationStatus('loading');
    setLocationProgress(30);
    setLocationError(null);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
        headers: {
          'Accept-Language': 'es,en'
        }
      });
      setLocationProgress(80);
      if (response.ok) {
        const data = await response.json();
        if (data && data.display_name) {
          setLocationQuery(data.display_name);
          setLocationStatus('success');
          setLocationProgress(100);
        } else {
          setLocationStatus('success');
          setLocationProgress(100);
        }
      } else {
        setLocationStatus('success'); // Still keep the coordinates updated even if reverse search is quiet
        setLocationProgress(100);
      }
    } catch (e) {
      console.error('Reverse matching error:', e);
      setLocationStatus('success');
      setLocationProgress(100);
    }
  };

  const handleLocationSubmit = async () => {
    setLocationSubmitStatus('loading');
    setLocationSubmitProgress(20);
    setLocationSubmitError(null);

    try {
      const response = await fetch('/api/download-location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          lat: markerPosition.lat, 
          lng: markerPosition.lng, 
          limit 
        }),
      });
      
      setLocationSubmitProgress(80);

      if (response.ok) {
        const data = await response.json();
        if (data.items) setLocationDownloadedItems(prev => [...prev, ...data.items]);
        setLocationSubmitStatus('success');
        setLocationSubmitProgress(100);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Location download error:', errorData);
        setLocationSubmitStatus('error');
        setLocationSubmitError(errorData.error || 'Ocurrió un error al procesar la extracción geográfica.');
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setLocationSubmitStatus('error');
      setLocationSubmitError('Error de red al conectar con el servidor.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 font-sans select-none antialiased selection:bg-indigo-100 selection:text-indigo-900">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-100 shadow-xl overflow-hidden shadow-slate-100/50 flex flex-col">
        
        {/* Sleek Slate Header */}
        <div className="p-6 bg-slate-900 text-white relative overflow-hidden">
          {/* Accent decoration */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-6 -mt-6"></div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <Compass className="w-5 h-5 text-indigo-100 animate-spin-slow" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">InstaTool Suite</h1>
                <p className="text-xs text-slate-400">Herramienta estratégica para profesionales</p>
              </div>
            </div>
            
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-[10px] uppercase font-semibold tracking-wider text-emerald-400 border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Hugo Activo
            </span>
          </div>
        </div>

        {/* Elegant Animated Tabs Selector */}
        <div className="flex border-b border-slate-100 bg-slate-50 p-1.5 gap-2">
          <button
            onClick={() => setActiveView('download')}
            id="tab-download"
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeView === 'download' 
                ? 'bg-white text-slate-900 shadow-sm border border-slate-100' 
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Download className="w-4 h-4" />
            Descarga de Lotes (Instagram)
          </button>
          <button
            onClick={() => setActiveView('location')}
            id="tab-location"
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 ${
              activeView === 'location' 
                ? 'bg-white text-slate-900 shadow-sm border border-slate-100' 
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <MapPin className="w-4 h-4" />
            Mapa de Ubicación
          </button>
        </div>

        {/* Inner Content Area */}
        <div className="p-6 sm:p-8 flex-1">
          <AnimatePresence mode="wait">
            
            {/* View - Download Media */}
            {activeView === 'download' && (
              <motion.div
                key="download-view"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
                id="view-download-container"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Enlaces de Instagram (Uno por línea)
                  </label>
                  <div className="relative">
                    <textarea
                      id="input-urls"
                      className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none text-sm text-slate-800 placeholder:text-slate-400 bg-slate-50/50 transition duration-150 min-h-[110px]"
                      placeholder="https://www.instagram.com/p/CnM9B21S2-b/&#10;https://www.instagram.com/reel/C3m8hP8M_1H/"
                      value={rawUrlInput}
                      onChange={(e) => setRawUrlInput(e.target.value)}
                      rows={4}
                    />
                    <div className="absolute top-3 right-3 text-slate-400 pointer-events-none">
                      <Link className="w-4 h-4 opacity-50" />
                    </div>
                  </div>
                </div>

                {/* Queue list component */}
                {pendingUrls.length > 0 && (
                  <div className="space-y-2 border border-slate-100 p-4 rounded-xl bg-slate-50/50 max-h-48 overflow-y-auto">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Enlaces en Cola ({pendingUrls.length})</span>
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">Lote listo</span>
                    </div>
                    <div className="space-y-1.5 pt-1.5">
                      {pendingUrls.map((url, index) => {
                        const validation = urlValidation[url];
                        const isValidating = validation?.isLoading;
                        const hasNetworkError = validation && !validation.isValid;
                        const isSyntaxInvalid = !INSTAGRAM_REGEX.test(url);
                        const hasError = hasNetworkError || isSyntaxInvalid;

                        return (
                          <div key={index} className={`flex items-center justify-between p-2 bg-white border ${hasError ? 'border-red-200 bg-red-50/50' : 'border-slate-100'} rounded-lg text-xs transition duration-200`}>
                            <div className="flex items-center gap-2.5 w-10/12 overflow-hidden">
                                {isSyntaxInvalid ? (
                                  <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" title="Formato de enlace inválido" />
                                ) : isValidating ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" title="Validando enlace..." />
                                ) : hasError ? (
                                  <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" title="Enlace privado o inexistente" />
                                ) : validation ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" title="Enlace público válido" />
                                ) : (
                                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-200 border-dotted shrink-0" />
                                )}
                              <span className={`truncate font-mono text-[11px] ${hasError ? 'text-red-600 font-medium' : 'text-slate-600'}`}>{url}</span>
                            </div>
                            <button 
                              onClick={() => removeUrl(index)} 
                              className="bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded p-1 transition"
                              title="Remover enlace"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Warnings based on validation */}
                {pendingUrls.some(url => (!INSTAGRAM_REGEX.test(url)) || (urlValidation[url] && !urlValidation[url].isValid && !urlValidation[url].isLoading)) && (
                  <div className="p-3.5 bg-amber-50 border border-amber-200/60 rounded-xl text-xs text-amber-800 flex items-start gap-2.5">
                     <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                     <div className="leading-relaxed">
                       <strong className="font-bold">Advertencia de Validación:</strong> Algunos de los enlaces detectados presentan errores de formato o parecen inaccesibles (privados/eliminados). La descarga podría fallar o estar incompleta.
                     </div>
                  </div>
                )}

                {/* Live Preview Pane */}
                {previewUrl && (
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col items-center">
                    <div className="text-[11px] font-medium text-slate-500 mb-2 flex items-center gap-1.5 self-start">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                      Vista previa identificada
                    </div>
                    <img
                      src={previewUrl}
                      alt="Vista previa de Instagram"
                      className="w-full max-h-44 object-cover rounded-xl border border-slate-100 shadow-sm"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        setPreviewUrl(null);
                      }}
                    />
                  </div>
                )}

                {/* Date Range Filter */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Fecha Inicio (Opcional)
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Fecha Fin (Opcional)
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50"
                    />
                  </div>
                </div>

                {/* Feedback Panel */}
                <AnimatePresence>
                  {downloadStatus !== 'idle' && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="space-y-3"
                    >
                      {/* Progress Bar inside alert */}
                      {downloadStatus === 'loading' && (
                        <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-indigo-800 font-medium flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Hugo está procesando la descarga...
                            </span>
                            <span className="text-indigo-600 font-mono font-semibold">{downloadProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${downloadProgress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}

                      {downloadStatus === 'success' && (
                        <motion.div 
                          layout
                          initial={{ height: 0, opacity: 0, scale: 0.95 }}
                          animate={{ height: "auto", opacity: 1, scale: 1 }}
                          exit={{ height: 0, opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.4, type: "spring", bounce: 0.3 }}
                          className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800 origin-top overflow-hidden"
                        >
                          <motion.div
                             initial={{ scale: 0, rotate: -45 }}
                             animate={{ scale: 1, rotate: 0 }}
                             transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 15 }}
                             className="shrink-0 mt-0.5"
                          >
                             <CheckCircle className="w-5 h-5 text-emerald-600" />
                          </motion.div>
                          <div className="space-y-0.5">
                            <p className="font-semibold text-sm">¡Lote enviado con éxito!</p>
                            <p className="text-emerald-700/80">Hugo ha coordinado la solicitud de descarga para {pendingUrls.length} publicaciones.</p>
                          </div>
                        </motion.div>
                      )}

                      {downloadStatus === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-800">
                          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">Fallo en la Solicitud</p>
                            <p className="text-red-700/80">{downloadError}</p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Dashboard Action Panel */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={clearDownloads}
                    className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 py-3 rounded-xl font-medium hover:bg-slate-200 hover:text-slate-900 transition-all text-xs"
                  >
                    <Trash2 className="w-4 h-4 opacity-75" />
                    Limpiar Todo
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={downloadStatus === 'loading' || pendingUrls.length === 0}
                    className="flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-800 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-slate-900/15"
                  >
                    {downloadStatus === 'loading' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Enviar lote a Hugo
                      </>
                    )}
                  </button>
                </div>

                {downloadedItems.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-xl flex items-center justify-between"
                  >
                    <div className="text-xs text-indigo-950">
                      <span className="font-semibold">{downloadedItems.length} publicaciones</span> registradas históricamente.
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleExport('csv')}
                        className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-slate-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        CSV
                      </button>
                      <button
                        onClick={() => handleExport('json')}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        JSON
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* View - Location Search with Map */}
            {activeView === 'location' && (
              <motion.div
                key="location-view"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
                id="view-location-container"
              >
                {/* Search Bar Input & Autocomplete Dropdown */}
                <div className="space-y-1.5 relative">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Buscar Ubicación / Ciudad en el Orbe
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="text" 
                        id="location-search-input"
                        value={locationQuery}
                        onChange={(e) => {
                          setLocationQuery(e.target.value);
                          setIsDropdownOpen(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleLocationSearch();
                          }
                        }}
                        placeholder="Escribe un lugar (ej: París, Santiago...) y presiona Enter"
                        className="w-full p-3.5 pl-10 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50 transition duration-150"
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-4" />
                    </div>
                    
                    <button 
                      onClick={handleLocationSearch}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 rounded-xl text-xs font-semibold hover:shadow-lg hover:shadow-indigo-600/25 transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Buscar
                    </button>
                  </div>

                  {/* Top-tier Autocomplete Suggestions list */}
                  <AnimatePresence>
                    {isDropdownOpen && suggestions.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-550 w-full bg-white border border-slate-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto divide-y divide-slate-100"
                        id="search-suggestions-panel"
                      >
                        <div className="p-2.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                          <span>Resultados encontrados</span>
                          <button onClick={() => setIsDropdownOpen(false)}>
                            <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
                          </button>
                        </div>
                        {suggestions.map((item, index) => (
                          <button
                            key={index}
                            onClick={() => selectSuggestion(item)}
                            className="w-full text-left p-3 hover:bg-slate-50 transition text-xs text-slate-700 flex items-start gap-2.5 leading-relaxed"
                          >
                            <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                            <span className="truncate flex-1">{item.display_name}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 self-center" />
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Leaflet Reactive Map Canvas */}
                <div className="w-full h-64 overflow-hidden rounded-2xl border border-slate-200/80 shadow-inner relative group bg-slate-100">
                  <MapContainer
                    center={[-34.6090264, -58.3732215]}
                    zoom={12}
                    zoomControl={true}
                    style={{ width: '100%', height: '100%', zIndex: 1 }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    
                    <MapClickHandler onClick={(latlng) => {
                      setMarkerPosition(latlng);
                      handleReverseGeocode(latlng.lat, latlng.lng);
                    }} />
                    
                    <Marker position={[markerPosition.lat, markerPosition.lng]} icon={customMarkerIcon} />
                    
                    <MapController center={markerPosition} />
                    
                    <MapResizer />
                  </MapContainer>
                  
                  {/* Map overlay hint */}
                  <div className="absolute bottom-3 left-3 bg-slate-900/80 border border-slate-800 text-[10px] text-white px-2.5 py-1 rounded-full pointer-events-none z-450 flex items-center gap-1 backdrop-blur-sm shadow-md">
                    <Info className="w-3 h-3 text-indigo-300" />
                    <span>Haz clic en el mapa para situar el PIN del lote</span>
                  </div>
                </div>

                {/* Coordinates grid readout */}
                <div className="grid grid-cols-2 gap-4 text-xs font-medium">
                  <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-xl">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">LATITUD (Y)</label>
                    <input 
                      type="text" 
                      readOnly 
                      value={markerPosition.lat.toFixed(7)} 
                      className="w-full bg-transparent border-none p-0 focus:ring-0 outline-none font-mono text-slate-700 font-semibold text-xs"
                    />
                  </div>
                  <div className="bg-slate-50 border border-slate-200/60 p-3 rounded-xl">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">LONGITUD (X)</label>
                    <input 
                      type="text" 
                      readOnly 
                      value={markerPosition.lng.toFixed(7)} 
                      className="w-full bg-transparent border-none p-0 focus:ring-0 outline-none font-mono text-slate-700 font-semibold text-xs"
                    />
                  </div>
                </div>

                {/* Status indicator specifically for Geolocation */}
                <AnimatePresence>
                  {locationStatus !== 'idle' && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                    >
                      {locationStatus === 'loading' && (
                        <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-indigo-800 font-medium">
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Actualizando mapa...
                          </span>
                          <span className="font-mono text-indigo-600">{locationProgress}%</span>
                        </div>
                      )}
                      
                      {locationStatus === 'success' && (
                        <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2 text-xs text-emerald-800 font-medium">
                          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Ubicación detectada correctamente. Lat/Lng establecidas.</span>
                        </div>
                      )}
                      
                      {locationStatus === 'error' && (
                        <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-xs text-red-800 font-medium animate-shake">
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                          <span>{locationError}</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Target limit & instruction segment */}
                <div className="space-y-4 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Límite Máximo de Recolección de Publicaciones
                    </label>
                    <input 
                      type="number"
                      value={limit}
                      onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value) || 0))}
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm text-slate-800 bg-slate-50/50"
                      min={1}
                    />
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200/60 rounded-xl text-xs text-slate-600 space-y-2.5 leading-relaxed">
                    <h3 className="font-bold text-slate-800 flex items-center gap-1.5 text-[13px]">
                      <Compass className="w-4 h-4 text-indigo-500" />
                      Funcionamiento del Orbe de Ubicación
                    </h3>
                    <p>Las coordenadas recopiladas te permiten enfocar la extracción geográfica:</p>
                    <ul className="list-disc pl-4 space-y-1.5 text-slate-500">
                      <li>Usa el buscador para mover la vista al lugar objetivo.</li>
                      <li>Haz clic preciso en cualquier punto del mapa para ajustar las coordenadas finamente.</li>
                      <li>El lote extraerá hasta un total de <span className="font-semibold text-slate-800">{limit} publicaciones</span> en el radio configurado.</li>
                    </ul>
                  </div>
                </div>

                {/* Submit Feedback */}
                <AnimatePresence>
                  {locationSubmitStatus !== 'idle' && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="space-y-3"
                    >
                      {locationSubmitStatus === 'loading' && (
                        <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-indigo-800 font-medium flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Hugo procesando extracción por ubicación...
                            </span>
                            <span className="text-indigo-600 font-mono font-semibold">{locationSubmitProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${locationSubmitProgress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}

                      {locationSubmitStatus === 'success' && (
                        <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-800">
                          <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">¡Comando enviado exitosamente!</p>
                            <p className="text-emerald-700/80">Hugo ha coordinado la solicitud de descarga de {limit} post(s) cerca de ({markerPosition.lat.toFixed(4)}, {markerPosition.lng.toFixed(4)}).</p>
                          </div>
                        </div>
                      )}

                      {locationSubmitStatus === 'error' && (
                        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-800">
                          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                          <div className="space-y-0.5">
                            <p className="font-semibold">Fallo en la Solicitud</p>
                            <p className="text-red-700/80">{locationSubmitError}</p>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submission actions */}
                <div className="pt-2">
                  <button
                    onClick={handleLocationSubmit}
                    disabled={locationSubmitStatus === 'loading'}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3.5 rounded-xl font-medium hover:bg-slate-800 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-slate-900/15"
                  >
                    {locationSubmitStatus === 'loading' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Procesando extracción...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Descargar publicaciones por Ubicación
                      </>
                    )}
                  </button>
                </div>

                {locationDownloadedItems.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-indigo-50/30 border border-indigo-100/50 p-4 rounded-xl flex items-center justify-between"
                  >
                    <div className="text-xs text-indigo-950">
                      <span className="font-semibold">{locationDownloadedItems.length} publicaciones</span> recopiladas.
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLocationExport('csv')}
                        className="flex items-center gap-1.5 bg-white border border-indigo-200 hover:bg-slate-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        CSV
                      </button>
                      <button
                        onClick={() => handleLocationExport('json')}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                        JSON
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}

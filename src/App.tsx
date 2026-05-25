/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

export default function App() {
  const [activeView, setActiveView] = useState<'download' | 'location'>('download');
  const [rawUrlInput, setRawUrlInput] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [downloadedItems, setDownloadedItems] = useState<string[]>([]);
  
  // Update preview URL when input changes
  useEffect(() => {
    const urls = rawUrlInput.split('\n').map(u => u.trim()).filter(u => u !== '');
    if (urls.length === 1) {
       const regex = /(https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[a-zA-Z0-9_-]+\/?)/;
       if (regex.test(urls[0])) {
         const idPart = urls[0].split('/')[4];
         setPreviewUrl(`https://www.instagram.com/p/${idPart}/media/?size=t`);
         return;
       }
    }
    setPreviewUrl(null);
  }, [rawUrlInput]);

  // Location search state
  const [location, setLocation] = useState('buenos aires');
  const [limit, setLimit] = useState(1000);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'loading') {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => (prev >= 95 ? 95 : prev + 5));
      }, 200);
    }
    return () => clearInterval(interval);
  }, [status]);

  const handleDownload = async () => {
    const urls = rawUrlInput.split('\n').map(u => u.trim()).filter(u => u !== '');
    if (urls.length === 0) return;
    
    // Basic Instagram URL validation
    const regex = /(https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[a-zA-Z0-9_-]+\/?)/;
    const invalidUrls = urls.filter(u => !regex.test(u));
    if (invalidUrls.length > 0) {
        setStatus('error');
        alert(`Please enter valid Instagram URLs. Found ${invalidUrls.length} invalid items.`);
        return;
    }
    
    setStatus('loading');
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ urls }),
      });
      if (response.ok) {
        setStatus('success');
        setDownloadedItems(prev => [...prev, ...urls]);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Download error:', errorData);
        setStatus('error');
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setStatus('error');
    } finally {
        if (status !== 'error') {
            setStatus('idle');
        }
    }
  };

  const handleClear = () => {
    setRawUrlInput('');
    setStatus('idle');
    setProgress(0);
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(downloadedItems));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "downloaded_items.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  if (!hasValidKey) {
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'sans-serif'}}>
        <div style={{textAlign:'center',maxWidth:520, padding: 20}}>
          <h2>Google Maps API Key Required</h2>
          <p><strong>Step 1:</strong> <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener">Get an API Key</a></p>
          <p><strong>Step 2:</strong> Add your key as a secret in AI Studio:</p>
          <ul style={{textAlign:'left',lineHeight:'1.8'}}>
            <li>Open <strong>Settings</strong> (⚙️ gear icon, <strong>top-right corner</strong>)</li>
            <li>Select <strong>Secrets</strong></li>
            <li>Type <code>GOOGLE_MAPS_PLATFORM_KEY</code> as the secret name, press <strong>Enter</strong></li>
            <li>Paste your API key as the value, press <strong>Enter</strong></li>
          </ul>
          <p>The app rebuilds automatically after you add the secret.</p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
        <h1 className="text-2xl font-semibold text-slate-900 mb-6">Instagram Tool</h1>
        
        <div className="flex gap-2 mb-6 border-b border-slate-200">
            <button 
                onClick={() => setActiveView('download')}
                className={`pb-2 px-1 ${activeView === 'download' ? 'border-b-2 border-slate-900 font-medium' : 'text-slate-500'}`}
            >
                Download
            </button>
            <button 
                onClick={() => setActiveView('location')}
                className={`pb-2 px-1 ${activeView === 'location' ? 'border-b-2 border-slate-900 font-medium' : 'text-slate-500'}`}
            >
                Location Search
            </button>
        </div>

        {activeView === 'download' && (
            <div className="space-y-4">
              <textarea
                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                placeholder="Paste Instagram URLs here (one per line)..."
                value={rawUrlInput}
                onChange={(e) => setRawUrlInput(e.target.value)}
                rows={4}
              />
              {previewUrl && (
                <div className="mt-2 text-center">
                    <img
                        src={previewUrl}
                        alt="Instagram Preview"
                        className="w-full h-48 object-cover rounded-lg border border-slate-200"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            setPreviewUrl(null);
                        }}
                    />
                </div>
              )}
              <div className={`grid ${downloadedItems.length > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-3`}>
                <button
                  onClick={handleClear}
                  className="w-full bg-slate-100 text-slate-700 p-3 rounded-lg font-medium hover:bg-slate-200 transition"
                >
                  Clear
                </button>
                <button
                  onClick={handleDownload}
                  disabled={status === 'loading'}
                  className="w-full bg-slate-900 text-white p-3 rounded-lg font-medium hover:bg-slate-800 transition disabled:opacity-50"
                >
                  {status === 'loading' ? 'Processing...' : 'Download Media'}
                </button>
                {downloadedItems.length > 0 && (
                  <button
                    onClick={handleExport}
                    className="w-full bg-slate-800 text-white p-3 rounded-lg font-medium hover:bg-slate-700 transition"
                  >
                    Export
                  </button>
                )}
              </div>
            </div>
        )}

        {activeView === 'location' && (
            <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">Buscar ubicación</label>
                <input 
                    type="text" 
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                
                <div className="w-full h-64 overflow-hidden rounded-lg border border-slate-200">
                    <Map
                        defaultCenter={{ lat: -34.6090264, lng: -58.3732215 }}
                        defaultZoom={13}
                        mapId="DEMO_MAP_ID"
                        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                        style={{ width: '100%', height: '100%' }}
                    >
                        <AdvancedMarker position={{ lat: -34.6090264, lng: -58.3732215 }}>
                            <Pin background="#4285F4" glyphColor="#fff" />
                        </AdvancedMarker>
                    </Map>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <label className="block text-slate-500">Latitud</label>
                        <input type="text" readOnly value="-34.6090264" className="w-full p-2 bg-slate-50 border border-slate-200 rounded"/>
                    </div>
                    <div>
                         <label className="block text-slate-500">Longitud</label>
                         <input type="text" readOnly value="-58.3732215" className="w-full p-2 bg-slate-50 border border-slate-200 rounded"/>
                    </div>
                </div>

                <label className="block text-sm font-medium text-slate-700">Límite máximo de recolección</label>
                <input 
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value))}
                    className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />

                <button className="w-full bg-slate-900 text-white p-3 rounded-lg font-medium hover:bg-slate-800 transition">
                    Buscar
                </button>
                
                <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 space-y-2">
                    <h3 className="font-semibold text-slate-900">How Location Search Works</h3>
                    <p>Instagram's location browsing is currently segmented:</p>
                    <ul className="list-disc pl-4 space-y-1">
                        <li><strong>In-App:</strong> Accessible via Profile tags or Saved Places.</li>
                        <li><strong>Web:</strong> Uses <a href="https://instagram.com/explore/locations/" target="_blank" className="text-indigo-600 underline">instagram.com/explore/locations/</a>.</li>
                        <li><strong>Advanced:</strong> OSINT tools bypass UI using API hooks (use cautiously).</li>
                    </ul>
                </div>
            </div>
        )}
        
        {status === 'loading' && (
          <div className="mt-6">
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-slate-900 h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>
        )}

        {status !== 'idle' && status !== 'loading' && (
          <div className={`mt-6 p-4 rounded-lg text-sm ${status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {status === 'success' ? 'Request sent successfully.' : 'An error occurred during processing.'}
          </div>
        )}
        </div>
      </div>
    </APIProvider>
  );
}

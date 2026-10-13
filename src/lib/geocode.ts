/**
 * Búsqueda de lugares sobre Nominatim (OpenStreetMap).
 * Centraliza la URL, el formato de resultados, los filtros por tipo
 * de lugar y las búsquedas recientes (localStorage).
 */

export interface GeoSuggestion {
  place_id?: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  class?: string;
  importance?: number;
  /** [latSur, latNorte, lngOeste, lngEste] como strings */
  boundingbox?: string[];
  address?: Record<string, string>;
}

export type PlaceFilter = 'all' | 'city' | 'state' | 'country';

export const PLACE_FILTERS: { id: PlaceFilter; label: string; featureType?: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'city', label: 'Ciudades', featureType: 'city' },
  { id: 'state', label: 'Provincias', featureType: 'state' },
  { id: 'country', label: 'Países', featureType: 'country' },
];

const TYPE_LABELS: Record<string, string> = {
  city: 'Ciudad',
  town: 'Pueblo',
  village: 'Aldea',
  hamlet: 'Caserío',
  suburb: 'Barrio',
  neighbourhood: 'Barrio',
  quarter: 'Barrio',
  state: 'Provincia / Estado',
  province: 'Provincia',
  county: 'Condado',
  country: 'País',
  administrative: 'Región',
  road: 'Calle',
  residential: 'Zona residencial',
  island: 'Isla',
  postcode: 'Zona postal',
};

export function placeTypeLabel(s: GeoSuggestion): string {
  if (s.type && TYPE_LABELS[s.type]) return TYPE_LABELS[s.type];
  if (s.class === 'boundary') return 'Región';
  if (s.class === 'highway') return 'Calle';
  return 'Lugar';
}

/** "Springfield, Condado X, …" → título "Springfield", subtítulo el resto. */
export function placeTitle(s: GeoSuggestion): string {
  return s.display_name.split(',')[0]?.trim() || s.display_name;
}

export function placeSubtitle(s: GeoSuggestion): string {
  const parts = s.display_name.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join(', ');
  if (s.address) {
    return [s.address.state, s.address.country].filter(Boolean).join(', ');
  }
  return '';
}

/** Convierte el boundingbox de Nominatim a límites de Leaflet [[S,O],[N,E]]. */
export function placeBounds(s: GeoSuggestion): [[number, number], [number, number]] | null {
  if (!s.boundingbox || s.boundingbox.length !== 4) return null;
  const [south, north, west, east] = s.boundingbox.map((v) => parseFloat(v));
  if ([south, north, west, east].some(Number.isNaN) || south === north || west === east) return null;
  return [[south, west], [north, east]];
}

export async function searchPlaces(
  query: string,
  filter: PlaceFilter = 'all',
  signal?: AbortSignal
): Promise<GeoSuggestion[]> {
  const params = new URLSearchParams({
    format: 'json',
    q: query.trim(),
    limit: '8',
    addressdetails: '1',
    dedupe: '1',
  });
  const featureType = PLACE_FILTERS.find((f) => f.id === filter)?.featureType;
  if (featureType) params.set('featureType', featureType);

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'Accept-Language': 'es,en' },
    signal,
  });
  if (!response.ok) throw new Error(`Geocoding ${response.status}`);
  const raw = (await response.json()) as GeoSuggestion[];

  // Deduplicar por id/nombre conservando el orden de relevancia de Nominatim
  const seen = new Set<string>();
  return raw.filter((item) => {
    const key = item.place_id ? `id:${item.place_id}` : `name:${item.display_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Búsquedas recientes (solo navegador) -----------------------------------
const RECENTS_KEY = 'instatool.recentPlaces.v1';
const MAX_RECENTS = 5;

export function loadRecentPlaces(): GeoSuggestion[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') as GeoSuggestion[];
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.display_name && p.lat && p.lon).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function rememberPlace(current: GeoSuggestion[], place: GeoSuggestion): GeoSuggestion[] {
  const next = [place, ...current.filter((p) => p.display_name !== place.display_name)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch { /* almacenamiento no disponible */ }
  return next;
}

export function clearRecentPlaces(): void {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch { /* noop */ }
}

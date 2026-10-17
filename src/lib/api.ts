/** One explicit API origin for static GitHub Pages and hosted frontends. */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
export const API_BASE_URL = configured.replace(/\/+$/, '');
export const API_CONFIGURED = Boolean(API_BASE_URL) || !window.location.hostname.endsWith('github.io');

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('Ruta API inválida.');
  if (!API_CONFIGURED) {
    throw new Error('No hay un backend configurado. Configurá VITE_API_BASE_URL con la URL HTTPS de una API operativa. GitHub Pages no ejecuta servidores.');
  }
  if (API_BASE_URL) {
    const parsed = new URL(API_BASE_URL);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('El backend debe usar HTTPS.');
    }
  }
  return `${API_BASE_URL}${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const onAbort = () => controller.abort();
  init?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) throw new Error('La URL del backend devolvió HTML, no una respuesta de API. Revisá VITE_API_BASE_URL y las rutas del servidor.');
    return response;
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) throw new Error('El servidor tardó demasiado en responder.');
    throw error;
  } finally {
    clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', onAbort);
  }
}

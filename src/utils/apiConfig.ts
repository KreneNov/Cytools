/**
 * Utility configuration and helpers for resolving API endpoints
 * across Web Browser and Chrome Extension (Manifest V3) environments.
 */

export function isExtensionEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  // Strict check: Only consider it an extension environment when loaded under chrome-extension: protocol
  return window.location.protocol === 'chrome-extension:';
}

/**
 * Returns the backend API base origin:
 * - Empty string in standard Web app (so relative paths /api/... hit Vite proxy or hosting origin)
 * - Configured base URL (VITE_API_BASE_URL) or default localhost:3000/5173 when in Chrome Extension
 */
export function getApiBaseUrl(path?: string): string {
  if (typeof window === 'undefined') return '';
  const envUrl = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();

  if (isExtensionEnvironment()) {
    // Route download, video info, payment and hall of fame API calls to dedicated Express backend (port 3000)
    if (
      path &&
      (path.includes('/api/download') ||
        path.includes('/api/info') ||
        path.includes('/api/payment') ||
        path.includes('/api/hall-of-fame'))
    ) {
      return 'http://localhost:3000';
    }
    return 'http://localhost:5173';
  }
  return '';
}

/**
 * Resolves an API path into a fully qualified URL when running inside an extension.
 */
export function resolveApiUrl(path: string): string {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }

  const baseUrl = getApiBaseUrl(path);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

interface BackgroundFetchResponse<T = unknown> {
  success: boolean;
  status: number;
  statusText: string;
  data?: T;
  error?: string;
}

/**
 * High-reliability fetch wrapper with Chrome Extension background worker fallback.
 */
export async function apiFetch<T = unknown>(pathOrUrl: string, init?: RequestInit): Promise<Response> {
  const targetUrl = resolveApiUrl(pathOrUrl);

  try {
    const directResponse = await fetch(targetUrl, init);
    return directResponse;
  } catch (directErr) {
    // If running in extension and direct fetch failed (e.g. CORS/network), attempt service worker relay
    const chromeApi = typeof window !== 'undefined'
      ? (window as unknown as { chrome?: { runtime?: { sendMessage?: (...args: unknown[]) => Promise<BackgroundFetchResponse<T>> } } }).chrome
      : undefined;

    if (isExtensionEnvironment() && chromeApi?.runtime?.sendMessage) {
      try {
        const bgResult = await chromeApi.runtime.sendMessage({
          type: 'CYTOOLS_PROXY_FETCH',
          url: targetUrl,
          options: {
            method: init?.method || 'GET',
            headers: init?.headers,
            body: init?.body ? String(init.body) : undefined,
          },
        });

        if (bgResult && typeof bgResult === 'object') {
          const bodyContent = typeof bgResult.data === 'object'
            ? JSON.stringify(bgResult.data)
            : String(bgResult.data ?? '');

          return new Response(bodyContent, {
            status: bgResult.status || (bgResult.success ? 200 : 500),
            statusText: bgResult.statusText || (bgResult.success ? 'OK' : 'Error'),
            headers: {
              'Content-Type': typeof bgResult.data === 'object' ? 'application/json' : 'text/plain',
            },
          });
        }
      } catch (workerErr) {
        console.error('[Cytools Extension] Background worker relay also failed:', workerErr);
      }
    }

    throw directErr;
  }
}

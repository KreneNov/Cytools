/**
 * Utility configuration and helpers for resolving API endpoints
 * across Web Browser and Chrome Extension (Manifest V3) environments.
 */

import { getApiUrl, isExtensionEnvironment, PRODUCTION_API_URL } from './api';

export { getApiUrl, isExtensionEnvironment, PRODUCTION_API_URL };

/**
 * Returns the backend API base origin:
 * - Empty string in standard Web app (so relative paths /api/... hit Vite proxy or hosting origin)
 * - https://cytools.io.vn when running inside Chrome Extension
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const envUrl = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim().replace(/\/+$/, '');

  if (isExtensionEnvironment()) {
    return PRODUCTION_API_URL;
  }
  return '';
}

/**
 * Resolves an API path into a fully qualified URL when running inside an extension.
 */
export function resolveApiUrl(path: string): string {
  return getApiUrl(path);
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

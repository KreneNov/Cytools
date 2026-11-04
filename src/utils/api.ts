/**
 * Universal API URL Resolver for Cytools
 * Automatically routes API calls to https://cytools.io.vn when running
 * in a Chrome Extension context, while preserving relative /api paths for standard Web.
 */

export const PRODUCTION_API_URL = 'https://cytools.io.vn';

/**
 * Detects whether the code is executing within a Chrome Extension (Manifest V3)
 * environment (popup, side panel, background service worker, or extension tab).
 */
export function isExtensionEnvironment(): boolean {
  if (typeof window !== 'undefined' && window.location?.protocol === 'chrome-extension:') {
    return true;
  }
  const chromeObj = typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { chrome?: { runtime?: { id?: string } } }).chrome
    : undefined;
  if (chromeObj?.runtime && Boolean(chromeObj.runtime.id)) {
    return true;
  }
  return false;
}

/**
 * Returns the resolved API URL for a given path.
 * - In Chrome Extension: prepends https://cytools.io.vn
 * - In Web Browser: returns relative path (or VITE_API_BASE_URL if configured)
 */
export function getApiUrl(path: string): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:') ||
    path.startsWith('data:')
  ) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Explicit environment variable override takes top precedence if provided
  const envUrl = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return `${envUrl.trim().replace(/\/+$/, '')}${normalizedPath}`;
  }

  if (isExtensionEnvironment()) {
    return `${PRODUCTION_API_URL}${normalizedPath}`;
  }

  return normalizedPath;
}

// Backward-compatibility alias
export const resolveApiUrl = getApiUrl;

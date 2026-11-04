import type { IncomingMessage, ServerResponse } from 'http';

export const ALLOWED_PRODUCTION_ORIGINS = [
  'https://cytools.io.vn',
  'https://www.cytools.io.vn',
];

/**
 * Checks whether the incoming request Origin header belongs to the official
 * cytools.io.vn domain, a local development server, or a Chrome Extension.
 */
export function resolveAllowedOrigin(originHeader?: string | string[]): string {
  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!rawOrigin || typeof rawOrigin !== 'string') {
    return '*';
  }

  const origin = rawOrigin.trim();
  if (ALLOWED_PRODUCTION_ORIGINS.includes(origin)) {
    return origin;
  }

  if (origin.startsWith('chrome-extension://')) {
    return origin;
  }

  try {
    const parsed = new URL(origin);
    if (
      parsed.hostname === 'cytools.io.vn' ||
      parsed.hostname.endsWith('.cytools.io.vn') ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    ) {
      return origin;
    }
  } catch {
    // Fallback below
  }

  return '*';
}

/**
 * Applies standardized CORS headers for cytools.io.vn, www.cytools.io.vn,
 * localhost, and Chrome Extension contexts.
 */
export function applyCorsHeaders(
  req: IncomingMessage | undefined,
  res: ServerResponse,
  methods = 'GET, POST, OPTIONS',
  headers = 'Content-Type, Authorization, X-Requested-With, X-Secret-Key, x-sepay-token, x-api-key'
): void {
  if (typeof res.setHeader !== 'function') return;

  const allowedOrigin = resolveAllowedOrigin(req?.headers?.origin);
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  if (allowedOrigin !== '*') {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
}

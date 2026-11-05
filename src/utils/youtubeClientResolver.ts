/**
 * Client-Side Residential IP YouTube Resolver for Savetube Multi-CDN
 *
 * Runs 100% in the user's browser using the Web Crypto API (`crypto.subtle`) for AES-128-CBC
 * decryption. Because requests originate directly from the end-user's browser, they carry a clean
 * residential/mobile IP rather than Vercel's datacenter AWS IPs, completely bypassing Cloudflare
 * 429/403 blocks.
 *
 * All fetch calls strictly use `referrerPolicy: "no-referrer"`, `credentials: "omit"`, and `mode: "cors"`
 * so no website origin/referer headers are leaked to the upstream CDN.
 */

export type YouTubeResolveFormat = '1080' | '720' | '360' | 'mp3';

export interface ClientYouTubeResolveResult {
  url: string;
  quality: string;
  title?: string;
  provider: 'savetube_client';
}

const SAVETUBE_AES_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
const SAVETUBE_CDN_POOL = [
  'cdn401.savetube.vip',
  'cdn402.savetube.vip',
  'cdn403.savetube.vip',
  'cdn404.savetube.vip',
  'cdn405.savetube.vip',
  'cdn406.savetube.vip',
];
const MAX_CLIENT_CDN_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    arr[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return arr;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypts Savetube's encrypted payload using browser-native Web Crypto API.
 */
export async function decryptSavetubePayloadWebCrypto(b64: string): Promise<Record<string, unknown>> {
  const rawBytes = base64ToUint8Array(b64);
  const iv = rawBytes.slice(0, 16);
  const ciphertext = rawBytes.slice(16);
  const keyBytes = hexToUint8Array(SAVETUBE_AES_KEY_HEX);

  const cryptoObj = typeof window !== 'undefined' && window.crypto ? window.crypto : (globalThis.crypto as Crypto);
  if (!cryptoObj?.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not supported in this environment.');
  }

  const cryptoKey = await cryptoObj.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await cryptoObj.subtle.decrypt(
    { name: 'AES-CBC', iv: iv as unknown as BufferSource },
    cryptoKey,
    ciphertext as unknown as BufferSource
  );

  const decryptedText = new TextDecoder('utf-8').decode(decryptedBuffer);
  return JSON.parse(decryptedText) as Record<string, unknown>;
}

/**
 * Resilient recursive URL extractor across all known Savetube response formats.
 */
export function extractUrlFromAny(target: unknown): string | null {
  if (!target) return null;

  if (typeof target === 'string') {
    const s = target.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return s;
    }
    return null;
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      const url = extractUrlFromAny(item);
      if (url) return url;
    }
    return null;
  }

  if (typeof target === 'object') {
    const obj = target as Record<string, unknown>;

    const candidateKeys = [
      'downloadUrl',
      'download_url',
      'url',
      'streamUrl',
      'stream_url',
      'mediaUrl',
      'media_url',
      'file',
      'link',
      'href',
    ];

    for (const key of candidateKeys) {
      const val = obj[key];
      if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
        return val;
      }
    }

    if (obj.data) {
      const nested = extractUrlFromAny(obj.data);
      if (nested) return nested;
    }
    if (obj.result) {
      const nested = extractUrlFromAny(obj.result);
      if (nested) return nested;
    }
    if (obj.info) {
      const nested = extractUrlFromAny(obj.info);
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * Retrieves a list of active CDN hosts, starting with the server's random CDN recommendation.
 */
async function getClientCdnCandidates(): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const cdnRes = await fetch('https://media.savetube.vip/api/random-cdn', {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      mode: 'cors',
      signal: AbortSignal.timeout(2500),
    });

    if (cdnRes.ok) {
      const cdnData = (await cdnRes.json().catch(() => null)) as { cdn?: unknown } | null;
      const cdn = typeof cdnData?.cdn === 'string' ? cdnData.cdn.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '';
      if (cdn && /^[a-z0-9.-]+\.savetube\.vip$/i.test(cdn)) {
        candidates.push(cdn);
      }
    }
  } catch {
    // Fall back to pool
  }

  const shuffledPool = [...SAVETUBE_CDN_POOL].sort(() => Math.random() - 0.5);
  for (const host of shuffledPool) {
    if (!candidates.includes(host)) candidates.push(host);
  }
  return candidates.slice(0, MAX_CLIENT_CDN_ATTEMPTS);
}

async function trySavetubeClientOnCdn(
  cdn: string,
  targetUrl: string,
  format: YouTubeResolveFormat
): Promise<{ url: string; quality: string; title?: string }> {
  // 1. Fetch info payload with clean no-referrer policy
  const infoRes = await fetch(`https://${cdn}/v2/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify({ url: targetUrl }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    mode: 'cors',
    signal: AbortSignal.timeout(5000),
  });

  if (!infoRes.ok) {
    throw new Error(`${cdn}/v2/info HTTP ${infoRes.status}`);
  }

  const infoJson = (await infoRes.json().catch(() => null)) as { status?: unknown; data?: unknown } | null;
  if (!infoJson?.status || typeof infoJson.data !== 'string') {
    throw new Error(`${cdn}/v2/info returned no encrypted payload`);
  }

  const decrypted = await decryptSavetubePayloadWebCrypto(infoJson.data);
  const key = typeof decrypted.key === 'string' ? decrypted.key : '';
  if (!key) throw new Error(`${cdn}/v2/info decrypted payload has no key`);
  const title = typeof decrypted.title === 'string' ? decrypted.title : undefined;

  // 2. Direct playback stream shortcut (if already provided in video_formats)
  if (Array.isArray(decrypted.video_formats) && format !== 'mp3') {
    const targetQNum = Number(format);
    const directMatch = (decrypted.video_formats as Array<Record<string, unknown>>).find(
      (f) => Number(f.quality) === targetQNum && typeof f.url === 'string' && f.url.startsWith('http')
    );
    if (directMatch && typeof directMatch.url === 'string') {
      return { url: directMatch.url, quality: format, title };
    }
  }

  // 3. Determine best quality to request
  let requestedQuality = format === 'mp3' ? '128' : format;
  if (format !== 'mp3' && Array.isArray(decrypted.video_formats)) {
    const availableQualities = (decrypted.video_formats as Array<Record<string, unknown>>)
      .map((f) => String(f.quality || ''))
      .filter(Boolean);

    if (format === '1080' && !availableQualities.includes('1080')) {
      requestedQuality = availableQualities.includes('720') ? '720' : '360';
    }
  }

  const downloadType = format === 'mp3' ? 'audio' : 'video';

  // 4. Request direct download URL
  const dlRes = await fetch(`https://${cdn}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ downloadType, quality: requestedQuality, key }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    mode: 'cors',
    signal: AbortSignal.timeout(7000),
  });

  if (!dlRes.ok) {
    throw new Error(`${cdn}/download ${requestedQuality} HTTP ${dlRes.status}`);
  }

  const dlJson = await dlRes.json().catch(() => null);
  const downloadUrl = extractUrlFromAny(dlJson);

  if (downloadUrl) {
    return { url: downloadUrl, quality: requestedQuality, title };
  }

  // If 1080 failed without downloadUrl, attempt 720 as immediate quality step-down on same CDN
  if (requestedQuality === '1080') {
    try {
      const fallbackRes = await fetch(`https://${cdn}/download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ downloadType, quality: '720', key }),
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        mode: 'cors',
        signal: AbortSignal.timeout(5000),
      });
      if (fallbackRes.ok) {
        const fallbackJson = await fallbackRes.json().catch(() => null);
        const fallbackUrl = extractUrlFromAny(fallbackJson);
        if (fallbackUrl) {
          return { url: fallbackUrl, quality: '720', title };
        }
      }
    } catch {
      // Continue to next CDN
    }
  }

  throw new Error(`${cdn}/download returned no downloadUrl`);
}

/**
 * Resolves a YouTube download URL purely in the client's browser using residential IP and Web Crypto.
 * Returns null if all client-side CDN attempts fail so the caller can seamlessly try serverless fallback.
 */
export async function resolveYouTubeClientSavetube(
  videoId: string,
  format: YouTubeResolveFormat
): Promise<ClientYouTubeResolveResult | null> {
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const cdns = await getClientCdnCandidates();

    for (let i = 0; i < cdns.length; i++) {
      const cdn = cdns[i];
      try {
        const res = await trySavetubeClientOnCdn(cdn, targetUrl, format);
        return {
          url: res.url,
          quality: res.quality,
          title: res.title,
          provider: 'savetube_client',
        };
      } catch (err) {
        console.warn(`[Client Savetube] CDN ${cdn} failed:`, err instanceof Error ? err.message : err);
        if (i < cdns.length - 1) {
          await sleep(400);
        }
      }
    }
  } catch (outerErr) {
    console.warn('[Client Savetube Resolver Error]:', outerErr);
  }

  return null;
}

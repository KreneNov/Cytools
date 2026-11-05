/**
 * Client-Side Residential IP YouTube Resolver for Savetube Multi-CDN
 *
 * Runs 100% in the user's browser using the Web Crypto API (`crypto.subtle`) for AES-128-CBC
 * decryption. Because requests originate directly from the end-user's browser, they carry a clean
 * residential/mobile IP rather than Vercel's datacenter AWS IPs, completely bypassing Cloudflare
 * 429/403 blocks.
 *
 * Key Anti-Mutex Architecture:
 * 1. Single `/v2/info` lookup cached in memory per `videoId` for 5 minutes (`300_000ms`),
 *    eliminating redundant `/v2/info` calls across multiple clicks or CDNs.
 * 2. Extended timeouts (`10000ms` for `/v2/info` and `15000ms` for `/download`) so 1080p FFmpeg
 *    muxing is never aborted mid-flight.
 * 3. Graceful handling of `"This video is busy right now"`: waits 2500ms and retries once on the
 *    SAME CDN with the SAME `key`, then automatically steps down `1080` -> `720` -> `360` using
 *    the SAME `key` on the SAME CDN to bypass Savetube's 1080p FFmpeg mutex.
 */

export type YouTubeResolveFormat = '1080' | '720' | '360' | 'mp3';

export interface ClientYouTubeResolveResult {
  url: string;
  quality: string;
  title?: string;
  provider: 'savetube_client';
}

interface CachedSavetubeInfo {
  cdn: string;
  key: string;
  title?: string;
  videoFormats: Array<Record<string, unknown>>;
  expiresAt: number;
}

const SAVETUBE_AES_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
const SAVETUBE_CDN_POOL = [
  'cdn400.savetube.vip',
  'cdn401.savetube.vip',
  'cdn403.savetube.vip',
  'cdn405.savetube.vip',
  'cdn406.savetube.vip',
];
const DEAD_SAVETUBE_CDNS = new Set(['cdn402.savetube.vip', 'cdn404.savetube.vip']);
const MAX_INFO_CDN_ATTEMPTS = 2;
const SAVETUBE_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const INFO_TIMEOUT_MS = 10000; // 10s for /v2/info
const DOWNLOAD_TIMEOUT_MS = 15000; // 15s for /download (1080p muxing takes 3-10s)

const savetubeInfoCache = new Map<string, CachedSavetubeInfo>();

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
 * Retrieves active CDN candidates, starting with Savetube's random-cdn endpoint.
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
      signal: AbortSignal.timeout(3000),
    });

    if (cdnRes.ok) {
      const cdnData = (await cdnRes.json().catch(() => null)) as { cdn?: unknown } | null;
      const cdn = typeof cdnData?.cdn === 'string' ? cdnData.cdn.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase() : '';
      if (cdn && /^[a-z0-9.-]+\.savetube\.vip$/i.test(cdn) && !DEAD_SAVETUBE_CDNS.has(cdn)) {
        candidates.push(cdn);
      }
    }
  } catch {
    // Fall back to static pool
  }

  const shuffledPool = [...SAVETUBE_CDN_POOL].sort(() => Math.random() - 0.5);
  for (const host of shuffledPool) {
    if (!candidates.includes(host)) candidates.push(host);
  }
  return candidates.slice(0, MAX_INFO_CDN_ATTEMPTS);
}

/**
 * Looks up and decrypts `/v2/info` ONCE per `videoId` and caches `{ cdn, key, title, videoFormats }`
 * in memory for 5 minutes so subsequent clicks or quality step-downs never re-trigger `/v2/info`.
 */
async function getOrFetchSavetubeInfo(videoId: string, targetUrl: string): Promise<CachedSavetubeInfo> {
  const now = Date.now();
  const cached = savetubeInfoCache.get(videoId);
  if (cached && cached.expiresAt > now && cached.key && cached.cdn) {
    return cached;
  }

  const cdns = await getClientCdnCandidates();
  let lastError: Error | null = null;

  for (let i = 0; i < cdns.length; i++) {
    const cdn = cdns[i];
    try {
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
        signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
      });

      if (!infoRes.ok) {
        throw new Error(`${cdn}/v2/info HTTP ${infoRes.status}`);
      }

      const infoJson = (await infoRes.json().catch(() => null)) as {
        status?: unknown;
        data?: unknown;
        message?: unknown;
      } | null;

      if (!infoJson?.status || typeof infoJson.data !== 'string') {
        throw new Error(
          `${cdn}/v2/info returned no encrypted payload (${typeof infoJson?.message === 'string' ? infoJson.message : 'status false'})`
        );
      }

      const decrypted = await decryptSavetubePayloadWebCrypto(infoJson.data);
      const key = typeof decrypted.key === 'string' ? decrypted.key : '';
      if (!key) {
        throw new Error(`${cdn}/v2/info decrypted payload has no key`);
      }

      const title = typeof decrypted.title === 'string' ? decrypted.title : undefined;
      const videoFormats = Array.isArray(decrypted.video_formats)
        ? (decrypted.video_formats as Array<Record<string, unknown>>)
        : [];

      const entry: CachedSavetubeInfo = {
        cdn,
        key,
        title,
        videoFormats,
        expiresAt: Date.now() + SAVETUBE_INFO_CACHE_TTL_MS,
      };
      savetubeInfoCache.set(videoId, entry);
      return entry;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Client Savetube] /v2/info on ${cdn} failed:`, lastError.message);
      if (i < cdns.length - 1) {
        await sleep(500);
      }
    }
  }

  throw lastError || new Error('Failed to fetch Savetube /v2/info');
}

interface DownloadAttemptOutcome {
  downloadUrl: string | null;
  isBusy: boolean;
  httpStatus: number;
  message?: string;
}

/**
 * Calls `https://${cdn}/download` on the exact CDN that issued `key` with a 15-second timeout.
 */
async function requestSavetubeDownloadOnSameCdn(
  cdn: string,
  downloadType: 'audio' | 'video',
  quality: string,
  key: string
): Promise<DownloadAttemptOutcome> {
  const dlRes = await fetch(`https://${cdn}/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    },
    body: JSON.stringify({ downloadType, quality, key }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    mode: 'cors',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  const dlJson = (await dlRes.json().catch(() => null)) as Record<string, unknown> | null;
  const downloadUrl = extractUrlFromAny(dlJson);
  const rawMessage = typeof dlJson?.message === 'string' ? dlJson.message : undefined;
  const lowerMsg = (rawMessage || '').toLowerCase();
  const isBusy = lowerMsg.includes('busy');

  return {
    downloadUrl,
    isBusy,
    httpStatus: dlRes.status,
    message: rawMessage,
  };
}

function findDirectFormatUrl(
  videoFormats: Array<Record<string, unknown>>,
  quality: string
): string | null {
  const targetQNum = Number(quality);
  if (!Number.isFinite(targetQNum)) return null;
  const match = videoFormats.find(
    (f) => Number(f.quality) === targetQNum && typeof f.url === 'string' && f.url.startsWith('http')
  );
  return match && typeof match.url === 'string' ? match.url : null;
}

/**
 * Resolves a YouTube download URL in the browser using residential IP + cached `/v2/info` key:
 * - Never calls `/v2/info` more than once per `videoId` within 5 minutes.
 * - Uses 10s `/v2/info` timeout and 15s `/download` timeout.
 * - If `/download` returns `"This video is busy right now"` or `status: false`:
 *   1. Waits 2500ms and retries `/download` ONCE on the SAME CDN with the SAME `key`.
 *   2. If still busy on `1080`, immediately steps down to `720` -> `360` using the SAME `key` on the SAME CDN.
 */
export async function resolveYouTubeClientSavetube(
  videoId: string,
  format: YouTubeResolveFormat
): Promise<ClientYouTubeResolveResult | null> {
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const info = await getOrFetchSavetubeInfo(videoId, targetUrl);
    const { cdn, key, title, videoFormats } = info;

    // 1. Check if decrypted video_formats already provides a direct stream URL for requested quality
    if (format !== 'mp3' && videoFormats.length > 0) {
      const directUrl = findDirectFormatUrl(videoFormats, format);
      if (directUrl) {
        return {
          url: directUrl,
          quality: format,
          title,
          provider: 'savetube_client',
        };
      }
    }

    // 2. Determine initial quality to request
    let requestedQuality = format === 'mp3' ? '128' : format;
    if (format !== 'mp3' && videoFormats.length > 0) {
      const availableQualities = videoFormats
        .map((f) => String(f.quality || ''))
        .filter(Boolean);

      if (
        format === '1080' &&
        availableQualities.length > 0 &&
        !availableQualities.includes('1080')
      ) {
        requestedQuality = availableQualities.includes('720') ? '720' : '360';
      }
    }

    const downloadType: 'audio' | 'video' = format === 'mp3' ? 'audio' : 'video';

    // 3. Primary /download call on the SAME CDN that issued the key (15s timeout)
    let outcome = await requestSavetubeDownloadOnSameCdn(
      cdn,
      downloadType,
      requestedQuality,
      key
    );

    if (outcome.downloadUrl) {
      return {
        url: outcome.downloadUrl,
        quality: requestedQuality,
        title,
        provider: 'savetube_client',
      };
    }

    // 4. Handle "This video is busy right now" or status:false on the SAME CDN + SAME key
    if (outcome.isBusy) {
      console.warn(
        `[Client Savetube] ${cdn}/download (${requestedQuality}) reported busy ("${outcome.message || 'status:false'}"). Waiting 2500ms before same-key retry...`
      );
      await sleep(2500);
      outcome = await requestSavetubeDownloadOnSameCdn(
        cdn,
        downloadType,
        requestedQuality,
        key
      );

      if (outcome.downloadUrl) {
        return {
          url: outcome.downloadUrl,
          quality: requestedQuality,
          title,
          provider: 'savetube_client',
        };
      }
    }

    // 5. If still busy/unavailable on video (e.g., 1080p FFmpeg mutex locked), immediately step down
    //    to 720 -> 360 using the SAME key on the SAME CDN (pre-muxed streams bypass 1080p FFmpeg mutex)
    if (format !== 'mp3') {
      const stepDownQualities =
        requestedQuality === '1080'
          ? ['720', '360']
          : requestedQuality === '720'
            ? ['360']
            : [];

      for (const fallbackQuality of stepDownQualities) {
        const directFallback = findDirectFormatUrl(videoFormats, fallbackQuality);
        if (directFallback) {
          return {
            url: directFallback,
            quality: fallbackQuality,
            title,
            provider: 'savetube_client',
          };
        }

        try {
          const stepDownOutcome = await requestSavetubeDownloadOnSameCdn(
            cdn,
            'video',
            fallbackQuality,
            key
          );
          if (stepDownOutcome.downloadUrl) {
            return {
              url: stepDownOutcome.downloadUrl,
              quality: fallbackQuality,
              title,
              provider: 'savetube_client',
            };
          }
        } catch (stepErr) {
          console.warn(
            `[Client Savetube] Quality step-down ${fallbackQuality} on ${cdn} failed:`,
            stepErr instanceof Error ? stepErr.message : stepErr
          );
        }
      }
    }
  } catch (err) {
    console.warn(
      '[Client Savetube Resolver] Resolution attempt failed:',
      err instanceof Error ? err.message : err
    );
  }

  return null;
}

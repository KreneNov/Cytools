import { createDecipheriv } from 'node:crypto';

/**
 * Server-Side YouTube Resolver Proxy (shared by Vercel Serverless `api/social/extract.ts`
 * and Vite dev middleware `src/server/socialExtractor.ts`).
 *
 * Runs entirely on the server so that `Origin`, `Referer` and `User-Agent` are controlled by us:
 * - Provider A: Savetube Multi-CDN (spoofed as `ytshorts.savetube.me`), AES-128-CBC decryption,
 *   deep response URL extraction across multiple keys/encrypted payloads, and instant breakout
 *   if no downloadUrl is returned.
 * - Provider B: Savenow / Loader.to (`p.savenow.to`, spoofed as `en.loader.to`) fallback,
 *   returning `pendingId` if not ready in <2s so serverless function never times out.
 *
 * Guaranteed to never throw unhandled exceptions or return HTTP 502.
 */

export type YouTubeResolveFormat = '1080' | '720' | '360' | 'mp3';

export interface YouTubeResolveResult {
  success: boolean;
  url?: string;
  pendingId?: string;
  provider?: 'savetube' | 'savenow';
  quality?: string;
  title?: string;
  error?: string;
  attempts?: string[];
}

export interface YouTubeProgressResult {
  success: boolean;
  url?: string;
  progress?: number;
  status?: 'ready' | 'processing' | 'failed';
  error?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export function getRandomResidentialIp(): string {
  const subnets = [
    // VN Viettel/VNPT/FPT/CMC residential
    () => `14.${160 + Math.floor(Math.random() * 80)}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    () => `113.${160 + Math.floor(Math.random() * 32)}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    () => `171.${224 + Math.floor(Math.random() * 32)}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    () => `42.${112 + Math.floor(Math.random() * 8)}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    // US Comcast/Charter/AT&T residential
    () => `73.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
    () => `24.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
  ];
  const picker = subnets[Math.floor(Math.random() * subnets.length)];
  return picker();
}

export function getSavetubeHeaders(): Record<string, string> {
  const ip = getRandomResidentialIp();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://ytshorts.savetube.me',
    Referer: 'https://ytshorts.savetube.me/',
    'User-Agent': BROWSER_UA,
    'X-Forwarded-For': ip,
    'X-Real-IP': ip,
    'X-Client-IP': ip,
  };
}

export function getSavenowHeaders(): Record<string, string> {
  const ip = getRandomResidentialIp();
  return {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://en.loader.to',
    Referer: 'https://en.loader.to/',
    'User-Agent': BROWSER_UA,
    'X-Forwarded-For': ip,
    'X-Real-IP': ip,
    'X-Client-IP': ip,
  };
}

const SAVETUBE_AES_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
const SAVETUBE_CDN_POOL = [
  'cdn401.savetube.vip',
  'cdn403.savetube.vip',
  'cdn404.savetube.vip',
  'cdn405.savetube.vip',
  'cdn406.savetube.vip',
];
const SAVETUBE_MAX_CDN_ATTEMPTS = 2;

const SAVENOW_API_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';

const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

class NoDownloadUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDownloadUrlError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Accepts a raw 11-char video ID or any YouTube URL (watch, youtu.be, shorts, embed, live)
 * and returns the 11-char video ID, or null when it cannot be parsed.
 */
export function normalizeYouTubeVideoId(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (YT_ID_REGEX.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return YT_ID_REGEX.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = parsed.searchParams.get('v');
      if (v && YT_ID_REGEX.test(v)) return v;
      const segments = parsed.pathname.split('/').filter(Boolean);
      const markerIdx = segments.findIndex((s) => ['shorts', 'embed', 'live', 'v'].includes(s));
      if (markerIdx !== -1) {
        const id = segments[markerIdx + 1] || '';
        return YT_ID_REGEX.test(id) ? id : null;
      }
    }
  } catch {
    // Not a URL
  }
  return null;
}

export function normalizeYouTubeFormat(input: unknown): YouTubeResolveFormat {
  const value = String(input ?? '').toLowerCase().replace(/p$/, '').trim();
  if (value === 'mp3' || value === 'audio') return 'mp3';
  if (value === '1080' || value === '720' || value === '360') return value;
  return '720';
}

function decryptSavetubePayload(b64: string): Record<string, unknown> {
  const rawBuf = Buffer.from(b64.replace(/\s/g, ''), 'base64');
  const iv = rawBuf.subarray(0, 16);
  const ciphertext = rawBuf.subarray(16);
  const keyBuf = Buffer.from(SAVETUBE_AES_KEY_HEX, 'hex');
  const decipher = createDecipheriv('aes-128-cbc', keyBuf, iv);
  const decryptedStr = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decryptedStr) as Record<string, unknown>;
}

/**
 * Resilient recursive URL extractor across all known Savetube response formats:
 * - Direct fields: `downloadUrl`, `download_url`, `url`, `streamUrl`, `stream_url`, `file`, `link`, `href`
 * - Nested objects: `data`, `result`, `info`
 * - Direct string URLs (`http://`, `https://`)
 * - Encrypted base64 payload strings (AES-128-CBC)
 * - Array collections
 */
export function extractUrlFromAny(target: unknown): string | null {
  if (!target) return null;

  if (typeof target === 'string') {
    const s = target.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return s;
    }
    // Check if it might be an encrypted base64 payload
    if (s.length > 32 && /^[A-Za-z0-9+/=\s]+$/.test(s)) {
      try {
        const decrypted = decryptSavetubePayload(s);
        return extractUrlFromAny(decrypted);
      } catch {
        // Not encrypted or wrong key, ignore
      }
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

    // Direct key scan
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

    // Inspect nested structures
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

async function getSavetubeCdnCandidates(): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const cdnRes = await fetch('https://media.savetube.vip/api/random-cdn', {
      headers: getSavetubeHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    if (cdnRes.ok) {
      const cdnData = (await cdnRes.json().catch(() => null)) as { cdn?: unknown } | null;
      const cdn = typeof cdnData?.cdn === 'string' ? cdnData.cdn.replace(/^https?:\/\//, '').replace(/\/+$/, '') : '';
      if (cdn && /^[a-z0-9.-]+\.savetube\.vip$/i.test(cdn)) {
        candidates.push(cdn);
      }
    }
  } catch {
    // Fall through to the static pool
  }

  const shuffledPool = [...SAVETUBE_CDN_POOL].sort(() => Math.random() - 0.5);
  for (const host of shuffledPool) {
    if (!candidates.includes(host)) candidates.push(host);
  }
  return candidates.slice(0, SAVETUBE_MAX_CDN_ATTEMPTS);
}

async function trySavetubeOnCdn(
  cdn: string,
  youtubeUrl: string,
  format: YouTubeResolveFormat
): Promise<{ url: string; quality: string; title?: string }> {
  const headers = getSavetubeHeaders();
  const infoRes = await fetch(`https://${cdn}/v2/info`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: youtubeUrl }),
    signal: AbortSignal.timeout(2500),
  });
  if (infoRes.status === 429) throw new RateLimitError(`${cdn}/v2/info 429`);
  if (!infoRes.ok) throw new Error(`${cdn}/v2/info HTTP ${infoRes.status}`);

  const infoJson = (await infoRes.json().catch(() => null)) as { status?: unknown; data?: unknown } | null;
  if (!infoJson?.status || typeof infoJson.data !== 'string') {
    throw new Error(`${cdn}/v2/info returned no encrypted payload`);
  }

  const decrypted = decryptSavetubePayload(infoJson.data);
  const key = typeof decrypted.key === 'string' ? decrypted.key : '';
  if (!key) throw new Error(`${cdn}/v2/info decrypted payload has no key`);
  const title = typeof decrypted.title === 'string' ? decrypted.title : undefined;

  // 1. Instant Direct Stream Shortcut:
  // Sometimes Savetube's decrypted info payload already contains direct googlevideo playback URLs
  if (Array.isArray(decrypted.video_formats) && format !== 'mp3') {
    const targetQNum = Number(format);
    const directMatch = (decrypted.video_formats as Array<Record<string, unknown>>).find(
      (f) => Number(f.quality) === targetQNum && typeof f.url === 'string' && f.url.startsWith('http')
    );
    if (directMatch && typeof directMatch.url === 'string') {
      return { url: directMatch.url, quality: format, title };
    }
  }

  // 2. Determine best quality to request
  let requestedQuality = format === 'mp3' ? '128' : format;
  if (format !== 'mp3' && Array.isArray(decrypted.video_formats)) {
    const availableQualities = (decrypted.video_formats as Array<Record<string, unknown>>)
      .map((f) => String(f.quality || ''))
      .filter(Boolean);

    // If 1080 was requested but not available, auto-step down to 720
    if (format === '1080' && !availableQualities.includes('1080')) {
      requestedQuality = availableQualities.includes('720') ? '720' : '360';
    }
  }

  const downloadType = format === 'mp3' ? 'audio' : 'video';

  const dlRes = await fetch(`https://${cdn}/download`, {
    method: 'POST',
    headers: getSavetubeHeaders(),
    body: JSON.stringify({ downloadType, quality: requestedQuality, key }),
    signal: AbortSignal.timeout(2500),
  });

  if (dlRes.status === 429) {
    throw new RateLimitError(`${cdn}/download ${requestedQuality} 429`);
  }
  if (!dlRes.ok) {
    throw new Error(`${cdn}/download ${requestedQuality} HTTP ${dlRes.status}`);
  }

  const dlJson = await dlRes.json().catch(() => null);
  const downloadUrl = extractUrlFromAny(dlJson);

  if (downloadUrl) {
    return { url: downloadUrl, quality: requestedQuality, title };
  }

  // If Savetube responded with 200 OK but has no valid URL (shadow-ban/empty payload),
  // immediately fail this CDN so the resolver can try the next iteration or Savenow.
  throw new NoDownloadUrlError(`${cdn}/download returned 200 without downloadUrl`);
}

async function resolveViaSavetube(
  videoId: string,
  format: YouTubeResolveFormat,
  attempts: string[]
): Promise<YouTubeResolveResult | null> {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const cdns = await getSavetubeCdnCandidates();

  for (const cdn of cdns) {
    try {
      const resolved = await trySavetubeOnCdn(cdn, youtubeUrl, format);
      return {
        success: true,
        url: resolved.url,
        provider: 'savetube',
        quality: resolved.quality,
        title: resolved.title,
        attempts,
      };
    } catch (err) {
      attempts.push(`savetube:${errMsg(err)}`);

      // If NoDownloadUrlError or RateLimitError, fail this CDN and move to the next iteration with a fresh IP
      if (err instanceof RateLimitError) {
        await sleep(150);
      }
    }
  }
  return null;
}

interface SaveNowProgressPayload {
  success?: unknown;
  progress?: unknown;
  download_url?: unknown;
  text?: unknown;
}

function parseSaveNowProgress(data: SaveNowProgressPayload | null): YouTubeProgressResult {
  const downloadUrl = data?.download_url;
  const rawProgress = Number(data?.progress ?? 0);
  const progress = Number.isFinite(rawProgress) ? Math.min(100, Math.round(rawProgress / 10)) : 0;

  if (typeof downloadUrl === 'string' && downloadUrl.startsWith('http')) {
    return { success: true, url: downloadUrl, progress: 100, status: 'ready' };
  }

  const text = typeof data?.text === 'string' ? data.text.toLowerCase() : '';
  if (text.includes('error') || text.includes('fail')) {
    return { success: false, progress, status: 'failed', error: 'Máy chủ chuyển đổi báo lỗi khi xử lý video.' };
  }
  return { success: true, progress, status: 'processing' };
}

/**
 * Proxies a single Savenow progress check from the server with spoofed Loader.to headers.
 */
export async function pollYouTubeSaveNowProgress(taskId: string): Promise<YouTubeProgressResult> {
  const id = (taskId || '').trim();
  if (!id || !/^[A-Za-z0-9_-]{4,128}$/.test(id)) {
    return { success: false, status: 'failed', error: 'Mã tiến trình không hợp lệ.' };
  }

  try {
    const progRes = await fetch(`https://p.savenow.to/ajax/progress.php?id=${encodeURIComponent(id)}`, {
      headers: getSavenowHeaders(),
      signal: AbortSignal.timeout(3500),
    });
    if (progRes.status === 429) {
      return { success: true, status: 'processing', progress: 0 };
    }
    if (!progRes.ok) {
      return { success: false, status: 'failed', error: `Savenow progress HTTP ${progRes.status}` };
    }
    const data = (await progRes.json().catch(() => null)) as SaveNowProgressPayload | null;
    return parseSaveNowProgress(data);
  } catch (err) {
    return { success: false, status: 'failed', error: errMsg(err) };
  }
}

async function resolveViaSaveNow(
  videoId: string,
  format: YouTubeResolveFormat,
  attempts: string[]
): Promise<YouTubeResolveResult | null> {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const initUrl =
    `https://p.savenow.to/ajax/download.php?copyright=0&format=${encodeURIComponent(format)}` +
    `&url=${encodeURIComponent(youtubeUrl)}&api=${SAVENOW_API_KEY}`;

  try {
    const initRes = await fetch(initUrl, {
      headers: getSavenowHeaders(),
      signal: AbortSignal.timeout(3500),
    });
    if (!initRes.ok) {
      attempts.push(`savenow:init HTTP ${initRes.status}`);
      return null;
    }

    const initData = (await initRes.json().catch(() => null)) as
      | { success?: unknown; id?: unknown; title?: unknown; info?: { title?: unknown } }
      | null;
    const taskId = typeof initData?.id === 'string' ? initData.id : '';
    if (!taskId) {
      attempts.push('savenow:init returned no id');
      return null;
    }
    const title =
      typeof initData?.title === 'string'
        ? initData.title
        : typeof initData?.info?.title === 'string'
          ? initData.info.title
          : undefined;

    // Decoupled: Immediately return pendingId to client without server-side waiting/polling!
    return { success: true, pendingId: taskId, provider: 'savenow', quality: format, title, attempts };
  } catch (err) {
    attempts.push(`savenow:${errMsg(err)}`);
    return null;
  }
}

/**
 * Resolves a direct YouTube download URL on the server via the 2-provider fallback chain.
 * Wrapped in a top-level try/catch to guarantee returning clean JSON and never crashing the server.
 */
export async function resolveYouTubeServerSide(
  urlOrVideoId: string,
  formatInput: unknown
): Promise<YouTubeResolveResult> {
  try {
    const videoId = normalizeYouTubeVideoId(urlOrVideoId);
    if (!videoId) {
      return { success: false, error: 'Không nhận diện được ID video YouTube.' };
    }
    const format = normalizeYouTubeFormat(formatInput);
    const attempts: string[] = [];

    // Provider A: Savetube Multi-CDN
    const savetube = await resolveViaSavetube(videoId, format, attempts);
    if (savetube) return savetube;

    // Provider B: Savenow / Loader.to Fallback
    const savenow = await resolveViaSaveNow(videoId, format, attempts);
    if (savenow) return savenow;

    console.warn('[YouTube Resolver] All providers failed:', attempts.join(' | '));
    return {
      success: false,
      error: 'Hệ thống tải đang quá tải, vui lòng thử lại sau hoặc chọn định dạng khác.',
      attempts,
    };
  } catch (fatalErr) {
    console.error('[YouTube Resolver Fatal Error]:', fatalErr);
    return {
      success: false,
      error: fatalErr instanceof Error ? fatalErr.message : 'Lỗi phân giải video YouTube.',
    };
  }
}

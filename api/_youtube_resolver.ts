import { createDecipheriv } from 'node:crypto';

/**
 * Server-Side YouTube Resolver Proxy (shared by Vercel Serverless `api/social/extract.ts`
 * and the Vite dev middleware `src/server/socialExtractor.ts`).
 *
 * Runs entirely on the server so that `Origin`, `Referer` and `User-Agent` are controlled by us:
 * - Provider A: Savetube Multi-CDN (spoofed as `ytshorts.savetube.me`), AES-128-CBC decryption,
 *   retry across up to 3 CDN hosts and quality fallback (1080 -> 720 -> 360).
 * - Provider B: Savenow / Loader.to (`p.savenow.to`, spoofed as `en.loader.to`) with short server polling,
 *   returning a `pendingId` for long conversions so the serverless function never times out.
 *
 * The file name starts with `_` so Vercel does not deploy it as a separate Serverless Function.
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

const SAVETUBE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://ytshorts.savetube.me',
  Referer: 'https://ytshorts.savetube.me/',
  'User-Agent': BROWSER_UA,
};

const SAVENOW_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://en.loader.to',
  Referer: 'https://en.loader.to/',
  'User-Agent': BROWSER_UA,
};

const SAVETUBE_AES_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
const SAVETUBE_CDN_POOL = [
  'cdn401.savetube.vip',
  'cdn402.savetube.vip',
  'cdn404.savetube.vip',
  'cdn405.savetube.vip',
  'cdn406.savetube.vip',
];
const SAVETUBE_MAX_CDN_ATTEMPTS = 3;

const SAVENOW_API_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';
const SAVENOW_INITIAL_POLLS = 3;
const SAVENOW_POLL_INTERVAL_MS = 1200;

const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
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

async function getSavetubeCdnCandidates(): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const cdnRes = await fetch('https://media.savetube.vip/api/random-cdn', {
      headers: SAVETUBE_HEADERS,
      signal: AbortSignal.timeout(4000),
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

function savetubeQualityChain(format: YouTubeResolveFormat): string[] {
  if (format === 'mp3') return ['128'];
  if (format === '1080') return ['1080', '720', '360'];
  if (format === '720') return ['720', '360'];
  return ['360'];
}

async function trySavetubeOnCdn(
  cdn: string,
  youtubeUrl: string,
  format: YouTubeResolveFormat
): Promise<{ url: string; quality: string; title?: string }> {
  const infoRes = await fetch(`https://${cdn}/v2/info`, {
    method: 'POST',
    headers: SAVETUBE_HEADERS,
    body: JSON.stringify({ url: youtubeUrl }),
    signal: AbortSignal.timeout(8000),
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

  const downloadType = format === 'mp3' ? 'audio' : 'video';
  let lastError: Error | null = null;

  for (const quality of savetubeQualityChain(format)) {
    try {
      const dlRes = await fetch(`https://${cdn}/download`, {
        method: 'POST',
        headers: SAVETUBE_HEADERS,
        body: JSON.stringify({ downloadType, quality, key }),
        signal: AbortSignal.timeout(10000),
      });
      if (dlRes.status === 429) {
        lastError = new RateLimitError(`${cdn}/download ${quality} 429`);
        continue;
      }
      if (!dlRes.ok) {
        lastError = new Error(`${cdn}/download ${quality} HTTP ${dlRes.status}`);
        continue;
      }
      const dlJson = (await dlRes.json().catch(() => null)) as { data?: { downloadUrl?: unknown } } | null;
      const downloadUrl = dlJson?.data?.downloadUrl;
      if (typeof downloadUrl === 'string' && downloadUrl.startsWith('http')) {
        return { url: downloadUrl, quality, title };
      }
      lastError = new Error(`${cdn}/download ${quality} returned no downloadUrl`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(errMsg(err));
    }
  }

  throw lastError || new Error(`${cdn}/download failed`);
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
      if (err instanceof RateLimitError) {
        await sleep(300);
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
      headers: SAVENOW_HEADERS,
      signal: AbortSignal.timeout(8000),
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
      headers: SAVENOW_HEADERS,
      signal: AbortSignal.timeout(10000),
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

    for (let i = 0; i < SAVENOW_INITIAL_POLLS; i++) {
      await sleep(SAVENOW_POLL_INTERVAL_MS);
      const prog = await pollYouTubeSaveNowProgress(taskId);
      if (prog.url) {
        return { success: true, url: prog.url, provider: 'savenow', quality: format, title, attempts };
      }
      if (prog.status === 'failed') {
        attempts.push(`savenow:progress ${prog.error || 'failed'}`);
        return null;
      }
    }

    return { success: true, pendingId: taskId, provider: 'savenow', quality: format, title, attempts };
  } catch (err) {
    attempts.push(`savenow:${errMsg(err)}`);
    return null;
  }
}

/**
 * Resolves a direct YouTube download URL on the server via the 2-provider fallback chain.
 */
export async function resolveYouTubeServerSide(
  urlOrVideoId: string,
  formatInput: unknown
): Promise<YouTubeResolveResult> {
  const videoId = normalizeYouTubeVideoId(urlOrVideoId);
  if (!videoId) {
    return { success: false, error: 'Không nhận diện được ID video YouTube.' };
  }
  const format = normalizeYouTubeFormat(formatInput);
  const attempts: string[] = [];

  const savetube = await resolveViaSavetube(videoId, format, attempts);
  if (savetube) return savetube;

  const savenow = await resolveViaSaveNow(videoId, format, attempts);
  if (savenow) return savenow;

  console.warn('[YouTube Resolver] All providers failed:', attempts.join(' | '));
  return {
    success: false,
    error: 'Hệ thống tải đang quá tải, vui lòng thử lại sau.',
    attempts,
  };
}

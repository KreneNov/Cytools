import { createDecipheriv } from 'node:crypto';

/**
 * Server-Side YouTube Resolver Proxy (shared by Vercel Serverless `api/social/extract.ts`
 * and Vite dev middleware `src/server/socialExtractor.ts`).
 *
 * Supports `options.skipSavetube`: when the browser client has already attempted Savetube
 * directly using its residential IP, the server skips Savetube completely so it never
 * re-triggers Savetube's per-video mutex lock ("This video is busy right now").
 *
 * Server-Side Fallback Providers:
 * - Provider A (when skipSavetube is false): Savetube Multi-CDN with 5-minute in-memory
 *   `/v2/info` key caching, 15s muxing timeout, and same-key quality step-down (1080 -> 720 -> 360).
 * - Provider B: Piped / Invidious public API instances for direct muxed video & audio streams.
 * - Provider C: Savenow / Loader.to (`p.savenow.to`) decoupled task initialization.
 *
 * Guaranteed to never throw unhandled exceptions or return HTTP 502.
 */

export type YouTubeResolveFormat = '1080' | '720' | '360' | 'mp3';

export interface YouTubeResolveOptions {
  skipSavetube?: boolean;
}

export interface YouTubeResolveResult {
  success: boolean;
  url?: string;
  pendingId?: string;
  provider?: 'savetube' | 'piped' | 'invidious' | 'savenow';
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

interface ServerCachedSavetubeInfo {
  cdn: string;
  key: string;
  title?: string;
  videoFormats: Array<Record<string, unknown>>;
  expiresAt: number;
}

const serverSavetubeInfoCache = new Map<string, ServerCachedSavetubeInfo>();
const SAVETUBE_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

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
  'cdn400.savetube.vip',
  'cdn401.savetube.vip',
  'cdn403.savetube.vip',
  'cdn405.savetube.vip',
  'cdn406.savetube.vip',
];
const DEAD_SAVETUBE_CDNS = new Set(['cdn402.savetube.vip', 'cdn404.savetube.vip']);
const SAVETUBE_MAX_CDN_ATTEMPTS = 2;

const PIPED_API_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.adminforge.de',
];

const INVIDIOUS_API_INSTANCES = [
  'https://inv.tux.pizza',
  'https://invidious.nerdvpn.de',
];

const SAVENOW_API_KEY = 'dfcb6d76f2f6a9894gjkege8a4ab232222';

const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

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
 * Resilient recursive URL extractor across all known Savetube response formats.
 */
export function extractUrlFromAny(target: unknown): string | null {
  if (!target) return null;

  if (typeof target === 'string') {
    const s = target.trim();
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return s;
    }
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

async function getSavetubeCdnCandidates(): Promise<string[]> {
  const candidates: string[] = [];
  try {
    const cdnRes = await fetch('https://media.savetube.vip/api/random-cdn', {
      headers: getSavetubeHeaders(),
      signal: AbortSignal.timeout(2500),
    });
    if (cdnRes.ok) {
      const cdnData = (await cdnRes.json().catch(() => null)) as { cdn?: unknown } | null;
      const cdn = typeof cdnData?.cdn === 'string' ? cdnData.cdn.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase() : '';
      if (cdn && /^[a-z0-9.-]+\.savetube\.vip$/i.test(cdn) && !DEAD_SAVETUBE_CDNS.has(cdn)) {
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

async function getOrFetchServerSavetubeInfo(
  videoId: string,
  youtubeUrl: string,
  attempts: string[]
): Promise<ServerCachedSavetubeInfo | null> {
  const now = Date.now();
  const cached = serverSavetubeInfoCache.get(videoId);
  if (cached && cached.expiresAt > now && cached.key && cached.cdn) {
    return cached;
  }

  const cdns = await getSavetubeCdnCandidates();
  for (const cdn of cdns) {
    try {
      const infoRes = await fetch(`https://${cdn}/v2/info`, {
        method: 'POST',
        headers: getSavetubeHeaders(),
        body: JSON.stringify({ url: youtubeUrl }),
        signal: AbortSignal.timeout(8000),
      });
      if (!infoRes.ok) {
        attempts.push(`savetube:${cdn}/v2/info HTTP ${infoRes.status}`);
        continue;
      }

      const infoJson = (await infoRes.json().catch(() => null)) as { status?: unknown; data?: unknown } | null;
      if (!infoJson?.status || typeof infoJson.data !== 'string') {
        attempts.push(`savetube:${cdn}/v2/info no encrypted payload`);
        continue;
      }

      const decrypted = decryptSavetubePayload(infoJson.data);
      const key = typeof decrypted.key === 'string' ? decrypted.key : '';
      if (!key) {
        attempts.push(`savetube:${cdn}/v2/info no key`);
        continue;
      }

      const title = typeof decrypted.title === 'string' ? decrypted.title : undefined;
      const videoFormats = Array.isArray(decrypted.video_formats)
        ? (decrypted.video_formats as Array<Record<string, unknown>>)
        : [];

      const entry: ServerCachedSavetubeInfo = {
        cdn,
        key,
        title,
        videoFormats,
        expiresAt: Date.now() + SAVETUBE_INFO_CACHE_TTL_MS,
      };
      serverSavetubeInfoCache.set(videoId, entry);
      return entry;
    } catch (err) {
      attempts.push(`savetube:${cdn}/v2/info ${errMsg(err)}`);
    }
  }

  return null;
}

async function resolveViaSavetube(
  videoId: string,
  format: YouTubeResolveFormat,
  attempts: string[]
): Promise<YouTubeResolveResult | null> {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await getOrFetchServerSavetubeInfo(videoId, youtubeUrl, attempts);
  if (!info) return null;

  const { cdn, key, title, videoFormats } = info;

  // 1. Direct playback stream shortcut if present in videoFormats
  if (format !== 'mp3' && videoFormats.length > 0) {
    const targetQNum = Number(format);
    const directMatch = videoFormats.find(
      (f) => Number(f.quality) === targetQNum && typeof f.url === 'string' && f.url.startsWith('http')
    );
    if (directMatch && typeof directMatch.url === 'string') {
      return {
        success: true,
        url: directMatch.url,
        provider: 'savetube',
        quality: format,
        title,
        attempts,
      };
    }
  }

  // 2. Determine requested quality
  let requestedQuality = format === 'mp3' ? '128' : format;
  if (format !== 'mp3' && videoFormats.length > 0) {
    const availableQualities = videoFormats
      .map((f) => String(f.quality || ''))
      .filter(Boolean);
    if (format === '1080' && availableQualities.length > 0 && !availableQualities.includes('1080')) {
      requestedQuality = availableQualities.includes('720') ? '720' : '360';
    }
  }

  const downloadType = format === 'mp3' ? 'audio' : 'video';

  const requestDownload = async (q: string): Promise<{ url: string | null; isBusy: boolean; status: number }> => {
    const dlRes = await fetch(`https://${cdn}/download`, {
      method: 'POST',
      headers: getSavetubeHeaders(),
      body: JSON.stringify({ downloadType, quality: q, key }),
      signal: AbortSignal.timeout(12000),
    });
    const dlJson = (await dlRes.json().catch(() => null)) as Record<string, unknown> | null;
    const url = extractUrlFromAny(dlJson);
    const msg = typeof dlJson?.message === 'string' ? dlJson.message.toLowerCase() : '';
    const isBusy = msg.includes('busy') || (dlJson !== null && dlJson.status === false && !url);
    return { url, isBusy, status: dlRes.status };
  };

  try {
    let outcome = await requestDownload(requestedQuality);
    if (outcome.url) {
      return {
        success: true,
        url: outcome.url,
        provider: 'savetube',
        quality: requestedQuality,
        title,
        attempts,
      };
    }

    if (outcome.isBusy) {
      attempts.push(`savetube:${cdn}/download ${requestedQuality} busy`);
      await sleep(2000);
      outcome = await requestDownload(requestedQuality);
      if (outcome.url) {
        return {
          success: true,
          url: outcome.url,
          provider: 'savetube',
          quality: requestedQuality,
          title,
          attempts,
        };
      }
    }

    if (format !== 'mp3') {
      const stepDown = requestedQuality === '1080' ? ['720', '360'] : requestedQuality === '720' ? ['360'] : [];
      for (const fallbackQ of stepDown) {
        const fallbackOutcome = await requestDownload(fallbackQ);
        if (fallbackOutcome.url) {
          return {
            success: true,
            url: fallbackOutcome.url,
            provider: 'savetube',
            quality: fallbackQ,
            title,
            attempts,
          };
        }
      }
    }

    attempts.push(`savetube:${cdn}/download ${requestedQuality} HTTP ${outcome.status} no downloadUrl`);
  } catch (err) {
    attempts.push(`savetube:${cdn}/download ${errMsg(err)}`);
  }

  return null;
}

/**
 * Resolves direct muxed video or audio streams via public Piped & Invidious API instances.
 * Completely independent from Savetube's per-video mutex lock.
 */
async function resolveViaPipedOrInvidious(
  videoId: string,
  format: YouTubeResolveFormat,
  attempts: string[]
): Promise<YouTubeResolveResult | null> {
  // 1. Try Piped API instances
  for (const instance of PIPED_API_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${encodeURIComponent(videoId)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': BROWSER_UA,
        },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) {
        attempts.push(`piped:${new URL(instance).hostname} HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json().catch(() => null)) as {
        title?: unknown;
        audioStreams?: Array<Record<string, unknown>>;
        videoStreams?: Array<Record<string, unknown>>;
      } | null;

      if (!data) continue;
      const title = typeof data.title === 'string' ? data.title : undefined;

      if (format === 'mp3' && Array.isArray(data.audioStreams)) {
        const validAudio = data.audioStreams
          .filter((s) => typeof s.url === 'string' && s.url.startsWith('http'))
          .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
        if (validAudio.length > 0 && typeof validAudio[0].url === 'string') {
          return {
            success: true,
            url: validAudio[0].url,
            provider: 'piped',
            quality: 'mp3',
            title,
            attempts,
          };
        }
      }

      if (format !== 'mp3' && Array.isArray(data.videoStreams)) {
        const muxedVideos = data.videoStreams.filter(
          (s) => s.videoOnly === false && typeof s.url === 'string' && s.url.startsWith('http')
        );
        if (muxedVideos.length > 0) {
          const preferred =
            muxedVideos.find((s) => String(s.quality || '').includes(format)) ||
            muxedVideos.find((s) => String(s.quality || '').includes('720')) ||
            muxedVideos[0];
          if (preferred && typeof preferred.url === 'string') {
            return {
              success: true,
              url: preferred.url,
              provider: 'piped',
              quality: typeof preferred.quality === 'string' ? preferred.quality : format,
              title,
              attempts,
            };
          }
        }
      }
    } catch (err) {
      attempts.push(`piped:${new URL(instance).hostname} ${errMsg(err)}`);
    }
  }

  // 2. Try Invidious API instances
  for (const instance of INVIDIOUS_API_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${encodeURIComponent(videoId)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': BROWSER_UA,
        },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) {
        attempts.push(`invidious:${new URL(instance).hostname} HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json().catch(() => null)) as {
        title?: unknown;
        formatStreams?: Array<Record<string, unknown>>;
        adaptiveFormats?: Array<Record<string, unknown>>;
      } | null;

      if (!data) continue;
      const title = typeof data.title === 'string' ? data.title : undefined;

      if (format === 'mp3' && Array.isArray(data.adaptiveFormats)) {
        const audioStreams = data.adaptiveFormats.filter(
          (s) =>
            typeof s.type === 'string' &&
            s.type.startsWith('audio/') &&
            typeof s.url === 'string' &&
            s.url.startsWith('http')
        );
        if (audioStreams.length > 0 && typeof audioStreams[0].url === 'string') {
          return {
            success: true,
            url: audioStreams[0].url,
            provider: 'invidious',
            quality: 'mp3',
            title,
            attempts,
          };
        }
      }

      if (format !== 'mp3' && Array.isArray(data.formatStreams)) {
        const muxedStreams = data.formatStreams.filter(
          (s) => typeof s.url === 'string' && s.url.startsWith('http')
        );
        if (muxedStreams.length > 0) {
          const preferred =
            muxedStreams.find((s) => String(s.qualityLabel || '').includes(format)) ||
            muxedStreams.find((s) => String(s.qualityLabel || '').includes('720')) ||
            muxedStreams[0];
          if (preferred && typeof preferred.url === 'string') {
            return {
              success: true,
              url: preferred.url,
              provider: 'invidious',
              quality: typeof preferred.qualityLabel === 'string' ? preferred.qualityLabel : format,
              title,
              attempts,
            };
          }
        }
      }
    } catch (err) {
      attempts.push(`invidious:${new URL(instance).hostname} ${errMsg(err)}`);
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
 * Resolves a direct YouTube download URL on the server.
 * When `options.skipSavetube` is true (because the browser client already tried Savetube),
 * skips Savetube completely so the server does not re-trigger Savetube's per-video mutex lock.
 */
export async function resolveYouTubeServerSide(
  urlOrVideoId: string,
  formatInput: unknown,
  options?: YouTubeResolveOptions
): Promise<YouTubeResolveResult> {
  try {
    const videoId = normalizeYouTubeVideoId(urlOrVideoId);
    if (!videoId) {
      return { success: false, error: 'Không nhận diện được ID video YouTube.' };
    }
    const format = normalizeYouTubeFormat(formatInput);
    const attempts: string[] = [];

    // Provider A: Savetube Multi-CDN (only when client did not already attempt it)
    if (!options?.skipSavetube) {
      const savetube = await resolveViaSavetube(videoId, format, attempts);
      if (savetube) return savetube;
    } else {
      attempts.push('savetube:skipped(client_already_tried)');
    }

    // Provider B: Savenow / Loader.to Decoupled Task Initialization
    const savenow = await resolveViaSaveNow(videoId, format, attempts);
    if (savenow) return savenow;

    // Provider C: Piped / Invidious Public Stream Extraction (immune to Savetube mutex lock & Savenow Cloudflare block)
    const pipedOrInvidious = await resolveViaPipedOrInvidious(videoId, format, attempts);
    if (pipedOrInvidious) return pipedOrInvidious;

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

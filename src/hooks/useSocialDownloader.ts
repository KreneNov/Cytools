import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import type {
  ExtractionResult,
  DownloadProgress,
  DownloadStage,
  SlideshowImageItem,
} from '../types/socialDownloader';
import { apiFetch } from '../utils/apiConfig';
import { getApiUrl } from '../utils/api';

export interface UseSocialDownloaderReturn {
  isExtracting: boolean;
  extractError: string | null;
  result: ExtractionResult | null;
  downloadProgress: DownloadProgress;
  extractMedia: (url: string) => Promise<ExtractionResult | null>;
  downloadMediaFile: (
    mediaUrl: string,
    targetFileName: string,
    optionId?: string
  ) => Promise<void>;
  downloadAllAsZip: (
    images: SlideshowImageItem[],
    albumTitle: string,
    onProTrigger?: () => void
  ) => Promise<void>;
  clearDownloadError: () => void;
  reset: () => void;
}

const INITIAL_PROGRESS: DownloadProgress = {
  isDownloading: false,
  activeOptionId: undefined,
  loadedBytes: 0,
  totalBytes: 0,
  percentage: 0,
  fileName: '',
  stage: 'video',
  status: 'idle',
};

const SAVETUBE_AES_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';

/**
 * Strips unwanted upstream branding domains and suffixes (e.g. -ytshorts.savetube.me, savenow, cobalt...)
 * and sanitizes illegal OS file system characters (\ / : * ? " < > |), control characters,
 * leading dots/slashes, and trailing dots to prevent Chrome Extension "Invalid filename" errors.
 */
export function cleanDownloadFilename(filename: string): string {
  if (!filename) return 'cytools-video.mp4';

  const dotIdx = filename.lastIndexOf('.');
  const hasExt = dotIdx !== -1 && dotIdx > 0;
  const ext = hasExt ? filename.slice(dotIdx) : '.mp4';
  let name = hasExt ? filename.slice(0, dotIdx) : filename;

  // 1. Remove known branding domains, subdomains, and platform artifacts
  const brandingRegex =
    /[-_.]?(?:ytshorts\.)?(?:savetube\.(?:me|vip|su)|oceansaver\.(?:in|net)|savenow\.to|cobalt\.tools|loader\.to|tikwm\.com|snaptik\.app|y2mate\.com|ytshorts)/gi;
  name = name.replace(brandingRegex, '');

  // 2. Replace illegal OS characters (\ / : * ? " < > |) with underscore
  name = name.replace(/[\\/:"*?<>|]/g, '_');

  // 3. Remove non-printable control characters (ASCII 0-31, 127-159)
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

  // 4. Remove leading dots, slashes, or whitespace (prevents hidden files or relative path traversal)
  name = name.replace(/^[.\s\\/]+/, '');

  // 5. Remove trailing dots or whitespace before the extension (Windows illegal trailing period)
  name = name.replace(/[.\s]+$/, '');

  // 6. Collapse consecutive dashes/underscores and trim trailing/leading separators
  name = name.replace(/[-_]{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');

  // 7. Safe fallback if filename became empty after stripping illegal characters
  if (!name.trim()) {
    const isAudio =
      ext.toLowerCase().includes('mp3') ||
      ext.toLowerCase().includes('m4a') ||
      ext.toLowerCase().includes('wav') ||
      ext.toLowerCase().includes('aac') ||
      ext.toLowerCase().includes('opus');
    name = isAudio ? 'cytools-audio' : 'cytools-video';
  }

  return name + ext;
}

/**
 * Decrypts SaveTube VIP v2 AES-128-CBC encrypted info payload using native Web Crypto API.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function decryptSaveTubeData(encryptedBase64: string): Promise<any> {
  const cleanB64 = encryptedBase64.replace(/\s/g, '');
  const binaryStr = atob(cleanB64);
  const rawBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    rawBytes[i] = binaryStr.charCodeAt(i);
  }
  const iv = rawBytes.slice(0, 16);
  const ciphertext = rawBytes.slice(16);

  const keyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    keyBytes[i] = parseInt(SAVETUBE_AES_KEY_HEX.slice(i * 2, i * 2 + 2), 16);
  }

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-CBC' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    ciphertext
  );

  const decodedText = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedText);
}

const SAVETUBE_DISCOVERY_ENDPOINTS = [
  'https://media.savetube.vip/api/random-cdn',
  'https://media.savetube.me/api/random-cdn',
];

interface YouTubeResolutionResult {
  url: string | null;
  failureReason?: 'rate_limit' | 'timeout' | 'network';
}

/**
 * Resolves a direct YouTube download URL 100% client-side (completely bypassing Vercel /api/download):
 * 1. Engine 1 (Primary): SaveTube VIP / ME CDN v2 (45s timeout for long 1080p muxing + fresh node retry on 429/error).
 * 2. Engine 2 (Fallback 1): Client-side Cobalt v10 via https://rue-cobalt.xenon.zone/ (strict v10 payload, no dead /api/json URLs).
 * 3. Engine 3 (Fallback 2): Loader.to / OceanSaver (https://p.savenow.to) client-side polling.
 * 4. Engine 4 (Extension Fallback): Chrome Extension Direct Innertube ANDROID_VR.
 */
async function resolveYouTubeClientSide(
  videoId: string,
  quality: '1080p' | '720p',
  type: 'video' | 'audio'
): Promise<YouTubeResolutionResult> {
  const targetYouTubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let failureReason: 'rate_limit' | 'timeout' | 'network' = 'network';

  // Engine 1 (Primary): SaveTube VIP / ME CDN v2 with 300s (5m) muxing timeout & fresh CDN node retry
  for (const discoveryUrl of SAVETUBE_DISCOVERY_ENDPOINTS) {
    try {
      const cdnRes = await fetch(discoveryUrl, {
        signal: AbortSignal.timeout(30000),
      });
      if (cdnRes.status === 429) {
        failureReason = 'rate_limit';
        continue;
      }
      if (!cdnRes.ok) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cdnData: any = await cdnRes.json();
      const cdnHost = cdnData?.cdn || 'cdn405.savetube.vip';

      const infoRes = await fetch(`https://${cdnHost}/v2/info`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: targetYouTubeUrl }),
        signal: AbortSignal.timeout(60000),
      });

      if (infoRes.status === 429) {
        failureReason = 'rate_limit';
        continue;
      }
      if (!infoRes.ok) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const infoJson: any = await infoRes.json();
      if (infoJson?.status && typeof infoJson.data === 'string') {
        const decrypted = await decryptSaveTubeData(infoJson.data);
        if (decrypted?.key) {
          const downloadType = type === 'audio' ? 'audio' : 'video';
          const targetQualities =
            type === 'audio'
              ? ['128']
              : quality === '1080p'
                ? ['1080', '720', '360']
                : ['720', '360'];

          for (const q of targetQualities) {
            const dlRes = await fetch(`https://${cdnHost}/download`, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                downloadType,
                quality: q,
                key: decrypted.key,
                title: cleanDownloadFilename(decrypted?.title || 'video'),
              }),
              // 300,000ms (5 minutes) timeout so massive/long videos never prematurely abort during muxing
              signal: AbortSignal.timeout(300000),
            });

            if (dlRes.status === 429) {
              failureReason = 'rate_limit';
              throw new Error('SAVETUBE_RATE_LIMITED_429');
            }

            if (!dlRes.ok) {
              continue;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dlJson: any = await dlRes.json();
            if (dlJson?.status === false && String(dlJson?.message || '').includes('429')) {
              failureReason = 'rate_limit';
              throw new Error('SAVETUBE_RATE_LIMITED_429');
            }

            const resolvedLink = dlJson?.data?.downloadUrl;
            if (
              resolvedLink &&
              typeof resolvedLink === 'string' &&
              resolvedLink.startsWith('http')
            ) {
              return { url: resolvedLink };
            }
          }
        }
      }
    } catch (saveTubeErr) {
      if (
        saveTubeErr instanceof Error &&
        (saveTubeErr.name === 'TimeoutError' || saveTubeErr.name === 'AbortError')
      ) {
        failureReason = 'timeout';
      }
      console.warn(
        `[useSocialDownloader] Savetube node (${discoveryUrl}) failed, retrying next CDN or fallback:`,
        saveTubeErr
      );
    }
  }

  // Engine 2 (Fallback 1): Strict Cobalt v10 on https://rue-cobalt.xenon.zone/ (root path /, NO isAudioOnly)
  try {
    const cobaltRes = await fetch('https://rue-cobalt.xenon.zone/', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetYouTubeUrl,
        videoQuality: quality === '1080p' ? '1080' : '720',
        downloadMode: type === 'audio' ? 'audio' : 'auto',
        youtubeVideoCodec: 'h264',
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (cobaltRes.status === 429) {
      failureReason = 'rate_limit';
    } else if (cobaltRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await cobaltRes.json().catch(() => null);
      const cobaltUrl = data?.url || data?.picker?.[0]?.url;
      if (cobaltUrl && typeof cobaltUrl === 'string' && cobaltUrl.startsWith('http')) {
        return { url: cobaltUrl };
      }
    }
  } catch (cobaltErr) {
    if (
      cobaltErr instanceof Error &&
      (cobaltErr.name === 'TimeoutError' || cobaltErr.name === 'AbortError')
    ) {
      failureReason = 'timeout';
    }
    console.warn('[useSocialDownloader] Fallback 1 (rue-cobalt.xenon.zone) failed:', cobaltErr);
  }

  // Engine 3 (Fallback 2): Loader.to / OceanSaver (p.savenow.to) Client-Side Polling
  try {
    const format = type === 'audio' ? 'mp3' : quality === '1080p' ? '1080' : '720';
    const initUrl = `https://p.savenow.to/ajax/download.php?copyright=0&format=${format}&url=${encodeURIComponent(targetYouTubeUrl)}&api=dfcb6d76f2f6a9894gjkege8a4ab232222`;
    const initRes = await fetch(initUrl, {
      signal: AbortSignal.timeout(60000),
    });

    if (initRes.status === 429) {
      failureReason = 'rate_limit';
    } else if (initRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initData: any = await initRes.json().catch(() => null);
      if (initData?.id) {
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const progRes = await fetch(
            `https://p.savenow.to/ajax/progress.php?id=${encodeURIComponent(initData.id)}`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!progRes.ok) continue;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const progData: any = await progRes.json().catch(() => null);
          if (
            progData &&
            (progData.progress === 1000 || progData.success === 1) &&
            typeof progData.download_url === 'string' &&
            progData.download_url.startsWith('http')
          ) {
            return { url: progData.download_url };
          }
          if (
            progData &&
            progData.success === 0 &&
            typeof progData.text === 'string' &&
            progData.text.toLowerCase().includes('error')
          ) {
            break;
          }
        }
      }
    }
  } catch (savenowErr) {
    if (
      savenowErr instanceof Error &&
      (savenowErr.name === 'TimeoutError' || savenowErr.name === 'AbortError')
    ) {
      failureReason = 'timeout';
    }
    console.warn('[useSocialDownloader] Fallback 2 (p.savenow.to) failed:', savenowErr);
  }

  // Engine 4 (Extension Fallback): Chrome Extension Direct Innertube ANDROID_VR
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;
  if (chromeObj?.downloads?.download) {
    try {
      const vrRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID_VR',
              clientVersion: '1.60.19',
              deviceMake: 'Oculus',
              deviceModel: 'Quest 3',
              osName: 'Android',
              osVersion: '12L',
              androidSdkVersion: 32,
              hl: 'vi',
              gl: 'VN',
            },
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (vrRes.ok && vrRes.status !== 429) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vrJson: any = await vrRes.json();
        if (vrJson.playabilityStatus?.status === 'OK') {
          const formats = vrJson.streamingData?.formats || [];
          const adaptive = vrJson.streamingData?.adaptiveFormats || [];
          if (type === 'audio') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const aFmt =
              adaptive.find((f: any) => f.url && f.itag === 140) ||
              adaptive.find((f: any) => f.url && f.mimeType?.includes('audio/mp4'));
            if (aFmt?.url) return { url: aFmt.url };
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preMuxed =
              formats.find((f: any) => f.url && f.mimeType?.includes('video/mp4')) ||
              formats.find((f: any) => f.url);
            if (preMuxed?.url) return { url: preMuxed.url };
          }
        }
      }
    } catch {
      // Ignore extension Innertube error
    }
  }

  return { url: null, failureReason };
}

/**
 * Triggers a direct native download on the client without jumping tabs and without buffering files in JS memory:
 * - Chrome Extension: Uses chrome.downloads.download({ url, filename: cleanName }) (writes directly to disk)
 * - Web App:
 *    1. URLs with guaranteed attachment headers (SaveTube VIP/ME CDN, Cobalt tunnel, SaveNow): Hidden iframe injection directly to `url`.
 *    2. Direct CDN URLs (TikTok, Facebook, Instagram, Pinterest, etc.): Hidden iframe injection to `/api/download?url=...&filename=...`
 *       which streams with `Content-Disposition: attachment` so the browser's native download manager starts immediately within 500ms without opening a new tab.
 */
export async function triggerDirectDownload(url: string, filename: string): Promise<void> {
  const cleanName = cleanDownloadFilename(filename);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;

  // 1. Extension Environment (Bulletproof - chrome.downloads writes directly to disk regardless of headers or size)
  if (chromeObj?.downloads?.download) {
    await new Promise<void>((resolve, reject) => {
      chromeObj.downloads.download(
        {
          url,
          filename: cleanName,
          saveAs: false,
        },
        (downloadId?: number) => {
          if (chromeObj.runtime?.lastError || !downloadId) {
            reject(
              new Error(
                chromeObj.runtime?.lastError?.message ||
                  'Không thể khởi động tải xuống qua trình quản lý tiện ích.'
              )
            );
          } else {
            resolve();
          }
        }
      );
    });
    return;
  }

  // 2. Web App - Tunnel/API/CDN URLs with guaranteed attachment headers (SaveTube CDN, Cobalt tunnel, SaveNow...)
  const isAttachmentGuaranteed =
    url.includes('/tunnel') ||
    url.includes('xenon.zone') ||
    url.includes('savenow.to') ||
    url.includes('oceansaver.in') ||
    url.includes('loader.to') ||
    url.includes('savetube.vip') ||
    url.includes('savetube.me') ||
    url.includes('savetube.su');

  const streamUrl = isAttachmentGuaranteed
    ? url
    : getApiUrl(
        `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(cleanName)}`
      );

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = streamUrl;
  document.body.appendChild(iframe);
  setTimeout(() => {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }, 60000);
}

export const useSocialDownloader = (): UseSocialDownloaderReturn => {
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>(INITIAL_PROGRESS);

  const extractMedia = useCallback(async (url: string): Promise<ExtractionResult | null> => {
    setIsExtracting(true);
    setExtractError(null);
    setResult(null);
    setDownloadProgress(INITIAL_PROGRESS);

    try {
      const cleanUrl = url.trim();
      const isInstagram =
        cleanUrl.includes('instagram.com/reel/') ||
        cleanUrl.includes('instagram.com/p/') ||
        cleanUrl.includes('instagram.com/tv/') ||
        cleanUrl.includes('instagr.am') ||
        cleanUrl.includes('instagram.com');

      if (isInstagram) {
        // Direct Client-Side Cobalt v10 Extraction for Instagram using rue-cobalt.xenon.zone (Permissive CORS)
        let directVideoUrl: string | null = null;
        let thumbUrl: string | undefined = undefined;

        try {
          const response = await fetch('https://rue-cobalt.xenon.zone/', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: cleanUrl,
              downloadMode: 'auto',
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (response.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resJson: any = await response.json();
            directVideoUrl = resJson.url || resJson.picker?.[0]?.url || null;
            thumbUrl = resJson.picker?.[0]?.thumb || undefined;
          }
        } catch (cobaltErr) {
          console.warn('[useSocialDownloader] Client rue-cobalt Instagram attempt failed:', cobaltErr);
        }

        // Parallel / Fallback: Server-side extractor via /api/social/extract if client rue-cobalt failed or returned no URL
        if (!directVideoUrl) {
          try {
            const apiRes = await apiFetch(`/api/social/extract?url=${encodeURIComponent(cleanUrl)}`);
            if (apiRes.ok) {
              const serverData = await apiRes.json();
              if (serverData.success && (serverData.videoHd || serverData.mediaOptions?.length)) {
                setResult(serverData);
                return serverData;
              }
            }
          } catch (serverErr) {
            console.warn('[useSocialDownloader] Server fallback Instagram extraction failed:', serverErr);
          }
        }

        if (directVideoUrl) {
          const igData: ExtractionResult = {
            success: true,
            platform: 'instagram',
            type: 'video',
            title: 'Instagram Reels Video',
            thumbnail: thumbUrl,
            author: { name: 'Instagram Creator' },
            videoHd: directVideoUrl,
            videoSd: directVideoUrl,
            mediaOptions: [
              {
                id: 'instagram_video_hd',
                label: 'Tải Video Instagram MP4 (HD)',
                description: 'Chất lượng cao nhất từ máy chủ CDN',
                format: 'mp4',
                quality: 'HD',
                url: directVideoUrl,
              },
              {
                id: 'instagram_audio',
                label: 'Tách Âm Thanh MP3 / M4A',
                description: 'Bóc tách âm thanh độc lập',
                format: 'mp3',
                quality: 'Audio',
                isAudio: true,
                url: directVideoUrl,
              },
            ],
          };
          setResult(igData);
          return igData;
        }

        throw new Error(
          'Không thể trích xuất video từ liên kết Instagram này. Vui lòng kiểm tra lại liên kết hoặc thử lại sau.'
        );
      }

      const response = await apiFetch(`/api/social/extract?url=${encodeURIComponent(cleanUrl)}`);
      const rawText = await response.text();

      let data: ExtractionResult;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          response.status === 404
            ? 'Không tìm thấy cổng dịch vụ bóc tách phương tiện trên máy chủ (HTTP 404).'
            : `Máy chủ phản hồi định dạng không hợp lệ (${response.status}): ${rawText.slice(0, 100)}`
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Không thể trích xuất phương tiện từ liên kết này.');
      }

      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi bóc tách liên kết.';
      setExtractError(msg);
      return null;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const clearDownloadError = useCallback(() => {
    setDownloadProgress(INITIAL_PROGRESS);
  }, []);

  const downloadMediaFile = useCallback(
    async (
      mediaUrl: string,
      targetFileName: string,
      optionId?: string
    ): Promise<void> => {
      const cleanTargetFileName = cleanDownloadFilename(targetFileName);

      setDownloadProgress({
        isDownloading: true,
        activeOptionId: optionId,
        loadedBytes: 0,
        totalBytes: 0,
        percentage: 15,
        fileName: cleanTargetFileName,
        stage: 'video',
        status: 'downloading',
      });

      let stageTimer: ReturnType<typeof setTimeout> | null = null;
      let isStageTimerStopped = false;
      const stopStageTimer = () => {
        isStageTimerStopped = true;
        if (stageTimer) {
          clearTimeout(stageTimer);
          stageTimer = null;
        }
      };

      const scheduleStageProgression = () => {
        if (isStageTimerStopped) return;
        stageTimer = setTimeout(() => {
          if (isStageTimerStopped) return;
          setDownloadProgress((prev) => {
            if (!prev.isDownloading || isStageTimerStopped) return prev;
            let nextPercent = prev.percentage + 18;
            if (nextPercent > 90) nextPercent = 90;
            let nextStage: DownloadStage = 'video';
            if (nextPercent >= 70) nextStage = 'muxing';
            else if (nextPercent >= 35) nextStage = 'audio';

            return {
              ...prev,
              percentage: nextPercent,
              stage: nextStage,
            };
          });
          if (!isStageTimerStopped) {
            scheduleStageProgression();
          }
        }, 350);
      };
      scheduleStageProgression();

      try {
        let directUrl = mediaUrl;

        // Phase 1 & 2: Dedicated YouTube Client-Side Resolution & Direct Download (Bypasses Vercel /api/download)
        const isYouTube =
          optionId?.startsWith('youtube_') ||
          optionId?.startsWith('yt_') ||
          result?.platform === 'youtube' ||
          (mediaUrl &&
            (mediaUrl.includes('youtube.com') ||
              mediaUrl.includes('youtu.be') ||
              mediaUrl.includes('googlevideo.com') ||
              mediaUrl.includes('savetube.vip')));

        if (isYouTube && result?.videoId) {
          const isAudio = optionId === 'youtube_audio' || optionId === 'yt_audio';
          const quality: '1080p' | '720p' =
            optionId === 'youtube_1080p' ||
            optionId === 'yt_1080p' ||
            optionId === 'yt_1440p' ||
            optionId === 'yt_2160p'
              ? '1080p'
              : '720p';
          const mediaType: 'video' | 'audio' = isAudio ? 'audio' : 'video';

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 45,
            stage: isAudio ? 'audio' : 'video',
          }));

          // Resolve direct stream URL 100% client-side (Engine 1: Savetube -> Engine 2: rue-cobalt -> Engine 3: savenow.to -> Engine 4: Extension Innertube)
          const ytResolution = await resolveYouTubeClientSide(result.videoId, quality, mediaType);
          let resolvedYtUrl = ytResolution.url;

          // Fallback to pre-extracted direct URL if available and not a raw youtube watch URL or IP-bound googlevideo URL
          if (
            !resolvedYtUrl &&
            directUrl &&
            directUrl.startsWith('http') &&
            !directUrl.includes('youtube.com/watch') &&
            !directUrl.includes('youtu.be/') &&
            !directUrl.includes('googlevideo.com')
          ) {
            resolvedYtUrl = directUrl;
          }

          if (!resolvedYtUrl) {
            if (ytResolution.failureReason === 'rate_limit') {
              throw new Error(
                'Hệ thống máy chủ xử lý đang quá tải (HTTP 429). Vui lòng thử lại sau ít phút hoặc sử dụng Extension.'
              );
            }
            if (ytResolution.failureReason === 'timeout') {
              throw new Error(
                'Quá thời gian chờ ghép kênh video 1080p dung lượng lớn (Timeout). Vui lòng thử lại hoặc chọn bản 720p.'
              );
            }
            throw new Error(
              'Không thể kết nối máy chủ phân giải luồng YouTube vào lúc này. Vui lòng thử lại sau giây lát.'
            );
          }

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 85,
            stage: 'muxing',
          }));

          // Trigger direct download (chrome.downloads on Extension, Hidden Iframe or <a target="_blank"> on Web App)
          await triggerDirectDownload(resolvedYtUrl, cleanTargetFileName);

          stopStageTimer();
          setDownloadProgress((prev) => ({
            ...prev,
            isDownloading: false,
            percentage: 100,
            stage: 'done',
            status: 'completed',
          }));
          setTimeout(() => {
            setDownloadProgress(INITIAL_PROGRESS);
          }, 3500);
          return;
        }

        // Phase 2.5: Dedicated Instagram Download Flow (Direct CDN / Cobalt Tunnel without Vercel Proxy or Blob RAM buffering)
        const isInstagram =
          optionId?.startsWith('instagram_') ||
          result?.platform === 'instagram' ||
          (mediaUrl && (mediaUrl.includes('instagram.com') || mediaUrl.includes('instagr.am')));

        if (isInstagram) {
          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 60,
            stage: 'video',
          }));

          let resolvedIgUrl = directUrl;

          // If directUrl is not yet resolved or still an Instagram page link, resolve it via rue-cobalt.xenon.zone
          if (
            !resolvedIgUrl ||
            resolvedIgUrl.includes('instagram.com') ||
            resolvedIgUrl.includes('instagr.am')
          ) {
            try {
              const cobaltRes = await fetch('https://rue-cobalt.xenon.zone/', {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  url: result?.videoHd || mediaUrl,
                  downloadMode: 'auto',
                }),
                signal: AbortSignal.timeout(60000),
              });
              if (cobaltRes.ok) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const cJson: any = await cobaltRes.json();
                resolvedIgUrl = cJson.url || cJson.picker?.[0]?.url || resolvedIgUrl;
              }
            } catch {
              // Ignore fallback
            }
          }

          if (
            !resolvedIgUrl ||
            resolvedIgUrl.includes('instagram.com') ||
            resolvedIgUrl.includes('instagr.am')
          ) {
            throw new Error('Không thể phân giải luồng tải Instagram trực tiếp.');
          }

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 85,
            stage: 'muxing',
          }));

          await triggerDirectDownload(resolvedIgUrl, cleanTargetFileName);

          stopStageTimer();
          setDownloadProgress((prev) => ({
            ...prev,
            isDownloading: false,
            percentage: 100,
            stage: 'done',
            status: 'completed',
          }));
          setTimeout(() => {
            setDownloadProgress(INITIAL_PROGRESS);
          }, 3500);
          return;
        }

        // Phase 3: Smart Routing for TikTok, Facebook, Pinterest, and all other platforms
        // Bypasses Vercel (/api/proxy & /api/download) and avoids fetch().blob() RAM/timeout crashes on 400MB+ videos
        setDownloadProgress((prev) => ({
          ...prev,
          percentage: 85,
          stage: 'muxing',
        }));

        await triggerDirectDownload(directUrl, cleanTargetFileName);

        stopStageTimer();

        setDownloadProgress((prev) => ({
          ...prev,
          isDownloading: false,
          percentage: 100,
          stage: 'done',
          status: 'completed',
        }));

        setTimeout(() => {
          setDownloadProgress(INITIAL_PROGRESS);
        }, 3500);
      } catch (err) {
        stopStageTimer();
        const msg =
          err instanceof Error
            ? err.message
            : 'Không thể tải tệp về máy tính vào lúc này. Vui lòng thử lại sau giây lát.';
        console.error('Download stream error:', err);
        setDownloadProgress((prev) => ({
          ...prev,
          isDownloading: false,
          percentage: 0,
          status: 'error',
          errorMessage: msg,
        }));
      }
    },
    [result]
  );

  const downloadAllAsZip = useCallback(
    async (
      images: SlideshowImageItem[],
      albumTitle: string,
      onProTrigger?: () => void
    ): Promise<void> => {
      // Free tier allows up to 3 photos. More than 3 triggers Pro modal!
      if (images.length > 3 && onProTrigger) {
        onProTrigger();
        return;
      }

      setDownloadProgress({
        isDownloading: true,
        activeOptionId: 'zip_all',
        loadedBytes: 0,
        totalBytes: images.length,
        percentage: 5,
        fileName: `${albumTitle}.zip`,
        stage: 'video',
        status: 'processing_zip',
      });

      try {
        const zip = new JSZip();
        const cleanTitle = albumTitle.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_') || 'album';
        const folder = zip.folder(cleanTitle) || zip;

        for (let i = 0; i < images.length; i++) {
          const item = images[i];
          let arrayBuffer: ArrayBuffer | null = null;

          // Try direct client fetch first (fast, residential IP)
          try {
            const res = await fetch(item.url);
            if (res.ok) {
              arrayBuffer = await res.arrayBuffer();
            }
          } catch {
            // Fallback to proxy for small images if CORS restricted
            try {
              const proxyUrl = getApiUrl(`/api/download?url=${encodeURIComponent(item.url)}&filename=image_${i + 1}.jpg`);
              const res = await fetch(proxyUrl);
              if (res.ok) {
                arrayBuffer = await res.arrayBuffer();
              }
            } catch (e) {
              console.warn(`Failed to fetch image ${i + 1} for zip:`, e);
            }
          }

          if (arrayBuffer) {
            folder.file(`image_${String(i + 1).padStart(2, '0')}.jpg`, arrayBuffer);
          }

          setDownloadProgress((prev) => ({
            ...prev,
            loadedBytes: i + 1,
            percentage: Math.round(((i + 1) / images.length) * 80),
            stage: (i + 1) / images.length > 0.5 ? 'audio' : 'video',
          }));
        }

        setDownloadProgress((prev) => ({
          ...prev,
          percentage: 90,
          stage: 'muxing',
          status: 'processing_zip',
        }));

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const objectUrl = URL.createObjectURL(zipBlob);

        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `${cleanTitle}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);

        setDownloadProgress((prev) => ({
          ...prev,
          isDownloading: false,
          percentage: 100,
          stage: 'done',
          status: 'completed',
        }));

        setTimeout(() => {
          setDownloadProgress(INITIAL_PROGRESS);
        }, 3000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi khi tạo file nén ZIP.';
        setDownloadProgress((prev) => ({
          ...prev,
          isDownloading: false,
          percentage: 0,
          status: 'error',
          errorMessage: msg,
        }));
      }
    },
    []
  );

  const reset = useCallback(() => {
    setIsExtracting(false);
    setExtractError(null);
    setResult(null);
    setDownloadProgress(INITIAL_PROGRESS);
  }, []);

  return {
    isExtracting,
    extractError,
    result,
    downloadProgress,
    extractMedia,
    downloadMediaFile,
    downloadAllAsZip,
    clearDownloadError,
    reset,
  };
};

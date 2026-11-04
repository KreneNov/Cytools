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

/**
 * Strips unwanted upstream branding domains and suffixes
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

type YouTubeResolveFormat = '1080' | '720' | 'mp3';

interface YouTubeResolutionResult {
  url: string | null;
  provider?: string;
  failureReason?: 'rate_limit' | 'timeout' | 'network';
}

interface YouTubeResolveResponse {
  success?: boolean;
  url?: string;
  pendingId?: string;
  provider?: string;
  status?: 'ready' | 'processing' | 'failed';
  progress?: number;
  error?: string;
}

const YT_PROGRESS_MAX_POLLS = 20;
const YT_PROGRESS_INTERVAL_MS = 1500;

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('http');
}

/**
 * Resolves a direct YouTube download URL through our own Server-Side Resolver Proxy
 * (`/api/social/extract?action=youtube-resolve`). The server spoofs Origin/Referer/User-Agent
 * for Savetube Multi-CDN (Provider A) and Savenow / Loader.to (Provider B), so the browser never
 * makes CORS-blocked (403) or rate-limited (429) requests to third-party converters.
 * If the server returns a `pendingId`, progress is polled via `action=youtube-progress`.
 */
async function resolveYouTubeClientSide(
  videoId: string,
  format: YouTubeResolveFormat,
  onProgress?: (percentage: number) => void
): Promise<YouTubeResolutionResult> {
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const response = await apiFetch('/api/social/extract?action=youtube-resolve', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'youtube-resolve', videoId, url: targetUrl, format }),
      signal: AbortSignal.timeout(55000),
    });

    if (response.status === 429) {
      return { url: null, failureReason: 'rate_limit' };
    }

    const data = (await response.json().catch(() => null)) as YouTubeResolveResponse | null;

    if (data && isHttpUrl(data.url)) {
      return { url: data.url, provider: data.provider };
    }

    const pendingId = data?.pendingId;
    if (!pendingId) {
      return { url: null, failureReason: 'network' };
    }

    for (let attempt = 0; attempt < YT_PROGRESS_MAX_POLLS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, YT_PROGRESS_INTERVAL_MS));

      try {
        const progRes = await apiFetch(
          `/api/social/extract?action=youtube-progress&id=${encodeURIComponent(pendingId)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(12000),
          }
        );
        const progData = (await progRes.json().catch(() => null)) as YouTubeResolveResponse | null;

        if (progData && isHttpUrl(progData.url)) {
          return { url: progData.url, provider: data?.provider || 'savenow' };
        }
        if (progData?.status === 'failed') {
          return { url: null, failureReason: 'network' };
        }
        if (onProgress && typeof progData?.progress === 'number') {
          onProgress(progData.progress);
        }
      } catch {
        // Transient poll error: keep polling until the attempt budget is exhausted
      }
    }

    return { url: null, failureReason: 'timeout' };
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { url: null, failureReason: 'timeout' };
    }
    return { url: null, failureReason: 'network' };
  }
}

/**
 * Triggers a direct native download on the client without jumping tabs and without buffering files in JS memory:
 * - Chrome Extension: Uses chrome.downloads.download({ url, filename: cleanName }) (writes directly to disk)
 * - Web App:
 *    1. URLs with guaranteed attachment headers (Cobalt tunnel): Hidden iframe injection directly to `url`.
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

  // 2. Web App - Tunnel/API/CDN URLs with guaranteed attachment headers
  const isAttachmentGuaranteed =
    url.includes('/tunnel') ||
    url.includes('api.cobalt.tools') ||
    url.includes('cobalt.tools') ||
    url.includes('wuk.sh') ||
    url.includes('xenon.zone');

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
      const msg =
        err instanceof Error && !err.message.toLowerCase().includes('failed to fetch')
          ? err.message
          : 'Hệ thống tải đang quá tải, vui lòng thử lại sau.';
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
        const directUrl = mediaUrl;

        // Phase 1 & 2: Dedicated YouTube Resolution via Server-Side Resolver Proxy (Savetube -> Savenow)
        const isYouTube =
          optionId?.startsWith('youtube_') ||
          optionId?.startsWith('yt_') ||
          result?.platform === 'youtube' ||
          (mediaUrl &&
            (mediaUrl.includes('youtube.com') ||
              mediaUrl.includes('youtu.be') ||
              mediaUrl.includes('googlevideo.com')));

        if (isYouTube && result?.videoId) {
          const isAudio = optionId === 'youtube_audio' || optionId === 'yt_audio';

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 45,
            stage: isAudio ? 'audio' : 'video',
          }));

          const ytFormat: YouTubeResolveFormat = isAudio
            ? 'mp3'
            : optionId?.includes('1080')
              ? '1080'
              : '720';

          const ytResolution = await resolveYouTubeClientSide(
            result.videoId,
            ytFormat,
            (serverProgress) => {
              setDownloadProgress((prev) => ({
                ...prev,
                percentage: Math.max(prev.percentage, Math.min(80, 45 + Math.round(serverProgress * 0.35))),
              }));
            }
          );
          const resolvedYtUrl = ytResolution.url;

          if (!resolvedYtUrl) {
            if (ytResolution.failureReason === 'timeout') {
              throw new Error(
                'Quá thời gian chờ xử lý video. Vui lòng thử lại hoặc chọn độ phân giải khác.'
              );
            }
            throw new Error('Hệ thống tải đang quá tải, vui lòng thử lại sau.');
          }

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 85,
            stage: 'muxing',
          }));

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

        // Phase 2.5: Dedicated Instagram Download Flow (Untouched)
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

        // Phase 3: Smart Routing for TikTok, Facebook, Pinterest, and all other platforms (Untouched)
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
        const rawMessage = err instanceof Error ? err.message : '';
        const friendlyMsg =
          rawMessage && !rawMessage.toLowerCase().includes('failed to fetch')
            ? rawMessage
            : 'Hệ thống tải đang quá tải, vui lòng thử lại sau.';
        setDownloadProgress((prev) => ({
          ...prev,
          isDownloading: false,
          percentage: 0,
          status: 'error',
          errorMessage: friendlyMsg,
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
        const cleanTitle =
          albumTitle.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_') || 'album';
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
              const proxyUrl = getApiUrl(
                `/api/download?url=${encodeURIComponent(item.url)}&filename=image_${i + 1}.jpg`
              );
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

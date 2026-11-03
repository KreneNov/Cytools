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
      const response = await apiFetch(`/api/social/extract?url=${encodeURIComponent(url.trim())}`);
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
      setDownloadProgress({
        isDownloading: true,
        activeOptionId: optionId,
        loadedBytes: 0,
        totalBytes: 0,
        percentage: 15,
        fileName: targetFileName,
        stage: 'video',
        status: 'downloading',
      });

      let stageTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleStageProgression = () => {
        stageTimer = setTimeout(() => {
          setDownloadProgress((prev) => {
            if (!prev.isDownloading) return prev;
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
          scheduleStageProgression();
        }, 350);
      };
      scheduleStageProgression();

      try {
        let directUrl = mediaUrl;

        // Phase 1: If YouTube and URL not yet resolved (or empty), resolve stream via multi-tier waterfall
        if ((!directUrl || optionId?.startsWith('youtube_')) && result?.videoId) {
          const isAudio = optionId === 'youtube_audio';
          const quality = optionId === 'youtube_1080p' ? '1080' : '720';
          const targetYtUrl = `https://www.youtube.com/watch?v=${result.videoId}`;

          // Tier 1: Try Cobalt v10 from client with strict v10 schema
          try {
            const cobaltBody = isAudio
              ? {
                  url: targetYtUrl,
                  downloadMode: 'audio',
                  audioFormat: 'mp3',
                }
              : {
                  url: targetYtUrl,
                  downloadMode: 'auto',
                  videoQuality: quality,
                  youtubeVideoCodec: 'h264',
                };

            const cobaltRes = await fetch('https://rue-cobalt.xenon.zone', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(cobaltBody),
              signal: AbortSignal.timeout(8000),
            });

            if (cobaltRes.ok) {
              const cJson = await cobaltRes.json();
              if (
                cJson.url &&
                (cJson.status === 'tunnel' || cJson.status === 'redirect' || cJson.status === 'stream')
              ) {
                directUrl = cJson.url;
              }
            }
          } catch (cobaltErr) {
            console.warn('[useSocialDownloader] Client Cobalt attempt failed:', cobaltErr);
          }

          // Tier 2: If Tier 1 failed, try Cobalt v10 with minimal schema (no quality restrictions)
          if (!directUrl) {
            try {
              const cobaltResSimple = await fetch('https://rue-cobalt.xenon.zone', {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  url: targetYtUrl,
                  downloadMode: isAudio ? 'audio' : 'auto',
                }),
                signal: AbortSignal.timeout(6000),
              });

              if (cobaltResSimple.ok) {
                const cJsonSimple = await cobaltResSimple.json();
                if (
                  cJsonSimple.url &&
                  (cJsonSimple.status === 'tunnel' || cJsonSimple.status === 'redirect' || cJsonSimple.status === 'stream')
                ) {
                  directUrl = cJsonSimple.url;
                }
              }
            } catch (cobaltSimpleErr) {
              console.warn('[useSocialDownloader] Client Cobalt minimal attempt failed:', cobaltSimpleErr);
            }
          }

          // Tier 3: Server Stream Resolver fallback (Innertube multi-client + Cobalt server tunnel)
          if (!directUrl) {
            try {
              const resolveUrl = getApiUrl(`/api/social/extract?action=resolve&videoId=${result.videoId}`);
              const resStream = await fetch(resolveUrl, { signal: AbortSignal.timeout(6000) });
              if (resStream.ok) {
                const streamData = await resStream.json();
                if (isAudio && streamData.audioUrl) {
                  directUrl = streamData.audioUrl;
                } else if (streamData.preMuxedUrl) {
                  directUrl = streamData.preMuxedUrl;
                } else if (streamData.videoUrl) {
                  directUrl = streamData.videoUrl;
                }
              }
            } catch (innerErr) {
              console.warn('[useSocialDownloader] Stream resolution fallback failed:', innerErr);
            }
          }

          // Tier 4: Use pre-extracted stream options from result if available, or original mediaUrl
          if (!directUrl) {
            if (isAudio && result.audioUrl) {
              directUrl = result.audioUrl;
            } else if (result.videoSd) {
              directUrl = result.videoSd;
            } else if (result.videoHd) {
              directUrl = result.videoHd;
            } else if (mediaUrl) {
              directUrl = mediaUrl;
            }
          }
        }

        if (!directUrl) {
          throw new Error('Không thể phân giải đường dẫn tải xuống phương tiện. Vui lòng thử lại sau giây lát.');
        }

        // Phase 2: Dedicated YouTube Residential Direct Download Bypass:
        // YouTube (Cobalt tunnels / googlevideo streams) blocks Vercel datacenter IPs with HTTP 403.
        // We trigger native download directly on the client using the user's residential IP.
        const isYouTube =
          optionId?.startsWith('youtube_') ||
          result?.platform === 'youtube' ||
          directUrl.includes('googlevideo.com') ||
          directUrl.includes('cobalt');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;

        if (isYouTube) {
          if (chromeObj?.downloads?.download) {
            await new Promise<void>((resolve, reject) => {
              chromeObj.downloads.download(
                {
                  url: directUrl,
                  filename: targetFileName,
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
          } else {
            // Web environment direct native download (bypasses CORS and Vercel 403 IP block)
            const a = document.createElement('a');
            a.href = directUrl;
            a.target = '_blank';
            a.download = targetFileName || '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }

          if (stageTimer) clearTimeout(stageTimer);

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 100,
            stage: 'done',
            status: 'completed',
          }));

          setTimeout(() => {
            setDownloadProgress(INITIAL_PROGRESS);
          }, 3500);
          return;
        }

        // Phase 3: Chrome Extension Native Streaming Optimization for other platforms:
        // Use user's local residential IP directly via chrome.downloads API.
        // Completely bypasses Vercel 10s timeouts, datacenter IP bans, and uses 0 MB heap!
        if (chromeObj?.downloads?.download) {
          await new Promise<void>((resolve, reject) => {
            chromeObj.downloads.download(
              {
                url: directUrl,
                filename: targetFileName,
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

          if (stageTimer) clearTimeout(stageTimer);

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 100,
            stage: 'done',
            status: 'completed',
          }));

          setTimeout(() => {
            setDownloadProgress(INITIAL_PROGRESS);
          }, 3500);
          return;
        }

        // Phase 4: Non-YouTube Web Browser Client-Side Force Download via Local Blob (NEVER opens new tab!)
        const triggerBlobSave = (blob: Blob, filename: string) => {
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = filename;
          // STRICT RULE: DO NOT set a.target = '_blank'!
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
          }, 2000);
        };

        let downloadedBlob: Blob | null = null;

        // Step 3A: Attempt direct fetch first if CDN allows CORS
        try {
          const response = await fetch(directUrl, { signal: AbortSignal.timeout(25000) });
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            throw new Error('Bị chặn bởi nền tảng. Vui lòng thử tải lại hoặc dùng tiện ích mở rộng Cytools.');
          }

          if (response.ok) {
            const rawBlob = await response.blob();
            if (rawBlob && rawBlob.size > 0) {
              if (rawBlob.size < 1500) {
                const sampleText = await rawBlob.text();
                if (
                  sampleText.includes('<!DOCTYPE') ||
                  sampleText.includes('<html') ||
                  sampleText.includes('darker-dark-theme') ||
                  sampleText.includes('consent.youtube.com')
                ) {
                  throw new Error('Bị chặn bởi nền tảng (Anti-Bot). Vui lòng thử tải lại hoặc dùng tiện ích mở rộng Cytools.');
                }
              }
              downloadedBlob = rawBlob;
            }
          }
        } catch (fetchErr) {
          if (fetchErr instanceof Error && fetchErr.message.includes('Bị chặn bởi nền tảng')) {
            throw fetchErr;
          }
          console.warn('[useSocialDownloader] Direct fetch failed or CORS restricted, falling back to proxy:', fetchErr);
        }

        // Step 3B: If direct fetch failed or was blocked by CORS (e.g. i.pinimg.com), fetch via /api/download proxy!
        if (!downloadedBlob) {
          const proxyUrl = getApiUrl(
            `/api/download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(targetFileName)}`
          );
          const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(45000) });
          if (!proxyRes.ok) {
            let errMsg = `Máy chủ CDN upstream phản hồi lỗi: HTTP ${proxyRes.status}`;
            try {
              const errJson = await proxyRes.json();
              if (errJson.error) errMsg = errJson.error;
            } catch {
              // Ignore
            }
            throw new Error(errMsg);
          }

          const rawBlob = await proxyRes.blob();
          if (!rawBlob || rawBlob.size === 0) {
            throw new Error('Tệp tải về rỗng từ máy chủ.');
          }
          downloadedBlob = rawBlob;
        }

        // Trigger local file save via Blob URL
        triggerBlobSave(downloadedBlob, targetFileName);

        if (stageTimer) clearTimeout(stageTimer);

        setDownloadProgress((prev) => ({
          ...prev,
          loadedBytes: downloadedBlob!.size,
          totalBytes: downloadedBlob!.size,
          percentage: 100,
          stage: 'done',
          status: 'completed',
        }));

        setTimeout(() => {
          setDownloadProgress(INITIAL_PROGRESS);
        }, 3500);
      } catch (err) {
        if (stageTimer) clearTimeout(stageTimer);
        const msg = err instanceof Error ? err.message : 'Lỗi khi tải tệp về máy tính.';
        console.error('Download stream error:', err);
        setDownloadProgress((prev) => ({
          ...prev,
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

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
            if (nextPercent > 92) nextPercent = 92;
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
        const directUrl = mediaUrl;

        // 1. Chrome Extension Native Streaming Optimization:
        // Use user's local residential IP directly via chrome.downloads API.
        // Completely bypasses Vercel 10s timeouts, datacenter IP bans, and uses 0 MB heap!
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;
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

        // 2. Standard Web Browser Client-Side Direct Download (Bypasses Vercel Proxy Timeouts)
        const triggerNativeBrowserSave = (url: string, filename: string) => {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };

        let downloadedViaBlob = false;

        // Try direct fetch with blob streaming if CORS is supported by CDN
        try {
          const response = await fetch(directUrl);

          // Anti-bot check: Platform returned CAPTCHA or HTML page instead of video
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html')) {
            throw new Error('Bị chặn bởi nền tảng. Vui lòng thử tải lại hoặc dùng tiện ích mở rộng Cytools.');
          }

          if (response.ok) {
            let blob: Blob | null = await response.blob();
            if (blob && blob.size > 0) {
              // Safety check: Detect small anti-bot HTML disguises
              if (blob.size < 1500) {
                const sampleText = await blob.text();
                if (
                  sampleText.includes('<!DOCTYPE') ||
                  sampleText.includes('<html') ||
                  sampleText.includes('darker-dark-theme') ||
                  sampleText.includes('consent.youtube.com')
                ) {
                  throw new Error('Bị chặn bởi nền tảng (Anti-Bot). Vui lòng thử tải lại hoặc dùng tiện ích mở rộng Cytools.');
                }
              }

              const objectUrl = URL.createObjectURL(blob);
              triggerNativeBrowserSave(objectUrl, targetFileName);
              setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
              }, 1000);

              const fileSize = blob.size;
              blob = null;

              if (stageTimer) clearTimeout(stageTimer);

              setDownloadProgress((prev) => ({
                ...prev,
                loadedBytes: fileSize,
                totalBytes: fileSize,
                percentage: 100,
                stage: 'done',
                status: 'completed',
              }));

              downloadedViaBlob = true;
            }
          }
        } catch (fetchErr) {
          // If error is explicit Anti-Bot or CAPTCHA, rethrow to display clean UI alert
          if (fetchErr instanceof Error && fetchErr.message.includes('Bị chặn bởi nền tảng')) {
            throw fetchErr;
          }
          // If CORS failed or direct fetch was blocked, fallback to native browser direct download!
          console.warn('[useSocialDownloader] Direct fetch CORS restricted, triggering native download anchor:', fetchErr);
        }

        if (!downloadedViaBlob) {
          // Direct fallback: Let browser handle streaming natively without passing through Vercel
          triggerNativeBrowserSave(directUrl, targetFileName);

          if (stageTimer) clearTimeout(stageTimer);

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 100,
            stage: 'done',
            status: 'completed',
          }));
        }

        setTimeout(() => {
          setDownloadProgress(INITIAL_PROGRESS);
        }, 4000);
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
    []
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

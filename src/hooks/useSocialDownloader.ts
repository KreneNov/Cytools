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
        const rawDownloadUrl = mediaUrl.startsWith('/api/')
          ? `${mediaUrl}${mediaUrl.includes('?') ? '&' : '?'}filename=${encodeURIComponent(targetFileName)}`
          : `/api/download?url=${encodeURIComponent(mediaUrl)}&filename=${encodeURIComponent(targetFileName)}`;
        const downloadUrl = getApiUrl(rawDownloadUrl);

        // 1. Chrome Extension Native Streaming Optimization:
        // When running in Extension with downloads API, stream directly to disk with 0 MB JS heap allocation!
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeObj = (window as any).chrome;
        if (chromeObj?.downloads?.download) {
          await new Promise<void>((resolve, reject) => {
            chromeObj.downloads.download(
              {
                url: downloadUrl,
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
          }, 4000);
          return;
        }

        // 2. Standard Web Browser Fetch Streaming:
        const response = await fetch(downloadUrl);

        // Explicit Check: HTTP 204 No Content
        if (response.status === 204) {
          throw new Error('Máy chủ phản hồi rỗng (204 No Content). Không thể tải luồng phương tiện. Vui lòng thử lại sau.');
        }

        // If response is not OK (4xx, 5xx), parse error message from server
        if (!response.ok) {
          let errorDetail = `Lỗi máy chủ (${response.status}): Không thể tải video.`;
          try {
            const errText = await response.text();
            try {
              const errJson = JSON.parse(errText);
              if (errJson.error) {
                errorDetail = errJson.error;
              }
            } catch {
              if (errText && errText.trim().length > 0 && errText.length < 300) {
                errorDetail = errText.trim();
              }
            }
          } catch {
            // Non-readable error body
          }
          throw new Error(errorDetail);
        }

        // Guard against server returning JSON error body even if status was 200
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            const jsonBody = await response.json();
            if (jsonBody.error) {
              throw new Error(jsonBody.error);
            }
          } catch (jsonErr) {
            if (jsonErr instanceof Error && jsonErr.message) {
              throw jsonErr;
            }
          }
          throw new Error('Máy chủ trả về dữ liệu JSON thay vì luồng tệp tin video/audio.');
        }

        // Check if content-length is explicitly 0 without consuming the body
        if (response.headers.get('content-length') === '0') {
          throw new Error('Máy chủ phản hồi file rỗng (0 bytes). Vui lòng thử lại chất lượng khác.');
        }

        // Consume the stream once and cleanly using native browser blob implementation
        let blob: Blob | null = await response.blob();

        if (blob.size === 0) {
          throw new Error('Dữ liệu nhận được rỗng (0 bytes). Vui lòng chọn chất lượng khác hoặc thử lại sau.');
        }

        // Guard against disguised error payloads (e.g. server returned small error string/json under octet-stream)
        if (blob.size < 500) {
          const sampleText = await blob.text();
          if (
            sampleText.includes('{"error"') ||
            sampleText.includes('Error:') ||
            sampleText.includes('<!DOCTYPE') ||
            sampleText.includes('<html')
          ) {
            try {
              const errParsed = JSON.parse(sampleText);
              if (errParsed.error) throw new Error(errParsed.error);
            } catch (pErr) {
              if (pErr instanceof Error && !pErr.message.includes('JSON')) {
                throw pErr;
              }
            }
            throw new Error(`Máy chủ báo lỗi: ${sampleText.slice(0, 150).replace(/[<>]/g, '')}`);
          }
        }

        const objectUrl = URL.createObjectURL(blob);

        // Trigger browser save
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = targetFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Immediate revoke to prevent memory leaks in renderer heap (500ms instead of 60s)
        setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
        }, 500);

        const fileSize = blob.size;
        // Nullify reference immediately so GC can reclaim RAM
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
          const proxyUrl = getApiUrl(`/api/download?url=${encodeURIComponent(item.url)}&filename=image_${i + 1}.jpg`);

          try {
            const res = await fetch(proxyUrl);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              folder.file(`image_${String(i + 1).padStart(2, '0')}.jpg`, arrayBuffer);
            }
          } catch (e) {
            console.warn(`Failed to fetch image ${i + 1} for zip:`, e);
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

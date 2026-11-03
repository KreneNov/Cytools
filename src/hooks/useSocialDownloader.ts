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

        // Phase 1 & 2: Dedicated YouTube Resolution & Direct Download
        const isYouTube =
          optionId?.startsWith('youtube_') ||
          result?.platform === 'youtube' ||
          (mediaUrl &&
            (mediaUrl.includes('youtube.com') ||
              mediaUrl.includes('youtu.be') ||
              mediaUrl.includes('googlevideo.com')));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;

        if (isYouTube && result?.videoId) {
          const isAudio = optionId === 'youtube_audio';
          const quality = optionId === 'youtube_1080p' ? '1080p' : '720p';

          // Branch A: Chrome Extension (Client-side Direct Innertube using User's Residential IP)
          if (chromeObj?.downloads?.download) {
            let extStreamUrl: string | null = null;
            try {
              // Call Innertube player directly from client with user's residential IP
              const vrBody = {
                videoId: result.videoId,
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
              };
              const vrRes = await fetch(
                'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'User-Agent':
                      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
                  },
                  body: JSON.stringify(vrBody),
                  signal: AbortSignal.timeout(5000),
                }
              );
              if (vrRes.ok) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const vrJson: any = await vrRes.json();
                if (vrJson.playabilityStatus?.status === 'OK') {
                  const formats = vrJson.streamingData?.formats || [];
                  const adaptive = vrJson.streamingData?.adaptiveFormats || [];
                  if (isAudio) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const aFmt =
                      adaptive.find((f: any) => f.url && f.itag === 140) ||
                      adaptive.find((f: any) => f.url && f.mimeType?.includes('audio/mp4'));
                    if (aFmt?.url) extStreamUrl = aFmt.url;
                  } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const preMuxed =
                      formats.find((f: any) => f.url && f.mimeType?.includes('video/mp4')) ||
                      formats.find((f: any) => f.url);
                    if (preMuxed?.url) extStreamUrl = preMuxed.url;
                  }
                }
              }
            } catch (extErr) {
              console.warn(
                '[useSocialDownloader] Extension direct innertube attempt failed:',
                extErr
              );
            }

            // If direct stream URL resolved on extension, download directly with user's residential IP
            if (extStreamUrl) {
              await new Promise<void>((resolve, reject) => {
                chromeObj.downloads.download(
                  {
                    url: extStreamUrl,
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

            // Fallback for extension: pass /api/download endpoint to chrome.downloads
            const apiDownloadUrl = getApiUrl(
              `/api/download?videoId=${encodeURIComponent(result.videoId)}&type=${
                isAudio ? 'audio' : 'video'
              }&quality=${encodeURIComponent(quality)}&filename=${encodeURIComponent(
                targetFileName
              )}`
            );
            await new Promise<void>((resolve, reject) => {
              chromeObj.downloads.download(
                {
                  url: apiDownloadUrl,
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

          // Branch B: Web App (Same-Lambda Resolve + Stream Pipe via /api/download)
          const downloadEndpoint = getApiUrl(
            `/api/download?videoId=${encodeURIComponent(result.videoId)}&type=${
              isAudio ? 'audio' : 'video'
            }&quality=${encodeURIComponent(quality)}&filename=${encodeURIComponent(
              targetFileName
            )}`
          );

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 45,
            stage: 'video',
          }));

          const response = await fetch(downloadEndpoint, { signal: AbortSignal.timeout(60000) });
          const contentType = response.headers.get('content-type') || '';

          if (
            !response.ok ||
            contentType.includes('application/json') ||
            contentType.includes('text/html')
          ) {
            let errorMsg = 'Không thể tải video YouTube từ máy chủ.';
            try {
              const errJson = await response.json();
              if (errJson.error) errorMsg = errJson.error;
            } catch {
              // Continue with default error
            }
            throw new Error(errorMsg);
          }

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 85,
            stage: 'muxing',
          }));

          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = targetFileName;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            if (document.body.contains(a)) document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
          }, 3000);

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

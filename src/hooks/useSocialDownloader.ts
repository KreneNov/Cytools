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
 * from download filenames before saving.
 */
export function cleanDownloadFilename(filename: string): string {
  if (!filename) return 'media.mp4';

  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : '.mp4';
  let name = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;

  // Remove known branding domains, subdomains, and platform artifacts
  const brandingRegex =
    /[-_.]?(?:ytshorts\.)?(?:savetube\.(?:me|vip|su)|oceansaver\.(?:in|net)|savenow\.to|cobalt\.tools|loader\.to|tikwm\.com|snaptik\.app|y2mate\.com|ytshorts)/gi;
  name = name.replace(brandingRegex, '');

  // Collapse consecutive dashes/underscores and trim trailing/leading separators
  name = name.replace(/[-_]{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');

  if (!name.trim()) name = 'media';
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

/**
 * Resolves a direct YouTube download URL 100% client-side (completely bypassing Vercel /api/download):
 * 1. Cobalt API v10 (https://api.cobalt.tools/api/json)
 * 2. Working CORS Instance: SaveTube VIP CDN v2 (https://media.savetube.vip/api/random-cdn)
 * 3. Chrome Extension Direct Innertube ANDROID_VR fallback
 */
async function resolveYouTubeClientSide(
  videoId: string,
  quality: '1080p' | '720p',
  type: 'video' | 'audio'
): Promise<string | null> {
  const targetYouTubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Step 1: Direct Client-Side Cobalt v10 API Call
  try {
    const response = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetYouTubeUrl,
        videoQuality: quality === '1080p' ? '1080' : '720',
        isAudioOnly: type === 'audio',
        downloadMode: 'auto',
        filenameStyle: 'basic',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await response.json();
      const cobaltUrl = res?.url || res?.picker?.[0]?.url;
      if (cobaltUrl && typeof cobaltUrl === 'string' && cobaltUrl.startsWith('http')) {
        return cobaltUrl;
      }
    }
  } catch (cobaltErr) {
    console.warn('[useSocialDownloader] Cobalt v10 primary request fallback:', cobaltErr);
  }

  // Step 2: Known Working CORS Instance — SaveTube VIP CDN v2 (supports 1080p, 720p, and MP3 with Content-Disposition: attachment)
  try {
    const cdnRes = await fetch('https://media.savetube.vip/api/random-cdn', {
      signal: AbortSignal.timeout(5000),
    });
    if (cdnRes.ok) {
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
        signal: AbortSignal.timeout(8000),
      });

      if (infoRes.ok) {
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
              try {
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
                  signal: AbortSignal.timeout(10000),
                });
                if (dlRes.ok) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const dlJson: any = await dlRes.json();
                  const resolvedLink = dlJson?.data?.downloadUrl;
                  if (
                    resolvedLink &&
                    typeof resolvedLink === 'string' &&
                    resolvedLink.startsWith('http')
                  ) {
                    return resolvedLink;
                  }
                }
              } catch {
                // Continue to next quality tier
              }
            }
          }
        }
      }
    }
  } catch (saveTubeErr) {
    console.warn('[useSocialDownloader] SaveTube VIP CDN client resolution warning:', saveTubeErr);
  }

  // Step 3: Chrome Extension Direct Innertube ANDROID_VR Fallback
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
        signal: AbortSignal.timeout(5000),
      });

      if (vrRes.ok) {
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
            if (aFmt?.url) return aFmt.url;
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const preMuxed =
              formats.find((f: any) => f.url && f.mimeType?.includes('video/mp4')) ||
              formats.find((f: any) => f.url);
            if (preMuxed?.url) return preMuxed.url;
          }
        }
      }
    } catch {
      // Ignore extension Innertube error
    }
  }

  return null;
}

/**
 * Triggers a direct download on the client:
 * - Chrome Extension: Uses chrome.downloads.download({ url, filename })
 * - Web App: Uses Hidden Iframe Injection to trigger Content-Disposition: attachment without opening a new tab or 0-byte CORS errors.
 */
async function triggerDirectDownload(url: string, filename: string): Promise<void> {
  const cleanFilename = cleanDownloadFilename(filename);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;

  if (chromeObj?.downloads?.download) {
    await new Promise<void>((resolve, reject) => {
      chromeObj.downloads.download(
        {
          url,
          filename: cleanFilename,
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

  // Web App environment: Hidden Iframe Injection
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
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
        // Direct Client-Side Cobalt v10 Extraction for Instagram (Bypasses Vercel Datacenter Meta Blocks)
        let directVideoUrl: string | null = null;
        let thumbUrl: string | undefined = undefined;

        try {
          const response = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: cleanUrl,
              downloadMode: 'auto',
            }),
            signal: AbortSignal.timeout(8000),
          });

          if (response.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resJson: any = await response.json();
            directVideoUrl = resJson.url || resJson.picker?.[0]?.url || null;
            thumbUrl = resJson.picker?.[0]?.thumb || undefined;
          }
        } catch (cobaltErr) {
          console.warn('[useSocialDownloader] Client Cobalt Instagram primary attempt failed:', cobaltErr);
        }

        // Fallback to working instance if primary failed
        if (!directVideoUrl) {
          try {
            const fallbackRes = await fetch('https://rue-cobalt.xenon.zone/', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: cleanUrl,
                downloadMode: 'auto',
              }),
              signal: AbortSignal.timeout(6000),
            });
            if (fallbackRes.ok) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const fbJson: any = await fallbackRes.json();
              directVideoUrl = fbJson.url || fbJson.picker?.[0]?.url || null;
              thumbUrl = fbJson.picker?.[0]?.thumb || thumbUrl;
            }
          } catch (fbErr) {
            console.warn('[useSocialDownloader] Client Cobalt Instagram fallback attempt failed:', fbErr);
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeObj = typeof window !== 'undefined' ? (window as any).chrome : undefined;

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

          // Resolve direct stream URL 100% client-side (Cobalt v10 -> SaveTube VIP CDN -> Extension Innertube)
          let resolvedYtUrl = await resolveYouTubeClientSide(result.videoId, quality, mediaType);

          // Fallback to pre-extracted direct URL if available and not a raw youtube watch URL
          if (
            !resolvedYtUrl &&
            directUrl &&
            directUrl.startsWith('http') &&
            !directUrl.includes('youtube.com/watch') &&
            !directUrl.includes('youtu.be/')
          ) {
            resolvedYtUrl = directUrl;
          }

          if (!resolvedYtUrl) {
            throw new Error(
              'Không thể phân giải luồng tải YouTube trực tiếp. Vui lòng thử lại sau giây lát.'
            );
          }

          setDownloadProgress((prev) => ({
            ...prev,
            percentage: 85,
            stage: 'muxing',
          }));

          // Trigger direct download (chrome.downloads on Extension, Hidden Iframe on Web App)
          await triggerDirectDownload(resolvedYtUrl, cleanTargetFileName);

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

        // Phase 2.5: Dedicated Instagram Client-Side Download (Bypasses Vercel Proxy)
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

          // If directUrl is not yet resolved or still an Instagram page link, resolve it via Cobalt v10
          if (
            !resolvedIgUrl ||
            resolvedIgUrl.includes('instagram.com') ||
            resolvedIgUrl.includes('instagr.am')
          ) {
            try {
              const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
                method: 'POST',
                headers: {
                  Accept: 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  url: result?.videoHd || mediaUrl,
                  downloadMode: 'auto',
                }),
                signal: AbortSignal.timeout(6000),
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

          // Trigger direct download (chrome.downloads on Extension, Hidden Iframe on Web App)
          await triggerDirectDownload(resolvedIgUrl, cleanTargetFileName);

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
                filename: cleanTargetFileName,
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
            `/api/download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(cleanTargetFileName)}`
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
        triggerBlobSave(downloadedBlob, cleanTargetFileName);

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

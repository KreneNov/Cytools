import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';

interface ExtendedRequest extends IncomingMessage {
  query?: Record<string, string>;
  body?: Record<string, any>;
}

interface ExtendedResponse extends ServerResponse {
  status?: (code: number) => ExtendedResponse;
  json?: (data: any) => void;
}

function sendJson(res: ExtendedResponse, statusCode: number, data: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

function sanitizeFileName(name: string, fallbackExt = 'mp4'): string {
  const clean = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'media';
  if (/\.(mp4|mp3|m4a|wav|jpg|jpeg|png|webp|gif)$/i.test(clean)) {
    return clean;
  }
  return `${clean}.${fallbackExt}`;
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  // CORS Preflight & Global Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  let mediaUrl: string | null = null;
  let customFileName: string | null = null;
  let format: string | null = null;
  let videoId: string | null = null;
  let downloadType: string | null = null;
  let quality: string | null = null;

  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      mediaUrl = parsed.searchParams.get('url');
      customFileName = parsed.searchParams.get('filename');
      format = parsed.searchParams.get('format');
      videoId = parsed.searchParams.get('videoId');
      downloadType = parsed.searchParams.get('type');
      quality = parsed.searchParams.get('quality');
    } catch {
      // Continue
    }
  }

  if (!mediaUrl && !videoId && req.method === 'POST') {
    try {
      if (req.body && typeof req.body === 'object') {
        mediaUrl = req.body.url || null;
        customFileName = req.body.filename || null;
        format = req.body.format || null;
        videoId = req.body.videoId || null;
        downloadType = req.body.type || null;
        quality = req.body.quality || null;
      }
    } catch {
      // Continue
    }
  }

  // Handle YouTube Same-Lambda Resolve + Immediate Stream Pipe (Fixes IP Mismatch)
  if (videoId && typeof videoId === 'string' && videoId.trim()) {
    const cleanVideoId = videoId.trim();
    const isAudio = downloadType === 'audio' || format === 'mp3' || quality === 'audio';
    const fallbackExt = isAudio ? 'mp3' : 'mp4';
    const targetFileName = sanitizeFileName(
      customFileName || `youtube_${cleanVideoId}`,
      fallbackExt
    );

    let streamUrl: string | null = null;
    let streamUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    let resolvedMimeType = isAudio ? 'audio/mp4' : 'video/mp4';

    // Strategy A1: Try @distube/ytdl-core in same process
    try {
      const { Ytdl } = await import('@distube/ytdl-core');
      const ytdl = new Ytdl();
      const info = await ytdl.getInfo(cleanVideoId);
      if (info && Array.isArray(info.formats) && info.formats.length > 0) {
        if (isAudio) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const aFmt =
            info.formats.find(
              (f: any) =>
                f.url && f.hasAudio && (f.itag === 140 || f.mimeType?.includes('audio/mp4'))
            ) || info.formats.find((f: any) => f.url && f.hasAudio);
          if (aFmt?.url) {
            streamUrl = aFmt.url;
            resolvedMimeType = aFmt.mimeType || 'audio/mp4';
          }
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const preMuxed = info.formats.find((f: any) => f.url && f.hasVideo && f.hasAudio);
          if (preMuxed?.url) {
            streamUrl = preMuxed.url;
            resolvedMimeType = preMuxed.mimeType || 'video/mp4';
          } else {
            const targetQ = quality?.replace('p', '') || '720';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const vFmt =
              info.formats.find(
                (f: any) =>
                  f.url && f.hasVideo && f.qualityLabel?.includes(targetQ) && f.container === 'mp4'
              ) ||
              info.formats.find((f: any) => f.url && f.hasVideo && f.container === 'mp4') ||
              info.formats.find((f: any) => f.url && f.hasVideo);
            if (vFmt?.url) {
              streamUrl = vFmt.url;
              resolvedMimeType = vFmt.mimeType || 'video/mp4';
            }
          }
        }
      }
    } catch (ytdlErr) {
      console.warn(
        '[download.ts] ytdl-core error:',
        ytdlErr instanceof Error ? ytdlErr.message : ytdlErr
      );
    }

    // Strategy A2: Try Raw Innertube ANDROID_VR if A1 failed
    if (!streamUrl) {
      try {
        const vrBody = {
          videoId: cleanVideoId,
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
        const vrUa =
          'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
        const vrRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': vrUa,
          },
          body: JSON.stringify(vrBody),
          signal: AbortSignal.timeout(5000),
        });
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
              if (aFmt?.url) {
                streamUrl = aFmt.url;
                streamUa = vrUa;
                resolvedMimeType = aFmt.mimeType || 'audio/mp4';
              }
            } else {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const preMuxed =
                formats.find((f: any) => f.url && f.mimeType?.includes('video/mp4')) ||
                formats.find((f: any) => f.url);
              if (preMuxed?.url) {
                streamUrl = preMuxed.url;
                streamUa = vrUa;
                resolvedMimeType = preMuxed.mimeType || 'video/mp4';
              }
            }
          }
        }
      } catch (vrErr) {
        console.warn(
          '[download.ts] ANDROID_VR error:',
          vrErr instanceof Error ? vrErr.message : vrErr
        );
      }
    }

    // Immediately fetch stream URL in same Lambda invocation if resolved
    if (streamUrl) {
      try {
        const remoteRes = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            'User-Agent': streamUa,
            Accept: '*/*',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        });

        const contentType = remoteRes.headers.get('content-type') || '';
        if (
          remoteRes.ok &&
          !contentType.includes('application/json') &&
          !contentType.includes('text/html') &&
          remoteRes.body
        ) {
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(targetFileName)}"`
          );
          res.setHeader('Content-Type', contentType || resolvedMimeType);

          const exactContentLength = remoteRes.headers.get('content-length');
          if (exactContentLength) {
            res.setHeader('Content-Length', exactContentLength);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nodeStream = Readable.fromWeb(remoteRes.body as any);
          nodeStream.on('error', (streamErr) => {
            console.error('[Download YouTube Stream Error]:', streamErr);
            if (!res.headersSent) {
              sendJson(res, 502, { success: false, error: 'Lỗi đường truyền stream dữ liệu.' });
            }
          });
          nodeStream.pipe(res);
          return;
        }
      } catch (pipeErr) {
        console.warn(
          '[download.ts] Immediate pipe error:',
          pipeErr instanceof Error ? pipeErr.message : pipeErr
        );
      }
    }

    // Strategy B: Invidious Proxy Stream Fallback (&local=true)
    const itag = isAudio ? '140' : quality === '1080p' ? '22' : '18';
    const invidiousInstances = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://yewtu.be',
      'https://invidious.privacyredirect.com',
      'https://invidious.lunar.icu',
    ];

    for (const inst of invidiousInstances) {
      try {
        const invUrl = `${inst}/latest_version?id=${encodeURIComponent(cleanVideoId)}&itag=${itag}&local=true`;
        const invRes = await fetch(invUrl, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: '*/*',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(6000),
        });

        const contentType = invRes.headers.get('content-type') || '';
        if (
          invRes.ok &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/json') &&
          invRes.body
        ) {
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(targetFileName)}"`
          );
          res.setHeader('Content-Type', contentType || resolvedMimeType);

          const exactContentLength = invRes.headers.get('content-length');
          if (exactContentLength) {
            res.setHeader('Content-Length', exactContentLength);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nodeStream = Readable.fromWeb(invRes.body as any);
          nodeStream.pipe(res);
          return;
        }
      } catch {
        // Continue to next instance
      }
    }

    return sendJson(res, 502, {
      success: false,
      error:
        'Không thể phân giải luồng tải YouTube. Vui lòng thử lại sau giây lát hoặc dùng tiện ích mở rộng Cytools.',
    });
  }

  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    return sendJson(res, 400, {
      success: false,
      error: 'Thiếu tham số url hoặc videoId để tải xuống phương tiện.',
    });
  }

  const cleanUrl = mediaUrl.trim();
  let parsedMediaUrl: URL;
  try {
    parsedMediaUrl = new URL(cleanUrl);
    if (parsedMediaUrl.protocol !== 'http:' && parsedMediaUrl.protocol !== 'https:') {
      throw new Error('Chỉ hỗ trợ giao thức HTTP hoặc HTTPS.');
    }
  } catch {
    return sendJson(res, 400, {
      success: false,
      error: 'URL phương tiện tải xuống không hợp lệ.',
    });
  }

  // Guard against bare root domain / API endpoints causing accidental empty/JSON dump
  const pathname = parsedMediaUrl.pathname.trim();
  const isRootOrApiEndpoint =
    pathname === '' ||
    pathname === '/' ||
    pathname === '/api/json' ||
    pathname === '/api' ||
    cleanUrl.endsWith('.zone') ||
    cleanUrl.endsWith('.zone/') ||
    cleanUrl.endsWith('.tools') ||
    cleanUrl.endsWith('.tools/');

  if (isRootOrApiEndpoint) {
    return sendJson(res, 400, {
      success: false,
      error: 'URL phương tiện không chứa đường dẫn tệp hợp lệ (trỏ về máy chủ gốc thay vì luồng video).',
    });
  }

  const fallbackExtension =
    format?.toLowerCase() ||
    (cleanUrl.includes('.mp3') || cleanUrl.includes('audio') ? 'mp3' : 'mp4');
  const targetFileName = sanitizeFileName(
    customFileName || `media_${Date.now()}`,
    fallbackExtension
  );

  try {
    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: '*/*',
    };

    const host = parsedMediaUrl.hostname.toLowerCase();
    if (host.includes('lookaside.fbsbx.com') || host.includes('fbsbx.com')) {
      upstreamHeaders['User-Agent'] =
        'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
      upstreamHeaders['Accept'] = '*/*';
      delete upstreamHeaders['Referer'];
    } else if (host.includes('pinimg.com') || host.includes('pinterest.com')) {
      upstreamHeaders['Referer'] = 'https://www.pinterest.com/';
    } else if (host.includes('fbcdn.net') || host.includes('facebook.com')) {
      upstreamHeaders['Referer'] = 'https://www.facebook.com/';
    } else if (host.includes('tiktok.com') || host.includes('tikwm.com') || host.includes('byteoversea.com')) {
      upstreamHeaders['Referer'] = 'https://www.tiktok.com/';
    } else if (host.includes('instagram.com') || host.includes('cdninstagram.com')) {
      upstreamHeaders['Referer'] = 'https://www.instagram.com/';
    } else if (host.includes('googlevideo.com') || host.includes('youtube.com')) {
      upstreamHeaders['Referer'] = 'https://www.youtube.com/';
    }

    const remoteRes = await fetch(cleanUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    if (!remoteRes.ok || !remoteRes.body) {
      return sendJson(res, remoteRes.status || 502, {
        success: false,
        error: `Máy chủ CDN upstream phản hồi lỗi: HTTP ${remoteRes.status} ${remoteRes.statusText}`,
      });
    }

    const contentType = remoteRes.headers.get('content-type') || '';
    if (
      contentType.includes('application/json') ||
      contentType.includes('text/html')
    ) {
      const errText = await remoteRes.text();
      return sendJson(res, 502, {
        success: false,
        error: `Tài nguyên trả về lỗi từ máy chủ nguồn: ${errText.slice(0, 200)}`,
      });
    }

    // Set streaming headers
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(targetFileName)}"`);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');

    const exactContentLength = remoteRes.headers.get('content-length');
    if (exactContentLength) {
      res.setHeader('Content-Length', exactContentLength);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(remoteRes.body as any);
    nodeStream.on('error', (streamErr) => {
      console.error('[Download Stream Pipe Error]:', streamErr);
      if (!res.headersSent) {
        sendJson(res, 502, { success: false, error: 'Lỗi đường truyền stream dữ liệu.' });
      }
    });

    nodeStream.pipe(res);
  } catch (streamErr) {
    const msg = streamErr instanceof Error ? streamErr.message : 'Không xác định';
    console.error('[Download Handler Error]:', msg);
    if (!res.headersSent) {
      return sendJson(res, 500, {
        success: false,
        error: `Lỗi máy chủ proxy khi truyền luồng phương tiện: ${msg}`,
      });
    }
  }
}

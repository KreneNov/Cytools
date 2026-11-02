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

  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      mediaUrl = parsed.searchParams.get('url');
      customFileName = parsed.searchParams.get('filename');
      format = parsed.searchParams.get('format');
    } catch {
      // Continue
    }
  }

  if (!mediaUrl && req.method === 'POST') {
    try {
      if (req.body && typeof req.body === 'object') {
        mediaUrl = req.body.url || null;
        customFileName = req.body.filename || null;
        format = req.body.format || null;
      }
    } catch {
      // Continue
    }
  }

  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    return sendJson(res, 400, {
      success: false,
      error: 'Thiếu tham số url để tải xuống phương tiện.',
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
    if (host.includes('pinimg.com') || host.includes('pinterest.com')) {
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

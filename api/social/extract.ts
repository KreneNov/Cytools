import type { IncomingMessage, ServerResponse } from 'http';
import { extractSocialMedia } from '../_social_extractor.js';

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

async function parseBody(req: ExtendedRequest): Promise<Record<string, any>> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString('utf-8');
    return text ? JSON.parse(text) : {};
  }
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  if (typeof (req as any).on === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of req as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length > 0) {
      const text = Buffer.concat(chunks).toString('utf-8').trim();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        const params = new URLSearchParams(text);
        const obj: Record<string, any> = {};
        for (const [k, v] of params.entries()) {
          obj[k] = v;
        }
        return obj;
      }
    }
  }
  return {};
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Chỉ chấp nhận phương thức GET hoặc POST.' });
  }

  try {
    let targetUrl: string | null = null;

    // 1. Try URL Query parameters
    if (req.url) {
      try {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        targetUrl = parsed.searchParams.get('url');
      } catch {
        // Continue
      }
    }

    // 2. Try parsed body for POST
    if (!targetUrl && req.method === 'POST') {
      const body = await parseBody(req);
      targetUrl = body.url || null;
    }

    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
      return sendJson(res, 400, {
        success: false,
        error: 'Thiếu tham số url để bóc tách thông tin phương tiện.',
      });
    }

    const cleanUrl = targetUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      return sendJson(res, 400, {
        success: false,
        error: 'URL không hợp lệ. Vui lòng cung cấp đường dẫn bắt đầu bằng http:// hoặc https://.',
      });
    }

    const result = await extractSocialMedia(cleanUrl);
    return sendJson(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lỗi không xác định khi bóc tách media.';
    console.error('[API /api/social/extract error]:', message);
    return sendJson(res, 500, {
      success: false,
      error: message,
    });
  }
}

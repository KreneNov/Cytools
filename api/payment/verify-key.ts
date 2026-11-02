import type { IncomingMessage, ServerResponse } from 'http';
import { verifyLicenseKey } from '../../src/api/db';

interface ExtendedRequest extends IncomingMessage {
  body?: {
    key?: string;
  };
}

interface ExtendedResponse extends ServerResponse {
  status?: (code: number) => ExtendedResponse;
  json?: (data: any) => void;
}

function sendJson(res: ExtendedResponse, statusCode: number, data: any) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string' || !key.trim()) {
      return sendJson(res, 400, { success: false, valid: false, error: 'Vui lòng cung cấp mã bản quyền' });
    }

    const verification = await verifyLicenseKey(key);
    if (!verification.valid) {
      return sendJson(res, 404, {
        success: false,
        valid: false,
        error: 'Mã bản quyền không tồn tại hoặc chưa được kích hoạt thành công.',
      });
    }

    return sendJson(res, 200, {
      success: true,
      valid: true,
      key: verification.key,
      donorName: verification.donorName,
      message: 'Mã bản quyền PRO trọn đời hợp lệ!',
    });
  } catch (error) {
    console.error('Lỗi khi xác thực mã bản quyền từ Vercel KV:', error);
    return sendJson(res, 500, {
      success: false,
      valid: false,
      error: 'Lỗi hệ thống xác thực bản quyền',
    });
  }
}

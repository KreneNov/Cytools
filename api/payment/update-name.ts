import type { IncomingMessage, ServerResponse } from 'http';
import { updateOrderName } from '../_db.js';
import { applyCorsHeaders } from '../_cors.js';

interface ExtendedRequest extends IncomingMessage {
  body?: {
    code?: string;
    donorName?: string;
  };
}

interface ExtendedResponse extends ServerResponse {
  status?: (code: number) => ExtendedResponse;
  json?: (data: any) => void;
}

function sendJson(res: ExtendedResponse, statusCode: number, data: any, req?: IncomingMessage) {
  res.setHeader('Content-Type', 'application/json');
  applyCorsHeaders(req, res, 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  applyCorsHeaders(req, res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    const { code, donorName } = req.body || {};
    if (!code) {
      return sendJson(res, 400, { success: false, error: 'Thiếu mã đơn hàng cần cập nhật' });
    }

    const updatedOrder = await updateOrderName(code, donorName || '');
    if (!updatedOrder) {
      return sendJson(res, 404, { success: false, error: 'Không tìm thấy đơn hàng' });
    }

    return sendJson(res, 200, {
      success: true,
      code: updatedOrder.code,
      donorName: updatedOrder.donorName,
    });
  } catch (error) {
    console.error('Lỗi khi cập nhật tên người ủng hộ:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Không thể cập nhật tên người ủng hộ',
    });
  }
}

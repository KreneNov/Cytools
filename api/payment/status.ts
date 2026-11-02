import type { IncomingMessage, ServerResponse } from 'http';
import { getOrder } from '../_db.js';

interface ExtendedRequest extends IncomingMessage {
  query?: Record<string, string>;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    // Extract code from query or URL pathname
    let code = req.query?.code;
    if (!code && req.url) {
      const url = new URL(req.url, 'http://localhost');
      code = url.searchParams.get('code') || url.pathname.split('/').pop() || '';
    }

    if (!code) {
      return sendJson(res, 400, { success: false, error: 'Thiếu mã đơn hàng cần kiểm tra' });
    }

    const order = await getOrder(code);

    if (!order) {
      return sendJson(res, 404, { success: false, error: 'Không tìm thấy phiên thanh toán' });
    }

    return sendJson(res, 200, {
      success: true,
      paid: order.status === 'PAID',
      code: order.code,
      status: order.status,
      type: order.type,
      donorName: order.donorName,
      licenseKey: order.status === 'PAID' ? order.code : null,
      amount: order.actualAmount || order.expectedAmount,
      paidAt: order.paidAt,
    });
  } catch (error) {
    console.error('Lỗi khi kiểm tra trạng thái thanh toán từ Vercel KV:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Lỗi kiểm tra trạng thái đơn hàng',
    });
  }
}

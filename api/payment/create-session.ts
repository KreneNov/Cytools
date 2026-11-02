import type { IncomingMessage, ServerResponse } from 'http';
import { createOrder } from '../../src/api/db';

interface ExtendedRequest extends IncomingMessage {
  body?: {
    type?: 'PRO' | 'DONOR';
    donorName?: string;
  };
}

interface ExtendedResponse extends ServerResponse {
  status?: (code: number) => ExtendedResponse;
  json?: (data: any) => void;
}

function sendJson(res: ExtendedResponse, statusCode: number, data: any) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const { type = 'PRO', donorName = '' } = req.body || {};
    const normalizedType = type === 'DONOR' ? 'DONOR' : 'PRO';

    const { order, qrUrl } = await createOrder({
      type: normalizedType,
      donorName: typeof donorName === 'string' ? donorName.trim() : '',
    });

    return sendJson(res, 200, {
      success: true,
      code: order.code,
      qrUrl,
      type: order.type,
      expectedAmount: order.expectedAmount,
      status: order.status,
      createdAt: order.createdAt,
    });
  } catch (error) {
    console.error('Lỗi khi tạo phiên thanh toán trên Vercel KV:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Không thể tạo phiên thanh toán',
    });
  }
}

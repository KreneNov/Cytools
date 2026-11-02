import type { IncomingMessage, ServerResponse } from 'http';
import { getHallOfFame, getStorageDriver } from './_db.js';

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

export default async function handler(req: IncomingMessage, res: ExtendedResponse) {
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
    const data = await getHallOfFame();
    return sendJson(res, 200, {
      success: true,
      storageDriver: getStorageDriver(),
      donors: data.donors,
      totalAmount: data.totalAmount,
      proCount: data.proCount,
      donorCount: data.donorCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu Bảng Vinh Danh từ Vercel KV:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Không thể truy xuất Bảng Vinh Danh',
    });
  }
}

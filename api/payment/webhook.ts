import type { IncomingMessage, ServerResponse } from 'http';
import { markOrderPaid, getOrder } from '../../src/api/db';

interface ExtendedRequest extends IncomingMessage {
  query?: Record<string, string>;
  body?: Record<string, any>;
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

/**
 * Verifies webhook secret against process.env.SEPAY_API_KEY or process.env.WEBHOOK_SECRET.
 * Supports:
 * - Header 'Authorization': 'Apikey <KEY>' or 'Bearer <KEY>'
 * - Header 'X-Secret-Key', 'x-sepay-token', 'x-api-key'
 * - Query param '?secret=...', '?token=...', or '?apiKey=...'
 * - Body field 'body.secret', 'body.token', or 'body.apiKey'
 */
export function isWebhookAuthorized(req: ExtendedRequest): boolean {
  const configuredSecret = process.env.SEPAY_API_KEY || process.env.WEBHOOK_SECRET;
  // If neither SEPAY_API_KEY nor WEBHOOK_SECRET is configured, allow in development mode with warning
  if (!configuredSecret || !configuredSecret.trim()) {
    console.warn('[Webhook Security] Neither SEPAY_API_KEY nor WEBHOOK_SECRET is configured in environment. Allowing request in unconfigured mode.');
    return true;
  }

  const secret = configuredSecret.trim();
  const headers = req.headers || {};
  const authHeader = String(headers['authorization'] || headers['Authorization'] || '').trim();
  const tokenFromAuth = authHeader.replace(/^(Apikey|Bearer)\s+/i, '').trim();

  const xSecret = String(
    headers['x-secret-key'] ||
    headers['x-sepay-token'] ||
    headers['x-api-key'] ||
    ''
  ).trim();

  const queryToken = String(req.query?.secret || req.query?.token || req.query?.apiKey || '').trim();
  const bodyToken = String(req.body?.secret || req.body?.token || req.body?.apiKey || '').trim();

  return (
    tokenFromAuth === secret ||
    authHeader === secret ||
    xSecret === secret ||
    queryToken === secret ||
    bodyToken === secret
  );
}

export default async function handler(req: ExtendedRequest, res: ExtendedResponse) {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Secret-Key, x-sepay-token, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
  }

  // 1. Security check: Validate Webhook Secret
  if (!isWebhookAuthorized(req)) {
    console.warn('[Webhook Security] Từ chối Webhook: Sai hoặc thiếu WEBHOOK_SECRET.');
    return sendJson(res, 401, {
      success: false,
      error: 'Unauthorized: Invalid or missing Webhook Secret',
    });
  }

  try {
    const body = req.body || {};

    const description =
      body.content ||
      body.description ||
      body.transactionContent ||
      body.referenceCode ||
      body.code ||
      body.data?.[0]?.description ||
      '';

    const amount = Number(
      body.transferAmount ||
      body.amount ||
      body.creditAmount ||
      body.data?.[0]?.amount ||
      0
    );

    const transferType = String(body.transferType || body.type || '').trim().toLowerCase();
    if (transferType && transferType !== 'in') {
      console.log(`[Webhook Notice] Bỏ qua giao dịch không phải chuyển tiền vào (transferType: "${transferType}")`);
      return sendJson(res, 200, {
        success: true,
        ignored: true,
        message: 'Bỏ qua giao dịch do không phải chuyển khoản vào (transferType !== in)',
      });
    }

    console.log(`[Webhook Received] Description: "${description}", Amount: ${amount}`);

    // Match code pattern: SEVQR + 5 alphanumeric chars (and retain CY... for backwards compatibility)
    const matches = [
      ...String(description).matchAll(/SEVQR[A-Z0-9]{5}/gi),
      ...String(description).matchAll(/CY[A-Z0-9]{5}/gi),
    ].map((m) => m[0].toUpperCase());

    if (matches.length === 0) {
      console.warn('[Webhook Notice] Không tìm thấy mã SEVQR hoặc CY trong nội dung chuyển khoản.');
      return sendJson(res, 200, {
        success: true,
        matched: false,
        message: 'Bỏ qua giao dịch do không chứa mã định danh (SEVQR hoặc CY)',
      });
    }

    // Resolve matching code
    let code = matches[0];
    for (const candidate of matches) {
      if (candidate !== 'CYTOOLS') {
        const order = await getOrder(candidate);
        if (order) {
          code = candidate;
          break;
        }
      }
    }

    console.log(`[Webhook Matched Code] Tìm thấy mã đơn hàng: ${code}`);

    const result = await markOrderPaid(code, amount || 5000);

    if (!result.success) {
      console.warn(`[Webhook Warning] Không thể kích hoạt đơn ${code}:`, result.error);
      return sendJson(res, 400, {
        success: false,
        matched: true,
        code,
        error: result.error,
      });
    }

    console.log(`[Webhook Success] Kích hoạt thành công đơn ${code} cho:`, result.order?.donorName);
    return sendJson(res, 200, {
      success: true,
      matched: true,
      alreadyPaid: Boolean(result.alreadyPaid),
      code,
      actualAmount: result.order?.actualAmount,
      licenseKey: result.order?.code,
      message: 'Giao dịch đã được xác nhận và đồng bộ lên Vercel KV thành công!',
    });
  } catch (error) {
    console.error('Lỗi khi xử lý Webhook SePay:', error);
    return sendJson(res, 500, {
      success: false,
      error: 'Lỗi máy chủ khi xử lý Webhook',
    });
  }
}

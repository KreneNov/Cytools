import type { IncomingMessage, ServerResponse } from 'http';
import { markOrderPaid, getStorageDriver } from './_db.js';
import { applyCorsHeaders } from './_cors.js';

export interface ExtendedRequest extends IncomingMessage {
  query?: Record<string, string>;
  body?: Record<string, any>;
}

export interface ExtendedResponse extends ServerResponse {
  status?: (code: number) => ExtendedResponse;
  json?: (data: any) => void;
}

export function sendJson(res: ExtendedResponse, statusCode: number, data: any, req?: IncomingMessage) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
    applyCorsHeaders(req, res, 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

/**
 * Safely parses request body regardless of whether Vercel serverless runtime
 * provided a pre-parsed object, Buffer, raw JSON string, or readable stream.
 */
export async function parseRequestBody(req: ExtendedRequest): Promise<Record<string, any>> {
  try {
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
        const raw = Buffer.concat(chunks).toString('utf-8');
        return raw ? JSON.parse(raw) : {};
      }
    }
  } catch (err) {
    console.warn('[Webhook Parser] Không thể parse JSON request body:', err);
  }
  return {};
}

/**
 * Safely extracts payment code from messy banking SMS / transaction descriptions.
 * Matches:
 * 1. SEVQR[A-Z0-9]{5} (e.g. "CT DEN:470T26B02L3YPKWW SEVQRN27T5 (0862151811)" -> "SEVQRN27T5")
 * 2. CYPRO[0-9]+ (e.g. "CYPRO01")
 * 3. CY[A-Z0-9]{5} (excluding "CYTOOLS")
 */
export function extractPaymentCode(description: unknown): string | null {
  if (!description || typeof description !== 'string') return null;
  const text = description.trim();

  // 1. Primary: Match SEVQR + 5 alphanumeric characters (VietinBank / SePay standard)
  // Safely extracts the 10-char SEVQR code even when followed by " PRO", " DONATE", or concatenated "PRO"/"DONATE"
  const sevqrMatch = text.match(/(?:^|[^A-Z0-9])(SEVQR[A-Z0-9]{5})/i);
  if (sevqrMatch && sevqrMatch[1]) {
    return sevqrMatch[1].toUpperCase();
  }

  // 2. Secondary: Match CYPRO followed by numbers (legacy pro codes e.g. CYPRO01)
  const cyproMatch = text.match(/(?:^|[^A-Z0-9])(CYPRO[0-9]+)(?:[^A-Z0-9]|$)/i);
  if (cyproMatch && cyproMatch[1]) {
    return cyproMatch[1].toUpperCase();
  }

  // 3. Tertiary: Match CY + 5 alphanumeric characters (legacy format e.g. CYP45J5)
  const cyMatch = text.match(/(?:^|[^A-Z0-9])(CY[A-Z0-9]{5})(?:[^A-Z0-9]|$)/i);
  if (cyMatch && cyMatch[1]) {
    const candidate = cyMatch[1].toUpperCase();
    if (candidate !== 'CYTOOLS') {
      return candidate;
    }
  }

  return null;
}

/**
 * Verifies webhook secret against process.env.SEPAY_API_KEY or process.env.WEBHOOK_SECRET.
 * Supports:
 * - Header 'Authorization': 'Apikey <KEY>' or 'Bearer <KEY>'
 * - Header 'X-Secret-Key', 'x-sepay-token', 'x-api-key'
 * - Query param '?secret=...', '?token=...', or '?apiKey=...'
 * - Body field 'body.secret', 'body.token', or 'body.apiKey'
 */
export function isWebhookAuthorized(req: ExtendedRequest, body?: Record<string, any>): boolean {
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
  const bodyToken = String(body?.secret || body?.token || body?.apiKey || req.body?.secret || req.body?.token || req.body?.apiKey || '').trim();

  return (
    tokenFromAuth === secret ||
    authHeader === secret ||
    xSecret === secret ||
    queryToken === secret ||
    bodyToken === secret
  );
}

/**
 * Core Webhook Request Handler for SePay / VietQR transactions.
 */
export async function handleWebhookRequest(req: ExtendedRequest, res: ExtendedResponse) {
  try {
    // CORS Preflight
    applyCorsHeaders(req, res, 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      return res.end();
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
    }

    // Parse body safely before authorization check
    const body = await parseRequestBody(req);

    // 1. Security check: Validate Webhook Secret
    if (!isWebhookAuthorized(req, body)) {
      console.warn('[Webhook Security] Từ chối Webhook: Sai hoặc thiếu WEBHOOK_SECRET.');
      return sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: Invalid or missing Webhook Secret',
      });
    }

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

    // Robust extraction of payment code
    const code = extractPaymentCode(description);

    if (!code) {
      console.warn(`[Webhook Notice] Không tìm thấy mã SEVQR hoặc CY trong nội dung chuyển khoản: "${description}"`);
      return sendJson(res, 200, {
        success: true,
        matched: false,
        message: 'Bỏ qua giao dịch do không chứa mã định danh (SEVQR hoặc CY)',
      });
    }

    // Determine badge classification from raw transaction content (PRO vs DONATE)
    const upperContent = String(description || '').toUpperCase();
    let badge: 'PRO' | 'DONOR' = 'PRO';
    if (upperContent.includes('DONATE')) {
      badge = 'DONOR';
    } else if (upperContent.includes('PRO')) {
      badge = 'PRO';
    }

    console.log(`[Webhook Matched Code] Tìm thấy mã đơn hàng: ${code}, Phân loại badge: ${badge}`);

    const result = await markOrderPaid(code, amount || 5000, badge);

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
      storageDriver: getStorageDriver(),
      alreadyPaid: Boolean(result.alreadyPaid),
      code,
      actualAmount: result.order?.actualAmount,
      licenseKey: result.order?.code,
      donor: result.donor,
      message: 'Giao dịch đã được xác nhận và đồng bộ lên Vercel KV thành công!',
    });
  } catch (error) {
    console.error('[Webhook Fatal Error] Lỗi khi xử lý Webhook SePay:', error);
    try {
      return sendJson(res, 500, {
        success: false,
        error: 'Lỗi máy chủ khi xử lý Webhook',
      });
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      return res.end();
    }
  }
}

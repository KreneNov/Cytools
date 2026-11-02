import { createClient } from '@vercel/kv';

export interface Order {
  code: string;
  type: 'PRO' | 'DONOR';
  donorName: string;
  expectedAmount: number;
  actualAmount: number;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  paidAt: string | null;
}

export interface License {
  key: string;
  donorName: string;
  createdAt: string;
}

export interface Donor {
  id: number;
  name: string;
  role: string;
  badgeType: 'pro' | 'coffee' | 'heart';
  amount: string;
  numericAmount: number;
  type: 'PRO' | 'DONOR';
  message: string;
  date: string;
  avatarColor: string;
}

export interface CytoolsDb {
  orders: Order[];
  licenses: License[];
  donors: Donor[];
}

export const DB_KEY = 'cytools_db';

export const INITIAL_DB: CytoolsDb = {
  orders: [],
  licenses: [],
  donors: [],
};

const AVATAR_COLORS = [
  'from-pink-500 to-rose-600',
  'from-amber-500 to-orange-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-purple-500 to-indigo-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-fuchsia-600',
  'from-teal-500 to-emerald-600',
  'from-sky-500 to-indigo-600',
];

// In-memory fallback database for local development or when KV is unconfigured/unavailable
let inMemoryDb: CytoolsDb = JSON.parse(JSON.stringify(INITIAL_DB));
let _kvClient: ReturnType<typeof createClient> | null = null;

/**
 * Safely initializes or retrieves the Vercel KV client.
 * Returns null if environment variables are missing, avoiding top-level crashes.
 */
function getKvClient() {
  if (_kvClient) return _kvClient;
  if (typeof process === 'undefined' || !process.env) return null;

  const url = process.env.KV_REST_API_URL || process.env.KV_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  try {
    _kvClient = createClient({ url, token });
    return _kvClient;
  } catch (err) {
    console.warn('[Vercel KV] Lỗi khi tạo KV client:', err);
    return null;
  }
}

/**
 * Reads the database state from Vercel KV with safe in-memory fallback.
 */
export async function getDb(): Promise<CytoolsDb> {
  const client = getKvClient();
  if (client) {
    try {
      const data = await client.get<CytoolsDb>(DB_KEY);
      if (data && typeof data === 'object') {
        if (!Array.isArray(data.orders)) data.orders = [];
        if (!Array.isArray(data.licenses)) data.licenses = [];
        if (!Array.isArray(data.donors)) data.donors = [];
        return data;
      }
      await client.set(DB_KEY, INITIAL_DB);
      return JSON.parse(JSON.stringify(INITIAL_DB));
    } catch (err) {
      console.warn('[Vercel KV] Lỗi khi đọc dữ liệu từ Vercel KV, chuyển sang chế độ fallback:', err);
      return inMemoryDb;
    }
  }

  return inMemoryDb;
}

/**
 * Saves database state to Vercel KV with safe in-memory fallback.
 */
export async function saveDb(data: CytoolsDb): Promise<void> {
  const client = getKvClient();
  if (client) {
    try {
      await client.set(DB_KEY, data);
      return;
    } catch (err) {
      console.warn('[Vercel KV] Lỗi khi lưu dữ liệu vào Vercel KV, lưu tạm vào memory:', err);
      inMemoryDb = JSON.parse(JSON.stringify(data));
      return;
    }
  }

  inMemoryDb = JSON.parse(JSON.stringify(data));
}

/**
 * Generates a unique 10-character code starting with SEVQR.
 */
export function generatePaymentCode(db: CytoolsDb): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  let attempts = 0;

  do {
    code = 'SEVQR';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    attempts++;
  } while (db.orders.some((o) => o.code === code) && attempts < 100);

  return code;
}

/**
 * Creates a new pending payment order with dynamic code validation.
 */
export async function createOrder({
  type = 'PRO',
  donorName = '',
  code: requestedCode,
}: {
  type?: 'PRO' | 'DONOR';
  donorName?: string;
  code?: string;
}): Promise<{ order: Order; qrUrl: string }> {
  const db = await getDb();

  let code = '';
  if (requestedCode && typeof requestedCode === 'string') {
    const clean = requestedCode.trim().toUpperCase();
    if (/^SEVQR[A-Z0-9]{5}$/.test(clean) && !db.orders.some((o) => o.code.toUpperCase() === clean)) {
      code = clean;
    }
  }
  if (!code) {
    code = generatePaymentCode(db);
  }
  const expectedAmount = type === 'PRO' ? 5000 : 0;
  const now = new Date().toISOString();

  const newOrder: Order = {
    code,
    type,
    donorName: donorName.trim(),
    expectedAmount,
    actualAmount: 0,
    status: 'PENDING',
    createdAt: now,
    paidAt: null,
  };

  db.orders.push(newOrder);
  await saveDb(db);

  // VietinBank (ICB) account 0862151811 (Nguyen Dang Khanh)
  const qrUrl =
    type === 'PRO'
      ? `https://img.vietqr.io/image/ICB-0862151811-compact2.png?amount=5000&addInfo=${code}&accountName=NGUYEN%20DANG%20KHANH`
      : `https://img.vietqr.io/image/ICB-0862151811-compact2.png?addInfo=${code}&accountName=NGUYEN%20DANG%20KHANH`;

  return { order: newOrder, qrUrl };
}

/**
 * Retrieves an order by payment code.
 */
export async function getOrder(code: string): Promise<Order | null> {
  if (!code) return null;
  const db = await getDb();
  const upper = code.trim().toUpperCase();
  return db.orders.find((o) => o.code.toUpperCase() === upper) || null;
}

/**
 * Updates the display name for a pending order.
 */
export async function updateOrderName(code: string, donorName: string): Promise<Order | null> {
  if (!code) return null;
  const db = await getDb();
  const upper = code.trim().toUpperCase();
  const order = db.orders.find((o) => o.code.toUpperCase() === upper);
  if (!order) return null;

  order.donorName = (donorName || '').trim();
  await saveDb(db);
  return order;
}

/**
 * Marks an order as PAID, registers license key, and inserts donor into Hall of Fame.
 * If the order was not pre-registered in DB (e.g. direct VietQR transfer or KV reset),
 * automatically provisions the order record so valid customer transactions are NEVER lost.
 */
export async function markOrderPaid(
  code: string,
  actualAmount: number = 5000
): Promise<{
  success: boolean;
  order?: Order;
  donor?: Donor;
  alreadyPaid?: boolean;
  error?: string;
}> {
  if (!code) return { success: false, error: 'Mã đơn hàng không hợp lệ' };
  const db = await getDb();
  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.licenses)) db.licenses = [];
  if (!Array.isArray(db.donors)) db.donors = [];

  const upper = code.trim().toUpperCase();
  let order = db.orders.find((o) => o && o.code && o.code.toUpperCase() === upper);

  const now = new Date();
  const paidIso = now.toISOString();

  if (!order) {
    // Auto-provision order on-the-fly for confirmed payments
    const isPro = actualAmount >= 5000;
    order = {
      code: upper,
      type: isPro ? 'PRO' : 'DONOR',
      donorName: 'Người bạn ẩn danh',
      expectedAmount: actualAmount,
      actualAmount: actualAmount,
      status: 'PAID',
      createdAt: paidIso,
      paidAt: paidIso,
    };
    db.orders.push(order);
  } else {
    if (order.status === 'PAID') {
      return { success: true, order, alreadyPaid: true };
    }

    if (order.type === 'PRO' && actualAmount < 5000) {
      return { success: false, error: 'Số tiền thanh toán chưa đủ 5.000đ cho gói PRO' };
    }

    order.status = 'PAID';
    order.actualAmount = actualAmount;
    order.paidAt = paidIso;
  }

  const finalName = order.donorName?.trim() || 'Người bạn ẩn danh';

  // 1. Register license key (order code acts as the license key)
  if (!db.licenses.some((l) => l && l.key && l.key.toUpperCase() === upper)) {
    db.licenses.push({
      key: upper,
      donorName: finalName,
      createdAt: paidIso,
    });
  }

  // 2. Prepend new donor to Hall of Fame
  const formattedDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const formattedAmount = `${new Intl.NumberFormat('vi-VN').format(actualAmount)}đ`;
  const isPro = order.type === 'PRO';
  const role = isPro ? 'PRO Member' : actualAmount >= 50000 ? 'Super Supporter' : 'Donator';
  const badgeType: 'pro' | 'coffee' | 'heart' = isPro ? 'pro' : actualAmount >= 50000 ? 'coffee' : 'heart';
  const randomColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const defaultMessage = isPro
    ? 'Kích hoạt gói PRO tự động qua VietQR.'
    : 'Ủng hộ dự án Cytools phát triển cộng đồng.';

  const newDonor: Donor = {
    id: Date.now(),
    name: finalName,
    role,
    badgeType,
    amount: formattedAmount,
    numericAmount: actualAmount,
    type: order.type,
    message: defaultMessage,
    date: formattedDate,
    avatarColor: randomColor,
  };

  db.donors.unshift(newDonor);
  await saveDb(db);

  return { success: true, order, donor: newDonor };
}

/**
 * Checks if a license key is valid.
 */
export async function verifyLicenseKey(
  key: string
): Promise<{ valid: boolean; donorName?: string; key?: string }> {
  if (!key || typeof key !== 'string') {
    return { valid: false };
  }
  const cleanKey = key.trim().toUpperCase();
  const db = await getDb();

  // Check in licenses list
  const license = db.licenses.find((l) => l.key.toUpperCase() === cleanKey);
  if (license) {
    return { valid: true, donorName: license.donorName, key: license.key };
  }

  // Fallback: Check in paid orders
  const paidOrder = db.orders.find((o) => o.code.toUpperCase() === cleanKey && o.status === 'PAID');
  if (paidOrder) {
    return { valid: true, donorName: paidOrder.donorName || 'Người bạn ẩn danh', key: paidOrder.code };
  }

  return { valid: false };
}

/**
 * Retrieves Hall of Fame statistics and donors list.
 */
export async function getHallOfFame(): Promise<{
  donors: Donor[];
  totalAmount: number;
  proCount: number;
  donorCount: number;
}> {
  const db = await getDb();
  const donors = db.donors || [];

  const totalAmount = donors.reduce((sum, d) => {
    if (typeof d.numericAmount === 'number') {
      return sum + d.numericAmount;
    }
    const parsed = parseInt(String(d.amount).replace(/[^\d]/g, ''), 10);
    return sum + (Number.isNaN(parsed) ? 0 : parsed);
  }, 0);

  const proCount = donors.filter((d) => d.type === 'PRO' || d.role === 'PRO Member').length;
  const donorCount = donors.filter((d) => d.type !== 'PRO' && d.role !== 'PRO Member').length;

  return {
    donors,
    totalAmount,
    proCount,
    donorCount,
  };
}

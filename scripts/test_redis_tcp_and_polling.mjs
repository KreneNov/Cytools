import { getStorageDriver, getDb } from '../api/_db.js';
import { handleWebhookRequest } from '../api/_webhook_core.js';
import statusHandler from '../api/payment/status.js';
import updateNameHandler from '../api/payment/update-name.js';
import hallOfFameHandler from '../api/hall-of-fame.js';
import assert from 'assert';

console.log('--- STARTING REDIS TCP & MODAL TAB POLLING TEST SUITE ---');

// Helper to simulate request/response
function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, query = {} } = {}) {
  const req = {
    method,
    url,
    headers,
    body,
    query,
  };

  let statusCode = 200;
  const resHeaders = {};
  let bodyData = '';

  const res = {
    statusCode: 200,
    setHeader(name, val) {
      resHeaders[name.toLowerCase()] = val;
    },
    getHeader(name) {
      return resHeaders[name.toLowerCase()];
    },
    status(code) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(obj) {
      bodyData = JSON.stringify(obj);
      return this;
    },
    end(chunk) {
      if (chunk) bodyData = chunk;
    },
    get _body() {
      try {
        return JSON.parse(bodyData);
      } catch {
        return bodyData;
      }
    },
    get _status() {
      return this.statusCode || statusCode;
    },
  };

  return { req, res };
}

async function runTests() {
  // Test 1: Storage Driver fallback check
  console.log('[Test 1] Testing Storage Driver without Redis URL:');
  const initialDriver = getStorageDriver();
  console.log('Driver without redis url:', initialDriver);
  assert.ok(['in-memory', 'vercel-kv'].includes(initialDriver), 'Storage driver must be in-memory or vercel-kv');
  console.log('✓ Test 1 Passed');

  // Test 2: Webhook incoming payment processing & immediate donor insertion
  console.log('\n[Test 2] Testing Webhook payment processing with auto-provisioning & donor sync:');
  const code = 'SEVQR789XY';
  const { req: wReq, res: wRes } = createMockReqRes({
    method: 'POST',
    url: '/api/webhook',
    body: {
      content: `CT DEN:470T26B02L3YPKWW ${code} (0862151811)`,
      transferType: 'in',
      transferAmount: 50000,
    },
  });

  await handleWebhookRequest(wReq, wRes);
  const wData = wRes._body;
  console.log('Webhook Response:', wData);
  assert.strictEqual(wData.success, true, 'Webhook must return success: true');
  assert.strictEqual(wData.matched, true, 'Webhook must match payment code');
  assert.strictEqual(wData.code, code, 'Webhook must match code SEVQR789XY');
  assert.strictEqual(wData.actualAmount, 50000, 'Actual amount must be 50,000');
  assert.ok(wData.donor, 'Donor must be returned in webhook payload');
  assert.strictEqual(wData.donor.name, 'Người bạn đồng hành', 'Default donor name must be Người bạn đồng hành');
  assert.strictEqual(wData.donor.code, code, 'Donor code must match order code');
  console.log('✓ Test 2 Passed');

  // Test 3: Status API returning paid: true & status: PAID
  console.log('\n[Test 3] Testing /api/payment/status?code=' + code + ':');
  const { req: sReq, res: sRes } = createMockReqRes({
    method: 'GET',
    url: `/api/payment/status?code=${code}`,
    query: { code },
  });

  await statusHandler(sReq, sRes);
  const sData = sRes._body;
  console.log('Status Response:', sData);
  assert.strictEqual(sData.success, true, 'Status response must succeed');
  assert.strictEqual(sData.paid, true, 'Status response MUST include paid: true');
  assert.strictEqual(sData.status, 'PAID', 'Status response must have status: PAID');
  assert.strictEqual(sData.licenseKey, code, 'License key must match order code');
  assert.strictEqual(sData.amount, 50000, 'Amount must match 50,000');
  console.log('✓ Test 3 Passed');

  // Test 4: Update donor name and sync to all 3 DB collections
  console.log('\n[Test 4] Testing /api/payment/update-name:');
  const { req: uReq, res: uRes } = createMockReqRes({
    method: 'POST',
    url: '/api/payment/update-name',
    body: {
      code,
      donorName: 'Nguyễn Văn Hảo Tâm',
    },
  });

  await updateNameHandler(uReq, uRes);
  const uData = uRes._body;
  console.log('Update Name Response:', uData);
  assert.strictEqual(uData.success, true, 'Update name must succeed');
  assert.strictEqual(uData.donorName, 'Nguyễn Văn Hảo Tâm', 'Order donor name must be updated');

  // Verify in DB directly
  const db = await getDb();
  const donorInDb = db.donors.find((d) => d.code === code);
  assert.ok(donorInDb, 'Donor must exist in db.donors');
  assert.strictEqual(donorInDb.name, 'Nguyễn Văn Hảo Tâm', 'Donor name in db.donors must be synced');

  const licenseInDb = db.licenses.find((l) => l.key === code);
  assert.ok(licenseInDb, 'License must exist in db.licenses');
  assert.strictEqual(licenseInDb.donorName, 'Nguyễn Văn Hảo Tâm', 'License donorName in db.licenses must be synced');
  console.log('✓ Test 4 Passed');

  // Test 5: Hall of Fame endpoint returns storageDriver and updated donor
  console.log('\n[Test 5] Testing /api/hall-of-fame:');
  const { req: hReq, res: hRes } = createMockReqRes({
    method: 'GET',
    url: '/api/hall-of-fame',
  });

  await hallOfFameHandler(hReq, hRes);
  const hData = hRes._body;
  console.log('Hall of Fame Response:', {
    success: hData.success,
    storageDriver: hData.storageDriver,
    totalAmount: hData.totalAmount,
    donorCount: hData.donors?.length,
  });
  assert.strictEqual(hData.success, true, 'Hall of Fame must succeed');
  assert.ok(hData.storageDriver, 'Hall of Fame must return storageDriver');
  assert.ok(hData.donors.some((d) => d.name === 'Nguyễn Văn Hảo Tâm'), 'Hall of Fame must include updated donor');
  console.log('✓ Test 5 Passed');

  console.log('\n======================================================');
  console.log('ALL 5 INTEGRATION TESTS PASSED CLEANLY & AS EXPECTED!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

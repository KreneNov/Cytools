import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- STARTING EXTENSION API ROUTING & MANIFEST TEST SUITE ---');

// Dynamically test api.ts logic in various environments
async function runTests() {
  const apiModule = await import('../src/utils/api.ts');

  // Test 1: Web Browser simulation (no chrome runtime, protocol = 'https:')
  console.log('[Test 1] Testing Web Browser Mode (Relative URLs):');
  globalThis.window = {
    location: {
      protocol: 'https:',
      hostname: 'cytools.vercel.app',
    },
  };
  globalThis.chrome = undefined;

  assert.strictEqual(apiModule.isExtensionEnvironment(), false, 'Should NOT be extension environment');
  assert.strictEqual(apiModule.getApiUrl('/api/payment/verify-key'), '/api/payment/verify-key', 'Web mode must return relative URL');
  assert.strictEqual(apiModule.getApiUrl('api/hall-of-fame'), '/api/hall-of-fame', 'Web mode must normalize leading slash');
  console.log('✓ Test 1 Passed');

  // Test 2: Chrome Extension simulation via chrome-extension: protocol
  console.log('\n[Test 2] Testing Chrome Extension Mode via chrome-extension: protocol:');
  globalThis.window = {
    location: {
      protocol: 'chrome-extension:',
      hostname: 'abcdefghijklmnop',
    },
  };
  globalThis.chrome = undefined;

  assert.strictEqual(apiModule.isExtensionEnvironment(), true, 'Must detect extension via protocol');
  const extVerifyUrl = apiModule.getApiUrl('/api/payment/verify-key');
  console.log('Extension verify-key URL:', extVerifyUrl);
  assert.strictEqual(extVerifyUrl, 'https://cytools.vercel.app/api/payment/verify-key', 'Must prepend production Vercel domain');

  const extStatusUrl = apiModule.getApiUrl('/api/payment/status?code=SEVQR99999');
  console.log('Extension status URL:', extStatusUrl);
  assert.strictEqual(extStatusUrl, 'https://cytools.vercel.app/api/payment/status?code=SEVQR99999', 'Must preserve query parameters');
  console.log('✓ Test 2 Passed');

  // Test 3: Chrome Extension simulation via chrome.runtime.id
  console.log('\n[Test 3] Testing Chrome Extension Mode via chrome.runtime.id:');
  globalThis.window = {
    location: {
      protocol: 'http:',
      hostname: 'localhost',
    },
  };
  globalThis.chrome = {
    runtime: {
      id: 'mock-extension-id-12345',
    },
  };

  assert.strictEqual(apiModule.isExtensionEnvironment(), true, 'Must detect extension via chrome.runtime.id');
  const extHofUrl = apiModule.getApiUrl('/api/hall-of-fame');
  console.log('Extension Hall of Fame URL:', extHofUrl);
  assert.strictEqual(extHofUrl, 'https://cytools.vercel.app/api/hall-of-fame', 'Must route to production Vercel domain');
  console.log('✓ Test 3 Passed');

  // Test 4: External absolute URLs should not be modified
  console.log('\n[Test 4] Testing External URLs Pass-Through:');
  const externalUrl = 'https://img.vietqr.io/image/ICB-0862151811-compact2.png';
  assert.strictEqual(apiModule.getApiUrl(externalUrl), externalUrl, 'External URLs must pass through untouched');
  console.log('✓ Test 4 Passed');

  // Test 5: Verify public/manifest.json host_permissions
  console.log('\n[Test 5] Verifying public/manifest.json host_permissions:');
  const manifestPath = path.resolve(__dirname, '../public/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(Array.isArray(manifest.host_permissions), 'manifest.json must have host_permissions array');
  assert.ok(manifest.host_permissions.includes('https://cytools.vercel.app/*'), 'host_permissions must contain https://cytools.vercel.app/*');
  assert.ok(manifest.host_permissions.includes('*://*.vercel.app/*'), 'host_permissions must contain *://*.vercel.app/*');
  console.log('Manifest Host Permissions:', manifest.host_permissions);
  console.log('✓ Test 5 Passed');

  console.log('\n======================================================');
  console.log('ALL 5 EXTENSION API ROUTING TESTS PASSED PERFECTLY!');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

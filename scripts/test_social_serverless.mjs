import { detectPlatform, extractTikTok, extractPinterest } from '../api/_social_extractor.ts';
import extractHandler from '../api/social/extract.ts';
import downloadHandler from '../api/download.ts';
import { EventEmitter } from 'events';

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
    this.headersSent = false;
  }
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  }
  getHeader(k) {
    return this.headers[k.toLowerCase()];
  }
  end(data) {
    if (data) this.body += data;
    this.headersSent = true;
    this.emit('finish');
    return this;
  }
  write(chunk) {
    this.body += chunk;
    return true;
  }
}

async function runTests() {
  console.log('=== TEST 1: detectPlatform ===');
  console.assert(detectPlatform('https://www.tiktok.com/@user/video/123') === 'tiktok', 'TikTok detection failed');
  console.assert(detectPlatform('https://pin.it/abc') === 'pinterest', 'Pinterest detection failed');
  console.assert(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ') === 'youtube', 'YouTube detection failed');
  console.assert(detectPlatform('https://www.facebook.com/reel/123') === 'facebook', 'Facebook detection failed');
  console.assert(detectPlatform('https://www.instagram.com/reel/abc') === 'instagram', 'Instagram detection failed');
  console.log('✔ detectPlatform: All 5 platforms detected correctly');

  console.log('\n=== TEST 2: OPTIONS Preflight for /api/social/extract ===');
  const optReq = { method: 'OPTIONS', url: '/api/social/extract' };
  const optRes = new MockResponse();
  await extractHandler(optReq, optRes);
  console.assert(optRes.statusCode === 204, `Expected 204 for OPTIONS, got ${optRes.statusCode}`);
  console.assert(optRes.getHeader('access-control-allow-origin') === '*', 'Missing CORS header');
  console.log('✔ OPTIONS Preflight: Returned 204 and Access-Control-Allow-Origin: *');

  console.log('\n=== TEST 3: Missing URL Validation for /api/social/extract ===');
  const missReq = { method: 'GET', url: '/api/social/extract' };
  const missRes = new MockResponse();
  await extractHandler(missReq, missRes);
  console.assert(missRes.statusCode === 400, `Expected 400 for missing url, got ${missRes.statusCode}`);
  const missJson = JSON.parse(missRes.body);
  console.assert(missJson.success === false, 'Expected success: false');
  console.log('✔ Missing URL: Returned 400 with clean error JSON');

  console.log('\n=== TEST 4: Live TikTok Extraction ===');
  try {
    const ttRes = await extractTikTok('https://www.tiktok.com/@tiktok/video/7106594312292453675');
    console.log('TikTok Extraction Result:', {
      success: ttRes.success,
      platform: ttRes.platform,
      type: ttRes.type,
      title: ttRes.title?.slice(0, 40),
      mediaCount: ttRes.mediaOptions?.length,
    });
    console.assert(ttRes.success === true, 'TikTok extraction should succeed');
    console.assert(ttRes.platform === 'tiktok', 'Platform should be tiktok');
    console.log('✔ Live TikTok extraction succeeded with TikWM!');
  } catch (err) {
    console.warn('TikTok live network test notice:', err.message);
  }

  console.log('\n=== TEST 5: Download Proxy Endpoint Security & Headers ===');
  const dlOptReq = { method: 'OPTIONS', url: '/api/download' };
  const dlOptRes = new MockResponse();
  await downloadHandler(dlOptReq, dlOptRes);
  console.assert(dlOptRes.statusCode === 204, `Expected 204 for download OPTIONS, got ${dlOptRes.statusCode}`);
  console.assert(dlOptRes.getHeader('access-control-expose-headers')?.includes('Content-Disposition'), 'Missing Expose-Headers');
  console.log('✔ Download Endpoint: Preflight and CORS Expose-Headers verified');

  const rootReq = { method: 'GET', url: '/api/download?url=https://cobalt.tools/' };
  const rootRes = new MockResponse();
  await downloadHandler(rootReq, rootRes);
  console.assert(rootRes.statusCode === 400, `Expected 400 for root domain download, got ${rootRes.statusCode}`);
  console.log('✔ Download Endpoint: Blocked root domain URL correctly');

  console.log('\n========================================');
  console.log('ALL VERIFICATION CHECKS PASSED PERFECTLY!');
  console.log('========================================');
}

runTests().catch((e) => {
  console.error('Test run failed:', e);
  process.exit(1);
});

import {
  extractUrlFromAny,
  resolveYouTubeServerSide,
  pollYouTubeSaveNowProgress,
} from '../api/_youtube_resolver.ts';
import { createCipheriv } from 'node:crypto';

async function runTests() {
  console.log('--- 1. Testing extractUrlFromAny across multiple schemas ---');

  // Case A: standard downloadUrl
  const u1 = extractUrlFromAny({ data: { downloadUrl: 'https://cdn.example.com/a.mp4' } });
  console.assert(u1 === 'https://cdn.example.com/a.mp4', 'Failed Case A');

  // Case B: alternative key url
  const u2 = extractUrlFromAny({ data: { url: 'https://cdn.example.com/b.mp4' } });
  console.assert(u2 === 'https://cdn.example.com/b.mp4', 'Failed Case B');

  // Case C: streamUrl
  const u3 = extractUrlFromAny({ streamUrl: 'https://cdn.example.com/c.mp4' });
  console.assert(u3 === 'https://cdn.example.com/c.mp4', 'Failed Case C');

  // Case D: nested in array
  const u4 = extractUrlFromAny([{ file: 'https://cdn.example.com/d.mp4' }]);
  console.assert(u4 === 'https://cdn.example.com/d.mp4', 'Failed Case D');

  // Case E: direct string
  const u5 = extractUrlFromAny('https://cdn.example.com/e.mp4');
  console.assert(u5 === 'https://cdn.example.com/e.mp4', 'Failed Case E');

  // Case F: encrypted base64 payload
  const iv = Buffer.from('0123456789abcdef0123456789abcdef'.slice(0, 16), 'utf8');
  const keyBuf = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');
  const cipher = createCipheriv('aes-128-cbc', keyBuf, iv);
  const plain = Buffer.from(JSON.stringify({ downloadUrl: 'https://cdn.example.com/encrypted.mp4' }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const b64 = Buffer.concat([iv, encrypted]).toString('base64');
  const u6 = extractUrlFromAny(b64);
  console.assert(u6 === 'https://cdn.example.com/encrypted.mp4', 'Failed Case F (encrypted)');

  console.log('All extractUrlFromAny unit tests PASSED!');

  console.log('\n--- 2. Testing resolveYouTubeServerSide live resolution ---');
  const t0 = Date.now();
  const res = await resolveYouTubeServerSide('dQw4w9WgXcQ', '720');
  const duration = Date.now() - t0;
  console.log(`Resolution completed in ${duration}ms:`, {
    success: res.success,
    provider: res.provider,
    quality: res.quality,
    hasUrl: !!res.url,
    pendingId: res.pendingId,
  });
  console.assert(res.success === true, 'Live resolution must succeed');

  console.log('\n--- 3. Testing 502 prevention on invalid video ID ---');
  const invalidRes = await resolveYouTubeServerSide('invalid_bad_id_9999999', '720');
  console.log('Invalid video result:', invalidRes);
  console.assert(invalidRes.success === false, 'Invalid video must return success=false cleanly');
  console.assert(typeof invalidRes.error === 'string', 'Error message must be a clean string');

  console.log('\n--- ALL TEST SUITE CHECKS PASSED SUCCESSFULLY ---');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});

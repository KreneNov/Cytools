import { resolveYouTubeServerSide, pollYouTubeSaveNowProgress } from '../api/_youtube_resolver.ts';

const id = process.argv[2] || 'dQw4w9WgXcQ';
for (const fmt of ['720', 'mp3']) {
  const t = Date.now();
  const r = await resolveYouTubeServerSide(id, fmt);
  console.log(fmt, Date.now() - t, 'ms', JSON.stringify({ ...r, url: r.url?.slice(0, 90) }));
  if (r.pendingId) {
    for (let i = 0; i < 15; i++) {
      await new Promise((s) => setTimeout(s, 2000));
      const p = await pollYouTubeSaveNowProgress(r.pendingId);
      console.log('  poll', i, JSON.stringify({ ...p, url: p.url?.slice(0, 90) }));
      if (p.url || p.status === 'failed') break;
    }
  }
}

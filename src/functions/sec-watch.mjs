// 2분마다 실행되는 SEC 수집기 (Cloudflare Cron Trigger)
import { runSecWatch } from '../lib/sec-core.mjs';
import { getJSON } from '../lib/store.mjs';
import { capturePx0 } from '../lib/px0.mjs';
import { prewarm, pickSec } from '../lib/prewarm.mjs';

export default async () => {
  try {
    const r = await runSecWatch();
    console.log('sec-watch', JSON.stringify(r));
    const feedNow = (await getJSON('sec/feed'))?.items;
    await capturePx0(feedNow).catch((e) => console.warn('px0', e.message)); // 발표 시점 주가 기록
    // 새 중요 공시는 AI 분석·기업 정보를 미리 준비
    const n = await prewarm(pickSec((await getJSON('sec/feed'))?.items), { max: 3 }).catch((e) => console.warn('prewarm', e.message));
    if (n) console.log('sec prewarm', n);
  } catch (e) {
    console.error('sec-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

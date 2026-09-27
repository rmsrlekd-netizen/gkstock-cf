// 2분마다 실행되는 DART 수집기 (Cloudflare Cron Trigger)
import { runDartWatch } from '../lib/dart-core.mjs';
import { getJSON } from '../lib/store.mjs';
import { capturePx0 } from '../lib/px0.mjs';
import { prewarm, pickDart } from '../lib/prewarm.mjs';

export default async () => {
  try {
    const r = await runDartWatch();
    console.log('dart-watch', JSON.stringify(r));
    const feedNow = (await getJSON('dart/feed'))?.items;
    await capturePx0(feedNow).catch((e) => console.warn('px0', e.message)); // 발표 시점 주가 기록
    // 새 중요 공시는 AI 분석·기업 정보를 미리 준비
    const n = await prewarm(pickDart((await getJSON('dart/feed'))?.items), { max: 3 }).catch((e) => console.warn('prewarm', e.message));
    if (n) console.log('dart prewarm', n);
  } catch (e) {
    console.error('dart-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

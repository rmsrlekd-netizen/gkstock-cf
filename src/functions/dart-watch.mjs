// 1분마다 실행되는 DART 수집기 (Cloudflare Cron Trigger)
import { runDartWatch } from '../lib/dart-core.mjs';
import { getJSON } from '../lib/store.mjs';
import { capturePx0 } from '../lib/px0.mjs';
import { archiveItems } from '../lib/archive.mjs';
import { backfillStep } from '../lib/backfill.mjs';
import { prewarm, pickDart, prewarmQuick, pickQuick } from '../lib/prewarm.mjs';

export default async ({ backfillMs = 12000 } = {}) => {
  try {
    const r = await runDartWatch();
    console.log('dart-watch', JSON.stringify(r));
    const feedNow = (await getJSON('dart/feed'))?.items;
    await capturePx0(feedNow).catch((e) => console.warn('px0', e.message)); // 발표 시점 주가 기록
    await archiveItems(feedNow).catch((e) => console.warn('archive', e.message)); // 영구 보관 (지우지 않음)
    // 새 중요 공시는 AI 분석·기업 정보를 미리 준비
    // v215: 1분 크론 안에서 끝나도록 시간 예산을 나눔 (v214에서 심층 6건·빠른 요약 8건이 겹쳐 실행이 1분을 넘기고 쌓이며 DB가 막혔던 문제)
    const feedItems = (await getJSON('dart/feed'))?.items;
    const n = await prewarm(pickDart(feedItems), { max: 2, budgetMs: 28000 }).catch((e) => console.warn('prewarm', e.message));
    if (!n) { const nq = await prewarmQuick(pickQuick(feedItems), { max: 4, budgetMs: 12000 }).catch((e) => console.warn('prewarmQ', e.message)); if (nq) console.log('quick prewarm', nq); } // 심층 분석을 안 한 차례에만 3줄 요약 미리
    if (n) console.log('dart prewarm', n);
    // 남는 시간에 과거 공시 채우기 (하루치씩 거슬러 올라감)
    const b = backfillMs ? await backfillStep('dart', { budgetMs: backfillMs }).catch((e) => console.warn('backfill', e.message)) : 0;
    if (b) console.log('dart backfill', b);
  } catch (e) {
    console.error('dart-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

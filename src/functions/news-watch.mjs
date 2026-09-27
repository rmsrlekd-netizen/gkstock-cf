// 보도자료 수집기
//  mode 'pr'   (1분마다): 보도자료 수집 → 발표 시점 주가 기록 → 영구 보관
//  mode 'maint'(3분마다): 상장사 이름·섹터 갱신, 영문 제목 한국어화, AI 미리 분석, 고장 감시
import { getKrNames } from '../lib/krnames.mjs';
import { getSectors } from '../lib/sectors.mjs';
import { collectNews } from '../lib/news.mjs';
import { hasAI, translateTitles } from '../lib/ai.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { prewarm, pickPR } from '../lib/prewarm.mjs';
import { capturePx0 } from '../lib/px0.mjs';
import { archiveItems } from '../lib/archive.mjs';
import { runMonitor } from '../lib/monitor.mjs';

export default async ({ mode = 'all', full = true, direct = false } = {}) => {
  const started = Date.now();
  try {
    if (mode === 'pr' || mode === 'all') {
      const feed = await collectNews({ full, direct });
      await capturePx0(feed.items).catch((e) => console.warn('px0', e.message));
      await archiveItems(feed.items.filter((x) => x.src === 'PR')).catch((e) => console.warn('archive', e.message)); // 보도자료 영구 보관
      console.log('pr-watch', feed.items.length, full ? 'full' : 'light', direct ? 'direct' : '', Date.now() - started + 'ms');
    }
    if (mode === 'maint' || mode === 'all') {
      await getKrNames({ allowFetch: true });
      await getSectors({ allowFetch: true }).catch((e) => console.warn('sectors', e.message));
      const feed = (await getJSON('news/feed')) || { items: [] };
      if (hasAI()) {
        const need = feed.items.filter((x) => x.src === 'PR' && x.market === 'US' && !x.titleKo && !/[가-힣]/.test(x.title) && (x.koTries || 0) < 2).slice(0, 40);
        if (need.length) {
          let ko = {}, err = null;
          try {
            const parts = await Promise.all([need.slice(0, 20), need.slice(20)].filter((b) => b.length).map((b) => translateTitles(b)));
            ko = Object.assign({}, ...parts);
          } catch (e) { err = String(e.message || e).slice(0, 300); }
          // 번역은 공용 번역표(tr/map)에도 저장 → 1분마다 도는 수집기가 덮어써도 사라지지 않음
          if (Object.keys(ko).length) {
            const tr = (await getJSON('tr/map')) || {};
            Object.assign(tr, ko);
            await setJSON('tr/map', tr).catch(() => {});
          }
          const cur = (await getJSON('news/feed')) || { items: [] };
          for (const x of cur.items) if (ko[x.id]) x.titleKo = ko[x.id]; else if (need.some((n) => n.id === x.id)) x.koTries = (x.koTries || 0) + 1;
          cur.aiError = err;
          await setJSON('news/feed', cur);
        }
      }
      const ms = await getJSON('monitor/state');
      if (!ms || Date.now() - ms.at > 8 * 60e3) await runMonitor().catch((e) => console.warn('monitor', e.message)); // 고장 자동 감시 (약 9분마다)
      const n = await prewarm(pickPR((await getJSON('news/feed'))?.items), { max: 3 }).catch((e) => console.warn('prewarm', e.message));
      console.log('maint', 'prewarm', n || 0, Date.now() - started + 'ms');
    }
  } catch (e) {
    console.error('news-watch failed', e);
  }
};

export const config = { schedule: '*/3 * * * *' };

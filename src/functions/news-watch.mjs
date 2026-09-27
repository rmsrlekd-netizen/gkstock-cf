// 3분마다: 국내 상장사 이름 목록 갱신(주 1회) + 뉴스 수집 + 영문 보도자료 제목 한국어화
import { getKrNames } from '../lib/krnames.mjs';
import { getSectors } from '../lib/sectors.mjs';
import { collectNews } from '../lib/news.mjs';
import { hasAI, translateTitles } from '../lib/ai.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';

export default async () => {
  const started = Date.now();
  try {
    await getKrNames({ allowFetch: true });
    await getSectors({ allowFetch: true }).catch((e) => console.warn('sectors', e.message));
    const feed = await collectNews();
    if (hasAI()) {
      const need = feed.items.filter((x) => x.market === 'US' && !x.titleKo && !/[가-힣]/.test(x.title) && (x.koTries || 0) < 2).slice(0, 40);
      if (need.length && Date.now() - started < 60000) {
        const cur = await getJSON('news/feed');
        try {
          const parts = await Promise.all([need.slice(0, 20), need.slice(20)].filter((b) => b.length).map((b) => translateTitles(b).catch((e) => { throw e; })));
          const ko = Object.assign({}, ...parts);
          for (const x of cur.items) if (ko[x.id]) x.titleKo = ko[x.id]; else if (need.some((n) => n.id === x.id)) x.koTries = (x.koTries || 0) + 1;
          cur.aiError = null;
        } catch (e) {
          cur.aiError = String(e.message || e).slice(0, 300);
          for (const x of cur.items) if (need.some((n) => n.id === x.id)) x.koTries = (x.koTries || 0) + 1;
        }
        await setJSON('news/feed', cur);
      }
    }
    console.log('news-watch', feed.items.length, Date.now() - started + 'ms');
  } catch (e) {
    console.error('news-watch failed', e);
  }
};

export const config = { schedule: '*/10 * * * *' };

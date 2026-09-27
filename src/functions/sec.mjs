// /api/sec — 저장된 SEC 피드 반환 (수집기가 아직 안 돌았으면 즉석 수집)
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { collectSec, mergeFeed, enrichForm4 } from '../lib/sec-core.mjs';

export default async () => {
  try {
    let feed = await getJSON('sec/feed');
    let mode = 'watcher';
    // 마지막 수집 후 90초가 지났으면 방문 시 가볍게 새로 수집 (10분마다 도는 수집기가 원문 보강 담당)
    if (!feed || Date.now() - Date.parse(feed.updatedAt || 0) > 90e3) {
      mode = 'live';
      const { items, errors } = await collectSec({ spacing: 80, fastOnly: true, budget: 5000 });
      const merged = mergeFeed(feed?.items || [], items);
      await enrichForm4(merged, { max: 4, deadline: Date.now() + 1500 });
      feed = { ...(feed || {}), updatedAt: new Date().toISOString(), errors, items: merged };
      await setJSON('sec/feed', feed).catch(() => {});
    }
    const items = feed.items.slice(0, 600).map(({ _excerpt, txTries, docTries, aiTries, ...x }) => x);
    return json({ ok: true, source: 'SEC EDGAR', mode, updatedAt: feed.updatedAt, errors: feed.errors || [], count: items.length, items }, { cdnSeconds: 15, swr: 30 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), items: [] }, { cdnSeconds: 5, swr: 10, status: 502 });
  }
};

export const config = { path: '/api/sec' };

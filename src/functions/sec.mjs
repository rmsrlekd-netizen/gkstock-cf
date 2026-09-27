// /api/sec — 저장된 SEC 피드 반환 (수집기가 아직 안 돌았으면 즉석 수집)
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { collectSec, mergeFeed, enrichForm4 } from '../lib/sec-core.mjs';
import { koHeadline } from '../lib/sec-ko.mjs';
import { attachPx0 } from '../lib/px0.mjs';

async function liveSec() {
  const feed = await getJSON('sec/feed');
  const { items, errors } = await collectSec({ spacing: 80, fastOnly: true, budget: 5000 });
  const merged = mergeFeed(feed?.items || [], items);
  await enrichForm4(merged, { max: 4, deadline: Date.now() + 1500 });
  const out = { ...(feed || {}), updatedAt: new Date().toISOString(), errors, items: merged };
  await setJSON('sec/feed', out).catch(() => {});
  return out;
}

export default async (req, ctx) => {
  try {
    let feed = await getJSON('sec/feed');
    let mode = 'watcher';
    // 마지막 수집 후 90초가 지났으면 방문 시 가볍게 새로 수집 (10분마다 도는 수집기가 원문 보강 담당)
    // 저장된 피드를 바로 응답 (방문자 대기 없음). 90초 넘게 지났으면 응답 후 백그라운드에서 새로 수집
    if (!feed) { mode = 'live'; feed = await liveSec(); }
    else if (Date.now() - Date.parse(feed.updatedAt || 0) > 60e3 && refreshInBackground(ctx, 'sec', liveSec)) mode = 'refreshing';
    const items0 = feed.items.slice(0, 600).map((it) => {
      const { _excerpt, txTries, docTries, aiTries, ...x } = it;
      const rk = koHeadline(it);
      return rk ? { ...x, rk } : x;
    });
    const items = await attachPx0(items0);
    return json({ ok: true, source: 'SEC EDGAR', mode, updatedAt: feed.updatedAt, errors: feed.errors || [], count: items.length, items }, { cdnSeconds: 15, swr: 30 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), items: [] }, { cdnSeconds: 5, swr: 10, status: 502 });
  }
};

export const config = { path: '/api/sec' };

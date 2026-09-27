// /api/news — 뉴스·보도자료 (2분 넘게 지났으면 방문 시 새로 수집)
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { collectNews } from '../lib/news.mjs';
import { attachPx0 } from '../lib/px0.mjs';

export default async (req, ctx) => {
  try {
    let feed = await getJSON('news/feed');
    let mode = 'cache';
    if (!feed) { mode = 'live'; feed = await collectNews({ full: false }); }
    else if (Date.now() - Date.parse(feed.updatedAt || 0) > 60e3 && refreshInBackground(ctx, 'news', () => collectNews({ full: false }))) mode = 'refreshing';
    const items = await attachPx0((feed.items || []).filter((x) => x.src === 'PR' && !x.dupOf && !( (x.market === 'KR' || (x.source === '뉴스와이어' && !x.usOk && !x.ko)))).slice(0, 700).map(({ koTries, ...x }) => x));
    return json({ ok: true, mode, updatedAt: feed.updatedAt, errors: feed.errors || [], count: items.length, items }, { cdnSeconds: 45, swr: 90 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), items: [] }, { status: 502, cdnSeconds: 10 });
  }
};

export const config = { path: '/api/news' };

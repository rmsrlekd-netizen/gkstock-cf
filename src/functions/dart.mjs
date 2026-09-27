// /api/dart — 저장된 DART 피드 반환 (수집기가 아직 안 돌았으면 즉석 수집)
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { runDartWatch } from '../lib/dart-core.mjs';

export default async (req, ctx) => {
  try {
    let feed = await getJSON('dart/feed');
    let mode = 'watcher';
    if (!feed) { mode = 'live'; await runDartWatch({ docs: false, light: true }); feed = await getJSON('dart/feed'); }
    else if (Date.now() - Date.parse(feed.updatedAt || 0) > 90e3 && refreshInBackground(ctx, 'dart', () => runDartWatch({ docs: false, light: true }))) mode = 'refreshing';
    const items = (feed?.items || []).slice(0, 800).map(({ docTries, detailTries, ...x }) => x);
    return json({ ok: true, source: 'DART', mode, updatedAt: feed?.updatedAt, errors: feed?.errors || [], count: items.length, items }, { cdnSeconds: 15, swr: 30 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), items: [] }, { cdnSeconds: 5, swr: 10, status: 502 });
  }
};

export const config = { path: '/api/dart' };

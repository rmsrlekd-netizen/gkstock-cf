// /api/archive — 지난 공시·보도자료 (영구 보관소)
//  ?kind=FILING|PR|ALL &mk=KR|US|ALL &before=ms &ticker=… &q=검색어 &limit=100
//  &deep=1&corp=… → 이 종목의 과거 공시를 SEC·DART에서 한꺼번에 가져와 보관한 뒤 응답 (기업 페이지용)
import { json } from '../lib/util.mjs';
import { queryArchive, itemMs } from '../lib/archive.mjs';
import { companyHistory } from '../lib/backfill.mjs';
import { attachPx0 } from '../lib/px0.mjs';

export default async (req) => {
  const u = new URL(req.url);
  const p = (k) => u.searchParams.get(k) || '';
  const kind = ['FILING', 'PR'].includes(p('kind')) ? p('kind') : 'ALL';
  const mk = ['KR', 'US'].includes(p('mk')) ? p('mk') : 'ALL';
  const ticker = /^[A-Za-z0-9.\-]{1,12}$/.test(p('ticker')) ? p('ticker') : '';
  const q = p('q').slice(0, 40);
  const before = Number(p('before')) || 0;
  const limit = Math.min(200, Number(p('limit')) || 100);
  let hist = null;
  if (p('deep') === '1' && ticker && mk !== 'ALL') {
    hist = await Promise.race([companyHistory(mk, ticker, /^\d{8}$/.test(p('corp')) ? p('corp') : null), new Promise((r) => setTimeout(() => r({ timeout: true }), 12000))]).catch((e) => ({ error: e.message }));
  }
  try {
    const items = await attachPx0(await queryArchive({ kind, market: mk, before, ticker, q, limit }));
    const last = items.length ? itemMs(items[items.length - 1]) : null;
    return json({ ok: true, count: items.length, next: items.length === limit ? last : null, hist, items }, { cdnSeconds: before ? 600 : 60, swr: 600 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), items: [] }, { status: 502, cdnSeconds: 10 });
  }
};

export const config = { path: '/api/archive' };

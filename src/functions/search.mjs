// /api/search?q=삼성 | NVDA  → 한국·미국 상장사 검색 (기업분석 화면용)
import { json } from '../lib/util.mjs';
import { getKrNames, US_KO } from '../lib/krnames.mjs';
import { getTickerMap } from '../lib/sec-core.mjs';

let usList = null;
async function getUs() {
  if (usList) return usList;
  const map = await getTickerMap();
  usList = [...map.entries()].map(([cik, x]) => ({ t: String(x.ticker || '').toUpperCase(), n: x.name, e: x.exchange, cik })).filter((x) => x.t);
  return usList;
}

export default async (req) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!q) return json({ ok: true, items: [] }, { cdnSeconds: 3600 });
  const out = [];
  const ql = q.toLowerCase(), qu = q.toUpperCase();
  try {
    const kr = await getKrNames({ allowFetch: true });
    const hits = kr.filter((x) => x.n.toLowerCase().includes(ql) || x.c === q)
      .sort((a, b) => (a.n === q ? -1 : b.n === q ? 1 : 0) || (a.n.toLowerCase().startsWith(ql) ? -1 : 0) - (b.n.toLowerCase().startsWith(ql) ? -1 : 0) || a.n.length - b.n.length)
      .slice(0, 8);
    for (const x of hits) out.push({ market: 'KR', ticker: x.c, name: x.n, corpCode: x.k });
  } catch {}
  try {
    const ko = US_KO.filter(([n]) => n.includes(q)).map(([, t]) => t);
    const us = await getUs();
    const hits = us.filter((x) => x.t === qu || ko.includes(x.t) || (q.length >= 2 && (x.t.startsWith(qu) || x.n.toLowerCase().includes(ql))))
      .sort((a, b) => (a.t === qu || ko.includes(a.t) ? -1 : 0) - (b.t === qu || ko.includes(b.t) ? -1 : 0) || a.t.length - b.t.length)
      .slice(0, 8);
    for (const x of hits) out.push({ market: 'US', ticker: x.t, name: x.n, exchange: x.e, cik: x.cik });
  } catch {}
  return json({ ok: true, items: out }, { cdnSeconds: 3600, swr: 86400 });
};

export const config = { path: '/api/search' };

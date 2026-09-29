// /api/search?q=삼성 | NVDA  → 한국·미국 상장사 검색 (기업분석 화면용)
import { json } from '../lib/util.mjs';
import { getKrNames, US_KO } from '../lib/krnames.mjs';
import { getTickerMap } from '../lib/sec-core.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { naverUsQuotes, naverGet, reutersOf } from '../lib/naver.mjs';

// 미국 종목 한글 이름 (네이버 증권) — 한 번 받은 이름은 저장해 두고 재사용
let koMem = null;
async function koNames(list) {
  if (!koMem) koMem = (await getJSON('usko/names').catch(() => null)) || {};
  const need = list.filter((x) => !koMem[x.t]);
  if (need.length) {
    const rc = Object.fromEntries(need.map((x) => [x.t, reutersOf(x.t, x.e) || `${x.t}.O`]));
    const q = await naverUsQuotes([...new Set(Object.values(rc))]).catch(() => ({}));
    let add = 0;
    for (const x of need) { const n = q[rc[x.t]]?.nameKo; if (n && /[가-힣]/.test(n)) { koMem[x.t] = n; add++; } }
    if (add) await setJSON('usko/names', koMem).catch(() => {});
  }
  return koMem;
}
// 한글로 미국 종목 찾기 (예: 테슬라, 엔비디아) — 네이버 증권 자동완성
async function naverAcUs(q) {
  const j = await naverGet(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`, 5000);
  const arr = Array.isArray(j?.items) ? j.items.flat() : [];
  return arr.filter((x) => x && (x.nationCode === 'USA' || /\.(O|N|A|K)$/.test(String(x.reutersCode || ''))) && x.code && x.name)
    .map((x) => ({ t: String(x.code).toUpperCase(), ko: String(x.name) })).slice(0, 8);
}

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
    if (/[가-힣]/.test(q)) { try { for (const x of await naverAcUs(q)) if (!ko.includes(x.t)) ko.push(x.t); } catch {} }
    const us = await getUs();
    const hits = us.filter((x) => x.t === qu || ko.includes(x.t) || (q.length >= 2 && (x.t.startsWith(qu) || x.n.toLowerCase().includes(ql))))
      .sort((a, b) => (a.t === qu || ko.includes(a.t) ? -1 : 0) - (b.t === qu || ko.includes(b.t) ? -1 : 0) || a.t.length - b.t.length)
      .slice(0, 8);
    const kn = await koNames(hits).catch(() => ({}));
    for (const x of hits) out.push({ market: 'US', ticker: x.t, name: kn[x.t] || x.n, nameEn: x.n, exchange: x.e, cik: x.cik });
  } catch {}
  return json({ ok: true, items: out }, { cdnSeconds: 3600, swr: 86400 });
};

export const config = { path: '/api/search' };

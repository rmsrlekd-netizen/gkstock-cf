// /api/quote?list=US:NVDA,KR:005930  → 현재가·등락률 (최대 40종목, 네이버 실시간 시세 우선)
import { json, fetchWithTimeout, BROWSER_UA, num } from '../lib/util.mjs';
import { hasKis, kisGet } from '../lib/kis.mjs';
import { googleQuote } from '../lib/gfin.mjs';
import { naverKrQuotes, naverUsQuotes, reutersOf } from '../lib/naver.mjs';
import { getTickerMap } from '../lib/sec-core.mjs';

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
export async function us(t) {
  for (const cls of ['stocks', 'etf']) {
    try {
      const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${encodeURIComponent(t.replace('.', '/'))}/info?assetclass=${cls}`, { headers: NQ_H }, 5000);
      const data = (await r.json())?.data;
      // 장 마감 뒤에는 primaryData가 '시간외 거래(종가 대비)'라서 등락이 0%에 가깝게 나옴 → 정규장 종가(secondaryData)를 기본으로
      const p = data?.primaryData, s2 = data?.secondaryData;
      const ext = s2 && num(s2.lastSalePrice) !== null && !/^open/i.test(String(data?.marketStatus || ''));
      const d = ext ? s2 : p;
      if (d && num(d.lastSalePrice) !== null) return { price: num(d.lastSalePrice), chg: num(d.netChange), pct: num(d.percentageChange), cur: 'USD' };
    } catch {}
  }
  return null;
}
export async function kr(t) {
  if (hasKis()) {
    try {
      const o = (await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: t })).output || {};
      const sign = ['4', '5'].includes(String(o.prdy_vrss_sign)) ? -1 : 1;
      if (Number(o.stck_prpr)) return { price: Number(o.stck_prpr), chg: Math.abs(Number(o.prdy_vrss)) * sign, pct: Math.abs(Number(o.prdy_ctrt)) * sign, cur: 'KRW' };
    } catch {}
  }
  for (const ex of ['KRX', 'KOSDAQ']) {
    const q = await googleQuote(`${t}:${ex}`).catch(() => null);
    if (q && q.price) return { price: q.price, chg: q.chg, pct: q.pct, cur: 'KRW' };
  }
  return null;
}

// 같은 서버 안에서 30초간 재사용 (여러 방문자가 같은 종목을 볼 때 호출 절약)
const mem = new Map();
const fresh = (k) => { const v = mem.get(k); return v && Date.now() - v.at < 30e3 ? v.q : undefined; };

/** ['US:NVDA','KR:005930'] → { 'US:NVDA': {price, chg, pct, ...} } (네이버 일괄 조회 → 부족분은 대체 조회) */
export async function getQuotes(list) {
  const out = {};
  const needKr = [], needUs = [];
  for (const k of list) {
    const c = fresh(k);
    if (c !== undefined) { out[k] = c; continue; }
    (k.startsWith('KR:') ? needKr : needUs).push(k.slice(3));
  }
  if (needKr.length) {
    let q = {};
    try { q = await naverKrQuotes(needKr); } catch {}
    const miss = needKr.filter((t) => !q[t]);
    for (const t of needKr) if (q[t]) out['KR:' + t] = q[t];
    // 네이버에서 못 받은 종목만 대체 조회 (한국투자증권 호출 제한 때문에 최대 5개)
    await Promise.all(miss.slice(0, 5).map(async (t) => { out['KR:' + t] = await kr(t).catch(() => null); }));
  }
  if (needUs.length) {
    let map = null;
    try { map = await getTickerMap(); } catch {}
    const exOf = new Map();
    if (map) for (const v of map.values()) if (v.ticker) exOf.set(String(v.ticker).toUpperCase(), v.exchange);
    const rc = {};
    for (const t of needUs) { const r = reutersOf(t, exOf.get(t)); if (r) rc[t] = r; }
    let q = {};
    try { if (Object.keys(rc).length) q = await naverUsQuotes(Object.values(rc)); } catch {}
    const rest = needUs.filter((t) => !(rc[t] && q[rc[t]]?.price != null));
    for (const t of needUs) if (!rest.includes(t)) out['US:' + t] = q[rc[t]];
    await Promise.all(rest.slice(0, 12).map(async (t) => { out['US:' + t] = await us(t).catch(() => null); }));
  }
  for (const k of list) if (out[k] !== undefined) mem.set(k, { at: Date.now(), q: out[k] });
  return out;
}

export default async (req) => {
  const list = [...new Set((new URL(req.url).searchParams.get('list') || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^(US|KR):[A-Z0-9.\-]{1,10}$/.test(s)))].slice(0, 40);
  const out = await getQuotes(list);
  return json({ ok: true, quotes: out }, { cdnSeconds: 30, swr: 60 });
};

export const config = { path: '/api/quote' };

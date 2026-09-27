// /api/market — 공포·탐욕 지수, 코스피200 야간선물, 주요 지수
// 지수: 구글 파이낸스(주) → 나스닥(보조), 코스닥·야간선물: 한국투자증권 API
import { json, fetchWithTimeout, BROWSER_UA, num } from '../lib/util.mjs';
import { hasKis, kospiFutures, kisIndex } from '../lib/kis.mjs';
import { googleQuotes } from '../lib/gfin.mjs';

// [표시 이름, 구글 키, 나스닥 보조 심볼]
const LIST = [
  ['S&P 500', '.INX:INDEXSP'],
  ['나스닥', '.IXIC:INDEXNASDAQ', 'COMP'],
  ['다우', '.DJI:INDEXDJX'],
  ['나스닥100 선물', 'NQW00:CME_EMINIS'],
  ['반도체(SOX)', 'SOX:INDEXNASDAQ', 'SOX'],
  ['VIX', 'VIX:INDEXCBOE'],
  ['러셀 2000', 'RUT:INDEXRUSSELL'],
  ['코스피', 'KOSPI:KRX'],
  ['코스닥', 'KOSDAQ'],
  ['원/달러', 'USD-KRW'],
  ['미 10년물 금리', 'TNX:INDEXCBOE'],
  ['니케이225', 'NI225:INDEXNIKKEI'],
];
// 이 페이지들 안에 위 지수들이 함께 들어 있음
const PAGES = ['KOSPI:KRX', 'SOX:INDEXNASDAQ', 'NQW00:CME_EMINIS', 'TNX:INDEXCBOE', 'USD-KRW'];

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
async function nasdaqQuote(sym, cls) {
  const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${sym}/info?assetclass=${cls}`, { headers: NQ_H }, 6000);
  const d = (await r.json())?.data?.primaryData;
  if (!d) throw new Error('nasdaq ' + sym);
  const price = num(d.lastSalePrice), chg = num(d.netChange);
  return { price, chg, pct: num(d.percentageChange), prev: price !== null && chg !== null ? price - chg : null };
}

async function fearGreed() {
  const r = await fetchWithTimeout('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://edition.cnn.com/', Origin: 'https://edition.cnn.com' },
  }, 6000);
  if (!r.ok) throw new Error('CNN HTTP ' + r.status);
  const f = (await r.json()).fear_and_greed || {};
  const rnd = (v) => (v === null || v === undefined ? null : Math.round(v));
  return { score: rnd(f.score), rating: f.rating, time: f.timestamp, prevClose: rnd(f.previous_close), week: rnd(f.previous_1_week), month: rnd(f.previous_1_month), year: rnd(f.previous_1_year) };
}

async function nightFutures() {
  if (!hasKis()) return { ok: false, reason: 'KIS_APP_KEY 미설정' };
  try {
    return { ok: true, ...(await kospiFutures('night')) };
  } catch (e) {
    try {
      return { ok: true, ...(await kospiFutures('day')), note: '야간 시세 없음 → 주간 선물 표시' };
    } catch {
      return { ok: false, reason: e.message };
    }
  }
}

export default async () => {
  const [g, fg, night, kosdaq, kospi] = await Promise.all([
    googleQuotes(PAGES),
    fearGreed().catch((e) => ({ error: e.message })),
    nightFutures(),
    hasKis() ? kisIndex('1001').catch(() => null) : Promise.resolve(null),
    hasKis() ? kisIndex('0001').catch(() => null) : Promise.resolve(null), // 코스피: 한국투자증권 (거의 실시간)
  ]);
  const q = g.quotes;
  const indices = await Promise.all(LIST.map(async ([label, key, nq]) => {
    let v = q[key] || null;
    let src = v ? 'Google' : null;
    if (key === 'KOSDAQ' && kosdaq) { v = kosdaq; src = 'KIS'; }
    if (key === 'KOSPI:KRX' && kospi) { v = kospi; src = 'KIS'; }
    if (!v && nq) { try { v = await nasdaqQuote(nq, 'index'); src = 'Nasdaq'; } catch {} }
    if (!v || v.price === null) return { label, key, error: true };
    const out = { label, key, price: v.price, chg: v.chg, pct: v.pct, prev: v.prev, src };
    if (key === 'TNX:INDEXCBOE' && v.price > 20) { out.price /= 10; out.chg /= 10; out.prev = out.prev !== null ? out.prev / 10 : null; out.unit = '%'; }
    return out;
  }));
  const ok = indices.some((x) => !x.error);
  return json({ ok: true, fetchedAt: new Date().toISOString(), errors: g.errors, fearGreed: fg, night, indices }, { cdnSeconds: ok ? 60 : 15, swr: 120 });
};

export const config = { path: '/api/market' };

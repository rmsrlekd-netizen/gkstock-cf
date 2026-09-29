// /api/market — 공포·탐욕 지수, 코스피200 야간선물, 주요 지수
// 지수: 구글 파이낸스(주) → 나스닥(보조), 코스닥·야간선물: 한국투자증권 API
import { json, fetchWithTimeout, BROWSER_UA, num, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
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
  ['비트코인', 'BTC-USD', null, 'BTC-USD'],
  ['금 선물', 'GCW00:COMEX', null, 'GC=F'],
];
// 이 페이지들 안에 위 지수들이 함께 들어 있음
const PAGES = ['KOSPI:KRX', 'SOX:INDEXNASDAQ', 'NQW00:CME_EMINIS', 'TNX:INDEXCBOE', 'USD-KRW', 'BTC-USD', 'GCW00:COMEX'];

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
async function nasdaqQuote(sym, cls) {
  const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${sym}/info?assetclass=${cls}`, { headers: NQ_H }, 6000);
  const d = (await r.json())?.data?.primaryData;
  if (!d) throw new Error('nasdaq ' + sym);
  const price = num(d.lastSalePrice), chg = num(d.netChange);
  return { price, chg, pct: num(d.percentageChange), prev: price !== null && chg !== null ? price - chg : null };
}

// 야후 파이낸스 시세 (구글에서 못 받은 비트코인·금 보조)
async function yahooQuote(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const opt = { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } };
  let r = await fetchWithTimeout('https://query1.finance.yahoo.com' + path, opt, 6000).catch(() => null);
  if (!r?.ok && process.env.KR_RELAY_URL) r = await fetchWithTimeout('https://query1.finance.yahoo.com' + path, { ...opt, relay: true }, 8000).catch(() => null);
  if (!r?.ok) throw new Error('yahoo ' + sym);
  const res = (await r.json())?.chart?.result?.[0];
  const price = res?.meta?.regularMarketPrice;
  const cl = (res?.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  const prev = cl.length >= 2 ? cl[cl.length - 2] : res?.meta?.chartPreviousClose;
  if (price == null || prev == null) throw new Error('yahoo ' + sym);
  return { price, chg: price - prev, pct: Math.round(((price - prev) / prev) * 10000) / 100, prev };
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

// 야간선물 작은 차트용: 5분마다 시세를 모아 둠 (차트 API 대신 직접 기록, 최근 30시간)
export async function sampleNight(n) {
  if (!n) n = await nightFutures();
  if (!n?.ok || n.price == null) return false;
  const s = (await getJSON('night/series')) || { pts: [] };
  const now = Date.now(), last = s.pts[s.pts.length - 1];
  if (last && now - last[0] < Number(process.env.NIGHT_SAMPLE_MS || 4.5 * 60e3)) return false;
  s.pts.push([now, n.price, n.session === 'night' ? 'N' : 'D']);
  s.pts = s.pts.filter((p) => now - p[0] < 30 * 3600e3);
  await setJSON('night/series', s).catch(() => {});
  return true;
}

async function build() {
  const [g, fg, night, kosdaq, kospi] = await Promise.all([
    googleQuotes(PAGES),
    fearGreed().catch((e) => ({ error: e.message })),
    nightFutures(),
    hasKis() ? kisIndex('1001').catch(() => null) : Promise.resolve(null),
    hasKis() ? kisIndex('0001').catch(() => null) : Promise.resolve(null), // 코스피: 한국투자증권 (거의 실시간)
  ]);
  const q = g.quotes;
  const indices = await Promise.all(LIST.map(async ([label, key, nq, yh]) => {
    let v = q[key] || null;
    let src = v ? 'Google' : null;
    if (key === 'KOSDAQ' && kosdaq) { v = kosdaq; src = 'KIS'; }
    if (key === 'KOSPI:KRX' && kospi) { v = kospi; src = 'KIS'; }
    if (!v && nq) { try { v = await nasdaqQuote(nq, 'index'); src = 'Nasdaq'; } catch {} }
    if ((!v || v.price == null) && yh) { try { v = await yahooQuote(yh); src = 'Yahoo'; } catch {} }
    if (!v || v.price === null) return { label, key, error: true };
    const out = { label, key, price: v.price, chg: v.chg, pct: v.pct, prev: v.prev, src };
    if (key === 'TNX:INDEXCBOE' && v.price > 20) { out.price /= 10; out.chg /= 10; out.prev = out.prev !== null ? out.prev / 10 : null; out.unit = '%'; }
    return out;
  }));
  const ok = indices.some((x) => !x.error);
  //  야간선물 차트: 지금 세션(야간/주간)의 5분 간격 기록
  if (night?.ok) {
    await sampleNight(night).catch(() => {});
    const ser = (await getJSON('night/series').catch(() => null))?.pts || [];
    const tag = night.session === 'night' ? 'N' : 'D';
    const pts = [];
    for (let i = ser.length - 1; i >= 0; i--) { const p = ser[i]; if (p[2] !== tag || (pts.length && pts[0][0] - p[0] > 2 * 3600e3)) break; pts.unshift(p); }
    if (pts.length >= 3) night.series = pts.map((p) => [Math.round(p[0] / 1000), p[1]]);
  }
  const body = { ok: true, fetchedAt: new Date().toISOString(), errors: g.errors, fearGreed: fg, night, indices };
  if (ok) await setJSON('market/v1', { at: Date.now(), body }).catch(() => {});
  return body;
}

// 저장된 값을 바로 응답(대기 없음) → 40초 넘게 지났으면 뒤에서 새로 받아옴
export default async (req, ctx) => {
  const c = await getJSON('market/v1');
  if (c) {
    if (Date.now() - c.at > 40e3) refreshInBackground(ctx, 'market', build);
    return json(c.body, { cdnSeconds: 30, swr: 60 });
  }
  const body = await build();
  return json(body, { cdnSeconds: 30, swr: 60 });
};

export const config = { path: '/api/market' };

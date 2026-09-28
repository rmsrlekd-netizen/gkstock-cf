// 네이버 증권(Npay 증권) 공개 API — 실시간 인기 종목·현재가 (서울 중계 서버를 거쳐 호출)
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

const H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };
// 등락 부호: 4 하한, 5 하락
const signed = (v, code) => (v === null ? null : ['4', '5'].includes(String(code)) ? -Math.abs(v) : Math.abs(v));

async function get(url, ms = 8000) {
  const r = await fetchWithTimeout(url, { headers: H }, ms);
  if (!r.ok) throw new Error(`네이버 HTTP ${r.status}`);
  return r.json();
}

function parseQuote(x) {
  const code = x.compareToPreviousPrice?.code;
  return {
    price: n0(x.closePriceRaw ?? x.closePrice),
    chg: signed(n0(x.compareToPreviousClosePriceRaw ?? x.compareToPreviousClosePrice), code),
    pct: signed(n0(x.fluctuationsRatio), code),
    nameKo: x.stockName || null,
    status: x.marketStatus || null,
    ext: extOf(x),
  };
}
// 미국 프리마켓·애프터마켓 시세 (최근 16시간 안에 거래된 것만)
function extOf(x) {
  const o = x.overMarketPriceInfo;
  if (!o || o.fluctuationsRatio == null || !o.localTradedAt) return undefined;
  if (Date.now() - Date.parse(o.localTradedAt) > 16 * 3600e3) return undefined;
  const code = o.compareToPreviousPrice?.code;
  return { session: o.tradingSessionType === 'AFTER_MARKET' ? 'AFTER' : 'PRE', price: n0(o.overPriceRaw ?? o.overPrice), pct: signed(n0(o.fluctuationsRatioRaw ?? o.fluctuationsRatio), code), open: o.overMarketStatus === 'OPEN', at: o.localTradedAt };
}

/** 미국 프리마켓·애프터마켓 상승·하락 상위
 *  네이버에는 시간외 순위가 없어서: 시가총액 상위 1,500개 + 전일 상승·하락 상위 200개의 시간외 등락률로 직접 순위를 매김 */
export async function naverUsExtMovers(n = 10) {
  const urls = [
    ...Array.from({ length: 15 }, (_, i) => `https://api.stock.naver.com/stock/nation/USA/marketValue?page=${i + 1}&pageSize=100`),
    'https://api.stock.naver.com/stock/nation/USA/up?page=1&pageSize=100',
    'https://api.stock.naver.com/stock/nation/USA/down?page=1&pageSize=100',
  ];
  const pages = await Promise.all(urls.map((u) => get(u, 9000).catch(() => null)));
  if (pages.filter(Boolean).length < 6) throw new Error('네이버 시간외 데이터 부족');
  const seen = new Map();
  for (const j of pages) for (const x of j?.stocks || []) {
    if (!x.symbolCode || x.stockEndType !== 'stock' || seen.has(x.reutersCode)) continue;
    const e = extOf(x);
    if (!e || e.pct == null || e.price == null) continue;
    const q = parseQuote(x);
    seen.set(x.reutersCode, { market: 'US', ticker: x.symbolCode, reuters: x.reutersCode, name: x.stockName || x.symbolCode, price: e.price, pct: e.pct, regPrice: q.price, regPct: q.pct, session: e.session, cur: 'USD', mcapText: x.marketValueHangeul || null, status: e.session });
  }
  const all = [...seen.values()];
  if (all.length < 20) throw new Error('시간외 거래 종목 부족');
  return {
    up: all.filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, n),
    down: all.filter((x) => x.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, n),
    session: all.filter((x) => x.session === 'AFTER').length > all.length / 2 ? 'AFTER' : 'PRE',
    count: all.length,
  };
}

/** 국내 검색 상위 (네이버 증권 "검색 많은 종목") */
export async function naverKrTop(n = 10) {
  const j = await get('https://m.stock.naver.com/api/stocks/searchTop/all?page=1&pageSize=20');
  const list = (j.stocks || []).filter((x) => x.stockType === 'domestic' && x.itemCode);
  if (!list.length) throw new Error('네이버 검색 상위 데이터 없음');
  return list.slice(0, n).map((x) => ({ market: 'KR', ticker: x.itemCode, name: x.stockName, ...parseQuote(x), cur: 'KRW', mcapText: x.marketValueHangeul || null, valueText: x.accumulatedTradingValueKrwHangeul || null }));
}

/** 국내 상승·하락 상위 (코스피+코스닥 전체 주식, ETF·ETN만 제외) */
export async function naverKrMovers(dir, n = 10) {
  const j = await get(`https://m.stock.naver.com/api/stocks/${dir === 'down' ? 'down' : 'up'}/all?page=1&pageSize=40`);
  const list = (j.stocks || []).filter((x) => x.itemCode && x.stockEndType === 'stock');
  if (!list.length) throw new Error('네이버 국내 등락 데이터 없음');
  return list.slice(0, n).map((x) => ({ market: 'KR', ticker: x.itemCode, name: x.stockName, ...parseQuote(x), cur: 'KRW', mcapText: x.marketValueHangeul || null, valueText: x.accumulatedTradingValueKrwHangeul || null }));
}

/** 미국 상승·하락 상위 (나스닥·뉴욕·아멕스 전체 주식, 동전주 포함) */
export async function naverUsMovers(dir, n = 10) {
  const j = await get(`https://api.stock.naver.com/stock/nation/USA/${dir === 'down' ? 'down' : 'up'}?page=1&pageSize=30`);
  const list = (j.stocks || []).filter((x) => x.symbolCode && x.stockEndType === 'stock');
  if (!list.length) throw new Error('네이버 미국 등락 데이터 없음');
  return list.slice(0, n).map((x) => ({ market: 'US', ticker: x.symbolCode, reuters: x.reutersCode, ...parseQuote(x), name: x.stockName || x.symbolCode, cur: 'USD', mcapText: x.marketValueHangeul || null }));
}

/** 해외 인기 종목 (네이버 증권 사용자 조회 상위, 최근 1시간) */
export async function naverUsTop(n = 10) {
  const j = await get('https://stock.naver.com/api/domestic/market/searchTop');
  const codes = (Array.isArray(j) ? j : []).filter((x) => x.nationType === 'USA' && x.reutersCode).map((x) => x.reutersCode);
  if (!codes.length) throw new Error('네이버 해외 인기 데이터 없음');
  const q = await naverUsQuotes(codes.slice(0, n));
  return codes.slice(0, n).map((rc) => ({ market: 'US', ticker: rc.split('.')[0], reuters: rc, ...(q[rc] || {}), name: q[rc]?.nameKo || rc.split('.')[0], cur: 'USD' }));
}

/** 국내 현재가 여러 종목 한 번에 */
export async function naverKrQuotes(codes) {
  if (!codes.length) return {};
  const j = await get(`https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(',')}`, 7000);
  const out = {};
  for (const x of j.datas || []) if (x.itemCode) out[x.itemCode] = { ...parseQuote(x), cur: 'KRW' };
  return out;
}

/** 미국 현재가 여러 종목 한 번에 (로이터 코드: NVDA.O 나스닥, IBM.N 뉴욕 …) */
export async function naverUsQuotes(reuters) {
  if (!reuters.length) return {};
  const j = await get(`https://polling.finance.naver.com/api/realtime/worldstock/stock/${reuters.join(',')}`, 7000);
  const out = {};
  for (const x of j.datas || []) if (x.reutersCode) out[x.reutersCode] = { ...parseQuote(x), cur: 'USD', symbol: x.symbolCode || null };
  return out;
}

/** 거래소 이름 → 로이터 코드 접미사 */
export function reutersOf(ticker, exchange) {
  const e = String(exchange || '').toUpperCase();
  const t = String(ticker).toUpperCase().replace('-', '.');
  if (e.includes('NASDAQ')) return `${t}.O`;
  if (e.includes('NYSE') && (e.includes('AMERICAN') || e.includes('MKT'))) return `${t}.A`;
  if (e.includes('ARCA')) return `${t}.K`;
  if (e.includes('NYSE')) return `${t}.N`;
  return null;
}

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
  };
}

/** 국내 검색 상위 (네이버 증권 "검색 많은 종목") */
export async function naverKrTop(n = 10) {
  const j = await get('https://m.stock.naver.com/api/stocks/searchTop/all?page=1&pageSize=20');
  const list = (j.stocks || []).filter((x) => x.stockType === 'domestic' && x.itemCode);
  if (!list.length) throw new Error('네이버 검색 상위 데이터 없음');
  return list.slice(0, n).map((x) => ({ market: 'KR', ticker: x.itemCode, name: x.stockName, ...parseQuote(x), cur: 'KRW', mcapText: x.marketValueHangeul || null, valueText: x.accumulatedTradingValueKrwHangeul || null }));
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

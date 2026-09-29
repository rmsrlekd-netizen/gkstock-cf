// 네이버 증권(Npay 증권) 공개 API — 실시간 인기 종목·현재가 (서울 중계 서버를 거쳐 호출)
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

const H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
// 미국 정규 거래소(나스닥·뉴욕·아멕스)만 — 장외(OTC) 종목 제외
const US_EXCH = (x) => { const c = String(x?.stockExchangeType?.code || x?.stockExchangeType?.name || '').toUpperCase(); return !c || /^(NSQ|NYS|AMX|NASDAQ|NYSE|AMEX)$/.test(c); };
const isOtc = (x) => /OTC|PNK|PINK/i.test(String(x?.stockExchangeType?.code || '') + ' ' + String(x?.stockExchangeType?.name || '') + ' ' + String(x?.reutersCode || '').replace(/^[^.]*/, ''));
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
  const q = parseQuoteBase(x, code);
  // 미국 정규장이 닫혀 있고 프리·애프터 거래가 더 최근이면 '지금 가격'은 시간외 가격
  const e = q.ext;
  // (국내는 넥스트레이드 프리마켓 08:00~08:50 · 애프터마켓 15:30~20:00, 시간외 거래가 열려 있으면 그 가격)
  //  국내 넥스트레이드 애프터마켓(15:30~20:00)은 네이버가 장 상태를 'OPEN'으로 줘서 따로 확인
  if (e && e.price != null && e.pct != null && (q.status !== 'OPEN' || (e.open && e.session === 'AFTER')) && (e.open || Date.parse(e.at) > (Date.parse(x.localTradedAt || '') || 0))) { q.live = e.price; q.livePct = e.pct; q.session = e.session; }
  return q;
}
function parseQuoteBase(x, code) {
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
    if (!x.symbolCode || x.stockEndType !== 'stock' || seen.has(x.reutersCode) || !US_EXCH(x) || isOtc(x)) continue;
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

/** 국내 넥스트레이드(NXT) 프리·애프터마켓 상승·하락 상위
 *  네이버에 시간외 순위가 없어서: 코스피·코스닥 시가총액 상위 + 검색 상위 + 전일 급등락 종목의 시간외 등락률로 직접 순위를 매김 (NXT 거래 종목은 대부분 여기 포함) */
export async function naverKrExtMovers(n = 10) {
  const B = 'https://m.stock.naver.com/api/stocks';
  const urls = [
    ...[1, 2, 3, 4, 5].map((i) => `${B}/marketValue/KOSPI?page=${i}&pageSize=100`),
    ...[1, 2, 3, 4].map((i) => `${B}/marketValue/KOSDAQ?page=${i}&pageSize=100`),
    `${B}/up/all?page=1&pageSize=100`, `${B}/down/all?page=1&pageSize=100`, `${B}/searchTop/all?page=1&pageSize=50`,
  ];
  const pages = await Promise.all(urls.map((u) => get(u, 9000).catch(() => null)));
  const seen = new Map();
  for (const j of pages) for (const x of j?.stocks || []) {
    if (!x.itemCode || seen.has(x.itemCode) || (x.stockEndType && x.stockEndType !== 'stock')) continue;
    const e = extOf(x);
    if (!e || e.pct == null || e.price == null) continue;
    const q = parseQuote(x);
    seen.set(x.itemCode, { market: 'KR', ticker: x.itemCode, name: x.stockName, price: e.price, pct: e.pct, regPrice: q.price, regPct: q.pct, session: e.session, status: q.status, cur: 'KRW', mcapText: x.marketValueHangeul || null, valueText: x.accumulatedTradingValueKrwHangeul || null });
  }
  const all = [...seen.values()];
  if (all.length < 20) throw new Error(`국내 시간외 거래 종목 부족 (${all.length}개, 응답 ${pages.filter(Boolean).length}/${urls.length})`);
  return {
    up: all.filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, n),
    down: all.filter((x) => x.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, n),
    count: all.length,
  };
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
  const list = (j.stocks || []).filter((x) => x.symbolCode && x.stockEndType === 'stock' && US_EXCH(x) && !isOtc(x));
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
  const fetchSet = async (codes) => {
    const j = await get(`https://polling.finance.naver.com/api/realtime/worldstock/stock/${codes.join(',')}`, 7000);
    return (j.datas || []).filter((x) => x.reutersCode);
  };
  const tk = (rc) => String(rc).split('.')[0].toUpperCase();
  const out = {};
  const take = (list, want) => {
    for (const rc of want) {
      if (out[rc]) continue;
      const x = list.find((d) => d.reutersCode === rc) || list.find((d) => String(d.symbolCode || tk(d.reutersCode)).toUpperCase() === tk(rc));
      if (x) out[rc] = { ...parseQuote(x), cur: 'USD', symbol: x.symbolCode || null };
    }
  };
  let firstErr = null;
  try { take(await fetchSet(reuters), reuters); } catch (e) { firstErr = e; }
  // 거래소 접미사가 네이버와 다르면(뉴욕증시 종목 등) 못 받아옴 → 다른 접미사로 한 번 더
  const miss = reuters.filter((rc) => !out[rc]);
  if (miss.length) {
    const alt = new Map();
    for (const rc of miss.slice(0, 30)) for (const c of [tk(rc), tk(rc) + '.N', tk(rc) + '.K', tk(rc) + '.A', tk(rc) + '.O']) if (c !== rc) alt.set(c, rc);
    try {
      const ks = [...alt.keys()], parts = [];
      for (let i = 0; i < ks.length; i += 40) parts.push(ks.slice(i, i + 40));
      const list = (await Promise.all(parts.map((c) => fetchSet(c).catch(() => [])))).flat();
      for (const rc of miss) {
        const x = list.find((d) => alt.get(d.reutersCode) === rc) || list.find((d) => String(d.symbolCode || '').toUpperCase() === tk(rc));
        if (x) out[rc] = { ...parseQuote(x), cur: 'USD', symbol: x.symbolCode || null, reuters: x.reutersCode };
      }
    } catch {}
  }
  if (firstErr && !Object.keys(out).length) throw firstErr;
  return out;
}

/** 거래소 이름 → 로이터 코드 접미사 */
export function reutersOf(ticker, exchange) {
  const e = String(exchange || '').toUpperCase();
  const t = String(ticker).toUpperCase().replace('-', '.');
  if (e.includes('NASDAQ')) return `${t}.O`;
  if (e.includes('NYSE') && (e.includes('AMERICAN') || e.includes('MKT'))) return `${t}.A`;
  if (e.includes('ARCA')) return `${t}.K`;
  if (e === 'AMEX') return `${t}.A`;
  if (e.includes('NYSE')) return `${t}.N`;
  return null;
}

/** 미국 시간외 상승·하락 상위 — 트레이딩뷰 전체 종목 스캐너 (미국 상장 주식 전부, 동전주 포함)
 *  이름은 네이버 한글명으로 바꾸고, 등락률은 네이버 시간외 시세가 있으면 그걸로 맞춤 */
export async function tvUsExtMovers(session, n = 10) {
  const pre = session !== 'AFTER';
  const chg = pre ? 'premarket_change' : 'postmarket_change', px = pre ? 'premarket_close' : 'postmarket_close', vol = pre ? 'premarket_volume' : 'postmarket_volume';
  const scan = async (order) => {
    const body = JSON.stringify({ columns: ['name', 'description', chg, px, 'close', 'change', 'market_cap_basic', vol, 'exchange'], filter: [{ left: 'type', operation: 'equal', right: 'stock' }, { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] }, { left: vol, operation: 'greater', right: 5000 }, { left: chg, operation: order === 'desc' ? 'greater' : 'less', right: 0 }], sort: { sortBy: chg, sortOrder: order }, range: [0, n + 5] });
    const opt = { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }, body };
    let r = await fetchWithTimeout('https://scanner.tradingview.com/america/scan', opt, 8000).catch(() => null);
    if (!r?.ok && process.env.KR_RELAY_URL) r = await fetchWithTimeout('https://scanner.tradingview.com/america/scan', { ...opt, relay: true }, 9000);
    if (!r?.ok) throw new Error('트레이딩뷰 HTTP ' + (r?.status || '오류'));
    const j = await r.json();
    return (j.data || []).map((x) => { const [t, desc, c, p, close, regChg, cap, v, ex] = x.d; return { ticker: String(t).replace('/', '.'), name: desc, pct: Math.round(c * 100) / 100, price: p, regPrice: close, regPct: regChg != null ? Math.round(regChg * 100) / 100 : null, cap, vol: v, ex }; })
      .filter((x) => /^[A-Z][A-Z.]{0,5}$/.test(x.ticker) && x.pct != null && x.price != null && /^(NASDAQ|NYSE|AMEX)$/i.test(String(x.ex || ''))); // 장외(OTC) 제외
  };
  const [up, down] = await Promise.all([scan('desc'), scan('asc')]);
  if (!up.length && !down.length) throw new Error('트레이딩뷰 시간외 데이터 없음');
  // 한글 이름·네이버 시간외 시세
  const all = [...up, ...down];
  const rc = Object.fromEntries(all.map((x) => [x.ticker, reutersOf(x.ticker, x.ex)]).filter((a) => a[1]));
  let q = {};
  try { q = await naverUsQuotes([...new Set(Object.values(rc))]); } catch {}
  const fmt = (x) => {
    const nq = q[rc[x.ticker]];
    const e = nq?.ext && nq.ext.session === (pre ? 'PRE' : 'AFTER') ? nq.ext : null;
    const capU = x.cap ? x.cap / 1e8 : null;
    return { market: 'US', ticker: x.ticker, reuters: rc[x.ticker] || null, name: nq?.nameKo || x.name, price: e?.price ?? x.price, pct: e?.pct ?? x.pct, regPrice: x.regPrice, regPct: nq?.pct ?? x.regPct, session: pre ? 'PRE' : 'AFTER', cur: 'USD', mcapText: capU != null ? `${capU >= 10 ? Math.round(capU).toLocaleString('en-US') : capU.toFixed(2)}억 USD` : null, status: pre ? 'PRE' : 'AFTER' };
  };
  return { up: up.slice(0, n).map(fmt).sort((a, b) => b.pct - a.pct), down: down.slice(0, n).map(fmt).sort((a, b) => a.pct - b.pct), session: pre ? 'PRE' : 'AFTER', src: 'tv' };
}

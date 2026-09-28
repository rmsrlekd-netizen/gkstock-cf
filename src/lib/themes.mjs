// 오늘의 주도 테마·섹터
//  한국: 네이버 증권 테마·업종 등락률 (전체 목록 → 상위·하위) + 테마별 대장주
//  미국: 섹터 ETF 11개 + 테마 ETF (Nasdaq 시세) + 테마별 대표 종목 (네이버 시세)
import { fetchWithTimeout, BROWSER_UA, num } from './util.mjs';

const NH = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
async function nget(url, ms = 8000) {
  const r = await fetchWithTimeout(url, { headers: NH }, ms);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  return r.json();
}
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };
const sgn = (v, code) => (v == null ? null : ['4', '5'].includes(String(code)) ? -Math.abs(v) : Math.abs(v));

function stockOf(x) {
  return { t: x.itemCode, name: x.stockName, price: n0(x.closePriceRaw ?? x.closePrice), pct: sgn(n0(x.fluctuationsRatio), x.compareToPreviousPrice?.code), limit: x.compareToPreviousPrice?.code === '1' ? 'up' : x.compareToPreviousPrice?.code === '4' ? 'down' : null, value: x.accumulatedTradingValueKrwHangeul || null };
}

/** 테마(theme) 또는 업종(industry) 소속 종목 (등락률 순) */
export async function krGroupStocks(kind, no, n = 30) {
  const j = await nget(`https://m.stock.naver.com/api/stocks/${kind === 'industry' ? 'industry' : 'theme'}/${Number(no)}?page=1&pageSize=${n}`);
  return (j.stocks || []).filter((x) => x.itemCode).map(stockOf);
}

async function krGroups(kind) {
  // 한 번에 최대 100개까지만 줌 → 전체(테마 약 260개)를 쪽 나눠서
  const first = await nget(`https://m.stock.naver.com/api/stocks/${kind}?page=1&pageSize=100`);
  const pages = Math.min(5, Math.ceil((first.totalCount || 0) / 100));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => nget(`https://m.stock.naver.com/api/stocks/${kind}?page=${i + 2}&pageSize=100`).catch(() => ({ groups: [] }))));
  const groups = [first, ...rest].flatMap((j) => j.groups || []);
  return groups.map((g) => ({ no: g.no, name: g.name, rate: n0(g.changeRate), rise: g.riseCount || 0, fall: g.fallCount || 0, flat: g.steadyCount || 0, total: g.totalCount || 0 })).filter((g) => g.rate != null && g.total > 0);
}

export async function krThemes() {
  const [themes, inds] = await Promise.all([krGroups('theme'), krGroups('industry')]);
  themes.sort((a, b) => b.rate - a.rate);
  inds.sort((a, b) => b.rate - a.rate);
  const topT = themes.slice(0, 15), worstT = themes.slice(-6).reverse();
  const topI = inds.slice(0, 10), worstI = inds.slice(-5).reverse();
  // 대장주 (상위 테마 12개·업종 8개·하위 테마 4개만)
  const withLeaders = async (list, kind, k) => Promise.all(list.map(async (g, i) => (i < k ? { ...g, leaders: (await krGroupStocks(kind, g.no, 5).catch(() => [])).slice(0, 4) } : g)));
  const [t1, t2, i1, i2] = await Promise.all([withLeaders(topT, 'theme', 12), withLeaders(worstT, 'theme', 4), withLeaders(topI, 'industry', 8), withLeaders(worstI, 'industry', 3)]);
  return { themes: t1, worstThemes: t2, industries: i1, worstIndustries: i2, themeCount: themes.length, industryCount: inds.length };
}

// 미국 섹터 ETF (S&P 500 11개 섹터)
export const US_SECTORS = [
  ['XLK', '기술'], ['XLC', '커뮤니케이션'], ['XLY', '임의소비재'], ['XLF', '금융'], ['XLV', '헬스케어'], ['XLI', '산업재'],
  ['XLE', '에너지'], ['XLB', '소재'], ['XLP', '필수소비재'], ['XLU', '유틸리티'], ['XLRE', '부동산'],
];
// 테마 ETF + 대표 종목
export const US_THEMES = [
  ['SOXX', '반도체', ['NVDA', 'AVGO', 'AMD', 'MU', 'TSM']],
  ['BOTZ', 'AI·로봇', ['NVDA', 'PLTR', 'ISRG', 'TSLA', 'SYM']],
  ['IGV', '소프트웨어', ['MSFT', 'ORCL', 'CRM', 'NOW', 'PLTR']],
  ['SKYY', '클라우드', ['AMZN', 'MSFT', 'GOOGL', 'SNOW', 'NET']],
  ['CIBR', '사이버보안', ['CRWD', 'PANW', 'FTNT', 'ZS', 'NET']],
  ['QTUM', '양자컴퓨터', ['IONQ', 'RGTI', 'QBTS', 'IBM', 'HON']],
  ['URA', '우라늄·원전', ['CCJ', 'OKLO', 'SMR', 'LEU', 'NNE']],
  ['GRID', '전력망·인프라', ['ETN', 'VRT', 'GEV', 'PWR', 'HUBB']],
  ['ICLN', '클린에너지', ['FSLR', 'ENPH', 'NEE', 'RUN', 'PLUG']],
  ['ITA', '방산·항공우주', ['LMT', 'RTX', 'NOC', 'GD', 'BA']],
  ['UFO', '우주항공', ['RKLB', 'ASTS', 'LUNR', 'PL', 'IRDM']],
  ['XBI', '바이오', ['VRTX', 'REGN', 'ALNY', 'MRNA', 'INSM']],
  ['IBIT', '비트코인·가상자산', ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT']],
  ['KRE', '지방은행', ['NYCB', 'ZION', 'KEY', 'CFG', 'HBAN']],
  ['GDX', '금광', ['NEM', 'AEM', 'GOLD', 'KGC', 'FNV']],
  ['LIT', '리튬·2차전지', ['ALB', 'SQM', 'TSLA', 'ENVX', 'QS']],
  ['XHB', '주택건설', ['DHI', 'LEN', 'PHM', 'NVR', 'TOL']],
  ['JETS', '항공', ['DAL', 'UAL', 'AAL', 'LUV', 'ALK']],
  ['XOP', '석유·가스 탐사', ['XOM', 'CVX', 'COP', 'OXY', 'EOG']],
  ['KWEB', '중국 인터넷', ['BABA', 'PDD', 'JD', 'BIDU', 'TCEHY']],
  ['ARKK', '혁신성장', ['TSLA', 'ROKU', 'COIN', 'CRSP', 'SHOP']],
];

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
/** Nasdaq 관심목록 API로 ETF 시세 한 번에 */
export async function etfQuotes(symbols) {
  const qs = symbols.map((s) => 'symbol=' + encodeURIComponent(s.toLowerCase() + '|etf')).join('&');
  const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/watchlist?${qs}`, { headers: NQ_H }, 9000);
  if (!r.ok) throw new Error('Nasdaq HTTP ' + r.status);
  const j = await r.json();
  const out = {};
  for (const x of j?.data || []) if (x?.symbol) out[String(x.symbol).toUpperCase()] = { price: num(String(x.lastSalePrice || '').replace('$', '')), pct: num(String(x.percentageChange || '').replace('%', '')) };
  return out;
}

export async function usThemes(getQuotes) {
  const etfs = [...US_SECTORS.map((x) => x[0]), ...US_THEMES.map((x) => x[0])];
  // ETF 등락률도 네이버 실시간 시세(정규장 하루 등락) 우선 — Nasdaq 관심목록은 장 마감 뒤 '시간외 등락'이 섞여 나옴
  const nq = await getQuotes(etfs.map((t) => 'US:' + t)).catch(() => ({}));
  const q = {};
  for (const t of etfs) { const v = nq['US:' + t]; if (v?.price != null && v.pct != null) q[t] = { price: v.price, pct: v.pct }; }
  const missE = etfs.filter((t) => !q[t]);
  if (missE.length) Object.assign(q, Object.fromEntries(Object.entries(await etfQuotes(missE).catch(() => ({}))).filter(([t]) => missE.includes(t))));
  const stocks = [...new Set(US_THEMES.flatMap((x) => x[2]))];
  const sq = await getQuotes(stocks.map((t) => 'US:' + t)).catch(() => ({}));
  const sectors = US_SECTORS.map(([t, name]) => ({ t, name, ...(q[t] || {}) })).filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  const themes = US_THEMES.map(([t, name, list]) => ({ t, name, ...(q[t] || {}), stocks: list.map((s) => ({ t: s, ...(sq['US:' + s] || {}) })).filter((s) => s.price != null).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99)) }))
    .filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  return { sectors, themes };
}

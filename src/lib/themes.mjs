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

// ───── 미국 테마·섹터 구성 종목 (국장 네이버 테마처럼 '소속 종목 평균 등락률 · 상승/하락 비율 · 대장주'로 보여주기 위함) ─────
//  [이름, 대표 ETF(없으면 null), 소속 종목]
export const US_GROUPS = [
  ['반도체', 'SOXX', ['NVDA', 'AVGO', 'AMD', 'MU', 'TSM', 'QCOM', 'ARM', 'MRVL', 'INTC', 'LRCX', 'AMAT', 'KLAC', 'TXN', 'ADI', 'ON']],
  ['AI 인프라·데이터센터', null, ['NVDA', 'AVGO', 'VRT', 'ANET', 'SMCI', 'DELL', 'CRDO', 'CIEN', 'COHR', 'ALAB']],
  ['AI 소프트웨어', 'IGV', ['PLTR', 'MSFT', 'NOW', 'CRM', 'SNOW', 'AI', 'PATH', 'DDOG', 'MDB', 'ORCL']],
  ['빅테크 7', null, ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA']],
  ['클라우드·SaaS', 'SKYY', ['SNOW', 'NET', 'DDOG', 'MDB', 'TEAM', 'HUBS', 'WDAY', 'SHOP', 'OKTA']],
  ['사이버보안', 'CIBR', ['CRWD', 'PANW', 'FTNT', 'ZS', 'NET', 'OKTA', 'S', 'CYBR', 'QLYS']],
  ['양자컴퓨터', 'QTUM', ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'IBM', 'HON', 'ARQQ']],
  ['우라늄·원전', 'URA', ['CCJ', 'OKLO', 'SMR', 'LEU', 'NNE', 'UEC', 'BWXT', 'UUUU', 'CEG']],
  ['전력·전력망', 'GRID', ['VST', 'CEG', 'NRG', 'GEV', 'ETN', 'PWR', 'VRT', 'HUBB', 'NEE']],
  ['로봇·자동화', 'BOTZ', ['ISRG', 'TSLA', 'SYM', 'TER', 'ROK', 'ZBRA', 'SERV']],
  ['우주항공', 'UFO', ['RKLB', 'ASTS', 'LUNR', 'PL', 'RDW', 'IRDM', 'BA']],
  ['방산', 'ITA', ['LMT', 'RTX', 'NOC', 'GD', 'LHX', 'HII', 'KTOS', 'AVAV']],
  ['드론', null, ['AVAV', 'KTOS', 'RCAT', 'UMAC', 'ONDS']],
  ['전기차·자율주행', null, ['TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'GM', 'F']],
  ['비트코인·가상자산', 'IBIT', ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HOOD', 'HUT']],
  ['핀테크', null, ['HOOD', 'SOFI', 'PYPL', 'XYZ', 'AFRM', 'UPST', 'V', 'MA']],
  ['대형 은행', null, ['JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW']],
  ['지방은행', 'KRE', ['ZION', 'KEY', 'CFG', 'HBAN', 'RF', 'FITB']],
  ['바이오', 'XBI', ['VRTX', 'REGN', 'AMGN', 'GILD', 'BIIB', 'ALNY', 'MRNA', 'CRSP', 'INSM']],
  ['비만치료제', null, ['LLY', 'NVO', 'VKTX', 'AMGN', 'HIMS']],
  ['의료기기·헬스케어', null, ['UNH', 'JNJ', 'ABT', 'TMO', 'ISRG', 'DHR', 'SYK', 'MDT']],
  ['석유·가스', 'XOP', ['XOM', 'CVX', 'COP', 'OXY', 'EOG', 'SLB', 'DVN']],
  ['금·광산', 'GDX', ['NEM', 'GOLD', 'AEM', 'KGC', 'FNV', 'WPM']],
  ['리튬·2차전지', 'LIT', ['ALB', 'SQM', 'ENVX', 'QS', 'TSLA']],
  ['클린에너지', 'ICLN', ['FSLR', 'ENPH', 'NEE', 'RUN', 'PLUG']],
  ['중국 인터넷', 'KWEB', ['BABA', 'PDD', 'JD', 'BIDU', 'NTES', 'BILI']],
  ['유통·소비', null, ['AMZN', 'WMT', 'COST', 'TGT', 'HD', 'LOW']],
  ['여행·항공', 'JETS', ['DAL', 'UAL', 'AAL', 'LUV', 'BKNG', 'ABNB', 'EXPE']],
  ['미디어·소셜', null, ['META', 'NFLX', 'SNAP', 'PINS', 'RDDT', 'SPOT', 'DIS', 'ROKU']],
  ['주택건설', 'XHB', ['DHI', 'LEN', 'PHM', 'NVR', 'TOL']],
];
// S&P 500 섹터별 대형주
export const US_SECTOR_MEMBERS = {
  XLK: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE', 'CSCO', 'IBM'],
  XLC: ['META', 'GOOGL', 'NFLX', 'TMUS', 'DIS', 'VZ', 'T', 'CMCSA', 'EA'],
  XLY: ['AMZN', 'TSLA', 'HD', 'MCD', 'BKNG', 'LOW', 'TJX', 'SBUX', 'NKE'],
  XLF: ['BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP'],
  XLV: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'ISRG', 'AMGN'],
  XLI: ['GE', 'CAT', 'RTX', 'UBER', 'HON', 'BA', 'UNP', 'DE', 'LMT', 'ETN'],
  XLE: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY', 'MPC', 'PSX'],
  XLB: ['LIN', 'SHW', 'APD', 'ECL', 'NEM', 'FCX', 'DOW', 'NUE'],
  XLP: ['WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MDLZ', 'CL'],
  XLU: ['NEE', 'SO', 'DUK', 'CEG', 'VST', 'AEP', 'SRE', 'D'],
  XLRE: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'O', 'PSA', 'CCI'],
};
// 나스닥100 구성 종목 → 섹터 (섹터 평균에 함께 반영 + '나스닥100' 지수 흐름)
export const NDX_BY_SECTOR = {
  XLK: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'CSCO', 'AMD', 'ADBE', 'TXN', 'QCOM', 'INTU', 'AMAT', 'MU', 'LRCX', 'KLAC', 'INTC', 'ADI', 'PANW', 'CRWD', 'SNPS', 'CDNS', 'FTNT', 'MRVL', 'WDAY', 'ADSK', 'ROP', 'NXPI', 'TEAM', 'DDOG', 'ZS', 'CTSH', 'ON', 'CDW', 'GFS', 'MCHP', 'APP', 'PLTR', 'ASML', 'ARM', 'MSTR', 'SHOP'],
  XLC: ['META', 'GOOGL', 'NFLX', 'TMUS', 'CMCSA', 'CHTR', 'EA', 'TTWO', 'WBD', 'TTD'],
  XLY: ['AMZN', 'TSLA', 'BKNG', 'SBUX', 'ABNB', 'MAR', 'ORLY', 'ROST', 'LULU', 'DASH', 'MELI', 'PDD'],
  XLP: ['COST', 'PEP', 'MDLZ', 'MNST', 'KDP', 'KHC', 'CCEP'],
  XLV: ['AZN', 'ISRG', 'AMGN', 'GILD', 'VRTX', 'REGN', 'IDXX', 'DXCM', 'BIIB', 'GEHC'],
  XLI: ['HON', 'ADP', 'CTAS', 'CSX', 'PCAR', 'AXON', 'FAST', 'PAYX', 'CPRT', 'VRSK', 'ODFL'],
  XLE: ['BKR', 'FANG'], XLU: ['CEG', 'AEP', 'EXC', 'XEL'], XLB: ['LIN'], XLRE: ['CSGP'], XLF: ['PYPL'],
};
export const NDX = [...new Set(Object.values(NDX_BY_SECTOR).flat())];
function groupStats(name, etf, list, q, extra = {}) {
  const st = list.map((t) => { const v = q['US:' + t]; return v?.price != null && v.pct != null ? { t, name: v.nameKo || t, price: v.price, pct: Math.round(Number(v.pct) * 100) / 100 } : null; }).filter(Boolean).sort((a, b) => b.pct - a.pct);
  if (st.length < 2) return null;
  const rate = Math.round((st.reduce((a, x) => a + x.pct, 0) / st.length) * 100) / 100;
  return { name, etf, rate, rise: st.filter((x) => x.pct > 0).length, fall: st.filter((x) => x.pct < 0).length, flat: st.filter((x) => x.pct === 0).length, total: st.length, leaders: st.slice(0, 4), members: st, ...extra };
}

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
  const etfs = [...US_SECTORS.map((x) => x[0]), ...US_THEMES.map((x) => x[0]), 'QQQ', 'SPY'];
  // ETF 등락률도 네이버 실시간 시세(정규장 하루 등락) 우선 — Nasdaq 관심목록은 장 마감 뒤 '시간외 등락'이 섞여 나옴
  const nq = await getQuotes(etfs.map((t) => 'US:' + t)).catch(() => ({}));
  const q = {};
  for (const t of etfs) { const v = nq['US:' + t]; if (v?.price != null && v.pct != null) q[t] = { price: v.price, pct: v.pct }; }
  const missE = etfs.filter((t) => !q[t]);
  if (missE.length) Object.assign(q, Object.fromEntries(Object.entries(await etfQuotes(missE).catch(() => ({}))).filter(([t]) => missE.includes(t))));
  const stocks = [...new Set([...US_THEMES.flatMap((x) => x[2]), ...US_GROUPS.flatMap((x) => x[2]), ...Object.values(US_SECTOR_MEMBERS).flat(), ...NDX])];
  // 종목이 많아서 60개씩 나눠 조회
  const sq = {};
  const parts = [];
  for (let i = 0; i < stocks.length; i += 60) parts.push(stocks.slice(i, i + 60));
  for (const r of await Promise.all(parts.map((p) => getQuotes(p.map((t) => 'US:' + t)).catch(() => ({}))))) Object.assign(sq, r);
  const sectors = US_SECTORS.map(([t, name]) => ({ t, name, ...(q[t] || {}) })).filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  const themes = US_THEMES.map(([t, name, list]) => ({ t, name, ...(q[t] || {}), stocks: list.map((s) => ({ t: s, ...(sq['US:' + s] || {}) })).filter((s) => s.price != null).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99)) }))
    .filter((x) => x.pct != null).sort((a, b) => b.pct - a.pct);
  // 국장처럼: 테마·섹터별 소속 종목 평균 등락률 + 상승/하락 비율 + 대장주
  const groups = US_GROUPS.map(([name, etf, list]) => groupStats(name, etf, list, sq, { etfPct: etf && q[etf] ? q[etf].pct : null })).filter(Boolean).sort((a, b) => b.rate - a.rate);
  // 섹터 = S&P 500 대형주 + 나스닥100 구성 종목 (섹터별로 합침)
  const secList = (t) => [...new Set([...(US_SECTOR_MEMBERS[t] || []), ...(NDX_BY_SECTOR[t] || [])])];
  const sectorGroups = US_SECTORS.map(([t, name]) => groupStats(name, t, secList(t), sq, { etfPct: q[t]?.pct ?? null })).filter(Boolean).sort((a, b) => b.rate - a.rate);
  // 지수 흐름: 나스닥100 · S&P 500 대형주 (오른 종목·내린 종목 비율)
  const spxBig = [...new Set(Object.values(US_SECTOR_MEMBERS).flat())];
  const indexGroups = [groupStats('나스닥 100', 'QQQ', NDX, sq, { etfPct: q.QQQ?.pct ?? null }), groupStats('S&P 500 대형주', 'SPY', spxBig, sq, { etfPct: q.SPY?.pct ?? null })].filter(Boolean);
  return { sectors, themes, groups, sectorGroups, indexGroups, groupCount: US_GROUPS.length };
}

// 종목별 섹터·업종 (목록 옆에 작게 표시)
//  미국: Nasdaq 전체 종목 스크리너 (sector, industry) → 한국어
//  한국: KIND(한국거래소) 상장법인 목록 (업종)
//  7일마다 새로 받아 D1에 저장
import { fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';

const SECTOR_KO = {
  Technology: '기술', 'Health Care': '헬스케어', Finance: '금융', 'Consumer Discretionary': '경기소비재', Industrials: '산업재',
  Energy: '에너지', 'Real Estate': '부동산', Utilities: '유틸리티', 'Basic Materials': '소재', 'Consumer Staples': '필수소비재',
  Telecommunications: '통신', Miscellaneous: '기타',
};
const IND_KO = [
  [/semiconductor/i, '반도체'], [/biotech|biological/i, '바이오'], [/pharmac|medicinal/i, '제약'], [/medical\/dental instruments|surgical|medical electronics|ophthalmic|orthopedic/i, '의료기기'],
  [/hospital|nursing|medical\/nursing|health.*services/i, '의료서비스'], [/software|EDP/i, '소프트웨어'], [/computer communications|telecommunications equipment|radio and television/i, '통신장비'],
  [/computer manufacturing|computer peripheral|electronic components|electrical products|consumer electronics/i, 'IT 하드웨어'], [/internet|business services|advertising/i, '인터넷·서비스'],
  [/major banks|commercial banks|savings institutions|banks/i, '은행'], [/investment bankers|brokers|investment managers|finance: consumer|finance companies|finance\/investors/i, '금융서비스'],
  [/insurer|insurance/i, '보험'], [/real estate investment trusts|REIT/i, '리츠'], [/real estate/i, '부동산'], [/blank check/i, '스팩(SPAC)'],
  [/oil|gas|petroleum|natural gas/i, '석유·가스'], [/coal/i, '석탄'], [/electric utilities|power generation|water supply|utilities/i, '전력·유틸리티'],
  [/precious metals|gold/i, '귀금속'], [/steel|iron|metal|mining|aluminum|copper/i, '금속·광업'], [/chemical/i, '화학'],
  [/aerospace|military|defense/i, '항공·방산'], [/auto|automotive|motor vehicles/i, '자동차'], [/air freight|trucking|railroads|marine|transportation|shipping/i, '운송·물류'],
  [/airlines/i, '항공사'], [/industrial machinery|industrial specialties|engineering|construction|building|homebuilding/i, '기계·건설'],
  [/restaurant/i, '외식'], [/hotel|resort|casino|gaming|amusement|recreation|movies|entertainment|broadcasting/i, '레저·미디어'],
  [/stores|retail|catalog|distribution/i, '유통'], [/packaged foods|beverage|food|meat|farming|agricultur/i, '식음료·농업'],
  [/apparel|shoe|clothing|textile/i, '의류'], [/tobacco/i, '담배'], [/telecom/i, '통신서비스'], [/renewable|solar/i, '신재생에너지'],
];
export const industryKo = (s) => { for (const [re, ko] of IND_KO) if (re.test(s || '')) return ko; return ''; };

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };

async function usSectors() {
  const r = await fetchWithTimeout('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true', { headers: NQ_H }, 15000);
  const j = await r.json();
  const rows = j?.data?.rows || j?.data?.table?.rows || [];
  const out = {};
  for (const x of rows) {
    const t = String(x.symbol || '').trim().toUpperCase().replace('/', '.');
    if (!t) continue;
    const sec = SECTOR_KO[x.sector] || '';
    const ind = industryKo(x.industry);
    if (sec || ind) out[t] = [sec, ind].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  }
  if (Object.keys(out).length < 1000) throw new Error('Nasdaq 섹터 목록이 너무 적음 ' + Object.keys(out).length);
  return out;
}

// KIND 업종명 줄이기: "통신 및 방송 장비 제조업" → "통신·방송 장비"
const krShort = (s) => String(s || '').replace(/\s*제조업$/, '').replace(/\s*및\s*/g, '·').replace(/\s*(서비스업|업)$/, '').trim();

async function krSectors() {
  const r = await fetchWithTimeout('https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13', { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://kind.krx.co.kr/' } }, 15000);
  const html = decodeText(await r.arrayBuffer(), /utf-?8/i.test(r.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const cells = (tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) => decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
  const head = cells(rows[0] || '');
  const iCode = head.findIndex((h) => /종목코드/.test(h)), iInd = head.findIndex((h) => /업종/.test(h)), iProd = head.findIndex((h) => /주요제품/.test(h));
  if (iCode < 0 || iInd < 0) throw new Error('KIND 목록 형식 변경');
  const out = {};
  for (const tr of rows.slice(1)) {
    const c = cells(tr);
    const code = (c[iCode] || '').padStart(6, '0');
    if (!/^[0-9A-Z]{6}$/.test(code)) continue;
    out[code] = krShort(c[iInd]);
    if (iProd >= 0 && c[iProd]) out[code] += '|' + c[iProd].slice(0, 40);
  }
  if (Object.keys(out).length < 1000) throw new Error('KIND 목록이 너무 적음');
  return out;
}

let mem = null;
/** { us: {TICKER: '기술 · 반도체'}, kr: {'005930': '통신·방송 장비|휴대폰, 반도체…'} } */
export async function getSectors({ allowFetch = true } = {}) {
  if (mem && Date.now() - mem.at < 6 * 3600e3) return mem;
  const saved = await getJSON('sectors/map');
  if (saved && Date.now() - saved.at < 7 * 86400e3) { mem = saved; return saved; }
  if (!allowFetch) return saved || { at: 0, us: {}, kr: {} };
  const [us, kr] = await Promise.allSettled([usSectors(), krSectors()]);
  const next = {
    at: Date.now(),
    us: us.status === 'fulfilled' ? us.value : saved?.us || {},
    kr: kr.status === 'fulfilled' ? kr.value : saved?.kr || {},
    errors: [us, kr].filter((x) => x.status === 'rejected').map((x) => String(x.reason?.message || x.reason)),
  };
  // 둘 다 실패하면 1시간 뒤 다시 시도하도록 저장 시각을 앞당김
  if (next.errors.length === 2) next.at = Date.now() - 7 * 86400e3 + 3600e3;
  mem = next;
  await setJSON('sectors/map', next).catch(() => {});
  return next;
}

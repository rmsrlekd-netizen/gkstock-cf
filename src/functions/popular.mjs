// /api/popular — 실시간 인기 종목 TOP 10 + 상승·하락 상위 10 (국내·미국)
//  한국: 네이버 증권 "검색 상위 종목"
//  미국: StockTwits 실시간 트렌딩(미국 상장 주식만) → 실패 시 Nasdaq 거래량 상위
import { json, fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities, num } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { us as usQuote } from './quote.mjs';
import { naverKrTop, naverUsTop, naverKrMovers, naverUsMovers, naverUsExtMovers, tvUsExtMovers, naverKrExtMovers } from '../lib/naver.mjs';

// 미국 시간외(프리마켓 04:00~09:30 · 애프터마켓 16:00~20:00, 뉴욕시간 평일)인지
function usExtSession(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  if (['Sat', 'Sun'].includes(p.weekday)) return null;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 240 && m < 570 ? 'PRE' : m >= 960 && m < 1200 ? 'AFTER' : null;
}

// 국내 넥스트레이드 시간외: 프리 08:00~08:50, 애프터 15:30~20:00 (평일)
function krExtSession(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  if (['Sat', 'Sun'].includes(p.weekday)) return null;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 480 && m < 540 ? 'PRE' : m >= 930 && m < 1205 ? 'AFTER' : null;
}
// 시간외 가격이 있으면 표시 등락률·가격을 시간외 기준으로 (정규장 값은 regPct·regPrice로 보관)
const useExt = (x) => { if (x && x.session && x.livePct != null && x.regPct === undefined) { x.regPct = x.pct; x.regPrice = x.price; x.pct = x.livePct; x.price = x.live ?? x.price; } return x; };

const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };

async function naverTop() {
  const r = await fetchWithTimeout('https://finance.naver.com/sise/lastsearch2.naver', { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/', 'Accept-Language': 'ko-KR,ko;q=0.9' } }, 8000);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  const html = decodeText(await r.arrayBuffer(), /utf-?8/i.test(r.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
  const out = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const code = (tr.match(/code=([0-9A-Z]{6})/) || [])[1];
    if (!code) continue;
    const name = decodeEntities(((tr.match(/<a[^>]*code=[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '').replace(/<[^>]+>/g, '')).trim();
    const nums = (tr.match(/<td[^>]*class="number"[^>]*>[\s\S]*?<\/td>/gi) || []).map((td) => td.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim());
    const pctCell = nums.find((x) => /%$/.test(x) && /^[+-]/.test(x)) || nums[3];
    const price = n0(nums[1]);
    let pct = n0(pctCell);
    if (pct !== null && /하락|down/i.test(tr) && pct > 0 && !/^\+/.test(pctCell)) pct = -pct;
    out.push({ market: 'KR', ticker: code, name, price, pct, ratio: nums[0] || null });
    if (out.length >= 10) break;
  }
  if (out.length < 5) throw new Error('네이버 검색 상위 형식 변경');
  return out;
}

const US_EX = /^(NASDAQ|NYSE|NYSEMkt|NYSEArca|NYSE American|AMEX|BATS)$/i;
async function stocktwitsTop() {
  const r = await fetchWithTimeout('https://api.stocktwits.com/api/2/trending/symbols.json', { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 7000);
  if (!r.ok) throw new Error('StockTwits HTTP ' + r.status);
  const j = await r.json();
  const list = (j.symbols || []).filter((s) => US_EX.test(s.exchange || '') && /^(Stock|DepositoryReceipt)$/i.test(s.instrument_class || '') && /^[A-Z.]{1,6}$/.test(s.symbol || ''));
  if (list.length < 3) throw new Error('StockTwits 미국 종목 부족');
  return list.slice(0, 10).map((s) => ({ market: 'US', ticker: s.symbol, name: s.title, why: s.trends?.summary ? String(s.trends.summary).slice(0, 200) : null }));
}

async function nasdaqActive() {
  const r = await fetchWithTimeout('https://api.nasdaq.com/api/marketmovers?assetclass=stocks&exchangestatus=currentMarket&limit=10', { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } }, 7000);
  const j = await r.json();
  const s = j?.data?.STOCKS || j?.data || {};
  const rows = s.MostActiveByShareVolume?.table?.rows || s.MostActiveByDollarVolume?.table?.rows || [];
  if (!rows.length) throw new Error('Nasdaq 거래량 상위 없음');
  return rows.slice(0, 10).map((x) => ({ market: 'US', ticker: x.symbol, name: x.name, price: num(String(x.lastSalePrice || '').replace('$', '')), pct: num(String(x.change || x.percentageChange || '').replace('%', '')) }));
}

export default async () => {
  const cached = await getJSON('popular/v2');
  if (cached && Date.now() - cached.at < 60e3) return json({ ok: true, ...cached }, { cdnSeconds: 60, swr: 120 });
  const errors = [];
  let kr = [], krSrc = '네이버 증권 검색 상위';
  try { kr = await naverKrTop(10); } catch (e) {
    errors.push('KR: ' + e.message);
    try { kr = await naverTop(); } catch (e2) { errors.push('KR2: ' + e2.message); kr = cached?.kr || []; }
  }
  let usList = [], usSrc = '네이버 증권 해외 인기 (최근 1시간)';
  try { usList = await naverUsTop(10); } catch (e) {
    errors.push('US: ' + e.message);
    try { usList = await stocktwitsTop(); usSrc = 'StockTwits 실시간 트렌딩'; } catch (e2) {
      errors.push('US2: ' + e2.message);
      try { usList = await nasdaqActive(); usSrc = 'Nasdaq 거래량 상위'; } catch (e3) { errors.push('US3: ' + e3.message); usList = cached?.us || []; usSrc = cached?.usSrc || usSrc; }
    }
  }
  await Promise.all(usList.map(async (x) => {
    if (x.price != null && x.pct != null) return;
    const q = await usQuote(x.ticker).catch(() => null);
    if (q) { x.price = q.price; x.pct = q.pct; }
  }));
  // 상승·하락 상위 (국내·미국)
  const mv = await Promise.all([['krUp', naverKrMovers, 'up'], ['krDown', naverKrMovers, 'down'], ['usUp', naverUsMovers, 'up'], ['usDown', naverUsMovers, 'down']].map(async ([k, fn, dir]) => {
    try { return [k, await fn(dir, 10)]; } catch (e) { errors.push(`${k}: ${e.message}`); return [k, cached?.[k] || []]; }
  }));
  const out = { at: Date.now(), kr, us: usList, krSrc, usSrc, ...Object.fromEntries(mv), errors };
  // 미국 프리마켓·애프터마켓 시간엔 상승·하락을 시간외 등락률 기준으로 (3분마다 새로 계산)
  const sess = usExtSession();
  if (sess) {
    let ext = cached?.usExt && cached.usExt.session === sess && Date.now() - cached.usExt.at < 2 * 60e3 ? cached.usExt : null;
    if (!ext) {
      // 1순위: 트레이딩뷰 전체 종목 스캔 (소형주까지 전부) → 실패하면 네이버 시총 상위 + 전일 급등락 종목으로 계산
      try { ext = { ...(await tvUsExtMovers(sess, 10)), at: Date.now() }; } catch (e) {
        errors.push('usExtTV: ' + e.message);
        try { ext = { ...(await naverUsExtMovers(10)), session: sess, src: 'naver', at: Date.now() }; } catch (e2) { errors.push('usExt: ' + e2.message); }
      }
    }
    if (ext?.up?.length) { out.usExt = ext; out.usUp = ext.up; out.usDown = ext.down; out.usSession = sess; }
    // 인기 종목도 시간외 등락률을 함께 표시
    for (const x of usList) if (x.ext && x.ext.session === sess) { x.regPct = x.pct; x.regPrice = x.price; x.pct = x.ext.pct; x.price = x.ext.price ?? x.price; x.session = sess; }
  }
  // 국내 넥스트레이드 프리·애프터마켓 시간엔 인기·상승·하락을 시간외 등락률 기준으로
  for (const k of ['kr', 'krUp', 'krDown']) for (const x of out[k] || []) useExt(x);
  const ks = krExtSession();
  if (ks) {
    let ext = cached?.krExt && cached.krExt.session === ks && Date.now() - cached.krExt.at < 2 * 60e3 ? cached.krExt : null;
    if (!ext) { try { ext = { ...(await naverKrExtMovers(10)), session: ks, at: Date.now() }; } catch (e) { errors.push('krExt: ' + e.message); } }
    if (ext?.up?.length || ext?.down?.length) { out.krExt = ext; out.krUp = ext.up; out.krDown = ext.down; out.krSession = ks; }
  }
  // 저장된 "오늘 움직임 이유" 붙이기 (3분마다 따로 만들어 둠)
  const wm = (await getJSON('why/map')) || {};
  for (const k of ['kr', 'us', 'krUp', 'krDown', 'usUp', 'usDown']) for (const x of out[k] || []) { const w = wm[`${x.market}|${String(x.ticker).toUpperCase()}`]; if (w?.r && Date.now() - w.at < 20 * 3600e3) { x.reason = w.r; x.rconf = w.c; } }
  if (kr.length || usList.length) await setJSON('popular/v2', out).catch(() => {});
  return json({ ok: true, ...out }, { cdnSeconds: 60, swr: 120 });
};

export const config = { path: '/api/popular' };

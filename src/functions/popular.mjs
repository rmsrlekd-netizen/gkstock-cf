// /api/popular — 실시간 인기 종목 TOP 10 + 상승·하락 상위 10 (국내·미국)
//  한국: 네이버 증권 "검색 상위 종목"
//  미국: StockTwits 실시간 트렌딩(미국 상장 주식만) → 실패 시 Nasdaq 거래량 상위
import { json, fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities, num, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { us as usQuote, getQuotes } from './quote.mjs';
import { queryArchive } from '../lib/archive.mjs';
import { savedHeadline } from './analyze.mjs';
import { usDaySession, usDayMovers, usDayQuotes } from '../lib/usday.mjs';
import { naverKrTop, naverUsTop, naverKrMovers, naverUsMovers, naverUsExtMovers, tvUsExtMovers, naverKrExtMovers, naverKrQuotes } from '../lib/naver.mjs';

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

// 오늘 새로 상장한 종목 (38커뮤니케이션 신규상장 일정 → 종목코드 → 실시간 시세)
//  네이버 상승·하락 순위에는 상장 첫날 종목이 빠져 있어서 따로 붙임
const normNm = (s) => String(s || '').replace(/\(.*?\)|㈜|주식회사|\s/g, '').toUpperCase();
async function krNewListings(today) {
  const ipo = await getJSON('sched/kripo');
  const names = (ipo?.list || []).filter((x) => x.sub === '상장' && x.start === today).map((x) => ({ name: x.name, offer: x.price }));
  krNewListings.names = names;
  if (!names.length) return [];
  const ck = `ipo/codes/${today}`;
  const known = (await getJSON(ck)) || {};
  const need = names.filter((x) => !known[x.name]);
  if (need.length) {
    const { getKrNames } = await import('../lib/krnames.mjs');
    let list = await getKrNames({ maxAge: 20 * 3600e3 }).catch(() => []); // 상장 첫날이라 하루 안에 받은 목록으로
    for (const x of need) {
      const nn = normNm(x.name);
      let hit = list.find((y) => normNm(y.n) === nn) || list.find((y) => normNm(y.n).startsWith(nn) || nn.startsWith(normNm(y.n)));
      if (!hit) { // 네이버 종목 검색으로 한 번 더
        try {
          const r = await fetchWithTimeout(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(x.name)}&target=stock`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://m.stock.naver.com/' } }, 6000);
          const j = await r.json();
          const it = (j.items || []).find((y) => /^\d{6}$/.test(y.code || '') && (y.nationCode === 'KOR' || !y.nationCode) && (normNm(y.name) === nn || normNm(y.name).startsWith(nn) || nn.startsWith(normNm(y.name))));
          if (it) hit = { c: it.code };
        } catch {}
      }
      if (hit?.c) known[x.name] = hit.c;
    }
    await setJSON(ck, known).catch(() => {});
  }
  const codes = names.map((x) => known[x.name]).filter(Boolean);
  if (!codes.length) return [];
  const q = await naverKrQuotes(codes).catch(() => ({}));
  const seenC = new Set();
  return names.filter((x) => q[known[x.name]]?.price != null && !seenC.has(known[x.name]) && seenC.add(known[x.name])).map((x) => { const v = q[known[x.name]]; return { market: 'KR', ticker: known[x.name], name: v.nameKo || x.name, ...v, cur: 'KRW', ipo: true, offer: x.offer || null }; });
}

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

// 방문자는 저장된 목록을 바로 받고, 1분 넘게 지났으면 뒤에서 새로 계산 (새로 계산은 10초 넘게 걸릴 때가 있어서 기다리게 하지 않음)
export default async (req, ctx) => {
  const cached = await getJSON('popular/v2');
  if (cached && Date.now() - cached.at < 60e3) return json({ ok: true, ...cached }, { cdnSeconds: 60, swr: 120 });
  if (cached && Date.now() - cached.at < 15 * 60e3 && ctx?.waitUntil) {
    refreshInBackground(ctx, 'popular', () => build(cached));
    return json({ ok: true, ...cached }, { cdnSeconds: 20, swr: 60 });
  }
  return json({ ok: true, ...(await build(cached)) }, { cdnSeconds: 60, swr: 120 });
};

async function build(cached) {
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
        try { const nx = await naverUsExtMovers(10); const ok = (x) => x.session === sess; ext = { ...nx, up: nx.up.filter(ok), down: nx.down.filter(ok), session: sess, src: 'naver', at: Date.now() }; } catch (e2) { errors.push('usExt: ' + e2.message); }
      }
      // 최근 36시간 공시·보도자료 종목도 후보로 (트레이딩뷰는 프리장 초반 몇십 분간 시세가 늦음 → 발표로 급등한 종목이 빠지는 문제)
      try { ext = await addNewsMovers(ext, sess); } catch (e) { errors.push('usExtNews: ' + e.message); }
    }
    if (ext?.up?.length) { out.usExt = ext; out.usUp = ext.up; out.usDown = ext.down; out.usSession = sess; }
    // 인기 종목도 시간외 등락률을 함께 표시
    for (const x of usList) if (x.ext && x.ext.session === sess) { x.regPct = x.pct; x.regPrice = x.price; x.pct = x.ext.pct; x.price = x.ext.price ?? x.price; x.session = sess; }
  }
  // 미국 주간거래(데이마켓, 한국 낮 시간): 한국투자증권 시세로 상승·하락 순위와 인기 종목 등락률 (2분마다 새로)
  if (!sess && usDaySession()) {
    let day = cached?.usDay && Date.now() - cached.usDay.at < 2 * 60e3 ? cached.usDay : null;
    if (!day) {
      try { day = { ...(await usDayMovers(10)), at: Date.now() }; } catch (e) { errors.push('usDay: ' + e.message); }
      if (day) {
        const exOf = new Map(usList.map((x) => [x.ticker, /\.O$/.test(x.reuters || '') ? 'NASDAQ' : '']));
        day.pop = await usDayQuotes(usList.map((x) => x.ticker), exOf).catch(() => ({}));
      }
    }
    if (day?.up?.length || day?.down?.length) { out.usDay = day; out.usUp = day.up; out.usDown = day.down; out.usSession = 'DAY'; }
    // 주간거래 시세가 있으면 그 등락률, 없으면(주간거래 안 되는 종목) 정규장 등락률 그대로 · 표시 없이
    for (const x of usList) { const d = day?.pop?.[x.ticker]; if (d?.pct != null) { x.regPct = x.pct; x.regPrice = x.price; x.pct = d.pct; x.price = d.price; x.session = 'DAY'; } else if (x.session !== 'DAY') delete x.session; }
  } else if (!sess) {
    // 정규장·휴장 시간에 네이버 목록에 남은 '애프터' 표시는 떼어냄 (등락률은 정규장 기준이라 헷갈림)
    for (const k of ['us', 'usUp', 'usDown']) for (const x of out[k] || []) if (x.status !== 'OPEN') delete x.session;
  }
  // 오늘 상장한 종목을 국내 상승·하락 순위에 끼워 넣음 (정규장 9시 이후)
  try {
    const kz = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const today = `${kz.year}-${kz.month}-${kz.day}`;
    if (Number(kz.hour) >= 9) {
      const nl = cached?.krNew?.date === today && Date.now() - cached.krNew.at < 60e3 ? cached.krNew.list : await krNewListings(today).catch((e) => { errors.push('krNew: ' + e.message); return []; });
      out.krNew = { date: today, at: Date.now(), list: nl, names: cached?.krNew?.date === today && Date.now() - cached.krNew.at < 60e3 ? cached.krNew.names || [] : (krNewListings.names || []).map((x) => x.name) };
      // 네이버 순위에 이미 들어 있는 오늘 상장 종목도 '신규상장' 표시 (종목코드나 이름으로 확인)
      const nlCodes = new Set(nl.map((x) => x.ticker)), nlNames = new Set(out.krNew.names.map(normNm));
      const offerOf = new Map(nl.map((x) => [x.ticker, x.offer]));
      for (const k of ['kr', 'krUp', 'krDown']) for (const x of out[k] || []) if (nlCodes.has(x.ticker) || nlNames.has(normNm(x.name))) { x.ipo = true; if (offerOf.get(x.ticker)) x.offer = offerOf.get(x.ticker); }
      if (nl.length) {
        const ids = new Set(nl.map((x) => x.ticker));
        const put = (k, keep, cmp) => { out[k] = [...(out[k] || []).filter((x) => !ids.has(x.ticker)), ...nl.filter(keep)].sort(cmp).slice(0, 10); };
        put('krUp', (x) => x.pct > 0, (a, b) => b.pct - a.pct);
        put('krDown', (x) => x.pct < 0, (a, b) => a.pct - b.pct);
      }
    }
  } catch (e) { errors.push('krNew: ' + e.message); }
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
  // AI 이유가 아직 없으면 우리 사이트의 최근(48시간 = 전날까지) 공시·보도자료 핵심 제목을 대신 보여줌
  //  (전체 최신 200건만 보면 공시가 많은 날엔 12시간 전 것도 빠짐 → 순위에 오른 종목별로 따로 조회)
  try {
    const { ownTitle } = await import('../lib/why.mjs');
    const since = Date.now() - 48 * 3600e3, pm = {};
    const keys = [...new Set(['kr', 'us', 'krUp', 'krDown', 'usUp', 'usDown'].flatMap((k) => (out[k] || []).map((x) => `${x.market}|${String(x.ticker).toUpperCase()}`)))];
    await Promise.all(keys.map(async (key) => {
      const [mk, t] = key.split('|');
      for (const n of await queryArchive({ market: mk, ticker: t, limit: 8 }).catch(() => [])) {
        const ms = Date.parse(n.time || '');
        if (!(ms > since) || /^(3|4|5|144)(\/A)?$/.test(String(n.form || ''))) continue; // 내부자 거래 보고는 제외
        const tt = ownTitle(n);
        if (!tt) continue;
        //  한국어 핵심 제목이 있는 것 > 보도자료 > 최신 순 ("수시공시 기타 주요 사항" 같은 서식 이름만 있는 건 뒤로)
        const sc = (mk === 'KR' || n.ko?.title || n.titleKo ? 2 : 0) + (n.src === 'PR' ? 1 : 0);
        if (!pm[key] || sc > pm[key].sc) pm[key] = { t: tt.slice(0, 80), kind: n.src === 'PR' ? '보도자료' : '공시', at: ms, sc, id: n.id };
      }
      //  "해외기업 수시공시"처럼 서식 이름뿐이면 → AI 한 줄 요약이 있으면 그걸, 없으면 표시하지 않고 뒤에서 요약을 만들어 둠
      const p = pm[key];
      if (p && p.sc === 0) {
        const h = await savedHeadline(p.id).catch(() => null);
        if (h) Object.assign(p, { t: h.slice(0, 80), sc: 2 });
        else pm[key] = { need: p.id };
      }
    }));
    for (const k of ['kr', 'us', 'krUp', 'krDown', 'usUp', 'usDown']) for (const x of out[k] || []) { const p = pm[`${x.market}|${String(x.ticker).toUpperCase()}`]; if (p?.t) x.pr = p; else if (p?.need) x.prNeed = p.need; }
  } catch {}
  if (kr.length || usList.length) await setJSON('popular/v2', out).catch(() => {});
  return out;
}

export const config = { path: '/api/popular' };

// 최근 공시·보도자료가 나온 미국 종목의 시간외 등락률을 상승·하락 순위에 합침
async function addNewsMovers(ext, sess) {
  const since = Date.now() - 36 * 3600e3;
  const items = await queryArchive({ market: 'US', limit: 200 });
  const tickers = [...new Set(items.filter((n) => n.ms > since && n.ticker && !/OTC/i.test(n.exchange || '')).map((n) => String(n.ticker).toUpperCase()))].slice(0, 120);
  if (!tickers.length) return ext;
  const q = await getQuotes(tickers.map((t) => 'US:' + t));
  const add = [];
  for (const t of tickers) {
    const x = q['US:' + t];
    if (!x || x.session !== sess || x.livePct == null || x.live == null) continue;
    add.push({ market: 'US', ticker: t, name: x.nameKo || t, price: x.live, pct: x.livePct, regPrice: x.price, regPct: x.pct, session: sess, cur: 'USD', status: sess, news: true });
  }
  const up0 = ext?.up || [], down0 = ext?.down || [];
  const merge = (base, dir) => {
    const m = new Map(base.map((x) => [x.ticker, x]));
    for (const x of add) if (dir > 0 ? x.pct > 0 : x.pct < 0) { const o = m.get(x.ticker); m.set(x.ticker, o ? { ...o, price: x.price, pct: x.pct } : x); }
    return [...m.values()].sort((a, b) => dir * (b.pct - a.pct)).slice(0, 10);
  };
  return { ...(ext || { session: sess, src: 'news' }), up: merge(up0, 1), down: merge(down0, -1), at: ext?.at || Date.now() };
}

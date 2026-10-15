// 작전 의심 레이더 (관리자 전용) — 국장 전 종목(코스피·코스닥 개별 종목, ETF·ETN·거래정지 제외)을
//  ① DART 공시 패턴(무자본 M&A·3자배정 증자·CB 남발·전환가 조정·사업목적 추가·투자조합 지분·전환청구 …)
//  ② 거래량·주가 패턴(박스권 매집·거래량 폭증·급등 후 이탈)
//  으로 점수를 매기고, 상위 종목은 AI가 단계(판 깔기·매집·띄우기·털기)와 '세력 평단가'를 추정
//  · 결과는 날짜별로 영구 보관 (mp/day/YYYY-MM-DD, 지우지 않음) — 관리자 화면에서 날짜를 골라 다시 볼 수 있음
//  · 크론(3분마다)이 장 마감 뒤(15:50~) 단계별로 조금씩 진행: 전 종목 시세 → 공시 → 후보 일봉 → 원문 가격 → AI
//  ※ '패턴이 비슷하다'는 신호일 뿐 불공정거래의 증거가 아님. 외부 공개 금지(관리자 화면 전용)
import { getJSON, setJSON, sqlDB } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';
import { isTradingDay } from './schedule.mjs';
import { buildPartyIndex, linksOf, radarAlert } from './manipx.mjs';

const n0 = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[,\s]/g, '')); return Number.isFinite(x) ? x : null; };
const kst = (ms = Date.now()) => { const d = new Date(ms + 9 * 3600e3); return { date: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() }; };
const DAY = 86400e3;

// ───── ① 공시 패턴 ─────
//  w: 점수, stage: 어느 단계 신호인지 (setup 판 깔기 · pump 띄우기 · exit 털기 · risk 위험)
export const EV = {
  mna:       { w: 4, cap: 6, stage: 'setup', ko: '최대주주 변경·경영권 양수도' },
  rights3:   { w: 3, cap: 6, stage: 'setup', ko: '제3자배정 유상증자' },
  rightsfix: { w: 2, cap: 4, stage: 'setup', ko: '증자 정정(납입 연기 등)' },
  rights:    { w: 1, cap: 2, stage: 'setup', ko: '유상증자' },
  rightsR:   { w: 0, cap: 0, stage: 'none', ko: '채권단·출자전환 증자(구조조정)' }, // 워크아웃·채무조정 목적 → 작전 신호에서 뺌
  cb:        { w: 2, cap: 6, stage: 'setup', ko: 'CB·BW·EB 발행' },
  refix:     { w: 2, cap: 4, stage: 'setup', ko: '전환가 하향 조정(리픽싱)' },
  fund5:     { w: 3, cap: 6, stage: 'setup', ko: '투자조합 5% 지분 신고' },
  purpose:   { w: 2, cap: 2, stage: 'setup', ko: '정관·사업목적 변경' },
  bonus:     { w: 2, cap: 2, stage: 'pump', ko: '무상증자' },
  capred:    { w: 2, cap: 2, stage: 'setup', ko: '감자' },
  contract:  { w: 1, cap: 2, stage: 'pump', ko: '공급계약' },
  invest:    { w: 1, cap: 2, stage: 'pump', ko: '투자판단 주요경영사항(MOU 등)' },
  inquiry:   { w: 2, cap: 4, stage: 'pump', ko: '조회공시(시황 급변)' },
  conv:      { w: 3, cap: 6, stage: 'exit', ko: '전환·행사 청구(추가 상장 물량)' },
  majsell:   { w: 2, cap: 4, stage: 'exit', ko: '최대주주 지분 변동' },
  pledge:    { w: 2, cap: 4, stage: 'exit', ko: '주식 담보·질권' },
  risk:      { w: 2, cap: 4, stage: 'risk', ko: '불성실공시·횡령·관리종목 등' },
};
export function evKind(text, party = '') {
  const t = String(text || '').replace(/\s+/g, '');
  if (/불성실공시|상장적격성|횡령|배임|관리종목|감사의견|회생절차|상장폐지/.test(t)) return 'risk';
  if (/(전환청구권|신주인수권|교환청구권)행사|전환청구|추가상장/.test(t)) return 'conv';
  if (/(전환가액|행사가액|교환가액)의?조정/.test(t)) return 'refix';
  if (/(전환사채|신주인수권부사채|교환사채)권?발행결정/.test(t)) return 'cb';
  if (/유상증자/.test(t) && /정정/.test(t)) return 'rightsfix';
  if (/유상증자/.test(t) && /제3자|3자배정/.test(t)) return 'rights3';
  if (/유상증자결정/.test(t)) return 'rights';
  if (/최대주주등소유주식변동|소유주식변동신고/.test(t)) return 'majsell';
  if (/최대주주변경|경영권|주식등?양수도|최대주주인수/.test(t)) return 'mna';
  if (/대량보유/.test(t) && /조합|투자조합|신기술|사모/.test(String(party || '') + t)) return 'fund5';
  if (/담보|질권/.test(t)) return 'pledge';
  if (/정관|사업목적/.test(t)) return 'purpose';
  if (/무상증자/.test(t)) return 'bonus';
  if (/감자결정/.test(t)) return 'capred';
  if (/조회공시|현저한시황변동|풍문/.test(t)) return 'inquiry';
  if (/공급계약/.test(t)) return 'contract';
  if (/투자판단관련/.test(t)) return 'invest';
  return null;
}
const KEYS = ['전환사채', '신주인수권', '교환사채', '유상증자', '최대주주', '경영권', '양수도', '정관', '공급계약', '무상증자', '감자', '청구권', '전환가액', '행사가액', '대량보유', '소유주식변동', '조회공시', '투자판단', '담보', '상장적격성', '불성실', '횡령', '추가상장', '관리종목'];

const NAMES = new Map(); // 공시에 적힌 회사 이름 (시세 목록에 없을 때 대신)
/** 최근 180일 DART 공시 → { 종목코드: [{ms, kind, title, sum, id}] } (보관소에서 SQL 한 번) */
async function loadEvents(now) {
  const since = now - 180 * DAY;
  const out = {};
  const add = (r) => {
    const text = `${r.f || ''} ${r.t || ''}`;
    const k = evKind(text, r.p);
    if (!k || !r.tk) return;
    if (r.nm) NAMES.set(r.tk, r.nm);
    (out[r.tk] ||= []).push({ ms: r.ms, kind: k, title: String(r.f || r.t || '').slice(0, 80), sum: [r.st, r.ss].filter(Boolean).join(' · ').slice(0, 140), id: r.id, party: r.p || null });
  };
  const d = await sqlDB().catch(() => null);
  if (d) {
    const ex = "(COALESCE(title,'') || ' ' || COALESCE(json_extract(data,'$.formKo'),''))";
    const like = KEYS.map(() => 'x LIKE ?').join(' OR ');
    const sql = `SELECT * FROM (SELECT id, ticker AS tk, name AS nm, ms, title AS t, json_extract(data,'$.formKo') AS f, json_extract(data,'$.party') AS p, json_extract(data,'$.summary.title') AS st, json_extract(data,'$.summary.sub') AS ss, ${ex} AS x FROM items WHERE src = 'DART' AND ms > ? AND ticker IS NOT NULL) WHERE ${like} LIMIT 60000`;
    const r = await d.prepare(sql).bind(since, ...KEYS.map((k) => `%${k}%`)).all();
    for (const row of r.results || []) add(row);
  } else {
    const { queryArchive } = await import('./archive.mjs');
    for (const x of await queryArchive({ kind: 'FILING', market: 'KR', limit: 200 })) add({ id: x.id, tk: x.ticker, nm: x.name, ms: Date.parse(`${x.date || ''}T12:00:00+09:00`) || x.approxMs || Date.now(), t: x.titleClean, f: x.formKo, p: x.party, st: x.summary?.title, ss: x.summary?.sub });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.ms - a.ms);
  return out;
}
export function eventScore(evs, now = Date.now()) {
  const by = {};
  for (const e of evs || []) {
    const age = (now - e.ms) / DAY;
    const w = (EV[e.kind]?.w || 0) * (age <= 90 ? 1 : 0.5);
    if (!EV[e.kind]?.cap) continue;
    by[e.kind] = Math.min(EV[e.kind].cap, (by[e.kind] || 0) + w);
  }
  const score = Object.values(by).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 10) / 10, by };
}

// ───── ② 전 종목 시세 (네이버 시가총액 순 목록, ETF·ETN·거래정지 제외) ─────
async function nget(url) {
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  return r.json();
}
const halted = (x) => { const s = x.tradeStopType; if (!s) return false; const v = `${s.code || ''} ${s.name || ''} ${s.text || ''}`; return /HALT|STOP|SUSPEND|정지/i.test(v) && !/TRADING|^\s*1\s/.test(v); };
async function snapshot() {
  const rows = {};
  for (const mkt of ['KOSPI', 'KOSDAQ']) {
    for (let p = 1; p <= 30; p += 5) {
      const pages = await Promise.all([0, 1, 2, 3, 4].map((i) => nget(`https://m.stock.naver.com/api/stocks/marketValue/${mkt}?page=${p + i}&pageSize=100`).catch(() => null)));
      let end = false;
      for (const j of pages) {
        const list = j?.stocks || [];
        if (list.length < 100) end = true;
        for (const x of list) {
          if (!x.itemCode || (x.stockEndType && x.stockEndType !== 'stock') || halted(x)) continue;
          const code = x.compareToPreviousPrice?.code;
          const pct = n0(x.fluctuationsRatio);
          const vol = n0(x.accumulatedTradingVolumeRaw ?? x.accumulatedTradingVolume);
          if (!vol) continue; // 거래가 없으면(정지 등) 제외
          rows[x.itemCode] = [x.stockName, mkt === 'KOSPI' ? 'P' : 'Q', n0(x.closePriceRaw ?? x.closePrice), pct == null ? null : ['4', '5'].includes(String(code)) ? -Math.abs(pct) : Math.abs(pct), vol, n0(x.accumulatedTradingValueRaw ?? x.accumulatedTradingValue), n0(x.marketValueRaw ?? x.marketValue)];
        }
      }
      if (end) break;
    }
  }
  return rows; // code → [이름, 시장(P코스피/Q코스닥), 종가, 등락률, 거래량, 거래대금, 시총]
}

// ───── ③ 일봉 (170거래일) ─────
async function bars(code) {
  const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=170&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('일봉 HTTP ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g)].map((m) => ({ d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, o: +m[2], h: +m[3], l: +m[4], c: +m[5], v: +m[6] })).filter((x) => x.c > 0);
}
const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const vwap = (rows) => { let pv = 0, v = 0; for (const x of rows) { pv += ((x.h + x.l + x.c) / 3) * x.v; v += x.v; } return v ? pv / v : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** 일봉 → 거래량·주가 패턴 + 매집 구간 평단 추정 */
export function barFeatures(B) {
  if (!B || B.length < 40) return null;
  const last = B[B.length - 1], n = B.length;
  const win = (a, b) => B.slice(Math.max(0, n - a), n - b);
  const base = win(65, 5), base60 = median(base.map((x) => x.v));
  const v5 = B.slice(-5).reduce((s, x) => s + x.v, 0) / 5;
  const v20 = B.slice(-20).reduce((s, x) => s + x.v, 0) / 20;
  const maxV10 = Math.max(...B.slice(-10).map((x) => x.v));
  // 매집이 길게 이어지면 최근 60일 기준선도 같이 올라가서 '거래 증가'가 안 보임 → 매집 전(90~170일 전) 거래량을 따로 기준으로
  const old = B.slice(0, Math.max(0, n - 90)), longBase = old.length >= 30 ? median(old.map((x) => x.v)) : 0;
  const L40 = B.slice(-40), box40 = Math.max(...L40.map((x) => x.h)) / Math.min(...L40.map((x) => x.l)) - 1;
  const lo60 = Math.min(...B.slice(-60).map((x) => x.l)), hi60 = Math.max(...B.slice(-60).map((x) => x.h));
  const hi20 = Math.max(...B.slice(-20).map((x) => x.h));
  const bmin = Math.min(...base.map((x) => x.l)), bmax = Math.max(...base.map((x) => x.h));
  const ret = (k) => (B[n - 1 - k] ? ((last.c / B[n - 1 - k].c) - 1) * 100 : null);
  // 첫 거래량 폭증일(중앙값의 5배 이상)을 찾아, 그 전 구간을 '매집 구간'으로 봄
  const med120 = median(B.slice(-120).map((x) => x.v));
  let spike = -1;
  for (let i = Math.max(0, n - 60); i < n; i++) if (B[i].v >= med120 * 5) { spike = i; break; }
  const accEnd = spike > 0 ? spike : n;
  // 매집 시작 추정: 폭증(또는 오늘) 이전 150일 중 OBV(오른 날 거래량 +, 내린 날 −를 누적)가 가장 낮았던 날
  //  → 그날 이후 '오를 때 거래가 많고 내릴 때 적은' 흐름이 시작됐다고 봄. 너무 가까우면(20일 미만) 최소 20일 구간
  let obv = 0, minObv = Infinity, accStartI = Math.max(0, accEnd - 60);
  const from = Math.max(1, accEnd - 150);
  for (let i = from; i < accEnd; i++) {
    obv += B[i].c > B[i - 1].c ? B[i].v : B[i].c < B[i - 1].c ? -B[i].v : 0;
    if (obv < minObv) { minObv = obv; accStartI = i; }
  }
  if (accEnd - accStartI < 20) accStartI = Math.max(0, accEnd - 20);
  const accRows = B.slice(accStartI, accEnd);
  // 매집 구간 동안 OBV가 얼마나 늘었는지 (구간 거래량 대비) — 클수록 '조용히 사 모은' 흔적
  let obv2 = 0, vsum = 0;
  for (let i = Math.max(1, accStartI); i < accEnd; i++) { obv2 += B[i].c > B[i - 1].c ? B[i].v : B[i].c < B[i - 1].c ? -B[i].v : 0; vsum += B[i].v; }
  const heavy = B.slice(-120).filter((x) => x.v >= med120 * 2);
  // 과거 고점(매물대): 매집 시작 전 최고가 · 전체(약 170거래일) 최고가 — 위쪽 저항 가격 후보
  const hiOf = (rows) => rows.reduce((m, x) => (!m || x.h > m.h ? x : m), null);
  const preTop = accStartI >= 10 ? hiOf(B.slice(0, accStartI)) : null, allTop = hiOf(B);
  const f = {
    close: last.c, date: last.d,
    ret5: r1(ret(5)), ret20: r1(ret(20)), ret60: r1(ret(60)),
    fromLow60: r1((last.c / lo60 - 1) * 100), offHigh20: r1((last.c / hi20 - 1) * 100),
    volX5: base60 ? r1(v5 / base60) : null, volX20: base60 ? r1(v20 / base60) : null, maxVolX10: base60 ? r1(maxV10 / base60) : null,
    box60: r1((bmax / bmin - 1) * 100), box40: r1(box40 * 100),
    volL20: longBase ? r1(v20 / longBase) : null, // 20일 평균 거래량 ÷ 매집 전(90~170일 전) 거래량
    spikeDate: spike > 0 ? B[spike].d : null,
    accStart: B[accStartI]?.d || null, accEnd: B[Math.max(0, accEnd - 1)]?.d || null, accDays: accRows.length,
    accObv: vsum ? r1((obv2 / vsum) * 100) : null, // 매집 구간 순매수 강도(%)
    accLow: accRows.length ? Math.min(...accRows.map((x) => x.l)) : null, accHigh: accRows.length ? Math.max(...accRows.map((x) => x.h)) : null,
    vwapAcc: accRows.length >= 10 ? Math.round(vwap(accRows)) : null, // 매집 구간(추정 시작일~폭증 전) 평균 체결가(거래량 가중)
    vwapHeavy: heavy.length >= 3 ? Math.round(vwap(heavy)) : null, // 거래량이 평소 2배 넘던 날들의 평균 체결가
    vwap120: Math.round(vwap(B.slice(-120))),
    hiPre: preTop?.h || null, hiPreD: preTop?.d || null, hiAll: allTop?.h || null, hiAllD: allTop?.d || null,
  };
  // 패턴 점수
  const sig = [];
  let s = 0;
  const quiet = f.box60 != null && f.box60 < 40 && Math.abs(f.ret20 ?? 0) < 15;
  if ((f.accObv ?? 0) >= 15 && (f.accDays ?? 0) >= 30) { s += 1; sig.push(`매집 구간 순매수 흔적 (${f.accStart} 부터 추정)`); }
  if (quiet && (f.volX20 ?? 0) < 1.5 && (f.volL20 ?? 0) >= 1.5 && (f.box40 ?? 99) < 35) { s += 3; sig.push(`박스권에서 거래량이 몇 달 전보다 ${f.volL20}배 (장기 매집 의심)`); }
  if (quiet && (f.volX20 ?? 0) >= 1.5) { s += 3; sig.push('박스권 + 거래량 증가 (매집 의심)'); }
  else if (quiet && (f.volX5 ?? 0) >= 2) { s += 2; sig.push('박스권에서 최근 거래 증가'); }
  if ((f.maxVolX10 ?? 0) >= 10) { s += 2; sig.push(`최근 10일 거래량 폭증 (평소의 ${Math.round(f.maxVolX10)}배)`); }
  else if ((f.maxVolX10 ?? 0) >= 5) { s += 1; sig.push(`거래량 급증 (평소의 ${Math.round(f.maxVolX10)}배)`); }
  if ((f.fromLow60 ?? 0) >= 100) { s += 3; sig.push(`60일 저점 대비 +${Math.round(f.fromLow60)}%`); }
  else if ((f.fromLow60 ?? 0) >= 50) { s += 2; sig.push(`60일 저점 대비 +${Math.round(f.fromLow60)}%`); }
  if ((f.fromLow60 ?? 0) >= 50 && (f.offHigh20 ?? 0) <= -25) { s += 2; sig.push(`고점 대비 ${Math.round(f.offHigh20)}% (급등 후 이탈)`); }
  f.score = s; f.sig = sig;
  return f;
}

// ───── ④ 공시 원문에서 가격 (세력 평단 근거: 전환가·발행가·양수도 단가) ─────
async function docPrice(e) {
  const ck = `mp/px/${e.id}`;
  const c = await getJSON(ck);
  if (c) return c;
  let p = null, label = null, third = false, restr = false, pledge = null, pen = null;
  const cbx = {};
  try {
    const { fetchDartDoc, summarizeDart } = await import('./dart-doc.mjs');
    const L = await fetchDartDoc(String(e.id).replace(/^DART-/, ''));
    const s = summarizeDart(e.title, L);
    third = /제3자|3자배정/.test(`${s?.title || ''} ${L.slice(0, 120).join(' ')}`);
    restr = /출자전환|채권단|채무조정|기업개선|워크아웃|회생계획|대출채권|채권금융기관/.test(L.slice(0, 250).join(' '));
    const m = `${s?.title || ''} ${s?.sub || ''}`.match(/(발행가|전환가|행사가|교환가)\s*([\d,]+)원/);
    if (m) { p = n0(m[2]); label = m[1]; }
    if (e.kind === 'fund5' || /대량보유/.test(e.title)) { // 5% 보고서 '세부변동내역': 날짜별 장내매수 수량·단가
      const buys = [];
      for (let i = 0; i < L.length; i++) {
        if (!/장내\s*매수|장내매수/.test(L[i])) continue;
        let d = null; for (let k = i; k >= Math.max(0, i - 4); k--) { const m2 = L[k].match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/); if (m2) { d = `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`; break; } }
        const nums = L.slice(i + 1, i + 9).map((x) => n0((x.match(/^-?[\d,]+(\.\d+)?$/) || [])[0])).filter((v) => v != null);
        // 표 순서: 변동 전 · 증감 · 변동 후 · 취득/처분 단가 → 마지막 쪽 '단가'로 보이는 값
        const q = nums.length >= 3 ? Math.abs(nums[1]) : null, pr = nums.slice(3).find((v) => v >= 50 && v < 5e6) ?? null;
        if (d && pr) buys.push({ d, q, p: pr });
      }
      if (buys.length) {
        const qs = buys.reduce((a, b) => a + (b.q || 0), 0);
        p = Math.round(qs ? buys.reduce((a, b) => a + b.p * (b.q || 0), 0) / qs : buys.reduce((a, b) => a + b.p, 0) / buys.length);
        label = `장내 취득 평균 (${buys[0].d}~${buys[buys.length - 1].d}, ${buys.length}건)`;
        e.buys = buys.slice(0, 30);
      }
    }
    // CB·BW·EB 상세: 전환청구기간, 최저 조정가(리픽싱 하한), 콜옵션(매도청구권)
    if (['cb', 'refix'].includes(e.kind) || /사채권발행결정/.test(e.title)) {
      const dateIn = (t) => { const m2 = String(t).match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/); return m2 ? `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}` : null; };
      const ci = L.findIndex((x) => /(전환|권리행사|교환)청구기간|권리행사기간|(전환|행사|교환)\s*청구\s*기간/.test(x));
      if (ci >= 0) { const ds = L.slice(ci, ci + 10).map(dateIn).filter(Boolean); if (ds[0]) cbx.start = ds[0]; if (ds[1]) cbx.end = ds[1]; }
      const fi = L.findIndex((x) => /최저\s*조정\s*가액|조정가액\s*하한|최저\s*전환가/.test(x));
      if (fi >= 0) for (let k = fi; k < fi + 4 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{3,}/) || [])[0]); if (v && v >= 50 && v < 5e6) { cbx.floor = v; break; } }
      if (!p) { const pi = L.findIndex((x) => /(전환|행사|교환)가액\s*\(원/.test(x)); if (pi >= 0) for (let k = pi; k < pi + 3 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{2,}/) || [])[0]); if (v && v >= 50 && v < 5e6) { p = v; label = /행사/.test(L[pi]) ? '행사가' : /교환/.test(L[pi]) ? '교환가' : '전환가'; break; } } }
      const oi = L.findIndex((x) => /매도청구권|콜옵션|Call\s*Option/i.test(x));
      if (oi >= 0) { cbx.call = true; const near = L.slice(oi, oi + 25).join(' '); const m3 = near.match(/(\d{1,3}(?:\.\d+)?)\s*%/); if (m3 && +m3[1] <= 100) cbx.callPct = +m3[1]; }
    }
    // 불성실공시법인 지정(예고): 부과벌점·누계벌점
    if (/불성실공시/.test(e.title)) {
      const numAfter2 = (re) => { const i = L.findIndex((x) => re.test(x)); if (i < 0) return null; for (let k = i; k < i + 4 && k < L.length; k++) { const m4 = L[k].replace(re, '').match(/(\d{1,3}(?:\.\d+)?)\s*점/) || (k > i ? L[k].match(/^(\d{1,3}(?:\.\d+)?)$/) : null); if (m4) return +m4[1]; } return null; };
      pen = { p: numAfter2(/부과\s*벌점/), cum: numAfter2(/누계\s*벌점/), pre: /예고/.test(e.title) && !/지정\s*\(|지정결정/.test(e.title) };
    }
    // 주식 담보: 차입(대출)금액 ÷ 담보 주식 수 → 1주당 대출액 (반대매매 기준가는 보통 그 1.4배 안팎으로 추정)
    if (['pledge', 'majsell', 'fund5'].includes(e.kind) || /담보|질권/.test(e.title)) {
      const li = L.findIndex((x) => /(차입|대출)\s*금액|담보\s*(대출|설정)\s*금액/.test(x));
      const si = L.findIndex((x) => /담보\s*(제공\s*)?주식\s*(등의\s*)?수|담보\s*주식수/.test(x));
      const numAfter = (i) => { for (let k = i; k < i + 5 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{4,}/) || [])[0]); if (v) return v; } return null; };
      const loan = li >= 0 ? numAfter(li) : null, sh = si >= 0 ? numAfter(si) : null;
      if (loan && sh && loan / sh >= 50 && loan / sh < 5e6) pledge = { loan, sh, perShare: Math.round(loan / sh) };
    }
    if (!p) { // 조정 공시·양수도: '조정 후 전환가액', '1주당 (양수도)가액' 줄 다음 숫자
      const i = L.findIndex((x) => /조정\s*후\s*(전환|행사|교환)가액|1주당\s*(양수도|매매|취득)?\s*가[액격]|주당\s*양수도\s*가액/.test(x));
      if (i >= 0) for (let k = i; k < i + 4 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{3,}/) || [])[0]); if (v && v >= 50 && v < 5e6) { p = v; label = /조정/.test(L[i]) ? '조정 전환가' : '양수도 단가'; break; } }
    }
  } catch {}
  const out = { p, label, kind: e.kind, at: e.ms, third, restr, buys: e.buys || null, cbx: Object.keys(cbx).length ? cbx : null, pledge, pen };
  await setJSON(ck, out).catch(() => {});
  return out;
}

// ───── 보강 신호: 같은 세력 연결 · 시장경보 · 시총 · 일상적 수주 업종 ─────
async function ctxLoad(snap = {}) {
  const pidx = (await getJSON('mp/party'))?.idx || {};
  const warn = (await getJSON('mp/warn'))?.map || {};
  let sectors = {};
  try { sectors = (await (await import('./sectors.mjs')).getSectors({ allowFetch: false }))?.kr || {}; } catch {}
  const caps = Object.entries(snap).filter(([, r]) => r[6] > 0).sort((a, b) => a[1][6] - b[1][6]);
  const pct = {};
  caps.forEach(([c], i) => { pct[c] = caps.length > 1 ? i / (caps.length - 1) : 0.5; });
  return { pidx, warn, sectors, pct };
}
const ROUTINE_IND = /건설|토목|조선|플랜트|엔지니어링|방산|항공기|전력|철도/;
export function extras(code, evs, by, ctx = {}) {
  const sig = [], notes = [];
  let add = 0, mult = 1;
  const links = linksOf(code, evs, ctx.pidx);
  if (links.length) { add += Math.min(4, links.length * 2); sig.push(`같은 세력 연결 의심: ${links.map((l) => `${l.who}→${l.others.map((o) => o.nm || o.c).slice(0, 3).join('·')}`).join(' / ')}`); }
  const warn = ctx.warn?.[code] || null;
  if (warn) { add += warn.m >= 2 ? 2 : 1; sig.push(`거래소 ${warn.lv} 지정${warn.date ? ` (${warn.date})` : ''}`); }
  const cp = ctx.pct?.[code];
  if (cp != null && cp <= 0.4) { add += 1; sig.push(`시가총액 하위 ${Math.max(1, Math.round(cp * 100))}% 소형주`); }
  if (cp != null && cp >= 0.9) { mult = 0.6; notes.push(`시가총액 상위 ${Math.max(1, Math.round((1 - cp) * 100))}% 대형주 — 작전 가능성을 낮게 봄 (점수 ×0.6)`); }
  const ind = ctx.sectors?.[code] ? String(ctx.sectors[code]).split('|')[0] : null;
  const nContract = (evs || []).filter((e) => e.kind === 'contract').length;
  if ((by.contract || by.invest) && (nContract >= 5 || ROUTINE_IND.test(ind || ''))) { add -= (by.contract || 0) + (by.invest || 0); notes.push(`공급계약이 일상적인 업종·회사${ind ? `(${ind})` : ''}로 보여 공급계약·MOU 점수 제외`); }
  return { add, mult, sig, notes, links, warn, ind, capPct: cp ?? null };
}

// ───── 단계 판정 (AI 전 기본값) ─────
function stageOf(by, f) {
  const exit = (by.conv || 0) + (by.majsell || 0) + (by.pledge || 0);
  const setup = (by.mna || 0) + (by.rights3 || 0) + (by.cb || 0) + (by.fund5 || 0) + (by.purpose || 0) + (by.refix || 0);
  if (f && (f.fromLow60 ?? 0) >= 50 && ((f.offHigh20 ?? 0) <= -20 || exit >= 3)) return '털기';
  if (f && ((f.fromLow60 ?? 0) >= 50 || ((f.maxVolX10 ?? 0) >= 10 && (f.ret20 ?? 0) >= 20))) return '띄우기';
  // 매집: 아직 크게 안 올랐고(60일 저점 대비 +40% 미만), 박스권에서 거래가 늘거나 순매수 흐름이 이어짐
  if (f && (f.fromLow60 ?? 99) < 40) {
    const box = (f.box40 ?? f.box60 ?? 99);
    if (box < 35 && ((f.volX20 ?? 0) >= 1.3 || (f.volL20 ?? 0) >= 1.5)) return '매집';
    if ((f.accObv ?? 0) >= 15 && (f.accDays ?? 0) >= 30 && box < 45) return '매집';
  }
  if (setup >= 3) return '판 깔기';
  return '관찰';
}

// ───── 확인된 사실 목록 (AI가 이것만 근거로 쓰게 · 번호로 인용) ─────
const ymdOf = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const fmtW = (v) => (v == null ? '-' : Math.round(v).toLocaleString('ko-KR'));
export function factsOf(x) {
  const F = [], f = x.f || {};
  const add = (t, src, extra = {}) => { F.push({ id: 'F' + (F.length + 1), t, src, ...extra }); return F[F.length - 1].id; };
  if (x.close != null) add(`현재가 ${fmtW(x.close)}원${x.pct != null ? ` (오늘 ${x.pct > 0 ? '+' : ''}${x.pct}%)` : ''}`, '시세');
  for (const e of (x.events || []).slice(0, 15)) add(`${ymdOf(e.ms)} ${EV[e.kind]?.ko || e.kind} 공시: ${e.title}${e.sum ? ' — ' + e.sum : ''}${e.party ? ` (제출인 ${e.party})` : ''}`, '공시', { id2: e.id, kind: e.kind, ms: e.ms });
  for (const p of x.px || []) add(`${p.date} 공시 원문 가격: ${p.label} ${fmtW(p.p)}원${p.buys?.length ? ` (장내 취득 ${p.buys.length}건: ${p.buys.slice(0, 6).map((b) => `${b.d} ${b.q ? fmtW(b.q) + '주 ' : ''}${fmtW(b.p)}원`).join(', ')})` : ''}`, '공시 원문', { price: p.p, kind: p.kind });
  if (f.accStart) add(`거래 흐름상 매집 추정 구간 ${f.accStart} ~ ${f.accEnd} (${f.accDays}거래일, 순매수 강도 ${f.accObv}%, 가격 ${fmtW(f.accLow)}~${fmtW(f.accHigh)}원)`, '일봉 계산');
  if (f.vwapAcc) add(`매집 추정 구간 거래량 가중 평균가 ${fmtW(f.vwapAcc)}원`, '일봉 계산', { price: f.vwapAcc });
  if (f.vwapHeavy) add(`최근 120일 중 거래량이 평소 2배 넘은 날들의 평균가 ${fmtW(f.vwapHeavy)}원`, '일봉 계산', { price: f.vwapHeavy });
  if (f.hiPre) add(`매집 추정 시작 전 최고가 ${fmtW(f.hiPre)}원 (${f.hiPreD})${f.hiAll ? `, 최근 약 170거래일 최고가 ${fmtW(f.hiAll)}원 (${f.hiAllD})` : ''}`, '일봉 계산');
  if (f.fromLow60 != null) add(`60일 저점 대비 ${f.fromLow60 > 0 ? '+' : ''}${f.fromLow60}%, 20일 고점 대비 ${f.offHigh20}%`, '일봉 계산');
  if (f.volX5 != null) add(`거래량(평소 대비): 최근 5일 ${f.volX5}배, 20일 ${f.volX20}배, 10일 중 최대 ${f.maxVolX10}배${f.spikeDate ? `, 첫 폭증일 ${f.spikeDate}` : ''}`, '일봉 계산');
  if (f.box60 != null) add(`폭증 전 60일 박스권 폭 ${f.box60}%${f.ret20 != null ? `, 20일 수익률 ${f.ret20}%` : ''}${f.ret60 != null ? `, 60일 수익률 ${f.ret60}%` : ''}`, '일봉 계산');
  for (const p of x.px || []) {
    if (p.cbx) add(`${p.date} CB 원문 조건:${p.cbx.start ? ` 전환청구기간 ${p.cbx.start}${p.cbx.end ? ' ~ ' + p.cbx.end : ''}` : ''}${p.cbx.floor ? `, 리픽싱 최저 조정가 ${fmtW(p.cbx.floor)}원` : ''}${p.cbx.call ? `, 콜옵션(매도청구권)${p.cbx.callPct ? ' ' + p.cbx.callPct + '%' : ''} 있음` : ''}`, '공시 원문');
    if (p.pledge) add(`${p.date} 주식 담보: 담보 ${fmtW(p.pledge.sh)}주에 대출 ${fmtW(p.pledge.loan)}원 → 1주당 ${fmtW(p.pledge.perShare)}원`, '공시 원문');
  }
  const pn = penaltyOf(x);
  if (pn?.cum) add(`불성실공시 벌점: 최근 1년 누계 ${pn.cum}점 (${pn.n}건${pn.last ? `, 마지막 ${pn.last.date} ${pn.last.p ?? '?'}점` : ''})${pn.pend ? ', 지정 예고 진행 중' : ''}`, '공시 원문');
  for (const l of x.links || []) add(`같은 이름 '${l.who}'이(가) 다른 종목에도 등장: ${l.others.map((o) => `${o.nm || o.c}(${o.d})`).join(', ')}`, '공시 비교');
  if (x.warn) add(`거래소 ${x.warn.lv} 지정${x.warn.date ? ' ' + x.warn.date : ''}`, '거래소');
  const c = costRange(x);
  if (c && x.close) add(`자동 계산: 공시 가격·매집 평균가 기준 추정 평단 ${fmtW(c.low)}~${fmtW(c.high)}원(평균 ${fmtW(c.mid)}원), 현재가는 평균 대비 ${x.close >= c.mid ? '+' : ''}${Math.round((x.close / c.mid - 1) * 100)}%`, '계산');
  return F;
}

// ───── 불성실공시 벌점 (최근 1년) ─────
//  거래소 규정(기사 기준): 1회 부과벌점 코스피 10점·코스닥 8점 이상 → 지정일 하루 매매정지
//  최근 1년 누계 15점 이상 → 코스피 관리종목 지정(이후 1년 추가 15점이면 실질심사) / 코스닥 상장적격성 실질심사
export function penaltyOf(x, now = Date.now()) {
  const L = (x.px || []).filter((p) => p.pen && (now - Date.parse(p.date + 'T12:00:00+09:00')) < 365 * DAY).sort((a, b) => (a.date < b.date ? 1 : -1));
  const ev = (x.events || []).filter((e) => e.kind === 'risk' && /불성실공시/.test(e.title) && now - e.ms < 365 * DAY);
  if (!L.length && !ev.length) return null;
  const fixed = L.filter((p) => !p.pen.pre);
  const sum = fixed.reduce((a, p) => a + (p.pen.p || 0), 0);
  const cumDoc = fixed.find((p) => p.pen.cum != null)?.pen.cum ?? null;
  const cum = Math.max(sum, cumDoc || 0);
  const last = fixed[0] || null;
  const kospi = x.mkt === 'P';
  return {
    cum: cum || null, n: fixed.length, last: last ? { p: last.pen.p, date: last.date } : null,
    pend: L.some((p) => p.pen.pre) || ev.some((e) => /예고/.test(e.title) && !/지정\s*\(|지정결정/.test(e.title)),
    unknown: !L.length, // 공시는 있는데 원문에서 점수를 못 읽음
    rule: kospi ? '코스피: 1회 10점↑ 하루 매매정지 · 1년 누계 15점↑ 관리종목' : '코스닥: 1회 8점↑ 하루 매매정지 · 1년 누계 15점↑ 상장적격성 실질심사',
    left: cum ? Math.max(0, 15 - cum) : null,
  };
}

// ───── 방향 판단 (규칙 기반 · AI가 바꾸지 못함) ─────
//  상승 가능성 = 작전 흐름상 '판 깔기·매집' 단계로, 아직 띄우기 전이고 주가가 추정 평단 근처
//  하락 위험   = '띄우기 뒤·털기' 단계로, 주가가 평단보다 크게 높거나 물량이 풀리는 신호
//  ※ 실제 주가 예측이 아니라 '패턴상 어느 쪽에 가까운지'
export function costRange(x) {
  const ps = [...(x.px || []).filter((p) => !['pledge', 'majsell', 'risk'].includes(p.kind)).map((p) => p.p), x.f?.vwapAcc].filter((v) => v > 0);
  if (!ps.length) return null;
  return { low: Math.min(...ps), high: Math.max(...ps), mid: ps.reduce((a, b) => a + b, 0) / ps.length };
}
//  ※ 세력의 실제 목표가는 어떤 공시에도 나오지 않음 → 공시에 적힌 가격과 실제 거래 가격만으로 '가격 사다리'를 만듦 (배수 계산 없음)
export function priceLevels(x) {
  const f = x.f || {}, close = x.close || null, L = [];
  const add = (p, kind, s, t, src, ref) => { if (p > 0) L.push({ p: Math.round(p), kind, s, t, src, ref: ref || null }); };
  for (const p of x.px || []) {
    if (p.p) {
      if (p.kind === 'cb' || p.kind === 'refix') add(p.p, 'cost', `CB ${p.label || '전환가'}`, `${p.date} 공시의 ${p.label || '전환가'} — CB 투자자의 원가. 주가가 이 위로 가야 전환해서 팔면 이익`, '공시 원문', p.ref);
      else if (p.kind === 'rights3' || (p.third && /발행가/.test(p.label || ''))) add(p.p, 'cost', '3자배정 발행가', `${p.date} 공시의 3자배정 발행가 — 신주를 받은 쪽의 원가`, '공시 원문', p.ref);
      else if (p.kind === 'fund5') add(p.p, 'cost', '5% 신고자 매수 평균', `${p.date} 5% 보고서의 ${p.label}`, '공시 원문', p.ref);
      else if (p.kind === 'mna') add(p.p, 'cost', '인수 단가', `${p.date} 최대주주 변경 공시의 ${p.label || '양수도 단가'} — 새 최대주주의 원가`, '공시 원문', p.ref);
      else if (!['pledge', 'majsell', 'risk'].includes(p.kind)) add(p.p, 'cost', p.label || '공시 가격', `${p.date} 공시의 ${p.label || '가격'}`, '공시 원문', p.ref);
    }
    if (p.cbx?.floor) add(p.cbx.floor, 'floor', 'CB 리픽싱 하한', `${p.date} CB 원문의 최저 조정가 — 주가가 내리면 전환가가 여기까지 낮아질 수 있음 (CB 쪽은 더 싸게 주식을 받음)`, '공시 원문', p.ref);
    if (p.pledge) add(p.pledge.perShare * 1.4, 'risk', '반대매매 추정선', `${p.date} 담보 1주당 대출 ${fmtW(p.pledge.perShare)}원의 1.4배(일반적 담보비율 가정) — 이 아래로 빠지면 담보 물량이 나올 수 있음`, '공시 원문+가정', p.ref);
  }
  if (f.vwapAcc) add(f.vwapAcc, 'cost', '매집 구간 평균가', `${f.accStart} ~ ${f.accEnd} 매집 추정 구간의 거래량 가중 평균가`, '일봉 계산');
  if (f.accLow) add(f.accLow, 'floor', '매집 구간 최저가', `매집 추정 구간(${f.accStart} ~ ${f.accEnd})의 가장 낮은 가격`, '일봉 계산');
  if (f.hiPre) add(f.hiPre, 'res', '매집 전 고점', `${f.hiPreD} 고점 — 매집 시작 전 가장 높았던 가격. 그때 산 사람들의 매물이 쌓인 자리`, '일봉 계산');
  if (f.hiAll && (!f.hiPre || Math.abs(f.hiAll / f.hiPre - 1) > 0.03)) add(f.hiAll, 'res', '최근 고점', `${f.hiAllD} 고점 — 최근 약 170거래일 중 가장 높은 가격`, '일봉 계산');
  if (f.vwapHeavy) add(f.vwapHeavy, close && f.vwapHeavy > close ? 'res' : 'cost', '거래 몰린 가격대', '최근 120일 중 거래량이 평소 2배 넘은 날들의 평균가 — 손바뀜이 많았던 가격', '일봉 계산');
  // 같은 가격(3% 이내)은 하나로 (공시 원문이 우선)
  const rankK = { cost: 0, floor: 1, risk: 2, res: 3 };
  const all = [];
  for (const l of L.sort((a, b) => (a.src === b.src ? rankK[a.kind] - rankK[b.kind] : a.src.startsWith('공시') ? -1 : 1))) {
    const dup = all.find((y) => Math.abs(y.p / l.p - 1) <= 0.03);
    if (dup) { if (!dup.also) dup.also = []; if (dup.also.length < 2 && dup.s !== l.s) dup.also.push(l.s); continue; }
    all.push(l);
  }
  all.sort((a, b) => b.p - a.p);
  for (const l of all) l.gap = close ? Math.round((l.p / close - 1) * 1000) / 10 : null;
  // 위쪽(현재가 +3% 이상)에 있는 원가·고점 = 목표 후보: 가까운 것부터
  const above = close ? all.filter((l) => l.p >= close * 1.03 && l.kind !== 'risk' && l.kind !== 'floor').sort((a, b) => a.p - b.p) : [];
  return { all, above };
}
export function direction(x, now = Date.now()) {
  const f = x.f || {}, ev = x.events || [], up = [], down = [];
  const age = (e) => (now - e.ms) / DAY;
  const SETUP = ['mna', 'rights3', 'cb', 'fund5', 'purpose', 'refix', 'rights']; // rightsR(구조조정 증자)은 제외
  const EXIT = ['conv', 'majsell', 'pledge'];
  const lastSetup = ev.filter((e) => SETUP.includes(e.kind) && age(e) <= 150).sort((a, b) => b.ms - a.ms)[0];
  const exitsAfter = ev.filter((e) => EXIT.includes(e.kind) && (!lastSetup || e.ms >= lastSetup.ms) && age(e) <= 90);
  const c = costRange(x), gap = c && x.close ? (x.close / c.mid - 1) * 100 : null;
  const R = (arr, w, t, src) => arr.push({ w, t, src });
  // 상승 쪽
  if (lastSetup && !exitsAfter.length) R(up, 2, `${ymdOf(lastSetup.ms)} '${EV[lastSetup.kind].ko}' 공시 이후 아직 전환청구·지분 매도 같은 털기 신호가 없음`, lastSetup.id);
  const setupKinds = new Set(ev.filter((e) => SETUP.includes(e.kind) && age(e) <= 150).map((e) => e.kind));
  if (setupKinds.size >= 2) R(up, 1, `최근 5개월 판 깔기 성격 공시 ${setupKinds.size}종류 (${[...setupKinds].map((k) => EV[k].ko).join(', ')})`, '공시');
  if ((f.box60 ?? 99) < 40 && (f.volX20 ?? 0) >= 1.5 && (f.fromLow60 ?? 0) < 40) R(up, 2, `주가는 박스권(폭 ${f.box60}%)인데 20일 거래량이 평소의 ${f.volX20}배 — 조용한 매집 흐름`, '일봉');
  if ((f.accObv ?? 0) >= 15 && (f.fromLow60 ?? 0) < 40) R(up, 1, `${f.accStart} 이후 오를 때 거래가 많고 내릴 때 적은 순매수 흐름(강도 ${f.accObv}%)`, '일봉');
  if (gap != null && gap <= 20 && gap >= -30) R(up, 2, `현재가 ${fmtW(x.close)}원이 추정 평단 ${fmtW(c.low)}~${fmtW(c.high)}원 근처 (${gap >= 0 ? '+' : ''}${Math.round(gap)}%) — 세력이 아직 수익 구간이 아님`, '계산');
  if ((f.fromLow60 ?? 99) < 25 && lastSetup) R(up, 1, `60일 저점 대비 ${f.fromLow60 > 0 ? '+' : ''}${f.fromLow60}%로 아직 크게 오르지 않음`, '일봉');
  const fund = ev.find((e) => e.kind === 'fund5' && age(e) <= 120);
  if (fund) R(up, 1, `${ymdOf(fund.ms)} 투자조합 등 5% 지분 신고${fund.party ? ` (${fund.party})` : ''}`, fund.id);
  for (const l of (x.links || []).slice(0, 2)) R(up, 2, `'${l.who}'이(가) 다른 종목(${l.others.map((o) => o.nm || o.c).slice(0, 3).join(', ')})에도 등장 — 같은 세력이 여러 종목을 다룰 가능성`, '공시');
  const callP = (x.px || []).find((p) => p.cbx?.call);
  if (callP) R(up, 1, `${callP.date} CB에 콜옵션(매도청구권${callP.cbx.callPct ? ' ' + callP.cbx.callPct + '%' : ''}) — 최대주주 쪽이 싸게 지분을 늘릴 수 있는 구조`, callP.ref || '공시');
  // 하락 쪽
  const pl = (x.px || []).filter((p) => p.pledge).sort((a, b) => b.pledge.perShare - a.pledge.perShare)[0];
  if (pl && x.close) { const mc = pl.pledge.perShare * 1.4; if (x.close <= mc * 1.15) R(down, 3, `주식 담보 1주당 대출 ${fmtW(pl.pledge.perShare)}원 → 반대매매 추정가 약 ${fmtW(mc)}원(대출의 1.4배로 가정) 근처 — 급락 위험`, pl.ref || '공시'); }
  if (x.warn && (x.warn.m >= 2 || (f.fromLow60 ?? 0) >= 40)) R(down, 1, `거래소 ${x.warn.lv} 지정${x.warn.date ? ` (${x.warn.date})` : ''} — 이미 과열로 분류됨`, '거래소');
  for (const e of exitsAfter.slice(0, 3)) R(down, e.kind === 'conv' ? 3 : 2, `${ymdOf(e.ms)} '${EV[e.kind].ko}' — ${e.kind === 'conv' ? '전환된 주식이 상장되면 매도 물량이 될 수 있음' : e.kind === 'majsell' ? '최대주주 지분이 바뀜(매도 여부는 원문 확인)' : '담보 주식은 주가 하락 시 반대매매 위험'}`, e.id);
  if (gap != null && gap >= 50) R(down, gap >= 100 ? 3 : 2, `현재가가 추정 평단보다 +${Math.round(gap)}% 높음 — 차익 실현 유인이 큼`, '계산');
  if ((f.fromLow60 ?? 0) >= 80) R(down, 2, `60일 저점 대비 +${f.fromLow60}% 급등한 상태`, '일봉');
  if ((f.fromLow60 ?? 0) >= 40 && (f.offHigh20 ?? 0) <= -20) R(down, 2, `급등 뒤 20일 고점 대비 ${f.offHigh20}% — 고점에서 이탈 중`, '일봉');
  if ((f.maxVolX10 ?? 0) >= 8 && (f.fromLow60 ?? 0) >= 40) R(down, 1, `최근 10일 거래량이 평소의 ${f.maxVolX10}배로 폭증한 뒤 — 손바뀜(물량 넘기기) 가능성`, '일봉');
  const cbs = ev.filter((e) => (e.kind === 'cb' || e.kind === 'refix') && age(e) <= 400);
  const conv = (x.px || []).filter((p) => p.kind === 'cb' || p.kind === 'refix').map((p) => p.p).filter(Boolean);
  if (cbs.length && conv.length && x.close && x.close >= Math.min(...conv) * 1.3) R(down, 2, `현재가가 CB 전환가 ${fmtW(Math.min(...conv))}원보다 ${Math.round((x.close / Math.min(...conv) - 1) * 100)}% 높아 전환 후 매도 유인`, '계산');
  const pen = penaltyOf(x, now);
  if (pen?.cum >= 15) R(down, 3, `불성실공시 벌점 최근 1년 누계 ${pen.cum}점 — 15점 이상 (${x.mkt === 'P' ? '관리종목 지정 기준' : '상장적격성 실질심사 기준'})`, '공시');
  else if (pen?.cum >= 10) R(down, 2, `불성실공시 벌점 최근 1년 누계 ${pen.cum}점 — 15점까지 ${pen.left}점 남음`, '공시');
  else if (pen?.pend) R(down, 1, '불성실공시법인 지정 예고 상태 — 벌점이 더해질 수 있음', '공시');
  const risk = ev.find((e) => e.kind === 'risk' && age(e) <= 180 && !/불성실공시/.test(e.title));
  if (risk) R(down, 2, `${ymdOf(risk.ms)} 위험 공시: ${risk.title}`, risk.id);
  // 참고 가격 사다리: 공시 원문 가격(원가)·과거 고점(매물대)·담보 반대매매선 — 위쪽은 목표 후보, 아래쪽은 지지 후보
  const lv = priceLevels(x);
  const tgt = lv.above.length ? lv.above.slice(0, 3) : null;
  // 목표 일정(참고): 물량이 풀릴 수 있는 날 — 일반 규정(사모 CB 전환 제한·사모 신주 전매 제한 1년) 기준 추정
  const dates = [];
  for (const e of ev.filter((e) => ['cb', 'rights3'].includes(e.kind)).slice(0, 4)) {
    const real = e.kind === 'cb' ? (x.px || []).find((p) => p.ref === e.id && p.cbx?.start)?.cbx : null;
    const d = real?.start || ymdOf(e.ms + 365 * DAY);
    dates.push({ d, t: `${ymdOf(e.ms)} ${e.kind === 'cb' ? (real ? `CB 발행 → 전환청구 가능 시작 (원문 기준${real.end ? `, ~${real.end}` : ''})` : 'CB 발행 → 전환청구 가능 시작(발행 1년 뒤로 추정)') : '3자배정 신주 → 전매 제한 해제(1년 뒤로 추정)'}`, ref: e.id, past: d < ymdOf(now), real: !!real });
  }
  for (const e of ev.filter((e) => e.kind === 'conv' && age(e) <= 30).slice(0, 2)) dates.push({ d: ymdOf(e.ms + 14 * DAY), t: `${ymdOf(e.ms)} 전환청구 → 추가 상장(보통 1~2주 뒤, 정확한 날은 원문 확인)`, ref: e.id, past: false });
  dates.sort((a, b) => (a.d < b.d ? -1 : 1));
  // 상승·하락 근거 점수는 각각 10점 만점 (근거가 많아 10점을 넘으면 10점으로 표시, 순위는 원래 합계로 비교)
  const upRaw = up.reduce((a, b) => a + b.w, 0), downRaw = down.reduce((a, b) => a + b.w, 0);
  const upS = Math.min(10, upRaw), downS = Math.min(10, downRaw);
  // 이미 크게 오른 종목(60일 저점 대비 +50% 이상)이나 띄우기·털기 단계는 '상승 가능성'으로 분류하지 않음
  const surged = (f.fromLow60 ?? 0) >= 50 || ['띄우기', '털기'].includes(x.stage);
  const dir = !surged && upRaw >= 3 && upRaw >= downRaw + 2 ? 'up' : downRaw >= 3 && (downRaw >= upRaw || surged) ? 'down' : 'none';
  const notes = [];
  if (surged && upS >= 3) notes.push('상승 근거도 있지만 이미 크게 오른 뒤(또는 띄우기·털기 단계)라 상승 가능성 분류에서 제외');
  for (const n of x.xnotes || []) notes.push(n);
  const restr = ev.find((e) => e.kind === 'rightsR');
  if (restr) notes.push(`${ymdOf(restr.ms)} 증자는 채권단·출자전환 등 구조조정 목적으로 보여 작전 신호에서 제외`);
  return { dir, upS, downS, upRaw, downRaw, net: upRaw - downRaw, notes, tgt, levels: lv.all, dates, up: up.sort((a, b) => b.w - a.w), down: down.sort((a, b) => b.w - a.w), cost: c ? { low: Math.round(c.low), high: Math.round(c.high) } : null, gap: gap == null ? null : Math.round(gap) };
}

// ───── AI 분석 (사실 번호 인용 강제 + 자동 검증: 확인 안 되는 문장·숫자는 버림) ─────
const numsIn = (t) => (String(t).match(/\d[\d,]*(\.\d+)?/g) || []).map((n) => n.replace(/,/g, '')).filter((n) => n.length >= 2 || Number(n) >= 10);
export function verifyLine(text, F) {
  const refs = [...String(text).matchAll(/\[?F(\d{1,2})\]?/g)].map((m) => 'F' + m[1]);
  const cited = F.filter((f) => refs.includes(f.id));
  if (!cited.length) return null; // 근거 번호 없는 문장은 버림
  const pool = F.map((f) => f.t).join(' ').replace(/,/g, '');
  for (const n of numsIn(String(text).replace(/\[?F\d{1,2}\]?/g, ''))) if (!pool.includes(n)) return null; // 사실 목록에 없는 숫자가 있으면 버림
  return { t: String(text).replace(/\s*\[?F\d{1,2}\]?/g, '').replace(/\s+([,.])/g, '$1').trim(), refs: cited.map((f) => f.id) };
}
async function aiReview(x) {
  const { askAI, parseJSON } = await import('./ai.mjs');
  const F = factsOf(x);
  const D = x.dir || direction(x);
  const prompt = `당신은 한국 증시 불공정거래(시세조종·무자본 M&A) 패턴을 연구하는 신중한 애널리스트입니다.
아래 '사실 목록'(F1, F2 …)만 근거로, 이 종목의 공시·거래 흐름이 작전 세력의 전형적 흐름(①판 깔기 ②매집 ③띄우기 ④털기)과 얼마나 비슷한지 설명하세요.
절대 규칙 (어기면 그 문장은 자동 삭제됨):
- 모든 문장 끝에 근거 사실 번호를 [F3]처럼 붙일 것. 번호 없는 문장은 버려짐.
- 사실 목록에 없는 숫자·날짜·회사명·사건을 절대 쓰지 말 것. 계산이나 추측 숫자도 금지(목록의 숫자만 그대로 인용).
- 모르면 쓰지 말 것. 부족한 정보는 "확인되지 않음"으로.
- 단정 금지("~로 보임", "~가능성"). 불법이라고 판단하지 말 것.
- 단계는 규칙으로 '${x.stage}'(으)로 판정됨. 단계를 바꾸지 말고 설명만 할 것.
- 규칙 판단 결과(방향: ${D.dir === 'up' ? '상승 가능성 쪽' : D.dir === 'down' ? '하락 위험 쪽' : '뚜렷하지 않음'})는 바꾸지 말고, 그 이유와 반대 근거를 설명할 것.
출력은 JSON 하나만:
{"stage":"판 깔기|매집|띄우기|털기|관찰","level":"높음|중간|낮음","summary":"2문장 요약, 각 문장 끝에 [F번호]","upWhy":["상승 쪽 근거 문장 [F번호]"],"downWhy":["하락 쪽 근거 문장 [F번호]"],"counter":["정상적인 회사 활동일 가능성 [F번호]"],"acc":{"period":"매집 추정 기간(사실 목록의 날짜만 사용)","refs":["F번호"]},"cost":{"refs":["평단 근거 F번호들"]},"watch":["앞으로 확인할 신호(숫자 없이)"]}
종목: ${x.name}(${x.code}) ${x.mkt === 'P' ? '코스피' : '코스닥'}
사실 목록:
${F.map((f) => `${f.id}. ${f.t} (출처: ${f.src})`).join('\n')}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 2200, timeout: 60000, tag: '작전 의심 레이더' }));
  const vlist = (a, n) => (Array.isArray(a) ? a : []).map((t) => verifyLine(t, F)).filter(Boolean).slice(0, n);
  const sum = vlist(String(j.summary || '').split(/(?<=[.다요음함]\s?\[F\d{1,2}\])\s*/).filter(Boolean), 3);
  // 평단: AI가 고른 근거 번호의 '가격'만으로 범위를 계산 (AI가 숫자를 지어낼 수 없게)
  const cps = (Array.isArray(j.cost?.refs) ? j.cost.refs : []).map((r) => F.find((f) => f.id === String(r).replace(/[^\dF]/g, '').replace(/^(\d)/, 'F$1'))?.price).filter((v) => v > 0);
  const cr = cps.length ? { low: Math.min(...cps), high: Math.max(...cps) } : D.cost;
  const accRefs = (Array.isArray(j.acc?.refs) ? j.acc.refs : []).map((r) => 'F' + String(r).replace(/\D/g, ''));
  const accOk = j.acc?.period && numsIn(j.acc.period).every((n) => accRefs.some((id) => F.find((f) => f.id === id)?.t.replace(/[-,]/g, '').includes(n.replace(/-/g, ''))) || F.some((f) => f.t.includes(n)));
  const dropped = ['upWhy', 'downWhy', 'counter'].reduce((a, k) => a + Math.max(0, (Array.isArray(j[k]) ? j[k].length : 0) - vlist(j[k], 9).length), 0);
  return {
    stage: ['판 깔기', '매집', '띄우기', '털기', '관찰'].includes(j.stage) ? j.stage : x.stage,
    level: ['높음', '중간', '낮음'].includes(j.level) ? j.level : '중간',
    summary: sum.map((s) => s.t).join(' ').slice(0, 260), sumRefs: [...new Set(sum.flatMap((s) => s.refs))],
    upWhy: vlist(j.upWhy, 6), downWhy: vlist(j.downWhy, 6), counter: vlist(j.counter, 3),
    watch: (Array.isArray(j.watch) ? j.watch : []).map((t) => String(t).slice(0, 80)).filter((t) => !numsIn(t).length).slice(0, 3), // 앞으로 볼 신호엔 숫자 금지
    cost: cr ? { low: Math.round(cr.low), high: Math.round(cr.high), basis: cps.length ? `공시·거래 사실 ${(j.cost.refs || []).join(', ')}의 가격 범위` : '공시 원문 가격·매집 구간 평균가 범위 (자동 계산)' } : null,
    acc: accOk ? { period: String(j.acc.period).slice(0, 60), basis: `근거 ${accRefs.join(', ')}` } : x.f?.accStart ? { period: `${x.f.accStart} ~ ${x.f.accEnd}`, basis: '거래 흐름 자동 계산 (OBV 최저점 ~ 첫 거래량 폭증 전)' } : null,
    facts: F.map((f) => ({ id: f.id, t: f.t, src: f.src, ref: f.id2 || null })),
    dropped, at: Date.now(),
  };
}

// ───── 저장 ─────
async function saveDay(date, list, extra = {}) {
  const doc = { date, at: Date.now(), n: list.length, list, ...extra };
  await setJSON(`mp/day/${date}`, doc);
  const idx = (await getJSON('mp/idx')) || [];
  if (!idx.includes(date)) { idx.unshift(date); idx.sort((a, b) => (a < b ? 1 : -1)); await setJSON('mp/idx', idx); } // 날짜 목록은 계속 쌓음 (지우지 않음)
  return doc;
}

const AI_TOP = 15;
/** 크론(3분마다) — 한 번에 한 단계씩 */
export async function manipWatch({ force = false } = {}) {
  const now = Date.now(), z = kst(now);
  const st = (await getJSON('mp/state')) || {};
  if (st.force && !force) force = true;
  if (!force && !st.date) force = true; // 처음 올린 뒤엔 시간과 상관없이 한 번 바로 분석
  if (!force) {
    if (!isTradingDay('KR', z.date) || z.m < 15 * 60 + 50) return null;
    if (st.date === z.date && st.phase === 'done') return null;
  }
  if (st.date !== z.date || (force && st.phase === 'done' && st.force)) Object.assign(st, { date: z.date, phase: 'snap', force: !!force, started: now, log: [] });
  const date = st.date;
  const log = (m) => { st.log = [...(st.log || []), `${kst().date.slice(5)} ${String(Math.floor(kst().m / 60)).padStart(2, '0')}:${String(kst().m % 60).padStart(2, '0')} ${m}`].slice(-30); };
  const out = { phase: st.phase };
  try {
    if (st.phase === 'snap') {
      const snap = await snapshot().catch((e) => { log('시세 목록 실패: ' + e.message); return {}; });
      await setJSON(`mp/snap/${date}`, { at: now, rows: snap });
      st.nSnap = Object.keys(snap).length;
      log(`전 종목 시세 ${st.nSnap}개`);
      st.phase = 'events';
    } else if (st.phase === 'events') {
      const ev = await loadEvents(now);
      const snap = (await getJSON(`mp/snap/${date}`))?.rows || {};
      const scored = [];
      for (const [code, evs] of Object.entries(ev)) {
        const s = eventScore(evs, now);
        if (s.score >= 2) scored.push({ code, es: s.score, by: s.by });
      }
      // 거래 급증 종목(공시 없어도): 거래대금/시총 회전율이 높고 크게 오른 종목
      const hot = Object.entries(snap).filter(([, r]) => r[6] && r[5] && (r[3] ?? 0) >= 10).map(([code, r]) => ({ code, turn: r[5] / r[6] })).sort((a, b) => b.turn - a.turn).slice(0, 40).map((x) => x.code);
      // 지난 기록에 나왔던 종목도 계속 추적 (최근 10거래일 상위)
      const idx = (await getJSON('mp/idx')) || [];
      const prev = [];
      for (const d of idx.filter((d) => d < date).slice(0, 5)) { const doc = await getJSON(`mp/day/${d}`); for (const x of (doc?.list || []).slice(0, 20)) prev.push(x.code); }
      const pick = [...new Set([...scored.sort((a, b) => b.es - a.es).slice(0, 140).map((x) => x.code), ...hot, ...prev])].filter((c) => !Object.keys(snap).length || snap[c]);
      try { await setJSON('mp/party', { at: now, idx: buildPartyIndex(ev, Object.fromEntries(NAMES)) }); } catch (e) { log('세력 연결 색인 실패: ' + e.message); }
      await setJSON(`mp/ev/${date}`, { ev: Object.fromEntries(pick.map((c) => [c, (ev[c] || []).slice(0, 25)])), names: Object.fromEntries(pick.map((c) => [c, NAMES.get(c) || null])) });
      st.queue = pick.slice(0, 220); st.pos = 0; st.feat = {};
      log(`공시 패턴 종목 ${scored.length}개 · 거래 급증 ${hot.length}개 → 후보 ${st.queue.length}개`);
      st.phase = 'bars';
    } else if (st.phase === 'bars') {
      const part = st.queue.slice(st.pos, st.pos + 30);
      const res = await Promise.all(part.map((c) => bars(c).then(barFeatures).catch(() => null)));
      part.forEach((c, i) => { if (res[i]) st.feat[c] = res[i]; });
      st.pos += part.length;
      if (st.pos >= st.queue.length) {
        // 점수 합치기
        const evDoc = (await getJSON(`mp/ev/${date}`)) || {};
        const ev = evDoc.ev || {};
        for (const [c, nm] of Object.entries(evDoc.names || {})) if (nm) NAMES.set(c, nm);
        const snap = (await getJSON(`mp/snap/${date}`))?.rows || {};
        const prevDoc = await (async () => { const idx = (await getJSON('mp/idx')) || []; const d = idx.find((x) => x < date); return d ? getJSON(`mp/day/${d}`) : null; })();
        const prevMap = new Map((prevDoc?.list || []).map((x) => [x.code, x]));
        const ctx = await ctxLoad(snap);
        const list = st.queue.map((code) => {
          const evs = ev[code] || [], s = eventScore(evs, now), f = st.feat[code] || null, r = snap[code] || [];
          const ex = extras(code, evs, s.by, ctx);
          const total = Math.round((s.score + (f?.score || 0) + ex.add) * ex.mult * 10) / 10;
          const p = prevMap.get(code);
          return { code, name: r[0] || p?.name || NAMES.get(code) || code, mkt: r[1] || p?.mkt || null, close: r[2] ?? f?.close ?? null, pct: r[3] ?? null, mcap: r[6] ?? null, score: total, es: s.score, vs: f?.score || 0, xs: ex.add, by: s.by, sig: [...(f?.sig || []), ...ex.sig], xnotes: ex.notes, links: ex.links, warn: ex.warn, ind: ex.ind, capPct: ex.capPct, mult: ex.mult, f, stage: stageOf(s.by, f), events: evs.slice(0, 15), streak: (p?.streak || 0) + 1, ai: null, px: [] };
        }).filter((x) => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 80);
        for (const x of list) x.dir = direction(x, now);
        // 이전 날 AI 결과는 그대로 이어 보여 주지 않음 (그날 다시 분석)
        st.list = list.map((x) => x.code);
        await saveDay(date, list, { building: true });
        await saveProfiles(list, `${date} 정기 분석 (1차: 공시·거래량)`); // 랭킹에 바로 보이게 (원문 가격·AI는 이어서 채움)
        st.docq = []; for (const x of list.slice(0, 30)) for (const e of x.events.filter((e) => ['cb', 'refix', 'rights3', 'rights', 'mna', 'fund5', 'pledge', 'majsell'].includes(e.kind) || (e.kind === 'risk' && /불성실공시/.test(e.title))).slice(0, 8)) st.docq.push({ code: x.code, e });
        st.dpos = 0;
        log(`일봉 분석 완료 → 의심 종목 ${list.length}개 (원문 가격 확인 ${st.docq.length}건)`);
        st.phase = 'docs';
      } else out.bars = `${st.pos}/${st.queue.length}`;
    } else if (st.phase === 'docs') {
      const part = (st.docq || []).slice(st.dpos, st.dpos + 20);
      const doc = await getJSON(`mp/day/${date}`);
      const got = [];
      for (let i = 0; i < part.length; i += 5) got.push(...(await Promise.all(part.slice(i, i + 5).map((q) => docPrice(q.e).catch(() => null)))));
      for (let gi = 0; gi < part.length; gi++) {
        const q = part[gi], p = got[gi];
        const x = doc?.list.find((y) => y.code === q.code);
        if (!x || !p) continue;
        if (p.p || p.cbx || p.pledge || p.pen) x.px.push({ p: p.p || null, pen: p.pen || undefined, label: p.label || (p.pen ? '불성실공시 벌점' : p.pledge ? '주식 담보' : 'CB 조건'), kind: p.kind, date: new Date(q.e.ms + 9 * 3600e3).toISOString().slice(0, 10), buys: p.buys || undefined, cbx: p.cbx || undefined, pledge: p.pledge || undefined, ref: q.e.id });
        // 제목만으론 몰랐던 '제3자배정' 증자 → 원문 확인 후 점수 다시 계산
        if ((p.third && q.e.kind === 'rights') || (p.restr && ['rights', 'rights3', 'rightsfix'].includes(q.e.kind))) {
          const ev = x.events.find((y) => y.id === q.e.id); if (ev) ev.kind = p.restr ? 'rightsR' : 'rights3';
          const s2 = eventScore(x.events, now); x.score = Math.round((s2.score + (x.vs || 0) + (x.xs || 0)) * (x.mult || 1) * 10) / 10; x.es = s2.score; x.by = s2.by; x.stage = stageOf(s2.by, x.f);
        }
      }
      st.dpos += part.length;
      if (doc) for (const x of doc.list) x.dir = direction(x, now); // 원문 가격 반영 후 다시
      if (doc) doc.list.sort((a, b) => b.score - a.score);
      if (doc) await setJSON(`mp/day/${date}`, doc);
      if (st.dpos >= (st.docq || []).length) { st.phase = 'ai'; st.apos = 0; log('원문 가격 확인 완료 → AI 분석 시작'); }
    } else if (st.phase === 'ai') {
      const doc = await getJSON(`mp/day/${date}`);
      const todo = (doc?.list || []).slice(0, AI_TOP).filter((x) => !x.ai).slice(0, 3);
      for (const x of todo) {
        try { x.ai = await aiReview(x); } catch (e) { x.ai = { error: String(e.message || e).slice(0, 120) }; }
      }
      if (doc) await setJSON(`mp/day/${date}`, doc);
      if (todo.length) await saveProfiles(todo, `${date} 정기 분석 · AI 판단`);
      if (!todo.length) {
        if (doc) { delete doc.building; doc.done = Date.now(); await setJSON(`mp/day/${date}`, doc); }
        st.phase = 'done'; st.force = false; log(`완료 · AI 분석 ${Math.min(AI_TOP, doc?.list?.length || 0)}개`);
      }
    }
  } catch (e) { st.err = String(e.message || e).slice(0, 200); log('오류: ' + st.err); }
  // 종목별 등장 기록·종목 카드(프로필)·랭킹 갱신 (지우지 않음)
  if (st.phase === 'done' && !st.histDone) {
    const doc = await getJSON(`mp/day/${date}`);
    for (const x of (doc?.list || []).slice(0, 40)) { const k = `mp/hist/${x.code}`; const h = (await getJSON(k)) || []; if (!h.some((y) => y.d === date)) { h.unshift({ d: date, s: x.score, st: x.stage }); await setJSON(k, h.slice(0, 200)); } }
    await saveProfiles(doc?.list || [], `${date} 장 마감 정기 분석`);
    st.histDone = date;
  }
  if (st.phase !== 'done') st.histDone = null;
  await setJSON('mp/state', st);
  out.next = st.phase;
  return out;
}

/** 관리자 화면: 날짜 목록 + 선택한 날 결과 + 진행 상태 */
export async function manipView(date) {
  const idx = (await getJSON('mp/idx')) || [];
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : idx[0];
  const doc = d ? await getJSON(`mp/day/${d}`) : null;
  const st = (await getJSON('mp/state')) || {};
  if (doc?.list) for (const x of doc.list.slice(0, 40)) x.hist = ((await getJSON(`mp/hist/${x.code}`)) || []).slice(0, 12);
  return { idx, date: d || null, doc, state: { date: st.date, phase: st.phase, bars: st.queue ? `${st.pos || 0}/${st.queue.length}` : null, log: (st.log || []).slice(-8), err: st.err || null } };
}
export async function manipState() {
  const st = (await getJSON('mp/state')) || {};
  const iq = (await getJSON('mp/iq')) || {};
  return { date: st.date, phase: st.phase, bars: st.queue ? `${st.pos || 0}/${st.queue.length}` : null, log: (st.log || []).slice(-8), err: st.err || null, incrQ: (iq.q || []).length, incrAi: iq.ai || 0 };
}
export async function manipStart() {
  const st = (await getJSON('mp/state')) || {};
  const today = kst().date;
  if (st.date === today && st.phase && st.phase !== 'done') return { already: true, phase: st.phase };
  await setJSON('mp/state', { ...st, date: null, phase: null, force: true });
  return manipWatch({ force: true });
}


// ───── 종목 카드(프로필) · 랭킹 ─────
//  mp/prof/{코드}: 그 종목의 최신 종합 판단 (새 공시가 나오면 자동으로 다시 계산·수정) + 변경 기록
//  mp/rank: 전 종목 요약 (랭킹 화면)
const LV = { 높음: 3, 중간: 2, 낮음: 1 };
function rankRow(x) {
  const a = x.ai && !x.ai.error ? x.ai : null;
  const d = x.dir || direction(x);
  const nd = (d.dates || []).find((z) => !z.past);
  const pn = penaltyOf(x);
  return { pn: pn ? { c: pn.cum, pd: pn.pend, u: pn.unknown } : null, wn: x.warn?.lv || null, lk: (x.links || []).length || null, fl: x.f?.fromLow60 ?? null, d: d.dir, us: d.upS, ds: d.downS, nr: d.net ?? null, nt: d.notes?.length ? d.notes : null, tg: d.tgt ? d.tgt.map((t) => ({ p: t.p, s: t.s })) : null, nd: nd ? `${nd.d} ${nd.t.split(' ')[1] === 'CB' ? 'CB 전환 가능' : nd.t.includes('신주') ? '신주 매도 가능' : '추가 상장'}${nd.real ? '' : '(추정)'}` : null, ur: d.up.slice(0, 2).map((r) => r.t), dr: d.down.slice(0, 2).map((r) => r.t), gap: d.gap, n: x.name, m: x.mkt, s: x.score, st: x.stage, lv: a?.level || null, c: x.close, pct: x.pct, cl: a?.cost?.low ?? d.cost?.low ?? null, ch: a?.cost?.high ?? d.cost?.high ?? null, va: x.f?.vwapAcc ?? null, acc: a?.acc?.period || (x.f?.accStart ? `${x.f.accStart} ~ ${x.f.accEnd}` : null), up: Date.now(), sum: a?.summary?.slice(0, 120) || null };
}
async function saveProfiles(list, reason, opt = {}) {
  const rank = (await getJSON('mp/rank')) || {};
  const alerts = [];
  const DK = { up: '📈 상승 가능성', down: '📉 하락 위험' };
  for (const x of list) {
    const k = `mp/prof/${x.code}`;
    const prev = (await getJSON(k)) || {};
    // 분류 흔들림 방지: 점수가 경계선 근처에서 조금 바뀐 것만으로는 상승/하락 분류를 뒤집지 않음
    x.dir = x.dir || direction(x);
    const pd0 = prev.dir?.dir;
    if (pd0 && pd0 !== x.dir.dir) {
      const surged = (x.f?.fromLow60 ?? 0) >= 50 || ['띄우기', '털기'].includes(x.stage);
      const keepUp = pd0 === 'up' && !surged && x.dir.upS >= 2 && x.dir.upS >= x.dir.downS + 1;
      const keepDown = pd0 === 'down' && x.dir.downS >= 2 && x.dir.downS >= x.dir.upS;
      if (keepUp || keepDown) x.dir = { ...x.dir, dir: pd0, sticky: true };
    }
    if (prev.at) { // 처음 들어온 종목은 알림 안 함 (첫 분석 때 알림 폭탄 방지)
      const nd = x.dir.dir, pd = prev.dir?.dir;
      if (prev.stage && prev.stage !== x.stage && ['매집', '띄우기', '털기'].includes(x.stage)) alerts.push(`• ${x.name} 단계 ${prev.stage} → ${x.stage} (점수 ${prev.score}→${x.score})`);
      if (nd !== pd && DK[nd]) alerts.push(`• ${x.name} ${DK[nd]}로 분류 변경`);
      const newConv = (x.events || []).filter((e) => e.kind === 'conv' && !(prev.events || []).some((y) => y.id === e.id));
      if (newConv.length) alerts.push(`• ${x.name} 전환청구 공시 — 1~2주 뒤 추가 상장 물량 주의`);
    }
    const log = prev.log || [];
    const changed = !prev.at || prev.score !== x.score || prev.stage !== x.stage || (prev.ai?.level || null) !== (x.ai?.level || null);
    if (changed) log.unshift({ at: Date.now(), msg: `${reason} · 점수 ${prev.score ?? '-'}→${x.score} · ${prev.stage || '-'}→${x.stage}${x.ai?.level ? ` · 의심 ${x.ai.level}` : ''}` });
    const ai = x.ai && !x.ai.error ? x.ai : prev.ai || null; // 이번에 AI를 못 돌렸으면 이전 분석 유지
    const prof = { ...x, ai, hist: undefined, first: prev.first || Date.now(), at: Date.now(), log: log.slice(0, 60) };
    await setJSON(k, prof);
    if (opt.rank !== false) rank[x.code] = rankRow(prof);
  }
  await setJSON('mp/rank', rank);
  if (alerts.length) await radarAlert(alerts).catch(() => {});
}
export async function manipRank(kind = 'all') {
  const rank = (await getJSON('mp/rank')) || {};
  let list = Object.entries(rank).map(([code, r]) => ({ code, ...r }))
    .filter((r) => Date.now() - (r.up || 0) < 45 * DAY); // 45일 넘게 신호가 없던 종목은 랭킹에서만 내림 (카드·기록은 남김)
  // 예전 기준으로 저장된 줄도 새 기준(급등·털기 종목은 상승 가능성 제외)으로 다시 거름
  for (const r of list) if (r.d === 'up' && (['띄우기', '털기'].includes(r.st) || (r.fl ?? 0) >= 50)) r.d = 'none';
  if (kind === 'up') list = list.filter((r) => r.d === 'up').sort((a, b) => (b.nr ?? (b.us || 0) - (b.ds || 0)) - (a.nr ?? (a.us || 0) - (a.ds || 0)) || (b.us || 0) - (a.us || 0) || (a.gap ?? 0) - (b.gap ?? 0));
  else if (kind === 'down') list = list.filter((r) => r.d === 'down').sort((a, b) => -(b.nr ?? (b.us || 0) - (b.ds || 0)) + (a.nr ?? (a.us || 0) - (a.ds || 0)) || (b.ds || 0) - (a.ds || 0) || b.s - a.s);
  else list.sort((a, b) => (LV[b.lv] || 0) - (LV[a.lv] || 0) || b.s - a.s);
  return list.slice(0, 150);
}
export async function manipProfile(code) {
  const p = await getJSON(`mp/prof/${code}`);
  if (p) p.hist = ((await getJSON(`mp/hist/${code}`)) || []).slice(0, 30);
  return p;
}

// ───── 장중 자동 갱신: 새 공시가 나오면 그 종목을 전체 공시·거래량과 함께 다시 판단 ─────
async function eventsOf(code, now) {
  const since = now - 180 * DAY;
  const out = [];
  const add = (r) => { const k = evKind(`${r.f || ''} ${r.t || ''}`, r.p); if (k) out.push({ ms: r.ms, kind: k, title: String(r.f || r.t || '').slice(0, 80), sum: [r.st, r.ss].filter(Boolean).join(' · ').slice(0, 140), id: r.id, party: r.p || null }); };
  const d = await sqlDB().catch(() => null);
  if (d) {
    const r = await d.prepare("SELECT id, ms, title AS t, json_extract(data,'$.formKo') AS f, json_extract(data,'$.party') AS p, json_extract(data,'$.summary.title') AS st, json_extract(data,'$.summary.sub') AS ss FROM items WHERE market = 'KR' AND ticker = ? AND src = 'DART' AND ms > ? ORDER BY ms DESC LIMIT 300").bind(code, since).all();
    for (const row of r.results || []) add(row);
  } else {
    const { queryArchive } = await import('./archive.mjs');
    for (const x of await queryArchive({ kind: 'FILING', market: 'KR', ticker: code, limit: 200 })) add({ id: x.id, ms: Date.parse(`${x.date || ''}T12:00:00+09:00`) || x.approxMs || now, t: x.titleClean, f: x.formKo, p: x.party, st: x.summary?.title, ss: x.summary?.sub });
  }
  // 방금 나와서 아직 보관소에 없을 수 있는 공시 (실시간 목록)
  const feed = (await getJSON('dart/feed').catch(() => null))?.items || [];
  for (const x of feed) if (x.ticker === code && !out.some((e) => e.id === x.id)) add({ id: x.id, ms: Date.parse(`${x.date || ''}T12:00:00+09:00`) || now, t: x.titleClean, f: x.formKo, p: x.party, st: x.summary?.title, ss: x.summary?.sub });
  return out.sort((a, b) => b.ms - a.ms);
}
/** 한 종목을 정기 분석과 똑같은 방식으로 판단 (공시 180일 · 일봉 · 원문 가격 · 보정 · 단계 · 상승/하락 · AI) */
async function analyzeOne(job, { snap = {}, ctx = null, now = Date.now(), aiOk = () => false, aiUsed = () => {}, forceAi = false, keepLow = false } = {}) {
  const code = job.c;
  const evs = await eventsOf(code, now);
  const s = eventScore(evs, now);
  let f = null; try { f = barFeatures(await bars(code)); } catch {}
  const prev = (await getJSON(`mp/prof/${code}`)) || null;
  const r = snap[code] || [];
  const ex = extras(code, evs, s.by, ctx || {});
  const score = Math.round((s.score + (f?.score || 0) + ex.add) * ex.mult * 10) / 10;
  if (score < 4 && !prev && !keepLow) return null; // 원래 레이더에 없던 종목이고 점수도 낮으면 넘김
  const x = { code, name: r[0] || (prev?.name && prev.name !== code ? prev.name : null) || job.name || code, mkt: r[1] || prev?.mkt || job.mkt || null, close: f?.close ?? r[2] ?? null, pct: r[3] ?? prev?.pct ?? null, mcap: r[6] ?? prev?.mcap ?? null, score, es: s.score, vs: f?.score || 0, xs: ex.add, mult: ex.mult, by: s.by, sig: [...(f?.sig || []), ...ex.sig], xnotes: ex.notes, links: ex.links, warn: ex.warn, ind: ex.ind, capPct: ex.capPct, f, stage: stageOf(s.by, f), events: evs.slice(0, 15), streak: prev?.streak || 1, px: [], ai: prev?.ai || null };
  // 공시 원문 가격 (새 공시 포함)
  for (const e of evs.filter((e) => ['cb', 'refix', 'rights3', 'rights', 'mna', 'fund5', 'pledge', 'majsell'].includes(e.kind) || (e.kind === 'risk' && /불성실공시/.test(e.title))).slice(0, 8)) {
    const p = await docPrice(e).catch(() => null);
    if (p?.p || p?.cbx || p?.pledge || p?.pen) x.px.push({ p: p.p || null, pen: p.pen || undefined, label: p.label || (p.pen ? '불성실공시 벌점' : p.pledge ? '주식 담보' : 'CB 조건'), kind: p.kind, date: new Date(e.ms + 9 * 3600e3).toISOString().slice(0, 10), buys: p.buys || undefined, cbx: p.cbx || undefined, pledge: p.pledge || undefined, ref: e.id });
    if (p?.restr && ['rights', 'rights3', 'rightsfix'].includes(e.kind)) e.kind = 'rightsR';
    else if (p?.third && e.kind === 'rights') e.kind = 'rights3';
  }
  const s2 = eventScore(x.events.concat(evs.slice(15)), now); x.es = s2.score; x.by = s2.by; x.score = Math.round((s2.score + x.vs + (x.xs || 0)) * (x.mult || 1) * 10) / 10; x.stage = stageOf(s2.by, f);
  x.dir = direction(x, now);
  // 공시가 바뀌었고 점수가 의미 있으면 AI 다시 (검색은 항상)
  const sig = evs.slice(0, 25).map((e) => e.id).join(',');
  if (((forceAi && (f || evs.length)) || (x.score >= 6 && sig !== prev?.evSig)) && aiOk()) {
    try { x.ai = await aiReview(x); aiUsed(); } catch (e) { x.ai = prev?.ai || { error: String(e.message || e).slice(0, 120) }; }
  }
  x.evSig = sig;
  x.dir = direction(x, now);
  return x;
}

// ───── 관리자 종목 검색: 랭킹에 없는 종목도 지금 바로 같은 방식으로 분석 ─────
const AI_LOOKUP_DAY = 40;
export async function manipLookup(code, { name = null, refresh = false } = {}) {
  code = String(code || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(code)) throw new Error('종목코드 6자리가 필요해요');
  const now = Date.now(), z = kst(now);
  const prev = await getJSON(`mp/prof/${code}`);
  // 최근 3시간 안에 분석했고 그 뒤 새 공시가 없으면 저장된 결과 그대로 (다시 분석 버튼으로 강제 가능)
  if (prev && !refresh && now - (prev.at || 0) < 3 * 3600e3) return { prof: await manipProfile(code), cached: true };
  const lk = (await getJSON('mp/lookup')) || { day: '', ai: 0 };
  if (lk.day !== z.date) { lk.day = z.date; lk.ai = 0; }
  const idx = (await getJSON('mp/idx')) || [];
  const snap = (await getJSON(`mp/snap/${idx[0] || z.date}`))?.rows || {};
  const ctx = await ctxLoad(snap);
  const x = await analyzeOne({ c: code, name }, { snap, ctx, now, forceAi: true, keepLow: true, aiOk: () => lk.ai < AI_LOOKUP_DAY, aiUsed: () => { lk.ai++; } });
  await setJSON('mp/lookup', lk);
  // 일봉·공시를 잠깐 못 받아 온 경우: 이전 분석을 망가뜨리지 않고 그대로 둠
  if (prev && ((!x.f && prev.f) || (!x.events.length && (prev.events || []).length))) return { prof: await manipProfile(code), cached: true, keptOld: true, aiLeft: Math.max(0, AI_LOOKUP_DAY - lk.ai), inRank: !!(await getJSON('mp/rank'))?.[code], aiErr: '이번에 일봉 또는 공시 데이터를 받지 못해, 이전 분석 결과를 그대로 보여드려요. 잠시 뒤 다시 분석해 보세요.' };
  x.manual = true;
  // 점수 4점 이상이면 랭킹에도 올림(정기 분석과 같은 기준), 낮으면 종목 카드만 저장 (이미 랭킹에 있던 종목은 갱신)
  const inRank = x.score >= 4 || !!(await getJSON('mp/rank'))?.[code];
  await saveProfiles([x], '관리자 검색으로 분석', { rank: inRank });
  return { prof: await manipProfile(code), cached: false, aiLeft: Math.max(0, AI_LOOKUP_DAY - lk.ai), inRank, aiErr: x.ai?.error || (lk.ai >= AI_LOOKUP_DAY ? '오늘 검색 AI 분석 횟수(40회)를 다 써서 AI 없이 규칙 분석만 했어요' : null), noBars: !x.f };
}
const AI_INCR_DAY = 30;
export async function manipIncr() {
  const now = Date.now(), z = kst(now);
  if (z.m < 7 * 60 || z.m > 23 * 60) return null;
  const st = (await getJSON('mp/state')) || {};
  if (st.phase && st.phase !== 'done' && st.date === z.date) return null; // 정기 분석 중엔 쉼
  const iq = (await getJSON('mp/iq')) || { seen: [], q: [], day: '', ai: 0 };
  if (iq.day !== z.date) { iq.day = z.date; iq.ai = 0; }
  const seen = new Set(iq.seen);
  const feed = (await getJSON('dart/feed').catch(() => null))?.items || [];
  for (const x of feed) {
    if (!x.id || seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.ticker && /^\d{6}$/.test(x.ticker) && evKind(`${x.formKo || ''} ${x.titleClean || ''} ${x.summary?.title || ''}`, x.party)) {
      if (!iq.q.some((y) => y.c === x.ticker)) iq.q.push({ c: x.ticker, name: x.name || null, why: String(x.formKo || x.titleClean || '').slice(0, 60), at: now });
    }
  }
  iq.seen = [...seen].slice(-1500);
  const out = { n: 0 };
  const part = iq.q.splice(0, 3);
  const snapIdx = (await getJSON('mp/idx')) || [];
  const snap = (await getJSON(`mp/snap/${snapIdx[0] || z.date}`))?.rows || {};
  const ctxI = part.length ? await ctxLoad(snap) : null;
  for (const job of part) {
    try {
      const x = await analyzeOne(job, { snap, ctx: ctxI, now, aiOk: () => iq.ai < AI_INCR_DAY, aiUsed: () => { iq.ai++; } });
      if (!x) continue;
      await saveProfiles([x], `새 공시 반영: ${job.why}`);
      out.n++;
    } catch (e) { out.err = String(e.message || e).slice(0, 120); }
  }
  await setJSON('mp/iq', iq);
  out.left = iq.q.length;
  return out.n || out.err ? out : null;
}

// 보조 작업 (크론): 시장경보 수집(6시간마다) · 성적표 채우기
export async function manipAux() {
  const out = {};
  try {
    const { warnWatch, perfWatch } = await import('./manipx.mjs');
    const idx = (await getJSON('mp/idx')) || [];
    const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
    const n2c = {}; for (const [c, r] of Object.entries(snap)) if (r[0]) n2c[r[0]] = c;
    const w = await warnWatch(n2c); if (w) out.warn = w;
    const p = await perfWatch(15); if (p) out.perf = p;
  } catch (e) { out.err = String(e.message || e).slice(0, 120); }
  return Object.keys(out).length ? out : null;
}

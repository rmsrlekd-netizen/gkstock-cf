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
  const f = {
    close: last.c, date: last.d,
    ret5: r1(ret(5)), ret20: r1(ret(20)), ret60: r1(ret(60)),
    fromLow60: r1((last.c / lo60 - 1) * 100), offHigh20: r1((last.c / hi20 - 1) * 100),
    volX5: base60 ? r1(v5 / base60) : null, volX20: base60 ? r1(v20 / base60) : null, maxVolX10: base60 ? r1(maxV10 / base60) : null,
    box60: r1((bmax / bmin - 1) * 100),
    spikeDate: spike > 0 ? B[spike].d : null,
    accStart: B[accStartI]?.d || null, accEnd: B[Math.max(0, accEnd - 1)]?.d || null, accDays: accRows.length,
    accObv: vsum ? r1((obv2 / vsum) * 100) : null, // 매집 구간 순매수 강도(%)
    accLow: accRows.length ? Math.min(...accRows.map((x) => x.l)) : null, accHigh: accRows.length ? Math.max(...accRows.map((x) => x.h)) : null,
    vwapAcc: accRows.length >= 10 ? Math.round(vwap(accRows)) : null, // 매집 구간(추정 시작일~폭증 전) 평균 체결가(거래량 가중)
    vwapHeavy: heavy.length >= 3 ? Math.round(vwap(heavy)) : null, // 거래량이 평소 2배 넘던 날들의 평균 체결가
    vwap120: Math.round(vwap(B.slice(-120))),
  };
  // 패턴 점수
  const sig = [];
  let s = 0;
  const quiet = f.box60 != null && f.box60 < 40 && Math.abs(f.ret20 ?? 0) < 15;
  if ((f.accObv ?? 0) >= 15 && (f.accDays ?? 0) >= 30) { s += 1; sig.push(`매집 구간 순매수 흔적 (${f.accStart} 부터 추정)`); }
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
  let p = null, label = null, third = false;
  try {
    const { fetchDartDoc, summarizeDart } = await import('./dart-doc.mjs');
    const L = await fetchDartDoc(String(e.id).replace(/^DART-/, ''));
    const s = summarizeDart(e.title, L);
    third = /제3자|3자배정/.test(`${s?.title || ''} ${L.slice(0, 120).join(' ')}`);
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
    if (!p) { // 조정 공시·양수도: '조정 후 전환가액', '1주당 (양수도)가액' 줄 다음 숫자
      const i = L.findIndex((x) => /조정\s*후\s*(전환|행사|교환)가액|1주당\s*(양수도|매매|취득)?\s*가[액격]|주당\s*양수도\s*가액/.test(x));
      if (i >= 0) for (let k = i; k < i + 4 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{3,}/) || [])[0]); if (v && v >= 50 && v < 5e6) { p = v; label = /조정/.test(L[i]) ? '조정 전환가' : '양수도 단가'; break; } }
    }
  } catch {}
  const out = { p, label, kind: e.kind, at: e.ms, third, buys: e.buys || null };
  await setJSON(ck, out).catch(() => {});
  return out;
}

// ───── 단계 판정 (AI 전 기본값) ─────
function stageOf(by, f) {
  const exit = (by.conv || 0) + (by.majsell || 0) + (by.pledge || 0);
  const setup = (by.mna || 0) + (by.rights3 || 0) + (by.cb || 0) + (by.fund5 || 0) + (by.purpose || 0) + (by.refix || 0);
  if (f && (f.fromLow60 ?? 0) >= 50 && ((f.offHigh20 ?? 0) <= -20 || exit >= 3)) return '털기';
  if (f && ((f.fromLow60 ?? 0) >= 50 || (f.maxVolX10 ?? 0) >= 10)) return '띄우기';
  if (f && (f.box60 ?? 99) < 40 && (f.volX20 ?? 0) >= 1.5) return '매집';
  if (setup >= 3) return '판 깔기';
  return '관찰';
}

// ───── AI 분석 ─────
async function aiReview(x) {
  const { askAI, parseJSON } = await import('./ai.mjs');
  const evs = (x.events || []).slice(0, 20).map((e) => `${new Date(e.ms + 9 * 3600e3).toISOString().slice(0, 10)} [${EV[e.kind]?.ko}] ${e.title}${e.sum ? ' — ' + e.sum : ''}${e.party ? ` (제출인 ${e.party})` : ''}`);
  const prompt = `당신은 한국 증시 불공정거래(시세조종·무자본 M&A) 패턴을 연구하는 애널리스트입니다. 아래 종목의 공시·거래 데이터를 보고 '작전 세력 패턴'과 얼마나 비슷한지 냉정하게 평가하세요.
전형적 흐름: ①판 깔기(무자본 M&A·최대주주 변경, 투자조합 대상 3자배정 증자, 사모 CB 반복 발행·전환가 리픽싱, 테마성 사업목적 추가) → ②매집(소형·저유동성 종목이 박스권에서 거래량이 서서히 늘어남) → ③띄우기(테마 뉴스·공급계약·MOU 공시와 거래량 폭증, 계단식 급등, 조회공시) → ④털기(CB 전환청구·추가상장, 최대주주·조합 장내 매도, 담보 반대매매, 급락).
규칙:
- 주어진 데이터만 근거로 판단. 없는 사실을 지어내지 말 것. 정상적인 자금조달·사업일 가능성(반대 근거)도 반드시 함께 적을 것.
- 이것은 의심 신호이지 불법의 증거가 아님. 단정 표현 금지("~로 보임", "~가능성").
- 세력 평단가 추정: 전환가·3자배정 발행가·양수도 단가·5% 보고서 장내 취득 단가(있으면 가장 직접적인 근거) + 매집 구간 거래량 가중 평균가(vwapAcc)·고거래량일 평균가(vwapHeavy)를 종합해 원 단위 범위로. 근거를 한 줄로.
- 매집 시기 추정: 거래 패턴의 accStart~accEnd(OBV 최저점 이후 ~ 첫 거래량 폭증 전), 5% 보고서 취득일, 증자 납입·CB 발행·최대주주 변경 시점을 종합해 "2026년 7월 중순 ~ 9월 말" 같은 기간으로.
- 공시와 거래량을 함께 종합해 판단 (새 공시가 추가되면 전체 흐름 속에서 다시 평가).
출력은 JSON 하나만:
{"stage":"판 깔기|매집|띄우기|털기|관찰","level":"높음|중간|낮음","summary":"2~3문장 요약(150자 이내)","acc":{"period":"매집 추정 기간","basis":"근거(80자 이내)"},"evidence":["의심 근거 3~5개(각 60자 이내)"],"counter":["반대 근거 1~3개"],"cost":{"low":숫자,"high":숫자,"basis":"추정 근거(80자 이내)"},"gap":"현재가와 추정 평단의 관계 한 줄","watch":["앞으로 볼 신호 2~3개"]}
종목: ${x.name}(${x.code}) ${x.mkt === 'P' ? '코스피' : '코스닥'} · 종가 ${x.close?.toLocaleString('ko-KR')}원 (${x.pct > 0 ? '+' : ''}${x.pct ?? '-'}%) · 시가총액(네이버 표기) ${x.mcap ?? '-'}
거래 패턴: ${JSON.stringify(x.f || {})}
공시에서 찾은 가격: ${JSON.stringify(x.px || [])}
최근 180일 주요 공시:
${evs.join('\n') || '(없음)'}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 1800, timeout: 60000, tag: '작전 의심 레이더' }));
  const arr = (a, n) => (Array.isArray(a) ? a : []).map((s) => String(s).slice(0, 90)).filter(Boolean).slice(0, n);
  return {
    stage: ['판 깔기', '매집', '띄우기', '털기', '관찰'].includes(j.stage) ? j.stage : x.stage,
    level: ['높음', '중간', '낮음'].includes(j.level) ? j.level : '중간',
    summary: String(j.summary || '').slice(0, 220), evidence: arr(j.evidence, 5), counter: arr(j.counter, 3), watch: arr(j.watch, 3),
    cost: j.cost && (n0(j.cost.low) || n0(j.cost.high)) ? { low: n0(j.cost.low), high: n0(j.cost.high), basis: String(j.cost.basis || '').slice(0, 120) } : null,
    gap: String(j.gap || '').slice(0, 100), at: Date.now(),
    acc: j.acc?.period ? { period: String(j.acc.period).slice(0, 60), basis: String(j.acc.basis || '').slice(0, 120) } : null,
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
        const list = st.queue.map((code) => {
          const evs = ev[code] || [], s = eventScore(evs, now), f = st.feat[code] || null, r = snap[code] || [];
          const total = Math.round((s.score + (f?.score || 0)) * 10) / 10;
          const p = prevMap.get(code);
          return { code, name: r[0] || p?.name || NAMES.get(code) || code, mkt: r[1] || p?.mkt || null, close: r[2] ?? f?.close ?? null, pct: r[3] ?? null, mcap: r[6] ?? null, score: total, es: s.score, vs: f?.score || 0, by: s.by, sig: f?.sig || [], f, stage: stageOf(s.by, f), events: evs.slice(0, 15), streak: (p?.streak || 0) + 1, ai: null, px: [] };
        }).filter((x) => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 80);
        // 이전 날 AI 결과는 그대로 이어 보여 주지 않음 (그날 다시 분석)
        st.list = list.map((x) => x.code);
        await saveDay(date, list, { building: true });
        await saveProfiles(list, `${date} 정기 분석 (1차: 공시·거래량)`); // 랭킹에 바로 보이게 (원문 가격·AI는 이어서 채움)
        st.docq = []; for (const x of list.slice(0, 30)) for (const e of x.events.filter((e) => ['cb', 'refix', 'rights3', 'rights', 'mna', 'fund5'].includes(e.kind)).slice(0, 5)) st.docq.push({ code: x.code, e });
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
        if (p.p) x.px.push({ p: p.p, label: p.label, kind: p.kind, date: new Date(q.e.ms + 9 * 3600e3).toISOString().slice(0, 10), buys: p.buys || undefined });
        // 제목만으론 몰랐던 '제3자배정' 증자 → 원문 확인 후 점수 다시 계산
        if (p.third && q.e.kind === 'rights') {
          const ev = x.events.find((y) => y.id === q.e.id); if (ev) ev.kind = 'rights3';
          const s2 = eventScore(x.events, now); x.score = Math.round((x.score - x.es + s2.score) * 10) / 10; x.es = s2.score; x.by = s2.by; x.stage = stageOf(s2.by, x.f);
        }
      }
      st.dpos += part.length;
      if (doc) doc.list.sort((a, b) => b.score - a.score);
      if (doc) await setJSON(`mp/day/${date}`, doc);
      if (st.dpos >= (st.docq || []).length) { st.phase = 'ai'; st.apos = 0; log('원문 가격 확인 완료 → AI 분석 시작'); }
    } else if (st.phase === 'ai') {
      const doc = await getJSON(`mp/day/${date}`);
      const todo = (doc?.list || []).slice(0, AI_TOP).filter((x) => !x.ai).slice(0, 3);
      for (const x of todo) {
        try { x.ai = await aiReview(x); if (x.ai.stage) x.stage = x.ai.stage; } catch (e) { x.ai = { error: String(e.message || e).slice(0, 120) }; }
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
  return { n: x.name, m: x.mkt, s: x.score, st: x.stage, lv: a?.level || null, c: x.close, pct: x.pct, cl: a?.cost?.low ?? null, ch: a?.cost?.high ?? null, va: x.f?.vwapAcc ?? null, acc: a?.acc?.period || (x.f?.accStart ? `${x.f.accStart} ~ ${x.f.accEnd}` : null), up: Date.now(), sum: a?.summary?.slice(0, 120) || null };
}
async function saveProfiles(list, reason) {
  const rank = (await getJSON('mp/rank')) || {};
  for (const x of list) {
    const k = `mp/prof/${x.code}`;
    const prev = (await getJSON(k)) || {};
    const log = prev.log || [];
    const changed = !prev.at || prev.score !== x.score || prev.stage !== x.stage || (prev.ai?.level || null) !== (x.ai?.level || null);
    if (changed) log.unshift({ at: Date.now(), msg: `${reason} · 점수 ${prev.score ?? '-'}→${x.score} · ${prev.stage || '-'}→${x.stage}${x.ai?.level ? ` · 의심 ${x.ai.level}` : ''}` });
    const ai = x.ai && !x.ai.error ? x.ai : prev.ai || null; // 이번에 AI를 못 돌렸으면 이전 분석 유지
    const prof = { ...x, ai, hist: undefined, first: prev.first || Date.now(), at: Date.now(), log: log.slice(0, 60) };
    await setJSON(k, prof);
    rank[x.code] = rankRow(prof);
  }
  await setJSON('mp/rank', rank);
}
export async function manipRank() {
  const rank = (await getJSON('mp/rank')) || {};
  const list = Object.entries(rank).map(([code, r]) => ({ code, ...r }))
    .filter((r) => Date.now() - (r.up || 0) < 45 * DAY) // 45일 넘게 신호가 없던 종목은 랭킹에서만 내림 (카드·기록은 남김)
    .sort((a, b) => (LV[b.lv] || 0) - (LV[a.lv] || 0) || b.s - a.s);
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
  for (const job of part) {
    try {
      const code = job.c;
      const evs = await eventsOf(code, now);
      const s = eventScore(evs, now);
      let f = null; try { f = barFeatures(await bars(code)); } catch {}
      const prev = (await getJSON(`mp/prof/${code}`)) || null;
      const r = snap[code] || [];
      const score = Math.round((s.score + (f?.score || 0)) * 10) / 10;
      if (score < 4 && !prev) continue; // 원래 레이더에 없던 종목이고 점수도 낮으면 넘김
      const x = { code, name: r[0] || (prev?.name && prev.name !== code ? prev.name : null) || job.name || code, mkt: r[1] || prev?.mkt || null, close: f?.close ?? r[2] ?? null, pct: prev?.pct ?? r[3] ?? null, mcap: r[6] ?? prev?.mcap ?? null, score, es: s.score, vs: f?.score || 0, by: s.by, sig: f?.sig || [], f, stage: stageOf(s.by, f), events: evs.slice(0, 15), streak: prev?.streak || 1, px: [], ai: prev?.ai || null };
      // 공시 원문 가격 (새 공시 포함)
      for (const e of evs.filter((e) => ['cb', 'refix', 'rights3', 'rights', 'mna', 'fund5'].includes(e.kind)).slice(0, 5)) {
        const p = await docPrice(e);
        if (p?.p) x.px.push({ p: p.p, label: p.label, kind: p.kind, date: new Date(e.ms + 9 * 3600e3).toISOString().slice(0, 10), buys: p.buys || undefined });
        if (p?.third && e.kind === 'rights') e.kind = 'rights3';
      }
      const s2 = eventScore(x.events.concat(evs.slice(15)), now); x.es = s2.score; x.by = s2.by; x.score = Math.round((s2.score + x.vs) * 10) / 10; x.stage = stageOf(s2.by, f);
      // 공시가 바뀌었고 점수가 의미 있으면 AI 다시 (하루 최대 30회)
      const sig = evs.slice(0, 25).map((e) => e.id).join(',');
      if (x.score >= 6 && sig !== prev?.evSig && iq.ai < AI_INCR_DAY) {
        try { x.ai = await aiReview(x); if (x.ai.stage) x.stage = x.ai.stage; iq.ai++; } catch (e) { x.ai = prev?.ai || { error: String(e.message || e).slice(0, 120) }; }
      }
      x.evSig = sig;
      await saveProfiles([x], `새 공시 반영: ${job.why}`);
      out.n++;
    } catch (e) { out.err = String(e.message || e).slice(0, 120); }
  }
  await setJSON('mp/iq', iq);
  out.left = iq.q.length;
  return out.n || out.err ? out : null;
}

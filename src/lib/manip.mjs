// 작전 의심 레이더 (관리자 전용) — 국장 전 종목(코스피·코스닥 개별 종목, ETF·ETN·거래정지 제외)을
//  ① DART 공시 패턴(무자본 M&A·3자배정 증자·CB 남발·전환가 조정·사업목적 추가·투자조합 지분·전환청구 …)
//  ② 거래량·주가 패턴(박스권 매집·거래량 폭증·급등 후 이탈)
//  으로 점수를 매기고, 상위 종목은 AI가 단계(판 깔기·매집·띄우기·털기)와 '세력 평단가'를 추정
//  · 결과는 날짜별로 영구 보관 (mp/day/YYYY-MM-DD, 지우지 않음) — 관리자 화면에서 날짜를 골라 다시 볼 수 있음
//  · 크론(3분마다)이 장 마감 뒤(15:50~) 단계별로 조금씩 진행: 전 종목 시세 → 공시 → 후보 일봉 → 원문 가격 → AI
//  ※ '패턴이 비슷하다'는 신호일 뿐 불공정거래의 증거가 아님. 외부 공개 금지(관리자 화면 전용)
import { getJSON, setJSON, sqlDB, getJSONStrict, delKeys } from './store.mjs';
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
  // 점수 없이 체크리스트·근거에만 쓰는 공시
  paid:      { w: 0, cap: 0, stage: 'none', ko: '증자·사채 납입·발행 완료' },
  fail:      { w: 0, cap: 0, stage: 'risk', ko: '증자·사채·양수도 철회·해제·납입 연기' },
  insider:   { w: 0, cap: 0, stage: 'none', ko: '임원·주요주주 지분 변동' },
  cbbuy:     { w: 0, cap: 0, stage: 'none', ko: '사채 만기 전 취득(CB 되사기)' },
};
export function evKind(text, party = '') {
  const t = String(text || '').replace(/\s+/g, '');
  if (/불성실공시|상장적격성|횡령|배임|관리종목|감사의견|회생절차|상장폐지|자본잠식|계속기업/.test(t)) return 'risk';
  if (/(유상증자|사채|양수도|경영권|최대주주변경).*(철회|해제|해지|취소)|(철회|해제|해지|취소).*(유상증자|사채|양수도|경영권)|납입일?의?(변경|연기)/.test(t)) return 'fail';
  if (/증권발행결과|발행결과|납입완료|주금납입/.test(t) || (/추가상장/.test(t) && /유상증자|제3자배정/.test(t))) return 'paid';
  if (/만기전사채취득|사채(의)?취득|사채만기전취득/.test(t)) return 'cbbuy';
  if (/(전환청구권|신주인수권|교환청구권)행사|전환청구|추가상장/.test(t)) return 'conv';
  if (/임원.*주요주주.*소유상황|소유상황보고서/.test(t)) return 'insider';
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
const KEYS = ['전환사채', '신주인수권', '교환사채', '유상증자', '최대주주', '경영권', '양수도', '정관', '공급계약', '무상증자', '감자', '청구권', '전환가액', '행사가액', '대량보유', '소유주식변동', '조회공시', '투자판단', '담보', '상장적격성', '불성실', '횡령', '추가상장', '관리종목', '소유상황', '사채취득', '만기전', '발행결과', '납입', '철회', '해제', '해지', '자본잠식', '계속기업', '감사의견'];

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
    const sql = `SELECT * FROM (SELECT id, ticker AS tk, name AS nm, ms, title AS t, json_extract(data,'$.formKo') AS f, json_extract(data,'$.party') AS p, json_extract(data,'$.summary.title') AS st, json_extract(data,'$.summary.sub') AS ss, ${ex} AS x FROM items WHERE src = 'DART' AND ms > ? AND ticker IS NOT NULL) WHERE ${like} ORDER BY ms DESC LIMIT 60000`;
    const r = await d.prepare(sql).bind(since, ...KEYS.map((k) => `%${k}%`)).all();
    for (const row of r.results || []) add(row);
  } else {
    const { queryArchive } = await import('./archive.mjs');
    for (const x of await queryArchive({ kind: 'FILING', market: 'KR', limit: 200 })) add({ id: x.id, tk: x.ticker, nm: x.name, ms: Date.parse(`${x.date || ''}T12:00:00+09:00`) || x.approxMs || Date.now(), t: x.titleClean, f: x.formKo, p: x.party, st: x.summary?.title, ss: x.summary?.sub });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.ms - a.ms);
  return out;
}
// 종목 카드에 남길 공시: 점수 있는 공시 15개 + 점수 없는 공시(납입·내부자·청구·되사기 등) 10개 — 잦은 내부자 보고가 CB·증자 공시를 밀어내지 않게
const weighted = (e) => (EV[e.kind]?.cap || 0) > 0;
export function keepEv(evs) {
  const a = (evs || []).filter(weighted).slice(0, 15), b = (evs || []).filter((e) => !weighted(e)).slice(0, 10);
  return [...a, ...b].sort((x, y) => y.ms - x.ms);
}
// 원문을 읽을 공시: 세력 원가·조건이 나오는 공시 먼저, 그다음 청구·내부자
const DOC_KINDS = ['cb', 'refix', 'rights3', 'rights', 'rightsfix', 'mna', 'fund5', 'pledge', 'majsell', 'insider', 'conv'];
export function docPick(evs, n = 10) {
  const L = (evs || []).filter((e) => DOC_KINDS.includes(e.kind) || (e.kind === 'risk' && /불성실공시/.test(e.title)));
  return L.sort((a, b) => (weighted(b) - weighted(a)) || b.ms - a.ms).slice(0, n);
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
      const get1 = async (pg) => { for (let t = 0; t < 3; t++) { try { return await nget(`https://m.stock.naver.com/api/stocks/marketValue/${mkt}?page=${pg}&pageSize=100`); } catch {} } return null; };
      const pages = await Promise.all([0, 1, 2, 3, 4].map((i) => get1(p + i)));
      let end = false;
      for (const j of pages) {
        if (!j) { rows.__partial = true; continue; } // 3번 실패한 쪽은 건너뜀 (뒤쪽 종목까지 버리지 않음)
        const list = j.stocks || [];
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
  const partial = !!rows.__partial; delete rows.__partial;
  Object.defineProperty(rows, 'partial', { value: partial, enumerable: false });
  return rows; // code → [이름, 시장(P코스피/Q코스닥), 종가, 등락률, 거래량, 거래대금, 시총]
}

// ───── ③ 일봉 (300거래일 ≈ 1년 2개월 · 지난 급등 사이클과 그 전 매집 구간까지 보려고) ─────
async function bars(code) {
  const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=300&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('일봉 HTTP ' + r.status);
  const xml = await r.text();
  // 거래정지·단일가 날은 시가·고가·저가가 0으로 올 때가 있음 → 종가로 채움 (0이면 '60일 저점 대비 +Infinity%' 같은 오류)
  return [...xml.matchAll(/data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g)].map((m) => { const c = +m[5]; const o = +m[2] || c, h = Math.max(+m[3] || c, c), l = Math.min(+m[4] || c, c); return { d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, o, h, l, c, v: +m[6] }; }).filter((x) => x.c > 0);
}
const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const vwap = (rows) => { let pv = 0, v = 0; for (const x of rows) { pv += ((x.h + x.l + x.c) / 3) * x.v; v += x.v; } return v ? pv / v : null; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** 일봉 → 거래량·주가 패턴 + 매집 구간 평단 추정 */
export function barFeatures(B, opt = {}) {
  if (!B || B.length < 40) return null;
  B = B.filter((x) => x.c > 0).map((x) => ({ ...x, o: x.o || x.c, h: Math.max(x.h || x.c, x.c), l: Math.min(x.l || x.c, x.c) })); // 0 가격 방어
  const last = B[B.length - 1], n = B.length;
  const win = (a, b) => B.slice(Math.max(0, n - a), n - b);
  const base = win(65, 5), base60 = median(base.map((x) => x.v));
  const v5 = B.slice(-5).reduce((s, x) => s + x.v, 0) / 5;
  const v20 = B.slice(-20).reduce((s, x) => s + x.v, 0) / 20;
  const maxV10 = Math.max(...B.slice(-10).map((x) => x.v));
  // 매집이 길게 이어지면 최근 60일 기준선도 같이 올라가서 '거래 증가'가 안 보임 → 매집 전(90~170일 전) 거래량을 따로 기준으로
  const old = B.slice(Math.max(0, n - 170), Math.max(0, n - 90)), longBase = old.length >= 30 ? median(old.map((x) => x.v)) : 0;
  const L40 = B.slice(-40), box40 = Math.max(...L40.map((x) => x.h)) / Math.min(...L40.map((x) => x.l)) - 1;
  const lo60 = Math.min(...B.slice(-60).map((x) => x.l)), hi60 = Math.max(...B.slice(-60).map((x) => x.h));
  const hi20 = Math.max(...B.slice(-20).map((x) => x.h));
  const bmin = Math.min(...base.map((x) => x.l)), bmax = Math.max(...base.map((x) => x.h));
  const ret = (k) => (B[n - 1 - k] ? ((last.c / B[n - 1 - k].c) - 1) * 100 : null);
  // 첫 거래량 폭증일(중앙값의 5배 이상)을 찾아, 그 전 구간을 '매집 구간'으로 봄
  const med120 = median(B.slice(-120).map((x) => x.v));
  // 지난 급등→급락 사이클(이미 한 번 띄우고 털고 나간 흔적): 약 300거래일 최고가가 그 전 저점의 1.8배 이상이고, 지금은 최고가 대비 −45% 이하
  let topI = 0; for (let i = 1; i < n; i++) if (B[i].h > B[topI].h) topI = i;
  let cyc = null, pumpI = -1;
  if (topI >= 5 && n - 1 - topI >= 10) {
    let lowI = Math.max(0, topI - 250); for (let i = lowI; i <= topI; i++) if (B[i].l < B[lowI].l) lowI = i;
    const rise = B[topI].h / B[lowI].l, drop = last.c / B[topI].h - 1;
    if (rise >= 1.8 && drop <= -0.45) {
      const medPre = median(B.slice(Math.max(0, lowI - 60), lowI + 1).map((x) => x.v)) || med120;
      pumpI = lowI; for (let i = lowI; i <= topI; i++) if (B[i].v >= medPre * 4) { pumpI = i; break; } // 급등 시작 = 저점 뒤 첫 거래량 폭증일
      const after = B.slice(topI); const vTop = after.reduce((a, x) => a + x.v, 0);
      cyc = { low: B[lowI].l, lowD: B[lowI].d, pumpD: B[pumpI].d, top: B[topI].h, topD: B[topI].d, rise: Math.round((rise - 1) * 100), drop: Math.round(drop * 100), since: n - 1 - topI,
        vwapPump: Math.round(vwap(B.slice(pumpI, topI + 1)) || 0) || null, vwapDump: vTop ? Math.round(vwap(after)) : null };
    }
  }
  let spike = -1;
  if (!cyc) for (let i = Math.max(0, n - 60); i < n; i++) if (B[i].v >= med120 * 5) { spike = i; break; }
  // 사이클이 있으면 매집 구간은 '급등 시작 전'으로 (급등·급락 기간 거래가 평단에 섞이지 않게)
  //  단, 고점에서 120거래일 넘게 지났으면 '2차 매집' 가능성을 보려고 고점 뒤 구간(고점+20일 ~ 오늘)을 매집 후보로
  // 2차 매집 후보: 고점 뒤 바닥을 찍고 40거래일 넘게 그 바닥을 안 깼고, 최근 40일 박스 폭이 좁음 (또는 고점에서 120거래일 경과)
  let base2 = null;
  if (cyc) {
    let bI = topI; for (let i = topI; i < n; i++) if (B[i].l < B[bI].l) bI = i;
    const held = n - 1 - bI, L40b = B.slice(-40);
    const bw = Math.max(...L40b.map((y) => y.h)) / Math.min(...L40b.map((y) => y.l)) - 1;
    if (held >= 40 && bw < 0.35) base2 = { low: B[bI].l, lowD: B[bI].d, held, box: Math.round(bw * 100) };
    cyc.base2 = base2;
  }
  const acc2 = !!cyc && (cyc.since >= 120 || !!base2);
  const accEnd = acc2 ? n : cyc ? pumpI : spike > 0 ? spike : n;
  let accFloor = 0;
  if (acc2) { let bI = topI; for (let i = topI; i < n; i++) if (B[i].l < B[bI].l) bI = i; accFloor = base2 ? bI : topI + 20; } // 2차 매집은 고점 뒤 바닥부터
  // 매집 시작 추정: 폭증(또는 오늘) 이전 150일 중 OBV(오른 날 거래량 +, 내린 날 −를 누적)가 가장 낮았던 날
  //  → 그날 이후 '오를 때 거래가 많고 내릴 때 적은' 흐름이 시작됐다고 봄. 너무 가까우면(20일 미만) 최소 20일 구간
  let obv = 0, minObv = Infinity, accStartI = Math.max(accFloor, accEnd - 60);
  const from = Math.max(1, accFloor, accEnd - 150);
  for (let i = from; i < accEnd; i++) {
    obv += B[i].c > B[i - 1].c ? B[i].v : B[i].c < B[i - 1].c ? -B[i].v : 0;
    if (obv < minObv) { minObv = obv; accStartI = i; }
  }
  if (accEnd - accStartI < 20) accStartI = Math.max(accFloor, accEnd - 20);
  if (base2) accStartI = accFloor; // 2차 매집: 고점 뒤 바닥부터 오늘까지
  const accRows = accEnd >= 10 ? B.slice(accStartI, accEnd) : []; // 급등이 차트 맨 앞이면 매집 구간은 차트 범위 밖
  // 매집 구간 동안 OBV가 얼마나 늘었는지 (구간 거래량 대비) — 클수록 '조용히 사 모은' 흔적
  let obv2 = 0, vsum = 0;
  for (let i = Math.max(1, accStartI); i < accEnd; i++) { obv2 += B[i].c > B[i - 1].c ? B[i].v : B[i].c < B[i - 1].c ? -B[i].v : 0; vsum += B[i].v; }
  const heavy = B.slice(-120).filter((x) => x.v >= med120 * 2);
  // 과거 고점(매물대): 매집 시작 전 최고가 · 전체(약 300거래일) 최고가 — 위쪽 저항 가격 후보
  const hiOf = (rows) => rows.reduce((m, x) => (!m || x.h > m.h ? x : m), null);
  const preTop = accStartI >= 10 ? hiOf(B.slice(0, accStartI)) : null, allTop = hiOf(B);
  const f = {
    close: last.c, date: last.d,
    ret5: r1(ret(5)), ret20: r1(ret(20)), ret60: r1(ret(60)),
    fromLow60: lo60 > 0 ? r1((last.c / lo60 - 1) * 100) : null, offHigh20: hi20 > 0 ? r1((last.c / hi20 - 1) * 100) : null,
    volX5: base60 ? r1(v5 / base60) : null, volX20: base60 ? r1(v20 / base60) : null, maxVolX10: base60 ? r1(maxV10 / base60) : null,
    box60: r1((bmax / bmin - 1) * 100), box40: r1(box40 * 100),
    volL20: longBase ? r1(v20 / longBase) : null, // 20일 평균 거래량 ÷ 매집 전(90~170일 전) 거래량
    spikeDate: cyc ? cyc.pumpD : spike > 0 ? B[spike].d : null, cyc, acc2, accBeyond: cyc && !acc2 ? accEnd < 10 : false,
    accStart: accRows.length ? B[accStartI]?.d || null : null, accEnd: accRows.length ? B[Math.max(0, accEnd - 1)]?.d || null : null, accDays: accRows.length,
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
  if (cyc) sig.push(`지난 급등·급락: ${cyc.pumpD} 급등 시작 → ${cyc.topD} 고점(+${cyc.rise}%) → 지금 고점 대비 ${cyc.drop}%`);
  f.score = s; f.sig = sig;
  f.marks = candleCands(B); // 매집봉 후보 (뉴스·시장 거르기는 applyMarks에서)
  // 거래정지 판단: 최근 거래량 0인 날이 3일 이상 이어짐 (정지 중엔 시세가 그대로 멈춰 있어 모든 신호가 엉터리가 됨)
  let z0 = 0; for (let i = n - 1; i >= 0 && !B[i].v; i--) z0++;
  f.halted = z0 >= 3 ? { since: B[n - z0].d, days: z0 } : null;
  // 일봉이 열흘 넘게 안 들어옴 → 그 뒤로 거래가 없는 것(정지)으로 봄
  const lagDays = ((opt.now || Date.now()) - Date.parse(last.d + 'T15:30:00+09:00')) / DAY;
  if (!f.halted && lagDays > 10) f.halted = { since: last.d, days: Math.round(lagDays * 5 / 7), stale: true };
  f.avgV20 = Math.round(v20);
  // 시장경보 예측(근사): 투자경고 지정예고 요건 — 3일 +100% · 5일 +60% · 15일 +100% (내일 종가 기준 얼마나 더 올라야 하는지)
  const W = [[3, 2, '3일 +100%'], [5, 1.6, '5일 +60%'], [15, 2, '15일 +100%']].map(([k, m, lbl]) => {
    const base = B[n - k]; if (!base) return null;
    const need = base.c * m;
    return { lbl, k, base: base.c, need: Math.round(need), pct: r1((need / last.c - 1) * 100), now: B[n - 1 - k] ? r1((last.c / B[n - 1 - k].c - 1) * 100) : null };
  }).filter(Boolean);
  const hi15 = Math.max(...B.slice(-15).map((y) => y.c));
  f.wf = W.length ? { items: W, min: W.reduce((a, b) => (b.pct < a.pct ? b : a)), hi15: last.c >= hi15 } : null;
  // 🔄 하락 뒤 반등 모양: 최근 160거래일 고점에서 33%↑ 빠졌다가 바닥 대비 15%↑ 반등 중일 때
  f.rb = null;
  {
    const S0 = Math.max(0, n - 160);
    let tI = S0; for (let i = S0; i < n; i++) if (B[i].h > B[tI].h) tI = i;
    let bI = tI; for (let i = tI; i < n; i++) if (B[i].l < B[bI].l) bI = i;
    const fall = B[bI].l / B[tI].h - 1, up = last.c / B[bI].l - 1;
    if (fall <= -0.33 && up >= 0.15 && n - 1 - bI >= 3) {
      const seg = B.slice(bI + 1), pre = B.slice(Math.max(tI, bI - 20), bI + 1);
      const med = median(B.slice(Math.max(0, bI - 120), bI + 1).map((y) => y.v)) || 1;
      let uv = 0, un = 0, dv = 0, dn = 0, wick = 0;
      for (let i = bI + 1; i < n; i++) {
        const y = B[i], pv = B[i - 1];
        if (y.c > pv.c) { uv += y.v; un++; } else if (y.c < pv.c) { dv += y.v; dn++; }
        const rng = y.h - y.l, upw = y.h - Math.max(y.o, y.c);
        const body = Math.abs(y.c - y.o);
        const low = Math.min(y.o, y.c) - y.l;
        if (rng > 0 && upw / rng >= 0.5 && upw >= body * 2 && upw >= low * 1.5 && upw / y.c >= 0.03 && y.v >= med * 2) wick++; // 거래량 실린 긴 윗꼬리
      }
      const avgSeg = seg.reduce((a, y) => a + y.v, 0) / seg.length, avgPre = pre.reduce((a, y) => a + y.v, 0) / (pre.length || 1);
      const hiSeg = Math.max(...seg.map((y) => y.h));
      f.rb = { topD: B[tI].d, top: B[tI].h, lowD: B[bI].d, low: B[bI].l, fall: Math.round(fall * 100), up: Math.round(up * 100), days: n - 1 - bI,
        udv: dn && un ? Math.min(5, r1((uv / un) / (dv / dn))) : un ? 5 : null, volX: avgPre ? r1(avgSeg / avgPre) : null, volMed: r1(avgSeg / med), wick, offHi: r1((last.c / hiSeg - 1) * 100) };
    }
  }
  return f;
}

// ───── 🕯 매집봉 흔적 (일봉 모양) ─────
//  후보 찾기(일봉만) → applyMarks에서 그날 공시·시장 급등 날은 제외하고 점수 반영
//  k: acc 매집봉 · wick 윗꼬리 매물 테스트 · absorb 물량 받아먹는 음봉 · dry 거래량 마름 · close 종가 관리 의심 · up30/dn30 상·하한가(참고)
export function candleCands(B) {
  const n = B.length, out = [];
  if (n < 70) return out;
  const pct = (a, b) => Math.round((a / b - 1) * 1000) / 10;
  const hold = (i, lvl) => { // 그 뒤 최대 20거래일 동안 기준 가격을 안 깨고 버텼는지
    const after = B.slice(i + 1, i + 21);
    if (after.length < 5) return { h: 'wait', n: after.length };
    const br = after.find((x) => x.c < lvl * 0.98);
    return br ? { h: 'broke', bd: br.d, n: after.length } : { h: 'held', n: after.length };
  };
  for (let i = Math.max(61, n - 220); i < n; i++) {
    const x = B[i], pv = B[i - 1];
    const prior = B.slice(i - 60, i);
    const medV = median(prior.map((y) => y.v));
    if (!medV || !pv.c) continue;
    const vx = Math.round((x.v / medV) * 10) / 10;
    const ch = x.c / pv.c - 1;
    if (ch >= 0.295) { out.push({ d: x.d, k: 'up30', p: x.c, vx, ch: pct(x.c, pv.c) }); continue; }
    if (ch <= -0.295) { out.push({ d: x.d, k: 'dn30', p: x.c, vx, ch: pct(x.c, pv.c) }); continue; }
    const lo = Math.min(...prior.map((y) => y.l));
    const inBox = pv.c / lo < 1.35; // 아직 크게 오르기 전(최근 60일 저점 대비 +35% 미만)
    if (!inBox) continue;
    const body = Math.abs(x.c - x.o), upper = x.h - Math.max(x.o, x.c);
    if (x.c > x.o && ch >= 0.06 && body / x.o >= 0.04 && vx >= 4) { const hd = hold(i, x.l); out.push({ d: x.d, k: 'acc', p: x.c, lvl: x.l, vx, ch: pct(x.c, pv.c), ...hd }); continue; }
    if (upper >= body * 2 && upper / x.c >= 0.05 && vx >= 3) { const hd = hold(i, x.l); out.push({ d: x.d, k: 'wick', p: x.c, hi: x.h, lvl: x.l, vx, ch: pct(x.c, pv.c), ...hd }); continue; }
    if (x.c < x.o && vx >= 3 && ch >= -0.03) { const hd = hold(i, x.l); out.push({ d: x.d, k: 'absorb', p: x.c, lvl: x.l, vx, ch: pct(x.c, pv.c), ...hd }); }
  }
  // 거래량 마름: 최근 10일 거래량이 평소의 45% 이하 + 10일 가격 폭 10% 미만 (매집봉 뒤에 나오면 의미)
  const L10 = B.slice(-10), base = median(B.slice(-70, -10).map((y) => y.v));
  if (base) {
    const v10 = L10.reduce((a, y) => a + y.v, 0) / 10, rng = Math.max(...L10.map((y) => y.h)) / Math.min(...L10.map((y) => y.l)) - 1;
    if (v10 <= base * 0.45 && rng < 0.1) out.push({ d: B[n - 1].d, k: 'dry', p: B[n - 1].c, vx: Math.round((v10 / base) * 100) / 100, rng: Math.round(rng * 1000) / 10 });
  }
  // 종가 관리 의심: 최근 20일 장중 출렁임(평균 5%↑)은 큰데 종가끼리는 거의 같음(하루 변동 표준편차 1.2%↓)
  const L20 = B.slice(-21);
  const chs = L20.slice(1).map((y, k) => y.c / L20[k].c - 1), rngAvg = L20.slice(1).reduce((a, y) => a + (y.h - y.l) / y.c, 0) / 20;
  const sd = Math.sqrt(chs.reduce((a, v) => a + v * v, 0) / chs.length);
  if (rngAvg >= 0.05 && sd <= 0.012) out.push({ d: B[n - 1].d, k: 'close', p: B[n - 1].c, rng: Math.round(rngAvg * 1000) / 10, sd: Math.round(sd * 1000) / 10 });
  return out.slice(-14);
}
export const MARK_KO = { acc: '매집봉', wick: '윗꼬리 매물 테스트', absorb: '물량 받아먹는 음봉', dry: '거래량 마름', close: '종가 관리 의심', up30: '상한가', dn30: '하한가' };
/** 지수 일별 등락률 (코스피 P · 코스닥 Q) — 시장 전체가 급등한 날의 봉은 매집 흔적에서 제외하려고 */
export async function indexDaily() {
  const z = kst(), k = `mp/ix/${z.date}`;
  const c = await getJSON(k).catch(() => null);
  // 장 마감(15:40) 뒤에 받은 것만 하루 종일 씀 · 장중에 받은 건 10분만 (오늘 등락률이 아직 확정 전이라)
  if (c?.data && (c.after || Date.now() - (c.at || 0) < 10 * 60e3)) return c.data;
  const out = {}, got = { P: false, Q: false };
  for (const [sym, key] of [['KOSPI', 'P'], ['KOSDAQ', 'Q']]) {
    try {
      const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${sym}&timeframe=day&count=300&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
      const xml = await r.text();
      const rows = [...xml.matchAll(/data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([\d.]+)\|/g)].map((m) => ({ d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, c: +m[2] }));
      for (let i = 1; i < rows.length; i++) ((out[rows[i].d] ||= {})[key] = Math.round((rows[i].c / rows[i - 1].c - 1) * 1000) / 10);
      if (rows.length > 20) got[key] = true;
    } catch {}
  }
  if (got.P && got.Q) await setJSON(k, { at: Date.now(), after: z.m >= 15 * 60 + 40 || !isTradingDay('KR', z.date), data: out }).catch(() => {}); // 두 지수 다 받았을 때만 저장
  return Object.keys(out).length ? out : c?.data || {};
}
/** 후보 → 그날·전날 공시가 있거나 시장 전체가 급등(±2.5%↑)한 날은 제외, 버팀 확인 → 점수·신호 반영 (f를 직접 바꿈, 한 번만) */
export function applyMarks(f, evs = [], ix = {}, mkt = 'Q') {
  if (!f || !Array.isArray(f.marks) || f.marksDone) return f;
  const evDays = new Map();
  for (const e of (evs || []).filter(weighted)) { const d = ymdOf(e.ms); if (!evDays.has(d)) evDays.set(d, EV[e.kind]?.ko || e.kind); }
  const prevDay = (d) => { const t = new Date(Date.parse(d + 'T12:00:00Z') - DAY); return t.toISOString().slice(0, 10); };
  const ixOk = Object.keys(ix || {}).length > 0;
  for (const m of f.marks) {
    if (['dry', 'close', 'up30', 'dn30'].includes(m.k)) { m.ok = m.k === 'dry' || m.k === 'close'; continue; }
    const news = evDays.get(m.d) || evDays.get(prevDay(m.d));
    const mk = ix?.[m.d]?.[mkt === 'P' ? 'P' : 'Q'];
    if (news) { m.ok = false; m.why = `그날(또는 전날) '${news}' 공시가 있어 뉴스 때문일 수 있음`; continue; }
    if (mk != null && Math.abs(mk) >= 2.5) { m.ok = false; m.why = `그날 ${mkt === 'P' ? '코스피' : '코스닥'} 전체가 ${mk > 0 ? '+' : ''}${mk}% 움직인 날`; continue; }
    if (m.h === 'broke') { m.ok = false; m.why = `그 뒤 ${m.bd} 이 봉의 저점(${fmtW(m.lvl)}원)을 깸`; continue; }
    m.ok = m.h === 'held' || m.h === 'wait';
    m.why = m.h === 'held' ? `그 뒤 ${m.n}거래일 동안 이 봉의 저점(${fmtW(m.lvl)}원)을 지킴` : `아직 ${m.n}거래일 지나 버티는지 확인 중`;
    if (!ixOk) m.why += ' · 시장 지수 확인 못 함';
  }
  // 거래량 마름은 매집봉·받아먹는 음봉이 최근 60일 안에 있을 때만 의미
  const recent = f.marks.filter((m) => m.ok && ['acc', 'absorb'].includes(m.k) && Date.parse(f.date) - Date.parse(m.d) <= 90 * DAY);
  const dry = f.marks.find((m) => m.k === 'dry');
  if (dry && !recent.length) { dry.ok = false; dry.why = '최근 매집봉이 없어 단순 거래 부진일 수 있음'; }
  else if (dry) dry.why = `최근 10일 거래량이 평소의 ${Math.round(dry.vx * 100)}% · 가격 폭 ${dry.rng}% — 물량을 모은 뒤 조용해지는 모습`;
  const cl = f.marks.find((m) => m.k === 'close'); if (cl) cl.why = `최근 20일 장중 출렁임 평균 ${cl.rng}%인데 종가 변동은 ${cl.sd}% — 종가가 일정하게 맞춰지는 모습 (분봉 없이 일봉으로만 본 의심 신호)`;
  const nAcc = f.marks.filter((m) => m.ok && m.k === 'acc' && m.h === 'held').length;
  const has = (k) => f.marks.some((m) => m.ok && m.k === k && (m.h === 'held' || !m.h));
  const cs = Math.min(4, Math.min(2, nAcc) * 2 + (has('absorb') ? 1 : 0) + (has('wick') ? 1 : 0) + (has('dry') ? 1 : 0) + (has('close') ? 1 : 0));
  f.cscore = cs; f.nAccMark = nAcc;
  if (cs) {
    f.score = (f.score || 0) + cs;
    const okL = f.marks.filter((m) => m.ok && !['up30', 'dn30'].includes(m.k));
    f.sig = [...(f.sig || []), `🕯 매집봉 흔적 ${okL.length}개 (${[...new Set(okL.map((m) => MARK_KO[m.k]))].join('·')}) +${cs}점`];
  }
  f.marksDone = true;
  return f;
}

// ───── ④ 공시 원문에서 가격 (세력 평단 근거: 전환가·발행가·양수도 단가) ─────
const PXV = 3;
async function docPrice(e) {
  const ck = `mp/px/${e.id}`;
  const c = await getJSON(ck);
  if (c && c.v === PXV) return c; // 읽는 항목이 늘면 PXV를 올려 예전 저장분을 다시 읽음
  let failed = false;
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
    // 5% 보고서·임원/주요주주 소유상황 보고서 '세부변동내역': 날짜별 장내매수·장내매도 수량·단가
    if (e.kind === 'fund5' || e.kind === 'insider' || /대량보유|소유상황/.test(e.title)) {
      const trades = [];
      for (let i = 0; i < L.length; i++) {
        const sm = L[i].match(/장내\s*(매수|매도)/); if (!sm) continue;
        let d = null; for (let k = i; k >= Math.max(0, i - 4); k--) { const m2 = L[k].match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/); if (m2) { d = `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`; break; } }
        const nums = L.slice(i + 1, i + 9).map((x) => n0((x.match(/^-?[\d,]+(\.\d+)?$/) || [])[0])).filter((v) => v != null);
        // 표 순서: 변동 전 · 증감 · 변동 후 · 취득/처분 단가 → 마지막 쪽 '단가'로 보이는 값
        const q = nums.length >= 3 ? Math.abs(nums[1]) : null, pr = nums.slice(3).find((v) => v >= 50 && v < 5e6) ?? null;
        if (d && pr) trades.push({ d, q, p: pr, side: sm[1] === '매수' ? 'buy' : 'sell' });
      }
      const buys = trades.filter((t) => t.side === 'buy'), sells = trades.filter((t) => t.side === 'sell');
      if (buys.length) {
        const qs = buys.reduce((a, b) => a + (b.q || 0), 0);
        p = Math.round(qs ? buys.reduce((a, b) => a + b.p * (b.q || 0), 0) / qs : buys.reduce((a, b) => a + b.p, 0) / buys.length);
        label = `${e.kind === 'insider' ? '내부자 ' : ''}장내 취득 평균 (${buys[0].d}~${buys[buys.length - 1].d}, ${buys.length}건)`;
        e.buys = buys.slice(0, 30);
      }
      if (buys.length || sells.length) {
        const sq = (a) => a.reduce((x, t) => x + (t.q || 0), 0);
        e.ins = { bq: sq(buys), sq: sq(sells), nb: buys.length, ns: sells.length, sp: sells.length ? Math.round(sells.reduce((x, t) => x + t.p, 0) / sells.length) : null };
      }
    }
    // 증자·사채 자금 사용 목적: '타법인 증권 취득자금' 비중이 크면 돈이 회사 밖으로 나갈 수 있음
    if (['cb', 'rights3', 'rights', 'rightsfix'].includes(e.kind) || /사채권발행결정|유상증자결정/.test(e.title)) {
      const amt = (re) => { const i = L.findIndex((x) => re.test(x)); if (i < 0) return 0; for (let k = i; k < i + 3 && k < L.length; k++) { const v = n0((L[k].replace(re, '').match(/[\d,]{4,}/) || [])[0]); if (v) return v; } return 0; };
      const use = { fac: amt(/시설자금/), op: amt(/운영자금/), debt: amt(/채무상환자금/), other: amt(/타법인\s*증권\s*취득자금/), biz: amt(/영업양수자금/), etc: amt(/^기타자금|기타\s*자금/) };
      const tot = Object.values(use).reduce((a, b) => a + b, 0);
      if (tot) e.use = { ...use, tot, otherPct: Math.round((use.other / tot) * 100) };
    }
    // 정정 공시: 납입일 변경·연기
    if (e.kind === 'rightsfix' || /정정/.test(e.title)) {
      const txt = L.slice(0, 200).join(' ');
      if (/납입일/.test(txt) && /(변경|연기)/.test(txt) && /정정\s*사유|정정사항|정정\s*전/.test(txt)) e.delay = true;
    }
    // CB·BW·EB 상세: 전환청구기간, 최저 조정가(리픽싱 하한), 콜옵션(매도청구권)
    // 회차(제N회) — CB 발행 공시와 전환청구 공시를 짝지으려고
    const ser = (() => { const T = [e.title, ...L.slice(0, 80)]; for (let i = 0; i < T.length; i++) { const t = String(T[i]); let m5 = t.match(/제\s*(\d{1,3})\s*회/); if (m5) return +m5[1]; if (/회\s*차/.test(t)) { m5 = t.match(/회\s*차[^\d]{0,6}(\d{1,3})\b/); if (m5) return +m5[1]; for (let k = i + 1; k < i + 3 && k < T.length; k++) { const m6 = String(T[k]).trim().match(/^(\d{1,3})$/); if (m6) return +m6[1]; } } } return null; })();
    // 전환청구·행사 공시: 아직 전환 안 된 사채 잔액 → 남은 잠재 매도 물량(오버행)
    if (e.kind === 'conv' || /(전환|행사|교환)청구/.test(e.title)) {
      const ai2 = L.findIndex((x) => /미전환\s*사채.*잔액|미전환\s*잔액|미행사\s*신주인수권.*(잔액|권면)|미교환\s*사채.*잔액|잔여\s*사채\s*(권면)?\s*(총액|잔액)/.test(x));
      const pi2 = L.findIndex((x) => /^(전환|행사|교환)\s*가액|^\s*(전환|행사|교환)가액\s*\(?원?/.test(x));
      const numAt = (i) => { if (i < 0) return null; for (let k = i; k < i + 4 && k < L.length; k++) { const v = n0((L[k].replace(/^[^\d]*?(잔액|총액)[^\d]*/, '').match(/[\d,]{2,}/) || [])[0]); if (v != null) return v; } return null; };
      const amt = numAt(ai2), pr = (() => { const v = numAt(pi2); return v && v >= 50 && v < 5e6 ? v : null; })();
      if (amt != null) e.ovh = { amt, price: pr, ser };
    }
    if (['cb', 'refix'].includes(e.kind) || /사채권발행결정/.test(e.title)) {
      const ti = L.findIndex((x) => /권면\s*(\(전자등록\))?\s*총액|사채의\s*권면.*총액/.test(x));
      if (ti >= 0) for (let k = ti; k < ti + 4 && k < L.length; k++) { const v = n0((L[k].match(/[\d,]{6,}/) || [])[0]); if (v) { cbx.tot = v; break; } }
      if (ser) cbx.ser = ser;
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
  } catch { failed = true; }
  const out = { v: PXV, p, label, kind: e.kind, at: e.ms, third, restr, buys: e.buys || null, cbx: Object.keys(cbx).length ? cbx : null, pledge, pen, ins: e.ins || null, use: e.use || null, delay: e.delay || null, ovh: e.ovh || null };
  if (!failed) await setJSON(ck, out).catch(() => {}); // 원문을 못 받았으면 저장하지 않고 다음에 다시
  return out;
}

// 공시 원문 결과 → 종목의 px 목록 한 줄
function pxRow(p, e) {
  if (!(p.p || p.cbx || p.pledge || p.pen || p.ins || p.use || p.delay || p.ovh)) return null;
  return { p: p.p || null, pen: p.pen || undefined, label: p.label || (p.pen ? '불성실공시 벌점' : p.pledge ? '주식 담보' : p.ins ? '내부자 지분 변동' : p.use ? '자금 사용 목적' : p.delay ? '납입일 변경' : p.ovh ? '미전환 잔액' : 'CB 조건'), kind: p.kind, date: new Date(e.ms + 9 * 3600e3).toISOString().slice(0, 10), buys: p.buys || undefined, cbx: p.cbx || undefined, pledge: p.pledge || undefined, ins: p.ins || undefined, use: p.use || undefined, delay: p.delay || undefined, ovh: p.ovh || undefined, ref: e.id };
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
export function stageOf(by, f, evs = []) {
  if (f?.halted) return '거래정지';
  const exit = (by.conv || 0) + (by.majsell || 0) + (by.pledge || 0);
  const setup = (by.mna || 0) + (by.rights3 || 0) + (by.cb || 0) + (by.fund5 || 0) + (by.purpose || 0) + (by.refix || 0);
  // 이미 한 번 띄우고 빠진 종목: 고점 뒤 새 '판 깔기' 공시가 있으면 2차 판 깔기, 없으면 '엑시트 후'
  if (f?.cyc) {
    const topMs = Date.parse(f.cyc.topD + 'T15:30:00+09:00');
    const newSetup = (evs || []).some((e) => ['mna', 'rights3', 'cb', 'fund5', 'refix'].includes(e.kind) && e.ms > topMs);
    if (newSetup) return '판 깔기';
    // 고점에서 6개월(120거래일) 넘게 지났고 최근 흐름이 다시 매집 모양이면 '매집'(2차)
    if ((f.cyc.since >= 120 || f.cyc.base2) && (stageOf(by, { ...f, cyc: null }, []) === '매집' || (f.nAccMark ?? 0) >= 1)) return '매집';
    return '엑시트 후';
  }
  if (f && (f.fromLow60 ?? 0) >= 50 && ((f.offHigh20 ?? 0) <= -20 || exit >= 3)) return '털기';
  if (f && ((f.fromLow60 ?? 0) >= 50 || ((f.maxVolX10 ?? 0) >= 10 && (f.ret20 ?? 0) >= 20))) return '띄우기';
  // 매집: 아직 크게 안 올랐고(60일 저점 대비 +40% 미만), 박스권에서 거래가 늘거나 순매수 흐름이 이어짐
  if (f && (f.fromLow60 ?? 99) < 40) {
    const box = (f.box40 ?? f.box60 ?? 99);
    if (box < 35 && ((f.volX20 ?? 0) >= 1.3 || (f.volL20 ?? 0) >= 1.5)) return '매집';
    if ((f.accObv ?? 0) >= 15 && (f.accDays ?? 0) >= 30 && box < 45) return '매집';
    if ((f.nAccMark ?? 0) >= 1 && (f.cscore ?? 0) >= 3 && box < 45) return '매집'; // 버틴 매집봉 + 다른 봉 흔적
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
  for (const p of (x.px || []).filter((p) => p.p)) add(`${p.date} 공시 원문 가격: ${p.label} ${fmtW(p.p)}원${p.buys?.length ? ` (장내 취득 ${p.buys.length}건: ${p.buys.slice(0, 6).map((b) => `${b.d} ${b.q ? fmtW(b.q) + '주 ' : ''}${fmtW(b.p)}원`).join(', ')})` : ''}`, '공시 원문', { price: p.p, kind: p.kind });
  if (f.accStart) add(`거래 흐름상 매집 추정 구간 ${f.accStart} ~ ${f.accEnd} (${f.accDays}거래일, 순매수 강도 ${f.accObv}%, 가격 ${fmtW(f.accLow)}~${fmtW(f.accHigh)}원)`, '일봉 계산');
  if (f.cyc) add(`지난 급등·급락 사이클: ${f.cyc.lowD} 저점 ${fmtW(f.cyc.low)}원 → ${f.cyc.pumpD} 급등 시작 → ${f.cyc.topD} 고점 ${fmtW(f.cyc.top)}원(저점 대비 +${f.cyc.rise}%) → 현재 고점 대비 ${f.cyc.drop}% (고점 뒤 ${f.cyc.since}거래일)${f.cyc.vwapPump ? `, 급등 구간 평균 체결가 ${fmtW(f.cyc.vwapPump)}원` : ''}${f.cyc.vwapDump ? `, 고점 이후 평균 체결가 ${fmtW(f.cyc.vwapDump)}원` : ''}`, '일봉 계산');
  if (f.accBeyond) add('급등 시작이 일봉 자료(약 300거래일, 1년 2개월) 맨 앞쪽이라 그 전 매집 구간과 매집 평단은 계산할 수 없음', '일봉 계산');
  for (const m of (f.marks || []).filter((m) => m.ok && !['up30', 'dn30'].includes(m.k)).slice(-6)) add(`${m.d} 일봉 흔적 '${MARK_KO[m.k]}': 종가 ${fmtW(m.p)}원${m.vx != null && m.k !== 'dry' ? `, 거래량 평소의 ${m.vx}배` : ''}${m.ch != null ? `, 등락 ${m.ch > 0 ? '+' : ''}${m.ch}%` : ''} — ${m.why || ''}`, '일봉 계산');
  if (f.vwapAcc) add(`매집 추정 구간 거래량 가중 평균가 ${fmtW(f.vwapAcc)}원`, '일봉 계산', { price: f.vwapAcc });
  if (f.vwapHeavy) add(`최근 120일 중 거래량이 평소 2배 넘은 날들의 평균가 ${fmtW(f.vwapHeavy)}원`, '일봉 계산', { price: f.vwapHeavy });
  if (f.hiPre) add(`매집 추정 시작 전 최고가 ${fmtW(f.hiPre)}원 (${f.hiPreD})${f.hiAll ? `, 최근 약 300거래일 최고가 ${fmtW(f.hiAll)}원 (${f.hiAllD})` : ''}`, '일봉 계산');
  if (f.fromLow60 != null) add(`60일 저점 대비 ${f.fromLow60 > 0 ? '+' : ''}${f.fromLow60}%, 20일 고점 대비 ${f.offHigh20}%`, '일봉 계산');
  if (f.volX5 != null) add(`거래량(평소 대비): 최근 5일 ${f.volX5}배, 20일 ${f.volX20}배, 10일 중 최대 ${f.maxVolX10}배${f.spikeDate ? `, 첫 폭증일 ${f.spikeDate}` : ''}`, '일봉 계산');
  if (f.box60 != null) add(`폭증 전 60일 박스권 폭 ${f.box60}%${f.ret20 != null ? `, 20일 수익률 ${f.ret20}%` : ''}${f.ret60 != null ? `, 60일 수익률 ${f.ret60}%` : ''}`, '일봉 계산');
  for (const p of x.px || []) {
    if (p.cbx) add(`${p.date} CB 원문 조건:${p.cbx.start ? ` 전환청구기간 ${p.cbx.start}${p.cbx.end ? ' ~ ' + p.cbx.end : ''}` : ''}${p.cbx.floor ? `, 리픽싱 최저 조정가 ${fmtW(p.cbx.floor)}원` : ''}${p.cbx.call ? `, 콜옵션(매도청구권)${p.cbx.callPct ? ' ' + p.cbx.callPct + '%' : ''} 있음` : ''}`, '공시 원문');
    if (p.pledge) add(`${p.date} 주식 담보: 담보 ${fmtW(p.pledge.sh)}주에 대출 ${fmtW(p.pledge.loan)}원 → 1주당 ${fmtW(p.pledge.perShare)}원`, '공시 원문');
  }
  for (const p of x.px || []) {
    if (p.ins) add(`${p.date} 임원·주요주주 지분 변동 보고: 장내 매수 ${fmtW(p.ins.bq)}주(${p.ins.nb}건) · 장내 매도 ${fmtW(p.ins.sq)}주(${p.ins.ns}건)`, '공시 원문');
    if (p.use) add(`${p.date} 자금 사용 목적: 총 ${fmtW(p.use.tot)}원 중 타법인 증권 취득 ${p.use.otherPct}%${p.use.op ? `, 운영자금 ${fmtW(p.use.op)}원` : ''}${p.use.debt ? `, 채무상환 ${fmtW(p.use.debt)}원` : ''}`, '공시 원문');
    if (p.delay) add(`${p.date} 정정 공시: 납입일 변경`, '공시 원문');
  }
  const ovf = overhangOf(x);
  if (ovf?.shares) add(`남은 전환 가능 물량(추정): 약 ${fmtW(ovf.shares)}주${ovf.days != null ? ` (하루 평균 거래량의 ${ovf.days}일치)` : ''}`, '공시 원문 계산');
  if (f.rb) add(`${f.rb.topD} 고점 ${fmtW(f.rb.top)}원 → ${f.rb.lowD} 바닥 ${fmtW(f.rb.low)}원(${f.rb.fall}%) → 현재 바닥 대비 +${f.rb.up}% 반등 (${f.rb.days}거래일, 오른 날/내린 날 거래량 ${f.rb.udv ?? '-'}배)`, '일봉 계산');
  const ck = x.ck || {};
  if (ck.major?.pct != null) add(`최대주주 등 지분율 ${ck.major.pct}% (${ck.major.src})`, 'DART');
  if (ck.audit) add(`감사의견 ${ck.audit.op} (${ck.audit.y})`, 'DART');
  if (ck.cap?.imp != null) add(`자본잠식률 ${ck.cap.imp}% (${ck.cap.src})`, 'DART');
  if (ck.credit?.rate != null) add(`신용잔고율 ${ck.credit.rate}%`, '한국투자증권');
  if (ck.broker?.top) add(`거래원: '${ck.broker.top.nm}' 최근 ${ck.broker.n}일 중 ${ck.broker.top.days}일 매수 상위`, '네이버 거래원');
  if (ck.buzz?.news3 != null) add(`최근 3일 기사 ${ck.buzz.news3}건${ck.buzz.boardN != null ? `, 종토방 24시간 글 ${ck.buzz.boardN}건` : ''}`, '네이버');
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
  const ps = [...(x.px || []).filter((p) => !['pledge', 'majsell', 'risk', 'insider'].includes(p.kind)).map((p) => p.p), x.f?.vwapAcc].filter((v) => v > 0);
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
      else if (!['pledge', 'majsell', 'risk', 'insider'].includes(p.kind)) add(p.p, 'cost', p.label || '공시 가격', `${p.date} 공시의 ${p.label || '가격'}`, '공시 원문', p.ref);
    }
    if (p.cbx?.floor) add(p.cbx.floor, 'floor', 'CB 리픽싱 하한', `${p.date} CB 원문의 최저 조정가 — 주가가 내리면 전환가가 여기까지 낮아질 수 있음 (CB 쪽은 더 싸게 주식을 받음)`, '공시 원문', p.ref);
    if (p.pledge) add(p.pledge.perShare * 1.4, 'risk', '반대매매 추정선', `${p.date} 담보 1주당 대출 ${fmtW(p.pledge.perShare)}원의 1.4배(일반적 담보비율 가정) — 이 아래로 빠지면 담보 물량이 나올 수 있음`, '공시 원문+가정', p.ref);
  }
  if (f.vwapAcc) add(f.vwapAcc, 'cost', '매집 구간 평균가', `${f.accStart} ~ ${f.accEnd} 매집 추정 구간의 거래량 가중 평균가`, '일봉 계산');
  if (f.accLow) add(f.accLow, 'floor', '매집 구간 최저가', `매집 추정 구간(${f.accStart} ~ ${f.accEnd})의 가장 낮은 가격`, '일봉 계산');
  if (f.cyc?.vwapPump) add(f.cyc.vwapPump, 'res', '급등 때 평균 체결가', `${f.cyc.pumpD} ~ ${f.cyc.topD} 급등 구간의 거래량 가중 평균가 — 그때 산 사람들이 물려 있는 가격`, '일봉 계산');
  if (f.hiPre) add(f.hiPre, 'res', '매집 전 고점', `${f.hiPreD} 고점 — 매집 시작 전 가장 높았던 가격. 그때 산 사람들의 매물이 쌓인 자리`, '일봉 계산');
  if (f.hiAll && (!f.hiPre || Math.abs(f.hiAll / f.hiPre - 1) > 0.03)) add(f.hiAll, 'res', '최근 고점', `${f.hiAllD} 고점 — 최근 약 300거래일(1년 2개월) 중 가장 높은 가격`, '일봉 계산');
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
  if (x.f?.halted || x.stage === '거래정지') return { dir: 'none', upS: 0, downS: 0, upRaw: 0, downRaw: 0, net: 0, notes: [`${x.f?.halted?.since || ''} 무렵부터 거래가 없음(거래정지로 보임) — 거래가 다시 열릴 때까지 판단을 멈춤`], tgt: null, rr: null, levels: [], dates: [], up: [], down: [], cost: costRange(x) ? { low: Math.round(costRange(x).low), high: Math.round(costRange(x).high) } : null, gap: null };
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
  const exited = !!f.cyc && !['판 깔기', '매집'].includes(x.stage); // 이미 털고 나간 종목은 '평단 근처'를 상승 근거로 안 씀
  if (!exited && gap != null && gap <= 20 && gap >= -30) R(up, 2, `현재가 ${fmtW(x.close)}원이 추정 평단 ${fmtW(c.low)}~${fmtW(c.high)}원 근처 (${gap >= 0 ? '+' : ''}${Math.round(gap)}%) — 세력이 아직 수익 구간이 아님`, '계산');
  if ((f.fromLow60 ?? 99) < 25 && lastSetup) R(up, 1, `60일 저점 대비 ${f.fromLow60 > 0 ? '+' : ''}${f.fromLow60}%로 아직 크게 오르지 않음`, '일봉');
  const okMarks = (f.marks || []).filter((m) => m.ok && ['acc', 'absorb', 'wick'].includes(m.k) && m.h === 'held');
  if (okMarks.length && !(f.cyc && !['판 깔기', '매집'].includes(x.stage))) R(up, Math.min(3, okMarks.length + 1), `🕯 매집봉 흔적: ${okMarks.slice(-3).map((m) => `${m.d} ${MARK_KO[m.k]}(거래량 ${m.vx}배, 저점 ${fmtW(m.lvl)}원 지킴)`).join(' · ')}`, '일봉');
  const dryM = (f.marks || []).find((m) => m.k === 'dry' && m.ok);
  if (dryM && (f.fromLow60 ?? 99) < 40) R(up, 1, `🕯 ${dryM.why}`, '일봉');
  // 자금 투입 완료·내부자 매매·자금 문제
  const paidE = ev.find((e) => e.kind === 'paid' && age(e) <= 180);
  if (paidE) R(up, 1, `${ymdOf(paidE.ms)} '${paidE.title}' — 증자·사채 대금이 실제로 들어옴`, paidE.id);
  const insPx = (x.px || []).filter((p) => p.kind === 'insider' && p.ins && (now - Date.parse(p.date)) <= 120 * DAY);
  const iB = insPx.reduce((a, p) => a + (p.ins.bq || 0), 0), iS = insPx.reduce((a, p) => a + (p.ins.sq || 0), 0);
  if (iB > iS && iB > 0) R(up, 1, `최근 4개월 임원·주요주주 장내 매수 ${fmtW(iB)}주(매도 ${fmtW(iS)}주)`, insPx[0].ref);
  if (iS > iB && iS > 0) R(down, 2, `최근 4개월 임원·주요주주 장내 매도 ${fmtW(iS)}주(매수 ${fmtW(iB)}주) — 내부자가 팔고 있음`, insPx[0].ref);
  const failE = ev.find((e) => e.kind === 'fail' && age(e) <= 365);
  if (failE) R(down, 3, `${ymdOf(failE.ms)} '${failE.title}' — 자금이 모자라거나 계획이 틀어진 신호`, failE.id);
  const delayP = (x.px || []).find((p) => p.delay);
  if (delayP && !failE) R(down, 2, `${delayP.date} 정정 공시에서 납입일 변경 — 자금 조달이 늦어지는 신호`, delayP.ref);
  const drainP = (x.px || []).find((p) => p.use && p.use.otherPct >= 50);
  if (drainP) R(down, 2, `${drainP.date} 조달 자금의 ${drainP.use.otherPct}%를 타법인 증권 취득에 씀 — 돈이 회사 밖으로 나갈 수 있음`, drainP.ref);
  const rbk = reboundOf(x, now);
  if (rbk?.type === 'dump') R(down, 2, `🔄 지금 반등은 '털기 중 반등' 쪽 — ${rbk.why.b[0]?.t || ''}`, '일봉');
  if (rbk?.type === 'second') R(up, 2, `🔄 지금 반등은 '2차 작전' 쪽 — ${rbk.why.c[0]?.t || ''}`, '일봉');
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
  if (f.cyc) {
    const topMs = Date.parse(f.cyc.topD + 'T15:30:00+09:00');
    const exitAfterTop = ev.filter((e) => EXIT.includes(e.kind) && e.ms >= topMs - 30 * DAY);
    R(down, 2, `이미 한 번 급등(${f.cyc.topD} 고점 ${fmtW(f.cyc.top)}원, 저점 대비 +${f.cyc.rise}%) 뒤 고점 대비 ${f.cyc.drop}% — 세력이 차익을 내고 빠졌을 가능성`, '일봉');
    if (exitAfterTop.length) R(down, 1, `고점 전후 '${EV[exitAfterTop[0].kind].ko}' 공시 (${ymdOf(exitAfterTop[0].ms)}) — 물량 정리 흔적`, exitAfterTop[0].id);
    if (f.cyc.vwapPump) R(down, 1, `급등 구간에 산 사람들의 평균가 약 ${fmtW(f.cyc.vwapPump)}원이 현재가 위에 물려 있음 — 반등 때 매물`, '일봉');
  }
  // 참고 가격 사다리: 공시 원문 가격(원가)·과거 고점(매물대)·담보 반대매매선 — 위쪽은 목표 후보, 아래쪽은 지지 후보
  const lv = priceLevels(x);
  const tgt = lv.above.length ? lv.above.slice(0, 3) : null;
  // 손익비(참고): 위쪽 1차 목표까지 남은 폭 ÷ 아래쪽 가장 가까운 원가·지지 가격까지의 폭
  //  손절 기준 = 현재가보다 2% 이상 아래에 있는 '원가(세력 평단 근거)'·'지지' 가격 중 가장 높은 것. 아래 폭이 3% 미만이면 3%로 계산(비율 과장 방지)
  let rr = null;
  if (x.close && lv.above.length) {
    const sup = lv.all.filter((l) => ['cost', 'floor'].includes(l.kind) && l.p <= x.close * 0.98).sort((a, b) => b.p - a.p)[0];
    if (sup) {
      const t1 = lv.above[0], risk = Math.max(x.close - sup.p, x.close * 0.03);
      rr = { v: Math.round(((t1.p - x.close) / risk) * 10) / 10, t: t1.p, ts: t1.s, s: sup.p, ss: sup.s, up: Math.round((t1.p / x.close - 1) * 1000) / 10, dn: Math.round((sup.p / x.close - 1) * 1000) / 10, t2: lv.above[1]?.p || null, t2s: lv.above[1]?.s || null, min3: x.close - sup.p < x.close * 0.03 };
    }
  }
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
  const surged = (f.fromLow60 ?? 0) >= 50 || ['띄우기', '털기', '엑시트 후'].includes(x.stage);
  const dir = !surged && upRaw >= 3 && upRaw >= downRaw + 2 ? 'up' : downRaw >= 3 && (downRaw >= upRaw || surged) ? 'down' : 'none';
  const notes = [];
  if (f.cyc) notes.push(x.stage === '판 깔기' ? `지난 급등(${f.cyc.topD} 고점) 뒤 새 판 깔기 공시가 나와 '2차 판 깔기'로 봄 — 지난 사이클의 평단·고점은 참고만` : x.stage === '매집' ? `지난 급등(${f.cyc.topD} 고점) 뒤 ${f.cyc.base2 ? `${f.cyc.base2.lowD} 바닥(${fmtW(f.cyc.base2.low)}원)을 ${f.cyc.base2.held}거래일째 지키며 박스(폭 ${f.cyc.base2.box}%)` : `${f.cyc.since}거래일 지나`} 다시 매집 모양 — '2차 매집'으로 봄 (매집 구간·평단은 바닥 이후로 새로 계산, 지난 사이클 평단은 참고만)` : `이미 ${f.cyc.pumpD}~${f.cyc.topD}에 한 번 띄우고 고점 대비 ${f.cyc.drop}% 빠진 종목 — 매집 평단은 급등 시작 전 구간으로만 계산 (급등·급락 때 거래는 평단에서 제외)${f.accBeyond ? ' — 단, 급등 시작이 자료 맨 앞이라 그 전 매집 평단은 계산 불가' : ''}`);
  if (surged && upS >= 3) notes.push('상승 근거도 있지만 이미 크게 오른 뒤(또는 띄우기·털기 단계)라 상승 가능성 분류에서 제외');
  for (const n of x.xnotes || []) notes.push(n);
  const restr = ev.find((e) => e.kind === 'rightsR');
  if (restr) notes.push(`${ymdOf(restr.ms)} 증자는 채권단·출자전환 등 구조조정 목적으로 보여 작전 신호에서 제외`);
  return { dir, upS, downS, upRaw, downRaw, net: upRaw - downRaw, notes, tgt, rr, levels: lv.all, dates, up: up.sort((a, b) => b.w - a.w), down: down.sort((a, b) => b.w - a.w), cost: c ? { low: Math.round(c.low), high: Math.round(c.high) } : null, gap: gap == null ? null : Math.round(gap) };
}

// ───── 🔄 반등 성격: ① 기술적 반등(데드캣) ② 털기 중 반등(물량 넘기기) ③ 2차 작전(재매집 뒤 상승) ─────
//  남은 CB 물량(오버행): 회차별 가장 최근 전환청구 공시의 '미전환 잔액' ÷ 전환가 (청구 공시가 없는 회차는 발행 총액) — 추정
export function overhangOf(x, now = Date.now()) {
  const px = (x.px || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const ser = new Map();
  for (const p of px) if (p.ovh) { const k = p.ovh.ser ?? 'x'; if (!ser.has(k)) ser.set(k, { amt: p.ovh.amt, price: p.ovh.price, date: p.date, ref: p.ref, src: 'conv' }); }
  const unknownConv = ser.has('x');
  for (const p of px) if (p.cbx?.tot && (p.kind === 'cb') && (now - Date.parse(p.date)) < 3 * 365 * DAY) { if (p.cbx.ser == null && unknownConv) continue; /* 회차를 모르면 청구 공시 잔액과 겹칠 수 있어 빼기 */ const k = p.cbx.ser ?? 'c' + p.date; if (!ser.has(k)) ser.set(k, { amt: p.cbx.tot, price: p.p || null, date: p.date, ref: p.ref, src: 'cb' }); }
  const bought = (x.events || []).filter((e) => e.kind === 'cbbuy' && now - e.ms < 365 * DAY);
  if (!ser.size) return bought.length ? { shares: 0, amt: 0, list: [], bought: bought.length } : null;
  const list = [...ser.values()].map((v) => ({ ...v, shares: v.price ? Math.round(v.amt / v.price) : null }));
  const amt = list.reduce((a, v) => a + (v.amt || 0), 0), shares = list.reduce((a, v) => a + (v.shares || 0), 0);
  const av = x.f?.avgV20 || null;
  return { amt, shares, days: av && shares ? r1(shares / av) : null, list, bought: bought.length, est: list.some((v) => v.src === 'cb') };
}
export function reboundOf(x, now = Date.now()) {
  const f = x.f || {}, rb = f.rb, ev = x.events || [];
  if (!rb || f.halted || x.stage === '거래정지') return null;
  const A = [], Bw = [], C = [];
  const add = (arr, w, t) => arr.push({ w, t });
  const ov = overhangOf(x, now);
  const lowMs = Date.parse(rb.lowD + 'T15:30:00+09:00'), topMs = Date.parse(rb.topD + 'T15:30:00+09:00');
  // ① 데드캣
  if (rb.udv != null && rb.udv < 1) add(A, 2, `반등 중 오른 날 거래량이 내린 날보다 적음 (${rb.udv}배) — 사는 힘이 약함`);
  if (rb.volX != null && rb.volX < 0.7) add(A, 1, `반등 구간 거래량이 하락 막바지의 ${rb.volX}배로 줄어듦 — 개인 저가매수 수준`);
  const res = [f.cyc?.vwapPump, f.vwapHeavy].filter((v) => v && x.close && v > x.close).sort((a, b) => a - b)[0];
  if (res && x.close / res >= 0.9) add(A, 1, `바로 위 매물대 ${fmtW(res)}원까지 ${Math.round((res / x.close - 1) * 100)}% — 막히기 쉬운 자리`);
  if (rb.offHi != null && rb.offHi <= -10 && rb.days >= 5) add(A, 1, `반등 고점 대비 ${rb.offHi}% — 반등 힘이 꺾이는 중`);
  // ② 털기 중 반등
  if (rb.wick >= 2) add(Bw, 2, `반등 중 거래량 실린 긴 윗꼬리 ${rb.wick}번 — 올려 놓고 파는 모습`);
  const exitE = ev.filter((e) => ['conv', 'majsell', 'pledge'].includes(e.kind) && e.ms >= lowMs - 10 * DAY);
  if (exitE.length) add(Bw, Math.min(3, exitE.length + 1), `바닥 뒤에도 '${EV[exitE[0].kind].ko}' 공시 ${exitE.length}건 (${ymdOf(exitE[0].ms)} 등) — 물량이 계속 나옴`);
  if (ov?.shares && ov.days != null && ov.days >= 5) add(Bw, ov.days >= 20 ? 3 : 2, `아직 전환 안 된 CB 등 약 ${fmtW(ov.shares)}주 남음 (하루 평균 거래량의 ${ov.days}일치${ov.est ? ', 일부는 발행 총액 기준 추정' : ''}) — 반등 때마다 나올 수 있는 물량`);
  if (rb.volMed != null && rb.volMed >= 3 && (rb.udv ?? 9) < 1.3) add(Bw, 1, `거래는 평소의 ${rb.volMed}배로 많은데 오른 날·내린 날 차이가 작음 — 손바뀜(넘기기) 가능성`);
  // ③ 2차 작전
  if (f.cyc?.base2) add(C, 2, `바닥 ${f.cyc.base2.lowD} ${fmtW(f.cyc.base2.low)}원을 ${f.cyc.base2.held}거래일째 안 깨고 박스(폭 ${f.cyc.base2.box}%)를 만든 뒤 반등`);
  else if (rb.days >= 40) add(C, 1, `바닥(${rb.lowD})에서 ${rb.days}거래일 지나며 저점을 안 깸`);
  const heldM = (f.marks || []).filter((m) => m.ok && ['acc', 'absorb'].includes(m.k) && m.d > rb.lowD);
  if (heldM.length) add(C, 2, `바닥 뒤 버틴 매집봉·받아먹는 음봉 ${heldM.length}개 (${heldM.slice(-2).map((m) => m.d).join(', ')})`);
  if (rb.udv != null && rb.udv >= 1.5 && (rb.volX ?? 0) >= 1) add(C, 1, `반등 중 오른 날 거래량이 내린 날의 ${rb.udv >= 5 ? '5배 이상' : rb.udv + '배'} — 사는 쪽이 주도`);
  const newSet = ev.filter((e) => ['cb', 'rights3', 'mna', 'fund5'].includes(e.kind) && e.ms > topMs);
  if (newSet.length) add(C, 3, `고점 뒤 새 '${EV[newSet[0].kind].ko}' 공시 (${ymdOf(newSet[0].ms)}) — 새 판을 까는 신호`);
  if (ov && (ov.bought || (ov.shares != null && (ov.days ?? 99) < 2))) add(C, 2, ov.bought ? `CB 만기 전 취득(되사기) 공시 ${ov.bought}건 — 잠재 매도 물량이 줄어듦` : '남은 전환 물량이 거의 없음 (하루 거래량의 2일치 미만)');
  const insP = (x.px || []).filter((p) => p.kind === 'insider' && p.ins && p.date > rb.lowD);
  const iB = insP.reduce((a, p) => a + (p.ins.bq || 0), 0), iS = insP.reduce((a, p) => a + (p.ins.sq || 0), 0);
  if (iB > iS && iB > 0) add(C, 1, `바닥 뒤 내부자 장내 매수 ${fmtW(iB)}주`);
  if (iS > iB && iS > 0) add(Bw, 2, `바닥 뒤 내부자 장내 매도 ${fmtW(iS)}주`);
  if (x.ck?.broker?.top && !x.ck.broker.top.retail) add(C, 1, `'${x.ck.broker.top.nm}' 창구가 최근 ${x.ck.broker.n}일 중 ${x.ck.broker.top.days}일 매수 상위`);
  const sc = (arr) => arr.reduce((a, r) => a + r.w, 0);
  const s = { a: sc(A), b: sc(Bw), c: sc(C) };
  const best = Object.entries(s).sort((p, q) => q[1] - p[1]);
  const type = best[0][1] < 2 || best[0][1] === best[1][1] ? 'unclear' : { a: 'deadcat', b: 'dump', c: 'second' }[best[0][0]];
  return { type, s, why: { a: A, b: Bw, c: C }, rb, ov };
}
export const RB_KO = { deadcat: '① 기술적 반등(데드캣) 쪽', dump: '② 털기 중 반등(물량 넘기기) 쪽', second: '③ 2차 작전(재매집 뒤 상승) 쪽', unclear: '판단 보류 (근거가 비슷하거나 부족)' };

// ───── ✅ 성공 가능성 체크리스트 (규칙 계산 · AI 아님) ─────
//  ok: true 충족 · false 미충족 · null 자료 없음(계산에서 뺌)
//  x.ck: 바깥 자료(manipck.mjs enrich) — 최대주주 지분·감사의견·자본잠식·신용잔고·거래원·뉴스/종토방·업종 강세·시장 흐름·같은 세력 다른 종목
export function checklistOf(x, now = Date.now()) {
  const f = x.f || {}, ev = x.events || [], px = x.px || [], ck = x.ck || {};
  const d = x.dir || direction(x, now);
  const age = (e) => (now - e.ms) / DAY;
  const P = [], R = [];
  const add = (arr, k, ok, t, src) => arr.push({ k, ok, t, src: src || null });
  // ── 띄울 이유: 세력 자금 투입 ──
  const SET = ev.filter((e) => ['rights3', 'cb', 'mna', 'fund5'].includes(e.kind) && age(e) <= 365);
  const paid = ev.filter((e) => e.kind === 'paid' && age(e) <= 400);
  const fundBuy = px.find((p) => p.kind === 'fund5' && p.buys?.length);
  if (!SET.length) add(P, 'money', false, '세력 자금 투입 공시(3자배정·CB·최대주주 변경·투자조합 5%) 없음');
  else {
    const pd = paid.filter((pe) => SET.some((e) => pe.ms >= e.ms))[0] || null; // 세력 공시 '뒤에' 나온 납입·발행 완료만
    if (pd || fundBuy) add(P, 'money', true, `세력 자금 실제 투입 확인 — ${pd ? `${ymdOf(pd.ms)} '${pd.title}'` : `${fundBuy.date} 5% 신고자 장내 매수 ${fundBuy.buys.length}건`}`, pd?.id || fundBuy?.ref);
    else add(P, 'money', false, `${ymdOf(SET[0].ms)} '${EV[SET[0].kind].ko}' 발표는 있지만 납입·발행 완료 공시는 아직 못 찾음 (발표만으로는 약함)`, SET[0].id);
  }
  // 원가 근처
  const exitedNow = !!f.cyc && !['판 깔기', '매집'].includes(x.stage); // 이미 털고 나간 종목: 지난 사이클 평단·매집은 지금 근거가 아님
  if (exitedNow) add(P, 'cost', false, `이미 한 번 띄우고 빠진 종목 — 추정 평단(${d.cost ? fmtW(d.cost.low) + '원대' : '-'})은 지난 급등 전 가격이라 지금 세력이 남아 있다는 근거가 아님`);
  else if (d.gap == null) add(P, 'cost', null, '세력 원가를 계산할 근거 없음');
  else add(P, 'cost', d.gap <= 20 && d.gap >= -30, `현재가가 추정 세력 평단 대비 ${d.gap >= 0 ? '+' : ''}${d.gap}% ${d.gap <= 20 && d.gap >= -30 ? '— 세력도 아직 수익 구간이 아님(올려야 이익)' : d.gap > 20 ? '— 세력은 이미 이익 구간' : '— 평단보다 많이 아래(손실 중)'}`);
  // 물량 해제일 30~120일 앞
  const nd = (d.dates || []).find((z) => !z.past);
  if (!nd) add(P, 'unlock', null, '다가오는 물량 해제일(CB 전환청구 시작·3자배정 보호예수 해제) 없음');
  else { const dd = Math.round((Date.parse(nd.d) - now) / DAY); add(P, 'unlock', dd >= 30 && dd <= 120, `다음 물량 해제일 ${nd.d} (${dd}일 뒤)${dd >= 30 && dd <= 120 ? ' — 보통 띄우기가 나오는 2~3개월 전 구간' : dd < 30 ? ' — 이미 코앞(털기 주의)' : ' — 아직 멀음'}`, nd.ref); }
  // ── 띄울 힘 ──
  if (x.capPct == null) add(P, 'small', null, '시가총액 순위 자료 없음');
  else add(P, 'small', x.capPct <= 0.4, `시가총액 하위 ${Math.max(1, Math.round(x.capPct * 100))}%${x.capPct <= 0.4 ? ' 소형주 — 적은 돈으로 움직이기 쉬움' : ''}`);
  if (ck.major?.pct == null) add(P, 'float', null, `최대주주 등 지분율 자료 없음${ck.err?.major ? ` (${ck.err.major})` : ''}`);
  else add(P, 'float', ck.major.pct >= 40, `최대주주 등 지분 ${ck.major.pct}% (${ck.major.src}) ${ck.major.pct >= 40 ? '— 시장에 도는 물량이 적은 편' : '— 유통 물량이 많은 편'}`);
  const pur = ev.find((e) => e.kind === 'purpose' && age(e) <= 365);
  add(P, 'story', !!pur, pur ? `${ymdOf(pur.ms)} 정관·사업목적 변경 — 새 사업(테마) 재료 준비${pur.sum ? `: ${pur.sum.slice(0, 50)}` : ''}` : '최근 1년 사업목적 추가 없음', pur?.id);
  const heldAcc = (f.marks || []).some((m) => m.ok && m.k === 'acc' && m.h === 'held');
  const accOk = !exitedNow && (x.stage === '매집' || heldAcc || ((f.accObv ?? 0) >= 15 && (f.fromLow60 ?? 99) < 40));
  add(P, 'acc', accOk, exitedNow ? '지난 급등 전 매집 흔적만 있음 (급등·급락 뒤 새 매집 흔적은 아직 없음)' : accOk ? `매집 흔적 있음${heldAcc ? ' (버틴 매집봉)' : ''}${x.stage === '매집' ? ' · 단계 매집' : ''}${(f.accObv ?? 0) >= 15 ? ` · 순매수 흐름 ${f.accObv}%` : ''}` : '뚜렷한 매집 흔적 없음');
  if (!ck.theme) add(P, 'theme', null, '업종·테마 강세 자료 없음');
  else add(P, 'theme', ck.theme.ok, ck.theme.t);
  const insP = px.filter((p) => p.kind === 'insider' && p.ins && (now - Date.parse(p.date)) <= 120 * DAY);
  const insB = insP.reduce((a, p) => a + (p.ins.bq || 0), 0), insS = insP.reduce((a, p) => a + (p.ins.sq || 0), 0);
  if (!insP.length) add(P, 'insider', null, '최근 4개월 임원·주요주주 장내 매매 보고 없음(또는 원문 미확인)');
  else add(P, 'insider', insB > insS, `최근 4개월 내부자 장내 매수 ${fmtW(insB)}주 · 매도 ${fmtW(insS)}주`);
  if (!ck.broker?.n) add(P, 'broker', null, `거래원(증권사 창구) 자료 없음${ck.err?.broker ? ` (${ck.err.broker})` : ''}`);
  else if (ck.broker.n < 5 && !ck.broker.top) add(P, 'broker', null, `거래원 기록 ${ck.broker.n}일 — 5일 이상 쌓이면 창구 쏠림 판단 (매일 장 마감 뒤 기록)`);
  else add(P, 'broker', !!ck.broker.top, ck.broker.top ? `'${ck.broker.top.nm}' 창구가 최근 ${ck.broker.n}일 중 ${ck.broker.top.days}일 매수 상위 (순매수 추정 ${fmtW(ck.broker.top.net)}주)${ck.broker.top.retail ? ' — 개인 고객이 많은 창구라 의미 약함' : ''}` : `최근 ${ck.broker.n}일 특정 창구 쏠림 없음`);
  if (d.rr && (exitedNow || d.dir === 'down' || ['띄우기', '털기'].includes(x.stage))) add(P, 'rr', false, `손익비 1 : ${d.rr.v} — 하지만 ${exitedNow ? '엑시트 후' : d.dir === 'down' ? '하락 위험' : x.stage} 종목이라 목표까지 갈 근거가 약함`);
  else if (!d.rr) add(P, 'rr', null, '손익비 계산 안 됨');
  else add(P, 'rr', d.rr.v >= 2, `손익비 1 : ${d.rr.v}${d.rr.v >= 2 ? '' : ' (2 미만)'}`);
  // ── 실패·폭탄 신호 ──
  const fails = ev.filter((e) => e.kind === 'fail' && age(e) <= 365);
  const delays = px.filter((p) => p.delay);
  add(R, 'fail', fails.length + delays.length > 0, fails.length || delays.length ? `자금 문제 신호: ${[...fails.slice(0, 2).map((e) => `${ymdOf(e.ms)} ${e.title}`), ...delays.slice(0, 2).map((p) => `${p.date} 정정 공시에서 납입일 변경`)].join(' · ')}` : '증자·사채·양수도 철회·해제·납입 연기 없음', fails[0]?.id || delays[0]?.ref);
  const pn = penaltyOf(x, now);
  add(R, 'penalty', !!(pn && (pn.cum >= 10 || pn.pend)), pn ? `불성실공시 벌점 최근 1년 ${pn.cum ?? '?'}점${pn.pend ? ' · 지정 예고' : ''}` : '불성실공시 벌점 없음');
  const auditBad = ck.audit && !/적정/.test(ck.audit.op || '') ? ck.audit : null, capBad = ck.cap?.imp >= 50;
  const riskEv = ev.find((e) => e.kind === 'risk' && /감사의견|자본잠식|계속기업|상장적격성|관리종목|상장폐지/.test(e.title) && age(e) <= 365);
  if (!ck.audit && ck.cap?.imp == null && !riskEv) add(R, 'health', null, `감사의견·자본잠식 자료 없음${ck.err?.fin ? ` (${ck.err.fin})` : ''}`);
  else add(R, 'health', !!(auditBad || capBad || riskEv), [auditBad ? `감사의견 '${auditBad.op}' (${auditBad.y})` : ck.audit ? `감사의견 '${ck.audit.op}' (${ck.audit.y})` : '', ck.cap?.imp != null ? `자본잠식률 ${ck.cap.imp}%${capBad ? ' (50%↑ 관리종목 요건)' : ''}` : '', riskEv ? `${ymdOf(riskEv.ms)} ${riskEv.title}` : ''].filter(Boolean).join(' · '), riskEv?.id);
  const out = px.filter((p) => p.use && p.use.otherPct >= 50);
  const fundEv = ev.some((e) => ['cb', 'rights3', 'rights', 'rightsfix'].includes(e.kind) && age(e) <= 365);
  if (!out.length && !px.some((p) => p.use)) add(R, 'drain', null, fundEv ? '증자·사채 자금 사용 목적 원문 미확인' : '최근 1년 증자·사채 없음 (자금 유출 점검 대상 아님)');
  else add(R, 'drain', out.length > 0, out.length ? `${out[0].date} 조달 자금의 ${out[0].use.otherPct}%를 '타법인 증권 취득'에 씀 — 돈이 회사 밖으로 나갈 수 있음` : px.some((p) => p.use) ? '조달 자금 대부분이 운영·시설·채무상환 목적' : '자금 사용 목적 원문 미확인', out[0]?.ref);
  const plg = (d.down || []).find((r) => /반대매매/.test(r.t));
  add(R, 'pledge', !!plg, plg ? plg.t : '담보 반대매매선 근처 아님(또는 담보 없음)');
  add(R, 'insell', insS > insB && insS > 0, insS > insB ? `최근 4개월 내부자 장내 매도 ${fmtW(insS)}주가 매수보다 많음` : '내부자 매도 우위 아님');
  const badLinks = (ck.linkSt || []).filter((l) => ['엑시트 후', '털기'].includes(l.st) || l.risk);
  add(R, 'party', badLinks.length > 0, (x.links || []).length ? (badLinks.length ? `같은 이름이 나온 다른 종목 중 ${badLinks.map((l) => `${l.nm || l.c}(${l.st || '위험 공시'})`).slice(0, 3).join(', ')} — 이미 털렸거나 위험` : '같은 세력 연결 종목 중 털린 이력은 못 찾음') : '같은 세력 연결 없음');
  add(R, 'exited', x.stage === '엑시트 후', x.stage === '엑시트 후' ? '이미 한 번 띄우고 털고 나간 종목(엑시트 후)' : '엑시트 후 아님');
  if (ck.mkt20 == null) add(R, 'market', null, '시장 지수 흐름 자료 없음');
  else add(R, 'market', ck.mkt20 <= -5, `${x.mkt === 'P' ? '코스피' : '코스닥'} 최근 20거래일 ${ck.mkt20 > 0 ? '+' : ''}${ck.mkt20}%${ck.mkt20 <= -5 ? ' — 약세장이라 띄우기 성공률이 떨어짐' : ''}`);
  if (ck.credit?.rate == null) add(R, 'credit', null, `신용잔고 자료 없음${ck.err?.credit ? ` (${ck.err.credit})` : ''}`);
  else add(R, 'credit', ck.credit.rate >= 7, `신용잔고율 ${ck.credit.rate}%${ck.credit.rate >= 7 ? ' — 개인 신용이 많아 반대매매 유도 털기에 취약' : ''} (${ck.credit.date || ''})`);
  if (f.wf?.min) add(R, 'warn', f.wf.min.pct <= 10, f.wf.min.pct <= 0 ? `이미 투자경고 지정예고 요건(${f.wf.min.lbl}) 수준 — 경고·정지로 띄우기가 막힐 수 있음` : `내일 종가가 +${f.wf.min.pct}% 더 오르면 투자경고 지정예고 요건(${f.wf.min.lbl}) 도달 (근사 계산)`);
  if (ck.buzz?.newsX != null || ck.buzz?.boardN != null) add(P, 'buzz', (ck.buzz.newsX ?? 0) >= 3 || (ck.buzz.boardX ?? 0) >= 3, `기사 ${ck.buzz.news3 ?? '?'}건(최근 3일${ck.buzz.newsX != null ? `, 평소의 ${ck.buzz.newsX}배` : ''}) · 종토방 글 ${ck.buzz.boardN ?? '?'}건(24시간${ck.buzz.boardX != null ? `, 평소의 ${ck.buzz.boardX}배` : ''})${(ck.buzz.newsX ?? 0) >= 3 || (ck.buzz.boardX ?? 0) >= 3 ? ' — 기사·관심 몰이가 시작됨(띄우기 시작 신호일 수 있음)' : ' — 아직 조용함'}`);
  const known = P.filter((i) => i.ok != null), np = known.filter((i) => i.ok).length, nr = R.filter((i) => i.ok === true).length;
  const grade = np >= 6 && nr === 0 ? 'A' : np >= 4 && nr <= 1 ? 'B' : 'C';
  return { pos: P, red: R, np, nk: known.length, nr, grade };
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
{"stage":"판 깔기|매집|띄우기|털기|엑시트 후|관찰","level":"높음|중간|낮음","summary":"2문장 요약, 각 문장 끝에 [F번호]","upWhy":["상승 쪽 근거 문장 [F번호]"],"downWhy":["하락 쪽 근거 문장 [F번호]"],"counter":["정상적인 회사 활동일 가능성 [F번호]"],"acc":{"period":"매집 추정 기간(사실 목록의 날짜만 사용)","refs":["F번호"]},"cost":{"refs":["평단 근거 F번호들"]},"watch":["앞으로 확인할 신호(숫자 없이)"]}
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
    stage: ['판 깔기', '매집', '띄우기', '털기', '엑시트 후', '관찰'].includes(j.stage) ? j.stage : x.stage,
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
  let idx = null;
  try { idx = (await getJSONStrict('mp/idx')) || []; } catch (e) { console.warn('mp/idx 읽기 실패 — 목록은 그대로 둠', e.message); }
  if (idx && !idx.includes(date)) { idx.unshift(date); idx.sort((a, b) => (a < b ? 1 : -1)); await setJSON('mp/idx', idx); } // 날짜 목록은 계속 쌓음 (지우지 않음, 읽기 실패 땐 덮어쓰지 않음)
  return doc;
}

const AI_TOP = 15;
/** 크론(3분마다) — 한 번에 한 단계씩 */
export async function manipWatch({ force = false } = {}) {
  const now = Date.now(), z = kst(now);
  let st;
  try { st = (await getJSONStrict('mp/state')) || {}; } catch (e) { return { err: '상태 읽기 실패: ' + e.message }; } // 읽기 오류를 '처음 실행'으로 착각하지 않게
  if ((st.busyUntil || 0) > now) return { busy: true }; // 이전 실행이 아직 도는 중 (겹쳐 돌면 같은 일을 두 번 함)
  if (((await getJSON('mp/iq').catch(() => null))?.busyUntil || 0) > now) return { busy: 'incr' }; // 장중 재판단이 아직 도는 중
  if (st.force && !force) force = true;
  if (!force && !st.date) force = true; // 처음 올린 뒤엔 시간과 상관없이 한 번 바로 분석
  if (!force) {
    if (!isTradingDay('KR', z.date) || z.m < 15 * 60 + 50) return null;
    if (st.date === z.date && st.phase === 'done') return null;
  }
  const midForced = st.force && st.phase && st.phase !== 'done'; // 밤 12시를 넘겨 이어지는 수동 분석은 날짜를 바꾸지 않음
  if ((st.date !== z.date && !midForced) || (force && st.phase === 'done' && st.force)) Object.assign(st, { date: z.date, phase: 'snap', force: !!force, started: now, log: [], histDone: null });
  const date = st.date;
  st.busyUntil = now + (st.phase === 'ai' ? 300e3 : 170e3); // AI 단계는 오래 걸릴 수 있어 넉넉히
  await setJSON('mp/state', st).catch(() => {});
  const log = (m) => { st.log = [...(st.log || []), `${kst().date.slice(5)} ${String(Math.floor(kst().m / 60)).padStart(2, '0')}:${String(kst().m % 60).padStart(2, '0')} ${m}`].slice(-30); };
  const out = { phase: st.phase };
  try {
    if (st.phase === 'snap') {
      const snap = await snapshot().catch((e) => { log('시세 목록 실패: ' + e.message); return {}; });
      await setJSON(`mp/snap/${date}`, { at: now, rows: snap, partial: !!snap.partial });
      st.nSnap = Object.keys(snap).length;
      log(`전 종목 시세 ${st.nSnap}개${snap.partial ? ' (일부 쪽 실패 — 빠진 종목도 공시 후보면 분석)' : ''}`);
      st.phase = 'events';
    } else if (st.phase === 'events') {
      const ev = await loadEvents(now);
      const snapDoc = await getJSON(`mp/snap/${date}`);
      const snap = snapDoc?.rows || {};
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
      const pick = [...new Set([...scored.sort((a, b) => b.es - a.es).slice(0, 140).map((x) => x.code), ...hot, ...prev])].filter((c) => !Object.keys(snap).length || snapDoc?.partial || snap[c]);
      try { await setJSON('mp/party', { at: now, idx: buildPartyIndex(ev, Object.fromEntries(NAMES)) }); } catch (e) { log('세력 연결 색인 실패: ' + e.message); }
      await setJSON(`mp/ev/${date}`, { ev: Object.fromEntries(pick.map((c) => [c, keepEv(ev[c] || [])])), names: Object.fromEntries(pick.map((c) => [c, NAMES.get(c) || null])) });
      // 랭킹에 있는 종목(엑시트 후·털기 포함)은 공시가 없어도 매일 일봉으로 다시 봄 (조용한 재매집을 놓치지 않게)
      let rankCodes = [];
      try { const rk = (await getJSONStrict('mp/rank')) || {}; rankCodes = Object.entries(rk).filter(([, r]) => now - (r.up || 0) < 120 * DAY).map(([c]) => c); } catch {}
      const base = pick.slice(0, 220);
      st.recheck = rankCodes.filter((c) => !base.includes(c)).slice(0, 200);
      st.queue = [...base, ...st.recheck]; st.pos = 0; st.feat = {};
      log(`공시 패턴 종목 ${scored.length}개 · 거래 급증 ${hot.length}개 → 후보 ${st.queue.length}개`);
      st.phase = 'bars';
    } else if (st.phase === 'bars') {
      const part = st.queue.slice(st.pos, st.pos + 40);
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
        const ixD = await indexDaily().catch(() => ({}));
        const list = st.queue.map((code) => {
          const evs = ev[code] || [], s = eventScore(evs, now), f = st.feat[code] || null, r = snap[code] || [];
          if (f) applyMarks(f, evs, ixD, r[1] || 'Q');
          const ex = extras(code, evs, s.by, ctx);
          const total = Math.round((s.score + (f?.score || 0) + ex.add) * ex.mult * 10) / 10;
          const p = prevMap.get(code);
          return { code, name: r[0] || p?.name || NAMES.get(code) || code, mkt: r[1] || p?.mkt || null, close: r[2] ?? f?.close ?? null, pct: r[3] ?? null, mcap: r[6] ?? null, score: total, es: s.score, vs: f?.score || 0, xs: ex.add, by: s.by, sig: [...(f?.sig || []), ...ex.sig], xnotes: ex.notes, links: ex.links, warn: ex.warn, ind: ex.ind, capPct: ex.capPct, mult: ex.mult, f, stage: stageOf(s.by, f, evs), events: keepEv(evs), streak: (p?.streak || 0) + 1, ai: null, px: [] };
        }).filter((x) => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 80);
        for (const x of list) x.dir = direction(x, now);
        // 이전 날 AI 결과는 그대로 이어 보여 주지 않음 (그날 다시 분석)
        st.list = list.map((x) => x.code);
        await saveDay(date, list, { building: true });
        await saveProfiles(list, `${date} 정기 분석 (1차: 공시·거래량)`); // 랭킹에 바로 보이게 (원문 가격·AI는 이어서 채움)
        st.rq = st.queue.filter((c) => !list.some((x) => x.code === c) && (st.recheck || []).includes(c)); st.rpos = 0; // 랭킹 종목 중 오늘 목록에 안 든 것 → 따로 다시 판단
        st.docq = []; for (const x of list.slice(0, 30)) for (const e of docPick(x.events, 10)) st.docq.push({ code: x.code, e });
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
        const row = pxRow(p, q.e); if (row) x.px.push(row);
        // 제목만으론 몰랐던 '제3자배정' 증자 → 원문 확인 후 점수 다시 계산
        if ((p.third && q.e.kind === 'rights') || (p.restr && ['rights', 'rights3', 'rightsfix'].includes(q.e.kind))) {
          const ev = x.events.find((y) => y.id === q.e.id); if (ev) ev.kind = p.restr ? 'rightsR' : 'rights3';
          const s2 = eventScore(x.events, now); x.score = Math.round((s2.score + (x.vs || 0) + (x.xs || 0)) * (x.mult || 1) * 10) / 10; x.es = s2.score; x.by = s2.by; x.stage = stageOf(s2.by, x.f, x.events);
        }
      }
      st.dpos += part.length;
      if (doc) for (const x of doc.list) { x.dir = direction(x, now); x.cl = checklistOf(x, now); } // 원문 가격 반영 후 다시
      if (doc) doc.list.sort((a, b) => b.score - a.score);
      if (doc) await setJSON(`mp/day/${date}`, doc);
      if (st.dpos >= (st.docq || []).length) { st.phase = 'extra'; st.epos = 0; log('원문 가격 확인 완료 → 체크리스트 자료(지분·감사의견·신용·거래원·뉴스) 수집'); }
    } else if (st.phase === 'extra') {
      const doc = await getJSON(`mp/day/${date}`);
      const L = (doc?.list || []).slice(0, 40), part = L.slice(st.epos || 0, (st.epos || 0) + 4);
      const { enrich } = await import('./manipck.mjs');
      const ixD = await indexDaily().catch(() => ({}));
      for (const x of part) { try { await enrich(x, { ix: ixD }); } catch (e) { x.ck = { err: { all: String(e.message).slice(0, 60) } }; } x.dir = direction(x, now); x.cl = checklistOf(x, now); }
      st.epos = (st.epos || 0) + part.length;
      if (doc) await setJSON(`mp/day/${date}`, doc);
      if (st.epos >= L.length) { st.phase = 'recheck'; log(`체크리스트 자료 ${L.length}종목 → 랭킹 종목 일봉 재확인 ${(st.rq || []).length}개`); }
    } else if (st.phase === 'recheck') {
      // 오늘 목록엔 없지만 랭킹에 있는 종목: 공시는 그대로 두고 일봉으로 단계·평단·매집봉·손익비를 다시 계산 (AI 호출 없음)
      const part = (st.rq || []).slice(st.rpos || 0, (st.rpos || 0) + 25);
      const snap = (await getJSON(`mp/snap/${date}`))?.rows || {};
      const ixD = await indexDaily().catch(() => ({}));
      const done = [];
      for (const code of part) {
        try {
          const prev = await getJSON(`mp/prof/${code}`), f = st.feat?.[code];
          if (!prev || !f) continue;
          const r = snap[code] || [];
          const x = { ...prev, hist: undefined, log: undefined, f, close: r[2] ?? f.close ?? prev.close, pct: r[3] ?? null, mcap: r[6] ?? prev.mcap };
          applyMarks(f, x.events || [], ixD, x.mkt || 'Q');
          x.vs = f.score || 0; x.score = Math.round(((prev.es || 0) + x.vs + (prev.xs || 0)) * (prev.mult || 1) * 10) / 10;
          x.sig = [...(f.sig || []), ...((prev.sig || []).filter((t) => /세력 연결|거래소|소형주/.test(t)))];
          x.stage = stageOf(prev.by || {}, f, x.events || []);
          x.dir = direction(x, now);
          if (x.ai) x.ai = staleAi(x.ai, factsOf(x));
          x.dir = direction(x, now);
          done.push(x);
        } catch {}
      }
      if (done.length) await saveProfiles(done, `${date} 매일 일봉 재확인`, { keepAi: true, touch: false });
      st.rpos = (st.rpos || 0) + part.length;
      if (st.rpos >= (st.rq || []).length) { st.phase = 'ai'; st.apos = 0; log(`랭킹 종목 재확인 완료 → AI 분석 시작`); }
    } else if (st.phase === 'ai') {
      const doc = await getJSON(`mp/day/${date}`);
      const todo = (doc?.list || []).slice(0, AI_TOP).filter((x) => !x.ai).slice(0, 3);
      for (const x of todo) {
        try { x.ai = await aiReview(x); } catch (e) { x.ai = { error: String(e.message || e).slice(0, 120) }; }
        if (doc) await setJSON(`mp/day/${date}`, doc).catch(() => {}); // 한 건마다 저장 (중간에 끊겨도 같은 AI를 다시 부르지 않게)
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
    try {
      const doc = await getJSON(`mp/day/${date}`);
      for (const x of (doc?.list || []).slice(0, 40)) { const k = `mp/hist/${x.code}`; let h; try { h = (await getJSONStrict(k)) || []; } catch { continue; } if (!h.some((y) => y.d === date)) { h.unshift({ d: date, s: x.score, st: x.stage }); await setJSON(k, h.slice(0, 200)); } }
      await saveProfiles(doc?.list || [], `${date} 장 마감 정기 분석`);
      st.histDone = date;
      // 다 쓴 작업 목록은 비워서 상태를 가볍게 · 10일 지난 임시 자료(시세 목록·후보 공시·지수·장중 알림 상태) 정리 (mp/day 기록은 지우지 않음)
      delete st.feat; delete st.docq; delete st.queue; delete st.rq; delete st.recheck;
      for (const pre of ['mp/snap/', 'mp/ev/', 'mp/ix/', 'mp/live/']) await delKeys(pre, now - 10 * DAY).catch(() => {});
    } catch (e) { st.err = '마무리 저장 실패: ' + String(e.message || e).slice(0, 160); log('오류: ' + st.err); st.histDone = date; } // 같은 자리에서 무한 반복하지 않게
  }
  if (st.phase !== 'done') st.histDone = null;
  st.busyUntil = 0;
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
  const rrR = d.rr ? { v: d.rr.v, t: d.rr.t, ts: d.rr.ts, s: d.rr.s, ss: d.rr.ss, up: d.rr.up, dn: d.rr.dn } : null;
  const cm = (x.f?.marks || []).filter((m) => m.ok && !['up30', 'dn30'].includes(m.k)).length || null;
  const cl = x.cl || null;
  const rbk = x.rbk || null;
  return { ht: x.f?.halted ? x.f.halted.since : null, rbt: rbk?.type || null, av: x.f?.avgV20 ?? null, ckg: cl?.grade || null, cnp: cl?.np ?? null, cnk: cl?.nk ?? null, cnr: cl?.nr ?? null, rr: rrR, cm, pn: pn ? { c: pn.cum, pd: pn.pend, u: pn.unknown } : null, wn: x.warn?.lv || null, lk: (x.links || []).length || null, fl: x.f?.fromLow60 ?? null, d: d.dir, us: d.upS, ds: d.downS, nr: d.net ?? null, nt: d.notes?.length ? d.notes : null, tg: d.tgt ? d.tgt.map((t) => ({ p: t.p, s: t.s })) : null, nd: nd ? `${nd.d} ${nd.t.split(' ')[1] === 'CB' ? 'CB 전환 가능' : nd.t.includes('신주') ? '신주 매도 가능' : '추가 상장'}${nd.real ? '' : '(추정)'}` : null, ur: d.up.slice(0, 2).map((r) => r.t), dr: d.down.slice(0, 2).map((r) => r.t), gap: d.gap, n: x.name, m: x.mkt, s: x.score, st: x.stage, lv: a?.level || null, c: x.close, pct: x.pct, cl: d.cost?.low ?? a?.cost?.low ?? null, ch: d.cost?.high ?? a?.cost?.high ?? null, va: x.f?.vwapAcc ?? null, acc: x.f?.accStart ? `${x.f.accStart} ~ ${x.f.accEnd}` : a?.acc?.period || null, up: Date.now(), sum: a?.summary?.slice(0, 120) || null };
}
async function saveProfiles(list, reason, opt = {}) {
  let rank = null;
  try { rank = (await getJSONStrict('mp/rank')) || {}; } catch (e) { console.warn('mp/rank 읽기 실패 — 랭킹은 이번에 안 고침', e.message); }
  const alerts = [];
  const DK = { up: '📈 상승 가능성', down: '📉 하락 위험' };
  for (const x of list) {
    const k = `mp/prof/${x.code}`;
    const prev = (await getJSON(k)) || {};
    // 공시 원문 가격(CB 전환가·담보·잔액 등)은 이번에 다시 안 읽었으면 이전 것을 이어서 씀 (31~80위·원문 읽기 전 단계에서 지워지던 문제)
    if ((prev.px || []).length) {
      const refs = new Set((x.px || []).map((p) => p.ref));
      const add = prev.px.filter((p) => p.ref && !refs.has(p.ref));
      if (add.length) { x.px = [...(x.px || []), ...add].slice(0, 30); x.dir = null; }
    }
    // 분류 흔들림 방지: 점수가 경계선 근처에서 조금 바뀐 것만으로는 상승/하락 분류를 뒤집지 않음
    x.dir = x.dir || direction(x);
    if (!x.ck && prev.ck) x.ck = prev.ck; // 바깥 자료를 이번에 못 붙였으면 이전 것 사용
    const pd0 = prev.dir?.dir;
    if (pd0 && pd0 !== x.dir.dir) {
      const surged = (x.f?.fromLow60 ?? 0) >= 50 || ['띄우기', '털기', '엑시트 후'].includes(x.stage);
      const keepUp = pd0 === 'up' && !surged && x.dir.upS >= 2 && x.dir.upS >= x.dir.downS + 1;
      const keepDown = pd0 === 'down' && x.dir.downS >= 2 && x.dir.downS >= x.dir.upS;
      if (keepUp || keepDown) x.dir = { ...x.dir, dir: pd0, sticky: true };
    }
    const halted = !!x.f?.halted || x.stage === '거래정지';
    if (prev.at && halted && prev.stage !== '거래정지') alerts.push(`• ⛔ ${x.name} 거래정지로 보임 (${x.f?.halted?.since || ''}부터 거래 없음) — 이 종목 알림은 거래가 다시 열릴 때까지 멈춤`);
    if (prev.at && !halted) { // 처음 들어온 종목·거래정지 종목은 알림 안 함
      const nd = x.dir.dir, pd = prev.dir?.dir;
      if (prev.stage === '엑시트 후' && ['매집', '판 깔기'].includes(x.stage)) alerts.push(`• 🔁 ${x.name} 재매집 의심 — 엑시트 후 → ${x.stage}(2차)${x.f?.cyc?.base2 ? ` · ${x.f.cyc.base2.lowD} 바닥 ${fmtW(x.f.cyc.base2.low)}원 ${x.f.cyc.base2.held}거래일째 유지` : ''}`);
      else if (prev.stage && prev.stage !== x.stage && ['매집', '띄우기', '털기'].includes(x.stage)) alerts.push(`• ${x.name} 단계 ${prev.stage} → ${x.stage} (점수 ${prev.score}→${x.score})`);
      if (nd !== pd && DK[nd]) alerts.push(`• ${x.name} ${DK[nd]}로 분류 변경`);
      const newConv = (x.events || []).filter((e) => e.kind === 'conv' && !(prev.events || []).some((y) => y.id === e.id));
      if (newConv.length) alerts.push(`• ${x.name} 전환청구 공시 — 1~2주 뒤 추가 상장 물량 주의`);
    }
    x.cl = checklistOf(x);
    x.rbk = reboundOf(x);
    if (prev.at && !halted && x.rbk?.type === 'second' && prev.rbk?.type !== 'second') alerts.push(`• 🔄 ${x.name} 반등 성격이 '2차 작전(재매집 뒤 상승)' 쪽으로 바뀜 — ${x.rbk.why.c.slice(0, 2).map((r) => r.t).join(' / ').slice(0, 160)}`);
    const log = prev.log || [];
    const changed = !prev.at || prev.score !== x.score || prev.stage !== x.stage || (prev.ai?.level || null) !== (x.ai?.level || null);
    if (changed) log.unshift({ at: Date.now(), msg: `${reason} · 점수 ${prev.score ?? '-'}→${x.score} · ${prev.stage || '-'}→${x.stage}${x.ai?.level ? ` · 의심 ${x.ai.level}` : ''}` });
    const ai = opt.keepAi ? x.ai || null : x.ai && !x.ai.error ? x.ai : prev.ai || null; // 이번에 AI를 못 돌렸으면 이전 분석 유지
    const prof = { ...x, ai, hist: undefined, first: prev.first || Date.now(), at: Date.now(), log: log.slice(0, 60) };
    await setJSON(k, prof);
    if (opt.rank !== false && rank) { const row = rankRow(prof); if (opt.touch === false && rank[x.code]?.up) row.up = rank[x.code].up; rank[x.code] = row; } // 재확인·자동 갱신은 '최근 신호' 시각을 바꾸지 않음 (오래된 줄이 계속 남던 문제)
  }
  if (rank) {
    for (const [c, r] of Object.entries(rank)) if (Date.now() - (r.up || 0) > 120 * DAY) delete rank[c]; // 4개월 넘게 신호 없는 줄은 랭킹 목록에서만 정리 (종목 카드는 남김)
    await setJSON('mp/rank', rank);
  }
  if (alerts.length) {
    const mine = new Set(((await getJSON('mp/my'))?.items || []).filter((i) => !i.closed).map((i) => i.name));
    const codeOf = Object.fromEntries(list.map((x) => [x.name, x.code]));
    const lines = alerts.map((l) => ([...mine].some((nm) => l.startsWith(`• ${nm} `)) ? l.replace('• ', '• ⭐ ') : l));
    await radarAlert(lines, lines.map((l) => { const nm = Object.keys(codeOf).find((n) => l.includes(` ${n} `)); return nm ? codeOf[nm] : null; })).catch(() => {});
  }
}
export async function manipRank(kind = 'all') {
  const rank = (await getJSON('mp/rank')) || {};
  let list = Object.entries(rank).map(([code, r]) => ({ code, ...r }))
    .filter((r) => Date.now() - (r.up || 0) < 45 * DAY); // 45일 넘게 신호가 없던 종목은 랭킹에서만 내림 (카드·기록은 남김)
  list = list.filter((r) => !r.ht && r.st !== '거래정지'); // 거래정지 종목은 랭킹에서 뺌 (카드는 남김)
  // 예전 기준으로 저장된 줄도 새 기준(급등·털기 종목은 상승 가능성 제외)으로 다시 거름
  for (const r of list) if (r.d === 'up' && (['띄우기', '털기', '엑시트 후'].includes(r.st) || (r.fl ?? 0) >= 50)) r.d = 'none';
  if (kind === 'up') list = list.filter((r) => r.d === 'up').sort((a, b) => (b.nr ?? (b.us || 0) - (b.ds || 0)) - (a.nr ?? (a.us || 0) - (a.ds || 0)) || (b.us || 0) - (a.us || 0) || (a.gap ?? 0) - (b.gap ?? 0));
  else if (kind === 'ck') list = list.filter((r) => r.ckg && r.d !== 'down').sort((a, b) => ((b.cnp || 0) - 2 * (b.cnr || 0)) - ((a.cnp || 0) - 2 * (a.cnr || 0)) || (b.us || 0) - (a.us || 0));
  else if (kind === 'rr') list = list.filter((r) => r.rr && r.rr.v > 0 && r.d !== 'down' && !['띄우기', '털기', '엑시트 후'].includes(r.st)).sort((a, b) => b.rr.v - a.rr.v || (b.us || 0) - (a.us || 0));
  else if (kind === 'down') list = list.filter((r) => r.d === 'down').sort((a, b) => -(b.nr ?? (b.us || 0) - (b.ds || 0)) + (a.nr ?? (a.us || 0) - (a.ds || 0)) || (b.ds || 0) - (a.ds || 0) || b.s - a.s);
  else list.sort((a, b) => (LV[b.lv] || 0) - (LV[a.lv] || 0) || b.s - a.s);
  return list.slice(0, 150);
}
// ───── 📝 서술형 정리 (규칙으로 문장 조립 · AI 아님 → 계산된 숫자만 씀) ─────
export function narrativeOf(x, now = Date.now()) {
  const f = x.f || {}, d = x.dir || direction(x, now), cl = x.cl, rk = x.rbk || reboundOf(x, now), P = [];
  const mk = x.mkt === 'P' ? '코스피' : x.mkt === 'Q' ? '코스닥' : '';
  const won = (v) => `${fmtW(v)}원`, pc = (v) => `${v > 0 ? '+' : ''}${v}%`;
  const DIR = { up: '상승 가능성 쪽', down: '하락 위험 쪽' };
  if (f.halted || x.stage === '거래정지') return [`${x.name}${mk ? `(${mk})` : ''}은(는) ${f.halted?.since || ''} 무렵부터 거래가 없어 거래정지 중으로 보입니다. 정지 중에는 시세가 멈춰 있어 단계·평단·반등 판단을 하지 않고, 이 종목 알림도 멈췄습니다. 거래가 다시 열리면 자동으로 다시 분석합니다.`, '※ 공시와 거래 데이터로 자동 계산한 패턴 판단이며, 실제 세력의 존재나 불공정거래를 뜻하지 않습니다.'];
  P.push(`${x.name}${mk ? `(${mk})` : ''}은(는) 지금 '${x.stage || '관찰'}' 단계로 보입니다.${DIR[d.dir] ? ` 공시·거래 근거를 종합하면 ${DIR[d.dir]}으로 분류됩니다` : ' 상승·하락 어느 쪽도 뚜렷하지 않습니다'} (상승 근거 ${d.upS || 0}/10점 · 하락 근거 ${d.downS || 0}/10점, 작전 패턴 종합 점수 ${x.score ?? '-'}점).`);
  // 세력 흐름
  if (f.cyc) {
    let t = `${f.cyc.pumpD}부터 급등해 ${f.cyc.topD}에 ${won(f.cyc.top)}(급등 전 저점 대비 +${f.cyc.rise}%)까지 올랐다가, 지금은 그 고점 대비 ${f.cyc.drop}%입니다.`;
    if (f.cyc.base2) t += ` 고점 뒤 ${f.cyc.base2.lowD}에 찍은 바닥 ${won(f.cyc.base2.low)}을 ${f.cyc.base2.held}거래일째 깨지 않고 박스(폭 ${f.cyc.base2.box}%)를 만들고 있습니다.`;
    else if (x.stage === '엑시트 후') t += ' 한 번 띄우고 물량을 정리한 흔적으로 보며, 아직 새로 사 모으는 흔적은 뚜렷하지 않습니다.';
    P.push(t);
  }
  if (f.accStart) P.push(`${f.cyc ? (f.acc2 ? '고점 뒤 다시 사 모으는 구간(2차 매집 후보)은' : '급등 전에 사 모은 구간(매집 추정)은') : '거래 흐름상 매집 추정 구간은'} ${f.accStart} ~ ${f.accEnd}(${f.accDays}거래일)이며, 이 구간 가격은 ${won(f.accLow)}~${won(f.accHigh)}입니다${f.accObv != null ? ` (오른 날 거래가 내린 날보다 많은 정도 ${f.accObv}%)` : ''}.`);
  else if (f.accBeyond) P.push('급등 시작이 일봉 자료(약 1년 2개월) 맨 앞이라, 그 전 매집 구간과 평단은 계산할 수 없습니다.');
  // 평단·가격
  if (d.cost && x.close) {
    const exited = f.cyc && !['판 깔기', '매집'].includes(x.stage);
    let t = `공시 원문 가격과 매집 구간 평균가로 추정한 세력 평단은 ${d.cost.low === d.cost.high ? won(d.cost.low) : `${won(d.cost.low)}~${won(d.cost.high)}`}이고, 현재가 ${won(x.close)}은 평단 대비 ${pc(d.gap)}입니다${exited ? ' (이미 털고 나간 종목이라 이 평단은 지난 사이클 기준입니다)' : d.gap > 20 ? ' — 세력은 이미 이익 구간입니다' : d.gap >= -30 ? ' — 세력도 아직 크게 남는 구간이 아닙니다' : ''}.`;
    P.push(t);
  }
  if (d.rr) P.push(`위쪽 가장 가까운 근거 가격은 ${won(d.rr.t)}(${d.rr.ts}, ${pc(d.rr.up)}), 아래 손절 기준은 ${won(d.rr.s)}(${d.rr.ss}, ${d.rr.dn}%)로 손익비는 1 : ${d.rr.v}입니다${d.dir === 'down' || ['띄우기', '털기', '엑시트 후'].includes(x.stage) ? ' — 다만 지금 단계에서는 목표까지 갈 근거가 약합니다' : ''}.`);
  else if ((d.tgt || []).length === 0 && d.levels?.length) P.push('현재가 위쪽에는 공시 원가나 과거 고점 같은 근거 가격이 없습니다.');
  // 공시·물량
  const ev = x.events || [], age = (e) => (now - e.ms) / DAY;
  const setup = ev.filter((e) => ['mna', 'rights3', 'cb', 'fund5', 'purpose', 'refix'].includes(e.kind) && age(e) <= 365).slice(0, 3);
  if (setup.length) P.push(`최근 1년 판 깔기 성격 공시: ${setup.map((e) => `${ymdOf(e.ms)} ${EV[e.kind].ko}`).join(', ')}.`);
  const exitE = ev.filter((e) => ['conv', 'majsell', 'pledge'].includes(e.kind) && age(e) <= 90);
  if (exitE.length) P.push(`최근 3개월 물량이 나올 수 있는 공시가 ${exitE.length}건 있습니다 (가장 최근 ${ymdOf(exitE[0].ms)} ${EV[exitE[0].kind].ko}).`);
  const nd = (d.dates || []).find((z) => !z.past);
  if (nd) P.push(`다음 물량 해제 예정일은 ${nd.d}입니다 (${nd.t}${nd.real ? ', 공시 원문 기준' : ', 추정'}).`);
  const ov = rk?.ov || overhangOf(x, now);
  if (ov?.shares) P.push(`아직 주식으로 바뀌지 않은 CB 등 잠재 물량이 약 ${fmtW(ov.shares)}주${ov.days != null ? `(하루 평균 거래량의 ${ov.days}일치)` : ''} 남아 있는 것으로 추정됩니다${ov.est ? ' (일부는 발행 총액 기준)' : ''}.`);
  const pn = penaltyOf(x, now);
  if (pn?.cum) P.push(`불성실공시 벌점은 최근 1년 누계 ${pn.cum}점입니다 (15점이 넘으면 ${x.mkt === 'P' ? '관리종목' : '상장적격성 실질심사'} 기준).`);
  // 반등·매집봉·경보
  if (rk) P.push(`최근 반등(${rk.rb.lowD} 바닥 대비 +${rk.rb.up}%)은 ${RB_KO[rk.type]}으로 봅니다${rk.type !== 'unclear' ? ` — ${({ deadcat: rk.why.a, dump: rk.why.b, second: rk.why.c }[rk.type][0] || {}).t || ''}` : ''}.`);
  const marks = (f.marks || []).filter((m) => m.ok && !['up30', 'dn30'].includes(m.k));
  if (marks.length) P.push(`일봉에서 인정된 매집 흔적이 ${marks.length}개 있습니다 (${marks.slice(-3).map((m) => `${m.d} ${MARK_KO[m.k]}`).join(', ')}).`);
  if (f.wf?.min && f.wf.min.pct <= 15) P.push(f.wf.min.pct <= 0 ? `이미 투자경고 지정예고 요건(${f.wf.min.lbl}) 수준이라 경고·매매정지로 띄우기가 막힐 수 있습니다.` : `내일 종가가 +${f.wf.min.pct}% 더 오르면 투자경고 지정예고 요건(${f.wf.min.lbl})에 닿습니다 (근사 계산).`);
  // 체크리스트
  if (cl) {
    const bad = cl.red.filter((i) => i.ok === true).map((i) => i.t);
    const good = cl.pos.filter((i) => i.ok === true).map((i) => i.t);
    P.push(`성공 가능성 체크리스트는 ${cl.grade}등급입니다 (성공 조건 ${cl.np}/${cl.nk} 충족 · 위험 신호 ${cl.nr}개).${good.length ? ` 좋은 점: ${good.slice(0, 2).join(' / ')}.` : ''}${bad.length ? ` 조심할 점: ${bad.slice(0, 2).join(' / ')}.` : ''}`);
  }
  P.push('※ 공시와 거래 데이터로 자동 계산한 패턴 판단이며, 실제 세력의 존재나 불공정거래를 뜻하지 않습니다. 매매 판단은 직접 하세요.');
  return P;
}

// 예전 방식으로 저장된 카드인지 (매집봉·지난 사이클·시장경보 계산이 없음)
export const isOldProf = (p) => !p?.f || !Array.isArray(p.f.marks) || !('cyc' in p.f) || !('wf' in p.f);
// 예전 AI 문장 중 새 사실 목록에 없는 숫자를 말하는 문장은 숨김 (예: 틀린 평단 84,099원)
function staleAi(ai, F) {
  if (!ai || ai.error) return ai;
  const pool = F.map((f) => f.t).join(' ').replace(/,/g, '');
  const ok = (t) => numsIn(t).every((n) => pool.includes(n));
  const fix = (arr) => (Array.isArray(arr) ? arr.filter((r) => ok(typeof r === 'string' ? r : r.t)) : arr);
  const out = { ...ai, upWhy: fix(ai.upWhy), downWhy: fix(ai.downWhy), counter: fix(ai.counter), evidence: fix(ai.evidence) };
  if (ai.summary && !ok(ai.summary)) { out.summary = null; out.stale = true; }
  if (ai.acc?.period && !ok(ai.acc.period)) out.acc = null;
  if (ai.cost && F.every((f) => !f.price || ![ai.cost.low, ai.cost.high].includes(f.price))) out.cost = null;
  return out;
}
/** 예전 방식 카드 → 지금 방식으로 다시 계산해서 저장 (AI는 새로 부르지 않음, 맞지 않는 예전 AI 문장은 숨김) */
export async function migrateProf(code, reason = '새 계산 방식으로 자동 갱신') {
  const prev = await getJSON(`mp/prof/${code}`);
  const idx = (await getJSON('mp/idx')) || [];
  const snap = (await getJSON(`mp/snap/${idx[0] || kst().date}`))?.rows || {};
  const ctx = await ctxLoad(snap);
  const x = await analyzeOne({ c: code, name: prev?.name || null, mkt: prev?.mkt || null }, { snap, ctx, keepLow: true, aiOk: () => false });
  if (!x || !x.f) return null; // 일봉을 못 받으면 그대로 둠
  if (!x.events.length && (prev?.events || []).some((e) => Date.now() - e.ms < 170 * DAY)) return null; // 최근 공시가 있었는데 하나도 못 읽어 왔으면(보관소 오류 등) 그대로 둠
  if (x.ai) x.ai = staleAi(x.ai, factsOf(x));
  const inRank = !!(await getJSON('mp/rank'))?.[code] || x.score >= 4;
  await saveProfiles([x], reason, { rank: inRank, keepAi: true, touch: false });
  return x;
}
export async function manipProfile(code) {
  let p = await getJSON(`mp/prof/${code}`);
  let migrated = false;
  if (p && isOldProf(p) && Date.now() - (p.migTry || 0) > 6 * 3600e3) {
    try { if (await migrateProf(code, '열어 볼 때 새 계산 방식으로 자동 갱신')) { p = await getJSON(`mp/prof/${code}`); migrated = true; } else { p.migTry = Date.now(); await setJSON(`mp/prof/${code}`, { ...p, hist: undefined }).catch(() => {}); } } catch {} // 실패하면 6시간 동안 다시 시도 안 함 (열 때마다 느려지지 않게)
  }
  if (p && migrated) p.migrated = true;
  if (p) {
    p.hist = ((await getJSON(`mp/hist/${code}`)) || []).slice(0, 30);
    // 그래도 예전 카드면(일봉 못 받음) 저장된 자료로 손익비·사다리·체크리스트만 다시 계산 (상승/하락 분류는 저장된 값 유지)
    try {
      const d2 = direction(p);
      p.dir = { ...d2, dir: p.dir?.dir ?? d2.dir, sticky: p.dir?.sticky };
      if (!p.cl) { p.cl = checklistOf(p); p.clOld = true; }
      if (!p.rbk) p.rbk = reboundOf(p);
      p.story = narrativeOf(p);
    } catch (e) { console.warn('manipProfile', e.message); }
  }
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
  if (f) applyMarks(f, evs, await indexDaily().catch(() => ({})), snap[code]?.[1] || job.mkt || (await getJSON(`mp/prof/${code}`))?.mkt || 'Q');
  const ex = extras(code, evs, s.by, ctx || {});
  const score = Math.round((s.score + (f?.score || 0) + ex.add) * ex.mult * 10) / 10;
  if (score < 4 && !prev && !keepLow) return null; // 원래 레이더에 없던 종목이고 점수도 낮으면 넘김
  const x = { code, name: r[0] || (prev?.name && prev.name !== code ? prev.name : null) || job.name || code, mkt: r[1] || prev?.mkt || job.mkt || null, close: f?.close ?? r[2] ?? null, pct: r[3] ?? prev?.pct ?? null, mcap: r[6] ?? prev?.mcap ?? null, score, es: s.score, vs: f?.score || 0, xs: ex.add, mult: ex.mult, by: s.by, sig: [...(f?.sig || []), ...ex.sig], xnotes: ex.notes, links: ex.links, warn: ex.warn, ind: ex.ind, capPct: ex.capPct, f, stage: stageOf(s.by, f, evs), events: keepEv(evs), streak: prev?.streak || 1, px: [], ai: prev?.ai || null };
  // 공시 원문 가격 (새 공시 포함)
  for (const e of docPick(evs, 10)) {
    const p = await docPrice(e).catch(() => null);
    const row = p ? pxRow(p, e) : null; if (row) x.px.push(row);
    if (p?.restr && ['rights', 'rights3', 'rightsfix'].includes(e.kind)) e.kind = 'rightsR';
    else if (p?.third && e.kind === 'rights') e.kind = 'rights3';
  }
  const s2 = eventScore(evs, now); x.es = s2.score; x.by = s2.by; x.score = Math.round((s2.score + x.vs + (x.xs || 0)) * (x.mult || 1) * 10) / 10; x.stage = stageOf(s2.by, f, x.events);
  x.dir = direction(x, now);
  try { const { enrich } = await import('./manipck.mjs'); await enrich(x, { fresh: !!forceAi }); } catch {} // 체크리스트 바깥 자료
  x.dir = direction(x, now);
  // 공시가 바뀌었고 점수가 의미 있으면 AI 다시 (검색은 항상)
  const sig = evs.filter(weighted).slice(0, 25).map((e) => e.id).join(','); // 점수 없는 공시(내부자 보고 등)로는 AI를 다시 부르지 않음
  if (((forceAi && (f || evs.length)) || (x.score >= 6 && sig !== prev?.evSig)) && aiOk()) {
    try { x.ai = await aiReview(x); aiUsed(); } catch (e) { x.ai = prev?.ai || { error: String(e.message || e).slice(0, 120) }; }
  }
  x.evSig = sig;
  x.dir = direction(x, now);
  x.cl = checklistOf(x, now);
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
  let st, iq;
  try { st = (await getJSONStrict('mp/state')) || {}; iq = (await getJSONStrict('mp/iq')) || { seen: [], q: [], day: '', ai: 0 }; } catch { return null; }
  if (st.phase && st.phase !== 'done' && st.date === z.date) return null; // 정기 분석 중엔 쉼
  if ((st.busyUntil || 0) > now || (iq.busyUntil || 0) > now || ((await getJSON('mp/auxlock').catch(() => null))?.busyUntil || 0) > now) return null; // 다른 실행이 도는 중
  iq.busyUntil = now + 170e3; await setJSON('mp/iq', iq).catch(() => {});
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
  iq.busyUntil = 0;
  await setJSON('mp/iq', iq);
  out.left = iq.q.length;
  return out.n || out.err ? out : null;
}

// 보조 작업 (크론): 시장경보 수집(6시간마다) · 성적표 채우기
export async function manipAux() {
  const out = {};
  const lk = (await getJSON('mp/auxlock').catch(() => null)) || {};
  if ((lk.busyUntil || 0) > Date.now()) return null;
  const iq0 = await getJSON('mp/iq').catch(() => null); if ((iq0?.busyUntil || 0) > Date.now()) return null;
  await setJSON('mp/auxlock', { busyUntil: Date.now() + 170e3 }).catch(() => {});
  try {
    const { warnWatch, perfWatch } = await import('./manipx.mjs');
    const idx = (await getJSON('mp/idx')) || [];
    const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
    const n2c = {}; for (const [c, r] of Object.entries(snap)) if (r[0]) n2c[r[0]] = c;
    const w = await warnWatch(n2c); if (w) out.warn = w;
    const p = await perfWatch(15); if (p) out.perf = p;
    // 예전 방식 랭킹 줄을 조금씩 새 방식으로 (한 번에 3종목)
    const rank = (await getJSON('mp/rank')) || {};
    const tried = (await getJSON('mp/migtry')) || {};
    const old = Object.entries(rank).filter(([c, r]) => (!('av' in r) || (Array.isArray(r.tg) && typeof r.tg[0] === 'number')) && Date.now() - (tried[c] || 0) > 6 * 3600e3).sort((a, b) => (b[1].s || 0) - (a[1].s || 0)).slice(0, 3);
    let mg = 0; for (const [c] of old) { tried[c] = Date.now(); try { if (await migrateProf(c)) mg++; } catch {} }
    if (old.length) await setJSON('mp/migtry', Object.fromEntries(Object.entries(tried).filter(([, t]) => Date.now() - t < 7 * DAY))).catch(() => {});
    if (old.length) out.migrate = { done: mg, left: Object.values(rank).filter((r) => !('av' in r)).length - mg };
  } catch (e) { out.err = String(e.message || e).slice(0, 120); }
  await setJSON('mp/auxlock', { busyUntil: 0 }).catch(() => {});
  return Object.keys(out).length ? out : null;
}

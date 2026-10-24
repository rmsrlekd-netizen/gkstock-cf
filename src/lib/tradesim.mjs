import { simPol, POL } from './exitlab.mjs'; const POL_S3 = POL.find((p) => p.id === 'S3'); // v274 💰 S3 (규칙 1판 매도)
// 📈 매매 따라하기 성적 (v222) — "신호가 새로 뜬 날 사서 규칙대로 팔았다면"
//  ① 거래 만들기 (simTrades)
//    · 진입: 신호가 '새로' 뜬 날(최근 10거래일 안 같은 신호 없음 + 같은 신호로 산 게 끝난 뒤) 다음 날 시가
//      다음 날 시가가 판정일 종가보다 +25%↑(상한가 근처)면 실제로 못 삼 → 거래 안 셈(nf 개수만)
//    · 비용 0.5% (수수료·세금 약 0.2% + 소형주 체결 미끄러짐 0.3%)
//    · 매도 T(1차 목표 팔기): 손절선 → 1차 목표 → 판정 🔴 전환(다음 날 시가) → 60거래일 / U(끝까지): 목표만 뺌
//      같은 날 둘 다 닿으면 손절(보수적) · 시가가 넘어 열리면 시가 체결 · 10일↑ 거래 끊긴 채 끝나면 마지막 종가('거래정지')
//    · 손절·목표 조합 16개(손절 −7/−10/−15%/세력 원가 × 목표 +15/+30%/1차 목표/없음)를 같이 계산 → 가장 좋은 규칙 찾기
//    · 기간 안 최고(mfe)·최저(mae), 같은 기간 시장(코스피/코스닥) 대비 수익률, 진입 당시 조건(단계·등급·손익비·평단 거리·시장 흐름 등)
//    · 분할 매수(ST·SU): 3번 나눠 사기 — 진입일·5거래일 뒤·10거래일 뒤 시가에 1/3씩 (그 전에 팔렸으면 더 안 삼), 파는 규칙은 같음
//      수익률 = 실제로 넣은 돈 기준 · 진입 당시 20일 평균 하루 거래대금(lq, 억 원)도 기록 → 거래대금별 성과 비교
//    · 판정 규칙 버전(rv)을 거래에 남김 → '지금 규칙 이후만' 따로 통계
//  ② 통계 (simStats) — 운이 아니라 실력인지 가리기
//    · 기준선: '레이더에 처음 오른 종목 전체'와 비교 (같은 종목군에서 아무거나 샀을 때보다 나은가)
//    · 붓스트랩 90% 범위: 같은 주(週)에 산 거래는 시장 영향을 같이 받으므로 주 단위로 묶어 다시 뽑기 → 평균·기준선 대비 차이의 범위
//    · 판정: 차이 범위가 0보다 확실히 위 '✅ 효과 있음' / 80%↑ '좋아 보임' / 20%↓ '나빠 보임' / 아래 '❌ 역효과' / 나머지 '아직 모름'
//    · 앞·뒤 기간 나눠 보기(시간 순 앞 2/3 · 뒤 1/3) — 한쪽에서만 좋으면 우연일 가능성
//    · 최적 손절·목표: 앞 2/3에서 고른 규칙을 뒤 1/3(안 본 기간)에 적용한 결과로 검증 (과최적화 방지)
//    · 계좌로 따라 했다면: 동시에 최대 5종목·종목당 계좌 20% → 누적 수익·최대 낙폭(MDD)
//    · 흔들기: 손절된 거래 중 60일 안에 진입가 +20%를 다시 찍은 비율 (손절이 너무 좁은지)
//    · 조건별 효과(전체 거래 기준): 조건마다 '있을 때 − 없을 때' 평균 차이와 범위 → 어떤 조건이 실제로 성과를 올리는지
export const SIGS = [
  ['g', '🟢 매수 검토 (= 매매 후보 조건 통과)'], // v223: '🎯 매매 후보 조건 충족'(pk)은 🟢와 정의가 같아 숫자가 늘 같았음 → 하나로
  ['A', '체크리스트 A등급'],
  ['AB', '체크리스트 A·B등급'],
  ['acc', '매집·판 깔기 단계'],
  ['up', '상승 가능성 분류'],
  ['hot', '🔥 띄우기·엑시트 후 (단타 구간)'],
  ['all', '레이더에 처음 오른 종목 전체'],
];
// v222: 'hot' = 레이더가 🔴로 빼던 띄우기·엑시트 후 — 과거 재현에서 손익비가 가장 높게 나와(1:2.1~2.6) 단타 구간으로 따로 검증 (🔴여도 사고, 판정 🔴 전환으로 팔지 않음)
const BIT = { g: 1, pk: 2, A: 4, AB: 8, acc: 16, up: 32, all: 128, hot: 256 };
const BAD = 64;
export const WHY_X = { stop: '손절선', tgt: '목표가', view: '판정 🔴 전환', time: '기간 끝 정리', halt: '거래정지', trail: '최고점 대비 −15%' };
const COST = 0.5, HOLD = 60, COOL = 10, NOFILL = 1.25;
export const PK_H = [5, 20, 60, 120]; // 최고·최저 기록 기간(거래일)
export const MODES = ['T', 'U', 'ST', 'SU', 'TR', 'TH', 'PL', 'PR', 'TT', 'BK', 'S3']; // v274 S3: 규칙 1판 매도 — 3번 나눠 사기(0·−10·−20%) · 손절 −30% · 최고점 −20% · 60일 (🚪 4년치 비교에서 🟢 ✅) // v230 BK: 돌파 확인 뒤 진입(판정 뒤 10거래일 안에 20일 고가를 거래량 1.5배↑로 넘긴 다음 날 시가) + TT 매도 · // v227 TT: 최고점 −15% 또는 20거래일 지나면 팔기 (과거 재현: 고점까지 중간값 14거래일) // v223 PL·PR: 눌림 진입(판정 뒤 5거래일 안 판정일 종가 −3% 지정가, 안 오면 안 삼) → PL 1차 목표 팔기 · PR 최고점 −15% 팔기
export const BK_D = 10, BK_VX = 1.5; // v230 돌파 확인: 판정 뒤 10거래일 · 거래량 1.5배
const PULL = 0.97, PULL_D = 5; // 한 번에 사기(목표 팔기·끝까지) · 3번 나눠 사기(목표 팔기·끝까지) · v222 추적 매도(TR: 최고점 대비 −15% / TH: +30%에 절반·나머지 최고점 대비 −15%)
export const GRID_S = [7, 10, 15, 'c'], GRID_T = [15, 30, 't', 0]; // 'c' = 세력 원가 손절선, 't' = 1차 목표가, 0 = 목표 없음
const gridName = (gi) => { const s = GRID_S[gi >> 2], t = GRID_T[gi & 3]; return `손절 ${s === 'c' ? '세력 원가' : '−' + s + '%'} · ${t === 't' ? '1차 목표가' : t ? '+' + t + '%' : '목표 없이 끝까지'}`; };
export const GI_T = 3 * 4 + 2, GI_U = 3 * 4 + 3; // 기본 두 방식의 칸 번호
/** 그날 판정 한 줄 → 신호 비트 */
export function flagsOf(r) {
  let f = BIT.all;
  if (r.vd === 'g') f |= BIT.g;
  if (r.pk === 1) f |= BIT.pk;
  if (r.ck === 'A') f |= BIT.A;
  if (r.ck === 'A' || r.ck === 'B') f |= BIT.AB;
  if (r.st === '매집' || r.st === '판 깔기') f |= BIT.acc;
  if (r.dir === 'up') f |= BIT.up;
  if (r.st === '띄우기' || r.st === '엑시트 후') f |= BIT.hot;
  if (r.vd === 'r' || (!r.vd && (r.ck === 'D' || ['털기', '엑시트 후', '거래정지'].includes(r.st)))) f |= BAD;
  return f;
}
/** 진입 당시 조건 (조건별 효과 분석용, 짧게) */
export function attrsOf(r) {
  const b = (v, cuts, names) => { if (v == null || Number.isNaN(v)) return null; for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return names[i]; return names[cuts.length]; };
  const ckv = {}; for (const [k, v] of Object.entries(r.ckv || {})) if (CK_KO[k]) ckv['c_' + k] = v ? '✓' : '✗'; // v222: 체크리스트 항목 하나하나의 효과
  const evA = {}; for (const k of r.ev || []) evA['e_' + k] = '있음';
  for (const k of r.rd || []) evA['r_' + k] = '걸림'; // v231 위험 항목
  for (const k of r.mv || []) evA['e_mv_' + k] = '있음'; // v233 공시의 속뜻(무자본 M&A 구조·전환가 낮추기 등) // v224: 최근 60일에 나온 공시 종류
  const chA = { lo: b(r.lo60, [10, 30, 60], ['+10% 안', '+10~30%', '+30~60%', '+60%↑']), bx: b(r.bx, [30, 60], ['30% 안(좁음)', '30~60%', '60%↑(넓음)']), cy: r.cy == null ? null : r.cy ? '있음' : '없음', p1: r.p1 == null ? null : r.p1 ? '있음' : '없음', mb: r.mk2 == null ? null : r.mk2 >= 2 ? '2개↑' : r.mk2 ? '1개' : '없음' };
  return { ...ckv, ...evA, ...(r.ev ? chA : {}), st: r.st || null, ck: r.ck || null, rr: b(r.rr, [2, 3], ['2 미만', '2~3', '3 이상']), gp: b(r.gp, [0, 15, 50], ['평단 아래', '평단 +0~15%', '평단 +15~50%', '평단 +50%↑']), dir: r.dir === 'up' ? '상승' : r.dir === 'down' ? '하락 위험' : '없음', cm: r.cm > 0 ? '있음' : '없음', px: r.pexl || null, vd: r.vd || null };
}
const CK_KO = { money: '세력 자금 실제 투입', cost: '평단 근처', acc: '매집 흔적', unlock: '물량 해제 2~3개월 전', rr: '손익비 2↑', small: '소형주', float: '최대주주 지분 40%↑', story: '사업목적 추가', theme: '업종·테마 강세', insider: '내부자 매수', broker: '창구 쏠림', buzz: '기사·종토방 증가' };
export const ATTR_KO = { ...Object.fromEntries(Object.entries(CK_KO).map(([k, v]) => ['c_' + k, '체크: ' + v])), p5: '판정 전 5일 상승률', vx: '판정일 거래량(20일 평균 대비)', lq: '하루 거래대금(20일 평균)', lo: '60일 저점 대비 위치', bx: '60일 가격 폭', cy: '지난 급등·급락 사이클', p1: '최근 1차 급등', mb: '버틴 매집봉 수', st: '단계', ck: '체크리스트 등급', rr: '손익비', gp: '평단 대비 위치', dir: '분류', cm: '매집봉 흔적', px: '털기 후 상승', vd: '한 줄 결론', mk: '진입 때 시장 흐름(20일)', eg: '진입 갭(다음 날 시가)' };
const r1 = (x) => Math.round(x * 10) / 10;
export const RD_KO = { fail: '철회·납입 연기', health: '감사의견·자본잠식', penalty: '불성실공시 벌점', pledge: '담보 반대매매', insell: '내부자 매도 우위', delistx: '상장폐지·관리 요건', delist: '관리종목 요건 근처', nocap: '무자본 M&A 의심', tsell: '자사주 처분', exited: '엑시트 후', credit: '신용잔고 많음', warn: '투자경고 근처', drain: '자금 빼돌림 의심', party: '같은 세력 다른 종목 털림', unlock30: '물량 해제 30일 안' };
const BOMB_KEYS = ['fail', 'health', 'penalty', 'pledge', 'insell', 'delistx'];

/**
 * B: 일봉(감자 보정) · tl: [{d, f, tp, sp, a}] 레이더 목록에 있던 날들(날짜순)
 * opt: { last(판정 기록 마지막 날), final(과거 재현), now, ix(지수 일별 등락 {날짜:{P,Q}}), mkt('P'|'Q') }
 */
export function simTrades(B, tl, opt = {}) {
  if (!B?.length || !tl?.length) return { trades: [], nf: {} };
  const ix = (d) => { let lo = 0, hi = B.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m].d <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  const pts = tl.map((p) => ({ ...p, i: ix(p.d) })).filter((p) => p.i >= 0);
  const badI = pts.filter((p) => p.f & BAD).map((p) => p.i);
  const lastI = opt.last ? ix(opt.last) : B.length - 1;
  const stale = opt.now && Date.parse(B[B.length - 1].d) < opt.now - 10 * 864e5;
  const mk = opt.mkt === 'P' ? 'P' : 'Q';
  const mret = (a, b) => { if (!opt.ix) return null; let m = 1, n = 0; for (let k = a; k <= b; k++) { const p = opt.ix[B[k]?.d]?.[mk]; if (p != null) { m *= 1 + p / 100; n++; } } return n ? (m - 1) * 100 : null; };
  const out = [], nf = {};
  for (const [s] of SIGS) {
    const bit = BIT[s];
    let lastOn = -1e9, busyTo = -1;
    for (const p of pts) {
      if (!(p.f & bit)) continue;
      const fresh = p.i - lastOn > COOL;
      lastOn = p.i;
      if (!fresh || p.i <= busyTo || (p.f & BAD && s !== 'hot')) continue;
      const ei = p.i + 1; if (!B[ei]) continue;
      const e = B[ei].o || B[ei].c;
      if (e >= B[p.i].c * NOFILL) { nf[s] = (nf[s] || 0) + 1; continue; } // 상한가 근처로 열려 실제로 못 삼
      const spc = p.sp > 0 && p.sp < e ? p.sp : e * 0.9, tpt = p.tp > e ? p.tp : e * 1.2;
      const vb = s === 'hot' ? null : badI.find((b) => b >= ei); // 단타 구간은 🔴 전환으로 팔지 않음(원래 🔴)
      const run = (spx, tpx) => {
        for (let k = ei; k < Math.min(B.length, ei + HOLD); k++) {
          const x = B[k];
          if (vb != null && k === vb + 1) return { px: x.o || x.c, k, w: 'view' };
          if (x.l <= spx) return { px: Math.min(x.o || x.c, spx), k, w: 'stop' };
          if (tpx && x.h >= tpx) return { px: Math.max(x.o || x.c, tpx), k, w: 'tgt' };
        }
        const k = ei + HOLD - 1;
        if (B[k]) return { px: B[k].c, k, w: 'time' };
        if (stale) return { px: B[B.length - 1].c, k: B.length - 1, w: 'halt' };
        return null;
      };
      const settled = (x) => x && (opt.final || x.k <= lastI || x.w === 'view');
      const fin = (x, spx) => {
        if (!settled(x)) return null;
        const r = (x.px / e - 1) * 100 - COST, risk = Math.max(3, (1 - spx / e) * 100), m = mret(ei, x.k);
        return { r: r1(r), R: Math.round((r / risk) * 100) / 100, h: x.k - ei + 1, w: x.w, xd: B[x.k].d, x: m == null ? null : r1(r - m) };
      };
      const T = fin(run(spc, tpt), spc), U = fin(run(spc, 0), spc);
      // 3번 나눠 사기 (진입일·+5·+10거래일 시가, 1/3씩)
      const runSplit = (spx, tpx) => {
        let qty = 0, cost = 0; const buyAt = new Set([ei, ei + 5, ei + 10]);
        const done = (px, k, w) => ({ px, k, w, avg: cost / qty, qty });
        for (let k = ei; k < Math.min(B.length, ei + HOLD); k++) {
          const x = B[k], o = x.o || x.c;
          if (vb != null && k === vb + 1) return done(o, k, 'view');
          if (buyAt.has(k) && o > spx) { qty += 1 / o; cost += 1; }
          if (x.l <= spx) return done(Math.min(o, spx), k, 'stop');
          if (tpx && x.h >= tpx) return done(Math.max(o, tpx), k, 'tgt');
        }
        const k = ei + HOLD - 1;
        if (B[k]) return done(B[k].c, k, 'time');
        if (stale) return done(B[B.length - 1].c, B.length - 1, 'halt');
        return null;
      };
      const finS = (x, spx) => {
        if (!settled(x) || !x.qty) return null;
        const r = ((x.px * x.qty) / (x.qty * x.avg) - 1) * 100 - COST, risk = Math.max(3, (1 - spx / e) * 100), m = mret(ei, x.k);
        return { r: r1(r), R: Math.round((r / risk) * 100) / 100, h: x.k - ei + 1, w: x.w, xd: B[x.k].d, x: m == null ? null : r1(r - m), n3: Math.round(x.qty * x.avg) };
      };
      const ST = finS(runSplit(spc, tpt), spc), SU = finS(runSplit(spc, 0), spc);
      // v222 추적 매도: 세력주는 짧게 크게 쏘고 되돌림(과거 재현: 20일 안 최고 +25%인데 20일째 −5%) → 최고점에서 일정 폭 빠지면 팖
      //  TR: 산 뒤 최고가(고가) 대비 종가가 −15% 아래로 마감하면 다음 날 시가에 매도 · 손절선 · 60일
      //  TH: +30% 닿으면 그 값에 절반 매도, 나머지는 TR과 같은 규칙
      const runTrail = (half, maxH = HOLD) => {
        let hi = e, sold = 0, got = 0; // sold: 이미 판 비율, got: 그 판 돈(진입가 1 기준)
        for (let k = ei; k < Math.min(B.length, ei + maxH); k++) {
          const x = B[k], o = x.o || x.c;
          if (x.l <= spc) { const px = Math.min(o, spc); return { px, k, w: 'stop', sold, got }; }
          if (half && !sold && x.h >= e * 1.3) { sold = 0.5; got = 0.5 * Math.max(o, e * 1.3) / e; }
          hi = Math.max(hi, x.h);
          if (x.c <= hi * 0.85 && B[k + 1]) return { px: B[k + 1].o || B[k + 1].c, k: k + 1, w: 'trail', sold, got };
        }
        const k = ei + maxH - 1;
        if (B[k]) return { px: B[k].c, k, w: 'time', sold, got };
        if (stale) return { px: B[B.length - 1].c, k: B.length - 1, w: 'halt', sold, got };
        return null;
      };
      const finTr = (x) => {
        if (!settled(x)) return null;
        const r = ((x.got + (1 - x.sold) * (x.px / e)) - 1) * 100 - COST, risk = Math.max(3, (1 - spc / e) * 100), m = mret(ei, x.k);
        return { r: r1(r), R: Math.round((r / risk) * 100) / 100, h: x.k - ei + 1, w: x.w, xd: B[x.k].d, x: m == null ? null : r1(r - m) };
      };
      const TR = finTr(runTrail(false)), TH = finTr(runTrail(true)), TT = finTr(runTrail(false, 20));
      // v223 눌림 진입: 다음 날 시가에 무조건 사지 않고, 판정 뒤 5거래일 안에 판정일 종가 −3% 가격이 오면 그 가격(그보다 낮게 열리면 시가)에 삼 — 미래 자료 안 씀(지정가 주문)
      let PL = null, PR = null, nfP = 0;
      { const lim = B[p.i].c * PULL; let ek = -1, ep = 0;
        for (let k = p.i + 1; k <= p.i + PULL_D && k < B.length; k++) { const x = B[k], o = x.o || x.c; if (o <= lim) { ek = k; ep = o; break; } if (x.l <= lim) { ek = k; ep = lim; break; } }
        if (ek < 0) { if (B[p.i + PULL_D] || opt.final || stale) nfP = 1; } // 기간 다 지났는데 안 옴 = 못 산 것
        else {
          const sp2 = p.sp > 0 && p.sp < ep ? p.sp : ep * 0.9, tp2 = p.tp > ep ? p.tp : ep * 1.2;
          const vb2 = s === 'hot' ? null : badI.find((b) => b >= ek);
          const runP = (trail) => { let hi = ep;
            for (let k = ek; k < Math.min(B.length, ek + HOLD); k++) { const x = B[k], o = k === ek ? ep : x.o || x.c;
              if (!trail && vb2 != null && k === vb2 + 1) return { px: o, k, w: 'view' };
              if (x.l <= sp2) return { px: Math.min(o, sp2), k, w: 'stop' };
              if (!trail && x.h >= tp2) return { px: Math.max(o, tp2), k, w: 'tgt' };
              if (trail) { hi = Math.max(hi, x.h); if (x.c <= hi * 0.85 && B[k + 1]) return { px: B[k + 1].o || B[k + 1].c, k: k + 1, w: 'trail' }; } }
            const k = ek + HOLD - 1; if (B[k]) return { px: B[k].c, k, w: 'time' };
            if (stale) return { px: B[B.length - 1].c, k: B.length - 1, w: 'halt' }; return null; };
          const finP = (x) => { if (!x || !(opt.final || x.k <= lastI || x.w === 'view')) return null;
            const r = (x.px / ep - 1) * 100 - COST, risk = Math.max(3, (1 - sp2 / ep) * 100), m = mret(ek, x.k);
            return { r: r1(r), R: Math.round((r / risk) * 100) / 100, h: x.k - ek + 1, w: x.w, xd: B[x.k].d, x: m == null ? null : r1(r - m) }; };
          PL = finP(runP(false)); PR = finP(runP(true)); } }
      // v230 돌파 확인 진입(BK): 판정 뒤 10거래일 안에 '종가가 직전 20일 최고가 위 + 거래량이 20일 평균 1.5배↑'인 날이 오면 그 다음 날 시가에 삼 → 최고점 −15% 또는 20거래일에 팖. 안 오면 못 산 것(nfB)
      let BK = null, nfB = 0;
      { let ek = -1, ep = 0;
        for (let k = p.i + 1; k <= p.i + BK_D && k + 1 < B.length; k++) { let hh = 0, vv = 0, vn = 0; for (let j = Math.max(0, k - 20); j < k; j++) { hh = Math.max(hh, B[j].h); vv += B[j].v; vn++; }
          if (vn >= 10 && B[k].c > hh && B[k].v >= (vv / vn) * BK_VX) { const o = B[k + 1].o || B[k + 1].c; if (o >= B[k].c * NOFILL) { nf[s + ':bk'] = (nf[s + ':bk'] || 0) + 1; nfB = 1; break; } ek = k + 1; ep = o; break; } }
        if (ek < 0) { if (!nfB && (B[p.i + BK_D + 1] || opt.final || stale)) nfB = 1; }
        else {
          const sp3 = p.sp > 0 && p.sp < ep ? Math.max(p.sp, ep * 0.9) : ep * 0.9;
          const runB = () => { let hi = ep;
            for (let k = ek; k < Math.min(B.length, ek + 20); k++) { const x = B[k], o = k === ek ? ep : x.o || x.c;
              if (x.l <= sp3) return { px: Math.min(o, sp3), k, w: 'stop' };
              hi = Math.max(hi, x.h); if (x.c <= hi * 0.85 && B[k + 1]) return { px: B[k + 1].o || B[k + 1].c, k: k + 1, w: 'trail' }; }
            const k = ek + 19; if (B[k]) return { px: B[k].c, k, w: 'time' };
            if (stale) return { px: B[B.length - 1].c, k: B.length - 1, w: 'halt' }; return null; };
          const x = runB();
          if (x && (opt.final || x.k <= lastI)) { const r = (x.px / ep - 1) * 100 - COST, risk = Math.max(3, (1 - sp3 / ep) * 100), m = mret(ek, x.k);
            BK = { r: r1(r), R: Math.round((r / risk) * 100) / 100, h: x.k - ek + 1, w: x.w, xd: B[x.k].d, x: m == null ? null : r1(r - m), ed: B[ek].d, bp: r1((ep / e - 1) * 100) }; } } }
      let S3 = null; { const z = simPol(B, ei, e, p.sp, POL_S3, stale); if (z && (opt.final || ei + z.h - 1 <= lastI)) { const k = Math.min(B.length - 1, ei + z.h - 1), m = mret(ei, k); S3 = { r: z.r, R: Math.round((z.r / 30) * 100) / 100, h: z.h, w: z.w, xd: B[k].d, x: m == null ? null : r1(z.r - m), u: z.u }; } }
      let lqv = 0, lqn = 0; for (let k = Math.max(0, p.i - 19); k <= p.i; k++) { lqv += B[k].c * B[k].v; lqn++; }
      const lq = lqn ? Math.round(lqv / lqn / 1e7) / 10 : null; // 억 원
      // 손절·목표 16개 조합 (진행 중이면 null)
      const g = [];
      for (const sv of GRID_S) for (const tv of GRID_T) {
        const spx = sv === 'c' ? spc : e * (1 - sv / 100), tpx = tv === 't' ? tpt : tv ? e * (1 + tv / 100) : 0;
        const z = run(spx, tpx); g.push(settled(z) ? r1((z.px / e - 1) * 100 - COST) : null);
      }
      // 최고·최저 기록 (손절·매도 상관없이, 다음 날 시가 기준): 기간 안 최고가까지 오른 폭 + 그 최고점 '전에' 가장 많이 빠졌던 폭(오르기 전 최저)
      const pk = PK_H.map((h) => {
        const end = ei + h - 1; if (!B[end] && !stale) return null;
        const last = Math.min(B.length - 1, end); let hi = -1e9, hk = ei;
        for (let k = ei; k <= last; k++) if (B[k].h > hi) { hi = B[k].h; hk = k; }
        let lo = 1e9; for (let k = ei; k <= hk; k++) lo = Math.min(lo, k === hk ? B[k].o || B[k].c : B[k].l); // 최고점 날은 그날 저가가 고가 전인지 몰라 시가만
        return [r1((hi / e - 1) * 100), r1(Math.min(0, (lo / e - 1) * 100)), hk - ei + 1, B[hk].d];
      });
      let mf = -1e9, ma = 1e9;
      for (let k = ei; k < Math.min(B.length, ei + HOLD); k++) { mf = Math.max(mf, B[k].h); ma = Math.min(ma, B[k].l); }
      const m20 = p.i >= 20 ? mret(p.i - 19, p.i) : null;
      const p5 = p.i >= 5 ? (B[p.i].c / B[p.i - 5].c - 1) * 100 : null; let v20 = 0; for (let k = Math.max(0, p.i - 20); k < p.i; k++) v20 += B[k].v; v20 /= Math.max(1, Math.min(20, p.i));
      const vx = v20 ? B[p.i].v / v20 : null;
      const a = { ...(p.a || {}), p5: p5 == null ? null : p5 < -5 ? '−5% 아래' : p5 < 5 ? '±5%' : p5 < 20 ? '+5~20%' : '+20%↑', vx: vx == null ? null : vx < 1.5 ? '평소 수준' : vx < 3 ? '1.5~3배' : vx < 6 ? '3~6배' : '6배↑', lq: lq == null ? null : lq < 5 ? '5억 미만' : lq < 20 ? '5~20억' : lq < 100 ? '20~100억' : '100억↑', mk: m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합', eg: (() => { const v = (e / B[p.i].c - 1) * 100; return v < -3 ? '−3% 아래' : v < 3 ? '±3%' : v < 10 ? '+3~10%' : '+10%↑'; })() };
      out.push({ s, d: p.d, e: Math.round(e * 100) / 100, sp: Math.round(spc), tp: Math.round(tpt), T, U, ST, SU, TR, TH, PL, PR, TT, BK, S3, nfP, nfB, rv: p.rv ?? null, lq, pk, g, mf: r1((mf / e - 1) * 100), ma: r1((ma / e - 1) * 100), a });
      const ends = [T, U, ST, SU, TR, TH, PL, PR, TT, BK, S3].map((z, zi) => (z ? ix(z.xd) : ((zi === 6 || zi === 7) && nfP) || (zi === 9 && nfB) ? -1 : B.length + 999)); // 눌림을 못 산 건 막지 않음
      busyTo = Math.max(...ends);
    }
  }
  return { trades: out, nf };
}

// ───── 통계 ─────
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const wk = (d) => { const t = Date.parse(d); return Math.floor((t / 864e5 + 3) / 7); }; // 주 번호
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
/** 주 단위로 묶어 다시 뽑아 평균의 분포 → [5%, 95%] 범위 */
function bootMeans(L, rnd, N = 400) {
  const byW = new Map(); for (const x of L) { const k = wk(x.d); if (!byW.has(k)) byW.set(k, []); byW.get(k).push(x.v); }
  const W = [...byW.values()]; if (W.length < 2) return null;
  const out = [];
  for (let b = 0; b < N; b++) { let s = 0, n = 0; for (let j = 0; j < W.length; j++) { const w = W[(rnd() * W.length) | 0]; for (const v of w) { s += v; n++; } } out.push(s / n); }
  return out;
}
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };
// halves: [앞 기간 차이, 뒤 기간 차이] — '효과 있음'은 두 기간 모두 같은 방향일 때만 (한 기간에서만 좋으면 우연일 수 있음)
// strict: 여러 조건을 한꺼번에 비교할 땐 우연히 좋아 보이는 게 꼭 생김 → 98% 범위로 더 엄격하게
function verdictOfDiff(diffs, n, halves = null, strict = false) {
  if (!diffs || n < 10) return { k: 'n', t: '아직 모름', why: `거래 ${n}번 — 최소 10번(믿으려면 30번↑) 필요` };
  const q = strict ? 0.01 : 0.05;
  const lo = pct(diffs, q), hi = pct(diffs, 1 - q), p = diffs.filter((x) => x > 0).length / diffs.length;
  const both = (sgn) => !halves || halves.some((h) => h == null) || halves.every((h) => h * sgn > 0);
  const o = { lo: r1(lo), hi: r1(hi), p: Math.round(p * 100) };
  if (lo > 0 && n >= 30) return both(1) ? { k: 'ok', t: '✅ 효과 있음', ...o } : { k: 'good', t: '좋아 보임', why: '앞·뒤 기간 결과가 엇갈림', ...o };
  if (hi < 0 && n >= 30) return both(-1) ? { k: 'bad', t: '❌ 역효과', ...o } : { k: 'weak', t: '나빠 보임', why: '앞·뒤 기간 결과가 엇갈림', ...o };
  if (p >= (strict ? 0.9 : 0.8)) return { k: 'good', t: '좋아 보임', ...o };
  if (p <= (strict ? 0.1 : 0.2)) return { k: 'weak', t: '나빠 보임', ...o };
  return { k: 'n', t: '아직 모름', ...o };
}
function basic(L) {
  if (!L.length) return null;
  const rs = L.map((x) => x.r), W = rs.filter((x) => x > 0), Lo = rs.filter((x) => x <= 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const why = {}; for (const x of L) why[x.w] = (why[x.w] || 0) + 1;
  const xs = L.map((x) => x.x).filter((v) => v != null);
  const av = mean(rs), sd = rs.length > 1 ? Math.sqrt(rs.reduce((s, x) => s + (x - av) ** 2, 0) / (rs.length - 1)) : null;
  return { sd: sd == null ? null : r1(sd), sh: sd ? Math.round((av / sd) * 100) / 100 : null, t: sd ? Math.round((av / (sd / Math.sqrt(rs.length))) * 10) / 10 : null, n: L.length, win: Math.round((W.length / L.length) * 100), avg: r1(mean(rs)), med: r1(pct(rs, 0.5)), aw: W.length ? r1(mean(W)) : null, al: Lo.length ? r1(mean(Lo)) : null, R: Math.round(mean(L.map((x) => x.R)) * 100) / 100, pf: Lo.length && sum(Lo) < 0 ? Math.round((sum(W) / -sum(Lo)) * 100) / 100 : null, h: Math.round(mean(L.map((x) => x.h))), ex: xs.length ? r1(mean(xs)) : null, why: Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, Math.round((c / L.length) * 100)]) };
}
/** 계좌로 따라 했다면: 동시에 최대 5종목, 종목당 그때 계좌의 20% */
function equity(trades, m) {
  const L = trades.filter((t) => t[m]).map((t) => ({ d: t.d, x: t[m].xd, r: t[m].r })).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!L.length) return null;
  let cash = 100, open = [], peak = 100, mdd = 0, taken = 0;
  const curve = [];
  const val = () => cash + open.reduce((s, o) => s + o.amt, 0);
  const close = (until) => { open.sort((a, b) => (a.x < b.x ? -1 : 1)); while (open.length && open[0].x <= until) { const o = open.shift(); cash += o.amt * (1 + o.r / 100); const v = val(); peak = Math.max(peak, v); mdd = Math.min(mdd, (v / peak - 1) * 100); curve.push([o.x, r1(v - 100)]); } };
  for (const t of L) {
    close(t.d);
    if (open.length >= 5) continue;
    const amt = Math.min(cash, val() * 0.2); if (amt <= 0) continue;
    cash -= amt; open.push({ amt, r: t.r, x: t.x }); taken++;
  }
  close('9999');
  const step = Math.max(1, Math.floor(curve.length / 40));
  return { tot: r1(val() - 100), mdd: r1(mdd), taken, of: L.length, curve: curve.filter((_, i) => i % step === 0 || i === curve.length - 1) };
}
/** 과최적화 확률 PBO (헤지펀드 백테스트 검증법 CSCV): 거래를 시간 순 8조각으로 나눠 4조각으로 '가장 좋은 손절·목표'를 고르고
 *  나머지 4조각에서 그 규칙이 중간보다 못한 경우의 비율 (70가지 조합). 50%에 가까우면 '고른 규칙이 우연'이라는 뜻 */
function pboOf(tr) {
  const L = tr.filter((t) => t.g?.length === 16 && t.g.every((x) => x != null)).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (L.length < 80) return null;
  const S = 8, blk = Array.from({ length: S }, (_, i) => L.slice(Math.floor((i * L.length) / S), Math.floor(((i + 1) * L.length) / S)));
  const bm = blk.map((B) => Array.from({ length: 16 }, (_, gi) => mean(B.map((t) => t.g[gi])))); // 조각별·규칙별 평균
  const combos = []; const pick = (st, cur) => { if (cur.length === S / 2) { combos.push(cur); return; } for (let i = st; i < S; i++) pick(i + 1, [...cur, i]); }; pick(0, []);
  let below = 0;
  for (const tr4 of combos) {
    const te4 = [...Array(S).keys()].filter((i) => !tr4.includes(i));
    const avgOf = (ix, gi) => mean(ix.map((i) => bm[i][gi]));
    let best = 0; for (let gi = 1; gi < 16; gi++) if (avgOf(tr4, gi) > avgOf(tr4, best)) best = gi;
    const tv = avgOf(te4, best), rank = Array.from({ length: 16 }, (_, gi) => avgOf(te4, gi)).filter((v) => v < tv).length; // 뒤 기간에서 몇 개 규칙보다 나았나
    if (rank / 15 < 0.5) below++;
  }
  return Math.round((below / combos.length) * 100);
}
/** 몬테카를로: 실제 거래 결과를 무작위 순서·복원 추출로 500번 다시 이어 붙여(한 번에 계좌 20%씩) → 나쁜 경우(하위 5%) 누적 수익과 최대 낙폭 */
function monteCarlo(rs, rnd, N = 500, len = rs.length) {
  if (rs.length < 20) return null;
  const fin = [], dd = [];
  for (let b = 0; b < N; b++) { let eq = 1, pk = 1, md = 0; for (let i = 0; i < len; i++) { eq *= 1 + 0.2 * rs[(rnd() * rs.length) | 0] / 100; pk = Math.max(pk, eq); md = Math.min(md, eq / pk - 1); } fin.push((eq - 1) * 100); dd.push(md * 100); }
  return { p5: r1(pct(fin, 0.05)), p50: r1(pct(fin, 0.5)), dd95: r1(pct(dd, 0.05)), loss: Math.round((fin.filter((x) => x < 0).length / N) * 100) };
}
/** 최고·최저 기록 통계: 신호별·기간별로 '산 날부터 최고 얼마까지 올랐나' 분포 + '오르기 전 얼마까지 빠졌나' */
export const PK_UP = [10, 20, 30, 50, 100], PK_DN = [5, 10, 20, 30];
function peakStats(trades) {
  const out = {};
  PK_H.forEach((h, hi) => {
    out[h] = SIGS.map(([s, ko]) => {
      const L = trades.filter((t) => t.s === s && t.pk?.[hi]).map((t) => t.pk[hi]);
      if (!L.length) return { s, ko, n: 0 };
      const up = L.map((x) => x[0]), dn = L.map((x) => x[1]), dd = L.map((x) => x[2]);
      return { s, ko, n: L.length, mu: r1(pct(up, 0.5)), au: r1(mean(up)), q75: r1(pct(up, 0.75)), best: r1(Math.max(...up)), md: r1(pct(dn, 0.5)), ad: r1(mean(dn)), worst: r1(Math.min(...dn)), days: Math.round(pct(dd, 0.5)),
        up: PK_UP.map((v) => Math.round((up.filter((x) => x >= v).length / L.length) * 100)), dn: PK_DN.map((v) => Math.round((dn.filter((x) => x <= -v).length / L.length) * 100)),
        flop: Math.round((L.filter((x) => x[0] < 10 && x[1] <= -10).length / L.length) * 100) }; // 10%도 못 오르고 −10% 넘게 빠진 거래
    });
  });
  return out;
}
/** v222 🧠 데이터로 다시 배운 기준 (워크포워드): 앞 2/3 기간 거래로 '조건마다 성적이 평균보다 얼마나 좋은지'를 배우고(표본 적으면 0 쪽으로 당김),
 *  그 점수로 뒤 1/3(안 본 기간) 거래를 줄 세워 위 1/3 vs 아래 1/3 성적을 비교 → 통하면 이 점수로 🟢를 바꿀 근거가 됨 */
// v224 🏆 이긴 자리 공통점 (GK: 가장 잘 된 자리와 공통 종목의 공시·차트 패턴을 추려내기)
//  '이긴 자리' = 판정 다음 날 시가에 산 뒤 60거래일 안에 +30%↑ 갔고, 그 전에 −10% 넘게 안 빠진 판정 (깨끗하게 크게 오른 자리)
//  조건(공시 종류·차트 모양·단계·체크 항목…)마다 '그 조건일 때 이긴 자리 비율' ÷ '전체 비율' = 배수. 승자만 보면 착시가 생겨서(진 종목에도 흔한 공시일 수 있음) 반드시 진 판정과 같이 셈
//  앞 2/3 기간과 뒤 1/3 기간 둘 다 배수 1.2↑이어야 ✓ (한쪽만 좋으면 우연) · 조건 2개 조합도 같은 기준
export const WIN_UP = 30, WIN_DD = -10;
export function winStudy(T0) {
  const seen = new Set(), L = [];
  for (const t of T0) { if (!(t.s === 'all' || t.s === 'hot') || !t.pk?.[2] || !t.a) continue; const k = t.c + '|' + t.d; if (seen.has(k)) continue; seen.add(k); L.push(t); }
  if (L.length < 60) return { n: L.length, need: 60 };
  const win = (t) => t.pk[2][0] >= WIN_UP && t.pk[2][1] > WIN_DD;
  const ds = [...new Set(L.map((t) => t.d))].sort(), cut = ds[Math.floor(ds.length * 2 / 3)];
  const p0 = L.filter(win).length / L.length, pa = L.filter((t) => t.d < cut), pz2 = L.filter((t) => t.d >= cut);
  const r0a = pa.filter(win).length / Math.max(1, pa.length), r0z = pz2.filter(win).length / Math.max(1, pz2.length);
  const evKeys = new Set(); for (const t of L) for (const k of Object.keys(t.a)) if (k.startsWith('e_')) evKeys.add(k);
  const hasEv = (t) => Object.keys(t.a).some((k) => ['lo', 'bx', 'cy'].includes(k)); // 새 기준(v224)으로 계산된 판정만 공시 '없음'을 셈
  const valOf = (t, k) => (k.startsWith('e_') ? (t.a[k] || (hasEv(t) ? '없음' : null)) : t.a[k]);
  const keys = [...Object.keys(ATTR_KO).filter((k) => !['mk', 'eg', 'vd'].includes(k)), ...evKeys]; // 한 줄 결론(vd)은 이 결과로 바뀌므로 뺌(순환) // 진입 때 시장·진입 갭은 '자리'가 아니라 사는 때라 뺌
  const koOf = (k) => (k.startsWith('e_mv_') ? '속뜻: ' + (KIND_KO[k.slice(2)] || k.slice(5)) : k.startsWith('e_') ? '공시: ' + (KIND_KO[k.slice(2)] || k.slice(2)) : ATTR_KO[k]);
  const stat = (f) => { const g = L.filter(f); if (g.length < 30) return null; const w = g.filter(win); const a = g.filter((t) => t.d < cut), z = g.filter((t) => t.d >= cut);
    const la = a.length >= 10 && r0a ? a.filter(win).length / a.length / r0a : null, lz = z.length >= 8 && r0z ? z.filter(win).length / z.length / r0z : null;
    return { n: g.length, w: w.length, rate: Math.round((w.length / g.length) * 100), lift: Math.round((w.length / g.length / p0) * 100) / 100, la: la == null ? null : Math.round(la * 100) / 100, lz: lz == null ? null : Math.round(lz * 100) / 100,
      ok: la != null && lz != null && la >= 1.2 && lz >= 1.2, okBad: la != null && lz != null && la <= 0.8 && lz <= 0.8, avg: r1(mean(g.map((t) => t.pk[2][0]))),
      ex: w.sort((x, y) => y.pk[2][0] - x.pk[2][0]).slice(0, 4).map((t) => [t.n || t.c, t.c, r1(t.pk[2][0]), t.d]) }; };
  const singles = [];
  for (const k of keys) { const vals = new Set(L.map((t) => valOf(t, k)).filter((v) => v != null)); for (const v of vals) { const s = stat((t) => valOf(t, k) === v); if (s) singles.push({ k, ko: koOf(k), v, ...s }); } }
  const good = singles.filter((x) => x.lift >= 1).sort((a, b) => (b.ok - a.ok) || (b.lift - a.lift)).slice(0, 10);
  const bad = singles.filter((x) => x.lift < 1).sort((a, b) => (b.okBad - a.okBad) || (a.lift - b.lift)).slice(0, 8);
  // 조건 2개 조합: 혼자서도 배수 1.1↑인 것끼리만 (조합 폭발·우연 방지)
  const seeds = singles.filter((x) => x.lift >= 1.1 && x.v !== '없음').slice(0, 40); const pairs = [];
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) { const A = seeds[i], Bq = seeds[j]; if (A.k === Bq.k) continue;
    const s = stat((t) => valOf(t, A.k) === A.v && valOf(t, Bq.k) === Bq.v); if (s && s.lift > Math.max(A.lift, Bq.lift)) pairs.push({ a: [A.ko, A.v], b: [Bq.ko, Bq.v], ak: A.k, bk: Bq.k, ...s }); }
  pairs.sort((a, b) => (b.ok - a.ok) || (Math.min(b.la ?? 0, b.lz ?? 0) - Math.min(a.la ?? 0, a.lz ?? 0)));
  return { n: L.length, w: L.filter(win).length, base: Math.round(p0 * 100), cut, tests: singles.length + pairs.length, good, bad, pairs: pairs.slice(0, 6) };
}
// v224 레이더 판정에 쓸 '검증된' 패턴만 (앞·뒤 기간 둘 다 통과) — 지금 레이더에서 계산할 수 없는 조건(판정 뒤 정해지는 5일 상승률·거래량 배수·거래대금)은 뺌
const LIVE_NO = new Set(['p5', 'vx', 'lq', 'mk', 'eg', 'vd']);
// v229 ⭐ 전략 자동 찾기 (GK: '확실히 돈 되는 걸 만들어내라') — 지금 레이더에서도 알 수 있는 조건(사기 전에 아는 것)만 1~3개 묶은 규칙 수백 개를
//  앞 2/3 기간으로 고르고(돈 = TT 매도 '최고점 −15% 또는 20일' 한 번 평균, 표본 적으면 n/(n+20)로 줄임) → 안 본 뒤 1/3 기간에서 그대로 확인.
//  뒤 기간에서도 레이더 전체보다 낫고 + 이면 ✅. 고른 규칙들의 앞·뒤 순위가 같이 가는지(상관)로 '찾기 자체가 믿을 만한지'도 표시. 미래 자료 안 씀(진입 갭·판정 뒤 수익 등 제외)
export const STRAT_C = [
  ['mk', '상승', '시장 상승장'], ['mk', '보합', '시장 보합장'], ['mkNot', '하락', '시장 하락장 아님'],
  ['st', '매집', '단계 매집'], ['st', '판 깔기', '단계 판 깔기'], ['st', '띄우기', '단계 띄우기'], ['st', '관찰', '단계 관찰'],
  ['gp', '평단 아래', '평단 아래'], ['gp', '평단 +0~15%', '평단 +0~15%'], ['c_acc', '✓', '매집 흔적 있음'], ['c_cost', '✓', '평단 근처 ✓'],
  ['lo', '+10% 안', '60일 저점 근처(+10% 안)'], ['lo', '+10~30%', '60일 저점 대비 +10~30%'], ['bx', '30% 안(좁음)', '좁은 박스(60일 폭 30% 안)'],
  ['dir', '상승', '상승 분류'], ['cm', '있음', '매집봉 있음'], ['rr', '3 이상', '손익비 3↑'], ['noIns', '1', '임원 매도 공시 없음'],
  // v233 공시의 속뜻
  ['e_mv_mnaFund', '있음', '무자본 M&A 구조'], ['e_mv_goodNews', '있음', '조달 뒤 호재 몰림'], ['e_mv_paidUp', '있음', '납입 뒤 급등'], ['e_mv_themeFund', '있음', '테마 갈아타기+자금조달'], ['noConv', '1', '띄운 뒤 전환·대주주 매도 없음'],
];
const stratHit = (t, [k, v]) => (k === 'mkNot' ? t.a?.mk && t.a.mk !== v : k === 'noIns' ? !t.a?.e_insider_s && !t.a?.e_insider : k === 'noConv' ? !t.a?.e_mv_convPump && !t.a?.e_mv_majSell : t.a?.[k] === v);
export function stratFind(T0, m = 'TT') {
  const seen = new Set(), L = [];
  for (const t of T0) { if (!(t.s === 'all') || !t[m] || !t.a) continue; const k = t.c + '|' + t.d; if (seen.has(k)) continue; seen.add(k); L.push(t); }
  if (L.length < 80) return { n: L.length, need: 80 };
  L.sort((p, q) => (p.d < q.d ? -1 : 1));
  const avg = (a) => (a.length ? r1(mean(a.map((t) => t[m].r))) : null), win = (a) => (a.length ? Math.round((a.filter((t) => t[m].r > 0).length / a.length) * 100) : null), xavg = (a) => { const v = a.map((t) => t[m].x).filter((x) => x != null); return v.length ? r1(mean(v)) : null; };
  const C = STRAT_C, rules = [];
  for (let i = 0; i < C.length; i++) { rules.push([i]); for (let j = i + 1; j < C.length; j++) { if (C[i][0] === C[j][0]) continue; rules.push([i, j]); for (let k = j + 1; k < C.length; k++) { if (C[k][0] === C[i][0] || C[k][0] === C[j][0]) continue; rules.push([i, j, k]); } } }
  // v233 빠르게: 조건마다 맞는 거래 표시(한 번만) → 규칙마다 맞는 거래 번호 목록(한 번만) → 달·기간별로는 그 목록만 훑음
  const CM = C.map((c) => Uint8Array.from(L, (t) => (stratHit(t, c) ? 1 : 0)));
  const IX = new Map(); const pos = new Map(L.map((t, i) => [t, i]));
  const idxOf = (idx) => { const key = idx.join(','); let v = IX.get(key); if (!v) { v = []; for (let q = 0; q < L.length; q++) { let ok = 1; for (const i of idx) if (!CM[i][q]) { ok = 0; break; } if (ok) v.push(q); } IX.set(key, v); } return v; };
  const hit = (t, idx) => { const q = pos.get(t); return q == null ? idx.every((i) => stratHit(t, C[i])) : idx.every((i) => CM[i][q]); };
  const name = (idx) => idx.map((i) => C[i][2]).join(' + ');
  // 규칙 점수: (평균 − 전체 평균) × n/(n+20) — 표본 적은 규칙은 깎음. 25건↑만
  const score = (tr) => { const bt = tr.length ? mean(tr.map((t) => t[m].r)) : 0; const R = []; const inTr = new Uint8Array(L.length); for (const t of tr) { const q = pos.get(t); if (q != null) inTr[q] = 1; }
    for (const idx of rules) { const a = []; for (const q of idxOf(idx)) if (inTr[q]) a.push(L[q]); if (a.length < 25) continue; const ma = mean(a.map((t) => t[m].r)); R.push({ idx, na: a.length, sa: (ma - bt) * a.length / (a.length + 20) * (1 - 0.12 * (idx.length - 1)), ta: r1(ma) }); } // v233 조건이 많을수록 우연히 맞기 쉬움 → 조건 하나 늘 때마다 12% 깎음
    R.sort((x, y) => y.sa - x.sa || x.idx.length - y.idx.length);
    const sg = new Set(), K = []; for (const x of R) { const k = [x.na, x.ta].join('|'); if (sg.has(k)) continue; sg.add(k); K.push(x); } return K; }; // 조건을 더해도 같은 거래면 짧은 규칙만
  // ① 굴려가며 검증(walk-forward): 매달 '그 전까지'로 규칙을 고르고 '그 달'에 시험 → 고르는 방식 자체가 돈이 됐는지 (뒤 기간 선택 편향 없음)
  const months = [...new Set(L.map((t) => t.d.slice(0, 7)))].sort();
  const wf = { pick: [], tr: [], base: [] };
  for (const mo of months) {
    const tr = L.filter((t) => t.d < mo && t[m].xd < mo), te = L.filter((t) => t.d.slice(0, 7) === mo);
    if (tr.length < 50 || !te.length) continue;
    const K = score(tr); const top = K[0]; if (!top || top.sa <= 0) { wf.pick.push({ mo, name: null, n: 0 }); wf.base.push(...te); continue; }
    const got = te.filter((t) => hit(t, top.idx)); wf.pick.push({ mo, name: name(top.idx), n: got.length, r: avg(got), b: avg(te) }); wf.tr.push(...got); wf.base.push(...te);
  }
  const W = { months: wf.pick.length, n: wf.tr.length, avg: avg(wf.tr), x: xavg(wf.tr), win: win(wf.tr), bn: wf.base.length, bavg: avg(wf.base), bx: xavg(wf.base), bwin: win(wf.base), pick: wf.pick.slice(-12) };
  W.ok = W.n >= 30 && W.avg != null && W.avg > 0 && W.avg > (W.bavg ?? 0) && (W.x == null || W.x > 0);
  // ② 지금 쓸 규칙: 전체 기간 앞 2/3로 고르고 뒤 1/3로 확인(표 보여주기용) + rho(앞 순위↔뒤 결과 상관)
  const ds = [...new Set(L.map((t) => t.d))], cut = ds[Math.floor(ds.length * 2 / 3)];
  const tr = L.filter((t) => t.d < cut && t[m].xd < cut), te = L.filter((t) => t.d >= cut);
  if (tr.length < 50 || te.length < 25) return { n: L.length, train: tr.length, test: te.length, short: 1, wf: W }; // v231 거래 수는 넘었지만 앞·뒤 기간으로 나누면 한쪽이 모자람
  const baseTr = avg(tr), baseTe = avg(te);
  const R = score(tr).map((x) => { const b = te.filter((t) => hit(t, x.idx)); return { ...x, nb: b.length, tb: avg(b), wa: null, wb: win(b), xb: xavg(b) }; });
  const Q = R.filter((x) => x.nb >= 10); let rho = null;
  if (Q.length >= 10) { const rk = (arr, key) => { const o = [...arr].sort((p, q) => q[key] - p[key]); const m2 = new Map(o.map((x, i) => [x, i])); return arr.map((x) => m2.get(x)); }; const ra = rk(Q, 'sa'), rb = rk(Q, 'tb'), n = Q.length; let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2; rho = Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 100) / 100; }
  const top = R.slice(0, 8).map((x) => ({ ...x, name: name(x.idx), ok: x.nb >= 10 && x.tb > 0 && x.tb > baseTe, ex: te.filter((t) => hit(t, x.idx)).sort((p, q) => q[m].r - p[m].r).slice(0, 3).map((t) => [t.n || t.c, t.c, t[m].r, t.d]) }));
  // ③ ⭐로 쓰는 규칙 = 지금까지 전체로 고른 1등. 조건: 굴려가며 검증이 통과(W.ok) + 앞/뒤 확인에서 그 규칙이 통과 + rho ≥ 0.2
  const nowK = score(L.filter((t) => t[m].xd <= ds[ds.length - 1]))[0] || null; const nowR = nowK ? R.find((x) => x.idx.join() === nowK.idx.join()) || null : null;
  const cand = nowK ? { idx: nowK.idx, name: name(nowK.idx), c: nowK.idx.map((i) => C[i]), ta: nowK.ta, na: nowK.na, tb: nowR?.tb ?? null, wb: nowR?.wb ?? null, nb: nowR?.nb ?? 0, xb: nowR?.xb ?? null } : null;
  const why = !cand ? '고른 규칙 없음' : !W.ok ? '굴려가며 검증에서 레이더 전체를 못 이김' : !(nowR && nowR.nb >= 10 && nowR.tb > 0 && nowR.tb > baseTe) ? '뒤 1/3 기간에서 못 버팀' : !(rho != null && rho >= 0.2) ? `찾기 믿음도(rho ${rho ?? '-'}) 0.2 미만` : null;
  const best = cand && !why ? cand : null;
  return { n: L.length, m, cut, from: ds[0], to: ds[ds.length - 1], train: tr.length, test: te.length, baseTr, baseTe, wBaseTe: win(te), tried: R.length, rho, top, wf: W, cand: cand && !best ? cand.name : null, why, best };
}
// v231 🛡 피하기 검증: 🔴·D·하락 위험이 '피하려던 것(크게 빠짐)'을 실제로 피하게 했나 — 오른 폭이 아니라 큰 손실 확률로 채점
//  big = 산 뒤 60거래일 안에 −30% 아래를 찍은 비율 · up = +30% 위를 찍은 비율 · TT = 실제로 사고팔았다면(최고점 −15%/20일)
export function avoidStudy(T0, m = 'TT') {
  const seen = new Set(), L = [];
  for (const t of T0) { if (t.s !== 'all' || t.ma == null || !t.a) continue; const k = t.c + '|' + t.d; if (seen.has(k)) continue; seen.add(k); L.push(t); }
  if (L.length < 60) return { n: L.length, need: 60 };
  const ds = [...new Set(L.map((t) => t.d))].sort(), cut = ds[Math.floor(ds.length / 2)];
  const st = (a) => { if (!a.length) return null; const tt = a.filter((t) => t[m]); return { n: a.length, big: Math.round((a.filter((t) => t.ma <= -30).length / a.length) * 100), b20: Math.round((a.filter((t) => t.ma <= -20).length / a.length) * 100), up: Math.round((a.filter((t) => t.mf >= 30).length / a.length) * 100), tt: tt.length ? r1(mean(tt.map((t) => t[m].r))) : null, x: (() => { const v = tt.map((t) => t[m].x).filter((x) => x != null); return v.length ? r1(mean(v)) : null; })() }; };
  const all = st(L);
  // 판정: 크게 빠질 확률이 전체보다 5%p↑ 높으면 제 역할 · 큰 상승 확률도 5%p↑ 높으면 '위험하지만 튀는 자리' · 둘 다 아니면 피할 이유 없음
  const judge = (g, base) => { if (!g || g.n < 30) return { k: 'n', t: `표본 부족 (${g?.n || 0}번, 30번↑ 필요)` };
    const db = g.big - base.big, du = g.up - base.up, dt = g.tt != null && base.tt != null ? g.tt - base.tt : 0;
    if (db >= 5 && du >= 5) return { k: 'pump', t: '⚠️ 위험하지만 튀는 자리 — 크게 빠질 확률도, 크게 오를 확률도 높음 (단타 아니면 피하기)' };
    if (db >= 5 || dt <= -2) return { k: 'ok', t: '✅ 제 역할 — 크게 빠질 확률이 높았거나 사고팔았을 때 손해' };
    return { k: 'none', t: '❌ 피할 이유 못 찾음 — 크게 빠질 확률이 전체와 비슷하거나 낮음' }; };
  const G = [['g', '🟢 매수 검토', (t) => t.a.vd === 'g'], ['y', '🟡 지켜보기', (t) => t.a.vd === 'y'], ['r', '🔴 피하기', (t) => t.a.vd === 'r'], ['D', '체크리스트 D등급', (t) => t.a.ck === 'D'], ['AB', '체크리스트 A·B등급', (t) => t.a.ck === 'A' || t.a.ck === 'B'], ['dn', '하락 위험 분류', (t) => t.a.dir === '하락 위험']];
  const groups = G.map(([k, ko, f]) => { const g = st(L.filter(f)); return { k, ko, ...(g || { n: 0 }), avoid: ['r', 'D', 'dn'].includes(k), vd: ['r', 'D', 'dn'].includes(k) ? judge(g, all) : null }; });
  // 위험 항목 하나하나: 걸렸을 때 vs 안 걸렸을 때 (앞 반·뒤 반 따로 계산해서 둘 다 같은 방향이어야 '확실')
  const keys = [...new Set(L.flatMap((t) => Object.keys(t.a).filter((k) => k.startsWith('r_'))))];
  const items = keys.map((rk) => { const k = rk.slice(2); const on = L.filter((t) => t.a[rk]), off = L.filter((t) => !t.a[rk]);
    const a = st(on), b = st(off); if (!a || a.n < 15 || !b) return { k, ko: RD_KO[k] || k, n: on.length, bomb: BOMB_KEYS.includes(k), vd: { k: 'n', t: `표본 부족 (${on.length}번)` } };
    const half = (lo) => { const p = st(on.filter((t) => (lo ? t.d < cut : t.d >= cut))), q = st(off.filter((t) => (lo ? t.d < cut : t.d >= cut))); return p && q && p.n >= 8 ? { db: p.big - q.big, du: p.up - q.up } : null; };
    const h1 = half(true), h2 = half(false);
    const vd = judge(a, b); const sure = vd.k !== 'n' && h1 && h2 && (vd.k === 'none' ? h1.db < 5 && h2.db < 5 : h1.db >= 3 && h2.db >= 3) && a.n >= 40;
    return { k, ko: RD_KO[k] || k, bomb: BOMB_KEYS.includes(k), on: a, off: b, db: a.big - b.big, du: a.up - b.up, h1, h2, vd, sure };
  }).sort((x, y) => (y.on?.n || 0) - (x.on?.n || 0));
  return { n: L.length, m, cut, all, groups, items };
}
export function winPatOf(W) {
  if (!W || W.need) return null;
  const okK = (k) => !LIVE_NO.has(k); const okV = (x) => !(x.k.startsWith('e_') && x.v === '없음'); // '어떤 공시가 없음'은 너무 넓어 판정엔 안 씀(화면엔 보임)
  const good = [...(W.good || []).filter((x) => x.ok && okK(x.k) && okV(x)).map((x) => ({ c: [[x.k, x.v]], ko: `${x.ko}: ${x.v}`, lift: x.lift, la: x.la, lz: x.lz, rate: x.rate, n: x.n })),
    ...(W.pairs || []).filter((x) => x.ok && okK(x.ak) && okK(x.bk)).map((x) => ({ c: [[x.ak, x.a[1]], [x.bk, x.b[1]]], ko: `${x.a[0]}: ${x.a[1]} + ${x.b[0]}: ${x.b[1]}`, lift: x.lift, la: x.la, lz: x.lz, rate: x.rate, n: x.n }))];
  const bad = (W.bad || []).filter((x) => x.okBad && okK(x.k) && okV(x)).map((x) => ({ c: [[x.k, x.v]], ko: `${x.ko}: ${x.v}`, lift: x.lift, la: x.la, lz: x.lz, rate: x.rate, n: x.n }));
  return { base: W.base, n: W.n, cut: W.cut, good, bad };
}
export function learnScore(trades, m = 'T') {
  const L = trades.filter((t) => t.s === 'all' && t[m] && t.a).map((t) => ({ d: t.d, xd: t[m].xd, r: t[m].r, a: t.a, c: t.c }));
  if (L.length < 40) return { n: L.length, need: 40 };
  const ds = [...new Set(L.map((t) => t.d))].sort(), cut = ds[Math.floor(ds.length * 2 / 3)];
  const tr = L.filter((t) => t.d < cut && t.xd < cut), te = L.filter((t) => t.d >= cut);
  if (tr.length < 25 || te.length < 15) return { n: L.length, train: tr.length, test: te.length, need: 40 };
  const mu = mean(tr.map((t) => t.r)), K = 20, W = {};
  for (const k of Object.keys(ATTR_KO)) { if (k === 'vd' || k === 'ck') continue; const g = {}; for (const t of tr) { const v = t.a[k]; if (v == null) continue; (g[v] = g[v] || []).push(t.r); }
    for (const [v, rs] of Object.entries(g)) if (rs.length >= 5) (W[k] = W[k] || {})[v] = ((mean(rs) - mu) * rs.length) / (rs.length + K); }
  const sc = (t) => Object.entries(W).reduce((a, [k, m2]) => a + (m2[t.a[k]] ?? 0), 0);
  const S = te.map((t) => ({ ...t, sc: sc(t) })).sort((a, b) => b.sc - a.sc), n3 = Math.max(1, Math.floor(S.length / 3));
  const top = S.slice(0, n3), bot = S.slice(-n3);
  const rnd = rng(11), bt = bootMeans(top.map((t) => ({ d: t.d, v: t.r })), rnd, 400), bb = bootMeans(bot.map((t) => ({ d: t.d, v: t.r })), rnd, 400);
  const diff = r1(mean(top.map((t) => t.r)) - mean(bot.map((t) => t.r)));
  const rk = rankOf(S.map((t) => t.sc)), rr2 = rankOf(S.map((t) => t.r)), ic = corr(rk, rr2);
  let vd = { k: 'n', t: '아직 모름' };
  if (bt && bb) { const ds2 = bt.map((v, i) => v - bb[i]); vd = verdictOfDiff(ds2, S.length, null, false); if (vd.k === 'ok' && S.length < 60) vd = { ...vd, k: 'good', t: '좋아 보임', why: '안 본 기간 거래 60번 미만' }; }
  const flat = Object.entries(W).flatMap(([k, m2]) => Object.entries(m2).map(([v, w]) => ({ ko: ATTR_KO[k], v, w: r1(w) }))).sort((a, b) => b.w - a.w);
  return { n: L.length, train: tr.length, test: te.length, cut, topAvg: r1(mean(top.map((t) => t.r))), botAvg: r1(mean(bot.map((t) => t.r))), allTest: r1(mean(te.map((t) => t.r))), diff, ic: ic == null ? null : Math.round(ic * 1000) / 1000, vd, plus: flat.filter((x) => x.w > 0.5).slice(0, 8), minus: flat.filter((x) => x.w < -0.5).slice(-8).reverse() };
}
/** 시장 대비로 바꾼 거래 (각 방식의 수익률 r을 같은 기간 시장 대비 x로) */
export const toExcess = (T0) => T0.map((t) => { const o = { ...t }; for (const m of MODES) if (t[m]) o[m] = t[m].x == null ? null : { ...t[m], r: t[m].x }; return o; });
export function simStats(trades, nf = {}, seed = 7) {
  const rnd = rng(seed);
  const dates = [...new Set(trades.map((t) => t.d))].sort();
  const cut = dates[Math.floor(dates.length * 2 / 3)] || '9999';
  const base = {}, baseBoot = {};
  for (const m of MODES) { base[m] = trades.filter((t) => t.s === 'all' && t[m]).map((t) => ({ d: t.d, v: t[m].r })); baseBoot[m] = bootMeans(base[m], rnd); }
  const groups = SIGS.map(([s, ko]) => {
    const tr = trades.filter((t) => t.s === s);
    const one = (m) => {
      const L = tr.filter((t) => t[m]).map((t) => ({ ...t[m], d: t.d, mk: t.a?.mk || null }));
      const b = basic(L); if (!b) return null;
      // v223 시장 국면별(진입 때 시장 20일 흐름 ±3%): 상승장·보합장·하락장 따로
      b.reg = Object.fromEntries(['상승', '보합', '하락'].map((k) => { const v = L.filter((x) => x.mk === k).map((x) => x.r); return [k, v.length ? [v.length, r1(mean(v)), Math.round((v.filter((y) => y > 0).length / v.length) * 100)] : null]; }));
      if (m === 'BK') { const nfn = tr.filter((t) => t.nfB).length; b.nfn = nfn; b.nfp = Math.round((nfn / Math.max(1, nfn + L.length)) * 100); }
      if (m === 'PL' || m === 'PR') { const nfn = tr.filter((t) => t.nfP).length; b.nfn = nfn; b.nfp = Math.round((nfn / Math.max(1, nfn + L.length)) * 100); } // 눌림이 안 와서 못 산 비율
      const bm = bootMeans(L.map((x) => ({ d: x.d, v: x.r })), rnd);
      if (bm) { b.lo = r1(pct(bm, 0.05)); b.hi = r1(pct(bm, 0.95)); }
      const A = L.filter((x) => x.d < cut), Z = L.filter((x) => x.d >= cut);
      b.half = { a: A.length ? r1(mean(A.map((x) => x.r))) : null, an: A.length, z: Z.length ? r1(mean(Z.map((x) => x.r))) : null, zn: Z.length };
      const bh = (lo) => { const v = base[m].filter((x) => (lo ? x.d < cut : x.d >= cut)).map((x) => x.v); return v.length ? mean(v) : null; };
      const hv = [A.length >= 10 && bh(true) != null ? b.half.a - bh(true) : null, Z.length >= 10 && bh(false) != null ? b.half.z - bh(false) : null];
      if (s !== 'all' && bm && baseBoot[m]) { const diffs = bm.map((v, i) => v - baseBoot[m][i]); b.vs = r1(b.avg - mean(base[m].map((x) => x.v))); b.vd = verdictOfDiff(diffs, b.n, hv);
        // 확실해지려면 몇 번 필요한가 (지금 차이가 그대로라면, 95% 기준): n ≈ (2 × 표준편차 ÷ 차이)²
        if (b.vs && b.sd) { const need = Math.ceil((2 * b.sd / Math.abs(b.vs)) ** 2); b.need = need > b.n ? Math.min(need, 99999) : 0; } }
      else if (s === 'all') b.vd = bm ? { k: 'base', t: '기준선', lo: b.lo, hi: b.hi } : { k: 'n', t: '기준선' };
      b.eq = equity(tr, m);
      b.mc = monteCarlo(L.map((x) => x.r), rnd, 500, b.eq?.taken || L.length); // 계좌가 실제로 살 수 있던 횟수만큼만 이어 붙임 (동시에 5종목 한도)
      b.c1 = r1(b.avg - 0.5); // 비용을 두 배(1%)로 잡아도 남는지
      const st = L.filter((x) => x.w === 'stop'); const stT = tr.filter((t) => t[m]?.w === 'stop');
      b.shake = st.length ? Math.round((stT.filter((t) => t.mf >= 20).length / st.length) * 100) : null;
      return b;
    };
    // 최적 손절·목표: 앞 2/3에서 고르고 뒤 1/3로 검증
    const gstat = (sel) => GRID_S.flatMap((_, si) => GRID_T.map((__, ti) => { const gi = si * 4 + ti; const v = tr.filter(sel).map((t) => t.g?.[gi]).filter((x) => x != null); return { gi, n: v.length, avg: v.length ? r1(mean(v)) : null }; }));
    // 정화(purge): 앞 기간 거래 중 판 날이 뒤 기간에 걸친 건 학습에서 뺌 (같은 시세를 양쪽에서 보는 정보 새기 방지)
    const xEnd = (t) => [t.T?.xd, t.U?.xd].filter(Boolean).sort().pop() || '9999';
    const all = gstat(() => true), train = gstat((t) => t.d < cut && xEnd(t) < cut), test = gstat((t) => t.d >= cut);
    const cand = train.filter((x) => x.n >= 15 && x.avg != null).sort((a, b) => b.avg - a.avg)[0];
    const best = cand ? { gi: cand.gi, name: gridName(cand.gi), train: cand.avg, trainN: cand.n, test: test[cand.gi].avg, testN: test[cand.gi].n, baseTest: test[GI_T].avg } : null;
    return { s, ko, open: tr.filter((t) => !t.T || !t.U).length, nf: nf[s] || 0, ...Object.fromEntries(MODES.map((m) => [m, one(m)])), grid: all.map((x) => [x.avg, x.n]), best, pbo: pboOf(tr) };
  });
  // 조건별 효과 (전체 거래, 1차 목표 팔기 기준): 조건 값마다 '그 값일 때 − 아닐 때'
  const allT = trades.filter((t) => t.s === 'all' && t.T);
  const conds = [];
  for (const k of Object.keys(ATTR_KO)) {
    const vals = [...new Set(allT.map((t) => t.a?.[k]).filter((v) => v != null))];
    for (const v of vals) {
      const A = allT.filter((t) => t.a?.[k] === v).map((t) => ({ d: t.d, v: t.T.r })), Bn = allT.filter((t) => t.a?.[k] != null && t.a[k] !== v).map((t) => ({ d: t.d, v: t.T.r }));
      if (A.length < 5 || Bn.length < 5) continue;
      const ba = bootMeans(A, rnd, 300), bb = bootMeans(Bn, rnd, 300);
      const hd = (lo) => { const f = (x) => (lo ? x.d < cut : x.d >= cut); const a1 = A.filter(f), b1 = Bn.filter(f); return a1.length >= 10 && b1.length >= 10 ? mean(a1.map((x) => x.v)) - mean(b1.map((x) => x.v)) : null; };
      const vd = ba && bb ? verdictOfDiff(ba.map((x, i) => x - bb[i]), A.length, [hd(true), hd(false)], true) : { k: 'n', t: '아직 모름' };
      conds.push({ k, ko: ATTR_KO[k], v, n: A.length, avg: r1(mean(A.map((x) => x.v))), diff: r1(mean(A.map((x) => x.v)) - mean(Bn.map((x) => x.v))), win: Math.round((A.filter((x) => x.v > 0).length / A.length) * 100), vd });
    }
  }
  conds.sort((a, b) => b.diff - a.diff);
  return { groups, conds, peak: peakStats(trades), cut, from: dates[0] || null, to: dates[dates.length - 1] || null, n: trades.length, gridS: GRID_S, gridT: GRID_T };
}

// ───── 점수 검증 (퀀트 운용사 방식: IC · 5분위) ─────
//  '점수가 높을수록 실제로 더 오르나?'를 기준선(아무거나)과 상관없이 직접 봄
//  · 매일 레이더 목록 안에서 점수 순위 ↔ 그 뒤 N거래일 시장 대비 수익률 순위의 상관(스피어만 IC) → 날짜별 평균
//  · 기간이 겹치는 날끼리는 결과가 비슷하게 묶이므로, 확실도(t값)는 N거래일 간격으로 떨어진 날만으로 계산
//  · 5분위: 매일 점수 순으로 5등분 → 1등급(위 20%)과 5등급(아래 20%)의 평균 수익 차이
export const FACTORS = [['s', '종합 점수', 1], ['ws', '체크리스트 점수', 1], ['rr', '손익비', 1], ['gp', '평단에 가까울수록', -1]];
export const FH = [5, 20, 60];
export const dOrd = (d) => Math.floor((Date.parse(d) / 864e5) * 5 / 7); // 날짜 → 대략 거래일 번호 (과거 재현용)
/** 판정한 날마다 그 뒤 N거래일 시장 대비 수익률 (진입 = 다음 날 시가, 비용 뺌) */
export function fwdOf(B, list, opt = {}) {
  const ix = (d) => { let lo = 0, hi = B.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m].d <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
  const mk = opt.mkt === 'P' ? 'P' : 'Q';
  const mret = (a, b) => { if (!opt.ix) return 0; let m = 1; for (let k = a; k <= b; k++) { const p = opt.ix[B[k]?.d]?.[mk]; if (p != null) m *= 1 + p / 100; } return (m - 1) * 100; };
  const out = [];
  for (const p of list) {
    const i = ix(p.d); if (i < 0 || !B[i + 1]) continue;
    const e = B[i + 1].o || B[i + 1].c;
    if (e >= B[i].c * NOFILL) continue;
    out.push([p.di, ...FH.map((h) => (B[i + h] ? r1((B[i + h].c / e - 1) * 100 - COST - mret(i + 1, i + h)) : null))]);
  }
  return out;
}
const rankOf = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const corr = (x, y) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return b && c ? a / Math.sqrt(b * c) : null; };
/** pts: [{di, v:{s,ws,rr,gp}, x:[x5,x20,x60]}] */
export function icStats(pts, nDates) {
  const byD = new Map(); for (const p of pts) { if (!byD.has(p.di)) byD.set(p.di, []); byD.get(p.di).push(p); }
  const days = [...byD.keys()].sort((a, b) => a - b);
  const out = [];
  for (const [fk, ko, sg] of FACTORS) {
    const row = { k: fk, ko, h: {} };
    FH.forEach((h, hi) => {
      const ics = [], q = [[], [], [], [], []];
      for (const d of days) {
        const L = byD.get(d).filter((p) => p.v?.[fk] != null && p.x[hi] != null);
        if (L.length < 8) continue;
        const rf = rankOf(L.map((p) => sg * p.v[fk])), rx = rankOf(L.map((p) => p.x[hi]));
        const c = corr(rf, rx); if (c != null) ics.push([d, c]);
        L.forEach((p, i) => q[Math.min(4, Math.floor((rf[i] / L.length) * 5))].push(p.x[hi]));
      }
      if (ics.length < 5) { row.h[h] = { n: ics.length }; return; }
      const m = mean(ics.map((z) => z[1]));
      // 겹치지 않게 h일 간격으로 떨어진 날만 → 확실도(t)
      const sep = []; let last = -1e9; for (const [d, c] of ics) if (d - last >= h) { sep.push(c); last = d; }
      const sm = mean(sep), ssd = sep.length > 1 ? Math.sqrt(sep.reduce((a, x) => a + (x - sm) ** 2, 0) / (sep.length - 1)) : null;
      const t = ssd ? (sm / (ssd / Math.sqrt(sep.length))) : null;
      const qa = q.map((L) => (L.length ? r1(mean(L)) : null)); // 0 = 점수 아래 20% … 4 = 위 20%
      row.h[h] = { n: ics.length, ns: sep.length, ic: Math.round(m * 1000) / 1000, pos: Math.round((ics.filter((z) => z[1] > 0).length / ics.length) * 100), t: t == null ? null : Math.round(t * 10) / 10, q: qa, sp: qa[4] != null && qa[0] != null ? r1(qa[4] - qa[0]) : null,
        vd: t == null || sep.length < 6 ? { k: 'n', t: '아직 모름' } : t >= 2 && m > 0 ? { k: 'ok', t: '✅ 점수 높을수록 더 오름' } : t <= -2 ? { k: 'bad', t: '❌ 거꾸로 (점수 높을수록 덜 오름)' } : m > 0 && t >= 1 ? { k: 'good', t: '좋아 보임' } : m < 0 && t <= -1 ? { k: 'weak', t: '나빠 보임' } : { k: 'n', t: '아직 모름' } };
    });
    out.push(row);
  }
  return { days: days.length, factors: out };
}

// 저장용 짧은 모양 ↔ 원래 모양
const pz = (z) => (z ? [z.r, z.R, z.h, z.w, z.xd, z.x] : 0);
const uz = (z) => (z ? { r: z[0], R: z[1], h: z[2], w: z[3], xd: z[4], x: z[5] ?? null } : null);
// v230 조각 저장 읽기 (예전 한 덩어리 형식도 읽힘)
export async function loadBtTrades() { const { partsLoad } = await import('./btstore.mjs'); const x = await partsLoad('mp/bt/trades'); if (!x) return null; const seen = new Set(), t = []; for (const a of x.list) { const k = `${a[0]}|${a[2]}|${a[3]}`; if (seen.has(k)) continue; seen.add(k); t.push(a); } return { ...x, t, dupDrop: x.list.length - t.length }; } // v279 겹친 거래는 읽을 때 뺌
export async function loadBtFw() { const { partsLoad } = await import('./btstore.mjs'); const x = await partsLoad('mp/bt/fw'); return x ? { ...x, r: x.list } : null; }
export const pack = (c, n, t) => [c, n || '', t.s, t.d, t.e, t.sp, t.tp, pz(t.T), pz(t.U), t.g || [], t.mf, t.ma, t.a || {}, pz(t.ST), pz(t.SU), t.rv ?? null, t.lq ?? null, t.pk || [], pz(t.TR), pz(t.TH), t.nfP ? 'nf' : pz(t.PL), t.nfP ? 'nf' : pz(t.PR), pz(t.TT), t.nfB ? 'nf' : pz(t.BK), pz(t.S3)];
export const unpack = (a) => ({ c: a[0], n: a[1], s: a[2], d: a[3], e: a[4], sp: a[5], tp: a[6], T: uz(a[7]), U: uz(a[8]), g: a[9] || [], mf: a[10], ma: a[11], a: a[12] || {}, ST: uz(a[13]), SU: uz(a[14]), rv: a[15] ?? null, lq: a[16] ?? null, pk: a[17] || [], TR: uz(a[18]), TH: uz(a[19]), PL: a[20] === 'nf' ? null : uz(a[20]), PR: a[21] === 'nf' ? null : uz(a[21]), nfP: a[20] === 'nf' ? 1 : 0, TT: uz(a[22]), BK: a[23] === 'nf' ? null : uz(a[23]), nfB: a[23] === 'nf' ? 1 : 0, S3: uz(a[24]) });

// ───── 실제 성적표(매일 판정 기록)로 계산 ─────
//  mp/sim/tl {dates:[], codes:{코드:{n, m(시장), p:[[날짜번호, 신호비트, 목표가, 손절선, 조건]]}}}
//  mp/sim/tr {codes:{코드:{chk, need, open, nf, t:[pack…]}}} · mp/sim/sum 통계 캐시
const SIM_V = 11; // v274 S3 추가 · // v230 BK(돌파 확인 진입) 추가 · // v227 TT(20일 매도) 추가 · // v223: 눌림 진입(PL·PR) 추가 ·  v222: 거래량 0 정지 감자 보정 → 다시 계산
export async function simStep({ maxDates = 2, maxCodes = 12, budgetMs = 30000 } = {}) {
  const { getJSON, setJSON } = await import('./store.mjs');
  const t0 = Date.now();
  let tl = await getJSON('mp/sim/tl');
  let tr = await getJSON('mp/sim/tr');
  if (!tl || tl.v !== SIM_V) { tl = { v: SIM_V, dates: [], codes: {} }; tr = null; }
  if (!tr || tr.v !== SIM_V) tr = { v: SIM_V, codes: {} };
  const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const idx = ((await getJSON('mp/idx')) || []).slice().sort();
  const have = new Set(tl.dates);
  let added = 0, built = 0;
  for (const d of idx) {
    if (have.has(d) || d > kst) continue;
    if (tl.dates.length && d < tl.dates[tl.dates.length - 1]) continue;
    let perf = await getJSON(`mp/perf/${d}`);
    if (!perf?.rowsAll && !perf?.done) {
      if (built >= maxDates) break;
      perf = await (await import('./manipx.mjs')).ensurePerfRows(d); built++;
    }
    // 보유 종목 따라가기 판정이 그날 끝나기 전이면 그 날짜는 잠깐 기다림 (다음 날 아침 9시가 지나면 있는 것만)
    const fol = await getJSON(`mp/sim/fol/${d}`);
    if (d === idx[idx.length - 1] && !fol?.done && Date.now() < Date.parse(d + 'T09:00:00+09:00') + 864e5) break;
    const rowsAll = { ...(fol?.rows || {}), ...(perf.rows || {}) };
    const di = tl.dates.length; tl.dates.push(d); added++;
    for (const [c, r] of Object.entries(rowsAll)) {
      const z = (tl.codes[c] = tl.codes[c] || { n: r.n || '', p: [] });
      if (r.n) z.n = r.n; if (r.mk) z.m = r.mk;
      z.p.push([di, flagsOf(r), r.tp ?? 0, r.sp ?? 0, attrsOf(r), r.rv ?? null, { s: r.s ?? null, ws: r.ws ?? null, rr: r.rr ?? null, gp: r.gp ?? null }]);
      (tr.codes[c] = tr.codes[c] || { need: 1, t: [] }).need = 1;
    }
    if (Date.now() - t0 > budgetMs / 2) break;
  }
  if (added) await setJSON('mp/sim/tl', tl);
  const last = tl.dates[tl.dates.length - 1];
  const todo = Object.keys(tl.codes).filter((c) => { const z = tr.codes[c]; return !z || z.need || (z.open && z.chk !== kst); }).slice(0, maxCodes);
  const M = await import('./manip.mjs');
  const ixd = todo.length ? await M.indexDaily().catch(() => null) : null;
  let done = 0;
  for (let i = 0; i < todo.length && Date.now() - t0 < budgetMs; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (c) => {
      let B = null; try { B = await M._bars(c); } catch {}
      if (!B?.length) { tr.codes[c] = { ...(tr.codes[c] || {}), chk: kst, need: 0, open: 1, t: tr.codes[c]?.t || [] }; return; }
      const z = tl.codes[c];
      const list = z.p.map(([di, f, tp, sp, a, rv]) => ({ di, d: tl.dates[di], f, tp, sp, a, rv }));
      const R = simTrades(B, list, { last, now: Date.now(), ix: ixd, mkt: z.m });
      const fw = fwdOf(B, list, { ix: ixd, mkt: z.m });
      tr.codes[c] = { chk: kst, need: 0, open: R.trades.some((t) => MODES.some((m) => !t[m] && !(t.nfP && (m === 'PL' || m === 'PR')) && !(t.nfB && m === 'BK')) || (t.pk || []).some((x) => !x)) || fw.some((x) => x.includes(null)) ? 1 : 0, nf: R.nf, t: R.trades.map((t) => pack(c, z.n, t)), fw };
      done++;
    }));
  }
  if (done || added) { tr.at = Date.now(); await setJSON('mp/sim/tr', tr); }
  return added || done ? { added, done, left: Object.values(tr.codes).filter((z) => z.need).length } : null;
}
/** v222 보유 종목 따라가기: 산 뒤 아직 안 끝난 종목이 그날 레이더 목록(상위 80)에서 빠졌으면,
 *  그날 장 마감 판정을 따로 계산(가벼운 계산·AI 없음)해 'mp/sim/fol/날짜'에 남김 → 🔴 전환을 놓치지 않음 */
export async function simFollow({ max = 6, budgetMs = 25000 } = {}) {
  const { getJSON, setJSON } = await import('./store.mjs');
  const t0 = Date.now();
  const st = await getJSON('mp/state');
  const idx = (await getJSON('mp/idx')) || [];
  const d = idx[0]; if (!d || st?.date !== d || st?.phase !== 'done') return null; // 그날 정기 분석이 끝난 뒤에만
  const kst = new Date(Date.now() + 9 * 3600e3); const today = kst.toISOString().slice(0, 10);
  if (today !== d && !(today > d && kst.getUTCHours() < 8)) return null; // 다음 날 장 시작 전까지만 (그 뒤엔 그날 판정이 아님)
  const fk = `mp/sim/fol/${d}`;
  const fol = (await getJSON(fk)) || { rows: {} };
  if (fol.done) return null;
  if (!fol.todo) {
    const tr = await getJSON('mp/sim/tr');
    const perf = await (await import('./manipx.mjs')).ensurePerfRows(d);
    fol.todo = Object.entries(tr?.codes || {}).filter(([c, z]) => z.open && !perf.rows?.[c]).map(([c]) => c).slice(0, 300); fol.pos = 0;
  }
  const M = await import('./manip.mjs'); const X = await import('./manipx.mjs');
  const snap = (await getJSON(`mp/snap/${d}`))?.rows || {};
  const ctx = await M._ctxLoad(snap);
  let n = 0;
  while (fol.pos < fol.todo.length && n < max && Date.now() - t0 < budgetMs) {
    const part = fol.todo.slice(fol.pos, fol.pos + 3); fol.pos += part.length;
    await Promise.all(part.map(async (c) => {
      try { const prev = await getJSON(`mp/prof/${c}`); const x = await M._analyzeOne({ c, name: prev?.name || null, mkt: prev?.mkt || null }, { snap, snapD: d, ctx, keepLow: true, aiOk: () => false, light: true });
        if (x?.f) { const row = await X.perfRowOf(x, M.RULE_V); row.fo = 1; fol.rows[c] = row; } } catch {}
    }));
    n += part.length;
  }
  if (fol.pos >= fol.todo.length) fol.done = 1;
  await setJSON(fk, fol);
  return { d, n, pos: fol.pos, of: fol.todo.length };
}
// ───── 🤖 성공·실패 AI 해설 (v222) ─────
//  끝난 거래마다(🟢·매매 후보·A·B·매집/판 깔기) 산 날~판 날 사이 공시·시장 움직임·주가 경로를 '사실 목록'으로 주고
//  가벼운 모델이 2~3문장으로 왜 벌었는지/잃었는지 설명 → 사실에 없는 숫자가 든 문장은 지움(numcheck)
//  · 이유를 사실로 설명 못 하면(공시도 없고 시장도 조용) 'NONE' → 표시 안 함 · 하루 최대 150건 · `mp/sim/ai`
//  · 신호별 'AI 정리'는 7일마다(또는 거래가 30% 늘면) 1번: 통계 숫자 + 거래 해설에서 모은 공시 종류 → 3~4문장 `mp/sim/gai`
const AI_SIGS = ['g', 'pk', 'AB', 'acc'];
const KIND_KO = { insider_b: '임원·주요주주 장내 매수', insider_s: '임원·주요주주 장내 매도', mna: '경영권 변경', rights3: '3자배정 증자', rights: '유상증자', cb: 'CB·BW 발행', conv: '전환청구', refix: '전환가 조정', fund5: '투자조합 지분', sell: '대주주 매도', pledge: '주식 담보', fail: '철회·납입 연기', risk: '위험 공시', paid: '납입 완료', insider: '임원·주요주주 매매', tsell: '자사주 처분', bonus: '무상증자', supply: '공급계약', ceo: '대표 변경', rename: '상호 변경', agm: '주총 안건', halt: '거래정지', lock: '보호예수' , mv_mnaFund: '무자본 M&A 구조', mv_cbRefix: '전환가 낮추기', mv_cbMany: 'CB 남발', mv_r3Many: '3자배정 쪼개기', mv_themeFund: '테마 갈아타기+자금조달', mv_goodNews: '조달 뒤 호재 몰림', mv_paidUp: '납입 뒤 급등', mv_convPump: '띄운 뒤 전환', mv_cbBuy: 'CB 되사기', mv_ceoChurn: '대표 잦은 교체', mv_pledge: '대주주 주식 담보', mv_majSell: '대주주 지분 감소', mv_dilute: '희석 과다', mv_inquiry: '거래소 조회공시', mv_risk: '감사·횡령·관리 위험' };
export async function simAiStep({ max = 4, budgetMs = 30000, dayCap = 150 } = {}) {
  const { getJSON, setJSON } = await import('./store.mjs');
  const { claude, hasAI } = await import('./ai.mjs');
  if (!hasAI()) return null;
  const t0 = Date.now(), kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const cnt = (await getJSON(`mp/sim/aicnt/${kst}`)) || { n: 0 };
  if (cnt.n >= dayCap) return null;
  const [tr, bt] = await Promise.all([getJSON('mp/sim/tr'), loadBtTrades()]);
  const cache = (await getJSON('mp/sim/ai')) || { m: {} };
  const pick = [];
  const seen = new Set();
  const add = (src, t) => { if (!AI_SIGS.includes(t.s) || !t.T) return; const k = `${src}|${t.c}|${t.d}`; if (seen.has(k) || cache.m[k]) return; seen.add(k); pick.push({ src, t, k }); };
  for (const z of Object.values(tr?.codes || {})) for (const a of z.t || []) add('l', unpack(a));
  for (const a of bt?.t || []) add('b', unpack(a));
  pick.sort((x, y) => (x.src === y.src ? (x.t.d < y.t.d ? 1 : -1) : x.src === 'l' ? -1 : 1)); // 실제 기록·최근 거래부터
  const M = await import('./manip.mjs'); const { makeChecker } = await import('./numcheck.mjs');
  let done = 0;
  for (const { t, k } of pick.slice(0, max)) {
    if (Date.now() - t0 > budgetMs || cnt.n >= dayCap) break;
    const from = Date.parse(t.d) - 5 * 864e5, to = Date.parse(t.T.xd) + 864e5;
    let evs = []; try { evs = (await M._eventsOf(t.c, Date.now())).filter((e) => e.ms >= from && e.ms <= to).sort((a, b) => a.ms - b.ms); } catch {}
    const mkt = t.T.x != null ? Math.round((t.T.r - t.T.x) * 10) / 10 : null;
    const win = t.T.r > 0;
    const kinds = [...new Set(evs.map((e) => e.kind))];
    if (!evs.length && (mkt == null || Math.abs(mkt) < 3) && Math.abs(t.T.r) < 8) { cache.m[k] = { none: 1, w: win ? 1 : 0, k: kinds, at: Date.now() }; continue; } // 설명할 사실이 없음
    const facts = [
      `종목: ${t.n || t.c}`, `신호일: ${t.d}, 다음 날 시가 ${Math.round(t.e)}원에 매수`, `손절선 ${t.sp}원, 1차 목표가 ${t.tp}원`,
      `결과: ${t.T.xd}에 ${SIM_WHY_KO[t.T.w] || t.T.w}로 매도, 수익률 ${t.T.r}%, ${t.T.h}거래일 보유`,
      `보유 기간 60일 안 최고 ${t.mf}%, 최저 ${t.ma}%`,
      mkt != null ? `같은 기간 시장(지수) ${mkt}%` : null,
      ...evs.slice(0, 10).map((e) => `${new Date(e.ms + 9 * 3600e3).toISOString().slice(0, 10)} 공시: ${e.title}${e.sum ? ` (${e.sum})` : ''} [${KIND_KO[e.kind] || e.kind}]`),
    ].filter(Boolean);
    const prompt = `아래는 한 종목을 신호에 따라 사고판 기록의 '사실 목록'이다. 이 매매가 왜 ${win ? '수익' : '손실'}으로 끝났는지 한국 개인투자자에게 2~3문장으로 설명하라.
규칙: 사실 목록에 있는 내용만 쓴다. 목록에 없는 숫자·사건·추측(세력 의도 단정 등)은 쓰지 않는다. 공시·시장 움직임과 주가 결과의 연결을 사실로 설명할 수 없으면 NONE 한 단어만 출력한다. '작전주'라는 말은 쓰지 않는다.

[사실 목록]
${facts.join('\n')}`;
    let txt = '';
    try { txt = String(await claude(prompt, { maxTokens: 400, timeout: 15000, json: false, lite: true, tag: '성적 AI 해설' }) || '').trim(); } catch { break; }
    cnt.n++; done++;
    const chk = makeChecker(facts.join('\n'));
    const keep = /^NONE\b/i.test(txt) ? '' : txt.split(/(?<=[.!?。다요])\s+/).filter((x) => x && !chk.bad(x).length).join(' ').slice(0, 400);
    cache.m[k] = keep.length >= 15 ? { t: keep, w: win ? 1 : 0, k: kinds, at: Date.now() } : { none: 1, w: win ? 1 : 0, k: kinds, at: Date.now() };
  }
  // 신호별 AI 정리 (7일마다 또는 거래 30%↑)
  let g = 0;
  if (Date.now() - t0 < budgetMs - 8000 && cnt.n < dayCap) {
    const gai = (await getJSON('mp/sim/gai')) || { m: {} };
    const sum = await simSummary().catch(() => null);
    for (const [src, D] of [['l', sum?.live], ['b', sum?.bt]]) {
      for (const gr of D?.groups || []) {
        const v = gr.T; if (!v || v.n < 10 || !AI_SIGS.includes(gr.s)) continue;
        const key = `${src}|${gr.s}`, old = gai.m[key];
        if (old && Date.now() - old.at < 7 * 864e5 && v.n < old.n * 1.3) continue;
        // 거래 해설에서 모은 공시 종류: 수익 거래 vs 손실 거래
        const tally = { 1: {}, 0: {} }; let nw = 0, nl = 0;
        for (const [ck, c] of Object.entries(cache.m)) { if (!ck.startsWith(src + '|')) continue; (c.w ? nw++ : nl++); for (const kk of c.k || []) tally[c.w][kk] = (tally[c.w][kk] || 0) + 1; }
        const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([kk, c]) => `${KIND_KO[kk] || kk} ${Math.round((c / Math.max(1, n)) * 100)}%`).join(', ') || '없음';
        const facts = [
          `신호: ${gr.ko}`, `끝난 거래 ${v.n}번, 수익 거래 비율 ${v.win}%, 거래당 평균 ${v.avg}%`, `수익 거래 평균 ${v.aw ?? '-'}%, 손실 거래 평균 ${v.al ?? '-'}%`,
          v.vs != null ? `레이더 전체보다 ${v.vs}%p` : null, v.half ? `앞 기간 평균 ${v.half.a ?? '-'}%, 뒤 기간 평균 ${v.half.z ?? '-'}%` : null,
          `판 이유 비율: ${(v.why || []).map(([w, p]) => `${SIM_WHY_KO[w] || w} ${p}%`).join(', ')}`,
          v.shake != null ? `손절된 거래 중 그 뒤 +20%까지 간 비율 ${v.shake}%` : null,
          `수익 거래에 많던 공시: ${top(tally[1], nw)}`, `손실 거래에 많던 공시: ${top(tally[0], nl)}`,
        ].filter(Boolean);
        const prompt = `아래는 주식 신호 '${gr.ko}'를 따라 샀을 때의 통계 '사실 목록'이다. 무엇이 성공을 만들고 무엇이 실패를 만들었는지, 그리고 이 신호를 쓸 때 주의할 점을 한국 개인투자자에게 3~4문장으로 정리하라. 사실 목록에 없는 숫자·추측은 쓰지 않는다. 표본이 적으면(30번 미만) 그 점을 먼저 말한다. '작전주'라는 말은 쓰지 않는다.\n\n[사실 목록]\n${facts.join('\n')}`;
        let txt = ''; try { txt = String(await claude(prompt, { maxTokens: 500, timeout: 15000, json: false, lite: true, tag: '성적 AI 정리' }) || '').trim(); } catch { break; }
        cnt.n++; g++;
        const chk = makeChecker(facts.join('\n'));
        const keep = txt.split(/(?<=[.!?。다요])\s+/).filter((x) => x && !chk.bad(x).length).join(' ').slice(0, 600);
        if (keep.length >= 20) gai.m[key] = { t: keep, n: v.n, at: Date.now() };
        if (Date.now() - t0 > budgetMs || g >= 2) break;
      }
      if (Date.now() - t0 > budgetMs || g >= 2) break;
    }
    if (g) await setJSON('mp/sim/gai', gai);
  }
  if (done || pick.length) await setJSON('mp/sim/ai', cache);
  if (done || g) await setJSON(`mp/sim/aicnt/${kst}`, cnt);
  return done || g ? { done, g, left: Math.max(0, pick.length - done) } : null;
}
const SIM_WHY_KO = { stop: '손절선', tgt: '1차 목표가', view: '판정 🔴 전환', time: '기간 끝 정리', halt: '거래정지', trail: '최고점 대비 −15%' };
const nfSum = (L) => { const o = {}; for (const z of L) for (const [k, v] of Object.entries(z || {})) o[k] = (o[k] || 0) + v; return o; };
export async function simSummary() {
  const { getJSON, setJSON } = await import('./store.mjs');
  const [tl, tr, bt, bfw, cache] = await Promise.all([getJSON('mp/sim/tl'), getJSON('mp/sim/tr'), loadBtTrades(), loadBtFw(), getJSON('mp/sim/sum')]);
  const { RULE_V } = await import('./manip.mjs');
  const key = `${SIM_V}|${RULE_V}|${tr?.at || 0}|${bt?.at || 0}|${bfw?.at || 0}|cap${CAP_MAX}|x2`;
  if (cache?.key === key) return cache.out;
  const cm = await capMap();
  const L0 = Object.values(tr?.codes || {}).flatMap((z) => (z.t || []).map(unpack)), BT0 = (bt?.t || []).map(unpack);
  const L = L0.filter((t) => !tooBig(cm, t.c, t.e)), BT = BT0.filter((t) => !tooBig(cm, t.c, t.e));
  const nfL = nfSum(Object.values(tr?.codes || {}).map((z) => z.nf));
  // 점수 검증용 점: 실제 기록(판정 기록의 숫자 + 그 뒤 수익률) · 과거 재현
  const ptsL = [];
  for (const [c, z] of Object.entries(tl?.codes || {})) { if (tooBig(cm, c, null)) continue; const fw = new Map((tr?.codes?.[c]?.fw || []).map((r) => [r[0], r.slice(1)])); for (const p of z.p) { const x = fw.get(p[0]); if (x) ptsL.push({ di: p[0], v: p[6] || {}, x }); } }
  const ptsB = (bfw?.r || []).filter((r) => !r[8] || !tooBig(cm, r[8], null)).map((r) => ({ di: r[0], v: { s: r[1], ws: r[2], rr: r[3], gp: r[4] }, x: [r[5], r[6], r[7]] }));
  const now = L.filter((t) => t.rv === RULE_V);
  const out = {
    rv: RULE_V,
    live: { days: tl?.dates?.length || 0, left: Object.values(tr?.codes || {}).filter((z) => z.need).length, ...simStats(L, nfL), ic: icStats(ptsL) },
    now: { ...simStats(now, {}), ic: null },
    bt: { ...simStats(BT, bt?.nf || {}), ic: icStats(ptsB) },
  };
  // 지금 규칙만 보기의 점수 검증: 그 규칙으로 판정한 날만
  { const okD = new Set(); for (const z of Object.values(tl?.codes || {})) for (const p of z.p) if (p[5] === RULE_V) okD.add(p[0]); out.now.ic = icStats(ptsL.filter((p) => okD.has(p.di))); out.now.days = okD.size; }
  // v222 시장 대비 버전 + 🧠 다시 배운 기준
  out.liveX = { ...simStats(toExcess(L), {}), days: out.live.days }; out.btX = { ...simStats(toExcess(BT), {}) }; out.nowX = { ...simStats(toExcess(now), {}) };
  out.live.learn = learnScore(L); out.bt.learn = learnScore(BT); out.now.learn = learnScore(now);
  out.liveX.learn = learnScore(toExcess(L)); out.btX.learn = learnScore(toExcess(BT));
  // v222 📏 시가총액별 성적 (세력주를 몇 억까지로 볼지 데이터로 정하기): 거르기 전 모든 거래('레이더 전체' 신호)를 그날 시총 구간별로
  const capStudy = (T0) => CAP_B.map(([lo, hi, ko]) => {
    const g = T0.filter((t) => t.s === 'all' && t.T && (() => { const c = capAt(cm, t.c, t.e); return c != null && c >= lo && c < hi; })());
    if (!g.length) return { ko, n: 0 };
    const rs = g.map((t) => t.T.r), pk = g.map((t) => t.pk?.[2]).filter(Boolean);
    return { ko, n: g.length, avg: r1(mean(rs)), win: Math.round((rs.filter((x) => x > 0).length / rs.length) * 100), up: pk.length ? r1(pct(pk.map((x) => x[0]), 0.5)) : null, dn: pk.length ? r1(pct(pk.map((x) => x[1]), 0.5)) : null, r20: pk.length ? Math.round((pk.filter((x) => x[0] >= 20).length / pk.length) * 100) : null };
  });
  out.live.capStudy = capStudy(L0); out.bt.capStudy = capStudy(BT0); out.capMax = CAP_MAX;
  out.live.win = winStudy(L); out.bt.win = winStudy(BT); out.now.win = out.live.win; // v224 🏆 이긴 자리 공통점
  out.bt.strat = stratFind(BT); out.live.strat = stratFind(L); out.now.strat = out.live.strat; // v229 ⭐ 전략 자동 찾기
  out.bt.avoid = avoidStudy(BT); out.live.avoid = avoidStudy(L); out.now.avoid = out.live.avoid; // v231 🛡 피하기 검증
  // v268: 과거 재현이 다 끝났을 때만 배운 규칙(🛡 피하기·⭐ 전략·🏆 이긴/실패 패턴)을 레이더 판정에 반영 — 계산 중간(일부 종목만)으로 덮어써 판정이 흔들리던 문제(제넥신 🟢→🟡)
  const btDone = await (async () => { try { const { getJSON } = await import('./store.mjs'); const b = await getJSON('mp/bt/state'); return !!b?.done; } catch { return false; } })();
  out.learnFrozen = !btDone;
  if (!btDone) { const { getJSON } = await import('./store.mjs'); const wp0 = await getJSON('mp/winpat').catch(() => null); if (wp0 && !wp0.off) { await setJSON('mp/winpat', { off: 1, at: Date.now(), why: '과거 재현 계산 중' }).catch(() => {}); await setJSON('mp/avoidlearn', { k: {}, at: Date.now(), off: 1 }).catch(() => {}); await setJSON('mp/strat', { none: 1, at: Date.now(), off: 1 }).catch(() => {}); } } // 계산 중간에 배운 규칙은 끔(끝나면 다시 배움)
  if (btDone) {
  { const A = out.bt.avoid; if (A?.items) { const k = {}; for (const it of A.items) if (it.sure && it.vd?.k && it.vd.k !== 'n') k[it.k] = it.vd.k; await setJSON('mp/avoidlearn', { k, at: Date.now(), n: A.n }).catch(() => {}); } } // 앞·뒤 반 기간이 같은 결과인 항목만 자동 반영
  if (out.bt.strat?.best) await setJSON('mp/strat', { ...out.bt.strat.best, at: Date.now(), baseTe: out.bt.strat.baseTe, rho: out.bt.strat.rho }).catch(() => {}); else await setJSON('mp/strat', { none: 1, at: Date.now() }).catch(() => {});
  { const wp = winPatOf(out.bt.win); if (wp) await setJSON('mp/winpat', { ...wp, at: Date.now(), src: 'bt' }).catch(() => {}); } // 레이더 판정(🟢·🟡)이 읽어 감
  }
  // 실제 vs 과거 재현 차이 (실제가 훨씬 나쁘면 '과거에만 맞춘 규칙' 신호)
  out.gap = out.live.groups.map((g) => { const a = g.T, b2 = out.bt.groups.find((x) => x.s === g.s)?.T; return a && b2 && a.n >= 20 && b2.n >= 20 ? { s: g.s, ko: g.ko, live: a.avg, bt: b2.avg, d: r1(a.avg - b2.avg) } : null; }).filter(Boolean);
  await setJSON('mp/sim/sum', { key, out }).catch(() => {});
  return out;
}
/** 신호별 거래 목록 (src: live|now|bt) + 거래별 AI 해설 + 신호 AI 정리 */
export async function simRows(src, s, limit = 500) {
  const { getJSON } = await import('./store.mjs');
  let L = src === 'bt' ? ((await loadBtTrades())?.t || []).map(unpack) : Object.values((await getJSON('mp/sim/tr'))?.codes || {}).flatMap((z) => (z.t || []).map(unpack));
  if (src === 'now') { const { RULE_V } = await import('./manip.mjs'); L = L.filter((t) => t.rv === RULE_V); }
  { const cm = await capMap(); L = L.filter((t) => !tooBig(cm, t.c, t.e)); }
  const [ai, gai] = await Promise.all([getJSON('mp/sim/ai'), getJSON('mp/sim/gai')]);
  const p = src === 'bt' ? 'b' : 'l';
  const A = L.filter((t) => t.s === s).sort((a, b) => (a.d < b.d ? 1 : -1));
  // v290 (GK 10/24 🔥 띄우기·엑시트 후 '종목 0번'): 거래가 많은 신호는 최근 500번이 전부 120거래일이 안 지나 최고·최저 보기에서 다 빠졌음 → 최근 300번 + 120거래일 지난 것 최근 500번을 합쳐 보냄
  const seen = new Set(), pick = []; for (const t of [...A.slice(0, 300), ...A.filter((t) => t.pk?.[3]).slice(0, limit)]) { const k = `${t.c}|${t.d}`; if (!seen.has(k)) { seen.add(k); pick.push(t); } }
  const rows = pick.map(({ g, ...t }) => ({ ...t, ai: ai?.m?.[`${p}|${t.c}|${t.d}`]?.t || null }));
  return { rows: await fixNames(rows), gai: gai?.m?.[`${p}|${s}`]?.t || null };
}

/** v222 🔎 성과검증 종목 검색: 이름·코드로 그 종목의 따라 샀다면 기록(실제·과거 재현)·판정 기록·AI 해설 */
export async function simStock(q) {
  const { getJSON } = await import('./store.mjs');
  const [tl, tr, bt, ai] = await Promise.all([getJSON('mp/sim/tl'), getJSON('mp/sim/tr'), loadBtTrades(), getJSON('mp/sim/ai')]);
  const names = new Map();
  for (const [c, z] of Object.entries(tl?.codes || {})) names.set(c, z.n || names.get(c) || c);
  const btBy = new Map();
  for (const a of bt?.t || []) { const t = unpack(a); if (!btBy.has(t.c)) btBy.set(t.c, []); btBy.get(t.c).push(t); if (!names.has(t.c) || names.get(t.c) === t.c) names.set(t.c, t.n || t.c); }
  try { const nc = (await getJSON('mp/names')) || {}; for (const [c, n] of Object.entries(nc)) if (names.has(c) && (names.get(c) === c || !names.get(c))) names.set(c, n); } catch {}
  const norm = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
  const qq = norm(q);
  if (!qq) return { matches: [] };
  let codes = [...names.keys()].filter((c) => c === qq || norm(names.get(c)) === qq);
  if (!codes.length) codes = [...names.keys()].filter((c) => c.startsWith(qq) || norm(names.get(c)).includes(qq));
  const cnt = (c) => (tr?.codes?.[c]?.t?.length || 0) + (btBy.get(c)?.length || 0);
  if (codes.length !== 1) return { matches: await fixNames(codes.sort((a, b) => cnt(b) - cnt(a)).slice(0, 15).map((c) => ({ c, n: names.get(c), live: tr?.codes?.[c]?.t?.length || 0, bt: btBy.get(c)?.length || 0 }))) };
  const c = codes[0];
  // 같은 날 산 여러 신호는 한 매수로 묶음 (같은 날·같은 가격이면 결과도 같음)
  const group = (L, p) => { const m = new Map(); for (const t of L.sort((a, b) => (a.d < b.d ? 1 : -1))) { const k = t.d; if (!m.has(k)) m.set(k, { ...t, sigs: [], ai: ai?.m?.[`${p}|${c}|${t.d}`]?.t || null }); m.get(k).sigs.push(t.s); } return [...m.values()].map(({ g, ...x }) => x); };
  const live = group((tr?.codes?.[c]?.t || []).map(unpack), 'l');
  const back = group(btBy.get(c) || [], 'b');
  const z = tl?.codes?.[c];
  const judg = (z?.p || []).slice(-60).reverse().map(([di, f, tp, sp, a]) => ({ d: tl.dates[di], vd: a?.vd || null, st: a?.st || null, ck: a?.ck || null, rr: a?.rr || null, bad: !!(f & BAD), tp, sp }));
  const nm = names.get(c) && names.get(c) !== c ? names.get(c) : (await namesOf([c]))[c] || c;
  return { c, n: nm, live, bt: back, judg, sigs: Object.fromEntries(SIGS) };
}

// v222: 이름 없이 코드만 있는 종목(그날 시세 목록에 없던 거래정지·상장폐지 종목 등) → 공시 보관함(items)의 회사 이름으로 채움, `mp/names`에 저장
export async function namesOf(codes) {
  const { getJSON, setJSON, sqlDB } = await import('./store.mjs');
  const want = [...new Set(codes.filter((c) => /^[0-9A-Z]{6}$/.test(c)))];
  const cache = (await getJSON('mp/names')) || {};
  const miss = want.filter((c) => !cache[c]);
  if (miss.length) {
    const d = await sqlDB().catch(() => null);
    if (d) {
      for (let i = 0; i < miss.length && i < 300; i += 50) {
        const part = miss.slice(i, i + 50);
        try { const r = await d.prepare(`SELECT ticker AS t, MAX(name) AS n FROM items WHERE market = 'KR' AND ticker IN (${part.map(() => '?').join(',')}) AND name IS NOT NULL AND name != '' GROUP BY ticker`).bind(...part).all(); for (const row of r.results || []) if (row.n) cache[row.t] = String(row.n).replace(/^\(주\)|㈜|주식회사/g, '').trim(); } catch {}
      }
      let k = 0; for (const c of miss) { if (cache[c]) continue; if (++k > 30) break; const p = await getJSON(`mp/prof/${c}`).catch(() => null); if (p?.name && p.name !== c) cache[c] = p.name; } // 보관함에도 없으면 레이더 카드 이름 (최대 30개)
    }
    // v277: 보관함·레이더 카드에도 없는 종목(옛날 상장폐지·이름 바뀐 종목 등 — 과거 재현 4년치에 많음) → 네이버 일봉 응답의 종목 이름(chartdata name)
    const left = miss.filter((c) => !cache[c]);
    if (left.length) {
      const tried = (await getJSON('mp/namesmiss').catch(() => null)) || {}; const now = Date.now();
      const todo = left.filter((c) => !tried[c] || now - tried[c] > 7 * 864e5).slice(0, 40);
      const { fetchWithTimeout, BROWSER_UA, decodeText } = await import('./util.mjs');
      for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(async (c) => {
        try { const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${c}&timeframe=day&count=1&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 5000); const buf = await r.arrayBuffer(), ct = r.headers.get('content-type') || '', head = new TextDecoder().decode(buf.slice(0, 120)); const x = decodeText(buf, /utf-?8/i.test(ct) || /encoding="?utf-?8/i.test(head) ? 'utf-8' : 'euc-kr'); const n = x.match(/<chartdata[^>]*\sname="([^"]+)"/)?.[1]?.trim(); if (n && n !== c) cache[c] = n; else tried[c] = now; } catch { tried[c] = now; }
      }));
      await setJSON('mp/namesmiss', tried).catch(() => {});
    }
    await setJSON('mp/names', cache).catch(() => {});
  }
  return cache;
}
export async function fixNames(rows, ck = 'c', nk = 'n') {
  const need = rows.filter((r) => !r[nk] || r[nk] === r[ck]).map((r) => r[ck]);
  if (!need.length) return rows;
  const m = await namesOf(need);
  return rows.map((r) => (!r[nk] || r[nk] === r[ck]) && m[r[ck]] ? { ...r, [nk]: m[r[ck]] } : r);
}

// v222 세력주 기준: 판정 '그날'의 시가총액이 5000억원 미만인 종목만 성적에 넣음 (GK: 우량주 빼고, 시총 기준으로)
//  그날 시가총액 = 지금 시가총액 × (그날 가격 ÷ 지금 가격)  — 일봉은 감자·분할 보정돼 있어 비율이 맞음 (증자·CB 전환으로 주식 수가 늘었으면 약간 크게 나옴)
export const CAP_MAX = Number(process.env.RADAR_CAP_MAX || 20000); // 억원 (GK: 최대 2조)
const CAP_B = [[0, 500, '500억 미만'], [500, 1000, '500억~1천억'], [1000, 3000, '1천억~3천억'], [3000, 5000, '3천억~5천억'], [5000, 10000, '5천억~1조'], [10000, 20000, '1조~2조'], [20000, 1e9, '2조 이상']];
let _cm = null, _cmAt = 0;
export async function capMap() {
  if (_cm && Date.now() - _cmAt < 30 * 60e3) return _cm;
  const { getJSON } = await import('./store.mjs');
  const idx = (await getJSON('mp/idx')) || [];
  let snap = null; for (const d of idx.slice(0, 5)) { snap = (await getJSON(`mp/snap/${d}`))?.rows; if (snap) break; }
  const m = new Map(); const caps = [];
  for (const [c, r] of Object.entries(snap || {})) { const v = r?.[6]; if (!(v > 0) || !(r[2] > 0)) continue; const eok = v > 1e7 ? v / 1e8 : v; m.set(c, { cap: eok, close: r[2] }); caps.push([c, eok]); }
  caps.sort((a, b) => a[1] - b[1]); const pct = {}; caps.forEach(([c], i) => { pct[c] = caps.length > 1 ? i / (caps.length - 1) : 0.5; });
  m.pct = pct;
  _cm = m; _cmAt = Date.now();
  return m;
}
/** 그날 가격 기준 시가총액(억) — 모르면 null */
export const capAt = (cm, code, price) => { const z = cm.get(code); if (!z) return null; return price > 0 ? z.cap * (price / z.close) : z.cap; };
export const tooBig = (cm, code, price, capKnown = null) => { const c = capKnown ?? capAt(cm, code, price); return c != null && c >= CAP_MAX; };

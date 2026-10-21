// v271 🚪 파는 법 · 나눠 사기 연구 (GK 10/21: "손절폭을 어차피 2~3분할 할 거니까 폭 넓게 잡아도 최종 손실은 적게")
//  과거 재현이 끝난 매수 기록(mp/bt/trades: 종목·신호일·진입가)을 그대로 두고, 종목마다 일봉을 다시 받아
//  여러 '사는 법 × 파는 법'을 같은 매수 자리에서 다시 계산해 비교 (backtest.mjs 계산은 안 건드림, 다시 돌릴 필요 없음)
//  · 수익률은 '계획한 돈 전체' 기준 — 나눠 사기에서 안 산 몫은 현금(0%)으로 셈 (그래야 나눠 사기 손실이 작게 보이는 착시가 없음)
//  · 같은 날 손절·목표 둘 다 닿으면 손절 먼저, 같은 날 지정가 체결 뒤 손절 가능(보수적) · 비용 0.5%(산 돈 기준)
//  · 비교는 같은 매수 자리끼리(짝 비교) → 주 단위로 묶은 t값 · 2025-01-01 앞/뒤 기간 둘 다 같은 방향이어야 ✅
//  · 계산 검증: 지금 기본 방식(TT)을 같은 일봉으로 다시 계산해 저장된 결과와 맞는지 비율(chk) — 틀리면 결과를 믿지 말 것
//  · 상장폐지 종목은 과거 재현에 없음(생존 편향) → 넓은 손절일수록 실제보다 좋게 보일 수 있음
import { getJSON, setJSON } from './store.mjs';

const EX_V = 1, PER = 120, COST = 0.5, SPLIT_D = '2025-01-01', RS = 200;
const SIGS = ['all', 'g', 'AB', 'acc', 'hot'];
// buy: [[비율, 가격(첫 진입가 대비)]] · stop: 첫 진입가 대비 손절 가격 · trail: 최고가 대비 종가 하락 폭 · half: 평단 대비 +x%에 절반 · tgt: 평단 대비 +x%에 전부 · max: 최대 보유 거래일
export const POL = [
  { id: 'P0', ko: '한 번에 · 손절 −15%(판정 손절) · 최고점 −15%/20일 (지금 기본)', buy: [[1, 1]], stop: 'sp', trail: 0.15, max: 20 },
  { id: 'P1', ko: '한 번에 · 손절 −25% · 최고점 −20% · 60일', buy: [[1, 1]], stop: 0.75, trail: 0.2, max: 60 },
  { id: 'P2', ko: '한 번에 · 손절 −35% · 최고점 −25% · 120일', buy: [[1, 1]], stop: 0.65, trail: 0.25, max: 120 },
  { id: 'P3', ko: '한 번에 · 손절 −25% · +20%에 절반 · 나머지 최고점 −20% · 60일', buy: [[1, 1]], stop: 0.75, half: 20, trail: 0.2, max: 60 },
  { id: 'P4', ko: '한 번에 · 손절 −35% · +30%에 전부 · 120일', buy: [[1, 1]], stop: 0.65, tgt: 30, max: 120 },
  { id: 'S1', ko: '2번 나눠(0%·−15%) · 손절 −25% · 최고점 −20% · 60일', buy: [[0.5, 1], [0.5, 0.85]], stop: 0.75, trail: 0.2, max: 60 },
  { id: 'S2', ko: '2번 나눠(0%·−15%) · 손절 −25% · +20%에 절반 · 나머지 최고점 −20% · 60일', buy: [[0.5, 1], [0.5, 0.85]], stop: 0.75, half: 20, trail: 0.2, max: 60 },
  { id: 'S3', ko: '3번 나눠(0%·−10%·−20%) · 손절 −30% · 최고점 −20% · 60일', buy: [[1 / 3, 1], [1 / 3, 0.9], [1 / 3, 0.8]], stop: 0.7, trail: 0.2, max: 60 },
  { id: 'S4', ko: '3번 나눠(0%·−10%·−20%) · 손절 −30% · +20%에 절반 · 나머지 최고점 −20% · 60일', buy: [[1 / 3, 1], [1 / 3, 0.9], [1 / 3, 0.8]], stop: 0.7, half: 20, trail: 0.2, max: 60 },
  { id: 'S5', ko: '3번 나눠(0%·−10%·−20%) · 손절 −30% · 평단 +30%에 전부 · 120일', buy: [[1 / 3, 1], [1 / 3, 0.9], [1 / 3, 0.8]], stop: 0.7, tgt: 30, max: 120 },
  { id: 'S6', ko: '3번 나눠(0%·−15%·−25%) · 손절 −35% · +20%에 절반 · 나머지 최고점 −25% · 120일', buy: [[1 / 3, 1], [1 / 3, 0.85], [1 / 3, 0.75]], stop: 0.65, half: 20, trail: 0.25, max: 120 },
  { id: 'S7', ko: '3번 나눠(0%·−10%·−20%) · 손절 −30% · 평단 +15%에 전부 · 60일', buy: [[1 / 3, 1], [1 / 3, 0.9], [1 / 3, 0.8]], stop: 0.7, tgt: 15, max: 60 },
];
const r1 = (x) => Math.round(x * 10) / 10;
const wk = (d) => Math.floor((Date.parse(d) / 864e5 + 3) / 7);

/** 한 매수 자리를 한 방식으로 계산. B 일봉, ei 진입일 번호, e 진입가(다음 날 시가), sp 판정 손절가 → {r: 계획 돈 대비 %, u: 쓴 돈 비율, h: 보유일, w} | null(아직 진행 중) */
export function simPol(B, ei, e, sp, P, stale) {
  const stopPx = P.stop === 'sp' ? (sp > 0 && sp < e ? sp : e * 0.9) : e * P.stop;
  const tr = P.buy.map(([f, l]) => ({ f, px: e * l, done: l >= 1 }));
  let qty = 0, qb = 0, spent = 0, cash = 0, hi = e, sold = false, halfDone = false;
  for (const t of tr) if (t.done) { qty += t.f / e; qb += t.f / e; spent += t.f; }
  const fin = (k, w) => { const used = spent; const r = (cash - spent) * 100 - COST * used; return { r: r1(r), u: Math.round(used * 100) / 100, h: k - ei + 1, w }; };
  const end = Math.min(B.length, ei + P.max);
  for (let k = ei; k < end; k++) {
    const x = B[k], o = k === ei ? e : x.o || x.c;
    if (!sold) for (const t of tr) if (!t.done && x.l <= t.px && t.px > stopPx) { const px = Math.min(o, t.px); t.done = true; qty += t.f / px; qb += t.f / px; spent += t.f; }
    if (x.l <= stopPx) { cash += qty * Math.min(o, stopPx); qty = 0; return fin(k, 'stop'); }
    const avg = qb ? spent / qb : e; // 평단 = 산 돈 ÷ 산 주식 수
    if (P.tgt && x.h >= avg * (1 + P.tgt / 100)) { cash += qty * Math.max(o, avg * (1 + P.tgt / 100)); qty = 0; return fin(k, 'tgt'); }
    if (P.half && !halfDone && x.h >= avg * (1 + P.half / 100)) { const q = qty / 2; cash += q * Math.max(o, avg * (1 + P.half / 100)); qty -= q; halfDone = true; sold = true; }
    hi = Math.max(hi, x.h);
    if (P.trail && x.c <= hi * (1 - P.trail) && B[k + 1]) { cash += qty * (B[k + 1].o || B[k + 1].c); qty = 0; return fin(k + 1, 'trail'); }
  }
  const k = ei + P.max - 1;
  if (B[k]) { cash += qty * B[k].c; qty = 0; return fin(k, 'time'); }
  if (stale) { cash += qty * B[B.length - 1].c; qty = 0; return fin(B.length - 1, 'halt'); }
  return null;
}

// 저장된 TT와 같은 계산(검증용) — tradesim runTrail(false, 20)과 같은 규칙
function simTT(B, ei, e, sp, stale) {
  const spc = sp > 0 && sp < e ? sp : e * 0.9; let hi = e;
  for (let k = ei; k < Math.min(B.length, ei + 20); k++) { const x = B[k], o = x.o || x.c;
    if (x.l <= spc) return (Math.min(o, spc) / e - 1) * 100 - COST;
    hi = Math.max(hi, x.h); if (x.c <= hi * 0.85 && B[k + 1]) return ((B[k + 1].o || B[k + 1].c) / e - 1) * 100 - COST; }
  if (B[ei + 19]) return (B[ei + 19].c / e - 1) * 100 - COST;
  if (stale) return (B[B.length - 1].c / e - 1) * 100 - COST;
  return null;
}

// 피할 조합(🧭 규칙 찾기 10/21 ✅) 근사: 대표 변경 + 전환청구/띄운 뒤 전환 · 납입 뒤 급등 + 물량 신호(60일 안 전환청구·대주주 매도·자사주 처분)
const avoidOf = (a) => (a?.e_ceo && (a.e_conv || a.e_mv_convPump)) || (a?.e_mv_paidUp && (a.e_conv || a.e_sell || a.e_tsell || a.e_mv_majSell)) ? 1 : 0;

function rsPush(o, k, v) { const a = (o[k] ||= []); const c = (o['_' + k] = (o['_' + k] || a.length) + 1); if (a.length < RS) a.push(v); else { const j = Math.floor(Math.random() * c); if (j < RS) a[j] = v; } }

async function init() {
  const TS = await import('./tradesim.mjs');
  const bt = await getJSON('mp/bt/state').catch(() => null);
  if (!bt?.done) return { skip: 'bt not done' };
  const T = await TS.loadBtTrades(); if (!T?.t?.length) return { skip: 'no trades' };
  const by = new Map();
  for (const a of T.t) { const t = TS.unpack(a); if (!SIGS.includes(t.s)) continue; const m = by.get(t.c) || new Map(); const k = t.d; const z = m.get(k) || { d: t.d, e: t.e, sp: t.sp, s: [], tt: null, av: avoidOf(t.a), mk: t.a?.mk || null }; z.s.push(t.s); if (t.TT && z.tt == null && t.s === 'all') z.tt = t.TT.r; if (t.TT && z.tt == null) z.tt = t.TT.r; m.set(k, z); by.set(t.c, m); }
  const items = [...by.entries()].map(([c, m]) => [c, [...m.values()].map((z) => [z.d, z.e, z.sp, z.s.join(','), z.tt, z.av, z.mk])]);
  const { partsReset, partsAppend } = await import('./btstore.mjs');
  await partsReset('mp/exl/q', EX_V);
  for (let i = 0; i < items.length; i += PER) await partsAppend('mp/exl/q', items.slice(i, i + PER), { per: PER, maxParts: 60, v: EX_V });
  const st = { v: EX_V, btDone: bt.doneAt || bt.at || 0, pos: 0, of: items.length, ent: items.reduce((s, x) => s + x[1].length, 0), agg: {}, wk: {}, rs: {}, chk: { n: 0, ok: 0, bad: [] }, miss: 0, err: 0, started: Date.now() };
  await setJSON('mp/exl/state', st);
  return { init: items.length };
}

export async function exitLabStep({ budgetMs = 40000, maxCodes = 14 } = {}) {
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 700) return { skip: 'db slow' };
  const ms = await getJSON('mp/state').catch(() => null); if ((ms?.busyUntil || 0) > Date.now()) return { skip: 'radar busy' };
  let st = await getJSON('mp/exl/state').catch(() => null);
  const bt = await getJSON('mp/bt/state').catch(() => null);
  if (!bt?.done) return { skip: 'bt not done' };
  if (!st || st.v !== EX_V || st.btDone !== (bt.doneAt || bt.at || 0)) return init();
  if (st.done) return null;
  const M = await import('./manip.mjs');
  const pi = Math.floor(st.pos / PER), part = (await getJSON(`mp/exl/q/p${pi}`).catch(() => null)) || [];
  if (!part.length) { st.done = true; st.doneAt = Date.now(); await setJSON('mp/exl/state', st); return { done: 1 }; }
  const now = Date.now(); let n = 0;
  while (n < maxCodes && Date.now() - t0 < budgetMs) {
    const it = part[st.pos - pi * PER]; if (!it) break;
    const [code, ents] = it; n++; st.pos++;
    let B = null; try { B = await M._bars(code, 1000); } catch { st.err++; }
    if (B?.length) {
      const stale = Date.parse(B[B.length - 1].d) < now - 10 * 864e5;
      for (const [d, e, sp, sigs, tt, av, mk] of ents) {
        let ei = -1; for (let k = 0; k < B.length; k++) if (B[k].d > d) { ei = k; break; }
        if (ei < 0) continue;
        const o = B[ei].o || B[ei].c; if (Math.abs(o / e - 1) > 0.02) { st.miss++; continue; } // 진입가가 일봉과 안 맞음(보정 차이 등) → 뺌
        // 검증: 기본 방식(TT) 다시 계산 vs 저장값
        if (tt != null) { const v = simTT(B, ei, e, sp, stale); if (v != null) { st.chk.n++; if (Math.abs(v - tt) <= 0.3) st.chk.ok++; else if (st.chk.bad.length < 20) st.chk.bad.push([code, d, r1(tt), r1(v)]); } }
        const res = POL.map((P) => simPol(B, ei, e, sp, P, stale));
        if (!res[0]) continue;
        const half = d < SPLIT_D ? 'a' : 'b', w = wk(d);
        const ss = sigs.split(','); if (ss.includes('all') && !av) ss.push('all_av');
        for (const s of new Set(ss)) for (let pi2 = 0; pi2 < POL.length; pi2++) {
          const z = res[pi2]; if (!z) continue; const K = s + '|' + POL[pi2].id;
          const A = (st.agg[K] ||= [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // n, sum, sumsq, win, lossN, lossSum, used, hold, na, sa, nb, sb
          A[0]++; A[1] += z.r; A[2] += z.r * z.r; if (z.r > 0) A[3]++; else { A[4]++; A[5] += z.r; } A[6] += z.u; A[7] += z.h; if (half === 'a') { A[8]++; A[9] += z.r; } else { A[10]++; A[11] += z.r; }
          rsPush(st.rs, K, z.r);
          if (pi2 > 0) { const W = (st.wk[K] ||= {}); const x = (W[w] ||= [0, 0, 0]); x[0] += z.r - res[0].r; x[1]++; x[2] = half === 'a' ? 0 : 1; }
          if (mk && (s === 'all' || s === 'acc')) { const R = (st.agg[K + '|' + mk] ||= [0, 0]); R[0]++; R[1] += z.r; }
        }
      }
    }
  }
  st.at = Date.now();
  if (st.pos >= st.of) { st.done = true; st.doneAt = Date.now(); }
  await setJSON('mp/exl/state', st);
  return { pos: st.pos, of: st.of, codes: n };
}

const SIG_KO = { all: '레이더 전체', all_av: '레이더 전체 − 피할 조합 3개 뺌', g: '🟢 매수 검토', AB: '체크리스트 A·B등급', acc: '매집·판 깔기', hot: '🔥 띄우기·엑시트 후' };
export async function exitReport() {
  const st = await getJSON('mp/exl/state').catch(() => null);
  if (!st) return { none: 1 };
  const prog = { pos: st.pos, of: st.of, ent: st.ent, done: !!st.done, miss: st.miss, err: st.err, chk: { n: st.chk.n, ok: st.chk.ok, pct: st.chk.n ? Math.round((st.chk.ok / st.chk.n) * 1000) / 10 : null, bad: st.chk.bad } };
  const sigs = [];
  for (const s of ['all', 'all_av', 'g', 'AB', 'acc', 'hot']) {
    const rows = [];
    for (const P of POL) {
      const K = s + '|' + P.id, A = st.agg[K]; if (!A || !A[0]) continue;
      const n = A[0], avg = A[1] / n, sd = Math.sqrt(Math.max(0, A[2] / n - avg * avg));
      const rs = [...(st.rs[K] || [])].sort((a, b) => a - b), w5 = rs.length ? rs[Math.floor(rs.length * 0.05)] : null;
      let diff = null;
      if (P.id !== 'P0' && st.wk[K]) {
        const W = Object.values(st.wk[K]); const tot = W.reduce((x, y) => x + y[0], 0), cnt = W.reduce((x, y) => x + y[1], 0);
        const m = cnt ? tot / cnt : 0; // 주 묶음 표준오차
        let v = 0; for (const [sm, c] of W) v += (sm - m * c) ** 2; const se = cnt ? Math.sqrt(v) / cnt : null;
        const a = W.filter((x) => !x[2]), b = W.filter((x) => x[2]);
        const ma = a.reduce((x, y) => x + y[1], 0) ? a.reduce((x, y) => x + y[0], 0) / a.reduce((x, y) => x + y[1], 0) : null;
        const mb = b.reduce((x, y) => x + y[1], 0) ? b.reduce((x, y) => x + y[0], 0) / b.reduce((x, y) => x + y[1], 0) : null;
        const t = se ? m / se : null;
        diff = { d: r1(m), t: t == null ? null : r1(t), a: ma == null ? null : r1(ma), b: mb == null ? null : r1(mb), ok: t != null && t >= 2.5 && ma > 0 && mb > 0 ? 1 : t != null && t <= -2.5 && ma < 0 && mb < 0 ? -1 : 0 };
      }
      const reg = {}; for (const mk of ['상승', '보합', '하락']) { const R = st.agg[K + '|' + mk]; if (R?.[0]) reg[mk] = [R[0], r1(R[1] / R[0])]; }
      rows.push({ id: P.id, ko: P.ko, n, avg: r1(avg), sd: r1(sd), win: Math.round((A[3] / n) * 100), loss: A[4] ? r1(A[5] / A[4]) : null, w5: w5 == null ? null : r1(w5), used: Math.round((A[6] / n) * 100), hold: Math.round(A[7] / n), a: A[8] ? r1(A[9] / A[8]) : null, b: A[10] ? r1(A[11] / A[10]) : null, diff, reg });
    }
    if (rows.length) sigs.push({ s, ko: SIG_KO[s], rows });
  }
  return { prog, sigs, split: SPLIT_D };
}

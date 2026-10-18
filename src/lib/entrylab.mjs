// v237 🎯 타점 연구 — "어떤 종목이든 언제 들어가고 언제 파느냐"
//  ① 들어가는 자리(SETUPS) 10가지를 일봉으로 찾음 (그날 종가까지 자료만 — 미래 안 씀)
//  ② 다음 날 시가에 샀다면, 파는 방법(EXITS) 9가지로 각각 얼마였나 + '−10%가 +10%보다 먼저'(실패) 확률
//  ③ 비교 기준 = 아무 날이나 샀다면(rnd, 10거래일마다)
//  ④ 앞 기간에서 자리마다 가장 좋은 파는 법을 고르고 → 뒤 기간(안 본 기간)에서 확인 → 통과한 자리만 '검증됨'
import { getJSON, setJSON } from './store.mjs';

const r1 = (x) => Math.round(x * 10) / 10;
const COST = 0.5;
export const SETUPS = {
  brk: { ko: '20일 고가 돌파 + 거래량', t: '종가가 직전 20일 최고가를 넘고 거래량이 평소(20일 평균)의 1.5배↑인 양봉' },
  nh60: { ko: '60일 신고가', t: '종가가 직전 60일 최고가를 넘음' },
  pull: { ko: '급등 뒤 20일선 눌림', t: '최근 20일 안에 +20%↑ 오른 뒤, 저가가 20일선 근처(+2% 안)까지 내려왔지만 종가는 20일선 위 · 거래량은 평소 이하' },
  boxbig: { ko: '박스 뒤 장대양봉', t: '60일 가격 폭 35% 안의 박스에서 +8%↑ 양봉 · 거래량 3배↑' },
  dry1: { ko: '거래량 마름 뒤 첫 양봉', t: '20일 거래량이 120일 평균의 절반 이하로 말랐다가 거래량 2배↑ · +3%↑ 양봉' },
  accbar: { ko: '매집봉(긴 아래꼬리 + 거래량)', t: '아래꼬리가 몸통의 2배↑ · 거래량 2배↑ · 종가 ≥ 시가 · 하루 폭 4%↑' },
  gap: { ko: '갭 상승 유지', t: '시가가 전날 종가보다 +3%↑ 높게 시작하고 종가가 시가 위 · 거래량 1.5배↑' },
  crash: { ko: '급락 뒤 첫 반등', t: '20일 고점 대비 −30%↓ 빠진 뒤 +5%↑ 양봉 · 거래량 1.5배↑' },
  ma20x: { ko: '20일선 회복', t: '최근 20일 중 15일↑ 20일선 아래에 있다가 종가가 20일선 위로' },
  uplim: { ko: '상한가 다음 날', t: '그날 +28%↑(상한가 근처) — 다음 날 시가에 삼' },
  nhpl: { lim: 1, ko: '신고가 뒤 눌림 (지정가)', t: '60일 신고가 뒤 한 번 +7%↑ 오른 다음, 10거래일 안에 예전 고점(돌파한 가격) +3% 안까지 내려오면 그 가격에 삼 · 안 내려오면 안 삼', lv: 1 },
  nhpc: { ko: '신고가 뒤 눌림 확인', t: '60일 신고가 뒤 +7%↑ 오른 다음 예전 고점 근처까지 내려왔다가(−5% 아래로는 안 깨고) 전날 고가를 넘는 양봉(종가 ≥ 예전 고점)이 나오면 다음 날 시가', lv: 1 },
  nhpx: { ko: '눌림 안 옴 (못 산 경우)', t: '60일 신고가 뒤 +7%↑ 오르고 10거래일 안에 예전 고점까지 안 내려온 경우 — 신고가 다음 날 시가에 바로 샀다면 (참고: 기다렸다면 놓친 것)', lv: 1, ref: 1 },
  nhpw: { ko: '신고가 뒤 눌림 기다리는 중', t: '최근 10거래일 안에 60일 신고가 — 예전 고점 +3%까지 내려오면 지정가로 살 자리 (아직 안 내려옴)', lv: 1, live: 1 },
  rnd: { ko: '아무 날이나 (비교 기준)', t: '20거래일마다 아무 이유 없이 샀다면 — 이것보다 나아야 의미 있는 자리' },
};
export const EXITS = {
  s7t15: { ko: '손절 −7% · 목표 +15%', t: '20거래일 안에 −7%면 손절, +15%면 익절, 아니면 20일째 종가' },
  s10t30: { ko: '손절 −10% · 목표 +30%', t: '40거래일 안에 −10% 손절 · +30% 익절, 아니면 40일째' },
  tr15: { ko: '최고점 −15% 또는 20일', t: '산 뒤 최고가에서 종가가 −15% 빠지면 다음 날 시가, 아니면 20일째 종가 (지금 추천 방식)' },
  tr10: { ko: '최고점 −10% 또는 20일', t: '최고가에서 −10%면 다음 날 시가, 아니면 20일째' },
  ma5: { ko: '5일선 깨면 팔기', t: '종가가 5일 이동평균 아래로 내려가면 다음 날 시가 (최대 20일)' },
  half: { ko: '+20%에 절반, 나머지 −10% 추적', t: '+20% 닿으면 절반 팔고 나머지는 최고점 −10%에 (최대 30일)' },
  h5: { ko: '5일 들고 팔기', t: '5거래일째 종가' },
  h10: { ko: '10일 들고 팔기', t: '10거래일째 종가' },
  h20: { ko: '20일 들고 팔기', t: '20거래일째 종가' },
  evx: { ko: '세력 매도 신호까지 들고 가기', t: '전환청구·최대주주 장내매도·자사주 처분 공시가 나오면(또는 보호예수가 풀리는 날) 다음 날 시가에 팔기 · 최고점 −20%면 먼저 팔기 · 최대 120거래일 (공시가 있는 과거 재현에서만)' },
  lv5: { ko: '돌파 가격 −5% 손절 · 최고점 −15%', t: '예전 고점(돌파한 가격) −5% 아래로 빠지면 손절, 아니면 최고가 −15% 또는 20일 (60일 신고가·눌림 자리 전용)' },
};
const EX_KEYS = Object.keys(EXITS);
const NEED = 41; // 결과 계산에 필요한 뒤 일수

function prep(B) {
  const n = B.length, c = B.map((x) => x.c), v = B.map((x) => x.v);
  const ma = (arr, k, i) => { if (i + 1 < k) return null; let s = 0; for (let j = i - k + 1; j <= i; j++) s += arr[j]; return s / k; };
  const ma5 = B.map((_, i) => ma(c, 5, i)), ma20 = B.map((_, i) => ma(c, 20, i));
  const av20 = B.map((_, i) => (i >= 20 ? ma(v, 20, i - 1) : null)), av120 = B.map((_, i) => (i >= 120 ? ma(v, 120, i - 1) : null));
  return { n, c, v, ma5, ma20, av20, av120 };
}
const maxH = (B, a, b) => { let m = -1; for (let j = Math.max(0, a); j <= b; j++) m = Math.max(m, B[j].h); return m; };
const minL = (B, a, b) => { let m = 1e18; for (let j = Math.max(0, a); j <= b; j++) m = Math.min(m, B[j].l || B[j].c); return m; };
const maxC = (P, a, b) => { let m = -1; for (let j = Math.max(0, a); j <= b; j++) m = Math.max(m, P.c[j]); return m; };

/** 그날(i) 뜬 자리들 — i까지 자료만 */
export function setupsAt(B, i, P = prep(B)) {
  if (i < 120) return [];
  const x = B[i], p = B[i - 1], out = [];
  const vx = P.av20[i] ? x.v / P.av20[i] : 0, chg = p.c ? x.c / p.c - 1 : 0, up = x.c >= x.o;
  if (x.c > maxH(B, i - 20, i - 1) && vx >= 1.5 && x.c > x.o) out.push('brk');
  if (x.c > maxH(B, i - 60, i - 1)) out.push('nh60');
  if (maxC(P, i - 15, i - 1) >= P.c[i - 20] * 1.2 && P.ma20[i] && x.l <= P.ma20[i] * 1.02 && x.c >= P.ma20[i] && vx <= 1) out.push('pull');
  { const hi = maxH(B, i - 60, i - 1), lo = minL(B, i - 60, i - 1); if (lo > 0 && hi / lo < 1.35 && chg >= 0.08 && vx >= 3) out.push('boxbig'); }
  if (P.av120[i] && P.av20[i] / P.av120[i] <= 0.5 && vx >= 2 && chg >= 0.03 && up) out.push('dry1');
  { const body = Math.abs(x.c - x.o), lw = Math.min(x.o, x.c) - x.l; if (lw >= Math.max(body * 2, x.c * 0.005) && vx >= 2 && up && x.l > 0 && x.h / x.l - 1 >= 0.04) out.push('accbar'); }
  if (x.o >= p.c * 1.03 && x.c >= x.o && vx >= 1.5) out.push('gap');
  if (p.c / maxC(P, i - 20, i - 1) <= 0.7 && chg >= 0.05 && vx >= 1.5) out.push('crash');
  if (P.ma20[i] && x.c > P.ma20[i]) { let below = 0; for (let j = i - 20; j < i; j++) if (P.ma20[j] && P.c[j] < P.ma20[j]) below++; if (below >= 15) out.push('ma20x'); }
  if (chg >= 0.28) out.push('uplim');
  return out;
}

/** 다음 날 시가에 샀다면 파는 법 9가지 결과 (%, 비용 뺌) + 실패(−10%가 +10%보다 먼저)·20일 최고/최저 */
export function exitsFrom(B, i, P = prep(B), opt = {}) {
  const k0 = opt.k0 ?? i + 1; if (!B[k0 + NEED - 1]) return null;
  const e = opt.e ?? (B[k0].o || B[k0].c); if (!e) return null;
  if (opt.lim) { B = B.slice(); B[k0] = { ...B[k0], o: e, h: Math.max(e, B[k0].c) }; } // v243 지정가로 산 날: 사기 전 고가는 못 씀 (손절 쪽은 그날 저가 그대로 — 보수적)
  const ret = (px) => r1((px / e - 1) * 100 - COST);
  const R = {};
  const sl = (s, t, maxD) => { for (let k = k0; k < k0 + maxD; k++) { const x = B[k], o = x.o || x.c; if (x.l <= e * (1 - s)) return ret(Math.min(o, e * (1 - s))); if (x.h >= e * (1 + t)) return ret(Math.max(o, e * (1 + t))); } return ret(B[k0 + maxD - 1].c); };
  R.s7t15 = sl(0.07, 0.15, 20); R.s10t30 = sl(0.10, 0.30, 40);
  const trail = (dd, maxD) => { let hi = e; for (let k = k0; k < k0 + maxD; k++) { hi = Math.max(hi, B[k].h); if (B[k].c <= hi * (1 - dd) && B[k + 1]) return [ret(B[k + 1].o || B[k + 1].c), k + 1]; } return [ret(B[k0 + maxD - 1].c), k0 + maxD - 1]; };
  const t15 = trail(0.15, 20); R.tr15 = t15[0]; R.tr10 = trail(0.10, 20)[0];
  { let out = null; for (let k = k0 + 1; k < k0 + 20; k++) if (P.ma5[k] && B[k].c < P.ma5[k] && B[k + 1]) { out = ret(B[k + 1].o || B[k + 1].c); break; } R.ma5 = out ?? ret(B[k0 + 19].c); }
  { let hi = e, half = false, got = 0, res = null; for (let k = k0; k < k0 + 30; k++) { const x = B[k], o = x.o || x.c; if (!half && x.h >= e * 1.2) { half = true; got = 0.5 * Math.max(o, e * 1.2) / e; } hi = Math.max(hi, x.h); if (x.c <= hi * 0.9 && B[k + 1]) { const px = (B[k + 1].o || B[k + 1].c) / e; res = r1(((half ? got + 0.5 * px : px) - 1) * 100 - COST); break; } } if (res == null) { const px = B[k0 + 29].c / e; res = r1(((half ? got + 0.5 * px : px) - 1) * 100 - COST); } R.half = res; }
  R.h5 = ret(B[k0 + 4].c); R.h10 = ret(B[k0 + 9].c); R.h20 = ret(B[k0 + 19].c);
  R.evx = opt.ev ? (() => { const { sig, unl } = opt.ev; const T = (k) => Date.parse(B[k].d + 'T15:40:00+09:00'); const t0 = T(k0 - 1); let hi = e;
    for (let k = k0; k < Math.min(B.length, k0 + 120); k++) { const x = B[k]; if (unl.some((u) => u > t0 && Date.parse(B[k].d + 'T00:00:00+09:00') >= u)) return ret(x.o || x.c); hi = Math.max(hi, x.h); const tk = T(k), tp = T(k - 1);
      if ((x.c <= hi * 0.8 || sig.some((m) => m > tp && m <= tk)) && B[k + 1]) return ret(B[k + 1].o || B[k + 1].c); }
    return B[k0 + 119] ? ret(B[k0 + 119].c) : null; })() : null;
  R.lv5 = opt.lv ? (() => { const sp = opt.lv * 0.95; let hi = e; for (let k = k0; k < k0 + 20; k++) { const x = B[k], o = x.o || x.c; if (x.l <= sp) return ret(Math.min(o, sp)); hi = Math.max(hi, x.h); if (x.c <= hi * 0.85 && B[k + 1]) return ret(B[k + 1].o || B[k + 1].c); } return ret(B[k0 + 19].c); })() : null;
  let fail = 0; for (let k = k0; k < k0 + 20; k++) { const dn = B[k].l <= e * 0.9, upp = B[k].h >= e * 1.1; if (dn) { fail = 1; break; } if (upp) { fail = -1; break; } } // 같은 날이면 손절 먼저
  const mf = r1((maxH(B, k0, k0 + 19) / e - 1) * 100), mn = r1((minL(B, k0, k0 + 19) / e - 1) * 100);
  return { e, R, fail, mf, mn, xk: t15[1], gap: r1((e / B[i].c - 1) * 100) };
}

/** v245 사는 날 알 수 있는 위치·유동성: [60일 저점 대비 %, 20일 평균 거래대금(억)] */
function posLiq(B, i) { const lo = minL(B, i - 59, i); let t = 0, n = 0; for (let k = Math.max(0, i - 19); k <= i; k++) { t += (B[k].v || 0) * B[k].c; n++; } return [lo > 0 ? r1((B[i].c / lo - 1) * 100) : null, n ? r1(t / n / 1e8) : null]; }
/** v243 신고가 뒤 눌림 (GK: '신고가는 위 매물 때문에 조정 한 번 받고 반등을 노리는 게 낫지 않나') — 상태가 있어 setupsAt과 따로
 *  신고가 날 j, 예전 고점 L = 그 전 60일 최고가 → j+1~j+10 안 저가 ≤ L×1.03이면 nhpl(그 가격 지정가), 안 오면 nhpx(못 삼)
 *  닿은 뒤 5거래일 안 종가 > 전날 고가 & 양봉 & 종가 ≥ L이면 nhpc(다음 날 시가), 그 전에 종가 < L×0.95면 무효 */
function nhWin(B, from = 120) {
  const out = []; let i = Math.max(61, from); const n = B.length;
  while (i < n) {
    const L = maxH(B, i - 60, i - 1); if (!(B[i].c > L)) { i++; continue; }
    const j = i; let r = -1, k = -1;
    for (let t = j; t <= Math.min(j + 10, n - 1); t++) if (B[t].h >= L * 1.07) { r = t; break; } // 돌파 뒤 한 번 +7%↑ 올라가야 '조정'을 기다릴 의미가 있음
    if (r < 0) { if (j + 10 > n - 1) out.push({ s: 'nhpw', i: j, L, wait: 1 }); i = j + 1; continue; }
    for (let t = r + 1; t <= Math.min(r + 10, n - 1); t++) if (B[t].l <= L * 1.03 * 0.995) { k = t; break; } // 지정가는 0.5% 더 밑으로 뚫고 내려가야 체결로 봄 (딱 닿기만 하면 못 살 수 있음 — 보수적)
    if (k < 0) { if (r + 10 <= n - 1) out.push({ s: 'nhpx', i: j, L }); else out.push({ s: 'nhpw', i: j, L, wait: 1, up: 1 }); i = r + 11; continue; }
    out.push({ s: 'nhpl', i: k - 1, k0: k, e: Math.min(B[k].o || B[k].c, L * 1.03), L, j });
    for (let m = k; m <= Math.min(k + 5, n - 1); m++) { if (B[m].c < L * 0.95) break; if (B[m].c > B[m - 1].h && B[m].c > B[m].o && B[m].c >= L) { out.push({ s: 'nhpc', i: m, L, j }); break; } }
    i = k + 1;
  }
  return out;
}

/** 한 종목의 자리 사건 전부 (과거 재현용) — 같은 자리는 5거래일 안 한 번만 · rnd는 10거래일마다 */
export function entryEvents(B, { code, evs = [], ix = null, mkt = 'Q', motiveOf = null, px = null } = {}) {
  if (!B || B.length < 180) return [];
  const P = prep(B), out = [], last = {};
  const EV = px ? { sig: evs.filter((e) => ['conv', 'majsell', 'tsell'].includes(e.kind)).map((e) => e.ms).sort((a, b) => a - b), unl: (px || []).map((p) => p.lock?.until).filter(Boolean).map((u) => Date.parse(u + 'T00:00:00+09:00')) } : null; // v246 공시 근거 엑시트 (과거 재현에서만)
  const mk = mkt === 'P' ? 'P' : 'Q';
  const mret = (a, b) => { if (!ix) return null; let m = 1, n = 0; for (let k = a; k <= b; k++) { const p = ix[B[k]?.d]?.[mk]; if (p != null) { m *= 1 + p / 100; n++; } } return n ? (m - 1) * 100 : null; };
  for (let i = 120; i < P.n - NEED - 1; i++) {
    const S = setupsAt(B, i, P); if (i % 20 === 0) S.push('rnd');
    const fresh = S.filter((s) => !(last[s] != null && i - last[s] <= 5)); for (const s of S) last[s] = i;
    if (!fresh.length) continue;
    const X = exitsFrom(B, i, P, { ...(fresh.includes('nh60') ? { lv: maxH(B, i - 60, i - 1) } : {}), ev: EV }); if (!X) continue;
    const Tms = Date.parse(B[i].d + 'T15:40:00+09:00');
    const m20 = mret(i - 19, i), mreg = m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합';
    const pk = evs.some((e) => e.ms <= Tms && e.ms > Tms - 180 * 864e5 && ['cb', 'rights3', 'mna', 'fund5'].includes(e.kind)) ? 1 : 0;
    let mna = 0; if (motiveOf && pk) { try { mna = motiveOf(evs, { B, Tms }).includes('mnaFund') ? 1 : 0; } catch {} }
    const xm = mret(i + 1, X.xk); const xr = xm == null ? null : r1(X.R.tr15 - xm);
    const ctx2 = posLiq(B, i);
    for (const s of fresh) out.push([code, B[i].d, s, X.gap, mreg, pk, mna, X.fail, X.mf, X.mn, ...EX_KEYS.map((k) => (k === 'lv5' && s !== 'nh60' ? null : X.R[k])), xr, ...ctx2]);
  }
  // v243 신고가 뒤 눌림 3가지 (같은 신고가 날의 바로 사기(nh60)와 비교)
  for (const w of nhWin(B)) {
    if (w.wait || w.i < 120 || w.i >= P.n - NEED - 1) continue;
    const X = exitsFrom(B, w.i, P, w.s === 'nhpl' ? { k0: w.k0, e: w.e, lim: true, lv: w.L, ev: EV } : { lv: w.L, ev: EV }); if (!X) continue;
    const i = w.i, Tms = Date.parse(B[i].d + 'T15:40:00+09:00');
    const m20 = mret(i - 19, i), mreg = m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합';
    const pk = evs.some((e) => e.ms <= Tms && e.ms > Tms - 180 * 864e5 && ['cb', 'rights3', 'mna', 'fund5'].includes(e.kind)) ? 1 : 0;
    let mna = 0; if (motiveOf && pk) { try { mna = motiveOf(evs, { B, Tms }).includes('mnaFund') ? 1 : 0; } catch {} }
    const xm = mret((w.k0 ?? i + 1), X.xk); const xr = xm == null ? null : r1(X.R.tr15 - xm);
    out.push([code, B[i].d, w.s, X.gap, mreg, pk, mna, X.fail, X.mf, X.mn, ...EX_KEYS.map((k) => X.R[k]), xr, ...posLiq(B, i)]);
  }
  return out;
}
export const ROW = (a) => ({ c: a[0], d: a[1], s: a[2], gap: a[3], mk: a[4], pk: a[5], mna: a[6], fail: a[7], mf: a[8], mn: a[9], R: Object.fromEntries(EX_KEYS.map((k, j) => [k, a[10 + j]])), x: a[10 + EX_KEYS.length] });

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function cell(L, ex) { const v = L.map((t) => t.R[ex]).filter((x) => x != null); if (!v.length) return null; return { n: v.length, avg: r1(mean(v)), med: r1(med(v)), win: Math.round((v.filter((x) => x > 0).length / v.length) * 100), big: Math.round((v.filter((x) => x <= -15).length / v.length) * 100) }; }
const failOf = (L) => { const a = L.filter((t) => t.fail !== 0); return a.length ? Math.round((a.filter((t) => t.fail === 1).length / a.length) * 100) : null; };

/** 자리 × 파는 법 표 + 앞 기간에서 고른 최선의 파는 법을 뒤 기간에서 확인 */
/** v242 메모리 적게: 사건 줄을 한 번에 다 펼치지 않고 조각마다 더해 가며 통계 (20만 줄도 Workers 128MB 안)
 *  feed(cb): 줄 묶음(배열)을 차례로 cb에 넘기는 함수 — 두 번 부름(① 날짜 중간값 ② 더하기) */
const HB = 0.5, HLO = -200, HN = 1001; // 0.5%p 칸 −200~+300%
const hAdd = (h, v) => { let i = Math.round((v - HLO) / HB); if (i < 0) i = 0; if (i >= HN) i = HN - 1; h[i]++; };
const hMed = (h, n) => { if (!n) return null; let c = 0; const t = Math.floor(n / 2) + 1; for (let i = 0; i < HN; i++) { c += h[i]; if (c >= t) return r1(HLO + i * HB); } return null; };
const mkC = (hist = true) => ({ n: 0, sum: 0, ss: 0, win: 0, sw: 0, sl: 0, big: 0, h: hist ? new Uint32Array(HN) : null });
const cAdd = (c, v, wk = null) => { if (v == null || !isFinite(v)) return; c.n++; c.sum += v; c.ss += v * v; if (v > 0) { c.win++; c.sw += v; } else c.sl += v; if (v <= -15) c.big++; if (c.h) hAdd(c.h, v); if (wk != null) { const W = (c.W ||= new Map()); const z = W.get(wk) || [0, 0]; z[0]++; z[1] += v; W.set(wk, z); } };
const cOut = (c) => (c && c.n ? { n: c.n, avg: r1(c.sum / c.n), med: c.h ? hMed(c.h, c.n) : null, win: Math.round((c.win / c.n) * 100), big: Math.round((c.big / c.n) * 100), aw: c.win ? r1(c.sw / c.win) : null, al: c.n - c.win ? r1(c.sl / (c.n - c.win)) : null } : null);
/** 같은 주에 산 거래는 같이 움직임(시장) → 주 단위로 묶은 표준오차 (그냥 계산하면 '확실함'이 너무 쉽게 나옴) */
const cSE = (c) => { if (!c?.W || c.n < 2) return null; const m = c.sum / c.n; let v = 0, G = 0; for (const [, [n, sm]] of c.W) { v += (sm - n * m) ** 2; G++; } return G > 1 ? Math.sqrt((v * G) / (G - 1)) / c.n : null; };
const wkOf = (d) => Math.floor(Date.parse(d) / (7 * 864e5));
const CTX = { mk상승: (t) => t[4] === '상승', mk보합: (t) => t[4] === '보합', mk하락: (t) => t[4] === '하락', pk있음: (t) => t[5] === 1, pk없음: (t) => t[5] === 0, mna: (t) => t[6] === 1, gap하락: (t) => t[3] <= -3, gap보합: (t) => t[3] > -3 && t[3] < 3, gap상승: (t) => t[3] >= 3,
  pos낮음: (t) => t[XI + 1] != null && t[XI + 1] < 30, pos중간: (t) => t[XI + 1] != null && t[XI + 1] >= 30 && t[XI + 1] < 80, pos높음: (t) => t[XI + 1] != null && t[XI + 1] >= 80,
  liq작음: (t) => t[XI + 2] != null && t[XI + 2] < 5, liq중간: (t) => t[XI + 2] != null && t[XI + 2] >= 5 && t[XI + 2] < 30, liq큼: (t) => t[XI + 2] != null && t[XI + 2] >= 30,
  상승장_갭보합: (t) => t[4] === '상승' && t[3] > -3 && t[3] < 3, 하락장아님: (t) => t[4] != null && t[4] !== '하락', 위치80미만: (t) => t[XI + 1] != null && t[XI + 1] < 80 };
export const CTX_KO = { mk상승: '시장 상승장(20일 +3%↑)일 때만', mk보합: '시장 보합일 때만', mk하락: '시장 하락장일 때만', pk있음: '판 깔기 공시 있을 때만', pk없음: '판 깔기 공시 없을 때만', mna: '무자본 M&A 구조일 때만', gap하락: '다음 날 시가가 −3%↓로 열릴 때만', gap보합: '다음 날 시가가 ±3% 안일 때만', gap상승: '다음 날 시가가 +3%↑로 열릴 때만',
  pos낮음: '60일 저점 대비 +30% 안(아직 덜 오름)일 때만', pos중간: '60일 저점 대비 +30~80%일 때만', pos높음: '60일 저점 대비 +80%↑(많이 오름)일 때만', liq작음: '하루 거래대금 5억 미만일 때만', liq중간: '하루 거래대금 5~30억일 때만', liq큼: '하루 거래대금 30억↑일 때만', 상승장_갭보합: '상승장 + 시가 ±3% 안일 때만', 하락장아님: '하락장이 아닐 때만', 위치80미만: '60일 저점 대비 +80% 안(너무 안 오름)일 때만' };
const CTX_K = Object.keys(CTX);
const XI = 10 + EX_KEYS.length; // 줄의 시장 대비(xr) 자리 · 그 뒤 pos(60일 저점 대비 %)·liq(20일 평균 거래대금 억)
export async function entryStudyFeed(feed) {
  const dc = new Map(); let N = 0;
  await feed((rows) => { for (const t of rows) { dc.set(t[1], (dc.get(t[1]) || 0) + 1); N++; } });
  if (N < 200) return { n: N, need: 200 };
  const ds = [...dc.keys()].sort(); const cut = ds[Math.floor(ds.length / 2)];
  const S = {}; const get = (s) => (S[s] ||= { n: 0, A: {}, Z: {}, G: {}, f1: 0, fN: 0, mf: new Uint32Array(HN), mn: new Uint32Array(HN), xs: 0, xn: 0, ctx: {} });
  await feed((rows) => { for (const t of rows) { if (t[2] === 'nhpx') { const g0 = get('nhpx'); g0.n++; for (let j = 0; j < EX_KEYS.length; j++) cAdd(g0.G[EX_KEYS[j]] ||= mkC(false), t[10 + j]); continue; }
    const g = get(t[2]); g.n++; const isA = t[1] < cut, half = isA ? g.A : g.Z, wk = isA ? null : wkOf(t[1]);
    for (let j = 0; j < EX_KEYS.length; j++) { const k = EX_KEYS[j], v = t[10 + j]; cAdd(g.G[k] ||= mkC(), v); cAdd(half[k] ||= mkC(), v, wk); }
    if (t[7] === 1) g.f1++; if (t[7] !== 0) g.fN++; if (t[8] != null) hAdd(g.mf, t[8]); if (t[9] != null) hAdd(g.mn, t[9]); const x = t[XI]; if (x != null && isFinite(x)) { g.xs += x; g.xn++; }
    for (const cn of CTX_K) if (CTX[cn](t)) { const z = (g.ctx[cn] ||= { f1: 0, fN: 0, c: {}, A: {}, Z: {} }); if (t[7] === 1) z.f1++; if (t[7] !== 0) z.fN++; for (let j = 0; j < EX_KEYS.length; j++) { const k = EX_KEYS[j]; cAdd(z.c[k] ||= mkC(false), t[10 + j]); cAdd((isA ? z.A : z.Z)[k] ||= mkC(false), t[10 + j]); } } } });
  const fOf = (f1, fN) => (fN ? Math.round((f1 / fN) * 100) : null);
  const B = S.rnd || get('rnd'); const out = [];
  for (const s of Object.keys(SETUPS)) {
    if (SETUPS[s].live) continue;
    const g = S[s];
    if (SETUPS[s].ref) { out.push({ s, ko: SETUPS[s].ko, t: SETUPS[s].t, n: g?.n || 0, ref: 1, grid: g ? Object.fromEntries(EX_KEYS.map((k) => [k, cOut(g.G[k])])) : {} }); continue; } // 결과를 알고 고른 줄 — 성적 비교·학습에 안 씀
    if (!g || g.n < 20) { out.push({ s, ko: SETUPS[s].ko, t: SETUPS[s].t, n: g?.n || 0, thin: true }); continue; }
    const grid = Object.fromEntries(EX_KEYS.map((k) => [k, cOut(g.G[k])]));
    let best = null; for (const k of EX_KEYS) { const a = cOut(g.A[k]), b = cOut(B.A[k === 'lv5' ? 'tr15' : k]); if (!a || a.n < 15 || !b) continue; const edge = a.avg - b.avg; if (!best || edge > best.edgeA) best = { k, edgeA: r1(edge), a }; }
    let verify = null;
    if (best) { const bk = best.k === 'lv5' ? 'tr15' : best.k, z = cOut(g.Z[best.k]), zb = cOut(B.Z[bk]); if (z && zb) { const se1 = cSE(g.Z[best.k]), se2 = cSE(B.Z[bk]); const tz = se1 != null && se2 != null && (se1 || se2) ? r1((z.avg - zb.avg) / Math.sqrt(se1 * se1 + se2 * se2)) : null;
      const ok = z.n >= 15 && best.a.n >= 15 && z.avg > 0 && z.avg > zb.avg + (SETUPS[s].lim ? 1 : 0) && best.edgeA > (SETUPS[s].lim ? 1 : 0); /* 지정가 자리는 체결을 좋게 가정할 수 있어 1%p 더 이겨야 ✅ */
      verify = { k: best.k, ko: EXITS[best.k].ko, a: best.a, z, zb: zb.avg, edgeZ: r1(z.avg - zb.avg), tz, ok, sure: ok && tz != null && tz >= 2 }; } }
    const ex = verify?.k || 'tr15';
    const by = Object.fromEntries(CTX_K.map((cn) => { const z = g.ctx[cn]; const c = z ? cOut(z.c[ex]) : null; return [cn, c && c.n >= 10 ? { ...c, fail: fOf(z.f1, z.fN) } : null]; }));
    // 🔧 더 좋게: 조건을 붙이면 앞 기간·안 본 뒤 기간 둘 다 평균 +1%p↑ (승률도 안 떨어짐) — 여러 조건을 동시에 보므로 '참고'
    const A0 = cOut(g.A[ex]), Z0 = cOut(g.Z[ex]); const better = [];
    if (A0 && Z0) for (const cn of CTX_K) { const z = g.ctx[cn]; if (!z) continue; const a = cOut(z.A[ex]), b = cOut(z.Z[ex]); if (!a || !b || a.n < 30 || b.n < 30) continue; if (a.avg >= A0.avg + 1 && b.avg >= Z0.avg + 1 && b.win >= Z0.win) better.push({ k: cn, ko: CTX_KO[cn] || cn, a, z: b, keep: Math.round((b.n / Z0.n) * 100), up: r1(b.avg - Z0.avg) }); }
    better.sort((x, y) => y.up - x.up);
    out.push({ s, ko: SETUPS[s].ko, t: SETUPS[s].t, n: g.n, fail: fOf(g.f1, g.fN), mf: hMed(g.mf, g.n), mn: hMed(g.mn, g.n), x: g.xn ? r1(g.xs / g.xn) : null, grid, best: verify, by, better: better.slice(0, 3) });
  }
  const rk = out.filter((x) => x.best).sort((a, b) => (b.best.ok - a.best.ok) || ((b.best.sure ? 1 : 0) - (a.best.sure ? 1 : 0)) || (b.best.edgeZ - a.best.edgeZ));
  return { n: N, cut, from: ds[0], to: ds[ds.length - 1], base: { n: B.n, fail: fOf(B.f1, B.fN), grid: Object.fromEntries(EX_KEYS.map((k) => [k, cOut(B.G[k])])) }, list: [...rk, ...out.filter((x) => !x.best)], exits: EXITS, ctxKo: CTX_KO };
}
/** 예전 방식(줄 배열 하나) — 테스트용 */
export function entryStudy(rows) { return entryStudyFeed(async (cb) => cb(rows)); }

/** 지금(마지막 3거래일) 뜬 자리 — 실시간 분석용 */
export function entryNow(B, days = 3) {
  if (!B || B.length < 130) return [];
  const P = prep(B), out = [];
  for (let i = B.length - 1; i >= Math.max(120, B.length - days); i--) for (const s of setupsAt(B, i, P)) if (!out.some((o) => o.s === s)) out.push({ s, d: B[i].d, ago: B.length - 1 - i });
  // v243 신고가 뒤 눌림: 닿은 날(nhpl)·확인 양봉(nhpc)이 최근 3거래일 안이면, 아직 안 닿고 기다리는 중(nhpw)이면 지정가 안내
  const n = B.length;
  for (const w of nhWin(B, n - 40)) {
    const at = w.s === 'nhpl' ? w.k0 : w.i, ago = n - 1 - at;
    if (w.s === 'nhpl' && ago < days) out.push({ s: 'nhpl', d: B[at].d, ago, lv: Math.round(w.L), px: Math.round(w.e) });
    else if (w.s === 'nhpc' && ago < days) out.push({ s: 'nhpc', d: B[at].d, ago, lv: Math.round(w.L) });
    else if (w.s === 'nhpw') out.push({ s: 'nhpw', d: B[w.i].d, ago: n - 1 - w.i, lv: Math.round(w.L), px: Math.round(w.L * 1.03), left: 10 - (n - 1 - w.i) });
  }
  return out;
}
/** 학습 결과(검증된 자리) 저장·읽기 */
export async function saveEntLearn(st, src = 'bt') {
  if (!st?.list) return;
  const m = {}; for (const x of st.list) if (x.best && !SETUPS[x.s]?.ref) m[x.s] = { ok: x.best.ok, sure: !!x.best.sure, tz: x.best.tz ?? null, aw: x.best.z.aw, al: x.best.z.al, ex: x.best.k, exKo: x.best.ko, avg: x.best.z.avg, win: x.best.z.win, n: x.best.z.n, base: x.best.zb, fail: x.fail, mk: { 상승: x.by?.mk상승?.avg ?? null, 보합: x.by?.mk보합?.avg ?? null, 하락: x.by?.mk하락?.avg ?? null } };
  await setJSON('mp/entlearn', { at: Date.now(), n: st.n, m, src }).catch(() => {});
}
export async function loadEntLearn() { return (await getJSON('mp/entlearn').catch(() => null)) || null; }
/** 종목에 붙일 설명: 지금 뜬 자리 + 과거 성적 */
export function entryView(ent, EL) {
  return (ent || []).filter((e) => e.s !== 'rnd').map((e) => { const m = EL?.m?.[e.s === 'nhpw' ? 'nhpl' : e.s]; return { ...e, ko: SETUPS[e.s]?.ko || e.s, t: SETUPS[e.s]?.t || '', st: m ? { ok: m.ok, sure: !!m.sure, aw: m.aw ?? null, al: m.al ?? null, ex: m.exKo, avg: m.avg, win: m.win, n: m.n, base: m.base, fail: m.fail, mk: m.mk } : null }; });
}

/** 자리 사건 통계 (6시간 캐시 · 사건 수가 같으면 그대로)
 *  v242: 4년치 공시 과거 재현(mp/bt/ent)이 끝나기 전엔 '차트만 먼저'(mp/bt/entp, entPreStep) 결과를 씀 — 자리는 일봉만으로 정해지니 공시를 기다릴 필요 없음 */
export async function entSummary({ force = false } = {}) {
    const [metaB, metaP, bt, pre, cache] = await Promise.all(['mp/bt/ent', 'mp/bt/entp', 'mp/bt/state', 'mp/entpre', 'mp/entsum'].map((k) => getJSON(k).catch(() => null)));
  const useB = !!(bt?.done && !bt.wait && !bt.prep && metaB?.v === bt.v && (metaB?.n || 0) >= 200);
  const src = useB ? 'bt' : 'pre', base = useB ? 'mp/bt/ent' : 'mp/bt/entp', meta = useB ? metaB : metaP;
  const prog = pre ? { pos: pre.pos || 0, of: pre.queue?.length || 0, done: !!pre.done, n: metaP?.n || 0 } : null;
  if (!force && cache && cache.src === src && cache.n === (meta?.n || 0) && Date.now() - cache.at < 6 * 3600e3) return { ...cache.data, pre: prog };
  // v249: 차트만 먼저가 도는 중엔 사건 수가 3분마다 바뀌어 화면을 열 때마다 전체(수십 조각)를 다시 읽어 DB가 멈춤 → 계산 중엔 30분에 1번만 다시 계산
  if (!force && cache && cache.data?.list && src === 'pre' && prog && !prog.done && Date.now() - cache.at < 30 * 60e3) return { ...cache.data, pre: prog, stale: 1 };
  { const lk = await getJSON('mp/entsumlock').catch(() => null); if (!force && lk && Date.now() - lk.at < 120e3 && cache?.data) return { ...cache.data, pre: prog, stale: 1 }; await setJSON('mp/entsumlock', { at: Date.now() }).catch(() => {}); } // 동시에 여러 번 계산 금지
  const parts = meta?.parts ?? 0;
  const data = await entryStudyFeed(async (cb) => { if (meta && meta.parts == null) { cb(meta.t || meta.rows || meta.r || []); return; } for (let i = 0; i < parts; i++) cb((await getJSON(`${base}/p${i}`).catch(() => null)) || []); });
  data.v = meta?.v || null; data.src = src;
  await setJSON('mp/entsum', { at: Date.now(), n: meta?.n || 0, src, data }).catch(() => {});
  if (data.list) await saveEntLearn(data, src);
  return { ...data, pre: prog };
}

/** v242 🎯 차트만 먼저 — 시총 2조 미만 국장 종목 일봉 4년치로 자리 사건만 계산 (공시 조건 없음)
 *  3분 크론, 한 번에 16종목(4개씩 동시) · DB 느리면 쉼 · 레이더 정기 분석 중엔 쉼 */
export const PRE_V = 4; // v243 신고가 뒤 눌림 3가지 + 파는 법 lv5 → 처음부터 다시
export async function entPreStep({ per = 10 } = {}) {
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 500) return { skip: 'db slow' };
  const ms = await getJSON('mp/state').catch(() => null); if ((ms?.busyUntil || 0) > Date.now()) return { skip: 'radar busy' };
  let st = await getJSON('mp/entpre').catch(() => null);
  if (st && !st.done && Math.floor(Date.now() / 180e3) % 2 === 1) { const cf = await getJSON('mp/costfill').catch(() => null); if (cf && !cf.done) return { skip: 'costfill turn' }; } // v250 세력 원가 받기와 3분씩 번갈아
  const { partsReset, partsAppend } = await import('./btstore.mjs');
  if (!st || st.v !== PRE_V) {
    const idx = (await getJSON('mp/idx').catch(() => null)) || [];
    let snap = null; for (const d of idx.slice(0, 5)) { snap = (await getJSON(`mp/snap/${d}`).catch(() => null))?.rows; if (snap) break; }
    if (!snap) return { skip: 'no snap' };
    const rank = (await getJSON('mp/rank').catch(() => null)) || {};
    const h = (c) => { let x = 7; for (const ch of c) x = (x * 31 + ch.charCodeAt(0)) % 1000003; return x; };
    const q = Object.entries(snap).filter(([c, r]) => { const v = r?.[6]; const eok = v > 1e7 ? v / 1e8 : v; return /^\d{6}$/.test(c) && !/스팩|SPAC/i.test(r?.[0] || '') && eok > 0 && eok < 20000; })
      .map(([c, r]) => [c, r[1] === 'P' ? 'P' : 'Q']).sort((a, b) => (rank[a[0]] ? 0 : 1) - (rank[b[0]] ? 0 : 1) || h(a[0]) - h(b[0])).slice(0, 1500);
    st = { v: PRE_V, queue: q, pos: 0, done: false, started: Date.now(), n: 0 };
    await partsReset('mp/bt/entp', PRE_V); await setJSON('mp/entpre', st);
    return { started: q.length };
  }
  if (st.done) return null;
  const { _bars, indexDaily } = await import('./manip.mjs');
  const ix = await indexDaily().catch(() => ({}));
  const part = st.queue.slice(st.pos, st.pos + per), rows = [];
  for (let i = 0; i < part.length; i += 4) {
    const res = await Promise.all(part.slice(i, i + 4).map(([c, mkt]) => _bars(c, 1000).then((B) => entryEvents(B, { code: c, ix, mkt })).catch(() => [])));
    for (const L of res) for (const r of L) { r[5] = null; r[6] = null; rows.push(r); } // 공시 조건은 모름 (판 깔기·무자본 M&A 칸 비움)
  }
  if (rows.length) await partsAppend('mp/bt/entp', rows, { per: 2000, maxParts: 160, v: PRE_V }).catch((e) => console.warn('entp', e.message));
  st.pos += part.length; st.n = (st.n || 0) + rows.length; st.at = Date.now();
  if (st.pos >= st.queue.length) { st.done = true; st.doneAt = Date.now(); }
  await setJSON('mp/entpre', st);
  if (st.done) { try { await entSummary({ force: true }); } catch (e) { console.warn('entp sum', e.message); } }
  return { pos: st.pos, of: st.queue.length, rows: rows.length };
}

/** v239 지금 들어가는 자리 훑기 — 랭킹 종목 일봉을 3분에 10개씩 받아 최근 3거래일 자리를 `mp/entnow`에 (DB 쓰기는 한 번에 1건)
 *  장 마감(15:40 KST) 뒤 새로 한 바퀴 · DB가 느리면 쉼 */
export async function entScanStep({ per = 10 } = {}) {
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 1500) return { skip: 'db slow' };
  const k = new Date(Date.now() + 9 * 3600e3), today = k.toISOString().slice(0, 10), after = k.getUTCHours() * 60 + k.getUTCMinutes() >= 15 * 60 + 40;
  const runDay = after ? today : new Date(Date.now() + 9 * 3600e3 - 864e5).toISOString().slice(0, 10); // 이 날짜 장 마감 기준 한 바퀴
  let st = (await getJSON('mp/entnow').catch(() => null)) || { m: {} };
  if (st.day !== runDay) st = { day: runDay, pos: 0, m: st.m || {}, start: Date.now() };
  const rank = (await getJSON('mp/rank').catch(() => null)) || {};
  const my = (await getJSON('mp/my').catch(() => null)) || {};
  const codes = [...new Set([...Object.keys(rank), ...(Array.isArray(my.items) ? my.items.map((i) => i.code) : [])])].sort();
  if (st.pos >= codes.length) return null; // 오늘 한 바퀴 끝
  const { _bars } = await import('./manip.mjs');
  const part = codes.slice(st.pos, st.pos + per);
  const res = await Promise.all(part.map((c) => _bars(c).then((B) => [c, entryNow(B), B[B.length - 1]?.d]).catch(() => [c, null, null])));
  for (const [c, en, d] of res) { if (!en) continue; if (en.length) st.m[c] = { s: en.map((e) => e.s), ent: en, d, at: Date.now() }; else delete st.m[c]; }
  for (const c of Object.keys(st.m)) if (!rank[c] && Date.now() - (st.m[c].at || 0) > 7 * 864e5) delete st.m[c];
  st.pos += part.length; st.at = Date.now(); st.of = codes.length;
  await setJSON('mp/entnow', st).catch(() => {});
  return { pos: st.pos, of: codes.length, hits: Object.keys(st.m).length };
}

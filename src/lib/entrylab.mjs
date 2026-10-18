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
export function exitsFrom(B, i, P = prep(B)) {
  const k0 = i + 1; if (!B[k0 + NEED - 1]) return null;
  const e = B[k0].o || B[k0].c; if (!e) return null;
  const ret = (px) => r1((px / e - 1) * 100 - COST);
  const R = {};
  const sl = (s, t, maxD) => { for (let k = k0; k < k0 + maxD; k++) { const x = B[k], o = x.o || x.c; if (x.l <= e * (1 - s)) return ret(Math.min(o, e * (1 - s))); if (x.h >= e * (1 + t)) return ret(Math.max(o, e * (1 + t))); } return ret(B[k0 + maxD - 1].c); };
  R.s7t15 = sl(0.07, 0.15, 20); R.s10t30 = sl(0.10, 0.30, 40);
  const trail = (dd, maxD) => { let hi = e; for (let k = k0; k < k0 + maxD; k++) { hi = Math.max(hi, B[k].h); if (B[k].c <= hi * (1 - dd) && B[k + 1]) return [ret(B[k + 1].o || B[k + 1].c), k + 1]; } return [ret(B[k0 + maxD - 1].c), k0 + maxD - 1]; };
  const t15 = trail(0.15, 20); R.tr15 = t15[0]; R.tr10 = trail(0.10, 20)[0];
  { let out = null; for (let k = k0 + 1; k < k0 + 20; k++) if (P.ma5[k] && B[k].c < P.ma5[k] && B[k + 1]) { out = ret(B[k + 1].o || B[k + 1].c); break; } R.ma5 = out ?? ret(B[k0 + 19].c); }
  { let hi = e, half = false, got = 0, res = null; for (let k = k0; k < k0 + 30; k++) { const x = B[k], o = x.o || x.c; if (!half && x.h >= e * 1.2) { half = true; got = 0.5 * Math.max(o, e * 1.2) / e; } hi = Math.max(hi, x.h); if (x.c <= hi * 0.9 && B[k + 1]) { const px = (B[k + 1].o || B[k + 1].c) / e; res = r1(((half ? got + 0.5 * px : px) - 1) * 100 - COST); break; } } if (res == null) { const px = B[k0 + 29].c / e; res = r1(((half ? got + 0.5 * px : px) - 1) * 100 - COST); } R.half = res; }
  R.h5 = ret(B[k0 + 4].c); R.h10 = ret(B[k0 + 9].c); R.h20 = ret(B[k0 + 19].c);
  let fail = 0; for (let k = k0; k < k0 + 20; k++) { const dn = B[k].l <= e * 0.9, upp = B[k].h >= e * 1.1; if (dn) { fail = 1; break; } if (upp) { fail = -1; break; } } // 같은 날이면 손절 먼저
  const mf = r1((maxH(B, k0, k0 + 19) / e - 1) * 100), mn = r1((minL(B, k0, k0 + 19) / e - 1) * 100);
  return { e, R, fail, mf, mn, xk: t15[1], gap: r1((e / B[i].c - 1) * 100) };
}

/** 한 종목의 자리 사건 전부 (과거 재현용) — 같은 자리는 5거래일 안 한 번만 · rnd는 10거래일마다 */
export function entryEvents(B, { code, evs = [], ix = null, mkt = 'Q', motiveOf = null } = {}) {
  if (!B || B.length < 180) return [];
  const P = prep(B), out = [], last = {};
  const mk = mkt === 'P' ? 'P' : 'Q';
  const mret = (a, b) => { if (!ix) return null; let m = 1, n = 0; for (let k = a; k <= b; k++) { const p = ix[B[k]?.d]?.[mk]; if (p != null) { m *= 1 + p / 100; n++; } } return n ? (m - 1) * 100 : null; };
  for (let i = 120; i < P.n - NEED - 1; i++) {
    const S = setupsAt(B, i, P); if (i % 20 === 0) S.push('rnd');
    const fresh = S.filter((s) => !(last[s] != null && i - last[s] <= 5)); for (const s of S) last[s] = i;
    if (!fresh.length) continue;
    const X = exitsFrom(B, i, P); if (!X) continue;
    const Tms = Date.parse(B[i].d + 'T15:40:00+09:00');
    const m20 = mret(i - 19, i), mreg = m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합';
    const pk = evs.some((e) => e.ms <= Tms && e.ms > Tms - 180 * 864e5 && ['cb', 'rights3', 'mna', 'fund5'].includes(e.kind)) ? 1 : 0;
    let mna = 0; if (motiveOf && pk) { try { mna = motiveOf(evs, { B, Tms }).includes('mnaFund') ? 1 : 0; } catch {} }
    const xm = mret(i + 1, X.xk); const xr = xm == null ? null : r1(X.R.tr15 - xm);
    for (const s of fresh) out.push([code, B[i].d, s, X.gap, mreg, pk, mna, X.fail, X.mf, X.mn, ...EX_KEYS.map((k) => X.R[k]), xr]);
  }
  return out;
}
export const ROW = (a) => ({ c: a[0], d: a[1], s: a[2], gap: a[3], mk: a[4], pk: a[5], mna: a[6], fail: a[7], mf: a[8], mn: a[9], R: Object.fromEntries(EX_KEYS.map((k, j) => [k, a[10 + j]])), x: a[10 + EX_KEYS.length] });

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
function cell(L, ex) { const v = L.map((t) => t.R[ex]).filter((x) => x != null); if (!v.length) return null; return { n: v.length, avg: r1(mean(v)), med: r1(med(v)), win: Math.round((v.filter((x) => x > 0).length / v.length) * 100), big: Math.round((v.filter((x) => x <= -15).length / v.length) * 100) }; }
const failOf = (L) => { const a = L.filter((t) => t.fail !== 0); return a.length ? Math.round((a.filter((t) => t.fail === 1).length / a.length) * 100) : null; };

/** 자리 × 파는 법 표 + 앞 기간에서 고른 최선의 파는 법을 뒤 기간에서 확인 */
export function entryStudy(rows) {
  const L = rows.map(ROW);
  const N = L.length; if (N < 200) return { n: N, need: 200 };
  const ds = [...new Set(L.map((t) => t.d))].sort(), cut = ds[Math.floor(ds.length / 2)];
  const A = L.filter((t) => t.d < cut), Z = L.filter((t) => t.d >= cut);
  const base = L.filter((t) => t.s === 'rnd'), baseA = A.filter((t) => t.s === 'rnd'), baseZ = Z.filter((t) => t.s === 'rnd');
  const out = [];
  for (const s of Object.keys(SETUPS)) {
    const G = L.filter((t) => t.s === s); if (G.length < 20) { out.push({ s, ko: SETUPS[s].ko, t: SETUPS[s].t, n: G.length, thin: true }); continue; }
    const GA = A.filter((t) => t.s === s), GZ = Z.filter((t) => t.s === s);
    const grid = Object.fromEntries(EX_KEYS.map((k) => [k, cell(G, k)]));
    // 앞 기간에서 고른 파는 법 (기준선 대비 평균이 가장 좋은 것) → 뒤 기간에서 확인
    let best = null; for (const k of EX_KEYS) { const a = cell(GA, k), b = cell(baseA, k); if (!a || a.n < 15 || !b) continue; const edge = a.avg - b.avg; if (!best || edge > best.edgeA) best = { k, edgeA: r1(edge), a }; }
    let verify = null;
    if (best) { const z = cell(GZ, best.k), zb = cell(baseZ, best.k); if (z && zb) verify = { k: best.k, ko: EXITS[best.k].ko, a: best.a, z, zb: zb.avg, edgeZ: r1(z.avg - zb.avg), ok: z.n >= 15 && best.a.n >= 15 && z.avg > 0 && z.avg > zb.avg && best.edgeA > 0 }; }
    const ctx = (f) => { const g = G.filter(f); const ex = verify?.k || 'tr15'; const c = cell(g, ex); return c && c.n >= 10 ? { ...c, fail: failOf(g) } : null; };
    out.push({ s, ko: SETUPS[s].ko, t: SETUPS[s].t, n: G.length, fail: failOf(G), mf: r1(med(G.map((t) => t.mf))), mn: r1(med(G.map((t) => t.mn))), x: (() => { const v = G.map((t) => t.x).filter((x) => x != null); return v.length ? r1(mean(v)) : null; })(), grid, best: verify,
      by: { mk상승: ctx((t) => t.mk === '상승'), mk보합: ctx((t) => t.mk === '보합'), mk하락: ctx((t) => t.mk === '하락'), pk있음: ctx((t) => t.pk === 1), pk없음: ctx((t) => t.pk === 0), mna: ctx((t) => t.mna === 1), gap하락: ctx((t) => t.gap <= -3), gap보합: ctx((t) => t.gap > -3 && t.gap < 3), gap상승: ctx((t) => t.gap >= 3) } });
  }
  const rk = out.filter((x) => x.best).sort((a, b) => (b.best.ok - a.best.ok) || (b.best.edgeZ - a.best.edgeZ));
  return { n: N, cut, from: ds[0], to: ds[ds.length - 1], base: { n: base.length, fail: failOf(base), grid: Object.fromEntries(EX_KEYS.map((k) => [k, cell(base, k)])) }, list: [...rk, ...out.filter((x) => !x.best)], exits: EXITS };
}

/** 지금(마지막 3거래일) 뜬 자리 — 실시간 분석용 */
export function entryNow(B, days = 3) {
  if (!B || B.length < 130) return [];
  const P = prep(B), out = [];
  for (let i = B.length - 1; i >= Math.max(120, B.length - days); i--) for (const s of setupsAt(B, i, P)) if (!out.some((o) => o.s === s)) out.push({ s, d: B[i].d, ago: B.length - 1 - i });
  return out;
}
/** 학습 결과(검증된 자리) 저장·읽기 */
export async function saveEntLearn(st) {
  if (!st?.list) return;
  const m = {}; for (const x of st.list) if (x.best) m[x.s] = { ok: x.best.ok, ex: x.best.k, exKo: x.best.ko, avg: x.best.z.avg, win: x.best.z.win, n: x.best.z.n, base: x.best.zb, fail: x.fail, mk: { 상승: x.by?.mk상승?.avg ?? null, 보합: x.by?.mk보합?.avg ?? null, 하락: x.by?.mk하락?.avg ?? null } };
  await setJSON('mp/entlearn', { at: Date.now(), n: st.n, m }).catch(() => {});
}
export async function loadEntLearn() { return (await getJSON('mp/entlearn').catch(() => null)) || null; }
/** 종목에 붙일 설명: 지금 뜬 자리 + 과거 성적 */
export function entryView(ent, EL) {
  return (ent || []).filter((e) => e.s !== 'rnd').map((e) => { const m = EL?.m?.[e.s]; return { ...e, ko: SETUPS[e.s]?.ko || e.s, t: SETUPS[e.s]?.t || '', st: m ? { ok: m.ok, ex: m.exKo, avg: m.avg, win: m.win, n: m.n, base: m.base, fail: m.fail, mk: m.mk } : null }; });
}

/** 과거 재현의 자리 사건 전부로 통계 (6시간 캐시 · 사건 수가 같으면 그대로) */
export async function entSummary({ force = false } = {}) {
  const { partsLoad } = await import('./btstore.mjs');
  const meta = await getJSON('mp/bt/ent').catch(() => null);
  const cache = await getJSON('mp/entsum').catch(() => null);
  if (!force && cache && cache.n === (meta?.n || 0) && Date.now() - cache.at < 6 * 3600e3) return cache.data;
  const R = await partsLoad('mp/bt/ent');
  const data = entryStudy(R?.list || []);
  data.v = R?.v || null;
  await setJSON('mp/entsum', { at: Date.now(), n: meta?.n || 0, data }).catch(() => {});
  if (data.list) await saveEntLearn(data);
  return data;
}

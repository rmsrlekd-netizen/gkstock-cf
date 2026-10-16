// 📈 매매 따라하기 성적 (v222) — "신호가 새로 뜬 날 사서 규칙대로 팔았다면"
//  ① 거래 만들기 (simTrades)
//    · 진입: 신호가 '새로' 뜬 날(최근 10거래일 안 같은 신호 없음 + 같은 신호로 산 게 끝난 뒤) 다음 날 시가
//      다음 날 시가가 판정일 종가보다 +25%↑(상한가 근처)면 실제로 못 삼 → 거래 안 셈(nf 개수만)
//    · 비용 0.5% (수수료·세금 약 0.2% + 소형주 체결 미끄러짐 0.3%)
//    · 매도 T(1차 목표 팔기): 손절선 → 1차 목표 → 판정 🔴 전환(다음 날 시가) → 60거래일 / U(끝까지): 목표만 뺌
//      같은 날 둘 다 닿으면 손절(보수적) · 시가가 넘어 열리면 시가 체결 · 10일↑ 거래 끊긴 채 끝나면 마지막 종가('거래정지')
//    · 손절·목표 조합 16개(손절 −7/−10/−15%/세력 원가 × 목표 +15/+30%/1차 목표/없음)를 같이 계산 → 가장 좋은 규칙 찾기
//    · 기간 안 최고(mfe)·최저(mae), 같은 기간 시장(코스피/코스닥) 대비 수익률, 진입 당시 조건(단계·등급·손익비·평단 거리·시장 흐름 등)
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
  ['g', '🟢 매수 검토'],
  ['pk', '🎯 매매 후보 조건 충족'],
  ['A', '체크리스트 A등급'],
  ['AB', '체크리스트 A·B등급'],
  ['acc', '매집·판 깔기 단계'],
  ['up', '상승 가능성 분류'],
  ['all', '레이더에 처음 오른 종목 전체'],
];
const BIT = { g: 1, pk: 2, A: 4, AB: 8, acc: 16, up: 32, all: 128 };
const BAD = 64;
export const WHY_X = { stop: '손절선', tgt: '목표가', view: '판정 🔴 전환', time: '60일 정리', halt: '거래정지' };
const COST = 0.5, HOLD = 60, COOL = 10, NOFILL = 1.25;
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
  if (r.vd === 'r' || (!r.vd && (r.ck === 'D' || ['털기', '엑시트 후', '거래정지'].includes(r.st)))) f |= BAD;
  return f;
}
/** 진입 당시 조건 (조건별 효과 분석용, 짧게) */
export function attrsOf(r) {
  const b = (v, cuts, names) => { if (v == null || Number.isNaN(v)) return null; for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return names[i]; return names[cuts.length]; };
  return { st: r.st || null, ck: r.ck || null, rr: b(r.rr, [2, 3], ['2 미만', '2~3', '3 이상']), gp: b(r.gp, [0, 15, 50], ['평단 아래', '평단 +0~15%', '평단 +15~50%', '평단 +50%↑']), dir: r.dir === 'up' ? '상승' : r.dir === 'down' ? '하락 위험' : '없음', cm: r.cm > 0 ? '있음' : '없음', px: r.pexl || null, vd: r.vd || null };
}
export const ATTR_KO = { st: '단계', ck: '체크리스트 등급', rr: '손익비', gp: '평단 대비 위치', dir: '분류', cm: '매집봉 흔적', px: '털기 후 상승', vd: '한 줄 결론', mk: '진입 때 시장 흐름(20일)', eg: '진입 갭(다음 날 시가)' };
const r1 = (x) => Math.round(x * 10) / 10;

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
      if (!fresh || p.i <= busyTo || p.f & BAD) continue;
      const ei = p.i + 1; if (!B[ei]) continue;
      const e = B[ei].o || B[ei].c;
      if (e >= B[p.i].c * NOFILL) { nf[s] = (nf[s] || 0) + 1; continue; } // 상한가 근처로 열려 실제로 못 삼
      const spc = p.sp > 0 && p.sp < e ? p.sp : e * 0.9, tpt = p.tp > e ? p.tp : e * 1.2;
      const vb = badI.find((b) => b >= ei);
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
      // 손절·목표 16개 조합 (진행 중이면 null)
      const g = [];
      for (const sv of GRID_S) for (const tv of GRID_T) {
        const spx = sv === 'c' ? spc : e * (1 - sv / 100), tpx = tv === 't' ? tpt : tv ? e * (1 + tv / 100) : 0;
        const z = run(spx, tpx); g.push(settled(z) ? r1((z.px / e - 1) * 100 - COST) : null);
      }
      let mf = -1e9, ma = 1e9;
      for (let k = ei; k < Math.min(B.length, ei + HOLD); k++) { mf = Math.max(mf, B[k].h); ma = Math.min(ma, B[k].l); }
      const m20 = p.i >= 20 ? mret(p.i - 19, p.i) : null;
      const a = { ...(p.a || {}), mk: m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합', eg: (() => { const v = (e / B[p.i].c - 1) * 100; return v < -3 ? '−3% 아래' : v < 3 ? '±3%' : v < 10 ? '+3~10%' : '+10%↑'; })() };
      out.push({ s, d: p.d, e: Math.round(e * 100) / 100, sp: Math.round(spc), tp: Math.round(tpt), T, U, g, mf: r1((mf / e - 1) * 100), ma: r1((ma / e - 1) * 100), a });
      const ends = [T, U].map((z) => (z ? ix(z.xd) : B.length + 999));
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
  return { n: L.length, win: Math.round((W.length / L.length) * 100), avg: r1(mean(rs)), med: r1(pct(rs, 0.5)), aw: W.length ? r1(mean(W)) : null, al: Lo.length ? r1(mean(Lo)) : null, R: Math.round(mean(L.map((x) => x.R)) * 100) / 100, pf: Lo.length && sum(Lo) < 0 ? Math.round((sum(W) / -sum(Lo)) * 100) / 100 : null, h: Math.round(mean(L.map((x) => x.h))), ex: xs.length ? r1(mean(xs)) : null, why: Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, c]) => [k, Math.round((c / L.length) * 100)]) };
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
export function simStats(trades, nf = {}, seed = 7) {
  const rnd = rng(seed);
  const dates = [...new Set(trades.map((t) => t.d))].sort();
  const cut = dates[Math.floor(dates.length * 2 / 3)] || '9999';
  const base = { T: trades.filter((t) => t.s === 'all' && t.T).map((t) => ({ d: t.d, v: t.T.r })), U: trades.filter((t) => t.s === 'all' && t.U).map((t) => ({ d: t.d, v: t.U.r })) };
  const baseBoot = { T: bootMeans(base.T, rnd), U: bootMeans(base.U, rnd) };
  const groups = SIGS.map(([s, ko]) => {
    const tr = trades.filter((t) => t.s === s);
    const one = (m) => {
      const L = tr.filter((t) => t[m]).map((t) => ({ ...t[m], d: t.d }));
      const b = basic(L); if (!b) return null;
      const bm = bootMeans(L.map((x) => ({ d: x.d, v: x.r })), rnd);
      if (bm) { b.lo = r1(pct(bm, 0.05)); b.hi = r1(pct(bm, 0.95)); }
      const A = L.filter((x) => x.d < cut), Z = L.filter((x) => x.d >= cut);
      b.half = { a: A.length ? r1(mean(A.map((x) => x.r))) : null, an: A.length, z: Z.length ? r1(mean(Z.map((x) => x.r))) : null, zn: Z.length };
      const bh = (lo) => { const v = base[m].filter((x) => (lo ? x.d < cut : x.d >= cut)).map((x) => x.v); return v.length ? mean(v) : null; };
      const hv = [A.length >= 10 && bh(true) != null ? b.half.a - bh(true) : null, Z.length >= 10 && bh(false) != null ? b.half.z - bh(false) : null];
      if (s !== 'all' && bm && baseBoot[m]) { const diffs = bm.map((v, i) => v - baseBoot[m][i]); b.vs = r1(b.avg - mean(base[m].map((x) => x.v))); b.vd = verdictOfDiff(diffs, b.n, hv); }
      else if (s === 'all') b.vd = bm ? { k: 'base', t: '기준선', lo: b.lo, hi: b.hi } : { k: 'n', t: '기준선' };
      b.eq = equity(tr, m);
      const st = L.filter((x) => x.w === 'stop'); const stT = tr.filter((t) => t[m]?.w === 'stop');
      b.shake = st.length ? Math.round((stT.filter((t) => t.mf >= 20).length / st.length) * 100) : null;
      return b;
    };
    // 최적 손절·목표: 앞 2/3에서 고르고 뒤 1/3로 검증
    const gstat = (sel) => GRID_S.flatMap((_, si) => GRID_T.map((__, ti) => { const gi = si * 4 + ti; const v = tr.filter(sel).map((t) => t.g?.[gi]).filter((x) => x != null); return { gi, n: v.length, avg: v.length ? r1(mean(v)) : null }; }));
    const all = gstat(() => true), train = gstat((t) => t.d < cut), test = gstat((t) => t.d >= cut);
    const cand = train.filter((x) => x.n >= 15 && x.avg != null).sort((a, b) => b.avg - a.avg)[0];
    const best = cand ? { gi: cand.gi, name: gridName(cand.gi), train: cand.avg, trainN: cand.n, test: test[cand.gi].avg, testN: test[cand.gi].n, baseTest: test[GI_T].avg } : null;
    return { s, ko, open: tr.filter((t) => !t.T || !t.U).length, nf: nf[s] || 0, T: one('T'), U: one('U'), grid: all.map((x) => [x.avg, x.n]), best };
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
  return { groups, conds, cut, from: dates[0] || null, to: dates[dates.length - 1] || null, n: trades.length, gridS: GRID_S, gridT: GRID_T };
}

// 저장용 짧은 모양 ↔ 원래 모양
const pz = (z) => (z ? [z.r, z.R, z.h, z.w, z.xd, z.x] : 0);
const uz = (z) => (z ? { r: z[0], R: z[1], h: z[2], w: z[3], xd: z[4], x: z[5] ?? null } : null);
export const pack = (c, n, t) => [c, n || '', t.s, t.d, t.e, t.sp, t.tp, pz(t.T), pz(t.U), t.g || [], t.mf, t.ma, t.a || {}];
export const unpack = (a) => ({ c: a[0], n: a[1], s: a[2], d: a[3], e: a[4], sp: a[5], tp: a[6], T: uz(a[7]), U: uz(a[8]), g: a[9] || [], mf: a[10], ma: a[11], a: a[12] || {} });

// ───── 실제 성적표(매일 판정 기록)로 계산 ─────
//  mp/sim/tl {dates:[], codes:{코드:{n, m(시장), p:[[날짜번호, 신호비트, 목표가, 손절선, 조건]]}}}
//  mp/sim/tr {codes:{코드:{chk, need, open, nf, t:[pack…]}}} · mp/sim/sum 통계 캐시
const SIM_V = 2;
export async function simStep({ maxDates = 2, maxCodes = 8, budgetMs = 30000 } = {}) {
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
    const di = tl.dates.length; tl.dates.push(d); added++;
    for (const [c, r] of Object.entries(perf.rows || {})) {
      const z = (tl.codes[c] = tl.codes[c] || { n: r.n || '', p: [] });
      if (r.n) z.n = r.n; if (r.mk) z.m = r.mk;
      z.p.push([di, flagsOf(r), r.tp ?? 0, r.sp ?? 0, attrsOf(r)]);
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
      const list = z.p.map(([di, f, tp, sp, a]) => ({ d: tl.dates[di], f, tp, sp, a }));
      const R = simTrades(B, list, { last, now: Date.now(), ix: ixd, mkt: z.m });
      tr.codes[c] = { chk: kst, need: 0, open: R.trades.some((t) => !t.T || !t.U) ? 1 : 0, nf: R.nf, t: R.trades.map((t) => pack(c, z.n, t)) };
      done++;
    }));
  }
  if (done || added) { tr.at = Date.now(); await setJSON('mp/sim/tr', tr); }
  return added || done ? { added, done, left: Object.values(tr.codes).filter((z) => z.need).length } : null;
}
const nfSum = (L) => { const o = {}; for (const z of L) for (const [k, v] of Object.entries(z || {})) o[k] = (o[k] || 0) + v; return o; };
export async function simSummary() {
  const { getJSON, setJSON } = await import('./store.mjs');
  const [tl, tr, bt, cache] = await Promise.all([getJSON('mp/sim/tl'), getJSON('mp/sim/tr'), getJSON('mp/bt/trades'), getJSON('mp/sim/sum')]);
  const key = `${tr?.at || 0}|${bt?.at || bt?.t?.length || 0}`;
  if (cache?.key === key) return cache.out;
  const L = Object.values(tr?.codes || {}).flatMap((z) => (z.t || []).map(unpack));
  const BT = (bt?.t || []).map(unpack);
  const out = {
    live: { days: tl?.dates?.length || 0, left: Object.values(tr?.codes || {}).filter((z) => z.need).length, ...simStats(L, nfSum(Object.values(tr?.codes || {}).map((z) => z.nf))) },
    bt: { ...simStats(BT, bt?.nf || {}) },
  };
  await setJSON('mp/sim/sum', { key, out }).catch(() => {});
  return out;
}
/** 신호별 거래 목록 (src: live|bt) */
export async function simRows(src, s, limit = 500) {
  const { getJSON } = await import('./store.mjs');
  const L = src === 'bt' ? ((await getJSON('mp/bt/trades'))?.t || []).map(unpack) : Object.values((await getJSON('mp/sim/tr'))?.codes || {}).flatMap((z) => (z.t || []).map(unpack));
  return L.filter((t) => t.s === s).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, limit).map(({ g, ...t }) => t);
}

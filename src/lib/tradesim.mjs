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
export const PK_H = [5, 20, 60, 120]; // 최고·최저 기록 기간(거래일)
export const MODES = ['T', 'U', 'ST', 'SU']; // 한 번에 사기(목표 팔기·끝까지) · 3번 나눠 사기(목표 팔기·끝까지)
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
export const ATTR_KO = { lq: '하루 거래대금(20일 평균)', st: '단계', ck: '체크리스트 등급', rr: '손익비', gp: '평단 대비 위치', dir: '분류', cm: '매집봉 흔적', px: '털기 후 상승', vd: '한 줄 결론', mk: '진입 때 시장 흐름(20일)', eg: '진입 갭(다음 날 시가)' };
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
      const a = { ...(p.a || {}), lq: lq == null ? null : lq < 5 ? '5억 미만' : lq < 20 ? '5~20억' : lq < 100 ? '20~100억' : '100억↑', mk: m20 == null ? null : m20 >= 3 ? '상승' : m20 <= -3 ? '하락' : '보합', eg: (() => { const v = (e / B[p.i].c - 1) * 100; return v < -3 ? '−3% 아래' : v < 3 ? '±3%' : v < 10 ? '+3~10%' : '+10%↑'; })() };
      out.push({ s, d: p.d, e: Math.round(e * 100) / 100, sp: Math.round(spc), tp: Math.round(tpt), T, U, ST, SU, rv: p.rv ?? null, lq, pk, g, mf: r1((mf / e - 1) * 100), ma: r1((ma / e - 1) * 100), a });
      const ends = [T, U, ST, SU].map((z) => (z ? ix(z.xd) : B.length + 999));
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
export function simStats(trades, nf = {}, seed = 7) {
  const rnd = rng(seed);
  const dates = [...new Set(trades.map((t) => t.d))].sort();
  const cut = dates[Math.floor(dates.length * 2 / 3)] || '9999';
  const base = {}, baseBoot = {};
  for (const m of MODES) { base[m] = trades.filter((t) => t.s === 'all' && t[m]).map((t) => ({ d: t.d, v: t[m].r })); baseBoot[m] = bootMeans(base[m], rnd); }
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
export const pack = (c, n, t) => [c, n || '', t.s, t.d, t.e, t.sp, t.tp, pz(t.T), pz(t.U), t.g || [], t.mf, t.ma, t.a || {}, pz(t.ST), pz(t.SU), t.rv ?? null, t.lq ?? null, t.pk || []];
export const unpack = (a) => ({ c: a[0], n: a[1], s: a[2], d: a[3], e: a[4], sp: a[5], tp: a[6], T: uz(a[7]), U: uz(a[8]), g: a[9] || [], mf: a[10], ma: a[11], a: a[12] || {}, ST: uz(a[13]), SU: uz(a[14]), rv: a[15] ?? null, lq: a[16] ?? null, pk: a[17] || [] });

// ───── 실제 성적표(매일 판정 기록)로 계산 ─────
//  mp/sim/tl {dates:[], codes:{코드:{n, m(시장), p:[[날짜번호, 신호비트, 목표가, 손절선, 조건]]}}}
//  mp/sim/tr {codes:{코드:{chk, need, open, nf, t:[pack…]}}} · mp/sim/sum 통계 캐시
const SIM_V = 4;
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
      tr.codes[c] = { chk: kst, need: 0, open: R.trades.some((t) => MODES.some((m) => !t[m]) || (t.pk || []).some((x) => !x)) || fw.some((x) => x.includes(null)) ? 1 : 0, nf: R.nf, t: R.trades.map((t) => pack(c, z.n, t)), fw };
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
const KIND_KO = { mna: '경영권 변경', rights3: '3자배정 증자', rights: '유상증자', cb: 'CB·BW 발행', conv: '전환청구', refix: '전환가 조정', fund5: '투자조합 지분', sell: '대주주 매도', pledge: '주식 담보', fail: '철회·납입 연기', risk: '위험 공시', paid: '납입 완료', insider: '임원·주요주주 매매', tsell: '자사주 처분', bonus: '무상증자', supply: '공급계약', ceo: '대표 변경', rename: '상호 변경', agm: '주총 안건', halt: '거래정지', lock: '보호예수' };
export async function simAiStep({ max = 4, budgetMs = 30000, dayCap = 150 } = {}) {
  const { getJSON, setJSON } = await import('./store.mjs');
  const { claude, hasAI } = await import('./ai.mjs');
  if (!hasAI()) return null;
  const t0 = Date.now(), kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const cnt = (await getJSON(`mp/sim/aicnt/${kst}`)) || { n: 0 };
  if (cnt.n >= dayCap) return null;
  const [tr, bt] = await Promise.all([getJSON('mp/sim/tr'), getJSON('mp/bt/trades')]);
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
const SIM_WHY_KO = { stop: '손절선', tgt: '1차 목표가', view: '판정 🔴 전환', time: '60일 정리', halt: '거래정지' };
const nfSum = (L) => { const o = {}; for (const z of L) for (const [k, v] of Object.entries(z || {})) o[k] = (o[k] || 0) + v; return o; };
export async function simSummary() {
  const { getJSON, setJSON } = await import('./store.mjs');
  const [tl, tr, bt, bfw, cache] = await Promise.all([getJSON('mp/sim/tl'), getJSON('mp/sim/tr'), getJSON('mp/bt/trades'), getJSON('mp/bt/fw'), getJSON('mp/sim/sum')]);
  const { RULE_V } = await import('./manip.mjs');
  const key = `${SIM_V}|${RULE_V}|${tr?.at || 0}|${bt?.at || 0}|${bfw?.at || 0}`;
  if (cache?.key === key) return cache.out;
  const L = Object.values(tr?.codes || {}).flatMap((z) => (z.t || []).map(unpack));
  const BT = (bt?.t || []).map(unpack);
  const nfL = nfSum(Object.values(tr?.codes || {}).map((z) => z.nf));
  // 점수 검증용 점: 실제 기록(판정 기록의 숫자 + 그 뒤 수익률) · 과거 재현
  const ptsL = [];
  for (const [c, z] of Object.entries(tl?.codes || {})) { const fw = new Map((tr?.codes?.[c]?.fw || []).map((r) => [r[0], r.slice(1)])); for (const p of z.p) { const x = fw.get(p[0]); if (x) ptsL.push({ di: p[0], v: p[6] || {}, x }); } }
  const ptsB = (bfw?.r || []).map((r) => ({ di: r[0], v: { s: r[1], ws: r[2], rr: r[3], gp: r[4] }, x: [r[5], r[6], r[7]] }));
  const now = L.filter((t) => t.rv === RULE_V);
  const out = {
    rv: RULE_V,
    live: { days: tl?.dates?.length || 0, left: Object.values(tr?.codes || {}).filter((z) => z.need).length, ...simStats(L, nfL), ic: icStats(ptsL) },
    now: { ...simStats(now, {}), ic: null },
    bt: { ...simStats(BT, bt?.nf || {}), ic: icStats(ptsB) },
  };
  // 지금 규칙만 보기의 점수 검증: 그 규칙으로 판정한 날만
  { const okD = new Set(); for (const z of Object.values(tl?.codes || {})) for (const p of z.p) if (p[5] === RULE_V) okD.add(p[0]); out.now.ic = icStats(ptsL.filter((p) => okD.has(p.di))); out.now.days = okD.size; }
  // 실제 vs 과거 재현 차이 (실제가 훨씬 나쁘면 '과거에만 맞춘 규칙' 신호)
  out.gap = out.live.groups.map((g) => { const a = g.T, b2 = out.bt.groups.find((x) => x.s === g.s)?.T; return a && b2 && a.n >= 20 && b2.n >= 20 ? { s: g.s, ko: g.ko, live: a.avg, bt: b2.avg, d: r1(a.avg - b2.avg) } : null; }).filter(Boolean);
  await setJSON('mp/sim/sum', { key, out }).catch(() => {});
  return out;
}
/** 신호별 거래 목록 (src: live|now|bt) + 거래별 AI 해설 + 신호 AI 정리 */
export async function simRows(src, s, limit = 500) {
  const { getJSON } = await import('./store.mjs');
  let L = src === 'bt' ? ((await getJSON('mp/bt/trades'))?.t || []).map(unpack) : Object.values((await getJSON('mp/sim/tr'))?.codes || {}).flatMap((z) => (z.t || []).map(unpack));
  if (src === 'now') { const { RULE_V } = await import('./manip.mjs'); L = L.filter((t) => t.rv === RULE_V); }
  const [ai, gai] = await Promise.all([getJSON('mp/sim/ai'), getJSON('mp/sim/gai')]);
  const p = src === 'bt' ? 'b' : 'l';
  const rows = L.filter((t) => t.s === s).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, limit).map(({ g, ...t }) => ({ ...t, ai: ai?.m?.[`${p}|${t.c}|${t.d}`]?.t || null }));
  return { rows, gai: gai?.m?.[`${p}|${s}`]?.t || null };
}

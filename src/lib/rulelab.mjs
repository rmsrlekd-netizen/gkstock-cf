// v267 🧭 규칙 찾기 (GK: "상승하기 전 특이점을 찾아 규칙을 빨리 정하자")
//  · 재료: 과거 재현이 저장한 📜 판정 줄(mp/bt/disc) — 그날 레이더 후보(점수 4↑) 종목의 공시·속뜻·위험·세력 원가 위치·보호예수·차트 자리·세력 이력
//  · 성공 = 다음 날 시가 기준 120거래일 안에 −15%보다 +30%에 먼저 도달 ('w'), 실패 = −15% 먼저 ('l')
//  · 방법: 2024년까지(학습)에서 꼬리표를 하나씩 더해(최대 3개) 성공률을 가장 많이 올리는 조합을 찾고(빔 검색),
//          2025년부터(안 본 기간)에도 통하는지 확인 → 둘 다 통과한 것만 '규칙 후보'
//  · 피할 조합도 같은 방식(실패율 기준)
//  · 다시 계산(과거 재현) 없이 저장된 줄만 읽음 — 결과는 30분 캐시 + 잠금
import { getJSON, setJSON } from './store.mjs';

const CUT = '2025-01-01', MIN_TR = 60, MIN_TE = 25, DAY = 864e5;
const r1 = (x) => Math.round(x * 10) / 10;

export function ruleStudy(rows, { cut = CUT } = {}) {
  const R = (rows || []).filter((r) => r && (r[3] === 'w' || r[3] === 'l' || r[3] === 'n')).map((r) => ({ c: r[0], d: r[1], y: r[3], F: new Set([...(r[2] || []), ...((r[8] || []).map((s) => 'ent:' + s))]) }));
  const TR = R.filter((r) => r.d < cut), TE = R.filter((r) => r.d >= cut);
  if (TR.length < 300 || TE.length < 100) return { n: R.length, ntr: TR.length, nte: TE.length, need: true };
  const rate = (L, y) => (L.length ? L.filter((r) => r.y === y).length / L.length : 0);
  const wk = (d) => Math.floor(Date.parse(d) / (7 * DAY));
  const tOf = (L, y, p0) => { const G = new Map(); for (const r of L) { const z = G.get(wk(r.d)) || [0, 0]; z[0]++; if (r.y === y) z[1]++; G.set(wk(r.d), z); } const n = L.length, p = rate(L, y); let v = 0; for (const [, [m, k]] of G) v += (k - m * p) ** 2; if (G.size < 3 || !v) return null; const se = Math.sqrt(v) / n; return r1((p - p0) / se); };
  const base = { tr: { w: rate(TR, 'w'), l: rate(TR, 'l'), n: TR.length }, te: { w: rate(TE, 'w'), l: rate(TE, 'l'), n: TE.length } };
  const feats = new Map(); for (const r of TR) for (const k of r.F) feats.set(k, (feats.get(k) || 0) + 1);
  const K = [...feats].filter(([, n]) => n >= MIN_TR).map(([k]) => k);
  const has = (r, ks) => ks.every((k) => r.F.has(k));
  const search = (y) => {
    // 빔 검색: 깊이 3, 폭 8 — 학습 기간 성공(또는 실패)률 기준, 표본 MIN_TR 이상
    let beam = [{ ks: [], L: TR }]; const all = [];
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      for (const b of beam) for (const k of K) {
        if (b.ks.includes(k) || (b.ks.length && k < b.ks[b.ks.length - 1])) continue;
        const L = b.L.filter((r) => r.F.has(k)); if (L.length < MIN_TR) continue;
        const p = rate(L, y); const prev = b.ks.length ? rate(b.L, y) : base.tr[y];
        if (p < prev + 0.02) continue; // 하나 더할 때마다 최소 2%p는 올라야
        next.push({ ks: [...b.ks, k], L, p });
      }
      next.sort((a, b) => b.p - a.p);
      const seen = new Set(); beam = next.filter((x) => { const s = x.ks.slice().sort().join('+'); if (seen.has(s)) return false; seen.add(s); return true; }).slice(0, 8);
      all.push(...beam);
    }
    return all.map((x) => {
      const T = TE.filter((r) => has(r, x.ks));
      const tr = { n: x.L.length, w: Math.round(rate(x.L, 'w') * 100), l: Math.round(rate(x.L, 'l') * 100) };
      const te = { n: T.length, w: Math.round(rate(T, 'w') * 100), l: Math.round(rate(T, 'l') * 100) };
      const liftTr = base.tr[y] ? r1(rate(x.L, y) / base.tr[y]) : null, liftTe = T.length && base.te[y] ? r1(rate(T, y) / base.te[y]) : null;
      const t = T.length >= MIN_TE ? tOf(T, y, base.te[y]) : null;
      // 마지막에 더한 꼬리표가 안 본 기간에서도 도움이 됐는지 (아니면 앞 조합으로 충분)
      const P = x.ks.length > 1 ? TE.filter((r) => has(r, x.ks.slice(0, -1))) : TE; const helps = !T.length ? false : rate(T, y) >= rate(P, y) + 0.03;
      const pass = T.length >= MIN_TE && liftTe != null && liftTe >= 1.3 && t != null && t >= 3 && helps;
      return { ks: x.ks, tr, te, liftTr, liftTe, t, pass, helps, codes: new Set(T.map((r) => r.c)).size };
    }).sort((a, b) => (b.pass ? 1 : 0) - (a.pass ? 1 : 0) || (b.liftTe || 0) - (a.liftTe || 0)).slice(0, 12);
  };
  // 꼬리표 하나씩: 오르기 전에 얼마나 더 자주 있었나 (학습·검증 둘 다)
  const single = K.map((k) => { const A = TR.filter((r) => r.F.has(k)), Z = TE.filter((r) => r.F.has(k)); return { k, trn: A.length, ten: Z.length, trw: Math.round(rate(A, 'w') * 100), tew: Z.length ? Math.round(rate(Z, 'w') * 100) : null, trl: Math.round(rate(A, 'l') * 100), tel: Z.length ? Math.round(rate(Z, 'l') * 100) : null }; })
    .map((x) => ({ ...x, lw: base.tr.w ? r1(x.trw / 100 / base.tr.w) : null, lwz: x.tew != null && base.te.w ? r1(x.tew / 100 / base.te.w) : null }))
    .sort((a, b) => (b.lw || 0) - (a.lw || 0));
  const pct = (b) => ({ n: b.n, w: Math.round(b.w * 100), l: Math.round(b.l * 100) });
  return { n: R.length, cut, base: { tr: pct(base.tr), te: pct(base.te) }, good: search('w'), bad: search('l'), single: single.slice(0, 40), codes: new Set(R.map((r) => r.c)).size };
}

export async function ruleReport({ force = false } = {}) {
  const c = await getJSON('mp/rulelearn').catch(() => null);
  if (!force && c && Date.now() - c.at < 30 * 60e3) return c.data;
  const lk = await getJSON('mp/rulelock').catch(() => null);
  if (lk && Date.now() - lk.at < 5 * 60e3 && c) return c.data; // 다른 계산이 도는 중이면 예전 결과
  await setJSON('mp/rulelock', { at: Date.now() }).catch(() => {});
  try {
    const { partsLoad } = await import('./btstore.mjs');
    const R = await partsLoad('mp/bt/disc');
    const st = await getJSON('mp/bt/state').catch(() => null);
    const DL = await import('./disclab.mjs');
    const data = { ...ruleStudy(R?.list || []), ko: DL.DF_KO, prog: st ? { pos: st.pos, of: st.queue?.length || 0, done: !!st.done } : null };
    await setJSON('mp/rulelearn', { at: Date.now(), data }).catch(() => {});
    return data;
  } finally { await setJSON('mp/rulelock', { at: 0 }).catch(() => {}); }
}

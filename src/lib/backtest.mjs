// 🧪 과거 재현 백테스트 (참고용)
//  "그날 이 규칙이었다면 뭐라고 판정했을까 → 그 뒤 5·20·60거래일 실제로 어떻게 됐나"를 지난 일봉·공시로 미리 계산
//  · 대상: 최근 180일 안에 판 깔기 공시(최대주주 변경·3자배정·CB·투자조합 5%·리픽싱)가 있던 종목 (레이더가 보는 종목군)
//  · 각 종목의 지난 날짜들(약 10거래일 간격)에서 그날까지의 일봉·공시만으로 판정 (미래 자료를 쓰지 않음)
//  · 한계: AI 판단·바깥 자료(지분·신용·거래원·재무)는 그날 기준으로 재현 못 함 → 체크리스트 일부 '?', 원문 가격은 이미 읽어 둔 것만 씀,
//          시가총액 순위는 모름(소형주·대형주 항목 빠짐) · 공시는 최근 180일치만 있어 오래된 날짜일수록 공시가 덜 보임
import { getJSON, setJSON } from './store.mjs';

const DAY = 86400e3;
const BT_V = 10; // v222: 감자·액면분할 일봉 보정(가짜 +2000%) + 매매 따라하기 성적 → 처음부터 다시 (v219: 120거래일·성공/실패 이유)
const PER_RUN = 6; // 3분마다 이만큼 종목 (v215: 12 → 6, DB 부담 줄이기)
const STEP = 10, BACK = 16; // 10거래일 간격으로 최대 16개 날짜 (약 8개월 — 120거래일 결과를 보려고 v219에서 늘림, 오래된 날은 공시가 덜 보임)

export async function btStep({ restart = false, now = Date.now(), max = PER_RUN } = {}) {
  let st = (await getJSON('mp/bt/state')) || null;
  const M = await import('./manip.mjs');
  if (restart || !st || st.v !== BT_V) {
    const evm = await M._loadEvents(now, { maxBuild: 0 });
    const SET = new Set(['mna', 'rights3', 'cb', 'fund5', 'refix']);
    const codes = Object.entries(evm).filter(([, evs]) => evs.some((e) => SET.has(e.kind))).map(([c]) => c).sort().slice(0, 700);
    st = { v: BT_V, queue: codes, pos: 0, started: now, samples: 0, kept: 0, groups: {}, done: false };
    await setJSON('mp/bt/state', st);
    await setJSON('mp/bt/rows', { v: BT_V, rows: [] }); // 종목별 판정 목록 (그룹 눌러서 보기용)
    await setJSON('mp/bt/trades', { v: BT_V, t: [] }); // v222 매매 따라하기 거래
    await setJSON('mp/bt/fw', { v: BT_V, r: [] }); // v222 점수 검증용 (판정 숫자 + 그 뒤 시장 대비 수익률)
    if (!codes.length) return { started: true, n: 0 };
  }
  if (st.done) return null;
  const { perfGroupKeys, perfAdd, pathStats, outcomeWhy } = await import('./manipx.mjs');
  const ixd = await M.indexDaily().catch(() => ({}));
  const idx = (await getJSON('mp/idx')) || [];
  const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
  const part = st.queue.slice(st.pos, st.pos + max);
  const newRows = [], newTr = [], newNf = {}, newFw = [];
  const TS = await import('./tradesim.mjs');
  for (const code of part) {
    try {
      const B = await M._bars(code);
      if (!B || B.length < 120) continue;
      const evAll = await M._eventsOf(code, now);
      const px = [];
      for (const e of M.docPick(evAll, 10)) { const p = await M._docPrice(e, { cacheOnly: true }).catch(() => null); const row = p ? M._pxRow(p, e) : null; if (row) px.push(row); }
      const mkt = snap[code]?.[1] || 'Q';
      const n = B.length;
      const pts = [];
      for (let k = BACK - 1; k >= 0; k--) { const i = n - 1 - 20 - k * STEP; if (i >= 60) pts.push(i); }
      let prev = null; const tlist = [];
      for (const i of pts) {
        const d = B[i].d, Tms = Date.parse(d + 'T15:40:00+09:00');
        const f = M.barFeatures(B.slice(0, i + 1), { now: Tms });
        if (!f) continue;
        const evs = evAll.filter((e) => e.ms <= Tms);
        M.applyMarks(f, evs, ixd, mkt);
        const s = M.eventScore(evs, Tms);
        const score = Math.round((s.score + (f.score || 0)) * 10) / 10;
        st.samples++;
        if (score < 4) continue; // 그날 레이더에 오를 만한 종목만
        const x = { code, name: snap[code]?.[0] || code, mkt, close: f.close, pct: null, f, by: s.by, score, events: M.keepEv(evs), px: px.filter((p) => p.date <= d), capPct: null, links: [], xnotes: [], sig: [] };
        x.stage = M.stageOf(s.by, f, evs);
        x.dir = M.direction(x, Tms);
        x.cl = M.checklistOf(x, Tms); M.bombGate(x);
        x.rbk = M.reboundOf(x, Tms); x.pex = M.postExitOf(x, Tms);
        const rk = M.rankRow(x);
        { const rr0 = { st: x.stage, dir: x.dir?.dir, ck: x.cl?.grade, pk: M.pickFails(rk).length ? 0 : 1, vd: M.verdictOf(rk)?.c, rr: x.dir?.rr?.v ?? null, gp: rk.gap ?? null, cm: rk.cm || 0, pexl: rk.pex?.lv || null };
          tlist.push({ d, f: TS.flagsOf(rr0), tp: x.dir?.rr?.t || 0, sp: x.dir?.rr?.s || 0, a: TS.attrsOf(rr0), v: { s: score, ws: x.cl?.ws ?? null, rr: rr0.rr, gp: rr0.gp } }); }
        if (x.stage === '거래정지') continue; // v222: 거래정지 중엔 실제로 살 수 없음 → 판정일 기준 결과에서 뺌 (따라 샀다면에선 '🔴' 판정으로만 씀)
        // 같은 종목·같은 단계가 30일 안에 이어지면 처음 1번만 (성적표 집계와 같은 기준)
        if (prev && prev.st === x.stage && Tms - prev.ms <= 30 * DAY) continue;
        prev = { st: x.stage, ms: Tms };
        const row = { st: x.stage, dir: x.dir?.dir || null, ck: x.cl?.grade || null, rr: x.dir?.rr?.v ?? null, pk: M.pickFails(rk).length ? 0 : 1, vd: M.verdictOf(rk)?.c || null, pexl: rk.pex?.lv || null, cm: rk.cm || 0, ...pathStats(B, i, { ix: ixd, mkt, tp: x.dir?.rr?.t, sp: x.dir?.rr?.s, now }) }; // v218: 진입은 다음 날 시가
        { const w = outcomeWhy(B, i, row, evAll, { ix: ixd, mkt }); if (w) row.wy = w; } // v219 성공·실패 이유
        for (const g of perfGroupKeys(row)) perfAdd(st.groups, g, row);
        newRows.push({ c: code, n: x.name, d, ...row });
        st.kept++;
      }
      { const L2 = tlist.map((p) => ({ ...p, di: TS.dOrd(p.d) })); const V = new Map(L2.map((p) => [p.di, p.v])); for (const r of TS.fwdOf(B, L2, { ix: ixd, mkt })) { const v = V.get(r[0]) || {}; newFw.push([r[0], v.s ?? null, v.ws ?? null, v.rr ?? null, v.gp ?? null, r[1], r[2], r[3]]); } }
      { const R = TS.simTrades(B, tlist, { final: true, now, ix: ixd, mkt }); for (const t of R.trades) newTr.push(TS.pack(code, snap[code]?.[0] || code, t)); for (const [k, v] of Object.entries(R.nf)) newNf[k] = (newNf[k] || 0) + v; } // v222 매매 따라하기 (과거 재현은 10거래일 간격 판정)
    } catch (e) { console.warn('bt', code, e.message); }
  }
  if (newFw.length) { const F = (await getJSON('mp/bt/fw')) || { v: BT_V, r: [] }; F.r = [...(F.r || []), ...newFw].slice(-20000); F.at = Date.now(); await setJSON('mp/bt/fw', F).catch(() => {}); }
  if (newTr.length || Object.keys(newNf).length) { const R = (await getJSON('mp/bt/trades')) || { v: BT_V, t: [] }; R.t = [...(R.t || []), ...newTr].slice(-8000); R.nf = R.nf || {}; for (const [k, v] of Object.entries(newNf)) R.nf[k] = (R.nf[k] || 0) + v; R.at = Date.now(); await setJSON('mp/bt/trades', R).catch(() => {}); }
  if (newRows.length) { const R = (await getJSON('mp/bt/rows')) || { v: BT_V, rows: [] }; R.rows = [...(R.rows || []), ...newRows].slice(-6000); await setJSON('mp/bt/rows', R).catch(() => {}); }
  st.pos += part.length; st.at = Date.now();
  if (st.pos >= st.queue.length) { st.done = true; st.doneAt = Date.now(); }
  await setJSON('mp/bt/state', st);
  return { pos: st.pos, of: st.queue.length, kept: st.kept };
}

export async function btSummary() {
  const st = await getJSON('mp/bt/state');
  if (!st) return { none: true };
  const { perfOut } = await import('./manipx.mjs');
  return { pos: st.pos, of: st.queue?.length || 0, done: !!st.done, started: st.started, doneAt: st.doneAt || null, samples: st.samples, kept: st.kept, groups: perfOut(st.groups || {}) };
}

/** 그룹(예: '한 줄 결론:🟢 매수 검토')에 들어간 종목별 판정과 결과 */
export async function btRows(g, limit = 400) {
  const { perfGroupKeys } = await import('./manipx.mjs');
  const R = (await getJSON('mp/bt/rows')) || { rows: [] };
  return (await import('./tradesim.mjs')).fixNames((R.rows || []).filter((r) => perfGroupKeys(r).includes(g)).slice(-limit)); // v222: 코드만 있던 이름 채움
}

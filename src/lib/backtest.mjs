// 🧪 과거 재현 백테스트 (참고용)
//  "그날 이 규칙이었다면 뭐라고 판정했을까 → 그 뒤 5·20·60거래일 실제로 어떻게 됐나"를 지난 일봉·공시로 미리 계산
//  · 대상: 최근 180일 안에 판 깔기 공시(최대주주 변경·3자배정·CB·투자조합 5%·리픽싱)가 있던 종목 (레이더가 보는 종목군)
//  · 각 종목의 지난 날짜들(약 10거래일 간격)에서 그날까지의 일봉·공시만으로 판정 (미래 자료를 쓰지 않음)
//  · 한계: AI 판단·바깥 자료(지분·신용·거래원·재무)는 그날 기준으로 재현 못 함 → 체크리스트 일부 '?', 원문 가격은 이미 읽어 둔 것만 씀,
//          시가총액 순위는 모름(소형주·대형주 항목 빠짐) · 공시는 최근 180일치만 있어 오래된 날짜일수록 공시가 덜 보임
import { getJSON, setJSON } from './store.mjs';

const DAY = 86400e3;
const BT_V = 1;
const PER_RUN = 6; // 3분마다 이만큼 종목 (v215: 12 → 6, DB 부담 줄이기)
const STEP = 10, BACK = 12; // 10거래일 간격으로 최대 12개 날짜 (약 6개월)

export async function btStep({ restart = false, now = Date.now(), max = PER_RUN } = {}) {
  let st = (await getJSON('mp/bt/state')) || null;
  const M = await import('./manip.mjs');
  if (restart || !st || st.v !== BT_V) {
    const evm = await M._loadEvents(now, { maxBuild: 0 });
    const SET = new Set(['mna', 'rights3', 'cb', 'fund5', 'refix']);
    const codes = Object.entries(evm).filter(([, evs]) => evs.some((e) => SET.has(e.kind))).map(([c]) => c).sort().slice(0, 700);
    st = { v: BT_V, queue: codes, pos: 0, started: now, samples: 0, kept: 0, groups: {}, done: false };
    await setJSON('mp/bt/state', st);
    if (!codes.length) return { started: true, n: 0 };
  }
  if (st.done) return null;
  const { perfGroupKeys, perfAdd } = await import('./manipx.mjs');
  const ixd = await M.indexDaily().catch(() => ({}));
  const idx = (await getJSON('mp/idx')) || [];
  const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
  const part = st.queue.slice(st.pos, st.pos + max);
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
      let prev = null;
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
        // 같은 종목·같은 단계가 30일 안에 이어지면 처음 1번만 (성적표 집계와 같은 기준)
        if (prev && prev.st === x.stage && Tms - prev.ms <= 30 * DAY) continue;
        prev = { st: x.stage, ms: Tms };
        const c0 = B[i].c, rr = (h) => (B[i + h] ? Math.round((B[i + h].c / c0 - 1) * 1000) / 10 : null);
        const row = { st: x.stage, dir: x.dir?.dir || null, ck: x.cl?.grade || null, rr: x.dir?.rr?.v ?? null, pk: M.pickFails(rk).length ? 0 : 1, vd: M.verdictOf(rk)?.c || null, pexl: rk.pex?.lv || null, cm: rk.cm || 0, r5: rr(5), r20: rr(20), r60: rr(60) };
        for (const g of perfGroupKeys(row)) perfAdd(st.groups, g, row);
        st.kept++;
      }
    } catch (e) { console.warn('bt', code, e.message); }
  }
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

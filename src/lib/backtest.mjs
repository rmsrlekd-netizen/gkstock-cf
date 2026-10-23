// 🧪 과거 재현 백테스트 (참고용)
//  "그날 이 규칙이었다면 뭐라고 판정했을까 → 그 뒤 5·20·60거래일 실제로 어떻게 됐나"를 지난 일봉·공시로 미리 계산
//  · 대상: 최근 180일 안에 판 깔기 공시(최대주주 변경·3자배정·CB·투자조합 5%·리픽싱)가 있던 종목 (레이더가 보는 종목군)
//  · 각 종목의 지난 날짜들(약 10거래일 간격)에서 그날까지의 일봉·공시만으로 판정 (미래 자료를 쓰지 않음)
//  · 한계: AI 판단·바깥 자료(지분·신용·거래원·재무)는 그날 기준으로 재현 못 함 → 체크리스트 일부 '?', 원문 가격은 이미 읽어 둔 것만 씀,
//          시가총액 순위는 모름(소형주·대형주 항목 빠짐) · 공시는 최근 180일치만 있어 오래된 날짜일수록 공시가 덜 보임
import { getJSON, setJSON } from './store.mjs';
import { partsReset, partsAppend, partsLoad } from './btstore.mjs';
import { CASE_CODES, motiveOf, bigRuns, saveCase } from './caselab.mjs';
import { entryEvents } from './entrylab.mjs';

const DAY = 86400e3;
const BT_V = 32; // (v283b: 규칙 고침마다 다시 돌리지 않음 — 1주일에 1번 모아서) · 32: // v278 겹쳐 실행 잠금 추가 뒤 깨끗하게 다시 (31은 같은 종목이 두 번 저장됨) · 31: // v274 규칙 1판(RULE_V 214) + 지수 4년치 + 💰 S3 · // v263 다시 처음부터: 10/20 저장 실패로 643번째 근처 종목이 수백 번 중복 저장됨 · // v237 🎯 타점 연구 · // v234 급락 가드 · v233 4년·적발 사례·대세상승·공시 속뜻 · // v230 3년치(공시 깊은 채우기 뒤)·돌파 확인 진입(BK)·조각 저장 · // v227 하락장 대기·매집 흔적·임원 매매 구분·20일 매도 · // v225 단계 규칙(엑시트 뒤 새 저점) · // v223: 눌림 진입·시장 국면·고점까지 걸린 날 ·  v222: 감자·액면분할 일봉 보정(가짜 +2000%) + 매매 따라하기 성적 → 처음부터 다시 (v219: 120거래일·성공/실패 이유)
const PER_RUN = 8; // v250 GK '내일까지' 6 → 8 (+ 50초 넘으면 멈추고 다음 차례) // 3분마다 이만큼 종목 (v215: 12 → 6, DB 부담 줄이기)
const STEP = 10, BACK = 95, BT_DAYS = 1460; // v233: 4년(적발 사례 2022~23 포함) · // v230: 10거래일 간격 최대 80개 날짜(약 3년 3개월) · 공시는 3년+180일 (v219: 16개 ≈ 8개월) // 10거래일 간격으로 최대 16개 날짜 (약 8개월 — 120거래일 결과를 보려고 v219에서 늘림, 오래된 날은 공시가 덜 보임)

export async function btStep({ restart = false, now = Date.now(), max = PER_RUN } = {}) {
  let st = (await getJSON('mp/bt/state')) || null;
  // v257 GK '결과가 늦더라도 원가를 다 받고' — 이번 계산이 끝난 뒤 세력 원가 2차(옛 공시)가 끝나 있으면 원가까지 넣어 한 번 더 처음부터 (계산 시작보다 뒤에 끝난 경우만 → 1번만)
  if (st?.done && st.v === BT_V && !restart) { const cf = await getJSON('mp/costfill').catch(() => null); if (cf?.done && (cf.doneAt || 0) > (st.started || 0)) { console.log('bt rerun after costfill'); restart = true; } }
  // v274: 새 규칙으로 처음부터 다시 돌기 전에, 끝난 4년치 결과로 🧮 우선순위 점수(mp/prio)를 먼저 만들어 둠 (다시 돌면 판정 줄이 지워지므로)
  if (st?.done && st.v !== BT_V && !(await getJSON('mp/prio').catch(() => null))) { try { await (await import('./rulelab.mjs')).ruleReport({ force: true }); } catch (e) { console.warn('prio before restart', e.message); } return { prio: 'built before restart' }; }
  const M = await import('./manip.mjs');
  if (restart || !st || st.v !== BT_V || (st.prep && !st.queue)) {
    // v230: 3년치 공시 깊은 채우기(backfill deep)가 끝나야 시작 — 그 전엔 예전 결과를 그대로 둠(화면엔 '준비 중' 표시)
    const bf = await getJSON('backfill/state').catch(() => null);
    { /* v248 세력 원가 원문 미리 받기(costFillStep)가 옛 공시까지 끝날 때까지 기다림 — 깊은 채우기 끝난 뒤 최대 3시간 (v257: 그 뒤 원가가 다 차면 끝나고 자동으로 한 번 더) */ const cf = bf?.deep?.done && !restart ? await getJSON('mp/costfill').catch(() => null) : null; if (((cf && !cf.done) || (bf?.deep?.done && bf.deep.stakeTo && !bf.deep.dD?.done)) && now - (bf.deep.doneAt || now) < 3 * 3600e3) { /* v251 + 5% 경영참가 다시 훑기 */ if (!st?.wait?.cf || now - (st.wait.at || 0) > 600e3) await setJSON('mp/bt/state', { ...(st || {}), wait: { since: st?.wait?.since || now, at: now, cf: cf ? { pos: cf.pos, of: cf.queue?.length || 0, round: cf.round, got: cf.got } : { pos: 0, of: 0, round: 0, got: 0 } } }); return { waiting: 'costfill', pos: cf?.pos }; } }
    if (!restart && !bf?.deep?.done) { if (!st?.wait) await setJSON('mp/bt/state', { ...(st || {}), wait: { since: now, deep: bf?.deep ? { day: bf.deep.day, limit: bf.deep.limit, rows: bf.deep.rows } : null } }); else if (now - (st.wait.at || 0) > 600e3) await setJSON('mp/bt/state', { ...st, wait: { ...st.wait, at: now, deep: bf?.deep ? { day: bf.deep.day, limit: bf.deep.limit, rows: bf.deep.rows } : null } }); return { waiting: true, deep: bf?.deep?.day || null }; }
    // 월별 공시 색인을 3년치로 다시 만들기 (한 번에 3개월씩, 깊은 채우기 뒤에 만든 것만 인정)
    const prep = st?.v === BT_V && st.prep ? st.prep : { since: now };
    const evm = await M._loadEvents(now, { maxBuild: 3, days: BT_DAYS + 180, rebuildBefore: bf?.deep?.doneAt || 0 });
    if (evm.__pending > 0) { await setJSON('mp/bt/state', { v: BT_V, prep: { ...prep, pending: evm.__pending, at: now }, wait: null }); return { prep: true, pending: evm.__pending }; }
    const SET = new Set(['mna', 'rights3', 'cb', 'fund5', 'refix']);
    // v222: 레이더 랭킹·내 세력주 종목부터 계산 (예전엔 코드 순서라 351320 같은 뒤쪽 코드는 몇 시간 뒤에야 나옴)
    const rk = (await getJSON('mp/rank')) || {}, my = (await getJSON('mp/my')) || {};
    const pri = new Set([...(Array.isArray(my.items) ? my.items.map((i) => i.code) : []), ...Object.keys(rk)]);
    const TSc = await import('./tradesim.mjs'); const cm0 = await TSc.capMap(); // v222: 지금 시총 8조↑(그날 2조 미만이었을 가능성 낮음)은 처음부터 뺌, 나머지는 판정일 시총으로 거름
    const codes = Object.entries(evm).filter(([c, evs]) => !((TSc.capAt(cm0, c, null) ?? 0) >= 80000) && evs.some((e) => SET.has(e.kind))).map(([c]) => c).sort((a, b) => (pri.has(a) ? 0 : 1) - (pri.has(b) ? 0 : 1) || (a < b ? -1 : 1)).slice(0, 1500); // v230: 700 → 1500 종목
    { const cs = new Set(CASE_CODES); codes.splice(0, codes.length, ...CASE_CODES, ...codes.filter((c) => !cs.has(c))); } // v233 적발 사례 종목은 공시 흔적이 없어도 맨 먼저 (정답지 채점)
    st = { v: BT_V, queue: codes, pos: 0, started: now, samples: 0, kept: 0, groups: {}, done: false };
    await setJSON('mp/bt/state', st);
    await partsReset('mp/bt/rows', BT_V); // 종목별 판정 목록 (그룹 눌러서 보기용)
    await partsReset('mp/bt/trades', BT_V, { nf: {}, deep: bf?.deep ? { from: bf.deep.limit, rows: bf.deep.rows } : null }); // v222 매매 따라하기 거래
    await partsReset('mp/bt/fw', BT_V); // v222 점수 검증용 (판정 숫자 + 그 뒤 시장 대비 수익률)
    await partsReset('mp/bt/big', BT_V); await partsReset('mp/bt/bigb', BT_V); // v233 대세상승 해부
    await partsReset('mp/bt/disc', BT_V); // v247 📜 공시 확률
    await partsReset('mp/bt/ent', BT_V); // v237 🎯 타점 연구 (자리 × 파는 법)
    if (!codes.length) return { started: true, n: 0 };
  }
  if (st.done || st.wait || st.prep && !st.queue) return null;
  // v278 겹쳐 실행 금지 (10/22 지킴이: 같은 종목·날짜 21줄 중복) — 한 번 계산이 3분을 넘기면 다음 크론이 같은 자리를 또 계산해 결과가 두 번 붙음 → 실행 중 표시(lockUntil, 175초)가 있으면 쉼
  if ((st.lockUntil || 0) > Date.now()) return { skip: 'bt running' };
  { const { trimGroups } = await import('./manipx.mjs'); trimGroups(st.groups); st.callAt = Date.now(); await setJSON('mp/bt/state', st).catch((e) => console.warn('bt state', e.message)); } // v263: 불렸다는 표시를 무거운 준비(지수·시총 읽기)보다 먼저 저장
  const { perfGroupKeys, perfAdd, pathStats, outcomeWhy, trimGroups } = await import('./manipx.mjs');
  const ixd = await M.indexDaily(1100).catch(() => ({}));
  const idx = (await getJSON('mp/idx')) || [];
  const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
  const TSm = await import('./tradesim.mjs'); const cmap = await TSm.capMap(); const capP = cmap.pct || {}; // 시가총액 순위(근사) → 소형주 항목·대형주 감점 재현 · 판정일 시총으로 세력주만
  // v258: 같은 자리에서 계속 멈추면(작업이 시간·CPU 한도로 끊겨 저장 전에 죽음 — 10/20 05:36부터 633에서 멈춤) 2번째부터 1종목씩, 3번째엔 그 종목 건너뜀
  if (st.tryPos === st.pos) st.tryN = (st.tryN || 0) + 1; else { st.tryPos = st.pos; st.tryN = 1; }
  if (st.tryN >= 3) { (st.skipped ||= []).push(st.queue[st.pos]); console.warn('bt skip', st.queue[st.pos]); st.pos++; st.tryPos = st.pos; st.tryN = 1; }
  if (st.tryN >= 2) { max = 1; st.per = Math.max(1, Math.floor((st.per || max) / 2)); } // v260: 끊기면 다음부터 한 번에 계산할 종목 수를 절반으로
  else if (st.per) max = Math.min(max, st.per);
  st.tryAt = Date.now(); st.lockUntil = Date.now() + 290e3; const startPos = st.pos; await setJSON('mp/bt/state', st); // 시도 횟수를 먼저 저장 (중간에 끊겨도 남게)
  const part = st.queue.slice(st.pos, st.pos + max);
  const newRows = [], newTr = [], newNf = {}, newFw = [], newBig = [], newBase = [], newEnt = [], newDisc = [];
  const CS = new Set(CASE_CODES);
  const TS = await import('./tradesim.mjs');
  const tRun = Date.now(); let done = 0;
  for (const code of part) {
    if (done > 0 && Date.now() - tRun > 50e3) break; done++;
    try {
      const B = await M._bars(code, 1000); // v230 약 4년치 일봉
      if (!B || B.length < 120) continue;
      const evAll = await M._eventsOf(code, now, { days: BT_DAYS + 180 });
      const px = [];
      for (const e of M.docPick(evAll, 20)) { const p = await M._docPrice(e, { cacheOnly: true }).catch(() => null); const row = p ? M._pxRow(p, e) : null; if (row) px.push(row); }
      const mkt = snap[code]?.[1] || 'Q';
      const n = B.length;
      const pts = [];
      for (let k = BACK - 1; k >= 0; k--) { const i = n - 1 - 20 - k * STEP; if (i >= 60) pts.push(i); }
      let prev = null, lastDisc = 0; const tlist = []; const isCase = CS.has(code), cpts = [];
      for (const i of pts) {
        const d = B[i].d, Tms = Date.parse(d + 'T15:40:00+09:00');
        const f = M.barFeatures(B.slice(0, i + 1), { now: Tms });
        if (!f) continue;
        const evs = evAll.filter((e) => e.ms <= Tms);
        M.applyMarks(f, evs, ixd, mkt);
        const s = M.eventScore(evs, Tms);
        const score = Math.round((s.score + (f.score || 0)) * 10) / 10;
        st.samples++;
        if (isCase) cpts.push({ d, s: score, c: f.close });
        if (score < 4) continue; // 그날 레이더에 오를 만한 종목만
        if (TSm.tooBig(cmap, code, f.close)) continue; // v222: 그날 시가총액 2조↑은 세력주 아님
        const x = { code, name: snap[code]?.[0] || code, mkt, close: f.close, pct: null, f, by: s.by, score, events: M.keepEv(evs), px: px.filter((p) => p.date <= d), capPct: capP[code] ?? null, links: [], xnotes: [], sig: [] };
        x.stage = M.stageOf(s.by, f, evs);
        x.dir = M.direction(x, Tms);
        x.cl = M.checklistOf(x, Tms); M.bombGate(x);
        x.rbk = M.reboundOf(x, Tms); x.pex = M.postExitOf(x, Tms);
        const rk = M.rankRow(x);
        { const rr0 = { st: x.stage, dir: x.dir?.dir, ck: x.cl?.grade, pk: M.pickFails(rk).length ? 0 : 1, vd: M.verdictOf(rk)?.c, rr: x.dir?.rr?.v ?? null, gp: rk.gap ?? null, cm: rk.cm || 0, pexl: rk.pex?.lv || null, ckv: Object.fromEntries((x.cl?.pos || []).filter((i) => i.ok != null).map((i) => [i.k, i.ok ? 1 : 0])),
            mv: motiveOf(evs, { B, Tms }), ev: M.evKinds60(evs, x.px, Tms), lo60: f.fromLow60 ?? null, bx: f.box60 ?? null, cy: f.cyc ? 1 : 0, p1: f.pump1 ? 1 : 0, mk2: (f.marks || []).filter((m) => m.ok).length, rd: M.redKeys(x.cl) }; // v231 rd · v224 🏆 이긴 자리 공통점용: 최근 60일 공시 종류·차트 모양
          tlist.push({ d, f: TS.flagsOf(rr0), tp: x.dir?.rr?.t || 0, sp: x.dir?.rr?.s || 0, a: TS.attrsOf(rr0), v: { s: score, ws: x.cl?.ws ?? null, rr: rr0.rr, gp: rr0.gp } }); }
        { /* v247 📜 공시 확률 줄 — 같은 종목 30일에 1번 */ if (x.stage !== '거래정지' && (!lastDisc || Tms - lastDisc >= 30 * DAY)) { lastDisc = Tms; const ps = pathStats(B, i, {}); if (ps.lo) { const DL = await import('./disclab.mjs'); const XP = await import('./manipx.mjs'); const EL = await import('./entrylab.mjs'); newDisc.push([code, d, DL.discFeats({ evs, px: x.px, close: f.close, Tms, mv: motiveOf(evs, { B, Tms }), rd: M.redKeys(x.cl), ev60: M.evKinds60(evs, x.px, Tms) }), ps.lo, ps.lw ?? null, ps.lf ?? null, ps.ldd ?? null, ps.u120 ?? null, EL.entryNow(B.slice(0, i + 1)).map((e) => e.s), (() => { const P = new Set(); for (const p of x.px || []) for (const nm of [...(p.to || []), p.f5?.gp, ...(p.f5?.mem || [])]) { if (!nm || nm.length < 2 || XP.BIG.test(nm)) continue; const k = XP.partyKey(nm); if (k && k.length >= 3) P.add(k); } return [...P].slice(0, 8); })()]); } } }
        if (isCase && cpts.length) Object.assign(cpts[cpts.length - 1], { st: x.stage, vd: M.verdictOf(rk)?.c || null, ck: x.cl?.grade || null, dir: x.dir?.dir || null, mv: motiveOf(evs, { B, Tms }) });
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
      { const L2 = tlist.map((p) => ({ ...p, di: TS.dOrd(p.d) })); const V = new Map(L2.map((p) => [p.di, p.v])); for (const r of TS.fwdOf(B, L2, { ix: ixd, mkt })) { const v = V.get(r[0]) || {}; newFw.push([r[0], v.s ?? null, v.ws ?? null, v.rr ?? null, v.gp ?? null, r[1], r[2], r[3], code]); } }
      { const R = TS.simTrades(B, tlist, { final: true, now, ix: ixd, mkt }); for (const t of R.trades) newTr.push(TS.pack(code, snap[code]?.[0] || code, t)); for (const [k, v] of Object.entries(R.nf)) newNf[k] = (newNf[k] || 0) + v; } // v222 매매 따라하기 (과거 재현은 10거래일 간격 판정)
      { const nm = snap[code]?.[0] || code; const BR = bigRuns(B, evAll, { px }); for (const r of BR.runs) newBig.push({ c: code, n: nm, ...r }); for (const k of BR.base) newBase.push(k); // v233 대세상승 해부
        try { for (const e of entryEvents(B, { code, evs: evAll, ix: ixd, mkt, motiveOf, px })) newEnt.push(e); } catch (e) { console.warn('bt ent', code, e.message); } // v237 타점
        if (isCase) { const evMs = evAll.map((e) => e.ms).filter(Boolean); await saveCase(code, { pts: cpts, runs: BR.runs, evFrom: evMs.length ? new Date(Math.min(...evMs) + 9 * 3600e3).toISOString().slice(0, 10) : null, from: B[0]?.d || null }); } }
    } catch (e) { console.warn('bt', code, e.message); }
  }
  if (done && done === part.length && Date.now() - tRun < 25e3 && st.per && st.per < PER_RUN) st.per++; // v260: 여유 있으면 한 종목씩 다시 늘림
  { const cur = await getJSON('mp/bt/state').catch(() => null); if (cur && (cur.pos !== startPos || cur.v !== st.v)) { console.warn('bt raced — 결과 버림', startPos, cur.pos); return { skip: 'raced' }; } } // v278 다른 실행이 먼저 진행했으면 이번 결과는 버림 (중복 방지)
  st.pos += done; st.at = Date.now(); st.lockUntil = 0;
  if (st.pos >= st.queue.length) { st.done = true; st.doneAt = Date.now(); }
  trimGroups(st.groups);
  await setJSON('mp/bt/state', st); // v263: 상태(진행 위치)를 먼저 저장하고 그다음 결과 조각을 붙임 → 중간에 끊겨도 같은 종목이 두 번 저장되지 않음
  if (newBig.length) await partsAppend('mp/bt/big', newBig, { per: 800, maxParts: 30, v: BT_V }).catch((e) => console.warn('bt big', e.message));
  if (newDisc.length) await partsAppend('mp/bt/disc', newDisc, { per: 3000, maxParts: 40, v: BT_V }).catch((e) => console.warn('bt disc', e.message));
  if (newEnt.length) await partsAppend('mp/bt/ent', newEnt, { per: 4000, maxParts: 60, v: BT_V }).catch((e) => console.warn('bt ent', e.message));
  if (newBase.length) await partsAppend('mp/bt/bigb', newBase, { per: 4000, maxParts: 30, v: BT_V }).catch((e) => console.warn('bt bigb', e.message));
  if (newFw.length) await partsAppend('mp/bt/fw', newFw, { per: 5000, maxParts: 24, v: BT_V }).catch((e) => console.warn('bt fw', e.message));
  if (newTr.length || Object.keys(newNf).length) await partsAppend('mp/bt/trades', newTr, { per: 1500, maxParts: 30, nf: newNf, v: BT_V }).catch((e) => console.warn('bt tr', e.message));
  if (newRows.length) await partsAppend('mp/bt/rows', newRows, { per: 1500, maxParts: 45, v: BT_V }) /* v281: 30조각(45,000줄)에서 꽉 차 마지막 약 3,800줄이 종목 목록에서 빠졌음 */.catch((e) => console.warn('bt rows', e.message));
  if (st.done) { try { await (await import('./entrylab.mjs')).entSummary({ force: true }); } catch (e) { console.warn('ent sum', e.message); } } // v237 끝나면 타점 학습 저장 (v263: 마지막 조각을 붙인 뒤)
  return { pos: st.pos, of: st.queue.length, kept: st.kept };
}

export async function btSummary() {
  const st = await getJSON('mp/bt/state');
  if (!st) return { none: true };
  const { perfOut } = await import('./manipx.mjs');
  return { pos: st.pos, of: st.queue?.length || 0, done: !!st.done, started: st.started, doneAt: st.doneAt || null, samples: st.samples, kept: st.kept, groups: perfOut(st.groups || {}), v: st.v, cur: BT_V, wait: st.wait || null, prep: st.prep && !st.queue ? st.prep : null, at: st.at || null, callAt: st.callAt || null, tryAt: st.tryAt || null, tryN: st.tryN || 0, per: st.per || null, skipped: (st.skipped || []).length };
}

/** 그룹(예: '한 줄 결론:🟢 매수 검토')에 들어간 종목별 판정과 결과 */
export async function btRows(g, limit = 400) {
  const { perfGroupKeys } = await import('./manipx.mjs');
  const R = { rows: dedupeBy((await partsLoad('mp/bt/rows'))?.list || [], (r) => `${r.c}|${r.d}`) }; // v279 혹시 겹친 줄은 읽을 때 빼고 보여 줌
  return (await import('./tradesim.mjs')).fixNames((R.rows || []).filter((r) => perfGroupKeys(r).includes(g)).slice(-limit)); // v222: 코드만 있던 이름 채움
}

export function dedupeBy(list, key) { const seen = new Set(), out = []; for (const x of list) { const k = key(x); if (seen.has(k)) continue; seen.add(k); out.push(x); } return out; }

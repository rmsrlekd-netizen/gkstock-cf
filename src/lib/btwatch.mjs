// v266 과거 재현 지킴이 (GK: "성과검증이 중요하다" — 멈춤·중복을 GK가 먼저 찾게 하지 않기)
//  · 3분마다 가볍게: 진행 위치가 40분 넘게 안 바뀌면 / 마지막 결과 조각에 같은 종목·같은 날짜가 겹치면 → 관리자 텔레그램 (같은 문제는 3시간에 한 번)
//  · 화면(성적표 📅)에도 같은 판단으로 빨간 경고 (app.js)
import { getJSON, setJSON } from './store.mjs';

export async function btWatch(now = Date.now()) {
  const st = await getJSON('mp/bt/state').catch(() => null);
  if (st?.done) return labPrecompute(st, now);
  if (!st || st.wait || !st.queue) return null;
  const w = (await getJSON('mp/bt/watch').catch(() => null)) || {};
  const issues = [];
  const last = st.at || st.started || now;
  if (now - last > 40 * 60e3) issues.push(['stall', `⚠ 과거 재현이 ${st.pos}/${st.queue.length}에서 ${Math.round((now - last) / 60e3)}분째 진행이 없어요${st.callAt ? ` (마지막 호출 ${Math.round((now - st.callAt) / 60e3)}분 전)` : ' (호출 기록 없음 — 저장 실패 가능)'}`]);
  // 중복 검사: 마지막 조각만 (가벼움)
  try {
    const meta = await getJSON('mp/bt/rows');
    if (meta?.parts && (!w.dupChkAt || now - w.dupChkAt > 30 * 60e3)) {
      w.dupChkAt = now;
      const p = (await getJSON(`mp/bt/rows/p${meta.parts - 1}`)) || [];
      const seen = new Set(); let dup = 0;
      for (const r of p) { const k = `${r.c}|${r.d}|${r.st || ''}`; if (seen.has(k)) dup++; else seen.add(k); }
      w.dup = dup;
      if (dup > 5) issues.push(['dup', `⚠ 과거 재현 결과에 같은 종목·같은 날짜 줄이 ${dup}개 겹쳐 있어요 — 저장이 꼬였을 수 있음`]);
    }
  } catch {}
  const fresh = issues.filter(([k]) => !w['al_' + k] || now - w['al_' + k] > 3 * 3600e3);
  for (const [k] of fresh) w['al_' + k] = now;
  w.at = now; w.issues = issues.map(([k, t]) => ({ k, t }));
  await setJSON('mp/bt/watch', w).catch(() => {});
  if (fresh.length) { try { const X = await import('./manipx.mjs'); await X.radarAlert(fresh.map(([, t]) => t), [], { force: true, title: '🧪 과거 재현 지킴이' }); } catch (e) { console.warn('btwatch alert', e.message); } }
  return { issues: issues.length, alerted: fresh.length };
}

// v270 과거 재현이 끝나면 무거운 집계(🔬 연구실·🧭 규칙 찾기)를 크론에서 미리 한 번 계산해 저장 — 화면은 저장본만 읽음(60초 넘어 못 열리던 문제)
// v279 끝난 뒤 한 번: 결과 전체에서 같은 종목·같은 날짜 줄이 몇 개 겹쳤는지 세어 텔레그램으로 (0이어도 한 번 알림 — '깨끗함' 확인용)
async function finalDupCheck(st, now) {
  const w = (await getJSON('mp/bt/watch').catch(() => null)) || {};
  const doneAt = st.doneAt || st.at || 0; if (w.finalAt === doneAt) return null;
  const { partsLoad } = await import('./btstore.mjs');
  const R = (await partsLoad('mp/bt/rows'))?.list || [], T = (await partsLoad('mp/bt/trades'))?.list || [];
  const cnt = (L, k) => { const s = new Set(); let d = 0; for (const x of L) { const z = k(x); if (s.has(z)) d++; else s.add(z); } return d; };
  const dr = cnt(R, (r) => `${r.c}|${r.d}`), dt = cnt(T, (a) => `${a[0]}|${a[2]}|${a[3]}`);
  w.finalAt = doneAt; w.final = { rows: R.length, dupRows: dr, trades: T.length, dupTr: dt, v: st.v, at: now };
  await setJSON('mp/bt/watch', w).catch(() => {});
  try { const X = await import('./manipx.mjs'); await X.radarAlert([dr || dt ? `⚠ 과거 재현 끝 (v${st.v}) — 판정 ${R.length}줄 중 겹친 줄 ${dr}개 · 거래 ${T.length}건 중 겹친 거래 ${dt}건 (화면·학습은 겹친 것 빼고 읽음)` : `✅ 과거 재현 끝 (v${st.v}) — 판정 ${R.length}줄 · 거래 ${T.length}건, 겹친 줄 없음`], [], { force: true, title: '🧪 과거 재현 지킴이' }); } catch {}
  return w.final;
}
async function labPrecompute(st, now) {
  try { const f = await finalDupCheck(st, now); if (f) return { final: f }; } catch (e) { console.warn('final dup', e.message); }
  const doneAt = st.doneAt || st.at || 0;
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 800) return { skip: 'db slow' };
  const ms = await getJSON('mp/state').catch(() => null); if ((ms?.busyUntil || 0) > now) return { skip: 'radar busy' };
  const pc = (await getJSON('mp/bt/pre').catch(() => null)) || {};
  if (pc.doneAt === doneAt && pc.lab && pc.rules) return null;
  if (pc.doneAt !== doneAt) { pc.doneAt = doneAt; pc.lab = 0; pc.rules = 0; pc.tries = 0; }
  if ((pc.tries || 0) >= 6) return { skip: 'too many tries' };
  pc.tries = (pc.tries || 0) + 1; pc.at = now; await setJSON('mp/bt/pre', pc).catch(() => {});
  const out = {};
  try {
    if (!pc.rules) { const R = await import('./rulelab.mjs'); await R.ruleReport({ force: true }); pc.rules = Date.now(); out.rules = 1; }
    else if (!pc.lab) { const L = await import('./caselab.mjs'); await L.labSummary({ force: true }); pc.lab = Date.now(); out.lab = 1; }
  } catch (e) { out.err = e.message; pc.err = e.message; }
  await setJSON('mp/bt/pre', pc).catch(() => {});
  return out;
}

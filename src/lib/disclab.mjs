// v247 📜 공시 확률 (GK: '차트는 내가 볼 테니 공시로 확률을 잘 걸러라 — 다만 4년치 차트로 진입·손절·목표 자리도 같이')
//  과거 재현의 판정 날마다(점수 4↑, 같은 종목 30일에 1번) 그날까지 알 수 있는 공시 재료만 꼬리표로 →
//  120거래일 안 +30%가 먼저(크게 감) / −15%가 먼저(크게 깨짐) 비율을 꼬리표·2개 조합별로 →
//  앞 기간·안 본 뒤 기간 둘 다 전체보다 1.2배↑면 ✓ · 조합마다 차트 숫자: 이긴 종목이 오르기 전 얼마나 빠졌나(손절 자리),
//  얼마까지 갔나(목표), 며칠 걸렸나, 그날 차트 자리별 승률(진입 자리)
const DAY = 864e5;
const r1 = (x) => Math.round(x * 10) / 10;
const COSTK = { cb: 1, refix: 1, rights3: 1, mna: 1, fund5: 1 };
export const DF_KO = {
  'e:cb': 'CB 발행', 'e:refix': '전환가 조정', 'e:rights3': '3자배정 유상증자', 'e:rights': '유상증자', 'e:mna': '최대주주 변경·경영권', 'e:fund5': '투자조합·5% 신고', 'e:conv': '전환청구', 'e:paid': '납입 완료', 'e:fail': '철회·납입 연기',
  'e:pledge': '주식 담보', 'e:majsell': '대주주 매도', 'e:tsell': '자사주 처분', 'e:insider_b': '임원·주주 장내 매수', 'e:insider_s': '임원·주주 장내 매도', 'e:contract': '공급계약', 'e:invest': '타법인 투자', 'e:rename': '상호 변경', 'e:purpose': '사업목적 추가', 'e:ceo': '대표 변경', 'e:inquiry': '조회공시', 'e:cbbuy': 'CB 되사기', 'e:risk': '위험 공시', 'e:agm': '주총 안건',
  'c:under': '세력 원가 아래', 'c:near': '세력 원가 근처(+20% 안)', 'c:mid': '세력 원가 +20~100%', 'c:far': '세력 원가 2배↑', 'u:30': '보호예수 해제 30일 안', 'u:90': '보호예수 해제 31~90일', 'x:20': '최근 20일 물량 신호(전환청구·대주주 매도·자사주 처분)',
};
const kko = (k) => DF_KO[k] || (k.startsWith('mv:') ? '속뜻: ' + k.slice(3) : k.startsWith('r:') ? '위험: ' + k.slice(2) : k);
/** 그날 알 수 있는 공시 꼬리표 */
export function discFeats({ evs, px, close, Tms, mv = [], rd = [], ev60 = [] }) {
  const F = new Set();
  for (const k of ev60) F.add('e:' + k);
  for (const k of mv) F.add('mv:' + k);
  for (const k of rd) F.add('r:' + k);
  const d = new Date(Tms + 9 * 3600e3).toISOString().slice(0, 10);
  let cost = null; for (const p of px || []) { if (!COSTK[p.kind] || !(p.p > 0) || !p.date || p.date > d || Date.parse(p.date) < Tms - 540 * DAY) continue; if (!cost || p.date > cost.date) cost = p; }
  if (cost && close > 0) { const r = close / cost.p; if (r > 0.2 && r < 20) F.add(r < 0.95 ? 'c:under' : r < 1.2 ? 'c:near' : r < 2 ? 'c:mid' : 'c:far'); }
  let ul = null; for (const p of px || []) { const u = p.lock?.until; if (!u || !p.date || p.date > d) continue; const dd = (Date.parse(u) - Tms) / DAY; if (dd > 0 && (ul == null || dd < ul)) ul = dd; }
  if (ul != null) { if (ul <= 30) F.add('u:30'); else if (ul <= 90) F.add('u:90'); }
  if ((evs || []).some((e) => e.ms <= Tms && e.ms > Tms - 28 * DAY && ['conv', 'majsell', 'tsell'].includes(e.kind))) F.add('x:20');
  return [...F];
}
/** 줄: [code, d, feats, lo('w'|'l'|'n'), lw(+30%까지 일), lf(−15%까지 일), ldd(+30% 전 최저 %), u120(120일 최고 %), ent(그날 차트 자리)] */
export function discStudy(rows) {
  const R = rows.filter((r) => r[3]); const N = R.length; if (N < 300) return { n: N, need: 300 };
  const ds = R.map((r) => r[1]).sort(); const cut = ds[Math.floor(ds.length / 2)];
  const rate = (L) => { const w = L.filter((r) => r[3] === 'w').length, l = L.filter((r) => r[3] === 'l').length; return { n: L.length, w: Math.round((w / L.length) * 100), l: Math.round((l / L.length) * 100) }; };
  const base = rate(R), baseA = rate(R.filter((r) => r[1] < cut)), baseZ = rate(R.filter((r) => r[1] >= cut));
  const wk = (d) => Math.floor(Date.parse(d) / (7 * DAY));
  // 같은 주에 판정된 종목은 시장 따라 같이 움직임 → 주 단위로 묶은 표준오차로 '전체보다 정말 높은가' t값 (조합을 많이 보므로 3 이상만 '확실함')
  const tOf = (L, key, p0) => { const G = new Map(); for (const r of L) { const z = G.get(wk(r[1])) || [0, 0]; z[0]++; if (r[3] === key) z[1]++; G.set(wk(r[1]), z); } const n = L.length, p = L.filter((r) => r[3] === key).length / n; let v = 0; for (const [, [m, k]] of G) v += (k - m * p) ** 2; const g = G.size; if (g < 2) return null; const se = Math.sqrt((v * g) / (g - 1)) / n; return se > 0 ? r1((p - p0 / 100) / se) : null; };
  const cov = Math.round((R.filter((r) => r[2].some((k) => k.startsWith('c:'))).length / N) * 100);
  const idx = new Map(); R.forEach((r, i) => { for (const k of r[2]) { const a = idx.get(k) || []; a.push(i); idx.set(k, a); } });
  const q = (a, f) => { if (a.length < 5) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * f))]; };
  const judge = (ids) => {
    const L = ids.map((i) => R[i]); if (L.length < 40) return null;
    const A = L.filter((r) => r[1] < cut), Z = L.filter((r) => r[1] >= cut); if (A.length < 15 || Z.length < 15) return null;
    const all = rate(L), a = rate(A), z = rate(Z);
    const lift = base.w ? r1(all.w / base.w) : null, la = baseA.w ? a.w / baseA.w : 0, lz = baseZ.w ? z.w / baseZ.w : 0;
    const fl = base.l ? r1(all.l / base.l) : null, fa = baseA.l ? a.l / baseA.l : 0, fz = baseZ.l ? z.l / baseZ.l : 0;
    const W = L.filter((r) => r[3] === 'w');
    // 차트 숫자: 이긴 종목이 +30% 가기 전에 얼마나 빠졌나 → 80%가 버틴 깊이 = 손절은 그 밖 · 목표 = 이긴 종목 120일 최고의 가운데
    const chart = W.length >= 8 ? { stop: q(W.map((r) => r[6]).filter((v) => v != null), 0.2), days: q(W.map((r) => r[4]).filter((v) => v != null), 0.5), tgt: [q(W.map((r) => r[7]).filter((v) => v != null), 0.25), q(W.map((r) => r[7]).filter((v) => v != null), 0.5), q(W.map((r) => r[7]).filter((v) => v != null), 0.75)] } : null;
    // 진입 자리: 그날 차트 자리가 떠 있던 경우의 '크게 감' 비율 (15번↑)
    const es = {}; for (const r of L) for (const s of r[8] || []) (es[s] ||= []).push(r);
    const ent = Object.entries(es).filter(([, a]) => a.length >= 15).map(([s, a]) => ({ s, ...rate(a) })).sort((x, y) => y.w - x.w).slice(0, 3);
    const good = la >= 1.2 && lz >= 1.2 && all.w > base.w, bad = fa >= 1.2 && fz >= 1.2 && all.l > base.l; const tw = tOf(L, 'w', base.w), tl = tOf(L, 'l', base.l);
    return { ...all, lift, fl, a, z, good, bad, tw, tl, sure: good ? (tw != null && tw >= 3) : bad ? (tl != null && tl >= 3) : false, chart, ent, failDays: q(L.filter((r) => r[3] === 'l').map((r) => r[5]).filter((v) => v != null), 0.5) };
  };
  const one = []; for (const [k, ids] of idx) { const j = judge(ids); if (j) one.push({ k, ko: kko(k), ...j }); }
  one.sort((a, b) => b.lift - a.lift);
  const cand = one.filter((x) => x.lift >= 1.1).slice(0, 25).map((x) => x.k), pairs = [];
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) { const s2 = new Set(idx.get(cand[j])); const ids = idx.get(cand[i]).filter((x) => s2.has(x)); const r = judge(ids); if (r && r.good) pairs.push({ k: cand[i] + '+' + cand[j], ko: kko(cand[i]) + ' + ' + kko(cand[j]), ...r }); }
  pairs.sort((a, b) => (b.sure ? 1 : 0) - (a.sure ? 1 : 0) || b.lift - a.lift);
  return { n: N, cut, base, cov, good: one.filter((x) => x.good), bad: one.filter((x) => x.bad).sort((a, b) => b.fl - a.fl), pairs: pairs.slice(0, 12), all: one.slice(0, 60), ko: DF_KO };
}
export async function discReport() {
  const { partsLoad } = await import('./btstore.mjs');
  const R = await partsLoad('mp/bt/disc');
  return { ...discStudy(R?.list || []), v: R?.v || null };
}

/** v248 💰 세력 원가 원문 미리 받기 (GK: '세력 원가 정보가 일부 종목에만 있는 문제는 중요')
 *  과거 재현은 원문을 캐시에서만 읽음 → 4년치 CB·3자배정·유상증자·경영권·5% 공시 원문 가격을 미리 받아 둠
 *  3분 크론 · 한 번 45초·2개씩 · 하루 6,000건 · DB 느리면/정기 분석 중이면 쉼 · 1바퀴(지금 있는 공시) → 깊은 채우기 끝나면 2바퀴(옛 공시)
 *  종목: 지금 시총 2조 미만(스팩 제외) + 랭킹 먼저 */
const CF_V = 1, CF_KINDS = ['cb', 'refix', 'rights3', 'rights', 'mna', 'fund5'];
export async function costFillStep({ budgetMs = 35000, par = 3, dayMax = 9000 } = {}) {
  const { getJSON, setJSON } = await import('./store.mjs');
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 500) return { skip: 'db slow' };
  if (Math.floor(Date.now() / 180e3) % 2 === 0) { const ep = await getJSON('mp/entpre').catch(() => null); if (ep && !ep.done) return { skip: 'entpre turn' }; } // v250: 차트만 먼저와 3분씩 번갈아 (동시에 돌면 DB 부담)
  const ms = await getJSON('mp/state').catch(() => null); if ((ms?.busyUntil || 0) > Date.now()) return { skip: 'radar busy' };
  let st = await getJSON('mp/costfill').catch(() => null);
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (!st || st.v !== CF_V) {
    const idx = (await getJSON('mp/idx').catch(() => null)) || [];
    let snap = null; for (const d of idx.slice(0, 5)) { snap = (await getJSON(`mp/snap/${d}`).catch(() => null))?.rows; if (snap) break; }
    if (!snap) return { skip: 'no snap' };
    const rank = (await getJSON('mp/rank').catch(() => null)) || {};
    const q = Object.entries(snap).filter(([c, r]) => { const v = r?.[6]; const eok = v > 1e7 ? v / 1e8 : v; return /^\d{6}$/.test(c) && !/스팩|SPAC/i.test(r?.[0] || '') && eok > 0 && eok < 20000; }).map(([c]) => c).sort((a, b) => (rank[a] ? 0 : 1) - (rank[b] ? 0 : 1) || (a < b ? -1 : 1));
    st = { v: CF_V, queue: q, pos: 0, round: 1, got: 0, had: 0, fail: 0, day: today, dn: 0, started: Date.now() };
    await setJSON('mp/costfill', st); return { started: q.length };
  }
  if (st.day !== today) { st.day = today; st.dn = 0; }
  if (st.pos >= st.queue.length) {
    const bf = await getJSON('backfill/state').catch(() => null);
    if (st.round === 1 && bf?.deep?.done) { st.round = 2; st.pos = 0; await setJSON('mp/costfill', st); return { round: 2 }; }
    if (!st.done && st.round === 2) { st.done = true; st.doneAt = Date.now(); await setJSON('mp/costfill', st); }
    return null;
  }
  if (st.dn >= dayMax) return { skip: 'day max' };
  const M = await import('./manip.mjs');
  const now = Date.now(); let n = 0, codes = 0;
  while (st.pos < st.queue.length && Date.now() - t0 < budgetMs && st.dn < dayMax && codes++ < 20) { // 한 번에 20종목까지 (DB 부담)
    const code = st.queue[st.pos];
    const evs = (await M._eventsOf(code, now, { days: 1640 }).catch(() => [])).filter((e) => CF_KINDS.includes(e.kind) && e.id);
    const need = [];
    for (const e of evs) { const c = await getJSON(`mp/px/${e.id}`).catch(() => null); if (c) st.had++; else need.push(e); }
    let i = 0, cut = false;
    for (; i < need.length; i += par) {
      if (Date.now() - t0 > budgetMs || st.dn >= dayMax) { cut = true; break; }
      const res = await Promise.all(need.slice(i, i + par).map((e) => M._docPrice(e).then((p) => (p ? 1 : 0)).catch(() => 0)));
      for (const ok of res) { st.dn++; n++; if (ok) st.got++; else st.fail++; }
    }
    if (cut) break; // 다음 차례에 같은 종목부터 (받은 건 캐시라 건너뜀)
    st.pos++;
  }
  st.at = Date.now();
  await setJSON('mp/costfill', st);
  return { pos: st.pos, of: st.queue.length, round: st.round, docs: n, got: st.got, fail: st.fail };
}

// 작전 레이더 보강 기능
//  ① 성적표: 레이더가 판정한 뒤 실제 5·20·60거래일 수익률 (단계·상승/하락 분류별 평균·적중률)
//  ② 같은 세력 추적: 같은 투자조합·인물(공시 제출인·인수자)이 여러 종목에 나오는지
//  ③ 거래소 시장경보: 투자주의·경고·위험 지정 (KIND)
//  ④ 관리자 텔레그램 알림: 단계 변화·상승/하락 분류 변화·전환청구 공시
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities } from './util.mjs';

const DAY = 86400e3;
const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// ───── ① 성적표 ─────
async function bars(code) { return (await import('./manip.mjs'))._bars(code); } // v219: 약 1년 2개월치 일봉(시가·고가·저가·거래량 포함) — 120거래일 결과용
const H = [5, 20, 60, 120]; // v219: 120거래일(약 6개월) 추가
// v218 성적표 계산 기준 (실제 매매에 가깝게)
//  · 진입: 판정한 '다음 날 시가' (장 마감 뒤 판정이라 그날 종가엔 못 삼) · 그날 종가 대비 갭도 기록
//  · N거래일 '안'의 최고(고가)·최저(저가), N거래일째 종가 수익률(수수료·세금 0.25% 뺌)
//  · 같은 기간 시장(코스피·코스닥) 대비 초과 수익
//  · +20%와 −10% 중 먼저 닿은 쪽(같은 날이면 손절 먼저)과 +20%까지 걸린 거래일 · 그 종목의 1차 목표가·손절선 중 먼저 닿은 쪽
//  · 60거래일 전에 거래가 끊기면(정지·상폐) '손절 먼저'로 보수적으로 셈
export const FT_UP = 20, FT_DN = -10, COST = 0.25;
// v219 성공·실패 이유: +20%(성공)·−10%(실패) 중 먼저 닿은 날까지 그 사이에 무슨 일이 있었는지 (공시·시장·갭·거래량·흔들기)
export const WHY_KO = { 'f:conv': '전환청구(물량 출회)', 'f:sell': '최대주주·주요주주 지분 매도', 'f:pledge': '주식 담보·반대매매', 'f:fail': '증자·사채 철회·납입 연기', 'f:risk': '위험 공시(벌점·횡령·감사 등)', 'f:tsell': '자사주 처분', 'f:dil': '추가 증자·CB(희석)', 'f:mkt': '시장 급락(지수 −5%↓)', 'f:gap': '추격 매수(다음 날 +10%↑ 갭)', 'f:shake': '흔들기(손절 뒤 +20% 반등)', 'f:stop': '거래정지·상장폐지', 'f:drift': '뚜렷한 이유 없이 흘러내림',
  's:news': '재료 공시(계약·MOU·투자)', 's:bonus': '무상증자', 's:setup': '추가 판 깔기 공시', 's:hot': '조회공시·시황 급변', 's:mkt': '시장 상승(지수 +5%↑)', 's:vol': '거래량 폭증(평소 5배↑)', 's:plain': '공시 없이 수급으로 상승' };
export function outcomeWhy(B, i, ps, evs = [], opt = {}) {
  if (!ps?.ft || ps.ft === 'n') return null;
  const win = ps.ft === 'w', out = new Set();
  let kEnd = Math.min(B.length - 1, i + 60);
  const entry = B[i + 1]?.o || B[i + 1]?.c; if (!entry) return null;
  for (let k = i + 1; k <= Math.min(B.length - 1, i + 60); k++) { if (win ? (B[k].h ?? B[k].c) >= entry * 1.2 : (B[k].l ?? B[k].c) <= entry * 0.9) { kEnd = k; break; } }
  const t0 = Date.parse(B[i].d + 'T15:40:00+09:00'), t1 = Date.parse(B[kEnd].d + 'T23:59:00+09:00');
  const inW = (evs || []).filter((e) => e.ms > t0 && e.ms <= t1);
  const has = (...k) => inW.some((e) => k.includes(e.kind));
  if (win) {
    if (has('contract', 'invest')) out.add('s:news');
    if (has('bonus')) out.add('s:bonus');
    if (has('mna', 'rights3', 'cb', 'fund5', 'purpose', 'refix')) out.add('s:setup');
    if (has('inquiry')) out.add('s:hot');
  } else {
    if (has('conv')) out.add('f:conv');
    if (has('majsell', 'insider') && inW.some((e) => e.kind === 'majsell')) out.add('f:sell');
    if (has('pledge')) out.add('f:pledge');
    if (has('fail')) out.add('f:fail');
    if (has('risk')) out.add('f:risk');
    if (has('tsell')) out.add('f:tsell');
    if (has('rights', 'rights3', 'cb')) out.add('f:dil');
    if ((ps.gp ?? 0) >= 10) out.add('f:gap');
    if (ps.stop) out.add('f:stop');
    if ((ps.u60 ?? 0) >= 20) out.add('f:shake');
  }
  if (opt.ix) { let m = 1; for (let k = i + 1; k <= kEnd; k++) { const p = opt.ix[B[k].d]?.[opt.mkt === 'P' ? 'P' : 'Q']; if (p != null) m *= 1 + p / 100; } const ir = (m - 1) * 100; if (win && ir >= 5) out.add('s:mkt'); if (!win && ir <= -5) out.add('f:mkt'); }
  if (win) { const v20 = B.slice(Math.max(0, i - 19), i + 1).map((b) => b.v || 0); const av = v20.reduce((a, b) => a + b, 0) / (v20.length || 1); if (av && B.slice(i + 1, kEnd + 1).some((b) => (b.v || 0) >= av * 5)) out.add('s:vol'); }
  if (!out.size) out.add(win ? 's:plain' : 'f:drift');
  return [...out];
}
export function pathStats(B, i, opt = {}) {
  const c0 = B[i]?.c, e0 = B[i + 1];
  if (!c0 || !e0) return {};
  const entry = e0.o || e0.c;
  const out = { gp: Math.round((entry / c0 - 1) * 1000) / 10 };
  const ixRet = (from, to) => { if (!opt.ix) return null; let m = 1, n = 0; for (let k = from; k <= to; k++) { const p = opt.ix[B[k].d]?.[opt.mkt === 'P' ? 'P' : 'Q']; if (p != null) { m *= 1 + p / 100; n++; } } return n ? (m - 1) * 100 : null; };
  for (const h of H) {
    const e = i + h; if (!B[e]) continue;
    let hi = -Infinity, lo = Infinity;
    for (let k = i + 1; k <= e; k++) { hi = Math.max(hi, B[k].h ?? B[k].c); lo = Math.min(lo, B[k].l ?? B[k].c); }
    const r = (B[e].c / entry - 1) * 100 - COST;
    out['r' + h] = Math.round(r * 10) / 10;
    out['u' + h] = Math.round((hi / entry - 1) * 1000) / 10; out['d' + h] = Math.round((lo / entry - 1) * 1000) / 10;
    const ir = ixRet(i + 1, e); if (ir != null) out['x' + h] = Math.round((r - ir) * 10) / 10;
  }
  const touch = (up, dn) => { for (let k = i + 1; k < Math.min(B.length, i + 61); k++) { const H1 = B[k].h ?? B[k].c, L1 = B[k].l ?? B[k].c; if (L1 <= dn) return { r: 'l', k }; if (H1 >= up) return { r: 'w', k }; } return null; };
  const stopped = B.length < i + 61 && opt.now && Date.parse(B[B.length - 1].d) < opt.now - 10 * DAY; // 60일 전에 거래가 끊김
  const t1 = touch(entry * (1 + FT_UP / 100), entry * (1 + FT_DN / 100));
  if (t1) { out.ft = t1.r; if (t1.r === 'w') out.ftd = t1.k - i; } else if (B[i + 60]) out.ft = 'n'; else if (stopped) { out.ft = 'l'; out.stop = 1; }
  if (opt.tp > entry && opt.sp > 0 && opt.sp < entry) { const t2 = touch(opt.tp, opt.sp); if (t2) out.ft2 = t2.r; else if (B[i + 60]) out.ft2 = 'n'; else if (stopped) out.ft2 = 'l'; }
  return out;
}
/** 크론: 판정한 날 이후 5·20·60거래일이 지난 종목의 실제 수익률을 채움 (한 번에 최대 20종목) */
export async function perfWatch(max = 20) {
  const idx = ((await getJSON('mp/idx')) || []).slice().sort(); // 오래된 날부터
  const today = kstDate();
  const cache = new Map();
  let fetched = 0, filled = 0;
  const ixd = await (await import('./manip.mjs')).indexDaily().catch(() => null); // 시장 대비 수익률용
  for (const date of idx) {
    if (date >= today) continue;
    const age = (Date.parse(today) - Date.parse(date)) / DAY;
    if (age < 7) continue; // 5거래일도 안 지났으면 아직
    const pk = `mp/perf/${date}`;
    const perf = (await getJSON(pk)) || { rows: {} };
    if (perf.done) continue;
    const doc = await getJSON(`mp/day/${date}`);
    if (!doc?.list?.length) { perf.done = true; await setJSON(pk, perf); continue; }
    let pending = 0;
    const tdays = Math.floor(age * 5 / 7) - 1; // 지난 거래일 수(대략, 휴일 무시 → 조금 적게 잡음)
    for (const x of doc.list.slice(0, 80)) {
      let row = perf.rows[x.code];
      if (!row) {
        row = { n: x.name || null, st: x.stage, dir: x.dir?.dir || null, lv: x.ai?.level || null, s: x.score, ck: x.cl?.grade || null, rr: x.dir?.rr?.v ?? null, tp: x.dir?.rr?.t ?? null, sp: x.dir?.rr?.s ?? null };
        // 패턴 찾기용 특징 (매매 후보 조건 충족 여부·털기 후 상승·매집봉 수)
        try { const M = await import('./manip.mjs'); const rk = M.rankRow({ ...x, pex: x.pex || M.postExitOf(x), cl: x.cl || M.checklistOf(x) }); row.pk = M.pickFails(rk).length ? 0 : 1; row.vd = M.verdictOf(rk)?.c || null; row.pexl = rk.pex?.lv || null; row.cm = rk.cm || 0; row.gp = rk.gap ?? null; const clx = x.cl || M.checklistOf(x); row.ckv = Object.fromEntries((clx?.pos || []).filter((i) => i.ok != null).map((i) => [i.k, i.ok ? 1 : 0])); row.ws = clx?.ws ?? null; } catch {}
      }
      if (H.every((h) => row['r' + h] !== undefined)) { perf.rows[x.code] = row; continue; }
      // 아직 다음 기간(5·20·60거래일)이 안 지났으면 받지 않음 (같은 종목만 계속 받느라 다른 종목·날짜가 밀리던 문제)
      const due = H.some((h) => row['r' + h] === undefined && tdays >= h);
      if (!due && age <= 200) { pending++; perf.rows[x.code] = row; continue; }
      if (fetched >= max && !cache.has(x.code)) { pending++; continue; }
      let B = cache.get(x.code);
      if (!B) { try { B = await bars(x.code); } catch { B = null; } cache.set(x.code, B); fetched++; }
      if (!B || !B.length) { pending++; perf.rows[x.code] = row; continue; } // 일봉을 못 받았으면 다음에 다시 (빈 값으로 영구 저장하지 않음)
      let i = -1; for (let k = 0; k < B.length; k++) if (B[k].d <= date) i = k;
      if (i < 0) { for (const h of H) row['r' + h] = null; perf.rows[x.code] = row; continue; } // 일봉 범위 밖
      row.c0 = B[i].c;
      { const ps = pathStats(B, i, { ix: ixd, mkt: x.mkt, tp: row.tp, sp: row.sp, now: Date.now() }); // v218: 다음 날 시가 진입·기간 중 최고/최저·시장 대비·먼저 닿은 쪽
        for (const h of H) if (row['r' + h] === undefined && ps['r' + h] != null) filled++;
        for (const [k, v] of Object.entries(ps)) if (!/^r\d/.test(k) || row[k] === undefined) row[k] = v;
        if (row.ft && row.ft !== 'n' && !row.wy) { try { const M = await import('./manip.mjs'); const evs = await M._eventsOf(x.code, Date.now()); row.wy = outcomeWhy(B, i, row, evs, { ix: ixd, mkt: x.mkt }); } catch {} } } // v219 성공·실패 이유
      if (age > 200) for (const h of H) if (row['r' + h] === undefined) row['r' + h] = null; // 너무 오래돼 일봉에 없음
      if (H.some((h) => row['r' + h] === undefined)) pending++;
      perf.rows[x.code] = row;
    }
    if (!pending) perf.done = true;
    perf.at = Date.now();
    await setJSON(pk, perf);
    if (fetched >= max) break;
  }
  return fetched || filled ? { fetched, filled } : null;
}
/** 단계별·분류별 평균 수익률·상승 비율 */
// 성적표 한 줄 → 묶을 그룹 이름들 (성적표·과거 재현 백테스트가 같이 씀)
export function perfGroupKeys(row) {
  const k = ['전체'];
  if (row.st) k.push('단계:' + row.st);
  if (row.dir) k.push('분류:' + (row.dir === 'up' ? '상승 가능성' : row.dir === 'down' ? '하락 위험' : '분류 없음'));
  if (row.lv) k.push('AI 의심:' + row.lv);
  if (row.ck) k.push('체크리스트:' + row.ck + '등급');
  if (row.rr != null) k.push('손익비:' + (row.rr >= 3 ? '3 이상' : row.rr >= 2 ? '2~3' : '2 미만'));
  if (row.pk != null) k.push('매매 후보 조건:' + (row.pk ? '충족' : '미충족'));
  if (row.vd) k.push('한 줄 결론:' + ({ g: '🟢 매수 검토', y: '🟡 지켜보기', r: '🔴 피하기' }[row.vd]));
  if (row.pexl) k.push('털기 후 상승:' + row.pexl);
  if (row.cm != null) k.push('매집봉:' + (row.cm > 0 ? '있음' : '없음'));
  for (const [kk, v] of Object.entries(row.ckv || {})) k.push(`ck:${kk}:${v}`); // 체크리스트 항목별 (중요도 자동 조정용)
  return k;
}
export function perfAdd(groups, g, row) {
  const o = (groups[g] ||= { n: 0 });
  o.n++;
  for (const h of H) { const u = row['u' + h], dd = row['d' + h]; if (u != null && dd != null) { o['pn' + h] = (o['pn' + h] || 0) + 1; o['su' + h] = (o['su' + h] || 0) + u; o['sd' + h] = (o['sd' + h] || 0) + dd; if (u >= 20) o['hu' + h] = (o['hu' + h] || 0) + 1; if (dd <= -15) o['hd' + h] = (o['hd' + h] || 0) + 1; } }
  if (row.ft) { o.ftn = (o.ftn || 0) + 1; if (row.ft === 'w') { o.ftw = (o.ftw || 0) + 1; if (row.ftd) o.ftds = (o.ftds || 0) + row.ftd; } if (row.ft === 'l') o.ftl = (o.ftl || 0) + 1; if (row.stop) o.stp = (o.stp || 0) + 1; }
  if (row.ft2) { o.f2n = (o.f2n || 0) + 1; if (row.ft2 === 'w') o.f2w = (o.f2w || 0) + 1; if (row.ft2 === 'l') o.f2l = (o.f2l || 0) + 1; }
  if (row.gp != null) { o.gpn = (o.gpn || 0) + 1; o.gps = (o.gps || 0) + row.gp; }
  if (row.wy?.length) { const W = (o.wy ||= {}); for (const k of row.wy) W[k] = (W[k] || 0) + 1; }
  for (const h of [20, 60, 120]) for (const [K, f] of [['R', 'r'], ['U', 'u'], ['X', 'x']]) { const v = row[f + h]; if (v != null) { const a = (o[K + h] ||= []); if (a.length < 4000) a.push(v); } } // 중앙값용
  for (const h of H) if (row['x' + h] != null) { o['xn' + h] = (o['xn' + h] || 0) + 1; o['xs' + h] = (o['xs' + h] || 0) + row['x' + h]; }
  for (const h of H) { const v = row['r' + h]; if (v == null) continue; o['n' + h] = (o['n' + h] || 0) + 1; o['s' + h] = (o['s' + h] || 0) + v; if (v > 0) o['w' + h] = (o['w' + h] || 0) + 1; if (v >= 20) o['b' + h] = (o['b' + h] || 0) + 1; if (v <= -20) o['l' + h] = (o['l' + h] || 0) + 1; }
}
export function perfOut(groups) {
  return Object.entries(groups).map(([g, o]) => {
    const r = { g, n: o.n };
    for (const h of H) if (o['pn' + h]) { r['up' + h] = Math.round((o['su' + h] / o['pn' + h]) * 10) / 10; r['dn' + h] = Math.round((o['sd' + h] / o['pn' + h]) * 10) / 10; r['hu' + h] = Math.round(((o['hu' + h] || 0) / o['pn' + h]) * 100); r['hd' + h] = Math.round(((o['hd' + h] || 0) / o['pn' + h]) * 100); }
    if (o.ftn) { r.ftn = o.ftn; r.ftw = Math.round(((o.ftw || 0) / o.ftn) * 100); r.ftl = Math.round(((o.ftl || 0) / o.ftn) * 100); r.ftd = o.ftw ? Math.round((o.ftds || 0) / o.ftw) : null; r.stp = o.stp || 0; }
    if (o.f2n) { r.f2n = o.f2n; r.f2w = Math.round(((o.f2w || 0) / o.f2n) * 100); r.f2l = Math.round(((o.f2l || 0) / o.f2n) * 100); }
    if (o.gpn) r.gap = Math.round((o.gps / o.gpn) * 10) / 10;
    if (o.wy) { const top = (pre, n) => Object.entries(o.wy).filter(([k]) => k.startsWith(pre)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => [k, n ? Math.round((c / n) * 100) : 0]); r.whyW = top('s:', o.ftw || 0); r.whyL = top('f:', o.ftl || 0); }
    const med = (a) => { if (!a?.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return Math.round((b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) * 10) / 10; };
    for (const h of [20, 60, 120]) { r['mr' + h] = med(o['R' + h]); r['mu' + h] = med(o['U' + h]); r['mx' + h] = med(o['X' + h]); }
    for (const h of H) if (o['xn' + h]) r['ax' + h] = Math.round((o['xs' + h] / o['xn' + h]) * 10) / 10;
    for (const h of H) if (o['n' + h]) { r['n' + h] = o['n' + h]; r['avg' + h] = Math.round((o['s' + h] / o['n' + h]) * 10) / 10; r['win' + h] = Math.round(((o['w' + h] || 0) / o['n' + h]) * 100); r['big' + h] = Math.round(((o['b' + h] || 0) / o['n' + h]) * 100); r['loss' + h] = Math.round(((o['l' + h] || 0) / o['n' + h]) * 100); }
    return r;
  });
}
export async function perfSummary() {
  const idx = (await getJSON('mp/idx')) || [];
  const groups = {};
  let days = 0, raw = 0, dup = 0;
  // 같은 종목이 같은 단계로 랭킹에 며칠씩 계속 있으면 하루마다 따로 세지 않고 '처음 그 단계로 판정된 날' 1번만 셈
  //  (종목 몇 개가 승률을 부풀리던 문제) · 30일 넘게 안 보이다 다시 나오거나 단계가 바뀌면 새 판정으로 다시 셈
  const last = new Map();
  for (const d of idx.slice().sort()) {
    const perf = await getJSON(`mp/perf/${d}`);
    if (!perf?.rows) continue;
    days++;
    const dMs = Date.parse(d);
    for (const [code, row] of Object.entries(perf.rows)) {
      raw++;
      const k = `${code}|${row.st || '-'}`, prevMs = last.get(k);
      last.set(k, dMs);
      if (prevMs != null && dMs - prevMs <= 30 * DAY) { dup++; continue; }
      for (const g of perfGroupKeys(row)) perfAdd(groups, g, row);
    }
  }
  return { days, raw, dup, groups: perfOut(groups), at: Date.now() };
}

// ───── ② 같은 세력 추적 ─────
//  공시 제출인(5% 보고·최대주주 등)과 최대주주 변경의 새 최대주주 이름을 모아, 2개 이상 종목에 나오는 이름을 연결
// 세력이 아닌 기관(거래소 시장본부·감독기관·예탁원 등)은 '같은 세력 연결'에서 뺌 — 불성실공시 지정 등 공시 제출자가 '코스닥시장본부'로 잡혀 엉뚱한 종목끼리 연결되던 문제
export const BIG = /시장본부|거래소|금융위원회|금융감독원|증권선물위원회|예탁결제원|증권금융|법원|국세청|공정거래위원회|코스닥협회|상장회사협의회|국민연금|자산운용|증권|은행|보험|캐피탈|공제회|투자신탁|우리사주|한국투자|미래에셋|삼성|신한|KB|NH|하나|IBK|산업은행|수출입은행|예금보험|한국거래소|BlackRock|Vanguard|Morgan|Goldman|JP ?Morgan|Citi|UBS|Norges|Templeton|Fidelity|Capital Group/i;
export function partyKey(name) {
  const n = String(name || '').replace(/\(주\)|㈜|주식회사|유한회사|합자회사|\s|\.|,/g, '').replace(/[()（）]/g, '').trim();
  return n.length >= 2 ? n.toUpperCase() : null;
}
export function partiesOf(evs) {
  const out = new Map();
  for (const e of evs || []) {
    const names = [];
    if (e.party) names.push(e.party);
    const m = String(e.sum || '').match(/→\s*([^(·]+)/); // '최대주주 변경 A → B (12%)'
    if (m && e.kind === 'mna') names.push(m[1].trim());
    for (const nm of names) {
      if (!nm || BIG.test(nm)) continue;
      const k = partyKey(nm);
      if (k && !out.has(k)) out.set(k, { name: nm.trim().slice(0, 40), kind: e.kind, ms: e.ms });
    }
  }
  return out;
}
/** 전 종목 공시에서 이름 → 등장 종목 목록 */
export function buildPartyIndex(evByCode, names = {}) {
  const idx = {};
  for (const [code, evs] of Object.entries(evByCode)) {
    for (const [k, v] of partiesOf(evs)) (idx[k] ||= { n: v.name, list: [] }).list.push({ c: code, nm: names[code] || null, d: kstDate(v.ms), k: v.kind });
  }
  for (const k of Object.keys(idx)) if (idx[k].list.length < 2) delete idx[k];
  return idx;
}
export function linksOf(code, evs, pidx) {
  const out = [];
  for (const [k, v] of partiesOf(evs)) {
    const p = pidx?.[k];
    if (!p) continue;
    const others = p.list.filter((y) => y.c !== code);
    if (others.length) out.push({ who: v.name, others: others.slice(0, 6) });
  }
  return out.slice(0, 5);
}

// ───── ③ 거래소 시장경보 (투자주의·경고·위험) ─────
const LV = { 1: '투자주의', 2: '투자경고', 3: '투자위험' };
async function kindWarn(menu) {
  const end = kstDate(), start = kstDate(Date.now() - 30 * DAY);
  const body = new URLSearchParams({ method: 'investattentwarnriskySub', currentPageSize: '300', pageIndex: '1', orderMode: '4', orderStat: 'D', searchCodeType: '', searchCorpName: '', repIsuSrtCd: '', menuIndex: String(menu), forward: 'invstattentwarnrisky_sub', marketType: '', startDate: start, endDate: end });
  const r = await fetchWithTimeout('https://kind.krx.co.kr/investwarn/investattentwarnrisky.do', { method: 'POST', headers: { 'User-Agent': BROWSER_UA, Referer: 'https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: body.toString() }, 12000);
  if (!r.ok) throw new Error('KIND HTTP ' + r.status);
  const html = decodeText(await r.arrayBuffer(), /utf-?8/i.test(r.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const out = [];
  for (const tr of rows) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((c) => decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (cells.length < 3) continue;
    const name = (tr.match(/title="([^"]+)"/) || [])[1] || cells[1];
    const date = cells.find((c) => /^20\d{2}-\d{2}-\d{2}$/.test(c)) || null;
    const code = (tr.match(/['"](\d{6})['"]/) || [])[1] || null;
    if (name) out.push({ name: name.trim(), code, date });
  }
  return out;
}
// 거래소 KIND가 서버 접속을 막아(HTTP 403) → 한국투자증권(KIS) 현재가 조회의 종목 상태로 대신 확인
//  · 시장경고(투자주의·경고·위험) · 관리종목 · 투자유의 · 거래정지 · 업종명
//  · 랭킹·내 세력주 종목을 거래일 아침(8시 이후) 한 번, 3분에 20종목씩 확인 · 업종이 비어 있는 종목도 조금씩 채움
const KIS_LV = { '01': [1, '투자주의'], '02': [2, '투자경고'], '03': [3, '투자위험'] };
export function kisStatus(o = {}) {
  const st = String(o.iscd_stat_cls_code || '');
  const warn = KIS_LV[String(o.mrkt_warn_cls_code || '').padStart(2, '0')] || (st === '52' ? [3, '투자위험'] : st === '53' ? [2, '투자경고'] : st === '54' ? [1, '투자주의'] : null);
  const mg = o.mang_issu_cls_code === 'Y' || st === '51';
  const halt = o.temp_stop_yn === 'Y' || st === '58' || o.sltr_yn === 'Y';
  const caution = o.invt_caful_yn === 'Y';
  const lv = warn ? warn[1] : mg ? '관리종목' : caution ? '투자유의' : null;
  const m = warn ? warn[0] : mg ? 2 : caution ? 1 : 0;
  return { lv, m, mg, halt, caution, sector: o.bstp_kor_isnm || null };
}
export async function kisWarnWatch(per = 20) {
  const { hasKis, kisGet } = await import('./kis.mjs');
  if (!hasKis()) return null;
  const now = Date.now(), k = new Date(now + 9 * 3600e3), today = kstDate(now), hm = k.getUTCHours() * 60 + k.getUTCMinutes();
  const st = (await getJSON('mp/warn')) || {};
  const sc = st.scan || {};
  const done = sc.date === today && sc.pos >= (sc.q || []).length;
  // 새 거래일 아침 8시 이후(또는 아직 한 번도 안 했으면) 확인 목록을 새로 만듦
  if (sc.date !== today && (hm >= 8 * 60 || !sc.date)) {
    const { isTradingDay } = await import('./schedule.mjs').catch(() => ({}));
    if (!isTradingDay || isTradingDay('KR', today) || !sc.date) {
      const rank = (await getJSON('mp/rank')) || {};
      const my = ((await getJSON('mp/my'))?.items || []).filter((i) => !i.closed).map((i) => i.code);
      const q = [...new Set([...my, ...Object.entries(rank).filter(([, r]) => now - (r.up || 0) < 45 * DAY).sort((a, b) => (b[1].s || 0) - (a[1].s || 0)).map(([c]) => c)])].slice(0, 300);
      st.scan = { date: today, q, pos: 0, map: {}, err: 0, at: now };
      await setJSON('mp/warn', st);
      return { start: q.length };
    }
  }
  if (sc.date === today && !done) {
    const part = sc.q.slice(sc.pos, sc.pos + per);
    const secFill = {};
    for (const code of part) {
      try {
        const o = (await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code })).output || {};
        const x = kisStatus(o);
        if (x.lv || x.halt) sc.map[code] = { m: x.m, lv: x.lv || '거래정지', date: today, mg: x.mg || undefined, halt: x.halt || undefined, src: 'KIS' };
        if (x.sector) secFill[code] = x.sector;
      } catch { sc.err = (sc.err || 0) + 1; }
    }
    sc.pos += part.length;
    if (Object.keys(secFill).length) await fillSectors(secFill);
    if (sc.pos >= sc.q.length) {
      // 다 확인했으면 이번 결과로 교체 (확인 실패가 너무 많으면 이전 결과 유지)
      const ok = sc.err < sc.q.length * 0.5;
      st.map = ok ? sc.map : st.map || {};
      st.at = now; st.n = Object.keys(st.map).length; st.src = 'KIS';
      st.err = ok ? (sc.err ? `KIS 조회 실패 ${sc.err}종목` : null) : `KIS 조회 실패 ${sc.err}/${sc.q.length} — 이전 결과 유지`;
    }
    st.scan = sc;
    await setJSON('mp/warn', st);
    return { pos: sc.pos, of: sc.q.length, flagged: Object.keys(sc.map).length };
  }
  // 오늘 확인을 끝냈으면 업종이 비어 있는 종목을 조금씩 채움 (전 종목 시세 목록 기준)
  return fillMissingSectors(kisGet, per);
}
async function fillSectors(add) {
  const cur = (await getJSON('sectors/krfill')) || {};
  let n = 0; for (const [c, v] of Object.entries(add)) if (v && cur[c] !== v) { cur[c] = v; n++; }
  if (n) await setJSON('sectors/krfill', cur).catch(() => {});
}
async function fillMissingSectors(kisGet, per) {
  const fs = (await getJSON('mp/secfill')) || {};
  if (Date.now() - (fs.at || 0) < 6 * 60e3) return null; // 6분에 한 번만
  const idx = (await getJSON('mp/idx')) || [];
  const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows || {} : {};
  const { getSectors } = await import('./sectors.mjs');
  const sec = (await getSectors({ allowFetch: false }))?.kr || {};
  const miss = Object.keys(snap).filter((c) => !sec[c] && !(fs.bad || []).includes(c)).slice(0, per);
  if (!miss.length) { await setJSON('mp/secfill', { ...fs, at: Date.now(), left: 0 }).catch(() => {}); return null; }
  const add = {}, bad = [...(fs.bad || [])];
  for (const code of miss) {
    try { const o = (await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code })).output || {}; if (o.bstp_kor_isnm) add[code] = o.bstp_kor_isnm; else bad.push(code); } catch { bad.push(code); }
  }
  await fillSectors(add);
  await setJSON('mp/secfill', { at: Date.now(), bad: bad.slice(-500), left: Object.keys(snap).filter((c) => !sec[c]).length - Object.keys(add).length }).catch(() => {});
  return { sectors: Object.keys(add).length };
}
/** 크론(하루 2번): code → { lv, name, date } (최근 30일 지정) — KIND (서버 접속이 막히면 KIS 쪽 kisWarnWatch가 대신함) */
export async function warnWatch(nameToCode = {}) {
  if (((await getJSON('mp/warn'))?.src) === 'KIS') return null; // KIS로 확인 중이면 막힌 KIND는 다시 부르지 않음
  const st = (await getJSON('mp/warn')) || {};
  if (Date.now() - (st.at || 0) < 6 * 3600e3) return null;
  const map = {};
  const err = [];
  for (const menu of [1, 2, 3]) {
    try {
      for (const x of await kindWarn(menu)) {
        const code = x.code || nameToCode[x.name];
        if (!code) continue;
        if (!map[code] || menu > map[code].m) map[code] = { m: menu, lv: LV[menu], date: x.date, name: x.name };
      }
    } catch (e) { err.push(`${LV[menu]}: ${e.message}`); }
  }
  const next = { at: Date.now(), map: Object.keys(map).length || !st.map ? map : st.map, err: err.length ? err.join(' / ').slice(0, 200) : null, n: Object.keys(map).length };
  await setJSON('mp/warn', next);
  return { n: next.n, err: next.err };
}

// ───── ④ 관리자 텔레그램 알림 ─────
export async function radarAlert(lines, codes = [], opt = {}) {
  if (!lines.length) return false;
  // 사이트 '🔔 알림 기록'에 남김 (텔레그램이 꺼져 있거나 하루 한도를 넘어도 기록은 남음)
  try {
    const h = (await getJSON('mp/alerts')) || { list: [] };
    const at = Date.now();
    h.list = [...lines.map((t, i) => ({ at, t: String(t).replace(/^•\s*/, ''), c: codes[i] || null })), ...h.list].slice(0, 500);
    await setJSON('mp/alerts', h);
  } catch {}
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
  // 바로 보내지 않고 대기열에 넣은 뒤 보냄 → 실패(텔레그램 429 등)·한 번에 12줄 넘는 나머지도 다음 차례(매분)에 이어서 보냄
  const q = (await getJSON('mp/alertq')) || { items: [] };
  q.items.push({ at: Date.now(), title: opt.title || null, force: !!opt.force, lines: lines.map(String) });
  q.items = q.items.slice(-40);
  await setJSON('mp/alertq', q).catch(() => {});
  return flushAlertQ();
}
const ALERT_CAP = 80; // 하루 작전 레이더 알림 줄 수 한도 (내 포트폴리오 알림은 한도와 상관없이 보냄)
/** 대기 중인 알림을 텔레그램으로 (매분 크론에서도 불러 실패분을 이어서 보냄) */
export async function flushAlertQ() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
  const q = (await getJSON('mp/alertq')) || { items: [] };
  if (!q.items.length) return false;
  if (Date.now() - (q.lock || 0) < 50e3) return false; // 다른 실행이 보내는 중
  q.lock = Date.now(); await setJSON('mp/alertq', q).catch(() => {});
  const st = (await getJSON('mp/alert')) || {};
  const day = kstDate();
  if (st.day !== day) { st.day = day; st.n = 0; st.capMsg = false; }
  const { telegram } = await import('./monitor.mjs');
  let sentAny = false;
  for (let k = 0; k < 3 && q.items.length; k++) { // 한 번에 최대 3개 글
    const it = q.items[0];
    const room = it.force ? 12 : Math.max(0, ALERT_CAP - (st.n || 0));
    if (!room) {
      if (!st.capMsg) { const ok = await telegram(`🕵️ 작전 레이더 — 오늘 알림이 ${ALERT_CAP}줄을 넘었어요. 나머지는 사이트 🔔 알림 기록에서 보세요 · gk-stock.com/#radar`).catch(() => false); if (ok) st.capMsg = true; }
      q.items.shift(); continue; // 한도 넘은 일반 알림은 사이트 기록에만
    }
    const send = it.lines.slice(0, Math.min(room, 12));
    const ok = await telegram(`${it.title || '🕵️ 작전 레이더 알림 (관리자 전용)'}\n\n${send.join('\n')}\n\n※ 패턴 신호일 뿐 증거 아님 · gk-stock.com/#radar`).catch(() => false);
    if (!ok) { it.tries = (it.tries || 0) + 1; if (it.tries >= 5) q.items.shift(); break; } // 실패하면 다음 분에 다시 (5번 실패하면 포기)
    sentAny = true;
    if (!it.force) st.n = (st.n || 0) + send.length;
    it.lines = it.lines.slice(send.length);
    if (!it.lines.length) q.items.shift();
  }
  q.lock = 0;
  await setJSON('mp/alertq', q).catch(() => {});
  await setJSON('mp/alert', st).catch(() => {});
  return sentAny;
}

// ───── 📊 월간 규칙 점검 (매달 1일, 관리자 텔레그램) ─────
//  성적표(중복 제외 집계)로 그룹별 20거래일 승률을 정리하고, 결과가 거꾸로 나온 규칙에 ⚠ 표시
//  표본 30건 미만은 '아직 판단 이름' (우연한 숫자에 휘둘리지 않게)
export const RULE_MIN = 30;
export async function ruleCheck({ force = false, now = Date.now() } = {}) {
  const d = kstDate(now), month = d.slice(0, 7);
  const st = (await getJSON('mp/rulechk')) || {};
  if (!force) {
    if (d.slice(8) !== '01' || st.month === month) return null; // 매달 1일 한 번
    if (new Date(now + 9 * 3600e3).getUTCHours() < 9) return null; // 아침 9시 뒤
  }
  const sum = await perfSummary();
  const G = Object.fromEntries(sum.groups.map((g) => [g.g, g]));
  const ok = (g) => g && (g.n20 || 0) >= RULE_MIN;
  const fmt = (name, g) => (g?.n20 ? `${name}: ${g.ftn ? `+20% 먼저 ${g.ftw}% · −10% 먼저 ${g.ftl}% · ` : ''}20일 안 최고 평균 ${g.up20 != null ? (g.up20 > 0 ? '+' : '') + g.up20 + '%' : '-'} · 20일째 오른 비율 ${g.win20}% (${g.n20}건)${ok(g) ? '' : ' — 아직 판단 이름'}` : `${name}: 결과 없음`);
  const base = G['전체'];
  const lines = [], warns = [];
  lines.push(`기록 ${sum.days}일치 · 집계 ${(sum.raw || 0) - (sum.dup || 0)}건 (같은 종목 반복 ${sum.dup || 0}건 제외)`);
  lines.push(fmt('전체 평균', base));
  for (const k of ['A', 'B', 'C', 'D']) if (G['체크리스트:' + k + '등급']) lines.push(fmt(`체크 ${k}등급`, G['체크리스트:' + k + '등급']));
  for (const k of ['판 깔기', '매집', '띄우기', '털기', '엑시트 후']) if (G['단계:' + k]) lines.push(fmt(`단계 ${k}`, G['단계:' + k]));
  for (const k of ['상승 가능성', '하락 위험']) if (G['분류:' + k]) lines.push(fmt(`분류 ${k}`, G['분류:' + k]));
  if (G['매매 후보 조건:충족']) lines.push(fmt('🎯 매매 후보 조건 충족', G['매매 후보 조건:충족']));
  for (const k of ['🟢 매수 검토', '🟡 지켜보기', '🔴 피하기']) if (G['한 줄 결론:' + k]) lines.push(fmt(k, G['한 줄 결론:' + k]));
  for (const k of ['3 이상', '2~3', '2 미만']) if (G['손익비:' + k]) lines.push(fmt(`손익비 ${k}`, G['손익비:' + k]));
  { const gg = G['한 줄 결론:🟢 매수 검토'] || G['전체']; const t = (L) => (L || []).map(([k, p]) => `${WHY_KO[k] || k} ${p}%`).join(' · '); if (gg?.whyL?.length) lines.push(`${G['한 줄 결론:🟢 매수 검토'] ? '🟢' : '전체'} 실패 이유: ${t(gg.whyL)}`); if (gg?.whyW?.length) lines.push(`${G['한 줄 결론:🟢 매수 검토'] ? '🟢' : '전체'} 성공 이유: ${t(gg.whyW)}`); }
  // ⚠ 거꾸로 나온 규칙
  const wv = (g) => g.win20;
  const order = ['A', 'B', 'C', 'D'].map((k) => [k, G['체크리스트:' + k + '등급']]).filter(([, g]) => ok(g));
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (wv(order[i][1]) < wv(order[j][1]) - 3) warns.push(`⚠ 체크 ${order[i][0]}등급(${wv(order[i][1])}%)이 ${order[j][0]}등급(${wv(order[j][1])}%)보다 낮음 — 등급 기준 점검 필요`);
  const pk1 = G['매매 후보 조건:충족'], pk0 = G['매매 후보 조건:미충족'];
  if (ok(pk1) && ok(pk0) && wv(pk1) < wv(pk0)) warns.push(`⚠ 🎯 매매 후보(${wv(pk1)}%)가 조건 미충족 종목(${wv(pk0)}%)보다 낮음 — 후보 조건 점검 필요`);
  if (ok(base)) {
    const up = G['분류:상승 가능성'], dn = G['분류:하락 위험'];
    if (ok(up) && wv(up) < wv(base) - 5) warns.push(`⚠ '상승 가능성'(${wv(up)}%)이 전체 평균(${wv(base)}%)보다 낮음 — 상승 판단 규칙 점검 필요`);
    if (ok(dn) && wv(dn) > wv(base) + 5) warns.push(`⚠ '하락 위험'(${wv(dn)}%)이 전체 평균(${wv(base)}%)보다 오히려 많이 오름 — 하락 판단 규칙 점검 필요`);
    for (const k of ['판 깔기', '매집']) { const g = G['단계:' + k]; if (ok(g) && wv(g) < wv(base) - 10) warns.push(`⚠ 단계 '${k}'(${wv(g)}%)가 전체 평균(${wv(base)}%)보다 10%p 넘게 낮음 — 단계 판정 규칙 점검 필요`); }
  }
  const vg = G['한 줄 결론:🟢 매수 검토'], vr = G['한 줄 결론:🔴 피하기'];
  if (ok(vg) && ok(vr) && wv(vg) <= wv(vr)) warns.push(`⚠ 🟢 매수 검토(${wv(vg)}%)가 🔴 피하기(${wv(vr)}%)보다 덜 오름 — 한 줄 결론 기준 점검 필요`);
  const r3 = G['손익비:3 이상'], r1 = G['손익비:2 미만'];
  if (ok(r3) && ok(r1) && (r3.avg20 ?? 0) < (r1.avg20 ?? 0)) warns.push(`⚠ 손익비 3 이상(평균 ${r3.avg20}%)이 2 미만(평균 ${r1.avg20}%)보다 수익이 낮음 — 목표·손절 계산 점검 필요`);
  const judged = sum.groups.filter((g) => ok(g)).length;
  const tail = warns.length ? ['──────', ...warns, '→ 이 메시지를 캡처해서 Claude에게 보내 주세요'] : [judged > 1 ? '✅ 거꾸로 나온 규칙 없음' : 'ℹ 아직 대부분 표본이 적어 판단 이름 — 그냥 두시면 돼요'];
  st.month = month; st.at = now; st.warns = warns.length; await setJSON('mp/rulechk', st);
  await radarAlert([...lines, ...tail].filter((t) => t !== undefined), [], { force: true, title: `📊 ${month} 월간 규칙 점검 (관리자 전용)` });
  return { lines: lines.length, warns: warns.length };
}

/** 실제 성적표에서 그룹에 들어간 종목별 판정과 결과 (집계와 같은 중복 제외) */
export async function perfRows(g, limit = 400) {
  const idx = (await getJSON('mp/idx')) || [];
  const last = new Map(), out = [];
  for (const d of idx.slice().sort()) {
    const perf = await getJSON(`mp/perf/${d}`);
    if (!perf?.rows) continue;
    const dMs = Date.parse(d);
    for (const [code, row] of Object.entries(perf.rows)) {
      const k = `${code}|${row.st || '-'}`, prevMs = last.get(k);
      last.set(k, dMs);
      if (prevMs != null && dMs - prevMs <= 30 * DAY) continue;
      if (perfGroupKeys(row).includes(g)) out.push({ c: code, d, ...row });
    }
  }
  return out.slice(-limit);
}

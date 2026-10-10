// 실적 발표 자동 판정 — 실적 공시가 나오면 실제 숫자를 시장 예상치(컨센서스)와 비교해 "상회·부합·하회"를 붙임
//  국장: DART 잠정실적 원문의 영업이익·매출 ↔ 네이버 증권 컨센서스(해당 분기 추정치)
//  미장: 8-K(2.02)·실적 보도자료 → Finnhub 실적 캘린더(실제 EPS·매출 vs 예상) · 없으면 Nasdaq 실적 서프라이즈
//  결과: earn/v/{공시ID} (자세히) + earn/vmap (최근 3일 요약: 화면·텔레그램·주요 이슈 AI 재료)
//  컨센서스가 없는 종목(소형주 등)은 판정하지 않음 — AI가 숫자만 보고 '부진·호조'를 추측하지 않게 하는 게 목적
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

const H_NV = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
const H_NQ = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const n0 = (s) => { if (s == null) return null; const x = Number(String(s).replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(x) ? x : null; };
const T = (x) => `${x.titleClean || ''} ${x.title || ''} ${x.formKo || ''} ${x.reportName || ''} ${x.summary?.title || ''}`;

export function verdictOf(a, e, tol) {
  if (a == null || e == null) return null;
  const d = a - e;
  const pct = e !== 0 ? (d / Math.abs(e)) * 100 : null;
  if (pct != null && Math.abs(pct) < tol) return { v: '부합', pct };
  return { v: d > 0 ? '상회' : d < 0 ? '하회' : '부합', pct };
}
function wonTxt(n) {
  if (n == null) return '-';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e12) return s + (a / 1e12).toFixed(a >= 1e13 ? 1 : 2).replace(/\.?0+$/, '') + '조';
  if (a >= 1e8) return s + Math.round(a / 1e8).toLocaleString('ko-KR') + '억';
  return s + Math.round(a).toLocaleString('ko-KR') + '원';
}
const usd = (n) => (n == null ? '-' : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toFixed(2)}`);
const sp = (v) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${v.toFixed(1)}%)`);

// ───── 국장: 네이버 컨센서스 ─────
/** 네이버 분기 재무 → { key: { rev, op, est:boolean } } (단위: 원) */
export function parseNaverQuarter(j) {
  const fi = j?.financeInfo || j;
  const titles = fi?.trTitleList || [];
  const rows = fi?.rowList || [];
  const row = (re) => rows.find((r) => re.test(String(r.title || '').replace(/\s/g, '')));
  const rv = row(/^매출액|^영업수익|^매출/), op = row(/^영업이익$/);
  const out = {};
  for (const t of titles) {
    const k = String(t.key || '').replace(/\D/g, '');
    if (!k) continue;
    const g = (r) => { const c = r?.columns?.[t.key] ?? r?.columns?.[k]; const v = n0(c?.value ?? c); return v == null ? null : v * 1e8; };
    out[k.slice(0, 6)] = { rev: g(rv), op: g(op), est: String(t.isConsensus || '').toUpperCase() === 'Y' };
  }
  return out;
}
async function krConsensus(code, y, q) {
  const r = await fetchWithTimeout(`https://m.stock.naver.com/api/stock/${code}/finance/quarter`, { headers: H_NV }, 9000);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  const m = parseNaverQuarter(await r.json());
  const c = m[`${y}${String(q * 3).padStart(2, '0')}`];
  return c?.est && (c.op != null || c.rev != null) ? c : null;
}
async function judgeKR(x) {
  const { fetchDartDoc, earnFigures } = await import('./dart-doc.mjs');
  const f = earnFigures(await fetchDartDoc(String(x.id).replace(/^DART-/, '')));
  if (!f) return { none: '숫자 없음' };
  if (!f.q) return { none: '연간 실적' };
  const c = await krConsensus(x.ticker, f.y, f.q);
  if (!c) return { none: '컨센서스 없음' };
  const op = verdictOf(f.op, c.op, 3), rev = verdictOf(f.rev, c.rev, 2);
  const main = op || rev;
  if (!main) return { none: '비교 불가' };
  const line = [
    op ? `영업이익 ${wonTxt(f.op)} · 예상 ${wonTxt(c.op)}${sp(op.pct)}` : '',
    rev ? `매출 ${wonTxt(f.rev)} · 예상 ${wonTxt(c.rev)}${sp(rev.pct)}` : '',
  ].filter(Boolean).join(' / ');
  return { mk: 'KR', period: `${String(f.y).slice(2)}년 ${f.q}Q`, verdict: main.v, basis: op ? '영업이익' : '매출', op: op && { a: f.op, e: c.op, pct: op.pct }, rev: rev && { a: f.rev, e: c.rev, pct: rev.pct }, line, src: '네이버 증권 컨센서스' };
}

// ───── 미장: Finnhub → Nasdaq ─────
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
async function judgeUS(x, ms) {
  const t = String(x.ticker).toUpperCase();
  let a = null, e = null, ra = null, re = null, src = null;
  const key = process.env.FINNHUB_API_KEY;
  if (key) {
    try {
      const r = await fetchWithTimeout(`https://finnhub.io/api/v1/calendar/earnings?from=${ymd(ms - 4 * 86400e3)}&to=${ymd(ms + 86400e3)}&symbol=${encodeURIComponent(t)}&token=${key}`, {}, 8000);
      const j = await r.json().catch(() => ({}));
      const row = (j.earningsCalendar || []).filter((z) => z.epsActual != null).sort((p, q) => Math.abs(Date.parse(p.date) - ms) - Math.abs(Date.parse(q.date) - ms))[0];
      if (row) { a = n0(row.epsActual); e = n0(row.epsEstimate); ra = n0(row.revenueActual); re = n0(row.revenueEstimate); src = 'Finnhub'; }
    } catch {}
  }
  if (a == null || e == null) {
    try {
      const r = await fetchWithTimeout(`https://api.nasdaq.com/api/company/${encodeURIComponent(t)}/earnings-surprise`, { headers: H_NQ }, 8000);
      const rows = (await r.json().catch(() => ({})))?.data?.earningsSurpriseTable?.rows || [];
      const row = rows.map((z) => ({ ...z, ms: Date.parse(z.dateReported) })).filter((z) => Math.abs(z.ms - ms) < 5 * 86400e3)[0];
      if (row) { a = n0(row.eps); e = n0(row.consensusForecast); src = 'Nasdaq'; }
    } catch {}
  }
  if (a == null) return { wait: true };
  if (e == null) return { none: '예상치 없음' };
  const eps = verdictOf(a, e, 2);
  if (eps && eps.v !== '부합' && Math.abs(a - e) < 0.01) eps.v = '부합';
  const rev = verdictOf(ra, re, 1.5);
  const line = [`EPS $${a.toFixed(2)} · 예상 $${e.toFixed(2)}${sp(eps.pct)}`, rev ? `매출 ${usd(ra)} · 예상 ${usd(re)}${sp(rev.pct)}` : ''].filter(Boolean).join(' / ');
  return { mk: 'US', verdict: eps.v, basis: 'EPS', eps: { a, e, pct: eps.pct }, rev: rev && { a: ra, e: re, pct: rev.pct, v: rev.v }, line, src };
}

// ───── 크론 (3분마다) ─────
function itemMs(x) {
  if (x.src === 'DART' && x.timeMin && x.timeMin !== 'na') return Date.parse(x.timeMin.replace(' ', 'T') + ':00+09:00');
  return Date.parse(x.time || x.seenAt || '') || 0;
}
export async function earnWatch() {
  const now = Date.now();
  const [sec, dart, news] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
  const { typeOf } = await import('./react.mjs');
  const st = (await getJSON('earn/state')) || { tries: {} };
  const vmap = (await getJSON('earn/vmap')) || {};
  const cand = [];
  for (const x of [...(dart?.items || []), ...(sec?.items || []), ...(news?.items || [])]) {
    if (!x.id || !x.ticker || x.dupOf || vmap[x.id] || (st.tries[x.id]?.done)) continue;
    const ms = itemMs(x);
    if (!ms || now - ms > 36 * 3600e3) continue;
    const kr = x.src === 'DART';
    if (kr ? !/잠정\)?\s*실적|영업\(잠정\)/.test(T(x).replace(/\s/g, '')) : !(x.market !== 'KR' && typeOf(x) === 'us_earn')) continue;
    const tr = st.tries[x.id] || { n: 0, at: 0 };
    if (tr.n >= (kr ? 3 : 10) || now - tr.at < (kr ? 5 : 12) * 60e3) continue;
    cand.push({ x, ms, kr });
  }
  const out = { judged: 0, none: 0, wait: 0 };
  const sameDay = new Map(); // 미국: 같은 회사 같은 날(8-K + 보도자료) 한 번만 조회
  for (const { x, ms, kr } of cand.slice(0, 10)) {
    const tr = st.tries[x.id] || { n: 0, at: 0 };
    st.tries[x.id] = { n: tr.n + 1, at: now };
    try {
      const k = `${x.ticker}|${ymd(ms)}`;
      const r = kr ? await judgeKR(x) : sameDay.get(k) || (await judgeUS(x, ms));
      if (!kr) sameDay.set(k, r);
      if (r.wait) { out.wait++; continue; }
      if (r.none) { st.tries[x.id].done = 1; st.tries[x.id].none = r.none; out.none++; continue; }
      const v = { ...r, id: x.id, t: x.ticker, name: x.name || x.company || x.ticker, at: now };
      await setJSON(`earn/v/${x.id}`, v);
      vmap[x.id] = { v: r.verdict, line: r.line, b: r.basis, t: x.ticker, mk: r.mk, n: v.name, at: now };
      st.tries[x.id].done = 1;
      out.judged++;
    } catch (e) { st.tries[x.id].err = String(e.message || e).slice(0, 120); }
  }
  // 오래된 기록 정리
  for (const [id, v] of Object.entries(vmap)) if (now - (v.at || 0) > 3 * 86400e3) delete vmap[id];
  for (const [id, v] of Object.entries(st.tries)) if (now - (v.at || 0) > 3 * 86400e3) delete st.tries[id];
  if (out.judged) await setJSON('earn/vmap', vmap);
  await setJSON('earn/state', st).catch(() => {});
  return out;
}

/** 화면·텔레그램용 한 줄 배지 */
export const verdictBadge = (v) => (v === '상회' ? '🟢 컨센서스 상회' : v === '하회' ? '🔴 컨센서스 하회' : '⚪ 컨센서스 부합');

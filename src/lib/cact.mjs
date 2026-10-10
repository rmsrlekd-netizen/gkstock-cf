// 권리 일정 캘린더 — 주식 분할·병합(역분할), 배당락, 유상증자·무상증자·감자 일정 (국장·미장)
//  국장: DART 공시(주식분할·병합·감자·유무상증자·현금배당 결정) 원문에서 날짜를 읽어 일정으로 (3분마다 새 공시만, 한 번 읽으면 저장)
//  미장: Nasdaq 주식분할 일정(분할·역분할) · Nasdaq 배당 일정(배당락일, 시총 상위·인기 종목만)
//  저장: cact/kr { ev: {공시ID: 일정}, done: {공시ID: 1} } · cact/us { at, split: [...], div: [...] }
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';
import { isTradingDay } from './schedule.mjs';

const NQ = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const DATE = /(\d{4})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})/;
const ymd = (m) => `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
const num = (s) => { const x = Number(String(s ?? '').replace(/[,\s원주%]/g, '')); return Number.isFinite(x) ? x : null; };
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
/** 그 날짜 바로 전 거래일 (권리락·배당락일 계산용) */
export function prevTradingDay(mk, d) { let x = addDays(d, -1); for (let i = 0; i < 10 && !isTradingDay(mk, x); i++) x = addDays(x, -1); return x; }

// ───── DART 원문 → 날짜·비율 ─────
const findIdx = (L, re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i])) return i; return -1; };
/** 라벨 줄 이후 span 줄 안에서 날짜 n개 */
function datesAfter(L, re, n = 1, span = 8, from = 0) {
  const i = findIdx(L, re, from);
  if (i < 0) return [];
  const out = [];
  for (let j = i; j < Math.min(L.length, i + span) && out.length < n; j++) {
    const s = j === i ? L[j].replace(re, ' ') : L[j];
    const all = [...s.matchAll(new RegExp(DATE.source, 'g'))];
    for (const m of all) { if (out.length < n) out.push(ymd(m)); }
    if (j > i && /^\d+\.\s/.test(L[j]) && !out.length) break; // 다음 항목 번호가 나오면 멈춤
  }
  return out;
}
function numAfter(L, re, span = 6, sub = null) {
  let i = findIdx(L, re);
  if (i < 0) return null;
  if (sub) { const k = findIdx(L, sub, i); if (k > 0 && k - i < span) i = k; }
  for (let j = i + 1; j < Math.min(L.length, i + span); j++) { const v = num(L[j]); if (v != null && L[j] !== '-') return v; }
  return null;
}
export function parseDartAction(kind, lines) {
  const L = lines.map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
  // 정정공시: '정정 후' 이후 본문부터
  const ci = L.findIndex((x) => /^정정\s*후$/.test(x));
  const B = ci >= 0 && ci < 80 ? L.slice(ci) : L;
  const d1 = (re, span) => datesAfter(B, re, 1, span)[0] || null;
  const out = { kind };
  if (kind === 'div') {
    out.record = d1(/배당기준일/);
    out.pay = d1(/배당금지급\s*예정일자|지급예정일/);
    out.amount = numAfter(B, /1주당\s*배당금/, 6, /보통주식/);
    out.kindNote = (B[findIdx(B, /배당구분/) + 1] || '').slice(0, 10);
    out.yield = numAfter(B, /시가배당율|시가배당률/, 6, /보통주식/);
    if (out.record) out.date = prevTradingDay('KR', out.record); // 배당락일
  } else if (kind === 'bonus' || kind === 'rights' || kind === 'both') {
    out.record = d1(/신주배정기준일/);
    out.list = d1(/신주의\s*상장\s*예정일|신주\s*상장\s*예정일|상장예정일/);
    out.pay = d1(/^\d*\.?\s*납입일/);
    const ci2 = findIdx(B, /청약예정일/);
    if (ci2 >= 0) { const k = findIdx(B, /구주주/, ci2); const ds = datesAfter(B, /구주주/, 2, 6, k > 0 && k - ci2 < 10 ? k : ci2); out.sub = ds.length ? ds : datesAfter(B, /청약예정일/, 2, 10); }
    out.method = (B.find((x) => /주주배정|제3자배정|일반공모|주주우선공모/.test(x)) || '').match(/주주배정후\s*실권주\s*일반공모|주주우선공모|주주배정|제3자배정|일반공모/)?.[0] || null;
    out.ratio = numAfter(B, /1주당\s*신주배정\s*주식수/, 6, /보통주식/);
    out.price = numAfter(B, /신주\s*발행가액|발행가액/, 8, /보통주식/);
    // 권리락일: 기존 주주에게 주는 증자(무상·주주배정)는 기준일 전 거래일, 그 밖(제3자배정)은 신주 상장일
    if (out.record && (kind !== 'rights' || /주주/.test(out.method || ''))) out.date = prevTradingDay('KR', out.record);
    else out.date = out.list || out.pay || null;
  } else if (kind === 'split' || kind === 'merge' || kind === 'capred') {
    const i = findIdx(B, /1주당\s*가액|1주당\s*액면가/);
    if (i >= 0) {
      const v = B.slice(i, i + 10).map(num).filter((x) => x != null && x > 0);
      if (v.length >= 2) { out.before = v[0]; out.after = v[1]; }
    }
    const h = datesAfter(B, /매매거래\s*정지\s*(예정)?\s*기간/, 2, 8);
    out.haltFrom = h[0] || null; out.haltTo = h[1] || null;
    out.list = d1(/신주권?\s*상장\s*예정일|신주의\s*상장\s*예정일|상장\s*예정일/);
    out.meeting = d1(/주주총회\s*(예정)?일/);
    if (kind === 'capred') out.capRatio = numAfter(B, /감자비율/, 6);
    out.date = out.list || (out.haltTo ? addDays(out.haltTo, 1) : null) || out.haltFrom;
  }
  return out;
}
export function dartKind(formKo) {
  const t = String(formKo || '').replace(/\s+/g, '');
  if (/결과|철회|자회사|종속회사/.test(t)) return null;
  if (/유무상증자결정/.test(t)) return 'both';
  if (/무상증자결정/.test(t)) return 'bonus';
  if (/유상증자결정/.test(t)) return 'rights';
  if (/주식분할결정/.test(t)) return 'split';
  if (/주식병합결정/.test(t)) return 'merge';
  if (/감자결정/.test(t)) return 'capred';
  if (/현금[ㆍ·]?현물배당결정|현금배당결정/.test(t)) return 'div';
  return null;
}

// ───── 국장: 새 DART 공시 읽기 (3분마다 최대 6건) ─────
export async function cactKrWatch() {
  const st = (await getJSON('cact/kr')) || { ev: {}, done: {} };
  const dart = await getJSON('dart/feed').catch(() => null);
  let cand = (dart?.items || []).filter((x) => x.ticker && !st.done[x.id] && dartKind(x.formKo || x.titleClean));
  // 처음 한 번: 보관소에서 최근 45일치 관련 공시를 모음 (한 번만)
  if (!st.boot) {
    try {
      const { queryArchive } = await import('./archive.mjs');
      for (const q of ['유상증자', '무상증자', '주식분할', '주식병합', '감자결정', '배당결정']) {
        const rows = await queryArchive({ kind: 'FILING', market: 'KR', q, limit: 80 }).catch(() => []);
        for (const x of rows) if (x.ticker && !st.done[x.id] && dartKind(x.formKo || x.titleClean) && Date.now() - (Date.parse(x.seenAt || x.date || '') || 0) < 45 * 86400e3) cand.push(x);
      }
    } catch {}
    st.boot = Date.now();
  }
  const seen = new Set(); cand = cand.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  const { fetchDartDoc } = await import('./dart-doc.mjs');
  let n = 0;
  for (const x of cand.slice(0, 6)) {
    const kind = dartKind(x.formKo || x.titleClean);
    st.done[x.id] = 1;
    try {
      const p = parseDartAction(kind, await fetchDartDoc(String(x.id).replace(/^DART-/, '')));
      if (!p.date) continue;
      st.ev[x.id] = { ...p, mk: 'KR', id: x.id, t: x.ticker, name: x.name, fix: /정정/.test(x.formKo || ''), at: Date.now() };
      // 같은 회사·같은 종류의 예전 공시(정정 전)는 지움
      for (const [id, e] of Object.entries(st.ev)) if (id !== x.id && e.t === x.ticker && e.kind === kind && id < x.id) delete st.ev[id];
      n++;
    } catch { delete st.done[x.id]; } // 원문을 못 읽으면 다음에 다시
  }
  // 정리: 지난 일정은 10일 뒤 지움
  const cut = addDays(new Date().toISOString().slice(0, 10), -10);
  for (const [id, e] of Object.entries(st.ev)) if ((e.date || '') < cut) delete st.ev[id];
  const ids = Object.keys(st.done); if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 3000)) delete st.done[id];
  if (n || cand.length) await setJSON('cact/kr', st);
  return { kr: n, left: Math.max(0, cand.length - 6) };
}

// ───── 미장: Nasdaq 분할·배당 일정 (6시간마다) ─────
const mdy = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
export async function cactUsWatch(force = false) {
  const c = await getJSON('cact/us');
  if (!force && c && Date.now() - c.at < 6 * 3600e3) return { us: 'cached' };
  const out = { at: Date.now(), split: c?.split || [], div: c?.div || [] };
  try {
    const r = await fetchWithTimeout('https://api.nasdaq.com/api/calendar/splits', { headers: NQ }, 9000);
    const rows = r.ok ? (await r.json())?.data?.rows || [] : [];
    if (rows.length) out.split = rows.map((x) => {
      const m = String(x.ratio || '').match(/([\d.]+)\s*:\s*([\d.]+)/);
      const a = m ? Number(m[1]) : null, b = m ? Number(m[2]) : null;
      return { mk: 'US', kind: a && b ? (a > b ? 'split' : 'merge') : 'split', t: String(x.symbol || '').toUpperCase(), name: x.name || '', ratio: x.ratio || '', date: mdy(x.executionDate), pay: mdy(x.payableDate), ann: mdy(x.announcedDate) };
    }).filter((x) => x.t && x.date);
  } catch {}
  // 배당락: 앞으로 10일 (시총 상위·인기 종목만 — 하루 수백 건이라)
  try {
    const { blueSet } = await import('./tgchannel.mjs');
    const blue = (await blueSet())?.US || new Set();
    const days = []; let d = new Date().toISOString().slice(0, 10);
    for (let i = 0; days.length < 8 && i < 14; i++, d = addDays(d, 1)) if (isTradingDay('US', d)) days.push(d);
    const res = await Promise.all(days.map((day) => fetchWithTimeout(`https://api.nasdaq.com/api/calendar/dividends?date=${day}`, { headers: NQ }, 9000).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    const div = [];
    res.forEach((j) => { for (const x of j?.data?.calendar?.rows || j?.data?.rows || []) { const t = String(x.symbol || '').toUpperCase(); if (!blue.has(t)) continue; div.push({ mk: 'US', kind: 'div', t, name: x.companyName || '', date: mdy(x.dividend_Ex_Date), pay: mdy(x.payment_Date), record: mdy(x.record_Date), amount: num(x.dividend_Rate), annual: num(x.indicated_Annual_Dividend) }); } });
    if (div.length || !out.div.length) out.div = div.filter((x) => x.date);
  } catch {}
  // 한국어 회사 이름 (네이버 증권 기준, 예: NVDA → 엔비디아)
  try { const { usKoNames } = await import('./usko.mjs'); const ko = await usKoNames([...out.split, ...out.div].map((x) => x.t)); for (const x of [...out.split, ...out.div]) if (ko[x.t]) x.ko = ko[x.t]; } catch {}
  await setJSON('cact/us', out);
  return { us: { split: out.split.length, div: out.div.length } };
}

/** 화면용: { mk, list: [...] } (오늘 기준 10일 전 ~ 앞으로) */
export async function cactList(mk) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const from = addDays(today, -7);
  let list = [];
  if (mk === 'KR') list = Object.values((await getJSON('cact/kr'))?.ev || {});
  else { let c = await getJSON('cact/us'); if (!c) { await cactUsWatch(true).catch(() => {}); c = await getJSON('cact/us'); } list = [...(c?.split || []), ...(c?.div || [])]; }
  list = list.filter((e) => e.date && e.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  // 미국: 한국어 이름이 아직 없는 종목은 지금 찾아서 붙임 (한 번 찾으면 저장돼 다음부터 바로)
  if (mk === 'US' && list.some((e) => !e.ko)) { try { const { usKoNames } = await import('./usko.mjs'); const ko = await usKoNames(list.filter((e) => !e.ko).map((e) => e.t), { max: 60 }); for (const e of list) if (!e.ko && ko[e.t]) e.ko = ko[e.t]; } catch {} }
  return { mk, today, list };
}

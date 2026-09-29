// 공시 반응 통계 — "이런 공시가 나오면 보통 주가가 어떻게 됐나"
//  보관소의 지난 공시·보도자료마다 발표 직전 종가 대비 ① 다음 거래일 종가 ② 5거래일 뒤 종가 수익률을 계산해 유형별로 모음
//  (8일 이상 지난 것만 계산 · 한 번 계산한 건 react 테이블에 저장해 다시 안 함)
//  일봉: 국장 네이버 증권 · 미장 Nasdaq
import { sqlDB, getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

// ───── 유형 분류 (서버용) ─────
export const TYPES = {
  kr_rights: '유상증자', kr_bonus: '무상증자', kr_cb: '전환사채(CB) 발행', kr_bw: '신주인수권(BW) 발행', kr_burn: '자사주 소각', kr_buyback: '자사주 취득',
  kr_supply: '공급계약 체결', kr_earn: '실적 발표·손익 변동', kr_owner: '최대주주 변경', kr_mna: '합병·분할·지분 인수', kr_capred: '감자', kr_bio: '임상·품목허가', kr_div: '배당 결정', kr_rumor: '조회공시 답변', kr_5pct: '5% 대량보유 보고',
  us_bio: 'FDA·임상 발표', us_earn: '실적 발표', us_deal: '계약·파트너십', us_mna: '인수·합병', us_offer: '유상증자·공모', us_buyback: '자사주 매입', us_13d: '13D 대량보유(행동주의)', us_rsplit: '주식 병합', us_delist: '상장 유지 경고', us_guid: '가이던스 발표',
};
const T = (x) => [x.ko?.title, x.summary?.title, x.titleKo, x.pr?.headline, x.title, x.titleClean, x.formKo, x.desc, x.pr?.deck].filter(Boolean).join(' ');
export function typeOf(x) {
  const t = T(x);
  const form = String(x.form || '');
  if (x.src === 'DART' || x.market === 'KR') {
    if (x.category === 'insider') return null;
    if (/무상증자/.test(t)) return 'kr_bonus';
    if (/유상증자/.test(t)) return 'kr_rights';
    if (/신주인수권부사채/.test(t)) return 'kr_bw';
    if (/전환사채/.test(t)) return 'kr_cb';
    if (/주식\s*소각|자기주식.*소각/.test(t)) return 'kr_burn';
    if (/자기주식\s*취득|자사주\s*(매입|취득)/.test(t)) return 'kr_buyback';
    if (/감자/.test(t)) return 'kr_capred';
    if (/단일판매|공급계약/.test(t)) return 'kr_supply';
    if (/최대주주\s*변경/.test(t)) return 'kr_owner';
    if (/합병|분할|영업양수|타법인\s*주식|주식교환/.test(t)) return 'kr_mna';
    if (/임상|품목허가|FDA|신약/.test(t)) return 'kr_bio';
    if (/배당/.test(t)) return 'kr_div';
    if (/조회공시|풍문|투자판단/.test(t)) return 'kr_rumor';
    if (/잠정\s*실적|영업\(잠정\)|손익구조|매출액|실적/.test(t) || x.category === 'earnings') return 'kr_earn';
    if (x.category === 'inst') return 'kr_5pct';
    return null;
  }
  if (/^(4|144|13F|3|5|SC 13G|SCHEDULE 13G|10-Q|10-K|20-F|40-F|DEF|ARS|N-)/i.test(form)) return null;
  if (/^(SC 13D|SCHEDULE 13D)/i.test(form)) return 'us_13d';
  if (/^(424B|S-1|F-1)/i.test(form)) return 'us_offer';
  const items = (x.items || []).map((i) => i.code);
  if (/FDA|clinical|trial|topline|Phase\s?[123]|BLA|NDA\b|PDUFA|임상|승인|허가/i.test(t)) return 'us_bio';
  if (/offering|priced|underwritten|registered direct|private placement|at-the-market|유상증자|공모/i.test(t)) return 'us_offer';
  if (/reverse (stock )?split|주식 병합|액면병합/i.test(t)) return 'us_rsplit';
  if (/minimum bid|delist|Nasdaq notice|deficiency|상장 유지|상장폐지/i.test(t)) return 'us_delist';
  if (/buyback|repurchase|자사주/i.test(t)) return 'us_buyback';
  if (items.includes('2.01') || /acqui|merger|to acquire|인수|합병/i.test(t)) return 'us_mna';
  if (items.includes('2.02') || /(financial|quarter(ly)?|annual) results|earnings|revenue|실적|매출/i.test(t)) return /guidance|가이던스|outlook/i.test(t) && !/results/i.test(t) ? 'us_guid' : 'us_earn';
  if (/guidance|outlook|가이던스/i.test(t)) return 'us_guid';
  if (items.includes('1.01') || /agreement|contract|partnership|collaborat|award|order|계약|파트너|수주/i.test(t)) return 'us_deal';
  return null;
}

// ───── 저장소 (D1 react 테이블, 로컬 시험용 메모리) ─────
let ready = null;
const mem = new Map();
async function db() {
  const d = await sqlDB();
  if (!d) return null;
  if (!ready) ready = d.batch([
    d.prepare('CREATE TABLE IF NOT EXISTS react (id TEXT PRIMARY KEY, mk TEXT, k TEXT, tk TEXT, ms INTEGER, r1 REAL, r5 REAL, title TEXT)'),
    d.prepare('CREATE INDEX IF NOT EXISTS react_k ON react (mk, k, ms DESC)'),
  ]).catch((e) => { ready = null; throw e; });
  await ready;
  return d;
}

// ───── 일봉 (날짜 오름차순 [{d:'YYYY-MM-DD', c:종가}]) ─────
async function krBars(code) {
  const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=170&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('네이버 일봉 HTTP ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([\d.]+)\|/g)].map((m) => ({ d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, c: Number(m[2]) })).filter((x) => x.c > 0);
}
async function usBars(sym) {
  const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 240 * 86400e3).toISOString().slice(0, 10);
  const H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
  for (const cls of ['stocks', 'etf']) {
    const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym.replace('.', '/'))}/historical?assetclass=${cls}&fromdate=${from}&limit=200&todate=${to}`, { headers: H }, 9000).catch(() => null);
    if (!r?.ok) continue;
    const rows = (await r.json().catch(() => null))?.data?.tradesTable?.rows || [];
    const out = rows.map((x) => { const m = String(x.date || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); const c = Number(String(x.close || '').replace(/[$,]/g, '')); return m && c > 0 ? { d: `${m[3]}-${m[1]}-${m[2]}`, c } : null; }).filter(Boolean).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (out.length) return out;
  }
  throw new Error('Nasdaq 일봉 없음');
}
function local(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, m: Number(p.hour) * 60 + Number(p.minute) };
}
/** 발표 직전 종가 대비 다음 거래일·5거래일 뒤 종가 수익률(%) */
export function returnsFrom(bars, ms, mk) {
  const z = local(ms, mk === 'KR' ? 'Asia/Seoul' : 'America/New_York');
  const close = mk === 'KR' ? 15 * 60 + 30 : 16 * 60;
  // 장 마감 전 발표 → 전날 종가 기준 / 장 마감 뒤 발표 → 그날 종가 기준
  let i = -1;
  for (let j = bars.length - 1; j >= 0; j--) { const b = bars[j]; if (b.d < z.d || (b.d === z.d && z.m >= close)) { i = j; break; } }
  if (i < 0 || !bars[i + 1]) return null;
  const p0 = bars[i].c, r = (b) => (b ? Math.round((b.c / p0 - 1) * 10000) / 100 : null);
  return { r1: r(bars[i + 1]), r5: r(bars[i + 5]) };
}

/** 크론: 아직 계산 안 한 지난 공시를 조금씩 계산 (한 번에 종목 10개) */
export async function reactWatch({ maxTickers = 10, budgetMs = 25000 } = {}) {
  const d = await db();
  if (!d) return null;
  const t0 = Date.now(), now = Date.now();
  const rows = (await d.prepare(`SELECT id, data FROM items WHERE ms BETWEEN ? AND ? AND kind != 'NEWS' AND ticker IS NOT NULL AND ticker != '' AND id NOT IN (SELECT id FROM react) ORDER BY ms DESC LIMIT 120`).bind(now - 150 * 86400e3, now - 8 * 86400e3).all()).results || [];
  if (!rows.length) return { todo: 0 };
  const skip = [], byTk = new Map();
  for (const r of rows) {
    let x; try { x = JSON.parse(r.data); } catch { skip.push(r.id); continue; }
    const k = typeOf(x);
    const mk = x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US';
    const tk = String(x.ticker || '').toUpperCase();
    if (!k || !tk) { skip.push(r.id); continue; }
    const key = `${mk}:${tk}`;
    if (!byTk.has(key)) byTk.set(key, []);
    byTk.get(key).push({ x, k, mk, tk, id: r.id });
  }
  const stmts = skip.map((id) => d.prepare('INSERT OR IGNORE INTO react (id, k) VALUES (?, ?)').bind(id, 'skip'));
  let done = 0, err = 0;
  for (const [key, list] of [...byTk.entries()].slice(0, maxTickers)) {
    if (Date.now() - t0 > budgetMs) break;
    const [mk, tk] = key.split(':');
    let bars;
    try { bars = mk === 'KR' ? await krBars(tk) : await usBars(tk); } catch { err++; for (const it of list) stmts.push(d.prepare('INSERT OR IGNORE INTO react (id, k) VALUES (?, ?)').bind(it.id, 'nodata')); continue; }
    for (const it of list) {
      const ms = (await import('./archive.mjs')).itemMs(it.x);
      const r = returnsFrom(bars, ms, mk);
      // 비정상 값(주식 병합·분할, 데이터 오류)은 제외
      const bad = !r || r.r1 == null || Math.abs(r.r1) > 300 || (r.r5 != null && Math.abs(r.r5) > 500);
      const title = String(it.x.ko?.title || it.x.summary?.title || it.x.titleKo || it.x.pr?.headline || it.x.title || it.x.titleClean || it.x.formKo || '').slice(0, 120);
      stmts.push(bad ? d.prepare('INSERT OR IGNORE INTO react (id, k) VALUES (?, ?)').bind(it.id, 'nodata')
        : d.prepare('INSERT OR IGNORE INTO react (id, mk, k, tk, ms, r1, r5, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(it.id, mk, it.k, it.tk, ms, r.r1, r.r5, title));
      if (!bad) done++;
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await d.batch(stmts.slice(i, i + 50));
  return { rows: rows.length, done, skip: skip.length, err };
}

// ───── 통계 ─────
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => (a.length ? a.reduce((s, v) => s + Math.max(-60, Math.min(150, v)), 0) / a.length : null); // 극단값은 잘라서 평균
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
function agg(list) {
  const a1 = list.map((x) => x.r1).filter((v) => v != null), a5 = list.map((x) => x.r5).filter((v) => v != null);
  return { n: list.length, avg1: r2(avg(a1)), med1: r2(med(a1)), up1: a1.length ? Math.round((a1.filter((v) => v > 0).length / a1.length) * 100) : null, avg5: r2(avg(a5)), med5: r2(med(a5)), up5: a5.length ? Math.round((a5.filter((v) => v > 0).length / a5.length) * 100) : null, n5: a5.length };
}
/** 유형별 통계 (30분 저장) */
export async function reactStats(mk) {
  const ck = `react/stats/${mk}`;
  const c = await getJSON(ck);
  if (c && Date.now() - c.at < 30 * 60e3) return c;
  const d = await db();
  if (!d) return { at: Date.now(), mk, types: [] };
  const rows = (await d.prepare("SELECT k, r1, r5 FROM react WHERE mk = ? AND ms > ? AND k NOT IN ('skip','nodata')").bind(mk, Date.now() - 365 * 86400e3).all()).results || [];
  const by = {};
  for (const r of rows) (by[r.k] ||= []).push(r);
  const types = Object.entries(by).map(([k, list]) => ({ k, label: TYPES[k] || k, ...agg(list) })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n);
  const out = { at: Date.now(), mk, types, total: rows.length };
  await setJSON(ck, out).catch(() => {});
  return out;
}
/** 한 유형의 최근 사례 */
export async function reactCases(mk, k, limit = 30) {
  const d = await db();
  if (!d) return [];
  return (await d.prepare('SELECT id, tk, ms, r1, r5, title FROM react WHERE mk = ? AND k = ? ORDER BY ms DESC LIMIT ?').bind(mk, k, limit).all()).results || [];
}
/** 한 공시의 결과(있으면) */
export async function reactOf(id) {
  const d = await db();
  if (!d) return null;
  return await d.prepare('SELECT id, mk, k, r1, r5 FROM react WHERE id = ?').bind(id).first();
}

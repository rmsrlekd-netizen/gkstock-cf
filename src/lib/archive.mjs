// 공시·보도자료 영구 보관소 (D1 SQL 테이블 items)
//  · 수집기가 새로 가져온 공시·보도자료를 계속 쌓음 (지우지 않음)
//  · 과거 자료 채우기(backfill.mjs)도 같은 테이블에 넣음
//  · 목록 "이전 공시 더 보기", 기업 페이지 과거 공시, 공시별 고유 주소 페이지가 여기서 읽음
import { sqlDB } from './store.mjs';

let ready = null;
const mem = new Map(); // 로컬 테스트용
async function db() {
  const d = await sqlDB();
  if (!d) return null;
  if (!ready) {
    ready = d.batch([
      d.prepare('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, src TEXT, kind TEXT, market TEXT, ticker TEXT, name TEXT, ms INTEGER, title TEXT, sig TEXT, enrich INTEGER DEFAULT 0, data TEXT)'),
      d.prepare('CREATE INDEX IF NOT EXISTS items_ms ON items (ms DESC)'),
      d.prepare('CREATE INDEX IF NOT EXISTS items_kind ON items (kind, market, ms DESC)'),
      d.prepare('CREATE INDEX IF NOT EXISTS items_tk ON items (market, ticker, ms DESC)'),
      d.prepare('CREATE INDEX IF NOT EXISTS items_enrich ON items (enrich, ms DESC)'),
    ]).catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}

/** 항목의 정렬 시각(ms) */
export function itemMs(x) {
  if (x.approxMs) return x.approxMs;
  if (x.src === 'DART') {
    if (x.timeMin && x.timeMin !== 'na') return Date.parse(x.timeMin.replace(' ', 'T') + ':00+09:00') + 59e3;
    if (x.seenLive && x.seenAt) return Date.parse(x.seenAt);
    return Date.parse(`${x.date}T18:00:00+09:00`) || 0;
  }
  return Date.parse(x.time || x.seenAt || '') || 0;
}
const kindOf = (x) => (x.src === 'PR' ? 'PR' : x.src === 'NEWS' ? 'NEWS' : 'FILING');
const marketOf = (x) => (x.src === 'DART' ? 'KR' : x.market || 'US');
const titleOf = (x) => String(x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || x.form || '').slice(0, 300);
function clean(x) {
  const { _excerpt, txTries, docTries, aiTries, koTries, detailTries, dupOf, px0, rk, ...rest } = x;
  return rest;
}
function sigOf(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + ':' + s.length; }

const seen = new Map(); // 같은 서버에서 이미 저장한 내용은 다시 쓰지 않음 (쓰기 횟수 절약)

/** 항목 저장. mode 'upsert'(바뀐 내용 갱신) | 'ignore'(이미 있으면 그대로: 과거 자료 채우기용) */
export async function archiveItems(items, { mode = 'upsert', enrich = 0 } = {}) {
  const rows = [];
  for (const x of items || []) {
    if (!x?.id || x.src === 'NEWS') continue; // 뉴스는 보관하지 않음 (공시·보도자료만)
    if (x.src === 'PR' && (x.market === 'KR' || x.dupOf)) continue;
    const data = JSON.stringify(clean(x));
    const sig = sigOf(data);
    if (seen.get(x.id) === sig) continue;
    rows.push({ x, data, sig });
  }
  if (!rows.length) return 0;
  const d = await db();
  if (!d) { for (const r of rows) { if (mode === 'ignore' && mem.has(r.x.id)) continue; mem.set(r.x.id, { ...rowOf(r), enrich }); seen.set(r.x.id, r.sig); } return rows.length; }
  const sql = mode === 'ignore'
    ? 'INSERT OR IGNORE INTO items (id, src, kind, market, ticker, name, ms, title, sig, enrich, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    : 'INSERT INTO items (id, src, kind, market, ticker, name, ms, title, sig, enrich, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET src = excluded.src, kind = excluded.kind, market = excluded.market, ticker = excluded.ticker, name = excluded.name, ms = excluded.ms, title = excluded.title, sig = excluded.sig, enrich = 0, data = excluded.data WHERE items.sig IS NOT excluded.sig';
  for (let i = 0; i < rows.length; i += 40) {
    const part = rows.slice(i, i + 40);
    await d.batch(part.map((r) => { const o = rowOf(r); return d.prepare(sql).bind(o.id, o.src, o.kind, o.market, o.ticker, o.name, o.ms, o.title, o.sig, enrich, o.data); }));
    for (const r of part) seen.set(r.x.id, r.sig);
  }
  if (seen.size > 20000) seen.clear();
  return rows.length;
}
function rowOf({ x, data, sig }) {
  return { id: x.id, src: x.src, kind: kindOf(x), market: marketOf(x), ticker: x.ticker ? String(x.ticker).toUpperCase() : null, name: x.name || x.company || null, ms: itemMs(x), title: titleOf(x), sig, data };
}

/** 한 건 */
export async function getArchived(id) {
  const d = await db().catch(() => null);
  if (!d) return mem.get(id) ? JSON.parse(mem.get(id).data) : null;
  const r = await d.prepare('SELECT data FROM items WHERE id = ?').bind(id).first().catch(() => null);
  return r ? JSON.parse(r.data) : null;
}

/** 목록 조회 (최신순). kind: FILING|PR|ALL, market: KR|US|ALL, before: ms, ticker, q(검색어) */
export async function queryArchive({ kind = 'ALL', market = 'ALL', before = 0, ticker = '', q = '', limit = 100 } = {}) {
  limit = Math.min(200, Math.max(1, limit));
  const d = await db();
  if (!d) {
    let arr = [...mem.values()];
    if (kind !== 'ALL') arr = arr.filter((r) => r.kind === kind);
    if (market !== 'ALL') arr = arr.filter((r) => r.market === market);
    if (ticker) arr = arr.filter((r) => r.ticker === ticker.toUpperCase());
    if (before) arr = arr.filter((r) => r.ms < before);
    if (q) arr = arr.filter((r) => `${r.title} ${r.name} ${r.ticker}`.toLowerCase().includes(q.toLowerCase()));
    return arr.sort((a, b) => b.ms - a.ms).slice(0, limit).map((r) => JSON.parse(r.data));
  }
  const where = ['kind != ?'], args = ['NEWS'];
  if (kind !== 'ALL') { where.push('kind = ?'); args.push(kind); }
  if (market !== 'ALL') { where.push('market = ?'); args.push(market); }
  if (ticker) { where.push('ticker = ?'); args.push(ticker.toUpperCase()); }
  if (before) { where.push('ms < ?'); args.push(before); }
  if (q) { where.push('(title LIKE ? OR name LIKE ? OR ticker = ?)'); args.push(`%${q}%`, `%${q}%`, q.toUpperCase()); }
  const r = await d.prepare(`SELECT data FROM items WHERE ${where.join(' AND ')} ORDER BY ms DESC LIMIT ?`).bind(...args, limit).all();
  return (r.results || []).map((x) => JSON.parse(x.data));
}

/** 보강이 필요한 항목 (과거 자료 채우기에서 8-K 항목 번호 등이 빠진 것) */
export async function needEnrich(limit = 15) {
  const d = await db();
  if (!d) return [...mem.values()].filter((r) => r.enrich).slice(0, limit).map((r) => JSON.parse(r.data));
  const r = await d.prepare('SELECT data FROM items WHERE enrich = 1 ORDER BY ms DESC LIMIT ?').bind(limit).all();
  return (r.results || []).map((x) => JSON.parse(x.data));
}
export async function markEnriched(items) {
  await archiveItems(items, { mode: 'upsert' });
}

/** 보관 현황 (관리자 화면) */
export async function archiveStats() {
  const d = await db();
  if (!d) return { total: mem.size, bySrc: {}, oldest: null };
  const [a, b, c] = await Promise.all([
    d.prepare('SELECT src, COUNT(*) AS n FROM items GROUP BY src').all(),
    d.prepare('SELECT MIN(ms) AS oldest, COUNT(*) AS total FROM items').first(),
    d.prepare('SELECT COUNT(*) AS n FROM items WHERE enrich = 1').first(),
  ]);
  return { total: b?.total || 0, oldest: b?.oldest || null, pendingEnrich: c?.n || 0, bySrc: Object.fromEntries((a.results || []).map((x) => [x.src, x.n])) };
}

/** 사이트맵용 (최근 순 id·시각) */
export async function sitemapRows(limit = 5000) {
  const d = await db().catch(() => null);
  if (!d) return [...mem.values()].sort((a, b) => b.ms - a.ms).slice(0, limit).map((r) => ({ id: r.id, ms: r.ms }));
  const r = await d.prepare("SELECT id, ms FROM items WHERE kind != 'NEWS' AND ticker IS NOT NULL ORDER BY ms DESC LIMIT ?").bind(limit).all();
  return r.results || [];
}

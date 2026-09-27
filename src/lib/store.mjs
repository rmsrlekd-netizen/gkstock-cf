// 저장소 래퍼 — Cloudflare D1(SQLite)에 키-값으로 저장 (gzip 압축)
//  · worker.mjs 가 요청마다 setDB(env.DB) 로 연결해 줌
//  · 로컬 테스트(GK_MEMORY_STORE=1)나 DB 미연결 시에는 메모리 사용
const mem = new Map();
let db = null;
let ready = null;

export function setDB(d1) {
  if (d1 && d1 !== db) { db = d1; ready = null; }
}

function useMem() {
  return !db || (globalThis.process?.env?.GK_MEMORY_STORE === '1');
}

async function init() {
  if (!ready) {
    ready = db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v BLOB, t INTEGER)').run()
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}

export async function getJSON(key, fallback = null) {
  if (useMem()) return mem.has(key) ? structuredClone(mem.get(key)) : fallback;
  try {
    await init();
    const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
    if (!row || row.v == null) return fallback;
    const v = row.v;
    const text = typeof v === 'string' ? v : await gunzip(v instanceof Uint8Array ? v : new Uint8Array(v));
    return JSON.parse(text);
  } catch (e) {
    console.warn('store get', key, e.message);
    return fallback;
  }
}

export async function setJSON(key, value) {
  if (useMem()) { mem.set(key, structuredClone(value)); return; }
  await init();
  const bytes = await gzip(JSON.stringify(value));
  if (bytes.byteLength > 1_900_000) throw new Error(`저장 용량 초과 (${key}: ${bytes.byteLength} bytes)`);
  await db.prepare('INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t')
    .bind(key, bytes, Date.now()).run();
}

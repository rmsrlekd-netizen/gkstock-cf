// 방문자 통계 (관리자 전용) — D1 SQL 카운터
//  · stats(d, k, n): 날짜별 카운터 (pv 페이지뷰, uv 순방문자, item:ID 게시물 조회, ref:출처, dev:기기, hr:시간대)
//  · uv(d, h): 날짜별 방문자 식별값(IP+브라우저를 해시한 값, 원본은 저장하지 않음)
import { sqlDB } from './store.mjs';
import { kstDate } from './util.mjs';

const mem = { stats: new Map(), uv: new Set() }; // 로컬 테스트용
let ready = null;
async function db() {
  const d = await sqlDB();
  if (!d) return null;
  if (!ready) {
    ready = d.batch([
      d.prepare('CREATE TABLE IF NOT EXISTS stats (d TEXT, k TEXT, n INTEGER, PRIMARY KEY (d, k))'),
      d.prepare('CREATE TABLE IF NOT EXISTS uv (d TEXT, h TEXT, PRIMARY KEY (d, h))'),
    ]).catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|go-http/i;

async function inc(d, day, keys) {
  if (!d) { for (const k of keys) mem.stats.set(day + '|' + k, (mem.stats.get(day + '|' + k) || 0) + 1); return; }
  await d.batch(keys.map((k) => d.prepare('INSERT INTO stats (d, k, n) VALUES (?, ?, 1) ON CONFLICT(d, k) DO UPDATE SET n = n + 1').bind(day, k)));
}

/** 방문 기록. body: {t:'pv'|'item', id, ref, m(휴대폰 여부)} */
export async function track(req, body) {
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return;
  const d = await db();
  const day = kstDate(0);
  const hr = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  if (body.t === 'item' && /^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(body.id || '')) {
    await inc(d, day, [`item:${body.id}`, 'iv']);
    return;
  }
  if (body.t !== 'pv') return;
  const keys = ['pv', `hr:${String(hr).padStart(2, '0')}`];
  let ref = String(body.ref || '').toLowerCase().replace(/^www\./, '').slice(0, 60);
  //  유입 경로·기기는 '방문자 1명당 하루 1번'만 셈 (예전엔 페이지를 넘길 때마다 세서 방문자 수보다 훨씬 많았음)
  const refKey = ref && !/gk-stock\.com|workers\.dev/.test(ref) ? `rv:${ref}` : !ref ? 'rv:(직접 방문)' : null;
  const ip = req.headers.get('cf-connecting-ip') || '';
  const h = await sha(`${day}|${ip}|${ua}`);
  let isNew = false;
  if (d) isNew = ((await d.prepare('INSERT OR IGNORE INTO uv (d, h) VALUES (?, ?)').bind(day, h).run())?.meta?.changes || 0) > 0;
  else if (!mem.uv.has(day + h)) { mem.uv.add(day + h); isNew = true; }
  if (isNew) { keys.push('uv', `dv:${body.m ? 'm' : 'd'}`); if (refKey) keys.push(refKey); }
  await inc(d, day, keys);
}

async function rows(d, from) {
  if (!d) return [...mem.stats].map(([k, n]) => { const [dd, kk] = k.split('|'); return { d: dd, k: kk, n }; }).filter((x) => x.d >= from);
  return (await d.prepare('SELECT d, k, n FROM stats WHERE d >= ?').bind(from).all()).results || [];
}

/** 관리자 보고서 (최근 30일) */
export async function report() {
  const d = await db();
  const today = kstDate(0), from30 = kstDate(-29), from7 = kstDate(-6);
  const all = await rows(d, from30);
  const days = [];
  for (let i = 29; i >= 0; i--) { const dd = kstDate(-i); days.push({ d: dd, uv: 0, pv: 0, iv: 0 }); }
  const byDay = Object.fromEntries(days.map((x) => [x.d, x]));
  const items = {}, refs = {}, dev = { m: 0, d: 0 }, hours = Array(24).fill(0);
  // 새 방식(방문자 기준 rv:/dv:)이 기록된 날은 그것만, 그 전 날은 예전 기록(ref:/dev:)
  const newDays = new Set(all.filter((r) => r.k.startsWith('rv:') || r.k.startsWith('dv:')).map((r) => r.d));
  for (const r of all) {
    if (newDays.has(r.d) ? r.k.startsWith('ref:') || r.k.startsWith('dev:') : r.k.startsWith('rv:') || r.k.startsWith('dv:')) continue;
    if (r.k.startsWith('rv:')) r.k = 'ref:' + r.k.slice(3); else if (r.k.startsWith('dv:')) r.k = 'dev:' + r.k.slice(3);
    const day = byDay[r.d];
    if (!day) continue;
    if (r.k === 'uv' || r.k === 'pv' || r.k === 'iv') day[r.k] += r.n;
    else if (r.k.startsWith('item:') && r.d >= from7) items[r.k.slice(5)] = (items[r.k.slice(5)] || 0) + r.n;
    else if (r.k.startsWith('ref:') && r.d >= from7) refs[r.k.slice(4)] = (refs[r.k.slice(4)] || 0) + r.n;
    else if (r.k.startsWith('dev:') && r.d >= from7) dev[r.k.slice(4)] += r.n;
    else if (r.k.startsWith('hr:') && r.d === today) hours[Number(r.k.slice(3))] += r.n;
  }
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const last7 = days.slice(-7);
  return {
    today: byDay[today], week: { uv: sum(last7, 'uv'), pv: sum(last7, 'pv'), iv: sum(last7, 'iv') }, month: { uv: sum(days, 'uv'), pv: sum(days, 'pv'), iv: sum(days, 'iv') },
    days, hours, dev,
    topItems: Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, n]) => ({ id, n })),
    refs: Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([r, n]) => ({ r, n })),
  };
}

/** 게시물별 누적 조회수 (최근 30일) */
export async function itemViews(ids) {
  const d = await db();
  const out = {};
  if (!ids.length) return out;
  if (!d) { for (const [k, n] of mem.stats) { const id = k.split('|item:')[1]; if (id && ids.includes(id)) out[id] = (out[id] || 0) + n; } return out; }
  const q = `SELECT k, SUM(n) AS n FROM stats WHERE d >= ? AND k IN (${ids.map(() => '?').join(',')}) GROUP BY k`;
  const r = (await d.prepare(q).bind(kstDate(-29), ...ids.map((x) => 'item:' + x)).all()).results || [];
  for (const x of r) out[x.k.slice(5)] = x.n;
  return out;
}

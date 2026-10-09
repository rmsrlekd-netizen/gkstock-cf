// 방문자 통계 (관리자 전용) — D1 SQL 카운터
//  · stats(d, k, n): 날짜별 카운터 (pv 페이지뷰, uv 순방문자, item:ID 게시물 조회, ref:출처, dev:기기, hr:시간대)
//  · uv(d, h): 날짜별 방문자 식별값(IP+브라우저를 해시한 값, 원본은 저장하지 않음)
//  · vis(h, …): 기기별 누적 기록 (브라우저에 저장한 임의 번호를 해시 · 처음 온 날, 마지막 온 날, 방문 일수, 방문 횟수, 페이지뷰)
//    방문 횟수 = 30분 넘게 쉬었다가 다시 들어오면 1회 (같은 기기의 반복 방문)
import { sqlDB } from './store.mjs';
import { kstDate } from './util.mjs';

const mem = { stats: new Map(), uv: new Set(), vis: new Map() }; // 로컬 테스트용
let ready = null;
async function db() {
  const d = await sqlDB();
  if (!d) return null;
  if (!ready) {
    ready = d.batch([
      d.prepare('CREATE TABLE IF NOT EXISTS stats (d TEXT, k TEXT, n INTEGER, PRIMARY KEY (d, k))'),
      d.prepare('CREATE TABLE IF NOT EXISTS uv (d TEXT, h TEXT, PRIMARY KEY (d, h))'),
      d.prepare('CREATE TABLE IF NOT EXISTS vis (h TEXT PRIMARY KEY, first TEXT, last TEXT, lastAt INTEGER, days INTEGER, visits INTEGER, pv INTEGER, m INTEGER)'),
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
  // 기기별 누적 (순수 방문자·반복 방문)
  try {
    const vid = /^[a-z0-9]{8,40}$/i.test(body.vid || '') ? 'v|' + body.vid : `a|${ip}|${ua}`;
    keys.push(...(await device(d, await sha(vid), day, body.m ? 1 : 0)));
  } catch (e) { console.warn('vis', e.message); }
  await inc(d, day, keys);
}

const GAP = 30 * 60e3; // 30분 넘게 쉬면 새 방문
async function device(d, h, day, m) {
  const now = Date.now(), out = [];
  const v = d ? await d.prepare('SELECT first, last, lastAt, days, visits, pv FROM vis WHERE h = ?').bind(h).first() : mem.vis.get(h);
  if (!v) {
    const row = { first: day, last: day, lastAt: now, days: 1, visits: 1, pv: 1, m };
    if (d) await d.prepare('INSERT OR IGNORE INTO vis (h, first, last, lastAt, days, visits, pv, m) VALUES (?, ?, ?, ?, 1, 1, 1, ?)').bind(h, day, day, now, m).run(); else mem.vis.set(h, row);
    return ['nd', 'vs']; // 처음 온 기기 · 방문 1회
  }
  const newDay = v.last !== day, newVisit = now - (v.lastAt || 0) > GAP || newDay;
  const row = { ...v, last: day, lastAt: now, days: v.days + (newDay ? 1 : 0), visits: v.visits + (newVisit ? 1 : 0), pv: v.pv + 1, m };
  if (d) await d.prepare('UPDATE vis SET last = ?, lastAt = ?, days = ?, visits = ?, pv = ?, m = ? WHERE h = ?').bind(row.last, row.lastAt, row.days, row.visits, row.pv, m, h).run(); else mem.vis.set(h, row);
  if (newVisit) out.push('vs');
  if (newDay) out.push('rd'); // 오늘 다시 온 기기 (예전에 온 적 있음)
  return out;
}

/** 누적 합계 + 기기별(순수 방문자·반복 방문) 요약 */
async function totals(d) {
  const sumK = ['pv', 'uv', 'iv', 'vs', 'nd'];
  let t = {}, since = null, dev = { n: 0, visits: 0, pv: 0 }, dist = {}, top = [];
  const B = [[1, 1, '1회'], [2, 4, '2~4회'], [5, 9, '5~9회'], [10, 29, '10~29회'], [30, 1e9, '30회 이상']];
  if (d) {
    const r = (await d.prepare(`SELECT k, SUM(n) AS n, MIN(d) AS since FROM stats WHERE k IN (${sumK.map(() => '?').join(',')}) GROUP BY k`).bind(...sumK).all()).results || [];
    for (const x of r) { t[x.k] = x.n; if (x.k === 'pv') since = x.since; }
    const a = await d.prepare('SELECT COUNT(*) AS n, SUM(visits) AS visits, SUM(pv) AS pv, MIN(first) AS since FROM vis').first();
    dev = { n: a?.n || 0, visits: a?.visits || 0, pv: a?.pv || 0, since: a?.since || null };
    const b = (await d.prepare(`SELECT ${B.map((_, i) => `SUM(CASE WHEN visits BETWEEN ? AND ? THEN 1 ELSE 0 END) AS b${i}`).join(', ')} FROM vis`).bind(...B.flatMap(([lo, hi]) => [lo, hi])).first()) || {};
    B.forEach(([, , l], i) => { dist[l] = b['b' + i] || 0; });
    top = (await d.prepare('SELECT first, last, days, visits, pv, m FROM vis ORDER BY visits DESC, pv DESC LIMIT 15').all()).results || [];
  } else {
    for (const [k, n] of mem.stats) { const [dd, kk] = k.split('|'); if (sumK.includes(kk)) { t[kk] = (t[kk] || 0) + n; if (!since || dd < since) since = dd; } }
    const vs = [...mem.vis.values()];
    dev = { n: vs.length, visits: vs.reduce((a, x) => a + x.visits, 0), pv: vs.reduce((a, x) => a + x.pv, 0), since: vs.reduce((a, x) => (!a || x.first < a ? x.first : a), null) };
    B.forEach(([lo, hi, l]) => { dist[l] = vs.filter((x) => x.visits >= lo && x.visits <= hi).length; });
    top = vs.sort((a, b) => b.visits - a.visits || b.pv - a.pv).slice(0, 15);
  }
  return { all: { uv: t.uv || 0, pv: t.pv || 0, iv: t.iv || 0, since }, devices: { ...dev, dist, top } };
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
    if (r.k === 'nd' || r.k === 'rd' || r.k === 'vs') day[r.k] = (day[r.k] || 0) + r.n;
  }
  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const last7 = days.slice(-7);
  const tot = await totals(d).catch((e) => ({ error: e.message }));
  return {
    ...tot,
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

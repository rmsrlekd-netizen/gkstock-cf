// 공매도 가능 수량(IBKR) — 15분마다 전 종목을 받아, 바뀐 종목만 날짜별 기록에 쌓음 (최근 4일 유지)
//  기록 키: borrow/log/YYYYMMDD/<첫 글자>  → { SYM: [[시각ms, 가능수량, 수수료%], ...] }
import { fetchWithTimeout, kstDate } from './util.mjs';
import { getJSON, setJSON, getManyJSON, sqlDB } from './store.mjs';

const shard = (s) => (/^[A-Z]/.test(s) ? s[0] : '_');
const dayKey = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');

function relayBase() {
  const u = process.env.KR_RELAY_URL || '';
  return u ? u.replace(/\/api\/relay\/?$/, '').replace(/\/+$/, '') : '';
}

/** 크론 (15분마다) */
export async function borrowWatch() {
  const base = relayBase();
  if (!base) return { skip: '중계 서버 없음' };
  const r = await fetchWithTimeout(base + '/api/borrow', { headers: { 'x-relay-token': process.env.KR_RELAY_TOKEN || '' } }, 40000);
  if (!r.ok) throw new Error('중계 HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
  const j = await r.json();
  if (!j?.d || Object.keys(j.d).length < 1000) throw new Error('공매도 가능 수량 데이터 부족');
  const prev = (await getJSON('borrow/snap'))?.d || {};
  const now = Date.now(), day = dayKey(now);
  const ch = {};
  for (const [s, v] of Object.entries(j.d)) {
    const p = prev[s];
    if (p && p[0] === v[0] && p[1] === v[1]) continue;
    (ch[shard(s)] ||= {})[s] = [now, v[0], v[1]];
  }
  const keys = Object.keys(ch).map((k) => `borrow/log/${day}/${k}`);
  const cur = await getManyJSON(keys);
  for (const k of Object.keys(ch)) {
    const key = `borrow/log/${day}/${k}`, log = cur[key] || {};
    for (const [s, e] of Object.entries(ch[k])) { (log[s] ||= []).push(e); if (log[s].length > 60) log[s] = log[s].slice(-60); }
    await setJSON(key, log);
  }
  await setJSON('borrow/snap', { at: now, src: j.at, d: j.d });
  // 오래된 기록 정리 (하루 한 번쯤)
  if (new Date(now).getUTCMinutes() < 15 && new Date(now + 9 * 3600e3).getUTCHours() === 6) {
    try { const d = await sqlDB(); if (d) await d.prepare("DELETE FROM kv WHERE k LIKE 'borrow/log/%' AND k < ?").bind(`borrow/log/${kstDate(-4).replace(/-/g, '')}`).run(); } catch {}
  }
  return { n: Object.keys(j.d).length, changed: Object.values(ch).reduce((a, x) => a + Object.keys(x).length, 0) };
}

let snapCache = null;
/** 한 종목: 현재 값 + 변동 기록(최신순) */
export async function borrowOf(t) {
  const s = String(t || '').toUpperCase().replace('-', '.');
  const days = [0, -1, -2, -3].map((i) => kstDate(i).replace(/-/g, ''));
  const got = await getManyJSON(days.map((d) => `borrow/log/${d}/${shard(s)}`));
  let rows = [];
  for (const v of Object.values(got)) for (const e of v?.[s] || []) rows.push(e);
  rows.sort((a, b) => b[0] - a[0]);
  if (!snapCache || Date.now() - snapCache.t > 5 * 60e3) snapCache = { t: Date.now(), v: await getJSON('borrow/snap') };
  const cur = snapCache.v?.d?.[s];
  if (!cur && !rows.length) return null;
  return {
    at: snapCache.v?.at || null,
    avail: cur ? cur[0] : rows[0]?.[1] ?? null, fee: cur ? cur[1] : rows[0]?.[2] ?? null, rebate: cur ? cur[2] : null,
    rows: rows.slice(0, 20).map((e) => ({ at: e[0], avail: e[1], fee: e[2] })),
  };
}

// 발표 시점 주가 기록 → "발표 후 주가 반응" 계산용
//  수집기가 새 공시·보도자료를 발견하면(발표 후 30분 이내) 그 시점의 주가를 저장해 둔다
import { getJSON, setJSON } from './store.mjs';

const itemMs = (x) => Date.parse(x.time || x.seenAt || '') || 0;
const keyOf = (x) => {
  const t = String(x.ticker || '').toUpperCase();
  if (!t) return null;
  if (x.src === 'DART' || x.market === 'KR') return /^[0-9A-Z]{6}$/.test(t) ? 'KR:' + t : null;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) ? 'US:' + t : null;
};

export async function capturePx0(items) {
  const now = Date.now();
  const map = (await getJSON('px0/map')) || {};
  const todo = (items || []).filter((x) => !map[x.id] && keyOf(x) && now - itemMs(x) < 30 * 60e3 && !/^(4|144|13F)/.test(x.form || '')).slice(0, 60);
  if (!todo.length) return 0;
  const { getQuotes } = await import('../functions/quote.mjs');
  const q = await getQuotes([...new Set(todo.map(keyOf))]).catch(() => ({}));
  let n = 0;
  for (const x of todo) {
    const v = q[keyOf(x)];
    if (v?.price) { map[x.id] = { p: v.live ?? v.price, t: now }; n++; } // 프리·애프터 시간엔 시간외 가격 기준
  }
  if (!n) return 0;
  // 10일 지난 기록은 정리
  for (const [id, v] of Object.entries(map)) if (now - v.t > 10 * 86400e3) delete map[id];
  await setJSON('px0/map', map).catch(() => {});
  return n;
}

// ── 액면병합·액면분할 보정 ──
// 발표 뒤에 주식 병합(1:15 등)·분할(3:1 등)이 있으면 발표 시점 주가를 같은 기준으로 환산
// (안 하면 1:15 병합 뒤 '발표후 +1400%'처럼 잘못 보임) — Nasdaq 주식분할 일정 사용, 2주치 보관
async function splitMap() {
  const c = await getJSON('splits/map');
  if (c && Date.now() - c.at < 3 * 3600e3) return c.map;
  const map = { ...(c?.map || {}) };
  try {
    const { fetchWithTimeout, BROWSER_UA } = await import('./util.mjs');
    const r = await fetchWithTimeout('https://api.nasdaq.com/api/calendar/splits', { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } }, 8000);
    const rows = r.ok ? (await r.json())?.data?.rows || [] : [];
    for (const x of rows) {
      const m = String(x.ratio || '').match(/([\d.]+)\s*:\s*([\d.]+)/), d = String(x.executionDate || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m || !d || !x.symbol) continue;
      const newN = Number(m[1]), oldN = Number(m[2]);
      if (!(newN > 0 && oldN > 0) || newN === oldN) continue;
      // 병합 1:15 → 주가 ×15, 분할 3:1 → 주가 ÷3 (미국 동부 해당일 장 시작 = 13:30 UTC 무렵)
      map[String(x.symbol).toUpperCase()] = { f: oldN / newN, at: Date.parse(`${d[3]}-${d[1].padStart(2, '0')}-${d[2].padStart(2, '0')}T13:00:00Z`) };
    }
  } catch {}
  for (const [k, v] of Object.entries(map)) if (Date.now() - v.at > 14 * 86400e3) delete map[k];
  await setJSON('splits/map', { at: Date.now(), map }).catch(() => {});
  return map;
}

/** 피드 응답에 발표 시점 주가 붙이기 (주식 병합·분할이 있었으면 환산) */
export async function attachPx0(items) {
  const map = (await getJSON('px0/map')) || {};
  const sp = await splitMap().catch(() => ({}));
  return items.map((x) => {
    const v = map[x.id];
    if (!v) return x;
    let p = v.p;
    const s = x.market !== 'KR' && x.ticker ? sp[String(x.ticker).toUpperCase()] : null;
    if (s && v.t < s.at && Date.now() >= s.at) p = p * s.f;
    return { ...x, px0: p };
  });
}

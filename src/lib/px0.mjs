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

/** 피드 응답에 발표 시점 주가 붙이기 */
export async function attachPx0(items) {
  const map = (await getJSON('px0/map')) || {};
  return items.map((x) => (map[x.id] ? { ...x, px0: map[x.id].p } : x));
}

// FINRA 일별 공매도 거래량 (Reg SHO Daily Short Sale Volume) — 매 거래일 저녁(미국 동부 18시경) 공개, 무료
//  · 공매도 '잔고'(월 2회)와 달리 매일 나오는 '그날 공매도로 거래된 비중'
//  · 하루치 파일(전 종목)을 받아 종목별 [공매도량, 전체 거래량]으로 줄여 저장 → 최근 10거래일 유지
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const cache = new Map(); // 날짜 → 종목맵 (같은 서버 안에서 재사용)

/** 크론: 아직 안 받은 최근 거래일 파일 받기 (한 번에 최대 2개) */
export async function shortVolWatch() {
  const days = (await getJSON('shvol/days')) || [];
  const want = [];
  for (let i = 0; i < 16 && want.length < 12; i++) {
    const d = new Date(Date.now() - i * 86400e3);
    if ([0, 6].includes(d.getUTCDay())) continue;
    want.push(ymd(d));
  }
  const miss = want.filter((d) => !days.includes(d) && !days.includes('x' + d)).slice(0, 2);
  let got = 0, last = null;
  for (const d of miss) {
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${d}.txt`;
    let r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } }, 15000).catch(() => null);
    if ((!r || (!r.ok && r.status !== 404)) && process.env.KR_RELAY_URL) r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA }, relay: true }, 20000).catch(() => null); // 막히면 중계 서버로
    last = r ? r.status : 'no response';
    if (!r || r.status === 404 || r.status === 403) {
      // 휴장일이거나 아직 미발표: 이틀 넘게 지난 날짜면 '없음'으로 기록, 아니면 다음에 다시
      if (Date.now() - Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T23:00:00Z`) > 2 * 86400e3) days.push('x' + d);
      continue;
    }
    if (!r.ok) continue;
    const map = {};
    for (const line of (await r.text()).split('\n')) {
      const c = line.split('|');
      if (c.length < 5 || !/^\d{8}$/.test(c[0])) continue;
      const sym = c[1].trim().toUpperCase(), sv = Number(c[2]), tv = Number(c[4]);
      if (!sym || !(tv > 0)) continue;
      map[sym] = [Math.round(sv), Math.round(tv)];
    }
    if (Object.keys(map).length < 1000) continue;
    await setJSON(`shvol/${d}`, map);
    days.push(d); got++;
  }
  const real = days.filter((d) => !d.startsWith('x')).sort().slice(-10);
  const old = days.filter((d) => !d.startsWith('x')).sort().slice(0, -10);
  const keep = [...real, ...days.filter((d) => d.startsWith('x')).slice(-20)];
  if (got || old.length || keep.length !== days.length) await setJSON('shvol/days', keep);
  return { got, days: real.length, tried: miss, lastStatus: last };
}

/** 한 종목의 최근 일별 공매도 거래 (최신순) */
export async function shortVolOf(t) {
  const sym = String(t || '').toUpperCase();
  const days = ((await getJSON('shvol/days')) || []).filter((d) => !d.startsWith('x')).sort().reverse().slice(0, 10);
  const out = [];
  for (const d of days) {
    let m = cache.get(d);
    if (!m) { m = await getJSON(`shvol/${d}`); if (m) { cache.set(d, m); if (cache.size > 12) cache.delete(cache.keys().next().value); } }
    const v = m?.[sym];
    if (v) out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, short: v[0], total: v[1], pct: Math.round((v[0] / v[1]) * 1000) / 10 });
  }
  return out;
}

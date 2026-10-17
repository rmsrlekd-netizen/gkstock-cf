// /api/candles?code=005930 — 국장 일봉(네이버 증권, 최대 약 4년) · 감자·병합·액면분할 보정(adjustCA) · 움직이는 차트(화면) + 과거 차트 비교용
//  D1에 10분 보관(장중), 장 마감 뒤엔 다음 거래일 전까지 그대로 씀 — 같은 종목을 여러 명이 열어도 네이버는 한 번만
import { json, fetchWithTimeout, BROWSER_UA } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { adjustCA } from '../lib/manip.mjs';

const N = 1000;
async function load(code) {
  const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${N}&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('일봉 HTTP ' + r.status);
  const xml = await r.text();
  const B = [...xml.matchAll(/data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g)].map((m) => { const c = +m[5]; const o = +m[2] || c, h = Math.max(+m[3] || c, c), l = Math.min(+m[4] || c, c); return { d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`, o, h, l, c, v: +m[6] }; }).filter((x) => x.c > 0);
  if (!B.length) throw new Error('일봉 없음');
  return adjustCA(B);
}
// 장중(평일 9~16시 KST)은 10분, 그 밖엔 3시간
const ttl = (now) => { const k = new Date(now + 9 * 3600e3), d = k.getUTCDay(), h = k.getUTCHours(); return d >= 1 && d <= 5 && h >= 9 && h < 16 ? 10 * 60e3 : 3 * 3600e3; };
export default async (req) => {
  const u = new URL(req.url), code = (u.searchParams.get('code') || '').trim();
  if (!/^[0-9A-Z]{6}$/.test(code)) return json({ ok: false, error: '종목 코드(6자리)가 필요해요' }, { status: 400 });
  const key = `cd/${code}`, now = Date.now();
  const c = await getJSON(key).catch(() => null);
  if (c?.b?.length && now - c.at < ttl(now)) return json({ ok: true, code, at: c.at, adj: c.adj || 0, b: c.b }, { cdnSeconds: 300, swr: 600 });
  try {
    const B = await load(code);
    const b = B.map((x) => [x.d, x.o, x.h, x.l, x.c, x.v]);
    const adj = 0;
    await setJSON(key, { at: now, adj, b }).catch(() => {});
    return json({ ok: true, code, at: now, adj, b }, { cdnSeconds: 300, swr: 600 });
  } catch (e) {
    if (c?.b?.length) return json({ ok: true, code, at: c.at, adj: c.adj || 0, b: c.b, stale: 1 });
    return json({ ok: false, error: e.message }, { status: 502, cdnSeconds: 0 });
  }
};
export const config = { path: '/api/candles' };

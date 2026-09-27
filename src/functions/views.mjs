// /api/views — 오늘(KST) 사이트 내 종목 조회수 집계
//  GET  → 조회수 상위 목록
//  POST {src, ticker, name} → 1회 증가 (같은 방문자의 중복 클릭은 브라우저에서 하루 1회로 제한)
import { json, kstDate } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';

const keyOf = (d) => `views/${d}`;

export default async (req) => {
  const day = kstDate(0);
  if (req.method === 'POST') {
    let b = {};
    try { b = await req.json(); } catch {}
    const src = b.src === 'DART' || b.src === 'KR' ? 'KR' : 'US';
    const ticker = String(b.ticker || '').trim().toUpperCase();
    const name = String(b.name || '').trim().slice(0, 60);
    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) return json({ ok: false, error: 'bad ticker' }, { status: 400, cdnSeconds: 0 });
    const k = `${src}:${ticker}`;
    // 동시 요청 충돌 시 한 번 재시도
    for (let i = 0; i < 2; i++) {
      const cur = (await getJSON(keyOf(day))) || { day, counts: {} };
      const e = cur.counts[k] || { src, ticker, name, n: 0 };
      e.n += 1;
      if (name) e.name = name;
      cur.counts[k] = e;
      try { await setJSON(keyOf(day), cur); break; } catch { /* retry */ }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const cur = (await getJSON(keyOf(day))) || { counts: {} };
  const top = Object.values(cur.counts).sort((a, b) => b.n - a.n).slice(0, 15);
  const total = Object.values(cur.counts).reduce((a, x) => a + x.n, 0);
  return json({ ok: true, day, total, top }, { cdnSeconds: 20, swr: 40 });
};

export const config = { path: '/api/views' };

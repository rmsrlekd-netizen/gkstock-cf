// 미국 종목 한국어 이름 (네이버 증권 기준, 예: NVDA → 엔비디아). 한 번 찾은 이름은 저장해 재사용
import { getJSON, setJSON } from './store.mjs';
import { naverUsQuotes, reutersOf } from './naver.mjs';
import { getTickerMap } from './sec-core.mjs';

let mem = null;
async function load() {
  if (mem && Date.now() - mem._at < 10 * 60e3) return mem;
  const s = (await getJSON('names/usko')) || { map: {}, miss: {} };
  mem = { map: s.map || {}, miss: s.miss || {}, _at: Date.now() };
  return mem;
}

/** tickers → { TICKER: '한국어 이름' } (없는 종목은 최대 max개까지 새로 조회) */
export async function usKoNames(tickers, { max = 240 } = {}) {
  const st = await load();
  const want = [...new Set(tickers.map((t) => String(t || '').toUpperCase()).filter(Boolean))];
  const need = want.filter((t) => !st.map[t] && !(st.miss[t] && Date.now() - st.miss[t] < 7 * 86400e3)).slice(0, max);
  if (need.length) {
    let exOf = new Map();
    try { const m = await getTickerMap(); for (const v of m.values()) if (v.ticker) exOf.set(String(v.ticker).toUpperCase(), v.exchange); } catch {}
    const codes = [];
    for (const t of need) {
      const r = reutersOf(t, exOf.get(t));
      if (r) codes.push([t, r]);
      else codes.push([t, `${t}.O`], [t, `${t}.N`]); // 거래소를 모르면 나스닥·뉴욕 둘 다 시도
    }
    const chunks = [];
    for (let i = 0; i < codes.length; i += 40) chunks.push(codes.slice(i, i + 40));
    const found = new Set();
    for (let i = 0; i < chunks.length; i += 4) {
      const res = await Promise.allSettled(chunks.slice(i, i + 4).map((c) => naverUsQuotes(c.map((x) => x[1]))));
      res.forEach((r, j) => {
        if (r.status !== 'fulfilled') return;
        for (const [t, rc] of chunks[i + j]) {
          const nm = r.value[rc]?.nameKo;
          if (nm && /[가-힣]/.test(nm)) { st.map[t] = nm; found.add(t); }
        }
      });
    }
    for (const t of need) if (!found.has(t)) st.miss[t] = Date.now();
    const mk = Object.keys(st.miss);
    if (mk.length > 6000) for (const k of mk.slice(0, mk.length - 6000)) delete st.miss[k];
    await setJSON('names/usko', { map: st.map, miss: st.miss }).catch(() => {});
  }
  const out = {};
  for (const t of want) if (st.map[t]) out[t] = st.map[t];
  return out;
}

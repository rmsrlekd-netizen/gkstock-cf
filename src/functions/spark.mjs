// /api/spark — 시장 지표 카드의 작은 차트 (최근 5거래일 · 60분봉 종가)
// 야후 파이낸스 차트 API (막히면 서울 중계 서버로 재시도). 10분마다 새로 받아 저장
import { json, fetchWithTimeout, BROWSER_UA, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';

// 시장 지표 카드 키(/api/market) → 야후 심볼
const SYM = {
  '.INX:INDEXSP': '^GSPC', '.IXIC:INDEXNASDAQ': '^IXIC', '.DJI:INDEXDJX': '^DJI', 'NQW00:CME_EMINIS': 'NQ=F',
  'SOX:INDEXNASDAQ': '^SOX', 'VIX:INDEXCBOE': '^VIX', 'RUT:INDEXRUSSELL': '^RUT', 'KOSPI:KRX': '^KS11',
  KOSDAQ: '^KQ11', 'USD-KRW': 'KRW=X', 'TNX:INDEXCBOE': '^TNX', 'NI225:INDEXNIKKEI': '^N225', 'BTC-USD': 'BTC-USD', 'GCW00:COMEX': 'GC=F',
};

async function chart(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=60m&range=5d&includePrePost=false`;
  const opt = { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } };
  let r = await fetchWithTimeout('https://query1.finance.yahoo.com' + path, opt, 7000).catch(() => null);
  if (!r?.ok) r = await fetchWithTimeout('https://query2.finance.yahoo.com' + path, opt, 7000).catch(() => null);
  if (!r?.ok && process.env.KR_RELAY_URL) r = await fetchWithTimeout('https://query1.finance.yahoo.com' + path, { ...opt, relay: true }, 9000).catch(() => null);
  if (!r?.ok) throw new Error('야후 HTTP ' + (r?.status || '오류'));
  const res = (await r.json())?.chart?.result?.[0];
  const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
  const t = [], c = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null && Number.isFinite(cl[i])) { t.push(ts[i]); c.push(Math.round(cl[i] * 10000) / 10000); }
  if (c.length < 5) throw new Error('데이터 부족');
  return { t, c };
}

async function build() {
  const out = {}, errors = [];
  await Promise.all(Object.entries(SYM).map(async ([key, sym]) => {
    try { out[key] = await chart(sym); } catch (e) { errors.push(`${sym}: ${e.message}`); }
  }));
  const body = { ok: true, at: Date.now(), interval: '60m', range: '5d', data: out, errors };
  if (Object.keys(out).length) await setJSON('spark/v1', body).catch(() => {});
  return body;
}

export default async (req, ctx) => {
  const c = await getJSON('spark/v1');
  if (c) {
    if (Date.now() - c.at > 10 * 60e3) refreshInBackground(ctx, 'spark', build);
    return json(c, { cdnSeconds: 300, swr: 600 });
  }
  return json(await build(), { cdnSeconds: 120, swr: 300 });
};

export const config = { path: '/api/spark' };

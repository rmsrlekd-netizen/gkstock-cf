// /api/quote?list=US:NVDA,KR:005930  → 현재가·등락률 (최대 10종목)
import { json, fetchWithTimeout, BROWSER_UA, num } from '../lib/util.mjs';
import { hasKis, kisGet } from '../lib/kis.mjs';
import { googleQuote } from '../lib/gfin.mjs';

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
async function us(t) {
  for (const cls of ['stocks', 'etf']) {
    try {
      const r = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${encodeURIComponent(t.replace('.', '/'))}/info?assetclass=${cls}`, { headers: NQ_H }, 5000);
      const d = (await r.json())?.data?.primaryData;
      if (d && num(d.lastSalePrice) !== null) return { price: num(d.lastSalePrice), chg: num(d.netChange), pct: num(d.percentageChange), cur: 'USD' };
    } catch {}
  }
  return null;
}
async function kr(t) {
  if (hasKis()) {
    try {
      const o = (await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: t })).output || {};
      const sign = ['4', '5'].includes(String(o.prdy_vrss_sign)) ? -1 : 1;
      if (Number(o.stck_prpr)) return { price: Number(o.stck_prpr), chg: Math.abs(Number(o.prdy_vrss)) * sign, pct: Math.abs(Number(o.prdy_ctrt)) * sign, cur: 'KRW' };
    } catch {}
  }
  for (const ex of ['KRX', 'KOSDAQ']) {
    const q = await googleQuote(`${t}:${ex}`).catch(() => null);
    if (q && q.price) return { price: q.price, chg: q.chg, pct: q.pct, cur: 'KRW' };
  }
  return null;
}

export default async (req) => {
  const list = (new URL(req.url).searchParams.get('list') || '').split(',').map((s) => s.trim()).filter((s) => /^(US|KR):[A-Z0-9.\-]{1,10}$/i.test(s)).slice(0, 10);
  const out = {};
  await Promise.all(list.map(async (k) => {
    const [m, t] = k.split(':');
    out[k] = await (m.toUpperCase() === 'KR' ? kr(t) : us(t.toUpperCase())).catch(() => null);
  }));
  return json({ ok: true, quotes: out }, { cdnSeconds: 60, swr: 120 });
};

export const config = { path: '/api/quote' };

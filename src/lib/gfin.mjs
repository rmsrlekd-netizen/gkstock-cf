// 구글 파이낸스 시세 (공개 페이지에 들어 있는 데이터 사용)
// 한 페이지에 관련 지수 여러 개가 함께 들어 있어 몇 번만 호출하면 주요 지수를 모두 얻을 수 있음
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

const H = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' };
const num = (s) => (s === undefined || s === null || s === 'null' ? null : Number(s));

/** 페이지 HTML → { 'SYM:EXCH': {name, price, chg, pct, prev}, 'USD-KRW': {...} } */
export function parseGooglePage(html) {
  const out = {};
  const re = /\["([^"]+)","([^"]+)"\],"((?:[^"\\]|\\.)*)",\d+,(?:"[A-Z]{3}"|null),\[([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)[^\]]*\],null,([-\d.eE]+)/g;
  for (const m of html.matchAll(re)) {
    const key = `${m[1]}:${m[2]}`;
    if (out[key]) continue;
    out[key] = { name: m[3].replace(/\\u0026/g, '&'), price: num(m[4]), chg: num(m[5]), pct: num(m[6]), prev: num(m[7]) };
  }
  // 환율: [..., null, "USD / KRW", 3, null, [가격, 등락, 등락률,...], null, 전일, ... "USD-KRW"
  const fx = /null,"([A-Z]{3}) \/ ([A-Z]{3})",\d+,null,\[([-\d.eE]+),([-\d.eE]+),([-\d.eE]+)[^\]]*\],null,([-\d.eE]+)/g;
  for (const m of html.matchAll(fx)) {
    const key = `${m[1]}-${m[2]}`;
    if (!out[key]) out[key] = { name: `${m[1]}/${m[2]}`, price: num(m[3]), chg: num(m[4]), pct: num(m[5]), prev: num(m[6]) };
  }
  return out;
}

export async function googleQuotes(pages) {
  const all = {};
  const errors = [];
  await Promise.all(pages.map(async (p) => {
    try {
      const r = await fetchWithTimeout(`https://www.google.com/finance/quote/${p}?hl=en`, { headers: H }, 8000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const q = parseGooglePage(await r.text());
      for (const k in q) if (!all[k]) all[k] = q[k];
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
    }
  }));
  return { quotes: all, errors };
}

/** 개별 종목 시세 (예: 005930:KRX, 247540:KOSDAQ, AAPL:NASDAQ) */
export async function googleQuote(sym) {
  const r = await fetchWithTimeout(`https://www.google.com/finance/quote/${sym}?hl=en`, { headers: H }, 8000);
  if (!r.ok) throw new Error('Google HTTP ' + r.status);
  const q = parseGooglePage(await r.text());
  return q[sym] || null;
}

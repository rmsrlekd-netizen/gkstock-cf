// 미국 주간거래(데이마켓) — 한국 낮 시간(뉴욕 밤 20:00~04:00)에 열리는 미국 주식 거래 (블루오션 ATS)
//  네이버·트레이딩뷰에는 이 시간 시세가 없어서 한국투자증권 Open API로 받음
//  거래소 코드: BAQ 나스닥 주간 · BAY 뉴욕 주간 · BAA 아멕스 주간
import { hasKis, kisGet } from './kis.mjs';

const DAY_EX = ['BAQ', 'BAY', 'BAA'];
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };
const sgn = (v, sign) => (v == null ? null : ['4', '5'].includes(String(sign)) ? -Math.abs(v) : ['1', '2'].includes(String(sign)) ? Math.abs(v) : v);

/** 지금이 미국 주간거래 시간인지 (뉴욕 일~목 20:00 ~ 다음 날 04:00) */
export function usDaySession(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  if (m >= 1200) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(p.weekday);
  if (m < 240) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday);
  return false;
}

function row(x, ex) {
  const ticker = String(x.symb || x.rsym?.slice(4) || '').trim().toUpperCase();
  const price = n0(x.last);
  let pct = sgn(n0(x.rate), x.sign);
  const base = n0(x.base ?? x.n_base);
  if (price != null && base) pct = Math.round(((price - base) / base) * 10000) / 100;
  return { market: 'US', ticker, name: (x.knam || x.name || x.ename || ticker).trim(), price, pct, vol: n0(x.tvol), ex, session: 'DAY', cur: 'USD' };
}

/** 주간거래 상승·하락 상위 (한국투자증권 등락률 순위) */
export async function usDayMovers(n = 10) {
  if (!hasKis()) throw new Error('한국투자증권 키 없음');
  const got = [];
  const errs = [];
  for (const ex of DAY_EX) for (const gubn of ['1', '0']) {
    try {
      const j = await kisGet('/uapi/overseas-stock/v1/ranking/updown-rate', 'HHDFS76290000', { AUTH: '', EXCD: ex, NDAY: '0', GUBN: gubn, VOL_RANG: '0', KEYB: '' });
      for (const x of j.output2 || []) { const r = row(x, ex); if (r.ticker && r.price != null && r.pct != null) got.push(r); }
    } catch (e) { errs.push(`${ex}${gubn}: ${e.message}`); }
  }
  const seen = new Map();
  for (const r of got) if (!seen.has(r.ticker) && /^[A-Z][A-Z.]{0,5}$/.test(r.ticker)) seen.set(r.ticker, r);
  const all = [...seen.values()].filter((x) => (x.vol ?? 1) > 0);
  if (all.length < 5) throw new Error('주간거래 순위 없음' + (errs.length ? ' — ' + errs[0].slice(0, 120) : ''));
  return {
    up: all.filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, n),
    down: all.filter((x) => x.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, n),
    count: all.length, src: 'kis',
  };
}

/** 몇 종목의 주간거래 시세 (인기 종목용). exOf: 티커 → 거래소 이름 */
export async function usDayQuotes(tickers, exOf = new Map()) {
  const out = {};
  if (!hasKis()) return out;
  for (const t of tickers.slice(0, 12)) {
    const e = String(exOf.get(t) || '').toUpperCase();
    const tries = e.includes('NASDAQ') ? ['BAQ'] : e.includes('NYSE') && !/AMERICAN|MKT/.test(e) ? ['BAY'] : /AMEX|AMERICAN|MKT/.test(e) ? ['BAA'] : ['BAQ', 'BAY'];
    for (const ex of tries) {
      try {
        const j = await kisGet('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: ex, SYMB: t });
        const r = row({ ...j.output, symb: t }, ex);
        if (r.price != null && r.price > 0 && r.pct != null) { out[t] = r; break; }
      } catch {}
    }
  }
  return out;
}

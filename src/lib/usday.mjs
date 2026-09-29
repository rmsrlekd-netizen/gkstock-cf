// 미국 주간거래(데이마켓) — 한국 낮 시간(뉴욕 밤 20:00~04:00)에 열리는 미국 주식 거래 (블루오션 ATS)
//  네이버·트레이딩뷰에는 이 시간 시세가 없어서 한국투자증권 Open API로 받음
//  거래소 코드: BAQ 나스닥 주간 · BAY 뉴욕 주간 · BAA 아멕스 주간
import { hasKis, kisGet } from './kis.mjs';
import { getJSON, setJSON } from './store.mjs';

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
  await saveDayQuotes(all).catch(() => {}); // 순위에 나온 종목 시세는 다른 화면(관심종목·발표후 등락)에서도 재사용
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
    // 아는 거래소를 먼저, 안 되면 나머지 주간 거래소도 시도 (네이버 코드 접미사가 거래소와 다를 때가 있음)
    const first = e.includes('NASDAQ') ? 'BAQ' : /AMEX|AMERICAN|MKT/.test(e) ? 'BAA' : e.includes('NYSE') ? 'BAY' : null;
    const tries = [...new Set([first, 'BAQ', 'BAY', 'BAA'].filter(Boolean))];
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

// ── 주간거래 시세 공유 저장소: 종목별 최근 시세 (여러 화면·방문자가 같이 씀) ──
const QK = 'usday/q';
let qmem = null;
export async function dayQuoteCache() {
  if (qmem && Date.now() - qmem.at < 20e3) return qmem.map;
  const m = (await getJSON(QK).catch(() => null)) || {};
  qmem = { at: Date.now(), map: m };
  return m;
}
export async function saveDayQuotes(rows) {
  if (!rows.length) return;
  const m = (await getJSON(QK).catch(() => null)) || {};
  const now = Date.now();
  for (const r of rows) if (r?.ticker && r.price != null && r.pct != null) m[r.ticker] = { p: r.price, c: r.pct, at: now };
  for (const [k, v] of Object.entries(m)) if (now - v.at > 12 * 3600e3) delete m[k]; // 오래된 것 정리
  await setJSON(QK, m);
  qmem = { at: now, map: m };
}
// 저장소에 없거나 오래된 종목은 뒤에서 조금씩 받아 채움 (한국투자증권 초당 호출 제한 때문에 한 번에 최대 6종목)
const pending = new Set();
export async function refreshDayQuotes(tickers, exOf = new Map()) {
  const todo = tickers.filter((t) => !pending.has(t)).slice(0, 6);
  if (!todo.length) return;
  todo.forEach((t) => pending.add(t));
  try {
    const q = await usDayQuotes(todo, exOf);
    await saveDayQuotes(Object.values(q));
    // 주간거래가 안 되는 종목은 빈 기록으로 남겨 10분간 다시 묻지 않음
    const miss = todo.filter((t) => !q[t]);
    if (miss.length) { const m = (await getJSON(QK).catch(() => null)) || {}; for (const t of miss) m[t] = { none: 1, at: Date.now() }; await setJSON(QK, m).catch(() => {}); qmem = null; }
  } finally { todo.forEach((t) => pending.delete(t)); }
}

// /api/earnings?days=14 — 실적 발표 캘린더
//  미국: Nasdaq 실적 캘린더 (날짜별, 컨센서스 EPS·시가총액·발표 시간)  + (있으면) Finnhub 매출 추정치
//  한국: 최근 DART 공시 중 기업설명회(IR)·실적 발표 예고
import { json, fetchWithTimeout, BROWSER_UA } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { getSectors } from '../lib/sectors.mjs';
import { usKoNames } from '../lib/usko.mjs';

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const money = (s) => { const m = String(s || '').replace(/[$,]/g, ''); const neg = /^\(.*\)$/.test(m); const n = Number(m.replace(/[()]/g, '')); return m && Number.isFinite(n) ? (neg ? -n : n) : null; };
const TIME = { 'time-pre-market': '장전', 'time-after-hours': '장후', 'time-not-supplied': '미정' };

function etDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

export async function usDay(date) {
  const key = `earn/us/${date}`;
  const c = await getJSON(key);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.rows;
  try {
    const r = await fetchWithTimeout(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, { headers: NQ_H }, 9000);
    const j = await r.json();
    const rows = (j?.data?.rows || []).map((x) => ({
      t: x.symbol, n: x.name, time: TIME[x.time] || '미정', mcap: money(x.marketCap), eps: money(x.epsForecast), ests: Number(x.noOfEsts) || null,
      lastEps: money(x.lastYearEPS), fq: x.fiscalQuarterEnding || null,
    })).filter((x) => x.t);
    await setJSON(key, { at: Date.now(), rows }).catch(() => {});
    return rows;
  } catch (e) {
    return c?.rows || [];
  }
}

async function finnhubRev(from, to) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};
  const ck = `earn/fh/${from}`;
  const c = await getJSON(ck);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.map;
  try {
    const r = await fetchWithTimeout(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${key}`, {}, 9000);
    const j = await r.json();
    const map = {};
    for (const x of j.earningsCalendar || []) if (x.symbol) map[`${x.symbol}|${x.date}`] = { rev: x.revenueEstimate ?? null, epsE: x.epsEstimate ?? null, q: x.quarter, y: x.year };
    await setJSON(ck, { at: Date.now(), map }).catch(() => {});
    return map;
  } catch { return c?.map || {}; }
}

export default async (req) => {
  const days = Math.min(21, Math.max(3, Number(new URL(req.url).searchParams.get('days')) || 14));
  const dates = [];
  for (let i = 0; dates.length < days && i < days + 10; i++) {
    const d = etDate(i);
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d);
  }
  const [lists, fh, sm, dart] = await Promise.all([
    Promise.all(dates.map((d) => usDay(d))),
    finnhubRev(dates[0], dates[dates.length - 1]),
    getSectors({ allowFetch: false }).catch(() => null),
    getJSON('dart/feed'),
  ]);
  // 한국어 이름: 시가총액 큰 순으로 (처음 한 번만 조회, 이후 저장분 사용)
  const byCap = lists.flat().filter((x) => (x.mcap || 0) >= 3e8).sort((a, b) => (b.mcap || 0) - (a.mcap || 0)).map((x) => x.t);
  const ko = await Promise.race([usKoNames(byCap, { max: 320 }), new Promise((r) => setTimeout(() => r(null), 12000))]).catch(() => null) || {};
  const out = dates.map((date, i) => ({
    date,
    us: lists[i].map((x) => {
      const f = fh[`${x.t}|${date}`];
      return { ...x, ko: ko[x.t] || null, sector: sm?.us?.[x.t] || null, rev: f?.rev ?? null };
    }).sort((a, b) => (b.mcap || 0) - (a.mcap || 0)),
  }));
  // 한국: IR·실적 발표 예고 공시 (최근 2주)
  const since = Date.now() - 14 * 86400e3;
  const kr = (dart?.items || []).filter((x) => /기업설명회|IR\)|실적.*예고|결산실적|영업\(잠정\)실적|잠정실적/.test(x.formKo || x.titleClean || '') && Date.parse(`${x.date}T00:00:00+09:00`) > since)
    .slice(0, 80).map((x) => ({ id: x.id, name: x.name, ticker: x.ticker, date: x.date, title: x.summary?.title || x.titleClean || x.formKo, kind: /잠정|결산/.test(x.formKo || '') ? '실적 발표' : 'IR 개최', sector: x.ticker && sm?.kr?.[x.ticker] ? sm.kr[x.ticker].split('|')[0] : null }));
  return json({ ok: true, at: Date.now(), days: out, kr }, { cdnSeconds: 1800, swr: 3600 });
};

export const config = { path: '/api/earnings' };

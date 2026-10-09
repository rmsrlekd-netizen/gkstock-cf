// 내일 일정 — 한국·미국 증시의 다음 거래일(과 이후 며칠) 일정을 한곳에
//  한국: 한국·중국·일본 경제지표(Nasdaq 경제 일정) + 공모주 청약·신규상장(38커뮤니케이션)
//  미국: 미국 경제지표(기존 경제지표 캘린더, AI 해석 포함) + 실적 발표(Nasdaq) + IPO 상장 예정(Nasdaq)
//  장 마감 뒤에는 AI가 "내일 꼭 볼 일정 3가지"를 골라 한 줄씩 설명
import { fetchWithTimeout, BROWSER_UA, decodeText } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { hasAI, askAI, askAIWeb, parseJSON, aiPauseInfo } from './ai.mjs';

const TZ = { KR: 'Asia/Seoul', US: 'America/New_York' };
// 휴장일 (주말 외) — 알려진 것만
const HOLI = {
  KR: { '2026-10-05': '개천절 대체휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절', '2026-12-31': '연말 휴장', '2027-01-01': '신정', '2027-02-08': '설날 연휴', '2027-02-09': '설날 대체휴일', '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-08-16': '광복절 대체휴일', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-04': '개천절 대체휴일', '2027-10-11': '한글날 대체휴일', '2027-12-27': '성탄절 대체휴일', '2027-12-31': '연말 휴장' },
  US: { '2026-11-26': '추수감사절', '2026-12-25': '크리스마스', '2027-01-01': '새해 첫날', '2027-01-18': '마틴 루터 킹 데이', '2027-02-15': '대통령의 날', '2027-03-26': '성금요일', '2027-05-31': '메모리얼 데이', '2027-06-18': '준틴스 (대체)', '2027-07-05': '독립기념일 (대체)', '2027-09-06': '노동절', '2027-11-25': '추수감사절', '2027-12-24': '크리스마스 (대체)' },
};
const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function local(mk, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[mk], year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const isWeekend = (date) => [0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay());
export const isTradingDay = (mk, date) => !isWeekend(date) && !HOLI[mk][date];
const kstOf = (ms) => { const d = new Date(ms + 9 * 3600e3).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const etOf = (ms) => { const z = local('US', new Date(ms)); return { date: z.date, time: `${String(Math.floor(z.m / 60)).padStart(2, '0')}:${String(z.m % 60).padStart(2, '0')}` }; };

/** 보여줄 날짜들: 장 마감 전이면 오늘부터, 마감 뒤면 다음 거래일부터 (평일·휴장 포함 6일) */
export function scheduleDates(mk, now = new Date()) {
  const z = local(mk, now);
  const closed = mk === 'KR' ? z.m >= 15 * 60 + 30 : z.m >= 16 * 60;
  let d = z.date;
  if (closed || !isTradingDay(mk, d)) { do { d = addDays(d, 1); } while (isWeekend(d)); }
  const out = [];
  for (let i = 0; out.length < 6 && i < 14; i++) { const x = addDays(d, i); if (!isWeekend(x)) out.push(x); }
  const next = out.find((x) => isTradingDay(mk, x)) || out[0];
  return { dates: out, focus: next, today: z.date, closed };
}

// ───── 한국·중국·일본 경제지표 (Nasdaq) ─────
const ASIA = [
  ['KR', /Interest Rate Decision/i, '한국은행 기준금리 결정', 3], ['KR', /^CPI|Consumer Price/i, '소비자물가(CPI)', 3], ['KR', /GDP/i, 'GDP 성장률', 3],
  ['KR', /Exports/i, '수출', 3], ['KR', /Imports/i, '수입', 2], ['KR', /Trade Balance/i, '무역수지', 3], ['KR', /Industrial Production/i, '산업생산', 2],
  ['KR', /Retail Sales/i, '소매판매', 2], ['KR', /Current Account/i, '경상수지', 2], ['KR', /Unemployment/i, '실업률', 2], ['KR', /^PPI|Producer Price/i, '생산자물가(PPI)', 2],
  ['KR', /Manufacturing PMI/i, '제조업 PMI', 2], ['KR', /Business Survey|BSI/i, '기업경기실사지수(BSI)', 1], ['KR', /Consumer Sentiment|Consumer Confidence/i, '소비자심리지수', 1],
  ['CN', /Loan Prime Rate|LPR/i, '중국 대출우대금리(LPR)', 2], ['CN', /GDP/i, '중국 GDP', 3], ['CN', /Caixin Manufacturing/i, '중국 차이신 제조업 PMI', 2], ['CN', /Manufacturing PMI/i, '중국 제조업 PMI', 3],
  ['CN', /Non-Manufacturing PMI/i, '중국 비제조업 PMI', 2], ['CN', /^CPI|Consumer Price/i, '중국 소비자물가', 2], ['CN', /^PPI|Producer Price/i, '중국 생산자물가', 2], ['CN', /Exports/i, '중국 수출', 2],
  ['CN', /Imports/i, '중국 수입', 1], ['CN', /Trade Balance/i, '중국 무역수지', 2], ['CN', /Industrial Production/i, '중국 산업생산', 2], ['CN', /Retail Sales/i, '중국 소매판매', 2],
  ['JP', /BoJ Interest Rate|Interest Rate Decision/i, '일본은행 기준금리 결정', 3], ['JP', /Tankan/i, '일본 단칸 지수', 2], ['JP', /GDP/i, '일본 GDP', 2], ['JP', /National Core CPI|National CPI/i, '일본 소비자물가', 2], ['JP', /Tokyo Core CPI/i, '일본 도쿄 근원물가', 1],
];
function asiaMeta(e) {
  for (const [c, re, ko, imp] of ASIA) if (c === e.country && re.test(e.name)) return { ko, imp };
  return e.country === 'KR' ? { ko: null, imp: 1 } : null; // 중국·일본은 주요 지표만
}
async function asiaEcon(kstDates) {
  const { nasdaqDay } = await import('./econ.mjs');
  // 한국시간 아침 발표는 미국 동부 날짜로 전날 저녁 → 하루 앞부터
  const etDates = [...new Set(kstDates.flatMap((d) => [addDays(d, -1), d]))];
  await Promise.all(etDates.map((d) => nasdaqDay(d).catch(() => null)));
  const all = [];
  for (const d of etDates) { const c = await getJSON(`econ/day3/${d}`); for (const e of c?.asia || []) all.push(e); }
  const seen = new Set(), out = [];
  for (const e of all.sort((a, b) => a.ms - b.ms)) {
    const m = asiaMeta(e);
    if (!m) continue;
    const k = kstOf(e.ms);
    if (!kstDates.includes(k.date)) continue;
    const id = `${e.country}|${e.name}|${e.ms}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: 'econ', date: k.date, time: k.time, ms: e.ms, country: e.country, name: m.ko || e.name, en: e.name, imp: m.imp, cons: e.cons, prev: e.prev, actual: e.actual });
  }
  return out;
}

// ───── 한국 공모주 (38커뮤니케이션) ─────
async function get38(path) {
  const url = 'http://www.38.co.kr' + path; // https는 인증서 문제로 서버에서 접속이 안 됨
  let r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', Referer: 'https://www.38.co.kr/' } }, 9000).catch(() => null);
  if (!r?.ok && process.env.KR_RELAY_URL) r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, relay: true }, 12000);
  if (!r?.ok) throw new Error('38커뮤니케이션 HTTP ' + (r?.status || '오류'));
  return decodeText(await r.arrayBuffer(), 'euc-kr');
}
const tableRows = (html, summary) => {
  const i = html.indexOf(`summary="${summary}"`);
  if (i < 0) return [];
  const body = html.slice(i, html.indexOf('</table>', i));
  return (body.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<td[\s\S]*?<\/td>/gi) || []).map((td) => clean(td))).filter((c) => c.length >= 5);
};
async function krIpo(dates) {
  const cache = await getJSON('sched/kripo');
  if (cache && Date.now() - cache.at < 60 * 60e3) return cache.list;
  const out = [];
  try {
    const [k, nw] = await Promise.all([get38('/html/fund/index.htm?o=k'), get38('/html/fund/index.htm?o=nw')]);
    for (const c of tableRows(k, '공모주 청약일정')) {
      const [name, period, fixed, range, comp, broker] = c;
      const m = period.match(/(\d{4})\.(\d{2})\.(\d{2})~(\d{2})\.(\d{2})/);
      if (!m) continue;
      const start = `${m[1]}-${m[2]}-${m[3]}`, end = `${m[1]}-${m[4]}-${m[5]}`;
      out.push({ kind: 'ipo', sub: '청약', name: name.replace(/^\s+/, ''), start, end, price: fixed && fixed !== '-' ? fixed : null, range: range || null, comp: comp || null, broker: broker || null, spac: /스팩/.test(name) });
    }
    for (const c of tableRows(nw, '신규상장종목')) {
      const [name, day, , , offer] = c;
      const m = day.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (!m) continue;
      out.push({ kind: 'ipo', sub: '상장', name, start: `${m[1]}-${m[2]}-${m[3]}`, end: `${m[1]}-${m[2]}-${m[3]}`, price: offer && offer !== '-' ? offer : null, spac: /스팩/.test(name) });
    }
    await setJSON('sched/kripo', { at: Date.now(), list: out }).catch(() => {});
  } catch (e) {
    if (cache) return cache.list;
    throw e;
  }
  return out;
}

// ───── 미국 IPO (Nasdaq) ─────
async function usIpo() {
  const cache = await getJSON('sched/usipo');
  if (cache && Date.now() - cache.at < 3 * 3600e3) return cache.list;
  const z = local('US');
  const months = [z.date.slice(0, 7), addDays(z.date.slice(0, 7) + '-15', 20).slice(0, 7)];
  const out = [];
  const mdy = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  try {
    for (const mo of [...new Set(months)]) {
      const r = await fetchWithTimeout(`https://api.nasdaq.com/api/ipo/calendar?date=${mo}`, { headers: NQ_H }, 9000);
      if (!r.ok) continue;
      const d = (await r.json())?.data || {};
      for (const x of d.upcoming?.upcomingTable?.rows || []) {
        const date = mdy(x.expectedPriceDate);
        if (date) out.push({ kind: 'ipo', sub: '상장 예정', name: clean(x.companyName), ticker: x.proposedTickerSymbol, start: date, end: date, range: x.proposedSharePrice, size: x.dollarValueOfSharesOffered, exch: x.proposedExchange, spac: /Acquisition|SPAC|Capital Corp/i.test(x.companyName || '') });
      }
      for (const x of d.priced?.rows || []) {
        const date = mdy(x.pricedDate);
        if (date && date >= addDays(z.date, -3)) out.push({ kind: 'ipo', sub: '공모가 확정', name: clean(x.companyName), ticker: x.proposedTickerSymbol, start: date, end: date, price: x.proposedSharePrice, size: x.dollarValueOfSharesOffered, exch: x.proposedExchange, spac: /Acquisition|SPAC|Capital Corp/i.test(x.companyName || '') });
      }
    }
    const seen = new Set();
    out.splice(0, out.length, ...out.filter((x) => { const k = `${x.ticker || x.name}|${x.sub}`; if (seen.has(k)) return false; seen.add(k); return true; }));
    await setJSON('sched/usipo', { at: Date.now(), list: out }).catch(() => {});
  } catch (e) { if (cache) return cache.list; throw e; }
  return out;
}

// ───── 주요 일정 (정부·대통령·정책 발표, 기업 행사 등) — AI가 구글 검색으로 확인 ─────
export async function newsEvents(mk, date, { force = false, maxAge = 3 * 3600e3 } = {}) {
  const key = `sched/events/${mk}/${date}`;
  const c = await getJSON(key);
  // 결과가 비었으면(검색 실패·형식 오류) 30분 뒤 다시
  if (c && !force && Date.now() - c.at < (c.events?.length ? maxAge : 30 * 60e3)) return c;
  if (!hasAI() || (await aiPauseInfo())) return c || null;
  const d = new Date(date + 'T12:00:00Z');
  const md = `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${'일월화수목금토'[d.getUTCDay()]})`;
  const prompt = mk === 'KR'
    ? `오늘은 한국시간 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}이다. 웹 검색으로 ${md} 한국 증시 투자자가 알아야 할 주요 일정을 찾아라.
포함: 대통령·국무총리·장관 주재 회의와 정책 발표, 국회 일정, 한국은행·금융위·금감원 발표, 정부 경제지표 발표, 주요 기업 행사(신제품·실적 설명회·컨퍼런스), 신규 상장·보호예수 해제·배당 관련 일정, 해외 주요 이벤트 중 한국 증시에 영향이 큰 것.`
    : `오늘은 미국 동부시간 ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}이다. 웹 검색으로 ${md}(미국 날짜) 미국 증시 투자자가 알아야 할 주요 일정을 찾아라.
포함: 연준 위원 발언·FOMC 관련, 대통령·백악관·재무부 발표, 의회 일정, 관세·무역 이벤트, 주요 기업 행사(신제품 발표·투자자의 날·컨퍼런스), 대형 IPO, 옵션 만기 등.`;
  const full = `${prompt}
규칙:
- 검색으로 날짜가 ${md}인 것이 확인된 일정만. 추측·지어내기 금지. 날짜가 다르거나 불확실하면 빼라.
- 주가에 영향이 있을 만한 순서로 최대 10개.
- time: "HH:MM" 한국시간 (모르면 null) / title: 30자 이내 / desc: 왜 중요한지 50자 이내 / tag: 정부·정책·중앙은행·국회·기업·지표·해외 중 하나 / stocks: 관련 종목·업종 이름 최대 3개 / imp: 1~3
JSON만 출력: {"events":[{"time":null,"title":"","desc":"","tag":"","stocks":[""],"imp":2}]}`;
  try {
    let r;
    try { r = await askAIWeb(full, { maxTokens: 6000, timeout: 90000 }); }
    catch (e1) { if (/pause|쉬는/i.test(e1.message)) throw e1; r = await askAIWeb(full, { maxTokens: 6000, timeout: 90000 }); } // 한 번 더
    const { text, sources } = r;
    const j = parseJSON(text);
    const events = (Array.isArray(j?.events) ? j.events : []).filter((x) => x && x.title).slice(0, 10).map((x) => ({
      kind: 'news', time: /^\d{1,2}:\d{2}$/.test(String(x.time || '')) ? String(x.time).padStart(5, '0') : null,
      title: clean(x.title).slice(0, 40), desc: clean(x.desc).slice(0, 80), tag: clean(x.tag).slice(0, 6) || '일정',
      stocks: (Array.isArray(x.stocks) ? x.stocks : []).map((y) => clean(y).slice(0, 14)).filter(Boolean).slice(0, 3), imp: [1, 2, 3].includes(Number(x.imp)) ? Number(x.imp) : 2,
    })).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
    if (!events.length && c?.events?.length) { const keep = { ...c, at: Date.now() - maxAge + 30 * 60e3 }; await setJSON(key, keep); return keep; }
    if (!events.length && !/"events"\s*:/.test(String(text))) throw new Error('AI 응답 형식 오류');
    const out = { at: Date.now(), date, events, sources };
    await setJSON(key, out);
    return out;
  } catch (e) {
    if (c) return c;
    throw e;
  }
}

// ───── 전체 조립 ─────
export async function buildSchedule(mk) {
  const { dates, focus, closed } = scheduleDates(mk);
  const errors = [];
  const days = dates.map((date) => ({ date, holiday: HOLI[mk][date] || null, econ: [], earnings: [], ipo: [] }));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  if (mk === 'KR') {
    const [econ, ipo] = await Promise.all([asiaEcon(dates).catch((e) => { errors.push('경제지표: ' + e.message); return []; }), krIpo(dates).catch((e) => { errors.push('공모주: ' + e.message); return []; })]);
    for (const e of econ) byDate[e.date]?.econ.push(e);
    for (const x of ipo) for (const d of days) {
      if (d.date < x.start || d.date > x.end) continue;
      const tag = x.sub === '청약' ? (x.start === x.end ? '청약' : d.date === x.start ? '청약 시작' : d.date === x.end ? '청약 마감' : '청약 중') : x.sub;
      d.ipo.push({ ...x, tag });
    }
  } else {
    const { econCalendar, nasdaqDay } = await import('./econ.mjs');
    let cal = await getJSON('econ/v1');
    if (!cal || Date.now() - cal.at > 30 * 60e3) cal = await econCalendar().catch(() => cal);
    for (const d of days) {
      let evs = cal?.days?.find((x) => x.date === d.date)?.events;
      if (!evs) evs = await nasdaqDay(d.date).catch(() => []);
      d.econ = (evs || []).filter((e) => e.imp >= 1).map((e) => ({ kind: 'econ', date: d.date, time: kstOf(e.ms).time, kdate: kstOf(e.ms).date, et: e.et, ms: e.ms, country: 'US', name: e.ko || e.name, en: e.name, imp: e.imp, cons: e.cons, prev: e.prev, actual: e.actual, ai: e.ai?.headline || null }));
    }
    // 실적 발표는 '실적 캘린더' 메뉴에서 (여기선 뺌)
    const ipo = await usIpo().catch((e) => { errors.push('IPO: ' + e.message); return []; });
    for (const x of ipo) byDate[x.start]?.ipo.push({ ...x, tag: x.sub });
  }
  for (const d of days) d.econ.sort((a, b) => a.ms - b.ms);
  // 주요 일정(뉴스·정책): 저장된 것만 붙임 (새로 찾는 건 크론에서)
  for (const d of days) { const ev = await getJSON(`sched/events/${mk}/${d.date}`); if (ev) { d.events = ev.events; d.evSources = ev.sources; d.evAt = ev.at; } }
  const ai = await getJSON(`sched/ai/${mk}/${focus}`);
  return { at: Date.now(), mk, focus, closed, days, ai: ai || null, errors };
}

/** AI "내일 꼭 볼 일정 3가지" (장 마감 뒤 한 번, 없으면 다시) */
export async function scheduleBrief(mk, sched) {
  const d = sched.days.find((x) => x.date === sched.focus);
  if (!d || d.holiday) return null;
  const lines = [];
  for (const e of d.events || []) lines.push(`[주요 일정] ${e.time || ''} ${e.title} — ${e.desc}`);
  for (const e of d.econ.filter((x) => x.imp >= 2)) lines.push(`[경제지표] ${e.time} ${e.name} (예상 ${e.cons ?? '-'}, 이전 ${e.prev ?? '-'})`);
  for (const x of d.ipo.filter((y) => !y.spac).slice(0, 8)) lines.push(`[IPO] ${x.name}${x.ticker ? '(' + x.ticker + ')' : ''} ${x.tag} ${x.price || x.range || ''}`);
  if (lines.length < 2) return null;
  const md = `${Number(d.date.slice(5, 7))}월 ${Number(d.date.slice(8))}일`;
  const prompt = `너는 증권사 리서치센터의 시황 에디터다. 한국 개인투자자에게 ${md} ${mk === 'KR' ? '한국 증시' : '미국 증시'}에서 꼭 챙겨볼 일정 3가지를 골라 알려준다.
규칙: 아래 일정 목록에 있는 것만 쓴다. 지어내지 않는다. 매수·매도 추천 금지.
- headline: 그날 일정 전체를 한 줄로 (35자 이내)
- points: 정확히 3개. title은 일정 이름(20자 이내), why는 왜 중요한지·시장에 미칠 영향 (50자 이내)
JSON만: {"headline":"","points":[{"title":"","why":""}]}

일정:
${lines.join('\n')}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 1500, timeout: 40000, tag: '오늘 일정 요약' }));
  const points = (Array.isArray(j?.points) ? j.points : []).slice(0, 3).map((p) => ({ title: clean(p.title).slice(0, 30), why: clean(p.why).slice(0, 80) })).filter((p) => p.title);
  if (!points.length) throw new Error('AI 응답 형식 오류');
  const out = { date: d.date, headline: clean(j.headline).slice(0, 50), points, at: Date.now() };
  await setJSON(`sched/ai/${mk}/${d.date}`, out);
  return out;
}

/** 크론(3분마다): 일정 새로 모아 저장 + 장 마감 뒤 AI 요약 */
export async function scheduleWatch() {
  const res = {};
  for (const mk of ['KR', 'US']) {
    const prev = await getJSON(`sched/v1/${mk}`);
    if (prev && Date.now() - prev.at < 20 * 60e3 && prev.focus === scheduleDates(mk).focus) { res[mk] = 'fresh'; continue; }
    try {
      const { focus, today, dates } = scheduleDates(mk);
      // 오늘 + 다음 거래일까지 미리 찾아 둠 → 장 마감 뒤 날짜가 바뀌어도 바로 채워져 있음
      const nextTd = dates.find((x) => x > today && isTradingDay(mk, x));
      const evErr = [];
      for (const dt of [...new Set([today, focus, nextTd].filter(Boolean))]) {
        if (!isTradingDay(mk, dt)) continue;
        await newsEvents(mk, dt, { maxAge: dt === focus ? 3 * 3600e3 : 6 * 3600e3 }).catch((e) => { evErr.push(`${dt.slice(5)} ${String(e.message || e).slice(0, 80)}`); });
      }
      const s = await buildSchedule(mk);
      if (evErr.length) s.errors.push('주요 일정: ' + evErr.join(' / '));
      const fd = s.days.find((x) => x.date === s.focus);
      // AI 요약이 없거나, 요약 뒤에 주요 일정이 새로 확인됐으면 다시
      if ((!s.ai || (fd?.evAt && s.ai.at < fd.evAt)) && hasAI() && !(await aiPauseInfo())) {
        // 실패한 경우만 횟수를 셈 (일정이 아직 없어서 건너뛴 건 세지 않음)
        const tk = `sched/aitry2/${mk}/${s.focus}`;
        const t = (await getJSON(tk)) || { n: 0 };
        if (t.n < 5) { try { s.ai = (await scheduleBrief(mk, s)) || s.ai; } catch (e) { await setJSON(tk, { n: t.n + 1 }); s.errors.push('AI: ' + e.message); } }
      }
      await setJSON(`sched/v1/${mk}`, s);
      res[mk] = 'ok';
    } catch (e) { res[mk] = 'error: ' + e.message; }
  }
  return res;
}

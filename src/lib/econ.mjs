// 미국 경제지표 캘린더 (Nasdaq 경제 일정: 실제치·예상치·이전치) + 발표되면 AI 해석
import { fetchWithTimeout, BROWSER_UA, kstDate } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { hasAI, askAI, parseJSON, aiPauseInfo } from './ai.mjs';

const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };

// [영문 이름 패턴, 한국어 이름, 중요도(1~3), 설명]
const MAP = [
  [/^Core CPI \(YoY\)|^Core CPI y\/y/i, '근원 소비자물가(CPI) 전년비', 3, '식품·에너지를 뺀 물가 상승률. 연준이 가장 중시하는 물가 지표 중 하나로, 높으면 금리 인하가 늦어질 수 있습니다.'],
  [/^Core CPI/i, '근원 소비자물가(CPI) 전월비', 3, '식품·에너지를 뺀 한 달 물가 상승률. 시장이 가장 민감하게 반응하는 숫자입니다.'],
  [/^CPI \(YoY\)|^CPI y\/y/i, '소비자물가(CPI) 전년비', 3, '1년 전보다 물가가 얼마나 올랐는지. 높으면 금리 인하 기대가 줄어 성장주에 부담입니다.'],
  [/^CPI/i, '소비자물가(CPI) 전월비', 3, '한 달 동안 소비자 물가 변화.'],
  [/Core PCE/i, '근원 PCE 물가', 3, '연준이 공식 목표(2%)로 삼는 물가 지표.'],
  [/PCE Price/i, 'PCE 물가', 3, '개인소비지출 물가. 연준의 물가 판단 기준.'],
  [/Core PPI/i, '근원 생산자물가(PPI)', 3, '기업이 받는 가격(도매물가)에서 식품·에너지를 뺀 것. 소비자물가의 선행지표.'],
  [/^PPI/i, '생산자물가(PPI)', 3, '기업 간 거래 가격 변화. 앞으로의 소비자물가 방향을 보여줍니다.'],
  [/Nonfarm Payrolls/i, '비농업 고용(고용보고서)', 3, '한 달간 늘어난 일자리 수. 미국 경기를 보여주는 가장 중요한 지표입니다.'],
  [/Unemployment Rate/i, '실업률', 3, '높아지면 경기 둔화 신호, 금리 인하 기대가 커집니다.'],
  [/Average Hourly Earnings/i, '평균 시간당 임금', 3, '임금 상승률. 높으면 물가 압력으로 해석됩니다.'],
  [/Fed Interest Rate Decision|Interest Rate Decision/i, 'FOMC 기준금리 결정', 3, '연준의 기준금리 발표. 증시 전체에 가장 큰 영향을 줍니다.'],
  [/FOMC Statement|FOMC Press Conference|Fed Chair .*Speaks|Powell/i, '연준 의장 발언·FOMC 성명', 3, '향후 금리 방향에 대한 힌트.'],
  [/FOMC Meeting Minutes|FOMC Minutes/i, 'FOMC 의사록', 2, '지난 회의에서 위원들이 나눈 논의 내용.'],
  [/GDP/i, 'GDP 성장률', 3, '미국 경제 전체의 성장 속도.'],
  [/Retail Sales/i, '소매판매', 3, '소비 경기를 보여주는 대표 지표 (미국 경제의 70%가 소비).'],
  [/ISM Manufacturing PMI/i, 'ISM 제조업 지수', 3, '50 위면 제조업 확장, 아래면 위축.'],
  [/ISM Non-Manufacturing PMI|ISM Services PMI/i, 'ISM 서비스업 지수', 3, '50 위면 서비스업 확장, 아래면 위축.'],
  [/ADP Nonfarm|ADP Employment/i, 'ADP 민간고용', 2, '고용보고서 이틀 전에 나오는 민간 일자리 수.'],
  [/JOLTS/i, 'JOLTs 구인건수', 2, '기업의 일자리 공고 수. 노동시장 수요를 보여줍니다.'],
  [/Initial Jobless Claims/i, '신규 실업수당 청구건수', 2, '매주 나오는 가장 빠른 고용 지표. 늘면 고용 둔화.'],
  [/Continuing Jobless Claims/i, '연속 실업수당 청구건수', 1, ''],
  [/Jobless Claims 4-Week/i, '실업수당 청구 4주 평균', 1, ''],
  [/CB Consumer Confidence|Consumer Confidence/i, '콘퍼런스보드 소비자신뢰지수', 2, '소비자들의 경기 체감.'],
  [/Michigan Consumer Sentiment/i, '미시간대 소비자심리지수', 2, '소비자 심리. 기대인플레이션도 함께 봅니다.'],
  [/Michigan .*Inflation Expectations|Inflation Expectations/i, '미시간대 기대인플레이션', 2, '소비자가 예상하는 앞으로의 물가.'],
  [/Core Durable Goods/i, '근원 내구재 주문', 2, ''],
  [/Durable Goods/i, '내구재 주문', 2, '기업 설비투자의 흐름.'],
  [/Industrial Production/i, '산업생산', 2, ''],
  [/Housing Starts/i, '주택착공', 2, ''],
  [/Building Permits/i, '건축허가', 1, ''],
  [/New Home Sales/i, '신규주택판매', 2, ''],
  [/Existing Home Sales/i, '기존주택판매', 2, ''],
  [/Pending Home Sales/i, '잠정주택판매', 1, ''],
  [/Trade Balance/i, '무역수지', 2, ''],
  [/S&P Global .*Manufacturing PMI|Manufacturing PMI/i, 'S&P 제조업 PMI', 2, ''],
  [/S&P Global .*Services PMI|Services PMI/i, 'S&P 서비스업 PMI', 2, ''],
  [/Philadelphia Fed|Philly Fed/i, '필라델피아 연은 제조업지수', 2, ''],
  [/NY Empire State|Empire State/i, '뉴욕 엠파이어스테이트 제조업지수', 2, ''],
  [/Chicago PMI/i, '시카고 PMI', 1, ''],
  [/Crude Oil Inventories/i, '원유 재고', 1, ''],
  [/Import Price/i, '수입물가', 1, ''],
  [/Export Price/i, '수출물가', 1, ''],
  [/Personal Spending/i, '개인소비지출', 2, ''],
  [/Personal Income/i, '개인소득', 1, ''],
  [/Employment Cost Index/i, '고용비용지수', 2, ''],
  [/Nonfarm Productivity/i, '비농업 생산성', 1, ''],
  [/Unit Labor Costs/i, '단위노동비용', 1, ''],
  [/Federal Budget Balance/i, '재정수지', 1, ''],
  [/Current Account/i, '경상수지', 1, ''],
  [/10-Year Note Auction|30-Year Bond Auction|2-Year Note Auction/i, '국채 입찰', 1, ''],
  [/FOMC Member .* Speaks|Fed .* Speaks/i, '연준 위원 발언', 1, ''],
  [/Beige Book/i, '베이지북(연준 경기보고서)', 2, ''],
  [/Business Inventories/i, '기업재고', 1, ''],
  [/Factory Orders/i, '공장주문', 1, ''],
  [/Construction Spending/i, '건설지출', 1, ''],
  [/Consumer Credit/i, '소비자신용', 1, ''],
];
const clean = (s) => String(s || '').replace(/&nbsp;/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;.*?&gt;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function meta(name) {
  for (const [re, ko, imp, desc] of MAP) if (re.test(name)) return { ko, imp, desc };
  return { ko: null, imp: 1, desc: '' };
}
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

// 미국 동부 날짜·시각 → UTC ms
function etMs(date, hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const probe = new Date(`${date}T12:00:00Z`);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((x) => x.type === 'timeZoneName')?.value || 'GMT-4';
  const oh = Number((off.match(/GMT([+-]\d+)/) || [])[1] || -4);
  return Date.parse(`${date}T00:00:00Z`) + ((h || 0) - oh) * 3600e3 + (m || 0) * 60e3;
}
export function etToday(offset = 0) {
  const d = new Date(Date.now() + offset * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

/** 하루치 미국 지표 (ET 날짜 YYYY-MM-DD) */
async function nasdaqDay(date) {
  const key = `econ/day/${date}`;
  const c = await getJSON(key);
  const today = etToday(0);
  const ttl = date < today ? 12 * 3600e3 : date === today ? 60e3 : 3 * 3600e3;
  if (c && Date.now() - c.at < ttl) return c.list;
  try {
    const r = await fetchWithTimeout(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, { headers: NQ_H }, 9000);
    if (!r.ok) throw new Error('Nasdaq HTTP ' + r.status);
    const rows = (await r.json())?.data?.rows || [];
    const list = rows.filter((x) => /United States/i.test(x.country || '')).map((x) => {
      const name = clean(x.eventName);
      const m = meta(name);
      const ms = etMs(date, x.gmt);
      return { id: 'E' + hash(`${date}|${x.gmt}|${name}|${clean(x.previous)}`), date, et: x.gmt || '', ms, name, ko: m.ko, imp: m.imp, desc: m.desc, actual: clean(x.actual) || null, cons: clean(x.consensus) || null, prev: clean(x.previous) || null };
    });
    await setJSON(key, { at: Date.now(), list }).catch(() => {});
    return list;
  } catch (e) {
    if (c) return c.list;
    throw e;
  }
}

/** 지난 3일 ~ 앞으로 8일 */
export async function econCalendar() {
  const dates = [];
  for (let i = -3; i <= 8; i++) {
    const d = etToday(i);
    const wd = new Date(d + 'T12:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d);
  }
  const days = await Promise.all(dates.map(async (d) => ({ date: d, events: await nasdaqDay(d).catch(() => []) })));
  const ai = (await getJSON('econ/ai')) || {};
  for (const d of days) for (const e of d.events) { const g = groupKey(e); if (ai[g]) e.ai = ai[g]; e.g = g; }
  return { at: Date.now(), days };
}

// 같은 시각에 함께 나온 중요 지표는 한 묶음으로 해석 (예: CPI 전월비·전년비·근원)
const groupKey = (e) => `${e.date}|${e.et}`;

async function interpret(group) {
  const lines = group.map((e) => `- ${e.ko || e.name} (${e.name}): 실제 ${e.actual ?? '-'} / 예상 ${e.cons ?? '-'} / 이전 ${e.prev ?? '-'}`).join('\n');
  const when = new Date(group[0].ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const prompt = `너는 미국 매크로 전략가이자 한국 개인투자자에게 설명하는 증권사 리서치센터장이다.
방금(한국시간 ${when}) 발표된 미국 경제지표를 투자자가 바로 이해하도록 해석하라.

발표 지표:
${lines}

규칙:
- 쉬운 한국어, 전문용어는 괄호로 짧게 풀어 쓰기
- 예상치 대비 결과(상회/하회/부합)를 먼저 판단하고, 그것이 금리·달러·미국 증시에 어떤 의미인지
- 호재·악재 섹터는 실제 미국 증시에서 통상 나타나는 반응 기준으로 구체적으로 (예: "기술·성장주", "지방은행", "주택건설", "리츠", "에너지")
- 과장 금지, 불확실하면 "제한적"
JSON만 출력:
{"headline":"한 줄 요약(40자 이내)","surprise":"예상 상회|예상 하회|예상 부합|혼조","summary":["핵심 해석 2~3줄"],"stock":"호재|악재|중립","impact":{"size":"큼|보통|제한적","text":"주가에 미칠 영향 한두 문장"},"rates":"금리·달러·연준 정책에 대한 의미 한 문장","good":[{"sector":"섹터","why":"이유"}],"bad":[{"sector":"섹터","why":"이유"}],"korea":"한국 증시·환율에 미칠 영향 한 문장","watch":"다음에 볼 포인트 한 문장"}`;
  const txt = await askAI(prompt, { maxTokens: 1500, timeout: 30000, think: 512 });
  const j = parseJSON(txt);
  if (!j?.headline) throw new Error('AI 형식 오류');
  return { ...j, at: Date.now() };
}

/** 발표된 중요 지표를 AI로 해석 (1분마다, 한 번에 최대 3묶음) */
export async function econWatch({ maxAI = 3 } = {}) {
  // 오늘 + 직전 평일 (월요일 아침엔 금요일 발표분까지)
  const dates = [];
  for (let i = 0; dates.length < 3 && i < 7; i++) { const d = etToday(-i); const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6) dates.push(d); }
  const events = (await Promise.all(dates.map((d) => nasdaqDay(d).catch(() => [])))).flat();
  const ai = (await getJSON('econ/ai')) || {};
  const groups = new Map();
  for (const e of events) {
    if (!e.actual || e.imp < 2) continue;
    const g = groupKey(e);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  let n = 0;
  if (hasAI() && !(await aiPauseInfo())) {
    for (const [g, list] of [...groups.entries()].sort((a, b) => b[1][0].ms - a[1][0].ms)) {
      if (n >= maxAI) break;
      const sig = list.map((e) => e.id + ':' + e.actual).join('|');
      if (ai[g]?.sig === sig) continue;
      try {
        // 같은 시각의 중요도 낮은 지표도 참고로 넣음
        const all = events.filter((e) => groupKey(e) === g && e.actual).sort((a, b) => b.imp - a.imp).slice(0, 8);
        ai[g] = { ...(await interpret(all)), sig };
        n++;
      } catch (e) { console.warn('econ ai', e.message); break; }
    }
  }
  if (n) {
    for (const k of Object.keys(ai)) if (Date.now() - (ai[k].at || 0) > 20 * 86400e3) delete ai[k];
    await setJSON('econ/ai', ai).catch(() => {});
  }
  return { groups: groups.size, ai: n };
}

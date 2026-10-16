// 미리 분석: 새로 들어온 중요한 공시·보도자료를 수집 직후 AI로 미리 분석하고 기업 정보도 미리 받아둠
// → 방문자가 눌렀을 때 기다림 없이 바로 표시 (결과는 저장되어 모두가 재사용)
import { getJSON, setJSON, hasKeys } from './store.mjs';
import { hasAI, aiPauseInfo } from './ai.mjs';
import { kstDate } from './util.mjs';

const DAILY_MAX = Number(process.env.PREWARM_DAILY_MAX || 400); // v222: '전부(30000)'를 시험했다가 GK 요청으로 v220 이전 기준 400으로 (비용) // v220: 심층 분석이 가벼운 모델이라 싸짐 → 새 공시 거의 전부 미리 (200 → 400 → 2500) // AI 미리 분석 하루 최대 건수 (요금·한도 보호)

async function runOne(it, withCo = true) {
  const { analyzeId } = await import('../functions/analyze.mjs');
  const company = (await import('../functions/company.mjs')).default;
  const jobs = [analyzeId(it.id, it).catch(() => null)];
  if (it.ticker && withCo) {
    const q = it.market === 'KR' || it.src === 'DART'
      ? (it.corpCode ? `src=KR&t=${encodeURIComponent(it.ticker)}&corp=${it.corpCode}&ex=${encodeURIComponent(it.exchange || '')}` : null)
      : `src=US&t=${encodeURIComponent(String(it.ticker).toUpperCase())}`;
    if (q) jobs.push(company(new Request('http://x/api/company?' + q), { waitUntil: () => {} }).catch(() => null));
  }
  await Promise.all(jobs);
}

// v213 빠른 요약(3줄) 미리 만들기: 종목이 있는 새 공시는 중요도와 상관없이 전부 (가벼운 모델이라 싸고 빠름)
//  → 어떤 공시를 눌러도 3줄 요약은 바로 뜨고, 심층 분석만 기다리면 됨
const QUICK_DAILY = Number(process.env.PREWARM_QUICK_MAX || 300); // v222: GK 요청으로 비용 줄임 (이전 2000)
export async function prewarmQuick(items, { max = 8, budgetMs = 20000 } = {}) {
  if (!hasAI() || !items?.length) return 0;
  if (await aiPauseInfo()) return 0;
  const dayKey = `prewarm/quick/${kstDate(0)}`;
  const cnt = (await getJSON(dayKey))?.n || 0;
  if (cnt >= QUICK_DAILY) return 0;
  const todo = [];
  for (const it of items.slice(0, 20)) { // 최근 20건만 확인 (DB 읽기 줄이기)
    if (todo.length >= Math.min(max, QUICK_DAILY - cnt)) break;
    if (!it.ticker || (await getJSON(`aiq/${it.id}`)) || (await getJSON(`ai3/${it.id}`))) continue;
    todo.push(it);
  }
  if (!todo.length) return 0;
  const { quickSummary } = await import('../functions/analyze.mjs');
  const until = Date.now() + budgetMs;
  for (let i = 0; i < todo.length && Date.now() < until; i += 2) {
    await Promise.race([Promise.all(todo.slice(i, i + 2).map((it) => quickSummary(it.id, it).catch(() => null))), new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now())))]);
  }
  await setJSON(dayKey, { n: cnt + todo.length }).catch(() => {});
  return todo.length;
}
const fresh = (x, h = 12) => { const t = Date.parse(x.time || x.seenAt || (x.date ? x.date + 'T09:00:00+09:00' : 0)); return t && Date.now() - t < h * 3600e3; };
export const pickQuick = (items) => (items || []).filter((x) => x.ticker && fresh(x) && !/^(4|144|13F|SC 13G)/.test(x.form || '')).slice(0, 60);

/** items: 후보 목록(최신순). max: 이번에 분석할 최대 건수. budgetMs: 시간 제한 */
export async function prewarm(items, { max = 3, budgetMs = 45000, withCo = true, scan = 30, par: par0 = 0 } = {}) {
  if (!hasAI() || !items.length) return 0;
  if (await aiPauseInfo()) return 0; // 한도 초과로 쉬는 중이면 미리 분석도 쉼
  const dayKey = `prewarm/count/${kstDate(0)}`;
  const cnt = (await getJSON(dayKey))?.n || 0;
  if (cnt >= DAILY_MAX) return 0;
  // v222: 이미 분석된 것인지 한 번에 확인 (키 존재만) — 예전엔 최근 30건만 하나씩 읽어서, 한꺼번에 많이 올라오면(미국 장 마감 직후 등)
  //  30건 밖으로 밀린 공시는 영영 미리 분석이 안 됐음 → scan건까지 보고 안 된 것만 고름
  const cand = items.slice(0, scan);
  let done; try { done = await hasKeys(cand.map((it) => `ai3/${it.id}`)); } catch { return 0; }
  const todo = cand.filter((it) => !done.has(`ai3/${it.id}`)).slice(0, Math.min(max, DAILY_MAX - cnt));
  if (!todo.length) return 0;
  const until = Date.now() + budgetMs;
  // 두 건씩 동시에 (prewarmMore는 네 건씩)
  const par = par0 || (max >= 8 ? 4 : 2);
  for (let i = 0; i < todo.length && Date.now() < until; i += par) {
    await Promise.race([Promise.all(todo.slice(i, i + par).map((it) => runOne(it, withCo))), new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now())))]);
  }
  await setJSON(dayKey, { n: cnt + todo.length }).catch(() => {});
  return todo.length;
}

// 최근 48시간 안의 중요한 공시·보도자료 중 아직 AI 분석이 없는 것 (AI가 멈췄던 동안 밀린 것도 자동으로 채움)
const recent = (ms, h = 48) => Date.now() - ms < h * 3600e3;
export const pickSec = (items) => (items || []).filter((x) => x.ticker && x.impact >= 3 && !/^(4|144|13F)/.test(x.form || '') && recent(Date.parse(x.time))).slice(0, 80);
export const pickDart = (items) => (items || []).filter((x) => x.ticker && x.impact >= 3 && (x.seenAt ? recent(Date.parse(x.seenAt)) : x.date >= kstDate(-2))).slice(0, 80);
export const pickPR = (items) => (items || []).filter((x) => x.src === 'PR' && x.market === 'US' && x.ticker && recent(Date.parse(x.time))).slice(0, 80);

// v220 3분 크론: 1분 크론이 못 다 한 '종목 있는 새 공시' 심층 분석을 최신순으로 더 미리 만들어 둠 (사람이 누르기 전에)
//  · 중요도와 상관없이(13F·Form 4·144 같은 대량 보고는 뒤로) · 한 번에 최대 8건·4건씩·40초
//  · v222: 이미 분석됐는지는 최근 100건까지 한 번에 확인(`hasKeys`) — 예전엔 30건만 봐서 한꺼번에 몰리면 밀린 공시가 영영 빠졌음
const BULK = /^(4|4\/A|3|5|144|13F|SC 13G)/;
export async function prewarmMore({ max = 8, budgetMs = 40000 } = {}) {
  const [sec, dart, news] = await Promise.all([getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
  const all = [...(dart?.items || []), ...(sec?.items || []), ...(news?.items || []).filter((x) => x.src === 'PR')]
    .filter((x) => x.ticker && fresh(x, 24))
    .sort((a, b) => (BULK.test(a.form || '') ? 1 : 0) - (BULK.test(b.form || '') ? 1 : 0) || (Date.parse(b.time || b.seenAt || 0) || 0) - (Date.parse(a.time || a.seenAt || 0) || 0));
  return prewarm(all, { max, budgetMs, withCo: false, scan: 100, par: 4 }); // 기업 정보 미리 받기는 빼서 바깥 요청 줄임
}

// 미리 분석: 새로 들어온 중요한 공시·보도자료를 수집 직후 AI로 미리 분석하고 기업 정보도 미리 받아둠
// → 방문자가 눌렀을 때 기다림 없이 바로 표시 (결과는 저장되어 모두가 재사용)
import { getJSON, setJSON } from './store.mjs';
import { hasAI, aiPauseInfo } from './ai.mjs';
import { kstDate } from './util.mjs';

const DAILY_MAX = Number(process.env.PREWARM_DAILY_MAX || 400); // v213: 200 → 400 // AI 미리 분석 하루 최대 건수 (요금·한도 보호)

async function runOne(it) {
  const { analyzeId } = await import('../functions/analyze.mjs');
  const company = (await import('../functions/company.mjs')).default;
  const jobs = [analyzeId(it.id).catch(() => null)];
  if (it.ticker) {
    const q = it.market === 'KR' || it.src === 'DART'
      ? (it.corpCode ? `src=KR&t=${encodeURIComponent(it.ticker)}&corp=${it.corpCode}&ex=${encodeURIComponent(it.exchange || '')}` : null)
      : `src=US&t=${encodeURIComponent(String(it.ticker).toUpperCase())}`;
    if (q) jobs.push(company(new Request('http://x/api/company?' + q), { waitUntil: () => {} }).catch(() => null));
  }
  await Promise.all(jobs);
}

// v213 빠른 요약(3줄) 미리 만들기: 종목이 있는 새 공시는 중요도와 상관없이 전부 (가벼운 모델이라 싸고 빠름)
//  → 어떤 공시를 눌러도 3줄 요약은 바로 뜨고, 심층 분석만 기다리면 됨
const QUICK_DAILY = Number(process.env.PREWARM_QUICK_MAX || 2000);
export async function prewarmQuick(items, { max = 8, budgetMs = 20000 } = {}) {
  if (!hasAI() || !items?.length) return 0;
  if (await aiPauseInfo()) return 0;
  const dayKey = `prewarm/quick/${kstDate(0)}`;
  const cnt = (await getJSON(dayKey))?.n || 0;
  if (cnt >= QUICK_DAILY) return 0;
  const todo = [];
  for (const it of items) {
    if (todo.length >= Math.min(max, QUICK_DAILY - cnt)) break;
    if (!it.ticker || (await getJSON(`aiq/${it.id}`)) || (await getJSON(`ai3/${it.id}`))) continue;
    todo.push(it);
  }
  if (!todo.length) return 0;
  const { quickSummary } = await import('../functions/analyze.mjs');
  const until = Date.now() + budgetMs;
  for (let i = 0; i < todo.length && Date.now() < until; i += 4) {
    await Promise.race([Promise.all(todo.slice(i, i + 4).map((it) => quickSummary(it.id).catch(() => null))), new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now())))]);
  }
  await setJSON(dayKey, { n: cnt + todo.length }).catch(() => {});
  return todo.length;
}
const fresh = (x, h = 12) => { const t = Date.parse(x.time || x.seenAt || (x.date ? x.date + 'T09:00:00+09:00' : 0)); return t && Date.now() - t < h * 3600e3; };
export const pickQuick = (items) => (items || []).filter((x) => x.ticker && fresh(x) && !/^(4|144|13F|SC 13G)/.test(x.form || '')).slice(0, 60);

/** items: 후보 목록(최신순). max: 이번에 분석할 최대 건수. budgetMs: 시간 제한 */
export async function prewarm(items, { max = 3, budgetMs = 45000 } = {}) {
  if (!hasAI() || !items.length) return 0;
  if (await aiPauseInfo()) return 0; // 한도 초과로 쉬는 중이면 미리 분석도 쉼
  const dayKey = `prewarm/count/${kstDate(0)}`;
  const cnt = (await getJSON(dayKey))?.n || 0;
  if (cnt >= DAILY_MAX) return 0;
  const todo = [];
  for (const it of items) {
    if (todo.length >= Math.min(max, DAILY_MAX - cnt)) break;
    if (await getJSON(`ai3/${it.id}`)) continue;
    todo.push(it);
  }
  if (!todo.length) return 0;
  const until = Date.now() + budgetMs;
  // 두 건씩 동시에
  for (let i = 0; i < todo.length && Date.now() < until; i += 2) {
    await Promise.race([Promise.all(todo.slice(i, i + 2).map(runOne)), new Promise((r) => setTimeout(r, Math.max(1000, until - Date.now())))]);
  }
  await setJSON(dayKey, { n: cnt + todo.length }).catch(() => {});
  return todo.length;
}

// 최근 48시간 안의 중요한 공시·보도자료 중 아직 AI 분석이 없는 것 (AI가 멈췄던 동안 밀린 것도 자동으로 채움)
const recent = (ms, h = 48) => Date.now() - ms < h * 3600e3;
export const pickSec = (items) => (items || []).filter((x) => x.ticker && x.impact >= 3 && !/^(4|144|13F)/.test(x.form || '') && recent(Date.parse(x.time))).slice(0, 80);
export const pickDart = (items) => (items || []).filter((x) => x.ticker && x.impact >= 3 && (x.seenAt ? recent(Date.parse(x.seenAt)) : x.date >= kstDate(-2))).slice(0, 80);
export const pickPR = (items) => (items || []).filter((x) => x.src === 'PR' && x.market === 'US' && x.ticker && recent(Date.parse(x.time))).slice(0, 80);

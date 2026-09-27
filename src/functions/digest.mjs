// /api/digest — AI가 고른 오늘의 핵심 공시·뉴스 (30분마다 새로 분석)
import { json, kstDate } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hasAI, dailyDigest } from '../lib/ai.mjs';

export default async () => {
  if (!hasAI()) return json({ ok: false, needsKey: true, error: 'AI 키가 없습니다' }, { cdnSeconds: 300 });
  const cached = await getJSON('ai/digest');
  if (cached && Date.now() - cached.at < 30 * 60e3) return json({ ok: true, ...cached }, { cdnSeconds: 300, swr: 600 });
  try {
    const [sec, dart, news] = await Promise.all([getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
    const since = Date.now() - 24 * 3600e3;
    const today = kstDate(0);
    const pick = [];
    for (const x of sec?.items || []) if (Date.parse(x.time) > since && x.impact >= 4) pick.push({ id: x.id, m: 'US', co: x.name, t: x.ko?.title || x.pr?.headline || x.formKo, f: x.form });
    for (const x of dart?.items || []) if ((x.date === today || Date.parse(x.seenAt || 0) > since) && x.impact >= 4) pick.push({ id: x.id, m: 'KR', co: x.name, t: x.summary?.title || x.titleClean || x.formKo });
    for (const x of news?.items || []) if (Date.parse(x.time) > since && x.src === 'PR' && x.ticker) pick.push({ id: x.id, m: x.market, co: x.company || x.ticker, t: x.titleKo || x.title });
    const list = pick.slice(0, 70);
    if (!list.length) return json({ ok: true, headline: '오늘은 아직 주요 공시가 없습니다.', items: [], at: Date.now() }, { cdnSeconds: 120 });
    const d = await dailyDigest(list);
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    d.items = d.items.filter((x) => byId[x.id]).map((x) => ({ ...x, company: byId[x.id].co, market: byId[x.id].m }));
    const out = { ...d, at: Date.now() };
    await setJSON('ai/digest', out).catch(() => {});
    return json({ ok: true, ...out }, { cdnSeconds: 300, swr: 600 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 });
  }
};

export const config = { path: '/api/digest' };

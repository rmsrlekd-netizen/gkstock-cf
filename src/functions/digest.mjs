// /api/digest?mk=ALL|KR|US — AI가 고른 오늘의 핵심 공시·보도자료 (시장별 30분마다 새로 분석)
import { json, kstDate } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hasAI, dailyDigest } from '../lib/ai.mjs';

const recentMs = (x) => Date.parse(x.time || x.seenAt || (x.date ? x.date + 'T09:00:00+09:00' : 0)) || 0;

function collect(sec, dart, news, mk, hours) {
  const since = Date.now() - hours * 3600e3;
  const out = [];
  if (mk !== 'KR') {
    for (const x of sec?.items || []) if (Date.parse(x.time) > since && x.impact >= 4 && x.ticker) out.push({ id: x.id, m: 'US', co: x.name, t: x.ko?.title || x.pr?.headline || x.formKo, f: x.form, imp: x.impact, ms: Date.parse(x.time) });
  }
  if (mk !== 'US') {
    const today = kstDate(0);
    for (const x of dart?.items || []) if ((x.date === today || recentMs(x) > since) && x.impact >= 4) out.push({ id: x.id, m: 'KR', co: x.name, t: x.summary?.title || x.titleClean || x.formKo, imp: x.impact, ms: recentMs(x) });
  }
  for (const x of news?.items || []) {
    if (x.src !== 'PR' || !x.ticker || Date.parse(x.time) <= since) continue;
    if (mk !== 'ALL' && x.market !== mk) continue;
    out.push({ id: x.id, m: x.market, co: x.company || x.ticker, t: x.titleKo || x.title, imp: 3, ms: Date.parse(x.time) });
  }
  return out.sort((a, b) => b.imp - a.imp || b.ms - a.ms);
}

export default async (req) => {
  const q = new URL(req.url).searchParams.get('mk');
  const mk = q === 'KR' || q === 'US' ? q : 'ALL';
  if (!hasAI()) return json({ ok: false, needsKey: true, error: 'AI 키가 없습니다' }, { cdnSeconds: 300 });
  const key = `ai/digest2/${mk}`;
  const cached = await getJSON(key);
  if (cached && Date.now() - cached.at < 60 * 60e3) return json({ ok: true, mk, ...cached }, { cdnSeconds: 300, swr: 600 });
  try {
    const [sec, dart, news] = await Promise.all([getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
    // 주말·연휴처럼 최근 24시간에 공시가 적으면 최대 3일까지 넓혀서 고름
    let pick = collect(sec, dart, news, mk, 24);
    let span = '오늘';
    if (pick.length < 8) { pick = collect(sec, dart, news, mk, 72); span = '최근 3일'; }
    let list;
    if (mk === 'ALL') { // 한국·미국이 한쪽으로 쏠리지 않게 반반씩
      const kr = pick.filter((x) => x.m === 'KR').slice(0, 35), us = pick.filter((x) => x.m === 'US').slice(0, 35);
      list = [...kr, ...us];
    } else list = pick.slice(0, 70);
    if (!list.length) return json({ ok: true, mk, headline: `${mk === 'KR' ? '한국' : mk === 'US' ? '미국' : ''} 주요 공시가 아직 없습니다.`.trim(), items: [], at: Date.now(), span }, { cdnSeconds: 120 });
    const note = mk === 'ALL' ? '한국(m=KR)과 미국(m=US) 항목이 모두 있으면 양쪽에서 골고루(각각 최소 2건) 고르세요.' : `모두 ${mk === 'KR' ? '한국' : '미국'} 기업입니다.`;
    const d = await dailyDigest(list.map(({ imp, ms, ...x }) => x), note);
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    d.items = d.items.filter((x) => byId[x.id]).map((x) => ({ ...x, company: byId[x.id].co, market: byId[x.id].m }));
    const out = { ...d, at: Date.now(), span };
    await setJSON(key, out).catch(() => {});
    return json({ ok: true, mk, ...out }, { cdnSeconds: 300, swr: 600 });
  } catch (e) {
    if (cached) return json({ ok: true, mk, ...cached, stale: true }, { cdnSeconds: 60 });
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 });
  }
};

export const config = { path: '/api/digest' };

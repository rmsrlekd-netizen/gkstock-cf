// /api/schedule?mk=KR|US — 내일 일정 (경제지표·실적·IPO + AI 요약)
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { buildSchedule, scheduleDates } from '../lib/schedule.mjs';

export default async (req, ctx) => {
  const u = new URL(req.url);
  const mk = u.searchParams.get('mk') === 'US' ? 'US' : 'KR';
  // 관리자: 장 마감 브리핑 바로 만들기 (?brief=run&mk=US&key=…)
  if (u.searchParams.get('brief') === 'run') {
    if (!process.env.ADMIN_KEY || u.searchParams.get('key') !== process.env.ADMIN_KEY) return new Response(JSON.stringify({ ok: false, error: '관리자 비밀번호가 맞지 않습니다.' }), { status: 403 });
    const { buildBrief } = await import('../lib/brief.mjs');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: mk === 'KR' ? 'Asia/Seoul' : 'America/New_York' }).format(new Date());
    try { return new Response(JSON.stringify({ ok: true, brief: await buildBrief(mk, date) }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 502 }); }
  }
  const briefs = { KR: await getJSON('brief/latest/KR'), US: await getJSON('brief/latest/US') };
  let s = await getJSON(`sched/v1/${mk}`);
  const stale = !s || s.focus !== scheduleDates(mk).focus;
  try {
    if (stale) { s = await buildSchedule(mk); await setJSON(`sched/v1/${mk}`, s).catch(() => {}); }
    else if (Date.now() - s.at > 30 * 60e3) refreshInBackground(ctx, 'sched-' + mk, async () => setJSON(`sched/v1/${mk}`, { ...(await buildSchedule(mk)), ai: s.ai }));
    return json({ ok: true, ...s, briefs }, { cdnSeconds: 120, swr: 600 });
  } catch (e) {
    if (s) return json({ ok: true, ...s, briefs, stale: true }, { cdnSeconds: 60 });
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 });
  }
};

export const config = { path: '/api/schedule' };

// /api/schedule?mk=KR|US — 내일 일정 (경제지표·실적·IPO + AI 요약)
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { buildSchedule, scheduleDates } from '../lib/schedule.mjs';

export default async (req, ctx) => {
  const mk = new URL(req.url).searchParams.get('mk') === 'US' ? 'US' : 'KR';
  let s = await getJSON(`sched/v1/${mk}`);
  const stale = !s || s.focus !== scheduleDates(mk).focus;
  try {
    if (stale) { s = await buildSchedule(mk); await setJSON(`sched/v1/${mk}`, s).catch(() => {}); }
    else if (Date.now() - s.at > 30 * 60e3) refreshInBackground(ctx, 'sched-' + mk, async () => setJSON(`sched/v1/${mk}`, { ...(await buildSchedule(mk)), ai: s.ai }));
    return json({ ok: true, ...s }, { cdnSeconds: 120, swr: 600 });
  } catch (e) {
    if (s) return json({ ok: true, ...s, stale: true }, { cdnSeconds: 60 });
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 });
  }
};

export const config = { path: '/api/schedule' };

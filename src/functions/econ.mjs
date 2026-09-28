// /api/econ — 미국 경제지표 일정·실제치 + AI 해석
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { econCalendar } from '../lib/econ.mjs';

async function build() {
  const d = await econCalendar();
  await setJSON('econ/v1', d).catch(() => {});
  return d;
}

export default async (req, ctx) => {
  try {
    let d = await getJSON('econ/v1');
    let mode = 'cache';
    if (!d) { d = await build(); mode = 'live'; }
    else if (Date.now() - d.at > 60e3 && refreshInBackground(ctx, 'econ', build)) mode = 'refreshing';
    return json({ ok: true, mode, ...d }, { cdnSeconds: 30, swr: 60 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 20 });
  }
};

export const config = { path: '/api/econ' };

// /api/themes — 오늘의 주도 테마·섹터 (한국: 네이버 테마·업종 / 미국: 섹터·테마 ETF)
// /api/themes?kind=theme|industry&no=543 — 한 테마(업종)의 종목 전체
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { krThemes, usThemes, krGroupStocks } from '../lib/themes.mjs';
import { getQuotes } from './quote.mjs';

async function build() {
  const errors = [];
  const prev = (await getJSON('themes/v1')) || {};
  const [kr, us] = await Promise.all([
    krThemes().catch((e) => { errors.push('KR: ' + e.message); return prev.kr || null; }),
    usThemes(getQuotes).catch((e) => { errors.push('US: ' + e.message); return prev.us || null; }),
  ]);
  // 대장주의 "오늘 움직임 이유"(따로 만들어 둔 것)가 있으면 테마에 한 줄로
  const wm = (await getJSON('why/map')) || {};
  const why = (mk, t) => { const w = wm[`${mk}|${String(t).toUpperCase()}`]; return w?.r && !/^뚜렷한/.test(w.r) && Date.now() - w.at < 20 * 3600e3 ? w.r : null; };
  for (const g of [...(kr?.themes || []), ...(kr?.worstThemes || []), ...(kr?.industries || [])]) g.why = (g.leaders || []).map((s) => why('KR', s.t)).find(Boolean) || null;
  for (const g of us?.themes || []) g.why = (g.stocks || []).map((s) => why('US', s.t)).find(Boolean) || null;
  for (const g of [...(us?.groups || []), ...(us?.sectorGroups || []), ...(us?.indexGroups || [])]) g.why = (g.leaders || []).map((s) => why('US', s.t)).find(Boolean) || null;
  const out = { at: Date.now(), kr, us, errors };
  if (kr || us) await setJSON('themes/v1', out).catch(() => {});
  return out;
}

export default async (req, ctx) => {
  const u = new URL(req.url);
  const kind = u.searchParams.get('kind');
  try {
    if (kind) {
      const no = Number(u.searchParams.get('no'));
      if (!no) return json({ ok: false, error: '번호 없음' }, { status: 400 });
      const stocks = await krGroupStocks(kind, no, 40);
      return json({ ok: true, stocks }, { cdnSeconds: 60, swr: 120 });
    }
    let d = await getJSON('themes/v1');
    let mode = 'cache';
    if (!d) { d = await build(); mode = 'live'; }
    else if (Date.now() - d.at > 90e3 && refreshInBackground(ctx, 'themes', build)) mode = 'refreshing';
    return json({ ok: true, mode, ...d }, { cdnSeconds: 60, swr: 120 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 20 });
  }
};

export const config = { path: '/api/themes' };

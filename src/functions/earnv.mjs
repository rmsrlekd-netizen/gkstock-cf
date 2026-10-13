// /api/earnv — 최근 3일 실적 발표 판정 (컨센서스 대비 상회·부합·하회) { 공시ID: { v, line, … } }
//  ?week=0|1 → 이번 주·지난주 컨센서스 상회·하회 순위 (국장·미장)
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';

export default async (req) => {
  const w = req ? new URL(req.url).searchParams.get('week') : null;
  if (w != null) {
    const { earnWeek } = await import('../lib/earnv.mjs');
    return json({ ok: true, ...(await earnWeek(w === '1' ? 1 : 0)) }, { cdnSeconds: 120, swr: 300 });
  }
  return json({ ok: true, map: (await getJSON('earn/vmap').catch(() => null)) || {} }, { cdnSeconds: 60, swr: 120 });
};
export const config = { path: '/api/earnv' };

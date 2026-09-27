// /api/sectors — 종목별 섹터·업종 (미국: Nasdaq, 한국: KIND). 화면이 한 번 받아 목록에 표시
import { json } from '../lib/util.mjs';
import { getSectors } from '../lib/sectors.mjs';

export default async () => {
  try {
    const s = await getSectors({ allowFetch: true });
    return json({ ok: true, at: s.at, errors: s.errors || [], us: s.us || {}, kr: s.kr || {} }, { cdnSeconds: 21600, swr: 86400 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e), us: {}, kr: {} }, { status: 502, cdnSeconds: 60 });
  }
};

export const config = { path: '/api/sectors' };

// /api/guru — 투자 대가 포트폴리오 (SEC 13F)  ?id=buffett → 한 명 자세히
import { json } from '../lib/util.mjs';
import { guruView } from '../lib/guru.mjs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  const d = await guruView(id ? String(id).toLowerCase() : null);
  if (!d) return json({ ok: false, error: '없는 투자자입니다' }, { status: 404, cdnSeconds: 60 });
  return json({ ok: true, ...d }, { cdnSeconds: 600, swr: 1800 });
};
export const config = { path: '/api/guru' };

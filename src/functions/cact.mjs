// /api/cact?mk=KR|US — 권리 일정 (분할·병합, 배당락, 유·무상증자·감자)
import { json } from '../lib/util.mjs';
import { cactList } from '../lib/cact.mjs';

export default async (req) => {
  const mk = new URL(req.url).searchParams.get('mk') === 'US' ? 'US' : 'KR';
  return json({ ok: true, ...(await cactList(mk)) }, { cdnSeconds: 300, swr: 900 });
};
export const config = { path: '/api/cact' };

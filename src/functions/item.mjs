// /api/item?id=… → 공시·보도자료 한 건 (피드에서 빠진 오래된 항목도 저장본으로)
import { json } from '../lib/util.mjs';
import { findFiling } from '../lib/filing-doc.mjs';
import { attachPx0 } from '../lib/px0.mjs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return json({ ok: false, error: '잘못된 ID' }, { status: 400, cdnSeconds: 60 });
  const it = await findFiling(id);
  if (!it) return json({ ok: false, error: '항목을 찾을 수 없습니다' }, { status: 404, cdnSeconds: 120 });
  const [x] = await attachPx0([it]);
  return json({ ok: true, item: x }, { cdnSeconds: 300, swr: 600 });
};

export const config = { path: '/api/item' };

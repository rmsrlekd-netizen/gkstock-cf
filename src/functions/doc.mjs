// /api/doc?id=DART-20260923000640 | SEC-0001234567-26-000001 → 공시 원문 텍스트
import { json } from '../lib/util.mjs';
import { findFiling, getFilingDoc } from '../lib/filing-doc.mjs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return json({ ok: false, error: '잘못된 공시 ID' }, { status: 400, cdnSeconds: 60 });
  try {
    const it = await findFiling(id);
    if (!it) return json({ ok: false, error: '공시를 찾을 수 없습니다 (오래된 공시일 수 있음)' }, { status: 404, cdnSeconds: 60 });
    const d = await getFilingDoc(it);
    return json({ ok: true, id, url: d.url, lines: d.lines, html: d.html || null, note: d.note || null }, { cdnSeconds: 86400, swr: 86400 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 });
  }
};

export const config = { path: '/api/doc' };

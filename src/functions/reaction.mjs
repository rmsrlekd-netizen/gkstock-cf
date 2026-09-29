// /api/reaction?mk=KR|US          — 공시 유형별 발표 후 주가 반응 통계
// /api/reaction?mk=KR&k=kr_rights — 그 유형의 최근 사례
// /api/reaction?id=DART-...       — 이 공시의 유형 통계 + (8일 지났으면) 이 공시의 실제 반응
import { json } from '../lib/util.mjs';
import { reactStats, reactCases, reactOf, typeOf, TYPES } from '../lib/react.mjs';
import { findFiling } from '../lib/filing-doc.mjs';

export default async (req) => {
  const u = new URL(req.url);
  const id = u.searchParams.get('id');
  if (id) {
    if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return json({ ok: false, error: '잘못된 ID' }, { status: 400, cdnSeconds: 60 });
    const it = await findFiling(id).catch(() => null);
    if (!it) return json({ ok: false, error: '없음' }, { status: 404, cdnSeconds: 120 });
    const mk = it.src === 'DART' || it.market === 'KR' ? 'KR' : 'US';
    const k = typeOf(it);
    if (!k) return json({ ok: true, id, k: null }, { cdnSeconds: 3600 });
    const st = await reactStats(mk);
    const own = await reactOf(id).catch(() => null);
    return json({ ok: true, id, mk, k, label: TYPES[k], stat: st.types.find((x) => x.k === k) || null, own: own && own.k === k ? { r1: own.r1, r5: own.r5 } : null }, { cdnSeconds: 600, swr: 1800 });
  }
  const mk = u.searchParams.get('mk') === 'US' ? 'US' : 'KR';
  const k = u.searchParams.get('k');
  if (k) {
    if (!TYPES[k]) return json({ ok: false, error: '없는 유형' }, { status: 400, cdnSeconds: 300 });
    return json({ ok: true, mk, k, label: TYPES[k], cases: await reactCases(mk, k, 40) }, { cdnSeconds: 600, swr: 1800 });
  }
  const st = await reactStats(mk);
  return json({ ok: true, ...st }, { cdnSeconds: 600, swr: 1800 });
};

export const config = { path: '/api/reaction' };

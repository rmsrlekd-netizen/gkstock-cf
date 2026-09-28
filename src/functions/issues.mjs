// /api/issues?mk=KR|US        — 최신 "오늘 주요 이슈" + 지난 회차 목록
// /api/issues?id=kr-20260928-2 — 특정 회차
// /api/issues?mk=KR&run=1&key=관리자키 — 지금 회차를 바로 새로 만들기 (관리자)
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { dueSlot, buildEdition, saveEdition, parseId } from '../lib/issues.mjs';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function makeNow(mk) {
  const s = dueSlot(mk, new Date(), { force: true });
  const idx = (await getJSON(`issues/idx/${mk}`)) || [];
  const prev = idx[0] ? await getJSON(`issues/ed/${idx[0].id}`) : null;
  const ed = await buildEdition(mk, s, s.date, { prev, force: true });
  await saveEdition(ed);
  return ed;
}

export default async (req, ctx) => {
  const u = new URL(req.url);
  const id = u.searchParams.get('id');
  if (id) {
    if (!parseId(id)) return json({ ok: false, error: '잘못된 주소' }, { status: 400, cdnSeconds: 60 });
    const ed = await getJSON(`issues/ed/${id}`);
    if (!ed) return json({ ok: false, error: '없는 회차입니다' }, { status: 404, cdnSeconds: 30 });
    return json({ ok: true, ed }, { cdnSeconds: 3600, swr: 3600 });
  }
  const mk = u.searchParams.get('mk') === 'US' ? 'US' : 'KR';
  if (u.searchParams.get('run') === '1') {
    const want = process.env.ADMIN_KEY;
    if (!want || u.searchParams.get('key') !== want) return J({ ok: false, error: '관리자 비밀번호가 맞지 않습니다.' }, 403);
    try { return J({ ok: true, ed: await makeNow(mk) }); } catch (e) { return J({ ok: false, error: String(e.message || e) }, 502); }
  }
  const idx = (await getJSON(`issues/idx/${mk}`)) || [];
  const ed = idx[0] ? await getJSON(`issues/ed/${idx[0].id}`) : null;
  // 아직 한 번도 안 만들어졌으면 (처음 설치 직후) 1분 안에 수집기가 가장 최근 회차를 만들어 둠
  if (!ed) return json({ ok: true, mk, ed: null, list: [], building: true }, { cdnSeconds: 20 });
  return json({ ok: true, mk, ed, list: idx.slice(0, 40) }, { cdnSeconds: 60, swr: 300 });
};

export const config = { path: '/api/issues' };

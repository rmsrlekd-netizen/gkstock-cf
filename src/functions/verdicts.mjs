// /api/verdicts POST {ids:[...]} → { v: {id: '긍정'|'중립'|'부정'} }
// 목록·트렌딩 카드의 호재/악재 표시를 상세 화면의 AI 판단과 맞추기 위해, 이미 만들어진 AI 분석 결과만 돌려줌 (새로 분석하지 않음)
import { json } from '../lib/util.mjs';
import { getManyJSON } from '../lib/store.mjs';

const ID = /^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/;
export default async (req) => {
  let ids = [];
  try { ids = [...new Set(((await req.json()).ids || []).filter((x) => ID.test(x)))].slice(0, 80); } catch {}
  const got = await getManyJSON([...ids.map((id) => `ai3/${id}`), ...ids.map((id) => `aiq/${id}`)]);
  const v = {};
  for (const id of ids) {
    const a = got[`ai3/${id}`] && !got[`ai3/${id}`].fallback ? got[`ai3/${id}`] : got[`aiq/${id}`];
    if (a?.verdict && !a.fallback) v[id] = a.verdict;
  }
  return json({ ok: true, v }, { cdnSeconds: 0 });
};

export const config = { path: '/api/verdicts' };

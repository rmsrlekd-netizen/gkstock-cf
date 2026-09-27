// /api/translate  POST {ids:[...]} → { tr: {id: '한국어 제목'} }
// 영어로 남아 있는 보도자료·뉴스·공시 제목을 AI로 한국어화 (결과는 저장해 모든 방문자가 재사용)
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hasAI, translateTitles } from '../lib/ai.mjs';

const hasKo = (s) => /[가-힣]/.test(s || '');

export default async (req) => {
  let ids = [];
  try { ids = ((await req.json()).ids || []).filter((x) => /^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(x)).slice(0, 40); } catch {}
  const map = (await getJSON('tr/map')) || {};
  const out = {};
  const need = [];
  for (const id of ids) { if (map[id]) out[id] = map[id]; else need.push(id); }
  if (need.length && hasAI()) {
    const [news, sec] = await Promise.all([getJSON('news/feed'), getJSON('sec/feed')]);
    const all = new Map([...(news?.items || []), ...(sec?.items || [])].map((x) => [x.id, x]));
    const batch = [];
    for (const id of need) {
      const it = all.get(id);
      if (!it) continue;
      if (it.titleKo) { out[id] = map[id] = it.titleKo; continue; }
      const title = it.src === 'SEC' ? it.pr?.headline || it.pr?.itemText || '' : it.title;
      if (!title || hasKo(title)) continue;
      batch.push({ id, title: title.slice(0, 200), desc: (it.desc || it.pr?.deck || '').slice(0, 200) });
    }
    for (let i = 0; i < batch.length; i += 20) {
      try {
        const ko = await translateTitles(batch.slice(i, i + 20));
        for (const [id, t] of Object.entries(ko)) out[id] = map[id] = t;
      } catch (e) { console.warn('translate', e.message); break; }
    }
    const keys = Object.keys(map);
    if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) delete map[k];
    await setJSON('tr/map', map).catch(() => {});
  }
  return json({ ok: true, tr: out }, { cdnSeconds: 0 });
};

export const config = { path: '/api/translate' };

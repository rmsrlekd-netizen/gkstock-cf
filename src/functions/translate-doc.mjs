// /api/translate-doc?id=SEC-… | PR-… | NEWS-… → 영어 원문을 한국어 문단으로 번역 (결과 저장 → 모든 방문자 재사용)
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { findFiling, getFilingDoc } from '../lib/filing-doc.mjs';
import { hasAI, translateParagraphs } from '../lib/ai.mjs';

const CHUNK = 3000;     // 한 번에 번역할 글자 수
const MAX_CHUNKS = 5;   // 최대 약 15,000자 (그 이상은 앞부분만 번역)
const hangulRatio = (s) => { const t = s.replace(/\s/g, ''); return t ? (t.match(/[가-힣]/g) || []).length / t.length : 0; };

function chunkLines(lines) {
  const chunks = [];
  let cur = [], len = 0, total = 0;
  for (let l of lines) {
    l = String(l || '').trim();
    if (!l) continue;
    if (l.length > CHUNK) l = l.slice(0, CHUNK);
    if (len + l.length > CHUNK && cur.length) { chunks.push(cur); cur = []; len = 0; if (chunks.length >= MAX_CHUNKS) break; }
    cur.push(l); len += l.length; total += l.length;
  }
  if (cur.length && chunks.length < MAX_CHUNKS) chunks.push(cur);
  const used = chunks.reduce((a, c) => a + c.length, 0);
  return { chunks, cut: used < lines.filter((x) => String(x || '').trim()).length };
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return json({ ok: false, error: '잘못된 ID' }, { status: 400, cdnSeconds: 60 });
  const key = `trdoc/${id}`;
  const cached = await getJSON(key);
  if (cached?.lines?.length) return json({ ok: true, id, ...cached, cached: true }, { cdnSeconds: 86400, swr: 86400 });
  if (!hasAI()) return json({ ok: false, error: 'AI 키가 없어 번역할 수 없습니다' }, { status: 503, cdnSeconds: 60 });
  try {
    const it = await findFiling(id);
    if (!it) return json({ ok: false, error: '문서를 찾을 수 없습니다' }, { status: 404, cdnSeconds: 60 });
    const d = await getFilingDoc(it);
    const lines = (d.lines || []).filter((x) => String(x || '').trim());
    if (!lines.length) return json({ ok: false, error: '원문이 비어 있습니다' }, { status: 404, cdnSeconds: 120 });
    if (hangulRatio(lines.slice(0, 40).join(' ')) > 0.3) return json({ ok: true, id, korean: true, lines }, { cdnSeconds: 86400 });
    const { chunks, cut } = chunkLines(lines);
    const res = await Promise.allSettled(chunks.map((c) => translateParagraphs(c)));
    const out = [];
    let failed = 0;
    res.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length) out.push(...r.value);
      else { failed++; out.push(...chunks[i]); }
    });
    if (failed === chunks.length) throw new Error(res.find((r) => r.status === 'rejected')?.reason?.message || '번역 실패');
    const body = { lines: out, cut, partial: failed > 0, at: Date.now() };
    if (!failed) await setJSON(key, body).catch(() => {});
    return json({ ok: true, id, ...body }, { cdnSeconds: failed ? 0 : 86400, swr: 86400 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e).slice(0, 300) }, { status: 502, cdnSeconds: 0 });
  }
};

export const config = { path: '/api/translate-doc' };

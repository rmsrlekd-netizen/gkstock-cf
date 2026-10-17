// v230 과거 재현 결과를 조각으로 나눠 저장 (3년치는 한 값에 넣기엔 너무 큼 — D1 값 크기 한도)
//  mp/bt/trades → { v, parts, n, nf, at } + mp/bt/trades/p0, p1 … (각 per개)
//  예전 형식({ t:[…] } / { rows:[…] } / { r:[…] })도 그대로 읽힘
import { getJSON, setJSON } from './store.mjs';

export async function partsReset(base, v, extra = {}) { await setJSON(base, { v, parts: 0, n: 0, ...extra, at: Date.now() }); }

export async function partsAppend(base, items, { per = 1500, maxParts = 30, nf = null, v = null } = {}) {
  const meta = (await getJSON(base)) || { v, parts: 0, n: 0 };
  if (meta.parts == null) { meta.parts = 0; meta.n = 0; } // 예전 형식은 새 조각으로 시작
  let k = Math.max(0, meta.parts - 1);
  let cur = meta.parts ? (await getJSON(`${base}/p${k}`)) || [] : [];
  let added = 0, full = false;
  for (const it of items) {
    if (cur.length >= per) { await setJSON(`${base}/p${k}`, cur); k++; cur = []; if (k >= maxParts) { full = true; break; } }
    cur.push(it); added++;
  }
  if (!full) await setJSON(`${base}/p${k}`, cur);
  meta.parts = Math.min(maxParts, k + 1); meta.n = (meta.n || 0) + added; meta.at = Date.now(); if (full) meta.full = 1;
  if (nf) { meta.nf = meta.nf || {}; for (const [a, b] of Object.entries(nf)) meta.nf[a] = (meta.nf[a] || 0) + b; }
  await setJSON(base, meta);
  return added;
}

/** 전체 읽기: { ...meta, list } — 예전 형식이면 list = t/rows/r */
export async function partsLoad(base) {
  const meta = await getJSON(base);
  if (!meta) return null;
  if (meta.parts == null) return { ...meta, list: meta.t || meta.rows || meta.r || [] };
  const ps = await Promise.all(Array.from({ length: meta.parts }, (_, i) => getJSON(`${base}/p${i}`).catch(() => null)));
  return { ...meta, list: ps.flatMap((x) => x || []) };
}

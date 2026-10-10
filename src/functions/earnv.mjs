// /api/earnv — 최근 3일 실적 발표 판정 (컨센서스 대비 상회·부합·하회) { 공시ID: { v, line, … } }
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';

export default async () => json({ ok: true, map: (await getJSON('earn/vmap').catch(() => null)) || {} }, { cdnSeconds: 60, swr: 120 });
export const config = { path: '/api/earnv' };

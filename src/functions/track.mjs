// /api/track POST {t:'pv'|'item', id, ref, m} — 방문 기록 (통계는 관리자만 볼 수 있음)
import { track } from '../lib/stats.mjs';

export default async (req, ctx) => {
  if (req.method !== 'POST') return new Response('', { status: 405 });
  let b = {};
  try { b = await req.json(); } catch {}
  const p = track(req, b).catch((e) => console.warn('track', e.message));
  if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
  return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/track' };

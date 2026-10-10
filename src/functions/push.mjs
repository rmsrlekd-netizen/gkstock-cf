// /api/push — 웹 푸시 알림 구독
//  GET  ?vapid=1                       → { key } (브라우저 구독에 쓰는 공개 열쇠)
//  POST { ep, p256dh, auth, w:[...], big } → 구독 등록·관심종목 갱신
//  POST { unsub: ep }                   → 구독 해제
import { json } from '../lib/util.mjs';
import { vapid, saveSub, removeSub } from '../lib/push.mjs';

export default async (req) => {
  try {
    if (req.method === 'GET') return json({ ok: true, key: (await vapid()).pub }, { cdnSeconds: 3600 });
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, { status: 405 });
    const b = await req.json().catch(() => ({}));
    if (b.unsub) { await removeSub(String(b.unsub)); return json({ ok: true }); }
    return json({ ok: true, ...(await saveSub(b)) });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e).slice(0, 200) }, { status: 400 });
  }
};

export const config = { path: '/api/push' };

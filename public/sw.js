// GK의 공시레이더 — 앱 설치용 서비스 워커
// 항상 최신 데이터를 보여주기 위해 네트워크 우선. 인터넷이 끊겼을 때만 마지막으로 저장한 첫 화면을 보여줌
const CACHE = 'gk-shell-v5';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // 데이터·이미지 요청은 그대로 통과
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && new URL(req.url).pathname === '/') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/'))
  );
});

// ───── 푸시 알림: 사이트·앱을 닫아 둬도 관심종목 새 공시가 오면 알림 ─────
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'GK의 공시레이더', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'GK의 공시레이더', {
    body: d.body || '새 소식이 있어요',
    tag: d.tag || undefined,
    icon: '/img/icon-192.png?v=4',
    badge: '/img/icon-192.png?v=4',
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (new URL(w.url).origin === self.location.origin && 'focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});

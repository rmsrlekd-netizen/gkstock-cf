// GK의 공시레이더 — 앱 설치용 서비스 워커
// 항상 최신 데이터를 보여주기 위해 네트워크 우선. 인터넷이 끊겼을 때만 마지막으로 저장한 첫 화면을 보여줌
const CACHE = 'gk-shell-v1';
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

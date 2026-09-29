const CACHE_NAME = 'acom-v2';   // #473 푸시 추가
const urlsToCache = ['/', '/index.html', '/styles.css', '/app.js', '/logo.png'];

// 설치 시 기본 리소스 캐싱
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

// 이전 캐시 정리
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// #473 웹 푸시 — 서버가 보낸 알림을 폰 화면에 띄운다
self.addEventListener('push', event => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : "" }; }
    const title = d.title || "제주아꼼이네";
    event.waitUntil(self.registration.showNotification(title, {
        body: d.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: d.link || "akkome",
        renotify: true,
        data: { link: d.link || "" },
    }));
});

// 알림을 누르면 이미 열린 창을 앞으로, 없으면 새로 연다
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const link = (event.notification.data && event.notification.data.link) || "";
    const url = "/" + (link ? "#" + link : "");
    event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
        for (const c of list) { if ("focus" in c) { if (link && "navigate" in c) c.navigate(url); return c.focus(); } }
        return clients.openWindow(url);
    }));
});

// 네트워크 우선 (Network First) 전략
self.addEventListener('fetch', event => {
    // API 요청은 캐싱하지 않음
    if (event.request.url.includes('/api/')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 성공 시 캐시 업데이트
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

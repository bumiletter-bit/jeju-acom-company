// #1062(대표 11/9) 「아꼼이 문자」 앱 서비스 워커 — scope /sms/ · 캐시 없음(화면은 늘 서버에서)
//   알림 = 서버 push.sendApp 이 보낸 { title, body, link, tag, app:'sms' } · 같은 손님 = tag 'sms-<대화id>' 로 한 장 덮어쓰기(다시 울림)
//   누르면 = 열린 문자 앱 창이 있으면 그 창을 앞으로 + 그 대화로 · 없으면 /sms/#agent-office?sms=<id> 새로 엶(대화 열기 = app.js notiApplyHash 길 그대로)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// 삼성 인터넷·옛 크로미움은 fetch 처리기가 있어야 「앱 설치」를 허락함 → 아무것도 안 하는 처리기(respondWith 없음 = 브라우저가 평소대로 네트워크 · 캐시 0)
self.addEventListener('fetch', () => { });

self.addEventListener('push', event => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
    const tag = d.tag || (d.link ? 'sms-' + d.link : 'akkome-sms');
    event.waitUntil(self.registration.showNotification(d.title || '아꼼이 문자', {
        body: d.body || '',
        icon: '/sms/icon-192.png',
        badge: '/sms/icon-192.png',
        tag,
        renotify: true,
        data: { link: d.link || '' },
    }));
});

// 알림 → 여는 주소(검증이 떼어 부름)
const smsUrlOf = link => '/sms/' + (link ? '#' + link : '');
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const link = (event.notification.data && event.notification.data.link) || '';
    const url = smsUrlOf(link);
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const mine = list.filter(c => { try { return new URL(c.url).pathname.startsWith('/sms/'); } catch (e) { return false; } });
        for (const c of mine) { if ('focus' in c) { if (link && 'navigate' in c) c.navigate(url).catch(() => { }); return c.focus(); } }
        return self.clients.openWindow(url);
    }));
});

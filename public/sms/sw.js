// #1062(대표 11/9) 「아꼼이 문자」 앱 서비스 워커 — scope /sms/ · 캐시 없음(화면은 늘 서버에서)
//   알림 = 서버 push.sendApp 이 보낸 { title, body, link, tag, app:'sms' } · 같은 손님 = tag 'sms-<대화id>' 로 한 장 덮어쓰기(다시 울림)
//   누르면 = 열린 문자 앱 창이 있으면 그 창을 앞으로 + 그 대화로 · 없으면 /sms/#agent-office?sms=<id> 새로 엶(대화 열기 = app.js notiApplyHash 길 그대로)
// #1062-e(대표 「문자 앱 늦다」) 정적 파일 캐시 = sms-v1
//   · /sms/ 화면(HTML) = 네트워크 우선(로그인·서버 치환 때문) · 못 받으면(끊김) 마지막 받은 것
//   · 같은 도메인 js/css/글꼴/그림 파일 = stale-while-revalidate(캐시 먼저 보여 주고 뒤에서 새로 받아 갈아 둠) · ?v= 캐시 번호가 바뀌면 다른 주소라 새로 받음 · 같은 파일의 옛 ?v= 판은 지움
//   · /api/ · /media/ · 다른 도메인(CDN 은 브라우저 자체 캐시가 오래 들고 있음 · 불투명 응답은 저장 안 함) · GET 아닌 것 = 손대지 않음(네트워크 그대로)
//   삼성 인터넷·옛 크로미움 「앱 설치」 조건 = fetch 처리기 있음(이 처리기가 그 몫도 함)
const CACHE = 'sms-v1';
const STATIC_RE = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|webmanifest)$/i;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sms-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
async function putFresh(req, res) {   // 같은 경로의 옛 ?v= 판은 지우고 새 판만 둠
    if (!res || !res.ok || res.type === 'opaque') return;
    const c = await caches.open(CACHE), u = new URL(req.url);
    for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k); }
    await c.put(req, res);
}
function staleWhileRevalidate(event) {
    const req = event.request;
    const net = fetch(req).then(res => { const keep = res && res.ok ? res.clone() : null; if (keep) event.waitUntil(putFresh(req, keep).catch(() => { })); return res; });
    return caches.open(CACHE).then(c => c.match(req)).then(hit => {
        if (hit) { event.waitUntil(net.catch(() => { })); return hit; }
        return net;
    });
}
function networkFirst(event) {
    const req = event.request, key = new Request(new URL(req.url).origin + '/sms/');
    return fetch(req).then(res => { if (res && res.ok) { const keep = res.clone(); event.waitUntil(caches.open(CACHE).then(c => c.put(key, keep)).catch(() => { })); } return res; })
        .catch(() => caches.open(CACHE).then(c => c.match(key)).then(hit => hit || Response.error()));
}
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let u; try { u = new URL(req.url); } catch (e) { return; }
    if (u.origin !== self.location.origin) return;
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/media/')) return;
    if (req.mode === 'navigate') { if (u.pathname === '/sms/') event.respondWith(networkFirst(event)); return; }
    if (STATIC_RE.test(u.pathname) && u.pathname !== '/sms/sw.js') event.respondWith(staleWhileRevalidate(event));
});

// #1062-d 아이콘 숫자 = payload.badge(안 읽은 대화 수) → setAppBadge(0 = 지움) · 지원 안 하는 브라우저(안드로이드 크롬·삼성 인터넷 대부분)는 조용히 넘김 = 런처가 떠 있는 알림 수로 셈
const setBadge = n => { try { const nav = self.navigator; if (!nav || !Number.isInteger(n) || n < 0) return Promise.resolve(); return Promise.resolve(n > 0 ? (nav.setAppBadge && nav.setAppBadge(n)) : (nav.clearAppBadge && nav.clearAppBadge())).catch(() => { }); } catch (e) { return Promise.resolve(); } };
self.addEventListener('push', event => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
    // type 'badge' = 숫자만(알림 없음) — 서버는 지금 이 꼴을 안 보냄(웹 푸시 userVisibleOnly: 알림 없이 끝나면 브라우저가 대신 알림을 띄움) · 받으면 숫자만
    if (d.type === 'badge') { event.waitUntil(Promise.all([setBadge(Number(d.n)), syncUnread(d, '')])); return; }
    const tag = d.tag || (d.link ? 'sms-' + d.link : 'akkome-sms');
    event.waitUntil(Promise.all([setBadge(d.badge), self.registration.showNotification(d.title || '아꼼이 문자', {
        body: d.body || '',
        icon: '/sms/icon-192.png',
        badge: '/sms/icon-192.png',
        tag,
        renotify: true,
        data: { link: d.link || '' },
    }).then(() => syncUnread(d, tag))]));
});
// #1062-f 알림 맞추기 — 안드로이드 아이콘 숫자 = 떠 있는 알림 수 → 안 읽은 대화 수와 같게
//   payload.unread 에 있는데 알림이 없는 대화(사용자가 지움 등) = 조용히 되살림(silent · renotify false) · unread_full 일 때만 목록에 없는(읽은) 대화 알림 닫음 · 이번 알림(tag)은 건드리지 않음
async function syncUnread(d, curTag) {
    try {
        if (!d || !Array.isArray(d.unread) || !self.registration.getNotifications) return;
        const want = new Map(d.unread.filter(u => u && u.id).map(u => ['sms-' + u.id, u]));
        const shown = await self.registration.getNotifications(), have = new Set();
        for (const n of shown) {
            if (!/^sms-\d+$/.test(n.tag || '')) continue;
            have.add(n.tag);
            if (d.unread_full === true && !want.has(n.tag) && n.tag !== curTag) n.close();
        }
        for (const [t, u] of want) {
            if (have.has(t) || t === curTag) continue;
            await self.registration.showNotification(u.t || '아꼼이 문자', { body: u.b || '', icon: '/sms/icon-192.png', badge: '/sms/icon-192.png', tag: t, renotify: false, silent: true, data: { link: 'agent-office?sms=' + u.id } });
        }
    } catch (e) { /* 맞추기 실패는 무시(이번 알림은 이미 떴음) */ }
}

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

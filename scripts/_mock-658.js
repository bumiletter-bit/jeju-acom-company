// #658 톡톡 | 상품문의 | 주문문의 탭(public/ao-inbox.js) 시공용 가짜 서버 — DB·외부 호출 0 · 메모리 안 지어낸 자료
//   사용: node scripts/_mock-658.js [포트=3466]   (verify-658-ui.js 가 스스로 띄운다)
//   ① /api/inbox/* = docs/inbox-threads-spec.md(워커3) 꼴: GET counts · GET threads?ch=&scope=&q= · GET threads/:ch/:id(?peek=1 = 읽음 안 바꿈) · POST …/send { text, seen } · …/read · …/unread · …/draft(톡톡)
//   ② /__inbox.html = 문자 창과 같은 틀(.desk > #desk-sms.sms-modal > .sms-win)에 탭 줄과 #inb-host 만 둔 시험 화면(ao-desk.js 없이 ao-inbox.js 만)
//   ③ 시험용: GET /__mock/log · POST /__mock/reset · POST /__mock/set { fail:'send'|'draft'|'list'|'', gone:true(=404 로 라우트 없음), swap:'새 초안'(=다음 send 전에 서버 초안을 바꿔 409) } · POST /__mock/push { ch, id, body }
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const PORT = Number(process.argv[2] || process.env.PORT658 || 3466);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const iso = minAgo => new Date(Date.now() - minAgo * 60000).toISOString();
const PIC = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#F3E9D2"/><circle cx="230" cy="250" r="120" fill="#F2A33A"/><circle cx="420" cy="230" r="96" fill="#E08A2E"/><text x="24" y="52" font-family="sans-serif" font-size="30" fill="#222">mock 사진</text></svg>`;

let ST;
function seed() {
    let mid = 100;
    const m = (direction, sender, body, minAgo, o) => Object.assign({ id: ++mid, direction, sender, body, at: iso(minAgo), image_url: null }, o || {});
    const T = (ch, id, title, msgs, o) => Object.assign({ ch, id, title, sub: null, state: 'open', why: null, read: false, draft: null, can_send: true, cannot_why: null, messages: msgs }, o || {});
    ST = {
        fail: '', gone: false, swap: '', log: [],
        threads: [
            T('talk', 't1', '귤좋아', [m('in', 'customer', '안녕하세요', 32), m('in', 'customer', '오늘 주문하면 언제 받을 수 있나요?', 30)]),
            T('talk', 't2', '한라산바람', [m('in', 'customer', '귤이 몇 개 터져서 왔어요', 50), m('in', 'customer', '', 49, { image_url: '/__mock/pic.svg' }), m('out', 'bot', '불편드려 죄송합니다. 사진 확인했어요.', 48), m('in', 'customer', '그래서 어떻게 해주시나요', 20)], { why: '불만·클레임' }),
            T('talk', 't3', '노을진바다', [m('in', 'customer', '단체 주문 견적 부탁드려요. 50박스요.', 70)], { why: 'AI가 직원에게 넘김' }),
            T('talk', 't4', '귤러버', [m('in', 'customer', '보관은 어떻게 해요?', 300), m('out', 'bot', '서늘하고 바람이 통하는 곳에 두세요.', 299)], { read: true, state: 'ai' }),
            T('talk', 't5', '카카오 손님', [m('in', 'customer', '카카오로 문의드려요. 배송 언제 되나요?', 15)], { can_send: false, cannot_why: '카카오 채널 대화는 여기서 보낼 수 없어요. 카카오 채널 관리자센터에서 답해 주세요.' }),
            T('talk', 't6', '아주아주아주아주아주아주아주아주아주 긴 대화명을 쓰는 손님입니다', [m('in', 'customer', '긴글 ' + '도착 시간과 보관 방법, 선물 포장이 되는지도 함께 알려주시면 좋겠습니다. '.repeat(5), 5)]),
            T('qna', 'q1', '고당도 하우스감귤 가정용 4kg 로얄과 산지직송', [m('in', 'customer', '로얄과면 크기가 어느 정도인가요? 아이들 간식으로 괜찮을까요?', 40)], { sub: '귤**** · 공개', draft: '안녕하세요, 제주아꼼이네입니다. 로얄과는 S~M 정도로 한 손에 쏙 들어오는 크기예요. 아이들 간식으로 드시기 좋습니다.' }),
            T('qna', 'q2', '제주 황금향 선물용 3kg', [m('in', 'customer', '명절 전에 받을 수 있나요', 90, { note: '봇이 넘긴 글' })], { sub: '김**** · 공개', why: '자동 등록 실패', post_error: '네이버 응답 500' }),
            T('qna', 'q3', '미니밤호박 특품 5kg', [m('in', 'customer', '찌는 시간 알려주세요', 1500), m('out', 'staff', '전자레인지에 7~8분 돌려 드시면 됩니다.', 1400, { by: '조가영', via: 'center' })], { sub: '박**** · 공개', state: 'done', read: true, can_send: false, cannot_why: '이미 답변한 문의예요. 수정은 스마트스토어 센터에서 해 주세요.' }),
            T('inquiry', 'i1', '홍** · 주문 끝 4821', [m('in', 'customer', '배송지 변경 가능할까요? 아직 발송 전이면 부탁드려요.', 25)], { sub: '하우스감귤 가정용 4kg · 배송 문의', draft: '안녕하세요, 제주아꼼이네입니다. 아직 발송 전이라 변경 가능합니다. 바꾸실 주소를 알려 주시면 반영해 드릴게요.' }),
            T('inquiry', 'i2', '이** · 주문 끝 1180', [m('in', 'customer', '교환 문의드립니다', 200)], { sub: '한라봉 가정용 3kg · 교환 문의', why: '반품·교환·환불', read: true }),
        ],
    };
}
seed();
const unreadOf = t => (t.read ? 0 : t.messages.filter(x => x.direction === 'in').length);
const last = t => t.messages[t.messages.length - 1] || {};
const row = t => { const l = last(t); return { ch: t.ch, id: t.id, title: t.title, sub: t.sub, last_text: l.body || (l.image_url ? '(사진)' : ''), last_at: l.at, last_dir: l.direction || 'in', unread: unreadOf(t), state: t.state, why: t.why, needs_reply: t.state === 'open', has_draft: !!t.draft, can_send: t.can_send }; };
const counts = () => { const o = {}; ['talk', 'qna', 'inquiry'].forEach(ch => { const a = ST.threads.filter(t => t.ch === ch); o[ch] = { unread: a.filter(t => unreadOf(t) > 0).length, open: a.filter(t => t.state === 'open').length }; }); return o; };   /* open = 답 안 한 대화 수(읽음 무관) */
const send = (res, code, obj, type) => { const b = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj); res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { r(s ? JSON.parse(s) : {}); } catch (e) { r({}); } }); });

const HARNESS = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>#658 시험 화면</title>
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/ao-desk.css"><link rel="stylesheet" href="/ao-inbox.css">
<style>body{margin:0}.sms-tabs{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--d-line);overflow-x:auto}.sms-tabs button{flex:none;min-height:44px;padding:0 14px;border:0;border-radius:10px;background:none;color:var(--d-sub);font:inherit;font-size:14px;font-weight:700;cursor:pointer}.sms-tabs button[aria-selected=true]{background:var(--d-accent-soft);color:var(--d-accent)}.sms-tabs b{margin-left:6px}</style></head>
<body class="sms-win-open"><div class="desk" style="display:block"><section class="desk-tool sms-modal" id="desk-sms" role="dialog" aria-modal="true" aria-label="문자"><div class="sms-win">
<div class="desk-tool-head"><b>문자</b><span>시험 화면(탭 줄은 임시)</span><button type="button" class="desk-btn sm desk-tool-x" id="sms-close">닫기</button></div>
<div class="sms-tabs" id="sms-tabs" role="tablist"><button role="tab" data-ch="talk" aria-selected="true">톡톡<b></b></button><button role="tab" data-ch="qna" aria-selected="false">상품문의<b></b></button><button role="tab" data-ch="inquiry" aria-selected="false">주문문의<b></b></button></div>
<div class="inb-host" id="inb-host"></div></div></section></div>
<script>try{localStorage.setItem('jwt_token','mock')}catch(e){}
window.showToast=function(m,t,ms){document.querySelectorAll('.toast-message').forEach(function(n){n.remove()});var d=document.createElement('div');d.className='toast-message show';d.textContent=m;document.body.appendChild(d);setTimeout(function(){d.remove()},ms||2500)};
window.__on=[];</script><script src="/ao-inbox.js"></script>
<script>(function(){var host=document.getElementById('inb-host'),p=new URLSearchParams(location.search);if(p.get('dark'))document.documentElement.setAttribute('data-ao-theme','dark');
function go(ch,openId){document.querySelectorAll('#sms-tabs button').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.ch===ch))});AkmInbox.mount(host,{ch:ch,openId:openId,onThread:function(o){window.__on.push(o)}})}
document.getElementById('sms-tabs').addEventListener('click',function(e){var b=e.target.closest('button');if(b)go(b.dataset.ch)});
AkmInbox.onCounts(function(c){window.__counts=c;document.querySelectorAll('#sms-tabs button').forEach(function(b){var n=c&&c[b.dataset.ch]?c[b.dataset.ch].unread:0;b.querySelector('b').textContent=n?n:''})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')window.__esc=AkmInbox.back()});
window.__go=go;if(!p.get('nomount'))go(p.get('ch')||'talk',p.get('open')||undefined);setInterval(function(){AkmInbox.refresh()},1000)})();</script></body></html>`;

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/__inbox.html') return send(res, 200, HARNESS, MIME['.html']);
    if (p === '/__mock/pic.svg') return send(res, 200, PIC, MIME['.svg']);
    if (p === '/__mock/log') return send(res, 200, { log: ST.log, threads: ST.threads.map(t => ({ id: t.id, read: t.read, state: t.state, draft: t.draft, n: t.messages.length })) });
    if (p === '/__mock/reset') { seed(); return send(res, 200, { ok: true }); }
    if (p === '/__mock/set') { Object.assign(ST, await body(req)); return send(res, 200, { ok: true }); }
    if (p === '/__mock/push') { const b = await body(req), t = ST.threads.find(x => x.ch === b.ch && x.id === b.id); if (t) { t.messages.push({ id: Date.now(), direction: 'in', sender: 'customer', body: b.body || '또 문의드려요', at: new Date().toISOString(), image_url: null }); t.read = false; if (b.draft) t.draft = b.draft; } return send(res, 200, { ok: !!t }); }
    if (p.startsWith('/api/inbox/')) {
        if (ST.gone) return send(res, 404, { error: 'not found' });
        if (p === '/api/inbox/counts') return send(res, 200, { counts: counts() });
        if (p === '/api/inbox/threads' && req.method === 'GET') {
            if (ST.fail === 'list') return send(res, 500, { error: 'boom' });
            const ch = u.searchParams.get('ch'), scope = u.searchParams.get('scope') || 'active', q = (u.searchParams.get('q') || '').trim();
            let a = ST.threads.filter(t => t.ch === ch);
            if (q) a = a.filter(t => (t.title + ' ' + t.messages.map(x => x.body).join(' ')).includes(q));
            else if (scope === 'open') a = a.filter(t => t.state === 'open');
            else if (scope !== 'all') a = a.filter(t => unreadOf(t) > 0);
            a.sort((x, y) => String(last(y).at).localeCompare(String(last(x).at)));
            return send(res, 200, { threads: a.map(row), counts: counts() });
        }
        const mm = p.match(/^\/api\/inbox\/threads\/(talk|qna|inquiry)\/([^/]+)(?:\/(send|read|unread|draft))?$/);
        if (mm) {
            const t = ST.threads.find(x => x.ch === mm[1] && x.id === decodeURIComponent(mm[2])), act = mm[3];
            if (!t) return send(res, 404, { error: '대화를 찾지 못했어요' });
            if (!act && req.method === 'GET') {
                const peek = u.searchParams.get('peek') === '1'; if (!peek) t.read = true;
                ST.log.push({ op: 'get', ch: t.ch, id: t.id, peek });
                return send(res, 200, { thread: row(t), messages: t.messages, draft: t.draft, can_send: t.can_send, cannot_why: t.cannot_why, can_draft: t.ch === 'talk' && t.can_send, post_error: t.post_error || null, limits: { max_chars: t.ch === 'talk' ? 1000 : 2000, confirm: false, public: t.ch === 'qna', pii_note: t.ch === 'qna' ? '공개 게시판에 올라가요. 전화번호·이메일·주소는 적지 마세요.' : null, time_note: t.ch === 'talk' ? '봇·직원 답의 시각은 그 손님 글 시각으로 보여요.' : null } });
            }
            if (req.method !== 'POST') return send(res, 405, { error: 'method' });
            const b = await body(req);
            if (act === 'read') { t.read = true; ST.log.push({ op: 'read', ch: t.ch, id: t.id }); return send(res, 200, { ok: true }); }
            if (act === 'unread') { t.read = false; ST.log.push({ op: 'unread', ch: t.ch, id: t.id }); return send(res, 200, { ok: true }); }
            if (act === 'draft') {
                if (t.ch !== 'talk') return send(res, 400, { error: '톡톡만 초안을 만들 수 있어요' });
                if (ST.fail === 'draft') return send(res, 502, { ok: false, error: 'AI 호출에 실패했어요' });
                t.draft = '안녕하세요, 제주아꼼이네입니다. 문의 주신 내용 확인했어요. (봇 초안 ' + (ST.log.filter(x => x.op === 'draft').length + 1) + ')';
                ST.log.push({ op: 'draft', ch: t.ch, id: t.id }); return send(res, 200, { ok: true, draft: t.draft });
            }
            if (act === 'send') {
                if (ST.swap) { t.draft = ST.swap; ST.swap = ''; }
                if (!t.can_send && ST.fail !== 'already') return send(res, 400, { ok: false, error: t.cannot_why || '보낼 수 없는 대화예요' });
                if (ST.fail === 'send') return send(res, 502, { ok: false, error: '네이버가 거절했어요', code: 'send_failed' });
                if (ST.fail === 'already') { t.state = 'done'; t.can_send = false; t.cannot_why = '이미 답변한 문의예요. 수정은 스마트스토어 센터에서 해 주세요.'; t.draft = null; return send(res, 409, { ok: false, error: '이미 답변한 문의예요', code: 'already' }); }
                if (String(b.seen || '') !== String(t.draft || '')) { ST.log.push({ op: 'conflict', ch: t.ch, id: t.id, seen: b.seen }); return send(res, 409, { ok: false, error: '초안이 바뀌었어요', code: 'draft_changed', draft: t.draft }); }
                const text = String(b.text || '').trim(); if (!text) return send(res, 400, { ok: false, error: '보낼 글이 없어요' });
                t.messages.push({ id: Date.now(), direction: 'out', sender: 'staff', body: text, at: new Date().toISOString(), image_url: null });
                t.draft = null; t.read = true; t.why = null;
                if (t.ch !== 'talk') { t.state = 'done'; t.can_send = false; t.post_error = null; } else t.state = 'staff';
                ST.log.push({ op: 'send', ch: t.ch, id: t.id, text, seen: b.seen || '' });
                return send(res, 200, { ok: true });
            }
        }
        return send(res, 404, { error: 'not found' });
    }
    if (p.startsWith('/api/')) return send(res, 200, {});
    const f = path.join(PUB, path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, ''));
    if (!f.startsWith(PUB)) return send(res, 403, 'no', 'text/plain');
    fs.readFile(f, (e, buf) => { if (e) return send(res, 404, 'not found', 'text/plain'); send(res, 200, buf, MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); });
}).listen(PORT, () => console.log('mock-658 http://localhost:' + PORT + '/__inbox.html'));

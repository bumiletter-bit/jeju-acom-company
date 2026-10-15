// #708-C 손님 이벤트 페이지(public/lucky.html) 검증 — 설정 칸(그림·문구·상태·미리보기)
//   node scripts/verify-708-page.js
//   · 서버·DB 무접촉: 자체 express(포트 3462)가 public/ 정적 파일 + 가짜 /api/lucky/* 를 낸다(실DB 쓰기 0)
//   · 고치기 전 페이지 = git HEAD 의 lucky.html(/old.html) · 고친 뒤 = 디스크 본(/lucky.html) — 같은 응답에서 DOM 이 같아야 한다(설정 비움 = 종전 그대로)
//   · Playwright(chromium) · 390/560 · 콘솔 오류 0 · 미리보기(iframe postMessage)
'use strict';
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const express = require('express');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT708 || 3462);
const BASE = `http://127.0.0.1:${PORT}`;
const OLD_REF = process.env.OLD_REF || 'ac67689';   // #708 앞 lucky.html(HEAD 는 #708 뒤라 옛 비교 기준이 못 됨)
let pass = 0, failN = 0;
const ok = (m, c, d) => { if (c) { pass++; console.log('  ✅', m); } else { failN++; console.log('  ❌', m, d !== undefined ? '→ ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) : ''); } };

const OLD_HTML = execSync(`git show ${OLD_REF}:public/lucky.html`, { cwd: ROOT, encoding: 'utf8' });
const NEW_HTML = fs.readFileSync(path.join(ROOT, 'public', 'lucky.html'), 'utf8');

/* ── 가짜 응답 ── */
const BASE_EVENT = () => ({ title: '제주아꼼이네 고객 감사 이벤트', start: '2026-10-20', end: '2026-10-31', announce: '2026-11-02', prizes: [{ name: '황금향 5kg 선물용', count: 5 }, { name: '황금향 3kg 선물용', count: 7 }, { name: '감귤 3kg 선물용', count: 10 }], published: false, excludeProducts: ['청귤'] });
const SRV_TEXTS = { prize_head_hand: '제주의 좋은 마음을 선물합니다! ♡', corner_hand: '늘 함께해 주셔서\n감사합니다! ♡', search_hand: '성함·번호로 확인해보세요! ♡', winner_hand: '함께해 주신 모든 분께 감사드립니다! ♡', winner_foot: '당첨되신 분께는 순차적으로 연락드리며, 경품은 주문 시 배송지로 보내드립니다 🍊', noitem_products: '감귤·황금향 등', preparing_title: '이벤트 준비 중이에요 🍊', preparing_line: '곧 열립니다. 조금만 기다려 주세요!', closed_title: '이벤트가 끝났어요 🙏', closed_line: '함께해 주셔서 감사합니다. 당첨되신 분께는 순차적으로 연락드려요.' };
const SRV_NEW = (ev) => ({ display_title: ev.title, page_until: '2026-11-05', state: 'live', live_mode: 'live', images: { hero: null, winner: null, result: null }, texts: Object.assign({}, SRV_TEXTS), store_url: 'https://smartstore.naver.com/akkome', prizes: ev.prizes.map(p => Object.assign({ desc: '', note: '', image: null }, p)) });
let EVENT_RES = null, WIN_RES = { published: false, groups: [] };
const setEvent = (extra = {}, top = {}) => { EVENT_RES = Object.assign({ event: Object.assign(BASE_EVENT(), extra), counts: { orders: 12, customers: 9 } }, top); };
const ORD = (o) => Object.assign({ by: 'buyer', inRange: true, noitem: false, date: '2026-10-21', vendor: '효돈', product: '하우스감귤 4.5kg', qty: 2, buyer: '김*수', buyerPhone: '010-****-1234', recv: '이*영', recvPhone: '010-****-5678', addr: '서울특별시 강남구 테헤란로 …', tracking: '****1234' }, o);
const LOOKUP = {
  none: () => ({ ok: true, mode: 'name', by: null, results: [] }),
  received: () => ({ ok: true, mode: 'name', by: 'buyer', results: [ORD({ status: 'received', prize: null })] }),
  win: () => ({ ok: true, mode: 'phone', by: 'buyer', results: [ORD({ status: 'win', prize: '황금향 5kg 선물용' })] }),
  lose: () => ({ ok: true, mode: 'name', by: 'buyer', results: [ORD({ status: 'lose', prize: null })] }),
  noitem: () => ({ ok: true, mode: 'name', by: 'buyer', results: [ORD({ status: 'noitem', inRange: false, noitem: true, product: '청귤 1kg', prize: null })] }),
  outside: () => ({ ok: true, mode: 'name', by: 'buyer', results: [ORD({ status: 'outside', inRange: false, date: '2026-09-01', prize: null })] }),
  receiver: () => ({ ok: true, mode: 'name', by: 'receiver', results: [ORD({ by: 'receiver', status: 'received', prize: null }), ORD({ by: 'receiver', status: 'received', inRange: false, date: '2026-09-02', prize: null })] }),
  short: () => [400, { error: 'SHORT' }],
  preparing: () => [400, { error: 'PREPARING' }],
};

const app = express();
app.use(express.json());
app.get('/old.html', (_q, r) => r.type('html').send(OLD_HTML));
app.get('/lucky.html', (_q, r) => r.type('html').send(NEW_HTML));
app.get('/pv.html', (_q, r) => r.type('html').send(`<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="/lucky.html?preview=1" style="width:390px;height:1400px;border:0"></iframe>
<script>window.READY=0;window.RENDERED=[];window.addEventListener('message',e=>{ if(e.origin!==location.origin||!e.data) return; if(e.data.type==='lucky:ready') window.READY++; if(e.data.type==='lucky:rendered') window.RENDERED.push(e.data.scene); });
window.send=m=>document.getElementById('f').contentWindow.postMessage(m,location.origin);</script>`));
app.use('/img', express.static(path.join(ROOT, 'public', 'img')));
let EVENT_HITS = 0;
app.get('/api/lucky/event', (q, r) => { EVENT_HITS++; const o = JSON.parse(JSON.stringify(EVENT_RES)); if (q.query.pk === 'goodkey') o.event.preview = true; r.json(o); });
let WIN_HITS = 0, LOOKUP_HITS = 0;
app.get('/api/lucky/winners', (_q, r) => { WIN_HITS++; r.json(WIN_RES); });
app.post('/api/lucky/lookup', (q, r) => { LOOKUP_HITS++; const f = LOOKUP[String(q.body.q || '').trim()] || LOOKUP.none; const v = f(); if (Array.isArray(v)) return r.status(v[0]).json(v[1]); r.json(Object.assign({ event: EVENT_RES.event }, v)); });
app.get('/api/lucky/asset/:id', (_q, r) => r.status(404).end());

(async () => {
  const srv = await new Promise(res => { const s = app.listen(PORT, '127.0.0.1', () => res(s)); });
  const browser = await chromium.launch();
  const errs = [];
  async function open(url, width = 560, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(url + ' pageerror ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/status of 400/.test(m.text()) && !(opts.allow404 && /404|Failed to load resource/.test(m.text()))) errs.push(url + ' console ' + m.text()); });
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(250);
    return { ctx, pg };
  }
  const bodyHtml = pg => pg.evaluate(() => { const b = document.body.cloneNode(true); b.querySelectorAll('script').forEach(s => s.remove()); return b.innerHTML.replace(/\s+/g, ' ').trim(); });
  const snap = async (pg) => ({ html: await bodyHtml(pg), title: await pg.title() });
  async function both(url, fn) {
    const A = await open('/old.html' + url), B = await open('/lucky.html' + url);
    if (fn) { await fn(A.pg); await fn(B.pg); }
    const a = await snap(A.pg), b = await snap(B.pg);
    await A.ctx.close(); await B.ctx.close();
    return { a, b };
  }
  const firstDiff = (x, y) => { let i = 0; while (i < x.length && x[i] === y[i]) i++; return `@${i} 전「${x.slice(i - 40, i + 80)}」 후「${y.slice(i - 40, i + 80)}」`; };
  const doLookup = q => async pg => { await pg.fill('#q', q); await pg.click('#btn'); await pg.waitForTimeout(300); };

  try {
    console.log('① 설정 비움(종전 응답 꼴) = 고치기 전 페이지와 DOM 동일');
    setEvent();
    let r = await both('');
    ok('첫 화면 body DOM·제목 동일(접수 중)', r.a.html === r.b.html && r.a.title === r.b.title, firstDiff(r.a.html, r.b.html));
    for (const k of ['none', 'received', 'win', 'lose', 'noitem', 'outside', 'receiver', 'short']) {
      r = await both('', doLookup(k));
      ok(`조회 결과 「${k}」 DOM 동일`, r.a.html === r.b.html, firstDiff(r.a.html, r.b.html));
    }
    r = await both('', doLookup('preparing'));
    ok('조회 400 PREPARING = 새 안내(종전 「조회할 수 없어요」 · 의도된 변화)', /조회할 수 없어요/.test(r.a.html) && /이벤트 준비 중이에요. 열리면 조회할 수 있어요/.test(r.b.html) && r.a.html.replace(/<div class="big">[^<]*<\/div>/, '') === r.b.html.replace(/<div class="big">[^<]*<\/div>/, ''), firstDiff(r.a.html, r.b.html));
    setEvent({ published: true });
    WIN_RES = { published: true, announce: '2026-11-02', total: 3, groups: [{ rank: 1, prize: '황금향 5kg 선물용', count: 5, winners: [{ name: '김*수', phone: '010-****-1234' }] }, { rank: 2, prize: '황금향 3kg 선물용', count: 7, winners: [] }, { rank: 3, prize: '감귤 3kg 선물용', count: 10, winners: [{ name: '박*', phone: '010-****-9999' }] }] };
    r = await both('');
    ok('발표 중(당첨자 창 자동 열림) DOM 동일', r.a.html === r.b.html && /wmodal" role="dialog" aria-modal="true" aria-labelledby="wtitle"|class="modal on"/.test(r.b.html), firstDiff(r.a.html, r.b.html));
    setEvent({ prizes: [{ name: '레몬 3kg', count: 2 }, { name: '감귤', count: 1 }, { name: '키위', count: 1 }, { name: '4등 경품', count: 3 }] });
    r = await both('');
    ok('경품 4개(그림 3장 넘음 · 새 칸 없음) DOM 동일', r.a.html === r.b.html, firstDiff(r.a.html, r.b.html));
    setEvent({}, { state: 'live' }); r = await both('');
    ok('state live(새 칸 없음) = 종전 DOM', r.a.html === r.b.html, firstDiff(r.a.html, r.b.html));
    setEvent({ published: true }, { state: 'published' }); r = await both('');
    ok('state published = 종전 DOM', r.a.html === r.b.html, firstDiff(r.a.html, r.b.html));
    WIN_RES = { published: false, groups: [] };

    console.log('①-b 실제 서버 꼴(새 칸이 전부 기본값으로 채워져 옴) = 종전 DOM 동일');
    const srvEv = (extra = {}) => { const ev = Object.assign(BASE_EVENT(), extra); return Object.assign(ev, SRV_NEW(ev)); };
    EVENT_RES = { event: srvEv(), counts: { orders: 12, customers: 9 } };
    r = await both('');
    ok('기본값 칸(texts 전부·display_title=title·images null·prizes desc/note "" image null·state live) = 종전 DOM', r.a.html === r.b.html && r.a.title === r.b.title, firstDiff(r.a.html, r.b.html));
    for (const k of ['noitem', 'win']) { r = await both('', doLookup(k)); ok(`기본값 칸 + 조회 「${k}」 DOM 동일`, r.a.html === r.b.html, firstDiff(r.a.html, r.b.html)); }
    EVENT_RES = { event: Object.assign(srvEv({ published: true }), { state: 'published' }), counts: { orders: 12, customers: 9 } };
    WIN_RES = { published: true, announce: '2026-11-02', total: 1, groups: [{ rank: 1, prize: '황금향 5kg 선물용', count: 5, winners: [{ name: '김*수', phone: '010-****-1234' }] }] };
    r = await both('');
    ok('기본값 칸 + published(발표 창 아래 안내 굵은 글씨 그대로) DOM 동일', r.a.html === r.b.html && r.b.html.includes('<b>순차적으로 연락</b>'), firstDiff(r.a.html, r.b.html));
    WIN_RES = { published: false, groups: [] };

    console.log('② 새 칸 = 그 값');
    const T = Object.assign({}, SRV_TEXTS, { prize_head_hand: '레몬처럼 상큼하게! ♡', corner_hand: '언제나\n고맙습니다 ♡', search_hand: '번호로 바로 확인!', winner_hand: '축하드려요! ♡', winner_foot: '당첨되신 분께는 문자로 연락드려요.\n경품은 11월 둘째 주 발송', noitem_products: '레몬·하우스귤 등' });
    EVENT_RES = { event: Object.assign(srvEv({ prizes: [{ name: '그린레몬 3kg', count: 3 }, { name: '하우스귤 2.5kg', count: 5 }, { name: '감귤 3kg', count: 10 }, { name: '4등 키위', count: 2 }] }), {
      display_title: '그린레몬 첫 수확 감사 이벤트', texts: T, store_url: 'https://smartstore.naver.com/akkome',
      images: { hero: '/img/lucky_winner_hero.webp', winner: '/img/lucky_hero_full.webp', result: '/img/lucky_box1.webp' },
      prizes: [{ name: '그린레몬 3kg', count: 3, desc: '첫 수확 그린레몬\n상큼함 그대로', note: '상큼 그 자체!', image: '/img/lucky_box3.webp' }, { name: '하우스귤 2.5kg', count: 5, desc: '', note: '', image: '/img/lucky_box1.webp' }, { name: '감귤 3kg', count: 10, desc: '감귤 설명', note: '', image: null }, { name: '4등 키위', count: 2, desc: '키위 설명', note: '키위!', image: '/img/lucky_box2.webp' }] }), counts: { orders: 3, customers: 2 } };
    let P = await open('/lucky.html');
    let v = await P.pg.evaluate(() => ({ title: document.title, hero: document.querySelector('.hero .banner').getAttribute('src'), heroAlt: document.querySelector('.hero .banner').getAttribute('alt'), head: (document.querySelector('#evHead .t') || {}).textContent, sr: document.getElementById('evTitle').textContent,
      win: document.querySelector('.mhero img').getAttribute('src'), hands: [...document.querySelectorAll('.card .head .hand')].map(e => e.innerHTML), corner: document.querySelector('.note .r .hand').innerHTML, wh: document.querySelector('.mtitle .hand').innerHTML, wf: document.querySelector('.mfoot .msg').innerHTML,
      prizes: [...document.querySelectorAll('.prize')].map(p => ({ img: p.querySelector('.pimg img') ? p.querySelector('.pimg img').getAttribute('src') : null, d: p.querySelector('.d').innerHTML, n: p.querySelector('.pimg .hand').textContent })) }));
    ok('<title>·배너 alt·숨은 제목 = display_title', v.title === '그린레몬 첫 수확 감사 이벤트 — 접수·당첨 확인' && v.heroAlt === '그린레몬 첫 수확 감사 이벤트' && v.sr === '그린레몬 첫 수확 감사 이벤트', v);
    ok('새 배너 그림 + 그림 밖 큰 제목(#evHead)', v.hero === '/img/lucky_winner_hero.webp' && v.head === '그린레몬 첫 수확 감사 이벤트', v);
    ok('발표 창 그림 = 설정 값', v.win === '/img/lucky_hero_full.webp', v.win);
    ok('손글씨 3곳(경품 카드·조회 카드·오른쪽 아래 줄바꿈)', v.hands[0] === T.prize_head_hand && v.hands[1] === T.search_hand && v.corner === '언제나<br>고맙습니다 ♡', v);
    ok('발표 창 손글씨·아래 안내(줄바꿈 → <br>)', v.wh === T.winner_hand && v.wf === '당첨되신 분께는 문자로 연락드려요.<br>경품은 11월 둘째 주 발송', v);
    ok('경품 1: 설명(줄바꿈)·손글씨·그림 = 설정', v.prizes[0].img === '/img/lucky_box3.webp' && v.prizes[0].d === '첫 수확 그린레몬<br>상큼함 그대로' && v.prizes[0].n === '상큼 그 자체!', v.prizes[0]);
    ok('경품 2: 그림만 설정 · 설명·손글씨 "" 이면 종전 2등 값', v.prizes[1].img === '/img/lucky_box1.webp' && v.prizes[1].d === '황금향이 가득한 제주 황금향<br>달콤한 행복을 선물하세요' && v.prizes[1].n === '달콤한 선물!', v.prizes[1]);
    ok('경품 3: image null = 종전 3등 그림 · 설명만 설정', v.prizes[2].img === 'img/lucky_box3.webp' && v.prizes[2].d === '감귤 설명' && v.prizes[2].n === '신선한 제주 감귤!', v.prizes[2]);
    ok('경품 4(4등 · 종전엔 그림 없음): 설정 그림·설명·손글씨', v.prizes[3].img === '/img/lucky_box2.webp' && v.prizes[3].d === '키위 설명' && v.prizes[3].n === '키위!', v.prizes[3]);
    await doLookup('noitem')(P.pg);
    v = await P.pg.evaluate(() => ({ sub: document.querySelector('#result .sub').textContent, pic: document.querySelector('#result .pic').getAttribute('src') }));
    ok('대상 외 문장 품목 = noitem_products · 결과 그림 = images.result', v.sub.includes('레몬·하우스귤 등 다른 상품 주문은 자동 접수') && v.pic === '/img/lucky_box1.webp', v);
    ok('일반 손님 주소에는 「미리보기」 표시 없음', !(await P.pg.evaluate(() => !!document.getElementById('pvBadge'))));
    await P.ctx.close();

    console.log('③ 그림 주소가 깨지면 기본 그림으로(onerror)');
    EVENT_RES = { event: Object.assign(srvEv({ prizes: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }, { name: 'C', count: 1 }, { name: 'D', count: 1 }] }), { images: { hero: '/api/lucky/asset/9990?v=aa', winner: '/api/lucky/asset/9992', result: '/api/lucky/asset/9993' } }), counts: { orders: 1, customers: 1 } };
    EVENT_RES.event.prizes[0].image = '/api/lucky/asset/9991'; EVENT_RES.event.prizes[3].image = '/api/lucky/asset/9994';
    P = await open('/lucky.html', 560, { allow404: true });
    await P.pg.waitForTimeout(500);
    await doLookup('received')(P.pg); await P.pg.waitForTimeout(400);
    v = await P.pg.evaluate(() => ({ hero: document.querySelector('.hero .banner').getAttribute('src'), heroW: document.querySelector('.hero .banner').naturalWidth, win: document.querySelector('.mhero img').getAttribute('src'),
      p1: document.querySelectorAll('.prize .pimg img')[0].getAttribute('src'), p4: [...document.querySelectorAll('.prize')][3].querySelector('.pimg img').style.display, pic: document.querySelector('#result .pic').getAttribute('src') }));
    ok('배너 404 → img/lucky_hero_full.webp(실제로 그려짐)', v.hero === 'img/lucky_hero_full.webp' && v.heroW > 0, v);
    ok('발표 창 404 → 기본 · 경품 1 404 → 기본 1등 그림 · 결과 그림 404 → 기본 소녀', v.win === 'img/lucky_winner_hero.webp' && v.p1 === 'img/lucky_box1.webp' && v.pic === 'img/lucky_girl_bottom.webp', v);
    ok('기본 그림이 없는 4등 그림 404 → 숨김(깨진 그림 표시 없음)', v.p4 === 'none', v);
    await P.ctx.close();

    console.log('④ 상태 장(준비 중 · 끝남) · 미리보기 키');
    const stEv = (state, extra = {}) => ({ event: Object.assign(srvEv({ start: '2026-10-20' }), { state, prizes: [], images: { hero: null, winner: null, result: null } }, extra), counts: { orders: 0, customers: 0 } });
    EVENT_RES = stEv('preparing');
    P = await open('/lucky.html');
    v = await P.pg.evaluate(() => ({ st: (document.getElementById('stCard') || {}).innerText || '', shown: [...document.querySelectorAll('.wrap > .card:not(#stCard)')].map(c => getComputedStyle(c).display), q: document.querySelector('#q').offsetParent !== null }));
    ok('preparing = 「준비 중」 한 장(서버 문구) · 경품·조회 카드 숨김 · 시작일 안내', /이벤트 준비 중이에요/.test(v.st) && /곧 열립니다/.test(v.st) && /10월 20일부터 시작해요/.test(v.st) && v.shown.every(d => d === 'none') && !v.q, v);
    await P.ctx.close();
    EVENT_RES = stEv('preparing', { texts: Object.assign({}, SRV_TEXTS, { preparing_title: '그린레몬 이벤트 곧 시작!', preparing_line: '10월 20일 아침에 열려요' }) });
    P = await open('/lucky.html');
    v = await P.pg.evaluate(() => document.getElementById('stCard').innerText);
    ok('preparing 문구 칸 = 그 값', /그린레몬 이벤트 곧 시작!/.test(v) && /10월 20일 아침에 열려요/.test(v), v);
    await P.ctx.close();
    EVENT_RES = { event: Object.assign(srvEv(), { state: 'preparing' }), counts: { orders: 0, customers: 0 } };
    P = await open('/lucky.html?pk=goodkey');
    v = await P.pg.evaluate(() => ({ st: !!document.getElementById('stCard'), prizes: document.querySelectorAll('.prize').length, badge: (document.getElementById('pvBadge') || {}).textContent }));
    ok('?pk=(서버가 event.preview:true) = 준비 중이어도 본 화면 + 「미리보기」 표시', !v.st && v.prizes === 3 && v.badge === '미리보기', v);
    await P.ctx.close();
    EVENT_RES = stEv('down', { texts: Object.assign({}, SRV_TEXTS, { closed_line: '함께해 주셔서 감사합니다.\n다음 이벤트에서 만나요' }) });
    P = await open('/lucky.html');
    v = await P.pg.evaluate(() => { const a = document.querySelector('#stCard a.buy'); return { st: (document.getElementById('stCard') || {}).innerText || '', href: a && a.getAttribute('href'), tgt: a && a.getAttribute('target'), h: a && a.getBoundingClientRect().height, hidden: [...document.querySelectorAll('.wrap > .card:not(#stCard)')].every(c => getComputedStyle(c).display === 'none') }; });
    ok('down = 「이벤트가 끝났어요」 + store_url 단추(새 창 · 44px↑) · 문구 칸 줄바꿈', /이벤트가 끝났어요/.test(v.st) && /다음 이벤트에서 만나요/.test(v.st) && v.href === 'https://smartstore.naver.com/akkome' && v.tgt === '_blank' && v.h >= 44 && v.hidden, v);
    await P.ctx.close();
    EVENT_RES = stEv('down', { store_url: 'javascript:alert(1)' });
    P = await open('/lucky.html');
    v = await P.pg.evaluate(() => document.querySelector('#stCard a.buy').getAttribute('href'));
    ok('store_url 이 https 가 아니면 기본 스토어 주소로', v === 'https://brand.naver.com/jejuakkome', v);
    await doLookup('preparing')(P.pg).catch(() => {});
    await P.ctx.close();

    console.log('⑤ 직원 글 이스케이프');
    EVENT_RES = { event: Object.assign(srvEv({ prizes: [{ name: '<b>x</b>', count: 1 }] }), { display_title: '<img src=x onerror=alert(1)>', texts: Object.assign({}, SRV_TEXTS, { prize_head_hand: '<img src=x onerror=alert(2)>', winner_foot: '"><svg onload=alert(3)>' }), images: { hero: 'javascript:alert(4)', winner: '" onerror="alert(5)', result: null } }), counts: { orders: 0, customers: 0 } };
    EVENT_RES.event.prizes[0] = { name: '<b>x</b>', count: 1, desc: '<script>alert(1)</script>', note: '<i>n</i>', image: '"><img src=x>' };
    P = await open('/lucky.html');
    v = await P.pg.evaluate(() => ({ imgs: [...document.querySelectorAll('img')].map(i => i.getAttribute('src')), svg: document.querySelectorAll('svg').length, b: document.querySelectorAll('.prize b, .prize i, .prize script').length, hand: document.querySelector('.card .head .hand').textContent, hero: document.querySelector('.hero .banner').getAttribute('src'), win: document.querySelector('.mhero img').getAttribute('src') }));
    ok('글자는 글자로(새 img·svg·b·script 요소 0) · javascript:·따옴표 그림 주소는 버림(기본 그림)', !v.imgs.includes('x') && v.svg === 0 && v.b === 0 && v.hand === '<img src=x onerror=alert(2)>' && v.hero === 'img/lucky_hero_full.webp' && v.win === 'img/lucky_winner_hero.webp', v);
    await P.ctx.close();

    console.log('⑥ 390 / 560 가로 넘침 0');
    const longEv = () => { const ev = srvEv({ prizes: [{ name: '그린레몬 3kg 선물용 아주 긴 경품 이름', count: 3 }, { name: 'b', count: 1 }, { name: 'c', count: 1 }, { name: 'd', count: 1 }] }); ev.display_title = '아주 긴 이벤트 제목이 들어가도 줄바꿈으로 버티는지 보는 그린레몬 감사 이벤트'; ev.images.hero = '/img/lucky_winner_hero.webp'; ev.texts.prize_head_hand = '손글씨가 길어져도 한 줄 말줄임으로 버티는지 보는 문장 ♡'; ev.prizes[0].desc = '설명 '.repeat(20); ev.prizes[0].note = '긴 손글씨 한마디 시험'; ev.prizes[3].image = '/img/lucky_box2.webp'; return { event: ev, counts: { orders: 0, customers: 0 } }; };
    const cases = [['종전 꼴', () => setEvent()], ['새 칸 전부', () => { EVENT_RES = longEv(); }], ['준비 중', () => { EVENT_RES = stEv('preparing'); }], ['끝남', () => { EVENT_RES = stEv('down'); }]];
    for (const [nm, set] of cases) for (const w of [390, 560]) {
      set(); P = await open('/lucky.html', w);
      const o = await P.pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(`${nm} ${w}px 가로 넘침 0`, o <= 0, o); await P.ctx.close();
    }

    console.log('⑦ 미리보기(관리 화면 iframe · postMessage · docs/708-api.md 4절)');
    setEvent(); EVENT_HITS = 0;
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 } }); const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push('pv pageerror ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('pv console ' + m.text()); });
    await pg.goto(BASE + '/pv.html', { waitUntil: 'networkidle' }); await pg.waitForTimeout(400);
    const fr = () => pg.frame({ url: /preview=1/ });
    ok('iframe 이 열리면 부모에게 「lucky:ready」 · 서버 조회 0', (await pg.evaluate(() => window.READY)) >= 1 && EVENT_HITS === 0, { ready: await pg.evaluate(() => window.READY), hits: EVENT_HITS });
    const draft = Object.assign(srvEv({ title: '초안 이벤트', prizes: [{ name: '초안 경품 레몬', count: 4 }, { name: '둘째', count: 1 }] }), { display_title: '초안 레몬 이벤트', state: 'live' });
    draft.prizes[0].desc = '초안 설명'; draft.texts.search_hand = '초안 손글씨';
    draft.images.hero = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, counts: { orders: 0, customers: 0 }, scene: 'default' }), draft); await pg.waitForTimeout(250);
    v = await fr().evaluate(() => ({ t: document.title, names: [...document.querySelectorAll('.prize .n')].map(e => e.textContent), d: document.querySelector('.prize .d').textContent, h: document.querySelectorAll('.card .head .hand')[1].textContent, hero: document.querySelector('.hero .banner').getAttribute('src').slice(0, 22), badge: (document.getElementById('pvBadge') || {}).textContent }));
    ok('초안 postMessage → 저장 전 값으로 다시 그림(제목·경품·설명·손글씨·data: 그림) + 「미리보기」 표시', v.t === '초안 레몬 이벤트 — 접수·당첨 확인' && v.names.join('|') === '초안 경품 레몬|둘째' && v.d === '초안 설명' && v.h === '초안 손글씨' && v.hero === 'data:image/png;base64,' && v.badge === '미리보기', v);
    ok('그린 뒤 부모에게 「lucky:rendered」(scene 포함)', await pg.evaluate(() => window.RENDERED.slice(-1)[0] === 'default'), await pg.evaluate(() => window.RENDERED));
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'win' }), draft); await pg.waitForTimeout(200);
    v = await fr().evaluate(() => ({ big: (document.querySelector('#result .big') || {}).textContent, p: (document.querySelector('#result .prizebox .p') || {}).textContent }));
    ok('scene win → 가짜 당첨 결과(첫 경품 이름)', /당첨되셨어요/.test(v.big || '') && /초안 경품 레몬/.test(v.p || ''), v);
    const sceneBig = { received: /접수되었습니다/, lose: /다음 기회에/, noitem: /이벤트 대상이 아니에요/, outside: /기간 밖 주문/ };
    for (const k of Object.keys(sceneBig)) { await pg.evaluate(([d, k2]) => window.send({ type: 'lucky:preview', event: d, scene: k2 }), [draft, k]); await pg.waitForTimeout(150); const b = await fr().evaluate(() => (document.querySelector('#result .big') || {}).textContent || ''); ok(`scene ${k} → 그 결과 칸`, sceneBig[k].test(b), b); }
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'winners' }), draft); await pg.waitForTimeout(200);
    v = await fr().evaluate(() => ({ on: document.getElementById('wmodal').classList.contains('on'), g: document.querySelectorAll('#wbody .wg').length, w: document.querySelectorAll('#wbody .wl .w').length }));
    ok('scene winners → 발표 창(경품 2묶음 · 가짜 이름 2씩)', v.on && v.g === 2 && v.w === 4, v);
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'default' }), draft); await pg.waitForTimeout(150);
    v = await fr().evaluate(() => ({ on: document.getElementById('wmodal').classList.contains('on'), r: document.getElementById('result').innerHTML }));
    ok('scene default → 결과·발표 창 닫힘', !v.on && v.r === '', v);
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'preparing' }), draft); await pg.waitForTimeout(200);
    ok('scene preparing → 「준비 중」 장', await fr().evaluate(() => /이벤트 준비 중이에요/.test((document.getElementById('stCard') || {}).innerText || '')));
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'closed' }), draft); await pg.waitForTimeout(200);
    ok('scene closed → 「끝났어요」 장', await fr().evaluate(() => /이벤트가 끝났어요/.test((document.getElementById('stCard') || {}).innerText || '')));
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'default' }), draft); await pg.waitForTimeout(200);
    ok('scene default 로 돌아오면 본 화면(상태 장 사라짐 · 카드 다시 보임)', await fr().evaluate(() => !document.getElementById('stCard') && [...document.querySelectorAll('.wrap > .card')].every(c => getComputedStyle(c).display !== 'none')));
    await pg.evaluate(() => window.send({ type: 'other', event: { title: 'X', prizes: [] } })); await pg.evaluate(() => window.send('문자열')); await pg.evaluate(() => window.send({ type: 'lucky:preview' })); await pg.waitForTimeout(150);
    ok('다른 꼴 메시지는 무시(화면 그대로)', await fr().evaluate(() => document.querySelector('.prize .n').textContent === '초안 경품 레몬'));
    console.log('⑦-b #711 미리보기 장(docs/711-event-design.md 1절)');
    WIN_HITS = 0; LOOKUP_HITS = 0;
    const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const draft2 = JSON.parse(JSON.stringify(draft)); draft2.images.result = PNG1;
    for (const k of ['received', 'win', 'lose', 'noitem', 'outside']) { await pg.evaluate(([d, k2]) => window.send({ type: 'lucky:preview', event: d, scene: k2 }), [draft2, k]); await pg.waitForTimeout(150); const src = await fr().evaluate(() => ((document.querySelector('#result img.pic') || {}).getAttribute ? document.querySelector('#result img.pic').getAttribute('src') : '') || ''); ok(`(a) images.result 바꾸면 ${k} 장 왼쪽 그림 = 새 그림`, src === PNG1, src.slice(0, 40)); }
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'winners' }), draft2); await pg.waitForTimeout(200);
    v = await fr().evaluate(() => ({ m: document.querySelector('.mhero img').getAttribute('src'), pic: !!document.querySelector('#wmodal img.pic') }));
    ok('(a) 결과 그림은 발표 창에 안 쓰임(발표 창 그림 = winner 슬롯 · 기본 그림 그대로)', v.m === 'img/lucky_winner_hero.webp' && !v.pic, v);
    const draft3 = JSON.parse(JSON.stringify(draft)); draft3.published = true; draft3.state = 'published'; draft3.images.winner = PNG1;
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'default' }), draft3); await pg.waitForTimeout(300);
    v = await fr().evaluate(() => ({ info: document.getElementById('evInfo').innerText, on: document.getElementById('wmodal').classList.contains('on'), btn: !!document.querySelector('#evInfo .wbtn') }));
    ok('default + published → 「당첨자 발표 완료」 띠 + [명단 보기] · 발표 창 저절로 안 뜸 · 실 winners 호출 0', /당첨자 발표 완료/.test(v.info) && v.btn && !v.on && WIN_HITS === 0, Object.assign(v, { WIN_HITS }));
    await fr().click('#evInfo .wbtn'); await pg.waitForTimeout(300);
    v = await fr().evaluate(() => ({ on: document.getElementById('wmodal').classList.contains('on'), g: document.querySelectorAll('#wbody .wg').length, nm: (document.querySelector('#wbody .nm') || {}).textContent, m: document.querySelector('.mhero img').getAttribute('src').slice(0, 22) }));
    ok('미리보기 [명단 보기] 실클릭 → 가짜 발표 창(초안 경품 2묶음 · 홍*동 · 초안 발표 그림) · 실 winners 호출 0', v.on && v.g === 2 && v.nm === '홍*동' && v.m === 'data:image/png;base64,' && WIN_HITS === 0, Object.assign(v, { WIN_HITS }));
    await fr().click('#wclose'); await pg.waitForTimeout(150);
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'default' }), draft); await pg.waitForTimeout(200);
    await fr().fill('#q', '홍길동'); await fr().click('#btn'); await pg.waitForTimeout(300);
    v = await fr().evaluate(() => (document.querySelector('#result .big') || {}).textContent || '');
    ok('미리보기 조회 칸 실클릭 → 표본 「접수되었습니다」 장 · 실 lookup 호출 0', /접수되었습니다/.test(v) && LOOKUP_HITS === 0, { v, LOOKUP_HITS });
    await pg.evaluate(d => window.send({ type: 'lucky:preview', event: d, scene: 'closed' }), draft); await pg.waitForTimeout(200);
    let popups = 0; ctx.on('page', () => popups++);
    const frUrl = fr().url(); await fr().click('#stCard a.buy'); await pg.waitForTimeout(500);
    ok('미리보기 [스토어 가기] 실클릭 → 새 창 0 · iframe 그대로(밖으로 안 나감)', popups === 0 && fr() && fr().url() === frUrl, { popups });
    await ctx.close();
    setEvent();
    P = await open('/lucky.html');
    await P.pg.evaluate(() => window.postMessage({ type: 'lucky:preview', event: { title: '가짜', prizes: [{ name: '가짜 경품', count: 1 }] } }, location.origin)); await P.pg.waitForTimeout(200);
    ok('preview=1 이 아닌 손님 페이지는 postMessage 무시', await P.pg.evaluate(() => document.querySelector('.prize .n').textContent === '황금향 5kg 선물용'));
    { const h0 = LOOKUP_HITS; await P.pg.fill('#q', '홍길동'); await P.pg.click('#btn'); await P.pg.waitForTimeout(300); ok('일반 접속 조회는 종전대로 서버 lookup 호출(미리보기 막기가 새지 않음)', LOOKUP_HITS === h0 + 1, { h0, LOOKUP_HITS }); }
    await P.ctx.close();

    console.log('⑧ 콘솔 오류');
    ok('콘솔·페이지 오류 0(③의 일부러 깬 그림 404 · 조회 400 응답 줄 제외)', errs.length === 0, errs);
  } catch (e) { failN++; console.log('  ❌ 실행 오류', e && e.stack || e); }
  finally { await browser.close(); srv.close(); }
  console.log(`\n결과 ${pass}/${pass + failN}`);
  process.exit(failN ? 1 : 0);
})();

// #708-A 이벤트 관리 서버 검증 — lucky-event.js 새 칸·그림 표·state·미리보기 키·동기화·틱·권한 + 종전 draw/lookup 결과 동일(HEAD 판과 비교)
//   node scripts/verify-708-server.js
//   · 실DB 는 검증 전용 표 lucky_events_v708(+ _assets)만 쓰고 끝에 DROP(운영 표 lucky_events·lucky_assets 무접촉)
//   · agent_office_config·inquiry_scenarios 쓰기는 가짜 받이(sync)로 받는다 → 실DB 쓰기 0 · 러너 0 · 알림톡 무접촉
//   · 로컬 서버 포트 3463(워커3) · 인증은 가짜 미들웨어(헤더로 역할) · 주문은 전부 가짜
//   · HEAD 판 비교 = `git show HEAD:lucky-event.js` 를 스크래치에 두고 다른 표 이름으로 같이 띄움(없으면 그 구간 건너뜀)
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path'), fs = require('fs'), crypto = require('crypto'), { execSync } = require('child_process');
const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT708 || 3463);
const TABLE = 'lucky_events_vseveneight', TABLE_HEAD = 'lucky_events_vhead';   // 🔴 글자만(HEAD 판 가드 /^[a-z_]+$/ 는 숫자를 못 받아 운영 표로 떨어진다 — 10/15 실사고)
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; } else { failN++; console.log('  ❌', m); } };
const realRandomInt = crypto.randomInt;
function seedRandom(seed) { let s = seed >>> 0; crypto.randomInt = (a, b) => { const max = b === undefined ? a : b - a; s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (b === undefined ? 0 : a) + (s % max); }; }

function fakeOrders(n, seed) {
  let s = seed; const rnd = k => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % k; };
  const fam = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'], giv = ['민수', '서연', '지훈', '하은', '도윤', '수아', '예준', '지우', '현우', '서윤'];
  const prods = ['황금향 선물용 - 3kg(중대과 7~15과)', '고당도 하우스감귤 선물용 - 3kg(로얄과)', '최상품 청귤(풋귤) 5kg', '황금향 가정용 - 5kg'];
  const people = []; for (let i = 0; i < 50; i++) people.push({ name: fam[rnd(10)] + giv[rnd(10)], phone: '010-9' + String(100 + i).padStart(3, '0') + '-' + String(1000 + rnd(9000)) });
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = people[rnd(people.length) % (rnd(3) ? 20 : 50)], r = rnd(4) ? b : people[rnd(50)], day = 20 + rnd(10);
    out.push({ vendor: rnd(2) ? '대성' : '효돈', date: '2026-10-' + String(day).padStart(2, '0'), buyer: b.name, buyerPhone: rnd(9) ? b.phone : '', buyerPhone2: '', recv: r.name, recvPhone: r.phone, recvPhone2: '', product: prods[rnd(prods.length)], qty: 1 + rnd(2), addr: '제주특별자치도 서귀포시 효돈순환로 ' + (100 + i), tracking: rnd(5) ? String(700000000000 + i * 7) : '', channel: '제주아꼼이네' });
  }
  return out;
}
// 1×1 webp(바이트 그대로 · 올리기·내려받기 시험용)
const WEBP_1PX = Buffer.from('UklGRiYAAABXRUJQVlA4IBoAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=', 'base64');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  for (const t of [TABLE, TABLE + '_assets', TABLE_HEAD]) await pool.query(`DROP TABLE IF EXISTS ${t}`);
  // 🔴 운영 표 보호 단언(10/15 실사고 뒤): 검증 표 이름 ≠ 운영 표 · 운영 표 행 수·그림 표 유무·카드 설정·#59 갱신 시각을 앞뒤로 비교
  if ([TABLE, TABLE + '_assets', TABLE_HEAD].some(t => t === 'lucky_events' || t === 'lucky_assets')) { console.error('🔴 검증 표 이름이 운영 표와 같음 — 중단'); process.exit(2); }
  const realSnap = async () => ({ rows: (await pool.query(`SELECT count(*)::int AS n FROM lucky_events`)).rows[0].n, assets: (await pool.query(`SELECT to_regclass('lucky_assets') a, to_regclass('lucky_events_assets') b`)).rows[0],
    card: JSON.stringify((await pool.query(`SELECT value, updated_at FROM agent_office_config WHERE key = 'guide_event_card'`)).rows), s59: JSON.stringify((await pool.query(`SELECT id, enabled, updated_at FROM inquiry_scenarios WHERE scenario_no = 59 AND deleted_at IS NULL ORDER BY id`)).rows) });
  const realBefore = await realSnap();
  console.log(`  (운영 표 시작 상태: lucky_events ${realBefore.rows}행 · lucky_assets ${realBefore.assets.a ? '있음' : '없음'} · lucky_events_assets ${realBefore.assets.b ? '있음' : '없음'})`);
  const audits = [], cfgSets = [], scen = [];
  const writeAudit = async a => { audits.push(a); };
  const fakeAuth = (req, res, next) => { const role = req.headers['x-test-role'] || ((req.headers.authorization || '').replace('Bearer ', '') || ''); if (!role || !['staff', 'admin'].includes(role)) return res.status(401).json({ error: '인증이 필요합니다' }); req.user = { id: role === 'admin' ? 1 : 7, name: role === 'admin' ? '대표' : '직원', role }; next(); };
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '관리자 권한이 필요합니다' });
  let NOW = Date.parse('2026-10-15T03:00:00Z');   // KST 10/15 12:00
  const sync = { cfgSet: async (k, v) => { cfgSets.push({ k, v }); }, scenarioUpsert: async s => { scen.push(s); return 999; } };
  const mount = require(path.join(__dirname, '..', 'lucky-event.js'));
  const app = express(); app.use(express.json({ limit: '15mb' }));
  // #711 판매현황 가짜 행(운영 bot_products 무접촉) — 실DB 10/15 이름 꼴 그대로
  let productCalls = 0;
  const FAKE_PRODUCTS = [
    { name: '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', status: '판매중' }, { name: '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)', status: '판매중' }, { name: '하우스황금향 가정용(중소과 17과 전후) 3kg', status: '품절' }, { name: '노지황금향 10kg', status: '준비중' },
    { name: '고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', status: '판매중' }, { name: '행사★하우스귤 2.5kg로얄과→중량up 4kg', status: '준비중' },
    { name: '최상품 청귤(풋귤) 5kg', status: '시즌종료' }, { name: '최상품 청귤(풋귤) 10kg', status: '시즌종료' },
    { name: '과수 및 크기: 제주산 레드키위 3kg(로얄과)', status: '판매중' }, { name: '과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)', status: '판매중' }, { name: '유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)', status: '판매중' },
    { name: '미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)', status: '시즌종료' }, { name: '초당옥수수 중품 11개입', status: '품절' }, { name: '고구마', status: '품절' }, { name: '금귤(낑깡)', status: '품절' },
    { name: '[검증]시험특가 품목', status: '준비중' }, { name: '테스트', status: '준비중' }, { name: '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', status: '판매중' }
  ];
  const L = mount(app, { pool, authMiddleware: fakeAuth, adminOnly, writeAudit, table: TABLE, sync, now: () => NOW, secret: 'v708secret', tick: false, products: async () => { productCalls++; return FAKE_PRODUCTS; } });
  const servers = []; const listen = (a, port) => new Promise(r => { const s = a.listen(port, () => r(s)); servers.push(s); });
  if (L._assetTable !== TABLE + '_assets') { console.error('🔴 가짜 표 이름이 안 먹음(운영 표 보호) — 중단', L._assetTable); process.exit(2); }   // 10/15 실사고 재발 방지: 검증은 반드시 가짜 표에서만
  let threw = false; try { mount(express(), { pool, authMiddleware: fakeAuth, adminOnly, writeAudit, table: 'bad-name!', tick: false }); } catch (_) { threw = true; } ok(threw, '틀린 표 이름은 운영 표로 안 떨어지고 throw');
  await listen(app, PORT); const B = `http://localhost:${PORT}`;
  let ipSeq = 1;
  const jf = async (base, p, opt = {}) => { const r = await fetch(base + p, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.' + (ipSeq++ % 250) }, opt.headers || {}), body: opt.body ? JSON.stringify(opt.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, j, h: r.headers }; };
  const N = (p, body, role = 'staff', method) => jf(B, '/api/agent-office/lucky/' + p, { method: method || (body === undefined ? 'GET' : 'POST'), body: body === undefined ? undefined : (body || {}), headers: { 'x-test-role': role } });
  const PUB = (q = '') => jf(B, '/api/lucky/event' + q);
  const OLD_KEYS = ['title', 'start', 'end', 'announce', 'prizes', 'published', 'excludeProducts'];

  console.log('① 0행 = 종전 그대로(live · 기본값) + 새 칸');
  {
    const r = await PUB(); const e = r.j.event;
    ok(r.status === 200 && OLD_KEYS.every(k => k in e) && e.prizes.length === 3 && e.prizes[0].name === '황금향 5kg 선물용' && e.prizes[0].count === 5, '종전 7칸 그대로(기본 경품 3)');
    ok(e.state === 'live' && e.live_mode === 'live' && e.display_title === e.title && e.page_until === '2026-09-24' && e.images && e.images.hero === null && e.images.winner === null && e.texts && e.texts.prize_head_hand === '제주의 좋은 마음을 선물합니다! ♡' && e.texts.corner_hand.includes('\n') && typeof e.store_url === 'string' && !('preview' in e), '새 칸: state live · display_title=title · page_until=발표+3 · images null · texts 기본값 · store_url · preview 칸 없음 ' + JSON.stringify([e.state, e.page_until]));
    ok(e.prizes.every(p => p.desc === '' && p.note === '' && p.image === null), '기본 경품의 desc/note 빈 글 · image null(페이지가 종전 그림)');
    const lk = await jf(B, '/api/lucky/lookup', { body: { q: 'ㄱ' } }); ok(lk.status === 400 && lk.j.error === 'SHORT', '0행 lookup 종전(SHORT · 준비 중 아님)');
    const st = await N('state'); ok(st.status === 200 && st.j.state === 'live' && st.j.checklist && st.j.checklist.ready === true && st.j.checklist.steps.open === true && st.j.id === null, '관리 /state: state·checklist(ready) · id null');
  }

  console.log('①-b 0행에서 첫 저장 = 초안(손질 ① · 저장 즉시 손님 노출·카드·#59 켜짐 방지) · 공개는 저장 전까지 legacy 그대로');
  {
    const r = await N('event', { event: { display_title: '첫 저장 시험' } });
    ok(r.status === 200 && r.j.db.event.live_mode === 'draft' && r.j.state === 'preparing' && r.j.synced.card === false && cfgSets.length === 0 && scen.length === 0 && r.j.db.event.start === '' && r.j.db.event.page_until === '', '0행 첫 저장 → live_mode draft · 옛 기본 날짜 비움 · preparing · 동기화 0 ' + JSON.stringify([r.status, r.j.db && r.j.db.event.live_mode, r.j.state, r.j.db && r.j.db.event.start]));
    const pub = await PUB('?pk=' + L.makePk((await N('state')).j.id)); ok(pub.j.event.state === 'preparing' && pub.j.event.preview === true, '첫 저장 뒤 공개(미리보기 키) = preparing(손님 노출 없음) ' + JSON.stringify([pub.j.event.state, pub.j.event.preview]));
    const r2 = await N('event', { event: { start: '2026-12-01', end: '2026-12-10', announce: '2026-12-11' } }); ok(r2.j.db.event.start === '2026-12-01' && r2.j.db.event.live_mode === 'draft', '첫 저장 뒤 날짜 저장은 그대로(draft 유지)');
  }

  console.log('② 새 회차(직원) = 준비 중 · 공개 응답 비움 · 조회 400 PREPARING');
  let roundA;
  {
    const nr = await N('new-round', { confirm: 'NEW', title: '검증 708 회차' }, 'staff');
    ok(nr.status === 200 && nr.j.db.event.live_mode === 'draft' && nr.j.db.event.prizes.length === 0 && nr.j.state === 'preparing' && nr.j.checklist && nr.j.checklist.ready === false && nr.j.id > 0, '직원 new-round 200 · live_mode draft · 경품 0 · 응답에 state preparing·checklist·id(손질 ⓐ)');
    // 손질 ⓑ: 받이가 false(가짜 표 모드 noSync)면 synced 도 false
    { const app2 = express(); app2.use(express.json()); const L2 = mount(app2, { pool, authMiddleware: fakeAuth, adminOnly, writeAudit, table: TABLE, tick: false }); const s2 = await listen(app2, PORT + 3);
      const r2 = await jf(`http://localhost:${PORT + 3}`, '/api/agent-office/lucky/event', { body: { event: { pending_art: [] } }, headers: { 'x-test-role': 'staff' } });   // 보이는 칸은 안 바꿈(같은 가짜 표 · 아래 공개 응답 기대가 어긋나지 않게)
      ok(r2.status === 200 && r2.j.synced && r2.j.synced.card === false && r2.j.synced.bot === false && cfgSets.length === 0 && scen.length === 0 && L2._assetTable === TABLE + '_assets', 'sync 없이 가짜 표로 띄우면 synced {false,false} · 운영 받이 호출 0(noSync)'); s2.close(); }
    roundA = (await N('state')).j.id; ok(roundA > 0, '회차 번호 생김 ' + roundA);
    const r = await PUB(); const e = r.j.event;
    ok(e.state === 'preparing' && e.prizes.length === 0 && e.images.hero === null && r.j.counts.orders === 0 && e.display_title === '검증 708 회차' && e.texts.preparing_title === '이벤트 준비 중이에요 🍊' && e.page_until === '', '공개 = preparing · prizes [] · images null · counts 0 · 준비 중 글자 · page_until 빈 글(날짜 없음 → down 아님) ' + JSON.stringify([e.state, e.prizes.length, e.images && e.images.hero, r.j.counts, e.display_title, e.page_until]));
    const lk = await jf(B, '/api/lucky/lookup', { body: { q: '김민수' } }); ok(lk.status === 400 && lk.j.error === 'PREPARING', 'lookup → 400 PREPARING');
    const st = await N('state'); ok(st.j.checklist.ready === false && st.j.checklist.missing.includes('응모 시작일') && st.j.checklist.missing.includes('경품 1개 이상') && st.j.checklist.steps.open === false, '체크리스트 미완 목록 ' + JSON.stringify(st.j.checklist.missing));
    ok(cfgSets.length === 0 && scen.length === 0, '준비 중엔 카드·봇 동기화 0');
  }

  console.log('③ 설정 저장(새 칸) · 자동 page_until · 체크리스트');
  {
    const body = { event: { display_title: '가을 황금향 이벤트', start: '2026-10-20', end: '2026-10-31', announce: '2026-11-01', page_until: '', coupon_text: '2,000원 할인 쿠폰 (10/20~10/31)',
      prizes: [{ name: '황금향 5kg 선물용', count: 5, desc: '제주 황금향\n달콤한 선물', note: '프리미엄!' }, { name: '감귤 3kg', count: 0 }],
      texts: { prize_head_hand: '마음을 담았어요 ♡', winner_foot: '', bogus: 'x' }, guide_card: { enabled: true, custom: false }, bot_reply: { enabled: true, custom: false }, pending_art: [{ order_id: 77, slot: 'hero', at: '2026-10-15' }, { order_id: 'x' }] }, excluded: ['010-9000-0001'] };
    const r = await N('event', body); const e = r.j.db.event;
    ok(r.status === 200 && e.display_title === '가을 황금향 이벤트' && e.page_until === '' && r.j.checklist.ready === false && r.j.checklist.missing.includes('경품 2 인원') && !r.j.checklist.missing.includes('경품 2 이름') && r.j.synced.card === false, '저장 200 · 인원 0 경품 = 미완 · 준비 중이라 동기화 안 함 ' + JSON.stringify(r.j.checklist.missing));
    ok(e.prizes[0].desc === '제주 황금향\n달콤한 선물' && e.prizes[0].note === '프리미엄!' && e.prizes[0].image_id === null && e.texts.prize_head_hand === '마음을 담았어요 ♡' && !('winner_foot' in e.texts) && !('bogus' in e.texts) && e.coupon_text.startsWith('2,000원') && e.pending_art.length === 1 && e.pending_art[0].order_id === 77, '새 칸 저장 꼴(desc 줄바꿈 · texts 화이트리스트 · 빈 글은 기본값으로 · pending_art 거름)');
    const pub = await PUB(); ok(pub.j.event.page_until === '2026-11-04' && pub.j.event.state === 'preparing', '공개 page_until = 발표일+3(자동) ' + pub.j.event.page_until);
    const r2 = await N('event', { event: { prizes: [{ name: '황금향 5kg 선물용', count: 5, desc: '제주 황금향\n달콤한 선물', note: '프리미엄!' }, { name: '감귤 3kg', count: 10 }] } });
    ok(r2.status === 200 && r2.j.checklist.ready === true && r2.j.state === 'preparing', '인원 채우면 ready true(아직 preparing)');
  }

  console.log('④ 그림 올리기 · 공개 GET(immutable) · 참조·지우기');
  let assetId, assetUrl;
  {
    const up = await N('assets', { slot: 'hero', mime: 'image/webp', data: 'data:image/webp;base64,' + WEBP_1PX.toString('base64'), width: 1, height: 1, label: '시험 배너' });
    ok(up.status === 200 && up.j.asset && up.j.asset.id > 0 && /^\/api\/lucky\/asset\/\d+\?v=[0-9a-f]{8}$/.test(up.j.asset.url) && up.j.asset.size === WEBP_1PX.length, '올리기 200 · url 꼴 · size ' + JSON.stringify(up.j.asset && up.j.asset.url));
    assetId = up.j.asset.id; assetUrl = up.j.asset.url;
    const bad1 = await N('assets', { slot: 'hero', mime: 'image/gif', data: WEBP_1PX.toString('base64') }); const bad2 = await N('assets', { slot: 'x', mime: 'image/webp', data: WEBP_1PX.toString('base64') }); const bad3 = await N('assets', { slot: 'hero', mime: 'image/webp', data: '' });
    ok(bad1.status === 400 && bad1.j.error === 'MIME' && bad2.status === 400 && bad2.j.error === 'SLOT' && bad3.status === 400 && bad3.j.error === 'SIZE', 'mime·slot·빈 데이터 400');
    const g = await fetch(B + assetUrl); const buf = Buffer.from(await g.arrayBuffer());
    ok(g.status === 200 && g.headers.get('content-type') === 'image/webp' && /immutable/.test(g.headers.get('cache-control')) && /max-age=31536000/.test(g.headers.get('cache-control')) && buf.equals(WEBP_1PX), '공개 GET 바이트 동일 · webp · immutable 1년');
    const g404 = await fetch(B + '/api/lucky/asset/999999'); ok(g404.status === 404, '없는 그림 404');
    const list = await N('assets?slot=hero'); ok(list.status === 200 && list.j.assets.some(a => a.id === assetId && a.label === '시험 배너') && !JSON.stringify(list.j).includes('"bytes"'), '목록(slot) · 바이트 없음');
    const r = await N('event', { event: { hero_image_id: assetId, prizes: [{ name: '황금향 5kg 선물용', count: 5, image_id: assetId }, { name: '감귤 3kg', count: 10, image_id: 424242 }] } });
    ok(r.status === 200 && r.j.db.event.hero_image_id === assetId && r.j.checklist.ready === false && r.j.checklist.missing.some(m => /경품 2 그림/.test(m)), '없는 그림을 가리키면 체크리스트 미완(경품 2 그림(지워짐)) ' + JSON.stringify(r.j.checklist.missing));
    const r2 = await N('event', { event: { prizes: [{ name: '황금향 5kg 선물용', count: 5, desc: '제주 황금향\n달콤한 선물', note: '프리미엄!', image_id: assetId }, { name: '감귤 3kg', count: 10, image_id: null }] } }); ok(r2.j.checklist.ready === true, '그림 참조 고치면 ready');
    const del = await N('assets/' + assetId, {}, 'staff', 'DELETE'); ok(del.status === 409 && del.j.error === 'IN_USE', '쓰는 그림 지우기 → 409 IN_USE');
  }

  console.log('⑤ 미리보기 키 · 준비 중이어도 전부');
  {
    const pk = await N('preview-key'); ok(pk.status === 200 && /^\d+\.\d+\.[0-9a-f]{24}$/.test(pk.j.pk) && pk.j.url === '/lucky.html?pk=' + pk.j.pk && Date.parse(pk.j.expires_at) - NOW === 3600e3, '키 꼴 · 1시간 · url');
    const r = await PUB('?pk=' + pk.j.pk); const e = r.j.event;
    ok(r.status === 200 && e.preview === true && e.state === 'preparing' && e.prizes.length === 2 && e.prizes[0].image === assetUrl && e.images.hero === assetUrl && e.prizes[1].image === null && r.h.get('cache-control') === 'no-store', '맞는 키 = preview true · 경품·그림 전부(hero·경품1 주소 · 경품2 null) · no-store');
    const bad = await PUB('?pk=' + pk.j.pk.replace(/[0-9a-f]{24}$/, '0'.repeat(24))); ok(bad.status === 200 && !bad.j.event.preview && bad.j.event.prizes.length === 0 && bad.h.get('cache-control') !== 'no-store', '틀린 키 = 비운 응답 · no-store 아님(캐시 우회 안 됨 · 손질 ④)');
    const saveNow = NOW; NOW += 3600e3 + 1000; const exp = await PUB('?pk=' + pk.j.pk); ok(!exp.j.event.preview, '1시간 지나면 키 무효'); NOW = saveNow;
    ok(!L.pkValid(L.makePk(roundA + 1), roundA), '다른 회차 키는 무효');
  }

  console.log('⑥ 열기(go-live) · 동기화(카드·#59) · 광고성 글 거름');
  {
    await N('event', { event: { prizes: [{ name: '황금향 5kg 선물용', count: 0 }] } });
    const nr = await N('go-live', { mode: 'live' }); ok(nr.status === 400 && nr.j.error === 'NOT_READY' && nr.j.missing.includes('경품 1 인원'), '미완이면 400 NOT_READY + missing');
    await N('event', { event: { prizes: [{ name: '황금향 5kg 선물용', count: 5, desc: '제주 황금향\n달콤한 선물', note: '프리미엄!', image_id: assetId }, { name: '감귤 3kg', count: 10 }] } });
    const bm = await N('go-live', { mode: 'x' }); ok(bm.status === 400, '모르는 mode 400');
    const live = await N('go-live', { mode: 'live' });
    ok(live.status === 200 && live.j.state === 'live' && live.j.db.event.live_mode === 'live' && live.j.db.event.live_at && live.j.synced.card === true && live.j.synced.bot === true, '열기 200 · state live · synced ' + JSON.stringify(live.j.synced));
    const c = cfgSets[cfgSets.length - 1]; const s = scen[scen.length - 1];
    ok(c && c.k === 'guide_event_card' && c.v.enabled === true && c.v.title === '🎁 가을 황금향 이벤트' && c.v.lines.length === 3 && c.v.lines[1] === '총 15명 추첨: 1등 황금향 5kg 선물용(5명) · 2등 감귤 3kg(10명)' && c.v.lines[0].startsWith('10월 20일 ~ 10월 31일') && c.v.url === 'https://event.akkome.com/lucky.html' && c.v.start === '2026-10-20' && c.v.end === '2026-11-04' && c.v.btn === '접수·당첨 확인 바로가기' && !/할인|쿠폰/.test(JSON.stringify(c.v)), '카드 설정 = 자동 3줄 · url 기본 · end = 내리는 날 · 쿠폰 글 없음 ' + JSON.stringify(c && c.v.lines));
    ok(s && s.scenario_no === 59 && s.enabled === true && s.channel === '공통' && s.updated_by === '이벤트 관리' && s.keywords.length === 14 && s.response.includes('🎟 2,000원 할인 쿠폰') && s.response.includes('▶ https://event.akkome.com/lucky.html') && s.response.includes('총 15명 추첨') && s.response.includes('11월 1일'), '#59 = 켜짐 · 공통 · 쿠폰 줄 · 링크 · 경품 · 발표일');
    const pub = await PUB(); ok(pub.j.event.state === 'live' && pub.j.event.prizes.length === 2 && pub.j.event.images.hero === assetUrl && pub.j.event.prizes[0].desc === '제주 황금향\n달콤한 선물', '공개 = live 전체(그림 주소 · 설명)');
    const nC = cfgSets.length, nS = scen.length;
    const r = await N('event', { event: { guide_card: { custom: true, title: '가을 이벤트', lines: ['첫 줄 안내', '2,000원 할인 쿠폰도 드려요', '세 줄'], btn: '확인하기' }, bot_reply: { custom: true, response: '직원이 쓴 봇 답', keywords: ['이벤트'] } } });
    const c2 = cfgSets[cfgSets.length - 1], s2 = scen[scen.length - 1];
    ok(r.j.synced.card === true && cfgSets.length === nC + 1 && c2.v.title === '가을 이벤트' && c2.v.lines.length === 2 && !c2.v.lines.some(l => /할인/.test(l)) && c2.v.btn === '확인하기' && scen.length === nS + 1 && s2.response === '직원이 쓴 봇 답' && s2.keywords.length === 1, '열린 뒤 저장 = 동기화 · custom 글 유지 · 할인 줄은 카드에서 빠짐 · #59 custom 본문 그대로');
    const lk = await jf(B, '/api/lucky/lookup', { body: { q: '없는사람' } }); ok(lk.status === 200 && lk.j.ok === true && lk.j.results.length === 0 && lk.j.event.state === 'live', 'live 에선 lookup 종전 동작');
    // 손질 ②: 제목·단추 글에 할인·쿠폰·금액이 들면 카드는 중립 글로
    const r3 = await N('event', { event: { display_title: '가을 할인 50% 이벤트', guide_card: { custom: true, title: '', lines: ['첫 줄 안내'], btn: '쿠폰 받기' } } });
    const c3 = cfgSets[cfgSets.length - 1];
    ok(r3.status === 200 && c3.v.title === '🎁 이벤트 안내' && c3.v.btn === '접수·당첨 확인 바로가기' && c3.v.lines.length === 1 && r3.j.synced.card_dropped.length === 2, '카드 제목(display_title 할인·%)·단추(쿠폰) → 중립 글 · dropped 2 ' + JSON.stringify([c3.v.title, c3.v.btn]));
    await N('event', { event: { display_title: '가을 황금향 이벤트', guide_card: { custom: false, lines: [], btn: '' }, bot_reply: { custom: false, response: '', keywords: [] } } });   // 되돌림(아래 복사 시험이 이 값을 기대)
    // 손질 ⑥: int 범위 밖 그림 번호
    const g = await fetch(B + '/api/lucky/asset/99999999999'); ok(g.status === 404, 'asset id int 범위 밖 → 404');
    const dl = await N('assets/99999999999', {}, 'staff', 'DELETE'); ok(dl.status === 400, 'DELETE int 범위 밖 → 400');
    const r4 = await N('event', { event: { prizes: [{ name: '황금향 5kg 선물용', count: 5, desc: '제주 황금향\n달콤한 선물', note: '프리미엄!', image_id: assetId }, { name: '감귤 3kg', count: 10, image_id: 99999999999 }] } });
    ok(r4.status === 200 && r4.j.db.event.prizes[1].image_id === null && r4.j.checklist.ready === true, 'image_id int 범위 밖 → null(500 아님)');
  }

  console.log('⑦ 주문·추첨·발표(직원) · 종전 로직 HEAD 판과 동일');
  const orders = fakeOrders(200, 11);
  {
    const up = await N('orders', { orders, label: 'v708.xlsx' }); ok(up.status === 200 && up.j.added > 150, '주문 올리기 ' + up.j.added);
    seedRandom(4242); const dr = await N('draw', {}, 'staff'); ok(dr.status === 200 && dr.j.db.winners.length === 15, '직원 추첨 200 · 당첨 15');
    const pb = await N('publish', { published: true }, 'staff'); ok(pb.status === 200 && pb.j.db.event.published === true, '직원 발표 200');
    const pub = await PUB(); ok(pub.j.event.state === 'published' && pub.j.event.published === true, 'state published');
    const w = await jf(B, '/api/lucky/winners'); ok(w.status === 200 && w.j.published && w.j.total === 15, '공개 당첨자 종전');
    // 옛 판 비교(같은 주문·같은 난수 → 당첨자·조회 결과 동일) — 두 판: ①ac67689 = #708 앞 원본 이식판(종전 로직 정본 · HEAD 가 #708 코드가 된 뒤 고정 · #686 때와 같은 방식) ②HEAD = 직전 커밋(이번 손질이 추첨·조회를 안 건드렸는지) · 같은 가짜 표(TABLE_HEAD)를 번갈아 씀
    seedRandom(4242); const dn = await N('draw', {}, 'staff'); await N('publish', { published: true });
    const EV = { title: '검증 708 회차', start: '2026-10-20', end: '2026-10-31', announce: '2026-11-01', prizes: [{ name: '황금향 5kg 선물용', count: 5 }, { name: '감귤 3kg', count: 10 }], excludeProducts: [] };   // 종전 칸만 같게(새 회차의 관리용 제목과 같아야 비교가 됨)
    const qs = [...new Set(orders.slice(0, 15).flatMap(o => [o.buyerPhone || o.recvPhone, o.buyer]))].concat(dn.j.db.winners.slice(0, 4).map(w => w.phone), ['없는사람', 'ㄱ', '010-0000-1111']);
    const strip = j => { if (!j) return j; const c = JSON.parse(JSON.stringify(j)); if (c.event) { const e = {}; OLD_KEYS.forEach(k => { e[k] = c.event[k]; }); if (Array.isArray(e.prizes)) e.prizes = e.prizes.map(p => ({ name: p.name, count: p.count })); c.event = e; } return c; };
    const pick = e => { const o = {}; OLD_KEYS.forEach(k => { o[k] = e[k]; }); o.prizes = o.prizes.map(p => ({ name: p.name, count: p.count })); return o; };
    let hi = 0;
    for (const [ref, label] of [['ac67689', '원본 이식판(#708 앞)'], ['HEAD', 'HEAD']]) {
      let headSrc = null; try { headSrc = execSync(`git show ${ref}:lucky-event.js`, { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 22 }); } catch (_) { }
      if (!headSrc) { console.log(`  ⏭ ${label} 을 못 읽어 동일성 비교 건너뜀`); continue; }
      await pool.query(`DROP TABLE IF EXISTS ${TABLE_HEAD}_assets`); await pool.query(`DROP TABLE IF EXISTS ${TABLE_HEAD}`);
      const hp = path.join(require('os').tmpdir(), `lucky-event.${ref.toLowerCase()}.${process.pid}.js`); fs.writeFileSync(hp, headSrc);
      const appH = express(); appH.use(express.json({ limit: '15mb' })); require(hp)(appH, { pool, authMiddleware: fakeAuth, adminOnly, writeAudit, table: TABLE_HEAD, tick: false, now: () => NOW });
      const port = PORT + 1 + hi * 3; hi++;   // 3464 · 3467(3465 = ⑩ Host 앱 · 3466 = ② noSync)
      const sH = await listen(appH, port); const H = `http://localhost:${port}`;
      await jf(H, '/api/agent-office/lucky/orders', { body: { orders, label: 'v708.xlsx' }, headers: { 'x-test-role': 'admin' } });
      await jf(H, '/api/agent-office/lucky/event', { body: { event: EV, excluded: ['010-9000-0001'] }, headers: { 'x-test-role': 'admin' } });
      if (/go-live/.test(headSrc)) await jf(H, '/api/agent-office/lucky/go-live', { body: { mode: 'live' }, headers: { 'x-test-role': 'admin' } });   // #708 이후 판은 열어야 조회가 됨(원본 판은 늘 열림)
      seedRandom(4242); const dh = await jf(H, '/api/agent-office/lucky/draw', { body: {}, headers: { 'x-test-role': 'admin' } });
      ok(JSON.stringify(dh.j.db.winners) === JSON.stringify(dn.j.db.winners) && dh.j.pool === dn.j.pool && dh.j.tickets === dn.j.tickets, `추첨 결과 ${label} 과 바이트 동일(당첨 ${dn.j.db.winners.length} · 응모 ${dn.j.pool})`);
      await jf(H, '/api/agent-office/lucky/publish', { body: { published: true }, headers: { 'x-test-role': 'admin' } });
      let same = 0, diff = [];
      for (const q of qs) {
        const a = await jf(H, '/api/lucky/lookup', { body: { q } }), b = await jf(B, '/api/lucky/lookup', { body: { q } });
        if (a.status === b.status && JSON.stringify(strip(a.j)) === JSON.stringify(strip(b.j))) same++; else diff.push(q);
      }
      ok(same === qs.length, `lookup 결과(종전 칸) ${label} 과 동일 ${same}/${qs.length}${diff.length ? ' 다름: ' + diff.slice(0, 3).join(',') : ''}`);
      const wh = await jf(H, '/api/lucky/winners'), wn = await jf(B, '/api/lucky/winners'); ok(JSON.stringify(wh.j) === JSON.stringify(wn.j), `공개 당첨자(마스킹) ${label} 과 동일`);
      const eh = await jf(H, '/api/lucky/event'), en = await PUB();
      ok(JSON.stringify(pick(eh.j.event)) === JSON.stringify(pick(en.j.event)) && JSON.stringify(eh.j.counts) === JSON.stringify(en.j.counts), `공개 /event 종전 7칸·counts ${label} 과 동일`);
      sH.close(); fs.rmSync(hp, { force: true });
    }
  }

  console.log('⑧ 내리는 날 · 틱 · 예약 열기 · 회차 복사 · 그림 비우기');
  let roundB;
  {
    const nC = cfgSets.length, nS = scen.length;
    NOW = Date.parse('2026-11-05T03:00:00Z');   // page_until 11/4 다음 날
    const pub = await PUB(); ok(pub.j.event.state === 'down' && pub.j.event.prizes.length === 0 && pub.j.event.texts.closed_title === '이벤트가 끝났어요 🙏' && pub.j.event.store_url, '내리는 날 지나면 공개 = down(계산) · 끝났어요 글자 · 스토어 링크');
    const lk = await jf(B, '/api/lucky/lookup', { body: { q: '김민수' } }); ok(lk.status === 400 && lk.j.error === 'CLOSED', 'down 이면 lookup 400 CLOSED');
    const t = await L.tickOnce(); const c = cfgSets[cfgSets.length - 1], s = scen[scen.length - 1];
    ok(t.closed === true && (await N('state')).j.db.event.live_mode === 'down' && cfgSets.length === nC + 1 && c.v.enabled === false && scen.length === nS + 1 && s.enabled === false, '틱 = live_mode down 적고 카드·#59 꺼짐');
    const t2 = await L.tickOnce(); ok(t2.closed === false && t2.opened === false && cfgSets.length === nC + 1, '두 번째 틱은 아무 일 없음');
    // 복사(지금 회차는 내려감 → 허용) · 열려 있으면 409 는 아래
    const cp = await N('copy-round', { from_id: roundA, title: '겨울 레몬 이벤트' });
    ok(cp.status === 200 && cp.j.state === 'preparing' && cp.j.db.event.live_mode === 'draft' && cp.j.db.event.title === '겨울 레몬 이벤트' && cp.j.db.event.display_title === '가을 황금향 이벤트' && cp.j.db.event.prizes.length === 2 && cp.j.db.event.prizes[0].desc === '제주 황금향\n달콤한 선물' && cp.j.db.event.prizes[0].image_id === assetId && cp.j.db.event.hero_image_id === assetId && cp.j.db.orders.length === 0 && cp.j.db.winners.length === 0 && cp.j.db.excluded.length === 0 && cp.j.db.event.start === '' && cp.j.db.event.page_until === '' && cp.j.db.event.published === false && cp.j.db.event.coupon_text.startsWith('2,000원'), '복사 = 설정·문구·그림 참조 그대로 · 주문·당첨·제외·날짜 비움 · draft');
    roundB = cp.j.id; ok(roundB > roundA, '새 회차 번호');
    const rounds = await N('rounds'); ok(rounds.status === 200 && rounds.j.rounds.length >= 2 && rounds.j.rounds.find(r => r.id === roundA).state === 'down' && rounds.j.rounds.find(r => r.id === roundB).state === 'preparing' && rounds.j.rounds.find(r => r.id === roundA).page_until === '2026-11-04', 'rounds 에 state·page_until');
    // 예약 열기
    NOW = Date.parse('2026-11-05T03:00:00Z');
    await N('event', { event: { start: '2026-11-10', end: '2026-11-20', announce: '2026-11-21', prizes: [{ name: '그린레몬 5kg', count: 3, image_id: assetId }] } });
    const sc = await N('go-live', { mode: 'scheduled' }); ok(sc.status === 200 && sc.j.state === 'preparing' && sc.j.db.event.live_mode === 'scheduled' && sc.j.db.event.live_at === '2026-11-10T00:00:00+09:00' && sc.j.synced.card === false, '예약 = scheduled · 아직 preparing · 동기화 안 함');
    const pubS = await PUB(); ok(pubS.j.event.state === 'preparing' && pubS.j.event.page_until === '2026-11-24', '예약 중 공개 = preparing · page_until 자동');
    NOW = Date.parse('2026-11-09T15:00:00Z');   // KST 11/10 00:00
    const pubL = await PUB(); ok(pubL.j.event.state === 'live' && pubL.j.event.prizes.length === 1, '시작일 00:00 KST 부터 공개 = live(계산)');
    const nC2 = cfgSets.length; const t3 = await L.tickOnce(); const c3 = cfgSets[cfgSets.length - 1];
    ok(t3.opened === true && (await N('state')).j.db.event.live_mode === 'live' && cfgSets.length === nC2 + 1 && c3.v.enabled === true && c3.v.start === '2026-11-10' && c3.v.end === '2026-11-24', '틱 = scheduled → live 적고 카드·#59 켬');
    const cpLive = await N('copy-round', { from_id: roundA }); ok(cpLive.status === 409 && cpLive.j.error === 'LIVE', '열린 회차가 있으면 복사 409 LIVE');
    // 내리기 단추
    const nC3 = cfgSets.length; const dn = await N('go-live', { mode: 'down' });
    ok(dn.status === 200 && dn.j.state === 'down' && dn.j.db.event.page_until === '2026-11-10' && cfgSets.length === nC3 + 1 && cfgSets[cfgSets.length - 1].v.enabled === false, '[내리기] = down · 내리는 날 = 오늘 · 카드 꺼짐');
    // 그림 비우기(틱) — 이전 회차의 옛 그림(지금 회차가 가리키는 건 유지)
    const up2 = await N('assets', { slot: 'winner', mime: 'image/webp', data: WEBP_1PX.toString('base64') }); const oldId = up2.j.asset.id;
    await pool.query(`UPDATE ${TABLE}_assets SET created_at = NOW() - interval '800 days', round_id = $2 WHERE id = $1`, [oldId, roundA]);
    await pool.query(`UPDATE ${TABLE}_assets SET created_at = NOW() - interval '800 days' WHERE id = $1`, [assetId]);   // 지금 회차가 가리키는 그림 — 비우면 안 됨
    const t4 = await L.tickOnce(); const gOld = await fetch(B + '/api/lucky/asset/' + oldId), gKeep = await fetch(B + assetUrl);
    ok(t4.purged === 1 && gOld.status === 404 && gKeep.status === 200, '2년 지난 옛 회차 그림만 비움(쓰는 그림 유지) purged=' + t4.purged);
    const del = await N('assets/' + oldId, {}, 'staff', 'DELETE'); ok(del.status === 200, '안 쓰는(비운) 그림 지우기 200');
  }

  console.log('⑨ 권한 · 감사 · 레이트 리밋(cf-connecting-ip)');
  {
    const noAuth = await jf(B, '/api/agent-office/lucky/state'); ok(noAuth.status === 401, '로그인 없이 401');
    const rs = await N('restore', { db: { orders: [] } }, 'staff'); ok(rs.status === 403, '직원 restore 403(그대로)');
    const rsA = await N('restore', { db: { orders: [], event: { title: '복원됨', start: '2026-11-10', end: '2026-11-20', announce: '2026-11-21', prizes: [{ name: 'a', count: 1 }] } } }, 'admin'); ok(rsA.status === 200 && rsA.j.db.event.live_mode === 'legacy' && (await PUB()).j.event.state === 'live' && (await PUB()).j.event.live_mode === 'live', '관리자 restore 200 · 옛 꼴(live_mode 없음) = legacy → 공개 state live(날짜 무관)');
    const rr = await N('reset', { confirm: 'RESET' }, 'staff'); ok(rr.status === 200 && rr.j.db.event.live_mode === 'draft' && rr.j.db.event.prizes.length === 0, '직원 reset 200 · 초안 빈 회차');
    const rrNo = await N('reset', { confirm: 'X' }, 'staff'); ok(rrNo.status === 400, 'RESET 글자 없으면 400');
    const txt = JSON.stringify(audits);
    ok(audits.length >= 12 && audits.every(a => a.targetType === 'lucky_event' && a.source === 'lucky_admin') && audits.some(a => a.action === 'lucky_sync') && audits.some(a => a.action === 'lucky_go_live') && audits.some(a => a.action === 'lucky_asset_upload') && audits.some(a => a.action === 'lucky_copy_round'), `감사 기록 ${audits.length}건(sync·go_live·asset·copy 포함)`);
    ok(!/010-?9\d{3}-?\d{4}/.test(txt), '감사 기록에 번호 0');
    let got429 = false; for (let i = 0; i < 45; i++) { const r = await fetch(B + '/api/lucky/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '10.1.1.' + i }, body: JSON.stringify({ q: '홍길동' }) }); if (r.status === 429) got429 = true; }
    ok(got429, 'cf-connecting-ip 기준 40회/분 초과 → 429(XFF 바꿔도 우회 안 됨)');
  }

  console.log('⑪ #711 판매현황 품목 묶음(/products) · 봇 답·카드 미리보기(/bot-preview) — 저장 0 · 동기화 0 · 운영 bot_products 무접촉');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lucky-event.js'), 'utf8');
    const sel = (src.match(/SELECT name, status FROM bot_products[^`]*/) || [''])[0];
    ok(/deleted_at IS NULL/.test(sel) && !/INSERT|UPDATE|DELETE/.test(sel), '기본 판매현황 읽기 = SELECT(deleted_at IS NULL)만 · 쓰기 글자 0 ' + JSON.stringify(sel));
    // 낱말 묶음 앞 10개 = 화면(event-admin.js ITEM_GROUPS · #709)과 같은 순서(둘이 어긋나면 사진 매칭과 제외 묶음이 다르게 묶인다)
    try { const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'event-admin.js'), 'utf8'); const m = ui.match(/const ITEM_GROUPS = (\[[^\n]*\]);/); const uiGroups = m ? new Function('return ' + m[1])() : null;
      ok(Array.isArray(uiGroups) && JSON.stringify(L._itemGroups.slice(0, uiGroups.length)) === JSON.stringify(uiGroups), '서버 ITEM_GROUPS 앞부분 = 화면 ITEM_GROUPS(#709) 글자·순서 동일 ' + (uiGroups ? uiGroups.length : 'x') + '묶음'); } catch (e) { ok(false, '화면 ITEM_GROUPS 대조 실패 ' + e.message); }
    const unauth = await jf(B, '/api/agent-office/lucky/products'); ok(unauth.status === 401, '/products 로그인 없이 401');
    const p1 = await N('products'); const G = p1.j && p1.j.groups || [];
    const byName = n => G.find(g => g.name === n);
    ok(p1.status === 200 && p1.j.ok === true && G.length >= 9 && G.every(g => g.name && Array.isArray(g.words) && typeof g.selling === 'boolean' && Array.isArray(g.options) && g.options.every(o => typeof o.name === 'string' && typeof o.status === 'string')), '/products 200 · groups[{name,words,selling,options[{name,status}]}] ' + G.length + '묶음');
    const gold = byName('황금향');
    ok(gold && gold.selling === true && gold.words.join() === '황금향' && gold.options.length === 4 && gold.options.some(o => o.name === '노지황금향 10kg') && gold.options.some(o => /^하우스황금향/.test(o.name)) && gold.options.filter(o => /선물용 - 3kg/.test(o.name)).length === 1, '황금향 묶음 = 과즙팡팡 2 + 하우스황금향 + 노지황금향(먼저 맞는 묶음이 이김) · 같은 이름 중복 1 ' + JSON.stringify(gold && gold.options.map(o => o.name)));
    const house = byName('하우스감귤');
    ok(house && house.words.includes('하우스귤') && house.options.length === 2 && house.options.some(o => /^행사★하우스귤/.test(o.name)) && house.selling === true, '하우스감귤 묶음 = 고당도 하우스감귤 + 행사★하우스귤(words 하우스귤 포함)');
    const cg = byName('청귤');
    ok(cg && cg.words.includes('풋귤') && cg.selling === false && cg.options.length === 2 && cg.options.every(o => o.status === '시즌종료'), '청귤 묶음 = 시즌종료 2 · selling false · words 풋귤');
    ok(byName('레드키위') && byName('그린레몬') && byName('노지감귤') && byName('미니밤호박') && byName('초당옥수수'), '머리말(과수 및 크기:)·「 / 」 뒤 꼴도 묶음에 듦(레드키위·그린레몬·노지감귤·미니밤호박·초당옥수수)');
    const sweet = byName('고구마'), kum = byName('금귤');
    ok(sweet && sweet.options.length === 1 && sweet.selling === false && kum && kum.options[0].name === '금귤(낑깡)', '묶음 표에 없는 이름 = 품목 머리로 묶음 하나(고구마 · 금귤(낑깡) → 금귤)');
    ok(!G.some(g => g.options.some(o => /검증|테스트/.test(o.name))), '시험 품목([검증]·테스트) 거름');
    const firstOff = G.findIndex(g => !g.selling), lastOn = G.map(g => g.selling).lastIndexOf(true);
    ok(firstOff > 0 && lastOn < firstOff && G.slice(0, firstOff).map(g => g.name).join() === G.slice(0, firstOff).map(g => g.name).sort((a, b) => a.localeCompare(b, 'ko')).join(), '묶음 순서 = 판매중 있는 묶음 먼저 · 그 안은 가나다 ' + JSON.stringify(G.map(g => g.name)));
    ok(G.every(g => g.options.map(o => o.name).join() === g.options.map(o => o.name).sort((a, b) => a.localeCompare(b, 'ko')).join()), '묶음 안 옵션 가나다');
    ok(!/010|\d{2,},\d{3}/.test(JSON.stringify(p1.j)), '응답에 번호·금액 없음');
    const calls0 = productCalls; await N('products'); await N('products'); ok(productCalls === calls0 && calls0 === 1, '30초 안 두 번 더 불러도 판매현황 읽기 1회(기억)');
    NOW += 31e3; await N('products'); ok(productCalls === 2, '31초 지나면 다시 읽음');
    ok(L.groupProducts([{ name: '최상품 청귤(풋귤) 5kg', status: '판매중' }])[0].name === '청귤' && L.groupProducts([]).length === 0, 'groupProducts 단위: 청귤 · 빈 목록 []');

    // /bot-preview
    const before = await N('state'); const cfgN = cfgSets.length, scenN = scen.length, audN = audits.length;
    const unauth2 = await jf(B, '/api/agent-office/lucky/bot-preview', { body: { event: {} } }); ok(unauth2.status === 401, '/bot-preview 로그인 없이 401');
    const pv = await N('bot-preview', { event: { display_title: '미리보기 제목', start: '2026-12-01', end: '2026-12-10', announce: '2026-12-11', coupon_text: ' 2,000원 할인 쿠폰 ', prizes: [{ name: '황금향 5kg', count: 3 }], guide_card: { custom: true, title: '🎁 쿠폰 이벤트', lines: ['할인 10%', '기간 안 주문 자동 응모', ''], btn: '보기' } } });
    const bt = pv.j && pv.j.bot && pv.j.bot.text || '', cd = pv.j && pv.j.card || {};
    ok(pv.status === 200 && pv.j.ok === true && bt.includes('🎟 2,000원 할인 쿠폰') && bt.includes('🎁 미리보기 제목 (12월 1일 ~ 12월 10일 주문 고객 대상)') && bt.includes('총 3명 추첨: 1등 황금향 5kg(3명)') && bt.includes('https://event.akkome.com/lucky.html') && pv.j.bot.custom === false && pv.j.bot.keywords.includes('이벤트'), '봇 답 = 서버 autoBot 그대로(🎟 쿠폰 줄 · 제목 · 기간 · 경품 · 주소) ' + JSON.stringify(bt.split('\n').slice(3, 7)));
    ok(cd.title === '🎁 이벤트 안내' && JSON.stringify(cd.lines) === JSON.stringify(['기간 안 주문 자동 응모']) && cd.btn === '보기' && cd.dropped.includes('할인 10%') && cd.dropped.includes('🎁 쿠폰 이벤트') && cd.custom === true && typeof pv.j.state === 'string', '카드 = 광고성 줄·제목 빠지고 dropped 로 돌려줌 ' + JSON.stringify(cd));
    const after = await N('state');
    ok(JSON.stringify(after.j.db.event) === JSON.stringify(before.j.db.event) && after.j.db.event.display_title !== '미리보기 제목' && cfgSets.length === cfgN && scen.length === scenN && audits.length === audN, '미리보기 뒤 저장 0 · 동기화 0 · 감사 0(회차 그대로)');
    const pvC = await N('bot-preview', { event: { bot_reply: { custom: true, response: '손으로 쓴 봇 답' } } }); ok(pvC.status === 200 && pvC.j.bot.text === '손으로 쓴 봇 답' && pvC.j.bot.custom === true, '손으로 고친 봇 답(custom)은 그 글 그대로');
    const pvE = await N('bot-preview', {}); ok(pvE.status === 200 && pvE.j.bot.text.includes('제주아꼼이네') && pvE.j.card.title.startsWith('🎁'), '빈 몸 = 지금 회차 글(자동)');
    const pvB = await N('bot-preview', { event: [] }); ok(pvB.status === 400 && pvB.j.error === 'BODY', 'event 가 배열이면 400 BODY');
    // syncOut 과 같은 글(composeOut 한 곳) — 열렸을 때 썼던 카드·#59 값과 그 시점 초안의 composeOut 이 같은지는 ⑥의 cfgSets 기대가 보증 · 여기선 함수 노출만
    ok(typeof L.composeOut === 'function' && L.composeOut(await (async () => { const s = await N('state'); return { event: s.j.db.event }; })()).bot.text.includes('제주아꼼이네'), 'composeOut 노출(동기화와 미리보기가 같은 함수)');
  }

  console.log('⑩ server.js Host 분기 1줄(express.static 앞) · 그 줄만 떼어 실행');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\n');
    const iLine = src.findIndex(l => /EVENT_HOST/.test(l) && /lucky\.html/.test(l) && /^app\.use\(/.test(l.trim()));
    const iStatic = src.findIndex(l => /app\.use\(express\.static\(path\.join\(__dirname, 'public'\)\)\)/.test(l));
    ok(iLine > -1 && iStatic > iLine, `Host 분기 줄이 express.static 앞에 있음(${iLine + 1}행 < ${iStatic + 1}행)`);
    if (iLine > -1) {
      const mini = express(); const fn = new Function('app', 'process', src[iLine]); fn(mini, { env: {} }); mini.use((req, res) => res.status(404).end());
      await listen(mini, PORT + 2);
      // Node fetch 는 Host 헤더를 못 바꾸므로 http.request 로(진짜 Host 헤더)
      const raw = (p, headers) => new Promise((resolve, reject) => { const rq = require('http').request({ host: '127.0.0.1', port: PORT + 2, path: p, method: 'GET', headers, setHost: false }, rs => { rs.resume(); rs.on('end', () => resolve({ status: rs.statusCode, location: rs.headers.location || null })); }); rq.on('error', reject); rq.end(); });
      const a = await raw('/', { Host: 'event.akkome.com' }), b = await raw('/', { Host: 'jeju-acom-company.onrender.com' }), c = await raw('/lucky.html', { Host: 'event.akkome.com' }), d = await raw('/', { Host: 'EVENT.akkome.com:443' });
      ok(a.status === 302 && a.location === '/lucky.html' && b.status === 404 && c.status === 404 && d.status === 302, 'event.akkome.com 의 / 만 /lucky.html 로 302(대소문자·포트 무관) · 다른 Host·다른 경로는 그대로 ' + JSON.stringify([a, b.status, c.status, d.status]));
      // Render 프록시: trust proxy 없음 → req.hostname = Host 헤더(프록시가 손님 Host 를 그대로 넘김) · X-Forwarded-Host 만 와도 받게 두 값 다 봄
      const e = await raw('/', { Host: 'jeju-acom-company.onrender.com', 'X-Forwarded-Host': 'event.akkome.com' });
      ok(e.status === 302, 'X-Forwarded-Host 가 event.akkome.com 이어도 302(trust proxy 미설정 대비)');
    }
  }

  crypto.randomInt = realRandomInt;
  servers.forEach(s => s.close());
  for (const t of [TABLE + '_assets', TABLE, TABLE_HEAD]) await pool.query(`DROP TABLE IF EXISTS ${t}`);
  const left = await pool.query(`SELECT to_regclass($1) AS a, to_regclass($2) AS b`, [TABLE, TABLE + '_assets']);
  ok(left.rows[0].a === null && left.rows[0].b === null, '검증 표 삭제(운영 표 무접촉)');
  const realAfter = await realSnap();
  ok(realAfter.rows === realBefore.rows && JSON.stringify(realAfter.assets) === JSON.stringify(realBefore.assets) && realAfter.card === realBefore.card && realAfter.s59 === realBefore.s59, `운영 표 전후 동일(lucky_events ${realBefore.rows}→${realAfter.rows}행 · 그림 표 유무 동일 · guide_event_card·#59 값·updated_at 불변)`);
  await pool.end();
  console.log(`\n결과: ${pass}/${pass + failN}`);
  process.exit(failN ? 1 : 0);
}
main().catch(e => { console.error('검증 중단:', e); process.exit(2); });

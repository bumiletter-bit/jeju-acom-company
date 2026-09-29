// 고객 감사 이벤트 이식판(lucky-event.js) 검증 — 원본(bum-toolbox lucky.js)과 결과 동일성 + 권한 + 저장 지속 + 실화면
//   node scripts/verify-lucky-event.js [원본 lucky.js 경로]
//   · 원본 경로가 없으면 ① 동일성 검사만 건너뜀(원본은 private 리포 — 이 리포에 커밋하지 않음)
//   · 실DB는 검증 전용 테이블 lucky_events_vtest만 쓰고 끝에 DROP (운영 테이블 lucky_events 무접촉)
//   · 로컬 서버 포트 3458 (총괄 3457과 분리) · 인증은 가짜 미들웨어(헤더로 역할 지정) — 회사 서버·JWT 무관
//   · 주문 데이터는 전부 가짜(이름·번호 합성)
'use strict';
require('dotenv').config();
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');

const ORIG = process.argv[2];
const PORT = 3458;
const TABLE = 'lucky_events_vtest';
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅', m); } else { failN++; console.log('  ❌', m); } };

/* ── 결정적 난수 (두 모듈에 같은 난수열을 주기 위해 crypto.randomInt 교체) ── */
const realRandomInt = crypto.randomInt;
function seedRandom(seed) { let s = seed >>> 0; crypto.randomInt = (a, b) => { const max = b === undefined ? a : b - a; s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (b === undefined ? 0 : a) + (s % max); }; }

/* ── 가짜 주문 생성 ── */
function fakeOrders(n, seed) {
  let s = seed; const rnd = k => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % k; };
  const fam = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'], giv = ['민수', '서연', '지훈', '하은', '도윤', '수아', '예준', '지우', '현우', '서윤', '은호', '가람'];
  const tails = ['', '', '', ' 드림', '님', ' 드림!', ''];
  const prods = ['황금향 선물용 - 3kg(중대과 7~15과)', '고당도 하우스감귤 선물용 - 3kg(로얄과)', '최상품 청귤(풋귤) 5kg', '황금향 가정용 - 5kg', '하우스감귤 가정용 - 4.5kg(로얄과)'];
  const people = []; for (let i = 0; i < 70; i++) people.push({ name: fam[rnd(10)] + giv[rnd(12)], phone: '010-9' + String(100 + i).padStart(3, '0') + '-' + String(1000 + rnd(9000)) });
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = people[rnd(people.length) % (rnd(3) ? 25 : 70)];   // 앞쪽 25명은 여러 번 주문(가중치)
    const r = rnd(4) ? b : people[rnd(70)];
    const day = 8 + rnd(16);
    out.push({ vendor: rnd(2) ? '대성' : '효돈', date: '2026-09-' + String(day).padStart(2, '0'), buyer: b.name + tails[rnd(tails.length)], buyerPhone: rnd(9) ? b.phone : '', buyerPhone2: '',
      recv: r.name, recvPhone: r.phone, recvPhone2: '', product: prods[rnd(prods.length)], qty: 1 + rnd(2), addr: '제주특별자치도 서귀포시 효돈순환로 ' + (100 + i) + ' 101동 ' + (100 + rnd(900)) + '호',
      tracking: rnd(5) ? String(600000000000 + i * 7) : '', channel: rnd(6) ? '제주아꼼이네' : '선물하기' });
  }
  // 중복(같은 송장) 3건
  out.push(Object.assign({}, out[3])); out.push(Object.assign({}, out[10])); out.push(Object.assign({}, out[20], { tracking: '' }));
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  const audits = [];
  const writeAudit = async a => { audits.push(a); };
  const fakeAuth = (req, res, next) => { const role = req.headers['x-test-role'] || ((req.headers.authorization || '').replace('Bearer ', '') || ''); if (!role || !['staff', 'admin'].includes(role)) return res.status(401).json({ error: '인증이 필요합니다' }); req.user = { id: role === 'admin' ? 1 : 2, name: role === 'admin' ? '대표(검증)' : '직원(검증)', role: role === 'admin' ? 'admin' : 'staff' }; next(); };
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: '관리자 권한이 필요합니다' });
  const mount = require(path.join(__dirname, '..', 'lucky-event.js'));

  function makeNewApp() { const app = express(); app.use(express.json({ limit: '15mb' })); app.use(express.static(path.join(__dirname, '..', 'public'))); mount(app, { pool, authMiddleware: fakeAuth, adminOnly, writeAudit, table: TABLE }); return app; }
  const servers = [];
  const listen = (app, port) => new Promise(r => { const s = app.listen(port, () => r(s)); servers.push(s); });

  const newSrv = await listen(makeNewApp(), PORT);
  const NB = `http://localhost:${PORT}`;
  let ipSeq = 1;
  const jfetch = async (base, p, opt = {}) => { const r = await fetch(base + p, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.' + (ipSeq++ % 250) }, opt.headers || {}), body: opt.body ? JSON.stringify(opt.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) { } return { status: r.status, j }; };
  const N = (p, body, role = 'admin') => jfetch(NB, '/api/agent-office/lucky/' + p, { method: p === 'state' || p === 'rounds' ? 'GET' : 'POST', body: p === 'state' || p === 'rounds' ? undefined : (body || {}), headers: { 'x-test-role': role } });
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);   // JSONB는 키 순서를 바꿔 저장 → 순서 무관 비교
  const strip = db => { const d = JSON.parse(JSON.stringify(db)); delete d.updatedAt; if (d.event) delete d.event.drawnAt; (d.uploads || []).forEach(u => { delete u.at; delete u.by; }); return d; };

  const orders = fakeOrders(260, 7);
  const EVENT = { title: '검증 이벤트', start: '2026-09-10', end: '2026-09-21', announce: '2026-09-22', prizes: [{ name: '1등 황금향', count: 3 }, { name: '2등 감귤', count: 5 }, { name: '3등 청귤청', count: 8 }], excludeProducts: ['청귤'] };
  const EXCL = ['010-9101-' + '0000', '김민수'];
  const QUERIES = [...new Set(orders.slice(0, 22).flatMap(o => [o.buyerPhone || o.recvPhone, o.buyer, o.recv]))].slice(0, 36).concat(['없는사람', '010-0000-1111', 'ㄱ']);

  /* ═══ ① 원본과 동일성 ═══ */
  console.log('\n① 원본 lucky.js 와 결과 동일성');
  if (!ORIG || !fs.existsSync(ORIG)) console.log('  ⏭ 원본 경로 없음 — 건너뜀');
  else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-orig-'));
    process.env.LUCKY_DIR = tmp; process.env.LUCKY_ADMIN = 'vtest-' + crypto.randomBytes(4).toString('hex');
    const oApp = express(); oApp.use(express.json({ limit: '15mb' })); require(path.resolve(ORIG))(oApp, () => false);
    await listen(oApp, PORT + 1);
    const OB = `http://localhost:${PORT + 1}`;
    const O = (p, body) => jfetch(OB, '/api/lucky/admin/' + p, { body: body || {}, headers: { 'x-admin-code': process.env.LUCKY_ADMIN } });

    const o1 = await O('orders', { orders, label: 'v1.xlsx' }), n1 = await N('orders', { orders, label: 'v1.xlsx' });
    ok(o1.j.added === n1.j.added && o1.j.dup === n1.j.dup && n1.j.dup >= 2, `업로드 신규/중복 동일 (원본 ${o1.j.added}/${o1.j.dup} · 이식 ${n1.j.added}/${n1.j.dup})`);
    const o2 = await O('orders', { orders: orders.slice(0, 50), label: 'v2' }), n2 = await N('orders', { orders: orders.slice(0, 50), label: 'v2' });
    ok(o2.j.added === 0 && n2.j.added === 0 && o2.j.dup === n2.j.dup, `재업로드 전부 중복 처리 동일 (${n2.j.dup})`);
    const o3 = await O('event', { event: EVENT, excluded: EXCL }), n3 = await N('event', { event: EVENT, excluded: EXCL });
    ok(canon(strip(o3.j.db)) === canon(strip(n3.j.db)), '설정 저장 후 전체 데이터 동일');
    const oe = await jfetch(OB, '/api/lucky/event'), ne = await jfetch(NB, '/api/lucky/event');
    ok(JSON.stringify(oe.j) === JSON.stringify(ne.j), `공개 /event 동일 (응모권 ${ne.j.counts.orders} · 고객 ${ne.j.counts.customers})`);
    let lookSame = 0; const diffs = [];
    for (const q of QUERIES) { const a = await jfetch(OB, '/api/lucky/lookup', { body: { q } }), b = await jfetch(NB, '/api/lucky/lookup', { body: { q } }); if (a.status === b.status && JSON.stringify(a.j) === JSON.stringify(b.j)) lookSame++; else diffs.push(q); }
    ok(lookSame === QUERIES.length, `조회(발표 전) ${lookSame}/${QUERIES.length} 동일${diffs.length ? ' — 다름: ' + diffs.slice(0, 3).join(',') : ''}`);
    seedRandom(4242); const od = await O('draw', {}); seedRandom(4242); const nd = await N('draw', {});
    ok(od.j.pool === nd.j.pool && od.j.tickets === nd.j.tickets, `추첨 응모자/응모권 동일 (${nd.j.pool}명 · ${nd.j.tickets}장)`);
    ok(JSON.stringify(od.j.db.winners) === JSON.stringify(nd.j.db.winners) && nd.j.db.winners.length === 16, `같은 난수 → 당첨자 16명 완전 동일`);
    const exW = nd.j.db.winners.filter(w => /청귤/.test(w.product) || w.date < EVENT.start || w.date > EVENT.end);
    ok(exW.length === 0, '당첨자 중 제외 품목·기간 밖 0');
    ok(new Set(nd.j.db.winners.map(w => w.key)).size === 16, '한 사람 1회 당첨(중복 0)');
    const keep = nd.j.db.winners.slice(1).map(w => w.key);
    seedRandom(99); const ok2 = await O('draw', { keep }); seedRandom(99); const nk2 = await N('draw', { keep });
    ok(canon(ok2.j.db.winners) === canon(nk2.j.db.winners) && keep.every(k => nk2.j.db.winners.some(w => w.key === k)), '「이 사람만 재추첨」 결과 동일·나머지 유지');
    await O('publish', { published: true }); await N('publish', { published: true });
    const ow = await jfetch(OB, '/api/lucky/winners'), nw = await jfetch(NB, '/api/lucky/winners');
    ok(JSON.stringify(ow.j) === JSON.stringify(nw.j), '공개 당첨자 명단(마스킹) 동일');
    lookSame = 0; diffs.length = 0;
    const wq = nk2.j.db.winners.map(w => w.phone).filter(Boolean).slice(0, 6);
    for (const q of QUERIES.concat(wq)) { const a = await jfetch(OB, '/api/lucky/lookup', { body: { q } }), b = await jfetch(NB, '/api/lucky/lookup', { body: { q } }); if (a.status === b.status && JSON.stringify(a.j) === JSON.stringify(b.j)) lookSame++; else diffs.push(q); }
    ok(lookSame === QUERIES.length + wq.length, `조회(발표 후) ${lookSame}/${QUERIES.length + wq.length} 동일`);
    const wl = await jfetch(NB, '/api/lucky/lookup', { body: { q: wq[0] } });
    ok(wl.j.results.some(r => r.status === 'win' && r.prize), '당첨자 번호로 조회 → 당첨 표시');
    const raw = JSON.stringify(wl.j); const d0 = wq[0].replace(/\D/g, '');
    ok(!raw.includes(d0) && !raw.includes(d0.slice(3, 7)), '조회 응답에 전체 번호·가운데 4자리 노출 0');
    const RV = { vendor: orders[5].vendor, date: orders[5].date };
    const orr = await O('remove', RV), nrr = await N('remove', RV);
    ok(orr.j.removed === nrr.j.removed && nrr.j.removed > 0 && canon(strip(orr.j.db)) === canon(strip(nrr.j.db)), `날짜·거래처 삭제 동일 (${nrr.j.removed}건)`);
    const snap = JSON.parse(JSON.stringify(orr.j.db));
    const ors = await O('restore', { db: snap }), nrs = await N('restore', { db: snap });
    ok(canon(strip(ors.j.db)) === canon(strip(nrs.j.db)), '옛 사이트 백업 JSON으로 복원 → 동일');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ═══ ② 권한 · 감사 기록 ═══ */
  console.log('\n② 권한·감사 기록');
  const noAuth = await jfetch(NB, '/api/agent-office/lucky/state');
  ok(noAuth.status === 401, '로그인 없이 관리 API → 401');
  const st = await N('state', null, 'staff');
  ok(st.status === 200 && st.j.db, '직원 계정 → 상태 조회 가능');
  const stOrd = await N('orders', { orders: [{ vendor: '효돈', date: '2026-09-20', buyer: '직원등록테스트', buyerPhone: '010-9999-0001', recv: '직원등록테스트', recvPhone: '010-9999-0001', product: '황금향 가정용 - 5kg', tracking: '699999999991' }], label: 'staff' }, 'staff');
  ok(stOrd.status === 200 && stOrd.j.added === 1, '직원 계정 → 송장 업로드 가능');
  for (const p of ['restore', 'reset', 'new-round']) { const r = await N(p, { confirm: p === 'reset' ? 'RESET' : 'NEW', db: { orders: [] } }, 'staff'); ok(r.status === 403, `직원 계정 → ${p} 차단(403)`); }
  const rsNo = await N('reset', { confirm: 'X' }, 'admin');
  ok(rsNo.status === 400, '초기화는 RESET 확인 없으면 거부');
  const aTxt = JSON.stringify(audits);
  ok(audits.length >= 5 && audits.every(a => a.targetType === 'lucky_event' && a.source === 'lucky_admin'), `쓰기마다 감사 기록 (${audits.length}건)`);
  ok(!/010-?9\d{3}-?\d{4}/.test(aTxt) && !aTxt.includes('직원등록테스트'), '감사 기록에 이름·번호 0');
  let got429 = false; for (let i = 0; i < 45; i++) { const r = await fetch(NB + '/api/lucky/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.9.9.9' }, body: JSON.stringify({ q: '홍길동' }) }); if (r.status === 429) { got429 = true; break; } }
  ok(got429, '공개 조회 레이트 리밋(같은 IP 40회/분 초과 → 429)');

  /* ═══ ③ 저장 지속 (재배포 = 새 인스턴스) ═══ */
  console.log('\n③ 저장 지속');
  const before = (await N('state')).j.db;
  const app2 = makeNewApp(); await listen(app2, PORT + 2);
  const r2 = await jfetch(`http://localhost:${PORT + 2}`, '/api/agent-office/lucky/state', { headers: { 'x-test-role': 'admin' } });
  ok(r2.j && JSON.stringify(r2.j.db.orders) === JSON.stringify(before.orders) && JSON.stringify(r2.j.db.winners) === JSON.stringify(before.winners), `새 서버 인스턴스에서 같은 데이터 (주문 ${before.orders.length} · 당첨 ${before.winners.length}) — 배포해도 안 지워짐`);
  const nr = await N('new-round', { confirm: 'NEW', title: '다음 회차' });
  const rounds = (await N('rounds')).j.rounds;
  ok(nr.status === 200 && nr.j.db.orders.length === 0 && rounds.length === 2 && rounds.filter(r => r.is_current).length === 1 && rounds.find(r => !r.is_current).orders === before.orders.length, '새 회차 = 빈 회차 시작·이전 회차 보관(삭제 안 함)');
  const pubEv = await jfetch(NB, '/api/lucky/event');
  ok(pubEv.j.event.title === '다음 회차' || pubEv.j.event.title === before.event.title, '공개 /event 응답 정상(캐시 15초 허용)');
  await N('restore', { db: before });   // UI 검사를 위해 데이터 되돌림

  /* ═══ ④ 실화면 (Playwright · 실클릭) ═══ */
  console.log('\n④ 실화면');
  let pw; try { pw = require('playwright'); } catch (_) { }
  if (!pw) console.log('  ⏭ playwright 없음 — 건너뜀');
  else {
    const XLSX = require('xlsx-js-style');
    const tmpX = path.join(os.tmpdir(), '제주아꼼이네송장(대성)09.19_vtest.xlsx');
    const s1 = [['보내는사람', '구매자연락처', '수취인명', '수취인연락처1', '옵션정보', '수량', '배송지'], ['화면테스트 드림(제주아꼼이네)', '010-9888-0001', '화면수령', '010-9888-0002', '황금향 선물용 - 3kg(중대과 7~15과)', 1, '제주 서귀포시 1'], ['화면둘(제주아꼼이네)', '010-9888-0003', '화면둘', '010-9888-0003', '최상품 청귤(풋귤) 5kg', 1, '제주 서귀포시 2']];
    const s2 = [['받는분', '받는분전화번호', '상품명', '운송장번호', '집화예정일자', '보내는분'], ['화면수령', '010-9888-0002', '황금향 선물용 - 3kg(중대과 7~15과)', '688800000001', '2026-09-19', '화면테스트 드림(제주아꼼이네)'], ['화면둘', '010-9888-0003', '최상품 청귤(풋귤) 5kg', '688800000002', '2026-09-19', '화면둘(제주아꼼이네)']];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), '시트1'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'Sheet2'); XLSX.writeFile(wb, tmpX);
    const br = await pw.chromium.launch(); const errs = [];
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept(d.type() === 'prompt' ? '' : undefined));
    await pg.goto(NB + '/lucky-admin.html'); await pg.waitForTimeout(800);
    ok(await pg.isVisible('#loginCard') && !(await pg.isVisible('#app')), '로그인 없이 열면 「회사 프로그램 로그인 필요」 카드만');
    ok((await pg.locator('#code').count()) === 0, '관리자 코드 입력칸 없음');
    await pg.evaluate(() => localStorage.setItem('jwt_token', 'staff')); await pg.reload(); await pg.waitForSelector('#app:not(.hidden)', { timeout: 8000 });
    ok(await pg.isVisible('#app'), '직원 로그인 상태 → 관리 화면 표시');
    const cnt0 = +(await pg.textContent('#sOrders'));
    await pg.setInputFiles('#file', tmpX); await pg.waitForSelector('#btnUpload', { timeout: 8000 });
    ok((await pg.textContent('#preview')).includes('2건'), '엑셀 미리보기 2건(운송장 시트 기준)');
    await pg.click('#btnUpload'); await pg.waitForFunction(() => !document.querySelector('#btnUpload'), null, { timeout: 8000 });
    const cnt1 = +(await pg.textContent('#sOrders'));
    ok(cnt1 === cnt0 + 1, `등록 후 응모권 +1 (청귤 1건은 제외) ${cnt0}→${cnt1}`);
    await pg.fill('#evTitle', '화면 검증 이벤트'); await pg.click('#btnSaveEv'); await pg.waitForTimeout(700);
    ok((await N('state')).j.db.event.title === '화면 검증 이벤트', '설정 저장 → DB 반영');
    await pg.click('#btnDraw'); await pg.waitForFunction(() => document.querySelectorAll('#tblWin tbody tr td b').length > 0, null, { timeout: 8000 });
    ok((await pg.locator('#tblWin tbody tr').count()) === 16, '추첨 → 당첨자 표 16행');
    await pg.click('#btnPublish'); await pg.waitForTimeout(700);
    ok((await pg.textContent('#sPub')).includes('발표중'), '발표 시작 → 상태 「발표중」');
    ok((await pg.evaluate(() => localStorage.getItem('lucky_backup'))) === null, '브라우저에 명단 백업 저장 안 함(개인정보)');
    const staffNew = await pg.evaluate(async () => { const r = await fetch('/api/agent-office/lucky/new-round', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer staff' }, body: '{"confirm":"NEW"}' }); return r.status; });
    ok(staffNew === 403, '직원 화면에서 새 회차 요청 → 403');
    // 손님 화면
    const cp = await ctx.newPage(); cp.on('pageerror', e => errs.push(e.message));
    await new Promise(r => setTimeout(r, 15500));   // 공개 캐시 15초
    const evRespP = cp.waitForResponse(r => r.url().includes('/api/lucky/event'), { timeout: 10000 }); await cp.goto(NB + '/lucky.html'); const evJson = await (await evRespP).json(); await cp.waitForTimeout(1500); console.log('    (공개 /event 제목 = ' + evJson.event.title + ' · 발표 ' + evJson.event.published + ')');
    const evT = await cp.textContent('#evTitle').catch(() => ''); ok(evT.includes('화면 검증 이벤트'), '손님 화면 = 이벤트 제목 표시 (' + evT + ')');
    const winner = (await N('state')).j.db.winners[0];
    const popOn = await cp.isVisible('#wmodal.on');
    ok(popOn && (await cp.textContent('#wmodal')).includes(winner.prize), '발표 후 손님 화면 = 당첨자 명단 팝업 자동 표시');
    if (popOn) { await cp.click('#wclose'); await cp.waitForTimeout(300); }
    await cp.fill('#q', winner.phone); await cp.click('#btn'); await cp.waitForTimeout(1500);
    const body = await cp.textContent('body');
    ok(body.includes(winner.prize), '손님 화면 번호 조회 → 당첨 경품 표시');
    ok(!body.includes(winner.phone.replace(/\D/g, '').slice(3, 7)) || winner.phone.replace(/\D/g, '').slice(3, 7) === winner.phone.replace(/\D/g, '').slice(-4), '손님 화면에 가운데 번호 노출 0');
    const imgs = await cp.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src));
    ok(imgs.length === 0, `이미지 깨짐 0${imgs.length ? ' — ' + imgs.join(',') : ''}`);
    ok(errs.length === 0, `페이지 오류 0${errs.length ? ' — ' + errs[0] : ''}`);
    await br.close(); fs.rmSync(tmpX, { force: true });
  }

  crypto.randomInt = realRandomInt;
  servers.forEach(s => s.close());
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  const left = await pool.query(`SELECT to_regclass('${TABLE}') AS t`);
  ok(left.rows[0].t === null, '검증 테이블 삭제 완료(운영 테이블 무접촉)');
  await pool.end();
  console.log(`\n결과: ${pass}/${pass + failN}`);
  process.exit(failN ? 1 : 0);
}
main().catch(e => { console.error('검증 중단:', e); process.exit(2); });

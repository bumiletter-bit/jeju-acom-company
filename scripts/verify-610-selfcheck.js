// #610-F 손님 셀프 조회 「내 주문 어디쯤?」 검증 — sms/selfcheck.js 만 떼어 작은 서버에 장착(server.js 를 띄우지 않는다 · 스케줄러·발송 0)
//   사용: node scripts/verify-610-selfcheck.js   (포트 PORT610 · 없으면 3461 · 다른 Playwright 검증과 동시에 돌리지 말 것)
//   실DB: sms_selfcheck_hits 표를 만들고(initDB) · 시험 송장 줄(운송장 9996100000NN · 받는 분 「시험육일공…」)을 넣었다가 끝에 전부 지운다.
//         택배사 조회는 가짜(cjTrack 대역) → 외부 호출 0. 시험 줄의 배송 상태(delivery_status)도 끝에 지운다.
require('dotenv').config();
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const express = require('express');
const { Pool } = require('pg');
const H = require(path.join(ROOT, 'scripts/ao-dark/harness.js'));
const mount = require(path.join(ROOT, 'sms/selfcheck.js'));
const lookup = require(path.join(ROOT, 'sms/lookup.js'));
const PORT = Number(process.env.PORT610 || 3461), BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const TR = n => '9996100000' + String(n).padStart(2, '0');
const kstYmd = off => new Date(Date.now() + 9 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
const SECRET_ADDR = '시험특별시 비밀로 610번길 61', SECRET_MEMO = '비밀메모육일공', PARTNER = '시험거래처육일공';

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
    const cjCalls = [];
    const cjTrack = { TROUBLE_BUCKETS: ['미배송', '사고', '기타', '정보없음', '조회실패'], trackOne: async tr => { cjCalls.push(tr); return { bucket: '간선상하차', code: '41', label: '간선상차', msg: '시험기사 홍길동 010-9999-8888', time: '2026-10-10 03:00', branch: '시험Hub', driver: { name: '시험기사', phone: '010-9999-8888' }, events: [], delivered: false }; } };
    const app = express(); app.use(express.json({ limit: '100kb' })); app.use(express.static(path.join(ROOT, 'public')));
    const hits = new Set();
    // 시험이 적은 시도 기록(해시)을 전부 모아 끝에 지운다 — 열쇠가 실행마다 달라 실서비스 기록과 겹치지 않는다
    const tpool = { query: (q, p) => { if (/INSERT INTO sms_selfcheck_hits/.test(String(q))) (p || []).forEach(v => hits.add(String(v))); return pool.query(q, p); } };
    const holidays = async () => ({ arriveOff: new Set(), reasons: new Map() });
    const api = mount(app, { pool: tpool, lookup, cjTrack, holidays, log: { error() { } }, secret: 'verify610-' + Date.now() });
    // 상한을 낮춘 따로 띄운 장착(포트는 빈 것 아무거나) — 기본 상한(200회 등)을 실제로 채우지 않고 갈래를 본다
    const variants = [];
    const variant = async (limits, extra) => { const a = express(); a.use(express.json({ limit: '100kb' })); const tg = []; const ap = mount(a, Object.assign({ pool: tpool, lookup, cjTrack, holidays, log: { error() { } }, secret: 'v610-' + variants.length + '-' + Date.now(), limits, notifyTelegram: async t => { tg.push(t); } }, extra || {})); const sv = http.createServer(a); await new Promise(r => sv.listen(0, r)); const o = { api: ap, base: 'http://localhost:' + sv.address().port, sv, tg }; variants.push(o); return o; };
    const server = http.createServer(app); await new Promise(r => server.listen(PORT, r));
    let ipN = 0;
    const post = async (name, tail, ip, V) => {
        ip = ip || '10.61.' + Math.floor(++ipN / 250) + '.' + (ipN % 250);
        hits.add(api.keyHash('ip', ip)); hits.add(api.keyHash('name', String(name).replace(/\s+/g, '')));
        const t0 = Date.now(); const r = await fetch((V ? V.base : BASE) + '/api/track-order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ name, tail }) });
        const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch (e) { /* 글 그대로 */ }
        return { s: r.status, j, text, ms: Date.now() - t0 };
    };
    const cleanup = async () => {
        await pool.query(`DELETE FROM delivery_status WHERE tracking LIKE '9996100000%'`);
        await pool.query(`DELETE FROM delivery_shipments WHERE tracking LIKE '9996100000%'`);
        if (hits.size) await pool.query(`DELETE FROM sms_selfcheck_hits WHERE key_hash = ANY($1::text[])`, [[...hits]]);
    };
    let browser = null;
    try {
        await api.initDB();
        const pre = (await pool.query(`SELECT count(*)::int n FROM delivery_shipments WHERE tracking LIKE '9996100000%' OR recipient LIKE '시험육일공%' OR recipient LIKE '시험 육일공%'`)).rows[0].n;
        if (pre) await cleanup();
        const ins = (n, daysAgo, name, phone, buyer, opt, qty) => pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, addr, option_text, qty, memo, source, buyer_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verify610',$10)`, [TR(n), kstYmd(-daysAgo), PARTNER, name, phone, SECRET_ADDR, opt, qty, SECRET_MEMO, buyer]);
        await ins(1, 1, '시험육일공가', '010-0000-6101', '010-0000-7201', '시험 하우스감귤 4kg', 1);
        await ins(2, 1, '시험육일공가', '010-0000-6101', '010-0000-7201', '시험 하우스감귤 4kg', 1);     // 같은 날 같은 분 = 한 건(2상자)
        await ins(3, 2, '시험육일공나', '010-0000-6102', null, '시험 황금향 3kg', 1);
        await ins(4, 5, '시험육일공나', '010-0000-6102', null, '시험 한라봉 3kg', 1);                    // 다른 날 = 여러 건
        await ins(5, 3, '시험육일공다', '010-0000-6103', null, '시험 레드향 3kg', 1);                    // 배송완료
        await ins(6, 1, '시험 육일공라', '010-0000-6104', null, '시험 천혜향 3kg', 2);                   // 이름에 빈칸
        await ins(7, 40, '시험육일공마', '010-0000-6105', null, '시험 밤호박', 1);                       // 30일 밖
        await ins(8, 1, '시험육일공바', '010-0000-6106', null, '시험 레몬', 1);                          // 사고
        const st = (n, bucket, delivered, minsAgo) => pool.query(`INSERT INTO delivery_status (tracking, bucket, code, label, msg, event_time, branch, driver_name, driver_phone, events, delivered, checked_at) VALUES ($1,$2,'','${'시험단계'}','시험기사 비밀','','', '시험기사', '010-9999-8888', '[]'::jsonb, $3, now() - ($4::int * interval '1 minute'))`, [TR(n), bucket, delivered, minsAgo]);
        await st(1, '배송출발', false, 5);          // 방금 확인 → 다시 안 묻는다
        await st(5, '배송완료', true, 600);
        await st(6, '집화', false, 300);            // 5시간 전 확인 → 다시 묻는다(가짜 택배사)
        await st(8, '사고', false, 5);

        console.log('\n── 찾기');
        const a = await post('시험육일공가', '6101');
        const o = a.j.order || {};
        ok(a.s === 200 && a.j.match === 'one' && o.boxes === 2 && o.option_text === '시험 하우스감귤 4kg', `받는 분 성함 + 받는 분 번호 끝 4자리 → 1건(2상자 · ${o.option_text})`);
        ok(o.tracking_tail === '0001' && o.stage === '배송출발' && o.stage_step === 3 && /배송 출발/.test(o.stage_title || ''), `운송장은 끝 4자리만(${o.tracking_tail}) · 단계 「${o.stage_title}」(${o.stage_step}/4)`);
        ok(cjCalls.join() === TR(2), `확인한 적 없는 상자만 택배사에 새로 물어봄(가짜 · ${cjCalls.join() || '없음'})`);
        ok(/^\d+\/\d+\([일월화수목금토]\)(~\d+\/\d+\([일월화수목금토]\) 사이)? 도착 예정/.test(o.arrive_text || '') && !/내일|모레/.test(o.arrive_text || ''), `도착 예정은 날짜로(「내일·모레」 없음): ${o.arrive_text}`);
        ok(o.ship_text === (() => { const d = new Date(kstYmd(-1) + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'일월화수목금토'[d.getUTCDay()]})`; })(), `보낸 날 ${o.ship_text}`);
        const b = await post('시험육일공가', '7201');
        ok(b.j.match === 'one' && b.j.order.boxes === 2, '주문하신 분(구매자) 번호 끝 4자리로도 같은 1건');
        const many = await post('시험육일공나', '6102');
        ok(many.s === 200 && many.j.match === 'many' && !many.j.order, '같은 성함·번호로 다른 날 2건 → many(내용은 안 줌)');
        const done = await post('시험육일공다', '6103');
        ok(done.j.match === 'one' && done.j.order.delivered === true && done.j.order.stage_step === 4 && !done.j.order.arrive_text, `배송완료 건 = 4/4 · 도착 예정 글 없음(「${done.j.order && done.j.order.stage_title}」)`);
        const sp = await post('시험육일공라', '6104'), sp2 = await post('시험 육일공라', '6104');
        ok(sp.j.match === 'one' && sp2.j.match === 'one' && sp.j.order.qty === 2, '송장의 이름에 빈칸이 있어도 · 손님이 띄어 적어도 찾음');
        ok(cjCalls.includes(TR(6)) && sp.j.order.stage === '간선상하차', `2시간 넘게 낡은 상태는 다시 물어 새 값으로(${sp.j.order.stage})`);
        const acc = await post('시험육일공바', '6106');
        ok(acc.j.match === 'one' && acc.j.order.stage_step === 0 && /확인하고 있어요/.test(acc.j.order.stage_title) && !/사고/.test(acc.text), `사고·미배송은 「${acc.j.order.stage_title}」로만(「사고」 글자 없음)`);
        const old = await post('시험육일공마', '6105');
        ok(old.j.match === 'none', '30일 지난 주문은 안 보임');
        const n1 = await post('시험육일공가', '0000'), n2 = await post('시험육일공하', '6101'), n3 = await post('시험육일공', '6101'), n4 = await post('험육일공가', '6101');
        ok(n1.j.match === 'none' && n2.j.match === 'none', '끝 4자리 틀림 → none · 성함 틀림 → none');
        ok(n3.j.match === 'none' && n4.j.match === 'none', '성함 일부만(앞·뒤 잘라서) 적으면 안 찾음(전체 일치만)');
        ok(n1.ms >= 300 && n2.ms >= 300 && a.ms >= 300, `응답은 가장 빨라도 300ms(없음 ${n1.ms} · ${n2.ms}ms · 있음 ${a.ms}ms)`);

        console.log('\n── 새어 나가면 안 되는 것');
        const all = [a, b, many, done, sp, sp2, acc, old, n1, n2, n3, n4].map(x => x.text).join('\n');
        const leaks = [['주소', SECRET_ADDR.slice(0, 5)], ['주소2', '비밀로'], ['메모', SECRET_MEMO], ['거래처', PARTNER], ['받는 분 번호 전체', '01000006101'], ['번호(줄표)', '010-0000'], ['구매자 번호', '00007201'], ['운송장 전체', '9996100000'], ['기사', '시험기사'], ['기사 번호', '9999-8888'], ['받는 분 이름', '시험육일공'], ['택배사 원문', '비밀']].filter(([, s]) => all.includes(s));
        ok(leaks.length === 0, `12개 응답 어디에도 주소·번호 전체·운송장 전체·메모·거래처·기사·이름 없음(${leaks.map(l => l[0]).join(', ') || '유출 0'})`);
        const keys = [a, b, done, sp, acc].flatMap(x => Object.keys(x.j.order || {})).filter(k => !mount.PUBLIC.includes(k));
        ok(keys.length === 0 && Object.keys(a.j).sort().join() === 'match,ok,order', `응답 칸은 허용 목록만(${[...new Set([a, done].flatMap(x => Object.keys(x.j.order)))].join(' · ')})`);
        ok(!/9996100000/.test(decodeURIComponent(o.go || '')) && /^\/track-order\/go\?t=[A-Za-z0-9_-]{40,}$/.test(o.go || ''), '조회 링크 토큰 안에 운송장이 글자로 들어 있지 않음(암호화)');

        console.log('\n── 택배사로 넘기기');
        const go = await fetch(BASE + o.go, { redirect: 'manual' });
        ok(go.status === 302 && go.headers.get('location') === 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=' + TR(1), `토큰 → 302 택배사 조회(운송장은 서버가 붙임 · 아직 안 끝난 상자)`);
        const bad = await fetch(BASE + '/track-order/go?t=' + o.go.slice(-30), { redirect: 'manual' }), none = await fetch(BASE + '/track-order/go', { redirect: 'manual' });
        const forged = await fetch(BASE + '/track-order/go?t=' + Buffer.from(JSON.stringify({ t: TR(1), e: Date.now() + 9e5 })).toString('base64url'), { redirect: 'manual' });
        ok([bad, none, forged].every(r => r.status === 302 && r.headers.get('location') === '/track-order?e=expired'), '틀린 토큰 · 빈 토큰 · 손으로 만든 토큰 → 조회 화면으로(택배사로 안 넘어감)');
        const exp = await fetch(BASE + '/track-order/go?t=' + api.makeToken(TR(1), Date.now() - 11 * 60000), { redirect: 'manual' });
        ok(exp.headers.get('location') === '/track-order?e=expired' && api.readToken(api.makeToken(TR(1))) === TR(1), '10분 지난 토큰은 만료 · 기한 안이면 풀림');

        console.log('\n── 입력 검증 · 시도 제한');
        const v = [await post('가', '1234'), await post('시험육일공가<b>', '6101'), await post('가나다라마바사아자차카', '6101'), await post('시험육일공가', '12a4'), await post('시험육일공가', '12345'), await post('시험육일공가', ''), await post('', '6101')];
        ok(v.every(x => x.s === 400 && x.j.ok === false && x.j.field), `잘못된 입력 7가지 전부 400 + 어느 칸인지(${v.map(x => x.j.field).join(',')})`);
        const viaSql = await post("시험육일공가' OR '1'='1", '6101');
        ok(viaSql.s === 400, '따옴표·기호가 든 이름은 400(조회까지 안 감)');
        const ipA = '10.99.61.1', r1 = [];
        for (let i = 0; i < 6; i++) r1.push(await post('시험육일공사' + '가나다라마바'[i], '9999', ipA));
        ok(r1.slice(0, 5).every(x => x.s === 200) && r1[5].s === 429 && /뒤에 다시/.test(r1[5].j.error || ''), `같은 IP 10분에 5회까지 · 6회째 429(${r1.map(x => x.s).join(',')}) 「${r1[5].j.error}」`);
        ok(api.limits.perName === 30 && api.limits.perTail === 20 && api.limits.perAll === 200 && api.limits.noneStreak === 10 && api.limits.lockMin === 60 && api.limits.maxRunning === 8 && api.limits.perIp === 5, `기본 상한 = IP 5 · 성함 30 · 끝자리 20 · 전체 200(10분) · 없음 10번 이어지면 60분 잠금 · 동시 8(${JSON.stringify(api.limits)})`);
        // ① IP = x-forwarded-for 의 마지막 값 — 앞쪽을 꾸며 바꿔도 같은 IP 로 센다
        const rx = [];
        for (let i = 0; i < 6; i++) rx.push(await post('시험육일공자' + '가나다라마바'[i], '9998', '1.2.3.' + (i + 1) + ', 10.96.61.7'));
        ok(rx.slice(0, 5).every(x => x.s === 200) && rx[5].s === 429, `IP 는 x-forwarded-for 의 마지막 값 — 앞 값을 매번 바꿔도 6회째 429(${rx.map(x => x.s).join(',')})`);
        const ry = [];
        for (let i = 0; i < 6; i++) ry.push(await post('시험육일공차' + '가나다라마바'[i], '9997', '10.96.61.8, 10.95.' + i + '.1'));
        ok(ry.every(x => x.s === 200), `앞 값이 같아도 마지막 값이 다르면 서로 다른 IP(${ry.map(x => x.s).join(',')})`);
        // 성함 상한 · 끝자리 상한 · 전체 상한 · 없음 잠금 · 동시 상한 — 상한을 낮춘 장착으로
        const VN = await variant({ perName: 5 }), r2 = [];
        for (let i = 0; i < 6; i++) r2.push(await post('시험육일공아', '000' + i, '10.98.61.' + (i + 1), VN));
        ok(r2.slice(0, 5).every(x => x.s === 200) && r2[5].s === 429, `같은 성함으로 끝자리를 바꿔 가며 찍기 → 상한(시험 5)까지 · 다음은 429(IP 를 바꿔도 · ${r2.map(x => x.s).join(',')})`);
        const VT = await variant({ perTail: 3 }), r3 = [];
        for (let i = 0; i < 4; i++) r3.push(await post('시험육일공카' + '가나다라'[i], '6101', '10.94.61.' + (i + 1), VT));
        ok(r3.slice(0, 3).every(x => x.s === 200) && r3[3].s === 429, `③ 같은 끝 4자리를 성함·IP 를 바꿔 가며 찍기 → 상한(시험 3)까지 · 다음은 429(${r3.map(x => x.s).join(',')})`);
        const VA = await variant({ perAll: 3 }), r4 = [];
        for (let i = 0; i < 6; i++) r4.push(await post('시험육일공타' + '가나다라마바'[i], '700' + i, '10.93.61.' + (i + 1), VA));
        await new Promise(r => setTimeout(r, 100));
        ok(r4.slice(0, 3).every(x => x.s === 200) && r4.slice(3).every(x => x.s === 429) && /몰려/.test(r4[5].j.error || ''), `② 전체 상한(시험 3) → 넘으면 누구든 429 「${r4[5].j.error}」(${r4.map(x => x.s).join(',')})`);
        ok(VA.tg.length === 1 && /셀프 조회/.test(VA.tg[0]) && !/시험육일공|700\d|10\.93/.test(VA.tg[0]), `② 텔레그램은 1시간에 한 번만(3번 막혔는데 ${VA.tg.length}통) · 글에 성함·번호·IP 없음`);
        const VL = await variant({ perIp: 100, noneStreak: 3, lockMin: 60 }), ipL = '10.92.61.1', r5 = [];
        r5.push(await post('시험육일공파가', '1111', ipL, VL)); r5.push(await post('시험육일공파나', '1112', ipL, VL));
        r5.push(await post('시험육일공가', '6101', ipL, VL));                                             // 맞힘 → 이어진 「없음」 처음부터
        r5.push(await post('시험육일공파다', '1113', ipL, VL)); r5.push(await post('시험육일공파라', '1114', ipL, VL));
        const notYet = await post('시험육일공가', '6101', ipL, VL);                                         // 없음 2번뿐 → 아직 안 잠김(그리고 다시 처음부터)
        for (const t of ['1115', '1116', '1117']) r5.push(await post('시험육일공파마', t, ipL, VL));       // 없음 3번 이어짐 → 잠금
        const locked = await post('시험육일공가', '6101', ipL, VL), other = await post('시험육일공가', '6101', '10.92.61.2', VL);
        ok(r5.every(x => x.s === 200) && notYet.j.match === 'one' && locked.s === 429 && !locked.j.order && /잠시 막아/.test(locked.j.error || '') && other.j.match === 'one', `④ 「없음」이 상한(시험 3)만큼 이어진 IP 는 잠금(맞는 값도 429 「${locked.j.error}」) · 중간에 맞히면 처음부터 · 다른 IP 는 그대로`);
        const slow = Object.assign({}, lookup, { refreshOrder: async (...a) => { await new Promise(r => setTimeout(r, 2500)); return lookup.refreshOrder(...a); } });
        const VC = await variant({ maxRunning: 2, perName: 100, perTail: 100 }, { lookup: slow });
        const r6 = await Promise.all([1, 2, 3, 4, 5].map(i => post('시험육일공가', '6101', '10.91.61.' + i, VC)));
        console.log("    (동시 시험 응답: " + r6.map(x => x.s + "/" + x.ms + "ms/" + (x.j.match || x.j.error || "").slice(0, 12)).join(" · ") + ")");
        const okN = r6.filter(x => x.s === 200 && x.j.match === 'one').length, busyN = r6.filter(x => x.s === 429 && /몰려/.test(x.j.error || '')).length;
        ok(okN === 2 && busyN === 3, `⑧ 동시에 상한(시험 2)까지만 조회 · 나머지는 429 「잠시 뒤」(조회 ${okN} · 막힘 ${busyN})`);
        const again = await post('시험육일공가', '6101', '10.91.61.9', VC);
        ok(again.j.match === 'one', '⑧ 끝난 뒤에는 다시 조회됨(셈이 풀림)');
        // ⑥ 정리 · ⑦ 색인
        await pool.query(`INSERT INTO sms_selfcheck_hits (kind, key_hash, at) VALUES ('ip', 'verify610old', now() - interval '2 days'), ('ip', 'verify610new', now())`); hits.add('verify610old'); hits.add('verify610new');
        const purged = await api.purge(), leftOld = (await pool.query(`SELECT key_hash FROM sms_selfcheck_hits WHERE key_hash IN ('verify610old', 'verify610new')`)).rows.map(x => x.key_hash).join();
        ok(purged >= 1 && leftOld === 'verify610new' && typeof mount.purge === 'function', `⑥ purge = 하루 지난 시도 기록만 지움(${purged}줄 · 남은 것 ${leftOld}) · 모듈에서도 부를 수 있음(mount.purge(pool))`);
        const idx = (await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'delivery_shipments' AND indexname IN ('idx_ds_tail_phone', 'idx_ds_tail_buyer')`)).rows;
        ok(idx.length === 2 && idx.every(x => /"?right"?\(/.test(x.indexdef) && /length\(/.test(x.indexdef)), `⑦ 끝 4자리 색인 2개(받는 분 · 구매자) 있음`);
        const plan = (await pool.query(`EXPLAIN SELECT 1 FROM delivery_shipments s WHERE ((right(s.phone_digits, 4) = '6101' AND length(s.phone_digits) >= 9) OR (right(s.buyer_digits, 4) = '6101' AND length(s.buyer_digits) >= 9)) AND s.ship_date >= current_date - 30`)).rows.map(x => x['QUERY PLAN']).join('\n');
        ok(/idx_ds_tail_phone/.test(plan) && /idx_ds_tail_buyer/.test(plan), `⑦ 조회가 그 색인을 탐(${/Seq Scan/.test(plan) ? '전체 읽기 섞임' : '색인만'})`);
        const blocked = await post('시험육일공가', '6101', ipA);
        ok(blocked.s === 429 && !blocked.j.order && blocked.ms >= 300, '막힌 IP 는 맞는 값을 넣어도 429(내용 없음)');
        const hr = (await pool.query(`SELECT kind, key_hash FROM sms_selfcheck_hits WHERE key_hash = ANY($1::text[])`, [[...hits].filter(h => !/^verify610/.test(h))])).rows;
        ok(hr.length > 10 && hr.every(x => /^[0-9a-f]{40}$/.test(x.key_hash) && ['ip', 'name', 'tail', 'all', 'none', 'lock'].includes(x.kind)), `시도 기록은 해시로만(IP·성함·끝자리 원문 없음 · ${hr.length}줄 · 종류 ${[...new Set(hr.map(x => x.kind))].sort().join('/')})`);

        console.log('\n── 화면');
        const pg0 = await fetch(BASE + '/track-order'); const html = await pg0.text();
        ok(/noindex/.test(pg0.headers.get('x-robots-tag') || '') && /<meta name="robots" content="noindex/.test(html) && pg0.headers.get('cache-control') === 'no-store', 'noindex(머리글 + meta) · 저장 안 함');
        const style = (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1] || '', root = (/:root\s*\{([\s\S]*?)\}/.exec(style) || [])[1] || '', rest = style.replace(/:root\s*\{[\s\S]*?\}/, '');
        const hard = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || [];
        ok(root.length > 100 && hard.length === 0, `규칙 안에 직접 적은 색 0(전부 토큰 변수 · ${(rest.match(/var\(--/g) || []).length}곳)${hard.length ? ' · ' + hard.slice(0, 5).join(' ') : ''}`);
        const guide = fs.readFileSync(path.join(ROOT, '디자인/디자인_가이드.md'), 'utf8').toUpperCase().replace(/\s/g, '');
        const vals = [...root.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]);
        const off = vals.filter(([k, val]) => (val.match(/#[0-9a-fA-F]{6}\b/g) || []).some(h => !guide.includes(h.toUpperCase())) || (/rgba\(/.test(val) && !guide.includes(val.toUpperCase().replace(/\s/g, '').split('),')[0].replace(/\)$/, '')))).map(([k, val]) => k + ' ' + val);
        ok(off.every(x => /^--danger-(dark|light) /.test(x)), `토큰 값 ${vals.length}개 = 디자인 가이드에 있는 값(가이드 밖 = ${off.join(' / ') || '없음'} · 빨강 글자·옅은 빨강 바탕은 앱에서 이미 쓰는 값)`);
        ok(/Pretendard/.test(style) && /pretendard@1\.3\.9\/dist\/web\/static\/pretendard\.css" integrity="sha384-[A-Za-z0-9+\/=]{64}" crossorigin="anonymous"/.test(html) && /src="\/akkomi\.png"/.test(html) && !/—/.test(html.replace(/<script>[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, '')), 'Pretendard(고정 판 + 무결성 값) · 아꼼이 로고 · 긴 줄표 없음');
        const { chromium } = require('playwright');
        browser = await chromium.launch();
        for (const [label, vw, phone] of [['폰 390', { width: 390, height: 844 }, true], ['PC', { width: 1280, height: 800 }, false]]) {
            const ctx = await browser.newContext(Object.assign({ viewport: vw, reducedMotion: 'reduce', extraHTTPHeaders: { 'X-Forwarded-For': '10.97.61.' + (phone ? 1 : 2) } }, phone ? { isMobile: true, hasTouch: true } : {}));
            hits.add(api.keyHash('ip', '10.97.61.' + (phone ? 1 : 2)));
            const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', e => errors.push(String(e)));
            await pg.goto(BASE + '/track-order', { waitUntil: 'networkidle' });
            const sw = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
            const g = await pg.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }; return { name: r('#name'), tail: r('#tail'), go: r('#go'), logo: document.querySelector('.hd img').naturalWidth > 0, font: getComputedStyle(document.body).fontFamily, h1: document.querySelector('h1').textContent, fs: parseFloat(getComputedStyle(document.querySelector('#name')).fontSize), res: document.getElementById('res').hidden }; });
            ok(g.name[1] >= 44 && g.tail[1] >= 44 && g.go[1] >= 44 && g.fs >= 16, `[${label}] 입력 칸·버튼 높이 ${g.name[1]}·${g.tail[1]}·${g.go[1]}px · 입력 글자 ${g.fs}px(폰 확대 안 됨)`);
            ok(g.logo && /Pretendard/.test(g.font) && g.h1 === '내 주문 어디쯤?' && g.res && await sw() <= vw.width, `[${label}] 로고 뜸 · 글꼴 · 제목 · 가로 넘침 없음(${await sw()})`);
            await pg.click('#go'); await pg.waitForTimeout(200);
            const e1 = await pg.evaluate(() => ({ n: document.getElementById('e-name').textContent, t: document.getElementById('e-tail').textContent, inv: document.getElementById('name').getAttribute('aria-invalid'), focus: document.activeElement.id }));
            ok(/성함/.test(e1.n) && /끝 4자리/.test(e1.t) && e1.inv === 'true' && e1.focus === 'name', `[${label}] 빈 채로 누름 → 칸 아래 안내 2개 · 첫 칸에 초점(서버에 안 보냄)`);
            await pg.fill('#tail', '12ab34'); const tv1 = await pg.inputValue('#tail'); await pg.fill('#tail', '010-1234-5678'); const tv2 = await pg.inputValue('#tail'); ok(tv1 === '1234' && tv2 === '5678', `[${label}] 끝자리 칸은 숫자만 4자리까지(${tv1}) · 번호 전체를 붙여 넣으면 끝 4자리만(${tv2})`);
            const nm = phone ? '시험 육일공라' : '시험육일공가', tl = phone ? '6104' : '6101';
            await pg.fill('#name', nm); await pg.fill('#tail', tl);
            hits.add(api.keyHash('name', nm.replace(/\s+/g, '')));
            if (phone) await pg.tap('#go'); else await pg.press('#tail', 'Enter');
            await pg.waitForSelector('#res:not([hidden]) .rows', { timeout: 6000 });
            const r = await pg.evaluate(() => ({ who: document.querySelector('#res .who').textContent, h2: document.querySelector('#res h2').textContent, steps: Array.from(document.querySelectorAll('#res .steps li')).map(l => l.className.trim() || '-').join('|'), rows: Array.from(document.querySelectorAll('#res .rows div')).map(d => d.querySelector('dt').textContent + '=' + d.querySelector('dd').textContent), link: document.querySelector('#res a.btn').getAttribute('href'), linkH: Math.round(document.querySelector('#res a.btn').getBoundingClientRect().height), text: document.getElementById('res').innerText, btn: document.getElementById('go').textContent }));
            ok(r.who === nm.replace(/\s+/g, '') + ' 님께 보낸 주문' && r.rows.some(x => /^운송장=끝 \d{4}$/.test(x)) && r.rows.some(x => /^도착 예정=/.test(x)) && r.rows.some(x => /^상자=/.test(x)), `[${label}] 결과 = 「${r.h2}」 · ${r.rows.join(' · ')}`);
            ok(/now/.test(r.steps) && r.steps.split('|').length === 4, `[${label}] 배송 단계 4칸 중 지금 자리 표시(${r.steps})`);
            ok(/^\/track-order\/go\?t=/.test(r.link) && r.linkH >= 44 && !/9996100000|010-0000|비밀/.test(r.text) && r.btn === '배송 상태 조회하기', `[${label}] [택배사에서 자세히 보기] ${r.linkH}px · 화면에 운송장 전체·번호·주소 없음`);
            ok(await sw() <= vw.width, `[${label}] 결과가 뜬 뒤 가로 넘침 없음(${await sw()})`);
            const au = await H.audit(pg, 'body'); ok(au.fails.length === 0, `[${label}] 글자 대비 미달 0(글자 ${au.texts}개 · 최소 ${au.minR}${au.fails.length ? ' · ' + au.fails.slice(0, 4).join(' / ') : ''})`);
            await pg.fill('#name', '시험육일공나'); await pg.fill('#tail', '6102'); hits.add(api.keyHash('name', '시험육일공나')); await pg.click('#go');
            await pg.waitForFunction(() => /여러 건/.test(document.getElementById('res').innerText), null, { timeout: 6000 }).catch(() => { });
            const m = await pg.evaluate(() => ({ t: document.getElementById('res').innerText, sms: (document.querySelector('#res a.btn') || {}).href, h: Math.round((document.querySelector('#res a.btn') || document.body).getBoundingClientRect().height), rows: !!document.querySelector('#res .rows') }));
            ok(/주문이 여러 건 있어요/.test(m.t) && /^sms:01066874031$/.test(m.sms || '') && m.h >= 44 && !m.rows, `[${label}] 여러 건 → 안내 + [문자로 문의하기](sms: 링크 · ${m.h}px) · 주문 내용 없음`);
            await pg.fill('#name', '시험육일공하'); await pg.fill('#tail', '0000'); hits.add(api.keyHash('name', '시험육일공하')); await pg.click('#go');
            await pg.waitForFunction(() => /찾지 못했어요/.test(document.getElementById('res').innerText), null, { timeout: 6000 }).catch(() => { });
            ok(/주문을 찾지 못했어요/.test(await pg.innerText('#res')) && /보내기 전/.test(await pg.innerText('#res')), `[${label}] 없음 → 「찾지 못했어요 · 보내기 전이면 안 보여요」 + 문자 문의`);
            await pg.goto(BASE + '/track-order?e=expired', { waitUntil: 'networkidle' });
            ok(/조회 시간이 지났어요/.test(await pg.innerText('#res')) && !/e=expired/.test(pg.url()), `[${label}] 만료된 링크로 돌아오면 안내 · 주소에서 꼬리 지움`);
            ok(errors.length === 0, `[${label}] 화면 오류 ${errors.length}${errors.length ? ' · ' + errors[0] : ''}`);
            await ctx.close();
        }
        {   // 막힌 뒤 화면
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'X-Forwarded-For': '10.99.61.1' } }); const pg = await ctx.newPage();
            await pg.goto(BASE + '/track-order', { waitUntil: 'networkidle' }); await pg.fill('#name', '시험육일공가'); await pg.fill('#tail', '6101'); await pg.click('#go');
            await pg.waitForFunction(() => !document.getElementById('res').hidden, null, { timeout: 6000 }).catch(() => { });
            ok(/잠시 뒤 다시 조회해 주세요/.test(await pg.innerText('#res')) && !(await pg.locator('#res .rows').count()), '[막힘] 시도 제한에 걸리면 「잠시 뒤 다시」 안내(주문 내용 없음)');
            await ctx.close();
        }
    } finally {
        if (browser) await browser.close().catch(() => { });
        try { await cleanup(); const left = (await pool.query(`SELECT (SELECT count(*) FROM delivery_shipments WHERE tracking LIKE '9996100000%')::int a, (SELECT count(*) FROM delivery_status WHERE tracking LIKE '9996100000%')::int b, (SELECT count(*) FROM sms_selfcheck_hits WHERE key_hash = ANY($1::text[]))::int c`, [[...hits]])).rows[0]; ok(left.a === 0 && left.b === 0 && left.c === 0, `시험 줄 전부 지움(송장 ${left.a} · 상태 ${left.b} · 시도 기록 ${left.c})`); } catch (e) { fail++; console.log('  ❌ 시험 줄 지우기 실패: ' + e.message); }
        server.close(); for (const v of variants) v.sv.close(); await pool.end().catch(() => { });
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

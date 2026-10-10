// #610 수정 F2 — 운영 갈래 검증(보관 정리 · 멈춘 글 쓸기 · 보내기 동시 실행 · 재시도 · MMS 순서 뒤집힘 · 켠 직후 끊김 알림) · 워커2 10/10
//   verify-610-server.js 와 같은 장착(가짜 deps + 실DB). 설정·알림·텔레그램·발송·audit 은 전부 가짜 → 실 설정 행·실 발송·실 audit 0.
//   실DB 쓰기 = 시험 줄만: 번호 0999600…(sms_threads/messages/images) · 운송장 9996000000…(delivery_shipments/delivery_status). 시작·끝에 그 줄만 지운다.
//   실행: node scripts/verify-610-ops.js [--force]      (포트 안 씀 · 끝에 「결과 N/N」)
//   🔴 이 스크립트가 부르는 retentionRun · sweepStuck · sendTick 은 **표 전체**를 본다(시험 줄만 골라 돌지 않는다).
//      그래서 시작할 때 「시험 줄이 아닌데 건드려질 실제 줄」을 세어 1건이라도 있으면 멈춘다(--force 로만 넘김 · 넘기면 실제 줄이 가짜 발송·가짜 알림으로 처리된다):
//        · delivery_shipments 60일 지난 실제 줄 / 고아 delivery_status(60일) — retentionRun 이 지운다
//        · sms_images 보관 기간 지난 실제 사진 — retentionRun 이 비운다
//        · sms_messages 실제 queued·sending 줄 — sendTick 이 가짜 게이트웨이로 「보낸 것」으로 만든다
//        · 최근 1시간 안에 글이 온 실제 new 대화 — sweepStuck 이 staff_needed 로 바꾸고 알림은 가짜로 사라진다
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto'); const { Pool } = require('pg');
const mount = require('../sms/index.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
const FORCE = process.argv.includes('--force');
process.env.SMSGATE_SIGNING_KEY = 'verify610ops'; process.env.SMSGATE_USER = 'u'; process.env.SMSGATE_PASS = 'p';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗', m); } };
const T = '0999600'; const P = n => T + String(1000 + n);          // 시험 번호 09996001001 …
const TR = n => '9996000000' + String(n).padStart(2, '0');           // 시험 운송장 12자리
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ago = min => new Date(Date.now() - min * 60000);

async function cleanup() {
    await pool.query(`DELETE FROM sms_images WHERE message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']);
    await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']);
    await pool.query(`DELETE FROM delivery_status WHERE tracking LIKE '9996000000%'`);
    await pool.query(`DELETE FROM delivery_shipments WHERE tracking LIKE '9996000000%'`);
}

(async () => {
    // ── 가짜 의존 ──
    const cfgStore = { sms_gateway: { enabled: true, mode: 'auto', hold_sec: 0, max_chars: 70, staff_ids: [1], cooldown_min: 30, daily_cap: 1, ttl_sec: 600, image_days: 30, ping_alert_hours: 3 }, db_retention: { enabled: true } };
    const notes = [], tg = [], sent = [], audits = [];
    const deps = {
        testMode: true,   // 실서버가 시험 번호 줄을 집지 않게(index.js TEST_SKIP)
        pool, authMiddleware: (req, res, next) => res.status(401).end(),
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; },
        writeAudit: async a => { audits.push(a); }, createNotification: async (uid, type, title, message, link) => { notes.push({ uid, type, title, message, link }); },
        notifyTelegram: async t => { tg.push(t); }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async () => null, cjTrack: null, deliveryUpsertStatus: null,
        log: { log() { }, error(...a) { console.log('   [module error]', ...a); } },
        gatewaySend: async (digits, text, id) => { sent.push({ digits, text, id, at: Date.now() }); await sleep(400); return { id }; },   // 느린 게이트웨이(동시 실행 겹침을 만들기 위해)
        stateMerge: async obj => { cfgStore.sms_gateway_state = Object.assign({}, cfgStore.sms_gateway_state || {}, obj); return cfgStore.sms_gateway_state; },   // 실 설정 행(sms_gateway_state)에 안 쓰게
    };
    const noop = () => { }; const fakeApp = { get: noop, post: noop, put: noop, delete: noop, use: noop };   // 라우트는 안 쓴다(함수 직접 호출)
    const sms = mount(fakeApp, deps);
    for (const fn of ['retentionRun', 'sweepStuck', 'sendTick', 'handleWebhook', 'watchTick', 'initDB']) {
        if (typeof sms[fn] !== 'function') { console.log(`sms/index.js 가 ${fn} 을 내보내지 않아요 — 총괄이 export 를 넣은 뒤 다시 실행하세요.`); await pool.end(); process.exit(2); }
    }
    await sms.initDB();
    await cleanup();

    // ── 실제 줄 보호(머리말 🔴) ──
    const real = (await pool.query(`SELECT
        (SELECT count(*)::int FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60) AS ship_old,
        (SELECT count(*)::int FROM delivery_status t WHERE t.checked_at < now() - interval '60 days' AND NOT EXISTS (SELECT 1 FROM delivery_shipments s WHERE s.tracking = t.tracking)) AS status_orphan,
        (SELECT count(*)::int FROM sms_images WHERE purged_at IS NULL AND data IS NOT NULL AND created_at < now() - interval '30 days') AS img_old,
        (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND state IN ('queued','sending')) AS out_pending,
        (SELECT count(*)::int FROM sms_threads WHERE status = 'new' AND last_in_at > now() - interval '1 hour') AS new_recent`)).rows[0];
    const realN = Object.values(real).reduce((a, b) => a + b, 0);
    if (realN > 0 && !FORCE) { console.log('실제 줄이 건드려질 수 있어 멈춥니다(시험 줄 아님):', JSON.stringify(real), '\n → 실사용이 조용할 때 다시 돌리거나, 내용을 확인한 뒤 --force'); await pool.end(); process.exit(3); }
    if (realN > 0) console.log('⚠ --force: 실제 줄이 함께 처리됩니다', JSON.stringify(real));

    const thread = async d => (await pool.query(`SELECT * FROM sms_threads WHERE phone_digits = $1`, [d])).rows[0];
    const msgs = async d => (await pool.query(`SELECT m.* FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits = $1 ORDER BY m.id`, [d])).rows;
    const mkThread = async (d, status, extra) => (await pool.query(`INSERT INTO sms_threads (phone_digits, status, last_in_at, updated_at) VALUES ($1, $2, $3, $3) RETURNING *`, [d, status, (extra && extra.at) || new Date()])).rows[0];
    const mkMsg = async (threadId, o) => (await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, gateway_id, send_after, sent_at, event_at, created_at, bucket)
        VALUES ($1,$2,'sms',$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING *`, [threadId, o.dir, o.body || '시험', o.sender, o.state, o.gw || null, o.send_after || null, o.sent_at || null, o.at || new Date(), o.dir === 'in' ? (o.bucket || 'other') : null])).rows[0];
    const env = (event, payload, id) => ({ id: id || crypto.randomUUID(), event, deviceId: 'dev1', webhookId: 'w1', payload });

    try {
        console.log('① 보관 정리 — 송장 60일 · 그 상태 줄');
        await pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES
            ($1, (now() AT TIME ZONE 'Asia/Seoul')::date - 59, '시험', '검증육일구', '09996001059', 'verify610ops'),
            ($2, (now() AT TIME ZONE 'Asia/Seoul')::date - 61, '시험', '검증육일일', '09996001061', 'verify610ops')`, [TR(59), TR(61)]);
        await pool.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered, checked_at, handled_at, handled_by) VALUES ($1, 'done', '배송완료', true, now() - interval '61 days', now() - interval '60 days', '검증')`, [TR(61)]);
        await pool.query(`INSERT INTO delivery_status (tracking, bucket, label, delivered, checked_at) VALUES ($1, 'done', '배송완료', true, now() - interval '59 days')`, [TR(59)]);
        // ② 사진: 31일 전 1줄(비워져야 함) · 29일 전 1줄(남아야 함)
        const tImg = await mkThread(P(1), 'staff_needed'); const mImg = await mkMsg(tImg.id, { dir: 'in', sender: 'customer', state: 'received', at: ago(60 * 24 * 31) });
        const img31 = (await pool.query(`INSERT INTO sms_images (message_id, content_type, name, size_bytes, data, created_at) VALUES ($1,'image/jpeg','old.jpg',4,$2, now() - interval '31 days') RETURNING id`, [mImg.id, Buffer.from([1, 2, 3, 4])])).rows[0].id;
        const img29 = (await pool.query(`INSERT INTO sms_images (message_id, content_type, name, size_bytes, data, created_at) VALUES ($1,'image/jpeg','new.jpg',4,$2, now() - interval '29 days') RETURNING id`, [mImg.id, Buffer.from([5, 6, 7, 8])])).rows[0].id;
        // 세기만(기본): purge_shipments 가 없으면 송장은 안 지우고 건수만 적는다 · 사진은 이때 비워진다(audit 1줄 = 사진)
        const a0 = audits.length;
        const retA = await sms.retentionRun();
        ok((await pool.query(`SELECT count(*)::int AS n FROM delivery_shipments WHERE tracking LIKE '9996000000%'`)).rows[0].n === 2 && (await pool.query(`SELECT count(*)::int AS n FROM delivery_status WHERE tracking LIKE '9996000000%'`)).rows[0].n === 2, '세기만: 송장·상태 줄 그대로');
        ok(retA && retA.shipments_target === 1 + real.ship_old && retA.shipments_deleted === 0 && retA.purge_shipments === false, '세기만: 대상 1 · 삭제 0 ' + JSON.stringify(retA));
        ok(cfgStore.sms_retention_last && cfgStore.sms_retention_last.shipments_target === retA.shipments_target, 'sms_retention_last 에 대상 건수 기록');
        ok(audits.length === a0 + 1 && audits[a0].changes && audits[a0].changes.after && audits[a0].changes.after.sms_images === 1 && audits[a0].changes.after.shipments_deleted === 0, '세기만: audit 1줄(사진 1 · 송장 삭제 0) ' + (audits.length - a0));
        // 실제 삭제: purge_shipments true
        cfgStore.sms_gateway = Object.assign({}, cfgStore.sms_gateway, { purge_shipments: true });
        const a0b = audits.length;
        const ret = await sms.retentionRun();
        ok(ret && ret.shipments_deleted === 1 && ret.status_deleted === 1 && ret.sms_images === 0, '삭제: 송장 1 · 상태 1 · 사진 0(이미 비움) ' + JSON.stringify(ret));
        const shipLeft = (await pool.query(`SELECT tracking FROM delivery_shipments WHERE tracking LIKE '9996000000%' ORDER BY 1`)).rows.map(r => r.tracking);
        const statLeft = (await pool.query(`SELECT tracking FROM delivery_status WHERE tracking LIKE '9996000000%' ORDER BY 1`)).rows.map(r => r.tracking);
        ok(shipLeft.length === 1 && shipLeft[0] === TR(59), '61일 송장만 삭제 · 59일 유지 ' + JSON.stringify(shipLeft));
        ok(statLeft.length === 1 && statLeft[0] === TR(59), '61일 상태 줄(handled_at 있음)도 삭제 · 59일 상태 유지 ' + JSON.stringify(statLeft));
        const myAudits = audits.slice(a0b);
        ok(myAudits.length === 1, 'audit 1줄 ' + myAudits.length);
        ok(myAudits[0] && myAudits[0].source === 'db_retention' && myAudits[0].changes && myAudits[0].changes.after && myAudits[0].changes.after.shipments_deleted === 1, 'audit 출처 db_retention · 건수 포함 ' + JSON.stringify(myAudits[0] || {}).slice(0, 200));
        ok(!JSON.stringify(myAudits[0] || {}).includes('09996001061') && !JSON.stringify(myAudits[0] || {}).includes('검증육일일'), 'audit 에 번호·이름 없음');
        console.log('   retentionRun 반환:', JSON.stringify(ret || null).slice(0, 200));

        console.log('② 보관 정리 — 사진 30일');
        const im = (await pool.query(`SELECT id, data IS NULL AS empty, purged_at FROM sms_images WHERE id = ANY($1) ORDER BY id`, [[img31, img29]])).rows;
        ok(im[0] && im[0].empty === true && im[0].purged_at, '31일 사진 data NULL + purged_at');
        ok(im[1] && im[1].empty === false && !im[1].purged_at, '29일 사진 그대로');
        // 꺼져 있으면 아무것도 안 지움
        await pool.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date - 62, '시험', '검증육이', '09996001062', 'verify610ops')`, [TR(62)]);
        cfgStore.db_retention = { enabled: 'true' };   // 글자 'true' = 꺼짐(#579 규칙: 불리언 true 일 때만)
        const a1 = audits.length; await sms.retentionRun();
        ok((await pool.query(`SELECT 1 FROM delivery_shipments WHERE tracking = $1`, [TR(62)])).rowCount === 1 && audits.length === a1, "db_retention.enabled 가 불리언 true 가 아니면 삭제 0 · audit 0");
        cfgStore.db_retention = { enabled: true };
        await pool.query(`DELETE FROM delivery_shipments WHERE tracking = $1`, [TR(62)]);
        cfgStore.sms_gateway = Object.assign({}, cfgStore.sms_gateway, { purge_shipments: false });

        console.log('③ 멈춘 글 쓸기(sweepStuck)');
        // (가) 받은 글 뒤 3분 · 상태 new · 보낸 줄 없음 → staff_needed   /  대조: 1분 전 글은 그대로
        const tA = await mkThread(P(11), 'new', { at: ago(3) }); await mkMsg(tA.id, { dir: 'in', sender: 'customer', state: 'received', body: '처리 중 죽은 글', at: ago(3) });
        const tA2 = await mkThread(P(12), 'new', { at: ago(1) }); await mkMsg(tA2.id, { dir: 'in', sender: 'customer', state: 'received', body: '방금 온 글', at: ago(1) });
        // (나) sending 3분 · sent_at 없음(202 를 못 받고 죽음) → queued 로   /  대조: sending 1분
        const tB = await mkThread(P(13), 'staff_replied'); const mB = await mkMsg(tB.id, { dir: 'out', sender: 'staff_desk', state: 'sending', gw: crypto.randomUUID(), send_after: ago(3), at: ago(3) });
        const mB2 = await mkMsg(tB.id, { dir: 'out', sender: 'staff_desk', state: 'sending', gw: crypto.randomUUID(), send_after: ago(1), at: ago(1) });
        // (다) sent_at 뒤 ttl(600초)+10분 넘은 sending → failed(no_result)   /  대조: sent_at 5분 전
        const tC = await mkThread(P(14), 'staff_replied'); const mC = await mkMsg(tC.id, { dir: 'out', sender: 'staff_desk', state: 'sending', gw: crypto.randomUUID(), send_after: ago(25), sent_at: ago(21), at: ago(25) });
        const mC2 = await mkMsg(tC.id, { dir: 'out', sender: 'staff_desk', state: 'sending', gw: crypto.randomUUID(), send_after: ago(6), sent_at: ago(5), at: ago(6) });
        const n0 = notes.length;
        const sw = await sms.sweepStuck();
        console.log('   sweepStuck 반환:', JSON.stringify(sw || null).slice(0, 200));
        ok((await thread(P(11))).status === 'staff_needed', '(가) 3분 된 new·무응답 → staff_needed ' + (await thread(P(11))).status);
        ok((await thread(P(12))).status === 'new', '(가) 1분 된 글은 그대로 new');
        ok(notes.length > n0 && !notes.slice(n0).some(x => (x.title + x.message).includes(P(11))), '(가) 직원 알림 1건 이상 · 전체 번호 없음');
        const st = async id => (await pool.query(`SELECT state, fail_reason, sent_at FROM sms_messages WHERE id = $1`, [id])).rows[0];
        ok((await st(mB.id)).state === 'queued', '(나) sent_at 없는 3분 sending → queued ' + (await st(mB.id)).state);
        ok((await st(mB2.id)).state === 'sending', '(나) 1분 sending 은 그대로');
        const sC = await st(mC.id);
        ok(sC.state === 'failed' && /no_result/.test(String(sC.fail_reason || '')), '(다) ttl+10분 넘은 sending → failed no_result ' + JSON.stringify(sC));
        ok((await st(mC2.id)).state === 'sending', '(다) sent_at 5분 전 sending 은 그대로');
        ok((await thread(P(14))).status === 'staff_needed', '(다) 결과 없는 발송 → 대화 staff_needed ' + (await thread(P(14))).status);
        await sms.sweepStuck();
        ok((await st(mB.id)).state === 'queued' && (await st(mC.id)).state === 'failed' && (await thread(P(11))).status === 'staff_needed', '두 번 돌려도 같은 결과(되풀이 안전)');
        // (라) record 모드에서는 「new」가 정상 종착 상태(봇이 답하지 않는 모드) → 쓸기가 직원 몫으로 바꾸면 평범한 글마다 알림이 간다
        sms.resetCfg(); cfgStore.sms_gateway = Object.assign({}, cfgStore.sms_gateway, { mode: 'record' });
        const tR = await mkThread(P(15), 'new', { at: ago(3) }); await mkMsg(tR.id, { dir: 'in', sender: 'customer', state: 'received', body: '기록 모드의 평범한 글', at: ago(3) });
        const n1 = notes.length; await sms.sweepStuck();
        ok((await thread(P(15))).status === 'new' && notes.length === n1, `(라) record 모드: 3분 된 new 는 그대로 · 알림 0 — 지금 ${(await thread(P(15))).status} · 알림 +${notes.length - n1}`);
        // (마) 인증번호·광고 갈래(ignored 가 되기 전 new 로 남은 경우)는 건드리지 않음
        sms.resetCfg(); cfgStore.sms_gateway = Object.assign({}, cfgStore.sms_gateway, { mode: 'auto' });
        const tO = await mkThread(P(16), 'new', { at: ago(3) }); await mkMsg(tO.id, { dir: 'in', sender: 'customer', state: 'received', body: '[Web발신] 인증번호', at: ago(3), bucket: 'otp' });
        await pool.query(`UPDATE sms_threads SET status = 'new' WHERE id = $1`, [tR.id]);   // (라)가 떨어졌어도 다음 항목에 영향 없게 되돌림
        await pool.query(`DELETE FROM sms_messages WHERE thread_id = $1`, [tR.id]); await pool.query(`DELETE FROM sms_threads WHERE id = $1`, [tR.id]);
        await sms.sweepStuck();
        ok((await thread(P(16))).status === 'new', '(마) otp 갈래 글만 있는 new 대화는 그대로');

        console.log('④ sendTick 동시 2회 → 게이트웨이 호출 1회');
        // ③(나)에서 queued 로 돌아온 줄 1개가 대기 중. 그 밖 sending 대조 줄은 큐 대상 아님.
        const s0 = sent.length;
        const [r1, r2] = await Promise.all([sms.sendTick(), sms.sendTick()]);
        await sleep(200);
        const mine = sent.slice(s0).filter(x => x.digits === P(13));
        ok(mine.length === 1, '동시 2회 → 발송 1회 ' + mine.length + ' ' + JSON.stringify([r1, r2]).slice(0, 160));
        const sB = await st(mB.id);
        ok(sB.state === 'sending' && sB.sent_at, '보낸 뒤 sending + sent_at');
        ok(mine[0] && mine[0].id && (await pool.query(`SELECT gateway_id FROM sms_messages WHERE id = $1`, [mB.id])).rows[0].gateway_id === mine[0].id, '되살린 줄은 같은 gateway_id 로 다시 보냄(409 로 중복 방지되는 길)');
        const s1 = sent.length; await sms.sendTick(); ok(sent.length === s1, '다음 틱엔 다시 안 보냄');

        console.log('⑤ 같은 봉투 재시도 → 1건');
        const e5 = env('sms:received', { messageId: 'ops-5', message: '재시도 시험', sender: '+82' + P(21).slice(1), receivedAt: new Date().toISOString() });
        await sms.handleWebhook(e5); await sms.handleWebhook(e5);
        await Promise.all([sms.handleWebhook(env('sms:received', { messageId: 'ops-5b', message: '동시 재시도', sender: '+82' + P(22).slice(1), receivedAt: new Date().toISOString() }, 'ops-env-5b')),
            sms.handleWebhook(env('sms:received', { messageId: 'ops-5b', message: '동시 재시도', sender: '+82' + P(22).slice(1), receivedAt: new Date().toISOString() }, 'ops-env-5b'))]);
        ok((await msgs(P(21))).filter(m => m.direction === 'in').length === 1, '순서대로 2번 → 받은 줄 1건 ' + (await msgs(P(21))).length);
        ok((await msgs(P(22))).filter(m => m.direction === 'in').length === 1, '동시에 2번 → 받은 줄 1건 ' + (await msgs(P(22))).length);
        ok((await msgs(P(22))).filter(m => m.direction === 'out').length <= 1, '동시 재시도에 답 줄도 1건 이하');

        console.log('⑥ mms:downloaded 가 mms:received 없이 먼저');
        const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64');
        await sms.handleWebhook(env('mms:downloaded', { messageId: '777', sender: '+82' + P(31).slice(1), body: null, subject: null, attachments: [{ partId: 1, contentType: 'image/jpeg', name: 'a.jpg', size: 22, data: jpg }], receivedAt: new Date().toISOString() }));
        let m6 = (await msgs(P(31))).filter(m => m.direction === 'in');
        ok(m6.length === 1 && m6[0].kind === 'mms', '새 수신 1건(mms) ' + m6.length);
        ok(m6[0] && (await pool.query(`SELECT count(*)::int AS n FROM sms_images WHERE message_id = $1 AND data IS NOT NULL`, [m6[0].id])).rows[0].n === 1, '사진 1장 저장');
        ok((await thread(P(31))).has_image === true, '대화 has_image');
        // 뒤늦게 mms:received(메타)가 와도 「사진 받는 중」 줄이 따로 생겨 5분 뒤 「사진 못 받음」 알림이 가면 안 된다
        await sms.handleWebhook(env('mms:received', { messageId: 'T777', transactionId: 'T777', sender: '+82' + P(31).slice(1), size: 22, receivedAt: new Date().toISOString() }));
        m6 = (await msgs(P(31))).filter(m => m.direction === 'in');
        const pend = m6.filter(m => m.bucket === 'photo_pending').length;
        ok(pend === 0, `뒤늦은 mms:received 가 「사진 받는 중」 줄을 남기지 않음(남으면 5분 뒤 거짓 「사진 못 받음」) — 받은 줄 ${m6.length} · 대기 ${pend}`);

        console.log('⑦ 켠 직후 · ping 한 번도 없음 → 끊김 알림 안 감');
        sms.resetCfg(); cfgStore.sms_gateway = Object.assign({}, cfgStore.sms_gateway, { enabled: true, enabled_at: new Date().toISOString() });
        cfgStore.sms_gateway_state = {};
        const g0 = tg.length; await sms.watchTick();
        ok(tg.length === g0, '신호 기록이 아예 없는 켠 직후 → 텔레그램 0 ' + JSON.stringify(tg.slice(g0)));
        ok(!(cfgStore.sms_gateway_state && cfgStore.sms_gateway_state.alerted === true), 'alerted 표시도 안 켜짐');
        // 대조: ping 이 있었고 5시간 조용 → 알림 1회(종전 동작 유지)
        cfgStore.sms_gateway_state = { last_ping_at: new Date(Date.now() - 5 * 3600e3).toISOString() };
        await sms.watchTick(); ok(tg.length === g0 + 1, '대조: ping 있었고 5시간 조용 → 알림 1회 ' + (tg.length - g0));
    } finally {
        await cleanup();
        const left = (await pool.query(`SELECT (SELECT count(*)::int FROM sms_threads WHERE phone_digits LIKE $1) + (SELECT count(*)::int FROM delivery_shipments WHERE tracking LIKE '9996000000%') + (SELECT count(*)::int FROM delivery_status WHERE tracking LIKE '9996000000%') AS n`, [T + '%'])).rows[0].n;
        ok(left === 0, '시험 줄 정리 0 ' + left);
        if (typeof sms.stop === 'function') { try { sms.stop(); } catch (_) { } }
        await pool.end();
    }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e); try { await cleanup(); await pool.end(); } catch (_) { } process.exit(1); });

// #658 검증 — 문의 대화 창(톡톡 · 상품문의 · 주문문의) 서버 계약
//   실행: node scripts/verify-658-inbox.js   (포트 PORT658 · 없으면 3463)
//   · 모듈만 따로 장착(server.js 를 띄우지 않음) · 네이버·톡톡 호출 0(등록 함수·배달부·AI 는 가짜)
//   · 🔴 라이브 표(message_logs · naver_qnas · naver_inquiries · talk_outbox)에 시험 줄을 넣지 않는다 — 같은 꼴의 시험용 표(verify658_*)를 만들어 쓰고 끝에 지운다
//     (라이브 「확인 필요 문의」 칸·알림·아침 정리에 시험 글이 뜨지 않게 — #638·#648 교훈)
const path = require('path'); const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express'); const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT658) || 3463, BASE = 'http://127.0.0.1:' + PORT;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TB = { logs: 'verify658_logs', qnas: 'verify658_qnas', inquiries: 'verify658_inquiries', outbox: 'verify658_outbox', drafts: 'verify658_drafts', reads: 'verify658_reads' };
const SRC = { logs: 'message_logs', qnas: 'naver_qnas', inquiries: 'naver_inquiries', outbox: 'talk_outbox' };
async function dropAll() { for (const t of Object.values(TB)) await pool.query(`DROP TABLE IF EXISTS ${t}`); for (const k of ['logs', 'outbox']) await pool.query(`DROP SEQUENCE IF EXISTS ${TB[k]}_seq`); await pool.query(`DELETE FROM agent_office_config WHERE key IN ('inbox_threads_verify', 'inbox_threads_verify_state')`); }
async function api(method, url, body, user) {
    const h = { Connection: 'close' }; if (user !== null) h['x-test-user'] = encodeURIComponent(JSON.stringify(user || { id: 990658, name: '시험육오팔', role: 'user' })); if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
    const live0 = (await pool.query(`SELECT (SELECT count(*) FROM message_logs)::int a, (SELECT count(*) FROM naver_qnas)::int b, (SELECT count(*) FROM naver_inquiries)::int c, (SELECT count(*) FROM talk_outbox)::int d`)).rows[0];
    await dropAll();
    for (const k of Object.keys(SRC)) await pool.query(`CREATE TABLE ${TB[k]} (LIKE ${SRC[k]} INCLUDING DEFAULTS)`);
    for (const k of ['logs', 'outbox']) { await pool.query(`CREATE SEQUENCE ${TB[k]}_seq START 1`); await pool.query(`ALTER TABLE ${TB[k]} ALTER COLUMN id SET DEFAULT nextval('${TB[k]}_seq')`); }   // 라이브 순번을 쓰지 않게

    // ── 가짜: 로그인 · 등록 함수 · AI · 배달부 ──
    const posts = [], gens = [], audits = []; let postDelay = 0, postFail = null, genAnswer = { answer: '시험 초안입니다.' }, deliverMode = 'sent';
    // 실제 개인정보 검사(server.js 에서 그 함수만 떼어 실행 — 전화번호 검사 제외가 실코드에서 되는지)
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
    const piiSrc = src.slice(src.indexOf('const QNA_PII_WHITELIST'), src.indexOf('\n}', src.indexOf('function qnaPiiCheck(text, opts)')) + 2);
    const qnaPiiCheck = new Function(piiSrc + '\nreturn qnaPiiCheck;')();
    const mkPost = (table, idcol, kind) => async (id, text, actor, opts) => {
        posts.push({ kind, id: String(id), text, by: actor && actor.name, opts: opts || null });
        if (postDelay) await sleep(postDelay);
        if (postFail) throw postFail;
        const pii = qnaPiiCheck(text, kind === 'inquiry' ? opts : undefined); if (!pii.ok) throw { status: 403, message: pii.reason };
        const cur = (await pool.query(`SELECT answered, posted_at FROM ${table} WHERE ${idcol}::text = $1`, [String(id)])).rows[0];
        if (cur.answered || cur.posted_at) throw { status: 409, message: '이미 답변된 문의입니다 — 수정은 판매자센터에서 해주세요' };
        await pool.query(`UPDATE ${table} SET answered = true, posted_at = NOW(), posted_by = $2, ai_draft = $3 WHERE ${idcol}::text = $1`, [String(id), actor.name, text]);
    };
    const app = express(); app.use(express.json());
    const authMiddleware = (req, res, next) => { const h = req.headers['x-test-user']; if (!h) return res.status(401).json({ error: '로그인이 필요합니다' }); req.user = JSON.parse(decodeURIComponent(h)); next(); };
    const mod = require(path.join(ROOT, 'inbox-threads.js'))(app, { pool, authMiddleware, writeAudit: async a => { audits.push(a); }, testMode: true, tables: TB, salt: 'verify658', talkWaitMs: 2500,
        postQna: mkPost(TB.qnas, 'question_id', 'qna'), postInquiry: mkPost(TB.inquiries, 'inquiry_id', 'inquiry'), generate: async (q, p) => { gens.push({ q, p }); return genAnswer; },
        kick: async () => { if (deliverMode === 'none') return; await sleep(150); const r = (await pool.query(`SELECT id, user_id, body FROM ${TB.outbox} WHERE status = 'queued' ORDER BY id LIMIT 1`)).rows[0]; if (!r) return;
            if (deliverMode === 'sent') { await pool.query(`UPDATE ${TB.outbox} SET status = 'sent', sent_at = NOW() WHERE id = $1`, [r.id]); await pool.query(`UPDATE ${TB.logs} SET staff_response = CASE WHEN COALESCE(staff_response, '') = '' THEN $2 ELSE staff_response || ' | ' || $2 END WHERE id = (SELECT id FROM ${TB.logs} WHERE user_id = $1 ORDER BY received_at DESC, id DESC LIMIT 1)`, [r.user_id, '[에이전트오피스·시험육오팔] ' + r.body]); }
            else await pool.query(`UPDATE ${TB.outbox} SET status = 'failed', error = '네이버 톡톡이 받지 않았습니다: 시험' WHERE id = $1`, [r.id]); } });
    const server = app.listen(PORT); await sleep(300);
    try {
        // ── 시험 줄(시험용 표에만) ──
        const U = { a: 'vt658userAAAA', b: 'vt658userBBBB', k: 'kakao:vt658K', m: 'mall:vt658M', old: 'vt658userOLD', ad: 'vt658userAD' };
        const lg = (uid, msg, o = {}) => pool.query(`INSERT INTO ${TB.logs} (user_id, item, message, answered, bot_response, staff_response, received_at, reviewed_at, image_url) VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' minutes')::interval, ${o.reviewed ? 'NOW()' : 'NULL'}, $8) RETURNING id`,
            [uid, o.item || '기타', msg, !!o.bot, o.bot || o.mark || null, o.staff || null, String(o.ago || 0), o.img || null]).then(r => r.rows[0].id);
        await lg(U.a, '귤 언제 발송되나요', { ago: 300, bot: '오늘 발송됩니다.', reviewed: true, item: '하우스감귤' });
        await lg(U.a, '그럼 내일 받을 수 있나요', { ago: 200, mark: '[쿨다운-무응답]', item: '하우스감귤' });
        await lg(U.a, '[이미지 전송]', { ago: 190, mark: '[이미지-무응답]', img: 'https://example.invalid/p.jpg', item: '하우스감귤' });
        const aLast = await lg(U.a, '보관은 어떻게 해요', { ago: 10, mark: '[SKIP-무응답]', item: '하우스감귤' });
        await lg(U.b, '배송지 바꿀 수 있나요', { ago: 50, bot: '확인 후 도와드리겠습니다.', staff: '변경해 드렸습니다 | [에이전트오피스·조가영] 내일 출발합니다' });
        await lg(U.k, '카카오 문의입니다', { ago: 40, bot: '안내드립니다.' });
        await lg(U.m, '자사몰 문의입니다', { ago: 30, bot: '안내드립니다.' });
        await lg(U.old, '열흘 전 문의', { ago: 60 * 24 * 10, mark: '[SKIP-무응답]' });
        await lg(U.ad, '상위 노출 마케팅 제안드립니다 http://x.invalid', { ago: 5, mark: '[SKIP-무응답]' });
        await lg('vt658userAI5', '닷새 전 봇이 답한 글', { ago: 60 * 24 * 5, bot: '답했습니다.' });
        await lg('vt658userGONE', '40일 전 글', { ago: 60 * 24 * 40, mark: '[SKIP-무응답]' });
        const qn = (id, o = {}) => pool.query(`INSERT INTO ${TB.qnas} (question_id, raw, answered, ai_status, ai_draft, posted_at, posted_by, post_error, collected_at) VALUES ($1, $2, $3, $4, $5, ${o.posted ? 'NOW()' : 'NULL'}, $6, $7, NOW() - ($8 || ' minutes')::interval)`,
            [id, JSON.stringify({ product_name: '시험 하우스감귤 3kg', question: o.q || '당도가 어떤가요', answer: o.answer || '', create_date: new Date(Date.now() - (o.ago || 0) * 60000).toISOString(), masked_writer_id: 'ab***' }), !!o.answered, o.status || null, o.draft || null, o.by || null, o.err || null, String(o.ago || 0)]);
        await qn(990658001, { status: 'draft', draft: '초안: 당도 좋습니다.', err: '개인정보 의심(시험)', ago: 20 });
        await qn(990658002, { status: 'skip', ago: 30 });
        await qn(990658003, { status: 'posted', answered: true, posted: true, by: 'auto', draft: '자동 답입니다.', answer: '자동 답입니다.', ago: 40 });
        await qn(990658004, { answered: true, answer: '센터에서 단 답', ago: 50 });
        await qn(990658007, { status: 'posted', answered: true, posted: true, by: 'auto', answer: '닷새 전 자동 답', ago: 60 * 24 * 5 }); await qn(990658008, { status: 'skip', ago: 60 * 24 * 5 });
        await qn(990658005, { status: 'skip', ago: 15 }); await qn(990658006, { status: 'skip', ago: 14 });
        const iq = (id, o = {}) => pool.query(`INSERT INTO ${TB.inquiries} (inquiry_id, raw, answered, ai_status, ai_draft, posted_at, posted_by, collected_at) VALUES ($1, $2, $3, $4, $5, NULL, NULL, NOW() - ($6 || ' minutes')::interval)`,
            [String(id), JSON.stringify({ product_name: '시험 황금향 3kg', product_option: '선물용 3kg', category: o.cat || '배송', title: '문의드립니다', content: o.q || '언제 오나요', registered_at: new Date(Date.now() - (o.ago || 0) * 60000).toISOString(), answer_content: '', answered: false }), false, o.status || null, o.draft || null, String(o.ago || 0)]);
        await iq(990658101, { status: 'claim', cat: '반품', ago: 25 }); await iq(990658102, { status: 'draft', draft: '주문문의 초안', ago: 35 }); await iq(990658103, { status: 'skip', ago: 45 });
        const kA = mod.keyOf(U.a), kB = mod.keyOf(U.b), kK = mod.keyOf(U.k), kM = mod.keyOf(U.m), kOld = mod.keyOf(U.old), kAd = mod.keyOf(U.ad);

        console.log('① 권한 · 채널');
        let r = await api('GET', '/api/inbox/threads?ch=talk', null, null);
        ok(r.status === 401, '로그인 없이 = 401');
        r = await api('GET', '/api/inbox/threads?ch=sms'); ok(r.status === 400 && /talk/.test(r.json.error), '없는 채널 = 400 + 한국어 사유');
        r = await api('GET', '/api/inbox/threads?ch=talk', null, { id: 990659, name: '일반직원', role: 'user' }); ok(r.status === 200 && r.json.ok === true, '일반 직원(user)도 읽음(전 계정)');

        console.log('② 톡톡 목록');
        r = await api('GET', '/api/inbox/threads?ch=talk'); let L = r.json.threads; const tA = L.find(x => x.id === kA);
        ok(r.status === 200 && L.length === 4 && !!tA && tA.unread === 3 && tA.state === 'open' && tA.last_text === '보관은 어떻게 해요' && tA.last_dir === 'in' && tA.why === '봇이 넘긴 글' && tA.sub === '하우스감귤' && /^톡톡 손님 [0-9a-f]{4}$/.test(tA.title) && tA.can_send === true && tA.has_draft === false,
            'active = 안 읽은 대화만(광고·읽은 대화 제외) · 안 읽음 3(읽은 줄 뒤 손님 글) · 마지막 글·사유 · 제목은 가린 열쇠 끝 4자 ' + JSON.stringify(L.map(x => [x.sub_ch, x.unread, x.state])));
        ok(!JSON.stringify(r.json).includes('vt658user') && !JSON.stringify(r.json).includes('vt658K'), '손님 식별값(user_id)은 응답에 없음');
        ok(L.find(x => x.id === kK).sub_ch === 'kakao' && L.find(x => x.id === kK).can_send === false && L.find(x => x.id === kM).sub_ch === 'mall' && L.find(x => x.id === kOld).can_send === false && !L.find(x => x.id === kAd) && !L.find(x => x.id === kB),
            '카카오·자사몰·7일 넘은 대화 = can_send false · 업체 제안 글·직원이 이미 답한 대화는 active 에 없음');
        ok(L[0].last_at >= L[1].last_at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(L[0].last_at) && Math.abs(Date.now() - Date.parse(tA.last_at) - 600000) < 120000, '최신순 · 시각은 UTC 글자(Z) — 10분 전 글이 10분 전으로 읽힘');
        r = await api('GET', '/api/inbox/threads?ch=talk&scope=all'); const allN = r.json.threads.length;
        ok(allN === 7 && r.json.threads.find(x => x.id === mod.keyOf('vt658userAI5')).unread === 0 && r.json.threads.find(x => x.id === kAd).unread === 0 && r.json.threads.find(x => x.id === kB).state === 'staff' && r.json.threads.find(x => x.id === kB).last_text === '내일 출발합니다' && r.json.threads.find(x => x.id === kB).last_dir === 'out' && r.json.days === 30,
            'all = 30일 안 7대화(40일 전은 빠짐 · 닷새 전 봇 답은 안 읽음 0 — active 에 없음) · 직원 답한 대화 state staff · 마지막 글 = 마지막 직원 답 ' + allN);
        r = await api('GET', '/api/inbox/threads?ch=talk&scope=all&q=' + encodeURIComponent('배송지')); const q1 = r.json.threads.map(x => x.id);
        r = await api('GET', '/api/inbox/threads?ch=talk&scope=all&q=' + encodeURIComponent('100%')); const q2 = r.json.threads.length;
        r = await api('GET', '/api/inbox/threads?ch=talk&scope=all&q=' + kA.slice(-4)); const q3 = r.json.threads.map(x => x.id);
        ok(q1.length === 1 && q1[0] === kB && q2 === 0 && q3.includes(kA), '찾기: 글 · 가린 열쇠 끝자리 · 「%」는 글자로만');
        ok(r.json.counts.talk.unread === 4 && r.json.counts.talk.open === 2 && r.json.counts.qna.unread === 6 && r.json.counts.qna.open === 5 && r.json.counts.inquiry.unread === 3, '탭 숫자 counts(톡톡 4 · 상품문의 6(자동 답 1 포함) · 주문문의 3) ' + JSON.stringify(r.json.counts));

        r = await api('GET', '/api/inbox/threads?ch=talk&scope=open'); const op0 = r.json.threads.map(x => x.id).sort().join();
        ok(r.json.scope === 'open' && op0 === [kA, kOld].sort().join() && r.json.threads.every(x => x.needs_reply === true) && (await api('GET', '/api/inbox/threads?ch=talk&scope=all')).json.threads.find(x => x.id === kB).needs_reply === false,
            'scope=open = 답이 필요한데 아직 아무도 안 답한 대화(업체 제안·봇/직원이 답한 대화 제외) · needs_reply 칸');
        console.log('③ 톡톡 대화 · 열면 읽음');
        r = await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`); let M = r.json.messages;
        ok(r.status === 200 && M.length === 5 && M[0].direction === 'in' && M[1].sender === 'bot' && M[1].body === '오늘 발송됩니다.' && M[2].note === '봇이 답한 뒤 30분 안에 다시 온 글' && M[3].body === '' && M[3].image_url === 'https://example.invalid/p.jpg' && M[4].body === '보관은 어떻게 해요'
            && r.json.thread.unread === 3 && r.json.can_send === true && r.json.draft === null && r.json.can_draft === true && r.json.limits.max_chars === 1000 && r.json.limits.confirm === false,
            '대화 = 손님 글 · 봇 답 · 사진(주소) · 봇이 안 답한 사유(note) 순서대로 · peek=1 은 읽음 처리 안 함 ' + M.length);
        ok((await api('GET', '/api/inbox/threads?ch=talk')).json.threads.find(x => x.id === kA).unread === 3, 'peek 뒤에도 안 읽음 3 그대로');
        r = await api('GET', `/api/inbox/threads/talk/${kB}?peek=1`); M = r.json.messages;
        ok(M.length === 4 && M[2].sender === 'staff' && M[2].via === 'center' && M[2].body === '변경해 드렸습니다' && M[3].via === 'office' && M[3].by === '조가영' && M[3].body === '내일 출발합니다', '직원 답 여러 통(「 | 」)을 나눔 · 센터에서 친 답/에이전트 오피스에서 보낸 답(이름) 구분');
        r = await api('GET', `/api/inbox/threads/talk/${kK}?peek=1`); ok(r.json.can_send === false && /카카오/.test(r.json.cannot_why) && r.json.can_draft === false, '카카오 대화 = 볼 수만 있음(can_send false + 사유)');
        r = await api('GET', `/api/inbox/threads/talk/${kOld}?peek=1`); ok(r.json.can_send === false && /7일/.test(r.json.cannot_why), '7일 넘은 대화 = 사유 「7일」');
        r = await api('GET', `/api/inbox/threads/talk/${kA}`);
        const revd = (await pool.query(`SELECT count(*) FILTER (WHERE reviewed_at IS NULL)::int n, max(reviewed_by) b FROM ${TB.logs} WHERE user_id = $1`, [U.a])).rows[0];
        const rdA = (await pool.query(`SELECT read_by, forced_unread FROM ${TB.reads} WHERE ch = 'talk' AND tkey = $1`, [kA])).rows[0];
        ok(r.json.thread.unread === 0 && !(await api('GET', '/api/inbox/threads?ch=talk')).json.threads.find(x => x.id === kA) && !!rdA && rdA.read_by === '시험육오팔' && rdA.forced_unread === false, '열면 읽음(이 창의 표식 inbox_thread_reads · 이름) → active 목록에서 빠짐');
        ok(revd.n === 3 && revd.b === null, '🔴 열기만 해서는 reviewed_at 을 안 찍음(「확인 필요 문의」 칸·아침 정리에서 사라지지 않음) — 안 찍힌 줄 ' + revd.n);
        r = await api('GET', '/api/inbox/threads?ch=talk&scope=open'); const cO = (await api('GET', '/api/inbox/counts')).json.counts.talk;
        ok(!!r.json.threads.find(x => x.id === kA) && cO.open === 2 && cO.unread === 3, '읽은 뒤에도 「답 안 한 것」(scope=open · counts.open 2)에는 남음 · 안 읽음 수만 줄어듦(4 → 3) ' + JSON.stringify(cO));
        r = await api('POST', `/api/inbox/threads/talk/${kA}/unread`);
        const un = (await api('GET', '/api/inbox/threads?ch=talk')).json.threads.find(x => x.id === kA);
        ok(r.status === 200 && !!un && un.unread === 1 && (await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`)).json.thread.unread === 1, '안 읽음으로 되돌리기 → 안 읽음 1(목록·대화)');
        r = await api('GET', '/api/inbox/threads/talk/0000000000000000'); ok(r.status === 404, '없는 열쇠 = 404');
        r = await api('GET', `/api/inbox/threads/talk/${encodeURIComponent("x' OR 1=1 --")}`); ok(r.status === 404, '이상한 열쇠 = 404(조회문에 안 섞임)');

        console.log('④ 톡톡 보내기');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '   ' }); ok(r.status === 400, '빈 글 = 400');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '계좌로 입금해 주세요' }); ok(r.status === 400 && /결제 낱말/.test(r.json.error), '결제 낱말 = 400 + 사유(보낼 글 표에 안 들어감)');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: 'ㄱ'.repeat(1001) }); ok(r.status === 400 && /1,000자/.test(r.json.error), '1,000자 넘음 = 400');
        r = await api('POST', `/api/inbox/threads/talk/${kK}/send`, { text: '안녕하세요' }); const r2 = await api('POST', `/api/inbox/threads/talk/${kM}/send`, { text: '안녕하세요' }); const r3 = await api('POST', `/api/inbox/threads/talk/${kOld}/send`, { text: '안녕하세요' });
        ok(r.status === 400 && r2.status === 400 && r3.status === 400 && (await pool.query(`SELECT count(*)::int n FROM ${TB.outbox}`)).rows[0].n === 0, '카카오·자사몰·7일 넘은 대화 = 400 · 여기까지 보낼 글 0');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '서늘한 곳에 보관해 주세요.' });
        let ob = (await pool.query(`SELECT * FROM ${TB.outbox} ORDER BY id`)).rows;
        ok(r.status === 200 && r.json.ok === true && r.json.state === 'staff' && ob.length === 1 && ob[0].status === 'sent' && ob[0].user_id === U.a && ob[0].log_id === aLast && ob[0].requested_by === '시험육오팔' && ob[0].body === '서늘한 곳에 보관해 주세요.',
            '보내기 = 보낼 글 표에 넣고 배달 결과(sent)를 기다려 응답 · 마지막 줄(log_id)·이름 기록');
        r = await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`); M = r.json.messages;
        ok(M[M.length - 1].sender === 'staff' && M[M.length - 1].by === '시험육오팔' && M[M.length - 1].body === '서늘한 곳에 보관해 주세요.' && r.json.thread.state === 'staff' && r.json.thread.unread === 0, '보낸 글이 대화 끝에 직원 답으로 · 읽음 처리');
        const revA = (await pool.query(`SELECT count(*) FILTER (WHERE reviewed_at IS NULL)::int n, max(reviewed_by) b FROM ${TB.logs} WHERE user_id = $1`, [U.a])).rows[0];
        ok(revA.n === 0 && revA.b === '시험육오팔', '이 창에서 답을 보내 성공하면 그때 reviewed_at 도 찍힘(다른 화면에서도 빠짐)');
        ok(audits.length === 1 && audits[0].source === 'inbox_threads' && audits[0].changes.after.ch === 'talk' && audits[0].changes.after.length === 15 && !JSON.stringify(audits[0]).includes('서늘한') && !JSON.stringify(audits[0]).includes('vt658'), 'audit 1건(채널·가린 열쇠·글자 수 · 글 내용·식별값 없음)');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '서늘한 곳에 보관해 주세요.' });
        ok(r.status === 409 && r.json.code === 'duplicate' && (await pool.query(`SELECT count(*)::int n FROM ${TB.outbox}`)).rows[0].n === 1, '같은 글을 1분 안에 또 = 409(두 번 안 나감)');
        const both = await Promise.all([api('POST', `/api/inbox/threads/talk/${kB}/send`, { text: '동시에 누른 글' }), api('POST', `/api/inbox/threads/talk/${kB}/send`, { text: '동시에 누른 글' }, { id: 990660, name: '다른직원', role: 'user' })]);
        ok(both.map(x => x.status).sort().join() === '200,409' && (await pool.query(`SELECT count(*)::int n FROM ${TB.outbox} WHERE user_id = $1`, [U.b])).rows[0].n === 1, '둘이 같은 순간 같은 글 = 한 번만 ' + both.map(x => x.status).join());
        await pool.query(`INSERT INTO ${TB.outbox} (log_id, user_id, body, requested_by, status, created_at) VALUES ($1, $2, '끊긴 요청의 글', '시험', 'sending', NOW() - interval '5 minutes')`, [aLast, U.a]);
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '끊긴 요청의 글' });
        await pool.query(`UPDATE ${TB.outbox} SET created_at = NOW() - interval '11 minutes', status = 'failed' WHERE body = '끊긴 요청의 글'`);
        ok(r.status === 409 && r.json.code === 'duplicate' && (await pool.query(`SELECT count(*)::int n FROM ${TB.outbox} WHERE body = '끊긴 요청의 글'`)).rows[0].n === 1, '아직 가는 중인 같은 글(5분 전 · 요청이 끊긴 뒤 다시 누름) = 409(10분까지 · 두 번 안 나감)');
        deliverMode = 'failed'; r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '실패할 글' });
        ok(r.status === 502 && r.json.code === 'send_failed' && /시험/.test(r.json.error), '톡톡봇이 거절 = 502 + 그 사유 글');
        deliverMode = 'none'; r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '아무도 안 가져가는 글' });
        ob = (await pool.query(`SELECT status, error FROM ${TB.outbox} WHERE body = '아무도 안 가져가는 글'`)).rows[0];
        ok(r.status === 504 && r.json.code === 'timeout_cancelled' && ob.status === 'failed' && /취소/.test(ob.error), '배달부가 안 가져감 = 기다린 뒤 취소(504) · 줄은 failed 로 닫힘(뒤늦게 나가지 않음)');
        deliverMode = 'sent';

        console.log('⑤ 톡톡 초안 만들기(버튼)');
        await lg(U.a, '냉장 보관인가요', { ago: 1, mark: '[쿨다운-무응답]' }); const lastA2 = await lg(U.a, '며칠 가나요', { ago: 0, mark: '[쿨다운-무응답]' });
        ok(gens.length === 0, '여기까지 AI 호출 0(목록·대화·보내기는 AI 를 부르지 않음)');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/draft`);
        ok(r.status === 200 && r.json.ok === true && r.json.draft === '시험 초안입니다.' && gens.length === 1 && gens[0].q === '냉장 보관인가요\n며칠 가나요' && r.json.used_today === 1 && r.json.cap === 50, '초안 = AI 1회 · 재료는 마지막 직원 답 뒤 손님 글만 ' + JSON.stringify(gens[0] && gens[0].q));
        r = await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`); ok(r.json.draft === '시험 초안입니다.' && (await api('GET', '/api/inbox/threads?ch=talk&scope=all')).json.threads.find(x => x.id === kA).has_draft === true, '대화 응답 draft · 목록 has_draft');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '고친 글', seen: '옛 초안' });
        ok(r.status === 409 && r.json.code === 'draft_changed' && r.json.draft === '시험 초안입니다.', '화면이 본 초안(seen)이 서버 초안과 다르면 409 + 지금 초안');
        r = await api('POST', `/api/inbox/threads/talk/${kK}/send`, { text: '카카오로', seen: '아무 초안' }); ok(r.status === 400 && /카카오/.test(r.json.error), '보낼 수 없는 대화 판정이 seen 대조보다 먼저(400 사유 · 409 아님)');
        r = await api('POST', `/api/inbox/threads/qna/990658001/draft`); ok(r.status === 400, '상품문의에는 초안 만들기 없음(400)');
        r = await api('POST', `/api/inbox/threads/talk/${kK}/draft`); ok(r.status === 400 && gens.length === 1, '카카오 대화 초안 = 400(AI 호출 0)');
        genAnswer = null; r = await api('POST', `/api/inbox/threads/talk/${kA}/draft`); ok(r.status === 200 && r.json.ok === false && r.json.code === 'no_draft' && (await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`)).json.draft === '시험 초안입니다.', 'AI 가 넘긴 글 = ok false + 안내 · 앞 초안 그대로');
        genAnswer = { answer: '시험 초안입니다.' };
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('inbox_threads_verify', '{"draft_daily_cap":2}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
        r = await api('POST', `/api/inbox/threads/talk/${kA}/draft`); const gN = gens.length;
        ok(r.status === 429 && r.json.code === 'draft_cap' && gN === 2, '하루 상한(설정 2) 넘으면 429 · AI 호출 안 함 ' + gN);
        await lg(U.a, '새 글이 왔어요', { ago: 0, mark: '[쿨다운-무응답]' }); await sleep(50);
        r = await api('GET', `/api/inbox/threads/talk/${kA}?peek=1`); ok(r.json.draft === null, '손님이 새 글을 보내면 옛 초안은 안 보임');
        r = await api('POST', `/api/inbox/threads/talk/${kA}/send`, { text: '초안 없이 보내는 글', seen: '' }); ok(r.status === 200 && (await pool.query(`SELECT count(*)::int n FROM ${TB.drafts}`)).rows[0].n === 0, 'seen 빈 글 + 초안 없음 = 통과 · 보낸 뒤 초안 줄 지움');
        void lastA2;

        console.log('⑥ 상품문의');
        r = await api('GET', '/api/inbox/threads?ch=qna'); L = r.json.threads;
        const q1t = L.find(x => x.id === '990658001'), q3t = L.find(x => x.id === '990658003');
        ok(L.length === 6 && !L.find(x => x.id === '990658007') && !!L.find(x => x.id === '990658008') && q1t.state === 'open' && q1t.has_draft === true && q1t.why === '자동 등록 실패' && q1t.title === '시험 하우스감귤 3kg' && q1t.can_send === true && q3t.state === 'ai' && q3t.unread === 1 && q3t.can_send === false && !L.find(x => x.id === '990658004') && L.find(x => x.id === '990658002').why === '봇이 넘긴 글',
            'active = 안 답한 것(14일) + 자동 답(3일 · 안 읽음) · 닷새 전 자동 답·센터에서 사람이 답한 건 빠짐 · 초안·사유 ' + JSON.stringify(L.map(x => [x.id.slice(-1), x.state, x.unread])));
        r = await api('GET', '/api/inbox/threads?ch=qna&scope=all'); ok(r.json.threads.length === 8 && r.json.threads.find(x => x.id === '990658004').state === 'done', 'all = 사람이 답한 건 포함(state done)');
        r = await api('GET', '/api/inbox/threads/qna/990658001?peek=1');
        ok(r.json.messages.length === 1 && r.json.messages[0].body === '당도가 어떤가요' && r.json.draft === '초안: 당도 좋습니다.' && r.json.can_send === true && r.json.limits.max_chars === 2000 && r.json.limits.public === true && r.json.limits.confirm === false && /개인정보/.test(r.json.post_error) && r.json.can_draft === false, '대화 = 질문 1 · 초안(ai_draft) · 공개 게시판 표시 · 자동 등록 실패 사유');
        r = await api('GET', '/api/inbox/threads/qna/990658003'); ok(r.json.messages.length === 2 && r.json.messages[1].sender === 'bot' && r.json.can_send === false && /스마트스토어 센터/.test(r.json.cannot_why) && r.json.thread.unread === 0 && !(await api('GET', '/api/inbox/threads?ch=qna')).json.threads.find(x => x.id === '990658003'), '자동 답한 건 = 질문 + 봇 답 · 보내기 막힘 · 열면 읽음');
        r = await api('POST', '/api/inbox/threads/qna/990658003/send', { text: '또 답', seen: '틀린 초안' }); ok(r.status === 409 && r.json.code === 'already', '이미 답한 건 판정이 seen 대조보다 먼저(already)');
        r = await api('POST', '/api/inbox/threads/qna/990658003/send', { text: '또 답' }); ok(r.status === 409 && r.json.code === 'already' && /스마트스토어 센터/.test(r.json.error) && posts.length === 0, '이미 답한 건 = 409 「수정은 스마트스토어 센터에서」 · 등록 함수 호출 0');
        r = await api('POST', '/api/inbox/threads/qna/990658002/send', { text: '문의는 010-1234-5678 로 주세요' });
        ok(r.status === 403 && r.json.code === 'pii' && /전화번호/.test(r.json.error) && (await pool.query(`SELECT answered, posting_at FROM ${TB.qnas} WHERE question_id = 990658002`)).rows[0].posting_at === null, '상품문의(공개) 전화번호 = 403 그대로 · 집기 풀림(다시 보낼 수 있음)');
        r = await api('POST', '/api/inbox/threads/qna/990658002/send', { text: 'ㄱ'.repeat(2001) }); ok(r.status === 400, '2,000자 넘음 = 400');
        r = await api('POST', '/api/inbox/threads/qna/990658001/send', { text: '당도 12브릭스 이상입니다.', seen: '다른 초안' }); ok(r.status === 409 && r.json.code === 'draft_changed', '상품문의도 seen 대조(409)');
        const pN = posts.length; r = await api('POST', '/api/inbox/threads/qna/990658001/send', { text: '당도 좋습니다.', seen: '초안: 당도 좋습니다.' });
        const qrow = (await pool.query(`SELECT answered, posted_by, posting_at, reviewed_at FROM ${TB.qnas} WHERE question_id = 990658001`)).rows[0];
        ok(r.status === 200 && r.json.state === 'done' && posts.length === pN + 1 && posts[pN].kind === 'qna' && posts[pN].id === '990658001' && posts[pN].opts === null && posts[pN].by === '시험육오팔' && qrow.answered === true && qrow.posting_at === null && !!qrow.reviewed_at,
            '보내기 = 등록 함수 1회(확인 단계 없음 · 상품문의는 검사 그대로) · 집기 풀림 · 읽음');
        postDelay = 600; const pN2 = posts.length;
        const two = await Promise.all([api('POST', '/api/inbox/threads/qna/990658005/send', { text: '동시 답 하나' }), api('POST', '/api/inbox/threads/qna/990658005/send', { text: '동시 답 둘' }, { id: 990660, name: '다른직원', role: 'user' })]);
        ok(two.map(x => x.status).sort().join() === '200,409' && posts.length === pN2 + 1 && two.find(x => x.status === 409).json.code === 'busy', '둘이 같은 순간 눌러도 등록 함수는 한 번(집기) · 진 쪽 = 409 「등록하는 중」 ' + two.map(x => x.status).join());
        postDelay = 0; postFail = { status: 500, message: 'naver_relay_error_400 — 시험' }; r = await api('POST', '/api/inbox/threads/qna/990658006/send', { text: '네이버가 거절할 답' });
        ok(r.status === 502 && r.json.code === 'post_failed' && /naver_relay_error_400/.test(r.json.error) && (await pool.query(`SELECT posting_at, answered FROM ${TB.qnas} WHERE question_id = 990658006`)).rows[0].posting_at === null, '네이버 거절(5xx) = 502 + 그 사유 글 · 집기 풀림');
        postFail = { status: 401, message: 'unauthorized' }; r = await api('POST', '/api/inbox/threads/qna/990658006/send', { text: '중계가 401 을 줄 답' });
        postFail = { status: 403, message: 'path not allowed' }; const r403 = await api('POST', '/api/inbox/threads/qna/990658006/send', { text: '중계가 403 을 줄 답' });
        ok(r.status === 502 && r.json.upstream === 401 && r.json.ok === false && r403.status === 502 && r403.json.code === 'post_failed', '🔴 네이버·중계의 401·403 = 502 로 내림(화면이 로그인 만료로 읽지 않게) · 403 을 pii 로 붙이지 않음 ' + [r.status, r403.status, r403.json.code].join());
        postFail = null; await pool.query(`UPDATE ${TB.qnas} SET posting_at = NOW() - interval '3 minutes' WHERE question_id = 990658006`);
        r = await api('POST', '/api/inbox/threads/qna/990658006/send', { text: '멈춘 집기 뒤 답', seen: 123 }); ok(r.status === 200, '2분 넘게 멈춘 집기는 풀린 것으로 보고 다시 집힘 · seen 이 문자열이 아니면 대조 안 함');
        r = await api('GET', '/api/inbox/threads/qna/1234567890123456?peek=1'); ok(r.status === 400, '상품문의 번호 16자리 = 400(15자리까지)');
        const pE = posts.length; r = await api('POST', '/api/inbox/threads/qna/990658008/send', { text: '이름 없는 계정의 답' }, { id: 990661, name: '', username: '', role: 'user' });
        ok(r.status === 200 && posts[pE].by === 'staff' && (await pool.query(`SELECT posted_by FROM ${TB.qnas} WHERE question_id = 990658008`)).rows[0].posted_by === 'staff', '이름이 빈 계정 = 「staff」로 적힘(봇 표식 auto 가 되지 않음)');
        r = await api('GET', '/api/inbox/threads/qna/990658002'); const q2r = (await pool.query(`SELECT reviewed_at FROM ${TB.qnas} WHERE question_id = 990658002`)).rows[0];
        const cq = (await api('GET', '/api/inbox/counts')).json.counts.qna;
        ok(r.json.thread.unread === 0 && q2r.reviewed_at === null && r.json.thread.needs_reply === true && !(await api('GET', '/api/inbox/threads?ch=qna')).json.threads.find(x => x.id === '990658002') && !!(await api('GET', '/api/inbox/threads?ch=qna&scope=open')).json.threads.find(x => x.id === '990658002') && cq.open === 1,
            '상품문의도 열기만 하면 reviewed_at 무접촉 · 안 읽음에서는 빠지고 「답 안 한 것」(open)에는 남음 ' + JSON.stringify(cq));

        console.log('⑦ 주문문의');
        r = await api('GET', '/api/inbox/threads?ch=inquiry'); L = r.json.threads; const i1 = L.find(x => x.id === '990658101');
        ok(L.length === 3 && i1.why === '반품·교환·환불 분류' && i1.sub === '선물용 3kg' && L.find(x => x.id === '990658102').has_draft === true, '목록 3 · 분류 사유 · 옵션(sub) · 초안');
        r = await api('GET', '/api/inbox/threads/inquiry/990658101?peek=1'); ok(r.json.messages[0].body === '문의드립니다\n언제 오나요' && r.json.limits.public === false && /전화번호는 돼요/.test(r.json.limits.pii_note), '대화 = 제목 + 내용 · 비공개 표시');
        const pN3 = posts.length; r = await api('POST', '/api/inbox/threads/inquiry/990658101/send', { text: '010-1234-5678 로 연락드리겠습니다.' });
        ok(r.status === 200 && posts[pN3].kind === 'inquiry' && posts[pN3].opts && posts[pN3].opts.skipPhone === true && posts[pN3].id === '990658101', '주문문의 = 전화번호가 들어도 등록(skipPhone) — 실제 검사 함수로 확인');
        r = await api('POST', '/api/inbox/threads/inquiry/990658103/send', { text: '서귀포시 중앙로 12 로 보내 드릴게요' }); ok(r.status === 403 && /주소/.test(r.json.error), '주문문의도 주소 검사는 그대로(403)');
        ok(qnaPiiCheck('010-1234-5678').ok === false && qnaPiiCheck('010-1234-5678', { skipPhone: true }).ok === true && qnaPiiCheck('a@b.co', { skipPhone: true }).ok === false && qnaPiiCheck('02-123-4567', { skipPhone: true }).ok === true && qnaPiiCheck('02-123-4567').ok === false,
            '실코드 qnaPiiCheck: 인자 없으면 종전대로 전화번호 막음(상품문의·자동 등록) · skipPhone 이면 전화번호만 통과(이메일은 막음)');
        ok(/async function naverPostInquiryAnswer\(inquiryNo, content, actor, opts\)/.test(src) && /const pii = qnaPiiCheck\(text, opts\);/.test(src) && (src.match(/const pii = qnaPiiCheck\(text\);/g) || []).length === 1 && /naverPostInquiryAnswer\(id, \(req\.body \|\| \{\}\)\.content, adminActor\(req\)\)/.test(src),
            'server.js: 주문문의 등록 함수만 opts 를 검사에 넘김 · 상품문의 등록 함수와 문의 관리 화면 라우트는 종전 호출 그대로');
        r = await api('POST', '/api/inbox/threads/inquiry/990658101/unread'); ok(r.status === 200 && (await api('GET', '/api/inbox/threads?ch=inquiry')).json.threads.find(x => x.id === '990658101').unread === 1 && (await pool.query(`SELECT reviewed_at FROM ${TB.inquiries} WHERE inquiry_id = '990658101'`)).rows[0].reviewed_at !== null, '안 읽음으로 되돌리기 = 답한 건도 목록에 다시(표식) · reviewed_at 은 그대로');
        r = await api('GET', '/api/inbox/threads/inquiry/abc'); ok(r.status === 400, '숫자가 아닌 문의 번호 = 400');
        r = await api('GET', '/api/inbox/counts'); ok(r.status === 200 && r.json.counts.qna && typeof r.json.counts.talk.unread === 'number', 'GET /api/inbox/counts');

        // 초안 상한: 같은 순간 여러 번 눌러도 상한을 넘지 않음(한 문장 증가)
        await pool.query(`UPDATE agent_office_config SET value = '{"draft_daily_cap":4}'::jsonb WHERE key = 'inbox_threads_verify'`); const g0 = gens.length;
        const kk = [kA, kB, kOld]; await lg(U.b, '또 문의해요', { ago: 0, mark: '[SKIP-무응답]' }); await lg(U.old, '다시 문의해요', { ago: 0, mark: '[SKIP-무응답]' });
        const many = await Promise.all([0, 1, 2].map(i => api('POST', `/api/inbox/threads/talk/${kk[i]}/draft`)));
        const stN = (await pool.query(`SELECT value FROM agent_office_config WHERE key = 'inbox_threads_verify_state'`)).rows[0].value.n;
        ok(many.filter(x => x.status === 200).length === 2 && many.filter(x => x.status === 429).length === 1 && gens.length === g0 + 2 && stN === 4, '초안 상한 4 · 이미 2번 쓴 상태에서 3명이 같이 누름 = 2번만 통과(AI 2회) · 셈 4 ' + many.map(x => x.status).join());
        console.log('⑧ 라이브 표 무접촉');
        const live1 = (await pool.query(`SELECT (SELECT count(*) FROM message_logs)::int a, (SELECT count(*) FROM naver_qnas)::int b, (SELECT count(*) FROM naver_inquiries)::int c, (SELECT count(*) FROM talk_outbox)::int d`)).rows[0];
        const marks = (await pool.query(`SELECT (SELECT count(*) FROM message_logs WHERE user_id LIKE '%vt658%')::int a, (SELECT count(*) FROM naver_qnas WHERE question_id BETWEEN 990658000 AND 990658999)::int b, (SELECT count(*) FROM naver_inquiries WHERE inquiry_id LIKE '990658%')::int c, (SELECT count(*) FROM talk_outbox WHERE user_id LIKE '%vt658%')::int d`)).rows[0];
        const liveReads = (await pool.query(`SELECT to_regclass('public.inbox_thread_reads') IS NOT NULL AS has`)).rows[0].has ? (await pool.query(`SELECT count(*)::int n FROM inbox_thread_reads WHERE tkey LIKE '990658%' OR tkey = ANY($1::text[])`, [[kA, kB, kK, kM, kOld]])).rows[0].n : 0;
        ok(liveReads === 0, '라이브 읽음 표식 표에도 시험 줄 0');
        ok(marks.a + marks.b + marks.c + marks.d === 0 && live1.d === live0.d, '라이브 표에 시험 줄 0(톡톡 기록·상품문의·주문문의·보낼 글) ' + JSON.stringify(marks));
        ok(mod.tables.logs === TB.logs && require(path.join(ROOT, 'inbox-threads.js'))(express(), { pool, authMiddleware, tables: TB }).tables.logs === 'message_logs', 'testMode 가 아니면 tables 를 줘도 라이브 표 이름만 씀');
    } catch (e) { fail++; console.log('  ❌ 예외: ' + (e && e.stack || e)); }
    finally {
        server.close(); await dropAll().catch(e => console.log('정리 실패:', e.message));
        const left = (await pool.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name LIKE 'verify658%'`)).rows[0].n;
        ok(left === 0, '시험용 표·설정 줄 정리 0');
        await pool.end();
    }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

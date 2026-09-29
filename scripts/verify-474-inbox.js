// #474 검증 — 확인 필요 문의 칸 · [확인]/되돌리기 · 보내기 안전장치 · 요금 나누기 (로컬 서버 3465 · 손님에게 나가는 것 0)
// 실행: node scripts/verify-474-inbox.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..');
const PORT = 3465, BASE = 'http://127.0.0.1:' + PORT, SECRET = 'verify474';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const res = [];
const ok = (n, p, note) => { res.push(p); console.log((p ? '✅ ' : '❌ ') + n + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(tok, method, url, body) {
    for (let i = 0; i < 2; i++) {
        try {
            const h = { Connection: 'close' }; if (tok) h.Authorization = 'Bearer ' + tok; if (body) h['Content-Type'] = 'application/json';
            const r = await fetch(BASE + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
            return { status: r.status, j: await r.json().catch(() => ({})) };
        } catch (e) { if (i) throw e; await sleep(800); }
    }
}
const desk = (script, ...args) => { try { return { ok: true, out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'desk', script), ...args.map(String)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) }; } };
const tmp = o => { const f = path.join(os.tmpdir(), 'v474-' + Math.random().toString(36).slice(2) + '.json'); fs.writeFileSync(f, JSON.stringify(o)); return f; };

(async () => {
    const users = (await pool.query(`SELECT id, name, username, role FROM users WHERE deleted_at IS NULL ORDER BY id`)).rows;
    const boss = users.find(u => u.username === 'admin'), staff = users.find(u => u.role !== 'admin' && u.role !== 'accountant');
    const tok = u => jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role }, SECRET, { expiresIn: '1h' });
    const made = { logs: [], orders: [] };
    const srv = spawn(process.execPath, ['-e', `const si=global.setInterval; global.setInterval=(f,ms,...a)=> (ms<=5000 ? si(f,ms,...a) : {unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
        { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), JWT_SECRET: SECRET, RENDER: '' }), stdio: ['ignore', 'pipe', 'pipe'] });
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(1000); try { const r = await fetch(BASE + '/index.html', { headers: { Connection: 'close' } }); if (r.ok) up = true; } catch (e) { /* 아직 */ } }
    try {
        if (!up) throw new Error('로컬 서버가 뜨지 않았습니다');
        // 시험용 톡톡 손님 3명(가짜 식별값) — 미답변 · 봇 답변 · 광고
        const mk = async (uid, msg, answered, bot) => { const r = await pool.query(`INSERT INTO message_logs (user_id, item, message, answered, bot_response) VALUES ($1, '기타', $2, $3, $4) RETURNING id`, [uid, msg, answered, bot]); made.logs.push(r.rows[0].id); return r.rows[0].id; };
        const a = await mk('v474-open', '[검증474] 오늘 주문하면 언제 받나요?', false, '[쿨다운-무응답]');
        const b = await mk('v474-ai', '[검증474] 선물용 3kg 몇 과 들어가요?', true, '안녕하세요 고객님 🍊 검증용 봇 답변입니다.');
        const c = await mk('v474-ad', '[검증474] 상위 노출 마케팅 제안드립니다 https://example.kr', false, '[SKIP-무응답]');

        const no = await call(null, 'GET', '/api/agent-office/desk/inbox');
        ok('로그인 없이는 볼 수 없다(401)', no.status === 401, String(no.status));
        const i1 = await call(tok(staff || boss), 'GET', '/api/agent-office/desk/inbox');
        const talk = i1.j.talk || [];
        const fa = talk.find(x => x.id === a), fb = talk.find(x => x.id === b), fc = talk.find(x => x.id === c);
        ok('직원도 확인 필요 문의를 본다 · 채널 3개', i1.status === 200 && Array.isArray(i1.j.talk) && Array.isArray(i1.j.qna) && Array.isArray(i1.j.inquiry), `톡톡 ${talk.length} · Q&A ${(i1.j.qna || []).length} · 주문 문의 ${(i1.j.inquiry || []).length}`);
        ok('미답변 = open · 사유 표시', !!fa && fa.state === 'open' && /30분/.test(fa.why), fa ? fa.why : '없음');
        ok('봇이 답한 건 = AI 답변 확인 전 · 손님 글과 봇 답이 함께', !!fb && fb.state === 'ai' && /검증용 봇 답변/.test(fb.answer));
        ok('광고·업체 제안 글은 목록에서 빠진다', !fc);
        ok('손님 식별값은 화면으로 나가지 않는다', !JSON.stringify(i1.j).includes('v474-open'));
        const before = i1.j.counts.talk;

        const r1 = await call(tok(staff || boss), 'POST', '/api/agent-office/desk/inbox/review', { kind: 'talk', id: a });
        const i2 = await call(tok(boss), 'GET', '/api/agent-office/desk/inbox');
        ok('[확인] = 목록에서 빠짐 · 건수 1 감소', r1.status === 200 && !(i2.j.talk || []).find(x => x.id === a) && i2.j.counts.talk.open === before.open - 1, `${before.open} → ${i2.j.counts.talk.open}`);
        const i3 = await call(tok(boss), 'GET', '/api/agent-office/desk/inbox?seen=1');
        const sa = (i3.j.talk || []).find(x => x.id === a);
        ok('「확인한 건도 보기」 = 다시 보임 · 누가 확인했는지', !!sa && sa.seen === true && !!sa.seen_by, sa ? sa.seen_by : '');
        await call(tok(boss), 'POST', '/api/agent-office/desk/inbox/review', { kind: 'talk', id: a, undo: true });
        const i4 = await call(tok(boss), 'GET', '/api/agent-office/desk/inbox');
        ok('되돌리기 = 목록에 다시 올라옴', !!(i4.j.talk || []).find(x => x.id === a));
        const row = (await pool.query(`SELECT message, bot_response, answered FROM message_logs WHERE id = $1`, [a])).rows[0];
        ok('[확인]은 표시만 바꾼다(손님 글·봇 기록 무변경)', /언제 받나요/.test(row.message) && row.bot_response === '[쿨다운-무응답]' && row.answered === false);
        const bad = await call(tok(boss), 'POST', '/api/agent-office/desk/inbox/review', { kind: 'nope', id: 1 });
        ok('모르는 채널은 거부(400)', bad.status === 400, String(bad.status));

        // 창구 도구
        const p = desk('talk-pending.js');
        const pj = p.ok ? JSON.parse(p.out) : { items: [] };
        ok('창구 뽑기 = 미답변·봇 답변 포함 · 광고 제외', p.ok && pj.items.some(x => x.talk_no === a) && pj.items.some(x => x.talk_no === b) && !pj.items.some(x => x.talk_no === c));
        ok('창구 뽑기에도 손님 식별값 없음', !p.out.includes('v474-'));

        // 보내기 안전장치 — 실서버 배달부가 집지 않도록 전부 「막히는 경우」만 시험한다
        const mkOrder = async (text, status) => { const r = await pool.query(`INSERT INTO pending_orders (content, status, created_by, created_by_id) VALUES ($1, $2, $3, $4) RETURNING id`, [text, status, boss.name, boss.id]); made.orders.push(r.rows[0].id); return r.rows[0].id; };
        const oTest = await mkOrder('[검증469] 그대로 보내', '처리중');
        const s1 = desk('talk-send.js', oTest, tmp({ items: [{ talk_no: a, text: '검증용 글' }] }));
        ok('시험 지시로는 손님에게 보내지 않는다', !s1.ok && /시험 지시/.test(s1.out));
        const oWait = await mkOrder('[검증474w] 그대로 보내', '완료');
        const s2 = desk('talk-send.js', oWait, tmp({ items: [{ talk_no: a, text: '검증용 글' }] }));
        ok('처리중이 아닌 지시로는 보낼 수 없다', !s2.ok && /처리중만/.test(s2.out));
        const oReal = await mkOrder('[검증474] 그대로 보내', '처리중');
        const s3 = desk('talk-send.js', oReal, tmp({ items: [
            { talk_no: a, text: '계좌로 입금해 주시면 됩니다' },
            { talk_no: a, text: 'ㄱ'.repeat(1001) },
            { talk_no: 999999999, text: '없는 번호' },
        ] }));
        const j3 = s3.ok ? JSON.parse(s3.out) : { results: [] };
        ok('결제 단어 · 1000자 초과 · 없는 번호 = 전부 안 보냄', s3.ok && j3.sent === 0 && j3.failed === 3 && /결제 단어/.test(j3.results[0].error) && /1000자/.test(j3.results[1].error), JSON.stringify(j3.results.map(x => x.error)));
        await pool.query(`UPDATE message_logs SET staff_response = '직원이 먼저 답함' WHERE id = $1`, [a]);
        const s4 = desk('talk-send.js', oReal, tmp({ items: [{ talk_no: a, text: '검증용 글' }] }));
        const j4 = s4.ok ? JSON.parse(s4.out) : { results: [{}] };
        ok('그 사이 직원이 답한 손님에게는 보내지 않는다', s4.ok && j4.sent === 0 && /이미 답했습니다/.test(j4.results[0].error || ''));
        const q = (await pool.query(`SELECT COUNT(*)::int c FROM talk_outbox WHERE order_id = ANY($1::int[])`, [made.orders])).rows[0].c;
        ok('검증 중 「보낼 글」 표에 올라간 것 0건(손님에게 나간 것 없음)', q === 0, q + '건');

        // 요금 나누기 — 대기 프로그램 코드의 판정식을 그대로 실행
        const src = fs.readFileSync(path.join(ROOT, 'scripts', 'desk', 'launcher.js'), 'utf8');
        ok('대기 프로그램: 대표 지시는 키 없이 · 나머지는 콘솔 키', /await handle\(o, \(st\.sub \|\| mine\) \? null : key\);/.test(src) && /username = 'admin'/.test(src) && /created_by_id/.test(src));
        const ids = (await pool.query(`SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL`)).rows.map(r => r.id);
        const jo = users.find(u => u.role === 'admin' && u.username !== 'admin');
        ok('대표 요금제 대상 = 대표 한 명(조가영·직원은 콘솔)', ids.length === 1 && ids[0] === boss.id && (!jo || !ids.includes(jo.id)) && (!staff || !ids.includes(staff.id)), '대표 id ' + ids.join(','));

        // 봇 통로 코드
        const bot = path.join(ROOT, '..', '★제주아꼼이네 톡톡봇', 'server.js');
        if (fs.existsSync(bot)) {
            const bs = fs.readFileSync(bot, 'utf8');
            ok('톡톡봇 /send = 열쇠 검사 · 결제 단어 차단 · 7일 안 대화 손님만 · 직원 답변 기록 · 쿨다운', /app\.post\("\/send"/.test(bs) && /timingSafeEqual/.test(bs) && /PAY_WORDS\.test\(text\)/.test(bs) && /interval '7 days'/.test(bs) && /recordStaffReply\(userId/.test(bs) && /lastResponseTime\.set\(userId/.test(bs));
        } else ok('톡톡봇 폴더 없음 — 코드 검사 건너뜀', true);
    } catch (e) { ok('검증 중 예외 없음', false, e.message); }
    finally {
        srv.kill();
        if (made.logs.length) await pool.query(`DELETE FROM message_logs WHERE id = ANY($1::int[]) AND user_id LIKE 'v474-%'`, [made.logs]);
        if (made.orders.length) await pool.query(`UPDATE pending_orders SET is_deleted = true WHERE id = ANY($1::int[])`, [made.orders]);
        const left = (await pool.query(`SELECT COUNT(*)::int c FROM message_logs WHERE user_id LIKE 'v474-%'`)).rows[0].c;
        ok('시험 흔적 정리', left === 0);
        await pool.end();
    }
    console.log(`\n결과 ${res.filter(Boolean).length}/${res.length}`);
    process.exit(res.every(Boolean) ? 0 : 1);
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

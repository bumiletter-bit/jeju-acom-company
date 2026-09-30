// #470 검증 — 창구 대기 프로그램·켜기/끄기 버튼 (로컬 실서버 3459 · 실DB 읽기 · 쓰기는 desk_wake_request 한 칸만)
// 실행: node scripts/verify-470-launcher.js
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { Pool } = require('pg');

const PORT = 3459, BASE = `http://127.0.0.1:${PORT}`, SECRET = 'verify470';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const res = [];
const ok = (name, pass, note) => { res.push(pass); console.log((pass ? '✅ ' : '❌ ') + name + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, token) {
    for (let i = 0; i < 2; i++) {
        try {
            const r = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + token, Connection: 'close' } });
            return { status: r.status, body: await r.json().catch(() => ({})) };
        } catch (e) { if (i) throw e; await sleep(800); }   // 쉬었다 보내면 끊긴 소켓으로 한 번 실패한다
    }
}
async function post(url, token, body) {
    for (let i = 0; i < 2; i++) {
        try {
            const r = await fetch(BASE + url, {
                method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Connection: 'close' },
                body: JSON.stringify(body || {}),
            });
            return { status: r.status, body: await r.json().catch(() => ({})) };
        } catch (e) { if (i) throw e; await sleep(800); }
    }
}

(async () => {
    const users = (await pool.query(`SELECT id, name, username, role FROM users WHERE deleted_at IS NULL AND role IN ('admin','staff') ORDER BY (role='admin') DESC, id LIMIT 12`)).rows;
    const admin = users.find(u => u.role === 'admin'), staff = users.find(u => u.role !== 'admin');
    if (!admin) throw new Error('관리자 계정을 찾지 못했습니다');
    const tok = u => jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role }, SECRET, { expiresIn: '1h' });

    const before = (await pool.query(`SELECT value FROM agent_office_config WHERE key='desk_wake_request'`)).rows[0];

    const srv = spawn(process.execPath, ['server.js'], {
        cwd: path.resolve(__dirname, '..'),
        env: Object.assign({}, process.env, { PORT: String(PORT), JWT_SECRET: SECRET, NODE_ENV: 'test' }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let up = false;
    srv.stdout.on('data', d => { if (/listening|실행|listen/i.test(String(d))) up = true; });
    for (let i = 0; i < 60 && !up; i++) { await sleep(1000); try { const r = await fetch(BASE + '/api/version', { headers: { Connection: 'close' } }); if (r.ok) up = true; } catch (e) { /* 아직 */ } }
    if (!up) { srv.kill(); throw new Error('로컬 서버가 뜨지 않았습니다'); }

    try {
        const st = await get('/api/agent-office/desk-status', tok(admin));
        ok('상태에 대기 프로그램 정보가 실린다', st.status === 200 && 'launcher' in st.body && 'can_wake' in st.body,
            JSON.stringify({ state: st.body.state, can_wake: st.body.can_wake, launcher: st.body.launcher }));
        ok('대기 프로그램이 돌고 있으면 켜기 버튼을 쓸 수 있다', st.body.can_wake === true && st.body.launcher && st.body.launcher.on === true,
            st.body.can_wake ? '' : '대기 프로그램이 꺼져 있으면 이 항목은 ❌가 정상');

        if (staff) {
            const w = await post('/api/agent-office/desk/wake', tok(staff), { action: 'wake' });
            ok('#490 직원은 창구를 깨울 수 없다(403 · 관리자만)', w.status === 403, w.body.message || String(w.status));
            const r = await post('/api/agent-office/desk/wake', tok(admin), { action: 'sleep' });
            ok('#490 「쉬게 하기」 없음(관리자여도 400)', r.status === 400, String(r.status));
        } else ok('직원 계정 없음 — 권한 검사 건너뜀', true);

        const a = await post('/api/agent-office/desk/wake', tok(admin), { action: 'wake' });
        ok('관리자 켜기 신호 기록', a.status === 200, a.body.message);
        const row = (await pool.query(`SELECT value, EXTRACT(EPOCH FROM (NOW()-updated_at))::int ago FROM agent_office_config WHERE key='desk_wake_request'`)).rows[0];
        ok('신호에 누가·언제·무엇이 남는다', !!row && row.value.action === 'wake' && !!row.value.at && row.ago < 60, JSON.stringify(row && row.value));

        const noTok = await fetch(BASE + '/api/agent-office/desk/wake', { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: '{}' });
        ok('로그인 없이는 안 된다', noTok.status === 401 || noTok.status === 403, String(noTok.status));

        // 대기 프로그램이 신호를 집어 desk_auto 를 켜 두는지(10초 주기)
        await sleep(14000);
        const au = (await pool.query(`SELECT value FROM agent_office_config WHERE key='desk_auto'`)).rows[0];
        ok('대기 프로그램이 신호를 집어 「켜짐」으로 둔다', !!au && au.value.on === true, JSON.stringify(au && au.value));

        const lc = (await pool.query(`SELECT value, EXTRACT(EPOCH FROM (NOW()-updated_at))::int ago FROM agent_office_config WHERE key='desk_launcher'`)).rows[0];
        ok('대기 프로그램이 살아 있다는 소식을 계속 남긴다', !!lc && lc.ago < 60, lc ? lc.ago + '초 전 · ' + (lc.value.host || '') : '없음');

        const hb = (await pool.query(`SELECT value, EXTRACT(EPOCH FROM (NOW()-updated_at))::int ago FROM agent_office_config WHERE key='desk_heartbeat'`)).rows[0];
        ok('창구가 화면에 「대기 중」으로 보인다', !!hb && hb.ago < 120, hb ? hb.ago + '초 전 · ' + hb.value.state : '없음');
    } finally {
        srv.kill();
        // 검사로 남긴 신호는 원래대로 되돌린다(실운영 값 보존)
        if (before) await pool.query(`UPDATE agent_office_config SET value=$1::jsonb WHERE key='desk_wake_request'`, [JSON.stringify(before.value)]);
        else await pool.query(`DELETE FROM agent_office_config WHERE key='desk_wake_request'`);
        await pool.end();
    }
    console.log(`\n결과 ${res.filter(Boolean).length}/${res.length}`);
    process.exit(res.every(Boolean) ? 0 : 1);
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { /* 이미 닫힘 */ } process.exit(1); });

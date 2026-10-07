// #570-b 최종발주 대화에 사진 1장 — 서버 접수(memo-read kind chat)에 image_data 가 저장되는지 · 파일(엑셀)은 400 · 받은 뒤 DELETE 로 지워짐
//   🔴 실DB 에 '대기' 행이 잠깐 생긴다(대표 PC 대기 프로그램이 2초마다 집어 감) → 만든 즉시 지운다. 로컬 서버 3457 · 스케줄러 막음.
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); const { Pool } = require('pg');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest'; const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const JPG = 'data:image/jpeg;base64,' + Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64').toString('base64');
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    const made = [];
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        const U = { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, tok = jwt.sign(U, SECRET, { expiresIn: '1h' });
        const call = async (url, method = 'GET', body) => { const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Connection: 'close' }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch (_) { } return { s: r.status, j: j || {} }; };
        const base = { kind: 'chat', shipDate: '2020-01-01', realToday: '2020-01-01', shipDays: ['2020-01-01'], ask: '[사진 첨부] 사진에 적힌 번호와 요청(사이즈 등)을 정리 줄로 읽어 주세요.', orders: [], catalog: {}, summary: '시험', history: [] };
        // ① 사진 → 접수 즉시 삭제
        let r = await call('/api/agent-office/final-order/memo-read', 'POST', Object.assign({ image_data: JPG, image_mime: 'image/jpeg' }, base));
        if (r.j.id) { made.push(r.j.id); await pool.query(`UPDATE pending_orders SET status='질문종결', is_deleted=true WHERE id=$1`, [r.j.id]); }
        ok(r.s === 200 && r.j.ok && r.j.id, '① 사진 붙인 대화 접수 200', JSON.stringify(r.j));
        const row = (await pool.query(`SELECT content, image_mime, length(image_data) AS n, payload->>'type' AS t FROM pending_orders WHERE id=$1`, [r.j.id])).rows[0] || {};
        ok(/사진 1장$/.test(row.content || '') && row.image_mime === 'image/jpeg' && Number(row.n) === JPG.length && row.t === 'fo_chat', '① 저장 = 내용 「… · 사진 1장」 · image_mime · image_data 길이 같음 · payload fo_chat', JSON.stringify(row));
        // ② 사진 없는 종전 호출
        r = await call('/api/agent-office/final-order/memo-read', 'POST', base);
        if (r.j.id) { made.push(r.j.id); await pool.query(`UPDATE pending_orders SET status='질문종결', is_deleted=true WHERE id=$1`, [r.j.id]); }
        const row2 = (await pool.query(`SELECT content, image_data FROM pending_orders WHERE id=$1`, [r.j.id])).rows[0] || {};
        ok(r.s === 200 && r.j.ok && row2.image_data == null && !/사진/.test(row2.content || ''), '② 사진 없이 = 종전과 같음(image_data 없음)', row2.content);
        // ③ 파일(엑셀)은 거절
        r = await call('/api/agent-office/final-order/memo-read', 'POST', Object.assign({ image_data: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBA==', file_name: 'a.xlsx' }, base));
        if (r.j.id) { made.push(r.j.id); await pool.query(`UPDATE pending_orders SET status='질문종결', is_deleted=true WHERE id=$1`, [r.j.id]); }
        ok(r.s === 400 && /사진만/.test(r.j.message || r.j.error || ''), '③ 엑셀 첨부 = 400 「사진만」', JSON.stringify(r.j));
        // ④ 너무 큰 사진
        r = await call('/api/agent-office/final-order/memo-read', 'POST', Object.assign({ image_data: 'data:image/jpeg;base64,' + 'A'.repeat(14_100_000), image_mime: 'image/jpeg' }, base));
        if (r.j.id) { made.push(r.j.id); await pool.query(`UPDATE pending_orders SET status='질문종결', is_deleted=true WHERE id=$1`, [r.j.id]); }
        ok(r.s === 400 || r.s === 413, '④ 10MB 넘는 사진 = 거절(' + r.s + ')', (r.j.message || '').slice(0, 60));
    } catch (e) { fail++; console.log('ERR', e.message); }
    finally { srv.kill(); if (made.length) await pool.query(`UPDATE pending_orders SET is_deleted=true WHERE id = ANY($1::int[])`, [made]).catch(() => {}); console.log('  정리: 시험 대화 ' + made.length + '건 숨김'); await pool.end(); }
    console.log(`\n#570-b 대화 사진 접수: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();

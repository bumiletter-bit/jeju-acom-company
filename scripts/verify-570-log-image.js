// #570 최종발주 정리 기록에 수량 표 그림 첨부 — 로컬 서버(3457 · 스케줄러 막음) + 실DB(시험 기록은 끝에 soft-delete · 그림도 soft-delete)
//   ① 그림 2장 붙여 기록 → result.files 에 file_id 2개 · 내려받기 = PNG 바이트 동일 ② 같은 기록을 고쳐 쓰면 옛 그림 soft-delete · 새 그림만 남음 ③ 엉뚱한 data(png 아님·2MB 초과)는 조용히 건너뜀
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); const { Pool } = require('pg');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest'; const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');   // 1×1 PNG
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwnwEIGGEMAD+bBAGbMHkoAAAAAElFTkSuQmCC', 'base64');   // 2×2 PNG
const dataUrl = b => 'data:image/png;base64,' + b.toString('base64');
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    const made = { orders: [], files: [] };
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        const U = { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, tok = jwt.sign(U, SECRET, { expiresIn: '1h' });
        const call = async (url, method = 'GET', body) => { const opt = { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Connection: 'close' }, ...(body ? { body: JSON.stringify(body) } : {}) }; let r; try { r = await fetch(`http://localhost:${PORT}${url}`, opt); } catch (e) { await sleep(300); r = await fetch(`http://localhost:${PORT}${url}`, opt); } return r; };
        const lines = ['[검증570] 대성 1건(1박스) · 효돈 1건(1박스)', '제주도 배송: 없음'];
        // ①
        let r = await call('/api/agent-office/final-order/log', 'POST', { shipDate: '2020-01-01', lines, images: [{ name: '수량(대성) 1.1.png', data: dataUrl(PNG1) }, { name: '수량(효돈) 1.1.png', data: dataUrl(PNG2) }] });
        let j = await r.json(); ok(r.status === 200 && j.ok && j.id && j.files === 2, '① 기록 + 그림 2장 올림', JSON.stringify(j));
        const id = j.id; made.orders.push(id);
        let row = (await pool.query('SELECT content, result FROM pending_orders WHERE id=$1', [id])).rows[0];
        const f1 = ((row.result || {}).files || []); f1.forEach(f => made.files.push(f.file_id));
        ok(/^\[최종발주\] 1\/1\(수\) 발송분$/.test(row.content) && f1.length === 2 && f1.every(f => Number.isInteger(f.file_id) && /\.png$/.test(f.label)), '① result.files = file_id 2개(.png)', JSON.stringify(f1));
        const dl = await call(`/api/agent-office/files/${f1[0].file_id}/download`); const got = Buffer.from(await dl.arrayBuffer());
        ok(dl.status === 200 && /image\/png/.test(dl.headers.get('content-type') || '') && got.equals(PNG1), '① 내려받기 = PNG 바이트 동일 · content-type image/png', dl.headers.get('content-type'));
        // ② 고쳐 쓰기(다시 만들기) — 옛 그림 soft-delete
        r = await call('/api/agent-office/final-order/log', 'POST', { id, shipDate: '2020-01-01', lines, images: [{ name: '수량(대성) 1.1.png', data: dataUrl(PNG2) }] });
        j = await r.json(); ok(r.status === 200 && j.ok && j.id === id && j.files === 1, '② 같은 기록 고쳐 쓰기(그림 1장)', JSON.stringify(j));
        row = (await pool.query('SELECT result FROM pending_orders WHERE id=$1', [id])).rows[0];
        const f2 = ((row.result || {}).files || []); f2.forEach(f => made.files.push(f.file_id));
        const oldState = (await pool.query('SELECT id, is_deleted FROM report_files WHERE id = ANY($1::int[])', [f1.map(f => f.file_id)])).rows;
        ok(f2.length === 1 && !f1.some(f => f.file_id === f2[0].file_id) && oldState.every(x => x.is_deleted === true), '② 새 그림 1개만 · 옛 그림 2개 soft-delete', JSON.stringify({ f2, oldState }));
        const dl2 = await call(`/api/agent-office/files/${f1[0].file_id}/download`); ok(dl2.status === 404, '② 지운 옛 그림은 내려받기 404', dl2.status);
        // ③ 엉뚱한 것
        r = await call('/api/agent-office/final-order/log', 'POST', { shipDate: '2020-01-02', lines, images: [{ name: 'x.png', data: 'data:image/jpeg;base64,' + PNG1.toString('base64') }, { name: 'big.png', data: 'data:image/png;base64,' + Buffer.alloc(2.2 * 1024 * 1024, 1).toString('base64') }, { name: '', data: dataUrl(PNG1) }] });
        j = await r.json(); made.orders.push(j.id); ok(r.status === 200 && j.ok && j.files === 0, '③ png 아님 · 2MB 초과 · 이름 없음 = 건너뜀(기록은 남음)', JSON.stringify(j));
        // 그림 없이(종전 호출) 도 그대로
        r = await call('/api/agent-office/final-order/log', 'POST', { shipDate: '2020-01-03', lines }); j = await r.json(); made.orders.push(j.id);
        row = (await pool.query('SELECT result FROM pending_orders WHERE id=$1', [j.id])).rows[0];
        ok(r.status === 200 && j.ok && Array.isArray(row.result.files) && row.result.files.length === 0 && row.result.answer === lines.join('\n'), '④ 그림 없는 종전 호출 = files [] · 글 그대로');
    } catch (e) { fail++; console.log('ERR', e.message); }
    finally {
        srv.kill();
        try { if (made.orders.length) await pool.query('UPDATE pending_orders SET is_deleted = true WHERE id = ANY($1::int[])', [made.orders.filter(Boolean)]); if (made.files.length) await pool.query('UPDATE report_files SET is_deleted = true WHERE id = ANY($1::int[])', [made.files.filter(Boolean)]); console.log(`  정리: 시험 기록 ${made.orders.length}건 · 그림 ${made.files.length}개 soft-delete`); } catch (e) { console.log('정리 실패', e.message); }
        await pool.end();
    }
    console.log(`\n#570 정리 기록 그림: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();

// #561 「대표만」 서버 판정 검증 — 로컬 서버(3457 · 스케줄러 막음) + 실DB 읽기만(쓰기 0). 화면 쪽 = verify-561-owner.js(워커1)
//   대표(admin·대표) = 모두의 이력 · 과장(admin·과장) = 본인 것만 + 승인/반려 403 · 직원 = 본인 것만 + 403
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        const tok = u => jwt.sign(u, SECRET, { expiresIn: '1h' });
        const U = { owner: { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, mgr: { id: 7, username: 'm', name: '조가영', position: '과장', role: 'admin' }, staff: { id: 5, username: 's', name: '김민주', position: '팀장', role: 'user' } };
        const call = async (who, url, method = 'GET') => { const opt = { method, headers: { Authorization: 'Bearer ' + tok(U[who]), 'Content-Type': 'application/json', Connection: 'close' }, ...(method !== 'GET' ? { body: '{}' } : {}) }; let r; try { r = await fetch(`http://localhost:${PORT}${url}`, opt); } catch (e) { await sleep(300); r = await fetch(`http://localhost:${PORT}${url}`, opt); } let j = null; try { j = await r.json(); } catch (_) { } return { s: r.status, j: j || {} }; };
        const ids = (j) => [...new Set((j.orders || []).map(o => o.created_by_id))];
        for (const url of ['/api/agent-office/desk/orders?history=1&limit=200', '/api/agent-office/desk/orders?history=1&limit=200&q=' + encodeURIComponent('귤'), '/api/agent-office/desk/orders?limit=200']) {
            const o = await call('owner', url), m = await call('mgr', url), s = await call('staff', url);
            console.log(decodeURIComponent(url), '— 건수 대표', (o.j.orders || []).length, '과장', (m.j.orders || []).length, '직원', (s.j.orders || []).length, '· 대표가 보는 작성자', ids(o.j).join(','));
            ok(o.s === 200 && ids(o.j).length > 1, '대표 = 여러 사람 지시가 보인다');
            ok(m.s === 200 && ids(m.j).every(i => i === 7), `과장 = ${m.s} · 본인(7) 것만(${ids(m.j).join(',')})`);
            ok(s.s === 200 && ids(s.j).every(i => i === 5), `직원 = ${s.s} · 본인(5) 것만(${ids(s.j).join(',')})`);
        }
        { const m = await call('mgr', '/api/agent-office/desk/orders?history=1&limit=200'); ok((m.j.orders || []).length > 0, '과장 이력에 본인 지시가 실제로 나온다(' + (m.j.orders || []).length + '건)'); }
        for (const act of ['approve', 'reject']) {
            const url = `/api/agent-office/orders/999999999/${act}`;   // 없는 번호 — 권한 문만 본다(쓰기 0)
            const o = await call('owner', url, 'POST'), m = await call('mgr', url, 'POST'), s = await call('staff', url, 'POST');
            ok(o.s !== 403 && o.s !== 401, `${act}: 대표는 권한 통과(없는 번호라 ${o.s})`);
            ok(m.s === 403, `${act}: 과장 403(${m.s} ${m.j.error})`);
            ok(s.s === 403, `${act}: 직원 403(${s.s})`);
        }
        // 과장이 계속 쓰는 것 — 관리자 전용 조회가 그대로 열리는지
        for (const url of ['/api/settlements?limit=1', '/api/pricing', '/api/expense-reports/history', '/api/box-inventory/history']) { const m = await call('mgr', url); ok(m.s === 200, `과장 ${url} = ${m.s}(그대로 열림)`); }
        // 문의 관리의 삭제·전체 스위치·수정 이력 = 대표만(과장·직원은 403 — 권한 문에서 막혀 쓰기 0 · 대표는 조회만 불러 본다)
        const D = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        for (const [method, url] of [['DELETE', '/api/agent-office/scenarios/999999999'], ['PUT', '/api/agent-office/scenarios-auto-reply'], ['GET', '/api/agent-office/scenario-logs?from=' + D + '&to=' + D], ['DELETE', '/api/agent-office/bot-products/999999999'], ['GET', '/api/agent-office/bot-product-logs?from=' + D + '&to=' + D], ['GET', '/api/agent-office/season-knowledge-logs?from=' + D + '&to=' + D], ['DELETE', '/api/agent-office/season-waitlist/999999999'], ['PUT', '/api/agent-office/naver/qna-auto-post'], ['PUT', '/api/agent-office/naver/inquiry-auto-post']]) {
            const m = await call('mgr', url, method), st = await call('staff', url, method);
            ok(m.s === 403 && st.s === 403, `${method} ${url.split('?')[0]}: 과장 ${m.s} · 직원 ${st.s}`);
            if (method === 'GET') { const o = await call('owner', url); ok(o.s === 200, '  대표는 조회됨(' + o.s + ')'); }
        }
        for (const url of ['/api/agent-office/scenarios', '/api/agent-office/bot-products']) { const m = await call('mgr', url), st = await call('staff', url); ok(m.s === 200 && st.s === 200, `${url} 보기·수정 화면은 과장 ${m.s} · 직원 ${st.s}(그대로)`); }
    } catch (e) { fail++; console.log('ERR', e.message); }
    finally { srv.kill(); }
    console.log(`\n#561 서버 판정: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();

// #577 직원이 서류 알림(#documents?id=N)·기안서류 [상세]·PDF 를 눌러도 관리자 전용 조회(403)에 안 걸리는지 — 대표·직원 실렌더
//   로컬 서버 3457(스케줄러 막음) · 쓰기 요청 전부 가짜 200 → DB 쓰기 0 · alert/dialog 횟수 집계
const { spawn } = require('child_process'); const path = require('path'); const jwt = require('jsonwebtoken'); const { chromium } = require('playwright');
const PORT = 3457, ROOT = path.join(__dirname, '..'), SECRET = 'verifytest';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
// 직원 id 5(김민주 · role user)의 승인된 서류 = 200 (실DB 10/8 확인)
const U = { 대표: { id: 1, username: 'o', name: '전승범', position: '대표', role: 'admin' }, 직원: { id: 5, username: 's', name: '김민주', position: '팀장', role: 'user' } };
const DOC_ID = Number(process.argv[2] || 200);
(async () => {
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
    let br;
    try {
        let up = false; for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('서버 기동 실패');
        br = await chromium.launch();
        for (const who of Object.keys(U)) {
            console.log('—', who);
            const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' }); const pg = await ctx.newPage();
            const errs = [], dialogs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => { }); });
            let writes = 0, hist403 = 0; await pg.route('**/api/**', r => { if (r.request().method() !== 'GET') { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
            pg.on('response', r => { if (r.url().includes('/api/documents/history') && r.status() === 403) hist403++; });
            const tok = jwt.sign(U[who], SECRET, { expiresIn: '1h' });
            await pg.addInitScript(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); }, [tok, U[who]]);
            // ① 알림 링크 꼴로 진입(#576 notiApplyHash)
            await pg.goto(`http://localhost:${PORT}/#documents?id=${DOC_ID}`, { waitUntil: 'domcontentloaded' }); await sleep(4500);
            const modal = await pg.evaluate(() => { const o = [...document.querySelectorAll('.modal-overlay')].pop(); if (!o) return null; return { text: o.textContent.replace(/\s+/g, ' ').slice(0, 200), shown: o.getClientRects().length > 0 }; });
            ok(modal && modal.shown && /신청자/.test(modal.text) && /처리일/.test(modal.text), `알림 링크 → 서류 상세 창 ${modal ? '열림' : '안 열림'}${modal ? ' · ' + modal.text.slice(0, 60) : ''}`);
            ok(dialogs.length === 0, `alert 0건${dialogs.length ? ' — ' + dialogs[0].slice(0, 80) : ''}`);
            ok(hist403 === 0, `관리자 전용 이력 403 ${hist403}건`);
            // ② 기안서류 목록의 [상세] 버튼(같은 함수) — 직원 화면에서도
            await pg.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); });
            const detailBtn = await pg.$(`button[onclick="viewDocDetail(${DOC_ID})"]`);
            if (detailBtn && who === '직원') { await detailBtn.click(); await sleep(1500); const m2 = await pg.evaluate(() => { const o = [...document.querySelectorAll('.modal-overlay')].pop(); return !!(o && o.getClientRects().length && /신청자/.test(o.textContent)); }); ok(m2, '기안서류 목록 [상세] 버튼 → 상세 창'); await pg.evaluate(() => { document.querySelectorAll('.modal-overlay').forEach(m => m.remove()); }); }
            else console.log('    (목록 [상세] 버튼 ' + (detailBtn ? '있음 · 대표는 생략' : '없음 — 목록에 그 서류가 없음') + ')');
            // ③ PDF 다운로드가 조회 단계를 넘는지(생성 중 오류는 jspdf 쪽 — 403·alert 만 본다)
            const dl = pg.waitForEvent('download', { timeout: 8000 }).then(d => d.suggestedFilename()).catch(() => null);
            await pg.evaluate(id => downloadDocPDF(id), DOC_ID); const fname = await dl; await sleep(500);
            ok(dialogs.length === 0 && hist403 === 0, `PDF 다운로드 — 403 ${hist403} · alert ${dialogs.length}${fname ? ' · 파일 ' + fname : ''}`);
            ok(errs.length === 0, `화면 오류 ${errs.length}${errs.length ? ' — ' + errs[0].slice(0, 120) : ''} · 막은 쓰기 요청 ${writes}`);
            await ctx.close();
        }
    } catch (e) { fail++; console.log('ERR', e.message.split('\n')[0]); }
    finally { if (br) await br.close(); srv.kill(); }
    console.log(`\n#577 서류 상세(직원·대표): ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);
})();

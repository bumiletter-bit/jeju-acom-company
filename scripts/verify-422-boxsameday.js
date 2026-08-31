// #422 검증: 기준일 당일 「수기 수정 → 입고 등록」 즉시 반영 (2026-08-31)
// 방법론(#406 계열): 수정 "전" 코드의 8종 표시값을 캡처해 두고(box-old-422.json), 수정 "후" 실서버 응답과 전수 비교
// — 차이 = 의도한 선물용 2종(+3000/+3150)뿐임을 기계 증명(기존 6종·정산 차감 무회귀).
require('dotenv').config();
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const OLD_PATH = process.env.LOCALAPPDATA + '/Temp/claude/C--Users-----OneDrive------------------/84c2b41e-cf74-4593-a540-7ecc0540e622/scratchpad/box-old-422.json';
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

(async () => {
    let srv = null;
    try {
        const old = JSON.parse(fs.readFileSync(OLD_PATH, 'utf8'));
        ok('구코드 캡처 로드(8종)', old.length === 8);

        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: '3457' }, stdio: 'ignore' });
        let up = false;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try { const r = await fetch('http://localhost:3457/'); if (r.status) { up = true; break; } } catch (_) { }
        }
        ok('신코드 실서버 기동', up);
        if (!up) throw new Error('서버 기동 실패');

        const token = jwt.sign({ id: 1, name: 'v422', role: 'admin' }, 'verifytest');
        const inv = await (await fetch('http://localhost:3457/api/box-inventory', { headers: { Authorization: 'Bearer ' + token } })).json();
        const by = Object.fromEntries(inv.map(b => [b.productName, b]));
        const oldBy = Object.fromEntries(old.map(b => [b.productName, b]));

        // ① 의도한 변화: 선물용 2종만 당일 입고 반영
        ok('선물용 3kg 업체재고 = 3000 (당일 입고 즉시 반영)', by['선물용 박스 3kg'].companyStock === 3000, String(by['선물용 박스 3kg'].companyStock));
        ok('선물용 5kg 업체재고 = 3150', by['선물용 박스 5kg'].companyStock === 3150, String(by['선물용 박스 5kg'].companyStock));
        ok('선물용 대성·효돈 = 0 유지', ['선물용 박스 3kg', '선물용 박스 5kg'].every(n => by[n].daesongStock === 0 && (by[n].hyodonStock || 0) === 0));

        // ② 무회귀: 기존 6종 전 필드 = 구코드 표시값과 완전 동일 (정산일=기준일 16건이 있는 정산 차감 규칙 무접촉의 실증)
        const six = ['귤 박스 3kg', '귤 박스 5kg', '귤 박스 10kg', '만감 박스 3kg', '만감 박스 5kg', '만감 박스 10kg'];
        const diffs = six.filter(n => ['companyStock', 'daesongStock', 'hyodonStock'].some(f => (by[n] || {})[f] !== (oldBy[n] || {})[f]));
        ok('무회귀: 기존 6종 표시값 완전 동일', diffs.length === 0, diffs.length ? '차이: ' + diffs.join(',') : '6종 × 3필드 전수 일치');

        // ③ 의미 일관 검산(실DB): 규칙 신설분이 닿는 행 = 선물용 2건뿐인지 재확인
        const { Client } = require('pg');
        const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await c.connect();
        const r = await c.query(`SELECT count(*)::int n FROM box_movements m JOIN box_inventory i ON i.product_name=m.product_name
            WHERE m.date=i.base_date AND m.created_at > i.updated_at`);
        ok('신규 규칙 적용 대상 = 정확히 2건(선물용)', r.rows[0].n === 2, r.rows[0].n + '건');
        await c.end();
    } catch (err) {
        ok('실행', false, String(err.message || err));
    } finally {
        try { if (srv) srv.kill(); } catch (_) { }
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        process.exitCode = pass === results.length ? 0 : 1;
        setTimeout(() => process.exit(process.exitCode), 500);
    }
})();

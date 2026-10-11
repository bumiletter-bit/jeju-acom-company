// 검증: 검증 스크립트가 실DB 송장 표에 넣는 시험 송장(운송장 9996…)은 배송조회 화면·셈·CJ 조회 대상에 비치지 않는다(server.js DELIVERY_TEST_TR_PREFIX · deliveryNoTestSql 한 곳)
//   로컬 서버(포트 PORT649 · 없으면 3466 · 스케줄러 막음) · 브라우저 없음. 실DB 쓰기 = 시험 송장 한 줄(9996000649…)을 실제 송장이 있는 가장 최근 발송일에 넣었다가 지움.
//   실행: node scripts/verify-649-delivery-test-tr.js
require('dotenv').config(); const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'); const jwt = require('jsonwebtoken'); const { Client } = require('pg');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT649 || 3466); const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + String(d).slice(0, 240) : '')); };
(async () => {
    const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    ok(/const DELIVERY_TEST_TR_PREFIX = '9996';/.test(SRC) && (SRC.match(/\$\{deliveryNoTestSql\(/g) || []).length === 5, '규칙 한 곳(DELIVERY_TEST_TR_PREFIX = 9996) · 쓰는 자리 5곳(CJ 조회 대상 · 기간 건수 · 요약 · 목록 · 기간 밖 안내)', String((SRC.match(/\$\{deliveryNoTestSql\(/g) || []).length));
    const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: 'ignore' });
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); const TR = '999600064901';
    try {
        let up = false; for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/track-order`); if (r.status) { up = true; break; } } catch (_) { } }
        if (!up) throw new Error('로컬 서버가 안 떴어요');
        await db.connect();
        const real9996 = (await db.query(`SELECT count(*)::int n FROM delivery_shipments WHERE tracking LIKE '9996%' AND COALESCE(source, '') NOT LIKE 'verify%'`)).rows[0].n;
        ok(real9996 === 0, '실제 송장 가운데 9996 으로 시작하는 운송장 0(거름이 실제 줄을 가리지 않음)', String(real9996));
        const D = ((await db.query(`SELECT ship_date::text d FROM delivery_shipments WHERE tracking NOT LIKE '9996%' ORDER BY ship_date DESC LIMIT 1`)).rows[0] || {}).d;
        if (!D) throw new Error('실제 송장 줄이 없어요');
        const tok = jwt.sign({ id: 990649, name: '시험649', position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '10m' });
        const get = async u => (await fetch(`http://localhost:${PORT}${u}`, { headers: { Authorization: 'Bearer ' + tok, Connection: 'close' } })).json();
        const before = await get(`/api/delivery/summary?from=${D}&to=${D}`);
        await db.query(`DELETE FROM delivery_shipments WHERE tracking = $1`, [TR]);
        await db.query(`INSERT INTO delivery_shipments (tracking, ship_date, partner, recipient, phone, source) VALUES ($1, $2::date, '시험거래처649', '시험육사구', '09996490001', 'verify-649')`, [TR, D]);
        const after = await get(`/api/delivery/summary?from=${D}&to=${D}`);
        ok(before.ok && after.ok && before.shipments > 0 && after.shipments === before.shipments && !JSON.stringify(after).includes('시험거래처649') && !JSON.stringify(after).includes(TR), `요약(${D}): 시험 송장을 넣어도 건수 그대로(${before.shipments}) · 거래처·운송장 글자 0`, before.shipments + ' → ' + after.shipments);
        const byName = await get(`/api/delivery/list?from=${D}&to=${D}&q=${encodeURIComponent('시험육사구')}`), byTr = await get(`/api/delivery/list?from=${D}&to=${D}&q=${TR}`), byTail = await get(`/api/delivery/list?from=${D}&to=${D}&q=0001`);
        ok(byName.total === 0 && (byName.rows || []).length === 0 && !byName.outside && byTr.total === 0 && !(byTail.rows || []).some(x => x.tracking === TR), '목록: 이름·운송장·끝 4자리로 찾아도 시험 송장 안 나옴 · 「다른 날짜에 있어요」 안내도 없음', JSON.stringify({ n: byName.total, o: byName.outside, t: byTr.total }));
        const real = await get(`/api/delivery/list?from=${D}&to=${D}&limit=3`);
        ok((real.rows || []).length === 3 && real.rows.every(x => !String(x.tracking).startsWith('9996')), '실제 송장 목록은 그대로 나옴');
    } catch (e) { fail++; console.log('  ✗ 중단: ' + (e && e.stack || e)); }
    finally {
        try { await db.query(`DELETE FROM delivery_shipments WHERE tracking = $1 AND source = 'verify-649'`, [TR]); ok((await db.query(`SELECT count(*)::int n FROM delivery_shipments WHERE source = 'verify-649'`)).rows[0].n === 0, '정리: 시험 송장 줄 지움'); } catch (e) { fail++; console.log('  ✗ 정리 실패: ' + e.message); }
        await db.end().catch(() => { }); srv.kill();
    }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();

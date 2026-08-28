// #419 검증: 쿠팡 성함·안심번호 DB 저장 → 재시작 후에도 표시 (2026-08-28)
// 실DB + 로컬 실서버(3457·스케줄러 차단·JWT_SECRET=verifytest)로 표시 경로 2종(GET·enrich)을 실측.
// 테스트 행은 어제 날짜(cp:test419*)로 넣어 오늘 요약 무영향 — 종료 시 물리 삭제(테스트 전용 행).
require('dotenv').config();
const { Client } = require('pg');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const PORT = 3457;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    let srv = null;
    try {
        // ── 0. 실삽입 검산 (grep 계열 — 코드에 실제로 들어갔는지)
        const src = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
        ok('컬럼 추가(initDB) 4곳', (src.match(/ADD COLUMN IF NOT EXISTS cp_(name|tel)/g) || []).length === 4);
        ok('수집기 저장 2곳(주문안내·발송안내)', (src.match(/SET cp_name=COALESCE\(cp_name,\$2\), cp_tel=COALESCE\(cp_tel,\$3\)/g) || []).length >= 4, '수집기2+러너2');
        ok('nlogFetchTels 쿠팡 DB 시딩', /cpNeed = orderKeys\.filter\(k => \/\^cp:\//.test(src));
        ok('백필 러너(cp_name_backfill_request)', src.includes(`naverCfgGet('cp_name_backfill_request')`) && src.includes(`'cp_name_backfill_result'`));

        // ── 1. 단위: nlogFmtTel 12자리(안심번호) 포맷 — 실코드 추출 실행
        const m = src.match(/const nlogFmtTel = \(t\) => \{.*?\};/s);
        const fmt = eval('(' + m[0].replace('const nlogFmtTel = ', '').replace(/;\s*$/, '') + ')');
        ok('fmt 12자리(0505) = 4-4-4', fmt('050512345678') === '0505-1234-5678', fmt('050512345678'));
        ok('fmt 11자리 무회귀', fmt('01066874031') === '010-6687-4031');
        ok('fmt 10자리 무회귀', fmt('0212345678') === '02-1234-5678' || fmt('0212345678') === '021-234-5678', fmt('0212345678'));

        // ── 2. 테스트 행 삽입 (어제 날짜 — 오늘 요약 무영향)
        const yd = new Date(Date.now() - 86400000);
        const ydate = new Date(yd.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);   // KST 어제
        await db.query(`DELETE FROM kakao_notify_log WHERE order_key LIKE 'cp:test419%'`);
        await db.query(`DELETE FROM lms_guide_log WHERE order_key LIKE 'cp:test419%'`);
        // 컬럼이 아직 없을 수 있으니(서버 첫 기동 전) 먼저 서버를 띄워 initDB를 통과시킨 뒤 삽입한다.
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: require('path').join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        let srvLog = '';
        srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
        let up = false;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { }
            if (srv.exitCode !== null) break;
        }
        ok('로컬 실서버 기동', up, up ? '' : srvLog.slice(-300));
        if (!up) throw new Error('서버 기동 실패');

        await db.query(`INSERT INTO kakao_notify_log (order_key, product_name, receiver_masked, message, mode, status, confirm_status, created_at, order_at, cp_name, cp_tel)
            VALUES ('cp:test419a','[검증419] 감귤','0505****5678','(검증용)','dry-run','dry-run','none',$1,$1,'홍길동','050512345678')`, [yd]);
        await db.query(`INSERT INTO lms_guide_log (order_key, product_name, receiver_masked, message, mode, status, created_at, order_at, cp_name, cp_tel)
            VALUES ('cp:test419b','[검증419] 황금향','0505****1111','(검증용)','dry-run','dry-run',$1,$1,'김제주','050598761111')`, [yd]);

        const token = jwt.sign({ id: 1, name: 'verify419' }, 'verifytest', { expiresIn: '10m' });
        const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

        // ── 3. GET(종전 동기 경로): DB 저장분으로 성함·번호가 채워지는가 (서버는 방금 기동 = 캐시 0 — 재시작 상황 그대로)
        const g = await (await fetch(`http://localhost:${PORT}/api/agent-office/notify-logs?from=${ydate}&to=${ydate}&limit=100`, { headers: H })).json();
        const ra = (g.rows || []).find(r => r.order_key === 'cp:test419a');
        const rb = (g.rows || []).find(r => r.order_key === 'cp:test419b');
        ok('GET: 주문안내 행 성함', !!ra && ra.buyer_name === '홍길동', ra && (ra.buyer_name || '(없음)'));
        ok('GET: 주문안내 행 안심번호 풀표시', !!ra && ra.receiver_full === '0505-1234-5678', ra && (ra.receiver_full || '(없음)'));
        ok('GET: 발송안내 단독 행 성함·번호', !!rb && rb.buyer_name === '김제주' && rb.receiver_full === '0505-9876-1111', rb && (rb.receiver_full || '(없음)'));

        // ── 4. enrich(후채움 경로 — fast=1 화면이 쓰는 길): 같은 키로 성함·번호 공급되는가
        const e = await (await fetch(`http://localhost:${PORT}/api/agent-office/notify-logs/enrich`, {
            method: 'POST', headers: H, body: JSON.stringify({ orderKeys: ['cp:test419a', 'cp:test419b'] }) })).json();
        const ta = (e.tels || {})['cp:test419a'], tb = (e.tels || {})['cp:test419b'];
        ok('enrich: 성함·번호 공급', !!ta && ta.name === '홍길동' && ta.tel === '0505-1234-5678' && !!tb && tb.name === '김제주',
            JSON.stringify({ ta, tb }).slice(0, 120));

        // ── 5. 무회귀: 같은 응답에서 비쿠팡 행 정상(에러 없이 조회·cp 컬럼 미주입) + 저장값 미변조
        const nonCp = (g.rows || []).filter(r => r.order_key && !/^cp:/.test(r.order_key));
        ok('무회귀: 비쿠팡 행 조회 정상', Array.isArray(g.rows) && g.summary && typeof g.total === 'number', `어제 행 ${g.rows.length}건(비쿠팡 ${nonCp.length})`);
        const chk = await db.query(`SELECT cp_name, cp_tel, receiver_masked FROM kakao_notify_log WHERE order_key='cp:test419a'`);
        ok('무회귀: DB 마스킹 컬럼 종전 유지', chk.rows[0].receiver_masked === '0505****5678' && chk.rows[0].cp_name === '홍길동');
        // 비쿠팡(네이버·자사몰) 행에는 cp 값이 없어야 함 — nlogFetchTels 시딩이 cp: 키에만 한정됐는지 실DB로 검산
        const leak = await db.query(`SELECT count(*) n FROM kakao_notify_log WHERE order_key NOT LIKE 'cp:%' AND (cp_name IS NOT NULL OR cp_tel IS NOT NULL)`);
        ok('무회귀: 비쿠팡 행 cp 컬럼 오염 0', Number(leak.rows[0].n) === 0, `오염 ${leak.rows[0].n}건`);
    } catch (err) {
        ok('실행', false, String(err.message || err));
    } finally {
        try { await db.query(`DELETE FROM kakao_notify_log WHERE order_key LIKE 'cp:test419%'`); } catch (_) { }
        try { await db.query(`DELETE FROM lms_guide_log WHERE order_key LIKE 'cp:test419%'`); } catch (_) { }
        try { if (srv) srv.kill(); } catch (_) { }
        await db.end();
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        process.exit(pass === results.length ? 0 : 1);
    }
})();

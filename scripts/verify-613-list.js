// #613 배송조회 목록 찾기 칸(/api/delivery/list?q=) 규칙 검증 — 로컬 서버(JWT_SECRET=local613 · setInterval 차단 · 포트 PORT613 · 없으면 3466) · 실DB SELECT 만(쓰기 0)
//   규칙: 숫자만(하이픈·공백·괄호 허용) 4자리 또는 10~11자리 = 받는 분 연락처 끝 4자리 일치(4자리) · 10~11자리와 050 으로 시작하는 12자리 = 번호 전체 일치 · 그 밖 5자리 이상 = 운송장 일부/전체 · 글자 = 받는 분 이름(공백 무시)
//   사용: node scripts/verify-613-list.js   · 출력에 손님 전체 번호·주소를 찍지 않는다(끝 4자리만)
require('dotenv').config();
const path = require('path'); const { spawn } = require('child_process'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..'); const PORT = Number(process.env.PORT613 || 3466), BASE = 'http://127.0.0.1:' + PORT, JWT = 'local613';
const FROM = '2026-10-06', TO = '2026-10-07';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIG = "regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g')";
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ ') + name + (extra && !c ? '  → ' + extra : '')); };
const tails = rows => rows.map(r => r.phone_tail).sort().join(',');
const trOf = r => String((r && r.tracking) || '').replace(/[^0-9]/g, '');

(async () => {
    const srv = spawn(process.execPath, ['-e', "global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');"],
        { cwd: ROOT, env: { ...process.env, JWT_SECRET: JWT, PORT: String(PORT) }, stdio: ['ignore', 'ignore', process.env.V613_LOG ? 'inherit' : 'ignore'] });
    try {
        let up = false;
        for (let i = 0; i < 90 && !up; i++) { await sleep(1000); up = await fetch(BASE + '/api/delivery/list').then(r => r.status === 401 || r.status === 400 || r.status === 403, () => false); }
        if (!up) throw new Error('로컬 서버가 안 떴어요(포트 ' + PORT + ')');
        const token = jwt.sign({ id: 1, username: 'v613', name: '검증613', role: 'admin' }, JWT);
        const list = async q => {
            const u = BASE + '/api/delivery/list?from=' + FROM + '&to=' + TO + '&limit=1000&q=' + encodeURIComponent(q);
            for (let i = 0; ; i++) { try { const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token } }); return await r.json(); } catch (e) { if (i >= 3) throw new Error(e.message + ' ' + ((e.cause && e.cause.code) || '')); await sleep(1500); } }
        };
        const sum = j => 'total ' + j.total + ' · 끝자리 ' + tails(j.rows || []) + (j.error ? ' · ' + j.error : '');
        const cnt = async (cond) => (await pool.query('SELECT count(*)::int n FROM delivery_shipments WHERE ship_date BETWEEN $1 AND $2 AND ' + cond, [FROM, TO])).rows[0].n;

        console.log('① 이름');
        const a = await list('이수현');
        ok(a.ok && a.total === 4 && tails(a.rows) === '1740,2082,4575,8920' && a.rows.every(r => r.recipient.replace(/\s/g, '') === '이수현'), '「이수현」 → 4건(끝 1740·2082·4575·8920)', sum(a));

        console.log('② 끝 4자리');
        const b = await list('8920'); const b0 = (b.rows || [])[0] || {};
        ok(b.ok && b.total >= 1 && b.rows.every(r => r.phone_tail === '8920') && b.rows.some(r => /가평/.test(r.region)), '「8920」 → 끝 4자리가 8920 인 줄만(가평 건 포함 · ' + b.total + '건)', sum(b) + ' · ' + (b.rows || []).map(r => r.region).join('/'));
        const dbTail = await cnt('right(' + DIG + ", 4) = '8920'");
        ok(b.total === dbTail, '끝 4자리 건수 = DB 직접 셈(끝 4자리 일치만 · 가운데·운송장에 든 8920 은 안 잡음)', 'api ' + b.total + ' / db ' + dbTail);
        console.log('    (참고: 번호·운송장 어디든 8920 이 든 줄 = ' + await cnt("(tracking LIKE '%8920%' OR " + DIG + " LIKE '%8920%')") + '건)');

        console.log('③ 전체 번호');
        const ph = await pool.query('SELECT ' + DIG + ' d FROM delivery_shipments WHERE ship_date BETWEEN $1 AND $2 AND right(' + DIG + ", 4) = '8920' AND addr LIKE '%가평%' LIMIT 1", [FROM, TO]);
        const d = ph.rows[0] ? ph.rows[0].d : ''; const same = j => j.ok && j.total === 1 && j.rows[0].phone_tail === '8920' && /가평/.test(j.rows[0].region);
        if (d.length >= 10 && d.length <= 11) {
            const mid = d.slice(3, d.length - 4), hy = d.slice(0, 3) + '-' + mid + '-' + d.slice(-4);
            const c1 = await list(hy), c2 = await list(d), c3 = await list('(' + d.slice(0, 3) + ') ' + mid + ' ' + d.slice(-4));
            ok(same(c1), '하이픈 넣은 전체 번호(···-····-8920) → 가평 1건만(끝자리 같은 다른 분은 안 나옴)', sum(c1));
            ok(same(c2), '숫자만 ' + d.length + '자리 전체 번호 → 가평 1건만(끝자리 같은 다른 분은 안 나옴)', sum(c2));
            ok(same(c3), '괄호·공백 섞은 전체 번호 → 가평 1건만(끝자리 같은 다른 분은 안 나옴)', sum(c3));
        } else ok(false, '끝 8920 줄의 번호가 10~11자리가 아님(' + d.length + '자리) — 전체 번호 시험 못 함');

        const sf = await pool.query('SELECT ' + DIG + ' d, count(*)::int n FROM delivery_shipments WHERE ship_date BETWEEN $1 AND $2 AND ' + DIG + " ~ '^050[0-9]{9}$' GROUP BY 1 ORDER BY 2, 1 LIMIT 1", [FROM, TO]);
        if (sf.rows[0]) { const sd = sf.rows[0].d, s1 = await list(sd), s2 = await list(sd.slice(0, 4) + '-' + sd.slice(4, 8) + '-' + sd.slice(8));
            ok(s1.ok && s1.total === sf.rows[0].n && s1.rows.every(r => r.phone_tail === sd.slice(-4)), '안심번호 12자리(050…) 전체 → 그 번호 줄만(' + sf.rows[0].n + '건 · 운송장 갈래로 안 감)', sum(s1));
            ok(s2.ok && s2.total === sf.rows[0].n, '안심번호 하이픈 꼴 → 같은 ' + sf.rows[0].n + '건', sum(s2)); }
        else console.log('    (기간 안에 050 12자리 안심번호 줄 없음 — 건너뜀)');
        const x1 = d.length >= 10 ? await list(d.slice(0, -1) + (d.slice(-1) === '0' ? '1' : '0')) : { total: -1 };
        ok(x1.total === 0, '끝 한 자리만 다른 전체 번호 → 0건(전체 일치)', sum(x1));

        console.log('④⑤ 운송장');
        const e1 = await list('6007-5084-3516'), e2 = await list('600750843516'), e3 = await list('50843516'), e4 = await list('60075');
        ok(e1.ok && e1.total === 1 && trOf(e1.rows[0]) === '600750843516', '「6007-5084-3516」 → 1건', sum(e1));
        ok(e2.ok && e2.total === 1 && trOf(e2.rows[0]) === '600750843516', '「600750843516」 → 1건', sum(e2));
        ok(e3.ok && e3.total >= 1 && e3.rows.every(r => trOf(r).includes('50843516')), '운송장 일부 8자리 「50843516」 → 그 운송장만(' + e3.total + '건)', sum(e3));
        const dbPre = await cnt("tracking LIKE '%60075%'");
        ok(e4.ok && e4.total === dbPre && (e4.rows || []).every(r => trOf(r).includes('60075')), '5자리 「60075」 = 운송장 포함만(DB 직접 셈 ' + dbPre + '건)', sum(e4).slice(0, 60));

        console.log('⑥ 공백 섞은 이름');
        const f = await list(' 이 수현 ');
        ok(f.ok && f.total === 4 && tails(f.rows) === tails(a.rows), '「 이 수현 」 → ①과 같은 4건', sum(f));

        console.log('⑦ 없는 값');
        const g1 = await list('없는이름검증613'), g2 = await list('0000'), g3 = await list('999999999999');
        const db0 = await cnt('right(' + DIG + ", 4) = '0000'");
        ok(g1.ok && g1.total === 0 && g1.rows.length === 0, '없는 이름 → 0건', sum(g1));
        ok(g2.ok && g2.total === db0, '「0000」 = DB 직접 셈(' + db0 + '건)', sum(g2));
        ok(g3.ok && g3.total === 0, '없는 운송장 12자리 → 0건', sum(g3));

        console.log('⑧ 완료 건의 event_time');
        const all = await list('');
        const done = (all.rows || []).filter(r => /완료/.test(r.bucket));
        const withT = done.filter(r => r.event_time && /\d{4}-\d{2}-\d{2}|\d{1,2}[.\/]\d{1,2}/.test(String(r.event_time)));
        ok(done.length > 0 && withT.length === done.length, '완료 건 전부에 event_time(날짜 든 글자) 있음', '완료 ' + done.length + ' · 있음 ' + withT.length);
        console.log('    (완료 ' + done.length + '건 중 ' + withT.length + '건 · 보기 ' + JSON.stringify(done[0] && done[0].event_time) + ' · 전체 ' + all.total + '건 중 응답 ' + (all.rows || []).length + '줄)');
        const keys = Object.keys((all.rows || [])[0] || {});
        ok(!keys.includes('phone') && !keys.includes('addr') && keys.includes('phone_tail'), '응답 줄에 전체 번호·주소 칸 없음(phone_tail · region 만)', keys.join(','));
    } catch (e) { fail++; console.log('  ✗ 중단: ' + e.message); }
    finally { srv.kill(); await pool.end().catch(() => { }); }
    console.log('\n결과 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0);
})();

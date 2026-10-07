// #579 DB 쌓임 대비 검증 — 로컬 서버(3462 · 스케줄러 막음) + 실DB 읽기. 실DB 에 남는 것 = 인덱스 2개(initDB · 되돌릴 수 있음)뿐.
//   정리 작업은 「쓰기 가로채기」로만 돌린다: 설정이 없으면 쓰기 문장 0 · 켠 경우도 문장을 실행하지 않고 EXPLAIN(계획만)으로 문법을 본 뒤 ROLLBACK.
//   node scripts/verify-579-db.js            (손님 정보 출력 없음)
const { spawn } = require('child_process'); const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..'), PORT = 3462, BASE = 'http://localhost:' + PORT, SECRET = 'verifytest';
const { pool } = require('./desk/_db.js'); const jwt = require('jsonwebtoken');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (from, to) => { const a = SRC.indexOf(from); if (a < 0) throw new Error('표식 없음: ' + from); const b = SRC.indexOf(to, a + from.length); if (b < 0) throw new Error('끝 표식 없음: ' + to); return SRC.slice(a, b); };
const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ── 종전 박스재고 계산(고치기 전 코드 그대로 — 정산 날짜마다 단가표를 따로 조회) : 기준값
function oldBox(pool, normDateSafe) {
    async function getBoxTypeMapFor(partner, dateStr) {
        const pr = await pool.query(`SELECT items FROM pricing WHERE partner = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY id ASC`, [partner, dateStr]);
        const boxTypeMap = {};
        pr.rows.forEach(r => (r.items || []).forEach(p => { if (p.boxType && p.boxType !== '해당없음') boxTypeMap[p.name] = p.boxType; }));
        return { boxTypeMap, count: pr.rows.length };
    }
    return async function computeBoxStocks() {
        const invRes = await pool.query('SELECT id, product_name, company_stock, daesong_stock, hyodon_stock, base_date, updated_at FROM box_inventory ORDER BY id');
        const byName = {};
        invRes.rows.forEach(r => { byName[r.product_name] = { id: r.id, productName: r.product_name, company: Number(r.company_stock) || 0, daesong: Number(r.daesong_stock) || 0, hyodon: Number(r.hyodon_stock) || 0, baseDate: r.base_date ? normDateSafe(r.base_date) : null, updatedAt: r.updated_at }; });
        const movs = await pool.query('SELECT product_name, movement_type, qty, date, created_at FROM box_movements');
        for (const m of movs.rows) {
            const box = byName[m.product_name]; if (!box) continue;
            const d = normDateSafe(m.date);
            if (box.baseDate && !(d > box.baseDate)) { const sameDayAfterEdit = d === box.baseDate && m.created_at && box.updatedAt && new Date(m.created_at) > new Date(box.updatedAt); if (!sameDayAfterEdit) continue; }
            const q = Number(m.qty) || 0;
            if (m.movement_type === 'order') box.company += q; else if (m.movement_type === 'transfer_hyodon') { box.company -= q; box.hyodon += q; } else { box.company -= q; box.daesong += q; }
        }
        for (const { partner, field } of [{ partner: '대성(시온)', field: 'daesong' }, { partner: '효돈농협', field: 'hyodon' }]) {
            const setts = await pool.query('SELECT date, items FROM settlements WHERE partner = $1 ORDER BY date', [partner]);
            const mapCache = {};
            for (const s of setts.rows) {
                const d = normDateSafe(s.date);
                const items = (typeof s.items === 'string' ? JSON.parse(s.items) : s.items) || [];
                if (items.length === 0) continue;
                if (!(d in mapCache)) mapCache[d] = (await getBoxTypeMapFor(partner, d)).boxTypeMap;
                const btMap = mapCache[d];
                for (const it of items) { const bt = btMap[it.name]; if (!bt) continue; const box = byName[bt]; if (!box) continue; if (box.baseDate && !(d > box.baseDate)) continue; box[field] -= (Number(it.qty) || 0); }
            }
        }
        return Object.values(byName);
    };
}
// 조회 횟수를 세는 pool
const counting = (real) => { const o = { n: 0, query: (s, p) => { o.n++; return real.query(s, p); } }; return o; };

(async () => {
    // ───────── A. 박스재고 구/신 동일(실코드를 떼어 실행 · 실DB 읽기)
    console.log('A. 박스재고 계산 — 종전과 값이 같은지');
    const normSrc = cut('function normDateSafe(d) {', '\n// 품목명에서');
    const mapSrc = cut('async function getBoxTypeMapFor(partner, dateStr) {', '\n// [A안 폐기]');
    const boxSrc = cut('async function computeBoxStocks() {', "\napp.get('/api/box-inventory'");
    const mk = new Function('pool', normSrc + '\n' + mapSrc + '\n' + boxSrc + '\nreturn { computeBoxStocks, getBoxTypeMapFor, getBoxTypeMapsForDates, normDateSafe };');
    const pNew = counting(pool), pOld = counting(pool);
    const N = mk(pNew);
    let t = performance.now(); const newOut = await N.computeBoxStocks(); const newMs = performance.now() - t;
    t = performance.now(); const oldOut = await oldBox(pOld, N.normDateSafe)(); const oldMs = performance.now() - t;
    const jn = JSON.stringify(newOut), jo = JSON.stringify(oldOut);
    ok(jn === jo, `구/신 결과 JSON 바이트 동일(${Buffer.byteLength(jn)}B · 박스 ${newOut.length}종)`);
    ok(newOut.some(b => b.daesong !== 0 || b.hyodon !== 0 || b.company !== 0), '값이 실제로 계산됨(전부 0 아님)');
    ok(pNew.n <= 8 && pOld.n > 50, `DB 조회 횟수 ${pOld.n}번 → ${pNew.n}번`);
    console.log(`     이 PC → DB 직접 계산: 종전 ${Math.round(oldMs)}ms → 지금 ${Math.round(newMs)}ms`);
    // 날짜 묶음 맵 = 날짜 하나씩 조회한 맵과 같은가(거래처 2곳 · 정산 날짜 전부 + 단가표 경계일 ±1)
    let mapDays = 0;
    for (const partner of ['대성(시온)', '효돈농협']) {
        const ds = new Set((await pool.query(`SELECT to_char(date,'YYYY-MM-DD') d FROM settlements WHERE partner=$1`, [partner])).rows.map(r => r.d));
        for (const r of (await pool.query(`SELECT to_char(start_date,'YYYY-MM-DD') s, to_char(end_date,'YYYY-MM-DD') e, to_char(start_date - 1,'YYYY-MM-DD') s0, to_char(end_date + 1,'YYYY-MM-DD') e1 FROM pricing WHERE partner=$1`, [partner])).rows) [r.s, r.e, r.s0, r.e1].forEach(d => ds.add(d));
        const dates = [...ds].sort(); const many = await N.getBoxTypeMapsForDates(partner, dates); let diff = 0, nonEmpty = 0;
        for (const d of dates) { const one = (await N.getBoxTypeMapFor(partner, d)).boxTypeMap; if (JSON.stringify(one) !== JSON.stringify(many[d])) diff++; if (Object.keys(one).length) nonEmpty++; }
        // 박스를 안 고른 거래처는 매핑 0 이 정상(품목마다 고른 설정대로 — 대표 9/29) → 「같은가」만 본다
        ok(diff === 0, `${partner}: 날짜 ${dates.length}개(경계일 포함) 박스 매핑이 하나씩 조회한 것과 같음(매핑 있는 날 ${nonEmpty}) · 다른 날 ${diff}`);
        mapDays += nonEmpty;
    }
    ok(mapDays > 0, `박스 매핑이 실제로 있는 날로 비교함(${mapDays}일)`);

    // ───────── C. 보관 정리 — 쓰기 가로채기
    console.log('C. 보관 정리 작업(실코드 구간을 떼어 실행 · 쓰기 문장은 실행하지 않고 가로챔)');
    const RET = cut('// ===== #579 DB 보관 정리 — 시작', '// ===== #579 DB 보관 정리 — 끝');
    const mkRet = (poolX, store, audits) => new Function('pool', 'naverCfgGet', 'naverCfgSet', 'writeAudit', 'setInterval', 'console',
        RET + '\nreturn { dbRetentionCfg, dbRetentionCount, dbRetentionArchive, dbRetentionRunJob, dbRetentionTick, dbSizeWeeklyLine, DB_RET_BATCH, DB_RET_ROUNDS, queue: () => _dbRetQueue.map(q => q.job) };')(
        poolX, async k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null), async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, async a => { audits.push(a); }, () => ({}), { log() { }, error(...a) { console.log('     (오류 로그)', ...a); } });
    const guard = (writes, mode) => ({ query: async (sql, p) => { const s = String(sql).trim(); if (/^(SELECT|EXPLAIN)\b/i.test(s)) return pool.query(sql, p); writes.push(s.replace(/\s+/g, ' ')); return { rows: [], rowCount: (mode && mode.rc) || 0 }; } });
    const AT = (h, m, dayShift = 0) => Date.UTC(2026, 9, 8 + dayShift, h - 9, m);   // KST 2026-10-08 h:m
    {   // ① 설정 행 없음
        const writes = [], store = {}, audits = []; const R = mkRet(guard(writes), store, audits);
        ok((await R.dbRetentionTick(AT(3, 39))) === null && !store.db_retention_last, '03:40(KST) 전에는 아무것도 안 함');
        const r = await R.dbRetentionTick(AT(4, 0));
        ok(r && r.counted && r.enabled === false && r.queued.length === 0, '설정 행 없음 → 세기만(enabled false · 할 일 0)');
        const L = store.db_retention_last;
        ok(L && L.date === '2026-10-08' && L.enabled === false && L.targets && typeof L.targets.report.n === 'number' && typeof L.targets.image.bytes === 'number' && L.targets.db_bytes > 1e6, `db_retention_last 에 대상 기록(보고서 파일 ${L.targets.report.n}건 · 지시 첨부 ${L.targets.image.n}건 ${Math.round(L.targets.image.bytes / 1024)}KB · 알림 이력 ${L.targets.logs.kakao_notify_log}+${L.targets.logs.lms_guide_log}행)`);
        ok(Array.isArray(store.db_size_log) && store.db_size_log.length === 1 && store.db_size_log[0].d === '2026-10-08' && store.db_size_log[0].b === L.targets.db_bytes, 'db_size_log 에 오늘 크기 한 줄');
        for (let i = 1; i <= 6; i++) await R.dbRetentionTick(AT(4, i));
        ok(writes.length === 0 && audits.length === 0, `설정 없을 때 쓰기 문장 0(가로챈 것 ${writes.length} · 감사 기록 ${audits.length}) — 틱 7번`);
        const r2 = await R.dbRetentionTick(AT(4, 0, 1));
        ok(r2 && r2.counted && store.db_size_log.length === 2, '다음 날 다시 한 번 셈(크기 기록 2줄)');
    }
    {   // ② enabled:false 를 명시 · 이상한 값
        const writes = [], store = { db_retention: { enabled: 'true', report_days: 1, image_days: 0, log_days: 3 } }, audits = []; const R = mkRet(guard(writes), store, audits);
        const c = R.dbRetentionCfg(store.db_retention);
        ok(c.enabled === false && c.report_days === 90 && c.image_days === 30 && c.log_days === 365, `글자 'true'·너무 짧은 날 수는 무시(꺼짐 · ${c.report_days}/${c.image_days}/${c.log_days}일)`);
        ok(R.dbRetentionCfg(null).enabled === false && R.dbRetentionCfg({ enabled: true, report_days: 120 }).report_days === 120 && R.dbRetentionCfg({ enabled: true }).enabled === true, '설정 읽기: 없음 = 꺼짐 · true 만 켜짐 · 날 수 바꾸기');
        await R.dbRetentionTick(AT(4, 0)); for (let i = 1; i <= 4; i++) await R.dbRetentionTick(AT(4, i));
        ok(writes.length === 0, '켜짐이 아니면 쓰기 문장 0');
        ok((await R.dbRetentionRunJob('report', c)) === 0 && (await R.dbRetentionRunJob('image', c)) === 0 && (await R.dbRetentionRunJob('log:kakao_notify_log', c)) === 0 && writes.length === 0, '실행 함수도 꺼짐이면 0(겹 잠금)');
    }
    {   // ③ 켠 경우(가로채기 — 실행 안 함) : 한 틱 1개 · 이어서 · 하루 상한 · 중간에 끄면 멈춤
        const writes = [], store = { db_retention: { enabled: true } }, audits = [], mode = { rc: 0 }; const R = mkRet(guard(writes, mode), store, audits);
        const r = await R.dbRetentionTick(AT(4, 0));
        const want = []; if (r.targets.report.n > 0) want.push('report'); if (r.targets.image.n > 0) want.push('image'); for (const tb of ['kakao_notify_log', 'lms_guide_log']) if (r.targets.logs[tb] > 0) want.push('log:' + tb);
        ok(r.enabled === true && JSON.stringify(r.queued) === JSON.stringify(want) && writes.length === 0, `켜면 대상이 있는 일만 줄 세움(${want.join(', ') || '없음'}) · 세는 틱에서는 쓰기 0`);
        if (want.includes('image')) {
            mode.rc = R.DB_RET_BATCH.image;   // 매번 한도만큼 지워진 것처럼 → 이어서 돌되 하루 상한에서 멈춰야 한다
            let ticks = 0; while (R.queue().length && ticks < 200) { const before = writes.length; await R.dbRetentionTick(AT(4, 1)); ticks++; if (writes.length - before > 1) { ok(false, '한 틱에 쓰기 문장 2개 이상'); break; } }
            const img = writes.filter(s => /^UPDATE pending_orders SET image_data = NULL/.test(s));
            ok(img.length === R.DB_RET_ROUNDS && /LIMIT 200\)$/.test(img[0]) && /status = ANY\(\$2::text\[\]\)/.test(img[0]), `지시 첨부: 한 틱 1문장 · 200행씩 · 하루 최대 ${R.DB_RET_ROUNDS}번(${img.length}번에서 멈춤)`);
            ok(writes.every(s => !/^DELETE|DROP |TRUNCATE/i.test(s)) && writes.every(s => !/content|result/.test(s.split('WHERE')[0])), '지우는 것은 image_data 칸뿐(행 삭제·다른 칸 변경 없음)');
            ok(audits.length === img.length && audits[0].source === 'db_retention' && store.db_retention_last.done.image === R.DB_RET_BATCH.image * R.DB_RET_ROUNDS, '한 번 할 때마다 감사 기록 + db_retention_last.done 누적');
        } else console.log('     (지시 첨부 대상 0건 — 이어 돌기 시험 생략)');
        // 중간에 끄면 멈춤
        const writes2 = [], store2 = { db_retention: { enabled: true, image_statuses: ['완료', '취소', '질문종결'] } }, mode2 = { rc: 200 }; const R2 = mkRet(guard(writes2, mode2), store2, []);
        const q = await R2.dbRetentionTick(AT(4, 0)); await R2.dbRetentionTick(AT(4, 1)); const n1 = writes2.length;
        store2.db_retention.enabled = false; const st = await R2.dbRetentionTick(AT(4, 2)); await R2.dbRetentionTick(AT(4, 3));
        ok(q.queued.length ? (n1 === 1 && st && st.stopped && writes2.length === 1 && R2.queue().length === 0) : true, '돌던 중에 설정을 끄면 다음 틱부터 멈춤(남은 일 버림)');
    }
    {   // ④ 문장이 실DB 에서 말이 되는지 — 트랜잭션 안에서 보관표를 만들어 보고, 쓰기 문장은 EXPLAIN(계획만 · 실행 안 함), 끝에 ROLLBACK
        const c = await pool.connect(); const seen = [];
        try {
            await c.query('BEGIN');
            const tx = { query: async (sql, p) => { const s = String(sql).trim(); if (/^(WITH moved|UPDATE|DELETE|INSERT)/i.test(s)) { seen.push(s.replace(/\s+/g, ' ')); const r = await c.query('EXPLAIN ' + sql, p); return { rows: r.rows, rowCount: 0 }; } return c.query(sql, p); } };
            const R = mkRet(tx, {}, []); const cfg = R.dbRetentionCfg({ enabled: true });
            await R.dbRetentionRunJob('report', cfg); await R.dbRetentionRunJob('image', cfg);
            for (const tb of ['kakao_notify_log', 'lms_guide_log']) {
                await R.dbRetentionRunJob('log:' + tb, cfg);
                const a = (await c.query(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name=$1`, [tb + '_archive'])).rows[0].c.split(',');
                const s = (await c.query(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name=$1`, [tb])).rows[0].c.split(',');
                ok(s.every(x => a.includes(x)) && a.includes('archived_at'), `${tb}_archive: 원표 칸 ${s.length}개 전부 + archived_at(트랜잭션 안에서 만들어 봄)`);
                // 원표에 칸이 늘어난 경우 — 보관표에도 따라 붙는가
                await c.query(`ALTER TABLE ${tb} ADD COLUMN zz_verify579 INTEGER`);
                await R.dbRetentionArchive(tb, 365);
                ok((await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='zz_verify579'`, [tb + '_archive'])).rows.length === 1 && /"zz_verify579"/.test(seen[seen.length - 1]), '  원표에 칸이 늘면 보관표에도 같은 칸이 생기고 옮기는 문장에 들어감');
            }
            ok(seen.length === 6 && /^UPDATE report_files SET data = ''::bytea, purged_at = NOW\(\)/.test(seen[0]) && /^UPDATE pending_orders SET image_data = NULL/.test(seen[1]) && seen.slice(2).every(s => /^WITH moved AS \( DELETE FROM (kakao_notify_log|lms_guide_log) WHERE id IN \(SELECT id FROM \1 WHERE created_at < NOW\(\) - make_interval\(days => \$1::int\) ORDER BY id LIMIT 5000\) RETURNING .+\) INSERT INTO \1_archive \(/.test(s)), `쓰기 문장 ${seen.length}개 전부 실DB 에서 계획이 서는 문장(EXPLAIN 통과 · 실행 안 함)`);
        } finally { await c.query('ROLLBACK'); c.release(); }
        const left = (await pool.query(`SELECT to_regclass('public.kakao_notify_log_archive') a, to_regclass('public.lms_guide_log_archive') b, (SELECT count(*)::int FROM information_schema.columns WHERE column_name='zz_verify579') z`)).rows[0];
        ok(left.a === null && left.b === null && left.z === 0, 'ROLLBACK 뒤 실DB 에 남은 것 없음(보관표·시험 칸 0)');
    }
    {   // ⑤ 월요일 브리핑 줄
        const R = mkRet({ query: async () => ({ rows: [{ b: String(165 * 1048576) }] }) }, { db_size_log: [{ d: '2026-09-28', b: 140 * 1048576 }, { d: '2026-10-01', b: 145 * 1048576 }, { d: '2026-10-07', b: 160 * 1048576 }] }, []);
        const line = await R.dbSizeWeeklyLine('2026-10-08');
        ok(line === '💾 DB 165MB · 이번 주 +20MB', `7일 전 이전의 가장 가까운 기록과 비교: 「${line}」`);
        const R0 = mkRet({ query: async () => ({ rows: [{ b: String(145 * 1048576) }] }) }, {}, []);
        ok((await R0.dbSizeWeeklyLine('2026-10-08')) === '💾 DB 145MB', '기록이 없으면 크기만');
        const R1 = mkRet({ query: async () => ({ rows: [{ b: String(130 * 1048576) }] }) }, { db_size_log: [{ d: '2026-10-01', b: 145 * 1048576 }] }, []);
        ok((await R1.dbSizeWeeklyLine('2026-10-08')) === '💾 DB 130MB · 이번 주 −15MB', '줄었으면 −');
        const brief = cut('async function inquiryAlertTick() {', 'setInterval(inquiryAlertTick');
        ok(/getUTCDay\(\) === 1\) \{ try \{ lines\.push\(await dbSizeWeeklyLine\(todayKst\)\); \} catch/.test(brief) && brief.indexOf('dbSizeWeeklyLine') > brief.indexOf("lines.push('밤사이 특이사항 없음')") && brief.indexOf('dbSizeWeeklyLine') < brief.indexOf("alertText('briefing'"), '아침 브리핑: 월요일에만 · 「특이사항 없음」 판정 뒤 · 보내기 전에 한 줄(실패해도 브리핑은 나감)');
    }
    {   // 지금 실DB 기준 대상(읽기)
        const R = mkRet(pool, {}, []); const cur = await R.dbRetentionCount(R.dbRetentionCfg(null));
        console.log(`     ▶ 지금 지울 대상(기본 설정 90·30·365일): 보고서 파일 ${cur.report.n}건 ${(cur.report.bytes / 1048576).toFixed(1)}MB · 지시 첨부 ${cur.image.n}건 ${(cur.image.bytes / 1048576).toFixed(1)}MB · 알림 이력 ${cur.logs.kakao_notify_log}+${cur.logs.lms_guide_log}행 · DB ${Math.round(cur.db_bytes / 1048576)}MB`);
        const narrow = await R.dbRetentionCount(R.dbRetentionCfg({ image_statuses: ['완료'] }));
        console.log('     ▶ (참고) 「완료」만이면 지시 첨부 ' + narrow.image.n + '건 ' + (narrow.image.bytes / 1048576).toFixed(1) + 'MB');
        const dflt = R.dbRetentionCfg(null).image_statuses;
        ok(JSON.stringify(dflt) === JSON.stringify(['완료', '취소', '질문종결', '응답됨', '대체됨', '반려']) && !dflt.includes('승인됨') && !dflt.includes('오류확인'), '기본 상태 목록 = 끝난 상태 6종(승인됨·오류확인 제외)');
        ok(cur.report.n >= 0 && cur.image.n >= narrow.image.n && cur.image.n > 0, '대상 세기 실DB 실행됨(지시 첨부 ' + cur.image.n + '건)');
    }

    // ───────── B·E. 로컬 서버(initDB 가 인덱스를 만든다)
    const act = (await pool.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE is_deleted=false AND status IN ('처리중','확인표작성')`)).rows[0].c;
    if (act) { console.log('⚠ 처리 중인 지시가 있어 로컬 서버 대목(B·E)을 건너뜁니다 — 잠시 뒤 다시 실행'); fail++; }
    else {
        const ceo = (await pool.query(`SELECT id, name, username FROM users WHERE position='대표' AND role='admin' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const staff = (await pool.query(`SELECT id, name, username, position FROM users WHERE role<>'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(PORT) }, stdio: 'ignore' });
        try {
            let up = false; for (let i = 0; i < 90 && !up; i++) { await sleep(1000); try { const r = await fetch(BASE + '/api/agent-office/desk-status'); up = r.status === 401 || r.status === 200; } catch (_) { } }
            if (!up) throw new Error('로컬 서버 기동 실패');
            const HD = u => ({ Authorization: 'Bearer ' + jwt.sign({ id: u.id, name: u.name, username: u.username, position: u.position || '대표', role: u.position ? 'user' : 'admin' }, SECRET, { expiresIn: '30m' }), Connection: 'close' });
            const get = async (u, url) => { let r; const t0 = performance.now(); try { r = await fetch(BASE + url, { headers: HD(u) }); } catch (e) { await sleep(300); r = await fetch(BASE + url, { headers: HD(u) }); } const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { } return { s: r.status, j, ms: performance.now() - t0, txt }; };
            console.log('B. 박스재고 화면 응답 · 인덱스');
            const ts = []; let body = null; for (let i = 0; i < 6; i++) { const r = await get(ceo, '/api/box-inventory'); if (r.s !== 200) { ok(false, '/api/box-inventory ' + r.s); break; } ts.push(r.ms); body = r.j; }
            ok(ts.length === 6 && med(ts.slice(1)) < 2000, `/api/box-inventory 응답 중앙 ${Math.round(med(ts.slice(1)))}ms(첫 회 ${Math.round(ts[0])}ms · 목표 2000ms 이하 · 종전 직접 계산 ${Math.round(oldMs)}ms)`);
            const expect = oldOut.map(b => ({ id: b.id, productName: b.productName, companyStock: b.company, daesongStock: b.daesong, hyodonStock: b.hyodon, baseDate: b.baseDate, updatedAt: b.updatedAt }));
            ok(JSON.stringify(body) === JSON.stringify(expect), '화면이 받는 값 = 종전 계산 값(JSON 동일)');
            { const r = await get(staff, '/api/box-inventory'); ok(r.s === 200 && JSON.stringify(r.j) === JSON.stringify(expect), '직원 계정도 같은 값(' + r.s + ')'); }
            { const r = await get(ceo, '/api/box-inventory/history'); ok(r.s === 200, '입출고 현황 그대로 열림(' + r.s + ')'); }
            const idx = (await pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('pending_orders','kakao_notify_log','lms_guide_log')`)).rows;
            const has = n => idx.find(i => i.indexname === n);
            ok(has('idx_pending_orders_by') && /\(created_by_id, id\)/.test(has('idx_pending_orders_by').indexdef), '인덱스 pending_orders (created_by_id, id) 있음');
            ok(has('idx_pending_orders_reply') && /\(reply_to\)/.test(has('idx_pending_orders_reply').indexdef), '인덱스 pending_orders (reply_to) 있음');
            ok(has('idx_kakao_notify_log_created') && has('idx_lms_guide_log_created') && has('kakao_notify_log_order_key_key') && has('lms_guide_log_order_key_key'), '알림 이력 2종: 날짜(created_at)·주문번호(order_key) 인덱스는 이미 있음(추가 없음)');
            const plan = async (sql, p) => (await pool.query('EXPLAIN (ANALYZE, BUFFERS) ' + sql, p)).rows.map(r => r['QUERY PLAN']).join('\n');
            const busy = (await pool.query(`SELECT created_by_id FROM pending_orders WHERE created_by_id IS NOT NULL AND is_deleted=false GROUP BY 1 ORDER BY count(*) ASC LIMIT 1`)).rows[0].created_by_id;
            const p1 = await plan(`SELECT o.id FROM pending_orders o WHERE o.is_deleted = false AND o.created_by_id = $1 AND COALESCE(o.mine_hidden, false) = false ORDER BY o.id DESC LIMIT 60`, [busy]);
            const p2 = await plan(`SELECT MIN(c.id) FROM pending_orders c WHERE c.reply_to = $1 AND c.is_deleted = false`, [1300]);
            console.log('     내 지시 목록(지시가 가장 적은 계정):', (p1.match(/(Index[^\n]*|Seq Scan[^\n]*)/) || [''])[0].trim().slice(0, 110), '·', (p1.match(/Buffers: shared hit=\d+/) || [''])[0], '·', (p1.match(/Execution Time: [\d.]+ ms/) || [''])[0]);
            console.log('     이어서 보낸 글 찾기:', (p2.match(/(Index[^\n]*|Bitmap[^\n]*|Seq Scan[^\n]*)/) || [''])[0].trim().slice(0, 110), '·', (p2.match(/Buffers: shared hit=\d+/) || [''])[0], '·', (p2.match(/Execution Time: [\d.]+ ms/) || [''])[0]);
            ok(/idx_pending_orders_reply/.test(p2), '「이어서 보낸 글」 찾기가 새 인덱스를 탄다(종전 = 표 전체 훑기)');
            for (const [who, u] of [['대표', ceo], ['직원', staff]]) { const r = await get(u, '/api/agent-office/desk/orders?mine=1&limit=60'); const h = await get(u, '/api/agent-office/desk/orders?history=1&limit=60'); ok(r.s === 200 && Array.isArray(r.j.orders) && h.s === 200 && h.j.orders.length > 0, `${who} 채팅 목록 ${r.s}(${r.j.orders.length}건 · ${Math.round(r.ms)}ms) · 이력 ${h.s}(${h.j.orders.length}건 · ${Math.round(h.ms)}ms)`); }

            console.log('E. 알림 발송 이력 — 날짜를 안 고르면 최근 90일');
            const base = await get(ceo, '/api/agent-office/notify-logs?filter=all&ch=all&fast=1&limit=100&offset=0');
            const all = await get(ceo, '/api/agent-office/notify-logs?filter=all&ch=all&fast=1&limit=100&offset=0&all=1');
            const exp = (await pool.query(`SELECT count(*)::int n, count(*) FILTER (WHERE COALESCE(k.created_at, l.created_at) > NOW() - interval '90 days')::int n90 FROM kakao_notify_log k FULL OUTER JOIN lms_guide_log l ON k.order_key = l.order_key WHERE (k.id IS NULL OR k.deleted_at IS NULL)`)).rows[0];
            ok(base.s === 200 && base.j.default_days === 90 && base.j.total === exp.n90 && base.j.rows.length === 100, `날짜 없음: 최근 90일 ${base.j.total}건(DB 직접 ${exp.n90}) · default_days ${base.j.default_days} · ${Math.round(base.ms)}ms`);
            ok(all.s === 200 && all.j.default_days === 0 && all.j.total === exp.n, `all=1: 전체 ${all.j.total}건(DB 직접 ${exp.n})`);
            const key = r => r.order_key + '|' + r.k_id + '|' + r.l_id;
            ok(exp.n !== exp.n90 || JSON.stringify(base.j.rows.map(key)) === JSON.stringify(all.j.rows.map(key)), exp.n === exp.n90 ? '지금은 이력 전부가 90일 안 — 첫 장 100줄이 종전(전체)과 같은 줄·같은 순서' : '(90일 밖 이력이 있어 첫 장 비교 생략)');
            const D = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
            const rng = await get(ceo, `/api/agent-office/notify-logs?filter=all&ch=all&fast=1&limit=100&offset=0&from=2026-07-01&to=${D}`);
            ok(rng.s === 200 && rng.j.default_days === 0 && rng.j.total === exp.n, `날짜를 고르면 그 기간 그대로(7/1~오늘 ${rng.j.total}건 = 전체) · default_days 0`);
            for (const q of ['filter=issue', 'filter=pending', 'ch=cp', 'ch=c24', 'ch=naver', 'ch=coupon', 'q=' + encodeURIComponent('감귤'), 'q=1234']) { const r = await get(ceo, '/api/agent-office/notify-logs?fast=1&limit=5&' + q); if (r.s !== 200 || !Array.isArray(r.j.rows)) ok(false, '필터 ' + q + ' → ' + r.s + ' ' + r.txt.slice(0, 80)); else pass++; }
            console.log('  ✅ 필터·채널·검색 8종 모두 200');
            { const r = await get(staff, '/api/agent-office/notify-logs?fast=1&limit=5'); ok(r.s === 200 && r.j.default_days === 90, '직원 계정도 열림(' + r.s + ')'); }
            // 쿠팡 성함·번호 시딩: 두 표 맞붙이기(종전) = 주문번호 조회 2번(지금)
            const cpKeys = (await pool.query(`SELECT order_key FROM (SELECT order_key, created_at FROM kakao_notify_log WHERE order_key LIKE 'cp:%' UNION SELECT order_key, created_at FROM lms_guide_log WHERE order_key LIKE 'cp:%') x GROUP BY 1 ORDER BY max(created_at) DESC LIMIT 200`)).rows.map(r => r.order_key);
            const oldQ = await pool.query(`SELECT COALESCE(k.order_key, l.order_key) AS order_key, COALESCE(k.cp_name, l.cp_name) AS cp_name, COALESCE(k.cp_tel, l.cp_tel) AS cp_tel FROM kakao_notify_log k FULL OUTER JOIN lms_guide_log l ON k.order_key = l.order_key WHERE COALESCE(k.order_key, l.order_key) = ANY($1)`, [cpKeys]);
            const seed = cut('// #579: 두 표를 통째로 맞붙이던 조회', "for (const row of cpMerged.values())");
            const merged = await new Function('pool', 'cpNeed', 'return (async () => {' + seed + ' return cpMerged; })()')(pool, cpKeys);
            const norm = rows => JSON.stringify(rows.map(r => [r.order_key, r.cp_name, r.cp_tel]).sort((a, b) => a[0] < b[0] ? -1 : 1));
            ok(cpKeys.length > 0 && norm(oldQ.rows) === norm([...merged.values()]), `쿠팡 성함·번호 채우기: 종전 조회와 값이 같음(쿠팡 주문 ${cpKeys.length}건 · 값 있는 것 ${oldQ.rows.filter(r => r.cp_name || r.cp_tel).length}건)`);
            const p3 = await plan(`SELECT order_key, 0 AS src, cp_name, cp_tel FROM kakao_notify_log WHERE order_key = ANY($1) UNION ALL SELECT order_key, 1 AS src, cp_name, cp_tel FROM lms_guide_log WHERE order_key = ANY($1) ORDER BY src`, [cpKeys.slice(0, 100)]);
            const p3o = await plan(`SELECT COALESCE(k.order_key, l.order_key) FROM kakao_notify_log k FULL OUTER JOIN lms_guide_log l ON k.order_key = l.order_key WHERE COALESCE(k.order_key, l.order_key) = ANY($1)`, [cpKeys.slice(0, 100)]);
            console.log('     쿠팡 채우기 조회: 종전', (p3o.match(/Execution Time: [\d.]+ ms/) || [''])[0], '(' + (/Seq Scan/.test(p3o) ? '표 전체 훑기' : '인덱스') + ') → 지금', (p3.match(/Execution Time: [\d.]+ ms/) || [''])[0], '(' + (/Seq Scan/.test(p3) ? '표 전체 훑기' : '인덱스') + ')');
        } finally { srv.kill(); }
    }
    await pool.end();
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? ' — 실패 ' + fail : ' 전부 통과'));
    process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.stack || e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

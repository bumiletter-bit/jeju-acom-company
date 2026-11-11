// #1113-7 DB 압축 1회 — 지운 자리만 큰 표를 VACUUM (FULL, ANALYZE) 로 줄인다(대표 11/11 「압축 진행」)
//
//   사용(리포 폴더에서 · .env 의 DATABASE_URL):
//     node scripts/db-vacuum-once.js --dry                         읽기만 — 표별 크기·죽은 줄·실제 든 양·예상 시간(쓰기 0 · 잠금 0)
//     node scripts/db-vacuum-once.js --run --actor "총괄 claude-22"  실행 — 표 하나씩 · 끝에 audit_logs 1줄
//     옵션  --only=report_files,tax_invoices   아래 목록 안에서 고른 표만
//           --force                            발주 시간(평일·주말 08:00~10:30 KST)에도 실행(기본 = 그 시간엔 멈춤)
//
//   대상(이 목록 밖 표는 받지 않는다): report_files → coupang_item_backups → tax_invoices → naver_product_backups
//     pending_orders 는 창구·VM 이 수십 초마다 읽어 넣지 않았다(필요하면 한가한 때 따로).
//
//   --run 이 하는 일: 연결 1개 · 이 연결만 lock_timeout 15초(잠금을 못 잡으면 그 표는 건너뜀 = 운영을 막지 않는다) · statement_timeout 0
//     표마다 시작·끝 시각, 전/후 크기 출력 · 한 표가 실패해도 다음 표로 · 끝에 DB 전체 전/후 + audit_logs(action db_vacuum_full · target_type config)
//
//   🔴 알아 둘 것
//     · VACUUM FULL 은 도는 동안 그 표를 통째로 잠근다(읽기·쓰기 모두 대기). 걸리는 시간은 「실제 든 양」에 비례(--dry 가 추정해 준다 · 10/28 실측 320MB = 176초).
//     · 잠금을 기다리는 15초 동안에도 그 표를 새로 읽으려는 쪽은 줄을 선다(못 잡고 건너뛰어도 최대 15초 멈칫).
//     · 새 사본을 다 만든 뒤 한 번에 바꿔치기한다 → 도중에 끊기거나 실패하면 원본 그대로(줄 손실 없음). 디스크는 잠깐 「실제 든 양」만큼 더 쓴다.
//     · 데이터를 지우지 않는다(빈 자리만 반납). 되돌릴 것이 없다.
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

const TABLES = ['report_files', 'coupang_item_backups', 'tax_invoices', 'naver_product_backups'];
const MB_PER_SEC = 1.8;   // 10/28 실측(report_files 320MB · 176초) — 256MB 램 DB 기준 어림값
const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = k => { const a = args.find(x => x.startsWith(k + '=')); if (a) return a.slice(k.length + 1); const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''; };
const DRY = has('--dry'), RUN = has('--run'), FORCE = has('--force');
const actor = String(val('--actor') || '').trim().slice(0, 80);
const only = String(val('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const mb = n => (Number(n || 0) / 1048576).toFixed(1) + 'MB';
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19);

function usage(msg) { if (msg) console.error('⚠ ' + msg); console.error('사용: node scripts/db-vacuum-once.js --dry | --run --actor "<누가>" [--only=표,표] [--force]'); process.exit(2); }
if (DRY === RUN) usage('--dry 와 --run 중 하나만 주세요');
if (RUN && !actor) usage('--run 에는 --actor "<누가>" 가 필요해요(audit 에 남는 이름)');
const bad = only.filter(t => !TABLES.includes(t));
if (bad.length) usage('목록에 없는 표: ' + bad.join(', ') + ' (받는 표 = ' + TABLES.join(', ') + ')');
const targets = only.length ? TABLES.filter(t => only.includes(t)) : TABLES;
if (!process.env.DATABASE_URL) usage('.env 에 DATABASE_URL 이 없어요');
if (RUN && !FORCE) {
    const d = new Date(Date.now() + 9 * 3600e3), hm = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (hm >= 8 * 60 && hm < 10 * 60 + 30) usage('지금은 발주 시간(08:00~10:30 KST)이에요 — 그래도 돌리려면 --force');
}

const sizeSql = `SELECT c.oid::regclass::text AS t, pg_total_relation_size(c.oid) AS total, pg_relation_size(c.oid) AS heap, pg_indexes_size(c.oid) AS idx,
        pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) AS toast,
        COALESCE(s.n_live_tup, 0) AS live, COALESCE(s.n_dead_tup, 0) AS dead
    FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid WHERE c.relname = $1 AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`;

(async () => {
    const cl = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, keepAlive: true, application_name: 'db-vacuum-once', connectionTimeoutMillis: 15000 });
    cl.on('error', e => console.error('[연결 오류]', e.message));
    await cl.connect();
    const one = async (sql, p) => (await cl.query(sql, p)).rows[0];
    const dbSize = async () => Number((await one(`SELECT pg_database_size(current_database()) AS n`)).n);
    // 실제 든 양 = 살아 있는 줄의 칸 크기 합(pg_column_size = 저장된 크기 · 큰 값도 풀지 않고 길이만 읽는다 → 가볍다)
    const liveBytes = async t => {
        const cols = (await cl.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t])).rows.map(r => r.column_name);
        if (!cols.length) return null;
        const expr = cols.map(c => `COALESCE(pg_column_size("${c.replace(/"/g, '""')}"), 0)`).join(' + ');
        return Number((await one(`SELECT COALESCE(sum(${expr}), 0)::bigint AS n, count(*)::int AS rows FROM "${t}"`)).n);
    };
    try {
        const before = await dbSize();
        console.log(`[${kst()} KST] DB 전체 ${mb(before)} · 대상 ${targets.join(', ')} · ${DRY ? '읽기만(--dry)' : '실행(--run · ' + actor + ')'}`);
        const report = [];
        if (DRY) {
            await cl.query('BEGIN READ ONLY'); await cl.query(`SET LOCAL statement_timeout = '30s'`);
            let saveSum = 0, secSum = 0;
            for (const t of targets) {
                const s = await one(sizeSql, [t]);
                if (!s) { console.log(`- ${t}: 표 없음(건너뜀)`); continue; }
                const lb = await liveBytes(t), est = lb == null ? null : Math.max(0, Number(s.total) - lb - Number(s.idx)), sec = lb == null ? null : Math.max(1, Math.ceil(lb / 1048576 / MB_PER_SEC));
                if (est != null) { saveSum += est; secSum += sec; }
                console.log(`- ${t}: 지금 ${mb(s.total)}(본문 ${mb(s.heap)} · 큰 값 ${mb(s.toast)} · 색인 ${mb(s.idx)}) · 산 줄 ${s.live} · 죽은 줄 ${s.dead} · 실제 든 양 ≈ ${lb == null ? '모름' : mb(lb)} → 줄어들 양 ≈ ${est == null ? '모름' : mb(est)} · 잠기는 시간 ≈ ${sec == null ? '모름' : sec + '초'} · 잠깐 더 쓰는 디스크 ≈ ${lb == null ? '모름' : mb(lb)}`);
            }
            const lk = (await cl.query(`SELECT c.relname AS t, count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = ANY($1::text[]) AND l.pid <> pg_backend_pid() GROUP BY 1`, [targets])).rows;
            console.log(`합: 줄어들 양 ≈ ${mb(saveSum)} · 잠기는 시간 합 ≈ ${secSum}초(표마다 따로 잠금) · 지금 이 표들을 잡고 있는 다른 연결: ${lk.length ? lk.map(x => x.t + ' ' + x.n).join(', ') : '없음'}`);
            await cl.query('ROLLBACK');
            return;
        }
        await cl.query(`SET lock_timeout = '15s'`);
        await cl.query(`SET statement_timeout = 0`);
        for (const t of targets) {
            const b = await one(sizeSql, [t]);
            if (!b) { console.log(`- ${t}: 표 없음(건너뜀)`); report.push({ table: t, skipped: 'no_table' }); continue; }
            const t0 = Date.now(); console.log(`- ${t}: 시작 ${kst()} · 전 ${mb(b.total)}(죽은 줄 ${b.dead})`);
            try {
                await cl.query(`VACUUM (FULL, ANALYZE) "${t}"`);
                const a = await one(sizeSql, [t]); const sec = Math.round((Date.now() - t0) / 100) / 10;
                console.log(`  끝 ${kst()} · ${sec}초 · 후 ${mb(a.total)} · 줄어든 양 ${mb(Number(b.total) - Number(a.total))}`);
                report.push({ table: t, before: Number(b.total), after: Number(a.total), sec, live: Number(a.live) });
            } catch (e) {
                const lock = e && e.code === '55P03';
                console.log(`  ${lock ? '잠금을 15초 안에 못 잡아 건너뜀(운영 중 · 원본 그대로)' : '실패(원본 그대로) — ' + String(e.message || e).slice(0, 160)} · ${Math.round((Date.now() - t0) / 1000)}초`);
                report.push({ table: t, before: Number(b.total), skipped: lock ? 'lock_timeout' : 'error', error: lock ? undefined : String(e.message || e).slice(0, 200) });
            }
        }
        const after = await dbSize();
        console.log(`[${kst()} KST] DB 전체 ${mb(before)} → ${mb(after)} (${mb(before - after)} 줄어듦)`);
        try {
            await cl.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('db_vacuum_full', 'config', NULL, $1, 'db-vacuum-once', $2)`,
                [JSON.stringify({ after: { db_before: before, db_after: after, tables: report } }), actor]);
            console.log('audit_logs 1줄 남김(action db_vacuum_full)');
        } catch (e) { console.error('audit 기록 실패(압축 결과는 위 그대로):', e.message); }
    } finally { await cl.end().catch(() => { }); }
})().catch(e => { console.error('실패:', e && e.message || e); process.exit(1); });

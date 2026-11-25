// #1292 DB 표 틀 찍기 — DATABASE_URL 의 public 표 틀(칸·기본값·생성 칸·열쇠·인덱스·시퀀스·외래 키)을 SQL 파일로
// 사용법: node scripts/db-schema-dump.js            → scripts/db-schema.sql 을 새로 씀
//         node scripts/db-schema-dump.js --check    → 파일과 지금 DB 틀이 같은지만(다르면 종료 1 · 파일 안 씀)
//         node scripts/db-schema-dump.js --out=<경로>
// 쓰임: 빈 새 DB 에 `node scripts/db-restore.js <백업> --init --yes` 가 이 파일로 틀부터 만든다(백업 파일에는 자료만 있음)
// · 읽기만: READ ONLY 트랜잭션 · 시스템 목록(pg_catalog)만 봄 · 자료 줄 SELECT 0 · 시퀀스 지금 값도 안 읽음(복원 때 백업의 setval 이 맞춤)
// · 🔴 저장소가 PUBLIC — 파일에는 표·칸 이름·타입·기본값 식만 · 기본값 글자에 비밀값·연락처 꼴이 보이면 쓰지 않고 멈춤
// · 이 파일이 못 담는 것(뷰·함수·트리거·확장·identity·상속 등)이 DB 에 생기면 쓰지 않고 멈춤(조용히 빠뜨리지 않게)
// · 같은 DB 면 늘 같은 바이트(이름순 · 날짜 줄 없음) → git diff 로 틀 변화만 보임
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const HEADER = '-- 제주아꼼이네 DB 표 틀 (scripts/db-schema-dump.js 가 만듦 · 손으로 고치지 말 것)';

function targetLabel() {
    const u = process.env.DATABASE_URL;
    if (!u) return '(DATABASE_URL 없음)';
    try { const x = new URL(u); return `${x.hostname}${x.port ? ':' + x.port : ''}/${decodeURIComponent(x.pathname.replace(/^\//, '')) || '(DB 이름 없음)'}`; }
    catch (_) { return '(DATABASE_URL 꼴을 못 읽음)'; }
}

// 틀 SQL 만들기 — client 는 연결된 pg Client · 돌려줌 { sql, stats }
async function buildSchema(client) {
    const q = async (s) => (await client.query(s)).rows;
    const NS = `'public'::regnamespace`;

    // 1) 못 담는 것 — 있으면 멈춤
    const bad = [];
    const one = async (label, s) => { const r = await q(s); const n = +r[0].n; if (n) bad.push(`${label} ${n}개`); };
    await one('public 밖 스키마의 표·시퀀스', `SELECT count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND s.nspname NOT IN ('public','pg_catalog','information_schema') AND s.nspname NOT LIKE 'pg_toast%' AND s.nspname NOT LIKE 'pg_temp%'`);
    await one('뷰·분할 표·외부 표', `SELECT count(*) n FROM pg_class WHERE relnamespace = ${NS} AND relkind NOT IN ('r','i','S')`);
    await one('함수', `SELECT count(*) n FROM pg_proc WHERE pronamespace = ${NS}`);
    await one('트리거', `SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = ${NS} AND NOT t.tgisinternal`);
    await one('사용자 타입(enum·domain 등)', `SELECT count(*) n FROM pg_type t WHERE t.typnamespace = ${NS} AND t.typtype <> 'c' AND t.typcategory <> 'A'`);
    await one('plpgsql 밖 확장', `SELECT count(*) n FROM pg_extension WHERE extname <> 'plpgsql'`);
    await one('identity 칸·가상 생성 칸', `SELECT count(*) n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = ${NS} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND (a.attidentity <> '' OR a.attgenerated NOT IN ('', 's'))`);
    await one('기본 아닌 정렬(COLLATE) 칸', `SELECT count(*) n FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = ${NS} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND a.attcollation NOT IN (0, 100)`);
    await one('상속 표', `SELECT count(*) n FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE c.relnamespace = ${NS}`);
    await one('행 보안 정책', `SELECT count(*) n FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = ${NS}`);
    await one('규칙(RULE)', `SELECT count(*) n FROM pg_rules WHERE schemaname = 'public'`);
    await one('UNLOGGED 표·표 옵션', `SELECT count(*) n FROM pg_class WHERE relnamespace = ${NS} AND relkind = 'r' AND (relpersistence <> 'p' OR reloptions IS NOT NULL)`);
    await one('제외 제약(EXCLUDE)·트리거 제약', `SELECT count(*) n FROM pg_constraint WHERE connamespace = ${NS} AND contype IN ('x','t')`);
    await one('이름이 기본 꼴 아닌 NOT NULL 제약', `SELECT count(*) n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid WHERE k.connamespace = ${NS} AND k.contype = 'n' AND k.conname <> left(c.relname || '_' || (SELECT attname FROM pg_attribute WHERE attrelid = k.conrelid AND attnum = k.conkey[1]) || '_not_null', 63)`);
    if (bad.length) throw new Error('이 도구가 아직 못 담는 것이 DB 에 있음 — ' + bad.join(' · ') + ' → db-schema-dump.js 를 먼저 넓힐 것');

    const qi = s => '"' + String(s).replace(/"/g, '""') + '"';   // 늘 따옴표(대소문자·예약어 걱정 없음)

    // 2) 시퀀스(표보다 먼저 — 칸 기본값 nextval 이 가리킴)
    const seqs = await q(`
        SELECT c.relname AS name, format_type(s.seqtypid, NULL) AS typ, s.seqstart::text AS st, s.seqincrement::text AS inc,
               s.seqmin::text AS mn, s.seqmax::text AS mx, s.seqcache::text AS cache, s.seqcycle AS cyc,
               t.relname AS own_t, a.attname AS own_c
        FROM pg_class c JOIN pg_sequence s ON s.seqrelid = c.oid
        LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'a'
        LEFT JOIN pg_class t ON t.oid = d.refobjid
        LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE c.relnamespace = ${NS} AND c.relkind = 'S' ORDER BY c.relname COLLATE "C"`);

    // 3) 표 · 칸
    const tables = (await q(`SELECT relname AS t FROM pg_class WHERE relnamespace = ${NS} AND relkind = 'r' ORDER BY relname COLLATE "C"`)).map(r => r.t);
    const cols = await q(`
        SELECT c.relname AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull AS nn, a.attgenerated AS gen,
               pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relnamespace = ${NS} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname COLLATE "C", a.attnum`);
    const cons = await q(`
        SELECT c.relname AS t, k.conname AS n, k.contype AS ty, pg_get_constraintdef(k.oid) AS d
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE k.connamespace = ${NS} AND k.contype IN ('p','u','c','f')
        ORDER BY c.relname COLLATE "C", k.conname COLLATE "C"`);
    const idx = await q(`
        SELECT ic.relname AS n, pg_get_indexdef(i.indexrelid) AS d
        FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_class tc ON tc.oid = i.indrelid
        WHERE tc.relnamespace = ${NS} AND tc.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p','u','x'))
        ORDER BY ic.relname COLLATE "C"`);

    const L = [HEADER,
        '-- 쓰임: 빈 DB 에 node scripts/db-restore.js <백업> --init --yes (이 파일을 먼저 실행한 뒤 자료를 넣음 · 한 트랜잭션)',
        '-- 다시 찍기: node scripts/db-schema-dump.js (DATABASE_URL 의 틀) · 맞는지만: --check',
        `-- 표 ${tables.length} · 시퀀스 ${seqs.length} · 인덱스(제약 밖) ${idx.length} · 외래 키 ${cons.filter(k => k.ty === 'f').length}`,
        ''];
    L.push('-- ── 시퀀스');
    for (const s of seqs) L.push(`CREATE SEQUENCE ${qi(s.name)} AS ${s.typ} START WITH ${s.st} INCREMENT BY ${s.inc} MINVALUE ${s.mn} MAXVALUE ${s.mx} CACHE ${s.cache}${s.cyc ? ' CYCLE' : ''};`);
    L.push('');
    L.push('-- ── 표');
    const byT = {}; for (const c of cols) (byT[c.t] = byT[c.t] || []).push(c);
    const consT = {}; for (const k of cons) if (k.ty !== 'f') (consT[k.t] = consT[k.t] || []).push(k);
    for (const t of tables) {
        const parts = (byT[t] || []).map(c => {
            let s = `    ${qi(c.c)} ${c.typ}`;
            if (c.gen === 's') s += ` GENERATED ALWAYS AS (${c.def}) STORED`;
            else if (c.def != null) s += ` DEFAULT ${c.def}`;
            if (c.nn) s += ' NOT NULL';
            return s;
        });
        for (const k of consT[t] || []) parts.push(`    CONSTRAINT ${qi(k.n)} ${k.d}`);
        L.push(`CREATE TABLE ${qi(t)} (`, parts.join(',\n'), ');');
    }
    L.push('');
    L.push('-- ── 시퀀스 주인 칸(칸·표를 지우면 시퀀스도 같이)');
    for (const s of seqs) if (s.own_t) L.push(`ALTER SEQUENCE ${qi(s.name)} OWNED BY ${qi(s.own_t)}.${qi(s.own_c)};`);
    L.push('');
    L.push('-- ── 인덱스');
    for (const i of idx) L.push(i.d + ';');
    L.push('');
    L.push('-- ── 외래 키(맨 끝 · 복원은 자료를 다 넣은 뒤 다시 걸며 전 줄 검사)');
    for (const k of cons) if (k.ty === 'f') L.push(`ALTER TABLE ${qi(k.t)} ADD CONSTRAINT ${qi(k.n)} ${k.d};`);
    const sql = L.join('\n') + '\n';

    // 4) PUBLIC 저장소 막이 — 따옴표 글자(기본값 식 안의 '…') 중 비밀값·연락처 꼴
    const risky = [];
    for (const m of sql.matchAll(/'((?:[^']|'')*)'/g)) {
        const v = m[1];
        if (sql.startsWith('::regclass', m.index + m[0].length)) continue;   // nextval('긴_표_이름_id_seq'::regclass) = 시퀀스 이름
        if (/[A-Za-z0-9+/_-]{24,}/.test(v) || /@[A-Za-z0-9-]+\./.test(v) || /\d[\d -]{8,}\d/.test(v) || /:\/\//.test(v) || /[가-힣]{2,}/.test(v) && v.length > 40) {
            const ln = sql.slice(0, m.index).split('\n').length;
            risky.push(`${ln}번째 줄(${v.length}자)`);
        }
    }
    if (risky.length) throw new Error('기본값 글자에 비밀값·연락처로 보이는 꼴 ' + risky.length + '곳 — ' + risky.slice(0, 5).join(', ') + ' → 눈으로 확인 전엔 저장소에 못 씀');

    return { sql, stats: { tables: tables.length, seqs: seqs.length, idx: idx.length, fks: cons.filter(k => k.ty === 'f').length, cols: cols.length } };
}

async function main() {
    const check = process.argv.includes('--check');
    const outArg = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6);
    const outFile = outArg || path.join(__dirname, 'db-schema.sql');
    if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL 없음'); process.exit(1); }
    const cfg = { connectionString: process.env.DATABASE_URL };
    if (!process.env.DATABASE_URL.includes('localhost')) cfg.ssl = { rejectUnauthorized: false };
    console.log(`🎯 틀을 읽을 DB: ${targetLabel()} (읽기만)`);
    const client = new Client(cfg);
    client.on('error', e => console.error('   (연결 오류:', e && e.code, ')'));
    await client.connect();
    let res;
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query(`SET LOCAL search_path = public`);   // 식 안 표 이름을 public. 없이 같은 꼴로
        res = await buildSchema(client);
        await client.query('COMMIT');
    } finally { await client.end().catch(() => { }); }
    const s = res.stats;
    const sum = `표 ${s.tables} · 칸 ${s.cols} · 시퀀스 ${s.seqs} · 인덱스 ${s.idx} · 외래 키 ${s.fks}`;
    if (check) {
        const old = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : null;   // git 이 윈도에서 CRLF 로 꺼내도 같게
        if (old === res.sql) { console.log(`✅ 틀 파일 = 지금 DB 틀 (${sum})`); return; }
        console.error(`⚠️ 틀 파일이 지금 DB 틀과 다름 — node scripts/db-schema-dump.js 로 다시 찍고 diff 를 보세요 (${old == null ? '파일 없음' : 'DB ' + sum})`);
        process.exit(1);
    }
    fs.writeFileSync(outFile, res.sql);
    console.log(`✅ 틀 파일 씀: ${outFile} (${sum} · ${Buffer.byteLength(res.sql)}바이트)`);
}

if (require.main === module) main().catch(e => {
    console.error(`❌ 틀 찍기 실패: ${e && e.code ? '[' + e.code + '] ' : ''}${String(e && e.message || e).slice(0, 400)}`);
    process.exit(1);
});
else module.exports = { buildSchema, HEADER };

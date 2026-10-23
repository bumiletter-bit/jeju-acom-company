// DB 백업 스크립트 (0단계) — pg_dump 없이 pg 라이브러리로 전체 데이터 덤프
// 사용법: node scripts/db-backup.js [버전]   (버전 생략 시 version.js의 VERSION 사용)
// 출력: {백업폴더}/backup_{버전}_{YYYYMMDD}.sql
// 백업폴더: 기본 = 리포 밖 OneDrive "제주아꼼이네_DB백업" (환경변수 BACKUP_DIR로 변경 가능)
// 복원은 scripts/db-restore.js 참조. 스키마는 server.js initDB(CREATE TABLE IF NOT EXISTS)가 관리하므로
// 이 백업은 "데이터 전체"를 담는다 (TRUNCATE 후 INSERT + 시퀀스 복구).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// 날짜/시각 타입은 문자열 그대로 받아 원본 보존
[1082, 1114, 1184].forEach(oid => types.setTypeParser(oid, v => v));

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}

function sqlLiteral(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (Buffer.isBuffer(val)) return `'\\x${val.toString('hex')}'`;
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    return `'${String(val).replace(/'/g, "''")}'`;
}

// #830 덤프 전체를 한 문자열로 만들지 않는다 — 10/22 부터 「Invalid string length」(DB 418MB · bytea hex 2배 → V8 문자열 상한 넘음).
//   · 한 스냅샷(REPEATABLE READ READ ONLY 트랜잭션) 안에서 표마다 서버 커서로 FETCH_N 행씩 읽어 파일에 바로 흘려 쓴다
//   · 표 하나를 먼저 임시 파일에 다 쓴 뒤 본 파일에 붙인다 → 중간에 실패한 표는 반쪽 SQL 없이 「-- ⚠️ 실패」 한 줄만 남기고 다음 표로(끝에 실패 표 이름 · 종료 코드 1)
//   · 출력 바이트는 종전(lines.join('\n'))과 같다 — 줄 사이 \n · 마지막 줄 뒤엔 없음 · INSERT 500행 묶음 · 행 사이 ',\n'
//   · 시험용 env BACKUP_TABLES=표1,표2(그 표만 · 비우면 전체) — 🔴 부분 백업은 첫 줄에 「복원 금지」 표시(TRUNCATE CASCADE 가 다른 표까지 비움)
//   · Ctrl+C(SIGINT) = 임시 파일(.table.tmp · .part) 지우고 종료 130
const FETCH_N = 50;          // 한 번에 읽는 행 수(큰 bytea 줄이 많아도 메모리 작게)
const INSERT_ROWS = 500;     // INSERT 한 문장 행 수(종전과 같게)
function openOut(file) {
    const fd = fs.openSync(file, 'w'); let first = true;
    return {
        fd,
        line(str) { fs.writeSync(fd, (first ? '' : '\n') + str, null, 'utf8'); first = false; },   // 종전 lines.push 와 같은 자리
        raw(str) { fs.writeSync(fd, str, null, 'utf8'); },   // 같은 줄 이어 쓰기
        close() { fs.closeSync(fd); },
    };
}
function appendFile(dstFd, srcPath) {
    const src = fs.openSync(srcPath, 'r'); const buf = Buffer.allocUnsafe(1 << 20); let n;
    try { while ((n = fs.readSync(src, buf, 0, buf.length, null)) > 0) fs.writeSync(dstFd, buf, 0, n); } finally { fs.closeSync(src); }
}

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL이 설정되지 않았습니다 (.env 확인)');
        process.exit(1);
    }
    const version = process.argv[2] || require('../version.js').VERSION;
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '제주아꼼이네_DB백업');
    fs.mkdirSync(backupDir, { recursive: true });
    const outFile = path.join(backupDir, `backup_${version}_${ymd}.sql`);
    const tmpFile = outFile + '.table.tmp';
    const only = String(process.env.BACKUP_TABLES || '').split(',').map(x => x.trim()).filter(Boolean);

    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    const out = openOut(outFile + '.part');   // 다 끝나면 이름을 바꾼다(반쪽 파일이 백업처럼 보이지 않게)
    const failed = [];
    let ok = false;
    const cleanup = () => { for (const p of [tmpFile, outFile + '.part']) { try { fs.unlinkSync(p); } catch (_) { /* 없음 */ } } };
    process.on('SIGINT', () => { try { out.close(); } catch (_) { /* 이미 닫힘 */ } cleanup(); console.error('\n❌ 백업 중단(Ctrl+C) — 임시 파일 지움'); process.exit(130); });
    if (only.length) out.line(`-- ⚠️ 부분 백업(BACKUP_TABLES=${only.join(',')}) · 복원 금지(TRUNCATE CASCADE 가 다른 표까지 비움)`);
    out.line(`-- 제주아꼼이네 DB 백업`);
    out.line(`-- 버전: ${version} / 생성: ${today.toISOString()}`);
    out.line(`-- 복원: node scripts/db-restore.js "${path.basename(outFile)}"`);
    out.line(`-- 주의: 복원 시 기존 데이터를 TRUNCATE 후 덮어씀 (트랜잭션으로 실행됨)`);
    out.line('');

    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');   // 모든 표 = 같은 순간 · 쓰기 0
        let { rows: tables } = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name`);
        if (only.length) tables = tables.filter(t => only.includes(t.table_name));
        if (tables.length === 0) throw new Error('public 스키마에 테이블이 없습니다');

        let totalRows = 0;
        // FK 충돌 방지: 전체 테이블을 한 번에 TRUNCATE (CASCADE)
        const tableList = tables.map(t => `"${t.table_name}"`).join(', ');
        out.line(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
        out.line('');

        for (const { table_name } of tables) {
            const t = { fd: fs.openSync(tmpFile, 'w') };
            const tl = (str) => fs.writeSync(t.fd, '\n' + str, null, 'utf8');   // 표 안의 줄은 늘 앞 줄 뒤에 온다
            const tr = (str) => fs.writeSync(t.fd, str, null, 'utf8');
            let n = 0, closed = false;
            try {
                await client.query('SAVEPOINT tb');
                const { rows: cols } = await client.query(`
                    SELECT column_name, column_default FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = $1
                    ORDER BY ordinal_position`, [table_name]);
                const colNames = cols.map(c => `"${c.column_name}"`).join(', ');
                const total = Number((await client.query(`SELECT count(*)::bigint AS n FROM "${table_name}"`)).rows[0].n);
                tl(`-- ${table_name} (${total}건)`);
                await client.query(`DECLARE bk NO SCROLL CURSOR FOR SELECT * FROM "${table_name}"`);
                for (;;) {
                    const { rows } = await client.query(`FETCH ${FETCH_N} FROM bk`);
                    if (!rows.length) break;
                    for (const r of rows) {
                        const v = `(${cols.map(c => sqlLiteral(r[c.column_name])).join(', ')})`;
                        if (n % INSERT_ROWS === 0) { if (n) tr(';'); tl(`INSERT INTO "${table_name}" (${colNames}) VALUES\n` + v); }
                        else tr(',\n' + v);
                        n++;
                    }
                }
                if (n) tr(';');
                await client.query('CLOSE bk');
                if (n !== total) throw new Error(`읽은 행 ${n} ≠ 셈 ${total}`);
                // serial/identity 시퀀스 복구
                for (const c of cols) {
                    if (c.column_default && c.column_default.includes('nextval')) {
                        tl(`SELECT setval(pg_get_serial_sequence('"${table_name}"', '${c.column_name}'), COALESCE((SELECT MAX("${c.column_name}") FROM "${table_name}"), 0) + 1, false);`);
                    }
                }
                tl('');
                await client.query('RELEASE SAVEPOINT tb');
                fs.closeSync(t.fd); closed = true;
                appendFile(out.fd, tmpFile);
                totalRows += n;
                console.log(`  📦 ${table_name}: ${n}건`);
            } catch (e) {
                if (!closed) try { fs.closeSync(t.fd); } catch (_) { /* 무시 */ }
                try { await client.query('ROLLBACK TO SAVEPOINT tb'); } catch (_) { /* 트랜잭션이 끊겼으면 아래 표도 실패로 찍힘 */ }
                failed.push(table_name);
                out.line(`-- ⚠️ ${table_name} 백업 실패: ${String(e && e.message || e).replace(/\s+/g, ' ').slice(0, 200)}`);
                out.line('');
                console.error(`  ❌ ${table_name}: 실패 — ${String(e && e.message || e).slice(0, 200)}`);
            }
        }
        await client.query('COMMIT').catch(() => { });
        out.close();
        try { fs.unlinkSync(tmpFile); } catch (_) { /* 없음 */ }
        fs.renameSync(outFile + '.part', outFile);
        ok = true;
        const sizeKB = Math.round(fs.statSync(outFile).size / 1024);
        console.log(`\n${failed.length ? '⚠️ 백업 끝(실패 표 있음)' : '✅ 백업 완료'}: ${outFile}`);
        console.log(`   테이블 ${tables.length}개 / 총 ${totalRows}건 / ${sizeKB}KB`);
        if (failed.length) { console.error(`❌ 실패한 표 ${failed.length}개: ${failed.join(', ')} — 그 표는 이 백업에 데이터가 없음`); process.exitCode = 1; }
    } finally {
        if (!ok) { try { out.close(); } catch (_) { /* 이미 닫힘 */ } cleanup(); }
        try { await client.query('ROLLBACK'); } catch (_) { /* 이미 끝 */ }
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('❌ 백업 실패:', err.message);
    process.exit(1);
});

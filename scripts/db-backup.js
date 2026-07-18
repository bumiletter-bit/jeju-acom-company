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

    const pool = new Pool(dbConfig);
    const lines = [];
    lines.push(`-- 제주아꼼이네 DB 백업`);
    lines.push(`-- 버전: ${version} / 생성: ${today.toISOString()}`);
    lines.push(`-- 복원: node scripts/db-restore.js "${path.basename(outFile)}"`);
    lines.push(`-- 주의: 복원 시 기존 데이터를 TRUNCATE 후 덮어씀 (트랜잭션으로 실행됨)`);
    lines.push('');

    try {
        const { rows: tables } = await pool.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name`);
        if (tables.length === 0) throw new Error('public 스키마에 테이블이 없습니다');

        let totalRows = 0;
        // FK 충돌 방지: 전체 테이블을 한 번에 TRUNCATE (CASCADE)
        const tableList = tables.map(t => `"${t.table_name}"`).join(', ');
        lines.push(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
        lines.push('');

        for (const { table_name } of tables) {
            const { rows: cols } = await pool.query(`
                SELECT column_name, column_default FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1
                ORDER BY ordinal_position`, [table_name]);
            const colNames = cols.map(c => `"${c.column_name}"`).join(', ');
            const { rows } = await pool.query(`SELECT * FROM "${table_name}"`);
            lines.push(`-- ${table_name} (${rows.length}건)`);
            for (let i = 0; i < rows.length; i += 500) {
                const chunk = rows.slice(i, i + 500);
                const values = chunk.map(r =>
                    `(${cols.map(c => sqlLiteral(r[c.column_name])).join(', ')})`).join(',\n');
                lines.push(`INSERT INTO "${table_name}" (${colNames}) VALUES\n${values};`);
            }
            // serial/identity 시퀀스 복구
            for (const c of cols) {
                if (c.column_default && c.column_default.includes('nextval')) {
                    lines.push(`SELECT setval(pg_get_serial_sequence('"${table_name}"', '${c.column_name}'), COALESCE((SELECT MAX("${c.column_name}") FROM "${table_name}"), 0) + 1, false);`);
                }
            }
            lines.push('');
            totalRows += rows.length;
            console.log(`  📦 ${table_name}: ${rows.length}건`);
        }

        fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
        const sizeKB = Math.round(fs.statSync(outFile).size / 1024);
        console.log(`\n✅ 백업 완료: ${outFile}`);
        console.log(`   테이블 ${tables.length}개 / 총 ${totalRows}건 / ${sizeKB}KB`);
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error('❌ 백업 실패:', err.message);
    process.exit(1);
});

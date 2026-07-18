// DB 복원 스크립트 (0단계) — db-backup.js가 만든 SQL 파일을 트랜잭션으로 실행
// 사용법: node scripts/db-restore.js <백업파일명 또는 전체경로>
//   예: node scripts/db-restore.js backup_v4.0_20260718.sql
// ⚠️ 기존 데이터를 전부 TRUNCATE 후 백업 시점 데이터로 덮어씀. 실행 전 반드시 현재 상태 백업 권장.
// 안전장치: --yes 플래그 없이는 실행하지 않음 (실수 방지)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}

async function main() {
    const fileArg = process.argv.filter(a => !a.startsWith('--'))[2];
    const confirmed = process.argv.includes('--yes');
    if (!fileArg) {
        console.error('사용법: node scripts/db-restore.js <백업파일> --yes');
        process.exit(1);
    }
    let filePath = fileArg;
    if (!fs.existsSync(filePath)) {
        const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '제주아꼼이네_DB백업');
        filePath = path.join(backupDir, fileArg);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 백업 파일을 찾을 수 없습니다: ${fileArg}`);
        process.exit(1);
    }
    if (!confirmed) {
        console.error('⚠️ 복원은 기존 데이터를 전부 덮어씁니다. 진행하려면 --yes 를 붙여 실행하세요.');
        console.error(`   node scripts/db-restore.js "${fileArg}" --yes`);
        process.exit(1);
    }

    const sql = fs.readFileSync(filePath, 'utf8');
    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    try {
        console.log(`📥 복원 시작: ${filePath}`);
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log('✅ 복원 완료 (트랜잭션 커밋됨)');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ 복원 실패 — 전부 롤백됨 (DB는 복원 시도 전 상태 그대로):', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();

// scripts/migrate-scenarios.js — 문의시나리오 이관 (로컬 1회 실행: node scripts/migrate-scenarios.js)
// 톡톡봇 scenarios.js를 require로 직접 읽어 그대로 INSERT (재타이핑 금지 — 복사 오류 원천 차단)
// 테이블에 데이터가 있으면 중단 (중복 실행 방지)
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const BOT_DIR = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 톡톡봇';
const { scenarios, afterHoursResponse } = require(path.join(BOT_DIR, 'scenarios.js'));

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex').slice(0, 10);

async function main() {
    if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL 미설정 (.env 확인)'); process.exit(1); }
    // 테이블 보장 (배포 전 실행해도 동작하도록 initDB와 동일 DDL)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS inquiry_scenarios (
            id SERIAL PRIMARY KEY, scenario_no INTEGER NOT NULL, name VARCHAR(100) NOT NULL,
            keywords JSONB NOT NULL DEFAULT '[]', response TEXT NOT NULL,
            action VARCHAR(20) NOT NULL DEFAULT '자동응답', enabled BOOLEAN NOT NULL DEFAULT true,
            channel VARCHAR(20) NOT NULL DEFAULT '톡톡', updated_by VARCHAR(50),
            updated_at TIMESTAMP DEFAULT NOW(), deleted_at TIMESTAMP)`);
    const cnt = (await pool.query('SELECT COUNT(*)::int AS c FROM inquiry_scenarios')).rows[0].c;
    if (cnt > 0) { console.error(`❌ 이미 ${cnt}건 존재 — 중복 이관 방지를 위해 중단합니다`); process.exit(1); }

    const rows = [
        { no: 0, name: '영업시간 외 자동응대', keywords: [], response: afterHoursResponse },
        ...scenarios.map((s, i) => ({ no: i + 1, name: s.name, keywords: s.keywords, response: s.response })),
    ];
    for (const r of rows) {
        await pool.query(
            `INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, channel, enabled, updated_by)
             VALUES ($1,$2,$3,$4,'자동응답','톡톡',true,'이관스크립트')`,
            [r.no, r.name, JSON.stringify(r.keywords), r.response]);
    }
    // 대조표: DB에서 다시 읽어 원본과 비교 (번호·이름·키워드수·md5·바이트수)
    const db = (await pool.query(`SELECT scenario_no, name, keywords, response FROM inquiry_scenarios ORDER BY scenario_no`)).rows;
    let allOk = true;
    console.log('번호 | 일치 | 이름 | 키워드수 | 문구md5 | 바이트');
    for (const r of rows) {
        const d = db.find(x => x.scenario_no === r.no);
        const ok = d && d.name === r.name && d.response === r.response
            && JSON.stringify(d.keywords) === JSON.stringify(r.keywords);
        if (!ok) allOk = false;
        console.log(`${String(r.no).padStart(2)} | ${ok ? '✅' : '❌'} | ${r.name} | ${r.keywords.length} | ${md5(r.response)} | ${Buffer.byteLength(r.response, 'utf8')}`);
    }
    console.log(allOk ? `\n✅ ${rows.length}건 전부 원본과 바이트 단위 일치` : '\n❌ 불일치 발견 — 위 표의 ❌ 행 확인');
    await pool.end();
    process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error('❌ 이관 실패:', e.message); process.exit(1); });

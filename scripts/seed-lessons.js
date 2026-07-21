// 대표 승인 시작 학습 노트 시드 (2026-07-21) — 요원별 핵심 교훈을 active로 1회 등록 (중복 시 건너뜀).
// 사용: node scripts/seed-lessons.js   (DATABASE_URL 필요 — .env)
require('dotenv').config();
const { Pool } = require('pg');

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);

// 대표 승인분 (2026-07-21). 마루 메뉴 이해는 프롬프트 용어집으로 처리, 한수 비교는 세미가 담당하므로 제외.
const LESSONS = {
    semi: [
        ['재무', '택배비는 CJ 박스당 3,100원 기준으로 계산한다.'],
        ['정직', '조회 결과가 0건이면 지어내지 말고 기간을 확인하고 데이터가 있는 가장 가까운 달을 안내한다.'],
    ],
    geulsaem: [
        ['충실', '대표가 이번 지시에서 말한 강점을 카피 중심으로 삼고, 대표가 언급하지 않은 셀링포인트를 임의로 강조하지 않는다.'],
        ['정확', '쿠폰·행사 마감일은 본문에 요일 포함해 명확히 쓴다.'],
    ],
    miso: [
        ['브랜드', '톡톡·발송용 이미지는 판매 배너(큰 타이틀·쿠폰 스티커·이벤트 뱃지)로 만들고, 아꼼이 캐릭터는 참조 이미지 그대로 유지한다. 돌담·바다 배경은 과용하지 않는다.'],
    ],
    jiyul: [
        ['노무', '오션라운지는 5인 미만(연장·야간·연차 가산 면제), 법인은 5인 이상 전면 적용. 소속이 불명확하면 되묻는다.'],
        ['정직', '노무지침 밖 사안은 추측하지 말고 노무사 확인을 안내한다.'],
    ],
    yeri: [
        ['정직', '예리는 대표가 준 데이터를 정리·집계하는 담당이다. 데이터·표본이 없으면 추정치를 지어내지 말고 "데이터 없음"으로 정직하게 보고한다.'],
    ],
};

(async () => {
    let added = 0, skipped = 0;
    try {
        for (const [code, items] of Object.entries(LESSONS)) {
            const aq = await pool.query(`SELECT id, name FROM agents WHERE code = $1 AND is_deleted = false LIMIT 1`, [code]);
            const agent = aq.rows[0];
            if (!agent) { console.log(`⚠️ 요원 없음: ${code} — 건너뜀`); continue; }
            for (const [category, lesson] of items) {
                const dup = await pool.query(
                    `SELECT 1 FROM agent_lessons WHERE agent_id = $1 AND lesson = $2 AND is_deleted = false LIMIT 1`,
                    [agent.id, lesson]);
                if (dup.rows.length) { console.log(`  = 이미 있음 [${agent.name}] ${lesson.slice(0, 20)}...`); skipped++; continue; }
                await pool.query(
                    `INSERT INTO agent_lessons (agent_id, lesson, category, status, source_feedback_ids, approved_at)
                     VALUES ($1, $2, $3, 'active', '[]', NOW())`,
                    [agent.id, lesson, category]);
                console.log(`  + 등록 [${agent.name}·${category}] ${lesson.slice(0, 30)}...`);
                added++;
            }
        }
        console.log(`\n✅ 완료: 신규 ${added}건 / 중복 건너뜀 ${skipped}건`);
    } catch (e) {
        console.error('❌ 시드 실패:', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();

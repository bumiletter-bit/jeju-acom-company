// #496-b(직원 검토 2차 10/1 13:3x · 대표 「원래 답변하던 대로」): 파손·짓무름 클레임 답(공통 채널 #51)에 「상품 사진 첨부하시어 스토어 톡톡 또는 📞」 복원
//   톡톡 #2·#3·#4·#13엔 📸 줄이 있는데 공통/상품문의가 쓰는 #51(맛 보증·무료수거 반품)엔 없어서 레몬 #18·하우스 #17 답에 사진 안내가 빠짐
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코 총괄(#496-b · 사진 첨부 안내 복원)';
const A = '일부만 아쉬운 경우에는 상품 회수 없이 네이버페이 포인트 부분환불로도 처리해드려요.';
const B = '일부만 아쉬운 경우에는 상품 회수 없이 네이버페이 포인트 부분환불로도 처리해드려요.\n📸 파손·물러진 부분은 상품 사진을 첨부하시어 스토어 톡톡 또는 📞 010-6687-4031로 연락 주시면 확인 후 빠르게 처리해드릴게요.';
const KW = ['물렀', '물러', '파손', '상했', '곰팡이', '짓물', '썩은', '깨졌', '터졌'];
(async () => {
    const r = (await pool.query(`SELECT id, response, keywords FROM inquiry_scenarios WHERE scenario_no = 51 AND deleted_at IS NULL`)).rows[0];
    const done = r.response.includes(B) && !r.response.replace(B, '').includes(A);
    if (done) console.log('#51 본문: 이미 반영');
    else if (!r.response.includes(A)) { console.log('❌ #51 찾는 줄 없음'); }
    else {
        const next = r.response.replace(A, B);
        await pool.query(`UPDATE inquiry_scenarios SET response = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [r.id, next, ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update','inquiry_scenario',$1,$2,'agent_office',$3)`, [r.id, JSON.stringify({ before: { response: r.response }, after: { response: next }, note: '#496-b 사진 첨부 안내' }), ACTOR]);
        console.log('#51 본문: 📸 줄 추가');
    }
    const kw = Array.isArray(r.keywords) ? r.keywords : JSON.parse(r.keywords || '[]');
    const add = KW.filter(k => !kw.includes(k));
    if (add.length) {
        await pool.query(`UPDATE inquiry_scenarios SET keywords = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [r.id, JSON.stringify(kw.concat(add)), ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update','inquiry_scenario',$1,$2,'agent_office',$3)`, [r.id, JSON.stringify({ before: { keywords: kw }, after: { keywords: kw.concat(add) }, note: '#496-b 파손·짓무름 키워드' }), ACTOR]);
        console.log('#51 키워드 추가:', add.join(', '));
    } else console.log('#51 키워드: 이미 반영');
    await pool.end();
    console.log('✅ 완료 (톡톡봇 캐시 5분)');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

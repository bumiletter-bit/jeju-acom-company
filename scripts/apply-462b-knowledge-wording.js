// #462-b: 시기 지식 #14에 추가한 마감 후 안내 줄의 조건을 분명하게 — 「선물로 괜찮나요?」처럼 맛·품질만 물어도 '선물' 단어가 있으면 9/27 발송을 먼저 알리게
require('dotenv').config(); const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #462 추석 발송 마감 후 응대 정리)';
const OLD = '선물 추천·단체 주문·품목 문의처럼 손님이 날짜를 묻지 않은 문의에도, 선물·명절·추석 이야기가 나오면 **첫머리에';
const NEW = '선물 추천·단체 주문·품목 문의처럼 손님이 날짜를 묻지 않은 문의에도, 문의에 「선물」「선물용」「명절」「추석」 단어가 하나라도 있으면(맛·품질·가격만 물어도) **첫머리에';
(async () => {
    const k = (await pool.query(`SELECT knowledge FROM product_season_knowledge WHERE id=14 AND deleted_at IS NULL`)).rows[0];
    if (k.knowledge.includes(NEW)) { console.log('이미 적용'); return pool.end(); }
    if (k.knowledge.split(OLD).length !== 2) throw new Error('대상 문장 없음');
    await pool.query(`UPDATE product_season_knowledge SET knowledge=$1, updated_by=$2, updated_at=now() WHERE id=14`, [k.knowledge.replace(OLD, NEW), ACTOR]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','product_season_knowledge',14,$1,'claude-code',NULL,$2)`, [JSON.stringify({ note: '#462-b 마감 후 안내 줄 조건 명확화', before: OLD, after: NEW }), ACTOR]);
    console.log('✅ 시기 지식 #14 조건 문구 교체'); await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

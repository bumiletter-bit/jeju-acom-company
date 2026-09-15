// #445-b: 지식 id 14 도착 희망 규칙을 발송휴무 달력 실값(9/22 = 발송 휴무·도착 가능 / 9/23~26 = 도착 불가)과 정확히 일치시킴 — audit
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #445 도착 희망 예시)';
const OLD = '\n★ 도착 희망(수령일) 문의: 예시 날짜를 지어서 안내할 땐 9월 22일~26일(택배 휴무·연휴)은 절대 쓰지 말 것. 명절 전 도착 희망은 「9월 20일(일)~21일(월) 도착 희망」(9월 21일 오전 8시 이전 주문)으로, 연휴 중 날짜(9/22~26) 도착 지정을 요청하면 「연휴 중 도착은 불가 — 9월 21일 발송분으로 미리 받으시거나 9월 27일 이후 도착」으로 안내.';
const NEW = '\n★ 도착 희망(수령일) 문의: 예시 날짜를 지어서 안내할 땐 9월 23일(수)~26일(토)(택배 휴무·도착 불가)은 절대 쓰지 말 것. 9월 22일(화)은 발송은 없지만 21일 발송분이 도착하는 날. 명절 전 도착 희망은 「9월 21일(월) 오전 8시 이전 주문 → 21일 발송 → 22일(화) 도착」으로 안내(더 앞당기려면 20일 이전 주문). 9/23~26 도착 지정을 요청하면 「그 날짜 도착은 불가 — 21일 발송분(22일 도착)으로 미리 받으시거나 9월 27일 이후 발송분」으로 안내.';
(async () => {
    const k = (await pool.query('SELECT * FROM product_season_knowledge WHERE id=14 AND deleted_at IS NULL')).rows[0];
    if (!k.knowledge.includes(OLD)) { console.log(k.knowledge.includes(NEW) ? '  이미 반영' : '❌ 원문 불일치'); await pool.end(); return; }
    const after = (await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_by=$2, updated_at=now() WHERE id=14 RETURNING *', [k.knowledge.replace(OLD, NEW), ACTOR])).rows[0];
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','season_knowledge',14,$1,'season-knowledge',NULL,$2)`, [JSON.stringify({ before: { knowledge: k.knowledge }, after: { knowledge: after.knowledge }, note: '#445-b 달력 실값(9/22 도착 가능·9/23~26 불가)에 맞춤' }), ACTOR]);
    console.log('✅ 지식 14 규칙 교정'); await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

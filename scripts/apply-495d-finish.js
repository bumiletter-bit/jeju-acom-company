// #495-d(마감): ① 지식 28(유라조생 10월)에 「타이벡은 11월부터」 한 줄(시나리오 선택과 무관하게 답하도록) ② 결과 파일의 합포장 2건 = 대표 확정(10/1 A 「합쳐서 발송 안 됨」)과 일치 → ✅로 판정 갱신
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코 총괄(#495-d 마감)';
(async () => {
    const ADD = ' 「타이벡 감귤은 언제부터」 질문에는 「11월부터(유라조생 마감 뒤) 판매 시작 · 정확한 날짜는 미정 · 상품페이지 알림받기」로 답하세요 — 품절·재입고 안내로 끝내지 말 것.';
    const r = (await pool.query(`SELECT id, knowledge FROM product_season_knowledge WHERE id = 28 AND deleted_at IS NULL`)).rows[0];
    if (r.knowledge.includes(ADD.trim())) console.log('지식 28: 이미 반영');
    else {
        const next = r.knowledge.trimEnd() + ADD;
        await pool.query(`UPDATE product_season_knowledge SET knowledge = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [r.id, next, ACTOR]);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update','season_knowledge',$1,$2,'agent_office',$3)`, [r.id, JSON.stringify({ before: { knowledge: r.knowledge }, after: { knowledge: next }, note: '#495-d 타이벡 11월부터' }), ACTOR]);
        console.log('지식 28: 타이벡 11월 한 줄 추가');
    }
    await pool.end();
    const f = path.join(__dirname, 'qbank-495-results.json');
    const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
    let n = 0;
    for (const x of rows) {
        if ((x.product === '하우스감귤' && x.no === 19) || (x.product === '황금향' && x.no === 15)) {
            if (x.verdict !== '✅') { x.prev_verdict_495d = x.verdict; x.verdict = '✅'; x.reason = '(총괄 재판정) 「서로 다른 품목은 합포장 안 됨·품목별 따로 포장」 = 대표 확정 사실(10/1)과 일치' + (x.no === 15 ? ' · VIP 선물용 페이지 링크 안내 ✅' : ' · 같은 날 발송·비슷한 시기 도착 ✅'); n++; }
        }
    }
    fs.writeFileSync(f, JSON.stringify(rows, null, 1));
    const c = {}; for (const x of rows) c[x.verdict] = (c[x.verdict] || 0) + 1;
    console.log('재판정', n, '건 · 최종', JSON.stringify(c));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

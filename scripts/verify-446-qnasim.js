// #446 검증: 연휴 발송 팩트(연휴 중 주문 = 27일 발송 · 22일 도착만 · 23~26 도착 없음) + 보내는이 표기 결론 먼저 + 무회귀
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 260) : '')); };
async function runner(reqKey, resKey, req, ms = 300000) {
    await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
    await pool.query(`INSERT INTO agent_office_config (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
    throw new Error('runner timeout');
}
(async () => {
    const cases = [
        { q: '추석 연휴에도 배송되나요? 9월 24일 도착 가능해요?', product: '하우스감귤' },
        { q: '추석 연휴에 주문하면 언제 발송돼요?', product: null },
        { q: '9월 23일에 주문하면 언제 와요?', product: '황금향' },
        { q: '보내는 사람 이름 넣어서 보낼 수 있어요?', product: null },
        { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: null },
        { q: '황금향 오늘 주문하면 언제 도착해요?', product: '황금향' },
    ];
    const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
    const rs = s.results || s.cases || [];
    const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
    for (let i = 0; i < cases.length; i++) console.log(`\n  Q${i + 1}: ${cases[i].q}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 800)}`);
    const lumped = /발송\s*[·,]\s*도착\s*(이|가)?\s*모두\s*불가|발송·도착이 모두/;
    ok(/27일/.test(A(0)) && /22일.{0,12}도착/.test(A(0)) && !lumped.test(A(0)), 'Q1 연휴 배송: 27일 발송·22일 도착 구분·「발송·도착 모두 불가」 뭉뚱그림 0');
    ok(/27일/.test(A(1)) && /발송/.test(A(1)), 'Q2 연휴 중 주문 → 27일 발송');
    ok(/27일/.test(A(2)) && /28일|29일/.test(A(2)), 'Q3 9/23 주문 → 27일 발송·28~29 도착');
    ok(/(성함|이름).{0,20}(표기|가능|넣)/.test(A(3)) && /드림/.test(A(3)), 'Q4 보내는 분 표기: 결론(가능) + 방법(○○○ 드림)');
    ok(/21일/.test(A(4)) && /8시/.test(A(4)) && /22일/.test(A(4)), 'Q5 명절 전 마감 21일 08시·22일 도착 (무회귀)');
    ok(/16일|발송/.test(A(5)) && !/27일 발송/.test(A(5)), 'Q6 오늘 주문 일반 일정 (연휴 안내 오염 0)');
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

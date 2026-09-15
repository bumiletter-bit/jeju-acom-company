// #445 검증: 실서버 qna_sim — 수령일 문의에 연휴 날짜(9/22~26) 도착 예시 0 · 명절 전 = 9/21 발송 · 무회귀(메시지카드 #58·배편 결항 #24/#27 유지·발송 일정)
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
        { q: '수령일 지정 가능한가요? 원하는 날짜에 받을 수 있어요?', product: null },
        { q: '추석 선물인데 9월 24일에 도착하게 해주실 수 있나요?', product: null },
        { q: '명절 전에 받으려면 언제까지 주문해야 해요?', product: null },
        { q: '선물이라 날짜 맞춰서 보내주실 수 있나요?', product: null },
        { q: '메시지카드 넣어주실 수 있나요?', product: null },
        { q: '황금향 오늘 주문하면 언제 도착해요?', product: '황금향' },
    ];
    const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
    const rs = s.results || s.cases || [];
    const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
    for (let i = 0; i < cases.length; i++) console.log(`\n  Q${i + 1}: ${cases[i].q}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 700)}`);
    const badDate = /9월\s*2[2-6]일\s*(도착|수령)|9\/2[2-6]\s*(도착|수령)/;
    ok(!badDate.test(A(0)) && /도착 희망|수령일/.test(A(0)), 'Q1 수령일 지정: 연휴 날짜(9/22~26) 도착 예시 0 · 지정 방법 안내');
    ok(!/24일에? 도착 가능|24일 도착으로|24일에 맞춰/.test(A(1)) && /21일|27일|연휴|불가/.test(A(1)), 'Q2 9/24 도착 요청: 불가·21일 발송분 또는 27일 이후 안내');
    ok(/21일/.test(A(2)) && /8시/.test(A(2)), 'Q3 명절 전 주문 마감: 9월 21일 오전 8시');
    ok(!badDate.test(A(3)), 'Q4 날짜 맞춰 발송: 연휴 날짜 예시 0');
    ok(/카드|가능/.test(A(4)) && !/도착 희망/.test(A(4)), 'Q5 메시지카드(#58) 무회귀');
    ok(/발송|도착/.test(A(5)) && !badDate.test(A(5)), 'Q6 발송 일정 무회귀');
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

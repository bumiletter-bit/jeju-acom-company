// #449 검증(봇): 시나리오 #59 「추석 이벤트 안내」 — 이벤트 질문 → 자동 응모·22명·발표 9/21·확인 링크 / 무회귀(추석 마감·황금향 가격·청귤 종료)
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
        { q: '추석 이벤트 하고 있던데 저도 응모된 건가요? 따로 신청해야 해요?', product: '황금향' },
        { q: '이벤트 당첨자 발표 언제예요? 당첨 확인은 어떻게 해요?', product: null },
        { q: '경품 뭐뭐 있어요?', product: null },
        { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: null },
        { q: '황금향 선물용 5kg 얼마예요?', product: '황금향' },
        { q: '청귤 지금 주문 가능한가요?', product: '청귤' },
    ];
    const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
    const rs = s.results || s.cases || [];
    const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
    for (let i = 0; i < cases.length; i++) console.log(`\n  Q${i + 1}: ${cases[i].q}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 900)}`);
    const link = /event\.akkome\.com\/lucky\.html/;
    ok(/자동 응모|자동으로 응모/.test(A(0)) && link.test(A(0)), 'Q1 응모 여부 → 자동 응모·확인 링크');
    ok(/9월 21일|21일/.test(A(1)) && /(성함|이름).{0,20}(휴대폰|번호)/.test(A(1)) && link.test(A(1)), 'Q2 발표일 9/21·성함/번호 조회·링크');
    ok(/22명/.test(A(2)) && /황금향 5kg/.test(A(2)) && /감귤 3kg/.test(A(2)), 'Q3 경품 = 22명·1~3등 구성');
    ok(/21일/.test(A(3)) && /8시/.test(A(3)) && !link.test(A(3)), 'Q4 추석 마감 무회귀(이벤트 링크 오염 0)');
    ok(/62,800/.test(A(4)) && !link.test(A(4)), 'Q5 황금향 5kg 가격 무회귀(이벤트 링크 오염 0)');
    ok(/마감|종료|판매할 수 없/.test(A(5)) && !link.test(A(5)), 'Q6 청귤 종료 무회귀(이벤트 링크 오염 0)');
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

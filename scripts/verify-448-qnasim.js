// #448 검증: 청귤 마감 안내 — 「마감 전 주문 정상 발송」 문구 0 · 마감·내년·알림받기 결론 · 무회귀(청귤청·하우스감귤·추석 마감)
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
        { q: '안녕하세요 수량이 잘못되서 추가 주문하려니 품절이라서요ㅠㅠ. 오늘까지 주문이었던 것 같아 잽싸게 하려니..안되네요.. 어떻게 10키로만 더 안될까요?', product: '청귤' },
        { q: '청귤 지금 주문 가능한가요? 오늘 발송되나요?', product: '청귤' },
        { q: '청귤 언제까지 팔아요?', product: null },
        { q: '청귤청 어떻게 담가요?', product: null },
        { q: '하우스감귤 얼마예요?', product: '하우스감귤' },
        { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: null },
    ];
    const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
    const rs = s.results || s.cases || [];
    const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
    for (let i = 0; i < cases.length; i++) console.log(`\n  Q${i + 1}: ${cases[i].q}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 900)}`);
    const shipTalk = /(마감 전|마감전|이미 주문|기존 주문|주문해주신|주문하신).{0,30}(정상 발송|순서대로|순차|발송되고|발송 중)/;
    const closed = /마감|종료|판매할 수 없/;
    const nextYear = /내년/;
    const alarm = /알림받기|알림 받기/;
    ok(closed.test(A(0)) && nextYear.test(A(0)) && alarm.test(A(0)), 'Q1 캡처 재현(추가 10kg) → 올해 마감·내년 안내·알림받기 결론');
    ok(!shipTalk.test(A(0)), 'Q1 「마감 전 주문 정상 발송」류 발송 안내 0');
    ok(closed.test(A(1)) && !/오늘 (바로 )?발송 가능|지금 주문하시면/.test(A(1)) && !shipTalk.test(A(1)), 'Q2 지금 주문? → 불가·오늘발송 0·발송 안내 0');
    ok(/9월 15일|마감/.test(A(2)) && alarm.test(A(2)) && !shipTalk.test(A(2)), 'Q3 언제까지 → 9/15 마감·알림받기·발송 안내 0');
    ok(/설탕|슬라이스|세척/.test(A(3)), 'Q4 청귤청 담그기 무회귀');
    ok(/하우스감귤|귤/.test(A(4)) && !/청귤/.test(A(4)), 'Q5 하우스감귤 무회귀(청귤 언급 0)');
    ok(/21일/.test(A(5)) && /8시/.test(A(5)), 'Q6 추석 마감 21일 08시 무회귀');
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

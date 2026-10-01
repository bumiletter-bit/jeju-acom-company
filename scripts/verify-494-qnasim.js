// #494 검증(실서버·실AI · 상품문의 채널 재현 · 콘솔 과금 — 대표 GO): #492 ⚠️ 4건이 데이터 반영 뒤 고쳐졌는지 + 무회귀 2
//   node scripts/verify-494-qnasim.js   (3문항씩 2배치 · 각 최대 8분)
require('dotenv').config(); const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d ? ' — ' + String(d).slice(0, 220) : '')); };
const CASES = [
    { q: '귤이랑 황금향 같이 주문하면 한 박스에 같이 보내주나요?', product: null, t: 'A 합포장: 품목별 따로 포장·합포장 안 됨', chk: a => /따로|각각/.test(a) && /(합포장|한 박스|같이|섞)/.test(a) && !/반반/.test(a) },
    { q: '황금향이랑 한라봉 중에 뭐가 더 달아요?', product: '황금향', t: 'B 만감류 비교: 황금향만 판매 중·한라봉 1~3월·각 장점(직원 넘김 아님)', chk: a => /황금향/.test(a) && /한라봉/.test(a) && /(1~3월|1월|취향|과즙|향)/.test(a) && !/직원|담당자가 확인/.test(a) },
    { q: '유라조생은 언제까지 팔아요? 11월에도 살 수 있나요?', product: '유라조생', t: 'C 유라 기간: 10월·11월 전쯤 마감·그 뒤 일반 조생/타이벡', chk: a => /10월/.test(a) && /(11월 전|마감)/.test(a) && /(조생|타이벡)/.test(a) },
    // D: 「추석 선물 문의 감사」 0 + 지금 시기 = 황금향 + 선물용 페이지(링크) — 한라봉·레드향 시기는 물었을 때만 나오면 되므로 필수 아님(10/1 실답: 「추석은 지났지만 선물세트 상시 주문 가능 · 황금향 제철 · VIP 선물용 페이지」)
    { q: '추석 선물세트 아직 있나요?', product: null, t: 'D 선물용 페이지: 「추석 선물 문의 감사」 0 · 황금향 시기 · 선물용 페이지 안내', chk: a => !/추석 선물 문의/.test(a) && /황금향/.test(a) && /(선물용|10801253976)/.test(a) },
    { q: '레드키위 5kg 얼마예요?', product: '레드키위', t: '무회귀: 레드키위 5kg 50,800', chk: a => /50,800/.test(a) },
    { q: '하우스감귤 선물용 3kg 가격이요', product: '하우스감귤', t: '무회귀: 하우스 선물 3kg 34,500', chk: a => /34,500/.test(a) },
];
async function run(pool, cases) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('qna_sim_request',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ cases: cases.map(c => ({ q: c.q, product: c.product })) })]);
    let v = null; const t0 = Date.now();
    while (Date.now() - t0 < 560000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`); break; } }
    if (!v) throw new Error('runner timeout'); return v.results || [];
}
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const all = [];
    for (let i = 0; i < CASES.length; i += 3) { const rs = await run(pool, CASES.slice(i, i + 3)); all.push(...rs); }
    await pool.end();
    CASES.forEach((c, i) => { const a = String((all[i] || {}).answer || ''); console.log(`\n  [${c.t.split(':')[0]}] ${c.q}\n  A: ${a.replace(/\n/g, '⏎').replace(/\*추가 문의사항.*$/, '').slice(0, 420)}`); });
    console.log(''); CASES.forEach((c, i) => { const a = String((all[i] || {}).answer || ''); ok(c.chk(a), c.t); });
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

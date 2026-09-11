/* #432 검증 — Render 실서버 qna_sim(생성만·발송 0): ①추석 추천 답변에 시즌종료/품절 줄 0 ②9/22 주문 → 연휴 9/22~26 전체·9/27 발송 ③밤호박 → 시즌종료 안내 유지(AI 재료 무회귀) ④청귤 #38 문구 중립 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [JSON.stringify({ cases: [
            { q: '추석 선물로 뭐가 좋을까요?', product: null },
            { q: '9월 22일에 주문하면 언제 발송돼요?', product: '황금향' },
            { q: '지금 미니밤호박 살 수 있어요?', product: null },
            { q: '청귤 얼마예요?', product: '청귤' },
        ] })]);
    const t0 = Date.now(); let v = null;
    while (Date.now() - t0 < 300000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; break; } }
    if (!v || v.error) throw new Error('러너 ' + (v ? v.error : '타임아웃'));
    const A = (v.results || []).map(r => String(r.answer || ''));
    for (const r of v.results) console.log('\n▶', r.q, '\n' + String(r.answer || '').replace(/\n{2,}/g, '\n').slice(0, 900));
    ok(!/시즌종료|품절/.test(A[0]) && /황금향|하우스감귤/.test(A[0]), '① 추석 추천: 시즌종료·품절 줄 0 · 판매중 추천', (A[0].match(/시즌종료|품절/g) || []).length + '회');
    ok(/9\/27|9월 27일/.test(A[1]) && (/26/.test(A[1]) || /9\/22.{0,6}(26|9\/26)/.test(A[1])), '② 9/22 주문: 9/27 발송 · 연휴 끝(26일)까지 언급', (A[1].match(/[^\n]{0,20}(26|9\/27)[^\n]{0,20}/) || [''])[0]);
    ok(/시즌종료|판매.{0,4}종료|종료/.test(A[2]) && !/판매중/.test(A[2].split('\n').filter(l => /밤호박/.test(l)).join('\n')), '③ 밤호박: 시즌종료 안내 유지(무회귀)', (A[2].match(/[^\n]{0,30}종료[^\n]{0,20}/) || [''])[0]);
    ok(/18,800/.test(A[3]) && !/산도가 가장 좋을 때/.test(A[3]) && !/시즌종료/.test(A[3]), '④ 청귤 가격 답변: 18,800 · #38 옛 문구 0 · 시즌종료 줄 0', '');
    ok(v.results.every(r => !r.error && r.answer), '⑤ 4건 생성 성공');
    await pool.end();
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

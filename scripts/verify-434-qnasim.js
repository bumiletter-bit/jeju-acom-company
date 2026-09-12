/* #434 검증 — Render 실서버 qna_sim(생성만·발송 0): ①밤호박 문의 = 시즌종료 결론이 앞에·무관한 판매현황 나열 0 ②레몬 문의 = 침묵 대신 "시즌종료·가을 그린레몬" 확답 ③품절 시나리오 링크 1줄 ④일반 문의 무회귀 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [JSON.stringify({ cases: [
            { q: '밤호박 언제 다시 판매해요?', product: null },
            { q: '미니밤호박 5kg 주문하고 싶은데 품절이에요?', product: '미니밤호박' },
            { q: '레몬 지금 살 수 있어요?', product: null },
            { q: '그린레몬 예약 되나요?', product: null },
            { q: '청귤 얼마예요?', product: '청귤' },
        ] })]);
    const t0 = Date.now(); let v = null;
    while (Date.now() - t0 < 300000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; break; } }
    if (!v || v.error) throw new Error('러너 ' + (v ? v.error : '타임아웃'));
    const R = v.results || []; const A = R.map(r => String(r.answer || ''));
    for (const r of R) console.log('\n▶', r.q, '| skip=', r.skip, '\n' + String(r.answer || '(무응답)').replace(/\n{2,}/g, '\n').slice(0, 800));
    const listLines = s => (s.match(/^- .*판매중/gm) || []).length;
    ok(listLines(A[0]) === 0 && /시즌종료|판매.{0,6}종료/.test(A[0]) && /알림받기/.test(A[0]), '① 밤호박(재판매?): 판매현황 나열 0 · 시즌종료+알림받기', `나열 ${listLines(A[0])}줄`);
    ok(listLines(A[1]) === 0 && /시즌종료|품절|마감/.test(A[1]), '① 밤호박(5kg 품절?): 나열 0 · 결론 명시', `나열 ${listLines(A[1])}줄`);
    ok(!R[2].skip && /시즌/.test(A[2]) && /그린레몬|가을/.test(A[2]) && !/판매중|살 수 있/.test(A[2].split('\n').filter(l => /레몬/.test(l) && !/그린레몬|알림/.test(l)).join('')), '② 레몬(살 수 있어요?): 무응답 아님 · 시즌종료·가을 그린레몬 안내', (A[2].match(/[^\n]{0,30}(시즌|그린레몬)[^\n]{0,40}/) || [''])[0]);
    ok(!R[3].skip && /알림받기/.test(A[3]) && !/예약 가능|예약 받/.test(A[3]), '② 레몬(예약?): 무응답 아님 · 예약 확답 없이 알림받기', (A[3].match(/[^\n]{0,40}알림받기[^\n]{0,20}/) || [''])[0]);
    ok(/18,800/.test(A[4]) && /14일/.test(A[4]), '④ 청귤 가격 무회귀(18,800·14일 마감)', '');
    ok(R.every(r => r.skip || r.answer), '⑤ 생성 오류 0');
    await pool.end();
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

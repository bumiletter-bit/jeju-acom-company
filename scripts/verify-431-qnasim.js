/* #431 검증 — Render 실서버 qna_sim_request(생성만·게시/발송 0)로 톡톡 답변 재현 (배포 후 실행 · 현재 시각 기준)
   ① "지금 주문하면 오늘 출발?" (8시 경과 시각) → "오늘 발송/오늘 출발 가능" 표현 0 · 다음 발송일 안내 ② "청귤 언제까지?" → 14일 유도 · "15일까지" 0 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000); const hh = kst.getUTCHours(), mm = kst.getUTCMinutes();
    console.log('  현재 KST', `${hh}:${String(mm).padStart(2, '0')}`, hh >= 8 ? '(8시 마감 경과)' : '(8시 전)');
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [JSON.stringify({ cases: [
            { q: '지금 주문하면 오늘 출발 안되나요?', product: '청귤' },
            { q: '청귤 언제까지 주문할 수 있어요?', product: '청귤' },
            { q: '오늘 주문하면 언제 도착해요?', product: '황금향' },
        ] })]);
    const t0 = Date.now(); let v = null;
    while (Date.now() - t0 < 240000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; break; } }
    if (!v) throw new Error('러너 타임아웃');
    if (v.error) throw new Error('러너 오류 ' + v.error);
    const res = v.results || [];
    for (const r of res) console.log('\n▶', r.q, r.error ? 'ERR ' + r.error : '', '\n' + String(r.answer || '').replace(/\n{2,}/g, '\n'));
    const a0 = String((res[0] || {}).answer || ''), a1 = String((res[1] || {}).answer || ''), a2 = String((res[2] || {}).answer || '');
    const badToday = /오늘 (바로 )?(발송|출발)(이|도)? ?(가능|돼요|됩니다|됨)|서둘러/;
    if (hh >= 8) {
        ok(!badToday.test(a0) && !/지금 주문하(시)?면 오늘/.test(a0), '① 8시 경과: "오늘 발송 가능/서둘러" 표현 0', (a0.match(badToday) || [''])[0] || '없음');
        ok(/오전 8시/.test(a0) && /발송/.test(a0), '① 8시 마감 언급 + 다음 발송일 안내', (a0.match(/\d{1,2}\/\d{1,2}\([^)]+\)[^,\n]{0,14}발송/) || [''])[0]);
    } else {
        ok(/오전 8시/.test(a0), '① 8시 전: 8시 마감 조건부 안내', '');
    }
    ok(/14일/.test(a1) && !/15일까지/.test(a1), '② 청귤 마감: 14일 유도 · "15일까지" 0', (a1.match(/[^\n]{0,30}14일[^\n]{0,30}/) || [''])[0]);
    ok(!badToday.test(a2) || hh < 8, '③ 황금향 도착 문의도 8시 경과 시 오늘 발송 표현 0', (a2.match(badToday) || [''])[0] || '없음');
    ok(res.every(r => !r.error && r.answer), '④ 3건 생성 성공(오류 0)');
    await pool.end();
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

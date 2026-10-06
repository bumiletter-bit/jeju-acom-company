// #560 자사몰 지식 교정 뒤 봇 답 확인(qna_sim 러너 · 생성만 · 손님에게 안 나감)
require('dotenv').config(); const { Pool } = require('pg');
const cases = [ { q: '하우스감귤 받았는데 좀 새콤해요. 어떻게 먹어요?', product: '하우스감귤' }, { q: '하우스감귤 껍질이 초록색인데 덜 익은 거 아닌가요?', product: '하우스감귤' }, { q: '황금향은 후숙해서 먹어야 하나요? 보관은요?', product: '황금향' }, { q: '황금향 색이 아직 덜 노란데 익은 건가요?', product: '황금향' }, { q: '하우스감귤이랑 유라조생 중에 뭐가 더 달아요?', product: '유라조생' } ]; const _old = [
    { q: '자사몰도 있나요?', product: '하우스감귤' },
    { q: '자사몰 주소 좀 알려주세요. 거기서 사고 싶어요', product: '하우스감귤' },
    { q: '하우스감귤 2.5kg 로얄과 가격이 얼마예요?', product: '하우스감귤' },
    { q: '네이버 말고 다른 데서도 파나요?', product: '황금향' },
];
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const out = [];
    for (let i = 0; i < cases.length; i += 3) {
        const batch = cases.slice(i, i + 3);
        await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('qna_sim_request',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ cases: batch })]);
        const t0 = Date.now(); let rs = null;
        while (Date.now() - t0 < 400000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`); rs = q.rows[0].value.results || []; break; } }
        if (!rs) throw new Error('runner timeout');
        batch.forEach((b, k) => out.push({ q: b.q, a: String((rs[k] || {}).answer || '') }));
    }
    await pool.end();
    for (const o of out) {
        const a = o.a;
        console.log(`\nQ: ${o.q}\nA: ${a.replace(/\n/g, ' ⏎ ').slice(0, 600)}\n → 주소(akkome.com) ${/akkome\.com/.test(a) ? '있음 ✕' : '없음'} · 「자사몰」 ${/자사몰/.test(a) ? '나옴' : '안 나옴'} · 없다고 부정 ${/자사몰(은|이)? ?(없|운영하지 않)|스마트스토어에서만|스마트스토어를 통해서만/.test(a) ? '있음 ✕' : '없음'}`);
    }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

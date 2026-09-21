// #462 검증(실서버·실AI 재현): 추석 발송 마감 후 — 선물·단체·품목 문의에 「9/27 발송」을 먼저 알리고, 미리 주문·명절 전 도착 권유 0, VIP 링크 유지, 무회귀
//   ⚠️ 시기 지식 #14가 09-26에 소멸하면 「9/27 발송」 기대식(Q1~Q3의 날짜 부분)은 의도적으로 무효 — 그 뒤엔 링크·권유 문구만 본다.
require('dotenv').config(); const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d ? ' — ' + String(d).slice(0, 200) : '')); };
const LINK = /10801253976/, D27 = /9월\s*27일|9\/27|27일\(일\)/, PUSH = /조기\s*마감|미리\s*주문|서둘|추석\s*전(에)?\s*(도착|받)[^.\n]{0,12}(가능|원하시면)/;
const CASES = [
    { q: '황금향 맛이 어때요? 선물로 괜찮나요?', product: '황금향', t: 'Q1 품목(#36): 9/27 발송 먼저 · 링크 유지 · 미리 주문 권유 0', chk: a => D27.test(a) && LINK.test(a) && !PUSH.test(a) },
    { q: '부모님 선물로 뭐가 좋을까요? 추천해주세요', product: null, t: 'Q2 선물 추천(#56): 9/27 발송 먼저 · 링크 유지 · 권유 0', chk: a => D27.test(a) && LINK.test(a) && !PUSH.test(a) },
    { q: '회사 선물로 30박스 단체 주문하려는데요', product: '황금향', t: 'Q3 단체(#55): 9/27 발송 먼저 · 링크·고객센터·세금계산서 유지 · 권유 0 · 결제 단어 0', chk: a => D27.test(a) && LINK.test(a) && /010-6687-4031/.test(a) && !PUSH.test(a) && !/계좌|입금|이체/.test(a) },
    { q: '지금 주문하면 추석 전에 받을 수 있나요?', product: '하우스감귤', t: 'Q4 무회귀: 마감 지남 · 9/27 발송', chk: a => D27.test(a) && /어려|마감/.test(a) },
    { q: '황금향 선물용 5kg 얼마예요?', product: '황금향', t: 'Q5 무회귀: 가격 62,800', chk: a => /62,800/.test(a) },
    { q: '선물세트에 한라봉도 들어있나요?', product: null, t: 'Q6 무회귀: 세트 구성 = 황금향·하우스감귤(한라봉 없음)', chk: a => /황금향/.test(a) && /(없|않|아니)/.test(a) },
];
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('qna_sim_request',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ cases: CASES.map(c => ({ q: c.q, product: c.product })) })]);
    let v = null; const t0 = Date.now(); while (Date.now() - t0 < 480000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) { v = q.rows[0].value; await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`); break; } }
    await pool.end(); if (!v) throw new Error('runner timeout'); const rs = v.results || [];
    CASES.forEach((c, i) => { const a = String((rs[i] || {}).answer || ''); console.log(`\n  ${c.t.split(' ')[0]}: ${c.q}\n  A: ${a.replace(/\n/g, '⏎').replace(/\*추가 문의사항.*$/, '').slice(0, 520)}`); });
    console.log(''); CASES.forEach((c, i) => { const a = String((rs[i] || {}).answer || ''); ok(c.chk(a), c.t, !c.chk(a) ? (PUSH.test(a) ? '권유 문구: ' + (a.match(PUSH) || [''])[0] : !D27.test(a) ? '9/27 언급 없음' : !LINK.test(a) ? '링크 없음' : '') : null); });
    console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

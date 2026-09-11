/* #431 확장 재현 — 일반 발송/가격/옵션 + 추석 명절 시나리오 18문항 (Render 실서버 qna_sim_request · 생성만 · 게시/발송 0)
   결과는 사람이 정답 기준(휴무 달력·시기 지식·판매현황)과 대조. 6건/요청 상한 → 3묶음 순차. */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const Q = [
  // A. 일반 발송·가격·옵션
  { q: '지금 주문하면 언제 받을 수 있어요?', product: '청귤' },
  { q: '내일 아침에 주문하면 언제 출발해요?', product: '황금향' },
  { q: '토요일에 주문하면 언제 와요?', product: '하우스감귤' },
  { q: '황금향 선물용 5kg는 몇 개 들어있어요? 가격은요?', product: '황금향' },
  { q: '청귤 얼마예요? 5kg랑 10kg', product: '청귤' },
  { q: '하우스감귤 소과 2.5kg 얼마예요? 사이즈 지정도 되나요?', product: '하우스감귤' },
  // B. 추석
  { q: '추석 선물로 뭐가 좋을까요?', product: null },
  { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: '황금향' },
  { q: '9월 22일에 주문하면 언제 발송돼요?', product: '황금향' },
  { q: '회사에서 직원 30명한테 보내려는데 단체 주문 할인 되나요?', product: null },
  { q: 'VIP 선물세트에 한라봉이랑 천혜향도 들어있나요? 가격은요?', product: null },
  { q: '추석 연휴에도 배송되나요? 9월 24일 도착 가능해요?', product: '하우스감귤' },
  // C. 추석 후속·기타
  { q: '명절 선물 여러 군데 보내고 싶은데 명단은 어떻게 드리면 돼요?', product: null },
  { q: '황금향 선물용 3kg이랑 5kg 차이가 뭐예요? 과수 몇 개예요?', product: '황금향' },
  { q: '청귤 15일에 주문해도 되나요?', product: '청귤' },
  { q: '주문했는데 취소하고 싶어요', product: '청귤' },
  { q: '지금 미니밤호박 살 수 있어요?', product: null },
  { q: '오늘 오후에 주문하면 추석 전에 도착하나요?', product: '하우스감귤' },
];
async function runBatch(cases) {
  await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
  await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify({ cases })]);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) return q.rows[0].value; }
  throw new Error('러너 타임아웃');
}
(async () => {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  let out = `# 재현 검증 ${kst.toISOString().slice(0, 16).replace('T', ' ')} KST\n`;
  for (let i = 0; i < Q.length; i += 6) {
    const v = await runBatch(Q.slice(i, i + 6));
    if (v.error) { out += `\n[묶음 ${i / 6 + 1} 오류] ${v.error}\n`; continue; }
    for (const r of v.results || []) out += `\n\n▶ [${i / 6 + 1}] ${r.q}${r.error ? '  ERR ' + r.error : ''}\n${String(r.answer || '').replace(/\n{2,}/g, '\n')}`;
  }
  const f = process.env.SCR ? process.env.SCR + '/qnasim-wide.md' : 'qnasim-wide.md';
  fs.writeFileSync(f, out, 'utf8');
  console.log(out);
  console.log('\n(저장:', f + ')');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

/* #434 확장 질문지 — 밤호박(시즌종료)·레몬(비시즌) 12문항, Render 실서버 qna_sim(생성만·발송 0). 자동 판정 + 전문 출력(사람 검토용) */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const Q = [
  // 밤호박
  { q: '밤호박 언제 나와요?', product: null, k: 'p' },
  { q: '단호박 5kg 얼마예요?', product: null, k: 'p' },
  { q: '미니밤호박 예약 주문 되나요?', product: '미니밤호박', k: 'p' },
  { q: '밤호박 시즌 끝났어요? 내년엔 언제 팔아요?', product: null, k: 'p' },
  { q: '밤호박 못난이 10kg 재고 없나요?', product: '미니밤호박', k: 'p' },
  { q: '밤호박 대신 지금 먹기 좋은 거 추천해주세요', product: null, k: 'p-alt' },
  // 레몬
  { q: '레몬 5kg 가격 얼마예요?', product: null, k: 'l' },
  { q: '레몬청 담그려는데 제주 레몬 있나요?', product: null, k: 'l' },
  { q: '그린레몬 언제부터 판매해요?', product: null, k: 'l' },
  { q: '레몬 재입고 알림은 어떻게 받아요?', product: null, k: 'l' },
  { q: '레몬이랑 청귤 같이 주문 가능해요?', product: '청귤', k: 'l-mix' },
  { q: '못난이 레몬 10kg 판매하나요?', product: null, k: 'l' },
];
async function runBatch(cases) {
  await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
  await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify({ cases: cases.map(c => ({ q: c.q, product: c.product })) })]);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) return q.rows[0].value; }
  throw new Error('러너 타임아웃');
}
(async () => {
  const results = [];
  for (let i = 0; i < Q.length; i += 6) { const v = await runBatch(Q.slice(i, i + 6)); if (v.error) throw new Error(v.error); results.push(...(v.results || [])); }
  const listLines = s => (s.match(/^- .*판매중/gm) || []).length;
  results.forEach((r, i) => {
    const a = String(r.answer || ''), k = Q[i].k;
    console.log(`\n▶ [${i + 1}] ${r.q}  (skip=${r.skip})\n${a.replace(/\n{2,}/g, '\n').slice(0, 700)}`);
    if (k === 'p') ok(!r.skip && /시즌종료|판매.{0,4}종료|판매하지 않/.test(a) && listLines(a) === 0 && !/판매중/.test(a.split('\n').filter(l => /밤호박|단호박/.test(l)).join('')), `[${i + 1}] 밤호박: 시즌종료 명시 · 나열 0 · 밤호박을 판매중이라 하지 않음`, `나열 ${listLines(a)}`);
    else if (k === 'p-alt') ok(!r.skip && /황금향|감귤|청귤/.test(a) && !/밤호박.{0,10}판매중/.test(a), `[${i + 1}] 밤호박 대체 추천: 판매중 품목 추천`, '');
    else if (k === 'l') ok(!r.skip && /시즌|가을|그린레몬/.test(a) && !/판매중 \(|원\b.*레몬|레몬.*\d{1,3},\d{3}원/.test(a) && (!/재고|있어요/.test(a) || /없|않|아니에요|아니라/.test(a))   /* "알림 받아보실 수 있어요"의 '있어요'는 재고 표현이 아님 — 비시즌 부정어가 함께 있으면 통과 */, `[${i + 1}] 레몬: 비시즌 확답 · 가격/재고 있다고 안 함`, (a.match(/[^\n]{0,30}(시즌|그린레몬)[^\n]{0,30}/) || [''])[0]);
    else if (k === 'l-mix') ok(!r.skip && /청귤/.test(a) && /레몬/.test(a) && /시즌|판매하지 않|가을/.test(a), `[${i + 1}] 레몬+청귤 혼합: 청귤은 가능·레몬은 비시즌 구분`, '');
  });
  ok(results.every(r => !r.error), '생성 오류 0');
  await pool.end();
  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

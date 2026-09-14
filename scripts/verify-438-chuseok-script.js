/* #438 추석 대본 재현 — 24문항, Render 실서버 qna_sim(생성만·발송 0). 정답 기준: 휴무 달력(9/22~26 발송 없음·재개 9/27) · 추석 지식(마감 9/21 08:00 → 21일 발송·22일 도착) · 판매현황.
   자동 판정 + 전문 출력(사람 검토). 6건/요청 → 4묶음. */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const Q = [
  // A. 마감·일정
  { q: '추석 선물 언제까지 주문하면 명절 전에 받아요?', p: '황금향', chk: a => /9\/21|9월 21일/.test(a) && /8시/.test(a) && /22일|9\/22/.test(a), t: '마감 9/21 08시·22일 도착' },
  { q: '9월 18일에 주문하면 언제 도착해요?', p: '황금향', chk: a => /9\/18|18일/.test(a) && /발송/.test(a) && /(19|20|21)일|9\/(19|20|21)/.test(a), t: '9/18 주문 → 표 기준 발송·도착일' },
  { q: '9월 21일 오후에 주문하면 추석 전에 못 받나요?', p: '하우스감귤', chk: a => /9\/27|27일/.test(a) && !/21일.{0,12}발송.{0,20}(가능|돼요)/.test(a.replace(/오전 8시 이전[^\n]*/g, '')), t: '21일 오후 = 연휴 후 27일 발송' },
  { q: '추석 연휴 중에도 택배 오나요?', p: null, chk: a => /(22|26)일|9\/2[2-6]/.test(a) && /27/.test(a), t: '연휴 22~26 없음·27 재개' },
  { q: '추석 당일(25일) 배송돼요?', p: null, chk: a => /(안|없|불가|어려)/.test(a) && /27/.test(a), t: '당일 배송 불가·27 재개' },
  { q: '오늘 주문하면 언제 와요?', p: '황금향', chk: a => /발송/.test(a) && /도착/.test(a), t: '오늘 기준 표대로' },
  // B. 추천·구성·가격
  { q: '추석 선물 추천해주세요. 부모님 드릴 거예요', p: null, chk: a => /황금향/.test(a) && /감귤/.test(a) && !/밤호박|청귤/.test(a.split('\n').filter(l => /추천|주력/.test(l)).join('')), t: '황금향·감귤 추천(밤호박·청귤 제외)' },
  { q: '선물세트 뭐뭐 들어있어요? 한라봉도 있나요?', p: null, chk: a => /황금향/.test(a) && /감귤/.test(a) && /한라봉/.test(a) && /(없|아니|포함되어 있지)/.test(a), t: 'VIP = 황금향·감귤, 한라봉 없음' },
  { q: 'VIP 선물세트 가격이 얼마예요?', p: null, chk: a => /brand\.naver\.com|상품페이지|스토어/.test(a) && !/\d{2},\d{3}원.{0,6}세트/.test(a), t: '세트 가격 확답 X → 페이지 안내' },
  { q: '황금향 선물용 5kg 가격이랑 몇 개 들었어요?', p: '황금향', chk: a => /62,800/.test(a) && /13~25/.test(a), t: '62,800·13~25과' },
  { q: '하우스감귤 선물용 3kg 얼마예요?', p: '하우스감귤', chk: a => /34,500/.test(a), t: '34,500' },
  { q: '선물 포장 어떻게 돼요? 보자기나 가방 있어요?', p: '황금향', chk: a => /선물박스/.test(a) && /(부직포|외피)/.test(a), t: '선물박스+외피박스(+부직포 가방)' },
  // C. 단체·명단·배송지
  { q: '거래처 20곳에 보내려는데 어떻게 해야 해요?', p: null, chk: a => /명단/.test(a) && /010-6687-4031/.test(a), t: '명단·고객센터 안내' },
  { q: '단체 주문 할인 얼마나 돼요?', p: null, chk: a => !/\d{1,2}\s*%\s*할인|\d{1,3},\d{3}원\s*할인/.test(a) && /010-6687-4031/.test(a), t: '할인 숫자 확답 X·고객센터' },
  { q: '명단은 엑셀로 보내도 되나요? 어디로요?', p: null, chk: a => /엑셀/.test(a) && /(bumiletter@naver\.com|010-6687-4031|톡톡)/.test(a), t: '엑셀 OK·전달 경로' },
  { q: '보내는 사람 이름 넣어서 보낼 수 있어요?', p: null, chk: a => /(성함|이름).{0,20}(표기|가능|넣)/.test(a), t: '보내는 분 표기 가능' },
  { q: '세금계산서 발행 되나요?', p: null, chk: a => /세금계산서/.test(a) && /(가능|발행)/.test(a), t: '세금계산서 가능' },
  { q: '수령일을 22일로 맞춰서 보내주실 수 있어요?', p: '황금향', chk: a => /21일|9\/21/.test(a) || /22일|9\/22/.test(a), t: '수령일 지정 → 21일 발송·22일 도착 안내' },
  // D. 예외·마감 후
  { q: '추석 지나고 주문하면 언제 받을 수 있어요?', p: '하우스감귤', chk: a => /27|28|29/.test(a), t: '연휴 후 27 발송 ~ 28~29 도착' },
  { q: '청귤도 추석 선물로 괜찮아요?', p: '청귤', chk: a => /(14일|마감|9\/15)/.test(a) || /(황금향|감귤).{0,30}추천/.test(a), t: '청귤 14일 마감/선물은 황금향·감귤' },
  { q: '밤호박 선물세트 있나요?', p: null, chk: a => /시즌종료|판매.{0,4}종료|판매하지/.test(a), t: '밤호박 시즌종료' },
  { q: '추석 선물 주문했는데 주소 바꾸고 싶어요', p: null, chk: a => true, t: '(요청형 — 무응답 또는 안내 모두 허용)' },
  { q: '연휴 전에 받고 싶은데 지금 주문하면 확실히 되나요?', p: '황금향', chk: a => /(21일|9\/21)/.test(a) || /(도착|발송)/.test(a), t: '지금 주문 = 여유(표) + 21일 마감 안내' },
  { q: '명절 선물 메시지 카드 넣어줄 수 있어요?', p: null, chk: a => true, t: '(정책 미정 — 확답 회피 여부 검토)' },
];
async function runBatch(cases) {
  await pool.query(`DELETE FROM agent_office_config WHERE key='qna_sim_result'`);
  await pool.query(`INSERT INTO agent_office_config(key,value) VALUES('qna_sim_request',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [JSON.stringify({ cases: cases.map(c => ({ q: c.q, product: c.p })) })]);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='qna_sim_result'`); if (q.rows.length) return q.rows[0].value; }
  throw new Error('러너 타임아웃');
}
(async () => {
  const results = [];
  for (let i = 0; i < Q.length; i += 6) { const v = await runBatch(Q.slice(i, i + 6)); if (v.error) throw new Error(v.error); results.push(...(v.results || [])); }
  let out = '';
  results.forEach((r, i) => {
    const a = String(r.answer || '');
    out += `\n\n▶ [${i + 1}] ${r.q}  (skip=${r.skip})\n${a.replace(/\n{2,}/g, '\n')}`;
    console.log(`\n▶ [${i + 1}] ${r.q}  (skip=${r.skip})\n${a.replace(/\n{2,}/g, '\n').slice(0, 520)}`);
    ok(r.skip ? /요청형|정책 미정/.test(Q[i].t) : Q[i].chk(a), `[${i + 1}] ${Q[i].t}`, r.skip ? '무응답' : '');
  });
  fs.writeFileSync(process.env.SCR ? process.env.SCR + '/chuseok-script.md' : 'chuseok-script.md', out, 'utf8');
  console.log(`\n결과: ${pass}/${pass + fail}`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

/* #395 검증 — juso 실API 러너 (배포된 실서버가 env JUSO_API_KEY로 실검색 → 결과 회수)
   합격 기준(대표 지정): "제주특별자치도 제주시 연삼로 1066-31" → 정상 응답 + 우편번호
   + 회귀 케이스 1·6 검색어의 실응답 형식(roadAddrPart1/zipNo/bdNm)까지 확인 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require(require('path').join(__dirname, '..', 'node_modules', 'pg'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const KEYWORDS = [
  '제주특별자치도 제주시 연삼로 1066-31',   // 대표 지정 예시
  '선릉로86길 31',                          // 회귀 케이스 1의 검색어
  '서울 마포구 상암산로1길 24',              // 회귀 케이스 6 (실아파트 단지 — 상암 월드컵파크 4단지)
];
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 160) : '')); };

(async () => {
  await pool.query(`DELETE FROM agent_office_config WHERE key IN ('juso_test_request','juso_test_result')`);
  await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('juso_test_request', $1::jsonb)`,
    [JSON.stringify({ keywords: KEYWORDS })]);
  console.log('  … 플래그 등록 — 실서버 60초 폴러 대기 (최대 3분)');
  let out = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const r = await pool.query(`SELECT value FROM agent_office_config WHERE key='juso_test_result'`);
    if (r.rows.length) { out = r.rows[0].value; break; }
  }
  if (!out) { console.log('  ❌ 3분 내 결과 없음 — 서버 반영/폴러 확인 필요'); process.exit(1); }
  ok(out.hasKey === true, '실서버에 JUSO_API_KEY 존재', out.hasKey);
  ok(!out.error, '러너 오류 없음', out.error || '없음');
  for (const kw of KEYWORDS) {
    const res = (out.results || []).find(x => x.keyword === kw);
    const c = res && res.data && res.data.results && res.data.results.common;
    const list = (res && res.data && res.data.results && res.data.results.juso) || [];
    ok(c && c.errorCode === '0', `실API 정상 응답: ${kw}`, c ? c.errorCode + '/' + (c.errorMessage || '') : JSON.stringify(res && res.error));
    ok(list.length >= 1 && list[0].roadAddrPart1 && /^\d{5}$/.test(list[0].zipNo || ''), `  → 도로명+우편번호: ${list[0] ? list[0].roadAddrPart1 + ' [' + list[0].zipNo + ']' : '없음'}`, 'bdNm=' + JSON.stringify(list[0] && list[0].bdNm));
  }
  // 케이스 6 전제: 실아파트 단지 검색이 bdNm과 함께 정상 응답(동·호수 확인 로직의 실데이터 — hasDong 경로는 UI 회귀 ④에서 판정)
  const w = (out.results || []).find(x => x.keyword === '서울 마포구 상암산로1길 24');
  const wj = (w && w.data && w.data.results && w.data.results.juso) || [];
  ok(wj.length >= 1 && /월드컵파크/.test(wj[0].bdNm || ''), '케이스6 전제: 실아파트 단지 실응답(bdNm 확보)', JSON.stringify(wj.map(j => j.bdNm)));
  // 정리
  await pool.query(`DELETE FROM agent_office_config WHERE key='juso_test_result'`);
  await pool.end();
  console.log('\n═══ juso 실API: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

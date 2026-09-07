/* #428 최종 대조 — 판매중 5상품 전 옵션: 네이버 정본(실시간 channel-products) 결제가 vs 카페24 결제가(기본가+추가금) — 옵션 이름 키로 1:1
   (audit-400은 집합 대조라 "어느 옵션이 어긋났는지"를 못 보여줌 → 옵션별 표로 출력. 키 정규화 = server.js cafe24OptKey와 동일 사상) */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const NM = PROJ + '\\node_modules\\';
require(NM + 'dotenv').config({ path: PROJ + '\\.env' });
const { Pool } = require(NM + 'pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MAP = { 91: '5011476022', 92: '6400134206', 93: '5731582511', 94: '11126666859', 100: '10801253976' };
async function runner(reqKey, resKey, req) {
  await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
  await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [reqKey, JSON.stringify(req)]);
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) return q.rows[0].value; }
  throw new Error('러너 타임아웃 ' + reqKey);
}
function key(s) {
  const t = String(s || '').replace(/\s+/g, '');
  const fruit = (t.match(/하우스감귤|황금향|한라봉|천혜향|레드향|청귤|풋귤|미니밤호박|밤호박|카라향|수라향|세미놀|자몽|레몬|블러드오렌지|하귤|취나물|옥수수/) || [])[0] || '';
  const use = (t.match(/가정용|선물용|못난이|특품|프리미엄|한입|꼬마/) || [])[0] || '';
  const weight = (t.match(/\d+\.?\d*kg/) || [])[0] || (t.match(/\d+\+\d+개/) || [])[0] || '';
  const grade = (t.match(/로얄과|중소과|중대과|소과|대과|랜덤과|\d+~\d+과|\d+과전후/) || [])[0] || '';
  return [fruit, use, weight, grade].join('|');
}
(async () => {
  const nr = await runner('naver_query_request', 'naver_query_result', { calls: Object.values(MAP).map(no => ({ method: 'GET', path: `/external/v2/products/channel-products/${no}` })) });
  let bad = 0, total = 0, onlyOne = [];
  for (const [cno, nno] of Object.entries(MAP)) {
    const r = nr.results.find(x => x.path.endsWith('/' + nno));
    if (!r || !r.ok) { console.log(`❌ c${cno} 네이버 조회 실패`, r && r.error); bad++; continue; }
    const d = JSON.parse(r.data_str); const op = d.originProduct;
    const disc = (((op.customerBenefit || {}).immediateDiscountPolicy || {}).discountMethod || {}).value || 0;
    const base = op.salePrice - disc;
    const nOpts = {};
    const oc = (((op.detailAttribute || {}).optionInfo || {}).optionCombinations) || [];
    if (oc.length) for (const o of oc) { if (o.usable === false) continue; nOpts[key(o.optionName1 + ' ' + o.optionName2)] = { pay: base + o.price, name: (o.optionName2 || o.optionName1) }; }
    else nOpts['단일'] = { pay: base, name: '(옵션 없음)' };
    const pr = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,product_name,price,selling,display' } });
    const p = pr.raw.data.product; const cbase = Math.round(Number(p.price));
    const vr = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants` });
    const live = (vr.raw.data.variants || []).filter(v => v.display === 'T' && v.selling === 'T');
    console.log(`\n■ c${cno} ${op.name.slice(0, 26)} — 네이버 기준가 ${base.toLocaleString()} / 카페24 기본가 ${cbase.toLocaleString()} (${p.selling === 'T' ? '판매중' : '판매중지'}·${op.statusType})`);
    const seen = new Set();
    for (const v of live) {
      const txt = (v.options || []).map(o => o.value).join(' ');
      const k = (v.options || []).length ? key(txt) : '단일';
      const cpay = cbase + Number(v.additional_amount);
      const n = nOpts[k]; seen.add(k); total++;
      if (!n) { onlyOne.push(`c${cno} 카페24만: ${txt.slice(-30)} ${cpay.toLocaleString()}`); console.log(`   ⚪ ${txt.slice(-34).padEnd(34)} 카페24 ${cpay.toLocaleString().padStart(7)} | 네이버 —  (구성 차이)`); continue; }
      const same = cpay === n.pay; if (!same) bad++;
      console.log(`   ${same ? '✅' : '❌'} ${txt.slice(-34).padEnd(34)} 카페24 ${cpay.toLocaleString().padStart(7)} | 네이버 ${n.pay.toLocaleString().padStart(7)}${same ? '' : '  ← 차이 ' + (cpay - n.pay)}`);
    }
    for (const [k, n] of Object.entries(nOpts)) if (!seen.has(k)) { onlyOne.push(`c${cno} 네이버만: ${n.name} ${n.pay.toLocaleString()}`); console.log(`   ⚪ ${String(n.name).slice(-34).padEnd(34)} 카페24 —       | 네이버 ${n.pay.toLocaleString().padStart(7)}  (구성 차이)`); }
  }
  console.log(`\n${bad ? '❌ 결제가 불일치 ' + bad + '건' : '✅ 공통 옵션 ' + total + '건 전부 네이버 = 카페24 결제가'}`);
  if (onlyOne.length) console.log('ℹ️ 한쪽에만 있는 옵션(가격 오류 아님): ' + onlyOne.join(' / '));
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

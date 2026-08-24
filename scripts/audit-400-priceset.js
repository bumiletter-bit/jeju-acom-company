// #400 재감사: 이름 매칭 폐기 → 가격 「집합」 대조 (카페24 결제가 목록 vs 네이버 결제가 목록 — 정렬 비교)
require('C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램/node_modules/dotenv').config({ path: 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램/.env' });
const { Pool } = require('C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램/node_modules/pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MAP = { 91: '5011476022', 92: '6400134206', 93: '5731582511', 94: '11126666859', 100: '10801253976' };

async function runRaw(req) {
  await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
  await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await new Promise(r => setTimeout(r, 4000));
    const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`);
    if (q.rows.length) return q.rows[0].value;
  }
  throw new Error('러너 타임아웃');
}

(async () => {
  const snap = (await pool.query(`SELECT items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0].items;
  let bad = 0;
  for (const [c24, nno] of Object.entries(MAP)) {
    const nit = snap.find(x => String(x.no) === nno);
    const pr = await runRaw({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${c24}`, query: { fields: 'product_no,price' } });
    const base = Number(pr.raw.data.product.price);
    const vr = await runRaw({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${c24}/variants` });
    const live = vr.raw.data.variants.filter(v => v.display === 'T' && v.selling === 'T');
    const c24Pays = live.map(v => base + Number(v.additional_amount)).sort((a, b) => a - b);
    const nPays = (nit.opts || []).filter(o => o.usable !== false).map(o => nit.discPrice + Number(o.price)).sort((a, b) => a - b);
    const same = c24Pays.length === nPays.length && c24Pays.every((x, i) => x === nPays[i]);
    if (!same) bad++;
    console.log(`${same ? '✅' : '❌'} c${c24} ${String(nit.name).slice(0, 24)}`);
    console.log(`    카페24 ${c24Pays.length}종: ${c24Pays.map(x => x.toLocaleString()).join(' / ')}`);
    console.log(`    네이버 ${nPays.length}종: ${nPays.map(x => x.toLocaleString()).join(' / ')}`);
  }
  console.log(bad ? `\n❌ 집합 불일치 ${bad}상품` : '\n✅ 판매중 5종 — 카페24 결제가 집합 = 네이버 정본 집합 완전 일치');
  await pool.end();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });

/* #428 검증 — 알림톡·발송안내(LMS) 품목 매칭: 실DB bot_products(판매현황 정리 후) × kakao-notify.js 실함수
   ① 새 옵션 문구(중대과) → 중대과 행 매칭(주문안내·발송안내문 414자) ② 옛 문구(변경 전 결제분) = 삭제된 옛 행이 없어 미매칭 → E 알림톡은 공통 템플릿으로 그대로 발송(#173)·품목 안내문만 생략(대표 보고 항목)
   ③ 판매현황(봇 {{판매현황}} 재료): 황금향 선물용 = 중대과 2종만 판매중·가격 세팅 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const NM = PROJ + '\\node_modules\\';
require(NM + 'dotenv').config({ path: PROJ + '\\.env' });
const { Client } = require(NM + 'pg');
const kn = require(PROJ + '\\kakao-notify.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const bp = (await c.query(`SELECT id, name, status, price, notify_message, shipping_guide, reserve_ship_start FROM bot_products WHERE deleted_at IS NULL AND status='판매중'`)).rows;
  const raw = (n1, n2) => `제주 황금향 하우스 노지 가정용 선물용 3kg 5kg 10kg 아꼼이네 상품선택: ${n1} / 상품 및 과수: ${n2}`;
  const m5 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 선물용 - 5kg(중대과 13~25과)'), bp);
  const m3 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 선물용 - 3kg(중대과 7~15과)'), bp);
  const m3c92 = kn.matchNotifyProduct(raw('2. (제철)과즙팡팡 황금향', '황금향 선물용 - 3kg(중대과 7~15과)'), bp);
  ok(m5 && m5.id === 410 && m5.shipping_guide && m5.shipping_guide.length > 300, '① 새 문구 5kg(중대과 13~25과) → 행 410 · 발송안내문 있음', m5 && m5.name.slice(-24));
  ok(m3 && m3.id === 409 && m3.shipping_guide && m3.shipping_guide.length > 300, '① 새 문구 3kg(중대과 7~15과) → 행 409 · 발송안내문 있음', m3 && m3.name.slice(-24));
  ok(m3c92 && m3c92.id === 409, '① 타이벡(c92) 주문 안 황금향 선물 3kg(번호 2) → 행 409', m3c92 && m3c92.id);
  const old5 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 선물용 - 5kg(대과 13~23과)'), bp);
  const old3 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 선물용 - 3kg(대과 7~15과)'), bp);
  ok(!old5 && !old3, '② 옛 문구(대과) = 미매칭(옛 행 삭제) — 오매칭 0 · E 알림톡은 공통 템플릿 발송·품목 안내문만 생략', `old5=${old5 && old5.id} old3=${old3 && old3.id}`);
  // 가정용·못난이 무회귀
  const h5 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 가정용 - 5kg(중소과 27과 전후)'), bp);
  const u5 = kn.matchNotifyProduct(raw('1. (제철)과즙팡팡 황금향', '황금향 못난이 - 5kg(랜덤과)'), bp);
  ok(h5 && /가정용 - 5kg/.test(h5.name) && u5 && /못난이 - 5kg/.test(u5.name), '② 가정용·못난이 매칭 무회귀', `${h5 && h5.id} · ${u5 && u5.id}`);
  // ③ 판매현황
  const hg = (await c.query(`SELECT id,name,status,price FROM bot_products WHERE deleted_at IS NULL AND name LIKE '%황금향 선물용%' ORDER BY id`)).rows;
  ok(hg.length === 2 && hg.every(r => /중대과/.test(r.name) && r.status === '판매중' && /원$/.test(r.price)), '③ 판매현황 황금향 선물용 = 중대과 2종만(판매중·가격)', hg.map(r => r.name.slice(-18) + ' ' + r.price).join(' | '));
  const gg = (await c.query(`SELECT name,price FROM bot_products WHERE deleted_at IS NULL AND id IN (213,214)`)).rows;
  ok(gg.some(r => /선물용 - 3kg\(로얄과\)/.test(r.name) && r.price === '34,500원') && gg.some(r => /4\.5kg\(로얄과\)/.test(r.name) && r.price === '48,800원'), '③ 귤 판매가 2종 = 네이버 실시간', gg.map(r => r.name.slice(-16) + ' ' + r.price).join(' | '));
  const pend = await c.query(`SELECT count(*)::int n FROM kakao_notify_log k LEFT JOIN lms_guide_log l ON l.order_key=k.order_key WHERE k.product_name ~ '황금향 선물용 - (3kg\\(대과 7~15과\\)|5kg\\(대과 13~2[35]과\\))' AND k.deleted_at IS NULL AND l.id IS NULL AND k.created_at > NOW()-interval '45 days'`);
  console.log('  ℹ️ 발송안내 미도래·옛 문구 주문 =', pend.rows[0].n, '건 (E 알림톡은 발송됨 · 품목 안내문만 생략)');
  await c.end();
  console.log(`\n결과: ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });

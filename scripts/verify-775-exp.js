// #775-A 검증 — 체험(배송 없는) 상품을 택배 흐름에서 뺐는지
//   server.js 실코드를 떼어 실행한다(복사 0): experienceProductIds · isExperienceOrder · _naverFetchInvoiceOrdersCore · collectKakaoNotify · collectClaim
//   네이버(중계)·DB(pool)·알리고·텔레그램은 전부 가짜 — 실서버·실DB·외부 호출 0
//   실행: node scripts/verify-775-exp.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${name}${extra !== undefined ? ' — ' + extra : ''}`); };
const fnText = (head) => { const i = src.indexOf(head); if (i < 0) throw new Error('표식 없음: ' + head); const j = src.indexOf('\n}\n', i); return src.slice(i, j + 2); };
const helpA = src.indexOf('const EXPERIENCE_PRODUCTS_DEFAULT'), helpB = src.indexOf('\n}\n', src.indexOf('function isExperienceOrder(po, ids) {'));
if (helpA < 0 || helpB < 0) throw new Error('#775-A 도우미 표식 없음');
const code = src.slice(helpA, helpB + 2) + '\n' + fnText('async function _naverFetchInvoiceOrdersCore(days, opts) {') + '\n' + fnText('async function collectKakaoNotify() {') + '\n' + fnText('async function collectClaim() {');

// ── 가짜 환경 ───────────────────────────────────────────────────────────────
const S = { cfg: {}, relay: [], sent: [], confirmed: [], tg: [], q: [], changes: [], detail: [] };
const env = {
    pool: { query: async (sql, args) => { const s = String(sql).replace(/\s+/g, ' '); S.q.push({ sql: s, args }); if (/^SELECT order_key FROM kakao_notify_log/.test(s)) return { rows: [] }; if (/^SELECT name, notify_message/.test(s)) return { rows: [] }; if (/INSERT INTO naver_claim_alerted/.test(s)) return { rows: [{ '?column?': 1 }] }; return { rows: [], rowCount: 1 }; } },
    naverCfgGet: async k => (k in S.cfg ? S.cfg[k] : null), naverCfgSet: async () => { },
    naverRelay: { callNaver: async req => { S.relay.push(req); return { data: { contents: S.relay.length === 1 ? S.invoiceItems : [] } }; } },
    notifyTelegram: async t => { S.tg.push(t); }, naverMaskPII: x => x,
    naverFetchChanges: async () => S.changes, naverKstIso: ms => new Date(ms).toISOString(),
    naverCallWithRetry: async req => { S.detail.push(req); return { data: { data: S.detailItems.filter(it => req.body.productOrderIds.includes(it.productOrder.productOrderId)) } }; },
    loadShippingHolidayInfo: async () => ({ set: new Set(), reasons: {}, arriveOff: new Set() }),
    kakaoNotify: { matchNotifyProduct: () => null, isReserveOrder: () => false, orderTemplate: () => ({ content: '#{고객명} #{상품명} #{발송안내}' }), buildMessage: () => '문면', cleanProductName: s => s, sendAlimtalk: async o => { S.sent.push(o); return { mode: 'real', status: 'sent' }; }, orderTplCode: () => 'T', maskPhone: () => '010-****-0000', switchOn: () => true },
    resolveReceiver: async t => t, isMaskedTel: t => /\*/.test(String(t)), isBadTel: () => false, memoShipLineSafe: () => null,
    shippingSchedule: { isShipDay: () => false, computeShipping: () => ({ text: '10/21(수) 발송 예정' }) },
    naverConfirmOrders: async ids => { S.confirmed.push(...ids); return { success: ids, fail: [] }; }, naverConfirmIsAlready: () => false,
    alertEnabled: async () => true, alertQuietNow: async () => false, alertNightAcc: async () => { }, alertText: async (k, v) => `⚠️ 반품·교환 ${v['건수']}건`,
    console: { log: (...a) => { S.log = (S.log || []).concat(a.join(' ')); } }, setTimeout, Date, Promise, Number, String, JSON, Math, Set, Array, Object, RegExp, Error,
};
const mod = new Function('env', `with (env) { ${code}\n return { experienceProductIds, isExperienceOrder, _naverFetchInvoiceOrdersCore, collectKakaoNotify, collectClaim, resetCache: () => { _expProductsCache = { at: 0, ids: EXPERIENCE_PRODUCTS_DEFAULT }; } }; }`)(env);
const reset = () => { S.relay = []; S.sent = []; S.confirmed = []; S.tg = []; S.q = []; S.detail = []; S.log = []; mod.resetCache(); };
const PAY = new Date(Date.UTC(2026, 9, 20, 3, 0)).toISOString();   // KST 12:00(보류 시간 아님)
const order = (id, productId, dm, opt) => ({ productOrder: { productOrderId: id, productId, expectedDeliveryMethod: dm, productName: productId === '7673020911' ? '제주 감귤 체험 농장 방문 아꼼이네 귤따기 시식' : '제주 레몬', productOption: opt || '과수 및 크기: 제주 그린레몬5kg(중소과)', quantity: 1, productOrderStatus: 'PAYED', shippingAddress: { name: '홍', tel1: '010-1111-2222' } }, order: { ordererName: '홍', ordererTel: '010-1111-2222', paymentDate: PAY } });

(async () => {
    console.log('① 판정');
    reset();
    let ids = await mod.experienceProductIds();
    ok(JSON.stringify(ids) === '["7673020911"]', '설정 없으면 기본 [7673020911]', JSON.stringify(ids));
    ok(mod.isExperienceOrder({ productId: '7673020911', expectedDeliveryMethod: 'DELIVERY' }, ids), '상품 번호로 체험');
    ok(!mod.isExperienceOrder({ productId: '999', expectedDeliveryMethod: 'NOTHING' }, ids), '배송 방법 NOTHING 만으로는 안 뺌(택배 주문 실값 미확인 · 상품 번호만)');
    ok(!mod.isExperienceOrder({ productId: '5531798664', expectedDeliveryMethod: 'DELIVERY' }, ids) && !mod.isExperienceOrder({ productId: '5531798664' }, ids), '택배 상품 = 체험 아님(배송 방법 칸 없어도)');
    S.cfg.experience_products = { ids: ['111111', 'x', '7673020911'] }; reset();
    ids = await mod.experienceProductIds();
    ok(JSON.stringify(ids) === '["111111","7673020911"]', '설정 {ids:[…]} · 숫자 아닌 값은 버림', JSON.stringify(ids));
    S.cfg.experience_products = ['222222']; reset();
    ok(JSON.stringify(await mod.experienceProductIds()) === '["222222"]', '설정 배열 꼴도 읽음');
    delete S.cfg.experience_products;

    console.log('\n② 송장변환·중간발주·문자 봇 발송 전 주문(_naverFetchInvoiceOrdersCore)');
    reset(); S.invoiceItems = [order('A1', '5531798664', 'DELIVERY'), order('E1', '7673020911', 'NOTHING', '제주아꼼이네 귤체험: 내가 직접 딴 노지귤 2kg / 00월: 11'), order('E2', '7673020911', 'DELIVERY')];
    let r = await mod._naverFetchInvoiceOrdersCore(1, {});
    ok(r.rows.length === 1 && r.rows[0]._pid === 'A1', '배송준비 주입 rows = 택배 1건만(체험 2건 뺌)', r.rows.map(x => x._pid).join());
    ok(r.experienceSkipped === 2 && r.fetched === 3 && (S.log || []).some(l => /체험\(배송 없음\) 주문 2건 뺌/.test(l)), '뺀 건수 2 · 로그 한 줄 · 받은 수(fetched) 3 그대로', JSON.stringify({ e: r.experienceSkipped, f: r.fetched }));
    reset(); S.invoiceItems = [order('A1', '5531798664', 'DELIVERY'), order('E1', '7673020911', 'NOTHING')];
    r = await mod._naverFetchInvoiceOrdersCore(1, { extended: true, placeStatuses: ['OK', 'NOT_YET'] });
    ok(r.rows.length === 1 && r.rows[0]._x && r.rows[0]._x.productOrderId === 'A1', '문자 봇 꼴(extended · NOT_YET+OK)도 체험 뺌', r.rows.map(x => x._pid).join());
    reset(); S.invoiceItems = [order('A1', '5531798664', 'DELIVERY'), order('A2', '6400134206', undefined)];
    r = await mod._naverFetchInvoiceOrdersCore(1, {});
    ok(r.rows.length === 2 && !('experienceSkipped' in r) && !(S.log || []).length, '체험 없으면 결과 꼴 종전 그대로(experienceSkipped 칸 없음 · 로그 0)');

    console.log('\n③ 주문안내 알림톡 · 자동 발주확인(collectKakaoNotify)');
    reset(); S.changes = [{ productOrderId: 'A1', lastChangedType: 'PAYED' }, { productOrderId: 'E1', lastChangedType: 'PAYED' }];
    S.detailItems = [order('A1', '5531798664', 'DELIVERY'), order('E1', '7673020911', 'NOTHING')];
    const out = await mod.collectKakaoNotify();
    ok(S.sent.length === 1 && !S.sent.some(o => /체험/.test(o.message)), '알림톡 = 택배 1건만 발송 · 체험 0', S.sent.length);
    ok(JSON.stringify(S.confirmed) === '["A1"]', '자동 발주확인 = 택배 A1 만 · 체험 E1 은 안 함(사람이)', JSON.stringify(S.confirmed));
    const expRow = S.q.find(x => /'skip','experience'/.test(x.sql));
    ok(expRow && expRow.args[0] === 'E1' && /confirm_status/.test(expRow.sql) && /'none'\)/.test(expRow.sql), '이력에 체험 skip 한 줄(confirm none · 중복 방지)', expRow && JSON.stringify(expRow.args));
    ok(/체험 제외 1/.test(out) && (S.log || []).some(l => /자동 발주확인에서 체험 주문 1건 뺌/.test(l)), '결과 글·로그에 체험 제외 1', out);
    reset(); S.changes = [{ productOrderId: 'A1', lastChangedType: 'PAYED' }]; S.detailItems = [order('A1', '5531798664', 'DELIVERY')];
    const out2 = await mod.collectKakaoNotify();
    ok(S.sent.length === 1 && S.confirmed.length === 1 && !/체험/.test(out2) && !(S.log || []).length, '체험 없으면 종전 그대로(발송 1 · 발주확인 1 · 글 변화 0)', out2);

    console.log('\n④ 반품 알림(collectClaim) — 알림 유지 + (체험) 표시');
    reset(); S.changes = [{ productOrderId: 'E1', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }, { productOrderId: 'A1', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }];
    S.detailItems = [order('A1', '5531798664', 'DELIVERY'), order('E1', '7673020911', 'NOTHING')];
    await mod.collectClaim();
    ok(S.tg.length === 1 && S.tg[0] === '⚠️ 반품·교환 2건 (체험 1건)', '알림 1통 · 끝에 (체험 1건)', S.tg[0]);
    reset(); S.changes = [{ productOrderId: 'A1', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }];
    await mod.collectClaim();
    ok(S.tg[0] === '⚠️ 반품·교환 1건', '체험 없으면 종전 글 그대로', S.tg[0]);
    reset(); S.changes = [{ productOrderId: 'E1', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }];
    const keep = env.naverCallWithRetry; env.naverCallWithRetry = async () => { throw new Error('네이버 오류'); };
    await mod.collectClaim(); env.naverCallWithRetry = keep;
    ok(S.tg[0] === '⚠️ 반품·교환 1건', '상세조회 실패해도 알림은 그대로(표시만 빠짐)', S.tg[0]);

    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });

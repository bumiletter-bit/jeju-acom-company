// #838-1 검증 — 자동 송장 등록 1단계(invoice-auto.js 짝 맞추기 · match/register 라우트 · LOIS 파서 공통화) · 워커3
//   🔴 ⓪ 만 실DB 접속 = 새 표 initDB 문장을 BEGIN … ROLLBACK 안에서 1회(문법·예약어 확인 · 남는 쓰기 0 · 총괄 10/24 허가 — 가짜 pool 은 SQL 문법을 안 봐서 v5.9.618 「fetch」 예약어를 못 잡았음) · NO838DB=1 이면 건너뜀
//   그 밖 실DB 접속 0(가짜 pool 메모리 표) · 네트워크 0(3채널 재조회·전송 = 가짜 함수 · 실제 길(transport)은 server.js 가 주입 · 모듈엔 네트워크 함수 0 · 아래 글자 검사)
//   #838-4 ⑥ = 가짜 3채널 전송(바디 꼴·묶음·멱등·부분 실패·모름·send_enabled false 거절·동시 집기·수기 파일) · server.js 기동 0(LOIS 파서 구간만 글자로 떼어 실행)
//   가짜 자료 = docs/838/t838c 하네스와 같은 가짜 번호 꼴(010-0000-xxxx) · 정본 2절 규칙표 경우마다 1항목 이상 + 채우기 주문으로 시트2 50줄 넘김
//   실행: node scripts/verify-838-invoice-auto.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const express = require('express'); const ExcelJS = require('exceljs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 400))); return !!c; };
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 40)); return src.slice(i, j); };
const loisSrc = cut('// #838-1 LOIS 운송장 시트 파서', "app.post('/api/delivery/shipments/upload'");
const adminOnlySrc = cut('function adminOnly(req, res, next) {', '// #561');
const IA = require(path.join(ROOT, 'invoice-auto.js'));
const cjTrack = require(path.join(ROOT, 'cj-track.js'));

// ── 가짜 pool ──
let runs = [], items = new Map(), shipIdx = new Map(), unknownSql = [], queries = [];
const pool = { query: async (sql, p) => {
    const s = String(sql).replace(/\s+/g, ' ').trim(); queries.push(s.slice(0, 60));
    if (/^CREATE TABLE IF NOT EXISTS invoice_auto_(runs|items)/.test(s)) return { rows: [] };
    if (/^ALTER TABLE invoice_auto_items ADD COLUMN IF NOT EXISTS (error_text TEXT|sent_at TIMESTAMPTZ)$/.test(s)) return { rows: [] };
    if (/^DELETE FROM invoice_auto_items WHERE created_at < now\(\) - interval '90 days'/.test(s)) { for (const [k, x] of items) if (x.created_at && Date.now() - x.created_at >= 90 * 86400e3) items.delete(k); return { rowCount: 0 }; }
    if (/^UPDATE invoice_auto_items SET state = 'sending', updated_at = now\(\) WHERE idem_key = ANY\(\$1::text\[\]\) AND run_id = \$2 AND state = 'ready' RETURNING idem_key$/.test(s)) { const got = []; for (const k of p[0]) { const x = items.get(k); if (x && x.run_id === p[1] && x.state === 'ready') { x.state = 'sending'; got.push({ idem_key: k }); } } return { rows: got, rowCount: got.length }; }
    if (/^UPDATE invoice_auto_items SET state = \$2, error_text = \$3, sent_at = CASE WHEN \$2 = 'sent' THEN now\(\) ELSE sent_at END, updated_at = now\(\) WHERE idem_key = \$1 AND run_id = \$4$/.test(s)) { const x = items.get(p[0]); if (x && x.run_id === p[3]) { x.state = p[1]; x.error_text = p[2]; if (p[1] === 'sent') x.sent_at = Date.now(); } return { rowCount: x ? 1 : 0 }; }
    if (/^UPDATE invoice_auto_runs SET register_state = 'sent'/.test(s)) { const r = runs.find(x => x.id === p[0]); if (r) { r.register_state = 'sent'; r.register = JSON.parse(p[1]); } return { rowCount: r ? 1 : 0 }; }
    if (/^SELECT id, ship_date, result, register FROM invoice_auto_runs WHERE id = \$1$/.test(s)) return { rows: runs.filter(r => r.id === p[0]) };
    if (/^DELETE FROM invoice_auto_runs WHERE created_at < now\(\) - interval '90 days'/.test(s)) { runs = runs.filter(r => Date.now() - r.created_at < 90 * 86400e3); return { rowCount: 0 }; }
    if (/^INSERT INTO invoice_auto_runs \(created_by, ship_date, file_hash, files, fetch_info, summary, result\)/.test(s)) { const id = runs.length + 1; runs.push({ id, created_at: Date.now(), created_by: p[0], ship_date: p[1], file_hash: p[2], files: JSON.parse(p[3]), fetch: JSON.parse(p[4]), summary: JSON.parse(p[5]), result: JSON.parse(p[6]), register_state: null }); return { rows: [{ id }] }; }
    if (/^SELECT id, result, register_state FROM invoice_auto_runs WHERE id = \$1/.test(s)) return { rows: runs.filter(r => r.id === p[0]) };
    if (/^UPDATE invoice_auto_runs SET register_state = 'prepared'/.test(s)) { const r = runs.find(x => x.id === p[0]); if (r) { r.register_state = 'prepared'; r.register = JSON.parse(p[1]); } return { rowCount: r ? 1 : 0 }; }
    if (/^SELECT run_id, state, tracking FROM invoice_auto_items WHERE idem_key = \$1/.test(s)) { const x = items.get(p[0]); return { rows: x ? [x] : [] }; }
    if (/^INSERT INTO invoice_auto_items \(idem_key, run_id, channel, order_key, tracking, state\) VALUES \(\$1,\$2,\$3,\$4,\$5,'ready'\) ON CONFLICT \(idem_key\) DO UPDATE SET run_id = EXCLUDED\.run_id, tracking = EXCLUDED\.tracking, state = 'ready', error_text = NULL, updated_at = now\(\) WHERE invoice_auto_items\.state NOT IN \('sent','sending','unknown'\)$/.test(s)) { const x = items.get(p[0]); if (!x) items.set(p[0], { idem_key: p[0], run_id: p[1], channel: p[2], order_key: p[3], tracking: p[4], state: 'ready', created_at: Date.now() }); else if (!['sent', 'sending', 'unknown'].includes(x.state)) { x.run_id = p[1]; x.tracking = p[4]; x.state = 'ready'; x.error_text = null; } return { rowCount: 1 }; }
    if (/^INSERT INTO delivery_shipments/.test(s)) { shipIdx.set(p[0], { tracking: p[0], date: p[1], partner: p[2] }); return { rowCount: 1 }; }
    unknownSql.push(s.slice(0, 120)); throw new Error('가짜 pool: 모르는 SQL — ' + s.slice(0, 120));
} };
const lois = new Function('pool', 'cjTrack', 'require', loisSrc + '\nreturn { loisShipRows, loisUpsertShipments };')(pool, cjTrack, require);

// ── 가짜 3채널 주문 ──
const T = n => '010-0000-' + String(n).padStart(4, '0');
const nv = (pid, o) => ({ '구매자명': o.b || o.r, '구매자연락처': o.bt, '수취인명': o.r, '옵션정보': o.opt, '수량': o.q || 1, '수취인연락처1': o.rt, '수취인연락처2': '', '통합배송지': o.ad, '배송메세지': '', _pid: String(pid) });
const OPT = { h3s: '아꼼이네 상품선택: 1. 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 3kg(소과)', h5r: '아꼼이네 상품선택: 1. 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 5kg(로얄과)', gold: '아꼼이네 상품선택: 2. 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)' };
const P = { h3s: '하우스감귤 가정용 - 3kg(소과)', h5r: '하우스감귤 가정용 - 5kg(로얄과)', gold: '황금향 가정용 - 3kg(중소과 17과 전후)' };
const NAVER = [
    nv(1001, { r: '가A', bt: T(1), rt: T(1), opt: OPT.h3s, ad: '서울 가가구 가가로 1' }),                  // auto
    nv(1002, { r: '나B', bt: T(2), rt: T(2), opt: OPT.h5r, q: 2, ad: '부산 나나구 나나로 2' }),              // auto_multi
    nv(1003, { r: '다C', bt: T(3), rt: T(3), opt: OPT.h3s, ad: '대구 다다구 다다로 3' }),                  // auto_qty_diff(운송장 2)
    nv(1004, { r: '라D', bt: T(4), rt: T(4), opt: OPT.h3s, ad: '인천 라라구 라라로 4' }),                  // by_product(같은 분 · 다른 품목)
    nv(1005, { r: '라D', bt: T(4), rt: T(4), opt: OPT.gold, ad: '인천 라라구 라라로 4' }),
    nv(1006, { r: '마E', bt: T(5), rt: T(5), opt: OPT.h5r, ad: '광주 마마구 마마로 5' }),                  // same_item_any(같은 분 같은 품목 2)
    nv(1007, { r: '마E', bt: T(5), rt: T(5), opt: OPT.h5r, ad: '광주 마마구 마마로 5' }),
    nv(1008, { r: '바F', bt: T(6), rt: T(6), opt: OPT.h5r, q: 2, ad: '대전 바바구 바바로 6' }),              // 입력삭제 → indiv_store_addr
    nv(1009, { r: '사G', bt: T(7), rt: T(7), opt: OPT.h5r, q: 2, ad: '울산 사사구 사사로 7' }),              // 입력삭제 → indiv_any
    nv(1010, { r: '아H', bt: T(10), rt: T(10), opt: OPT.h3s, ad: '세종 아아로 10' }),                     // todo_product(같은 분 · 품목 못 가름)
    nv(1011, { r: '아H', bt: T(10), rt: T(10), opt: OPT.gold, ad: '세종 아아로 10' }),
    nv(1012, { r: '자I', bt: T(11), rt: T(11), opt: OPT.h3s, ad: '강원 자자군 자자로 11' }),               // todo_pick(같은 구매자 운송장 없는 같은 품목 2 · 남은 운송장 1)
    nv(1013, { r: '자I', bt: T(11), rt: T(11), opt: OPT.h3s, ad: '강원 자자군 자자로 11' }),
    nv(1014, { b: '선물', bt: '010-0000-0000', r: '차J', rt: T(14), opt: OPT.h3s, ad: '충북 차차군 차차로 14' }),   // 선물하기(구매자 번호 자리표시) → 주 열쇠로 auto
    nv(1015, { r: '카K', bt: T(15), rt: T(15), opt: OPT.h3s, ad: '전남 카카군 카카로 15' }),               // 지정발송일(운송장 없음) → orders_without_tracking
    nv(1016, { r: '타L', bt: T(16), rt: T(16), opt: OPT.h3s, ad: '전북 타타군 타타로 16' }),               // 번호 다른 운송장 → unmatched
];
for (let i = 0; i < 32; i++) NAVER.push(nv(2000 + i, { r: '채움' + i, bt: T(100 + i), rt: T(100 + i), opt: i % 3 ? OPT.h3s : OPT.gold, ad: '경기 채움시 채움로 ' + (100 + i) }));
const COUPANG = [{ '구매자': '쿠A', '구매자전화번호': '0507-0000-0201', '수취인이름': '쿠A', '수취인전화번호': '0507-0000-0201', '수취인 주소': '경남 쿠쿠시 쿠쿠로 201', '노출상품명(옵션명)': '하우스감귤 가정용 3kg 소과, 1개', '구매수(수량)': 1, _orderId: '7001', _shipmentBoxId: '880001', _vendorItemId: '99001' }];
const CAFE24 = [{ '주문자명': '몰A', '주문자 휴대전화': T(301), '수령인': '몰A', '수령인 휴대전화': T(301), '수령인 주소(전체)': '제주 몰몰시 몰몰로 301', '주문상품명(세트상품 포함)': '제주 감귤 하우스감귤 가정용 - 5kg(로얄과)', '수량': 1, _orderId: '20261024-0000001', _itemCode: '20261024-0000001-01' }];
let fetchFail = {}, fetchCalls = [], fetchDelay = 0;
let c24get = [], c24getFail = null;
let cfgStore = {}, sent = { naver: [], coupang: [], cafe24: [] }, naverFailIds = new Set(), naverOmitIds = new Set(), sendDelay = 0, cpThrow = null, c24Throw = null, tg = [];
const transport = {
    naver: async body => { sent.naver.push(body); if (sendDelay) await sleep(sendDelay); const ids = body.dispatchProductOrders.map(x => x.productOrderId); return { timestamp: 'x', data: { successProductOrderIds: ids.filter(i => !naverFailIds.has(i) && !naverOmitIds.has(i)), failProductOrderInfos: ids.filter(i => naverFailIds.has(i)).map(i => ({ productOrderId: i, code: 'INVALID_STATUS', message: '발송 처리할 수 없는 상태' })) } }; },
    coupang: async body => { sent.coupang.push(body); if (cpThrow) throw cpThrow; const boxes = [...new Set(body.orderSheetInvoiceApplyDtos.map(x => String(x.shipmentBoxId)))]; return { code: '200', message: 'OK', data: { responseCode: 0, responseList: boxes.map(b => ({ shipmentBoxId: Number(b), succeed: true, resultCode: 'OK', retryRequired: false, resultMessage: null })) } }; },
    cafe24: async body => { sent.cafe24.push(body); if (c24Throw) throw c24Throw; return { shipments: body.requests.map(q => ({ shop_no: 1, shipping_code: 'D-1', order_id: q.order_id, status: 'shipping', tracking_no: q.tracking_no, order_item_code: q.order_item_code })) }; },
    naverQuery: async ids => Object.fromEntries(ids.map(i => [i, 'DELIVERING'])),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fetchers = {
    naver: async d => { fetchCalls.push(['naver', d]); if (fetchDelay) await sleep(fetchDelay); if (fetchFail.naver) throw new Error('relay down'); return { rows: NAVER }; },
    coupang: async d => { fetchCalls.push(['coupang', d]); if (fetchFail.coupang) throw new Error('coupang 429'); return { rows: COUPANG }; },
    cafe24: async d => { fetchCalls.push(['cafe24', d]); if (fetchFail.cafe24) throw new Error('재승인 필요'); return { rows: CAFE24 }; },
};
// ── 가짜 LOIS 운송장 시트(시트2 꼴 40칸 머리글 일부 · 공백 섞인 머리글 「접수\n순서」 포함) ──
let trN = 600000000000; const nextTr = () => String(++trN);
function ship(o) { return { tr: nextTr(), sn: o.sn || (o.b || o.r) + '(제주아꼼이네)', stel: o.st || o.bt || T(0), r: o.r, rt: o.rt, ad: o.ad, p: o.p }; }
function shipsFor() {
    const L = []; const N = Object.fromEntries(NAVER.map(r => [r._pid, r]));
    const of = (pid, p, extra) => { const r = N[pid]; return ship(Object.assign({ b: r['구매자명'], bt: r['구매자연락처'], r: r['수취인명'], rt: r['수취인연락처1'], ad: r['통합배송지'], p }, extra || {})); };
    L.push(of('1001', P.h3s));
    L.push(of('1002', P.h5r), of('1002', P.h5r));
    L.push(of('1003', P.h3s), of('1003', P.h3s));
    L.push(of('1004', P.h3s), of('1005', P.gold));
    L.push(of('1006', P.h5r), of('1007', P.h5r));
    L.push(ship({ sn: '바F(제주아꼼이네)', st: T(6), r: '받는이1', rt: T(901), ad: '대전 바바구 바바로 6', p: P.h5r }));   // 입력삭제: 스토어 주소와 같은 운송장(받는 분 이름·번호는 다름)
    L.push(ship({ sn: '바F(제주아꼼이네)', st: T(6), r: '받는이2', rt: T(902), ad: '경북 다른군 다른로 1', p: P.h5r }));   // → extra
    L.push(ship({ sn: '사G(제주아꼼이네)', st: T(7), r: '받는이3', rt: T(903), ad: '경북 다른군 다른로 2', p: P.h5r }));   // indiv_any
    L.push(ship({ sn: '사G(제주아꼼이네)', st: T(7), r: '받는이4', rt: T(904), ad: '경북 다른군 다른로 3', p: P.h5r }));   // → extra
    L.push(of('1010', '알 수 없는 상품'), of('1011', '알 수 없는 상품'));
    L.push(ship({ sn: '자I(제주아꼼이네)', st: T(11), r: '받는이5', rt: T(905), ad: '충남 다른군 다른로 5', p: P.h3s }));   // todo_pick
    L.push(of('1014', P.h3s, { sn: '선*물(제주아꼼이네)', st: T(9999) }));
    L.push(ship({ sn: '타L(제주아꼼이네)', st: T(9998), r: '타L', rt: T(7777), ad: '전북 타타군 타타로 16', p: P.h3s }));   // 번호 다름 → unmatched
    L.push(ship({ sn: '현금손님(제주아꼼이네!)', st: T(8888), r: '현금받는분', rt: T(906), ad: '제주 현금시 현금로 1', p: P.h3s }));   // 현금 「!」
    L.push(ship({ sn: '모름(제주아꼼이네)', st: T(8887), r: '모르는분', rt: T(907), ad: '어딘가 1', p: P.h3s }));   // unmatched
    for (let i = 0; i < 32; i++) { const r = N[String(2000 + i)]; L.push(ship({ b: r['구매자명'], bt: r['구매자연락처'], r: r['수취인명'], rt: i === 0 ? T(100).replace(/-/g, '') : r['수취인연락처1'], ad: i === 1 ? r['통합배송지'].replace(/ /g, '  ') : r['통합배송지'], p: i % 3 ? P.h3s : P.gold })); }   // 0 = 번호 하이픈 없음 · 1 = 주소 빈칸 겹침(정규화로 맞아야)
    L.push(ship({ sn: '쿠A(제주아꼼이네)', st: '0507-0000-0201', r: '쿠A', rt: '0507-0000-0201', ad: '경남 쿠쿠시 쿠쿠로 201', p: P.h3s }));
    L.push(ship({ sn: '몰A(제주아꼼이네)', st: T(301), r: '몰A', rt: T(301), ad: '제주 몰몰시 몰몰로 301', p: P.h5r }));
    return L;
}
async function xlsxOf(lines, withSheet1) {
    const wb = new ExcelJS.Workbook();
    if (withSheet1) { const s1 = wb.addWorksheet('Sheet1'); s1.addRow(['보내는사람', '보내는사람연락처', '출고지', '수취인명', '옵션정보', '수량', '수취인연락처1', '수취인연락처2', '배송지', '배송메세지', '구매자연락처']); lines.forEach(l => s1.addRow([l.sn, l.stel, '제주', l.r, l.p, 1, l.rt, '', l.ad, '', l.stel])); }
    const s2 = wb.addWorksheet('Sheet2');
    s2.addRow(['No', '선택', '접수\n순서', '상태', '운송장번호', '보내는분', '보내는분전화번호', '수량', '내품수량', '고객주문번호', '받는분', '받는분전화번호', '받는분우편번호', '받는분주소', '상품명', '배송메시지']);
    lines.forEach((l, i) => s2.addRow([i + 1, 1, i + 1, '접수완료', l.tr.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3'), l.sn, l.stel, 1, 1, '', l.r, l.rt, '00000', l.ad, l.p, '파손주의']));
    return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

(async () => {
    const app = express(); app.use(express.json({ limit: '15mb' }));
    const authMiddleware = (req, res, next) => { const role = String(req.headers['x-role'] || 'admin'); req.user = { id: role === 'admin' ? 1 : 7, name: role === 'admin' ? '대표' : '직원', role }; next(); };
    const adminOnly = new Function(adminOnlySrc + '\nreturn adminOnly;')();
    const audits = [];
    const mod = IA(app, { pool, authMiddleware, adminOnly, writeAudit: async x => { audits.push(x); }, adminActor: req => ({ id: req.user.id, name: req.user.name }), ExcelJS, kstToday: () => '2026-10-24',
        lois: { shipRows: lois.loisShipRows, upsert: async (wb, rows, date, partner) => (await lois.loisUpsertShipments(wb, rows, date, partner)).n }, fetchers, log: { error() {} },
        cafe24Get: async (p, q) => { c24get.push([p, q]); if (c24getFail) throw c24getFail; return { carriers: [{ shipping_carrier_code: '0001', carrier_id: 1, shipping_carrier: '우체국택배' }, { shipping_carrier_code: '0006', carrier_id: 7, shipping_carrier: 'CJ대한통운', default_shipping_carrier: 'T' }] }; },
        transport, naverCfgGet: async k => (k in cfgStore ? cfgStore[k] : null), sleep: async () => {}, notifyTelegram: async t => { tg.push(t); }, kstIsoMs: () => '2026-10-24T17:30:00.000+09:00' });
    await mod.initDB();
    console.log('⓪ 실DB 문법(initDB · BEGIN … ROLLBACK · 남는 쓰기 0)');
    if (process.env.NO838DB === '1') console.log('  (NO838DB=1 — 건너뜀)');
    else {
        require('dotenv').config({ path: path.join(ROOT, '.env') });
        const { Client } = require('pg'); const cl = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        let err = null, cols = [];
        try {
            await cl.connect(); await cl.query('BEGIN');
            const throwaway = IA({ get() {}, post() {} }, { pool: { query: (q, p) => cl.query(q, p) }, authMiddleware() {}, adminOnly() {}, writeAudit: async () => {}, adminActor: () => null, ExcelJS, lois: {}, fetchers: {}, kstToday: () => '' });
            await throwaway.initDB();
            cols = (await cl.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('invoice_auto_runs','invoice_auto_items') ORDER BY table_name, ordinal_position`)).rows.map(x => x.table_name.replace('invoice_auto_', '') + '.' + x.column_name);
            // 라우트가 쓰는 INSERT 문장도 같은 트랜잭션 안에서 1회(값 = 가짜 · 롤백)
            const insSql = (fs.readFileSync(path.join(ROOT, 'invoice-auto.js'), 'utf8').match(/INSERT INTO invoice_auto_runs \([^)]*\) VALUES \([^)]*\) RETURNING id/) || [''])[0];
            await cl.query(insSql, ['verify838', '2026-10-24', 'x', '[]', '{}', '{}', '{}']);
            // #838-4: 라우트의 나머지 SQL 도 같은 트랜잭션 안에서 1회씩(문법 · 롤백)
            const ia0 = fs.readFileSync(path.join(ROOT, 'invoice-auto.js'), 'utf8'); const sqlOf = re => { const m = ia0.match(re); if (!m) throw new Error('SQL 못 찾음 ' + re); return m[0]; };
            await cl.query(sqlOf(/INSERT INTO invoice_auto_items \(idem_key[\s\S]*?NOT IN \('sent','sending','unknown'\)/), ['verify838:1', 1, 'naver', '1', '600000000001']);
            await cl.query(sqlOf(/SELECT run_id, state, tracking FROM invoice_auto_items WHERE idem_key = \$1/), ['verify838:1']);
            await cl.query(sqlOf(/UPDATE invoice_auto_items SET state = 'sending'[\s\S]*?RETURNING idem_key/), [['verify838:1'], 1]);
            await cl.query(sqlOf(/UPDATE invoice_auto_items SET state = \$2, error_text[\s\S]*?run_id = \$4/), ['verify838:1', 'sent', null, 1]);
            await cl.query(sqlOf(/UPDATE invoice_auto_runs SET register_state = 'prepared'[\s\S]*?WHERE id = \$1/), [1, '{}', 'verify838']);
            await cl.query(sqlOf(/UPDATE invoice_auto_runs SET register_state = 'sent'[\s\S]*?WHERE id = \$1/), [1, '{}', 'verify838']);
            await cl.query(sqlOf(/SELECT id, result, register_state FROM invoice_auto_runs WHERE id = \$1/), [1]);
            await cl.query(sqlOf(/SELECT id, ship_date, result, register FROM invoice_auto_runs WHERE id = \$1/), [1]);
            await cl.query(sqlOf(/DELETE FROM invoice_auto_items WHERE created_at < now\(\) - interval '90 days'/));
            await cl.query(sqlOf(/DELETE FROM invoice_auto_runs WHERE created_at < now\(\) - interval '90 days'/));
        } catch (e) { err = e; }
        finally { try { await cl.query('ROLLBACK'); } catch (_) {} try { await cl.end(); } catch (_) {} }
        ok(!err, '실DB 에서 initDB 두 표 CREATE·ALTER 2 + 라우트 SQL 11 문법 통과(롤백)', err && err.message);
        ok(cols.includes('runs.fetch_info') && !cols.includes('runs.fetch') && cols.includes('items.idem_key') && cols.includes('items.error_text') && cols.includes('items.sent_at'), '칸 = fetch_info(예약어 fetch 아님) · items.idem_key·error_text·sent_at', cols.join(','));
        { const cl2 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); let left = null;
          try { await cl2.connect(); left = (await cl2.query(`SELECT count(*)::int AS n FROM invoice_auto_runs WHERE created_by = 'verify838'`)).rows[0].n; } catch (e) { left = /does not exist/.test(e.message) ? 0 : 'err ' + e.message; } finally { try { await cl2.end(); } catch (_) {} }
          ok(left === 0, '롤백 뒤 실DB 에 시험 행 0(표가 없으면 0 으로 셈)', left); }
    }
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + srv.address().port;
    const call = async (p, body, role) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', connection: 'close', 'x-role': role || 'admin' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

    console.log('① LOIS 파서 공통화(종전 꼴 + 보내는분 칸)');
    const LINES = shipsFor();
    const b64 = await xlsxOf(LINES, true);
    { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(b64, 'base64')); const rows = lois.loisShipRows(wb);
      ok(rows.length === LINES.length && LINES.length >= 50, `운송장 줄 ${rows.length}(시트2 · 50줄 이상)`, rows.length);
      ok(rows[0].tr === LINES[0].tr && rows[0].nm === LINES[0].r && rows[0].sn === LINES[0].sn && rows[0].stel === LINES[0].stel && rows[0].op === LINES[0].p, '칸 = 운송장(하이픈 제거)·받는분·상품명·보내는분·보내는분전화', JSON.stringify(rows[0]));
      ok(Object.keys(rows[0]).join() === 'tr,nm,tel,ad,ms,op,q,sn,stel', '줄 칸 = 종전 7칸 + sn·stel', Object.keys(rows[0]).join()); }
    ok(/const rows = loisShipRows\(wb\);/.test(src) && /const \{ n, buyerN \} = await loisUpsertShipments\(wb, rows, date, partner\);/.test(src) && /res\.json\(\{ ok: true, date, partner, rows: rows\.length, upserted: n, buyer_phone: buyerN \}\);/.test(src), '종전 업로드 라우트 = 공통 함수 호출 · 응답 글자 그대로');

    console.log('② 짝 맞추기(정본 2절 규칙표)');
    let r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '제주아꼼이네송장(효돈)10.24.xlsx', data: b64 }] });
    ok(r.status === 200 && r.body.ok && r.body.run_id === 1, 'match 200 · run_id', JSON.stringify(r.body).slice(0, 200));
    const B = r.body, row = pid => B.rows.find(x => x.order_key === String(pid));
    ok(B.files[0].partner === '효돈' && B.ship_date === '2026-10-24' && B.files[0].rows === LINES.length, '거래처 = 파일 이름 괄호 · 날짜 = 파일 이름 MM.DD');
    ok(row(1001) && row(1001).rule === 'auto' && row(1001).status === 'auto' && row(1001).tracking === LINES[0].tr, 'auto = 셋 다 같은 주문 1 · 운송장 1');
    ok(row(1002) && row(1002).rule === 'auto_multi' && row(1002).tracking_all.length === 2 && row(1002).tracking === row(1002).tracking_all[0], 'auto_multi = 수량 2 ↔ 운송장 2 · 첫 운송장 등록');
    ok(row(1003) && row(1003).rule === 'auto_qty_diff' && row(1003).tracking_all.length === 2, 'auto_qty_diff = 수량 1 인데 운송장 2');
    ok(row(1004) && row(1004).rule === 'by_product' && row(1005) && row(1005).rule === 'by_product' && row(1004).tracking !== row(1005).tracking, 'by_product = 같은 분 다른 품목 → 상품명으로 가름');
    { const t4 = LINES.find(l => l.p === P.h3s && l.r === '라D').tr; ok(row(1004).tracking === t4, 'by_product 가 품목 맞는 운송장으로'); }
    ok(row(1006) && row(1007) && row(1006).rule === 'same_item_any' && row(1007).rule === 'same_item_any' && row(1006).tracking !== row(1007).tracking, 'same_item_any = 같은 분 같은 품목 → 1개씩');
    { const t = LINES.find(l => l.r === '받는이1').tr; ok(row(1008) && row(1008).rule === 'indiv_store_addr' && row(1008).tracking === t, 'indiv_store_addr = 운송장 없는 주문 + 같은 구매자 운송장 중 스토어 주소', JSON.stringify(row(1008))); }
    { const t = LINES.find(l => l.r === '받는이3').tr; ok(row(1009) && row(1009).rule === 'indiv_any' && row(1009).tracking === t, 'indiv_any = 스토어 주소 운송장 없음 → 아무거나 1(작은 번호)', JSON.stringify(row(1009))); }
    ok(B.extra.length === 2 && B.extra.every(x => /입력삭제 나머지/.test(x.why)), '같은 구매자 나머지 박스 2 = extra(등록 안 함)', JSON.stringify(B.extra));
    ok(row(1010) && row(1011) && row(1010).status === 'todo' && row(1010).rule === 'todo_product' && row(1010).pick_options.length === 2, 'todo_product = 같은 분 여러 품목인데 상품명으로 못 가름 → 할 일(고를 운송장 2)');
    ok(row(1012) && row(1013) && row(1012).rule === 'todo_pick' && row(1013).rule === 'todo_pick' && row(1012).pick_options.length === 1, 'todo_pick = 같은 구매자 운송장 없는 같은 품목 주문 2 → 할 일(지정발송일 주문과 섞임 방지)');
    ok(row(1014) && row(1014).rule === 'auto', '선물하기(구매자 번호 자리표시) = 주 열쇠로 auto');
    ok(!row(1015), '지정발송일 주문(운송장 없음) = 줄 없음');
    ok(B.orders_without_tracking === 2, 'orders_without_tracking = 1015 + 1016(번호 다른 운송장)', B.orders_without_tracking);
    ok(B.unmatched.length === 2 && B.unmatched.some(x => /끝 7777/.test(x.recipient_masked)), 'unmatched = 번호 다른 운송장 + 모르는 운송장(셋 중 하나라도 다르면 자동 금지)', JSON.stringify(B.unmatched));
    ok(B.cash.length === 1 && /현금/.test(B.cash[0].why), '현금 「!」 줄 = cash(송장만 · 등록 대상 아님)');
    ok(row(2000) && row(2000).rule === 'auto' && row(2001) && row(2001).rule === 'auto', '번호 하이픈 없음·주소 빈칸 겹침 = 정규화로 auto');
    ok(B.rows.filter(x => x.channel === 'naver' && /^20\d\d$/.test(x.order_key)).length === 32, '채움 주문 32 전부 auto');
    { const c = B.rows.find(x => x.channel === 'coupang'), m = B.rows.find(x => x.channel === 'cafe24');
      ok(c && c.order_key === '880001|99001' && c.box_id === '880001' && c.rule === 'auto' && c.order_id === '7001' && c.vendor_item_id === '99001' && JSON.stringify(c.box_vendor_items) === '["99001"]', '쿠팡 = shipmentBoxId|vendorItemId · box_id · order_id·vendor_item_id·상자 옵션(B)', JSON.stringify(c));
      ok(m && m.order_key === '20261024-0000001|20261024-0000001-01' && m.box_id === '20261024-0000001' && m.item_code === '20261024-0000001-01', '자사몰 = order_id|order_item_code', JSON.stringify(m)); }
    ok(B.by_channel.naver.auto === 42 && B.by_channel.naver.todo === 4 && B.by_channel.coupang.auto === 1 && B.by_channel.cafe24.auto === 1, 'by_channel 셈(네이버 자동 42 = 규칙 줄 10 + 채움 32 · 할 일 4 · 쿠팡 1 · 자사몰 1)', JSON.stringify(B.by_channel));
    ok(B.by_channel.naver.skipped === 4, 'naver skipped = 수량2 둘째 1 + qty_diff 둘째 1 + extra 2', B.by_channel.naver.skipped);
    ok(B.summary.shipments === LINES.length && B.summary.auto + B.summary.todo === B.rows.length && B.summary.index_upserted === LINES.length, 'summary 셈 · 색인 upsert = 운송장 전부', JSON.stringify(B.summary));
    ok(shipIdx.size === LINES.length && [...shipIdx.values()].every(x => x.partner === '효돈' && x.date === '2026-10-24'), 'delivery_shipments 색인 = 거래처·발송일 붙음');
    { const all = JSON.stringify(B); ok(!/010-0000-0001|01000000001\b|서울 가가구|가가로/.test(all) && /가A|가\*?/.test(B.rows.find(x => x.order_key === '1001').recipient_masked) && /끝 0001/.test(row(1001).recipient_masked), '응답에 전화 전체·주소 0 · 이름 가림·끝 4자리', row(1001).recipient_masked); }
    ok(/^나\*$/.test(row(1002).recipient_masked.split(' · ')[0]) && /^채\*+\d$/.test(row(2010).recipient_masked.split(' · ')[0]), '이름 가림 꼴(2자 = 나* · 긴 이름 = 첫·끝만)', row(2010).recipient_masked);
    ok(fetchCalls.length === 3 && fetchCalls.every(c => c[1] === 30), '3채널 재조회 1번씩 · 기본 30일', JSON.stringify(fetchCalls));
    ok(runs[0].result && !/010-0000-0001|가가로/.test(JSON.stringify(runs[0])), '저장 행(invoice_auto_runs)에도 전화·주소 0');
    ok(audits.some(a => a.action === 'invoice_auto_match' && a.source === 'invoice-auto'), 'audit invoice_auto_match');

    console.log('③ 오류·채널 실패·동시');
    { const fc = fetchCalls.length, rc = runs.length; r = await call('/api/agent-office/invoice-auto/match', { files: [] }); ok(r.status === 400 && r.body.ok === false && fetchCalls.length === fc && runs.length === rc, '파일 없음 400 · 3채널 재조회 0 · 실행 행 0(화면 새 서버 확인용)'); }
    r = await call('/api/agent-office/invoice-auto/match', { files: [1, 2, 3, 4, 5].map(i => ({ name: 'a' + i + '.xlsx', data: 'x' })) }); ok(r.status === 400, '5개 400');
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: 'big.xlsx', data: Buffer.alloc(5 * 1024 * 1024 + 10).toString('base64') }] }); ok(r.status === 400 && /5MB/.test(r.body.error), '5MB 초과 400', r.status);
    { const wb = new ExcelJS.Workbook(); wb.addWorksheet('S').addRow(['이름', '주소']); const nob = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
      r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: 'x.xlsx', data: nob }] }); ok(r.status === 400 && /운송장번호/.test(r.body.error), '운송장 시트 없음 400'); }
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: 'x.xlsx', data: 'bm90IGV4Y2Vs' }] }); ok(r.status === 400, '엑셀 아님 400');
    fetchFail = { cafe24: true }; fetchCalls = [];
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '송장 10.24.xlsx', data: await xlsxOf(LINES, false) }], days: 99 });
    ok(r.status === 200 && r.body.fetch.cafe24.ok === false && /재승인/.test(r.body.fetch.cafe24.error) && r.body.fetch.naver.ok, '자사몰 재조회 실패 = 200 · fetch.cafe24.ok false', JSON.stringify(r.body.fetch));
    ok(!r.body.rows.some(x => x.channel === 'cafe24') && r.body.unmatched.length === 3 && r.body.files[0].partner === '?', '그 채널 운송장은 unmatched · 시트1 없는 파일도 됨 · 거래처 ?');
    ok(fetchCalls.every(c => c[1] === 60), 'days 상한 60', JSON.stringify(fetchCalls)); fetchFail = {};
    fetchDelay = 150;
    { const [a, b] = await Promise.all([call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: b64 }] }), (async () => { await sleep(30); return call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: b64 }] }); })()]);
      ok([a.status, b.status].sort().join() === '200,409', '동시 두 번 = 200 + 409', [a.status, b.status].join()); }
    fetchDelay = 0;

    console.log('④ register(dry 고정 · 멱등)');
    const run1 = runs[0], todoR = run1.result.rows.find(x => x.order_key === '1010'), todoP = run1.result.rows.find(x => x.order_key === '1012');
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 }, 'staff'); ok(r.status === 403, '직원 = 403');
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 999 }); ok(r.status === 404, '없는 run = 404');
    r = await call('/api/agent-office/invoice-auto/register', {}); ok(r.status === 400, 'run_id 없음 = 400');
    const skipId = run1.result.rows.find(x => x.order_key === '2005').id;
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 1, dry: false, picks: { [todoR.id]: todoR.pick_options[0].tracking.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3'), [todoP.id]: 'manual', [run1.result.rows.find(x => x.order_key === '1011').id]: '999999999999' }, skip: [skipId] });
    ok(r.status === 409 && r.body.ok === false && r.body.dry === true && r.body.send_enabled === false && /send_enabled/.test(r.body.error) && sent.naver.length + sent.coupang.length + sent.cafe24.length === 0, 'dry:false 인데 설정 send_enabled 꺼짐 = 409 · 준비만 저장 · 전송 0', JSON.stringify(r.body).slice(0, 200));
    ok(r.body.ready.naver === 42 && r.body.ready.coupang === 1 && r.body.ready.cafe24 === 1, 'ready = 자동 42 − 건너뜀 1 + 고른 할 일 1 (네이버 42) · 쿠팡 1 · 자사몰 1', JSON.stringify(r.body.ready));
    ok(r.body.manual === 3 && r.body.skipped === 1 && r.body.already === 0, 'manual 3(수기 1 · 고르지 않음 1 · 목록 밖 운송장 1) · skipped 1', JSON.stringify({ m: r.body.manual, s: r.body.skipped }));
    ok(r.body.items.find(x => x.id === todoR.id).tracking === todoR.pick_options[0].tracking && r.body.items.find(x => x.id === todoR.id).idem === 'naver:1010:' + todoR.pick_options[0].tracking, '할 일 고른 운송장(하이픈 섞여도) · idem = 채널:주문번호:운송장');
    ok(items.has('coupang:880001') && items.has('cafe24:20261024-0000001|20261024-0000001-01') && items.has('naver:1001'), '멱등 열쇠 = 네이버 상품주문번호 · 쿠팡 상자 · 카페24 주문|품주');
    ok(items.size === 44 && [...items.values()].every(x => x.state === 'ready' && x.run_id === 1), 'invoice_auto_items = 준비 44 · state ready', items.size);
    ok(runs[0].register_state === 'prepared' && runs[0].register.dry === true, 'run register_state prepared');
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 });
    ok(r.status === 200 && r.body.already === 0 && r.body.ready.naver === 42, '같은 run 다시 = already 0 · ready 그대로(같은 run 준비는 다시 써도 됨)', JSON.stringify(r.body.ready));
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 3 });
    ok(r.status === 200 && r.body.already === 0 && r.body.ready.naver === 42 && items.get('naver:1001').run_id === 3, 'A: 다른 run 의 dry 준비(ready)는 새 run 이 덮음 · already 0', JSON.stringify({ a: r.body.already, rd: r.body.ready }));
    r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 });
    for (const st of ['sent', 'sending', 'unknown']) { items.get('naver:1001').state = st; r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 }); ok(r.body.items.find(x => x.order_key === '1001').state === 'already', 'A: ' + st + ' 인 주문 = already(다시 안 보냄)'); }
    items.get('naver:1001').state = 'failed'; r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 }); ok(r.body.items.find(x => x.order_key === '1001').state === 'ready' && items.get('naver:1001').state === 'ready', 'A: failed 인 주문 = 다시 준비(재시도 가능)');
    runs[0].register_state = 'sent'; r = await call('/api/agent-office/invoice-auto/register', { run_id: 1 }); ok(r.status === 409, '보낸 run = 409'); runs[0].register_state = 'prepared';
    ok(audits.some(a => a.action === 'invoice_auto_prepare' && a.changes.dry === true), 'audit invoice_auto_prepare');

    console.log('⑥ 전송(가짜 3채널 · 바디 꼴·묶음·멱등·부분 실패·모름)');
    // 새 자료: 쿠팡 상자 하나에 옵션 2(운송장 2줄) · 자사몰 한 주문 품목 2(거래처가 달라 운송장 다름)
    COUPANG.push({ '구매자': '쿠A', '구매자전화번호': '0507-0000-0201', '수취인이름': '쿠A', '수취인전화번호': '0507-0000-0201', '수취인 주소': '경남 쿠쿠시 쿠쿠로 201', '노출상품명(옵션명)': '황금향 가정용 - 3kg(중소과 17과 전후)', '구매수(수량)': 1, _orderId: '7001', _shipmentBoxId: '880001', _vendorItemId: '99002' });
    CAFE24.push({ '주문자명': '몰A', '주문자 휴대전화': T(301), '수령인': '몰A', '수령인 휴대전화': T(301), '수령인 주소(전체)': '제주 몰몰시 몰몰로 301', '주문상품명(세트상품 포함)': '황금향 가정용 - 3kg(중소과 17과 전후)', '수량': 1, _orderId: '20261024-0000001', _itemCode: '20261024-0000001-02' });
    COUPANG[0]['노출상품명(옵션명)'] = '하우스감귤 가정용 - 3kg(소과)';   // 상자 안 두 옵션을 상품명으로 가르게(종전 글 꼴은 ② 에서 단독 주문 auto 로 봄)
    const L2 = shipsFor(); const cp1 = L2.find(l => l.r === '쿠A'); cp1.p = '하우스감귤 가정용 - 3kg(소과)';
    L2.push(ship({ sn: '쿠A(제주아꼼이네)', st: '0507-0000-0201', r: '쿠A', rt: '0507-0000-0201', ad: '경남 쿠쿠시 쿠쿠로 201', p: P.gold }));
    L2.push(ship({ sn: '몰A(제주아꼼이네)', st: T(301), r: '몰A', rt: T(301), ad: '제주 몰몰시 몰몰로 301', p: P.gold }));
    items.clear(); sent = { naver: [], coupang: [], cafe24: [] }; tg = [];
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: await xlsxOf(L2, false) }] });
    const R6 = r.body, run6 = R6.run_id, cpRows = R6.rows.filter(x => x.channel === 'coupang'), c24Rows = R6.rows.filter(x => x.channel === 'cafe24');
    ok(r.status === 200 && cpRows.length === 2 && cpRows.every(x => x.rule === 'by_product' && JSON.stringify(x.box_vendor_items.slice().sort()) === '["99001","99002"]') && c24Rows.length === 2 && c24Rows[0].tracking !== c24Rows[1].tracking, '새 자료 짝 = 쿠팡 상자 옵션 2(by_product) · 자사몰 품목 2(운송장 다름)', JSON.stringify(cpRows.map(x => [x.rule, x.box_vendor_items])));
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run6, dry: false }); ok(r.status === 409 && sent.naver.length === 0, 'send_enabled 없음 = 409 · 전송 0');
    cfgStore = { invoice_auto: { send_enabled: true } };
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run6 }); ok(r.status === 200 && r.body.dry === true && r.body.send_enabled === true && sent.naver.length === 0, 'send_enabled 켜져도 dry 를 안 끄면 준비만 · 전송 0');
    naverFailIds = new Set(['2003']); naverOmitIds = new Set(['2004']);
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run6, dry: false });
    const B6 = r.body;
    ok(r.status === 200 && B6.ok && B6.dry === false && B6.send_enabled === true, '전송 200', JSON.stringify(B6).slice(0, 200));
    ok(sent.naver.length === 2 && sent.naver[0].dispatchProductOrders.length === 30 && sent.naver[1].dispatchProductOrders.length === 12, '네이버 = 30건씩 묶음(42 → 30 + 12)', sent.naver.map(b => b.dispatchProductOrders.length).join());
    { const x = sent.naver[0].dispatchProductOrders[0]; ok(Object.keys(x).join() === 'productOrderId,deliveryMethod,deliveryCompanyCode,trackingNumber,dispatchDate' && x.deliveryMethod === 'DELIVERY' && x.deliveryCompanyCode === 'CJGLS' && /^\d{12}$/.test(x.trackingNumber) && x.dispatchDate === '2026-10-24T17:30:00.000+09:00', '네이버 바디 꼴 = 5칸 · DELIVERY · CJGLS · 12자리 · 밀리초+09:00(relay 바디 검사와 같음)', JSON.stringify(x)); }
    { const all = sent.naver.flatMap(b => b.dispatchProductOrders); const n1002 = all.find(x => x.productOrderId === '1002'); ok(n1002 && n1002.trackingNumber === R6.rows.find(x => x.order_key === '1002').tracking_all[0] && all.filter(x => x.productOrderId === '1002').length === 1, '수량 2 주문 = 송장 1개(첫 운송장)'); }
    ok(sent.coupang.length === 1 && sent.coupang[0].orderSheetInvoiceApplyDtos.length === 2, '쿠팡 = 상자 하나 · 옵션마다 한 줄(2)', JSON.stringify(sent.coupang));
    { const d = sent.coupang[0].orderSheetInvoiceApplyDtos, minTr = cpRows.map(x => x.tracking).sort()[0];
      ok(d.every(x => Object.keys(x).join() === 'shipmentBoxId,orderId,vendorItemId,deliveryCompanyCode,invoiceNumber,splitShipping,preSplitShipped,estimatedShippingDate' && x.shipmentBoxId === '880001' && x.orderId === '7001' && x.deliveryCompanyCode === 'CJGLS' && x.invoiceNumber === minTr && x.splitShipping === false && x.preSplitShipped === false && x.estimatedShippingDate === '') && d.map(x => x.vendorItemId).sort().join() === '99001,99002' && !('vendorId' in sent.coupang[0]), '쿠팡 바디 = 8칸 정확 · 번호 글자 그대로 · 같은 송장(상자 안 가장 작은 운송장) · 분리배송 0 · vendorId 는 relay 몫', JSON.stringify(d)); }
    ok(B6.sent.naver === 40 && B6.failed.naver === 1 && B6.unknown.naver === 1 && B6.sent.coupang === 1 && B6.failed.cafe24 === 2, '결과 = 네이버 보냄 40 · 실패 1 · 모름 1 · 쿠팡 1 · 카페24 = CJ 코드 설정 없어 실패 2', JSON.stringify({ s: B6.sent, f: B6.failed, u: B6.unknown }));
    ok(sent.cafe24.length === 0 && B6.items.filter(x => x.channel === 'cafe24').every(x => /cafe24_carrier_code/.test(x.error)), '카페24 CJ 코드 없으면 보내지 않음(코드에 안 박음)');
    ok(items.get('naver:2003').state === 'failed' && /INVALID_STATUS/.test(items.get('naver:2003').error_text) && items.get('naver:2004').state === 'unknown' && items.get('naver:1001').state === 'sent' && items.get('coupang:880001').state === 'sent', '줄마다 상태 = sent / failed(사유) / unknown(응답에 없음)');
    ok(B6.confirmed && B6.confirmed.naver === 40 && B6.confirmed.checked === 40, '전송 뒤 네이버 상태 확인 = DELIVERING 40/40', JSON.stringify(B6.confirmed));
    ok(runs.find(x => x.id === run6).register_state === 'sent' && audits.some(a => a.action === 'invoice_auto_send' && a.source === 'invoice-auto-send' && a.changes.sent.naver === 40 && !/0101111|010-0000/.test(JSON.stringify(a))), 'run sent · audit invoice_auto_send(건수만 · 번호 0)');
    ok(tg.length === 1 && /실패 3/.test(tg[0]) && /모름 1/.test(tg[0]), '실패·모름 있으면 텔레그램 1회', tg.join(' | '));
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run6, dry: false }); ok(r.status === 409, '보낸 run 다시 = 409');
    { const res = await fetch(BASE + '/api/agent-office/invoice-auto/manual/' + run6, { headers: { connection: 'close' } }); const buf = Buffer.from(await res.arrayBuffer()); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
      const s1 = wb.getWorksheet('발송처리'), s2 = wb.getWorksheet('쿠팡·자사몰'); const v1 = []; s1.eachRow((rw, i) => { if (i > 1) v1.push(rw.values.slice(1)); }); const v2 = []; s2.eachRow((rw, i) => { if (i > 1) v2.push(rw.values.slice(1)); });
      ok(res.status === 200 && /spreadsheetml/.test(res.headers.get('content-type') || ''), '수기 파일 GET = xlsx');
      ok(v1.some(x => x[0] === '2003' && x[1] === '택배,등기,소포' && x[2] === 'CJ대한통운' && /^\d{12}$/.test(String(x[3])) && /실패/.test(x[6])) && v1.some(x => x[0] === '2004' && /모름/.test(x[6])) && v1.some(x => x[0] === '1010' && /수기/.test(x[6])), '「발송처리」 시트 = 실패·모름·수기 네이버 줄(센터 일괄발송 4칸 꼴)', JSON.stringify(v1).slice(0, 300));
      ok(v2.length === 2 && v2.every(x => x[0] === '자사몰'), '「쿠팡·자사몰」 시트 = 카페24 실패 2', JSON.stringify(v2));
      ok(!/010-0000|0507-0000|가가로|몰몰로/.test(JSON.stringify([v1, v2])), '수기 파일에 전화·주소 0'); }
    // 다음 실행: sent·unknown 은 already · failed 는 다시 보냄 · 카페24 CJ 코드 넣으면 order_id+운송장 으로 2묶음
    cfgStore = { invoice_auto: { send_enabled: true, cafe24_carrier_code: '0006' } }; naverFailIds = new Set(); naverOmitIds = new Set(); sent = { naver: [], coupang: [], cafe24: [] }; tg = [];
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: await xlsxOf(L2, false) }] }); const run7 = r.body.run_id;
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run7, dry: false }); const B7 = r.body;
    ok(B7.already === 43 && B7.sent.naver === 1 && sent.naver.length === 1 && sent.naver[0].dispatchProductOrders.length === 1 && sent.naver[0].dispatchProductOrders[0].productOrderId === '2003', '다음 실행 = already 43(네이버 보냄 40 + 모름 1 + 쿠팡 상자 2줄 · 줄 단위) · 실패 1(2003)만 다시 보냄', JSON.stringify({ a: B7.already, s: B7.sent }));
    ok(sent.coupang.length === 0 && B7.items.filter(x => x.channel === 'coupang').every(x => x.state === 'already'), '쿠팡 보낸 상자 = already(두 번 안 감)');
    ok(sent.cafe24.length === 2 && sent.cafe24.every(b => b.shop_no === 1 && b.requests.length === 1 && b.requests[0].order_id === '20261024-0000001' && b.requests[0].shipping_company_code === '0006' && b.requests[0].status === 'shipping' && b.requests[0].order_item_code.length === 1) && new Set(sent.cafe24.map(b => b.requests[0].tracking_no)).size === 2, '카페24 = 같은 주문도 운송장이 다르면 따로(같은 order_id 는 한 묶음에 하나) · CJ 코드 설정값 · status shipping', JSON.stringify(sent.cafe24));
    ok(B7.sent.cafe24 === 2 && items.get('cafe24:20261024-0000001|20261024-0000001-02').state === 'sent', '카페24 보냄 2');
    { const rr = runs.find(x => x.id === run7); const old = JSON.parse(JSON.stringify(rr.result)); rr.result.rows.forEach(x => { if (x.channel === 'coupang') delete x.order_id; }); items.delete('coupang:880001'); sent = { naver: [], coupang: [], cafe24: [] }; rr.register_state = 'prepared';
      r = await call('/api/agent-office/invoice-auto/register', { run_id: run7, dry: false });
      ok(sent.coupang.length === 0 && r.body.items.filter(x => x.channel === 'coupang').every(x => x.state === 'failed' && /옛 짝 결과/.test(x.error)), '쿠팡 order_id 없는 옛 짝 결과 = 보내지 않고 failed 「다시 짝 맞추기」(워커2 손질)', JSON.stringify(r.body.items.filter(x => x.channel === 'coupang')));
      rr.result = old; }
    // 연결 끊김(상태 없음) = 모름 · 4xx = 실패
    cpThrow = Object.assign(new Error('relay_unreachable: ECONNRESET'), {}); c24Throw = Object.assign(new Error('cafe24_api_403'), { status: 403, reason: 'insufficient scope' });
    items.clear(); sent = { naver: [], coupang: [], cafe24: [] };
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: await xlsxOf(L2, false) }] }); const run8 = r.body.run_id;
    r = await call('/api/agent-office/invoice-auto/register', { run_id: run8, dry: false, skip: r.body.rows.filter(x => x.channel === 'naver').map(x => x.id) });
    ok(r.body.unknown.coupang === 1 && items.get('coupang:880001').state === 'unknown' && r.body.failed.cafe24 === 2 && r.body.items.filter(x => x.channel === 'cafe24').every(x => /재승인/.test(x.error)), '쿠팡 연결 끊김 = 모름(다시 안 보냄) · 카페24 403 = 실패 + 「재승인 필요」', JSON.stringify({ u: r.body.unknown, f: r.body.failed }));
    cpThrow = null; c24Throw = null;
    // 동시 두 번(D: 줄 집기) — 같은 run 을 동시에 보내면 한 쪽만 보냄
    items.clear(); sent = { naver: [], coupang: [], cafe24: [] }; sendDelay = 120;
    r = await call('/api/agent-office/invoice-auto/match', { files: [{ name: '(효돈)10.24.xlsx', data: await xlsxOf(L2, false) }] }); const run9 = r.body.run_id;
    { const [a, b] = await Promise.all([call('/api/agent-office/invoice-auto/register', { run_id: run9, dry: false }), (async () => { await sleep(40); return call('/api/agent-office/invoice-auto/register', { run_id: run9, dry: false }); })()]);
      const ids = sent.naver.flatMap(x => x.dispatchProductOrders.map(y => y.productOrderId));
      ok(ids.length === new Set(ids).size && ids.length === 42, 'D: 동시 두 번 = 네이버 줄 42 한 번씩만(두 번 보낸 주문 0)', ids.length + ' / 고유 ' + new Set(ids).size);
      ok([a, b].some(x => x.body.items && x.body.items.some(y => y.state === 'already')), '늦은 쪽 = already(다른 요청이 먼저 집음·이미 보냄)'); }
    sendDelay = 0;

    { const g = async role => { const rr = await fetch(BASE + '/api/agent-office/invoice-auto/cafe24-carriers', { headers: { connection: 'close', 'x-role': role || 'admin' } }); return { status: rr.status, body: await rr.json().catch(() => ({})) }; };
      let q = await g('staff'); ok(q.status === 403 && !c24get.length, '카페24 배송사 목록 = 직원 403(호출 0)');
      q = await g(); ok(q.status === 200 && q.body.count === 2 && q.body.cj_candidates.length === 1 && q.body.cj_candidates[0].shipping_carrier_code === '0006' && q.body.cj_candidates[0].carrier_id === 7 && q.body.cj_candidates[0].default === 'T' && c24get[0][0] === '/api/v2/admin/carriers' && c24get[0][1].shop_no === 1 && q.body.raw.carriers.length === 2, '카페24 배송사 목록 = GET /api/v2/admin/carriers?shop_no=1 · CJ 후보 코드·carrier_id·기본 여부 · 원문 raw', JSON.stringify(q.body).slice(0, 200));
      c24getFail = Object.assign(new Error('cafe24_api_403'), { status: 403 }); q = await g(); ok(q.status === 403 && /read_shipping/.test(q.body.error), '권한 없음 = 403 「재승인 확인」'); c24getFail = null; }
    console.log('⑤ 글자(전송 0 · 장착 · 무회귀)');
    const ia = fs.readFileSync(path.join(ROOT, 'invoice-auto.js'), 'utf8');
    ok(!/callNaver|apiReq|callCoupang|fetch\(|require\('https?'\)|product-orders\/dispatch|orders\/invoices|admin\/shipments/.test(ia), 'invoice-auto.js 에 네트워크 함수·채널 경로 0(길은 server.js transport 만)');
    ok(/naver: body => naverCallWithRetry\(\{ method: 'POST', path: '\/external\/v1\/pay-order\/seller\/product-orders\/dispatch', body \}\)/.test(src) && /coupang: body => naverRelay\.callCoupang\(\{ method: 'POST', path: '\/v2\/providers\/openapi\/apis\/api\/v4\/vendors\/\{vendorId\}\/orders\/invoices', body \}, null\)/.test(src) && /cafe24: body => cafe24\.apiReq\('POST', '\/api\/v2\/admin\/shipments', body\)/.test(src), 'server.js transport = 네이버 dispatch(relay) · 쿠팡 v4 invoices({vendorId} = relay 가 채움) · 카페24 admin/shipments(직접)');
    ok(/require\('\.\/invoice-auto\.js'\)\(app, \{ pool, authMiddleware, adminOnly,/.test(src) && /invoiceAuto\.initDB\(\)/.test(src), 'server.js 장착 + initDB 사슬');
    ok(/naver: async days => \{ if \(!naverRelay\.configured\(\)\) throw new Error\('중계서버 환경변수 미설정'\); return naverFetchInvoiceOrders\(days\); \}/.test(src) && /coupangFetchInvoiceOrders\(Math\.min\(days, 31\)\)/.test(src) && /cafe24\.fetchInvoiceOrders\(Math\.min\(days, 90\)\)/.test(src), '재조회 = 종전 불러오기 함수 그대로(쿠팡 31 · 카페24 90)');
    ok(/app\.post\('\/api\/agent-office\/invoice-auto\/register', authMiddleware, adminOnly,/.test(ia) && /app\.post\('\/api\/agent-office\/invoice-auto\/match', authMiddleware,/.test(ia), '권한 = match 로그인 · register 관리자');
    ok(!/DEFAULT/.test((ia.match(/CREATE TABLE IF NOT EXISTS invoice_auto_runs[\s\S]*?\)`\);/) || [''])[0].replace(/DEFAULT now\(\)/g, '')), '새 표에 now() 밖 DEFAULT 없음');
    const { execSync } = require('child_process'); let diffFo = '';
    try { diffFo = execSync('git diff --stat -- public/final-order-core.js public/invoice-v2.js', { cwd: ROOT }).toString().trim(); } catch (e) { diffFo = 'git 실패'; }
    ok(diffFo === '', '최종발주 판정·산출 파일(final-order-core.js·invoice-v2.js) 무변경(final-order.js 는 워커1 화면 묶음 추가 몫)', diffFo);
    ok(unknownSql.length === 0, '가짜 pool 이 모르는 SQL 0', unknownSql.join(' | '));

    console.log(`\n결과 ${pass}/${pass + fail}` + (fail ? ` — 실패 ${fail}` : ''));
    process.exitCode = fail ? 1 : 0;
    await new Promise(res => srv.close(res));
})().catch(e => { console.error(e); process.exitCode = 1; });

/* #402 단위 검증 — 쿠팡 발주확인: 실 server.js에서 coupangConfirmSheets 블록을 그대로 추출·실행(스텁 주입)
   케이스: 전체 성공·부분 실패·응답 누락 박스·호출 예외 + 배선 grep 검산 */
const fs = require('fs');
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const src = fs.readFileSync(PROJ + '\\server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

// 실코드 블록 추출 (줄 단위 — 함수 선언부터 최상위 닫힘까지)
const start = src.indexOf('async function coupangConfirmSheets(boxIds)');
if (start < 0) { console.error('함수 없음'); process.exit(2); }
const lines = src.slice(start).split('\n');
let depth = 0, endLine = 0;
for (let i = 0; i < lines.length; i++) {
  depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
  if (i > 0 && depth === 0) { endLine = i; break; }
}
const fnCode = lines.slice(0, endLine + 1).join('\n');
console.log('블록 추출:', fnCode.length + '자 ·', (endLine + 1) + '줄');

(async () => {
  const make = (stub) => {
    // COUPANG_ACK_PATH 상수 + 스텁 주입해 실행
    const wrapper = new Function('coupangCallWithRetry', `
      const COUPANG_ACK_PATH = '/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets/acknowledgement';
      ${fnCode}
      return coupangConfirmSheets;`);
    return wrapper(stub);
  };

  // ① 전체 성공
  let calls = [];
  let f = make(async (req) => { calls.push(req); return { data: { responseCode: 0, responseList: req.body.shipmentBoxIds.map(id => ({ shipmentBoxId: id, succeed: true })) } }; });
  let r = await f([111, 222]);
  ok(r.success.length === 2 && r.fail.length === 0, '① 전체 성공 파싱', JSON.stringify(r.success));
  ok(calls[0].method === 'PATCH' && /acknowledgement$/.test(calls[0].path) && !('vendorId' in calls[0].body), '① PATCH·경로·vendorId 미포함(릴레이 주입)', calls[0].path.slice(-40));

  // ② 부분 실패
  f = make(async (req) => ({ data: { responseCode: 1, responseList: [
    { shipmentBoxId: req.body.shipmentBoxIds[0], succeed: true },
    { shipmentBoxId: req.body.shipmentBoxIds[1], succeed: false, resultCode: 'ERR', resultMessage: '부분취소 진행 중' },
  ] } }));
  r = await f([1, 2]);
  ok(r.success.length === 1 && r.fail.length === 1 && /부분취소/.test(r.fail[0].message), '② 부분 실패 분리', JSON.stringify(r.fail[0]).slice(0, 80));

  // ③ 응답 누락 박스 = 실패 처리 (무언 통과 금지)
  f = make(async (req) => ({ data: { responseList: [{ shipmentBoxId: req.body.shipmentBoxIds[0], succeed: true }] } }));
  r = await f([10, 20]);
  ok(r.success.length === 1 && r.fail.length === 1 && r.fail[0].message.includes('응답에 처리 결과 없음'), '③ 응답 누락 = 실패 기록', JSON.stringify(r.fail[0]).slice(0, 70));

  // ④ 호출 예외(릴레이 403 등) = 전 박스 실패
  f = make(async () => { const e = new Error('coupang_relay_error_403'); e.status = 403; throw e; });
  r = await f([7, 8, 9]);
  ok(r.success.length === 0 && r.fail.length === 3 && r.fail[0].code === '403', '④ 호출 예외 = 전 박스 실패(403 기록)', r.fail.length + '건');

  // ⑤ 50개 청크 분할
  calls = [];
  f = make(async (req) => { calls.push(req.body.shipmentBoxIds.length); return { data: { responseList: req.body.shipmentBoxIds.map(id => ({ shipmentBoxId: id, succeed: true })) } }; });
  r = await f(Array.from({ length: 120 }, (_, i) => i + 1));
  ok(calls.length === 3 && calls[0] === 50 && calls[2] === 20 && r.success.length === 120, '⑤ 50개 청크 분할', calls.join('/'));

  // ⑥ 배선 grep 검산
  ok(src.includes("sentOrders.push({ orderKey, orderId: String(s.orderId) })"), '⑥ 발송 성공 → 발주확인 대상 수집 배선');
  ok(src.includes("acceptBoxes.get(so.orderId)") && src.includes("confirm_status='already'"), '⑥ INSTRUCT 감지 주문 = already 처리');
  ok(src.includes("confirm_status='confirmed', confirmed_at=NOW()") && src.includes("confirm_status='failed', confirm_error="), '⑥ confirmed/failed 갱신 배선');
  const relay = fs.readFileSync(PROJ + '\\relay\\server.js', 'utf8');
  ok(relay.includes("m: 'PATCH', tpl: '/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets/acknowledgement'"), '⑥ 릴레이 ALLOW PATCH 추가');
  ok(relay.includes("vendorId: COUPANG_VENDOR_ID }) : undefined"), '⑥ 릴레이 body vendorId 강제 주입');
  ok(relay.includes("2026-08-24.1"), '⑥ RELAY_VERSION 갱신(배포 확인용)');

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

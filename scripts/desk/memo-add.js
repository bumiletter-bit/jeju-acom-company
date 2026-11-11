// #1108-(d)(대표 11/11 「사람 확인 후 저장으로 우선」) 창구 → 발주 메모함 「확인 대기 줄」 넣기
//   서버 POST /api/order-memo/desk(order-memo.js) 를 부름 · 창구는 로그인 토큰이 없어 설정 order_memo_desk 의 토큰(파일 ~/.akkome/order-memo-desk-token.txt)으로
//   기본 = 판정만(--dry · 저장 0) · --add = 확인 대기 줄로 넣음(sure false · 「에이전트가 넣음 · 확인 필요」 = 최종발주에 자동으로 안 들어감 · 사람이 메모함에서 저장)
//   범위 = 사이즈 · 과수 · 발송일 · 보내는 이 (입력삭제·현금 주소 줄은 사람만)
//
//   node scripts/desk/memo-add.js --type size --value S --phone 010-1234-5678 [--name 홍길동] [--order 2026111...] [--plat 네이버] [--text "손님 원문"] [--by "창구 → 메모함 #3600"] [--add]
//   type = size(값 2S·S·M) · gwa(값 13 = 13과) · date(값 YYYY-MM-DD) · sender(값 = 보내는 분 이름)
//   여러 건 = --json '[{"type":"size","value":"S","phone":"010..."}, …]'
//   결과(한 줄씩) = ✅ 넣을 수 있음/넣음 · 열쇠(구매자 번호 또는 상품주문번호) · 찾은 길(구매자 번호/받는 분 번호/이름/주문번호) | ⚠ 못 넣음 · 까닭 · 후보
//   환경 = ORDER_MEMO_API(없으면 https://event.akkome.com) · ORDER_MEMO_DESK_TOKEN(없으면 위 파일)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
try { require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') }); } catch (_) { /* .env 없어도 됨 */ }

function args(argv) {
    const o = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; }
    return o;
}
function token() {
    if (process.env.ORDER_MEMO_DESK_TOKEN) return String(process.env.ORDER_MEMO_DESK_TOKEN).trim();
    const f = path.join(os.homedir(), '.akkome', 'order-memo-desk-token.txt');
    try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { return ''; }
}
async function main() {
    const a = args(process.argv.slice(2));
    let items = [];
    if (a.json) { try { items = JSON.parse(a.json); } catch (e) { console.error('⚠ --json 을 읽지 못했어요'); return 2; } if (!Array.isArray(items)) items = [items]; }
    else items = [{ type: a.type, value: a.value, phone: a.phone, name: a.name, order_no: a.order, plat: a.plat }];
    items = items.map(x => Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v !== undefined && v !== true)));
    if (!items.length || items.some(x => !x.type || !x.value)) { console.error('⚠ --type · --value 가 필요해요(머리 주석 참고)'); return 2; }
    const tok = token(); if (!tok) { console.error('⚠ 토큰이 없어요(~/.akkome/order-memo-desk-token.txt 또는 ORDER_MEMO_DESK_TOKEN)'); return 2; }
    const API = String(process.env.ORDER_MEMO_API || 'https://event.akkome.com').replace(/\/+$/, '');
    const body = { items, dry: !a.add, by: typeof a.by === 'string' ? a.by : '창구 → 메모함', text: typeof a.text === 'string' ? a.text : '' };
    let r, j;
    try { r = await fetch(API + '/api/order-memo/desk', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Token': tok }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); }
    catch (e) { console.error('⚠ 서버에 닿지 못했어요: ' + e.message); return 1; }
    if (!r.ok || !j.ok) { console.error('⚠ ' + (j.error || ('서버 응답 ' + r.status))); return 1; }
    const VIA = { buyer_phone: '구매자 번호', recv_phone: '받는 분 번호', order_no: '주문번호', buyer_name: '구매자 이름', recv_name: '받는 분 이름' };
    for (const x of j.results || []) {
        if (x.ok) console.log(`${j.dry ? '✅ 넣을 수 있음' : '✅ 넣음(확인 대기)'} · ${x.type} 「${x.note}」 · ${x.plat} · 열쇠 ${x.key} · 찾은 길 ${VIA[x.via] || x.via} · 주문 ${x.orders}건${x.sample ? ' · ' + x.sample.option : ''}`);
        else console.log(`⚠ 못 넣음 · ${x.type} · ${x.message}${x.candidates ? ' · 후보 ' + x.candidates.map(c => [c.plat, c.option, c.qty ? c.qty + '박스' : '', c.paid, c.buyer ? '구매자 ' + c.buyer : '', c.recv ? '받는 분 ' + c.recv : ''].filter(Boolean).join(' ')).join(' / ') : ''}`);
    }
    if (!j.dry) console.log(`저장 ${j.saved}줄(메모함 「확인」 줄 · 사람이 [고친 대로 저장] 해야 최종발주에 들어감)`);
    return 0;
}
main().then(c => process.exit(c || 0), e => { console.error(e); process.exit(1); });

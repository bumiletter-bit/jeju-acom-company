// #1140 검증: 손님 메모 사이즈가 애매하면 자동으로 정하지 않는다(대표 11/13 실사고 「S싸이즈로 … 지난번 2s는 작아서」 → 2S 로 나감)
//   A = app.js 실코드(detectSize ~ 품목명 카탈로그 · addSizeSuffix)를 떼어 실행
//   B = final-order.js 실코드(sizeApply · #1140 카드 묶음)를 떼어 가짜 자료로 실행 — 꼬리 정상 1건 · 애매 1건 · 메모 줄로 정해진 1건
//   🔴 실DB·서버·브라우저 0 · 가짜 번호만
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + t + (c || d === undefined ? '' : ' — ' + JSON.stringify(d))); };
const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8').split('\r\n').join('\n');
const a = app.indexOf('function detectSize(msg)'), a2 = app.indexOf('// 품목명 카탈로그', a), b = app.indexOf('function addSizeSuffix(optionInfo, msg)'), b2 = app.indexOf('}', app.indexOf('return optionInfo;', b)) + 1;
const A = new Function(app.slice(a, a2) + '\n' + app.slice(b, b2) + '\nreturn { detectSize, sizeAmbig, addSizeSuffix };')();
// v2 가 자르는 구간 안에 새 함수가 다 있는지(구간 = detectSize ~ 채널 초기화)
const v2seg = app.slice(app.indexOf('function detectSize(msg)'), app.indexOf('// 채널 초기화'));
ok(/function sizeScan\(/.test(v2seg) && /function sizeAmbig\(/.test(v2seg) && /const SIZE_NEG_AFTER/.test(v2seg), 'v2 자르는 구간 안에 sizeScan·sizeAmbig·SIZE_NEG_AFTER');

const INC = '크기는 “S싸이즈“로 부탁드립니다 지난번 2s는 작아서 먹기 불편했어요 ㅜ';
console.log('— A. detectSize');
[
  ['2s로 부탁', '2S'], ['S사이즈', 'S'], ['에스로', 'S'], ['M 사이즈 부탁드려요', 'M'], ['투에스로 주세요', '2S'], ['m사이즈로', 'M'],
  ['문 앞에 놔주세요', null], ['', null],
  [INC, null], ['S싸이즈로', 'S'], ['2s 말고 s로', null], ['s나 m으로', null], ['지난번 2s는 작았어요', null], ['M 사이즈 말고 큰걸로', null],
  ['소과 말고 M사이즈로', 'M'], ['지난번처럼 S사이즈로 부탁해요', 'S'],
].forEach(([m, w]) => { const r = A.detectSize(m); ok(r === w, `detectSize 「${m}」 → ${w}`, r); });

console.log('— A. addSizeSuffix(귤 로얄과)');
const H = '고당도 하우스감귤 / 상품 및 과수: 가정용 - 4kg(로얄과)';
[
  ['소과로 부탁드립니다', ' 2S사이즈로!'], ['작게 부탁드려요', ' 2S사이즈로!'], ['2s로 부탁', ' 2S사이즈로!'], ['S싸이즈로', ' S사이즈로!'],
  [INC, ''], ['지난번 2s는 작았어요', ''], ['지난번에 너무 작아서 불편했어요', ''], ['소과 말고 큰 걸로요', ''], ['s나 m으로', ''],
].forEach(([m, t]) => { const r = A.addSizeSuffix(H, m); ok(r === H + t, `addSizeSuffix 「${m}」 → ${t || '그대로'}`, r); });
ok(A.addSizeSuffix('고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)', INC) === '고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)', '선물용은 종전대로 안 붙음');

console.log('— B. 최종발주 sizeApply + #1140 카드(실코드 떼어 실행)');
const fo = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').split('\r\n').join('\n');
const cut = (s, x, y) => { const i = s.indexOf(x); if (i < 0) throw new Error('없음 ' + x); const j = s.indexOf(y, i); if (j < 0) throw new Error('끝 없음 ' + y); return s.slice(i, j); };
const SA = cut(fo, '    function sizeApply() {', '    // #883(대표 10/27');
const CARD = cut(fo, '        // #1140 손님 메모 사이즈가 애매한', '        // #883 과수 줄 카드');
ok(/sizeAmbig/.test(SA) && /lszm:/.test(SA), 'sizeApply 안 #1140 묶음');
const T = 'S사이즈로!';
const BUY_A = '01011110001', BUY_B = '01011110002', BUY_C = '01011110003';
const mk = (pid, tel, opt, memo) => ({ ch: 'naver', pid, conv: { '옵션정보': opt, '배송메세지': memo, '수량': 1, '구매자연락처': tel }, raw: { '배송메세지': memo }, excluded: false, userTouched: false });
function run(dec) {
  const merged = [
    mk('P1', BUY_A, H + ' S사이즈로!', 'S사이즈로 부탁드려요'),     // 꼬리 정상(v2 가 붙임)
    mk('P2', BUY_B, H, INC),                                       // 애매 → 카드
    mk('P3', BUY_C, H, INC),                                       // 애매지만 메모 줄(번호 + M)로 정해짐 → 카드 없음
    mk('P4', BUY_B, '과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)', INC),   // 귤 로얄과 아님 → 카드 없음
  ];
  const st = { sizeLines: [{ digits: BUY_C, key: '', size: 'M', raw: BUY_C + ' M사이즈', srcLine: 1 }], upLines: [], dec: new Map(Object.entries(dec || {})), patch: new Map(), omBoxes: null };
  const env = {
    S: () => ({ merged }), st, keyOf: e => e.ch + ':' + e.pid, buyerTel: e => String(e.conv['구매자연락처'] || '').replace(/\D/g, ''), idsOf: e => [e.pid],
    sizeItem: s => { s = String(s || ''); return /귤/.test(s) && /로얄과/.test(s) && !/선물용/.test(s); }, rawOf: e => e.raw || {}, NO_TEL: new Set(['01000000000']),
    recvMatches: () => [], core: () => ({ stripTail: s => s.replace(/\s\S+로!$/, ''), boxTails: () => ({ ok: false }) }), inCatalog: () => true, qtyNow: e => e.conv['수량'], boxGroup: x => x, gwaApply: () => {}, sizeAmbig: A.sizeAmbig,
  };
  const names = Object.keys(env);
  const fn = new Function(...names, SA + '\nreturn sizeApply;')(...names.map(n => env[n]));
  const info = fn();
  const cards = [];
  const cardEnv = { st, cards, groupTitle: es => es[0].pid + (es.length > 1 ? ' 외' : ''), telLine: e => ['번호', e.conv['구매자연락처']], orderLine: e => e.pid };
  const cn = Object.keys(cardEnv); new Function(...cn, CARD)(...cn.map(n => cardEnv[n]));
  return { st, info, cards };
}
let r = run();
const amb = r.cards.filter(c => c.id.startsWith('lszm:'));
ok(amb.length === 1, '카드 1장(애매한 귤 로얄과 1건만)', r.cards.map(c => c.id));
ok(amb[0] && amb[0].keys.join() === 'naver:P2', '카드 = 실사고 원문 주문 P2', amb[0] && amb[0].keys);
ok(amb[0] && amb[0].tag === '사이즈 확인' && amb[0].lines.some(l => l[0] === '손님 메모' && l[1] === INC), '태그 「사이즈 확인」 · 손님 메모 원문');
ok(amb[0] && amb[0].choices.map(c => c[0]).join() === '2S,S,M,skip', '고르기 = 2S·S·M·안 붙임', amb[0] && amb[0].choices);
ok(!r.st.sizeTail.has('naver:P2'), '고르기 전 = P2 꼬리 없음');
ok(r.st.sizeTail.get('naver:P3') === 'M사이즈로!', '메모 줄로 정해진 P3 = M · 카드 없음');
ok(!r.st.sizeTail.has('naver:P1'), '꼬리 정상 P1 = 손대지 않음(옵션 꼬리 S 그대로)');
ok(!r.st.sizeTail.has('naver:P4'), '황금향 P4 = 무접촉');
r = run({ [amb[0].id]: 'S' });
ok(r.st.sizeTail.get('naver:P2') === T, 'S 고르면 P2 = S사이즈로!', [...r.st.sizeTail]);
ok(r.info.some(x => /사이즈 확인\(손님 메모\)으로 정함/.test(x.t || '')), '참고 줄 「사이즈 확인으로 정함」');
r = run({ [amb[0].id]: 'skip' });
ok(!r.st.sizeTail.has('naver:P2'), '「안 붙임」 = 꼬리 없음');

console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);

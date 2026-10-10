// #554 검증: 손님 메모의 사이즈 꼬리는 「귤 로얄과(선물용 제외)」에만 — app.js 실코드(detectSize·addSizeSuffix)를 떼어 실행
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8').split('\r\n').join('\n');
const a = src.indexOf('function detectSize(msg)'), a2 = src.indexOf('// 품목명 카탈로그', a), b = src.indexOf('function addSizeSuffix(optionInfo, msg)'), b2 = src.indexOf('}', src.indexOf('return optionInfo;', b)) + 1;
const add = new Function(src.slice(a, a2) + '\n' + src.slice(b, b2) + '\nreturn addSizeSuffix;')();
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + t + (d ? ' — ' + d : '')); };
const H = '고당도 하우스감귤 / 상품 및 과수: ', Y = '유라품종 노지감귤 / 상품 및 과수: ', G = '과즙팡팡 황금향 / 상품 및 과수: ';
const T = [
  [H + '가정용 - 2.5kg(로얄과)', '2S로 보내주세요', ' 2S사이즈로!'], [H + '가정용 - 4kg(로얄과)', 'M사이즈 부탁', ' M사이즈로!'], [H + '가정용 - 4.5kg(로얄과)', '작은 걸로 주세요', ' 2S사이즈로!'],
  [Y + '가정용 - 3kg(로얄과 2S~M)', 's사이즈로', ' S사이즈로!'],
  // #623(대표 10/10): 로얄과 주문의 「소과」 = 2S · 사이즈 글자가 같이 있으면 그 글자가 먼저 · 「작은·작게」 류도 2S · 소과 품목 자체는 종전대로 안 붙임
  [H + '가정용 - 2.5kg(로얄과)', '소과로 부탁드립니다', ' 2S사이즈로!'], [H + '가정용 - 4kg(로얄과)', '소과 말고 M사이즈로', ' M사이즈로!'], [H + '가정용 - 4kg(로얄과)', '작게 부탁드려요', ' 2S사이즈로!'], [H + '가정용 - 2.5kg(소과)', '소과로 부탁드립니다', ''], [H + '선물용 - 3kg(로얄과)', '소과로', ''],
  [H + '가정용 - 2.5kg(소과)', 'S사이즈로 주세요', ''], [H + '가정용 - 4.5kg(소과)', '작은 걸로', ''], [H + '가정용 - 4.5kg(중대과)', 'M사이즈', ''],
  [H + '선물용 - 3kg(로얄과)', '2S로', ''], [Y + '가정용 - 3kg(소과 2S미만)', 'S사이즈', ''], [Y + '가정용 - 5kg(중대과 L이상)', 'm사이즈', ''],
  [G + '황금향 가정용 - 3kg(중소과 17과 전후)', '2S 사이즈로', ''], [G + '황금향 선물용 - 3kg(중대과 7~15과)', 's사이즈', ''],
  ['과수 및 크기: 제주 그린레몬3kg(중소과)', 'M사이즈', ''], ['과수 및 크기: 제주 레드키위 3kg(로얄과)', 'S사이즈', ''],
  [H + '가정용 - 2.5kg(로얄과)', '문 앞에 놔주세요', ''], [H + '가정용 - 2.5kg(로얄과)', '', ''],
];
for (const [opt, memo, tail] of T) { const r = add(opt, memo); ok(r === opt + tail, `${opt.split(': ').pop()} · 「${memo}」 → ${tail ? '꼬리' + tail : '그대로'}`, r === opt + tail ? '' : r); }
console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);

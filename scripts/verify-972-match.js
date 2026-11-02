// #972 노지귤·노지 황금향 매칭 검증(읽기·외부 호출 0 · 실DB 0)
//   ① 새 옵션 전부(채널 글꼴별) → 단가표 이름 ② 옛 옵션(변경 전 주문) 그대로 ③ 변형 = 맞는 품목 또는 [미매칭](다른 품목으로 조용히 안 감)
//   ④ HEAD 판과 비교: 새 글자 없는 글은 결과 바이트 동일(카탈로그 전체 + 넘긴 말뭉치 파일 VERIFY_972_CORPUS)
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
function load(src) {
    const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('표식 없음 ' + a); return src.slice(i, j); };
    const body = cut('const PRODUCT_CATALOG', '// 보내는사람연락처');
    return new Function('NAMES_', 'detectSize', body + '\naoInvoicePricingNames = NAMES_;\nreturn { matchProduct, matchProductRaw, addSizeSuffix, PRODUCT_CATALOG };');
}
let cur = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const head = execSync('git show c1159aa:public/app.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString().replace(/\r\n/g, '\n');
const YURA = [], NOJI = [], NH = ['노지 황금향 가정용 - 5kg(혼합과)', '노지 황금향 가정용 - 10kg(혼합과)', '노지 황금향 못난이 - 5kg(혼합과)', '노지 황금향 못난이 - 10kg(혼합과)'].map(x => '과즙팡팡 황금향 / 상품 및 과수: ' + x);
for (const w of ['3kg', '5kg', '10kg']) for (const g of ['로얄과 2S~M', '소과 2S미만', '중대과 L이상']) { YURA.push(`유라품종 노지감귤 / 상품 및 과수: 가정용 - ${w}(${g})`); NOJI.push(`새콤달콤 노지감귤 / 상품 및 과수: 가정용 - ${w}(${g})`); }
const HW = ['황금향 가정용 - 3kg(중소과 17과 전후)', '황금향 가정용 - 5kg(중소과 27과 전후)', '황금향 선물용 - 3kg(중대과 7~15과)', '황금향 선물용 - 5kg(중대과 13~25과)', '황금향 못난이 - 5kg(랜덤과)', '황금향 못난이 - 10kg(랜덤과)'].map(x => '과즙팡팡 황금향 / 상품 및 과수: ' + x);
const TY = ['가정용 - 3kg(소과 2S미만)', '가정용 - 3kg(로얄과 2S~M)', '가정용 - 5kg(로얄과 2S~M)', '가정용 - 5kg(중대과 L이상)', '선물용 - 3kg(로얄과 2S~M)', '가정용 - 10kg(로얄과 2S~M)'].map(x => '고당도 타이벡감귤 / 상품 및 과수: ' + x);
const NAMES = [...YURA, ...NOJI, ...NH, ...HW, ...TY];
const detectSize = m => (/2S/.test(m) ? '2S' : /\bM\b/.test(m) ? 'M' : null);
const C = load(cur)(NAMES, detectSize), H = load(head)(NAMES, detectSize);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('❌ ' + m); } };
const eq = (raw, want) => { const g = C.matchProduct(raw); ok(g === want, raw + ' → ' + g + ' (기대 ' + want + ')'); };
const miss = raw => { const g = C.matchProduct(raw); ok(String(g).startsWith('[미매칭]'), raw + ' → ' + g + ' (기대 미매칭)'); };
const tail = n => n.split('상품 및 과수: ')[1];

// ① 새 옵션: 네이버·자사몰 꼴 · 단가표 없는 날은 표준명 → 미매칭
for (const n of NOJI) { const t = tail(n);
    eq('아꼼이네 상품선택: 2. (제철)새콤달콤 노지감귤 / 상품 및 과수: ' + t, n);
    eq('2. (제철)새콤달콤 노지감귤 / 상품 및 과수: ' + t, n);
    eq('제주 감귤 상품 선택=2. (제철)새콤달콤 노지감귤 · ' + t, n);
    eq('제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 새콤달콤 노지감귤 ' + t.replace(' - ', ' '), n);
    eq('제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 노지감귤 ' + t.replace(' - ', ' ') + ' 1박스', n);
}
for (const n of NH) { const t = tail(n);
    eq('1. (제철)과즙팡팡 황금향 / 상품 및 과수: ' + t, n);
    eq('3. (제철)과즙팡팡 황금향 / 상품 및 과수: ' + t, n);
    eq('제주 황금향 상품 선택=1. (제철)과즙팡팡 황금향 · ' + t, n);
    eq('제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, ' + t.replace(' - ', ' '), n);
    eq('제주아꼼이네 제철 고당도 타이벡감귤, 1박스, ' + t.replace(' - ', ' '), n);
}
// 선물용 새 묶음 번호 = 종전 이름 그대로
eq('1. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', HW[2]);
eq('3. (제철)과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)', HW[3]);
eq('2. 과즙팡팡 황금향 선물용 3kg', HW[2]);
// ② 옛 옵션(변경 전 주문 · 내일 나감)
for (const n of YURA) { const t = tail(n);
    eq('아꼼이네 상품선택: 2. (제철)유라품종 노지감귤 / 상품 및 과수: ' + t, n);
    eq('제주 감귤 상품 선택=2. (제철)유라품종 노지감귤 · ' + t, n);
    const short = t.replace(' 2S~M', '').replace(' 2S미만', '').replace(' L이상', '').replace(' - ', ' ');
    eq('제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, ' + short, n);
}
for (const n of HW) eq('1. (제철)과즙팡팡 황금향 / 상품 및 과수: ' + tail(n), n);
eq('제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 못난이 5kg(랜덤과)', HW[4]);
eq('제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 못난이 10kg(랜덤과)', HW[5]);
eq('제주아꼼이네 제철 고당도 타이벡감귤, 1박스, 황금향 못난이 5kg(랜덤과)', HW[4]);
eq('제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 가정용 5kg', HW[1]);
for (const n of TY) eq('1. (제철)고당도 타이벡감귤 / 상품 및 과수: ' + tail(n), n);
eq('제주아꼼이네 제철 고당도 타이벡감귤, 1박스, 타이벡감귤 가정용 3kg(로얄과 2S~M)', TY[1]);
// ③ 변형: 맞는 품목
eq('노지 황금향 5kg 랜덤과', NH[0]);
eq('노지황금향 가정용 10kg(랜덤과)', NH[1]);
eq('과즙팡팡 황금향 / 상품 및 과수: 노지 황금향 못난이 - 5kg(랜덤과)', NH[2]);
eq('제주아꼼이네 황금향, 노지 못난이 10kg', NH[3]);
eq('노지귤 5kg 로얄과', NOJI[3]);
eq('노지 감귤 3kg 소과', NOJI[1]);
eq('새콤달콤노지감귤 10kg(중대과)', NOJI[8]);
eq('새콤달콤 노지감귤, 가정용 5kg(2S~M)', NOJI[3]);
// ③ 변형: 미매칭(짐작 금지)
miss('노지 황금향 3kg');                 // 없는 중량
miss('노지 황금향 선물용 5kg');           // 없는 구성
miss('노지 황금향 하우스 황금향 5kg');
miss('노지 황금향 한라봉 5kg');
miss('노지귤 5kg');                       // 등급 없음
miss('노지감귤 선물용 3kg(로얄과)');
miss('제주아꼼이네 제철 고당도 타이벡감귤, 1박스, 노지감귤 3kg(로얄과)');
miss('제주아꼼이네 제철 고당도 하우스감귤, 1박스, 노지감귤 3kg(로얄과)');
miss('새콤달콤 노지감귤 / 상품 및 과수: 가정용 - 4kg(로얄과 2S~M)');
// 단가표에 이름이 없는 날
{ const D = load(cur)(HW, detectSize); ok(String(D.matchProduct('노지 황금향 5kg 랜덤과')).startsWith('[미매칭]'), '단가표에 노지 황금향 없음 = 미매칭'); ok(String(D.matchProduct('노지귤 5kg 로얄과')).startsWith('[미매칭]'), '단가표에 노지귤 없음 = 미매칭'); }
// 사이즈 꼬리 = 노지귤 로얄과만 · 황금향·소과 X
ok(C.addSizeSuffix(NOJI[3], '2S로 주세요') === NOJI[3] + ' 2S사이즈로!', '노지귤 로얄과 꼬리');
ok(C.addSizeSuffix(NOJI[4], '2S로 주세요') === NOJI[4], '노지귤 소과 꼬리 없음');
ok(C.addSizeSuffix(NH[0], '2S로 주세요') === NH[0], '노지 황금향 꼬리 없음');
// ④ 무회귀: HEAD 와 바이트 동일
const corpus = [...H.PRODUCT_CATALOG];
if (process.env.VERIFY_972_CORPUS) corpus.push(...JSON.parse(fs.readFileSync(process.env.VERIFY_972_CORPUS, 'utf8')));
const diff = []; for (const t of corpus) { const a = H.matchProduct(t), b = C.matchProduct(t); if (a !== b) diff.push(t + ' | 옛 ' + a + ' | 새 ' + b); }
ok(!diff.length, '옛 판과 다른 결과 ' + diff.length + '건\n' + diff.slice(0, 20).join('\n'));
console.log('말뭉치 ' + corpus.length + '건 차이 ' + diff.length);
// ⑤ 쿠팡 옛 옵션(지금 라이브 코드 = c1159aa · 새 코드 둘 다) = 옛 품목
const OLDC = [['제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 가정용 3kg(로얄과)', YURA[0]], ['제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 가정용 5kg(소과)', YURA[4]], ['제주아꼼이네 제철 새콤달콤 유라품종 노지감귤, 1박스, 가정용 10kg(중대과)', YURA[8]], ['제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 못난이 5kg(랜덤과)', HW[4]], ['제주아꼼이네 제철 과즙팡팡 황금향 출하, 1박스, 못난이 10kg(랜덤과)', HW[5]], ['제주아꼼이네 제철 고당도 타이벡감귤, 1박스, 황금향 못난이 5kg(랜덤과)', HW[4]], ['제주아꼼이네 제철 고당도 타이벡감귤, 1박스, 타이벡감귤 가정용 3kg(로얄과 2S~M)', TY[1]]];
for (const [raw, want] of OLDC) { ok(H.matchProduct(raw) === want, '라이브 코드 ' + raw + ' → ' + H.matchProduct(raw)); ok(C.matchProduct(raw) === want, '새 코드 ' + raw + ' → ' + C.matchProduct(raw)); }
// ⑥ 봇 판매현황 줄 좁히기(server.js 실코드)
{ const sv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n'); const stop = sv.match(/const QNA_FILTER_STOPWORDS = \[[\s\S]*?\];\n/); const i = sv.indexOf('function qnaFilterStoreLines'), j = sv.indexOf('// {{가격표}}/{{판매현황}} 치환', i); if (!stop || i < 0 || j < 0) throw new Error('좁히기 구간 없음');
  const F = new Function(stop[0] + sv.slice(i, j) + '\nreturn qnaFilterStoreLines;')();
  const lines = [...NOJI, ...NH, ...TY, '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', '노지 한라봉 / 상품 및 과수: 한라봉 가정용 - 5kg(랜덤과)'].map(n => '- ' + n + ': 판매중').join('\n');
  const L = q => F(lines, q).split('\n'), noji = x => /노지감귤/.test(x), nh = x => /노지 황금향/.test(x);
  ok(L('노지귤이 뭐예요').every(noji) && L('노지귤이 뭐예요').length === 9, '「노지귤」 = 노지감귤 9줄만', L('노지귤이 뭐예요'));
  ok(L('노지 있어요').every(noji), '「노지」 = 노지감귤만', L('노지 있어요'));
  ok(L('노지황금향 얼마').every(nh) && L('노지황금향 얼마').length === 4, '「노지황금향」 = 4줄', L('노지황금향 얼마'));
  ok(!L('노지 황금향 있어요').some(noji) && L('노지 황금향 있어요').some(nh), '「노지 황금향」 = 노지감귤 안 섞임', L('노지 황금향 있어요'));
  ok(L('노지 한라봉 있어요').some(x => /한라봉/.test(x)), '「노지 한라봉」 = 종전대로 한라봉 줄', L('노지 한라봉 있어요'));
  ok(L('타이벡이랑 노지귤 차이').some(x => /타이벡/.test(x)) && L('타이벡이랑 노지귤 차이').some(noji) && !L('타이벡이랑 노지귤 차이').some(nh), '비교 질문 = 두 품목 줄 · 황금향 없음', L('타이벡이랑 노지귤 차이')); }
console.log('결과: ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);

// #1248 검증 — 메모함 현금 줄 주소 「도로명, 건물명 손님 상세」(대표 11/22) · 실DB·네트워크·브라우저 0
//   ① 순수 = public/ao-ordermemo.js 의 addrText·bdOf·bdCust·bdSame·bdHtml 과 public/order-organizer.js 의 splitAddr·tidyDetail·searchBody·exactMatches 를 파일에서 떼어 그대로 실행
//      + addrSearch 의 판정 줄(저절로 끼울 이름)을 같은 식으로 · 가짜 juso 응답 한 벌(분기 여는 것)
//   ② 손님 상세 바이트 보존 = 끼운 주소에서 「, 건물명」을 빼면 끼우기 전 주소와 글자까지 같음 · 손님 상세는 언제나 주소 글 끝에 그대로
//   사용: node scripts/verify-1248-bdnm.js   (화면 클릭·폰 그림은 verify-1248-ui.js)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const OMJ = fs.readFileSync(path.join(ROOT, 'public', 'ao-ordermemo.js'), 'utf8'), OOJ = fs.readFileSync(path.join(ROOT, 'public', 'order-organizer.js'), 'utf8');
const cut = (src, start, endMark) => { const i = src.indexOf(start); if (i < 0) throw new Error('못 찾음: ' + start); const j = src.indexOf(endMark, i + start.length); if (j < 0) throw new Error('끝 못 찾음: ' + endMark); return src.slice(i, j); };
const omPart = cut(OMJ, 'const addrText = (j, detail, bd)', 'const addrBad = ');
const ooPart = cut(OOJ, 'function tidyDetail(d){', 'window.ooVerifyOne') ;
const autoLine = /const cust = bdCust\(A\.detail\), auto = (B => [^;]+);/.exec(OMJ);
if (!autoLine) throw new Error('판정 줄 못 찾음');
const ctx = { esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), out: {} };
vm.createContext(ctx);
vm.runInContext(ooPart.replace(/^function applyCandidate[\s\S]*$/m, '') + '\n' + omPart + `\nout = { addrText, bdOf, bdCust, bdSame, bdIn, bdHtml, addrBtnLab, splitAddr, exactMatches, searchBody };`, ctx);
const F = ctx.out;
// addrSearch 와 같은 판정(파일의 줄을 그대로 씀)
function decide(raw, list) {
    const [body, detail] = F.splitAddr(raw); const A = { raw, detail: detail || '' };
    const uniq = [...new Set(list.map(j => j.roadAddrPart1 + '|' + j.zipNo))];
    const ex = uniq.length > 1 ? F.exactMatches(body, list, A.detail) : [];
    const one = (list.length === 1 || uniq.length === 1) ? list[0] : ex.length === 1 ? ex[0] : null;
    const cust = F.bdCust(A.detail); const auto = vm.runInContext('(' + autoLine[1] + ')', Object.assign(ctx, { cust, A }));
    if (one) { const B = Object.assign(F.bdOf(one, list), { cust }); A.state = 'one'; A.bd = B; A.road = F.addrText(one, A.detail, auto(B)); A.auto = auto(B); }
    else { A.state = 'multi'; A.cands = list.map(j => { const B = Object.assign(F.bdOf(j, list), { cust }), an = auto(B); return { road: F.addrText(j, A.detail, an), an, bdi: B }; }); }
    return A;
}
const J = (p1, bdNm, bdKdcd, det, zip) => ({ roadAddrPart1: p1, bdNm: bdNm || '', bdKdcd: String(bdKdcd == null ? 0 : bdKdcd), detBdNmList: det || '', zipNo: zip || '63000', jibunAddr: '' });
const HS = '제주특별자치도 제주시 화삼로 166', BOO = '제주삼화사랑으로부영5차', DET = '501동, 상가동, 보육시설, 관리동, 515동, 514동, 513동, 512동, 511동, 510동, 509동, 508동, 507동, 506동';
const L_HS = [J(HS, BOO, 1, DET, '63318')];
const text = h => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const card = (A, cell) => text(F.bdHtml({ _addr: A, cells: Object.assign([], { 8: cell }) }, 0));
const keepDetail = (A, road) => { const d = String(A.detail).replace(/^[,\s]+/, '').trim(); return !d || road.endsWith(d); };

console.log('── ① 대표 실례 · 손님이 건물명 안 적음 = 저절로 끼움');
{ const A = decide('화삼로 166, 511동 103호', L_HS);
  ok(A.state === 'one' && A.road === HS + ', ' + BOO + ' 511동 103호', '「화삼로 166, 511동 103호」 → 「…화삼로 166, 제주삼화사랑으로부영5차 511동 103호」', A.road);
  ok(A.road.replace(', ' + BOO + ' ', ', ') === F.addrText(L_HS[0], A.detail), '바이트 보존 = 건물명 빼면 종전 꼴과 글자까지 같음');
  const t0 = card(A, '화삼로 166, 511동 103호'); ok(/도로명 건물: 제주삼화사랑으로부영5차/.test(t0) && /주소에 넣기/.test(t0) && !/확인 필요|확인해 주세요|없는 동/.test(t0), '누르기 전 = 「🏢 도로명 건물: …」 + [주소에 넣기] · 알약 0', t0);
  const t1 = card(A, A.road); ok(/주소에 넣었어요/.test(t1) && /주소에서 빼기/.test(t1), '[도로명으로 바꾸기] 뒤(칸 = 끼운 주소) = 「주소에 넣었어요」 + [주소에서 빼기]', t1); }
console.log('── ② 손님이 건물명을 적음 = 주소 글은 손님 글 그대로(또 안 넣음) · 이름은 보여 줌');
for (const [raw, same, why] of [['화삼로 166, 삼화부영5차 511동 103호', true, '줄임말'], ['화삼로 166 부영5차 511동 103호', true, '쉼표 없음·더 줄임'], ['화삼로 166, 삼화 부영 5차아파트 511동 103호', true, '띄어쓰기·「아파트」'], ['화삼로 166, 삼화부영3차 511동 103호', false, '숫자 다름'], ['화삼로 166, 한라아파트 511동 103호', false, '다른 이름(이름 바뀐 단지)'], ['화삼로 166, 부영 511동 103호', false, '숫자 없음 = 애매 → 일치 아님']]) {
    const A = decide(raw, L_HS), t = card(A, raw);
    ok(A.state === 'one' && !A.auto && keepDetail(A, A.road) && !A.road.includes(BOO), `${why} 「${raw}」 = 끼우지 않음 · 손님 상세 그대로 끝에`, A.road);
    ok(/도로명 건물: 제주삼화사랑으로부영5차/.test(t) && (same ? /· 일치/.test(t) : !/일치/.test(t)) && !/확인 필요|확인해/.test(t) && (same ? !/주소에 넣기/.test(t) : /주소에 넣기/.test(t)), `   표시 = 「🏢 도로명 건물: …」${same ? ' · 일치' : '(일치 표시 없음 · 경고 없음)'}`, t);
}
{ const raw = '화삼로 166, 한라아파트 511동 103호', A = decide(raw, L_HS), d = String(A.detail).trim();
  const ins = HS + ', ' + BOO + ' ' + d; ok(ins.endsWith('한라아파트 511동 103호'), '손님이 적었어도 [주소에 넣기] = 손님 글 앞에 끼움(손님 글 안 지움)', ins); }
console.log('── ③ 공동주택 아님 · 이름 여럿 · 이름 없음');
{ const L = [J('제주특별자치도 제주시 광양9길 10', '제주시청', 0, '제2별관, 본관')]; const A = decide('광양9길 10, 본관 2층', L);
  ok(!A.auto && A.road === '제주특별자치도 제주시 광양9길 10, 본관 2층', '공동주택 아님(bdKdcd 0) = 안 끼움', A.road);
  const t = card(A, A.road); ok(/이 번지 건물 \(확인 필요\): 제주시청/.test(t) && /확인 필요/.test(t) && /주소에 넣기/.test(t), '표시 = 「🏢 이 번지 건물: 제주시청 … (확인 필요)」 + [주소에 넣기]', t); }
{ const P = '제주특별자치도 제주시 연동로 8'; const L = [J(P, '연동상가', 0), J(P, '연동하이츠', 1)]; const A = decide('연동로 8, 201호', L);
  ok(A.state === 'one' && !A.auto && A.road === P + ', 201호', '같은 도로명에 건물 이름 둘 = 안 끼움', A.road);
  const t = card(A, A.road); ok(/이 번지 건물 \(확인 필요\): 연동상가 주소에 넣기\s*연동하이츠 주소에 넣기/.test(t) && /확인 필요/.test(t), '표시 = 이름마다 [주소에 넣기] + (확인 필요)', t); }
{ const L = [J('제주특별자치도 서귀포시 효돈순환로 11', '', 0)]; const A = decide('효돈순환로 11', L);
  ok(A.road === '제주특별자치도 서귀포시 효돈순환로 11' && card(A, A.road) === '', '건물명 없음(단독) = 종전 꼴 · 🏢 줄 없음'); }
console.log('── ④ 빌라 · 부번 · 지번 · 동만 · 없는 동');
{ const P = '제주특별자치도 제주시 연북로 12-3'; const L = [J(P, '그린빌', 1, '')]; const A = decide('연북로 12-3 113호', L);
  ok(A.road === P + ', 그린빌 113호', '빌라 부번 「연북로 12-3 113호」 → 「…12-3, 그린빌 113호」', A.road);
  ok(!/확인해 주세요/.test(card(A, A.road)), '호수 있음 = 알림 0'); }
{ const L = [Object.assign(J(HS, BOO, 1, DET, '63318'), { jibunAddr: '제주특별자치도 제주시 삼양이동 2563' })]; const A = decide('삼양이동 2563, 511동 103호', L);
  ok(A.road === HS + ', ' + BOO + ' 511동 103호', '지번 입력 → 도로명 + 건물명 + 손님 상세', A.road); }
console.log('── ④-2 공동주택 호수 알림(대표 11/22 · 알림만 · 애매하면 안 띄움 · 「없는 동?」 없음)');
{ const A = decide('화삼로 166', L_HS); const t = card(A, A.road);
  ok(A.road === HS + ', ' + BOO && /동·호수를 확인해 주세요/.test(t), '호수 없음(「화삼로 166」) = 「동·호수를 확인해 주세요」', [A.road, t]); }
{ const A = decide('화삼로 166, 511동', L_HS); const t = card(A, A.road);
  ok(A.road === HS + ', ' + BOO + ' 511동' && /호수를 확인해 주세요/.test(t) && !/동·호수를/.test(t), '동만(「511동」) = 「호수를 확인해 주세요」', [A.road, t]); }
{ const A = decide('화삼로 166, 삼화부영5차 511동', L_HS); const t = card(A, A.road);
  ok(/호수를 확인해 주세요/.test(t) && !/동·호수를/.test(t), '손님 건물명 + 동만(「삼화부영5차 511동」 · 이름 속 숫자 5 는 호수로 안 봄) = 「호수를 확인해 주세요」', t); }
for (const d of ['103호', '511동 103호', '511-103', '511동103', '511동 103', '3층 302', 'B01', '지하 1층', '2층', '101호 문 앞에 두세요', '599동 103호']) {
    const A = decide('화삼로 166, ' + d, L_HS); const t = card(A, A.road);
    ok(!/확인해 주세요|없는 동/.test(t), `호수 꼴 「${d}」 = 알림 없음`, t);
}
{ const L = [J('제주특별자치도 제주시 광양9길 10', '제주시청', 0, '')]; const A = decide('광양9길 10', L);
  ok(!/확인해 주세요/.test(card(A, A.road)), '공동주택 아님 + 호수 없음 = 알림 없음'); }
{ const L = [J('제주특별자치도 서귀포시 효돈순환로 11', '', 0)]; const A = decide('효돈순환로 11', L);
  ok(card(A, A.road) === '', '단독(이름 없음) + 호수 없음 = 알림 없음'); }
console.log('── ⑤ 후보 여럿(직원이 고르는 길)');
{ const L = [J('제주특별자치도 제주시 연동로 1', '연동아파트', 1, '', '63001'), J('제주특별자치도 제주시 연동로 10', '', 0, '', '63002')]; const A = decide('제주 연동아파트 101동 202호', L);
  ok(A.state === 'multi' && A.cands[0].road === '제주특별자치도 제주시 연동로 1, 연동아파트 101동 202호' && A.cands[1].road === '제주특별자치도 제주시 연동로 10, 101동 202호', '후보 = 공동주택 이름 하나인 후보만 끼운 글 · 아닌 후보는 종전 글', A.cands.map(x => x.road)); }
console.log('── ⑥-0 읽기 점검 반영(#1248 ①②③)');
{ // ① 저절로 끼운 주소를 저장한 뒤 다시 열기 = 끼운 이름이 손님 건물명으로 읽힘 → 「일치」 · [주소에 넣기] 없음(두 번 안 들어감)
  const saved = HS + ', ' + BOO + ' 511동 103호'; const A = decide(saved, L_HS); const t = card(A, saved);
  ok(A.road === saved && !A.auto, '① 저장 뒤 다시 열기 = 도로명 글 그대로(또 안 끼움)', A.road);
  ok(/도로명 건물: 제주삼화사랑으로부영5차 · 일치/.test(t) && !/주소에 넣기|주소에서 빼기/.test(t), '① 「· 일치」만 · 넣기 단추 없음', t);
  const A2 = decide('화삼로 166, 삼화부영5차 511동 103호', L_HS); const t2 = card(A2, A2.road);
  ok(/· 일치/.test(t2) && !/주소에 넣기/.test(t2), '① 손님이 줄임말로 적고 일치 = 넣기 단추 없음', t2);
  const A3 = decide('화삼로 166, 한라아파트 511동 103호', L_HS); const t3 = card(A3, A3.road);
  ok(!/일치/.test(t3) && /주소에 넣기/.test(t3), '① 다름 = 옅은 [주소에 넣기] 그대로', t3); }
{ // ② 건물명을 상세 뒤에 적음 · 숫자로 시작하는 이름 = 안 끼움 · 「일치」
  const P = '제주특별자치도 제주시 연북로 30'; const L = [J(P, '연북삼성', 1, '')];
  const A = decide('연북로 30, 101동 502호 연북삼성아파트', L); const t = card(A, A.road);
  ok(!A.auto && A.road === P + ', 101동 502호 연북삼성아파트' && /· 일치/.test(t) && !/주소에 넣기/.test(t), '② 뒤에 적은 건물명 「101동 502호 연북삼성아파트」 = 안 끼움 · 일치', [A.road, t]);
  const P2 = '제주특별자치도 제주시 노형로 5'; const L2 = [J(P2, '노형2차아이파크', 1, '')];
  const B = decide('노형로 5, 2차아이파크 101동 1203호', L2); const t2 = card(B, B.road);
  ok(!B.auto && B.road === P2 + ', 2차아이파크 101동 1203호' && /· 일치/.test(t2), '② 숫자로 시작하는 이름 「2차아이파크 101동」 = 안 끼움 · 일치', [B.road, t2]);
  const C = decide('노형로 5, 101동 1203호 노형 2차 아이파크', L2);
  ok(!C.auto && C.road === P2 + ', 101동 1203호 노형 2차 아이파크', '② 띄어 쓴 이름이 뒤에 = 안 끼움', C.road);
  const D = decide('노형로 5, 101동 1203호', L2);
  ok(D.auto === '노형2차아이파크' && D.road === P2 + ', 노형2차아이파크 101동 1203호', '② 이름 없는 상세 = 종전대로 끼움', D.road); }
{ // ③ 이미 「도로명, 101동 502호」로 저장된 줄 = 단추 글 「건물명 넣기」 · 도로명이 다를 때는 「도로명으로 바꾸기」
  const plain = HS + ', 511동 103호'; const A = decide(plain, L_HS);
  ok(F.addrBtnLab(A, plain) === '건물명 넣기' && A.road === HS + ', ' + BOO + ' 511동 103호', '③ 도로명 같고 건물명만 다름 = 「건물명 넣기」(누르면 끼운 글)', F.addrBtnLab(A, plain));
  const A2 = decide('화삼로 166, 511동 103호', L_HS);
  ok(F.addrBtnLab(A2, '화삼로 166, 511동 103호') === '도로명으로 바꾸기', '③ 손님이 짧게 적은 주소 = 「도로명으로 바꾸기」 그대로'); }
console.log('── ⑥ 손님 상세 바이트 보존(모든 경우)');
{ const raws = ['화삼로 166, 511동 103호', '화삼로 166, 삼화부영5차 511동 103호  뒷문', '화삼로 166, 511동 103호 (경비실 맡겨 주세요)', '화삼로 166, 511-103', '화삼로 166, 3층'];
  for (const raw of raws) { const A = decide(raw, L_HS); ok(keepDetail(A, A.road), `「${raw}」 → 주소 끝 = 손님 상세(splitAddr 뒤) 그대로`, [A.detail, A.road]); } }
console.log('── ⑦ 탈출(이름에 꺾쇠·따옴표)');
{ const A = decide('화삼로 166, 511동 103호', [J(HS, '<b>"x"</b>', 1, '')]); const h = F.bdHtml({ _addr: A, cells: Object.assign([], { 8: '' }) }, 0);
  ok(!/<b>"x"/.test(h) && /&lt;b&gt;/.test(h), '건물 이름은 esc 를 거침'); }
console.log(`\n합계 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);

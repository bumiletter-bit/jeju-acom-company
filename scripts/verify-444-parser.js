/* #444 검증 1/3 — 주문정리기 추출기·주소분리 단위+회귀 (Node · 이식본 실코드 실행)
   ① 대표 예시 xlsx 7종(Downloads — PII라 미커밋) : 신코드 결과 기대값 + 🔴 줄 정합(1원칙) 기계 증명 = 출력 행의 이름·전화·주소가 「같은 원본 행」에서 왔는지
   ② 무회귀: 정상이던 3파일(한라봉·추석리스트·배송지)은 구코드(git HEAD 기준선) 출력과 orders 완전 동일
   ③ splitAddr: 예시 250주소 전수 구/신 대조 — 차이는 의도한 유형(물결·괄호콤마·N가길·아파트 동호 오인)뿐
   ④ exactMatches: 실 juso 응답 고정본(scratch juso-fixture.json — 있을 때) + 합성 케이스
   실행: node scripts/verify-444-parser.js [BASE_DIR(구코드 사본 폴더)] */
const path = require('path'), fs = require('fs'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const XLSX = require('xlsx-js-style');
const DL = 'C:/Users/전승범/Downloads';
const SP = process.env.SP || '';
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const digits = s => String(s || '').replace(/\D/g, '');

/* 실코드 로더(구/신 각각 독립 컨텍스트) */
function loadImpl(dir) {
  const ctx = { XLSX, console, TextDecoder, Uint8Array, DataView };
  ctx.window = undefined; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'order-parser.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'order-extract.js'), 'utf8'), ctx);
  const org = fs.readFileSync(path.join(dir, 'order-organizer.js'), 'utf8');
  const grab = (n) => { const i = org.indexOf('function ' + n + '('); if (i < 0) return ''; let d = 0, j = i; for (; j < org.length; j++) { if (org[j] === '{') d++; else if (org[j] === '}') { d--; if (d === 0) break; } } return org.slice(i, j + 1); };
  vm.runInContext(grab('tidyDetail') + '\n' + grab('splitAddr') + '\n' + (grab('searchBody') || 'function searchBody(b){return b;}') + '\n' + (grab('exactMatches') || 'function exactMatches(){return [];}') + '\nthis.__f={splitAddr,tidyDetail,searchBody,exactMatches};', ctx);
  return { parseAoa: ctx.akParseAoa, f: ctx.__f };
}
const NEW = loadImpl(PUB);
const BASE_DIR = process.argv[2] || (SP && path.join(SP, 'base'));
const OLD = BASE_DIR && fs.existsSync(path.join(BASE_DIR, 'order-extract.js')) ? loadImpl(BASE_DIR) : null;
console.log('구코드 기준선:', OLD ? BASE_DIR : '(없음 — 회귀 대조 생략)');

const FILES = {
  hanrabong: '제주한라봉_아꼼이네 답례품 명단(강슬기실장님결혼식답례용) (1).xlsx',
  seol: '2026설선물주소록.xlsx',
  chuseokList: '2026 추석 선물 발송 리스트.xlsx',
  baesong: '배송지.xlsx',
  bulk: '26년 추석 선물 대량주문양식 최종_(0911).xlsx',
  yu: '유찬숙-주소록-추석선물셋트.xlsx',
  chuseok2026: '2026년 추석 선물.xlsx',
};
const sheetsOf = (file, impl) => {
  const wb = XLSX.read(new Uint8Array(fs.readFileSync(path.join(DL, file))), { type: 'array', codepage: 949 });
  return wb.SheetNames.map(sn => { const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' }); return { name: sn, aoa, orders: impl.parseAoa(aoa) }; });
};
/* 🔴 줄 정합 증명: 출력 행의 name·phone·addr(머리 20자)이 같은 원본 행(또는 addr는 바로 다음 이어쓴 행)에 있어야 한다 */
function rowIntegrity(aoa, orders) {
  const rows = aoa.filter(r => r.some(c => String(c).trim() !== '')).map(r => r.map(c => String(c ?? '').trim()));
  let bad = [];
  for (const o of orders) {
    const nm = String(o.name || '').trim(), ph = digits(o.phone), ad = String(o.addr || '').trim();
    let found = false;
    for (let i = 0; i < rows.length && !found; i++) {
      const r = rows[i];
      const hasName = !nm || r.some(c => c === nm || c.replace(/\s+/g, '') === nm.replace(/\s+/g, ''));
      const hasPhone = !ph || r.some(c => digits(c) === ph || digits(c).includes(ph));
      const norm = t => t.replace(/\s+/g, ' ').trim();
      const hasAddr = !ad || r.some(c => c && c.length >= 6 && norm(ad).startsWith(norm(c).slice(0, 20)));
      if (hasName && hasPhone && hasAddr) found = true;
    }
    if (!found) bad.push({ name: nm, phone: o.phone, addr: ad.slice(0, 40) });
  }
  return bad;
}
const all = {};
for (const [k, f] of Object.entries(FILES)) { if (!fs.existsSync(path.join(DL, f))) { console.log('  (파일 없음) ' + f); continue; } all[k] = sheetsOf(f, NEW); }

/* ── ① 파일별 기대값 ── */
if (all.seol) {
  const o = all.seol[0].orders;
  ok(o.length === 34 && o.every(x => x.name && x.phone && x.addr), '설선물주소록: 34행 이름·전화·주소 전부 채움(「받는이」 인식)', o.length + '행 이름 ' + o.filter(x => x.name).length);
  ok(/황정수/.test(o.context.sender), '설선물주소록: 서문 「보내는이 이름 : …」 → 보내는이 자동', o.context.sender);
}
if (all.bulk) {
  const s = all.bulk.find(x => x.name === '★주문서 양식★'); const o = s.orders;
  ok(o.length === 103, '대량주문양식: 데이터 103행(헤더 행은 주문 아님 — 구코드는 헤더를 주문으로 세어 104)', o.length);
  ok(o.every(x => x.name && !/하우스귤|레드향/.test(x.name)), '대량주문양식: 수취인명 = 「받는 사람」 열(상품명 아님)', o.slice(0, 3).map(x => x.name).join(' / '));
  ok(o.every(x => x.addr && x.phone), '대량주문양식: 주소·전화 전부 채움(「받는사람 주소」 매핑)', o.filter(x => !x.addr).length + '건 주소 없음');
  ok(o.filter(x => x.qty).length >= 100 && o.some(x => x.qty === '10'), '대량주문양식: 수량 = 데이터 있는 둘째 「수량」 열', [...new Set(o.map(x => x.qty))].join(','));
  ok(o.every(x => /^0\d{1,2}-\d{3,4}-\d{4}$/.test(x.senderPhone)) && o.every(x => x.sender), '대량주문양식: 보내는 사람·연락처 전 행 채움(둘째 「보내는 사람 연락처」 열)', o[0].sender + ' ' + o[0].senderPhone + ' … 연락처 ' + [...new Set(o.map(x => x.senderPhone))].length + '종');
  ok(o.every(x => /하우스귤|황금향/.test(x.product)) && o.filter(x => /배송전/.test(x.memo)).length >= 100, '대량주문양식: 상품명(하우스귤/황금향)·배송메시지(둘째 메모 열)', [...new Set(o.map(x => x.product))].join('/') + ' / ' + o[0].memo);
  ok(/이준혁/.test(o.context.sender) && o.context.senderPhone === '010-3226-8790', '대량주문양식: 서문 「대량주문자 성함 / 연락처」 → 보내는이', JSON.stringify(o.context));
  const bad = rowIntegrity(s.aoa, o); ok(bad.length === 0, '🔴 대량주문양식 줄 정합(104행 이름·전화·주소 동일 원본 행)', JSON.stringify(bad.slice(0, 3)));
}
if (all.yu) {
  const s = all.yu[0]; const o = s.orders;
  const oy = o.slice(0, 9);   // 명단 = 9명(각 2줄) + 보내는이 한 줄 + 메모 한 줄
  ok(oy.length === 9 && oy.every(x => x.addr && x.name && x.phone), '유찬숙: 명단 9행 이름·전화·주소 채움(「받는분주소」가 이름 규칙에 안 삼켜짐)', oy.filter(x => x.addr).length + '/' + oy.length);
  ok(o.length === 11 && o[9].phone === '010-3877-4400' && /김해시 덕정로 108/.test(o[9].addr) && /유찬숙/.test(o[9].addr + o[9].name), '유찬숙: 한 셀에 통째로 적힌 보내는이 줄 → 같은 셀 안에서 전화·주소 분리(유실 0·행으로 보임)', o.length + '행 ' + JSON.stringify(o[9] && [o[9].name, o[9].phone, String(o[9].addr).slice(0, 30)]));
  ok(/해운대해변로85 경동아파트 106동 405호$/.test(o[0].addr), '유찬숙: 아랫줄 주소 조각 병합', o[0].addr);
  ok(o[0].product === '제주 향금향 5.0kg' && /가족들과 행복하고 건강한 추석 명절 되세요/.test(o[0].memo), '유찬숙: 상품·메시지 아랫줄 병합', o[0].product + ' | ' + o[0].memo);
  ok(oy.every(x => x.qty === '2' || x.qty === '1'), '유찬숙: 수량 「2BOX」→2', [...new Set(oy.map(x => x.qty))].join(','));
  const bad = rowIntegrity(s.aoa, oy); ok(bad.length === 0, '🔴 유찬숙 줄 정합(병합 후에도 이름·전화·주소 머리 = 같은 원본 행)', JSON.stringify(bad.slice(0, 3)));
}
if (all.chuseok2026) {
  const s = all.chuseok2026[0]; const o = s.orders;
  ok(!o.some(x => /^(보내는|받는) 사람$/.test(x.name)), '2026년 추석 선물: 「보내는 사람/받는 사람」 표식 행은 주문 아님', o.length + '행');
  ok(!o.some(x => /전상범/.test(x.name)), '2026년 추석 선물: 보내는 사람 블록은 주문에서 제외', '');
  ok(o.context.sender === '전상범' && o.context.senderPhone === '010-8861-3087', '2026년 추석 선물: 보내는 사람 블록 → 보내는이', JSON.stringify(o.context));
  const withPhone = o.filter(x => /^0\d{1,2}-\d{3,4}-\d{4}$/.test(x.phone)).length;
  ok(withPhone === 24 && o.length === 25, '2026년 추석 선물: 25행 중 원본에 번호가 있는 24행 전부 같은 행에서 회수(열 3가지 흩어짐) · 번호 없는 1행(숫자 메모 1050805650)은 빈칸', withPhone + '/' + o.length);
  ok(o.some(x => /판교로 20/.test(x.addr) && /301동 503호$/.test(x.addr)) && o.some(x => /뚝섬로34길 67/.test(x.addr) && /A동 902호$/.test(x.addr)), '2026년 추석 선물: 전화 열에 적힌 「301동 503호」·「A동 902호」 → 같은 행 주소 뒤에', o.filter(x => /판교로 20|뚝섬로34길/.test(x.addr)).map(x => x.addr).join(' | '));
  ok(!o.some(x => /^0\d{1,2}-\d{3,4}-\d{4}$/.test(x.product)), '2026년 추석 선물: 상품 칸에 전화번호 없음', [...new Set(o.map(x => x.product))].slice(0, 4).join('|'));
  const bad = rowIntegrity(s.aoa, o); ok(bad.length === 0, '🔴 2026년 추석 선물 줄 정합', JSON.stringify(bad.slice(0, 3)));
}
if (all.chuseokList) {
  const s1 = all.chuseokList.find(x => x.name === '1');
  ok(/와이에스글로벌/.test(s1.orders.context.sender), '추석 발송 리스트: 서문 「보내는사람 : …」 → 보내는이', s1.orders.context.sender);
}
if (all.baesong) ok(/대원프리시전/.test(all.baesong[0].orders.context.sender), '배송지.xlsx: 서문 「주문자 : …」 → 보내는이', all.baesong[0].orders.context.sender);

/* ── ② 무회귀: 정상이던 3파일 = 구코드와 orders 동일(문맥 부가 제외) ── */
if (OLD) {
  const strip = o => o.map(x => ({ ...x }));
  for (const k of ['hanrabong', 'chuseokList', 'baesong']) {
    if (!all[k]) continue;
    const oldS = sheetsOf(FILES[k], OLD);
    let same = oldS.length === all[k].length;
    for (let i = 0; same && i < oldS.length; i++) {
      if (k === 'hanrabong' && i === 0) {   // 「보내시는분」 안내문 시트(주문 아님): 구코드는 안내 문장 1줄을 전화 칸에 넣어 행으로 세었음 → 신코드는 번호 아닌 문장을 전화로 안 봄. 명단 시트 2개는 완전 동일이어야 한다
        const oldSet = new Set(strip(oldS[i].orders).map(x => JSON.stringify(x)));
        const dropped = strip(oldS[i].orders).filter(x => !all[k][i].orders.some(y => y.phone === x.phone));
        ok(dropped.length === 1 && !/^0\d/.test(dropped[0].phone), `무회귀(허용 차이): hanrabong 안내문 시트 — 문장이 전화 칸에 들어가던 행 1개만 제외`, JSON.stringify(dropped.map(x => x.phone.slice(0, 30))));
        continue;
      }
      same = JSON.stringify(strip(oldS[i].orders)) === JSON.stringify(strip(all[k][i].orders));
    }
    ok(same, `무회귀: ${k} 구/신 orders 완전 동일(${all[k].map(s => s.orders.length).join('+')}행)`);
  }
  // README 케이스(구코드에서도 통과하던 표 케이스) 동일
  const aoa = [['순번', '보내는사람', '업체명', '개수', '성명', '전화번호', '주소'], ['1', '정만웅', '태신스틸', '2', '김성종', '010-1234-5678', '서울 금천구 벚꽃로 40'], ['2', '정만웅', '진영화학', '1', '정진영', '010-8887-3813', '경기도 화성시 향남읍 발안로 440-19']];
  ok(JSON.stringify([...OLD.parseAoa(aoa)]) === JSON.stringify([...NEW.parseAoa(aoa)]), '무회귀: README 표 케이스 구/신 동일');
}

/* ── ③ splitAddr 전수 대조 ── */
{
  const addrs = []; for (const k of Object.keys(all)) for (const s of all[k]) for (const o of s.orders) if (o.addr) addrs.push(o.addr);
  const diffs = [];
  if (OLD) for (const a of addrs) { const n = NEW.f.splitAddr(a), o = OLD.f.splitAddr(a); if (n[0] !== o[0] || n[1] !== o[1]) diffs.push({ a, o, n }); }
  const intended = d => /~/.test(d.a) || /\([^)]*,/.test(d.a) || /\d+[가-힣]길/.test(d.a) || /\d+\s*동\s*\d+\s*호/.test(d.a) || /[A-Za-z]동/.test(d.a)
    || (/,/.test(d.a) && d.n[1].indexOf(d.o[0].slice(d.n[0].length).trim()) === 0);   // 콤마 앞 건물명이 검색어에서 상세로 이동(글자 보존)
  const unexpected = diffs.filter(d => !intended(d));
  ok(unexpected.length === 0, `splitAddr 전수 대조 ${addrs.length}주소: 차이 ${diffs.length}건 전부 의도한 유형(물결·괄호콤마·N가길·아파트 동호)`, JSON.stringify(unexpected.slice(0, 3)));
  const sp = NEW.f.splitAddr;
  ok(sp('서울 강북구 도봉로 20가길 33')[0] === '서울 강북구 도봉로20가길 33', 'splitAddr: 「20가길」 도로명', sp('서울 강북구 도봉로 20가길 33').join(' | '));
  ok(sp('서울 강북구 한천로 1109~7')[0] === '서울 강북구 한천로 1109-7', 'splitAddr: 물결→하이픈', sp('서울 강북구 한천로 1109~7').join(' | '));
  const g = sp('인천시 서구 가정로 387 (신현동,루원이편한세상하늘채) 129동 1701호');
  ok(g[0] === '인천시 서구 가정로 387' && /129동 1701호/.test(g[1]), 'splitAddr: 괄호 안 콤마 무시', g.join(' | '));
  const h = sp('경기도 부천시 오정동 휴먼시아 3단지 313동 1201호');
  ok(!/313동 1201$/.test(h[0]), 'splitAddr: 「313동 1201호」를 지번으로 오인하지 않음', h.join(' | '));
  ok(sp('선릉로86길31롯데골드로즈2차1108호').join('|') === '선릉로86길 31|롯데골드로즈2차 1108호', 'splitAddr: README 케이스1 유지');
  ok(sp('서울 강남구 청담동 67-1 청담린든그로브 104동 606호').join('|') === '서울 강남구 청담동 67-1|청담린든그로브 104동 606호', 'splitAddr: 지번+상세 유지');
  if (OLD) ok(sp('충무로4가 15 신한빌딩').join('|') === OLD.f.splitAddr('충무로4가 15 신한빌딩').join('|'), 'splitAddr: 「N가」 케이스 구/신 동일', sp('충무로4가 15 신한빌딩').join('|'));
  ok(sp('경기도 성남시 중원구 상대원3동 2968-1번지 화성빌라 302호')[0] === '경기도 성남시 중원구 상대원3동 2968-1', 'splitAddr: 「상대원3동」 숫자 붙은 법정동 유지', sp('경기도 성남시 중원구 상대원3동 2968-1번지 화성빌라 302호').join(' | '));
  ok(sp('괴정동 동주아파트 다동 101호').join('|') === '괴정동 동주아파트|다동 101호', 'splitAddr: 「다동 101호」 숫자 역추적 없음 · 건물명까지 검색/동호 상세', sp('괴정동 동주아파트 다동 101호').join(' | '));
  ok(NEW.f.searchBody('서울특별시 영등포구 국제금융로8길 34(여의도동,오륜빌딩 709호)') === '서울특별시 영등포구 국제금융로8길 34', 'searchBody: 괄호 제거');
  ok(sp('경기도 안산시 단원구 초지동 730 그린빌, 1203동 1201호').join('|') === '경기도 안산시 단원구 초지동 730|그린빌, 1203동 1201호', 'splitAddr: 콤마 앞 건물명 보존(검색어는 지번까지·상세에 그린빌 유지)', sp('경기도 안산시 단원구 초지동 730 그린빌, 1203동 1201호').join(' | '));
  ok(sp('충북 청주시 청원구 율봉로 8, 남광하우스토리 202-1203').join('|') === '충북 청주시 청원구 율봉로 8|남광하우스토리 202-1203', 'splitAddr: 콤마 분리 종전 케이스 유지');
  ok(sp('서울 강북구 오현로 31길 85-7, 102동 1206호 (번동 금호어울림)').join('|') === '서울 강북구 오현로 31길 85-7|102동 1206호 (번동 금호어울림)', 'splitAddr: 콤마 분리 종전 케이스 유지 2');
  ok(sp('경기도 성남시 중원구 중앙동 롯데캐슬 105동 1403호').join('|') === '경기도 성남시 중원구 중앙동 롯데캐슬|105동 1403호' && sp('서울 강서구 한강자이타워 A동 505호').join('|') === '서울 강서구 한강자이타워|A동 505호', 'splitAddr: 도로명·지번 없는 건물명+동호 → 상세 보존(검색은 건물명까지)', sp('서울 강서구 한강자이타워 A동 505호').join(' | '));
  ok(sp('경기도 부천시 오정동 휴먼시아 3단지 313동 1201호').join('|') === '경기도 부천시 오정동 휴먼시아 3단지|313동 1201호', 'splitAddr: 「3단지 313동 1201호」 → 단지까지 검색·동호 상세', sp('경기도 부천시 오정동 휴먼시아 3단지 313동 1201호').join(' | '));
}

/* ── ④ exactMatches ── */
{
  const ex = NEW.f.exactMatches;
  const J = (r, j, z, b, d) => ({ roadAddrPart1: r, jibunAddr: j, zipNo: z, bdNm: b || '', detBdNmList: d || '' });
  const l1 = [J('서울특별시 금천구 벚꽃로 40', '서울특별시 금천구 독산동 1147 금천 롯데캐슬 골드파크 1차', '08608', '금천 롯데캐슬 골드파크 1차', '102동, 107동'), J('서울특별시 금천구 벚꽃로56길 40', '서울특별시 금천구 가산동 32-42', '08508')];
  ok(ex('서울 금천구 벚꽃로 40', l1, '롯데캐슬 골드파크 1차 107동 1404호').length === 1 && ex('서울 금천구 벚꽃로 40', l1, '')[0].zipNo === '08608', 'exactMatches: 「벚꽃로 40」 vs 「벚꽃로56길 40」 → 정확 1건');
  const l2 = [J('인천광역시 남동구 호구포로 294', '…', '21647', '논현주공1단지아파트', '101동,102동'), J('인천광역시 남동구 호구포로 294-1', '…', '21647', '상가', '상가')];
  ok(ex('남동구 호구포로 294', l2, '102동 1501호').length === 1, 'exactMatches: 「294」 vs 「294-1」 → 정확 1건');
  const l3 = [J('서울특별시 강남구 테헤란로 1', '역삼동 1', '06110', 'A빌딩'), J('서울특별시 서초구 테헤란로 1', '서초동 2', '06600', 'B빌딩')];
  ok(ex('서울 강남구 테헤란로 1', l3, '').length === 2, 'exactMatches: 다른 구 같은 「테헤란로 1」 2건 → 자동확정 안 함(규칙 1 유지)');
  const l4 = [J('전남광주통합특별시 북구 대자로 53', '전남광주통합특별시 북구 운암동 69 벽산 블루밍 메가씨티', '61260', '벽산', '상가동 3'), J('전남광주통합특별시 북구 대자로 55', '전남광주통합특별시 북구 운암동 69 벽산 블루밍 메가씨티', '61260', '벽산', '벽산 블루밍 메가씨티 302동,벽산 블루밍 메가씨티 303동'), J('전남광주통합특별시 북구 북문대로 53', '전남광주통합특별시 북구 운암동 69 벽산 블루밍 메가씨티', '61260', '벽산', '상가동')];
  const r4 = ex('광주광역시 북구 운암동 69', l4, '벽산블루밍 메가씨티아파트 303동 1202호');
  ok(r4.length === 1 && r4[0].roadAddrPart1.endsWith('대자로 55'), 'exactMatches: 지번 동일 단지 → 상세 「303동」으로 1건', r4.map(x => x.roadAddrPart1).join('|'));
  ok(ex('광주광역시 북구 운암동 69', l4, '901호').length === 3, 'exactMatches: 동 정보 없으면 좁히지 않음(선택필요 유지)');
  if (SP && fs.existsSync(path.join(SP, 'juso-fixture.json'))) {
    const fx = JSON.parse(fs.readFileSync(path.join(SP, 'juso-fixture.json'), 'utf8'));
    const cases = [['서울 금천구 벚꽃로 40', '롯데캐슬 골드파크 1차 107동 1404호', 1], ['서울시 관악구 난곡로 55', '관악산휴먼시아 203동 303 호', 1], ['충북 청주시 청원구 율봉로 8', '남광하우스토리 202-1203', 1], ['남동구 호구포로 294', '논현주공아파트 102동 1501호', 1], ['용인시 기흥구 마북로 94', '그린워크 D2동 303호', 1], ['경기도 광주시 능평로 21', '102동 1002호(우림필유골드 135)', 1], ['서울특별시 마포구 양화로 78', '서교빌딩 10층 유니트란스', 1], ['경상남도 김해시 진영읍 진산대로 59', '중흥S에코시티 108동 502호', 1], ['광주광역시 북구 운암동 69', '벽산블루밍 메가씨티아파트 303동 1202호', 1], ['경기도 안산시 단원구 초지동 730 그린빌', '1203동 1201호', 1], ['서울 강남구 테헤란로 1', '', null]];
    for (const [kw, det, want] of cases) {
      const d = fx[kw]; const list = d && d.results && d.results.juso || [];
      if (!list.length) { console.log('  (고정본 없음) ' + kw); continue; }
      const r = ex(kw, list, det);
      if (want === null) ok(r.length !== 1 || list.length === 1, `exactMatches 실응답: ${kw} → 자동확정 없음`, r.length + '/' + list.length);
      else ok(r.length === want, `exactMatches 실응답: ${kw} → 정확 ${want}건 (후보 ${list.length})`, r.map(x => x.roadAddrPart1 + '|' + x.zipNo).join(' / '));
    }
  }
}
console.log(`\n═══ #444 단위·회귀: ${pass}/${pass + fail} ${fail ? '❌' : '✅ 전항목 통과'}`);
process.exit(fail ? 1 : 0);

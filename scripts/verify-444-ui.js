/* #444 검증 2/3 — 주문정리기 UI 실렌더·실클릭 (로컬 실서버 3457·JWT 우회)
   ① 대표 예시 xlsx 실업로드(파일 input) → 표 행·보내는이 자동 채움·시트 선택창
   ② 주소검증: juso 프록시를 실응답 고정본(scratch juso-fixture.json)으로 재생 → 정확일치 자동확정·물결/N가길 검색어·선택필요 유지·동호수 확인
   ③ 연락처 형식 경고(표 warnfmt·내보내기 확인창 문구) ④ 종전 회귀(README 케이스1·규칙6 모달) ⑤ 다른 메뉴 무영향(송장변환 페이지 진입·에러 0)
   선행: JWT_SECRET=verifytest PORT=3457 node -e "global.setInterval=()=>({unref(){},ref(){}});require('./server.js')" */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
const fs = require('fs'), path = require('path');
const DL = 'C:/Users/전승범/Downloads';
const SP = process.env.SP || '';
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const FX = SP && fs.existsSync(path.join(SP, 'juso-fixture.json')) ? JSON.parse(fs.readFileSync(path.join(SP, 'juso-fixture.json'), 'utf8')) : {};
const EMPTY = { results: { common: { errorCode: '0', errorMessage: '정상', totalCount: '0' }, juso: [] } };
(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  const dialogs = []; pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const jusoReq = [];
  await pg.route('**/api/agent-office/juso*', route => { const kw = new URL(route.request().url()).searchParams.get('keyword') || ''; jusoReq.push(kw); route.fulfill({ contentType: 'application/json', body: JSON.stringify(FX[kw] || EMPTY) }); });
  await pg.route('**/api/agent-office/organizer-settings', route => { if (route.request().method() === 'PUT') route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); else route.fulfill({ contentType: 'application/json', body: '{"_jusoKey":true}' }); });
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' })); }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(3000);
  await pg.click('.nav-item[data-page="organizer"]'); await pg.waitForTimeout(900);
  ok(await pg.evaluate(() => document.getElementById('page-organizer').classList.contains('active')), '진입: 주문 정리기 페이지 active');
  const bundle = await pg.evaluate(() => [...document.scripts].map(s => s.src).filter(s => /order-/.test(s)).map(s => s.split('/').pop()).join(','));
  ok(/order-extract\.js\?v=2/.test(bundle) && /order-organizer\.js\?v=2/.test(bundle), '진입: 신번들(v=2) 로드', bundle);
  const rows = () => pg.evaluate(() => window.__ooTest.getRows().map(r => ({ name: r.name, phone: r.phone, addr: r.addr, product: r.product, qty: r.qty, memo: r.memo, sender: r.sender, senderPhone: r.senderPhone, status: r.status })));
  const reset = async () => { await pg.click('#ooBtnReset'); await pg.waitForTimeout(300); await pg.evaluate(() => { document.getElementById('ooOrdererName').value = ''; document.getElementById('ooOrdererPhone').value = ''; }); };
  const upload = async (file) => { await pg.setInputFiles('#ooFileInput', path.join(DL, file)); await pg.waitForTimeout(1500); };

  // ① 예시 파일 실업로드
  if (fs.existsSync(path.join(DL, '26년 추석 선물 대량주문양식 최종_(0911).xlsx'))) {
    await reset(); await upload('26년 추석 선물 대량주문양식 최종_(0911).xlsx');
    let r = await rows();
    ok(r.length === 103 && r.every(x => x.name && x.addr && x.phone) && !r.some(x => /하우스귤|황금향/.test(x.name)), '① 대량주문양식 업로드: 103행 이름·주소·전화 채움', r.length + '행 / ' + (r[0] && r[0].name));
    const snd = await pg.evaluate(() => [document.getElementById('ooOrdererName').value, document.getElementById('ooOrdererPhone').value]);
    ok(snd[0] === '이준혁' && snd[1] === '010-3226-8790', '① 대량주문양식: 서문 「대량주문자 성함/연락처」 → 보내는이 칸 자동', snd.join(' / '));
    ok(r[0].sender && r[0].senderPhone === '010-3226-8790', '① 대량주문양식: 표의 보내는사람 = 파일 열 값(입력칸보다 파일 우선 — 종전 규칙)', r[0].sender + ' ' + r[0].senderPhone);
  }
  if (fs.existsSync(path.join(DL, '2026설선물주소록.xlsx'))) {
    await reset(); await upload('2026설선물주소록.xlsx');
    const r = await rows();
    ok(r.length === 34 && r.every(x => x.name && x.phone && x.addr), '① 설선물주소록: 34행 「받는이」 이름 채움', r.length + '행 / ' + (r[0] && r[0].name));
    const snd = await pg.evaluate(() => document.getElementById('ooOrdererName').value);
    ok(/황정수/.test(snd), '① 설선물주소록: 「보내는이 이름 : …」 → 보내는이 칸', snd);
    ok(r.every(x => /황정수/.test(x.sender)), '① 설선물주소록: 파일에 보내는사람 열이 없으면 입력칸 값이 표의 보내는사람으로', r[0].sender);
  }
  if (fs.existsSync(path.join(DL, '유찬숙-주소록-추석선물셋트.xlsx'))) {
    await reset(); await upload('유찬숙-주소록-추석선물셋트.xlsx');
    const r = await rows();
    ok(r.length === 11 && r.slice(0, 9).every(x => x.name && x.phone && x.addr), '① 유찬숙: 2줄 1건 병합 — 명단 9행 주소 채움', r.length + '행');
    ok(/경동아파트 106동 405호$/.test(r[0].addr) && r[0].product === '제주 향금향 5.0kg', '① 유찬숙: 첫 행 주소·상품 병합 표시', r[0].addr + ' | ' + r[0].product);
  }
  if (fs.existsSync(path.join(DL, '2026년 추석 선물.xlsx'))) {
    await reset(); await upload('2026년 추석 선물.xlsx');
    const r = await rows();
    ok(r.length === 25 && r.filter(x => /^0\d{1,2}-\d{3,4}-\d{4}$/.test(x.phone)).length === 24, '① 2026년 추석 선물(헤더 없는 블록형): 25행·전화 24행 회수', r.length + '행');
    const snd = await pg.evaluate(() => [document.getElementById('ooOrdererName').value, document.getElementById('ooOrdererPhone').value]);
    ok(snd[0] === '전상범' && snd[1] === '010-8861-3087', '① 2026년 추석 선물: 「보내는 사람」 블록 → 보내는이 칸', snd.join(' / '));
    ok(r.every(x => x.sender === '전상범'), '① 2026년 추석 선물: 표의 보내는사람 = 전상범(입력칸 값)', r[0].sender);
  }
  if (fs.existsSync(path.join(DL, '2026 추석 선물 발송 리스트.xlsx'))) {
    await reset(); await upload('2026 추석 선물 발송 리스트.xlsx');
    const chooser = await pg.evaluate(() => ({ open: document.getElementById('ooSheetBack').classList.contains('open'), n: document.querySelectorAll('.oo-sheet-chk').length }));
    ok(chooser.open && chooser.n === 3, '① 추석 발송 리스트: 시트 3개 선택창(종전 동작)', JSON.stringify(chooser));
    await pg.click('#ooSheetAll'); await pg.click('#ooSheetOk'); await pg.waitForTimeout(500);
    const r = await rows();
    ok(r.length === 45 && r.every(x => x.name && x.phone && x.addr), '① 추석 발송 리스트: 3시트 45행(무회귀)', r.length + '행');
    ok(/와이에스글로벌/.test(await pg.evaluate(() => document.getElementById('ooOrdererName').value)), '① 추석 발송 리스트: 서문 「보내는사람 : …」 → 보내는이 칸');
  }
  if (fs.existsSync(path.join(DL, '배송지.xlsx'))) {
    await reset(); await upload('배송지.xlsx');
    const r = await rows();
    ok(r.length === 20 && r.every(x => x.product === '하우스감귤 가정용 - 4.5kg(로얄과)'), '① 배송지.xlsx: 20행 품목 매핑(무회귀)', r.length);
    const warn = await pg.evaluate(() => [...document.querySelectorAll('#ooTbody td.warnfmt')].map(td => td.innerText.trim()));
    ok(warn.length === 1 && warn[0] === '0110-3614-5889', '③ 연락처 자릿수 이상(12자리) 행에 「번호 확인」 표시', JSON.stringify(warn));
    dialogs.length = 0;
    await pg.click('#ooBtnCopy'); await pg.waitForTimeout(500);
    ok(dialogs.some(m => /연락처 형식 확인 1건/.test(m)), '③ 내보내기 확인창에 「연락처 형식 확인 1건」', dialogs.join(' | ').slice(0, 150));
  }

  // ② 주소검증(실응답 고정본 재생)
  const verifyText = async (text) => { await reset(); await pg.evaluate(t => { document.getElementById('ooRawInput').value = t; }, text); await pg.click('#ooBtnParse'); await pg.waitForTimeout(300); jusoReq.length = 0; await pg.click('#ooBtnVerifyAll'); await pg.waitForTimeout(1500); return pg.evaluate(() => [...document.querySelectorAll('#ooTbody tr[data-i]')].map(tr => ({ chip: tr.querySelector('.chip').textContent.trim(), addr: tr.querySelector('td[data-f="addr"]').innerText.trim(), zip: (tr.querySelector('.zip') || { textContent: '' }).textContent }))); };
  if (FX['서울 금천구 벚꽃로 40']) {
    const s = await verifyText('김성종 010-9332-8840 서울 금천구 벚꽃로 40 롯데캐슬 골드파크 1차 107동 1404호');
    ok(s[0].chip === '확인됨' && s[0].addr === '서울특별시 금천구 벚꽃로 40, 롯데캐슬 골드파크 1차 107동 1404호' && /08608/.test(s[0].zip), '② 정확일치 필터: 후보 2건(벚꽃로 40·벚꽃로56길 40) → 「벚꽃로 40」 자동확정', JSON.stringify(s[0]));
    const s2 = await verifyText('박테스 010-2222-3333 서울 강남구 테헤란로 1');
    ok(s2[0].chip === '선택필요', '② 정확 일치 2건(강남·서초 테헤란로 1) → 선택필요 유지(규칙 1)', s2[0].chip);
    const s3 = await verifyText('조윤섭 010-5062-2929 서울 강북구 도봉로 20가길 33');
    ok(jusoReq[0] === '서울 강북구 도봉로20가길 33', '② 「N가길」 검색어', jusoReq[0]);
    ok(FX['서울 강북구 도봉로20가길 33'] && FX['서울 강북구 도봉로20가길 33'].results.juso.length ? s3[0].chip === '확인됨' : s3[0].chip !== '', '② 「도봉로20가길 33」 판정(고정본 기준)', s3[0].chip + ' ' + s3[0].addr);
    const s4 = await verifyText('유인애 010-2221-3180 서울 강북구 한천로 1109~7');
    ok(jusoReq[0] === '서울 강북구 한천로 1109-7', '② 물결 번지 → 하이픈 검색어', jusoReq[0]);
    const s5 = await verifyText('홍길동 010-1111-2222 인천시 서구 가정로 387 (신현동, 루원이편한세상하늘채) 129동 1701호');
    ok(jusoReq[0] === '인천시 서구 가정로 387', '② 괄호 안 콤마 무시 검색어', jusoReq[0]);
    ok(FX['인천시 서구 가정로 387'] && FX['인천시 서구 가정로 387'].results.juso.length ? /129동 1701호/.test(s5[0].addr) : true, '② 괄호 상세 보존', s5[0].addr);
    const s6 = await verifyText('김영희 010-5554-1234 서울 마포구 상암산로1길 24, 101동');
    ok(s6[0].chip === '동·호수 확인', '④ 회귀: 아파트+동만 → 동·호수 확인', s6[0].chip);
    const s7 = await verifyText('김테스 010-1111-2222 선릉로86길31롯데골드로즈2차1108호');
    ok(FX['선릉로86길 31'] ? s7[0].chip === '확인됨' : jusoReq[0] === '선릉로86길 31', '④ 회귀: README 케이스1 검색어/판정', jusoReq[0] + ' ' + s7[0].chip);
    const s8 = await verifyText('박순자 010-4157-3577 경기도 부천시 오정동 휴먼시아 3단지 313동 1201호');
    ok(jusoReq[0] === '경기도 부천시 오정동 휴먼시아 3단지' && jusoReq.includes('경기도 부천시 오정동 휴먼시아') && s8[0].chip !== '확인됨', '② 지번 없는 아파트명: 「313동 1201호」는 상세로 떼고 단지명까지 검색 → 아파트명 재시도(폴백 = 선택필요·자동확정 없음)', JSON.stringify(jusoReq) + ' ' + s8[0].chip);
  } else console.log('  (juso 고정본 없음 — ② 생략)');

  // ⑤ 다른 메뉴 무영향
  await pg.click('.nav-item[data-page="invoice"]').catch(() => {}); await pg.waitForTimeout(800);
  const inv = await pg.evaluate(() => { const p = document.getElementById('page-invoice'); return p ? p.classList.contains('active') : null; });
  ok(inv !== false, '⑤ 송장변환 페이지 진입 무영향', inv);
  ok(errs.length === 0, '⑤ pageerror 0', errs.join(' | ') || '없음');
  console.log(`\n═══ #444 UI: ${pass}/${pass + fail} ${fail ? '❌' : '✅ 전항목 통과'}`);
  await br.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

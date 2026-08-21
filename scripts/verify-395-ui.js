/* #395 검증 2/3 — 주문 정리기 UI 회귀 (로컬 실서버·JWT 우회·실클릭)
   juso 응답은 공식 스키마로 route 재생(실API 검증은 배포 후 러너로 별도 실증 — verify-395-juso-live.js)
   organizer-settings PUT은 route로 가로채 실DB 무변경 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
const XLSX = require(PROJ + '\\node_modules\\xlsx-js-style');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 140) : '')); };

/* juso 공식 응답 스키마 재생기 */
const J = (list) => ({ results: { common: { errorCode: '0', errorMessage: '정상', totalCount: String(list.length) }, juso: list } });
const JUSO_DB = {
  '선릉로86길 31': J([{ roadAddrPart1: '서울특별시 강남구 선릉로86길 31', jibunAddr: '서울특별시 강남구 대치동 890-38', zipNo: '06202', bdNm: '' }]),
  '서울 마포구 월드컵북로 400': J([{ roadAddrPart1: '서울특별시 마포구 월드컵북로 400', jibunAddr: '서울특별시 마포구 상암동 1602', zipNo: '03925', bdNm: '월드컵파크아파트' }]),
  '제주특별자치도 제주시 연삼로 1066-31': J([{ roadAddrPart1: '제주특별자치도 제주시 연삼로 1066-31', jibunAddr: '제주특별자치도 제주시 도련일동 2172-10', zipNo: '63328', bdNm: '' }]),
  '서울 강남구 테헤란로 1': J([   // 후보 2건 — 자동확정 금지 케이스
    { roadAddrPart1: '서울특별시 강남구 테헤란로 1', jibunAddr: '서울특별시 강남구 역삼동 1', zipNo: '06110', bdNm: 'A빌딩' },
    { roadAddrPart1: '서울특별시 서초구 테헤란로 1', jibunAddr: '서울특별시 서초구 서초동 2', zipNo: '06600', bdNm: 'B빌딩' },
  ]),
};
const EMPTY = { results: { common: { errorCode: '0', errorMessage: '정상', totalCount: '0' }, juso: [] } };

(async () => {
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  pg.on('dialog', d => d.accept());   // 초기화·내보내기 confirm 전부 수락 (evaluate 내 click은 confirm이 자동 거부돼 초기화가 안 됨 — 1차 검증 거짓 실패 원인)
  const jusoRequests = [];   // 프록시로 나간 keyword 캡처
  await pg.route('**/api/agent-office/juso*', route => {
    const u = new URL(route.request().url());
    const kw = u.searchParams.get('keyword') || '';
    jusoRequests.push(kw);
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(JUSO_DB[kw] || EMPTY) });
  });
  let settingsPut = null;
  await pg.route('**/api/agent-office/organizer-settings', route => {
    if (route.request().method() === 'PUT') { settingsPut = route.request().postDataJSON(); route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }); }
    else route.fulfill({ contentType: 'application/json', body: JSON.stringify({ _jusoKey: true }) });
  });

  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.evaluate(([t]) => {
    localStorage.setItem('jwt_token', t);
    localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }));
  }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(3000);

  // ① 메뉴 존재·진입
  const navText = await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="organizer"]'); return n ? n.textContent.trim() : null; });
  ok(navText === '주문 정리기', '① 사이드바 메뉴 「주문 정리기」', navText);
  await pg.click('.nav-item[data-page="organizer"]');
  await pg.waitForTimeout(900);
  ok(await pg.evaluate(() => document.getElementById('page-organizer').classList.contains('active')), '① 페이지 진입(active)');

  // ② 예시 → 주문 정리하기 → 4건
  await pg.click('#ooBtnSample');
  await pg.click('#ooBtnParse');
  await pg.waitForTimeout(400);
  const rowN = await pg.evaluate(() => document.querySelectorAll('#ooTbody tr[data-i]').length);
  ok(rowN === 4, '② 예시 4건 파싱·표 렌더', rowN);
  const sender0 = await pg.evaluate(() => document.querySelector('#ooTbody tr[data-i="0"] td[data-f="sender"]').innerText.trim());
  ok(sender0 === '정만웅', '② 입금자 컨텍스트 → 보내는사람', sender0);

  // ③ 케이스1: 붙여쓴 주소 분리 (splitAddr 실코드)
  const sp = await pg.evaluate(() => window.__ooTest.splitAddr('선릉로86길31롯데골드로즈2차1108호'));
  ok(sp[0] === '선릉로86길 31' && sp[1] === '롯데골드로즈2차 1108호', '③ 케이스1: 검색어/상세 분리', JSON.stringify(sp));

  // ③-b 검증 흐름: 그 주소 1건 넣고 [전체 주소 검증] → 프록시 keyword + 자동확정(1건) + 상세 결합
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.getElementById('ooRawInput').value = '김테스 010-1111-2222 선릉로86길31롯데골드로즈2차1108호'; });
  await pg.click('#ooBtnParse');
  await pg.waitForTimeout(300);
  await pg.click('#ooBtnVerifyAll');
  await pg.waitForTimeout(1200);
  ok(jusoRequests.includes('선릉로86길 31'), '③ 프록시 검색어 = "선릉로86길 31"', JSON.stringify(jusoRequests));
  const st1 = await pg.evaluate(() => ({ chip: document.querySelector('#ooTbody .chip').textContent, addr: document.querySelector('#ooTbody td[data-f="addr"]').innerText, zip: (document.querySelector('#ooTbody .zip') || {}).textContent }));
  ok(st1.chip === '확인됨' && st1.addr === '서울특별시 강남구 선릉로86길 31, 롯데골드로즈2차 1108호', '③ 원문 1건 = 자동 확정 + 상세 결합', JSON.stringify(st1));

  // ④ 케이스6: 아파트 + 동만 있고 호수 없음 → "동·호수 확인" (자동 확정 금지)
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.getElementById('ooRawInput').value = '김영희 010-5554-1234 서울 마포구 월드컵북로 400, 101동'; });
  await pg.click('#ooBtnParse'); await pg.waitForTimeout(300);
  await pg.click('#ooBtnVerifyAll'); await pg.waitForTimeout(1200);
  const chip6 = await pg.evaluate(() => document.querySelector('#ooTbody .chip').textContent);
  ok(chip6 === '동·호수 확인', '④ 케이스6: 아파트+동만 → 동·호수 확인(자동확정 금지)', chip6);

  // ⑤ 후보 여러 건 → 선택필요 → 모달 후보 2건 → [원본 그대로 두기] = 상태 유지
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.getElementById('ooRawInput').value = '박테스 010-2222-3333 서울 강남구 테헤란로 1'; });
  await pg.click('#ooBtnParse'); await pg.waitForTimeout(300);
  await pg.click('#ooBtnVerifyAll'); await pg.waitForTimeout(1200);
  const chip5 = await pg.evaluate(() => document.querySelector('#ooTbody .chip').textContent);
  ok(chip5 === '선택필요', '⑤ 후보 2건 = 선택필요(자동확정 금지)', chip5);
  await pg.click('#ooTbody .chip.multi');
  await pg.waitForTimeout(300);
  const modal = await pg.evaluate(() => ({ open: document.getElementById('ooModalBack').classList.contains('open'), cands: document.querySelectorAll('#ooModalCands .cand').length }));
  ok(modal.open && modal.cands === 2, '⑤ 모달 열림 + 후보 2건', JSON.stringify(modal));
  // 모달 바깥 클릭 → 닫히지 않아야 (업무 규칙 6)
  await pg.mouse.click(30, 500);
  await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.getElementById('ooModalBack').classList.contains('open')), '⑤ 바깥 클릭으로 안 닫힘(규칙6)');
  await pg.click('#ooModalKeep');
  await pg.waitForTimeout(200);
  const chip5b = await pg.evaluate(() => document.querySelector('#ooTbody .chip').textContent);
  ok(chip5b === '선택필요', '⑤ 원본 그대로 두기 = 상태 유지(규칙2)', chip5b);

  // ⑥ 보내는이 미입력 시 공란(규칙4) + 내보내기 행 검사
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.getElementById('ooRawInput').value = '받는분: 김영희 010-5554-1234\n서울 마포구 월드컵북로 400, 101동 202호'; });
  await pg.click('#ooBtnParse'); await pg.waitForTimeout(300);
  const exp1 = await pg.evaluate(() => window.__ooTest.exportRows()[0]);
  ok(exp1[0] === '' && exp1[1] === '', '⑥ 보내는이 미입력 → 보내는사람/연락처 공란(규칙4)', JSON.stringify([exp1[0], exp1[1]]));
  ok(exp1[2].includes('연삼로 1066-31'), '⑥ 출고지 = 공용 설정값', exp1[2]);

  // ⑦ 엑셀 다운로드 → 재독 (13컬럼·헤더·노랑 표시)
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.click('#ooBtnExcel')]);
  const xpath = path.join(__dirname, 'oo-test-download.xlsx');
  await dl.saveAs(xpath);
  const wb = XLSX.readFile(xpath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
  ok(aoa[0].length === 13 && aoa[0][0] === '보내는사람' && aoa[0][12] === '보내는이 변경주소', '⑦ CJ 13컬럼 헤더', aoa[0].length + '열');
  ok(aoa[1][3] === '김영희' && String(aoa[1][8]).includes('월드컵북로 400'), '⑦ 데이터 행 값', JSON.stringify([aoa[1][3], aoa[1][8]]));
  // 스타일 판정은 exceljs로 (xlsx-js-style는 스타일 쓰기 전용 — 읽기는 미지원, README 3번)
  const ExcelJS = require(PROJ + '\\node_modules\\exceljs');
  const ewb = new ExcelJS.Workbook();
  await ewb.xlsx.readFile(xpath);
  const ews = ewb.worksheets[0];
  const argb = c => String(((ews.getCell(c).fill || {}).fgColor || {}).argb || '');
  ok(/FFFF00$/i.test(argb('I2')), '⑦ 미확정 배송지 셀 노랑 표시', argb('I2'));
  ok(/CCCCFF$/i.test(argb('A1')) && /FFFF00$/i.test(argb('D1')), '⑦ 헤더 색(A=CCCCFF·D=FFFF00)', argb('A1') + '/' + argb('D1'));
  ok(String((ews.getCell('A1').border || {}).top && ews.getCell('A1').border.top.style) === 'thin', '⑦ thin 테두리', JSON.stringify((ews.getCell('A1').border || {}).top));
  ok(ews.getCell('A2').font && ews.getCell('A2').font.name === '맑은 고딕', '⑦ 맑은 고딕 11', JSON.stringify(ews.getCell('A2').font));
  fs.unlinkSync(xpath);

  // ⑧ 시트 2개 xlsx 업로드 → 체크박스 선택 모달(케이스4-b)
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['성명', '전화번호', '주 소'], ['홍길일', '010-1000-2000', '서울 마포구 월드컵북로 400'], ['홍길이', '010-3000-4000', '서울 강북구 수유동 408-28']]), '1월주문');
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['성명', '전화번호', '주 소'], ['홍길삼', '010-5000-6000', '경기도 화성시 향남읍 발안로 440-19']]), '2월주문');
  const x2 = path.join(__dirname, 'oo-test-sheets.xlsx');
  XLSX.writeFile(wb2, x2);
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.setInputFiles('#ooFileInput', x2);
  await pg.waitForTimeout(1500);
  const sheetModal = await pg.evaluate(() => ({ open: document.getElementById('ooSheetBack').classList.contains('open'), n: document.querySelectorAll('.oo-sheet-chk').length }));
  ok(sheetModal.open && sheetModal.n === 2, '⑧ 케이스4: 시트 2개 → 체크박스 선택 모달', JSON.stringify(sheetModal));
  await pg.click('#ooSheetAll');
  await pg.click('#ooSheetOk');
  await pg.waitForTimeout(400);
  const sheetRows = await pg.evaluate(() => [...document.querySelectorAll('#ooTbody tr[data-i] td[data-f="name"]')].map(t => t.innerText.trim()));
  ok(sheetRows.join(',') === '홍길일,홍길이,홍길삼', '⑧ 시트 원본 순서 유지(규칙5)', sheetRows.join(','));
  fs.unlinkSync(x2);

  // ⑨ 초기화 = 보내는이 3칸 전부 비움(대표 조건3)
  await pg.evaluate(() => { document.getElementById('ooOrdererName').value = '전승범'; document.getElementById('ooOrdererPhone').value = '010-6687-4031'; document.getElementById('ooOrdererAddr').value = '제주시 어딘가'; });
  await pg.click('#ooBtnReset');
  await pg.waitForTimeout(300);
  const cleared = await pg.evaluate(() => [document.getElementById('ooOrdererName').value, document.getElementById('ooOrdererPhone').value, document.getElementById('ooOrdererAddr').value, document.querySelectorAll('#ooTbody tr[data-i]').length]);
  ok(cleared[0] === '' && cleared[1] === '' && cleared[2] === '' && cleared[3] === 0, '⑨ 초기화 = 보내는이 3칸+표 비움', JSON.stringify(cleared));

  // ⑩ 설정 저장 = PUT (출고지·메모·경로만)
  await pg.click('#ooBtnSettings');
  await pg.evaluate(() => { document.getElementById('ooSetChannel').value = '검증테스트경로'; });
  await pg.click('#ooBtnSaveSettings');
  await pg.waitForTimeout(400);
  ok(settingsPut && settingsPut.channel === '검증테스트경로' && !('apiKey' in settingsPut) && Object.keys(settingsPut).sort().join(',') === 'channel,memo,origin', '⑩ 설정 PUT = 3필드만(키 없음)', JSON.stringify(settingsPut));

  // ⑪ 보내는이 연락처 실타이핑 하이픈 (케이스5 UI)
  await pg.fill('#ooOrdererPhone', '');
  await pg.type('#ooOrdererPhone', '01066874031');
  const phoneV = await pg.evaluate(() => document.getElementById('ooOrdererPhone').value);
  ok(phoneV === '010-6687-4031', '⑪ 케이스5: 연락처 실타이핑 하이픈', phoneV);

  // ⑫ vendor 서빙 (pako·tesseract·언어 — 자체 서버, 대표 조건1)
  for (const [u, name] of [['/vendor/pako-inflate.min.js', 'pako'], ['/vendor/tess/tesseract.min.js', 'tesseract'], ['/vendor/tess/worker.min.js', 'worker'], ['/vendor/tess-core/tesseract-core-simd-lstm.wasm.js', 'core'], ['/vendor/tess-lang/kor.traineddata.gz', 'kor'], ['/vendor/tess-lang/eng.traineddata.gz', 'eng']]) {
    const st = await pg.evaluate(async (url) => (await fetch(url, { method: 'GET' })).status, u);
    ok(st === 200, '⑫ vendor ' + name + ' 200', st);
  }
  const cfb = await pg.evaluate(() => typeof XLSX !== 'undefined' && !!XLSX.CFB);
  ok(cfb, '⑫ XLSX.CFB 존재(HWP 컨테이너 해석 전제)');

  // ⑬ 무회귀: 다른 페이지에서 paste·드롭 무간섭 + 주요 페이지 전환 + 에러 0
  await pg.click('.nav-item[data-page="invoice"]');
  await pg.waitForTimeout(800);
  const pasteLeak = await pg.evaluate(() => {
    const before = document.getElementById('ooRawInput').value;
    const dt = new DataTransfer(); dt.setData('text/plain', '누수테스트 010-1234-5678 서울 마포구 월드컵북로 400');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { changed: document.getElementById('ooRawInput').value !== before, rows: document.querySelectorAll('#ooTbody tr[data-i]').length };
  });
  ok(!pasteLeak.changed && pasteLeak.rows === 0, '⑬ 송장변환 화면에서 붙여넣기 → 주문정리기 무간섭', JSON.stringify(pasteLeak));
  for (const p of ['expense', 'settlement', 'inquiry', 'invoice', 'schedule', 'organizer']) {
    await pg.click(`.nav-item[data-page="${p}"]`);
    await pg.waitForTimeout(700);
    const act = await pg.evaluate(pp => document.getElementById('page-' + pp).classList.contains('active'), p);
    ok(act, '⑬ 페이지 전환 ' + p, act);
  }
  ok(errs.length === 0, '⑬ pageerror 0', errs.join(' | ') || '없음');

  await br.close();
  console.log('\n═══ UI 회귀: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

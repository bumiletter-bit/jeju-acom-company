/* #395 검증 3/3 — ⓐ레퍼런스(완성본 HTML) vs 이식본: 같은 입력 → 같은 출력 대조
   ⓑOCR 실동작 스모크: 표준 로딩(vendor lazy-load) 전환이 유일한 구조 변경 — 이미지→텍스트→파싱 사슬 실측 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const { chromium } = require(PROJ + '\\node_modules\\playwright');
const jwt = require(PROJ + '\\node_modules\\jsonwebtoken');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 160) : '')); };

const SAMPLE = `한라봉 선물용 5kg씩 보내주세요. 입금자 정만웅 010-9402-0886

1. 정진영 010-8887-3813 경기도 화성시 향남읍 발안로 440-19, 진영화학
2. 오승영 010-5271-3790
경기도 화성시 향남읍 동오1길 19-9 정우테크닉스
3. 김영자 01046127618 전라남도 장성군 북하면 약수리 545-4

받는분 : 박순자
연락처 : 010-4157-3577
서울 강북구 수유동 408-28 3층
문앞에 놓아주세요`;
const TSV = '순번\t보내는사람\t업체명\t개수\t성명\t전화번호\t주소\n1\t정만웅\t태신스틸\t2\t김성종\t010-1234-5678\t서울 금천구 벚꽃로 40\n2\t정만웅\t진영화학\t1\t정진영\t010-8887-3813\t경기도 화성시 향남읍 발안로 440-19';
const FIELDS = ['name','phone','phone2','addr','product','qty','memo','sender','senderPhone'];

(async () => {
  const br = await chromium.launch();

  /* ── ⓐ 레퍼런스 완성본 (file://) — 표 렌더값 추출 ── */
  const ref = await br.newPage({ viewport: { width: 1600, height: 950 } });
  ref.on('dialog', d => d.accept());
  await ref.goto('file:///C:/Users/%EC%A0%84%EC%8A%B9%EB%B2%94/OneDrive/%EB%AC%B8%EC%84%9C/%E2%98%85%EC%A0%9C%EC%A3%BC%EC%95%84%EA%BC%BC%EC%9D%B4%EB%84%A4%20%ED%9A%8C%EC%82%AC%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8/%EC%A3%BC%EB%AC%B8%EC%A0%95%EB%A6%AC%EA%B8%B0/%EC%95%84%EA%BC%BC%EC%9D%B4%EB%84%A4_%EC%A3%BC%EB%AC%B8%EC%A0%95%EB%A6%AC%EA%B8%B0_.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ref.waitForTimeout(2500);
  const grab = (pg, tbodySel, fields) => pg.evaluate(([sel, fs]) =>
    [...document.querySelectorAll(sel + ' tr[data-i]')].map(tr => {
      const o = {};
      fs.forEach(f => { const td = tr.querySelector('td[data-f="' + f + '"]'); o[f] = td ? td.innerText.trim() : null; });
      return o;
    }), [tbodySel, fields]);
  // 자유 텍스트
  await ref.evaluate(s => { document.querySelector('#rawInput').value = s; }, SAMPLE);
  await ref.click('#btnParse'); await ref.waitForTimeout(500);
  const refText = await grab(ref, '#tbody', FIELDS);
  // 초기화 후 TSV
  await ref.click('#btnReset'); await ref.waitForTimeout(300);
  await ref.evaluate(s => { document.querySelector('#rawInput').value = s; }, TSV);
  await ref.click('#btnParse'); await ref.waitForTimeout(500);
  const refTsv = await grab(ref, '#tbody', FIELDS);
  await ref.close();

  /* ── 이식본 (로컬 실서버) — 같은 입력 ── */
  const token = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '전승범', position: '대표' }, 'verifytest', { expiresIn: '1h' });
  const pg = await br.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  pg.on('dialog', d => d.accept());
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.evaluate(([t]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify({ id: 1, username: 'ceo', role: 'admin', name: '전승범' })); }, [token]);
  await pg.goto('http://localhost:3457/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(3000);
  await pg.click('.nav-item[data-page="organizer"]'); await pg.waitForTimeout(800);
  await pg.evaluate(s => { document.querySelector('#ooRawInput').value = s; }, SAMPLE);
  await pg.click('#ooBtnParse'); await pg.waitForTimeout(500);
  const newText = await grab(pg, '#ooTbody', FIELDS);
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  await pg.evaluate(s => { document.querySelector('#ooRawInput').value = s; }, TSV);
  await pg.click('#ooBtnParse'); await pg.waitForTimeout(500);
  const newTsv = await grab(pg, '#ooTbody', FIELDS);

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(refText.length === 4 && same(refText, newText), 'ⓐ 자유 텍스트 4건 — 레퍼런스와 전 필드(9×4) 동일', same(refText, newText) ? '완전 일치' : JSON.stringify({ ref: refText, neo: newText }).slice(0, 400));
  ok(refTsv.length === 2 && same(refTsv, newTsv), 'ⓐ 탭 구분 표 2건 — 레퍼런스와 전 필드 동일', same(refTsv, newTsv) ? '완전 일치' : JSON.stringify({ ref: refTsv, neo: newTsv }).slice(0, 400));

  /* ── ⓑ OCR 스모크: 브라우저에서 주문 텍스트 이미지 생성 → 업로드 → OCR → 파싱 ── */
  console.log('  … OCR 스모크 시작 (엔진 첫 로드 — 수십 초 걸릴 수 있음)');
  await pg.click('#ooBtnReset'); await pg.waitForTimeout(300);
  const imgB64 = await pg.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1100; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1100, 200);
    x.fillStyle = '#000'; x.font = '600 34px "Malgun Gothic", sans-serif';
    x.fillText('김영희 010-5554-1234', 40, 80);
    x.fillText('서울 마포구 월드컵북로 400', 40, 140);
    return c.toDataURL('image/png').split(',')[1];
  });
  await pg.setInputFiles('#ooImgInput', { name: 'order.png', mimeType: 'image/png', buffer: Buffer.from(imgB64, 'base64') });
  await pg.waitForFunction(() => document.querySelector('#ooRawInput').value.length > 5 || document.querySelectorAll('#ooTbody tr[data-i]').length > 0, null, { timeout: 180000 });
  await pg.waitForTimeout(1200);
  const ocr = await pg.evaluate(() => ({ raw: document.querySelector('#ooRawInput').value, rows: [...document.querySelectorAll('#ooTbody tr[data-i]')].map(tr => ({ name: tr.querySelector('td[data-f="name"]').innerText.trim(), phone: tr.querySelector('td[data-f="phone"]').innerText.trim(), addr: tr.querySelector('td[data-f="addr"]').innerText.trim() })) }));
  ok(/010[- ]?5554[- ]?1234/.test(ocr.raw.replace(/\s/g, '')) || (ocr.rows[0] && ocr.rows[0].phone === '010-5554-1234'), 'ⓑ OCR: 전화번호 인식', JSON.stringify(ocr.rows[0] || ocr.raw.slice(0, 80)));
  ok(ocr.rows.length >= 1 && /월드컵북로/.test((ocr.rows[0] || {}).addr || ocr.raw), 'ⓑ OCR: 주소 인식 → 자동 파싱·표 반영', JSON.stringify(ocr.rows[0]));
  ok(errs.length === 0, 'pageerror 0', errs.join(' | ') || '없음');

  await br.close();
  console.log('\n═══ 레퍼런스 대조·OCR: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

/* #401 단위 검증 — 다채널 알림톡 핵심 판정 로직 (실모듈 + 실DB 품목명으로)
   ① matchNotifyProductLoose: 자사몰·쿠팡 옵션 문자열 매칭 + 오매칭 0 ② 050 가드 ③ hold-0809 판정 ④ 문면 조립 */
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
require(PROJ + '\\node_modules\\dotenv').config({ path: PROJ + '\\.env' });
const kakaoNotify = require(PROJ + '\\kakao-notify.js');
const shippingSchedule = require(PROJ + '\\shipping-schedule.js');
const { Pool } = require(PROJ + '\\node_modules\\pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

// server.js에서 그대로 복제한 판정(서버 함수는 pool 의존이라 순수부만 동일 로직 대조 — 실코드 추출 검산은 grep으로)
function holdWindow0809(paidMs, hset) {
    const _kst = new Date(paidMs + 9 * 3600 * 1000);
    if (_kst.getUTCHours() !== 8) return false;
    const payDayKst = new Date(Date.UTC(_kst.getUTCFullYear(), _kst.getUTCMonth(), _kst.getUTCDate()));
    return shippingSchedule.isShipDay(payDayKst, hset);
}
function coupangBadTel(v) { const d = String(v || '').replace(/[^0-9]/g, ''); const isBad = d.length >= 8 && !/^01/.test(d); return isBad && !/^050/.test(d); }

(async () => {
  const bp = (await pool.query(`SELECT id, name, notify_message, shipping_guide, reserve_ship_start FROM bot_products WHERE deleted_at IS NULL`)).rows;
  console.log('실DB 품목', bp.length + '종');

  // ① 자사몰 옵션 문자열 (8/23 실주문에서 본 실형식) → loose 매칭
  const c24Cases = [
    ['제주 감귤 상품 선택=1. (제철)고당도 하우스감귤 · 하우스감귤 선물용 - 3kg(로얄과)', /하우스감귤.*선물용 - 3kg\(로얄과\)/],
    ['제주 청귤 상품 선택=최상품 청귤(풋귤) 10kg', /청귤\(풋귤\) 10kg/],
    ['미니밤호박 상품 선택=2. 미니밤호박 중품못난이 · 못난이 5kg(랜덤과)', /못난이 5kg\(랜덤과\)/],
    ['황금향 상품 선택=1. (제철)과즙팡팡 황금향 · 황금향 가정용 - 3kg(중소과 17과 전후)', /황금향 가정용 - 3kg/],
  ];
  for (const [opt, expect] of c24Cases) {
    const m = kakaoNotify.matchNotifyProductLoose(opt, bp);
    ok(m && expect.test(m.name), `① loose 매칭: "${opt.slice(0, 44)}…"`, m ? m.name.slice(0, 44) : '미매칭');
  }
  // 오매칭 검사: 없는 품목·애매한 문자열은 null이어야
  const none1 = kakaoNotify.matchNotifyProductLoose('감귤 세트', bp);
  ok(!none1, '① 오매칭 방지: "감귤 세트"(모호) → 미매칭', none1 ? '❌ ' + none1.name : 'null');
  const none2 = kakaoNotify.matchNotifyProductLoose('제주 수제 한라봉청 500g', bp);
  ok(!none2 || !/한라봉 노지/.test(none2.name), '① 오매칭 방지: 한라봉청(가공품) → 한라봉 생과에 안 붙음', none2 ? none2.name.slice(0, 40) : 'null');
  // 네이버 형식(종전 exact)도 그대로 매칭 — 무회귀
  const nv = kakaoNotify.matchNotifyProductLoose('고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', bp);
  ok(nv && /가정용 - 2.5kg\(로얄과\)/.test(nv.name), '① 네이버 형식 exact 무회귀', nv && nv.name.slice(0, 44));

  // ② 쿠팡 050 가드
  ok(coupangBadTel('0505-123-4567') === false, '② 안심번호 0505 = 발송 허용(LMS)');
  ok(coupangBadTel('02-123-4567') === true, '② 유선 02 = 차단');
  ok(coupangBadTel('010-1234-5678') === false, '② 휴대폰 010 = 허용');

  // ③ hold-0809 — 실DB 휴무 집합으로 (server의 loadShippingHolidayInfo와 동일 소스)
  const hol = (await pool.query(`SELECT holiday_date::text AS d, no_ship FROM shipping_holidays WHERE deleted_at IS NULL`)).rows;
  const hset = new Set(hol.filter(h => h.no_ship !== false).map(h => h.d));
  const t0830 = Date.parse('2026-08-25T08:30:00+09:00');   // 화요일(출고일) 08:30 → 보류
  const t0930 = Date.parse('2026-08-25T09:30:00+09:00');   // 09:30 → 보류 아님
  const sat0830 = Date.parse('2026-08-29T08:30:00+09:00'); // 토요일(출고 없음) → 보류 아님(#353)
  ok(holdWindow0809(t0830, hset) === true, '③ 출고일 08:30 = 보류');
  ok(holdWindow0809(t0930, hset) === false, '③ 09:30 = 보류 아님');
  ok(holdWindow0809(sat0830, hset) === false, '③ 토요일 08:30 = 보류 아님(#353 동일)');

  // ④ 문면 조립 — A(일반)·welcome2(혜택 문구)
  const tplA = kakaoNotify.orderTemplate(false);
  const msgA = kakaoNotify.buildMessage({ '고객명': '김제주', '상품명': '고당도 하우스감귤 선물용 - 3kg(로얄과)', '발송안내': '내일 화요일 오전 발송, 수~목 도착 예정' }, tplA && tplA.content);
  ok(/김제주님이 주문해주신 \[고당도 하우스감귤/.test(msgA) && /내일 화요일 오전 발송/.test(msgA), '④ A 문면 조립(자사몰·쿠팡 공용)', msgA.length + '자');
  const w2 = require(PROJ + '\\scripts\\alimtalk-templates.json').templates_welcome2[0];
  const msgW = kakaoNotify.buildMessage({ '고객명': '김제주' }, w2.content);
  ok(/회원가입 축하 쿠폰 2,000원/.test(msgW) && /물방울 5개/.test(msgW) && /생일 축하 쿠폰/.test(msgW), '④ 가입환영2 혜택 3종 문면', msgW.length + '자');
  ok((msgW.match(/#\{/g) || []).length === 0, '④ 가입환영2 변수 전부 치환(잔존 0)');

  // ⑤ 서버 실코드에 판정 로직 실삽입 확인 (복제 로직과 원본이 어긋나지 않게 — grep 검산)
  const fs = require('fs');
  const sv = fs.readFileSync(PROJ + '\\server.js', 'utf8');
  ok(sv.includes("function holdWindow0809(paidMs, hset)") && sv.includes("_kst.getUTCHours() !== 8"), '⑤ holdWindow0809 실삽입');
  ok(sv.includes("function coupangBadTel(v)") && sv.includes("!/^050/.test(d)"), '⑤ coupangBadTel 실삽입(050 예외)');
  ok(sv.includes("cafe24_notify: collectCafe24Notify") && sv.includes("welcome_notify: collectWelcomeNotify"), '⑤ 타이머 디스패치 5종 배선');
  ok((sv.match(/notifyChannelLive\(/g) || []).length === 7, '⑤ 채널 dry 게이트 전 경로 배선(수집기 5+수기 1+정의 1)', (sv.match(/notifyChannelLive\(/g) || []).length + '곳');

  await pool.end();
  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + ' ' + (fail ? '❌ 실패 ' + fail : '✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

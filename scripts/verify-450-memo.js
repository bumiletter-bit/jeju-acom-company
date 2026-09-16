// #450 검증(①): 배송메세지 지정일 → 주문완료 알림톡 발송안내 — 실DB 휴무 달력 + 9/10~16 톡톡 실기록에서 뽑은 메모 말뭉치
//   원칙: 날짜 요청 없는 메모 = null(호출부가 종전 computeShipping → 출력 바이트 동일) · 확정 문구는 계산 가능할 때만 · 애매하면 확인형(ack)
require('dotenv').config();
const { Pool } = require('pg');
const ss = require('../shipping-schedule.js');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
(async () => {
    const r = await pool.query(`SELECT to_char(holiday_date,'YYYY-MM-DD') d, reason, COALESCE(no_ship,TRUE) no_ship, COALESCE(no_arrive,FALSE) no_arrive FROM shipping_holidays WHERE deleted_at IS NULL`);
    const set = new Set(), arriveOff = new Set(), reasons = new Map();
    for (const x of r.rows) { if (x.no_ship) set.add(x.d); if (x.no_arrive) arriveOff.add(x.d); if (x.reason) reasons.set(x.d, x.reason); }
    console.log('달력: 발송휴무', [...set].filter(d => d >= '2026-09-10' && d <= '2026-10-10').join(','), '| 도착불가', [...arriveOff].filter(d => d >= '2026-09-10' && d <= '2026-10-10').join(','));
    const AT = Date.parse('2026-09-16T06:00:00Z');   // 9/16(수) 15:00 KST 주문 → 종전 계산 = 내일(9/17 목) 발송
    const run = (memo, at = AT) => ss.memoShipLine(memo, at, set, reasons, { arriveOff });
    const normal = ss.computeShipping(AT, set, reasons, { arriveOff }).text;
    console.log('종전 문구:', normal);
    const cases = [
        // [메모, 기대 kind(null=종전), 기대 문구 포함]
        ['21일 발송 꼭 부탁드릴게요~', 'ship', '9/21'],
        ['9월 21일 발송 부탁드립니다', 'ship', '9/21'],
        ['9월18일 발송(출발) 부탁드립니다.', 'ship', '모레 금요일'],   // 이틀 뒤 = 「모레」 표기(종전 shipPhrase 규칙)
        ['18일로 지정일배송요청합니다', 'ack', '9/18'],
        ['17일배송으로부탁드려요', 'ack', '9/17'],
        ['20일 발송희망', 'ship', '9/20'],
        ['9월21일날 도착희망합니다', 'arrive', '9/21'],
        ['22일까지 꼭 배송부탁드릴게요', 'ack', '9/22'],          // 「배송」 = 출고/수령 애매 → 확인형(직원이 실제로 되물은 사례)
        ['9월 24일 도착 희망', 'ack', '9/24'],          // 연휴(도착불가) → 확인형
        ['9/22 도착 희망', 'arrive', '9/22'],
        ['월요일 발송 부탁드려요', 'ship', '9/21'],
        ['다음주 화요일 도착 희망', 'ack', '9/22'],       // 9/22 도착: 9/21 발송 계산 가능 → arrive 기대? 아래 별도 판정
        ['토요일 도착이 아닌 다음주 월-금 사이 도착으로 발송 부탁드립니다', 'ack', null],
        ['주말 도착 안돼요', 'ack', '주말'],
        ['21일 22일 도착', 'ack', '일정'],
        ['21일 오후 도착으로 부탁', 'arrive', '9/21'],
        ['16일 발송으로 결재했는데', 'ack', '9/16'],        // 오늘(8시 지남) 발송 요청 = 최단 발송일보다 앞 → 확인형
        ['17일 발송 부탁', null, null],                        // 종전 계산과 동일 → 종전 문구
        ['19일 발송 부탁드려요', 'ack', '9/19'],              // 토요일 = 발송 불가 → 확인형
        // 날짜 요청 없음 = null
        ['부재시 문앞에 놓아주세요', null, null],
        ['S사이즈로 주세요', null, null],
        ['301동 1203호 문앞', null, null],
        ['3일 후 도착이면 좋겠어요', null, null],
        ['1~2일 정도 늦어도 괜찮아요', null, null],
        ['홍길동 드림', null, null],
        ['010-1234-5678 로 연락주세요', null, null],
        ['경비실에 맡겨주세요 1층', null, null],
        ['오늘 발송 가능하면 부탁드려요', null, null],
        ['빠른 배송 부탁드립니다', null, null],
        ['추석 전에 도착하게 해주세요', null, null],
        ['', null, null],
    ];
    for (const [memo, kind, inc] of cases) {
        const res = run(memo);
        const got = res ? res.kind : null;
        let good = got === kind;
        if (good && inc && res) good = res.text.includes(inc);
        if (memo === '다음주 화요일 도착 희망') good = res && (res.kind === 'arrive' || res.kind === 'ack') && res.text.includes('9/22');
        ok(good, `「${memo || '(빈 메모)'}」 → ${got}`, res ? res.text : '(종전 문구)');
    }
    // 예약 상품·자사몰 경로는 memo 미전달 → buildShipLineFor(…, undefined) = 종전과 동일해야 함
    ok(run(undefined) === null && run(null) === null, 'memo 미전달(undefined/null) → null(종전 문구)');
    // 08시 이전 주문: 종전 = 오늘 발송. 메모 「오늘 발송」은 날짜 없음 → null. 「17일 발송」 = 내일 → ship
    const early = Date.parse('2026-09-16T22:30:00Z') - 86400000 + 0;   // 9/16 07:30 KST
    const e1 = ss.memoShipLine('17일 발송 부탁드려요', early, set, reasons, { arriveOff });
    ok(e1 && e1.kind === 'ship' && e1.text.includes('내일'), '08시 전 주문 + 「17일 발송」 → 내일 발송 확정 문구', e1 && e1.text);
    // 확정 문구 형태: 발송일 + 도착일이 모두 들어가는가
    const s21 = run('21일 발송');
    ok(s21 && /월요일\(9\/21\)/.test(s21.text) && /도착 예정/.test(s21.text), '확정 문구 = 요일(날짜) 오전 발송 + 도착 예정', s21 && s21.text);
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

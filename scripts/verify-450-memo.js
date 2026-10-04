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
        ['22일까지 꼭 배송부탁드릴게요', 'arrive', '9/22'],       // #452-b: 「까지」 = 도착 기한 → 도착 요청(「배송」은 일반어) → #515부터 이틀 전 9/20(일) 발송(종전 9/21)
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
        // #452-b(3일치 실메모 662·718·549건에서 나온 유형)
        ['21일 월요일 발송 부탁드립니다.', 'ship', '9/21'],          // 숫자 날짜+요일 = 같은 날 → 하나로
        ['9월 21일 월요일에 배송 출발해주세요', 'ship', '9/21'],     // 요일 뒤에 키워드
        ['마지막 출고일에 출고해주세요 9월21일', 'ship', '9/21'],    // 키워드가 앞에 멀리
        ['배송일지정 : 9/21일 도착으로 배송해주세요.', 'arrive', '9/21'],   // 도착 우선·「배송」은 일반어
        ['9월21~22일 도착희망합니다!', 'arrive', '9/21'],            // #519(대표 10/4): 범위 도착 = 첫 날짜 하루 전(9/20 일) 발송 — 종전 확인형
        ['21일 화요일 발송', 'ack', '일정'],                          // 숫자 날짜≠요일 → 확인형
        ['1~2일 정도 늦어도 괜찮아요', null, null],                   // 기간 표현은 범위로 안 봄
        ['15일 발송 부탁드려요', 'ack', '지난 날짜'],                 // #452-d: 지난 날짜 = 확인형(조용히 통과 금지)
        ['14일 발송으로 결제했어요', 'ack', '지난 날짜'],             // #452-d: 종전엔 다음 달 14일로 굴려 확정 문구 — 이제 확인형
        ['9월 10일 도착', 'ack', '지난 날짜'],                        // 월 명시 과거도 지난 날짜
        ['12월 1일 발송 부탁드려요', 'ack', '먼 날짜'],               // #452-d: 45일 초과 = 확인형
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
    // #514(대표 GO 10/4): 「보내는분·보내는 사람·보내는이·보낸이·발신자」의 「보내」는 발송 낱말이 아니다 — 그 낱말이 붙어도 붙지 않았을 때와 같은 결과
    const same = (a, b) => JSON.stringify(run(a)) === JSON.stringify(run(b));
    const base18 = run('9월18일 배송희망');
    ok(base18 && base18.kind === 'ack' && same('9월18일 배송희망 보내는분 가짜상회 서울 가짜구 가짜로 12 010 1111 2222', '9월18일 배송희망'), '#514 「9월18일 배송희망 보내는분 …」 = 「9월18일 배송희망」과 같은 확인형(종전엔 발송 요청으로 읽힘)', JSON.stringify(run('9월18일 배송희망 보내는분 가짜상회 서울 가짜구 가짜로 12 010 1111 2222')).slice(0, 90));
    const senderOnly = ['18일 보내는이 홍길동', '보내시는분 홍길동 9/18', '보내는 사람: 홍길동 18일', '보낸이 홍길동 18일', '18일 보내는 분 홍길동', '18일 보내는이는 홍길동', '9월18일 배송희망 보내는 이 "홍길동 드림"'];
    const stillShip = senderOnly.filter(m => { const r = run(m); return !r || r.kind !== 'ack'; });
    ok(stillShip.length === 0, `#514 보내는이 낱말만 있고 발송 낱말이 없는 ${senderOnly.length}꼴 → 확인형(ack)`, stillShip.join(' | '));
    const realShip = [['21일 발송 부탁드립니다 보내는분 홍길동', '9/21'], ['보내는 이 "홍길동 드림"으로 부탁드리고 출고날짜 9/21', '9/21'], ['21일에 보내주세요', '9/21'], ['21일 보내 주세요', '9/21'], ['9/21 보내줘요', '9/21'], ['21일에 보내 달라고 했어요', '9/21'], ['21일 보내는 이번 주문 꼭 부탁해요', '9/21'], ['보내는분 홍길동 21일 출발', '9/21']];
    const lostShip = realShip.filter(([m, inc]) => { const r = run(m); return !(r && r.kind === 'ship' && r.text.includes(inc)); });
    ok(lostShip.length === 0, `#514 진짜 발송 요청 ${realShip.length}꼴(발송·출고·출발·보내주세요·보내 달라 …)은 그대로 발송 요청`, lostShip.map(x => x[0]).join(' | '));
    ok(same('9월21일 도착희망 보내는분 홍길동', '9월21일 도착희망') && run('9월21일 도착희망 보내는분 홍길동').kind === 'arrive', '#514 「도착희망 + 보내는분」 = 「도착희망」과 같은 도착 요청(종전엔 발송·도착 낱말이 겹쳐 확인형)', JSON.stringify(run('9월21일 도착희망 보내는분 홍길동')).slice(0, 80));
    ok(same('보내는분 홍길동', '홍길동') && run('보내는분 홍길동 드림') === null && run('보내는 사람 홍길동 010-1111-2222') === null, '#514 날짜가 없는 보내는이 메모 = null(종전 문구 그대로)');
    // #515(대표 정답 10/4): 도착 희망일 → 발송일 = 이틀 전, 그날이 발송 없는 날(토요일·발송휴무일)이거나 이미 지났으면 하루 전. 둘 다 안 되면 확인형.
    //   휴무 없는 주로 확인: 10/12(월) 15시 주문 → 가장 빠른 발송일 10/13(화)
    const AT2 = Date.parse('2026-10-12T15:00:00+09:00');
    ok(ss.computeShipping(AT2, set, reasons, { arriveOff }).shipDate === '2026-10-13', '#515 기준: 10/12(월) 15시 주문의 평소 발송일 = 10/13(화)');
    const arr = (memo, at = AT2, opt) => ss.memoShipLine(memo, at, set, reasons, Object.assign({ arriveOff }, opt || {}));
    const WEEK = [['10월 19일 도착 희망', '2026-10-18', '월 → 일'], ['10월 20일 도착 희망', '2026-10-18', '화 → 일'], ['10월 21일 도착 희망', '2026-10-19', '수 → 월'], ['10월 22일 도착 희망', '2026-10-20', '목 → 화'], ['10월 23일 도착 희망', '2026-10-21', '금 → 수'], ['10월 24일 도착 희망', '2026-10-22', '토 → 목'],
        ['월요일에 받고 싶어요', '2026-10-18', '「월요일 받고 싶어요」 → 일'], ['다음주 화요일 도착희망', '2026-10-18', '「화요일 도착희망」 → 일'], ['10/23 까지 받게 해주세요', '2026-10-21', '「까지」 = 도착 기한']];
    const badW = WEEK.filter(([m, ship]) => { const x = arr(m); return !(x && x.kind === 'arrive' && x.latestShip === ship && x.ambiguous === false); });
    ok(badW.length === 0, `#515 도착 요일별 발송일 ${WEEK.length}꼴(월→일 · 화→일 · 수→월 · 목→화 · 금→수 · 토→목 · 애매 표시 없음)`, badW.map(([m, ship, t]) => t + ': ' + JSON.stringify(arr(m) && { k: arr(m).kind, s: arr(m).latestShip })).join(' | '));
    const w1 = arr('10월 21일 도착 희망');
    ok(w1 && w1.text === '월요일(10/19) 오전 발송 예정이에요 (배송메세지에 남겨주신 10/21(수) 도착 요청 기준 — 택배 사정으로 하루 정도 차이가 날 수 있어요)', '#515 알림톡 문구 꼴은 종전 그대로(발송일만 이틀 전으로)', w1 && w1.text);
    ok(arr('10월 25일 도착 희망').kind === 'ack' && /10\/25\(일\) 도착/.test(arr('10월 25일 도착 희망').text), '#515 일요일 도착 = 확인형(일요일은 배달 없음 — 손님이 날을 잘못 봄)', arr('10월 25일 도착 희망').text.slice(0, 40));
    ok(arr('10월 21일 화요일 도착').kind === 'ack' && arr('10월 5일 도착 희망').kind === 'ack' && /지난 날짜/.test(arr('10월 5일 도착 희망').text), '#515 날짜와 요일이 안 맞음 · 지난 날짜 = 확인형');
    ok(arr('10월 15일 도착 희망') === null && arr('10월 14일 도착 희망') === null, '#515 이틀 전(또는 늦은 주문의 하루 전)이 평소 발송일과 같으면 null(평소 문구 그대로)');
    const d15 = arr('10월 15일 도착 희망', AT2, { detail: true }), d14 = arr('10월 14일 도착 희망', AT2, { detail: true });
    ok(d15 && d15.kind === 'arrive' && d15.onTime === true && d15.latestShip === '2026-10-13' && d15.text === '' && d14 && d14.latestShip === '2026-10-13' && d14.onTime === true, '#515 opts.detail(메모 판정용)일 때만 「그날 발송이 요청대로」를 알려 줌 · 알림톡 문구는 없음(text 빈칸)', JSON.stringify(d15));
    ok(JSON.stringify(arr('10월 21일 도착 희망', AT2, { detail: true })) === JSON.stringify(w1) && arr('10월 25일 도착 희망', AT2, { detail: true }).kind === 'ack' && arr('문 앞에 놔주세요', AT2, { detail: true }) === null && arr('10월 19일 발송', AT2, { detail: true }).kind === 'ship', '#515 detail 은 그 한 경우 말고는 결과를 바꾸지 않음');
    ok(arr('10월 13일 도착 희망').kind === 'ack', '#515 이틀 전·하루 전이 둘 다 가장 빠른 발송일보다 앞(내일 도착) = 확인형', arr('10월 13일 도착 희망').text.slice(0, 40));
    // 대표 예시: 「21일(월) 도착인데 19일에 들어온 주문 = 20일(일) 발송」
    const late = Date.parse('2026-09-19T10:00:00+09:00');
    ok(ss.computeShipping(late, set, reasons, { arriveOff }).shipDate === '2026-09-20' && arr('21일 도착 부탁드립니다', late) === null && arr('21일 도착 부탁드립니다', late, { detail: true }).latestShip === '2026-09-20', '#515 늦은 주문: 9/19(토) 주문 + 21일(월) 도착 = 하루 전 9/20(일) 발송(= 평소 발송일 → 평소 문구)');
    // 발송휴무일(실제 달력: 10/8 목 발송휴무 · 10/9 금 한글날 발송휴무·도착불가)
    const hol = Date.parse('2026-10-05T15:00:00+09:00');   // 평소 발송일 10/6(화)
    ok(set.has('2026-10-08') && set.has('2026-10-09') && arr('10월 10일 도착 희망', hol).kind === 'ack', '#515 이틀 전(10/8)·하루 전(10/9)이 둘 다 발송휴무 = 확인형(실제 달력 한글날)', arr('10월 10일 도착 희망', hol).text.slice(0, 50));
    ok(arr('10월 9일 도착 희망', hol).kind === 'ack', '#515 도착불가일(10/9 한글날) 도착 요청 = 확인형');
    { const s2 = new Set([...set, '2026-10-14']); const x = ss.memoShipLine('10월 16일 도착 희망', AT2, s2, reasons, { arriveOff }); ok(x && x.kind === 'arrive' && x.latestShip === '2026-10-15', '#515 이틀 전(10/14)이 발송휴무일이면 하루 전(10/15) 발송', x && x.latestShip); }
    { const s2 = new Set([...set, '2026-10-14', '2026-10-15']); ok(ss.memoShipLine('10월 16일 도착 희망', AT2, s2, reasons, { arriveOff }).kind === 'ack', '#515 이틀 전·하루 전이 둘 다 발송휴무 = 확인형'); }
    ok(run('22일까지 꼭 배송부탁드릴게요').latestShip === '2026-09-20' && run('9월21일날 도착희망합니다').latestShip === '2026-09-20', '#515 9/16 주문: 22일(화) 도착 = 9/20(일) 발송(종전 9/21) · 21일(월) 도착 = 9/20(일)');
    const others = ['21일 발송 꼭 부탁드릴게요~', '18일로 지정일배송요청합니다', '9월21~22일 도착희망합니다!', '21일 22일 도착', '주말 도착 안돼요', '부재시 문앞에 놓아주세요', '15일 발송 부탁드려요'];
    ok(others.every(m => { const a = run(m), b = ss.memoShipLine(m, AT, set, reasons, { arriveOff, detail: true }); return JSON.stringify(a) === JSON.stringify(b); }), '#515 발송 요청·범위·확인형·날짜 없는 메모는 detail 을 줘도 같은 결과');
    // #519(대표 10/4 「12~13일 도착은 하루 전인 11일 발송 — 12일에서 13일 도착」): 범위·둘 중 하나로 적은 **도착 요청** = 첫 날짜 하루 전 발송(그날 보내 닿는 이틀이 적은 날짜 안일 때). 종전(#515-A)은 전부 확인형.
    const RANGES = ['9월 21일~22일 도착 희망합니다', '21일-22일 도착 부탁드려요', '21일–22일 사이 도착', '9월 21일~9월 22일 도착', '21일 ~ 22일 도착', '21일에서 22일 사이 도착', '21일에서22일 도착', '21일부터22일 사이에 받고 싶어요', '21~22일 도착하게 발송 부탁드려요', '21일(월)~22일(화) 도착'];
    const badR = RANGES.filter(m => { const a = run(m); return !(a && a.kind === 'arrive' && a.reqDate === '2026-09-21' && a.reqDateTo === '2026-09-22' && a.latestShip === '2026-09-20' && a.ambiguous === false); });
    ok(badR.length === 0, `#519 범위 도착 요청 ${RANGES.length}꼴(물결·대시·에서·부터 · 띄어쓰기 유무) = 21~22일 도착 → 하루 전 9/20(일) 발송`, badR.join(' / '));
    const ORS = ['21일 또는 22일 도착', '21일이나 22일 도착 부탁드립니다', '21일이나22일 도착', '21일 혹은 22일에 받고 싶어요', '21일, 22일 중 도착'];
    const badO = ORS.filter(m => { const a = run(m); return !(a && a.kind === 'arrive' && a.latestShip === '2026-09-20'); });
    ok(badO.length === 0, `#519 「D일 또는 D일」「D일이나 D일」 ${ORS.length}꼴(이어진 이틀) = 첫 날짜 하루 전 발송`, badO.join(' / '));
    const r519 = run('9월 21일~22일 도착 희망합니다');
    ok(r519 && r519.text === '일요일(9/20) 오전 발송 예정이에요 (배송메세지에 남겨주신 9/21(월)~9/22(화) 도착 요청 기준 — 택배 사정으로 하루 정도 차이가 날 수 있어요)', '#519 알림톡 문구 = 도착 요청 문구 꼴 그대로(날짜만 범위로)', r519 && r519.text);
    const ackOnly = ['21일~22일 발송', '21~22일 발송 부탁드려요', '21일 22일 도착', '21일이나 23일 도착', '21~22일 이후 도착', '21~22일 말고 다른 날 도착', '22일 발송해서 24일 도착하게 해주세요', '14~15일 도착', '9월 23일~24일 도착', '9월 22일~23일 도착'];
    const badA = ackOnly.filter(m => { const a = run(m); return !(a && a.kind === 'ack' && /(일정 지정)/.test(a.text)); });
    ok(badA.length === 0, `#519 확인형 그대로(문구도 종전 「일정 지정」): 범위에 발송 낱말만 · 이어 주는 말 없는 두 날짜 · 떨어진 두 날 중 하나 · 부정 표현 · 발송일+도착일 · 지난 범위 · 도착불가일이 낀 범위 — ${ackOnly.length}꼴`, badA.join(' / '));
    ok(run('9월18일~21일 도착') === null && (() => { const d = ss.memoShipLine('9월18일~21일 도착', AT, set, reasons, { arriveOff, detail: true }); return d && d.kind === 'arrive' && d.onTime === true && d.latestShip === '2026-09-17' && d.text === ''; })(), '#519 범위의 하루 전(9/17)이 평소 발송일과 같으면 알림톡은 평소 문구(null) · 메모 판정용(detail)에는 「그날 발송이 요청대로」');
    ok(arr('13~14일 도착').kind === 'ack' && arr('14~15일 도착', AT2, { detail: true }).latestShip === '2026-10-13' && arr('19~20일 도착').latestShip === '2026-10-18' && arr('24~26일 도착').latestShip === '2026-10-23' && arr('25~26일 도착').kind === 'ack', '#519 10/12(월) 15시 주문: 13~14일 = 이미 늦음(확인형) · 14~15일 = 13일(평소 발송일) · 19~20일(월~화) = 18일(일) · 24~26일 = 23일 · 25(일)~26일 = 닿는 이틀이 범위를 넘어 확인형');
    { const s2 = new Set([...set, '2026-10-20']); const x = ss.memoShipLine('10월 21일~22일 도착', AT2, s2, reasons, { arriveOff }); ok(x && x.kind === 'ack', '#519 첫 날짜 하루 전이 발송휴무일이고 다음 발송일로는 범위를 넘으면 확인형', x && x.kind); }
    ok(run('9월 21일 도착 희망합니다').kind === 'arrive' && run('21일~ 도착 부탁').kind === 'arrive' && run('1~2일 정도 걸려도 괜찮아요') === null && run('010-1234-5678 21일 도착').kind === 'arrive', '#515-A 무회귀: 날짜 하나·「21일~」(뒤 날짜 없음)·기간 표현(「1~2일 정도」)·전화번호 대시는 범위로 보지 않음');
    // #517(설날 실자료 · 대표 GO 10/4): ⓐ「D일 도착하게(끔)/받을 수 있게 … 발송·출고 부탁」 = 도착 요청(종전 확인형) ⓑ「D,D일」 쉼표로 이은 날짜 = 날짜 2개(확인형 — 종전엔 뒤 날짜 하나로 확정)
    const CLAUSE = ['22일에 도착하게끔 출고 부탁드립니다^^', '22일도착할수있게 발송부탁드립니다', '9월 22일 받을 수 있게 보내주세요', '22일(화)에 받아볼 수 있도록 발송 부탁드려요', '9/22 화요일 도착하도록 출고해주세요'];
    const badC = CLAUSE.filter(m => { const a = run(m); return !(a && a.kind === 'arrive' && a.reqDate === '2026-09-22' && a.latestShip === '2026-09-20'); });
    ok(badC.length === 0, `#517 「D일 도착하게/받을 수 있게 … 발송·출고 부탁」 ${CLAUSE.length}꼴 = 도착 요청(22일 화요일 도착 → 이틀 전 9/20 발송)`, badC.join(' / '));
    ok(run('22일 발송해서 24일 도착하게 해주세요').kind === 'ack' && run('출고는 22일에 도착하게끔 부탁드립니다').kind === 'ack' && run('21일 발송 부탁드립니다').kind === 'ship' && run('21일 발송 부탁드려요 받는 분 부재 시 문 앞').kind === 'ship', '#517 무회귀: 날짜 둘 = 확인형 · 날짜 앞에 발송 낱말 = 확인형 · 발송 요청(뒤에 다른 글이 이어져도) = 발송 요청 그대로');
    const LISTS = ['21,22일 중에 도착 가능한 날로 해주세요', '9월 21, 22일 도착 부탁드립니다', '다음주 월, 화( 21,22일)중에 도착가능한 날로'];
    const badL = LISTS.filter(m => { const a = run(m); return !(a && a.kind === 'arrive' && a.latestShip === '2026-09-20'); });
    ok(badL.length === 0, `#519 쉼표로 이은 이틀(「21,22일 도착」) ${LISTS.length}꼴 = 첫 날짜 하루 전 9/20 발송(#517 때는 확인형)`, badL.join(' / '));
    ok(run('3,4일 정도 걸려도 괜찮아요') === null && run('010-1234-5678, 21일 도착').kind === 'arrive' && run('2박스, 21일 도착 부탁').kind === 'arrive' && run('101동 1203호, 21일 도착').kind === 'arrive', '#517 무회귀: 기간(「3,4일 정도」) · 전화번호·박스·동호수 뒤 쉼표는 날짜 목록이 아님');
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

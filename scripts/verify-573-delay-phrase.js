// #573 발송이 밀린 이유 문장 — 「(공휴일(한글날))」 → 「(한글날 연휴 휴무로 일요일 발송이에요)」. node 단독(달력은 10월 실등록 꼴을 그대로 적음)
const ss = require('../shipping-schedule.js');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };
const set = new Set(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-08', '2026-10-09']), arriveOff = new Set(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-09']);
const reasons = new Map([['2026-10-02', '공휴일(개천절)'], ['2026-10-03', '개천절'], ['2026-10-04', '개천절'], ['2026-10-05', '개천절 대체공휴일'], ['2026-10-08', '공휴일(한글날)'], ['2026-10-09', '한글날']]);
const at = s => new Date(s + '+09:00');
let r = ss.computeShipping(at('2026-10-07T14:00:00'), set, reasons, { arriveOff });
ok(r.shipDate === '2026-10-11' && r.text.startsWith('일요일(10/11) 오전 발송, ') && r.text.endsWith('(한글날 연휴 휴무로 일요일 발송이에요)'), '수요일 오후 주문 → 목·금·토 쉼 → 「한글날 연휴 휴무로 일요일 발송이에요」', r.text);
r = ss.computeShipping(at('2026-10-08T07:00:00'), set, reasons, { arriveOff });
ok(r.shipDate === '2026-10-11' && /\(한글날 연휴 휴무로 일요일 발송이에요\)$/.test(r.text), '목요일 아침 주문(당일 후보가 휴무) → 같은 문장', r.text);
const one = new Set(['2026-10-15']), oneR = new Map([['2026-10-15', '공휴일(시험)']]);
r = ss.computeShipping(at('2026-10-14T14:00:00'), one, oneR, { arriveOff: new Set() });
ok(r.shipDate === '2026-10-16' && /\(시험 휴무로 금요일 발송이에요\)$/.test(r.text), '하루만 밀림 → 「연휴」 없이 「시험 휴무로 금요일 발송이에요」', r.text);
const sent = new Map([['2026-10-15', '택배사 택배 없는날 및 공휴일(광복절) 휴무']]);
r = ss.computeShipping(at('2026-10-14T14:00:00'), one, sent, { arriveOff: new Set() });
ok(/\(택배사 택배 없는날 및 공휴일\(광복절\) 휴무\)$/.test(r.text), '이미 문장으로 등록한 사유는 그대로', r.text);
r = ss.computeShipping(at('2026-10-16T14:00:00'), new Set(), new Map(), { arriveOff: new Set() });
ok(r.shipDate === '2026-10-18' && !/\(/.test(r.text), '토요일만으로 밀린 것(일요일 발송)은 종전대로 괄호 없음', r.text);
r = ss.computeShipping(at('2026-10-13T14:00:00'), new Set(), new Map(), { arriveOff: new Set() });
ok(r.text === '내일 수요일 오전 발송, 내일 목요일 도착 예정' || /^내일 수요일 오전 발송/.test(r.text), '평일 보통 주문은 종전 문장 그대로', r.text);
// #574 창구가 등록한 사유 꼴(「시험 휴무」「추석 연휴」) — 뒤의 휴무·연휴 낱말을 떼고 붙인다
const two = new Set(['2026-10-15', '2026-10-16']);
r = ss.computeShipping(at('2026-10-14T14:00:00'), two, new Map([['2026-10-15', '시험 휴무'], ['2026-10-16', '시험 휴무']]), { arriveOff: new Set() });
ok(/\(시험 연휴 휴무로 일요일 발송이에요\)$/.test(r.text), '「시험 휴무」 두 날 → 「시험 연휴 휴무로 일요일 발송이에요」(휴무 휴무 중복 없음)', r.text);
r = ss.computeShipping(at('2026-10-14T14:00:00'), one, new Map([['2026-10-15', '추석 연휴']]), { arriveOff: new Set() });
ok(/\(추석 휴무로 금요일 발송이에요\)$/.test(r.text), '「추석 연휴」 하루 → 「추석 휴무로 금요일 발송이에요」', r.text);
console.log(`\n#573: ${pass} 통과 / ${fail} 실패`); process.exit(fail ? 1 : 0);

// #529 검증 — 8~9시 주문 보류(hold-0809)보다 선물하기(번호 비공개) 판정이 먼저다
//   server.js 실코드를 떼어 실행한다(복사 0): isUsableTel · refetchReceiverTel · resolveReceiver · isMaskedTel + collectKakaoNotify 의 8시대 보류 분기.
//   네이버 재조회(naverCallWithRetry)와 DB(pool)는 가짜 — 실서버·실DB·외부 호출 0.
//   실행: node scripts/verify-529-gift-hold.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const shippingSchedule = require(path.join(ROOT, 'shipping-schedule.js'));
const kakaoNotify = require(path.join(ROOT, 'kakao-notify.js'));

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${name}${extra !== undefined ? ' — ' + extra : ''}`); };
const cut = (a, b, from) => { const i = src.indexOf(a, from || 0); if (i < 0) throw new Error('표식 없음: ' + a.slice(0, 40)); const j = src.indexOf(b, i); if (j < 0) throw new Error('표식 없음: ' + b.slice(0, 40)); return src.slice(i, j); };

// ── 실코드 떼기 ─────────────────────────────────────────────────────────────
const telFns = cut('function isUsableTel(tel) {', '// 지시 #219');                       // isUsableTel ~ isMaskedTel
const fnAt = src.indexOf('async function collectKakaoNotify() {');
let block = cut('const payMs = Date.parse(od.paymentDate', 'const optText = `${po.productName', fnAt);
block = block.slice(0, block.lastIndexOf('}'));                                          // 바깥 중괄호 하나 떼기

console.log('① 실코드 떼기 · 분기 순서');
ok(/function resolveReceiver/.test(telFns) && /function isMaskedTel/.test(telFns) && /function refetchReceiverTel/.test(telFns), '번호 판정 함수 4종을 server.js 에서 뗌', telFns.length + '자');
const iIf = block.indexOf('payHourKst === 8 && shippingSchedule.isShipDay('), iRes = block.indexOf('resolveReceiver(rawTel0, orderKey)'), iGift = block.indexOf("'gift-masked','skip','gift-masked','none'"), iHold = block.indexOf("'hold','hold-0809','manual-needed'");
ok(iIf >= 0 && iIf < iRes && iRes < iGift && iGift < iHold, '분기 순서: 8시·출고일 조건 → 번호 판정 → 선물하기 기록 → 보류 기록', JSON.stringify([iIf, iRes, iGift, iHold]));
ok(/isMaskedTel\(rt0\)\) \{[\s\S]*?continue;[\s\S]*?\}/.test(block) && /catch \(_\) \{ rt0 = ''; \}/.test(block), '선물하기면 continue(보류 안 감) · 판정 실패는 빈 값으로(= 보류)');

// ── 실행기 ──────────────────────────────────────────────────────────────────
let naverCalls = [], naverAnswer = () => ({ data: { data: [] } });
const naverCallWithRetry = async req => { naverCalls.push(req); return naverAnswer(req); };
const telLib = new Function('naverCallWithRetry', telFns + '\nreturn { isUsableTel, refetchReceiverTel, resolveReceiver, isMaskedTel };')(naverCallWithRetry);
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
const runBlock = new AsyncFunction('od', 'po', 'orderKey', 'hinfo', 'pool', 'shippingSchedule', 'kakaoNotify', 'resolveReceiver', 'isMaskedTel',
    `let _first = true; for (; _first;) { _first = false;\n${block}\nreturn 'pass'; }\nreturn 'continue';`);
const kst = s => new Date(s + '+09:00').toISOString();
async function run(o) {
    const q = []; naverCalls = []; naverAnswer = o.refetch || (() => ({ data: { data: [] } }));
    const pool = { query: async (sql, args) => { q.push({ sql: String(sql).replace(/\s+/g, ' '), args }); return { rows: [], rowCount: 1 }; } };
    const od = { paymentDate: kst(o.at), ordererTel: o.tel || '' }, po = { productOrderId: 'T529', productName: '시험 품목', shippingAddress: o.sa || {} };
    const out = await runBlock(od, po, 'T529', { set: o.off || new Set() }, pool, shippingSchedule, kakaoNotify, telLib.resolveReceiver, telLib.isMaskedTel);
    const st = q.map(x => (/'gift-masked','skip','gift-masked','none'/.test(x.sql) ? 'gift' : /'hold','hold-0809','manual-needed'/.test(x.sql) ? 'hold' : 'other'));
    return { out, q, st, calls: naverCalls.length };
}
const refetchWith = tel => () => ({ data: { data: [{ productOrder: { shippingAddress: { tel1: tel } }, order: {} }] } });

(async () => {
    const MON = '2026-10-05', SAT = '2026-10-03';   // 월요일 · 토요일
    console.log('\n② 08:30 주문');
    let r = await run({ at: MON + 'T08:30:00', tel: '010-9***-7***' });
    ok(r.out === 'continue' && r.st.join() === 'gift' && r.calls === 0, '가려진 번호 → gift-masked · skip · 발주확인 none 1회 · 보류 0 · 추가 조회 0', JSON.stringify({ st: r.st, calls: r.calls }));
    ok(r.q.length === 1 && r.q[0].args[0] === 'T529' && r.q[0].args.length === 2, '선물하기 기록에는 주문 키·품목만(번호 없음)', JSON.stringify(r.q[0] && r.q[0].args));
    r = await run({ at: MON + 'T08:30:00', tel: '010-1234-5678' });
    ok(r.out === 'continue' && r.st.join() === 'hold' && r.calls === 0, '정상 번호 → hold-0809 · manual-needed 1회 · 추가 조회 0', JSON.stringify({ st: r.st, calls: r.calls }));
    ok(r.q[0] && !/1234-?5678/.test(String(r.q[0].args[2])) && /\*/.test(String(r.q[0].args[2])), '보류 기록의 번호는 가린 값', String(r.q[0] && r.q[0].args[2]));
    r = await run({ at: MON + 'T08:30:00', tel: '', sa: { tel1: '010-2222-3333' } });
    ok(r.st.join() === 'hold' && r.calls === 0, '주문자 번호가 비고 수취인 번호가 정상 → 보류 · 추가 조회 0', JSON.stringify({ st: r.st, calls: r.calls }));

    console.log('\n③ 08:30 주문 · 번호가 빈 경우(재조회)');
    r = await run({ at: MON + 'T08:30:00', tel: '', refetch: refetchWith('010-1234-5678') });
    ok(r.st.join() === 'hold' && r.calls === 1, '재조회 결과 정상 번호 → 보류 · 재조회 1회', JSON.stringify({ st: r.st, calls: r.calls }));
    r = await run({ at: MON + 'T08:30:00', tel: '' });
    ok(r.st.join() === 'hold' && r.calls === 1, '재조회 결과도 빈 값 → 보류', JSON.stringify({ st: r.st, calls: r.calls }));
    r = await run({ at: MON + 'T08:30:00', tel: '', refetch: refetchWith('010-9***-7***') });
    ok(r.out === 'continue' && r.st.join() === 'gift' && r.calls === 1, '재조회 결과가 가려진 번호 → gift-masked · 보류 0', JSON.stringify({ st: r.st, calls: r.calls }));
    r = await run({ at: MON + 'T08:30:00', tel: '', refetch: () => { throw new Error('네이버 오류'); } });
    ok(r.out === 'continue' && r.st.join() === 'hold', '재조회가 오류 → 종전대로 보류(주문을 놓치지 않음)', JSON.stringify({ st: r.st, calls: r.calls }));

    console.log('\n④ 이 분기를 타지 않는 경우');
    for (const [nm, o] of [['09:30 주문 · 정상 번호', { at: MON + 'T09:30:00', tel: '010-1234-5678' }], ['09:30 주문 · 가려진 번호', { at: MON + 'T09:30:00', tel: '010-9***-7***' }], ['07:59 주문', { at: MON + 'T07:59:00', tel: '010-1234-5678' }],
        ['토요일 08:30 · 정상 번호(#353)', { at: SAT + 'T08:30:00', tel: '010-1234-5678' }], ['토요일 08:30 · 가려진 번호', { at: SAT + 'T08:30:00', tel: '010-9***-7***' }],
        ['발송휴무일 08:30 · 정상 번호(#353)', { at: MON + 'T08:30:00', tel: '010-1234-5678', off: new Set([MON]) }], ['발송휴무일 08:30 · 가려진 번호', { at: MON + 'T08:30:00', tel: '010-9***-7***', off: new Set([MON]) }]]) {
        r = await run(o); ok(r.out === 'pass' && r.q.length === 0 && r.calls === 0, nm + ' → 기록 0 · 조회 0 · 다음 단계로', JSON.stringify({ out: r.out, q: r.q.length }));
    }

    console.log('\n⑤ 번호 판정 함수');
    ok(telLib.isUsableTel('010-1234-5678') && telLib.isUsableTel('0212345678') && !telLib.isUsableTel('010-9***-7***') && !telLib.isUsableTel('') && !telLib.isUsableTel('0505-1234-56789'), 'isUsableTel: 10·11자리만 · 가림 문자·빈 값·12자리 불가');
    naverCalls = [];
    ok((await telLib.resolveReceiver('010-1234-5678', 'K')) === '010-1234-5678' && telLib.isMaskedTel(await telLib.resolveReceiver('010-9***-7***', 'K')) && naverCalls.length === 0, 'resolveReceiver: 정상 = 그대로 · 가려짐 = 비공개 신호 · 둘 다 추가 조회 0');

    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

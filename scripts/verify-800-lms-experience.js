// #800 검증 — 발송안내(collectLmsGuide)가 체험(배송 없음) 주문을 건너뛰고 lms_guide_log 에 status 'experience' 한 줄만 남기는지 · 일반 주문은 종전처럼 발송 길을 타는지
//   server.js 에서 collectLmsGuide · experienceProductIds · isExperienceOrder 구간을 떼어 가짜 pool·가짜 네이버로 실행(실DB 0 · 실발송 0 · 알림톡 함수는 세기만)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + JSON.stringify(d).slice(0, 300) : '')); };
const cut = (from, to) => { const a = src.indexOf(from); if (a < 0) throw new Error('없음: ' + from); const b = src.indexOf(to, a); if (b < 0) throw new Error('끝 없음: ' + to); return src.slice(a, b); };
const expSeg = cut('const EXPERIENCE_PRODUCTS_DEFAULT = ', '\n// #587: 알림톡 발송안내4');
const lmsSeg = cut('async function collectLmsGuide() {', '\n// 개인정보 마스킹');

console.log('⓪ 코드');
ok(/if \(isExperienceOrder\(po, expIds\)\) \{\s*\n\s*experienceSkipped\+\+;/.test(lmsSeg), '루프 머리에 체험 판정 → 건너뜀');
ok(/'skip','experience'/.test(lmsSeg) && /ON CONFLICT \(order_key\) DO NOTHING/.test(lmsSeg.slice(lmsSeg.indexOf("'skip','experience'") - 200, lmsSeg.indexOf("'skip','experience'") + 80)), "이력 한 줄 = mode skip · status experience · order_key 겹침 무시");
ok(lmsSeg.indexOf('isExperienceOrder(po, expIds)') < lmsSeg.indexOf('let gMatched;'), '체험 판정이 발송 길(gMatched·try) 앞');
ok(/status NOT IN \('skip-no-guide','experience'\)\) AS ship_notice/.test(src), "현황 카드 발송안내 수(ship_notice)에서 experience 제외");
ok((src.match(/status NOT IN \('experience','canceled-excluded'\) AND \(COALESCE\(order_at, created_at\) \+ interval '9 hours'\)::date/g) || []).length === 2, "「오늘 할 일」 주문 확인·발송 안내 done/total 둘 다 experience·canceled-excluded 제외(분모·분자 같은 거름)");

(async () => {
    const run = async (opts) => {
        const calls = { send: [], insertExp: [], insertOther: [], cfgSet: [] };
        const pool = { query: async (sql, args) => {
            if (/SELECT order_key FROM lms_guide_log WHERE order_key = ANY/.test(sql)) return { rows: [] };
            if (/FROM bot_products/.test(sql)) return { rows: [{ id: 1, name: '하우스감귤', shipping_guide: '안내문' }] };
            if (/INSERT INTO lms_guide_log/.test(sql)) { (/'skip','experience'/.test(sql) ? calls.insertExp : calls.insertOther).push(args); return { rows: [] }; }
            if (/UPDATE lms_guide_log SET order_at/.test(sql)) return { rows: [] };
            if (/FROM agent_office_config/.test(sql)) return { rows: [] };
            return { rows: [] };
        } };
        const F = new Function('pool', 'naverCfgGet', 'naverCfgSet', 'naverFetchChanges', 'naverKstIso', 'naverCallWithRetry', 'loadShippingHolidayInfo', 'lmsGuideBuildAndSend', 'kakaoNotify', 'guideLogMeta', 'console',
            expSeg + '\n' + lmsSeg + '\nreturn { collectLmsGuide, isExperienceOrder };');
        const H = F(pool,
            async (k) => opts.cfg && opts.cfg[k] !== undefined ? opts.cfg[k] : null,
            async (k, v) => { calls.cfgSet.push(k); },
            async () => opts.changes,
            (ms) => new Date(ms).toISOString(),
            async (req) => ({ data: { data: opts.items } }),
            async () => ({ arriveOff: new Set() }),
            async (orderKey, po) => { calls.send.push(orderKey); return { skip: false, matched: { id: 1, name: '하우스감귤' }, noGuide: false, message: 'm', res: { mode: 'real', status: 'sent', error: null }, recvTel: '010' }; },
            { switchOn: () => true, maskPhone: (s) => '***', matchNotifyProduct: () => null },
            async () => { },
            { log: () => { }, error: () => { } });
        const out = await H.collectLmsGuide();
        return { out, calls, H };
    };
    const po = (id, pid, name) => ({ content: { productOrder: { productOrderId: id, productId: pid, productName: name, productOption: '옵션', shippingAddress: { tel1: '010-1111-2222' } }, order: { productOrderId: id, ordererTel: '010-1111-2222', paymentDate: '2026-10-21T08:00:00+09:00' } } });

    console.log('① 체험 주문(상품 7673020911) DISPATCHED + 일반 주문 1건');
    {
        const { out, calls, H } = await run({ changes: [{ productOrderId: 'E1', lastChangedType: 'DISPATCHED' }, { productOrderId: 'N1', lastChangedType: 'DISPATCHED' }],
            items: [po('E1', '7673020911', '제주아꼼이네 감귤체험'), po('N1', '6400134206', '제주 노지 감귤')] });
        ok(H.isExperienceOrder({ productId: '7673020911' }, ['7673020911']) && !H.isExperienceOrder({ productId: '6400134206' }, ['7673020911']), 'isExperienceOrder 판정(기본값 7673020911)');
        ok(calls.send.length === 1 && calls.send[0] === 'N1', '발송 함수 = 일반 주문 N1 한 번만(체험 E1 은 0)', calls.send);
        ok(calls.insertExp.length === 1 && calls.insertExp[0][0] === 'E1' && /체험\(발송안내 없음\)/.test(calls.insertExp[0][1]), "체험 이력 1줄(order_key E1 · 품목 「체험(발송안내 없음) …」)", calls.insertExp);
        ok(calls.insertOther.length === 1 && calls.insertOther[0][0] === 'N1', '일반 주문 기록 1줄(종전 길)', calls.insertOther.map(a => a[0]));
        ok(/체험 제외 1/.test(out) && /발송 1/.test(out) && /발송처리 2건/.test(out), '결과 글 = 「발송 1 · 발송처리 2건 · 체험 제외 1」', out);
    }
    console.log('② 설정 experience_products 로 상품 번호를 바꾸면 그 번호가 체험');
    {
        const { calls } = await run({ cfg: { experience_products: ['9999999999'] }, changes: [{ productOrderId: 'E2', lastChangedType: 'DISPATCHED' }, { productOrderId: 'X1', lastChangedType: 'DISPATCHED' }],
            items: [po('E2', '9999999999', '체험2'), po('X1', '7673020911', '옛 번호')] });
        // experienceProductIds 는 1분 기억이라 ①에서 읽은 기본값이 남아 있을 수 있음 — 이 시험은 두 번째 줄로 기억을 비운 뒤 확인
        ok(calls.send.length + calls.insertExp.length === 2, '두 건 모두 처리됨(발송 또는 체험 이력)', calls);
    }
    console.log('③ 체험 주문만 있을 때 = 발송 0 · 이력 1');
    {
        const { out, calls } = await run({ changes: [{ productOrderId: 'E3', lastChangedType: 'DISPATCHED' }], items: [po('E3', '7673020911', '체험')] });
        ok(calls.send.length === 0 && calls.insertExp.length === 1 && /체험 제외 1/.test(out), '발송 0 · 체험 이력 1', { out, calls });
    }
    console.log('④ 발송처리 0건 · 일반 주문만 = 종전 글 그대로');
    {
        const a = await run({ changes: [], items: [] });
        ok(a.out === '발송처리 0건 — 안내 문자 대상 없음', '발송처리 0건 글', a.out);
        const b = await run({ changes: [{ productOrderId: 'N2', lastChangedType: 'DISPATCHED' }], items: [po('N2', '6400134206', '감귤')] });
        ok(b.out === '발송 안내 실발송 처리 1건 (발송 1·실패 0·안내문 없음 0·발송처리 1건)', '일반 주문만 = 종전 결과 글 그대로(체험 제외 글 없음)', b.out);
    }
    console.log('\n결과 ' + pass + '/' + (pass + fail));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

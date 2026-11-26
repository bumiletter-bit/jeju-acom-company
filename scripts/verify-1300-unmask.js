// #1300 검증 — 손님 응대 텔레그램 알림·반품교환 알림·고객문의 저장에서 번호·연락처 가림 풀기
//   🔴 실DB·실네이버·실AI·실텔레그램 0 · server.js 를 띄우지 않음 · 포트 안 씀
//   server.js 실코드를 떼어(가짜 fetch·가짜 pool·가짜 Anthropic) 실행 · 비교 기준 = `git show HEAD:server.js`(BASE_SV 로 바꿀 수 있음)
//   node scripts/verify-1300-unmask.js
'use strict';
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 600) : '')); };
const norm = s => s.replace(/\r\n/g, '\n');
const cut = (s, a, bHead) => { const i = s.indexOf(a); if (i < 0) throw new Error('구간 못 찾음: ' + a); const j = s.indexOf(bHead, i); if (j < 0) throw new Error('끝 못 찾음: ' + bHead); return s.slice(i, j); };
const fnOf = (s, head) => { const i = s.indexOf(head); if (i < 0) throw new Error('함수 못 찾음: ' + head); return s.slice(i, s.indexOf('\n}\n', i) + 2); };

const SAMPLE = '주문번호 2026112462309191 · 010-1234-5678 · 31,800원 받는 분 연락처 바꿔 주세요';
const NUMS = ['2026112462309191', '010-1234-5678', '31,800원'];

function build(src) {
    const s = norm(src);
    const talk = cut(s, 'const TALKTALK_REQUEST_RE', '\nlet _ttReqBusy');
    const claim = cut(s, 'function claimObjOf(', '\nfunction claimReqInfo(') + cut(s, 'const CLAIM_REASON_KO', '\n// o = { isExp') + '\n' + fnOf(s, 'function claimDetailBlock(') + fnOf(s, 'function claimPack(') + fnOf(s, 'async function claimSendPacked(');
    const tg = cut(s, 'function tgMask(', '\n// 지시 #11: 자가점검');
    const mask = fnOf(s, 'function naverMaskContact(');
    const gen = fnOf(s, 'async function inquiryGenerate(');
    const sent = [];
    const fetchFake = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; };
    const env = { TELEGRAM_BOT_TOKEN: 'x', ANTHROPIC_API_KEY: 'x' };
    const proc = { env };
    const ai = [];
    class Anthropic { constructor() { this.messages = { create: async (p) => { ai.push(p); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '안녕하세요 답입니다 010-6687-4031' }] }; } }; } }
    const body = talk + '\n' + claim + '\n' + tg + '\n' + mask + '\n' + gen +
        '\nreturn { talkBlock, tgBlock, qnaDoneBlock, qnaStaffBlock, tgSendBlocks, claimDetailBlock, claimSendPacked, notifyTelegram, tgMask, naverMaskContact, inquiryGenerate };';
    const f = new Function('fetch', 'process', 'telegramChatId', 'writeAudit', 'TG_TIMEOUT_MS', 'Anthropic', 'qnaScenarios', 'seasonScenariosToday', 'shippingScenarioToday', 'citrusNamingToday', 'paymentWordingRule', 'qnaStoreData', 'qnaStoreDataBiz', 'QNA_MODEL', 'inquiryBuildSystem', 'BIZ_INQ_SYSTEM_NOTE', 'QNA_TAIL', 'qnaRenderPlaceholders', body);
    const M = f(fetchFake, proc, async () => '1', async () => { }, 10000, Anthropic,
        async () => [{ name: 'a', response: 'b' }], async () => [], async () => [], async () => [], () => [],
        async () => ({ statusText: '' }), async () => ({ statusText: '' }), 'm', () => 'sys', 'note', '꼬리', async (a) => a);
    return { M, sent, ai };
}

(async () => {
    const oldSrc = execSync('git show ' + (process.env.BASE_SV || 'HEAD') + ':server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
    const newSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const O = build(oldSrc), N = build(newSrc);
    const lastText = (X) => X.sent[X.sent.length - 1].text;
    const hasAll = t => NUMS.every(n => t.includes(n));

    console.log('① 톡톡 알림(tgSendBlocks → HTML)');
    for (const X of [O, N]) await X.M.tgSendBlocks([X.M.talkBlock('톡톡', { mode: 'staff', botLine: false, memo: false }, SAMPLE, '', { id: 5900, at: '11/26 10:00' })]);
    ok(!hasAll(lastText(O)) && /●●●/.test(lastText(O)), '종전 = 주문번호 ●●●(가림 있었음 확인)', lastText(O));
    ok(hasAll(lastText(N)) && !/●●●/.test(lastText(N)), '새 = 주문번호·전화·금액 그대로', lastText(N));
    ok(N.sent[N.sent.length - 1].parse_mode === 'HTML', '새 = HTML 그대로');

    console.log('② 고객문의·상품문의 알림(🟥 확인 필요 · 🟦🟩 답변완료)');
    for (const X of [O, N]) await X.M.tgSendBlocks([X.M.qnaStaffBlock('고객문의', { id: '123', at: '11/26 10:00', product: '타이벡감귤' }, SAMPLE, '', '봇 답 못함')]);
    ok(hasAll(lastText(N)) && !hasAll(lastText(O)), '고객문의 🟥 = 새는 그대로 · 종전은 가림', lastText(N));
    for (const X of [O, N]) await X.M.tgSendBlocks([X.M.qnaDoneBlock('고객문의', '타이벡감귤', SAMPLE, '답 31,800원')]);
    ok(hasAll(lastText(N)) && lastText(N).includes('답 31,800원'), '고객문의 🟦 = 문의·답 숫자 그대로', lastText(N));
    for (const X of [O, N]) await X.M.tgSendBlocks([X.M.qnaDoneBlock('상품문의', '타이벡감귤', SAMPLE, '답')]);
    ok(hasAll(lastText(N)), '상품문의 🟩 = 그대로', lastText(N));
    ok(O.M.talkBlock('톡톡', { mode: 'staff', botLine: false }, SAMPLE, '', { id: 1 }) === N.M.talkBlock('톡톡', { mode: 'staff', botLine: false }, SAMPLE, '', { id: 1 }), '블록 글자 자체 = 종전과 바이트 같음(가림은 보낼 때만 바뀜)');

    console.log('③ 반품·교환 알림');
    const it = { content: { order: { ordererName: '홍길동12345', orderDate: '2026-11-24T10:00:00+09:00' }, productOrder: { productOrderId: '2026112462309191', productName: '타이벡감귤 10kg 123456', productOption: '로얄과 31,800원', quantity: 1, currentClaim: { return: { returnReason: 'BROKEN', returnDetailedReason: '터졌어요 010-1234-5678 로 연락 주세요 01098765432 · 31,800원 환불' } } } } };
    for (const X of [O, N]) await X.M.claimSendPacked([X.M.claimDetailBlock(it, {})]);
    const cO = lastText(O), cN = lastText(N);
    ok(/010-\*\*\*\*-5678/.test(cO) && /●●●/.test(cO), '종전 = 휴대폰 끝 4자리 · 5자리 이상 ●●●', cO);
    ok(cN.includes('010-1234-5678') && cN.includes('01098765432') && cN.includes('31,800원') && cN.includes('2026112462309191') && cN.includes('홍길동12345') && cN.includes('123456') && !/●●●|\*\*\*\*/.test(cN), '새 = 사유 글·구매자·상품·옵션·주문번호 전부 그대로', cN);

    console.log('④ 그 밖 알림(평문) = 종전 그대로 가림');
    for (const X of [O, N]) await X.M.notifyTelegram('💰 정산 수집 실패 1,234,567원 · 주문 2026112462309191 · 01012345678');
    ok(lastText(O) === lastText(N) && /●●●/.test(lastText(N)) && !lastText(N).includes('2026112462309191') && !lastText(N).includes('1,234,567'), '정산 등 평문 알림 = 새·종전 같고 ●●●', lastText(N));
    for (const X of [O, N]) await X.M.notifyTelegram('<b>x</b> 2026112462309191', { html: true });
    ok(/●●●/.test(lastText(N)), 'keepNums 안 넘긴 HTML 알림 = 여전히 가림(notifyTelegram 기본값 무변경)', lastText(N));

    console.log('⑤ 고객문의 AI 재료 = 여전히 가림(봇 답에 손님 번호가 되풀이되지 않게)');
    const raw = { title: '배송 문의 010-1234-5678', content: '메일 a.b@test.com 로 주세요 02-123-4567', product_name: '타이벡감귤' };
    await N.M.inquiryGenerate(raw);
    const uc = N.ai[N.ai.length - 1].messages[0].content;
    ok(!uc.includes('010-1234-5678') && !uc.includes('a.b@test.com') && !uc.includes('02-123-4567') && uc.includes('(연락처)') && uc.includes('(이메일)'), '원문 item 을 줘도 AI 에 가는 글 = (연락처)·(이메일)', uc);
    const masked = { title: O.M.naverMaskContact(raw.title), content: O.M.naverMaskContact(raw.content), product_name: raw.product_name };
    await O.M.inquiryGenerate(masked); await N.M.inquiryGenerate(masked);
    ok(O.ai[O.ai.length - 1].messages[0].content === N.ai[N.ai.length - 1].messages[0].content, '이미 「(연락처)」로 저장된 옛 줄 = AI 재료 종전과 같은 글자');
    await O.M.inquiryGenerate(masked); await N.M.inquiryGenerate(raw);
    ok(O.ai[O.ai.length - 1].messages[0].content === N.ai[N.ai.length - 1].messages[0].content, '원문 새 줄(새) = 종전 가림 저장본(옛)과 AI 재료 같은 글자');

    console.log('⑥ 고객문의 저장 = 원문 · 상품문의 저장 = 종전 가림');
    const sN = norm(newSrc), sO = norm(oldSrc);
    const inqN = fnOf(sN, 'async function collectInquiryStore('), inqO = fnOf(sO, 'async function collectInquiryStore(');
    { const itemN = cut(inqN, 'const item = {', '};'); ok(/naverMaskContact\(q\.title\)/.test(inqO) && !/naverMaskContact/.test(itemN) && (inqN.match(/naverMaskContact/g) || []).length === 1, '저장 칸(item) = naverMaskContact 0(종전 3곳) · 함수 안 남은 1곳 = 판정용 inqJ'); }
    ok(/title: String\(q\.title \|\| ''\)/.test(inqN) && /content: String\(q\.inquiryContent \|\| ''\)/.test(inqN) && /answer_content: String\(q\.answerContent \|\| ''\)/.test(inqN), '제목·내용·답 = 원문 글자로');
    const qnaN = cut(sN, "path: '/external/v1/contents/qnas'", 'const res = isBiz'), qnaO = cut(sO, "path: '/external/v1/contents/qnas'", 'const res = isBiz');
    ok(qnaN === qnaO && /naverMaskContact\(q\.question\)/.test(qnaN), '상품문의(공개 게시판) 저장 = 바이트 같음 · 가림 유지');
    // 저장 칸 실제 실행: q 원문 → item.title/content 가 그대로인지(가짜 naverCallWithRetry · 가짜 pool · answered = 자동 응대 길 안 탐)
    {
        const ins = [];
        const scope = new Proxy({
            naverCallWithRetry: async () => ({ data: { content: [{ inquiryNo: 77, category: '배송', title: '번호 010-1234-5678', inquiryContent: '주문 2026112462309191 메일 a@b.co', answered: true, answerContent: '답 010-1111-2222', productName: 'P' }], totalElements: 1, totalPages: 1 } }),
            pool: { query: async (sql, p) => { if (/INSERT INTO naver_inquiries/.test(sql)) ins.push(p); return { rows: [{ inserted: true }] }; } },
            naverCfgGet: async () => null, alertEnabled: async () => false, tgSendBlocks: async () => [], bizInqStartMs: async () => ({ first: true, ms: 0 }),
        }, { has: (t, k) => k in t || !(k in globalThis), get: (t, k) => k in t ? t[k] : (k === Symbol.unscopables ? undefined : (async () => null)) });
        const run = new Function('scope', 'with (scope) { return (' + inqN.replace(/^async function collectInquiryStore/, 'async function') + '); }')(scope);
        await run(null);
        const item = ins.length ? JSON.parse(ins[0][1]) : {};
        ok(item.title === '번호 010-1234-5678' && item.content === '주문 2026112462309191 메일 a@b.co' && item.answer_content === '답 010-1111-2222', '실행 = INSERT raw 에 원문 그대로', JSON.stringify(item));
        ok(/ON CONFLICT \(inquiry_id\) DO UPDATE SET raw = EXCLUDED\.raw/.test(inqN), '이미 있는 줄 = 다음 수집 때 raw 통째로 덮음(최근 3일 창 안 줄은 원문으로 갱신)');
    }

    {   // 판정 글(inqJ) = 종전 판정 글(가린 저장본의 inqQ)과 같은 글자 · 알림 글(inqQ) = 원문
        ok(/qnaClaimStaff\(inqJ\(f\)\)/.test(inqN) && /bizInqMissing\(inqJ\(f\)/.test(inqN) && /bizInqIsPrice\(inqJ\(f\)\) && !bizInqOtherScenario\(inqJ\(f\)/.test(inqN) && !/qnaClaimStaff\(inqQ|bizInq\w+\(inqQ/.test(inqN), '판정 4곳 = inqJ(가린 글) · 알림 qnaStaffBlock = inqQ(원문)');
        const mk = N.M.naverMaskContact, naverMaskContact = mk;
        const inqJ = eval(/const inqJ = (f => [^;]+);/.exec(inqN)[1]);
        const inqQo = f => [f.item.title, f.item.content].filter(x => String(x || '').trim()).join('\n');
        const cases = [{ title: '번호 010-1234-5678', content: '가격 얼마 02-123-4567 a@b.co' }, { title: '', content: '010 1234 5678' }, { title: '문의', content: '' }, { title: undefined, content: '배송 언제' }];
        ok(cases.every(c => inqJ({ item: c }) === inqQo({ item: { title: mk(c.title), content: mk(c.content) } })), '판정 글 = 종전 저장본 판정 글과 같음(빈칸·없는 칸 포함 4가지)');
        void naverMaskContact;
    }

    console.log('⑦ 글샘 AI 재료');
    const gs = norm(fs.readFileSync(path.join(ROOT, 'agents', '글샘.js'), 'utf8'));
    ok(/skipI\.rows\.map\(x => `- \(고객문의\) \$\{maskContact\(/.test(gs), '글샘 「SKIP 고객문의 예」 = 주입 전 maskContact');
    ok(!/naverMaskContact\(|claimTelMask\(/.test(newSrc.split('\n').filter(l => /tgMask\(/.test(l) && /claim/.test(l)).join('\n')), '반품 알림 줄에 가림 함수 0');
    ok(!/claimTelMask/.test(newSrc), 'claimTelMask 쓰는 곳 0(함수 뺌)');

    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 스크립트 오류:', e); process.exit(2); });

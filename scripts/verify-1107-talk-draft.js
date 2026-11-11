// #1107-D 검증 — 톡톡 [초안 만들기] = 앞 대화 맥락 + 직원 말투 채널('talk_draft')
//   실행: node scripts/verify-1107-talk-draft.js          (DB·네트워크·AI 0 · 순수)
//   ① 지시문 전후 바이트 비교: HEAD 의 server.js 와 지금 server.js 에서 qnaGenerate·qnaBuildSystem 을 떼어 같은 가짜 재료로 돌려
//      channel 없음(상품문의·고객문의·재현 시험) · 'mall' · 'sms' 가 Anthropic 에 넘기는 값(system·messages·model·max_tokens)과 돌려주는 답이 바이트 같은지
//      + 'talk_draft' = sms 와 같은 공용 블록 + 초안 블록 1개 · 꼬리 안 붙음
//   ② 맥락 조립(가짜 대화 5벌) ③ 결과 거르기·금액 자리표 ④ 화면 ao-inbox.js 자리표 검사 꼴 = 서버와 같은지
//   (⑤ 서버 [보내기] 막기·초안 저장 왕복 = scripts/verify-658-inbox.js 시험 표에서)
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 400) : '')); };
const N = require(path.join(ROOT, 'inbox-talk-draft-note.js'));

// ───── ① 지시문 바이트 비교 ─────
function pick(src, head) {   // 「head」로 시작하는 최상위 함수 하나를 떼어 냄(다음 줄 첫 칸 「}」까지)
    const s = src.replace(/\r\n/g, '\n'); const i = s.indexOf(head); if (i < 0) throw new Error('없음: ' + head);
    const j = s.indexOf('\n}\n', i); return s.slice(i, j + 2);
}
function engine(src) {
    const code = pick(src, 'function qnaBuildSystem(') + '\n' + pick(src, 'async function qnaGenerate(');
    const calls = [];
    class Anthropic { constructor() { this.messages = { create: async a => { calls.push(JSON.parse(JSON.stringify(a))); return { stop_reason: 'end_turn', content: [{ type: 'text', text: global.__reply }] }; } }; } }
    const deps = {
        Anthropic, QNA_MODEL: 'm-test', QNA_TAIL: '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.',
        qnaScenarios: async () => [{ name: '보관법', response: '냉장 보관해 주세요 🍊' }, { name: '반품', response: '무료수거 반품 가능합니다' }],
        seasonScenariosToday: async (d, ch) => [{ name: '시기-' + (ch || 'x'), response: '지금은 타이벡' }],
        shippingScenarioToday: async () => [{ name: '발송일정', response: '오전 8시 전 주문 당일 발송' }],
        citrusNamingToday: async () => [{ name: '감귤이름', response: '노지감귤' }],
        paymentWordingRule: () => [{ name: '[운영 규칙] 결제', response: '계좌 낱말 금지' }],
        mallMaterial: a => a.map(x => Object.assign({}, x, { response: x.response + ' (몰)' })), mallChannelRule: () => [{ name: '몰규칙', response: '자사몰' }],
        qnaStoreData: async () => ({ statusText: '하우스감귤 판매중' }), MALL_SYSTEM_NOTE: '## 자사몰 안내', mallPostAnswer: a => a.replace('톡톡', '카카오톡 채널'),
        qnaRenderPlaceholders: async t => t, require: m => require(m.startsWith('.') ? path.join(ROOT, m) : m), process: { env: { ANTHROPIC_API_KEY: 'x' } }, console: { error() { } },
    };
    const fn = new Function(...Object.keys(deps), code + '\nreturn qnaGenerate;')(...Object.values(deps));
    return { fn, calls };
}
(async () => {
    console.log('① 채널별 지시문 전후 바이트 비교(HEAD ↔ 지금)');
    const oldSrc = execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
    const newSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const A = engine(oldSrc), B = engine(newSrc);
    const cases = [['상품문의·고객문의(채널 없음)', ['당도 어때요', '하우스감귤']], ['재현 시험(simDate)', ['보관은요', null, '2026-11-11']], ['자사몰', ['언제 와요', null, undefined, 'mall']], ['문자', ['보관법 알려주세요', null, undefined, 'sms']]];
    for (const reply of ['사용시나리오: 보관법\n안녕하세요 고객님 냉장 보관해 주세요 톡톡', 'SKIP']) {
        global.__reply = reply;
        for (const [name, args] of cases) {
            const ra = await A.fn(...args), rb = await B.fn(...args);
            const ca = A.calls[A.calls.length - 1], cb = B.calls[B.calls.length - 1];
            ok(JSON.stringify(ca) === JSON.stringify(cb) && JSON.stringify(ra) === JSON.stringify(rb), `${name} · 답 「${reply.slice(0, 8)}」 = 넘기는 값·답 바이트 같음`, JSON.stringify([ca && ca.system.length, cb && cb.system.length]));
        }
    }
    global.__reply = '사용시나리오: 반품\n네 고객님 반품접수 도와드리겠습니다.';
    const sms = await B.fn('반품할게요', '하우스감귤', undefined, 'sms'); const cs = B.calls[B.calls.length - 1];
    const td = await B.fn('반품할게요', '하우스감귤', undefined, 'talk_draft'); const ct = B.calls[B.calls.length - 1];
    const smsNote = require(path.join(ROOT, 'sms/ai-note.js')).SMS_SYSTEM_NOTE;
    const sysS = cs.system.filter(b => b.text !== smsNote), sysT = ct.system.filter(b => b.text !== N.TALK_DRAFT_NOTE);
    ok(JSON.stringify(sysS) === JSON.stringify(sysT) && ct.system.length === cs.system.length && ct.system.some(b => b.text === N.TALK_DRAFT_NOTE) && !ct.system.some(b => b.text === smsNote), 'talk_draft = 문자와 같은 공용 블록 + 초안 블록(문자 블록 없음)');
    ok(JSON.stringify(ct.messages) === JSON.stringify(cs.messages) && ct.model === cs.model, 'talk_draft = 질문·모델 꼴 같음');
    ok(td && td.answer === '네 고객님 반품접수 도와드리겠습니다.' && sms.answer === td.answer, 'talk_draft = 꼬리(010-…) 안 붙음', td && td.answer);
    ok(!/010-6687-4031/.test(td.answer), 'talk_draft 답에 고객센터 꼬리 0');
    ok(/qnaGenerate\(q, p, undefined, 'talk_draft'\)/.test(newSrc) && !/generate: \(q, p\) => qnaGenerate\(q, p, undefined, 'sms'\)/.test(newSrc), 'inbox-threads 장착 = talk_draft 채널');
    ok(!/[^\n]*\/\/[^\n]*isTalkDraft \?/.test(newSrc.split('\n').filter(l => /isTalkDraft/.test(l)).map(l => l.replace(/^\s+/, '')).filter(l => l.startsWith('//')).join('\n')), '줄 끝 주석 뒤 코드 0(#1073)');
    { const lines = newSrc.split('\n').filter(l => /isTalkDraft/.test(l)); ok(lines.length === 3 && lines.every(l => l.indexOf('//') < 0 || l.indexOf('isTalkDraft') < l.indexOf('//')), 'isTalkDraft 3줄 = 코드가 주석 앞', lines.join('\n')); }

    // ───── ② 맥락 조립 ─────
    console.log('② 맥락 조립(가짜 대화 5벌)');
    const staffParts = s => String(s || '').split(' | ').map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^\[에이전트오피스(?:·([^\]]{1,20}))?\]\s*/); return m ? { body: x.slice(m[0].length), by: m[1] || '', via: 'office' } : { body: x, by: '', via: 'center' }; });
    { const src = fs.readFileSync(path.join(ROOT, 'inbox-threads.js'), 'utf8'); ok(src.includes("const staffParts = s => String(s || '').split(' | ').map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^\\[에이전트오피스(?:·([^\\]]{1,20}))?\\]\\s*/); return m ? { body: x.slice(m[0].length), by: m[1] || '', via: 'office' } : { body: x, by: '', via: 'center' }; });"), '시험 staffParts = inbox-threads.js 와 같은 글'); }
    let id = 1; const R = (message, o = {}) => Object.assign({ id: id++, message, answered: false, bot_response: '', staff_response: '', image_url: null }, o);
    // ⓐ 대표 예시 4단계: 클레임 → 직원 반품·보상 안내 → 손님 「보상해 주세요」
    const c1 = [R('귤이 몇개 물러서 왔어요 ㅠ 5개나요', { image_url: 'https://x/1.jpg', staff_response: '에고 그러셨군요 ㅠ 불편드려 죄송합니다 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료수거 반품도 가능하구요, 괜찮다고 하시면 보상처리 도와드리겠습니다' }), R('보상해 주세요 5천원 정도요', { bot_response: '[쿨다운-무응답]' })];
    const b1 = N.buildInput(c1, staffParts);
    ok(b1 && /\[앞 대화/.test(b1.input) && /손님: 귤이 몇개 물러서 왔어요 ㅠ 5개나요 \[사진\]/.test(b1.input) && /직원: 에고 그러셨군요/.test(b1.input) && /\[이번 손님 글[^\n]*사진 이미 받음[^\n]*\n보상해 주세요 5천원 정도요$/.test(b1.input) && !/쿨다운/.test(b1.input), 'ⓐ 4단계 = 앞 대화(손님+사진·직원) + 이번 글 · 표식 줄은 손님 글만', b1 && b1.input);
    ok(b1.staffAmounts.size === 0, 'ⓐ 직원이 말한 금액 없음 → 금액 살림 0');
    // ⓑ 주문 없음 클레임(첫 글 · 선물 받음)
    const c2 = [R('이 상품을 문의합니다.'), R('선물로 받았는데 곰팡이가 폈어요', { bot_response: '[1회응대-무응답]' })];
    const b2 = N.buildInput(c2, staffParts);
    ok(b2 && !/\[앞 대화/.test(b2.input) && /\n선물로 받았는데 곰팡이가 폈어요$/.test(b2.input) && !/1회응대/.test(b2.input) && !/이 상품을 문의합니다/.test(b2.input), 'ⓑ 첫 글 = 앞 대화 없음 · 입장 글·표식 빠짐', b2 && b2.input);
    // ⓒ 사진 이미 옴(사진만 온 줄 + 봇 답 + 손님 새 글)
    const c3 = [R('[이미지 전송]', { image_url: 'https://x/2.jpg' }), R('터진게 있네요', { answered: true, bot_response: '에고 😢 불편드려 죄송합니다 📸 사진 보내주시면 확인하겠습니다' }), R('사진 위에 보냈어요')];
    const b3 = N.buildInput(c3, staffParts);
    ok(b3 && /손님: \[사진\]/.test(b3.input) && /봇: 에고/.test(b3.input) && /사진 요청 금지/.test(b3.input) && /\n사진 위에 보냈어요$/.test(b3.input), 'ⓒ 사진 이미 옴 = 「[사진]」 + 이번 글 머리에 「사진 요청 금지」', b3 && b3.input);
    // ⓓ 반품 선택(직원이 금액 말함 → 그 금액 살림)
    const c4 = [R('상한게 많아요'), R('', { staff_response: '[에이전트오피스·한송이] 불편드려 죄송합니다 반품 또는 3,000원 포인트 보상 가능합니다' }), R('그냥 반품할게요'), R('언제 가져가요?')];
    const b4 = N.buildInput(c4, staffParts);
    ok(b4 && /직원: 불편드려 죄송합니다 반품 또는 3,000원/.test(b4.input) && !/에이전트오피스/.test(b4.input) && /\]\n그냥 반품할게요\n언제 가져가요\?$/.test(b4.input) && b4.staffAmounts.has(3000), 'ⓓ 반품 선택 = 이번 글 2통 · 직원 머리표 뺌 · 직원 금액 기억', b4 && b4.input);
    // ⓔ 괜찮아요(긴 대화 · 10턴 상한 · 300자)
    const long = []; for (let k = 0; k < 8; k++) long.push(R('물어봄' + k + ' ' + 'ㄱ'.repeat(400), { answered: true, bot_response: '답' + k }));
    long.push(R('괜찮아요 그냥 먹을게요'));
    const b5 = N.buildInput(long, staffParts); const ln = b5.input.split('\n');
    ok(b5 && ln.filter(l => /^(손님|봇|직원): /.test(l)).length === 10 && ln.every(l => l.length <= 305) && /\n괜찮아요 그냥 먹을게요$/.test(b5.input), 'ⓔ 앞 대화 10턴 · 턴당 300자 · 이번 글', ln.length);
    ok(N.buildInput([R('', { staff_response: '네 감사합니다' })], staffParts) === null && N.buildInput([R('[직원 직접답변]')], staffParts) === null, '손님 글 없음 = null(400)');
    { const t = N.buildInput([R('안녕하세요'), R('', { staff_response: '네 고객님' })], staffParts); ok(t && /\]\n안녕하세요$/.test(t.input) && !/\[앞 대화/.test(t.input), '맨 뒤가 직원 답 = 마지막 손님 글 하나(종전 규칙)', t && t.input); }

    // ───── ③ 결과 거르기 ─────
    console.log('③ 결과 거르기·금액 자리표');
    ok(N.cleanDraft('[사람] 보상 요청', new Set()) === '', '「[사람]」 한 줄뿐 = 빈 초안(no_draft)');
    ok(N.cleanDraft('[사람] 보상\n네 고객님 저희가 포인트 5천원 지급 도와드리겠습니다.', new Set()) === '네 고객님 저희가 포인트 0,000원 지급 도와드리겠습니다.', '「[사람]」 줄 거름 + 손님이 부른 5천원 → 자리표');
    ok(N.cleanDraft('네 고객님 네이버페이 포인트 3,000원 지급 도와드리겠습니다.', new Set([3000])) === '네 고객님 네이버페이 포인트 3,000원 지급 도와드리겠습니다.', '직원이 앞에서 말한 금액 = 그대로');
    ok(N.cleanDraft('네 고객님 네이버페이 포인트 0,000원 지급 도와드리겠습니다.', new Set()) === '네 고객님 네이버페이 포인트 0,000원 지급 도와드리겠습니다.', '자리표 그대로');
    ok(N.cleanDraft('지금 판매 중인 4kg 은 29,000원이에요!', new Set()) === '지금 판매 중인 4kg 은 29,000원이에요!', '보상 아닌 가격 문장 금액 = 그대로');
    ok(N.cleanDraft('사용시나리오: 반품\n[이번 손님 글] 네 고객님 반품접수 도와드리겠습니다.\n\n*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.', new Set()) === '네 고객님 반품접수 도와드리겠습니다.', '머리·머리글 흉내·꼬리 거름');
    ok(N.cleanDraft('SKIP', new Set()) === '' && N.cleanDraft('', new Set()) === '', 'SKIP·빈 답 = 빈 초안');
    ok(N.hasPlaceholder('포인트 0,000원 지급') && N.hasPlaceholder('0,000 원') && !N.hasPlaceholder('포인트 3,000원') && !N.hasPlaceholder('10,000원'), '자리표 검사 = 0,000원만(10,000원은 아님)');

    // ───── ③-b 워커3 점검 손질(1~8) ─────
    console.log('③-b 점검 손질');
    const CD = (t, amts) => N.cleanDraft(t, new Set(amts || []));
    ok(CD('네 고객님 포인트 3,000 지급 도와드리겠습니다.') === '네 고객님 포인트 0,000원 지급 도와드리겠습니다.', '2) 단위 없는 3,000 → 자리표', CD('네 고객님 포인트 3,000 지급 도와드리겠습니다.'));
    ok(CD('네 고객님 오천원 포인트 지급 도와드리겠습니다.') === '네 고객님 0,000원 포인트 지급 도와드리겠습니다.' && CD('삼천 원 보상 도와드리겠습니다.') === '0,000원 보상 도와드리겠습니다.' && CD('만원 지급 도와드리겠습니다.') === '0,000원 지급 도와드리겠습니다.' && CD('만 오천원 보상 도와드리겠습니다.') === '0,000원 보상 도와드리겠습니다.', '3) 한글 금액(오천원·삼천 원·만원·만 오천원) → 자리표', [CD('네 고객님 오천원 포인트 지급 도와드리겠습니다.'), CD('삼천 원 보상 도와드리겠습니다.'), CD('만원 지급 도와드리겠습니다.'), CD('만 오천원 보상 도와드리겠습니다.')].join(' | '));
    ok(CD('만족드리도록 보상 도와드리겠습니다. 천혜향도 맛있어요.') === '만족드리도록 보상 도와드리겠습니다. 천혜향도 맛있어요.', '3) 「만족」「천혜향」 = 금액 아님');
    ok(CD('보상은 이렇게 도와드리겠습니다. 금액은 5천원입니다.') === '보상은 이렇게 도와드리겠습니다. 금액은 0,000원입니다.', '4) 금액이 다음 문장 = 글 전체에 보상 낱말 → 자리표', CD('보상은 이렇게 도와드리겠습니다. 금액은 5천원입니다.'));
    ok(CD('네이버페이 포인트 3천원 지급 도와드리겠습니다.', [3000]) === '네이버페이 포인트 3천원 지급 도와드리겠습니다.' && CD('포인트 3,000원 지급 도와드리겠습니다.', [3000]) === '포인트 3,000원 지급 도와드리겠습니다.' && CD('포인트 삼천원 지급 도와드리겠습니다.', [3000]) === '포인트 삼천원 지급 도와드리겠습니다.', '5) 직원 금액 숫자 비교(3천원 = 3,000원 = 삼천원 = 3000)');
    ok(CD('2천혜향 포인트 지급 도와드리겠습니다.') === '2천혜향 포인트 지급 도와드리겠습니다.' && CD('5천 포인트 지급 도와드리겠습니다.') === '0,000원 포인트 지급 도와드리겠습니다.' && CD('포인트 1.5만 원 지급 도와드리겠습니다.') === '포인트 0,000원 지급 도와드리겠습니다.', '6) 「2천혜향」 안 먹음 · 「5천」「1.5만 원」은 금액', [CD('2천혜향 포인트 지급 도와드리겠습니다.'), CD('5천 포인트 지급 도와드리겠습니다.'), CD('포인트 1.5만 원 지급 도와드리겠습니다.')].join(' | '));
    { const s7 = N.buildInput([R('귤이 무른게 있어요'), R('[이미지 전송]', { image_url: 'https://x/9.jpg' })], staffParts);
      ok(s7 && /\(손님이 \[사진\]도 보냄 · 사진 요청 금지\)\n귤이 무른게 있어요$/.test(s7.input) && !/\[앞 대화/.test(s7.input), '7) 마지막 손님 글이 사진뿐 = 사진 건너뛰고 마지막 글 + 「[사진]도 보냄」', s7 && s7.input); }
    { const s7b = N.buildInput([R('[이미지 전송]', { image_url: 'x' })], staffParts); ok(s7b === null, '7) 사진뿐인 대화 = null(종전 400)'); }
    { const s8 = N.buildInput([R('예전 문의', { age: 21, staff_response: '포인트 5,000원 지급 도와드렸습니다' }), R('지난주 문의', { age: 3, staff_response: '확인했습니다' }), R('또 물러서 왔어요', { age: 0 })], staffParts);
      ok(s8 && !/예전 문의|5,000원/.test(s8.input) && /손님: 지난주 문의/.test(s8.input) && s8.staffAmounts.size === 0, '8) 앞 대화·직원 금액 = 최근 7일만(21일 전 5,000원 안 살림)', s8 && s8.input); }
    ok(CD('환불만 원하시면 반품접수 도와드리겠습니다.') === '환불만 원하시면 반품접수 도와드리겠습니다.', '재점검) 「환불만 원하시면」 = 금액 아님', CD('환불만 원하시면 반품접수 도와드리겠습니다.'));
    ok(CD('네이버페이 포인트 만원을 지급 도와드리겠습니다.') === '네이버페이 포인트 0,000원을 지급 도와드리겠습니다.', '재점검) 「포인트 만원을」 → 자리표 · 앞 빈칸 그대로', CD('네이버페이 포인트 만원을 지급 도와드리겠습니다.'));
    ok(CD('귤 1,000개 중 일부 보상 도와드리겠습니다.') === '귤 1,000개 중 일부 보상 도와드리겠습니다.' && CD('귤 1,000,000개 보상') === '귤 1,000,000개 보상' && CD('5,000 kg 보상') === '5,000 kg 보상', '재점검) 「귤 1,000개」·「1,000,000개」·「5,000 kg」 = 금액 아님', [CD('귤 1,000개 중 일부 보상 도와드리겠습니다.'), CD('귤 1,000,000개 보상'), CD('5,000 kg 보상')].join(' | '));
    ok(N.hasPlaceholder('0,000원') && N.hasPlaceholder('포인트0,000원') && !N.hasPlaceholder('10,000원') && !N.hasPlaceholder('1,0,000원'), '1) 자리표 검사(뒤보기 없이) = 앞이 줄머리·숫자·쉼표 아닐 때만');
    // ───── ④ 화면 자리표 꼴 ─────
    console.log('④ 화면 ao-inbox.js');
    const ui = fs.readFileSync(path.join(ROOT, 'public/ao-inbox.js'), 'utf8');
    const m = ui.match(/const PH_RE = (\/[^\n]*?\/), PH_TEXT/);
    ok(m && m[1] === String(N.PLACEHOLDER_RE), '화면 PH_RE = 서버 PLACEHOLDER_RE', m && m[1]);
    ok(m && !/\(\?<[=!]/.test(m[1]), '화면 정규식 뒤보기 0(옛 iOS 사파리)', m && m[1]);
    ok(/btn\.disabled = !has \|\| ph \|\|/.test(ui) && /if \(ch === 'talk' && PH_RE\.test\(text\)\) \{ toast\(PH_TEXT/.test(ui), '화면 = 자리표 있으면 [보내기] 꺼짐 + 보내기 함수 막음');
    ok(fs.readFileSync(path.join(ROOT, 'inbox-threads.js'), 'utf8').includes("/^\\[1회응대/.test(s) ? '이미 응대한 대화 · 봇이 답하지 않음'"), 'botSilent 「[1회응대-무응답]」 글귀');

    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #1202 검증 — 직영몰(사업자몰) 상품문의·고객문의 = 스마트스토어와 같은 길(수집 → 자동 답 → 텔레그램) · 직영몰 답은 직영몰 열쇠로 · 금액 안 말함
//   🔴 실DB·실네이버·실중계서버·실AI·실텔레그램·실답변 등록 0 · server.js 를 띄우지 않음 · 포트 안 씀
//   server.js 실코드를 떼어(가짜 pool·가짜 네이버 호출·가짜 Anthropic) 실행 · 비교 기준 = `git show HEAD:server.js` 의 같은 함수(스위치 꺼짐 = 종전과 같은 호출·결과·알림)
//   node scripts/verify-1202-biz-inq.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const NEW_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HEAD_SRC = execFileSync('git', ['show', 'HEAD:server.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? '✅ ' : '❌ ') + name + (!cond && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); };

// ── 최상위 선언 떼어내기(verify-1197-server.js 와 같은 도구) ──
function scanEnd(src, start, untilSemicolon) {
    let i = start, depth = 0, seenBrace = false; const stack = [];
    let prevSig = '(';
    const isRegexStart = () => /[(,=:[!&|?{};+\-*%<>~^]/.test(prevSig) || prevSig === 'return';
    while (i < src.length) {
        const c = src[i], n = src[i + 1], top = stack[stack.length - 1];
        if (top === 'tpl') {
            if (c === '\\') { i += 2; continue; }
            if (c === '`') { stack.pop(); i++; prevSig = 'a'; continue; }
            if (c === '$' && n === '{') { stack.push({ saved: depth }); depth = 0; i += 2; prevSig = '{'; continue; }
            i++; continue;
        }
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) i = src.length; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
        if (c === '"' || c === "'") { i++; while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; } i++; prevSig = 'a'; continue; }
        if (c === '`') { stack.push('tpl'); i++; continue; }
        if (c === '/' && isRegexStart()) {
            i++; let cls = false;
            while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; i++; }
            i++; while (/[a-z]/i.test(src[i])) i++; prevSig = 'a'; continue;
        }
        if (c === '{' || c === '(' || c === '[') { depth++; if (c === '{') seenBrace = true; }
        else if (c === '}' || c === ')' || c === ']') {
            if (c === '}' && depth === 0 && top && typeof top === 'object') { depth = stack.pop().saved; i++; prevSig = 'a'; continue; }
            depth--;
            if (depth === 0 && c === '}' && seenBrace && !untilSemicolon) return i + 1;
        } else if (c === ';' && depth === 0 && untilSemicolon) return i + 1;
        if (!/\s/.test(c)) { if (/[a-z0-9_$]/i.test(c)) { let j = i; while (/[a-z0-9_$]/i.test(src[j])) j++; prevSig = src.slice(i, j); i = j; continue; } prevSig = c; }
        i++;
    }
    throw new Error('끝을 못 찾음 @' + start);
}
function grab(src, name) {
    const fnRe = new RegExp('^(async\\s+)?function\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'm');
    let m = fnRe.exec(src);
    if (m) return src.slice(m.index, scanEnd(src, m.index, false));
    const vRe = new RegExp('^(const|let)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=', 'm');
    m = vRe.exec(src);
    if (m) return src.slice(m.index, scanEnd(src, m.index, true));
    return null;
}
const COMMON = ['QNA_TAIL', 'QNA_PII_WHITELIST', 'qnaPiiCheck', 'naverMaskContact', 'qnaStoreData', 'QNA_FILTER_STOPWORDS', 'QNA_STORE_FALLBACK', 'qnaFilterStoreLines', 'qnaRenderPlaceholders',
    'qnaGenerate', 'inquiryGenerate', 'naverPostQnaAnswer', 'naverPostInquiryAnswer', 'qnaDoneBlock', 'qnaStaffBlock', 'redHead', 'tgMd', 'collectInquiry', 'collectQna'];
const NEW_ONLY = ['BIZ_INQ_DEFAULTS', 'BIZ_PRICE_CORE_RE', 'BIZ_PRICE_EXCLUDES', 'BIZ_MONEY_RE', 'bizInqHasMoney', 'bizInqIsPrice', 'bizInqMissing', 'bizInqOtherScenario', '_bizInqCfg', 'bizInqCfg',
    'qnaStoreDataBiz', 'BIZ_INQ_SYSTEM_NOTE', 'bizRegMs', 'bizInqStartMs', 'inqRowBiz', 'collectInquiryStore', 'collectQnaStore'];

// ── 가짜 세상 ──
const NOWISO = new Date().toISOString();
const kst = ms => new Date(ms + 9 * 3600e3).toISOString().replace('Z', '+09:00');
function world(o) {
    o = o || {};
    const W = { calls: [], tg: [], blocks: [], gens: [], sys: [], cfg: Object.assign({}, o.cfg || {}), inq: new Map(), qna: new Map(), sql: [], bizAlert: [] };
    const now = Date.now();
    const DATA = {
        main: { inq: [{ inquiryNo: 501, category: '상품', title: '배송 문의', inquiryContent: '언제 와요?', productName: '제주 감귤', inquiryRegistrationDateTime: kst(now - 60e3), answered: false }],
            qna: [{ questionId: 901, productName: '제주 감귤', question: '보관은 어떻게?', createDate: kst(now - 60e3), answered: false }] },
        biz: { inq: (o.bizInq || []), qna: (o.bizQna || []) },
    };
    const naverCallWithRetry = async (req) => {
        W.calls.push(JSON.parse(JSON.stringify(req)));
        const st = req.store === 'biz' ? 'biz' : 'main';
        if (st === 'biz' && o.bizThrow && req.method === 'GET') { const e = new Error('naver_relay_error_500'); e.status = 500; throw e; }
        if (req.method === 'GET' && /pay-user\/inquiries$/.test(req.path)) return { data: { content: DATA[st].inq, totalElements: DATA[st].inq.length, totalPages: 1 } };
        if (req.method === 'GET' && /contents\/qnas$/.test(req.path)) return { data: { contents: DATA[st].qna, totalElements: DATA[st].qna.length, totalPages: 1 } };
        return { data: {} };
    };
    const pool = { query: async (sql, p) => {
        const s = String(sql).replace(/\s+/g, ' ').trim(); W.sql.push(s);
        let m;
        if (/^INSERT INTO naver_inquiries/.test(s)) { const id = String(p[0]); const had = W.inq.has(id); if (!had) W.inq.set(id, { answered: p[2], store: /'biz'/.test(s) ? 'biz' : null }); return { rows: [{ inserted: !had }] }; }
        if (/^INSERT INTO naver_qnas/.test(s)) { const id = String(p[0]); const had = W.qna.has(id); if (!had) W.qna.set(id, { answered: p[2], store: /'biz'/.test(s) ? 'biz' : null }); return { rows: [{ inserted: !had }] }; }
        if (/FROM naver_qnas WHERE question_id/.test(s)) { const r = W.qna.get(String(p[0])); return { rows: r ? [{ answered: r.answered, posted_at: r.posted_at || null, store: r.store }] : [] }; }
        if (/FROM naver_inquiries WHERE inquiry_id/.test(s)) { const r = W.inq.get(String(p[0])); return { rows: r ? [{ answered: r.answered, posted_at: r.posted_at || null, store: r.store }] : [] }; }
        if ((m = /^UPDATE naver_(qnas|inquiries) SET answered=true/.exec(s))) { const r = (m[1] === 'qnas' ? W.qna : W.inq).get(String(p[0])); if (r) r.posted_at = 'x'; return { rows: [] }; }
        if (/FROM bot_products/.test(s)) return { rows: [{ name: '제주 감귤 5kg', status: '판매중', price: '31,800원' }, { name: '황금향 3kg', status: '판매중', price: '29,800원' }] };
        return { rows: [] };
    } };
    class Anthropic { constructor() {} get messages() { return { create: async (req) => { W.sys.push(req.system.map(b => b.text).join('\n----\n')); const q = req.messages[0].content; W.gens.push(q); const text = /금액답/.test(q) ? '사용시나리오: 보관\n안녕하세요 고객님 🍊 이 상품은 12,800원이에요' : /SKIPME/.test(q) ? 'SKIP' : '사용시나리오: 보관\n안녕하세요 고객님, 제주아꼼이네입니다 🍊\n서늘한 곳에 보관해 주세요.\n{{가격표}}'; return { stop_reason: 'end_turn', content: [{ type: 'text', text }] }; } }; } }
    const ctx = {
        console: { log() {}, error() {} }, setTimeout: (f) => setTimeout(f, 0), Promise, Date, JSON, Math, Map, Set, Object, Array, String, Number, Error, RegExp, parseInt, isNaN, process: { env: { ANTHROPIC_API_KEY: 'x' } },
        require: (p) => p === './qna-memo-note.js' ? { QNA_MEMO_NOTE: 'MEMO', INQUIRY_MEMO_BLOCK: 'MEMOBLK' } : require(p),
        pool, naverCallWithRetry, Anthropic, QNA_MODEL: 'm',
        naverCfgGet: async k => (k in W.cfg ? JSON.parse(JSON.stringify(W.cfg[k])) : null),
        naverCfgSet: async (k, v) => { W.cfg[k] = JSON.parse(JSON.stringify(v)); },
        naverBizCfg: async () => ({ on: !!o.bizOn }),
        naverBizAlert: async t => { W.bizAlert.push(t); return true; },
        notifyTelegram: async t => { W.tg.push(String(t)); },
        tgSendBlocks: async b => { W.blocks.push(...b.map(x => JSON.stringify(x))); },
        tgBlock: (head, fields, tail, sub) => ({ head: typeof head === 'string' ? head : head.html, fields, tail, sub }),
        tgEsc: s => String(s), alertQuietFor: async () => false, alertEnabled: async () => true, writeAudit: async () => {},
        qnaClaimStaff: () => '', needsMemo: () => false, invoiceReq: () => false, ADDR_CHANGE_RE: /^\b$/, CLAIM_WORD_RE: /취소|반품|환불|교환/,
        qnaScenarios: async () => [{ id: 1, name: '보관', keywords: ['보관'], response: 'R' }, { id: 2, name: '가격 문의', keywords: ['가격'], response: 'P' }],
        seasonScenariosToday: async () => [], shippingScenarioToday: async () => [], citrusNamingToday: async () => [], paymentWordingRule: () => [],
        qnaBuildSystem: () => 'SYS-QNA', inquiryBuildSystem: () => 'SYS-INQ', mallMaterial: x => x, mallChannelRule: () => [], MALL_SYSTEM_NOTE: '', mallPostAnswer: a => a,
    };
    return { W, ctx };
}
function load(src, names, o) {
    const { W, ctx } = world(o);
    vm.createContext(ctx);
    const code = names.map(n => { const s = grab(src, n); if (!s) throw new Error('못 찾음: ' + n); return s; }).join('\n\n');
    vm.runInContext(code + '\n;this.__ = { collectInquiry, collectQna, naverPostQnaAnswer, naverPostInquiryAnswer, qnaDoneBlock' + (names.includes('inqRowBiz') ? ', bizInqIsPrice, bizInqHasMoney, bizInqMissing, inqRowBiz' : '') + ' };', ctx);
    return { W, F: ctx.__ };
}
const headLoad = o => load(HEAD_SRC, COMMON, o);
const newLoad = o => load(NEW_SRC, COMMON.concat(NEW_ONLY), o);
const sortedKeys = x => JSON.stringify(x);

(async () => {
    // ① 스위치 꺼짐 = HEAD 와 같은 결과 글·네이버 호출·알림·답 등록
    {
        const h = headLoad(), n = newLoad();
        const a1 = await h.F.collectInquiry(), b1 = await n.F.collectInquiry();
        const a2 = await h.F.collectQna(), b2 = await n.F.collectQna();
        ok('①꺼짐 고객문의 결과 글 같음', a1 === b1, { a1, b1 });
        ok('①꺼짐 상품문의 결과 글 같음', a2 === b2, { a2, b2 });
        ok('①꺼짐 네이버 호출(조회·답 등록) HEAD 와 같음 · store 칸 없음', sortedKeys(h.W.calls) === sortedKeys(n.W.calls) && n.W.calls.every(c => !('store' in c)), { h: h.W.calls.map(c => c.method + ' ' + c.path), n: n.W.calls.map(c => c.method + ' ' + c.path) });
        ok('①꺼짐 텔레그램 블록·알림 HEAD 와 같음', sortedKeys(h.W.blocks) === sortedKeys(n.W.blocks) && sortedKeys(h.W.tg) === sortedKeys(n.W.tg), { h: h.W.blocks, n: n.W.blocks });
        ok('①꺼짐 AI 재료(시스템 블록) HEAD 와 같음', sortedKeys(h.W.sys) === sortedKeys(n.W.sys));
        ok('①꺼짐 자동 답 = 상품문의 1건(고객문의는 inquiry_auto_post 기본 꺼짐 = 🟥 직원 몫 · HEAD 와 같음)', n.W.calls.filter(c => c.method !== 'GET').length === 1 && h.W.calls.filter(c => c.method !== 'GET').length === 1);
    }
    // ② 켜짐 · 첫 실행 = 켜기 전 문의는 저장만(답 0) · 시작 시각 기록
    const now = Date.now();
    const bizInq = [
        { inquiryNo: 7001, category: '상품', title: '가격', inquiryContent: '5kg 얼마예요?', productName: '감귤', inquiryRegistrationDateTime: kst(now - 30e3), answered: false },
        { inquiryNo: 7002, category: '상품', title: '문의', inquiryContent: '한라봉도 파나요?', productName: '감귤', inquiryRegistrationDateTime: kst(now - 30e3), answered: false },
        { inquiryNo: 7003, category: '상품', title: '보관', inquiryContent: '보관은 어떻게 해요?', productName: '감귤', inquiryRegistrationDateTime: kst(now - 30e3), answered: false },
        { inquiryNo: 7004, category: '상품', title: '금액답', inquiryContent: '이거 몇 개 들어있어요', productName: '감귤', inquiryRegistrationDateTime: kst(now - 30e3), answered: false },
        { inquiryNo: 7005, category: '상품', title: '옛 문의', inquiryContent: '보관은요?', productName: '감귤', inquiryRegistrationDateTime: kst(now - 3 * 86400e3), answered: false },
    ];
    const bizQna = [
        { questionId: 8001, productName: '감귤', question: '가격이 얼마인가요?', createDate: kst(now - 30e3), answered: false },
        { questionId: 8002, productName: '감귤', question: '보관 방법 알려주세요', createDate: kst(now - 30e3), answered: false },
    ];
    {
        const n = newLoad({ bizOn: true, bizInq, bizQna });
        const r1 = await n.F.collectInquiry(), r2 = await n.F.collectQna();
        ok('②첫 실행 = 직영몰 답 등록 0 · 저장만 · 시작 시각 기록', n.W.calls.filter(c => c.store === 'biz' && c.method !== 'GET').length === 0 && !!n.W.cfg.naver_biz_inquiry_start && !!n.W.cfg.naver_biz_qna_start
            && [...n.W.inq.values()].filter(x => x.store === 'biz').length === 5, { r1, r2, calls: n.W.calls.map(c => c.method + ' ' + c.path + ' ' + (c.store || '')) });
        ok('②조회 = 직영몰은 store biz 로', n.W.calls.some(c => c.method === 'GET' && c.store === 'biz' && /inquiries/.test(c.path)) && n.W.calls.some(c => c.method === 'GET' && c.store === 'biz' && /qnas/.test(c.path)));
        ok('②결과 글 = 종전 글 · 직영몰 …', /^문의 신규 .* · 직영몰 문의 신규 5/.test(r1) && /^상품문의 신규 .* · 직영몰 상품문의 신규 2/.test(r2), { r1, r2 });
    }
    // ③ 켜짐 · 켠 뒤 문의 = 가격 = 고정 안내 · 없는 품목 = 직원 · 보통 = AI(금액 재료 없음) 직영몰 열쇠 · 금액 섞임 = 등록 안 함 · 켜기 전 문의 = 답 없음
    {
        const startIso = new Date(now - 3600e3).toISOString();
        const n = newLoad({ bizOn: true, bizInq, bizQna, cfg: { naver_biz_inquiry_start: startIso, naver_biz_qna_start: startIso, inquiry_auto_post: 'on' } });
        await n.F.collectInquiry(); await n.F.collectQna();
        const posts = n.W.calls.filter(c => c.method !== 'GET');
        const postOf = id => posts.find(c => c.path.includes('/' + id));
        const p7001 = postOf(7001), p7003 = postOf(7003), p8001 = postOf(8001), p8002 = postOf(8002);
        ok('③가격 질문(고객문의 7001) = 고정 안내 · 직영몰 열쇠 · 금액 0', p7001 && p7001.store === 'biz' && /상품 화면의 옵션/.test(p7001.body.answerComment) && !/\d\s*원/.test(p7001.body.answerComment), p7001);
        ok('③가격 질문(상품문의 8001) = 고정 안내 · 직영몰 열쇠', p8001 && p8001.store === 'biz' && /상품 화면의 옵션/.test(p8001.body.commentContent), p8001);
        ok('③없는 품목(한라봉 7002) = 등록 0 · 🟥 직영몰 · 없는 상품', !postOf(7002) && n.W.blocks.some(b => /직영몰 고객문의\(직영몰 · 없는 상품 문의\)/.test(b) && /한라봉/.test(b)), n.W.blocks);
        ok('③보통 문의(7003·8002) = AI 답 · 직영몰 열쇠', p7003 && p7003.store === 'biz' && p8002 && p8002.store === 'biz');
        const bizSys = n.W.sys.filter(s => /직영몰\(사업자몰\) 문의/.test(s)), mainSys = n.W.sys.filter(s => !/직영몰\(사업자몰\) 문의/.test(s));
        ok('③직영몰 AI 재료 = 가격 괄호 없음 · 직영몰 안내 블록(3건 = 7003·7004·8002) · 스마트스토어 재료는 가격 그대로', bizSys.length === 3 && bizSys.every(s => !/31,800원|29,800원/.test(s)) && mainSys.length >= 1 && mainSys.every(s => /31,800원/.test(s)), { biz: bizSys.length, main: mainSys.length });
        ok('③{{가격표}} = 고정 안내(금액 0)', /상품 화면의 옵션/.test(p7003.body.answerComment) && !/31,800/.test(p7003.body.answerComment), p7003.body);
        ok('③금액 섞인 AI 답(7004) = 등록 0 · 🟥 「봇 답에 금액」', !postOf(7004) && n.W.blocks.some(b => /봇 답에 금액/.test(b)), n.W.blocks);
        ok('③켜기 전 문의(7005) = 답 없음 · 알림 없음', !postOf(7005) && !n.W.blocks.some(b => /옛 문의/.test(b)));
        ok('③🟦🟩 답변완료 머리에 「직영몰」', n.W.blocks.some(b => /🟦 직영몰 고객문의\(주문문의\) · 답변완료/.test(b)) && n.W.blocks.some(b => /🟩 직영몰 상품문의 · 답변완료/.test(b)), n.W.blocks.map(b => b.slice(0, 80)));
        ok('③스마트스토어 문의(501·901) 답 = store 칸 없음', !('store' in postOf(501)) && !('store' in postOf(901)));
        ok('③스마트스토어 블록 머리 = 종전 글자', n.W.blocks.some(b => /"head":"🟦 고객문의\(주문문의\) · 답변완료"/.test(b)) && n.W.blocks.some(b => /"head":"🟩 상품문의 · 답변완료"/.test(b)));
    }
    // ④ 직영몰 조회 실패 = 스마트스토어 결과 그대로 + 직영몰 알림(30분 1통은 naverBizAlert 가 맡음)
    {
        const h = headLoad(), n = newLoad({ bizOn: true, bizThrow: true });
        const a = await h.F.collectInquiry(), b = await n.F.collectInquiry();
        ok('④직영몰 실패 = 스마트스토어 몫 같음 · 「직영몰 실패」 꼬리 · 알림 1', b.startsWith(a + ' · 직영몰 실패') && n.W.bizAlert.length === 1 && /직영몰 고객문의 수집 실패/.test(n.W.bizAlert[0]), { a, b, al: n.W.bizAlert });
    }
    // ⑤ 수기 등록(문의 관리·손님 연락 창) = 줄의 store 로 · 직원 글의 {{가격표}} 도 직영몰 판
    {
        const n = newLoad();
        n.W.qna.set('8100', { answered: false, store: 'biz' }); n.W.inq.set('7100', { answered: false, store: 'biz' }); n.W.qna.set('900', { answered: false, store: null });
        await n.F.naverPostQnaAnswer(8100, '안내 {{가격표}}', { name: '직원' });
        await n.F.naverPostInquiryAnswer(7100, '안내드려요', { name: '직원' });
        await n.F.naverPostQnaAnswer(900, '스마트스토어 {{가격표}}', { name: '직원' });
        const c = n.W.calls;
        ok('⑤직영몰 상품문의 수기 = store biz · {{가격표}} = 고정 안내', c[0].store === 'biz' && /상품 화면의 옵션/.test(c[0].body.commentContent) && !/31,800/.test(c[0].body.commentContent), c[0]);
        ok('⑤직영몰 고객문의 수기 = store biz', c[1].store === 'biz');
        ok('⑤스마트스토어 수기 = store 없음 · {{가격표}} = 종전(가격)', !('store' in c[2]) && /31,800원/.test(c[2].body.commentContent), c[2]);
        ok('⑤손님 연락 초안 = 줄로 직영몰 판정(inqRowBiz)', (await n.F.inqRowBiz('qna', '8100')) === true && (await n.F.inqRowBiz('qna', '900')) === false && (await n.F.inqRowBiz('inquiry', '')) === false);
    }
    // ⑥ 판정 함수 = 톡톡봇 biz-store.js 와 같은 답(같은 입력)
    {
        const n = newLoad();
        let bs = null; try { bs = require(path.join(ROOT, '..', '★제주아꼼이네 톡톡봇', 'biz-store.js')); } catch (_) { bs = null; }
        const cases = ['5kg 얼마예요?', '가격 알려주세요', '환불 금액이 언제', '얼마나 걸려요', '배송비 얼마', '12,800원이에요', '원하시면', '한라봉 있나요', '레드키위 품절?', '키위', '오렌지색 상자', '레몬못난이', '1,000박스'];
        if (bs) {
            const diff = cases.filter(t => n.F.bizInqIsPrice(t) !== bs.isPriceQuestion(t) || n.F.bizInqHasMoney(t) !== bs.hasMoney(t) || JSON.stringify(n.F.bizInqMissing(t, bs.DEFAULTS.missing_words)) !== JSON.stringify(bs.missingItems(t)));
            ok('⑥판정 13가지 = 톡톡봇 biz-store.js 와 같음(읽기만 · 그 저장소 무접촉)', diff.length === 0, diff);
        } else ok('⑥톡톡봇 biz-store.js 를 못 찾음(비교 건너뜀)', true);
    }
    // ⑦ #1203-2 직영몰 상품 쓰기(러너 「#720-B」 떼어 실행 · 가짜 pool·네이버 = verify-720-write.js 것 · 실호출 0)
    {
        const a = NEW_SRC.indexOf('// #720-B 시작'), b = NEW_SRC.indexOf('// #720-B 끝');
        const ah = HEAD_SRC.indexOf('// #720-B 시작'), bh = HEAD_SRC.indexOf('// #720-B 끝');
        const modN = new Function(NEW_SRC.slice(a, b) + '\nreturn { naverProductWriteRun };')();
        const modH = new Function(HEAD_SRC.slice(ah, bh) + '\nreturn { naverProductWriteRun };')();
        const v720 = fs.readFileSync(path.join(__dirname, 'verify-720-write.js'), 'utf8');
        const FV = new Function(v720.slice(v720.indexOf('// ── 가짜 pool'), v720.indexOf('const PRODUCT = {')) + '\nreturn { fakePool, fakeNaver, CH };')();
        const PRODUCT = { originProduct: { statusType: 'SALE', name: '시험 감귤', stockQuantity: 50, salePrice: 10000, detailContent: '<p>첫 줄</p>',
            images: { representativeImage: { url: 'https://x/1.jpg' }, optionalImages: [] }, detailAttribute: { optionInfo: { optionCombinations: [{ id: 1, optionName1: 'A', price: 0, stockQuantity: 50, usable: true }] } } },
            smartstoreChannelProduct: { channelProductDisplayStatusType: 'ON', naverShoppingRegistration: true } };
        const ORDERS = [{ id: 101, status: '처리중', is_deleted: false, created_by_id: 1, role: 'admin', position: '대표' }];
        const quiet = async fn => { const o = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = o; console.log = l; } };
        const mk = (ready, product) => { const db = FV.fakePool(ORDERS), nv = FV.fakeNaver(product || PRODUCT), seen = [];
            return { db, nv, seen, deps: { pool: db, audit: async () => {}, gapMs: 0, convertImageLinks: h => ({ html: h, converted: 0 }), bizReady: async () => ready !== false,
                call: async r => { seen.push(JSON.parse(JSON.stringify(r))); const { store, ...rest } = r; return nv.call(rest); } } }; };
        const flow = async (mod, store, ready) => { const w = mk(ready); const st = store ? { store } : {};
            const b1 = await quiet(() => mod.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, ...st }, w.deps));
            const a1 = b1.ok ? await quiet(() => mod.naverProductWriteRun({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { status: 'SUSPENSION' }, ...st }, w.deps)) : null;
            const r1 = b1.ok ? await quiet(() => mod.naverProductWriteRun({ op: 'revert', order_id: 101, backup_id: b1.backup_id, ...st }, w.deps)) : null;
            return { w, b1, a1, r1 }; };
        const h = await flow(modH, null), n = await flow(modN, null);
        ok('⑦store 없음 = HEAD 와 같은 네이버 호출(backup·apply·revert) · store 칸 0', JSON.stringify(h.w.seen) === JSON.stringify(n.w.seen) && n.w.seen.every(c => !('store' in c)) && n.b1.ok && n.a1.ok && n.r1.ok, { h: h.w.seen.length, n: n.w.seen.length, b: n.b1, a: n.a1 && n.a1.error });
        ok('⑦store 없음 = 결과 꼴 HEAD 와 같음(store 칸 없음)', !('store' in n.b1) && JSON.stringify(Object.keys(h.b1)) === JSON.stringify(Object.keys(n.b1)));
        const z = await flow(modN, 'biz');
        ok('⑦store biz = 모든 호출에 store biz · 같은 호출 수 · backup·apply·revert 성공', z.w.seen.length === n.w.seen.length && z.w.seen.every(c => c.store === 'biz') && z.b1.ok && z.a1.ok && z.r1.ok, { b: z.b1, a: z.a1 && z.a1.error, r: z.r1 && z.r1.error });
        ok('⑦store biz = 보관본 행 store biz', z.w.db.backups.length && z.w.db.backups.every(r => r.store === 'biz'));
        // 엇갈림: 스마트스토어 보관본을 store biz 로 apply · 직영몰 보관본을 store 없이 apply · 같은 번호를 다른 스토어로 backup
        {
            const w = mk(); const b1 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH }, w.deps)); const before = w.seen.length;
            const x1 = await quiet(() => modN.naverProductWriteRun({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { status: 'SUSPENSION' }, store: 'biz' }, w.deps));
            const x2 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, store: 'biz' }, w.deps));
            ok('⑦엇갈림(스마트스토어 보관본 ↔ store biz) = 호출 0 · 오류', !x1.ok && /스토어가 달라요/.test(x1.error) && !x2.ok && /앞 보관본은 스마트스토어/.test(x2.error) && w.seen.length === before, { x1, x2 });
        }
        {
            const w = mk(); const b1 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, store: 'biz' }, w.deps)); const before = w.seen.length;
            const y1 = await quiet(() => modN.naverProductWriteRun({ op: 'revert', order_id: 101, backup_id: b1.backup_id }, w.deps));
            ok('⑦엇갈림(직영몰 보관본 ↔ store 없음) = 호출 0 · 오류', !y1.ok && /스토어가 달라요/.test(y1.error) && w.seen.length === before, y1);
        }
        {
            const w = mk(false);
            const n1 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, store: 'biz' }, w.deps));
            const n2 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, store: 'main' }, w.deps));
            ok('⑦직영몰 열쇠 없음 · store 값 오류 = 호출 0 · 오류', !n1.ok && /직영몰 열쇠/.test(n1.error) && !n2.ok && /'biz' 만/.test(n2.error) && w.seen.length === 0, { n1, n2 });
        }
        // ⑧ A/S 안내 글 한 칸(patch.after_service_guide) = 그 칸만 바뀜 · 전화 칸 그대로 · 되읽기 대조 · 되돌리기 · 직영몰도 같음
        for (const store of [null, 'biz']) {
            const P2 = JSON.parse(JSON.stringify(PRODUCT)); P2.originProduct.detailAttribute.afterServiceInfo = { afterServiceTelephoneNumber: '064-805-9181', afterServiceGuideContent: '옛 안내 글' };
            const w = mk(true, P2), st = store ? { store } : {};
            const before = JSON.parse(JSON.stringify(w.nv.product || P2));
            const b1 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, ...st }, w.deps));
            const a1 = await quiet(() => modN.naverProductWriteRun({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { after_service_guide: '새 안내 글' }, ...st }, w.deps));
            const now = JSON.parse(JSON.stringify(w.nv.product));
            const as = now.originProduct.detailAttribute.afterServiceInfo;
            const norm = o => { const c = JSON.parse(JSON.stringify(o)); c.originProduct.detailAttribute.afterServiceInfo.afterServiceGuideContent = 'X'; return JSON.stringify(c); };
            ok(`⑧${store || '스마트스토어'} A/S 안내 apply = 그 칸만 바뀜 · 전화 그대로 · 대조 통과(남은 칸 0)`, a1.ok && as.afterServiceGuideContent === '새 안내 글' && as.afterServiceTelephoneNumber === '064-805-9181' && norm(now) === norm(before) && (a1.residual_paths || []).length === 0, { a1: a1.ok ? { residual: a1.residual_paths, not: a1.not_applied } : a1 });
            const r1 = await quiet(() => modN.naverProductWriteRun({ op: 'revert', order_id: 101, backup_id: b1.backup_id, ...st }, w.deps));
            ok(`⑧${store || '스마트스토어'} A/S 안내 revert = 옛 글로`, r1.ok && w.nv.product.originProduct.detailAttribute.afterServiceInfo.afterServiceGuideContent === '옛 안내 글', r1);
            const b2 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, ...st }, w.deps));
            const bad = await quiet(() => modN.naverProductWriteRun({ op: 'apply', order_id: 101, backup_id: b2.backup_id, patch: { after_service_guide: ' 앞빈칸' }, ...st }, w.deps));
            ok(`⑧${store || '스마트스토어'} A/S 안내 앞뒤 빈칸 = 거절`, !bad.ok && /A\/S 안내 글/.test(bad.error), bad);
        }
        // ⑨ 이번에 보낼 꼴 = 상세 + A/S 안내 + seo(페이지 제목·태그) 한 apply(직영몰) · 세 칸만 바뀌고 대조 통과
        {
            const P3 = JSON.parse(JSON.stringify(PRODUCT)); P3.originProduct.detailAttribute.afterServiceInfo = { afterServiceTelephoneNumber: '064-805-9181', afterServiceGuideContent: '옛 안내' };
            P3.originProduct.detailAttribute.seoInfo = { pageTitle: '옛 제목', sellerTags: [{ text: '옛태그' }] };
            const w = mk(true, P3), st = { store: 'biz' };
            const b1 = await quiet(() => modN.naverProductWriteRun({ op: 'backup', order_id: 101, product_no: FV.CH, ...st }, w.deps));
            const a1 = await quiet(() => modN.naverProductWriteRun({ op: 'apply', order_id: 101, backup_id: b1.backup_id, patch: { detail_html: '<p>새 상세</p>', after_service_guide: '새 안내', seo: { page_title: '새 제목', seller_tags: [{ text: '감귤' }, { text: '직영몰' }] } }, ...st }, w.deps));
            const da = w.nv.product.originProduct.detailAttribute;
            ok('⑨상세+A/S+seo 한 apply(직영몰) = 세 칸 반영 · 전화 그대로 · 대조 통과 · 호출 전부 store biz', a1.ok && (a1.residual_paths || []).length === 0 && da.afterServiceInfo.afterServiceGuideContent === '새 안내' && da.afterServiceInfo.afterServiceTelephoneNumber === '064-805-9181'
                && da.seoInfo.pageTitle === '새 제목' && /새 상세/.test(w.nv.product.originProduct.detailContent) && w.seen.every(c => c.store === 'biz'), a1.ok ? { residual: a1.residual_paths } : a1);
        }
    }
    console.log(`\n#1202 검증: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 스크립트 오류:', e); process.exit(2); });

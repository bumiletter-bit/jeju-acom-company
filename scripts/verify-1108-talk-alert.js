// #1108-D 검증 — 텔레그램 톡톡 알림(한 줄 머리 · 메모 낱말 · 주소 변경 🟧) + 고객문의 지시문 주소 4줄
//   실행: node scripts/verify-1108-talk-alert.js [--real]   (기본 = DB·네트워크 0 · --real = 실DB message_logs 30일 손님 글 SELECT 만 해 옛/새 needsMemo·talkPick 차이 목록)
//   HEAD 의 server.js 와 지금 server.js 에서 「const TALKTALK_REQUEST_RE」 ~ talkBlock 끝 구간을 떼어 같은 입력으로 돌려 비교한다.
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 500) : '')); };
const norm = s => s.replace(/\r\n/g, '\n');
function region(src) {
    const s = norm(src); const a = s.indexOf('const TALKTALK_REQUEST_RE'); const b0 = s.indexOf('function talkBlock(', a); const b = s.indexOf('\n}\n', b0) + 2;
    if (a < 0 || b0 < 0) throw new Error('구간 없음');
    return new Function('notifyTelegram', s.slice(a, b) + '\nreturn { needsMemo, talkPick, talkBlock, tgBlock, qnaDoneBlock, TALKTALK_REQUEST_RE };')(async () => 'sent');
}
function pickFn(src, head) { const s = norm(src); const i = s.indexOf(head); return s.slice(i, s.indexOf('\n}\n', i) + 2); }
(async () => {
    const oldSrc = execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
    const newSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const O = region(oldSrc), N = region(newSrc);

    console.log('① 지시문');
    ok(pickFn(oldSrc, 'function qnaBuildSystem(') === pickFn(newSrc, 'function qnaBuildSystem('), '상품문의 공용 qnaBuildSystem = 바이트 같음(문자·자사몰·톡톡 초안 무변경)');
    const io = pickFn(oldSrc, 'function inquiryBuildSystem('), inw = pickFn(newSrc, 'function inquiryBuildSystem(');
    const dl = (a, b) => { const A = a.split('\n'), B = b.split('\n'); return { gone: A.filter(l => !B.includes(l)), added: B.filter(l => !A.includes(l)) }; };
    const d = dl(io, inw);
    ok(d.gone.length === 2 && d.added.length === 4 && d.added.includes("${require('./qna-memo-note.js').INQUIRY_MEMO_BLOCK}") && d.gone.every(l => /^- (고객이 변경 정보|"변경해드렸습니다")/.test(l)) && d.added.some(l => /^- 배송지 변경\(#1108/.test(l)) && d.added.some(l => /^- 옵션·연락처 변경, 취소 등 그 밖의 요청/.test(l)) && d.added.some(l => /^- 어느 경우든 "변경해드렸습니다"/.test(l)), '고객문의 지시문 = 주소 4줄 자리 + 메모 확답 절 1줄(require)만 바뀜', JSON.stringify(d));
    { const M = require(path.join(ROOT, 'qna-memo-note.js')); ok(/^## 메모로 처리하는 요청 \(#1108/.test(M.INQUIRY_MEMO_BLOCK) && /^## 메모로 처리하는 요청 — 상품문의/.test(M.QNA_MEMO_NOTE) && /가정용 귤 로얄과/.test(M.RULES) && /선물용 만감류/.test(M.RULES) && /7일 이내/.test(M.RULES) && /배송메세지/.test(M.RULES) && /주소를 남기라고 하지 마세요/.test(M.QNA_MEMO_NOTE) && !/주소를 남기라고/.test(M.INQUIRY_MEMO_BLOCK), '메모 확답 규칙 글(사이즈·과수·7일·주문 전 · 상품문의만 공개 게시판 주소 줄)'); }
    ok(/새 주소가 글에 다 있으면/.test(inw) && /말씀하신 새 주소로 변경해드리겠습니다/.test(inw) && !/○○\(새 주소\)/.test(inw) && /확인 후 변경해드릴게요/.test(inw) && /주문자 성함만 남겨 주시면/.test(require(path.join(ROOT, 'qna-memo-note.js')).QNA_MEMO_NOTE) && !/주문자 성함만/.test(require(path.join(ROOT, 'qna-memo-note.js')).INQUIRY_MEMO_BLOCK) && /발송 준비가 끝난 뒤라면/.test(require(path.join(ROOT, 'qna-memo-note.js')).RULES) && /발송 휴무일과 겹치면/.test(require(path.join(ROOT, 'qna-memo-note.js')).RULES) && /되나요·가능한가요/.test(require(path.join(ROOT, 'qna-memo-note.js')).RULES) && /완료를 단정하는 표현은 절대 금지/.test(inw), '고객문의 = 주소 복창 없이 확답 · 빠진 것만 「확인 후」 · 완료형 금지 · 상품문의만 「주문자 성함」 길 · G2 꼬리·휴무일·되나요 꼴');

    { // #1073 꼴 = 줄 끝 주석이 뒤 코드를 삼킴(주석 안에 「).foo(」 나 끝 「;」 가 있으면 의심)
      const added = execSync('git diff -U0 HEAD -- server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      const bad = added.filter(l => { const i = l.search(/\s\/\/\s/); if (i < 0) return false; const c = l.slice(i); return /\)\s*\.\w+\(|;\s*$/.test(c); });
      ok(bad.length === 0, '#1073 꼴 = 줄 끝 주석 뒤 코드 0(server.js 새 줄 ' + added.length + ')', bad.join('\n')); }
    console.log('② tgBlock · 다른 알림 바이트');
    ok(O.tgBlock('머리', [['a', 'b<c'], ['d', 'e&f']], '꼬리') === N.tgBlock('머리', [['a', 'b<c'], ['d', 'e&f']], '꼬리') && O.qnaDoneBlock('상품문의', 'p', '당도 어때요', 'a') === N.qnaDoneBlock('상품문의', 'p', '당도 어때요', 'a') && O.qnaDoneBlock('고객문의', '', '언제 와요', 'a') === N.qnaDoneBlock('고객문의', '', '언제 와요', 'a'), '손댈 것 없는 🟩🟦 알림·sub 없는 tgBlock = 바이트 같음');
    { const a = N.qnaDoneBlock('상품문의', '타이벡', '이미 주문했는데 S사이즈로 부탁드려요', '네 지정해드리겠습니다'); ok(a.startsWith('🟥 <b>메모 필요</b> · 상품문의 답변완료\n\n<b>상품:</b> 타이벡') && a.endsWith('<b>→ 에이전트 오피스 › 발주 메모함에 넣기</b>'), '🟩 → 🟥 메모 필요 · 상품문의 답변완료 + 꼬리 굵게', a); }
    { const a = N.qnaDoneBlock('고객문의', '', '배송지 변경해 주세요 서울 마포구 1-2', '네 변경해드리겠습니다'); ok(a.startsWith('🟥 <b>메모 필요</b> · 고객문의 답변완료\n\n') && a.endsWith('<b>→ 배송지 수정</b>'), '🟦 주소 변경 → 🟥 메모 필요 · 고객문의 답변완료 + 「→ 배송지 수정」', a); }
    { const a = N.qnaDoneBlock('고객문의', '', '주소 변경 말고 취소할게요', 'x'); ok(a.startsWith('<b>🟦 고객문의(주문문의) · 답변완료</b>'), '취소 말 섞인 주소 글 = 종전 🟦'); }
    ok(N.tgBlock('머리', [['a', 'b']], '', '톡톡 #1 · 11/11 09:05') === '<b>머리</b>\n톡톡 #1 · 11/11 09:05\n\n<b>a:</b> b', 'sub = 머리 바로 아래 보통 글 한 줄');

    console.log('③ 판정·머리 줄');
    const R = (message, bot_response, o = {}) => Object.assign({ id: 5821, message, bot_response, staff_response: null, staff_at: null }, o);
    const meta = { id: 5821, at: '11/11 09:05', item: '타이벡감귤' };
    // 종전과 같은 판정(meta 빼면 글 바이트도 같음)
    const SAME = [R('귤 언제와요?', '[SKIP-무응답]'), R('S사이즈로 보내 주세요', '네 S사이즈로 지정해드리겠습니다!'), R('주문 취소 가능할까요', '확인 후 도와드리겠습니다'), R('감사합니다', '[SKIP-무응답]'), R('주소 변경하고 싶어요', '[SKIP-무응답]'), R('주소 바꾸고 취소도 할래요', '확인해 볼게요'), R('파손됐어요', '[쿨다운-무응답]')];
    for (const x of SAME) { const po = O.talkPick(x), pn = N.talkPick(x); ok(JSON.stringify(po) === JSON.stringify(pn), '판정 종전 그대로: ' + x.message + ' / ' + x.bot_response, JSON.stringify([po, pn])); }
    { const x = R('귤 언제와요?', '[SKIP-무응답]'); const t = N.talkBlock('톡톡', N.talkPick(x), x.message, x.bot_response); ok(t === '🟥 <b>확인 필요</b> · 톡톡(봇이 답 못함)\n\n<b>손님:</b> 귤 언제와요?', '🟨 → 🟥 확인 필요 · 톡톡(봇이 답 못함)', t); }
    { const x = R('주문 취소 가능할까요', '확인 후 도와드리겠습니다'); const t = N.talkBlock('톡톡', N.talkPick(x), x.message, x.bot_response); ok(/^🟥 <b>확인 필요<\/b> · 톡톡\(봇 답함 · 처리 필요\)\n\n<b>손님:<\/b> 주문 취소 가능할까요\n\n<b>봇:<\/b> 확인 후/.test(t), '요청형 + 봇 답 = 🟥 확인 필요 · 톡톡(봇 답함 · 처리 필요) + 봇 줄', t); }
    // 주소 변경 + 봇이 답함 = 🟧 + 「→ 배송지 수정」
    { const x = R('배송지를 서귀포시 화순로 101 3동 202호로 변경해 주세요', '네 서귀포시 화순로 101 3동 202호로 변경해드리겠습니다!'); const po = O.talkPick(x), pn = N.talkPick(x); const t = N.talkBlock('톡톡', pn, x.message, x.bot_response, meta);
      ok(po && po.mode === 'staff' && pn && pn.mode === 'memo' && pn.addr === true && /^🟥 <b>메모 필요<\/b> · 톡톡 답변완료\n톡톡 #5821 · 11\/11 09:05 · 타이벡감귤\n\n<b>손님:<\/b>/.test(t) && /<b>→ 배송지 수정<\/b>$/.test(t), '주소 변경 + 봇 답함 = 🟥 메모 필요 · 꼬리 「→ 배송지 수정」 굵게 · 「톡톡 #번호」 줄 머리 아래', t); }
    { const x = R('주소 변경해 주세요 그리고 13과로 부탁해요', '네 확인해서 도와드리겠습니다!'); const pn = N.talkPick(x); const t = N.talkBlock('톡톡', pn, x.message, x.bot_response, meta);
      ok(pn && pn.mode === 'memo' && /<b>→ 배송지 수정\n→ 에이전트 오피스 › 발주 메모함에 넣기<\/b>$/.test(t), '주소 + 메모 거리 = 꼬리 두 줄', t); }
    { const x = R('주소 변경해 주세요', '[SKIP-무응답]'); const pn = N.talkPick(x); ok(pn && pn.mode === 'staff' && !pn.addr, '주소 변경 + 봇 못 답함 = 종전 🟨'); }
    { const x = R('귤 언제와요?', '[SKIP-무응답]'); const t = N.talkBlock('카카오', N.talkPick(x), x.message, x.bot_response, { id: 9, at: '1/2 18:30', item: '기타' }); ok(/^🟥 <b>확인 필요<\/b> · 카카오\(봇이 답 못함\)\n카카오 #9 · 1\/2 18:30\n\n/.test(t), '머리 줄 = 상품 「기타」면 뺌', t); }
    // 메모 낱말
    const MEMO_NEW = ['보내는 분 김철수로 해 주세요', '보내는 사람 변경 부탁드려요', '보내는이 홍길동으로', '철수 드림으로 보내주세요', '금요일 도착으로 부탁해요', '월요일에 발송해 주세요', '토요일 도착 희망해요', '수욜 발송 부탁드립니다'];
    for (const m of MEMO_NEW) ok(!O.needsMemo(m) && N.needsMemo(m), '새 메모 낱말: ' + m);
    const MEMO_NO = ['보내는 사람 이름 나오나요?', '금요일 도착했어요', '월요일 받았어요', '배송 금요일 정도 걸리나요', '주소 알려주세요', '드림 감사합니다', '금요일에 도착할까요?', '지금 주문하면 토요일에 받지는 못하지요?'];
    for (const m of MEMO_NO) ok(!N.needsMemo(m), '메모 아님: ' + m);
    ok(N.needsMemo('S사이즈로 보내 주세요') && N.needsMemo('12일 발송해 주세요') && !N.needsMemo('S사이즈 몇 개 들어가요?'), '종전 메모 낱말 그대로');

    // ④ 실DB 30일 손님 글로 옛/새 차이(읽기만)
    if (process.argv.includes('--real')) {
        console.log('④ 실DB message_logs 30일(SELECT 만)');
        require('dotenv').config({ path: path.join(ROOT, '.env') });
        const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        const rows = (await pool.query(`SELECT id, user_id, message, bot_response, staff_response, staff_at FROM message_logs WHERE received_at > NOW() - interval '30 days' AND bot_response IS NOT NULL AND bot_response NOT IN ('[직원응답]','[직원 직접답변]') ORDER BY id`)).rows;
        await pool.end();
        let memoDiff = [], pickDiff = [];
        for (const x of rows) {
            if (O.needsMemo(x.message) !== N.needsMemo(x.message)) memoDiff.push(x.id + ' ' + String(x.message).replace(/\s+/g, ' ').slice(0, 70));
            const a = O.talkPick(x), b = N.talkPick(x); if (JSON.stringify(a) !== JSON.stringify(b)) pickDiff.push(x.id + ' ' + (a ? a.mode : '-') + '→' + (b ? b.mode + (b.addr ? '+주소' : '') : '-') + ' ' + String(x.message).replace(/\s+/g, ' ').slice(0, 60));
        }
        console.log(`  줄 ${rows.length} · needsMemo 바뀜 ${memoDiff.length} · 알림 판정 바뀜 ${pickDiff.length}`);
        memoDiff.forEach(s => console.log('   메모 ' + s)); pickDiff.forEach(s => console.log('   판정 ' + s));
        ok(memoDiff.every((s, i) => true), '차이 목록 출력(사람이 읽고 판단)');
    }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

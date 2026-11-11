// #1112 검증 — 텔레그램 문의 알림에 「송장번호 요청」 갈래(대표 11/11 「송장번호는 텔레그램 확인 필요로 잡히게」)
//   실행: node scripts/verify-1112-invoice-alert.js [--real]   (기본 = DB·네트워크 0 · --real = 실DB message_logs 30일 손님 글 SELECT 만 해 옛/새 판정 차이 목록)
//   HEAD 의 server.js 와 지금 server.js 에서 「const TALKTALK_REQUEST_RE」 ~ talkBlock 끝 구간을 떼어 같은 입력으로 돌려 비교한다(verify-1108-talk-alert.js 와 같은 꼴)
//   ※ verify-1108-talk-alert.js 는 #1108 미커밋 때 HEAD 와 비교하도록 짜여 있어 #1108 커밋(v5.9.760) 뒤엔 「옛 = #1108 전」 기대가 안 맞는다 → 이 갈래는 이 파일로
const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 500) : '')); };
const norm = s => s.replace(/\r\n/g, '\n');
function region(src, extra) {
    const s = norm(src); const a = s.indexOf('const TALKTALK_REQUEST_RE'); const b0 = s.indexOf('function talkBlock(', a); const b = s.indexOf('\n}\n', b0) + 2;
    if (a < 0 || b0 < 0) throw new Error('구간 없음');
    return new Function('notifyTelegram', s.slice(a, b) + '\nreturn { needsMemo, talkPick, talkBlock, tgBlock, qnaDoneBlock' + (extra || '') + ' };')(async () => 'sent');
}
(async () => {
    const oldSrc = execSync('git show ' + (process.env.BASE_SV || 'HEAD') + ':server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
    const newSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const O = region(oldSrc), N = region(newSrc, ', invoiceReq');

    console.log('① 줄 끝 주석 뒤 코드(#1073 꼴)');
    { const added = execSync('git diff -U0 HEAD -- server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      const bad = added.filter(l => { const i = l.search(/\s\/\/\s/); if (i < 0) return false; const c = l.slice(i); return /\)\s*\.\w+\(|;\s*$/.test(c); });
      ok(bad.length === 0, '줄 끝 주석 뒤 코드 0(server.js 새 줄 ' + added.length + ')', bad.join('\n')); }

    console.log('② 송장 요청 낱말');
    const REQ = ['송장번호 알려주세요', '운송장 번호 좀 주세요', '개별 송장 부탁드립니다', '송장 보내주세요', '송장번호 받을 수 있을까요?', '개별송장 부탁해요', '선물 보낸 거 송장번호 좀 알려주실 수 있나요', '보내주세요 송장번호', '운송장번호 전달 부탁드려요', '송장번호 문자로 보내 주실 수 있을까요', '송장번호 알 수 있을까요', '송장번호 뭐예요?', '송장번호 뭔가요', '운송장 번호 어떻게 되나요'];
    for (const m of REQ) ok(N.invoiceReq(m), '잡힘: ' + m);
    const NOQ = ['송장 조회는 어디서 하나요', '송장번호 어디서 봐요?', '개별 송장은 어떻게 확인해요?', '송장 언제 나와요?', '배송조회 어떻게 해요', '송장번호 확인했어요 감사합니다', '귤 언제 와요?', '송장 붙은 박스가 찢어졌어요', '운송장에 이름이 틀렸어요', '배송 송장 조회하는 방법 알려 주세요', '송장번호 알려주셔서 감사합니다', '송장 보내주셔서 감사해요'];
    for (const m of NOQ.filter((_, i) => i !== 9)) ok(!N.invoiceReq(m), '안 잡힘: ' + m);
    { const m = NOQ[9]; console.log('  ℹ️  「' + m + '」 = ' + (N.invoiceReq(m) ? '잡힘(알려 주세요 = 요청 꼴이라 · 직원 확인 1건 늘 뿐)' : '안 잡힘')); }

    console.log('③ 톡톡 판정·알림 글');
    const R = (message, bot_response, o = {}) => Object.assign({ id: 5900, message, bot_response, staff_response: null, staff_at: null }, o);
    const meta = { id: 5900, at: '11/11 13:05', item: '타이벡감귤' };
    { const x = R('송장번호 알려주세요', '네 개별 송장번호는 확인 후 톡톡으로 보내드리겠습니다!'); const po = O.talkPick(x), pn = N.talkPick(x); const t = N.talkBlock('톡톡', pn, x.message, x.bot_response, meta);
      ok(po === null && pn && pn.mode === 'memo' && pn.inv === true && /^🟥 <b>메모 필요<\/b> · 톡톡 답변완료\n톡톡 #5900 · 11\/11 13:05 · 타이벡감귤\n\n<b>손님:<\/b> 송장번호 알려주세요\n\n<b>봇:<\/b> /.test(t) && t.endsWith('<b>→ 송장번호 보내 드리기</b>'), '봇 답함 + 송장 요청 = 종전 안 보냄 → 🟥 메모 필요 · 꼬리 「→ 송장번호 보내 드리기」 굵게', t); }
    { const x = R('개별 송장 부탁드려요', '[SKIP-무응답]'); const pn = N.talkPick(x); const t = N.talkBlock('톡톡', pn, x.message, x.bot_response);
      ok(pn && pn.mode === 'staff' && pn.inv === true && t.startsWith('🟥 <b>확인 필요</b> · 톡톡(봇이 답 못함)') && t.endsWith('<b>→ 송장번호 보내 드리기</b>'), '봇 못 답함 + 송장 요청 = 🟥 확인 필요 + 꼬리', t); }
    { const x = R('송장번호 좀 알려주세요', '[1회응대-무응답]'); const pn = N.talkPick(x); ok(pn && pn.mode === 'staff' && pn.inv === true, '1회응대 침묵 + 송장 요청 = 🟥 확인 필요(종전 안 보냄)', JSON.stringify(pn)); }
    { const x = R('송장번호 알려주세요 그리고 S사이즈로 보내 주세요', '네 확인해서 보내드리겠습니다!'); const t = N.talkBlock('톡톡', N.talkPick(x), x.message, x.bot_response);
      ok(t.endsWith('<b>→ 송장번호 보내 드리기\n→ 에이전트 오피스 › 발주 메모함에 넣기</b>'), '송장 + 메모 거리 = 꼬리 두 줄', t); }
    { const x = R('주소 변경해 주세요 송장번호도 알려주세요', '네 변경해드리겠습니다!'); const t = N.talkBlock('톡톡', N.talkPick(x), x.message, x.bot_response);
      ok(t.endsWith('<b>→ 배송지 수정\n→ 송장번호 보내 드리기</b>'), '주소 + 송장 = 꼬리 두 줄', t); }
    { const x = R('송장번호 알려주세요', '안녕하세요', { staff_response: '6011-1234' }); ok(N.talkPick(x) === null, '직원 답 달린 줄 = 종전대로 안 보냄'); }
    { const x = R('송장번호 알려주세요', '[쿨다운-무응답]'); ok(N.talkPick(x) === null, '쿨다운(직원 대화 중) = 종전대로 안 보냄'); }
    // 송장 요청이 아닌 글 = 판정·글 바이트 종전 그대로
    const SAME = [R('귤 언제와요?', '[SKIP-무응답]'), R('S사이즈로 보내 주세요', '네 S사이즈로 지정해드리겠습니다!'), R('주문 취소 가능할까요', '확인 후 도와드리겠습니다'), R('감사합니다', '[SKIP-무응답]'), R('주소 변경하고 싶어요', '[SKIP-무응답]'), R('배송지를 서귀포시 화순로 101 3동 202호로 변경해 주세요', '네 변경해드리겠습니다!'), R('주소 바꾸고 취소도 할래요', '확인해 볼게요'), R('파손됐어요', '[쿨다운-무응답]'), R('송장 조회는 어디서 하나요', '마이페이지에서 확인하실 수 있어요'), R('개별 송장은 어떻게 확인해요?', '[SKIP-무응답]'), R('보내는 분 김철수로 해 주세요', '네 보내드리겠습니다!'), R('사진이요', '[이미지-무응답]')];
    for (const x of SAME) { const po = O.talkPick(x), pn = N.talkPick(x); const same = JSON.stringify(po) === JSON.stringify(pn) && (po === null || O.talkBlock('톡톡', po, x.message, x.bot_response, meta) === N.talkBlock('톡톡', pn, x.message, x.bot_response, meta));
      ok(same, '종전 그대로: ' + x.message + ' / ' + x.bot_response, JSON.stringify([po, pn])); }

    console.log('④ 상품문의·고객문의');
    { const a = N.qnaDoneBlock('고객문의', '타이벡', '송장번호 알려주세요', '확인 후 안내드리겠습니다'); ok(a.startsWith('🟥 <b>메모 필요</b> · 고객문의 답변완료\n\n<b>상품:</b> 타이벡') && a.endsWith('<b>→ 송장번호 보내 드리기</b>'), '고객문의 송장 요청 = 🟦 → 🟥 메모 필요 + 꼬리', a); }
    { const a = N.qnaDoneBlock('상품문의', 'p', '선물 보냈는데 운송장 번호 좀 주세요', 'x'); ok(a.startsWith('🟥 <b>메모 필요</b> · 상품문의 답변완료') && a.endsWith('<b>→ 송장번호 보내 드리기</b>'), '상품문의 송장 요청 = 🟩 → 🟥', a); }
    for (const [k, p, q] of [['상품문의', 'p', '당도 어때요'], ['고객문의', '', '언제 와요'], ['고객문의', '', '송장 조회는 어디서 하나요'], ['상품문의', '타이벡', '이미 주문했는데 S사이즈로 부탁드려요'], ['고객문의', '', '배송지 변경해 주세요 서울 마포구 1-2']])
        ok(O.qnaDoneBlock(k, p, q, 'a') === N.qnaDoneBlock(k, p, q, 'a'), '종전 바이트: ' + k + ' · ' + q);
    ok(O.tgBlock('머리', [['a', 'b<c']], '꼬리') === N.tgBlock('머리', [['a', 'b<c']], '꼬리'), 'tgBlock 무변경');

    if (process.argv.includes('--real')) {
        console.log('⑤ 실DB message_logs 30일(SELECT 만)');
        require('dotenv').config({ path: path.join(ROOT, '.env') });
        const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
        const rows = (await pool.query(`SELECT id, user_id, message, bot_response, staff_response, staff_at FROM message_logs WHERE received_at > NOW() - interval '30 days' AND bot_response IS NOT NULL AND bot_response NOT IN ('[직원응답]','[직원 직접답변]') ORDER BY id`)).rows;
        await pool.end();
        const hit = [], diff = [], cand = [];
        for (const x of rows) {
            const m = String(x.message || '');
            if (N.invoiceReq(m)) hit.push(x.id + ' ' + m.replace(/\s+/g, ' ').slice(0, 70));
            else if (/송장/.test(m)) cand.push(x.id + ' ' + m.replace(/\s+/g, ' ').slice(0, 70));
            const a = O.talkPick(x), b = N.talkPick(x); if (JSON.stringify(a) !== JSON.stringify(b)) diff.push(x.id + ' ' + (a ? a.mode : '-') + '→' + (b ? b.mode + (b.inv ? '+송장' : '') : '-') + ' ' + m.replace(/\s+/g, ' ').slice(0, 60));
        }
        console.log(`  줄 ${rows.length} · 송장 요청으로 잡힘 ${hit.length} · 「송장」 낱말 있는데 안 잡힘 ${cand.length} · 알림 판정 바뀜 ${diff.length}`);
        hit.forEach(s => console.log('   잡힘 ' + s)); cand.forEach(s => console.log('   안잡힘 ' + s)); diff.forEach(s => console.log('   판정 ' + s));
    }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #598 창구 비용 줄이기 — A 최종발주 메모 읽기 앞 판정 재사용 · B 되묻기에 실어 둔 명령([이대로 진행])
//   node scripts/verify-598-desk.js          순수 함수·코드 연결 검증(DB·AI 없음)
const fs = require('fs'), path = require('path');
const F = require('./desk/fast');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── A ──
const ctx = { shipDate: '2026-10-11', realToday: '2026-10-09', shipDays: ['2026-10-11', '2026-10-12'], rules: '규칙 v1' };
const it = { i: 3, memo: '문 앞에 놓아주세요 13일 도착', buyer: '김가', recv: '김나', qty: 2, cards: ['order'], hint: '도착 13일', unit: '101동' };
const k0 = F.memoKey(it, ctx);
ok('A 열쇠: 같은 값이면 같음(i 는 열쇠에 안 들어감)', k0 === F.memoKey(Object.assign({}, it, { i: 99 }), Object.assign({}, ctx)) && /^[0-9a-f]{64}$/.test(k0));
const diff = [['memo', '문 앞에 놓아주세요 13일 도착 '], ['buyer', '김다'], ['recv', '김라'], ['unit', '102동'], ['hint', ''], ['qty', 3], ['cards', ['order', 'memo']], ['cards', []]];
diff.forEach(([f, v]) => ok(`A 열쇠: ${f} 가 다르면 다름`, F.memoKey(Object.assign({}, it, { [f]: v }), ctx) !== k0));
[['shipDate', '2026-10-12'], ['realToday', '2026-10-10'], ['shipDays', ['2026-10-11']], ['rules', '규칙 v2']].forEach(([f, v]) => ok(`A 열쇠: ${f} 가 다르면 다름`, F.memoKey(it, Object.assign({}, ctx, { [f]: v })) !== k0));
ok('A 열쇠: 칸을 붙여 같은 글이 돼도 다름(구매자 「김」+받는 분 「가나」 ≠ 「김가」+「나」)', F.memoKey({ buyer: '김', recv: '가나' }, ctx) !== F.memoKey({ buyer: '김가', recv: '나' }, ctx));

const NOW = Date.parse('2026-10-09T03:00:00Z');
const payload = { type: 'fo_memo', shipDate: ctx.shipDate, realToday: ctx.realToday, shipDays: ctx.shipDays, items: [
    { i: 0, memo: '부재시 경비실 12일 발송', buyer: 'A', recv: 'A', qty: 1, cards: [], hint: '', unit: '' },
    it,
    { i: 7, memo: '보내는이 홍길동으로', buyer: 'C', recv: 'D', qty: 1, cards: ['sender'], hint: '', unit: '' }] };
const judge = i => ({ i, ship: i === 3 ? 'hold' : i === 7 ? 'ask' : 'go', ship_date: i === 3 ? '2026-10-12' : null, sender: null, memo: '기본', split: false, sure: true, why: '판정 ' + i });
const p0 = F.memoPlan(payload, null, ctx.rules, NOW);
ok('A 보관함 없음 → 전부 새로(재사용 0 · 열쇠 3)', p0.reused.length === 0 && p0.fresh.length === 3 && Object.keys(p0.keys).length === 3 && eq(p0.order, [0, 3, 7]));
const c1 = F.memoCachePut(null, p0.keys, [judge(0), judge(3), judge(7)], NOW);
ok('A 보관: 3건 · 값에 i 없음 · 메모 원문 없음', Object.keys(c1.items).length === 3 && Object.values(c1.items).every(v => !('i' in v.r) && v.at === NOW) && !JSON.stringify(c1).includes('경비실'));
const p1 = F.memoPlan(payload, c1, ctx.rules, NOW + 60000);
ok('A 같은 묶음 다시 → 새 메모 0건 · 재사용 3건 · 판정이 첫 회와 동일', p1.fresh.length === 0 && eq(p1.reused, [judge(0), judge(3), judge(7)]));
const payload2 = Object.assign({}, payload, { items: payload.items.concat([{ i: 9, memo: '새 메모', buyer: 'E', recv: 'E', qty: 1, cards: [], hint: '', unit: '' }]) });
const p2 = F.memoPlan(payload2, c1, ctx.rules, NOW + 60000);
ok('A 1건 추가 → 새 메모 1건(원래 i 9 그대로) · 재사용 3건', p2.fresh.length === 1 && p2.fresh[0].i === 9 && p2.fresh[0].memo === '새 메모' && p2.reused.length === 3);
const moved = Object.assign({}, payload, { items: [Object.assign({}, it, { i: 0 }), Object.assign({}, payload.items[0], { i: 1 })] });
const p3 = F.memoPlan(moved, c1, ctx.rules, NOW);
ok('A 줄 번호가 바뀌어도(같은 메모) 재사용 · 새 번호로 붙음', p3.fresh.length === 0 && p3.reused[0].i === 0 && p3.reused[0].ship === 'hold' && p3.reused[1].i === 1 && p3.reused[1].ship === 'go');
ok('A 7일 지나면 재사용 안 함 · 6.9일은 함', F.memoPlan(payload, c1, ctx.rules, NOW + 7 * 86400e3).reused.length === 0 && F.memoPlan(payload, c1, ctx.rules, NOW + 6.9 * 86400e3).reused.length === 3);
ok('A 발송일·규칙 문서가 바뀌면 전부 새로', F.memoPlan(Object.assign({}, payload, { shipDate: '2026-10-12' }), c1, ctx.rules, NOW).reused.length === 0 && F.memoPlan(payload, c1, '규칙 v2', NOW).reused.length === 0);
ok('A 번호가 겹치거나 이상한 줄은 건드리지 않고 AI 로', (() => { const p = F.memoPlan(Object.assign({}, payload, { items: [payload.items[0], payload.items[0], { i: -1, memo: 'x' }, { memo: 'y' }] }), c1, ctx.rules, NOW); return p.reused.length === 1 && p.fresh.length === 3; })());
ok('A 판정이 이상한 값(ship 없음)은 보관 안 함 · 열쇠 없는 번호도 안 함', Object.keys(F.memoCachePut(null, p0.keys, [{ i: 0, why: 'x' }, { i: 55, ship: 'go' }], NOW).items).length === 0);
ok('A 보관함 정리: 7일 지난 것은 덜어 냄', Object.keys(F.memoCachePut(c1, {}, [], NOW + 8 * 86400e3).items).length === 0 && Object.keys(F.memoCachePut(c1, {}, [], NOW + 86400e3).items).length === 3);
// 합치기
const aiJ = { kind: 'answer', title: '메모 1건 읽음', answer: '오늘 발송 1 · 오늘 안 나감 0 · 사람 확인 0', data: { items: [{ i: 9, ship: 'go', ship_date: null, sender: null, memo: '그대로', split: false, sure: true, why: '새' }] } };
const mg = F.memoMerge(aiJ, { reused: p2.reused, order: p2.order, keys: p2.keys });
ok('A 합치기: 4건 전부 · 받은 순서(0,3,7,9) · 제목·요약 숫자 다시 셈 · 재사용 표시', mg.data.items.length === 4 && eq(mg.data.items.map(x => x.i), [0, 3, 7, 9]) && mg.title === '메모 4건 읽음' && mg.answer === '오늘 발송 2 · 오늘 안 나감 1 · 사람 확인 1 (앞 판정 재사용 3건)' && mg.kind === 'answer');
ok('A 합치기: 항목 모양 무변경(앞 판정 = 첫 회 판정 그대로)', eq(mg.data.items.slice(0, 3), [judge(0), judge(3), judge(7)]) && eq(mg.data.items[3], aiJ.data.items[0]));
ok('A 합치기: 재사용 0건이면 AI 결과 그대로(같은 객체)', F.memoMerge(aiJ, { reused: [], order: [9] }) === aiJ && F.memoMerge(aiJ, null) === aiJ);
ok('A 합치기: AI 가 빠뜨린 새 메모는 종전처럼 빠진 채(지어내지 않음) · 재사용분은 남음', F.memoMerge({ kind: 'answer', data: { items: [] } }, { reused: p2.reused, order: p2.order }).data.items.length === 3);
ok('A 요약 글 = 규칙 문서 꼴', F.memoSummary([judge(0), judge(3), judge(7)]) === '오늘 발송 1 · 오늘 안 나감 1 · 사람 확인 1');
ok('A 끄기: memo_reuse false · off', F.settings(null).memo_reuse === true && F.settings({ memo_reuse: false }).memo_reuse === false && F.settings({ memo_reuse: false }).inline === true && F.settings({ off: true }).memo_reuse === false);

// ── B ──
const P = cmds => F.planCheck({ label: '시험', cmds });
ok('B 버튼 글: 정확히 「[이대로 진행]」만(앞뒤 빈칸 · 시험 머리말 허용)', F.planGo('[이대로 진행]') && F.planGo('  [이대로 진행]\n') && F.planGo('[검증469] [이대로 진행]') && !F.planGo('[이대로 진행] 2번은 빼고') && !F.planGo('이대로 진행') && !F.planGo('응') && !F.planGo(''));
ok('B 허용 ① talk-send', P([['node', 'scripts/desk/talk-send.js', '{id}', '★에이전트오피스/받은파일/plan12_talk.json']]).ok);
ok('B 허용 ② mall-guide set · mall-price apply/hide/show · mall-sync run · mall-link link(역슬래시 경로도)', P([['node', 'scripts/desk/mall-guide.js', 'set', '황금향', '글.txt', '{id}'], ['node', 'scripts\\desk\\mall-price.js', 'apply', 'c92', '{id}'], ['node', 'scripts/desk/mall-price.js', 'hide', 'c92', '행사★하우스귤 2.5kg로얄과→중량up 4kg', '{id}'], ['node', 'scripts/desk/mall-sync.js', 'run', '6400134206', '{id}'], ['node', 'scripts/desk/mall-link.js', 'link', '1', '2', '{id}', '--then']]).ok);
ok('B 거부 ① node -e', !P([['node', '-e', "console.log('ok')"]]).ok);
ok('B 거부 ② 허용 목록 밖 도구(respond·q·holiday·scenario-edit)', ['respond.js', 'q.js', 'holiday.js', 'scenario-edit.js', 'launcher.js'].every(s => !P([['node', 'scripts/desk/' + s, 'x']]).ok));
ok('B 거부 ③ 읽기·되돌리기 명령(preview·restore·rollback·unlink·list)', !P([['node', 'scripts/desk/mall-guide.js', 'restore', '황금향', '1']]).ok && !P([['node', 'scripts/desk/mall-price.js', 'restore', 'c92', '1']]).ok && !P([['node', 'scripts/desk/mall-sync.js', 'rollback', '1']]).ok && !P([['node', 'scripts/desk/mall-link.js', 'unlink', '1']]).ok && !P([['node', 'scripts/desk/mall-guide.js']]).ok);
ok('B 거부 ④ 폴더 밖 경로(.. · 절대 경로 · 다른 폴더 · 대문자 위장)', ['scripts/desk/../talk-send.js', '../scripts/desk/talk-send.js', 'C:/x/scripts/desk/talk-send.js', 'scripts/talk-send.js', 'scripts/desk/sub/talk-send.js', 'talk-send.js', 'scripts/desk/talk-send.js ', 'scripts/desk/TALK-SEND.JS'].every(s => !P([['node', s, '1', 'a.json']]).ok));
ok('B 거부 ⑤ 셸 문자(; & | < > ` $ 따옴표 줄바꿈)', [';', '&', '|', '<', '>', '`', '$', '"', '\n'].every(ch => !P([['node', 'scripts/desk/talk-send.js', '1', 'a' + ch + 'b']]).ok));
ok('B 거부 ⑥ 셸 문자열·다른 실행 파일·글자가 아닌 인자', !P(['node scripts/desk/talk-send.js 1 a.json']).ok && !P([['cmd', 'scripts/desk/talk-send.js', '1']]).ok && !P([['node', 'scripts/desk/talk-send.js', 1, 'a.json']]).ok && !P([['node', 'scripts/desk/talk-send.js']]).ok);
ok('B 거부 ⑦ plan 없음·빈 명령·6개 이상 · 하나라도 나쁘면 전체 거부', !F.planCheck(null).ok && !F.planCheck({ cmds: [] }).ok && !F.planCheck('x').ok && !P(Array(6).fill(['node', 'scripts/desk/talk-send.js', '1', 'a.json'])).ok && !P([['node', 'scripts/desk/talk-send.js', '1', 'a.json'], ['node', '-e', '1']]).ok);
const good = P([['node', 'scripts/desk/talk-send.js', '{id}', 'a.json']]);
ok('B 통과 결과 = 도구 이름 + 인자 배열 · 이름 없으면 도구 이름으로', eq(good.cmds, [{ script: 'talk-send.js', args: ['{id}', 'a.json'] }]) && good.label === '시험' && F.planCheck({ cmds: [['node', 'scripts/desk/mall-sync.js', 'run', '1']] }).label === 'mall-sync.js');
ok('B planClean: 모양만 다듬음(검사는 실행 쪽) · 이상하면 null', eq(F.planClean({ label: 'L', cmds: [['node', 'x', 1]], extra: 1 }), { label: 'L', cmds: [['node', 'x', '1']] }) && F.planClean(null) === null && F.planClean({ cmds: 'node x' }) === null && F.planClean({ cmds: [] }) === null);
const aOk = F.planAnswer('톡톡 2건 보내기', [{ script: 'talk-send.js', args: ['5', 'a.json'], code: 0, out: '{"ok":true,"sent":2}', err: '' }], 1);
ok('B 답: 성공 = answer 「실행: …」 + 출력', aOk.kind === 'answer' && aOk.title === '실행: 톡톡 2건 보내기' && aOk.answer.startsWith('실행: 톡톡 2건 보내기') && aOk.answer.includes('"sent":2'));
const aBad = F.planAnswer('가격 맞추고 반영', [{ script: 'mall-price.js', args: ['apply', 'c92', '5'], code: 1, out: '', err: 'ERR 옵션 이름이 다릅니다' }], 2);
ok('B 답: 실패 = error · 멈춘 자리 · 남은 명령 안 돌림 표시', aBad.kind === 'error' && aBad.error.includes('1번째 명령에서 멈췄어요') && aBad.error.includes('남은 1개는 실행하지 않았어요') && aBad.error.includes('옵션 이름이 다릅니다'));
ok('B 끄기: plan false · off', F.settings(null).plan === true && F.settings({ plan: false }).plan === false && F.settings({ off: true }).plan === false);

// ── 코드 연결(글자 확인) ──
const L = fs.readFileSync(path.join(__dirname, 'desk', 'launcher.js'), 'utf8'), R = fs.readFileSync(path.join(__dirname, 'desk', 'respond.js'), 'utf8');
ok('연결: launcher 가 메모 재사용을 규칙 미리 넣기보다 먼저 한다', L.indexOf('memo = memoPrepare(order, got)') > 0 && L.indexOf('memo = memoPrepare(order, got)') < L.indexOf('inl = fast.inlineFinalOrder(got'));
ok('연결: launcher 재사용·명령 길은 AI 실행(run·runDesk)을 안 부른다', /else if \(rt\.lane === 'memo_reuse'\) r = await runMemoReuse/.test(L) && /else if \(rt\.lane === 'plan'\) \{ if \(got\) r = await runPlan/.test(L));
ok('연결: 명령 실행은 셸 없이 인자 배열(spawn(process.execPath …)) · {id} 바꿈', /spawn\(process\.execPath, \[path\.join\(__dirname, script\)\]\.concat\(args\)/.test(L) && L.includes("a === '{id}' ? String(order.id) : a") && !/shell:\s*true/.test(L));
ok('연결: 대표 계정 둘 다 확인 · 두 번 실행 방지(plan_run)', L.includes("role = 'admin' AND position = '대표'") && L.includes("result->>'plan_run' = 'yes'") && L.includes('st.planTried.add(order.id)'));
ok('연결: respond 가 메모 읽기 지시에서만 합치고 · 되묻기에 plan 을 싣는다', R.includes("메모 읽기\\]/.test(o.content || '')) j = memoReuse(id, j);") && R.split('j = memoReuse(id, j)').length === 2 && R.includes('if (plan) result.plan = plan;'));
ok('연결: 최종발주 결과 형식 문서는 그대로(items[{i,…}])', fs.readFileSync(path.join(__dirname, '..', '★에이전트오피스', '최종발주_메모읽기.md'), 'utf8').includes('## 돌려주는 것 (`data.items` — 받은 순서대로, `i` 그대로)'));

console.log(`verify-598-desk: ${pass}/${pass + fail}` + (fail ? ' ✗' : ' ✓'));
process.exit(fail ? 1 : 0);

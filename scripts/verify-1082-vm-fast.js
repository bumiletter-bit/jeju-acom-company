// #1082·#1083 검증 — scripts/vm/vm-watch.js 포인트 빠르게(소넷 → Opus 1회) · 배송지 변경 갈래 · 센터 로그인 유지 틱
//   실DB 0 · 어사이드 0 · claude 0(가짜 실행 파일) · 네트워크 0 · pglite(가짜 DB) + 임시 홈 폴더
//   사용: node scripts/verify-1082-vm-fast.js   (pglite 경로 = env PGLITE_PATH · 없으면 아래 기본)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const PGL = process.env.PGLITE_PATH || 'C:/Users/전승범/AppData/Local/Temp/claude/5c8150c8b250004d/2bc4552d-66b1-4274-8e08-0eafaac38cca/scratchpad/pgl/node_modules/@electric-sql/pglite';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'v1082-'));
const HOMED = path.join(T, 'home'); fs.mkdirSync(path.join(HOMED, '.akkome'), { recursive: true });
process.env.USERPROFILE = HOMED; process.env.HOME = HOMED;
const FAKE = path.join(T, 'fake-claude.js'), MODE = path.join(T, 'mode.json'), CALLS = path.join(T, 'calls.jsonl');
fs.writeFileSync(FAKE, `
const fs = require('fs'); let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => {
  const args = process.argv.slice(2); const model = args[args.indexOf('--model') + 1];
  const mode = JSON.parse(fs.readFileSync(${JSON.stringify(MODE)}, 'utf8'));
  const kind = /sonnet/.test(model) ? 'sonnet' : 'opus';
  fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ model, retry: /\\[다시 시도 · 중요\\]/.test(input), sent: /오늘 최종발주 = 이미 나감/.test(input), mins: (/⑥이 일은 지시당 (\\d+)분/.exec(input) || [])[1], allowed: args[args.indexOf('--allowedTools') + 1] }) + '\\n');
  const m = mode[kind] || 'ok';
  if (m === 'fail') { console.error('fake fail'); process.exit(1); }
  if (m === 'hang') { setTimeout(() => {}, 600000); return; }
  if (m === 'empty') { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '' })); return; }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: mode.answer || ('답 ' + kind) }));
});`);
process.env.VM_CLAUDE_BIN = FAKE;
process.env.VM_FAST_LIMIT_MS = '2500'; process.env.VM_POINT_LIMIT_MS = '4000'; process.env.VM_ADDR_LIMIT_MS = '4000'; process.env.VM_ORDER_LIMIT_MS = '4000';
process.env.VM_TOUCH_MS = '300';
process.env.ASIDE_EXE = path.join(T, 'no-aside.exe');   // 🔴 이 PC(노트북)의 진짜 어사이드를 절대 안 띄움
const W = require('./vm/vm-watch.js');

// HEAD 판(바이트 비교용) — 임시 폴더에 복사해 같은 홈으로 require
const HEAD_DIR = path.join(T, 'head', 'scripts', 'vm'); fs.mkdirSync(HEAD_DIR, { recursive: true });
let H = null;
try {
    const src = execFileSync('git', ['show', 'f6bb9c3:scripts/vm/vm-watch.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1e7 });
    fs.writeFileSync(path.join(HEAD_DIR, 'vm-watch.js'), src); H = require(path.join(HEAD_DIR, 'vm-watch.js'));
} catch (e) { console.log('  (HEAD 판 못 읽음: ' + e.message + ')'); }

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); } };
const mode = m => fs.writeFileSync(MODE, JSON.stringify(m));
const calls = () => { try { return fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (e) { return []; } };
const clearCalls = () => { try { fs.unlinkSync(CALLS); } catch (e) { /* 없음 */ } };

function units() {
    console.log('\n[1] 갈래 판정');
    const addrYes = ['[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층', '[VM] 주소 변경 홍길동 010-1234-5678 → 서울 강남구 테헤란로 1', '[VM] 2026110170868221 받는 곳 주소 바꿔줘 제주시 연동 1', '[VM] 배송지 수정해 주세요 김철수 01012345678 부산 해운대구 1', '[VM] 주소 정정 요청 주문 2026110170868221'];
    for (const s of addrYes) ok('배송지 = ' + s.slice(5, 40), W.isAddr(s) && W.isFast(s) && !W.isPoint(s));
    const addrNo = ['[VM] 체험 예약 확인', '[VM] 순위 다시', '[VM] 주소 알려줘 체험장', '[VM] 배송지 어디로 가는지 봐줘', '[VM] 상세 수정해줘'];
    for (const s of addrNo) ok('배송지 아님 = ' + s.slice(5), !W.isAddr(s));
    // 워커1 점검 실측 문장(조회·URL 뜻 = 배송지 갈래 아님)
    for (const s of ['[VM] 이 주소 들어가서 순위 바뀐 거 확인해줘', '[VM] 스마트플레이스 업체 주소 변경 됐는지 봐줘', '[VM] 상세 블로그 링크 주소 수정됐는지 확인', '[VM] 배송지 변경 요청 온 톡톡 있는지 봐줘', '[VM] 주소 바꿔줘 제주시 연동 1'])
        ok('배송지 아님(점검 실측) = ' + s.slice(5), !W.isAddr(s));
    ok('워커1 지시 꼴 = 배송지 유지', W.isAddr('[VM] 네이버 배송지 변경 · 손님 홍길동 010-1234-5678 · 새 주소 제주시 ○○로 12, 3층 · 받는 분 그대로 · 찾은 값: 주문번호 2026110170868221 · 상태 발송 전'));
    ok('워커1 꼴 · 찾은 값 없음 = 배송지 유지', W.isAddr('[VM] 네이버 배송지 변경 · 손님 홍길동 010-1234-5678 · 새 주소 제주시 ○○로 12 · 찾은 값: 없음(VM 이 센터에서 찾기)'));
    ok('조회 꼬리라도 주문번호 있으면 실행 = 배송지', W.isAddr('[VM] 2026110170868221 배송지 변경해 주고 확인해줘 → 제주시 연동 1'));
    ok('조회 꼬리라도 「→」 새 주소면 실행 = 배송지', W.isAddr('[VM] 배송지 변경 홍길동 → 제주시 연동 1 하고 알려줘'));
    // 「포인트 && 보상」 새 규칙 좁힘
    for (const s of ['[VM] 포인트 보상 내역 어제 거 봐줘', '[VM] 이번 달 포인트 보상 얼마 나갔어?', '[VM] 리뷰 보상 포인트 기준 바뀐 거 확인'])
        ok('포인트 아님(조회) = ' + s.slice(5), !W.isPoint(s));
    ok('포인트 보상 + 금액 = 포인트', W.isPoint('[VM] 김철수 포인트 보상 3,000') && W.isPoint('[VM] 포인트 보상 3천 abc'));
    ok('포인트 보상 + 아이디 = 포인트', W.isPoint('[VM] 아이디 abc123 포인트 보상 해줘'));
    ok('포인트 보상 + 주문번호 = 포인트', W.isPoint('[VM] 2026110539641061 포인트 보상'));
    ok('포인트 보상만(금액·아이디·주문 없음) = 아님', !W.isPoint('[VM] 포인트 보상 어떻게 해?'));
    ok('종전 #1064 낱말(포인트+지급 · 보상처리)은 그대로', W.isPoint('[VM] 포인트 지급 내역 확인') === true && W.isPoint('[VM] saygoodjod 네이버페이 보상처리진행해줘! 포인트 지급이고'));
    ok('포인트 먼저(주소 낱말 섞여도 포인트 갈래)', W.isPoint('[VM] 포인트 지급 3000 주소 변경 보상') && !W.isAddr('[VM] 포인트 지급 3000 주소 변경 보상'));
    ok('포인트 = isFast', W.isFast('[VM] 아이디 saygoodjod 포인트 보상 5,000'));
    ok('일반 지시 = isFast 아님', !W.isFast('[VM] 체험 예약 화면 봐줘') && !W.isFast('[VM] 순위 확인'));
    ok('소넷 모델 = claude-sonnet-5-5 · 종전 = claude-opus-5-5', W.FAST_MODEL === 'claude-sonnet-5-5' && W.MODEL === 'claude-opus-5-5');

    console.log('\n[2] 쉼 창');
    const k = hm => new Date(Date.UTC(2026, 10, 10, Number(hm.slice(0, 2)), Number(hm.slice(3))));
    // #1087 포인트·배송지 = 쉼 창 없음(아무 때나) · 그 밖은 종전
    for (const hm of ['09:00', '09:15', '09:30', '09:44']) ok('#1087 포인트 ' + hm + ' 안 쉼', W.skipWhy('[VM] 포인트 지급 1,000 아이디 abc', k(hm)) === '');
    ok('#1087 배송지 09:30 안 쉼', W.skipWhy('[VM] 배송지 변경 2026110170868221 → 제주시 연동 1', k('09:30')) === '');
    // #1088 모든 갈래 쉼 없음(줄 세우기 = 잠금)
    for (const hm of ['09:10', '09:20', '09:30', '09:44']) ok('#1088 그 밖 claude ' + hm + ' 안 쉼', W.skipWhy('[VM] 체험 예약 화면 봐줘', k(hm)) === '');
    for (const hm of ['09:10', '09:30']) ok('#1088 순위 갈래 ' + hm + ' 안 쉼', W.skipWhy('[VM] 순위 다시', k(hm)) === '');
    ok('순위 09:10 그대로 · 09:09 안 쉼', W.inSkip(k('09:10'), true) && !W.inSkip(k('09:09'), true));
    ok('claude 09:20 그대로 · 09:19 안 쉼', W.inSkip(k('09:20'), false) && !W.inSkip(k('09:19'), false));

    console.log('\n[3] 프롬프트');
    const other = ['[VM] 체험 예약 화면 봐줘', '[VM] 쿠팡 윙 상품 목록 첫 줄 읽어줘', '[VM] 쇼핑 「제주아꼼이네 황금향」 검색 결과 알려줘', '[VM] 순위가 왜 떨어졌는지 원인 화면 보고 알려줘 자세히'];
    if (H) for (const c of other) ok('그 밖 지시 프롬프트 HEAD 와 바이트 동일 = ' + c.slice(5, 30), W.promptFor({ id: 77, content: c }) === H.promptFor({ id: 77, content: c }));
    if (H) ok('그 밖 지시 opt 를 줘도 동일(갈래 밖은 무시)', W.promptFor({ id: 77, content: other[0] }, { retry: false }) === H.promptFor({ id: 77, content: other[0] }));
    const pp = W.promptFor({ id: 9, content: '[VM] 아이디 saygoodjod 주문번호 2026110539641061 포인트 보상 5,000 · 사유 타이벡 파손 보상처리' }, { limitMs: 600000 });
    ok('포인트 = (b-0) 아이디+주문번호 → 대조만', /\(b-0\) #1082/.test(pp) && /셋 다 맞을 때만/.test(pp));
    ok('포인트 = ⑥ 10분(소넷 상한)', /⑥이 일은 지시당 10분/.test(pp));
    ok('포인트 = 다시 시도 글머리 없음(첫 시도)', !/\[다시 시도/.test(pp));
    const pr = W.promptFor({ id: 9, content: '[VM] 포인트 지급 3000' }, { limitMs: 1200000, retry: true });
    ok('재시도 = 「오늘 같은 아이디 줄 먼저」 + 애매하면 멈춤 + ⑥ 20분', /\[다시 시도 · 중요\]/.test(pr) && /지급하지 말고 「이미 오늘 지급됨\(앞 시도\)/.test(pr) && /애매하면 지급·저장하지 말고 멈춰/.test(pr) && /⑥이 일은 지시당 20분/.test(pr));
    const pa = W.promptFor({ id: 10, content: '[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층' }, { limitMs: 600000, sentToday: false });
    ok('배송지 = 규칙 ① [고객 배송지 정보수정]·주소 검색·[저장] 만 · 발송처리 금지', /\[고객 배송지 정보수정\]·주소 검색·후보 고르기·\[저장\]/.test(pa) && /발송처리·발주확인·취소/.test(pa));
    ok('배송지 = 멈춤 조건(발송처리·2건↑·후보 0/2↑·이름 번호 안 맞음)', /발송처리 됐거나 배송준비/.test(pa) && /후보 주문이 둘 이상/.test(pa) && /후보 0개 또는 2개 이상/.test(pa) && /이름·번호가 주문과 안 맞음/.test(pa));
    ok('배송지 = 재조회 확인 · 배송 메모 = 메모함 안내(#952) · 네이버만', /다시 열어\(새로 고침\)/.test(pa) && /발주 메모함에 넣어 주세요/.test(pa) && /네이버 주문만 VM/.test(pa));
    ok('배송지 = 사내 화면 전체 표기 규칙 ③ 그대로', /가리지 말고 전체로/.test(pa));
    ok('배송지 = 오늘 발주 안 나감 줄', /오늘 최종발주 = 아직 안 나감/.test(pa));
    ok('배송지 = 발주 나감이면 거래처 연락 줄 안내', /이미 나감 → 저장했으면/.test(W.promptFor({ id: 10, content: '[VM] 주소 변경 홍길동 010-1234-5678 → 서울' }, { sentToday: true })));
    ok('배송지 프롬프트에 포인트 절차 없음 · 포인트 프롬프트에 배송지 절차 없음', !/포인트 보상 지급\n/.test(pa) && !/\[절차\] 네이버페이/.test(pa) && !/\[절차\] 네이버 주문 배송지/.test(pp));
    if (H) ok('포인트 프롬프트 = #1082 전(f6bb9c3) 대비 (b-0)·⑥·#1084 (b)(e)(f) 줄만 다름(그 밖 줄 동일)', (() => {
        const a = pp.split('\n'), b = H.promptFor({ id: 9, content: '[VM] 아이디 saygoodjod 주문번호 2026110539641061 포인트 보상 5,000 · 사유 타이벡 파손 보상처리' }).split('\n');
        const extra = a.filter(l => !b.includes(l)), gone = b.filter(l => !a.includes(l));
        const tag = l => (/^\(([a-z0-9-]+)\)/.exec(l) || /^(⑥)/.exec(l) || /^(규칙):/.exec(l) || [])[1];
        const ex = extra.map(tag).sort().join(','), gn = gone.map(tag).sort().join(',');
        return ex === 'b,b-0,b-t,e,f,⑥,규칙' && gn === 'b,e,f,⑥,규칙' && extra.some(l => /수취인\(받는 분\) 이름·전체 번호/.test(l) && /운송장번호\(12자리/.test(l) && /구매자 아이디\*\*로 한다/.test(l)) && extra.some(l => /수취인으로 찾음 → 구매자/.test(l)) && extra.some(l => /「안 맞음」이 아니다/.test(l));
    })());
    // #1086 톡톡 대화방 길
    const tb = W.promptFor({ id: 9, content: '[VM] 톡톡 ceo 11/9 14시 「귤이 다 터졌어요」 포인트 보상 3,000 · 사유 타이벡 파손 보상처리' }, { limitMs: 600000 });
    const ta = W.promptFor({ id: 10, content: '[VM] 톡톡 ceo 손님 배송지 변경 → 제주시 연동 1 · 010-1234-5678' }, { limitMs: 600000 });
    ok('#1086 포인트 = (b-t) 톡톡 대화방 길이 (b-0) 앞', /\n\(b-t\) #1086[^\n]*partner\.talk\.naver\.com[^\n]*스마트 요약[^\n]*productOrderDetail[^\n]*구매자 ID 전체[^\n]*그 값으로 \(b-0\)/.test(tb) && tb.indexOf('(b-t) #1086') < tb.indexOf('(b-0) #1082'));
    ok('#1086 배송지 = (b-t) 가 (b) 앞 · 고치는 곳은 배송준비 화면(상세 창 보기 전용)', /\n\(b-t\) #1086[^\n]*그 값으로 \(c\)\(배송준비 화면/.test(ta) && ta.indexOf('(b-t) #1086') < ta.indexOf('(b) 판매관리') && /상세 창은 보기 전용/.test(ta));
    ok('#1086 대화·상품 줄 0건·둘↑ = 센터 검색 길 · 애매하면 멈춤', /맞는 대화가 0건이거나 둘 이상 · 또는 구매이력에서 지시 품목에 맞는 상품 줄이 0건이거나 둘 이상이면 아래 \(b\) 센터 검색 길로 · 그래도 애매하면 멈춘다/.test(tb));
    ok('#1086 규칙 ① 톡톡 = 읽기·누르기만(보내기·태그·메모 0) · 포인트·배송지 둘 다', [tb, ta].every(p => /^규칙: [^\n]*톡톡 파트너센터는 읽기와 대화·탭·링크 누르기만 한다\(메시지 보내기·태그·메모·상태 바꾸기 0/m.test(p)));
    ok('#1086 그 밖 지시엔 톡톡 길·줄 없음', !/톡톡 파트너센터|\(b-t\)/.test(W.promptFor({ id: 77, content: '[VM] 톡톡 상담 목록 첫 줄 읽어줘' })));
    ok('로그인 유지 코드 = 센터 첫 화면만(포인트·주문 화면 주소 없음 · 저장 단추 없음)', /home\/dashboard/.test(W.JS_KEEP) && !/point|benefit|pay-order|저장|지급/.test(W.JS_KEEP) && /간편\\s\*로그인/.test(W.JS_KEEP));
}

async function dbtests() {
    console.log('\n[4] pglite 왕복 — 모델·재시도');
    const { PGlite } = require(PGL);
    const pg = new PGlite();
    const conv = v => Buffer.isBuffer(v) ? new Uint8Array(v) : Array.isArray(v) ? '{' + v.join(',') + '}' : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v;
    const db = { query: async (sql, p = []) => { const r = await pg.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; } };
    await pg.exec(`
        CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT NOT NULL, status VARCHAR(20) DEFAULT '대기', created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false,
            result JSONB, run_id INTEGER, processed_at TIMESTAMP, created_by TEXT, image_data TEXT, created_by_id INTEGER);
        CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action VARCHAR(50), target_type VARCHAR(50), target_id INTEGER, changes JSONB, source VARCHAR(20), actor_name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE agents (id SERIAL PRIMARY KEY, role VARCHAR(10), is_deleted BOOLEAN DEFAULT false);
        INSERT INTO agents (role) VALUES ('chief');
        CREATE TABLE agent_runs (id SERIAL PRIMARY KEY, agent_id INTEGER, status VARCHAR(20) DEFAULT 'running', steps JSONB DEFAULT '[]', result JSONB, started_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP, is_test BOOLEAN DEFAULT false);
        CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200), run_id INTEGER, data BYTEA, size_bytes INTEGER, is_deleted BOOLEAN DEFAULT false);
        CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER, type VARCHAR(50), title VARCHAR(200), message TEXT, link VARCHAR(100), pushed_at TIMESTAMP);
        CREATE TABLE agent_office_config (key VARCHAR(50) PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW());`);
    const add = async content => Number((await db.query(`INSERT INTO pending_orders (content, created_by, created_by_id) VALUES ($1, '총괄', 990082) RETURNING id`, [content])).rows[0].id);
    const row = async id => (await db.query(`SELECT status, result FROM pending_orders WHERE id = $1`, [id])).rows[0];
    const auditOf = async id => (await db.query(`SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id`, [id])).rows.map(r => r.action).join(',');

    // ① 포인트 소넷 성공
    clearCalls(); mode({ sonnet: 'ok', opus: 'ok', answer: '✅ 포인트 3,000원 지급 완료' });
    const p1 = await add('[VM] 포인트 지급 주문번호 2026110539641061 3,000 · 사유 타이벡 감귤 보상처리');
    const r1 = await W.handle(db, p1); let c = calls();
    ok('포인트 = 소넷 1번만 · 완료', r1.ok && (await row(p1)).status === '완료' && c.length === 1 && c[0].model === 'claude-sonnet-5-5' && !c[0].retry, { r1, c });
    ok('도구 = 어사이드 둘만(종전과 같음)', c[0].allowed === 'mcp__aside__repl,mcp__aside__exec');
    ok('센터 유지 상태 = 방금 사용으로 적힘', !!JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')).at);

    // ② 소넷 실패 → Opus 성공
    clearCalls(); mode({ sonnet: 'fail', opus: 'ok', answer: '✅ 포인트 3,000원 지급 완료(opus)' });
    const p2 = await add('[VM] 아이디 saygoodjod 포인트 보상 5,000');
    const r2 = await W.handle(db, p2); c = calls();
    ok('소넷 실패 → Opus 1회 · 완료', r2.ok && (await row(p2)).status === '완료' && c.length === 2 && c[0].model === 'claude-sonnet-5-5' && c[1].model === 'claude-opus-5-5', c);
    ok('Opus 재시도 프롬프트 = 「다시 시도」 글머리(첫 시도엔 없음 · 분 수는 [3]에서)', c[1].retry && !c[0].retry, c);
    ok('audit vm_fast_retry 남음', /desk_claim,vm_fast_retry,desk_respond/.test(await auditOf(p2)), await auditOf(p2));

    // ③ 소넷 시간 초과 → Opus
    clearCalls(); mode({ sonnet: 'hang', opus: 'ok' });
    const p3 = await add('[VM] 네이버페이 보상 2,000 아이디 abc123');
    const t0 = Date.now(); const r3 = await W.handle(db, p3); c = calls();
    ok('소넷 시간 초과(시험 2.5초) → Opus 1회 · 완료', r3.ok && c.length === 2 && c[1].model === 'claude-opus-5-5' && Date.now() - t0 < 15000, { r3, c, ms: Date.now() - t0 });

    // ④ 빈 결과 → Opus
    clearCalls(); mode({ sonnet: 'empty', opus: 'ok' });
    const p4 = await add('[VM] 포인트 지급 1,000 아이디 zz9');
    const r4 = await W.handle(db, p4); c = calls();
    ok('소넷 빈 결과 → Opus 1회', r4.ok && c.length === 2, c);

    // ⑤ 둘 다 실패 → 대기로 안 되돌리고 바로 오류(3번째 실행 0)
    clearCalls(); mode({ sonnet: 'fail', opus: 'fail' });
    const p5 = await add('[VM] 포인트 지급 4,000 아이디 kk1');
    const r5 = await W.handle(db, p5); const s5 = await row(p5); c = calls();
    ok('둘 다 실패 = 바로 오류(대기 되돌림 0) · 실행 2번', !r5.ok && s5.status === '오류' && c.length === 2 && !/vm_retry/.test(await auditOf(p5)), { s5: s5.status, c: c.length, a: await auditOf(p5) });
    ok('오류 글 = 둘 다 실패 · 센터에서 지급까지 갔는지 먼저 확인', /소넷·Opus 둘 다 실패/.test(s5.result.error) && /지급까지 갔는지/.test(s5.result.error), s5.result.error);
    ok('오류 줄 다시 안 집음', await W.pick(db) === null);

    // ⑥ 소넷 「사람 확인 필요」 답 = 정상 답 → 재시도 없음
    clearCalls(); mode({ sonnet: 'ok', opus: 'ok', answer: '⚠️ 포인트 지급 못 함 — 주문 2건 애매 · 사람 확인 필요' });
    const p6 = await add('[VM] 포인트 지급 3,000 이름 김철수');
    await W.handle(db, p6); c = calls();
    ok('멈춤 답(사람 확인 필요) = Opus 재시도 0 · 완료', c.length === 1 && (await row(p6)).status === '완료', c);

    // ⑦ 그 밖 지시 = Opus 그대로 · 실패 = 대기 1회(종전)
    clearCalls(); mode({ sonnet: 'ok', opus: 'fail' });
    const o7 = await add('[VM] 체험 예약 화면 봐줘');
    const r7 = await W.handle(db, o7); c = calls();
    ok('그 밖 지시 = Opus 1번 · 실패 = 대기로(종전 그대로)', !r7.ok && (await row(o7)).status === '대기' && c.length === 1 && c[0].model === 'claude-opus-5-5' && !c[0].retry, { c, s: (await row(o7)).status });
    mode({ opus: 'ok' }); clearCalls();
    const r7b = await W.handle(db, o7); c = calls();
    ok('그 밖 지시 두 번째 = Opus · 완료', r7b.ok && c.length === 1 && c[0].model === 'claude-opus-5-5');

    // ⑧ 다시 집힌 줄(tries ≥ 2 · 재시작 뒤 포함) = 소넷 첫 실행에도 RETRY_NOTE
    clearCalls(); mode({ sonnet: 'ok', answer: '✅ 포인트 2,000원 지급 완료' });
    const p8 = await add('[VM] 포인트 지급 2,000 아이디 rr8');
    fs.writeFileSync(W.STATE, JSON.stringify({ [p8]: { n: 1, at: new Date().toISOString() } }));
    await W.handle(db, p8); c = calls();
    ok('다시 집힌 줄 = 소넷 첫 실행에도 「다시 시도」 글머리', c.length === 1 && c[0].model === 'claude-sonnet-5-5' && c[0].retry, c);
    clearCalls();
    const p9 = await add('[VM] 포인트 지급 2,000 아이디 rr9');
    await W.handle(db, p9); c = calls();
    ok('처음 집은 줄 = 글머리 없음', c.length === 1 && !c[0].retry, c);

    console.log('\n[5] 배송지 갈래 · 오늘 발주');
    clearCalls(); mode({ sonnet: 'ok', answer: '✅ 배송지 변경 완료\n2026110170868221 · 제주시 A → 제주시 B' });
    const a1 = await add('[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층');
    ok('발주 표 없음 = 안 나감', await W.finalSentToday(db) === false);
    await W.handle(db, a1); c = calls(); let ra = await row(a1);
    ok('배송지 = 소넷 · 안 나감 줄 · 거래처 줄 없음', c.length === 1 && c[0].model === 'claude-sonnet-5-5' && !c[0].sent && !ra.result.answer.includes('오늘 발주 나감'), { c, a: ra.result.answer });
    await pg.exec(`CREATE TABLE final_order_marks (ship_date DATE PRIMARY KEY, indiv JSONB NOT NULL DEFAULT '[]', hold JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT)`);
    ok('표만 있고 오늘 줄 없음 = 안 나감', await W.finalSentToday(db) === false);
    await pg.exec(`INSERT INTO final_order_marks (ship_date, updated_at) VALUES (CURRENT_DATE - 3, now() - interval '3 days')`);
    ok('사흘 전 줄만 = 안 나감', await W.finalSentToday(db) === false);
    await pg.exec(`INSERT INTO final_order_marks (ship_date, updated_at) VALUES (CURRENT_DATE + 1, now())`);
    ok('오늘 고친 표식 줄 = 나감', await W.finalSentToday(db) === true);
    clearCalls();
    const a2 = await add('[VM] 주소 변경 홍길동 010-1234-5678 → 서울 강남구 테헤란로 1');
    await W.handle(db, a2); c = calls(); ra = await row(a2);
    ok('나감 = 프롬프트에 알림 · 답 둘째 줄에 거래처 연락 1줄', c[0].sent && ra.result.answer.split('\n')[1] === W.SENT_LINE && ra.result.answer.split(W.SENT_LINE).length === 2, ra.result.answer);
    clearCalls(); mode({ sonnet: 'ok', answer: '✅ 배송지 변경 완료\n⚠ 오늘 발주 나감 → 거래처(효돈/대성)에 주소 변경 연락 필요\n끝' });
    const a3 = await add('[VM] 배송지 수정 2026110170868222 → 부산 해운대구 1');
    await W.handle(db, a3); ra = await row(a3);
    ok('모델이 이미 적은 줄 = 두 번 안 붙음', ra.result.answer.split('오늘 발주 나감').length === 2, ra.result.answer);
    clearCalls(); mode({ sonnet: 'ok', answer: '⚠️ 배송지 변경 못 함 — 주소 후보 2개' });
    const a4 = await add('[VM] 배송지 변경 2026110170868223 → 제주시 연동');
    await W.handle(db, a4); ra = await row(a4);
    ok('못 함 답 = 거래처 줄 안 붙음', !ra.result.answer.includes('오늘 발주 나감'), ra.result.answer);
    await pg.exec(`DELETE FROM final_order_marks`);
    await db.query(`INSERT INTO pending_orders (content, status, created_at) VALUES ('[최종발주] 11/10(화) 발송분', '완료', NOW())`);
    ok('「[최종발주]」 오늘 정리 기록 = 나감', await W.finalSentToday(db) === true);
    clearCalls(); mode({ sonnet: 'fail', opus: 'ok', answer: '✅ 배송지 변경 완료' });
    const a5 = await add('[VM] 배송지 변경 2026110170868224 → 제주시 노형동 1');
    await W.handle(db, a5); c = calls();
    ok('배송지 소넷 실패 → Opus 1회(재시도 글머리)', c.length === 2 && c[1].model === 'claude-opus-5-5' && c[1].retry && !c[0].retry, c);
    ok('「[최종발주]」 줄은 VM 이 안 집음', await W.pick(db) === null);
    return db;
}

async function keeptests(db) {
    console.log('\n[6] 센터 로그인 유지 틱');
    const seen = [], told = [];
    let next = { state: 'ok', where: 'sell.smartstore.naver.com/' };
    const fakeAside = () => ({ start: async () => ({}), replJson: async (title, code) => { seen.push({ title, lock: fs.existsSync(W.LOCK) ? fs.readFileSync(W.LOCK, 'utf8') : null }); if (next === 'throw') throw new Error('어사이드 응답 없음'); return next; }, stop: async o => { seen.push({ stop: o }); } });
    W._setKeep(fakeAside, async reason => { told.push(reason); return true; });
    const reset = () => { try { fs.unlinkSync(W.KEEP_STATE); } catch (e) { /* 없음 */ } };
    const kst = new Date(Date.now() + 9 * 3600e3), hm = kst.toISOString().slice(11, 16);
    void hm;   // #1088 keepMaybe 쉼 창 없음 = 아무 시각에도 돎
    reset();
    const k1 = await W.keepMaybe();
    ok('처음 = 돎 · ok', k1 && k1.state === 'ok' && seen.length >= 1, k1);
    ok('도는 동안 잠금을 잡음(vm-watch:pid) · 끝나면 풀림', seen[0].lock === 'vm-watch:' + process.pid && !fs.existsSync(W.LOCK), seen[0]);
    ok('탭 남김(keepTabs true)', seen.some(x => x.stop && x.stop.keepTabs === true));
    ok('30분 안 다시 부름 = 안 돎', await W.keepMaybe() === null);
    reset(); fs.writeFileSync(W.LOCK, '99999'); seen.length = 0;
    ok('남의 잠금(체험 틱) 있음 = 안 돎 · 남의 잠금 안 지움', await W.keepMaybe() === null && seen.length === 0 && fs.readFileSync(W.LOCK, 'utf8') === '99999');
    fs.unlinkSync(W.LOCK);
    reset(); next = { state: 'relogin', clicked: true };
    const k2 = await W.keepMaybe();
    ok('간편 로그인 다시 됨 = 텔레그램 0', k2.state === 'relogin' && told.length === 0);
    reset(); next = { state: 'need_phone' };
    const k3 = await W.keepMaybe(); const st3 = JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8'));
    ok('2단계·폰 승인 = 텔레그램 1통 · phone_at 적힘', k3.state === 'need_phone' && told.length === 1 && /2단계·폰 승인/.test(told[0]) && !!st3.phone_at && told[0].length <= 120, told);
    fs.writeFileSync(W.KEEP_STATE, JSON.stringify({ ...st3, at: new Date(Date.now() - 3600e3).toISOString() })); seen.length = 0;
    ok('폰 승인 뒤 3시간 안 = 30분 지나도 안 누름', await W.keepMaybe() === null && seen.length === 0);
    reset(); next = { state: 'login_fail' };
    await W.keepMaybe();
    ok('간편 로그인 안 됨 = 텔레그램 · 3시간 쉼', told.length === 2 && /간편 로그인 안 됨/.test(told[1]) && !!JSON.parse(fs.readFileSync(W.KEEP_STATE, 'utf8')).phone_at);
    reset(); next = 'throw';
    const k4 = await W.keepMaybe();
    ok('어사이드 오류 = state error · 텔레그램 0 · 잠금 풀림', k4.state === 'error' && told.length === 2 && !fs.existsSync(W.LOCK), k4);
    reset(); next = { state: 'ok' };
    const r = await W.pollOnce(db);
    ok('러너가 쉴 때(집을 지시 0) pollOnce 가 유지 틱을 돌림', r.idle && r.keep === 'ok', r);
    const r2 = await W.pollOnce(db);
    ok('바로 다음 주기 = 유지 틱 안 돎(idle 만)', r2.idle && !r2.keep, r2);
    W._setKeep(null, null);
    reset();
    ok('aside.exe 없는 PC(가짜 경로) = 아무것도 안 함', await W.keepMaybe() === null);
}

(async () => {
    units();
    const db = await dbtests();
    await keeptests(db);
    console.log(`\n결과: ${pass}/${pass + fail}`);
    try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #1041-b-A 나스 VM 러너: 총괄 → VM 지시 길(창구 대기열 pending_orders 「[VM]」 머리 지시만).
//   🔴 나스 VM(어사이드 전용 PC · 사용자 akkome)에서만 돌린다 · 등록 = scripts/vm/install-vm-watch.js --install(로그온 때 시작 · 작업 「아꼼이-VM러너」)
//   흐름: 30초마다 status '대기' + content 「[VM]」 머리 1건 → '처리중'(처리자 = audit vm_claim · source 'vm') →
//     ① 정해진 명령 갈래 = 본문이 「키워드 순위 확인·순위 다시」 류(RANK_RE · 짧은 한 마디만)면 claude 없이 `node scripts/desk/keyword-rank.js --apply`(#1001 · 텔레그램은 서버 틱이 종전대로 · 20분 상한)
//        → DB keyword_rank_last 를 읽어 「수집 n개 · 실패 · 막힘」 요약을 답으로
//     ② 그 밖 = `claude -p --model claude-opus-5-5 --output-format json --allowedTools mcp__aside__repl,mcp__aside__exec`(파일 읽기·Bash·쓰기 도구 막음 · 작업 폴더 ~/.akkome/vm-out/<지시번호> · 본문은 stdin)
//   집는 줄 = 「[VM]」 머리 줄 전부(#1042 · 11/6 대표 「전부 승인」 · 직원 포함 · 작성자 무관) · 창구 몫 = 머리 없는 줄 전부(창구가 어사이드 일은 「창구 → VM」 새 줄로 넘김)
//        → 답 글 + 「ATTACH: <경로>」 줄(VM ~/.akkome/vm-out/<지시번호>/ 안 파일만 · 5개 · 10MB · 창구 respond.js 확장자 목록) → report_files
//     → status '완료'(끝줄 「— 나스 VM 어사이드 처리」) · 실패 = 1회 '대기'로 되돌려 다시 → 두 번째도 실패면 '오류' + 사유
//   한 번에 하나: 어사이드 잠금 ~/.akkome/exp-phone-auto.lock 공유(체험 번호 틱과 같은 파일 · 1분마다 mtime 갱신 = 15분 stale 판정에 안 걸림) ·
//     키워드 순위 도는 중(~/.akkome/keyword-rank.json 오늘·결과 없음 = exp-phone-auto krBusy) 쉼 · 키워드 09:30 창 = claude 길 09:20~09:45 · 순위 갈래 09:10~09:45 쉼(상한만큼 앞당김 · 지시는 대기에 남음) · 잠금 잡기 = 'wx'
//   지시당 상한 10분(claude) · 20분(순위 · 포인트 지급) → 자식 트리째 끔(Windows taskkill /T /F)
//   #1056-a 포인트 보상 지급 갈래 = 본문이 「포인트 (보상) 지급」으로 시작(isPoint) → claude 길 그대로 + 프롬프트 규칙 ①에 포인트지급 화면 [회원검색]·[추가]·[확인]만 허용 · [절차] 블록(업무지식 절) · 상한 20분 · 09:10~09:45 쉼
//     실패 재집기(같은 줄 하루 2회)는 절차 (c) 「오늘 같은 아이디 지급 줄 있으면 지급 X」가 중복을 막음
//   #1082 포인트 갈래 = 소넷(FAST_MODEL · 10분) 먼저 → 실패(시간 초과·오류·빈 결과)면 Opus 1회(20분 · 글머리 RETRY_NOTE = 오늘 지급 줄 먼저 확인 · 애매하면 멈춤)
//     → 그래도 실패면 대기로 안 되돌리고 오류(실행 최대 2번 = 종전과 같음) · 이 갈래는 09:00~09:45 쉼(소넷+Opus 30분) · 아이디+주문번호 둘 다 있으면 찾기 건너뛰고 대조만(b-0)
//   #1083 배송지 변경 갈래(isAddr · 네이버만) = 같은 소넷 → Opus 1회 · [고객 배송지 정보수정]·주소 검색·[저장]만 허용 · 멈춤 조건(ADDR_STEPS e) ·
//     오늘 최종발주 나갔나 = 실DB 읽기(final_order_marks 오늘 · 「[최종발주]」 오늘 줄) → 저장했으면 답에 「⚠ 오늘 발주 나감 → 거래처 연락」 한 줄
//   #1082-② 센터 로그인 유지(keepMaybe) = 쉬는 동안 30분마다 센터 첫 화면 탭 새로고침(claude 0) · 로그인 화면 = 「간편 로그인」 1회 · 2단계·폰 승인 = 멈춤 + 텔레그램(서버 하루 1통) + 3시간 쉼
//   🔴 창구(get.js·respond.js)를 부르지 않고 같은 꼴을 여기서 쓴다 = 둘 다 창구 heartbeat(desk_heartbeat)를 덮어 창구 「자리 비움」 판정이 흐려지므로.
//     VM heartbeat = agent_office_config 'vm_heartbeat' {at, state, order_id, host} 따로(60초마다)
//   기동 복구 = 「[VM]」 머리 '처리중'만 '대기'로(자기 것만 · 창구 지시는 손대지 않음 · vm_heartbeat 2분 안에 살아 있는 러너가 돌리는 지시는 건너뜀)
//   로그 = ~/.akkome/logs/vm-watch-YYYY-MM-DD.log(지시 본문은 머리 60자만) · 시도 횟수 = ~/.akkome/vm-watch-state.json
//   사용: node scripts/vm/vm-watch.js            (계속 돎)
//         node scripts/vm/vm-watch.js --once     (한 번만 보고 끝 · 시험)
//         node scripts/vm/vm-watch.js --status   (잠금·키워드·상태 파일만 · DB 0)
//   env(시험용): VM_CLAUDE_BIN(.js 면 node 로 띄움) · VM_NODE_BIN · VM_RANK_SCRIPT · VM_POLL_MS · VM_ORDER_LIMIT_MS · VM_RANK_LIMIT_MS · VM_POINT_LIMIT_MS · VM_MODEL
//         · #1082 VM_FAST_MODEL · VM_FAST_LIMIT_MS · VM_ADDR_LIMIT_MS · VM_CENTER_KEEP_MS(0 = 로그인 유지 끔) · ASIDE_EXE
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();
const DIR = path.join(HOME, '.akkome'), LOG_DIR = path.join(DIR, 'logs');
const LOCK = path.join(DIR, 'exp-phone-auto.lock'), LOCK_STALE_MS = 15 * 60000;   // exp-phone-auto.js 와 같은 파일·같은 판정
const STATE = path.join(DIR, 'vm-watch-state.json');
const OUT_DIR = path.join(DIR, 'vm-out');
const HEAD = '[VM]';
const POLL_MS = Number(process.env.VM_POLL_MS) || 30000, BEAT_MS = 60000;
const ORDER_LIMIT_MS = Number(process.env.VM_ORDER_LIMIT_MS) || 10 * 60000;
const RANK_LIMIT_MS = Number(process.env.VM_RANK_LIMIT_MS) || 20 * 60000;
const POINT_LIMIT_MS = Number(process.env.VM_POINT_LIMIT_MS) || 20 * 60000;   // #1056-a 포인트 보상 지급 갈래(센터 로그인·주문 대조·지급 · 실건 약 15분)
const MODEL = process.env.VM_MODEL || 'claude-opus-5-5';
// #1082 포인트·#1083 배송지 갈래 = 먼저 소넷(빠름) → 실패(시간 초과·오류·빈 결과)면 같은 지시를 Opus 로 1회(재시도 글머리에 「중복 확인 먼저」) · 그 밖 지시는 종전 MODEL 그대로
const FAST_MODEL = process.env.VM_FAST_MODEL || 'claude-sonnet-5-5';
const FAST_LIMIT_MS = Number(process.env.VM_FAST_LIMIT_MS) || 10 * 60000;   // 소넷 상한(실건 5~7분) · 이어 Opus 20분 = 합 30분 → 이 두 갈래는 09:00 부터 쉼(SKIP_FAST)
const ADDR_LIMIT_MS = Number(process.env.VM_ADDR_LIMIT_MS) || 20 * 60000;    // #1083 배송지 변경 Opus 재시도 상한
// #1082-② 센터 로그인 유지 = 러너가 쉬는 동안 30분마다 센터 탭 가벼운 새로고침(claude 안 부름 · aside MCP 직접) · 0 = 끔
const KEEP_MS = process.env.VM_CENTER_KEEP_MS != null && process.env.VM_CENTER_KEEP_MS !== '' ? Number(process.env.VM_CENTER_KEEP_MS) : 30 * 60000;
const KEEP_STATE = path.join(DIR, 'vm-center-keep.json');
const KEEP_PHONE_BACKOFF_MS = 3 * 3600e3;   // 2단계·폰 승인 화면을 본 뒤 3시간은 다시 안 누름(텔레그램은 서버가 하루 1통)
const CENTER_HOME = 'https://sell.smartstore.naver.com/#/home/dashboard';
const ALLOWED = 'mcp__aside__repl,mcp__aside__exec';   // 어사이드만(교차 점검 2 · 파일 읽기 도구는 .env 유출 길이라 막음)
const DENIED = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Read,Grep,Glob';
// claude 작업 폴더 = 늘 ~/.akkome/vm-out/<지시번호>(리포 밖 = 리포 CLAUDE.md 안 실림 · .env 있는 C:\akm-vm 도 피함 · aside MCP 는 user 설정이라 그대로)
const TOUCH_MS = Number(process.env.VM_TOUCH_MS) || 60000;   // 도는 동안 잠금 mtime·vm_heartbeat(busy) 갱신 간격
const MAX_TRIES = 2;   // 첫 실패 = 대기로 한 번 되돌림 · 두 번째 실패 = 오류
// 키워드 순위 09:30 창 피하기 = 상한만큼 앞당김(claude 10분 → 09:20 · 순위 20분 → 09:10)
const SKIP_CLAUDE = ['09:20', '09:45'], SKIP_RANK = ['09:10', '09:45'], SKIP_FAST = ['09:00', '09:45'];   // #1082 SKIP_FAST = 소넷 10분 + Opus 20분
// 정해진 명령 갈래: 「[VM]」 뒤 본문이 이 꼴의 짧은 한 마디일 때만(「키워드 순위 관리 화면 고쳐줘」 처럼 다른 일이 섞이면 claude 길)
const RANK_RE = /^(?:키워드\s*)?순위\s*(?:확인|다시|재수집|수집|돌려|체크)?\s*(?:다시)?\s*(?:해\s*줘|해\s*주세요|해|좀|부탁(?:해)?|요)?[\s.!?~]*$/;
const FROM_DESK = '창구 → VM';   // 창구가 승인 뒤 넘긴 줄의 created_by
const RANK_MAX_LEN = 30;
const ATTACH_EXT = ['xlsx', 'xls', 'csv', 'md', 'txt', 'pdf', 'docx', 'doc', 'pptx', 'hwp', 'hwpx', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'];   // respond.js 와 같음
const clean = (s, n) => String(s == null ? '' : s).slice(0, n);
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDay = () => kstNow().toISOString().slice(0, 10);

function log(msg) {
    const line = new Date().toISOString() + ' ' + msg;
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(path.join(LOG_DIR, `vm-watch-${kstDay()}.log`), line + '\n'); } catch (e) { /* 기록 실패 무시 */ }
    if (process.stdout.isTTY || process.env.VM_LOG_STDOUT === '1') console.log(line);
}
const bodyOf = content => String(content || '').replace(/^\[VM\]\s*/, '').trim();
const head60 = content => bodyOf(content).replace(/\s+/g, ' ').slice(0, 60);
function isRank(content) { const b = bodyOf(content); return b.length > 0 && b.length <= RANK_MAX_LEN && RANK_RE.test(b); }
// #1056-a 포인트 보상 지급 갈래 = 본문이 「포인트 (보상) 지급」으로 시작(업무지식 「네이버페이 포인트 보상 지급」 절 · 직원 누구나 · 승인 없음 = 대표 11/8)
const POINT_RE = /^포인트\s*(?:보상\s*)?지급/;
// #1064(11/9 지시 #3528 「[VM] saygoodjod 네이버페이 보상처리진행해줘! 포인트 지급이고 …」 이 갈래를 못 탐) = 본문 어디든
//   (포인트 && 지급) · 보상 처리/지급 · (네이버페이 && 보상) 이면 포인트 갈래 · 순위 갈래(isRank)가 먼저라 「순위 확인」류는 겹치지 않음
const POINT_AMT = /\d{1,3}(?:,\d{3})+|\d+\s*(?:원|천)/, POINT_ASK = /내역|얼마|확인|봐\s*줘/;
const POINT_ANY = [s => POINT_RE.test(s), s => /포인트/.test(s) && /지급/.test(s), s => /보상\s*(?:처리|지급)/.test(s), s => /네이버\s*페이/.test(s) && /보상/.test(s),
    s => /포인트/.test(s) && /보상/.test(s) && (POINT_AMT.test(s) || /아이디/.test(s) || /\d{16}/.test(s)) && !POINT_ASK.test(s)];   // #1082 「아이디 abc 포인트 보상 5,000」(사유 없이)도 포인트 갈래 = 금액·아이디·주문번호 있을 때만 · 조회 꼬리(내역·얼마·확인·봐줘) 제외(워커1 점검)
function isPoint(content) { const b = bodyOf(content); return !isRank(content) && POINT_ANY.some(f => f(b)); }
// #1083 배송지 변경 갈래(네이버만) · 순위·포인트 갈래가 먼저 · 워커1 점검 = 「주소」 단독은 URL 뜻과 겹침 →
//   (「배송지·받는 곳」 또는 「주소」 + 상품주문번호 16자리·전화번호 꼴) && 변경 류 · 조회 꼬리(확인·봐줘·있는지·됐는지·알려)는 제외(단 주문번호·「→」 있으면 실행 지시)
const ADDR_ACT = /(?:변경|수정|바꿔|바꾸|바꿀|바뀐|정정)/, ADDR_ASK = /(?:확인|봐\s*줘|봐\s*주|있는지|됐는지|되었는지|알려)/;
const ORDER_NO_RE = /\d{16}/, PHONE_RE = /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/;
function isAddr(content) {
    const b = bodyOf(content);
    if (isRank(content) || isPoint(content) || !ADDR_ACT.test(b)) return false;
    if (!(/배송지|받는\s*곳/.test(b) || (/주소/.test(b) && (ORDER_NO_RE.test(b) || PHONE_RE.test(b))))) return false;
    return !(ADDR_ASK.test(b) && !ORDER_NO_RE.test(b) && !/→|->/.test(b));
}
const isFast = content => isPoint(content) || isAddr(content);   // 소넷 → Opus 1회 갈래

// ── 쉼 판단(어사이드 한 번에 하나) ──
function krBusy() { try { return require('./exp-phone-auto.js').krBusy(); } catch (e) { return false; } }
// k = kstNow() 꼴(UTC 칸에 KST) · rank = 순위 갈래면 09:10 부터 · 아니면 09:20 부터
function inSkip(k, rank) { const w = rank === 'fast' ? SKIP_FAST : rank ? SKIP_RANK : SKIP_CLAUDE; const hm = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0'); return hm >= w[0] && hm < w[1]; }
function lockBusy() { try { return fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < LOCK_STALE_MS; } catch (e) { return false; } }
function busyWhy() { if (krBusy()) return '키워드 순위 도는 중'; if (lockBusy()) return '어사이드 잠금(체험 번호 틱 등)'; return ''; }
const LOCK_MARK = () => 'vm-watch:' + process.pid;
// 잠금 잡기 = 'wx'(이미 있으면 실패 · 두 프로세스가 동시에 잡아도 하나만) · 15분 넘은 낡은 잠금만 지우고 다시 시도
function lockTake() {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        if (fs.existsSync(LOCK)) { if (lockBusy()) return false; try { fs.unlinkSync(LOCK); } catch (e) { /* 남이 먼저 지움 */ } }
        const fd = fs.openSync(LOCK, 'wx'); try { fs.writeSync(fd, LOCK_MARK()); } finally { fs.closeSync(fd); }
        return true;
    } catch (e) { return false; }
}
function lockTouch() { try { if (fs.readFileSync(LOCK, 'utf8') === LOCK_MARK()) { const t = new Date(); fs.utimesSync(LOCK, t, t); } } catch (e) { /* 무시 */ } }
function lockFree() { try { if (fs.readFileSync(LOCK, 'utf8') === LOCK_MARK()) fs.unlinkSync(LOCK); } catch (e) { /* 무시 */ } }

// ── 시도 횟수(로컬 파일 · 7일 지난 것은 지움) ──
function stateRead() { try { const j = JSON.parse(fs.readFileSync(STATE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function stateWrite(s) {
    const cut = Date.now() - 7 * 86400e3;
    for (const k of Object.keys(s)) if (!s[k] || Date.parse(s[k].at || '') < cut) delete s[k];
    try { fs.mkdirSync(DIR, { recursive: true }); const tmp = STATE + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, STATE); } catch (e) { log('상태 파일 쓰기 실패(무시): ' + e.message); }
}
function triesBump(id) { const s = stateRead(); const cur = s[id] || { n: 0 }; cur.n++; cur.at = new Date().toISOString(); s[id] = cur; stateWrite(s); return cur.n; }
function triesClear(id) { const s = stateRead(); if (s[id]) { delete s[id]; stateWrite(s); } }

// ── DB(창구 get.js·respond.js 와 같은 꼴 · heartbeat 만 따로) ──
function step(kind, text) { return { t: new Date().toISOString(), kind, actor: '클코(VM)', text: String(text).slice(0, 300) }; }
async function audit(db, action, id, after) {
    try { await db.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ($1, 'pending_order', $2, $3, 'vm', '클코(나스 VM)')`, [action, id, JSON.stringify({ after })]); }
    catch (e) { log('audit 실패(무시): ' + e.message); }
}
async function heartbeat(db, state, orderId) {
    try {
        await db.query(`INSERT INTO agent_office_config (key, value) VALUES ('vm_heartbeat', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify({ at: new Date().toISOString(), state, order_id: orderId || null, host: os.hostname(), pid: process.pid })]);
    } catch (e) { log('heartbeat 실패(무시): ' + e.message); }
}
const pidAlive = pid => { try { process.kill(Number(pid), 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };
// 기동 복구 = 「[VM]」 처리중만 대기로 · 단 vm_heartbeat 가 2분 안이고 그 지시를 돌리는 중이면 건너뜀
//   (같은 기계면 그 pid 가 살아 있고 내가 아닐 때만 = 앞 러너가 죽고 1분 뒤 다시 뜬 경우는 되돌림 · 다른 기계면 그대로 건너뜀)
async function recoverOwn(db) {
    let hb = null; try { hb = ((await db.query(`SELECT value FROM agent_office_config WHERE key = 'vm_heartbeat'`)).rows[0] || {}).value || null; } catch (e) { hb = null; }
    const hbFresh = !!(hb && Date.now() - Date.parse(hb.at || '') < 2 * 60000);
    const live = hbFresh && hb.order_id && (hb.host !== os.hostname() || (Number(hb.pid) !== process.pid && pidAlive(hb.pid))) ? Number(hb.order_id) : null;
    const r = await db.query(`UPDATE pending_orders o SET status = '대기' WHERE o.status = '처리중' AND o.is_deleted = false AND o.content LIKE '[VM]%' AND o.id <> $1 RETURNING o.id`, [live || 0]);   // #1042 「[VM]」 머리 전부 = VM 몫(pick·claim 과 같은 집합)
    if (live) log(`기동 복구: #${live} 는 살아 있는 VM 러너가 처리 중(heartbeat) — 그대로 둠`);
    for (const x of r.rows) { log(`기동 복구: #${x.id} 대기로(앞 VM 러너가 집은 채 꺼짐)`); await audit(db, 'vm_recover', x.id, { status: '대기' }); }
    return r.rows.map(x => Number(x.id));
}
// 집기 전 방어(중복 실행 0): ①VM 이 이미 답을 올린 줄(audit desk_respond · source vm)이 누가 '대기'로 되돌렸으면 안 집고 결과대로 완료/오류로 되돌림
//   ②같은 지시는 하루 MAX_CLAIMS_DAY 번까지만 집음(audit desk_claim · source vm · KST 날짜)
const MAX_CLAIMS_DAY = 2;
// 누가 넣은 줄을 집나 = #1042 직원 포함 전부(작성자 거름 없음 · 「[VM]」 머리만이 VM 몫 ↔ 창구 몫 경계 · 창구·서버 거름 = NOT (content LIKE '[VM]%'))
const VM_DONE = `EXISTS (SELECT 1 FROM audit_logs a WHERE a.target_type = 'pending_order' AND a.target_id = o.id AND a.source = 'vm' AND a.action = 'desk_respond')`;
async function pick(db) {
    const fix = await db.query(`UPDATE pending_orders o SET status = CASE WHEN o.result->>'type' = 'error' THEN '오류' ELSE '완료' END
        WHERE o.is_deleted = false AND o.status = '대기' AND o.content LIKE '[VM]%' AND o.result->>'type' IN ('desk_answer', 'error') AND ${VM_DONE} RETURNING o.id, o.status`);
    for (const x of fix.rows) { log(`#${x.id} 이미 답한 줄이 대기로 되돌려져 있어 ${x.status}(으)로 되돌림(다시 안 돌림)`); await audit(db, 'vm_redone', Number(x.id), { status: x.status }); }
    const r = await db.query(`SELECT o.id FROM pending_orders o WHERE o.is_deleted = false AND o.status = '대기' AND o.content LIKE '[VM]%' AND o.content NOT LIKE '[검증469]%'
          AND NOT ${VM_DONE}
          AND (SELECT COUNT(*) FROM audit_logs a WHERE a.target_type = 'pending_order' AND a.target_id = o.id AND a.source = 'vm' AND a.action = 'desk_claim'
               AND (a.created_at + interval '9 hours')::date = $1::date) < $2
        ORDER BY o.id ASC LIMIT 1`, [kstDay(), MAX_CLAIMS_DAY]);
    return r.rows[0] ? Number(r.rows[0].id) : null;
}
async function claim(db, id) {
    const c = await db.query(`UPDATE pending_orders o SET status = '처리중' WHERE o.id = $1 AND o.is_deleted = false AND o.status = '대기' AND o.content LIKE '[VM]%'
        RETURNING o.id, o.content, o.run_id, o.created_by, o.created_by_id, (o.image_data IS NOT NULL) AS has_image`, [id]);
    if (!c.rows.length) return null;
    const o = c.rows[0];
    if (!o.run_id) {
        try {
            const maru = (await db.query(`SELECT id FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
            const run = (await db.query(`INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, FALSE) RETURNING id`,
                [maru ? maru.id : null, JSON.stringify([step('order', `📥 지시 접수(나스 VM) — ${o.created_by || '총괄'}`)])])).rows[0];
            o.run_id = run.id;
            await db.query(`UPDATE pending_orders SET run_id = $2 WHERE id = $1`, [id, run.id]);
        } catch (e) { log(`#${id} 실행 기록 만들기 실패(무시): ${e.message}`); }
    }
    await audit(db, 'desk_claim', id, { status: '처리중', who: 'vm', host: os.hostname() });   // 창구와 같은 흔적(action desk_claim) · source 'vm'
    return o;
}
async function appendStep(db, runId, kind, text) { if (runId) { try { await db.query(`UPDATE agent_runs SET steps = steps || $2::jsonb WHERE id = $1`, [runId, JSON.stringify([step(kind, text)])]); } catch (e) { /* 무시 */ } } }
async function uploadAttachments(db, list, runId) {
    const out = [];
    for (const fp of list.slice(0, 5)) {
        const buf = fs.readFileSync(fp);
        const r = await db.query(`INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, $2, $3, $4) RETURNING id`, [clean(path.basename(fp), 190), runId || null, buf, buf.length]);
        out.push({ label: clean(path.basename(fp), 190), file_id: r.rows[0].id, size: buf.length });
    }
    return out;
}
// 결과 올리기: kind 'answer' {answer, title, attachments:[경로]} | 'error' {error}
async function respond(db, o, j) {
    let status, result, stepText, runStatus = 'done', uploadedIds = [];
    if (j.kind === 'answer') {
        status = '완료';
        const up = await uploadAttachments(db, j.attachments || [], o.run_id); uploadedIds = up.map(x => x.file_id);
        const answer = clean(String(j.answer || '').replace(/\s+$/, '') + (up.length ? '\n\n첨부는 10일 뒤 여기서 지워져요(필요하면 내려받아 두세요)' : '') + '\n\n— 나스 VM 어사이드 처리', 20000);   // 창구 답 꼴(#922) · VM 은 나스 보관 폴더가 없어 그 안내는 없음
        result = { type: 'desk_answer', title: clean(j.title || '', 80), answer, files: up, summary: clean(j.title || j.answer, 80), by: 'vm' };
        stepText = '✅ 답변 완료(나스 VM)';
    } else {
        status = '오류';
        result = { type: 'error', error: clean(j.error, 1000), by: 'vm' };
        stepText = '⚠️ 오류(나스 VM)'; runStatus = 'error';
    }
    // '대기' = 도는 사이 창구·서버 기동 복구가 되돌린 줄(respond.js 와 같은 조건) → 결과를 올려 다시 집히지 않게(중복 실행 막기)
    const u = await db.query(`UPDATE pending_orders SET status = $2, result = $3, processed_at = NOW() WHERE id = $1 AND status IN ('처리중', '대기')`, [o.id, status, JSON.stringify(result)]);
    if (!u.rowCount) {   // 그 사이 사람이 「채팅 종료」 등 → 덮지 않음 · 올린 첨부는 숨김
        if (uploadedIds.length) await db.query(`UPDATE report_files SET is_deleted = true WHERE id = ANY($1::int[])`, [uploadedIds]).catch(() => { });
        log(`#${o.id} 그 사이 상태가 바뀌어 결과를 올리지 않음`); return { ok: false, reason: 'changed' };
    }
    await appendStep(db, o.run_id, runStatus === 'error' ? 'error' : 'report', stepText);
    if (o.run_id) {
        try {
            await db.query(`UPDATE agent_runs SET status = $2, finished_at = NOW(), result = $3 WHERE id = $1`, [o.run_id, runStatus, JSON.stringify({
                summary: result.summary || result.error || stepText,
                lines: String(result.answer || result.error || '').split(/\r?\n/).filter(Boolean).slice(0, 300),
                report: { type: result.type, question: o.content, answer: result.answer || result.error || '' } })]);
        } catch (e) { /* 무시 */ }
    }
    // 종 알림 = 요청자에게(시험 = [검증469] 머리·990000 번 계정은 안 만듦 — respond.js 와 같은 기준)
    try {
        const isTest = String(o.content || '').startsWith('[검증469]') || Number(o.created_by_id) >= 990000;
        if (!isTest && o.created_by_id) {
            const title = status === '오류' ? '⚠️ 나스 VM — 처리하지 못했어요' : '✅ 나스 VM 이 답했어요';
            await db.query(`INSERT INTO notifications (user_id, type, title, message, link, pushed_at) VALUES ($1, 'desk', $2, $3, $4, NULL)`,
                [o.created_by_id, title, clean(result.summary || result.error || '', 120), 'agent-office?o=' + o.id]);
        }
    } catch (e) { log('알림 기록 실패(무시): ' + e.message); }
    await audit(db, 'desk_respond', o.id, { status, type: result.type, who: 'vm', files: uploadedIds.length });
    return { ok: true, status };
}
async function backToWait(db, o, why) {
    const u = await db.query(`UPDATE pending_orders SET status = '대기' WHERE id = $1 AND status = '처리중'`, [o.id]);
    await appendStep(db, o.run_id, 'error', '↩️ 나스 VM 실패 — 한 번 더 시도: ' + clean(why, 200));
    await audit(db, 'vm_retry', o.id, { status: '대기', why: clean(why, 200) });
    return u.rowCount > 0;
}

// ── 자식 실행(상한 넘으면 트리째 끔) ──
function killTree(pid) {
    if (!pid) return;
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch (e) { /* 이미 끝 */ } }
    else { try { process.kill(-pid, 'SIGKILL'); } catch (e) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* 이미 끝 */ } } }
}
function run(bin, args, { input, limitMs, cwd, onTick }) {
    return new Promise(resolve => {
        let cmd = bin, a = args;
        if (/\.js$/i.test(bin)) { cmd = process.execPath; a = [bin, ...args]; }   // 시험용 가짜 실행 파일
        let ch; try { ch = spawn(cmd, a, { cwd: cwd || ROOT, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
        catch (e) { return resolve({ code: -1, out: '', err: '띄우기 실패: ' + e.message, timeout: false }); }
        let out = '', err = '', done = false, timeout = false;
        const fin = code => { if (done) return; done = true; clearTimeout(t); clearInterval(touch); resolve({ code, out, err, timeout }); };
        const t = setTimeout(() => { timeout = true; killTree(ch.pid); setTimeout(() => fin(null), 2000); }, limitMs);
        const touch = setInterval(() => { lockTouch(); if (onTick) Promise.resolve().then(onTick).catch(() => { }); }, TOUCH_MS);   // 잠금 mtime + vm_heartbeat(busy) 같이
        ch.stdout.on('data', d => { if (out.length < 4e6) out += d; });
        ch.stderr.on('data', d => { if (err.length < 2e5) err += d; });
        ch.on('error', e => { err += '띄우기 실패: ' + e.message; fin(-1); });
        ch.on('close', code => fin(code));
        try { ch.stdin.end(input || ''); } catch (e) { /* 무시 */ }
    });
}
function claudeCwd(id) { const d = path.join(OUT_DIR, String(id)); fs.mkdirSync(d, { recursive: true }); return d; }
function findClaude() {
    if (process.env.VM_CLAUDE_BIN) return process.env.VM_CLAUDE_BIN;
    const cands = [path.join(HOME, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')];
    for (const c of cands) if (fs.existsSync(c)) return c;
    return 'claude';
}
// #1056-a 포인트 지급 절차(★에이전트오피스/업무지식.md 「### 네이버페이 포인트 보상 지급」 절을 러너용으로 옮김 · 그 절을 고치면 여기도)
// #1086(대표 「고」 · VM #3549 실측) 톡톡 손님으로 온 지시 = 톡톡 파트너센터 대화방 「스마트 요약」 › 구매이력 → 상품주문번호 상세 창(보기 전용)에서 구매자 ID 전체·수취인·주소를 읽는 길
const TALK_STEP = next => `(b-t) #1086 지시가 톡톡 손님(톡톡 아이디 앞부분·닉네임 · 대화 시각 · 글 첫마디)이면 먼저 이 길 = partner.talk.naver.com 상담 목록에서 그 대화를 찾아 연다(아이디·시각·글로 하나로 맞을 때만 · 대화 윗줄 고객 아이디는 앞부분만 보인다 예 ceo ↔ 실제 ceo72388) → 오른쪽 「스마트 요약」 › 구매이력 탭에서 지시 품목·날짜에 맞는 상품 줄 1개 → 그 줄의 상품주문번호 링크 → 새 창 주문 상세(sell.smartstore.naver.com …/order/popup/<상품주문번호>/productOrderDetail · 보기 전용)에서 구매자 ID 전체·수취인·연락처·주소·송장을 읽는다 → 그 값으로 ${next}. 맞는 대화가 0건이거나 둘 이상 · 또는 구매이력에서 지시 품목에 맞는 상품 줄이 0건이거나 둘 이상이면 아래 (b) 센터 검색 길로 · 그래도 애매하면 멈춘다. 🔴 톡톡 파트너센터에서는 읽기와 대화·탭·링크 누르기만 한다 — 메시지 보내기·태그·메모·상태 바꾸기 0.`;
const POINT_STEPS = [   // #1080(대표 11/9 23:1x) ①구매자 아이디 회원검색 · 목적 = 구매확정 이력 있으면 구매 프로모션 적립 · 없으면 비구매 적립 ②중복 = 오늘 같은 아이디만 멈춤 ③주문 찾기 최근 3개월 ④지급 화면 매번 새로 · [지급대상 확인] 무반응 = 처음부터 1회만 다시 ⑤비즈월렛 자동충전(잔액은 보고 줄에만)
    '[절차] 네이버페이 포인트 보상 지급',
    '(a) 스마트스토어센터 로그인 = 커머스ID 「간편 로그인」 단추(비밀번호 입력 X · 금고 자동 채움). 2단계 인증·보안 확인이 뜨면 규칙 ②대로 멈춘다.',
    TALK_STEP('(b-0)(아이디+주문번호 대조)'),
    '(b-0) #1082 지시에 구매자 네이버 아이디와 주문번호가 둘 다 적혀 있으면 찾는 단계를 건너뛴다 → 주문통합검색(최근 3개월)에서 그 주문번호 1건만 열어 구매자ID = 지시 아이디 · 품목 · 결제금액 · (지시에 손님 이름·번호가 있으면 그것도) 맞는지 대조만 → 셋 다 맞을 때만 (c)(d)(e) 대로 지급 · 하나라도 다르면 (f) 대로 멈춘다.',
    '(b-1) #1064 지시에 네이버 아이디(영문·숫자 아이디 · 예 saygoodjod)가 직접 적혀 있으면 주문 한 건을 특정할 필요가 없다 → 센터 회원검색에서 그 아이디 1건 확인 + 판매관리 › 주문통합검색(기간 = 최근 3개월)에서 구매자ID 로 지시 품목(예 타이벡) 주문이 1건 이상 있는지만 확인한다(여러 건이어도 OK · 어느 건인지 가리지 않음) → (c)(d)(e) 대로 지급. 「주문이 여럿이라 어느 건인지 몰라 못 함」 식으로 멈추지 않는다.',
    '(b) 아이디 없이 주문번호(또는 이름·끝4·「오늘 n시 톡톡」)로 온 지시 = 판매관리 › 주문통합검색(기간 = 최근 3개월 · 한 달 넘어 연락 오는 손님도 있다)에서 주문을 찾아 구매자 아이디·품목·결제금액·구매확정 여부를 확인한다 → 그 **구매자 아이디**로 지급한다. #1084 찾는 실마리 = 주문번호 · 구매자 이름·번호 · **수취인(받는 분) 이름·전체 번호** · **운송장번호(12자리 · 예 601331878612)** · 품목·날짜 — 어느 것으로 찾았든 주문 하나로 맞으면 지급은 늘 그 주문의 **구매자 아이디**로 한다(받는 분 ≠ 구매자인 선물 주문이어도 멈추지 않는다). 주문통합검색에 수취인연락처·송장번호 검색 조건이 없으면 번호 끝4·이름·날짜·품목으로 좁힌 뒤 주문 상세를 열어 수취인 번호·운송장번호를 하나씩 대조한다(짐작 금지 · 상세에서 확인한 주문만). 톡톡 아이디가 닉네임이거나 끝 밑줄 「_」이 빠져 보이면 톡톡 파트너센터 손님 정보 → 주문이력 → 주문번호로 묶고, 센터 회원검색 0건이면 이름 검색 뒤 마스킹 앞 글자로 대조한다.',
    '(c) 중복 막기 = 혜택/마케팅 › 포인트 지급관리 목록(지급 시점 「오늘」)에서 **오늘** 같은 아이디 지급 줄이 있을 때만 지급하지 않고 「이미 오늘 지급됨 · 일련번호 · 금액」으로 답한다(다시 집힌 지시도 이 확인으로 중복 0). 어제·지난달 등 그 전 지급은 막지 않는다 — 지급은 그대로 하고 끝 보고에 「전에도 받음: 날짜 · 금액 · 사유」 한 줄만. 화면의 「최근 30일 지급」 칸에 값이 나와도 그것 때문에 멈추지 않는다.',
    '(d) 지급 화면은 매번 새로 연다(혜택/마케팅 › 포인트 지급관리 메뉴로 들어가거나 새로 고침 · 전에 열어 둔 탭·입력 칸을 그대로 쓰지 않는다) → [포인트 지급] = 지급 목적(그 아이디에 구매확정 이력이 있으면 「구매 프로모션 적립」 · 없으면 「비구매 적립」) · 지급사유 = 지시 글 그대로(15자 안) · 금액 = 지시 금액 그대로(다른 금액·다른 손님 X) → 회원검색에 그 구매자 아이디 → 추가 → [지급대상 확인](지급대상 1명·금액 · 지급불가 사유 없음 확인) → [확인] → 확인창 [확인] 1회. 「서비스에 에러」 띠가 뜨면 목록에 새 줄이 없을 때만 1회 더(중복 0).',
    '(d-2) [지급대상 확인]을 눌러도 반응이 없으면(창·결과 표가 안 뜸) → 지급 목록(오늘)에 새 줄이 없는지 먼저 확인(지급 0) → 지급 화면을 새로 열어 (d) 를 처음부터 **1회만** 다시 → 그래도 반응이 없으면 지급하지 말고 멈춰 「⚠️ 포인트 지급 못 함 — [지급대상 확인] 무반응(2회) · 지급 0 확인」과 화면 값으로 답한다.',
    '(e) 끝 보고(#1076 대표 꼴) = 첫 줄 「✅ 포인트 n,nnn원 지급 완료」(실패면 「⚠️ 포인트 지급 못 함 — 까닭」) → 일련번호 · 받는 분 이름 · 네이버 아이디 전체 · 금액 · 사유 · 지급 목적 · 지급 시각 · 비즈월렛 잔액(자동충전 설정됨 = 잔액 부족 걱정 문구 쓰지 않음 · 숫자만) · 성공/실패 수 · (그 전 지급이 있으면) 「전에도 받음: 날짜 · 금액 · 사유」 · (#1084 수취인·운송장번호로 찾았으면) 「수취인으로 찾음 → 구매자 ○○(아이디 전체)에게 지급」 한 줄 → 마지막에 「손님께 보낼 톡톡 예문」 한 덩이(보상 n원 네이버페이 포인트로 넣어 드렸다는 사과·감사 2~3문장 · 보내기는 사람).',
    '(f) (b) 길(주문번호·이름·끝4·톡톡 시각·수취인·운송장번호) = 지시의 손님 ↔ 주문(품목·결제금액·받은 날) ↔ 아이디 셋 중 하나라도 안 맞거나 후보가 둘 이상(0건)이거나 애매하면(지시 손님이 그 주문의 받는 분이고 구매자가 다른 사람인 것은 「안 맞음」이 아니다 — 구매자 아이디로 지급) / (b-1) 길(아이디 직접) = 회원검색 0건·2건↑이거나 그 아이디에 지시 품목 주문이 0건이면 → 지급하지 않고, 무엇이 안 맞는지 화면 값(이름·번호·네이버 아이디 전체 · 주문번호 · 금액 · 목적)으로 답한다. 손님에게 보내는 톡톡 답은 지시에 「답도 보내」가 있을 때만(없으면 사람 몫).',
    '(g) 지시 글 꼴 예시: 「[VM] 아이디 saygoodjod 포인트 보상 5,000 · 사유 타이벡 파손 보상처리」 · 「[VM] 포인트 보상 지급 주문번호 2026110539641061 6,000 · 사유 타이벡 파손 보상처리」.',
];
// #1083 배송지 변경 절차(네이버만 · 실례 #952 = 11/2 상품주문 2026110170868221) · 업무지식 「배송지 변경(VM)」 절과 같게
const ADDR_STEPS = [
    '[절차] 네이버 주문 배송지 변경(스마트스토어센터 · 쿠팡·자사몰 주문이면 하지 말고 「네이버 주문만 VM 이 바꿔요 · 사람 확인 필요」로 답한다)',
    '(a) 센터 로그인 = 커머스ID 「간편 로그인」 단추(비밀번호 입력 X · 금고 자동 채움). 2단계 인증·보안 확인이 뜨면 규칙 ②대로 멈춘다.',
    TALK_STEP('(c)(배송준비 화면 [고객 배송지 정보수정] · 상세 창은 보기 전용이라 거기서 고치지 않는다)'),
    '(b) 판매관리 › 배송준비(발주확인 끝난 주문 · 없으면 주문통합검색 최근 3개월)에서 주문을 찾는다 = 지시의 (상품)주문번호가 있으면 그것 먼저 · 없으면 구매자 또는 수취인 이름 + 전화번호로. 손님 ↔ 주문이 정확히 하나로 맞을 때만 다음으로.',
    '(c) 그 주문의 [고객 배송지 정보수정] → 주소 검색에 지시의 새 주소(도로명·지번)를 넣어 찾는다 → 후보가 정확히 1개일 때만 고르고 상세주소(동·호수 등)를 지시 그대로 넣는다 → 저장 1회. 받는 분 이름·번호를 바꾸라는 지시가 있으면 그 칸도 지시 그대로(없으면 그대로 둔다).',
    '(d) 저장 뒤 그 주문을 다시 열어(새로 고침) 바뀐 주소가 지시와 같은지 확인한다. 같은 화면에서 저장을 두 번 누르지 않는다(이미 새 주소면 다시 저장 X).',
    '(e) 멈춤(저장하지 않음) = 발송처리 됐거나 배송준비·발주확인 상태가 아님 · 후보 주문이 둘 이상이라 애매 · 주소 검색 후보 0개 또는 2개 이상 · 지시의 이름·번호가 주문과 안 맞음 · 새 주소가 지시에 없거나 덜 적힘 → 무엇이 안 맞는지 화면 값(이름·번호 전체 · 주문번호 · 주문 상태 · 검색 후보)으로 답한다.',
    '(f) 배송 메모(문 앞에 놔 주세요 등)를 바꾸라는 말이 있으면 센터에 그 칸이 없다(#952) → 답에 「배송 메모는 센터에 칸 없음 → 발주 메모함에 넣어 주세요: <메모 글>」 한 줄.',
    '(g) 끝 보고 = 첫 줄 「✅ 배송지 변경 완료」(멈췄으면 「⚠️ 배송지 변경 못 함 — 까닭」) → 상품주문번호 · 받는 분 이름·번호 전체 · 바뀌기 전 주소 전체 → 바뀐 주소 전체 · 주문 상태 · (해당하면) 배송 메모 안내 줄.',
    '(h) 지시 글 꼴 예시: 「[VM] 배송지 변경 주문번호 2026110170868221 → 제주시 서흘길 9, 3층」 · 「[VM] 주소 변경 홍길동 010-1234-5678 → 서울 강남구 테헤란로 1 101동 1001호」.',
];
const RETRY_NOTE = [
    '[다시 시도 · 중요] 같은 지시를 앞 모델이 처리하다 중간에 끊겼다(시간 초과·오류). 앞 시도가 어디까지 했는지 모른다.',
    '→ 무엇보다 먼저 이미 된 일인지 확인한다: 포인트 = 포인트 지급관리 목록(지급 시점 「오늘」)에 같은 아이디 줄이 있으면 지급하지 말고 「이미 오늘 지급됨(앞 시도) · 일련번호 · 금액」으로 답한다 / 배송지 = 그 주문 주소가 이미 새 주소면 저장하지 말고 「이미 바뀜(앞 시도)」으로 답한다.',
    '→ 목록·주문을 못 읽는 등 확인이 애매하면 지급·저장하지 말고 멈춰 「앞 시도 결과 확인 못 함 — 사람 확인 필요」로 답한다.',
];
function promptFor(o, opt) {
    const out = path.join(OUT_DIR, String(o.id));
    const point = isPoint(o.content), addr = !point && isAddr(o.content), op = opt || {};
    const mins = Math.round((op.limitMs || (point || addr ? FAST_LIMIT_MS : ORDER_LIMIT_MS)) / 60000);
    return [
        `너는 나스 VM(어사이드 전용 윈도우 PC)의 워커야. 총괄이 창구 대기열로 보낸 지시 #${o.id} 를 처리해.`,
        point
            ? `규칙: ①어사이드 도구(mcp__aside__repl·exec)로 웹 화면을 다룬다. 이 지시는 네이버페이 포인트 보상 지급 일이라 스마트스토어센터 포인트지급 화면의 [회원검색]·[추가]·[지급대상 확인]·[확인] 단추는 아래 [절차]대로 누른다. 그 밖 저장·발송·결제·삭제·설정 변경 단추는 종전대로 누르지 않는다(지시에 그런 일이 있으면 하지 말고 답에 「사람 확인 필요」로 적는다). 톡톡 파트너센터는 읽기와 대화·탭·링크 누르기만 한다(메시지 보내기·태그·메모·상태 바꾸기 0 · #1086).`
            : addr
                ? `규칙: ①어사이드 도구(mcp__aside__repl·exec)로 웹 화면을 다룬다. 이 지시는 네이버 주문 배송지 변경 일이라 스마트스토어센터 그 주문의 [고객 배송지 정보수정]·주소 검색·후보 고르기·[저장] 단추는 아래 [절차]대로 누른다. 그 밖 저장·발송처리·발주확인·취소·결제·삭제·설정 변경 단추는 누르지 않는다(지시에 그런 일이 있으면 하지 말고 답에 「사람 확인 필요」로 적는다). 톡톡 파트너센터는 읽기와 대화·탭·링크 누르기만 한다(메시지 보내기·태그·메모·상태 바꾸기 0 · #1086).`
                : `규칙: ①어사이드 도구(mcp__aside__repl·exec)로 웹 화면을 읽고 조회하는 일만 한다. 저장·발송·결제·삭제·설정 변경 단추는 누르지 않는다(지시에 그런 일이 있으면 하지 말고 답에 「사람 확인 필요」로 적는다).`,
        `②로그인·보안 확인 화면이 나오면 그 탭을 그대로 두고 「VM 어사이드에서 로그인/보안 확인 필요」로 답한다. 비밀번호·토큰·.env 값은 읽거나 답에 쓰지 않는다.`,
        `③답은 사내 화면(에이전트 오피스)에만 보이니 손님 이름·전화번호·네이버 아이디는 가리지 말고 전체로 쓴다(센터와 대조해야 함 · 「정*영」「je***」「끝4」 꼴 금지 · #1076 대표). 텔레그램·외부로 보내는 글은 없다. ④답은 한국어로 짧게, 요점부터. 표가 편하면 표.`,
        `⑤파일(캡처·엑셀 등)을 넘겨야 하면 ${out} 폴더 안에 저장하고 답 맨 끝에 「ATTACH: <전체 경로>」 를 파일마다 한 줄씩 적는다(5개까지 · 10MB 이하).`,
        point || addr ? `⑥이 일은 지시당 ${mins}분 안에 끝내야 한다.` : `⑥이 일은 지시당 10분 안에 끝내야 한다.`,
        ...(point ? ['', ...POINT_STEPS] : []),
        ...(addr ? ['', ...ADDR_STEPS, `(i) 오늘 최종발주 = ${op.sentToday ? '이미 나감 → 저장했으면 끝 보고에 「⚠ 오늘 발주 나감 → 거래처(효돈/대성)에 주소 변경 연락 필요」 한 줄(저장은 그대로 한다)' : '아직 안 나감(거래처 연락 줄 없음)'}.`] : []),
        ...(op.retry ? ['', ...RETRY_NOTE] : []),
        '', '[지시]', bodyOf(o.content),
    ].join('\n');
}
// #1083 오늘 최종발주가 나갔나(실DB 읽기만) = final_order_marks 오늘 고친 줄 또는 「[최종발주] …」 정리 기록 오늘 줄
async function finalSentToday(db) {
    const day = kstDay();
    try { if ((await db.query(`SELECT 1 FROM final_order_marks WHERE (updated_at AT TIME ZONE 'Asia/Seoul')::date = $1::date LIMIT 1`, [day])).rows.length) return true; } catch (e) { /* 표 없음 = 아래로 */ }
    try { if ((await db.query(`SELECT 1 FROM pending_orders WHERE is_deleted = false AND content LIKE '[최종발주] %' AND (created_at + interval '9 hours')::date = $1::date LIMIT 1`, [day])).rows.length) return true; } catch (e) { /* 무시 */ }
    return false;
}
const SENT_LINE = '⚠ 오늘 발주 나감 → 거래처(효돈/대성)에 주소 변경 연락 필요';
// 답 글에서 「ATTACH: 경로」 줄을 떼고, 그 지시 폴더(vm-out/<id>) 안의 실제 파일만 남긴다(.env 등 다른 파일이 나가지 않게)
function takeAttach(text, id) {
    const base = path.resolve(OUT_DIR, String(id)) + path.sep, files = [], dropped = [];
    const answer = String(text || '').split(/\r?\n/).filter(line => {
        const m = /^\s*ATTACH:\s*(.+?)\s*$/.exec(line); if (!m) return true;
        const fp = path.resolve(m[1].replace(/^["']|["']$/g, ''));
        const ext = (path.extname(fp).slice(1) || '').toLowerCase();
        let ok = fp.startsWith(base) && ATTACH_EXT.includes(ext) && files.length < 5;
        if (ok) { try { const st = fs.statSync(fp); ok = st.isFile() && st.size > 0 && st.size <= 10 * 1024 * 1024; } catch (e) { ok = false; } }
        if (ok) files.push(fp); else dropped.push(path.basename(fp));
        return false;
    }).join('\n').trim();
    return { answer, files, dropped };
}
async function doClaude(db, o) {
    if (isFast(o.content)) return doFast(db, o);   // #1082·#1083 소넷 → Opus 1회
    const cwd = claudeCwd(o.id), limitMs = ORDER_LIMIT_MS;
    return claudeOnce(db, o, MODEL, limitMs, promptFor(o), cwd);
}
// claude 한 번(종전 doClaude 본문 그대로 · 모델·상한·프롬프트만 인자)
async function claudeOnce(db, o, model, limitMs, input, cwd) {
    const r = await run(findClaude(), ['-p', '--model', model, '--output-format', 'json', '--allowedTools', ALLOWED, '--disallowedTools', DENIED], { input, limitMs, cwd, onTick: () => heartbeat(db, 'busy', o.id) });
    if (r.timeout) return { ok: false, why: `${Math.round(limitMs / 60000)}분 넘어 끔` };
    let j = null; try { j = JSON.parse(String(r.out).trim().split(/\r?\n/).filter(Boolean).pop() || ''); } catch (e) { j = null; }
    if (r.code !== 0 || !j || j.is_error || (j.subtype && j.subtype !== 'success') || !String(j.result || '').trim()) {
        const why = (j && (j.result || j.subtype)) || String(r.err || r.out || '').trim().split(/\r?\n/).pop() || ('exit ' + r.code);
        return { ok: false, why: 'claude 실패: ' + clean(why, 300) };
    }
    const a = takeAttach(j.result, o.id);
    return { ok: true, answer: a.answer + (a.dropped.length ? `\n\n(올리지 못한 첨부: ${a.dropped.join(', ')} — VM 지시 폴더 밖이거나 형식·크기 밖)` : ''), files: a.files };
}
// #1082·#1083 포인트·배송지 = 소넷 먼저 → 실패면 Opus 1회(재시도 글머리 = 이미 된 일인지 먼저 확인 · 애매하면 멈춤) → 그래도 실패면 대기로 안 되돌리고 바로 오류(3·4번째 실행 없음)
async function doFast(db, o) {
    const cwd = claudeCwd(o.id), addr = isAddr(o.content);
    const sentToday = addr ? await finalSentToday(db) : false;
    const again = Number(o.tries) >= 2;   // 다시 집힌 줄(재시작 뒤 포함) = 앞 시도가 어디까지 했는지 모름 → 소넷 첫 실행에도 RETRY_NOTE(워커1 점검)
    const first = await claudeOnce(db, o, FAST_MODEL, FAST_LIMIT_MS, promptFor(o, { limitMs: FAST_LIMIT_MS, sentToday, retry: again }), cwd);
    let res = first, used = FAST_MODEL;
    if (!first.ok) {
        log(`#${o.id} 소넷 실패 → Opus 로 1회 다시 · ${clean(first.why, 120)}`);
        await appendStep(db, o.run_id, 'error', '↩️ 소넷 실패 — Opus 로 한 번 더(이미 된 일인지 먼저 확인): ' + clean(first.why, 200));
        await audit(db, 'vm_fast_retry', o.id, { from: FAST_MODEL, to: MODEL, why: clean(first.why, 200) });
        const lim = addr ? ADDR_LIMIT_MS : POINT_LIMIT_MS;
        res = await claudeOnce(db, o, MODEL, lim, promptFor(o, { limitMs: lim, sentToday, retry: true }), cwd);
        used = MODEL;
        if (!res.ok) res = { ok: false, noRetry: true, why: `소넷·Opus 둘 다 실패 — 사람 확인 필요(앞 시도가 ${addr ? '저장' : '지급'}까지 갔는지 센터에서 먼저 확인) · 소넷: ${clean(first.why, 120)} · Opus: ${clean(res.why, 150)}` };
    }
    if (res.ok && addr && sentToday && /^\s*✅/.test(res.answer) && !res.answer.includes('오늘 발주 나감')) res.answer = res.answer.replace(/^[^\n]*/, m => m + '\n' + SENT_LINE);
    if (res.ok) keepWrite({ at: new Date().toISOString() });   // 센터를 방금 썼음 = 로그인 유지 틱 30분 뒤로
    return { ...res, model: used };
}
async function doRank(db, o) {
    const startedAt = Date.now();
    const script = process.env.VM_RANK_SCRIPT || path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js');
    const r = await run(process.env.VM_NODE_BIN || process.execPath, [script, '--apply'], { limitMs: RANK_LIMIT_MS, onTick: () => heartbeat(db, 'busy', o.id) });
    if (r.timeout) return { ok: false, why: `키워드 순위 ${Math.round(RANK_LIMIT_MS / 60000)}분 넘어 끔` };
    let last = null; try { last = ((await db.query(`SELECT value FROM agent_office_config WHERE key = 'keyword_rank_last'`)).rows[0] || {}).value || null; } catch (e) { /* 아래에서 */ }
    const fresh = last && Date.parse(last.at || '') >= startedAt - 5000;
    if (!fresh) return { ok: false, why: `키워드 순위가 결과를 남기지 않음(exit ${r.code}) · ${clean(String(r.err || r.out).trim().split(/\r?\n/).pop(), 200)}` };
    const rows = Array.isArray(last.rows) ? last.rows : [], errs = Array.isArray(last.errors) ? last.errors : [];
    const lines = [`키워드 순위 다시 모음 · ${last.date || kstDay()} · 수집 ${rows.length}개 · 실패 ${errs.length}개`];
    if (last.blocked) lines.push(`🔴 막힘 = ${last.blocked.kind}(${last.blocked.keyword || '?'} 에서 · 남은 ${last.blocked.skipped || 0}개 안 돌림) → VM 어사이드에 남긴 탭에서 풀고 다시 「[VM] 순위 다시」`);
    if (errs.length) lines.push('실패: ' + errs.slice(0, 10).map(e => e.keyword).join(', '));
    lines.push('순위표 텔레그램은 서버 틱이 종전대로 보냄(같은 날 앞 회차에 실패·막힘이 있었을 때만 다시 감)');
    return { ok: !!rows.length || !!last.blocked, title: `키워드 순위 ${rows.length}개`, answer: lines.join('\n'), files: [], why: rows.length ? '' : '수집 0개' };
}
// 한 건 처리(집기 → 갈래 → 올리기 · 실패 1회 = 대기로)
async function handle(db, id) {
    const o = await claim(db, id); if (!o) return { id, did: false };
    const tries = triesBump(o.id), rank = isRank(o.content); o.tries = tries;
    log(`#${o.id} 집음(${rank ? '순위 갈래' : isPoint(o.content) ? 'claude · 포인트 지급' : isAddr(o.content) ? 'claude · 배송지 변경' : 'claude'} · ${tries}번째) :: ${head60(o.content)}`);
    await heartbeat(db, 'busy', o.id);
    let res;
    try { res = o.has_image ? { ok: false, why: '그림 첨부 지시는 VM 길에서 안 받음(글로만)' } : rank ? await doRank(db, o) : await doClaude(db, o); }
    catch (e) { res = { ok: false, why: '러너 오류: ' + e.message }; }
    let out;
    if (res.ok) { out = await respond(db, o, { kind: 'answer', answer: res.answer, title: res.title || '', attachments: res.files || [] }); triesClear(o.id); }
    else if (tries < MAX_TRIES && !o.has_image && !res.noRetry) { await backToWait(db, o, res.why); out = { ok: true, status: '대기(다시)' }; }
    else { out = await respond(db, o, { kind: 'error', error: res.why }); triesClear(o.id); }
    log(`#${o.id} → ${out.status || out.reason}${res.ok ? '' : ' · ' + clean(res.why, 120)}`);
    await heartbeat(db, 'idle');
    return { id: o.id, did: true, ok: res.ok, status: out.status || out.reason, rank };
}
// ── #1082-② 센터 로그인 유지(claude 0 · aside MCP 직접 · keyword-rank.js Aside) ──
//   러너가 쉴 때(집을 지시 0) 마지막 센터 사용 30분 뒤 → 쉼 창(09:10~09:45)·키워드·잠금 피해 잠금 잡고 → 센터 첫 화면 탭(없으면 엶) 새로고침
//   → 로그인 화면이면 「간편 로그인」 단추 1회 → 2단계·폰 승인·보안 확인 화면이면 멈춤 + 텔레그램(서버 하루 1통) + 3시간 안 누름
//   지급·배송지 화면은 열지 않음(센터 첫 화면 탭만) · aside.exe 없는 PC(노트북·검증) = 아무것도 안 함
const ASIDE_EXE = process.env.ASIDE_EXE || path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Aside', 'CLI', 'current', 'aside.exe');
let asideFactory = null, keepNotify = null;   // 시험용 갈아끼우기(_setKeep)
function keepRead() { try { const j = JSON.parse(fs.readFileSync(KEEP_STATE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function keepWrite(patch) { try { fs.mkdirSync(DIR, { recursive: true }); const s = { ...keepRead(), ...patch }; const tmp = KEEP_STATE + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, KEEP_STATE); } catch (e) { log('센터 유지 상태 쓰기 실패(무시): ' + e.message); } }
const JS_KEEP = `const HOME = ${JSON.stringify(CENTER_HOME)};
let t = null, opened = false;
for (const x of tabs) { try { if (/^https:\\/\\/sell\\.smartstore\\.naver\\.com\\/#\\/home\\/dashboard/.test(x.url())) { t = x; break; } } catch (e) {} }
if (!t) { t = await openTab(HOME); opened = true; }
else { try { await t.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { try { await t.evaluate(() => location.reload()); } catch (_) {} } }
const wait = ms => new Promise(r => setTimeout(r, ms));
const look = async () => { let u = '', txt = ''; try { u = t.url(); } catch (e) {} try { txt = await t.evaluate(() => (document.body && document.body.innerText || '').slice(0, 2000)); } catch (e) {} return { u, txt }; };
const isLogin = s => /nid\\.naver\\.com|accounts\\.commerce\\.naver\\.com|\\/login/i.test(s.u);
const isPhone = s => /2단계|인증번호|본인\\s*확인|보안\\s*확인|기기\\s*등록|새로운\\s*기기|승인\\s*요청|휴대폰으로/.test(s.txt);
await wait(5000);
let a = await look(), state = 'ok', clicked = false;
if (isLogin(a)) {
  if (isPhone(a)) state = 'need_phone';
  else {
    try { clicked = await t.evaluate(() => { const el = [...document.querySelectorAll('button, a, [role=button]')].find(e => /간편\\s*로그인/.test(e.innerText || e.textContent || '')); if (el) { el.click(); return true; } return false; }); } catch (e) { clicked = false; }
    if (!clicked) state = 'login_fail';
    else { await wait(8000); a = await look(); state = !isLogin(a) && /sell\\.smartstore\\.naver\\.com/.test(a.u) ? 'relogin' : isPhone(a) ? 'need_phone' : 'login_fail'; }
  }
} else if (!/sell\\.smartstore\\.naver\\.com/.test(a.u)) state = 'unknown';
let where = ''; try { const q = new URL(a.u); where = q.host + q.pathname; } catch (e) {}
console.log(JSON.stringify({ state, clicked, opened, where }));`;
async function keepCenterOnce() {
    const aside = asideFactory ? asideFactory() : new (require(path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js')).Aside)(ASIDE_EXE, s => log(s));
    let timer = null;
    try {
        await aside.start();
        return await Promise.race([aside.replJson('#1082 센터 로그인 유지', JS_KEEP), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('센터 유지 3분 넘음')), 3 * 60000); })]);
    } finally { clearTimeout(timer); await Promise.resolve(aside.stop({ keepTabs: true })).catch(() => { }); }   // 센터 탭은 남김(다음 새로고침·지급이 씀)
}
// 🔵 텔레그램은 체험 자동(experience_auto)의 길을 빌림 → experience_auto.enabled 를 끄면(403) 로그인 알림도 같이 꺼짐(로그만 남음)
async function keepTell(reason) {
    if (keepNotify) return keepNotify(reason);
    const API = String(process.env.EXP_AUTO_API || '').replace(/\/+$/, ''), TOKEN = String(process.env.EXP_AUTO_TOKEN || '');
    if (!/^https?:\/\//.test(API) || TOKEN.length < 32) { log('센터 유지: 텔레그램 길 없음(.env EXP_AUTO_API·TOKEN) — 로그만'); return false; }
    try {   // 서버 텔레그램 길 = 체험 번호 자동의 「예약 없는 멈춤」(id 0 · kind 갈래당 하루 1통 · #1040)
        const r = await fetch(API + '/api/experience/auto/0/miss', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, kind: 'center_login' }), signal: AbortSignal.timeout(15000) });
        return r.status === 200;
    } catch (e) { log('센터 유지: 텔레그램 못 보냄 ' + e.message); return false; }
}
async function keepMaybe(force) {
    if (!KEEP_MS && !force) return null;
    const st = keepRead(), now = Date.now();
    if (!force) {
        if (st.phone_at && now - Date.parse(st.phone_at) < KEEP_PHONE_BACKOFF_MS) return null;
        if (st.at && now - Date.parse(st.at) < KEEP_MS) return null;
    }
    if (inSkip(kstNow(), true) || busyWhy()) return null;   // 09:10~09:45 · 키워드 도는 중 · 남의 잠금
    if (!asideFactory && !fs.existsSync(ASIDE_EXE)) return null;   // VM 아닌 PC
    if (!lockTake()) return null;
    let r;
    try { r = await keepCenterOnce(); } catch (e) { r = { state: 'error', error: clean(e.message, 200) }; }
    finally { lockFree(); }
    const at = new Date().toISOString();
    keepWrite({ at, result: r && r.state, error: r && r.error || null, ...(r && r.state === 'need_phone' ? { phone_at: at } : {}) });
    log(`센터 로그인 유지 · ${r && r.state}${r && r.where ? ' · ' + r.where : ''}${r && r.error ? ' · ' + r.error : ''}`);
    if (r && (r.state === 'need_phone' || r.state === 'login_fail')) {
        await keepTell(r.state === 'need_phone' ? '스마트스토어센터 로그인 풀림(2단계·폰 승인 화면) — VM 어사이드 센터 탭에서 승인해 주세요 · 그 전엔 포인트·배송지 [VM] 멈춤'
            : '스마트스토어센터 로그인 풀림(간편 로그인 안 됨) — VM 어사이드 센터 탭에서 로그인해 주세요 · 그 전엔 포인트·배송지 [VM] 멈춤');
        if (r.state === 'login_fail') keepWrite({ phone_at: at });   // 같은 3시간 쉼(단추 거듭 누르지 않게)
    }
    return r;
}
// 한 번 보기: 쉼 판단 → 집을 것 → 잠금 → 처리
async function pollOnce(db) {
    const why = busyWhy(); if (why) return { skipped: why };
    const id = await pick(db); if (!id) { const k = await keepMaybe(); return k ? { idle: true, keep: k.state } : { idle: true }; }
    const content = ((await db.query(`SELECT content FROM pending_orders WHERE id = $1`, [id])).rows[0] || {}).content;
    const long = isFast(content) ? 'fast' : isRank(content);   // 상한 20분 갈래(순위) = 09:10 부터 · #1082 소넷+Opus 갈래(포인트·배송지) = 09:00 부터 쉼(상한만큼 앞당김)
    if (inSkip(kstNow(), long)) return { skipped: (long === 'fast' ? '09:00' : long ? '09:10' : '09:20') + '~09:45 키워드 순위 창', id };   // 지시는 대기에 남음
    if (!lockTake()) return { skipped: '잠금 못 잡음' };
    try { return await handle(db, id); } finally { lockFree(); }
}
function statusInfo() { return { 잠금: lockBusy() ? fs.readFileSync(LOCK, 'utf8') : null, 키워드도는중: krBusy(), 쉼: busyWhy() || null, 상태: stateRead(), 로그: path.join(LOG_DIR, `vm-watch-${kstDay()}.log`), claude: findClaude() }; }

async function main() {
    const arg = process.argv[2];
    if (arg === '--status') { console.log(JSON.stringify(statusInfo(), null, 1)); return 0; }
    const { pool } = require('../desk/_db');   // VM .env(DATABASE_URL) · 끊김 재연결 = _db 감싸기
    let stop = false; for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop = true; lockFree(); log('신호로 끝냄'); process.exit(0); });
    try { await recoverOwn(pool); } catch (e) { log('기동 복구 실패(무시): ' + e.message); }
    log(`VM 러너 시작 · ${os.hostname()} · 모델 ${MODEL} · ${POLL_MS / 1000}초마다`);
    let lastBeat = 0;
    for (;;) {
        try {
            if (Date.now() - lastBeat >= BEAT_MS) { await heartbeat(pool, 'idle'); lastBeat = Date.now(); }
            const r = await pollOnce(pool);
            if (r.did) lastBeat = Date.now();
            if (arg === '--once') { console.log(JSON.stringify(r)); break; }
        } catch (e) { log('주기 오류(다음 주기에 다시): ' + e.message); if (arg === '--once') break; }
        if (stop) break;
        await new Promise(r => setTimeout(r, POLL_MS));
    }
    await pool.end().catch(() => { });
    return 0;
}
if (require.main === module) main().then(c => process.exit(c), e => { log('러너 오류: ' + (e && e.stack || e)); lockFree(); process.exit(1); });
module.exports = { isRank, RANK_RE, isPoint, POINT_RE, POINT_LIMIT_MS, isAddr, isFast, FAST_MODEL, FAST_LIMIT_MS, MODEL, SKIP_FAST, finalSentToday, SENT_LINE, keepMaybe, KEEP_STATE, JS_KEEP, _setKeep: (f, n) => { asideFactory = f || null; keepNotify = n || null; }, bodyOf, head60, takeAttach, promptFor, busyWhy, inSkip, lockTake, claudeCwd, ALLOWED, DENIED, lockFree, lockBusy, pick, claim, respond, recoverOwn, handle, pollOnce, heartbeat, LOCK, STATE, OUT_DIR, MAX_TRIES, MAX_CLAIMS_DAY };

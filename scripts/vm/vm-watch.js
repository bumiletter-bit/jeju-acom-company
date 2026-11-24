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
//   #1088 쉼 창(09:10·09:20~09:45) 전부 없앰 · 키워드 순위와 겹침 = 같은 잠금 줄 세우기(keyword-rank.js 가 잠금을 최대 35분 기다림 · 순위 갈래는 KR_LOCK_HELD=1 로 부모 잠금 안 기다림)
//   지시당 상한 10분(claude) · 20분(순위 · 포인트 지급) → 자식 트리째 끔(Windows taskkill /T /F)
//   #1056-a 포인트 보상 지급 갈래 = 본문이 「포인트 (보상) 지급」으로 시작(isPoint) → claude 길 그대로 + 프롬프트 규칙 ①에 포인트지급 화면 [회원검색]·[추가]·[확인]만 허용 · [절차] 블록(업무지식 절) · 상한 20분 · 09:10~09:45 쉼
//     실패 재집기(같은 줄 하루 2회)는 절차 (c) 「오늘 같은 아이디 지급 줄 있으면 지급 X」가 중복을 막음
//   #1089 첫 실행 모델·상한 = Opus 20분(FAST_MODEL · env 로 소넷 되돌림) · 아래 「소넷」 글은 #1082 때 기록
//   #1082 포인트 갈래 = 소넷(FAST_MODEL · 10분) 먼저 → 실패(시간 초과·오류·빈 결과)면 Opus 1회(20분 · 글머리 RETRY_NOTE = 오늘 지급 줄 먼저 확인 · 애매하면 멈춤)
//     → 그래도 실패면 대기로 안 되돌리고 오류(실행 최대 2번 = 종전과 같음) · #1087 이 갈래는 쉼 창 없음(아무 때나) · 아이디+주문번호 둘 다 있으면 찾기 건너뛰고 대조만(b-0)
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
const FAST_MODEL = process.env.VM_FAST_MODEL || 'claude-opus-5-5';   // #1089(대표 「큰 차이 없으면 오퍼스로」 · 실측 #3558 소넷이 더 느리고 10분 상한이 지급 직후를 끊음) 첫 실행 = Opus · env VM_FAST_MODEL=claude-sonnet-5-5 로 되돌림
const FAST_LIMIT_MS = Number(process.env.VM_FAST_LIMIT_MS) || 20 * 60000;   // #1089 첫 실행 상한 20분(종전 포인트 상한) · 이어 재시도 Opus 20분 · #1087 이 두 갈래는 쉼 창 없음(skipWhy)
const ADDR_LIMIT_MS = Number(process.env.VM_ADDR_LIMIT_MS) || 20 * 60000;    // #1083 배송지 변경 Opus 재시도 상한
// #1082-② 센터 로그인 유지 = 러너가 쉬는 동안 30분마다 센터 탭 가벼운 새로고침(claude 안 부름 · aside MCP 직접) · 0 = 끔
const KEEP_MS = process.env.VM_CENTER_KEEP_MS != null && process.env.VM_CENTER_KEEP_MS !== '' ? Number(process.env.VM_CENTER_KEEP_MS) : 30 * 60000;
const KEEP_STATE = path.join(DIR, 'vm-center-keep.json');
const KEEP_PHONE_BACKOFF_MS = 3 * 3600e3;   // 2단계·폰 승인 화면을 본 뒤 3시간은 다시 안 누름(텔레그램은 서버가 하루 1통)
const CENTER_HOME = 'https://sell.smartstore.naver.com/#/home/dashboard';
// #1242(대표 11/22 「왜 메모리 다 쓴 거야」) VM 메모리(커밋) 감시 = 1시간마다 여유를 재서 로그·heartbeat 에 남기고, 1GB 아래면 텔레그램(하루 1통) · 0 = 끔 · 윈도우 VM 에서만 잼
const MEM_MS = process.env.VM_MEM_MS != null && process.env.VM_MEM_MS !== '' ? Number(process.env.VM_MEM_MS) : 3600e3;
const MEM_LOW_MB = Number(process.env.VM_MEM_LOW_MB) || 1024;
const MEM = { at: 0, free_mb: null, total_mb: null };   // 마지막으로 잰 값(heartbeat 에 같이 실림)
// #1242-2 누수 주인 = 어사이드 앱 본체(실측 11/22: 가만히 있어도 핸들이 1초에 1개쯤·커밋이 시간당 0.5GB 늘고, 앱만 끄면 그만큼 돌아옴) → 러너가 어사이드 앱만 끄고(다음에 쓸 때 저절로 다시 켜짐) 메모리를 돌려받음
//   끄는 때 = ①커밋 여유가 VM_ASIDE_RECYCLE_MB(기본 3,072MB) 아래 ②매일 VM_ASIDE_RECYCLE_HOUR(기본 04시 KST)에 1번 · 둘 다 러너가 쉬는 중·잠금이 비었을 때만 · 끄기 = VM_ASIDE_RECYCLE_MB=0(여유 갈래 · 빈 값은 기본 3,072) · VM_ASIDE_RECYCLE_HOUR 빈 값 또는 음수(하루 1번 갈래)
const ASIDE_RECYCLE_MB = process.env.VM_ASIDE_RECYCLE_MB != null && process.env.VM_ASIDE_RECYCLE_MB !== '' ? Number(process.env.VM_ASIDE_RECYCLE_MB) : 3072;
const ASIDE_RECYCLE_HOUR = process.env.VM_ASIDE_RECYCLE_HOUR != null ? (process.env.VM_ASIDE_RECYCLE_HOUR === '' ? -1 : Number(process.env.VM_ASIDE_RECYCLE_HOUR)) : 4;
const ASIDE_RECYCLE_GAP_MS = 2 * 3600e3;   // 여유가 낮아 끈 뒤 2시간은 같은 까닭으로 또 끄지 않음(껐는데도 안 돌아오면 = 주인이 다른 것 → 메모리 알림이 맡음)
const ALLOWED = 'mcp__aside__repl,mcp__aside__exec';   // 어사이드만(교차 점검 2 · 파일 읽기 도구는 .env 유출 길이라 막음)
const DENIED = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Read,Grep,Glob';
// claude 작업 폴더 = 늘 ~/.akkome/vm-out/<지시번호>(리포 밖 = 리포 CLAUDE.md 안 실림 · .env 있는 C:\akm-vm 도 피함 · aside MCP 는 user 설정이라 그대로)
const TOUCH_MS = Number(process.env.VM_TOUCH_MS) || 60000;   // 도는 동안 잠금 mtime·vm_heartbeat(busy) 갱신 간격
const MAX_TRIES = 2;   // 첫 실패 = 대기로 한 번 되돌림 · 두 번째 실패 = 오류
// (#1088 뒤 러너는 안 씀 · inSkip 은 시험 호환으로만 남김) 옛 키워드 09:30 창 = claude 09:20 · 순위 09:10
const SKIP_CLAUDE = ['09:20', '09:45'], SKIP_RANK = ['09:10', '09:45'];   // #1088 쉼 창 전부 없앰(skipWhy = 빈 글 · 줄 세우기 = 잠금)
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
const isFast = content => isPoint(content) || isAddr(content);   // 첫 실행(FAST_MODEL · #1089 Opus) → 실패면 Opus 1회 갈래

// ── 쉼 판단(어사이드 한 번에 하나) ──
function krBusy() { try { return require('./exp-phone-auto.js').krBusy(); } catch (e) { return false; } }
// k = kstNow() 꼴(UTC 칸에 KST) · rank = 순위 갈래면 09:10 부터 · 아니면 09:20 부터
function inSkip(k, rank) { const w = rank ? SKIP_RANK : SKIP_CLAUDE; const hm = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0'); return hm >= w[0] && hm < w[1]; }
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
            [JSON.stringify({ at: new Date().toISOString(), state, order_id: orderId || null, host: os.hostname(), pid: process.pid, ...(MEM.free_mb != null ? { commit_free_mb: MEM.free_mb, commit_total_mb: MEM.total_mb, mem_at: new Date(MEM.at).toISOString() } : {}), ...hbCenter() })]);   // #1242 커밋 여유(마지막으로 잰 값) · #1266 센터 로그인 유지의 마지막 결과
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
function run(bin, args, { input, limitMs, cwd, onTick, env }) {
    return new Promise(resolve => {
        let cmd = bin, a = args;
        if (/\.js$/i.test(bin)) { cmd = process.execPath; a = [bin, ...args]; }   // 시험용 가짜 실행 파일
        let ch; try { ch = spawn(cmd, a, { cwd: cwd || ROOT, env: env || process.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }); }
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
// #1230(대표 「고」 11/22) 스토어 확인 = 센터는 계정의 마지막 스토어로 열린다(노트북에서 직영몰 일을 하면 VM 도 직영몰로 열림 · 11/22 실사례) → 지급·저장 전에 스토어 이름부터
const STORE_STEP = '(a-2) #1230 스토어 확인(로그인 뒤 · 다른 화면을 열기 전에) = 센터 화면 위쪽 「로그아웃」 아래에 적힌 스토어 이름을 읽는다. 「제주아꼼이네」(이름에 「직영몰」 없음)면 그대로 진행한다. 「제주아꼼이네 직영몰」이거나 다른 이름이면 위쪽 [스토어 이동] → 목록에서 「스마트스토어 제주아꼼이네」(직영몰·사업자몰이 아닌 줄)를 고르고 이름을 다시 읽는다 → 그래도 「제주아꼼이네」가 아니거나 이름을 못 읽으면 지급·저장하지 말고 멈춰 「⚠️ 센터가 직영몰(또는 다른 스토어)로 열려 있음 — 스토어 확인 필요 · 지급·저장 0」과 읽은 스토어 이름으로 답한다. 이 일은 네이버 스마트스토어 「제주아꼼이네」 주문만 한다 — 지시가 직영몰(사업자몰) 주문이면 스토어를 옮기지 말고 「직영몰 주문은 VM 이 안 해요 · 사람 확인 필요」로 답한다. 끝날 때 스토어는 「제주아꼼이네」인 채로 둔다.';
const POINT_STEPS = [   // #1080(대표 11/9 23:1x) ①구매자 아이디 회원검색 · 목적 = 구매확정 이력 있으면 구매 프로모션 적립 · 없으면 비구매 적립 ②중복 = 오늘 같은 아이디만 멈춤 ③주문 찾기 최근 3개월 ④지급 화면 매번 새로 · [지급대상 확인] 무반응 = 처음부터 1회만 다시 ⑤비즈월렛 자동충전(잔액은 보고 줄에만)
    '[절차] 네이버페이 포인트 보상 지급',
    '(a) 스마트스토어센터 로그인 = 「로그인하기」 → 커머스ID 「네이버 아이디로 간편 로그인」 단추(비밀번호 입력 X · 아이디 칸이 나오면 규칙 ②의 금고 단추 1회). 2단계 인증·보안 확인이 뜨면 규칙 ②대로 멈춘다.',
    STORE_STEP,
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
    '(a) 센터 로그인 = 「로그인하기」 → 커머스ID 「네이버 아이디로 간편 로그인」 단추(비밀번호 입력 X · 아이디 칸이 나오면 규칙 ②의 금고 단추 1회). 2단계 인증·보안 확인이 뜨면 규칙 ②대로 멈춘다.',
    STORE_STEP,
    TALK_STEP('(c)(배송준비 화면 [고객 배송지 정보수정] · 상세 창은 보기 전용이라 거기서 고치지 않는다)'),
    '(b) 판매관리 › 배송준비(발주확인 끝난 주문 · 없으면 주문통합검색 최근 3개월)에서 주문을 찾는다 = 지시의 (상품)주문번호가 있으면 그것 먼저 · 없으면 구매자 또는 수취인 이름 + 전화번호로. 손님 ↔ 주문이 정확히 하나로 맞을 때만 다음으로.',
    '(c) 그 주문의 [고객 배송지 정보수정] → 주소 검색에 지시의 새 주소(도로명·지번)를 넣어 찾는다 → 후보가 정확히 1개일 때만 고르고 상세주소(동·호수 등)를 지시 그대로 넣는다 → 저장 1회. 받는 분 이름·번호를 바꾸라는 지시가 있으면 그 칸도 지시 그대로(없으면 그대로 둔다).',
    '(d) 저장 뒤 그 주문을 다시 열어(새로 고침) 바뀐 주소가 지시와 같은지 한 번만 확인한다. 같은 화면에서 저장을 두 번 누르지 않는다(이미 새 주소면 다시 저장 X). #1105 그 밖 일은 하지 않는다 = 캡처·파일 저장·첨부(ATTACH) 0 · 처리 이력·변경 기록 찾아보기 0 · 확인 끝나면 바로 끝 보고.',
    '(e) 멈춤(저장하지 않음) = 발송처리 됐거나 배송준비·발주확인 상태가 아님 · 후보 주문이 둘 이상이라 애매 · 주소 검색 후보 0개 또는 2개 이상 · 지시의 이름·번호가 주문과 안 맞음 · 새 주소가 지시에 없거나 덜 적힘 → 무엇이 안 맞는지 화면 값(이름·번호 전체 · 주문번호 · 주문 상태 · 검색 후보)으로 답한다.',
    '(f) 지시에 배송 메모(문 앞에 놔 주세요 등)를 바꾸라는 말이 있을 때만: 센터에 그 칸이 없다(#952) → 답에 「배송 메모는 센터에 칸 없음 → 발주 메모함에 넣어 주세요: <메모 글>」 한 줄. 그런 말이 없으면 메모 얘기를 쓰지 않는다.',
    '(g) 끝 보고(#1105 대표 · 짧게 · 이 꼴만 · 표·설명 문단·처리 이력·캡처 얘기 0) =\n✅ 배송지 변경 완료 · <받는 분 이름> · <상품주문번호>\n전: <바뀌기 전 주소 전체>\n→ 새: <바뀐 주소 전체>\n(재조회 확인 ✓)\n그 아래는 해당할 때만 한 줄씩: (i) 오늘 발주 나감 줄 · (f) 배송 메모 줄. 멈췄으면(저장 안 함) 「⚠️ 배송지 변경 못 함: <사유>」 한 줄 + 안 맞는 화면 값(이름·번호 전체 · 주문번호 · 주문 상태 · 검색 후보) 짧게.',
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
        `②로그인 화면이 나오면 먼저 어사이드 금고로 사이트마다 1번만 로그인해 본다(#1192) = 아이디 입력 칸을 누르고 2~3초 기다리면 스냅샷에 「Aside inline suggestion」 창(iframe) 안 「Fill saved login …」 단추가 뜬다 → 그 단추를 누른다. 카페24 관리자(eclogin.cafe24.com)·쿠팡 윙(xauth.coupang.com)은 그 단추만으로 로그인까지 된다(로그인 단추를 따로 누르거나 입력 칸 값을 읽지 않는다). 스마트스토어센터는 「로그인하기」 → 커머스ID 화면의 「네이버 아이디로 간편 로그인」 단추. 단추가 3초 안에 안 뜨거나 2단계 인증·보안 확인·폰 승인 화면이 나오면 그 탭을 그대로 두고 「VM 어사이드에서 로그인/보안 확인 필요」로 답한다. 「금고에 로그인 항목이 없다」는 그 단추가 실제로 안 뜬 때만 쓴다. 비밀번호·토큰·.env 값은 읽거나 치거나 답에 쓰지 않는다.`,
        `③답은 사내 화면(에이전트 오피스)에만 보이니 손님 이름·전화번호·네이버 아이디는 가리지 말고 전체로 쓴다(센터와 대조해야 함 · 「정*영」「je***」「끝4」 꼴 금지 · #1076 대표). 텔레그램·외부로 보내는 글은 없다. ④답은 한국어로 짧게, 요점부터. 표가 편하면 표.`,
        addr
            ? `⑤이 일은 캡처·파일 저장·첨부를 하지 않는다(「ATTACH:」 줄 0 · #1105).`
            : `⑤파일(캡처·엑셀 등)을 넘겨야 하면 ${out} 폴더 안에 저장하고 답 맨 끝에 「ATTACH: <전체 경로>」 를 파일마다 한 줄씩 적는다(5개까지 · 10MB 이하).`,
        point || addr ? `⑥이 일은 지시당 ${mins}분 안에 끝내야 한다.` : `⑥이 일은 지시당 10분 안에 끝내야 한다.`,
        `⑦뒷정리(#1242): 답을 쓰기 직전에 이 지시에서 새로 연 탭·창(톡톡·주문 상세 새 창·로그인 팝업 포함)을 모두 닫는다(closeTab). 지시가 「남겨 두라」고 한 탭과, 사람이 풀어야 해서 남기는 로그인·보안 확인 화면만 남긴다. 탭이 쌓이면 VM 메모리가 바닥난다.`,
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
        if (isOomText(String(why) + '\n' + String(r.err || '').slice(-2000))) { try { await tellOnce('oom_told_day', 'VM 에서 Claude 가 메모리 부족으로 죽었어요 — VM 재부팅이 필요해요 · 그 전엔 [VM] 지시가 실패함', 'vm_oom'); await memMaybe(true); } catch (e) { /* 알림 실패는 무시 */ } }   // #1242 지시 카드에만 「오류」로 남아 아무도 모르던 것
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
        log(`#${o.id} 첫 실행(${FAST_MODEL}) 실패 → Opus 로 1회 다시 · ${clean(first.why, 120)}`);
        await appendStep(db, o.run_id, 'error', '↩️ 첫 실행 실패 — Opus 로 한 번 더(이미 된 일인지 먼저 확인): ' + clean(first.why, 200));
        await audit(db, 'vm_fast_retry', o.id, { from: FAST_MODEL, to: MODEL, why: clean(first.why, 200) });
        const lim = addr ? ADDR_LIMIT_MS : POINT_LIMIT_MS;
        res = await claudeOnce(db, o, MODEL, lim, promptFor(o, { limitMs: lim, sentToday, retry: true }), cwd);
        used = MODEL;
        if (!res.ok) res = { ok: false, noRetry: true, why: `두 번 다 실패 — 사람 확인 필요(앞 시도가 ${addr ? '저장' : '지급'}까지 갔는지 센터에서 먼저 확인) · 첫 실행: ${clean(first.why, 120)} · 재시도: ${clean(res.why, 150)}` };
    }
    if (res.ok && addr && sentToday && /^\s*✅/.test(res.answer) && !res.answer.includes('오늘 발주 나감')) res.answer = res.answer.replace(/^[^\n]*/, m => m + '\n' + SENT_LINE);
    if (res.ok) keepWrite({ at: new Date().toISOString() });   // 센터를 방금 썼음 = 로그인 유지 틱 30분 뒤로
    return { ...res, model: used };
}
async function doRank(db, o) {
    const startedAt = Date.now();
    const script = process.env.VM_RANK_SCRIPT || path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js');
    const r = await run(process.env.VM_NODE_BIN || process.execPath, [script, '--apply'], { limitMs: RANK_LIMIT_MS, onTick: () => heartbeat(db, 'busy', o.id), env: { ...process.env, KR_LOCK_HELD: '1' } });   // #1088 잠금은 러너가 이미 잡음 → keyword-rank 가 제 부모 잠금을 기다리지 않게
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
//   러너가 쉴 때(집을 지시 0) 마지막 센터 사용 30분 뒤 → 키워드(krBusy)·잠금 피해(#1088 쉼 창 없음) 잠금 잡고 → 센터 첫 화면 탭(없으면 엶) 새로고침
//   → 로그인 화면이면 「간편 로그인」 단추 1회 → 2단계·폰 승인·보안 확인 화면이면 멈춤 + 텔레그램(서버 하루 1통) + 3시간 안 누름
//   지급·배송지 화면은 열지 않음(센터 첫 화면 탭만) · aside.exe 없는 PC(노트북·검증) = 아무것도 안 함
const ASIDE_EXE = process.env.ASIDE_EXE || path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Aside', 'CLI', 'current', 'aside.exe');
let asideFactory = null, keepNotify = null;   // 시험용 갈아끼우기(_setKeep)
function keepRead() { try { const j = JSON.parse(fs.readFileSync(KEEP_STATE, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function keepWrite(patch) { try { fs.mkdirSync(DIR, { recursive: true }); const s = { ...keepRead(), ...patch }; const tmp = KEEP_STATE + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, KEEP_STATE); } catch (e) { log('센터 유지 상태 쓰기 실패(무시): ' + e.message); } }
// #1266 heartbeat 에 싣는 센터 유지 결과(노트북에서 읽히게 · 상태 파일의 center_* 칸 = 유지 틱이 실제로 돈 시각 · 「at」 칸은 어사이드 다시 열기가 앞당겨 써서 따로 둠) · 유지가 한 번도 안 돈 PC = 빈 것
function hbCenter() { const k = keepRead(); return k.center_at ? { center: { state: String(k.center_state || ''), at: k.center_at, store: String(k.center_store || '').slice(0, 40) } } : {}; }
/* #1281 jsKeep(ro) = ro 면 「상태 읽기만」(로그인 실패·폰 승인 뒤 3시간 쉼 동안 · 단추 누름 0) · JS_KEEP = 종전 유지 틱(누름 있음) */
const jsKeep = ro => `const RO = ${ro ? 'true' : 'false'};
const HOME =${JSON.stringify(CENTER_HOME)};
let t = null, opened = false;
for (const x of tabs) { try { if (/^https:\\/\\/sell\\.smartstore\\.naver\\.com\\/#\\/home\\/dashboard/.test(x.url())) { t = x; break; } } catch (e) {} }
const wait = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now(), used = () => Date.now() - T0;   /* #1281-b 어사이드 repl 자체 상한 120초 = #1281 기다림(머리 다시 보기·「로그인하기」 뒤·간편 로그인 단추 찾기)은 시작 35초 안에서만 · 8초 재확인은 100초 안에서만(#1266 새 창 기다림·새로고침은 종전 그대로) */
const pre0 = new Set(tabs); let retried = false;   /* pre0 = 이 틱이 손대기 전부터 있던 탭(뒷정리 때 건드리지 않음) */
if (!t) { try { t = await openTab(HOME); } catch (e) { retried = true; await wait(5000); t = await openTab(HOME); } opened = true; }   /* #1242 어사이드가 막 켜지는 중이면 새 탭이 사라짐(재부팅 직후 실례) → 5초 뒤 1번 더 */
else { try { await t.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { try { await t.evaluate(() => location.reload()); } catch (_) {} } }
/* #1230 화면 읽기 = 주소 + 머리 글(로그아웃 글자 = 로그인됨 · 「로그인하기」 단추 = 로그인 안 된 첫 화면 · 로그아웃 아래 줄 = 지금 스토어 이름 · VM #3765 실측 꼴) */
const look = async () => { let u = '', r = null; try { u = t.url(); } catch (e) {} try { r = await t.evaluate(() => { const b = document.body && document.body.innerText || ''; const h = b.slice(0, 3000); const m = /로그아웃\\s*\\n\\s*좌측 내비게이션 펼쳐보기\\s*\\n\\s*([^\\n]{1,40})/.exec(h); return { txt: b.slice(0, 2000), out: /로그아웃/.test(h), first: [...document.querySelectorAll('button, a, [role=button]')].some(e => /^\\s*로그인하기\\s*$/.test(e.innerText || e.textContent || '')), store: m ? m[1].trim() : '' }; }); } catch (e) {} r = r || {}; return { u, txt: r.txt || '', out: !!r.out, first: !!r.first, store: r.store || '' }; };
const isLogin = s => /nid\\.naver\\.com|accounts\\.commerce\\.naver\\.com|\\/login/i.test(s.u);
const isSell = s => /sell\\.smartstore\\.naver\\.com/.test(s.u);
const isPhone = s => /2단계|인증번호|본인\\s*확인|보안\\s*확인|기기\\s*등록|새로운\\s*기기|승인\\s*요청|휴대폰으로/.test(s.txt);
const t0 = t; let tPop = null;   /* tPop = 「로그인하기」를 눌러 새로 뜬 로그인 탭(뒷정리 때 닫음) */
const pre2 = new Set(); let waited = 0;   /* #1266 pre2 = 간편 로그인 누르기 전 탭 · waited = 로그인 창이 닫히길 기다린 횟수 */
const pops = () => { const o = []; for (const x of tabs) { try { if (!pre2.has(x) && x !== t0 && /nid\\.naver\\.com|accounts\\.commerce\\.naver\\.com/.test(x.url())) o.push(x); } catch (e) {} } return o; };   /* 간편 로그인 뒤 새로 뜬 로그인 창(닫힌 탭은 url() 이 던져 빠짐) */
const lookAt = async x => { const k = t; t = x; try { return await look(); } finally { t = k; } };
await wait(7000);   /* #1242 실측 = 새 탭은 5초에야 머리 글이 보임(1·3초 빈 화면) → 5 → 7초 · 다시 보기 4 → 6초 */
let a = await look(), state = 'ok', clicked = false, first = false;
for (let i = 0; i < 3 && used() < 35000 && !isLogin(a) && isSell(a) && !a.out && !a.first; i++) { await wait(6000); a = await look(); }   /* 머리가 아직 안 그려졌으면 다시 봄(#1281 한 번 → 6초씩 최대 3번 = 「로그인하기」 첫 화면이 늦게 그려지는 때) */
if (!RO && !isLogin(a) && isSell(a) && !a.out && a.first) {   /* #1230 로그인 안 된 첫 화면(「로그인하기」·「가입하기」) = 그 단추 1회 → 커머스ID 화면 · #1281 읽기만(RO)이면 안 누름 */
  const pre1 = new Set(tabs);   /* 누르기 전 탭 목록 = 그 뒤 새로 생긴 로그인 탭만 이 틱 것으로 봄(앞선 지시가 사람 몫으로 남긴 로그인·보안 탭은 손대지 않음) */
  try { first = await t.evaluate(() => { const el = [...document.querySelectorAll('button, a, [role=button]')].find(e => /^\\s*로그인하기\\s*$/.test(e.innerText || e.textContent || '')); if (el) { el.click(); return true; } return false; }); } catch (e) { first = false; }
  if (first) {
    for (let i = 0; i < 6 && (i === 0 || used() < 35000); i++) {   /* #1281 고정 6초 1번 → 커머스ID 화면(같은 탭·새 탭)이 보일 때까지 6초 + 4초씩 최대 약 26초 */
      await wait(i ? 4000 : 6000); t = t0; a = await look();
      if (!isLogin(a)) { for (const x of tabs) { try { if (x !== t0 && !pre1.has(x) && /nid\\.naver\\.com|accounts\\.commerce\\.naver\\.com/.test(x.url())) { t = x; tPop = x; a = await look(); break; } } catch (e) {} } }   /* 새 탭으로 뜬 때 */
      if (isLogin(a) || a.out || isPhone(a)) break;
    }
  }
}
if (RO) {   /* #1281 읽기만 = 누름·새 로그인 0 · 로그인돼 있으면 ok · 아니면 logged_out(쉼 그대로 · 텔레그램 0) */
  state = isPhone(a) ? 'need_phone' : !isLogin(a) && isSell(a) && a.out ? 'ok' : !isLogin(a) && !isSell(a) ? 'unknown' : !isLogin(a) && !a.first ? 'unknown' : 'logged_out';
} else if (isLogin(a)) {
  if (isPhone(a)) state = 'need_phone';
  else {
    for (const x of tabs) pre2.add(x);   /* #1266 간편 로그인을 누르기 전 탭 = 그 뒤 새로 뜬 로그인 창(OAuth 팝업)만 이 틱 것으로 봄 */
    for (let i = 0; i < 10 && !clicked && (i === 0 || used() < 35000); i++) {   /* #1281 커머스ID 화면이 덜 그려져 단추가 아직 없으면 3초씩 최대 약 30초 기다림(누름은 찾았을 때 1번 · 그 사이 폰 승인·로그인됨이 보이면 그만) */
      if (i) { await wait(3000); const b = await look(); if (isPhone(b) || (!isLogin(b) && isSell(b) && b.out)) { a = b; break; } }
      try { clicked = await t.evaluate(() => { const el = [...document.querySelectorAll('button, a, [role=button]')].find(e => /간편\\s*로그인/.test(e.innerText || e.textContent || '')); if (el) { el.click(); return true; } return false; }); } catch (e) { clicked = false; }
    }
    if (!clicked) state = isPhone(a) ? 'need_phone' : !isLogin(a) && isSell(a) && a.out ? 'relogin' : 'login_fail';
    else {
      await wait(8000); a = await look();
      if (t !== t0 && !isSell(a) && !isPhone(a)) { t = t0; try { await t.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {} await wait(5000); a = await look(); }   /* 로그인 탭이 닫혔으면 처음 탭에서 다시 봄 */
      /* #1266 아직 로그인 전으로 보이면(11/22·11/23 실례 = 손으로는 간편 로그인 1번에 되는데 여기서만 실패) = 간편 로그인이 따로 띄운 로그인 창이 닫힐 때까지 기다림(5초씩 최대 6번 = 30초 · 단추는 더 누르지 않음)
         → 그 창이 2단계·폰 승인이면 need_phone(그대로 둠) → 아니면 처음 탭을 새로고침해 한 번 더 판정(그래도 로그인 전이면 종전 login_fail) */
      if (!(!isLogin(a) && isSell(a) && !a.first) && !isPhone(a)) {
        let ph = false;
        for (let i = 0; i < 6; i++) { const ps = pops(); if (!ps.length) break; for (const x of ps) { const b = await lookAt(x); if (isPhone(b)) ph = true; } if (ph) break; waited++; await wait(5000); }
        if (ph) state = 'need_phone';
        else { t = t0; try { await t.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (e) { try { await t.evaluate(() => location.reload()); } catch (_) {} } await wait(7000); a = await look(); if (!isLogin(a) && isSell(a) && !a.out && !a.first) { await wait(6000); a = await look(); } }
      }
      if (state !== 'need_phone' && !(!isLogin(a) && isSell(a) && !a.first) && !isPhone(a) && used() < 100000) { t = t0; await wait(8000); a = await look(); }   /* #1281 그래도 로그인 전으로 보이면 8초 뒤 처음 탭을 한 번 더 봄(누름·새로고침 없음 · 로그인 넘어가는 중을 헛 login_fail 로 치지 않게) */
      if (state !== 'need_phone') state = !isLogin(a) && isSell(a) && !a.first ? 'relogin' : isPhone(a) ? 'need_phone' : 'login_fail';
    }
  }
} else if (!isSell(a)) state = 'unknown';
else if (a.out) state = first ? 'relogin' : 'ok';
else state = a.first ? 'login_fail' : 'unknown';   /* #1230 주소만 보고 ok 로 치지 않음(로그아웃 글자가 보여야 ok) */
let where = ''; try { const q = new URL(a.u); where = q.host + q.pathname; } catch (e) {}
/* #1242 뒷정리 = 이 틱이 연 탭은 닫고 나감(30분마다 새 탭이 하나씩 쌓이지 않게 · 로그인은 쿠키라 탭을 닫아도 유지) · 원래 열려 있던 탭·사람이 풀어야 하는 화면(폰 승인·로그인 실패)은 그대로 둠 */
let closed = 0;
if (state === 'ok' || state === 'relogin' || state === 'unknown' || state === 'logged_out' || (RO && state === 'need_phone')) { const mine = [];   /* #1281-b 읽기만 틱이 연 탭은 폰 승인 화면이어도 닫음(쉼 3시간 동안 쌓이지 않게 · 누름 있는 틱의 「사람이 풀 화면은 둠」은 그대로) */   /* #1281 logged_out = 읽기만 틱이 연 탭(사람이 풀 화면 아님) */ if (opened) mine.push(t0); if (tPop) mine.push(tPop);
  if (state === 'relogin' && clicked) { for (const x of pops()) mine.push(x); }   /* #1266 로그인은 됐는데 남은 로그인 창(간편 로그인 뒤 이 틱에 뜬 것만) */
  if (retried) { try { for (const x of tabs) { if (x === t0 || x === tPop || pre0.has(x)) continue; let u = ''; try { u = x.url(); } catch (e) {} if (isSell({ u })) mine.push(x); } } catch (e) {} }   /* 첫 열기가 「실패」했는데 탭은 생겨 있던 때 = 이 틱이 만든 센터 탭 여분만(전부터 있던 탭은 pre0 로 가림) */
  for (const x of mine) { try { await closeTab(x); closed++; } catch (e) {} } }
console.log(JSON.stringify({ state, clicked, first, opened, closed, waited, where, ro: RO, store: state === 'ok' || state === 'relogin' ? a.store : '' }));`;
const JS_KEEP = jsKeep(false), JS_KEEP_RO = jsKeep(true);
async function keepCenterOnce(ro) {
    const aside = asideFactory ? asideFactory() : new (require(path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js')).Aside)(ASIDE_EXE, s => log(s));
    let timer = null;
    try {
        await aside.start();
        return await Promise.race([aside.replJson(ro ? '#1281 센터 로그인 상태 읽기(누름 0)' : '#1082 센터 로그인 유지', ro ? JS_KEEP_RO : JS_KEEP), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('센터 유지 5분 넘음')), 5 * 60000); })]);
    } finally { clearTimeout(timer); await Promise.resolve(aside.stop({ keepTabs: true })).catch(() => { }); }   // 센터 탭은 남김(다음 새로고침·지급이 씀)
}
// 🔵 텔레그램은 체험 자동(experience_auto)의 길을 빌림 → experience_auto.enabled 를 끄면(403) 로그인 알림도 같이 꺼짐(로그만 남음)
async function keepTell(reason, kind) {   // kind = 서버가 갈래마다 하루 1통(center_login 종전 · #1230 center_store)
    if (keepNotify) return keepNotify(reason, kind || 'center_login');
    const API = String(process.env.EXP_AUTO_API || '').replace(/\/+$/, ''), TOKEN = String(process.env.EXP_AUTO_TOKEN || '');
    if (!/^https?:\/\//.test(API) || TOKEN.length < 32) { log('센터 유지: 텔레그램 길 없음(.env EXP_AUTO_API·TOKEN) — 로그만'); return false; }
    try {   // 서버 텔레그램 길 = 체험 번호 자동의 「예약 없는 멈춤」(id 0 · kind 갈래당 하루 1통 · #1040)
        const r = await fetch(API + '/api/experience/auto/0/miss', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, kind: kind || 'center_login' }), signal: AbortSignal.timeout(15000) });
        return r.status === 200;
    } catch (e) { log('센터 유지: 텔레그램 못 보냄 ' + e.message); return false; }
}
// ── #1242 VM 메모리(커밋) 감시 · 메모리 부족 알림 ──
//   텔레그램 길 = keepTell 그대로(서버가 갈래마다 하루 1통 · 머리말 「🖥️ VM 확인 필요」 = experience.js missTgText) · 러너 쪽도 하루 1번만 부름(상태 파일 *_told_day)
let memReader = null;   // 시험용 갈아끼우기(_setMem)
const isOomText = s => /OutOfMemory|out of memory|bun\.report/i.test(String(s || ''));
async function tellOnce(key, reason, kind) { const st = keepRead(); if (st[key] === kstDay()) return false; const told = await keepTell(reason, kind); if (told) keepWrite({ [key]: kstDay() }); return !!told; }
function memRead() {
    if (memReader) return memReader();
    if (process.platform !== 'win32') return null;
    try {
        const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '$o = Get-CimInstance Win32_OperatingSystem; "$($o.FreeVirtualMemory) $($o.TotalVirtualMemorySize)"'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
        const m = /(\d+)\s+(\d+)/.exec(String(out)); return m ? { free_mb: Math.round(Number(m[1]) / 1024), total_mb: Math.round(Number(m[2]) / 1024) } : null;
    } catch (e) { return null; }
}
async function memMaybe(force) {
    if (!MEM_MS && !force) return null;
    if (!force && MEM.at && Date.now() - MEM.at < MEM_MS) return null;
    let r = null; try { r = memRead(); } catch (e) { r = null; }
    MEM.at = Date.now();
    if (!r || !Number.isFinite(r.free_mb)) return null;
    MEM.free_mb = r.free_mb; MEM.total_mb = r.total_mb;
    log(`메모리 · 커밋 여유 ${r.free_mb} / ${r.total_mb}MB`);
    if (r.free_mb < MEM_LOW_MB) await tellOnce('mem_told_day', `VM 메모리(커밋) 여유 ${r.free_mb}MB — VM 재부팅이 필요해요 · 그 전엔 [VM] 지시(포인트·배송지)가 실패할 수 있음`, 'vm_mem');
    return r;
}
// ── #1242-2 어사이드 앱 다시 열기(누수 돌려받기) ──
let asideKiller = null;   // 시험용 갈아끼우기(_setAsideKill)
function asideKill() {
    if (asideKiller) return asideKiller();
    if (process.platform !== 'win32') return false;
    // 🔴 앱(Aside.exe)과 데몬(aside-daemon.exe)을 반드시 같이 끈다(실측 11/22): 앱만 끄면 데몬이 남아 다음 사용이 「Profile 0 is not connected to the daemon」으로 계속 실패 · 둘 다 없으면 다음 사용 때 「Aside isn't running. Opening it in the background…」로 저절로 켜지고 로그인(쿠키)도 그대로
    //   이름만으로 끄면(taskkill /IM Aside.exe) 같은 이름의 CLI(…\Aside\CLI\current\aside.exe = 러너·「워커VM」 세션의 MCP 연결)까지 꺼짐 → 실행 파일 경로에 \CLI\ 가 든 것은 빼고 앱 본체 + 데몬만
    try {
        const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ASIDE_KILL_PS], { encoding: 'utf8', timeout: 30000, windowsHide: true });
        return Number(String(out).trim().split(/\s+/).pop()) > 0;
    } catch (e) { return false; }
}
const ASIDE_KILL_PS = "$n = 0; Get-CimInstance Win32_Process | ? { ($_.Name -ieq 'aside-daemon.exe') -or (($_.Name -ieq 'Aside.exe') -and ($_.ExecutablePath -notmatch '\\\\CLI\\\\')) } | % { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $n++ } catch { } }; $n";
async function asideRecycleMaybe(now) {
    const t = now || Date.now(), st = keepRead(), day = kstDay(), hour = new Date(t + 9 * 3600e3).getUTCHours();
    let why = '';
    if (ASIDE_RECYCLE_MB > 0 && MEM.free_mb != null && MEM.free_mb < ASIDE_RECYCLE_MB && !(st.aside_recycle_low_at && t - Date.parse(st.aside_recycle_low_at) < ASIDE_RECYCLE_GAP_MS)) why = 'low';
    else if (ASIDE_RECYCLE_HOUR >= 0 && hour === ASIDE_RECYCLE_HOUR && st.aside_recycle_day !== day) why = 'daily';
    if (!why) return null;
    if (busyWhy()) return null;   // 키워드 순위·체험 번호 틱이 어사이드를 쓰는 중 = 다음 주기에
    if (!asideKiller && process.platform !== 'win32') return null;
    if (!lockTake()) return null;
    let killed = false; const before = MEM.free_mb;
    try { killed = !!asideKill(); } catch (e) { killed = false; } finally { lockFree(); }
    const at = new Date(t).toISOString();
    // 끈 뒤 첫 로그인 유지 = 약 75초 뒤(바로 돌면 어사이드가 켜지는 중이라 「Tab … is no longer available」 = 11/22 13:49 실례) · 그 틱이 error 면 90초 뒤 1번 더(keep_retry) · 그래도 error 면 종전 30분
    //   여유가 낮아 끈 것이 마침 하루 1번 시각대면 그날 치도 한 것으로 침(같은 시간대에 두 번 끄지 않게)
    keepWrite({ aside_recycle_at: at, aside_recycle_why: why, ...(why === 'low' ? { aside_recycle_low_at: at } : {}), ...(why === 'daily' || hour === ASIDE_RECYCLE_HOUR ? { aside_recycle_day: day } : {}), ...(KEEP_MS > 0 ? { at: new Date(t - KEEP_MS + 75000).toISOString(), keep_retry: 1 } : {}) });
    MEM.at = 0;   // 다음 주기에 메모리를 다시 잼(돌아온 양이 로그에 남음)
    log(`어사이드 다시 열기 · ${why === 'low' ? '커밋 여유 ' + before + 'MB < ' + ASIDE_RECYCLE_MB + 'MB' : '하루 1번(' + ASIDE_RECYCLE_HOUR + '시)'} · ${killed ? '앱 끔(다음에 쓸 때 저절로 켜짐)' : '끌 앱 없음'}`);
    return { why, killed, before };
}
async function keepMaybe(force) {
    if (!KEEP_MS && !force) return null;
    const st = keepRead(), now = Date.now();
    // #1281 로그인 실패·폰 승인 뒤 3시간 쉼 = 누름은 쉬되 30분마다 「상태 읽기만」(사람 손으로 로그인을 살렸으면 ok 로 · 쉼 풀림 · 텔레그램 0)
    const ro = !force && !!st.phone_at && now - Date.parse(st.phone_at) < KEEP_PHONE_BACKOFF_MS;
    if (!force) {
        if (st.at && now - Date.parse(st.at) < KEEP_MS) return null;
    }
    if (busyWhy()) return null;   // 키워드 도는 중 · 남의 잠금(#1088 09:10~09:45 쉼 창 없앰)
    if (!asideFactory && !fs.existsSync(ASIDE_EXE)) return null;   // VM 아닌 PC
    if (!lockTake()) return null;
    let r;
    try { r = await keepCenterOnce(ro); } catch (e) { r = { state: 'error', error: clean(e.message, 200) }; }
    finally { lockFree(); }
    const at = new Date().toISOString();
    if (ro && !(r && r.state === 'ok')) {   // #1281 읽기만 틱에서 로그인 전·폰 승인·판정 못 함·오류 = 쉼 그대로 · heartbeat 센터 칸 그대로(종전 실패 판정 유지) · 알림 0 · unknown 셈 0
        keepWrite({ at, ro_at: at, ro_result: r && r.state || '', error: r && r.error || null });
        log(`센터 로그인 상태 읽기(쉼 중 · 누름 0) · ${r && r.state}${r && r.where ? ' · ' + r.where : ''}${r && r.error ? ' · ' + r.error : ''}`);
        return r;
    }
    const roOk = ro && !!r && r.state === 'ok';   // 쉼 중 읽어 보니 로그인돼 있음 = 쉼 풀고 종전 ok 길(직영몰이면 종전 알림)
    // #1230 로그인은 됐는데 센터가 직영몰 스토어로 열려 있음(노트북·VM 이 같은 계정 = 마지막 스토어가 따라옴) → 알림만(자동으로 옮기지 않음) · 텔레그램은 하루 1통
    const wrongStore = !!r && (r.state === 'ok' || r.state === 'relogin') && /직영몰/.test(String(r.store || ''));
    if (wrongStore) r = { ...r, state: 'wrong_store', login: r.state };
    keepWrite({ at, result: r && r.state, error: r && r.error || null, center_at: at, center_state: r && r.state || '', center_store: r && r.store || '', ...(r && r.state === 'need_phone' ? { phone_at: at } : {}), ...(roOk ? { phone_at: null, ro_at: at, ro_result: 'ok' } : {}) });   // #1266 center_* = heartbeat 가 실어 보냄 · #1281 roOk = 쉼 풀림
    if (st.keep_retry) keepWrite(r && r.state === 'error' && KEEP_MS > 0 ? { keep_retry: 0, at: new Date(Date.now() - KEEP_MS + 90000).toISOString() } : { keep_retry: 0 });   // #1242-2 어사이드를 다시 연 직후의 첫 틱이 오류면 90초 뒤 1번만 더
    log(`센터 로그인 유지 · ${r && r.state}${r && r.where ? ' · ' + r.where : ''}${r && r.store ? ' · 스토어 ' + clean(r.store, 30) : ''}${r && r.closed != null ? ' · 탭 닫음 ' + r.closed : ''}${r && r.error ? ' · ' + r.error : ''}`);
    if (r && (r.state === 'ok' || r.state === 'relogin') && !r.store) log('센터 로그인 유지 · 스토어 이름 못 읽음(머리 글 꼴이 바뀌었는지 확인)');
    // #1230-② 판정 못 함(unknown)이 연속 3번(1.5시간) = 진짜 풀림을 삼켰을 수 있음 → 텔레그램 하루 1통(쉼 없음) · 판정이 나오면(ok·relogin·직영몰·로그인 실패·폰 승인) 셈 0 · 어사이드 오류는 셈 그대로
    if (r && r.state === 'unknown') {
        const n = (Number(st.unknown_n) || 0) + 1; keepWrite({ unknown_n: n });
        if (n >= 3 && st.unknown_told_day !== kstDay()) {
            const told = await keepTell(`VM 센터 로그인 상태를 ${n}번 연속 못 읽음 — VM 어사이드에서 스마트스토어센터 첫 화면을 열어 로그인 상태를 봐 주세요 · 풀려 있으면 포인트·배송지 [VM] 멈춤`, 'center_unknown');
            if (told) keepWrite({ unknown_told_day: kstDay() });
        }
    } else if (r && r.state !== 'error' && st.unknown_n) keepWrite({ unknown_n: 0 });
    if (wrongStore && st.store_told_day !== kstDay()) {
        const told = await keepTell('VM 센터가 직영몰로 열려 있음 — VM 어사이드 센터에서 [스토어 이동]으로 「제주아꼼이네」 스마트스토어로 바꿔 주세요 · 그 전엔 포인트·배송지 [VM] 멈춤', 'center_store');
        if (told) keepWrite({ store_told_day: kstDay() });
    }
    if (r && (r.state === 'need_phone' || r.state === 'login_fail')) {
        await keepTell(r.state === 'need_phone' ? '스마트스토어센터 로그인 풀림(2단계·폰 승인 화면) — VM 어사이드 센터 탭에서 승인해 주세요 · 그 전엔 포인트·배송지 [VM] 멈춤'
            : '스마트스토어센터 로그인 풀림(간편 로그인 안 됨) — VM 어사이드 센터 탭에서 로그인해 주세요 · 그 전엔 포인트·배송지 [VM] 멈춤');
        if (r.state === 'login_fail') keepWrite({ phone_at: at });   // 같은 3시간 쉼(단추 거듭 누르지 않게)
    }
    return r;
}
// #1087 포인트·배송지 쉼 없음 → #1088 모든 갈래 쉼 없음
//   #1088(대표 「쉬는 시간 다 없애고 줄 세우기로」) = 모든 갈래 쉼 창 없음 · 겹침은 잠금 줄 세우기(키워드 순위도 같은 잠금을 기다림 · keyword-rank.js krLockWait) + krBusy(키워드 도는 중엔 새로 안 집음)
function skipWhy(content, k) { return ''; }   // eslint-disable-line no-unused-vars
// 한 번 보기: 쉼 판단 → 집을 것 → 잠금 → 처리
async function pollOnce(db) {
    const why = busyWhy(); if (why) return { skipped: why };
    const id = await pick(db); if (!id) { const k = await keepMaybe(); return k ? { idle: true, keep: k.state } : { idle: true }; }
    const content = ((await db.query(`SELECT content FROM pending_orders WHERE id = $1`, [id])).rows[0] || {}).content;
    const why2 = skipWhy(content, kstNow()); if (why2) return { skipped: why2, id };   // 지시는 대기에 남음
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
            try { await memMaybe(); await asideRecycleMaybe(); } catch (e) { /* #1242 메모리 재기·어사이드 다시 열기 실패는 무시 */ }
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
module.exports = { skipWhy, isRank, RANK_RE, isPoint, POINT_RE, POINT_LIMIT_MS, isAddr, isFast, FAST_MODEL, FAST_LIMIT_MS, MODEL, finalSentToday, SENT_LINE, keepMaybe, KEEP_STATE, JS_KEEP, JS_KEEP_RO, _setKeep: (f, n) => { asideFactory = f || null; keepNotify = n || null; }, memMaybe, MEM, isOomText, asideRecycleMaybe, ASIDE_KILL_PS, _setAsideKill: f => { asideKiller = f || null; }, tellOnce, claudeOnce, _setMem: f => { memReader = f || null; MEM.at = 0; MEM.free_mb = null; MEM.total_mb = null; }, bodyOf, head60, takeAttach, promptFor, busyWhy, inSkip, lockTake, claudeCwd, ALLOWED, DENIED, lockFree, lockBusy, pick, claim, respond, recoverOwn, handle, pollOnce, heartbeat, LOCK, STATE, OUT_DIR, MAX_TRIES, MAX_CLAIMS_DAY };

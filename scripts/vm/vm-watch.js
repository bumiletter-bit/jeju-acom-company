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
//   🔴 창구(get.js·respond.js)를 부르지 않고 같은 꼴을 여기서 쓴다 = 둘 다 창구 heartbeat(desk_heartbeat)를 덮어 창구 「자리 비움」 판정이 흐려지므로.
//     VM heartbeat = agent_office_config 'vm_heartbeat' {at, state, order_id, host} 따로(60초마다)
//   기동 복구 = 「[VM]」 머리 '처리중'만 '대기'로(자기 것만 · 창구 지시는 손대지 않음 · vm_heartbeat 2분 안에 살아 있는 러너가 돌리는 지시는 건너뜀)
//   로그 = ~/.akkome/logs/vm-watch-YYYY-MM-DD.log(지시 본문은 머리 60자만) · 시도 횟수 = ~/.akkome/vm-watch-state.json
//   사용: node scripts/vm/vm-watch.js            (계속 돎)
//         node scripts/vm/vm-watch.js --once     (한 번만 보고 끝 · 시험)
//         node scripts/vm/vm-watch.js --status   (잠금·키워드·상태 파일만 · DB 0)
//   env(시험용): VM_CLAUDE_BIN(.js 면 node 로 띄움) · VM_NODE_BIN · VM_RANK_SCRIPT · VM_POLL_MS · VM_ORDER_LIMIT_MS · VM_RANK_LIMIT_MS · VM_POINT_LIMIT_MS · VM_MODEL
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
const ALLOWED = 'mcp__aside__repl,mcp__aside__exec';   // 어사이드만(교차 점검 2 · 파일 읽기 도구는 .env 유출 길이라 막음)
const DENIED = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Read,Grep,Glob';
// claude 작업 폴더 = 늘 ~/.akkome/vm-out/<지시번호>(리포 밖 = 리포 CLAUDE.md 안 실림 · .env 있는 C:\akm-vm 도 피함 · aside MCP 는 user 설정이라 그대로)
const TOUCH_MS = Number(process.env.VM_TOUCH_MS) || 60000;   // 도는 동안 잠금 mtime·vm_heartbeat(busy) 갱신 간격
const MAX_TRIES = 2;   // 첫 실패 = 대기로 한 번 되돌림 · 두 번째 실패 = 오류
// 키워드 순위 09:30 창 피하기 = 상한만큼 앞당김(claude 10분 → 09:20 · 순위 20분 → 09:10)
const SKIP_CLAUDE = ['09:20', '09:45'], SKIP_RANK = ['09:10', '09:45'];
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
const POINT_ANY = [s => POINT_RE.test(s), s => /포인트/.test(s) && /지급/.test(s), s => /보상\s*(?:처리|지급)/.test(s), s => /네이버\s*페이/.test(s) && /보상/.test(s)];
function isPoint(content) { const b = bodyOf(content); return !isRank(content) && POINT_ANY.some(f => f(b)); }

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
const POINT_STEPS = [   // #1080(대표 11/9 23:1x) ①구매자 아이디 회원검색 · 목적 = 구매확정 이력 있으면 구매 프로모션 적립 · 없으면 비구매 적립 ②중복 = 오늘 같은 아이디만 멈춤 ③주문 찾기 최근 3개월 ④지급 화면 매번 새로 · [지급대상 확인] 무반응 = 처음부터 1회만 다시 ⑤비즈월렛 자동충전(잔액은 보고 줄에만)
    '[절차] 네이버페이 포인트 보상 지급',
    '(a) 스마트스토어센터 로그인 = 커머스ID 「간편 로그인」 단추(비밀번호 입력 X · 금고 자동 채움). 2단계 인증·보안 확인이 뜨면 규칙 ②대로 멈춘다.',
    '(b-1) #1064 지시에 네이버 아이디(영문·숫자 아이디 · 예 saygoodjod)가 직접 적혀 있으면 주문 한 건을 특정할 필요가 없다 → 센터 회원검색에서 그 아이디 1건 확인 + 판매관리 › 주문통합검색(기간 = 최근 3개월)에서 구매자ID 로 지시 품목(예 타이벡) 주문이 1건 이상 있는지만 확인한다(여러 건이어도 OK · 어느 건인지 가리지 않음) → (c)(d)(e) 대로 지급. 「주문이 여럿이라 어느 건인지 몰라 못 함」 식으로 멈추지 않는다.',
    '(b) 아이디 없이 주문번호(또는 이름·끝4·「오늘 n시 톡톡」)로 온 지시 = 판매관리 › 주문통합검색(기간 = 최근 3개월 · 한 달 넘어 연락 오는 손님도 있다)에서 주문을 찾아 구매자 아이디·품목·결제금액·구매확정 여부를 확인한다 → 그 **구매자 아이디**로 지급한다. 톡톡 아이디가 닉네임이거나 끝 밑줄 「_」이 빠져 보이면 톡톡 파트너센터 손님 정보 → 주문이력 → 주문번호로 묶고, 센터 회원검색 0건이면 이름 검색 뒤 마스킹 앞 글자로 대조한다.',
    '(c) 중복 막기 = 혜택/마케팅 › 포인트 지급관리 목록(지급 시점 「오늘」)에서 **오늘** 같은 아이디 지급 줄이 있을 때만 지급하지 않고 「이미 오늘 지급됨 · 일련번호 · 금액」으로 답한다(다시 집힌 지시도 이 확인으로 중복 0). 어제·지난달 등 그 전 지급은 막지 않는다 — 지급은 그대로 하고 끝 보고에 「전에도 받음: 날짜 · 금액 · 사유」 한 줄만. 화면의 「최근 30일 지급」 칸에 값이 나와도 그것 때문에 멈추지 않는다.',
    '(d) 지급 화면은 매번 새로 연다(혜택/마케팅 › 포인트 지급관리 메뉴로 들어가거나 새로 고침 · 전에 열어 둔 탭·입력 칸을 그대로 쓰지 않는다) → [포인트 지급] = 지급 목적(그 아이디에 구매확정 이력이 있으면 「구매 프로모션 적립」 · 없으면 「비구매 적립」) · 지급사유 = 지시 글 그대로(15자 안) · 금액 = 지시 금액 그대로(다른 금액·다른 손님 X) → 회원검색에 그 구매자 아이디 → 추가 → [지급대상 확인](지급대상 1명·금액 · 지급불가 사유 없음 확인) → [확인] → 확인창 [확인] 1회. 「서비스에 에러」 띠가 뜨면 목록에 새 줄이 없을 때만 1회 더(중복 0).',
    '(d-2) [지급대상 확인]을 눌러도 반응이 없으면(창·결과 표가 안 뜸) → 지급 목록(오늘)에 새 줄이 없는지 먼저 확인(지급 0) → 지급 화면을 새로 열어 (d) 를 처음부터 **1회만** 다시 → 그래도 반응이 없으면 지급하지 말고 멈춰 「⚠️ 포인트 지급 못 함 — [지급대상 확인] 무반응(2회) · 지급 0 확인」과 화면 값으로 답한다.',
    '(e) 끝 보고(#1076 대표 꼴) = 첫 줄 「✅ 포인트 n,nnn원 지급 완료」(실패면 「⚠️ 포인트 지급 못 함 — 까닭」) → 일련번호 · 받는 분 이름 · 네이버 아이디 전체 · 금액 · 사유 · 지급 목적 · 지급 시각 · 비즈월렛 잔액(자동충전 설정됨 = 잔액 부족 걱정 문구 쓰지 않음 · 숫자만) · 성공/실패 수 · (그 전 지급이 있으면) 「전에도 받음: 날짜 · 금액 · 사유」 → 마지막에 「손님께 보낼 톡톡 예문」 한 덩이(보상 n원 네이버페이 포인트로 넣어 드렸다는 사과·감사 2~3문장 · 보내기는 사람).',
    '(f) (b) 길(주문번호·이름·끝4·톡톡 시각) = 지시의 손님 ↔ 주문(품목·결제금액·받은 날) ↔ 아이디 셋 중 하나라도 안 맞거나 후보가 둘 이상이거나 애매하면 / (b-1) 길(아이디 직접) = 회원검색 0건·2건↑이거나 그 아이디에 지시 품목 주문이 0건이면 → 지급하지 않고, 무엇이 안 맞는지 화면 값(이름·번호·네이버 아이디 전체 · 주문번호 · 금액 · 목적)으로 답한다. 손님에게 보내는 톡톡 답은 지시에 「답도 보내」가 있을 때만(없으면 사람 몫).',
    '(g) 지시 글 꼴 예시: 「[VM] 아이디 saygoodjod 포인트 보상 5,000 · 사유 타이벡 파손 보상처리」 · 「[VM] 포인트 보상 지급 주문번호 2026110539641061 6,000 · 사유 타이벡 파손 보상처리」.',
];
function promptFor(o) {
    const out = path.join(OUT_DIR, String(o.id));
    const point = isPoint(o.content);
    return [
        `너는 나스 VM(어사이드 전용 윈도우 PC)의 워커야. 총괄이 창구 대기열로 보낸 지시 #${o.id} 를 처리해.`,
        point
            ? `규칙: ①어사이드 도구(mcp__aside__repl·exec)로 웹 화면을 다룬다. 이 지시는 네이버페이 포인트 보상 지급 일이라 스마트스토어센터 포인트지급 화면의 [회원검색]·[추가]·[지급대상 확인]·[확인] 단추는 아래 [절차]대로 누른다. 그 밖 저장·발송·결제·삭제·설정 변경 단추는 종전대로 누르지 않는다(지시에 그런 일이 있으면 하지 말고 답에 「사람 확인 필요」로 적는다).`
            : `규칙: ①어사이드 도구(mcp__aside__repl·exec)로 웹 화면을 읽고 조회하는 일만 한다. 저장·발송·결제·삭제·설정 변경 단추는 누르지 않는다(지시에 그런 일이 있으면 하지 말고 답에 「사람 확인 필요」로 적는다).`,
        `②로그인·보안 확인 화면이 나오면 그 탭을 그대로 두고 「VM 어사이드에서 로그인/보안 확인 필요」로 답한다. 비밀번호·토큰·.env 값은 읽거나 답에 쓰지 않는다.`,
        `③답은 사내 화면(에이전트 오피스)에만 보이니 손님 이름·전화번호·네이버 아이디는 가리지 말고 전체로 쓴다(센터와 대조해야 함 · 「정*영」「je***」「끝4」 꼴 금지 · #1076 대표). 텔레그램·외부로 보내는 글은 없다. ④답은 한국어로 짧게, 요점부터. 표가 편하면 표.`,
        `⑤파일(캡처·엑셀 등)을 넘겨야 하면 ${out} 폴더 안에 저장하고 답 맨 끝에 「ATTACH: <전체 경로>」 를 파일마다 한 줄씩 적는다(5개까지 · 10MB 이하).`,
        point ? `⑥이 일은 지시당 20분 안에 끝내야 한다.` : `⑥이 일은 지시당 10분 안에 끝내야 한다.`,
        ...(point ? ['', ...POINT_STEPS] : []),
        '', '[지시]', bodyOf(o.content),
    ].join('\n');
}
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
    const cwd = claudeCwd(o.id), limitMs = isPoint(o.content) ? POINT_LIMIT_MS : ORDER_LIMIT_MS;
    const r = await run(findClaude(), ['-p', '--model', MODEL, '--output-format', 'json', '--allowedTools', ALLOWED, '--disallowedTools', DENIED], { input: promptFor(o), limitMs, cwd, onTick: () => heartbeat(db, 'busy', o.id) });
    if (r.timeout) return { ok: false, why: `${Math.round(limitMs / 60000)}분 넘어 끔` };
    let j = null; try { j = JSON.parse(String(r.out).trim().split(/\r?\n/).filter(Boolean).pop() || ''); } catch (e) { j = null; }
    if (r.code !== 0 || !j || j.is_error || (j.subtype && j.subtype !== 'success') || !String(j.result || '').trim()) {
        const why = (j && (j.result || j.subtype)) || String(r.err || r.out || '').trim().split(/\r?\n/).pop() || ('exit ' + r.code);
        return { ok: false, why: 'claude 실패: ' + clean(why, 300) };
    }
    const a = takeAttach(j.result, o.id);
    return { ok: true, answer: a.answer + (a.dropped.length ? `\n\n(올리지 못한 첨부: ${a.dropped.join(', ')} — VM 지시 폴더 밖이거나 형식·크기 밖)` : ''), files: a.files };
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
    const tries = triesBump(o.id), rank = isRank(o.content);
    log(`#${o.id} 집음(${rank ? '순위 갈래' : isPoint(o.content) ? 'claude · 포인트 지급' : 'claude'} · ${tries}번째) :: ${head60(o.content)}`);
    await heartbeat(db, 'busy', o.id);
    let res;
    try { res = o.has_image ? { ok: false, why: '그림 첨부 지시는 VM 길에서 안 받음(글로만)' } : rank ? await doRank(db, o) : await doClaude(db, o); }
    catch (e) { res = { ok: false, why: '러너 오류: ' + e.message }; }
    let out;
    if (res.ok) { out = await respond(db, o, { kind: 'answer', answer: res.answer, title: res.title || '', attachments: res.files || [] }); triesClear(o.id); }
    else if (tries < MAX_TRIES && !o.has_image) { await backToWait(db, o, res.why); out = { ok: true, status: '대기(다시)' }; }
    else { out = await respond(db, o, { kind: 'error', error: res.why }); triesClear(o.id); }
    log(`#${o.id} → ${out.status || out.reason}${res.ok ? '' : ' · ' + clean(res.why, 120)}`);
    await heartbeat(db, 'idle');
    return { id: o.id, did: true, ok: res.ok, status: out.status || out.reason, rank };
}
// 한 번 보기: 쉼 판단 → 집을 것 → 잠금 → 처리
async function pollOnce(db) {
    const why = busyWhy(); if (why) return { skipped: why };
    const id = await pick(db); if (!id) return { idle: true };
    const content = ((await db.query(`SELECT content FROM pending_orders WHERE id = $1`, [id])).rows[0] || {}).content;
    const long = isRank(content) || isPoint(content);   // 상한 20분 갈래(순위·포인트) = 09:10 부터 쉼(상한만큼 앞당김)
    if (inSkip(kstNow(), long)) return { skipped: (long ? '09:10' : '09:20') + '~09:45 키워드 순위 창', id };   // 지시는 대기에 남음
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
module.exports = { isRank, RANK_RE, isPoint, POINT_RE, POINT_LIMIT_MS, bodyOf, head60, takeAttach, promptFor, busyWhy, inSkip, lockTake, claudeCwd, ALLOWED, DENIED, lockFree, lockBusy, pick, claim, respond, recoverOwn, handle, pollOnce, heartbeat, LOCK, STATE, OUT_DIR, MAX_TRIES, MAX_CLAIMS_DAY };

// #832 검증 — 시즌 오픈 알림 발송(POST /api/agent-office/season-waitlist/notify) · 워커3
//   🔴 실DB 쓰기 0 · 실발송 0 · 실AI 0 · server.js 기동 0 — server.js 의 「#832 시즌 오픈 알림 시작~끝」 구간을 떼어 가짜 pool(메모리 행)·가짜 kakaoNotify(sendLms 기록만)·express 포트 0 으로 돈다.
//   보는 것 = 권한 403 · 품목 없음 400 · dry(대상 수·문구·쓰기 0·발송 0·audit 0) · 발송(행 기록·audit 번호 0·smsSafe 이모지 0) · 수신거부 skip · 번호 꼴 bad-tel · 하루 상한 · 실패 = 다시 대상 · 2중 클릭 409 · 스위치 꺼짐 503 · 설정 문구 {item} 치환 · 두 번째 클릭 대상 0 · 목록 SELECT 에 notified_at·notify_result
//   실행: node scripts/verify-832-season-notify.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const express = require('express');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 300))); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 30)); return src.slice(i, j); };
const region = cut('// ── #832 시즌 오픈 알림 시작', '// ── #832 시즌 오픈 알림 끝');
const adminOnlySrc = cut('function adminOnly(req, res, next) {', '// #561');
const handleErrSrc = cut('function handleAdminErr(res, err) {', '// --- REST 라우트');
const kstSrc = cut('function kstTodayStr() {', '// 표기 규칙');

// ── 가짜 DB(메모리 행) ──
const today = new Date();
let rows = [], refusedDigits = [], queries = [], unknownSql = [], claims = [];
const resetRows = () => { rows = [
    { id: 1, item: '제주 레몬', contact: '01011110001', notified: false, notified_at: null, notify_result: null, deleted_at: null },
    { id: 2, item: '제주 레몬', contact: '01011110002', notified: false, notified_at: null, notify_result: null, deleted_at: null },
    { id: 3, item: '제주 레몬', contact: '01011110003', notified: false, notified_at: null, notify_result: null, deleted_at: null },
    { id: 4, item: '제주 레몬', contact: '0101111000', notified: false, notified_at: null, notify_result: null, deleted_at: null },      // 010 10자리 = bad-tel
    { id: 5, item: '제주 레몬', contact: '01011110005', notified: false, notified_at: null, notify_result: null, deleted_at: new Date() },   // 삭제됨 = 대상 아님
    { id: 6, item: '제주 레몬', contact: '01011110006', notified: true, notified_at: new Date(today - 3 * 86400000), notify_result: 'sent', deleted_at: null },   // 이미 보냄
    { id: 7, item: '레드향', contact: '01022220001', notified: false, notified_at: null, notify_result: null, deleted_at: null },
    { id: 8, item: '레드향', contact: '01022220002', notified: false, notified_at: null, notify_result: null, deleted_at: null },
]; };
const pool = { query: async (sql, params) => {
    queries.push(sql);
    const s = String(sql).replace(/\s+/g, ' ');
    if (/SELECT count\(\*\)::int AS n FROM season_waitlist WHERE notify_result = 'sent'/.test(s)) {
        const d = String(params[0]);
        const n = rows.filter(r => r.notify_result === 'sent' && r.notified_at && new Date(r.notified_at.getTime() + 9 * 3600000).toISOString().slice(0, 10) === d).length;
        return { rows: [{ n }] };
    }
    if (/SELECT id, contact FROM season_waitlist WHERE item = \$1 AND deleted_at IS NULL AND notified_at IS NULL AND COALESCE\(notified, false\) = false ORDER BY id/.test(s)) {
        return { rows: rows.filter(r => r.item === params[0] && !r.deleted_at && !r.notified_at && !r.notified).map(r => ({ id: r.id, contact: r.contact })) };
    }
    if (/UPDATE season_waitlist SET notified = false, notified_at = now\(\), notify_result = \$2 WHERE id = \$1 AND notified_at IS NULL RETURNING id/.test(s)) {   // 집기
        const r = rows.find(x => x.id === params[0]); if (!r || r.notified_at) return { rowCount: 0, rows: [] }; r.notified = false; r.notified_at = new Date(); r.notify_result = params[1]; claims.push(r.id); return { rowCount: 1, rows: [{ id: r.id }] };
    }
    if (/UPDATE season_waitlist SET notified = true, notify_result = 'sent' WHERE id = \$1/.test(s)) { const r = rows.find(x => x.id === params[0]); if (!r) return { rowCount: 0 }; r.notified = true; r.notify_result = 'sent'; return { rowCount: 1 }; }
    if (/UPDATE season_waitlist SET notified = false, notified_at = NULL, notify_result = \$2 WHERE id = \$1/.test(s)) { const r = rows.find(x => x.id === params[0]); if (!r) return { rowCount: 0 }; r.notified = false; r.notified_at = null; r.notify_result = params[1]; return { rowCount: 1 }; }
    if (/FROM sms_threads t JOIN sms_messages m/.test(s)) return { rows: refusedDigits.map(d => ({ phone_digits: d })) };
    unknownSql.push(s.slice(0, 120)); throw new Error('가짜 pool: 모르는 SQL — ' + s.slice(0, 120));
} };

// ── 가짜 알림 모듈 ──
let sendCalls = [], sendMode = 'sent', switchOn = true, sendDelayMs = 0;
const SMS_KEEP = new Set(['☎', '★', '☆', '♥', '♡', '▶', '◀', '※']);
const kakaoNotify = {
    smsSafe: s => String(s == null ? '' : s).replace(/📞/gu, '☎').replace(/\p{Extended_Pictographic}/gu, m => SMS_KEEP.has(m) ? m : '').replace(/[️‍⃣]/g, '').split('\n').map(l => l.replace(/[ \t]{2,}/g, ' ').trim()).join('\n'),
    switchOn: () => switchOn,
    sendLms: async (o) => { sendCalls.push(o); if (sendDelayMs) await sleep(sendDelayMs); if (sendMode === 'throw') throw new Error('network down'); return sendMode === 'sent' ? { mode: 'real', status: 'sent', mid: 'm' + sendCalls.length } : { mode: 'real', status: 'failed', error: '{"result_code":"-101","message":"잔액 부족"}' }; },
};
let cfgStore = {}, audits = [];
const naverCfgGet = async k => (k in cfgStore ? cfgStore[k] : null);
const writeAudit = async x => { audits.push(x); };
const adminActor = req => ({ id: req.user.id, name: req.user.name, position: req.user.position, role: req.user.role });
const authMiddleware = (req, res, next) => { const role = String(req.headers['x-role'] || 'admin'); req.user = { id: role === 'admin' ? 1 : 7, name: role === 'admin' ? '대표' : '직원', position: role === 'admin' ? '대표' : '사원', role }; next(); };

(async () => {
    process.env.ALIGO_API_KEY = 'k'; process.env.ALIGO_USER_ID = 'u'; process.env.ALIGO_SENDER = '0648059181';
    const app = express(); app.use(express.json());
    new Function('app', 'pool', 'authMiddleware', 'kakaoNotify', 'naverCfgGet', 'writeAudit', 'adminActor', 'process', adminOnlySrc + '\n' + handleErrSrc + '\n' + kstSrc + '\n' + region)(app, pool, authMiddleware, kakaoNotify, naverCfgGet, writeAudit, adminActor, process);
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const BASE = 'http://127.0.0.1:' + srv.address().port;
    const post = async (body, role) => { const r = await fetch(BASE + '/api/agent-office/season-waitlist/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-role': role || 'admin' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    const snap = () => JSON.stringify(rows);

    console.log('① 권한·입력');
    resetRows();
    let r = await post({ item: '제주 레몬' }, 'staff'); ok(r.status === 403, '직원 = 403', r.status);
    r = await post({ item: '제주 레몬' }, 'accountant'); ok(r.status === 403, '세무사 = 403', r.status);
    r = await post({}, 'admin'); ok(r.status === 400, '품목 없음 = 400', r.status);
    ok(sendCalls.length === 0 && audits.length === 0, '그 사이 발송 0 · audit 0');

    console.log('② dry = 쓰기 0 · 발송 0');
    const before = snap(); queries = [];
    r = await post({ item: '제주 레몬', dry: true });
    ok(r.status === 200 && r.body.dry === true, 'dry 200', JSON.stringify(r.body).slice(0, 200));
    ok(r.body.targets === 4 && r.body.sendable === 3 && r.body.bad_tel === 1 && r.body.skip_refuse === 0 && r.body.will_send === 3, '대상 4(삭제·기보낸 제외) · 보낼 수 있는 3 · bad-tel 1', JSON.stringify(r.body));
    ok(r.body.cap === 200 && r.body.cap_left === 200 && r.body.live === true, '상한 기본 200 · live', JSON.stringify(r.body));
    ok(/\[제주아꼼이네\] 신청하신 제주 레몬 시즌이 오픈했어요!/.test(r.body.message) && /064-805-9181/.test(r.body.message), '기본 문구 {item} 치환', r.body.message);
    ok(!/\p{Extended_Pictographic}/u.test(r.body.message), '문구 이모지 0');
    ok(snap() === before && sendCalls.length === 0 && audits.length === 0 && !queries.some(q => /UPDATE/.test(q)), 'dry = 행 무변경 · 발송 0 · audit 0 · UPDATE 0');

    console.log('③ 발송(sent) · 수신거부 · bad-tel · 기록');
    refusedDigits = ['01011110002']; sendCalls = []; audits = [];
    r = await post({ item: '제주 레몬' });
    ok(r.status === 200 && r.body.sent === 2 && r.body.skipped === 2 && r.body.failed === 0 && r.body.capped === 0, '보냄 2 · 안 보냄 2(수신거부 1 · bad-tel 1)', JSON.stringify(r.body));
    ok(sendCalls.length === 2 && sendCalls.map(c => c.receiver).join() === '01011110001,01011110003', 'sendLms 2회 · 수신거부·bad-tel 번호엔 0', sendCalls.map(c => c.receiver).join());
    ok(sendCalls.every(c => c.message === r.body.message && /시즌 오픈 안내/.test(c.subject)), '문구·제목 그대로');
    const r1 = rows.find(x => x.id === 1), r2 = rows.find(x => x.id === 2), r4 = rows.find(x => x.id === 4), r5 = rows.find(x => x.id === 5), r7 = rows.find(x => x.id === 7);
    ok(r1.notified === true && r1.notified_at && r1.notify_result === 'sent', '보낸 행 = notified true + notified_at + sent', JSON.stringify(r1));
    ok(r2.notified === false && r2.notified_at && r2.notify_result === 'skip-refuse', '수신거부 행 = notified_at 기록 · skip-refuse(다시 대상 안 됨)', JSON.stringify(r2));
    ok(r4.notified === false && r4.notified_at && r4.notify_result === 'bad-tel', 'bad-tel 행 기록', JSON.stringify(r4));
    ok(r5.notified === false && !r5.notified_at && !r7.notified_at, '삭제 행·다른 품목 행 무접촉');
    ok(audits.length === 1 && audits[0].source === 'season-notify' && audits[0].changes.sent === 2 && !/0101111/.test(JSON.stringify(audits[0])), 'audit 1건 · 번호 0', JSON.stringify(audits[0]).slice(0, 200));
    r = await post({ item: '제주 레몬', dry: true }); ok(r.body.targets === 0 && r.body.will_send === 0, '두 번째 = 대상 0');
    r = await post({ item: '제주 레몬' }); ok(r.status === 200 && r.body.sent === 0 && sendCalls.length === 2, '두 번째 실발송 = 0(한 번 보낸 분께 다시 안 감)');

    console.log('④ 하루 상한 · 설정 문구');
    resetRows(); refusedDigits = []; sendCalls = []; audits = []; cfgStore = { season_notify: { daily_cap: 2, template: '🍊 {item} 열렸어요! akkome.com 📞 064-805-9181' } };
    r = await post({ item: '제주 레몬', dry: true });
    ok(r.body.cap === 2 && r.body.will_send === 2 && r.body.message === '{item} 열렸어요! akkome.com ☎ 064-805-9181'.replace('{item}', '제주 레몬'), '설정 상한 2 · 설정 문구 치환 + 이모지 제거(☎ 유지)', r.body.message);
    r = await post({ item: '제주 레몬' });
    ok(r.body.sent === 2 && r.body.capped === 1 && r.body.skipped === 1 && sendCalls.length === 2, '상한 2 → 보냄 2 · 남김 1(다음 날 대상)', JSON.stringify(r.body));
    ok(rows.find(x => x.id === 3).notified_at === null && rows.find(x => x.id === 3).notify_result === null, '남긴 행은 무변경');
    r = await post({ item: '제주 레몬', dry: true }); ok(r.body.sent_today === 2 && r.body.cap_left === 0 && r.body.targets === 1 && r.body.will_send === 0, '오늘 보낸 2 → 남은 상한 0 · 대상 1');
    r = await post({ item: '제주 레몬' }); ok(r.body.sent === 0 && r.body.capped === 1 && sendCalls.length === 2, '상한 0 이면 발송 0');

    console.log('⑤ 실패 = 다시 대상 · 던짐');
    resetRows(); cfgStore = {}; sendCalls = []; sendMode = 'failed';
    r = await post({ item: '레드향' });
    ok(r.body.sent === 0 && r.body.failed === 2 && r.body.errors.length === 2 && /잔액 부족/.test(r.body.errors[0]), '실패 2 · 사유 글', JSON.stringify(r.body.errors));
    ok(rows.filter(x => x.item === '레드향').every(x => x.notified === false && x.notified_at === null && /^failed: failed/.test(x.notify_result)), '실패 행 = 집은 뒤 되돌림(notified_at NULL + failed 사유)', JSON.stringify(rows.filter(x => x.item === '레드향')));
    ok(claims.includes(7) && claims.includes(8), '보내기 전에 행 7·8 을 먼저 집음(RETURNING)', JSON.stringify(claims));
    sendMode = 'sent'; r = await post({ item: '레드향' }); ok(r.body.sent === 2 && rows.filter(x => x.item === '레드향').every(x => x.notify_result === 'sent'), '다시 클릭 = 실패 건 재발송 2');
    { resetRows(); rows.find(x => x.id === 7).notified_at = new Date(); rows.find(x => x.id === 7).notify_result = 'sending'; sendCalls = []; const rr = await post({ item: '레드향' }); ok(rr.body.sent === 1 && rr.body.taken === 0 && sendCalls.length === 1 && sendCalls[0].receiver === '01022220002', '다른 인스턴스가 집은 행(notified_at 있음)은 대상에서 빠짐 → 1건만'); }
    sendMode = 'throw'; resetRows(); r = await post({ item: '레드향' }); ok(r.status === 200 && r.body.failed === 2 && /network down/.test(r.body.errors[0]), 'sendLms 가 던져도 200 + failed 기록'); sendMode = 'sent';

    console.log('⑥ 2중 클릭 잠금 · 스위치 꺼짐');
    resetRows(); sendCalls = []; sendDelayMs = 150;
    const [p1, p2] = await Promise.all([post({ item: '제주 레몬' }), (async () => { await sleep(20); return post({ item: '제주 레몬' }); })()]);
    const st = [p1.status, p2.status].sort().join();
    ok(st === '200,409', '동시 두 번 = 200 + 409', st);
    ok(sendCalls.length === 3, '발송은 한 번 분량(3건)만', sendCalls.length);
    sendDelayMs = 0;
    r = await post({ item: '제주 레몬' }); ok(r.status === 200, '끝난 뒤엔 잠금 풀림(200)', r.status);
    resetRows(); sendCalls = []; switchOn = false; const b6 = snap();
    r = await post({ item: '제주 레몬' }); ok(r.status === 503 && snap() === b6 && sendCalls.length === 0, '스위치 꺼짐 = 503 · 쓰기 0 · 발송 0', r.status);
    r = await post({ item: '제주 레몬', dry: true }); ok(r.status === 200 && r.body.live === false, 'dry 는 live:false 로 알림'); switchOn = true;
    r = await post({ item: '없는 품목' }); ok(r.status === 200 && r.body.targets === 0 && r.body.sent === 0, '대상 0 품목 = 200 · 0');

    console.log('⑦ 글자 확인');
    ok(/SELECT id, item, contact, memo, notified, notified_at, notify_result, created_by, created_at FROM season_waitlist/.test(src), '목록 SELECT 에 notified_at·notify_result');
    ok(/ALTER TABLE season_waitlist ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP`\)/.test(src) && /ADD COLUMN IF NOT EXISTS notify_result TEXT`\)/.test(src), '새 칸 2개 ALTER');
    ok(!/season_waitlist ADD COLUMN IF NOT EXISTS (notified_at|notify_result)[^`]*DEFAULT/.test(src), '새 칸에 DEFAULT 없음(#336)');
    ok(/app\.post\('\/api\/agent-office\/season-waitlist\/notify', authMiddleware, adminOnly,/.test(region), '라우트 = authMiddleware + adminOnly');
    ok(unknownSql.length === 0, '가짜 pool 이 모르는 SQL 0', unknownSql.join(' | '));
    const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
    ok(/seasonWaitNotify\(/.test(appJs) && /seasonWaitPreview\(/.test(appJs) && /dry: true/.test(appJs) && /currentUser\?\.role === 'admin'/.test(appJs.slice(appJs.indexOf('async function renderSeasonWaitlist'), appJs.indexOf('window.deleteSeasonWait'))), 'app.js 단추 2 · dry · 관리자만');
    ok(/data-item="\$\{escapeHtml\(item\)\}" onclick="seasonWaitPreview\(this\.dataset\.item\)"/.test(appJs) && /onclick="seasonWaitNotify\(this\.dataset\.item, Number\(this\.dataset\.pending\)\)"/.test(appJs) && !/seasonWait(Preview|Notify)\('\$\{/.test(appJs), '단추 품목 글 = data-item(onclick 안 글자 인용 0 · 손님 글 JS 탈출 막음)');
    ok(/RETURNING id`, \[id, String\(result\)\.slice\(0, 200\)\]\)\)\.rowCount > 0/.test(region) && /AND notified_at IS NULL RETURNING id/.test(region), '보내기 전 행 먼저 집기(notified_at IS NULL · RETURNING)');
    ok(/if \(!confirm\(`\[\$\{item\}\] \$\{pending\}명에게 시즌 오픈 문자를 보낼까요\?/.test(appJs), '확인 창 1번 「{item} n명에게 문자」');

    srv.close();
    console.log(`\n결과 ${pass}/${pass + fail}` + (fail ? ` — 실패 ${fail}` : ''));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

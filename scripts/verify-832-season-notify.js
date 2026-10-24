// #832 검증 — 시즌 오픈 알림 발송(POST /api/agent-office/season-waitlist/notify) · 워커3
//   🔴 실DB 쓰기 0 · 실발송 0 · 실AI 0 · server.js 기동 0 — server.js 의 「#832 시즌 오픈 알림 시작~끝」 구간을 떼어 가짜 pool(메모리 행)·가짜 kakaoNotify(sendLms 기록만)·express 포트 0 으로 돈다.
//   보는 것 = 권한 403 · 품목 없음 400 · dry(대상 수·문구·쓰기 0·발송 0·audit 0) · 발송(행 기록·audit 번호 0·smsSafe 이모지 0) · 수신거부 skip · 번호 꼴 bad-tel · 하루 상한 · 실패 = 다시 대상 · 2중 클릭 409 · 스위치 꺼짐 503 · 설정 문구 {item} 치환 · 두 번째 클릭 대상 0 · 목록 SELECT 에 notified_at·notify_result
//   #834(워커3): 품목별 문구 templates(group|item|global|default) · 묶음 groups(목록 합산은 GET 라우트라 여기선 notify 쪽만) · notify items 배열 · 묶음·품목 잠금 겹침 409 · 신청 기록 없는 품목 글 400
//   #834 손질(워커2 점검): 같은 번호 두 행 = 첫 행만(dup) · items 배열에 기록 없는 글 섞이면 400 · items 표시 이름은 문구 열쇠 아님 · PUT …/template(저장·삭제·403·2,000바이트)
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
    { id: 9, item: '레몬', contact: '01033330001', notified: false, notified_at: null, notify_result: null, deleted_at: null },   // #834 묶음 「레몬」 = 제주 레몬 + 레몬
    { id: 10, item: '레몬', contact: '01033330002', notified: false, notified_at: null, notify_result: null, deleted_at: null },
]; };
const pool = { query: async (sql, params) => {
    queries.push(sql);
    const s = String(sql).replace(/\s+/g, ' ');
    if (/SELECT count\(\*\)::int AS n FROM season_waitlist WHERE notify_result = 'sent'/.test(s)) {
        const d = String(params[0]);
        const n = rows.filter(r => r.notify_result === 'sent' && r.notified_at && new Date(r.notified_at.getTime() + 9 * 3600000).toISOString().slice(0, 10) === d).length;
        return { rows: [{ n }] };
    }
    if (/SELECT id, item, contact FROM season_waitlist WHERE item = ANY\(\$1::text\[\]\) AND deleted_at IS NULL AND notified_at IS NULL AND COALESCE\(notified, false\) = false ORDER BY id/.test(s)) {   // #834 품목 글 배열
        const want = Array.isArray(params[0]) ? params[0] : [params[0]];
        return { rows: rows.filter(r => want.includes(r.item) && !r.deleted_at && !r.notified_at && !r.notified).map(r => ({ id: r.id, item: r.item, contact: r.contact })) };
    }
    if (/SELECT item FROM season_waitlist WHERE item = ANY\(\$1::text\[\]\) AND deleted_at IS NULL GROUP BY item/.test(s)) {   // #834 알려진 품목 글(신청 기록 있는 것)
        const want = Array.isArray(params[0]) ? params[0] : [params[0]];
        return { rows: [...new Set(rows.filter(r => want.includes(r.item) && !r.deleted_at).map(r => r.item))].map(item => ({ item })) };
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
const naverCfgSet = async (k, v) => { cfgStore[k] = JSON.parse(JSON.stringify(v)); };   // #834 ④ 문구 저장(가짜 · 실DB 0)
const writeAudit = async x => { audits.push(x); };
const adminActor = req => ({ id: req.user.id, name: req.user.name, position: req.user.position, role: req.user.role });
const authMiddleware = (req, res, next) => { const role = String(req.headers['x-role'] || 'admin'); req.user = { id: role === 'admin' ? 1 : 7, name: role === 'admin' ? '대표' : '직원', position: role === 'admin' ? '대표' : '사원', role }; next(); };

(async () => {
    process.env.ALIGO_API_KEY = 'k'; process.env.ALIGO_USER_ID = 'u'; process.env.ALIGO_SENDER = '01066874031';
    const app = express(); app.use(express.json());
    new Function('app', 'pool', 'authMiddleware', 'kakaoNotify', 'naverCfgGet', 'writeAudit', 'adminActor', 'process', 'naverCfgSet', adminOnlySrc + '\n' + handleErrSrc + '\n' + kstSrc + '\n' + region)(app, pool, authMiddleware, kakaoNotify, naverCfgGet, writeAudit, adminActor, process, naverCfgSet);
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const BASE = 'http://127.0.0.1:' + srv.address().port;
    const put = async (body, role) => { const r = await fetch(BASE + '/api/agent-office/season-waitlist/template', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-role': role || 'admin' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
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
    ok(/\[제주아꼼이네\] 신청하신 제주 레몬 시즌이 오픈했어요!/.test(r.body.message) && /010-6687-4031/.test(r.body.message), '기본 문구 {item} 치환', r.body.message);
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
    resetRows(); refusedDigits = []; sendCalls = []; audits = []; cfgStore = { season_notify: { daily_cap: 2, template: '🍊 {item} 열렸어요! akkome.com 📞 010-6687-4031' } };
    r = await post({ item: '제주 레몬', dry: true });
    ok(r.body.cap === 2 && r.body.will_send === 2 && r.body.message === '{item} 열렸어요! akkome.com ☎ 010-6687-4031'.replace('{item}', '제주 레몬'), '설정 상한 2 · 설정 문구 치환 + 이모지 제거(☎ 유지)', r.body.message);
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
    r = await post({ item: '없는 품목' }); ok(r.status === 400 && sendCalls.length === 0, '신청 기록 없는 품목 글 = 400(#834 · 종전 200·0)', r.status);
    resetRows(); rows.forEach(x => { if (x.item === '레드향') { x.notified = true; x.notified_at = new Date(); x.notify_result = 'sent'; } });
    r = await post({ item: '레드향' }); ok(r.status === 200 && r.body.targets === 0 && r.body.sent === 0, '기록은 있는데 미발송 0 = 200 · 0(종전 그대로)', r.status);

    console.log('⑧ #834 품목별 문구 · 묶음 · items 배열');
    resetRows(); refusedDigits = []; sendCalls = []; audits = []; switchOn = true; sendMode = 'sent';
    cfgStore = { season_notify: { template: '공통 {item} 열림', templates: { '제주 레몬': '레몬전용 {item} 문구', '레몬': '묶음 {item} 열림', '빈값': '   ' }, groups: { '레몬': ['제주 레몬', '레몬', ' 레몬 ', ''], '빈묶음': ['없는 것'], '': ['x'], '배열 아님': 'x' } } };
    r = await post({ item: '제주 레몬', dry: true });
    ok(r.status === 200 && r.body.template_source === 'item' && r.body.message === '레몬전용 제주 레몬 문구' && r.body.group === null && r.body.items.join() === '제주 레몬', '품목별 문구(templates[품목]) · source item', JSON.stringify(r.body).slice(0, 200));
    r = await post({ item: '레드향', dry: true });
    ok(r.status === 200 && r.body.template_source === 'global' && r.body.message === '공통 레드향 열림', '품목별 없음 → 공통 문구 · source global', JSON.stringify(r.body).slice(0, 160));
    cfgStore = { season_notify: { templates: { '빈값': ' ' } } };
    r = await post({ item: '레드향', dry: true });
    ok(r.status === 200 && r.body.template_source === 'default' && /\[제주아꼼이네\] 신청하신 레드향 시즌이 오픈했어요!/.test(r.body.message), '공통도 없음 → 기본 문구 · source default', JSON.stringify(r.body).slice(0, 160));
    cfgStore = { season_notify: { template: '공통 {item} 열림', templates: { '제주 레몬': '레몬전용 {item} 문구', '레몬': '묶음 {item} 열림' }, groups: { '레몬': ['제주 레몬', '레몬', ' 레몬 ', ''], '빈묶음': ['없는 것'], '': ['x'], '배열 아님': 'x' } } };
    r = await post({ item: '레몬', dry: true });
    ok(r.status === 200 && r.body.group === '레몬' && r.body.items.join() === '제주 레몬,레몬' && r.body.targets === 6 && r.body.sendable === 5 && r.body.bad_tel === 1 && r.body.will_send === 5, '묶음 「레몬」 dry = 두 품목 합산(대상 6 · 보낼 5 · bad-tel 1)', JSON.stringify(r.body).slice(0, 260));
    ok(r.body.template_source === 'group' && r.body.message === '묶음 레몬 열림' && r.body.messages.length === 1, '묶음 문구(templates[묶음 이름]) 우선 · 문구 1종', JSON.stringify(r.body.messages));
    r = await post({ item: '빈묶음', dry: true }); ok(r.status === 200 && r.body.group === '빈묶음' && r.body.targets === 0, '설정 묶음인데 신청 0 = 200 · 0(400 아님)', r.status);
    cfgStore = { season_notify: { template: '공통 {item} 열림', templates: { '제주 레몬': '레몬전용 {item} 문구' }, groups: { '레몬': ['제주 레몬', '레몬'] } } };
    r = await post({ item: '레몬', dry: true });
    ok(r.body.template_source === 'item' && r.body.messages.length === 2 && r.body.messages.map(m => m.template_source).join() === 'item,global' && r.body.messages[1].message === '공통 레몬 열림', '묶음 문구 없으면 품목마다(제주 레몬 = 품목별 · 레몬 = 공통)', JSON.stringify(r.body.messages));
    r = await post({ item: '레몬' });
    ok(r.status === 200 && r.body.sent === 5 && r.body.skipped === 1 && r.body.failed === 0 && sendCalls.length === 5, '묶음 발송 = 보냄 5 · 안 보냄 1', JSON.stringify(r.body).slice(0, 200));
    ok(sendCalls.filter(c => /^0101111/.test(c.receiver)).every(c => c.message === '레몬전용 제주 레몬 문구') && sendCalls.filter(c => /^0103333/.test(c.receiver)).every(c => c.message === '공통 레몬 열림'), '행마다 그 품목 글의 문구로 발송', JSON.stringify(sendCalls.map(c => c.receiver + ':' + c.message)));
    ok(rows.filter(x => x.item === '레몬').every(x => x.notify_result === 'sent') && rows.find(x => x.id === 4).notify_result === 'bad-tel', '묶음 안 두 품목 행 전부 기록');
    ok(audits.length === 1 && audits[0].changes.group === '레몬' && audits[0].changes.items.join() === '제주 레몬,레몬' && audits[0].changes.template_source === 'item' && !/0101111|0103333/.test(JSON.stringify(audits[0])), 'audit 에 묶음·품목 글·문구 출처 · 번호 0', JSON.stringify(audits[0].changes).slice(0, 200));
    // items 배열
    resetRows(); sendCalls = []; audits = []; cfgStore = {};
    r = await post({ item: '레몬 전체', items: ['제주 레몬', '레몬', '레몬'], dry: true });
    ok(r.status === 200 && r.body.item === '레몬 전체' && r.body.group === '레몬 전체' && r.body.items.join() === '제주 레몬,레몬' && r.body.targets === 6 && /신청하신 레몬 전체 시즌/.test(r.body.message), 'items 배열(중복 제거) · item 은 표시 이름 · 기본 문구 {item} = 표시 이름', JSON.stringify(r.body).slice(0, 220));
    r = await post({ items: ['레드향'], dry: true }); ok(r.status === 200 && r.body.item === '레드향' && r.body.targets === 2, 'items 만(item 없음) = 표시 이름 자동', JSON.stringify(r.body).slice(0, 120));
    r = await post({ items: ['제주 레몬', '레몬'] }); ok(r.status === 200 && r.body.sent === 5 && sendCalls.length === 5, 'items 배열 실발송 = 두 품목 합 5', JSON.stringify(r.body).slice(0, 120));
    for (const bad of [{ items: [] }, { items: 'x' }, { items: [1] }, { items: [' '] }, { items: Array.from({ length: 31 }, (_, i) => 'p' + i) }]) { r = await post({ ...bad, dry: true }); ok(r.status === 400, 'items 꼴 틀림 = 400: ' + JSON.stringify(bad).slice(0, 40), r.status); }
    r = await post({ items: ['없는 것', '또 없는 것'], dry: true }); ok(r.status === 400, 'items 전부 신청 기록 없음 = 400', r.status);
    // 잠금 겹침(묶음 ↔ 그 안 품목)
    resetRows(); sendCalls = []; sendDelayMs = 150; cfgStore = { season_notify: { groups: { '레몬': ['제주 레몬', '레몬'] } } };
    { const [g1, s1, o1] = await Promise.all([post({ item: '레몬' }), (async () => { await sleep(20); return post({ item: '레몬' }); })(), (async () => { await sleep(20); return post({ item: '제주 레몬' }); })()]);
      ok(g1.status === 200 && s1.status === 409 && o1.status === 409, '묶음 발송 중 = 같은 묶음 409 · 그 안 품목 단건도 409', [g1.status, s1.status, o1.status].join());
      const o2 = await post({ item: '레드향', dry: true }); ok(o2.status === 200, '다른 품목 dry 는 영향 없음', o2.status); }
    resetRows(); sendCalls = [];
    { const [i1, g2] = await Promise.all([post({ item: '제주 레몬' }), (async () => { await sleep(20); return post({ item: '레몬' }); })()]);
      ok(i1.status === 200 && g2.status === 409, '품목 단건 발송 중 = 그 품목 든 묶음 409', [i1.status, g2.status].join()); }
    sendDelayMs = 0; r = await post({ item: '레몬' }); ok(r.status === 200, '끝난 뒤 묶음 잠금 풀림', r.status);
    cfgStore = {};

    console.log('⑨ #834 손질 — 같은 번호 dup · items 섞인 400 · 표시 이름 ≠ 문구 열쇠 · PUT 문구 저장');
    resetRows(); sendCalls = []; audits = []; refusedDigits = []; cfgStore = { season_notify: { groups: { '레몬': ['제주 레몬', '레몬'] } } };
    rows.push({ id: 11, item: '레몬', contact: '01011110001', notified: false, notified_at: null, notify_result: null, deleted_at: null });   // 행 1 과 같은 번호 · 다른 품목
    r = await post({ item: '레몬', dry: true });
    ok(r.status === 200 && r.body.targets === 7 && r.body.dup === 1 && r.body.sendable === 5 && r.body.bad_tel === 1 && r.body.will_send === 5, 'dry = 같은 번호 1 (대상 7 · 보낼 5 · bad-tel 1)', JSON.stringify(r.body).slice(0, 220));
    r = await post({ item: '레몬' });
    ok(r.status === 200 && r.body.sent === 5 && r.body.skipped === 2 && r.body.dup === 1 && sendCalls.length === 5 && new Set(sendCalls.map(c => c.receiver)).size === 5, '발송 = 번호 5개에 한 번씩(같은 번호 두 번째 행은 문자 0)', JSON.stringify(r.body).slice(0, 200));
    { const r11 = rows.find(x => x.id === 11), r1 = rows.find(x => x.id === 1); ok(r11.notify_result === 'dup' && r11.notified_at && r11.notified === false && r1.notify_result === 'sent', '두 번째 행 = dup 기록(다시 대상 안 됨) · 첫 행 = sent', JSON.stringify([r1, r11])); }
    r = await post({ item: '레몬', dry: true }); ok(r.body.targets === 0, 'dup 행도 다음 dry 대상 아님');
    resetRows(); rows.push({ id: 11, item: '레몬', contact: '01011110001', notified: false, notified_at: null, notify_result: null, deleted_at: null });
    r = await post({ item: '제주 레몬', dry: true }); ok(r.body.dup === 0 && r.body.targets === 4, '품목 하나만 보낼 땐 다른 품목의 같은 번호는 무관(dup 0)', JSON.stringify(r.body).slice(0, 120));
    // items 배열에 기록 없는 글 섞임
    resetRows(); cfgStore = {};
    r = await post({ items: ['제주 레몬', '없는 것'], dry: true }); ok(r.status === 400 && Array.isArray(r.body.unknown) && r.body.unknown.join() === '없는 것', 'items 에 기록 없는 글 섞임 = 400 + unknown 목록', JSON.stringify(r.body).slice(0, 160));
    r = await post({ items: ['제주 레몬', '레몬'], dry: true }); ok(r.status === 200 && r.body.targets === 6, '전부 기록 있는 items = 200');
    // 표시 이름이 templates 열쇠와 같아도 묶음 문구 아님
    cfgStore = { season_notify: { template: '공통 {item}', templates: { '레몬 전체': '열쇠 충돌 {item}' } } };
    r = await post({ item: '레몬 전체', items: ['레드향'], dry: true });
    ok(r.status === 200 && r.body.template_source === 'global' && r.body.message === '공통 레몬 전체' && r.body.group === '레몬 전체', 'items 표시 이름 = {item} 치환에만 · templates[표시 이름] 은 안 씀(설정 묶음일 때만 묶음 문구)', JSON.stringify(r.body).slice(0, 160));
    cfgStore = { season_notify: { template: '공통 {item}', templates: { '레몬': '묶음 {item}' }, groups: { '레몬': ['제주 레몬', '레몬'] } } };
    r = await post({ item: '레몬', dry: true }); ok(r.body.template_source === 'group' && r.body.template_raw === '묶음 {item}' && r.body.message === '묶음 레몬', '설정 묶음이면 묶음 문구 · template_raw 는 {item} 그대로', JSON.stringify(r.body).slice(0, 120));
    // PUT 문구 저장
    cfgStore = { season_notify: { daily_cap: 7, groups: { '레몬': ['제주 레몬', '레몬'] } } }; audits = [];
    r = await put({ item: '레드향', text: '🍊 {item} 열림 📞 010-6687-4031' }, 'staff'); ok(r.status === 403 && !(cfgStore.season_notify.templates || {})['레드향'], '직원 PUT = 403 · 저장 0', r.status);
    r = await put({ item: '레드향', text: '🍊 {item} 열림 📞 010-6687-4031' });
    ok(r.status === 200 && r.body.text === '{item} 열림 ☎ 010-6687-4031' && r.body.deleted === false && cfgStore.season_notify.templates['레드향'] === '{item} 열림 ☎ 010-6687-4031', '관리자 PUT = 저장(이모지 삭제 · {item} 그대로)', JSON.stringify(r.body));
    ok(cfgStore.season_notify.daily_cap === 7 && cfgStore.season_notify.groups['레몬'].length === 2, '다른 설정 칸(daily_cap·groups) 그대로');
    r = await post({ item: '레드향', dry: true }); ok(r.body.template_source === 'item' && r.body.message === '레드향 열림 ☎ 010-6687-4031' && r.body.template_raw === '{item} 열림 ☎ 010-6687-4031', '저장 뒤 dry = 그 문구(source item)', JSON.stringify(r.body).slice(0, 160));
    ok(audits.length === 1 && audits[0].action === 'season_notify_template' && audits[0].changes.key === '레드향' && audits[0].changes.before === null && audits[0].changes.after === '{item} 열림 ☎ 010-6687-4031', 'audit 문구 전/후', JSON.stringify(audits[0]).slice(0, 200));
    r = await put({ group: '레몬', text: '묶음용 {item} 문구' }); ok(r.status === 200 && cfgStore.season_notify.templates['레몬'] === '묶음용 {item} 문구', 'group 열쇠 저장');
    r = await post({ item: '레몬', dry: true }); ok(r.body.template_source === 'group' && r.body.message === '묶음용 레몬 문구', '묶음 dry = 저장한 묶음 문구');
    r = await put({ item: '레드향', text: '   ' }); ok(r.status === 200 && r.body.deleted === true && !('레드향' in cfgStore.season_notify.templates) && cfgStore.season_notify.templates['레몬'], '빈칸 PUT = 그 열쇠만 삭제', JSON.stringify(cfgStore.season_notify.templates));
    r = await post({ item: '레드향', dry: true }); ok(r.body.template_source === 'default', '삭제 뒤 = 기본 문구');
    r = await put({ item: '레드향', text: '가'.repeat(700) }); ok(r.status === 400 && r.body.bytes === 2100 && !('레드향' in cfgStore.season_notify.templates), '2,000바이트 초과 = 400 · 저장 0', JSON.stringify(r.body).slice(0, 120));
    r = await put({ item: '레드향', text: '가'.repeat(666) }); ok(r.status === 200 && r.body.bytes === 1998, '1,998바이트 = 저장');
    r = await put({ text: 'x' }); ok(r.status === 400, '열쇠 없음 = 400', r.status);
    r = await put({ item: '레드향', text: 123 }); ok(r.status === 400, '문구가 글 아님 = 400', r.status);
    r = await put({ item: '레드향', text: '🍊🍊 🎉' }); ok(r.status === 400 && /이모지만/.test(r.body.error) && cfgStore.season_notify.templates['레드향'] === '가'.repeat(666), '이모지만 = 400(삭제 아님 · 종전 문구 유지 · #834 손질 ②)', JSON.stringify(r.body).slice(0, 120));
    r = await put({ item: '레드향', text: '  \n ' }); ok(r.status === 200 && r.body.deleted === true, '공백만 = 삭제(원문 trim 비었을 때만)', r.status);
    cfgStore = {};

    console.log('⑦ 글자 확인');
    ok(/SELECT id, item, contact, memo, notified, notified_at, notify_result, created_by, created_at FROM season_waitlist/.test(src), '목록 SELECT 에 notified_at·notify_result');
    ok(/ALTER TABLE season_waitlist ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP`\)/.test(src) && /ADD COLUMN IF NOT EXISTS notify_result TEXT`\)/.test(src), '새 칸 2개 ALTER');
    ok(!/season_waitlist ADD COLUMN IF NOT EXISTS (notified_at|notify_result)[^`]*DEFAULT/.test(src), '새 칸에 DEFAULT 없음(#336)');
    ok(/app\.post\('\/api\/agent-office\/season-waitlist\/notify', authMiddleware, adminOnly,/.test(region), '라우트 = authMiddleware + adminOnly');
    ok(unknownSql.length === 0, '가짜 pool 이 모르는 SQL 0', unknownSql.join(' | '));
    const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
    ok(/seasonWaitNotify\(/.test(appJs) && /seasonWaitPreview\(/.test(appJs) && /dry: true/.test(appJs) && /currentUser\?\.role === 'admin'/.test(appJs.slice(appJs.indexOf('async function renderSeasonWaitlist'), appJs.indexOf('window.deleteSeasonWait'))), 'app.js 단추 2 · dry · 관리자만');
    ok(/data-item="\$\{escapeHtml\(key\)\}" onclick="seasonWaitPreview\(this\.dataset\.item\)"/.test(appJs) &&/onclick="seasonWaitNotify\(this\.dataset\.item, Number\(this\.dataset\.pending\)\)"/.test(appJs) && !/seasonWait(Preview|Notify)\('\$\{/.test(appJs), '단추 품목 글 = data-item(onclick 안 글자 인용 0 · 손님 글 JS 탈출 막음)');
    ok(/RETURNING id`, \[id, String\(result\)\.slice\(0, 200\)\]\)\)\.rowCount > 0/.test(region) && /AND notified_at IS NULL RETURNING id/.test(region), '보내기 전 행 먼저 집기(notified_at IS NULL · RETURNING)');
    ok(/if \(!confirm\(`\[\$\{item\}\] \$\{pending\}명에게 시즌 오픈 문자를 보낼까요\?/.test(appJs), '확인 창 1번 「{item} n명에게 문자」');
    const swSrc = appJs.slice(appJs.indexOf('async function renderSeasonWaitlist'), appJs.indexOf('window.deleteSeasonWait'));
    ok(/Array\.isArray\(d\.groups\)/.test(swSrc) && /groupedItems/.test(swSrc) && /withItem \? '<th>품목<\/th>' : ''/.test(swSrc) && /sub: '묶음: ' \+ g\.items\.join\(' · '\)/.test(swSrc), '#834 화면 = 서버 groups 있으면 묶음 줄(품목 글 나열 · 표에 품목 칸) · 없으면 종전');
    ok(/r\.template_source/.test(swSrc) && /r\.messages/.test(swSrc) && /묶음 품목: /.test(swSrc), '#834 미리보기 = 문구 출처 + 묶음이면 품목별 문구 전문');
    ok(/sw-tpl-text/.test(swSrc) && /'\/api\/agent-office\/season-waitlist\/template', 'PUT'/.test(swSrc) && /r\.template_raw/.test(swSrc) && /canEdit = currentUser\?\.role === 'admin' && typeof r\.template_source === 'string'/.test(swSrc) && /이모지는 자동 삭제 · \{item\} = 품목 이름/.test(swSrc), '#834 ④ 미리보기 창 = 문구 textarea + PUT 저장(관리자 · 옛 서버면 숨김) + 안내 한 줄');
    ok(/notify_result === 'dup'/.test(swSrc) && /같은 번호 · 안 보냄/.test(swSrc) && /x\.notify_result === 'dup'/.test(src), '#834 dup = 화면 pill·집계 + 서버 GET 통계');
    ok(/<th>연락처<\/th>\$\{withItem \? '<th>품목<\/th>' : ''\}/.test(swSrc) && (appJs.match(/\/\/ #832 \[미리보기\]/g) || []).length === 1, '#834 ③ 품목 칸은 연락처 뒤 · 중복 주석 0');
    ok(/app\.put\('\/api\/agent-office\/season-waitlist\/template', authMiddleware, adminOnly,/.test(region) && /SEASON_NOTIFY_TEMPLATE_MAX_BYTES = 2000/.test(region), '#834 ④ PUT 라우트 = authMiddleware + adminOnly · 2,000바이트');
    ok(/SELECT id, item, contact FROM season_waitlist WHERE item = ANY\(\$1::text\[\]\)/.test(region) && /rows: r\.rows, groups, grouped_items/.test(src) && /function seasonNotifyGroups\(cfg\)/.test(region) && /function seasonNotifyPick\(cfg, item, groupName, displayName\)/.test(region), '#834 서버 = 배열 SELECT · 목록 GET groups · 묶음·문구 함수');

    srv.close();
    console.log(`\n결과 ${pass}/${pass + fail}` + (fail ? ` — 실패 ${fail}` : ''));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #775 검증 — 감귤체험 예약 관리(experience.js) · 실DB·네이버·메일·알리고 호출 0(전부 가짜)
//   ① 판독(시각·스토어 옵션·플레이스 메일·MIME) ② IMAP 읽기 전용 클라이언트(가짜 소켓 · 쓰기 명령 0 · 리터럴) ③ 스토어 수집(묶음·인원·날짜·취소/반품·직원 고친 날짜 보존)
//   ④ 메일 수집(꼴 앎/모름 · 이미 읽음) ⑤ 손님 문자(꺼짐 · 상한 · 수신거부 · 발신번호 · 날짜 확인 필요는 안 보냄) ⑥ 화면 API(고치기·방문·설정 검사) ⑦ 챙길 일 줄
//   실행: node scripts/verify-775-booking.js
'use strict';
const path = require('path'), { PassThrough } = require('stream');
const mount = require(path.join(__dirname, '..', 'experience.js'));
const T = mount._t;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${name}${extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}`); };
const kstDay = (o = 0) => new Date(Date.now() + 9 * 3600 * 1000 + o * 86400000).toISOString().slice(0, 10);

// ── 가짜 pool(이 모듈이 쓰는 SQL 만 흉내) ─────────────────────────────────
function fakeDb() {
    const S = { rows: [], seen: new Set(), cfg: {}, kakaoExp: [], refuse: new Set(), sql: [], nextId: 1 };
    const byKey = k => S.rows.find(r => r.ext_key === k), byId = id => S.rows.find(r => r.id === id);
    const query = async (sql, a = []) => {
        const s = String(sql).replace(/\s+/g, ' ').trim(); S.sql.push(s);
        if (/^CREATE /.test(s)) return { rows: [] };
        if (/^SELECT value FROM agent_office_config WHERE key=\$1/.test(s)) return { rows: a[0] in S.cfg ? [{ value: S.cfg[a[0]] }] : [] };
        if (/^INSERT INTO agent_office_config/.test(s)) { S.cfg[a[0]] = JSON.parse(a[1]); return { rows: [] }; }
        if (/^DELETE FROM agent_office_config/.test(s)) { delete S.cfg.experience_mail_probe_request; return { rows: [] }; }
        const due30 = r => !r.confirm_at || Date.now() - r.confirm_at > 30 * 60000;   // 마지막 시도 30분 지남
        const dueD = r => !r.dispatch_at || Date.now() - r.dispatch_at > 30 * 60000;
        if (/jsonb_object_keys\(items\).*confirm_state='pending'/.test(s)) return { rows: S.rows.filter(r => r.source === 'store' && ((r.confirm_state === 'pending' && (r.confirm_tries || 0) < 3 && due30(r)) || (r.confirm_state === 'done' && (r.dispatch_tries || 0) < 3 && dueD(r)) || (!r.confirm_state && r.status === 'confirmed'))).flatMap(r => Object.keys(r.items || {})).map(k => ({ k })) };
        if (/^SELECT confirm_state, dispatch_tries, \(dispatch_at IS NULL/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ confirm_state: r.confirm_state || null, dispatch_tries: r.dispatch_tries || 0, due: dueD(r) }] : [] }; }
        if (/^UPDATE experience_bookings SET confirm_state='dispatched'/.test(s)) { const r = byId(a[0]); r.confirm_state = 'dispatched'; r.dispatch_error = null; r.dispatch_at = r.dispatch_at || Date.now(); return { rows: [] }; }
        if (/^UPDATE experience_bookings SET confirm_state=\$2, dispatch_tries=\$3, dispatch_error=\$4, dispatch_at=NOW\(\)/.test(s)) { const r = byId(a[0]); r.confirm_state = a[1]; r.dispatch_tries = a[2]; r.dispatch_error = a[3]; r.dispatch_at = Date.now(); return { rows: [] }; }
        if (/^SELECT confirm_state, confirm_tries, \(confirm_at IS NULL/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ confirm_state: r.confirm_state || null, confirm_tries: r.confirm_tries || 0, due: due30(r) }] : [] }; }
        if (/^UPDATE experience_bookings SET confirm_state='done'/.test(s)) { const r = byId(a[0]); r.confirm_state = 'done'; r.confirm_error = null; r.confirm_at = r.confirm_at || Date.now(); return { rows: [] }; }
        if (/^UPDATE experience_bookings SET confirm_state='skipped_claim'/.test(s)) { const r = byId(a[0]); r.confirm_state = 'skipped_claim'; r.confirm_error = a[1]; return { rows: [] }; }
        if (/^UPDATE experience_bookings SET confirm_state=\$2, confirm_tries=\$3, confirm_error=\$4, confirm_at=NOW\(\)/.test(s)) { const r = byId(a[0]); r.confirm_state = a[1]; r.confirm_tries = a[2]; r.confirm_error = a[3]; r.confirm_at = Date.now(); return { rows: [] }; }
        if (/jsonb_object_keys\(items\)/.test(s)) return { rows: S.rows.filter(r => r.source === 'store').flatMap(r => Object.keys(r.items || {})).filter(k => a[0].includes(k)).map(k => ({ k })) };
        if (/FROM kakao_notify_log k WHERE k.status='experience'/.test(s)) return { rows: S.kakaoExp.filter(k => !S.rows.some(r => r.source === 'store' && r.items && k in r.items)).map(order_key => ({ order_key })) };
        if (/^SELECT \* FROM experience_bookings WHERE ext_key=\$1/.test(s)) { const r = byKey(a[0]); return { rows: r ? [JSON.parse(JSON.stringify(r))] : [] }; }
        if (/^SELECT date_ok FROM experience_bookings WHERE id=\$1/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ date_ok: r.date_ok }] : [] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, amount, status, option_text, items, ordered_at\)/.test(s)) {
            if (byKey(a[0])) return { rows: [] };
            const r = { id: S.nextId++, source: 'store', ext_key: a[0], order_no: a[1], name: a[2], phone: a[3], visit_date: a[4], visit_time: a[5], date_ok: a[6], date_why: a[7], exp_count: a[8], entry_count: a[9], infant_count: 0, amount: a[10], status: a[11], option_text: a[12], items: JSON.parse(a[13]), date_fixed: false, sms_recv_at: null, sms_eve_at: null };
            S.rows.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET name=\$2, phone=\$3, visit_date=\$4/.test(s)) { const r = byId(a[0]); Object.assign(r, { name: a[1], phone: a[2], visit_date: a[3], visit_time: a[4], date_ok: a[5], date_why: a[6], exp_count: a[7], entry_count: a[8], amount: a[9], status: a[10], option_text: a[11], items: JSON.parse(a[12]) }); return { rows: [] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, status, date_ok, date_why, raw\) VALUES \('place'/.test(s)) { if (byKey(a[0])) return { rows: [] }; const r = { id: S.nextId++, source: 'place', ext_key: a[0], status: 'unknown', date_ok: false, raw: a[1] }; S.rows.push(r); return { rows: [{ id: r.id }] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, infant_count, amount, status, raw\)/.test(s)) {
            if (byKey(a[0])) return { rows: [] };
            const r = { id: S.nextId++, source: 'place', ext_key: a[0], order_no: a[1], name: a[2], phone: a[3], visit_date: a[4], visit_time: a[5], date_ok: a[6], date_why: a[7], exp_count: a[8], entry_count: a[9], infant_count: a[10], amount: a[11], status: a[12], raw: a[13], date_fixed: false };
            S.rows.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET status=\$2, name=CASE WHEN contact_at IS NOT NULL THEN name ELSE COALESCE\(\$3,name\) END, phone=CASE WHEN contact_at IS NOT NULL THEN phone ELSE COALESCE\(\$4,phone\) END/.test(s)) {   // #804 사람이 넣은 이름·번호는 메일이 안 덮음
            const r = byId(a[0]); Object.assign(r, { status: a[1], visit_date: a[4], visit_time: a[5], date_ok: a[6] }); if (!r.contact_at) { if (a[2] != null) r.name = a[2]; if (a[3] != null) r.phone = a[3]; } return { rows: [] }; }
        if (/^SELECT 1 FROM experience_mail_seen/.test(s)) return { rows: S.seen.has(a[0]) ? [{}] : [] };
        if (/^INSERT INTO experience_mail_seen/.test(s)) { S.seen.add(a[0]); return { rows: [] }; }
        // 오늘 보낸 것 = 실제로 보낸 칸(sms_recv_at · sms_eve_at)만 — 'now' 또는 S.sentToday(미리 쓴 수)
        if (/sms_recv_at \+ interval '9 hours'/.test(s)) return { rows: [{ n: (S.sentToday || 0) + S.rows.filter(r => r.sms_recv_at === 'now').length + S.rows.filter(r => r.sms_eve_at === 'now').length }] };
        const fresh = (t) => !t || Date.now() - t > 30 * 60000;   // 30분 넘은 잡기
        if (/^SELECT \* FROM experience_bookings WHERE \(source='store' OR \(source IN \('place','manual'\) AND contact_at IS NOT NULL\)\) AND status='confirmed'/.test(s)) {   // #804 사람이 번호를 넣은 플레이스 건도 · #808 수기도
            const base = S.rows.filter(r => (r.source === 'store' || ((r.source === 'place' || r.source === 'manual') && r.contact_at)) && r.status === 'confirmed' && r.date_ok && r.phone && r.phone.length >= 10 && r.visit_date >= a[0] && !r.sms_skip);
            return { rows: /sms_recv_at IS NULL/.test(s) ? base.filter(r => !r.sms_recv_at && (r.sms_recv_tries || 0) < 3 && fresh(r.sms_recv_try_at)).map(r => ({ ...r }))
                : base.filter(r => r.visit_date === a[1] && !r.sms_eve_at && (r.sms_eve_tries || 0) < 3 && fresh(r.sms_eve_try_at) && (r.sms_recv_at || (r.sms_recv_tries || 0) >= 3)).map(r => ({ ...r })) };
        }
        if (/^SELECT 1 FROM sms_messages m JOIN sms_threads t/.test(s)) return { rows: S.refuse.has(a[0]) ? [{}] : [] };
        if (/^UPDATE experience_bookings SET sms_(recv|eve)_try_at=NOW\(\)/.test(s)) {   // 잡기 — 조건이 맞을 때만 RETURNING
            const k = /sms_recv_try_at/.test(s) ? 'recv' : 'eve', r = byId(a[0]);
            if (!r || r['sms_' + k + '_at'] || r.sms_skip || !fresh(r['sms_' + k + '_try_at']) || (r['sms_' + k + '_tries'] || 0) >= 3) return { rows: [] };
            r['sms_' + k + '_try_at'] = Date.now(); r['sms_' + k + '_tries'] = (r['sms_' + k + '_tries'] || 0) + 1; S.claims = (S.claims || 0) + 1; return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET sms_skip='refused'/.test(s)) { const r = byId(a[0]); r.sms_skip = 'refused'; r.sms_error = a[1]; return { rows: [] }; }
        if (/^UPDATE experience_bookings SET sms_(recv|eve)_at=NOW\(\)/.test(s)) { const r = byId(a[0]); const col = /sms_recv_at/.test(s) ? 'sms_recv_at' : 'sms_eve_at'; r[col] = 'now'; r.sms_error = null; const vm = /(sms_(?:recv|eve)_via)=\$2/.exec(s); if (vm) r[vm[1]] = a[1]; return { rows: [] }; }   // #808 나간 길(via)
        if (/^INSERT INTO experience_bookings \(source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_fixed, exp_count, entry_count, infant_count, amount, status, memo, contact_at, contact_by, ordered_at\) VALUES \('manual'/.test(s)) {   // #808 수기
            const r = { id: S.nextId++, source: 'manual', ext_key: a[0], order_no: null, name: a[1], phone: a[2], visit_date: a[3], visit_time: a[4], date_ok: true, date_fixed: true, exp_count: a[5], entry_count: a[6], infant_count: a[7], amount: a[8], status: 'confirmed', memo: a[9], contact_at: Date.now(), contact_by: a[10], sms_recv_tries: 0, sms_eve_tries: 0 };
            S.rows.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET ext_key=\$2, order_no=\$3 WHERE id=\$1/.test(s)) { if (S.failExtKey) throw new Error('가짜 실패'); const r = byId(a[0]); r.ext_key = a[1]; r.order_no = a[2]; return { rows: [] }; }
        if (/^DELETE FROM experience_bookings WHERE id=\$1 AND source='manual' AND ext_key LIKE 'manual:new-%'/.test(s)) { const i = S.rows.findIndex(r => r.id === a[0] && r.source === 'manual' && /^manual:new-/.test(r.ext_key)); if (i >= 0) S.rows.splice(i, 1); S.deleted = (S.deleted || 0) + 1; return { rows: [] }; }
        if (/^UPDATE experience_bookings SET sms_error=\$2/.test(s)) { byId(a[0]).sms_error = a[1]; return { rows: [] }; }
        if (/COUNT\(\*\) FILTER \(WHERE visit_date = \$1::date AND status IN/.test(s)) {
            const live = S.rows; const t = a[0], tm = a[1];
            return { rows: [{ today: live.filter(r => r.visit_date === t && ['confirmed', 'visited'].includes(r.status)).length, tomorrow: live.filter(r => r.visit_date === tm && r.status === 'confirmed').length, today_people: 0, tomorrow_people: 0, need_check: live.filter(r => ['confirmed', 'unknown'].includes(r.status) && !r.date_ok && (!r.visit_date || r.visit_date >= t)).length }] };
        }
        if (/^SELECT id, to_char\(visit_date/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ ...r }] : [] }; }
        if (/^SELECT \*, to_char\(visit_date,'YYYY-MM-DD'\) AS visit_date FROM experience_bookings WHERE id=\$1/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ ...r }] : [] }; }   // #804 즉시 발송·미리보기
        if (/^UPDATE experience_bookings SET .* WHERE id=\$1$/.test(s) && !/sms_/.test(s.split('WHERE')[0].slice(0, 30))) {
            S.lastPatch = { sql: s, args: a };
            if (/contact_at=NOW\(\)/.test(s)) {   // #804 이름·번호 고침은 가짜 줄에도 반영(즉시 발송 시험용 · 그 밖 고치기는 종전처럼 기록만)
                const r = byId(a[0]); const set = s.slice('UPDATE experience_bookings SET '.length, s.lastIndexOf(' WHERE id=$1'));
                for (const m of set.matchAll(/(\w+)=\$(\d+)/g)) r[m[1]] = a[Number(m[2]) - 1];
                r.contact_at = Date.now();
            }
            return { rows: [] };
        }
        if (/^UPDATE experience_bookings SET status = CASE WHEN \$2/.test(s)) { const r = byId(a[0]); if (!r || !['confirmed', 'visited'].includes(r.status)) return { rows: [] }; r.status = a[1] ? 'visited' : 'confirmed'; return { rows: [{ id: r.id }] }; }
        if (/^SELECT id, source, order_no/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ ...r }] : [] }; }
        throw new Error('가짜 pool 이 모르는 SQL: ' + s.slice(0, 140));
    };
    return { S, pool: { query } };
}
function fakeApp() { const routes = {}; const add = m => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; }; return { routes, get: add('GET'), put: add('PUT'), patch: add('PATCH'), post: add('POST') }; }
const passMw = (q, r, n) => n && n();
function mk(extra) {
    const db = fakeDb(), app = fakeApp(), sent = [], tg = [], audits = [];
    const deps = Object.assign({
        pool: db.pool, authMiddleware: passMw, adminOnly: passMw, writeAudit: x => { audits.push(x); }, skipInit: true, noTimers: true,
        naverCfgGet: async k => db.S.cfg[k] || null, naverCfgSet: async (k, v) => { db.S.cfg[k] = v; }, naverKstIso: ms => new Date(ms).toISOString(),
        naverFetchChanges: async () => db.S.changes || [], naverCall: async (req) => { if (/\/dispatch$/.test(req.path)) { (db.S.dispatchCalls = db.S.dispatchCalls || []).push(req.body); const ids = req.body.dispatchProductOrders.map(x => x.productOrderId); return db.S.dispatchReply ? db.S.dispatchReply(ids) : { data: { data: { successProductOrderIds: ids, failProductOrderInfos: [] } } }; } return { data: { data: (db.S.detail || []).filter(it => req.body.productOrderIds.includes(it.productOrder.productOrderId)) } }; },
        experienceProductIds: async () => ['7673020911'], isExperienceOrder: (po, ids) => ids.includes(String(po.productId || '')),
        resolveReceiver: async t => t, isMaskedTel: t => t === '__MASKED__',
        kakaoNotify: { sendLms: async o => { sent.push(o); return { mode: 'real', status: 'sent' }; }, sendAlimtalk: async o => { sent.push({ ...o, alim: true }); return { mode: 'real', status: 'sent' }; }, smsSafe: s => s },
        notifyTelegram: t => tg.push(t), env: {},
    }, extra || {});
    const M = mount(app, deps);
    return { M, db, app, sent, tg, audits, deps };
}
const po = (id, orderId, productId, opt, qty, extra) => ({ productOrder: Object.assign({ productOrderId: id, productId, productOption: opt, quantity: qty, remainQuantity: qty, productOrderStatus: 'PAYED', totalPaymentAmount: 18000 * qty }, extra || {}), order: { orderId, ordererName: '홍길동', ordererTel: '010-1234-5678', paymentDate: new Date().toISOString() } });
const OPT = (kind, m, d, t) => `제주아꼼이네 귤체험: ${kind} / 00월: ${m} / 00일: ${d} / 00시 00분 (30분단위): ${t}`;
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

(async () => {
    console.log('① 판독');
    const tcases = [['12:30', '12:30'], ['12시30분', '12:30'], ['12시 반', '12:30'], ['오후 1시', '13:00'], ['1시', '13:00'], ['10시', '10:00'], ['오전 10시 30분', '10:30'], ['1430', '14:30'], ['14', '14:00'], ['아무때나', null], ['', null], ['25:00', null]];
    ok(tcases.every(([i, o]) => T.parseTime(i) === o), '시각 12가지', tcases.map(([i]) => i + '→' + T.parseTime(i)).join(' · '));
    const ref = Date.parse('2026-10-20T03:00:00Z');
    let p = T.parseStoreOption(OPT('내가 직접 딴 노지귤 2kg(36개월까지무료)', '11', '1', '13:30'), ref);
    ok(p.ok && p.date === '2026-11-01' && p.time === '13:30' && /노지귤/.test(p.option), '정상 옵션 → 2026-11-01 13:30', p);
    p = T.parseStoreOption(OPT('체험 없이 입장만(시식 무제한)', '11월', '30일', '오후 2시'), ref);
    ok(p.ok && p.date === '2026-11-30' && p.time === '14:00', '「11월」「30일」「오후 2시」 꼴', p);
    p = T.parseStoreOption(OPT('x', '1', '5', '11:00'), ref);
    ok(p.ok && p.date === '2027-01-05', '10월 주문의 「1월」 = 다음 해', p.date);
    p = T.parseStoreOption(OPT('x', '11', '31', '11:00'), ref);
    ok(!p.ok && p.why === '없는 날짜', '11월 31일 = 없는 날짜 → 확인 필요', p.why);
    p = T.parseStoreOption(OPT('x', '십일월', '1', '11:00'), ref);
    ok(!p.ok && p.why === '월 못 읽음', '「십일월」 = 월 못 읽음', p.why);
    p = T.parseStoreOption(OPT('x', '11', '1', '아침 일찍'), ref);
    ok(!p.ok && p.date === '2026-11-01' && p.why === '시간 못 읽음', '시간 못 읽음 = 날짜는 남기고 확인 필요', p);
    p = T.parseStoreOption('제주아꼼이네 귤체험: 내가 직접 딴 노지귤 2kg', ref);
    ok(!p.ok && p.why === '월·일 못 읽음', '입력 칸이 없는 옵션 = 확인 필요', p.why);
    const m = T.parsePlaceMail('[네이버 예약] 홍길동님 예약이 확정되었습니다', '예약번호: 1234567\n예약자: 홍길동\n연락처: 010-1234-5678\n이용일시: 2026.11.03.(화) 오후 2:00\n성인 2명\n유아 1명\n결제금액: 36,000원');
    ok(m.known && m.no === '1234567' && m.date === '2026-11-03' && m.time === '14:00' && m.exp === 2 && m.infant === 1 && m.phone === '01012345678' && m.amount === 36000 && m.status === 'confirmed', '플레이스 메일(추정 꼴) 판독', m);
    ok(T.parsePlaceMail('[네이버 예약] 예약이 취소되었습니다', '예약번호: 1234567').status === 'canceled', '제목 「취소」 = 취소');
    // 실메일 꼴(10/20 대표 시험 예약·취소 메일 · 이름은 바꿈) — text 에 HTML 주석이 섞여 옴 · 「예약신청 일시」는 방문일이 아님
    const REAL = '<!-- 아웃룩용 max-width 핵 --> <!--[if (gte mso 9)|(IE)]> <table border="0"> <tr> <td width="595"> <![endif]-->\n\n제주아꼼이네\n고객님이 예약을 취소 하셨습니다.\n\n<!-- 고객 -->\n예약자명 홍*동님\n예약신청 일시 2026.10.20. 12:54:01\n예약취소 일시 2026.10.20. 12:54:33\n\n<!--// 고객 --> <!-- 예약 상품 정보 -->\n예약취소내역\n\n예약번호 1384521818\n예약상품 제주아꼼이네 귤따기 체험 예약\n이용일시 2026.11.01.(일) 오전 10:00, 1명\n결제상태 환불완료\n결제수단 신용카드 간편결제\n환불금액 18,000원\n환불수수료 0원(결제금액의 0%)\n결제금액 내가 직접 딴 노지귤 2kg(36개월까지무료)(1)18,000원 = 18,000원\n<!-- 일반형, 뷰티형 현장결제 추가 --> 매장방문결제\n';
    const rc = T.parsePlaceMail('[네이버 예약] 제주아꼼이네 고객님이 예약을 취소하셨습니다.', REAL);
    ok(rc.known && rc.no === '1384521818' && rc.status === 'canceled' && rc.date === '2026-11-01' && rc.time === '10:00' && rc.exp === 1 && rc.entry === 0 && rc.amount === 18000 && rc.name === '홍*동' && rc.date_ok, '실메일(취소) = 번호 · 취소 · 11/1 10:00(신청 일시 아님) · 체험 1 · 18,000원 · 이름(님 뗌)', rc);
    const rn = T.parsePlaceMail('[네이버 예약] 제주아꼼이네 고객님이 예약을 신청하셨습니다.', REAL.replace('예약취소 일시 2026.10.20. 12:54:33\n', '').replace('결제금액 내가 직접 딴 노지귤 2kg(36개월까지무료)(1)18,000원 = 18,000원', '결제금액 내가 직접 딴 노지귤 2kg(36개월까지무료)(2)36,000원 + 체험 없이 입장만(시식 무제한)(1)10,000원 = 46,000원'));
    ok(rn.status === 'confirmed' && rn.exp === 2 && rn.entry === 1 && rn.amount === 46000 && rn.date === '2026-11-01', '실메일 꼴(신청 · 상품 둘) = 확정 · 체험 2 · 입장 1 · 46,000원', rn);
    // 총괄 10/20 손질: 유아 항목(「36개월 미만 …」 · 0원) = 유아 · 「(36개월까지무료)」 체험 상품은 체험 그대로 · 인원 못 읽음 = 확인 필요
    const r3 = T.parsePlaceMail('[네이버 예약] 제주아꼼이네 고객님이 예약을 신청하셨습니다.', REAL.replace('결제금액 내가 직접 딴 노지귤 2kg(36개월까지무료)(1)18,000원 = 18,000원', '결제금액 내가 직접 딴 노지귤 2kg(36개월까지무료)(1)18,000원 + 체험 없이 입장만(시식 무제한)(1)10,000원 + 36개월 미만 무료(증빙서류 지참)(1)0원 = 28,000원'));
    ok(r3.exp === 1 && r3.entry === 1 && r3.infant === 1 && r3.amount === 28000 && r3.date_ok, '노지귤 1 + 입장 1 + 36개월 미만 1 → 체험 1 · 입장 1 · 유아 1', { e: r3.exp, n: r3.entry, i: r3.infant, a: r3.amount });
    const r4 = T.parsePlaceMail('[네이버 예약] 제주아꼼이네 고객님이 예약을 신청하셨습니다.', '예약번호 1384521999\n이용일시 2026.11.02.(월) 오후 2:00\n결제상태 결제완료\n');
    ok(r4.known && r4.exp == null && r4.entry == null && !r4.date_ok && r4.why === '인원 못 읽음' && r4.date === '2026-11-02', '인원 없는 메일 = 0명 아님 · 확인 필요(인원 못 읽음 · 날짜는 남김)', r4);
    const t9 = mk({ imapOpen: async () => ({ login: async () => { }, examine: async () => { }, close: async () => { }, search: async () => [31], fetch: async (u, w) => /MESSAGE-ID/.test(w) ? Buffer.from('Message-ID: <m31@x>\r\n\r\n') : Buffer.from('Message-ID: <m31@x>\r\nSubject: [네이버 예약] 제주아꼼이네 고객님이 예약을 신청하셨습니다.\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n예약번호 1384521999\r\n이용일시 2026.11.02.(월) 오후 2:00\r\n', 'utf8') }), env: { NAVER_MAIL_USER: 'u', NAVER_MAIL_APP_PW: 'p' } });
    await t9.M.collectPlace();
    const p9 = t9.db.S.rows.find(r => r.ext_key === 'place:1384521999');
    ok(p9 && p9.date_ok === false && p9.date_why === '인원 못 읽음' && p9.status === 'confirmed', '저장 = 「확인 필요」 묶음(date_ok false · 인원 못 읽음)', p9 && { ok: p9.date_ok, why: p9.date_why });
    ok(!T.parsePlaceMail('안녕하세요', '광고 메일').known, '예약번호·상태 없는 메일 = 꼴 모름');
    const b64 = Buffer.from('예약번호: 99887766\n이용일시: 2026년 11월 2일 오전 10시', 'utf8').toString('base64');
    const raw = `Message-ID: <abc@naver>\r\nFrom: =?UTF-8?B?${Buffer.from('네이버 예약').toString('base64')}?= <booking@naver.com>\r\nSubject: =?UTF-8?B?${Buffer.from('[네이버 예약] 예약 확정').toString('base64')}?=\r\nContent-Type: multipart/alternative; boundary="BB"\r\n\r\n--BB\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}\r\n--BB\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>html</p>\r\n--BB--\r\n`;
    const pm = T.parseMail(Buffer.from(raw, 'latin1'));
    ok(pm.subject === '[네이버 예약] 예약 확정' && /99887766/.test(pm.text) && pm.messageId === 'abc@naver', 'MIME: 제목 인코딩 · multipart · base64 UTF-8', { s: pm.subject, id: pm.messageId });
    const euc = Buffer.concat([Buffer.from('Subject: test\r\nContent-Type: text/plain; charset=euc-kr\r\n\r\n', 'latin1'), Buffer.from([0xbf, 0xb9, 0xbe, 0xe0])]);
    ok(T.parseMail(euc).text === '예약', 'MIME: euc-kr 본문', T.parseMail(euc).text);
    const qp = 'Subject: t\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<b>=EC=98=88=EC=95=BD</b>=\r\n<br>=EB=B2=88=ED=98=B8';
    ok(T.parseMail(qp).text === '예약\n번호', 'MIME: quoted-printable html → 글', JSON.stringify(T.parseMail(qp).text));
    ok(T.maskSubject('홍길동님 예약 1234') === '홍**님 예약 ####', '확인 러너 제목 가림(이름·숫자)', T.maskSubject('홍길동님 예약 1234'));

    console.log('\n② IMAP 읽기 전용 클라이언트(가짜 소켓)');
    {
        const cmds = [];
        const connect = () => {
            const toClient = new PassThrough(), sock = new PassThrough();
            sock.write = (d) => { const line = String(d).trim(); cmds.push(line.replace(/LOGIN .*/, 'LOGIN ***')); const tag = line.split(' ')[0];
                setImmediate(() => {
                    if (/ LOGIN /.test(line)) toClient.emit('data', Buffer.from(`${tag} OK LOGIN done\r\n`));
                    else if (/ EXAMINE /.test(line)) toClient.emit('data', Buffer.from(`* 3 EXISTS\r\n* OK [READ-ONLY]\r\n${tag} OK [READ-ONLY] EXAMINE done\r\n`));
                    else if (/ UID SEARCH /.test(line)) toClient.emit('data', Buffer.from(`* SEARCH 11 12\r\n${tag} OK\r\n`));
                    else if (/ UID FETCH 12 \(BODY\.PEEK\[\]\)/.test(line)) { const body = Buffer.from('Subject: hi\r\n\r\n본문{5}\r\n끝', 'utf8'); const a = Buffer.from(`* 2 FETCH (UID 12 BODY[] {${body.length}}\r\n`); const b2 = Buffer.from(`)\r\n${tag} OK\r\n`); const all = Buffer.concat([a, body, b2]); toClient.emit('data', all.slice(0, 20)); setImmediate(() => toClient.emit('data', all.slice(20))); }
                    else if (/ STATUS /.test(line)) toClient.emit('data', Buffer.from(`* STATUS "INBOX" (MESSAGES 57)\r\n${tag} OK\r\n`));
                    else if (/ LOGOUT/.test(line)) toClient.emit('data', Buffer.from(`* BYE\r\n${tag} OK\r\n`));
                    else toClient.emit('data', Buffer.from(`${tag} BAD\r\n`));
                }); return true; };
            sock.on = (ev, fn) => { if (ev === 'data') toClient.on('data', fn); return sock; };
            sock.end = () => { }; sock.destroy = () => { };
            setImmediate(() => toClient.emit('data', Buffer.from('* OK IMAP ready\r\n')));
            return sock;
        };
        const im = await T.imapOpen({ host: 'x', port: 993, user: 'u@naver.com', pass: 'p"w\\d', connect, timeoutMs: 3000 });
        await im.login(); await im.examine('INBOX');
        const uids = await im.search('SINCE ' + T.imapDate(Date.now()) + ' ' + T.imapFromCrit(['booking', 'reserve']));
        const lit = await im.fetch(12, 'BODY.PEEK[]'); const st = await im.status('INBOX'); await im.close();
        ok(JSON.stringify(uids) === '[11,12]', 'UID SEARCH 결과', uids);
        ok(lit && lit.toString('utf8') === 'Subject: hi\r\n\r\n본문{5}\r\n끝', '리터럴(조각 나뉘어 와도 · 본문 안 「{5}」 무시)', lit && lit.toString('utf8'));
        ok(st === 57, 'STATUS 메일 수', st);
        ok(cmds.every(c => /^X\d+ (LOGIN \*\*\*|EXAMINE "INBOX"|UID SEARCH |UID FETCH \d+ \(BODY\.PEEK\[|STATUS "INBOX"|LOGOUT)/.test(c)), '보낸 명령 = LOGIN·EXAMINE·UID SEARCH·UID FETCH BODY.PEEK·STATUS·LOGOUT 만(쓰기·STORE·SELECT 0)', cmds);
        ok(cmds.some(c => /OR FROM "booking" FROM "reserve"/.test(c)), '보낸 사람 낱말 OR 조건', cmds[2]);
    }

    console.log('\n③ 스토어 수집');
    {
        const t = mk(); const d = t.db.S;
        d.changes = [{ productOrderId: 'P1', lastChangedType: 'PAYED' }, { productOrderId: 'P2', lastChangedType: 'PAYED' }, { productOrderId: 'Q1', lastChangedType: 'PAYED' }];
        d.detail = [po('P1', 'O1', '7673020911', OPT('내가 직접 딴 노지귤 2kg(36개월까지무료)', '11', '1', '13:30'), 2), po('P2', 'O1', '7673020911', OPT('체험 없이 입장만(시식 무제한)', '11', '1', '13:30'), 1), po('Q1', 'O9', '5531798664', '과수 및 크기: 레몬', 1)];
        d.kakaoExp = ['P3'];
        d.detail.push(po('P3', 'O2', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '십오', '11:00'), 3));
        const out = await t.M.collectStore();
        const o1 = d.rows.find(r => r.ext_key === 'store:O1'), o2 = d.rows.find(r => r.ext_key === 'store:O2');
        ok(d.rows.length === 2 && !d.rows.some(r => /O9/.test(r.ext_key)), '체험 주문만 · 주문 번호로 묶음(2건) · 택배 주문 0', d.rows.map(r => r.ext_key));
        ok(o1 && o1.exp_count === 2 && o1.entry_count === 1 && o1.visit_date === '2026-11-01' && o1.visit_time === '13:30' && o1.date_ok && o1.status === 'confirmed' && o1.phone === '01012345678' && o1.amount === 54000, 'O1 = 체험 2 · 입장 1 · 11/1 13:30 · 연락처 · 금액', o1 && { e: o1.exp_count, n: o1.entry_count, d: o1.visit_date, t: o1.visit_time, a: o1.amount });
        ok(o2 && !o2.date_ok && o2.date_why === '일 못 읽음', '#775-A 가 뺀 줄(kakao_notify_log)도 받음 · 「십오」 = 날짜 확인 필요', o2 && o2.date_why);
        ok(/새로 2/.test(out) && /날짜 확인 필요 1/.test(out), '결과 글', out);
        // 직원이 날짜를 고침 → 다음 수집이 덮지 않음
        o2.date_fixed = true; o2.visit_date = '2026-11-15'; o2.visit_time = '11:00'; o2.date_ok = true;
        d.changes = [{ productOrderId: 'P3', lastChangedType: 'DELIVERED' }];
        await t.M.collectStore();
        ok(o2.visit_date === '2026-11-15' && o2.date_ok, '직원이 고친 날짜는 다음 수집이 안 덮음', o2.visit_date);
        // 입장만 줄 반품 요청 → 인원만 빠짐 · 전부 반품 → 상태 반품
        d.changes = [{ productOrderId: 'P2', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }];
        d.detail = d.detail.map(x => x.productOrder.productOrderId === 'P2' ? po('P2', 'O1', '7673020911', OPT('체험 없이 입장만(시식 무제한)', '11', '1', '13:30'), 1, { claimType: 'RETURN', claimStatus: 'RETURN_REQUEST', productOrderStatus: 'DELIVERED' }) : x);
        await t.M.collectStore();
        ok(o1.status === 'confirmed' && o1.entry_count === 0 && o1.exp_count === 2, '한 줄만 반품 = 그 인원만 빠짐(예약 유지)', { st: o1.status, n: o1.entry_count });
        d.changes = [{ productOrderId: 'P1', claimType: 'RETURN', claimStatus: 'RETURN_REQUEST' }];
        d.detail = d.detail.map(x => x.productOrder.productOrderId === 'P1' ? po('P1', 'O1', '7673020911', OPT('내가 직접 딴 노지귤 2kg(36개월까지무료)', '11', '1', '13:30'), 2, { claimType: 'RETURN', claimStatus: 'RETURN_DONE' }) : x);
        await t.M.collectStore();
        ok(o1.status === 'returned' && o1.exp_count === 0, '전부 반품 = 상태 반품(= 취소로 봄)', o1.status);
        ok(o1.visit_date === '2026-11-01' && o1.visit_time === '13:30', '전부 반품돼도 방문일·시간은 남김(「취소 포함」 달력에 그 날로 보이게 · #783 실측)', { d: o1.visit_date, t: o1.visit_time });
        d.changes = [{ productOrderId: 'P3', claimType: 'CANCEL', claimStatus: 'CANCEL_DONE' }];
        d.detail = d.detail.map(x => x.productOrder.productOrderId === 'P3' ? po('P3', 'O2', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '십오', '11:00'), 3, { productOrderStatus: 'CANCELED', claimType: 'CANCEL', claimStatus: 'CANCEL_DONE' }) : x);
        await t.M.collectStore();
        ok(o2.status === 'canceled', '발주확인 전 취소 = 상태 취소', o2.status);
        const t2 = mk(); t2.db.S.changes = [];
        ok(await t2.M.collectStore() === '체험 주문 변경 0', '변경 없으면 상세조회 0');
    }

    console.log('\n③-2 #780 체험 주문 자동 발주확인(#92 와 같은 함수 · 가짜 네이버)');
    {
        const calls = []; let reply = ids => ({ success: ids, fail: [] });
        const isAlready = f => f.code === '105306';
        const t = mk({ naverConfirmOrders: async ids => { calls.push(ids.slice()); return reply(ids); }, naverConfirmIsAlready: isAlready });
        const d = t.db.S;
        d.changes = ['P1', 'P2', 'P3', 'P4', 'P6', 'Q1'].map(id => ({ productOrderId: id, lastChangedType: 'PAYED' }));
        d.detail = [po('P1', 'O1', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '1', '13:30'), 2), po('P2', 'O1', '7673020911', OPT('체험 없이 입장만', '11', '1', '13:30'), 1),
            po('P3', 'O2', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '십오', '11:00'), 1),
            po('P4', 'O3', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '2', '10:00'), 1, { claimType: 'CANCEL', claimStatus: 'CANCEL_REQUEST' }),
            po('P6', 'O4', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '3', '10:00'), 1, { placeOrderStatus: 'OK' }),
            po('Q1', 'O9', '5531798664', '레몬', 1)];
        const out = await t.M.collectStore();
        const by = k => d.rows.find(r => r.ext_key === 'store:' + k);
        ok(calls.length === 1 && JSON.stringify(calls[0].slice().sort()) === '["P1","P2","P3"]', '발주확인 1번 · 대상 = 결제완료·발주확인 전 체험 줄만(취소 요청 P4 · 이미 발주확인 P6 · 택배 Q1 제외 · 날짜 확인 필요 P3 은 함)', calls);
        ok(by('O1').confirm_state === 'dispatched' && by('O2').confirm_state === 'dispatched' && !by('O3').confirm_state && by('O4').confirm_state === 'dispatched', '명단 = 발주확인 → 발송처리 끝(dispatched) · 이미 발주확인(네이버 OK)이던 O4 도 발송처리 · 취소 요청 O3 표시 없음(#782)', d.rows.map(r => r.ext_key + ':' + (r.confirm_state || '-')));
        ok(/발주확인 2/.test(out) && t.audits.some(a => a.action === 'experience_auto_confirm' && a.changes.after.asked === 3), '결과 글 「발주확인 2」 · audit experience_auto_confirm', out);
        // 다음 틱: 이미 done = 다시 안 함(한 주문 1회)
        d.changes = [{ productOrderId: 'P1', lastChangedType: 'DELIVERED' }]; calls.length = 0;
        d.detail = d.detail.map(x => x.productOrder.productOrderId === 'P1' ? po('P1', 'O1', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '1', '13:30'), 2, { productOrderStatus: 'DELIVERED', placeOrderStatus: 'OK' }) : x);
        await t.M.collectStore();
        ok(calls.length === 0, '발주확인 끝난 주문 = 다시 안 함', calls);
        // 실패 → 다음 틱 재시도(변경 목록에 없어도) → 3번 실패 = failed + 텔레그램 1회 · 4번째 없음
        const f = mk({ naverConfirmOrders: async ids => { calls.push(ids.slice()); return { success: [], fail: ids.map(id => ({ id, code: '104000', message: '일시 오류' })) }; }, naverConfirmIsAlready: isAlready });
        f.db.S.changes = [{ productOrderId: 'P5', lastChangedType: 'PAYED' }]; f.db.S.detail = [po('P5', 'O5', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '4', '10:00'), 1)];
        calls.length = 0;
        await f.M.collectStore(); const o5 = f.db.S.rows.find(r => r.ext_key === 'store:O5');
        ok(o5.confirm_state === 'pending' && o5.confirm_tries === 1 && /104000 일시 오류/.test(o5.confirm_error), '1번 실패 = pending · 사유', { st: o5.confirm_state, n: o5.confirm_tries, e: o5.confirm_error });
        f.db.S.changes = []; await f.M.collectStore();
        ok(calls.length === 1 && o5.confirm_tries === 1, '실패 뒤 30분 안 = 다시 안 함(통째 실패로 몇 분 안에 3번이 다 차지 않게)', calls.length);
        for (let i = 0; i < 2; i++) { o5.confirm_at = Date.now() - 31 * 60000; await f.M.collectStore(); }
        ok(o5.confirm_state === 'failed' && o5.confirm_tries === 3 && calls.length === 3 && f.tg.length === 1 && /3번 실패/.test(f.tg[0]), '변경 없어도 다음 틱 재시도 · 3번 실패 = failed + 텔레그램 1회', { st: o5.confirm_state, calls: calls.length, tg: f.tg.length });
        o5.confirm_at = Date.now() - 31 * 60000; await f.M.collectStore();
        ok(calls.length === 3 && f.tg.length === 1, '3번 실패 뒤 = 더 안 함 · 알림 1회 그대로', calls.length);
        // 클레임 이력(반품 거부 등 · 아직 결제완료·발주확인 전)이 남은 주문 = 자동 안 함 · skipped_claim · 화면 문구
        const sc = mk({ naverConfirmOrders: async ids => { calls.push(ids.slice()); return { success: ids, fail: [] }; }, naverConfirmIsAlready: isAlready });
        sc.db.S.changes = [{ productOrderId: 'P9', lastChangedType: 'PAYED' }]; sc.db.S.detail = [po('P9', 'O9x', '7673020911', OPT('x', '11', '7', '10:00'), 1, { claimType: 'RETURN', claimStatus: 'RETURN_REJECT' })];
        calls.length = 0; await sc.M.collectStore();
        const o9 = sc.db.S.rows[0];
        ok(calls.length === 0 && o9.status === 'confirmed' && o9.confirm_state === 'skipped_claim' && /RETURN_REJECT/.test(o9.confirm_error), '클레임 이력 주문 = 발주확인 0 · skipped_claim(사유 · 예약은 확정 그대로)', { st: o9.confirm_state, e: o9.confirm_error });
        const uiS = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'ao-exp.js'), 'utf8');
        ok(/skipped_claim/.test(uiS) && /자동 안 함 · 클레임 이력 — 센터에서 발주확인/.test(uiS), '화면 = 「자동 안 함 · 클레임 이력 — 센터에서 발주확인」');
        // 「이미 발주확인」 응답 = 됨 · 설정 auto_confirm false = 안 함
        const a = mk({ naverConfirmOrders: async ids => ({ success: [], fail: ids.map(id => ({ id, code: '105306', message: '이미 발주확인된 주문' })) }), naverConfirmIsAlready: isAlready });
        a.db.S.changes = [{ productOrderId: 'P7', lastChangedType: 'PAYED' }]; a.db.S.detail = [po('P7', 'O7', '7673020911', OPT('x', '11', '5', '10:00'), 1)];
        await a.M.collectStore();
        ok(a.db.S.rows[0].confirm_state === 'dispatched', '「이미 발주확인」 응답 = 됨 → 이어서 발송처리(dispatched)', a.db.S.rows[0].confirm_state);
        const off = []; const n = mk({ naverConfirmOrders: async ids => { off.push(ids); return { success: ids, fail: [] }; } });
        n.db.S.cfg.experience_notify = { auto_confirm: false }; n.db.S.changes = [{ productOrderId: 'P8', lastChangedType: 'PAYED' }]; n.db.S.detail = [po('P8', 'O8', '7673020911', OPT('x', '11', '6', '10:00'), 1)];
        await n.M.collectStore();
        ok(off.length === 0 && n.db.S.rows.length === 1 && !n.db.S.rows[0].confirm_state, '설정 auto_confirm false = 명단만 · 발주확인 0');
        const uiSrc2 = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'ao-exp.js'), 'utf8');
        ok(/confirm_state === 'failed'/.test(uiSrc2) && /발주확인 실패/.test(uiSrc2) && /xp-s-ac/.test(uiSrc2), '화면 = 「발주확인 실패」 표시 · 문자 설정에 자동 발주확인 켜기·끄기');
    }

    console.log('\n③-3 #782 발송처리(배송 없음) · 가짜 중계·네이버');
    {
        // 발송처리 바디 꼴 = 줄마다 deliveryMethod NOTHING · dispatchDate 밀리초 +09:00 · 택배사·송장 칸 없음
        const t = mk({ naverConfirmOrders: async ids => ({ success: ids, fail: [] }), naverConfirmIsAlready: () => false });
        t.db.S.changes = [{ productOrderId: 'D1', lastChangedType: 'PAYED' }]; t.db.S.detail = [po('D1', 'OD1', '7673020911', OPT('x', '11', '10', '16:30'), 1)];
        const out = await t.M.collectStore();
        const body = t.db.S.dispatchCalls && t.db.S.dispatchCalls[0];
        ok(body && Object.keys(body).join() === 'dispatchProductOrders' && body.dispatchProductOrders.length === 1 && body.dispatchProductOrders[0].productOrderId === 'D1' && body.dispatchProductOrders[0].deliveryMethod === 'NOTHING'
            && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/.test(body.dispatchProductOrders[0].dispatchDate) && !('trackingNumber' in body.dispatchProductOrders[0]) && !('deliveryCompanyCode' in body.dispatchProductOrders[0]), '발송처리 바디 = NOTHING · dispatchDate(밀리초 +09:00) · 송장 칸 없음', body);
        ok(t.db.S.rows[0].confirm_state === 'dispatched' && /발송처리 1/.test(out) && t.audits.some(a => a.action === 'experience_auto_dispatch'), '발주확인 → 발송처리 같은 틱 · audit experience_auto_dispatch', out);
        // 대표 시험 주문 꼴: 네이버가 이미 발주확인(OK) · 우리 표시 없음 · 변경 목록에 다시 안 나와도 → 다음 틱에 다시 읽어 발송처리
        const u = mk({ naverConfirmOrders: async () => { throw new Error('부르면 안 됨'); } });
        u.db.S.rows.push({ id: 1, source: 'store', ext_key: 'store:OR', status: 'confirmed', date_ok: true, items: { R1: {} }, confirm_state: null });
        u.db.S.nextId = 2; u.db.S.changes = []; u.db.S.detail = [po('R1', 'OR', '7673020911', OPT('x', '11', '10', '16:30'), 1, { placeOrderStatus: 'OK' })];
        await u.M.collectStore();
        ok(u.db.S.rows[0].confirm_state === 'dispatched' && (u.db.S.dispatchCalls || []).length === 1, '네이버가 이미 OK 로 둔 주문(대표 시험 꼴) = 다음 틱에 다시 읽어 발송처리 · 발주확인은 안 부름', u.db.S.rows[0].confirm_state);
        // 실패 → done 유지 + 30분 간격 → 3번 = dispatch_failed + 텔레그램 1
        const f = mk({ naverConfirmOrders: async ids => ({ success: ids, fail: [] }) });
        f.db.S.dispatchReply = ids => ({ data: { data: { successProductOrderIds: [], failProductOrderInfos: ids.map(id => ({ productOrderId: id, code: '104100', message: '처리 불가' })) } } });
        f.db.S.changes = [{ productOrderId: 'F1', lastChangedType: 'PAYED' }]; f.db.S.detail = [po('F1', 'OF1', '7673020911', OPT('x', '11', '11', '10:00'), 1)];
        await f.M.collectStore(); const of1 = f.db.S.rows[0];
        ok(of1.confirm_state === 'done' && of1.dispatch_tries === 1 && /104100 처리 불가/.test(of1.dispatch_error), '발송처리 실패 1 = done 유지 · 사유', { st: of1.confirm_state, n: of1.dispatch_tries });
        f.db.S.changes = []; await f.M.collectStore();
        ok(of1.dispatch_tries === 1 && f.db.S.dispatchCalls.length === 1, '30분 안 = 다시 안 함', f.db.S.dispatchCalls.length);
        for (let i = 0; i < 3; i++) { of1.dispatch_at = Date.now() - 31 * 60000; await f.M.collectStore(); }
        ok(of1.confirm_state === 'dispatch_failed' && of1.dispatch_tries === 3 && f.db.S.dispatchCalls.length === 3 && f.tg.length === 1 && /발송처리/.test(f.tg[0]), '3번 실패 = dispatch_failed + 텔레그램 1 · 그 뒤 안 함', { st: of1.confirm_state, calls: f.db.S.dispatchCalls.length, tg: f.tg.length });
        // 설정 auto_dispatch false = 발주확인만 · 사람이 센터에서 발송처리하면(배송중·완료) 끝으로 표시
        const n = mk({ naverConfirmOrders: async ids => ({ success: ids, fail: [] }) });
        n.db.S.cfg.experience_notify = { auto_dispatch: false }; n.db.S.changes = [{ productOrderId: 'N1', lastChangedType: 'PAYED' }]; n.db.S.detail = [po('N1', 'ON1', '7673020911', OPT('x', '11', '12', '10:00'), 1)];
        await n.M.collectStore();
        ok(n.db.S.rows[0].confirm_state === 'done' && !(n.db.S.dispatchCalls || []).length, '설정 auto_dispatch false = 발주확인만(발송처리 0)', n.db.S.rows[0].confirm_state);
        n.db.S.cfg.experience_notify = {}; n.db.S.changes = [{ productOrderId: 'N1', lastChangedType: 'DELIVERED' }]; n.db.S.detail = [po('N1', 'ON1', '7673020911', OPT('x', '11', '12', '10:00'), 1, { productOrderStatus: 'DELIVERED', placeOrderStatus: 'OK' })];
        await n.M.collectStore();
        ok(n.db.S.rows[0].confirm_state === 'dispatched' && !(n.db.S.dispatchCalls || []).length, '센터에서 이미 발송(배송완료) = 부르지 않고 끝으로 표시', n.db.S.rows[0].confirm_state);
        const ui3 = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'ao-exp.js'), 'utf8');
        ok(/dispatch_failed/.test(ui3) && /발송처리 실패 — 센터에서 발송처리/.test(ui3) && /xp-s-ad/.test(ui3), '화면 = 「발송처리 실패」·「발송처리✓」 · 설정 자동 발송처리 켜기·끄기');
    }

    console.log('\n③-4 #782 중계서버 발송처리 바디 검사(relay/server.js 의 dispatchBodyOk 를 떼어 실행)');
    {
        const rsrc = require('fs').readFileSync(path.join(__dirname, '..', 'relay', 'server.js'), 'utf8');
        const ra = rsrc.indexOf('// ── #782 발송처리 바디 검사 시작'), rb = rsrc.indexOf('// ── #782 발송처리 바디 검사 끝');
        const G = new Function(rsrc.slice(ra, rb) + '\nreturn { dispatchBodyOk, DISPATCH_PATH_RE };')();
        const okItem = { productOrderId: '2026102038638821', deliveryMethod: 'NOTHING', dispatchDate: '2026-10-20T14:10:00.123+09:00' };
        const cases = [
            [{ dispatchProductOrders: [okItem] }, null, '배송 없음 1줄 = 통과'],
            [{ dispatchProductOrders: [{ ...okItem, deliveryCompanyCode: '', trackingNumber: '' }] }, null, '빈 택배사·송장 칸 = 통과'],
            [{ dispatchProductOrders: [{ ...okItem, deliveryMethod: 'DELIVERY', deliveryCompanyCode: 'CJGLS', trackingNumber: '123456789012' }] }, 'dispatch_only_nothing', '택배 송장 발송처리 = 거절'],
            [{ dispatchProductOrders: [{ ...okItem, deliveryMethod: 'DIRECT_DELIVERY' }] }, 'dispatch_only_nothing', '직접 전달 = 거절'],
            [{ dispatchProductOrders: [{ ...okItem, trackingNumber: '1234' }] }, 'dispatch_no_tracking', 'NOTHING 인데 송장 번호 = 거절'],
            [{ dispatchProductOrders: [{ ...okItem, dispatchDate: '2026-10-20T14:10:00+09:00' }] }, 'dispatch_date_format', '밀리초 없는 날짜 = 거절'],
            [{ dispatchProductOrders: [{ ...okItem, extra: 1 }] }, 'dispatch_item_keys', '다른 칸 = 거절'],
            [{ dispatchProductOrders: [okItem], other: 1 }, 'dispatch_body_keys', '바디에 다른 칸 = 거절'],
            [{ dispatchProductOrders: Array(31).fill(okItem) }, 'dispatch_count', '31줄 = 거절'],
            [{ dispatchProductOrders: [] }, 'dispatch_count', '0줄 = 거절'],
            [{ dispatchProductOrders: [{ ...okItem, productOrderId: 'abc' }] }, 'dispatch_product_order_id', '번호 꼴 = 거절'],
            [null, 'dispatch_body_not_object', '바디 없음 = 거절'],
        ];
        const res2 = cases.map(([b, want, nm]) => [G.dispatchBodyOk(b) === want, nm, G.dispatchBodyOk(b)]);
        ok(res2.every(x => x[0]), '바디 검사 12가지', res2.filter(x => !x[0]).map(x => x[1] + '→' + x[2]).join(' · ') || '전부 맞음');
        ok(G.DISPATCH_PATH_RE.test('/external/v1/pay-order/seller/product-orders/dispatch') && !G.DISPATCH_PATH_RE.test('/external/v1/pay-order/seller/product-orders/dispatch/x'), '경로 정확 일치');
        ok(/m: 'POST', re: \/\^\\\/external\\\/v1\\\/pay-order\\\/seller\\\/product-orders\\\/dispatch\$\//.test(rsrc) && /if \(DISPATCH_PATH_RE\.test\(path\)\)/.test(rsrc) && /RELAY_VERSION = '2026-10-20\.1'/.test(rsrc), '허용 목록 1줄 · /naver 에서 바디 검사 · RELAY_VERSION 2026-10-20.1');
    }

    console.log('\n④ 플레이스 메일 수집');
    {
        const mails = {
            21: `Message-ID: <m21@x>\r\nSubject: [네이버 예약] 예약 확정\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n예약번호: 5550001\r\n예약자: 김손님\r\n연락처: 010-2222-3333\r\n이용일시: 2026.11.02.(월) 오후 1:30\r\n성인 3명\r\n`,
            22: `Message-ID: <m22@x>\r\nSubject: 처음 보는 꼴\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n무엇인가\r\n`,
        };
        const imapOpen = async () => ({ login: async () => { }, examine: async () => { }, close: async () => { }, status: async () => 9,
            search: async () => [21, 22], fetch: async (uid, what) => /HEADER\.FIELDS \(MESSAGE-ID\)/.test(what) ? Buffer.from(`Message-ID: <m${uid}@x>\r\n\r\n`) : Buffer.from(mails[uid], 'utf8') });
        const t = mk({ imapOpen, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 'secret-pw' } });
        const out = await t.M.collectPlace();
        const pr = t.db.S.rows.find(r => r.ext_key === 'place:5550001'), un = t.db.S.rows.find(r => /^placemail:/.test(r.ext_key));
        ok(pr && pr.visit_date === '2026-11-02' && pr.visit_time === '13:30' && pr.exp_count === 3 && pr.date_ok && pr.status === 'confirmed', '꼴 아는 메일 = 예약 1건', pr && { d: pr.visit_date, t: pr.visit_time, e: pr.exp_count });
        ok(un && un.status === 'unknown' && /처음 보는 꼴/.test(un.raw) && t.tg.length === 1 && /꼴 모름/.test(t.tg[0]), '꼴 모름 = 원문만 + 텔레그램 1', t.tg[0]);
        ok(!/secret-pw|u@naver\.com/.test(out + t.tg.join('')), '결과·알림에 비밀값·계정 없음', out);
        const out2 = await t.M.collectPlace();
        ok(/새로 읽음 0/.test(out2) && /이미 읽음 2/.test(out2) && t.db.S.rows.length === 2, '다음 틱 = 이미 읽음(중복 0)', out2);
        const t3 = mk({ env: {} });
        ok(await t3.M.collectPlace() === '메일 설정 없음 — 건너뜀', '메일 비밀값 없으면 건너뜀(실패 아님)');
        const t4 = mk({ imapOpen: async () => { throw new Error('login fail for u@naver.com pw secret-pw'); }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 'secret-pw' } });
        let msg = ''; try { await t4.M.collectPlace(); } catch (e) { msg = e.message; }
        ok(msg && !/secret-pw|u@naver\.com/.test(msg), '접속 오류 글에서 계정·비밀값 가림', msg);
        const t5 = mk({ imapOpen, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 'secret-pw' } });
        const pr5 = await t5.M.mailProbe();
        ok(pr5.inbox === 9 && pr5.terms.booking === 2 && pr5.latest && !/[0-9]{4}/.test(pr5.latest.subject_masked || '') && !JSON.stringify(pr5).includes('secret'), '메일 확인 러너 = 메일 수·낱말별 건수·제목 꼴만', pr5);
    }

    console.log('\n⑤ 손님 문자');
    {
        const t = mk(); const d = t.db.S; const tmr = kstDay(1), far = kstDay(10);
        const row = (id, o) => Object.assign({ id, source: 'store', ext_key: 's' + id, status: 'confirmed', date_ok: true, phone: '01011112222', name: '홍길동', visit_date: far, visit_time: '13:30', exp_count: 2, entry_count: 1, infant_count: 0, sms_recv_at: null, sms_eve_at: null }, o);
        d.rows.push(row(1), row(2, { date_ok: false }), row(3, { phone: '01099998888' }), row(4, { source: 'place' }), row(5, { status: 'canceled' }), row(6, { visit_date: tmr, sms_recv_at: 'x' }));
        d.refuse.add('01099998888'); d.nextId = 10;
        ok(/꺼짐/.test(await t.M.collectSms()) && t.sent.length === 0, '설정 꺼짐(기본) = 0통');
        d.cfg.experience_notify = { enabled: true, daily_cap: 40, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '23:59', sender: '01062598420' };
        await t.M.collectSms();
        const to = t.sent.map(x => x.receiver + ':' + (/내일/.test(x.message) ? 'eve' : 'recv'));
        ok(JSON.stringify(to) === JSON.stringify(['01011112222:recv', '01011112222:eve']), '접수 1(스토어·날짜 앎) + 전날 1 · 날짜 확인 필요·플레이스·취소·수신거부는 안 보냄', to);
        ok(d.rows.find(r => r.id === 3).sms_error && /수신거부/.test(d.rows.find(r => r.id === 3).sms_error), '수신거부 기억 번호 = 건너뜀 기록', d.rows.find(r => r.id === 3).sms_error);
        ok(t.sent.every(x => x.sender === '01062598420'), '설정 발신번호로', t.sent.map(x => x.sender));
        ok(/홍길동님, 예약이 확정되었습니다/.test(t.sent[0].message) && /체험 2명 · 입장 1명/.test(t.sent[0].message) && /체험장 010-6259-8420 으로 연락 주세요/.test(t.sent[0].message) && !/\{/.test(t.sent[0].message), '접수 문구 = 대표 확정 원문(이름·인원·체험장 번호 · 자리표 남은 것 0)');
        {   // #782 LMS {인원} = 알림톡 #{인원} 과 같은 함수(0명 칸 뺌 · 유아는 있을 때만) · 기본 접수 문구도 {인원}
            const d1 = { name: '전**', visit_date: '2026-11-10', visit_time: '16:30', exp_count: 1, entry_count: 0, infant_count: 0 };
            const one = T.renderTpl('방문: {월}월 {일}일 {시간} / {인원}', d1), three = T.renderTpl('{인원}', { ...d1, exp_count: 2, entry_count: 1, infant_count: 1 });
            const s = mk(); const r0 = res(); await s.app.routes['GET /api/agent-office/experience/settings']({}, r0);
            const def = T.renderTpl(r0.body.defaults.tpl_recv, d1);
            ok(one === '방문: 11월 10일 16:30 / 체험 1명' && three === '체험 2명 · 입장 1명 · 유아 1명' && /방문: 11월 10일 16:30 \/ 체험 1명\n/.test(def) && !/입장 0명/.test(def), 'LMS {인원} = 「체험 1명」(입장 0명 안 씀) · 「체험 2명 · 입장 1명 · 유아 1명」 · 기본 접수 문구도', { one, three });
        }
        ok(/내일 \d+월 \d+일 13:30 감귤체험 방문 예약/.test(t.sent[1].message) && /체험장 010-6259-8420/.test(t.sent[1].message), '전날 문구');
        const before = t.sent.length; await t.M.collectSms();
        ok(t.sent.length === before, '이미 보낸 것은 다시 안 보냄');
        const t2 = mk(); t2.db.S.rows.push(row(1), row(2), row(3)); t2.db.S.cfg.experience_notify = { enabled: true, daily_cap: 5, recv_from: '00:00', recv_to: '23:59' }; t2.db.S.sentToday = 4;
        await t2.M.collectSms();
        ok(t2.sent.length === 1, '하루 상한(5 중 4 씀) = 1통만', t2.sent.length);
        // 알림톡(총괄 10/20 · UM_6987 접수 · UM_6988 전날) — 켜면 알림톡 + 실패 시 LMS(failover = 문자 전문) · 꺼짐(기본)·원문 없음·변수 빈칸 = LMS 바로
        ok(t.sent.every(x => !x.alim), '알림톡 설정 꺼짐(기본) = LMS 만');
        const t3 = mk(); t3.db.S.rows.push(row(1, { visit_date: '2026-11-30', visit_time: '12:30' }), row(2, { visit_date: tmr, sms_recv_at: 'x', name: '' }));
        t3.db.S.cfg.experience_notify = { enabled: true, daily_cap: 40, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '23:59', alimtalk: { enabled: true } };
        await t3.M.collectSms();
        const a1 = t3.sent.find(x => x.alim), l2 = t3.sent.find(x => !x.alim);
        ok(a1 && a1.tplCode === 'UM_6987' && a1.message === T.EXP_ALIMTALK.UM_6987.content.replace('#{고객명}', '홍길동').replace('#{방문일시}', '11월 30일(월) 12:30').replace('#{인원}', '체험 2명 · 입장 1명'), '접수 알림톡 = UM_6987 원문에 변수만(방문일시 「11월 30일(월) 12:30」 · 인원 「체험 2명 · 입장 1명」)', a1 && a1.tplCode);
        ok(a1 && /\[제주아꼼이네 감귤체험장\] 홍길동님, 예약이 확정되었습니다/.test(a1.failoverMessage) && a1.buttons && a1.buttons.button.length === 2 && a1.buttons.button[0].linkMo === 'https://map.naver.com/p/entry/place/1911847116' && a1.buttons.button[1].name === '체험 안내 보기', '실패 대체 = 확정 문자 전문 · 버튼 2(길찾기·체험 안내 보기)', a1 && a1.buttons);
        ok(l2 && !l2.alim && /내일/.test(l2.message), '이름 빈칸 예약 = 알림톡 대신 LMS(원문과 달라지면 거절되므로)', l2 && l2.message.slice(0, 40));
        ok(T.alimVars({ name: 'a', visit_date: '2026-11-01', visit_time: '10:00', exp_count: 0, entry_count: 3, infant_count: 1 })['인원'] === '입장 3명 · 유아 1명', '인원 = 0명 칸 빼고 · 유아 뒤에');
        // 총괄 10/20 손질 ① 접수 문자 시간 창(기본 09~21 · 창 밖이면 안 보내고 다음 창에)
        const kh = new Date(Date.now() + 9 * 3600e3), hm = String(kh.getUTCHours()).padStart(2, '0') + ':' + String(kh.getUTCMinutes()).padStart(2, '0');
        const shut = hm >= '12:00' ? { recv_from: '00:00', recv_to: '00:01' } : { recv_from: '23:58', recv_to: '23:59' };   // 지금이 반드시 밖인 창
        const w1 = mk(); w1.db.S.rows.push(row(1)); w1.db.S.cfg.experience_notify = { enabled: true, daily_cap: 40, ...shut };
        const wo = await w1.M.collectSms();
        ok(w1.sent.length === 0 && /접수 문자 시간 밖/.test(wo) && !w1.db.S.rows[0].sms_recv_tries, '접수 문자 = 시간 창 밖이면 안 보냄(잡지도 않음 · 다음 창에)', wo);
        ok(JSON.stringify(Object.keys((await (async () => { const z = mk(); const r = res(); await z.app.routes['GET /api/agent-office/experience/settings']({}, r); return r.body.notify; })())).filter(k => /^recv_/.test(k))) === '["recv_from","recv_to"]', '설정 기본값에 recv_from·recv_to(09:00~21:00)');
        // ② 중복 방지 — 같은 순간 두 틱이 돌아도 한 통 · 3번 실패면 멈춤
        const c1 = mk(); c1.db.S.rows.push(row(1)); c1.db.S.cfg.experience_notify = { enabled: true, daily_cap: 40, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '00:01' };
        await Promise.all([c1.M.collectSms(), c1.M.collectSms()]);
        ok(c1.sent.length === 1 && c1.db.S.claims === 1 && c1.db.S.rows[0].sms_recv_tries === 1, '두 틱 동시 = 잡힌 쪽만 1통(잡기 UPDATE … RETURNING)', { sent: c1.sent.length, claims: c1.db.S.claims });
        const f1 = mk({ kakaoNotify: { sendLms: async () => ({ mode: 'real', status: 'failed', error: 'x' }), smsSafe: s => s } });
        f1.db.S.rows.push(row(1)); f1.db.S.cfg.experience_notify = { enabled: true, daily_cap: 40, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '00:01' };
        await f1.M.collectSms(); await f1.M.collectSms();
        ok(f1.db.S.rows[0].sms_recv_tries === 1, '실패 뒤 30분 안 = 다시 안 잡음', f1.db.S.rows[0].sms_recv_tries);
        for (let i = 0; i < 4; i++) { f1.db.S.rows[0].sms_recv_try_at = Date.now() - 31 * 60000; await f1.M.collectSms(); }
        ok(f1.db.S.rows[0].sms_recv_tries === 3 && !f1.db.S.rows[0].sms_recv_at && /failed/.test(f1.db.S.rows[0].sms_error), '3번 실패 = 멈춤(4번째 없음 · 실패 사유 남김)', { tries: f1.db.S.rows[0].sms_recv_tries, err: f1.db.S.rows[0].sms_error });
        const uiSrc = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'ao-exp.js'), 'utf8');
        ok(/sms_recv_tries\) >= 3/.test(uiSrc) && /문자 실패/.test(uiSrc), '화면 = 3번 실패면 「문자 실패」 표시');
        // ③ 수신거부 건너뜀은 하루 상한에 안 셈(sms_skip 따로)
        const q1 = mk(); q1.db.S.rows.push(row(1, { phone: '01099998888' }), row(2)); q1.db.S.refuse.add('01099998888');
        q1.db.S.cfg.experience_notify = { enabled: true, daily_cap: 1, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '00:01' };
        await q1.M.collectSms();
        const q1r = q1.db.S.rows;
        ok(q1r[0].sms_skip === 'refused' && !q1r[0].sms_recv_at && q1r[1].sms_recv_at === 'now' && q1.sent.length === 1, '하루 상한 1 · 수신거부 1건 건너뛰고도 다른 예약 1통 보냄(건너뜀은 셈 안 함)', { skip: q1r[0].sms_skip, sent: q1.sent.length });
        await q1.M.collectSms();
        ok(q1.sent.length === 1 && !q1.db.S.claims || q1.db.S.claims === 1, '수신거부 예약은 다음 틱에도 안 잡음(sms_skip)', q1.db.S.claims);
        const r1 = T.renderTpl('{이름} {월}/{일} {시간} 체험{체험} 입장{입장}{유아}', { name: '김', visit_date: '2026-11-03', visit_time: '10:00', exp_count: 1, entry_count: 0, infant_count: 2 });
        ok(r1 === '김 11/3 10:00 체험1 입장0 · 유아 2명', '유아 있으면 「 · 유아 n명」', r1);
    }

    console.log('\n⑥ 화면 API');
    {
        const t = mk(); const d = t.db.S; d.rows.push({ id: 1, source: 'store', ext_key: 's1', status: 'confirmed', date_ok: false, visit_date: null, visit_time: null, exp_count: 1, entry_count: 0, infant_count: 0, memo: null }, { id: 2, source: 'store', ext_key: 's2', status: 'canceled' });
        let r = res(); await t.app.routes['PATCH /api/agent-office/experience/:id']({ params: { id: '1' }, body: { visit_date: '2026-11-31' }, user: { id: 1, name: '직원' } }, r);
        ok(r.code === 400, '없는 날짜는 거절', r.body);
        r = res(); await t.app.routes['PATCH /api/agent-office/experience/:id']({ params: { id: '1' }, body: { visit_date: '2026-11-03', visit_time: '오후 2시', exp_count: 3 }, user: { id: 1, name: '직원' } }, r);
        ok(r.code === 200 && /date_fixed=TRUE/.test(d.lastPatch.sql) && /date_ok=TRUE/.test(d.lastPatch.sql) && d.lastPatch.args.includes('14:00') && /sms_eve_at=NULL/.test(d.lastPatch.sql), '날짜·시간 고침 = 확인 끝(date_fixed · 14:00) · 전날 문자 다시', d.lastPatch.sql.slice(0, 160));
        r = res(); await t.app.routes['PATCH /api/agent-office/experience/:id']({ params: { id: '1' }, body: { exp_count: -1 }, user: {} }, r);
        ok(r.code === 400, '인원 음수 거절');
        r = res(); await t.app.routes['POST /api/agent-office/experience/:id/visit']({ params: { id: '2' }, body: { on: true }, user: { name: '직원' } }, r);
        ok(r.code === 409, '취소된 예약은 방문 체크 거절');
        r = res(); await t.app.routes['POST /api/agent-office/experience/:id/visit']({ params: { id: '1' }, body: { on: true }, user: { name: '직원' } }, r);
        ok(r.code === 200 && d.rows[0].status === 'visited', '방문 체크');
        r = res(); await t.app.routes['PUT /api/agent-office/experience/settings']({ body: { sender: '12345' }, user: {} }, r);
        ok(r.code === 400, '발신번호 꼴 틀리면 거절');
        r = res(); await t.app.routes['PUT /api/agent-office/experience/settings']({ body: { enabled: true, sender: '010-6259-8420', daily_cap: 30 }, user: { name: '대표' } }, r);
        ok(r.code === 200 && d.cfg.experience_notify.enabled === true && d.cfg.experience_notify.sender === '01062598420' && d.cfg.experience_notify.tpl_recv && t.audits.length && t.audits[t.audits.length - 1].action === 'experience_settings', '설정 저장(켜기·발신번호·상한 · 문구 기본값 유지 · audit)', d.cfg.experience_notify.sender);
        ok(!!t.app.routes['GET /api/agent-office/experience/export.xlsx'] && !!t.app.routes['GET /api/agent-office/experience'] && !!t.app.routes['GET /api/agent-office/experience/:id/sms-preview'], '목록·엑셀·미리보기 라우트 있음');
    }

    console.log('\n⑦ 챙길 일 줄');
    {
        const t = mk();
        ok(await t.M.todoLine() === null, '예약 0 = 줄 없음');
        t.db.S.rows.push({ id: 1, status: 'confirmed', date_ok: true, visit_date: kstDay(0) }, { id: 2, status: 'confirmed', date_ok: true, visit_date: kstDay(1) }, { id: 3, status: 'confirmed', date_ok: true, visit_date: kstDay(1) }, { id: 4, status: 'unknown', date_ok: false, visit_date: null });
        const l = await t.M.todoLine();
        ok(l && l.key === 'exp' && l.label === '오늘 체험 1팀 · 내일 2팀 · 날짜 확인 필요 1' && l.count === 4, '「오늘 체험 1팀 · 내일 2팀 · 날짜 확인 필요 1」', l && l.label);
    }

    console.log('\n⑧ #804 플레이스 손님 이름·번호 · 넣는 즉시 접수 안내 · 메일이 안 덮음 · 전날 문자 대상');
    {
        const PATCH = 'PATCH /api/agent-office/experience/:id';
        const fut = kstDay(10);
        const place = (id, extra) => Object.assign({ id, source: 'place', ext_key: 'place:' + id, order_no: String(id), status: 'confirmed', date_ok: true, visit_date: fut, visit_time: '11:00', exp_count: 2, entry_count: 1, infant_count: 0, name: '박*현', phone: null, sms_recv_tries: 0, sms_eve_tries: 0 }, extra || {});
        const t = mk(); const d = t.db.S;
        d.cfg.experience_notify = { enabled: true, daily_cap: 30, recv_from: '00:00', recv_to: '24:00', alimtalk: { enabled: true, confirm_tpl: 'UM_6987', remind_tpl: 'UM_6988' } };
        d.rows.push(place(11), place(12), { id: 13, source: 'store', ext_key: 'store:13', status: 'confirmed', date_ok: true, visit_date: fut, visit_time: '10:00', exp_count: 1, entry_count: 0, infant_count: 0, name: '홍길동', phone: '01011112222' });
        const call = async (id, body) => { const r = res(); await t.app.routes[PATCH]({ params: { id: String(id) }, body, user: { id: 7, name: '직원' } }, r); return r; };
        let r = await call(13, { name: '김철수', phone: '01033334444' });
        ok(r.code === 400 && /스토어/.test(r.body.error), '스토어 예약 이름·번호는 거절(주문 정보가 정본)', r.body);
        r = await call(11, { phone: '01055556666' });
        ok(r.code === 400 && /\*/.test(r.body.error) && !d.rows.find(x => x.id === 11).phone && t.sent.length === 0, '가린 이름(박*현) 그대로 번호만 넣으면 = 저장·발송 막음', r.body);
        r = await call(11, { name: '박*현' });
        ok(r.code === 400, '이름에 * 넣어도 막음');
        r = await call(11, { name: '박지현', phone: '010-123' });
        ok(r.code === 400 && /10~11자리/.test(r.body.error), '번호 꼴 틀리면 거절', r.body);
        r = await call(11, { name: '박지현', phone: '010-5555-6666' });
        const b11 = d.rows.find(x => x.id === 11);
        ok(r.code === 200 && b11.name === '박지현' && b11.phone === '01055556666' && b11.contact_at && b11.contact_by === '직원', '이름·번호 저장 · contact_at·contact_by 기록', { name: b11.name, phone: b11.phone, by: b11.contact_by });
        ok(r.body.sent === 'sent' && t.sent.length === 1 && t.sent[0].alim && t.sent[0].tplCode === 'UM_6987' && t.sent[0].receiver === '01055556666' && /박지현님/.test(t.sent[0].message) && /체험 2명 · 입장 1명/.test(t.sent[0].message), '그 자리에서 접수 알림톡 1통(UM_6987 · 이름·인원 채움)', { sent: r.body.sent, n: t.sent.length });
        ok(t.sent[0].failoverMessage && !/자동 구매확정/.test(t.sent[0].failoverMessage) && /예약이 확정되었습니다/.test(t.sent[0].failoverMessage), '대체 문자(실패 때) = 플레이스용(스토어 전용 「자동 구매확정」 줄 없음)');
        ok(b11.sms_recv_at === 'now' && r.body.item, '발송 표시 = sms_recv_at · 응답에 줄');
        const au = t.audits.find(a => a.action === 'experience_edit' && a.targetId === 11);
        ok(au && au.changes.after.phone === '…6666' && !JSON.stringify(au.changes).includes('01055556666'), '감사 기록엔 번호 끝 4자리만', au && au.changes.after);
        // 타이머가 같은 건을 또 집지 않음 · 같은 번호로 다시 저장 = 다시 안 보냄
        await t.M.collectSms();
        const to11 = () => t.sent.filter(x => x.receiver === '01055556666').length;
        ok(to11() === 1, '5분 타이머 = 이미 보낸 접수 안 보냄(겹침 0 · 같은 틱의 스토어 건은 종전대로)', t.sent.map(x => x.receiver));
        r = await call(11, { phone: '01055556666' });
        ok(r.code === 200 && r.body.sent === null && to11() === 1, '같은 번호 다시 저장 = 다시 안 보냄');
        // 메일이 다시 와도 사람이 넣은 이름·번호 유지
        const before = { ...b11 };   // savePlace 의 UPDATE(메일 이름 = 가린 이름 · 번호 없음)를 그대로 흉내
        await t.db.pool.query("UPDATE experience_bookings SET status=$2, name=CASE WHEN contact_at IS NOT NULL THEN name ELSE COALESCE($3,name) END, phone=CASE WHEN contact_at IS NOT NULL THEN phone ELSE COALESCE($4,phone) END, visit_date=$5", [11, 'confirmed', '박*현', null, before.visit_date, before.visit_time, true]);
        ok(b11.name === '박지현' && b11.phone === '01055556666', '메일 재수집 꼴(가린 이름) = 사람이 넣은 이름·번호 유지');
        const src = require('fs').readFileSync(path.join(__dirname, '..', 'experience.js'), 'utf8');
        ok(/name=CASE WHEN contact_at IS NOT NULL THEN name ELSE COALESCE\(\$3,name\) END, phone=CASE WHEN contact_at IS NOT NULL THEN phone ELSE COALESCE\(\$4,phone\) END/.test(src), 'savePlace UPDATE 가 그 꼴(실코드)');
        ok(/sms_eve_at = CASE WHEN visit_date IS DISTINCT FROM \$5::date THEN NULL ELSE sms_eve_at END/.test(src), '메일 「변경」으로 날짜가 바뀌면 전날 문자 다시(sms_eve_at 비움 · 실코드)');
        // 사람이 안 넣은 플레이스 건 = 문자 대상 아님 · 넣은 건 = 전날 문자 대상
        const t2 = mk(); const d2 = t2.db.S;
        d2.cfg.experience_notify = { enabled: true, daily_cap: 30, recv_from: '00:00', recv_to: '24:00', eve_from: '00:00', eve_to: '24:00' };
        d2.rows.push(place(21, { name: '이민수', phone: '01077778888' }), place(22, { name: '최유리', phone: '01099990000', contact_at: Date.now(), visit_date: kstDay(1), sms_recv_at: 'old' }));
        await t2.M.collectSms();
        ok(!t2.sent.some(x => x.receiver === '01077778888'), '메일에서 온 번호라도 사람이 안 넣은 플레이스 건 = 안 보냄');
        ok(t2.sent.some(x => x.receiver === '01099990000' && /내일/.test(x.message) && !/자동 구매확정/.test(x.message)), '사람이 번호를 넣은 플레이스 건 = 전날 「내일 뵙겠습니다」 대상(⑦)', t2.sent.map(x => x.receiver));
        // 조건 밖 = 보내지 않고 사유(타이머가 나중에)
        const t3 = mk(); const d3 = t3.db.S;
        d3.cfg.experience_notify = { enabled: true, daily_cap: 1, recv_from: '00:00', recv_to: '24:00' }; d3.sentToday = 1;
        d3.rows.push(place(31, { name: '정하늘' }));
        const r3 = res(); await t3.app.routes[PATCH]({ params: { id: '31' }, body: { phone: '01012121212' }, user: { name: '직원' } }, r3);
        ok(r3.code === 200 && /^later:하루 상한/.test(r3.body.sent) && t3.sent.length === 0, '하루 상한이면 저장만 · 사유 「하루 상한」(나중에)', r3.body.sent);
        d3.cfg.experience_notify.enabled = false; d3.rows.push(place(32, { name: '한별' }));
        const r4 = res(); await t3.app.routes[PATCH]({ params: { id: '32' }, body: { phone: '01034343434' }, user: { name: '직원' } }, r4);
        ok(r4.code === 200 && r4.body.sent === 'later:손님 문자 꺼짐' && t3.sent.length === 0, '손님 문자 꺼짐 = 안 보냄', r4.body.sent);
        // 수신거부 번호
        const t5 = mk(); const d5 = t5.db.S; d5.cfg.experience_notify = { enabled: true, daily_cap: 30, recv_from: '00:00', recv_to: '24:00' }; d5.refuse.add('01056565656');
        d5.rows.push(place(51, { name: '오수아' }));
        const r5 = res(); await t5.app.routes[PATCH]({ params: { id: '51' }, body: { phone: '01056565656' }, user: { name: '직원' } }, r5);
        ok(r5.code === 200 && r5.body.sent === 'refused' && t5.sent.length === 0, '수신거부 번호 = 안 보냄(refused)', r5.body.sent);
        // 문구 함수
        const tp = T.tplFor('a\n예약일이 멀어 네이버에서 자동 구매확정이 되어도 그대로 두시면 됩니다.\nb', { source: 'place' });
        ok(tp === 'a\nb' && T.tplFor('x\n자동 구매확정\ny', { source: 'store' }) === 'x\n자동 구매확정\ny', 'tplFor = 플레이스만 스토어 전용 줄 뺌');
        // 번호 미입력 알약 집계(실코드 SQL)
        ok(/source IN \('place','manual'\) AND status = 'confirmed' AND \(phone IS NULL OR length\(phone\) < 10\) AND \(visit_date IS NULL OR visit_date >= \$1::date\)\)::int AS place_no_phone/.test(src), 'summary 「번호 미입력」 집계 = 확정·플레이스·수기(#808)·번호 없음·오늘 이후');
    }

    console.log('\n⑨ #808 수기(현금) 예약 추가 · 나간 길 기록 · 수기 수정 범위');
    {
        const POST = 'POST /api/agent-office/experience', PATCH = 'PATCH /api/agent-office/experience/:id';
        const fut = kstDay(7);
        const t = mk(); const d = t.db.S;
        d.cfg.experience_notify = { enabled: true, daily_cap: 30, recv_from: '00:00', recv_to: '24:00', eve_from: '00:00', eve_to: '24:00', alimtalk: { enabled: true, confirm_tpl: 'UM_6987', remind_tpl: 'UM_6988' } };
        const add = async (body) => { const r = res(); await t.app.routes[POST]({ body, user: { id: 7, name: '직원' } }, r); return r; };
        ok(!!t.app.routes[POST], '수기 추가 라우트 있음');
        let r = await add({ visit_date: '2026-11-31', visit_time: '11:00', name: '김현금', exp_count: 1 });
        ok(r.code === 400, '없는 날짜 거절', r.body);
        r = await add({ visit_date: fut, visit_time: '', name: '김현금', exp_count: 1 });
        ok(r.code === 400 && /시간/.test(r.body.error), '시간 없으면 거절', r.body);
        r = await add({ visit_date: fut, visit_time: '11:00', name: '김*금', exp_count: 1 });
        ok(r.code === 400 && /\*/.test(r.body.error), '이름 * 거절');
        r = await add({ visit_date: fut, visit_time: '11:00', name: '김현금', phone: '010-12', exp_count: 1 });
        ok(r.code === 400 && /10~11자리/.test(r.body.error), '번호 꼴 틀리면 거절');
        r = await add({ visit_date: fut, visit_time: '11:00', name: '김현금', exp_count: 0, entry_count: 0, infant_count: 0 });
        ok(r.code === 400 && /1명/.test(r.body.error), '인원 0 거절');
        r = await add({ visit_date: fut, visit_time: '오후 1시 30분', name: '김현금', phone: '010 2222 3333', exp_count: 2, entry_count: 1, infant_count: 1, amount: 46000, memo: '현금' });
        const m = d.rows.find(x => x.source === 'manual');
        ok(r.code === 200 && m && m.ext_key === 'manual:' + m.id && m.order_no === 'M' + m.id && m.visit_time === '13:30' && m.phone === '01022223333' && m.amount === 46000 && m.contact_by === '직원' && m.status === 'confirmed', '수기 저장 = manual:<id> · M<id> · 시간 13:30 · 번호 숫자만 · 금액 · 저장한 사람', m && { k: m.ext_key, no: m.order_no, t: m.visit_time, ph: m.phone });
        ok(r.body.sent === 'sent' && t.sent.length === 1 && t.sent[0].tplCode === 'UM_6987' && /김현금님/.test(t.sent[0].message) && /체험 2명 · 입장 1명 · 유아 1명/.test(t.sent[0].message) && !/자동 구매확정/.test(t.sent[0].failoverMessage), '추가하는 그 자리에서 접수 알림톡(이름·인원) · 대체 문자에 스토어 줄 없음', r.body.sent);
        ok(m.sms_recv_via === 'alimtalk' && m.sms_recv_at === 'now', '나간 길 기록 = sms_recv_via alimtalk', m.sms_recv_via);
        ok(t.audits.some(a => a.action === 'experience_manual_add' && a.changes.after.phone === '…3333'), 'audit experience_manual_add(번호 끝 4자리)');
        // 번호 없는 수기 = 저장만 · 전날 문자 대상(번호 넣은 수기)
        r = await add({ visit_date: kstDay(1), visit_time: '10:00', name: '이현금', exp_count: 1 });
        ok(r.code === 200 && r.body.sent === null && t.sent.length === 1, '번호 없는 수기 = 저장만(보내지 않음)');
        const t2 = mk(); const d2 = t2.db.S;
        d2.cfg.experience_notify = { enabled: true, daily_cap: 30, recv_from: '00:00', recv_to: '24:00', eve_from: '00:00', eve_to: '24:00' };
        d2.rows.push({ id: 61, source: 'manual', ext_key: 'manual:61', order_no: 'M61', status: 'confirmed', date_ok: true, visit_date: kstDay(1), visit_time: '11:00', exp_count: 1, entry_count: 0, infant_count: 0, name: '박현금', phone: '01044445555', contact_at: Date.now(), sms_recv_at: 'old', sms_recv_tries: 1, sms_eve_tries: 0 });
        await t2.M.collectSms();
        const ev = t2.sent.find(x => x.receiver === '01044445555');
        ok(ev && /내일/.test(ev.message) && d2.rows[0].sms_eve_via === 'lms', '수기 = 전날 「내일 뵙겠습니다」 대상 · 나간 길 lms 기록(알림톡 꺼짐)', d2.rows[0].sms_eve_via);
        // 수정: 금액은 수기만 · 이름·번호 수기 가능 · 지우기(취소)·되돌리기
        const call = async (id, body) => { const q = res(); await t.app.routes[PATCH]({ params: { id: String(id) }, body, user: { id: 7, name: '직원' } }, q); return q; };
        d.rows.push({ id: 90, source: 'place', ext_key: 'place:90', status: 'confirmed', date_ok: true, visit_date: fut, visit_time: '11:00', exp_count: 1, entry_count: 0, infant_count: 0, name: '정플레', phone: null });
        r = await call(90, { amount: 1000 });
        ok(r.code === 400 && /수기/.test(r.body.error), '금액은 수기만(플레이스 400)');
        r = await call(m.id, { amount: 50000 });
        ok(r.code === 200 && /amount=\$\d/.test(d.lastPatch.sql) && d.lastPatch.args.includes(50000), '수기 금액 수정');
        r = await call(m.id, { name: '김현금(현장)', phone: '01066667777' });
        ok(r.code === 200 && r.body.sent === 'skip:이미 보냄', '수기 이름·번호 수정 가능 · 이미 보낸 접수는 다시 안 보냄(skip)', r.body.sent);
        r = await call(m.id, { status: 'canceled' });
        ok(r.code === 200 && /status=\$\d/.test(d.lastPatch.sql) && d.lastPatch.args.includes('canceled'), '수기 지우기 = 취소 표시(soft)');
        // 수집이 수기를 안 건드림: 스토어·메일 길은 ext_key store:/place: 로만 찾음
        const src = require('fs').readFileSync(path.join(__dirname, '..', 'experience.js'), 'utf8');
        ok(/const key = 'place:' \+ p\.no;/.test(src) && /WHERE source='store' AND items/.test(src) && !/source='manual'.*UPDATE|UPDATE[^`]*source='manual'/.test(src), '수집 = place:/store: 열쇠로만 · 수기 줄을 고치는 수집 문장 0');
        // 번호 붙이기(두 번째 UPDATE) 실패 = 임시 줄 지움 · 500
        const t3 = mk(); t3.db.S.failExtKey = true;
        const r3 = res(); await t3.app.routes[POST]({ body: { visit_date: fut, visit_time: '11:00', name: '최현금', exp_count: 1 }, user: { name: '직원' } }, r3);
        ok(r3.code === 500 && t3.db.S.deleted === 1 && !t3.db.S.rows.some(x => x.source === 'manual'), '번호 붙이기 실패 = 임시 줄 지움(반쪽 줄 0) · 500', { code: r3.code, del: t3.db.S.deleted });
        ok(/source IN \('place','manual'\) AND contact_at IS NOT NULL/.test(src) && /s: r\.source === 'store' \? '스토어' : r\.source === 'manual' \? '수기' : '플레이스'/.test(src), '문자 대상에 수기 · 엑셀 출처 「수기」');
    }

    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });

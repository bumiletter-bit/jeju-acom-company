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
        if (/jsonb_object_keys\(items\)/.test(s)) return { rows: S.rows.filter(r => r.source === 'store').flatMap(r => Object.keys(r.items || {})).filter(k => a[0].includes(k)).map(k => ({ k })) };
        if (/FROM kakao_notify_log k WHERE k.status='experience'/.test(s)) return { rows: S.kakaoExp.filter(k => !S.rows.some(r => r.source === 'store' && r.items && k in r.items)).map(order_key => ({ order_key })) };
        if (/^SELECT \* FROM experience_bookings WHERE ext_key=\$1/.test(s)) { const r = byKey(a[0]); return { rows: r ? [JSON.parse(JSON.stringify(r))] : [] }; }
        if (/^SELECT date_ok FROM experience_bookings WHERE id=\$1/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ date_ok: r.date_ok }] : [] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, amount, status, option_text, items, ordered_at\)/.test(s)) {
            if (byKey(a[0])) return { rows: [] };
            const r = { id: S.nextId++, source: 'store', ext_key: a[0], order_no: a[1], name: a[2], phone: a[3], visit_date: a[4], visit_time: a[5], date_ok: a[6], date_why: a[7], exp_count: a[8], entry_count: a[9], infant_count: 0, amount: a[10], status: a[11], option_text: a[12], items: JSON.parse(a[13]), date_fixed: false, sms_recv_at: null, sms_eve_at: null };
            S.rows.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET name=\$2, phone=\$3/.test(s)) { const r = byId(a[0]); Object.assign(r, { name: a[1], phone: a[2], visit_date: a[3], visit_time: a[4], date_ok: a[5], date_why: a[6], exp_count: a[7], entry_count: a[8], amount: a[9], status: a[10], option_text: a[11], items: JSON.parse(a[12]) }); return { rows: [] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, status, date_ok, date_why, raw\) VALUES \('place'/.test(s)) { if (byKey(a[0])) return { rows: [] }; const r = { id: S.nextId++, source: 'place', ext_key: a[0], status: 'unknown', date_ok: false, raw: a[1] }; S.rows.push(r); return { rows: [{ id: r.id }] }; }
        if (/^INSERT INTO experience_bookings \(source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, infant_count, amount, status, raw\)/.test(s)) {
            if (byKey(a[0])) return { rows: [] };
            const r = { id: S.nextId++, source: 'place', ext_key: a[0], order_no: a[1], name: a[2], phone: a[3], visit_date: a[4], visit_time: a[5], date_ok: a[6], date_why: a[7], exp_count: a[8], entry_count: a[9], infant_count: a[10], amount: a[11], status: a[12], raw: a[13], date_fixed: false };
            S.rows.push(r); return { rows: [{ id: r.id }] };
        }
        if (/^UPDATE experience_bookings SET status=\$2, name=COALESCE/.test(s)) { const r = byId(a[0]); Object.assign(r, { status: a[1], visit_date: a[4], visit_time: a[5], date_ok: a[6] }); return { rows: [] }; }
        if (/^SELECT 1 FROM experience_mail_seen/.test(s)) return { rows: S.seen.has(a[0]) ? [{}] : [] };
        if (/^INSERT INTO experience_mail_seen/.test(s)) { S.seen.add(a[0]); return { rows: [] }; }
        // 오늘 보낸 것 = 실제로 보낸 칸(sms_recv_at · sms_eve_at)만 — 'now' 또는 S.sentToday(미리 쓴 수)
        if (/sms_recv_at \+ interval '9 hours'/.test(s)) return { rows: [{ n: (S.sentToday || 0) + S.rows.filter(r => r.sms_recv_at === 'now').length + S.rows.filter(r => r.sms_eve_at === 'now').length }] };
        const fresh = (t) => !t || Date.now() - t > 30 * 60000;   // 30분 넘은 잡기
        if (/^SELECT \* FROM experience_bookings WHERE source='store' AND status='confirmed'/.test(s)) {
            const base = S.rows.filter(r => r.source === 'store' && r.status === 'confirmed' && r.date_ok && r.phone && r.phone.length >= 10 && r.visit_date >= a[0] && !r.sms_skip);
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
        if (/^UPDATE experience_bookings SET sms_(recv|eve)_at=NOW\(\)/.test(s)) { const r = byId(a[0]); const col = /sms_recv_at/.test(s) ? 'sms_recv_at' : 'sms_eve_at'; r[col] = 'now'; r.sms_error = a[1] || null; return { rows: [] }; }
        if (/^UPDATE experience_bookings SET sms_error=\$2/.test(s)) { byId(a[0]).sms_error = a[1]; return { rows: [] }; }
        if (/COUNT\(\*\) FILTER \(WHERE visit_date = \$1::date AND status IN/.test(s)) {
            const live = S.rows; const t = a[0], tm = a[1];
            return { rows: [{ today: live.filter(r => r.visit_date === t && ['confirmed', 'visited'].includes(r.status)).length, tomorrow: live.filter(r => r.visit_date === tm && r.status === 'confirmed').length, today_people: 0, tomorrow_people: 0, need_check: live.filter(r => ['confirmed', 'unknown'].includes(r.status) && !r.date_ok && (!r.visit_date || r.visit_date >= t)).length }] };
        }
        if (/^SELECT id, to_char\(visit_date/.test(s)) { const r = byId(a[0]); return { rows: r ? [{ ...r }] : [] }; }
        if (/^UPDATE experience_bookings SET .* WHERE id=\$1$/.test(s) && !/sms_/.test(s.split('WHERE')[0].slice(0, 30))) { S.lastPatch = { sql: s, args: a }; return { rows: [] }; }
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
        naverFetchChanges: async () => db.S.changes || [], naverCall: async (req) => ({ data: { data: (db.S.detail || []).filter(it => req.body.productOrderIds.includes(it.productOrder.productOrderId)) } }),
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
        d.changes = [{ productOrderId: 'P3', claimType: 'CANCEL', claimStatus: 'CANCEL_DONE' }];
        d.detail = d.detail.map(x => x.productOrder.productOrderId === 'P3' ? po('P3', 'O2', '7673020911', OPT('내가 직접 딴 노지귤 2kg', '11', '십오', '11:00'), 3, { productOrderStatus: 'CANCELED', claimType: 'CANCEL', claimStatus: 'CANCEL_DONE' }) : x);
        await t.M.collectStore();
        ok(o2.status === 'canceled', '발주확인 전 취소 = 상태 취소', o2.status);
        const t2 = mk(); t2.db.S.changes = [];
        ok(await t2.M.collectStore() === '체험 주문 변경 0', '변경 없으면 상세조회 0');
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
        ok(/내일 \d+월 \d+일 13:30 방문 예약/.test(t.sent[1].message) && /체험장 010-6259-8420/.test(t.sent[1].message), '전날 문구');
        const before = t.sent.length; await t.M.collectSms();
        ok(t.sent.length === before, '이미 보낸 것은 다시 안 보냄');
        const t2 = mk(); t2.db.S.rows.push(row(1), row(2), row(3)); t2.db.S.cfg.experience_notify = { enabled: true, daily_cap: 5, recv_from: '00:00', recv_to: '23:59' }; t2.db.S.sentToday = 4;
        await t2.M.collectSms();
        ok(t2.sent.length === 1, '하루 상한(5 중 4 씀) = 1통만', t2.sent.length);
        // 알림톡(총괄 10/20 · UM_6808 접수 · UM_6789 전날) — 켜면 알림톡 + 실패 시 LMS(failover = 문자 전문) · 꺼짐(기본)·원문 없음·변수 빈칸 = LMS 바로
        ok(t.sent.every(x => !x.alim), '알림톡 설정 꺼짐(기본) = LMS 만');
        const t3 = mk(); t3.db.S.rows.push(row(1, { visit_date: '2026-11-30', visit_time: '12:30' }), row(2, { visit_date: tmr, sms_recv_at: 'x', name: '' }));
        t3.db.S.cfg.experience_notify = { enabled: true, daily_cap: 40, recv_from: '00:00', recv_to: '23:59', eve_from: '00:00', eve_to: '23:59', alimtalk: { enabled: true } };
        await t3.M.collectSms();
        const a1 = t3.sent.find(x => x.alim), l2 = t3.sent.find(x => !x.alim);
        ok(a1 && a1.tplCode === 'UM_6808' && a1.message === T.EXP_ALIMTALK.UM_6808.content.replace('#{고객명}', '홍길동').replace('#{방문일시}', '11월 30일(월) 12:30').replace('#{인원}', '체험 2명 · 입장 1명'), '접수 알림톡 = UM_6808 원문에 변수만(방문일시 「11월 30일(월) 12:30」 · 인원 「체험 2명 · 입장 1명」)', a1 && a1.tplCode);
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

    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });

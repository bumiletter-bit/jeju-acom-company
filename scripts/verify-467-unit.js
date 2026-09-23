// #467 검증(단위): 룰렛 쿠폰 자동 발급·발급/만료 안내 — server.js 실코드 블록을 잘라 실행(카페24·DB·알림톡 스텁 — 실DB·실발급·실발송 0)
//   실행: node scripts/verify-467-unit.js
const fs = require('fs');
const path = require('path');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const ROULETTE_COUPON = {');
const b = src.indexOf("app.post('/api/agent-office/reward-grants/:id/grant'");
if (a < 0 || b < 0 || b < a) { console.error('블록 추출 실패'); process.exit(1); }
let block = src.slice(a, b).replace('[6000, 30000, 60000, 120000]', '[5, 5, 5, 5]');   // 검산 대기만 단축(로직 동일)
ok('server.js 블록 추출', /async function rouletteCouponIssue/.test(block) && /async function collectCouponExpireNotify/.test(block) && /\[5, 5, 5, 5\]/.test(block));

const kakaoNotify = require('../kakao-notify.js');

// ── 스텁 상태
const S = { grants: [], members: [], logs: [], audits: [], telegram: [], held: {}, issues: {}, orders: {}, sent: [], issueCalls: [], heldDelay: {}, live: false, tplIssue: '', tplExpire: '' };
const def5 = { coupon_no: '6086230051600000967', coupon_name: '5% 할인쿠폰(룰렛)', benefit_percentage: '5.0', available_period_type: 'R', available_day_from_issued: 30, deleted: 'F' };
const def10 = { coupon_no: '6086272594000000984', coupon_name: '10% 할인쿠폰(룰렛)', benefit_percentage: '10.0', available_period_type: 'R', available_day_from_issued: 30, deleted: 'F' };
let defs = { [def5.coupon_no]: def5, [def10.coupon_no]: def10 };
let issueSeq = 100;
const cafe24 = {
    async apiGet(p, q) {
        let m;
        if (p === '/api/v2/admin/coupons') return { coupons: defs[q.coupon_no] ? [defs[q.coupon_no]] : [] };
        if ((m = p.match(/^\/api\/v2\/admin\/customers\/(.+)\/coupons$/))) {
            const mid = decodeURIComponent(m[1]);
            const d = S.heldDelay[mid] || 0; if (d > 0) { S.heldDelay[mid] = d - 1; return { coupons: (S.held[mid] || []).filter(c => !c._pending) }; }
            (S.held[mid] || []).forEach(c => { delete c._pending; });
            return { coupons: S.held[mid] || [] };
        }
        if ((m = p.match(/^\/api\/v2\/admin\/coupons\/(\d+)\/issues$/))) { const l = S.issues[m[1]] || []; return { issues: l.slice(q.offset || 0, (q.offset || 0) + (q.limit || 100)) }; }
        if (p === '/api/v2/admin/orders') return { orders: S.orders[q.member_id] || [] };
        throw new Error('stub: 미지원 GET ' + p);
    },
    async apiReq(method, p, body) {
        const m = p.match(/^\/api\/v2\/admin\/coupons\/(\d+)\/issues$/);
        if (method !== 'POST' || !m) throw new Error('stub: 미지원 ' + method + ' ' + p);
        const req = body.request; S.issueCalls.push({ no: m[1], ...req });
        if (req.issued_member_scope !== 'M' || !req.member_id) throw new Error('stub: M 스코프·member_id 필수');
        if (S.failIssue) return { issues: { count: {} } };
        const iss = { issue_no: String(++issueSeq), coupon_no: m[1], member_id: req.member_id, issued_date: new Date().toISOString(), used_coupon: 'F', used_date: null, related_order_id: null, expiration_date: new Date(Date.now() + 30 * 86400000).toISOString() };
        (S.issues[m[1]] = S.issues[m[1]] || []).push(iss);
        if (!S.noAppear) (S.held[req.member_id] = S.held[req.member_id] || []).push({ coupon_no: m[1], issue_no: iss.issue_no, issued_date: iss.issued_date, _pending: true });
        S.heldDelay[req.member_id] = S.delayN || 0;
        return { issues: { count: { [m[1]]: 1 }, shop_no: 1 } };
    },
};
const pool = {
    async query(sql, params = []) {
        const q = sql.replace(/\s+/g, ' ').trim();
        const g = (id) => S.grants.find(x => x.id === Number(id));
        const withM = (x) => { const mm = S.members.find(y => y.id === x.member_id) || {}; return { ...x, member_key: mm.member_key, nickname: mm.nickname }; };
        if (/^SELECT g\.\*, m\.member_key(, m\.nickname)? FROM reward_grants g JOIN mall_members m ON m\.id=g\.member_id WHERE g\.id=\$1/.test(q)) { const x = g(params[0]); return { rows: x ? [withM(x)] : [] }; }
        if (/^SELECT g\.\*, m\.member_key FROM reward_grants g JOIN mall_members m ON m\.id=g\.member_id WHERE g\.status='granted'/.test(q)) return { rows: S.grants.filter(x => x.status === 'granted' && /^coupon/.test(x.kind) && x.issue_no).sort((p, r) => p.id - r.id).map(withM) };
        if (/^UPDATE reward_grants SET status='granted'/.test(q)) { const x = g(params[0]); if (x && x.status === 'pending') Object.assign(x, { status: 'granted', granted_at: new Date(), granted_by: params[1], coupon_no: params[2], issue_no: params[3], issued_at: params[4], expires_at: params[5], grant_error: null }); return { rowCount: 1 }; }
        if (/^UPDATE reward_grants SET grant_error=\$2/.test(q)) { const x = g(params[0]); if (x && x.status === 'pending') x.grant_error = params[1]; return {}; }
        if (/^UPDATE reward_grants SET notify_(issue|expire)_status='failed'/.test(q)) { const x = g(params[0]); const k = q.match(/notify_(issue|expire)/)[1]; if (x) { x['notify_' + k + '_status'] = 'failed'; x['notify_' + k + '_at'] = new Date(); } return {}; }
        if (/^UPDATE reward_grants SET notify_(issue|expire)_status=\$2, notify_(issue|expire)_at=NOW\(\)/.test(q)) { const x = g(params[0]); const k = q.match(/notify_(issue|expire)_status/)[1]; if (x) { x['notify_' + k + '_status'] = params[1]; x['notify_' + k + '_at'] = new Date(); } return {}; }
        if (/^UPDATE reward_grants SET expires_at=\$2/.test(q)) { const x = g(params[0]); if (x) x.expires_at = params[1]; return {}; }
        if (/^UPDATE reward_grants SET used_at=\$2, used_order_id=\$3/.test(q)) { const x = g(params[0]); if (x) { x.used_at = params[1]; x.used_order_id = params[2]; } return {}; }
        if (/^SELECT COUNT\(\*\)::int AS n FROM reward_grants WHERE status='pending'/.test(q)) return { rows: [{ n: S.grants.filter(x => x.status === 'pending').length }] };
        if (/^SELECT id, status FROM kakao_notify_log WHERE order_key=\$1/.test(q)) { const l = S.logs.find(x => x.order_key === params[0]); return { rows: l ? [{ id: l.id, status: l.status }] : [] }; }
        if (/^UPDATE kakao_notify_log SET message=\$2/.test(q)) { const l = S.logs.find(x => x.order_key === params[0]); if (l) Object.assign(l, { message: params[1], mode: params[2], status: params[3], error: params[4], receiver_masked: params[5], updated: true }); return {}; }
        if (/^INSERT INTO kakao_notify_log/.test(q)) { if (S.logs.some(x => x.order_key === params[0])) return { rowCount: 0 }; S.logs.push({ id: S.logs.length + 1, order_key: params[0], product_name: params[1], receiver_masked: params[2], message: params[3], mode: params[4], status: params[5], error: params[6], order_at: params[7] }); return { rowCount: 1 }; }
        throw new Error('stub: 미지원 SQL — ' + q.slice(0, 90));
    },
};
const ctx = {
    pool, cafe24, kakaoNotify: { ...kakaoNotify, couponTplCode: (k) => k === 'expire' ? S.tplExpire : S.tplIssue, sendAlimtalk: async (o) => { S.sent.push(o); return S.sendFail ? { mode: 'real', status: 'failed', error: 'stub-fail' } : { mode: 'real', status: 'sent' }; } },
    writeAudit: async (x) => { S.audits.push(x); }, notifyTelegram: async (t) => { S.telegram.push(t); }, notifyChannelLive: async (ch) => ch === 'coupon' && S.live,
    _telCache: new Map(), isBadTel: (v) => { const d = String(v || '').replace(/[^0-9]/g, ''); return d.length >= 8 && !/^01/.test(d); }, process, console,
};
const fn = new Function(...Object.keys(ctx), block + '\nreturn { rouletteCouponIssue, rouletteCouponNotify, rouletteAutoGrant, rouletteOnRewardGrant, collectCouponExpireNotify, rouletteMemberTel, ROULETTE_COUPON };');
const R = fn(...Object.values(ctx));

function reset() { Object.assign(S, { grants: [], members: [], logs: [], audits: [], telegram: [], held: {}, issues: {}, orders: {}, sent: [], issueCalls: [], heldDelay: {}, live: false, tplIssue: '', tplExpire: '', failIssue: false, noAppear: false, delayN: 0, sendFail: false }); defs = { [def5.coupon_no]: def5, [def10.coupon_no]: def10 }; }
function member(id, key, nick) { S.members.push({ id, member_key: key, nickname: nick || null }); S.orders[key] = [{ order_id: '20260910-0000001', order_date: '2026-09-10T10:00:00+09:00', buyer: { name: '김제주', cellphone: '010-1234-5678' } }, { order_id: '20260920-0000009', order_date: '2026-09-20T16:00:00+09:00', buyer: { name: '김제주', cellphone: '010-9999-0000' } }]; }
function grant(id, memberId, kind, extra) { const x = { id, member_id: memberId, kind, amount: 1, status: 'pending', created_at: new Date('2026-09-22T08:36:27Z'), idem_key: 'spin-' + kind + ':' + id, ...extra }; S.grants.push(x); return x; }

(async () => {
    // ① 정상 자동 발급(첫 당첨 · 카페24 조회 지연 1회) + 발급안내 dry(검수중) + 텔레그램 문구
    reset(); member(1, '3354900610@n', '귤'); grant(7, 1, 'coupon10'); S.delayN = 1;
    await R.rouletteOnRewardGrant({ grantId: 7, member: S.members[0], prize: { key: 'coupon10', label: '10% 할인 쿠폰' } });
    const g7 = S.grants[0];
    ok('① 발급 → granted·쿠폰 메타', g7.status === 'granted' && g7.coupon_no === def10.coupon_no && /^\d+$/.test(g7.issue_no) && !!g7.expires_at && /자동/.test(g7.granted_by), `issue ${g7.issue_no} · exp ${String(g7.expires_at).slice(0, 10)}`);
    ok('① 발급 호출 = M·회원 1명·allow_duplication F·SMS F', S.issueCalls.length === 1 && S.issueCalls[0].issued_member_scope === 'M' && S.issueCalls[0].member_id === '3354900610@n' && S.issueCalls[0].allow_duplication === 'F' && S.issueCalls[0].send_sms_for_issue === 'F');
    ok('① audit 기록', S.audits.length === 1 && S.audits[0].changes.after.issue_no === g7.issue_no && /자동 발급/.test(S.audits[0].changes.note));
    const l7 = S.logs.find(x => x.order_key === 'coupon:7');
    ok('① 발급안내 = dry(검수중) 이력 coupon:7 · 최신 주문 번호 마스킹 · 실발송 0', !!l7 && l7.status === 'dry-run' && l7.product_name === '룰렛 당첨 쿠폰 발급 안내' && l7.receiver_masked !== '01099990000' && /9999|0000/.test(l7.receiver_masked) === false || (!!l7 && l7.status === 'dry-run' && S.sent.length === 0), l7 && l7.receiver_masked);
    ok('① 문면 = 고객명·쿠폰명·혜택·만료일(점 표기)·근거 문구·미치환 변수 0', !!l7 && /김제주님/.test(l7.message) && /10% 할인 쿠폰이 발급/.test(l7.message) && /10% 할인/.test(l7.message) && /사용기한: \d{4}\.\d{2}\.\d{2}까지/.test(l7.message) && /직접 참여하신 룰렛 이벤트 당첨/.test(l7.message) && !/#\{/.test(l7.message));
    ok('① 지급 행 notify_issue_status=dry-run', g7.notify_issue_status === 'dry-run');
    ok('① 텔레그램 = 자동 발급 완료·검수중 표기', S.telegram.length === 1 && /자동 발급 완료/.test(S.telegram[0]) && /검수중/.test(S.telegram[0]) && /3354900610@n/.test(S.telegram[0]), S.telegram[0] && S.telegram[0].split('\n')[0]);

    // ② 재당첨(보유 1장) → allow_duplication T · 보유 2장 검산
    reset(); member(2, '3575099520@n'); S.held['3575099520@n'] = [{ coupon_no: def5.coupon_no, issue_no: '1', issued_date: '2026-09-21T21:58:27+09:00' }]; grant(6, 2, 'coupon5');
    const r2 = await R.rouletteAutoGrant(6);
    ok('② 재당첨 = allow_duplication T · n→n+1(1→2)', r2.ok && S.issueCalls[0].allow_duplication === 'T' && S.grants[0].status === 'granted' && S.grants[0].issue_no !== '1' && /보유 1→2장/.test(S.audits[0].changes.note), S.audits[0] && S.audits[0].changes.note);

    // ③ 검산 실패(발급 응답 ok인데 보유에 안 나타남) → pending 유지·grant_error·텔레그램 수동 문구
    reset(); member(3, 'x@n'); grant(8, 3, 'coupon10'); S.noAppear = true;
    await R.rouletteOnRewardGrant({ grantId: 8, member: S.members[0], prize: { key: 'coupon10', label: '10% 할인 쿠폰' } });
    ok('③ 검산 실패 = pending 유지·grant_error·이력 0', S.grants[0].status === 'pending' && /보유 0장\(기대 1\)/.test(S.grants[0].grant_error) && S.logs.length === 0, S.grants[0].grant_error);
    ok('③ 텔레그램 = 종전 수동 문구 + 실패 사유', S.telegram.length === 1 && /카페24 관리자에서 회원ID로 찾아 발급/.test(S.telegram[0]) && /자동 발급 실패/.test(S.telegram[0]));

    // ④ 정의 불일치(할인율 다름) → 발급 호출 0
    reset(); member(4, 'y@n'); grant(9, 4, 'coupon5'); defs[def5.coupon_no] = { ...def5, benefit_percentage: '7.0' };
    const r4 = await R.rouletteAutoGrant(9);
    ok('④ 정의 불일치 = 발급 호출 0·중단', !r4.ok && /정의 이상/.test(r4.error) && S.issueCalls.length === 0 && S.grants[0].status === 'pending');

    // ⑤ 이미 granted → 무동작 / ⑥ 귤박스 = 종전 수동 문구
    reset(); member(5, 'z@n'); grant(10, 5, 'coupon10', { status: 'granted' });
    await R.rouletteOnRewardGrant({ grantId: 10, member: S.members[0], prize: { key: 'coupon10', label: '10% 할인 쿠폰' } });
    ok('⑤ 이미 지급완료 = 발급·알림·텔레그램 0', S.issueCalls.length === 0 && S.logs.length === 0 && S.telegram.length === 0);
    reset(); member(6, 'b@n'); grant(11, 6, 'box');
    await R.rouletteOnRewardGrant({ grantId: 11, member: S.members[0], prize: { key: 'box', label: '제철 귤 4.5kg' } });
    ok('⑥ 귤박스 = 종전 수동 텔레그램 문구(자동 발급 없음)', S.issueCalls.length === 0 && S.telegram.length === 1 && /카페24 관리자에서 회원ID로 찾아 발급 후/.test(S.telegram[0]) && !/자동 발급 실패/.test(S.telegram[0]) && S.grants[0].status === 'pending');

    // ⑦ live + 코드 투입 → 실발송 경로(스텁) · 이름에 * → 고객 폴백 · 연락처 없는 회원 = no-tel
    reset(); member(7, 'l@n'); S.orders['l@n'][1].buyer.name = '***'; grant(12, 7, 'coupon10'); S.live = true; S.tplIssue = 'UK_TEST1';
    const r7 = await R.rouletteAutoGrant(12);
    ok('⑦ live = sendAlimtalk 호출(코드·버튼 3개·failover)·sent 기록', r7.notify.status === 'sent' && S.sent.length === 1 && S.sent[0].tplCode === 'UK_TEST1' && S.sent[0].buttons && S.sent[0].buttons.button.length === 3 && S.sent[0].receiver === '01099990000' && S.logs[0].status === 'sent' && S.grants[0].notify_issue_status === 'sent');
    ok('⑦ 마스킹 이름(***) → 「고객님」 폴백', /고객님/.test(S.sent[0].message) && !/\*\*\*/.test(S.sent[0].message));
    reset(); member(8, 'n@n'); S.orders['n@n'] = []; grant(13, 8, 'coupon5'); S.live = true; S.tplIssue = 'UK_TEST1';
    const r8 = await R.rouletteAutoGrant(13);
    ok('⑦ 주문 연락처 없음 = no-tel(발급은 완료·발송 0)', r8.ok && S.grants[0].status === 'granted' && r8.notify.status === 'no-tel' && S.sent.length === 0);

    // ⑧ 만료 타이머: D-6 미사용 → 만료안내(dry) 1회 · 재실행 중복 0 / D-8 대기 / 사용됨 → used_at·발송 0 / 만료 지남 0 / 발급 dry → live 승격
    reset(); member(9, 'e1@n'); member(10, 'e2@n'); member(11, 'e3@n'); member(12, 'e4@n');
    const d = (days) => new Date(Date.now() + days * 86400000).toISOString();
    grant(20, 9, 'coupon10', { status: 'granted', coupon_no: def10.coupon_no, issue_no: '201', expires_at: d(6), notify_issue_status: 'dry-run' });
    grant(21, 10, 'coupon10', { status: 'granted', coupon_no: def10.coupon_no, issue_no: '202', expires_at: d(8), notify_issue_status: 'dry-run' });
    grant(22, 11, 'coupon5', { status: 'granted', coupon_no: def5.coupon_no, issue_no: '203', expires_at: d(3), notify_issue_status: 'sent' });
    grant(23, 12, 'coupon5', { status: 'granted', coupon_no: def5.coupon_no, issue_no: '204', expires_at: d(-1), notify_issue_status: 'sent' });
    S.issues[def10.coupon_no] = [{ issue_no: '201', used_coupon: 'F', expiration_date: d(6) }, { issue_no: '202', used_coupon: 'F', expiration_date: d(8) }];
    S.issues[def5.coupon_no] = [{ issue_no: '203', used_coupon: 'T', used_date: '2026-09-19T10:49:33+09:00', related_order_id: '20260919-0000010', expiration_date: d(3) }, { issue_no: '204', used_coupon: 'F', expiration_date: d(-1) }];
    const s1 = await R.collectCouponExpireNotify();
    const g20 = S.grants.find(x => x.id === 20), g21 = S.grants.find(x => x.id === 21), g22 = S.grants.find(x => x.id === 22), g23 = S.grants.find(x => x.id === 23);
    ok('⑧ D-6 미사용 = 만료안내 dry 1건(coupon-exp:20) · 남은일수 6 · 근거 문구', g20.notify_expire_status === 'dry-run' && S.logs.some(x => x.order_key === 'coupon-exp:20' && /6일 남았습니다/.test(x.message) && /사용기한 안내입니다/.test(x.message)), s1);
    ok('⑧ D-8 = 대기(발송 0) · 사용됨 = used_at·주문번호 기록·발송 0 · 만료 지남 = 발송 0', !g21.notify_expire_status && !!g22.used_at && g22.used_order_id === '20260919-0000010' && !g22.notify_expire_status && !g23.notify_expire_status && S.logs.length === 1);
    const s2 = await R.collectCouponExpireNotify();
    ok('⑧ 재실행 = 중복 발송 0(이력 1건 유지)', S.logs.length === 1 && /만료안내 0/.test(s2), s2);
    // live 전환 + 코드 투입 → dry였던 발급안내(20·21) 승격 실발송 + 만료안내(20) 실발송(같은 이력 행 UPDATE)
    S.live = true; S.tplIssue = 'UK_I'; S.tplExpire = 'UK_E';
    const s3 = await R.collectCouponExpireNotify();
    const sentKeys = S.sent.map(x => x.subject);
    ok('⑧ live 승격 = 발급안내 2건(20·21) + 만료안내 1건(20) 실발송 · 이력 행 수 3(UPDATE·중복 INSERT 0)', S.sent.length === 3 && sentKeys.filter(x => /발급/.test(x)).length === 2 && sentKeys.filter(x => /만료/.test(x)).length === 1 && S.logs.length === 3 && S.logs.find(x => x.order_key === 'coupon-exp:20').status === 'sent' && S.logs.find(x => x.order_key === 'coupon-exp:20').updated === true && g20.notify_issue_status === 'sent' && g21.notify_issue_status === 'sent' && g20.notify_expire_status === 'sent', s3);
    const s4 = await R.collectCouponExpireNotify();
    ok('⑧ live 재실행 = 추가 발송 0', S.sent.length === 3 && /만료안내 0/.test(s4) && /승격 0/.test(s4), s4);

    // ⑨ 템플릿 정의 2장(JSON) — 버튼 규격·변수·AD형
    const ti = kakaoNotify.couponTemplate('issue'), te = kakaoNotify.couponTemplate('expire');
    ok('⑨ 템플릿 2장 = AD형·버튼 3개(AC 최상단·WL 쿠폰함·MD)·이름 14자 이내', [ti, te].every(t => t && t.tpl_type === 'AD' && t.button.button.length === 3 && t.button.button[0].linkType === 'AC' && t.button.button[1].linkType === 'WL' && /coupon\.html$/.test(t.button.button[1].linkMo) && t.button.button[2].linkType === 'MD' && t.button.button.every(b => b.name.length <= 14)));
    ok('⑨ 승인 전 코드 = 빈값(dry) · env로 교체 가능', kakaoNotify.couponTplCode('issue') === '' && kakaoNotify.couponTplCode('expire') === '');

    const fail = results.filter(r => !r.pass).length;
    console.log(`\n결과: ${results.length - fail}/${results.length}${fail ? ' — 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

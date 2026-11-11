// #1110-4 서버 모듈 검증 — response-head.js (숫자 · 미리보기) · DB·네트워크·AI 0(가짜 pool·가짜 fetch·가짜 엔진을 끼워 실행)
//   실행: node scripts/verify-1110-4-head.js
//   🔴 여기서 못 보는 것 = 실제 SQL 이 실DB 에서 도는지(가짜 pool 은 글자 꼴만 보고 줄을 돌려준다) → 장착 뒤 읽기 전용 1회 호출로 확인
'use strict';
const path = require('path');
const mount = require(path.join(__dirname, '..', 'response-head.js'));
let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) pass++; else { fail++; console.log('  ❌ ' + n + (d != null ? ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) : '')); } };

function world(over) {
    const W = Object.assign({ now: Date.parse('2026-11-11T03:00:00Z'), cfg: { inquiry_auto_reply: 'on', qna_auto_post: 'on', inquiry_auto_post: 'off', sms_gateway: { enabled: true, mode: 'draft' }, bot_timing: { buffer_sec: 30, once_until_hour: 9 } },
        talkRows: [], qna: { bot: 33, staff: 7, open: 0 }, inquiry: { bot: 5, staff: 3, open: 1 }, sms: { bot: 2, staff: 60, open: 9 }, scen: [{ scenario_no: 16, name: '사이즈 지정(감귤·만감류 전용)' }, { scenario_no: 2, name: '상품 파손/불량' }],
        season: [{ start_md: '11-01', end_md: '12-31' }, { start_md: '12-15', end_md: '01-10' }, { start_md: '06-01', end_md: '06-30' }], sql: [], failTalk: false, routes: {} }, over || {});
    const pool = { async query(sql, p) {
        W.sql.push(sql.replace(/\s+/g, ' ').slice(0, 220));
        if (/FROM agent_office_config WHERE key = ANY/.test(sql)) return { rows: Object.keys(W.cfg).filter(k => p[0].includes(k)).map(k => ({ key: k, value: W.cfg[k] })) };
        if (/SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: p[0] in W.cfg ? [{ value: W.cfg[p[0]] }] : [] };
        if (/INSERT INTO agent_office_config/.test(sql)) {   // capTake — 진짜 SQL 과 같은 뜻으로 흉내
            const key = p[0], day = p[1], cap = p[2]; const cur = W.cfg[key];
            if (!cur) { W.cfg[key] = { day, n: 1 }; return { rows: [{ n: 1 }] }; }
            if (!(cap === 0 || cur.day !== day || (Number(cur.n) || 0) < cap)) return { rows: [] };
            W.cfg[key] = { day, n: cur.day === day ? (Number(cur.n) || 0) + 1 : 1 }; return { rows: [{ n: W.cfg[key].n }] };
        }
        if (/UPDATE agent_office_config SET value = jsonb_set/.test(sql)) { const cur = W.cfg[p[0]]; if (cur && cur.day === p[1]) cur.n = Math.max(0, (Number(cur.n) || 1) - 1); return { rows: [] }; }
        if (/FROM message_logs/.test(sql)) { if (W.failTalk) throw new Error('boom'); return { rows: W.talkRows }; }
        if (/FROM naver_qnas/.test(sql)) return { rows: [W.qna] };
        if (/FROM naver_inquiries/.test(sql)) return { rows: [W.inquiry] };
        if (/FROM sms_threads/.test(sql)) return { rows: [W.sms] };
        if (/count\(\*\)::int AS n FROM inquiry_scenarios/.test(sql)) return { rows: [{ n: 63 }] };
        if (/SELECT start_md, end_md FROM product_season_knowledge/.test(sql)) return { rows: W.season };
        if (/SELECT scenario_no, name FROM inquiry_scenarios/.test(sql)) return { rows: W.scen.filter(s => p[0].includes(s.name)) };
        if (/response_preview_log/.test(sql)) return { rows: [] };   // #1110-5 미리보기 이력 표(자세한 검증 = verify-1110-5-head.js)
        throw new Error('가짜 pool 이 모르는 SQL: ' + sql.slice(0, 80));
    } };
    const app = { get(p, ...h) { W.routes['GET ' + p] = h; }, post(p, ...h) { W.routes['POST ' + p] = h; } };
    const auth = (req, res, next) => next();
    W.api = mount(app, Object.assign({ pool, authMiddleware: auth, now: () => W.now, cacheMs: 30000, token: () => 'tok',
        qnaGenerate: async (...a) => { W.gen = a; return W.genOut === undefined ? { answer: '답 글', used: ['사이즈 지정(감귤·만감류 전용)', '오늘 발송 일정'] } : W.genOut; },
        inquiryGenerate: async item => { W.inq = item; return W.inqOut === undefined ? { answer: '고객문의 답', used: ['상품 파손/불량'] } : W.inqOut; },
        fetch: async (url, opt) => { W.fetched = { url, opt }; if (W.fetchThrow) throw W.fetchThrow; const r = W.botRes || { status: 200, body: { ok: true, skip: false, answer: '톡톡 답', source: 'ai', scenario_nos: ['16'], scenario_names: ['사이즈 지정(감귤·만감류 전용)'] } }; return { status: r.status, json: async () => { if (r.bad) throw new Error('not json'); return r.body; } }; } }, W.deps || {}));
    W.call = async (key, req) => { const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; const hs = W.routes[key]; let i = 0; const next = async () => { const h = hs[i++]; if (h) await h(Object.assign({ user: { id: 7, role: 'user' }, query: {}, body: {} }, req), res, next); }; await next(); return res; };
    return W;
}
const row = (id, o) => Object.assign({ id, message: '질문', answered: false, bot_response: null, staff_response: null, rid: 0 }, o);

(async () => {
    // ── talkBin(손님 한 명의 마지막 줄 → 칸)
    const B = mount.talkBin;
    ok(B(row(1, { answered: true, bot_response: '봇 답' })) === 'bot', '봇이 답함');
    ok(B(row(1, { answered: true, bot_response: '봇 답', staff_response: '직원 답' })) === 'staff', '봇 답 뒤 직원 답 = 직원');
    ok(B(row(1, { bot_response: '[직원응답]' })) === 'staff' && B(row(1, { bot_response: '[직원응답-발송취소]' })) === 'staff', '직원이 먼저 답해 봇이 접은 줄 = 직원');
    ok(B(row(5, { bot_response: '[SKIP-무응답]', rid: 5 })) === 'staff' && B(row(5, { bot_response: '[SKIP-무응답]', rid: 4 })) === 'open', '[확인]한 줄 = 직원 · 그 뒤 새 글이면 다시 안 답함');
    for (const m of ['[쿨다운-무응답]', '[1회응대-무응답]', '[SKIP-무응답]', '[AI에러: x]', '[이미지-무응답]']) ok(B(row(1, { bot_response: m })) === 'open', '봇이 쉰 줄 = 아직 안 답함: ' + m);
    ok(B(row(1, { message: '이 상품을 문의합니다.' })) === null && B(row(1, { message: '[메시지1] 이 상품을 문의합니다.' })) === null, '입장 글뿐 = 안 셈');
    ok(B(row(1, { message: '이 상품을 문의합니다.', staff_response: '네 고객님' })) === 'staff', '입장 글에 직원 답 = 직원');
    ok(B(row(1, { message: '상위 노출 마케팅 제안드립니다 http://x.kr' })) === null, '광고 글 = 안 셈');
    ok(B(row(1, { message: '상위 노출 마케팅 제안', answered: true, bot_response: '답' })) === 'bot', '광고 낱말이어도 봇이 답했으면 셈');
    ok(B(row(1, { message: '[직원 직접답변]', staff_response: '먼저 보낸 글' })) === 'staff' && B(row(1, { message: '' })) === null, '직원 글만 있는 줄 = 직원 · 빈 줄 = 안 셈');

    // ── 숫자
    let W = world({ talkRows: [row(1, { answered: true, bot_response: '답' }), row(2, { answered: true, bot_response: '답' }), row(3, { staff_response: '직원' }), row(4, { bot_response: '[1회응대-무응답]' }), row(5, { message: '이 상품을 문의합니다.' })] });
    let r = await W.call('GET /api/agent-office/response-stats', { query: {} });
    ok(r.code === 200 && r.body.ok && r.body.days === 7, '숫자 200 · 기본 7일', r.body);
    ok(JSON.stringify(r.body.channels.talk) === JSON.stringify({ total: 4, bot: 2, staff: 1, open: 1 }), '톡톡 = 봇 2 · 직원 1 · 안 답함 1(입장 글 빠짐)', r.body.channels.talk);
    ok(JSON.stringify(r.body.channels.qna) === JSON.stringify({ total: 40, bot: 33, staff: 7, open: 0 }) && r.body.channels.inquiry.total === 9 && !('sms' in r.body.channels), '상품문의·고객문의 합 · 문자 칸 없음(#1122)');
    ok(JSON.stringify(r.body.all) === JSON.stringify({ total: 53, bot: 40, staff: 11, open: 2 }), '전체 = 톡톡+상품문의+고객문의 합(문자 제외 #1122)', r.body.all);
    ok(r.body.from === '2026-11-05' && r.body.to === '2026-11-11', '기간(KST 오늘 포함 7일)', r.body.from + '~' + r.body.to);
    ok(JSON.stringify(r.body.settings) === JSON.stringify({ auto_reply: true, qna_auto_post: true, inquiry_auto_post: false, sms_mode: 'draft', talk_once_until_hour: 9 }), '설정 상태', r.body.settings);
    ok(JSON.stringify(r.body.materials) === JSON.stringify({ scenarios: 63, season: 3, season_today: 1 }), '재료 수 · 오늘 적용(11-11 = 첫 줄만 · 해 넘는 구간 12-15~01-10 은 아님)', r.body.materials);
    ok(r.body.preview.cap === 100 && r.body.preview.left_today === 100, '미리보기 상한 기본 100');
    const nSql = W.sql.length; r = await W.call('GET /api/agent-office/response-stats', { query: { days: '7' } });
    ok(!W.sql.slice(nSql).some(s => /message_logs|naver_qnas|sms_threads/.test(s)) && W.sql.slice(nSql).some(s => /agent_office_config/.test(s)), '30초 안 = 숫자는 기억 · 설정은 새로 읽음');
    W.now += 31000; const n2 = W.sql.length; await W.call('GET /api/agent-office/response-stats', { query: {} });
    ok(W.sql.slice(n2).some(s => /message_logs/.test(s)), '30초 뒤 = 다시 셈');
    r = await W.call('GET /api/agent-office/response-stats', { query: { days: '30' } }); ok(r.body.days === 30 && r.body.from === '2026-10-13', '30일', r.body.from);
    r = await W.call('GET /api/agent-office/response-stats', { query: { days: '9999' } }); ok(r.body.days === 7, '이상한 날 수 = 7');
    r = await W.call('GET /api/agent-office/response-stats', { user: { id: 9, role: 'accountant' } }); ok(r.code === 403, '세무사 403');
    W = world({ failTalk: true }); const eLog = console.error; console.error = () => { };
    r = await W.call('GET /api/agent-office/response-stats', {}); console.error = eLog;
    ok(r.code === 200 && r.body.channels.talk === null && r.body.all.total === 49, '한 채널 실패 = 그 칸만 null · 나머지는 나옴', r.body.all);
    W = world({ cfg: { inquiry_auto_reply: 'off', sms_gateway: { enabled: false, mode: 'auto' }, bot_timing: { once_until_hour: true } } }); r = await W.call('GET /api/agent-office/response-stats', {});
    ok(JSON.stringify(r.body.settings) === JSON.stringify({ auto_reply: false, qna_auto_post: true, inquiry_auto_post: false, sms_mode: 'off', talk_once_until_hour: null }), '설정 기본값(칸 없음 = 상품문의 켜짐·고객문의 꺼짐) · 문자 꺼짐 · 이상한 값 = null', r.body.settings);

    // ── 미리보기: 입력·권한
    W = world(); const P = (body, user) => W.call('POST /api/agent-office/response-preview', Object.assign({ body }, user ? { user } : {}));
    ok((await P({ channel: 'x', text: 'a' })).code === 400 && (await P({ channel: 'qna', text: '  ' })).code === 400 && (await P({ channel: 'qna', text: '가'.repeat(1001) })).code === 400, '채널 틀림·빈 글·1,001자 = 400');
    ok(!('response_preview_state' in W.cfg), '입력 오류는 상한을 안 씀');
    ok((await P({ channel: 'qna', text: 'a' }, { id: 9, role: 'accountant' })).code === 403, '세무사 403');
    // 상품문의
    r = await P({ channel: 'qna', text: ' 사이즈 지정 되나요 ', item: '타이벡' });
    ok(r.code === 200 && r.body.ok && r.body.skip === false && r.body.answer === '답 글' && r.body.channel === 'qna' && r.body.source === 'ai', '상품문의 답', r.body);
    ok(JSON.stringify(W.gen) === JSON.stringify(['사이즈 지정 되나요', '타이벡']), 'qnaGenerate(다듬은 글, 상품) · 채널 인자 없음', W.gen);
    ok(JSON.stringify(r.body.scenario_nos) === '["16"]' && r.body.scenario_names.length === 1, '쓴 재료 = 시나리오 표에 있는 이름만 번호로(가상 재료 「오늘 발송 일정」 빠짐)', r.body);
    ok(r.body.left_today === 99 && r.body.cap === 100 && typeof r.body.ms === 'number', '남은 횟수·걸린 시간');
    W.genOut = null; r = await P({ channel: 'qna', text: 'a' }); ok(r.code === 200 && r.body.skip === true && r.body.why === 'no_material' && !('answer' in r.body), '엔진 null = 넘김(no_material)'); W.genOut = undefined;
    // 고객문의
    r = await P({ channel: 'inquiry', text: '반품 문의', item: '황금향' });
    ok(r.body.answer === '고객문의 답' && JSON.stringify(W.inq) === JSON.stringify({ title: '', content: '반품 문의', product_name: '황금향' }) && r.body.scenario_nos[0] === '2', '고객문의 = inquiryGenerate({ content, product_name })', W.inq);
    // 문자
    W.genOut = { answer: '안녕하세요 고객님 ^^\n오전 8시 이전 주문은 당일 발송입니다.', used: [] }; r = await P({ channel: 'sms', text: '언제 와요' });
    ok(r.body.skip === false && JSON.stringify(W.gen) === JSON.stringify(['언제 와요', null, null, 'sms'].map((x, i) => i === 2 ? undefined : x)) || (W.gen[3] === 'sms' && W.gen[1] === null), '문자 = qnaGenerate(글, null, undefined, "sms")', W.gen);
    W.genOut = { answer: '[사람] 파손 불만', used: [] }; r = await P({ channel: 'sms', text: '이 건은 어떻게 처리되나요' });
    ok(r.body.skip === true && r.body.why === 'to_staff' && /파손 불만/.test(r.body.why_text), '문자 [사람] 줄 = 넘김(to_staff)', r.body);
    // #1110-4b 문자 불만 글 = AI 전에 정해 둔 글(실제 흐름과 같게)
    {
        const rules = require('../sms/rules.js'); let safe = t => t; try { safe = require('../sms/sms-safe.js').smsSafe || safe; } catch (e) { /* 없으면 그대로 */ }
        W.gen = null; const left0 = (await P({ channel: 'qna', text: 'x' })).body.left_today; W.gen = null;
        r = await P({ channel: 'sms', text: '귤이 물러서 왔어요' });
        ok(r.code === 200 && r.body.skip === false && r.body.source === 'sms_rule' && r.body.answer === safe(rules.claimText({ text: '귤이 물러서 왔어요' })) && /무른 게 나오셨군요/.test(r.body.answer), '문자 불만(상태 낱말) = claimText 글 그대로', r.body);
        ok(W.gen === null && /주문을 못 찾으면/.test(r.body.note || '') && r.body.left_today === left0, '불만 글 = AI 안 부름 · 안내 줄 · 하루 횟수 안 깎임', [W.gen, r.body.left_today, left0]);
        r = await P({ channel: 'sms', text: '아직도 안 왔어요 환불해 주세요' });
        ok(rules.claimText({ text: '아직도 안 왔어요 환불해 주세요' }) === null && r.body.skip === false && r.body.source === 'sms_rule' && r.body.answer === safe(rules.notFoundText({ claim: true, text: '아직도 안 왔어요 환불해 주세요' })) && /직원 몫/.test(r.body.note || '') && W.gen === null, '문자 불만(미도착) = 못 찾았을 때 글 + 「찾으면 직원 몫」 안내 · AI 0', r.body);
        r = await P({ channel: 'sms', text: '(광고) 무료수신거부 귤이 물러서 왔어요' });
        ok(r.body.source === 'sms_rule' && W.gen === null, '광고 낱말 + 불만 낱말 = 실제 문자처럼 불만 갈래(번호 꼴 넘김)', r.body);
        r = await P({ channel: 'sms', text: '파손 없이 잘 받았습니다 감사합니다' });
        ok(r.body.source !== 'sms_rule', '불만 아닌 글(「파손 없이 잘 받았습니다」) = 정해 둔 글 안 나옴', r.body);
    }
    W.genOut = { answer: '담당자가 확인 후 연락드리겠습니다.', used: [] }; r = await P({ channel: 'sms', text: 'x' });
    ok(r.body.skip === true, '문자 넘기기 문장만 남으면 넘김', r.body); W.genOut = undefined;
    // 톡톡(톡톡봇 대리)
    r = await P({ channel: 'talk', text: '사이즈', item: '타이벡' });
    ok(r.body.answer === '톡톡 답' && W.fetched.url === 'https://jeju-akkomene-talktalk-bot.onrender.com/preview' && W.fetched.opt.headers.Authorization === 'Bearer tok' && JSON.parse(W.fetched.opt.body).text === '사이즈' && JSON.parse(W.fetched.opt.body).item === '타이벡', '톡톡 = 톡톡봇 /preview 로 Bearer·{text,item}', W.fetched && W.fetched.url);
    ok(r.body.scenario_nos[0] === '16' && r.body.source === 'ai', '톡톡봇이 준 재료 번호 그대로');
    W.botRes = { status: 200, body: { ok: true, skip: true, why: 'auto_reply_off', why_text: '전체 자동응답이 꺼져 있어 봇이 답하지 않아요' } }; r = await P({ channel: 'talk', text: 'x' });
    ok(r.code === 200 && r.body.skip && r.body.why === 'auto_reply_off', '톡톡봇 넘김 그대로');
    const usedBefore = W.cfg.response_preview_state.n;
    W.botRes = { status: 404, body: {} }; r = await P({ channel: 'talk', text: 'x' });
    ok(r.code === 502 && r.body.code === 'bot_old' && /준비 중/.test(r.body.error) && W.cfg.response_preview_state.n === usedBefore, '톡톡봇 옛 판(404) = 502 bot_old · 상한 한 칸 돌려줌', r.body);
    W.botRes = { status: 429, body: { ok: false, code: 'minute_cap', retry_after: 20 } }; r = await P({ channel: 'talk', text: 'x' });
    ok(r.code === 429 && r.body.code === 'bot_cap' && r.body.retry_after === 20 && W.cfg.response_preview_state.n === usedBefore, '톡톡봇 429 = 429 bot_cap · 돌려줌');
    W.botRes = { status: 401, body: { ok: false, error: '열쇠가 맞지 않습니다' } }; r = await P({ channel: 'talk', text: 'x' });
    ok(r.code === 502 && r.body.code === 'bot_down' && !/열쇠/.test(r.body.error), '톡톡봇 401 = 502(봇 글 그대로 안 옮김)');
    W.botRes = { status: 200, bad: true }; r = await P({ channel: 'talk', text: 'x' }); ok(r.code === 502, '톡톡봇 답이 JSON 아님 = 502');
    W.botRes = undefined; W.fetchThrow = Object.assign(new Error('aborted'), { name: 'AbortError' }); r = await P({ channel: 'talk', text: 'x' });
    ok(r.code === 504 && r.body.code === 'timeout', '시간 넘김 = 504'); W.fetchThrow = new Error('ECONNREFUSED'); r = await P({ channel: 'talk', text: 'x' }); ok(r.code === 502 && r.body.code === 'bot_down', '톡톡봇 안 닿음 = 502'); W.fetchThrow = null;
    W = world({ deps: { token: () => '' } }); r = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'talk', text: 'x' } });
    ok(r.code === 502 && r.body.code === 'bot_key' && !W.fetched && W.cfg.response_preview_state.n === 0, '열쇠 없음 = 안 부르고 502 · 돌려줌', r.body);
    // 엔진 예외 · 상한 · 동시
    W = world({ deps: { qnaGenerate: async () => { throw new Error('boom req_abc'); } } }); console.error = () => { }; r = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'x' } }); console.error = eLog;
    ok(r.code === 502 && r.body.code === 'ai_error' && !/boom/.test(JSON.stringify(r.body)), '엔진 예외 = 502(글자 안 샘)');
    r = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'x' } }).catch(() => null);
    ok(r && r.code === 502, '예외 뒤에도 같은 사람이 다시 물을 수 있음(동시 잠금 풀림)');
    W = world({ cfg: { response_preview: { daily_cap: 2 } } });
    ok((await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: '1' } })).body.left_today === 1 && (await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: '2' } })).body.left_today === 0, '상한 2 = 두 번까지');
    r = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: '3' } });
    ok(r.code === 429 && r.body.code === 'day_cap' && r.body.left_today === 0 && W.gen[0] === '2', '세 번째 = 429 day_cap · 엔진 안 부름', r.body);
    W.now += 24 * 3600e3; ok((await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: '4' } })).code === 200, '한국 날짜가 바뀌면 다시');
    W = world({ cfg: { response_preview: { daily_cap: 0 } } }); r = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'x' } });
    ok(r.code === 200 && r.body.cap === 0 && r.body.left_today === null, '상한 0 = 제한 없음');
    let release; const gate = new Promise(res => { release = res; });
    W = world({ deps: { qnaGenerate: async () => { await gate; return { answer: '늦은 답', used: [] }; } } });
    const p1 = W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'a' } }); await new Promise(res => setImmediate(res)); await new Promise(res => setImmediate(res));
    const r2 = await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'b' } });
    const r3 = W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'c' }, user: { id: 8, role: 'user' } }); await new Promise(res => setImmediate(res));
    release(); const [a1, a3] = await Promise.all([p1, r3]);
    ok(r2.code === 429 && r2.body.code === 'busy' && a1.code === 200 && a3.code === 200, '같은 사람 동시 2번째 = 429 busy · 다른 사람은 됨', r2.body);
    // 쓰기는 상한 한 칸뿐
    W = world(); await W.call('POST /api/agent-office/response-preview', { body: { channel: 'qna', text: 'x' } }); await W.call('GET /api/agent-office/response-stats', {});
    const writes = W.sql.filter(s => /^\s*(INSERT|UPDATE|DELETE)/i.test(s) && !/response_preview_log/.test(s));   // #1110-5 미리보기 이력 기록은 따로(verify-1110-5-head.js)
    ok(writes.length === 1 && /INSERT INTO agent_office_config/.test(writes[0]), '쓰기 = 상한 셈 한 문장뿐(발송·응대 기록 표 쓰기 0 · 미리보기 이력 표는 따로)', writes);
    ok(Object.keys(world().routes).join('|') === 'GET /api/agent-office/response-stats|POST /api/agent-office/response-preview|GET /api/agent-office/response-preview-log', '주소 3개만 건다(#1110-5 이력 조회 더함)');
    let threw = false; try { world({ deps: { tables: { logs: 'x; DROP' } } }); } catch (e) { threw = true; } ok(threw, '이상한 표 이름은 장착 때 멈춤');

    console.log(`#1110-4 서버 모듈 검증: 통과 ${pass} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('검증 오류:', e); process.exit(1); });

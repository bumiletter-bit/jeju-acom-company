/* #610-D 사진 판독 응대 검증 — AI 호출 0 · DB 접속 0 · 네트워크 0 (전부 가짜로 바꿔 끼움)
 *
 *   node scripts/verify-610-photo.js
 *
 *   ① photo-reply : 글 3벌 × 확신 × 채널 기대값 · 대표 원문 글자 그대로 · sms 이모지 0 · 숫자·개수·비율 유출 0
 *   ② photo-judge : 가짜 AI 답으로 모양 검사(정상 · 값 틀림 · JSON 깨짐 · 거절 · 오류 · 시간 초과 · 사진 없음 · 요청 모양)
 *   ③ 톡톡봇 복사본(photo-judge.js · photo-reply.js)이 이 저장소 것과 같은지
 *   ④ 톡톡봇 server.js 실코드를 가짜 DB·가짜 발송으로 띄워 사진 흐름 8갈래(스위치 꺼짐 = 종전 그대로 포함)
 *
 *   실사진 시험(Sonnet 호출)은 여기 없다 — 대표가 사진을 주면 따로 돌린다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const BOT = path.join(ROOT, '..', '★제주아꼼이네 톡톡봇');
const photoReply = require('../sms/photo-reply.js');
const photoJudge = require('../sms/photo-judge.js');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
    if (cond) { pass++; }
    else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n' + t); }
const EMOJI = /\p{Extended_Pictographic}/u;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────── ① photo-reply ───────────────────────────
function testReply() {
    section('① photo-reply — 글 고르기');
    const { reply, leakCheck, DAMAGE_CORE, DAMAGE_ASK, SIZE_GUIDE, ASK_CORE } = photoReply;
    const OWNER = '부패과가 나왔군요, 불편드려 죄송합니다. 괜찮은 상품 드셔보시고 입맛에도 안 맞으시면 무료 수거 및 반품처리도 가능합니다. 괜찮다고 하시면 위 부분 좀 더 하여 보상처리 가능합니다.';
    ok(DAMAGE_CORE === OWNER, '파손 글 = 대표 원문 글자 그대로');

    const all = [];
    for (const channel of ['talk', 'sms']) {
        for (const confidence of ['high', 'low']) {
            // damage
            const d = reply({ kind: 'damage', confidence, staff_summary: '곰팡이 3개 · 무름 2개 · 전체의 20%' }, { channel });
            all.push(['damage/' + confidence + '/' + channel, d]);
            ok(d.includes(OWNER), `damage ${confidence} ${channel}: 대표 원문 포함`);
            ok(d.includes('다른 박스·나머지도 같으실까요?') && d.includes(DAMAGE_ASK), `damage ${confidence} ${channel}: 범위 되묻기`);
            ok(!d.includes('곰팡이') && !d.includes('20%'), `damage ${confidence} ${channel}: 직원용 요약이 손님 글에 없음`);

            // size
            for (const size_guess of ['2S', 'S', 'M', 'L', null]) {
                const s = reply({ kind: 'size', confidence, size_guess, size_dir: 'small' }, { channel });
                all.push([`size/${confidence}/${size_guess}/${channel}`, s]);
                ok(s.includes('크기가 작았군요'), `size ${confidence} ${size_guess} ${channel}: 「크기가 작았군요」`);
                const shows = /사진으로는 .+ 정도로 보여요/.test(s);
                ok(shows === (confidence === 'high' && !!size_guess), `size ${confidence} ${size_guess} ${channel}: 사이즈 글자는 확신 높을 때만`, shows);
                if (confidence === 'high' && size_guess) ok(s.includes(`사진으로는 ${size_guess} 정도로 보여요.`), `size high ${size_guess} ${channel}: 추정 사이즈 글`);
                ok(s.includes(SIZE_GUIDE) && s.includes('골프공') && s.includes('종이컵'), `size ${confidence} ${size_guess} ${channel}: 기준(골프공·종이컵)`);
                ok(s.includes('배송메세지'), `size ${confidence} ${size_guess} ${channel}: 배송메세지 안내`);
            }
            // 지난 주문
            const p = reply({ kind: 'size', confidence, size_guess: '2S', size_dir: 'small' }, { channel, prevOrder: { size: '소과' } });
            all.push([`size+prev/${confidence}/${channel}`, p]);
            ok(p.includes('저번에 받으신 건 소과'), `size ${confidence} ${channel}: 지난 주문 견줌`);
            const p2 = reply({ kind: 'size', confidence, size_guess: '2S' }, { channel, prevOrder: { size: '모르는값' } });
            ok(!p2.includes('저번에 받으신'), `size ${confidence} ${channel}: 모르는 사이즈 말은 안 적음`);

            // unclear · other
            for (const kind of ['unclear', 'other', '없는값', undefined]) {
                const u = reply({ kind, confidence }, { channel });
                all.push([`${kind}/${confidence}/${channel}`, u]);
                ok(u.includes('사진 확인했어요, 어떤 점이 불편하셨는지 알려주세요') && u.includes(ASK_CORE), `${kind} ${confidence} ${channel}: 되묻기 글`);
                ok(!u.includes('부패') && !u.includes('크기가'), `${kind} ${confidence} ${channel}: 파손·사이즈 글 안 섞임`);
            }
            // not_fruit
            ok(reply({ kind: 'not_fruit', confidence }, { channel }) === null, `not_fruit ${confidence} ${channel}: 답 없음(null)`);
        }
    }
    // 방향
    ok(reply({ kind: 'size', confidence: 'high', size_guess: 'M', size_dir: 'big' }, {}).includes('컸군요'), 'size 방향 big → 「컸군요」');
    ok(reply({ kind: 'size', confidence: 'low', size_guess: null, size_dir: null }, {}).includes('달랐군요'), 'size 방향 모름(null) → 「달랐군요」');
    ok(reply({ kind: 'size', confidence: 'low' }, {}).includes('작았군요'), 'size 방향 칸 없음 → 기본 「작았군요」');
    ok(reply(null, {}) && reply(undefined).includes(ASK_CORE), '판독 값 없음 → 되묻기 글(죽지 않음)');

    // 유출·이모지 전수
    for (const [label, text] of all) {
        ok(leakCheck(text) === '', `숫자·개수·비율 유출 0 — ${label}`, leakCheck(text));
        ok(!/[0-9]/.test(text.replace(/2S/g, '')), `숫자 0(「2S」 제외) — ${label}`);
        ok(!/\d+\s*(개|과|알|박스|상자|%|퍼센트)/.test(text), `개수 꼴 0 — ${label}`);
        if (label.endsWith('/sms')) ok(!EMOJI.test(text), `sms 이모지 0 — ${label}`);
        ok(!/환불|포인트|원\b|[0-9]+원/.test(text), `금액·환불·포인트 약속 0 — ${label}`);
    }
    ok(all.some(([l, t]) => l.endsWith('/talk') && EMOJI.test(t)), 'talk 채널은 인사 그림 유지');
    // 안전망 자체 검사
    ok(leakCheck('곰팡이 3개 정도로 보여요') === '숫자', 'leakCheck: 숫자 잡음');
    ok(leakCheck('몇 개가 상했네요') === '개수 표현', 'leakCheck: 개수 표현 잡음');
    ok(leakCheck('절반 정도가 무르네요') === '비율 표현', 'leakCheck: 비율 표현 잡음');
    ok(leakCheck('사진으로는 2S 정도로 보여요.') === '', 'leakCheck: 「2S」 는 통과');
}

// ─────────────────────────── ② photo-judge ───────────────────────────
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
function fakeClient(handler) {
    const calls = [];
    return { calls, messages: { create: async (params, opts) => { calls.push({ params, opts }); return handler(params, opts); } } };
}
function aiText(obj, extra) {
    return Object.assign({ stop_reason: 'end_turn', usage: { input_tokens: 1800, output_tokens: 120 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, extra || {});
}
async function testJudge() {
    section('② photo-judge — 가짜 AI 답으로 모양 검사');
    const { judge, normalize, MODEL, KINDS } = photoJudge;
    ok(MODEL === 'claude-sonnet-5-5', '모델 = claude-sonnet-5-5');
    ok(KINDS.join() === 'damage,size,other,not_fruit,unclear', 'kind 5종');

    // 정상
    let c = fakeClient(() => aiText({ kind: 'damage', confidence: 'high', size_guess: null, size_dir: null, staff_summary: '곰팡이 핀 귤 3개, 무른 귤 2개로 보임. 사진 2장.' }));
    let r = await judge([{ buf: JPEG, contentType: 'image/jpeg' }, { buf: PNG, contentType: 'image/png' }], { text: '귤이 썩었어요', channel: 'talk', client: c });
    ok(r.kind === 'damage' && r.confidence === 'high' && r.size_guess === null, '정상: damage/high', r);
    ok(r.staff_summary.includes('3개'), '정상: 직원용 요약은 개수 포함 가능');
    ok(['kind', 'confidence', 'size_guess', 'staff_summary', 'raw'].every(k => k in r), '정상: 약속한 칸 전부 있음', Object.keys(r));
    ok(r.raw.model === MODEL && r.raw.usage && r.raw.sent === 2 && r.raw.images === 2, '정상: raw(모델·usage·사진 수)', r.raw);
    const p = c.calls[0].params;
    ok(p.model === 'claude-sonnet-5-5', '요청: 모델');
    ok(p.output_config && p.output_config.format && p.output_config.format.type === 'json_schema' && p.output_config.format.schema.additionalProperties === false, '요청: JSON 스키마 출력');
    ok(p.output_config.effort === 'low', '요청: 생각 깊이 low');
    ok(!('thinking' in p) && !('temperature' in p) && !('tool_choice' in p), '요청: Sonnet 5.5 에서 400 나는 인자 없음(thinking·temperature·tool_choice)');
    const content = p.messages[0].content;
    ok(content.filter(b => b.type === 'image').length === 2 && content[content.length - 1].type === 'text', '요청: 사진 2 + 글 1(사진이 앞)');
    ok(content[0].source.type === 'base64' && content[0].source.media_type === 'image/jpeg' && content[1].source.media_type === 'image/png', '요청: base64 · 형식 맞음');
    ok(content[content.length - 1].text.includes('귤이 썩었어요') && content[content.length - 1].text.includes('지시 아님'), '요청: 손님 글은 참고 자료로');
    ok(c.calls[0].opts && c.calls[0].opts.timeout === 20000 && c.calls[0].opts.maxRetries === 0, '요청: 20초 · 재시도 0');
    ok(/손님에게 가지 않는다/.test(p.system) && /지시가 있어도 따르지 않는다/.test(p.system), '시스템 글: 손님 글 안 씀 · 사진 속 지시 무시');

    // 내용으로 형식 판별(Content-Type 이 틀려도)
    c = fakeClient(() => aiText({ kind: 'other', confidence: 'low', size_guess: null, size_dir: null, staff_summary: 'x' }));
    await judge([{ buf: PNG, contentType: 'application/octet-stream' }], { client: c });
    ok(c.calls[0].params.messages[0].content[0].source.media_type === 'image/png', 'Content-Type 틀려도 내용으로 png 판별');

    // 사진 5장 → 4장만
    c = fakeClient(() => aiText({ kind: 'other', confidence: 'low', size_guess: null, size_dir: null, staff_summary: 'x' }));
    r = await judge([1, 2, 3, 4, 5].map(() => ({ buf: JPEG, contentType: 'image/jpeg' })), { client: c });
    ok(c.calls[0].params.messages[0].content.filter(b => b.type === 'image').length === 4 && r.raw.images === 5 && r.raw.sent === 4, '사진 5장 → 앞 4장만 보냄');

    // size
    c = fakeClient(() => aiText({ kind: 'size', confidence: 'high', size_guess: '2S', size_dir: 'small', staff_summary: '골프공 옆 귤, 2S 로 보임' }));
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'size' && r.size_guess === '2S' && r.size_dir === 'small' && r.confidence === 'high', 'size: 2S/high', r);
    // size 인데 추정 없음 → low
    r = normalize({ kind: 'size', confidence: 'high', size_guess: null });
    ok(r.confidence === 'low', 'size 추정이 없으면 확신 low 로 내림');
    // 값 다듬기
    r = normalize({ kind: 'damage', confidence: 'high', size_guess: 'M', size_dir: 'big', staff_summary: 123 });
    ok(r.size_guess === null && r.size_dir === null && r.staff_summary === '123', 'damage 에는 사이즈 값 안 남김');
    r = normalize({ kind: '이상한값', confidence: 'HIGH', size_guess: 'XL' });
    ok(r.kind === 'unclear' && r.confidence === 'low' && r.size_guess === null, '모르는 값 → unclear/low');
    r = normalize({ kind: 'unclear', confidence: 'high' });
    ok(r.confidence === 'low', 'unclear 는 늘 low');
    r = normalize(null);
    ok(r.kind === 'unclear', 'null → unclear');

    // 코드 울타리로 온 JSON
    c = fakeClient(() => aiText('```json\n{"kind":"not_fruit","confidence":"high","size_guess":null,"size_dir":null,"staff_summary":"주소 화면 캡처"}\n```'));
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'not_fruit' && r.confidence === 'high', '울타리 안 JSON 도 읽음', r);
    // JSON 깨짐
    c = fakeClient(() => aiText('죄송하지만 잘 모르겠습니다'));
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'unclear' && r.confidence === 'low' && r.raw.error, 'JSON 깨짐 → unclear + error', r);
    // 거절 · 잘림
    c = fakeClient(() => ({ stop_reason: 'refusal', content: [], usage: {} }));
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'unclear' && /refusal/.test(r.raw.error), '거절 → unclear', r.raw);
    c = fakeClient(() => aiText('{"kind":"dam', { stop_reason: 'max_tokens' }));
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'unclear' && /max_tokens/.test(r.raw.error), '잘림 → unclear');
    // API 오류(크레딧 부족 꼴)
    c = fakeClient(() => { const e = new Error('400 Your credit balance is too low'); e.status = 400; throw e; });
    r = await judge([{ buf: JPEG }], { client: c });
    ok(r.kind === 'unclear' && r.confidence === 'low' && /credit/.test(r.raw.error) && r.raw.status === 400, 'API 오류 → unclear(죽지 않음)', r.raw);
    ok(r.staff_summary.includes('직접 확인'), '실패 때 직원용 글 = 「직접 확인」');
    // 시간 초과
    c = fakeClient(() => new Promise(res => setTimeout(() => res(aiText({ kind: 'damage', confidence: 'high', size_guess: null, size_dir: null, staff_summary: 'x' })), 400)));
    const t0 = Date.now();
    r = await judge([{ buf: JPEG }], { client: c, timeoutMs: 60 });
    ok(r.kind === 'unclear' && /시간 초과/.test(r.raw.error) && Date.now() - t0 < 350, '시간 초과 → unclear(기다리지 않음)', r.raw);
    // 사진 없음 · 못 쓰는 사진
    c = fakeClient(() => aiText({}));
    r = await judge([], { client: c });
    ok(r.kind === 'unclear' && c.calls.length === 0, '사진 없음 → AI 안 부르고 unclear');
    r = await judge([{ buf: Buffer.from('not an image at all....'), contentType: 'text/html' }], { client: c });
    ok(r.kind === 'unclear' && c.calls.length === 0, '사진 아닌 내용 → AI 안 부르고 unclear');
    // 사진 아닌 내용이지만 https 주소가 있으면 주소로
    c = fakeClient(() => aiText({ kind: 'other', confidence: 'low', size_guess: null, size_dir: null, staff_summary: 'x' }));
    await judge([{ buf: Buffer.alloc(0), url: 'https://example.com/a.jpg' }], { client: c });
    ok(c.calls.length === 1 && c.calls[0].params.messages[0].content[0].source.type === 'url', '내용이 없고 https 주소가 있으면 주소로 넘김');
    // 키 없음
    const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    r = await judge([{ buf: JPEG }], {});
    ok(r.kind === 'unclear' && /키 없음/.test(r.raw.error), 'AI 키 없음 → unclear');
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    // 판독 결과 → 글
    ok(photoReply.reply(r, { channel: 'sms' }).includes('어떤 점이 불편하셨는지'), '실패 판독 → 되묻기 글로 이어짐');
}

// ─────────────────────────── ③ 복사본 대조 ───────────────────────────
function testCopies() {
    section('③ 톡톡봇 복사본 대조');
    if (!fs.existsSync(BOT)) { console.log('  (톡톡봇 폴더 없음 — 건너뜀)'); return false; }
    for (const f of ['photo-judge.js', 'photo-reply.js']) {
        const a = fs.readFileSync(path.join(ROOT, 'sms', f), 'utf8').replace(/\r\n/g, '\n');
        const bp = path.join(BOT, f);
        ok(fs.existsSync(bp), `톡톡봇에 ${f} 있음`);
        if (fs.existsSync(bp)) ok(a === fs.readFileSync(bp, 'utf8').replace(/\r\n/g, '\n'), `${f} 두 저장소 내용 같음`);
    }
    const s = fs.readFileSync(path.join(BOT, 'server.js'), 'utf8');
    ok((s.match(/ADD COLUMN IF NOT EXISTS image_url TEXT/g) || []).length === 1, 'initDB: image_url 칸');
    ok((s.match(/ADD COLUMN IF NOT EXISTS image_meta JSONB/g) || []).length === 1, 'initDB: image_meta 칸');
    ok(/PHOTO_JUDGE = v\.photo_judge === true/.test(s), '스위치 = bot_timing.photo_judge 가 불리언 true 일 때만');
    return true;
}

// ─────────────────────────── ④ 톡톡봇 실코드 흐름 ───────────────────────────
async function testBotFlow() {
    section('④ 톡톡봇 server.js 실코드 — 사진 흐름(가짜 DB·가짜 발송 · 타이머 200배 빠르게)');
    const st = {
        photoJudge: false, sql: [], nextId: 100, sends: [], tele: [], downloads: [], aiCalls: [], judgeCalls: [],
        judgeResult: null, intervals: [], routes: {}, listenCb: null
    };
    const realSetTimeout = global.setTimeout, realSetInterval = global.setInterval;
    global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 1000 ? Math.max(5, ms / 200) : ms, ...a);
    global.setInterval = (fn) => { st.intervals.push(fn); return { unref() { }, ref() { } }; };

    const fakePool = {
        query: async (sql, params) => {
            st.sql.push({ sql: String(sql), params });
            if (/FROM agent_office_config WHERE key = 'bot_timing'/.test(sql)) return { rows: [{ value: { buffer_sec: 5, cooldown_min: 30, photo_judge: st.photoJudge } }] };
            if (/RETURNING id/.test(sql)) return { rows: [{ id: st.nextId++ }] };
            return { rows: [], rowCount: 0 };
        }
    };
    const fakeAxios = {
        post: async (url, body) => {
            if (/api\.telegram\.org/.test(url)) { st.tele.push(body.text); return { data: { ok: true } }; }
            st.sends.push({ user: body.user, text: body.textContent && body.textContent.text });
            return { data: { success: true } };
        },
        get: async (url) => { st.downloads.push(url); return { data: JPEG, headers: { 'content-type': 'image/jpeg' } }; }
    };
    const fakeExpress = () => ({
        use() { }, get() { }, post(p, h) { st.routes[p] = h; }, listen(port, cb) { st.listenCb = cb; }
    });
    fakeExpress.json = () => () => { };
    const mocks = {
        dotenv: { config() { } }, express: fakeExpress, axios: fakeAxios, pg: { Pool: function () { return fakePool; } }, exceljs: {},
        './ai-handler': { getAIResponse: async (msg) => { st.aiCalls.push(msg); if (st.aiError) return { response: null, error: st.aiError }; return { response: '평소 봇 답', scenarioName: '시험', source: 'ai', scenarioNos: '1' }; } },
        './scenario-store': { start() { }, getDeliveryToday() { return null; } },
        './kakao-skill': { setup() { }, isKakaoUser: id => String(id).startsWith('kakao:'), sendCallback: async () => { } },
        './products-store': { productsRouter: () => { } },
        './photo-judge': { judge: async (images, opt) => { st.judgeCalls.push({ n: images.length, opt, images }); if (st.judgeResult instanceof Error) throw st.judgeResult; return st.judgeResult; } }
    };
    const realLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent && parent.filename && parent.filename.startsWith(BOT) && Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
        return realLoad.apply(this, arguments);
    };
    const envSaved = { t: process.env.TELEGRAM_BOT_TOKEN, c: process.env.TELEGRAM_CHAT_ID };
    process.env.TELEGRAM_BOT_TOKEN = 'test'; process.env.TELEGRAM_CHAT_ID = '1';
    const logSaved = console.log, errSaved = console.error;
    console.log = () => { }; console.error = () => { };
    let loaded = false;
    try {
        require(path.join(BOT, 'server.js'));
        loaded = true;
    } catch (e) { console.log = logSaved; console.error = errSaved; ok(false, '톡톡봇 server.js 로드', e.message); }
    Module._load = realLoad;
    if (!loaded) { global.setTimeout = realSetTimeout; global.setInterval = realSetInterval; return; }

    const webhook = st.routes['/webhook'];
    const reloadTiming = st.intervals.find(f => f.name === 'loadBotTiming');
    const fire = (body) => webhook({ body }, { status: () => ({ json() { } }) });
    const J = (kind, confidence, extra) => Object.assign({ kind, confidence, size_guess: null, size_dir: null, staff_summary: '직원용: 곰팡이 3개 · 전체의 20% 정도', raw: { sent: 1, usage: { input_tokens: 1 }, ms: 5 } }, extra || {});
    const WAIT = 5000 / 200 + 90;   // 버퍼 5초 → 25ms + 여유
    const reset = () => { st.sql.length = 0; st.sends.length = 0; st.tele.length = 0; st.downloads.length = 0; st.aiCalls.length = 0; st.judgeCalls.length = 0; };
    const sqlHas = re => st.sql.filter(q => re.test(q.sql));
    try {
        ok(typeof webhook === 'function' && typeof reloadTiming === 'function', 'webhook · 스위치 재로드 함수 잡힘');
        await st.listenCb();
        ok(sqlHas(/ADD COLUMN IF NOT EXISTS image_url TEXT/).length === 1 && sqlHas(/ADD COLUMN IF NOT EXISTS image_meta JSONB/).length === 1, '기동 때 칸 추가 2개 실행');

        // a) 스위치 꺼짐 = 종전 그대로(+ 주소 기록)
        st.photoJudge = false; await reloadTiming(); reset();
        fire({ event: 'send', user: 'uA', imageContent: { imageUrl: 'https://img.example.com/a.jpg' } });
        await sleep(WAIT);
        let ins = sqlHas(/INSERT INTO message_logs/);
        ok(ins.length === 1 && ins[0].params[2] === '[이미지 전송]' && ins[0].params[3] === '[이미지-무응답]', 'a 꺼짐: 「[이미지 전송]」·「[이미지-무응답]」 한 행(종전 글자 그대로)', ins.map(q => q.params));
        ok(ins[0].params[4] === 'https://img.example.com/a.jpg', 'a 꺼짐: 사진 주소 기록');
        ok(st.downloads.length === 0 && st.judgeCalls.length === 0 && st.sends.length === 0 && st.tele.length === 0, 'a 꺼짐: 내려받기 0 · 판독 0 · 발송 0 · 알림 0');
        // a-2) 꺼짐 + 글 = 평소 길
        reset();
        fire({ event: 'send', user: 'uA2', imageContent: { imageUrl: 'https://img.example.com/a.jpg' } });
        fire({ event: 'send', user: 'uA2', textContent: { text: '귤이 이상해요' } });
        await sleep(WAIT);
        ok(st.aiCalls.length === 1 && st.sends.length === 1 && st.sends[0].text === '평소 봇 답' && st.judgeCalls.length === 0, 'a-2 꺼짐: 글은 평소 봇 답 1번 · 판독 0', { ai: st.aiCalls.length, sends: st.sends });

        // b) 켜짐 · 사진만 · 파손
        st.photoJudge = true; await reloadTiming(); reset();
        st.judgeResult = J('damage', 'high');
        fire({ event: 'send', user: 'uB', imageContent: { imageUrl: 'https://img.example.com/b.jpg' } });
        await sleep(5);
        ok(st.downloads.length === 1, 'b: 받은 자리에서 바로 내려받음(묶음 기다리기 전)');
        await sleep(WAIT);
        ok(st.judgeCalls.length === 1 && st.judgeCalls[0].n === 1 && Buffer.isBuffer(st.judgeCalls[0].images[0].buf) && st.judgeCalls[0].opt.channel === 'talk', 'b: 판독 1번(사진 1 · 채널 talk)');
        ok(st.sends.length === 1 && st.sends[0].user === 'uB' && st.sends[0].text.includes(photoReply.DAMAGE_CORE) && st.sends[0].text.includes('다른 박스·나머지도 같으실까요?'), 'b: 파손 글 1번 발송', st.sends);
        ok(photoReply.leakCheck(st.sends[0].text) === '' && !st.sends[0].text.includes('곰팡이'), 'b: 손님 글에 개수·비율·직원 요약 없음');
        let meta = sqlHas(/SET image_meta/);
        ok(meta.length === 1 && JSON.parse(meta[0].params[0]).kind === 'damage' && JSON.parse(meta[0].params[0]).staff_summary.includes('3개') && meta[0].params[1].length === 1, 'b: image_meta 저장(직원용 요약 포함)', meta.map(q => q.params));
        ok(sqlHas(/SET answered = \$1, bot_response = \$2/).length === 1, 'b: 사진 행에 봇 답 기록');
        ok(st.tele.length === 1 && st.tele[0].includes('파손·부패') && st.tele[0].includes('3개') && st.tele[0].includes('(사진만)') && st.tele[0].includes('이어서 응대'), 'b: 직원 알림 1번(요약 · 이어받기)', st.tele);
        ok(st.aiCalls.length === 0, 'b: 평소 AI 답 0');

        // h) 같은 손님이 바로 또 사진 → 쿨다운 침묵
        reset();
        fire({ event: 'send', user: 'uB', imageContent: { imageUrl: 'https://img.example.com/b2.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 0 && st.judgeCalls.length === 1 && st.tele.length === 1 && st.tele[0].includes('쿨다운'), 'h: 봇 답 뒤 쿨다운 = 손님 답 침묵 + 판독·직원 알림은 함', { sends: st.sends, tele: st.tele });

        // c) 사진 4장 + 글 → 한 번
        reset(); st.judgeResult = J('size', 'high', { size_guess: '2S', size_dir: 'small' });
        for (let i = 0; i < 4; i++) { fire({ event: 'send', user: 'uC', imageContent: { imageUrl: `https://img.example.com/c${i}.jpg` } }); await sleep(3); }
        fire({ event: 'send', user: 'uC', textContent: { text: '크기가 너무 작아요 010-1234-5678 주문번호 2026100912345' } });
        await sleep(WAIT + 20);
        ok(st.judgeCalls.length === 1 && st.judgeCalls[0].n === 4 && st.judgeCalls[0].opt.text.includes('크기가 너무 작아요'), 'c: 사진 4 + 글 → 판독 1번(글 같이 전달)', st.judgeCalls.map(j => j.n));
        ok(st.sends.length === 1 && st.sends[0].text.includes('크기가 작았군요') && st.sends[0].text.includes('사진으로는 2S 정도로 보여요.'), 'c: 사이즈 글 1번만 발송', st.sends.map(s => s.text.slice(0, 40)));
        ok(st.aiCalls.length === 0, 'c: 평소 AI 답 0(답 2번 방지)');
        ok(sqlHas(/SET image_meta/).length === 1 && sqlHas(/SET image_meta/)[0].params[1].length === 4, 'c: 사진 4행에 판독 결과');
        ins = sqlHas(/INSERT INTO message_logs \(user_id, item, message, answered, bot_response, staff_response, scenario_name/);
        ok(ins.length === 1 && ins[0].params[6] === '사진 판독' && ins[0].params[7] === 'photo' && ins[0].params[3] === true, 'c: 글 행 기록(시나리오명 「사진 판독」)', ins.map(q => q.params.slice(2)));
        ok(st.tele.length === 1 && st.tele[0].includes('[번호]') && !st.tele[0].includes('1234-5678') && !st.tele[0].includes('2026100912345'), 'c: 직원 알림의 손님 글은 번호·긴 숫자 가림', st.tele);

        // d) 직원이 방금 답한 대화 → 침묵 + 알림
        reset(); st.judgeResult = J('damage', 'high');
        fire({ event: 'echo', user: 'uD', textContent: { text: '사진 보내주시면 확인해 드릴게요' } });
        await sleep(5);
        fire({ event: 'send', user: 'uD', imageContent: { imageUrl: 'https://img.example.com/d.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 0, 'd: 직원 응대 중 = 손님 답 침묵', st.sends);
        ok(st.judgeCalls.length === 1 && st.tele.length === 1 && st.tele[0].includes('직원 응대 중') && st.tele[0].includes('요약:'), 'd: 판독 + 직원 알림 요약은 감', st.tele);
        ok(sqlHas(/SET image_meta/).length === 1, 'd: image_meta 는 저장');

        // e) 과일 사진 아님 + 글 → 글은 평소 길
        reset(); st.judgeResult = J('not_fruit', 'high', { staff_summary: '주소 입력 화면 캡처' });
        fire({ event: 'send', user: 'uE', imageContent: { imageUrl: 'https://img.example.com/e.jpg' } });
        fire({ event: 'send', user: 'uE', textContent: { text: '이 주소로 바꿔주세요' } });
        await sleep(WAIT + 20);
        ok(st.aiCalls.length === 1 && st.sends.length === 1 && st.sends[0].text === '평소 봇 답', 'e: 과일 사진 아님 + 글 → 평소 봇 답 1번(사과 글 안 나감)', st.sends);
        ok(st.tele.length === 1 && st.tele[0].includes('과일 사진 아님'), 'e: 직원 알림');
        // e-2) 과일 사진 아님 · 사진만 → 답 없음
        reset();
        fire({ event: 'send', user: 'uE2', imageContent: { imageUrl: 'https://img.example.com/e2.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 0 && st.aiCalls.length === 0 && st.tele.length === 1, 'e-2: 과일 사진 아님 · 사진만 → 손님 답 0 · 직원 알림 1');

        // f) 판독 실패 → 손님 답 없음
        reset(); st.judgeResult = J('unclear', 'low', { staff_summary: '사진 판독을 하지 못했습니다', raw: { error: '400 credit balance is too low' } });
        fire({ event: 'send', user: 'uF', imageContent: { imageUrl: 'https://img.example.com/f.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 0 && st.tele.length === 1 && st.tele[0].includes('판독 실패'), 'f: 판독 실패(AI 오류) → 손님 답 0 · 직원 알림', { sends: st.sends, tele: st.tele });
        reset(); st.judgeResult = new Error('boom');
        fire({ event: 'send', user: 'uF2', imageContent: { imageUrl: 'https://img.example.com/f.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 0 && st.tele.length === 1, 'f-2: 판독 함수가 던져도 죽지 않음 · 손님 답 0');

        // g) 애매 · 사진만 → 되묻기 글
        reset(); st.judgeResult = J('unclear', 'low', { staff_summary: '흐려서 판단 어려움' });
        fire({ event: 'send', user: 'uG', imageContent: { imageUrl: 'https://img.example.com/g.jpg' } });
        await sleep(WAIT);
        ok(st.sends.length === 1 && st.sends[0].text.includes('사진 확인했어요, 어떤 점이 불편하셨는지 알려주세요'), 'g: 애매 · 사진만 → 되묻기 글', st.sends);
        // g-2) 애매 + 글 → 평소 길
        reset();
        fire({ event: 'send', user: 'uG2', imageContent: { imageUrl: 'https://img.example.com/g.jpg' } });
        fire({ event: 'send', user: 'uG2', textContent: { text: '이 귤 보관 어떻게 해요?' } });
        await sleep(WAIT + 20);
        ok(st.aiCalls.length === 1 && st.sends.length === 1 && st.sends[0].text === '평소 봇 답', 'g-2: 애매 + 글 → 평소 봇 답 1번(되묻기 안 나감)', st.sends);

        // i) 안쪽 망 주소 · 카카오 손님
        reset(); st.judgeResult = J('damage', 'high');
        fire({ event: 'send', user: 'uI', imageContent: { imageUrl: 'http://169.254.169.254/latest/meta-data' } });
        fire({ event: 'send', user: 'uI', imageContent: { imageUrl: 'http://localhost:3000/x' } });
        await sleep(WAIT);
        ok(st.downloads.length === 0, 'i: 안쪽 망 주소는 내려받지 않음', st.downloads);
        reset();
        fire({ event: 'send', user: 'kakao:1', imageContent: { imageUrl: 'https://img.example.com/k.jpg' } });
        await sleep(WAIT);
        ok(st.judgeCalls.length === 0 && st.sends.length === 0, 'i-2: 카카오 손님은 판독 길 안 탐');

        // j) 켜진 상태에서 글만 = 평소 길 그대로
        reset();
        fire({ event: 'send', user: 'uJ', textContent: { text: '황금향 얼마예요?' } });
        await sleep(WAIT);
        ok(st.aiCalls.length === 1 && st.sends.length === 1 && st.judgeCalls.length === 0 && st.tele.length === 0, 'j: 켜짐 + 글만 = 평소 봇 답 그대로(판독·알림 0)');

        // k) AI 오류 알림 — 같은 오류는 1시간에 1번
        reset(); st.aiError = '[Error] 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."},"request_id":"req_011A"}';
        fire({ event: 'send', user: 'uK1', textContent: { text: '주소는 서울시 어디 010-1111-2222' } });
        await sleep(WAIT);
        ok(st.sends.length === 0 && st.tele.length === 1 && st.tele[0].includes('잔액 부족'), 'k: AI 오류(잔액) → 텔레그램 1번 · 손님 답 0', st.tele);
        ok(!st.tele[0].includes('서울시') && !st.tele[0].includes('1111') && !st.tele[0].includes('req_'), 'k: 알림에 손님 글·요청 id 없음');
        ok(sqlHas(/INSERT INTO message_logs/).some(q => String(q.params[4]).startsWith('[AI에러:')), 'k: DB 기록 「[AI에러: …」 종전 그대로');
        st.aiError = st.aiError.replace('req_011A', 'req_011B');
        fire({ event: 'send', user: 'uK2', textContent: { text: '안녕하세요' } });
        await sleep(WAIT);
        ok(st.tele.length === 1, 'k: 같은 오류 두 번째는 알림 안 함(1시간 1번)', st.tele.length);
        st.aiError = '[Error] 529 {"type":"error","error":{"type":"overloaded_error"}}';
        fire({ event: 'send', user: 'uK3', textContent: { text: '안녕하세요' } });
        await sleep(WAIT);
        ok(st.tele.length === 2 && st.tele[1].includes('과부하'), 'k: 다른 종류 오류는 따로 알림', st.tele);
        st.aiError = null; reset();
        fire({ event: 'send', user: 'uK4', textContent: { text: '안녕하세요' } });
        await sleep(WAIT);
        ok(st.tele.length === 0 && st.sends.length === 1, 'k: 오류 없으면 알림 0 · 평소 답');
    } catch (e) {
        ok(false, '흐름 검증 중 예외', e.stack || e.message);
    } finally {
        console.log = logSaved; console.error = errSaved;
        global.setTimeout = realSetTimeout; global.setInterval = realSetInterval;
        if (envSaved.t === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = envSaved.t;
        if (envSaved.c === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = envSaved.c;
    }
}

(async () => {
    testReply();
    const a = pass, af = fail; console.log(`  → ${a}/${a + af}`);
    await testJudge();
    const b = pass - a, bf = fail - af; console.log(`  → ${b}/${b + bf}`);
    const hasBot = testCopies();
    const c = pass - a - b, cf = fail - af - bf; console.log(`  → ${c}/${c + cf}`);
    if (hasBot) { await testBotFlow(); const d = pass - a - b - c, df = fail - af - bf - cf; console.log(`  → ${d}/${d + df}`); }
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? `  (실패 ${fail})` : '  전부 통과'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

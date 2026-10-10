/* #610-J 사진 판독 시험 라우트 — 대표 PC 에 AI 키를 두지 않고, 서버(Render)의 키로 사진 판독 정답률을 재려고 만든 길
 *
 *   장착(총괄 · server.js):
 *     require('./sms/photo-test.js')(app, { authMiddleware, judge, reply, leakCheck, log });
 *       authMiddleware : 필수(회사프로그램 로그인 검사 · req.user 를 채움)
 *       judge          : 없으면 sms/photo-judge.js 의 judge
 *       reply          : 없으면 sms/photo-reply.js 의 reply
 *       leakCheck      : 없으면 sms/photo-reply.js 의 leakCheck
 *       log            : 함수(log(글)) 또는 console 꼴 객체({ log(){} }) 둘 다 받음 · 없으면 console.log (한 줄 요약만 — 사진·손님 글은 안 찍음)
 *
 *   POST /api/sms/photo-test   (관리자만 · req.user.role === 'admin')
 *     body { images:[{ name, contentType, data(base64) }], text?, channel:'sms'|'talk', expect? }
 *     → { ok, kind, confidence, size_guess, size_dir, staff_summary, customer_reply(null 가능), leak, tokens, ms, expect, match, error?, used, limit }
 *
 *   🔴 시험 전용: 손님 발송 0 · DB 저장 0 · 사진 저장 0(받아서 판독만 하고 버림).
 *      한 번에 사진 4장 · 사진 합계 10MB · 하루 100회(메모리 셈 — 서버가 다시 뜨면 0 부터).
 *      판독 1회 = Sonnet 호출 1회(콘솔 과금).
 */
'use strict';

const MAX_IMAGES = 4;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const DAILY_MAX = 100;
const KINDS = ['damage', 'size', 'other', 'not_fruit', 'unclear'];   // 기대값(expect)으로 받는 종류 — 'error'(판독 실패)는 기대값이 될 수 없다

function kstDay() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }

module.exports = function mountPhotoTest(app, deps) {
    const d = deps || {};
    if (!app || typeof app.post !== 'function') throw new Error('photo-test: app 이 필요합니다');
    if (typeof d.authMiddleware !== 'function') throw new Error('photo-test: authMiddleware 가 필요합니다');
    const judge = d.judge || require('./photo-judge.js').judge;
    const reply = d.reply || require('./photo-reply.js').reply;
    const leakCheck = d.leakCheck || require('./photo-reply.js').leakCheck;
    // sms/index.js 는 console 객체를 넘긴다(R5 S1: 함수로만 받다가 성공 요청마다 500) → 둘 다 받고, 로그가 실패해도 응답은 그대로 나가게
    const rawLog = typeof d.log === 'function' ? d.log : (d.log && typeof d.log.log === 'function' ? d.log.log.bind(d.log) : (...a) => console.log(...a));
    const log = (...a) => { try { rawLog(...a); } catch (e) { /* 로그 실패는 무시 */ } };
    const state = { day: '', used: 0 };

    app.post('/api/sms/photo-test', d.authMiddleware, async (req, res) => {
        try {
            if (!req.user || req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '관리자만 쓸 수 있습니다.' });
            const b = req.body || {};
            const list = Array.isArray(b.images) ? b.images : null;
            if (!list || !list.length) return res.status(400).json({ ok: false, error: '사진(images)이 없습니다.' });
            if (list.length > MAX_IMAGES) return res.status(400).json({ ok: false, error: `사진은 한 번에 ${MAX_IMAGES}장까지입니다.` });
            const channel = b.channel === 'talk' ? 'talk' : 'sms';
            const text = typeof b.text === 'string' ? b.text.slice(0, 1000) : '';
            const expect = KINDS.includes(b.expect) ? b.expect : null;

            const images = [];
            let total = 0;
            for (const it of list) {
                const raw = it && typeof it.data === 'string' ? it.data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '';
                if (!raw || !/^[A-Za-z0-9+/]+=*$/.test(raw)) return res.status(400).json({ ok: false, error: '사진 내용(data)이 base64 가 아닙니다: ' + String((it && it.name) || '').slice(0, 60) });
                const buf = Buffer.from(raw, 'base64');
                if (!buf.length) return res.status(400).json({ ok: false, error: '빈 사진입니다: ' + String((it && it.name) || '').slice(0, 60) });
                total += buf.length;
                if (total > MAX_TOTAL_BYTES) return res.status(413).json({ ok: false, error: '사진 합계가 10MB 를 넘습니다.' });
                images.push({ buf, contentType: String((it && it.contentType) || '') });
            }

            const day = kstDay();
            if (state.day !== day) { state.day = day; state.used = 0; }
            if (state.used >= DAILY_MAX) return res.status(429).json({ ok: false, error: `오늘 시험 횟수(${DAILY_MAX}회)를 다 썼습니다. 내일 다시 해 주세요.`, used: state.used, limit: DAILY_MAX });
            state.used++;

            const t0 = Date.now();
            let j;
            try { j = await judge(images, { text, channel }); }
            catch (e) { j = { kind: 'error', confidence: 'low', size_guess: null, size_dir: null, staff_summary: '', raw: { error: String((e && e.message) || e).slice(0, 160) } }; }
            j = j || {};
            const raw = j.raw || {};
            let customer_reply = null;
            try { customer_reply = reply(j, { channel }); } catch (e) { customer_reply = null; }
            const leak = customer_reply ? leakCheck(customer_reply) : '';
            const usage = raw.usage || null;
            const out = {
                ok: !raw.error,
                kind: j.kind, confidence: j.confidence, size_guess: j.size_guess == null ? null : j.size_guess, size_dir: j.size_dir == null ? null : j.size_dir,
                staff_summary: j.staff_summary || '',
                customer_reply, leak,
                tokens: usage ? { input: usage.input_tokens == null ? null : usage.input_tokens, output: usage.output_tokens == null ? null : usage.output_tokens } : null,
                ms: Date.now() - t0,
                images: images.length, resized: raw.resized == null ? null : raw.resized,
                expect, match: expect ? expect === j.kind : null,
                used: state.used, limit: DAILY_MAX
            };
            if (raw.error) out.error = String(raw.error).slice(0, 200);
            log(`[사진시험] ${req.user.name || req.user.username || req.user.id} · ${images.length}장 · ${j.kind}/${j.confidence}${expect ? ' · 기대 ' + expect : ''} · ${out.ms}ms · ${state.used}/${DAILY_MAX}${raw.error ? ' · 오류' : ''}`);
            res.json(out);
        } catch (e) {
            res.status(500).json({ ok: false, error: '시험 중 오류: ' + String((e && e.message) || e).slice(0, 160) });
        }
    });

    return { state, MAX_IMAGES, MAX_TOTAL_BYTES, DAILY_MAX };
};
module.exports.KINDS = KINDS;

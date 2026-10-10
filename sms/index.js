// #610 회사폰(폴드7) 문자 반자동 응대 — 서버 쪽 핵심(총괄 · 2026-10-10)
//   구조: 회사폰의 SMSGate 앱(cloud 모드)이 받은 문자·보낸 문자·전송 결과·MMS 사진을 이 서버의 /api/sms/webhook 으로 올린다.
//         서버는 문자 표(sms_threads · sms_messages · sms_images)에 적고, 모드에 따라 ①record = 기록만 ②draft = 봇 초안만(직원이 [이대로 보내기])
//         ③auto = 유예(기본 75초) 뒤 자동 발송. 보내기는 SMSGate cloud API 에 Basic 인증으로 POST(폰이 실제 SMS 를 보냄 · 0원).
//   🔴 원칙: 상태는 전부 DB(재시작 안전 · 톡톡봇의 메모리 Map 방식은 쓰지 않는다) · 봇 발송분 판정은 gateway_id(메시지 id)로 대조(글자 일치 아님)
//           · 손님 전체 번호·주소는 화면 API 밖으로 안 나감(끝 4자리 · 가림값) · 사진은 sms_images 에 두고 30일 뒤 비움(db_retention.enabled 가 true 일 때만)
//           · 직원이 폰에서 손으로 보낸 문자(sms:sent 인데 우리가 보낸 id 가 아님)는 staff_phone 으로 적고 그 대화의 봇 초안·큐를 전부 멈춤(이중 답변 차단).
//   의존 모듈(워커 몫 · 없으면 그 기능만 꺼짐 · 서버는 그대로 돈다): sms/classify.js(가르기) · sms/rules.js(규칙 답) · sms/lookup.js(번호→주문) · sms/photo-judge.js + photo-reply.js(사진)
//   설정 = agent_office_config 'sms_gateway' { enabled, mode:'record'|'draft'|'auto', cooldown_min:30, daily_cap:1, hourly_send_cap:30, hold_sec:75,
//                                             staff_ids:[], ping_alert_hours:3, image_days:30, lookup_days:14, max_chars:70, ttl_sec:600 }  · 행이 없으면 enabled false = webhook 은 받되 기록만.
//   🔴 워커2 소스 확인(10/10): 직원이 삼성 메시지에서 손으로 보낸 문자는 앱이 서버로 올리지 않는다(앱 자신이 보낸 것의 결과만) → 「직원 답변됨」은 화면(에이전트 오피스) 발송으로만 생긴다.
//      그래서 ①봇은 한 대화에 하루 한 번만 답하고(daily_cap 1) 그 뒤 손님 글은 전부 직원 몫 ②직원 몫·직원 답변 상태의 대화는 사람이 풀 때까지 봇 침묵(잠금) ③webhook 은 즉시 200 을 주고 뒤에서 처리(30초 넘으면 2일간 재시도 → 이중 답변).
//      ④한글 70자 넘는 글은 앱이 분할 SMS 로 보냄(국내 통신사 동작 미확인 · 시험 b-2) → 확정 전까지 봇 답은 max_chars(70) 단위 문장 경계로 나눠 여러 통.
//   env = SMSGATE_SIGNING_KEY(webhook 서명 키 · 폰 Settings → Webhooks · 없으면 webhook 503 잠김) · SMSGATE_USER · SMSGATE_PASS(cloud 모드 아이디·비번) · SMSGATE_API_BASE(기본 https://api.sms-gate.app/3rdparty/v1)
//         · SMS_PUBLIC_URL(webhook 등록용 우리 주소 · 기본 https://jeju-acom-company.onrender.com)
'use strict';
const crypto = require('crypto');

const DEFAULT_CFG = { enabled: false, mode: 'record', cooldown_min: 30, daily_cap: 1, hourly_send_cap: 30, hold_sec: 75, staff_ids: [], ping_alert_hours: 3, image_days: 30, lookup_days: 14, max_chars: 70, ttl_sec: 600 };
const WEBHOOK_EVENTS = ['sms:received', 'sms:sent', 'sms:delivered', 'sms:failed', 'sms:cancelled', 'mms:received', 'mms:downloaded', 'system:ping', 'app:started'];
const MODES = ['record', 'draft', 'auto'];
const STATUSES = ['new', 'bot_replied', 'cooldown', 'staff_needed', 'draft', 'staff_replied', 'closed', 'ignored'];
const SMS_MAX_BYTES = 900;   // LMS 한도 안(2,000바이트) 여유 — 긴 글은 문장 단위로 자른다

const digitsOnly = s => String(s || '').replace(/[^0-9]/g, '');
function normalizePhone(s) {
    let d = digitsOnly(s);
    if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);   // +82 10 … → 010 …
    return d;
}
const phoneTail = d => String(d || '').slice(-4);
const phoneMasked = d => { d = String(d || ''); return d.length >= 7 ? d.slice(0, 3) + '****' + d.slice(-4) : (d ? '***' + d.slice(-2) : ''); };
const kstDate = ms => new Date((ms || Date.now()) + 9 * 3600e3).toISOString().slice(0, 10);
const byteLen = s => Buffer.byteLength(String(s || ''), 'utf8');
// 문자 안전 글자: 이모지·그림 기호 제거 · 공백 정리 · 900바이트 안으로 문장 단위 자르기(워커3 sms-safe 가 오면 그쪽으로 합침)
function smsSafeText(s) {
    let t = String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B50}\u{2B06}\u{2194}-\u{21AA}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}]/gu, '')
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (byteLen(t) <= SMS_MAX_BYTES) return t;
    const parts = t.split(/(?<=[.!?。]|요\.|다\.)\s+/);
    let out = '';
    for (const p of parts) { if (byteLen(out + (out ? ' ' : '') + p) > SMS_MAX_BYTES) break; out += (out ? ' ' : '') + p; }
    return out || Buffer.from(t, 'utf8').slice(0, SMS_MAX_BYTES - 3).toString('utf8').replace(/�/g, '') + '…';
}
// 봇·직원 답을 max_chars 글자(유니코드 글자 수 · 앱의 분할 기준) 단위로 문장 경계에서 나눔 — 한 통에 들어가면 그대로 1통
function splitForSms(text, maxChars) {
    const t = String(text || '').trim(); if (!t) return [];
    const len = x => Array.from(x).length;
    if (len(t) <= maxChars) return [t];
    const sentences = t.split(/(?<=[.!?。])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    const out = []; let cur = '';
    for (let sen of sentences) {
        while (len(sen) > maxChars) {   // 문장 하나가 한도보다 길면 어절 경계로
            const words = sen.split(' '); let piece = '';
            while (words.length && len(piece + (piece ? ' ' : '') + words[0]) <= maxChars) piece += (piece ? ' ' : '') + words.shift();
            if (!piece) { piece = Array.from(sen).slice(0, maxChars).join(''); sen = Array.from(sen).slice(maxChars).join(''); } else sen = words.join(' ');
            if (cur) { out.push(cur); cur = ''; }
            out.push(piece);
        }
        if (!sen) continue;
        if (len(cur + (cur ? ' ' : '') + sen) <= maxChars) cur += (cur ? ' ' : '') + sen; else { if (cur) out.push(cur); cur = sen; }
    }
    if (cur) out.push(cur);
    return out;
}
function optional(path) { try { return require(path); } catch (e) { if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(path.replace('./', ''))) return null; throw e; } }

module.exports = function mountSms(app, deps) {
    const { pool, authMiddleware, naverCfgGet, naverCfgSet, writeAudit, createNotification, notifyTelegram, loadShippingHolidayInfo, qnaGenerate, cjTrack, deliveryUpsertStatus, log = console } = deps;
    const classifyMod = optional('./classify.js'), rulesMod = optional('./rules.js'), lookupMod = optional('./lookup.js'), photoJudge = optional('./photo-judge.js'), photoReply = optional('./photo-reply.js'), aiNote = optional('./ai-note.js'), safeMod = optional('./sms-safe.js');
    const smsSafe = t => (safeMod && typeof safeMod.smsSafe === 'function') ? safeMod.smsSafe(t) : smsSafeText(t);   // 워커3 sms-safe(꼬리 줄·「톡톡」·「네이버 페이」 제거 포함) 우선

    // ── 설정 ──
    function cfgOf(raw) {
        const v = (raw && typeof raw === 'object') ? raw : {};
        const num = (x, d, min, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
        return {
            enabled: v.enabled === true,
            mode: MODES.includes(v.mode) ? v.mode : DEFAULT_CFG.mode,
            cooldown_min: num(v.cooldown_min, DEFAULT_CFG.cooldown_min, 1, 1440),
            daily_cap: num(v.daily_cap, DEFAULT_CFG.daily_cap, 1, 50),
            hourly_send_cap: num(v.hourly_send_cap, DEFAULT_CFG.hourly_send_cap, 1, 500),
            hold_sec: num(v.hold_sec, DEFAULT_CFG.hold_sec, 0, 600),
            staff_ids: Array.isArray(v.staff_ids) ? v.staff_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [],
            ping_alert_hours: num(v.ping_alert_hours, DEFAULT_CFG.ping_alert_hours, 1, 48),
            image_days: num(v.image_days, DEFAULT_CFG.image_days, 3, 365),
            lookup_days: num(v.lookup_days, DEFAULT_CFG.lookup_days, 3, 60),
            max_chars: num(v.max_chars, DEFAULT_CFG.max_chars, 40, 2000),
            ttl_sec: num(v.ttl_sec, DEFAULT_CFG.ttl_sec, 5, 86400),
        };
    }
    let _cfgCache = null, _cfgAt = 0;
    async function cfg(force) {
        if (!force && _cfgCache && Date.now() - _cfgAt < 10000) return _cfgCache;
        _cfgCache = cfgOf(await naverCfgGet('sms_gateway')); _cfgAt = Date.now();
        return _cfgCache;
    }

    // ── 표 ──
    async function initDB() {
        await pool.query(`CREATE TABLE IF NOT EXISTS sms_threads (
            id serial PRIMARY KEY, phone_digits text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'new',
            last_in_at timestamptz, last_out_at timestamptz, last_in_text text, last_out_text text, has_image boolean DEFAULT false,
            cooldown_until timestamptz, bot_count_day date, bot_count integer DEFAULT 0, ask_count integer DEFAULT 0,
            staff_user_id integer, staff_name text, handled_at timestamptz, draft_text text, draft_kind text, order_hint text, order_json jsonb, last_out_state text,
            created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_threads_status ON sms_threads(status, updated_at DESC)`);
        await pool.query(`ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS last_out_state text`);
        await pool.query(`CREATE TABLE IF NOT EXISTS sms_messages (
            id serial PRIMARY KEY, thread_id integer NOT NULL REFERENCES sms_threads(id), direction text NOT NULL, kind text NOT NULL DEFAULT 'sms',
            body text, sender text NOT NULL, state text NOT NULL DEFAULT 'received', gateway_id text, sim_number integer,
            bucket text, rule_kind text, ai_json jsonb, send_after timestamptz, sent_at timestamptz, delivered_at timestamptz, fail_reason text,
            event_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now())`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_thread ON sms_messages(thread_id, id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_gw ON sms_messages(gateway_id) WHERE gateway_id IS NOT NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_queue ON sms_messages(state, send_after) WHERE state = 'queued'`);
        await pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS envelope_id text, ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_envelope ON sms_messages(envelope_id) WHERE envelope_id IS NOT NULL`);
        await pool.query(`CREATE TABLE IF NOT EXISTS sms_images (
            id serial PRIMARY KEY, message_id integer NOT NULL REFERENCES sms_messages(id), content_type text, name text, size_bytes integer,
            data bytea, purged_at timestamptz, created_at timestamptz DEFAULT now())`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_images_msg ON sms_images(message_id)`);
        // 번호 → 주문(#610-C · 워커4 설계): 구매자 번호 + 숫자만 칸 + 인덱스 — 종전 칸은 그대로(ship-upload.js 가 채움)
        // 🔴 digits 두 칸은 생성 칸(GENERATED STORED) — INSERT·UPDATE 에 값을 주면 오류 · 올리는 길은 buyer_phone 만 채운다(워커4)
        await pool.query(`ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS buyer_phone text`);
        await pool.query(`ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS phone_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) STORED`);
        await pool.query(`ALTER TABLE delivery_shipments ADD COLUMN IF NOT EXISTS buyer_digits text GENERATED ALWAYS AS (regexp_replace(COALESCE(buyer_phone, ''), '[^0-9]', '', 'g')) STORED`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_phone_digits ON delivery_shipments(phone_digits) WHERE phone_digits <> ''`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_buyer_digits ON delivery_shipments(buyer_digits) WHERE buyer_digits <> ''`);
    }

    // ── 서명 검증(SMSGate webhook: X-Signature = HMAC-SHA256(secret, rawBody + X-Timestamp) · 워커2 스펙으로 최종 확정) ──
    function verifySignature(req) {
        const secret = process.env.SMSGATE_SIGNING_KEY || process.env.SMSGATE_WEBHOOK_SECRET;
        if (!secret) return { ok: false, why: 'no_secret' };
        const sig = String(req.get('X-Signature') || '').trim().toLowerCase();
        const ts = String(req.get('X-Timestamp') || '').trim();
        if (!sig || !ts) return { ok: false, why: 'no_sig' };
        const raw = req.rawBody != null ? req.rawBody : JSON.stringify(req.body || {});
        const h = crypto.createHmac('sha256', secret).update(raw + ts).digest('hex');
        const a = Buffer.from(h), b = Buffer.from(sig);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, why: 'bad_sig' };
        const skew = Math.abs(Date.now() / 1000 - Number(ts));
        if (!(skew < 3 * 24 * 3600)) return { ok: false, why: 'stale' };   // 재시도(2일 · 처음 시각 그대로일 수 있음)까지 받는다
        return { ok: true };
    }

    // ── 대화·메시지 ──
    async function threadFor(digits) {
        const r = await pool.query(`INSERT INTO sms_threads (phone_digits) VALUES ($1) ON CONFLICT (phone_digits) DO UPDATE SET updated_at = now() RETURNING *`, [digits]);
        return r.rows[0];
    }
    async function setThread(id, fields) {
        const keys = Object.keys(fields); if (!keys.length) return;
        const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await pool.query(`UPDATE sms_threads SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map(k => fields[k] && typeof fields[k] === 'object' && !(fields[k] instanceof Date) ? JSON.stringify(fields[k]) : fields[k])]);
    }
    async function addMessage(m) {   // envelope_id 가 있으면 같은 봉투는 한 번만(ON CONFLICT DO NOTHING → null 반환 = 중복)
        const r = await pool.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, gateway_id, sim_number, bucket, rule_kind, ai_json, send_after, event_at, envelope_id, priority)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,COALESCE($13, now()),$14,$15) ON CONFLICT (envelope_id) WHERE envelope_id IS NOT NULL DO NOTHING RETURNING *`,
            [m.thread_id, m.direction, m.kind || 'sms', m.body == null ? null : String(m.body), m.sender, m.state || 'received', m.gateway_id || null, m.sim_number || null,
                m.bucket || null, m.rule_kind || null, m.ai_json ? JSON.stringify(m.ai_json) : null, m.send_after || null, m.event_at || null, m.envelope_id || null, Number.isInteger(m.priority) ? m.priority : 0]);
        return r.rows[0] || null;
    }
    async function staffUserIds(c) {
        if (c.staff_ids.length) return c.staff_ids;
        const r = await pool.query(`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY id`);
        return r.rows.map(x => x.id);
    }
    // 직원 알림(화면 알림 + 폰 푸시 · type 'sms' · 손님 번호·이름 없이 끝 4자리만)
    async function notifyStaff(c, thread, title, message) {
        const ids = await staffUserIds(c);
        for (const uid of ids) await createNotification(uid, 'sms', title, message, `agent-office?sms=${thread.id}`);
        return ids.length;
    }
    async function bumpBotCount(thread) {
        const today = kstDate();
        const n = (thread.bot_count_day && kstDate(new Date(thread.bot_count_day).getTime() + 12 * 3600e3) === today) ? (thread.bot_count || 0) : 0;
        await setThread(thread.id, { bot_count_day: today, bot_count: n + 1 });
        return n + 1;
    }
    function botCountToday(thread) {
        const today = kstDate();
        return (thread.bot_count_day && kstDate(new Date(thread.bot_count_day).getTime() + 12 * 3600e3) === today) ? (thread.bot_count || 0) : 0;
    }

    // ── 번호 → 주문(워커4 lookup.js 가 오기 전엔 null) ──
    async function orderFor(digits, c) {
        if (!lookupMod || typeof lookupMod.lookupByPhone !== 'function') return null;
        try {
            let r = await lookupMod.lookupByPhone(pool, digits, { days: c.lookup_days });
            if (r && r.match === 'one' && typeof lookupMod.refreshOrder === 'function') {
                try { r = await lookupMod.refreshOrder(pool, r, { maxBoxes: 3 }); } catch (e) { log.error('[문자] 배송 상태 재조회 실패(무시):', e.message); }
            }
            return r;
        } catch (e) { log.error('[문자] 주문 찾기 실패(무시):', e.message); return null; }
    }
    // 화면·힌트용(허용 목록만 · 주소·전체 번호·운송장 전체 없음) — toPublic 이 돌려준 객체 + 한 줄 요약
    function orderHintOf(r) {
        if (!(r && r.match === 'one' && r.order)) return null;
        const pubo = (typeof lookupMod.toPublic === 'function') ? lookupMod.toPublic(r) : null;
        if (!pubo) return null;
        const d = pubo.ship_date ? String(pubo.ship_date).slice(5).replace('-', '/') : '';
        const line = [pubo.partner, d ? d + ' 발송' : '', pubo.option_text, pubo.boxes > 1 ? pubo.boxes + '상자' : '', pubo.status_label].filter(Boolean).join(' · ');
        return Object.assign({ line, role: r.role || null }, pubo);
    }

    // ── 답 만들기: 규칙 → AI. 결과 { text, kind:'rule'|'ai'|'ask', toStaff:boolean, why } ──
    async function composeAnswer(thread, inMsg, c, lookup) {
        const text = String(inMsg.body || '');
        const bucket = inMsg.bucket || 'other';
        if (['otp', 'ad', 'carrier', 'greeting'].includes(bucket)) return { text: null, kind: null, toStaff: false, why: 'ignore:' + bucket };
        if (bucket === 'claim' || bucket === 'photo') return { text: null, kind: null, toStaff: true, why: bucket };
        if (lookup && lookup.match === 'many') return { text: lookupMod && lookupMod.askText ? lookupMod.askText() : '주문을 여러 건 찾았어요. 어느 분께 보내신 건인지 받는 분 성함을 알려 주시면 확인해 드릴게요.', kind: 'ask', toStaff: false, why: 'many' };
        if (rulesMod && typeof rulesMod.answer === 'function') {
            try {
                const holidays = loadShippingHolidayInfo ? await loadShippingHolidayInfo() : null;
                const r = rulesMod.answer({ text, bucket, order: lookup, holidays, now: Date.now() });
                if (r && r.staff) return { text: null, kind: null, toStaff: true, why: 'rule_' + (r.why || 'staff') };   // 예약 상품 · 발송/도착 예정일 지남 = 규칙이 「사람」으로 판정
                if (r && r.text) return { text: smsSafe(r.text), kind: 'rule', rule_kind: r.kind || null, toStaff: false, why: 'rule' };
            } catch (e) { log.error('[문자] 규칙 답 실패(무시):', e.message); }
        }
        if (typeof qnaGenerate === 'function') {
            try {
                const g = await qnaGenerate(text, null, undefined, 'sms');
                if (g && g.answer) {
                    const parsed = aiNote && typeof aiNote.parse === 'function' ? aiNote.parse(g.answer) : { toStaff: /^\[사람\]/.test(g.answer), text: g.answer.replace(/^\[사람\]\s*/, '') };
                    if (parsed.toStaff) return { text: null, kind: null, toStaff: true, why: 'ai_to_staff' };
                    return { text: smsSafe(parsed.text), kind: 'ai', toStaff: false, why: 'ai', used: g.used };
                }
                return { text: null, kind: null, toStaff: true, why: 'ai_skip' };
            } catch (e) { log.error('[문자] AI 답 실패:', e.message); return { text: null, kind: null, toStaff: true, why: 'ai_error' }; }
        }
        return { text: null, kind: null, toStaff: true, why: 'no_engine' };
    }

    // ── 받은 문자 처리(핵심 흐름) ──
    const LATE_MS = 30 * 60000;   // 이보다 오래된 사건(재시도로 뒤늦게 옴 · 비행기 모드 뒤 몰려 옴)은 답하지 않고 직원 몫
    const imageOnly = atts => (Array.isArray(atts) ? atts : []).filter(im => im && /^image\//i.test(String(im.contentType || '')));
    const textParts = atts => (Array.isArray(atts) ? atts : []).filter(im => im && /^text\/plain/i.test(String(im.contentType || '')) && im.data).map(im => Buffer.from(String(im.data), 'base64').toString('utf8').trim()).filter(Boolean);
    async function saveImages(msgId, images) {
        let n = 0;
        for (const im of images) {
            const buf = im.data ? Buffer.from(String(im.data), 'base64') : null;
            await pool.query(`INSERT INTO sms_images (message_id, content_type, name, size_bytes, data) VALUES ($1,$2,$3,$4,$5)`, [msgId, im.contentType || null, im.name || null, buf ? buf.length : (im.size || null), buf]);
            if (buf) n++;
        }
        return n;
    }
    // 받은 문자 기록 — { recordOnly } 면 상태 판정 없이 줄만(mms:received 메타 단계) · 봉투 중복이면 { dup:true }
    async function handleInbound({ digits, body, kind, gateway_id, sim_number, event_at, images, envelope_id, recordOnly }) {
        const c = await cfg();
        const thread = await threadFor(digits);
        const imgs = imageOnly(images);
        const bodyText = String(body || '').trim() || textParts(images).join('\n');
        const hasImage = imgs.length > 0;
        const bucket = recordOnly ? 'photo_pending' : bucketOf(bodyText, digits, hasImage);
        const msg = await addMessage({ thread_id: thread.id, direction: 'in', kind: kind || (hasImage ? 'mms' : 'sms'), body: bodyText, sender: 'customer', state: 'received', gateway_id, sim_number, bucket, event_at, envelope_id });
        if (!msg) return { thread_id: thread.id, dup: true, action: 'dup' };
        if (hasImage) await saveImages(msg.id, imgs);
        if (recordOnly) { await setThread(thread.id, { last_in_at: msg.event_at, last_in_text: thread.last_in_text || '', has_image: thread.has_image || hasImage }); return { thread_id: thread.id, message_id: msg.id, bucket, action: 'pending_photo' }; }
        return decideInbound(thread, msg, c, { bodyText, images: imgs });
    }
    function bucketOf(bodyText, digits, hasImage) {
        let bucket = null;
        if (classifyMod && typeof classifyMod.classify === 'function') {
            try { bucket = (classifyMod.classify(bodyText, { hasImage, isKnownCustomer: null, from: digits, fromShortCode: digits.length < 10 }) || {}).bucket || null; } catch (e) { log.error('[문자] 가르기 실패(무시):', e.message); }
        }
        if (!bucket) bucket = hasImage && bodyText.length < 8 ? 'photo' : (digits.length < 10 ? 'carrier' : 'other');
        return bucket;
    }
    // 판정·답 — thread 는 이 글이 오기 전 상태 · msg 는 기록된 줄 · images 는 바이트 있는 사진만
    async function decideInbound(thread, msg, c, { bodyText, images }) {
        const digits = thread.phone_digits, hasImage = images.length > 0, bucket = msg.bucket;
        const patch = { last_in_at: msg.event_at, last_in_text: bodyText.slice(0, 300), has_image: thread.has_image || hasImage };
        const done = (action, extra) => Object.assign({ thread_id: thread.id, message_id: msg.id, bucket, action }, extra || {});
        // 무시 갈래(인증번호·광고·통신사) — 기록만 · 상태 ignored(이미 대화 중인 손님 글은 상태 유지)
        if (['otp', 'ad', 'carrier'].includes(bucket) && !['bot_replied', 'staff_needed', 'draft', 'cooldown', 'staff_replied'].includes(thread.status)) {
            await setThread(thread.id, Object.assign(patch, { status: 'ignored' })); return done('ignored');
        }
        if (bucket === 'greeting' && thread.status !== 'new') { await setThread(thread.id, patch); return done('noop'); }
        // 직원 몫·직원 답변 상태(잠금)로 손님이 다시 보냄 → 봇 침묵 + 알림
        if (thread.status === 'staff_replied' || thread.status === 'staff_needed') {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 손님이 다시 보냈어요`, bodyText.slice(0, 80) || (hasImage ? '사진' : ''));
            return done('staff_again');
        }
        // 기록만(꺼짐 · record 모드) — 아무 것도 보내지 않음 · 알림은 클레임·사진만
        if (!c.enabled || c.mode === 'record') {
            const toStaff = bucket === 'claim' || bucket === 'photo';
            await setThread(thread.id, Object.assign(patch, { status: toStaff ? 'staff_needed' : 'new' }));
            if (toStaff && c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} ${bucket === 'photo' ? '사진' : '확인 필요'}`, bodyText.slice(0, 80) || '사진이 왔어요');
            return done('recorded');
        }
        // 뒤늦게 들어온 옛 사건(재시도·비행기 모드) → 답하지 않고 직원 몫
        if (msg.event_at && Date.now() - new Date(msg.event_at).getTime() > LATE_MS) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 늦게 들어온 문자(봇 답 안 함)`, bodyText.slice(0, 80) || (hasImage ? '사진' : ''));
            return done('late_to_staff');
        }
        // 쿨다운 안 · 오늘 봇이 이미 답함(daily_cap) → 직원 몫(대표 10/9 「30분 뒤 다시 온 것은 직원」)
        const inCooldown = thread.cooldown_until && new Date(thread.cooldown_until).getTime() > Date.now();
        if (inCooldown || botCountToday(thread) >= c.daily_cap) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 답 뒤 다시 왔어요`, bodyText.slice(0, 80) || (hasImage ? '사진' : ''));
            return done('cooldown_to_staff');
        }
        // 번호로 주문 찾기 → 답 만들기
        const lookup = await orderFor(digits, c);
        const hint = orderHintOf(lookup);
        if (hint) Object.assign(patch, { order_hint: hint.line || null, order_json: hint });
        if (lookup && lookup.match === 'one' && lookup.order) lookup.order = Object.assign({}, lookup.order, { option: lookup.order.option_text || lookup.order.option });   // rules.js 는 option/option_text 둘 다 읽음
        let ans;
        if (hasImage && bucket === 'photo' && photoJudge && photoReply) ans = await composePhotoAnswer(thread, msg, c, lookup, images, bodyText);
        else if (hasImage && bucket === 'photo') ans = { text: null, toStaff: true, why: 'photo' };
        else ans = await composeAnswer(thread, msg, c, lookup);
        if (ans.ai_json) await pool.query(`UPDATE sms_messages SET ai_json = $2::jsonb WHERE id = $1`, [msg.id, JSON.stringify(ans.ai_json)]).catch(() => { });
        if (ans.why && ans.why.startsWith('ignore:')) { await setThread(thread.id, Object.assign(patch, { status: thread.status === 'new' ? 'ignored' : thread.status })); return done('ignored'); }
        if (ans.toStaff || !ans.text) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: ans.text || null, draft_kind: ans.kind || null }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 직원 답 필요(${labelWhy(ans.why)})`, (ans.staff_summary || bodyText).slice(0, 100) || (hasImage ? '사진' : ''));
            return done('to_staff', { why: ans.why });
        }
        if (c.mode === 'draft') {
            await setThread(thread.id, Object.assign(patch, { status: 'draft', draft_text: ans.text, draft_kind: ans.kind }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 초안 확인`, ans.text.slice(0, 100));
            return done('draft', { kind: ans.kind });
        }
        // auto — 유예(hold_sec) 뒤 발송 큐에(그 사이 직원이 화면에서 답하면 취소) · 여러 통은 priority 9,8,7… 로 순서 보장(앱 기본 LIFO)
        const sendAfter = new Date(Date.now() + c.hold_sec * 1000);
        const pieces = splitForSms(ans.text, c.max_chars);
        let out = null;
        for (let i = 0; i < pieces.length; i++) {
            const m = await addMessage({ thread_id: thread.id, direction: 'out', kind: 'sms', body: pieces[i], sender: 'bot', state: 'queued', rule_kind: ans.rule_kind || ans.kind, priority: Math.max(0, 9 - i), ai_json: Object.assign({ why: ans.why, part: i + 1, parts: pieces.length }, ans.used ? { used: ans.used } : {}), send_after: sendAfter });
            if (!out) out = m;
        }
        await setThread(thread.id, Object.assign(patch, { status: 'bot_replied', draft_text: null, draft_kind: null }));
        if (ans.kind === 'ask') await setThread(thread.id, { ask_count: (thread.ask_count || 0) + 1 });
        if (ans.staff_summary) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇이 답했어요(사진)`, ans.staff_summary.slice(0, 100));
        return done('queued', { out_id: out.id, parts: pieces.length, kind: ans.kind, send_after: sendAfter.toISOString() });
    }
    // mms:downloaded — 같은 번호의 최근 10분 안 「사진 받는 중」 줄에 사진·글을 붙이고 그 줄로 판정(없으면 새 수신으로)
    async function attachDownloaded(e) {
        const prev = e.digits ? (await pool.query(`SELECT m.*, t.phone_digits FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.kind = 'mms' AND m.bucket = 'photo_pending' AND m.event_at > now() - interval '10 minutes' ORDER BY m.id DESC LIMIT 1`, [e.digits])).rows[0] : null;
        const imgs = imageOnly(e.attachments);
        const bodyText = String(e.body || '').trim() || textParts(e.attachments).join('\n');
        if (!prev) {
            if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' };
            return Object.assign({ ok: true, event: e.ev }, await handleInbound({ digits: e.digits, body: bodyText, kind: imgs.length ? 'mms' : 'sms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, images: imgs, envelope_id: e.envelope_id }));
        }
        const c = await cfg();
        const thread = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [prev.thread_id])).rows[0];
        const n = await saveImages(prev.id, imgs);
        if (n) await pool.query(`DELETE FROM sms_images WHERE message_id = $1 AND data IS NULL AND purged_at IS NULL`, [prev.id]);
        const bucket = bucketOf(bodyText, thread.phone_digits, n > 0);
        await pool.query(`UPDATE sms_messages SET body = $2, bucket = $3, kind = $4 WHERE id = $1`, [prev.id, bodyText, bucket, n > 0 ? 'mms' : 'sms']);
        const msg = Object.assign({}, prev, { body: bodyText, bucket, kind: n > 0 ? 'mms' : 'sms' });
        const rows = n ? (await pool.query(`SELECT content_type, data FROM sms_images WHERE message_id = $1 AND data IS NOT NULL ORDER BY id`, [prev.id])).rows.map(r => ({ contentType: r.content_type, data: r.data.toString('base64') })) : [];
        return Object.assign({ ok: true, event: e.ev, attached: n }, await decideInbound(thread, msg, c, { bodyText, images: rows }));
    }
    // mms:received 뒤 mms:downloaded 가 5분 안 안 오면 「사진 못 받음」 → 직원 몫(삼성 메시지 자동 가져오기 꺼짐 등)
    async function pendingPhotoTick() {
        const rows = (await pool.query(`SELECT m.id, m.thread_id, t.phone_digits, t.status FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE m.direction = 'in' AND m.bucket = 'photo_pending' AND m.event_at < now() - interval '5 minutes' ORDER BY m.id LIMIT 20`)).rows;
        const c = await cfg();
        for (const r of rows) {
            await pool.query(`UPDATE sms_messages SET bucket = 'photo' WHERE id = $1`, [r.id]);
            await setThread(r.thread_id, { status: 'staff_needed', last_in_text: '(사진 · 파일을 못 받았어요)' });
            if (c.enabled) await notifyStaff(c, { id: r.thread_id }, `문자 · 끝 ${phoneTail(r.phone_digits)} 사진을 못 받았어요`, '폰 삼성 메시지에서 직접 확인해 주세요(MMS 자동 가져오기 설정)');
        }
        return rows.length;
    }
    const labelWhy = w => ({ claim: '불만·클레임', photo: '사진', ai_to_staff: 'AI 판단', ai_skip: 'AI 답 없음', ai_error: 'AI 오류', no_engine: '엔진 없음', photo_not_fruit: '과일 사진 아님', photo_unclear: '사진 불명확' }[w] || w || '');

    // 사진 판독(워커5 모듈 · 톡톡과 같은 규칙: 직원이 30분 안에 답한 대화면 침묵 + 직원 요약만) — 손님 문구는 photo-reply 가 3벌에서 고름(숫자 없음)
    async function composePhotoAnswer(thread, msg, c, lookup, images, text) {
        try {
            const bufs = images.filter(im => im.data).map(im => ({ buf: Buffer.isBuffer(im.data) ? im.data : Buffer.from(String(im.data), 'base64'), contentType: im.contentType || 'image/jpeg' }));
            if (!bufs.length) return { text: null, toStaff: true, why: 'photo', staff_summary: '사진이 왔지만 파일을 받지 못했어요(메타만)' };
            const lastOrder = lookup && lookup.match === 'one' ? lookup.order : null;
            const j = await photoJudge.judge(bufs, { text, lastOrder, channel: 'sms' });
            const staffSummary = j && j.staff_summary ? j.staff_summary : '';
            if (!j || j.kind === 'not_fruit') return { text: null, toStaff: true, why: 'photo_not_fruit', staff_summary: staffSummary, ai_json: j };
            const reply = photoReply.reply(j, { channel: 'sms', lastOrder, prevOrder: lookup && lookup.prev ? lookup.prev : null });
            if (!reply) return { text: null, toStaff: true, why: 'photo_unclear', staff_summary: staffSummary, ai_json: j };
            return { text: smsSafe(reply), kind: 'photo', toStaff: false, why: 'photo_' + j.kind, staff_summary: staffSummary || `사진 판독: ${j.kind}`, ai_json: j };
        } catch (e) { log.error('[문자] 사진 판독 실패:', e.message); return { text: null, toStaff: true, why: 'photo', staff_summary: '사진 판독 실패 · 직접 확인' }; }
    }

    // ── 보낸 문자 결과 · 직원 수동 발신 ──
    async function handleSent(ev) {   // ev = { gateway_id, digits, body, state:'sent'|'delivered'|'failed', reason, event_at, sim_number }
        const own = ev.gateway_id ? (await pool.query(`SELECT m.*, t.phone_digits FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE m.gateway_id = $1 AND m.direction = 'out' LIMIT 1`, [ev.gateway_id])).rows[0] : null;
        if (own) {
            const f = ev.state === 'delivered' ? { state: 'delivered', delivered_at: ev.event_at || new Date() }
                : ev.state === 'failed' ? { state: 'failed', fail_reason: String(ev.reason || '').slice(0, 200) }
                    : { state: 'sent', sent_at: ev.event_at || new Date() };
            const keys = Object.keys(f);
            await pool.query(`UPDATE sms_messages SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 AND NOT (state = 'delivered' AND $${keys.length + 2} <> 'delivered')`, [own.id, ...keys.map(k => f[k]), f.state]);   // 조각마다 delivered 가 먼저 올 수 있음 → 되돌리지 않음
            await setThread(own.thread_id, { last_out_state: f.state }).catch(() => { });
            if (ev.state === 'failed') {
                const c = await cfg();
                await setThread(own.thread_id, { status: 'staff_needed' });
                await notifyStaff(c, { id: own.thread_id }, `문자 · 끝 ${phoneTail(own.phone_digits)} 발송 실패`, String(ev.reason || '').slice(0, 80));
            }
            return { matched: 'own', message_id: own.id, state: f.state };
        }
        // 우리가 보낸 id 가 아님 = 전달 앱의 다른 발신(대시보드·다른 클라이언트 · 또는 재시작 사이 우리 글) — 🔴 직원이 삼성 메시지에서 손으로 보낸 글은 여기로 안 온다(앱이 안 올림 · 워커2 소스 확인)
        //    안전한 쪽 = 기록 + 그 대화의 봇 큐 취소 + 잠금(staff_replied). sms:sent payload 엔 글이 없어 본문은 안내문으로.
        if (!ev.digits) return { matched: 'none' };
        const thread = await threadFor(ev.digits);
        const dup = ev.gateway_id ? (await pool.query(`SELECT id FROM sms_messages WHERE gateway_id = $1 LIMIT 1`, [ev.gateway_id])).rows[0] : null;
        if (dup) { if (ev.state === 'delivered') await pool.query(`UPDATE sms_messages SET state = 'delivered', delivered_at = COALESCE($2, now()) WHERE id = $1`, [dup.id, ev.event_at || null]); return { matched: 'staff_dup', message_id: dup.id }; }
        const bodyText = String(ev.body || '').trim() || '(전달 앱이 보낸 글 · 내용 없음)';
        const m = await addMessage({ thread_id: thread.id, direction: 'out', kind: 'sms', body: bodyText, sender: 'gateway_other', state: ev.state === 'failed' ? 'failed' : 'sent', gateway_id: ev.gateway_id || null, sim_number: ev.sim_number, event_at: ev.event_at });
        const cancelled = await cancelPending(thread.id, 'gateway_other');
        await setThread(thread.id, { status: 'staff_replied', last_out_at: m.event_at, last_out_text: bodyText.slice(0, 300), handled_at: new Date(), staff_name: '전달 앱', draft_text: null, draft_kind: null });
        return { matched: 'gateway_other', message_id: m.id, cancelled };
    }
    async function cancelPending(threadId, by) {
        const r = await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = $2 WHERE thread_id = $1 AND direction = 'out' AND state = 'queued' RETURNING id`, [threadId, 'cancelled:' + by]);
        return r.rowCount || 0;
    }

    // ── 보내기 큐(10초마다 · 한 번에 최대 5건 · 시간당 상한) ──
    const gwEnv = () => ({ user: process.env.SMSGATE_USER || process.env.SMSGATE_LOGIN, pass: process.env.SMSGATE_PASS || process.env.SMSGATE_PASSWORD, base: (process.env.SMSGATE_API_BASE || process.env.SMSGATE_API || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/$/, '') });
    const toE164 = digits => digits.startsWith('0') ? '+82' + digits.slice(1) : '+' + digits;
    async function gwFetch(path, opts = {}) {
        const { user, pass, base } = gwEnv();
        if (!user || !pass) throw new Error('SMSGATE_USER/PASS 없음');
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
        try {
            const res = await fetch(base + path, Object.assign({ signal: ctrl.signal }, opts, { headers: Object.assign({ 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') }, opts.headers || {}) }));
            const txt = await res.text(); let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (_) { j = { raw: txt.slice(0, 200) }; }
            return { status: res.status, ok: res.ok, json: j };
        } finally { clearTimeout(t); }
    }
    // 보내기: id 는 우리가 정해 보낸다(같은 id 재전송은 409 → 중복 발송 방지) · ttl 지나면 폰이 안 보냄(꺼졌다 켜질 때 옛 답 방지) · priority 0(앱 상한 적용)
    async function gatewaySend(digits, text, ourId, ttlSec, priority) {
        const id = ourId || crypto.randomUUID();
        const body = JSON.stringify({ id, textMessage: { text }, phoneNumbers: [toE164(digits)], ttl: ttlSec || DEFAULT_CFG.ttl_sec, priority: Math.min(99, Math.max(0, Number(priority) || 0)) });   // 100 미만 = 앱 상한 적용
        let r;
        try { r = await gwFetch('/messages', { method: 'POST', body }); }
        catch (e) { if (e && e.name === 'AbortError') r = await gwFetch('/messages', { method: 'POST', body }); else throw e; }   // 타임아웃이면 같은 id 로 1회 더(이미 들어갔으면 409 = 성공)
        if (r.status === 409) return { id, dup: true, raw: r.json };
        if (!r.ok) throw new Error(`gateway ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
        return { id: r.json.id || id, raw: r.json };
    }
    // webhook 등록(cloud API · 이벤트당 1개 · 앱 화면에선 못 함) — 총괄이 배포 뒤 1회 · 관리자 라우트
    async function registerWebhooks(urlBase) {
        const url = (urlBase || process.env.SMS_PUBLIC_URL || 'https://jeju-acom-company.onrender.com').replace(/\/$/, '') + '/api/sms/webhook';
        const have = await gwFetch('/webhooks');
        if (!have.ok) return { url, error: 'list ' + have.status, detail: JSON.stringify(have.json).slice(0, 200), hint: have.status === 401 ? 'SMSGATE_USER/PASS 확인' : undefined };
        const list = Array.isArray(have.json) ? have.json : [];
        const out = [];
        for (const event of WEBHOOK_EVENTS) {
            const exists = list.find(w => w && w.event === event && w.url === url);
            if (exists) { out.push({ event, status: 'exists', id: exists.id }); continue; }
            const r = await gwFetch('/webhooks', { method: 'POST', body: JSON.stringify({ id: 'akkome-' + event.replace(/[^a-z]/g, '-'), url, event }) });
            out.push({ event, status: r.ok ? 'created' : 'error', code: r.status, detail: r.ok ? undefined : JSON.stringify(r.json).slice(0, 120) });
        }
        return { url, before: list.length, result: out };
    }
    let _sendBusy = false;
    async function sendTick() {
        if (_sendBusy) return null; _sendBusy = true;
        try {
            const c = await cfg();
            if (!c.enabled) return null;
            const hourN = (await pool.query(`SELECT count(*)::int AS n FROM sms_messages WHERE direction = 'out' AND state IN ('sent','delivered','sending') AND sent_at > now() - interval '1 hour'`)).rows[0].n;   // sending 포함(202 받은 것)
            if (hourN >= c.hourly_send_cap) return { skipped: 'hourly_cap' };
            const rows = (await pool.query(`SELECT m.*, t.phone_digits, t.status AS thread_status FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
                WHERE m.direction = 'out' AND m.state = 'queued' AND (m.send_after IS NULL OR m.send_after <= now()) ORDER BY m.id LIMIT 5`)).rows;
            // 10분 넘게 'sending'(202 받고 sms:sent 안 옴 · 폰 꺼짐 등) 은 그대로 둔다 — ttl 뒤 sms:failed 가 오거나 폰이 켜지면 sent 로 바뀜
            const out = [];
            for (const m of rows) {
                // 유예 사이에 직원이 답했으면(상태 바뀜) 취소
                if (m.sender === 'bot' && ['staff_replied', 'staff_needed', 'closed'].includes(m.thread_status)) { await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:staff' WHERE id = $1`, [m.id]); out.push({ id: m.id, cancelled: true }); continue; }
                const ourId = m.gateway_id || crypto.randomUUID();
                await pool.query(`UPDATE sms_messages SET state = 'sending', gateway_id = $2 WHERE id = $1`, [m.id, ourId]);
                try {
                    const r = await (deps.gatewaySend || gatewaySend)(m.phone_digits, m.body, ourId, c.ttl_sec, m.priority || 0);   // 검증은 deps.gatewaySend 로 가짜 발송
                    // 202 = 대기열에 들어감(Pending) → 'sending' 유지 · 실제 'sent' 는 sms:sent webhook 이 적는다(화면엔 「보내는 중」) · 쿨다운·bot_count 는 지금(이중 답 방지가 우선)
                    await pool.query(`UPDATE sms_messages SET sent_at = now() WHERE id = $1`, [m.id]);
                    const extra = m.sender === 'bot' ? { cooldown_until: new Date(Date.now() + c.cooldown_min * 60000) } : {};
                    await setThread(m.thread_id, Object.assign({ last_out_at: new Date(), last_out_text: String(m.body || '').slice(0, 300), last_out_state: 'sending' }, extra));
                    if (m.sender === 'bot') { const th = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [m.thread_id])).rows[0]; await bumpBotCount(th); }
                    out.push({ id: m.id, sent: true, gateway_id: r.id });
                } catch (e) {
                    await pool.query(`UPDATE sms_messages SET state = 'failed', fail_reason = $2 WHERE id = $1`, [m.id, String(e.message).slice(0, 200)]);
                    await setThread(m.thread_id, { status: 'staff_needed', last_out_state: 'failed' });
                    await notifyStaff(c, { id: m.thread_id }, `문자 · 끝 ${phoneTail(m.phone_digits)} 발송 실패`, String(e.message).slice(0, 80));
                    out.push({ id: m.id, failed: e.message });
                }
            }
            return out;
        } catch (e) { log.error('[문자] 보내기 틱 오류:', e.message); return { error: e.message }; }
        finally { _sendBusy = false; }
    }

    // ── 끊김 감시(system:ping 이 ping_alert_hours 넘게 없으면 텔레그램 1회 · 돌아오면 복구 1회) · 사진 보관 정리(03:50 · db_retention.enabled 일 때만) ──
    let _pingAlerted = false, _purgeDay = '';
    async function watchTick() {
        try {
            const c = await cfg();
            try { await pendingPhotoTick(); } catch (e) { log.error('[문자] 사진 대기 정리 실패(무시):', e.message); }
            if (c.enabled) {
                const st = (await naverCfgGet('sms_gateway_state')) || {};
                const last = st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0;
                const dead = !last || Date.now() - last > c.ping_alert_hours * 3600e3;
                if (dead && !_pingAlerted && !st.alerted) { _pingAlerted = true; await naverCfgSet('sms_gateway_state', Object.assign(st, { alerted: true, alerted_at: new Date().toISOString() })); if (notifyTelegram) await notifyTelegram(`📵 회사폰 문자 앱 신호가 ${c.ping_alert_hours}시간 넘게 없어요 — 폰·앱·채팅+ 설정을 확인해 주세요`); }
                if (!dead && (st.alerted || _pingAlerted)) { _pingAlerted = false; await naverCfgSet('sms_gateway_state', Object.assign(st, { alerted: false })); if (notifyTelegram) await notifyTelegram('✅ 회사폰 문자 앱 신호 복구'); }
            }
            const k = new Date(Date.now() + 9 * 3600e3), today = k.toISOString().slice(0, 10), hhmm = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
            if (hhmm >= '03:50' && _purgeDay !== today) {
                _purgeDay = today;
                const ret = await naverCfgGet('db_retention');
                if (ret && ret.enabled === true) {
                    const r = await pool.query(`UPDATE sms_images SET data = NULL, purged_at = now() WHERE purged_at IS NULL AND data IS NOT NULL AND created_at < now() - make_interval(days => $1::int)`, [c.image_days]);
                    const s = await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN (SELECT tracking FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60 LIMIT 5000)`);
                    await pool.query(`DELETE FROM delivery_status t WHERE NOT EXISTS (SELECT 1 FROM delivery_shipments s WHERE s.tracking = t.tracking) AND t.checked_at < now() - interval '60 days'`);
                    if ((r.rowCount || 0) + (s.rowCount || 0) > 0) { await writeAudit({ action: 'purge', targetType: 'sms_retention', changes: { after: { sms_images: r.rowCount, delivery_shipments: s.rowCount, image_days: c.image_days, shipments_days: 60 } }, source: 'db_retention', actor: { id: null, name: '보관 정리(자동)' } }); log.log(`[문자] 보관 정리 — 사진 ${r.rowCount}건 · 송장 ${s.rowCount}행`); }
                }
            }
        } catch (e) { log.error('[문자] 감시 틱 오류:', e.message); }
    }

    // ── webhook 이벤트 파서(SMSGate · 필드 이름은 워커2 스펙으로 재확인 — 모르는 이벤트는 기록만) ──
    function parseEvent(b) {
        const ev = String(b && (b.event || b.type) || '').trim();
        const p = (b && (b.payload || b.data)) || {};
        const outbound = /^sms:(sent|delivered|failed|cancelled)$/.test(ev);   // 보낸 쪽 이벤트는 sender = 회사폰 자기 번호 · recipient = 손님(워커2 스펙 1-1)
        const phone = outbound ? (p.recipient || p.phoneNumber || (Array.isArray(p.phoneNumbers) ? p.phoneNumbers[0] : null)) : (p.sender || p.phoneNumber || p.from || p.address);
        const at = p.receivedAt || p.sentAt || p.deliveredAt || p.failedAt || p.at || null;
        return { ev, p, envelope_id: b && (b.id || b.webhookId) || null, device_id: b && b.deviceId || null, digits: normalizePhone(phone), body: p.message != null ? p.message : (p.text != null ? p.text : (p.body || '')), gateway_id: p.messageId || p.id || null,
            sim_number: Number.isInteger(p.simNumber) ? p.simNumber : null, event_at: at ? new Date(at) : null, reason: p.reason || p.error || null, attachments: Array.isArray(p.attachments) ? p.attachments : [] };
    }
    const seenEvents = new Map();   // 같은 이벤트 재시도(2일간 14회) 1차 거름 — 3일 기억(정본은 sms_messages.envelope_id UNIQUE · 재시작 뒤에도 거름)
    function seenOnce(key) { const now = Date.now(); if (seenEvents.size > 5000) for (const [k, t] of seenEvents) if (now - t > 3 * 86400e3) seenEvents.delete(k); if (seenEvents.has(key)) return true; seenEvents.set(key, now); return false; }

    async function handleWebhook(body) {
        const e = parseEvent(body);
        const st = (await naverCfgGet('sms_gateway_state')) || {};
        const stamp = { last_event_at: new Date().toISOString(), last_event: e.ev };
        if (e.ev === 'system:ping' || e.ev === 'app:started') { await naverCfgSet('sms_gateway_state', Object.assign(st, stamp, { last_ping_at: new Date().toISOString() })); return { ok: true, event: e.ev }; }
        await naverCfgSet('sms_gateway_state', Object.assign(st, stamp, { last_ping_at: new Date().toISOString() }));   // 어떤 이벤트든 앱이 살아 있다는 뜻
        const dupKey = e.envelope_id ? 'env:' + e.envelope_id : (e.gateway_id ? e.ev + ':' + e.gateway_id : null);   // 중복 제거는 봉투 id 로(messageId 는 내용 기반 · 고유 보장 없음)
        if (dupKey && seenOnce(dupKey)) return { ok: true, event: e.ev, dup: true };
        if (e.ev === 'sms:received') { if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' }; return Object.assign({ ok: true, event: e.ev }, await handleInbound({ digits: e.digits, body: e.body, kind: 'sms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, envelope_id: e.envelope_id })); }
        if (e.ev === 'sms:batch:received') return { ok: true, event: e.ev, ignored: true, n: Array.isArray(e.p.messages) ? e.p.messages.length : 0 };   // 받은함 다시 읽기(옛 글 내보내기) — 답하면 옛 글마다 봇이 답함 · 등록도 안 함
        // 정상 순서 = mms:received(메타만 · 기록) → mms:downloaded(사진·글 · 여기서 판정). received 가 유실되면 downloaded 가 새 수신으로.
        if (e.ev === 'mms:received') { if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' }; return Object.assign({ ok: true, event: e.ev }, await handleInbound({ digits: e.digits, body: '', kind: 'mms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, images: [{ contentType: null, size: e.p.size || null, data: null }], envelope_id: e.envelope_id, recordOnly: true })); }
        if (e.ev === 'mms:downloaded') return attachDownloaded(e);
        if (e.ev === 'sms:cancelled') return Object.assign({ ok: true, event: e.ev }, await handleSent({ gateway_id: e.gateway_id, digits: e.digits, body: e.body, state: 'failed', reason: 'cancelled', event_at: e.event_at, sim_number: e.sim_number }));
        if (e.ev === 'sms:sent' || e.ev === 'sms:delivered' || e.ev === 'sms:failed') return Object.assign({ ok: true, event: e.ev }, await handleSent({ gateway_id: e.gateway_id, digits: e.digits, body: e.body, state: e.ev.split(':')[1], reason: e.reason, event_at: e.event_at, sim_number: e.sim_number }));
        return { ok: true, event: e.ev, ignored: true };
    }

    // ── 라우트 ──
    const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { log.error('[문자] 라우트 오류:', e.message); res.status(500).json({ ok: false, error: '문자 처리 중 문제가 생겼어요: ' + e.message }); } };
    // 🔴 즉시 200 → 뒤에서 처리(앱은 30초 안 2xx 아니면 2일간 재시도 → 늦게 답하면 같은 사건이 두 번 와 봇이 두 번 답함) · 서명은 req.rawBody(server.js express.json verify 로 잡은 원문)로 검사
    app.post('/api/sms/webhook', wrap(async (req, res) => {
        const v = verifySignature(req);
        if (!v.ok) { if (v.why === 'no_secret') return res.status(503).json({ ok: false, error: 'webhook locked' }); return res.status(401).json({ ok: false, error: v.why }); }
        const body = req.body || {};
        res.json({ ok: true, accepted: true, event: body.event || null });
        setImmediate(() => { handleWebhook(body).then(r => { if (r && r.action) log.log(`[문자] ${r.event || ''} → ${r.action}${r.why ? '(' + r.why + ')' : ''}`); }).catch(e => log.error('[문자] webhook 처리 오류:', e.message)); });
    }));
    app.post('/api/sms/register-webhooks', authMiddleware, wrap(async (req, res) => {
        if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '관리자만' });
        const r = await registerWebhooks(req.body && req.body.url);
        await writeAudit({ action: 'update', targetType: 'sms_gateway', changes: { after: { webhooks: r } }, source: 'sms', actor: who(req) });
        res.json(Object.assign({ ok: true }, r));
    }));
    const pub = t => ({ id: t.id, phone_tail: phoneTail(t.phone_digits), phone_masked: phoneMasked(t.phone_digits), customer_hint: t.order_hint || null, status: t.status,
        last_in_text: String(t.last_in_text || '').slice(0, 120), last_in_at: t.last_in_at, last_out_text: String(t.last_out_text || '').slice(0, 120), last_out_at: t.last_out_at,
        has_image: !!t.has_image, draft_text: t.draft_text || null, staff_name: t.staff_name || null, handled_at: t.handled_at, bot_count_today: botCountToday(t), last_out_state: t.last_out_state || null });
    app.get('/api/sms/summary', authMiddleware, wrap(async (req, res) => {
        const c = await cfg(); const st = (await naverCfgGet('sms_gateway_state')) || {};
        const today = kstDate();
        const r = (await pool.query(`SELECT
            (SELECT count(*)::int FROM sms_threads WHERE status = 'staff_needed') AS staff_needed,
            (SELECT count(*)::int FROM sms_threads WHERE status = 'draft') AS drafts,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'in' AND (event_at + interval '9 hours')::date = $1::date) AS today_in,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered') AND (sent_at + interval '9 hours')::date = $1::date) AS today_bot,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender IN ('staff_phone','staff_desk') AND (event_at + interval '9 hours')::date = $1::date) AS today_staff`, [today])).rows[0];
        const lastPing = st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0;
        const counts = {}; for (const row of (await pool.query(`SELECT status, count(*)::int AS n FROM sms_threads GROUP BY status`)).rows) counts[row.status] = row.n;   // 숫자 칸(워커1 계약 제안 1)
        res.json(Object.assign({ enabled: c.enabled, mode: c.mode, counts }, r, { gateway: { last_ping_at: st.last_ping_at || null, alive: !!lastPing && Date.now() - lastPing < c.ping_alert_hours * 3600e3 } }));
    }));
    app.get('/api/sms/threads', authMiddleware, wrap(async (req, res) => {
        const status = String(req.query.status || 'all'), q = String(req.query.q || '').trim().slice(0, 40), limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const where = [], args = [];
        if (status !== 'all') { if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: '상태 값이 틀려요' }); args.push(status); where.push(`status = $${args.length}`); }
        else where.push(`status <> 'ignored'`);
        if (q) { args.push('%' + q + '%'); where.push(`(phone_digits LIKE $${args.length} OR last_in_text ILIKE $${args.length} OR last_out_text ILIKE $${args.length})`); }
        args.push(limit);
        const rows = (await pool.query(`SELECT * FROM sms_threads WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT $${args.length}`, args)).rows;
        res.json({ items: rows.map(pub) });
    }));
    app.get('/api/sms/threads/:id', authMiddleware, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!id) return res.status(400).json({ ok: false, error: 'id' });
        const t = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [id])).rows[0]; if (!t) return res.status(404).json({ ok: false, error: '없는 대화예요' });
        const ms = (await pool.query(`SELECT m.id, m.direction, m.kind, m.body, m.sender, m.state, m.bucket, m.rule_kind, m.event_at, m.sent_at, m.fail_reason,
            COALESCE((SELECT array_agg(i.id ORDER BY i.id) FROM sms_images i WHERE i.message_id = m.id AND i.purged_at IS NULL AND i.data IS NOT NULL), '{}') AS image_ids
            FROM sms_messages m WHERE m.thread_id = $1 ORDER BY m.id LIMIT 300`, [id])).rows;
        res.json({ thread: pub(t), messages: ms.map(m => ({ id: m.id, direction: m.direction, kind: m.kind, body: m.body, sender: m.sender, state: m.state, bucket: m.bucket, rule_kind: m.rule_kind, image_ids: m.image_ids, event_at: m.event_at, fail_reason: m.fail_reason })), order: t.order_json || null });
    }));
    app.get('/api/sms/images/:id', authMiddleware, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!id) return res.status(400).end();
        const r = (await pool.query(`SELECT content_type, data FROM sms_images WHERE id = $1 AND purged_at IS NULL AND data IS NOT NULL`, [id])).rows[0];
        if (!r) return res.status(404).json({ ok: false, error: '사진이 없어요(보관 기간이 지났을 수 있어요)' });
        res.set('content-type', r.content_type || 'image/jpeg'); res.set('cache-control', 'private, max-age=3600'); res.send(r.data);
    }));
    const who = req => ({ id: req.user.id, name: req.user.name || req.user.username || '' });
    async function queueStaffReply(t, text, req, kind) {
        const body = smsSafe(text); if (!body) return null;
        const m = await addMessage({ thread_id: t.id, direction: 'out', kind: 'sms', body, sender: 'staff_desk', state: 'queued', rule_kind: kind || null, send_after: new Date() });
        await cancelPendingExcept(t.id, m.id);
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null });
        await writeAudit({ action: 'create', targetType: 'sms_reply', targetId: m.id, changes: { after: { thread: t.id, kind: kind || 'staff', bytes: byteLen(body) } }, source: 'sms', actor: who(req) });
        return m;
    }
    async function cancelPendingExcept(threadId, keepId) { await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:staff_desk' WHERE thread_id = $1 AND direction = 'out' AND state = 'queued' AND id <> $2`, [threadId, keepId]); }
    const loadThread = async (req, res) => { const id = parseInt(req.params.id, 10); const t = id ? (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [id])).rows[0] : null; if (!t) { res.status(404).json({ ok: false, error: '없는 대화예요' }); return null; } return t; };
    app.post('/api/sms/threads/:id/reply', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const text = String(req.body && req.body.text || '').trim(); if (!text) return res.status(400).json({ ok: false, error: '보낼 글이 비었어요' });
        const c = await cfg(); if (!c.enabled) return res.status(409).json({ ok: false, error: '문자 연동이 꺼져 있어요(설정 sms_gateway.enabled)' });
        const m = await queueStaffReply(t, text, req, 'staff'); res.json({ ok: true, message_id: m.id });
    }));
    app.post('/api/sms/threads/:id/send-draft', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        if (!t.draft_text) return res.status(409).json({ ok: false, error: '보낼 초안이 없어요' });
        const c = await cfg(); if (!c.enabled) return res.status(409).json({ ok: false, error: '문자 연동이 꺼져 있어요' });
        const m = await queueStaffReply(t, t.draft_text, req, 'draft:' + (t.draft_kind || '')); res.json({ ok: true, message_id: m.id });
    }));
    app.post('/api/sms/threads/:id/handled', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'handled');
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null });
        res.json({ ok: true, cancelled });
    }));
    app.post('/api/sms/threads/:id/close', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'close');
        await setThread(t.id, { status: 'closed', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null });
        res.json({ ok: true, cancelled });
    }));
    // 설정 보기·바꾸기(관리자 · 모드 전환은 여기서 — 첫 자동 발송(auto) 전환은 대표 「고」 뒤)
    app.get('/api/sms/config', authMiddleware, wrap(async (req, res) => { const c = await cfg(true); res.json(Object.assign({}, c, { gateway_env: { user: !!gwEnv().user, pass: !!gwEnv().pass, signing_key: !!(process.env.SMSGATE_SIGNING_KEY || process.env.SMSGATE_WEBHOOK_SECRET) }, modules: { classify: !!classifyMod, rules: !!rulesMod, lookup: !!lookupMod, photo: !!(photoJudge && photoReply), ai_note: !!aiNote } })); }));
    app.post('/api/sms/config', authMiddleware, wrap(async (req, res) => {
        if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '관리자만' });
        const prev = (await naverCfgGet('sms_gateway')) || {}; const next = Object.assign({}, prev, req.body || {});
        const c = cfgOf(next); await naverCfgSet('sms_gateway', Object.assign({}, next, c));
        await writeAudit({ action: 'update', targetType: 'sms_gateway', changes: { before: cfgOf(prev), after: c }, source: 'sms', actor: who(req) });
        _cfgCache = null; res.json({ ok: true, config: c });
    }));

    const timers = [];
    function start() {
        timers.push(setInterval(() => { sendTick(); }, 10 * 1000));
        timers.push(setInterval(() => { watchTick(); }, 60 * 1000));
    }
    function stop() { for (const t of timers) clearInterval(t); timers.length = 0; }

    return { initDB, start, stop, handleWebhook, handleInbound, handleSent, sendTick, watchTick, cfg, cfgOf, parseEvent, verifySignature, normalizePhone, smsSafeText, phoneMasked, phoneTail, modules: { classify: !!classifyMod, rules: !!rulesMod, lookup: !!lookupMod, photo: !!(photoJudge && photoReply), aiNote: !!aiNote }, _gatewaySend: gatewaySend, registerWebhooks, splitForSms, smsSafe, pendingPhotoTick, attachDownloaded, resetCfg: () => { _cfgCache = null; } };
};
module.exports.normalizePhone = normalizePhone;
module.exports.smsSafeText = smsSafeText;
module.exports.splitForSms = splitForSms;
module.exports.DEFAULT_CFG = DEFAULT_CFG;

// #610 회사폰(폴드7) 문자 반자동 응대 — 서버 쪽 핵심(총괄 · 2026-10-10)
//   구조: 회사폰의 SMSGate 앱(cloud 모드)이 받은 문자·보낸 문자·전송 결과·MMS 사진을 이 서버의 /api/sms/webhook 으로 올린다.
//         서버는 문자 표(sms_threads · sms_messages · sms_images)에 적고, 모드에 따라 ①record = 기록만 ②draft = 봇 초안만(직원이 [이대로 보내기])
//         ③auto = 유예(기본 75초) 뒤 자동 발송. 보내기는 SMSGate cloud API 에 Basic 인증으로 POST(폰이 실제 SMS 를 보냄 · 0원).
//   🔴 원칙: 상태는 전부 DB(재시작 안전 · 톡톡봇의 메모리 Map 방식은 쓰지 않는다) · 봇 발송분 판정은 gateway_id(메시지 id)로 대조(글자 일치 아님)
//           · 손님 전체 번호·주소는 화면 API 밖으로 안 나감(끝 4자리 · 가림값) · 사진은 sms_images 에 두고 30일 뒤 비움(db_retention.enabled 가 true 일 때만)
//           · 우리가 보낸 id 가 아닌 sms:sent(대시보드 등 전달 앱의 다른 발신)는 gateway_other 로 적고 그 대화의 봇 큐를 멈춤 · 🔴 직원이 삼성 메시지에서 손으로 보낸 글은 앱이 안 올림 → 직원 답은 화면에서만.
//   의존 모듈(워커 몫 · 없으면 그 기능만 꺼짐 · 서버는 그대로 돈다): sms/classify.js(가르기) · sms/rules.js(규칙 답) · sms/lookup.js(번호→주문) · sms/photo-judge.js + photo-reply.js(사진)
//   설정 = agent_office_config 'sms_gateway' { enabled, mode:'record'|'draft'|'auto', cooldown_min:30, daily_cap:1, hourly_send_cap:30, hold_sec:75,
//                                             staff_ids:[], ping_alert_hours:3, image_days:30, lookup_days:14, max_chars:70, ttl_sec:600 }  · 행이 없으면 enabled false = webhook 은 받되 기록만.
//   🔴 워커2 소스 확인(10/10): 직원이 삼성 메시지에서 손으로 보낸 문자는 앱이 서버로 올리지 않는다(앱 자신이 보낸 것의 결과만) → 「직원 답변됨」은 화면(에이전트 오피스) 발송으로만 생긴다.
//      그래서 ①봇은 한 대화에 하루 daily_cap(#625 = 3)번까지 답하고 쿨다운(10분) 안 둘째 글·같은 질문 되풀이는 직원 몫 ②직원 몫·직원 답변 상태의 대화는 사람이 풀거나 staff_open_hours(6)/staff_lock_hours(24) 가 지날 때까지 봇 침묵(잠금) ③webhook 은 즉시 200 을 주고 뒤에서 처리(30초 넘으면 2일간 재시도 → 이중 답변).
//      ④한글 70자 넘는 글은 앱이 분할 SMS 로 보냄(국내 통신사 동작 미확인 · 시험 b-2) → 확정 전까지 봇 답은 max_chars(70) 단위 문장 경계로 나눠 여러 통.
//   env = SMSGATE_SIGNING_KEY(webhook 서명 키 · 폰 Settings → Webhooks · 없으면 webhook 503 잠김) · SMSGATE_USER · SMSGATE_PASS(cloud 모드 아이디·비번) · SMSGATE_API_BASE(기본 https://api.sms-gate.app/3rdparty/v1)
//         · SMS_PUBLIC_URL(webhook 등록용 우리 주소 · 기본 https://jeju-acom-company.onrender.com)
'use strict';
const crypto = require('crypto');

// #625(대표 「고」 10/10 저녁): 봇은 앞 대화를 읽고 답한다 · 하루 3번 · 쿨다운 10분(그 안 둘째 글만 직원) · 같은 질문 되풀이 = 직원 · 직원 몫(staff_needed)도 staff_open_hours 지나면 저절로 끝남(종전 = 하루 1번 · 30분 · 직원 몫은 사람이 풀 때까지)
const DEFAULT_CFG = { enabled: false, mode: 'record', cooldown_min: 10, daily_cap: 3, hourly_send_cap: 30, hold_sec: 75, staff_ids: [], ping_alert_hours: 3, image_days: 30, lookup_days: 14, max_chars: 70, ttl_sec: 600, staff_lock_hours: 24, staff_open_hours: 6, context_msgs: 6 };   // staff_open_hours = 직원 몫(아무도 안 답함)이 손님 마지막 글 뒤 그 시간 지나면 저절로 끝남(0 = 안 품) · context_msgs = AI 에 같이 주는 앞 대화 통 수(0 = 안 줌)   // staff_lock_hours = 직원이 답한 대화가 그 시간 지나면 저절로 「끝남」(대표 확정 10/10 · 0 이면 안 품)
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
    const followup = optional('./followup.js'), selfcheck = optional('./selfcheck.js'), photoTest = optional('./photo-test.js'), preorders = optional('./preorders.js');
    let selfcheckApi = null;   // 셀프 조회 페이지(워커1) 장착 결과 { initDB, … }
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
            staff_lock_hours: num(v.staff_lock_hours, DEFAULT_CFG.staff_lock_hours, 0, 720),
            staff_open_hours: num(v.staff_open_hours, DEFAULT_CFG.staff_open_hours, 0, 720),   // #625
            context_msgs: num(v.context_msgs, DEFAULT_CFG.context_msgs, 0, 20),
        };
    }
    let _cfgCache = null, _cfgAt = 0;
    async function cfg(force) {
        if (!force && _cfgCache && Date.now() - _cfgAt < 10000) return _cfgCache;
        _cfgCache = cfgOf(await naverCfgGet('sms_gateway')); _cfgAt = Date.now();
        return _cfgCache;
    }

    // 앱 신호 상태(sms_gateway_state)는 jsonb 병합으로만 쓴다 — webhook·watchTick 이 동시에 써도 서로 지우지 않게(코드리뷰)
    async function stateMerge(obj) {
        if (typeof deps.stateMerge === 'function') return deps.stateMerge(obj);   // 검증은 가짜 설정 저장소로
        try { await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('sms_gateway_state', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = agent_office_config.value || EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(obj)]); }
        catch (e) { log.error('[문자] 상태 도장 실패(무시):', e.message); }
    }
    // 같은 번호의 글은 한 줄로 세워 처리(동시 두 통 → 둘 다 답하는 것 방지 · 프로세스 안 · 인스턴스는 Render 1개)
    const _lanes = new Map();
    function withLane(key, fn) {
        const prev = _lanes.get(key) || Promise.resolve();
        const run = prev.catch(() => { }).then(fn);
        _lanes.set(key, run);
        run.finally(() => { if (_lanes.get(key) === run) _lanes.delete(key); });
        return run;
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
        await pool.query(`ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS last_out_state text, ADD COLUMN IF NOT EXISTS ask_kind text, ADD COLUMN IF NOT EXISTS ask_at timestamptz, ADD COLUMN IF NOT EXISTS last_notify_at timestamptz`);
        if (preorders && typeof preorders.initDB === 'function') await preorders.initDB(pool);
        if (selfcheckApi && typeof selfcheckApi.initDB === 'function') await selfcheckApi.initDB();   // sms_selfcheck_hits(시도 제한 · 해시만)
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
    async function notifyStaff(c, thread, title, message, opts = {}) {
        if (!opts.force) {   // 같은 대화는 5분에 한 번만(손님이 연속으로 보내도 관리자 전원에게 푸시가 쏟아지지 않게)
            const r = (await pool.query(`UPDATE sms_threads SET last_notify_at = now() WHERE id = $1 AND (last_notify_at IS NULL OR last_notify_at < now() - interval '5 minutes') RETURNING id`, [thread.id])).rowCount;
            if (!r) return 0;
        }
        const ids = await staffUserIds(c);
        for (const uid of ids) await createNotification(uid, 'sms', title, String(message || '').slice(0, 120), `agent-office?sms=${thread.id}`);
        return ids.length;
    }
    const STAFF_MSG = '에이전트 오피스 「문자」 카드에서 확인해 주세요';   // 푸시 본문에는 손님 원문을 싣지 않는다(잠금 화면 노출)
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
        const o = pubo.order || {};   // toPublic = { match, role, candidates, order:{…} }(워커4 지적 · 평평하게 읽으면 늘 빈 줄)
        const md = x => x ? String(x).slice(5, 10).replace('-', '/') : '';
        const line = o.pre
            ? ['발송 전', o.paid_at ? '결제 ' + md(o.paid_at) + (o.paid_known === false ? '쯤' : '') : '', o.option_text, o.qty > 1 ? o.qty + '개' : ''].filter(Boolean).join(' · ')
            : [o.partner, o.ship_date ? md(o.ship_date) + ' 발송' : '', o.option_text, o.boxes > 1 ? o.boxes + '상자' : '', o.status_label, pubo.pre_pending ? '새 주문 ' + pubo.pre_pending + '건 대기' : ''].filter(Boolean).join(' · ');
        return Object.assign({ line, role: r.role || null }, pubo);
    }

    // #625: AI 에 줄 글 = 「앞 대화(오래된 순 · 손님/우리) + 이번 손님 글」 — 앞 대화가 없으면 이번 글만(종전과 같음). 무시 갈래·취소/실패한 발신은 뺀다.
    const normQ = t => String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    async function recentTurns(thread, inMsg, n) {
        if (!(n > 0) || !thread || !thread.id) return [];
        const rows = (await pool.query(`SELECT direction, body, sender, bucket, state FROM sms_messages WHERE thread_id = $1 AND id < $2 AND body IS NOT NULL AND body <> ''
            AND created_at > now() - interval '48 hours' AND (direction = 'in' OR state NOT IN ('cancelled','failed')) AND COALESCE(bucket, 'other') NOT IN ('otp','ad','carrier','photo_pending')
            ORDER BY id DESC LIMIT $3`, [thread.id, inMsg.id || 0, n])).rows;
        return rows.reverse();
    }
    async function withContext(thread, inMsg, text, c) {
        let turns = []; try { turns = await recentTurns(thread, inMsg, c.context_msgs); } catch (e) { log.error('[문자] 앞 대화 읽기 실패(무시):', e.message); }
        if (!turns.length) return text;
        const lines = turns.map(t => (t.direction === 'in' ? '손님: ' : '우리: ') + String(t.body).replace(/\s+/g, ' ').trim().slice(0, 300));
        return '[앞 대화 — 이 손님과 최근에 주고받은 문자 · 오래된 순 · 참고만]\n' + lines.join('\n') + '\n\n[이번 손님 글 — 여기에 답하세요]\n' + text;
    }
    // ── 답 만들기: 규칙 → AI. 결과 { text, kind:'rule'|'ai'|'ask', toStaff:boolean, why } ──
    async function composeAnswer(thread, inMsg, c, lookup) {
        const text = String(inMsg.body || '');
        const bucket = inMsg.bucket || 'other';
        if (['otp', 'ad', 'carrier', 'greeting'].includes(bucket)) return { text: null, kind: null, toStaff: false, why: 'ignore:' + bucket };
        if (bucket === 'claim' || bucket === 'photo' || bucket === 'account') return { text: null, kind: null, toStaff: true, why: bucket };   // #628 account = 계좌·입금(사람)
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
                const g = await qnaGenerate(await withContext(thread, inMsg, text, c), null, undefined, 'sms');   // #625: 앞 대화(최근 context_msgs 통 · 48시간 안)를 질문 앞에 붙여 되풀이 답을 막는다
                if (g && g.answer) {
                    const parsed = aiNote && typeof aiNote.parse === 'function' ? aiNote.parse(g.answer) : { toStaff: /^\[사람\]/.test(g.answer), text: g.answer.replace(/^\[사람\]\s*/, '') };
                    if (parsed.toStaff) return { text: null, kind: null, toStaff: true, why: 'ai_to_staff' };
                    if (/환불|반품|교환|보상|무료\s*수거|취소\s*(해|처리)|포인트|적립|쿠폰|할인해|보내\s*드리겠|재발송|재배송/.test(parsed.text)) return { text: null, kind: null, toStaff: true, why: 'ai_promise' };   // 약속 낱말은 사람(안내 블록만 믿지 않음)
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
        const bucket = recordOnly ? 'photo_pending' : bucketOf(bodyText, digits, hasImage, thread.status !== 'new' || !!thread.order_hint);
        const msg = await addMessage({ thread_id: thread.id, direction: 'in', kind: kind || (hasImage ? 'mms' : 'sms'), body: bodyText, sender: 'customer', state: 'received', gateway_id, sim_number, bucket, event_at, envelope_id });
        if (!msg) return { thread_id: thread.id, dup: true, action: 'dup' };
        if (hasImage) await saveImages(msg.id, imgs);
        if (recordOnly) { await setThread(thread.id, { last_in_at: msg.event_at, last_in_text: thread.last_in_text || '', has_image: thread.has_image || hasImage }); return { thread_id: thread.id, message_id: msg.id, bucket, action: 'pending_photo' }; }
        return decideInbound(thread, msg, c, { bodyText, images: imgs });
    }
    function bucketOf(bodyText, digits, hasImage, known) {
        let bucket = null;
        if (classifyMod && typeof classifyMod.classify === 'function') {
            try { bucket = (classifyMod.classify(bodyText, { hasImage, isKnownCustomer: !!known, from: digits, fromShortCode: digits.length < 10 }) || {}).bucket || null; } catch (e) { log.error('[문자] 가르기 실패(무시):', e.message); }
        }
        if (!bucket) bucket = hasImage && bodyText.length < 8 ? 'photo' : (digits.length < 10 ? 'carrier' : 'other');
        return bucket;
    }
    // 판정·답 — thread 는 이 글이 오기 전 상태 · msg 는 기록된 줄 · images 는 바이트 있는 사진만
    async function decideInbound(thread, msg, c, { bodyText, images }) {
        const digits = thread.phone_digits, hasImage = images.length > 0, bucket = msg.bucket;
        const patch = { last_in_at: msg.event_at, last_in_text: bodyText.slice(0, 300), has_image: thread.has_image || hasImage };
        const done = (action, extra) => Object.assign({ thread_id: thread.id, message_id: msg.id, bucket, action }, extra || {});
        // 되묻기(받는 분 성함) 뒤 답 — 🔴 가르기(무시·인사)보다 먼저: 「네 김영희요」가 인사로 버려지지 않게 · followup.js(워커3) · 60분 안 · 이 답 한 번은 쿨다운·하루 1번 검사에서 뺀다(되묻기 1회만 · 또 many 면 직원 몫)
        let askedName = null;
        const lateEvent = !!(msg.event_at && Date.now() - new Date(msg.event_at).getTime() > LATE_MS);
        if (thread.ask_kind === 'name') await setThread(thread.id, { ask_kind: null, ask_at: null });   // 어느 갈래든 비움(안 비우면 60분 안 다음 글도 이름으로 읽음)
        if (thread.ask_kind === 'name' && thread.status === 'bot_replied' && c.enabled && c.mode === 'auto' && !lateEvent && followup && typeof followup.expectName === 'function' && followup.expectName(thread)) {
            let parsed = null; try { parsed = followup.parseNameReply(bodyText); } catch (e) { log.error('[문자] 이름 답 읽기 실패(무시):', e.message); }
            if (parsed && parsed.name && parsed.sure !== false && lookupMod && typeof lookupMod.lookupByPhone === 'function') {
                askedName = parsed.name;
                try {
                    let r2 = await lookupMod.lookupByPhone(pool, digits, { days: c.lookup_days, recipientName: askedName });
                    if (r2 && r2.match === 'one' && typeof lookupMod.refreshOrder === 'function') { try { r2 = await lookupMod.refreshOrder(pool, r2, { maxBoxes: 3 }); } catch (_) { } }
                    if (r2 && r2.match === 'one' && r2.order) {
                        const hint2 = orderHintOf(r2); if (hint2) Object.assign(patch, { order_hint: hint2.line || null, order_json: hint2 });
                        r2.order = Object.assign({}, r2.order, { option: r2.order.option_text || r2.order.option });
                        const prevQ = (await pool.query(`SELECT body, bucket FROM sms_messages WHERE thread_id = $1 AND direction = 'in' AND id < $2 ORDER BY id DESC LIMIT 1`, [thread.id, msg.id])).rows[0];   // 되묻기 전 원래 물음(「송장」 물음도 살게 · 원래 갈래 유지)
                        const ans2 = await composeAnswer(thread, Object.assign({}, msg, { bucket: (prevQ && prevQ.bucket) || 'ship_q', body: (prevQ && prevQ.body) || bodyText }), c, r2);
                        if (ans2 && ans2.text && !ans2.toStaff && ans2.kind !== 'ask') return await queueBotAnswer(thread, msg, c, patch, ans2, { bypassCap: true });
                    }
                } catch (e) { log.error('[문자] 2차 조회 실패(무시):', e.message); }
            }
            // 이름을 못 읽었거나 여전히 여럿·없음 → 직원 몫
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 받는 분 확인 뒤에도 주문을 못 골랐어요`, STAFF_MSG);
            return done('ask_to_staff', { name: askedName ? '있음' : '없음' });
        }
        // 무시 갈래(인증번호·광고·통신사) — 기록만 · 상태 ignored(이미 대화 중인 손님 글은 상태 유지)
        if (['otp', 'ad', 'carrier'].includes(bucket) && !['bot_replied', 'staff_needed', 'draft', 'cooldown', 'staff_replied'].includes(thread.status)) {
            await setThread(thread.id, Object.assign(patch, { status: 'ignored' })); return done('ignored');
        }
        if (bucket === 'greeting' && thread.status !== 'new') { await setThread(thread.id, patch); return done('noop'); }
        // 직원 몫·직원 답변 상태(잠금)로 손님이 다시 보냄 → 봇 침묵 + 알림
        if (thread.status === 'staff_replied' || thread.status === 'staff_needed' || thread.status === 'draft') {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: thread.status === 'draft' ? thread.draft_text : null }));   // 초안 대기 중 새 글 = 초안은 남기되 직원 몫으로(AI 다시 안 부름)
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 손님이 다시 보냈어요`, STAFF_MSG);
            return done('staff_again');
        }
        // 기록만(꺼짐 · record 모드) — 아무 것도 보내지 않음 · 알림은 클레임·사진만
        if (!c.enabled || c.mode === 'record') {
            const toStaff = bucket === 'claim' || bucket === 'photo' || bucket === 'account' || hasImage;   // #628
            await setThread(thread.id, Object.assign(patch, toStaff ? { status: 'staff_needed' } : (thread.status === 'ignored' ? { status: 'new' } : {})));
            if (toStaff && c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} ${hasImage ? '사진' : '확인 필요'}`, STAFF_MSG);
            return done('recorded');
        }
        // 뒤늦게 들어온 옛 사건(재시도·비행기 모드) → 답하지 않고 직원 몫
        if (lateEvent) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 늦게 들어온 문자(봇 답 안 함)`, STAFF_MSG);
            return done('late_to_staff');
        }
        // 쿨다운 안 · 오늘 봇이 이미 답함(daily_cap) · 유예 중인 봇 답이 큐에 있음 → 직원 몫(대표 10/9 「30분 뒤 다시 온 것은 직원」 · 유예 75초 안 둘째 글도 같은 취급)
        const inCooldown = thread.cooldown_until && new Date(thread.cooldown_until).getTime() > Date.now();
        const pendingBot = (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND direction = 'out' AND sender = 'bot' AND state IN ('queued','sending') LIMIT 1`, [thread.id])).rowCount > 0;
        if (inCooldown || pendingBot || botCountToday(thread) >= c.daily_cap) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 답 뒤 다시 왔어요`, STAFF_MSG);
            return done('cooldown_to_staff');
        }
        // #625: 같은 질문을 또 보냄(24시간 안 · 띄어쓰기·기호만 다름) = 봇 답이 안 통한 것 → 직원 몫(되풀이 답 금지)
        if (botCountToday(thread) > 0 && normQ(bodyText).length >= 2) {
            const prevIn = (await pool.query(`SELECT body FROM sms_messages WHERE thread_id = $1 AND direction = 'in' AND id < $2 AND created_at > now() - interval '24 hours' AND COALESCE(bucket,'other') NOT IN ('otp','ad','carrier','greeting','photo_pending') ORDER BY id DESC LIMIT 5`, [thread.id, msg.id])).rows;
            if (prevIn.some(r => normQ(r.body) === normQ(bodyText))) {
                await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }));
                await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 같은 질문을 다시 보냈어요`, STAFF_MSG);
                return done('repeat_to_staff');
            }
        }
        // 번호로 주문 찾기 → 답 만들기
        const lookup = await orderFor(digits, c);
        const hint = orderHintOf(lookup);
        if (hint) Object.assign(patch, { order_hint: hint.line || null, order_json: hint });
        if (lookup && lookup.match === 'one' && lookup.order) lookup.order = Object.assign({}, lookup.order, { option: lookup.order.option_text || lookup.order.option });   // rules.js 는 option/option_text 둘 다 읽음
        let ans;
        const orderQ = bucket === 'ship_q' || bucket === 'order_q';
        if (hasImage && photoJudge && photoReply) ans = await composePhotoAnswer(thread, msg, c, lookup, images, bodyText);   // 사진이 있으면 글이 클레임이어도 사진 판독 쪽(대표 📱 ④ · 결정은 사람)
        else if (hasImage) ans = { text: null, toStaff: true, why: 'photo' };
        else ans = await composeAnswer(thread, msg, c, orderQ ? lookup : (lookup && lookup.match === 'one' ? lookup : null));   // 주문 물음이 아니면 many 되묻기 안 함(보관법 물음에 「받는 분 성함」 묻지 않게)
        if (ans.ai_json) await pool.query(`UPDATE sms_messages SET ai_json = $2::jsonb WHERE id = $1`, [msg.id, JSON.stringify(ans.ai_json)]).catch(() => { });
        if (ans.why && ans.why.startsWith('ignore:')) { await setThread(thread.id, Object.assign(patch, { status: thread.status === 'new' ? 'ignored' : thread.status })); return done('ignored'); }
        if (ans.toStaff || !ans.text) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: ans.text || null, draft_kind: ans.kind || null }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 직원 답 필요(${labelWhy(ans.why)})`, ans.staff_summary ? ans.staff_summary.slice(0, 120) : STAFF_MSG);
            return done('to_staff', { why: ans.why });
        }
        if (c.mode === 'draft') {
            await setThread(thread.id, Object.assign(patch, { status: 'draft', draft_text: ans.text, draft_kind: ans.kind }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 초안 확인`, STAFF_MSG);
            return done('draft', { kind: ans.kind });
        }
        return await queueBotAnswer(thread, msg, c, patch, ans);
    }
    // auto — 유예(hold_sec) 뒤 발송 큐에(그 사이 직원이 화면에서 답하면 취소) · 여러 통은 priority 9,8,7… 로 순서 보장(앱 기본 LIFO)
    //   되묻기(kind 'ask')면 thread.ask_kind='name' 을 적어 다음 글을 이름으로 읽는다(followup.js) · bypassCap = 되묻기 뒤 2차 답(상한에서 뺌 · bot_count 는 올림)
    async function queueBotAnswer(thread, msg, c, patch, ans, opts = {}) {
        const digits = thread.phone_digits, bucket = msg.bucket;
        const done = (action, extra) => Object.assign({ thread_id: thread.id, message_id: msg.id, bucket, action }, extra || {});
        const sendAfter = new Date(Date.now() + c.hold_sec * 1000);
        const pieces = splitForSms(ans.text, c.max_chars);
        let out = null;
        for (let i = 0; i < pieces.length; i++) {
            const m = await addMessage({ thread_id: thread.id, direction: 'out', kind: 'sms', body: pieces[i], sender: 'bot', state: 'queued', rule_kind: ans.rule_kind || ans.kind, priority: Math.max(0, 9 - i), ai_json: Object.assign({ why: ans.why, part: i + 1, parts: pieces.length, second: !!opts.bypassCap }, ans.used ? { used: ans.used } : {}), send_after: sendAfter });
            if (!out) out = m;
        }
        const ask = ans.kind === 'ask';
        await setThread(thread.id, Object.assign(patch, { status: 'bot_replied', draft_text: null, draft_kind: null, ask_kind: ask ? 'name' : null, ask_at: ask ? new Date() : null, cooldown_until: new Date(Date.now() + c.cooldown_min * 60000) }));
        await bumpBotCount(thread);   // 한 답에 1번(조각 수와 무관) · 큐에 넣는 순간 올려 유예 창에서도 상한이 먹게
        if (ask) await setThread(thread.id, { ask_count: (thread.ask_count || 0) + 1 });
        if (ans.staff_summary) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇이 답했어요(사진) · 이어받아 주세요`, ans.staff_summary.slice(0, 120), { force: true });   // 대표 📷 규칙: 사진 답 뒤 직원 푸시는 반드시
        return done('queued', { out_id: out.id, parts: pieces.length, kind: ans.kind, second: !!opts.bypassCap, send_after: sendAfter.toISOString() });
    }
    // mms:downloaded — 같은 번호의 최근 10분 안 「사진 받는 중」 줄에 사진·글을 붙이고 그 줄로 판정(없으면 새 수신으로)
    async function attachDownloaded(e) {
        const prev = e.digits ? (await pool.query(`SELECT m.*, t.phone_digits FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.kind = 'mms' AND m.bucket IN ('photo_pending','photo') AND m.event_at > now() - interval '15 minutes'
              AND NOT EXISTS (SELECT 1 FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) ORDER BY m.id DESC LIMIT 1`, [e.digits])).rows[0] : null;   // 5분 뒤 photo 로 바뀐 줄도 15분 안이면 같은 줄에(코드리뷰)
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
        const bucket = bucketOf(bodyText, thread.phone_digits, n > 0, thread.status !== 'new' || !!thread.order_hint);
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
            await setThread(r.thread_id, { status: 'staff_needed' });
            await pool.query(`UPDATE sms_threads SET last_in_text = '(사진 · 파일을 못 받았어요)' WHERE id = $1 AND COALESCE(last_in_text, '') = ''`, [r.thread_id]);
            if (c.enabled) await notifyStaff(c, { id: r.thread_id }, `문자 · 끝 ${phoneTail(r.phone_digits)} 사진을 못 받았어요`, '폰 삼성 메시지에서 직접 확인해 주세요(MMS 자동 가져오기 설정)');
        }
        return rows.length;
    }
    const labelWhy = w => ({ claim: '불만·클레임', account: '계좌·입금 문의', photo: '사진', ai_to_staff: 'AI 판단', ai_skip: 'AI 답 없음', ai_error: 'AI 오류', ai_promise: 'AI 글에 약속 낱말', no_engine: '엔진 없음', photo_not_fruit: '과일 사진 아님', photo_unclear: '사진 불명확', photo_ai_error: '사진 판독 실패', photo_too_big: '사진 한도 초과', photo_damage_low: '파손 의심(확신 낮음)', photo_leak: '사진 문구 검사' }[w] || w || '');

    // 사진 판독(워커5 모듈 · 톡톡과 같은 규칙: 직원이 30분 안에 답한 대화면 침묵 + 직원 요약만) — 손님 문구는 photo-reply 가 3벌에서 고름(숫자 없음)
    async function composePhotoAnswer(thread, msg, c, lookup, images, text) {
        try {
            const bufs = images.filter(im => im.data).map(im => ({ buf: Buffer.isBuffer(im.data) ? im.data : Buffer.from(String(im.data), 'base64'), contentType: im.contentType || 'image/jpeg' }));
            if (!bufs.length) return { text: null, toStaff: true, why: 'photo', staff_summary: '사진이 왔지만 파일을 받지 못했어요(메타만)' };
            const lastOrder = lookup && lookup.match === 'one' ? lookup.order : null;
            const j = await photoJudge.judge(bufs, { text, lastOrder, channel: 'sms' });
            const staffSummary = j && j.staff_summary ? j.staff_summary : '';
            if (!j || j.kind === 'error' || (j.raw && j.raw.error)) return { text: null, toStaff: true, why: (j && j.raw && j.raw.too_big) ? 'photo_too_big' : 'photo_ai_error', staff_summary: staffSummary || ((j && j.raw && j.raw.too_big) ? '사진이 커서 판독 못 함 · 직접 확인' : '사진 판독 실패(AI) · 직접 확인'), ai_json: j };   // 판독 실패에 「확인했어요」가 나가지 않게
            if (j.kind === 'not_fruit') return { text: null, toStaff: true, why: 'photo_not_fruit', staff_summary: staffSummary, ai_json: j };
            if (j.kind === 'damage' && j.confidence !== 'high') return { text: null, toStaff: true, why: 'photo_damage_low', staff_summary: staffSummary || '파손 의심(확신 낮음)', ai_json: j };   // 보상 문구는 확신 높을 때만
            // 🔴 대표 확정(10/10): 사진이 온 손님은 불만 상황 — 봇이 알아본 경우(damage·size 확신 높음)만 답하고 그 밖(other·unclear·size 낮음)은 되묻기 없이 직원 연결
            if (!((j.kind === 'damage' || j.kind === 'size') && j.confidence === 'high')) return { text: null, toStaff: true, why: 'photo_unclear', staff_summary: staffSummary || '사진 상황 불명확 · 직접 확인', ai_json: j };
            const reply = photoReply.reply(j, { channel: 'sms', lastOrder, prevOrder: lookup && lookup.prev ? lookup.prev : null });
            if (!reply) return { text: null, toStaff: true, why: 'photo_unclear', staff_summary: staffSummary, ai_json: j };
            if (typeof photoReply.leakCheck === 'function') { const leak = photoReply.leakCheck(reply); if (leak) return { text: null, toStaff: true, why: 'photo_leak', staff_summary: (staffSummary || '') + ' · 문구 검사: ' + leak, ai_json: j }; }   // 발송 직전 숫자·약속 안전망
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
                await notifyStaff(c, { id: own.thread_id }, `문자 · 끝 ${phoneTail(own.phone_digits)} 발송 실패`, STAFF_MSG, { force: true });
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
        await setThread(thread.id, { status: ev.state === 'failed' ? 'staff_needed' : 'staff_replied', last_out_at: m.event_at, last_out_text: bodyText.slice(0, 300), handled_at: new Date(), staff_name: '전달 앱', draft_text: null, draft_kind: null, ask_kind: null, ask_at: null });
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
    // 멈춘 줄 정리(sendTick 머리 · watchTick) — 재시작·폰 꺼짐·처리 중 죽음 뒤에도 손님 글이 조용히 사라지지 않게
    // 시험 번호(0999…) 줄은 실서버가 집지 않는다 — verify-610-server 가 실DB 에 만든 큐를 실서버 sendTick·정리가 가로채 가짜 게이트웨이 판정이 어긋나던 것(10/10 실측 · 폰 연동 켠 뒤). 검증은 deps.testMode 로 켜서 자기 줄을 집는다.
    const TEST_SKIP_T = deps.testMode ? '' : "AND t.phone_digits NOT LIKE '0999%'";
    const TEST_SKIP_M = deps.testMode ? '' : "AND thread_id NOT IN (SELECT id FROM sms_threads WHERE phone_digits LIKE '0999%')";
    async function sweepStuck() {
        const c = await cfg(); const out = {};
        // ① 보낼 시각이 15분 넘게 지난 queued(꺼 둔 사이 쌓인 큐) → 취소 + 직원 몫(며칠 뒤 켰을 때 옛 답이 나가지 않게)
        const stale = await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:stale' WHERE direction = 'out' AND state = 'queued' AND send_after < now() - interval '15 minutes' ${TEST_SKIP_M} RETURNING thread_id`);
        for (const r of stale.rows) await setThread(r.thread_id, { status: 'staff_needed' });
        out.stale = stale.rowCount || 0;
        // ② 202 를 못 받고 죽은 sending(sent_at 없음 · 2분) → 같은 gateway_id 로 다시 queued(게이트웨이 409 = 이미 들어간 것)
        const re = await pool.query(`UPDATE sms_messages SET state = 'queued' WHERE direction = 'out' AND state = 'sending' AND sent_at IS NULL AND created_at < now() - interval '2 minutes' ${TEST_SKIP_M} RETURNING id`);
        out.requeued = re.rowCount || 0;
        // ③ 202 뒤 ttl+10분이 지나도 sms:sent/failed 가 안 옴 → 보내지 못함으로 + 직원 몫
        const lost = await pool.query(`UPDATE sms_messages SET state = 'failed', fail_reason = 'no_result' WHERE direction = 'out' AND state = 'sending' AND sent_at IS NOT NULL AND sent_at < now() - make_interval(secs => $1::int) RETURNING thread_id, id`, [c.ttl_sec + 600]);
        for (const r of lost.rows) { await setThread(r.thread_id, { status: 'staff_needed', last_out_state: 'failed' }); if (c.enabled) await notifyStaff(c, { id: r.thread_id }, '문자 · 보낸 결과가 안 와요(폰 꺼짐?)', STAFF_MSG); }
        out.no_result = lost.rowCount || 0;
        // ⑤ 직원이 답한 뒤(staff_replied) staff_lock_hours 지나면 저절로 「끝남」 — 끝내기를 안 눌러도 다음 문자부터 봇이 다시 답함(대표 확정 10/10 · 「직원 몫」(staff_needed · 아직 아무도 안 답함)은 그대로)
        if (c.staff_lock_hours > 0) {
            const rel = await pool.query(`UPDATE sms_threads SET status = 'closed' WHERE status = 'staff_replied' AND COALESCE(handled_at, updated_at) < now() - make_interval(hours => $1::int) RETURNING id`, [c.staff_lock_hours]);
            out.auto_closed = rel.rowCount || 0;
        }
        // #625(대표 「고」 10/10): 직원 몫(staff_needed · 아무도 안 답함)도 손님 마지막 글 뒤 staff_open_hours 지나면 저절로 끝남 — [처리함]을 안 눌러도 봇이 영영 침묵하지 않게(직원은 폰에서 답하는 구조)
        if (c.staff_open_hours > 0) {
            const rel2 = await pool.query(`UPDATE sms_threads SET status = 'closed' WHERE status = 'staff_needed' AND COALESCE(last_in_at, updated_at) < now() - make_interval(hours => $1::int) ${TEST_SKIP_T.replace('t.phone_digits', 'phone_digits')} RETURNING id`, [c.staff_open_hours]);
            out.auto_closed_open = rel2.rowCount || 0;
        }
        // ④ 받은 글은 있는데 판정 전에 죽어 status new 로 남은 대화(2분) → 직원 몫
        if (c.enabled && c.mode !== 'record') {   // record 모드는 new 가 정상 종착(워커2 ops 검증)
            const stuck = await pool.query(`UPDATE sms_threads t SET status = 'staff_needed' WHERE t.status = 'new' AND t.last_in_at IS NOT NULL AND t.last_in_at < now() - interval '2 minutes'
                AND EXISTS (SELECT 1 FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND COALESCE(m.bucket, 'other') NOT IN ('otp','ad','carrier','greeting','photo_pending') AND m.created_at < now() - interval '2 minutes')
                AND NOT EXISTS (SELECT 1 FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'out') AND t.created_at > now() - interval '1 day' RETURNING id`);
            for (const r of stuck.rows) await notifyStaff(c, { id: r.id }, '문자 · 처리되지 않은 글이 있어요', STAFF_MSG);
            out.stuck_new = stuck.rowCount || 0;
        }
        return out;
    }
    let _sendBusy = false, _capAlertAt = 0;
    async function sendTick() {
        if (_sendBusy) return null; _sendBusy = true;
        try {
            const c = await cfg();
            if (!c.enabled) return null;
            try { await sweepStuck(); } catch (e) { log.error('[문자] 멈춘 줄 정리 실패(무시):', e.message); }
            // 시간당 상한은 봇 답에만(직원 답이 막히지 않게) · 걸리면 텔레그램 1시간 1회
            const hourN = (await pool.query(`SELECT count(*)::int AS n FROM sms_messages WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered','sending') AND sent_at > now() - interval '1 hour'`)).rows[0].n;
            const botCapHit = hourN >= c.hourly_send_cap;
            if (botCapHit && Date.now() - _capAlertAt > 3600e3) { _capAlertAt = Date.now(); if (notifyTelegram) await notifyTelegram(`⚠️ 회사폰 문자 봇 답이 시간당 상한(${c.hourly_send_cap})에 걸렸어요 — 봇 답은 멈추고 직원 답만 나가요`); }
            const rows = (await pool.query(`SELECT m.*, t.phone_digits, t.status AS thread_status FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
                WHERE m.direction = 'out' AND m.state = 'queued' AND (m.send_after IS NULL OR m.send_after <= now()) ${botCapHit ? "AND m.sender <> 'bot'" : ''} ${TEST_SKIP_T} ORDER BY m.priority DESC, m.id LIMIT 5`)).rows;
            const out = [];
            for (const m of rows) {
                // 유예 사이에 직원이 답했으면(상태 바뀜) 취소
                if (m.sender === 'bot' && ['staff_replied', 'staff_needed', 'closed'].includes(m.thread_status)) { await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:staff' WHERE id = $1 AND state = 'queued'`, [m.id]); out.push({ id: m.id, cancelled: true }); continue; }
                // 🔴 원자적으로 집기(두 인스턴스·직원 답과 겹침 방지) · id 는 줄 번호로 고정(겹쳐도 게이트웨이 409)
                const ourId = m.gateway_id || ('akk-' + m.id + '-' + crypto.createHash('sha1').update(String(m.created_at || m.id)).digest('hex').slice(0, 8));
                const got = await pool.query(`UPDATE sms_messages SET state = 'sending', gateway_id = $2 WHERE id = $1 AND state = 'queued' RETURNING id`, [m.id, ourId]);
                if (!got.rowCount) { out.push({ id: m.id, skipped: 'taken' }); continue; }
                try {
                    const r = await (deps.gatewaySend || gatewaySend)(m.phone_digits, m.body, ourId, c.ttl_sec, m.priority || 0);   // 검증은 deps.gatewaySend 로 가짜 발송
                    // 202 = 대기열에 들어감(Pending) → 'sending' 유지 · 실제 'sent' 는 sms:sent webhook 이 적는다(화면엔 「보내는 중」) · 쿨다운·bot_count 는 큐에 넣을 때 이미 올림
                    await pool.query(`UPDATE sms_messages SET sent_at = now() WHERE id = $1`, [m.id]);
                    await setThread(m.thread_id, { last_out_at: new Date(), last_out_text: String(m.body || '').slice(0, 300), last_out_state: 'sending' });
                    out.push({ id: m.id, sent: true, gateway_id: r.id });
                } catch (e) {
                    await pool.query(`UPDATE sms_messages SET state = 'failed', fail_reason = $2 WHERE id = $1`, [m.id, String(e.message).replace(/\+?82\s?1\d[\d\s-]{7,}|01\d[\d\s-]{7,}/g, '[번호]').slice(0, 200)]);
                    await setThread(m.thread_id, { status: 'staff_needed', last_out_state: 'failed' });
                    await notifyStaff(c, { id: m.thread_id }, `문자 · 끝 ${phoneTail(m.phone_digits)} 발송 실패`, STAFF_MSG, { force: true });
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
            // 발송 전 주문 짧은 보관(sms/preorders.js · 워커4) — 설정 preorders === true 일 때만 · 60분에 1회 · 네이버 자동수집·중간발주 조회와 겹치지 않게 시각 기록
            const rawCfg = (await naverCfgGet('sms_gateway')) || {};
            if (preorders && typeof preorders.collect === 'function' && rawCfg.preorders === true) {
                const lastP = (await naverCfgGet('sms_preorders_last')) || {};
                const kh = new Date(Date.now() + 9 * 3600e3).getUTCHours();   // 한국 01~07시는 쉼(04:30 스냅샷 · 05:10 자사몰 점검과 겹침 방지)
                if (!(kh >= 1 && kh < 7) && (!lastP.at || Date.now() - new Date(lastP.at).getTime() > 60 * 60000)) {
                    await naverCfgSet('sms_preorders_last', Object.assign(lastP, { at: new Date().toISOString(), running: true }));
                    try { const r = await preorders.collect({ pool, fetchNaver: deps.fetchNaver, fetchCoupang: deps.fetchCoupang, fetchCafe24: deps.fetchCafe24, log }); await naverCfgSet('sms_preorders_last', { at: new Date().toISOString(), running: false, result: r }); log.log('[문자] 발송 전 주문 수집', JSON.stringify(r).slice(0, 200)); }
                    catch (e) { await naverCfgSet('sms_preorders_last', { at: new Date().toISOString(), running: false, error: String(e.message).slice(0, 200) }); log.error('[문자] 발송 전 주문 수집 실패:', e.message); }
                }
            }
            if (c.enabled) {
                const st = (await naverCfgGet('sms_gateway_state')) || {};
                const last = Math.max(st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0, st.last_event_at ? new Date(st.last_event_at).getTime() : 0);
                const dead = !!last && Date.now() - last > c.ping_alert_hours * 3600e3;   // 한 번도 신호가 없었으면(켠 직후) 끊김으로 보지 않음
                if (dead && !_pingAlerted && !st.alerted) { _pingAlerted = true; await stateMerge({ alerted: true, alerted_at: new Date().toISOString() }); if (notifyTelegram) await notifyTelegram(`📵 회사폰 문자 앱 신호가 ${c.ping_alert_hours}시간 넘게 없어요 — 폰·앱·채팅+ 설정을 확인해 주세요`); }
                if (!dead && last && (st.alerted || _pingAlerted)) { _pingAlerted = false; await stateMerge({ alerted: false }); if (notifyTelegram) await notifyTelegram('✅ 회사폰 문자 앱 신호 복구'); }
                try { await sweepStuck(); } catch (e) { log.error('[문자] 멈춘 줄 정리 실패(무시):', e.message); }
            }
            const k = new Date(Date.now() + 9 * 3600e3), today = k.toISOString().slice(0, 10), hhmm = String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
            if (hhmm >= '03:50' && _purgeDay !== today) {
                const r = await retentionRun();
                if (!r.error) _purgeDay = today;   // 실패하면 다음 틱에 다시
            }
        } catch (e) { log.error('[문자] 감시 틱 오류:', e.message); }
    }
    // 보관 정리 본체(매일 03:50 · db_retention.enabled 가 true 일 때만) — 사진 비움(30일) · 발송 전 주문 7일 · 셀프 조회 시도 표 1일 ·
    //   🔴 송장 표(delivery_shipments) 60일 삭제는 **건수만 세고**(sms_retention_last) 설정 sms_gateway.purge_shipments === true 일 때만 실제로 지운다(작업 규칙 「물리삭제 금지 · 건수 보고 뒤 대표 「고」」 · 대표 결정 ③「60일 보관」은 켜는 근거)
    async function retentionRun() {
        try {
            const c = await cfg(); const raw = (await naverCfgGet('sms_gateway')) || {};
            const scPurge0 = (selfcheckApi && typeof selfcheckApi.purge === 'function') ? selfcheckApi.purge : (selfcheck && typeof selfcheck.purge === 'function' ? selfcheck.purge : null);
            if (scPurge0) { try { await scPurge0(pool); } catch (e) { log.error('[문자] 셀프 조회 시도 표 정리 실패(무시):', e.message); } }   // 시도 기록(해시)은 보관 정리 스위치와 무관하게 하루 지난 것 정리
            const ret = await naverCfgGet('db_retention');
            if (!(ret && ret.enabled === true)) return { skipped: 'db_retention_off' };
            const r = await pool.query(`UPDATE sms_images SET data = NULL, purged_at = now() WHERE purged_at IS NULL AND data IS NOT NULL AND created_at < now() - make_interval(days => $1::int)`, [c.image_days]);
            let pre = 0, hits = 0;
            if (preorders && typeof preorders.purge === 'function') { try { pre = (await preorders.purge(pool, 7)) || 0; } catch (e) { log.error('[문자] 발송 전 주문 정리 실패(무시):', e.message); } }
            const scPurge = (selfcheckApi && typeof selfcheckApi.purge === 'function') ? selfcheckApi.purge : (selfcheck && typeof selfcheck.purge === 'function' ? selfcheck.purge : null);
            if (scPurge) { try { hits = (await scPurge(pool)) || 0; } catch (e) { log.error('[문자] 셀프 조회 시도 표 정리 실패(무시):', e.message); } }
            const target = (await pool.query(`SELECT count(*)::int AS n FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60`)).rows[0].n;
            let shipDeleted = 0, statusDeleted = 0;
            if (raw.purge_shipments === true && target > 0) {
                shipDeleted = (await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN (SELECT tracking FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60 LIMIT 5000)`)).rowCount || 0;
                statusDeleted = (await pool.query(`DELETE FROM delivery_status t WHERE NOT EXISTS (SELECT 1 FROM delivery_shipments s WHERE s.tracking = t.tracking) AND t.checked_at < now() - interval '60 days'`)).rowCount || 0;
            }
            const result = { date: kstDate(), sms_images: r.rowCount || 0, preorders: pre, selfcheck_hits: hits, shipments_target: target, shipments_deleted: shipDeleted, status_deleted: statusDeleted, purge_shipments: raw.purge_shipments === true };
            await naverCfgSet('sms_retention_last', result);
            if ((r.rowCount || 0) + shipDeleted > 0) await writeAudit({ action: 'purge', targetType: 'sms_retention', changes: { after: result }, source: 'db_retention', actor: { id: null, name: '보관 정리(자동)' } });
            log.log(`[문자] 보관 정리 — 사진 ${r.rowCount}건 · 송장 60일 대상 ${target}행(${raw.purge_shipments === true ? '삭제 ' + shipDeleted : '세기만'})`);
            return result;
        } catch (e) { log.error('[문자] 보관 정리 오류:', e.message); return { error: e.message }; }
    }

    // ── webhook 이벤트 파서(SMSGate · 필드 이름은 워커2 스펙으로 재확인 — 모르는 이벤트는 기록만) ──
    function parseEvent(b) {
        const ev = String(b && (b.event || b.type) || '').trim();
        const p = (b && (b.payload || b.data)) || {};
        const outbound = /^sms:(sent|delivered|failed|cancelled)$/.test(ev);   // 보낸 쪽 이벤트는 sender = 회사폰 자기 번호 · recipient = 손님(워커2 스펙 1-1)
        const phone = outbound ? (p.recipient || p.phoneNumber || (Array.isArray(p.phoneNumbers) ? p.phoneNumbers[0] : null)) : (p.sender || p.phoneNumber || p.from || p.address);
        const at = p.receivedAt || p.sentAt || p.deliveredAt || p.failedAt || p.at || null;
        const atD = at ? new Date(at) : null;
        return { ev, p, outbound, envelope_id: (b && b.id) ? String(b.id) : null, device_id: b && b.deviceId || null, digits: normalizePhone(phone), body: p.message != null ? p.message : (p.text != null ? p.text : (p.body || '')), gateway_id: p.messageId || p.id || null,
            sim_number: Number.isInteger(p.simNumber) ? p.simNumber : null, event_at: atD && !isNaN(atD.getTime()) ? atD : null, reason: p.reason || p.error || null, attachments: Array.isArray(p.attachments) ? p.attachments : [] };   // webhookId(등록 id · 이벤트마다 같음)는 봉투 id 로 쓰지 않는다
    }
    const seenEvents = new Map();   // 같은 이벤트 재시도(2일간 14회) 1차 거름 — 3일 기억(정본은 sms_messages.envelope_id UNIQUE · 재시작 뒤에도 거름)
    function seenOnce(key) { const now = Date.now(); if (seenEvents.size > 5000) for (const [k, t] of seenEvents) if (now - t > 3 * 86400e3) seenEvents.delete(k); if (seenEvents.has(key)) return true; seenEvents.set(key, now); return false; }

    async function handleWebhook(body) {
        const e = parseEvent(body);
        const nowIso = new Date().toISOString();
        if (e.ev === 'system:ping' || e.ev === 'app:started') {
            const st = (await naverCfgGet('sms_gateway_state').catch(() => null)) || {};
            await stateMerge(Object.assign({ last_event_at: nowIso, last_event: e.ev, last_ping_at: nowIso }, e.ev === 'app:started' ? { started_at: nowIso, starts: (Number(st.starts) || 0) + 1 } : {}));
            return { ok: true, event: e.ev };
        }
        await stateMerge({ last_event_at: nowIso, last_event: e.ev });   // 다른 이벤트는 last_event_at 만(ping 간격·재시작 이력이 남게 · 살아 있음 판정은 둘 중 최근) · 병합 쓰기라 동시 이벤트가 서로 지우지 않음
        const dupKey = e.envelope_id ? 'env:' + e.envelope_id : (e.outbound && e.gateway_id ? e.ev + ':' + e.gateway_id : null);   // 봉투 id 가 없으면 보낸 쪽 이벤트(우리 uuid)만 대체 · 받은 글은 messageId 가 내용 기반이라 쓰지 않음
        if (dupKey && seenOnce(dupKey)) return { ok: true, event: e.ev, dup: true };
        const inboundSafe = async (fn) => {   // 받은 글 처리 중 예외 → 손님 글이 조용히 사라지지 않게 직원 몫 + 텔레그램
            try { return await withLane(e.digits || 'x', fn); }
            catch (err) {
                log.error('[문자] 받은 글 처리 실패:', err.message);
                try { if (e.digits) { const t = await threadFor(e.digits); await setThread(t.id, { status: 'staff_needed', last_in_at: new Date(), last_in_text: String(e.body || '').slice(0, 300) }); const c = await cfg(); if (c.enabled) await notifyStaff(c, t, `문자 · 끝 ${phoneTail(e.digits)} 처리 중 오류 · 직접 확인`, STAFF_MSG, { force: true }); } } catch (_) { }
                if (notifyTelegram) { try { await notifyTelegram('⚠️ 회사폰 문자 처리 중 오류: ' + String(err.message).slice(0, 120)); } catch (_) { } }
                return { ok: false, event: e.ev, error: String(err.message).slice(0, 200), action: 'error_to_staff' };
            }
        };
        if (e.ev === 'sms:received') { if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' }; return Object.assign({ ok: true, event: e.ev }, await inboundSafe(() => handleInbound({ digits: e.digits, body: e.body, kind: 'sms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, envelope_id: e.envelope_id }))); }
        if (e.ev === 'sms:batch:received') return { ok: true, event: e.ev, ignored: true, n: Array.isArray(e.p.messages) ? e.p.messages.length : 0 };   // 받은함 다시 읽기(옛 글 내보내기) — 답하면 옛 글마다 봇이 답함 · 등록도 안 함
        // 정상 순서 = mms:received(메타만 · 기록) → mms:downloaded(사진·글 · 여기서 판정). received 가 유실되면 downloaded 가 새 수신으로.
        if (e.ev === 'mms:received') {
            if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' };
            // downloaded 가 먼저 와서 이미 사진이 붙은 줄이 10분 안에 있으면 메타 줄을 새로 만들지 않음(거짓 「사진 못 받음」 알림 방지)
            const already = (await pool.query(`SELECT 1 FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.kind = 'mms' AND m.event_at > now() - interval '10 minutes' AND EXISTS (SELECT 1 FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) LIMIT 1`, [e.digits])).rowCount;
            if (already) return { ok: true, event: e.ev, skipped: 'already_downloaded' };
            return Object.assign({ ok: true, event: e.ev }, await inboundSafe(() => handleInbound({ digits: e.digits, body: '', kind: 'mms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, images: [{ contentType: null, size: e.p.size || null, data: null }], envelope_id: e.envelope_id, recordOnly: true })));
        }
        if (e.ev === 'mms:downloaded') return inboundSafe(() => attachDownloaded(e));
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
        const want = req.body && req.body.url ? String(req.body.url) : null;
        if (want) { try { const h = new URL(want).host, base = new URL(process.env.SMS_PUBLIC_URL || 'https://jeju-acom-company.onrender.com').host; if (h !== base) return res.status(400).json({ ok: false, error: '우리 서버 주소(SMS_PUBLIC_URL)로만 등록할 수 있어요' }); } catch (_) { return res.status(400).json({ ok: false, error: '주소 형식이 틀려요' }); } }
        const r = await registerWebhooks(want);
        await writeAudit({ action: 'update', targetType: 'sms_gateway', changes: { after: { webhooks: r } }, source: 'sms', actor: who(req) });
        res.json(Object.assign({ ok: true }, r));
    }));
    const pub = t => ({ id: t.id, phone_tail: phoneTail(t.phone_digits), phone_masked: phoneMasked(t.phone_digits), phone_full: String(t.phone_digits || ""),   // #624 대표 확정 10/10 「번호 다 뜨게」 — 카드는 전체 번호(화면에서 010-0000-0000 꼴) · 60일 보관 그대로 customer_hint: t.order_hint || null, status: t.status,
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
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender IN ('gateway_other','staff_desk') AND (event_at + interval '9 hours')::date = $1::date) AS today_staff`, [today])).rows[0];
        const lastPing = Math.max(st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0, st.last_event_at ? new Date(st.last_event_at).getTime() : 0);
        const counts = {}; for (const row of (await pool.query(`SELECT status, count(*)::int AS n FROM sms_threads GROUP BY status`)).rows) counts[row.status] = row.n;   // 숫자 칸(워커1 계약 제안 1)
        res.json(Object.assign({ enabled: c.enabled, mode: c.mode, counts }, r, { gateway: { last_ping_at: st.last_ping_at || null, alive: !!lastPing && Date.now() - lastPing < c.ping_alert_hours * 3600e3 } }));
    }));
    app.get('/api/sms/threads', authMiddleware, wrap(async (req, res) => {
        const status = String(req.query.status || 'all'), q = String(req.query.q || '').trim().slice(0, 40), limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const where = [], args = [];
        if (status !== 'all') { if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: '상태 값이 틀려요' }); args.push(status); where.push(`status = $${args.length}`); }
        else where.push(`status <> 'ignored'`);
        if (q) {
            if (/^\d{3,4}$/.test(q)) { args.push(q); where.push(`right(phone_digits, ${q.length}) = ${args.length}`); }   // 숫자는 끝자리 일치만(한 자씩 늘려 전체 번호를 알아내는 뒷문 차단)
            else { args.push('%' + q.replace(/\d/g, '') + '%'); where.push(`(last_in_text ILIKE ${args.length} OR last_out_text ILIKE ${args.length})`); }
        }
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
        const c = await cfg(); const pieces = splitForSms(body, c.max_chars);   // 직원·초안 발송도 봇 답과 같이 max_chars 조각(워커2 지적 · b-2 뒤 1000 으로 올리면 한 통)
        let m = null;
        for (let i = 0; i < pieces.length; i++) { const x = await addMessage({ thread_id: t.id, direction: 'out', kind: 'sms', body: pieces[i], sender: 'staff_desk', state: 'queued', rule_kind: kind || null, priority: Math.max(0, 9 - i), ai_json: { part: i + 1, parts: pieces.length }, send_after: new Date() }); if (!m) m = x; }
        await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:staff_desk' WHERE thread_id = $1 AND direction = 'out' AND state = 'queued' AND sender <> 'staff_desk'`, [t.id]);
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null });
        await writeAudit({ action: 'create', targetType: 'sms_reply', targetId: m.id, changes: { after: { thread: t.id, kind: kind || 'staff', bytes: byteLen(body) } }, source: 'sms', actor: who(req) });
        return m;
    }
    async function cancelPendingExcept(threadId, keepId) { await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:staff_desk' WHERE thread_id = $1 AND direction = 'out' AND state = 'queued' AND id <> $2`, [threadId, keepId]); }
    const loadThread = async (req, res) => { const id = parseInt(req.params.id, 10); const t = id ? (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [id])).rows[0] : null; if (!t) { res.status(404).json({ ok: false, error: '없는 대화예요' }); return null; } return t; };
    app.post('/api/sms/threads/:id/reply', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const text = String(req.body && req.body.text || '').trim(); if (!text) return res.status(400).json({ ok: false, error: '보낼 글이 비었어요' });
        const c = await cfg(); if (!c.enabled) return res.status(409).json({ ok: false, error: '문자 연동이 꺼져 있어요(설정 sms_gateway.enabled)' });
        const m = await queueStaffReply(t, text, req, 'staff'); if (!m) return res.status(400).json({ ok: false, error: '문자로 보낼 글자가 없어요(이모지만 있으면 지워져요)' }); res.json({ ok: true, message_id: m.id });
    }));
    app.post('/api/sms/threads/:id/send-draft', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const c = await cfg(); if (!c.enabled) return res.status(409).json({ ok: false, error: '문자 연동이 꺼져 있어요' });
        const taken = (await pool.query(`WITH old AS (SELECT id, draft_text, draft_kind FROM sms_threads WHERE id = $1 AND draft_text IS NOT NULL FOR UPDATE)
            UPDATE sms_threads t SET draft_text = NULL FROM old WHERE t.id = old.id RETURNING old.draft_text, old.draft_kind`, [t.id])).rows[0];   // 두 사람이 동시에 눌러도 한 번만(RETURNING 은 새 값이라 옛 값은 CTE 로)
        if (!taken) return res.status(409).json({ ok: false, error: '보낼 초안이 없어요(이미 보냈을 수 있어요)' });
        const m = await queueStaffReply(t, taken.draft_text, req, 'draft:' + (taken.draft_kind || '')); if (!m) return res.status(400).json({ ok: false, error: '초안에 문자로 보낼 글자가 없어요' }); res.json({ ok: true, message_id: m.id });
    }));
    app.post('/api/sms/threads/:id/handled', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'handled');
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null });
        res.json({ ok: true, cancelled });
    }));
    app.post('/api/sms/threads/:id/close', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'close');
        await setThread(t.id, { status: 'closed', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null });
        res.json({ ok: true, cancelled });
    }));
    // 설정 보기·바꾸기(관리자 · 모드 전환은 여기서 — 첫 자동 발송(auto) 전환은 대표 「고」 뒤)
    app.get('/api/sms/config', authMiddleware, wrap(async (req, res) => { const c = await cfg(true); res.json(Object.assign({}, c, { gateway_env: { user: !!gwEnv().user, pass: !!gwEnv().pass, signing_key: !!(process.env.SMSGATE_SIGNING_KEY || process.env.SMSGATE_WEBHOOK_SECRET) }, modules: { classify: !!classifyMod, rules: !!rulesMod, lookup: !!lookupMod, photo: !!(photoJudge && photoReply), ai_note: !!aiNote, followup: !!followup, selfcheck: !!selfcheck, photo_test: !!photoTest, preorders: !!preorders } })); }));
    app.post('/api/sms/config', authMiddleware, wrap(async (req, res) => {
        if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '관리자만' });
        const prev = (await naverCfgGet('sms_gateway')) || {}; const next = Object.assign({}, prev, req.body || {});
        const c = cfgOf(next); await naverCfgSet('sms_gateway', Object.assign({}, next, c));
        await writeAudit({ action: 'update', targetType: 'sms_gateway', changes: { before: cfgOf(prev), after: c }, source: 'sms', actor: who(req) });
        _cfgCache = null; res.json({ ok: true, config: c });
    }));

    // 하위 모듈 장착(워커 몫 · 없으면 건너뜀): 셀프 조회 페이지 · 사진 판독 시험 라우트
    try { const sm = typeof selfcheck === 'function' ? selfcheck : (selfcheck && selfcheck.mount); if (typeof sm === 'function') selfcheckApi = sm(app, { pool, lookup: lookupMod, cjTrack, holidays: loadShippingHolidayInfo, log, secret: process.env.JWT_SECRET, notifyTelegram }); } catch (e) { log.error('[문자] 셀프 조회 페이지 장착 실패:', e.message); }   // /track-order · /api/track-order · /track-order/go
    try { const pm = typeof photoTest === 'function' ? photoTest : (photoTest && photoTest.mount); if (typeof pm === 'function') pm(app, { authMiddleware, log }); } catch (e) { log.error('[문자] 사진 시험 라우트 장착 실패:', e.message); }   // sms/photo-test.js(워커5) · judge·reply 는 모듈이 스스로 require
    const timers = [];
    function start() {
        timers.push(setInterval(() => { sendTick(); }, 10 * 1000));
        timers.push(setInterval(() => { watchTick(); }, 60 * 1000));
    }
    function stop() { for (const t of timers) clearInterval(t); timers.length = 0; }

    return { initDB, start, stop, handleWebhook, handleInbound, handleSent, sendTick, watchTick, cfg, cfgOf, parseEvent, verifySignature, normalizePhone, smsSafeText, phoneMasked, phoneTail, modules: { classify: !!classifyMod, rules: !!rulesMod, lookup: !!lookupMod, photo: !!(photoJudge && photoReply), aiNote: !!aiNote }, _gatewaySend: gatewaySend, registerWebhooks, splitForSms, smsSafe, pendingPhotoTick, attachDownloaded, sweepStuck, retentionRun, stateMerge, resetCfg: () => { _cfgCache = null; } };
};
module.exports.normalizePhone = normalizePhone;
module.exports.smsSafeText = smsSafeText;
module.exports.splitForSms = splitForSms;
module.exports.DEFAULT_CFG = DEFAULT_CFG;

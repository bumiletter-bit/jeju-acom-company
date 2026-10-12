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
const DEFAULT_CFG = { enabled: false, mode: 'record', cooldown_min: 30, daily_cap: 3, hourly_send_cap: 30, hold_sec: 75, staff_ids: [], ping_alert_hours: 3, image_days: 30, lookup_days: 14, max_chars: 70, ttl_sec: 600, staff_lock_hours: 24, staff_open_hours: 6, context_msgs: 6, draft_daily_cap: 20, history_days: 60 };   // draft_daily_cap = 자동 발송이 막힌 갈래에서 AI 초안을 만드는 번호당 하루 횟수(#652 · 0 = 상한 없음) · history_days = 직원 화면 구매이력 기간(#654)   // staff_open_hours = 직원 몫(아무도 안 답함)이 손님 마지막 글 뒤 그 시간 지나면 저절로 끝남(0 = 안 품) · context_msgs = AI 에 같이 주는 앞 대화 통 수(0 = 안 줌)   // staff_lock_hours = 직원이 답한 대화가 그 시간 지나면 저절로 「끝남」(대표 확정 10/10 · 0 이면 안 품)
// #635(대표 「고」 10/11 · 폰 문자함 구도): 목록 = 안 읽은 글이 있는 대화(staff_read_at 뒤 들어온 글 수) · 열면 0 · 초안은 손님 글이 올 때마다 새로(쿨다운·하루 상한·잠금·되풀이는 자동 발송만 막는다) · 쿨다운 기본 30분
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
        if ((sen.includes('http://') || sen.includes('https://')) && len(sen) > maxChars) { if (cur) { out.push(cur); cur = ''; } out.push(sen); continue; }   // #643: 주소가 든 줄은 한도보다 길어도 자르지 않는다(끊긴 주소는 안 눌린다) — 그 줄만 한 통
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
            draft_daily_cap: num(v.draft_daily_cap, DEFAULT_CFG.draft_daily_cap, 0, 1000),   // #652
            history_days: num(v.history_days, DEFAULT_CFG.history_days, 1, 60),               // #654(송장 표가 60일 뒤 지워져 60이 상한)
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
        run.finally(() => { if (_lanes.get(key) === run) _lanes.delete(key); }).catch(() => { });   // #652: finally 가 돌려주는 약속도 받아 둔다(fn 이 던지면 「받지 않은 거부」로 프로세스가 죽을 수 있다)
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
        // #635: staff_read_at = 직원이 마지막으로 연 시각(그 뒤 들어온 글 수 = 안 읽음) · staff_why = 사람 몫 사유(초안이 생기면 null)
        //   칸을 처음 만들 때만: 이미 끝났거나 봇이 답한 옛 대화는 「읽음」으로(안 그러면 옛 대화 전부가 안 읽음으로 뜬다) · 직원 몫·초안 대기는 안 읽음 그대로 + 초안 없는 직원 몫엔 사유 'staff'
        // #652: 받은 글을 먼저 적고 판정은 그 뒤 — 판정이 끝난 글에 decided_at. 처음 칸이 생길 때 있던 글은 전부 「끝난 글」로(옛 글을 다시 판정하지 않게)
        const had652 = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_messages' AND column_name = 'decided_at'`)).rowCount > 0;
        await pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS decided_at timestamptz`);
        if (!had652) await pool.query(`UPDATE sms_messages SET decided_at = COALESCE(created_at, now()) WHERE decided_at IS NULL`);
        await pool.query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS deciding_at timestamptz`);   // 판정을 집은 시각(같은 글을 after 와 다시 판정 틱이 둘 다 판정하지 않게 · 5분 넘게 안 끝나면 죽은 것으로 보고 다시 집힘)
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_undecided ON sms_messages(id) WHERE direction = 'in' AND decided_at IS NULL`);
        await pool.query(`ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS gated_ai_n integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS gated_ai_day text`);   // #652 초안 하루 상한 셈(KST 날짜 글자)
        const had635 = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_threads' AND column_name = 'staff_read_at'`)).rowCount > 0;
        await pool.query(`ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS staff_read_at timestamptz, ADD COLUMN IF NOT EXISTS staff_why text`);
        await pool.query(`ALTER TABLE sms_threads ADD COLUMN IF NOT EXISTS done_json jsonb`);   // #675 [처리함](전화 등으로 처리) — 되돌리기용으로 그때의 사유·상태·초안을 적어 둔다
        if (!had635) {
            await pool.query(`UPDATE sms_threads SET staff_read_at = now() WHERE status NOT IN ('staff_needed','draft')`);
            await pool.query(`UPDATE sms_threads SET staff_why = 'staff' WHERE status = 'staff_needed' AND draft_text IS NULL`);
        }
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

    // #648 시험 번호 = 검증 스크립트가 쓰는 0999… — 검증 인스턴스(deps.testMode)가 아니면 집지도·세지도·보여 주지도·알리지도 않는다
    const isTestDigits = d => String(d || '').startsWith('0999');
    // #652 A(워커4 교차 점검): **틱·정리처럼 표를 고치는 문장**은 따로 거른다 — 라이브 = 시험 번호 빼고 / 검증 인스턴스(testMode) = 시험 번호 줄**만**.
    //   종전에는 testMode 면 거름이 없어, 검증이 부르는 sendTick·sweepStuck·다시 판정이 실제 손님 줄을 집을 수 있었다(가짜 게이트웨이로 「보냄」 처리 · 가짜 AI 로 판정)
    const TICK_T = deps.testMode ? "AND t.phone_digits LIKE '0999%'" : "AND t.phone_digits NOT LIKE '0999%'";     // 별칭 t(sms_threads)
    const TICK_P = deps.testMode ? "AND phone_digits LIKE '0999%'" : "AND phone_digits NOT LIKE '0999%'";         // sms_threads 별칭 없이
    const TICK_M = deps.testMode ? "AND thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE '0999%')" : "AND thread_id NOT IN (SELECT id FROM sms_threads WHERE phone_digits LIKE '0999%')";   // sms_messages
    const TEST_HIDE = deps.testMode ? '' : "AND phone_digits NOT LIKE '0999%'";                                   // sms_threads 를 별칭 없이 읽는 문장용
    const TEST_HIDE_T2 = deps.testMode ? '' : "AND t.phone_digits NOT LIKE '0999%'";                               // 별칭 t
    const TEST_HIDE_MSG = deps.testMode ? '' : "AND thread_id NOT IN (SELECT id FROM sms_threads WHERE phone_digits LIKE '0999%')";   // sms_messages 문장용
    // ── 대화·메시지 ──
    async function threadFor(digits) {
        const r = await pool.query(`INSERT INTO sms_threads (phone_digits) VALUES ($1) ON CONFLICT (phone_digits) DO UPDATE SET updated_at = now() RETURNING *`, [digits]);
        return r.rows[0];
    }
    const SQL_NOW = Symbol('sql-now');
    async function setThread(id, fields) {
        const keys = Object.keys(fields); if (!keys.length) return;
        const args = [id];   // 값이 SQL_NOW 면 자리표 없이 now()(DB 시계 · #635 staff_read_at)
        const sets = keys.map(k => { const v = fields[k]; if (v === SQL_NOW) return `${k} = now()`; args.push(v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v); return `${k} = $${args.length}`; }).join(', ');
        await pool.query(`UPDATE sms_threads SET ${sets}, updated_at = now() WHERE id = $1`, args);
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
        if (!deps.testMode) {   // #648: 시험 번호(0999…) 대화는 라이브 서버가 알리지 않는다 — 검증이 넣은 줄을 라이브 틱이 집어 진짜 직원에게 헛알림이 가던 것
            let pd = thread && thread.phone_digits;
            if (!pd && thread && thread.id) { try { pd = ((await pool.query(`SELECT phone_digits FROM sms_threads WHERE id = $1`, [thread.id])).rows[0] || {}).phone_digits; } catch (e) { pd = ''; } }
            if (isTestDigits(pd)) return 0;
        }
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

    // ── #665(대표 10/12): 문자가 왔는데 주문을 못 찾으면 그 순간 최근 주문을 1회 받아와 다시 찾는다 ──
    //   발송 전 주문 수집은 60분 1회라 주문 직후 문자는 「주문을 찾지 못한 번호」가 된다 → 필요할 때만 조회(주기 단축 대신 · 네이버 호출·429 위험 최소).
    //   조건: 설정 preorders === true · lookup_refresh.enabled !== false · 같은 번호 per_number_min(10)분에 1회 · 전체 1시간 hourly_cap(20)회 · 주기 수집이 5분 안에 돌았거나 도는 중이면 생략 ·
    //   한꺼번에 한 번만(겹친 문자는 같은 조회를 기다림) · timeout_sec(10) 넘거나 실패하면 종전대로 「주문 없음」. 받아온 줄은 얹기만(preorders.collect merge — 옛 줄 셈·삭제 없음)
    const _rfNum = new Map(); let _rfHour = [], _rfBusy = null;
    const RF_LOCK_MS = Number(deps.refreshLockMs) > 0 ? Number(deps.refreshLockMs) : 120000;
    const channelBusy = () => { try { return typeof deps.ordersBusy === 'function' && !!deps.ordersBusy(); } catch (e) { return false; } };
    function refreshCfg(raw) {
        const v = (raw && typeof raw.lookup_refresh === 'object' && raw.lookup_refresh) || {}; const num = (x, d, min, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
        return { on: !!raw && raw.preorders === true && v.enabled !== false, per_number_min: num(v.per_number_min, 10, 1, 1440), hourly_cap: num(v.hourly_cap, 20, 1, 500), timeout_sec: num(v.timeout_sec, 10, 1, 30), days: num(v.days, 2, 1, 3) };
    }
    async function refreshPreorders(digits) {
        if (!(preorders && typeof preorders.collect === 'function')) return 'off';
        const fns = { fetchNaver: deps.fetchNaver, fetchCoupang: deps.fetchCoupang, fetchCafe24: deps.fetchCafe24 };
        if (!Object.values(fns).some(f => typeof f === 'function')) return 'off';
        const rc = refreshCfg((await naverCfgGet('sms_gateway')) || {}); if (!rc.on) return 'off';
        if (channelBusy()) return 'skip:busy';   // 송장변환·중간발주 등 다른 주문 조회가 도는 중(서버가 deps.ordersBusy 로 알려 줄 때만) → 겹치지 않게 생략(종전 길)
        if (_rfBusy) return _rfBusy;   // 지금 도는 조회가 있으면 그 결과를 같이 기다린다(호출 겹침 없음)
        const now = Date.now(); const lastN = _rfNum.get(digits);
        if (lastN && now - lastN < rc.per_number_min * 60000) return 'skip:number';
        _rfHour = _rfHour.filter(t => now - t < 3600e3); if (_rfHour.length >= rc.hourly_cap) return 'skip:hourly';
        const lastP = (await naverCfgGet('sms_preorders_last').catch(() => null)) || {}; const age = lastP.at ? now - new Date(lastP.at).getTime() : Infinity;
        if (age < 5 * 60000) return lastP.running ? 'skip:running' : 'skip:recent';   // 주기 수집이 방금 돌았거나(5분) 도는 중
        _rfNum.set(digits, now); _rfHour.push(now); if (_rfNum.size > 500) for (const [k, t] of _rfNum) if (now - t > 86400e3) _rfNum.delete(k);
        const run = (async () => {
            try { const r = await preorders.collect({ pool, fetchNaver: fns.fetchNaver, fetchCoupang: fns.fetchCoupang, fetchCafe24: fns.fetchCafe24, log }, { days: rc.days, merge: true }); return { r }; }
            catch (e) { return { error: String(e && e.message || e).slice(0, 160) }; }
        })();
        const limit = Number(deps.refreshTimeoutMs) > 0 ? Number(deps.refreshTimeoutMs) : rc.timeout_sec * 1000;
        const job = (async () => {
            let timer; const o = await Promise.race([run, new Promise(res => { timer = setTimeout(() => res({ timeout: true }), limit); if (timer.unref) timer.unref(); })]); clearTimeout(timer);
            return o.timeout ? 'timeout' : (o.error ? 'error' : 'done');
        })();
        _rfBusy = job; const rel = setTimeout(() => { if (_rfBusy === job) { _rfBusy = null; log.error('[문자] 즉시 주문 조회가 ' + Math.round(RF_LOCK_MS / 1000) + '초 넘게 안 끝나 잠금을 풉니다'); } }, RF_LOCK_MS); if (rel.unref) rel.unref();   // #671 조회가 안 끝나도 잠금은 2분까지만(즉시 조회·주기 수집이 멈추지 않게)
        run.then(o => { clearTimeout(rel); if (_rfBusy === job) _rfBusy = null; if (o.error) log.error('[문자] 즉시 주문 조회 실패(종전대로 주문 없음):', o.error); });   // 시간 초과여도 실제 조회가 끝날 때까지는 다음 조회·주기 수집을 막는다
        return job;
    }
    async function orderForFresh(digits, c, bucket, first) {
        if (!(first && first.match === 'none') || first.why === 'bad-phone' || !isDomestic(digits) || digits.length < 10) return first;
        if (['otp', 'ad', 'carrier', 'greeting', 'wrong', 'refuse'].includes(bucket)) return first;   // 무시 갈래(인증번호·광고·통신사·감사 인사)와 잘못 온 글·수신 거부는 조회하지 않는다
        let how = 'off', t0 = Date.now(), again = first;
        try { how = await refreshPreorders(digits); if (how === 'done') { const r2 = await orderFor(digits, c); if (r2) again = r2; } }
        catch (e) { how = 'error'; log.error('[문자] 즉시 주문 조회 실패(무시):', e.message); }
        if (how === 'off') return first;
        const found = !!(again && again.match !== 'none');
        log.log('[문자] 즉시 주문 조회 끝 ' + phoneTail(digits) + ' → ' + how + (how === 'done' ? (found ? ' · 찾음' : ' · 없음') : '') + ' · ' + (Date.now() - t0) + 'ms');
        try { const st = ((await naverCfgGet('sms_gateway_state').catch(() => null)) || {}).lookup_refresh || {}; const day = kstDate(); const base = st.day === day ? st : { day, tried: 0, found: 0, skipped: 0 };
            await stateMerge({ lookup_refresh: { day, tried: base.tried + (/^skip/.test(how) ? 0 : 1), found: base.found + (found ? 1 : 0), skipped: base.skipped + (/^skip/.test(how) ? 1 : 0), last_at: new Date().toISOString(), last: how, last_found: found, last_ms: Date.now() - t0 } }); } catch (e) { }
        if (found) again.refreshed = true;
        return again;
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
    // 화면·힌트용(허용 목록만 · 주소·손님 이름 전체 없음) — 직원 화면에만 쓰는 꼴 + 한 줄 요약. #644: 운송장은 전체 번호(order.trackings)를 싣는다(직원 화면 전용 · 알림·한 줄 요약에는 안 넣는다)
    // #654: 발송 전 주문의 발송 예정일 글자 — rules.prePlan(발송 전 답과 같은 계산기·같은 조건). 모듈·달력을 못 읽으면 null
    async function prePlanOf(order) {
        try {
            if (!(rulesMod && typeof rulesMod.prePlan === 'function')) return null;
            const holidays = loadShippingHolidayInfo ? await loadShippingHolidayInfo() : null;
            return rulesMod.prePlan({ order, holidays, now: Date.now() }) || null;
        } catch (e) { return null; }
    }
    async function orderHintOf(r) {
        if (!(r && r.match === 'one' && r.order)) return null;
        // #644(대표 10/11 「이름도 모두 그대로」): 받는 분 이름 전체는 직원 화면용으로만 여기서 따로 읽는다 — 주문 찾기 결과(lookup · 규칙·AI·사진 답의 재료)에는 이름 전체를 싣지 않는다(그쪽 SELECT 가 안 읽음 · 손님 글로 샐 길 없음)
        let recipientName = '';
        try {
            const trs = Array.isArray(r.order.trackings) ? r.order.trackings.filter(Boolean).slice(0, 5) : [];
            if (trs.length) recipientName = String((await pool.query(`SELECT btrim(min(recipient)) AS n FROM delivery_shipments WHERE tracking = ANY($1::text[])`, [trs])).rows[0].n || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        } catch (e) { log.error('[문자] 받는 분 이름 읽기 실패(무시):', e.message); }
        const pubo = (typeof lookupMod.toStaff === 'function') ? lookupMod.toStaff(r) : (typeof lookupMod.toPublic === 'function') ? lookupMod.toPublic(r) : null;
        if (!pubo) return null;
        if (pubo.order && pubo.order.pre) pubo.order.ship_plan = await prePlanOf(Object.assign({}, r.order));   // #654 직원 화면 「발송 전 · 10/12(월) 발송 예정」(계산 못 하면 null)
        if (pubo.order && recipientName) pubo.order.recipient_name = recipientName;   // 한 줄 요약(line)·알림에는 넣지 않는다
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
    // #645(대표 실물 10/11 — 주문이 없는 번호의 「택배 언제 와요」에 AI 가 「말씀드린 대로 내일 오전 … 출발해서 모레 도착 예정」을 지어내 자동 발송):
    //   ① 「내 주문」을 묻는 배송·주문 물음인데 그 번호로 주문을 못 찾으면 AI 에 넘기지 않는다 → 고정 문구(성함·연락처를 여쭘) + 직원 확인(staff_why order_not_found)
    //      「지금 주문하면 언제 와요」「얼마예요」처럼 사기 전 물음(GENERAL_Q_RE)은 종전대로 AI(일반 안내)
    //   ② AI 는 주문 정보를 받지 않는다 → AI 글에 그 손님의 발송·도착을 단정하는 말이 있으면 보내지 않고 직원 몫(ai_assert). 조건을 단 일반 안내(「8시 이전 주문은 당일 발송」)는 막지 않는다
    const NOT_FOUND_TEXT = '안녕하세요 고객님 ^^ 보내주신 번호로는 주문이 확인되지 않습니다.\n주문하신 분 또는 받으시는 분 성함과 연락처를 알려 주시면 바로 확인해 드리겠습니다.';   // 규칙 모듈이 없을 때의 물러남 글(평소엔 rules.notFoundText)
    const notFound = o => smsSafe((rulesMod && typeof rulesMod.notFoundText === 'function') ? rulesMod.notFoundText(o) : NOT_FOUND_TEXT);
    // #646 오늘(한국 날짜) 이 대화에 우리가 보낸 글(직원·봇 · 취소·실패 제외)이 이미 있는가 — 있으면 둘째 답부터 머리 인사를 줄인다
    async function repliedToday(thread, inMsg) {
        try { return (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND id <> $2 AND direction = 'out' AND state NOT IN ('cancelled','failed') AND (created_at + interval '9 hours')::date = (now() + interval '9 hours')::date LIMIT 1`, [thread.id, inMsg.id || 0])).rowCount > 0; }
        catch (e) { return false; }
    }
    const GENERAL_CORE_RE = /주문하면|주문\s*시(?![켰킨키])|주문할(?!게|께|래|거|겁|건)|주문하려|주문하고\s*싶|주문\s*하려|시키면|시킬|구매하면|구매\s*시|구매하려|구매할|(^|[\s,.!?])사면|사려|살려|사고\s*싶|얼마(?!나|\s*전|\s*안|\s*동안)|(주문|구매|결제)\s*방법|어떻게\s*(주문|구매)|(주문|구매)[은을]?\s*어떻게/;
    const GENERAL_Q_RE = { test: t => { const s = String(t || ''); return GENERAL_CORE_RE.test(s) || (/가격/.test(s) && /얼마|알려|궁금|\?|？|문의|가격표/.test(s)); } };   // #650 C: 「얼마 전」「그 방법으로」「이 가격에 이 품질」은 사기 전 물음이 아니다 — 「방법」은 주문·구매·결제 방법일 때만 · 「가격」은 물음과 같이 있을 때만
    const AI_COND_RE = /주문하시면|주문하면|주문\s*시(?![켰킨키])|이전\s*주문|이후\s*주문|전에\s*주문|까지\s*주문|결제하시면|결제\s*시|경우|보통|대부분|평균/;   // 조건·일반론 문장 표시(「주문 건·주문은·주문분」은 그 손님 주문을 가리킬 수 있어 조건으로 보지 않는다)
    const AI_PAST_RE = /말씀\s*드린\s*대로|안내\s*드린\s*대로|앞서\s*(말씀|안내)|출발했|출발해서|출발하여|발송됐|발송되었|발송했|발송해\s*드렸|발송\s*완료|보내\s*드렸|도착했|배송\s*중이|배송\s*시작|이동\s*중|나갑니다|나갔|나갈\s*예정|가고\s*있|오고\s*있|곧\s*(도착|받|출발|발송|나가)/;
    const AI_DATE_RE = /(오늘|내일|모레|\d{1,2}\s*일|\d{1,2}\/\d{1,2}|[월화수목금토일]요일(?!은|엔|에는|마다|도))[^.!?\n]{0,24}(출발|발송|도착|배송|받으실|받아\s*보실|나갑|나가|나갈)/;   // 「토요일은 발송을 쉬고」 같은 요일 일반론은 뺀다
    function aiAsserts(text) {   // 한 문장이라도 「조건 없이」 발송·도착을 단정하면 true
        return String(text || '').split(/(?<=[.!?。])\s+|\n+/).some(sen => { const s = sen.trim(); if (!s) return false; if (/말씀\s*드린\s*대로|안내\s*드린\s*대로|앞서\s*(말씀|안내)/.test(s)) return true; if (AI_COND_RE.test(s)) return false; return AI_PAST_RE.test(s) || AI_DATE_RE.test(s); });
    }
    async function composeAnswer(thread, inMsg, c, lookup, opts) {
        const text = String(inMsg.body || '');
        const bucket = inMsg.bucket || 'other';
        if (['otp', 'ad', 'carrier', 'greeting'].includes(bucket)) return { text: null, kind: null, toStaff: false, why: 'ignore:' + bucket };
        if (bucket === 'photo' || bucket === 'account') return { text: null, kind: null, toStaff: true, why: bucket };   // #628 account = 계좌·입금(사람)
        if (bucket === 'request' || bucket === 'call') return { text: null, kind: null, toStaff: true, why: bucket };     // #650 주문·변경·취소 요청 · 전화 요청 = 사람(봇 답·초안 없음)
        if (bucket === 'wrong' || bucket === 'refuse') return { text: null, kind: null, toStaff: true, why: bucket === 'wrong' ? 'wrong_number' : 'refuse' };
        const again = await repliedToday(thread, inMsg);
        const askName = () => (rulesMod && typeof rulesMod.askNameText === 'function') ? rulesMod.askNameText(again) : ((rulesMod && rulesMod.ASK_NAME_TEXT) || (lookupMod && lookupMod.askText ? lookupMod.askText() : '주문을 여러 건 찾았어요. 어느 분께 보내신 건인지 받는 분 성함을 알려 주시면 확인해 드릴게요.'));
        // #646(대표 10/11 「주문자나 수취인이 연락 오면 톡톡처럼 그대로 응대 · 없으면 주문자나 수취인을 물어보는 구도」): 불만 글
        //   주문을 찾았으면 톡톡 시나리오 뜻의 고정 답을 보내고 직원 확인(staff_why claim) — 그 대화에 한 번만 · 못 찾았으면 성함·연락처 되묻기 · 여럿이면 받는 분 되묻기. 미도착·오배송류와 규칙 모듈이 없을 때는 종전대로 사람 몫
        if (bucket === 'claim') {
            if (!(rulesMod && typeof rulesMod.claimText === 'function')) return { text: null, kind: null, toStaff: true, why: 'claim' };
            if (lookup && lookup.match === 'many') return { text: askName(), kind: 'ask', toStaff: false, why: 'many', staff_flag: 'claim', auto_ok: true };
            if (!(lookup && lookup.match === 'one')) return { text: notFound({ claim: true }), kind: 'rule', rule_kind: 'order_not_found', toStaff: false, why: 'order_not_found', staff_flag: 'claim' };
            const ct = rulesMod.claimText({ text });
            if (!ct) return { text: null, kind: null, toStaff: true, why: 'claim' };
            let sentBefore = true;
            try { sentBefore = (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND direction = 'out' AND rule_kind = 'claim' AND state NOT IN ('cancelled','failed') AND created_at > now() - interval '30 days' LIMIT 1`, [thread.id])).rowCount > 0; } catch (e) { sentBefore = true; }
            if (sentBefore) return { text: null, kind: null, toStaff: true, why: 'claim' };   // 불만 답은 한 번만 — 이어지는 불만 글은 사람이 받는다
            return { text: smsSafe(ct), kind: 'rule', rule_kind: 'claim', toStaff: false, why: 'claim_reply', staff_flag: 'claim', auto_ok: (typeof rulesMod.claimAuto === 'function') ? rulesMod.claimAuto({ text }) : false };   // #650 ③ 상태 낱말이 있고 물음이 아닐 때만 자동 · 「환불·반품·교환」만 있는 글·물음 꼴은 초안
        }
        if (lookup && lookup.match === 'many') return { text: askName(), kind: 'ask', toStaff: false, why: 'many', auto_ok: true };   // #650 ④
        if (rulesMod && typeof rulesMod.answer === 'function') {
            try {
                const holidays = loadShippingHolidayInfo ? await loadShippingHolidayInfo() : null;
                const r = rulesMod.answer({ text, bucket, order: lookup, holidays, now: Date.now(), again });
                if (r && r.staff) return { text: null, kind: null, toStaff: true, why: 'rule_' + (r.why || 'staff') };   // 예약 상품 · 발송/도착 예정일 지남 = 규칙이 「사람」으로 판정
                if (r && r.text) return { text: smsSafe(r.text), kind: 'rule', rule_kind: r.kind || null, toStaff: false, why: 'rule', auto_ok: !!(lookup && lookup.match === 'one') };   // #650 ① 주문을 찾은 손님의 규칙 답
            } catch (e) { log.error('[문자] 규칙 답 실패(무시):', e.message); }
        }
        if ((bucket === 'ship_q' || bucket === 'order_q') && !lookup && !GENERAL_Q_RE.test(text)) return { text: null, kind: null, toStaff: true, why: 'lookup_error' };   // 주문 찾기 실패(DB 오류·모듈 없음) = 틀린 「주문이 확인되지 않습니다」를 보내지 않는다
        if ((bucket === 'ship_q' || bucket === 'order_q') && !(lookup && lookup.match === 'one') && !GENERAL_Q_RE.test(text))   // #645 ① 주문을 못 찾은 「내 주문」 물음 — AI 호출 없음
            return { text: notFound({ again }), kind: 'rule', rule_kind: 'order_not_found', toStaff: false, why: 'order_not_found', staff_flag: 'order_not_found' };
        if (opts && opts.noAi) return { text: null, kind: null, toStaff: true, why: 'draft_cap' };   // #652 초안 하루 상한을 넘은 번호 — AI 를 부르지 않는다(규칙 답·고정 문구는 위에서 이미 나갔다)
        if (typeof qnaGenerate === 'function') {
            try {
                if (opts) opts.aiUsed = true;
                const g = await qnaGenerate(await withContext(thread, inMsg, text, c), null, undefined, 'sms');   // #625: 앞 대화(최근 context_msgs 통 · 48시간 안)를 질문 앞에 붙여 되풀이 답을 막는다
                if (g && g.answer) {
                    const parsed = aiNote && typeof aiNote.parse === 'function' ? aiNote.parse(g.answer) : { toStaff: /^\[사람\]/.test(g.answer), text: g.answer.replace(/^\[사람\]\s*/, '') };
                    if (parsed.toStaff) return { text: null, kind: null, toStaff: true, why: 'ai_to_staff' };
                    if (/환불|반품|교환|보상|무료\s*수거|취소\s*(해|처리)|포인트|적립|쿠폰|할인해|보내\s*드리겠|재발송|재배송/.test(parsed.text)) return { text: null, kind: null, toStaff: true, why: 'ai_promise' };   // 약속 낱말은 사람(안내 블록만 믿지 않음)
                    if (aiAsserts(parsed.text)) return { text: null, kind: null, toStaff: true, why: 'ai_assert' };   // #645 ② 주문 정보 없이 발송·도착을 단정한 글 = 사람
                    return { text: smsSafe(parsed.text), kind: 'ai', toStaff: false, why: 'ai', used: g.used, auto_ok: GENERAL_Q_RE.test(text) };   // #650 ② 명백한 사기 전 물음에 대한 AI 답만 자동 · 그 밖 AI 답은 초안
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
    // #652: 적기와 판정을 나눈다 — webhook 은 「줄 적기」까지 끝낸 뒤 200 을 주고(배포·재시작 순간에도 글이 남는다) 판정·AI·주문 찾기는 그 뒤.
    //   recordInbound → { done }(중복·메타만 = 판정 없음) 또는 { thread, msg, bodyText, imgs } · decideRecorded 가 판정하고 끝나면 decided_at 을 찍는다(실패해도 찍는다 — 실패는 inboundSafe 가 직원 몫으로)
    const markDecided = id => pool.query(`UPDATE sms_messages SET decided_at = now() WHERE id = $1`, [id]).catch(() => { });
    async function recordInbound({ digits, body, kind, gateway_id, sim_number, event_at, images, envelope_id, recordOnly }) {
        const thread = await threadFor(digits);
        const imgs = imageOnly(images);
        const bodyText = String(body || '').trim() || textParts(images).join('\n');
        const hasImage = imgs.length > 0;
        const bucket = recordOnly ? 'photo_pending' : await bucketSmart(bodyText, digits, hasImage, thread.status !== 'new' || !!thread.order_hint);
        const msg = await addMessage({ thread_id: thread.id, direction: 'in', kind: kind || (hasImage ? 'mms' : 'sms'), body: bodyText, sender: 'customer', state: 'received', gateway_id, sim_number, bucket, event_at, envelope_id });
        if (!msg) return { done: { thread_id: thread.id, dup: true, action: 'dup' } };
        if (hasImage) await saveImages(msg.id, imgs);
        if (recordOnly) { await setThread(thread.id, { last_in_at: msg.event_at, last_in_text: thread.last_in_text || '', has_image: thread.has_image || hasImage }); await markDecided(msg.id); return { done: { thread_id: thread.id, message_id: msg.id, bucket, action: 'pending_photo' } }; }
        return { thread, msg, bodyText, imgs };
    }
    async function decideRecorded(rec) {
        if (!rec || rec.done) return Object.assign({}, rec && rec.extra, rec && rec.done);
        // D: 한 글은 한 번만 판정 — 아직 안 끝났고 다른 쪽이 집지 않은(또는 5분 넘게 멈춘) 글만 집는다
        const got = await pool.query(`UPDATE sms_messages SET deciding_at = now() WHERE id = $1 AND decided_at IS NULL AND (deciding_at IS NULL OR deciding_at < now() - interval '5 minutes') RETURNING id`, [rec.msg.id]);
        if (!got.rowCount) return Object.assign({}, rec.extra, { thread_id: rec.thread.id, message_id: rec.msg.id, action: 'already_decided' });
        try {
            const thread = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [rec.thread.id])).rows[0] || rec.thread;   // 적은 뒤 사이에 다른 글이 상태를 바꿨을 수 있다
            return Object.assign({}, rec.extra, await decideInbound(thread, rec.msg, await cfg(), { bodyText: rec.bodyText, images: rec.imgs }));
        } finally { await markDecided(rec.msg.id); }
    }
    async function handleInbound(args) { return decideRecorded(await recordInbound(args)); }
    // 적고 나서 판정 전에 죽은 글(배포·재시작)을 다시 판정 — 새 번호·기존 대화 모두. 그 글 뒤에 이미 보낸 글이 있으면(판정은 됐고 표시만 못 찍음) 표시만 찍는다. 30분 넘은 글은 decideInbound 의 늦은 글 규칙이 자동 답을 막는다
    async function redecideTick() {
        // #652 B: 기준 시각(sms_gateway_state.decide_since) 뒤에 적힌 글만 다시 판정한다 — 이 코드가 처음 도는 순간을 한 번 적고(있으면 유지), 그 전 글은 「옛 코드가 이미 판정한 글」로 본다(배포 순간 옛 글 재판정 방지)
        const st0 = (await naverCfgGet('sms_gateway_state').catch(() => null)) || {};
        let since = st0.decide_since;
        if (!since || isNaN(new Date(since).getTime())) { since = new Date().toISOString(); await stateMerge({ decide_since: since }); return 0; }
        const rows = (await pool.query(`SELECT m.id, t.phone_digits FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE m.direction = 'in' AND m.decided_at IS NULL AND m.created_at < now() - interval '2 minutes' AND m.created_at > now() - interval '1 day' AND m.created_at > $1::timestamptz
              AND (m.deciding_at IS NULL OR m.deciding_at < now() - interval '5 minutes') ${TICK_T} ORDER BY m.id LIMIT 20`, [since])).rows;
        let n = 0;
        for (const r of rows) {
            await withLane(r.phone_digits, async () => {
                const msg = (await pool.query(`SELECT * FROM sms_messages WHERE id = $1 AND decided_at IS NULL AND (deciding_at IS NULL OR deciding_at < now() - interval '5 minutes')`, [r.id])).rows[0]; if (!msg) return;
                const thread = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [msg.thread_id])).rows[0]; if (!thread) return;
                const answered = (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND direction = 'out' AND created_at >= $2 LIMIT 1`, [thread.id, msg.created_at])).rowCount > 0;
                if (answered || msg.bucket === 'photo_pending') { await markDecided(msg.id); return; }
                const imgs = (await pool.query(`SELECT content_type, data FROM sms_images WHERE message_id = $1 AND data IS NOT NULL ORDER BY id`, [msg.id])).rows.map(x => ({ contentType: x.content_type, data: x.data.toString('base64') }));
                try { await decideRecorded({ thread, msg, bodyText: String(msg.body || ''), imgs }); n++; log.log(`[문자] 판정 못 한 글 다시 판정: 끝 ${phoneTail(r.phone_digits)}`); }
                catch (err) {
                    log.error('[문자] 다시 판정 실패:', err.message);
                    try { await setThread(thread.id, { status: 'staff_needed', staff_why: thread.staff_why || 'stuck' }); const c = await cfg(); if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(r.phone_digits)} 처리 중 오류`, STAFF_MSG); } catch (_) { }
                }
            }).catch(e => log.error('[문자] 다시 판정 줄 실패(무시):', e.message));
        }
        return n;
    }
    // #650 B: 가르기 결과가 「기사 안내문·발신처 머리 안내문·뜻 없는 글」이면 그 번호로 주문이 있는지 한 번 보고, 있으면 그 판정 없이 다시 가른다(주문 손님의 글이 무시되지 않게)
    async function bucketSmart(bodyText, digits, hasImage, known) {
        const b = bucketOf(bodyText, digits, hasImage, known);
        if (!(classifyMod && typeof classifyMod.classify === 'function' && lookupMod && typeof lookupMod.lookupByPhone === 'function')) return b;
        let reason = ''; try { reason = (classifyMod.classify(bodyText, { hasImage, isKnownCustomer: !!known, from: digits, fromShortCode: digits.length < 10 }) || {}).reason || ''; } catch (e) { reason = ''; }
        if (!/기사·기관 안내문|발신처 머리|뜻 없는 글/.test(reason)) return b;
        try {
            const r = await lookupMod.lookupByPhone(pool, digits, { days: 14 });
            if (r && (r.match === 'one' || r.match === 'many')) return (classifyMod.classify(bodyText, { hasImage, isKnownCustomer: true, hasOrder: true, from: digits, fromShortCode: digits.length < 10 }) || {}).bucket || b;
        } catch (e) { log.error('[문자] 가르기용 주문 확인 실패(무시):', e.message); }
        return b;
    }
    function bucketOf(bodyText, digits, hasImage, known) {
        let bucket = null;
        if (classifyMod && typeof classifyMod.classify === 'function') {
            try { bucket = (classifyMod.classify(bodyText, { hasImage, isKnownCustomer: !!known, from: digits, fromShortCode: digits.length < 10 }) || {}).bucket || null; } catch (e) { log.error('[문자] 가르기 실패(무시):', e.message); }
        }
        if (!bucket) bucket = hasImage && bodyText.length < 8 ? 'photo' : (digits.length < 10 ? 'carrier' : 'other');
        return bucket;
    }
    // #635: 번호로 주문 찾기 → 답 만들기(규칙 → AI · 사진은 판독). patch 에 주문 힌트를 얹는다 · gated = 자동 발송이 막힌 갈래(사진은 판독하지 않고 사람 몫)
    async function makeAnswer(thread, msg, c, patch, { bodyText, images, gated, aiOpts }) {
        const digits = thread.phone_digits, hasImage = images.length > 0, bucket = msg.bucket;
        const lookup = await orderForFresh(digits, c, bucket, await orderFor(digits, c));   // #665 못 찾았으면 최근 주문을 1회 받아와 다시 찾는다
        const hint = await orderHintOf(lookup);
        if (hint && lookup.refreshed) hint.refreshed = true;   // 직원 화면용 표시(방금 조회해 찾은 주문)
        if (hint) Object.assign(patch, { order_hint: hint.line || null, order_json: hint });
        if (lookup && lookup.match === 'one' && lookup.order) lookup.order = Object.assign({}, lookup.order, { option: lookup.order.option_text || lookup.order.option });   // rules.js 는 option/option_text 둘 다 읽음
        let ans;
        const orderQ = bucket === 'ship_q' || bucket === 'order_q';
        if (hasImage && !gated && photoJudge && photoReply) { ans = await composePhotoAnswer(thread, msg, c, lookup, images, bodyText); if (ans && ans.text) ans.auto_ok = !!(lookup && lookup.match === 'one'); }   // #650: 사진 답은 주문을 찾은 손님에게만 자동(#617) · 주문 없는 번호의 사진 답은 초안   // 사진이 있으면 글이 클레임이어도 사진 판독 쪽(대표 📱 ④ · 결정은 사람)
        else if (hasImage) ans = { text: null, toStaff: true, why: 'photo' };
        else ans = await composeAnswer(thread, msg, c, (orderQ || bucket === 'claim') ? lookup : (lookup && lookup.match === 'one' ? lookup : null), aiOpts);   // 주문 물음이 아니면 many 되묻기 안 함(보관법 물음에 「받는 분 성함」 묻지 않게)
        if (ans.why !== 'draft_cap' && (ans.ai_json || (ans.toStaff && ans.why))) await pool.query(`UPDATE sms_messages SET ai_json = $2::jsonb WHERE id = $1`, [msg.id, JSON.stringify(Object.assign({}, ans.ai_json || {}, ans.toStaff && ans.why ? { staff_why: ans.why } : {}))]).catch(() => { });   // #633: 직원 몫으로 넘긴 사유를 받은 글에 남김(「지금 챙길 일 · 봇 실패」 셈)
        return ans;
    }
    // 답 → 대화에 적을 초안 칸(#635): 무시 갈래 = 안 건드림 · 사람 몫 = 초안 없음 + 사유 · 그 밖 = 초안 + 사유 비움
    const isIgnoreAns = ans => !!(ans && ans.why && ans.why.startsWith('ignore:'));
    const draftFields = ans => isIgnoreAns(ans) ? {} : (!ans || ans.toStaff || !ans.text) ? { draft_text: null, draft_kind: null, staff_why: (ans && ans.why) || 'staff' } : { draft_text: ans.text, draft_kind: ans.kind || null, staff_why: ans.staff_flag || null };   // staff_flag = 답은 나가지만 직원도 봐야 하는 건(#645 주문 못 찾음)
    // 자동 발송이 막힌 갈래(잠금·쿨다운·상한·되풀이·늦은 사건)에서도 초안은 새로 만든다 — record·꺼짐이면 안 만든다(AI 호출 0)
    async function draftForGated(thread, msg, c, patch, ctx) {
        if (!c.enabled || c.mode === 'record') return null;
        // #652(대표 10/11): 번호당 하루(KST) draft_daily_cap 번까지만 AI 초안 — 넘으면 AI 를 부르지 않고 초안 없이 안 읽음으로만(사유는 종전 그대로). 규칙 답 초안(AI 호출 없음)은 세지 않는다
        const aiOpts = { noAi: false, aiUsed: false }; const day = kstDate();
        if (c.draft_daily_cap > 0) {
            try { const g = (await pool.query(`SELECT gated_ai_n, gated_ai_day FROM sms_threads WHERE id = $1`, [thread.id])).rows[0]; aiOpts.noAi = !!(g && g.gated_ai_day === day && Number(g.gated_ai_n) >= c.draft_daily_cap); } catch (e) { aiOpts.noAi = false; }
        }
        const bump = async () => { if (aiOpts.aiUsed) await pool.query(`UPDATE sms_threads SET gated_ai_n = CASE WHEN gated_ai_day = $2 THEN gated_ai_n + 1 ELSE 1 END, gated_ai_day = $2 WHERE id = $1`, [thread.id, day]).catch(() => { }); };
        try {
            const ans = await makeAnswer(thread, msg, c, patch, Object.assign({}, ctx, { gated: true, aiOpts }));
            await bump();
            if (ans && ans.why === 'draft_cap') return {};   // 새 초안 없음 — 앞서 만든 초안·사유는 그대로 둔다(안 읽음으로만 뜸)
            return draftFields(ans);
        }
        catch (e) {
            log.error('[문자] 초안 만들기 실패:', e.message); await bump();
            await pool.query(`UPDATE sms_messages SET ai_json = COALESCE(ai_json, '{}'::jsonb) || '{"staff_why":"ai_error"}'::jsonb WHERE id = $1`, [msg.id]).catch(() => { });   // #633 「봇 실패」 셈과 같은 자리
            return { draft_text: null, draft_kind: null, staff_why: 'ai_error' };
        }
    }
    const isDomestic = d => /^0\d{8,10}$/.test(String(d || ''));   // 국내 휴대폰·유선 꼴(0 으로 시작 · 9~11자리)
    async function refusedBefore(thread, msg) {
        try { return (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND id <> $2 AND direction = 'in' AND bucket = 'refuse' AND created_at > now() - interval '180 days' LIMIT 1`, [thread.id, msg.id || 0])).rowCount > 0; }
        catch (e) { return false; }
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
                        const hint2 = await orderHintOf(r2); if (hint2) Object.assign(patch, { order_hint: hint2.line || null, order_json: hint2 });
                        r2.order = Object.assign({}, r2.order, { option: r2.order.option_text || r2.order.option });
                        const prevQ = (await pool.query(`SELECT body, bucket FROM sms_messages WHERE thread_id = $1 AND direction = 'in' AND id < $2 ORDER BY id DESC LIMIT 1`, [thread.id, msg.id])).rows[0];   // 되묻기 전 원래 물음(「송장」 물음도 살게 · 원래 갈래 유지)
                        const ans2 = await composeAnswer(thread, Object.assign({}, msg, { bucket: (prevQ && prevQ.bucket) || 'ship_q', body: (prevQ && prevQ.body) || bodyText }), c, r2);
                        if (ans2 && ans2.text && !ans2.toStaff && ans2.kind !== 'ask' && ans2.auto_ok) return await queueBotAnswer(thread, msg, c, patch, ans2, { bypassCap: true });
                        if (ans2 && ans2.text && !ans2.toStaff && ans2.kind !== 'ask') {   // #650: 2차 답이 AI 글이면 초안으로
                            await setThread(thread.id, Object.assign(patch, { status: 'draft', draft_text: ans2.text, draft_kind: ans2.kind, staff_why: ans2.staff_flag || null }));
                            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 초안 확인`, STAFF_MSG);
                            return done('draft', { kind: ans2.kind, second: true });
                        }
                    }
                } catch (e) { log.error('[문자] 2차 조회 실패(무시):', e.message); }
            }
            // 이름을 못 읽었거나 여전히 여럿·없음 → 직원 몫
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: 'ask_failed' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 받는 분 확인 뒤에도 주문을 못 골랐어요`, STAFF_MSG);
            return done('ask_to_staff', { name: askedName ? '있음' : '없음' });
        }
        // 무시 갈래(인증번호·광고·통신사) — 기록만 · 상태 ignored(이미 대화 중인 손님 글은 상태 유지)
        if (['otp', 'ad', 'carrier'].includes(bucket) && !['bot_replied', 'staff_needed', 'draft', 'cooldown', 'staff_replied'].includes(thread.status)) {
            const hide = bucket !== 'carrier' || !isDomestic(digits) || digits.length < 10;   // #650 B: 국내 번호에서 온 「안내문 꼴」 글은 답 없이 안 읽음으로만(상태 그대로 · 목록에서 숨기지 않는다)
            await setThread(thread.id, Object.assign(patch, hide ? { status: 'ignored' } : (thread.status === 'ignored' || thread.status === 'closed' ? { status: 'new' } : {}))); return done(hide ? 'ignored' : 'noop');
        }
        if (bucket === 'greeting' && thread.status !== 'new') { await setThread(thread.id, patch); return done('noop'); }
        // #649 ③ 「수신거부·그만 보내」 = 답·초안 없음 + 이 번호에는 봇이 다시 답하지 않는다(받은 글의 갈래 refuse 가 기억 · 180일) — 직원 화면에는 사유로 보인다
        if (bucket === 'refuse') {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: 'refuse' }));
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 수신거부·그만 보내 달라는 글이에요(봇 응대 끔)`, STAFF_MSG);
            return done('refuse');
        }
        if (bucket !== 'greeting' && await refusedBefore(thread, msg)) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: 'no_bot' }));
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 응대를 끈 번호에서 글이 왔어요`, STAFF_MSG);
            return done('no_bot');
        }
        // #649 ② 국내 꼴이 아닌 번호(+1 … 등)로는 봇이 절대 보내지 않는다 — 답·초안 없이 직원 몫
        if (!isDomestic(digits) && !['otp', 'ad', 'carrier'].includes(bucket)) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: 'foreign_number' }));
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 해외·알 수 없는 번호의 글이에요(봇 답 안 함)`, STAFF_MSG);
            return done('foreign');
        }
        // 직원 몫·직원 답변 상태(잠금)로 손님이 다시 보냄 → 봇 침묵 + 알림
        if (thread.status === 'staff_replied' || thread.status === 'staff_needed' || (thread.status === 'draft' && (!!thread.staff_why || !c.enabled || c.mode !== 'auto'))) {   // #650 D: 자동 모드에서 「초안만 대기 중(사유 없음)」은 잠금이 아니다 → 아래 보통 흐름으로(주문 손님의 배송 물음은 늘 자동)
            const d = await draftForGated(thread, msg, c, patch, { bodyText, images });   // #635: 잠금은 자동 발송만 막는다 · 초안은 이번 글로 새로
            const staffy = ['claim', 'photo', 'account', 'request', 'call', 'wrong'].includes(bucket) || hasImage;
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }, d || Object.assign({ draft_text: thread.status === 'draft' ? thread.draft_text : null }, staffy ? { staff_why: hasImage ? 'photo' : (bucket === 'wrong' ? 'wrong_number' : bucket) } : {})));   // record·꺼짐 = 종전(초안은 남기고 AI 안 부름)
            if (c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 손님이 다시 보냈어요`, STAFF_MSG);
            return done('staff_again');
        }
        // 기록만(꺼짐 · record 모드) — 아무 것도 보내지 않음 · 알림은 클레임·사진만
        if (!c.enabled || c.mode === 'record') {
            const toStaff = ['claim', 'photo', 'account', 'request', 'call', 'wrong'].includes(bucket) || hasImage;   // #628 · #650
            await setThread(thread.id, Object.assign(patch, toStaff ? { status: 'staff_needed', staff_why: hasImage ? 'photo' : (bucket === 'wrong' ? 'wrong_number' : bucket) } : (thread.status === 'ignored' || thread.status === 'closed' ? { status: 'new', draft_text: null, draft_kind: null } : {})));   // #630: 끝난 대화에 손님이 다시 보내면 record 모드에서도 다시 떠야 한다
            if (toStaff && c.enabled) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} ${hasImage ? '사진' : '확인 필요'}`, STAFF_MSG);
            return done('recorded');
        }
        // 뒤늦게 들어온 옛 사건(재시도·비행기 모드) → 답하지 않고 직원 몫
        if (lateEvent) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }, await draftForGated(thread, msg, c, patch, { bodyText, images }) || {}));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 늦게 들어온 문자(봇 답 안 함)`, STAFF_MSG);
            return done('late_to_staff');
        }
        // 쿨다운 안 · 오늘 봇이 이미 답함(daily_cap) · 유예 중인 봇 답이 큐에 있음 → 직원 몫(대표 10/9 「30분 뒤 다시 온 것은 직원」 · 유예 75초 안 둘째 글도 같은 취급)
        const inCooldown = thread.cooldown_until && new Date(thread.cooldown_until).getTime() > Date.now();
        const pendingBot = (await pool.query(`SELECT 1 FROM sms_messages WHERE thread_id = $1 AND direction = 'out' AND sender = 'bot' AND state IN ('queued','sending') LIMIT 1`, [thread.id])).rowCount > 0;
        if (inCooldown || pendingBot || botCountToday(thread) >= c.daily_cap) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }, await draftForGated(thread, msg, c, patch, { bodyText, images }) || {}));   // #635: 자동 발송만 막고 초안은 만든다
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇 답 뒤 다시 왔어요`, STAFF_MSG);
            return done('cooldown_to_staff');
        }
        // #625: 같은 질문을 또 보냄(24시간 안 · 띄어쓰기·기호만 다름) = 봇 답이 안 통한 것 → 직원 몫(되풀이 답 금지)
        if (botCountToday(thread) > 0 && normQ(bodyText).length >= 2) {
            const prevIn = (await pool.query(`SELECT body FROM sms_messages WHERE thread_id = $1 AND direction = 'in' AND id < $2 AND created_at > now() - interval '24 hours' AND COALESCE(bucket,'other') NOT IN ('otp','ad','carrier','greeting','photo_pending') ORDER BY id DESC LIMIT 5`, [thread.id, msg.id])).rows;
            if (prevIn.some(r => normQ(r.body) === normQ(bodyText))) {
                await setThread(thread.id, Object.assign(patch, { status: 'staff_needed' }, await draftForGated(thread, msg, c, patch, { bodyText, images }) || {}));
                await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 같은 질문을 다시 보냈어요`, STAFF_MSG);
                return done('repeat_to_staff');
            }
        }
        // 번호로 주문 찾기 → 답 만들기
        const ans = await makeAnswer(thread, msg, c, patch, { bodyText, images });
        if (ans.why && ans.why.startsWith('ignore:')) { await setThread(thread.id, Object.assign(patch, { status: (thread.status === 'new' && ans.why !== 'ignore:greeting' && !(ans.why === 'ignore:carrier' && isDomestic(digits) && digits.length >= 10)) ? 'ignored' : thread.status })); return done(ans.why === 'ignore:greeting' ? 'noop' : 'ignored'); }   // #641: 인사·「잘 받았어요」는 답·초안 없이 안 읽음으로만(숨기지 않음)
        if (ans.toStaff || !ans.text) {
            await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: ans.why || 'staff' }));
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 직원 답 필요(${labelWhy(ans.why)})`, ans.staff_summary ? ans.staff_summary.slice(0, 120) : STAFF_MSG);
            return done('to_staff', { why: ans.why });
        }
        // #650(대표 「고」 10/11 · 문자 최종 점검): 자동으로 나가도 되는 답(auto_ok)은 ①주문을 찾은 손님의 규칙 답 ②명백한 사기 전 물음의 AI 답 ③주문을 찾은 손님의 불만 고정 답 ④주문 여럿 되묻기 + 주문을 찾은 손님의 사진 답뿐 — 그 밖은 자동 모드에서도 초안만(직원이 [이대로 보내기])
        if (c.mode === 'draft' || !ans.auto_ok) {
            await setThread(thread.id, Object.assign(patch, { status: 'draft', draft_text: ans.text, draft_kind: ans.kind, staff_why: ans.staff_flag || null }));
            const what = ans.staff_flag === 'order_not_found' ? '주문을 못 찾았어요 · 되묻기 초안 확인' : ans.staff_flag === 'claim' ? '불만 글 · 초안 확인' : '봇 초안 확인';
            await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} ${what}`, ans.staff_summary ? ans.staff_summary.slice(0, 120) : STAFF_MSG);
            return done('draft', { kind: ans.kind, held: c.mode !== 'draft' });
        }
        return await queueBotAnswer(thread, msg, c, patch, ans);
    }
    // auto — 유예(hold_sec) 뒤 발송 큐에(그 사이 직원이 화면에서 답하면 취소) · 여러 통은 priority 9,8,7… 로 순서 보장(앱 기본 LIFO)
    //   되묻기(kind 'ask')면 thread.ask_kind='name' 을 적어 다음 글을 이름으로 읽는다(followup.js) · bypassCap = 되묻기 뒤 2차 답(상한에서 뺌 · bot_count 는 올림)
    async function queueBotAnswer(thread, msg, c, patch, ans, opts = {}) {
        const digits = thread.phone_digits, bucket = msg.bucket;
        if (!isDomestic(digits)) { await setThread(thread.id, Object.assign(patch, { status: 'staff_needed', draft_text: null, draft_kind: null, staff_why: 'foreign_number' })); return Object.assign({ thread_id: thread.id, message_id: msg.id, bucket, action: 'foreign' }); }   // 마지막 방어 — 봇은 국내 번호로만 보낸다
        const done = (action, extra) => Object.assign({ thread_id: thread.id, message_id: msg.id, bucket, action }, extra || {});
        const sendAfter = new Date(Date.now() + c.hold_sec * 1000);
        const pieces = splitForSms(ans.text, c.max_chars);
        let out = null;
        for (let i = 0; i < pieces.length; i++) {
            const m = await addMessage({ thread_id: thread.id, direction: 'out', kind: 'sms', body: pieces[i], sender: 'bot', state: 'queued', rule_kind: ans.rule_kind || ans.kind, priority: Math.max(0, 9 - i), ai_json: Object.assign({ why: ans.why, part: i + 1, parts: pieces.length, second: !!opts.bypassCap }, ans.used ? { used: ans.used } : {}), send_after: sendAfter });
            if (!out) out = m;
        }
        const ask = ans.kind === 'ask';
        await setThread(thread.id, Object.assign(patch, { status: 'bot_replied', draft_text: null, draft_kind: null, staff_why: ans.staff_flag || null, ask_kind: ask ? 'name' : null, ask_at: ask ? new Date() : null, cooldown_until: new Date(Date.now() + c.cooldown_min * 60000) }));
        await bumpBotCount(thread);   // 한 답에 1번(조각 수와 무관) · 큐에 넣는 순간 올려 유예 창에서도 상한이 먹게
        if (ask) await setThread(thread.id, { ask_count: (thread.ask_count || 0) + 1 });
        if (ans.staff_flag === 'claim') await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 불만 글 — 봇이 ${ans.why === 'claim_reply' ? '사과·안내 답을 보냈어요' : '주문 확인을 여쭸어요'} · 이어받아 주세요`, STAFF_MSG, { force: true });   // #646
        if (ans.staff_flag === 'order_not_found') await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 주문을 못 찾았어요(봇이 성함·연락처를 여쭸어요)`, STAFF_MSG);   // #645
        if (ans.staff_summary) await notifyStaff(c, thread, `문자 · 끝 ${phoneTail(digits)} 봇이 답했어요(사진) · 이어받아 주세요`, ans.staff_summary.slice(0, 120), { force: true });   // 대표 📷 규칙: 사진 답 뒤 직원 푸시는 반드시
        return done('queued', { out_id: out.id, parts: pieces.length, kind: ans.kind, second: !!opts.bypassCap, send_after: sendAfter.toISOString() });
    }
    // mms:downloaded — 같은 번호의 최근 10분 안 「사진 받는 중」 줄에 사진·글을 붙이고 그 줄로 판정(없으면 새 수신으로)
    async function recordDownloaded(e) {
        const prev = e.digits ? (await pool.query(`SELECT m.*, t.phone_digits FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.kind = 'mms' AND m.bucket IN ('photo_pending','photo') AND m.event_at > now() - interval '15 minutes'
              AND NOT EXISTS (SELECT 1 FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) ORDER BY m.id DESC LIMIT 1`, [e.digits])).rows[0] : null;   // 5분 뒤 photo 로 바뀐 줄도 15분 안이면 같은 줄에(코드리뷰)
        const imgs = imageOnly(e.attachments);
        const bodyText = String(e.body || '').trim() || textParts(e.attachments).join('\n');
        if (!prev) {
            if (!e.digits) return { done: { skipped: 'no_phone' } };
            return recordInbound({ digits: e.digits, body: bodyText, kind: imgs.length ? 'mms' : 'sms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, images: imgs, envelope_id: e.envelope_id });
        }
        const thread = (await pool.query(`SELECT * FROM sms_threads WHERE id = $1`, [prev.thread_id])).rows[0];
        const n = await saveImages(prev.id, imgs);
        if (n) await pool.query(`DELETE FROM sms_images WHERE message_id = $1 AND data IS NULL AND purged_at IS NULL`, [prev.id]);
        const bucket = await bucketSmart(bodyText, thread.phone_digits, n > 0, thread.status !== 'new' || !!thread.order_hint);
        await pool.query(`UPDATE sms_messages SET body = $2, bucket = $3, kind = $4, decided_at = NULL WHERE id = $1`, [prev.id, bodyText, bucket, n > 0 ? 'mms' : 'sms']);   // 사진이 붙었으니 다시 「판정 전」(집기 표시도 푼다)
        await pool.query(`UPDATE sms_messages SET deciding_at = NULL WHERE id = $1`, [prev.id]);
        const msg = Object.assign({}, prev, { body: bodyText, bucket, kind: n > 0 ? 'mms' : 'sms' });
        const rows = n ? (await pool.query(`SELECT content_type, data FROM sms_images WHERE message_id = $1 AND data IS NOT NULL ORDER BY id`, [prev.id])).rows.map(r => ({ contentType: r.content_type, data: r.data.toString('base64') })) : [];
        return { thread, msg, bodyText, imgs: rows, extra: { attached: n } };
    }
    async function attachDownloaded(e) { return Object.assign({ ok: true, event: e.ev }, await decideRecorded(await recordDownloaded(e))); }
    // mms:received 뒤 mms:downloaded 가 5분 안 안 오면 「사진 못 받음」 → 직원 몫(삼성 메시지 자동 가져오기 꺼짐 등)
    async function pendingPhotoTick() {
        const rows = (await pool.query(`SELECT m.id, m.thread_id, t.phone_digits, t.status FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
            WHERE m.direction = 'in' AND m.bucket = 'photo_pending' AND m.event_at < now() - interval '5 minutes' ${TICK_T} ORDER BY m.id LIMIT 20`)).rows;
        const c = await cfg();
        for (const r of rows) {
            await pool.query(`UPDATE sms_messages SET bucket = 'photo' WHERE id = $1`, [r.id]);
            await setThread(r.thread_id, { status: 'staff_needed', staff_why: 'photo' });
            await pool.query(`UPDATE sms_threads SET last_in_text = '(사진 · 파일을 못 받았어요)' WHERE id = $1 AND COALESCE(last_in_text, '') = ''`, [r.thread_id]);
            if (c.enabled) await notifyStaff(c, { id: r.thread_id }, `문자 · 끝 ${phoneTail(r.phone_digits)} 사진을 못 받았어요`, '폰 삼성 메시지에서 직접 확인해 주세요(MMS 자동 가져오기 설정)');
        }
        return rows.length;
    }
    const labelWhy = w => ({ claim: '불만·클레임', account: '계좌·입금 문의', photo: '사진', ai_to_staff: 'AI 판단', ai_skip: 'AI 답 없음', ai_error: 'AI 오류', ai_promise: 'AI 글에 약속 낱말', no_engine: '엔진 없음', request: '요청(주문·변경·취소)', call: '전화 요청', wrong_number: '잘못 온 문자라는 글', refuse: '수신거부·그만 보내', no_bot: '봇 응대 끔(수신거부)', foreign_number: '해외·알 수 없는 번호', order_not_found: '주문 못 찾음', lookup_error: '주문 확인 실패', ai_assert: 'AI 글에 발송·도착 단정', ask_failed: '받는 분 확인 실패', send_failed: '보내지 못함', stuck: '처리 안 된 글', staff: '직원 확인', photo_not_fruit: '과일 사진 아님', photo_unclear: '사진 불명확', photo_ai_error: '사진 판독 실패', photo_too_big: '사진 한도 초과', photo_damage_low: '파손 의심(확신 낮음)', photo_leak: '사진 문구 검사',
        rule_reserve: '예약 상품', rule_trouble: '배송 이상', rule_not_received: '못 받았다는 글', rule_arrive_overdue: '도착 예정일 지남', rule_ship_overdue: '발송 예정일 지남',
        rule_new_order_pending: '새 주문 대기', rule_pre_no_paid_at: '결제 시각 모름', rule_memo_date: '배송메세지 날짜 요청', rule_staff: '직원 확인' }[w] || (w ? '직원 확인' : ''));

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
                await setThread(own.thread_id, { status: 'staff_needed', staff_why: 'send_failed' });
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
        await setThread(thread.id, { status: ev.state === 'failed' ? 'staff_needed' : 'staff_replied', last_out_at: m.event_at, last_out_text: bodyText.slice(0, 300), handled_at: new Date(), staff_name: '전달 앱', draft_text: null, draft_kind: null, ask_kind: null, ask_at: null, staff_why: ev.state === 'failed' ? 'send_failed' : null });
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
    async function sweepStuck() {
        const c = await cfg(); const out = {};
        // ① 보낼 시각이 15분 넘게 지난 queued(꺼 둔 사이 쌓인 큐) → 취소 + 직원 몫(며칠 뒤 켰을 때 옛 답이 나가지 않게)
        const stale = await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = 'cancelled:stale' WHERE direction = 'out' AND state = 'queued' AND send_after < now() - interval '15 minutes' ${TICK_M} RETURNING thread_id`);
        for (const r of stale.rows) await setThread(r.thread_id, { status: 'staff_needed', staff_why: 'send_failed' });
        out.stale = stale.rowCount || 0;
        // ② 202 를 못 받고 죽은 sending(sent_at 없음 · 2분) → 같은 gateway_id 로 다시 queued(게이트웨이 409 = 이미 들어간 것)
        const re = await pool.query(`UPDATE sms_messages SET state = 'queued' WHERE direction = 'out' AND state = 'sending' AND sent_at IS NULL AND created_at < now() - interval '2 minutes' ${TICK_M} RETURNING id`);
        out.requeued = re.rowCount || 0;
        // ③ 202 뒤 ttl+10분이 지나도 sms:sent/failed 가 안 옴 → 보내지 못함으로 + 직원 몫
        const lost = await pool.query(`UPDATE sms_messages SET state = 'failed', fail_reason = 'no_result' WHERE direction = 'out' AND state = 'sending' AND sent_at IS NOT NULL AND sent_at < now() - make_interval(secs => $1::int) ${TICK_M} RETURNING thread_id, id`, [c.ttl_sec + 600]);
        for (const r of lost.rows) { await setThread(r.thread_id, { status: 'staff_needed', last_out_state: 'failed', staff_why: 'send_failed' }); if (c.enabled) await notifyStaff(c, { id: r.thread_id }, '문자 · 보낸 결과가 안 와요(폰 꺼짐?)', STAFF_MSG); }
        out.no_result = lost.rowCount || 0;
        // ⑤ 직원이 답한 뒤(staff_replied) staff_lock_hours 지나면 저절로 「끝남」 — 끝내기를 안 눌러도 다음 문자부터 봇이 다시 답함(대표 확정 10/10 · 「직원 몫」(staff_needed · 아직 아무도 안 답함)은 그대로)
        if (c.staff_lock_hours > 0) {
            const rel = await pool.query(`UPDATE sms_threads SET status = 'closed', staff_why = NULL WHERE status = 'staff_replied' AND COALESCE(handled_at, updated_at) < now() - make_interval(hours => $1::int) ${TICK_P} RETURNING id`, [c.staff_lock_hours]);
            out.auto_closed = rel.rowCount || 0;
        }
        // #625(대표 「고」 10/10): 직원 몫(staff_needed · 아무도 안 답함)도 손님 마지막 글 뒤 staff_open_hours 지나면 저절로 끝남 — [처리함]을 안 눌러도 봇이 영영 침묵하지 않게(직원은 폰에서 답하는 구조)
        if (c.staff_open_hours > 0) {
            const rel2 = await pool.query(`UPDATE sms_threads SET status = 'closed', staff_why = NULL WHERE status = 'staff_needed' AND COALESCE(last_in_at, updated_at) < now() - make_interval(hours => $1::int) ${TICK_P} RETURNING id`, [c.staff_open_hours]);
            out.auto_closed_open = rel2.rowCount || 0;
        }
        // ⑥(#652) 적었는데 판정 전에 죽은 글 → 다시 판정(새 번호·기존 대화 모두). 아래 ④는 그래도 남은 것의 마지막 그물
        try { out.redecided = await redecideTick(); } catch (e) { log.error('[문자] 다시 판정 실패(무시):', e.message); out.redecided = 0; }
        // ④ 받은 글은 있는데 판정 전에 죽어 status new 로 남은 대화(2분) → 직원 몫
        if (c.enabled && c.mode !== 'record') {   // record 모드는 new 가 정상 종착(워커2 ops 검증)
            const stuck = await pool.query(`UPDATE sms_threads t SET status = 'staff_needed', staff_why = COALESCE(t.staff_why, 'stuck') WHERE t.status = 'new' AND t.last_in_at IS NOT NULL AND t.last_in_at < now() - interval '2 minutes'
                AND EXISTS (SELECT 1 FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND COALESCE(m.bucket, 'other') NOT IN ('otp','ad','carrier','greeting','photo_pending') AND m.created_at < now() - interval '2 minutes')
                AND NOT EXISTS (SELECT 1 FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'out') AND t.created_at > now() - interval '1 day' ${TICK_T} RETURNING id`);   // #648: 검증이 옛 시각으로 넣은 시험 대화를 라이브가 집어 「처리되지 않은 글」 헛알림을 보냈음
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
            const hourN = (await pool.query(`SELECT count(*)::int AS n FROM sms_messages WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered','sending') AND sent_at > now() - interval '1 hour' ${TICK_M}`)).rows[0].n;
            const botCapHit = hourN >= c.hourly_send_cap;
            if (botCapHit && Date.now() - _capAlertAt > 3600e3) { _capAlertAt = Date.now(); if (notifyTelegram) await notifyTelegram(`⚠️ 회사폰 문자 봇 답이 시간당 상한(${c.hourly_send_cap})에 걸렸어요 — 봇 답은 멈추고 직원 답만 나가요`); }
            const rows = (await pool.query(`SELECT m.*, t.phone_digits, t.status AS thread_status FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id
                WHERE m.direction = 'out' AND m.state = 'queued' AND (m.send_after IS NULL OR m.send_after <= now()) ${botCapHit ? "AND m.sender <> 'bot'" : ''} ${TICK_T} ORDER BY m.priority DESC, m.id LIMIT 5`)).rows;
            const out = [];
            for (const m of rows) {
                // 유예 사이에 직원이 답했으면(상태 바뀜) 취소
                if (m.sender === 'bot' && ['staff_replied', 'staff_needed', 'closed'].includes(m.thread_status)) { await pool.query(`UPDATE sms_messages SET state = 'cancelled', fail_reason = $2 WHERE id = $1 AND state = 'queued'`, [m.id, m.thread_status === 'staff_needed' ? 'cancelled:handover' : 'cancelled:staff']); out.push({ id: m.id, cancelled: true }); continue; }   // #675 staff_needed = 직원이 답한 것이 아니라 사람 몫으로 넘어간 것(유예 중 손님이 이어서 보냄 등)
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
                if (!_rfBusy && !channelBusy() && !(kh >= 1 && kh < 7) && (!lastP.at || Date.now() - new Date(lastP.at).getTime() > 60 * 60000)) {   // #665 즉시 조회가 도는 중이면 다음 틱에
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
            const r = await pool.query(`UPDATE sms_images SET data = NULL, purged_at = now() WHERE purged_at IS NULL AND data IS NOT NULL AND created_at < now() - make_interval(days => $1::int) ${deps.testMode ? "AND message_id IN (SELECT m.id FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits LIKE '0999%')" : ''}`, [c.image_days]);
            let pre = 0, hits = 0;
            if (preorders && typeof preorders.purge === 'function') { try { pre = (await preorders.purge(pool, 7)) || 0; } catch (e) { log.error('[문자] 발송 전 주문 정리 실패(무시):', e.message); } }
            const scPurge = (selfcheckApi && typeof selfcheckApi.purge === 'function') ? selfcheckApi.purge : (selfcheck && typeof selfcheck.purge === 'function' ? selfcheck.purge : null);
            if (scPurge) { try { hits = (await scPurge(pool)) || 0; } catch (e) { log.error('[문자] 셀프 조회 시도 표 정리 실패(무시):', e.message); } }
            const target = (await pool.query(`SELECT count(*)::int AS n FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60`)).rows[0].n;
            let shipDeleted = 0, statusDeleted = 0;
            if (raw.purge_shipments === true && target > 0) {
                shipDeleted = (await pool.query(`DELETE FROM delivery_shipments WHERE tracking IN (SELECT tracking FROM delivery_shipments WHERE ship_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 60 ${deps.testMode ? "AND tracking LIKE '9996000%'" : ''} LIMIT 5000)`)).rowCount || 0;
                statusDeleted = (await pool.query(`DELETE FROM delivery_status t WHERE NOT EXISTS (SELECT 1 FROM delivery_shipments s WHERE s.tracking = t.tracking) AND t.checked_at < now() - interval '60 days' ${deps.testMode ? "AND t.tracking LIKE '9996000%'" : ''}`)).rowCount || 0;
            }
            // #644: 직원 화면용 주문 칸(order_json)에 실린 받는 분 이름 전체·운송장 전체는 마지막 글이 60일 지난 대화에서 비운다(송장 표 보관 기간과 같게 · 끝 4자리·성 한 글자는 남김)
            let ojCleared = 0;
            try { ojCleared = (await pool.query(`UPDATE sms_threads SET order_json = (order_json #- '{order,recipient_name}') #- '{order,trackings}'
                WHERE order_json IS NOT NULL AND (order_json #> '{order,recipient_name}' IS NOT NULL OR order_json #> '{order,trackings}' IS NOT NULL)
                  AND COALESCE(GREATEST(last_in_at, last_out_at), updated_at) < now() - interval '60 days' ${TICK_P}`)).rowCount || 0; } catch (e) { log.error('[문자] 주문 칸 이름·송장 비우기 실패(무시):', e.message); }
            const result = { date: kstDate(), order_json_cleared: ojCleared, sms_images: r.rowCount || 0, preorders: pre, selfcheck_hits: hits, shipments_target: target, shipments_deleted: shipDeleted, status_deleted: statusDeleted, purge_shipments: raw.purge_shipments === true };
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

    async function handleWebhook(body, opts) {
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
                try { if (e.digits) { const t = await threadFor(e.digits); await setThread(t.id, { status: 'staff_needed', staff_why: t.staff_why || 'stuck', last_in_at: new Date(), last_in_text: String(e.body || '').slice(0, 300) }); const c = await cfg(); if (c.enabled) await notifyStaff(c, t, `문자 · 끝 ${phoneTail(e.digits)} 처리 중 오류 · 직접 확인`, STAFF_MSG, { force: true }); } } catch (_) { }
                if (notifyTelegram && (deps.testMode || !isTestDigits(e.digits))) { try { await notifyTelegram('⚠️ 회사폰 문자 처리 중 오류: ' + String(err.message).slice(0, 120)); } catch (_) { } }
                return { ok: false, event: e.ev, error: String(err.message).slice(0, 200), action: 'error_to_staff' };
            }
        };
        // #652: opts.split = 줄 적기만 끝내고 { recorded:true, after } 를 돌려준다(라우트가 200 을 준 뒤 after 로 판정). 적다가 실패하면 던진다 → 라우트가 500 → 앱이 다시 보냄(봉투 id 로 한 번만 적힌다)
        const inbound = async (recFn) => {
            if (opts && opts.split) {
                let rec;
                try { rec = await withLane(e.digits || 'x', recFn); } catch (err) { if (dupKey) seenEvents.delete(dupKey); throw err; }
                return { ok: true, event: e.ev, recorded: true, after: async () => Object.assign({ ok: true, event: e.ev }, await inboundSafe(() => decideRecorded(rec))) };
            }
            return Object.assign({ ok: true, event: e.ev }, await inboundSafe(async () => decideRecorded(await recFn())));
        };
        if (e.ev === 'sms:received') { if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' }; return inbound(() => recordInbound({ digits: e.digits, body: e.body, kind: 'sms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, envelope_id: e.envelope_id })); }
        if (e.ev === 'sms:batch:received') return { ok: true, event: e.ev, ignored: true, n: Array.isArray(e.p.messages) ? e.p.messages.length : 0 };   // 받은함 다시 읽기(옛 글 내보내기) — 답하면 옛 글마다 봇이 답함 · 등록도 안 함
        // 정상 순서 = mms:received(메타만 · 기록) → mms:downloaded(사진·글 · 여기서 판정). received 가 유실되면 downloaded 가 새 수신으로.
        if (e.ev === 'mms:received') {
            if (!e.digits) return { ok: true, event: e.ev, skipped: 'no_phone' };
            // downloaded 가 먼저 와서 이미 사진이 붙은 줄이 10분 안에 있으면 메타 줄을 새로 만들지 않음(거짓 「사진 못 받음」 알림 방지)
            const already = (await pool.query(`SELECT 1 FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.kind = 'mms' AND m.event_at > now() - interval '10 minutes' AND EXISTS (SELECT 1 FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) LIMIT 1`, [e.digits])).rowCount;
            if (already) return { ok: true, event: e.ev, skipped: 'already_downloaded' };
            return inbound(() => recordInbound({ digits: e.digits, body: '', kind: 'mms', gateway_id: e.gateway_id, sim_number: e.sim_number, event_at: e.event_at, images: [{ contentType: null, size: e.p.size || null, data: null }], envelope_id: e.envelope_id, recordOnly: true }));
        }
        if (e.ev === 'mms:downloaded') return inbound(() => recordDownloaded(e));
        if (e.ev === 'sms:cancelled') return Object.assign({ ok: true, event: e.ev }, await handleSent({ gateway_id: e.gateway_id, digits: e.digits, body: e.body, state: 'failed', reason: 'cancelled', event_at: e.event_at, sim_number: e.sim_number }));
        if (e.ev === 'sms:sent' || e.ev === 'sms:delivered' || e.ev === 'sms:failed') return Object.assign({ ok: true, event: e.ev }, await handleSent({ gateway_id: e.gateway_id, digits: e.digits, body: e.body, state: e.ev.split(':')[1], reason: e.reason, event_at: e.event_at, sim_number: e.sim_number }));
        return { ok: true, event: e.ev, ignored: true };
    }

    // ── 라우트 ──
    let _recFailAt = 0;
    const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { log.error('[문자] 라우트 오류:', e.message); res.status(500).json({ ok: false, error: '문자 처리 중 문제가 생겼어요: ' + e.message }); } };
    // 🔴 즉시 200 → 뒤에서 처리(앱은 30초 안 2xx 아니면 2일간 재시도 → 늦게 답하면 같은 사건이 두 번 와 봇이 두 번 답함) · 서명은 req.rawBody(server.js express.json verify 로 잡은 원문)로 검사
    app.post('/api/sms/webhook', wrap(async (req, res) => {
        const v = verifySignature(req);
        if (!v.ok) { if (v.why === 'no_secret') return res.status(503).json({ ok: false, error: 'webhook locked' }); return res.status(401).json({ ok: false, error: v.why }); }
        const body = req.body || {};
        const say = r => { if (r && r.action) log.log(`[문자] ${r.event || ''} → ${r.action}${r.why ? '(' + r.why + ')' : ''}`); };
        // #652(대표 10/11): 받은 글 사건은 「줄 적기」까지 끝낸 뒤 200(배포·재시작 순간에 글이 사라지지 않게) — 판정·AI·주문 찾기는 종전대로 200 뒤. 적다가 실패하면 500(앱이 다시 보낸다). 보낸 쪽 사건은 종전대로
        if (['sms:received', 'mms:received', 'mms:downloaded'].includes(String(body.event || ''))) {
            let r;
            try { r = await handleWebhook(body, { split: true }); }
            catch (e) {
                log.error('[문자] 받은 글 적기 실패(500 → 앱이 다시 보냄):', e.message);
                if (notifyTelegram && Date.now() - _recFailAt > 3600e3) { _recFailAt = Date.now(); notifyTelegram('⚠️ 회사폰 문자를 받아 적지 못했어요(앱이 다시 보냅니다 · 계속되면 DB 확인): ' + String(e.message).slice(0, 120)).catch(() => { }); }   // 조용한 유실 방지 · 1시간 1회
                return res.status(500).json({ ok: false, error: 'record_failed' });
            }
            res.json({ ok: true, accepted: true, event: body.event || null, recorded: !!(r && r.recorded) });
            if (r && typeof r.after === 'function') setImmediate(() => { r.after().then(say).catch(e => log.error('[문자] webhook 처리 오류:', e.message)); }); else say(r);
            return;
        }
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
    const pub = t => ({ id: t.id, phone_tail: phoneTail(t.phone_digits), phone_masked: phoneMasked(t.phone_digits), phone_full: String(t.phone_digits || ""), customer_hint: t.order_hint || null, status: t.status,   // #624 phone_full = 전체 번호(화면에서 010-0000-0000 꼴 · 60일 보관 그대로) · 🔴 #630: 종전 총괄 패치가 이 주석을 같은 줄 앞에 붙여 customer_hint·status 가 주석에 먹혔음(목록 배지 「확인」·끝난 대화 숨김 안 됨)
        last_in_text: String(t.last_in_text || '').slice(0, 120), last_in_at: t.last_in_at, last_out_text: String(t.last_out_text || '').slice(0, 120), last_out_at: t.last_out_at,
        has_image: !!t.has_image, draft_text: t.draft_text || null, draft_kind: t.draft_kind || null,
        done: !!(t.done_json && t.status === 'staff_replied' && !t.staff_why), done_by: (t.done_json && t.done_json.by) || null, done_at: (t.done_json && t.done_json.at) || null,   // #675 [처리함]으로 넘긴 대화(손님 새 글이 오면 상태가 바뀌어 false)
        unread: Number(t.unread) || 0, needs_staff: !!t.staff_why && t.status !== 'closed' && t.status !== 'ignored', staff_why: t.staff_why || null, staff_why_label: t.staff_why ? labelWhy(t.staff_why) : null, staff_read_at: t.staff_read_at || null,   // #635 폰 문자함 구도
        last_dir: (t.last_out_at && (!t.last_in_at || new Date(t.last_out_at) > new Date(t.last_in_at))) ? 'out' : (t.last_in_at ? 'in' : null),
        last_at: (t.last_out_at && (!t.last_in_at || new Date(t.last_out_at) > new Date(t.last_in_at))) ? t.last_out_at : (t.last_in_at || null), staff_name: t.staff_name || null, handled_at: t.handled_at, bot_count_today: botCountToday(t), last_out_state: t.last_out_state || null });
    // #635: 안 읽음 = 직원이 마지막으로 연 뒤(staff_read_at) 들어온 손님 글 수 — 서버가 받은 시각(created_at) 기준(폰 시계·늦은 재시도와 무관)
    const UNREAD_SQL = `(SELECT count(*)::int FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND m.created_at > COALESCE(t.staff_read_at, 'epoch'::timestamptz))`;
    const ACTIVE_SQL = `t.status <> 'ignored' AND ${UNREAD_SQL} > 0 ${TEST_HIDE_T2}`;   // 목록(scope=active): 안 읽은 글이 있는 대화 · 인증번호·광고·통신사만 온 번호(ignored)는 뺀다
    const OPEN_SQL = `t.status NOT IN ('closed','ignored') AND t.staff_why IS NOT NULL ${TEST_HIDE_T2}`;   // #664 목록(scope=open · 미처리) = 사람 몫(직원 확인 필요)만 — 끝난·무시 제외 · 안 읽음은 안 섞는다(읽어도 남고 · 직원이 답하거나 끝내면 빠짐)
    // #661 「확인 필요 문의」 칸·손님 연락 창 숫자에 문자 미답변(scope=open 과 같은 식)을 내준다 — desk-inbox.js 의 고리로(server.js 무접촉)
    let _cardSms = async () => null;
    try {
        _cardSms = async () => {
            const n = (await pool.query(`SELECT (SELECT count(*)::int FROM sms_threads t WHERE ${OPEN_SQL}) AS open, (SELECT count(*)::int FROM sms_threads t WHERE ${ACTIVE_SQL}) AS unread`)).rows[0];
            // 카드 줄 = 전체 대화(무시 갈래 제외) 최근순 30 — 미처리(사람 몫 = scope=open 과 같은 식 · #664) 줄을 빠짐없이 먼저 담는다
            const rows = (await pool.query(`SELECT t.*, ${UNREAD_SQL} AS unread, (${OPEN_SQL}) AS is_open, count(*) OVER ()::int AS total FROM sms_threads t WHERE t.status <> 'ignored' ${TEST_HIDE_T2}
                ORDER BY (${OPEN_SQL}) DESC, COALESCE(GREATEST(t.last_in_at, t.last_out_at), t.updated_at) DESC, t.id DESC LIMIT 30`)).rows;
            await fillHints(rows);   // #672 카드의 문자 줄도 낡은 「주문을 찾지 못한 번호」를 구매이력으로 고친다(빈 줄만 · 같은 상한·기억)
            const items = rows.map(t => { const p = pub(t); return Object.assign({ kind: 'sms', needs_reply: !!t.is_open, done: false, last_text: p.last_dir === 'out' ? p.last_out_text : p.last_in_text }, p); })
                .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));
            return { open: n.open, unread: n.unread, more: rows.length ? Math.max(0, rows[0].total - rows.length) : 0, items };
        };
        require('../desk-inbox.js').hook('sms', () => _cardSms());
    } catch (e) { }
    app.get('/api/sms/summary', authMiddleware, wrap(async (req, res) => {
        const c = await cfg(); const st = (await naverCfgGet('sms_gateway_state')) || {};
        const today = kstDate();
        const r = (await pool.query(`SELECT
            (SELECT count(*)::int FROM sms_threads WHERE status = 'staff_needed' ${TEST_HIDE}) AS staff_needed,
            (SELECT count(*)::int FROM sms_threads WHERE draft_text IS NOT NULL AND status NOT IN ('closed','ignored') ${TEST_HIDE}) AS drafts,
            (SELECT count(*)::int FROM sms_threads WHERE staff_why IS NOT NULL AND status NOT IN ('closed','ignored') ${TEST_HIDE}) AS staff_open,
            (SELECT count(*)::int FROM sms_threads t WHERE ${ACTIVE_SQL}) AS unread_threads,
            (SELECT count(*)::int FROM sms_threads t WHERE ${OPEN_SQL}) AS open_threads, true AS done_route,
            (SELECT count(*)::int FROM sms_threads t WHERE ${ACTIVE_SQL} AND t.staff_why IS NOT NULL AND t.status <> 'closed') AS needs_staff,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'in' AND (event_at + interval '9 hours')::date = $1::date ${TEST_HIDE_MSG}) AS today_in,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered') AND (sent_at + interval '9 hours')::date = $1::date ${TEST_HIDE_MSG}) AS today_bot,
            (SELECT count(*)::int FROM sms_messages WHERE direction = 'out' AND sender IN ('gateway_other','staff_desk') AND (event_at + interval '9 hours')::date = $1::date ${TEST_HIDE_MSG}) AS today_staff`, [today])).rows[0];
        const lastPing = Math.max(st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0, st.last_event_at ? new Date(st.last_event_at).getTime() : 0);
        const counts = {}; for (const row of (await pool.query(`SELECT status, count(*)::int AS n FROM sms_threads WHERE TRUE ${TEST_HIDE} GROUP BY status`)).rows) counts[row.status] = row.n;   // 숫자 칸(워커1 계약 제안 1)
        res.json(Object.assign({ enabled: c.enabled, mode: c.mode, counts }, r, { gateway: { last_ping_at: st.last_ping_at || null, alive: !!lastPing && Date.now() - lastPing < c.ping_alert_hours * 3600e3 } }));
    }));
    app.get('/api/sms/threads', authMiddleware, wrap(async (req, res) => {
        // #635: scope=active(기본 · 안 읽은 글이 있는 대화) | all(전부 · 끝난 대화·무시 포함) · q 가 있으면 scope 와 무관하게 전체에서 찾는다 · 종전 status= 는 그대로(옛 화면·검증)
        const hasStatus = req.query.status !== undefined && req.query.status !== '';
        const status = String(req.query.status || 'all'), q = String(req.query.q || '').trim().slice(0, 40), limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const scope = String(req.query.scope || (hasStatus ? '' : 'active'));
        if (scope && !['active', 'all', 'open'].includes(scope)) return res.status(400).json({ ok: false, error: '범위 값이 틀려요' });
        const where = [], args = [];
        if (hasStatus && status !== 'all') { if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: '상태 값이 틀려요' }); args.push(status); where.push(`t.status = $${args.length}`); }
        else if (q || scope === 'all') where.push('TRUE');
        else if (scope === 'active') where.push(ACTIVE_SQL);
        else if (scope === 'open') where.push(OPEN_SQL);   // #660
        else where.push(`t.status <> 'ignored'`);   // 종전 status=all
        if (q) {
            const qd = /^[\d\s-]+$/.test(q) ? q.replace(/\D/g, '') : '', qt = q.replace(/\d/g, '').trim();
            if (qd.length === 3 || qd.length === 4) { args.push(qd); where.push(`right(t.phone_digits, ${qd.length}) = $${args.length}`); }   // 숫자는 끝자리 일치만(한 자씩 늘려 전체 번호를 알아내는 뒷문 차단)
            else if (qd.length >= 5) { args.push(qd); where.push(`t.phone_digits = $${args.length}`); }   // 5자리 이상 = 전체 번호가 같을 때만(배송조회 #613 과 같은 규칙 · 종전엔 숫자를 지운 빈 글 '%%' 로 전부 나왔음)
            else if (!qt) where.push('FALSE');   // 숫자 1~2자리뿐 = 찾지 않음
            else { args.push('%' + qt.replace(/[\\%_]/g, '\\$&') + '%'); where.push(`(t.last_in_text ILIKE $${args.length} ESCAPE '\\' OR t.last_out_text ILIKE $${args.length} ESCAPE '\\' OR EXISTS (SELECT 1 FROM sms_messages x WHERE x.thread_id = t.id AND x.body ILIKE $${args.length} ESCAPE '\\'))`); }   // #635 「이전 대화 보기」 검색 = 오간 글 전체에서
        }
        if (!deps.testMode) where.push(`t.phone_digits NOT LIKE '0999%'`);   // #648: 목록 전 갈래(active·all·찾기·상태)에서 시험 번호 대화를 뺀다(대화 한 건 조회는 id 직접이라 그대로)
        args.push(limit);
        const rows = (await pool.query(`SELECT t.*, ${UNREAD_SQL} AS unread FROM sms_threads t WHERE ${where.join(' AND ')} ORDER BY COALESCE(GREATEST(t.last_in_at, t.last_out_at), t.updated_at) DESC, t.id DESC LIMIT $${args.length}`, args)).rows;
        await fillHints(rows);   // #672 「주문을 찾지 못한 번호」가 낡았으면 구매이력으로 고쳐 보여 준다
        res.json({ scope: (hasStatus && status !== 'all') ? 'status' : q ? 'all' : (scope || 'legacy'), items: rows.map(pub) });
    }));
    app.get('/api/sms/threads/:id', authMiddleware, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!id) return res.status(400).json({ ok: false, error: 'id' });
        // #635: 여는 순간 읽음(staff_read_at = now · updated_at 은 안 건드림) — ?peek=1 이면 읽음으로 안 바꿈(상태만 다시 볼 때)
        const peek = String(req.query.peek || '') === '1';
        const t = (await pool.query(peek ? `SELECT t.*, ${UNREAD_SQL} AS unread FROM sms_threads t WHERE t.id = $1` : `UPDATE sms_threads SET staff_read_at = now() WHERE id = $1 RETURNING *, 0 AS unread`, [id])).rows[0]; if (!t) return res.status(404).json({ ok: false, error: '없는 대화예요' });
        const ms = (await pool.query(`SELECT m.id, m.direction, m.kind, m.body, m.sender, m.state, m.bucket, m.rule_kind, m.event_at, m.sent_at, m.fail_reason, m.send_after,
            COALESCE((SELECT array_agg(i.id ORDER BY i.id) FROM sms_images i WHERE i.message_id = m.id AND i.purged_at IS NULL AND i.data IS NOT NULL), '{}') AS image_ids
            FROM sms_messages m WHERE m.thread_id = $1 ORDER BY m.id LIMIT 300`, [id])).rows;
        const cH = await cfg(); let hist = { items: [], more: false };
        try { hist = await staffHistory(t.phone_digits, cH); } catch (e) { log.error('[문자] 구매이력 읽기 실패(무시):', e.message); }   // #654 실패해도 대화는 열린다
        if (!t.order_hint) await saveHint(t, hist);   // #672 받은 뒤에 주문이 생긴 번호 — 여는 순간 목록 줄 글도 고친다
        res.json({ thread: pub(t), messages: ms.map(m => ({ id: m.id, direction: m.direction, kind: m.kind, body: m.body, sender: m.sender, state: m.state, bucket: m.bucket, rule_kind: m.rule_kind, image_ids: m.image_ids, event_at: m.event_at, fail_reason: m.fail_reason, send_after: (m.direction === 'out' && m.state === 'queued') ? (m.send_after || null) : null })), order: t.order_json || null, history: hist.items, history_days: cH.history_days, history_more: hist.more });
    }));
    // #654(대표 10/11 「60일 구매이력으로」): 직원 화면 전용 — 그 번호가 받는 분 또는 구매자인 송장 묶음(발송일 + 받는 분) history_days 일치 전부 + 발송 전 주문. 최신순 · 최대 60건(#657 · 종전 20).
    //   🔴 봇의 자동 답 판정용 주문 찾기(lookup_days 14일)와는 따로다 · CJ 재조회 없음(저장된 상태만) · 손님에게 나가는 글·알림·한 줄 요약에는 쓰지 않는다
    // #672(워커4 발견 10/12): 목록 줄의 「주문을 찾지 못한 번호」(order_hint 빈값)는 글을 받은 순간의 판정이라, 그 뒤 주문이 생기거나(발송 전 주문·송장 올리기) 주문이 여러 건(봇 판정 many)이면 낡은 채 남는다 →
    //   직원 화면용 구매이력(staffHistory · 60일)에 줄이 있으면 한 줄 요약을 만들어 order_hint 에 적는다(빈값일 때만 · updated_at 안 건드림 · order_json·봇 답 판정은 무접촉 · 손님 글에는 안 쓰임).
    //   목록에서는 빈값인 줄만 한 번에 HINT_FILL_MAX 건까지 보고, 없었던 번호는 HINT_MISS_MS 동안 다시 안 본다(목록을 자주 불러도 조회가 쌓이지 않게)
    const HINT_FILL_MAX = 15, HINT_MISS_MS = 10 * 60000; const _hintMiss = new Map();
    const mdOf = v => { if (!v) return ''; const s = v instanceof Date ? kstDate(v.getTime()) : String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10).replace('-', '/') : ''; };
    function hintLineOf(hist) {
        const it = hist && Array.isArray(hist.items) ? hist.items : []; if (!it.length) return null; const f = it[0];
        return [it.length > 1 ? '구매이력 ' + it.length + (hist.more ? '건 이상' : '건') : '', f.pre ? '발송 전' : (mdOf(f.ship_date) ? mdOf(f.ship_date) + ' 발송' : ''), f.option_text, f.pre ? '' : f.status_text].filter(Boolean).join(' · ').slice(0, 200) || null;
    }
    async function saveHint(t, hist) {
        try { const line = hintLineOf(hist); if (!line) return false; t.order_hint = line; await pool.query(`UPDATE sms_threads SET order_hint = $2 WHERE id = $1 AND order_hint IS NULL`, [t.id, line]); return true; }
        catch (e) { log.error('[문자] 주문 요약 고치기 실패(무시):', e.message); return false; }
    }
    async function fillHints(rows) {
        try {
            const c = await cfg(); const now = Date.now(); let n = 0;
            for (const t of rows) {
                if (t.order_hint || t.status === 'ignored' || !/^0\d{8,11}$/.test(String(t.phone_digits || ''))) continue;
                const miss = _hintMiss.get(t.phone_digits); if (!deps.testMode && miss && now - miss < HINT_MISS_MS) continue;
                if (++n > HINT_FILL_MAX) break;
                if (!(await saveHint(t, await staffHistory(t.phone_digits, c)))) { if (_hintMiss.size > 2000) _hintMiss.clear(); _hintMiss.set(t.phone_digits, now); }
            }
        } catch (e) { log.error('[문자] 목록 주문 요약 고치기 실패(무시):', e.message); }
    }
    const _histCache = new Map(); let _histTtl = deps.testMode ? 0 : 45000;   // 번호 → { at, val } · 45초(검증은 0 = 기억 안 함 · _setHistTtl 로 시험)
    async function staffHistory(digits, c) {
        const d = String(digits || ''); if (!/^0\d{8,11}$/.test(d)) return { items: [], more: false };
        const hit = _histTtl > 0 ? _histCache.get(d) : null;
        if (hit && Date.now() - hit.at < _histTtl) return hit.val;
        const val = await staffHistoryRead(d, c);
        if (_histTtl > 0) { if (_histCache.size > 300) _histCache.clear(); _histCache.set(d, { at: Date.now(), val }); }
        return val;
    }
    // #657(대표 10/11 「정보 없음으로 왜 나오는 거야 · 배송 중이나」): 직원 화면에 보일 상태 이름. status_label(우리 분류 원값)은 그대로 두고 이 글자만 따로 준다
    //   정보없음(또는 아직 조회한 적 없음) = 송장은 발행됐는데 CJ 전산에 아직 안 올라온 것 → 발송 2일 안이면 「배송 중 · 집화 전」 · 3일 넘으면 「조회 안 됨」
    function staffStatusText(label, shipDate, delivered) {
        const l = String(label || '');
        if (delivered || l === '배송완료') return '배송완료';
        if (l === '집화') return '배송 중 · 집화';
        if (l === '간선상하차') return '배송 중 · 이동';
        if (l === '배송출발') return '배송 중 · 배송 출발';
        if (!l || l === '정보없음' || l === '조회실패') {
            const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
            const gap = shipDate ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(String(shipDate).slice(0, 10) + 'T00:00:00Z')) / 86400e3) : 99;
            return gap <= 2 ? '배송 중 · 집화 전' : '조회 안 됨';
        }
        return l;   // 미배송 · 사고 · 기타 = 그대로
    }
    async function staffHistoryRead(d, c) {
        const MAX = 60, items = [];   // #657 대표 「수십 건 고객도 있으니」 — 화면이 접어서 보여 준다(종전 20)
        try {
            const pre = (await pool.query(`SELECT p.channel, min(p.recipient_initial) AS recipient_initial, bool_or(p.recipient_digits = $1) AS is_r, bool_or(p.buyer_digits = $1) AS is_b,
                    min(COALESCE(p.paid_at, p.created_at)) AS paid_at, bool_and(p.paid_at IS NOT NULL) AS paid_known, array_remove(array_agg(DISTINCT NULLIF(btrim(p.option_text), '')), NULL) AS options, COALESCE(sum(p.qty), 0)::int AS qty
                FROM sms_preorders p WHERE (p.recipient_digits = $1 OR p.buyer_digits = $1) AND p.miss = 0 AND COALESCE(p.paid_at, p.created_at) >= now() - make_interval(days => $2::int)
                GROUP BY p.channel, p.recipient_digits, p.recipient_initial, (COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'Asia/Seoul')::date ORDER BY min(COALESCE(p.paid_at, p.created_at)) DESC LIMIT 10`, [d, c.history_days])).rows;
            for (const p of pre) items.push({ pre: true, ship_date: null, recipient_name: p.recipient_initial || null, option_text: (p.options || []).join(' + ') || null, qty: p.qty || null, boxes: null, trackings: [],
                status_label: null, status_text: null, boxes_detail: [], delivered: false, event_time: null, partner: null, role: p.is_r && p.is_b ? 'both' : (p.is_r ? 'recipient' : 'buyer'), channel: p.channel || null, paid_at: p.paid_at ? new Date(p.paid_at).toISOString() : null,
                ship_plan: await prePlanOf({ pre: true, paid_at: p.paid_at ? new Date(p.paid_at).toISOString() : null, paid_known: !!p.paid_known, option_text: (p.options || []).join(' + ') }) });
        } catch (e) { if (!(e && e.code === '42P01')) log.error('[문자] 구매이력(발송 전) 읽기 실패(무시):', e.message); }
        const g = (await pool.query(`SELECT s.ship_date::text AS ship_date, btrim(min(s.recipient)) AS recipient_name, bool_or(s.phone_digits = $1) AS is_r, bool_or(s.buyer_digits = $1) AS is_b,
                array_agg(s.tracking ORDER BY s.tracking) AS trackings, array_remove(array_agg(DISTINCT NULLIF(btrim(s.partner), '')), NULL) AS partners,
                json_agg(json_build_object('t', s.tracking, 'o', btrim(COALESCE(s.option_text, '')), 'q', s.qty) ORDER BY s.tracking) AS lines,
                array_remove(array_agg(DISTINCT NULLIF(btrim(s.option_text), '')), NULL) AS options, COALESCE(sum(s.qty), 0)::int AS qty
            FROM delivery_shipments s WHERE (s.phone_digits = $1 OR s.buyer_digits = $1) AND s.ship_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - $2::int ${deps.testMode ? '' : "AND COALESCE(s.source, '') NOT LIKE 'verify%'"}
            GROUP BY s.ship_date, regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g') ORDER BY s.ship_date DESC LIMIT ${MAX + 1}`, [d, c.history_days])).rows;
        const all = [].concat(...g.map(x => x.trackings || [])).filter(Boolean);
        const st = new Map(all.length ? (await pool.query(`SELECT tracking, bucket, label, event_time, delivered FROM delivery_status WHERE tracking = ANY($1::text[])`, [all])).rows.map(r => [r.tracking, r]) : []);
        for (const x of g) {
            const trs = (x.trackings || []).filter(Boolean); const ss = trs.map(t => st.get(t) || null);
            const pend = ss.findIndex(v => !(v && v.delivered)); const rep1 = ss[pend >= 0 ? pend : 0] || null;   // 안 끝난 상자가 있으면 그 상자가 대표(lookup.fillStatus 와 같은 규칙)
            // #657 송장 한 줄 = 그 송장의 품목·수량·상태(대표 「송장별 품목 다른 경우도 그 품목이랑 송장 뜨는 거지?」) — 묶음 칸(option_text·trackings·status_label)은 종전 그대로
            const detail = (Array.isArray(x.lines) ? x.lines : []).map(ln => {
                const tr = String(ln && ln.t == null ? '' : ln.t).replace(/[^0-9]/g, ''); if (!/^\d{10,12}$/.test(tr)) return null;
                const v = st.get(ln.t) || null; const lab = v ? (v.bucket || v.label || null) : null; const dv = !!(v && v.delivered);
                return { tracking: tr, option_text: String(ln.o || '').slice(0, 200) || null, qty: Number(ln.q) > 0 ? Number(ln.q) : null, status_label: lab, status_text: staffStatusText(lab, x.ship_date, dv), delivered: dv, event_time: v ? (v.event_time || null) : null };
            }).filter(Boolean).slice(0, 20);
            items.push({ pre: false, status_text: staffStatusText(rep1 ? (rep1.bucket || rep1.label || null) : null, x.ship_date, trs.length > 0 && pend < 0), boxes_detail: detail, ship_date: x.ship_date, recipient_name: String(x.recipient_name || '').replace(/\s+/g, ' ').trim().slice(0, 40) || null, option_text: (x.options || []).join(' + ') || null, qty: x.qty || null, boxes: trs.length,
                trackings: [...new Set(trs.map(t => String(t).replace(/[^0-9]/g, '')).filter(t => /^\d{10,12}$/.test(t)))].slice(0, 5), status_label: rep1 ? (rep1.bucket || rep1.label || null) : null, delivered: trs.length > 0 && pend < 0,
                event_time: rep1 ? (rep1.event_time || null) : null, partner: (x.partners || []).join(' · ') || null, role: x.is_r && x.is_b ? 'both' : (x.is_r ? 'recipient' : 'buyer') });
        }
        return { items: items.slice(0, MAX), more: items.length > MAX };
    }
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
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null, staff_why: null, staff_read_at: SQL_NOW, done_json: null });
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
        // #635-C: 화면이 「내가 본 초안 글」(body.seen)을 같이 보내면 DB 초안과 같을 때만 보낸다 — 폴링 사이 손님 글이 와 초안이 바뀌면 직원이 못 본 글이 나가던 구멍. seen 이 없으면(옛 화면) 종전 그대로
        const seen = (req.body && typeof req.body.seen === 'string') ? req.body.seen : null;
        const WS = `E' \\n\\r\\t'`;   // 앞뒤 빈칸·줄바꿈은 무시하고 견준다
        const taken = (await pool.query(`WITH old AS (SELECT id, draft_text, draft_kind FROM sms_threads WHERE id = $1 AND draft_text IS NOT NULL AND ($2::text IS NULL OR btrim(draft_text, ${WS}) = btrim($2::text, ${WS})) FOR UPDATE)
            UPDATE sms_threads t SET draft_text = NULL FROM old WHERE t.id = old.id RETURNING old.draft_text, old.draft_kind`, [t.id, seen])).rows[0];   // 두 사람이 동시에 눌러도 한 번만(RETURNING 은 새 값이라 옛 값은 CTE 로)
        if (!taken && seen !== null) {   // 초안이 바뀌었거나 사라짐 → 보내지 않고 지금 초안을 돌려준다(화면이 새 초안을 보여 주고 다시 누르게)
            const cur = (await pool.query(`SELECT draft_text, draft_kind FROM sms_threads WHERE id = $1`, [t.id])).rows[0] || {};
            return res.status(409).json({ ok: false, error: 'draft_changed', draft_text: cur.draft_text || null, draft_kind: cur.draft_text ? (cur.draft_kind || null) : null });
        }
        if (!taken) return res.status(409).json({ ok: false, error: '보낼 초안이 없어요(이미 보냈을 수 있어요)' });
        const m = await queueStaffReply(t, taken.draft_text, req, 'draft:' + (taken.draft_kind || '')); if (!m) return res.status(400).json({ ok: false, error: '초안에 문자로 보낼 글자가 없어요' }); res.json({ ok: true, message_id: m.id });
    }));
    app.post('/api/sms/threads/:id/handled', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'handled');
        await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null, staff_why: null, staff_read_at: SQL_NOW, done_json: null });
        res.json({ ok: true, cancelled });
    }));
    // #675(대표 10/12 실물 — 사진 손님을 전화로 처리했는데 문자 「미처리」가 안 빠짐): [처리함] = 사람 몫 표시를 내린다(답 글 없이) · undo = 되돌림
    //   처리함 = 종전 [처리함](handled)과 같은 잠금(staff_replied · 봇 침묵 · staff_lock_hours 뒤 저절로 끝) + 그때의 사유·상태·초안을 done_json 에 적어 둔다.
    //   손님이 새 글을 보내면 평소대로 다시 판정된다(잠금 중 재수신 길) — 그 뒤에는 되돌릴 수 없다(409).
    const openCount = async () => (await pool.query(`SELECT count(*)::int AS n FROM sms_threads t WHERE ${OPEN_SQL}`)).rows[0].n;
    const withUnread = async id => (await pool.query(`SELECT t.*, ${UNREAD_SQL} AS unread FROM sms_threads t WHERE t.id = $1`, [id])).rows[0];
    app.post('/api/sms/threads/:id/done', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const undo = !!(req.body && req.body.undo === true);
        if (!undo) {
            if (!t.staff_why || t.status === 'closed' || t.status === 'ignored') return res.json({ ok: true, done: false, noop: true, thread: pub(await withUnread(t.id)), open_threads: await openCount(), cancelled: 0 });
            const keep = { why: t.staff_why, status: t.status, draft_text: t.draft_text || null, draft_kind: t.draft_kind || null, by: who(req).name, by_id: req.user.id, at: new Date().toISOString(), last_in_at: t.last_in_at ? new Date(t.last_in_at).toISOString() : null };
            const cancelled = await cancelPending(t.id, 'handled');
            await setThread(t.id, { status: 'staff_replied', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null, staff_why: null, staff_read_at: SQL_NOW, done_json: keep });
            await writeAudit({ action: 'update', targetType: 'sms_thread', targetId: t.id, changes: { after: { done: true, why: keep.why } }, source: 'sms', actor: who(req) });
            return res.json({ ok: true, done: true, thread: pub(await withUnread(t.id)), open_threads: await openCount(), cancelled });
        }
        const k = t.done_json;
        if (!k || !k.why) return res.status(409).json({ ok: false, error: '되돌릴 것이 없어요' });
        const sameIn = String(k.last_in_at || '') === String(t.last_in_at ? new Date(t.last_in_at).toISOString() : '');
        if (t.status !== 'staff_replied' || t.staff_why || !sameIn) return res.status(409).json({ ok: false, error: '그 뒤 손님 글이 와서(또는 답을 보내서) 되돌릴 수 없어요' });
        await setThread(t.id, { status: k.status || 'staff_needed', staff_why: k.why, draft_text: k.draft_text || null, draft_kind: k.draft_kind || null, done_json: null });
        await writeAudit({ action: 'update', targetType: 'sms_thread', targetId: t.id, changes: { after: { done: false, why: k.why } }, source: 'sms', actor: who(req) });
        res.json({ ok: true, done: false, thread: pub(await withUnread(t.id)), open_threads: await openCount(), cancelled: 0 });
    }));
    app.post('/api/sms/threads/:id/close', authMiddleware, wrap(async (req, res) => {
        const t = await loadThread(req, res); if (!t) return;
        const cancelled = await cancelPending(t.id, 'close');
        await setThread(t.id, { status: 'closed', staff_user_id: req.user.id, staff_name: who(req).name, handled_at: new Date(), draft_text: null, draft_kind: null, ask_kind: null, ask_at: null, staff_why: null, staff_read_at: SQL_NOW, done_json: null });
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

    return { initDB, start, stop, handleWebhook, handleInbound, _cardSms: () => _cardSms(), _redecideTick: redecideTick, _staffHistory: staffHistory, _setHistTtl: ms => { _histTtl = Number(ms) || 0; _histCache.clear(); }, _tickSql: { TICK_T, TICK_P, TICK_M }, handleSent, sendTick, watchTick, cfg, cfgOf, parseEvent, verifySignature, normalizePhone, smsSafeText, phoneMasked, phoneTail, modules: { classify: !!classifyMod, rules: !!rulesMod, lookup: !!lookupMod, photo: !!(photoJudge && photoReply), aiNote: !!aiNote }, _gatewaySend: gatewaySend, registerWebhooks, splitForSms, smsSafe, pendingPhotoTick, attachDownloaded, sweepStuck, retentionRun, stateMerge, resetCfg: () => { _cfgCache = null; }, _notifyStaff: notifyStaff, _classify: (t, ctx) => (classifyMod ? classifyMod.classify(t, ctx) : null), _aiAsserts: aiAsserts, _generalQ: t => GENERAL_Q_RE.test(String(t || '')) };   // _aiAsserts·_generalQ = 검증용(#645)
};
module.exports.normalizePhone = normalizePhone;
module.exports.smsSafeText = smsSafeText;
module.exports.splitForSms = splitForSms;
module.exports.DEFAULT_CFG = DEFAULT_CFG;

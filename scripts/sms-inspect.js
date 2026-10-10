// #610-I 회사폰 문자 연동 점검 도구(총괄용 · 워커2 · 2026-10-10)
//   node scripts/sms-inspect.js [--since 2h] [--thread <id>] [--events] [--limit 15] [--json]
//   실DB 를 **읽기만** 한다(SELECT 뿐 · 외부 호출 0). .env 의 DATABASE_URL 사용.
//   보는 것: 설정(sms_gateway) · 마지막 신호(sms_gateway_state) · 큐 · 오늘 통계 · 최근 대화 · 시험 a~f 판정(자료로 판정되는 것만).
//   🔴 가림: 번호 = 010****1234 · 손님 글 80자 · 주소 꼴은 「[주소]」 · 글 속 전화번호는 가운데 가림. 사진 바이트는 크기만.
//   --since  30m | 2h | 1d (기본 2h) — 이 시간 안의 줄만 판정·표시
//   --thread 대화 id 하나만 자세히(줄 전부)
//   --events 최근 줄을 시간순 한 줄씩(들어온 순서 확인용 · created_at 기준)
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const argv = process.argv.slice(2);
const arg = (name, d) => { const i = argv.indexOf('--' + name); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const sinceMin = (() => { const m = /^(\d+)\s*([mhd])$/i.exec(String(arg('since', '2h'))); if (!m) return 120; return Number(m[1]) * ({ m: 1, h: 60, d: 1440 }[m[2].toLowerCase()]); })();
const threadId = parseInt(arg('thread', ''), 10) || null;
const showEvents = arg('events', false) === true;
const limit = Math.min(100, Math.max(1, parseInt(arg('limit', '15'), 10) || 15));
const asJson = arg('json', false) === true;

// ── 가림 ──
const maskPhone = d => { d = String(d || '').replace(/[^0-9]/g, ''); return d.length >= 7 ? d.slice(0, 3) + '****' + d.slice(-4) : (d ? '***' + d.slice(-2) : ''); };
const ADDR_RE = /(?:[가-힣]{1,8}(?:특별자치도|특별자치시|특별시|광역시|도|시|군|구)\s*)+[가-힣0-9\s·\-]{0,24}(?:로|길|동|읍|면|리|가)\s*\d[\d\-]*(?:\s*(?:번길|번지|호|동|층))*(?:\s*\d[\d\-]*(?:호|동|층)?)*/g;
const ADDR_RE2 = /[가-힣0-9]{1,12}(?:로|길)\s*\d{1,4}(?:-\d{1,4})?(?:번길\s*\d{1,4})?(?:\s*\d{1,4}동)?(?:\s*\d{1,4}호)?/g;
const PHONE_RE = /(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;
function safeText(s, n) {
    let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    t = t.replace(ADDR_RE, '[주소]').replace(ADDR_RE2, '[주소]').replace(PHONE_RE, (m, a, b, c) => a + '****' + c);
    const arr = Array.from(t); const max = n || 80;
    return arr.length > max ? arr.slice(0, max).join('') + '…' : t;
}
const kst = d => { if (!d) return '-'; const x = new Date(new Date(d).getTime() + 9 * 3600e3); return x.toISOString().slice(5, 19).replace('T', ' '); };
const ago = d => { if (!d) return '없음'; const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); if (s < 90) return s + '초 전'; if (s < 5400) return Math.round(s / 60) + '분 전'; if (s < 172800) return (s / 3600).toFixed(1) + '시간 전'; return Math.round(s / 86400) + '일 전'; };
const parseVal = v => { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return null; } };
const len = s => Array.from(String(s || '')).length;

(async () => {
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 이 없어요(.env)'); process.exit(1); }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    const q = async (sql, args) => (await pool.query(sql, args || [])).rows;
    const out = {};
    try {
        const has = (await q(`SELECT to_regclass('public.sms_threads') AS t, to_regclass('public.sms_messages') AS m, to_regclass('public.sms_images') AS i`))[0];
        if (!has.t || !has.m || !has.i) { console.log('문자 표가 아직 없어요(sms_threads/sms_messages/sms_images) — 서버가 배포돼 initDB 가 돈 뒤 다시 실행하세요.'); return; }

        // ── 설정·신호 ──
        const cfgRows = await q(`SELECT key, value FROM agent_office_config WHERE key IN ('sms_gateway','sms_gateway_state')`);
        const cfgRaw = parseVal((cfgRows.find(r => r.key === 'sms_gateway') || {}).value) || null;
        const st = parseVal((cfgRows.find(r => r.key === 'sms_gateway_state') || {}).value) || {};
        const cfg = Object.assign({ enabled: false, mode: 'record', cooldown_min: 30, daily_cap: 1, hourly_send_cap: 30, hold_sec: 75, ping_alert_hours: 3, max_chars: 70, ttl_sec: 600 }, cfgRaw || {});
        cfg.enabled = cfgRaw ? cfgRaw.enabled === true : false;
        const pingMs = st.last_ping_at ? new Date(st.last_ping_at).getTime() : 0;
        const lastPingMs = Math.max(pingMs, st.last_event_at ? new Date(st.last_event_at).getTime() : 0);   // 서버와 같은 판정: ping·다른 이벤트 중 최근
        const alive = !!lastPingMs && Date.now() - lastPingMs < cfg.ping_alert_hours * 3600e3;
        out.config = { row: !!cfgRaw, enabled: cfg.enabled, mode: cfg.mode, cooldown_min: cfg.cooldown_min, daily_cap: cfg.daily_cap, hourly_send_cap: cfg.hourly_send_cap, hold_sec: cfg.hold_sec, max_chars: cfg.max_chars, ttl_sec: cfg.ttl_sec, ping_alert_hours: cfg.ping_alert_hours, staff_ids: cfg.staff_ids || [] };
        out.gateway = { last_ping_at: st.last_ping_at || null, last_event_at: st.last_event_at || null, last_event: st.last_event || null, started_at: st.started_at || null, starts: st.starts || 0, alive, alerted: !!st.alerted };

        // ── 큐·오늘 통계 ──
        out.queue = (await q(`SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'sending')::int AS sending,
            min(send_after) FILTER (WHERE state = 'queued') AS oldest_send_after, min(created_at) FILTER (WHERE state = 'sending') AS oldest_sending
            FROM sms_messages WHERE direction = 'out' AND state IN ('queued','sending')`))[0];
        out.today = (await q(`SELECT
            count(*) FILTER (WHERE direction = 'in')::int AS in_n,
            count(*) FILTER (WHERE direction = 'out' AND sender = 'bot' AND state IN ('sent','delivered','sending'))::int AS bot_n,
            count(*) FILTER (WHERE direction = 'out' AND sender IN ('staff_desk','staff_phone'))::int AS staff_n,
            count(*) FILTER (WHERE direction = 'out' AND sender = 'gateway_other')::int AS other_n,
            count(*) FILTER (WHERE direction = 'out' AND state = 'failed')::int AS failed_n,
            count(*) FILTER (WHERE direction = 'out' AND state = 'cancelled')::int AS cancelled_n
            FROM sms_messages WHERE (created_at + interval '9 hours')::date = (now() + interval '9 hours')::date`))[0];
        out.status_counts = {}; for (const r of await q(`SELECT status, count(*)::int AS n FROM sms_threads GROUP BY status ORDER BY 2 DESC`)) out.status_counts[r.status] = r.n;

        // ── 줄(기간 안) ──
        const msgSql = `SELECT m.id, m.thread_id, m.direction, m.kind, m.body, m.sender, m.state, m.gateway_id, m.sim_number, m.bucket, m.rule_kind,
                m.ai_json, m.send_after, m.sent_at, m.delivered_at, m.fail_reason, m.event_at, m.created_at, m.priority, (m.envelope_id IS NOT NULL) AS has_env,
                t.phone_digits, t.status AS thread_status,
                (SELECT count(*)::int FROM sms_images i WHERE i.message_id = m.id) AS img_n,
                (SELECT count(*)::int FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) AS img_data_n,
                (SELECT COALESCE(sum(octet_length(i.data)), 0)::bigint FROM sms_images i WHERE i.message_id = m.id AND i.data IS NOT NULL) AS img_bytes
            FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id`;
        const msgs = threadId
            ? await q(msgSql + ` WHERE m.thread_id = $1 ORDER BY m.id`, [threadId])
            : await q(msgSql + ` WHERE m.created_at > now() - make_interval(mins => $1::int) ORDER BY m.id`, [sinceMin]);
        const row = m => ({
            id: m.id, thread: m.thread_id, dir: m.direction, kind: m.kind, sender: m.sender, state: m.state, bucket: m.bucket || '', rule: m.rule_kind || '',
            why: m.ai_json && (m.ai_json.why || m.ai_json.kind) || '', part: m.ai_json && m.ai_json.parts ? `${m.ai_json.part}/${m.ai_json.parts}` : '', prio: m.priority || 0,
            chars: len(m.body), text: safeText(m.body, 80), gw: m.gateway_id ? String(m.gateway_id).slice(0, 8) : '', env: m.has_env ? 'y' : '',
            img: m.img_n ? `${m.img_data_n}/${m.img_n}장 ${m.img_bytes}B` : '', event_at: m.event_at, created_at: m.created_at, sent_at: m.sent_at, delivered_at: m.delivered_at,
            lag_sec: m.direction === 'in' && m.event_at ? Math.round((new Date(m.created_at) - new Date(m.event_at)) / 1000) : null, fail: m.fail_reason || '', phone: maskPhone(m.phone_digits), tail: String(m.phone_digits || '').slice(-4),
        });
        const rows = msgs.map(row);

        // ── 최근 대화 ──
        const threads = threadId
            ? await q(`SELECT * FROM sms_threads WHERE id = $1`, [threadId])
            : await q(`SELECT * FROM sms_threads WHERE updated_at > now() - make_interval(mins => $1::int) ORDER BY updated_at DESC LIMIT $2`, [sinceMin, limit]);
        out.threads = threads.map(t => ({
            id: t.id, phone: maskPhone(t.phone_digits), tail: String(t.phone_digits || '').slice(-4), status: t.status, has_image: !!t.has_image,
            last_in_at: t.last_in_at, last_out_at: t.last_out_at, last_out_state: t.last_out_state || null, cooldown_until: t.cooldown_until, bot_count: t.bot_count, bot_count_day: t.bot_count_day,
            staff_name: t.staff_name || null, handled_at: t.handled_at, draft: t.draft_text ? safeText(t.draft_text, 80) : null, draft_kind: t.draft_kind || null, order_hint: t.order_hint ? safeText(t.order_hint, 60) : null,
            lines: rows.filter(r => r.thread === t.id),
        }));
        out.events = rows;

        // ── 시험 판정(기간 안 줄만 · 자료로 판정되는 것만) ──
        const ins = rows.filter(r => r.dir === 'in'), outs = rows.filter(r => r.dir === 'out');
        const J = [];
        const j = (k, verdict, note) => J.push({ k, verdict, note });
        // a 받기
        const aRows = ins.filter(r => r.kind === 'sms');
        j('a 받기', aRows.length ? '통과' : '미확인', aRows.length ? `받은 문자 ${aRows.length}줄 · 최근 #${aRows[aRows.length - 1].id} 「${aRows[aRows.length - 1].text.slice(0, 20)}」 끝 ${aRows[aRows.length - 1].tail} · 지연 ${aRows[aRows.length - 1].lag_sec}초` : `최근 ${sinceMin}분 안에 받은 줄 없음`);
        // b 보내기
        const ours = outs.filter(r => r.sender === 'bot' || r.sender === 'staff_desk');
        const bOk = ours.filter(r => r.state === 'sent' || r.state === 'delivered');
        j('b 보내기', bOk.length ? '통과' : (ours.length ? '진행 중/실패' : '미확인'), ours.length ? `우리 발송 ${ours.length}줄 = ` + ['queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled'].map(s => { const n = ours.filter(r => r.state === s).length; return n ? `${s} ${n}` : ''; }).filter(Boolean).join(' · ') + (bOk.some(r => r.state === 'delivered') ? '' : ' (delivered 아직 없음 — 배달 확인이 안 와도 sent 면 통과)') + ' · 삼성 메시지 대화창에 보이는지는 폰에서 확인' : '보낸 줄 없음');
        // b-2 긴 글
        const long1 = ours.filter(r => r.chars > 70);
        const multi = ours.filter(r => r.part && !r.part.endsWith('/1'));
        const b2 = [];
        if (long1.length) b2.push(`70자 넘는 한 통 ${long1.length}줄: ` + long1.map(r => `#${r.id} ${r.chars}자 ${r.state}`).join(', '));
        if (multi.length) b2.push(`나눠 보낸 조각 ${multi.length}줄: ` + multi.map(r => `#${r.id} ${r.part} ${r.chars}자 p${r.prio} ${r.state}`).join(', '));
        j('b-2 긴 글', b2.length ? '자료 있음' : '미확인', b2.length ? b2.join(' / ') + ' · 손님 폰에 한 덩어리로 왔는지·순서는 폰에서 확인(partsCount 는 DB 에 안 남음 → 서버 로그)' : '70자 넘는 발송·나눠 보낸 발송 없음');
        // c 수동 발신
        const others = outs.filter(r => r.sender === 'gateway_other' || r.sender === 'staff_phone');
        j('c 손으로 보낸 답', others.length ? '올라옴(예상과 다름)' : (rows.length ? '예상대로(자료상)' : '미확인'), others.length ? `우리 id 가 아닌 발신 ${others.length}줄: ` + others.map(r => `#${r.id} ${r.sender} ${r.state} 끝 ${r.tail}`).join(', ') + ' — 직원이 폰에서 보낸 시각과 맞는지 확인' : 'gateway_other 줄 0 — 직원이 폰에서 실제로 보낸 뒤에 돌렸다면 「수동 발신은 안 올라옴」 확정(보내기 전이면 미확인)');
        // d 사진
        const mm = ins.filter(r => r.kind === 'mms' || r.img || r.bucket === 'photo_pending');
        const withData = mm.filter(r => /^[1-9]/.test(r.img));
        const pending = mm.filter(r => r.bucket === 'photo_pending');
        j('d 사진', withData.length ? '통과' : (mm.length ? '사진 바이트 없음' : '미확인'), mm.length ? mm.map(r => `#${r.id} ${r.bucket || '-'} ${r.img || '사진 0'}`).join(', ') + (pending.length ? ` · 내려받기 대기 ${pending.length}줄(5분 넘으면 직원 몫으로 바뀜 — 삼성 메시지 MMS 자동 가져오기 확인)` : '') : 'MMS 줄 없음');
        // e ping
        j('e 살아 있음', alive ? (pingMs && Date.now() - pingMs < 15 * 60000 ? '통과' : 'ping 오래됨') : '신호 없음', `마지막 ping ${ago(st.last_ping_at)}(${kst(st.last_ping_at)}) · 앱 시작 ${st.starts || 0}회 · 마지막 시작 ${ago(st.started_at)}(${kst(st.started_at)}) · 마지막 이벤트 ${st.last_event || '-'} ${ago(st.last_event_at)} · 강제 종료·재부팅 시험 = 「종료한 시각 뒤에 마지막 시작 시각이 찍히고 그 뒤 ping 이 이어지는지」`);
        // f 늦게 온 글
        const late = ins.filter(r => r.lag_sec != null && r.lag_sec > 60);
        const dupText = (() => { const seen = {}; const d = []; for (const r of ins) { const k = r.tail + '|' + r.text; if (seen[k] && Math.abs(new Date(r.event_at) - new Date(seen[k].event_at)) < 5000) d.push(`#${seen[k].id}=#${r.id}`); seen[k] = r; } return d; })();
        j('f 꺼진 동안 온 글', late.length ? '자료 있음' : '미확인', (late.length ? late.map(r => `#${r.id} 지연 ${r.lag_sec}초(문자 시각 ${kst(r.event_at)} → 서버 ${kst(r.created_at)}) 대화 상태 ${msgs.find(m => m.id === r.id).thread_status}`).join(', ') + ' · 30분 넘게 늦은 줄은 봇이 답하지 않고 staff_needed(late_to_staff)가 정상' : '서버 도착이 60초 넘게 늦은 받은 줄 없음') + (dupText.length ? ` · 🔴 같은 글·같은 시각 두 줄: ${dupText.join(', ')}` : ' · 같은 글 중복 줄 0'));
        out.judge = J;
        const noEnv = ins.filter(r => !r.env).length;
        out.notes = [];
        if (!cfgRaw) out.notes.push('설정 행(sms_gateway)이 없음 = 꺼짐 · 받은 글은 기록만');
        if (noEnv) out.notes.push(`봉투 id 없는 받은 줄 ${noEnv}개(재시도 중복을 DB 가 못 거름 — 시험·수동 입력 줄이면 정상)`);
        if (out.queue.sending > 0 && out.queue.oldest_sending && Date.now() - new Date(out.queue.oldest_sending).getTime() > cfg.ttl_sec * 1000 + 120000) out.notes.push('sending 상태가 ttl 을 넘겨 남아 있음 — sms:sent/failed webhook 이 안 온 것(폰 꺼짐·webhook 미등록 의심)');
        if (out.queue.queued > 0 && out.queue.oldest_send_after && Date.now() - new Date(out.queue.oldest_send_after).getTime() > 120000) out.notes.push('보낼 시각이 2분 넘게 지난 queued 줄이 있음 — 서버 보내기 틱·시간당 상한(hourly_send_cap)·enabled 확인');

        if (asJson) { console.log(JSON.stringify(out, null, 1)); return; }

        // ── 출력 ──
        const L = console.log;
        L(`━━━ 문자 연동 점검 · ${kst(new Date())} KST · ${threadId ? '대화 ' + threadId : '최근 ' + (sinceMin >= 60 ? (sinceMin / 60) + '시간' : sinceMin + '분')} ━━━`);
        L(`설정   ${out.config.row ? '' : '(행 없음) '}켜짐 ${cfg.enabled ? '예' : '아니오'} · 모드 ${cfg.mode} · 쿨다운 ${cfg.cooldown_min}분 · 하루 봇 답 ${cfg.daily_cap}회 · 시간당 발송 ${cfg.hourly_send_cap} · 유예 ${cfg.hold_sec}초 · 한 통 ${cfg.max_chars}자 · ttl ${cfg.ttl_sec}초`);
        L(`신호   ${alive ? '살아 있음' : '🔴 끊김'} · 마지막 ping ${ago(st.last_ping_at)}(${kst(st.last_ping_at)}) · 앱 시작 ${st.starts || 0}회(마지막 ${ago(st.started_at)}) · 마지막 이벤트 ${st.last_event || '-'} ${ago(st.last_event_at)}${st.alerted ? ' · 끊김 알림 나간 상태' : ''}`);
        L(`큐     queued ${out.queue.queued} · sending ${out.queue.sending}${out.queue.oldest_send_after ? ' · 가장 오래된 보낼 시각 ' + kst(out.queue.oldest_send_after) + '(' + ago(out.queue.oldest_send_after) + ')' : ''}`);
        L(`오늘   받음 ${out.today.in_n} · 봇 ${out.today.bot_n} · 직원 ${out.today.staff_n} · 그 밖 발신 ${out.today.other_n} · 실패 ${out.today.failed_n} · 취소 ${out.today.cancelled_n}`);
        L(`대화   ` + (Object.keys(out.status_counts).length ? Object.entries(out.status_counts).map(([k, v]) => `${k} ${v}`).join(' · ') : '없음'));
        L('');
        L('── 시험 판정(자료로 보이는 것만 · 폰 화면 확인은 따로) ──');
        for (const x of J) L(`${x.k.padEnd(10)} [${x.verdict}] ${x.note}`);
        if (out.notes.length) { L(''); for (const n of out.notes) L('⚠ ' + n); }
        const line = r => `   ${r.dir === 'in' ? '←' : '→'} #${r.id} ${kst(r.event_at)} ${r.kind} ${r.sender}/${r.state}` + (r.bucket ? ` 갈래:${r.bucket}` : '') + (r.rule ? ` 규칙:${r.rule}` : '') + (r.why ? ` 이유:${r.why}` : '') + (r.part ? ` ${r.part}통 p${r.prio}` : '') + (r.img ? ` 사진:${r.img}` : '') + (r.gw ? ` id:${r.gw}` : '') + (r.lag_sec != null && r.lag_sec > 60 ? ` 지연:${r.lag_sec}초` : '') + (r.fail ? ` 실패:${safeText(r.fail, 60)}` : '') + `\n        ${r.chars}자 「${r.text}」`;
        if (showEvents) {
            L(''); L(`── 줄(들어온 순서 · ${rows.length}줄) ──`);
            for (const r of rows) L(`[대화 ${r.thread} 끝 ${r.tail}]\n` + line(r));
        } else {
            L(''); L(`── 최근 대화 ${out.threads.length}건 ──`);
            for (const t of out.threads) {
                L(`대화 ${t.id} · ${t.phone} · 상태 ${t.status}${t.has_image ? ' · 사진' : ''}${t.staff_name ? ' · 처리 ' + t.staff_name : ''}${t.cooldown_until && new Date(t.cooldown_until) > new Date() ? ' · 쿨다운 ~' + kst(t.cooldown_until).slice(6, 11) : ''} · 오늘 봇 ${t.bot_count_day && new Date(new Date(t.bot_count_day).getTime() + 9 * 3600e3).toISOString().slice(0, 10) === new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) ? t.bot_count : 0}회${t.last_out_state ? ' · 마지막 발송 ' + t.last_out_state : ''}`);
                if (t.order_hint) L(`   주문: ${t.order_hint}`);
                if (t.draft) L(`   초안(${t.draft_kind || '-'}): 「${t.draft}」`);
                for (const r of t.lines) L(line(r));
                if (!t.lines.length) L('   (기간 안 줄 없음)');
            }
            if (!out.threads.length) L('(기간 안에 움직인 대화 없음 — --since 를 늘려 보세요)');
        }
    } finally { await pool.end(); }
})().catch(e => { console.error('점검 실패:', e.message); process.exit(1); });

// #1184 검증 — B8 문자 직원 답 60초 막이 · A12 손님 연락 정렬(시각 숫자) · A12 응대 현황 셈 창(KST 오늘 포함 n일)·open14 실제 SQL · B9 체험 메일 안 읽은 것부터
//   각 모듈의 함수를 글자 그대로 떼어(또는 모듈을 통째로 장착해) 가짜 의존·메모리 pglite 로 실행 · 고치기 전(git HEAD)/뒤 나란히
//   🔴 실DB·실서버·외부(문자·메일)·AI 0 · 실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-1184-misc.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const L = require('./verify-1184-lib.js');
const { ok, end } = L.counter('#1184 문자·손님 연락·응대 현황·체험 메일 검증');

// 모듈 안쪽(4칸 들여쓴) 함수 떼기
function innerFn(src, head) {
    src = L.norm(src);
    const i = src.indexOf('\n    ' + head); if (i < 0) throw new Error('없음: ' + head);
    const e = src.indexOf('\n    }\n', i + 1); if (e < 0) throw new Error('끝 없음: ' + head);
    return src.slice(i + 1, e + 6);
}

// ── B8 문자 직원 답 ───────────────────────────────────────────
async function smsWorld(which) {
    const src = L.srcOf('sms/index.js', which);
    const W = await L.makeDb(`CREATE TABLE sms_messages (id SERIAL PRIMARY KEY, thread_id INTEGER, direction TEXT, kind TEXT, body TEXT, sender TEXT, state TEXT, rule_kind TEXT, priority INTEGER, ai_json JSONB, send_after TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), fail_reason TEXT);`);
    // 대화 열쇠 잠금 흉내: pg_advisory_xact_lock = 열쇠별 JS 잠금 · COMMIT/ROLLBACK = 풂 · 그 밖 질의 = 그대로 DB
    const locks = new Map();
    const raw = { query: (s, p) => W.db.query(s, p || []).then(r => ({ rows: r.rows })) };
    const pool = {
        query: raw.query,
        async connect() {
            let held = null;
            return {
                async query(s, p) {
                    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) { if (!/BEGIN/i.test(s) && held) { const h = held; held = null; locks.set(h.k, null); h.rel(); } return { rows: [] }; }
                    if (/pg_advisory_xact_lock/.test(s)) { const k = p[0]; while (locks.get(k)) await locks.get(k).p; let rel; const pr = new Promise(r => { rel = r; }); locks.set(k, { p: pr }); held = { k, rel }; return { rows: [{}] }; }
                    return raw.query(s, p);
                },
                release() { if (held) { const h = held; held = null; locks.set(h.k, null); h.rel(); } },
            };
        },
    };
    const body = innerFn(src, 'async function queueStaffReply(') + '\nreturn queueStaffReply;';
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const addMessage = async m => { await sleep(5); const r = await raw.query(`INSERT INTO sms_messages (thread_id, direction, kind, body, sender, state, rule_kind, priority, ai_json, send_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [m.thread_id, m.direction, m.kind, m.body, m.sender, m.state, m.rule_kind, m.priority, JSON.stringify(m.ai_json), m.send_after]); return r.rows[0]; };
    const q = L.load(['pool', 'staffFull', 'safeMod', 'smsSafe', 'cfg', 'splitForSms', 'addMessage', 'setThread', 'writeAudit', 'who', 'byteLen', 'typingClear', 'SQL_NOW'],
        [pool, t => String(t), null, t => String(t).trim(), async () => ({ max_chars: 1000 }), (b) => [b], addMessage, async () => { }, async () => { }, req => ({ id: req.user.id, name: 'x' }), s => Buffer.byteLength(String(s)), () => { }, Symbol('n')], body);
    W.send = (tid, text, kind) => q({ id: tid }, text, { user: { id: 2 } }, kind);
    W.n = async tid => (await W.q('SELECT count(*)::int AS n FROM sms_messages WHERE thread_id = $1', [tid]))[0].n;
    return W;
}
async function smsScenario(W) {
    const R = {};
    let r = await Promise.all([W.send(1, '안녕하세요 확인했어요', 'staff'), W.send(1, '안녕하세요 확인했어요', 'staff')]);
    R['같은 글 두 번 겹침(직원 답)'] = `줄 ${await W.n(1)} · 같은 번호 ${r[0].id === r[1].id} · 둘째 dup ${!!r[1].dup || !!r[0].dup}`;
    r = await W.send(1, '안녕하세요 확인했어요', 'staff');
    R['10초 안 또 보냄'] = `줄 ${await W.n(1)}`;
    await W.q(`UPDATE sms_messages SET created_at = now() - interval '61 seconds' WHERE thread_id = 1`);
    await W.send(1, '안녕하세요 확인했어요', 'staff');
    R['61초 뒤 같은 글'] = `줄 ${await W.n(1)}`;
    await W.send(1, '다른 글이에요', 'staff');
    R['다른 글'] = `줄 ${await W.n(1)}`;
    await Promise.all([W.send(2, '새 문자', 'staff_new'), W.send(2, '새 문자', 'staff_new')]);
    R['새 문자 두 번 겹침'] = `줄 ${await W.n(2)}`;
    await Promise.all([W.send(3, '초안 글', 'draft:auto'), W.send(3, '초안 글', 'draft:auto')]);
    R['초안 보내기 두 번(막이 밖)'] = `줄 ${await W.n(3)}`;
    await W.q(`UPDATE sms_messages SET state = 'failed' WHERE thread_id = 1 AND body = '다른 글이에요'`);
    await W.send(1, '다른 글이에요', 'staff');
    R['앞 것이 실패한 같은 글'] = `줄 ${await W.n(1)}`;
    return R;
}

// ── A12 손님 연락 정렬 ─────────────────────────────────────────
function sortCheck(which) {
    const src = L.norm(L.srcOf('inbox-threads.js', which));
    const list = () => [{ id: 'z-noon', last_at: '2026-11-17T03:00:00Z' }, { id: 'kst-1am', last_at: '2026-11-17T01:00:00+09:00' }, { id: 'kst-11am', last_at: '2026-11-17T11:00:00+09:00' }, { id: 'none', last_at: null }];
    if (which === 'before') { const l = list(); l.sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || ''))); return l.map(x => x.id).join(','); }
    const m = /^const atNum = .*$/m.exec(src), n = /^const byLastAt = .*$/m.exec(src);
    const by = L.load([], [], m[0] + '\n' + n[0] + '\nreturn byLastAt;');
    const uses = (src.match(/\.sort\(byLastAt\)/g) || []).length, left = (src.match(/localeCompare\(String\(a\.last_at/g) || []).length;
    return list().sort(by).map(x => x.id).join(',') + ` | 쓰는 곳 ${uses} · 남은 글자 정렬 ${left}`;
}

// ── A12 응대 현황(실제 SQL 을 pglite 에서) ────────────────────
async function headWorld(which) {
    const tmp = path.join(os.tmpdir(), `rh1184-${which}-${process.pid}.js`);
    fs.writeFileSync(tmp, L.srcOf('response-head.js', which));
    const mount = require(tmp);
    const W = await L.makeDb(`
CREATE TABLE message_logs (id SERIAL PRIMARY KEY, user_id TEXT, item TEXT, message TEXT, answered BOOLEAN DEFAULT false, bot_response TEXT, staff_response TEXT, reviewed_at TIMESTAMP, received_at TIMESTAMP);
CREATE TABLE naver_qnas (id SERIAL PRIMARY KEY, answered BOOLEAN DEFAULT false, posted_at TIMESTAMP, posted_by VARCHAR(50), reviewed_at TIMESTAMP, collected_at TIMESTAMP);
CREATE TABLE naver_inquiries (id SERIAL PRIMARY KEY, answered BOOLEAN DEFAULT false, posted_at TIMESTAMP, posted_by VARCHAR(50), reviewed_at TIMESTAMP, collected_at TIMESTAMP);
CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
CREATE TABLE inquiry_scenarios (id SERIAL PRIMARY KEY, deleted_at TIMESTAMP);
CREATE TABLE product_season_knowledge (id SERIAL PRIMARY KEY, start_md TEXT, end_md TEXT, deleted_at TIMESTAMP);
-- 지금 = 2026-11-17 12:00 KST(= 03:00 UTC) · 7일 창 첫날 = 11/11 00:00 KST = 11/10 15:00 UTC · 14일 창 첫날 = 11/04 00:00 KST = 11/03 15:00 UTC
INSERT INTO message_logs (user_id, message, answered, received_at) VALUES
 ('u1', '안녕하세요 귤 언제 와요', false, '2026-11-17 01:00:00'),
 ('u2', '배송 문의요', false, '2026-11-10 16:00:00'),
 ('u3', '주소 바꿔 주세요', false, '2026-11-10 14:00:00'),
 ('u4', '사이즈요', false, '2026-11-05 10:00:00'),
 ('u5', '맛있어요', true, '2026-11-12 10:00:00');
UPDATE message_logs SET bot_response = '답' WHERE user_id = 'u5';
INSERT INTO naver_qnas (answered, collected_at) VALUES (false, '2026-11-10 16:00:00'), (false, '2026-11-10 14:00:00'), (false, '2026-11-01 00:00:00');
INSERT INTO naver_inquiries (answered, posted_at, posted_by, collected_at) VALUES (true, '2026-11-12 00:00:00', 'auto', '2026-11-12 00:00:00');
`);
    const app = L.fakeApp();
    mount(app, { pool: W.pool, authMiddleware: (q, r, nx) => nx(), now: () => Date.parse('2026-11-17T03:00:00Z'), cacheMs: 0, token: () => '' });
    W.stats = async days => (await app.call('GET', '/api/agent-office/response-stats', { user: { id: 1, role: 'admin' }, query: { days: String(days) } })).body;
    return W;
}
async function headScenario(W) {
    const R = {};
    const s7 = await W.stats(7), s30 = await W.stats(30);
    R['7일 기간 글'] = `${s7.from}~${s7.to}`;
    R['7일 톡톡'] = JSON.stringify(s7.channels.talk);
    R['7일 상품문의'] = JSON.stringify(s7.channels.qna);
    R['7일 전체 안 답함'] = String(s7.all && s7.all.open);
    R['open14'] = JSON.stringify(s7.open14 || null);
    R['30일 기간 글'] = `${s30.from}~${s30.to}`;
    R['30일 톡톡 합'] = String(s30.channels.talk && s30.channels.talk.total);
    return R;
}

// ── B9 체험 메일 ──────────────────────────────────────────────
// o = { total(받은 메일 수), seen:[a,b](이미 읽은 uid 범위 · 기록 uid·uidv 같이), seenUidv(기록의 uidv · undefined = 칸 없는 옛 줄), uidv(지금 메일함 UIDVALIDITY), uidShift(지금 uid = 기록 uid + 이 값 · 번호 체계가 바뀐 꼴) }
async function mailWorld(which, maxPer, o) {
    o = Object.assign({ total: 30, seen: [11, 30], seenUidv: undefined, uidv: null, uidShift: 0 }, o || {});
    const src = L.srcOf('experience.js', which);
    const W = await L.makeDb(`CREATE TABLE experience_mail_seen (message_id VARCHAR(200) PRIMARY KEY, uid BIGINT, booking_id INTEGER, state VARCHAR(16), seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), uidv BIGINT);`);
    for (let u = o.seen[0]; u <= o.seen[1]; u++) await W.q(`INSERT INTO experience_mail_seen (message_id, uid, state, uidv) VALUES ($1, $2, 'new', $3)`, ['m' + u + '@x', u, o.seenUidv == null ? null : o.seenUidv]);
    const saved = []; W.hdr = 0;
    const midOf = uid => 'm' + (uid - o.uidShift) + '@x';   // 메일 자체(메시지 번호)는 그대로 · uid 만 밀림
    const im = { uidv: o.uidv, search: async () => Array.from({ length: o.total }, (_, i) => i + 1 + o.uidShift), fetch: async (uid, what) => { if (/HEADER/.test(what)) { W.hdr++; return Buffer.from('Message-ID: <' + midOf(uid) + '>'); } return Buffer.from('raw' + uid); } };
    const body = innerFn(src, 'async function collectPlace() {') + '\nreturn collectPlace;';
    const run = L.load(['ready', 'mailCfg', 'withImap', 'imapDate', 'imapFromCrit', 'pool', 'parseMail', 'savePlace', 'deps'],
        [Promise.resolve(), async () => ({ days: 3, max_per_tick: maxPer, from_terms: ['booking'] }), async f => f(im), () => '17-Nov-2026', () => 'FROM "booking"', W.pool, raw => ({ messageId: null, subject: '', text: String(raw) }), async (mail, uid) => { saved.push(uid); return { state: 'new', id: uid }; }, {}], body);
    W.tick = async () => { W.hdr = 0; const msg = await run(); return msg; };
    W.saved = saved;
    return W;
}

(async () => {
    // B8
    const SB = await smsScenario(await smsWorld('before')), SA = await smsScenario(await smsWorld('after'));
    console.log('\n[B8 문자] 항목 | 고치기 전 | 고친 뒤'); for (const k of Object.keys(SA)) console.log(`${k} | ${SB[k]} | ${SA[k]}`);
    ok(/^줄 1 · 같은 번호 true · 둘째 dup true$/.test(SA['같은 글 두 번 겹침(직원 답)']) && /^줄 2/.test(SB['같은 글 두 번 겹침(직원 답)']), 'B8 같은 대화 같은 글 겹침 = 한 줄 · 둘 다 같은 번호(전 = 두 줄 = 두 통)', [SB['같은 글 두 번 겹침(직원 답)'], SA['같은 글 두 번 겹침(직원 답)']]);
    ok(SA['10초 안 또 보냄'] === '줄 1', 'B8 60초 안 다시 눌러도 한 줄', SA['10초 안 또 보냄']);
    ok(SA['61초 뒤 같은 글'] === '줄 2', 'B8 60초 지나면 같은 글도 새로 보냄', SA['61초 뒤 같은 글']);
    ok(SA['다른 글'] === '줄 3', 'B8 다른 글은 바로 보냄');
    ok(SA['새 문자 두 번 겹침'] === '줄 1' && SB['새 문자 두 번 겹침'] === '줄 2', 'B8 새 문자(staff_new)도 같은 막이', [SB['새 문자 두 번 겹침'], SA['새 문자 두 번 겹침']]);
    ok(SA['초안 보내기 두 번(막이 밖)'] === SB['초안 보내기 두 번(막이 밖)'] && SA['초안 보내기 두 번(막이 밖)'] === '줄 2', '무변: 초안 보내기 길은 이 막이 밖(초안 집기 막이가 따로 있음)', SA['초안 보내기 두 번(막이 밖)']);
    ok(SA['앞 것이 실패한 같은 글'] === '줄 4', 'B8 앞 것이 실패한 같은 글은 다시 보냄', SA['앞 것이 실패한 같은 글']);
    // A12 정렬
    const OB = sortCheck('before'), OA = sortCheck('after');
    console.log(`\n[A12 정렬] 전 ${OB} | 뒤 ${OA}`);
    ok(OB.startsWith('kst-11am,z-noon'), '재현: 전 = 글자 비교라 11:00 KST(+09:00 글자) 글이 12:00 KST(Z 글자) 글보다 위', OB);
    ok(OA === 'z-noon,kst-11am,kst-1am,none | 쓰는 곳 2 · 남은 글자 정렬 0', 'A12 뒤 = 시각 순(12:00 → 11:00 → 01:00 KST · 시각 없음 맨 뒤) · 두 곳 다 바뀜', OA);
    // A12 응대 현황
    const HB = await headScenario(await headWorld('before')), HA = await headScenario(await headWorld('after'));
    console.log('\n[A12 응대 현황] 항목 | 고치기 전 | 고친 뒤'); for (const k of Object.keys(HA)) console.log(`${k} | ${HB[k]} | ${HA[k]}`);
    ok(HA['7일 기간 글'] === '2026-11-11~2026-11-17' && HA['7일 기간 글'] === HB['7일 기간 글'], '무변: 기간 글 = 오늘 포함 7일');
    ok(HA['7일 톡톡'] === JSON.stringify({ total: 3, bot: 1, staff: 0, open: 2 }) && HB['7일 톡톡'] === JSON.stringify({ total: 4, bot: 1, staff: 0, open: 3 }), 'A12 셈 창 = 11/11 00시(KST)부터(전 = 11/10 12시 KST 글까지 셈 = 글보다 반나절 김)', [HB['7일 톡톡'], HA['7일 톡톡']]);
    ok(HA['7일 상품문의'] === JSON.stringify({ total: 1, bot: 0, staff: 0, open: 1 }), 'A12 상품문의도 같은 창', HA['7일 상품문의']);
    ok(HA['open14'] === JSON.stringify({ all: 6, talk: 4, qna: 2, inquiry: 0 }) && HB['open14'] === 'null', 'A12 open14 = 14일(11/04~) 안 답함 · 채널별', HA['open14']);
    ok(HA['30일 기간 글'] === HB['30일 기간 글'] && HA['30일 톡톡 합'] === '5', '30일 = 기간 글 그대로 · 다섯 손님 다 셈', [HA['30일 기간 글'], HA['30일 톡톡 합']]);
    // B9 체험 메일
    const MB = await mailWorld('before', 20), MA = await mailWorld('after', 20);
    const mb = await MB.tick(), ma = await MA.tick();
    console.log(`\n[B9 메일] 전 ${mb} · 읽은 ${MB.saved.join(',') || '없음'} | 뒤 ${ma} · 읽은 ${MA.saved.join(',')}`);
    ok(MB.saved.length === 0, '재현: 전 = 최근 20통이 다 읽은 것이면 안 읽은 앞 10통을 영영 못 읽음', mb);
    ok(MA.saved.join(',') === '1,2,3,4,5,6,7,8,9,10', 'B9 뒤 = 안 읽은 10통을 오래된 것부터 읽음', MA.saved.join(','));
    const M3 = await mailWorld('after', 3); await M3.tick(); const first = M3.saved.join(','); await M3.tick(); const second = M3.saved.join(',');
    ok(first === '1,2,3' && second === '1,2,3,4,5,6', 'B9 한 틱 상한 3 = 안 읽은 것만 3통씩 차례로(읽은 메일은 몫을 안 씀)', [first, second]);
    const M0 = await mailWorld('after', 20); await M0.tick(); await M0.tick();
    ok(M0.saved.length === 10, 'B9 두 번째 틱 = 새로 읽을 것 없음(같은 메일 두 번 안 읽음)', M0.saved.length);
    // B9-b(워커3 교차 점검): 읽은 250통 + 새 5통 · 머리 받기 = 안 본 것만
    const MBA = await mailWorld('after', 20, { total: 255, seen: [1, 250] });
    await MBA.tick(); const ha = MBA.hdr;
    console.log(`[B9-b] 읽은 250 + 새 5 · 읽은 ${MBA.saved.join(',')} · 머리 받기 ${ha}`);
    ok(MBA.saved.join(',') === '251,252,253,254,255' && ha === 5, 'B9-b 읽은 250통 + 새 5통 = 새 5통 읽힘 · 머리 받기 5번(안 본 것만 · 첫 고침은 읽은 메일 머리 200번에 몫이 차 새 메일을 못 읽었음)', [MBA.saved.join(','), ha]);
    const MOld = await mailWorld('after', 20, { total: 260, seen: [1, 30] }); await MOld.tick(); const h1 = MOld.hdr, s1 = MOld.saved.length;
    ok(s1 === 20 && h1 === 20 && MOld.saved[0] === 31, 'B9-b 안 읽은 230통 = 한 틱에 오래된 것부터 20통(머리 20번)', [s1, h1, MOld.saved[0]]);
    await MBA.tick(); ok(MBA.hdr === 0 && MBA.saved.length === 5, 'B9-b 다음 틱 = 머리 받기 0 · 새로 읽은 것 없음', [MBA.hdr, MBA.saved.length]);
    const MV = await mailWorld('after', 20, { total: 30, seen: [1, 30], seenUidv: 7, uidv: 7 }); await MV.tick();
    ok(MV.saved.length === 0 && MV.hdr === 0, 'B9-b 같은 번호 체계(uidv 같음) = uid 로 빠짐(머리 0)', [MV.saved.length, MV.hdr]);
    const MC = await mailWorld('after', 20, { total: 30, seen: [1, 30], seenUidv: 7, uidv: 8, uidShift: 1000 }); await MC.tick(); const hc1 = MC.hdr; await MC.tick();
    ok(MC.saved.length === 0 && hc1 === 30 && MC.hdr === 0, 'B9-b 번호 체계가 바뀜(uidv 7→8 · uid 밀림) = 머리로 확인해 다시 안 읽음 · uid 고쳐 다음 틱 머리 0', [MC.saved.length, hc1, MC.hdr]);
    const ML = await mailWorld('after', 20, { total: 12, seen: [1, 10] }); await ML.tick();
    ok(ML.saved.join(',') === '11,12' && ML.hdr === 2, 'B9-b 옛 줄(uidv 칸 비어 있음) = uid 로 믿음 · 새 2통만', [ML.saved.join(','), ML.hdr]);
    end();
})().catch(e => { console.error('검증 실패:', e); process.exit(1); });

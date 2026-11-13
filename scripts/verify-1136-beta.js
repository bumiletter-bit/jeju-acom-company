// #1136-a 검증 — 자사몰 귤나무 「베타」 서버 길(/api/mall-beta) · mall-api.js 실코드를 두 번 장착(실서비스 꼴 + 베타 꼴)
//   🔴 실DB·카페24·텔레그램·쿠폰 발급 0 · DB = 이 PC 메모리 pglite · 카페24 = 가짜(읽기 호출만 기록) · 포트 PORT1136(기본 3474)
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-1136-beta.js   (TZ=UTC 로도 한 번 · 렌더 = UTC)
'use strict';
const path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요'); process.exit(2); }
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
const express = require(path.join(ROOT, 'node_modules', 'express'));
const { createMallRouter } = require(path.join(ROOT, 'mall-api.js'));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 500))); };
const arr = v => '{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
function mkPool(db) { const conv = v => Array.isArray(v) ? arr(v) : (v && typeof v === 'object' && !(v instanceof Date)) ? JSON.stringify(v) : v; const q = async (sql, p = []) => { const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; }; return { query: q, connect: async () => ({ query: q, release() {} }) }; }

(async () => {
    const db = new PGlite(), pool = mkPool(db);
    await db.exec(`
        CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB);
        CREATE TABLE mall_members (id SERIAL PRIMARY KEY, member_key VARCHAR(100) UNIQUE NOT NULL, nickname VARCHAR(50), created_at TIMESTAMP DEFAULT NOW(), deleted_at TIMESTAMP);
        CREATE TABLE points_ledger (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL, delta INTEGER NOT NULL, balance_after INTEGER NOT NULL, reason VARCHAR(100), ref_type VARCHAR(30), ref_id VARCHAR(80), idem_key VARCHAR(120) UNIQUE, created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE roulette_spins (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL, spin_date DATE NOT NULL, result_key VARCHAR(30), points INTEGER, created_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE tree_state (member_id INTEGER PRIMARY KEY, level INTEGER DEFAULT 1, water_count INTEGER DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE reward_grants (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL, kind VARCHAR(20), amount INTEGER, status VARCHAR(20) DEFAULT 'pending', month_key VARCHAR(7), idem_key VARCHAR(120) UNIQUE, created_at TIMESTAMP DEFAULT NOW(), granted_at TIMESTAMPTZ, granted_by TEXT, coupon_no TEXT, issue_no TEXT, issued_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ, used_order_id TEXT, notify_issue_status TEXT, notify_issue_at TIMESTAMPTZ, notify_expire_status TEXT, notify_expire_at TIMESTAMPTZ, grant_error TEXT);
        CREATE TABLE mall_game_scores (id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL, game VARCHAR(20) NOT NULL, score INTEGER NOT NULL, stage INTEGER, stats JSONB, play_id VARCHAR(40) UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE mall_game_invites (id SERIAL PRIMARY KEY, inviter_member_id INTEGER NOT NULL, friend_member_id INTEGER NOT NULL UNIQUE, code VARCHAR(16) NOT NULL, accepted_at TIMESTAMPTZ DEFAULT NOW(), done_at TIMESTAMPTZ, done_day DATE, inviter_plays INTEGER DEFAULT 0, friend_plays INTEGER DEFAULT 0);
        CREATE TABLE season_waitlist (id SERIAL PRIMARY KEY, item TEXT, notified BOOLEAN DEFAULT false, member_key VARCHAR(60), created_at TIMESTAMP DEFAULT NOW(), deleted_at TIMESTAMP);`);
    const CFG = {
        mall_pub: { on: true },
        mall_game_config: { probabilities: [{ key: 'coupon10', label: '10% 할인 쿠폰', points: 0, weight: 1 }], water_cost: 1, level_thresholds: [0, 2, 100] },
    };
    const cfgGet = async k => (k in CFG ? JSON.parse(JSON.stringify(CFG[k])) : null);
    const calls = { notify: [], grant: [], c24: [], audit: [] };
    const cafe24 = { apiGet: async (p, q) => { calls.c24.push({ p, mid: q && q.member_id }); if (/orders\/count/.test(p)) return { count: 2 }; if (/boards/.test(p)) return { articles: [] }; return { orders: [] }; } };
    const deps = { pool, express, cfgGet, cfgSet: async () => {}, writeAudit: async a => { calls.audit.push(a); }, cafe24,
        notify: (...a) => calls.notify.push(a), onRewardGrant: p => calls.grant.push(p) };   /* 베타에도 일부러 넘김 → 막이가 코드 안에서 막는지 */
    const app = express(); app.use(express.json());
    app.use('/api/mall', createMallRouter(deps));
    app.use('/api/mall-beta', createMallRouter(Object.assign({}, deps, { keyPrefix: 'beta:', beta: true })));
    const P = Number(process.env.PORT1136) || 3474;
    const srv = await new Promise(r => { const s = http.createServer(app).listen(P, '127.0.0.1', () => r(s)); });
    const call = async (method, url, body) => { const r = await fetch('http://127.0.0.1:' + P + url, { method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const row = async k => (await db.query(`SELECT id, member_key FROM mall_members WHERE member_key=$1`, [k])).rows[0];
    const bal = async id => { const r = await db.query(`SELECT balance_after FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 1`, [id]); return r.rows.length ? r.rows[0].balance_after : 0; };
    try {
        console.log('Ⅰ 실서비스 꼴(옵션 없음) = 종전 그대로');
        let r = await call('GET', '/api/mall/pub/wallet?mid=kim1');
        ok(r.s === 200 && !('game' in r.j) && r.j.tickets === 4, '실서비스 wallet 200 · game 칸 없음 · 티켓 4(가짜 카페24 2구간×2)', r);
        ok(!!(await row('kim1')) && !(await row('beta:kim1')), '실서비스 member_key = 아이디 그대로(앞머리 없음)');
        await call('POST', '/api/mall/pub/join-bonus', { mid: 'kim1' });
        r = await call('POST', '/api/mall/pub/spin', { mid: 'kim1' });
        await new Promise(res => setTimeout(res, 50));
        const realG = (await db.query(`SELECT status FROM reward_grants`)).rows;
        ok(r.s === 200 && realG.length === 1 && realG[0].status === 'pending' && calls.grant.length === 1, '실서비스 쿠폰 당첨 = pending + 후처리(onRewardGrant) 1회 = 종전', { r, realG, g: calls.grant.length });
        r = await call('POST', '/api/mall/pub/game-start', { mid: 'kim1', game: 'catch' });
        ok(r.s === 503, '실서비스엔 게임 길 없음(토큰 게이트로 503)', r.s);
        r = await call('GET', '/api/mall/members/resolve');
        ok(r.s === 503, '실서비스 토큰 내부 길 = 종전 503(MALL_API 꺼짐)', r.s);
        const kim = await row('kim1'), kimBal = await bal(kim.id);
        const kimTree = (await db.query(`SELECT water_count FROM tree_state WHERE member_id=$1`, [kim.id])).rows;

        console.log('Ⅱ 베타 게이트');
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1');
        ok(r.s === 503, '설정 mall_beta 없음 = 503', r.s);
        CFG.mall_beta = { on: false, members: ['kim1'] };
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1'); ok(r.s === 503, 'on false = 503', r.s);
        CFG.mall_beta = { on: true, members: ['kim1'] };
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=lee2'); ok(r.s === 403, '명단 밖 = 403', r.s);
        r = await call('POST', '/api/mall-beta/pub/attend', { mid: 'lee2' }); ok(r.s === 403, '명단 밖 POST(body mid) = 403', r.s);
        CFG.mall_pub = { on: false };
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1');
        ok(r.s === 200 && r.j.game && r.j.game.left === 3 && r.j.game.max === 3, 'mall_pub 꺼져도 베타 200 · wallet 에 game {left 3, max 3}', r);
        const rp = await call('GET', '/api/mall/pub/wallet?mid=kim1'); ok(rp.s === 503, '같은 때 실서비스는 mall_pub 꺼짐 = 503(서로 무관)', rp.s);
        CFG.mall_pub = { on: true };
        r = await call('POST', '/api/mall-beta/members/resolve', { member_key: 'kim1' }); ok(r.s === 404, '베타 토큰 내부 길 = 404(공개 길만)', r.s);

        console.log('Ⅲ 베타 회원 행 따로 · 실회원 물방울·나무 무변');
        const bk = await row('beta:kim1');
        ok(!!bk && bk.id !== kim.id, '\'beta:kim1\' 행이 따로 생김', bk);
        ok(calls.c24.length > 0 && calls.c24.every(c => c.mid === 'kim1'), '카페24 주문 세기는 실아이디 kim1 로(앞머리 뗌)', calls.c24.slice(-3));
        await call('POST', '/api/mall-beta/pub/join-bonus', { mid: 'kim1' });
        await call('POST', '/api/mall-beta/pub/attend', { mid: 'kim1' });
        r = await call('POST', '/api/mall-beta/pub/tree-water', { mid: 'kim1', idem_key: 'w1' });
        r = await call('POST', '/api/mall-beta/pub/tree-water', { mid: 'kim1', idem_key: 'w2' });
        ok(r.s === 200 && r.j.given === 2, '베타 물주기 2번 = 목표(2) 도달', r);
        ok(calls.notify.length === 0, '베타 수확 알림 0(notify 넘겨도 안 부름)', calls.notify);
        ok(await bal(kim.id) === kimBal && JSON.stringify((await db.query(`SELECT water_count FROM tree_state WHERE member_id=$1`, [kim.id])).rows) === JSON.stringify(kimTree), '실회원 kim1 물방울·나무 그대로', { before: kimBal, after: await bal(kim.id) });
        const idems = (await db.query(`SELECT idem_key FROM points_ledger WHERE member_id=$1 AND idem_key LIKE '%water:%'`, [bk.id])).rows.map(x => x.idem_key);
        ok(idems.every(k => /^betawater:/.test(k)), '베타 물주기 idem = betawater:(실회원 pubwater: 와 안 겹침)', idems);

        console.log('Ⅳ 베타 보상 바깥 발급 0');
        const g0 = calls.grant.length;
        r = await call('POST', '/api/mall-beta/pub/spin', { mid: 'kim1' });
        await new Promise(res => setTimeout(res, 50));
        const bg = (await db.query(`SELECT status FROM reward_grants WHERE member_id=$1`, [bk.id])).rows;
        ok(r.s === 200 && r.j.result.key === 'coupon10', '베타 룰렛 돌아감(쿠폰 당첨)', r);
        ok(bg.length === 1 && bg[0].status === 'beta', '당첨 기록 = status \'beta\'(미지급 pending 목록·자동 발급에 안 잡힘)', bg);
        ok(calls.grant.length === g0 && calls.notify.length === 0, '쿠폰 발급(onRewardGrant)·텔레그램 0', { grant: calls.grant.length - g0, notify: calls.notify.length });
        ok(calls.audit.some(a => a.targetType === 'roulette_spin' && a.changes && a.changes.beta === true), '감사 기록에 beta:true');
        CFG.mall_beta_game_config = { probabilities: [{ key: 'w5', label: '물방울 5', points: 5, weight: 1 }], level_thresholds: [0, 10, 100] };
        r = await call('POST', '/api/mall-beta/pub/spin', { mid: 'kim1' });
        ok(r.s === 200 && r.j.result.key === 'w5', '베타 게임 설정(mall_beta_game_config) 있으면 그것 씀', r.j.result);
        r = await call('POST', '/api/mall/pub/spin', { mid: 'kim1' });
        ok(r.s === 200 && r.j.result.key === 'coupon10', '같은 때 실서비스는 mall_game_config 그대로', r.j.result);
        await new Promise(res => setTimeout(res, 50));
        const g1 = calls.grant.length;
        ok(g1 === g0 + 1, '실서비스 쿠폰 당첨은 종전대로 후처리 1회(베타만 막힘)', g1 - g0);

        console.log('Ⅴ 베타 게임 길');
        const kstJs = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
            await db.query(`SET TIME ZONE '${tz}'`);
            const d = (await db.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS d`)).rows[0].d;
            ok(d === kstJs, `DB 세션 시간대 ${tz} 에서도 SQL 오늘 = KST ${kstJs} (JS TZ=${process.env.TZ || '기본'})`, d);
        }
        await db.query(`SET TIME ZONE 'UTC'`);
        const yday = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
        await db.query(`INSERT INTO points_ledger (member_id, delta, balance_after, reason, ref_type, ref_id, idem_key) VALUES ($1, 0, $2, '게임 시작(catch)', 'game', 'aaaaaaaaaaaaaaaaaaaaaaaa', $3)`,
            [bk.id, await bal(bk.id), 'gamestart:' + bk.id + ':' + yday + ':1']);
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' });
        ok(r.s === 200 && r.j.ok === true && /^[a-f0-9]{24}$/.test(r.j.play_id) && r.j.left === 2 && r.j.max === 3, '시작 = play_id · left 2(어제 판은 안 셈 = 하루 경계)', r);
        const p1 = r.j.play_id;
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: p1, score: 999999 });
        ok(r.s === 400, '시작 뒤 5초 안 끝 = 거절', r);
        await db.query(`UPDATE points_ledger SET created_at = created_at - interval '10 seconds' WHERE ref_id=$1`, [p1]);
        const b0 = await bal(bk.id);
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: p1, score: 999999 });
        ok(r.s === 200 && r.j.ok && r.j.drops >= 1 && r.j.drops <= 3 && r.j.left === 2 && await bal(bk.id) === b0 + r.j.drops, '끝 = 물방울 1~3(점수 999999 여도 범위 안) · 잔액 그만큼', { r, b0 });
        const d1 = r.j.drops;
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: p1, score: 5 });
        ok(r.s === 200 && r.j.drops === d1 && r.j.replayed === true && await bal(bk.id) === b0 + d1, '같은 play_id 두 번 = 처음 결과 그대로 · 두 번 안 줌', r);
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', score: 1 });
        ok(r.s === 403, '시작 안 한 play_id = 거절', r.s);
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: 'nope', score: 1 }); ok(r.s === 400, '틀린 꼴 play_id = 400', r.s);
        CFG.mall_beta.members.push('park3');
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'park3', play_id: p1, score: 1 });
        ok(r.s === 403, '다른 회원 것 = 거절(이미 끝난 판도)', r.s);
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' }); const p2 = r.j.play_id;
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'park3', play_id: p2, score: 1 });
        ok(r.s === 403, '다른 회원의 안 끝난 판 = 거절', r.s);
        await db.query(`UPDATE points_ledger SET created_at = created_at - interval '31 minutes' WHERE ref_id=$1`, [p2]);
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: p2, score: 1 }); ok(r.s === 400, '30분 넘음 = 거절', r);
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' });
        ok(r.j.ok === true && r.j.left === 0, '셋째 판 시작 = left 0', r.j);
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' });
        ok(r.s === 200 && r.j.ok === false && r.j.reason === 'limit' && r.j.left === 0 && r.j.max === 3, '넷째 판 = {ok:false, reason:limit}', r.j);
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1'); ok(r.j.game && r.j.game.left === 0, 'wallet game.left 0', r.j.game);
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'Bad Name!' }); ok(r.s === 400, '게임 이름 꼴 틀림 = 400', r.s);
        CFG.mall_beta_game_config.game = { daily_max: 5, drops_min: 7, drops_max: 7 };
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' });
        ok(r.j.ok === true && r.j.max === 5 && r.j.left === 1, '설정 daily_max 5 로 바꾸면 따라감', r.j);
        await db.query(`UPDATE points_ledger SET created_at = created_at - interval '10 seconds' WHERE ref_id=$1`, [r.j.play_id]);
        r = await call('POST', '/api/mall-beta/pub/game-end', { mid: 'kim1', play_id: r.j.play_id, score: 0 });
        ok(r.j.drops === 7, '설정 drops 7~7 = 7', r.j);
        console.log('Ⅴ-c 게임 v2 기록(stage·stats) = 기록만 · 물방울 무변');
        CFG.mall_beta_game_config.game.daily_max = 9;
        const endWith = async (body) => { const s0 = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'kim1', game: 'catch' }); await db.query(`UPDATE points_ledger SET created_at = created_at - interval '10 seconds' WHERE ref_id=$1`, [s0.j.play_id]); return Object.assign(await call('POST', '/api/mall-beta/pub/game-end', Object.assign({ mid: 'kim1', play_id: s0.j.play_id }, body)), { pid: s0.j.play_id }); };
        r = await endWith({ score: 50, stage: 4, stats: { gold: 12, max_combo: 3.7, miss: -1, rot_tap: 'x', clears: 2, sec: 40, goal: 10, goal_hit: true, evil: '<script>', sec2: 1e12 } });
        const au = calls.audit.filter(a => a.targetType === 'mall_game_play' && a.changes && a.changes.play_id === r.pid).slice(-1)[0];
        const rs = (await db.query(`SELECT reason FROM points_ledger WHERE idem_key=$1`, ['gameend:' + r.pid])).rows[0].reason;
        ok(r.s === 200 && r.j.drops === 7 && au && au.changes.stage === 4 && JSON.stringify(au.changes.stats) === JSON.stringify({ gold: 12, max_combo: 3, clears: 2, sec: 40, goal: 10, goal_hit: 1 }) && rs === '게임 물방울(점수 50 · 단계 4)',
            'stage·stats 기록 = 숫자만 추림(음수·글자·모르는 칸 버림 · 참→1) · 원장 reason 에 단계 · 물방울 종전 계산', { drops: r.j.drops, au: au && au.changes, rs });
        r = await endWith({ score: 10, stage: 'abc', stats: 'nope' });
        const rs2 = (await db.query(`SELECT reason FROM points_ledger WHERE idem_key=$1`, ['gameend:' + r.pid])).rows[0].reason;
        ok(r.s === 200 && rs2 === '게임 물방울(점수 10)', '이상한 stage·stats = 버리고 통과(종전 reason 꼴)', { s: r.s, rs2 });
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1');
        ok(r.j.game && r.j.game.best_score === 50 && r.j.game.best_stage === 4 && r.j.game.best && r.j.game.best.catch && r.j.game.best.catch.score === 50 && 'left' in r.j.game, 'wallet game 에 best_score(50 · 999999 는 상한 5000 넘어 순위 표 밖)·best_stage(4)·best{catch}', r.j.game);
        const rr0 = await call('GET', '/api/mall/pub/wallet?mid=kim1'); ok(!('game' in rr0.j), '실서비스 wallet 은 여전히 game 칸 없음', Object.keys(rr0.j));
        const realGames = (await db.query(`SELECT COUNT(*)::int AS n FROM points_ledger WHERE member_id=$1 AND ref_type='game'`, [kim.id])).rows[0].n;
        ok(realGames === 0, '실회원 kim1 원장에 게임 줄 0', realGames);
        ok(calls.notify.length === 0 && calls.grant.length === g1, '끝까지 베타 알림·발급 0');

        console.log('Ⅴ-b 베타 설정 = 실서비스 위에 칸별 덮기');
        CFG.mall_game_config.level_thresholds = [0, 2, 120];
        CFG.mall_beta_game_config = { game: { daily_max: 5 } };
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1');
        ok(r.j.goal === 120 && r.j.game && r.j.game.max === 5, '베타 설정 {game:{daily_max:5}} 만 = level_thresholds 실서비스 값(목표 120) · 판 수 5', { goal: r.j.goal, game: r.j.game });
        r = await call('POST', '/api/mall-beta/pub/spin', { mid: 'kim1' });
        ok(r.s === 200 && r.j.result.key === 'coupon10', '확률표도 실서비스 값(쿠폰) 그대로', r.j);
        CFG.mall_beta_game_config = { level_thresholds: [0, 3, 150] };
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1'); const rr = await call('GET', '/api/mall/pub/wallet?mid=kim1');
        ok(r.j.goal === 150 && rr.j.goal === 120, '베타에 level_thresholds 있으면 그 칸만 베타 값 · 실서비스는 그대로', { beta: r.j.goal, real: rr.j.goal });
        CFG.mall_game_config.level_thresholds = [0, 2, 100];

        console.log('Ⅴ-d 게임 순위(#1138-b)');
        CFG.mall_beta_game_config = { game: { daily_max: 50 } };
        CFG.mall_beta.members.push('lee4', 'choi5');
        const playAs = async (mid, game, score, extra) => { const s0 = await call('POST', '/api/mall-beta/pub/game-start', { mid, game }); await db.query(`UPDATE points_ledger SET created_at = created_at - interval '10 seconds' WHERE ref_id=$1`, [s0.j.play_id]); return call('POST', '/api/mall-beta/pub/game-end', Object.assign({ mid, play_id: s0.j.play_id, score, stage: 3 }, extra || {})); };
        await playAs('kim1', 'gyul-pick', 300, { name: '전승범<>1!' });
        await new Promise(res => setTimeout(res, 20));
        await playAs('park3', 'gyul-pick', 300);
        const over = await playAs('lee4', 'gyul-pick', 6000, { name: '이몽룡' });
        await playAs('kim1', 'gyul-pack', 77);
        const pk = await row('beta:park3');
        await db.query(`INSERT INTO mall_game_scores (member_id, game, score, stage, play_id, created_at) VALUES ($1, 'gyul-pick', 900, 5, 'old-week-row', now() - interval '10 days')`, [pk.id]);
        r = await call('GET', '/api/mall-beta/pub/game-rank?mid=kim1&game=gyul-pick&period=week');
        ok(r.s === 200 && r.j.game === 'gyul-pick' && r.j.period === 'week' && r.j.top.length === 2 && r.j.top[0].name === '전*범' && r.j.top[0].me === true && r.j.top[1].name === 'pa***' && r.j.top[1].score === 300 && r.j.me.rank === 1,
            '주간 = 동점 300 은 먼저 낸 kim1 이 1위 · 이름 가림(전*범 · 이름 없음 = pa***) · 지난주 900 은 빠짐', r.j);
        ok(over.s === 200 && over.j.drops >= 1 && !r.j.top.some(x => x.score === 6000), '상한(5000) 넘은 6000 = 물방울은 주고 순위 표엔 안 들어감', { over: over.j, top: r.j.top });
        const txt = JSON.stringify(r.j);
        ok(!/beta:|kim1|park3|lee4/.test(txt), '응답에 아이디·member_key 전체 0', txt);
        r = await call('GET', '/api/mall-beta/pub/game-rank?mid=choi5&game=gyul-pick&period=all');
        ok(r.j.period === 'all' && r.j.top[0].score === 900 && r.j.top[0].name === 'pa***' && r.j.top.length === 2 && r.j.me.rank === null && r.j.me.score === 0, '전체 = 회원당 최고 1줄(park3 900) · 기록 없는 회원 me.rank null', r.j);
        r = await call('GET', '/api/mall-beta/pub/game-rank?mid=kim1&game=gyul-pack');
        ok(r.j.period === 'week' && r.j.top.length === 1 && r.j.top[0].score === 77, '게임별로 따로(gyul-pack) · period 없으면 week', r.j);
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=kim1');
        ok(r.j.game.best['gyul-pick'].score === 300 && r.j.game.best['gyul-pack'].score === 77 && r.j.game.best_score === 300, 'wallet game.best = 게임별 최고', r.j.game);
        ok((await row('beta:kim1')) && (await db.query(`SELECT nickname FROM mall_members WHERE member_key='beta:kim1'`)).rows[0].nickname === '전승범' && !(await db.query(`SELECT nickname FROM mall_members WHERE member_key='kim1'`)).rows[0].nickname, 'game-end name = 글자만 추려 베타 회원 nickname 저장 · 실회원 행 무변');
        r = await call('GET', '/api/mall/pub/game-rank?mid=kim1&game=gyul-pick'); ok(r.s === 503, '실서비스엔 순위 길 없음', r.s);

        console.log('Ⅴ-e 친구 초대 = 판 수 추가(#1139)');
        CFG.mall_beta_game_config = { game: { daily_max: 2 } };   /* 초대 기본값 = 초대한 사람 +2 · 친구 +1 · 하루 상한 3 · 주간 10 */
        CFG.mall_beta.members.push('jung6', 'han7', 'song8', 'yoon9', 'kang10');
        let c1 = await call('GET', '/api/mall-beta/pub/invite-code?mid=jung6'); const c2 = await call('GET', '/api/mall-beta/pub/invite-code?mid=jung6');
        const code = c1.j.code;
        ok(c1.s === 200 && /^[A-Z2-9]{8}$/.test(code) && c2.j.code === code && !/jung/i.test(JSON.stringify(c1.j)), '초대 코드 = 8자 · 두 번 불러도 같음 · 응답에 아이디 0', [c1.j, c2.j]);
        r = await call('POST', '/api/mall-beta/pub/invite-accept', { mid: 'jung6', code }); ok(r.j.ok === false && r.j.reason === 'self', '자기 코드 = 거절(self)', r.j);
        r = await call('POST', '/api/mall-beta/pub/invite-accept', { mid: 'han7', code: 'ZZZZZZZZ' }); ok(r.j.ok === false && r.j.reason === 'bad_code', '없는 코드 = bad_code', r.j);
        r = await call('POST', '/api/mall-beta/pub/invite-accept', { mid: 'han7', code: code.toLowerCase() }); ok(r.j.ok === true && r.j.state === 'accepted', '친구 han7 수락(소문자도) = accepted', r.j);
        const hanCode = (await call('GET', '/api/mall-beta/pub/invite-code?mid=han7')).j.code;
        const kangCode = (await call('GET', '/api/mall-beta/pub/invite-code?mid=kang10')).j.code;
        r = await call('POST', '/api/mall-beta/pub/invite-accept', { mid: 'han7', code: kangCode }); ok(r.j.ok === false && r.j.reason === 'already', '두 번째 수락 = 거절(already · 평생 1번)', r.j);
        r = await call('POST', '/api/mall-beta/pub/invite-accept', { mid: 'jung6', code: hanCode }); ok(r.j.ok === false && r.j.reason === 'mutual', '맞초대 = 거절(mutual)', r.j);
        r = await call('GET', '/api/mall-beta/pub/wallet?mid=jung6');
        ok(r.j.game.bonus === 0 && r.j.game.max === 2 && r.j.game.invite.done_today === 0 && r.j.game.invite.cap === 3, '친구가 게임 끝내기 전 = 미성립(추가 판 0)', r.j.game);
        r = await playAs('han7', 'gyul-pick', 10);
        ok(r.s === 200 && r.j.invite && r.j.invite.done === true && r.j.invite.plays === 1, '친구 첫 판 끝 = 성립 · 친구 +1', r.j);
        const hw = (await call('GET', '/api/mall-beta/pub/wallet?mid=han7')).j.game, jw = (await call('GET', '/api/mall-beta/pub/wallet?mid=jung6')).j.game;
        ok(hw.bonus === 1 && hw.max === 3 && hw.left === 2 && jw.bonus === 2 && jw.max === 4 && jw.left === 4 && jw.invite.done_today === 1, '성립 뒤 = 친구 max 3(남은 2) · 초대한 사람 max 4(남은 4)', { hw, jw });
        r = await playAs('han7', 'gyul-pick', 10); ok(r.s === 200 && !r.j.invite, '친구 둘째 판 = 다시 안 줌', r.j);
        for (const f of ['song8', 'yoon9']) { await call('POST', '/api/mall-beta/pub/invite-accept', { mid: f, code }); await playAs(f, 'gyul-pick', 10); }
        const jw2 = (await call('GET', '/api/mall-beta/pub/wallet?mid=jung6')).j.game;
        const ivs = (await db.query(`SELECT inviter_plays FROM mall_game_invites ORDER BY id`)).rows.map(x => x.inviter_plays);
        ok(jw2.bonus === 3 && jw2.max === 5 && jw2.invite.done_today === 3 && JSON.stringify(ivs) === '[2,1,0]', '하루 상한 3 = 2 → 1 → 0 판(성립 인원은 3 셈)', { jw2, ivs });
        r = await call('POST', '/api/mall-beta/pub/game-start', { mid: 'jung6', game: 'gyul-pick' }); ok(r.j.ok === true && r.j.max === 5 && r.j.left === 4, '초대한 사람 게임 시작 = max 5 · 남은 4', r.j);
        r = await call('GET', '/api/mall/pub/invite-code?mid=jung6'); ok(r.s === 503, '실서비스엔 초대 길 없음', r.s);
        ok((await db.query(`SELECT COUNT(*)::int AS n FROM points_ledger WHERE ref_type='invite_code' AND delta <> 0`)).rows[0].n === 0, '초대 코드 줄 = 물방울 0');

        console.log('Ⅵ server.js 실코드 = 공개 「오늘 당첨자」·관리자 당첨 지급 목록에 베타 0');
        const fs = require('fs');
        const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
        const cut = (a0, end) => { const a = S.indexOf(a0); if (a < 0) throw new Error('없음 ' + a0); const b = S.indexOf(end, a); if (b < 0) throw new Error('끝 없음 ' + end); return S.slice(a, b + end.length); };
        const winnersFn = new Function('pool', 'return (async () => { ' + cut('        const rank = `CASE WHEN s.result_key', 'LIMIT 2`);') + '\nreturn r.rows; })();');
        const listFn = new Function('pool', 'req', 'return (async () => { ' + cut("        const status = String(req.query.status || 'pending');", 'LIMIT 200`, params);') + '\nreturn r.rows; })();');
        const wins = await winnersFn(pool);
        const winKeys = [];
        for (const w of wins) winKeys.push((await db.query(`SELECT m.member_key FROM roulette_spins s JOIN mall_members m ON m.id=s.member_id WHERE s.created_at=$1`, [w.created_at])).rows.map(x => x.member_key).join(','));
        const allSpinsToday = (await db.query(`SELECT m.member_key, s.result_key FROM roulette_spins s JOIN mall_members m ON m.id=s.member_id`)).rows;
        ok(allSpinsToday.some(x => /^beta:/.test(x.member_key) && x.result_key === 'coupon10'), '오늘 베타 쿠폰 당첨 줄이 실제로 있음(시험 전제)');
        ok(wins.length >= 1 && winKeys.every(k => !/beta:/.test(k)), '공개 「오늘 당첨자」 = 실회원 것만 · 베타 0', { wins, winKeys });
        const lAll = await listFn(pool, { query: { status: 'all' } });
        const lPend = await listFn(pool, { query: {} });
        const lBeta = await listFn(pool, { query: { status: 'beta' } });
        ok(lAll.length >= 1 && lAll.every(g => g.status !== 'beta' && !/^beta:/.test(g.member_key)), '지급 목록 「전체」 = 베타 줄 0 · 실회원 줄은 보임', lAll.map(g => [g.status, g.member_key]));
        ok(lPend.every(g => g.status === 'pending'), '지급 목록 기본(pending) = 종전 그대로', lPend.map(g => g.status));
        ok(lBeta.length >= 1 && lBeta.every(g => g.status === 'beta'), '?status=beta 로 부를 때만 베타 줄', lBeta.length);
        const putFn = new Function('pool', 'req', 'return (async () => { ' + cut('        const cur = await pool.query(`SELECT g.*, m.member_key FROM reward_grants g JOIN mall_members m ON m.id=g.member_id WHERE g.id=$1`, [Number(req.params.id)]);', "        if (before.status === 'beta') throw { status: 409, message: '베타 시험 당첨 건은 상태를 바꿀 수 없습니다' };") + '\nreturn \'통과\'; })();');
        const bId = lBeta[0].id;
        let putErr = null; try { await putFn(pool, { params: { id: bId } }); } catch (e) { putErr = e; }
        const stAfter = (await db.query(`SELECT status FROM reward_grants WHERE id=$1`, [bId])).rows[0].status;
        ok(putErr && putErr.status === 409 && stAfter === 'beta', '지급 상태 PUT = 베타 줄은 409 · 상태 그대로', { putErr, stAfter });
        const rId = lPend[0].id;
        let putOk = null; try { putOk = await putFn(pool, { params: { id: rId } }); } catch (e) { putOk = e; }
        ok(putOk === '통과', '실회원 pending 줄은 막이 통과(종전대로 다음 단계로)', putOk);
    } finally { srv.close(); }
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

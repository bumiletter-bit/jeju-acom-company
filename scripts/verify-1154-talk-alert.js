// #1154 검증 — 톡톡봇 자동 송장 안내 줄의 텔레그램 알림(server.js talkPick·talkBlock·톡톡 알림 틱)
//   실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-1154-talk-alert.js
//   🔴 실DB·텔레그램 0 — server.js 의 「const TALKTALK_REQUEST_RE」 ~ 톡톡 알림 틱 끝(「}, 60 * 1000);」) 구간을 HEAD·지금 두 벌 떼어
//      setInterval 을 가로채 틱 함수만 손으로 돌린다 · DB = 메모리 pglite(message_logs) · naverCfgGet/Set = 메모리 · notifyTelegram = 기록만
//   ① invoice_auto = 🟩 「송장 안내함 · 톡톡 #줄 · n건」(손님 글·송장·번호 0) ② invoice_fail = 🟥 + 「→ 송장번호 보내 드리기」
//   ③ invoice_ask = 판정·글자 HEAD 그대로 · 30분 미룸 · 그 사이 목록·못 찾음 줄 → 버림 · 직원 답 → 버림 · 손님 답 없음 → 30분 뒤 종전 🟥
//   ④ response_source 없는 줄·옛 큐 = HEAD 와 보낸 글·SQL 글자·남은 큐 같음
'use strict';
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { PGlite } = require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite'));
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d !== undefined && !c ? ' — ' + JSON.stringify(d).slice(0, 700) : '')); };
const norm = s => s.replace(/\r\n/g, '\n');
function load(src, env) {
    const s = norm(src); const a = s.indexOf('const TALKTALK_REQUEST_RE'); const b0 = s.indexOf('let _ttReqBusy', a); const b = s.indexOf('}, 60 * 1000);', b0) + '}, 60 * 1000);'.length;
    let tick = null;
    const fn = new Function('notifyTelegram', 'naverCfgGet', 'naverCfgSet', 'pool', 'alertQuietFor', 'setInterval', s.slice(a, b) + '\nreturn { talkPick, talkBlock };');
    const r = fn(env.notifyTelegram, env.naverCfgGet, env.naverCfgSet, env.pool, env.alertQuietFor, f => { tick = f; return {}; });
    return Object.assign(r, { tick: () => tick() });
}
async function mkEnv(db) {
    const cfg = {}, tg = [], sqls = [];
    const pool = { query: async (sql, p) => { sqls.push(sql.replace(/\s+/g, ' ')); const r = await db.query(sql, p || []); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; } };
    return { cfg, tg, sqls, pool, notifyTelegram: async (t) => { tg.push(t); return 'sent'; }, naverCfgGet: async k => cfg[k] == null ? null : JSON.parse(JSON.stringify(cfg[k])), naverCfgSet: async (k, v) => { cfg[k] = JSON.parse(JSON.stringify(v)); }, alertQuietFor: async () => false };
}
async function mkDb() {
    const db = new PGlite();
    await db.query(`CREATE TABLE message_logs (id SERIAL PRIMARY KEY, user_id TEXT, item TEXT, message TEXT, answered BOOLEAN DEFAULT false, bot_response TEXT, staff_response TEXT, received_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'), staff_at TIMESTAMPTZ, scenario_name TEXT, response_source TEXT, scenario_nos TEXT)`);
    return db;
}
const ASK = '안녕하세요 고객님 제주아꼼이네입니다 🍊\n송장번호 안내를 위해 주문하실 때 넣으신 주문자 연락처와 받는 분 성함(한 분)을 남겨 주세요 😊\n확인되면 바로 보내드릴게요.';
const FAIL = '말씀해 주신 정보로는 최근 발송 기록을 바로 찾지 못했어요 😢\n담당자가 확인해서 톡톡으로 보내드리겠습니다.';
const LIST = '요청하신 송장번호 안내드려요 😊\n택배사: CJ대한통운\n11/13 발송 · 홍*동님 · 6012-3456-7801\n배송조회는 CJ대한통운 홈페이지·앱에서 송장번호로 확인하실 수 있어요.';

(async () => {
    const headSrc = execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
    const curSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const realNow = Date.now; let NOW = realNow(); Date.now = () => NOW;
    const ins = (db, u, msg, br, src, name, ans) => db.query(`INSERT INTO message_logs (user_id, item, message, answered, bot_response, response_source, scenario_name) VALUES ($1, '기타', $2, $3, $4, $5, $6) RETURNING id`, [u, msg, ans !== false, br, src || null, name || null]).then(r => r.rows[0].id);

    console.log('① ② 판정·글자');
    { const e = await mkEnv(await mkDb()); const N = load(curSrc, e), H = load(headSrc, e);
      const rA = { id: 12, user_id: 'u1', message: '010-1111-2222 홍길동입니다', bot_response: LIST, response_source: 'invoice_auto', scenario_name: '송장 자동 안내(2건)', item: '기타' };
      const pA = N.talkPick(rA), tA = N.talkBlock('톡톡', pA, rA.message, rA.bot_response, { id: 12, at: '11/14 10:00', item: '기타' });
      ok(pA && pA.mode === 'inv_ok' && pA.n === 2, 'invoice_auto = inv_ok · 2건', pA);
      ok(tA === '🟩 <b>송장 안내함</b> · 톡톡 #12 · 2건\n11/14 10:00', '🟩 글 = 「송장 안내함 · 톡톡 #12 · 2건」 + 시각 한 줄', tA);
      ok(!/010|1111|6012|홍/.test(tA), '🟩 글에 손님 번호·송장·성함 0');
      ok(N.talkPick(Object.assign({}, rA, { staff_response: '직원 답' })) === null, 'invoice_auto 줄에 직원 답 = 안 보냄(종전 가드 먼저)');
      const rF = { id: 13, user_id: 'u3', message: '010-1111-2222 홍길순', bot_response: FAIL, response_source: 'invoice_fail', scenario_name: '송장 못 찾음(name)' };
      const pF = N.talkPick(rF), tF = N.talkBlock('톡톡', pF, rF.message, rF.bot_response, { id: 13, at: '11/14 10:01', item: '기타' });
      ok(pF && pF.mode === 'staff' && pF.botLine === true && pF.inv === true, 'invoice_fail = 🟥 확인 필요(봇 답함) · inv', pF);
      ok(/^🟥 <b>확인 필요<\/b> · 톡톡\(봇 답함 · 처리 필요\)\n톡톡 #13 · 11\/14 10:01\n\n<b>손님:<\/b> 010-1111-2222 홍길순\n\n<b>봇:<\/b> 말씀해 주신/.test(tF) && /<b>→ 송장번호 보내 드리기<\/b>$/.test(tF), 'invoice_fail 글 = 🟥 + 손님·봇 줄 + 꼬리 「→ 송장번호 보내 드리기」', tF);
      const rK = { id: 14, user_id: 'u2', message: '송장번호 알려주세요', bot_response: ASK, response_source: 'invoice_ask', scenario_name: '송장 되묻기' };
      ok(JSON.stringify(N.talkPick(rK)) === JSON.stringify(H.talkPick(rK)) && N.talkBlock('톡톡', N.talkPick(rK), rK.message, rK.bot_response) === H.talkBlock('톡톡', H.talkPick(rK), rK.message, rK.bot_response), 'invoice_ask 판정·글자 = HEAD 그대로', [N.talkPick(rK), H.talkPick(rK)]);
      const C = [['송장번호 알려주세요', '네 확인 후 보내드릴게요'], ['귤 언제와요?', '[SKIP-무응답]'], ['주문 취소 가능할까요', '확인 후 도와드리겠습니다'], ['송장번호 알려주세요', '[1회응대-무응답]'], ['13과로 보내 주세요', '네'], ['고마워요', '감사합니다'], ['개별 송장 부탁', '[쿨다운-무응답]']];
      for (const src of [undefined, null, 'ai', 'price_direct']) ok(C.every(([m, b]) => { const x = { id: 1, user_id: 'u', message: m, bot_response: b, response_source: src, scenario_name: 'x(3건)' }; return JSON.stringify(N.talkPick(x)) === JSON.stringify(H.talkPick(x)); }), `response_source ${src} 줄 = HEAD 판정 그대로(7개)`);
    }

    console.log('③ 틱 — 되묻기 30분 미룸');
    { const db = await mkDb(); const e = await mkEnv(db); const N = load(curSrc, e);
      e.cfg.talktalk_request_state = { last_id: 0, queue: [] };
      const a1 = await ins(db, 'u1', '송장번호 알려주세요', ASK, 'invoice_ask', '송장 되묻기');
      const a2 = await ins(db, 'u2', '송장번호 알려주세요', ASK, 'invoice_ask', '송장 되묻기');
      const a3 = await ins(db, 'u3', '개별 송장 부탁드려요', ASK, 'invoice_ask', '송장 되묻기');
      const a4 = await ins(db, 'u4', '송장번호 알려주세요', ASK, 'invoice_ask', '송장 되묻기');
      await N.tick();
      ok(e.tg.length === 0 && e.cfg.talktalk_request_state.queue.length === 4 && e.cfg.talktalk_request_state.queue.every(m => m.ask === 1 && m.due === NOW + 1800000), '되묻기 4줄 = 바로 안 보냄 · 큐에 30분 뒤 때(due)로', e.cfg.talktalk_request_state.queue.map(m => [m.id, m.ask, m.due - NOW]));
      const l1 = await ins(db, 'u1', '010-1111-2222 홍길동', LIST, 'invoice_auto', '송장 자동 안내(1건)');
      const f3 = await ins(db, 'u3', '010-1111-2222 홍길순', FAIL, 'invoice_fail', '송장 못 찾음(name)');
      await db.query(`UPDATE message_logs SET staff_response = '직원이 보냈어요' WHERE id = $1`, [a4]);
      await ins(db, 'u2', '아 그리고 주소를 바꿔 주세요', '[쿨다운-무응답]', null, null, false);   // #1154-b 되묻기 뒤 무관한 글 = 봇은 종전 흐름(쿨다운 줄) · invoice_fail 줄 없음 → 30분 뒤 되묻기 🟥 가 그대로 나가야 함
      NOW += 60000; await N.tick();
      ok(e.tg.length === 2 && /^🟩 <b>송장 안내함<\/b> · 톡톡 #/.test(e.tg[0]) && /^🟥 <b>확인 필요<\/b>/.test(e.tg[1]) && /송장번호 보내 드리기/.test(e.tg[1]), '1분 뒤 = 🟩(u1 목록) · 🟥(u3 못 찾음) 두 통 · 되묻기 알림은 아직', e.tg);
      ok(e.cfg.talktalk_request_state.queue.length === 4 && e.cfg.talktalk_request_state.queue.every(m => m.ask === 1), '때 안 된 되묻기 4개는 큐에 그대로(뒤에 되붙음)', e.cfg.talktalk_request_state.queue.map(m => m.id));
      NOW += 30 * 60000; e.tg.length = 0; await N.tick();
      const H = load(headSrc, await mkEnv(db)); const want = H.talkBlock('톡톡', H.talkPick({ message: '송장번호 알려주세요', bot_response: ASK }), '송장번호 알려주세요', ASK, { id: a2, at: (await db.query(`SELECT to_char(received_at + interval '9 hours', 'FMMM/FMDD HH24:MI') AS t FROM message_logs WHERE id = $1`, [a2])).rows[0].t, item: '기타' });
      ok(e.tg.length === 1 && e.tg[0] === want, '31분 뒤 = 손님 답 없음·무관한 글(쿨다운 줄)만 있는 u2 만 종전 🟥 글자 그대로 · u1(목록)·u3(못 찾음)·u4(직원 답) 되묻기 알림은 버림', e.tg);
      ok(e.cfg.talktalk_request_state.queue.length === 0, '큐 비움', e.cfg.talktalk_request_state.queue);
      void l1; void f3; void a1; void a3;
    }

    console.log('④ response_source 없는 줄 · 옛 큐 = HEAD 와 같음');
    { const run = async (src) => {
        const db = await mkDb(); const e = await mkEnv(db); const X = load(src, e); NOW = 1800000000000;
        e.cfg.talktalk_request_state = { last_id: 0, queue: ['옛 글자 알림 <b>', { h: '🟥 옛 객체', id: 999, uid: 'zz' }] };
        await ins(db, 'v1', '송장번호 알려주세요', '네 확인 후 톡톡으로 보내드릴게요');
        await ins(db, 'v2', '귤 언제와요?', '[SKIP-무응답]', null, null, false);
        await ins(db, 'v3', '주문 취소 가능할까요', '확인 후 도와드리겠습니다', 'ai', '취소(1건)');
        await ins(db, 'v4', '고마워요', '감사합니다', 'ai');
        await ins(db, 'v5', '13과로 보내 주세요', '네 그렇게 보내드릴게요', 'price_direct');
        await X.tick(); NOW += 60000; await X.tick();
        return { tg: e.tg, sql: e.sqls.filter(q => !/^INSERT|^CREATE/.test(q)), q: e.cfg.talktalk_request_state };
      };
      const h = await run(headSrc), n = await run(curSrc);
      const unSel = s => s.map(q => q.replace(' response_source, scenario_name,', ''));
      ok(JSON.stringify(h.tg) === JSON.stringify(n.tg) && h.tg.length >= 4, '보낸 알림 글 = HEAD 와 바이트 같음', [h.tg.length, n.tg.length]);
      ok(JSON.stringify(unSel(h.sql)) === JSON.stringify(unSel(n.sql)), 'SQL 글자 = HEAD 와 같음(새 SELECT 두 칸 뺀 나머지 · 되묻기 없는 틱의 직원 답 확인 SQL 그대로)', [h.sql, n.sql]);
      const noAt = q => JSON.stringify(Object.assign({}, q, { last_alert: q.last_alert ? Object.assign({}, q.last_alert, { at: 0 }) : q.last_alert }));   // at = 실제 시계(new Date()) 라 뺌
      ok(noAt(h.q) === noAt(n.q), '남은 큐·last_id·last_alert 꼴 같음(시각 칸 뺌)', [h.q, n.q]);
    }
    Date.now = realNow;
    console.log(`\n합계 ✅ ${pass} · ❌ ${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

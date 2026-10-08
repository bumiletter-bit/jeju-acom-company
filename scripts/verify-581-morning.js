// #581 아침 정리(자동 지시) 검증 — server.js 의 「#581 아침 정리」 구간을 떼어 실행. 틱 논리는 쓰기 가로채기 · 실제 등록은 [검증469] 머리말로 실DB 에 1건 넣고 즉시 숨김·종결.
//   node scripts/verify-581-morning.js
const path = require('path'); const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { pool } = require('./desk/_db.js');
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m); };
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (from, to) => { const a = SRC.indexOf(from); if (a < 0) throw new Error('표식 없음: ' + from); const b = SRC.indexOf(to, a + from.length); if (b < 0) throw new Error('끝 표식 없음: ' + to); return SRC.slice(a, b); };
const BLOCK = cut('// ===== #581 아침 정리 — 시작', '// ===== #581 아침 정리 — 끝');
const mk = (poolX, store, audits, engine) => new Function('pool', 'naverCfgGet', 'naverCfgSet', 'writeAudit', 'aoEngine', 'setInterval', 'console',
    BLOCK + '\nreturn { deskMorningCfg, deskMorningOwner, deskMorningCreate, deskMorningTick, DESK_MORNING_TEXT };')(
    poolX, async k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null), async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, async a => { audits.push(a); }, async () => engine || 'desk', () => ({}), { log() { }, error(...a) { console.log('     (오류 로그)', ...a); } });
const guard = (writes) => ({ query: async (sql, p) => { const s = String(sql).trim(); if (/^SELECT\b/i.test(s)) return pool.query(sql, p); writes.push(s.replace(/\s+/g, ' ')); return { rows: [{ id: 999999 }], rowCount: 1 }; } });
const AT = (h, m, dayShift = 0) => Date.UTC(2026, 9, 8 + dayShift, h - 9, m);   // KST 2026-10-08 h:m

(async () => {
    console.log('A. 설정 읽기');
    { const M = mk(guard([]), {}, []);
        const d = M.deskMorningCfg(null);
        ok(d.enabled === true && d.time === '07:40' && d.user_id === null, '설정 없음 = 켜짐 · 07:40 · 대표 계정 자동');
        ok(M.deskMorningCfg({ enabled: false }).enabled === false && M.deskMorningCfg({ enabled: 'false' }).enabled === true, 'enabled 는 불리언 false 일 때만 꺼짐');
        ok(M.deskMorningCfg({ time: '08:15' }).time === '08:15' && M.deskMorningCfg({ time: '8:15' }).time === '07:40' && M.deskMorningCfg({ time: '25:00' }).time === '07:40', '시각은 HH:MM 꼴만(아니면 07:40)');
        ok(M.deskMorningCfg({ user_id: 7 }).user_id === 7 && M.deskMorningCfg({ user_id: '7' }).user_id === null && M.deskMorningCfg({ user_id: 0 }).user_id === null, 'user_id 는 양의 정수만');
        const o = await M.deskMorningOwner(d);
        ok(o && o.position === '대표' && o.id > 0, `대표 계정 자동 선택(id ${o && o.id} · ${o && o.position})`);
        ok(/^\[아침 정리\] /.test(M.DESK_MORNING_TEXT) && /보내줘/.test(M.DESK_MORNING_TEXT) && !/\[검증469\]/.test(M.DESK_MORNING_TEXT), '지시 글 = 「[아침 정리] …」 · 「보내줘」 안내 포함');
    }
    console.log('B. 틱 논리(쓰기 가로채기 · 실DB 쓰기 0)');
    {   // 첫 가동 날 — 넣지 않고 기준일만
        const writes = [], store = {}, audits = []; const M = mk(guard(writes), store, audits);
        ok((await M.deskMorningTick(AT(7, 39))) === null && !store.desk_morning_last, '07:40 전에는 아무것도 안 함');
        const r = await M.deskMorningTick(AT(7, 40));
        ok(r && r.skipped === 'first_run' && store.desk_morning_last.date === '2026-10-08' && writes.length === 0, '첫 가동 날(기록 없음) = 등록하지 않고 기준일만(배포 직후 낮에 안 뜨게)');
        ok((await M.deskMorningTick(AT(7, 41))) === null && (await M.deskMorningTick(AT(12, 0))) === null && writes.length === 0, '같은 날 다시 틱 → 아무것도 안 함');
    }
    {   // 다음 날 — 등록 1건 · 같은 날 두 번 없음 · 재시작 뒤에도 두 번 없음
        const writes = [], store = { desk_morning_last: { date: '2026-10-07', id: 1 } }, audits = []; const M = mk(guard(writes), store, audits);
        ok((await M.deskMorningTick(AT(7, 39))) === null && writes.length === 0, '07:39 → 아직');
        const r = await M.deskMorningTick(AT(7, 40));
        ok(r && r.ok && r.id === 999999 && writes.length === 1 && /^INSERT INTO pending_orders \(content, status, created_by, created_by_id, mine_hidden\) VALUES/.test(writes[0]), '07:40 → pending_orders 에 INSERT 1건(대기)');
        ok(store.desk_morning_last.date === '2026-10-08' && store.desk_morning_last.id === 999999, 'desk_morning_last 에 날짜·지시 번호');
        ok(audits.length === 1 && audits[0].source === 'desk_morning' && audits[0].changes.after.kind === 'morning' && audits[0].changes.after.test === false, '감사 기록 1건(source desk_morning)');
        for (let i = 41; i < 50; i++) await M.deskMorningTick(AT(7, i));
        ok(writes.length === 1, '같은 날 9번 더 틱 → 등록은 1건 그대로');
        const M2 = mk(guard(writes), store, audits);   // 재시작(메모리 초기화) — DB 기록으로 막힘
        await M2.deskMorningTick(AT(9, 0));
        ok(writes.length === 1, '재시작 뒤 같은 날 → DB 기록(desk_morning_last)으로 두 번 넣지 않음');
        const r3 = await M2.deskMorningTick(AT(7, 40, 1));
        ok(r3 && r3.ok && writes.length === 2 && store.desk_morning_last.date === '2026-10-09', '다음 날 07:40 → 다시 1건');
    }
    {   // 꺼짐 · 시각 바꿈 · 엔진 api
        const writes = [], store = { desk_morning: { enabled: false }, desk_morning_last: { date: '2026-10-07' } }; const M = mk(guard(writes), store, []);
        const r = await M.deskMorningTick(AT(7, 40));
        ok(r && r.skipped === 'disabled' && writes.length === 0 && store.desk_morning_last.date === '2026-10-08', 'enabled:false → 등록 0 · 날짜만 기록');
        const writes2 = [], store2 = { desk_morning: { time: '09:10' }, desk_morning_last: { date: '2026-10-07' } }; const M2 = mk(guard(writes2), store2, []);
        ok((await M2.deskMorningTick(AT(9, 9))) === null && writes2.length === 0 && (await M2.deskMorningTick(AT(9, 10))).ok && writes2.length === 1, '시각을 09:10 으로 바꾸면 그때 등록');
        const writes3 = [], store3 = { desk_morning_last: { date: '2026-10-07' } }; const M3 = mk(guard(writes3), store3, [], 'api');
        const r3 = await M3.deskMorningTick(AT(7, 40));
        ok(r3 && r3.ok === false && r3.why === 'engine_api' && writes3.length === 0 && store3.desk_morning_last.why === 'engine_api', '엔진이 api 면 넣지 않음(이유 기록)');
        const writes4 = [], store4 = { desk_morning: { user_id: 999999 }, desk_morning_last: { date: '2026-10-07' } }; const M4 = mk(guard(writes4), store4, []);
        const r4 = await M4.deskMorningTick(AT(7, 40));
        ok(r4 && r4.ok === false && r4.why === 'owner_missing' && writes4.length === 0, '없는 user_id 를 적으면 넣지 않음(이유 owner_missing)');
    }
    console.log('C. 실DB 에 시험 등록 1건([검증469] 머리말 · mine_hidden · 즉시 종결)');
    {
        const audits = []; const M = mk(pool, {}, audits);
        const r = await M.deskMorningCreate({ test: true });
        ok(r.ok && r.id > 0, `등록됨 #${r.id}`);
        const row = (await pool.query(`SELECT content, status, created_by, created_by_id, mine_hidden FROM pending_orders WHERE id = $1`, [r.id])).rows[0];
        ok(row && row.content === '[검증469] ' + M.DESK_MORNING_TEXT && row.status === '대기' && row.mine_hidden === true, '시험 행 = [검증469] 머리말 · 대기 · 숨김');
        const u = (await pool.query(`SELECT name, position, role FROM users WHERE id = $1`, [row.created_by_id])).rows[0];
        ok(u && u.role === 'admin' && u.position === '대표' && row.created_by === `${u.name} ${u.position}`, `created_by = 대표 계정 이름+직함(from_role admin 으로 내려감)`);
        ok(audits.length === 1 && audits[0].changes.after.test === true, '감사 기록(test:true)');
        // 대기 프로그램이 집지 않게 즉시 종결(시험 행은 launcher 가 [검증469] 를 건너뛰지만 안전하게)
        await pool.query(`UPDATE pending_orders SET status = '완료', processed_at = NOW(), is_deleted = true WHERE id = $1 AND content LIKE '[검증469]%'`, [r.id]);
        const st = (await pool.query(`SELECT status, is_deleted FROM pending_orders WHERE id = $1`, [r.id])).rows[0];
        ok(st.status === '완료' && st.is_deleted === true, '시험 행 종결·삭제 표시');
        const real = (await pool.query(`SELECT count(*)::int n FROM pending_orders WHERE content = $1 AND created_at > NOW() - interval '10 minutes'`, [M.DESK_MORNING_TEXT])).rows[0].n;
        ok(real === 0, '실제 「[아침 정리]」 지시는 만들어지지 않음(검증은 시험 머리말만)');
    }
    console.log('D. 창구 규칙 문서');
    {
        const know = fs.readFileSync(path.join(ROOT, '★에이전트오피스', '업무지식.md'), 'utf8');
        const rule = fs.readFileSync(path.join(ROOT, '★에이전트오피스', 'CLAUDE.md'), 'utf8');
        ok(/아침 정리/.test(know) && /talk-pending\.js/.test(know) && /answered IS NOT TRUE AND posted_at IS NULL/i.test(know.replace(/\s+/g, ' ')), '업무지식.md 에 「아침 정리」 절(톡톡 뽑기 + 문의 기준)');
        ok(/\[아침 정리\]/.test(rule), '창구 CLAUDE.md 4-1 표에 [아침 정리] 한 줄');
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    await pool.end();
    process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.stack || e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

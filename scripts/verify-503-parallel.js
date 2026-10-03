// #503 검증: 창구 대기 프로그램 동시 처리(PARALLEL · 기본 4) — 사람별 차례 · 중간발주(바로 처리)는 한 번에 하나 · heartbeat/desk_launcher 상태
//   사용: node scripts/verify-503-parallel.js            (①동시 4 · ②DESK_PARALLEL=1 · ③상태 · ④코드 검토 · ⑤메모리)
//        node scripts/verify-503-parallel.js quick      (①만)
//   🔴 실DB에 [검증469] 시험 지시를 만들고 launcher.js --once --ids --sub(대표 요금제)로 실제 창구를 돌린다(AI 호출 있음 · 중간발주 2건은 실서버 러너 사용) → 끝에 전부 숨김.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { Client } = require('pg');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUICK = process.argv[2] === 'quick';
const LAUNCHER = fs.readFileSync(path.join(ROOT, 'scripts', 'desk', 'launcher.js'), 'utf8');

function claudeRss() {   // claude.exe 전체 작업 집합(MB) · 개수 — 참고용(다른 창의 claude도 포함되므로 차이로 본다)
    try {
        const out = execSync('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH', { encoding: 'utf8' });
        const rows = out.trim().split(/\r?\n/).filter(l => l.includes('claude.exe')).map(l => parseInt(l.split('","')[4].replace(/[^0-9]/g, ''), 10) || 0);
        return { n: rows.length, mb: Math.round(rows.reduce((a, b) => a + b, 0) / 1024) };
    } catch (e) { return { n: -1, mb: -1 }; }
}

async function makeOrders(db, users, spec) {   // spec = [{u:0|1, content}] → ids
    const ids = [];
    for (const s of spec) {
        const u = users[s.u];
        const r = await db.query(`INSERT INTO pending_orders (content, status, created_by, created_by_id) VALUES ($1, '대기', $2, $3) RETURNING id`, [s.content, u.name, u.id]);
        ids.push(r.rows[0].id);
    }
    return ids;
}
async function closeOrders(db, ids) {
    if (!ids.length) return;
    await db.query(`UPDATE pending_orders SET is_deleted = true WHERE id = ANY($1::int[])`, [ids]);
    await db.query(`UPDATE pending_orders SET status = '취소' WHERE id = ANY($1::int[]) AND status IN ('대기', '처리중', '승인됨')`, [ids]);
    await db.query(`UPDATE agent_runs SET is_deleted = true WHERE id IN (SELECT run_id FROM pending_orders WHERE id = ANY($1::int[]) AND run_id IS NOT NULL)`, [ids]);
    await db.query(`UPDATE report_files SET is_deleted = true WHERE run_id IN (SELECT run_id FROM pending_orders WHERE id = ANY($1::int[]) AND run_id IS NOT NULL)`, [ids]);
}

// launcher 를 돌리며 1초마다 상태를 기록한다
async function runLauncher(db, ids, parallel, label) {
    const env = { ...process.env, DESK_PARALLEL: String(parallel) };
    delete env.ANTHROPIC_API_KEY;
    const logPath = path.join(os.tmpdir(), `v503-${label}.log`);
    const child = spawn(process.execPath, ['scripts/desk/launcher.js', '--once', '--ids', ids.join(','), '--sub'], { cwd: ROOT, env, stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath + '.err', 'w')], windowsHide: true });
    const samples = []; const t0 = Date.now(); let done = false, exit = null;
    child.on('exit', c => { done = true; exit = c; });
    const base = claudeRss();
    while (!done && Date.now() - t0 < 25 * 60 * 1000) {
        try {
            const st = (await db.query(`SELECT id, status, created_by_id FROM pending_orders WHERE id = ANY($1::int[]) ORDER BY id`, [ids])).rows;
            const cfg = (await db.query(`SELECT key, value FROM agent_office_config WHERE key IN ('desk_heartbeat', 'desk_launcher')`)).rows;
            const hb = (cfg.find(x => x.key === 'desk_heartbeat') || {}).value || {}, ln = (cfg.find(x => x.key === 'desk_launcher') || {}).value || {};
            const rss = claudeRss();
            samples.push({ t: Math.round((Date.now() - t0) / 1000), st: st.map(x => [x.id, x.status, x.created_by_id]), newState: Array.isArray(ln.running), running: Array.isArray(ln.running) ? ln.running : [], hb: { state: hb.state, order_id: hb.order_id }, parallel: ln.parallel, busy: ln.busy, rss: { n: rss.n - base.n, mb: rss.mb - base.mb } });
        } catch (e) { /* 다음 샘플 */ }
        await sleep(1000);
    }
    if (!done) { try { child.kill(); } catch (_) { } }
    const out = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    let last = null; try { last = JSON.parse(out.trim().split('\n').pop()); } catch (_) { }
    return { samples, exit, last, out, err: fs.existsSync(logPath + '.err') ? fs.readFileSync(logPath + '.err', 'utf8') : '', sec: Math.round((Date.now() - t0) / 1000) };
}
// 표본에서 「처리중」 구간을 지시별로 뽑고 겹침을 계산
function analyze(run, ids, userOf, directIds) {
    const span = {};
    for (const s of run.samples) for (const [id, status] of s.st) if (status === '처리중') { span[id] = span[id] || { a: s.t, b: s.t }; span[id].b = s.t; }
    const overlap = (x, y) => span[x] && span[y] && span[x].a <= span[y].b && span[y].a <= span[x].b;
    const maxConc = Math.max(0, ...run.samples.map(s => s.st.filter(x => x[1] === '처리중').length));
    const maxRunning = Math.max(0, ...run.samples.map(s => s.running.length));
    const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (overlap(ids[i], ids[j])) pairs.push([ids[i], ids[j]]);
    const sameUser = pairs.filter(([x, y]) => userOf[x] === userOf[y]);
    const bothDirect = pairs.filter(([x, y]) => directIds.includes(x) && directIds.includes(y));
    const cross = pairs.filter(([x, y]) => userOf[x] !== userOf[y]);
    return { span, maxConc, maxRunning, pairs, sameUser, bothDirect, cross };
}

(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    const made = [];
    try {
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const other = (await db.query(`SELECT id, name FROM users WHERE role = 'admin' AND deleted_at IS NULL AND id <> $1 ORDER BY id LIMIT 1`, [ceo.id])).rows[0]
            || (await db.query(`SELECT id, name FROM users WHERE deleted_at IS NULL AND id <> $1 ORDER BY id LIMIT 1`, [ceo.id])).rows[0];
        const users = [{ id: ceo.id, name: '시험503-' + ceo.name }, { id: other.id, name: '시험503-' + other.name }];
        info(`시험 계정 2명 = id ${ceo.id} · ${other.id} (이름은 지시 created_by 에만 「시험503-」 접두)`);
        const hbBefore = (await db.query(`SELECT value FROM agent_office_config WHERE key='desk_launcher'`)).rows[0];
        if (hbBefore && hbBefore.value && hbBefore.value.on) info('⚠️ 실서버 대기 프로그램이 켜져 있음(host ' + hbBefore.value.host + ') — [검증469] 지시는 집지 않으므로 무관 · heartbeat는 서로 덮어쓸 수 있음');

        // ── ④ 코드 검토(실행 전)
        console.log('\n── ④ 코드 검토');
        ok('PARALLEL = DESK_PARALLEL 환경값(1~8) · 기본 4', /const PARALLEL = Math\.max\(1, Math\.min\(8, parseInt\(process\.env\.DESK_PARALLEL, 10\) \|\| 4\)\)/.test(LAUNCHER));
        ok('nextOrder: 돌고 있는 지시 · 돌고 있는 사람 · 바로 처리 중일 때 다른 바로 처리 = 건너뜀(blocked)', /st\.running\.has\(o\.id\)/.test(LAUNCHER) && /busyUsers\.has\(Number\(o\.created_by_id\)\)/.test(LAUNCHER) && /st\.directBusy && [^\n]*lane === 'direct_qty'/.test(LAUNCHER) && /for \(const o of r\.rows\) if \(!blocked\(o\)\) return o;/.test(LAUNCHER));
        ok('tick: 자리(running < PARALLEL)가 있으면 기다리지 않고 다음 건(상주·--ids 는 await 안 함)', /if \(st\.running\.size >= PARALLEL\) return false;/.test(LAUNCHER) && /if \(mode && !st\.multi\) await p;/.test(LAUNCHER));
        ok('handle: 실패해도 running에서 빠지고(heartbeat 갱신) · tick의 handle 호출에 catch + finally(directBusy 해제) · runDesk는 try/finally(keepalive 정리)', /st\.running\.delete\(order\.id\);\s*\n\s*if \(st\.running\.size\) await heartbeat\('busy', firstRunning\(\)\); else await heartbeat\('idle'\);/.test(LAUNCHER) && /handle\(o, [^\n]*\)\.catch\(e => log\([^\n]*\)\.finally\(\(\) => \{ if \(direct\) st\.directBusy = false; \}\)/.test(LAUNCHER) && /\} catch \(e\) \{ log\(`#\$\{order\.id\} 처리 중 오류: \$\{e\.message\}`\); \}\s*\n\s*finally \{ clearInterval\(keep\); \}/.test(LAUNCHER));
        ok('heartbeat = 가장 먼저 시작한 건(firstRunning) · desk_launcher 에 running[]·parallel', /const firstRunning = \(\) => \{ const it = st\.running\.keys\(\)\.next\(\)/.test(LAUNCHER) && /heartbeat\('busy', firstRunning\(\) \|\| order\.id\)/.test(LAUNCHER) && /running: \[\.\.\.st\.running\.keys\(\)\], parallel: PARALLEL/.test(LAUNCHER));
        ok('--ids: 같은 규칙으로 자리 날 때 띄우고 전부 끝나길 기다림', /while \(left\.length && Date\.now\(\) - t0 < RUN_TIMEOUT_MS\)/.test(LAUNCHER) && /while \(st\.running\.size\) await new Promise/.test(LAUNCHER));

        // ── ① 동시 4: 사람 2명 × 2건 + 중간발주 2건
        console.log('\n── ① 동시 처리(DESK_PARALLEL=4 · 사람 2명 × 보고 2건 + 중간발주 2건)');
        const spec1 = [
            { u: 0, content: '[검증469] 판매현황에서 지금 판매중인 품목이 몇 개인지 알려줘 — 보고만, 아무것도 바꾸지 말 것' },
            { u: 0, content: '[검증469] 오늘이 발송휴무일인지 달력에서 확인해서 알려줘 — 보고만' },
            { u: 1, content: '[검증469] 이번 주 단가표에 등록된 거래처가 몇 곳인지 알려줘 — 보고만' },
            { u: 1, content: '[검증469] 룰렛 미지급 당첨이 있는지 알려줘 — 보고만' },
            { u: 0, content: '[검증469] 중간발주 뽑아줘' },
            { u: 1, content: '[검증469] 중간발주 뽑아줘' },
        ];
        const ids1 = await makeOrders(db, users, spec1); made.push(...ids1);
        const userOf1 = Object.fromEntries(ids1.map((id, i) => [id, spec1[i].u]));
        const direct1 = ids1.slice(4);
        info(`시험 지시 6건: ${ids1.join(', ')} (중간발주 = ${direct1.join(', ')})`);
        const r1 = await runLauncher(db, ids1, 4, 'p4');
        const a1 = analyze(r1, ids1, userOf1, direct1);
        info(`${r1.sec}초 · exit ${r1.exit} · 처리중 구간: ` + ids1.map(id => `#${id}(${userOf1[id] ? 'B' : 'A'}${direct1.includes(id) ? '·발주' : ''}) ${a1.span[id] ? a1.span[id].a + '~' + a1.span[id].b + 's' : '없음'}`).join(' · '));
        const fin1 = (await db.query(`SELECT id, status, result->>'type' AS type, result->>'kind' AS kind, jsonb_array_length(COALESCE(result->'files', '[]'::jsonb)) AS files, left(COALESCE(result->>'answer', result->>'error', ''), 60) AS said FROM pending_orders WHERE id = ANY($1::int[]) ORDER BY id`, [ids1])).rows;
        ok('6건 전부 끝남(완료) · launcher 정상 종료', fin1.every(x => x.status === '완료') && r1.exit === 0 && r1.last && r1.last.ok, fin1.map(x => `#${x.id} ${x.status}`).join(' · ') + (r1.err ? ' · stderr: ' + r1.err.slice(0, 120) : ''));
        ok('동시 처리 최대치 ≤ 4 · 2 이상(실제로 겹쳐 돌았음)', a1.maxConc <= 4 && a1.maxConc >= 2 && a1.maxRunning <= 4, `처리중 동시 최대 ${a1.maxConc} · running[] 최대 ${a1.maxRunning}`);
        ok('같은 사람의 2건은 겹치지 않음(차례로)', a1.sameUser.length === 0, a1.sameUser.length ? '겹침: ' + a1.sameUser.map(p => p.join('&')).join(', ') : `겹친 쌍 ${a1.pairs.length}개 전부 다른 사람`);
        ok('중간발주 2건은 겹치지 않음(바로 처리는 한 번에 하나)', a1.bothDirect.length === 0, a1.bothDirect.length ? '겹침: ' + a1.bothDirect.map(p => p.join('&')).join(', ') : `${direct1.map(id => '#' + id + ' ' + (a1.span[id] ? a1.span[id].a + '~' + a1.span[id].b : '?')).join(' / ')}`);
        ok('다른 사람의 지시끼리는 동시에 돌았음', a1.cross.length >= 1, `다른 사람 겹침 ${a1.cross.length}쌍`);
        const qty = fin1.filter(x => direct1.includes(x.id));
        ok('중간발주 2건 모두 답변 + PNG 첨부(files ≥ 1) · 오류 아님', qty.length === 2 && qty.every(x => x.status === '완료' && x.type !== 'error' && Number(x.files) >= 1), qty.map(x => `#${x.id} ${x.type || x.kind} files=${x.files} 「${x.said}」`).join(' / '));
        const ai = fin1.filter(x => !direct1.includes(x.id));
        ok('보고 4건 = 답변(오류 아님)', ai.every(x => x.status === '완료' && (x.type === 'desk_answer' || x.type === 'answer')), ai.map(x => `#${x.id} ${x.type} 「${x.said}」`).join(' / '));
        // ③ 상태
        console.log('\n── ③ heartbeat · desk_launcher 상태');
        // 실서버용 옛 대기 프로그램이 같은 PC에서 돌면 desk_launcher(running 없음)·heartbeat(idle)를 주기적으로 덮어쓴다 → 새 코드가 쓴 표본(running 배열이 있는 것)만 본다
        const newS = r1.samples.filter(s => s.newState), oldS = r1.samples.length - newS.length;
        const busyS = newS.filter(s => s.running.length > 0);
        // heartbeat 는 같은 PC의 옛 대기 프로그램도 30초마다 idle 로 덮어쓴다 → 그 표본(idle)은 따로 세고, busy 표본만 판정한다
        const oldOn = !!(hbBefore && hbBefore.value && hbBefore.value.on);
        const idleS = busyS.filter(s => s.hb.state !== 'busy');
        const judge = oldOn ? busyS.filter(s => s.hb.state === 'busy') : busyS;
        const hbIn = judge.filter(s => s.hb.state === 'busy' && s.running.map(Number).includes(Number(s.hb.order_id)));
        const hbFirst = judge.filter(s => s.hb.state === 'busy' && Number(s.hb.order_id) === Number(s.running[0]));
        ok('처리 중 desk_heartbeat(busy 표본) = order_id 가 돌고 있는 건 중 하나(100%) · 가장 먼저 시작한 건과 일치가 다수', judge.length > 0 && hbIn.length === judge.length && hbFirst.length > judge.length / 2, `busy 표본 ${judge.length} · 돌고 있는 건 ${hbIn.length} · running[0]과 일치 ${hbFirst.length}` + (oldOn ? ` · 옛 대기 프로그램이 idle 로 덮은 표본 ${idleS.length}(제외) · desk_launcher 를 덮은 표본 ${oldS}(제외)` : '') + ' — running[0]과 다른 것은 get.js가 집는 순간 자기 번호로 쓴 것(다음 30초 신호에 복귀)');
        ok('desk_launcher.running 길이 = 그 순간 「처리중」 건수(±1) · parallel = 4 · busy 플래그', newS.every(s => Math.abs(s.running.length - s.st.filter(x => x[1] === '처리중').length) <= 1) && newS.some(s => s.parallel === 4) && busyS.every(s => s.busy === true), `새 코드 표본 ${newS.length} · running 최대 ${a1.maxRunning}`);
        fs.writeFileSync(path.join(os.tmpdir(), 'v503-samples.json'), JSON.stringify(r1.samples));
        const tail = r1.samples[r1.samples.length - 1];
        const hbEnd = (await db.query(`SELECT value FROM agent_office_config WHERE key='desk_heartbeat'`)).rows[0].value;
        const lnEnd = (await db.query(`SELECT value FROM agent_office_config WHERE key='desk_launcher'`)).rows[0].value;
        ok('끝나면 heartbeat idle · running [] · busy false', (hbEnd.state === 'idle' || (tail && tail.hb.state === 'idle')) && Array.isArray(lnEnd.running) && lnEnd.running.length === 0 && lnEnd.busy === false, JSON.stringify({ hb: hbEnd.state, running: lnEnd.running, busy: lnEnd.busy }));
        // ⑤ 메모리(참고)
        const peak = r1.samples.reduce((m, s) => s.rss.mb > m.mb ? s.rss : m, { n: 0, mb: 0 });
        info(`⑤ 메모리(참고): 시험 중 claude.exe 증가분 최대 ${peak.mb}MB(+${peak.n}개 프로세스) · 동시 최대 ${a1.maxConc}건 때`);
        const at4 = r1.samples.filter(s => s.st.filter(x => x[1] === '처리중').length >= 3).map(s => s.rss.mb);
        if (at4.length) info(`   동시 3건 이상일 때 claude.exe 증가분 ${Math.min(...at4)}~${Math.max(...at4)}MB`);
        await closeOrders(db, ids1);

        // ── ② DESK_PARALLEL=1 → 전부 차례로
        if (!QUICK) {
            console.log('\n── ② DESK_PARALLEL=1 (사람 2명 보고 1건씩 + 중간발주 1건)');
            const spec2 = [
                { u: 0, content: '[검증469] 오늘 날짜가 며칠인지만 알려줘 — 보고만' },
                { u: 1, content: '[검증469] 발송휴무일 달력에 다음 휴무가 언제인지 알려줘 — 보고만' },
            ];
            const ids2 = await makeOrders(db, users, spec2); made.push(...ids2);
            const userOf2 = Object.fromEntries(ids2.map((id, i) => [id, spec2[i].u]));
            const r2 = await runLauncher(db, ids2, 1, 'p1');
            const a2 = analyze(r2, ids2, userOf2, []);
            const fin2 = (await db.query(`SELECT id, status FROM pending_orders WHERE id = ANY($1::int[]) ORDER BY id`, [ids2])).rows;
            ok('DESK_PARALLEL=1: 다른 사람 2건도 차례로(동시 최대 1 · 겹침 0) · 전부 완료 · parallel=1 기록', a2.maxConc === 1 && a2.pairs.length === 0 && fin2.every(x => x.status === '완료') && r2.samples.some(s => s.parallel === 1), `${r2.sec}초 · 구간 ` + ids2.map(id => `#${id} ${a2.span[id] ? a2.span[id].a + '~' + a2.span[id].b : '?'}`).join(' / '));
            await closeOrders(db, ids2);
        }
    } catch (e) {
        ok('검증 실행', false, e.message);
    } finally {
        try { await closeOrders(db, made); } catch (_) { }
        const left = made.length ? (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE id = ANY($1::int[]) AND is_deleted = false`, [made])).rows[0].c : 0;
        ok(`시험 지시 ${made.length}건 정리(숨김 · 열린 건은 취소)`, left === 0, made.join(','));
        await db.end();
    }
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();

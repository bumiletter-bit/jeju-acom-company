// #689 검증 — 자사몰 공개 스냅샷에서 「네이버 전용」 옵션 제거(storeSnapshotForMall) + 05:10 옵션 비교에서 재고 0 제외
//   ① 함수 단위: server.js 에서 cafe24OptKey·storeSnapshotForMall 원문을 떼어 실행(실DB 최신 스냅샷·실설정 SELECT 만 · 쓰기 0)
//   ② 분기: collectCafe24Sync 의 옵션 비교 줄이 재고 0 을 건너뛰는지(원문 대조 + 같은 조건식 실행)
//   ③ 라우트: 로컬 실서버(포트 3465 · 스케줄러 차단) GET /api/public/store-snapshot = 걸러진 items · 그 밖 칸·CORS 그대로
//   실행: node scripts/verify-689-mall-snapshot.js   (PORT689 로 포트 변경 · NO689SRV=1 = ③ 로컬 서버 건너뜀(#829))
require('dotenv').config();
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process'); const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.env.PORT689) || 3465, BASE = 'http://localhost:' + PORT;
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 300))); return !!c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = x => JSON.stringify(x);

(async () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const a = src.indexOf('function cafe24OptKey('), b = src.indexOf('async function collectCafe24Sync(');
    if (a < 0 || b < 0 || b <= a) throw new Error('server.js 에서 함수 경계를 못 찾음');
    const F = new Function(src.slice(a, b) + '\nreturn { cafe24OptKey, storeSnapshotForMall };')();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
    let srv = null, code = 1;
    try {
        const snap = (await pool.query(`SELECT id, run_at, total, items FROM naver_product_snapshot WHERE items IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0];
        const mapCfg = ((await pool.query(`SELECT value FROM agent_office_config WHERE key = 'cafe24_sync_map'`)).rows[0] || {}).value || null;
        const ignCfg = ((await pool.query(`SELECT value FROM agent_office_config WHERE key = 'cafe24_sync_ignore_opts'`)).rows[0] || {}).value || null;
        const items = snap.items; const raw = J(items);
        console.log(`① 함수 단위 — 스냅샷 #${snap.id}(${items.length}상품) · 연결표 ${Object.keys((mapCfg && mapCfg.map) || {}).length}상품 · 제외 열쇠 ${((ignCfg && ignCfg.keys) || []).length}개 ${J((ignCfg && ignCfg.keys) || [])}`);
        const out = F.storeSnapshotForMall(items, mapCfg, ignCfg);
        ok(J(items) === raw, '원본 items 는 바뀌지 않음(복사본)');
        ok(Array.isArray(out) && out.length === items.length && out !== items, '상품 수 그대로 · 새 배열');
        const lemon = items.find(x => /레몬/.test(x.name) && String(x.statusType) === 'SALE'), lemonOut = out.find(x => x.no === lemon.no);
        const lemonKey = o => F.cafe24OptKey((o.n1 || '') + ' ' + (o.n2 || ''));
        const naverOnly = (lemon.opts || []).filter(o => ((ignCfg && ignCfg.keys) || []).includes(lemonKey(o)) && Number(o.stock) > 0 && o.usable !== false);
        ok(naverOnly.length === 1 && /못난이5kg/.test(naverOnly[0].n1) && lemonKey(naverOnly[0]) === '레몬|못난이|5kg|랜덤과', '레몬 페이지의 네이버 전용 옵션 = 「그린레몬 못난이5kg」 1개(열쇠 레몬|못난이|5kg|랜덤과 · 재고 ' + (naverOnly[0] && naverOnly[0].stock) + ')', J(naverOnly.map(o => [o.n1, o.stock])));
        ok(lemon.opts.length === 4 && lemonOut.opts.length === 3 && !lemonOut.opts.some(o => /못난이/.test(o.n1)) && lemonOut.opts.map(o => o.n1).join('|') === lemon.opts.filter(o => !/못난이/.test(o.n1)).map(o => o.n1).join('|'), '레몬 옵션 4 → 3(못난이만 빠짐 · 나머지 순서 그대로)', J([lemon.opts.length, lemonOut.opts.length]));
        const changed = items.filter((it, i) => J(it) !== J(out[i])).map(it => it.name);
        ok(changed.length === 1 && changed[0] === lemon.name, `나머지 ${items.length - 1}상품 JSON 바이트 동일(바뀐 것 = 레몬만)`, J(changed));
        const gm = items.find(x => (x.opts || []).some(o => /황금향 못난이/.test(o.n2 || o.n1 || '') && Number(o.stock) === 0)), gmOut = gm && out.find(x => x.no === gm.no);
        ok(!gm || (gmOut && J(gm.opts) === J(gmOut.opts)), '재고 0 황금향 못난이 = 그대로 남음(스킨이 품절로 그림 · 열쇠는 10/14 제외 목록에서 뺐음 · 스냅샷에 없으면 건너뜀)', gm && J(gm.opts.map(o => [o.n2 || o.n1, o.stock])));
        ok(F.storeSnapshotForMall(items, null, ignCfg) === items && F.storeSnapshotForMall(items, mapCfg, null) === items && F.storeSnapshotForMall(items, mapCfg, { keys: [] }) === items && F.storeSnapshotForMall(items, { map: {} }, ignCfg) === items, '설정 null · 빈 keys · 빈 연결표 = 원본 그대로(같은 참조)');
        ok(F.storeSnapshotForMall(null, mapCfg, ignCfg) === null && J(F.storeSnapshotForMall([], mapCfg, ignCfg)) === '[]', 'items 가 null·빈 배열이면 그대로');
        { const only = { no: lemon.no, name: '시험', statusType: 'SALE', opts: [naverOnly[0]] }; const r = F.storeSnapshotForMall([only], mapCfg, ignCfg); ok(r[0] === only && r[0].opts.length === 1, '전용 옵션뿐인 상품은 전부 빠지지 않고 원본 유지'); }
        { const noMap = { no: '1', name: '연결표 밖', statusType: 'SALE', opts: [naverOnly[0]] }; const r = F.storeSnapshotForMall([noMap], mapCfg, ignCfg); ok(r[0] === noMap, '연결표에 없는 상품은 건드리지 않음'); }
        { const unus = Object.assign({}, naverOnly[0], { usable: false }); const r = F.storeSnapshotForMall([{ no: lemon.no, name: 'x', opts: [unus, lemon.opts[0]] }], mapCfg, ignCfg); ok(r[0].opts.length === 2, 'usable:false 인 전용 옵션은 빼지 않음(팔리는 옵션만 뺌)'); }

        console.log('② 05:10 옵션 비교 — 재고 0 제외');
        const line = (src.match(/if \(o\.usable === false \|\| \(o\.stock != null && Number\(o\.stock\) === 0\)\) continue;.*#689/) || [])[0];
        ok(!!line, 'collectCafe24Sync 옵션 비교 줄 = 「usable false 또는 재고 0(확인된 것) 이면 건너뜀」(#689)', line);
        const skip = o => (o.usable === false || (o.stock != null && Number(o.stock) === 0));
        ok(skip({ usable: true, stock: 0 }) && skip({ usable: false, stock: 5 }) && !skip({ usable: true, stock: 40 }) && !skip({ usable: true, stock: null }), '조건식: 재고 0 건너뜀 · usable false 건너뜀 · 재고 40 비교 · 재고 모름(null)은 종전대로 비교');
        ok(!/if \(o\.usable === false\) continue;\s*\n\s*const k = cafe24OptKey/.test(src), '옛 줄(usable 만 보는 것)은 남아 있지 않음');

        if (process.env.NO689SRV === '1') throw Object.assign(new Error('skip'), { skip689: true });   // #829 ③ 건너뜀 = 아래 catch 가 조용히 받음
        console.log('③ 라우트 — 로컬 실서버 ' + PORT);
        const env = { ...process.env, JWT_SECRET: 'local689', PORT: String(PORT) }; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`], { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'v689-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'v689-server.err'), 'w')] });
        let up = false, res = null; for (let i = 0; i < 60 && !up; i++) { await sleep(1000); try { res = await fetch(BASE + '/api/public/store-snapshot'); up = res.status === 200; } catch (_) { } }
        if (!up) throw new Error('서버가 안 떴거나 /api/public/store-snapshot 이 200 이 아님');
        const body = await res.json();
        ok(res.headers.get('access-control-allow-origin') === '*' && 'at' in body && 'total' in body && 'reviews' in body && 'reviews_fresh_at' in body && 'store' in body, 'CORS * · 응답 칸(at·total·items·reviews·reviews_fresh_at·store) 그대로');
        ok(body.items.length === items.length && J(body.items) === J(out) && J(body.items) !== raw, `라우트 items = 함수 결과와 바이트 동일(${body.items.length}상품) · 원본과는 다름(레몬 옵션 ${body.items.find(x => x.no === lemon.no).opts.length}개)`);
        ok(String(new Date(body.at).getTime()) === String(new Date(snap.run_at).getTime()) && body.total === snap.total, 'at·total = 최신 스냅샷 값');
        code = fail ? 1 : 0;
    } catch (e) { if (e && e.skip689) { console.log('③ 라우트 = 건너뜀(NO689SRV=1)'); code = fail ? 1 : 0; } else { console.error('ERR', e.stack || e.message); code = 1; } }
    finally { if (srv) srv.kill(); await pool.end().catch(() => { }); }
    console.log(`\n결과: ${pass}/${pass + fail}`); setTimeout(() => process.exit(code), 200);
})();

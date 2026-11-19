// #1197 검증 — 중계서버 스토어별 열쇠(main = 스마트스토어 · biz = 사업자몰 직영몰) + naver-relay.js store 전달
//   전부 로컬 · 실네이버·실중계서버·실DB 호출 0 · 가짜 네이버(임시 포트) + relay/server.js 를 자식으로 3461 에 띄움(HTTP · 인증서 없음)
//   node scripts/verify-1197-relay.js
'use strict';
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const bcrypt = require(path.join(ROOT, 'relay', 'node_modules', 'bcryptjs'));
const RELAY_PORT = 3461, AUTH = 'verify1197';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? '✅ ' : '❌ ') + name + (extra !== undefined && !cond ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

// ── 가짜 네이버: 토큰 = 'tok-' + client_id (서명 검사 · 표준 스펙 칸 검사) · API = 받은 Bearer 를 돌려줌 ──
const SALT_MAIN = bcrypt.genSaltSync(4), SALT_BIZ = bcrypt.genSaltSync(4);
const SECRETS = { 'main-id': SALT_MAIN, 'biz-id': SALT_BIZ };
const tokenHits = []; const apiHits = [];
const fakeNaver = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
        if (req.url === '/external/v1/oauth2/token') {
            const f = new URLSearchParams(b); const id = f.get('client_id'); const ts = f.get('timestamp');
            const want = Buffer.from(bcrypt.hashSync(`${id}_${ts}`, SECRETS[id] || SALT_MAIN), 'utf-8').toString('base64');
            const good = SECRETS[id] && f.get('client_secret_sign') === want && f.get('grant_type') === 'client_credentials'
                && /application\/x-www-form-urlencoded/.test(req.headers['content-type'] || '') && f.get('type') === 'SELF';
            tokenHits.push({ id, good });
            res.writeHead(good ? 200 : 401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(good ? { access_token: 'tok-' + id, expires_in: 10800 } : { code: 'bad' }));
        }
        apiHits.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: b });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ auth: req.headers.authorization, url: req.url }));
    });
});

function startRelay(naverPort, withBiz) {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', PORT: String(RELAY_PORT), RELAY_AUTH_TOKEN: AUTH,
        NAVER_API_BASE: `http://127.0.0.1:${naverPort}`, NAVER_CLIENT_ID: 'main-id', NAVER_CLIENT_SECRET: SALT_MAIN, NAVER_TYPE: 'SELF' };
    if (withBiz) Object.assign(env, { NAVER2_CLIENT_ID: 'biz-id', NAVER2_CLIENT_SECRET: SALT_BIZ, NAVER2_TYPE: 'SELF' });
    const p = spawn(process.execPath, [path.join(ROOT, 'relay', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.log = ''; p.stdout.on('data', d => p.log += d); p.stderr.on('data', d => p.log += d);
    return p;
}
async function waitUp(p) { for (let i = 0; i < 50; i++) { if (/시작 :3461/.test(p.log)) return true; await sleep(100); } return false; }
function post(port, pathname, obj, auth = AUTH) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(obj);
        const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth, 'Content-Length': Buffer.byteLength(data) } },
            res => { let t = ''; res.on('data', c => t += c); res.on('end', () => { let j; try { j = JSON.parse(t); } catch { j = { raw: t }; } resolve({ status: res.statusCode, json: j }); }); });
        req.on('error', reject); req.end(data);
    });
}
function get(port, p) { return new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: p }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => resolve(JSON.parse(t))); }).on('error', reject); }); }
const killp = p => new Promise(r => { if (!p || p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });

(async () => {
    const naverPort = await listen(fakeNaver);
    // ── 1. 중계서버: 두 열쇠 다 있을 때 ──
    let relay = startRelay(naverPort, true);
    ok('relay 3461 기동(두 열쇠)', await waitUp(relay), relay.log.slice(-300));
    const GET = { method: 'GET', path: '/external/v1/pay-order/seller/product-orders', query: { from: 'a', to: 'b' } };
    let r1 = await post(RELAY_PORT, '/naver', GET);
    ok('store 없음 → main 토큰(Bearer tok-main-id)', r1.status === 200 && r1.json.auth === 'Bearer tok-main-id', r1);
    let r2 = await post(RELAY_PORT, '/naver', { ...GET, store: 'main' });
    ok("store 'main' → main 토큰", r2.status === 200 && r2.json.auth === 'Bearer tok-main-id', r2);
    let r3 = await post(RELAY_PORT, '/naver', { ...GET, store: 'biz' });
    ok("store 'biz' → biz 토큰(Bearer tok-biz-id)", r3.status === 200 && r3.json.auth === 'Bearer tok-biz-id', r3);
    await post(RELAY_PORT, '/naver', GET); await post(RELAY_PORT, '/naver', { ...GET, store: 'biz' }); await post(RELAY_PORT, '/naver', GET);
    ok('토큰 캐시 스토어별 · 발급 = main 1번 · biz 1번(호출 6번)', tokenHits.filter(h => h.id === 'main-id').length === 1 && tokenHits.filter(h => h.id === 'biz-id').length === 1 && tokenHits.every(h => h.good), tokenHits);
    ok('API 호출 6번 · main 4 / biz 2 · 섞임 0', apiHits.length === 6 && apiHits.filter(h => h.auth === 'Bearer tok-main-id').length === 4 && apiHits.filter(h => h.auth === 'Bearer tok-biz-id').length === 2, apiHits.map(h => h.auth));
    const n0 = apiHits.length;
    let r4 = await post(RELAY_PORT, '/naver', { ...GET, store: 'xx' });
    ok("store 'xx' → 400 bad_store · 네이버 호출 0", r4.status === 400 && r4.json.error === 'bad_store' && apiHits.length === n0, r4);
    let r4b = await post(RELAY_PORT, '/naver', { ...GET, store: 1 });
    ok('store 숫자 1 → 400', r4b.status === 400, r4b);
    let r5 = await post(RELAY_PORT, '/naver', { method: 'DELETE', path: '/external/v1/pay-order/seller/product-orders', store: 'biz' });
    ok('biz 도 허용 경로 그대로(목록 밖 → 403)', r5.status === 403 && r5.json.error === 'path_not_allowed' && apiHits.length === n0, r5);
    let r6 = await post(RELAY_PORT, '/naver', { method: 'POST', path: '/external/v1/pay-order/seller/product-orders/dispatch', body: { dispatchProductOrders: [{ productOrderId: '1', deliveryMethod: 'QUICK' }] }, store: 'biz' });
    ok('biz 발송처리도 바디 검사 그대로(틀린 바디 → 403 · 네이버 호출 0)', r6.status === 403 && apiHits.length === n0, r6);
    let r6b = await post(RELAY_PORT, '/naver', { method: 'POST', path: '/external/v1/pay-order/seller/product-orders/confirm', body: { productOrderIds: ['2026111900001'] }, store: 'biz' });
    ok('biz 발주확인(허용 쓰기 경로) → biz 토큰으로 전달', r6b.status === 200 && r6b.json.auth === 'Bearer tok-biz-id' && JSON.parse(apiHits[apiHits.length - 1].body).productOrderIds[0] === '2026111900001', r6b);
    let r7 = await post(RELAY_PORT, '/naver', GET, 'wrong');
    ok('자체 인증 틀림 → 401(종전)', r7.status === 401);
    let h1 = await get(RELAY_PORT, '/health?token=1');
    ok('/health: token_test success · biz_keys_set true · biz_token_test success · 값 노출 0',
        h1.token_test === 'success' && h1.biz_keys_set === true && h1.biz_token_test === 'success' && h1.version === '2026-11-19.1' && !/tok-|biz-id|main-id/.test(JSON.stringify(h1)), h1);
    ok('로그에 토큰·시크릿 노출 0', !/tok-main-id|tok-biz-id|\$2[ab]\$/.test(relay.log), relay.log.slice(-400));
    await killp(relay);

    // ── 2. 중계서버: biz 열쇠 없을 때 ──
    tokenHits.length = 0; apiHits.length = 0;
    relay = startRelay(naverPort, false);
    ok('relay 3461 기동(main 열쇠만)', await waitUp(relay), relay.log.slice(-300));
    let s1 = await post(RELAY_PORT, '/naver', { ...GET, store: 'biz' });
    ok('biz 열쇠 없음 → 500 · NAVER2 안내 · main 열쇠로 안 넘어감(토큰·API 호출 0)', s1.status === 500 && /NAVER2/.test(s1.json.message || '') && tokenHits.length === 0 && apiHits.length === 0, { s1, tokenHits, apiHits });
    let s2 = await post(RELAY_PORT, '/naver', GET);
    ok('같은 상태에서 store 없음 → main 정상', s2.status === 200 && s2.json.auth === 'Bearer tok-main-id', s2);
    let h2 = await get(RELAY_PORT, '/health?token=1');
    ok('/health: biz_keys_set false · biz_token_test 칸 없음 · token_test success', h2.biz_keys_set === false && !('biz_token_test' in h2) && h2.token_test === 'success', h2);
    await killp(relay);

    // ── 3. naver-relay.js: store 없음 = 고치기 전(HEAD)과 같은 요청 바이트 ──
    const captured = [];
    const fakeRelay = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { captured.push({ url: req.url, headers: req.headers, body: b }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }); });
    const relayPort = await listen(fakeRelay);
    process.env.NAVER_RELAY_URL = `http://127.0.0.1:${relayPort}`; process.env.NAVER_RELAY_TOKEN = 'x';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1197-'));
    const headFile = path.join(tmpDir, 'naver-relay-head.js');
    fs.writeFileSync(headFile, execFileSync('git', ['show', 'HEAD:naver-relay.js'], { cwd: ROOT }));
    const oldMod = require(headFile), newMod = require(path.join(ROOT, 'naver-relay.js'));
    const cases = [
        { method: 'GET', path: '/external/v1/pay-order/seller/product-orders', query: { from: 'a', to: 'b', page: 1 } },
        { method: 'POST', path: '/external/v1/pay-order/seller/product-orders/query', body: { productOrderIds: ['1', '2'] } },
        { method: 'PUT', path: '/external/v1/contents/qnas/1', body: { commentContent: '답' }, timeoutMs: 5000 },
        { path: '/external/v1/pay-settle/settle/daily' },
    ];
    let same = 0;
    for (const c of cases) {
        captured.length = 0; await oldMod.callNaver(c, null); await newMod.callNaver(c, null); await newMod.callNaver({ ...c, store: 'main' }, null);
        const [a, b, m] = captured;
        if (a.body === b.body && a.body === m.body && a.url === b.url && a.headers['content-type'] === b.headers['content-type'] && a.headers.authorization === b.headers.authorization) same++;
        else console.log('   다름', JSON.stringify({ a: a.body, b: b.body, m: m.body }));
    }
    ok(`store 없음·'main' = HEAD 판과 요청 바이트 같음 ${same}/${cases.length}`, same === cases.length);
    captured.length = 0; await newMod.callNaver({ ...cases[0], store: 'biz' }, null);
    ok("store 'biz' → 본문 끝에 store:'biz' 한 칸만 더", captured[0].body === JSON.stringify({ method: 'GET', path: cases[0].path, query: cases[0].query, body: null, store: 'biz' }), captured[0].body);
    let thrown = null; captured.length = 0; try { await newMod.callNaver({ ...cases[0], store: 'shop' }, null); } catch (e) { thrown = e.message; }
    ok("store 'shop' → 보내기 전에 오류 · 요청 0", /store 값 오류/.test(thrown || '') && captured.length === 0, thrown);
    // 알림 글: main 은 종전 그대로 · biz 는 「(직영몰)」 머리
    const errRelay = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"x"}'); }); });
    const errPort = await listen(errRelay); process.env.NAVER_RELAY_URL = `http://127.0.0.1:${errPort}`;
    const notes = []; const nt = t => notes.push(t);
    for (const [mod, st] of [[oldMod, undefined], [newMod, undefined], [newMod, 'biz']]) { try { await mod.callNaver({ path: '/p', store: st }, nt); } catch (_) {} }
    ok('알림 글: main = HEAD 와 같음 · biz = 「🛰️ (직영몰) 네이버 API 오류」', notes[0] === notes[1] && /^🛰️ \(직영몰\) 네이버 API 오류 500/.test(notes[2] || ''), notes);
    ok('callCoupang·callAligo·callNaverPublic·relayHealth·configured 내보내기 그대로', ['callNaver', 'callCoupang', 'callAligo', 'callNaverPublic', 'relayHealth', 'configured'].every(k => typeof newMod[k] === 'function') && Object.keys(newMod).join() === Object.keys(oldMod).join());
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fakeRelay.close(); errRelay.close(); fakeNaver.close();
    console.log(`\n결과 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ' · 전부 통과'}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

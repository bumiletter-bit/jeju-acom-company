// #1184 검증 공용 틀 — server.js 의 라우트·함수를 글자 그대로 떼어(가짜 app·가짜 pool 에 끼워) 실행한다
//   🔴 실DB·실서버·외부·AI 0 · DB = 이 PC 메모리 pglite(PGLITE_DIR) · 같은 틀로 「고치기 전(git HEAD)」과 「고친 뒤(작업 트리)」를 나란히 돌린다
//   쓰는 곳 = verify-1184-docs.js · verify-1184-desk.js · verify-1184-settle.js · verify-1184-misc.js
'use strict';
const path = require('path'), fs = require('fs'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');

function pglite() {
    if (!process.env.PGLITE_DIR) { console.log('PGLITE_DIR 필요(@electric-sql/pglite 가 깔린 폴더)'); process.exit(2); }
    return require(path.join(process.env.PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite')).PGlite;
}
// 고치기 전 = git HEAD 의 파일 · 고친 뒤 = 작업 트리 파일
function srcOf(file, which) {
    if (which === 'before') return cp.execFileSync('git', ['show', 'HEAD:' + file], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}
const norm = s => s.split('\r\n').join('\n');
// 라우트 떼기: `app.<m>('<path>'` 로 시작해 줄 첫머리 `});` 까지
function route(src, method, p) {
    src = norm(src);
    const head = `app.${method}('${p}'`;
    const i = src.indexOf(head); if (i < 0) throw new Error('라우트 없음: ' + method + ' ' + p);
    if (src.indexOf(head, i + 1) >= 0) throw new Error('라우트 여러 개: ' + p);
    const e = src.indexOf('\n});', i); if (e < 0) throw new Error('라우트 끝 없음: ' + p);
    return src.slice(i, e + 4);
}
// 함수 떼기: `function 이름(` / `async function 이름(` 로 시작해 줄 첫머리 `}` 까지 · 없으면 null
function fn(src, name) {
    src = norm(src);
    const m = new RegExp('^(async )?function ' + name + '\\(', 'm').exec(src); if (!m) return null;
    const e = src.indexOf('\n}\n', m.index); if (e < 0) throw new Error('함수 끝 없음: ' + name);
    return src.slice(m.index, e + 2);
}
// 한 줄 상수 떼기: 줄 첫머리 `const 이름 =` 한 줄 · 없으면 null
function constLine(src, name) {
    src = norm(src);
    const m = new RegExp('^const ' + name + ' = .*$', 'm').exec(src); return m ? m[0] : null;
}
// 가짜 app: 라우트를 모아 두었다가 call 로 부른다(:id 꼴 · 미들웨어 차례대로)
function fakeApp() {
    const routes = [];
    const add = m => (p, ...h) => routes.push({ m, p, h, re: new RegExp('^' + p.replace(/:[a-z_]+/gi, '([^/]+)') + '$'), keys: (p.match(/:[a-z_]+/gi) || []).map(k => k.slice(1)) });
    const app = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() { } };
    app.call = (method, url, { user, body, query } = {}) => new Promise((resolve, reject) => {
        const [pth] = url.split('?');
        const r = routes.find(x => x.m === method && x.re.test(pth)); if (!r) return reject(new Error('라우트 없음: ' + method + ' ' + url));
        const mm = r.re.exec(pth), params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(mm[i + 1]); });
        const q = Object.assign({}, query || {}); const qs = url.split('?')[1]; if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); q[k] = decodeURIComponent(v || ''); }
        const req = { method, params, query: q, body: body || {}, user: user || null, headers: {} };
        const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(this); return this; }, send(b) { this.body = b; resolve(this); return this; }, end(b) { this.body = b; resolve(this); return this; }, setHeader(k, v) { this.headers[k] = v; }, set(k, v) { this.headers[k] = v; return this; }, type() { return this; }, attachment() { return this; } };
        let i = 0; const next = async () => { const h = r.h[i++]; if (!h) return; try { await h(req, res, next); } catch (e) { reject(e); } };
        next();
    });
    return app;
}
// pglite 를 pg Pool 꼴로: 모든 질의를 한 줄로 세움(묶음(connect) 중엔 다른 질의가 기다림 = 줄 잠금보다 넓은 잠금 · 같은 결과를 더 엄하게 봄)
//   DATE(1082)·NUMERIC(1700) = 글자(서버 server.js:20 pg 파서·pg 기본값과 같게)
async function makeDb(sqlInit) {
    const PGlite = pglite();
    const db = new PGlite({ parsers: { 1082: v => v, 1700: v => v } });
    if (sqlInit) await db.exec(sqlInit);
    let tail = Promise.resolve();
    const acquire = () => { let rel; const p = new Promise(r => { rel = r; }); const prev = tail; tail = prev.then(() => p); return prev.then(() => rel); };
    const run = async (s, p) => { const r = await db.query(s, p || []); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; };
    const pool = {
        async query(s, p) { const rel = await acquire(); try { return await run(s, p); } finally { rel(); } },
        async connect() { const rel = await acquire(); let done = false; return { query: (s, p) => run(s, p), release: () => { if (!done) { done = true; rel(); } } }; },
    };
    return { db, pool, q: async (s, p) => (await db.query(s, p || [])).rows };
}
// 떼어 온 글을 한 함수 안에서 돌림: names = 바깥에서 넣어 줄 이름들 · body = 떼어 온 코드 + 끝에 돌려줄 것
function load(names, values, body) {
    // eslint-disable-next-line no-new-func
    return new Function(...names, '"use strict";\n' + body)(...values);
}
function counter(title) {
    let pass = 0, fail = 0;
    const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400))); };
    const end = () => { console.log(`\n${title}: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0); };
    return { ok, end, get fail() { return fail; } };
}
module.exports = { ROOT, srcOf, route, fn, constLine, fakeApp, makeDb, load, counter, norm };

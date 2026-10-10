/* #610-J 사진 판독 시험 라우트·도구 검증 — AI 실호출 0 · DB 0 · 외부 발송 0 (가짜 judge · 가짜 로그인 · 임시 폴더)
 *
 *   node scripts/verify-610-phototest.js          (포트 3465 · PORT610J 로 바꿈)
 *
 *   ① 라우트(sms/photo-test.js 실코드를 express 에 장착): 모양 · 로그인 없음 401 · 관리자 아님 403 · 사진 없음/4장 초과 400 ·
 *      base64 아님 400 · 10MB 초과 413 · 하루 상한 429 · 응답 칸 · 판독 실패 표시 · 실제 reply·leakCheck 연결
 *   ② 도구(scripts/desk/photo-test.js 를 자식 프로세스로): 폴더 이름 → 기대값 · 표·혼동표·정답률 · 토큰 없음/만료/상한 멈춤 · --dry
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT610J) || 3465;
const BASE = 'http://127.0.0.1:' + PORT;
const mount = require('../sms/photo-test.js');
const photoReply = require('../sms/photo-reply.js');
const tool = require('./desk/photo-test.js');

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) pass++; else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); } }
function section(t) { console.log('\n' + t); }

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const b64 = JPEG.toString('base64');

// 가짜 로그인: 토큰 글자 그대로 역할이 된다
function fakeAuth(req, res, next) {
    const t = String(req.headers.authorization || '').replace('Bearer ', '');
    if (!t || t === 'expired') return res.status(401).json({ error: '인증이 필요합니다' });
    req.user = { id: t === 'admin' ? 1 : 10, name: t === 'admin' ? '대표' : '직원', role: t === 'admin' ? 'admin' : 'user' };
    next();
}
// 가짜 판독: 사진 이름(=text 로 전달 안 됨)을 모르므로 contentType 뒤에 붙인 꼬리표로 결과를 고른다
const judgeCalls = [];
let judgeMode = 'byTag';
async function fakeJudge(images, opt) {
    judgeCalls.push({ n: images.length, opt, bytes: images.map(i => i.buf.length), types: images.map(i => i.contentType) });
    if (judgeMode === 'throw') throw new Error('boom');
    if (judgeMode === 'error') return { kind: 'error', confidence: 'low', size_guess: null, size_dir: null, staff_summary: '사진 판독을 하지 못했습니다', raw: { error: 'AI 키 없음' } };
    const tag = (images[0].buf.toString('latin1').match(/TAG:([a-z_]+)/) || [])[1] || 'damage';
    const base = { confidence: 'high', size_guess: null, size_dir: null, staff_summary: '직원용: 곰팡이 3개 · 전체의 20% 정도', raw: { usage: { input_tokens: 1700, output_tokens: 90 }, resized: 0 } };
    if (tag === 'size') return Object.assign(base, { kind: 'size', size_guess: '2S', size_dir: 'small' });
    return Object.assign(base, { kind: tag });
}
function tagged(tag) { return Buffer.concat([JPEG, Buffer.from('TAG:' + tag)]); }

function req(method, p, token, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const r = http.request(BASE + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, data ? { 'Content-Length': data.length } : {}) }, res => {
            const chunks = []; res.on('data', c => chunks.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { } resolve({ status: res.statusCode, data: j }); });
        });
        r.on('error', reject); if (data) r.write(data); r.end();
    });
}
function runTool(args, env) {
    return new Promise(resolve => {
        const c = spawn(process.execPath, [path.join(ROOT, 'scripts', 'desk', 'photo-test.js'), ...args], { env: Object.assign({}, process.env, { AKKOME_TOKEN: '' }, env || {}) });
        let out = '', err = '';
        c.stdout.on('data', d => out += d); c.stderr.on('data', d => err += d);
        c.on('close', code => { const last = out.trim().split('\n').pop() || ''; let j = null; try { j = JSON.parse(last); } catch (e) { } resolve({ code, out, err, json: j }); });
    });
}

(async () => {
    // ── 서버 ──
    const app = express();
    app.use(express.json({ limit: '15mb' }));
    const sent = [];   // 손님 발송·DB 쓰기가 있으면 여기에 남게(이 모듈은 그런 길 자체가 없어야 한다)
    const logs = [];
    const handle = mount(app, { authMiddleware: fakeAuth, judge: fakeJudge, log: (...a) => logs.push(a.join(' ')) });
    app.use((err, req, res, next) => res.status(err.status || 400).json({ ok: false, error: '본문 오류' }));   // 깨진 본문(검증용 · 실서버는 자체 처리)
    const server = await new Promise(r => { const s = app.listen(PORT, '127.0.0.1', () => r(s)); });

    try {
        section('① 라우트 /api/sms/photo-test');
        ok(typeof mount === 'function' && handle && handle.DAILY_MAX === 100 && handle.MAX_IMAGES === 4 && handle.MAX_TOTAL_BYTES === 10 * 1024 * 1024, '장착 함수 · 상한 값(4장 · 10MB · 하루 100회)');
        let threw = false; try { mount(app, {}); } catch (e) { threw = /authMiddleware/.test(e.message); }
        ok(threw, 'authMiddleware 없이 장착하면 바로 오류(로그인 없는 라우트가 생기지 않게)');
        const src = fs.readFileSync(path.join(ROOT, 'sms', 'photo-test.js'), 'utf8');
        ok(!/pool|\.query\(|INSERT|UPDATE|sendLms|sendMessage|axios|fetch\(|writeFile/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), '코드에 DB·발송·파일 쓰기·외부 호출 길 없음');
        ok((src.match(/app\.(get|post|put|delete)\(/g) || []).length === 1, '라우트는 하나뿐');

        const one = (tag) => ({ images: [{ name: 'a.jpg', contentType: 'image/jpeg', data: tagged(tag).toString('base64') }] });
        let r = await req('POST', '/api/sms/photo-test', null, one('damage'));
        ok(r.status === 401, '로그인 없음 → 401', r.status);
        r = await req('POST', '/api/sms/photo-test', 'staff', one('damage'));
        ok(r.status === 403 && r.data.ok === false, '관리자 아님 → 403', r);
        ok(judgeCalls.length === 0, '401·403 에서는 판독을 부르지 않음');
        r = await req('POST', '/api/sms/photo-test', 'admin', {});
        ok(r.status === 400, '사진 없음 → 400', r.status);
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [] });
        ok(r.status === 400, '빈 목록 → 400');
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [1, 2, 3, 4, 5].map(i => ({ name: i + '.jpg', contentType: 'image/jpeg', data: b64 })) });
        ok(r.status === 400 && /4장/.test(r.data.error), '5장 → 400(한 번에 4장)', r);
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [{ name: 'x.jpg', data: '!!!not base64!!!' }] });
        ok(r.status === 400 && /base64/.test(r.data.error), 'base64 아님 → 400');
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [{ name: 'x.jpg' }] });
        ok(r.status === 400, 'data 없음 → 400');
        const big = Buffer.alloc(5.2 * 1024 * 1024, 1).toString('base64');
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [{ name: 'a.jpg', data: big }, { name: 'b.jpg', data: big }] });
        ok(r.status === 413 && /10MB/.test(r.data.error), '합계 10MB 초과 → 413', r.status);
        ok(judgeCalls.length === 0 && handle.state.used === 0, '거절된 요청은 판독 0 · 하루 셈 0', { calls: judgeCalls.length, used: handle.state.used });

        // 정상
        r = await req('POST', '/api/sms/photo-test', 'admin', Object.assign(one('damage'), { text: '귤이 썩었어요', channel: 'sms', expect: 'damage' }));
        const d = r.data;
        ok(r.status === 200 && d.ok === true && d.kind === 'damage' && d.confidence === 'high', '정상: damage/high', d);
        ok(['ok', 'kind', 'confidence', 'size_guess', 'size_dir', 'staff_summary', 'customer_reply', 'tokens', 'ms'].every(k => k in d), '응답 칸 전부', Object.keys(d));
        ok(d.customer_reply === photoReply.reply({ kind: 'damage', confidence: 'high' }, { channel: 'sms' }) && d.customer_reply.includes(photoReply.DAMAGE_CORE), 'customer_reply = 실제 photo-reply 결과(sms)');
        ok(d.leak === '' && !d.customer_reply.includes('곰팡이') && d.staff_summary.includes('3개'), '손님 글 유출 0 · 직원용 요약은 따로');
        ok(d.tokens && d.tokens.input === 1700 && d.tokens.output === 90 && typeof d.ms === 'number', 'tokens · ms');
        ok(d.expect === 'damage' && d.match === true && d.used === 1 && d.limit === 100, 'expect·match · 하루 셈 1/100');
        ok(judgeCalls.length === 1 && judgeCalls[0].n === 1 && judgeCalls[0].opt.text === '귤이 썩었어요' && judgeCalls[0].opt.channel === 'sms' && judgeCalls[0].bytes[0] === tagged('damage').length, '판독 1번 · 사진 바이트 그대로 · 글·채널 전달');
        ok(logs.length === 1 && !logs[0].includes('썩었어요') && logs[0].includes('damage'), '로그 한 줄(손님 글 없음)', logs);
        // talk + size
        r = await req('POST', '/api/sms/photo-test', 'admin', Object.assign(one('size'), { channel: 'talk', expect: 'damage' }));
        ok(r.data.kind === 'size' && r.data.size_guess === '2S' && r.data.size_dir === 'small' && r.data.customer_reply.includes('사진으로는 2S 정도로 보여요.') && r.data.customer_reply.includes('🍊'), 'size · talk 채널 글', r.data);
        ok(r.data.match === false, '기대와 다르면 match false');
        // not_fruit
        r = await req('POST', '/api/sms/photo-test', 'admin', one('not_fruit'));
        ok(r.data.ok === true && r.data.customer_reply === null && r.data.expect === null && r.data.match === null, 'not_fruit → customer_reply null · 기대 없으면 match null', r.data);
        // 4장 · data: 머리말
        r = await req('POST', '/api/sms/photo-test', 'admin', { images: [1, 2, 3, 4].map(i => ({ name: i + '.jpg', contentType: 'image/jpeg', data: 'data:image/jpeg;base64,' + b64 })) });
        ok(r.status === 200 && r.data.images === 4 && judgeCalls[judgeCalls.length - 1].n === 4, '4장 한 번에 · data: 머리말 허용');
        // 판독 실패
        judgeMode = 'error';
        r = await req('POST', '/api/sms/photo-test', 'admin', one('damage'));
        ok(r.status === 200 && r.data.ok === false && r.data.kind === 'error' && r.data.customer_reply === null && /키 없음/.test(r.data.error), '판독 실패(키 없음) → ok false · kind error · 손님 글 없음', r.data);
        judgeMode = 'throw';
        r = await req('POST', '/api/sms/photo-test', 'admin', one('damage'));
        ok(r.status === 200 && r.data.ok === false && r.data.kind === 'error' && r.data.customer_reply === null, '판독 함수가 던져도 500 아님 · kind error · 손님 글 없음', r.data);
        judgeMode = 'byTag';
        // 깨진 JSON 본문
        r = await req('POST', '/api/sms/photo-test', 'admin', '{"images": [');
        ok(r.status === 400, '깨진 본문 → 400', r.status);
        // 하루 상한
        const usedBefore = handle.state.used;
        handle.state.used = 100;
        const n = judgeCalls.length;
        r = await req('POST', '/api/sms/photo-test', 'admin', one('damage'));
        ok(r.status === 429 && r.data.limit === 100 && judgeCalls.length === n, '하루 100회 뒤 → 429(판독 안 부름)', r);
        handle.state.day = '2000-01-01';
        r = await req('POST', '/api/sms/photo-test', 'admin', one('damage'));
        ok(r.status === 200 && r.data.used === 1, '날이 바뀌면 다시 1부터');
        ok(usedBefore === 6, '성공·실패 판독만 셈에 들어감(6회)', usedBefore);
        ok(sent.length === 0, '손님 발송·DB 쓰기 0');

        // R5 S1: sms/index.js 는 log 로 console **객체**를 넘긴다 → 그 꼴로 장착해도 정상 200(종전엔 판독 뒤 500)
        {
            const mk = (deps) => { let h = null; mount({ post: (p, a, fn) => { h = fn; } }, Object.assign({ authMiddleware: fakeAuth, judge: fakeJudge }, deps)); return h; };
            const call = (h) => new Promise(resolve => { const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ status: this.code, data: o }); } }; h({ user: { id: 1, name: '대표', role: 'admin' }, body: one('damage') }, res); });
            const lines = []; const obj = { log: (...a) => lines.push(a.join(' ')), error() { } };
            let x = await call(mk({ log: obj }));
            ok(x.status === 200 && x.data.ok === true && x.data.kind === 'damage' && lines.length === 1 && lines[0].includes('[사진시험]'), 'log 가 console 꼴 객체 → 200 · 그 객체의 log 로 한 줄', { x, lines });
            const saved = console.log; let viaConsole = 0; console.log = (...a) => { if (String(a[0]).includes('[사진시험]')) viaConsole++; };
            try { x = await call(mk({ log: console })); } finally { console.log = saved; }
            ok(x.status === 200 && x.data.ok === true && viaConsole === 1, 'log: console(실서버 장착 꼴) → 200', x);
            x = await call(mk({ log: () => { throw new Error('log down'); } }));
            ok(x.status === 200 && x.data.ok === true && x.data.kind === 'damage', '로그가 던져도 응답은 정상 200', x);
            console.log = () => { }; try { x = await call(mk({ log: { nope: 1 } })); } finally { console.log = saved; }
            ok(x.status === 200 && x.data.ok === true, 'log 가 엉뚱한 객체여도 200(기본 로그로)', x);
            console.log = () => { }; try { x = await call(mk({})); } finally { console.log = saved; }
            ok(x.status === 200 && x.data.ok === true, 'log 없이 장착 → 200');
        }
        console.log(`  → ${pass}/${pass + fail}`);

        // ── 도구 ──
        section('② 도구 scripts/desk/photo-test.js');
        const p0 = pass, f0 = fail;
        ok(tool.expectOf('파손') === 'damage' && tool.expectOf('곰팡이') === 'damage' && tool.expectOf('사이즈작음') === 'size' && tool.expectOf('멀쩡') === 'other' && tool.expectOf('주소캡처') === 'not_fruit' && tool.expectOf('기타자료') === null, '폴더 이름 → 기대값 5종');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w5-photo-'));
        const put = (folder, name, tag) => { fs.mkdirSync(path.join(tmp, folder), { recursive: true }); fs.writeFileSync(path.join(tmp, folder, name), tagged(tag)); };
        put('파손', '1.jpg', 'damage'); put('파손', '2.jpg', 'damage'); put('곰팡이', '1.jpg', 'damage'); put('곰팡이', '2.png', 'other');
        put('사이즈작음', '1.jpg', 'size'); put('사이즈작음', '2.jpg', 'size'); put('멀쩡', '1.jpg', 'other'); put('멀쩡', '2.jpg', 'damage');
        put('주소캡처', '1.jpg', 'not_fruit'); put('주소캡처', '2.jpeg', 'not_fruit');
        fs.writeFileSync(path.join(tmp, '파손', '메모.txt'), 'x');
        handle.state.used = 0; handle.state.day = '';
        const before = judgeCalls.length;

        let t = await runTool([tmp, '--dry', '--server', BASE]);
        ok(t.code === 0 && t.json && t.json.dry === true && t.json.total === 10 && t.json.with_expect === 10 && judgeCalls.length === before, '--dry: 목록만(10장 · 서버 호출 0)', t.json || t.err);
        t = await runTool([tmp, '--server', BASE]);
        ok(t.code === 2 && /AKKOME_TOKEN/.test(t.err) && judgeCalls.length === before, '토큰 없음 → 안내하고 멈춤(호출 0)', t.err);
        t = await runTool([tmp, '--server', BASE], { AKKOME_TOKEN: 'expired' });
        ok(t.code === 1 && t.json && t.json.ok === false && /만료/.test(t.json.stopped) && !t.json.out, '토큰 만료(401) → 멈춤 · 결과 파일 안 만듦', t.json || t.err);
        t = await runTool([tmp, '--server', BASE], { AKKOME_TOKEN: 'staff' });
        ok(t.code === 1 && /관리자/.test((t.json || {}).stopped || ''), '직원 토큰(403) → 멈춤');

        t = await runTool([tmp, '--server', BASE, '--channel', 'sms'], { AKKOME_TOKEN: 'admin' });
        const j = t.json || {};
        ok(t.code === 0 && j.ok === true && j.total === 10 && j.judged === 10 && j.failed === 0, '10장 판독', j.total ? j : t.err || t.out);
        ok(j.scored === 10 && j.right === 8 && j.rate === 80, '정답률 8/10 = 80%', j);
        ok(j.leaks === 0 && j.tokens_in === 17000 && j.tokens_out === 900, '유출 0 · 토큰 합계');
        ok(judgeCalls.length === before + 10, '사진 1장 = 판독 1회(10회)', judgeCalls.length - before);
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        ok(j.out === path.join(tmp, `결과_${today}.md`) && fs.existsSync(j.out), '결과 파일 = <폴더>/결과_<날짜>.md', j.out);
        const md = fs.existsSync(j.out || '') ? fs.readFileSync(j.out, 'utf8') : '';
        ok(/정답률: 8\/10 \(80%\)/.test(md), '결과: 정답률 줄');
        ok(md.includes('## 종류별 혼동표') && /\| 파손·부패 \|.*\| 3\/4 \|/.test(md) && /\| 기타\(멀쩡 등\) \|.*\| 1\/2 \|/.test(md) && /\| 과일 사진 아님 \|.*\| 2\/2 \|/.test(md) && /\| 사이즈 \|.*\| 2\/2 \|/.test(md), '결과: 혼동표(종류별 정답률)', md.split('\n').filter(l => l.startsWith('|')).slice(0, 8));
        ok(md.includes('## 틀린 것') && md.includes('곰팡이/2.png') && md.includes('멀쩡/2.jpg'), '결과: 틀린 것 2건 이름');
        ok(md.includes('## 사진별') && (md.match(/^\| (파손|곰팡이|사이즈작음|멀쩡|주소캡처)\//gm) || []).length === 10, '결과: 사진별 10줄');
        ok(md.includes('## 손님에게 나갈 글') && md.includes(photoReply.DAMAGE_CORE) && md.includes('(답 없음)'), '결과: 손님 글(종류별 한 번) · 답 없음 표시');
        ok(!md.includes('admin') && !/Bearer/.test(md), '결과 파일에 토큰 없음');
        ok(!fs.readdirSync(ROOT).some(n => /^결과_/.test(n)), '저장소 맨 위에 결과 파일을 흘리지 않음');

        // 상한에 걸리면 거기까지 저장하고 멈춤
        handle.state.used = 97;
        t = await runTool([tmp, '--server', BASE, '--out', path.join(tmp, 'part.md')], { AKKOME_TOKEN: 'admin' });
        ok(t.code === 1 && t.json && t.json.judged === 3 && /다 썼/.test(t.json.stopped) && fs.readFileSync(path.join(tmp, 'part.md'), 'utf8').includes('중간에 멈춤'), '하루 상한에 걸리면 3장까지 저장하고 멈춤', t.json);
        // 기대값 없이 · limit
        handle.state.used = 0;
        t = await runTool([tmp, '--server', BASE, '--no-expect', '--limit', '2', '--out', path.join(tmp, 'ne.md')], { AKKOME_TOKEN: 'admin' });
        ok(t.code === 0 && t.json.total === 2 && t.json.scored === 0 && t.json.rate === null && fs.readFileSync(path.join(tmp, 'ne.md'), 'utf8').includes('기대값 없음'), '--no-expect --limit 2', t.json);
        // 서버에 라우트 없음
        t = await runTool([tmp, '--server', BASE + '/nope'], { AKKOME_TOKEN: 'admin' });
        ok(t.code === 1 && /배포 전/.test((t.json || {}).stopped || ''), '라우트 없음(404) → 「아직 배포 전」');
        // 비공개 폴더가 저장소에서 빠지는지
        const ig = spawnSync('git', ['check-ignore', '-q', '★에이전트오피스/비공개/사진시험/결과_2026-10-10.md'], { cwd: ROOT });
        ok(ig.status === 0, '기본 결과 자리(★에이전트오피스/비공개/사진시험/)는 저장소 제외');
        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(`  → ${pass - p0}/${pass - p0 + fail - f0}`);
    } catch (e) {
        ok(false, '검증 중 예외', e.stack || e.message);
    } finally {
        server.close();
    }
    console.log(`\n결과: ${pass}/${pass + fail}` + (fail ? `  (실패 ${fail})` : '  전부 통과'));
    process.exit(fail ? 1 : 0);
})();

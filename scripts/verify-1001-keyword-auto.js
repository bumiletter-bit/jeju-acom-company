// #1001 검증 — 판매 중 상품 키워드 자동 · 보안 확인 멈춤 · 재수집 알림 · 순위관리 칸
//   🔴 실DB 0 · 어사이드 0 · 텔레그램 0 — 전부 가짜 자료(가짜 pool · 가짜 어사이드 프로세스 · 서버 실코드를 떼어 가짜 db 로 실행 · 화면은 실제 마크업+실제 app.js 구간 + 가짜 api)
//   실행: node scripts/verify-1001-keyword-auto.js [--no-ui]
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), vm = require('vm');
const { spawnSync } = require('child_process');
process.env.KR_PAGE_WAIT_MS = '300';
const ROOT = path.resolve(__dirname, '..');
const KR = require(path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js'));
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', '1001-keyword-auto-config.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, name, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });

const NOW = Date.parse('2026-11-03T00:30:00Z'), FRESH = '2026-11-02T19:41:35Z';
const op = (n1, n2, stock = 10, usable = true) => ({ n1, n2, stock, usable, price: 0 });
const FIXED = ['귤', '제주귤', '감귤', '제주감귤'];
// 11/3 실스냅샷과 같은 꼴
const items = () => [
    { no: 13817259794, name: '테스트 한라봉(시험용 · 구매 금지)', statusType: 'SUSPENSION', opts: [op('테스트', '테스트1')] },
    { no: 12957301776, name: '레드향 한라봉 천혜향 황금향 귤 타이벡 레몬 대용량 상품', statusType: 'OUTOFSTOCK', opts: [op('대용량', '10kg', 0)] },
    { no: 11126666859, name: '제주 황금향 가정용 선물용 3kg 5kg 10kg', statusType: 'SALE', opts: [op('1. (제철)과즙팡팡 황금향', '황금향 가정용 - 3kg(중소과)', 0), op('1. (제철)과즙팡팡 황금향', '노지 황금향 가정용 - 5kg(혼합과)')] },
    { no: 10801253976, name: '명절 추석 설날 혼합 과일 선물세트', statusType: 'SALE', opts: [op('1. 고당도 타이벡감귤', '선물용 - 3kg')] },
    { no: 7673020911, name: '제주 감귤 체험 농장 방문 아꼼이네 귤따기 시식', statusType: 'SALE', opts: [op('내가 직접 딴 노지귤 2kg(36개월까지무료)', '')] },
    { no: 6400134206, name: '제주 노지 감귤 타이벡 하우스', statusType: 'SALE', opts: [op('1. (제철)고당도 타이벡감귤', '가정용 - 5kg'), op('2. (제철)새콤달콤 노지감귤', '가정용 - 3kg'), op('3. (제철)과즙팡팡 황금향', '노지 황금향 가정용 - 5kg')] },
    { no: 5531798664, name: '제주 레몬', statusType: 'SALE', opts: [op('제주 그린레몬5kg(중소과)', '')] },
    { no: 4840212264, name: '제주 한라봉 노지 하우스 선물용 가정용 못난이', statusType: 'OUTOFSTOCK', opts: [op('한라봉', '3kg', 0)] },
];
const run = (o = {}) => KR.computeAutoKeywords(Object.assign({ fixed: FIXED, auto: SEED, items: items(), snapshotAt: FRESH, now: NOW }, o));
const byNo = (list, no) => list.find(i => String(i.no) === String(no));

console.log('① 판매 중 / 품절');
{
    const r = run();
    eq(r.keywords, ['귤', '제주귤', '감귤', '제주감귤', '타이벡귤', '노지감귤', '황금향', '제주황금향', '노지황금향', '레몬', '제주레몬', '감귤체험'], '오늘 꼴 = 고정 4 + 자동 8(체험·노지황금향 포함)');
    eq(r.auto.keywords.length, 8, 'auto.keywords = 자동만');
    eq(r.auto.unmapped, [], '짝 없음 0(VIP·대용량 ignore)');
    ok(!r.keywords.includes('한라봉'), '품절 한라봉 = 안 모음(짝은 깔려 있음)');
    const a = items(); byNo(a, 4840212264).statusType = 'SALE'; byNo(a, 4840212264).opts[0].stock = 5;
    const r2 = run({ items: a }); ok(r2.keywords.includes('한라봉') && r2.keywords.includes('제주한라봉'), '한라봉 재오픈 = 저절로 들어옴');
    const b = items(); byNo(b, 5531798664).statusType = 'OUTOFSTOCK';
    ok(!run({ items: b }).keywords.includes('레몬'), '레몬 품절 = 자동 제외');
    const c = items(); byNo(c, 6400134206).opts[0].stock = 0;
    const r3 = run({ items: c }); ok(!r3.keywords.includes('타이벡귤') && r3.keywords.includes('노지감귤'), '옵션만 품절 = 타이벡귤만 빠짐·노지감귤 유지');
    const d = items(); byNo(d, 6400134206).opts[1].usable = false;
    ok(!run({ items: d }).keywords.includes('노지감귤'), 'usable false = 판매 아님');
    const e = items(); byNo(e, 6400134206).opts.splice(1, 1);
    ok(!run({ items: e }).keywords.includes('노지감귤'), '🔴 감귤 페이지 노지 황금향 옵션이 「노지감귤」을 살리지 않음');
    const f = items(); byNo(f, 11126666859).opts[1].stock = 0; byNo(f, 11126666859).opts[0].stock = 5;
    const r4 = run({ items: f }); ok(r4.keywords.includes('황금향') && !r4.keywords.includes('노지황금향'), '노지 황금향만 품절 = 황금향 유지·노지황금향 제외');
    const g = items(); delete byNo(g, 5531798664).opts;
    ok(run({ items: g }).keywords.includes('레몬'), '옵션 수집 실패(opts 없음) = 판매 중으로 봄');
    const h = items(); byNo(h, 5531798664).opts[0].stock = 0;
    const r5 = run({ items: h }); ok(!r5.keywords.includes('레몬') && !r5.auto.unmapped.length, 'SALE 인데 팔 옵션 0 = 판매 아님·알림도 없음');
    const n1 = items(); byNo(n1, 5531798664).opts[0].stock = null;
    ok(run({ items: n1 }).keywords.includes('레몬'), '재고 null = 모름 = 판매 중');
    const n2 = items(); delete byNo(n2, 5531798664).opts[0].stock;
    ok(run({ items: n2 }).keywords.includes('레몬'), '재고 칸 없음 = 판매 중');
    const n3 = items(); byNo(n3, 5531798664).opts[0].stock = '';
    ok(run({ items: n3 }).keywords.includes('레몬'), '재고 빈 글자 = 판매 중');
    const n4 = items(); byNo(n4, 5531798664).opts[0].stock = '0';
    ok(!run({ items: n4 }).keywords.includes('레몬'), '재고 글자 0 = 품절');
    const n5 = items(); byNo(n5, 5531798664).opts[0].stock = null; byNo(n5, 5531798664).opts[0].usable = false;
    ok(!run({ items: n5 }).keywords.includes('레몬'), '재고 null 이어도 usable false = 판매 아님');
    const t = items(); t.push({ no: 99, name: '테스트 귤', statusType: 'SALE' }); byNo(t, 13817259794).statusType = 'SALE';
    eq(run({ items: t }).auto.unmapped, [], '시험 상품(번호·이름) = 알림 안 함');
}
console.log('② 짝 없음');
{
    const a = items(); a.push({ no: 111, name: '제주 새품목 3kg 5kg', statusType: 'SALE', opts: [op('새품목', '3kg')] });
    const r = run({ items: a });
    eq(r.auto.unmapped, [{ no: '111', name: '제주 새품목 3kg 5kg' }], '새 판매 상품 = unmapped');
    ok(!r.keywords.some(k => /새품목/.test(k)), '이름에서 낱말을 뽑지 않음');
    const b = items(); byNo(b, 6400134206).opts.push(op('4. (제철)고당도 하우스감귤', '가정용 - 3kg'));
    const u = run({ items: b }).auto.unmapped; ok(u.length === 1 && u[0].opt === '4. (제철)고당도 하우스감귤', '옵션 규칙 페이지의 새 옵션 = unmapped(옵션 이름)', u);
    const c = items(); byNo(c, 5531798664).opts.push(op('레몬청', '1kg'));
    eq(run({ items: c }).auto.unmapped, [], '상품 통째 규칙 페이지 = 새 옵션 알림 없음');
}
console.log('③ 상한 · 겹침');
{
    const many = Array.from({ length: 12 }, (_, i) => 'k' + i);
    const a = items(); for (const no of [4840212264]) { byNo(a, no).statusType = 'SALE'; byNo(a, no).opts[0].stock = 3; }
    const r = run({ fixed: many, items: a });
    eq(r.keywords.length, 20, '합계 20개까지');
    eq(r.keywords.slice(0, 12), many, '고정 먼저');
    ok(r.auto.cut.length === 2 && r.auto.cut.includes('제주한라봉'), '넘친 것 = cut(뒤 규칙부터)', r.auto.cut);
    const d = run({ fixed: ['황금향', ...FIXED] });
    ok(d.keywords.filter(k => k === '황금향').length === 1 && !d.auto.keywords.includes('황금향'), '고정·자동 겹침 = 고정으로 1번');
    const sp = run({ fixed: ['제주 황금향'] }); ok(!sp.keywords.includes('제주황금향'), '띄어쓰기만 다른 것도 1번');
    eq(KR.KR_CAP, Number((fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').match(/const KR_MAX_KEYWORDS = (\d+)/) || [])[1]), '상한 = 서버 KR_MAX_KEYWORDS');
}
console.log('④ 스냅샷 없음·낡음');
{
    const prev = { keywords: ['감귤체험', '레몬'] };
    for (const [nm, o] of [['없음', { items: null, snapshotAt: null }], ['빈 배열', { items: [] }], ['49시간', { snapshotAt: new Date(NOW - 49 * 3600e3).toISOString() }]]) {
        const r = run(Object.assign({ prevAuto: prev }, o));
        ok(r.auto.stale === true && r.auto.keywords.join() === prev.keywords.join() && r.keywords.length === 6, nm + ' = 어제 자동 목록 유지', r);
    }
    eq(run({ items: null, snapshotAt: null }).keywords, FIXED, '어제 목록도 없으면 고정만(오류 없음)');
    ok(run({ snapshotAt: new Date(NOW - 47 * 3600e3).toISOString() }).auto.stale === false, '47시간 = 믿음');
    ok(run({ snapshotAt: new Date(NOW - 3600e3) }).auto.stale === false, 'run_at 이 Date 꼴이어도 됨');
}
console.log('⑤ 보안 확인 판정(실제 JS_BLOCK_CHECK)');
{
    const judge = (text, imgs) => vm.runInNewContext(KR.JS_BLOCK_CHECK, { document: { body: { innerText: text }, querySelector: () => imgs || null } });
    eq(judge('NAVER\n보안 확인을 완료해 주세요\n영수증 사진의 가게 전화번호를 입력'), 'security', '11/3 실측 글자 = security');
    eq(judge('보안확인을 완료해 주세요'), 'security', '붙여 쓴 꼴도');
    eq(judge('접속이 일시적으로 제한되었습니다'), 'blocked', '종전 차단 그대로');
    eq(judge('자동입력 방지 문자'), 'captcha', '종전 캡차 그대로');
    eq(judge('영수증 프린터 쇼핑 결과 · 보안 카메라 확인'), '', '일반 글자 = 안 걸림');
}
// 가짜 어사이드(MCP 손잡이 대신 replJson 만)
function fakeAside(script) {
    const calls = [];
    return { calls, async replJson(title) { calls.push(title); return script(title, calls); } };
}
const CFG = kws => ({ keywords: kws, store: { names: ['제주아꼼이네'], hosts: [] }, max_rank: 40 });
const SHOP_OK = { items: [{ ad: false, mall: '제주아꼼이네' }], page: 1, hasNext: false };
const collect = (a, kws) => KR.collectRows({ aside: a, cfg: CFG(kws), readMobile: false, readPc: true, storePl: 'pc', log: () => { } });
(async () => {
    console.log('⑥ 키워드 고리 — 막히면 멈춤');
    {
        let a = fakeAside(t => /쇼핑/.test(t) ? SHOP_OK : { ads: ['제주아꼼이네 광고'], total: 1 });
        let r = await collect(a, ['귤', '레몬']);
        ok(!r.blocked && r.errors.length === 0 && r.rows.map(x => x.shopping).join() === '1,1' && r.rows[1].powerlink === 1, '정상 = 종전과 같음', r);

        a = fakeAside(t => /「제주귤」/.test(t) && /쇼핑/.test(t) ? { items: null, blocked: 'security' } : /쇼핑/.test(t) ? SHOP_OK : { ads: [], total: 0 });
        r = await collect(a, ['귤', '제주귤', '감귤', '레몬']);
        eq(r.blocked, { kind: 'security', keyword: '제주귤', skipped: 2 }, '둘째에서 보안 확인 = 멈춤·남은 2');
        ok(!a.calls.some(t => /감귤|레몬|통합검색\(pc\) 「제주귤」/.test(t)), '남은 키워드·그 키워드 파워링크 호출 0', a.calls);
        eq(r.rows.map(x => x.keyword), ['귤', '제주귤', '감귤', '레몬'], '줄은 전부 있음');
        ok(r.rows[0].shopping === 1 && !r.rows[0].error, '막히기 전 값 유지');
        eq(r.errors.map(e => e.keyword), ['제주귤', '감귤', '레몬'], 'errors = 막힌 것·남은 것');

        a = fakeAside(t => /쇼핑/.test(t) ? { items: null, title: '' } : { ads: [], total: 0 });
        r = await collect(a, ['귤', '제주귤', '감귤', '황금향']);
        eq(r.blocked, { kind: 'list_missing', keyword: '제주귤', skipped: 2 }, '목록 못 찾음 2연속 = 멈춤(글자가 또 바뀌어도)');
        ok(a.calls.filter(t => /쇼핑/.test(t)).length === 2, '쇼핑 호출 2번뿐', a.calls);

        let n = 0;
        a = fakeAside(t => { if (!/쇼핑/.test(t)) return { ads: [], total: 0 }; n++; return n % 2 ? { items: null, title: '' } : SHOP_OK; });
        r = await collect(a, ['a', 'b', 'c', 'd']);
        ok(!r.blocked && r.errors.length === 2, '띄엄띄엄 못 찾음 = 안 멈춤', r.blocked);

        a = fakeAside(t => /쇼핑/.test(t) ? SHOP_OK : { ads: null, blocked: 'security' });
        r = await collect(a, ['귤', '감귤']);
        eq(r.blocked, { kind: 'security', keyword: '귤', skipped: 1 }, '파워링크에서 막혀도 멈춤');
        ok(r.rows[0].shopping === null && r.rows[0].error, '그 키워드 = 세 칸 null(종전 규칙)');
    }

    console.log('⑦ 재수집 알림');
    {
        const D = '2026-11-03';
        ok(KR.krResetNotified({ date: D, notified_date: D, errors: [{ keyword: '귤' }] }, D), '직전 errors = 비움');
        ok(KR.krResetNotified({ date: D, notified_date: D, errors: [], blocked: { kind: 'security' } }, D), '직전 blocked = 비움');
        ok(!KR.krResetNotified({ date: D, notified_date: D, errors: [], blocked: null }, D), '직전 정상 = 안 비움(하루 1통)');
        ok(!KR.krResetNotified({ date: '2026-11-02', notified_date: '2026-11-02', errors: [{}] }, D), '어제 것 = 안 비움');
        ok(!KR.krResetNotified({ date: D, errors: [{}] }, D), '아직 안 보냄 = 그대로');
    }

    console.log('⑧ 본체(--apply · --list) = 가짜 pool + 가짜 어사이드 프로세스');
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1001-'));
        const pre = path.join(dir, 'pre.js'), fa = path.join(dir, 'fake-aside.js'), outF = path.join(dir, 'out.json'), callF = path.join(dir, 'calls.txt');
        fs.writeFileSync(fa, `const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', l => { const m = JSON.parse(l); if (m.id == null) return; let result = {};
  if (m.method === 'tools/list') result = { tools: [{ name: 'repl' }] };
  if (m.method === 'tools/call') { const t = m.params.arguments.title; require('fs').appendFileSync(process.env.FAKE_LOG, t + '\\n'); const mode = process.env.FAKE_MODE; let o = {};
    if (/쇼핑/.test(t)) o = mode === 'security' ? { items: null, blocked: 'security' } : { items: [{ ad: false, mall: '제주아꼼이네' }], page: 1, hasNext: false };
    else if (/통합검색/.test(t)) o = { ads: ['제주아꼼이네'], total: 1 };
    result = { content: [{ type: 'text', text: JSON.stringify(o) }] }; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });`);
        fs.writeFileSync(pre, `const Module = require('module'), cp = require('child_process'), fs = require('fs');
const real = cp.spawn; cp.spawn = (exe, args, o) => real(process.execPath, [${JSON.stringify(fa)}], o);
const S = JSON.parse(process.env.FAKE_STATE); const writes = [];
const pool = { async query(sql, p) { const q = sql.replace(/\\s+/g, ' ');
    if (/key = 'keyword_rank_last'/.test(q) && /^SELECT/.test(q)) return { rows: S.last ? [{ value: S.last }] : [] };
    if (/key = 'keyword_rank'/.test(q)) return { rows: [{ value: S.cfg }] };
    if (/FROM naver_product_snapshot/.test(q)) return { rows: S.snap ? [S.snap] : [] };
    if (/information_schema/.test(q)) return { rows: [{}] };
    if (/INSERT INTO keyword_rankings/.test(q)) { writes.push({ t: 'row', p }); return { rows: [{ inserted: true }] }; }
    if (/keyword_rank_last/.test(q)) { writes.push({ t: 'last', v: JSON.parse(p[0]) }); return { rows: [] }; }
    if (/audit_logs/.test(q)) { writes.push({ t: 'audit' }); return { rows: [] }; }
    throw new Error('예상 밖 SQL: ' + q.slice(0, 80)); }, async end() {} };
const orig = Module._load; Module._load = function (req, parent, isMain) { if (req === './_db') return { pool }; return orig.apply(this, arguments); };
process.on('exit', () => fs.writeFileSync(${JSON.stringify(outF)}, JSON.stringify(writes)));`);
        const main = path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js');
        const go = (args, state, mode) => {
            fs.writeFileSync(callF, '');
            const r = spawnSync(process.execPath, ['-r', pre, main, ...args], { encoding: 'utf8', timeout: 90000, env: Object.assign({}, process.env, { DATABASE_URL: '', KR_PAGE_WAIT_MS: '300', ASIDE_EXE: process.execPath, FAKE_STATE: JSON.stringify(state), FAKE_MODE: mode || 'ok', FAKE_LOG: callF }) });
            let w = []; try { w = JSON.parse(fs.readFileSync(outF, 'utf8')); } catch (e) { /* 없음 */ }
            return { code: r.status, out: r.stdout, err: r.stderr, writes: w, calls: fs.readFileSync(callF, 'utf8').split('\n').filter(Boolean) };
        };
        const snap = { run_at: new Date().toISOString(), items: items() };
        const cfg = { keywords: FIXED, enabled: true, powerlink_source: 'pc', auto: SEED };
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

        let r = go(['--list'], { cfg, snap });
        let j = null; try { j = JSON.parse(r.out.trim().split('\n').pop()); } catch (e) { /* 아래 */ }
        ok(j && j.keywords.length === 12 && j.keywords.includes('감귤체험'), '--list = 12개', r.err || r.out.slice(-300));
        eq(r.writes, [], '--list = 쓰기 0');

        r = go(['--apply', '--mobile-only'], { cfg: Object.assign({}, cfg, { keywords: ['귤'], auto: { rules: [{ no: 7673020911, keywords: ['감귤체험'] }], ignore: SEED.ignore.concat(['11126666859', '6400134206', '5531798664']) } }), snap });
        let last = (r.writes.find(w => w.t === 'last') || {}).v;
        ok(r.code === 0 && last && last.rows.map(x => x.keyword).join() === '귤,감귤체험', '--apply 정상 = 고정+자동 저장', r.err || last);
        ok(last && last.blocked === null && last.auto && last.auto.keywords.join() === '감귤체험', 'blocked null 로 덮음(합치기 대비) · auto 칸', last);
        ok(last && !('notified_date' in last), '첫 수집 = notified_date 안 건드림');
        ok(r.calls.includes('탭 정리'), '정상 끝 = 탭 정리 함', r.calls);

        r = go(['--apply'], { cfg: Object.assign({}, cfg, { keywords: ['귤', '감귤'], auto: undefined }), snap }, 'security');
        last = (r.writes.find(w => w.t === 'last') || {}).v;
        ok(r.code === 2 && last && last.blocked && last.blocked.kind === 'security' && last.blocked.skipped === 1, '보안 확인 --apply = exit 2 · last.blocked', r.err || last);
        eq(r.writes.filter(w => w.t === 'row'), [], '막힌 키워드 = DB 줄 0(종전 규칙 · 10:00 미수집 살아 있음)');
        ok(r.calls.length > 0 && !r.calls.includes('탭 정리'), '막힘 = 탭 정리 안 함(보안 확인 탭 남김)', r.calls);

        r = go(['--apply'], { cfg: { keywords: ['귤'], powerlink_source: 'pc' }, snap, last: { date: today, notified_date: today, errors: [{ keyword: '귤' }], blocked: { kind: 'security' } } });
        last = (r.writes.find(w => w.t === 'last') || {}).v;
        ok(last && last.notified_date === '' && last.blocked === null, '풀고 재수집 = notified_date 비움·blocked 지움', r.err || last);
        ok(last && last.auto === null, '자동 설정 없음 = auto null · 키워드 칸만(종전과 같음)', last);
        ok(last && last.rows.map(x => x.keyword).join() === '귤', '자동 설정 없음 = 키워드 칸 그대로');

        r = go(['--apply', '--keywords', '레몬'], { cfg, snap });
        last = (r.writes.find(w => w.t === 'last') || {}).v;
        ok(last && !('auto' in last) && last.rows.map(x => x.keyword).join() === '레몬', '--keywords 시험 = 자동 목록 안 건드림', last);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('⑨ 서버 틱 실코드(가짜 db · 텔레그램 가짜)');
    {
        const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
        const a = SRV.indexOf('// ── #910 키워드 순위 알림 시작'), b = SRV.indexOf('// ── #910 키워드 순위 알림 끝');
        const sent = [], notis = [];
        const mod = new Function('pool', 'notifyTelegram', 'createNotification', 'kstTodayStr', 'setInterval', 'console', SRV.slice(a, b) + '\nreturn { keywordRankNotifyTick, krNoticeLines };')(null, async t => { sent.push(t); }, async (...x) => { notis.push(x); }, () => '2026-11-03', () => ({}), console);
        const D = '2026-11-03';
        const rowsOf = kws => kws.map(k => ({ is_today: true, keyword: k, shopping_rank: 3, ad_rank: null, powerlink_rank: 1 }));
        const dbOf = (cfg, last, rows) => ({ async query(sql) {
            if (/UPDATE agent_office_config/.test(sql)) return { rows: [{ value: last }] };
            if (/FROM agent_office_config/.test(sql)) return { rows: [{ value: cfg }] };
            if (/FROM keyword_rankings/.test(sql)) return { rows };
            if (/FROM users/.test(sql)) return { rows: [{ id: 1 }] };
            throw new Error('예상 밖 ' + sql); } });
        const tick = (cfg, last, rows) => { sent.length = 0; notis.length = 0; return mod.keywordRankNotifyTick({ db: dbOf(cfg, last, rows), today: D, hm: '09:40' }); };

        // 표 순서가 뒤섞여 와도 고정 → 자동 순서
        await tick({ keywords: ['귤'] }, { date: D, at: '2026-11-03T00:35:00Z', errors: [], blocked: null, auto: { keywords: ['감귤체험', '레몬'], unmapped: [], cut: [], stale: false } }, rowsOf(['레몬', '귤', '감귤체험']));
        let txt = sent.join('\n'), L = txt.split('\n');
        eq(L.slice(2).map(x => x.split('(')[0]), ['귤', '감귤체험', '레몬'], '텔레그램 줄 = 고정 → 자동 순서');
        ok(/^아꼼이네 주요 키워드/.test(L[0]), '안내 없으면 머리 줄 종전 그대로');
        ok(/귤 3위 · 감귤체험 3위 · 레몬 3위/.test(notis[0][3]), '종 알림도 자동 포함', notis[0]);

        await tick({ keywords: ['귤'] }, { date: D, errors: [], auto: { keywords: [], unmapped: [{ no: '1', name: '제주 새품목' }, { no: '2', name: '감귤', opt: '하우스' }], cut: ['제주레몬'], stale: true } }, rowsOf(['귤']));
        L = sent.join('\n').split('\n');
        ok(L.includes('키워드 없는 판매 상품: 제주 새품목, 감귤/하우스'), '끝 줄 = 키워드 없는 판매 상품', L);
        ok(L.includes('상한(20개) 넘어 못 모음: 제주레몬'), '끝 줄 = 상한');
        ok(L.some(x => /스냅샷/.test(x)), '끝 줄 = 스냅샷 낡음');
        ok(/^귤\(/.test(L[2]), '키워드 줄 위치 그대로');

        await tick({ keywords: ['귤', '감귤'] }, { date: D, errors: [{ keyword: '귤' }, { keyword: '감귤' }], blocked: { kind: 'security', keyword: '귤', skipped: 1 } }, []);
        L = sent.join('\n').split('\n');
        ok(/^⚠️ 네이버 보안 확인 필요 · 1개 못 모음 · 어사이드 창에서 풀어/.test(L[0]), '첫 줄 = 보안 확인 필요', L[0]);
        ok(L.includes('귤 (읽기 실패)'), '키워드 줄 = 읽기 실패 유지');
        ok(/^⚠️ 보안 확인 필요/.test(notis[0][3]), '종 알림 첫머리');

        await tick({ keywords: ['귤'] }, { date: D, errors: [], blocked: { kind: 'list_missing', skipped: 0 } }, rowsOf(['귤']));
        ok(/^⚠️ 네이버 쇼핑 목록을 못 읽어 멈춤\(보안 확인일 수 있음\) · 어사이드/.test(sent.join('\n')), 'list_missing 글');

        await tick({ keywords: ['귤'] }, { date: D, errors: [] }, rowsOf(['귤', '손으로넣은것']));
        L = sent.join('\n').split('\n');
        ok(L.some(x => x.startsWith('손으로넣은것(')) && L.length === 4, '옛 자료(auto·blocked 칸 없음) = 종전 글 그대로', L);
        const many = Array.from({ length: 8 }, (_, i) => ({ no: String(i), name: '상품' + i }));
        ok(/ 외 3$/.test(mod.krNoticeLines({ auto: { unmapped: many } }).tail[0]), '짝 없음 많으면 5개 + 외 n');
    }

    if (process.argv.includes('--no-ui')) { console.log('화면 건너뜀(--no-ui)'); return; }
    console.log('⑩ 순위관리 칸(실제 index.html 마크업 + 실제 app.js 구간 + 가짜 api)');
    {
        const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
        const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'), app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
        const s0 = html.indexOf('.rank-kw-chips {'), s1 = html.indexOf('</style>', s0), c0 = html.indexOf('<div class="card" id="rank-kw-card"'), c1 = html.indexOf('<div class="rank-auto-note"', c0);
        const code = app.slice(app.indexOf('let _rankKw = null;'), app.indexOf('// 카톡 텍스트 파싱'));
        if (s0 < 0 || c0 < 0 || c1 < 0 || !code.includes('renderRankAuto')) throw new Error('마크업·코드 구간 못 찾음');
        const css = ['theme.css', 'styles.css'].filter(f => fs.existsSync(path.join(ROOT, 'public', f))).map(f => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');
        const br = await chromium.launch();
        for (const w of [390, 900]) {
            const page = await br.newPage({ viewport: { width: w, height: 800 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
            const open = async last => {
                await page.goto('about:blank');   // 새 전역(let 재선언 막기)
                await page.setContent(`<!doctype html><meta charset=utf-8><style>${css}\n${html.slice(s0, s1)}</style><body>${html.slice(c0, c1)}<div class="rank-auto-note" id="rank-auto-note" hidden></div></body>`);
                await page.addScriptTag({ content: `window.__put=[];window.api=async(u,m,b)=>{if(m==='PUT'){__put.push(b);return{success:true,keywords:b.keywords}}return ${JSON.stringify({ keywords: FIXED, last })}};\n${code}\nwindow.__load=loadRankKeywords;` });
                await page.evaluate(() => window.__load());
            };
            await open({ date: '2026-11-03', blocked: null, auto: { keywords: ['감귤체험', '레몬', '귤'], unmapped: [{ no: '1', name: '<b>새품목</b>' }], cut: ['제주레몬'], stale: true } });
            const fixedChips = await page.locator('#rank-kw-chips .rank-kw-chip').count(), autoChips = await page.locator('#rank-kw-auto .rank-kw-chip').allInnerTexts();
            eq(fixedChips, 4, w + ' 고정 칩 4');
            eq(autoChips, ['감귤체험', '레몬'], w + ' 자동 칩(고정과 겹침 뺌)');
            eq(await page.locator('#rank-kw-auto button').count(), 0, w + ' 자동 칩 × 없음');
            const t = await page.locator('#rank-kw-auto').innerText();
            ok(/11\/3 기준/.test(t) && /키워드 없는 판매 상품: <b>새품목<\/b>/.test(t) && /상한 넘어 못 모음: 제주레몬/.test(t) && /스냅샷/.test(t), w + ' 안내 줄(HTML 은 글자로)', t);
            eq(await page.locator('#rank-kw-auto b').count(), 0, w + ' 이스케이프');
            ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), w + ' 가로 넘침 없음');
            await page.locator('#rank-kw-chips [data-kw-del="3"]').click();
            await page.locator('#rank-kw-save-btn').click();
            await page.waitForFunction(() => window.__put.length === 1);
            eq((await page.evaluate(() => window.__put[0])).keywords, ['귤', '제주귤', '감귤'], w + ' × 저장 = 고정만 PUT');
            await open({ date: '2026-11-03', blocked: { kind: 'security', skipped: 3 } });
            ok(/보안 확인에 막혀/.test(await page.locator('#rank-kw-auto').innerText()) && !(await page.locator('#rank-kw-auto .rank-kw-chip').count()), w + ' 막힘 안내(auto 칸 없어도)');
            await open({ date: '2026-11-03', blocked: null, auto: { keywords: [], unmapped: [], cut: [], stale: false } });
            ok(/지금은 없어요/.test(await page.locator('#rank-kw-auto').innerText()), w + ' 자동 0개 빈 상태');
            await open({ date: '2026-11-03', rows: [] });
            eq(await page.locator('#rank-kw-auto').count(), 0, w + ' 자동 설정 전 = 칸 없음(종전 화면)');
            eq(errs, [], w + ' 화면 오류 0');
            await page.close();
        }
        await br.close();
    }
})().catch(e => { fail++; console.log('✗ 중단: ' + (e && e.stack || e)); }).finally(() => { console.log(`\n결과 ${pass}/${pass + fail}${fail ? ' · 실패 ' + fail : ''}`); process.exit(fail ? 1 : 0); });

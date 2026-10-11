// #642 검증: 알림톡 버튼 링크가 「그 주문」을 가리킨다 — /guide?p=<주문 표식 13자리> → 그 주문의 품목으로 안내문을 찾는다
//   대표가 원한 것 3가지를 그대로 본다: ①판매현황 행을 지워도 열림 ②행 이름을 바꿔도(또는 지우고 새로 만들어도) 열림 ③발송 때 연결이 실패했어도 나중에 판매현황에 행을 넣으면 열림
//   + 남의 표식을 넣어도 보이는 것은 상품 안내문뿐 · 기록 줄이 없는 표식도 500 없이 묶음 목록 · 종전 번호 링크는 종전 서버와 바이트 동일
//   새 서버(SERVER642 · 없으면 ./server.js · 포트 3466) + 종전(#642 바로 앞 = v5.9.497 커밋 3546fca → _server_old_642.js · 3467 · 끝에 지움 — HEAD 로 두면 배포 뒤에는 자기 자신과 견주게 된다). 브라우저 없음.
//   실DB 쓰기 = 시험 줄뿐: 판매현황 「[시험642] …」(준비중 · 봇·목록에 안 나옴) 몇 줄 + 발송 기록 order_key 「v642…」 몇 줄 → 끝에 전부 지움(이 검증이 방금 넣은 줄만).
//   실제 판매현황 행·실제 발송 기록은 건드리지 않는다. 알림톡·문자 발송 0(발송 함수를 부르지 않는다 — 표식 만들기·기록 남기기·페이지 풀이만).
//   실행: node scripts/verify-642-guide-order.js
require('dotenv').config();
const path = require('path'), fs = require('fs'), crypto = require('crypto'); const { spawn, execFileSync } = require('child_process'); const { Client } = require('pg');
const ROOT = path.join(__dirname, '..'), NEW = Number(process.env.PORT642 || 3466), ALT = NEW + 1, OLD_FILE = '_server_old_642.js', SECRET = 'verifytest';
const SERVER = process.env.SERVER642 || './server.js';
const kakaoNotify = require(path.join(ROOT, 'kakao-notify.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + String(d).slice(0, 260) : '')); };
const start = (file, port) => spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require(${JSON.stringify(file)});`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: SECRET, PORT: String(port) }, stdio: 'ignore' });
const waitUp = async port => { for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${port}/track-order`); if (r.status) return true; } catch (_) { } } return false; };
const page = async (port, q) => { const r = await fetch(`http://localhost:${port}/guide${q}`, { headers: { Connection: 'close' } }); const t = await r.text(); return { status: r.status, t, open: (t.match(/<details class="item" open>/g) || []).length, items: (t.match(/<details class="item"/g) || []).length, mine: /주문하신 상품<\/div>/.test(t), listTitle: /<div class="sec-title">판매 중 상품 안내<\/div>/.test(t), names: (t.match(/<summary>([^<]*)<\/summary>/g) || []).map(s => s.replace(/<\/?summary>/g, '')) }; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TAG = '[시험642]', KEY = 'v642';

(async () => {
    const src = fs.readFileSync(path.join(ROOT, SERVER), 'utf8');
    fs.writeFileSync(path.join(ROOT, OLD_FILE), execFileSync('git', ['show', (process.env.OLD642 || '3546fca') + ':server.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
    const sNew = start(SERVER, NEW), sOld = start('./' + OLD_FILE, ALT);
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    // 시험 줄은 숨김이 아니라 DELETE 로 지운다(예외) — 판매현황·발송 기록 표에는 숨김으로 남겨도 화면·집계(발송 건수·연결 실패 셈)에 섞이기 때문. 이 검증이 넣은 「[시험642]」·「v642」 줄만 지운다.
    const clean = async () => { await db.query(`DELETE FROM lms_guide_log WHERE order_key LIKE $1`, [KEY + '%']); await db.query(`DELETE FROM bot_products WHERE name LIKE $1`, [TAG + '%']); };
    try {
        console.log('⓪ 코드');
        const fa = src.indexOf('const GUIDE_TOKEN_MIN = '), fb = src.indexOf('\n}', src.indexOf('async function guideResolveByToken(')) + 2;
        ok(fa > 0 && fb > fa, '도우미 구획(GUIDE_TOKEN_MIN · guideOrderToken · guideLogMeta · guideResolveByToken)이 있음');
        ok((src.match(/'상품코드': guideOrderToken\(orderKey\),/g) || []).length === 2 && !/'상품코드': String\(\(matched && matched\.id\)/.test(src), '버튼 링크 값 = 주문 표식(네이버·자사몰 2곳) · 판매현황 번호를 싣던 옛 줄 0');
        ok((src.match(/await guideLogMeta\(orderKey, /g) || []).length === 4, '발송 기록 뒤 표식·옵션 남기기 4곳(네이버 수집 · 네이버 재발송 · 자사몰 · 쿠팡)', String((src.match(/await guideLogMeta\(orderKey, /g) || []).length));
        {   // 각 길에서 기록 INSERT 보다 뒤에 도는지 — 그 함수 구간 안에서 마지막 INSERT 뒤에 guideLogMeta 가 있어야 한다
            const seg = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
            const after = s => s.lastIndexOf('INSERT INTO lms_guide_log') > 0 && s.lastIndexOf('guideLogMeta(') > s.lastIndexOf('INSERT INTO lms_guide_log');
            ok(after(seg('async function collectLmsGuide()', '\nasync function ', )) || after(src.slice(src.indexOf('async function collectLmsGuide()'), src.indexOf('async function collectLmsGuide()') + 9000)), '네이버 수집 길: 기록 INSERT 뒤(finally)에서 남김');
            const c24 = src.slice(src.indexOf("const targets = shipped.filter(o => !seen.has('c24:' + o.order_id));")); ok(after(c24.slice(0, c24.indexOf('    return ', 4000) > 0 ? c24.indexOf('    return ', 4000) : 9000)), '자사몰 길: 기록 INSERT 뒤(finally)에서 남김');
        }
        ok(src.includes('gMatched = out.matched || null;') && src.includes('let _gM = gMatched; if (_gM === undefined)'),'네이버 수집 길: 발송에 쓴 연결 결과(out.matched)를 그대로 적음(발송 전에 실패한 건만 다시 계산)');
        ok(/const isToken = Number\.isSafeInteger\(pRaw\) && pRaw >= GUIDE_TOKEN_MIN;/.test(src) && /const pid = \(!isToken && pRaw > 0 && pRaw <= 2147483647\) \? pRaw : 0;/.test(src), '/guide: 표식 갈래를 먼저 가르고 판매현황 번호 조회에는 정수 범위 안 값만');
        const g = src.slice(src.indexOf("app.get('/guide'"), src.indexOf("app.get('/track'"));
        ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(g) && !/\b(INSERT|UPDATE|DELETE)\b/.test(src.slice(src.indexOf('async function guideResolveByToken('), fb)), '/guide 구획·표식 풀이에 쓰기 0');

        const [u1, u2] = await Promise.all([waitUp(NEW), waitUp(ALT)]);
        if (!u1 || !u2) throw new Error('로컬 서버가 안 떴어요(새 ' + u1 + ' · 종전 ' + u2 + ')');
        await db.connect(); await clean();
        // 서버 도우미를 떼어 같은 열쇠로 실행(발송 함수는 부르지 않는다)
        const H = new Function('pool', 'crypto', 'JWT_SECRET', 'kakaoNotify', 'console', src.slice(fa, fb) + '; return { guideOrderToken, guideLogMeta, guideResolveByToken, GUIDE_TOKEN_MIN };')(db, crypto, SECRET, kakaoNotify, { error() { } });
        const tok = k => H.guideOrderToken(k);

        console.log('① 표식');
        const t1 = tok(KEY + ':a'), t2 = tok('2026101112345678'), t3 = tok('c24:20261011-0000012');
        ok([t1, t2, t3].every(x => /^8\d{12}$/.test(x) && Number.isSafeInteger(Number(x)) && Number(x) >= H.GUIDE_TOKEN_MIN), '숫자 13자리 · 8로 시작(앞자리 0 없음) · 안전한 수 범위 · 종전 번호와 크기로 구분', [t1, t2, t3].join(' '));
        ok(tok(KEY + ':a') === t1 && tok(KEY + ':b') !== t1 && !t2.includes('2026101112345678'.slice(0, 8)), '같은 주문 = 같은 값 · 다른 주문 = 다른 값 · 주문번호 글자가 표식에 그대로 안 실림');
        const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'alimtalk-templates.json'), 'utf8'));
        const links = JSON.stringify(tpl).match(/guide\?p=#\{상품코드\}/g) || [];
        ok(links.length >= 2 && `https://jeju-acom-company.onrender.com/guide?p=${t1}`.length < 80 && /^[0-9]+$/.test(t1), '템플릿 버튼 주소(…/guide?p=#{상품코드}) 그대로 · 치환 뒤 주소 ' + `https://jeju-acom-company.onrender.com/guide?p=${t1}`.length + '자 · 값은 숫자만(같은 묶음 #{송장번호}와 같은 꼴)');

        // 시험 줄 만들기
        const mkP = async (name, guide, status) => (await db.query(`INSERT INTO bot_products (name, status, price, shipping_guide) VALUES ($1, $2, '', $3) RETURNING id`, [TAG + ' ' + name, status || '준비중', guide])).rows[0].id;
        const mkLog = async (key, name) => { await db.query(`INSERT INTO lms_guide_log (order_key, product_name, receiver_masked, mode, status) VALUES ($1, $2, '010-****-0000', 'dry-run', 'sent') ON CONFLICT (order_key) DO NOTHING`, [key, name]); };
        const nmA = '가품목 / 상품 및 과수: 시험옵션 - 1kg(로얄과)', nmB = '나품목 / 상품 및 과수: 시험옵션 - 2kg(로얄과)', nmC = '다품목 / 상품 및 과수: 시험옵션 - 3kg(로얄과)';
        const optOf = nm => '아꼼이네 상품선택: ' + TAG + ' ' + nm;   // 옵션 원문에 품목 이름이 통째로 들어 있는 꼴(통째 포함 연결)
        const A = await mkP(nmA, '시험642 안내문 가\n둘째 줄'), B = await mkP(nmB, '시험642 안내문 나');
        const sellN = new Set((await db.query(`SELECT shipping_guide FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND shipping_guide IS NOT NULL AND btrim(shipping_guide) <> ''`)).rows.map(r => r.shipping_guide.trim())).size;
        const isList = a => a.status === 200 && !a.mine && a.listTitle && a.items === sellN && !a.t.includes('시험642');

        console.log('② 기록 남기기(guideLogMeta) — 기록 INSERT 뒤 UPDATE');
        const kA = KEY + ':a', kB = KEY + ':b', kC = KEY + ':c', kD = 'c24:' + KEY + '-d';
        await mkLog(kA, nmA); await H.guideLogMeta(kA, { opt: optOf(nmA), pno: '6400134206', pid: A });
        let row = (await db.query(`SELECT guide_token, guide_opt, guide_pno::text AS pno, guide_pid FROM lms_guide_log WHERE order_key = $1`, [kA])).rows[0];
        ok(row && row.guide_token === tok(kA) && row.guide_opt === optOf(nmA) && row.pno === '6400134206' && row.guide_pid === A, '표식·옵션 원문·네이버 상품번호·연결된 행 번호가 그 줄에 남음', JSON.stringify(row));
        let threw = false; try { await H.guideLogMeta(KEY + ':없는줄', { opt: 'x', pid: 1 }); await H.guideLogMeta('', null); await H.guideLogMeta(kA, { opt: optOf(nmA), pno: 'abc', pid: A }); } catch (e) { threw = true; }
        row = (await db.query(`SELECT guide_pno::text AS pno, guide_pid FROM lms_guide_log WHERE order_key = $1`, [kA])).rows[0];
        ok(!threw && row.pno === '6400134206' && row.guide_pid === A && (await db.query(`SELECT COUNT(*)::int c FROM lms_guide_log WHERE order_key = $1`, [KEY + ':없는줄'])).rows[0].c === 0, '줄이 아직 없으면 헛돌 뿐(줄을 만들지 않음) · 빈 열쇠·이상한 상품번호에도 오류 없이 넘어감');
        const badPool = { query: async () => { throw new Error('DB 끊김'); } };
        const Hbad = new Function('pool', 'crypto', 'JWT_SECRET', 'kakaoNotify', 'console', src.slice(fa, fb) + '; return { guideLogMeta, guideResolveByToken };')(badPool, crypto, SECRET, kakaoNotify, { error() { } });
        threw = false; let rz = 'x'; try { await Hbad.guideLogMeta(kA, { opt: 'x' }); rz = await Hbad.guideResolveByToken(tok(kA)); } catch (e) { threw = true; }
        ok(!threw && rz === null, 'DB 가 실패해도 기록 남기기·표식 풀이 둘 다 던지지 않음(발송·페이지 흐름을 막지 않음)');

        console.log('③ 대표가 원한 것 1 — 판매현황 행을 지워도 열림');
        let a = await page(NEW, '?p=' + tok(kA));
        ok(a.status === 200 && a.open === 1 && a.items === 1 && a.mine && a.names[0] === esc(TAG + ' ' + nmA) && a.t.includes('시험642 안내문 가<br>둘째 줄'), '표식 링크 → 그 주문 품목의 안내문 1장(펼침) · 목록 안 붙음', JSON.stringify({ open: a.open, items: a.items, names: a.names }));
        await db.query(`UPDATE bot_products SET deleted_at = now() WHERE id = $1 AND name LIKE $2`, [A, TAG + '%']);
        a = await page(NEW, '?p=' + tok(kA));
        ok(a.open === 1 && a.items === 1 && a.names[0] === esc(TAG + ' ' + nmA), '그 행을 삭제(soft)해도 같은 링크가 그대로 열림');
        await db.query(`UPDATE bot_products SET status = '시즌종료' WHERE id = $1 AND name LIKE $2`, [A, TAG + '%']);
        a = await page(NEW, '?p=' + tok(kA)); ok(a.open === 1 && a.names[0] === esc(TAG + ' ' + nmA), '삭제 + 시즌종료여도 열림');

        console.log('④ 대표가 원한 것 2 — 행 이름을 바꿔도 · 지우고 새로 만들어도');
        await mkLog(kB, nmB); await H.guideLogMeta(kB, { opt: optOf(nmB), pid: B });
        await db.query(`UPDATE bot_products SET name = $2 WHERE id = $1`, [B, TAG + ' 나품목(이름 바꿈) 2kg']);
        a = await page(NEW, '?p=' + tok(kB));
        ok(a.open === 1 && a.items === 1 && a.names[0] === esc(TAG + ' 나품목(이름 바꿈) 2kg') && a.t.includes('시험642 안내문 나'), '이름을 바꿔도 열림(연결된 행 번호로 따라감 · 새 이름으로 보임)');
        await db.query(`UPDATE bot_products SET shipping_guide = '시험642 안내문 나(고침)' WHERE id = $1`, [B]);
        a = await page(NEW, '?p=' + tok(kB)); ok(a.t.includes('시험642 안내문 나(고침)'), '안내문을 고치면 이미 나간 링크에도 고친 글이 보임');
        await db.query(`UPDATE bot_products SET deleted_at = now() WHERE id = $1`, [B]);
        const B2 = await mkP(nmB, '시험642 안내문 나(새 행)');
        a = await page(NEW, '?p=' + tok(kB));
        ok(a.open === 1 && a.items === 1 && a.names[0] === esc(TAG + ' ' + nmB) && a.t.includes('시험642 안내문 나(새 행)') && B2 !== B, '옛 행을 지우고 같은 옵션 이름으로 새 행을 만들면 → 옵션 원문으로 다시 연결돼 새 행 안내문이 보임(삭제된 옛 글보다 먼저)');

        console.log('⑤ 대표가 원한 것 3 — 발송 때 연결 실패 → 나중에 판매현황에 행을 넣으면 열림');
        await mkLog(kC, nmC); await H.guideLogMeta(kC, { opt: optOf(nmC), pid: null });
        row = (await db.query(`SELECT guide_pid, guide_token FROM lms_guide_log WHERE order_key = $1`, [kC])).rows[0];
        ok(row.guide_pid === null && row.guide_token === tok(kC), '연결 실패로 나간 줄 = 연결된 행 번호 비어 있음(나중에 「연결 실패」로 셀 수 있음)');
        a = await page(NEW, '?p=' + tok(kC));
        ok(isList(a), '아직 맞는 행이 없을 때 = 빈 화면이 아니라 판매 중 상품 묶음 목록(' + sellN + '장 · #639)', JSON.stringify({ items: a.items, mine: a.mine }));
        const C = await mkP(nmC, '시험642 안내문 다');
        a = await page(NEW, '?p=' + tok(kC));
        ok(a.open === 1 && a.items === 1 && a.mine && a.names[0] === esc(TAG + ' ' + nmC) && a.t.includes('시험642 안내문 다') && C > 0, '판매현황에 그 품목 행을 넣자 같은 링크가 바로 열림');
        await mkLog(kD, nmC); await H.guideLogMeta(kD, { opt: `${TAG} 다품목 · 시험옵션 3kg(로얄과)`, pid: null });
        a = await page(NEW, '?p=' + tok(kD));
        ok(a.open === 1 && a.names[0] === esc(TAG + ' ' + nmC), '자사몰 주문(c24:)은 자사몰 발송 때와 같은 느슨한 연결 규칙으로 다시 연결');

        console.log('⑥ 못 찾는 표식 · 남의 표식 · 이상한 값');
        a = await page(NEW, '?p=' + tok(KEY + ':기록없음'));
        ok(isList(a), '기록 줄이 없는 표식(기록 실패·보관표로 옮겨짐) = 500 없이 묶음 목록');
        for (const [label, q] of [['정수 칸보다 큰 수(30억)', '?p=3000000000'], ['안전 범위 밖 큰 수', '?p=99999999999999999999'], ['음수', '?p=-5'], ['표식 + 글자', '?p=' + tok(kA) + 'abc']]) { a = await page(NEW, q); ok(a.status === 200 && (label.startsWith('표식') ? a.names[0] === esc(TAG + ' ' + nmA) : isList(a)), `${label}: 500 없이 ${label.startsWith('표식') ? '숫자 부분만 읽어 그 주문 안내문' : '묶음 목록'}`, a.status + ' ' + a.items); }
        a = await page(NEW, '?p=' + tok(kC));
        const leak = [kA, kB, kC, KEY, '010-****-0000', tok(kC), '6400134206'].filter(x => a.t.includes(x));
        ok(leak.length === 0 && a.items === 1, '남의 표식을 넣어 열어도 화면·HTML 에 주문 열쇠·번호·표식·상품번호 0 — 상품 안내문 1장뿐', leak.join(','));

        console.log('⑥-b 틀린 안내보다 묶음 목록(교차 점검 손질)');
        {   // (나) 진짜 짝(긴 이름)에 안내문이 없으면, 이름이 더 짧은 형제 행의 안내문을 대신 보여 주지 않는다
            const nmLong = '라품목 / 상품 및 과수: 시험옵션 - 4kg(로얄과)', kE = KEY + ':e';
            await mkP('라품목', '시험642 형제 행 안내문(다른 옵션용)'); await mkP(nmLong, null);
            await mkLog(kE, nmLong); await H.guideLogMeta(kE, { opt: optOf(nmLong), pid: null });
            a = await page(NEW, '?p=' + tok(kE));
            ok(isList(a), '옵션 원문의 진짜 짝에 안내문이 없을 때 = 짧은 이름의 형제 행 안내문을 대신 띄우지 않고 묶음 목록', JSON.stringify({ mine: a.mine, names: a.names.slice(0, 2) }));
            await db.query(`UPDATE bot_products SET shipping_guide = '시험642 안내문 라(나중에 채움)' WHERE name = $1`, [TAG + ' ' + nmLong]);
            a = await page(NEW, '?p=' + tok(kE));
            ok(a.open === 1 && a.items === 1 && a.names[0] === esc(TAG + ' ' + nmLong) && a.t.includes('시험642 안내문 라(나중에 채움)'), '그 짝에 안내문을 채우면 같은 링크가 그 글로 열림');
        }
        {   // (가) 같은 네이버 상품의 판매중 행 대체 = 안내문이 전부 같은 글일 때만 — 판매중 시험 행을 실DB 에 넣으면 봇 판매현황에 비칠 수 있어, 서버 함수에 가짜 조회 결과를 물려 본다(DB 0)
            const mkPool = sib => ({ query: async sql => /FROM lms_guide_log/.test(sql) ? { rows: [{ order_key: '2026101100000001', guide_opt: null, guide_pno: '777', guide_pid: null }] } : /naver_product_no = \$1/.test(sql) ? { rows: sib } : { rows: [] } });
            const run = sib => new Function('pool', 'crypto', 'JWT_SECRET', 'kakaoNotify', 'console', src.slice(fa, fb) + '; return guideResolveByToken;')(mkPool(sib), crypto, SECRET, kakaoNotify, { error() { } })('8000000000001');
            const same = await run([{ id: 1, name: '가', shipping_guide: '같은 글' }, { id: 2, name: '나', shipping_guide: ' 같은 글 ' }]);
            const diff = await run([{ id: 1, name: '가', shipping_guide: '귤 글' }, { id: 2, name: '나', shipping_guide: '황금향 글' }]);
            const none = await run([]);
            ok(same && same.id === 1 && diff === null && none === null, '같은 네이버 상품의 판매중 행 대체 = 안내문이 전부 같은 글일 때만(옵션마다 글이 다르면 묶음 목록 · 없으면 묶음 목록)', JSON.stringify({ same: same && same.id, diff, none }));
        }

        console.log('⑦ 종전 링크(판매현황 번호) = 종전 서버와 바이트 동일');
        const sell = (await db.query(`SELECT id FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND shipping_guide IS NOT NULL AND btrim(shipping_guide) <> '' ORDER BY id LIMIT 1`)).rows[0];
        const prep = (await db.query(`SELECT id FROM bot_products WHERE deleted_at IS NULL AND status <> '판매중' AND name NOT LIKE $1 AND shipping_guide IS NOT NULL AND btrim(shipping_guide) <> '' ORDER BY id DESC LIMIT 1`, [TAG + '%'])).rows[0];
        const del = (await db.query(`SELECT id FROM bot_products WHERE deleted_at IS NOT NULL AND name NOT LIKE $1 AND shipping_guide IS NOT NULL AND btrim(shipping_guide) <> '' ORDER BY id DESC LIMIT 1`, [TAG + '%'])).rows[0];
        for (const [label, q] of [['판매중 품목 번호', sell && '?p=' + sell.id], ['판매중 아닌 품목 번호', prep && '?p=' + prep.id], ['삭제된 품목 번호', del && '?p=' + del.id], ['번호 없음', ''], ['빈 번호', '?p='], ['p=0', '?p=0'], ['없는 번호', '?p=99999999'], ['숫자 아닌 값', '?p=abc']]) {
            if (q == null) { console.log('  ℹ️ ' + label + ' — 실DB 에 해당 품목이 없어 건너뜀'); continue; }
            const x = await page(NEW, q), y = await page(ALT, q); ok(x.status === 200 && x.t === y.t, `${label}: 종전 서버와 바이트 동일(${x.t.length}자)`, `새 ${x.t.length} / 종전 ${y.t.length}`);
        }
    } catch (e) { fail++; console.log('  ✗ 중단: ' + (e && e.stack || e)); }
    finally {
        try { await clean(); const l1 = (await db.query(`SELECT COUNT(*)::int c FROM lms_guide_log WHERE order_key LIKE $1`, [KEY + '%'])).rows[0].c + (await db.query(`SELECT COUNT(*)::int c FROM lms_guide_log WHERE order_key LIKE $1`, ['c24:' + KEY + '%'])).rows[0].c, l2 = (await db.query(`SELECT COUNT(*)::int c FROM bot_products WHERE name LIKE $1`, [TAG + '%'])).rows[0].c; if (l1) await db.query(`DELETE FROM lms_guide_log WHERE order_key LIKE $1`, ['c24:' + KEY + '%']); const l1b = (await db.query(`SELECT COUNT(*)::int c FROM lms_guide_log WHERE order_key LIKE $1 OR order_key LIKE $2`, [KEY + '%', 'c24:' + KEY + '%'])).rows[0].c; ok(l1b === 0 && l2 === 0, '정리: 시험 발송 기록·시험 판매현황 줄 전부 지움', l1b + ' / ' + l2); } catch (e) { fail++; console.log('  ✗ 정리 실패: ' + e.message); }
        await db.end().catch(() => { }); sNew.kill(); sOld.kill(); await sleep(600); try { fs.unlinkSync(path.join(ROOT, OLD_FILE)); } catch (_) { }
    }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();

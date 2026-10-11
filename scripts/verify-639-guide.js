// #639 검증: 알림톡 [맛있게 드시는 법·보관법] 링크(/guide?p=번호)
//   ①링크 번호가 가리키는 품목은 삭제돼도 안내문이 뜬다 ②고른 품목이 없을 때(번호 없음·못 찾음·안내문 없음)만 「판매 중 상품 안내」 묶음 목록(스위치 GUIDE_LIST_WHEN_EMPTY)
//   ③고른 품목이 있으면 종전 서버(git HEAD)와 바이트 동일 ④스위치를 끄면 ①만 남고 나머지는 종전과 바이트 동일
//   서버 셋을 차례로 띄운다: 새 서버(SERVER639 · 없으면 ./server.js · 포트 3466) + 종전(git HEAD → _server_old_639.js · 3467) → 종전을 내리고 스위치 끈 사본(_server_off_639.js · 3467). 두 임시 파일은 끝에 지운다.
//   실DB 읽기만(쓰기 0 · 스케줄러 막음). 브라우저 없음(HTML 수준 — 폰 390 가로 넘침은 따로).
//   실행: node scripts/verify-639-guide.js
require('dotenv').config();
const path = require('path'), fs = require('fs'); const { spawn, execFileSync } = require('child_process'); const { Client } = require('pg');
const ROOT = path.join(__dirname, '..'), NEW = Number(process.env.PORT639 || 3466), ALT = NEW + 1, OLD_FILE = '_server_old_639.js', OFF_FILE = '_server_off_639.js';
const SERVER = process.env.SERVER639 || './server.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + String(d).slice(0, 260) : '')); };
const start = (file, port) => spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require(${JSON.stringify(file)});`], { cwd: ROOT, env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(port) }, stdio: 'ignore' });
const waitUp = async port => { for (let i = 0; i < 90; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${port}/track-order`); if (r.status) return true; } catch (_) { } } return false; };
const waitDown = async port => { for (let i = 0; i < 20; i++) { try { await fetch(`http://localhost:${port}/track-order`); } catch (_) { return true; } await sleep(500); } return false; };
const page = async (port, q) => { const r = await fetch(`http://localhost:${port}/guide${q}`, { headers: { Connection: 'close' } }); const t = await r.text(); return { status: r.status, t, open: (t.match(/<details class="item" open>/g) || []).length, items: (t.match(/<details class="item"/g) || []).length, mine: /주문하신 상품<\/div>/.test(t), hint: /버튼으로 접속하시면/.test(t), pickMsg: /주문하신 상품의 안내를 아래에서 골라 보세요/.test(t), listTitle: /<div class="sec-title">판매 중 상품 안내<\/div>/.test(t), names: (t.match(/<summary>([^<]*)<\/summary>/g) || []).map(s => s.replace(/<\/?summary>/g, '')) }; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

(async () => {
    const src = fs.readFileSync(path.join(ROOT, SERVER), 'utf8');
    fs.writeFileSync(path.join(ROOT, OLD_FILE), execFileSync('git', ['show', 'HEAD:server.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
    const offSrc = src.replace('const GUIDE_LIST_WHEN_EMPTY = true;', 'const GUIDE_LIST_WHEN_EMPTY = false;');
    fs.writeFileSync(path.join(ROOT, OFF_FILE), offSrc);
    const sNew = start(SERVER, NEW); let sAlt = start('./' + OLD_FILE, ALT);
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
        console.log('⓪ 코드');
        const g = src.slice(src.indexOf("app.get('/guide'"), src.indexOf("app.get('/track'"));
        ok(/const GUIDE_LIST_WHEN_EMPTY = (true|false);/.test(src) && offSrc !== src ? true : /const GUIDE_LIST_WHEN_EMPTY = false;/.test(src), '스위치 상수 GUIDE_LIST_WHEN_EMPTY 가 있음(지금 값 ' + ((src.match(/const GUIDE_LIST_WHEN_EMPTY = (true|false);/) || [])[1]) + ')');
        ok(/const GUIDE_SHOW_OTHERS = false;/.test(src), '「다른 상품들」 스위치(GUIDE_SHOW_OTHERS · #235)는 꺼진 그대로');
        ok(/WHERE id = \$1 AND shipping_guide IS NOT NULL/.test(g) && !/WHERE id = \$1 AND deleted_at IS NULL/.test(g), '링크 번호 조회에 삭제 여부 조건 없음');
        ok(/WHERE deleted_at IS NULL AND status = '판매중' AND shipping_guide IS NOT NULL/.test(g), '목록은 판매중·미삭제만');
        ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(g), '/guide 구획에 쓰기 0');
        const on = /const GUIDE_LIST_WHEN_EMPTY = true;/.test(src);

        const [u1, u2] = await Promise.all([waitUp(NEW), waitUp(ALT)]);
        if (!u1 || !u2) throw new Error('로컬 서버가 안 떴어요(새 ' + u1 + ' · 종전 ' + u2 + ')');
        await db.connect();
        const one = async sql => (await db.query(sql)).rows[0] || null;
        const G = `shipping_guide IS NOT NULL AND btrim(shipping_guide) <> ''`;
        const sell = await one(`SELECT id, name FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND ${G} ORDER BY id LIMIT 1`);
        const prep = await one(`SELECT id, name FROM bot_products WHERE deleted_at IS NULL AND status <> '판매중' AND ${G} ORDER BY id DESC LIMIT 1`);
        const del = await one(`SELECT id, name FROM bot_products WHERE deleted_at IS NOT NULL AND ${G} ORDER BY id DESC LIMIT 1`);
        const bare = await one(`SELECT id FROM bot_products WHERE NOT (${G}) ORDER BY id DESC LIMIT 1`);
        const sellRows = (await db.query(`SELECT name, shipping_guide FROM bot_products WHERE deleted_at IS NULL AND status = '판매중' AND ${G} ORDER BY name`)).rows;
        const groupN = new Set(sellRows.map(r => r.shipping_guide.trim())).size;
        const NONE = 99999999;
        console.log(`  (고른 번호: 판매중 ${sell && sell.id} · 판매중 아님 ${prep && prep.id} · 삭제+안내문 ${del && del.id} · 안내문 없음 ${bare && bare.id} · 판매중 안내문 ${sellRows.length}행 = 묶음 ${groupN}개)`);
        // 묶음 제목은 서버 함수를 떼어 같은 자료로 계산해 대조
        const fa = src.indexOf('function guideGroupName('), fb = src.indexOf('\n}', src.indexOf('function guideGroups(')) + 2;
        const groups = new Function(src.slice(fa, fb) + '; return guideGroups;')()(sellRows);

        const picks = [['판매중 품목', sell], ['판매중 아닌 품목(#540)', prep]];
        const empties = [['번호 없음(/guide)', ''], ['빈 번호(/guide?p=)', '?p='], ['p=0', '?p=0'], ['없는 번호', '?p=' + NONE], ['숫자 아닌 값', '?p=abc']].concat(bare ? [['안내문 없는 품목(' + bare.id + ')', '?p=' + bare.id]] : []);
        const oldPages = {}; for (const [, q] of empties) oldPages[q] = await page(ALT, q);
        if (del) oldPages.del = await page(ALT, '?p=' + del.id);
        for (const [, r] of picks) if (r) oldPages['p' + r.id] = await page(ALT, '?p=' + r.id);

        console.log('① 고른 품목이 있으면 종전과 바이트 동일');
        for (const [label, r] of picks) {
            if (!r) { ok(false, label + ' — 실DB 에 해당 품목이 없어 못 봄'); continue; }
            const a = await page(NEW, '?p=' + r.id), b = oldPages['p' + r.id];
            ok(a.status === 200 && a.t === b.t && a.open === 1 && a.items === 1 && a.mine && a.names[0] === esc(r.name), `${label}(${r.id}): 종전 서버와 바이트 동일(${a.t.length}자) · 그 품목 1장만 펼침 · 목록 안 붙음`, `새 ${a.t.length} / 종전 ${b.t.length} · items ${a.items}`);
        }

        console.log('② 삭제된 품목(안내문 있음) — 이미 나간 링크');
        if (!del) ok(false, '실DB 에 「삭제 + 안내문 있음」 품목이 없어 못 봄');
        else {
            const a = await page(NEW, '?p=' + del.id), b = oldPages.del;
            ok(a.status === 200 && a.open === 1 && a.items === 1 && a.mine && a.names[0] === esc(del.name) && !a.hint && !a.listTitle, `삭제된 품목(${del.id}): 안내문이 펼쳐져 뜸 · 그 품목 이름 · 목록 안 붙음`, JSON.stringify({ open: a.open, items: a.items, names: a.names.slice(0, 2) }));
            ok(b.open === 0 && b.items === 0 && b.hint, '(대조) 종전 서버는 같은 번호에서 안내문 0 · 안내 글 한 줄뿐 = 고치기 전 증상');
        }

        console.log('③ 고른 품목이 없을 때 — 스위치 ' + (on ? '켬: 판매 중 상품 묶음 목록' : '끔: 종전과 같음'));
        for (const [label, q] of empties) {
            const a = await page(NEW, q), b = oldPages[q];
            if (on) {
                ok(a.status === 200 && a.items === groupN && a.listTitle && a.pickMsg && !a.hint && !a.mine && a.open === (groupN === 1 ? 1 : 0), `${label}: 묶음 ${groupN}장(${groupN === 1 ? '한 장뿐이라 펼침' : '접힌 채'}) + 「아래에서 골라 보세요」 · 종전 안내 글 한 줄은 없음`, JSON.stringify({ items: a.items, open: a.open, list: a.listTitle, msg: a.pickMsg, hint: a.hint }));
                ok(b.items === 0 && b.hint, `(대조) ${label}: 종전 서버는 목록 0 · 안내 글 한 줄뿐`);
            } else ok(a.t === b.t, `${label}: 종전 서버와 바이트 동일`, `새 ${a.t.length} / 종전 ${b.t.length}`);
        }
        if (on) {
            const a = await page(NEW, '');
            ok(JSON.stringify(a.names) === JSON.stringify(groups.map(x => esc(x.name))), '묶음 제목 = 서버 함수가 같은 자료로 낸 품목명 그대로 · 가나다순', a.names.join(' | '));
            ok(new Set(a.names).size === a.names.length && a.names.every(n => n.length >= 2 && !/상품 및 과수|과수 및 크기/.test(n) && !/\d+\s*kg/i.test(n)), '묶음 제목에 중복·옵션 꼬리표(「상품 및 과수」)·무게 숫자 없음', a.names.join(' | '));
            ok(groups.reduce((s, x) => s + x.count, 0) === sellRows.length, '묶음에 든 품목 수 합 = 판매중 안내문 행 수(' + sellRows.length + ')');
            console.log('    (묶음: ' + groups.map(x => x.name + ' ' + x.count).join(' · ') + ')');
        }

        console.log('④ 스위치를 끈 사본 — ①만 남고 나머지는 종전과 같음');
        sAlt.kill(); await waitDown(ALT); sAlt = start('./' + OFF_FILE, ALT);
        if (!(await waitUp(ALT))) throw new Error('스위치 끈 서버가 안 떴어요');
        for (const [label, q] of empties) { const a = await page(ALT, q); ok(a.t === oldPages[q].t, `(끔) ${label}: 종전 서버와 바이트 동일`, `끔 ${a.t.length} / 종전 ${oldPages[q].t.length}`); }
        for (const [label, r] of picks) if (r) { const a = await page(ALT, '?p=' + r.id); ok(a.t === oldPages['p' + r.id].t, `(끔) ${label}: 종전 서버와 바이트 동일`); }
        if (del) { const a = await page(ALT, '?p=' + del.id); ok(a.open === 1 && a.items === 1 && a.names[0] === esc(del.name), '(끔) 삭제된 품목: 안내문은 그대로 뜸(이건 스위치와 무관)'); }

        console.log('⑤ 묶음 제목 함수(단위)');
        const N = new Function(src.slice(fa, src.indexOf('\nfunction guideGroups(')) + '; return guideGroupName;')();
        const t = l => N(l).title;
        ok(t(['고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)', '고당도 하우스감귤 / 상품 및 과수: 선물용 - 3kg(로얄과)']) === '고당도 하우스감귤', '「품목 / 상품 및 과수: 옵션」들 → 품목명');
        ok(t(['과수 및 크기: 제주 그린레몬10kg(중소과)', '과수 및 크기: 제주 그린레몬3kg(중소과)']) === '제주 그린레몬' && t(['과수 및 크기: 제주산 레드키위 10kg(로얄과)', '과수 및 크기: 제주산 레드키위 3kg(로얄과)']) === '제주산 레드키위', '앞 꼬리표·무게를 뗀 공통 이름');
        ok(t(['미니밤호박 특품 5kg']) === '미니밤호박 특품' && t(['황금향 3kg', '레드키위 2kg']) === '황금향 · 레드키위' && t([]) === '', '한 품목 · 공통 부분 없음(「·」로) · 빈 목록');
    } catch (e) { fail++; console.log('  ✗ 중단: ' + (e && e.stack || e)); }
    finally { await db.end().catch(() => { }); sNew.kill(); sAlt.kill(); await sleep(600); for (const f of [OLD_FILE, OFF_FILE]) { try { fs.unlinkSync(path.join(ROOT, f)); } catch (_) { } } }
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();

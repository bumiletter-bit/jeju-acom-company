// #1256 검증 — 옵션 글의 「(행사)」를 품목 열쇠가 가려 보는지(실DB·네트워크·브라우저 0 · server.js·price-check.js 를 떼어 실행)
//   ① 「(행사)」 없는 글의 열쇠 = HEAD 와 글자 그대로(무회귀)  ② 05:10 네이버↔자사몰 옵션 결제가 대조(server.js 그 구간을 그대로 떼어 실행):
//      행사 줄이 양쪽에 맞게 있으면 불일치 0 · 행사 줄 값이 틀리면 알림 · 자사몰에 행사 줄이 없으면 「네이버엔 있는데 없음」 · 행사와 무관한 불일치는 종전 그대로
//   ③ 공개 스냅샷 짝 글자(storeSnapshotForMall): 행사 줄이 기존 줄 글자로 짝지어지지 않음 · 기존 줄의 결과는 행사 줄이 없을 때와 같음
//   ④ price-check.js optionKey: 행사 줄 묶음 열쇠만 다름 · label·by 는 같음(발주·자동 송장·메모함 무변경) · cafe24OptKey 사본 = server.js 와 같은 결과
//   사용: node scripts/verify-1256-event-key.js
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); } };
const cur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const head = execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 256 << 20 }).toString().replace(/\r\n/g, '\n');
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('표식 없음: ' + a); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('끝 표식 없음: ' + b); return src.slice(i, j); };
function load(src) {
    const fns = cut(src, 'function cafe24OptKey(s) {', 'async function collectCafe24Sync(');
    /* 05:10 대조 구간 = 상품 하나 몫(「const nOpts = {};」 ~ 「await new Promise(r => setTimeout(r, 300));」) 을 그대로 */
    const seg = cut(src, '            const nOpts = {};', '            await new Promise(r => setTimeout(r, 300));\n        }\n    } catch (e) { rep.errors.push(\'옵션 결제가 감지 실패');
    const run = new Function('sn', 'cp', 'm', 'tag', 'rep', 'ignoreKeys', 'optTexts', 'cafe24', fns + '\nreturn (async () => { for (const _one of [0]) {\n' + seg + '\n} return rep; })();');
    const lib = new Function(fns + '\nreturn { cafe24OptKey, storeSnapshotForMall };')();
    return { run, lib };
}
const C = load(cur), H = load(head);
const PC = require(path.join(ROOT, 'price-check.js'));

// ── 가짜 자료(실제 꼴 · 11/23 c92 · 값은 그날 값) ──
const N1 = { t: '1. (제철)고당도 타이벡감귤', n: '2. (제철)새콤달콤 노지감귤', h: '3. (제철)과즙팡팡 황금향' };
const BASE_N = 31800, BASE_C = 12800;
const REG = [[N1.t, '가정용 - 5kg(로얄과 2S~M)', 31800], [N1.t, '선물용 - 3kg(로얄과 2S~M)', 28800], [N1.t, '가정용 - 3kg(로얄과 2S~M)', 22800], [N1.t, '가정용 - 10kg(로얄과 2S~M)', 54800],
    [N1.n, '가정용 - 3kg(중대과 L이상)', 12800], [N1.n, '가정용 - 10kg(로얄과 2S~M)', 29800], [N1.n, '가정용 - 10kg(소과 2S미만)', 27800],
    [N1.h, '노지 황금향 가정용 - 5kg(혼합과)', 30100], [N1.h, '노지 황금향 가정용 - 10kg(혼합과)', 57800], [N1.h, '황금향 선물용 - 3kg(중대과 7~15과)', 35800]];
const EV = [[N1.t, '(행사) 가정용 - 5kg(로얄과 2S~M)', 29800], [N1.n, '(행사) 가정용 - 10kg(로얄과 2S~M)', 27800], [N1.h, '(행사)노지 황금향 가정용-5kg(혼합과)', 28100], [N1.h, '(행사)노지 황금향 가정용-10kg(혼합과)', 54800]];
const nOpt = ([n1, n2, pay]) => ({ n1, n2, price: pay - BASE_N, stock: 99999, usable: true });
const cVar = ([n1, n2, pay], i) => ({ variant_code: 'P' + i, display: 'T', selling: 'T', additional_amount: String(pay - BASE_C) + '.00', options: [{ name: '상품 선택', value: n1 + ' · ' + n2 }] });
const snOf = rows => ({ no: 6400134206, discPrice: BASE_N, opts: rows.map(nOpt) });
const cafeOf = rows => ({ apiGet: async () => ({ variants: rows.map(cVar) }) });
const runOne = async (L, nRows, cRows) => { const rep = { optMismatch: [], optMissing: [], errors: [] }; const optTexts = {}; await L.run(snOf(nRows), { price: String(BASE_C), display: 'T', product_name: '제주 감귤' }, { c24: 92 }, 'c92', rep, new Set(), optTexts, cafeOf(cRows)); return { rep, optTexts }; };

(async () => {
    console.log('── ① 「(행사)」 없는 글의 열쇠 = HEAD 그대로');
    const corpus = REG.map(r => r[0] + ' ' + r[1]).concat(['1. (제철)고당도 하우스감귤 · (특가)하우스감귤 가정용 - 2.5kg(소과)', '1. (제철)고당도 하우스감귤 · 행사★하우스귤 2.5kg로얄과→중량up 4kg', '과수 및 크기: 제주 그린레몬3kg(중소과)', '1. (제철)홍귤 산하홍 · 로얄과 - 5kg(가정용 2S~M)', '미니밤호박 꼬마 10+1개', '', '행사 가정용 - 5kg(로얄과 2S~M)']);
    ok(corpus.every(t => C.lib.cafe24OptKey(t) === H.lib.cafe24OptKey(t)), '행사 표식 없는 글 ' + corpus.length + '개(「행사★」·괄호 없는 「행사」 포함) = HEAD 와 같은 열쇠');
    ok(EV.every(r => C.lib.cafe24OptKey(r[0] + ' ' + r[1]) === H.lib.cafe24OptKey(r[0] + ' ' + r[1]) + '|행사'), '「(행사)」 줄 4개 = 기존 열쇠 + 「|행사」', EV.map(r => C.lib.cafe24OptKey(r[0] + ' ' + r[1])));
    ok(EV.every((r, i) => { const twin = [REG[0], REG[5], REG[7], REG[8]][i]; return C.lib.cafe24OptKey(r[0] + ' ' + r[1]).replace('|행사', '') === C.lib.cafe24OptKey(twin[0] + ' ' + twin[1]); }), '행사 줄 열쇠에서 「|행사」를 떼면 짝이 되는 기존 줄 열쇠(띄어쓰기 붙인 황금향 이름 포함)');
    ok(corpus.every(t => PC.cafe24OptKey(t) === C.lib.cafe24OptKey(t)) && EV.every(r => PC.cafe24OptKey(r[0] + ' · ' + r[1]) === C.lib.cafe24OptKey(r[0] + ' · ' + r[1])), 'price-check.js 사본 = server.js 와 같은 결과');

    console.log('── ② 05:10 옵션 결제가 대조(그 구간을 떼어 실행)');
    const a0 = await runOne(H, REG, REG), a1 = await runOne(C, REG, REG);
    ok(JSON.stringify(a0.rep) === JSON.stringify(a1.rep) && a1.rep.optMismatch.length === 0 && a1.rep.optMissing.length === 0, '행사 줄 없음 = HEAD 와 같은 결과(불일치 0)');
    ok(JSON.stringify(a0.optTexts) === JSON.stringify(a1.optTexts), '행사 줄 없음 = 설정에 적는 카페24 글자·열쇠도 HEAD 와 같음');
    const hb = await runOne(H, EV.concat(REG), REG.concat(EV)), nb = await runOne(C, EV.concat(REG), REG.concat(EV));
    ok(hb.rep.optMismatch.length === 4, '(종전) 행사 줄이 양쪽에 맞게 있어도 불일치 4건으로 알림 — 고치려는 것', hb.rep.optMismatch);
    ok(nb.rep.optMismatch.length === 0 && nb.rep.optMissing.length === 0 && nb.rep.errors.length === 0, '(지금) 행사 줄이 양쪽에 맞게 있음 = 불일치 0 · 없는 옵션 0', nb.rep);
    const wrong = REG.concat(EV.map((r, i) => i === 0 ? [r[0], r[1], 30800] : r)); const nc = await runOne(C, EV.concat(REG), wrong);
    ok(nc.rep.optMismatch.length === 1 && nc.rep.optMismatch[0].c24 === 30800 && nc.rep.optMismatch[0].naver === 29800 && /가정용 - 5kg\(로얄과 2S~M\)$/.test(nc.rep.optMismatch[0].name), '자사몰 행사 줄 값이 틀림(30,800 ≠ 29,800) = 그 줄만 알림(네이버 행사 값과 견줌 · 알림 글은 옵션 글 뒤 22자)', nc.rep.optMismatch);
    const nd = await runOne(C, EV.concat(REG), REG);
    ok(nd.rep.optMismatch.length === 0 && nd.rep.optMissing.length === 1 && nd.rep.optMissing[0].opts.length === 4 && nd.rep.optMissing[0].opts.every(x => /행사/.test(x)), '자사몰에 행사 줄이 없음 = 「네이버엔 있는데 카페24에 없음」 4개로 알림(값 불일치로는 안 셈)', nd.rep);
    const regWrong = REG.map((r, i) => i === 2 ? [r[0], r[1], 23800] : r); const he = await runOne(H, REG, regWrong), ne = await runOne(C, EV.concat(REG), regWrong.concat(EV));
    ok(he.rep.optMismatch.length === 1 && JSON.stringify(he.rep.optMismatch) === JSON.stringify(ne.rep.optMismatch), '행사와 무관한 진짜 불일치(기존 3kg 줄 +1,000) = 행사 줄이 있어도 종전과 같은 알림 1건', ne.rep.optMismatch);
    const soldEv = { no: 1, discPrice: BASE_N, opts: EV.map(nOpt).map(o => Object.assign(o, { stock: 0 })).concat(REG.map(nOpt)) }; const repS = { optMismatch: [], optMissing: [], errors: [] }; await C.run(soldEv, { price: String(BASE_C), display: 'T', product_name: 'x' }, { c24: 92 }, 'c92', repS, new Set(), {}, cafeOf(REG));
    ok(repS.optMismatch.length === 0 && repS.optMissing.length === 0, '행사 끝(네이버 행사 줄 재고 0 · 자사몰 행사 줄 미노출) = 알림 0');

    console.log('── ③ 공개 스냅샷 짝 글자(storeSnapshotForMall)');
    const map = { map: { '6400134206': { c24: 92 } } }, ig = { keys: ['x|x|x|x'] };
    const textsOf = (L, rows) => ({ by: { '92': rows.map(r => ({ t: r[0] + ' · ' + r[1], k: L.lib.cafe24OptKey(r[0] + ' · ' + r[1]) })) } });
    const item = rows => [{ no: 6400134206, name: '제주 노지 감귤 타이벡 하우스', statusType: 'SALE', opts: rows.map(nOpt) }];
    const outH0 = H.lib.storeSnapshotForMall(item(REG), map, ig, textsOf(H, REG), null)[0].opts;
    const outC0 = C.lib.storeSnapshotForMall(item(REG), map, ig, textsOf(C, REG), null)[0].opts;
    ok(JSON.stringify(outH0) === JSON.stringify(outC0), '행사 줄 없음 = HEAD 와 바이트까지 같은 결과');
    const outC = C.lib.storeSnapshotForMall(item(EV.concat(REG)), map, ig, textsOf(C, REG.concat(EV)), null)[0].opts;
    const evOut = outC.filter(o => /\(행사\)/.test(o.n2)), regOut = outC.filter(o => !/\(행사\)/.test(o.n2));
    ok(evOut.length === 4 && evOut.every(o => o.c24t === o.n1 + ' · ' + o.n2), '행사 줄 4개 = 자기 카페24 글자와 짝(기존 줄 글자 아님)', evOut.map(o => o.c24t));
    ok(JSON.stringify(regOut) === JSON.stringify(outC0), '기존 줄의 결과 = 행사 줄이 없을 때와 같음(짝 글자 유지)');
    const outOld = C.lib.storeSnapshotForMall(item(EV.concat(REG)), map, ig, textsOf(H, REG), null)[0].opts.filter(o => /\(행사\)/.test(o.n2));
    ok(outOld.every(o => !o.c24t), '설정이 아직 옛 꼴(행사 글자 없음 · 배포 직후 ~ 다음 05:10)이어도 행사 줄이 기존 줄 글자로 짝지어지지 않음(짝 없음 → 화면 글자로 찾음)', outOld.map(o => o.c24t));
    const outMix = C.lib.storeSnapshotForMall(item(EV.concat(REG)), map, ig, textsOf(H, REG.concat(EV)), null)[0].opts;
    ok(outMix.filter(o => /\(행사\)/.test(o.n2)).every(o => !o.c24t || o.c24t === o.n1 + ' · ' + o.n2), '설정에 행사 글자가 옛 열쇠로 적혀 있어도(11/23 손으로 더한 6줄) 행사 줄이 기존 줄 글자로 안 감', outMix.filter(o => /\(행사\)/.test(o.n2)).map(o => o.c24t));
    ok(outMix.filter(o => !/\(행사\)/.test(o.n2)).every(o => !o.c24t || o.c24t === o.n1 + ' · ' + o.n2), '… 그때 기존 줄도 행사 줄 글자로 안 감');

    console.log('── ④ price-check.js optionKey(가격 대조 묶음 · 발주 품목 이름)');
    const names = REG.map(r => r[0].replace(/^\d+\.\s*\(제철\)/, '') + ' / 상품 및 과수: ' + r[1]);
    const pairs = [[REG[0], EV[0]], [REG[5], EV[1]], [REG[7], EV[2]], [REG[8], EV[3]]];
    for (const [r, e] of pairs) { const a = PC.optionKey([r[0], r[1]], names), b = PC.optionKey([e[0], e[1]], names); ok(a.by === 'match' && b.by === 'match' && a.label === b.label && b.key === a.key + '|행사', '「' + e[1] + '」 = 단가표 이름은 기존 줄과 같고(' + b.label.slice(-24) + ') 묶음 열쇠만 「|행사」', { a, b }); }
    const one = PC.optionKey(['제주 감귤 상품 선택=' + EV[0][0] + ' · ' + EV[0][1]], names); ok(one.by === 'match' && one.label === names[0], '자사몰 주문 글 꼴(한 덩이)도 단가표 이름 그대로', one);
    console.log('\n합계 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1); });

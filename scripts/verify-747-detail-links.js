// #747 검증 — 자사몰 상세 블록(parseDetailBlocks)에 그림 링크 상품 번호(lk · ig 는 lks) 담기
//   실제 네이버 상세 원문(naver_product_backups 의 before_json.originProduct.detailContent · 4상품 최신 보관본)에
//   옛 함수(git HEAD server.js)와 새 함수(작업본)를 같이 돌려: lk·lks 를 뺀 블록이 바이트 동일 · lk 수·번호 보고 · 가짜 HTML 로 규칙 확인
//   실DB = SELECT 만 · 실행: node scripts/verify-747-detail-links.js
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✅', m); } else { failN++; console.log('  ❌', m, d !== undefined ? JSON.stringify(d).slice(0, 400) : ''); } };
const J = JSON.stringify;
// server.js 에서 이름으로 함수·상수 원문 떼기(중괄호 짝)
function grab(src, head) {
    const a = src.indexOf(head); if (a < 0) throw new Error('못 찾음 ' + head);
    if (/^const /.test(head)) { const e = src.indexOf(';\n', a); const e2 = src.indexOf(';\r\n', a); const end = [e, e2].filter(x => x > 0).sort((x, y) => x - y)[0]; return src.slice(a, end + 1); }
    let i = src.indexOf('{', a), d = 0, e = i;
    for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (!d) break; } }
    return src.slice(a, e + 1);
}
function load(src, withLinks) {
    const parts = [grab(src, 'function stripMapWidgets('), grab(src, 'function sanitizeDetailHtml(')];
    if (withLinks) parts.push(grab(src, 'const DETAIL_NAVER_PRODUCT_RE'), grab(src, 'function detailLinkNoBefore('));
    parts.push(grab(src, 'function parseDetailBlocks('));
    return new Function(parts.join('\n') + '\nreturn parseDetailBlocks;')();
}
const strip = (bs) => bs.map(b => { const c = { ...b }; delete c.lk; delete c.lks; return c; });

(async () => {
    const cur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const old = execSync('git show HEAD:server.js', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    const pNew = load(cur, true), pOld = load(old, false);

    console.log('① 가짜 HTML 규칙');
    {
        const H = '<p>앞 글</p>'
            + '<a href="https://smartstore.naver.com/akkome/products/6400134206"><img src="https://shop-phinf.pstatic.net/a.jpg"></a>'
            + '<a href="https://brand.naver.com/jejuakkome/products/11126666859?x=1"><img src="https://shop-phinf.pstatic.net/b.jpg"></a>'
            + '<a class="se-module-image-link" href="#" data-linkdata="{&quot;link&quot;:&quot;https://m.smartstore.naver.com/akkome/products/5531798664&quot;}"><img src="https://shop-phinf.pstatic.net/c.jpg"></a>'
            + '<a href="https://map.naver.com/x"><img src="https://shop-phinf.pstatic.net/d.jpg"></a>'
            + '<a href="https://blog.naver.com/akkome/1"><img src="https://shop-phinf.pstatic.net/e.jpg"></a>'
            + '<img src="https://shop-phinf.pstatic.net/f.jpg">'
            + '<a href="https://smartstore.naver.com/other/products/123456"><img src="https://shop-phinf.pstatic.net/g.jpg"></a>'
            + '<div class="se-imageStrip-container se-imageStrip-col-2"><div><a href="https://smartstore.naver.com/akkome/products/13782816361"><img src="https://shop-phinf.pstatic.net/h.jpg"></a><img src="https://shop-phinf.pstatic.net/i.jpg"></div></div>'
            + '<p>뒤 글</p>';
        const bn = pNew(H), bo = pOld(H);
        const imgs = bn.filter(b => b.t === 'i');
        ok(J(imgs.map(b => b.lk || null)) === J(['6400134206', '11126666859', '5531798664', null, null, null, null]), '네이버 상품 주소(스마트스토어·브랜드·m.·data-linkdata) = lk · 지도·블로그·다른 스토어·링크 없음 = 안 담음', imgs.map(b => [b.src.slice(-5), b.lk]));
        const ig = bn.find(b => b.t === 'ig');
        ok(ig && J(ig.lks) === J(['13782816361', null]) && J(ig.srcs) === J(['https://shop-phinf.pstatic.net/h.jpg', 'https://shop-phinf.pstatic.net/i.jpg']), 'imageStrip = lks(srcs 와 같은 순서 · 없으면 null)', ig);
        ok(J(strip(bn)) === J(bo), 'lk·lks 를 빼면 옛 함수 결과와 바이트 동일(블록 수·순서·src·글)', [bn.length, bo.length]);
        const noLink = '<p>글</p><img src="https://shop-phinf.pstatic.net/z.jpg">';
        ok(J(pNew(noLink)) === J(pOld(noLink)), '링크 없는 상세 = 옛 결과와 완전히 같음(lk 칸 없음)');
    }

    console.log('② 실제 네이버 상세 4상품(최신 보관본)');
    const { pool } = require(path.join(ROOT, 'scripts/desk/_db.js'));
    try {
        const nos = ['6400134206', '11126666859', '5531798664', '13782816361'];
        const rows = (await pool.query(`SELECT DISTINCT ON (product_no) product_no, id, before_json->'originProduct'->>'detailContent' AS html FROM naver_product_backups WHERE product_no = ANY($1) AND COALESCE(result_json->>'op','') <> 'create_failed' ORDER BY product_no, id DESC`, [nos])).rows;
        ok(rows.length === 4, '보관본 4상품', rows.map(r => r.product_no + '#' + r.id));
        for (const r of rows) {
            const bn = pNew(r.html || ''), bo = pOld(r.html || '');
            const lks = bn.flatMap(b => b.t === 'i' ? (b.lk ? [b.lk] : []) : b.t === 'ig' && b.lks ? b.lks.filter(Boolean) : []);
            const same = J(strip(bn)) === J(bo);
            ok(same && bn.length === bo.length, `#${r.product_no}(보관본 ${r.id}) 블록 ${bn.length} = 옛 ${bo.length} · lk·lks 빼면 바이트 동일 · lk ${lks.length}개 [${[...new Set(lks)].join(', ')}]`, same ? undefined : { new: bn.length, old: bo.length });
        }
    } finally { await pool.end(); }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('검증 오류', e); process.exit(1); });

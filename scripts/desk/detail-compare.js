// #756 창구용 — 쿠팡 상세가 네이버 상세와 같게 보이는지 비교(대표 10/18 「네이버와 같게 · 쿠팡이 가운데 정렬이 안 되어 있으면 맞춰 · 수정할 때마다」)
//   node scripts/desk/detail-compare.js check <쿠팡 상품번호> <네이버 상품번호> [--fresh <지시 id>] [--backup <쿠팡 보관본 id>] [--naver-backup <id>] [--no-png]
//        쿠팡 저장 상세(coupang-item full 보관본 · --fresh 면 지금 다시 보관) ↔ 네이버 상세 원문(naver-detail show 보관본)
//        → 단락마다 정렬 · 글씨 크기 · 색 · 굵기 + 그림 수·순서 비교 + 나란히 그림(PC · 폰 · 어긋난 단락 빨간 테두리) · 쓰기 0(--fresh 만 보관본 1줄)
//   node scripts/desk/detail-compare.js fix <쿠팡 상품번호> <네이버 상품번호> [--naver-backup <id>]
//        네이버 상세 → 쿠팡 블록(plan-full --detail-from-naver 와 같은 길) → 어긋난 단락에 inline style 을 보태 다시 만든 블록 파일 + 고친 뒤 비교
//        → 다음 = coupang-item.js plan-full <backup_id> --detail-blocks <파일>(전/후 미리보기 · 되묻기 1회) → apply-full 같은 인자 · 이 도구는 쓰기 0
//   모듈: compare({ naverHtml, contents, png, name }) → { ok, diffs, summary, pngs } — coupang-item plan-full/apply-full 이 상세 블록 결과 끝에 부른다
//   🔵 쿠팡 실제 페이지는 headless 가 막혀(Akamai 403) 렌더 흉내 — 쿠팡 기본 꼴 값(CP_ENV)은 추정 · 실측하면 이 상수만 고친다
//   🔵 쿠팡 저장 때 지우는 것(워커1 #752·#753 실측) = <hr> · 이모지 · 엔티티(글자로) · 줄바꿈(공백) → 비교에서 무시 · style 은 남김 · 그림은 쿠팡 주소로 바뀌어 주소 대신 수·순서만 견줌
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const DB = require(path.join(ROOT, 'detail-blocks.js'));
const CP_ENV = { width: 780, mobile: 390, font: '"Apple SD Gothic Neo","Malgun Gothic","맑은 고딕",dotum,sans-serif', size: 14, lineHeight: 1.5, color: '#333333' };   // 쿠팡 상세 기본 꼴(추정 — 왼쪽 정렬 기본)
const NV_ENV = { width: 860, mobile: 390, font: '"Nanum Gothic","나눔고딕","Malgun Gothic",sans-serif', size: 15, lineHeight: 1.8, color: '#000000' };   // 네이버 스마트에디터 보기 기본(추정)
const NV_CSS = `#nv{width:var(--w);font-family:${NV_ENV.font};font-size:${NV_ENV.size}px;line-height:${NV_ENV.lineHeight};color:${NV_ENV.color};text-align:left;word-break:keep-all}
#nv p{margin:0}#nv .se-text-paragraph-align-center{text-align:center}#nv .se-text-paragraph-align-right{text-align:right}#nv .se-text-paragraph-align-justify{text-align:justify}#nv .se-text-paragraph-align-left{text-align:left}
#nv .se-section-align-center{text-align:center}#nv img{width:100%;max-width:100%;height:auto;display:block;margin:0 auto}#nv .se-imageStrip-container{display:flex;gap:4px}#nv .se-imageStrip-container>*{flex:1;min-width:0}#nv .se-component{margin:0 0 12px}#nv hr{border:0;border-top:1px solid #ddd}
${Array.from({ length: 65 }, (_, i) => i + 8).map(n => `#nv .se-fs-fs${n}{font-size:${n}px}`).join('')}`;
const CP_CSS = `#cp{width:var(--w);font-family:${CP_ENV.font};font-size:${CP_ENV.size}px;line-height:${CP_ENV.lineHeight};color:${CP_ENV.color};text-align:left;word-break:keep-all}
#cp p{margin:0}#cp img{max-width:100%;height:auto;display:block;margin:0 auto}#cp .cp-img img{width:100%}#cp img.cp-miss{width:100%;height:240px;background:#EEF0F3;outline:1px dashed #98A2B3}#cp .cp-sp{margin:10px 0}`;
const EXTRA_GONE = ['블로그', 'blog', 'se-oglink'];   // 쿠팡 정책(다른 판매처·블로그 링크 카드)으로 빠지는 게 정상인 글 — 비교에서 「예상」으로
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripRaw = h => String(h || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?(html|body|head)\b[^>]*>/gi, '');

// 쿠팡 contents(items[].contents) → 화면 흉내 HTML(블록마다 data-bi)
function contentsHtml(contents) {
    return (contents || []).map((c, bi) => {
        const ds = c.contentDetails || [];
        if (/^IMAGE/.test(String(c.contentsType || ''))) return `<div class="cp-blk cp-img${c.contentsType === 'IMAGE' ? ' cp-sp' : ''}" data-bi="${bi}">` + ds.filter(d => d.detailType === 'IMAGE' && d.content).map(d => `<img src="${esc(d.content)}" alt="">`).join('') + '</div>';
        return `<div class="cp-blk" data-bi="${bi}">` + ds.map(d => d.detailType === 'IMAGE' ? `<img src="${esc(d.content)}" alt="">` : stripRaw(d.content)).join('') + '</div>';
    }).join('\n');
}

// 페이지 안에서 — 단락(글이 붙은 가장 가까운 블록 요소) 목록 · 그림 위치
function pageUnits(rootSel) {
    const root = document.querySelector(rootSel);
    const BLK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,div,section,article';
    const norm = s => String(s).normalize('NFC').replace(/[​-‍﻿]/g, '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\s+/g, ' ').trim();
    const rgb = c => { const m = String(c).match(/\d+(\.\d+)?/g) || []; return m.slice(0, 3).map(Number); };
    const units = [], byEl = new Map(); let imgs = 0;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) {
        if (n.nodeType === 1) { if (n.tagName === 'IMG' && n.getAttribute('src')) imgs++; continue; }
        const t = norm(n.nodeValue); if (!t) continue;
        const pe = n.parentElement; if (!pe || pe.closest('script,style')) continue;
        const cs = getComputedStyle(pe); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        let blk = pe.closest(BLK); if (!blk || !root.contains(blk)) blk = root;
        let u = byEl.get(blk);
        if (!u) { u = { i: units.length, el: blk, runs: [], imgsBefore: imgs }; byEl.set(blk, u); units.push(u); }
        u.runs.push({ text: t, el: pe, size: parseFloat(cs.fontSize), color: rgb(cs.color), bold: (parseInt(cs.fontWeight, 10) || 400) >= 600 });
    }
    return {
        imgs,
        units: units.map(u => {
            const txt = norm(u.runs.map(r => r.text).join(' '));
            const dom = u.runs.slice().sort((a, b) => b.text.length - a.text.length)[0];
            let al = getComputedStyle(u.el).textAlign; if (al === 'start' || al === '-webkit-auto') al = 'left'; if (al === 'end') al = 'right'; if (al === '-webkit-center') al = 'center';
            u.el.setAttribute('data-u', String(u.i));
            u.runs.forEach((r, ri) => { if (!r.el.hasAttribute('data-r')) r.el.setAttribute('data-r', u.i + '.' + ri); });
            return { i: u.i, text: txt, align: al, size: dom.size, color: dom.color, bold: dom.bold, imgsBefore: u.imgsBefore,
                runs: u.runs.map(r => ({ text: r.text, size: r.size, color: r.color, bold: r.bold, rid: r.el.getAttribute('data-r') })) };
        }),
    };
}

// 두 목록 맞추기(LCS · 같은 글자 = 같은 단락)
function align(A, B) {
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].text === B[j].text ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const pairs = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i].text === B[j].text) { pairs.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return pairs;
}
const dark = c => c.every(v => v < 70);
const sameColor = (a, b) => (dark(a) && dark(b)) || a.every((v, k) => Math.abs(v - b[k]) <= 8);
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const AL_KO = { left: '왼쪽', center: '가운데', right: '오른쪽', justify: '양쪽' };
function styleDiff(a, b) {   // a = 네이버 · b = 쿠팡 → 다른 칸 목록
    const d = [];
    if (a.align !== b.align) d.push({ k: 'align', nv: a.align, cp: b.align, ko: `정렬 네이버 ${AL_KO[a.align] || a.align} ↔ 쿠팡 ${AL_KO[b.align] || b.align}` });
    if (Math.abs(a.size - b.size) > 1) d.push({ k: 'size', nv: a.size, cp: b.size, ko: `글씨 크기 ${a.size}px ↔ ${b.size}px` });
    if (!sameColor(a.color, b.color)) d.push({ k: 'color', nv: hex(a.color), cp: hex(b.color), ko: `색 ${hex(a.color)} ↔ ${hex(b.color)}` });
    if (a.bold !== b.bold) d.push({ k: 'bold', nv: a.bold, cp: b.bold, ko: `굵기 ${a.bold ? '굵게' : '보통'} ↔ ${b.bold ? '굵게' : '보통'}` });
    return d;
}

function pageDoc(naverHtml, cpHtml, nvW, cpW) {
    return `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}.wrap{display:flex;gap:24px;align-items:flex-start;padding:12px}
.col{flex:none;border:1px solid #ddd;overflow:hidden}.col h2{margin:0;padding:8px 12px;font:700 16px sans-serif;background:#F2F4F7;color:#344054}
[data-bad]{outline:3px solid #E5484D;outline-offset:1px;position:relative}[data-bad]::before{content:attr(data-bad);position:absolute;right:0;top:0;opacity:.9;background:#E5484D;color:#fff;font:700 11px sans-serif;padding:1px 5px;z-index:9}
${NV_CSS}${CP_CSS}</style><body><div class="wrap"><section class="col" style="width:${nvW}px"><h2>네이버 상세(원문)</h2><div id="nv" style="--w:${nvW}px">${stripRaw(naverHtml)}</div></section>
<section class="col" style="width:${cpW}px"><h2>쿠팡 상세(쿠팡 기본 꼴 흉내)</h2><div id="cp" style="--w:${cpW}px">${cpHtml}</div></section></div>`;
}

// 비교 핵심 — 열린 page 에서
async function measure(page) {
    const nv = await page.evaluate(pageUnits, '#nv'), cp = await page.evaluate(pageUnits, '#cp');
    return { nv, cp };
}
function diffOf(nv, cp, policyTexts) {
    const pairs = align(nv.units, cp.units), diffs = [];
    const inPair = new Set(pairs.map(p => p[0])), cpIn = new Set(pairs.map(p => p[1]));
    let n = 0, prevDelta = 0;   // 그림 차이는 달라지는 첫 자리만(한 장 빠지면 뒤가 줄줄이 어긋나 보이는 것 막음)
    for (const [i, j] of pairs) {
        const a = nv.units[i], b = cp.units[j], d = styleDiff(a, b);
        if (d.length) diffs.push({ no: ++n, kind: 'style', nv_i: i, cp_i: j, text: a.text.slice(0, 40), items: d, line: `단락 ${n}「${a.text.slice(0, 24)}」 ${d.map(x => x.ko).join(' · ')}` });
        const delta = a.imgsBefore - b.imgsBefore;
        if (delta !== prevDelta) diffs.push({ no: ++n, kind: 'image_order', nv_i: i, cp_i: j, text: a.text.slice(0, 40), line: `단락 ${n}「${a.text.slice(0, 24)}」 바로 앞에서 그림이 ${delta > prevDelta ? '쿠팡에 ' + (delta - prevDelta) + '장 적음' : '쿠팡에 ' + (prevDelta - delta) + '장 많음'}(그 사이 그림 확인 · 정책으로 뺀 링크 카드 그림일 수 있음)` });
        prevDelta = delta;
    }
    const pol = new Set((policyTexts || []).map(t => t.replace(/\s+/g, ' ').trim()));
    const polHit = t => [...pol].some(p => p && (p.includes(t) || t.includes(p)));
    const expectedGone = [];
    nv.units.forEach((a, i) => {
        if (inPair.has(i)) return;
        if (polHit(a.text) || DB.POLICY_WORDS.concat(EXTRA_GONE).some(w => a.text.toLowerCase().includes(w))) { expectedGone.push(a.text.slice(0, 40)); return; }
        diffs.push({ no: ++n, kind: 'missing', nv_i: i, text: a.text.slice(0, 40), line: `단락 ${n}「${a.text.slice(0, 24)}」 쿠팡에 없음` });
    });
    cp.units.forEach((b, j) => { if (!cpIn.has(j)) diffs.push({ no: ++n, kind: 'extra', cp_i: j, text: b.text.slice(0, 40), line: `단락 ${n}「${b.text.slice(0, 24)}」 쿠팡에만 있음` }); });
    if (nv.imgs !== cp.imgs) diffs.push({ no: ++n, kind: 'image_count', line: `그림 수 네이버 ${nv.imgs} ↔ 쿠팡 ${cp.imgs}` });
    return { diffs, pairs, expectedGone };
}

async function withPage(fn, viewportW) {
    const { chromium } = require('playwright');
    const b = await chromium.launch();
    try { const page = await b.newPage({ viewport: { width: viewportW, height: 1200 } }); return await fn(page); } finally { await b.close(); }
}
async function markAndShoot(page, diffs, file) {
    await page.evaluate(ds => { for (const d of ds) { const lab = '단락 ' + d.no; if (d.nv_i != null) { const e = document.querySelector('#nv [data-u="' + d.nv_i + '"]'); if (e) e.setAttribute('data-bad', lab); } if (d.cp_i != null) { const e = document.querySelector('#cp [data-u="' + d.cp_i + '"]'); if (e) e.setAttribute('data-bad', lab); } } }, diffs.map(d => ({ no: d.no, nv_i: d.nv_i, cp_i: d.cp_i })));
    try { await page.waitForLoadState('networkidle', { timeout: 45000 }); } catch (_) { }
    await page.evaluate(() => document.querySelectorAll('#cp img,#nv img').forEach(i => { if (i.complete && !i.naturalWidth) { i.classList.add('cp-miss'); i.alt = '그림(미리보기에서 못 불러옴)'; } }));
    await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 });
    return file;
}

// 모듈 진입 — naverHtml(네이버 원문) · contents(쿠팡 items[0].contents 꼴)
async function compare(o) {
    const cpHtml = contentsHtml(o.contents);
    const pol = DB.coupangPolicy(DB.fromNaverHtml(o.naverHtml).blocks).removed.map(x => x.text);
    const PC = pageDoc(o.naverHtml, cpHtml, NV_ENV.width, CP_ENV.width);
    const r = await withPage(async page => {
        await page.setContent(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const m = await measure(page), d = diffOf(m.nv, m.cp, pol);
        let pngs = [];
        if (o.png) {
            const pv = require('./_preview.js'); fs.mkdirSync(pv.DIR, { recursive: true });
            pngs.push({ width: 'pc', file: await markAndShoot(page, d.diffs, path.join(pv.DIR, `${o.name || 'compare'}-pc.jpg`)) });
            await page.setViewportSize({ width: NV_ENV.mobile + CP_ENV.mobile + 80, height: 1200 });
            await page.setContent(pageDoc(o.naverHtml, cpHtml, NV_ENV.mobile, CP_ENV.mobile), { waitUntil: 'domcontentloaded', timeout: 60000 });
            await measure(page);
            pngs.push({ width: 'phone', file: await markAndShoot(page, d.diffs, path.join(pv.DIR, `${o.name || 'compare'}-phone.jpg`)) });
        }
        return { m, d, pngs };
    }, NV_ENV.width + CP_ENV.width + 80);
    const { m, d } = r;
    const styleN = d.diffs.filter(x => x.kind === 'style').length;
    return { ok: true, diffs: d.diffs, pngs: r.pngs,
        summary: { naver_paragraphs: m.nv.units.length, coupang_paragraphs: m.cp.units.length, matched: d.pairs.length, naver_images: m.nv.imgs, coupang_images: m.cp.imgs, style_diffs: styleN, other_diffs: d.diffs.length - styleN, policy_removed: d.expectedGone.length },
        expected_gone: d.expectedGone, _m: m, _pairs: d.pairs };
}
// 결과 → 카드 줄(coupang-item 끝에 붙이는 한 덩어리)
function cardLines(c, more) {
    const s = c.summary, L = [];
    if (!c.diffs.length) L.push(`✓ 쿠팡 상세 = 네이버와 같게 보임(단락 ${s.matched}개 정렬·크기·색·굵기 · 그림 ${s.coupang_images}장 순서 같음${s.policy_removed ? ` · 정책으로 뺀 문장 ${s.policy_removed}은 예상` : ''})`);
    else {
        L.push(`🟠 쿠팡에서 네이버와 다르게 보이는 곳 ${c.diffs.length} — 고칠까요?${more ? ' ' + more : ''}`);
        for (const x of c.diffs.slice(0, 12)) L.push('  · ' + x.line);
        if (c.diffs.length > 12) L.push(`  · …외 ${c.diffs.length - 12}곳`);
    }
    return L;
}

// fix — 쿠팡 쪽 블록을 그려 놓고 네이버 단락 꼴을 inline style 로 보탠 뒤 블록 html 을 다시 읽는다
async function fixBlocks(naverHtml) {
    const r0 = DB.fromNaverHtml(naverHtml), pol = DB.coupangPolicy(r0.blocks);
    const blocks = pol.blocks.map(b => Object.assign({}, b));
    const contents = DB.toCoupangContents(blocks, { policy: false });
    const PC = pageDoc(naverHtml, contentsHtml(contents), NV_ENV.width, CP_ENV.width);
    const out = await withPage(async page => {
        await page.setContent(PC, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const m = await measure(page), d = diffOf(m.nv, m.cp, pol.removed.map(x => x.text));
        const ops = [];
        for (const x of d.diffs.filter(z => z.kind === 'style')) {
            const a = m.nv.units[x.nv_i], b = m.cp.units[x.cp_i];
            const op = { cp_i: x.cp_i, unit: {}, runs: [] };
            if (a.align !== b.align) op.unit['text-align'] = a.align;
            const sameRuns = a.runs.length === b.runs.length && a.runs.every((r, k) => r.text === b.runs[k].text);
            if (sameRuns) a.runs.forEach((ra, k) => { const rb = b.runs[k], st = {};
                if (Math.abs(ra.size - rb.size) > 1) st['font-size'] = ra.size + 'px';
                if (!sameColor(ra.color, rb.color)) st.color = hex(ra.color);
                if (ra.bold !== rb.bold) st['font-weight'] = ra.bold ? '700' : '400';
                if (Object.keys(st).length) op.runs.push({ rid: rb.rid, st }); });
            else { const agree = (f) => a.runs.every(r => f(r, a.runs[0]));   // 단락 글이 같아도 나뉨이 다르면 모두 같은 값일 때만 단락에
                if (Math.abs(a.size - b.size) > 1 && agree((r, q) => r.size === q.size)) op.unit['font-size'] = a.size + 'px';
                if (!sameColor(a.color, b.color) && agree((r, q) => sameColor(r.color, q.color))) op.unit.color = hex(a.color);
                if (a.bold !== b.bold && agree((r, q) => r.bold === q.bold)) op.unit['font-weight'] = a.bold ? '700' : '400'; }
            ops.push(op);
        }
        const res = await page.evaluate(ops => {
            const touched = new Set();
            for (const op of ops) {
                const u = document.querySelector('#cp [data-u="' + op.cp_i + '"]'); if (!u) continue;
                const setAll = (el, st) => { for (const k in st) el.style.setProperty(k, st[k]); const b = el.closest('.cp-blk'); if (b) touched.add(b.getAttribute('data-bi')); };
                if (Object.keys(op.unit).length) { if (u.classList.contains('cp-blk')) { const w = document.createElement('div'); while (u.firstChild) w.appendChild(u.firstChild); u.appendChild(w); setAll(w, op.unit); } else setAll(u, op.unit); }
                for (const r of op.runs) { const el = document.querySelector('#cp [data-r="' + r.rid + '"]'); if (!el) continue; if (el.classList.contains('cp-blk') || el === u && u.classList.contains('cp-blk')) continue; setAll(el, r.st); }
            }
            document.querySelectorAll('#cp [data-u],#cp [data-r],#cp [data-bad]').forEach(e => { e.removeAttribute('data-u'); e.removeAttribute('data-r'); e.removeAttribute('data-bad'); });
            const html = {}; touched.forEach(bi => { const b = document.querySelector('#cp .cp-blk[data-bi="' + bi + '"]'); if (b) html[bi] = b.innerHTML; });
            return html;
        }, ops);
        return { before: d.diffs, html: res, ops: ops.length };
    }, NV_ENV.width + CP_ENV.width + 80);
    let changed = 0;
    for (const bi in out.html) { const b = blocks[+bi]; if (b && b.type === 'html' && b.html !== out.html[bi]) { b.html = out.html[bi]; changed++; } }
    return { blocks, before: out.before, changed_blocks: changed, policy: pol };
}

// ── 창구 명령
async function latestCoupang(pool, spid, id) {
    const q = id ? [`SELECT id, created_at, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_h, seller_product_id, before_json FROM coupang_item_backups WHERE id = $1 AND kind = 'product'`, [id]]
        : [`SELECT id, created_at, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_h, seller_product_id, before_json FROM coupang_item_backups WHERE seller_product_id = $1 AND kind = 'product' AND COALESCE(result_json->>'op', '') NOT LIKE 'create%' ORDER BY id DESC LIMIT 1`, [spid]];
    const r = (await pool.query(...q)).rows[0]; if (!r) return null;
    const j = typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json;
    return { id: r.id, at: r.created_at, age_h: Math.round(Number(r.age_h)), spid: String(r.seller_product_id), name: j.sellerProductName || '', items: j.items || [] };
}
async function latestNaver(pool, pno, id) {
    const q = id ? [`SELECT id, created_at, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_h, before_json FROM naver_product_backups WHERE id = $1`, [id]]
        : [`SELECT id, created_at, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_h, before_json FROM naver_product_backups WHERE product_no = $1 AND COALESCE(result_json->>'op', '') <> 'create_failed' ORDER BY id DESC LIMIT 1`, [pno]];
    const r = (await pool.query(...q)).rows[0]; if (!r) return null;
    const j = typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json;
    const html = ((j || {}).originProduct || {}).detailContent;
    return html ? { id: r.id, at: r.created_at, age_h: Math.round(Number(r.age_h)), html, name: ((j || {}).originProduct || {}).name || '' } : null;
}
function parseOpts(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--fresh') o.fresh = args[++i];
        else if (a === '--backup') o.backup = args[++i];
        else if (a === '--naver-backup') o.naverBackup = args[++i];
        else if (a === '--no-png') o.noPng = true;
        else rest.push(a);
    }
    return { o, rest };
}

async function main(argv, deps) {
    const out = deps.out || (x => console.log(JSON.stringify(x, null, 1)));
    const { o, rest } = parseOpts(argv.slice(1)), cmd = argv[0];
    const num = (v, what) => { const s = String(v || '').replace(/\D/g, ''); if (!/^\d{5,15}$/.test(s)) throw new Error(what + ' 를 주세요'); return s; };
    if (cmd !== 'check' && cmd !== 'fix') throw new Error('명령: check <쿠팡 상품번호> <네이버 상품번호> · fix <쿠팡 상품번호> <네이버 상품번호>');
    const spid = num(rest[0], '쿠팡 상품번호(sellerProductId)'), pno = num(rest[1], '네이버 상품번호');
    const nv = await latestNaver(deps.pool, pno, o.naverBackup);
    if (!nv) throw new Error(`네이버 ${pno} 상세 보관본이 없어요 — 먼저 node scripts/desk/naver-detail.js show ${pno} <지시 id>`);
    const notes = [];
    const nAge = nv.age_h; if (nAge != null && nAge >= 6) notes.push(`네이버 상세 보관본 #${nv.id} 이 ${nAge}시간 전 것 — 그 뒤 네이버 상세를 고쳤으면 naver-detail show 로 다시 보관한 뒤 다시`);
    if (cmd === 'check') {
        if (o.fresh) {   // 쿠팡 지금 상세를 다시 보관(coupang-item full · 읽기 · 보관본 1줄)
            let got = null; await require('./coupang-item.js').main(['full', spid, String(o.fresh)], Object.assign({}, deps, { out: x => { got = x; } }));
            if (!got || !got.ok) throw new Error('쿠팡 지금 상세 보관 실패: ' + ((got && got.error) || '응답 없음'));
            o.backup = got.backup_id;
        }
        const cp = await latestCoupang(deps.pool, spid, o.backup);
        if (!cp) throw new Error(`쿠팡 ${spid} 보관본이 없어요 — --fresh <지시 id> 로 지금 보관하거나 coupang-item.js full ${spid} <지시 id>`);
        const cAge = cp.age_h; if (!o.fresh && cAge != null && cAge >= 1) notes.push(`쿠팡 보관본 #${cp.id} 이 ${cAge}시간 전 것 — 지금 쿠팡 상세로 보려면 --fresh <지시 id>`);
        const sig = new Set(cp.items.map(it => JSON.stringify(it.contents || [])));
        if (sig.size > 1) notes.push(`쿠팡 옵션마다 상세가 달라요(${sig.size}가지) — 첫 옵션 「${(cp.items[0] || {}).itemName || ''}」 기준으로 비교`);
        const c = await compare({ naverHtml: nv.html, contents: (cp.items[0] || {}).contents || [], png: !o.noPng && !deps.noPng, name: `compare-${spid}-${pno}` });
        return out({ ok: true, coupang: { seller_product_id: spid, name: cp.name, backup_id: cp.id, at: cp.at }, naver: { product_no: pno, name: nv.name, backup_id: nv.id, at: nv.at },
            summary: c.summary, diffs: c.diffs.map(d => d.line), expected_gone: c.expected_gone, preview_png: c.pngs.map(p => p.file),
            card: [`━━━ 쿠팡 ↔ 네이버 상세 비교 ━━━`, `쿠팡 ${spid} ${cp.name} · 네이버 ${pno}`].concat(cardLines(c, c.diffs.length ? `(node scripts/desk/detail-compare.js fix ${spid} ${pno})` : ''), notes.map(x => '⚠ ' + x)).join('\n'),
            note: c.diffs.length ? '나란히 그림(preview_png · 빨간 테두리 = 다른 단락)을 붙여 「고칠까요?」 되묻기 → 「응」이면 fix' : '카드 그대로' });
    }
    // fix
    const f = await fixBlocks(nv.html);
    const after = await compare({ naverHtml: nv.html, contents: DB.toCoupangContents(f.blocks), png: !o.noPng && !deps.noPng, name: `compare-${spid}-${pno}-fixed` });
    const pv = require('./_preview.js'); fs.mkdirSync(pv.DIR, { recursive: true });
    const file = path.join(pv.DIR, `detail-fix-${spid}-${pno}.json`);
    fs.writeFileSync(file, JSON.stringify({ from_naver: pno, naver_backup_id: nv.id, coupang: spid, made_at: new Date(deps.now()).toISOString(), policy: { unlinked: f.policy.unlinked, removed: f.policy.removed }, blocks: f.blocks }, null, 1));
    return out({ ok: true, file, changed_blocks: f.changed_blocks, before: f.before.length, after: after.diffs.length, after_diffs: after.diffs.map(d => d.line), preview_png: after.pngs.map(p => p.file),
        card: [`━━━ 쿠팡 상세 맞춤(아직 안 보냄) ━━━`, `네이버 ${pno} 상세 → 쿠팡 블록 ${f.blocks.length}개 · 글 블록 ${f.changed_blocks}개에 정렬·크기·색·굵기 보탬`, `다른 곳: 고치기 전 ${f.before.length} → 고친 뒤 ${after.diffs.length}`]
            .concat(after.diffs.slice(0, 8).map(d => '  · 남음: ' + d.line), notes.map(x => '⚠ ' + x), [`다음 = node scripts/desk/coupang-item.js full ${spid} <지시 id> → plan-full <backup_id> --detail-blocks "${file}"(전/후 미리보기 · 되묻기 1회) → apply-full 같은 인자`]).join('\n'),
        note: '쓰기 0 — plan-full 카드와 미리보기로 되묻기' });
}

module.exports = { compare, cardLines, fixBlocks, contentsHtml, styleDiff, align, main, CP_ENV, NV_ENV };

if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; })
        .finally(() => pool.end().catch(() => { }));
}

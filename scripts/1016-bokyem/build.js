// #1016-B 보겸 쇼츠 배너 블록 끼우기(미리보기용 · 쓰기 0)
//   지금 상세(보관본 HTML)의 블록을 복제해 글자·그림 주소만 바꾸고, 「N번 블록 뒤」에 끼운다.
//   node build.js <상세.html> <뒤에 넣을 블록 번호> <글 틀 블록 번호> <그림 틀 블록 번호> <배너 src> <out.html> <spec.json>
//   spec = [{ "t":"text", "lines":[["굵은 큰 줄", 19, "#222222"], ["작은 줄", 16, "#444444"]] } | { "t":"img" }]
'use strict';
const fs = require('fs');
function blocks(s) {
    const re = /<div class="se-component (se-[a-zA-Z]+)[^"]*"[^>]*>/g; const out = []; let m, pos = 0;
    while ((m = re.exec(s))) {
        if (m.index < pos) continue;
        const tk = /<!--[\s\S]*?-->|<div\b[^>]*>|<\/div\s*>/gi; tk.lastIndex = m.index; let d = 0, t, end = s.length;
        while ((t = tk.exec(s))) { if (t[0].startsWith('<!--')) continue; d += t[0].startsWith('</') ? -1 : 1; if (d === 0) { end = tk.lastIndex; break; } }
        out.push({ type: m[1], start: m.index, end, html: s.slice(m.index, end) }); pos = end;
    }
    return out;
}
let seq = 0;
const newId = () => `SE-1016${String(++seq).padStart(4, '0')}-0000-4000-8000-000000001016`;
const reId = h => h.replace(/\bid="SE-[^"]+"/g, () => `id="${newId()}"`);
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/·/g, '&middot;');
function textBlock(tpl, lines) {
    // 틀 = 가운데 정렬 글 블록 · 첫 <p> 를 줄마다 복제(색·크기만 바꿈)
    const pm = tpl.match(/<p class="se-text-paragraph[\s\S]*?<\/p>/);
    if (!pm || !/align-center/.test(pm[0])) throw new Error('글 틀 블록이 가운데 정렬 글이 아님');
    const p0 = pm[0];
    const ps = lines.map(([txt, fs, color, bold = true]) => {
        if (!txt) return p0.replace(/<span[\s\S]*<\/span>/, '<span class="se-fs-fs16 se-ff-">&#8203;</span>');
        const inner = bold ? `<b>${esc(txt)}</b>` : esc(txt);
        return p0.replace(/<span[^>]*>[\s\S]*<\/span>/, `<span style="color:${color};" class="se-fs-fs${fs} se-ff-">${inner}</span>`);
    }).join('\n');
    const a = tpl.indexOf('<p class="se-text-paragraph'), b = tpl.lastIndexOf('</p>') + 4;
    let body = tpl.slice(0, a) + ps + tpl.slice(b);
    body = body.replace(/<!-- SE-TEXT \{ -->|<!-- \} SE-TEXT -->/g, '');
    return reId(body);
}
function imgBlock(tpl, src, link, alt) {
    if (/<a\b[^>]*href=/.test(tpl) || /se-caption/.test(tpl)) throw new Error('그림 틀 블록에 링크·캡션이 있음 — 링크 없는 단일 그림 블록으로');
    let h = tpl.replace(/<!--[\s\S]*?-->/g, '');                   // 네이버 거름 주석(옛 그림 linkdata) 뺌
    h = h.replace(/(<img\b[^>]*\bsrc=")[^"]+(")/, (m0, a, b) => a + src + b);
    h = h.replace(/(<img\b[^>]*\balt=")[^"]*(")/, (m0, a, b) => a + esc(alt || '') + b);
    if (link) {   // 그림 링크 = 기존 지도 버튼 블록과 같은 꼴(<a href class="se-module-image-link …" rel="noopener">)
        if (!/<a class="se-module-image-link/.test(h)) throw new Error('그림 틀에 se-module-image-link 가 없음');
        h = h.replace('<a class="se-module-image-link', () => `<a href="${esc(link)}" class="se-module-image-link`).replace(/(<a href="[^"]+" class="se-module-image-link[^"]*")/, (m0) => m0 + ' rel="noopener"');
    }
    return reId(h);
}
if (require.main === module) {
    const [file, after, tTxt, tImg, src0, outFile, specFile] = process.argv.slice(2);
    const src = src0.startsWith('@') ? 'data:image/png;base64,' + fs.readFileSync(src0.slice(1)).toString('base64') : src0;
    const s = fs.readFileSync(file, 'utf8'), B = blocks(s), spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    const at = B[Number(after) - 1], tt = B[Number(tTxt) - 1], ti = B[Number(tImg) - 1];
    if (!at || !tt || !ti) throw new Error('블록 번호 범위 밖');
    if (tt.type !== 'se-text') throw new Error('글 틀이 se-text 아님: ' + tt.type);
    if (ti.type !== 'se-image') throw new Error('그림 틀이 se-image 아님: ' + ti.type);
    const add = spec.map(x => x.t === 'img' ? imgBlock(ti.html, src, x.link, x.alt) : textBlock(tt.html, x.lines)).join('\n');
    const out = s.slice(0, at.end) + '\n' + add + s.slice(at.end);
    fs.writeFileSync(outFile, out);
    const B2 = blocks(out);
    console.log(JSON.stringify({ file: outFile, blocks_before: B.length, blocks_after: B2.length, added: spec.length, after_block: Number(after),
        same_head: out.slice(0, at.end) === s.slice(0, at.end), same_tail: out.endsWith(s.slice(at.end)), imgs_before: (s.match(/<img\b/g) || []).length, imgs_after: (out.match(/<img\b/g) || []).length }));
}
module.exports = { blocks, textBlock, imgBlock };

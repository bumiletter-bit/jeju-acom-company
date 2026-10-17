'use strict';
/*
 * #721-C1 네이버 상세 HTML 의 스마트에디터 그림 링크 → 일반 <a href> (순수 함수 · 입출력·DB 없음)
 * - 스마트에디터 꼴: <a href="#" class="se-module-image-link-use …" onclick="return false;" data-linktype="img"
 *   data-linkdata="{…&quot;linkUse&quot; : &quot;true&quot;, &quot;link&quot; : &quot;https://…&quot;…}">
 *   → API 로 저장하면 네이버가 onclick·data-*·style 을 걸러 링크가 죽는다(#720-D · 그림 5장).
 * - 바꾸는 것 = linkUse true + link 가 http(s) 인 <a> 여는 태그 하나뿐 → <a href="link" target="_blank" rel="noopener" class="…">
 *   (class 는 그대로 둠 — 모양 유지 · 나머지 바이트 무변경 · 닫는 </a>·<img> 무접촉)
 * - fromComments(기본 켬 · { fromComments:false } 로 끔): 이미 걸러진 상세에는 네이버가
 *   「<!-- Not Allowed Attribute Filtered ( … data-linkdata="…" ) -->」 주석을 걸러진 <a> 바로 앞에 남긴다
 *   → 그 주석의 링크로 바로 뒤 <a>(제 href·data-linkdata 없는 것)를 같은 꼴로 되살림(주석은 그대로 둠)
 * - 건너뜀 = 링크 없는 그림(linkUse false · link 빈 값) · http(s) 가 아닌 주소 · 주석(<!-- -->)·<script> 안 글자
 * - 🔵 네이버가 일반 <a href target rel> 을 남기는지는 실 PUT 1건으로만 확인됨(워커3 ⑥)
 */

const ENT = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', '#39': "'", '#34': '"' };
function decodeEnt(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
        if (k[0] === '#') { const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
        return Object.prototype.hasOwnProperty.call(ENT, k.toLowerCase()) ? ENT[k.toLowerCase()] : m;
    });
}
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 여는 태그 안 속성 → { 이름(소문자): 값(엔티티 풀기 전) }
function attrsOf(tag) {
    const body = tag.replace(/^<a\b/i, '').replace(/\/?>$/, '');
    const out = {}, re = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
    let m;
    while ((m = re.exec(body))) {
        const k = m[1].toLowerCase();
        if (k in out) continue;
        let v = m[2] == null ? '' : m[2];
        if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
        out[k] = v;
    }
    return out;
}

function linkOf(attrs) {
    if (!('data-linkdata' in attrs)) return { skip: null };
    let j;
    try { j = JSON.parse(decodeEnt(attrs['data-linkdata'])); } catch (e) { return { skip: 'linkdata_parse' }; }
    const use = j && (j.linkUse === true || String(j.linkUse).toLowerCase() === 'true');
    const link = j && typeof j.link === 'string' ? j.link.trim() : '';
    if (!use || !link) return { skip: null };                       // 링크 없는 그림 = 그대로(셈하지 않음)
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(link)) return { skip: 'not_http', link };
    return { link, src: j.src || null, id: j.id || null };
}

// 주석·script 는 통째로 건너뛰고 <a …> 여는 태그만 본다
const TOKEN = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const FILTERED = /^<!--\s*Not Allowed Attribute Filtered\s*\(([\s\S]*)\)\s*-->$/i;

function convertImageLinks(html, opts) {
    const fromComments = !opts || opts.fromComments !== false;
    const src = String(html == null ? '' : html);
    const links = [], skipped = [];
    let pend = null;                                                 // 바로 앞 걸러짐 주석의 링크 { end, L }
    const out = src.replace(TOKEN, (tok, offset) => {
        if (/^<!--/.test(tok)) {
            pend = null;
            const m = fromComments && FILTERED.exec(tok);
            if (m) { const L = linkOf(attrsOf('<a ' + m[1] + '>')); if (L.link || L.skip) pend = { end: offset + tok.length, L }; }
            return tok;
        }
        const p = pend; pend = null;
        if (!/^<a\b/i.test(tok)) return tok;
        const a = attrsOf(tok);
        let L = linkOf(a), from = 'attr';
        // 걸러진 <a> = 주석 바로 뒤(사이 공백만) · 제 data-linkdata 없음 · href 없음(또는 #)
        if (!L.link && !L.skip && p && !/\S/.test(src.slice(p.end, offset)) && !('data-linkdata' in a) && (!('href' in a) || a.href === '#')) { L = p.L; from = 'comment'; }
        if (!L.link || L.skip) { if (L.skip) skipped.push({ offset, from, reason: L.skip, link: L.link || null }); return tok; }
        const cls = a['class'] != null ? ` class="${a['class']}"` : '';
        links.push({ offset, from, link: L.link, src: L.src, id: L.id });
        return `<a href="${escAttr(L.link)}" target="_blank" rel="noopener"${cls}>`;
    });
    return { html: out, converted: links.length, links, skipped };
}

module.exports = { convertImageLinks, decodeEnt, attrsOf };

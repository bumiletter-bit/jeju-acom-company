'use strict';
/*
 * #733-C 상세 블록 — 네이버 상세 HTML → 블록 목록 → 쿠팡 contents · 미리보기 HTML (순수 함수 · 입출력·DB 없음)
 * - fromNaverHtml(html, { links? }) → { blocks, images, linked, dropped }
 *     blocks = [{ type:'image', url, alt? } | { type:'html', html }] — 원본 순서 그대로
 *     · 그림 <img> 하나 = image 블록 · 그림을 <a href="http(s)…"> 로 감싼 것 = html 블록 `<a href rel><img></a>`(링크 보존)
 *     · 그림 사이의 글 = html 블록(앞뒤 공백 정리) · 보이는 글·<hr> 없는 조각은 버림
 *     · 지움 = 주석 · <script>/<style> · <div>/<section> 등 틀 태그(여는·닫는 태그만 · 안의 글은 남김) · 속성 id·class·data-*·on*
 *       (style 은 남김 — 글자 색·크기) · 남는 태그 = p span b strong i em u s br hr blockquote a h1~h6 ul ol li table 묶음 font sub sup
 *     · links(기본 켬) = naver-detail-links.js 로 스마트에디터 그림 링크(걸러진 주석 포함)를 먼저 일반 <a href> 로 살린 뒤 나눔
 *     · images = 그림 수(링크 있는 그림 포함) = 원본 <img> 수와 같아야 한다(빈 src 만 빠짐 → dropped 에 셈)
 * - toPreviewHtml(blocks) → 단순 HTML(블록마다 <div class="db-…"> 한 겹) — fromNaverHtml 에 다시 넣으면 같은 blocks(왕복 멱등)
 * - coupangPolicy(blocks) → { blocks, removed, unlinked, images } = #746 쿠팡 정책 정리(다른 판매처 링크 벗김 · 안내 단락 뺌 · 그림 목록) · toCoupangContents 가 늘 먼저 거침
 * - toCoupangContents(blocks, { mode }) → 쿠팡 items[].contents 꼴(워커3 #733-A ③ · 근거 docs/728-coupang-write-api.md)
 *     mode 'blocks'(기본) = 그림마다 IMAGE_NO_SPACE 1항목 · 글·링크 그림 = TEXT 1항목 / mode 'html' = HTML 1항목에 미리보기 HTML 통째
 *     🔵 미확정 = TEXT/HTML 안 허용 태그 · 그림 칸의 외부 주소를 쿠팡이 가져가는지 → 실 PUT 뒤 아래 CP 상수만 고친다
 */
const CP = {   // 쿠팡 contents 꼴 — 한 곳만 고친다(#733-A ③ 확정 뒤)
    imageType: 'IMAGE_NO_SPACE', textType: 'TEXT', htmlType: 'HTML',   // 그림 = 사이 띄움 없이(네이버 상세처럼 붙여) · 워커1 서버 기본과 같게
    detailImage: 'IMAGE', detailText: 'TEXT',
};
let linksMod = null;
try { linksMod = require('./naver-detail-links.js'); } catch (_) { linksMod = null; }

const KEEP = new Set(['p', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'hr', 'blockquote', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font', 'sub', 'sup', 'img']);
const ENT = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#34': '"' };
const decodeEnt = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
    if (k[0] === '#') { const n = /^#x/i.test(k) ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return Object.prototype.hasOwnProperty.call(ENT, k.toLowerCase()) ? ENT[k.toLowerCase()] : m;
});
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
function attrsOf(tag) {
    const body = tag.replace(/^<\/?[a-z0-9]+/i, '').replace(/\/?>$/, ''), out = [];
    let m; ATTR_RE.lastIndex = 0;
    while ((m = ATTR_RE.exec(body))) { let v = m[2] == null ? null : m[2]; if (v && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1); out.push([m[1].toLowerCase(), v]); }
    return out;
}
const attr = (tag, k) => { const a = attrsOf(tag).find(x => x[0] === k); return a ? (a[1] == null ? '' : decodeEnt(a[1])) : null; };
const isHttp = u => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim());
// 남길 태그의 속성 정리 — id·class·data-*·on* 지움 · style 은 남김 · a 는 href(http)·rel 만
function cleanTag(tag, name, closing) {
    if (closing) return `</${name}>`;
    if (name === 'a') { const h = attr(tag, 'href'); return isHttp(h) ? `<a href="${escAttr(h.trim())}" rel="noopener">` : '<a>'; }
    const keep = attrsOf(tag).filter(([k]) => k === 'style' || k === 'colspan' || k === 'rowspan' || (name === 'font' && (k === 'color' || k === 'size')));
    const self = /\/>$/.test(tag) || name === 'br' || name === 'hr';
    return `<${name}${keep.map(([k, v]) => v == null ? ` ${k}` : ` ${k}="${escAttr(decodeEnt(v))}"`).join('')}${self && (name === 'br' || name === 'hr') ? '>' : '>'}`;
}
const imgHtml = (url, alt) => `<img src="${escAttr(url)}" alt="${escAttr(alt || '')}">`;
// 조각에 보이는 것이 있나(글자 · hr)
const visible = h => /<hr\b/i.test(h) || /\S/.test(decodeEnt(h.replace(/<[^>]*>/g, '')).replace(/ /g, ' '));
// 빈 인라인 껍데기(<span></span> · <p> </p> 등)를 안쪽부터 벗김
function dropEmpty(h) {
    let prev;
    do { prev = h; h = h.replace(/<(p|span|b|strong|i|em|u|s|font|sub|sup|h[1-6]|blockquote|li)\b[^>]*>(\s|&nbsp;| )*<\/\1>/gi, ''); } while (h !== prev);
    return h;
}
const tidy = h => dropEmpty(h).replace(/[ \t]*\r?\n[ \t\r\n]*/g, '\n').trim();

function fromNaverHtml(html, opts) {
    let src = String(html == null ? '' : html);
    if ((!opts || opts.links !== false) && linksMod) src = linksMod.convertImageLinks(src).html;   // 걸러진 그림 링크도 일반 <a href> 로
    src = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
    const blocks = []; let buf = '', images = 0, linked = 0, dropped = 0;
    let openA = null;   // 지금 열린 <a href> (그림을 감싸는지 보려고)
    const flush = () => { const h = tidy(buf); buf = ''; if (h && visible(h)) blocks.push({ type: 'html', html: h }); };
    const TOK = /<\/?([a-z][a-z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    let last = 0, m;
    while ((m = TOK.exec(src))) {
        const text = src.slice(last, m.index); last = TOK.lastIndex;
        if (text) { if (openA) openA.inner += text; else buf += text; }
        const tag = m[0], name = m[1].toLowerCase(), closing = tag[1] === '/';
        if (name === 'img') {
            const url = (attr(tag, 'src') || '').trim(), alt = attr(tag, 'alt') || '';
            if (!url) { dropped++; continue; }
            images++;
            if (openA) { openA.imgs.push({ url, alt }); continue; }
            flush(); blocks.push(alt ? { type: 'image', url, alt } : { type: 'image', url });
            continue;
        }
        if (name === 'a') {
            if (!closing) {
                if (openA) { buf += cleanTag(openA.tag, 'a') + openA.inner; }   // 닫히지 않은 앞 a 는 글로
                openA = { tag, inner: '', imgs: [] };
            } else if (openA) {
                const a = openA; openA = null;
                const href = attr(a.tag, 'href');
                if (a.imgs.length && !visible(a.inner.replace(/<[^>]*>/g, ''))) {   // 그림만 감싼 링크
                    flush();
                    if (isHttp(href)) { linked += a.imgs.length; blocks.push({ type: 'html', html: `<a href="${escAttr(href.trim())}" rel="noopener">${a.imgs.map(i => imgHtml(i.url, i.alt)).join('')}</a>` }); }
                    else for (const i of a.imgs) blocks.push(i.alt ? { type: 'image', url: i.url, alt: i.alt } : { type: 'image', url: i.url });   // 링크 없는 껍데기 a = 그냥 그림
                } else {   // 글 링크(그림 없음) = 글 안에 그대로
                    buf += cleanTag(a.tag, 'a') + cleanInner(a.inner) + a.imgs.map(i => imgHtml(i.url, i.alt)).join('') + '</a>';
                }
            }
            continue;
        }
        const out = KEEP.has(name) ? cleanTag(tag, name, closing) : '';   // 틀 태그(div 등)는 태그만 지움
        if (openA) openA.inner += out; else buf += out;
    }
    const rest = src.slice(last);
    if (openA) { buf += cleanTag(openA.tag, 'a') + openA.inner; openA = null; }
    buf += rest; flush();
    return { blocks, images, linked, dropped };
}
// a 안쪽 글의 태그도 같은 규칙으로(이미 cleanTag 를 거친 것은 그대로)
const cleanInner = h => h;

function toPreviewHtml(blocks) {
    return (blocks || []).map(b => b.type === 'image' ? `<div class="db-img">${imgHtml(b.url, b.alt)}</div>` : `<div class="db-html">${b.html}</div>`).join('\n');
}
// #746 쿠팡 정책 정리 — 다른 판매처로 보내는 것을 뺀다(쿠팡 상세 = 쿠팡 안에서만)
//   ① html 블록 안 <a> 태그는 벗김(그림·글은 남김) · 그림만 남은 블록 = image 블록으로
//   ② 다른 판매처 안내 글(POLICY_WORDS)이 든 단락(p·li·h·blockquote·td/th · 그 밖은 <br> 줄)을 뺌 → removed 에 원문 그대로
//   ③ 그림 속 글자는 못 고침 → images 에 그림 주소 목록(사람이 눈으로)
//   여러 번 돌려도 같은 결과(멱등) · 원본 blocks 는 건드리지 않음
const POLICY_WORDS = ['네이버', 'naver', '스마트스토어', 'smartstore', 'smart store', '톡톡', '알림받기', '알림 받기', '소식받기', '소식 받기', '스토어찜', '찜하기', '자사몰', 'akkome.com', '카카오톡 채널', '카톡 채널', '플러스친구'];
const policyHit = h => { const t = decodeEnt(String(h).replace(/<[^>]*>/g, ' ')).toLowerCase(); return POLICY_WORDS.find(w => t.includes(w)) || null; };
const plainOf = h => decodeEnt(String(h).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
// 쿠팡 안 상품 주소만 링크로 남김 — https://www.coupang.com/vp/products/<숫자>(쿼리 없음 또는 itemId·vendorItemId 숫자만)
const CP_LINK_RE = /^https:\/\/www\.coupang\.com\/vp\/products\/\d{1,15}(\?(itemId|vendorItemId)=\d{1,15}(&(itemId|vendorItemId)=\d{1,15})?)?$/;
const isCoupangLink = u => CP_LINK_RE.test(String(u || '').trim());
// 네이버 상품 주소 → 상품 번호(smartstore.naver.com/<가게>/products/<번호> · brand.naver.com/<가게>/products/<번호>)
const naverProductNo = u => { const m = /^https?:\/\/(?:m\.)?(?:smartstore|brand)\.naver\.com\/[^/?#]+\/products\/(\d{5,15})/i.exec(String(u || '').trim()); return m ? m[1] : null; };
//   opts.linkMap = { "<네이버 상품 번호>": "<쿠팡 상품 번호(쿠팡 상품 주소 vp/products 뒤 숫자)>" } → 그 네이버 상품 링크는 짝 쿠팡 주소로(짝 없으면 벗김) · 기본 = 없음
function coupangPolicy(blocks, opts) {
    const out = [], removed = [], images = [], relinked = []; let unlinked = 0;
    const linkMap = (opts && opts.linkMap && typeof opts.linkMap === 'object') ? opts.linkMap : {};
    (blocks || []).forEach((b, bi) => {
        if (!b || b.type !== 'html') { if (b && b.type === 'image') { images.push(b.url); out.push(b); } return; }
        let h = String(b.html || '');
        const stack = []; let kept = 0;
        h = h.replace(/<(\/?)a\b[^>]*>/gi, (m, close) => {
            if (close) return stack.length && stack.pop() ? '</a>' : '';
            const href = (attr(m, 'href') || '').trim(); let to = isCoupangLink(href) ? href : null;
            if (!to) { const no = naverProductNo(href), cpNo = no && linkMap[no] != null ? String(linkMap[no]).replace(/\D/g, '') : ''; if (cpNo) { to = 'https://www.coupang.com/vp/products/' + cpNo; relinked.push({ block: bi + 1, from: href, to }); } }
            stack.push(!!to); if (to) { kept++; return `<a href="${escAttr(to)}" rel="noopener">`; }
            unlinked++; return '';
        });
        const cut = (unit, word) => { removed.push({ block: bi + 1, word, text: plainOf(unit).slice(0, 300), html: unit }); return ''; };
        const byLine = s => s.split(/(<br\s*\/?>)/i).map(seg => { if (/^<br/i.test(seg)) return seg; const w = policyHit(seg); return w ? cut(seg, w) : seg; }).join('');   // <br> 줄 단위
        h = h.replace(/<(p|li|h[1-6]|blockquote|td|th)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, m => {
            const w = policyHit(m); if (!w) return m;
            if (!/<br\b/i.test(m)) return cut(m, w);
            const r = byLine(m).replace(/(<br\s*\/?>\s*){2,}/gi, '<br>');   // 줄 여럿인 단락 = 걸린 줄만
            return visible(r) ? r : '';
        });
        if (policyHit(h)) h = h.split(/(<(?:p|li|h[1-6]|blockquote|td|th)\b[^>]*>[\s\S]*?<\/(?:p|li|h[1-6]|blockquote|td|th)\s*>|<br\s*\/?>|<hr\b[^>]*>)/i)
            .map(seg => /^<(p|li|h[1-6]|blockquote|td|th|br|hr)\b/i.test(seg) ? seg : (policyHit(seg) ? cut(seg, policyHit(seg)) : seg)).join('');   // 단락 밖 글(줄·단락 사이)만 · 남긴 단락은 그대로
        h = tidy(h.replace(/^(\s*<br\s*\/?>)+|(<br\s*\/?>\s*)+$/gi, ''));
        const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map(m => ({ url: (attr(m[0], 'src') || '').trim(), alt: attr(m[0], 'alt') || '' })).filter(x => x.url);
        const rest = h.replace(/<img\b[^>]*>/gi, '');
        if (imgs.length && !visible(rest) && !kept) { for (const i of imgs) { images.push(i.url); out.push(i.alt ? { type: 'image', url: i.url, alt: i.alt } : { type: 'image', url: i.url }); } return; }
        for (const i of imgs) images.push(i.url);
        if (h && (visible(h) || (kept && imgs.length))) out.push({ type: 'html', html: h });   // 쿠팡 링크 그림(글 없음)도 남김
    });
    return { blocks: out, removed, unlinked, images, relinked };
}
function toCoupangContents(blocks, opts) {
    const mode = (opts && opts.mode) || 'blocks';
    if (!(opts && opts.policy === false)) blocks = coupangPolicy(blocks, opts).blocks;   // #746 서버로 가는 길도 늘 정리(창구가 이미 정리했어도 같음)
    if (mode === 'html') return [{ contentsType: CP.htmlType, contentDetails: [{ content: toPreviewHtml(blocks), detailType: CP.detailText }] }];
    return (blocks || []).map(b => b.type === 'image'
        ? { contentsType: CP.imageType, contentDetails: [{ content: b.url, detailType: CP.detailImage }] }
        : { contentsType: CP.textType, contentDetails: [{ content: b.html, detailType: CP.detailText }] });
}
// 블록 요약(카드용) — 그림 n · 링크 그림 n · 글 n
function summarize(blocks) {
    let img = 0, link = 0, text = 0;
    for (const b of (blocks || [])) {
        if (b.type === 'image') img++;
        else { const n = (b.html.match(/<img\b/gi) || []).length; if (n) { img += n; link += n; } if (visible(b.html.replace(/<img\b[^>]*>/gi, ''))) text++; }
    }
    return { blocks: (blocks || []).length, images: img, linked_images: link, text_blocks: text };
}

module.exports = { fromNaverHtml, toPreviewHtml, toCoupangContents, coupangPolicy, isCoupangLink, naverProductNo, summarize, CP, POLICY_WORDS };

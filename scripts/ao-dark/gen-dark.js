// #569 야간 화면(모든 메뉴) CSS 만들기 — styles.css · theme.css · order-organizer.css 는 한 글자도 안 고치고,
//   그 규칙들의 색·바탕·테두리·그림자 줄을 순서 그대로 옮겨 어두운 값으로 바꾼 파일 하나(public/ao-dark.css)를 만든다.
//   · 선택자 = :where(html[data-ao-theme="dark"]) …  (점수 0 → 원래 규칙끼리의 우선순위·순서가 그대로)
//   · 색 = 색상(hue)은 두고 밝기만 뒤집는 계산식 + 예외표(overrides.js) — 뜻이 있는 색(분류·상태·거래처)은 색상이 유지된다
//   사용: node scripts/ao-dark/gen-dark.js [출력 파일]     (기본 = public/ao-dark.css)   --stats 를 붙이면 색 통계만
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, 'public', 'ao-dark.css');
const STATS = process.argv.includes('--stats');
const OV = require('./overrides.js');
const SRC = ['styles.css', 'theme.css', 'order-organizer.css'];
const P = ':where(html[data-ao-theme="dark"]) ';
const FAMILY = /^(color|background(-[a-z-]+)?|border(-(top|right|bottom|left))?(-(color|style|width))?|outline(-(color|style|width|offset))?|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?)$/;

// ── 색 계산
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', gray: '#808080', grey: '#808080', silver: '#c0c0c0', orange: '#ffa500', green: '#008000', blue: '#0000ff', yellow: '#ffff00', navy: '#000080', whitesmoke: '#f5f5f5', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', gold: '#ffd700', crimson: '#dc143c', tomato: '#ff6347', darkgray: '#a9a9a9', dimgray: '#696969' };
const hex2 = h => { h = h.slice(1); if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]; };
const toHsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; };
const fromHsl = ([h, s, l]) => { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (!s) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(v => Math.round(v * 255)); };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const HEX = c => '#' + c.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const out = (c, a) => a >= 0.999 ? HEX(c) : `rgba(${c.slice(0, 3).map(Math.round).join(', ')}, ${Number(a.toFixed(3))})`;
const CARD = [22, 26, 46], SOFT = [27, 32, 56];
const T = { card: 'var(--d-card)', soft: 'var(--d-soft)', line: 'var(--d-line)', ink: 'var(--d-ink)', sub: 'var(--d-sub)', dim: 'var(--d-dim)' };

// 한 색 → 어두운 화면 값. g = bg | fg | bd | sh
function darkOf(rgba, g) {
    const [r, gg, b, a] = rgba, c = [r, gg, b], [h, s, l] = toHsl(c);
    const neutral = s < 0.14 || (Math.max(r, gg, b) - Math.min(r, gg, b)) < 14;
    if (g === 'sh') {
        if (neutral || l < 0.25) return out([0, 0, 0], Math.min(0.85, a < 1 ? a + 0.25 : 0.6));
        return out(fromHsl([h, s, Math.max(l, 0.6)]), Math.min(0.9, a + 0.08));
    }
    if (g === 'bg') {
        if (a < 0.999) {   // 반투명 덮개
            if (neutral && l > 0.85) return out([233, 235, 245], Math.min(a, 0.9) * 0.12 + (a > 0.9 ? 0.04 : 0));   // 흰 반투명 → 아주 옅은 밝은 막
            if (neutral) return out(c, a);                                                                        // 검은 막(모달 뒤) 그대로
            return out(fromHsl([h, s, Math.max(l, 0.62)]), Math.min(0.9, a + 0.06));                              // 색 막은 색을 살려 조금 진하게
        }
        if (neutral) {
            if (l >= 0.985) return T.card;
            if (l >= 0.94) return T.soft;
            if (l >= 0.86) return '#242A47';
            if (l >= 0.7) return '#343B60';
            if (l >= 0.45) return '#4A5278';
            return HEX(c);   // 원래 어두운 바탕(흰 글자와 짝) 그대로
        }
        if (l >= 0.93) return out(fromHsl([h, Math.min(s, 0.75), 0.6]), 0.14);    // 아주 옅은 색 바탕 → 같은 색의 어두운 기운
        if (l >= 0.82) return out(fromHsl([h, Math.min(s, 0.8), 0.6]), 0.2);
        if (l >= 0.68) return out(fromHsl([h, Math.min(s, 0.8), 0.58]), 0.32);
        return HEX(c);       // 진한 색 바탕(채운 버튼·띠) 그대로
    }
    if (g === 'bd') {
        if (a < 0.999) return neutral ? out(l > 0.5 ? [233, 235, 245] : [0, 0, 0], Math.min(0.5, a + 0.08)) : out(fromHsl([h, s, Math.max(l, 0.6)]), Math.min(0.9, a + 0.1));
        if (neutral) return l >= 0.86 ? T.line : l >= 0.7 ? '#3A4168' : l >= 0.45 ? '#565F8A' : '#7C84AB';
        if (l >= 0.8) return out(fromHsl([h, Math.min(s, 0.7), 0.6]), 0.4);
        if (l < 0.45) return HEX(fromHsl([h, Math.min(s, 0.85), 0.62]));
        return HEX(c);
    }
    // fg
    if (a < 0.999 && neutral) return out(l > 0.5 ? c : [233, 235, 245], l > 0.5 ? Math.max(a, 0.84) : a);
    if (neutral) {
        if (l >= 0.97) return HEX(c);          // 흰 글자(채운 바탕 위) 그대로
        if (l <= 0.3) return T.ink;
        if (l <= 0.5) return T.sub;
        return T.dim;
    }
    let L = Math.max(l, 0.66), cc = fromHsl([h, Math.min(s, 0.95), L]);
    while (ratio(cc, SOFT) < 7.2 && L < 0.92) { L += 0.02; cc = fromHsl([h, Math.min(s, 0.95), L]); }
    return out(cc, a);
}
const grp = p => /^background/.test(p) ? 'bg' : /^(border|outline)/.test(p) ? 'bd' : /shadow/.test(p) ? 'sh' : 'fg';

const stats = {};
function mapValue(prop, value, sel) {
    const g = grp(prop);
    const key = sel + ' { ' + prop + ' }';
    if (OV.bySelector && OV.bySelector[key] !== undefined) return OV.bySelector[key];
    let v = value;
    // 테마 토큰: 「채운 바탕 + 흰 글자」로 쓰인 곳은 흰 글자가 읽히는 진한 값으로
    if (g === 'bg') v = v.replace(/var\(--(primary|accent-blue)\)/g, 'var(--d-accent-fill)').replace(/var\(--primary-dark(,[^)]*)?\)/g, 'var(--d-accent-hover)').replace(/var\(--danger\)/g, 'var(--k-danger-fill)').replace(/var\(--success\)/g, 'var(--k-success-fill)');
    const hold = []; v = v.replace(/var\([^()]*\)/g, x => { hold.push(x); return '\u0001' + (hold.length - 1) + '\u0002'; }).replace(/url\([^)]*\)/g, x => { hold.push(x); return '\u0001' + (hold.length - 1) + '\u0002'; });
    const one = (raw, rgba) => { const k = (raw.toUpperCase().replace(/\s+/g, '')) + ' ' + g; stats[k] = (stats[k] || 0) + 1; if (OV.byColor && OV.byColor[k] !== undefined) return OV.byColor[k] === null ? raw : OV.byColor[k]; return darkOf(rgba, g); };
    v = v.replace(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/g, (m, r, gg, b, a) => one(m, [Number(r), Number(gg), Number(b), a === undefined ? 1 : /%$/.test(a) ? parseFloat(a) / 100 : Number(a)]));
    v = v.replace(/#[0-9a-fA-F]{3,8}\b/g, m => one(m, hex2(m)));
    v = v.replace(/(^|[\s,(])(white|black|red|gray|grey|silver|orange|green|blue|yellow|navy|whitesmoke|lightgray|lightgrey|gold|crimson|tomato|darkgray|dimgray)(?=$|[\s,;)!])/gi, (m, pre, name) => pre + one(name, hex2(NAMED[name.toLowerCase()])));
    return v.replace(/\u0001(\d+)\u0002/g, (m, i) => hold[Number(i)]);
}

// ── 중괄호 파서(@media·@keyframes·@supports 안쪽까지)
function parse(text) {
    const res = []; let i = 0;
    while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const head = text.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
        const body = text.slice(open + 1, j - 1);
        res.push(head.startsWith('@') ? { at: head, kids: /{/.test(body) ? parse(body) : null, raw: body } : { sel: head.replace(/\s+/g, ' '), decls: body });
        i = j;
    }
    return res;
}
const declsOf = body => { const res = []; let buf = '', depth = 0; for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) { res.push(buf); buf = ''; } else buf += ch; } if (buf.trim()) res.push(buf); return res.map(d => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]; }).filter(Boolean); };
const splitSel = sel => { const parts = []; let buf = '', depth = 0; for (const ch of sel) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { parts.push(buf.trim()); buf = ''; } else buf += ch; } if (buf.trim()) parts.push(buf.trim()); return parts; };
const SKIP = OV.skipSelectors || [];
const prefix = sel => { const keep = splitSel(sel).filter(s => !SKIP.some(re => re.test(s))); if (!keep.length) return null; return keep.map(s => /^(html|:root)\b/.test(s) ? s.replace(/^(html|:root)/, m => m + '[data-ao-theme="dark"]') : P + s).join(', '); };

let nRules = 0;
const kfAll = {};
function emit(nodes, indent, file) {
    const lines = [];
    for (const n of nodes) {
        if (n.at) {
            if (/^@keyframes/.test(n.at)) {
                const name = n.at.replace(/^@(-webkit-)?keyframes\s+/, '').trim(); let changed = false;
                if (!n.kids) continue;
                const steps = n.kids.map(k => { const ds = declsOf(k.decls).map(([p, v]) => { const nv = FAMILY.test(p) ? mapValue(p, v, '@' + name) : v; if (nv !== v) changed = true; return p + ': ' + nv; }); return k.sel + ' { ' + ds.join('; ') + '; }'; });
                if (changed) { kfAll[name] = true; lines.push(indent + `@keyframes ${name}-dk { ${steps.join(' ')} }`); }
                continue;
            }
            if (/^@(font-face|import|charset|page)/.test(n.at) || /^@media\s+print/.test(n.at) || !n.kids) continue;
            const inner = emit(n.kids, indent + '    ', file);
            if (inner.length) lines.push(indent + n.at + ' {', ...inner, indent + '}');
            continue;
        }
        const sel = prefix(n.sel); if (!sel) continue;
        const ds = [];
        for (const [p, v] of declsOf(n.decls)) {
            if (p.startsWith('--')) continue;
            if (FAMILY.test(p)) ds.push(p + ': ' + mapValue(p, v, n.sel));
        }
        if (ds.length) { nRules++; lines.push(indent + sel + ' { ' + ds.join('; ') + '; }'); }
    }
    return lines;
}
// keyframes 이름은 뒤에서 한 번에 바꿔 단다(같은 파일 안 어디서 쓰였든)
function animFix(nodes, indent) {
    const lines = [];
    for (const n of nodes) {
        if (n.at) { if (/^@keyframes/.test(n.at) || !n.kids || /^@media\s+print/.test(n.at)) continue; const inner = animFix(n.kids, indent + '    '); if (inner.length) lines.push(indent + n.at + ' {', ...inner, indent + '}'); continue; }
        const sel = prefix(n.sel); if (!sel) continue;
        for (const [p, v] of declsOf(n.decls)) if (/^animation(-name)?$/.test(p)) for (const name of Object.keys(kfAll)) if (new RegExp('(^|[\\s,])' + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '([\\s,]|$)').test(v)) lines.push(indent + sel + ' { animation-name: ' + name + '-dk; }');
    }
    return lines;
}

const parts = [];
for (const f of SRC) {
    const css = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const tree = parse(css), before = nRules;
    const body = emit(tree, '', f), anim = animFix(tree, '');
    parts.push(`/* ── ${f} 에서 옮긴 것 (${nRules - before}규칙) ── */`, ...body, ...anim, '');
}
// ── app.js 등이 <style> 글자로 끼워 넣는 CSS — 문서에서 ao-dark.css 보다 뒤에 오므로 :where(점수 0)로는 못 이긴다 → 속성 선택자(점수 있음)로 옮긴다
const JS_SRC = ['app.js', 'order-organizer.js'];
{
    const P2 = 'html[data-ao-theme="dark"] ';
    const strong = sel => { const keep = splitSel(sel).filter(s => !SKIP.some(re => re.test(s)) && !/\$\{/.test(s)); return keep.length ? keep.map(s => P2 + s).join(', ') : null; };
    const walk = (nodes, indent) => { const lines = []; for (const n of nodes) { if (n.at) { if (/^@keyframes/.test(n.at) || !n.kids || /^@media\s+print/.test(n.at)) continue; const inner = walk(n.kids, indent + '    '); if (inner.length) lines.push(indent + n.at + ' {', ...inner, indent + '}'); continue; } const sel = strong(n.sel); if (!sel) continue; const ds = []; for (const [p, v] of declsOf(n.decls)) { if (p.startsWith('--') || /\$\{/.test(v) || !FAMILY.test(p)) continue; const nv = mapValue(p, v, n.sel); if (nv !== v) ds.push(p + ': ' + nv); } if (ds.length) { nRules++; lines.push(indent + sel + ' { ' + ds.join('; ') + '; }'); } } return lines; };
    for (const f of JS_SRC) {
        const js = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8'); const before = nRules, lines = [];
        const re = /(?:<style[^>]*>([\s\S]*?)<\/style>)|(?:createElement\('style'\)[\s\S]{0,200}?\.textContent\s*=\s*`([\s\S]*?)`)/g; let m;
        while ((m = re.exec(js))) { const css = (m[1] || m[2] || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\n/g, '\n'); if (!/{/.test(css)) continue; lines.push(...walk(parse(css), '')); }
        if (lines.length) parts.push(`/* ── ${f} 가 <style> 로 끼워 넣는 CSS (${nRules - before}규칙 · 바뀌는 줄만) ── */`, ...[...new Set(lines)], '');
    }
}
// ── HTML·JS 에 박힌 style 속성의 색 — 파일을 안 고치고 속성 글자로 찾아 덮는다([style*="color:#666"] · !important)
//   짧은 글자가 긴 글자의 앞부분일 수 있어(#fff ⊂ #fff8e1) 짧은 것부터 적는다 → 긴 쪽이 뒤에 와서 이긴다
{
    const HTML_SRC = ['index.html', 'app.js', 'order-organizer.js'];
    const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|(^|[\s:])(white|black|red|gray|grey|silver|orange|green|blue)\b/;
    const found = new Map();
    for (const f of HTML_SRC) {
        const src = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
        const re = /style\s*=\s*(\\?["'])((?:(?!\1).)*)\1/g; let m;
        while ((m = re.exec(src))) {
            for (const raw0 of m[2].split(';')) {
                const raw = raw0.trim(); if (!raw || /\$\{|['"`<>\\]/.test(raw)) continue;
                const k = raw.indexOf(':'); if (k < 0) continue;
                const p = raw.slice(0, k).trim().toLowerCase(), v = raw.slice(k + 1).trim();
                if (!FAMILY.test(p) || !COLOR.test(v)) continue;
                if (!found.has(raw)) found.set(raw, { p, v, n: 0 }); found.get(raw).n++;
            }
        }
    }
    // 일부러 「흰 종이」로 둔 칸(거래처에 보내는 그림과 같아야 하는 표)은 속성 덮기에서 뺀다 — 최종발주 수량 표(.fo-qty)
    const PAPER = ':not(.fo-qty):not(.fo-qty *)';
    const lines = []; let uses = 0;
    for (const [raw, x] of [...found.entries()].sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))) {
        const nv = mapValue(x.p, x.v, '[inline]'); if (nv === x.v) continue;
        // 줄임 속성은 색만 덮는다(굵기·모양은 원래 값 그대로)
        const prop = /^border(-(top|right|bottom|left))?$/.test(x.p) ? x.p + '-color' : x.p === 'outline' ? 'outline-color' : (x.p === 'background' && !/gradient|url\(/.test(x.v)) ? 'background-color' : x.p;
        let val = nv;
        if (prop !== x.p) { const c = nv.match(/var\([^()]*\)|rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g); if (!c) continue; val = c[c.length - 1]; }
        const esc = t => t.replace(/"/g, '\\"');
        // 찾는 글자가 #색으로 끝나면 그 뒤가 「끝·세미콜론·빈칸」인 것만 — 안 그러면 #fff 가 #FFFFFF·#FFF2CC 의 앞부분에도 걸린다(#569 최종발주 수량 표 사고)
        //   color 는 「-color:」(바탕·테두리)에 걸리지 않게 앞이 「처음·세미콜론·빈칸」인 것만
        const forms = t => {
            const e = esc(t), hexEnd = /#[0-9a-fA-F]{3,8}$/.test(t), col = x.p === 'color';
            const heads = col ? [['^=', ''], ['*=', ';'], ['*=', ' ']] : [['*=', '']];
            if (!hexEnd) return heads.map(([op, pre]) => `[style${op}"${pre}${e}" i]`);
            const res = [];
            for (const [op, pre] of heads) { res.push(`[style${op}"${pre}${e};" i]`, `[style${op}"${pre}${e} " i]`); res.push(op === '^=' ? `[style="${e}" i]` : pre ? `[style$="${pre}${e}" i]` : `[style$="${e}" i]`); }
            return res;
        };
        const sels = forms(raw);
        // JS 가 그 요소의 style 을 한 번이라도 만지면 브라우저가 속성을 「속성: rgb(r, g, b)」 꼴로 다시 적는다 → 그 꼴도 같이 찾는다
        if (/#[0-9a-fA-F]{3,8}\b/.test(x.v)) { const ser = x.p + ': ' + x.v.replace(/\s+/g, ' ').replace(/#[0-9a-fA-F]{3,8}\b/g, h => { const c = hex2(h); return c[3] < 0.999 ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Number(c[3].toFixed(3))})` : `rgb(${c[0]}, ${c[1]}, ${c[2]})`; }); sels.push(...forms(ser)); }
        lines.push(sels.map(q => 'html[data-ao-theme="dark"] ' + q + PAPER).join(', ') + ` { ${prop}: ${val} !important; }`); uses += x.n;
    }
    // 토큰을 채운 바탕으로 쓴 속성(흰 글자와 짝)
    for (const [tok, to] of [['--primary', 'var(--d-accent-fill)'], ['--accent-blue', 'var(--d-accent-fill)'], ['--danger', 'var(--k-danger-fill)'], ['--success', 'var(--k-success-fill)']]) for (const sp of ['', ' ']) for (const bp of ['background', 'background-color']) lines.push(`html[data-ao-theme="dark"] [style*="${bp}:${sp}var(${tok})"] { background-color: ${to} !important; }`);
    parts.push(`/* ── index.html · app.js · order-organizer.js 에 박힌 style 속성의 색 (${lines.length}규칙 · 쓰인 곳 ${uses}) ── */`, ...lines, '');
}
// ── 다른 세션(워커2)이 쓰는 조각 — 계산·DB 에서 오는 색 등 CSS 로 풀 수 있는 것
for (const f of fs.readdirSync(__dirname).filter(n => /^extra-.*\.css$/.test(n)).sort()) parts.push(`/* ── ${f} ── */`, fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, ''), '');

if (STATS) { for (const k of Object.keys(stats).sort()) console.log(k.padEnd(36), stats[k]); console.log('rules', nRules); process.exit(0); }
const head = [
    '/* #569 야간 화면(모든 메뉴) — 만든 파일. 손으로 고치지 말 것(scripts/ao-dark/gen-dark.js · overrides.js · hand-dark.css 를 고쳐 다시 만든다).',
    ' * 전부 html[data-ao-theme="dark"] 아래 — 이 속성은 사용자가 야간 화면을 켰고, 지금 보는 메뉴가 「끝난 메뉴 목록」(ao-desk.js DARK_PAGES)에 있을 때만 붙는다.',
    ' * styles.css · theme.css · order-organizer.css 는 한 글자도 안 고쳤다. 색 토큰(--d-*)은 ao-desk.css 의 #568 블록.',
    ' */',
    fs.readFileSync(path.join(__dirname, 'hand-dark.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '').replace('/*@@GEN@@*/', () => parts.join('\n')),
    '',
].join('\n');
fs.writeFileSync(OUT, head);
console.log('ao-dark.css:', Buffer.byteLength(head), 'bytes ·', nRules, '규칙 · keyframes', Object.keys(kfAll).length, '· 색 종류', Object.keys(stats).length);

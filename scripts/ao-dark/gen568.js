// #568 야간 화면 CSS 만들기 — ao-desk.css 의 기존 규칙은 한 글자도 안 바꾸고, 끝에 html[data-ao-theme="dark"] 블록만 붙인다(다시 돌리면 그 블록만 갈아 끼움)
//   사용: node gen568.js <ao-desk.css> <hand568.css>
const fs = require('fs');
const [, , FILE, HAND] = process.argv;
const MARK = '/* ═══ #568 야간 화면';
let src = fs.readFileSync(FILE, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
const at = src.indexOf(MARK);
const base = at >= 0 ? src.slice(0, at).replace(/\s+$/, '') + nl : src.replace(/\s+$/, '') + nl;
const css = base.replace(/\/\*[\s\S]*?\*\//g, '');
const P = ':where(html[data-ao-theme="dark"]) ';   // :where = 점수 0 → 원래 규칙끼리의 우선순위(점수·순서)가 그대로 유지된다
const FAMILY = /^(color|background(-[a-z-]+)?|border(-(top|right|bottom|left))?(-(color|style|width))?|outline(-(color|style|width|offset))?|box-shadow|fill|stroke)$/;

// ── 색 바꿈표: [밝은 색][속성 묶음] → 어두운 화면 값 (null = 그대로)
const A = 'var(--d-accent-soft)';
const MAP = {
    '#FFF': { bg: 'var(--d-card)', fg: null },
    '#000': { bg: null },
    '#039855': { bd: 'var(--d-ok)' },
    '#05603A': { fg: '#7BE3AE' }, '#067647': { fg: '#7BE3AE' },
    '#3730A3': { fg: '#FFFFFF' }, '#4338CA': { fg: '#B4BAFF' },
    '#38BDF8': { bg: null }, '#7C8BFF': { bg: null },
    '#475467': { fg: 'var(--d-sub)' }, '#5A6478': { fg: 'var(--d-sub)' }, '#667085': { fg: 'var(--d-dim)' },
    '#8F96FF': { fg: null },
    '#A5ACFF': { bd: '#4A54A6' }, '#A6E9C4': { bd: 'rgba(61, 214, 140, .38)' },
    '#B42318': { bd: '#D92D20', bg: '#D92D20', fg: '#FF9B91' },
    '#B54708': { fg: '#FBBF4A' },
    '#C7CBFF': { bd: '#3D468A', bg: '#3D468A', sh: '#3D468A' },
    '#D1FADF': { bg: 'rgba(61, 214, 140, .24)' },
    '#D8DBFF': { bd: '#333B73' },
    '#D92D20': { bd: '#FF7A6E', bg: '#C8281C' },
    '#DEE0E7': { bd: '#3A4168' },
    '#E0E2FF': { bd: 'var(--d-line)' },
    '#E3E6FF': { bg: '#2C3566' },
    '#E4E6EE': { bd: 'var(--d-line)', bg: '#242A47' },
    '#E7F8EF': { bg: 'rgba(61, 214, 140, .15)' },
    '#E9EBFF': { bg: '#2A3160' },
    '#ECFDF3': { bg: 'rgba(61, 214, 140, .12)' },
    '#EEF0F4': { bg: '#242A47' },
    '#F0F1FF': { bg: '#202647' },
    '#F3C5C0': { bd: 'rgba(255, 122, 110, .42)' },
    '#F4F5F8': { bg: '#1B2038' }, '#FBFBFD': { bg: '#1F2440' },
    '#F7F7FF': { bg: '#1A1F3A' }, '#FBFBFF': { bg: '#1A1F3A' },
    '#FDA29B': { bd: 'rgba(255, 122, 110, .65)' },
    '#FDD3CF': { bg: 'rgba(255, 122, 110, .28)' },
    '#FECDCA': { bd: 'rgba(255, 122, 110, .38)' },
    '#FEE4E2': { bg: 'rgba(255, 122, 110, .16)' }, '#FEECEB': { bg: 'rgba(255, 122, 110, .16)' }, '#FEF3F2': { bg: 'rgba(255, 122, 110, .10)' },
    '#FEF6E7': { bg: 'rgba(251, 191, 74, .15)' }, '#FFF4E5': { bg: 'rgba(251, 191, 74, .15)' },
    '#FFF3B0': { bg: 'rgba(251, 191, 74, .38)' },
};
const grp = p => /^background/.test(p) ? 'bg' : /^(border|outline)/.test(p) ? 'bd' : p === 'color' ? 'fg' : /shadow/.test(p) ? 'sh' : p;
const unknown = new Set();
function mapValue(prop, value) {
    const g = grp(prop);
    if (!['bg', 'bd', 'fg', 'sh'].includes(g)) return value;
    let v = value;
    // 토큰: 채운 인디고 바탕은 흰 글자가 읽히는 진한 인디고로
    v = v.replace(/var\(--primary-dark,\s*#4338CA\)/gi, g === 'fg' ? '#B4BAFF' : 'var(--d-accent-hover)');
    if (g === 'bg') v = v.replace(/var\(--d-accent\)/g, 'var(--d-accent-fill)');
    const hold = []; v = v.replace(/var\([^()]*\)/g, x => { hold.push(x); return '\u0001' + (hold.length - 1) + '\u0002'; });
    v = v.replace(/rgba\(\s*16,\s*24,\s*40,\s*([\d.]+)\s*\)/g, (m, a) => g === 'sh' ? `rgba(0, 0, 0, ${Math.min(0.8, Number(a) + 0.25).toFixed(2).replace(/0$/, '')})` : m);
    v = v.replace(/rgba\(\s*79,\s*70,\s*229,\s*([\d.]+)\s*\)/g, (m, a) => `rgba(140, 148, 255, ${Math.min(0.9, Number(a) + 0.1).toFixed(2).replace(/0$/, '')})`);
    v = v.replace(/#[0-9a-fA-F]{3,8}\b/g, m => {
        const k = m.toUpperCase(), e = MAP[k];
        if (!e || !(g in e)) { unknown.add(k + ' ' + g + '  (' + prop + ')'); return m; }
        return e[g] === null ? m : e[g];
    });
    return v.replace(/\u0001(\d+)\u0002/g, (m, i) => hold[Number(i)]);
}

// ── 중괄호 파서(@media·@keyframes 안쪽까지)
function parse(text) {
    const out = []; let i = 0;
    while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const head = text.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
        const body = text.slice(open + 1, j - 1);
        out.push(head.startsWith('@') ? { at: head, kids: /{/.test(body) ? parse(body) : null, raw: body } : { sel: head, decls: body });
        i = j;
    }
    return out;
}
const decls = body => body.split(';').map(d => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }).filter(Boolean);
const prefix = sel => sel.split(',').map(s => P + s.trim().replace(/\s+/g, ' ')).join(', ');

const tree = parse(css);
// 색이 든 keyframes → 이름-dk 로 한 벌 더
const kfDark = {};
for (const n of tree) {
    if (!n.at || !/^@keyframes/.test(n.at) || !n.kids) continue;
    const name = n.at.replace(/^@keyframes\s+/, '').trim(); let changed = false;
    const steps = n.kids.map(k => { const ds = decls(k.decls).map(([p, v]) => { const nv = mapValue(p, v === '#fff' && p === 'background-color' ? '#fff' : v); if (nv !== v) changed = true; return p + ': ' + nv; }); return k.sel + ' { ' + ds.join('; ') + '; }'; });
    if (changed) kfDark[name] = `@keyframes ${name}-dk { ${steps.join(' ')} }`;
}
function emit(nodes, indent) {
    const lines = [];
    for (const n of nodes) {
        if (n.at) {
            if (/^@keyframes/.test(n.at) || !n.kids) continue;
            const inner = emit(n.kids, indent + '    ');
            if (inner.length) lines.push(indent + n.at + ' {', ...inner, indent + '}');
            continue;
        }
        const ds = [];
        for (const [p, v] of decls(n.decls)) {
            if (p.startsWith('--')) continue;
            if (FAMILY.test(p)) ds.push(p + ': ' + mapValue(p, v));   // 색이 안 바뀌는 줄(none 등)도 같이 옮긴다 — 안 옮기면 뒤에 붙은 어두운 규칙이 그 줄을 이겨 버린다
            if (/^animation(-name)?$/.test(p)) for (const name of Object.keys(kfDark)) if (new RegExp('(^|\\s)' + name + '(\\s|$)').test(v)) ds.push('animation-name: ' + name + '-dk');
        }
        if (ds.length) lines.push(indent + prefix(n.sel) + ' { ' + ds.join('; ') + '; }');
    }
    return lines;
}
const gen = emit(tree, '');
if (unknown.size) { console.error('바꿈표에 없는 색:\n' + [...unknown].join('\n')); process.exit(1); }
const hand = fs.readFileSync(HAND, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
// #610-F: 이 도구는 MARK 뒤를 통째로 갈아 끼운다 → 야간 블록 뒤에 손으로 덧붙인 규칙이 있으면 말없이 지워진다(#605 13줄 실사고). 그런 글이 있으면 쓰지 않고 멈춘다 — MARK 앞으로 옮긴 뒤 다시 돌릴 것
if (at >= 0) {
    const last = hand.split('\n').pop().trim(), old = src.slice(at).replace(/\r\n/g, '\n'), k = old.lastIndexOf(last);
    const extra = (k >= 0 ? old.slice(k + last.length) : '').trim();
    if (extra) { console.error('야간 블록 뒤에 손으로 붙인 글이 있어요(' + extra.split('\n').length + '줄 · 「' + extra.split('\n')[0].slice(0, 60) + '」). 이 도구는 그 자리를 갈아 끼우므로 지워집니다 → 「' + MARK + '」 줄 앞으로 옮긴 뒤 다시 돌려 주세요.'); process.exit(1); }
}
const block = [
    MARK + ' (대표 10/6) ═══',
    ' * 전부 html[data-ao-theme="dark"] 아래 — 이 속성은 에이전트 오피스 화면에 있고 사용자가 켰을 때만 붙는다(ao-desk.js applyTheme).',
    ' * 위쪽 규칙은 한 글자도 안 바꿨다(밝은 화면 무변경). 아래 ①은 손으로 쓴 것, ②는 위 규칙의 박힌 색을 바꿈표로 옮긴 것(만든 도구 = 스크래치 gen568.js).',
    ' */',
    hand.replace('/*@@GEN@@*/', () => ['/* ② 위 규칙의 색·바탕·테두리·그림자 줄을 순서 그대로 옮기고 박힌 색만 어두운 값으로 바꾼 것 (' + gen.filter(l => l.includes('{') && !/^\s*@/.test(l)).length + '규칙 · :where 라 우선순위는 원래와 같다) */', ...Object.values(kfDark), ...gen].join('\n')),
    '',
].join('\n').split('\n').join(nl);
fs.writeFileSync(FILE, base + block);
console.log('generated rules:', gen.length, '· keyframes:', Object.keys(kfDark).join(','));

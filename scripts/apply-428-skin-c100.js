/* #428 보정: VIP세트(c100=10801253976) 황금향 옵션 2행 — 네이버 번호 재편(황금향 1→2·감귤 2→1)으로 새 객체가 네이버 n1 「2. 과즙팡팡 황금향」을 받았으나
   카페24 c100 옵션 텍스트는 「1. 과즙팡팡 황금향 · …」(9/7 실측). 「찾는 글자」 n1 = 카페24값 / 「보이는 글자」 nd = 네이버 현재 표기 (대표 확정 분리 방식). */
const fs = require('fs');
const FILE = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index.html';
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');
const li = lines.findIndex(l => l.startsWith('<script>window.STORE_DATA = '));
const L = lines[li]; const i0 = L.indexOf('{'), i1 = L.lastIndexOf('}');
const D = JSON.parse(L.slice(i0, i1 + 1));
const it = D.items.find(x => String(x.no) === '10801253976');
let n = 0;
for (const o of it.opts) {
  if (o.n1 === '2. 과즙팡팡 황금향') { o.n1 = '1. 과즙팡팡 황금향'; o.nd = '2. 과즙팡팡 황금향'; n++; }
}
if (n !== 2) throw new Error('대상 2행 아님: ' + n);
const newL = L.slice(0, i0) + JSON.stringify(D) + L.slice(i1 + 1);
lines[li] = newL;
const out = lines.join('\n');
if (out.split('\n').length !== src.split('\n').length) throw new Error('줄 수 변동');
fs.writeFileSync(FILE, out, 'utf8');
for (const o of it.opts) console.log('  ', o.n1, o.nd ? '(표시:' + o.nd + ')' : '', '·', o.n2, '·', o.price);
console.log('✅ c100 황금향 2행 n1=카페24값·nd=네이버표기 (' + Buffer.byteLength(out) + 'b)');

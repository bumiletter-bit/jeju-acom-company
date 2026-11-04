// #1016-B 쿠팡 상세 = 지금 쿠팡 상세(보관본 contents) 그대로 + 보겸 배너 2블록 끼움 → plan-full --detail-blocks 파일(쓰기 = 이 파일뿐)
//   node cpblocks.js <쿠팡 보관본 json> <쿠팡 상품번호> <뒤에 넣을 contents 번호(0부터)> <짝 네이버 상품번호> <네이버 보관본 id> <배너 주소> <out.json>
'use strict';
const fs = require('fs');
const [file, spid, after, nno, nbid, banner, out] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = j.items || [];
if (!items.every(it => JSON.stringify(it.contents) === JSON.stringify(items[0].contents))) throw new Error('옵션마다 상세가 다름 — 멈춤');
const blocks = items[0].contents.map((c, i) => {
    const d = (c.contentDetails || [])[0] || {};
    if (c.contentsType === 'IMAGE_NO_SPACE' && (c.contentDetails || []).length === 1) return { type: 'image', url: d.content };
    if (c.contentsType === 'TEXT' && (c.contentDetails || []).length === 1) return { type: 'html', html: d.content };
    throw new Error(`contents ${i} 꼴이 예상 밖: ${c.contentsType}/${(c.contentDetails || []).length}`);
});
const k = Number(after);
if (!(k >= 0 && k < blocks.length)) throw new Error('자리 번호 범위 밖');
const add = [
    { type: 'html', html: '<p style="text-align:center;"><span style="color:#222222;font-size:19px;"><b>📺 보겸TV 쇼츠에 나온 귤 농장</b></span></p>' },
    { type: 'image', url: banner, alt: '유튜브 보겸TV 쇼츠 조회수 7,000만, 그 귤 농장이 여기예요' },
];
const nb = blocks.slice(0, k + 1).concat(add, blocks.slice(k + 1));
fs.writeFileSync(out, JSON.stringify({ from_naver: nno, naver_backup_id: Number(nbid), coupang: spid, note: '#1016 지금 쿠팡 상세 + 보겸 배너(네이버판 전환 아님)', blocks: nb }, null, 1));
console.log(JSON.stringify({ out, blocks_before: blocks.length, blocks_after: nb.length, after: k, prev: blocks[k].type, next: (blocks[k + 1] || {}).type }));

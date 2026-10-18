// #746 쿠팡 상세 정책 정리(detail-blocks.js coupangPolicy · toCoupangContents) + 가격 확인 글 표 쿠팡 열(price-check.js toText coupang) — 순수 함수 · DB·외부 0
const path = require('path');
const D = require(path.join(__dirname, '..', 'detail-blocks.js'));
const PC = require(path.join(__dirname, '..', 'price-check.js'));
let pass = 0, fail = 0; const ok = (x, m, y) => { if (x) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m, y === undefined ? '' : JSON.stringify(y).slice(0, 400)); } };

const NAVER = [
    '<div><p>제주 하우스감귤</p></div>',
    '<a href="https://brand.naver.com/jejuakkome/products/11126666859"><img src="https://shop-phinf.pstatic.net/a.jpg" alt=""></a>',
    '<a href="https://smartstore.naver.com/akkome/products/5531798664"><img src="https://shop-phinf.pstatic.net/b.jpg"></a>',
    '<p>당도 12브릭스 이상</p><p>스토어찜 하시면 쿠폰을 드려요</p><p>신선하게 보내요</p>',
    '<a href="https://map.naver.com/p/entry/place/1"><strong>네이버 지도</strong><p>제주아꼼이네</p><p>map.naver.com</p></a><hr>',
    '<p>새 소식은 톡톡으로<br>보관은 서늘한 곳<br>알림받기 눌러 주세요</p>',
    '<img src="https://shop-phinf.pstatic.net/c.jpg">',
    '<a href="https://www.coupang.com/vp/products/16279623654"><img src="https://shop-phinf.pstatic.net/d.jpg"></a>',
    '<a href="https://www.coupang.com/vp/products/1?x=evil"><img src="https://shop-phinf.pstatic.net/e.jpg"></a>',
].join('\n');

(async () => {
    console.log('① 기본 정리');
    const f = D.fromNaverHtml(NAVER, { links: false });
    const P = D.coupangPolicy(f.blocks);
    const all = JSON.stringify(P.blocks);
    ok(!/naver\.com/.test(all), '네이버 주소 0', all);
    ok(P.unlinked === 4, '벗긴 링크 4(brand · smartstore · map · 쿠팡 꼴 아닌 것)', P.unlinked);
    ok((all.match(/<a\b/g) || []).length === 1 && /vp\/products\/16279623654/.test(all), '쿠팡 상품 주소 링크 1개만 남음', all);
    ok(D.POLICY_WORDS.every(w => !all.toLowerCase().includes(w)), '정책 낱말 0', all);
    ok(/당도 12브릭스/.test(all) && /신선하게 보내요/.test(all) && /보관은 서늘한 곳/.test(all), '같은 블록의 다른 단락·줄은 남음', all);
    const words = P.removed.map(x => x.text);
    ok(P.removed.length === 5 && words.some(t => /스토어찜/.test(t)) && words.some(t => /톡톡/.test(t)) && words.some(t => /알림받기/.test(t)) && words.includes('네이버 지도') && words.includes('map.naver.com'), '뺀 문장 5 = 스토어찜 · 톡톡 · 알림받기 · 네이버 지도 · map.naver.com(단락·줄 단위)', words);
    ok(P.removed.every(x => x.html && x.block > 0), '뺀 문장마다 원문 html · 블록 번호', P.removed);
    ok(P.images.length === 5 && f.images === 5, '그림 5장 다 남음 · 목록 5', P.images);
    ok(P.blocks.filter(b => b.type === 'image').length === 4, '링크 벗긴 그림 = image 블록(4)', P.blocks.map(b => b.type));
    console.log('② 멱등 · 원본 무변경');
    const again = D.coupangPolicy(P.blocks);
    ok(JSON.stringify(again.blocks) === JSON.stringify(P.blocks) && again.removed.length === 0 && again.unlinked === 0, '한 번 더 돌려도 같음');
    ok(JSON.stringify(D.fromNaverHtml(NAVER, { links: false }).blocks) === JSON.stringify(f.blocks), '원본 blocks 그대로');
    console.log('③ linkMap(네이버 상품 → 짝 쿠팡 주소)');
    const L = D.coupangPolicy(f.blocks, { linkMap: { '11126666859': '777001' } });
    const lj = JSON.stringify(L.blocks);
    ok(/vp\/products\/777001/.test(lj) && L.relinked.length === 1 && L.relinked[0].from.includes('11126666859'), '황금향 링크 → 쿠팡 777001', L.relinked);
    ok(!/5531798664/.test(lj) && L.unlinked === 3, '짝 없는 레몬 링크는 벗김', L.unlinked);
    ok(D.naverProductNo('https://m.smartstore.naver.com/akkome/products/123456?x=1') === '123456' && D.naverProductNo('https://blog.naver.com/a/123456') === null, '네이버 상품 번호 읽기');
    ok(D.isCoupangLink('https://www.coupang.com/vp/products/12?itemId=3&vendorItemId=4') && !D.isCoupangLink('http://www.coupang.com/vp/products/12') && !D.isCoupangLink('https://www.coupang.com/vp/products/12?q=x'), '쿠팡 주소 판정(https · 숫자 쿼리만)');
    console.log('④ toCoupangContents = 서버 길도 늘 정리');
    const C = JSON.stringify(D.toCoupangContents(f.blocks));
    ok(!/naver\.com|스토어찜|톡톡|알림받기/.test(C) && /vp\/products\/16279623654/.test(C), 'contents 안 네이버 0 · 쿠팡 링크 남음', C.slice(0, 300));
    ok(JSON.stringify(D.toCoupangContents(P.blocks)) === C, '이미 정리한 blocks 를 넣어도 같은 contents');
    const raw = JSON.stringify(D.toCoupangContents(f.blocks, { policy: false }));
    ok(/naver\.com/.test(raw), 'policy:false = 종전 그대로(정리 안 함)');
    ok(D.toCoupangContents([{ type: 'image', url: 'https://x/1.jpg' }])[0].contentsType === D.CP.imageType, '그림 블록 = IMAGE_NO_SPACE 그대로');

    console.log('⑤ 가격 확인 글 표 쿠팡 열(늘)');
    const base = { snapshots: [{ id: 1, run_at: '2026-10-18T00:00:00Z', items: [{ no: 5531798664, name: '제주 그린레몬', statusType: 'SALE', discPrice: 36800, opts: [{ n1: '과수 및 크기: 제주 그린레몬3kg(중소과)', price: 0, stock: 9, usable: true }, { n1: '과수 및 크기: 제주 그린레몬5kg(중소과)', price: 18800, stock: 9, usable: true }] }] }],
        pricingNames: ['과수 및 크기: 제주 그린레몬3kg(중소과)', '과수 및 크기: 제주 그린레몬5kg(중소과)'], pages: {}, syncMap: {}, ignoreKeys: [], cfg: { naverCfgGet: async () => null }, now: '2026-10-18T06:00:00Z',
        coupangMap: { '9001': { item_name: '그린레몬 중소과 3kg 1박스' } },
        coupangItems: [{ vid: '9001', seller_product_id: '111', product_name: '제주레몬', item_name: '그린레몬 중소과 3kg 1박스', price: 36800, stock: 5, on_sale: true }, { vid: '9002', seller_product_id: '111', product_name: '제주레몬', item_name: '그린레몬 중소과 5kg 1박스', price: 55000, stock: 5, on_sale: true }],
        coupangFrom: '방금 쿠팡에서 읽음(러너)' };
    const rep = await PC.build(base);
    const T = PC.toText(rep, { coupang: true });
    ok(/━━━ 쿠팡 2개/.test(T) && /3kg\(중소과\) · 쿠팡 36,800 · 네이버 36,800 · 같음/.test(T) && /5kg\(중소과\) · 쿠팡 55,000 · 네이버 55,600 · 🔴 다름 -600/.test(T), '쿠팡 2줄 · 같음 · 다름', T);
    ok(/쿠팡 방금 쿠팡에서 읽음\(러너\)/.test(T) && rep.source.coupang_from, '자료 줄 = 출처 글', T.split('\n').pop());
    const T0 = PC.toText(rep, {});
    ok(!/━━━ 쿠팡/.test(T0), 'coupang 옵션 없으면(서버·텔레그램) 종전 글 그대로');
    console.log('⑥ #752 html_raw = 쿠팡 HTML 블록(기본 길 무변경)');
    const RAW = '<p>[H]</p><img src="https://x.test/a.webp">';
    const cc = D.toCoupangContents([{ type: 'html', html: '<p>글</p>' }, { type: 'html_raw', html: RAW }, { type: 'image', url: 'https://x.test/b.gif' }]);
    ok(cc.length === 3 && cc[0].contentsType === 'TEXT' && cc[1].contentsType === 'HTML' && cc[1].contentDetails[0].content === RAW && cc[1].contentDetails[0].detailType === 'TEXT' && cc[2].contentsType === 'IMAGE_NO_SPACE', 'html = TEXT 그대로 · html_raw = HTML · 글 바이트 그대로 · image 그대로', JSON.stringify(cc));
    const pr = D.coupangPolicy([{ type: 'html_raw', html: '<a href="https://smartstore.naver.com/x/products/1"><img src="https://x.test/c.gif"></a>' }, { type: 'html', html: '<img src="https://x.test/d.gif">' }]).blocks;
    ok(pr.length === 2 && pr[0].type === 'html_raw' && /smartstore/.test(pr[0].html) && pr[1].type === 'image', '정리 = html_raw 무접촉 · 글 없는 html 그림은 종전대로 image 로', JSON.stringify(pr));
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('크래시', e); process.exit(1); });

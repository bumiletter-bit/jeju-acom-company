// #728 창구용 — 쿠팡 옵션(vendorItem) 판매가 · 재고 · 판매중지/재개 (1차 · 대표 「쿠팡도 고」 10/18 · 쿠팡 승인 심사 없이 즉시 반영되는 셋만)
//   node scripts/desk/coupang-item.js list [검색어]                                  상품·옵션 표(상품 번호 · vendorItemId · 판매가 · 재고 · 판매 상태) — 고를 때는 vendorItemId 로
//   node scripts/desk/coupang-item.js show <vendorItemId> <상품 번호> <지시 id>        그 옵션 지금 값을 서버가 보관(backup) → 요약 + 「건들기 전 판매 정상」
//   node scripts/desk/coupang-item.js plan <backup_id> --price <원> | --stock <수> | --stop | --resume   전/후 카드(보내지 않음 · 쓰기 0 · 한 번에 한 칸)
//   node scripts/desk/coupang-item.js apply <backup_id> <지시 id> (plan 과 같은 인자)   실행 → 서버가 다시 읽어 대조 → 결과 카드(끝 두 줄 = 판매 정상 전/후)
//   node scripts/desk/coupang-item.js revert <backup_id> <지시 id> [--force]          적용한 칸만 보관한 값으로(그 뒤 쿠팡에서 또 바뀌었으면 멈춤 · 덮는 --force 는 되묻기 1회 뒤)
//   ── #729 2차(상품 단위 · 쿠팡 승인 심사행 — 승인된 상품은 승인 전까지 손님 화면이 옛 모습 · 임시저장 상품은 저장만)
//   node scripts/desk/coupang-item.js full <상품 번호> <지시 id>                       상품 통째 보관(get_full) → 이름 · 승인 상태 · 옵션 표 · 상세 꼴(글 한 칸인지)
//   node scripts/desk/coupang-item.js plan-full <backup_id> --name "<글>" | --item-name <vendorItemId 또는 지금 옵션명>=<새 이름>(여러 번) | --detail <html 파일>   전/후 카드(보내지 않음)
//                                     | --detail-from-naver <네이버 상품번호>(#733 네이버 상세 → 블록 → 미리보기 PNG · naver-detail show 로 보관한 상세를 씀) | --add-item "<옵션명>=<가격>[=<재고>]"(#733 새 옵션 · 여러 번)
//   node scripts/desk/coupang-item.js apply-full <backup_id> <지시 id> (plan-full 과 같은 인자)   전체 수정 → 「🟡 쿠팡 승인 대기」 카드
//   node scripts/desk/coupang-item.js revert-full <backup_id> <지시 id> [--force]      보관본 그대로 다시 저장(이것도 승인행)
//   node scripts/desk/coupang-item.js approval <상품 번호>                             승인 상태 · 반려 사유(읽기만)
//   node scripts/desk/coupang-item.js create-saved <지시 id> --from <본뜰 상품 번호> --name "<새 이름>" [--item "<옵션명>=<가격>[=<재고>]" …] [--dry]   임시저장 등록(손님 노출 0 · 24시간 3개)
//   node scripts/desk/coupang-item.js delete-saved <상품 번호> <지시 id>                 임시저장 상품만 지움(승인된 상품은 윙에서)
//   🔴 승인 「요청」(임시저장 → 실제 판매 심사)은 도구에 없다 — 윙에서 사람이 올린다
//   ── #733 전체 가격 확인의 쿠팡 연결표(agent_office_config 'coupang_item_map' · 계약 docs/733-price-check-coupang.md)
//   node scripts/desk/coupang-item.js map                                   지금 연결표
//   node scripts/desk/coupang-item.js map --suggest [--live] [검색어]        쿠팡 옵션마다 자동 짝(판매현황·단가표 이름) 제안 · 판매 상태 — 쓰기 0 · --live = 지금 파는 옵션만
//   node scripts/desk/coupang-item.js map --apply <지시 id> [--live] [검색어]  제안대로 연결표에 넣음(손으로 정한 칸은 그대로 · 짝 못 찾은 것도 넣어 「쿠팡 짝 없음」으로 보이게)
//   node scripts/desk/coupang-item.js map --set <vendorItemId> <지시 id> bot=<판매현황 id> | label=<단가표 이름> | separate=true|false | ignore=true|false | clear=true
//   길 = 요청 줄 agent_office_config 'coupang_item_write_request' → 실서버 20초 틱 → 'coupang_item_write_result'(계약 docs/728-coupang-contract.md)
//        이 도구는 쿠팡 키도 주소도 모른다 — 요청 줄 INSERT 와 결과 읽기, 보관본(coupang_item_backups) 읽기뿐.
//   🔴 평일 08:30~10:30(발송 직전)엔 apply·revert 를 하지 않는다(plan 은 됨). 밖 = 상품명·옵션명·상세·대표 그림·등록(쿠팡 승인 심사 = 2차 · 윙에서 직접)
const fs = require('fs'), path = require('path');
const REQ_KEY = 'coupang_item_write_request', RES_KEY = 'coupang_item_write_result';
const PRICE_MAX = 10000000, PRICE_UNIT = 10, STOCK_MAX = 99999;   // 서버 계약과 같게(10원 단위 · 재고 99999 이하 · 가격은 중계 상한)
const BAD_KO = { on_sale: '판매중지', stock: '재고 0', price: '판매가', read: '다시 읽기 실패' };
const won = n => n == null ? '(없음)' : Number(n).toLocaleString('ko-KR');
const saleKo = v => v === true ? '판매중' : v === false ? '판매중지' : '(모름)';

// ── 시각(KST) · 발송 직전 막기
function kstParts(now) { const d = new Date(now + 9 * 3600000); return { dow: d.getUTCDay(), hm: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
function busyWindow(now) { const k = kstParts(now); return k.dow >= 1 && k.dow <= 5 && k.hm >= 8 * 60 + 30 && k.hm < 10 * 60 + 30; }

// ── 인자
function parseOpts(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--price' || a === '--stock') o[a.slice(2)] = args[++i];
        else if (a === '--stop') o.stop = true;
        else if (a === '--resume') o.resume = true;
        else if (a === '--force') o.force = true;
        else if (a === '--name' || a === '--detail' || a === '--from') o[a.slice(2)] = args[++i];
        else if (a === '--item-name') (o.itemName = o.itemName || []).push(args[++i]);
        else if (a === '--item') (o.item = o.item || []).push(args[++i]);
        else if (a === '--detail-from-naver') o.fromNaver = args[++i];
        else if (a === '--add-item') (o.addItem = o.addItem || []).push(args[++i]);
        else if (a === '--suggest') o.suggest = true;
        else if (a === '--live') o.live = true;   // #741 map: 지금 파는 옵션(판매중 · 재고 > 0)만
        else if (a === '--apply') o.mapApply = true;
        else if (a === '--set') o.mapSet = true;
        else if (a === '--dry') o.dry = true;
        else rest.push(a);
    }
    return { o, rest };
}
const toInt = v => { const n = Number(String(v == null ? '' : v).replace(/[,원개\s]/g, '')); return Number.isInteger(n) ? n : null; };

// 서버 값(보관본 before · after · now · list 옵션) → { price, stock, on_sale, item_name, product_name, seller_product_id }
function norm(b) {
    b = b || {};
    const pick = (...ks) => { for (const k of ks) if (b[k] != null) return b[k]; return null; };
    const num = v => v == null || v === '' ? null : Number(v);
    const os = pick('on_sale', 'saleStatus', 'onSale');
    return {
        price: num(pick('price', 'salePrice')),
        stock: num(pick('stock', 'quantity', 'amountInStock')),
        on_sale: os == null ? null : (os === true || os === 'ON_SALE' || String(os).toLowerCase() === 'true') ? true : false,
        item_name: pick('item_name', 'itemName'),
        product_name: pick('product_name', 'name', 'sellerProductName'),
        seller_product_id: pick('seller_product_id', 'sellerProductId') == null ? null : String(pick('seller_product_id', 'sellerProductId')),
    };
}
// 판매 정상(서버 cpwSaleCheck 와 같은 칸) — 서버 sale_ok 가 오면 그쪽 우선
function saleOkSelf(n) {
    const bad = [];
    if (n.on_sale !== true) bad.push('on_sale');
    if (!(n.stock > 0)) bad.push('stock');
    if (!(n.price > 0)) bad.push('price');
    return { ok: !bad.length, bad };
}
// 일부러 바꿔서 bad 로 잡히는 게 정상인 칸
function expectBad(patch) {
    const e = [];
    if (patch.sales === 'stop') e.push('on_sale');
    if (patch.stock === 0) e.push('stock');
    return e;
}
function saleLine(label, s, expect) {
    if (!s) return `${label} 판매 정상 ?(확인 못 함 — show 로 다시 보기)`;
    const bad = (s.bad || []).filter(x => !(expect || []).includes(x));
    const intended = (s.bad || []).filter(x => (expect || []).includes(x));
    if (!bad.length) return `${label} 판매 정상 ✓` + (intended.length ? `(일부러 바꾼 칸 = ${intended.map(x => BAD_KO[x] || x).join('·')} · 정상)` : '');
    return `${label} 판매 정상 ⚠ ${bad.map(x => BAD_KO[x] || x).join('·')}`;
}

// ── 바꿀 것 → { patch(계약 꼴 · 한 칸), rows, stops, errs, warns, n }
function planRows(before, o) {
    const n = norm(before), patch = {}, rows = [], stops = [], errs = [], warns = [];
    const picks = (o.price != null ? 1 : 0) + (o.stock != null ? 1 : 0) + (o.stop ? 1 : 0) + (o.resume ? 1 : 0);
    if (!picks) errs.push('바꿀 것을 주세요: --price <원> | --stock <수> | --stop | --resume');
    if (picks > 1) errs.push('한 번에 한 칸만 바꿔요(--price · --stock · --stop · --resume 중 하나) — 둘 다면 apply 를 두 번(show 부터 다시)');
    if (errs.length) return { patch, rows, stops, errs, warns, n };
    if (o.price != null) {
        const p = toInt(o.price);
        if (p == null) errs.push('--price 는 원 단위 정수예요');
        else if (p <= 0) stops.push('판매가가 0원 이하예요 — 숫자를 다시 확인해 주세요');
        else if (p > PRICE_MAX) stops.push(`판매가 상한(${won(PRICE_MAX)}원)을 넘어요 — 숫자를 다시 확인해 주세요`);
        else if (p % PRICE_UNIT) stops.push(`쿠팡 판매가는 10원 단위만 돼요(${won(p)}원) — 끝자리를 0 으로`);
        else if (n.price === p) stops.push(`판매가가 이미 ${won(p)}원이에요`);
        else if (n.price > 0 && (p >= n.price * 10 || p * 10 <= n.price)) stops.push(`판매가가 10배 넘게 바뀌어요(${won(n.price)} → ${won(p)}원) — 0 을 더 붙이거나 뺐는지 요청하신 분께 되묻기`);
        else if (n.price > 0 && (p * 2 < n.price || p > n.price * 2)) stops.push(`쿠팡 기본 제한(지금 값의 50% 아래로 내리기 · 2배 넘게 올리기) 밖이에요(${won(n.price)} → ${won(p)}원) — 쿠팡이 거절해요 · 정말 이 값이면 쿠팡 윙(wing.coupang.com)에서 직접`);
        else { patch.price = p; rows.push({ field: '판매가', before: won(n.price) + '원', after: won(p) + '원' }); }
    }
    if (o.stock != null) {
        const s = toInt(o.stock);
        if (s == null) errs.push('--stock 은 정수예요');
        else if (s < 0) stops.push('재고가 음수예요 — 숫자를 다시 확인해 주세요');
        else if (s > STOCK_MAX) stops.push(`재고는 ${won(STOCK_MAX)} 까지예요`);
        else if (n.stock === s) stops.push(`재고가 이미 ${won(s)}예요`);
        else { patch.stock = s; rows.push({ field: '재고', before: won(n.stock), after: won(s) }); if (s === 0) warns.push('재고를 0 으로 두면 쿠팡에서 품절로 보여요'); }
    }
    if (o.stop || o.resume) {
        const want = !!o.resume;
        if (n.on_sale === want) stops.push(`이미 ${saleKo(want)}이에요`);
        else if (want && n.stock === 0) stops.push('재고가 0 이라 다시 팔아도 품절이에요 — 먼저 재고를 넣고(--stock <수> · 재고 수는 요청하신 분께 되묻기) 그다음 --resume');
        else { patch.sales = want ? 'resume' : 'stop'; rows.push({ field: '판매 상태', before: saleKo(n.on_sale), after: saleKo(want) }); }
    }
    return { patch, rows, stops, errs, warns, n };
}
function card(head, n, vid, rows, extra) {
    const L = [`━━━ 쿠팡 옵션 ${head} ━━━`, `상품: ${n.product_name || '(이름 모름)'}${n.item_name ? ' · 옵션 ' + n.item_name : ''} (vendorItemId ${vid || '?'})`];
    if (Array.isArray(rows) && !rows.length) L.push('바뀌는 곳 없음 — 지금 값과 같아요');
    for (const r of (rows || [])) L.push(`· ${r.field}: ${r.before} → ${r.after}`);
    for (const x of (extra || [])) L.push(x);
    return L.join('\n');
}
// 서버 결과 두 값 → 카드 줄(바뀐 칸만)
function resultRows(b, a) {
    const B = norm(b), A = norm(a), rows = [];
    if (B.price !== A.price) rows.push({ field: '판매가', before: won(B.price) + '원', after: won(A.price) + '원' });
    if (B.stock !== A.stock) rows.push({ field: '재고', before: won(B.stock), after: won(A.stock) });
    if (B.on_sale !== A.on_sale) rows.push({ field: '판매 상태', before: saleKo(B.on_sale), after: saleKo(A.on_sale) });
    return rows;
}
const KEY_KO = { price: '판매가', stock: '재고', on_sale: '판매 상태', sales: '판매 상태' };

// ── #729 2차 도우미
const isSavedJ = j => ['임시저장', 'SAVED'].includes(String((j && (j.statusName || j.status)) || ''));
const oneText = it => { const cs = (it && it.contents) || []; if (cs.length !== 1) return null; const ds = cs[0].contentDetails || []; return ds.length === 1 && ds[0].detailType === 'TEXT' ? ds[0] : null; };
const shapeOf = it => ((it && it.contents) || []).map(c => `${c.contentsType || '?'}:${(c.contentDetails || []).map(d => d.detailType || '?').join('+')}`).join(',') || '없음';
// 상품 통째 보관본 + 인자 → { patch(계약 꼴), rows, errs } — 서버(cpwApplyFull)와 같은 거절을 먼저(보내지 않음)
function planFull(before, o, readFile) {
    const patch = {}, rows = [], errs = [], items = (before && before.items) || [];
    if (o.name == null && !(o.itemName || []).length && o.detail == null && !o.blocks && !(o.addItem || []).length) errs.push('바꿀 것을 주세요: --name "<글>" | --item-name <vendorItemId>=<새 이름> | --detail <html 파일> | --detail-from-naver <네이버 상품번호> | --add-item "<옵션명>=<가격>=<재고>"');
    if (o.detail != null && o.blocks) errs.push('--detail 과 --detail-from-naver 는 하나만');
    if (o.blocks) {   // #733 네이버 상세 → 블록(detail-blocks.js) — 모든 옵션 상세를 통째로 바꿈(그림 구성 상품도 됨)
        const S = o.blocksSummary || {};
        if (!o.blocks.length) errs.push('네이버 상세에서 블록을 못 만들었어요(빈 상세)');
        else if (o.blocks.length > 60) errs.push(`블록이 ${o.blocks.length}개라 쿠팡 한도(60)를 넘어요 — 상세를 줄이거나 윙에서`);
        else if (o.blocks.some(b => b.type === 'html' && /<\s*\/?\s*script\b/i.test(b.html))) errs.push('블록에 script 가 있어요');
        else { patch.detail_blocks = o.blocks; rows.push({ field: '상세(모든 옵션 · 통째 교체)', before: `지금 ${items.map(shapeOf).filter((x, i, a) => a.indexOf(x) === i).join(' / ').slice(0, 60)}`, after: `네이버 ${o.fromNaver} 상세 → 블록 ${o.blocks.length}개(그림 ${S.images}장 · 링크 그림 ${S.linked_images} · 글 ${S.text_blocks})` }); }
    }
    if ((o.addItem || []).length) {   // #733 새 옵션 = 마지막 옵션을 틀로(그림·상세·속성·고시) · vendorItemId 는 승인 뒤
        const I = parseItems(o.addItem), have = new Set(items.map(it => it.itemName));
        errs.push(...I.errs);
        if (!I.errs.length) {
            if (I.items.length > 10) errs.push('새 옵션은 한 번에 10개까지예요');
            for (const x of I.items) {
                if (have.has(x.itemName)) { errs.push(`옵션명 「${x.itemName}」 이 이미 있어요`); continue; }
                rows.push({ field: `새 옵션 「${x.itemName}」`, before: '(없음)', after: `${won(x.price)}원 · 재고 ${won(x.stock != null ? x.stock : 99999)} · 마지막 옵션(${(items[items.length - 1] || {}).itemName || '?'})을 틀로` });
            }
            if (!errs.length) patch.items_add = I.items.map(x => Object.assign({ itemName: x.itemName, price: x.price, stock: x.stock != null ? x.stock : 99999 }));
        }
    }
    if (o.name != null) {
        const n = String(o.name).trim();
        if (!n || n.length > 100) errs.push('상품명은 1~100자예요');
        else if (n === before.sellerProductName) errs.push('지금 상품명과 같아요');
        else { patch.name = n; rows.push({ field: '상품명', before: before.sellerProductName || '(없음)', after: n }); }
    }
    if ((o.itemName || []).length) {
        const m = {}, used = new Set(items.map(it => it.itemName));
        for (const raw of o.itemName) {
            const i = String(raw || '').indexOf('=');
            const k = i > 0 ? String(raw).slice(0, i).trim() : '', v = i > 0 ? String(raw).slice(i + 1).trim() : '';
            if (!k || !v) { errs.push(`--item-name 「${raw}」: <vendorItemId 또는 지금 옵션명>=<새 이름> 꼴로`); continue; }
            const hit = items.filter(it => String(it.vendorItemId || '') === k || String(it.sellerProductItemId || '') === k || it.itemName === k);
            if (hit.length !== 1) { errs.push(`옵션 「${k}」 을 하나로 찾지 못했어요(${hit.length}개) — full 의 옵션 번호로`); continue; }
            if (v.length > 150) { errs.push('옵션명은 150자까지예요'); continue; }
            if (v === hit[0].itemName) { errs.push(`옵션 「${k}」 은 이미 「${v}」예요`); continue; }
            if (used.has(v)) { errs.push(`옵션명 「${v}」 이 다른 옵션과 겹쳐요`); continue; }
            used.add(v); m[k] = v; rows.push({ field: `옵션명(${hit[0].vendorItemId || hit[0].sellerProductItemId || k})`, before: hit[0].itemName || '(없음)', after: v });
        }
        if (Object.keys(m).length) patch.item_names = m;
    }
    if (o.detail != null) {
        let h = null;
        try { h = readFile(String(o.detail)); } catch (e) { errs.push('--detail 파일을 못 읽었어요: ' + o.detail); }
        if (h != null) {
            const bad = items.filter(it => !oneText(it));
            if (!String(h).trim() || h.length > 320000) errs.push('상세는 1~320,000자 글이에요');
            else if (/<\s*\/?\s*script\b/i.test(h)) errs.push('상세에 script 는 못 넣어요');
            else if (bad.length) errs.push(`상세 구성이 「글 한 칸」이 아닌 옵션이 있어 창구에서 못 바꿔요(${bad.map(it => `${it.itemName}: ${shapeOf(it)}`).join(' · ')}) — 상세는 윙에서`);
            else { const cur = (oneText(items[0]) || {}).content || ''; if (cur === h) errs.push('지금 상세와 같아요'); else { patch.detail_html = h; rows.push({ field: '상세(모든 옵션)', before: `${won(cur.length)}자`, after: `${won(h.length)}자` }); } }
        }
    }
    return { patch, rows, errs };
}
// create-saved --item "옵션명=가격[=재고]" → 계약 items[{ itemName, price, stock? }]
function parseItems(list) {
    const items = [], errs = [];
    for (const raw of (list || [])) {
        const p = String(raw || '').split('=').map(x => x.trim());
        if (p.length < 2 || p.length > 3 || !p[0]) { errs.push(`--item 「${raw}」: "<옵션명>=<가격>[=<재고>]" 꼴로`); continue; }
        const price = toInt(p[1]), stock = p.length === 3 ? toInt(p[2]) : null;
        if (p[0].length > 150) { errs.push('옵션명은 150자까지예요'); continue; }
        if (!(price > 0) || price % PRICE_UNIT) { errs.push(`--item 「${raw}」: 가격은 10원 단위 양의 정수`); continue; }
        if (p.length === 3 && (stock == null || stock < 0 || stock > STOCK_MAX)) { errs.push(`--item 「${raw}」: 재고는 0~${won(STOCK_MAX)}`); continue; }
        items.push(Object.assign({ itemName: p[0], price }, stock != null ? { stock } : {}));
    }
    if (items.length > 20) errs.push('옵션은 20개까지예요');
    if (new Set(items.map(x => x.itemName)).size !== items.length) errs.push('옵션명이 겹쳐요');
    return { items, errs };
}
function pcard(head, name, spid, rows, extra) {
    const L = [`━━━ 쿠팡 상품 ${head} ━━━`, `상품: ${name || '(이름 모름)'} (상품 번호 ${spid || '?'})`];
    if (Array.isArray(rows) && !rows.length) L.push('바뀌는 곳 없음');
    for (const r of (rows || [])) L.push(`· ${r.field}: ${r.before} → ${r.after}`);
    for (const x of (extra || [])) L.push(x);
    return L.join('\n');
}
// #733 미리보기 PNG — 블록 미리보기 HTML 을 폭 860 으로 찍는다(Playwright · 창구 PC) → 파일 경로
async function renderPng(html, name) { return require('./_preview.js').renderOne(html, name, { width: 860 }); }   // #736 공용 미리보기(scripts/desk/_preview.js · JPEG 70)
// ── #733 쿠팡 연결표(전체 가격 확인) — 묶음 열쇠는 price-check.js optionKey 와 같은 매칭기
const MAP_KEY = 'coupang_item_map';
async function mapCmd(o, rest, deps, R, out, oid) {
    const pool = deps.pool;
    const PC = require(path.join(__dirname, '..', '..', 'price-check.js'));
    const cur = await (async () => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [MAP_KEY]); const v = r.rows.length ? r.rows[0].value : null; return v && typeof v === 'object' ? v : {}; })();
    const save = async (map, orderId, what) => {
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [MAP_KEY, JSON.stringify(map)]);
        try { await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', 'coupang_item_map', $1, $2, 'desk', '클코(창구)')`, [orderId, JSON.stringify(what)]); } catch (e) { /* 기록 실패는 무시 */ }
    };
    const pricingNames = async () => { try { const today = new Date(deps.now() + 9 * 3600e3).toISOString().slice(0, 10); const r = await pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [today]); const set = new Set(); for (const x of r.rows) for (const it of (x.items || [])) if (it && it.name) set.add(it.name); return [...set]; } catch (e) { return []; } };
    const line = (vid, e) => `${vid} · ${e.product_name || ''}${e.item_name ? ' / ' + e.item_name : ''}${e.bot_product_id ? ' · 판매현황 #' + e.bot_product_id : ''}${e.label ? ' · 이름 「' + e.label + '」' : ''}${e.separate ? ' · 따로(안 견줌)' : ''}${e.ignore ? ' · 끔' : ''}`;
    if (o.mapSet) {
        const vid = String(rest[0] || '').replace(/\D/g, ''); if (!/^\d{1,15}$/.test(vid)) throw new Error('map --set <vendorItemId> <지시 id> 칸=값 …');
        const orderId = oid(rest[1]); const kv = rest.slice(2);
        if (!kv.length) throw new Error('바꿀 칸을 주세요: bot=<판매현황 id> · label=<단가표 이름> · separate=true|false · ignore=true|false · clear=true');
        const map = Object.assign({}, cur), e = Object.assign({}, map[vid] || {}), before = map[vid] || null;
        for (const x of kv) {
            const i = String(x).indexOf('='), k = i > 0 ? String(x).slice(0, i).trim() : '', v = i > 0 ? String(x).slice(i + 1).trim() : '';
            if (k === 'bot') { const n = parseInt(v, 10); if (!(n > 0)) throw new Error('bot=<판매현황 id 숫자>'); e.bot_product_id = n; }
            else if (k === 'label') { if (!v) delete e.label; else e.label = v.slice(0, 120); }
            else if (k === 'separate' || k === 'ignore') { if (!/^(true|false)$/.test(v)) throw new Error(k + '=true 또는 false'); if (v === 'true') e[k] = true; else delete e[k]; }
            else if (k === 'clear' && v === 'true') { delete e.bot_product_id; delete e.label; delete e.separate; delete e.ignore; }
            else throw new Error(`모르는 칸 「${x}」 — bot · label · separate · ignore · clear`);
        }
        map[vid] = e; await save(map, orderId, { vid, before, after: e });
        return out({ ok: true, vid, entry: e, card: '쿠팡 연결표 고침: ' + line(vid, e), note: '다음 「전체 가격 확인」(10분 캐시 뒤 · [다시 확인])부터 반영' });
    }
    if (o.suggest || o.mapApply) {
        const orderId = o.mapApply ? oid(rest.shift()) : null; const q = rest.join(' ').trim();
        const res = await R.send({ op: 'list', q: q || null });
        if (!res.ok) return out({ ok: false, error: res.error || '쿠팡 목록 실패', note: res.note || '바꾼 것 없음' });
        const names = await pricingNames(), rows = [];
        for (const p of (res.products || [])) for (const v of (p.vendorItems || [])) {
            const k = PC.optionKey([p.name, v.itemName].filter(Boolean), names), had = cur[String(v.vendorItemId)];
            const live = v.saleStatus === 'ON_SALE' && Number(v.quantity) > 0;   // #741 판매중지·재고 0 은 가격 확인에서 「쿠팡은 지금 안 팖」으로 잡음이 된다
            if (o.live && !live) continue;
            rows.push({ vid: String(v.vendorItemId), spid: String(p.sellerProductId), product_name: p.name || null, item_name: v.itemName || null, price: v.salePrice, live, sale: v.saleStatus || null, stock: v.quantity, matched: k.by === 'match', label: k.label, had: !!had, manual: !!(had && (had.bot_product_id || had.label || had.separate || had.ignore)) });
        }
        const T = rows.map(r => `${r.had ? '●' : '○'} ${r.vid} · ${r.product_name || ''} / ${r.item_name || ''} · ${won(r.price)}원 · ${r.live ? '판매중' : r.sale === 'STOP' ? '판매중지' : Number(r.stock) === 0 ? '재고 0' : '상태 모름'} → ${r.manual ? '손으로 정함(그대로)' : r.matched ? '짝 「' + r.label + '」' : '짝 못 찾음 — map --set ' + r.vid + ' <지시 id> bot=<판매현황 id> 또는 label=<단가표 이름>'}`);
        const nm = rows.filter(r => !r.matched && !r.manual).length;
        if (o.suggest) return out({ ok: true, count: rows.length, live: rows.filter(r => r.live).length, unmatched: nm, unmatched_live: rows.filter(r => r.live && !r.matched && !r.manual).length, truncated: !!res.truncated, table: T.join('\n') || '(쿠팡 옵션 없음)', note: `● = 이미 연결표에 있음 · 제안대로 넣기 = map --apply <지시 id>${q ? ' ' + q : ''}${res.truncated ? ' · 목록이 잘렸어요(검색어로 나눠서)' : ''}` });
        const map = Object.assign({}, cur); let added = 0;
        for (const r of rows) { const e = Object.assign({}, map[r.vid] || {}); if (!map[r.vid]) added++; e.seller_product_id = r.spid; e.product_name = r.product_name; e.item_name = r.item_name; map[r.vid] = e; }
        await save(map, orderId, { applied: rows.length, added, q: q || null });
        return out({ ok: true, applied: rows.length, added, unmatched: nm, table: T.join('\n'), card: `쿠팡 연결표에 옵션 ${rows.length}개(새로 ${added}) — 짝 못 찾음 ${nm}개는 「전체 가격 확인」에 「쿠팡 짝 없음」으로 보여요(map --set 으로 지정)`, note: '다음 「전체 가격 확인」([다시 확인])부터 쿠팡 줄이 보여요' });
    }
    const ents = Object.entries(cur).filter(([k]) => /^\d{1,15}$/.test(k));
    return out({ ok: true, count: ents.length, table: ents.map(([k, e]) => line(k, e)).join('\n') || '(비어 있음 — map --suggest 로 제안 보기)', note: ents.length ? '고치기 = map --set <vendorItemId> <지시 id> 칸=값' : '처음이면 map --suggest → map --apply <지시 id>' });
}
function failFull(res) {
    const e = String((res && res.error) || '');
    if (res && res.note) return res.note + ' — 다시 보내지 말고 기다렸다가';
    if (/보관한 뒤 쿠팡에서 바뀐/.test(e)) return '보관한 뒤 쿠팡에서 상품이 또 바뀌었어요 — full 로 다시 보관한 뒤 plan-full 부터';
    if (/또 바뀌었어요/.test(e)) return '적용한 뒤 쿠팡에서 또 바뀌었어요 — 지금 모습을 요청자에게 보여 주고(되묻기 1회) 「그래도 되돌려」면 --force';
    if (/새 그림 주소/.test(e)) return '새 그림은 창구에서 못 넣어요 — 윙에서';
    if (/글 한 칸/.test(e)) return '상세 구성이 글 한 칸이 아니라 창구에서 못 바꿔요 — 윙에서';
    if (/진행 중/.test(e)) return '같은 상품에 다른 작업이 진행 중이에요 — 1분 뒤 다시';
    return '바꾸지 못했어요 — 위 error 그대로 전하기 · 다시 보내기 전에 full 로 지금 모습 확인';
}

// ── 요청 줄 → 결과 (한 칸 · 다른 작업이 걸려 있으면 멈춤)
function makeRunner(deps) {
    const { pool, sleep, now } = deps;
    const cfgGet = async k => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [k]); return r.rows.length ? r.rows[0].value : null; };
    async function send(req, ms = 150000) {
        if (await cfgGet(REQ_KEY)) throw new Error('다른 쿠팡 상품 요청이 아직 처리 중이에요 — 1분 뒤 다시');
        await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]);
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [REQ_KEY, JSON.stringify(req)]);
        const t0 = now();
        while (now() - t0 < ms) {
            await sleep(5000);
            const v = await cfgGet(RES_KEY);
            if (v && (v.order_id == null || String(v.order_id) === String(req.order_id)) && (!v.op || v.op === req.op)) { await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]); return v; }
        }
        throw new Error('쿠팡 상품 러너 응답 없음(2분 30초) — 실서버가 깨어 있는지 확인해 주세요(요청 줄은 서버가 깨면 그대로 실행돼요 — 다시 보내지 말고 총괄에게)');
    }
    async function orderBy(orderId) {
        const o = (await pool.query(`SELECT id, created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
        if (!o) throw new Error('없는 지시입니다: ' + orderId);
        return '클코(창구) · ' + (o.created_by || '요청자 미상');
    }
    async function backupRow(arg) {
        const id = parseInt(String(arg || '').replace(/\D/g, ''), 10);
        if (!(id > 0)) throw new Error('backup_id 가 필요해요(show 결과)');
        const r = (await pool.query(`SELECT id, kind, seller_product_id, vendor_item_id, order_id, before_json, patch_json, applied_at, reverted_at, result_json FROM coupang_item_backups WHERE id = $1`, [id])).rows[0];
        if (!r) throw new Error(`보관본 ${id} 를 못 찾았어요 — 먼저 show`);
        const j = v => typeof v === 'string' ? JSON.parse(v) : v;
        return Object.assign(r, { before_json: j(r.before_json), patch_json: j(r.patch_json), result_json: j(r.result_json) });
    }
    async function naverDetail(pno) {   // #733 네이버 상세 = naver-detail show 가 보관한 최신 상품(쓰기 0)
        const r = (await pool.query(`SELECT id, created_at, before_json FROM naver_product_backups WHERE product_no = $1 AND COALESCE(result_json->>'op', '') <> 'create_failed' ORDER BY id DESC LIMIT 1`, [pno])).rows[0];
        if (!r) return null;
        const j = typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json;
        const html = ((j || {}).originProduct || {}).detailContent;
        return html ? { id: r.id, at: r.created_at, html } : null;
    }
    async function writeCfg() { try { const v = await cfgGet('coupang_item_write'); return (v && typeof v === 'object') ? v : {}; } catch (_) { return {}; } }
    return { send, orderBy, backupRow, naverDetail, writeCfg };
}

// 실패 결과 → 사람 말
function failNote(res) {
    const e = String((res && res.error) || '');
    if (res && res.note) return res.note + ' — 다시 보내지 말고 기다렸다가';   // 429 = 서버 고정 글
    if (res && res.resume_note) return res.resume_note + '(판매자콜센터)';
    if (/보관한 뒤 쿠팡에서 바뀐/.test(e)) return '보관한 뒤 쿠팡에서 값이 또 바뀌었어요 — show 로 다시 보관한 뒤 plan 부터';
    if (/적용 뒤 그 칸이 또 바뀌었어요/.test(e)) return '적용한 뒤 쿠팡에서 그 칸이 또 바뀌었어요 — 지금 값(now)을 요청자에게 보여 주고(되묻기 1회) 「그래도 되돌려」면 --force';
    if (/진행 중/.test(e)) return '같은 옵션에 다른 작업이 진행 중이에요 — 1분 뒤 다시';
    if (/윙에서/.test(e)) return '쿠팡 기본 제한 밖 — 「쿠팡 윙에서 직접」으로 답하기';
    return '바꾸지 못했어요 — 위 error 그대로 전하기 · 다시 보내기 전에 show 로 지금 값 확인';
}

async function main(argv, deps) {
    const out = deps.out || (o => console.log(JSON.stringify(o, null, 1)));
    const R = makeRunner(deps);
    const cmd = argv[0], { o, rest } = parseOpts(argv.slice(1));
    const oid = n => { const v = parseInt(n, 10); if (!(v > 0)) throw new Error('지시 id 가 필요해요(누가 시켰는지 기록)'); return v; };
    const num = (v, what) => { const s = String(v || '').replace(/\D/g, ''); if (!/^\d{1,15}$/.test(s)) throw new Error(what + '를 주세요(list 의 숫자)'); return s; };

    if (cmd === 'list') {
        const q = rest.join(' ').trim();
        const res = await R.send({ op: 'list', q: q || null });
        if (!res.ok) return out({ ok: false, error: res.error || '목록 실패', code: res.code || null, note: res.note || '바꾼 것 없음' });
        const lines = [];
        for (const p of (res.products || [])) {
            lines.push(`[상품 ${p.sellerProductId}] ${p.name || '(이름 없음)'}${p.status ? ' · ' + p.status : ''}`);
            for (const v of (p.vendorItems || [])) { const n = norm(v); lines.push(`  ${v.vendorItemId} · ${n.item_name || ''} · ${won(n.price)}원 · 재고 ${won(n.stock)} · ${saleKo(n.on_sale)}`); }
            if (!(p.vendorItems || []).length) lines.push('  (판매 옵션 번호 없음 — 승인 전이거나 조회 실패)');
        }
        return out({ ok: true, q: q || null, products: res.products || [], truncated: !!res.truncated, table: lines.join('\n') || '(맞는 상품 없음)',
            note: (res.products || []).length ? `바꿀 옵션은 vendorItemId 로 고르기(이름으로 짐작 금지 · 비슷하면 표를 보여 주고 되묻기) · 다음 = show <vendorItemId> <상품 번호> <지시 id>${res.truncated ? ' · 목록이 잘렸어요(상품 30 · 옵션 80) — 검색어를 좁혀 다시' : ''}` : '검색어를 바꿔 다시 · 쿠팡 윙의 상품 이름 글자로' });
    }
    if (cmd === 'show') {
        if (rest.length < 3) throw new Error('show <vendorItemId> <상품 번호(sellerProductId)> <지시 id> — 셋 다 주세요(번호는 list 로)');
        const vid = num(rest[0], 'vendorItemId '), spid = num(rest[1], '상품 번호(sellerProductId)'), orderId = oid(rest[2]);
        const res = await R.send({ op: 'backup', order_id: orderId, vendor_item_id: vid, seller_product_id: spid, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '보관 실패', code: res.code || null, note: res.note || '바꾼 것 없음' });
        const n = norm(res.before);
        return out({ ok: true, backup_id: res.backup_id, now: n,
            card: card('지금 값', n, vid, null, [`판매가 ${won(n.price)}원 · 재고 ${won(n.stock)} · ${saleKo(n.on_sale)}`, saleLine('건들기 전', res.sale_ok || saleOkSelf(n))]),
            note: `다음 = plan ${res.backup_id} --price <원> | --stock <수> | --stop | --resume(한 칸씩)` });
    }
    const itemRow = async a => { const row = await R.backupRow(a); if (row.kind === 'product') throw new Error(`보관본 ${row.id} 는 상품 통째 보관본이에요 — plan-full · apply-full · revert-full 로`); return row; };
    const prodRow = async a => { const row = await R.backupRow(a); if (row.kind !== 'product' || /^create/.test(String((row.result_json || {}).op || ''))) throw new Error(`보관본 ${row.id} 는 full 로 만든 상품 보관본이 아니에요 — full <상품 번호> <지시 id> 부터`); return row; };
    if (cmd === 'plan' || cmd === 'apply') {
        const row = await itemRow(rest[0]);
        if (row.applied_at) throw new Error(`보관본 ${row.id} 는 이미 적용했어요 — 새로 고치려면 show 부터`);
        if (row.reverted_at) throw new Error(`보관본 ${row.id} 는 되돌린 것이에요 — show 부터`);
        const P = planRows(row.before_json, o);
        if (P.errs.length) throw new Error(P.errs.join(' · '));
        if (P.stops.length) return out({ ok: false, stopped: true, stops: P.stops, can_apply: false, note: '보낸 것 없음 — 멈춘 문구 그대로 전하고 되묻기' });
        const s0 = saleOkSelf(P.n);
        if (cmd === 'plan') return out({ ok: true, backup_id: row.id, patch: P.patch, warnings: P.warns, can_apply: true,
            card: card('고치기 계획(아직 안 보냄)', P.n, row.vendor_item_id, P.rows, P.warns.map(w => '⚠ ' + w).concat([saleLine('건들기 전', s0), '이대로 바꿀까요?'])),
            next: `apply ${row.id} <지시 id> ` + argv.slice(2).join(' ') });
        const orderId = oid(rest[1]);
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 10:30 뒤에 같은 명령으로', note: '보낸 것 없음' });
        const res = await R.send({ op: 'apply', order_id: orderId, backup_id: row.id, vendor_item_id: row.vendor_item_id, patch: P.patch, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '쿠팡 반영 실패', code: res.code || null, coupang_message: res.coupang_message || undefined, drift: res.drift || undefined, now: res.now || undefined, note: failNote(res) });
        const before = res.before || row.before_json, after = res.after || null;
        const exp = expectBad(P.patch), unexpected = res.unexpected || [], notApplied = res.not_applied || [];
        const sb = res.sale_ok_before || saleOkSelf(norm(before)), sa = res.sale_ok || null;
        const lost = sb.ok && sa && (sa.bad || []).some(x => !exp.includes(x));   // 팔리던 옵션이 안 팔리게 됨
        const red = unexpected.length || notApplied.length || lost || !after;
        const extra = [];
        if (unexpected.length) extra.push(`🔴 예상 밖으로 바뀐 칸: ${unexpected.map(k => KEY_KO[k] || k).join(' · ')} — 되돌리기를 권합니다`);
        if (notApplied.length) extra.push(`🔴 다시 읽어 봐도 아직 안 바뀐 칸: ${notApplied.map(k => KEY_KO[k] || k).join(' · ')} — 몇 분 뒤 show 로 다시 확인(다시 보내지 않기)`);
        if (!after) extra.push('⚠ ' + (res.error_note || '바꾸기는 됐지만 다시 읽기 실패 — 쿠팡 윙에서 확인'));
        extra.push(saleLine('건들기 전', sb), saleLine('건든 뒤', sa, exp));
        extra.push(`되돌리기: revert ${row.id} <지시 id>`);
        return out({ ok: true, backup_id: row.id, changed: res.changed || [], unexpected, not_applied: notApplied,
            card: card(red ? '고치기 결과 — 🔴 확인 필요' : '고치기 결과', Object.assign(norm(before), { item_name: res.item_name || norm(row.before_json).item_name, product_name: norm(row.before_json).product_name }), row.vendor_item_id, after ? resultRows(before, after) : P.rows, extra),
            note: red ? '🔴·⚠ 줄을 답 맨 위에 · 되돌리기 권하기' : '카드 그대로 전하기(전/후 + 판매 정상 두 줄)' });
    }
    if (cmd === 'revert') {
        const row = await itemRow(rest[0]);
        const orderId = oid(rest[1]);
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 급하면 총괄에게', note: '보낸 것 없음' });
        const res = await R.send({ op: 'revert', order_id: orderId, backup_id: row.id, vendor_item_id: row.vendor_item_id, force: o.force === true, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '되돌리기 실패', code: res.code || null, coupang_message: res.coupang_message || undefined, now: res.now || undefined, note: failNote(res) });
        const nb = norm(row.before_json);
        const extra = [];
        if (res.put === false) extra.push('이미 보관한 값이라 쿠팡에 보낸 것 없음');
        if ((res.unexpected || []).length) extra.push(`🔴 예상 밖으로 바뀐 칸: ${res.unexpected.map(k => KEY_KO[k] || k).join(' · ')}`);
        if (res.same_as_before === false) extra.push('🔴 다시 읽어 봐도 보관한 값이 아니에요 — 몇 분 뒤 show 로 확인');
        if (res.error_note) extra.push('⚠ ' + res.error_note);
        extra.push(saleLine('되돌린 뒤', res.sale_ok || null));
        const from = res.before_put || null, to = res.now || null;
        return out({ ok: true, backup_id: row.id, put: res.put, same_as_before: res.same_as_before,
            card: card('되돌리기 결과', nb, row.vendor_item_id, from && to ? resultRows(from, to) : null, extra),
            note: '보관한 값으로 되돌렸어요 — 카드 그대로' });
    }
    // ── #729 2차(상품 단위)
    if (cmd === 'full') {
        const spid = num(rest[0], '상품 번호(sellerProductId)'), orderId = oid(rest[1]);
        const res = await R.send({ op: 'get_full', order_id: orderId, seller_product_id: spid, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '보관 실패', code: res.code || null, note: res.note || '바꾼 것 없음' });
        const sm = res.summary || {};
        const L = [`상품명: ${sm.name || '(없음)'}${sm.display_name && sm.display_name !== sm.name ? ' · 노출 상품명 ' + sm.display_name : ''}`, `승인 상태: ${sm.status || '(모름)'}${res.saved ? ' — 임시저장(손님 노출 0 · 고쳐도 저장만)' : ' — 고치면 쿠팡 승인 심사(승인 전까지 손님 화면은 옛 모습)'}`];
        for (const it of (sm.items || [])) L.push(`· 옵션 ${it.vendorItemId || '(번호 없음 · 승인 전)'} · ${it.itemName || ''} · ${won(it.salePrice)}원 · 재고 ${won(it.stock)} · 그림 ${it.images}장 · 상세 ${it.contents || '없음'}${it.contents === 'TEXT:TEXT' ? '(글 한 칸 = 창구에서 바꿀 수 있음)' : '(글 한 칸이 아니라 상세는 윙에서)'}`);
        return out({ ok: true, backup_id: res.backup_id, saved: !!res.saved, summary: sm, card: L.join('\n'),
            note: `다음 = plan-full ${res.backup_id} --name … | --item-name <vendorItemId>=… | --detail <html 파일>` });
    }
    if (cmd === 'plan-full' || cmd === 'apply-full') {
        const row = await prodRow(rest[0]);
        if (row.applied_at) throw new Error(`보관본 ${row.id} 는 이미 적용했어요 — 새로 고치려면 full 부터`);
        let src = null;
        if (o.fromNaver != null) {   // #733 네이버 상세 → 블록
            const pno = String(o.fromNaver).replace(/\D/g, '');
            if (!/^\d{6,}$/.test(pno)) throw new Error('--detail-from-naver <네이버 상품번호>(스마트스토어 상품 주소 끝 숫자)');
            src = await R.naverDetail(pno);
            if (!src) throw new Error(`네이버 ${pno} 상세 보관본이 없어요 — 먼저 node scripts/desk/naver-detail.js show ${pno} <지시 id>`);
            const DB = require(path.join(__dirname, '..', '..', 'detail-blocks.js'));
            const r = DB.fromNaverHtml(src.html);
            o.blocks = r.blocks; o.blocksSummary = DB.summarize(r.blocks); o.blocksDropped = r.dropped;
            o.previewHtml = DB.toPreviewHtml(r.blocks);
        }
        const P = planFull(row.before_json, o, deps.readFile || (p => fs.readFileSync(p, 'utf8')));
        if (P.errs.length) return out({ ok: false, stopped: true, stops: P.errs, can_apply: false, note: '보낸 것 없음 — 멈춘 문구 그대로 전하고 되묻기' });
        const saved = isSavedJ(row.before_json);
        const xw = [];   // #733 덧붙는 안내
        if (P.patch.detail_blocks) {
            const ageH = src && src.at ? Math.round((deps.now() - new Date(src.at).getTime()) / 3600000) : null;
            xw.push(`네이버 상세 보관본 #${src.id}${ageH != null ? `(${ageH}시간 전)` : ''} 기준 — 그 뒤 네이버 상세를 고쳤으면 naver-detail show 로 다시 보관`);
            const ext = P.patch.detail_blocks.some(b => b.type === 'image' && !/^(vendor_inventory\/|https:\/\/[\w.-]*coupangcdn\.com\/)/.test(b.url));
            if (ext && (await R.writeCfg()).allow_external_images !== true) xw.push('🔴 그림이 네이버 주소라 쿠팡 밖 주소예요 — 설정 coupang_item_write.allow_external_images 가 꺼져 있어 서버가 거절해요(총괄에게 · 켜면 쿠팡이 받아 저장)');
            else if (ext) xw.push('그림은 네이버 주소 그대로 보내요 — 쿠팡이 받아 쿠팡 그림 저장소로 옮겨요(결과 카드 items_after 로 확인)');
            if (o.blocksDropped) xw.push(`주소 없는 그림 ${o.blocksDropped}개는 뺐어요`);
        }
        if (P.patch.items_add) xw.push('새 옵션의 쿠팡 옵션 번호(vendorItemId)는 승인 뒤에 생겨요 — 그 뒤 가격·재고는 1차(plan --price/--stock)로');
        const tail = saved ? ['임시저장 상품 — 저장만(승인 요청 안 함 · 손님 노출 0)'] : ['🟡 승인된 상품이라 쿠팡 승인 심사를 거쳐요 — 승인 전까지 손님 화면은 옛 모습 · 승인되면 반영 · 반려면 사유(며칠 걸릴 수 있음)'];
        const pname = row.before_json.sellerProductName || '';
        if (cmd === 'plan-full') {
            let png = null, pngErr = null;
            if (P.patch.detail_blocks && o.previewHtml) { try { png = await (deps.renderPng || renderPng)(o.previewHtml, `coupang-preview-${row.id}`); } catch (e) { pngErr = String(e && e.message || e).slice(0, 120); } }
            const blocked = xw.some(w => w.startsWith('🔴'));
            return out({ ok: true, backup_id: row.id, patch: P.patch.detail_blocks ? Object.assign({}, P.patch, { detail_blocks: `(블록 ${P.patch.detail_blocks.length}개)` }) : P.patch, can_apply: !blocked,
                preview_png: png || undefined, preview_error: pngErr || undefined,
                card: pcard('고치기 계획(아직 안 보냄)', pname, row.seller_product_id, P.rows, xw.map(w => w.startsWith('🔴') ? w : '⚠ ' + w).concat(tail, [png ? '미리보기 그림을 붙였어요 — 쿠팡 손님 화면도 이 순서' : '', '이대로 바꿀까요?'].filter(Boolean))),
                note: png ? '미리보기 PNG(preview_png)를 respond attachments 로 붙여 카드와 함께 되묻기' : (pngErr ? '미리보기 그림을 못 만들었어요(' + pngErr + ') — 카드로만 되묻기' : '카드 그대로 되묻기'),
                next: `apply-full ${row.id} <지시 id> ` + argv.slice(2).join(' ') });
        }
        if (xw.some(w => w.startsWith('🔴'))) return out({ ok: false, stopped: true, stops: xw.filter(w => w.startsWith('🔴')), note: '보낸 것 없음' });
        const orderId = oid(rest[1]);
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 10:30 뒤에 같은 명령으로', note: '보낸 것 없음' });
        const res = await R.send({ op: 'update_full', order_id: orderId, backup_id: row.id, patch: P.patch, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '쿠팡 상품 수정 실패', code: res.code || null, coupang_message: res.coupang_message || undefined, note: failFull(res) });
        const L = [];
        if (res.saved) L.push('임시저장 상품 — 저장했어요(승인 요청 안 함 · 손님 노출 0 · 조회는 약 10분 뒤)');
        else L.push('🟡 쿠팡 승인 대기 — 승인 전까지 손님 화면은 옛 모습 · 승인되면 반영 · 반려면 사유', `지금 승인 상태: ${res.status_after || '(모름 — approval ' + row.seller_product_id + ' 로 확인)'}`, `확인: approval ${row.seller_product_id}`);
        if (res.error_note) L.push('⚠ ' + res.error_note);
        if (res.items_add_note) L.push(res.items_add_note);
        if (Array.isArray(res.items_after) && P.patch.detail_blocks) { const imgs = res.items_after.flatMap(it => it.content_images || []); const ext = imgs.filter(u => !/coupangcdn|vendor_inventory/.test(String(u))).length; L.push(`다시 읽은 상세 그림(앞 몇 장): 쿠팡 저장소 ${imgs.length - ext} · 아직 바깥 주소 ${ext}${ext ? '(승인 대기 중엔 옛 값일 수 있음 — approval 뒤 full 로 다시 보기)' : ''}`); }
        L.push(`되돌리기: revert-full ${row.id} <지시 id>(이것도 승인행${P.patch.items_add && !res.saved ? ' · 승인된 상품의 새 옵션은 못 지움 → 윙에서 그 옵션 판매중지' : ''})`);
        return out({ ok: true, backup_id: row.id, saved: !!res.saved, status_after: res.status_after || null,
            card: pcard(res.saved ? '고치기 결과(임시저장)' : '고치기 결과 — 🟡 쿠팡 승인 대기', pname, row.seller_product_id, P.rows, L),
            note: res.saved ? '카드 그대로' : '「반영 완료」라고 쓰지 않는다 — 「쿠팡 승인 대기(승인되면 반영 · 며칠 걸릴 수 있음)」로 답하고 approval 로 뒤에 확인' });
    }
    if (cmd === 'revert-full') {
        const row = await prodRow(rest[0]);
        const orderId = oid(rest[1]);
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 급하면 총괄에게', note: '보낸 것 없음' });
        const res = await R.send({ op: 'revert_full', order_id: orderId, backup_id: row.id, force: o.force === true, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '되돌리기 실패', code: res.code || null, coupang_message: res.coupang_message || undefined, note: failFull(res) });
        const L = [res.saved ? '임시저장 상품 — 보관본으로 다시 저장했어요(손님 노출 0)' : '🟡 보관본으로 다시 저장 — 이것도 쿠팡 승인 대기(승인되면 옛 모습으로)'];
        if (res.error_note) L.push('⚠ ' + res.error_note);
        return out({ ok: true, backup_id: row.id, saved: !!res.saved, status_after: res.status_after || null, card: pcard('되돌리기 결과', row.before_json.sellerProductName || '', row.seller_product_id, null, L), note: '카드 그대로' });
    }
    if (cmd === 'approval') {
        const spid = num(rest[0], '상품 번호(sellerProductId)');
        const res = await R.send({ op: 'approval', seller_product_id: spid });
        if (!res.ok) return out({ ok: false, error: res.error || '승인 상태 조회 실패', code: res.code || null, note: res.note || '바꾼 것 없음' });
        const L = [`상품: ${res.name || '(이름 모름)'} (${spid})`, `승인 상태: ${res.status || '(모름)'}${res.saved ? '(임시저장 · 손님 노출 0)' : ''}`];
        if (res.denied) L.push(`🔴 승인 반려 — 사유: ${res.deny_reason || '(이력에 사유 없음 — 윙에서 확인)'}`);
        for (const h of (res.histories || []).slice(0, 5)) L.push(`· ${h.at || ''} ${h.status || ''}${h.comment ? ' — ' + h.comment : ''}`);
        if (res.hist_error) L.push('⚠ 이력은 못 읽었어요(윙에서 확인)');
        return out({ ok: true, status: res.status, denied: !!res.denied, deny_reason: res.deny_reason || null, card: L.join('\n'),
            note: res.denied ? '반려 사유를 그대로 전하고 고칠지 되묻기' : '상태 그대로 전하기' });
    }
    if (cmd === 'create-saved') {
        const orderId = oid(rest[0]);
        const from = num(o.from, '--from 본뜰 상품 번호'), name = String(o.name || '').trim();
        if (!name) throw new Error('--name "<새 상품명>" 을 주세요');
        if (name.length > 100) throw new Error('상품명은 100자까지예요');
        const I = parseItems(o.item);
        if (I.errs.length) throw new Error(I.errs.join(' · '));
        const req = { op: 'create_saved', order_id: orderId, from_seller_product_id: from, name };
        if (I.items.length) req.items = I.items;
        const L = [`본뜰 상품: ${from}(배송·반품·고시·속성·상세·그림을 그대로 복사)`, `새 이름: ${name}`];
        if (I.items.length) for (const x of I.items) L.push(`옵션: ${x.itemName} · ${won(x.price)}원 · 재고 ${won(x.stock != null ? x.stock : 99999)}`);
        else L.push('옵션: 본뜬 상품 옵션 그대로');
        L.push('임시저장(손님 노출 0 · 승인 요청 안 함) — 실제 판매는 윙에서 승인 요청');
        if (o.dry) return out({ ok: true, dry: true, request: req, card: pcard('임시저장 등록 계획(아직 안 보냄)', name, '새 번호는 등록 뒤', null, L.concat(['이대로 등록할까요?'])), note: '미리 보기 — 보낸 것 없음' });
        const res = await R.send(Object.assign(req, { created_by: await R.orderBy(orderId) }), 240000);
        if (!res.ok) return out({ ok: false, error: res.error || '등록 실패', code: res.code || null, coupang_message: res.coupang_message || undefined,
            note: res.unknown_note ? '🔴 ' + res.unknown_note + ' — 다시 보내지 말고 총괄에게' : /24시간/.test(String(res.error || '')) ? '오늘 등록 상한(24시간 3개)이에요 — 내일 다시' : (res.note || '등록 안 됨 — 위 error 그대로 · 총괄에게') });
        const R2 = [`새 상품 번호: ${res.seller_product_id || '(응답에 없음)'} · 본뜬 상품 ${res.from_seller_product_id || from}`, `이름: ${name}`];
        for (const x of (res.items || [])) R2.push(`옵션: ${x.itemName} · ${won(x.salePrice)}원 · 재고 ${won(x.stock)}`);
        R2.push('임시저장(손님 노출 0) — 실제 판매는 윙에서 승인 요청 · 조회는 약 10분 뒤');
        if (res.error_note) R2.push('⚠ ' + res.error_note);
        if (res.seller_product_id) R2.push(`지우기: delete-saved ${res.seller_product_id} <지시 id>`);
        return out({ ok: true, seller_product_id: res.seller_product_id || null, card: pcard(res.error_note ? '임시저장 등록 결과 — 🔴 확인 필요' : '임시저장 등록 결과', name, res.seller_product_id || '?', null, R2), note: '새 번호와 카드 그대로' });
    }
    if (cmd === 'delete-saved') {
        const spid = num(rest[0], '상품 번호(sellerProductId)'), orderId = oid(rest[1]);
        const res = await R.send({ op: 'delete_saved', order_id: orderId, seller_product_id: spid, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '삭제 실패', code: res.code || null, status: res.status || undefined, note: /임시저장 상품만/.test(String(res.error || '')) ? '임시저장이 아닌 상품은 창구에서 못 지워요 — 윙에서' : (res.note || '지우지 못했어요 — 위 error 그대로') });
        return out({ ok: true, deleted: true, card: pcard('임시저장 삭제 결과', res.name || '', spid, null, ['지웠어요(임시저장 상품 · 손님 노출 없던 것)']), note: '카드 그대로' });
    }
    if (cmd === 'map') return mapCmd(o, rest, deps, R, out, oid);
    throw new Error('명령: list · show · plan · apply · revert · full · plan-full · apply-full · revert-full · approval · create-saved · delete-saved · map');
}

module.exports = { main, makeRunner, parseOpts, planRows, norm, saleOkSelf, saleLine, expectBad, resultRows, card, busyWindow, failNote, planFull, parseItems, pcard, failFull, renderPng, REQ_KEY, RES_KEY };

if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; })
        .finally(() => pool.end().catch(() => { }));
}

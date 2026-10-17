// #720 창구용 — 네이버 상품 상세 문구·그림 · 판매 상태 고치기(1차 · 대표 확정 10/17) + #721 2차 = 옵션명·옵션 추가금·옵션 재고·판매 여부·판매가·상품명
//   node scripts/desk/naver-detail.js show <상품번호> <지시 id>                  상품 통째 보관(backup) → 요약 + 옵션 표 + 지금 상세 HTML 을 임시 파일로(경로 출력)
//   node scripts/desk/naver-detail.js plan <backup_id|상품번호> --detail <html> | --status <값>
//                                       | --opt <옵션 id> name1=…|price=…|stock=…|usable=… (옵션마다 한 번씩) | --sale-price <원> | --name "<글>"
//                                                                              바뀌는 곳만 전/후 표 + 카드 글(보내지 않음 · 쓰기 0)
//   node scripts/desk/naver-detail.js apply <backup_id> <지시 id> (plan 과 같은 인자)   실행 → 서버가 재조회해 바뀐 경로 대조 → 결과 카드
//   node scripts/desk/naver-detail.js revert <backup_id> <지시 id> [--force]   보관해 둔 전체로 되돌림(적용 뒤 또 바뀐 곳이 있으면 멈춤 · 그래도 덮는 --force 는 관리자 계정 지시만)
//   node scripts/desk/naver-detail.js upload <지시 id> [지시 id …]              지시에 붙은 그림을 네이버에 올려 주소 목록(상세 HTML 에는 이 주소만)
//   node scripts/desk/naver-detail.js create <지시 id> --from <본뜰 상품번호> --name "<새 이름>" [--opt-name1 "<이름1>[|<이름2>[|<이름3>]]=<추가금>" …] [--price <판매가>] [--stock <재고>] [--dry]
//                                                                              #723 신규 등록(3차) — 기본 손님에게 안 보임(판매중지·전시중지·쇼핑 미노출) · 재고 기본 99999 · --dry = 카드만(보내지 않음)
//   길 = 요청 줄 agent_office_config 'naver_product_write_request' → 실서버 20초 틱 → 'naver_product_write_result'(계약 docs/720-write-contract.md).
//        이 도구는 토큰도 네이버 주소도 모른다 — 요청 줄 INSERT 와 결과 읽기, 보관본(naver_product_backups) 읽기뿐.
//   🔴 평일 08:30~10:30(발송 직전)엔 apply·revert 를 하지 않는다(plan 은 됨). 밖 = 옵션 추가·옵션 그룹(3차)·신규 등록·즉시할인·대표 이미지 · 상세는 서버 잠금(#720-D).
//   전/후 카드 끝 두 줄 고정 = 「건들기 전 판매 정상 ✓/⚠」(보관본) · 「건든 뒤 판매 정상 ✓/⚠」(서버 재조회 sale_ok · 계약 4절 #721-B 1·3)
const path = require('path'), fs = require('fs'), os = require('os');

const REQ_KEY = 'naver_product_write_request', RES_KEY = 'naver_product_write_result';
const TMP = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'naver-detail');
const STATUS_KO = { SALE: '판매중', SUSPENSION: '판매중지', OUTOFSTOCK: '품절' };
// 서버(#720-B NPW_STATUS_MOVES · #721-B3)와 같은 전이표 — 사람이 바꾸는 판매 상태만 · 품절 → 판매중은 (보관본 + 넣을 재고) 합이 있을 때만
const STATUS_MOVES = { SALE: ['OUTOFSTOCK', 'SUSPENSION'], OUTOFSTOCK: ['SALE'], SUSPENSION: ['SALE'], WAIT: ['SUSPENSION'] };   // WAIT = create 뒤 판매중지 전환이 실패한 새 상품(#723)
const OPT_MAX = 20, NAME_MAX = 100;   // 서버 상한과 같게(계약 #721-B 3)
const OPT_KEYS = ['name1', 'name2', 'name3', 'price', 'stock', 'usable'];
const BAD_KO = { status: '판매 상태', options_usable: '판매 안 함 옵션', stock: '재고 0', sale_price: '판매가', option_price: '옵션 추가금', detail: '상세', rep_image: '대표 그림' };
const STATUS_IN = { '판매중': 'SALE', '판매': 'SALE', 'sale': 'SALE', '판매중지': 'SUSPENSION', '중지': 'SUSPENSION', 'suspension': 'SUSPENSION', '품절': 'OUTOFSTOCK', 'outofstock': 'OUTOFSTOCK' };
const won = n => n == null ? '(없음)' : Number(n).toLocaleString('ko-KR');
const stKo = s => s == null ? '(없음)' : (STATUS_KO[s] ? `${STATUS_KO[s]}(${s})` : String(s));

// ── 시각(KST) · 발송 직전 막기
function kstParts(now) { const d = new Date(now + 9 * 3600000); return { dow: d.getUTCDay(), hm: d.getUTCHours() * 60 + d.getUTCMinutes(), text: d.toISOString().replace('T', ' ').slice(0, 16) }; }
function busyWindow(now) { const k = kstParts(now); return k.dow >= 1 && k.dow <= 5 && k.hm >= 8 * 60 + 30 && k.hm < 10 * 60 + 30; }

// ── 인자
function parseOpts(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--detail' || a === '--status' || a === '--stock' || a === '--name') o[a.slice(2)] = args[++i];
        else if (a === '--sale-price') o.sale_price = args[++i];
        else if (a === '--from' || a === '--price') o[a.slice(2)] = args[++i];
        else if (a === '--opt-name1') (o.newOpt = o.newOpt || []).push(args[++i]);
        else if (a === '--dry') o.dry = true;
        else if (a === '--opt') {   // --opt <id> k=v k=v … (다음 -- 까지)
            const one = { id: args[++i], kv: [] };
            while (i + 1 < args.length && !/^--/.test(args[i + 1])) one.kv.push(args[++i]);
            (o.opt = o.opt || []).push(one);
        }
        else if (a === '--force') o.force = true;
        else rest.push(a);
    }
    return { o, rest };
}
const toInt = v => { const n = Number(String(v == null ? '' : v).replace(/[,원\s]/g, '')); return Number.isInteger(n) ? n : null; };
// --opt 목록 → patch.options [{ id, name1?, …, stock?, usable? }]
function parseOptArgs(list) {
    const opts = [], errs = [], seen = new Set();
    for (const a of (list || [])) {
        const id = String(a.id == null ? '' : a.id).replace(/\D/g, '');
        if (!id) { errs.push('--opt 뒤에 옵션 id 를 주세요(show 의 옵션 표)'); continue; }
        if (seen.has(id)) { errs.push(`옵션 ${id} 를 두 번 줬어요 — 한 --opt 에 모아 주세요`); continue; }
        seen.add(id);
        const one = { id: Number(id) }, e0 = errs.length;
        for (const kv of a.kv) {
            const m = /^([a-z0-9]+)=([\s\S]*)$/i.exec(kv), k = m && m[1].toLowerCase();
            if (!m || !OPT_KEYS.includes(k)) { errs.push(`옵션 ${id}: 「${kv}」 — 칸은 name1·name2·name3·price·stock·usable 중 하나예요`); continue; }
            const v = m[2].trim();
            if (k === 'price' || k === 'stock') { const n = toInt(v); if (n == null) errs.push(`옵션 ${id}: ${k} 는 정수예요(「${v}」)`); else one[k] = n; }
            else if (k === 'usable') { const b = /^(true|1|판매|판매함|켬|on)$/i.test(v) ? true : /^(false|0|안함|판매안함|끔|off)$/i.test(v) ? false : null; if (b == null) errs.push(`옵션 ${id}: usable 은 true(판매함)·false(안 함)예요`); else one.usable = b; }
            else if (!v) errs.push(`옵션 ${id}: ${k} 가 비었어요`); else one[k] = v;
        }
        if (Object.keys(one).length === 1 && errs.length === e0) errs.push(`옵션 ${id}: 바꿀 칸이 없어요(name1=… · price=… · stock=… · usable=…)`);
        opts.push(one);
    }
    if (opts.length > OPT_MAX) errs.push(`옵션은 한 번에 ${OPT_MAX}개까지예요(${opts.length}개)`);
    return { opts, errs };
}
function buildPatch(o) {
    const patch = {}, errs = [];
    if (o.detail != null) {
        const f = String(o.detail);
        if (!fs.existsSync(f)) errs.push('상세 HTML 파일이 없어요: ' + f);
        else { const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); if (!t.trim()) errs.push('상세 HTML 파일이 비었어요'); else patch.detail_html = t; }
    }
    if (o.status != null) { const s = STATUS_IN[String(o.status).trim().toLowerCase()] || STATUS_IN[String(o.status).trim()] || (STATUS_KO[String(o.status).trim().toUpperCase()] ? String(o.status).trim().toUpperCase() : null); if (!s) errs.push('판매 상태는 판매중·판매중지·품절 중 하나예요'); else patch.status = s; }
    // 재고 = 옵션마다(우리 상품은 전부 옵션 상품 · 상품 재고 칸은 네이버가 옵션 합으로 자동 — docs/720-naver-write-api.md ④)
    if (o.stock != null) errs.push('재고는 옵션마다 넣어요: --opt <옵션 id> stock=<수> (옵션 id 는 show 의 옵션 표)');
    if (o.opt) { const p = parseOptArgs(o.opt); errs.push(...p.errs); if (!p.errs.length) patch.options = p.opts; }
    if (o.sale_price != null) { const n = toInt(o.sale_price); if (n == null || n <= 0) errs.push('판매가는 1원 이상 정수예요'); else patch.sale_price = n; }
    if (o.name != null) { const t = String(o.name).trim(); if (!t) errs.push('상품명이 비었어요'); else if (t.length > NAME_MAX) errs.push(`상품명은 ${NAME_MAX}자까지예요(${t.length}자)`); else patch.name = t; }
    if (!errs.length && !Object.keys(patch).length) errs.push('바꿀 것을 주세요: --status <판매중|판매중지|품절> · --opt <옵션 id> <칸>=<값> · --sale-price <원> · --name "<글>" · --detail <html파일>');
    return { patch, errs };
}

// ── 상세 HTML 전/후 — 같은 앞·뒤를 걷어 바뀐 가운데만 글자로(태그 뺌)
const plain = s => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function htmlDelta(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return null;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    // 태그 한가운데서 잘리면 「<img src=…」가 글자로 보인다 → 잘리는 자리를 태그 경계까지 넓힌다(앞·뒤가 같은 글이라 두 쪽에 같은 폭)
    const lt = a.lastIndexOf('<', i - 1), gt = a.lastIndexOf('>', i - 1);
    if (i > 0 && lt > gt) i = lt;
    const ea = a.length - j, nGt = a.indexOf('>', ea), nLt = a.indexOf('<', ea);
    if (j > 0 && nGt >= 0 && (nLt < 0 || nGt < nLt)) j = Math.max(0, a.length - (nGt + 1));
    const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
    const imgs = s => (String(s).match(/<img\b[^>]*>/gi) || []).length;
    return { len_before: a.length, len_after: b.length, imgs_before: imgs(a), imgs_after: imgs(b),
        before: cut(plain(a.slice(i, a.length - j)), 160) || '(글자 없음 · 태그만)', after: cut(plain(b.slice(i, b.length - j)), 160) || '(글자 없음 · 태그만)' };
}
// 상세 HTML 의 그림 주소 중 네이버 주소가 아닌 것(upload 로 받은 주소만 넣어야 함)
function foreignImages(html) {
    const out = []; const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi; let m;
    while ((m = re.exec(String(html || '')))) { if (!/^https:\/\/([a-z0-9-]+\.)*(pstatic\.net|naver\.net|naver\.com)\//i.test(m[1])) out.push(m[1].slice(0, 120)); }
    return out;
}

// ── 옵션 · 결제가 (계약 #721-B 3: pay = salePrice − 즉시할인(WON value · PERCENT floor(salePrice×value/100)) + 옵션 price)
const combos = j => (((((j || {}).originProduct || {}).detailAttribute || {}).optionInfo || {}).optionCombinations) || [];
const optName = c => [c.optionName1, c.optionName2, c.optionName3, c.optionName4].filter(x => x != null && x !== '').join(' / ') || '(이름 없음)';
function discountOf(j) {
    const m = (((((j || {}).originProduct || {}).customerBenefit || {}).immediateDiscountPolicy || {}).discountMethod) || null;
    return m && m.value != null ? { unitType: m.unitType || null, value: Number(m.value) || 0 } : { unitType: null, value: 0 };
}
function payOf(salePrice, disc, optPrice) {
    const sp = Number(salePrice) || 0, d = disc.unitType === 'PERCENT' ? Math.floor(sp * disc.value / 100) : disc.unitType === 'WON' ? disc.value : 0;
    return sp - d + (Number(optPrice) || 0);
}
function optionTable(j) {
    const sp = ((j || {}).originProduct || {}).salePrice, disc = discountOf(j);
    return combos(j).map(c => ({ id: c.id, name: optName(c), price: c.price == null ? 0 : c.price, stock: c.stockQuantity, usable: c.usable !== false, pay: payOf(sp, disc, c.price) }));
}
// 건들기 전(보관본 자신) 판매 정상 — 서버 npwSaleCheck(before, before) 와 같은 세 조건(가격·상세·그림 칸은 자기 자신이라 늘 같음)
function saleOkSelf(j) {
    const op = (j || {}).originProduct || {}, oc = combos(j), bad = [];
    const stock = oc.length ? oc.reduce((s, c) => s + (Number(c.stockQuantity) || 0), 0) : (Number(op.stockQuantity) || 0);
    if (op.statusType !== 'SALE') bad.push('status');
    // options_usable 은 서버가 「ref 보다 늘었을 때만」 — 자기 자신과 견주면 늘 같음(일부러 숨겨 둔 옵션은 ⚠ 아님)
    if (!(stock > 0)) bad.push('stock');
    return { ok: !bad.length, bad, status: op.statusType || null, stock_total: stock, options_n: oc.length };
}
// 보관본 + patch 의 옵션 재고 합(서버 npwCheckPatch 의 「품절 → 판매」 판정과 같음)
function stockAfter(j, patch) {
    const given = new Map((patch.options || []).filter(x => 'stock' in x).map(x => [String(x.id), x.stock])), oc = combos(j);
    return oc.length ? oc.reduce((s, c) => s + (Number(given.has(String(c.id)) ? given.get(String(c.id)) : c.stockQuantity) || 0), 0) : (Number(((j || {}).originProduct || {}).stockQuantity) || 0);
}
// 판매 정상 한 줄 · expectBad = 일부러 바꾼 칸(판매중지·품절로 바꾸면 status·stock ⚠ 는 정상)
function saleLine(label, s, expectBad) {
    if (!s) return `${label}: 확인 못 함(서버가 판매 정상 칸을 안 줌 — show 로 다시 보기)`;
    const exp = new Set(expectBad || []), real = (s.bad || []).filter(b => !exp.has(b)), mine = (s.bad || []).filter(b => exp.has(b));
    const tail = ` · ${stKo(s.status)} · 재고 합 ${won(s.stock_total)}`;
    if (!real.length) return `${label} ✓${mine.length ? `(일부러 바꾼 칸 = ${mine.map(b => BAD_KO[b] || b).join('·')} · 정상)` : ''}${tail}`;
    return `${label} ⚠ ${real.map(b => BAD_KO[b] || b).join(' · ')}${tail}`;
}
const tenX = (a, b) => { a = Number(a) || 0; b = Number(b) || 0; if (a === b || a <= 0) return false; return b >= a * 10 || b <= a / 10; };

// ── 전/후 표·카드 (before = 보관본 JSON · patch = 바꿀 값)
function planRows(before, patch) {
    const op = (before && before.originProduct) || {};
    const rows = [], warns = [], stops = [];
    // 옵션·판매가·상품명(#721 2차) — 바뀐 칸만 · 결제가가 10배 넘게 움직이면 멈춤(0 하나 더·덜 의심)
    if ('options' in patch || 'sale_price' in patch) {
        const disc = discountOf(before), sp0 = op.salePrice, sp1 = 'sale_price' in patch ? patch.sale_price : sp0;
        const byId = new Map(combos(before).map(c => [String(c.id), c])), given = new Map((patch.options || []).map(x => [String(x.id), x]));
        for (const x of (patch.options || [])) {
            const c = byId.get(String(x.id));
            if (!c) { stops.push(`옵션 id ${x.id} 가 이 상품에 없어요 — show 의 옵션 표를 다시 보세요(새 옵션 추가는 3차 · 스마트스토어센터에서)`); continue; }
            const nm = optName(c), ch = [], s0 = stops.length;
            for (const n of [1, 2, 3]) if (('name' + n) in x && x['name' + n] !== (c['optionName' + n] || '')) ch.push([`이름${n}`, c['optionName' + n] || '(빈칸)', x['name' + n]]);
            if ('price' in x && x.price !== (c.price == null ? 0 : c.price)) ch.push(['추가금', won(c.price == null ? 0 : c.price) + '원', won(x.price) + '원']);
            if ('stock' in x) { if (x.stock < 0) stops.push(`옵션 「${nm}」 재고는 0 이상이에요(${x.stock})`); else if (x.stock !== c.stockQuantity) ch.push(['재고', won(c.stockQuantity), won(x.stock)]); }
            if ('usable' in x && x.usable !== (c.usable !== false)) ch.push(['판매', c.usable !== false ? '판매함' : '안 함', x.usable ? '판매함' : '안 함(손님 화면에서 숨김 · 삭제 아님)']);
            if (!ch.length && stops.length === s0) stops.push(`옵션 「${nm}」 는 이미 그 값이에요`);
            for (const [f, b, a] of ch) rows.push({ field: `옵션 「${nm}」(${c.id}) ${f}`, before: b, after: a });
        }
        if ('sale_price' in patch) {
            if (patch.sale_price === sp0) stops.push(`판매가가 이미 ${won(sp0)}원이에요`);
            else { rows.push({ field: '판매가', before: won(sp0) + '원', after: won(patch.sale_price) + '원' }); warns.push('판매가를 바꾸면 모든 옵션 결제가가 같이 움직여요(옵션 추가금·할인은 그대로)'); }
        }
        // 결제가 = 옵션마다(판매가만 바꿔도 전부) · 손님이 내는 돈 기준으로 10배·0원 이하 멈춤
        const payRows = [];
        for (const c of combos(before)) {
            const x = given.get(String(c.id)) || {}, p0 = payOf(sp0, disc, c.price), p1 = payOf(sp1, disc, 'price' in x ? x.price : c.price);
            if (p0 === p1) continue;
            if (p1 <= 0) stops.push(`옵션 「${optName(c)}」 결제가가 ${won(p1)}원이 돼요 — 숫자를 다시 확인해 주세요`);
            else if (tenX(p0, p1)) stops.push(`옵션 「${optName(c)}」 결제가 ${won(p0)} → ${won(p1)}원 = 10배 넘게 바뀌어요 — 숫자를 다시 확인해 주세요`);
            payRows.push({ field: `옵션 「${optName(c)}」 결제가`, before: won(p0) + '원', after: won(p1) + '원' });
        }
        rows.push(...payRows);
        if (disc.unitType) warns.push(`즉시할인(${disc.unitType === 'PERCENT' ? disc.value + '%' : won(disc.value) + '원'})은 그대로 둬요 — 결제가 = 판매가 − 할인 + 옵션 추가금${disc.unitType === 'PERCENT' ? '(% 할인의 원 단위 끝자리는 결과 카드의 네이버 값이 정답)' : ''}`);
        if (op.statusType === 'OUTOFSTOCK' && !('status' in patch) && (patch.options || []).some(x => x.stock > 0)) warns.push('지금 품절 상태예요 — 재고를 넣으면 서버가 판매중으로도 같이 돌려요(재고만 넣어 판매 복귀) · 결과 카드의 「건든 뒤 판매 정상」 줄로 확인');
        if ((patch.options || []).some(x => 'name1' in x || 'name2' in x || 'name3' in x)) warns.push('옵션 이름을 바꾸면 자사몰·송장변환 품목 연결이 옛 이름을 찾을 수 있어요 — 자사몰도 맞출 땐 네이버 먼저 → mall-price → mall-sync');
    }
    if ('name' in patch) {
        const chn = ((before || {}).smartstoreChannelProduct || {}).channelProductName, cur = chn || op.name;
        if (patch.name === cur) stops.push('상품명이 이미 그 글이에요');
        else { rows.push({ field: '상품명', before: cur, after: patch.name }); if (chn) warns.push('채널 상품명이 따로 있어 둘 다 같은 글로 바꿔요'); }
    }
    if ('detail_html' in patch) {
        // #720-D 실시험(10/17): 네이버 API 가 상세의 스마트에디터 편집 자료(script 블록)·그림 링크 속성·style 을 걸러 저장 → 원본 그대로 되돌리기 불가 · 서버 잠금(detail_enabled)
        warns.push('API 로 상세를 저장하면 스마트에디터 편집 자료가 빠지고 되돌리기도 원본 그대로는 안 됨 — 대표 확정 전 잠금(상세는 당분간 스마트스토어센터에서)');
        const d = htmlDelta(op.detailContent, patch.detail_html);
        if (d) rows.push({ field: '상세', before: `${won(d.len_before)}자 · 그림 ${d.imgs_before}장 · 「${d.before}」`, after: `${won(d.len_after)}자 · 그림 ${d.imgs_after}장 · 「${d.after}」` });
        const fi = foreignImages(patch.detail_html);
        if (fi.length) warns.push(`상세 HTML 에 네이버 주소가 아닌 그림 ${fi.length}개 — upload 로 받은 주소로 바꾸세요: ` + fi.slice(0, 3).join(' · '));
        if (d && d.imgs_after < d.imgs_before) warns.push(`그림이 ${d.imgs_before}장 → ${d.imgs_after}장으로 줄어요 — 일부러 뺀 것인지 확인`);
    }
    if ('status' in patch) {
        const cur = op.statusType;
        if (patch.status === cur) stops.push(`이미 ${stKo(cur)} 상태예요`);
        // 품절 → 판매중 = 보관본 재고가 있을 때만(서버 npwCheckPatch 와 같음) · 재고 0 이면 옵션 재고를 넣는 것으로(--opt <id> stock=<수>)
        else if (patch.status === 'SALE' && cur === 'OUTOFSTOCK' && !(stockAfter(before, patch) > 0)) stops.push('품절 → 판매중은 재고가 있어야 해요 — 재고가 0 이라 옵션 재고를 같이 넣어 주세요: --opt <옵션 id> stock=<수>(재고 수는 요청하신 분께 되묻기)');
        else if (patch.status === 'OUTOFSTOCK' && (patch.options || []).some(x => 'stock' in x)) stops.push('품절과 옵션 재고를 같이 바꿀 수 없어요(품절 = 옵션 재고 전부 0)');
        else if (!(STATUS_MOVES[cur] || []).includes(patch.status)) stops.push(`${stKo(cur)} → ${stKo(patch.status)} 는 바꿀 수 없어요`);
        else {
            rows.push({ field: '판매 상태', before: stKo(cur), after: stKo(patch.status) });
            if (Object.keys(patch).length === 1) warns.push('상태만 바꿈 · 상세 무접촉');
            const oc = combos(before);
            if (patch.status === 'OUTOFSTOCK') warns.push(`품절로 바꾸면 네이버가 재고를 0 으로 만들어요${oc.length ? ` — 옵션 ${oc.length}개 재고가 전부 0 · 원래 재고로 돌리는 길은 revert(보관본 재고로 되돌림)` : ''}`);
        }
    }
    return { rows: stops.length ? [] : rows, warns, stops };
}
// 통째 PUT 을 타는 patch(서버 usesPut 과 같음) — 설정 'naver_product_write'.put_enabled 가 true 일 때만 서버가 받음(#721-B · 판매중지·재개는 늘 열림)
const PUT_LOCK_TEXT = '통째 수정은 대표 확정 대기 — 지금은 판매중지/재개만';
function usesPut(before, patch) {
    const st = (((before || {}).originProduct) || {}).statusType;
    return ['detail_html', 'sale_price', 'name', 'options'].some(k => k in patch) || patch.status === 'OUTOFSTOCK' || (patch.status === 'SALE' && st === 'OUTOFSTOCK');
}
// 그림 링크 = 대표 확정(10/17): 직원이 센터에서 손으로 다시 건다 · 창구는 「링크 n개 끊김 → 센터에서」 한 줄만
function linkLine(res) {
    const n = Number(res && res.links_converted) || 0, m = Number(res && res.links_after) || 0;
    return n > m ? `그림 링크 ${n - m}개 끊김 → 스마트스토어센터(스마트에디터)에서 다시 걸어 주세요` : null;
}
// create --opt-name1 "이름1|이름2=추가금" → 계약 options[{ name1, name2?, name3?, price, stock? }]
function parseNewOpts(list, stock) {
    const opts = [], errs = [];
    for (const raw of (list || [])) {
        const m = /^([^=]*)(?:=([\s\S]*))?$/.exec(String(raw == null ? '' : raw).trim());
        const names = (m ? m[1] : '').split('|').map(x => x.trim());
        if (!names[0]) { errs.push(`옵션 「${raw}」: 이름이 비었어요`); continue; }
        if (names.length > 3) { errs.push(`옵션 「${raw}」: 이름 칸은 3개까지(| 로 나눔)`); continue; }
        if (names.some(x => !x)) { errs.push(`옵션 「${raw}」: | 사이가 비었어요`); continue; }
        if (names.some(x => x.length > 50)) { errs.push(`옵션 「${raw}」: 이름 칸은 50자까지`); continue; }
        const price = m && m[2] != null ? toInt(m[2]) : 0;   // 「=」 뒤는 정수만(1.5·글자 = 거절)
        if (price == null) { errs.push(`옵션 「${raw}」: 추가금은 정수예요`); continue; }
        const one = { name1: names[0], price };
        if (names[1]) one.name2 = names[1];
        if (names[2]) one.name3 = names[2];
        if (stock != null) one.stock = stock;
        opts.push(one);
    }
    if (opts.length > OPT_MAX) errs.push(`옵션은 ${OPT_MAX}개까지예요(${opts.length}개)`);
    if (new Set(opts.map(x => x.name3 ? 3 : x.name2 ? 2 : 1)).size > 1) errs.push('옵션마다 이름 칸 수(| 개수)가 같아야 해요');
    return { opts, errs };
}
const HIDDEN_LINE = '손님에게 안 보임(판매중지·전시중지·쇼핑 미노출) — 열기는 센터에서';
// 서버 options_table → 카드 줄(바뀐 칸만 · 결제가 포함)
function optionRows(table) {
    const F = { name: '이름', price: '추가금', stock: '재고', usable: '판매', pay: '결제가' };
    const fmt = (k, v) => v == null ? '(없음)' : k === 'usable' ? (v ? '판매함' : '안 함') : (k === 'price' || k === 'pay') ? won(v) + '원' : k === 'stock' ? won(v) : String(v);
    const rows = [];
    for (const t of (table || [])) for (const k of (t.changed || [])) rows.push({ field: `옵션 「${(t.before || {}).name || t.id}」(${t.id}) ${F[k] || k}`, before: fmt(k, (t.before || {})[k]), after: fmt(k, (t.after || {})[k]) });
    return rows;
}
// 일부러 바꿔서 sale_ok 가 bad 로 잡히는 게 정상인 칸
function expectBad(patch) {
    const e = [];
    if (patch.status === 'SUSPENSION' || patch.status === 'OUTOFSTOCK') e.push('status');
    if (patch.status === 'OUTOFSTOCK' || (patch.options || []).some(x => x.stock === 0)) e.push('stock');
    if ((patch.options || []).some(x => x.usable === false)) e.push('options_usable');
    if ('detail_html' in patch) e.push('detail');
    return e;
}
// 품절 → 판매에서 PUT 은 나갔는데 판매중이 아님 = 그 상태를 사람 말로(재고 되돌림 여부를 나눠)
function halfSale(res) {
    if (!res || res.status_now == null || res.status_now === 'SALE') return null;
    if (res.stock_restored === true) return `재고는 돌아왔어요(재고 합 ${won(res.stock_total_now)}) · 상태만 아직 ${stKo(res.status_now)} — 스마트스토어센터에서 판매중으로 눌러 주세요(재고는 이미 있음) · 창구에서 다시 보내지 않기`;
    if (res.stock_restored === false) return `재고가 0 이라 아직 ${stKo(res.status_now)} — 옵션 재고를 넣어야 팔려요(--opt <옵션 id> stock=<수> · 재고 수는 되묻기)`;
    return `아직 ${stKo(res.status_now)} 상태예요 — show 로 지금 값을 확인해 주세요`;
}
function card(head, pno, name, rows, extra) {
    const L = [`━━━ 네이버 상품 ${head} ━━━`, `상품: ${name ? name + ' ' : ''}(${pno})`];
    if (Array.isArray(rows) && !rows.length) L.push('바뀌는 곳 없음 — 지금 값과 같아요');   // rows null = 전/후 표가 없는 카드(create)
    for (const r of (rows || [])) L.push(`· ${r.field}: ${r.before} → ${r.after}`);
    for (const x of (extra || [])) L.push(x);
    return L.join('\n');
}

// ── 요청 줄 → 결과 (한 칸 · 다른 작업이 걸려 있으면 기다리지 않고 멈춤)
function makeRunner(deps) {
    const { pool, sleep, now } = deps;
    const cfgGet = async k => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [k]); return r.rows.length ? r.rows[0].value : null; };
    async function send(req, ms = 150000) {
        if (await cfgGet(REQ_KEY)) throw new Error('다른 상품 쓰기 요청이 아직 처리 중이에요 — 1분 뒤 다시');
        await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]);
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [REQ_KEY, JSON.stringify(req)]);
        const t0 = now();
        while (now() - t0 < ms) {
            await sleep(5000);
            const v = await cfgGet(RES_KEY);
            if (v && (v.order_id == null || String(v.order_id) === String(req.order_id)) && (!v.op || v.op === req.op)) { await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]); return v; }
        }
        throw new Error('상품 쓰기 러너 응답 없음(2분 30초) — 실서버가 깨어 있는지 확인해 주세요(요청 줄은 서버가 깨면 그대로 실행돼요 — 다시 보내지 말고 총괄에게)');
    }
    async function orderBy(orderId) {
        const o = (await pool.query(`SELECT id, created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
        if (!o) throw new Error('없는 지시입니다: ' + orderId);
        return '클코(창구) · ' + (o.created_by || '요청자 미상');
    }
    async function backupRow(arg) {
        const s = String(arg || '').replace(/\D/g, '');
        if (!s) throw new Error('backup_id 또는 상품번호가 필요해요');
        const q = s.length <= 9
            ? await pool.query(`SELECT id, product_no, order_id, before_json, applied_at, reverted_at FROM naver_product_backups WHERE id = $1`, [parseInt(s, 10)])
            : await pool.query(`SELECT id, product_no, order_id, before_json, applied_at, reverted_at FROM naver_product_backups WHERE product_no = $1 AND applied_at IS NULL AND COALESCE(result_json->>'op', '') <> 'create_failed' ORDER BY id DESC LIMIT 1`, [s]);
        const r = q.rows[0];
        if (!r) throw new Error(s.length <= 9 ? `보관본 ${s} 를 못 찾았어요` : `상품 ${s} 의 아직 적용 안 한 보관본이 없어요 — 먼저 show`);
        return Object.assign(r, { before_json: typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json });
    }
    async function isAdmin(orderId) {
        const r = (await pool.query(`SELECT u.role FROM pending_orders o JOIN users u ON u.id = o.created_by_id AND u.deleted_at IS NULL WHERE o.id = $1`, [orderId])).rows[0];
        return !!r && r.role === 'admin';
    }
    async function writeCfg() { try { const v = await cfgGet('naver_product_write'); return (v && typeof v === 'object') ? v : {}; } catch (_) { return {}; } }
    return { send, orderBy, backupRow, isAdmin, writeCfg };
}

async function main(argv, deps) {
    const out = deps.out || (o => console.log(JSON.stringify(o, null, 1)));
    const R = makeRunner(deps);
    const cmd = argv[0], { o, rest } = parseOpts(argv.slice(1));
    const oid = n => { const v = parseInt(n, 10); if (!(v > 0)) throw new Error('지시 id 가 필요해요(누가 시켰는지 기록)'); return v; };

    if (cmd === 'show') {
        const pno = String(rest[0] || '').replace(/\D/g, ''); if (!/^\d{6,}$/.test(pno)) throw new Error('네이버 상품번호를 주세요(스마트스토어 상품 주소 끝 숫자)');
        const orderId = oid(rest[1]);
        const res = await R.send({ op: 'backup', order_id: orderId, product_no: pno, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '보관 실패', code: res.code || null, note: '바꾼 것 없음' });
        const row = await R.backupRow(res.backup_id);
        const op = row.before_json.originProduct || {};
        fs.mkdirSync(TMP, { recursive: true });
        const file = path.join(TMP, `detail_${pno}_b${res.backup_id}.html`);
        fs.writeFileSync(file, String(op.detailContent || ''), 'utf8');
        const options = optionTable(row.before_json), disc = discountOf(row.before_json);
        return out({ ok: true, product_no: pno, backup_id: res.backup_id, summary: res.summary, detail_file: file,
            sale_price: op.salePrice, discount: disc.unitType ? disc : null, options,
            options_text: options.map(x => `${x.id} · ${x.name} · 추가금 ${won(x.price)} · 결제가 ${won(x.pay)} · 재고 ${won(x.stock)} · ${x.usable ? '판매함' : '안 함'}`),
            sale_ok_before: res.sale_ok || saleOkSelf(row.before_json),
            sale_line: saleLine('건들기 전 판매 정상', res.sale_ok || saleOkSelf(row.before_json)),
            next: `옵션: plan ${res.backup_id} --opt <옵션 id> name1=…|price=…|stock=…|usable=… · 판매가 --sale-price <원> · 상품명 --name "<글>" · 상태 --status <값>`,
            note: '네이버 상품 전체를 보관했어요(쓰기 0) — 옵션은 이름이 아니라 위 표의 id 로 고른다 · 이 backup_id 로 plan → apply' });
    }
    if (cmd === 'plan' || cmd === 'apply') {
        const row = await R.backupRow(rest[0]);
        const { patch, errs } = buildPatch(o);
        if (errs.length) throw new Error(errs.join(' · '));
        const op = row.before_json.originProduct || {};
        const P = planRows(row.before_json, patch);
        const locked = usesPut(row.before_json, patch) && (await R.writeCfg()).put_enabled !== true;
        if (locked) P.warns.unshift(PUT_LOCK_TEXT + '(apply 가 거절해요 · 옵션·가격·상품명·품절·상세는 스마트스토어센터에서)');
        const undo = `되돌리기: node scripts/desk/naver-detail.js revert ${row.id} <지시 id>`;
        if (cmd === 'plan') {
            if (P.stops.length) return out({ ok: false, stopped: true, product_no: row.product_no, backup_id: row.id, stops: P.stops, can_apply: false, note: '멈췄어요 — 바꾼 것 없음' });
            if (row.applied_at) P.warns.unshift('이 보관본은 이미 적용했어요 — 다시 바꾸려면 show 로 새로 보관');
            const blocked = busyWindow(deps.now());
            return out({ ok: true, product_no: row.product_no, backup_id: row.id, changes: P.rows, warnings: P.warns, can_apply: P.rows.length > 0 && !row.applied_at,
                time_block: blocked ? '지금은 평일 08:30~10:30(발송 직전)이라 apply 는 10:30 뒤에' : null,
                sale_ok_before: saleOkSelf(row.before_json),
                card: card('수정 계획(아직 안 보냄)', row.product_no, op.name, P.rows, P.warns.map(w => '⚠ ' + w).concat([saleLine('건들기 전 판매 정상', saleOkSelf(row.before_json)), '이대로 바꿀까요?'])),
                note: '미리 보기 — 아직 아무것도 바꾸지 않았어요' });
        }
        // apply
        const orderId = oid(rest[1]);
        if (row.applied_at) throw new Error('이미 적용한 보관본이에요 — show 로 새로 보관한 뒤 plan → apply');
        if (P.stops.length) return out({ ok: false, stopped: true, stops: P.stops, note: '멈췄어요 — 보낸 것 없음' });
        if (!P.rows.length) return out({ ok: true, changed: false, note: '지금 값과 같아요 — 보낸 것 없음' });
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 10:30 뒤에 같은 명령으로', note: '보낸 것 없음' });
        const res = await R.send({ op: 'apply', order_id: orderId, backup_id: row.id, product_no: row.product_no, patch, created_by: await R.orderBy(orderId) });
        if (!res.ok) {
            if (/통째 수정은/.test(String(res.error || ''))) return out({ ok: false, stopped: true, locked: true, error: res.error,
                card: card('수정 안 함 — 잠김', row.product_no, op.name, P.rows, ['🔒 ' + PUT_LOCK_TEXT, '옵션·가격·상품명·품절·상세는 스마트스토어센터에서 직접 해 주세요']),
                note: PUT_LOCK_TEXT + ' — 바꾼 것 없음 · 위 카드 그대로 전하기' });
            const half = halfSale(res);   // 품절 → 판매에서 PUT 은 나갔는데 아직 품절(계약 #721-B 1 오류 칸)
            return out({ ok: false, error: res.error || '수정 실패', code: res.code || null, drift_paths: res.drift_paths || undefined, steps_done: res.steps_done || undefined,
                status_now: res.status_now || undefined, stock_restored: res.stock_restored == null ? undefined : res.stock_restored, attempts: res.attempts || undefined,
                sale_line: res.sale_ok ? saleLine('건든 뒤 판매 정상', res.sale_ok) : undefined,
                note: half || (res.drift_paths ? '보관한 뒤 네이버에서 누가 고쳤어요 — 바꾼 것 없음 · show 로 새로 보관하고 다시 plan' : ((res.steps_done || []).length ? `일부만 됐어요(${res.steps_done.join('·')}) — show 로 지금 값을 확인하고 필요하면 revert` : (res.code ? '네이버가 받지 않았어요 — 바꾼 것 없음일 가능성이 높지만 show 로 지금 값을 확인하세요' : '서버가 거절했어요(위 error 그대로 전하기) — 바꾼 것 없음'))), undo });
        }
        const bad = (res.unexpected_paths || []), miss = (res.not_applied || []);
        const extra = P.warns.filter(w => /상태만 바꿈/.test(w));
        if (bad.length) extra.push(`🔴 예상 밖으로 바뀐 칸 ${bad.length}곳: ${bad.slice(0, 5).join(' · ')}${bad.length > 5 ? ' …' : ''} — 되돌리기를 권합니다`);
        if (linkLine(res)) extra.push(linkLine(res));
        if (res.option_ids_kept === false) extra.push('⚠ 네이버가 옵션을 새로 만들었어요(옵션 id 가 바뀜) — 주문 연결은 판매자 관리코드라 큰 해는 없지만 총괄에게 알려 주세요');
        if (miss.length) extra.push(`⚠ 요청했는데 그대로인 칸: ${miss.map(k => ({ detail_html: '상세', status: '판매 상태', stock: '재고', options: '옵션', sale_price: '판매가', name: '상품명' })[k] || k).join(' · ')}`);
        const rowsAfter = res.options_table ? P.rows.filter(r => !/^옵션 「/.test(r.field)).concat(optionRows(res.options_table)) : P.rows;
        const sb = saleOkSelf(row.before_json), sa = res.sale_ok || null, sold = !!(sa && sb.ok && (sa.bad || []).filter(b => !expectBad(patch).includes(b)).length);
        extra.push(saleLine('건들기 전 판매 정상', sb), saleLine('건든 뒤 판매 정상', sa, expectBad(patch)));
        if (sold) extra.push('🔴 건들기 전엔 정상으로 팔리던 상품이 지금은 아니에요 — 되돌리기를 권합니다');
        extra.push(undo);
        const red = bad.length || sold;
        return out({ ok: true, changed: true, product_no: row.product_no, backup_id: row.id, changed_paths: res.changed_paths || [], unexpected_paths: bad, not_applied: miss,
            options_table: res.options_table || undefined, price_basis: res.price_basis || undefined, option_ids_kept: res.option_ids_kept,
            sale_ok_before: sb, sale_ok_after: sa,
            before_summary: res.before_summary, after_summary: res.after_summary, recommend_revert: !!red,
            card: card(red ? '수정 결과 — 🔴 확인 필요' : '수정 결과', row.product_no, op.name, rowsAfter, extra),
            note: red ? '바꿨지만 확인할 것이 있어요 — 답 맨 위에 빨간 줄 그대로 · 되돌리기 권고' : (sa ? '바꿨어요 — 네이버에서 다시 읽어 바꾼 칸만 달라졌고 판매 정상도 확인했어요(완료 = 이 카드 + 판매 정상 두 줄)' : '바꿨어요 — 단 판매 정상 칸이 없어 「반영 완료」라 쓰지 말고 show 로 다시 확인') });
    }
    if (cmd === 'revert') {
        const row = await R.backupRow(rest[0]);
        const orderId = oid(rest[1]);
        if (!row.applied_at) throw new Error('아직 적용하지 않은 보관본이에요 — 되돌릴 것이 없어요');
        if (row.reverted_at) throw new Error('이미 되돌린 보관본이에요');
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 급하면 총괄에게', note: '보낸 것 없음' });
        if (o.force === true && !(await R.isAdmin(orderId))) throw new Error('--force(네이버에서 그 뒤 바뀐 것까지 덮기)는 관리자 계정 지시만 돼요 — 관리자에게 확인을 받아 주세요');
        const res = await R.send({ op: 'revert', order_id: orderId, backup_id: row.id, product_no: row.product_no, force: o.force === true, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '되돌리기 실패', drift_paths: res.drift_paths || undefined, steps_done: res.steps_done || undefined,
            status_now: res.status_now || undefined, stock_restored: res.stock_restored == null ? undefined : res.stock_restored, attempts: res.attempts || undefined,
            note: halfSale(res) || (res.drift_paths ? '적용한 뒤 네이버에서 또 바뀐 곳이 있어요 — 그 칸(drift_paths)을 요청자에게 보여 주고 「그래도 되돌려」면 --force' : '되돌리지 못했어요 — 총괄에게') });
        const name = (row.before_json.originProduct || {}).name;
        const sb = saleOkSelf(row.before_json), lines = [res.same_as_before ? '보관해 둔 그대로 돌아왔어요(다시 읽어 확인)' : `⚠ 보관본과 아직 다른 칸 ${(res.residual_paths || []).length}곳: ${(res.residual_paths || []).slice(0, 5).join(' · ')}`];
        if (linkLine(res)) lines.push(linkLine(res));
        lines.push(saleLine('건들기 전 판매 정상', sb), saleLine('되돌린 뒤 판매 정상', res.sale_ok || null));
        const back = !sb.ok || !res.sale_ok || res.sale_ok.ok;   // 원래 팔리던 상품이면 되돌린 뒤에도 팔려야
        if (!back) lines.push('🔴 원래 팔리던 상품인데 되돌린 뒤 아직 정상이 아니에요 — 총괄에게');
        return out({ ok: true, product_no: row.product_no, backup_id: row.id, same_as_before: !!res.same_as_before, residual_paths: res.residual_paths || [],
            options_table: res.options_table || undefined, sale_ok_before: sb, sale_ok_after: res.sale_ok || null,
            card: card('되돌리기 결과', row.product_no, name, res.options_table ? optionRows(res.options_table) : [], lines),
            note: res.same_as_before && back ? '되돌렸어요' : '되돌렸지만 확인할 것이 남았어요 — 총괄에게' });
    }
    if (cmd === 'create') {
        const orderId = oid(rest[0]);
        const from = String(o.from || '').replace(/\D/g, '');
        if (!/^\d{6,}$/.test(from)) throw new Error('--from <본뜰 네이버 상품번호> 가 필요해요(배송·반품·고시 칸을 그 상품에서 그대로 가져와요)');
        const name = String(o.name == null ? '' : o.name).trim();
        if (!name) throw new Error('--name "<새 상품 이름>" 이 필요해요');
        if (name.length > NAME_MAX) throw new Error(`상품 이름은 ${NAME_MAX}자까지예요(${name.length}자)`);
        let stock = null; if (o.stock != null) { stock = toInt(o.stock); if (stock == null || stock < 0) throw new Error('--stock 은 0 이상 정수예요'); }
        let sale_price = null; if (o.price != null) { sale_price = toInt(o.price); if (sale_price == null || sale_price <= 0) throw new Error('--price(판매가)는 1원 이상 정수예요'); }
        const P = parseNewOpts(o.newOpt, stock);
        if (P.errs.length) throw new Error(P.errs.join(' · '));
        const req = { op: 'create', order_id: orderId, from_product_no: from, name, hidden: true };
        if (P.opts.length) req.options = P.opts;
        if (sale_price != null) req.sale_price = sale_price;
        if (stock != null && !P.opts.length) req.stock = stock;
        const L = [`본뜰 상품: ${from}(배송·반품·A/S·원산지·고시·할인·상세를 그대로 복사)`, `새 이름: ${name}`];
        if (sale_price != null) L.push(`판매가: ${won(sale_price)}원(즉시할인은 본뜬 상품 그대로 · 결제가 = 판매가 − 할인 + 추가금)`);
        if (P.opts.length) for (const x of P.opts) L.push(`옵션: ${[x.name1, x.name2, x.name3].filter(Boolean).join(' / ')} · 추가금 ${won(x.price)}원 · 재고 ${won(x.stock != null ? x.stock : 99999)}`);
        else L.push(`옵션: 본뜬 상품 옵션 그대로 · 재고 99999${stock != null ? '(옵션 상품이면 --stock 은 안 먹어요)' : ''}`);
        L.push(HIDDEN_LINE);
        if (o.dry) return out({ ok: true, dry: true, request: req, card: card('새 상품 등록 계획(아직 안 보냄)', '새 번호는 등록 뒤', name, null, L.concat(['이대로 등록할까요?'])), note: '미리 보기 — 보낸 것 없음' });
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 등록하지 않아요 — 10:30 뒤에 같은 명령으로', note: '보낸 것 없음' });
        const res = await R.send(Object.assign(req, { created_by: await R.orderBy(orderId) }), 240000);
        if (!res.ok) {
            const e = String(res.error || '');
            const note = /승인 뒤 실행/.test(e) ? '승인이 필요해요 — approval 로 올리고 [승인] 뒤 같은 명령'
                : /24시간/.test(e) ? '오늘 등록 상한(24시간 3개)이에요 — 내일 다시'
                : /번호를 못 찾았어요/.test(e) ? '🔴 등록은 됐을 수 있어요 — 다시 보내지 말고 스마트스토어센터에서 확인 · 총괄에게'
                : (res.invalid_fields || []).length ? `네이버가 받지 않은 칸: ${res.invalid_fields.join(' · ')} — 등록 안 됨 · 총괄에게(설정으로 고쳐 다시)`
                : '등록 안 됨 — 위 error 그대로 전하기';
            return out({ ok: false, error: res.error || '등록 실패', code: res.code || null, invalid_fields: res.invalid_fields || undefined, origin_product_no: res.origin_product_no || undefined, note });
        }
        const sk = (res.sale_ok || {}).stock_total, sm = res.summary || {};
        const R2 = [`새 상품번호: ${res.product_no}(원상품 ${res.origin_product_no || '?'}) · 본뜬 상품 ${res.from_product_no || from}`, `이름: ${name}`, `옵션 ${won(sm.options_n || 0)}개 · 재고 합 ${won(sk)}`];
        const shopTxt = res.shopping === false ? '미노출' : String(res.shopping);
        if (res.hidden_ok === true) R2.push(HIDDEN_LINE);
        else if (res.status_now === 'WAIT') R2.push(`⚠ 판매 대기(WAIT)로 남았어요 — 판매중지로: show ${res.product_no} <지시 id> → apply <backup_id> <지시 id> --status 판매중지 (전시 ${res.display || '?'} · 쇼핑 ${shopTxt})`);
        else R2.push(`⚠ 안 보이게 됐는지 확인 필요 — 상태 ${stKo(res.status_now)} · 전시 ${res.display || '?'} · 쇼핑 ${shopTxt} — 스마트스토어센터에서 확인`);
        if (res.hidden_forced) R2.push('노출 요청은 오늘 규칙상 막혀 비노출로 등록했어요');
        if (!(sk > 0)) R2.push('⚠ 옵션 재고가 안 들어갔어요 → 재고·옵션은 스마트스토어센터에서 최종 세팅');
        if (linkLine(res)) R2.push(linkLine(res));
        if (res.error_note) R2.push('⚠ ' + res.error_note);
        R2.push('판매 시작(전시 ON · 판매중 · 쇼핑 노출)은 스마트스토어센터에서');
        const okHidden = res.hidden_ok === true;
        return out({ ok: true, product_no: res.product_no, origin_product_no: res.origin_product_no || null, backup_id: res.backup_id || null,
            hidden_ok: res.hidden_ok, status_now: res.status_now, display: res.display, shopping: res.shopping,
            card: card(okHidden ? '새 상품 등록 결과' : '새 상품 등록 결과 — 🔴 확인 필요', res.product_no, name, null, R2),
            note: okHidden ? '등록했어요 — 손님에게 안 보이는 상태 · 새 상품번호와 카드 그대로 전하기' : '등록은 됐지만 확인할 것이 있어요 — 카드의 ⚠ 줄 그대로 답 맨 위에' });
    }
    if (cmd === 'upload') {
        const ids = rest.map(n => parseInt(n, 10)).filter(n => n > 0);
        if (!ids.length) throw new Error('그림이 붙은 지시 id 를 주세요');
        const res = await R.send({ op: 'upload_image', order_id: ids[0], order_ids: ids, created_by: await R.orderBy(ids[0]) });
        if (!res.ok && !(res.urls || []).length) return out({ ok: false, error: res.error || '그림 올리기 실패', code: res.code || null });
        return out({ ok: !!res.ok, urls: res.urls || [], error: res.error || undefined,
            html: (res.urls || []).map(u => `<img src="${u}" alt="">`), note: '상세 HTML 에는 이 주소만 넣어요(다른 사이트 주소 금지)' });
    }
    throw new Error('명령: show · plan · apply · revert · upload · create');
}

module.exports = { main, makeRunner, parseNewOpts, linkLine, planRows, htmlDelta, foreignImages, buildPatch, busyWindow, card, parseOpts, parseOptArgs, optionTable, optionRows, payOf, discountOf, saleOkSelf, saleLine, expectBad, halfSale, REQ_KEY, RES_KEY };

if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)))
        .finally(() => pool.end().catch(() => { }));
}

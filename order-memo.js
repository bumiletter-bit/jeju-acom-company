// #850 발주 메모함 — 서버(표 order_memo_entries·order_memo_rows · API /api/order-memo/*) · 계약 = docs/850-api.md · 설계 = docs/850-order-memo-design.md
//   직원이 회사폰 노트에 적던 발주 메모(현금 손님 주소·「S사이즈로」·「27일 발송」·입력삭제)를 여기에 붙여 두면, 다음 날 최종발주가 메모 칸·현금 행으로 받아 간다.
//   🔴 최종발주 판정(v2 parseLines · sizeLines · prepLines · parseCash · cashCheck)은 무접촉 — 여기가 만드는 것은 사람이 메모 칸에 치는 글·현금파일 행과 같은 꼴뿐.
//   규칙 = final-order-core.js(sizeLines·parseDate·fmtPhone·HEADERS) 와 invoice-v2.js parseLines 를 그대로 불러 쓴다(따로 만들지 않음).
//   개인정보(대표 결정 A) = 이름·주소·번호를 DB 에 두는 대신 비운 줄은 keep_days(30) 뒤 영구 삭제 · 감사 기록·로그엔 줄 수·상태만.
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./public/final-order-core.js');

const ORIGIN_DEFAULT = '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네';   // 현금파일 실자료(06.12) 출고지 칸과 같은 글
const STALE_DAYS = 7;   // 확인(🟠) 줄이 이만큼 안 고쳐지면 목록에 「오래된 확인」
const DEFAULTS = { keep_days: 30, unsure_days: 30, origin_addr: ORIGIN_DEFAULT, ai: { enabled: true, direct: false, staff_direct: false, model: 'claude-opus-5-5', effort: 'low' } };
// AI 길(대표 「고」 · 총괄 #850) = 창구 경유가 기본(최종발주 메모 읽기와 같은 길 · 대표·발주 컴퓨터 계정 = 대표 요금제 · 그 밖 = 창구 콘솔 키) ·
//   ai.direct true 일 때만 서버가 직접 AI(아래 model) · 창구 꺼짐이면 규칙으로만 정리하고 남은 글은 그대로 돌려줌
const DESK_PREFIX = '[발주 메모 읽기]', DESK_WAIT_SEC = 30;
// 직접 AI 모델 = 오퍼스(대표 · 배송메세지·명절·특수 요청은 정확도 우선 · 최종발주 메모 읽기와 같은 판정)
const MAX_RAW = 4000, MAX_ROWS = 60, LIST_MAX = 200, PREVIEW_PER_MIN = 20, USED_MAX = 2000;   // #900-2A LIST_MAX = 비운 것 목록 묶음 수만(열린 줄 묶음은 상한 없음)
const REQ_CELLS = { 3: '받는 분 이름이 없어요', 4: '품목을 못 정했어요', 5: '수량이 없어요', 6: '받는 분 연락처가 없어요', 8: '주소가 없어요' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDay = d => YMD.test(String(d || '')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const dg = v => String(v == null ? '' : v).replace(/\D/g, '');
const md = iso => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
const s = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, n);

// ── v2 parseLines 를 invoice-v2.js 에서 떼어 온다(브라우저 파일 · 즉시 실행 함수 안이라 require 가 안 됨) ──
//   isoOf · parseDate · chOfText · parseLines 네 조각 · 못 찾으면 null(규칙 줄은 sizeLines 만 · 나머지는 AI) — 서버 기동은 안 막는다
function loadV2() {
    try {
        const src = fs.readFileSync(path.join(__dirname, 'public', 'invoice-v2.js'), 'utf8').replace(/\r\n/g, '\n');
        const cut = (start, endMark) => { const a = src.indexOf(start); if (a < 0) throw new Error('없음: ' + start); const b = src.indexOf(endMark, a); if (b < 0) throw new Error('끝 없음: ' + start); return src.slice(a, b + endMark.length); };
        const parts = [
            cut('const isoOf = ', ';\n'),
            cut('function parseDate(s, today) {', '\n    }\n'),
            cut('const chOfText = ', ';\n'),
            cut('function parseLines(txt, boxCh, today) {', '\n        return out;\n    }\n'),
        ];
        // eslint-disable-next-line no-new-func
        return new Function(parts.join('\n') + '\nreturn { parseLines, parseDate };')();
    } catch (e) { console.error('[발주 메모함] invoice-v2 parseLines 떼어 오기 실패 — 규칙 줄은 사이즈만:', e.message); return null; }
}
const V2 = loadV2();

// #850-g 현금 손님 단서 — 받는 분·수령인·주소·입금·계좌·도로명/번지 꼴 · 있으면 규칙 줄로 안 쪼갬
const CASH_CUE = /받는\s*(?:분|사람|이)|받으(?:실|시는)\s*분|수령인|수취인|주소|입금|계좌|이체|[가-힣]+(?:시|군|구)\s+[가-힣0-9]+(?:대로|로|길)\s*\d|\d+\s*번지/;
// ── 규칙 정리(무료·즉시) ──
const INDIV = /입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제|개별\s*발송/i;
const SENDER = /보내는\s*(?:이|사람|분)|보낸\s*(?:이|사람|분)|발신/;
const ORDER_WORDS = /^(?:(?:\d{1,2}\s*[\/.월]\s*\d{1,2}\s*일?|\d{1,2}\s*일)(?:날|에)?(?:발송|출고|보내(?:주세요|줘요?|주시[면고]|기|요)?)?|날|오늘|내일|[월화수목금토일]요일|발송|출고|보내(?:주세요|줘요?|주시[면고]|기|요)?|주세요|부탁(?:드립니다|해요)?|요청|입력\s*[oO○0]\s*[·,]?\s*삭제\s*[xX×]|입력\s*삭제|개별\s*발송(?:처리)?|메모\s*무시|네이버|스마트스토어|스토어|쿠팡|자사몰|[,.!~]+)$/;
const ADDRISH = /[가-힣]+(?:시|군|구|읍|면|동|리)\s+[가-힣0-9]+(?:로|길|번지)|\d+\s*동\s*\d+\s*호|아파트|빌라/;
const TOO_MANY_PHONES = t => core.fmtPhone && (String(t).match(/0\d{1,2}[\s\-.]?\d{3,4}[\s\-.]?\d{4}/g) || []).length > 1;
const platOf = t => /자사몰|카페|cafe/i.test(t) ? '자사몰' : /쿠팡|coupang/i.test(t) ? '쿠팡' : /네이버|스토어|스마트|naver/i.test(t) ? '네이버' : '';

// 한 줄이 규칙으로 읽히면 Row 하나 · 아니면 null(AI 몫)
function ruleLine(rawLine, today) {
    const line = rawLine.replace(/\r/g, '').trim(); if (!line) return null;
    const cells = line.split('\t');
    if (cells.length >= 9) return cashRowFromCells(cells.map(c => c.trim()), 'rule');   // 엑셀에서 복사한 현금 행
    const sz = core.sizeLines(line);
    if (sz.sizes.length || sz.bad.length) {
        const keyOf = (sz.sizes[0] || sz.bad[0]).key;
        const bad = sz.bad[0];
        return { kind: 'line', key: keyOf, note: line.replace(keyOf, '').trim(), plat: platOf(line), line, ship_date: null, src: 'rule', _bad: bad ? [bad.why] : [] };
    }
    // #883 과수 줄(「번호 13과로」) = 사이즈 줄과 같게 규칙 줄 · 최종발주 core.gwaLines 가 읽는 꼴 그대로(못 읽는 꼴 = 숫자 범위·박스별 건수 없음도 줄로 두고 checkLine 이 「확인」)
    if (typeof core.gwaLines === 'function') {
        const gw = core.gwaLines(line);
        if (gw.gwas.length || gw.bad.length) {
            const k = (gw.gwas[0] || gw.bad[0]).key, _bad = gw.bad.length ? [gw.bad[0].why] : [];
            const p = V2 ? V2.parseLines(line, 'naver', today)[0] : null;   // 날짜·탭 줄(「10/30⇥번호⇥13과로⇥네이버」)은 v2 가 읽은 칸 그대로(번호·날짜·비고·판매처)
            if (p && !p.bad && dg(p.key) === dg(k)) return { kind: 'line', key: p.key, note: p.note, plat: p.plat || platOf(p.note), line, ship_date: p.date || null, src: 'rule', _bad };
            return { kind: 'line', key: k, note: line.replace(k, '').trim(), plat: platOf(line), line, ship_date: null, src: 'rule', _bad };
        }
    }
    if (!V2) return null;
    const p = V2.parseLines(line, 'naver', today)[0];
    if (!p || p.bad) return null;
    // 비고가 지시(날짜·입력삭제·보내는이·메모무시·플랫폼)뿐인 줄만 규칙으로 — 손님 이름·주소·품목이 섞이면 AI
    const words = p.note.split(/\s+/).filter(Boolean);
    const senderAt = words.findIndex(w => SENDER.test(w));
    const head = senderAt >= 0 ? words.slice(0, senderAt) : words;
    if (ADDRISH.test(p.note) || TOO_MANY_PHONES(line)) return null;
    if (!head.every(w => ORDER_WORDS.test(w))) return null;
    if (!p.date && !p.indiv && !INDIV.test(p.note) && senderAt < 0 && !/메모\s*무시/.test(p.note)) return null;
    return { kind: 'line', key: p.key, note: p.note, plat: p.plat || platOf(p.note), line, ship_date: p.date || null, src: 'rule', _bad: [] };
}

// ── 줄 검사(저장·고치기·AI 결과 공통 — 서버 값이 정본) ──
function buildLine(r) {
    const key = s(r.key, 40).trim(), note = s(r.note, 200).replace(/[\t\n]+/g, ' ').trim(), plat = s(r.plat, 10).trim();
    if (r.ship_date) return [md(r.ship_date), key, note, plat].join('\t').replace(/\t+$/, '');
    return [key, note, plat].filter(Boolean).join(' ');
}
function checkLine(r, today, keepRaw) {
    const out = { kind: 'line', key: s(r.key, 40).trim(), note: s(r.note, 200).replace(/[\t\n]+/g, ' ').trim(), plat: s(r.plat, 10).trim(), ship_date: isDay(r.ship_date) ? r.ship_date : null, src: r.src || 'edit' };
    const why = (r._bad || []).slice();
    const d = dg(out.key);
    const keyHole = !!d && (/^0+$/.test(d) || d === '01000000000');   // 틀 자리(000-0000-0000 · 선물하기 자리표시 010-0000-0000) = 번호 아님(워커3 제안)
    const keyBad = !out.key || keyHole || (d.length < 8 && !/\d{8,}/.test(out.key));
    if (keyHole) why.push('번호를 넣어 주세요');
    else if (keyBad) why.push('번호가 없거나 8자리보다 짧아요');
    // 원문 줄(규칙·AI 출처)은 지키되 칸과 어긋나면(화면에서 번호·날짜를 고침) 칸으로 다시 만들고 출처 = edit (#850 점검 e)
    const rawLine = keepRaw && r.line && !/\n/.test(r.line) ? s(r.line, 400).trim() : '';
    let rawOk = !!rawLine;
    if (rawOk && V2) { const p = V2.parseLines(rawLine, 'naver', today)[0]; const nz = t => String(t || '').replace(/\s+/g, ' ').trim();
        rawOk = !!p && !p.bad && dg(p.key) === d && (p.date || null) === out.ship_date && nz(p.note) === nz(out.note) && nz(p.plat || platOf(p.note)) === nz(out.plat); }   // 번호·날짜·비고·플랫폼 넷 다 같을 때만 원문 줄
    if (rawLine && !rawOk) out.src = 'edit';
    out.line = rawOk ? rawLine : buildLine(out);
    if (V2 && !why.length) {
        const p = V2.parseLines(out.line, 'naver', today)[0];
        if (!p || p.bad) why.push('메모 칸이 읽지 못하는 꼴이에요');
        else if (out.ship_date && p.date !== out.ship_date) why.push('날짜를 다시 확인해 주세요');
    }
    const sz = core.sizeLines(out.line); sz.bad.forEach(b => { if (!why.includes(b.why)) why.push(b.why); });
    if (typeof core.gwaLines === 'function') core.gwaLines(core.sizeLines(out.line).text).bad.forEach(b => { if (!why.includes(b.why)) why.push(b.why); });   // #883 과수 줄 못 읽음 = 「확인」
    if (out.ship_date && out.ship_date < today) why.push('지난 날짜예요');
    out.sure = !why.length; out.check_why = why; out.missing = keyBad ? ['key'] : [];   // line 빈 칸 = 'key'(화면 빨강)
    return out;
}
function cashRowFromCells(cells, src) {
    const c = []; for (let i = 0; i < 13; i++) c.push(s(cells[i], i === 8 || i === 12 ? 300 : 200).replace(/[\t\n]+/g, ' ').trim());
    return { kind: 'cash', cells: c, ship_date: null, src };
}
// #863(대표 현금파일 관례) 현금 손님 보내는사람 = 「제주아꼼이네!」·「홍길동 드림!」 — 「!」는 맨 뒤(읽는 쪽 parseCash·invoice-auto·중간발주는 칸 어디든 「!」면 현금)
//   이름만 적힌 사람 이름 = 「○○ 드림」(cashFromAi 와 같게) · 이미 드림·올림 · 제주아꼼이네 · 「○○(제주아꼼이네)」 는 그대로
function cashSender(v) {
    let n = String(v == null ? '' : v).replace(/[!！]/g, '').replace(/\s+/g, ' ').trim();
    if (!n) n = '제주아꼼이네';
    else if (!/(?:드림|올림)$|제주아꼼이네\)?$/.test(n)) n += ' 드림';
    return n + '!';
}
function checkCash(r, today, catalog, origin) {
    const c = cashRowFromCells(r.cells || [], r.src || 'edit').cells;
    // 현금 손님 = 「!」 표식(parseCash bang) · 입력삭제 주문의 주소 줄(r.indiv · markIndiv) = 「!」 없이 + 구매자연락처(K) = 주문 번호 → cashCheck 가 주문과 짝을 지음(#850 워커3 시험)
    if (r.indiv) { c[0] = c[0].replace(/[!！]/g, '').replace(/\s+/g, ' ').trim() || '제주아꼼이네'; if (r.indivKey) c[10] = r.indivKey; }
    else c[0] = cashSender(c[0]);   // #863 「!」 맨 뒤 · 이름만이면 「드림」 · 입력삭제 줄(위)은 「!」가 뒤에 와도 뗌
    if (!c[2]) c[2] = origin;
    // #858(대표 10/26 사진 「!제주아꼼이네」·B 빈칸) 보내는사람연락처(B)가 비면 구매자연락처(K) · 사람이 「보내는이 변경」으로 넣은 번호는 그대로 · 이름(A)은 안 건드림
    if (!c[1] && c[10]) c[1] = c[10];
    [1, 6, 7, 10].forEach(i => { if (c[i]) c[i] = core.fmtPhone(c[i]); });
    const q = Number(c[5]); c[5] = Number.isInteger(q) && q > 0 ? String(q) : '';
    const missing = Object.keys(REQ_CELLS).map(Number).filter(i => !c[i]);
    const why = missing.map(i => REQ_CELLS[i]);
    // #856 최종발주 꼬리(「…2S사이즈로!」·「…15과로!」)는 떼고 대조
    if (c[4] && catalog && !catalog.has(core.stripTail(c[4], n => catalog.has(n)))) { why.push('품목이 단가표 이름과 달라요'); if (!missing.includes(4)) missing.push(4); }
    if (c[6] && dg(c[6]).length < 9) { why.push('받는 분 연락처를 다시 확인해 주세요'); if (!missing.includes(6)) missing.push(6); }
    const ship = isDay(r.ship_date) ? r.ship_date : null;
    if (ship && ship < today) why.push('지난 날짜예요');
    return { kind: 'cash', cells: c, ship_date: ship, src: r.src || 'edit', sure: !why.length, check_why: why, missing: missing.sort((a, b) => a - b), indiv: !/[!！]/.test(c[0]) };   // indiv = 입력삭제 주문의 주소 줄
}
// 같은 묶음 안 「입력o삭제x」 메모 줄의 번호(숫자) — extra = 앞서 규칙으로 읽은 줄의 번호(창구 답을 받을 때)
//   값 = { key, date } · date = 그 입력삭제 줄의 지정 발송일(#850-a · 짝지은 주소 줄이 같은 날 나가게) · extra = 글자(옛 꼴) 또는 { key, date }
const isIndivLine = r => !!r && r.kind === 'line' && INDIV.test(String(r.note || '') + ' ' + String(r.line || '')) && dg(r.key).length >= 8;
function indivKeysOf(rows, extra) {
    const m = new Map();
    (extra || []).forEach(k => { const o = k && typeof k === 'object' ? k : { key: k, date: null }; if (dg(o.key).length >= 8) m.set(dg(o.key), { key: String(o.key), date: isDay(o.date) ? o.date : null }); });
    (rows || []).forEach(r => { if (isIndivLine(r)) m.set(dg(r.key), { key: String(r.key), date: isDay(r.ship_date) ? r.ship_date : null }); });
    return m;
}
// 현금 줄의 구매자 번호(K칸 · 없으면 보내는사람연락처)가 입력삭제 줄 번호와 같으면 = 그 주문의 주소 줄(「!」 안 붙임)
function markIndiv(rows, extra) {
    const keys = indivKeysOf(rows, extra);
    (rows || []).forEach(r => {
        if (!r || r.kind !== 'cash') return;
        if (r.service || r.no_indiv) { r.indiv = false; r.indivKey = null; return; }   // #900 서비스 줄 · 1-H 체크 안 한 줄 = 현금(「!」) 그대로
        const c = r.cells || []; const hit = [c[10], c[1]].map(dg).find(d => d && keys.has(d)); const v = hit ? keys.get(hit) : null;
        r.indiv = !!hit; r.indivKey = v ? v.key : null;
        if (v && v.date && !isDay(r.ship_date)) r.ship_date = v.date;   // #850-a 날짜 지정 입력삭제 줄 = 주소 줄도 그날(그 전엔 for-ship waiting · 비우기에도 안 빠짐)
    });
    return rows;
}
// #874 저장된 현금(「!」) 줄 하나를 입력삭제 줄(line = 표 행 꼴 · line_key)의 주소 줄로 바꾼 값(순수 · 짝 안 되면 null)
//   대상 = 「!」 있고 K(구매자연락처) 또는 B(보내는사람연락처) 번호가 그 번호 · K = 그 번호 · B 는 비었거나 옛 K 와 같을 때만 그 번호(사람이 넣은 다른 B 그대로)
//   날짜 = 줄에 날짜가 없고 입력삭제 줄에 날짜가 있으면 그 날짜(markIndiv 와 같게)
function pairCash(r, line, ctx, opt) {
    const c = Array.isArray(r && r.cells) ? r.cells.slice() : [];
    const key = String((line && line.line_key) || '').trim(), d = dg(key), any = !!(opt && opt.anyNumber);   // #894 F4 any = 후보 묶음에서 사람이 고른 줄(번호가 받는 분 번호여도)
    if (!r || r.kind !== 'cash' || r.service || d.length < 8 || !/[!！]/.test(String(c[0] || '')) || (!any && ![c[10], c[1]].map(dg).includes(d))) return null;   // #900 서비스 줄 = 짝 아님
    if (!dg(c[1]) || dg(c[1]) === dg(c[10])) c[1] = key;
    c[10] = key;
    const own = r.ship_date ? String(r.ship_date).slice(0, 10) : null, ld = line.ship_date ? String(line.ship_date).slice(0, 10) : null;
    return checkRow({ kind: 'cash', cells: c, ship_date: isDay(own) ? own : (isDay(ld) ? ld : null), src: r.src || 'edit', indiv: true, indivKey: key }, ctx);
}
// #894 F4 품목 열쇠 = 채널 옵션(「아꼼이네 상품선택: 3. (제철)과즙팡팡 황금향 / 상품 및 과수: …」)과 현금 줄 품목(단가표 이름) 을 같은 꼴로
const itemKeyOf = o => String(o == null ? '' : o).replace(/^\s*[^:：/]*상품선택\s*[:：]\s*/, '').replace(/^\s*\d+\.\s*/, '').replace(/^\s*\((?:제철|예약|특가|행사)\)\s*/, '').replace(/\s+[^\s]*로!$/, '').replace(/\s+/g, ' ').trim();
// #894 F4 짝 후보(순수) — orders = 그 번호의 주문 [{option, qty}] · rows = 열린 현금·주소 줄(표 행 꼴) · key = 입력삭제 번호
//   need = 품목별 주문 박스 − 이미 짝 된 주소 줄(「!」 없음 · K = 그 번호) 박스 · groups = 짝 안 된 현금(「!」) 줄을 묶음(entry)별로 모아 품목별 박스가 need 와 딱 같은 것 · 최근 묶음 먼저
function pairHint(orders, rows, key) {
    const d = dg(key), add = (m, k, n) => m.set(k, (m.get(k) || 0) + n), need = new Map(), paired = new Map();
    (orders || []).forEach(o => { const k = itemKeyOf(o.option); if (k) add(need, k, Math.max(0, parseInt(o.qty, 10) || 0)); });
    const cashOf = r => r.kind === 'cash' && r.state === 'open' && Array.isArray(r.cells);
    (rows || []).filter(r => cashOf(r) && !/[!！]/.test(String(r.cells[0] || '')) && dg(r.cells[10]) === d).forEach(r => add(paired, itemKeyOf(r.cells[4]), Math.max(0, parseInt(r.cells[5], 10) || 0)));
    const left = new Map(); need.forEach((n, k) => { const v = n - (paired.get(k) || 0); if (v > 0) left.set(k, v); });
    const total = m => [...m.values()].reduce((a, b) => a + b, 0), same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
    const byEntry = new Map(); (rows || []).filter(r => cashOf(r) && !r.service && /[!！]/.test(String(r.cells[0] || ''))).forEach(r => { const g = byEntry.get(r.entry_id) || byEntry.set(r.entry_id, { entry_id: r.entry_id, created_at: r.entry_created_at || null, ids: [], items: new Map() }).get(r.entry_id); g.ids.push(r.id); add(g.items, itemKeyOf(r.cells[4]), Math.max(0, parseInt(r.cells[5], 10) || 0)); });
    const groups = left.size ? [...byEntry.values()].filter(g => same(g.items, left)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.entry_id - a.entry_id).slice(0, 5)
        .map(g => ({ entry_id: g.entry_id, created_at: g.created_at, ids: g.ids, boxes: total(g.items), items: [...g.items].map(([opt, qty]) => ({ opt, qty })) })) : [];
    return { order_boxes: total(need), paired_boxes: total(paired), short: total(left), need: [...left].map(([opt, qty]) => ({ opt, qty })), groups };
}
function checkRow(r, ctx) { return r && r.kind === 'cash' ? checkCash(r, ctx.today, ctx.catalog, ctx.origin) : checkLine(r || {}, ctx.today, !!r && (r.src === 'rule' || r.src === 'ai')); }

// AI 가 돌려준 현금 손님 → 13칸
// #850-b(대표) 문자 대화에서 온 정리 = 구매자 = 문자 온 손님: K칸(구매자연락처) = 그 번호 · 보내는사람연락처 = 그 번호(AI 가 sender_phone 을 따로 준 경우만 그 값)
//   보내는사람 이름 = 보내는이 지정 > 입금자명(「입금 ○○으로 했어요」 = 현금건 → 「○○ 드림」 · 대표 확정) > 구매자(제주아꼼이네) > 제주아꼼이네
//   opt = { smsPhone(숫자 · 문자 출처일 때만), text(손님 글 · 입금자명 찾기) }
// 입금자 이름이 아닌 낱말(워커3 점검 · 「입금 먼저/오후에/바로/제가/늦어서/금액」「입금은 아들이」「남편·엄마·회사 이름으로」「…뱅크·은행·페이로 입금」)
const DEP_STOP = new Set(['계좌', '현금', '오늘', '어제', '방금', '지금', '내일', '모레', '이체', '송금', '입금', '확인', '카드', '통장', '완료', '부탁', '먼저', '오후', '오전', '저녁', '바로', '제가', '저희', '본인', '늦어서', '금액', '나중',
    '남편', '아내', '와이프', '신랑', '엄마', '아빠', '어머니', '아버지', '어머님', '아버님', '부모님', '부모', '아들', '딸', '언니', '오빠', '누나', '동생', '시어머니', '시아버지', '장모님', '장인어른', '할머니', '할아버지', '가족', '친구', '지인', '회사', '회사명', '법인', '사장님', '대표님', '직장', '시댁', '처가', '친정', '본가', '시가', '집']);
const DEP_SUFFIX = /(?:뱅크|은행|페이|카드|증권|금고|농협|수협|신협|우체국|머니|토스|이름|명의)$/;
function depositName(text) {
    const t = String(text || '');
    const bad = n => !n || n.length < 2 || DEP_STOP.has(n) || DEP_SUFFIX.test(n) || /했|됐|드렸|드리|완료|(?:합|하|해|되)$|요$|다$|어$|에$|이$|가$/.test(n)
        || /요일$|(?:다음|이번|담|차|저번|지난|다다음)\s*주$|주말$|오전|오후|저녁|아침|낮|밤|이따|나중/.test(n);   // 움직씨 꼴은 끝 글자로만(「정하나」 통과) · 「서」 끝은 안 봄(김민서·박서준 · 「늦어서」는 DEP_STOP) · 때 말 = 빈칸(워커3 재점검 · 「주」는 다음주·이번주 꼴만 = 김민주·이은주 살림)
    // ① 「입금자/입금자명(은/는/:)」 뒤 = 띄어쓰기만 있어도 이름 ② 「입금(은/는) ○○」 = 꼬리(으로·로·이름으로·명의로·입니다·이에요·예요) 있을 때만 ③ 「○○(님) 이름으로/명의로/으로/로 입금」
    const pats = [/입금자(?:명)?\s*(?:은|는|:|：)?\s*([가-힣]{2,4}?)\s*님?\s*(?:으로|로|이름으로|명의로|입니다|이에요|예요|(?=[\s.,!~]|$))/g,
        /입금(?!자)\s*(?:은|는)?\s*([가-힣]{2,4}?)\s*님?\s*(?:이름으로|명의로|으로|로|입니다|이에요|예요)/g,
        /(?<![가-힣])([가-힣]{2,4}?)\s*님?\s*(?:이름으로|명의로|으로|로)\s*입금/g];
    for (const re of pats) { let m; while ((m = re.exec(t))) { if (!bad(m[1])) return m[1]; } }
    return '';
}
function cashFromAi(x, opt) {
    const o = opt || {}, sms = o.smsPhone ? core.fmtPhone(o.smsPhone) : '';
    const sender = s(x.sender, 30).trim(), buyer = s(x.buyer, 30).trim(), dep = sender ? '' : depositName(o.text);
    const who = sender || dep;
    const c0 = who ? (/드림$/.test(who) ? who : who + ' 드림') : (buyer ? buyer + '(제주아꼼이네)' : '제주아꼼이네');
    const buyerPhone = sms || x.buyer_phone || x.phone1;
    return { kind: 'cash', src: 'ai', ship_date: isDay(x.date) ? x.date : null,
        cells: [c0 + '!',x.sender_phone || (sms || x.buyer_phone) || '', '', x.recv, x.option, x.qty == null ? '' : String(x.qty), x.phone1, x.phone2, x.addr, x.memo, buyerPhone || '', '', x.sender_addr] };
}
// 사람이 붙인·고친 현금 줄(규칙·저장)에도 문자 출처면 빈 구매자·보내는사람 번호만 채움(적힌 값은 그대로)
function applySms(rows, smsPhone) {
    if (!smsPhone) return rows;
    const p = core.fmtPhone(smsPhone);
    (rows || []).forEach(r => { if (r && r.kind === 'cash' && Array.isArray(r.cells)) { if (!String(r.cells[10] || '').trim()) r.cells[10] = p; if (!String(r.cells[1] || '').trim()) r.cells[1] = p; } });
    return rows;
}

// #850-d 판매처 확인 표시 = { plat: 네이버|쿠팡|자사몰, as: buyer|recv|order, at: ISO } 꼴만 · 그 밖 값·칸은 버림(이름·주소·번호 안 받음)
function cleanChecked(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (!['네이버', '쿠팡', '자사몰'].includes(v.plat) || !['buyer', 'recv', 'order'].includes(v.as)) return null;
    const t = Date.parse(String(v.at || '')); const at = Number.isFinite(t) && t > Date.parse('2026-01-01') && t < Date.now() + 86400e3 ? new Date(t).toISOString() : new Date().toISOString();
    return { plat: v.plat, as: v.as, at };
}
// ── 최종발주용 고르기(순수 · 검증이 그대로 부름) ──
function pickForShip(rows, date) {
    const lines = [], cash = [], waiting = [], held = [];
    for (const r of rows) {
        if (r.state !== 'open') continue;
        const sd = r.ship_date ? String(r.ship_date).slice(0, 10) : null;
        if (!r.sure) { held.push({ id: r.id, kind: r.kind, why: r.check_why || [] }); continue; }
        if (r.kind === 'line') lines.push({ id: r.id, line: r.line, ship_date: sd, checked: r.checked || null, state: !sd ? 'nodate' : sd === date ? 'today' : sd > date ? 'wait' : 'past' });
        else if (!sd || sd === date) cash.push(r);
        else if (sd > date) waiting.push({ id: r.id, kind: 'cash', ship_date: sd });
        else held.push({ id: r.id, kind: 'cash', why: ['지난 날짜예요'] });
    }
    return { date, memo_text: lines.map(l => l.line).join('\n'), lines,
        cash_aoa: cash.length ? [core.HEADERS.slice(), ...cash.map(r => { const c = r.cells.slice(0, 13); if (!String(c[1] || '').trim() && String(c[10] || '').trim()) c[1] = c[10]; if (/[!！]/.test(String(c[0] || ''))) c[0] = cashSender(c[0]); return c; })]   /* #858 이미 저장된 줄도 B 빈칸 = K · #863 앞 「!」 → 뒤(입력삭제 주소 줄 = 「!」 없음 = 그대로) */ : [], cash_ids: cash.map(r => r.id),
        cash_service: cash.filter(r => r.service).map(r => r.id),   // #900 서비스 줄(A칸은 이미 「!」 = 현금 꼴) — 최종발주 대조·짝에서 뺄 줄
        waiting, held, ids: lines.map(l => l.id).concat(cash.map(r => r.id)) };
}
// 비우기 대상(순수): used_on = date 인 열린 줄 · 미래 날짜 메모 줄은 남김 · all = 열린 줄 전부
function pickClear(rows, date, all) {
    return rows.filter(r => r.state === 'open' && (all || (r.used_on && String(r.used_on).slice(0, 10) === date && !(r.kind === 'line' && r.ship_date && String(r.ship_date).slice(0, 10) > date)))).map(r => r.id);
}

// ── AI(남은 글만 한 번) ──
const AI_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['lines', 'cash', 'unsure', 'sms_draft'],
    properties: {
        lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'note', 'plat', 'date'],
            properties: { key: { type: 'string' }, note: { type: 'string' }, plat: { type: 'string' }, date: { type: 'string' } } } },
        cash: { type: 'array', items: { type: 'object', additionalProperties: false,
            required: ['buyer', 'buyer_phone', 'recv', 'phone1', 'phone2', 'addr', 'option', 'qty', 'memo', 'sender', 'sender_phone', 'sender_addr', 'date'],
            properties: { buyer: { type: 'string' }, buyer_phone: { type: 'string' }, recv: { type: 'string' }, phone1: { type: 'string' }, phone2: { type: 'string' }, addr: { type: 'string' },
                option: { type: 'string' }, qty: { type: 'integer' }, memo: { type: 'string' }, sender: { type: 'string' }, sender_phone: { type: 'string' }, sender_addr: { type: 'string' }, date: { type: 'string' } } } },
        unsure: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'why'], properties: { text: { type: 'string' }, why: { type: 'string' } } } },
        sms_draft: { type: 'string' },
    },
};
const AI_SYSTEM = [
    '너는 제주아꼼이네(제주 과일 농장 직판) 발주 메모 정리 담당이다. 직원이 붙여 넣은 발주 메모를 두 가지로 나눈다.',
    '1) lines = 이미 들어온 온라인 주문에 대한 지시. key = 구매자 전화번호(하이픈 포함 그대로) 또는 상품주문번호. note = 「입력o삭제x」(개별발송·입력삭제) · 「S사이즈로」(2S·S·M 만) · 「보내는이 홍길동」 같은 짧은 지시. plat = 네이버·쿠팡·자사몰 중 적힌 것(없으면 ""). date = 지정 발송일 YYYY-MM-DD(없으면 "").',
    '2) cash = 주문이 없는 현금 손님(「현금」「계좌이체」「현금파일」 또는 이름·주소·품목이 다 적힌 손님). buyer = 주문한 분 · recv·phone1·addr = 받는 분 · option = 아래 「품목 이름 목록」 글자 그대로 하나(목록에 없으면 "") · qty = 박스 수(없으면 0) · memo = 기사님께 전할 말(문 앞·경비실 등만 · 우리에게 한 말은 넣지 않음) · sender/sender_phone/sender_addr = 보내는이를 바꿔 달라는 경우만 · 「입금 ○○으로 했어요」「○○ 이름으로 입금」처럼 입금자 이름이 있으면 현금건이니 sender = 그 이름(대표 확정) · 문자 대화에서 온 글이면 buyer_phone 은 "" 로 둔다(서버가 문자 온 손님 번호로 채움) · 받는 분·주소·연락처 중 하나라도 있으면 품목·수량이 없어도 cash 로 넣고 option ""·qty 0 으로 둔다(unsure 로 돌리지 않음 · 직원이 채움) · 할 일(사이즈·입력삭제·날짜·보내는이) 없는 lines 는 만들지 않는다.',
    '절대 지킬 것: 메모에 없는 이름·번호·주소·날짜를 지어내지 않는다(모르면 ""). 글자는 메모에 적힌 그대로 옮긴다. 품목은 목록 글자 그대로만. 애매하거나 둘 중 무엇인지 모르면 unsure 에 그 글과 이유를 넣는다.',
    '날짜: 우리 발송일은 shipDays 에 있는 날뿐(토요일·발송휴무일 없음). 「○일 발송/보내주세요」 = 그날. 「○일 도착/받고 싶다/까지」 = 도착 희망일 이틀 전(그날이 발송 없는 날이거나 지났으면 하루 전 · 둘 다 안 되면 unsure). 범위(「12~13일 도착」) = 첫 날짜 하루 전. 「○일 배송」처럼 발송인지 도착인지 모르는 말·지난 날짜·요일과 날짜가 안 맞음 = unsure.',
    'sms_draft = cash 손님의 받는 분·주소·연락처·품목·수량 중 빈 것이 있을 때만, 손님께 물어볼 짧은 존댓말 문자 한 개(「안녕하세요 제주아꼼이네입니다.」로 시작 · 이모지 없음). 빈 것이 없으면 "".',
].join('\n');

function mount(app, deps) {
    const { pool, authMiddleware, writeAudit, adminActor, handleErr, cfgGet, kstToday, shipCal, anthropic, noTimers } = deps;
    const deskAlive = typeof deps.deskAlive === 'function' ? deps.deskAlive : async () => false;
    const actorName = req => `${req.user.name}${req.user.position ? ' ' + req.user.position : ''}`;
    const err = (status, message) => Object.assign(new Error(message), { status });
    const audit = (req, action, id, after) => writeAudit({ action, targetType: 'order_memo', targetId: id || null, changes: { after }, source: 'order_memo', actor: adminActor(req) }).catch(() => {});

    let ready = null;
    const ensure = () => ready || (ready = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS order_memo_entries (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT, created_by_id INTEGER,
            raw TEXT NOT NULL, tags TEXT[] NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'manual')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS order_memo_rows (id SERIAL PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES order_memo_entries(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, ship_date DATE, line_key TEXT, note TEXT, plat TEXT, line TEXT, cells JSONB,
            sure BOOLEAN NOT NULL DEFAULT false, check_why JSONB NOT NULL DEFAULT '[]', src TEXT NOT NULL DEFAULT 'rule',
            used_on DATE, state TEXT NOT NULL DEFAULT 'open', cleared_at TIMESTAMPTZ, cleared_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS order_memo_rows_state ON order_memo_rows (state, entry_id)`);
        await pool.query(`ALTER TABLE order_memo_rows ADD COLUMN IF NOT EXISTS checked JSONB`);   // #850-d 판매처 확인 표시 {plat, as, at}(개인정보 없음)
        await pool.query(`ALTER TABLE order_memo_rows ADD COLUMN IF NOT EXISTS addr_ok JSONB`);
        await pool.query(`ALTER TABLE order_memo_rows ADD COLUMN IF NOT EXISTS service BOOLEAN NOT NULL DEFAULT false`);   // #900 서비스(주문과 별개인 현금건 · A칸 「!」 꼴)   // #880-b 현금 줄 주소 「이대로 둘게요」 {raw, at, by_name} · raw = 그때 배송지 글(바뀌면 화면이 무효로 봄)
    })().catch(e => { ready = null; throw e; }));
    ensure().catch(e => console.error('[발주 메모함] 표 만들기 실패(다음 요청 때 다시):', e.message));

    async function cfg() {
        let v = null; try { v = await cfgGet('order_memo'); } catch (_) { /* 기본값 */ }
        const o = v && typeof v === 'object' ? v : {};
        const ai = Object.assign({}, DEFAULTS.ai, o.ai && typeof o.ai === 'object' ? o.ai : {});
        const keep = Number.isInteger(o.keep_days) && o.keep_days >= 1 && o.keep_days <= 365 ? o.keep_days : DEFAULTS.keep_days;
        const ud = Number.isInteger(o.unsure_days) && o.unsure_days >= 7 && o.unsure_days <= 365 ? o.unsure_days : DEFAULTS.unsure_days;
        return { keep_days: keep, unsure_days: ud, origin_addr: typeof o.origin_addr === 'string' && o.origin_addr.trim() ? o.origin_addr.trim() : DEFAULTS.origin_addr, ai };
    }
    async function catalogSet(date) {
        const r = await pool.query(`SELECT items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date`, [date]);
        const set = new Set(); r.rows.forEach(row => (row.items || []).forEach(it => { if (it && it.name) set.add(String(it.name)); }));
        return set;
    }
    const ctxOf = async () => { const today = kstToday(); const c = await cfg(); return { today, catalog: await catalogSet(today), origin: c.origin_addr, cfg: c }; };

    async function callAi(text, tags, ctx) {
        const c = ctx.cfg.ai;
        if (!c.enabled) return { used: false, why: '꺼짐' };
        if (!anthropic) return { used: false, why: 'AI 열쇠 없음' };
        let cal = null; try { cal = await shipCal(); } catch (_) { /* 달력 없이 */ }
        const names = [...ctx.catalog].slice(0, 300);
        const wd = '일월화수목금토'[new Date(ctx.today + 'T00:00:00Z').getUTCDay()];
        const user = `오늘 ${ctx.today}(${wd})\nshipDays ${(cal && cal.shipDays || []).join(', ') || '(모름)'}\n꼬리표 ${(tags || []).join(', ') || '없음'}\n\n품목 이름 목록:\n${names.join('\n')}\n\n발주 메모:\n${text}`;
        const t0 = Date.now();
        try {
            const msg = await anthropic.messages.create({
                model: c.model, max_tokens: 8000,
                output_config: { effort: c.effort || 'low', format: { type: 'json_schema', schema: AI_SCHEMA } },
                system: [{ type: 'text', text: AI_SYSTEM, cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: user }],
            });
            const info = { used: true, model: c.model, ms: Date.now() - t0, in_tokens: msg.usage && msg.usage.input_tokens, out_tokens: msg.usage && msg.usage.output_tokens };
            if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return Object.assign(info, { used: false, why: '실패: ' + msg.stop_reason });
            const txt = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
            return Object.assign(info, { data: JSON.parse(txt) });
        } catch (e) { return { used: false, why: '실패: ' + String(e.status || '') + ' ' + String(e.message || e).slice(0, 80) }; }
    }

    // AI 결과(창구·직접 같은 꼴 = AI_SCHEMA) → 줄 · 서버가 다시 검사(창구 답도 그대로 믿지 않음)
    function aiDataToRows(d, ctx, extraKeys, opt) {
        const raw = [];
        (Array.isArray(d && d.lines) ? d.lines : []).slice(0, MAX_ROWS).filter(x => x && (String(x.note || '').trim() || isDay(x.date))).forEach(x => raw.push(   // #850-g 할 일 없는(비고·날짜 없는) 메모 줄은 안 만듦
            { kind: 'line', key: x && x.key, note: x && x.note, plat: x && x.plat, ship_date: x && isDay(x.date) ? x.date : null, src: 'ai' }));
        (Array.isArray(d && d.cash) ? d.cash : []).slice(0, MAX_ROWS).forEach(x => raw.push(cashFromAi(x || {}, opt)));
        const rows = markIndiv(raw, extraKeys).map(r => checkRow(r, ctx));
        const un = (Array.isArray(d && d.unsure) ? d.unsure : []).filter(x => x && x.text);
        let sms = s(d && d.sms_draft, 400).trim();
        if (!sms && rows.some(r => r.kind === 'cash' && r.missing.length)) sms = '안녕하세요 제주아꼼이네입니다. 보내 드릴 받는 분 성함·주소·연락처를 알려 주시면 바로 준비해 드릴게요.';
        return { rows, leftover: un.map(x => `${s(x.text, 300)} — ${s(x.why, 100)}`).join('\n'), sms_draft: sms };
    }
    // 대표 요금제 계정 = 창구 launcher.js subscriptionUsers 와 같은 기준(설정 desk_subscription_users {ids} · 없으면 username 'admin' 한 명) · 5분 캐시
    let subIds = null, subAt = 0;
    async function isSubUser(uid) {
        if (!subIds || Date.now() - subAt > 300000) {
            try {
                const c = await cfgGet('desk_subscription_users');
                subIds = c && Array.isArray(c.ids) && c.ids.length ? new Set(c.ids.map(Number))
                    : new Set((await pool.query(`SELECT id FROM users WHERE username = 'admin' AND deleted_at IS NULL`)).rows.map(r => Number(r.id)));
            } catch (_) { subIds = subIds || new Set(); }
            subAt = Date.now();
        }
        return subIds.has(Number(uid));
    }
    // 규칙 줄은 즉시 · 남은 글은 ①설정 direct = 서버 AI ②창구 켜짐 = 창구 요청 줄(화면이 GET /preview/:id 로 기다림) ③창구 꺼짐 = 남은 글 그대로
    // #850-b 문자 출처(source 'sms:<id>') 손님 번호 = 화면이 보낸 번호(숫자 9~12 · 0 시작) → 없으면 sms_threads.phone_digits 읽기만 · 문자 아님 = ''
    async function smsPhoneOf(source, phone) {
        const m = /^sms:(\d{1,12})$/.exec(String(source || '')); if (!m) return '';
        const d = dg(phone); if (/^0\d{8,11}$/.test(d)) return d;
        try { const r = (await pool.query(`SELECT phone_digits FROM sms_threads WHERE id = $1`, [Number(m[1])])).rows[0]; const t = dg(r && r.phone_digits); return /^0\d{8,11}$/.test(t) ? t : ''; } catch (_) { return ''; }
    }
    async function preview(raw, tags, ctx, req, smsPhone) {
        const rows = [], rest = [];
        // #850-g(대표 폰 실사고) 받는 분·주소·입금 단서가 있는 줄 = 현금 손님 글 → 메모 줄 규칙이 집지 않고 AI(창구)로(엑셀 13칸 붙여넣기는 규칙) ·
        //   🔴 「번호 입력o삭제x」 같은 주문 지시 줄은 그대로 규칙(같은 묶음의 개별 주소를 주소 줄로 짝짓는 #850 워커3 시험 ① 이 그 줄에 기댐)
        for (const ln of raw.split('\n')) { const r = CASH_CUE.test(ln) && ln.split('\t').length < 9 ? null : ruleLine(ln, ctx.today); if (r) rows.push(r); else if (ln.trim()) rest.push(ln); }
        const ruleRows = markIndiv(applySms(rows, smsPhone)).map(r => checkRow(r, ctx));
        const ruleKeys = [...indivKeysOf(ruleRows).values()];   // 규칙으로 읽은 입력삭제 줄 번호 → AI 현금 줄이 그 주문의 주소 줄인지 가를 때
        const base = { rows: ruleRows, leftover: '', rule_count: ruleRows.length, ai_count: 0, ai: { used: false, why: '남은 글 없음' }, sms_draft: '', desk: null };
        if (!rest.length) return base;
        const text = rest.join('\n');
        if (!ctx.cfg.ai.enabled) return Object.assign(base, { leftover: text, ai: { used: false, why: '꺼짐' } });
        // 「섞기」(#850 점검 d · 준비만 · 기본 꺼짐) = staff_direct true 면 대표 요금제 계정(desk_subscription_users)만 창구 · 그 밖 계정은 서버 직접(창구 콘솔 1회 ≈ 400~800원 대신)
        const staffDirect = ctx.cfg.ai.staff_direct === true && !(await isSubUser(req.user.id));
        if (ctx.cfg.ai.direct || staffDirect) {
            const ai = await callAi(text, tags, ctx);
            ai.via = ctx.cfg.ai.direct ? 'direct' : 'staff_direct';
            if (!ai.data) return Object.assign(base, { leftover: text, ai });
            const x = aiDataToRows(ai.data, ctx, ruleKeys, { smsPhone, text: raw }); delete ai.data;
            return Object.assign(base, { rows: ruleRows.concat(x.rows), ai_count: x.rows.length, leftover: x.leftover, sms_draft: x.sms_draft, ai });
        }
        let alive = false; try { alive = await deskAlive(); } catch (_) { alive = false; }
        if (!alive) return Object.assign(base, { leftover: text, ai: { used: false, why: '창구 꺼짐' }, desk: { state: 'off', message: '창구가 꺼져 있어 지금은 규칙으로만 정리했어요 · 남은 글은 직접 채워 주세요' } });
        let cal = null; try { cal = await shipCal(); } catch (_) { /* 달력 없이 */ }
        const payload = { type: 'order_memo', today: ctx.today, shipDays: (cal && cal.shipDays) || [], tags: tags || [], catalog: [...ctx.catalog].slice(0, 300), text, indiv_keys: ruleKeys, sms_phone: smsPhone || '', from_sms: !!smsPhone, raw_hint: depositName(raw) };   // sms_phone·raw_hint = 기다리기 결과에 쓸 문자 번호·입금자명(#850-b)
        const row = (await pool.query(`INSERT INTO pending_orders (content, payload, created_by, created_by_id, status, mine_hidden) VALUES ($1, $2, $3, $4, '대기', true) RETURNING id`,
            [`${DESK_PREFIX} 남은 글 ${rest.length}줄`, JSON.stringify(payload), actorName(req), req.user.id || null])).rows[0];
        await audit(req, 'desk_request', row.id, { lines: rest.length });
        return Object.assign(base, { ai: { used: true, via: 'desk' }, desk: { state: 'wait', id: row.id, wait_sec: DESK_WAIT_SEC } });
    }
    async function deskRow(req) {
        if (!/^\d{1,9}$/.test(String(req.params.id))) throw err(404, '없는 요청이에요');
        const r = (await pool.query(`SELECT id, status, result, payload, created_by_id, content FROM pending_orders WHERE id = $1 AND is_deleted = false`, [Number(req.params.id)])).rows[0];
        if (!r || !String(r.content || '').startsWith(DESK_PREFIX)) throw err(404, '없는 요청이에요');
        if (req.user.role !== 'admin' && Number(r.created_by_id) !== Number(req.user.id)) throw err(403, '내가 올린 요청만 볼 수 있어요');
        return r;
    }

    const rowOut = r => ({ id: r.id, entry_id: r.entry_id, kind: r.kind, ship_date: r.ship_date ? String(r.ship_date instanceof Date ? r.ship_date.toISOString() : r.ship_date).slice(0, 10) : null,
        key: r.line_key, note: r.note, plat: r.plat, line: r.line, cells: r.cells, sure: r.sure, check_why: r.check_why || [], src: r.src,
        missing: r.kind === 'cash' ? Object.keys(REQ_CELLS).map(Number).filter(i => !(r.cells || [])[i]) : ((!r.line_key || /^0+$/.test(dg(r.line_key)) || dg(r.line_key) === '01000000000' || (dg(r.line_key).length < 8 && !/\d{8,}/.test(r.line_key))) ? ['key'] : []),
        state: r.state, used_on: r.used_on ? String(r.used_on instanceof Date ? r.used_on.toISOString() : r.used_on).slice(0, 10) : null,
        cleared_at: r.cleared_at, cleared_by: r.cleared_by, updated_at: r.updated_at, updated_by: r.updated_by, checked: r.kind === 'line' ? (r.checked || null) : null,
        addr_ok: r.kind === 'cash' ? (r.addr_ok && typeof r.addr_ok === 'object' ? r.addr_ok : null) : undefined,   // #880-b 현금 줄만(파일·for-ship 엔 안 나감)
        indiv: r.kind === 'cash' ? !/[!！]/.test(String((r.cells || [])[0] || '')) : undefined,
        service: r.kind === 'cash' ? !!r.service : undefined,   // #900 서비스 줄(indiv = false · 화면 알약 「서비스」)   // cash: true = 입력삭제 주문의 주소 줄 · false = 현금 손님
        stale: !r.sure && r.state === 'open' && !!r.updated_at && (Date.now() - new Date(r.updated_at).getTime()) > STALE_DAYS * 86400e3 });   // #850 점검 c 「오래된 확인」(7일 넘게 안 고친 🟠)
    const ROW_COLS = `id, entry_id, kind, to_char(ship_date, 'YYYY-MM-DD') AS ship_date, line_key, note, plat, line, cells, sure, check_why, src, checked, addr_ok, service, to_char(used_on, 'YYYY-MM-DD') AS used_on, state, cleared_at, cleared_by, updated_at, updated_by`;
    const saveVals = (r) => [r.kind, r.ship_date, r.kind === 'line' ? r.key : null, r.kind === 'line' ? r.note : null, r.kind === 'line' ? r.plat : null, r.kind === 'line' ? r.line : null,
        r.kind === 'cash' ? JSON.stringify(r.cells) : null, r.sure, JSON.stringify(r.check_why), r.src];
    async function getRow(id) {
        if (!/^\d{1,9}$/.test(String(id))) throw err(404, '없는 줄이에요');
        const r = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE id = $1`, [Number(id)])).rows[0];
        if (!r) throw err(404, '없는 줄이에요');
        return r;
    }

    const rate = new Map();
    const wrap = fn => async (req, res) => { try { await ensure(); await fn(req, res); } catch (e) { handleErr(res, e); } };

    app.post('/api/order-memo/preview', authMiddleware, wrap(async (req, res) => {
        const raw = s(req.body && req.body.raw, MAX_RAW + 1);
        if (!raw.trim()) throw err(400, '정리할 글이 없어요');
        if (raw.length > MAX_RAW) throw err(400, `글이 너무 길어요(${MAX_RAW}자까지)`);
        const now = Date.now(), k = req.user.id || req.user.name, b = (rate.get(k) || []).filter(t => now - t < 60000);
        if (b.length >= PREVIEW_PER_MIN) throw err(429, '잠시 뒤 다시 해 주세요');
        b.push(now); rate.set(k, b); if (rate.size > 500) rate.clear();
        const tags = (Array.isArray(req.body.tags) ? req.body.tags : []).filter(t => /^(cash|indiv|size|date|sender)$/.test(t)).slice(0, 5);
        const out = await preview(raw, tags, await ctxOf(), req, await smsPhoneOf(req.body.source, req.body.phone));
        res.json(Object.assign({ ok: true }, out));
    }));

    // 창구 정리 기다리기(최종발주 memo-read GET/DELETE 와 같은 꼴) — done 이면 줄로 바꿔 줌 · 화면은 받은 뒤 DELETE(손님 글 서버에 안 남김)
    app.get('/api/order-memo/preview/:id', authMiddleware, wrap(async (req, res) => {
        const r = await deskRow(req), rs = r.result || {};
        const state = r.status === '완료' ? 'done' : ['대기', '처리중', '승인됨'].includes(r.status) ? 'wait' : 'fail';
        const text = r.payload && typeof r.payload.text === 'string' ? r.payload.text : '';
        if (!r.payload) return res.json({ ok: true, state: 'fail', leftover: '', message: '그만둔 요청이에요 — 다시 [정리하기] 를 눌러 주세요' });   // #850 점검 a · 받은 뒤·그만둔 뒤엔 창구가 늦게 답해도 안 내줌
        if (state === 'wait') return res.json({ ok: true, state, status: r.status });
        if (state === 'done' && rs.data && typeof rs.data === 'object') { const x = aiDataToRows(rs.data, await ctxOf(), Array.isArray(r.payload.indiv_keys) ? r.payload.indiv_keys.slice(0, 60) : [], { smsPhone: dg(r.payload.sms_phone), text: r.payload.raw_hint ? '입금 ' + r.payload.raw_hint + '으로 했어요' : r.payload.text }); return res.json({ ok: true, state, rows: x.rows, ai_count: x.rows.length, leftover: x.leftover, sms_draft: x.sms_draft }); }
        res.json({ ok: true, state: 'fail', leftover: text, message: state === 'done' ? '창구 답에 정리 결과가 없어요 — 남은 글은 직접 채워 주세요' : String(rs.error || rs.question || rs.notice || rs.answer || '창구가 처리하지 못했어요').slice(0, 300) });
    }));
    app.delete('/api/order-memo/preview/:id', authMiddleware, wrap(async (req, res) => {
        const r = await deskRow(req);
        await pool.query(`UPDATE pending_orders SET payload = NULL, result = CASE WHEN result IS NULL THEN NULL ELSE result - 'data' END, status = CASE WHEN status = '대기' THEN '취소' ELSE status END, processed_at = COALESCE(processed_at, NOW()) WHERE id = $1`, [r.id]);
        res.json({ ok: true });
    }));

    app.post('/api/order-memo', authMiddleware, wrap(async (req, res) => {
        const raw = s(req.body && req.body.raw, MAX_RAW).trim();
        const src = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
        if (!src.length) throw err(400, '저장할 줄이 없어요');
        if (src.length > MAX_ROWS) throw err(400, `한 번에 ${MAX_ROWS}줄까지예요`);
        const tags = (Array.isArray(req.body.tags) ? req.body.tags : []).filter(t => /^(cash|indiv|size|date|sender)$/.test(t)).slice(0, 5);
        const source = /^(manual|photo|sms:\d{1,12})$/.test(String(req.body.source || '')) ? String(req.body.source) : 'manual';
        const ctx = await ctxOf();
        const rows = markIndiv((src.map(r => ({ kind: r && r.kind === 'cash' ? 'cash' : 'line', key: r && r.key, note: r && r.note, plat: r && r.plat, line: r && r.line, cells: r && r.cells,
            ship_date: r && r.ship_date, src: r && (r.src === 'rule' || r.src === 'ai') ? r.src : 'edit', _bad: [], _checked: r && r.kind !== 'cash' ? cleanChecked(r.checked) : null,
            service: !!(r && r.kind === 'cash' && r.service === true), no_indiv: !!(r && r.kind === 'cash' && r.no_indiv === true) })))).map(r => Object.assign(checkRow(r, ctx), { checked: r._checked, service: r.service }));   // #900 service·no_indiv = markIndiv 건너뜀   // 같은 저장 묶음의 입력삭제 줄 ↔ 현금 줄 = 주소 줄 · 문자 번호 채우기는 미리보기 때만(워커3 점검) · checked = 판매처 확인 표시(#850-d)
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const e = (await client.query(`INSERT INTO order_memo_entries (created_by, created_by_id, raw, tags, source) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [actorName(req), req.user.id || null, raw || '(줄만 저장)', tags, source])).rows[0];
            const saved = [];
            for (const r of rows) {
                saved.push((await client.query(`INSERT INTO order_memo_rows (entry_id, kind, ship_date, line_key, note, plat, line, cells, sure, check_why, src, updated_by, checked, service)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING ${ROW_COLS}`, [e.id, ...saveVals(r), actorName(req), r.checked ? JSON.stringify(r.checked) : null, !!r.service])).rows[0]);
            }
            await client.query('COMMIT');
            await audit(req, 'create', e.id, { rows: rows.length, line: rows.filter(r => r.kind === 'line').length, cash: rows.filter(r => r.kind === 'cash').length, unsure: rows.filter(r => !r.sure).length, source: source.replace(/:\d+$/, '') });
            res.json({ ok: true, entry_id: e.id, rows: saved.map(rowOut) });
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    }));

    app.get('/api/order-memo', authMiddleware, wrap(async (req, res) => {
        const state = req.query.state === 'cleared' ? 'cleared' : 'open';
        const c = await cfg(), today = kstToday();
        const rows = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = $1 ${state === 'cleared' ? `AND cleared_at > NOW() - ($2::int * INTERVAL '1 day')` : ''} ORDER BY id`,
            state === 'cleared' ? [state, c.keep_days] : [state])).rows;
        const ids = [...new Set(rows.map(r => r.entry_id))];
        const ents = ids.length ? (await pool.query(`SELECT id, created_at, created_by, source, tags, raw FROM order_memo_entries WHERE id = ANY($1::int[]) ORDER BY id DESC${state === 'open' ? '' : ' LIMIT ' + LIST_MAX}`, [ids])).rows : [];   // #900-2A 열린 줄 묶음 = 전부
        const by = new Map(ents.map(e => [e.id, Object.assign(e, { rows: [] })]));
        rows.forEach(r => { const e = by.get(r.entry_id); if (e) e.rows.push(rowOut(r)); });
        const open = state === 'open' ? rows : (await pool.query(`SELECT kind, sure, to_char(ship_date, 'YYYY-MM-DD') AS ship_date FROM order_memo_rows WHERE state = 'open'`)).rows;
        const nCleared = state === 'cleared' ? rows.length : Number((await pool.query(`SELECT COUNT(*)::int AS n FROM order_memo_rows WHERE state = 'cleared' AND cleared_at > NOW() - ($1::int * INTERVAL '1 day')`, [c.keep_days])).rows[0].n);
        // ship_date = 다음 최종발주 기준 발송일(최종발주 suggested 와 같은 계산 · 달력 실패면 null) · next = 그날 for-ship 에 들어갈 줄 수(「지금 챙길 일」 한 줄)
        let next = null; try { const cal = await shipCal(); next = cal && isDay(cal.suggested) ? cal.suggested : null; } catch (_) { /* 달력 없이 */ }
        const base = next || today;
        const nNext = pickForShip(state === 'open' ? rows : (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open'`)).rows, base).ids.length;
        res.json({ ok: true, keep_days: c.keep_days, ship_date: next, entries: [...by.values()],
            counts: { open: open.length, unsure: open.filter(r => !r.sure).length, stale: state === 'open' ? rows.map(rowOut).filter(r => r.stale).length : 0, wait: open.filter(r => r.sure && r.ship_date && r.ship_date > base).length, next: nNext, cleared: nCleared } });
    }));

    app.put('/api/order-memo/rows/:id', authMiddleware, wrap(async (req, res) => {
        const cur = await getRow(req.params.id);
        if (cur.state !== 'open') throw err(409, '비운 줄이에요 — 되살린 뒤 고쳐 주세요');
        const b = req.body || {}, ctx = await ctxOf();
        const svc = cur.kind === 'cash' && typeof b.service === 'boolean' ? b.service : (cur.kind === 'cash' ? !!cur.service : false);   // #900 서비스 켜고 끄기(없으면 그대로)
        if (cur.kind === 'cash' && svc && !cur.service && /[!！]/.test(String((cur.cells || [])[0] || ''))) throw err(400, '현금 손님 줄은 서비스 표시가 필요 없어요');
        const next = cur.kind === 'cash'
            ? { kind: 'cash', cells: Array.isArray(b.cells) ? b.cells : cur.cells, ship_date: 'ship_date' in b ? b.ship_date : cur.ship_date, src: 'edit', indiv: svc !== !!cur.service ? !svc : !/[!！]/.test(String((cur.cells || [])[0] || '')) }   // #900 서비스 켬 = 현금 꼴(「!」) · 끔 = 주소 줄   // 고치기 = 주소 줄/현금 손님 구분 그대로
            : { kind: 'line', key: 'key' in b ? b.key : cur.line_key, note: 'note' in b ? b.note : cur.note, plat: 'plat' in b ? b.plat : cur.plat, ship_date: 'ship_date' in b ? b.ship_date : cur.ship_date, src: 'edit', _bad: [] };
        if ('ship_date' in b && b.ship_date !== null && !isDay(b.ship_date)) throw err(400, '날짜는 YYYY-MM-DD 로 주세요');
        const r = checkRow(next, ctx);
        let checked = null;   // #850-d 판매처 확인 표시 — 메모 줄만 · 번호(숫자)나 판매처가 바뀌면 비움(같은 요청에 새 값이 오면 그것) · 안 바뀌면 칸이 올 때만 바꿈
        if (cur.kind === 'line') { const moved = dg(r.key) !== dg(cur.line_key) || String(r.plat || '') !== String(cur.plat || ''); checked = 'checked' in b ? cleanChecked(b.checked) : (moved ? null : (cur.checked || null)); }
        const row = (await pool.query(`UPDATE order_memo_rows SET kind=$2, ship_date=$3, line_key=$4, note=$5, plat=$6, line=$7, cells=$8, sure=$9, check_why=$10, src=$11, updated_at=NOW(), updated_by=$12, checked=$13, service=$14
            WHERE id=$1 AND state='open' RETURNING ${ROW_COLS}`, [cur.id, ...saveVals(r), actorName(req), checked ? JSON.stringify(checked) : null, svc])).rows[0];
        if (!row) throw err(409, '방금 다른 사람이 바꿨어요 — 새로 고쳐 주세요');
        let paired = 0, rekeyed = 0;
        // #867 입력삭제 줄 번호를 고치기로 바꿈(예: 받는 분 번호 → 구매자 번호) = 같은 묶음(entry) 열린 짝 주소 줄(「!」 없음 · K = 옛 번호)의 K 를 새 번호로
        //   B 는 K 와 같은 옛 번호일 때만(K 를 따라 채운 값) · 사람이 따로 넣은 B(보내는이 변경 번호) = 그대로 · 아래 #850-a 날짜 짝이 새 번호로 찾도록 먼저
        if (r.kind === 'line' && isIndivLine(r) && INDIV.test(String(cur.note || '') + ' ' + String(cur.line || '')) && dg(cur.line_key).length >= 8 && dg(r.key) !== dg(cur.line_key)) {
            const oldK = dg(cur.line_key), newK = String(r.key).trim();
            const sibs = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open' AND kind = 'cash' AND entry_id = $1`, [cur.entry_id])).rows;
            for (const c0 of sibs) {
                const c = Array.isArray(c0.cells) ? c0.cells.slice() : [];
                if (/[!！]/.test(String(c[0] || '')) || dg(c[10]) !== oldK) continue;
                if (dg(c[1]) === oldK) c[1] = newK;
                c[10] = newK;
                const rc = checkRow({ kind: 'cash', cells: c, ship_date: c0.ship_date || null, src: c0.src, indiv: true, indivKey: newK }, ctx);
                const u = await pool.query(`UPDATE order_memo_rows SET sure=$2, check_why=$3, cells=$4, updated_at=NOW(), updated_by=$5 WHERE id=$1 AND state='open'`,
                    [c0.id, rc.sure, JSON.stringify(rc.check_why), JSON.stringify(rc.cells), actorName(req)]);
                rekeyed += u.rowCount;
            }
        }
        const oldD = cur.ship_date ? String(cur.ship_date).slice(0, 10) : null, newD = r.ship_date || null;
        if (r.kind === 'line' && isIndivLine(r) && oldD !== newD) {   // #850-a 같은 짝 계산(번호 = K칸 또는 B칸)
            const opens = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open' AND kind = 'cash' AND entry_id = $1`, [cur.entry_id])).rows;   // #868 같은 묶음만(#867 rekey 와 같은 기준 · 다른 묶음 같은 번호 주소 줄 날짜 무변경)
            for (const c0 of opens) {
                const c = c0.cells || [], sd = c0.ship_date ? String(c0.ship_date).slice(0, 10) : null;
                if (/[!！]/.test(String(c[0] || '')) || ![c[10], c[1]].map(dg).includes(dg(r.key)) || (sd && sd !== oldD)) continue;
                const rc = checkRow({ kind: 'cash', cells: c, ship_date: newD, src: c0.src, indiv: true, indivKey: r.key }, ctx);
                const u = await pool.query(`UPDATE order_memo_rows SET ship_date=$2, sure=$3, check_why=$4, cells=$5, updated_at=NOW(), updated_by=$6 WHERE id=$1 AND state='open'`,
                    [c0.id, rc.ship_date, rc.sure, JSON.stringify(rc.check_why), JSON.stringify(rc.cells), actorName(req)]);
                paired += u.rowCount;
            }
        }
        await audit(req, 'update', cur.id, { kind: r.kind, sure: r.sure, paired, rekeyed });
        res.json({ ok: true, row: rowOut(row), paired, rekeyed });
    }));

    // #874(대표 10/27) 이미 저장된 현금 손님(「!」) 줄 → 입력삭제 주소 줄로(사람이 [바꾸기]를 누를 때만 · 자동 없음)
    //   body { key, ids } = 그 번호의 열린 입력삭제 줄(가장 최근)에 짝 · 고른 줄 가운데 「!」 있고 K·B 번호가 그 번호인 줄만 · 그 줄의 묶음(entry)으로 옮김(#867·#868 짝 계산 = 같은 묶음 기준)
    //   body { undo: true, rows: [{ id, entry_id, cells, ship_date }] } = 바로 앞 짝짓기 되돌리기(응답의 undo 그대로 · 지금 「!」 없는 주소 줄일 때만)
    // #880-b(대표 10/27) 현금 줄 주소 「이대로 둘게요」 = 서버에 남김(다시 열어도·다른 직원 화면에도 「주소 확인 필요」 안 뜸)
    //   body { raw } = 화면이 본 배송지 글 · 지금 cells[8](trim)과 같을 때만 저장(다르면 409) · { undo: true } = 지움 · 열린 현금 줄만 · 주소가 나중에 바뀌면 raw 가 달라 화면이 무효로 봄(서버는 안 지움)
    app.post('/api/order-memo/rows/:id/addr-ok', authMiddleware, wrap(async (req, res) => {
        const cur = await getRow(req.params.id), b = req.body || {};
        if (cur.kind !== 'cash') throw err(400, '현금 줄만 돼요');
        if (cur.state !== 'open') throw err(409, '비운 줄이에요 — 되살린 뒤 해 주세요');
        let val = null;
        if (b.undo !== true) {
            const raw = s(b.raw, 400).trim(), now = String((cur.cells || [])[8] || '').trim();
            if (!raw || raw !== now) throw err(409, '그사이 주소가 바뀌었어요 — 새로 고친 뒤 다시 눌러 주세요');
            val = { raw, at: new Date().toISOString(), by_name: s(actorName(req), 40) };
        }
        const row = (await pool.query(`UPDATE order_memo_rows SET addr_ok=$2 WHERE id=$1 AND state='open' AND kind='cash' RETURNING ${ROW_COLS}`, [cur.id, val ? JSON.stringify(val) : null])).rows[0];
        if (!row) throw err(409, '방금 다른 사람이 바꿨어요 — 새로 고쳐 주세요');
        await audit(req, val ? 'addr_ok' : 'addr_ok_undo', cur.id, { n: 1 });
        res.json({ ok: true, row: rowOut(row) });
    }));

    // #894 F4(대표 10/27 · 「주문입력으로 개별 주소 먼저 → 입력삭제 번호 나중」이 기본 길) 짝 후보 — 읽기만
    //   GET /api/order-memo/pair-hint?key=<입력삭제 번호> → { ok, key, orders:[{plat, order_no, option, qty}], order_boxes, paired_boxes, short, need:[{opt, qty}], groups:[{entry_id, created_at, ids, boxes, items}] , src }
    //   orders = 발송 전 주문 표(order_memo_preorders · 구매자 번호 = 그 번호 · 7일) · groups = 짝 안 된 현금(「!」) 줄 묶음 가운데 품목별 박스가 남은 수와 딱 같은 것(최근 먼저 · 5개까지)
    //   화면: ② 번호로 못 찾을 때 groups 를 「이 현금 줄 묶음이 입력삭제 주소 줄인가요?」로 · ③ short > 0 이면 주소 줄이 이미 있어도 묻기 · 고르면 POST /pair { key, ids, pick: true }
    app.get('/api/order-memo/pair-hint', authMiddleware, wrap(async (req, res) => {
        if (req.user.role === 'accountant') throw err(403, '세무사 계정은 볼 수 없어요');
        const key = s(req.query.key, 40).trim(), np = PRE_LK ? PRE_LK.normalizePhone(key) : dg(key);
        if (!/^0\d{8,11}$/.test(np)) throw err(400, '입력삭제 번호(구매자 전화번호)를 주세요');
        let orders = [], src = 'memo';
        try { orders = (await pool.query("SELECT channel, order_key, product_order_no, option_text, qty FROM order_memo_preorders WHERE miss = 0 AND buyer_digits = $1 ORDER BY paid_at DESC NULLS LAST LIMIT 40", [np])).rows; }
        catch (e) { if (!/order_memo_preorders/.test(String(e.message))) throw e; src = 'none'; }
        const rows = (await pool.query(`SELECT r.id, r.entry_id, r.kind, r.cells, r.state, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS entry_created_at FROM order_memo_rows r JOIN order_memo_entries e ON e.id = r.entry_id WHERE r.state = 'open' AND r.kind = 'cash'`)).rows;
        const h = pairHint(orders.map(o => ({ option: o.option_text, qty: o.qty })), rows, np);
        res.json(Object.assign({ ok: true, key: np, src, orders: orders.map(o => ({ plat: CH_PLAT[o.channel] || o.channel, order_no: o.product_order_no || String(o.order_key || '').split('|')[0], option: o.option_text || '', qty: o.qty || 0 })) }, h));
    }));

    // #900 1-C 서비스 켜고 끄기(여러 줄 · 최종발주 카드·메모함 표) — body { ids, on } · 60줄까지 · 열린 현금 줄만
    //   on = 주소 줄(「!」 없음)을 주문과 별개인 현금건으로(A칸 「!」 꼴 · service true) · 이미 서비스·현금 손님 줄은 skipped · off = 서비스 줄을 다시 주소 줄로(「!」 뗌)
    app.post('/api/order-memo/service', authMiddleware, wrap(async (req, res) => {
        if (req.user.role === 'accountant') throw err(403, '세무사 계정은 바꿀 수 없어요');
        const b = req.body || {}, on = b.on === true, ctx = await ctxOf();
        if (typeof b.on !== 'boolean') throw err(400, 'on(true/false)을 주세요');
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 60);
        if (!ids.length) throw err(400, '바꿀 줄이 없어요');
        const cands = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE id = ANY($1::int[]) ORDER BY id`, [ids])).rows, byId = new Map(cands.map(r => [r.id, r]));
        const out = [], skipped = [];
        for (const id of ids) {
            const r0 = byId.get(id), bang = r0 && /[!！]/.test(String((r0.cells || [])[0] || ''));
            const why = !r0 ? '없는 줄' : r0.state !== 'open' ? '비운 줄' : r0.kind !== 'cash' ? '메모 줄' : on && r0.service ? '이미 서비스' : !on && !r0.service ? '서비스 아님' : on && bang ? '현금 손님 줄' : null;
            if (why) { skipped.push({ id, why }); continue; }
            const rc = checkRow({ kind: 'cash', cells: r0.cells, ship_date: r0.ship_date || null, src: r0.src, indiv: !on }, ctx);
            const row = (await pool.query(`UPDATE order_memo_rows SET cells=$2, sure=$3, check_why=$4, service=$5, updated_at=NOW(), updated_by=$6 WHERE id=$1 AND state='open' RETURNING ${ROW_COLS}`,
                [id, JSON.stringify(rc.cells), rc.sure, JSON.stringify(rc.check_why), on, actorName(req)])).rows[0];
            if (row) out.push(rowOut(row)); else skipped.push({ id, why: '방금 바뀜' });
        }
        await audit(req, on ? 'service' : 'service_off', null, { n: out.length, asked: ids.length });
        res.json({ ok: true, n: out.length, rows: out, skipped });
    }));

    app.post('/api/order-memo/pair', authMiddleware, wrap(async (req, res) => {
        const b = req.body || {}, ctx = await ctxOf();
        if (b.undo === true) {
            const list = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60);
            let n = 0;
            for (const u of list) {
                const id = Number(u && u.id), eid = Number(u && u.entry_id);
                if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(eid) || eid <= 0 || !Array.isArray(u.cells) || !/[!！]/.test(String(u.cells[0] || ''))) continue;
                const cur = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE id = $1`, [id])).rows[0];
                if (!cur || cur.state !== 'open' || cur.kind !== 'cash' || /[!！]/.test(String((cur.cells || [])[0] || ''))) continue;
                const ent = (await pool.query(`SELECT id FROM order_memo_entries WHERE id = $1`, [eid])).rows[0];
                const rc = checkRow({ kind: 'cash', cells: u.cells, ship_date: isDay(u.ship_date) ? u.ship_date : null, src: cur.src, indiv: false }, ctx);
                const x = await pool.query(`UPDATE order_memo_rows SET entry_id=$2, cells=$3, ship_date=$4, sure=$5, check_why=$6, updated_at=NOW(), updated_by=$7 WHERE id=$1 AND state='open'`,
                    [id, ent ? eid : cur.entry_id, JSON.stringify(rc.cells), rc.ship_date, rc.sure, JSON.stringify(rc.check_why), actorName(req)]);
                n += x.rowCount;
            }
            await audit(req, 'pair_undo', null, { n });
            return res.json({ ok: true, n });
        }
        const key = s(b.key, 40).trim(), d = dg(key);
        if (d.length < 8) throw err(400, '입력삭제 번호가 없어요');
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 60);
        if (!ids.length) throw err(400, '바꿀 줄이 없어요');
        const line = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open' AND kind = 'line' ORDER BY id DESC`)).rows.find(r => isIndivLine({ kind: 'line', key: r.line_key, note: r.note, line: r.line }) && dg(r.line_key) === d);
        if (!line) throw err(409, '이 번호 입력삭제 줄이 메모함에 없어요 — 입력삭제 줄을 먼저 저장해 주세요');
        const cands = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE id = ANY($1::int[]) AND state = 'open' AND kind = 'cash' ORDER BY id`, [ids])).rows;
        const out = [], undo = [];
        for (const r0 of cands) {
            const p = pairCash(r0, line, ctx, { anyNumber: b.pick === true }); if (!p) continue;   // #894 F4 pick = 후보 묶음(pair-hint groups)에서 고른 줄
            const row = (await pool.query(`UPDATE order_memo_rows SET entry_id=$2, cells=$3, ship_date=$4, sure=$5, check_why=$6, updated_at=NOW(), updated_by=$7 WHERE id=$1 AND state='open' RETURNING ${ROW_COLS}`,
                [r0.id, line.entry_id, JSON.stringify(p.cells), p.ship_date, p.sure, JSON.stringify(p.check_why), actorName(req)])).rows[0];
            if (!row) continue;
            out.push(rowOut(row)); undo.push({ id: r0.id, entry_id: r0.entry_id, cells: r0.cells, ship_date: r0.ship_date || null });
        }
        await audit(req, 'pair', line.id, { n: out.length, asked: ids.length, entry: line.entry_id });
        res.json({ ok: true, n: out.length, skipped: ids.length - out.length, rows: out, undo });
    }));

    app.delete('/api/order-memo/rows/:id', authMiddleware, wrap(async (req, res) => {
        const cur = await getRow(req.params.id);
        if (cur.state === 'cleared') return res.json({ ok: true, already: true });
        await pool.query(`UPDATE order_memo_rows SET state='cleared', cleared_at=NOW(), cleared_by=$2, updated_at=NOW(), updated_by=$2 WHERE id=$1`, [cur.id, actorName(req)]);
        await audit(req, 'clear_one', cur.id, { kind: cur.kind });
        res.json({ ok: true });
    }));

    app.post('/api/order-memo/restore/:id', authMiddleware, wrap(async (req, res) => {
        const cur = await getRow(req.params.id);
        const row = (await pool.query(`UPDATE order_memo_rows SET state='open', used_on=NULL, cleared_at=NULL, cleared_by=NULL, updated_at=NOW(), updated_by=$2 WHERE id=$1 RETURNING ${ROW_COLS}`, [cur.id, actorName(req)])).rows[0];
        await audit(req, 'restore', cur.id, { kind: cur.kind });
        res.json({ ok: true, row: rowOut(row) });
    }));

    // #850-d·e 판매처 확인 — 번호(또는 주문번호)로 발송 전 주문 찾기 · 읽기만 · 실시간 3채널 호출 없음(429)
    //   자료 ① = 메모함 전용 「발송 전 주문」 표 order_memo_preorders(#850-e · 대표 10/25 · 문자 수집기가 받아 온 행을 같이 씀 · 결제 7일 · 구매자 이름·받는 분 이름 전체·주소까지)
    //        ② = 그 표가 비었으면(수집 꺼짐·배포 직후) 문자용 sms_preorders(7일 · 이름 전체·주소 없음 · #610-G) — 종전 꼴 그대로
    //   매칭 = 숫자만 · 구매자 번호 = as buyer · 받는 분 번호 = as recv · 자사몰 주문번호(YYYYMMDD-NNNNNNN) · 네이버 상품주문번호 등 긴 숫자 = as order · 개인정보 = 응답에만(로그·감사 0)
    const PLAT_CH = { '네이버': 'naver', '쿠팡': 'coupang', '자사몰': 'cafe24' }, CH_PLAT = { naver: '네이버', coupang: '쿠팡', cafe24: '자사몰' };
    app.get('/api/order-memo/lookup', authMiddleware, wrap(async (req, res) => {
        if (req.user.role === 'accountant') throw err(403, '세무사 계정은 볼 수 없어요');   // 손님 이름·주소(워커3 점검)
        const key = s(req.query.key, 40).trim(), plat = s(req.query.plat, 10).trim();
        if (plat && !PLAT_CH[plat]) throw err(400, '판매처는 네이버·쿠팡·자사몰 중 하나예요');
        const d0 = dg(key), np = PRE_LK ? PRE_LK.normalizePhone(key) : d0, ch = plat ? [PLAT_CH[plat]] : ['naver', 'coupang', 'cafe24'];
        const mall = /^\d{8}-\d{7}$/.test(key), phone = /^0\d{8,11}$/.test(np) && !mall, orderNo = !phone && !mall && /^\d{10,20}$/.test(d0);
        const d = phone ? np : d0;   // 번호 = 문자 쪽과 같은 정규화(+82 → 0)
        if (!phone && !mall && !orderNo) throw err(400, '전화번호(0으로 시작 9~12자리) 또는 주문번호를 주세요');
        const kv = mall ? key : d;
        let matches = [], cov = null, src = 'none';
        try {
            const have = Number((await pool.query('SELECT count(*)::int AS n FROM order_memo_preorders')).rows[0].n);
            if (have > 0) {
                src = 'memo';
                const where = phone ? '(buyer_digits = $2 OR recv_digits = $2)' : mall ? "channel = 'cafe24' AND split_part(order_key, '|', 1) = $2" : '(split_part(order_key, \'|\', 1) = $2 OR product_order_no = $2)';
                const rows = (await pool.query("SELECT channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS paid"
                    + ' FROM order_memo_preorders WHERE channel = ANY($1::text[]) AND miss = 0 AND ' + where + ' ORDER BY paid_at DESC NULLS LAST LIMIT 20', [ch, kv])).rows;
                matches = rows.map(r => ({ plat: CH_PLAT[r.channel] || r.channel, as: phone ? (r.buyer_digits === d ? 'buyer' : 'recv') : 'order',
                    buyer_name: r.buyer_name || null, recv_name: r.recv_name || null, recv_initial: (String(r.recv_name || '').match(/[가-힣A-Za-z]/) || [''])[0], addr: r.addr || null,
                    option: r.option_text || '', qty: r.qty || null, order_no: r.product_order_no || String(r.order_key || '').split('|')[0], paid_at: r.paid,
                    buyer_phone: phone && r.buyer_digits && r.buyer_digits !== d ? r.buyer_digits : null }));   // #867 받는 분 번호로 찾았을 때만 = 그 주문의 구매자 번호(입력삭제 줄을 구매자 번호로 바꾸기)
                cov = (await pool.query("SELECT to_char(MAX(seen_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS last_seen FROM order_memo_preorders")).rows[0];
            }
        } catch (e) { if (!/order_memo_preorders/.test(String(e.message))) throw e; }
        if (src === 'none') {
            try {
                const where = phone ? '(buyer_digits = $2 OR recipient_digits = $2)' : mall ? "channel = 'cafe24' AND split_part(order_key, '|', 1) = $2" : "split_part(order_key, '|', 1) = $2";
                const rows = (await pool.query("SELECT channel, order_key, buyer_digits, recipient_digits, recipient_initial, option_text, qty, to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS paid"
                    + ' FROM sms_preorders WHERE channel = ANY($1::text[]) AND ' + where + ' ORDER BY paid_at DESC NULLS LAST LIMIT 20', [ch, kv])).rows;
                src = 'sms';
                matches = rows.map(r => ({ plat: CH_PLAT[r.channel] || r.channel, as: phone ? (r.buyer_digits === d ? 'buyer' : 'recv') : 'order',
                    buyer_name: null, recv_name: null, recv_initial: r.recipient_initial || '', addr: null,   // 이름 전체·주소 = 그 표에 없음(#610-G)
                    option: r.option_text || '', qty: r.qty || null, order_no: String(r.order_key || '').split('|')[0], paid_at: r.paid,
                    buyer_phone: phone && r.buyer_digits && r.buyer_digits !== d ? r.buyer_digits : null }));   // #867 위와 같음
                cov = (await pool.query("SELECT to_char(MAX(seen_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS last_seen FROM sms_preorders")).rows[0];
            } catch (e) { if (!/sms_preorders/.test(String(e.message))) throw e; }   // 표가 없는 서버(문자 기능 꺼짐) = 못 찾음
        }
        const days = 7;
        res.json({ ok: true, key, plat: plat || '', found: matches.length > 0, matches,
            message: matches.length ? '' : '못 찾았어요 — 7일 지난 주문이면 판매처를 골라 주세요',
            coverage: { days, source: src, last_seen: cov ? cov.last_seen : null,
                note: '발송 전 주문 = 결제 7일 안 · 60분마다 모음(문자 수집기와 같은 회차) · 발송·취소된 주문은 빠짐' } });
    }));

    // ── #850-e 메모함 전용 발송 전 주문 표(order_memo_preorders) ──────────────────────────────
    //   대표 10/25 「알림톡·최종발주처럼 이름·주소까지」 + 「요청은 보통 주문 5일 안 · 7일이면 안정 · 호출 오류 없게」 →
    //   따로 수집·타이머 없음 · 문자 「발송 전 주문」 수집기(sms/preorders.js collect · 7일 · 60분 · #665 즉시 조회 포함)가 이미 받아 온 원본 행을 훅으로 받아 이 표에도 씀(추가 API 호출 0)
    //   sms_preorders 칸·「받아도 버린다」 원칙은 그대로 · 이 표에 한해 이름·주소를 둠(대표 결정) · 문자 쪽은 이 표를 안 읽음
    //   삭제 = 큰(merge 아닌) 수집에서 두 번 연속 안 보이면(sms 쪽 miss 규칙과 같게) · 7일 넘게 안 보인 줄도(수집이 멈춰도 손님 정보가 남지 않게) · 로그·감사엔 건수도 안 적음
    //   🔵 청귤 예약 시즌(결제 뒤 수십 일 뒤 발송)엔 7일 밖이라 못 찾음 = 그때 기간 늘리기 후보(지금 코드 X)
    const PRE_DDL = [
        `CREATE TABLE IF NOT EXISTS order_memo_preorders (id BIGSERIAL PRIMARY KEY, channel TEXT NOT NULL, order_key TEXT NOT NULL, product_order_no TEXT,
            buyer_name TEXT, buyer_digits TEXT NOT NULL DEFAULT '', recv_name TEXT, recv_digits TEXT NOT NULL DEFAULT '', addr TEXT, option_text TEXT, qty INTEGER,
            paid_at TIMESTAMPTZ, seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), miss SMALLINT NOT NULL DEFAULT 0, UNIQUE (channel, order_key))`,
        `CREATE INDEX IF NOT EXISTS order_memo_pre_buyer ON order_memo_preorders (buyer_digits) WHERE buyer_digits <> ''`,
        `CREATE INDEX IF NOT EXISTS order_memo_pre_recv ON order_memo_preorders (recv_digits) WHERE recv_digits <> ''`,
    ];
    let preReady = null;
    const preEnsure = () => preReady || (preReady = (async () => { for (const q of PRE_DDL) await pool.query(q); })().catch(e => { preReady = null; throw e; }));
    preEnsure().catch(e => console.error('[발주 메모함] 발송 전 주문 표 만들기 실패(다음 수집 때 다시):', e.message));
    const PRE_EXTRA = {   // 이름·주소·상품주문번호(키·번호·옵션·수량·결제 시각은 문자 수집기와 같은 매퍼 = sms/preorders.js MAPPERS)
        naver: r => ({ buyer: r['구매자명'], recv: r['수취인명'], addr: r['통합배송지'], pno: r._pid }),
        coupang: r => ({ buyer: r['구매자'], recv: r['수취인이름'], addr: r['수취인 주소'], pno: r._orderId }),
        cafe24: r => ({ buyer: r['주문자명'], recv: r['수령인'], addr: r['수령인 주소(전체)'], pno: r._orderId }),
    };
    let PRE_MOD = null; try { PRE_MOD = require('./sms/preorders.js'); } catch (_) { PRE_MOD = null; }
    let PRE_LK = null; try { PRE_LK = require('./sms/lookup.js'); } catch (_) { PRE_LK = null; }
    function preMap(ch, rows) {
        const base = PRE_MOD && PRE_MOD.MAPPERS && PRE_MOD.MAPPERS[ch], ex = PRE_EXTRA[ch]; if (!base || !ex) return [];
        const ph = v => { const t = PRE_LK ? PRE_LK.normalizePhone(v) : dg(v); return (PRE_LK ? PRE_LK.lookupable(t) : /^0\d{8,11}$/.test(t)) ? t : ''; };   // 문자 쪽과 같은 정규화(+82 등) = 두 표 번호 같게(워커3 점검)
        const out = new Map();
        for (const r of (Array.isArray(rows) ? rows : [])) {
            const m = base(r || {}), x = ex(r || {}); const k = String(m.key || '').slice(0, 120); if (!k) continue;
            const t = Date.parse(String(m.paid || '').replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(:\d{2})?)$/, '$1T$2+09:00'));   // 시간대 없는 글자 = 한국 시각
            const row = { k, pno: s(x.pno, 40).trim() || null, bn: s(x.buyer, 40).trim() || null, bd: ph(m.buyer), rn: s(x.recv, 40).trim() || null, rd: ph(m.recip),
                ad: s(x.addr, 300).replace(/\s+/g, ' ').trim() || null, op: s(m.opt, 200).replace(/\s+/g, ' ').trim() || null, q: Math.max(0, parseInt(m.qty, 10) || 0) || null, p: Number.isFinite(t) ? new Date(t).toISOString() : null };
            const cur = out.get(k); if (cur) cur.q = (cur.q || 0) + (row.q || 0) || null; else out.set(k, row);   // 같은 열쇠 두 번 = 수량만 더함(문자 수집기와 같게)
        }
        return [...out.values()];
    }
    const PRE_UPSERT = `INSERT INTO order_memo_preorders (channel, order_key, product_order_no, buyer_name, buyer_digits, recv_name, recv_digits, addr, option_text, qty, paid_at, seen_at, miss)
        SELECT $1, k, pn, bn, bd, rn, rd, ad, op, q, p::timestamptz, NOW(), 0 FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[], $11::text[]) AS x(k, pn, bn, bd, rn, rd, ad, op, q, p)
        ON CONFLICT (channel, order_key) DO UPDATE SET seen_at = NOW(), miss = 0, option_text = EXCLUDED.option_text, qty = EXCLUDED.qty,
            product_order_no = COALESCE(EXCLUDED.product_order_no, order_memo_preorders.product_order_no), buyer_name = COALESCE(EXCLUDED.buyer_name, order_memo_preorders.buyer_name),
            buyer_digits = COALESCE(NULLIF(EXCLUDED.buyer_digits, ''), order_memo_preorders.buyer_digits), recv_name = COALESCE(EXCLUDED.recv_name, order_memo_preorders.recv_name),
            recv_digits = COALESCE(NULLIF(EXCLUDED.recv_digits, ''), order_memo_preorders.recv_digits), addr = COALESCE(EXCLUDED.addr, order_memo_preorders.addr), paid_at = COALESCE(EXCLUDED.paid_at, order_memo_preorders.paid_at)`;
    const preEmptyOnce = {};
    // 문자 수집기가 채널마다 부르는 훅 — (채널, 받은 원본 행, { merge }) · 실패해도 문자 수집은 그대로(preorders.js 가 잡음)
    async function preHook(ch, raw, info) {
        if (!PRE_EXTRA[ch]) return null;
        await preEnsure();
        const rows = preMap(ch, raw), merge = !!(info && info.merge);
        for (let i = 0; i < rows.length; i += 500) {
            const p = rows.slice(i, i + 500);
            await pool.query(PRE_UPSERT, [ch, p.map(x => x.k), p.map(x => x.pno), p.map(x => x.bn), p.map(x => x.bd), p.map(x => x.rn), p.map(x => x.rd), p.map(x => x.ad), p.map(x => x.op), p.map(x => x.q), p.map(x => x.p)]);
        }
        if (merge) return { rows: rows.length, merge: true };   // 즉시 조회(짧은 창) = 넣기만
        if (!rows.length) {   // 일시적인 빈 응답 = 한 번은 그대로(sms 쪽 F4 와 같은 꼴)
            const have = Number((await pool.query('SELECT count(*)::int AS n FROM order_memo_preorders WHERE channel = $1', [ch])).rows[0].n);
            if (have > 0 && !preEmptyOnce[ch]) { preEmptyOnce[ch] = true; return { rows: 0, grace: true }; }
        } else preEmptyOnce[ch] = false;
        const missed = (await pool.query('UPDATE order_memo_preorders SET miss = miss + 1 WHERE channel = $1 AND NOT (order_key = ANY($2::text[]))', [ch, rows.map(x => x.k)])).rowCount;
        const removed = (await pool.query('DELETE FROM order_memo_preorders WHERE channel = $1 AND miss >= 2', [ch])).rowCount;
        await pool.query("DELETE FROM order_memo_preorders WHERE seen_at < NOW() - INTERVAL '7 days'");
        return { rows: rows.length, missed: missed - removed, removed };
    }
    if (PRE_MOD && typeof PRE_MOD.setRowsHook === 'function') PRE_MOD.setRowsHook(preHook);

    app.get('/api/order-memo/for-ship', authMiddleware, wrap(async (req, res) => {
        const date = String(req.query.date || '');
        if (!isDay(date)) throw err(400, '기준 발송일(date=YYYY-MM-DD)이 없어요');
        const rows = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open' ORDER BY entry_id, id`)).rows;
        res.json(Object.assign({ ok: true }, pickForShip(rows, date)));
    }));

    app.post('/api/order-memo/used', authMiddleware, wrap(async (req, res) => {
        const b = req.body || {}, date = String(b.date || '');
        if (!isDay(date)) throw err(400, '기준 발송일이 없어요');
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, USED_MAX);   // #900-2A 500 → 2,000
        if (!ids.length) return res.json({ ok: true, n: 0 });
        const r = b.undo
            ? await pool.query(`UPDATE order_memo_rows SET used_on=NULL WHERE id = ANY($1::int[]) AND state='open' AND used_on = $2::date`, [ids, date])
            : await pool.query(`UPDATE order_memo_rows SET used_on=$2::date WHERE id = ANY($1::int[]) AND state='open'`, [ids, date]);
        await audit(req, b.undo ? 'used_undo' : 'used', null, { date, n: r.rowCount });
        res.json({ ok: true, n: r.rowCount });
    }));

    app.post('/api/order-memo/clear', authMiddleware, wrap(async (req, res) => {
        const b = req.body || {}, date = String(b.date || ''), all = b.all === true;
        if (!all && !isDay(date)) throw err(400, '기준 발송일이 없어요');
        const rows = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open'`)).rows;
        const ids = pickClear(rows, date, all);
        const r = ids.length ? await pool.query(`UPDATE order_memo_rows SET state='cleared', cleared_at=NOW(), cleared_by=$2, updated_at=NOW(), updated_by=$2 WHERE id = ANY($1::int[]) AND state='open'`, [ids, actorName(req)]) : { rowCount: 0 };
        const leftRows = rows.filter(x => !ids.includes(x.id)), today = kstToday();
        await audit(req, all ? 'clear_all' : 'clear', null, { date: date || null, cleared: r.rowCount, left: leftRows.length });
        res.json({ ok: true, cleared: r.rowCount, left: { open: leftRows.length, wait: leftRows.filter(x => x.sure && x.ship_date && x.ship_date > (isDay(date) ? date : today)).length, unsure: leftRows.filter(x => !x.sure).length } });
    }));

    // 비운 줄 영구 삭제(결정 A · 6시간마다) — 줄이 다 지워진 건은 원문째
    async function purge() {
        await ensure();
        const c = await cfg();
        const a = await pool.query(`DELETE FROM order_memo_rows WHERE state = 'cleared' AND cleared_at < NOW() - ($1::int * INTERVAL '1 day')`, [c.keep_days]);
        // #850 점검 c: 30일(설정 unsure_days) 넘게 안 고친 확인(🟠) 줄 = 「비운 것」으로 옮김(거기서 keep_days 되살리기 → 그 뒤 위 줄이 영구 삭제 · 손님 메모가 모르게 사라지지 않게)
        const u = await pool.query(`UPDATE order_memo_rows SET state = 'cleared', cleared_at = NOW(), cleared_by = '자동 정리(확인 ' || $1::int || '일)', updated_at = NOW() WHERE state = 'open' AND sure = false AND updated_at < NOW() - ($1::int * INTERVAL '1 day')`, [c.unsure_days]);
        const b = await pool.query(`DELETE FROM order_memo_entries e WHERE NOT EXISTS (SELECT 1 FROM order_memo_rows r WHERE r.entry_id = e.id) AND e.created_at < NOW() - INTERVAL '1 day'`);
        // 화면이 DELETE 를 못 하고 떠난 창구 요청 줄 = 하루 지나면 손님 글·결과만 지움(줄은 남김)
        const d = await pool.query(`UPDATE pending_orders SET payload = NULL, result = CASE WHEN result IS NULL THEN NULL ELSE result - 'data' END, status = CASE WHEN status = '대기' THEN '취소' ELSE status END WHERE content LIKE $1 AND created_at < NOW() - INTERVAL '1 day' AND (payload IS NOT NULL OR result ? 'data')`, [DESK_PREFIX + '%']);   // LIKE 특수 글자는 % _ 뿐(머리글엔 없음)
        // #850-e 발송 전 주문 표 = 7일 넘게 안 보인 줄(문자 수집기가 멈춰 훅이 안 불려도 손님 이름·주소가 남지 않게 · 워커3 점검) · 표가 아직 없으면 넘김
        let pre = 0;
        try { pre = (await pool.query(`DELETE FROM order_memo_preorders WHERE seen_at < NOW() - INTERVAL '7 days'`)).rowCount; } catch (e) { if (!/order_memo_preorders/.test(String(e.message))) throw e; }
        if (a.rowCount || u.rowCount || b.rowCount || d.rowCount || pre) console.log(`[발주 메모함] 비운 지 ${c.keep_days}일 지난 줄 ${a.rowCount} · 확인 ${c.unsure_days}일 넘어 비운 것으로 ${u.rowCount} · 빈 건 ${b.rowCount} 영구 삭제 · 창구 요청 글 ${d.rowCount} 지움 · 발송 전 주문 7일 지난 ${pre}`);
        return { rows: a.rowCount, unsure: u.rowCount, entries: b.rowCount, desk: d.rowCount, pre };
    }
    if (!noTimers) { const t = setInterval(() => purge().catch(e => console.error('[발주 메모함] 영구 삭제 실패:', e.message)), 6 * 3600e3); if (t && t.unref) t.unref(); }
    return { purge, preview, ensure, preHook, preEnsure, preMap };
}

module.exports = { mount, ruleLine, checkLine, checkCash, checkRow, pairCash, pairHint, itemKeyOf, cashFromAi, cleanChecked, depositName, applySms, markIndiv, indivKeysOf, pickForShip, pickClear, loadV2, V2, DEFAULTS, AI_SCHEMA };

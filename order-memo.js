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
const MAX_RAW = 4000, MAX_ROWS = 60, LIST_MAX = 200, PREVIEW_PER_MIN = 20;
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
    const keyBad = !out.key || (d.length < 8 && !/\d{8,}/.test(out.key));
    if (keyBad) why.push('번호가 없거나 8자리보다 짧아요');
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
    if (out.ship_date && out.ship_date < today) why.push('지난 날짜예요');
    out.sure = !why.length; out.check_why = why; out.missing = keyBad ? ['key'] : [];   // line 빈 칸 = 'key'(화면 빨강)
    return out;
}
function cashRowFromCells(cells, src) {
    const c = []; for (let i = 0; i < 13; i++) c.push(s(cells[i], i === 8 || i === 12 ? 300 : 200).replace(/[\t\n]+/g, ' ').trim());
    return { kind: 'cash', cells: c, ship_date: null, src };
}
function checkCash(r, today, catalog, origin) {
    const c = cashRowFromCells(r.cells || [], r.src || 'edit').cells;
    // 현금 손님 = 「!」 표식(parseCash bang) · 입력삭제 주문의 주소 줄(r.indiv · markIndiv) = 「!」 없이 + 구매자연락처(K) = 주문 번호 → cashCheck 가 주문과 짝을 지음(#850 워커3 시험)
    if (r.indiv) { c[0] = c[0].replace(/^[!！]+\s*/, '') || '제주아꼼이네'; if (r.indivKey) c[10] = r.indivKey; }
    else if (!/[!！]/.test(c[0])) c[0] = '!' + (c[0] || '제주아꼼이네');
    if (!c[2]) c[2] = origin;
    [1, 6, 7, 10].forEach(i => { if (c[i]) c[i] = core.fmtPhone(c[i]); });
    const q = Number(c[5]); c[5] = Number.isInteger(q) && q > 0 ? String(q) : '';
    const missing = Object.keys(REQ_CELLS).map(Number).filter(i => !c[i]);
    const why = missing.map(i => REQ_CELLS[i]);
    if (c[4] && catalog && !catalog.has(c[4])) { why.push('품목이 단가표 이름과 달라요'); if (!missing.includes(4)) missing.push(4); }
    if (c[6] && dg(c[6]).length < 9) { why.push('받는 분 연락처를 다시 확인해 주세요'); if (!missing.includes(6)) missing.push(6); }
    const ship = isDay(r.ship_date) ? r.ship_date : null;
    if (ship && ship < today) why.push('지난 날짜예요');
    return { kind: 'cash', cells: c, ship_date: ship, src: r.src || 'edit', sure: !why.length, check_why: why, missing: missing.sort((a, b) => a - b), indiv: !/[!！]/.test(c[0]) };   // indiv = 입력삭제 주문의 주소 줄
}
// 같은 묶음 안 「입력o삭제x」 메모 줄의 번호(숫자) — extra = 앞서 규칙으로 읽은 줄의 번호(창구 답을 받을 때)
function indivKeysOf(rows, extra) {
    const m = new Map((extra || []).map(k => [dg(k), k]));
    (rows || []).forEach(r => { if (r && r.kind === 'line' && INDIV.test(String(r.note || '') + ' ' + String(r.line || '')) && dg(r.key).length >= 8) m.set(dg(r.key), String(r.key)); });
    return m;
}
// 현금 줄의 구매자 번호(K칸 · 없으면 보내는사람연락처)가 입력삭제 줄 번호와 같으면 = 그 주문의 주소 줄(「!」 안 붙임)
function markIndiv(rows, extra) {
    const keys = indivKeysOf(rows, extra);
    (rows || []).forEach(r => { if (!r || r.kind !== 'cash') return; const c = r.cells || []; const hit = [c[10], c[1]].map(dg).find(d => d && keys.has(d)); r.indiv = !!hit; r.indivKey = hit ? keys.get(hit) : null; });
    return rows;
}
function checkRow(r, ctx) { return r && r.kind === 'cash' ? checkCash(r, ctx.today, ctx.catalog, ctx.origin) : checkLine(r || {}, ctx.today, !!r && (r.src === 'rule' || r.src === 'ai')); }

// AI 가 돌려준 현금 손님 → 13칸
function cashFromAi(x) {
    const sender = s(x.sender, 30).trim(), buyer = s(x.buyer, 30).trim();
    const c0 = sender ? (/드림$/.test(sender) ? sender : sender + ' 드림') : (buyer ? buyer + '(제주아꼼이네)' : '제주아꼼이네');
    return { kind: 'cash', src: 'ai', ship_date: isDay(x.date) ? x.date : null,
        cells: ['!' + c0, x.sender_phone || x.buyer_phone || '', '', x.recv, x.option, x.qty == null ? '' : String(x.qty), x.phone1, x.phone2, x.addr, x.memo, x.buyer_phone || x.phone1, '', x.sender_addr] };
}

// ── 최종발주용 고르기(순수 · 검증이 그대로 부름) ──
function pickForShip(rows, date) {
    const lines = [], cash = [], waiting = [], held = [];
    for (const r of rows) {
        if (r.state !== 'open') continue;
        const sd = r.ship_date ? String(r.ship_date).slice(0, 10) : null;
        if (!r.sure) { held.push({ id: r.id, kind: r.kind, why: r.check_why || [] }); continue; }
        if (r.kind === 'line') lines.push({ id: r.id, line: r.line, ship_date: sd, state: !sd ? 'nodate' : sd === date ? 'today' : sd > date ? 'wait' : 'past' });
        else if (!sd || sd === date) cash.push(r);
        else if (sd > date) waiting.push({ id: r.id, kind: 'cash', ship_date: sd });
        else held.push({ id: r.id, kind: 'cash', why: ['지난 날짜예요'] });
    }
    return { date, memo_text: lines.map(l => l.line).join('\n'), lines,
        cash_aoa: cash.length ? [core.HEADERS.slice(), ...cash.map(r => r.cells.slice(0, 13))] : [], cash_ids: cash.map(r => r.id),
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
    '2) cash = 주문이 없는 현금 손님(「현금」「계좌이체」「현금파일」 또는 이름·주소·품목이 다 적힌 손님). buyer = 주문한 분 · recv·phone1·addr = 받는 분 · option = 아래 「품목 이름 목록」 글자 그대로 하나(목록에 없으면 "") · qty = 박스 수(없으면 0) · memo = 기사님께 전할 말(문 앞·경비실 등만 · 우리에게 한 말은 넣지 않음) · sender/sender_phone/sender_addr = 보내는이를 바꿔 달라는 경우만.',
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
    function aiDataToRows(d, ctx, extraKeys) {
        const raw = [];
        (Array.isArray(d && d.lines) ? d.lines : []).slice(0, MAX_ROWS).forEach(x => raw.push({ kind: 'line', key: x && x.key, note: x && x.note, plat: x && x.plat, ship_date: x && isDay(x.date) ? x.date : null, src: 'ai' }));
        (Array.isArray(d && d.cash) ? d.cash : []).slice(0, MAX_ROWS).forEach(x => raw.push(cashFromAi(x || {})));
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
    async function preview(raw, tags, ctx, req) {
        const rows = [], rest = [];
        for (const ln of raw.split('\n')) { const r = ruleLine(ln, ctx.today); if (r) rows.push(r); else if (ln.trim()) rest.push(ln); }
        const ruleRows = markIndiv(rows).map(r => checkRow(r, ctx));
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
            const x = aiDataToRows(ai.data, ctx, ruleKeys); delete ai.data;
            return Object.assign(base, { rows: ruleRows.concat(x.rows), ai_count: x.rows.length, leftover: x.leftover, sms_draft: x.sms_draft, ai });
        }
        let alive = false; try { alive = await deskAlive(); } catch (_) { alive = false; }
        if (!alive) return Object.assign(base, { leftover: text, ai: { used: false, why: '창구 꺼짐' }, desk: { state: 'off', message: '창구가 꺼져 있어 지금은 규칙으로만 정리했어요 · 남은 글은 직접 채워 주세요' } });
        let cal = null; try { cal = await shipCal(); } catch (_) { /* 달력 없이 */ }
        const payload = { type: 'order_memo', today: ctx.today, shipDays: (cal && cal.shipDays) || [], tags: tags || [], catalog: [...ctx.catalog].slice(0, 300), text, indiv_keys: ruleKeys };
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
        missing: r.kind === 'cash' ? Object.keys(REQ_CELLS).map(Number).filter(i => !(r.cells || [])[i]) : ((!r.line_key || (dg(r.line_key).length < 8 && !/\d{8,}/.test(r.line_key))) ? ['key'] : []),
        state: r.state, used_on: r.used_on ? String(r.used_on instanceof Date ? r.used_on.toISOString() : r.used_on).slice(0, 10) : null,
        cleared_at: r.cleared_at, cleared_by: r.cleared_by, updated_at: r.updated_at, updated_by: r.updated_by,
        indiv: r.kind === 'cash' ? !/[!！]/.test(String((r.cells || [])[0] || '')) : undefined,   // cash: true = 입력삭제 주문의 주소 줄 · false = 현금 손님
        stale: !r.sure && r.state === 'open' && !!r.updated_at && (Date.now() - new Date(r.updated_at).getTime()) > STALE_DAYS * 86400e3 });   // #850 점검 c 「오래된 확인」(7일 넘게 안 고친 🟠)
    const ROW_COLS = `id, entry_id, kind, to_char(ship_date, 'YYYY-MM-DD') AS ship_date, line_key, note, plat, line, cells, sure, check_why, src, to_char(used_on, 'YYYY-MM-DD') AS used_on, state, cleared_at, cleared_by, updated_at, updated_by`;
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
        const out = await preview(raw, tags, await ctxOf(), req);
        res.json(Object.assign({ ok: true }, out));
    }));

    // 창구 정리 기다리기(최종발주 memo-read GET/DELETE 와 같은 꼴) — done 이면 줄로 바꿔 줌 · 화면은 받은 뒤 DELETE(손님 글 서버에 안 남김)
    app.get('/api/order-memo/preview/:id', authMiddleware, wrap(async (req, res) => {
        const r = await deskRow(req), rs = r.result || {};
        const state = r.status === '완료' ? 'done' : ['대기', '처리중', '승인됨'].includes(r.status) ? 'wait' : 'fail';
        const text = r.payload && typeof r.payload.text === 'string' ? r.payload.text : '';
        if (!r.payload) return res.json({ ok: true, state: 'fail', leftover: '', message: '그만둔 요청이에요 — 다시 [정리하기] 를 눌러 주세요' });   // #850 점검 a · 받은 뒤·그만둔 뒤엔 창구가 늦게 답해도 안 내줌
        if (state === 'wait') return res.json({ ok: true, state, status: r.status });
        if (state === 'done' && rs.data && typeof rs.data === 'object') { const x = aiDataToRows(rs.data, await ctxOf(), Array.isArray(r.payload.indiv_keys) ? r.payload.indiv_keys.slice(0, 60).map(String) : []); return res.json({ ok: true, state, rows: x.rows, ai_count: x.rows.length, leftover: x.leftover, sms_draft: x.sms_draft }); }
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
        const rows = markIndiv(src.map(r => ({ kind: r && r.kind === 'cash' ? 'cash' : 'line', key: r && r.key, note: r && r.note, plat: r && r.plat, line: r && r.line, cells: r && r.cells,
            ship_date: r && r.ship_date, src: r && (r.src === 'rule' || r.src === 'ai') ? r.src : 'edit', _bad: [] }))).map(r => checkRow(r, ctx));   // 같은 저장 묶음의 입력삭제 줄 ↔ 현금 줄 = 주소 줄
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const e = (await client.query(`INSERT INTO order_memo_entries (created_by, created_by_id, raw, tags, source) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [actorName(req), req.user.id || null, raw || '(줄만 저장)', tags, source])).rows[0];
            const saved = [];
            for (const r of rows) {
                saved.push((await client.query(`INSERT INTO order_memo_rows (entry_id, kind, ship_date, line_key, note, plat, line, cells, sure, check_why, src, updated_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${ROW_COLS}`, [e.id, ...saveVals(r), actorName(req)])).rows[0]);
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
        const ents = ids.length ? (await pool.query(`SELECT id, created_at, created_by, source, tags, raw FROM order_memo_entries WHERE id = ANY($1::int[]) ORDER BY id DESC LIMIT ${LIST_MAX}`, [ids])).rows : [];
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
        const next = cur.kind === 'cash'
            ? { kind: 'cash', cells: Array.isArray(b.cells) ? b.cells : cur.cells, ship_date: 'ship_date' in b ? b.ship_date : cur.ship_date, src: 'edit', indiv: !/[!！]/.test(String((cur.cells || [])[0] || '')) }   // 고치기 = 주소 줄/현금 손님 구분 그대로
            : { kind: 'line', key: 'key' in b ? b.key : cur.line_key, note: 'note' in b ? b.note : cur.note, plat: 'plat' in b ? b.plat : cur.plat, ship_date: 'ship_date' in b ? b.ship_date : cur.ship_date, src: 'edit', _bad: [] };
        if ('ship_date' in b && b.ship_date !== null && !isDay(b.ship_date)) throw err(400, '날짜는 YYYY-MM-DD 로 주세요');
        const r = checkRow(next, ctx);
        const row = (await pool.query(`UPDATE order_memo_rows SET kind=$2, ship_date=$3, line_key=$4, note=$5, plat=$6, line=$7, cells=$8, sure=$9, check_why=$10, src=$11, updated_at=NOW(), updated_by=$12
            WHERE id=$1 AND state='open' RETURNING ${ROW_COLS}`, [cur.id, ...saveVals(r), actorName(req)])).rows[0];
        if (!row) throw err(409, '방금 다른 사람이 바꿨어요 — 새로 고쳐 주세요');
        await audit(req, 'update', cur.id, { kind: r.kind, sure: r.sure });
        res.json({ ok: true, row: rowOut(row) });
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

    app.get('/api/order-memo/for-ship', authMiddleware, wrap(async (req, res) => {
        const date = String(req.query.date || '');
        if (!isDay(date)) throw err(400, '기준 발송일(date=YYYY-MM-DD)이 없어요');
        const rows = (await pool.query(`SELECT ${ROW_COLS} FROM order_memo_rows WHERE state = 'open' ORDER BY entry_id, id`)).rows;
        res.json(Object.assign({ ok: true }, pickForShip(rows, date)));
    }));

    app.post('/api/order-memo/used', authMiddleware, wrap(async (req, res) => {
        const b = req.body || {}, date = String(b.date || '');
        if (!isDay(date)) throw err(400, '기준 발송일이 없어요');
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
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
        if (a.rowCount || u.rowCount || b.rowCount || d.rowCount) console.log(`[발주 메모함] 비운 지 ${c.keep_days}일 지난 줄 ${a.rowCount} · 확인 ${c.unsure_days}일 넘어 비운 것으로 ${u.rowCount} · 빈 건 ${b.rowCount} 영구 삭제 · 창구 요청 글 ${d.rowCount} 지움`);
        return { rows: a.rowCount, unsure: u.rowCount, entries: b.rowCount, desk: d.rowCount };
    }
    if (!noTimers) { const t = setInterval(() => purge().catch(e => console.error('[발주 메모함] 영구 삭제 실패:', e.message)), 6 * 3600e3); if (t && t.unref) t.unref(); }
    return { purge, preview, ensure };
}

module.exports = { mount, ruleLine, checkLine, checkCash, checkRow, cashFromAi, pickForShip, pickClear, loadV2, V2, DEFAULTS, AI_SCHEMA };

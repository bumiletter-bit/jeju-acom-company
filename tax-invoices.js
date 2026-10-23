// #814 계산서 발행현황 — 서버(표 tax_invoices · 정산관리 「계산서 발행현황」 탭 API) · 계약 = docs/814-api.md
//   채우는 길 = 창구 scripts/desk/invoice-month.js(메일 색인 → 첨부 PDF → 풀기 → upsertRow) · 이 모듈은 읽기·확인·보류·PDF 내주기만
//   🔴 확인 전 숫자는 화면에만 — 정산 합계·박스·입금 어디에도 안 섞는다(대표 10/21) · 우리 정산 월 합계는 읽어서 「차이」 표시만(자동 맞춤 0)
'use strict';

const SUPPLIERS = ['cj', 'sion', 'hyodon', 'other'];
const LABEL = { cj: 'CJ대한통운(택배비)', sion: '시온(조천감귤농협)', hyodon: '효돈농협유통', other: '기타' };
const SETTLE_PARTNER = { sion: '대성(시온)', hyodon: '효돈농협' };
const CJ_PARTNERS = ['대성(시온)', '효돈농협', '기타거래처'], CJ_BOX_FEE = 3100;   // 정산관리와 같은 계산(agents/세미.js)
// #823 CJ 계산서 박스 = 합계(부가세 포함 total_amount) ÷ 3,100(워커3 7달 대조 · 공급가 기준은 매달 수백 박스 모자람)
// 시온·효돈 누적 잔액 기준일 기본 = 법인 첫 계산서(settlements 는 3/3 부터) · 기준일 이월(carry)·허용 박스 차이는 설정 tax_invoice
const BALANCE_START_DEFAULT = '2026-03-29', CJ_BOX_TOLERANCE_DEFAULT = 30;
const SHOWN = ['sion', 'hyodon', 'cj'];   // #816 대표 10/21 = 화면·검색은 이 셋만(순서 = 묶음 순서) · 'other' 줄은 표에 남고 안 보임
const SHOWN_SQL = SHOWN.map(s => `'${s}'`).join(', ');   // 고정 글자(손님 값 아님)
const YM = /^\d{4}-(0[1-9]|1[0-2])$/, YMD = /^\d{4}-\d{2}-\d{2}$/, MAX_DAYS = 366;
const isDay = (d) => YMD.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;   // 2026-02-30 같은 없는 날 거름
const monthsOf = (from, to) => { const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const end = to.slice(0, 7);
    for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; out.push(k); if (k >= end) return out; if (++m > 12) { m = 1; y++; } } };

async function ensureTable(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS tax_invoices (
        id SERIAL PRIMARY KEY, supplier TEXT NOT NULL DEFAULT 'other', supplier_name TEXT, supplier_bizno TEXT, approval_no TEXT, kind TEXT, orig_approval_no TEXT,
        issue_date DATE, supply_amount BIGINT, vat_amount BIGINT, total_amount BIGINT,
        mail_folder TEXT, mail_uid BIGINT, mail_uidvalidity BIGINT, mail_subject TEXT, mail_at TIMESTAMPTZ,
        pdf_name TEXT, pdf_data BYTEA, read_status TEXT NOT NULL DEFAULT 'check', read_note TEXT,
        status TEXT NOT NULL DEFAULT 'draft', memo TEXT, confirmed_by TEXT, confirmed_at TIMESTAMPTZ,
        dedup_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tax_invoices_approval ON tax_invoices (approval_no) WHERE approval_no IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tax_invoices_issue ON tax_invoices (issue_date, supplier)`);
    // #823 달 단위 [대조 확인](CJ 박스 대조 · 시온·효돈도 같은 길) · 한 거래처·한 달 = 한 줄
    await pool.query(`CREATE TABLE IF NOT EXISTS tax_invoice_checks (supplier TEXT NOT NULL, month TEXT NOT NULL, checked_by INTEGER, checked_name TEXT,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (supplier, month))`);
    // #824 시온·효돈 입금(우리가 보낸 돈) — 미발행 = 입금했는데 계산서 안 온 돈 · 지우기 = deleted_at(줄은 남김)
    await pool.query(`CREATE TABLE IF NOT EXISTS tax_invoice_payments (id SERIAL PRIMARY KEY, supplier TEXT NOT NULL, paid_on DATE NOT NULL, amount BIGINT NOT NULL,
        memo TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', created_by INTEGER, created_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS tax_invoice_payments_sup ON tax_invoice_payments (supplier, paid_on)`);
}
const PAY_SUP = ['sion', 'hyodon'], PAY_MAX = 1000000000, PAY_LIST_MAX = 200, IMPORT_MAX_BYTES = 5 * 1024 * 1024;
// #824 미발행계산서 엑셀(대표 바탕화면) 입금 줄 읽기 — 규격 = 워커3 #824-A · 시트 이름 「대성」 → sion · 「효돈」 → hyodon · 나머지 시트 안 읽음
//   열 고정 A = 결제날짜(날짜 칸) · B = 입금금액 · C~ = 메모(원문 ' / ' 로 이음 · 안의 날짜·금액은 안 읽음) · 머리줄 위치가 시트마다 달라 열 이름은 안 찾음
//   읽는 줄 = A 가 날짜 AND B 가 숫자(수식 아님) AND 0 < B ≤ 10억 정수 · 합계줄(A 글자·B 수식)·계산서 음수 줄·빈 줄은 저절로 빠짐
//   unreadable = B 는 입금처럼 보이는데(양수) A 가 날짜 칸이 아닌 줄(글자로 친 날짜 등) · A 는 날짜인데 B 가 글자인 줄(글자로 친 금액) — 건수만 알림(수식·빈칸은 조용히 빠짐)
async function readPaymentsXlsx(buf) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const out = [], sheets = []; let unreadable = 0;
    wb.eachSheet((ws) => {
        const sup = /대성/.test(ws.name) ? 'sion' : /효돈/.test(ws.name) ? 'hyodon' : null;
        if (!sup) return;
        sheets.push(ws.name);
        ws.eachRow({ includeEmpty: false }, (row) => {
            const a = row.getCell(1).value, b = row.getCell(2).value;
            if (a instanceof Date && ((typeof b === 'string' && b.trim()) || (b && typeof b === 'object' && Array.isArray(b.richText)))) { unreadable++; return; }   // 날짜는 있는데 금액이 글자(「1,000,000」 등) = 알림
            if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) return;
            const d = a instanceof Date && !Number.isNaN(a.getTime()) ? a.toISOString().slice(0, 10) : null;
            if (!d || !isDay(d) || !Number.isInteger(b) || b > PAY_MAX) { unreadable++; return; }
            const memo = [];
            for (let c = 3; c <= row.cellCount; c++) { const t = String(row.getCell(c).text || '').replace(/\s+/g, ' ').trim(); if (t) memo.push(t); }
            out.push({ supplier: sup, paid_on: d, amount: b, memo: memo.join(' / ').slice(0, 500) });
        });
    });
    return { rows: out, sheets, unreadable };
}
const dedupKeyOf = (r) => r.approval_no ? 'a:' + r.approval_no : `m:${r.mail_folder || ''}:${r.mail_uidvalidity || 0}:${r.mail_uid || 0}`;
// 창구 도구가 부름 — 같은 dedup_key 면 숫자·PDF·읽기 결과만 갱신(status·memo·확인 정보 = 사람이 누른 것 보존) · 돌려줌 { id, inserted }
//   승인번호가 나중에 읽혀 키가 m: → a: 로 바뀌는 경우 = 같은 메일(m: 키) 줄을 찾아 그 줄을 고침(새 줄 0)
async function upsertRow(pool, r) {
    const key = dedupKeyOf(r), mkey = `m:${r.mail_folder || ''}:${r.mail_uidvalidity || 0}:${r.mail_uid || 0}`;
    const vals = [r.supplier && SUPPLIERS.includes(r.supplier) ? r.supplier : 'other', r.supplier_name || null, r.supplier_bizno || null, r.approval_no || null, r.kind || null, r.orig_approval_no || null,
        r.issue_date || null, r.supply_amount ?? null, r.vat_amount ?? null, r.total_amount ?? null,
        r.mail_folder || null, r.mail_uid || null, r.mail_uidvalidity || null, r.mail_subject || null, r.mail_at || null,
        r.pdf_name || null, r.pdf_data || null, r.read_status || 'check', r.read_note || null];
    const SETS = `supplier=$1, supplier_name=$2, supplier_bizno=$3, approval_no=$4, kind=$5, orig_approval_no=$6, issue_date=$7, supply_amount=$8, vat_amount=$9, total_amount=$10,
        mail_folder=$11, mail_uid=$12, mail_uidvalidity=$13, mail_subject=$14, mail_at=$15, pdf_name=COALESCE($16, pdf_name), pdf_data=COALESCE($17, pdf_data), read_status=$18, read_note=$19, updated_at=NOW()`;
    if (key !== mkey) {   // 승인번호 있음 — 같은 메일로 먼저 들어온 m: 줄이 있으면 그 줄을 a: 로
        const old = await pool.query(`UPDATE tax_invoices SET ${SETS}, dedup_key=$20 WHERE dedup_key=$21 AND NOT EXISTS (SELECT 1 FROM tax_invoices WHERE dedup_key=$20) RETURNING id`, [...vals, key, mkey]);
        if (old.rows.length) return { id: old.rows[0].id, inserted: false };
    }
    const q = await pool.query(`INSERT INTO tax_invoices (supplier, supplier_name, supplier_bizno, approval_no, kind, orig_approval_no, issue_date, supply_amount, vat_amount, total_amount,
            mail_folder, mail_uid, mail_uidvalidity, mail_subject, mail_at, pdf_name, pdf_data, read_status, read_note, dedup_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (dedup_key) DO UPDATE SET supplier=EXCLUDED.supplier, supplier_name=EXCLUDED.supplier_name, supplier_bizno=EXCLUDED.supplier_bizno, approval_no=EXCLUDED.approval_no,
            kind=EXCLUDED.kind, orig_approval_no=EXCLUDED.orig_approval_no, issue_date=EXCLUDED.issue_date, supply_amount=EXCLUDED.supply_amount, vat_amount=EXCLUDED.vat_amount,
            total_amount=EXCLUDED.total_amount, mail_folder=EXCLUDED.mail_folder, mail_uid=EXCLUDED.mail_uid, mail_uidvalidity=EXCLUDED.mail_uidvalidity, mail_subject=EXCLUDED.mail_subject,
            mail_at=EXCLUDED.mail_at, pdf_name=COALESCE(EXCLUDED.pdf_name, tax_invoices.pdf_name), pdf_data=COALESCE(EXCLUDED.pdf_data, tax_invoices.pdf_data),
            read_status=EXCLUDED.read_status, read_note=EXCLUDED.read_note, updated_at=NOW()
        RETURNING id, (xmax = 0) AS inserted`, [...vals, key]);
    return { id: q.rows[0].id, inserted: !!q.rows[0].inserted };
}
const COLS = `id, supplier, supplier_name, supplier_bizno, approval_no, kind, orig_approval_no, to_char(issue_date, 'YYYY-MM-DD') AS issue_date,
    supply_amount, vat_amount, total_amount, mail_subject, mail_at, (pdf_data IS NOT NULL) AS has_pdf, read_status, read_note, status, memo, confirmed_by, confirmed_at`;
const num = (v) => v == null ? null : Number(v);
const shape = (r) => ({ ...r, supplier_label: LABEL[r.supplier] || LABEL.other, supply_amount: num(r.supply_amount), vat_amount: num(r.vat_amount), total_amount: num(r.total_amount) });
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

// 우리 정산 그 달 합계(읽기만) — sion·hyodon = 정산관리와 같은 단가 재계산 · cj = 박스 수 × 3,100 + 그 달 이월
async function settleTotals(pool, helpers, ym) {
    const from = ym + '-01', to = monthEnd(ym);
    const rows = await helpers.fetchSettlements(pool, helpers, from, to);
    const out = { sion: 0, hyodon: 0, cj: 0, other: null };
    let boxes = 0;
    for (const r of rows) {
        if (r.partner === SETTLE_PARTNER.sion) out.sion += r.amount;
        else if (r.partner === SETTLE_PARTNER.hyodon) out.hyodon += r.amount;
        if (CJ_PARTNERS.includes(r.partner)) boxes += (r.items || []).reduce((q, it) => q + (Number(it && it.qty) || 0), 0);
    }
    const carry = Number(((await pool.query(`SELECT amount FROM cj_carryover WHERE month = $1 LIMIT 1`, [ym])).rows[0] || {}).amount) || 0;
    out.cj = boxes * CJ_BOX_FEE + carry;
    return { boxes, carry, totals: out, basis: { sion: `정산관리 대성(시온) ${Number(ym.slice(5))}월 합계`, hyodon: `정산관리 효돈농협 ${Number(ym.slice(5))}월 합계`, cj: `정산관리 택배비 ${Number(ym.slice(5))}월(박스 ${boxes} × 3,100 + 이월 ${carry.toLocaleString('ko-KR')})`, other: null } };
}

// #823 설정 tax_invoice = balance_start {date, sion:{carry}, hyodon:{carry}} · cj_box_tolerance · 없거나 틀리면 기본(3/29 · 이월 0 · 30박스)
async function balanceStart(pool) {
    let v = null;
    try { v = ((await pool.query(`SELECT value FROM agent_office_config WHERE key = 'tax_invoice'`)).rows[0] || {}).value; } catch (_) { }
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
    const b = v && typeof v === 'object' && v.balance_start && typeof v.balance_start === 'object' ? v.balance_start : {};
    const amt = (k) => { const a = Number(b[k] && b[k].carry); return Number.isFinite(a) ? Math.round(a) : 0; };
    const tol = v && typeof v === 'object' ? v.cj_box_tolerance : null;   // 숫자일 때만(null·true·글자 = 기본)
    return { date: typeof b.date === 'string' && !Number.isNaN(Date.parse(b.date + 'T00:00:00Z')) && isDay(b.date) ? b.date : BALANCE_START_DEFAULT, sion: amt('sion'), hyodon: amt('hyodon'),
        tolerance: typeof tol === 'number' && Number.isFinite(tol) && tol >= 0 ? tol : CJ_BOX_TOLERANCE_DEFAULT };
}
const round1 = (x) => Math.round(x * 10) / 10;

function mount(app, deps) {
    const { pool, authMiddleware, adminOnly, writeAudit } = deps;
    const helpers = { fetchSettlements: deps.fetchSettlements, matchItemToPricing: deps.matchItemToPricing };
    const ready = deps.skipInit ? Promise.resolve() : ensureTable(pool).catch(e => console.error('[#814 계산서] 표 만들기 실패:', String(e.message || e).slice(0, 160)));
    const actorOf = (req) => ({ id: req.user && req.user.id, name: req.user && (req.user.name || req.user.username) });
    const fail = (res, e, where) => { console.error(`[#814 계산서] ${where}:`, String(e && e.message || e).slice(0, 200)); res.status(500).json({ error: '계산서 목록을 읽지 못했어요 — 잠시 뒤 다시' }); };

    // #816 기간 검색(from~to · day 기준 포함 범위 · 달을 넘어도 됨 · 상한 366일) · 없으면 month(없으면 이번 달) · 화면 = 시온·효돈·택배비(CJ)만(「기타」 줄은 표에만 남음)
    app.get('/api/tax-invoices', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const qFrom = req.query.from ? String(req.query.from) : '', qTo = req.query.to ? String(req.query.to) : '';
            let from, to, ym = null;
            if (qFrom || qTo) {
                if (!isDay(qFrom) || !isDay(qTo)) return res.status(400).json({ error: 'from·to 는 둘 다 YYYY-MM-DD' });
                if (qFrom > qTo) return res.status(400).json({ error: '시작일이 종료일보다 늦어요' });
                if ((Date.parse(qTo) - Date.parse(qFrom)) / 86400000 + 1 > MAX_DAYS) return res.status(400).json({ error: `기간은 ${MAX_DAYS}일까지` });
                from = qFrom; to = qTo;
            } else {
                ym = req.query.month ? String(req.query.month) : new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
                if (!YM.test(ym)) return res.status(400).json({ error: 'month 는 YYYY-MM' });
                from = ym + '-01'; to = monthEnd(ym);
            }
            const sup = req.query.supplier == null || req.query.supplier === '' ? null : String(req.query.supplier);
            if (sup && !SHOWN.includes(sup)) return res.status(400).json({ error: 'supplier 는 sion · hyodon · cj' });
            // 날짜 = 작성일자 · 작성일을 못 읽은 줄(확인 필요·오류)은 받은 날(KST)로 — 기간에서 빠지지 않게 · day = 그 기준 날짜
            const DAY = `COALESCE(issue_date, (mail_at AT TIME ZONE 'Asia/Seoul')::date)`;
            const all = (await pool.query(`SELECT ${COLS}, to_char(${DAY}, 'YYYY-MM-DD') AS day FROM tax_invoices
                WHERE supplier IN (${SHOWN_SQL}) AND ${DAY} >= $1::date AND ${DAY} <= $2::date ORDER BY ${DAY}, id`, [from, to])).rows.map(shape);
            // 우리 정산 = 기간이 걸치는 달마다 월 합계를 더함(한 달 안이면 그 달 합계 그대로)
            const months = monthsOf(from, to), settle = { sion: 0, hyodon: 0, cj: 0 }, basis = { sion: [], hyodon: [], cj: [] };
            const ourBoxM = {};   // #823 달마다 CJ 우리 박스 = 박스 수 + 이월 금액 ÷ 3,100
            for (const m of months) { const st = await settleTotals(pool, helpers, m); ourBoxM[m] = st.boxes + st.carry / CJ_BOX_FEE; for (const s of SHOWN) { settle[s] += st.totals[s]; basis[s].push(st.basis[s]); } }
            const checkOf = (g) => g.filter(r => r.read_status !== 'read' || r.total_amount == null).length;
            // #823·#824 묶음 머리 자료 — 시온·효돈 = 입금 기준 미발행(기준일 ~ to · 입금·계산서·정산 같은 끝 · 달 줄 = 달 전체) · CJ = 박스 대조(달마다 달 전체 · 머리 = 달 줄 합) + 달 [대조 확인]
            const bs = await balanceStart(pool), before = to < bs.date;
            const cum = { sion: { settle: 0, invoice: 0, paid: 0, n: 0 }, hyodon: { settle: 0, invoice: 0, paid: 0, n: 0 } };
            if (!before) {
                for (const r of await helpers.fetchSettlements(pool, helpers, bs.date, to)) {
                    if (r.partner === SETTLE_PARTNER.sion) cum.sion.settle += r.amount; else if (r.partner === SETTLE_PARTNER.hyodon) cum.hyodon.settle += r.amount;
                }
                for (const r of (await pool.query(`SELECT supplier, COALESCE(SUM(amount), 0)::bigint AS t, count(*)::int AS n FROM tax_invoice_payments
                    WHERE supplier IN ('sion', 'hyodon') AND deleted_at IS NULL AND paid_on >= $1::date AND paid_on <= $2::date GROUP BY supplier`, [bs.date, to])).rows) { cum[r.supplier].paid = Number(r.t) || 0; cum[r.supplier].n = Number(r.n) || 0; }
            }
            // #824 달 줄(시온·효돈) = 걸린 달마다 그 달 전체 입금·계산서(보류 뺌) · 입금 목록 = from~to 안(지운 것 뺌 · 날짜 내림차순 · 200)
            const mFrom = months[0] + '-01', mTo = monthEnd(months[months.length - 1]);
            const payM = { sion: {}, hyodon: {} }, invM = { sion: {}, hyodon: {} }, payList = { sion: [], hyodon: [] };
            for (const r of (await pool.query(`SELECT supplier, to_char(paid_on, 'YYYY-MM') AS m, COALESCE(SUM(amount), 0)::bigint AS t FROM tax_invoice_payments
                WHERE supplier IN ('sion', 'hyodon') AND deleted_at IS NULL AND paid_on >= $1::date AND paid_on <= $2::date GROUP BY 1, 2`, [mFrom, mTo])).rows) payM[r.supplier][r.m] = Number(r.t) || 0;
            // 기준일 앞 계산서(기준일이 든 달·그 앞 달 표시용) = 짝 맞추기 밖 · 작성일 달에 그대로
            for (const r of (await pool.query(`SELECT supplier, to_char(${DAY}, 'YYYY-MM') AS m, COALESCE(SUM(total_amount), 0)::bigint AS t FROM tax_invoices
                WHERE supplier IN ('sion', 'hyodon') AND status <> 'hold' AND ${DAY} >= $1::date AND ${DAY} <= $2::date AND ${DAY} < $3::date GROUP BY 1, 2`, [mFrom, mTo, bs.date])).rows) invM[r.supplier][r.m] = Number(r.t) || 0;
            // #825 짝 맞추기 — 계산서는 「그 계산서를 다 갚은 입금의 달」에 붙인다(입금 날은 그대로) · supplier 마다 · 보류·지운 입금 뺌
            //   기간(from~to)과 무관하게 기준일 뒤 전부로 짝을 맞추고 표시만 기간으로 자름 · 계산서 = 작성일 오름차순 · 입금 = paid_on 오름차순
            //   입금을 차례로 돌며 가장 오래된 안 갚은 계산서부터 깎음 · 0 이 되는 순간 그 입금 날 = settled_on · 남은 입금(선입금)은 다음 계산서로 이어짐
            //   끝까지 남은 계산서 = open(settled_on null) → 작성일 달에 남음 · 0원 이하 계산서(수정 계산서 등)는 짝 밖 · 작성일 달
            const mat = { sion: [], hyodon: [] }, payAll = { sion: [], hyodon: [] };
            {
                const invs = (await pool.query(`SELECT supplier, to_char(${DAY}, 'YYYY-MM-DD') AS day, total_amount FROM tax_invoices
                    WHERE supplier IN ('sion', 'hyodon') AND status <> 'hold' AND total_amount IS NOT NULL AND ${DAY} >= $1::date ORDER BY ${DAY}, id`, [bs.date])).rows;
                for (const r of invs) { const a = Number(r.total_amount) || 0; mat[r.supplier].push({ day: r.day, amount: a, remain: a > 0 ? a : 0, settled_on: null }); }
                for (const r of (await pool.query(`SELECT supplier, to_char(paid_on, 'YYYY-MM-DD') AS d, amount FROM tax_invoice_payments
                    WHERE supplier IN ('sion', 'hyodon') AND deleted_at IS NULL AND paid_on >= $1::date ORDER BY paid_on, id`, [bs.date])).rows) payAll[r.supplier].push({ d: r.d, a: Number(r.amount) || 0 });
                for (const s of PAY_SUP) {
                    const q = mat[s].filter(v => v.remain > 0); let k = 0;
                    for (const p of payAll[s]) {
                        let left = p.a;
                        while (left > 0 && k < q.length) { const v = q[k], take = Math.min(left, v.remain); v.remain -= take; left -= take; if (v.remain === 0) { v.settled_on = p.d; k++; } }
                    }
                }
            }
            const effM = (v) => (v.settled_on || v.day).slice(0, 7);   // 계산서가 붙는 달
            const preM = { sion: {}, hyodon: {} };   // 작성일 달 → 다른 달로 옮겨진 계산서 {n, a}
            for (const s of PAY_SUP) for (const v of mat[s]) {
                invM[s][effM(v)] = (invM[s][effM(v)] || 0) + v.amount;
                const im = v.day.slice(0, 7);
                if (v.settled_on && effM(v) !== im) { const x = preM[s][im] || (preM[s][im] = { n: 0, a: 0 }); x.n++; x.a += v.amount; }
            }
            if (!before) for (const s of PAY_SUP) cum[s].invoice = mat[s].reduce((a, v) => a + ((v.settled_on || v.day) <= to ? v.amount : 0), 0);
            // 달 줄 balance = 월말 누적 잔액(이월 + 기준일~그 달 말일 입금 − 그 달까지 붙은 계산서)
            const monthBal = (s, m) => bs[s] + payAll[s].reduce((a, p) => a + (p.d.slice(0, 7) <= m ? p.a : 0), 0) - mat[s].reduce((a, v) => a + (effM(v) <= m ? v.amount : 0), 0);
            const preList = (s) => mat[s].filter(v => v.day >= from && v.day <= to && v.settled_on && effM(v) !== v.day.slice(0, 7)).slice(0, 50)
                .map(v => ({ issue_date: v.day, amount: v.amount, paid_on: v.settled_on }));
            // #826 머리 한 줄 = 조회 기간 안 입금 · 「붙은」 계산서(settled_on 또는 작성일 ∈ from~to · 기준일 앞 계산서는 작성일) · 차
            const prePeriod = { sion: 0, hyodon: 0 };
            for (const r of (await pool.query(`SELECT supplier, COALESCE(SUM(total_amount), 0)::bigint AS t FROM tax_invoices
                WHERE supplier IN ('sion', 'hyodon') AND status <> 'hold' AND ${DAY} >= $1::date AND ${DAY} <= $2::date AND ${DAY} < $3::date GROUP BY 1`, [from, to, bs.date])).rows) prePeriod[r.supplier] = Number(r.t) || 0;
            const periodOf = (s) => {
                const ps = payAll[s].filter(p => p.d >= from && p.d <= to), paid = ps.reduce((a, p) => a + p.a, 0);
                const invoice = prePeriod[s] + mat[s].reduce((a, v) => { const d = v.settled_on || v.day; return a + (d >= from && d <= to ? v.amount : 0); }, 0);
                return { from, to, paid, paid_count: ps.length, invoice, diff: paid - invoice };
            };
            for (const s of PAY_SUP) payList[s] = (await pool.query(`SELECT id, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, amount, memo, source, created_name, created_at FROM tax_invoice_payments
                WHERE supplier = $1 AND deleted_at IS NULL AND paid_on >= $2::date AND paid_on <= $3::date ORDER BY paid_on DESC, id DESC LIMIT ${PAY_LIST_MAX}`, [s, from, to])).rows
                .map(r => ({ id: r.id, paid_on: r.paid_on, amount: Number(r.amount), memo: r.memo || '', source: r.source, by: r.created_name, at: r.created_at }));
            const cjCheck = {};
            for (const r of (await pool.query(`SELECT month, checked_name, checked_at FROM tax_invoice_checks WHERE supplier = 'cj' AND month >= $1 AND month <= $2`, [months[0], months[months.length - 1]])).rows)
                cjCheck[r.month] = { by: r.checked_name, at: r.checked_at };
            // CJ 계산서 = 걸린 달마다 그 달 전체(작성일 기준 · 보류 뺌) — 달 중간 조회여도 달 대조가 맞게
            const cjInvM = {};
            for (const r of (await pool.query(`SELECT to_char(${DAY}, 'YYYY-MM') AS m, COALESCE(SUM(total_amount), 0)::bigint AS t FROM tax_invoices
                WHERE supplier = 'cj' AND status <> 'hold' AND ${DAY} >= $1::date AND ${DAY} <= $2::date GROUP BY 1`, [months[0] + '-01', monthEnd(months[months.length - 1])])).rows) cjInvM[r.m] = Number(r.t) || 0;
            const boxRow = (ob, ib) => { const d = round1(ib - ob); return { our_boxes: ob, invoice_boxes: ib, diff_boxes: d, ok: Math.abs(d) <= bs.tolerance }; };
            const statsOf = (s, live) => {
                if (s === 'cj') {
                    const month_rows = months.map(m => ({ month: m, ...boxRow(round1(ourBoxM[m]), round1((cjInvM[m] || 0) / CJ_BOX_FEE)), check: cjCheck[m] || null }));
                    return { mode: 'boxes', unit: CJ_BOX_FEE, vat_included: true, tolerance: bs.tolerance,
                        ...boxRow(round1(month_rows.reduce((a, x) => a + x.our_boxes, 0)), round1(month_rows.reduce((a, x) => a + x.invoice_boxes, 0))), month_rows };
                }
                const c = cum[s];
                return { mode: 'paid', start_date: bs.date, carry: bs[s], cum_paid: c.paid, cum_invoice: c.invoice, cum_settle: c.settle,
                    unissued: bs[s] + c.paid - c.invoice, unpaid: c.settle - c.paid, paid_count: c.n,
                    month_rows: months.map(m => { const p = payM[s][m] || 0, i = invM[s][m] || 0; const x = preM[s][m] || { n: 0, a: 0 };
                        return { month: m, paid: p, invoice: i, diff: p - i, balance: monthBal(s, m), pre_issued_cnt: x.n, pre_issued_amt: x.a }; }),
                    pre_issued: preList(s), period: periodOf(s), payments: payList[s] };
            };
            const groups = SHOWN.map(s => {
                const g = all.filter(r => r.supplier === s), live = g.filter(r => r.status !== 'hold');
                const issued = live.reduce((a, r) => a + (r.total_amount || 0), 0);
                return { supplier: s, label: LABEL[s], count: g.length, check_count: checkOf(g),
                    issued_total: issued, confirmed_total: g.filter(r => r.status === 'confirmed').reduce((a, r) => a + (r.total_amount || 0), 0),
                    settle_total: settle[s], settle_basis: basis[s].join(' + '), diff: issued - settle[s], stats: statsOf(s, live) };
            });
            const rows = all.filter(r => !sup || r.supplier === sup);
            const live = all.filter(r => r.status !== 'hold');
            res.json({ from, to, month: ym, months, rows, groups, totals: { count: all.length, check_count: checkOf(all), issued_total: live.reduce((a, r) => a + (r.total_amount || 0), 0), confirmed_total: all.filter(r => r.status === 'confirmed').reduce((a, r) => a + (r.total_amount || 0), 0) } });
        } catch (e) { fail(res, e, '목록'); }
    });

    app.get('/api/tax-invoices/search', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const q = String(req.query.q || '').normalize('NFC').trim().slice(0, 60);
            if (!q) return res.status(400).json({ error: '찾을 글자를 넣어 주세요' });
            const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%', digits = q.replace(/[^0-9]/g, '');
            const r = await pool.query(`SELECT ${COLS} FROM tax_invoices
                WHERE supplier IN (${SHOWN_SQL}) AND (supplier_name ILIKE $1 OR supplier_bizno ILIKE $1 OR approval_no ILIKE $1 OR memo ILIKE $1 OR mail_subject ILIKE $1
                   OR ($2 <> '' AND (approval_no LIKE '%' || $2 || '%' OR replace(COALESCE(supplier_bizno, ''), '-', '') LIKE '%' || $2 || '%' OR total_amount::text = $2 OR supply_amount::text = $2)))
                ORDER BY issue_date DESC NULLS LAST, id DESC LIMIT 201`, [like, digits.length >= 3 ? digits : '']);
            res.json({ q, rows: r.rows.slice(0, 200).map(shape), more: r.rows.length > 200 });
        } catch (e) { fail(res, e, '찾기'); }
    });

    const setStatus = (to) => async (req, res) => {
        try {
            await ready;
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 이상해요' });
            const memoIn = req.body && req.body.memo != null ? String(req.body.memo).trim() : null;
            if (memoIn != null && memoIn.length > 500) return res.status(400).json({ error: '메모는 500자까지' });
            if (to === 'hold' && !memoIn) return res.status(400).json({ error: '보류는 이유 메모를 적어 주세요' });
            const old = (await pool.query(`SELECT id, status, memo FROM tax_invoices WHERE id = $1`, [id])).rows[0];
            if (!old) return res.status(404).json({ error: '그 계산서가 없어요' });
            const who = actorOf(req), whoName = String(who.name || '').slice(0, 60) || null;
            const memo = memoIn != null && memoIn !== '' ? memoIn : old.memo;
            const row = (await pool.query(to === 'draft'
                ? `UPDATE tax_invoices SET status='draft', confirmed_by=NULL, confirmed_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING ${COLS}`
                : `UPDATE tax_invoices SET status=$2, memo=$3, confirmed_by=$4, confirmed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING ${COLS}`,
                to === 'draft' ? [id] : [id, to, memo, whoName])).rows[0];
            try { await writeAudit({ action: 'tax_invoice_' + (to === 'draft' ? 'reset' : to === 'hold' ? 'hold' : 'confirm'), targetType: 'tax_invoice', targetId: id, changes: { before: { status: old.status, memo: old.memo }, after: { status: row.status, memo: row.memo } }, source: 'tax_invoice', actor: who }); } catch (_) { }
            res.json({ ok: true, row: shape(row) });
        } catch (e) { console.error('[#814 계산서] 상태 바꾸기:', String(e && e.message || e).slice(0, 200)); res.status(500).json({ error: '바꾸지 못했어요 — 잠시 뒤 다시' }); }
    };
    app.post('/api/tax-invoices/:id/confirm', authMiddleware, adminOnly, setStatus('confirmed'));
    app.post('/api/tax-invoices/:id/hold', authMiddleware, adminOnly, setStatus('hold'));
    app.post('/api/tax-invoices/:id/reset', authMiddleware, adminOnly, setStatus('draft'));

    // #823 달 단위 [대조 확인] / 되돌리기 — 계약 docs/823-api.md · 두 번 눌러도 1줄 · 바뀐 때만 감사 1줄
    app.post('/api/tax-invoices/check', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const b = req.body || {}, sup = String(b.supplier || ''), ym = String(b.month || ''), undo = b.undo === true;
            if (!SHOWN.includes(sup)) return res.status(400).json({ error: 'supplier 는 sion · hyodon · cj' });
            if (!YM.test(ym)) return res.status(400).json({ error: 'month 는 YYYY-MM' });
            const who = actorOf(req), whoName = String(who.name || '').slice(0, 60) || null;
            const asCheck = (r) => r ? { supplier: r.supplier, month: r.month, by: r.checked_name, at: r.checked_at } : null;
            let changed, check;
            if (undo) {
                changed = (await pool.query(`DELETE FROM tax_invoice_checks WHERE supplier = $1 AND month = $2 RETURNING supplier`, [sup, ym])).rows.length > 0; check = null;
            } else {
                const ins = (await pool.query(`INSERT INTO tax_invoice_checks (supplier, month, checked_by, checked_name) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (supplier, month) DO NOTHING RETURNING supplier, month, checked_name, checked_at`, [sup, ym, Number.isInteger(who.id) ? who.id : null, whoName])).rows[0];
                changed = !!ins;
                check = asCheck(ins || (await pool.query(`SELECT supplier, month, checked_name, checked_at FROM tax_invoice_checks WHERE supplier = $1 AND month = $2`, [sup, ym])).rows[0]);
            }
            if (changed) { try { await writeAudit({ action: undo ? 'invoice_check_undo' : 'invoice_check', targetType: 'tax_invoice_check', targetId: null, changes: { supplier: sup, month: ym }, source: 'tax_invoice', actor: who }); } catch (_) { } }
            res.json({ ok: true, changed, check });
        } catch (e) { console.error('[#823 계산서] 대조 확인:', String(e && e.message || e).slice(0, 200)); res.status(500).json({ error: '대조 확인을 저장하지 못했어요 — 잠시 뒤 다시' }); }
    });

    // #824 입금 넣기 / 지우기(시온·효돈) — 계약 docs/824-api.md · 관리자 · 감사 source tax_invoice
    const payErr = (res, e, where) => { console.error(`[#824 입금] ${where}:`, String(e && e.message || e).slice(0, 200)); res.status(500).json({ error: '입금을 저장하지 못했어요 — 잠시 뒤 다시' }); };
    app.post('/api/tax-invoices/payments', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const b = req.body || {}, sup = String(b.supplier || ''), day = String(b.paid_on || '');
            const amount = (typeof b.amount === 'number' || (typeof b.amount === 'string' && /^\d+$/.test(b.amount.trim()))) ? Number(b.amount) : NaN;
            const memo = b.memo == null ? '' : String(b.memo).trim();
            if (!PAY_SUP.includes(sup)) return res.status(400).json({ error: 'supplier 는 sion · hyodon' });
            if (!isDay(day)) return res.status(400).json({ error: 'paid_on 은 YYYY-MM-DD' });
            const bs = await balanceStart(pool);
            if (day < bs.date) return res.status(400).json({ error: `기준일(${bs.date}) 앞 입금은 넣지 않아요 — 이월(carry)에 들어 있어요` });
            if (!Number.isInteger(amount) || amount < 1 || amount > PAY_MAX) return res.status(400).json({ error: '금액은 1원 ~ 10억 원 정수' });
            if (memo.length > 200) return res.status(400).json({ error: '메모는 200자까지' });
            // #829 같은 날 같은 금액 입금이 진짜 둘일 수 있음 → 있으면 409 { dup:true } · 사람이 확인하고 force:true 로 다시 보내면 넣음
            if (b.force !== true && (await pool.query(`SELECT 1 FROM tax_invoice_payments WHERE supplier = $1 AND paid_on = $2::date AND amount = $3 AND deleted_at IS NULL LIMIT 1`, [sup, day, amount])).rows.length)
                return res.status(409).json({ error: '같은 입금이 이미 있어요', dup: true, hint: '진짜 같은 날 같은 금액 입금이 또 있으면 「그래도 넣기」(force:true)' });
            const who = actorOf(req), whoName = String(who.name || '').slice(0, 60) || null;
            const id = (await pool.query(`INSERT INTO tax_invoice_payments (supplier, paid_on, amount, memo, source, created_by, created_name) VALUES ($1, $2::date, $3, $4, 'manual', $5, $6) RETURNING id`,
                [sup, day, amount, memo, Number.isInteger(who.id) ? who.id : null, whoName])).rows[0].id;
            try { await writeAudit({ action: 'payment_add', targetType: 'tax_invoice_payment', targetId: id, changes: { supplier: sup, paid_on: day, amount, source: 'manual', ...(b.force === true ? { force: true } : {}) }, source: 'tax_invoice', actor: who }); } catch (_) { }
            res.json({ ok: true, id });
        } catch (e) { payErr(res, e, '넣기'); }
    });
    // #824 엑셀 가져오기 — dry = 무엇이 들어갈지만 · 기준일 앞 건너뜀 · 파일·금액은 로그에 안 찍음
    //   #829 같은 거래처+날짜+금액 = 파일 안 n줄이면 n줄(파일 안 순서) · 표에 이미 m줄이면 n−m 줄만 더함(다시 올려도 0 · 같은 날 같은 금액 둘째 입금도 살림)
    app.post('/api/tax-invoices/payments/import', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const b = req.body || {}, dry = b.dry !== false;
            const b64 = typeof b.data === 'string' ? b.data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '';
            if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return res.status(400).json({ error: 'data 는 base64 엑셀 파일' });
            if (Math.floor(b64.length * 3 / 4) > IMPORT_MAX_BYTES + 3) return res.status(400).json({ error: '파일은 5MB 까지' });
            const buf = Buffer.from(b64, 'base64');
            if (buf.length > IMPORT_MAX_BYTES) return res.status(400).json({ error: '파일은 5MB 까지' });
            let x;
            try { x = await readPaymentsXlsx(buf); } catch (_) { return res.status(400).json({ error: '엑셀을 읽지 못했어요 — xlsx 파일인지 확인해 주세요' }); }
            if (!x.sheets.length) return res.status(400).json({ error: '「대성」·「효돈」 시트가 없어요' });
            const bs = await balanceStart(pool);
            const fresh = [], seq = new Map(), have = new Map(); let dup = 0, beforeStart = 0;
            for (const r of x.rows) {
                if (r.paid_on < bs.date) { beforeStart++; continue; }
                const k = r.supplier + '|' + r.paid_on + '|' + r.amount;
                const n = (seq.get(k) || 0) + 1; seq.set(k, n);   // 이 줄 = 파일 안 같은 열쇠의 n 번째
                if (!have.has(k)) have.set(k, (await pool.query(`SELECT count(*)::int AS n FROM tax_invoice_payments WHERE supplier = $1 AND paid_on = $2::date AND amount = $3 AND deleted_at IS NULL`, [r.supplier, r.paid_on, r.amount])).rows[0].n);
                if (n <= have.get(k)) { dup++; continue; }
                fresh.push({ ...r, seq: n });
            }
            const out = { ok: true, dry, new: fresh.map(r => ({ supplier: r.supplier, paid_on: r.paid_on, amount: r.amount })), dup, before_start: beforeStart, unreadable: x.unreadable, sheets: x.sheets };
            if (dry) return res.json(out);
            const who = actorOf(req), whoName = String(who.name || '').slice(0, 60) || null, uid = Number.isInteger(who.id) ? who.id : null;
            let inserted = 0;
            for (const r of fresh) {
                inserted += (await pool.query(`INSERT INTO tax_invoice_payments (supplier, paid_on, amount, memo, source, created_by, created_name)
                    SELECT $1, $2::date, $3, $4, 'excel', $5, $6 WHERE (SELECT count(*) FROM tax_invoice_payments WHERE supplier = $1 AND paid_on = $2::date AND amount = $3 AND deleted_at IS NULL) < $7::int RETURNING id`,
                    [r.supplier, r.paid_on, r.amount, r.memo, uid, whoName, r.seq])).rows.length;   // 그 사이 누가 넣었으면 seq 까지만
            }
            if (inserted) { try { await writeAudit({ action: 'payment_import', targetType: 'tax_invoice_payment', targetId: null, changes: { inserted, dup, before_start: beforeStart, unreadable: x.unreadable }, source: 'tax_invoice', actor: who }); } catch (_) { } }
            res.json({ ...out, inserted });
        } catch (e) { payErr(res, e, '엑셀 가져오기'); }
    });
    app.delete('/api/tax-invoices/payments/:id', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 이상해요' });
            const r = (await pool.query(`UPDATE tax_invoice_payments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, supplier, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, amount`, [id])).rows[0];
            if (!r) return res.status(404).json({ error: '그 입금이 없어요(이미 지웠거나 없는 번호)' });
            try { await writeAudit({ action: 'payment_del', targetType: 'tax_invoice_payment', targetId: id, changes: { supplier: r.supplier, paid_on: r.paid_on, amount: Number(r.amount) }, source: 'tax_invoice', actor: actorOf(req) }); } catch (_) { }
            res.json({ ok: true });
        } catch (e) { payErr(res, e, '지우기'); }
    });

    app.get('/api/tax-invoices/:id/pdf', authMiddleware, adminOnly, async (req, res) => {
        try {
            await ready;
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 이상해요' });
            const r = (await pool.query(`SELECT pdf_name, pdf_data FROM tax_invoices WHERE id = $1`, [id])).rows[0];
            if (!r || !r.pdf_data) return res.status(404).json({ error: 'PDF 없음' });
            const name = String(r.pdf_name || ('계산서_' + id + '.pdf')).replace(/[\r\n"]/g, '');
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
            res.set('Cache-Control', 'private, no-store');
            res.send(Buffer.isBuffer(r.pdf_data) ? r.pdf_data : Buffer.from(r.pdf_data));
        } catch (e) { console.error('[#814 계산서] PDF:', String(e && e.message || e).slice(0, 200)); res.status(500).json({ error: 'PDF 를 열지 못했어요' }); }
    });
    return { ready, settleTotals: (ym) => settleTotals(pool, helpers, ym) };
}
module.exports = { mount, ensureTable, upsertRow, dedupKeyOf, settleTotals, balanceStart, readPaymentsXlsx, SUPPLIERS, SHOWN, LABEL };

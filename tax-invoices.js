// #814 계산서 발행현황 — 서버(표 tax_invoices · 정산관리 「계산서 발행현황」 탭 API) · 계약 = docs/814-api.md
//   채우는 길 = 창구 scripts/desk/invoice-month.js(메일 색인 → 첨부 PDF → 풀기 → upsertRow) · 이 모듈은 읽기·확인·보류·PDF 내주기만
//   🔴 확인 전 숫자는 화면에만 — 정산 합계·박스·입금 어디에도 안 섞는다(대표 10/21) · 우리 정산 월 합계는 읽어서 「차이」 표시만(자동 맞춤 0)
'use strict';

const SUPPLIERS = ['cj', 'sion', 'hyodon', 'other'];
const LABEL = { cj: 'CJ대한통운(택배비)', sion: '시온(조천감귤농협)', hyodon: '효돈농협유통', other: '기타' };
const SETTLE_PARTNER = { sion: '대성(시온)', hyodon: '효돈농협' };
const CJ_PARTNERS = ['대성(시온)', '효돈농협', '기타거래처'], CJ_BOX_FEE = 3100;   // 정산관리와 같은 계산(agents/세미.js)
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
    return { totals: out, basis: { sion: `정산관리 대성(시온) ${Number(ym.slice(5))}월 합계`, hyodon: `정산관리 효돈농협 ${Number(ym.slice(5))}월 합계`, cj: `정산관리 택배비 ${Number(ym.slice(5))}월(박스 ${boxes} × 3,100 + 이월 ${carry.toLocaleString('ko-KR')})`, other: null } };
}

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
            for (const m of months) { const st = await settleTotals(pool, helpers, m); for (const s of SHOWN) { settle[s] += st.totals[s]; basis[s].push(st.basis[s]); } }
            const checkOf = (g) => g.filter(r => r.read_status !== 'read' || r.total_amount == null).length;
            const groups = SHOWN.map(s => {
                const g = all.filter(r => r.supplier === s), live = g.filter(r => r.status !== 'hold');
                const issued = live.reduce((a, r) => a + (r.total_amount || 0), 0);
                return { supplier: s, label: LABEL[s], count: g.length, check_count: checkOf(g),
                    issued_total: issued, confirmed_total: g.filter(r => r.status === 'confirmed').reduce((a, r) => a + (r.total_amount || 0), 0),
                    settle_total: settle[s], settle_basis: basis[s].join(' + '), diff: issued - settle[s] };
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
module.exports = { mount, ensureTable, upsertRow, dedupKeyOf, settleTotals, SUPPLIERS, SHOWN, LABEL };

// #814 검증 — 계산서 발행현황(tax-invoices.js · 창구 invoice-month.js · pdf-unlock.py) · 실DB·실메일 0
//   DB = 이 PC 메모리 안 Postgres(pglite · 실제 SQL 그대로 돌림) · 메일 러너 = 가짜(요청 줄에 바로 결과) · PDF = PyMuPDF 로 만든 비밀번호 건 시험 PDF
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-814-tax-invoice.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
const PGL = process.env.PGLITE_DIR;
if (!PGL) { console.log('PGLITE_DIR 가 없어요 — npm i @electric-sql/pglite 한 폴더를 주세요'); process.exit(2); }
const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
const TI = require(path.join(ROOT, 'tax-invoices.js'));
const IM = require(path.join(__dirname, 'desk', 'invoice-month.js'));
const SEMI = require(path.join(ROOT, 'agents', '세미.js'));
const OUR = '4228104127';

function mkPool(db, hook) {
    const conv = (v) => (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array)) ? JSON.stringify(v) : v;
    return { async query(sql, p = []) { if (hook) { const h = await hook(sql, p); if (h) return h; } const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; } };
}
function mkPdf(file, text, pw) {
    const py = `import sys\ntry:\n    import pymupdf as fitz\nexcept Exception:\n    import fitz\nd=fitz.open();p=d.new_page()\ny=60\nfor ln in sys.argv[3].split("\\n"):\n    p.insert_text((40,y),ln,fontname="korea",fontsize=10);y+=16\nif sys.argv[2]:\n    d.save(sys.argv[1],encryption=fitz.PDF_ENCRYPT_AES_256,user_pw=sys.argv[2],owner_pw=sys.argv[2])\nelse:\n    d.save(sys.argv[1])\n`;
    const pf = path.join(os.tmpdir(), 'mk814.py'); fs.writeFileSync(pf, py);
    const r = spawnSync('python', ['-P', pf, file, pw || '', text], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('시험 PDF 못 만듦: ' + r.stderr);
}
const SION_TXT = '전자계산서\n승인번호 20261005-41000000-12345678\n작성일자 2026-10-05\n공급자 등록번호 616-82-12345 상호 조천감귤농협 제주조천점\n공급받는자 등록번호 422-81-04127 상호 제주아꼼이네\n공급가액 1,250,000\n세액 0\n합계금액 1,250,000';
const CJ_TXT = '전자세금계산서\n승인번호 20261031-41000000-00000099\n작성일자 2026년 10월 31일\n공급자 등록번호 110-81-05034 씨제이대한통운\n공급받는자 등록번호 422-81-04127\n공급가액 2,000,000\n세액 200,000\n합계금액 2,200,000';

(async () => {
    console.log('① 계산서 글 읽기(parseInvoiceText)');
    {
        const a = IM.parseInvoiceText(SION_TXT, OUR);
        ok(a.approval_no === '202610054100000012345678' && a.issue_date === '2026-10-05' && a.supplier_bizno === '616-82-12345' && a.supply_amount === 1250000 && a.vat_amount === 0 && a.total_amount === 1250000 && a.kind === 'free', '계산서(면세) = 승인번호·작성일·공급자 번호(우리 번호 빼고)·금액', a);
        const b = IM.parseInvoiceText(CJ_TXT, OUR);
        ok(b.kind === 'tax' && b.issue_date === '2026-10-31' && b.supply_amount === 2000000 && b.vat_amount === 200000 && b.total_amount === 2200000 && b.supplier_bizno === '110-81-05034', '세금계산서 = 「2026년 10월 31일」 꼴 · 세액', b);
        const c = IM.parseInvoiceText('세금계산서 발행 안내 · 작성일자 2026.10.12 · 공급가액 100,000 세액 10,000', OUR);
        ok(c.total_amount === 110000 && !c.approval_no && IM.isRead(c) === false, '합계 칸 없으면 공급가액+세액 · 승인번호·공급자 번호 둘 다 없으면 「확인 필요」', c);
        const d = IM.parseInvoiceText('수정세금계산서 승인번호 20261020-41000000-00000001 원승인번호 20261005-41000000-12345678 작성일자 2026-10-20 공급가액 -50,000 세액 -5,000 합계금액 -55,000 공급자 110-81-05034', OUR);
        ok(d.kind === 'modify' && d.orig_approval_no === '202610054100000012345678' && d.total_amount === -55000, '수정 발행 = 원 승인번호 · 음수 금액', d);
    }

    const db = new PGlite();
    await db.exec(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
        CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
        CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, created_by TEXT);
        CREATE TABLE settlements (id SERIAL PRIMARY KEY, date DATE, partner VARCHAR(50), amount NUMERIC DEFAULT 0, items JSONB DEFAULT '[]');
        CREATE TABLE pricing (id SERIAL PRIMARY KEY, partner VARCHAR(50), start_date DATE, end_date DATE, items JSONB);
        CREATE TABLE product_mappings (partner TEXT, sales_name TEXT, pricing_name TEXT);
        CREATE TABLE cj_carryover (id SERIAL PRIMARY KEY, month VARCHAR(7) UNIQUE, amount INTEGER DEFAULT 0);
        CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action TEXT, target_type TEXT, target_id INTEGER, changes JSONB, source TEXT, actor_id INTEGER, actor_name TEXT);
        CREATE TABLE mail_index (id SERIAL PRIMARY KEY, folder TEXT, folder_name TEXT, uidvalidity BIGINT, uid BIGINT, from_addr TEXT, from_name TEXT, subject TEXT, msg_date TEXT, at TIMESTAMPTZ, has_attach BOOLEAN, attach_names TEXT, size INTEGER, parsed JSONB, indexed_at TIMESTAMPTZ DEFAULT NOW());
        INSERT INTO settlements (date, partner, amount, items) VALUES
          ('2026-10-03','대성(시온)',0,'[{"name":"감귤","qty":10,"price":100000}]'), ('2026-10-20','대성(시온)',0,'[{"name":"감귤","qty":2,"price":130000}]'),
          ('2026-10-04','효돈농협',0,'[{"name":"하우스","qty":5,"price":20000}]'), ('2026-09-30','대성(시온)',0,'[{"name":"감귤","qty":99,"price":1}]');
        INSERT INTO cj_carryover (month, amount) VALUES ('2026-10', 4000);`);
    const pool = mkPool(db);

    console.log('② 표 · 넣기(중복 0 · 사람이 누른 것 보존)');
    await TI.ensureTable(pool); await TI.ensureTable(pool);
    const base = { supplier: 'sion', supplier_name: '조천감귤농협', mail_folder: 'INBOX', mail_uid: 501, mail_uidvalidity: 7, mail_subject: '(제주조천점->제주아꼼이네)', mail_at: '2026-10-05T01:00:00Z' };
    const u1 = await TI.upsertRow(pool, { ...base, read_status: 'check', read_note: '일부 못 읽음' });
    const u2 = await TI.upsertRow(pool, { ...base, ...IM.parseInvoiceText(SION_TXT, OUR), read_status: 'read', pdf_name: 'a.pdf', pdf_data: Buffer.from('%PDF-1.4 x') });
    let rows = (await pool.query(`SELECT id, dedup_key, status, read_status, total_amount FROM tax_invoices`)).rows;
    ok(u1.inserted && !u2.inserted && u1.id === u2.id && rows.length === 1 && rows[0].dedup_key === 'a:202610054100000012345678' && rows[0].read_status === 'read', '같은 메일에 승인번호가 나중에 읽혀도 같은 줄(m: → a:) · 새 줄 0', rows);
    await pool.query(`UPDATE tax_invoices SET status='confirmed', memo='대표 확인', confirmed_by='대표' WHERE id=$1`, [u1.id]);
    const u3 = await TI.upsertRow(pool, { ...base, ...IM.parseInvoiceText(SION_TXT, OUR), read_status: 'read' });
    rows = (await pool.query(`SELECT status, memo, confirmed_by, (pdf_data IS NOT NULL) AS has_pdf FROM tax_invoices`)).rows;
    ok(!u3.inserted && rows.length === 1 && rows[0].status === 'confirmed' && rows[0].memo === '대표 확인' && rows[0].has_pdf, '다시 돌려도 새 줄 0 · 확인·메모 그대로 · PDF 없이 와도 있던 PDF 유지', rows);
    let dupErr = null; try { await pool.query(`INSERT INTO tax_invoices (approval_no, dedup_key) VALUES ('202610054100000012345678', 'x')`); } catch (e) { dupErr = e; }
    ok(!!dupErr, '승인번호 UNIQUE(다른 키로 같은 승인번호 = 거절)');
    await TI.upsertRow(pool, { supplier: 'cj', mail_folder: 'INBOX', mail_uid: 502, mail_uidvalidity: 7, ...IM.parseInvoiceText(CJ_TXT, OUR), read_status: 'read' });
    await TI.upsertRow(pool, { supplier: 'sion', mail_folder: 'INBOX', mail_uid: 503, mail_uidvalidity: 7, approval_no: '202610204100000000000777', issue_date: '2026-10-20', total_amount: 260000, read_status: 'read' });
    await TI.upsertRow(pool, { supplier: 'hyodon', mail_folder: 'INBOX', mail_uid: 504, mail_uidvalidity: 7, issue_date: '2026-10-12', total_amount: 90000, read_status: 'check', read_note: '그림 PDF' });
    await TI.upsertRow(pool, { supplier: 'sion', mail_folder: 'INBOX', mail_uid: 505, mail_uidvalidity: 7, approval_no: '202609304100000000000001', issue_date: '2026-09-30', total_amount: 99, read_status: 'read' });

    console.log('③ API(정산관리 탭 · adminOnly)');
    const express = require(path.join(ROOT, 'node_modules', 'express'));
    const app = express(); app.use(express.json());
    let role = 'admin';
    const auth = (req, res, next) => { req.user = { id: 1, name: '대표', role }; next(); };
    const adminOnly = (req, res, next) => role === 'admin' ? next() : res.status(403).json({ error: '관리자만' });
    const audits = [];
    TI.mount(app, { pool, authMiddleware: auth, adminOnly, writeAudit: async (a) => { audits.push(a); }, matchItemToPricing: () => undefined, fetchSettlements: SEMI._fetchSettlements, skipInit: true });
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, r)); const PORT = srv.address().port;
    const call = async (m, p, body) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get('content-type') || ''; return { s: r.status, ct, j: /json/.test(ct) ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
    let r = await call('GET', '/api/tax-invoices?month=2026-10');
    const g = (k) => r.j.groups.find(x => x.supplier === k);
    ok(r.s === 200 && r.j.rows.length === 4 && r.j.groups.map(x => x.supplier).join() === 'sion,hyodon,cj' && !('days' in r.j) && r.j.from === '2026-10-01' && r.j.to === '2026-10-31' && r.j.totals.check_count === 1, '그 달 4줄(9월 줄 빠짐) · 묶음 = 시온·효돈·택배비 3개 고정 · days 칸 없음 · from/to · 확인 필요 합', r.j && { n: r.j.rows.length, g: r.j.groups.map(x => x.supplier), t: r.j.totals });
    ok(g('sion').issued_total === 1510000 && g('sion').settle_total === 1260000 && g('sion').diff === 250000 && g('sion').confirmed_total === 1250000, '시온 = 발행 1,510,000 · 정산관리 10월 1,260,000(9월 제외) · 차이 +250,000 · 확인분 따로', g('sion'));
    ok(g('cj').settle_total === 17 * 3100 + 4000 && g('cj').diff === 2200000 - (17 * 3100 + 4000) && g('hyodon').check_count === 1 && r.j.groups.length === 3 && !g('other'), 'CJ = 박스 17 × 3,100 + 이월 4,000 · 효돈 확인 필요 1 · 기타 묶음 없음', { cj: g('cj'), hy: g('hyodon') });
    ok(r.j.rows[0].supplier_label && typeof r.j.rows[0].total_amount === 'number' && r.j.rows.every(x => !('pdf_data' in x)), '줄 = 라벨·숫자 꼴 · PDF 바이트는 목록에 안 실음');
    r = await call('GET', '/api/tax-invoices?from=2026-10-05&to=2026-10-20');
    ok(r.s === 200 && r.j.rows.map(x => x.day).join() === '2026-10-05,2026-10-12,2026-10-20' && r.j.months.join() === '2026-10' && g('sion').settle_total === 1260000, '기간 = 시작일·종료일 포함(10/31 빠짐) · 한 달 안 = 그 달 정산 합계', r.j && r.j.rows.map(x => x.day));
    r = await call('GET', '/api/tax-invoices?from=2026-10-05&to=2026-10-20&supplier=sion');
    ok(r.s === 200 && r.j.rows.length === 2 && r.j.rows.every(x => x.supplier === 'sion') && r.j.groups.length === 3 && g('hyodon').count === 1, '거래처 거름 = 줄만(묶음 머리 3개는 기간 전체)');
    r = await call('GET', '/api/tax-invoices?from=2026-09-15&to=2026-10-31');
    ok(r.s === 200 && r.j.rows.length === 5 && r.j.months.join() === '2026-09,2026-10' && g('sion').issued_total === 1510099 && g('sion').settle_total === 1260099 && g('sion').diff === 250000 && /9월/.test(g('sion').settle_basis) && /10월/.test(g('sion').settle_basis) && g('cj').settle_total === 99 * 3100 + 17 * 3100 + 4000 && r.j.month === null, '달 넘김 = 9/30 줄 포함 · 정산 합계 = 9월 + 10월 · 근거 글에 두 달', r.j && { g: r.j.groups, m: r.j.months });
    r = await call('GET', '/api/tax-invoices'); ok(r.s === 200 && /^\d{4}-\d{2}-01$/.test(r.j.from) && r.j.groups.length === 3, '아무것도 없으면 = 이번 달');
    const bad = ['month=2026-13', 'from=2026-10-01', 'to=2026-10-01', 'from=2026-10-20&to=2026-10-05', 'from=2026-02-30&to=2026-03-01', 'from=2025-01-01&to=2026-01-02', 'month=2026-10&supplier=other', 'month=2026-10&supplier=x'];
    const badS = []; for (const q of bad) badS.push((await call('GET', '/api/tax-invoices?' + q)).s);
    ok(badS.every(x => x === 400) && (await call('GET', '/api/tax-invoices?from=2025-01-01&to=2026-01-01')).s === 200, '틀린 값 = 400(한쪽만 · 거꾸로 · 없는 날 · 366일 넘음 · 기타·모르는 거래처) · 366일 딱 = 200', badS);
    const hy = (await call('GET', '/api/tax-invoices?month=2026-10&supplier=hyodon')).j.rows[0];
    ok((await call('POST', `/api/tax-invoices/${hy.id}/hold`, {})).s === 400, '보류는 메모 필수');
    r = await call('POST', `/api/tax-invoices/${hy.id}/hold`, { memo: '금액 다름 · 거래처 문의' });
    ok(r.s === 200 && r.j.row.status === 'hold' && r.j.row.confirmed_by === '대표', '보류 = 상태·누른 사람');
    r = await call('GET', '/api/tax-invoices?month=2026-10'); ok(g('hyodon').issued_total === 0 && g('hyodon').count === 1, '보류 줄은 발행 합계에서 빠짐(줄은 남음)', g('hyodon'));
    r = await call('POST', `/api/tax-invoices/${hy.id}/reset`); ok(r.s === 200 && r.j.row.status === 'draft' && r.j.row.confirmed_by == null && r.j.row.memo === '금액 다름 · 거래처 문의', '되돌리기 = 초안 · 메모는 남김');
    r = await call('POST', `/api/tax-invoices/${hy.id}/confirm`, { memo: '확인함' }); ok(r.s === 200 && r.j.row.status === 'confirmed' && r.j.row.memo === '확인함', '확인 + 메모');
    ok(audits.length === 3 && audits.map(a => a.action).join() === 'tax_invoice_hold,tax_invoice_reset,tax_invoice_confirm' && audits[0].targetId === hy.id && audits[0].changes.before.status === 'draft', '감사 기록 3줄(전/후 상태)');
    ok((await call('POST', '/api/tax-invoices/99999/confirm', {})).s === 404, '없는 id = 404');
    r = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('12345678')); ok(r.s === 200 && r.j.rows.length === 1 && r.j.rows[0].approval_no === '202610054100000012345678', '찾기 = 승인번호 일부(전체 기간)');
    r = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('2,200,000')); ok(r.j.rows.length === 1 && r.j.rows[0].supplier === 'cj', '찾기 = 금액(쉼표 무시)');
    r = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('조천')); ok(r.j.rows.length >= 1 && r.j.rows.every(x => /조천/.test((x.supplier_name || '') + (x.mail_subject || ''))), '찾기 = 공급자 이름(한글)');
    r = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('조%천')); ok(r.s === 200 && r.j.rows.length === 0, '% 는 글자 그대로(「조%천」 = 0)');
    r = await call('GET', `/api/tax-invoices/${u1.id}/pdf`); ok(r.s === 200 && /application\/pdf/.test(r.ct) && r.j.slice(0, 5).toString() === '%PDF-', 'PDF 열기 = application/pdf');
    ok((await call('GET', `/api/tax-invoices/${hy.id}/pdf`)).s === 404, 'PDF 없는 줄 = 404');
    await TI.upsertRow(pool, { supplier: 'hyodon', mail_folder: 'INBOX', mail_uid: 506, mail_uidvalidity: 7, mail_subject: '시험 오류 메일', mail_at: '2026-10-07T03:00:00Z', read_status: 'error', read_note: '첨부 받기 실패' });
    await TI.upsertRow(pool, { supplier: 'hyodon', mail_folder: 'INBOX', mail_uid: 507, mail_uidvalidity: 7, mail_subject: '시험 9월 메일', mail_at: '2026-09-30T16:00:00Z', read_status: 'check' });   // KST 10/1 01시 = 10월
    await TI.upsertRow(pool, { supplier: 'other', mail_folder: 'INBOX', mail_uid: 508, mail_uidvalidity: 7, mail_subject: '시험 기타 메일', mail_at: '2026-10-07T03:00:00Z', issue_date: '2026-10-07', total_amount: 777, approval_no: '202610074100000000000808', read_status: 'read' });   // 기타 = 표에만
    r = await call('GET', '/api/tax-invoices?month=2026-10');
    { const e = r.j.rows.find(x => x.mail_subject === '시험 오류 메일'), n = r.j.rows.find(x => x.mail_subject === '시험 9월 메일');
      ok(e && e.issue_date == null && e.day === '2026-10-07' && n && n.day === '2026-10-01' && g('hyodon').check_count === 3 && g('hyodon').issued_total === 90000, '작성일 못 읽은 줄 = 받은 날(KST)의 달·날짜로 목록에 나옴 · 확인 필요 수에 셈 · 합계 0', { e, n, hy: g('hyodon') }); }
    ok(!r.j.rows.some(x => x.supplier === 'other') && r.j.totals.count === 6 && r.j.totals.issued_total === 1510000 + 2200000 + 90000, '기타 줄 = 목록·묶음·합계 어디에도 없음(표엔 남음)', r.j.totals);
    r = await call('GET', '/api/tax-invoices?from=2026-10-07&to=2026-10-07'); ok(r.j.rows.length === 1 && r.j.rows[0].read_status === 'error', '기간 거름도 같은 기준(받은 날) · 같은 날 기타 줄은 안 나옴');
    r = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('시험 기타')); const r2 = await call('GET', '/api/tax-invoices/search?q=' + encodeURIComponent('0808'));
    ok(r.j.rows.length === 0 && r2.j.rows.length === 0 && (await db.query(`SELECT count(*)::int AS n FROM tax_invoices WHERE supplier = 'other'`)).rows[0].n === 1, '찾기도 기타 줄 안 나옴(제목·승인번호) · 표엔 1줄 그대로');
    r = await call('GET', '/api/tax-invoices?month=2026-09'); ok(!r.j.rows.some(x => /^시험 /.test(x.mail_subject || '')), '받은 날 KST 기준이라 9/30 16시(UTC) 메일은 9월에 안 나옴');
    role = 'staff'; ok((await call('GET', '/api/tax-invoices?month=2026-10')).s === 403 && (await call('POST', `/api/tax-invoices/${hy.id}/hold`, { memo: 'x' })).s === 403, '직원 계정 = 403(대표·경리만)'); role = 'admin';
    srv.close();

    console.log('④ 창구 도구(invoice-month.js) — 가짜 메일 러너 + 비밀번호 건 시험 PDF');
    {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v814-'));
        const pdfSion = path.join(tmp, 's.pdf'), pdfCj = path.join(tmp, 'c.pdf'), pdfBad = path.join(tmp, 'b.pdf');
        mkPdf(pdfSion, SION_TXT.replace('12345678', '22222222').replace('2026-10-05', '2026-10-06'), OUR);
        mkPdf(pdfCj, CJ_TXT.replace('00000099', '00000098'), OUR);
        mkPdf(pdfBad, SION_TXT, 'other-password');
        const db2 = new PGlite();
        await db2.exec(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
            CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, created_by TEXT);
            CREATE TABLE mail_index (id SERIAL PRIMARY KEY, folder TEXT, folder_name TEXT, uidvalidity BIGINT, uid BIGINT, from_addr TEXT, from_name TEXT, subject TEXT, msg_date TEXT, at TIMESTAMPTZ, has_attach BOOLEAN, attach_names TEXT, size INTEGER, parsed JSONB, indexed_at TIMESTAMPTZ DEFAULT NOW());
            INSERT INTO mail_index (folder, uidvalidity, uid, from_name, subject, at, parsed) VALUES
              ('INBOX', 7, 11, '홈택스', '(제주조천점->제주아꼼이네)', '2026-10-06T02:00:00Z', '{"kind":"tax_invoice","supplier":"sion"}'),
              ('INBOX', 7, 12, '강주아', '[전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 제주아꼼이네', '2026-11-03T02:00:00Z', '{"kind":"tax_invoice","supplier":"cj"}'),
              ('INBOX', 7, 13, '홈택스', '(효돈농협유통->제주아꼼이네)', '2026-10-13T02:00:00Z', '{"kind":"tax_invoice","supplier":"hyodon"}'),
              ('INBOX', 7, 14, '홈택스', '(제주조천점->제주아꼼이네)', '2026-10-15T02:00:00Z', '{"kind":"tax_invoice","supplier":"sion"}'),
              ('INBOX', 7, 15, '에프씨', '(제주아꼼이네->에프씨컨슈머(F.C.C))', '2026-10-15T02:00:00Z', '{"kind":"tax_invoice_other"}'),
              ('INBOX', 7, 16, '강주아', '늦은 것', '2026-11-12T02:00:00Z', '{"kind":"tax_invoice","supplier":"cj"}');`);
        await db2.query(`INSERT INTO agent_office_config (key, value) VALUES ('tax_invoice', $1), ('mail_index_state', $2)`, [JSON.stringify({ pdf_password: OUR }), JSON.stringify({ initial_done: true })]);
        const MAILS = { 11: { pdf: pdfSion, name: '계산서_시온.pdf', text: '안내' }, 12: { pdf: pdfCj, name: 'cj.pdf', text: '' }, 13: { pdf: null, text: '홈택스 발급 안내\n작성일자 2026-10-12\n공급가액 90,000\n세액 0\n합계금액 90,000\n승인번호 20261012-41000000-00000013' }, 14: { pdf: pdfBad, name: 'bad.pdf', text: '' } };
        const reqs = [];
        const hook = async (sql, p) => {
            const m = /INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(sql) && /^mail_(read|attach)_request$/.exec(p[0]);
            if (!m) return null;
            const req = JSON.parse(p[1]); reqs.push({ op: m[1], ...req }); const mm = MAILS[req.uid];
            let res;
            if (m[1] === 'read') res = { id: req.id, ok: true, mail: { uid: req.uid, text: mm.text, attachments: mm.pdf ? [{ part: '2', name: mm.name, type: 'application/pdf', size: 100 }] : [] } };
            else { const data = fs.readFileSync(mm.pdf); const fr = await db2.query(`INSERT INTO report_files (filename, data, size_bytes) VALUES ($1, $2, $3) RETURNING id`, [mm.name, data, data.length]); res = { id: req.id, ok: true, file_id: fr.rows[0].id, type: 'application/pdf' }; }
            await db2.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, ['mail_' + m[1] + '_result', JSON.stringify(res)]);
            return { rows: [], rowCount: 1 };
        };
        const pool2 = mkPool(db2, hook);
        const printed = [];
        const run = (args) => IM.main(args, { pool: pool2, sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: (s) => printed.push(s) });
        let o = await run(['2026-10', '--dry']);
        ok(o.ok && o.dry && o.counts.mails === 4 && (await db2.query(`SELECT to_regclass('public.tax_invoices') IS NULL AS no`)).rows[0].no, '--dry = 메일 4통(그 달 1일~다음 달 10일 · F.C.C·11/12 빠짐) · 표 안 만듦', o.counts);
        o = await run(['2026-10']);
        const tv = (await db2.query(`SELECT supplier, issue_date::text AS d, total_amount::int AS t, read_status, read_note, (pdf_data IS NOT NULL) AS pdf, approval_no FROM tax_invoices ORDER BY mail_uid`)).rows;
        ok(o.counts.read === 2 && o.counts.check === 1 && o.counts.error === 1 && o.counts.inserted === 4 && tv.length === 4, '읽힘 2(PDF) · 확인 필요 1(첨부 없는 본문형) · 비밀번호 틀린 PDF = 오류 1', { c: o.counts, tv });
        const s11 = tv[0], c12 = tv[1], h13 = tv[2], b14 = tv[3];
        ok(s11.d === '2026-10-06' && s11.t === 1250000 && s11.pdf && s11.read_status === 'read' && s11.approval_no === '202610054100000022222222', '시온 PDF = 풀어서 읽음 · 풀린 PDF 저장', s11);
        ok(c12.d === '2026-10-31' && c12.t === 2200000 && c12.read_status === 'read', 'CJ = 11/3 받았어도 작성일 10/31 → 10월 줄', c12);
        ok(h13.read_status === 'check' && /첨부 PDF 없음/.test(h13.read_note) && h13.t === 90000 && !h13.pdf, '첨부 없는 홈택스 메일 = 본문에서 읽되 「원본 확인」', h13);
        ok(b14.read_status === 'error' && /비밀번호/.test(b14.read_note) && !b14.pdf, '비밀번호 안 맞으면 오류 · 숫자 0', b14);
        ok((await db2.query(`SELECT count(*)::int AS n FROM report_files WHERE is_deleted = false`)).rows[0].n === 0, '잠긴 원본 첨부는 파일함에서 숨김');
        ok(!printed.join('').includes(OUR) && !reqs.some(x => JSON.stringify(x).includes(OUR)), '비밀번호가 출력·요청 줄에 안 나옴');
        const before = reqs.length;
        o = await run(['2026-10']);
        ok(o.counts.skipped === 2 && o.counts.inserted === 0 && (await db2.query(`SELECT count(*)::int AS n FROM tax_invoices`)).rows[0].n === 4 && reqs.length - before === 3, '다시 돌리면 = 새 줄 0 · 읽힘 2통은 메일도 안 엶(확인 필요·오류만 다시)', { c: o.counts, opened: reqs.length - before });
        await db2.query(`UPDATE agent_office_config SET value = '{}' WHERE key = 'tax_invoice'`);
        o = await run(['2026-10']); ok(!o.ok && /pdf_password/.test(o.error), '비밀번호 설정 없으면 멈춤');
        await db2.query(`UPDATE agent_office_config SET value = '{"initial_done":false}' WHERE key = 'mail_index_state'`);
        await db2.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'tax_invoice'`, [JSON.stringify({ pdf_password: OUR })]);
        o = await run(['2026-10']); ok(!o.ok && /색인/.test(o.error), '메일 색인 덜 찼으면 멈춤');
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    console.log('⑤ 보안메일 HTML(홈택스·FirstBill 꼴) · 표 꼴 파서 · 공급자 = 계산서 안 사업자번호');
    {
        const SUP = { cj: ['616-24-54059'], sion: ['6168210027'], hyodon: ['786-82-00357'] };
        const FB_TXT = '전자계산서\n승인번호 : 2026100841000000AB12CD34\n공급자 등록번호 616-82-10027 상호 (법인명) 제주감귤농협 조천지점 성명 대표자\n공급받는자 등록번호 422-81-04127 상호 (법인명) 제주아꼼이네 성명 대표\n작성일자 공급가액 세액 수정사유 비고\n2026-10-08 1,000,000 0\n품목 농산물대금\n이 금액을 (청구) 함 1,000,000\n본 메일은 전자세금계산서로써 …';
        const HT_TXT = '전자세금계산서\n승인번호 20261005-41000000-00000555\n공급자 등록번호 616-24-54059 상호 (법인명) 씨제이 제주조천점 성명 대표자\n공급받는자 등록번호 422-81-04127 상호 (법인명) 제주아꼼이네 성명 대표\n작성일자 공급가액 세액 수정사유\n2026-10-05 300,000 30,000\n품목 택배서비스\n합계금액 330,000';
        const a = IM.parseInvoiceText(FB_TXT, OUR);
        ok(a.approval_no === '2026100841000000AB12CD34' && a.issue_date === '2026-10-08' && a.supply_amount === 1000000 && a.vat_amount === 0 && a.total_amount === 1000000 && a.kind === 'free' && a.supplier_bizno === '616-82-10027', 'FirstBill 꼴 = 영문 섞인 승인번호 24자 · 표 꼴 금액 · 「금액을 (청구) 함」 · 꼬리 「전자세금계산서로써」에 안 속음(면세)', a);
        const b = IM.parseInvoiceText(HT_TXT, OUR);
        ok(b.approval_no === '202610054100000000000555' && b.issue_date === '2026-10-05' && b.supply_amount === 300000 && b.vat_amount === 30000 && b.total_amount === 330000 && b.kind === 'tax', '홈택스 꼴 = 표 꼴 공급가액·세액 · 합계', b);
        ok(IM.supplierByBiz('616-82-10027', SUP) === 'sion' && IM.supplierByBiz('6162454059', SUP) === 'cj' && IM.supplierByBiz('786-82-00357', SUP) === 'hyodon' && IM.supplierByBiz('110-81-05034', SUP) === null && IM.supplierByBiz('616-82-10027', undefined) === null && IM.supplierByBiz(null, SUP) === null, '사업자번호 → 공급자(하이픈 무관 · 모르는 번호·설정 없음 = null)');
        ok(IM.supplierNameOf(FB_TXT) === '제주감귤농협 조천지점' && IM.supplierNameOf(HT_TXT) === '씨제이 제주조천점' && IM.supplierNameOf('글 없음') === null, '공급자 상호 = 처음 나오는 상호(공급받는자 말고)');

        // 가짜 보안메일: 비밀번호 칸 + Enter → 맞으면 iframe srcdoc 에 계산서 글 · 틀리면 「비밀번호가 틀렸습니다」 (인터넷 0)
        const secHtml = (text, pw) => `<!doctype html><meta charset="utf-8"><body><p>보안메일입니다. 비밀번호를 넣으세요</p><input type="password" id="p"><div id="o"></div><script>
document.getElementById('p').addEventListener('keydown', function (e) { if (e.key !== 'Enter') return;
  if (this.value === ${JSON.stringify(pw)}) { var f = document.createElement('iframe'); f.srcdoc = '<pre>' + ${JSON.stringify(text)}.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>'; document.getElementById('o').appendChild(f); }
  else document.getElementById('o').textContent = '비밀번호가 틀렸습니다'; });</script></body>`;
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v814h-'));
        const hFb = path.join(tmp, 'fb.html'), hHt = path.join(tmp, 'ht.html'), hBad = path.join(tmp, 'bad.html');
        fs.writeFileSync(hFb, secHtml(FB_TXT, OUR)); fs.writeFileSync(hHt, secHtml(HT_TXT, OUR)); fs.writeFileSync(hBad, secHtml(FB_TXT, 'other'));
        const hOcean = path.join(tmp, 'ocean.html'); fs.writeFileSync(hOcean, secHtml(FB_TXT.replace('2026100841000000AB12CD34', '2026100941000000OC00EA01').replace('상호 (법인명) 제주아꼼이네', '상호 (법인명) 오션라운지'), OUR));   // 받는 쪽 = 오션라운지
        const db3 = new PGlite();
        await db3.exec(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
            CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, created_by TEXT);
            CREATE TABLE mail_index (id SERIAL PRIMARY KEY, folder TEXT, folder_name TEXT, uidvalidity BIGINT, uid BIGINT, from_addr TEXT, from_name TEXT, subject TEXT, msg_date TEXT, at TIMESTAMPTZ, has_attach BOOLEAN, attach_names TEXT, size INTEGER, parsed JSONB, indexed_at TIMESTAMPTZ DEFAULT NOW());
            INSERT INTO mail_index (folder, uidvalidity, uid, from_name, subject, at, parsed) VALUES
              ('INBOX', 9, 31, 'FirstBill', '[제주감귤농협 조천지점] 전자계산서', '2026-10-08T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 9, 32, '홈택스', '(제주조천점->제주아꼼이네)', '2026-10-05T02:00:00Z', '{"kind":"tax_invoice","supplier":"sion"}'),
              ('INBOX', 9, 33, 'FirstBill', '[효돈] 전자계산서', '2026-10-09T02:00:00Z', '{"kind":"tax_invoice","supplier":"hyodon"}'),
              ('INBOX', 9, 34, '네이버', '(오션라운지->제주아꼼이네) 키워드 광고', '2026-10-10T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 9, 35, 'FirstBill', '전자계산서 발행 안내', '2026-10-11T02:00:00Z', '{"kind":"tax_invoice","supplier":null}');`);
        await db3.query(`INSERT INTO agent_office_config (key, value) VALUES ('tax_invoice', $1), ('mail_index_state', $2)`, [JSON.stringify({ pdf_password: OUR, suppliers: SUP }), JSON.stringify({ initial_done: true })]);
        let failRead = false;
        const MAILS = { 31: { file: hFb, name: 'FirstBill_Tax.html' }, 32: { file: hHt, name: 'NTS_eTaxInvoice.html' }, 33: { file: hBad, name: 'FirstBill_Tax.html' }, 34: { file: hOcean, name: 'x.html' }, 35: { file: hOcean, name: 'FirstBill_Tax.html' } };
        const reqs = [];
        const hook = async (sql, p) => {
            const m = /INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(sql) && /^mail_(read|attach)_request$/.exec(p[0]);
            if (!m) return null;
            const req = JSON.parse(p[1]); reqs.push({ op: m[1], ...req }); const mm = MAILS[req.uid];
            let res;
            if (m[1] === 'read' && failRead) res = { id: req.id, ok: false, error: '시험 실패' };
            else if (m[1] === 'read') res = { id: req.id, ok: true, mail: { uid: req.uid, text: '보안메일 안내', attachments: [{ part: '2', name: mm.name, type: 'text/html', size: 100 }] } };
            else { const data = fs.readFileSync(mm.file); const fr = await db3.query(`INSERT INTO report_files (filename, data, size_bytes) VALUES ($1, $2, $3) RETURNING id`, [mm.name, data, data.length]); res = { id: req.id, ok: true, file_id: fr.rows[0].id, type: 'text/html' }; }
            await db3.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, ['mail_' + m[1] + '_result', JSON.stringify(res)]);
            return { rows: [], rowCount: 1 };
        };
        const printed = [];
        const o = await IM.main(['2026-10'], { pool: mkPool(db3, hook), sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: (s) => printed.push(s) });
        const tv = (await db3.query(`SELECT mail_uid::int AS u, supplier, supplier_name, issue_date::text AS d, total_amount::int AS t, read_status, read_note, pdf_name, substring(pdf_data from 1 for 5) AS head FROM tax_invoices ORDER BY mail_uid`)).rows;
        const [f31, h32, b33] = tv;
        ok(o.ok && o.counts.read === 2 && o.counts.error === 1 && tv.length === 3, 'HTML 첨부 3통 = 읽힘 2 · 비밀번호 틀림 1', { c: o.counts, tv: tv.map(x => ({ ...x, head: undefined })) });
        ok(o.counts.excluded === 2 && !reqs.some(x => x.uid === 34) && reqs.some(x => x.uid === 35) && /제외 낱말 2통 건너뜀/.test(o.note) && !tv.some(x => x.u === 34 || x.u === 35), '오션라운지 = 제목에 있으면 메일도 안 엶 · 계산서 안(받는 쪽)에 있어도 건너뜀 · 표에 0줄(설정 없어도 기본값)', { c: o.counts, opened: reqs.map(x => x.uid) });
        ok(f31 && f31.supplier === 'sion' && f31.supplier_name === '제주감귤농협 조천지점' && f31.d === '2026-10-08' && f31.t === 1000000 && f31.pdf_name === 'FirstBill_Tax.pdf' && Buffer.from(f31.head || []).toString() === '%PDF-', 'FirstBill = 색인 분류 없어도 사업자번호로 시온 · 상호 · 열람용 PDF 저장', f31 && { ...f31, head: undefined });
        ok(h32 && h32.supplier === 'cj' && h32.read_status === 'read' && h32.t === 330000, '홈택스 「(제주조천점->…)」 = 색인은 시온이어도 계산서 번호로 CJ', h32 && { ...h32, head: undefined });
        ok(b33 && b33.read_status === 'error' && /비밀번호/.test(b33.read_note || '') && b33.supplier === 'hyodon', '안 풀린 보안메일 = 오류 · 숫자 0 · 공급자는 색인 분류', b33 && { ...b33, head: undefined });
        ok((await db3.query(`SELECT count(*)::int AS n FROM report_files WHERE is_deleted = false`)).rows[0].n === 0 && !printed.join('').includes(OUR) && fs.readdirSync(path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'invoice')).filter(f => /^3[123]-in\./.test(f)).length === 0, '받은 HTML 원본 = 파일함 숨김 · 로컬 임시 파일 지움 · 비밀번호 출력 0');
        // 같은 메일이 이미 a: 줄로 있는데 다시 돌릴 때 읽기 실패 → 새 줄 0 · 그 줄의 읽기 결과만(승인번호·숫자 유지)
        await db3.query(`UPDATE tax_invoices SET read_status = 'check' WHERE mail_uid = 31`);
        failRead = true;
        const o2 = await IM.main(['2026-10'], { pool: mkPool(db3, hook), sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: () => { } });
        failRead = false;
        const tv2 = (await db3.query(`SELECT mail_uid::int AS u, dedup_key, read_status, read_note, approval_no, total_amount::int AS t FROM tax_invoices ORDER BY mail_uid`)).rows;
        const r31 = tv2.find(x => x.u === 31);
        ok(tv2.length === 3 && o2.counts.inserted === 0 && r31.read_status === 'error' && /메일 읽기 실패|시험 실패/.test(r31.read_note || '') && r31.approval_no === '2026100841000000AB12CD34' && r31.dedup_key === 'a:2026100841000000AB12CD34' && r31.t === 1000000, '재실행 실패 = 같은 메일 2줄 안 생김 · a: 줄의 읽기 결과만 바뀜(승인번호·금액 유지)', { c: o2.counts, tv2 });
        // 설정에 suppliers 가 없으면 = 색인 분류로(종전 그대로) → 그것도 없으면 기타
        await db3.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'tax_invoice'`, [JSON.stringify({ pdf_password: OUR })]);
        await db3.query(`DELETE FROM tax_invoices`);
        const o3 = await IM.main(['2026-10'], { pool: mkPool(db3, hook), sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: () => { } });
        const sv = (await db3.query(`SELECT mail_uid::int AS u, supplier FROM tax_invoices ORDER BY mail_uid`)).rows.map(x => x.supplier).join();
        ok(sv === 'sion,hyodon' && o3.counts.excluded === 2 && o3.counts.other === 1 && /기타 1통 건너뜀/.test(o3.note), '설정 suppliers 없음 = 색인 분류 · 색인도 없으면 기타 = 표에 안 넣고 「기타 1통 건너뜀」', { sv, c: o3.counts });
        fs.rmSync(tmp, { recursive: true, force: true });

        // #818 스마트빌(CJ 정발행) = 첨부 0 · 본문 「비회원 비밀번호 <hex>」 · HTML 링크 「계산서 보기」 → 가짜 스마트빌(127.0.0.1) 비밀번호 칸 → 새 창에 계산서 표
        const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
        const SB_TXT = '전자세금계산서\n승인번호 20260930-41000000-00000777\n공급자 등록번호 110-81-05034 상호 씨제이대한통운㈜ 성명 대표\n공급받는자 등록번호 422-81-04127 상호 제주아꼼이네 성명 대표\n작성일자 공급가액 세액 비고\n2026-09-30 3,000,000 300,000\n품목 택배비\n합계금액 3,300,000';
        const sbSrv = http.createServer((q, s) => {
            s.setHeader('content-type', 'text/html; charset=utf-8');
            if (q.url.startsWith('/smartbill/inv')) return s.end(`<!doctype html><meta charset="utf-8"><pre>${/k=2/.test(q.url) ? SB_TXT.replace('00000777', '00000778') : SB_TXT}</pre>`);
            s.end(`<!doctype html><meta charset="utf-8"><p>스마트빌 비회원 조회 · 비밀번호를 넣으세요</p><input type="password" id="p"><div id="o"></div><script>
document.getElementById('p').addEventListener('keydown', function (e) { if (e.key !== 'Enter') return;
  if (this.value === ${JSON.stringify(HEX)}) window.open('/smartbill/inv' + location.search); else document.getElementById('o').textContent = '비밀번호가 틀렸습니다'; });</script>`);
        });
        await new Promise(r => sbSrv.listen(0, '127.0.0.1', r));
        const sbUrl = `http://127.0.0.1:${sbSrv.address().port}/smartbill/view?k=1`;
        const sbMail = (hex) => ({ text: `스마트빌\n전자세금계산서가 발행 되었습니다.\n비회원 비밀번호 \n ${hex} \n 세금계산서 정보 \n 작성일자 2026-09-30 \n 거래업체\n(공급자) 씨제이대한통운㈜`, attachments: [], links: [{ href: 'https://www.smartbill.co.kr/', text: '스마트빌' }, { href: sbUrl, text: '계산서 보기' }] });
        ok(IM.smartbillOf(sbMail(HEX)).url === sbUrl && IM.smartbillOf(sbMail(HEX)).hex === HEX && IM.smartbillOf({ text: '보안메일 안내' }) === null, '스마트빌 알아보기 = 본문 비회원 비밀번호 + 「계산서 보기」 링크(스마트빌 첫 화면 링크 말고)');
        const db4 = new PGlite();
        await db4.exec(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
            CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, created_by TEXT);
            CREATE TABLE mail_index (id SERIAL PRIMARY KEY, folder TEXT, folder_name TEXT, uidvalidity BIGINT, uid BIGINT, from_addr TEXT, from_name TEXT, subject TEXT, msg_date TEXT, at TIMESTAMPTZ, has_attach BOOLEAN, attach_names TEXT, size INTEGER, parsed JSONB, indexed_at TIMESTAMPTZ DEFAULT NOW());
            INSERT INTO mail_index (folder, uidvalidity, uid, from_name, subject, at, parsed) VALUES
              ('&zK2tbAC3rLDIHA-', 7, 41, '씨제이대한통운㈜ (발신전용메일)', '[전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 제주아꼼이네', '2026-10-06T00:31:00Z', '{"kind":"tax_invoice","supplier":"cj"}'),
              ('&zK2tbAC3rLDIHA-', 7, 42, '씨제이대한통운㈜ (발신전용메일)', '[전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 제주아꼼이네', '2026-10-07T00:31:00Z', '{"kind":"tax_invoice","supplier":"cj"}'),
              ('&zK2tbAC3rLDIHA-', 7, 43, '씨제이대한통운㈜ (발신전용메일)', '[전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 제주아꼼이네', '2026-10-08T00:31:00Z', '{"kind":"tax_invoice","supplier":"cj"}');`);
        await db4.query(`INSERT INTO agent_office_config (key, value) VALUES ('tax_invoice', $1), ('mail_index_state', $2)`, [JSON.stringify({ pdf_password: OUR, suppliers: SUP }), JSON.stringify({ initial_done: true })]);
        const reqs4 = [];
        const hook4 = async (sql, p) => {
            const m = /INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(sql) && /^mail_(read|attach)_request$/.exec(p[0]);
            if (!m) return null;
            const req = JSON.parse(p[1]); reqs4.push({ op: m[1], ...req });
            const res = { id: req.id, ok: true, mail: { uid: req.uid, ...sbMail(req.uid === 42 ? 'ffffffffffffffffffffffffffffffff' : HEX) } };
            if (req.uid === 43) { res.mail.links = [{ href: sbUrl.replace(/\?.*$/, ''), text: '조회', how: 'form' }]; res.mail.html = `<p>스마트빌</p><form action="${sbUrl.replace(/\?.*$/, '')}" method="get"><input type="hidden" name="k" value="2"><input type="submit" value="세금계산서 보기"></form>`; }   // #818-b 링크 = form 꼴 → HTML 원문을 띄워 단추
            await db4.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, ['mail_' + m[1] + '_result', JSON.stringify(res)]);
            return { rows: [], rowCount: 1 };
        };
        const printed4 = [];
        const o4 = await IM.main(['2026-10'], { pool: mkPool(db4, hook4), sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: (s) => printed4.push(s) });
        sbSrv.close();
        const tv4 = (await db4.query(`SELECT mail_uid::int AS u, supplier, supplier_bizno, approval_no, issue_date::text AS d, supply_amount::int AS sa, vat_amount::int AS va, total_amount::int AS t, read_status, read_note, pdf_name, substring(pdf_data from 1 for 5) AS head FROM tax_invoices ORDER BY mail_uid`)).rows;
        const [s41, s42, s43] = tv4;
        ok(s41 && s41.read_status === 'read' && s41.supplier === 'cj' && s41.supplier_bizno === '110-81-05034' && s41.approval_no === '202609304100000000000777' && s41.d === '2026-09-30' && s41.sa === 3000000 && s41.va === 300000 && s41.t === 3300000 && Buffer.from(s41.head || []).toString() === '%PDF-' && !reqs4.some(x => x.op === 'attach'),
            '스마트빌 = 링크 → 비밀번호 → 새 창 계산서 표 = 승인번호·공급자 번호·공급가액·세액·합계·작성일 · 열람용 PDF · 공급자 = 색인 분류 cj(본사 번호는 설정 밖)', s41 && { ...s41, head: undefined });
        ok(s42 && s42.read_status === 'check' && /스마트빌/.test(s42.read_note || '') && s42.d === '2026-09-30' && s42.supplier === 'cj' && !s42.pdf_name, '스마트빌 비밀번호가 안 맞으면 = 종전 「원본 확인」 줄(본문의 작성일만)', s42 && { ...s42, head: undefined });
        ok(s43 && s43.read_status === 'read' && s43.approval_no === '202609304100000000000778' && s43.t === 3300000 && s43.supplier === 'cj' && Buffer.from(s43.head || []).toString() === '%PDF-', '링크가 form 꼴(주소만으론 안 열림) = 메일 HTML 원문을 띄워 「세금계산서 보기」 누름 → 비밀번호 → 계산서 표 · PDF', s43 && { ...s43, head: undefined });
        ok(!printed4.join('').includes(HEX) && !JSON.stringify(tv4).includes(HEX) && !reqs4.some(x => JSON.stringify(x).includes(HEX)) && !printed4.join('').includes(OUR), '스마트빌 비밀번호(hex)·사업자 비밀번호 = 출력·표·요청 줄에 0', o4.counts);
    }
    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('중단:', e); process.exit(2); });

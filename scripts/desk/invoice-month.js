// #814 「이번 달 계산서 정리」 — 메일 색인(mail_index · #811)의 세금계산서 메일 → 첨부 PDF → 설정 비밀번호로 풀기 → 숫자 읽기 → tax_invoices 초안
//   node scripts/desk/invoice-month.js <YYYY-MM> [--dry] [--force] [--limit <n>] [--order <지시 id>]
//     --dry   = 메일·PDF 는 읽되 표에는 안 씀(무엇이 들어갈지만)   --force = 이미 「읽힘」인 줄도 다시 읽기   --limit = 메일 n통까지(기본 60)
//   대상 = 그 달 1일 ~ 다음 달 10일에 받은 계산서 메일(공급받는자 다른 회사 = 색인에서 이미 제외) · 줄의 달은 PDF 의 작성일자로 정해짐
//   읽기 전용: 메일은 찾기 러너(mail_read/attach_request)로만 · 표 쓰기는 tax_invoices upsert 뿐(사람이 누른 확인·보류·메모는 안 덮음)
//   비밀번호 = 실DB 설정 'tax_invoice'.pdf_password(코드·출력에 안 남김 · 파이썬에는 환경변수로) · 결과 글 = 건수 + 줄마다 공급자·작성일·읽힘 여부
//   #821 본 메일 표 tax_invoice_seen = 기타·제외로 건너뛴 메일(설정 지문 sig 와 함께) → 다음 실행은 안 엶 · --limit 은 안 본 메일 기준 · 설정(suppliers·exclude_words)이 바뀌면 다시 봄 · --force = 무시
//      기타는 계산서 안 사업자번호를 실제 읽었을 때만 적음 · 읽힌 메일은 seen 에 안 적음(tax_invoices 의 「읽힘」 줄이 이미 막음) · 건너뛴 수는 종전처럼 counts.other·excluded 에 더함(seen = 그중 안 연 수)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const TI = require(path.join(__dirname, '..', '..', 'tax-invoices.js'));
const MF = require('./mail-find.js');
const DEFAULT_EXCLUDE = ['오션라운지'];   // 설정 tax_invoice.exclude_words 가 없을 때
const DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'invoice');
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const crypto = require('crypto');
const ensureSeen = (pool) => pool.query(`CREATE TABLE IF NOT EXISTS tax_invoice_seen (dedup_key TEXT PRIMARY KEY, why TEXT NOT NULL, sig TEXT, at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
const seenSig = (cfg, excl) => crypto.createHash('sha1').update(JSON.stringify({ s: cfg.suppliers || null, e: excl })).digest('hex').slice(0, 12);

const digitsOf = (s) => String(s || '').replace(/[^0-9]/g, '');
const fmtBiz = (d) => d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null;
const toNum = (s) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };
// 계산서 글(PDF 글 또는 메일 본문) → 칸 · 못 읽은 칸은 null · our = 우리 사업자번호(숫자) — 공급자 번호에서 뺌
function parseInvoiceText(text, our) {
    const t = String(text || '').normalize('NFC').replace(/ /g, ' ');
    const out = { approval_no: null, issue_date: null, supplier_bizno: null, supply_amount: null, vat_amount: null, total_amount: null, kind: null, orig_approval_no: null };
    const ap = [...t.matchAll(/(\d{8})\s*-\s*(\d{8})\s*-\s*(\d{8})/g)].map(m => m[1] + m[2] + m[3]);
    if (!ap.length) for (const m of t.matchAll(/승인\s*번호\s*[:：]?\s*([0-9A-Za-z]{24})(?![0-9A-Za-z])/g)) ap.push(m[1]);   // FirstBill(농협) 꼴 = 숫자+영문 24자
    if (ap.length) out.approval_no = ap[0];
    if (/수정/.test(t) && ap.length > 1) out.orig_approval_no = ap[1];
    const dre = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;
    const dm = new RegExp('작성\\s*일\\s*자?[^0-9]{0,20}' + dre.source).exec(t) || dre.exec(t);
    if (dm) out.issue_date = `${dm[1]}-${String(+dm[2]).padStart(2, '0')}-${String(+dm[3]).padStart(2, '0')}`;
    const biz = [...t.matchAll(/(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})/g)].map(m => m[1] + m[2] + m[3]).filter(d => d !== our);
    if (biz.length) out.supplier_bizno = fmtBiz(biz[0]);
    const N = '(-?[0-9][0-9,]{0,15})';
    // 표 꼴(홈택스·FirstBill 보안메일) = 「작성일자 공급가액 세액 (비고·수정사유) 2026-10-08 1,000,000 0」 — 머리 줄 뒤에 날짜·공급가액·세액이 차례로
    const tb = new RegExp('작성\\s*일\\s*자\\s*공\\s*급\\s*가\\s*액\\s*세\\s*액[^0-9]{0,40}' + dre.source + '\\s+' + N + '\\s+' + N).exec(t);
    if (tb) {
        out.issue_date = `${tb[1]}-${String(+tb[2]).padStart(2, '0')}-${String(+tb[3]).padStart(2, '0')}`;   // 표의 작성일자가 정본(글 위쪽 다른 날짜보다)
        out.supply_amount = toNum(tb[4]); out.vat_amount = toNum(tb[5]);
    } else {
        const after = (label) => { const m = new RegExp(label + '[^0-9\\-]{0,30}' + N).exec(t); return m ? toNum(m[1]) : null; };
        out.supply_amount = after('공\\s*급\\s*가\\s*액');
        out.vat_amount = after('(?<!공급가)세\\s*액');
    }
    const tot = new RegExp('금액을\\s*\\(\\s*(?:청구|영수)\\s*\\)\\s*함\\s*' + N).exec(t) || new RegExp('합\\s*계\\s*금\\s*액[^0-9\\-]{0,30}' + N).exec(t) || new RegExp('총\\s*금\\s*액[^0-9\\-]{0,30}' + N).exec(t);
    out.total_amount = tot ? toNum(tot[tot.length - 1]) : null;
    if (out.total_amount == null && out.supply_amount != null) out.total_amount = out.supply_amount + (out.vat_amount || 0);
    const first = (re) => { const m = re.exec(t); return m ? m.index : Infinity; };   // 제목(처음 나오는 이름)으로 종류 — 꼬리 안내 글 「전자세금계산서로써」에 안 속게
    const iMod = first(/수정\s*(세금)?\s*계산서|수정\s*발행/), iTax = first(/세금\s*계산서/), iFree = first(/(?<!세금\s?)계산서/);
    if (iMod < Infinity && iMod <= Math.min(iTax, iFree) + 20) out.kind = 'modify';
    else if (iTax < iFree) out.kind = 'tax';
    else if (iFree < Infinity) out.kind = 'free';
    if (out.kind === 'free' && out.vat_amount == null) out.vat_amount = 0;
    return out;
}
const isRead = (p) => !!(p.issue_date && p.total_amount != null && (p.approval_no || p.supplier_bizno));
// 공급자 상호 = 처음 나오는 「상호 (법인명) … 성명」 (위가 공급자 · 아래가 공급받는자)
const supplierNameOf = (text) => { const m = /상\s*호\s*(?:\(\s*법인명\s*\))?\s*(.{2,40}?)\s*성\s*명/.exec(String(text || '').replace(/\s+/g, ' ')); return m ? m[1].trim() : null; };
// 공급자 = 계산서 안 사업자번호로 먼저(설정 tax_invoice.suppliers {cj:[번호…], sion:[…], hyodon:[…]}) → 없으면 메일 색인 분류
//   🔴 메일 제목만으로는 틀릴 수 있음(10/21 실물: 홈택스 「(제주조천점->…)」 = 품목 택배서비스)
const supplierByBiz = (biz, map) => { const d = digitsOf(biz); if (!d || !map) return null; for (const k of TI.SUPPLIERS) if ((map[k] || []).some(x => digitsOf(x) === d)) return k; return null; };

// 보안메일 HTML(홈택스 NTS_eTaxInvoice.html · 농협 FirstBill_Tax.html) = 브라우저에서 비밀번호(사업자번호)를 넣어야 풀림 → 화면 없는 크롬으로 열어 글 + 열람용 PDF
//   홈택스 판은 srtk.hometax.go.kr 의 공식 풀기 스크립트를 내려받아 씀(인터넷 필요) · Playwright 는 저장소 node_modules(--no-save) — 없으면 오류 줄
let _browser = null;
const NO_PW = '이 PC 에 Playwright 가 없어 보안메일을 못 열어요(npm install --no-save playwright · 총괄에게)';
async function getBrowser() {
    if (!_browser) {
        let pwMod; try { pwMod = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright')); } catch (_) { return null; }
        _browser = await pwMod.chromium.launch();
    }
    return _browser;
}
// #818 스마트빌(CJ 정발행 · 첨부 0) = 메일 HTML 의 「계산서 보기」 링크 → 비회원 비밀번호(메일 본문의 32자 hex) → 계산서 화면 글 + 열람용 PDF
//   비밀번호는 칸에만 넣고 로그·결과·오류 글에 안 씀 · 새 창(팝업)으로 뜨는 꼴도 그 창들의 글까지 모음
const smartbillOf = (mail) => {
    const t = String((mail && mail.text) || ''), m = /비회원\s*비밀번호\s*[:：]?\s*([0-9a-fA-F]{32})(?![0-9a-fA-F])/.exec(t);
    if (!/스마트빌|smartbill/i.test(t) || !m) return null;
    const ls = (mail.links || []).filter(l => /smartbill|businesson/i.test(String(l.href || '')) && l.how !== 'form');   // form(POST) 꼴은 주소만으론 안 열림 → HTML 원문 길
    const l = ls.find(x => /계산서|보기|조회/.test(x.text || '')) || ls.find(x => x.how !== 'raw') || ls[0];
    return { hex: m[1], url: l ? l.href : null, html: l ? null : (mail.html || null) };
};
// #818-b 링크가 없거나 form·스크립트 꼴이면 = 메일 HTML 원문을 화면에 띄워 「계산서 보기」(또는 조회) 단추를 누름 → 새 창이든 같은 창이든 그 뒤는 같은 길
async function openSmartbill(sb, hex) {
    if (typeof sb === 'string') sb = { url: sb };
    const b = await getBrowser(); if (!b) return { ok: false, error: NO_PW };
    const ctx = await b.newContext();
    const allText = async () => { let t = ''; for (const p of ctx.pages()) for (const fr of p.frames()) { try { t += '\n' + await fr.evaluate(() => document.body ? document.body.innerText : ''); } catch (_) { } } return t; };
    try {
        const pg = await ctx.newPage();
        if (sb.url) { try { await pg.goto(sb.url, { waitUntil: 'load', timeout: 30000 }); } catch (_) { return { ok: false, error: '스마트빌 화면을 못 엶(인터넷·링크 확인)' }; } }
        else if (sb.html) {
            await pg.setContent(sb.html, { waitUntil: 'load', timeout: 30000 }).catch(() => { });
            const bt = pg.locator('a, button, input[type=submit], input[type=button], input[type=image], [onclick]').filter({ hasText: /계산서\s*보기|세금계산서\s*보기|조회/ }).first();
            const bt2 = pg.locator('input[type=submit][value*="보기"], input[type=submit][value*="조회"], input[type=button][value*="보기"], input[type=button][value*="조회"]').first();
            const hit = (await bt.count().catch(() => 0)) ? bt : (await bt2.count().catch(() => 0)) ? bt2 : null;
            if (!hit) return { ok: false, error: '스마트빌 메일에 「계산서 보기」 단추가 없음' };
            await Promise.all([pg.waitForLoadState('load').catch(() => { }), hit.click({ timeout: 10000 }).catch(() => { })]);
            await pg.waitForTimeout(1500);
        } else return { ok: false, error: '계산서 보기 링크 없음' };
        // #818-c 실물(10/21): 메일의 「전자세금계산서 확인」(loginCookieClear … login_ticket) = 비밀번호 화면 없이 바로 계산서(프레임 DisplayDtiEmail_V2)
        //   → 계산서가 뜬 프레임이 있으면 그 글만 읽음 · 없고 비밀번호 칸이 있으면 hex 넣기(비회원 조회 꼴) · 둘 다 15초 안에 없으면 실패
        const isInv = (t) => /작성\s*일\s*자/.test(t) && /승인\s*번호/.test(t);
        const findInv = async () => { for (const p of ctx.pages()) for (const fr of p.frames()) { try { const t = await fr.evaluate(() => document.body ? document.body.innerText : ''); if (isInv(t)) return { p, fr, t }; } catch (_) { } } return null; };
        let inv = null, box = null, typed = null;
        for (let i = 0; i < 40 && !inv; i++) {   // 최대 20초 · 비번 넣은 뒤 5초째에도 그대로면 「확인」 단추를 한 번 누름
            inv = await findInv(); if (inv) break;
            if (typed === null) { for (const p of ctx.pages()) { for (const fr of p.frames()) { box = await fr.$('input[type=password]').catch(() => null); if (box) break; } if (box) break; }
                if (box) { await box.fill(hex); await box.press('Enter').catch(() => { }); typed = i; } }
            else if (i === typed + 10) { for (const fr of ctx.pages().flatMap(p => p.frames())) { const bt = await fr.$('button:has-text("확인"), input[type=submit], input[type=button][value*="확인"], a:has-text("확인")').catch(() => null); if (bt) { await bt.click().catch(() => { }); break; } } }
            await pg.waitForTimeout(500);
        }
        if (!inv) { const t = await allText(); return { ok: false, error: typed === null ? '스마트빌 계산서 화면도 비밀번호 칸도 못 찾음' : /비밀번호/.test(t) ? '스마트빌이 안 풀림(비밀번호 확인)' : '스마트빌 계산서 글을 못 읽음' }; }
        const txt = inv.t;
        // PDF = 계산서 프레임만 새 창으로(같은 세션 · 광고·머리 메뉴 빼고) → 안 되면 그 창 통째
        let pdf = null;
        if (inv.fr !== inv.p.mainFrame() && /^https?:/.test(inv.fr.url())) { const p2 = await ctx.newPage(); try { await p2.goto(inv.fr.url(), { waitUntil: 'load', timeout: 30000 }); if (isInv(await p2.evaluate(() => document.body ? document.body.innerText : ''))) pdf = await p2.pdf({ format: 'A4', printBackground: true }); } catch (_) { } }
        if (!pdf) { try { pdf = await inv.p.pdf({ format: 'A4', printBackground: true }); } catch (_) { } }
        return { ok: true, text: txt.split(hex).join(''), pdf };
    } finally { await ctx.close().catch(() => { }); }
}
async function openSecureHtml(file, pw) {
    const b = await getBrowser(); if (!b) return { ok: false, error: NO_PW };
    const ctx = await b.newContext(), pg = await ctx.newPage();
    try {
        await pg.goto('file:///' + file.split(path.sep).join('/'), { waitUntil: 'load', timeout: 30000 });
        const box = await pg.waitForSelector('input[type=password]', { timeout: 15000 }).catch(() => null);
        if (!box) return { ok: false, error: '보안메일 비밀번호 칸을 못 찾음' };
        await box.fill(pw); await box.press('Enter');
        let txt = '';
        for (let i = 0; i < 20; i++) {   // 풀리기를 최대 10초 기다림
            await pg.waitForTimeout(500);
            txt = ''; for (const fr of pg.frames()) { try { txt += '\n' + await fr.evaluate(() => document.body ? document.body.innerText : ''); } catch (_) { } }
            if (/작성\s*일\s*자/.test(txt) && /승인\s*번호/.test(txt)) break;
        }
        if (!/작성\s*일\s*자/.test(txt)) return { ok: false, error: /비밀번호/.test(txt) ? '보안메일이 안 풀림(비밀번호 확인)' : '보안메일 글을 못 읽음' };
        let pdf = null; try { pdf = await pg.pdf({ format: 'A4', printBackground: true }); } catch (_) { }
        return { ok: true, text: txt, pdf };
    } finally { await ctx.close().catch(() => { }); }
}

async function main(args, deps) {
    const { pool } = deps, out = (o) => { deps.print(JSON.stringify(o, null, 1)); return o; };
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) { const a = args[i]; if (['--limit', '--order'].includes(a)) o[a.slice(2)] = args[++i]; else if (a === '--dry') o.dry = true; else if (a === '--force') o.force = true; else rest.push(a); }
    const ym = rest[0];
    if (!YM.test(ym || '')) throw new Error('invoice-month.js <YYYY-MM> [--dry] [--force] [--limit n] [--order <지시 id>]');
    const limit = Math.min(Math.max(parseInt(o.limit || '60', 10) || 60, 1), 200), orderId = o.order ? parseInt(o.order, 10) : null;
    const cfg = ((await pool.query(`SELECT value FROM agent_office_config WHERE key = 'tax_invoice'`)).rows[0] || {}).value || {};
    const pw = String(cfg.pdf_password || ''), our = digitsOf(cfg.our_bizno || cfg.pdf_password || '');
    if (!pw) return out({ ok: false, error: "설정 'tax_invoice'.pdf_password 가 없어요 — 총괄에게(실DB 설정)" });
    // #816 대표 10/21: 계산서 발행현황 = 시온·효돈·택배비(CJ)만 · 이 낱말이 받는 쪽·제목·본문에 있으면 무조건 건너뜀(기본 오션라운지)
    const EXCL = (Array.isArray(cfg.exclude_words) ? cfg.exclude_words : DEFAULT_EXCLUDE).map(w => String(w || '').normalize('NFC').trim()).filter(Boolean);
    const hasExcl = (...ts) => { const t = ts.map(x => String(x || '')).join('\n').normalize('NFC'); return EXCL.find(w => t.includes(w)) || null; };
    const st = (await pool.query(`SELECT value FROM agent_office_config WHERE key = 'mail_index_state'`)).rows[0];
    if (!st || !st.value || !st.value.initial_done) return out({ ok: false, error: '메일 색인이 아직 다 안 찼어요(처음 채우기 중) — 몇 분 뒤 다시' });
    const [y, m] = ym.split('-').map(Number), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    if (!o.dry) { await TI.ensureTable(pool); await ensureSeen(pool); }
    const useSeen = !o.force && (await pool.query(`SELECT to_regclass('public.tax_invoice_seen') IS NOT NULL AS ok`)).rows[0].ok, sig = seenSig(cfg, EXCL);
    const MKEY = `'m:' || mi.folder || ':' || COALESCE(mi.uidvalidity, 0) || ':' || mi.uid`;
    const RANGE = `mi.parsed->>'kind' = 'tax_invoice' AND mi.at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul') AND mi.at < (($2::date + 10)::timestamp AT TIME ZONE 'Asia/Seoul')`;
    const SEEN = `EXISTS (SELECT 1 FROM tax_invoice_seen s WHERE s.dedup_key = ${MKEY} AND s.sig = $3 AND s.why IN ('other', 'excluded'))`;
    const seenN = { other: 0, excluded: 0 };
    if (useSeen) for (const r of (await pool.query(`SELECT s.why, count(*)::int AS n FROM mail_index mi JOIN tax_invoice_seen s ON s.dedup_key = ${MKEY} AND s.sig = $3 AND s.why IN ('other', 'excluded') WHERE ${RANGE} GROUP BY s.why`, [ym + '-01', next + '-01', sig])).rows) seenN[r.why] = r.n;
    const mails = (await pool.query(`SELECT mi.folder, mi.folder_name, mi.uidvalidity, mi.uid, mi.subject, mi.from_name, mi.at, mi.parsed FROM mail_index mi
        WHERE ${RANGE}${useSeen ? ` AND NOT ${SEEN}` : ''}
        ORDER BY mi.at, mi.uid LIMIT ${useSeen ? '$4' : '$3'}`, useSeen ? [ym + '-01', next + '-01', sig, limit + 1] : [ym + '-01', next + '-01', limit + 1])).rows;
    const more = mails.length > limit; mails.length = Math.min(mails.length, limit);
    const markSeen = async (key, why) => { if (!o.dry) await pool.query(`INSERT INTO tax_invoice_seen (dedup_key, why, sig) VALUES ($1, $2, $3) ON CONFLICT (dedup_key) DO UPDATE SET why = EXCLUDED.why, sig = EXCLUDED.sig, at = NOW()`, [key, why, sig]); };
    const R = MF.makeRunner({ pool, sleep: deps.sleep, now: deps.now });
    const by = orderId ? await R.orderBy(orderId) : '창구';
    fs.mkdirSync(DIR, { recursive: true });
    const done = [], cnt = { mails: mails.length + seenN.other + seenN.excluded, read: 0, check: 0, error: 0, inserted: 0, updated: 0, skipped: 0, other: seenN.other, excluded: seenN.excluded, seen: seenN.other + seenN.excluded };
    try {
    for (const mm of mails) {
        const key = `m:${mm.folder}:${mm.uidvalidity || 0}:${mm.uid}`;
        const ex0 = hasExcl(mm.subject, mm.from_name);   // 메일을 열기 전(제목·보낸 이)
        if (ex0) { cnt.excluded++; await markSeen(key, 'excluded'); done.push({ subject: mm.subject, result: `제외 낱말(${ex0}) — 건너뜀` }); continue; }
        const have = (await pool.query(`SELECT id, dedup_key, read_status, supplier FROM tax_invoices WHERE (dedup_key = $1 OR (mail_folder = $2 AND mail_uid = $3 AND COALESCE(mail_uidvalidity, 0) = $4)) ORDER BY id LIMIT 1`, [key, mm.folder, mm.uid, mm.uidvalidity || 0]).catch(() => ({ rows: [] }))).rows[0];
        if (!o.force && have && have.read_status === 'read') { cnt.skipped++; done.push({ supplier: mm.parsed.supplier || 'other', subject: mm.subject, result: '이미 읽힘(건너뜀)' }); continue; }
        const row = { supplier: mm.parsed.supplier || (have && have.supplier) || 'other', supplier_name: mm.parsed.supplier_name || mm.from_name || null, mail_folder: mm.folder, mail_uid: Number(mm.uid), mail_uidvalidity: mm.uidvalidity ? Number(mm.uidvalidity) : null,
            mail_subject: mm.subject, mail_at: mm.at, read_status: 'check', read_note: null };
        let parsed = null, pdfBuf = null, pdfName = null, srcText = '', mailText = '';
        try {
            const rd = await R.send('read', { uid: Number(mm.uid), folder: mm.folder, order_id: orderId, by }, 180000);
            if (!rd.ok) throw new Error(rd.error || '메일 읽기 실패');
            mailText = rd.mail.text || '';
            const atts = rd.mail.attachments || [];
            const att = atts.find(a => /\.pdf$/i.test(a.name || '') || /pdf/i.test(a.type || ''));
            const hatt = att ? null : atts.find(a => /\.html?$/i.test(a.name || '') || /text\/html/i.test(a.type || ''));   // 보안메일(홈택스·농협 FirstBill) = HTML 첨부
            const fetchAtt = async (a, ext) => {   // 첨부 → 로컬 파일 · 잠긴 원본은 화면 파일함에 안 남김
                const ar = await R.send('attach', { uid: Number(mm.uid), part: a.part, folder: mm.folder, order_id: orderId, by }, 180000);
                if (!ar.ok) throw new Error(ar.error || '첨부 받기 실패');
                const fr = (await pool.query('SELECT data FROM report_files WHERE id = $1', [ar.file_id])).rows[0];
                if (!fr) throw new Error('받은 첨부를 못 찾음');
                const src = path.join(DIR, `${mm.uid}-in.${ext}`);
                fs.writeFileSync(src, Buffer.from(fr.data));
                await pool.query('UPDATE report_files SET is_deleted = true WHERE id = $1', [ar.file_id]).catch(() => { });
                return src;
            };
            if (hatt) {
                const src = await fetchAtt(hatt, 'html');
                let sr; try { sr = await openSecureHtml(src, pw); } finally { try { fs.unlinkSync(src); } catch (_) { } }
                if (!sr.ok) { row.read_status = 'error'; row.read_note = sr.error; }
                else {
                    parsed = parseInvoiceText(sr.text, our); srcText = sr.text;
                    if (sr.pdf) { pdfBuf = Buffer.from(sr.pdf); pdfName = String(hatt.name || `계산서_${mm.uid}`).replace(/\.html?$/i, '') + '.pdf'; }
                }
            } else if (att) {
                const src = await fetchAtt(att, 'pdf'), dst = path.join(DIR, `${mm.uid}-open.pdf`);
                const py = spawnSync(process.env.PYTHON || 'python', ['-P', path.join(__dirname, 'pdf-unlock.py'), src, dst], { env: { ...process.env, PDF_PASSWORD: pw, PYTHONIOENCODING: 'utf-8' }, cwd: __dirname, encoding: 'utf8', timeout: 60000 });   // -P = 받은 파일 폴더·현재 폴더의 .py 를 안 읽음(사용자 설치 PyMuPDF 는 씀)
                let pj = null; try { pj = JSON.parse(String(py.stdout || '').trim().split('\n').pop()); } catch (_) { }
                try { fs.unlinkSync(src); } catch (_) { }
                if (!pj || !pj.ok) { row.read_status = 'error'; row.read_note = (pj && pj.error) || 'PDF 풀기 실패'; }
                else {
                    pdfBuf = fs.readFileSync(dst); pdfName = att.name || `계산서_${mm.uid}.pdf`; try { fs.unlinkSync(dst); } catch (_) { }
                    if (pj.image_only) { row.read_note = '그림 PDF(글자 없음) — 원본 확인'; parsed = parseInvoiceText(rd.mail.text, our); srcText = rd.mail.text; }
                    else { parsed = parseInvoiceText(pj.text, our); srcText = pj.text; }
                }
            } else {
                const sb = smartbillOf(rd.mail);   // #818 CJ 정발행 = 스마트빌(첨부 0 · 링크 + 비회원 비밀번호)
                const sr = sb && (sb.url || sb.html) ? await openSmartbill(sb, sb.hex) : null;
                if (sr && sr.ok) {
                    parsed = parseInvoiceText(sr.text, our); srcText = sr.text;
                    if (sr.pdf) { pdfBuf = Buffer.from(sr.pdf); pdfName = `스마트빌_${mm.uid}.pdf`; }
                } else { parsed = parseInvoiceText(rd.mail.text, our); srcText = rd.mail.text; row.read_note = sb ? `스마트빌 ${sr ? sr.error : '계산서 보기 링크 없음'} — 원본 확인` : '첨부 PDF 없음(본문에서 읽음) — 원본 확인'; }
            }
        } catch (e) { row.read_status = 'error'; row.read_note = String(e.message || e).slice(0, 160); }
        if (parsed) {
            Object.assign(row, parsed);
            row.supplier = supplierByBiz(parsed.supplier_bizno, cfg.suppliers) || mm.parsed.supplier || (have && have.supplier) || 'other';   // 계산서 안 사업자번호가 정본 · 설정 없으면 색인 분류 → 그것도 없으면 기타
            row.supplier_name = supplierNameOf(srcText) || row.supplier_name;
            if (row.read_status !== 'error') row.read_status = isRead(parsed) && !row.read_note ? 'read' : 'check';
            if (row.read_status === 'check' && !row.read_note) row.read_note = '일부 칸을 못 읽음 — 원본 확인';
        }
        const ex1 = hasExcl(mailText, srcText, row.supplier_name);   // 연 뒤(본문·계산서 글 = 받는 쪽 상호 포함)
        if (ex1) { cnt.excluded++; if (row.read_status !== 'error') await markSeen(key, 'excluded'); done.push({ subject: mm.subject, result: `제외 낱말(${ex1}) — 건너뜀` }); continue; }
        if (!TI.SHOWN.includes(row.supplier)) { cnt.other++; if (parsed && parsed.supplier_bizno) await markSeen(key, 'other');   /* 계산서 안 사업자번호를 실제 읽고 기타일 때만(번호를 못 읽은 메일은 다음에 다시) */ done.push({ subject: mm.subject, result: '기타(시온·효돈·택배비 아님) — 건너뜀' }); continue; }   // 표에 안 넣음(대표 10/21)
        row.pdf_name = pdfName; row.pdf_data = pdfBuf;
        cnt[row.read_status]++;
        let up = null;
        // 같은 메일 줄이 이미 다른 키(a: 승인번호)로 있는데 이번엔 승인번호를 못 읽음(읽기·첨부 실패 등) → 새 m: 줄을 만들지 말고 그 줄의 읽기 결과만 고침
        //   이미 「읽힘」인 줄(--force)은 안 깎음 · 숫자·PDF·확인 정보는 그대로
        const stray = have && TI.dedupKeyOf(row) !== have.dedup_key && !row.approval_no;
        if (!o.dry && stray) {
            if (have.read_status !== 'read') await pool.query(`UPDATE tax_invoices SET read_status = $2, read_note = $3, updated_at = NOW() WHERE id = $1`, [have.id, row.read_status, row.read_note || null]);
            up = { id: have.id, inserted: false }; cnt.updated++;
        } else if (!o.dry) { up = await TI.upsertRow(pool, row); cnt[up.inserted ? 'inserted' : 'updated']++; }
        done.push({ id: up ? up.id : null, supplier: TI.LABEL[row.supplier] || row.supplier, issue_date: row.issue_date, total: row.total_amount, result: row.read_status === 'read' ? '읽힘' : row.read_status === 'check' ? '확인 필요' : '오류', note: row.read_note || undefined });
    }
    } finally { await closeBrowser(); }   // 보안메일용 크롬은 한 번 열어 다 쓰고 바로 닫음
    return out({ ok: true, month: ym, dry: !!o.dry, counts: cnt, more: more || undefined, rows: done,
        note: (o.dry ? '시험(--dry) — 표에 안 씀 · ' : '') + (cnt.other ? `기타 ${cnt.other}통 건너뜀 · ` : '') + (cnt.excluded ? `제외 낱말 ${cnt.excluded}통 건너뜀 · ` : '') + (cnt.seen ? `그중 ${cnt.seen}통은 지난번에 봐서 안 엶 · ` : '') + '정산관리 › 계산서 발행현황에서 줄마다 [확인]/[보류] · 「확인 필요」·「오류」 줄은 PDF·메일 원본을 보고 사람이 · 확인 전 숫자는 어느 합계에도 안 섞임' });
}
async function closeBrowser() { if (_browser) { const b = _browser; _browser = null; await b.close().catch(() => { }); } }
module.exports = { main, parseInvoiceText, isRead, supplierByBiz, supplierNameOf, openSecureHtml, openSmartbill, smartbillOf, closeBrowser };
if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now(), print: (s) => console.log(s) })
        .catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; })
        .finally(() => closeBrowser().then(() => pool.end().catch(() => { })));
}

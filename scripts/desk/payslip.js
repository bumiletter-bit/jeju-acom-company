/* #674-B 급여명세서 올리기(창구 도구) — 개인별 PDF 를 읽어 「누구 것 · 몇 월분 · 지급일」만 알아낸 뒤, 확인표를 만들고 승인 뒤에만 등록한다
 *
 *   사용(창구 · 관리자 지시일 때만):
 *     node scripts/desk/payslip.js --dry   <폴더|파일들>            확인표만(등록 0) · 계획 번호를 준다
 *     node scripts/desk/payslip.js --apply <폴더|파일들> --plan <번호> --order <지시 번호> [--replace] [--no-notify]   확인표를 본 관리자가 승인한 뒤에만
 *
 *     node scripts/desk/payslip.js --db-apply <폴더|파일들> --plan <번호> [--replace] [--by <계정 번호>]
 *         🔴 처음 한 번 밀린 달을 한꺼번에 넣을 때만(총괄 · 배포 뒤) — 서버를 거치지 않고 이 PC 의 DATABASE_URL 로 payslips 표에 직접 넣는다.
 *         올린 사람 = --by(기본 1 = 대표) · 알림 없음 · 기록 = audit_logs source 'payslip'(action payslip_upload/payslip_replace · via 'desk-initial'). 표가 없으면(배포 전) 아무것도 안 한다.
 *
 *   읽는 것 = 이름 · 「○○○○년 ○월」 · 지급일뿐. 🔴 금액은 읽지도 적지도 않는다(확인표·로그·결과 어디에도 없음 · 추출한 글은 메모리에서만 쓰고 버린다).
 *   매칭 = 직원 목록(users · 삭제 안 된 계정)의 이름과 **전체 일치**. 동명이인 · 이름 없음 · 한 파일에 여러 사람 · 글자 없는 PDF(스캔본) = 미배정(→ 「내 정보」 관리자 구역에서 손으로).
 *   승인 = --dry 가 준 계획 번호(파일 내용 해시 묶음)를 --apply 에 그대로 넘긴다. 파일이 바뀌었거나 매칭이 달라졌으면 등록하지 않는다(본 것과 다른 것이 올라가지 않게).
 *   --no-notify = 직원 앱 알림 없이(밀린 달을 한꺼번에 올릴 때).
 *   같은 직원·같은 달이 이미 있으면 --dry 가 「이미 있음」으로 알리고, --apply 는 --replace 가 있을 때만 바꾼다.
 *   등록 = 요청 줄(표 payslip_queue)을 적기만 한다 → 서버가 20초마다 집어 등록(#674-A 워커4 · 교체·PDF 검사·기록·알림은 서버 한 곳 · payslips 표에는 직접 넣지 않는다 · 창구에 토큰 없음).
 *     서버가 줄마다 확인: 그 지시(--order)를 낸 계정이 지금 관리자인가 · 그 지시에 PDF 첨부가 있는가. 지시 1건 = 파일 1개 = 사람 1명 — 줄에 파일을 싣지 않고(data 빈값) 서버가 그 지시의 첨부를 그대로 쓴다. 여러 장·여러 사람은 지시를 나눠서.
 *   PDF 글자 추출 = pdftotext(Git for Windows 에 들어 있음 · 없으면 안내하고 끝).
 *   마지막 줄에 JSON 한 줄 요약.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ── 서버 계약(#674-A 워커4 확정 10/12) ── 표 payslip_queue 에 INSERT 만: order_id · user_id · pay_month · pay_date · file_name · data(없으면 그 지시의 첨부) · replace · notify
//   서버가 채움: status 'wait' → 'done' | 'fail' · error · payslip_id · done_at
const QUEUE_WAIT_MS = 90000, QUEUE_POLL_MS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;   // 서버 상한과 같게

// ── 인자 ──
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const targets = argv.filter((a, i) => !a.startsWith('--') && !['--plan', '--users', '--by', '--order'].includes(argv[i - 1]));
const out = o => { console.log(JSON.stringify(o)); };
const die = (msg, extra) => { console.error(msg); out(Object.assign({ ok: false, error: msg }, extra || {})); process.exit(1); };

// ── PDF 글자 ──
function pdftotextBin() {
    const cands = [process.env.PDFTOTEXT, 'pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe', 'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe'].filter(Boolean);
    for (const c of cands) { try { execFileSync(c, ['-v'], { stdio: 'ignore' }); return c; } catch (e) { if (e && e.status != null) return c; } }
    return null;
}
function pdfPages(bin, file) {
    // -layout: 표 꼴을 줄 단위로 유지 · 쪽은 \f 로 나뉜다. 🔴 사본·임시 파일을 만들지 않는다(급여 자료) — 글은 메모리로만 받는다
    return execFileSync(bin, ['-enc', 'UTF-8', '-layout', file, '-'], { maxBuffer: 20 * 1024 * 1024 }).toString('utf8').split('\f').map(s => s.trim()).filter(Boolean);
}

// ── 읽기(이름 · 월 · 지급일) ──
const squash = s => String(s || '').replace(/\s+/g, '');
const pad2 = n => String(n).padStart(2, '0');
function monthOf(text) {
    // 「귀속 2026년 9월」「2026년 09월분」「2026.09 급여」 — 귀속·급여 낱말 옆을 먼저, 없으면 처음 나오는 「○○○○년 ○월」
    const pats = [/(?:귀속|급여|임금)[^\n]{0,12}?(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*월?/, /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(?:분|귀속|급여|임금)/, /(20\d{2})\s*년\s*(\d{1,2})\s*월/];
    for (const p of pats) { const m = text.match(p); if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + pad2(m[2]); }
    return null;
}
function payDateOf(text) {
    const m = text.match(/지\s*급\s*일(?:자)?\s*[:：]?\s*(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
}
// 직원 이름 찾기: ①「성명/이름/사원명」 표식 바로 뒤 글이 직원 이름과 전체 일치 ②표식이 없으면 글 전체에서 보이는 직원 이름이 정확히 한 명일 때
function nameOf(text, users) {
    const names = [...new Set(users.map(u => u.name))];
    const labeled = [];
    const re = /(?:성\s*명|이\s*름|사\s*원\s*명|근\s*로\s*자(?:\s*명)?)\s*[:：]?\s*([가-힣](?:\s?[가-힣]){1,4})/g;
    let m; while ((m = re.exec(text))) { const n = squash(m[1]); const hit = names.filter(x => n === x || n.startsWith(x)); if (hit.length === 1) labeled.push(hit[0]); }
    const L = [...new Set(labeled)];
    if (L.length === 1) return { name: L[0], by: '성명 칸' };
    if (L.length > 1) return { name: null, why: '한 파일에 여러 사람(' + L.length + '명)' };
    const flat = squash(text); const seen = names.filter(n => n.length >= 2 && flat.includes(n));
    if (seen.length === 1) return { name: seen[0], by: '글 안의 이름' };
    return { name: null, why: seen.length ? '직원 이름이 여럿 보임(' + seen.length + '명 · 성명 칸을 못 찾음)' : '직원 이름을 찾지 못함' };
}
// 파일 이름 = 「급여명세서_26년3월_이름.pdf」「급여명세서(법인)_26년06월_이름.pdf」「급여대장_26년07월_이름.pdf」 — 월(두 자리 연도 = 20xx)·이름(직원 이름과 전체 일치하는 조각)
function fromFileName(file, users) {
    const base = path.basename(file).replace(/\.pdf$/i, ''); const o = { month: null, name: null };
    const m = base.match(/(?:^|[^\d])((?:20)?\d{2})\s*년\s*(\d{1,2})\s*월/);
    if (m && +m[2] >= 1 && +m[2] <= 12) o.month = (m[1].length === 2 ? '20' + m[1] : m[1]) + '-' + pad2(m[2]);
    const names = [...new Set(users.map(u => u.name))]; const parts = base.split(/[_\-\s()\[\]]+/).map(squash).filter(Boolean);
    const hit = [...new Set(parts.filter(x => names.includes(x)))]; if (hit.length === 1) o.name = hit[0];
    const anyName = parts.filter(x => /^[가-힣]{2,4}$/.test(x) && !/급여|명세서|대장|법인|임금/.test(x)); o.raw_name = hit.length ? null : (anyName[anyName.length - 1] || null);   // 직원 목록에 없는 이름(보고용)
    return o;
}
function readOne(bin, file, users) {
    const st = fs.statSync(file); const base = { file, size: st.size, sha: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    if (st.size > MAX_BYTES) return Object.assign(base, { why: '파일이 너무 큼(' + Math.round(st.size / 1024 / 1024) + 'MB)' });
    let pages; try { pages = pdfPages(bin, file); } catch (e) { return Object.assign(base, { why: 'PDF 를 읽지 못함' }); }
    const text = pages.join('\n'); if (squash(text).length < 10) return Object.assign(base, { why: '글자가 없는 PDF(스캔본)' });
    // 쪽마다 다른 사람이면 한 파일에 여러 사람
    if (pages.length > 1) { const per = [...new Set(pages.map(p => nameOf(p, users).name).filter(Boolean))]; if (per.length > 1) return Object.assign(base, { why: '한 파일에 여러 사람(' + per.length + '명) — 개인별로 나눠 다시 올려 주세요' }); }
    const fn = fromFileName(file, users);
    const n = nameOf(text, users), tMonth = monthOf(text), pay_date = payDateOf(text); const notes = [];
    // 이름: 본문과 파일 이름이 둘 다 있는데 다르면 올리지 않는다(남의 명세서가 다른 사람에게 가면 안 된다) · 본문에서 못 읽었으면 파일 이름
    if (n.name && fn.name && n.name !== fn.name) return Object.assign(base, { month: tMonth || fn.month, pay_date, why: '본문의 이름과 파일 이름이 다름' });
    // 파일 이름의 다른 한글 낱말(직원 이름이 아닌 것)은 이름으로 보지 않는다 — 「스캔」「시험」 같은 낱말로 멀쩡한 파일이 막히지 않게(본문 이름이 없을 때의 사유 표시에만 쓴다)
    const name = n.name || fn.name; let by = n.name ? n.by : (fn.name ? '파일 이름' : null);
    if (!name) return Object.assign(base, { month: tMonth || fn.month, pay_date, raw_name: fn.raw_name || null, why: fn.raw_name ? '직원 목록에 없는 이름' : n.why });
    if (n.name && fn.name) by = n.by + ' + 파일 이름';
    const same = users.filter(u => u.name === name);
    if (same.length !== 1) return Object.assign(base, { month: tMonth || fn.month, pay_date, name, why: '같은 이름의 계정이 ' + same.length + '개' });
    // 월: 본문이 먼저 · 없으면 파일 이름 · 둘이 다르면 파일 이름을 쓰고 「꼭 확인」(파일 이름은 사람이 붙인 귀속 월 · 본문에는 지급 월·작성 월이 같이 찍히기도 한다)
    let month = tMonth || fn.month; if (!month) return Object.assign(base, { name, pay_date, why: '몇 월분인지 찾지 못함' });
    if (tMonth && fn.month && tMonth !== fn.month) { month = fn.month; notes.push('본문은 ' + tMonth + ' · 파일 이름은 ' + fn.month + ' — 파일 이름으로 둠'); }
    if (!n.name) notes.push('본문에서 이름을 못 읽어 파일 이름으로 판정');
    else if (n.by !== '성명 칸' && !fn.name) notes.push('성명 칸을 못 찾아 글 안의 이름으로 판정');
    return Object.assign(base, { user_id: same[0].id, name, by, month, pay_date, note: notes.join(' / ') || null });
}

// ── 직원 목록 · 서버 ──
async function loadUsers() {
    const f = opt('users');   // 검증용: [{id,name}] JSON 파일
    if (f) return JSON.parse(fs.readFileSync(f, 'utf8')).map(u => ({ id: u.id, name: squash(u.name) }));
    const { pool } = require('./_db.js');
    try { return (await pool.query(`SELECT id, name FROM users WHERE deleted_at IS NULL AND COALESCE(btrim(name), '') <> '' ORDER BY id`)).rows.map(u => ({ id: u.id, name: squash(u.name) })); }
    finally { }   // 연결은 끝에서 한 번만 닫는다(뒤에서 또 쓴다)
}
async function existingDb(months) {
    const have = new Set(); const { pool } = require('./_db.js');
    try {
        if (!(await pool.query(`SELECT to_regclass('payslips') AS t`)).rows[0].t) return { have, known: false };
        for (const x of (await pool.query(`SELECT user_id, pay_month FROM payslips WHERE deleted_at IS NULL AND pay_month = ANY($1::text[])`, [months])).rows) have.add(x.user_id + '|' + x.pay_month);
        return { have, known: true };
    } catch (e) { return { have, known: false }; }
}
async function existingOf(months) {
    if (flag('offline') || flag('users')) return { have: new Set(), known: false };
    return existingDb(months);
}

// ── 본문 ──
function collect() {
    const files = [];
    for (const t of targets) {
        if (!fs.existsSync(t)) die('없는 경로예요: ' + t);
        if (fs.statSync(t).isDirectory()) for (const f of fs.readdirSync(t).sort()) { if (/\.pdf$/i.test(f)) files.push(path.join(t, f)); }
        else if (/\.pdf$/i.test(t)) files.push(t); else die('PDF 가 아니에요: ' + path.basename(t));
    }
    return files;
}
const planId = rows => crypto.createHash('sha256').update(JSON.stringify(rows.map(r => [r.sha, r.user_id || 0, r.month || '']).sort())).digest('hex').slice(0, 10);
const md = (rows, miss, ex) => {
    const L = ['| 파일 | 직원 | 몇 월분 | 지급일 | 비고 |', '|---|---|---|---|---|'];
    for (const r of rows) L.push(`| ${path.basename(r.file)} | ${r.name} | ${r.month} | ${r.pay_date || '—'} | ${ex.have.has(r.user_id + '|' + r.month) ? '이미 있음(바꾸려면 말씀해 주세요)' : (r.note ? r.note + ' — 꼭 확인' : '')} |`);
    if (miss.length) { L.push('', '미배정(등록 안 함 · 「내 정보」 관리자 구역에서 손으로 올려 주세요)'); for (const r of miss) L.push(`- ${path.basename(r.file)} — ${r.why}`); }
    return L.join('\n');
};

// ── 처음 한 번 넣기(DB 직접) ── 서버 POST /api/payslips 와 같은 규칙: 같은 직원·같은 달 = 한 장 · 바꿀 때 옛 줄은 deleted_at 만 · PDF 머리(%PDF-)·5MB 검사 · 제목 「○○○○년 ○월 임금명세서」
async function dbApplyRun(rows, miss, plan, pub) {
    const by = parseInt(opt('by') || '1', 10); if (!(by > 0)) die('--by 는 계정 번호예요');
    const replace = flag('replace'); const done = [], skipped = [], failed = [];
    const { pool } = require('./_db.js');
    try {
        if (!(await pool.query(`SELECT to_regclass('payslips') AS t`)).rows[0].t) die('payslips 표가 아직 없어요(서버 배포 뒤에 돌려 주세요)');
        const who = (await pool.query(`SELECT id, name FROM users WHERE id = $1::int AND deleted_at IS NULL`, [by])).rows[0]; if (!who) die('--by 계정을 찾지 못했어요');
        for (const r of rows) {
            const buf = fs.readFileSync(r.file);
            if (buf.length > MAX_BYTES || buf.slice(0, 5).toString('latin1') !== '%PDF-') { failed.push(Object.assign(pub(r), { why: 'PDF 가 아니거나 너무 큼' })); continue; }
            const [y, m] = r.month.split('-'); const title = y + '년 ' + Number(m) + '월 임금명세서'; const name = path.basename(r.file).replace(/[\\/\r\n\0]/g, ' ').trim().slice(0, 200);
            const cl = await pool.connect();
            try {
                await cl.query('BEGIN');
                const old = (await cl.query(`SELECT id FROM payslips WHERE user_id = $1::int AND pay_month = $2::text AND deleted_at IS NULL FOR UPDATE`, [r.user_id, r.month])).rows[0];
                if (old && !replace) { await cl.query('ROLLBACK'); skipped.push(Object.assign(pub(r), { why: '이미 있음(바꾸려면 --replace)' })); continue; }
                if (old) await cl.query(`UPDATE payslips SET deleted_at = NOW(), deleted_by = $2::int WHERE id = $1::int`, [old.id, by]);
                const id = (await cl.query(`INSERT INTO payslips (user_id, pay_month, pay_date, title, file_name, data, size_bytes, uploaded_by, uploaded_by_name)
                    VALUES ($1::int, $2::text, $3::date, $4::text, $5::text, $6::bytea, $7::int, $8::int, $9::text) RETURNING id`, [r.user_id, r.month, r.pay_date || null, title, name, buf, buf.length, by, String(who.name || '').slice(0, 60)])).rows[0].id;
                await cl.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1, 'payslip', $2, $3, 'payslip', $4, $5)`,
                    [old ? 'payslip_replace' : 'payslip_upload', id, JSON.stringify({ user_id: r.user_id, pay_month: r.month, pay_date: r.pay_date || null, file_name: name, size: buf.length, via: 'desk-initial', ...(old ? { replaced: old.id } : {}) }), by, who.name || null]);
                await cl.query('COMMIT'); done.push(Object.assign(pub(r), { id }));
            } catch (e) { try { await cl.query('ROLLBACK'); } catch (_) { } failed.push(Object.assign(pub(r), { why: String(e.code === '23505' ? '방금 같은 달이 올라옴' : e.message).slice(0, 80) })); }
            finally { cl.release(); }
        }
    } finally { await pool.end().catch(() => { }); }
    out({ ok: failed.length === 0, mode: 'db-apply', plan, registered: done.length, skipped: skipped.length, failed: failed.length, unassigned: miss.length, items: done, skipped_items: skipped, failed_items: failed, miss: miss.map(pub) });
    process.exit(failed.length ? 1 : 0);
}

(async () => {
    const dry = flag('dry'), apply = flag('apply'), dbApply = flag('db-apply');
    if ([dry, apply, dbApply].filter(Boolean).length !== 1) die('--dry · --apply · --db-apply 중 하나만 주세요');
    if (!targets.length) die('PDF 파일이나 폴더를 주세요');
    const bin = pdftotextBin(); if (!bin) die('pdftotext 를 찾지 못했어요(Git for Windows 의 mingw64\\bin 에 있어요 · 환경변수 PDFTOTEXT 로 경로를 줄 수 있어요)');
    const files = collect(); if (!files.length) die('PDF 가 없어요');
    const users = await loadUsers();
    const all = files.map(f => readOne(bin, f, users));
    let rows = all.filter(r => r.user_id && !r.why), miss = all.filter(r => !r.user_id || r.why);
    // 같은 직원·같은 달 파일이 둘 이상 = 어느 것이 맞는지 모름 → 둘 다 미배정
    const cnt = {}; for (const r of rows) cnt[r.user_id + '|' + r.month] = (cnt[r.user_id + '|' + r.month] || 0) + 1;
    miss = miss.concat(rows.filter(r => cnt[r.user_id + '|' + r.month] > 1).map(r => Object.assign({}, r, { why: '같은 직원·같은 달 파일이 ' + cnt[r.user_id + '|' + r.month] + '개' })));
    rows = rows.filter(r => cnt[r.user_id + '|' + r.month] === 1);
    const ex = await existingOf([...new Set(rows.map(r => r.month))]);
    const plan = planId(rows);
    const pub = r => ({ file: path.basename(r.file), name: r.name || null, user_id: r.user_id || null, month: r.month || null, pay_date: r.pay_date || null, by: r.by || null, note: r.note || null, exists: r.user_id ? ex.have.has(r.user_id + '|' + r.month) : false, why: r.why || null });

    if (dry) {
        console.log(md(rows, miss, ex));
        if (!ex.known) console.log('\n(이미 올라간 달인지는 확인하지 못했어요 — 등록할 때 서버가 알려 줘요)');
        out({ ok: true, mode: 'dry', plan, matched: rows.length, unassigned: miss.length, exists: rows.filter(r => ex.have.has(r.user_id + '|' + r.month)).length, exists_known: ex.known, items: rows.map(pub), miss: miss.map(pub) });
        return process.exit(0);
    }
    // --apply · --db-apply: 승인된 계획과 같아야 한다
    if (opt('plan') !== plan) die('확인표를 본 뒤 파일이나 매칭이 바뀌었어요 — --dry 부터 다시 해 주세요', { plan_now: plan });
    if (dbApply) return dbApplyRun(rows, miss, plan, pub);
    const orderId = parseInt(opt('order') || '', 10); if (!(orderId > 0)) die('--order <지시 번호>가 필요해요(그 PDF 가 첨부된 지시)');
    if (!rows.length) { out({ ok: true, mode: 'apply', plan, registered: 0, failed: 0, unassigned: miss.length, items: [], miss: miss.map(pub) }); return process.exit(0); }
    const replace = flag('replace'), notify = !flag('no-notify'); const { pool } = require('./_db.js');
    if (!(await pool.query(`SELECT to_regclass('payslip_queue') AS t`)).rows[0].t) die('요청 표(payslip_queue)가 아직 없어요(서버 배포 뒤에 돌려 주세요)');
    if (files.length !== 1 || rows.length !== 1) die('창구 등록은 지시 1건 = 파일 1개 = 사람 1명이에요(여러 장이면 지시를 나눠 올려 주세요)');   // 총괄 결정 10/12: 줄에 파일을 싣지 않는다 — 서버가 그 지시의 첨부를 그대로 쓴다
    const single = true;
    const ids = [];
    for (const r of rows) {
        const id = (await pool.query(`INSERT INTO payslip_queue (order_id, user_id, pay_month, pay_date, file_name, data, replace, notify) VALUES ($1::int, $2::int, $3::text, $4::text, $5::text, $6::bytea, $7::boolean, $8::boolean) RETURNING id`,
            [orderId, r.user_id, r.month, r.pay_date || null, path.basename(r.file).slice(0, 200), single ? null : fs.readFileSync(r.file), replace, notify])).rows[0].id;
        ids.push(id); r.qid = id;
    }
    // 서버가 집을 때까지 기다린다(20초 틱)
    const t0 = Date.now(); let res = [];
    for (;;) {
        res = (await pool.query(`SELECT id, status, error, payslip_id FROM payslip_queue WHERE id = ANY($1::int[])`, [ids])).rows;
        if (res.every(x => x.status !== 'wait') || Date.now() - t0 > QUEUE_WAIT_MS) break;
        await new Promise(r => setTimeout(r, QUEUE_POLL_MS));
    }
    await pool.end().catch(() => { });
    const by = new Map(res.map(x => [x.id, x])); const done = [], failed = [], waiting = [];
    for (const r of rows) { const q = by.get(r.qid) || {}; const o = Object.assign(pub(r), { queue_id: r.qid });
        if (q.status === 'done') done.push(Object.assign(o, { payslip_id: q.payslip_id })); else if (q.status === 'fail') failed.push(Object.assign(o, { why: String(q.error || '').slice(0, 120) })); else waiting.push(o); }
    out({ ok: failed.length === 0 && waiting.length === 0, mode: 'apply', plan, order_id: orderId, registered: done.length, failed: failed.length, waiting: waiting.length, unassigned: miss.length, items: done, failed_items: failed, waiting_items: waiting, miss: miss.map(pub),
        ...(waiting.length ? { note: '서버가 아직 집지 않았어요 — 잠시 뒤 payslip_queue 의 그 줄을 다시 확인해 주세요(다시 --apply 하지 말 것)' } : {}) });
    process.exit(failed.length || waiting.length ? 1 : 0);
})().catch(e => die(String(e && e.message || e)));

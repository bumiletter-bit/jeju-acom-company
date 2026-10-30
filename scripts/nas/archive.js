// #922 ④ 렌더 DB → 나스 「내리기」(기록 보관) — 나스 컨테이너 akkome-desk 안에서 매주 1회(일요일 03:00 KST · 호스트 systemd akm-archive.timer → /usr/local/sbin/akm-archive.sh)
//   사용: node scripts/nas/archive.js [--dry] [--out /share-arc] [--days 330] [--keep 10] [--only logs|backups]
//   (a) 알림톡·발송안내 기록 = lms_guide_log · kakao_notify_log(+ 서버 보관 정리가 옮겨 둔 *_archive 표가 있으면 그것도) 에서 created_at 이 --days(330일) 넘은 행을
//       달(KST)마다 CSV 한 파일 `알림톡/알림톡_YYYY-MM.csv`(UTF-8 BOM · CRLF · 첫 칸 「표」 = 어느 표 행인지) 로 내림. 🔴 DB 는 안 지움(서버 db_retention log_days 가 처리 · 그 전에 파일이 있으면 됨).
//       멱등 = 같은 달 파일이 이미 있으면 행 수를 세어 같으면 건너뜀 · 다르면(늘었으면) 통째 다시 씀(임시 파일 → 바꿔 끼움).
//   (b) 쿠팡·네이버 상품 보관본 = coupang_item_backups(seller_product_id) · naver_product_backups(product_no) 에서 상품마다 최근 --keep(10)판(id 내림차순)은 남기고
//       옛 판을 `상품보관본/상품보관본_<coupang|naver>_<상품번호>_<id>.json` 으로 내린 뒤 그 행만 DELETE. 지우기 전 = 파일 크기 > 0 + JSON 다시 읽어 id 같음 확인 · 실패하면 그 행은 안 지움.
//       상품번호가 빈 행은 셈에 안 넣고 안 지움. 표마다 audit_logs 한 줄(source 'nas-archive' · changes.ids).
//       🔴 제외 목록 = <out>/_keep.txt(총괄 10/30 · CLAUDE.md 되돌리기 줄의 보관본 id · 러너 revert 가 id 로 돌아가므로 남김) · 한 줄 = `naver 41` 또는 `coupang 163~188`(범위 · 쉼표로 여러 개 · # 주석) · 파일 없으면 제외 0.
//       제외된 id 는 파일로 안 내리고 안 지움(남긴 행으로 셈).
//   🔴 러너 revert 는 보관본 id 로 되돌린다 → 내린 판은 러너로 못 되돌리고 파일(before_json) 을 보고 사람이 손으로. 최근 10판과 _keep.txt 의 id 는 그대로 남는다.
//   DB 쓰기 = (b) DELETE 와 audit INSERT 만 · 발송·러너·server.js 무접촉 · 비번·열쇠 출력 0(연결은 /work/.env DATABASE_URL · scripts/desk/_db.js 재사용).
//   로그 = <out>/_log/archive.log 한 줄(이 스크립트가 씀) · last-run.txt(전문 · 호스트 sh 가 씀). --dry = 읽기만 · 파일·DB 무접촉 · 대상 표를 찍음.
//   끄기 = 나스 `sudo systemctl disable --now akm-archive.timer` · 손으로 한 번 = `sudo /usr/local/sbin/akm-archive.sh`(또는 컨테이너 안 이 명령).
'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('../desk/_db');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const DRY = flag('--dry');
const OUT = opt('--out', process.env.ARCHIVE_DIR || '/share-arc');
const DAYS = Math.max(30, parseInt(opt('--days', '330'), 10) || 330);
const KEEP = Math.max(3, parseInt(opt('--keep', '10'), 10) || 10);
const ONLY = opt('--only', '');          // logs | backups | ''(둘 다)
const LOG_TABLES = ['lms_guide_log', 'kakao_notify_log'];
const BACKUP_TABLES = [
    { table: 'coupang_item_backups', key: 'seller_product_id', channel: 'coupang' },
    { table: 'naver_product_backups', key: 'product_no', channel: 'naver' },
];
const started = new Date();
// _keep.txt 읽기 → { coupang:Set, naver:Set } · 한 줄 꼴 = "<channel> <id>[,<id>|<a>~<b>]..." · # 뒤는 주석
function readKeep() {
    const file = path.join(OUT, '_keep.txt'), keep = { coupang: new Set(), naver: new Set() };
    let txt;
    try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return { keep, file, lines: 0 }; }
    let lines = 0;
    for (let raw of txt.split(/\r?\n/)) {
        raw = raw.replace(/#.*/, '').trim(); if (!raw) continue;
        const m = raw.match(/^(coupang|naver)\s+(.+)$/i); if (!m) throw new Error(`_keep.txt 줄 꼴 오류: ${raw}`);
        const set = keep[m[1].toLowerCase()];
        for (const tok of m[2].split(/[\s,]+/).filter(Boolean)) {
            const r = tok.match(/^(\d+)\s*[~\-]\s*(\d+)$/);
            if (r) { const a = +r[1], b = +r[2]; if (b < a || b - a > 5000) throw new Error(`_keep.txt 범위 오류: ${tok}`); for (let i = a; i <= b; i++) set.add(i); }
            else if (/^\d+$/.test(tok)) set.add(+tok);
            else throw new Error(`_keep.txt 값 오류: ${tok}`);
        }
        lines++;
    }
    return { keep, file, lines };
}
const KEEP_LIST = readKeep();
const kst = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
const out = (s) => console.log(s);
const summary = { logs: { months: 0, rows: 0, written: 0, skipped: 0, files: [] }, backups: {}, errors: [] };

function csvCell(v) {
    if (v == null) return '';
    let s;
    if (v instanceof Date) s = isNaN(v) ? '' : v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// CSV 행 수 세기(따옴표 안 줄바꿈은 한 행) — 멱등 판정용
function csvDataRows(file) {
    let txt;
    try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return -1; }
    let rows = 0, inQ = false;
    for (let i = 0; i < txt.length; i++) {
        const c = txt[i];
        if (c === '"') inQ = !inQ;
        else if (c === '\n' && !inQ) rows++;
    }
    if (txt.length && txt[txt.length - 1] !== '\n') rows++;
    return Math.max(0, rows - 1);   // 머리 줄 빼기
}
async function tableExists(c, name) {
    const r = await c.query(`SELECT to_regclass($1)::text AS t`, ['public.' + name]);
    return !!r.rows[0].t;
}
async function colsOf(c, name) {
    const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [name]);
    return r.rows.map(x => x.column_name);
}
function atomicWrite(file, data) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

// ---------- (a) 알림톡·발송안내 기록 → 달마다 CSV ----------
async function archiveLogs(c) {
    const dir = path.join(OUT, '알림톡');
    const sources = [];   // {table, where}
    for (const t of LOG_TABLES) {
        if (!(await tableExists(c, t))) { out(`(a) 표 없음: ${t}`); continue; }
        sources.push({ table: t, where: `created_at < NOW() - make_interval(days => ${DAYS})` });
        if (await tableExists(c, t + '_archive')) sources.push({ table: t + '_archive', where: 'TRUE' });   // 서버가 이미 옮긴 행은 전부
    }
    if (!sources.length) return;
    // 칸 = 모든 원천 표의 합집합(첫 표 순서 유지 · 뒤 표의 새 칸은 뒤에)
    const header = ['표'];
    for (const s of sources) for (const col of await colsOf(c, s.table)) if (!header.includes(col)) header.push(col);
    // 달(KST)별 행 수
    const months = new Map();
    for (const s of sources) {
        const r = await c.query(`SELECT to_char(created_at + interval '9 hours', 'YYYY-MM') AS m, count(*)::int AS n FROM ${s.table} WHERE ${s.where} GROUP BY 1`);
        for (const row of r.rows) months.set(row.m, (months.get(row.m) || 0) + row.n);
    }
    const keys = [...months.keys()].sort();
    summary.logs.months = keys.length;
    out(`(a) 알림톡·발송안내 ${DAYS}일 넘은 행 = ${[...months.values()].reduce((a, b) => a + b, 0)}행 · ${keys.length}달 · 원천 ${sources.map(s => s.table).join(', ')}`);
    if (!keys.length) return;
    if (!DRY) fs.mkdirSync(dir, { recursive: true });
    for (const m of keys) {
        const want = months.get(m);
        const file = path.join(dir, `알림톡_${m}.csv`);
        summary.logs.rows += want;
        const have = csvDataRows(file);
        if (have === want) { out(`  ${m}: ${want}행 · 파일 같음 → 건너뜀`); summary.logs.skipped++; continue; }
        out(`  ${m}: ${want}행 → ${path.basename(file)}${have >= 0 ? ` (지금 ${have}행 · 다시 씀)` : ' (새 파일)'}`);
        if (DRY) continue;
        const lines = ['﻿' + header.map(csvCell).join(',')];
        for (const s of sources) {
            const cols = await colsOf(c, s.table);
            const r = await c.query(
                `SELECT ${cols.map(x => `"${x}"`).join(', ')} FROM ${s.table} WHERE ${s.where} AND to_char(created_at + interval '9 hours', 'YYYY-MM') = $1 ORDER BY created_at, id`, [m]);
            for (const row of r.rows) lines.push(header.map(h => h === '표' ? csvCell(s.table) : csvCell(row[h])).join(','));
        }
        if (lines.length - 1 !== want) throw new Error(`(a) ${m} 행 수 어긋남: 셈 ${want} · 읽음 ${lines.length - 1}`);
        atomicWrite(file, lines.join('\r\n') + '\r\n');
        const back = csvDataRows(file);
        if (back !== want) throw new Error(`(a) ${m} 쓴 뒤 행 수 어긋남: ${back} ≠ ${want}`);
        summary.logs.written++; summary.logs.files.push(path.basename(file));
    }
}

// ---------- (b) 상품 보관본 → JSON 파일 → DELETE ----------
async function archiveBackups(c, spec) {
    const { table, key, channel } = spec;
    const st = summary.backups[channel] = { targets: 0, written: 0, deleted: 0, failed: 0, products: 0, null_key: 0, excluded: 0, ids: [] };
    const excl = KEEP_LIST.keep[channel];
    if (!(await tableExists(c, table))) { out(`(b) 표 없음: ${table}`); return; }
    const dir = path.join(OUT, '상품보관본');
    const nk = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${key} IS NULL`);
    st.null_key = nk.rows[0].n;
    const r = await c.query(
        `WITH r AS (SELECT id, ${key} AS k, created_at, row_number() OVER (PARTITION BY ${key} ORDER BY id DESC) AS rn FROM ${table} WHERE ${key} IS NOT NULL)
         SELECT id, k, created_at FROM r WHERE rn > ${KEEP} ORDER BY k, id`);
    const all = r.rows.length;
    const rows = r.rows.filter(row => !excl.has(row.id));
    st.excluded = all - rows.length;
    st.targets = rows.length;
    const byProduct = new Map();
    for (const row of rows) { const a = byProduct.get(row.k) || []; a.push(row.id); byProduct.set(row.k, a); }
    st.products = byProduct.size;
    out(`(b) ${channel} ${table}: 최근 ${KEEP}판 밖 = ${all}행 · _keep.txt 제외 ${st.excluded} → 내릴 것 ${st.targets}행 · 상품 ${st.products}개${st.null_key ? ` · 상품번호 빈 행 ${st.null_key}(안 건드림)` : ''}`);
    if (st.excluded) out(`  제외(남김): ${r.rows.filter(x => excl.has(x.id)).map(x => x.id).join(' ')}`);
    for (const [k, ids] of byProduct) out(`  ${k}: ${ids.length}행 · id ${ids[0]}~${ids[ids.length - 1]}`);
    if (DRY || !st.targets) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const row of rows) {
        const file = path.join(dir, `상품보관본_${channel}_${row.k}_${row.id}.json`);
        try {
            const full = (await c.query(`SELECT * FROM ${table} WHERE id = $1`, [row.id])).rows[0];
            if (!full) { st.failed++; summary.errors.push(`${channel} id ${row.id} 읽기 0행`); continue; }
            const data = JSON.stringify({ table, archived_at: new Date().toISOString(), row: full }, null, 1);
            atomicWrite(file, data);
            // 지우기 전 확인: 크기 > 0 · 다시 읽어 JSON 파싱 · id·상품번호 같음
            const sz = fs.statSync(file).size;
            const back = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!(sz > 0) || !back || !back.row || back.row.id !== row.id || String(back.row[key]) !== String(row.k)) throw new Error('파일 확인 실패(크기·id)');
            st.written++;
            const d = await c.query(`DELETE FROM ${table} WHERE id = $1 AND ${key} = $2`, [row.id, row.k]);
            if (d.rowCount === 1) { st.deleted++; st.ids.push(row.id); }
            else { st.failed++; summary.errors.push(`${channel} id ${row.id} DELETE 0행(파일은 남김)`); }
        } catch (e) {
            st.failed++; summary.errors.push(`${channel} id ${row.id}: ${String(e.message || e).slice(0, 120)}`);
        }
    }
    if (st.ids.length) {
        await c.query(
            `INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1, $2, NULL, $3::jsonb, 'nas-archive', NULL, '기록 보관(나스 archive.js)')`,
            ['archive-delete', table, JSON.stringify({ why: `#922 상품마다 최근 ${KEEP}판 남기고 옛 판 나스로 내림(_keep.txt 제외 ${st.excluded})`, keep: KEEP, n: st.ids.length, ids: st.ids, excluded: st.excluded, dir: `${OUT}/상품보관본`, products: st.products })]);
    }
    out(`  → 파일 ${st.written} · 지움 ${st.deleted} · 실패 ${st.failed}`);
}

function writeLogLine(ok) {
    if (DRY) return;
    const b = summary.backups;
    const bk = Object.keys(b).map(ch => `${ch === 'coupang' ? '쿠팡' : '네이버'} ${b[ch].deleted}/${b[ch].targets}${b[ch].excluded ? `(제외 ${b[ch].excluded})` : ''}${b[ch].failed ? `(실패 ${b[ch].failed})` : ''}`).join(' · ');
    const line = `${kst(started)}~${kst(new Date()).slice(11)} ${ok ? '성공' : '실패'} · 알림톡 ${summary.logs.rows}행/${summary.logs.months}달(새로 씀 ${summary.logs.written} · 같음 ${summary.logs.skipped}) · 보관본 지움 ${bk || '-'}${summary.errors.length ? ` · 오류 ${summary.errors.length}(last-run.txt)` : ''}`;
    try { fs.mkdirSync(path.join(OUT, '_log'), { recursive: true }); fs.appendFileSync(path.join(OUT, '_log', 'archive.log'), line + '\n'); } catch (e) { out('로그 쓰기 실패: ' + e.message); }
    out(line);
}

(async () => {
    out(`#922 archive.js ${DRY ? '--dry(읽기만) ' : ''}· out ${OUT} · days ${DAYS} · keep ${KEEP}${ONLY ? ` · only ${ONLY}` : ''} · ${kst(started)} KST`);
    out(`_keep.txt(${KEEP_LIST.file}) = ${KEEP_LIST.lines ? `${KEEP_LIST.lines}줄 · 쿠팡 ${KEEP_LIST.keep.coupang.size} · 네이버 ${KEEP_LIST.keep.naver.size} id 제외` : '없음(제외 0)'}`);
    if (!DRY) {
        if (!fs.existsSync(OUT)) throw new Error(`출력 폴더 없음: ${OUT} (compose 마운트 /volume1/아꼼/_기록보관:/share-arc 확인)`);
        fs.accessSync(OUT, fs.constants.W_OK);
    }
    const c = await pool.connect();
    try {
        await c.query(`SET statement_timeout = '300s'`);
        if (ONLY !== 'backups') await archiveLogs(c);
        if (ONLY !== 'logs') for (const spec of BACKUP_TABLES) await archiveBackups(c, spec);
    } finally { c.release(); }
    await pool.end();
    const ok = summary.errors.length === 0;
    if (summary.errors.length) out('오류:\n  ' + summary.errors.join('\n  '));
    writeLogLine(ok);
    process.exit(ok ? 0 : 1);
})().catch(async e => {
    summary.errors.push(String(e.message || e));
    out('ERR ' + (e.stack || e.message || e));
    writeLogLine(false);
    try { await pool.end(); } catch (_) { /* 무시 */ }
    process.exit(1);
});

// DB 복원 스크립트 (0단계) — db-backup.js가 만든 SQL 파일을 트랜잭션으로 실행
// 사용법: node scripts/db-restore.js <백업파일명 또는 전체경로>
//   예: node scripts/db-restore.js backup_v4.0_20260718.sql
// ⚠️ 기존 데이터를 전부 TRUNCATE 후 백업 시점 데이터로 덮어씀. 실행 전 반드시 현재 상태 백업 권장.
// 안전장치: --yes 플래그 없이는 실행하지 않음 (실수 방지)
// #1288 파일을 통째 문자열로 읽지 않는다 — 11/05 부터 백업이 512MB(V8 문자열 상한)를 넘어 readFileSync 에서 ERR_STRING_TOO_LONG.
//   · 1MB 씩 흘려 읽어 문장(;) 단위로 자른다 — 따옴표 안('' 겹침 · E'' 역슬래시 · "식별자")·주석(-- · /* */) 안의 ; 는 문장 끝이 아님
//   · 큰 INSERT(백업 안 500줄 묶음 · report_files 는 한 문장이 400MB 넘음)는 줄 경계(괄호 밖 ,)에서 약 8MB 씩 같은 머리의 INSERT 로 나눠 보냄
//   · 여러 문장을 약 8MB 씩 묶어 한 번에 보냄 · 전부 BEGIN … COMMIT 한 트랜잭션 = 하나라도 실패하면 전부 ROLLBACK(종전과 같음)
//   · $$ 따옴표는 db-backup.js 가 내지 않아 다루지 않음
// #1291 🔴 회사프로그램 서버를 멈춘(세운) 뒤에 할 것 — 서버가 돌면 타이머·러너가 복원 중인 표에 쓰기를 섞는다(복원 뒤 다시 켬)
//   · 시작 때 대상 DB 한 줄(호스트·포트·DB 이름만 · 사용자·비번은 안 찍음)
//   · 부분 백업(첫 줄 「-- ⚠️ 부분 백업 … 복원 금지」)·표 백업 실패 줄(「-- ⚠️ <표> 백업 실패:」)이 든 파일은 거절(강제 인자 없음 · 다른 백업 파일로)
//   · 표 틀(CREATE TABLE)은 백업에 없다 = 빈 DB 에는 그대로 안 됨 → docs/DB_복원_절차.md
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}

// 대상 DB 이름표 — 호스트·포트·DB 이름만(사용자·비번 안 찍음)
function targetLabel() {
    const u = process.env.DATABASE_URL;
    if (!u) return '(DATABASE_URL 없음)';
    try { const x = new URL(u); return `${x.hostname}${x.port ? ':' + x.port : ''}/${decodeURIComponent(x.pathname.replace(/^\//, '')) || '(DB 이름 없음)'}`; }
    catch (_) { return '(DATABASE_URL 꼴을 못 읽음)'; }
}
// 오류 글에서 연결 주소의 사용자·비번 글자를 가림
function scrub(msg) {
    let s = String(msg || '');
    try {
        const x = new URL(process.env.DATABASE_URL || '');
        for (const v of [x.password, x.username].map(decodeURIComponent).filter(v => v && v.length >= 2)) s = s.split(v).join('***');
    } catch (_) { /* 주소 없음 */ }
    return s;
}
// 복원하면 안 되는 백업인지 — 첫 줄 「부분 백업」 · 「-- ⚠️ <표> 백업 실패:」 줄(줄 머리에서만) · 흘려 읽음(큰 파일도 메모리 작게)
async function refuseReason(filePath) {
    const PART = Buffer.from('-- ⚠️ 부분 백업', 'utf8');
    const MARK = Buffer.from('\n-- ⚠️ ', 'utf8'), FAIL = Buffer.from(' 백업 실패:', 'utf8');
    let carry = Buffer.alloc(0), first = true;
    const failed = [];
    const look = ln => { const f = ln.indexOf(FAIL); if (f > 0 && ln.subarray(0, f).indexOf(0x20) < 0) failed.push(ln.subarray(0, f).toString('utf8')); };
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1 << 20 })) {
        const b = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        if (first && b.length >= PART.length) { first = false; if (b.subarray(0, PART.length).equals(PART)) return '부분 백업 파일(첫 줄 「복원 금지」) — 전체 백업으로 복원하세요'; }
        let i = 0, cut = Math.max(0, b.length - (MARK.length - 1));   // 조각 경계에 걸친 표식을 다음 조각에서 찾게 꼬리를 남김
        while ((i = b.indexOf(MARK, i)) >= 0) {
            const nl = b.indexOf(0x0a, i + 1);
            if (nl < 0) { cut = i; break; }                         // 줄이 다음 조각으로 넘어감 → 표식부터 남김
            look(b.subarray(i + MARK.length, nl));
            cut = Math.max(cut, nl);                                 // 본 줄은 다시 안 봄(끝 \n 은 다음 표식의 머리일 수 있어 남김)
            i = nl;
        }
        carry = b.subarray(cut);
    }
    if (carry.subarray(0, MARK.length).equals(MARK)) look(carry.subarray(MARK.length));
    return failed.length ? `표 백업이 실패한 파일(${failed.length}개: ${failed.slice(0, 5).join(', ')}) — 그 표는 비워진 채 복원됨 · 다른 백업 파일로` : '';
}

const PIECE = 8 << 20;   // 큰 INSERT 를 나누는 크기 · 여러 문장을 묶어 보내는 크기

// 문장 자르기 — feed(buf) 로 바이트를 넣으면 끝난 문장(Buffer · 끝 ; 포함)을 onStmt 로 넘김
// 경계 글자(; , ( ) ' " - / * \ E)는 모두 ASCII 라 UTF-8 여러 바이트 글자 중간에서 자르는 일이 없다
function makeSplitter(onStmt, piece = PIECE) {
    const N = 0, SQ = 1, ESQ = 2, DQ = 3, LC = 4, BC = 5;
    let st = N, prev = 0, esc = false, reopen = -1;   // reopen = 방금 닫힌 따옴표 종류(바로 뒤 같은 따옴표 = 겹침 → 같은 종류로 다시 엶)
    let parts = [], len = 0;                          // 지금 문장의 바이트(조각들)
    let depth = 0, word = '', lastWord = '', firstWord = '';
    let head = null, cutFrom = 0;                     // INSERT … VALUES 머리 · 아직 안 보낸 줄 묶음의 시작 자리
    let line = 1, stmtLine = 1, started = false;

    const take = (from, to) => {                      // 지금 문장의 [from, to) 바이트를 Buffer 로
        const all = parts.length === 1 ? parts[0] : Buffer.concat(parts, len);
        parts = [all];
        return all.subarray(from, to);
    };
    const reset = () => { parts = []; len = 0; depth = 0; word = ''; lastWord = ''; firstWord = ''; head = null; cutFrom = 0; started = false; };
    const endWord = () => { if (word) { if (!firstWord) firstWord = word; lastWord = word; word = ''; } };

    function feed(buf) {
        let segStart = 0;
        const push = (end) => { if (end > segStart) { parts.push(buf.subarray(segStart, end)); len += end - segStart; } segStart = end; };
        for (let i = 0; i < buf.length; i++) {
            const c = buf[i];
            if (c === 0x0a) line++;
            if (st === N) {
                const r = reopen; reopen = -1;
                if (!started && c > 0x20) { started = true; stmtLine = line; }
                if (c === 0x27) { const isE = word === 'E' && (prev === 0x45 || prev === 0x65); word = ''; st = r === ESQ ? ESQ : r === SQ ? SQ : isE ? ESQ : SQ; }
                else if (c === 0x22) { endWord(); st = DQ; lastWord = '"'; }
                else if (c === 0x2d && prev === 0x2d) { st = LC; }
                else if (c === 0x2a && prev === 0x2f) { st = BC; }
                else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || (c >= 0x30 && c <= 0x39)) { word += String.fromCharCode(c & 0xdf); }
                else if (c <= 0x20) { endWord(); }
                else {
                    endWord();
                    if (c === 0x28) {
                        if (depth === 0 && !head && firstWord === 'INSERT' && lastWord === 'VALUES') {
                            push(i); head = Buffer.from(take(0, len)); cutFrom = len;   // 머리 = 첫 줄 괄호 앞까지
                        }
                        depth++;
                    } else if (c === 0x29) depth--;
                    else if (c === 0x2c && depth === 0 && head) {
                        const at = len + (i - segStart);
                        if (at - cutFrom >= piece) {                                 // 이 , 앞까지를 한 문장으로 보냄
                            push(i);
                            onStmt(Buffer.concat([head, take(cutFrom, at), Buffer.from(';')]), stmtLine);
                            segStart = i + 1; parts = []; len = 0; cutFrom = 0;   // 남은 줄들은 머리 없이 이어 받고, 보낼 때 머리를 붙임
                        }
                    } else if (c === 0x3b) {
                        push(i + 1);
                        if (head) onStmt(Buffer.concat([head, take(cutFrom, len)]), stmtLine);
                        else onStmt(take(0, len), stmtLine);
                        reset();
                    }
                    lastWord = String.fromCharCode(c);
                }
            } else if (st === SQ) { if (c === 0x27) { st = N; reopen = SQ; } }
            else if (st === ESQ) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x27) { st = N; reopen = ESQ; } }
            else if (st === DQ) { if (c === 0x22) { st = N; reopen = DQ; } }
            else if (st === LC) { if (c === 0x0a) st = N; }
            else if (st === BC) { if (c === 0x2f && prev === 0x2a) st = N; }
            prev = (c === 0x27 || c === 0x22) ? 0 : c;
        }
        push(buf.length);
    }
    // 끝: 남은 바이트가 공백·주석뿐이면 없음 · 글이 남았으면(; 없이 끝난 문장) 그대로 넘김 · 따옴표가 안 닫혔으면 오류
    function end() {
        if (st === SQ || st === ESQ || st === DQ || st === BC) throw new Error('파일이 따옴표·주석 안에서 끝남(잘린 백업 파일?)');
        if (started && len) {
            const rest = head ? Buffer.concat([head, take(cutFrom, len)]) : take(0, len);
            onStmt(rest, stmtLine);
        }
        reset();
    }
    return { feed, end };
}

async function main() {
    const fileArg = process.argv.filter(a => !a.startsWith('--'))[2];
    const confirmed = process.argv.includes('--yes');
    if (!fileArg) {
        console.error('사용법: node scripts/db-restore.js <백업파일> --yes');
        process.exit(1);
    }
    let filePath = fileArg;
    if (!fs.existsSync(filePath)) {
        const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '제주아꼼이네_DB백업');
        filePath = path.join(backupDir, fileArg);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 백업 파일을 찾을 수 없습니다: ${fileArg}`);
        process.exit(1);
    }
    const why = await refuseReason(filePath);
    if (why) {
        console.error(`❌ 복원 거절: ${why}`);
        console.error(`   파일: ${filePath}`);
        process.exit(1);
    }
    if (!confirmed) {
        console.error('⚠️ 복원은 기존 데이터를 전부 덮어씁니다. 진행하려면 --yes 를 붙여 실행하세요.');
        console.error(`   대상 DB: ${targetLabel()}`);
        console.error('   🔴 회사프로그램 서버를 먼저 멈추고(세우고) 하세요 — 도는 중이면 복원 중인 표에 쓰기가 섞입니다');
        console.error(`   node scripts/db-restore.js "${fileArg}" --yes`);
        process.exit(1);
    }

    const total = fs.statSync(filePath).size;
    console.log(`🎯 대상 DB: ${targetLabel()}`);
    console.log('   🔴 회사프로그램 서버는 멈춘(세운) 상태여야 합니다 — 복원이 끝난 뒤 다시 켜세요');
    const pool = new Pool(dbConfig);
    pool.on('error', e => console.error('   (연결 오류:', scrub(e && e.message), ')'));   // 쉬는 연결의 오류로 node 가 죽지 않게 · 진행 중 문장은 아래 catch 가 받음
    const client = await pool.connect();
    client.on('error', e => console.error('   (연결 오류:', scrub(e && e.message), ')'));
    let at = 0;   // 실패 때 알릴 문장 위치
    try {
        console.log(`📥 복원 시작: ${filePath}`);
        await client.query('BEGIN');
        // #1288 백업은 표를 이름순으로 넣는다(agent_feedback → agents …) → 외래 키(36개 · 전부 즉시 검사)에 걸려 어느 길로도 복원이 안 됐다.
        //   같은 트랜잭션 안에서 외래 키를 잠시 내렸다가 자료를 다 넣은 뒤 그대로 다시 건다 = 다시 걸 때 전 줄 검사 · 어긋나면 전부 ROLLBACK
        //   (관리자 권한 불필요 · 표 주인이면 됨 · 실패해도 내린 키까지 함께 되돌려짐)
        const { rows: fks } = await client.query(`
            SELECT c.conrelid::regclass::text AS t, c.conname AS n, pg_get_constraintdef(c.oid) AS d
            FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1, 2`);
        const qn = s => '"' + String(s).replace(/"/g, '""') + '"';
        for (const k of fks) await client.query(`ALTER TABLE ${k.t} DROP CONSTRAINT ${qn(k.n)}`);
        if (fks.length) console.log(`   🔗 외래 키 ${fks.length}개를 잠시 내리고 넣음 — 끝에 다시 걸며 전 줄 검사`);
        let batch = [], batchLen = 0, batchLine = 1, sent = 0, nextShow = 100 << 20;
        const flush = async () => {
            if (!batch.length) return;
            const text = batch.length === 1 ? batch[0].toString('utf8') : Buffer.concat(batch, batchLen).toString('utf8');
            at = batchLine; batch = []; batchLen = 0;
            await client.query(text);
        };
        const ready = [];
        const sp = makeSplitter((b, ln) => ready.push([b, ln]));
        const rd = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
        for await (const chunk of rd) {
            sp.feed(chunk);
            sent += chunk.length;
            while (ready.length) {
                const [b, ln] = ready.shift();
                if (!batch.length) batchLine = ln;
                batch.push(b); batchLen += b.length;
                if (batchLen >= PIECE) await flush();
            }
            if (sent >= nextShow) { console.log(`   … ${Math.round(sent / 1048576)}MB / ${Math.round(total / 1048576)}MB`); nextShow += 100 << 20; }
        }
        sp.end();
        while (ready.length) { const [b, ln] = ready.shift(); if (!batch.length) batchLine = ln; batch.push(b); batchLen += b.length; }
        await flush();
        at = 0;
        for (const k of fks) {
            try { await client.query(`ALTER TABLE ${k.t} ADD CONSTRAINT ${qn(k.n)} ${k.d}`); }
            catch (e) { e.message = `외래 키 ${k.n}(${k.t}) 다시 걸기 실패 — ${e.message}`; throw e; }
        }
        await client.query('COMMIT');
        console.log('✅ 복원 완료 (트랜잭션 커밋됨)');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error('❌ 복원 실패 — 전부 롤백됨 (DB는 복원 시도 전 상태 그대로):', scrub(err.message));
        if (at) console.error(`   (백업 파일 ${at}번째 줄 근처 문장 묶음에서)`);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

// #1291 연결 실패 등 try 밖 오류 — 쌓인 스택 대신 짧은 글 · 사용자·비번 가림 · 종료 1(DB 는 안 바뀜: BEGIN 전이거나 롤백됨)
if (require.main === module) main().catch(e => {
    const code = e && e.code ? `[${e.code}] ` : '';
    const msg = scrub((e && (e.message || (e.errors && e.errors.map(x => x.code || x.message).join(', ')))) || String(e));
    console.error(`❌ 복원 못 함 — DB 연결 실패 또는 시작 전 오류: ${code}${msg}`);
    console.error(`   대상 DB: ${targetLabel()} · DATABASE_URL·네트워크·DB 가 켜져 있는지 확인 (DB 는 바뀐 것 없음)`);
    process.exit(1);
});
else module.exports = { makeSplitter };

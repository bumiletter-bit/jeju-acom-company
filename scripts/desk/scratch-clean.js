// #827-B 창구 지시별 작업 폴더(.scratch{지시번호}) 정리 — 끝난 지시의 오래된 폴더만 지운다
//
//   왜: launcher.js 프롬프트가 창구에게 `.scratch{id}/result.json` 을 쓰라고 해서 지시마다 폴더가 하나씩 생긴다(10/23 약 450개 · 231MB).
//   첨부는 respond.js 가 DB report_files 로 올리고 payload 는 처리 뒤 지우므로, 끝난 지시의 폴더는 다시 읽히지 않는다.
//
//   지우는 조건(전부 만족할 때만):
//   ①이름이 정확히 .scratch<숫자> ②ROOT 바로 아래 실제 폴더(심볼릭·정션 X · realpath 가 ROOT 안) · 안에도 링크가 없을 것
//   ③폴더와 안의 모든 파일 중 가장 새 mtime 이 keep_days(기본 14일)보다 오래됨
//   ④그 번호의 pending_orders 행이 「끝난 상태」(아래 DONE · 지운 행 포함) — 행이 없거나 모르는 상태면 건너뜀
//   ⑤호출자가 넘긴 「지금 처리 중 id」(launcher st.running)에 없음
//   DB 오류면 아무것도 지우지 않는다(상태를 모르면 지우지 않는다).
//
//   끝난 상태 = 허용 목록(10/23 실DB 상태 전수 + respond.js·launcher.js 가 쓰는 값). 진행 중(대기·처리중·판독완료·확인표작성·승인대기·승인됨)과
//   「질문」(직원 답 기다림)은 지우지 않는다. 새 상태가 생기면 여기 넣기 전까지는 건너뛴다(안전한 쪽).
//
//   설정 agent_office_config 'desk_scratch_clean' = { enabled, keep_days } — 키가 없거나 enabled 가 true 가 아니면 launcher 는 돌리지 않는다(기본 꺼짐).
//   CLI dry 는 설정과 무관하게 돈다(DB 는 읽기만).
//
// 사용: node scripts/desk/scratch-clean.js                 (dry — 지울 목록·개수·MB 만)
//       node scripts/desk/scratch-clean.js --apply         (실제 삭제)
//       node scripts/desk/scratch-clean.js --root <경로> --days N   (시험)
const path = require('path');
const fs = require('fs');

const NAME_RE = /^\.scratch(\d+)$/;
const DEFAULT_DAYS = 14;
const ACTIVE = ['대기', '처리중', '판독완료', '확인표작성', '승인대기', '승인됨', '질문'];   // 참고용(지우지 않음)
const DONE = new Set(['완료', '취소', '질문종결', '안내', '반려', '응답됨', '오류', '오류확인', '대체됨', '피드백']);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

// 폴더 안을 돌며 가장 새 mtime · 바이트 합 · 링크 여부(링크는 따라가지 않음)
function scan(dir) {
    const st0 = fs.lstatSync(dir);
    let newest = st0.mtimeMs, bytes = 0, link = false, files = 0;
    const stack = [dir];
    while (stack.length) {
        const d = stack.pop();
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, ent.name);
            const s = fs.lstatSync(p);
            if (s.isSymbolicLink()) { link = true; continue; }
            if (s.mtimeMs > newest) newest = s.mtimeMs;
            if (s.isDirectory()) stack.push(p);
            else { bytes += s.size; files++; }
        }
    }
    return { newest, bytes, link, files };
}

// 실DB 상태 조회(기본) — ids → Map(id → { status, is_deleted })
async function dbStatusOf(ids) {
    const { pool } = require('./_db');
    if (!ids.length) return new Map();
    const r = await pool.query(`SELECT id, status, is_deleted FROM pending_orders WHERE id = ANY($1::int[])`, [ids]);
    return new Map(r.rows.map(x => [Number(x.id), { status: x.status, is_deleted: !!x.is_deleted }]));
}

// 설정 읽기 — { enabled, keep_days } (없으면 enabled false)
async function readConfig(p) {
    const pool = p || require('./_db').pool;
    const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'desk_scratch_clean'`);
    const v = r.rows[0] ? r.rows[0].value : null;
    const days = v && Number.isFinite(Number(v.keep_days)) && Number(v.keep_days) >= 1 ? Math.floor(Number(v.keep_days)) : DEFAULT_DAYS;
    return { enabled: !!(v && v.enabled === true), keep_days: days };
}

// 정리 본체 — statusOf 는 시험용 주입(기본 = 실DB 읽기) · now 도 주입 가능
async function clean(opt) {
    const o = Object.assign({ root: DEFAULT_ROOT, days: DEFAULT_DAYS, apply: false, busyIds: new Set(), log: () => { }, statusOf: dbStatusOf, now: Date.now() }, opt || {});
    const days = Math.max(1, Number(o.days) || DEFAULT_DAYS);
    const cut = o.now - days * 86400e3;
    const busy = new Set([...(o.busyIds || [])].map(Number));
    const rootReal = fs.realpathSync(o.root);
    const out = { checked: 0, deleted: 0, skipped: {}, bytes: 0, targets: [], days, apply: !!o.apply };
    const skip = (why, name) => { (out.skipped[why] = out.skipped[why] || []).push(name); };

    // 1차: 이름·폴더·링크·나이 — DB 를 묻기 전에 거른다
    const cand = [];
    for (const ent of fs.readdirSync(rootReal, { withFileTypes: true })) {
        if (!ent.name.startsWith('.scratch')) continue;
        const m = NAME_RE.exec(ent.name);
        if (!m) { skip('이름 다름', ent.name); continue; }
        out.checked++;
        const p = path.join(rootReal, ent.name);
        let ls; try { ls = fs.lstatSync(p); } catch (e) { skip('읽기 실패', ent.name); continue; }
        if (ls.isSymbolicLink() || !ls.isDirectory()) { skip('실제 폴더 아님', ent.name); continue; }
        let real; try { real = fs.realpathSync(p); } catch (e) { skip('읽기 실패', ent.name); continue; }
        if (path.dirname(real) !== rootReal) { skip('ROOT 밖', ent.name); continue; }
        const id = Number(m[1]);
        if (busy.has(id)) { skip('처리 중', ent.name); continue; }
        let sc; try { sc = scan(p); } catch (e) { skip('읽기 실패', ent.name); continue; }
        if (sc.link) { skip('안에 링크', ent.name); continue; }
        if (sc.newest >= cut) { skip('최근(' + days + '일 안)', ent.name); continue; }
        cand.push({ id, name: ent.name, path: p, bytes: sc.bytes, files: sc.files, newest: sc.newest });
    }

    // 2차: 지시 상태 — DB 오류면 그대로 던진다(하나도 안 지움)
    const sm = await o.statusOf(cand.map(c => c.id));
    for (const c of cand) {
        const s = sm.get(c.id);
        if (!s) { skip('지시 행 없음', c.name); continue; }
        if (!s.is_deleted && !DONE.has(s.status)) { skip(ACTIVE.includes(s.status) ? '진행 중 상태' : '모르는 상태(' + s.status + ')', c.name); continue; }
        if (busy.has(c.id)) { skip('처리 중', c.name); continue; }   // 상태 묻는 사이 집혔을 수도
        out.targets.push({ id: c.id, name: c.name, bytes: c.bytes, status: s.is_deleted ? s.status + '(삭제됨)' : s.status });
        if (!o.apply) { out.bytes += c.bytes; continue; }
        try { fs.rmSync(c.path, { recursive: true, force: false }); out.deleted++; out.bytes += c.bytes; }
        catch (e) { skip('지우기 실패', c.name); o.log('.scratch 정리: ' + c.name + ' 지우기 실패 ' + e.message); }
    }
    return out;
}

const mb = b => (b / 1048576).toFixed(1);

async function cli() {
    const a = process.argv.slice(2);
    const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
    const apply = a.includes('--apply');
    const root = val('--root') ? path.resolve(val('--root')) : DEFAULT_ROOT;
    const days = val('--days') ? parseInt(val('--days'), 10) : DEFAULT_DAYS;
    try {
        const r = await clean({ root, days, apply, log: m => console.log(m) });
        console.log(`${apply ? '삭제' : '(dry) 지울 대상'} — ROOT ${root} · ${r.days}일 기준`);
        console.log(`살펴본 .scratch<번호> ${r.checked}개 · 대상 ${r.targets.length}개 · ${mb(r.bytes)}MB${apply ? ' · 지움 ' + r.deleted + '개' : ''}`);
        for (const [why, names] of Object.entries(r.skipped)) console.log(`  건너뜀 「${why}」 ${names.length}개${names.length <= 8 ? ': ' + names.join(' ') : ''}`);
        if (a.includes('--list')) for (const t of r.targets) console.log(`  ${t.name}  ${t.status}  ${mb(t.bytes)}MB`);
    } catch (e) { console.error('실패(아무것도 지우지 않음): ' + e.message); process.exitCode = 1; }
    try { await require('./_db').pool.end(); } catch (e) { /* 안 열었음 */ }
}
if (require.main === module) cli();
module.exports = { clean, readConfig, dbStatusOf, scan, DONE, ACTIVE, NAME_RE, DEFAULT_DAYS };

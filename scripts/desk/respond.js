// #469 결과 올리기 — 사용: node scripts/desk/respond.js <지시 id> <결과.json>
// 결과.json 형식(하나):
//   { "kind": "answer",   "answer": "답변 글", "title": "한 줄 제목(선택)", "files": [{"label","url"}](선택),
//                         "attachments": ["만든 파일 경로", ...](선택 — 엑셀·문서·그림을 DB에 올려 화면에서 내려받게 한다 · 파일당 10MB · 5개까지) }
//   { "kind": "question", "question": "되묻는 말", "plan": { "label": "톡톡 3건 보내기", "cmds": [["node","scripts/desk/talk-send.js","{id}","보낼글.json"]] }(선택 · #598) }
//        → plan = 「응」이면 그대로 실행할 명령이 정해져 있을 때만. 화면의 [이대로 진행] 답이 오면 대기 프로그램이 AI 없이 그 명령만 실행한다(허용 목록·검사는 fast.planCheck)
//   { "kind": "ocr",      "partner": "효돈농협 | 대성(시온) | 기타거래처 | 빈 문자열", "items": [{"name","qty"}], "date": "YYYY-MM-DD(선택)" }
//        → 서버가 단가표 대조·확인표를 만든다(금액 계산은 서버 몫 — 창구는 품목·수량만 읽는다)
//   { "kind": "approval", "action": "coupon|price|send|external", "summary": "무엇을", "impact": "영향·금액·대상", "plan": "승인되면 할 일" }
//   { "kind": "refuse",   "reason": "창구에서 하지 않는 일 — 대표 창으로 넘김" }
//   { "kind": "error",    "error": "사유" }
const fs = require('fs');
const { pool, appendStep, heartbeat, audit } = require('./_db');
const path = require('path');
const clean = (s, n) => String(s == null ? '' : s).slice(0, n);
const fast = require('./fast');
// #598 A: 최종발주 메모 읽기 — 대기 프로그램이 남긴 쪽지(앞 판정 재사용분·열쇠)가 있으면 합쳐서 올리고, 이번에 읽은 판정은 보관함(7일)에 넣는다. 실패해도 올리기는 막지 않는다.
const MEMO_DIR = path.join(require('os').homedir(), '.akkome');
function memoReuse(id, j) {
    const sideFile = path.join(MEMO_DIR, 'logs', 'memo-reuse-' + id + '.json'), cacheFile = path.join(MEMO_DIR, 'memo-reuse.json');
    let side; try { side = JSON.parse(fs.readFileSync(sideFile, 'utf8')); } catch (e) { return j; }
    try { fs.unlinkSync(sideFile); } catch (e) { /* 이미 없음 */ }
    if (!j.data || !Array.isArray(j.data.items)) return j;
    try {
        let cache = null; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { cache = null; }
        const tmp = cacheFile + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(fast.memoCachePut(cache, side.keys, j.data.items))); fs.renameSync(tmp, cacheFile);
    } catch (e) { console.error('메모 판정 보관 실패(무시):', e.message); }
    return fast.memoMerge(j, side);
}
const ATTACH_EXT = ['xlsx', 'xls', 'csv', 'md', 'txt', 'pdf', 'docx', 'doc', 'pptx', 'hwp', 'hwpx', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'];   // #582: 공유폴더 서류(hwp·xls·doc·zip)도 전달
async function uploadAttachments(list, runId) {
    const out = [];
    for (const p of (Array.isArray(list) ? list : []).slice(0, 5)) {
        const fp = String(p);
        if (!fs.existsSync(fp)) throw new Error('첨부 파일이 없습니다: ' + fp);
        const ext = (path.extname(fp).slice(1) || '').toLowerCase();
        if (!ATTACH_EXT.includes(ext)) throw new Error('올릴 수 없는 형식입니다(.' + ext + '): ' + path.basename(fp));
        const buf = fs.readFileSync(fp);
        if (buf.length > 10 * 1024 * 1024) throw new Error('10MB보다 큰 파일은 올릴 수 없습니다: ' + path.basename(fp));
        if (!buf.length) throw new Error('빈 파일입니다: ' + path.basename(fp));
        const name = clean(path.basename(fp), 190);
        const r = await pool.query(`INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, $2, $3, $4) RETURNING id`, [name, runId || null, buf, buf.length]);
        out.push({ label: name, file_id: r.rows[0].id, size: buf.length });
    }
    return out;
}
// #922 ② 첨부 한 부를 나스 「아꼼」 _에이전트오피스/YYYY-MM/<지시번호>_<파일이름> 에도 둔다(DB 첨부는 10일 뒤 지워짐 · 나스는 영구).
//   나스 컨테이너 = /share-ao(rw 마운트) · 노트북 창구 등 폴더가 없으면 조용히 건너뜀 · 실패해도 답변은 막지 않는다(로그 한 줄)
const AO_ARCHIVE = process.env.AKM_AO_ARCHIVE || '/share-ao';
function archiveAttachments(list, id) {
    const out = [];
    try { if (!fs.statSync(AO_ARCHIVE).isDirectory()) return out; } catch (e) { return out; }
    const ym = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);   // KST 달
    for (const p of (Array.isArray(list) ? list : []).slice(0, 5)) {
        try {
            const dir = path.join(AO_ARCHIVE, ym); fs.mkdirSync(dir, { recursive: true });
            const base = String(path.basename(String(p))).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
            const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
            let dst = path.join(dir, id + '_' + base);
            for (let n = 2; fs.existsSync(dst) && n < 100; n++) dst = path.join(dir, id + '_' + stem + ' (' + n + ')' + ext);
            fs.copyFileSync(String(p), dst, fs.constants.COPYFILE_EXCL);
            out.push(dst);
        } catch (e) { console.error('나스 보관 실패(무시):', path.basename(String(p)), e.message); }
    }
    return out.length ? { ym, files: out } : null;
}
(async () => {
    const id = parseInt(process.argv[2], 10), file = process.argv[3];
    if (!id || !file) throw new Error('사용: respond.js <지시 id> <결과.json>');
    let j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const o = (await pool.query(`SELECT id, status, run_id, created_by_id, content, (payload IS NULL) AS no_payload FROM pending_orders WHERE id = $1 AND is_deleted = false`, [id])).rows[0];
    if (!o) throw new Error('없는 지시');
    if (!['처리중', '대기'].includes(o.status)) throw new Error(`'${o.status}' 상태라 결과를 올릴 수 없습니다(처리중만 가능)`); // '대기' = 처리 도중 서버 재시작으로 되돌려진 건
    let status, result, stepText, runStatus = 'done', uploadedIds = [], archived = null;   // #799 올린 첨부 id(결과를 못 올리면 숨김) · #922 나스 보관본
    if (j.kind === 'answer') {
        if (!j.answer) throw new Error('answer가 비었습니다');
        status = '완료';
        if (/^(\[검증469\]\s*)?\[최종발주 메모 읽기\]/.test(o.content || '')) j = memoReuse(id, j);
        const uploaded = await uploadAttachments(j.attachments, o.run_id); uploadedIds = uploaded.map(x => x.file_id);
        result = {
            type: 'desk_answer', title: clean(j.title || '', 80), answer: clean(j.answer, 20000),
            files: (Array.isArray(j.files) ? j.files.slice(0, 10).map(f => ({ label: clean(f.label, 60), url: clean(f.url, 500) })) : []).concat(uploaded),
            summary: clean(j.title || j.answer, 80),
        };
        if (uploaded.length && (archived = archiveAttachments(j.attachments, id)))
            result.answer = clean(result.answer.replace(/\s+$/, '') + `\n\n첨부는 10일 뒤 여기서 지워지고, 나스 폴더(직원 PC 의 아꼼 › _에이전트오피스 › ${archived.ym})에 보관돼 있어요`, 20000);
        // #518 최종발주 메모 읽기의 판정 결과(화면이 받아 가면 서버가 지운다) — 최종발주 요청에만, 400KB 이하
        if (j.data && typeof j.data === 'object' && /^(\[검증469\]\s*)?\[(?:최종발주 (?:메모 읽기|대화)|발주 메모 읽기)\]/.test(o.content || '') && JSON.stringify(j.data).length <= 400000
            && !(o.no_payload && /^\[발주 메모 읽기\]/.test(o.content || ''))) result.data = j.data;   // #850 발주 메모함도 · 화면이 이미 그만둔(손님 글 지운) 요청에 늦게 온 답은 data 버림
        stepText = '✅ 답변 완료';
    } else if (j.kind === 'question') {
        if (!j.question) throw new Error('question이 비었습니다');
        status = '질문';
        result = { type: 'clarify', question: clean(j.question, 1000), summary: '확인 필요', by: 'desk' };
        const plan = fast.planClean(j.plan);   // #598 B
        if (plan) result.plan = plan;
        stepText = '❓ 확인 질문';
    } else if (j.kind === 'ocr') {
        const items = (Array.isArray(j.items) ? j.items : [])
            .map(x => ({ name: clean(x.name, 200).trim(), qty: parseInt(x.qty, 10) }))
            .filter(x => x.name && Number.isFinite(x.qty) && x.qty > 0);
        if (!items.length) throw new Error('품목이 없습니다');
        if (j.date && !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) throw new Error('date 형식은 YYYY-MM-DD');
        status = '판독완료';
        result = { type: 'desk_ocr_read', partner: clean(j.partner || '', 40), items, date: j.date || null, box_total: items.reduce((s, x) => s + x.qty, 0) };
        stepText = `📷 이미지 판독 — ${items.length}품목 ${result.box_total}박스 (단가 대조는 서버)`;
        runStatus = 'running';
    } else if (j.kind === 'approval') {
        if (!j.summary || !j.action) throw new Error('action·summary가 필요합니다');
        status = '승인대기';
        result = { type: 'approval_request', action: clean(j.action, 20), summary: clean(j.summary, 300), impact: clean(j.impact || '', 1000), plan: clean(j.plan || '', 1000) };
        stepText = '🔐 대표 승인 요청';
        runStatus = 'running';
    } else if (j.kind === 'refuse') {
        status = '안내';
        result = { type: 'route', notice: clean(j.reason, 1000), summary: '창구에서 처리하지 않는 일' };
        stepText = '↩️ 대표 창으로 넘김';
    } else if (j.kind === 'error') {
        status = '오류';
        result = { type: 'error', error: clean(j.error, 1000) };
        stepText = '⚠️ 오류'; runStatus = 'error';
    } else throw new Error('kind를 알 수 없습니다: ' + j.kind);

    // #799 위에서 읽은 뒤 사람이 「채팅 종료」했으면(질문종결) 덮지 않는다 — 상태를 다시 조건으로
    const up = await pool.query(`UPDATE pending_orders SET status = $2, result = $3, processed_at = NOW() WHERE id = $1 AND status IN ('처리중', '대기')`, [id, status, JSON.stringify(result)]);
    if (!up.rowCount) {
        if (uploadedIds.length) await pool.query(`UPDATE report_files SET is_deleted = true WHERE id = ANY($1::int[])`, [uploadedIds]).catch(() => { });   // 고아 첨부 숨김(물리 삭제 X)
        if (archived) for (const f of archived.files) { try { fs.unlinkSync(f); } catch (e) { /* 이미 없음 */ } }   // #922 올리지 못한 답의 나스 보관본도 거둠
        throw new Error('그 사이 상태가 바뀌어(사람이 채팅 종료 등) 결과를 올리지 않았습니다');
    }
    await appendStep(o.run_id, runStatus === 'error' ? 'error' : 'report', stepText);
    if (o.run_id && runStatus !== 'running') {
        await pool.query(`UPDATE agent_runs SET status = $2, finished_at = NOW(), result = $3 WHERE id = $1`,
            [o.run_id, runStatus, JSON.stringify({
                summary: result.summary || result.error || stepText,
                lines: String(result.answer || result.notice || result.error || '').split(/\r?\n/).filter(Boolean).slice(0, 300),
                report: { type: result.type, question: o.content, answer: result.answer || result.notice || result.error || '' },
            })]);
    }
    // 종 알림: 완료·질문·안내·오류 → 요청자 / 승인대기 → 활성 관리자. 텔레그램 0
    // 시험 지시([검증469])는 알림을 만들지 않는다 — 시험 54건이 대표 화면을 뒤덮은 일이 있었다(2026-09-29)
    try {
        const isTest = String(o.content || '').startsWith('[검증469]') || Number(o.created_by_id) >= 990000;   // #638: 시험 번호 계정 지시도 시험으로(머리말이 달라도 실제 관리자에게 승인 알림이 가지 않게)
        if (isTest && process.env.DESK_TEST_NOTIFY !== '1') throw new Error('시험 지시라 알림 생략');
        // 검증 스크립트가 알림 기록을 확인할 때(DESK_TEST_NOTIFY=1)는 적되, 폰으로는 나가지 않게 「이미 보냄」으로 표시한다
        const pushed = isTest ? 'NOW()' : 'NULL';
        if (status === '승인대기') {
            const ad = await pool.query(`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL`);
            for (const u of ad.rows) {
                await pool.query(`INSERT INTO notifications (user_id, type, title, message, link, pushed_at) VALUES ($1, 'desk', $2, $3, $4, ${pushed})`,
                    [u.id, '🔐 클코 창구 — 승인 요청', result.summary, 'agent-office?o=' + id]);   // #576: 알림을 누르면 그 채팅으로
            }
        } else if (status !== '판독완료' && o.created_by_id) {
            const title = status === '질문' ? '❓ 클코가 확인을 요청했어요' : status === '오류' ? '⚠️ 클코 창구 — 처리하지 못했어요' : '✅ 클코가 답했어요';
            await pool.query(`INSERT INTO notifications (user_id, type, title, message, link, pushed_at) VALUES ($1, 'desk', $2, $3, $4, ${pushed})`,
                [o.created_by_id, title, clean(result.summary || result.question || result.notice || result.error || '', 120), 'agent-office?o=' + id]);
        }
    } catch (e) { console.error('알림 기록 실패(무시):', e.message); }
    await audit('desk_respond', id, { status, type: result.type });
    await heartbeat('idle');
    console.log(JSON.stringify({ ok: true, id, status, type: result.type }));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

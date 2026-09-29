// #469 결과 올리기 — 사용: node scripts/desk/respond.js <지시 id> <결과.json>
// 결과.json 형식(하나):
//   { "kind": "answer",   "answer": "답변 글", "title": "한 줄 제목(선택)", "files": [{"label","url"}](선택),
//                         "attachments": ["만든 파일 경로", ...](선택 — 엑셀·문서·그림을 DB에 올려 화면에서 내려받게 한다 · 파일당 10MB · 5개까지) }
//   { "kind": "question", "question": "되묻는 말" }
//   { "kind": "ocr",      "partner": "효돈농협 | 대성(시온) | 기타거래처 | 빈 문자열", "items": [{"name","qty"}], "date": "YYYY-MM-DD(선택)" }
//        → 서버가 단가표 대조·확인표를 만든다(금액 계산은 서버 몫 — 창구는 품목·수량만 읽는다)
//   { "kind": "approval", "action": "coupon|price|send|external", "summary": "무엇을", "impact": "영향·금액·대상", "plan": "승인되면 할 일" }
//   { "kind": "refuse",   "reason": "창구에서 하지 않는 일 — 대표 창으로 넘김" }
//   { "kind": "error",    "error": "사유" }
const fs = require('fs');
const { pool, appendStep, heartbeat, audit } = require('./_db');
const path = require('path');
const clean = (s, n) => String(s == null ? '' : s).slice(0, n);
const ATTACH_EXT = ['xlsx', 'csv', 'md', 'txt', 'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'];
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
(async () => {
    const id = parseInt(process.argv[2], 10), file = process.argv[3];
    if (!id || !file) throw new Error('사용: respond.js <지시 id> <결과.json>');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const o = (await pool.query(`SELECT id, status, run_id, created_by_id, content FROM pending_orders WHERE id = $1 AND is_deleted = false`, [id])).rows[0];
    if (!o) throw new Error('없는 지시');
    if (!['처리중', '대기'].includes(o.status)) throw new Error(`'${o.status}' 상태라 결과를 올릴 수 없습니다(처리중만 가능)`); // '대기' = 처리 도중 서버 재시작으로 되돌려진 건
    let status, result, stepText, runStatus = 'done';
    if (j.kind === 'answer') {
        if (!j.answer) throw new Error('answer가 비었습니다');
        status = '완료';
        const uploaded = await uploadAttachments(j.attachments, o.run_id);
        result = {
            type: 'desk_answer', title: clean(j.title || '', 80), answer: clean(j.answer, 20000),
            files: (Array.isArray(j.files) ? j.files.slice(0, 10).map(f => ({ label: clean(f.label, 60), url: clean(f.url, 500) })) : []).concat(uploaded),
            summary: clean(j.title || j.answer, 80),
        };
        stepText = '✅ 답변 완료';
    } else if (j.kind === 'question') {
        if (!j.question) throw new Error('question이 비었습니다');
        status = '질문';
        result = { type: 'clarify', question: clean(j.question, 1000), summary: '확인 필요', by: 'desk' };
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

    await pool.query(`UPDATE pending_orders SET status = $2, result = $3, processed_at = NOW() WHERE id = $1`, [id, status, JSON.stringify(result)]);
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
    try {
        if (status === '승인대기') {
            const ad = await pool.query(`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL`);
            for (const u of ad.rows) {
                await pool.query(`INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'desk', $2, $3, 'agent-office')`,
                    [u.id, '🔐 클코 창구 — 승인 요청', result.summary]);
            }
        } else if (status !== '판독완료' && o.created_by_id) {
            const title = status === '질문' ? '❓ 클코가 확인을 요청했어요' : status === '오류' ? '⚠️ 클코 창구 — 처리하지 못했어요' : '✅ 클코가 답했어요';
            await pool.query(`INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, 'desk', $2, $3, 'agent-office')`,
                [o.created_by_id, title, clean(result.summary || result.question || result.notice || result.error || '', 120)]);
        }
    } catch (e) { console.error('알림 기록 실패(무시):', e.message); }
    await audit('desk_respond', id, { status, type: result.type });
    await heartbeat('idle');
    console.log(JSON.stringify({ ok: true, id, status, type: result.type }));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

// #469 지시 받기 — 1건을 집어 '처리중'으로 바꾸고 내용·이미지·앞선 대화를 내준다.
// 사용: node scripts/desk/get.js <지시 id>
const fs = require('fs'), path = require('path');
const { pool, ROOT, heartbeat, step, audit } = require('./_db');
// #551: 기억해 둔 업무 기준(없거나 읽기 실패면 빈 목록 — 지시 받기는 막지 않는다). 최종발주 메모 읽기·대화처럼 규칙 문서가 따로 있는 일에도 함께 가지만 그 일의 규칙이 우선이다.
async function rememberList() { try { return await require('./remember').activeList(); } catch (_) { return []; } }
// #498: 대기 프로그램(launcher.js)이 창구를 부르기 전에 미리 받아 둘 수 있게 함수로도 내준다(CLI 동작은 종전과 같다)
async function claim(id) {
    if (!id) throw new Error('지시 id가 필요합니다');
    const c = await pool.query(
        `UPDATE pending_orders SET status = '처리중'
         WHERE id = $1 AND is_deleted = false AND status IN ('대기', '승인됨')
         RETURNING id, content, result, run_id, created_by, created_by_id, image_data, image_mime, reply_to, to_jsonb(pending_orders)->'payload' AS payload, to_jsonb(pending_orders)->>'file_name' AS file_name`, [id]);   // payload = #518(칸이 아직 없는 DB에서도 죽지 않게 to_jsonb 로 읽는다)
    if (!c.rows.length) return { ok: false, reason: '이미 처리 중이거나 없는 지시입니다' };
    const o = c.rows[0];
    const approved = o.result && o.result.type === 'approval_request' ? o.result : null; // 승인된 건의 원 요청
    let runId = o.run_id;
    if (!runId) {
        const maru = (await pool.query(`SELECT id FROM agents WHERE role = 'chief' AND is_deleted = false LIMIT 1`)).rows[0];
        const run = (await pool.query(
            `INSERT INTO agent_runs (agent_id, steps, is_test) VALUES ($1, $2, FALSE) RETURNING id`,
            [maru ? maru.id : null, JSON.stringify([step('order', `📥 지시 접수 — ${o.created_by || '직원'}`)])])).rows[0];
        runId = run.id;
        await pool.query(`UPDATE pending_orders SET run_id = $2 WHERE id = $1`, [id, runId]);
    }
    // 요청자 권한: 화면에 로그인한 계정 기준(지시 글에 적힌 자기소개는 근거가 아니다)
    let fromRole = 'unknown';
    if (o.created_by_id) {
        const u = (await pool.query(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [o.created_by_id])).rows[0];
        if (u) fromRole = u.role === 'admin' ? 'admin' : 'staff';
    }
    let imagePath = null, filePath = null;
    if (o.image_data) {
        const m = String(o.image_data).match(/^data:([^;]+);base64,(.+)$/s);
        if (m) {
            const ext = (/(png|jpe?g|webp|gif)/i.exec(o.image_mime || m[1]) || ['', 'png'])[1].replace('jpeg', 'jpg');
            // 창구 폴더 이름: ★에이전트오피스(9/29 변경)가 있으면 그쪽, 없으면 직원창구(옛 이름)
            const deskDir = fs.existsSync(path.join(ROOT, '★에이전트오피스')) ? '★에이전트오피스' : '직원창구';
            const dir = path.join(ROOT, deskDir, '받은파일');
            fs.mkdirSync(dir, { recursive: true });
            // #543: 파일 첨부(엑셀·CSV·PDF·텍스트)는 원래 이름·확장자 그대로 「번호_이름」으로 — 이미지는 종전대로 「번호.확장자」
            if (o.file_name) {
                const safe = String(o.file_name).replace(/[\\/:*?"<>|]/g, '_').slice(-120);
                filePath = path.join(dir, id + '_' + safe);
                fs.writeFileSync(filePath, Buffer.from(m[2], 'base64'));
            } else {
                imagePath = path.join(dir, `${id}.${ext}`);
                fs.writeFileSync(imagePath, Buffer.from(m[2], 'base64'));
            }
        }
    }
    const prev = (await pool.query(
        `SELECT id, content, status, result->>'type' AS type,
                LEFT(COALESCE(result->>'answer', result->>'notice', result->>'question', result->>'summary', ''), 300) AS said
         FROM pending_orders
         WHERE is_deleted = false AND id < $1 AND created_by IS NOT DISTINCT FROM $2 AND created_at > NOW() - interval '1 hour'
         ORDER BY id DESC LIMIT 5`, [id, o.created_by])).rows.reverse();
    // #477 되묻기 답·[이어서 지시]로 들어온 지시 = 앞 지시와 그 답을 통째로 넘긴다(1시간·300자 제한 없이)
    let followOf = null;
    if (o.reply_to) {
        const f = (await pool.query(
            `SELECT id, content, status, result->>'type' AS type, result->>'question' AS question, result->>'title' AS title,
                    LEFT(COALESCE(result->>'answer', result->>'text', result->>'notice', result->>'summary', result->>'error', ''), 4000) AS answer
             FROM pending_orders WHERE id = $1`, [o.reply_to])).rows[0];
        if (f) followOf = f;
    }
    // #518 최종발주 메모 읽기: 메모 묶음을 파일로 내준다(글이 길어 지시문에 싣지 않는다). 규칙 = ★에이전트오피스/최종발주_메모읽기.md
    let foMemo = null;
    if (o.payload && o.payload.type === 'fo_memo') {
        const deskDir2 = fs.existsSync(path.join(ROOT, '★에이전트오피스')) ? '★에이전트오피스' : '직원창구';
        const dir2 = path.join(ROOT, deskDir2, '받은파일'); fs.mkdirSync(dir2, { recursive: true });
        const p2 = path.join(dir2, `${id}_memo.json`);
        fs.writeFileSync(p2, JSON.stringify(o.payload, null, 1));
        foMemo = { payload_path: p2, count: (o.payload.items || []).length, rules: path.join(ROOT, deskDir2, '최종발주_메모읽기.md'),
            how: '이 지시는 최종발주 화면이 보낸 「손님 메모 읽기」입니다. rules 문서를 먼저 읽고, payload_path 의 메모를 한 건도 빠짐없이 판정해 결과를 {"kind":"answer","title":"메모 N건 읽음","answer":"한 줄 요약","data":{"items":[…]}} 꼴로 올립니다. 다른 일(조회·수정·발송)은 하지 않습니다. 끝나면 payload_path 파일을 지웁니다.' };
    }
    // #525 최종발주 대화: 직원이 최종발주 화면의 대화 칸에 말로 한 지시(주소·품목 이름·수량 바꾸기 · 제주 건 질문 등). 규칙 = ★에이전트오피스/최종발주_대화.md
    if (o.payload && o.payload.type === 'fo_chat') {
        const deskDir3 = fs.existsSync(path.join(ROOT, '★에이전트오피스')) ? '★에이전트오피스' : '직원창구';
        const dir3 = path.join(ROOT, deskDir3, '받은파일'); fs.mkdirSync(dir3, { recursive: true });
        const p3 = path.join(dir3, `${id}_chat.json`);
        fs.writeFileSync(p3, JSON.stringify(o.payload, null, 1));
        foMemo = { payload_path: p3, count: (o.payload.orders || []).length, rules: path.join(ROOT, deskDir3, '최종발주_대화.md'),
            how: '이 지시는 최종발주 화면의 대화 칸에서 직원이 말로 한 요청입니다. rules 문서를 먼저 읽고, payload_path 의 ask(요청 글)·orders(후보 주문)·catalog(품목 이름)·summary(화면이 센 사실)만 보고 결과를 {"kind":"answer","title":"최종발주 대화","answer":"한 줄","data":{"reply":"직원에게 할 말","actions":[…]}} 꼴로 올립니다. DB 조회·수정·발송은 하지 않습니다(화면이 적용합니다). 끝나면 payload_path 파일을 지웁니다.' };
    }
    await heartbeat('busy', id);
    await audit('desk_claim', id, { status: '처리중' });
    return {
        ok: true, id, run_id: runId, from: o.created_by, from_role: fromRole, content: o.content, image_path: imagePath, ...(filePath ? { file_path: filePath, file_name: o.file_name, file_hint: '첨부 파일입니다. 종류에 맞게 읽으세요 — xlsx·xls: 저장소 루트에서 node -e 로 require("exceljs")(xlsx) 또는 require("xlsx-js-style")(xls 포함 · 없을 수 있음)로 시트를 읽기 · csv·txt: Read · pdf: Read(쪽 지정). 손님 이름·번호가 들어 있을 수 있으니 답변에는 필요한 만큼만 쓰고, 처리 뒤 이 파일은 지웁니다.' } : {}), ...(foMemo ? { final_order_memo: foMemo } : {}),
        approved_request: approved ? { action: approved.action, summary: approved.summary, plan: approved.plan, approved_by: approved.approved_by } : null,
        remember: await rememberList(),   // #551: 관리자가 「기억해」라고 한 업무 기준 — 문서보다 최근 결정이므로 문서와 다르면 이쪽을 따른다
        recent_talk: prev,
        follow_of: followOf,
    };
}
module.exports = { claim };
if (require.main === module) {
    (async () => {
        const out = await claim(parseInt(process.argv[2], 10));
        console.log(JSON.stringify(out, null, 2));
        await pool.end();
    })().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
}

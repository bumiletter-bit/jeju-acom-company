// #674(대표 10/12 「급여명세서를 회사프로그램에 넣어 직원들이 보게 · 경리(관리자)가 직원마다 올리는 시스템」) 급여명세서 — 서버
//   · 파일(PDF)만 보관한다. 금액을 읽지도, 따로 저장하지도 않는다.
//   · 보는 사람 = 본인 + 관리자(대표·경리). 올리기 = 관리자 · 지우기 = 대표만(soft · 줄은 남는다).
//   · 같은 직원·같은 달은 한 장 — 다시 올리려면 replace:true(옛 줄은 deleted_at 만 찍고 남긴다).
//   · 올리면 그 직원에게 앱 알림 1건(link 'myinfo?pay=1' → 내 정보 > 급여명세서 · notify:false 면 안 보냄). 문자·카톡 없음.
//   · 기록 = audit_logs source 'payslip'(올림·교체·삭제 · 관리자가 남의 것을 열어 봄).
//   계약:
//     GET  /api/payslips/mine              본인 목록(월 내림차순)
//     GET  /api/payslips/:id/file          본인 또는 관리자 · PDF 바이트(본인이 열면 viewed_at)
//     POST /api/payslips                   관리자 · JSON { user_id, pay_month 'YYYY-MM', pay_date 'YYYY-MM-DD'|null, name, data(base64), title?, notify?, replace? }
//     GET  /api/payslips/admin?month=      관리자 · { users, items }(파일 바이트 없음)
//     DELETE /api/payslips/:id             대표만 · soft
//   요청 줄(창구 도구용 · 창구에 관리자 토큰을 두지 않는다): 표 payslip_queue 에 줄을 넣으면 서버가 20초마다 집어
//     ①그 지시(pending_orders.id = order_id)를 낸 계정이 지금도 관리자인지 ②그 지시에 PDF 첨부가 있는지 확인한 뒤 위 POST 와 같은 함수로 등록한다(올린 사람 = 그 관리자).
//     줄 = { order_id, user_id, pay_month, pay_date, file_name, data NULL(= 그 지시의 첨부를 그대로 · 권장), replace, notify }
//     data 를 실어 보내도 받지만 그 지시의 첨부와 바이트가 같을 때만 등록한다(다르면 fail — 다른 파일이 섞이는 길을 막는다 · 개인별 PDF 가 원칙이라 서버는 쪽을 나누지 않는다).
//     → status 'wait' → 'done'(payslip_id) | 'fail'(error) · 끝나면 data 는 비운다 · 끝난 줄은 30일 뒤 지운다.
const MAX_BYTES = 5 * 1024 * 1024;
const TEST_UID_MIN = 990000;   // 검증이 쓰는 시험 번호 계정(실제 계정은 한참 아래) — 관리자 격자에는 안 보인다
const MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/, DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isPdf = buf => !!buf && buf.length >= 8 && buf.slice(0, 5).toString('latin1') === '%PDF-';

module.exports = function mountPayslip(app, deps) {
    const { pool, authMiddleware, adminOnly, ownerOnly, writeAudit, createNotification } = deps;
    const audit = (action, id, changes, actor) => { try { return writeAudit({ action, targetType: 'payslip', targetId: id, changes, source: 'payslip', actor }); } catch (e) { return null; } };
    const ready = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS payslips (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            pay_month VARCHAR(7) NOT NULL,
            pay_date DATE,
            title VARCHAR(120) NOT NULL,
            file_name VARCHAR(200) NOT NULL,
            mime VARCHAR(60) NOT NULL DEFAULT 'application/pdf',
            data BYTEA NOT NULL,
            size_bytes INTEGER NOT NULL,
            uploaded_by INTEGER,
            uploaded_by_name VARCHAR(60),
            viewed_at TIMESTAMPTZ,
            deleted_at TIMESTAMPTZ,
            deleted_by INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS payslips_user_month_live ON payslips (user_id, pay_month) WHERE deleted_at IS NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS payslips_user ON payslips (user_id, pay_month DESC)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS payslip_queue (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            pay_month VARCHAR(7) NOT NULL,
            pay_date VARCHAR(10),
            file_name VARCHAR(200),
            data BYTEA,
            replace BOOLEAN NOT NULL DEFAULT false,
            notify BOOLEAN NOT NULL DEFAULT true,
            status VARCHAR(10) NOT NULL DEFAULT 'wait',
            error TEXT,
            payslip_id INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            done_at TIMESTAMPTZ
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS payslip_queue_wait ON payslip_queue (status, id)`);
    })().catch(e => { console.error('[급여명세서] 표 준비 실패:', e.message); throw e; });
    ready.catch(() => { });   // 준비 실패는 각 라우트가 500 으로 답한다(처리 안 된 거절로 서버가 죽지 않게)
    const COLS = `id, user_id, pay_month, to_char(pay_date, 'YYYY-MM-DD') AS pay_date, title, file_name, size_bytes AS size, viewed_at, created_at, uploaded_by_name`;
    const fail = (res, code, error, extra) => res.status(code).json(Object.assign({ ok: false, error }, extra || {}));
    const wrap = fn => async (req, res) => { try { await ready; await fn(req, res); } catch (e) { console.error('[급여명세서]', e.message); if (!res.headersSent) fail(res, 500, '급여명세서를 처리하지 못했어요. 잠시 뒤 다시 해 주세요.'); } };
    const titleOf = m => { const x = MONTH_RE.exec(m); return x ? `${x[1]}년 ${Number(x[2])}월 임금명세서` : '임금명세서'; };

    // 본인 목록
    app.get('/api/payslips/mine', authMiddleware, wrap(async (req, res) => {
        const r = await pool.query(`SELECT ${COLS} FROM payslips WHERE user_id = $1::int AND deleted_at IS NULL ORDER BY pay_month DESC, id DESC`, [req.user.id]);
        res.json({ ok: true, items: r.rows });
    }));

    // 관리자 격자 재료(파일 바이트 없음) — 시험 번호 계정 줄은 뺀다
    app.get('/api/payslips/admin', authMiddleware, adminOnly, wrap(async (req, res) => {
        const month = String(req.query.month || '');
        if (month && !MONTH_RE.test(month)) return fail(res, 400, '월은 2026-09 꼴로 적어 주세요.');
        const users = await pool.query(`SELECT id, name, position FROM users WHERE deleted_at IS NULL ORDER BY id`);
        const items = await pool.query(`SELECT ${COLS} FROM payslips WHERE deleted_at IS NULL AND user_id < $1::int ${month ? 'AND pay_month = $2::text' : ''} ORDER BY pay_month DESC, user_id`, month ? [TEST_UID_MIN, month] : [TEST_UID_MIN]);
        res.json({ ok: true, users: users.rows, items: items.rows });
    }));

    // 파일 — 본인 또는 관리자
    app.get('/api/payslips/:id/file', authMiddleware, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!(id > 0)) return fail(res, 400, '번호가 맞지 않아요.');
        const r = await pool.query(`SELECT id, user_id, pay_month, file_name, mime, data, viewed_at FROM payslips WHERE id = $1::int AND deleted_at IS NULL`, [id]);
        const row = r.rows[0];
        const mine = !!row && Number(row.user_id) === Number(req.user.id), admin = req.user.role === 'admin';
        if (!row || (!mine && !admin)) return fail(res, 404, '급여명세서를 찾지 못했어요.');   // 남의 것은 「있다」는 것도 알리지 않는다
        if (mine && !row.viewed_at) await pool.query(`UPDATE payslips SET viewed_at = NOW() WHERE id = $1::int AND viewed_at IS NULL`, [id]);
        if (!mine) await audit('payslip_view_admin', id, { user_id: row.user_id, pay_month: row.pay_month }, req.user);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="payslip-${row.pay_month}.pdf"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(row.data);
    }));

    // 등록 한 곳 — HTTP 올리기와 요청 줄이 같이 쓴다. 돌려주는 값 = { code, body }
    async function register({ uid, month, payDate, name, title, buf, replace, notify, actor }) {
        const bad = (code, error, extra) => ({ code, body: Object.assign({ ok: false, error }, extra || {}) });
        if (!(uid > 0)) return bad(400, '직원을 골라 주세요.');
        if (!MONTH_RE.test(month)) return bad(400, '귀속 월은 2026-09 꼴로 적어 주세요.');
        if (payDate && !DATE_RE.test(payDate)) return bad(400, '지급일은 2026-10-01 꼴로 적어 주세요.');
        if (!buf || !buf.length) return bad(400, '파일이 없어요.');
        if (buf.length > MAX_BYTES) return bad(400, '파일이 너무 커요(5MB 까지).');
        if (!isPdf(buf)) return bad(400, 'PDF 파일만 올릴 수 있어요.');
        name = String(name || '').replace(/[\\/\r\n\0]/g, ' ').trim().slice(0, 200) || `임금명세서_${month}.pdf`;
        title = String(title || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120) || titleOf(month);
        let who = null;
        if (uid < TEST_UID_MIN) {
            const u = await pool.query(`SELECT id, name FROM users WHERE id = $1::int AND deleted_at IS NULL`, [uid]);
            if (!u.rows[0]) return bad(400, '그 직원 계정을 찾지 못했어요(퇴사 처리된 계정일 수 있어요).');
            who = u.rows[0];
        }
        const cl = await pool.connect(); let id, replaced = null;
        try {
            await cl.query('BEGIN');
            const old = await cl.query(`SELECT id, file_name, size_bytes AS size, created_at, viewed_at FROM payslips WHERE user_id = $1::int AND pay_month = $2::text AND deleted_at IS NULL FOR UPDATE`, [uid, month]);
            if (old.rows[0] && replace !== true) { await cl.query('ROLLBACK'); return bad(409, '그 직원의 그 달 급여명세서가 이미 있어요. 바꾸려면 [교체]로 올려 주세요.', { exists: old.rows[0] }); }
            if (old.rows[0]) { replaced = old.rows[0].id; await cl.query(`UPDATE payslips SET deleted_at = NOW(), deleted_by = $2::int WHERE id = $1::int`, [replaced, actor.id]); }
            const ins = await cl.query(`INSERT INTO payslips (user_id, pay_month, pay_date, title, file_name, data, size_bytes, uploaded_by, uploaded_by_name)
                VALUES ($1::int, $2::text, $3::date, $4::text, $5::text, $6::bytea, $7::int, $8::int, $9::text) RETURNING id`, [uid, month, payDate || null, title, name, buf, buf.length, actor.id, String(actor.name || '').slice(0, 60)]);
            id = ins.rows[0].id;
            await cl.query('COMMIT');
        } catch (e) { try { await cl.query('ROLLBACK'); } catch (_) { }
            if (e && e.code === '23505') return bad(409, '방금 같은 달 급여명세서가 올라왔어요. 목록을 새로 고친 뒤 다시 해 주세요.');
            throw e;
        } finally { cl.release(); }
        await audit(replaced ? 'payslip_replace' : 'payslip_upload', id, { user_id: uid, pay_month: month, pay_date: payDate || null, file_name: name, size: buf.length, ...(replaced ? { replaced } : {}), ...(actor.via ? { via: actor.via } : {}) }, actor);
        let notified = false;
        if (notify !== false && typeof createNotification === 'function') {
            try { await createNotification(uid, 'payslip', replaced ? '급여명세서가 다시 올라왔어요' : '급여명세서가 올라왔어요', `${title} — 내 정보 > 급여명세서에서 확인해 주세요.`, 'myinfo?pay=1'); notified = true; } catch (e) { /* 알림 실패가 올리기를 막지 않는다 */ }
        }
        return { code: 200, body: { ok: true, id, replaced: !!replaced, notified, user_name: who ? who.name : null } };
    }

    // 올리기(관리자) — 같은 직원·같은 달이 있으면 409(replace:true 면 교체)
    app.post('/api/payslips', authMiddleware, adminOnly, wrap(async (req, res) => {
        const b = req.body || {};
        const b64 = String(b.data || '').replace(/^data:[^,]*,/, '');
        const r = await register({ uid: parseInt(b.user_id, 10), month: String(b.pay_month || '').trim(), payDate: b.pay_date == null || b.pay_date === '' ? null : String(b.pay_date).trim(), name: b.name, title: b.title,
            buf: b64 ? Buffer.from(b64, 'base64') : null, replace: b.replace === true, notify: b.notify !== false, actor: req.user });
        res.status(r.code).json(r.body);
    }));

    // 요청 줄 처리(창구 도구가 payslip_queue 에 넣은 줄) — 한 번에 20줄까지 · 한 줄 실패가 다른 줄을 막지 않는다
    let qBusy = false;
    async function tick() {
        if (qBusy) return 0; qBusy = true; let done = 0;
        try {
            await ready;
            const q = await pool.query(`SELECT id, order_id, user_id, pay_month, pay_date, file_name, data, replace, notify FROM payslip_queue WHERE status = 'wait' ORDER BY id LIMIT 20`);
            for (const row of q.rows) {
                const end = (status, error, pid) => pool.query(`UPDATE payslip_queue SET status = $2::text, error = $3::text, payslip_id = $4::int, data = NULL, done_at = NOW() WHERE id = $1::int AND status = 'wait'`, [row.id, status, error || null, pid || null]);
                try {
                    // ① 그 지시를 낸 계정이 지금도 관리자인가 ② 그 지시에 PDF 첨부가 있는가
                    const o = await pool.query(`SELECT p.id, p.created_by_id, p.file_name, p.image_data, u.name, u.role, u.position, u.deleted_at FROM pending_orders p LEFT JOIN users u ON u.id = p.created_by_id WHERE p.id = $1::int`, [row.order_id]);
                    const od = o.rows[0];
                    if (!od) { await end('fail', '그 지시를 찾지 못했어요.'); continue; }
                    if (!od.created_by_id || od.role !== 'admin' || od.deleted_at) { await end('fail', '급여명세서는 관리자(대표·경리) 계정이 낸 지시로만 올릴 수 있어요.'); continue; }
                    const m = od.image_data ? String(od.image_data).match(/^data:[^;,]*(?:;[^,]*)?,(.+)$/s) : null;
                    const att = od.image_data ? Buffer.from(m ? m[1] : String(od.image_data), 'base64') : null;
                    if (!isPdf(att)) { await end('fail', '그 지시에 PDF 첨부가 없어요.'); continue; }
                    if (row.data && row.data.length && !row.data.equals(att)) { await end('fail', '올리려는 파일이 그 지시의 첨부와 달라요. 개인별 PDF 를 지시에 붙여 다시 올려 주세요.'); continue; }   // 첨부와 같은 바이트만
                    const buf = att;
                    const r = await register({ uid: Number(row.user_id), month: String(row.pay_month || '').trim(), payDate: row.pay_date ? String(row.pay_date).trim() : null, name: row.file_name || od.file_name, buf, replace: row.replace === true, notify: row.notify !== false,
                        actor: { id: od.created_by_id, name: od.name, role: od.role, position: od.position, via: 'desk#' + row.order_id } });
                    if (r.body.ok) { await end('done', null, r.body.id); done++; } else await end('fail', r.body.error);
                } catch (e) { console.error('[급여명세서] 요청 줄 ' + row.id + ':', e.message); try { await end('fail', '서버에서 처리하지 못했어요.'); } catch (_) { } }
            }
            await pool.query(`DELETE FROM payslip_queue WHERE status <> 'wait' AND done_at < NOW() - INTERVAL '30 days'`);
        } catch (e) { console.error('[급여명세서] 요청 줄 틱:', e.message); }
        finally { qBusy = false; }
        return done;
    }
    const timer = setInterval(tick, 20 * 1000); if (timer && typeof timer.unref === 'function') timer.unref();

    // 지우기(대표만 · soft)
    app.delete('/api/payslips/:id', authMiddleware, ownerOnly, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!(id > 0)) return fail(res, 400, '번호가 맞지 않아요.');
        const r = await pool.query(`UPDATE payslips SET deleted_at = NOW(), deleted_by = $2::int WHERE id = $1::int AND deleted_at IS NULL RETURNING id, user_id, pay_month, file_name`, [id, req.user.id]);
        if (!r.rows[0]) return fail(res, 404, '급여명세서를 찾지 못했어요.');
        await audit('payslip_delete', id, { user_id: r.rows[0].user_id, pay_month: r.rows[0].pay_month, file_name: r.rows[0].file_name }, req.user);
        res.json({ ok: true });
    }));

    return { ready, tick, register, MAX_BYTES, TEST_UID_MIN };
};

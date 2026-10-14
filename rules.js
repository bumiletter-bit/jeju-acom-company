// #687(대표 10/14 「급여규정·인사규정 PDF 를 전 직원이 보게 · 내 정보 셋째 탭 「회사 규정」」) 회사 규정 — 서버
//   · 파일(PDF)만 보관한다. 같은 제목을 다시 올리면 새 판이 되고 옛 판은 「이전 판」으로 남는다(지우지 않음).
//   · 보는 사람 = 로그인한 전 직원(세무사 계정은 내 정보 메뉴가 없어 자연 제외). 올리기·지우기 = 관리자(대표·경리) · 지우기는 soft.
//   · 「확인했습니다」 버튼·직원별 확인 현황은 두지 않는다(대표 확정 10/14 — 직원 거부감). 열어 본 기록도 남기지 않는다.
//   · 올리면 전 직원에게 앱 알림 1건씩(type 'rules' · link 'myinfo?rules=1' → 내 정보 > 회사 규정 · notify:false 면 안 보냄). 문자·카톡 없음.
//   · 기록 = audit_logs source 'rules'(올림·삭제).
//   계약:
//     GET    /api/rules              전 직원 · { items:[{ id, title, version, effective_date, file_name, size, created_at, uploaded_by_name }] } (파일 바이트 없음 · 제목 → 올린 순 내림차순)
//     GET    /api/rules/:id/file     전 직원 · PDF 바이트(inline · ?dl=1 이면 attachment)
//     POST   /api/rules              관리자 · JSON { title, version?, effective_date 'YYYY-MM-DD'|null, name, data(base64), notify? }
//     DELETE /api/rules/:id          관리자 · soft
const MAX_BYTES = 5 * 1024 * 1024;
const TEST_UID_MIN = 990000;   // 검증이 쓰는 시험 번호 계정 — 알림은 실제 계정(그 아래)에게만
const DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isPdf = buf => !!buf && buf.length >= 8 && buf.slice(0, 5).toString('latin1') === '%PDF-';

module.exports = function mountRules(app, deps) {
    const { pool, authMiddleware, adminOnly, writeAudit, createNotification } = deps;
    const audit = (action, id, changes, actor) => { try { return writeAudit({ action, targetType: 'company_rule', targetId: id, changes, source: 'rules', actor }); } catch (e) { return null; } };
    const ready = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS company_rules (
            id SERIAL PRIMARY KEY,
            title VARCHAR(120) NOT NULL,
            version VARCHAR(60) NOT NULL DEFAULT '',
            effective_date DATE,
            file_name VARCHAR(200) NOT NULL,
            mime VARCHAR(60) NOT NULL DEFAULT 'application/pdf',
            data BYTEA NOT NULL,
            size_bytes INTEGER NOT NULL,
            uploaded_by INTEGER,
            uploaded_by_name VARCHAR(60),
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            deleted_by INTEGER
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS company_rules_live ON company_rules (title, uploaded_at DESC) WHERE deleted_at IS NULL`);
    })().catch(e => { console.error('[회사 규정] 표 준비 실패:', e.message); throw e; });
    ready.catch(() => { });
    const COLS = `id, title, version, to_char(effective_date, 'YYYY-MM-DD') AS effective_date, file_name, size_bytes AS size, uploaded_at AS created_at, uploaded_by_name`;
    const fail = (res, code, error, extra) => res.status(code).json(Object.assign({ ok: false, error }, extra || {}));
    const wrap = fn => async (req, res) => { try { await ready; await fn(req, res); } catch (e) { console.error('[회사 규정]', e.message); if (!res.headersSent) fail(res, 500, '회사 규정을 처리하지 못했어요. 잠시 뒤 다시 해 주세요.'); } };

    // 검증이 올린 시험 문서(올린 사람 = 시험 번호 계정)는 실제 직원에게 안 보이고, 시험 계정에는 시험 문서만 보인다(#638 과 같은 규칙 · 실DB 를 쓰는 검증이 라이브 화면에 새지 않게)
    const sideSql = viewerId => ` AND (COALESCE(uploaded_by, 0) >= ${TEST_UID_MIN}) = ${Number(viewerId) >= TEST_UID_MIN ? 'TRUE' : 'FALSE'}`;

    // 목록(전 직원 · 바이트 없음)
    app.get('/api/rules', authMiddleware, wrap(async (req, res) => {
        const r = await pool.query(`SELECT ${COLS} FROM company_rules WHERE deleted_at IS NULL${sideSql(req.user.id)} ORDER BY title, uploaded_at DESC, id DESC`);
        res.json({ ok: true, items: r.rows });
    }));

    // 파일(전 직원)
    app.get('/api/rules/:id/file', authMiddleware, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!(id > 0)) return fail(res, 400, '번호가 맞지 않아요.');
        const r = await pool.query(`SELECT id, title, version, file_name, mime, data FROM company_rules WHERE id = $1::int AND deleted_at IS NULL${sideSql(req.user.id)}`, [id]);
        const row = r.rows[0]; if (!row) return fail(res, 404, '그 규정 문서를 찾지 못했어요.');
        const dl = String(req.query.dl || '') === '1';
        const base = String(row.title + (row.version ? '_' + row.version : '')).replace(/[\\/:*?"<>|\r\n\0]/g, ' ').trim().slice(0, 80) || 'rules';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="rules-${row.id}.pdf"; filename*=UTF-8''${encodeURIComponent(base + '.pdf')}`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(row.data);
    }));

    // 등록 한 곳 — 돌려주는 값 = { code, body }
    async function register({ title, version, effectiveDate, name, buf, notify, actor }) {
        const bad = (code, error, extra) => ({ code, body: Object.assign({ ok: false, error }, extra || {}) });
        title = String(title || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120);
        version = String(version || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
        if (!title) return bad(400, '규정 제목을 적어 주세요(예: 급여규정).');
        if (effectiveDate && !DATE_RE.test(effectiveDate)) return bad(400, '시행일은 2026-11-01 꼴로 적어 주세요.');
        if (!buf || !buf.length) return bad(400, '파일이 없어요.');
        if (buf.length > MAX_BYTES) return bad(400, '파일이 너무 커요(5MB 까지).');
        if (!isPdf(buf)) return bad(400, 'PDF 파일만 올릴 수 있어요.');
        name = String(name || '').replace(/[\\/\r\n\0]/g, ' ').trim().slice(0, 200) || `${title}.pdf`;
        const ins = await pool.query(`INSERT INTO company_rules (title, version, effective_date, file_name, data, size_bytes, uploaded_by, uploaded_by_name)
            VALUES ($1::text, $2::text, $3::date, $4::text, $5::bytea, $6::int, $7::int, $8::text) RETURNING id`, [title, version, effectiveDate || null, name, buf, buf.length, actor.id, String(actor.name || '').slice(0, 60)]);
        const id = ins.rows[0].id;
        const prev = await pool.query(`SELECT count(*)::int AS n FROM company_rules WHERE title = $1::text AND deleted_at IS NULL AND id <> $2::int`, [title, id]);
        await audit('rules_upload', id, { title, version, effective_date: effectiveDate || null, file_name: name, size: buf.length, prev_versions: prev.rows[0].n }, actor);
        // 알림 = 전 직원(퇴사 아님 · 세무사 아님 · 실제 계정) — 알림 실패가 올리기를 막지 않는다
        let notified = 0;
        if (notify !== false && typeof createNotification === 'function') {
            try {
                const us = await pool.query(`SELECT id FROM users WHERE deleted_at IS NULL AND COALESCE(role, '') <> 'accountant' AND id < $1::int ORDER BY id`, [TEST_UID_MIN]);
                const msg = `${title}${version ? ' · ' + version : ''}${effectiveDate ? ' · 시행 ' + effectiveDate : ''} — 내 정보 > 회사 규정에서 볼 수 있어요.`;
                for (const u of us.rows) { try { await createNotification(u.id, 'rules', prev.rows[0].n ? '회사 규정이 새 판으로 올라왔어요' : '새 회사 규정이 올라왔어요', msg, 'myinfo?rules=1'); notified++; } catch (e) { /* 한 명 실패가 다른 사람을 막지 않는다 */ } }
            } catch (e) { console.error('[회사 규정] 알림 실패:', e.message); }
        }
        return { code: 200, body: { ok: true, id, prev_versions: prev.rows[0].n, notified } };
    }

    // 올리기(관리자)
    app.post('/api/rules', authMiddleware, adminOnly, wrap(async (req, res) => {
        const b = req.body || {};
        const b64 = String(b.data || '').replace(/^data:[^,]*,/, '');
        const r = await register({ title: b.title, version: b.version, effectiveDate: b.effective_date == null || b.effective_date === '' ? null : String(b.effective_date).trim(), name: b.name,
            buf: b64 ? Buffer.from(b64, 'base64') : null, notify: b.notify !== false, actor: req.user });
        res.status(r.code).json(r.body);
    }));

    // 지우기(관리자 · soft)
    app.delete('/api/rules/:id', authMiddleware, adminOnly, wrap(async (req, res) => {
        const id = parseInt(req.params.id, 10); if (!(id > 0)) return fail(res, 400, '번호가 맞지 않아요.');
        const r = await pool.query(`UPDATE company_rules SET deleted_at = NOW(), deleted_by = $2::int WHERE id = $1::int AND deleted_at IS NULL${sideSql(req.user.id)} RETURNING id, title, version, file_name`, [id, req.user.id]);
        if (!r.rows[0]) return fail(res, 404, '그 규정 문서를 찾지 못했어요.');
        await audit('rules_delete', id, { title: r.rows[0].title, version: r.rows[0].version, file_name: r.rows[0].file_name }, req.user);
        res.json({ ok: true });
    }));

    return { ready, register, MAX_BYTES, TEST_UID_MIN };
};

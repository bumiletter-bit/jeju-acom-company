// #792 메일 러너 시간 제한 검증 — 가짜 IMAP 이 응답을 안 줄 때 그 건만 실패 · 다음 요청은 처리 · busy 안전장치 · 보내기 시간 초과 = 「보냈는지 모름」(실DB·실메일 0)
const NM = require('../naver-mail.js');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅ ' + name); } else { failN++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 설정 표 흉내(러너가 쓰는 SQL 꼴만)
function fakePool(opts) {
    const cfg = new Map(); opts = opts || {};
    return {
        cfg,
        query: async (sql, args) => {
            if (opts.hangGrab && /DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(sql) && opts.hangGrab()) return new Promise(() => { });
            if (/^DELETE FROM agent_office_config WHERE key = ANY/.test(sql) || /LIKE 'mail/.test(sql)) return { rows: [] };
            if (/DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(sql)) { const k = args[0]; if (!cfg.has(k)) return { rows: [] }; const v = cfg.get(k); cfg.delete(k); return { rows: [{ value: v, updated_at: new Date() }] }; }
            if (/INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(sql)) { if (opts.slowWrite) await new Promise(r => setTimeout(r, opts.slowWrite)); cfg.set(args[0], JSON.parse(args[1])); return { rows: [] }; }
            if (/FROM pending_orders o/.test(sql)) return { rows: [{ id: args[0], created_by: '시험', role: 'admin', name: '시험 대표' }] };
            if (/mail_send_count/.test(sql) && /RETURNING value/.test(sql)) { opts.reserved = (opts.reserved || 0) + 1; return { rows: [{ value: { day: 'x', n: opts.reserved } }] }; }
            if (/mail_send_count/.test(sql)) { opts.unreserved = (opts.unreserved || 0) + 1; return { rows: [] }; }
            return { rows: [] };
        },
    };
}
// 가짜 IMAP: mode = hang(LIST·FETCH 응답 없음 · destroy 때만 풀림) | err(바로 오류)
function fakeImapOpen(state) {
    return async () => {
        state.opened++;
        if (state.mode === 'err') throw new Error('가짜 접속 오류');
        const waiters = [];
        const hang = () => new Promise((res, rej) => waiters.push(rej));
        return {
            login: async () => { },
            list: hang, examine: hang, select: hang, fetch: hang, capability: hang, searchParts: hang, fetchItems: hang, status: hang,
            close: async () => { state.closed++; },
            destroy: () => { state.destroyed++; while (waiters.length) waiters.shift()(new Error('IMAP 시간 초과(강제 종료)')); },
        };
    };
}

(async () => {
    console.log('① 응답 없는 IMAP — 읽기 요청 1건만 실패 · busy 풀림 · 다음 요청은 처리');
    {
        const st = { mode: 'hang', opened: 0, closed: 0, destroyed: 0 }, audits = [];
        const pool = fakePool();
        const RN = NM.mountMailRunner({ pool, writeAudit: async (x) => { audits.push(x); }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: fakeImapOpen(st), noTimers: true, opLimits: { read: 300, search: 300 } });
        pool.cfg.set('mail_read_request', { id: 'r1', uid: 64910, folder: 'INBOX' });
        const t0 = Date.now(); await RN.tick(); const took = Date.now() - t0;
        const r = pool.cfg.get('mail_read_result');
        ok(r && r.ok === false && r.id === 'r1' && /시간 초과/.test(r.error) && /다시 시도/.test(r.error), '읽기 = 실패 결과 「메일 서버 응답이 늦어요(시간 초과) — 잠시 뒤 다시」', r);
        ok(took < 2000, '틱이 시간 제한(0.3초) 근처에서 끝남 · ' + took + 'ms');
        ok(st.destroyed >= 1, '소켓 강제 종료(destroy) 호출', st);
        ok(audits.some(a => a.action === 'mail_timeout' && a.changes.op === 'read'), 'audit mail_timeout(op read)');
        await sleep(50);
        ok(pool.cfg.get('mail_read_result').ok === false, '늦게 풀린 본문이 결과 줄을 덮지 않음');
        // 다음 요청(접속 오류 모드) — 붙잡혀 있지 않고 바로 처리되는지
        st.mode = 'err';
        pool.cfg.set('mail_read_request', { id: 'r2', uid: 1, folder: 'INBOX' });
        await RN.tick();
        const r2 = pool.cfg.get('mail_read_result');
        ok(r2 && r2.id === 'r2' && r2.ok === false && /가짜 접속 오류/.test(r2.error), '다음 요청 r2 = 바로 처리됨(오류 결과 · 요청 줄 비움)', r2);
        ok(!pool.cfg.has('mail_read_request'), '요청 줄이 남지 않음');
    }

    console.log('\n② 보내기 시간 초과 = 「보냈는지 모름」 · 다시 안 보냄 · 오늘 수 되돌리지 않음');
    {
        const st = { mode: 'hang', opened: 0, closed: 0, destroyed: 0 }, audits = [];
        const popts = {}; const pool = fakePool(popts);
        let smtpCalls = 0; let releaseSmtp;
        const smtpSend = () => { smtpCalls++; return new Promise(res => { releaseSmtp = res; }); };   // SMTP 가 끝나지 않음
        const RN = NM.mountMailRunner({ pool, writeAudit: async (x) => { audits.push(x); }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: fakeImapOpen(st), smtpSend, noTimers: true, opLimits: { send: 300 } });
        pool.cfg.set('mail_draft_dddd0001', { order_id: 77, at: Date.now(), to: ['a@b.com'], subject: '시험', text: '본문입니다 시험', attach_file_ids: [] });
        pool.cfg.set('mail_send_request', { id: 's1', order_id: 77, draft_id: 'dddd0001' });
        await RN.tick();
        const r = pool.cfg.get('mail_send_result');
        ok(r && r.ok === false && /보냈는지 모름/.test(r.error) && /보낸메일함/.test(r.error), '결과 = 「🔴 보냈는지 모름 · 보낸메일함을 먼저 확인」', r);
        ok(smtpCalls === 1, 'SMTP 는 한 번만 시도(자동 재전송 0)', smtpCalls);
        ok(!popts.unreserved, '오늘 보낸 수를 되돌리지 않음(나갔을 수 있어)', popts);
        ok(!pool.cfg.has('mail_draft_dddd0001'), '초안은 이미 집어 감 = 같은 초안으로 다시 보낼 수 없음');
        if (releaseSmtp) releaseSmtp({ ok: true }); await sleep(30);
        ok(/보냈는지 모름/.test(pool.cfg.get('mail_send_result').error), '늦게 끝난 SMTP 가 결과 줄을 덮지 않음');
        pool.cfg.set('mail_send_request', { id: 's2', order_id: 77, draft_id: 'dddd0001' });
        await RN.tick();
        ok(smtpCalls === 1 && /초안이 없어요/.test(pool.cfg.get('mail_send_result').error), '같은 초안 다시 보내기 = 「초안이 없어요」(두 번 발송 0)', pool.cfg.get('mail_send_result'));
    }

    console.log('\n③ 답장 원문 찾기에서 시간 초과 = SMTP 를 시작하지 않음');
    {
        const st = { mode: 'hang', opened: 0, closed: 0, destroyed: 0 };
        const pool = fakePool();
        let smtpCalls = 0;
        const RN = NM.mountMailRunner({ pool, writeAudit: async () => { }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: fakeImapOpen(st), smtpSend: async () => { smtpCalls++; return { ok: true }; }, noTimers: true, opLimits: { send: 300 } });
        pool.cfg.set('mail_draft_dddd0002', { order_id: 78, at: Date.now(), to: ['a@b.com'], subject: '답장', text: '본문입니다 답장', reply_to_uid: 5, folder: 'INBOX', attach_file_ids: [] });
        pool.cfg.set('mail_send_request', { id: 's3', order_id: 78, draft_id: 'dddd0002' });
        await RN.tick(); await sleep(50);
        ok(smtpCalls === 0, 'IMAP 이 멈춘 채 시간 초과 → 소켓 닫힘 → SMTP 시도 0', smtpCalls);
    }

    console.log('\n④ busy 안전장치 — DB 가 응답 없이 멈춰도 일정 시간 뒤 다음 틱이 이어서 처리');
    {
        let hangOnce = true;
        const pool = fakePool({ hangGrab: () => { if (hangOnce) { hangOnce = false; return true; } return false; } });
        const st = { mode: 'err', opened: 0, closed: 0, destroyed: 0 };
        const RN = NM.mountMailRunner({ pool, writeAudit: async () => { }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: fakeImapOpen(st), noTimers: true, busyMaxMs: 200 });
        const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' '));
        RN.tick();   // 첫 틱은 요청 줄 집기에서 영원히 멈춤(끝나기를 기다리지 않음)
        await sleep(20);
        pool.cfg.set('mail_read_request', { id: 'w1', uid: 1, folder: 'INBOX' });
        await RN.tick();   // 아직 200ms 안 = 건너뜀
        ok(pool.cfg.has('mail_read_request'), '200ms 안에는 기다림(요청 줄 그대로)');
        await sleep(250);
        await RN.tick();   // 안전장치가 busy 를 풀고 처리
        console.error = ce;
        const r = pool.cfg.get('mail_read_result');
        ok(!pool.cfg.has('mail_read_request') && r && r.id === 'w1', '200ms 넘으면 안전장치가 풀고 w1 처리', r);
        ok(errs.some(x => /강제로 풀어요/.test(x)), '서버 로그 「앞 작업이 n초째 안 끝나 강제로 풀어요」', errs);
    }

    console.log('\n⑤ 경계 경합 — 본문 결과를 쓰는 중에 시간 제한이 와도 「시간 초과」가 덮지 않음');
    {
        const st = { mode: 'err', opened: 0, closed: 0, destroyed: 0 }, audits = [];
        const pool = fakePool({ slowWrite: 500 });   // 결과 줄 쓰기가 0.5초 걸림 · 시간 제한 0.3초
        const RN = NM.mountMailRunner({ pool, writeAudit: async (x) => { audits.push(x); }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: fakeImapOpen(st), noTimers: true, opLimits: { read: 300 } });
        pool.cfg.set('mail_read_request', { id: 'x1', uid: 1, folder: 'INBOX' });
        await RN.tick(); await sleep(700);
        const r = pool.cfg.get('mail_read_result');
        ok(r && r.id === 'x1' && /가짜 접속 오류/.test(r.error) && !/시간 초과/.test(r.error), '본문 결과(오류) 그대로 · 시간 초과 글이 덮지 않음', r);
        ok(audits.some(a => a.action === 'mail_timeout' && a.changes.result_written === true), 'audit mail_timeout 에 result_written true');
    }

    console.log('\n결과 ' + pass + '/' + (pass + failN));
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

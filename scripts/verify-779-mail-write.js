// #779 검증 — 메일 보내기 · 폴더 이동 · 휴지통(naver-mail.js · 창구 scripts/desk/mail-find.js) · 가짜 IMAP·가짜 SMTP 소켓으로만 · 실발송·실이동·실DB 0
//   권한(휴지통만 관리자 · 쓰기는 지시 번호 필수) · UID MOVE 만(EXPUNGE·STORE·COPY 0) · MOVE 없으면 멈춤 · 초안 없이 보내기 거절 · 초안 한 번·30분·같은 지시
//   하루 30통 · 한 통 10명 · 주소 꼴 · 첨부(report_files) · 답장 머리말 · 비밀값 가림 · 기록(누가 시켰는지)
//   실행: node scripts/verify-779-mail-write.js
'use strict';
const path = require('path'), { PassThrough } = require('stream');
const NM = require(path.join(__dirname, '..', 'naver-mail.js'));
const MF = require('./desk/mail-find.js');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };

const enc7 = (x) => { const u = Buffer.from(x, 'utf16le'); const be = Buffer.alloc(u.length); for (let i = 0; i < u.length; i += 2) { be[i] = u[i + 1]; be[i + 1] = u[i]; } return '&' + be.toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-'; };
const MINE = enc7('거래처');
// ── 가짜 IMAP(이동용) ─────────────────────────────────
function fakeImap(opts) {
    opts = opts || {};
    const box = { INBOX: [{ uid: 11, from: '농협 <nh@nh.com>', subject: '정산 안내', date: 'Mon, 19 Oct 2026 09:00:00 +0900', mid: 'orig-11@nh.com', refs: '<a@x>' }, { uid: 12, from: '광고 <ad@x.com>', subject: '할인 알림', date: 'Mon, 19 Oct 2026 10:00:00 +0900', mid: 'ad-12@x.com' }],
        [MINE]: [], 'Deleted Messages': [], Junk: [] };
    const LIST = [['\\HasNoChildren', 'INBOX'], ['\\HasNoChildren', MINE], ['\\HasNoChildren \\Trash', 'Deleted Messages'], ['\\HasNoChildren \\Junk', 'Junk']];
    const cmds = []; let cur = null;
    const connect = () => {
        const toClient = new PassThrough(), sock = new PassThrough(); let inbuf = '';
        const say = (s) => setImmediate(() => toClient.emit('data', Buffer.from(s)));
        sock.write = (d) => {
            inbuf += Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
            let i;
            while ((i = inbuf.indexOf('\r\n')) >= 0) {
                const full = inbuf.slice(0, i); inbuf = inbuf.slice(i + 2);
                const sp = full.indexOf(' '), tag = full.slice(0, sp), line = full.slice(sp + 1);
                cmds.push(line.replace(/^LOGIN .*/, 'LOGIN ***'));
                let m;
                if (/^LOGIN /.test(line)) say(`${tag} OK\r\n`);
                else if (line === 'CAPABILITY') say(`* CAPABILITY IMAP4rev1 UIDPLUS ${opts.noMove ? '' : 'MOVE '}IDLE\r\n${tag} OK\r\n`);
                else if (/^LIST "" "\*"$/.test(line)) say(LIST.map(([f, n]) => `* LIST (${f}) "/" "${n}"\r\n`).join('') + `${tag} OK\r\n`);
                else if ((m = /^(EXAMINE|SELECT) "((?:[^"\\]|\\.)*)"$/.exec(line))) { cur = m[2]; say(box[cur] ? `* ${box[cur].length} EXISTS\r\n${tag} OK [${m[1] === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY'}]\r\n` : `${tag} NO\r\n`); cur = box[cur] ? cur : null; if (m[1] === 'SELECT') cmds.selectedRW = cur; else cmds.selectedRW = null; }
                else if ((m = /^UID SEARCH UID ([\d,]+)$/.exec(line))) { const want = m[1].split(',').map(Number); say(`* SEARCH ${(box[cur] || []).filter(x => want.includes(x.uid)).map(x => x.uid).join(' ')}\r\n${tag} OK\r\n`); }
                else if ((m = /^UID FETCH (\d+) \(BODY\.PEEK\[HEADER\.FIELDS \((FROM SUBJECT DATE|MESSAGE-ID REFERENCES SUBJECT)\)\]\)$/.exec(line))) {
                    const x = (box[cur] || []).find(y => y.uid === +m[1]);
                    if (!x) say(`${tag} OK\r\n`);
                    else { const h = Buffer.from(m[2].startsWith('FROM') ? `From: ${x.from}\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n\r\n` : `Message-ID: <${x.mid}>\r\n${x.refs ? 'References: ' + x.refs + '\r\n' : ''}Subject: ${x.subject}\r\n\r\n`, 'utf8'); say(`* 1 FETCH (UID ${x.uid} BODY[HEADER.FIELDS (X)] {${h.length}}\r\n` + h.toString('utf8') + `)\r\n${tag} OK\r\n`); }
                }
                else if ((m = /^UID MOVE ([\d,]+) "((?:[^"\\]|\\.)*)"$/.exec(line))) {
                    if (cmds.selectedRW !== cur) { say(`${tag} NO not selected read-write\r\n`); continue; }
                    const want = m[1].split(',').map(Number), dst = m[2];
                    if (!box[dst]) { say(`${tag} NO no box\r\n`); continue; }
                    const mv = box[cur].filter(x => want.includes(x.uid)); box[cur] = box[cur].filter(x => !want.includes(x.uid)); box[dst].push(...mv.map((x, k) => ({ ...x, uid: 500 + k })));
                    say(`* OK [COPYUID 1 ${m[1]} 500] moved\r\n${tag} OK MOVE\r\n`);
                }
                else if (line === 'LOGOUT') say(`* BYE\r\n${tag} OK\r\n`);
                else say(`${tag} BAD\r\n`);
            }
            return true;
        };
        sock.on = (ev, fn) => { if (ev === 'data') toClient.on('data', fn); return sock; };
        sock.end = () => { }; sock.destroy = () => { };
        say('* OK ready\r\n');
        return sock;
    };
    return { box, cmds, imapOpenF: (o) => NM.imapOpen({ ...o, connect, timeoutMs: 5000 }) };
}
// ── 가짜 SMTP ─────────────────────────────────────────
function fakeSmtp(opts) {
    opts = opts || {};
    const st = { cmds: [], data: null, sends: 0 };
    const connect = () => {
        const toClient = new PassThrough(), sock = new PassThrough(); let inbuf = '', inData = false, step = 0;
        const say = (s) => setImmediate(() => toClient.emit('data', Buffer.from(s)));
        sock.write = (d) => {
            inbuf += Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
            if (inData) { const e = inbuf.indexOf('\r\n.\r\n'); if (e < 0) return true; st.data = inbuf.slice(0, e); inbuf = inbuf.slice(e + 5); inData = false; st.sends++; if (opts.dropAfterData) { setImmediate(() => toClient.emit('close')); return true; } say('250 2.0.0 queued\r\n'); }
            let i;
            while (!inData && (i = inbuf.indexOf('\r\n')) >= 0) {
                const ln = inbuf.slice(0, i); inbuf = inbuf.slice(i + 2); step++;
                st.cmds.push(step === 3 || step === 4 ? '(인증 줄)' : ln);
                if (/^EHLO /.test(ln)) say('250-smtp.naver.com\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
                else if (ln === 'AUTH LOGIN') say('334 VXNlcm5hbWU6\r\n');
                else if (step === 3) say('334 UGFzc3dvcmQ6\r\n');
                else if (step === 4) say(opts.authFail ? '535 5.7.8 auth failed for u@naver.com with s3cret\r\n' : '235 2.7.0 ok\r\n');
                else if (/^MAIL FROM:/.test(ln)) say('250 ok\r\n');
                else if (/^RCPT TO:/.test(ln)) say('250 ok\r\n');
                else if (ln === 'DATA') { say('354 go\r\n'); inData = true; if (inbuf.length) sock.write(''); }
                else if (ln === 'QUIT') say('221 bye\r\n');
                else say('500 ?\r\n');
            }
            return true;
        };
        sock.on = (ev, fn) => { if (ev === 'data' || ev === 'close') toClient.on(ev, fn); return sock; };
        sock.end = () => { }; sock.destroy = () => { };
        say('220 smtp.naver.com ESMTP\r\n');
        return sock;
    };
    st.smtpSendF = (o) => NM.smtpSend({ ...o, connect, timeoutMs: 5000 });
    return st;
}
// ── 가짜 pool(설정 표 · 지시·계정 · report_files · audit 수) ──
function fakePool() {
    const cfg = new Map(), files = [{ id: 7, filename: '정산서.pdf', data: Buffer.from('%PDF-1.4 가짜'), size_bytes: 15 }], st = { sentToday: 0, sqls: [] };
    const orders = { 1: { created_by: '전승범', role: 'admin', name: '전승범', status: '처리중', age_h: 1 }, 2: { created_by: '조가영', role: 'user', name: '조가영', status: '처리중', age_h: 1 },
        3: { created_by: '전승범', role: 'admin', name: '전승범', status: '완료', age_h: 1 }, 4: { created_by: '전승범', role: 'admin', name: '전승범', status: '처리중', age_h: 30 } };
    const pool = { async query(sql, p = []) {
        st.sqls.push(sql);
        if (/key LIKE 'mail\\_draft\\_%'/.test(sql)) return { rows: [] };
        if (/WHERE key = ANY\(\$1\) AND updated_at </.test(sql)) return { rows: [] };
        if (/DELETE FROM agent_office_config WHERE key = \$1 RETURNING value, updated_at/.test(sql)) { const had = cfg.has(p[0]), v = cfg.get(p[0]); cfg.delete(p[0]); return { rows: had ? [{ value: v, updated_at: new Date() }] : [] }; }
        if (/DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(sql)) { const had = cfg.has(p[0]), v = cfg.get(p[0]); cfg.delete(p[0]); return { rows: had ? [{ value: v }] : [] }; }
        if (/DELETE FROM agent_office_config WHERE key = \$1/.test(sql)) { cfg.delete(p[0]); return { rows: [] }; }
        if (/SELECT 1 FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{}] : [] };
        if (/SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{ value: cfg.get(p[0]) }] : [] };
        if (/INSERT INTO agent_office_config/.test(sql) && !/mail_send_count/.test(sql)) { cfg.set(p[0], JSON.parse(p[1])); if (pool.onInsert) await pool.onInsert(p[0]); return { rows: [] }; }
        if (/FROM pending_orders o LEFT JOIN users u/.test(sql)) { const o = orders[p[0]]; const okSql = /o\.status = '처리중' AND o\.created_at > NOW\(\) - interval '24 hours'/.test(sql); return { rows: o && okSql && o.status === '처리중' && o.age_h < 24 ? [{ id: p[0], ...o }] : [] }; }
        if (/VALUES \('mail_send_count'/.test(sql)) { const v = cfg.get('mail_send_count'); const nv = v && v.day === p[0] ? { day: p[0], n: (v.n || 0) + 1 } : { day: p[0], n: 1 }; cfg.set('mail_send_count', nv); return { rows: [{ value: nv }] }; }
        if (/UPDATE agent_office_config SET value = jsonb_build_object\('day'/.test(sql)) { const v = cfg.get('mail_send_count'); if (v && v.day === p[0]) cfg.set('mail_send_count', { day: p[0], n: Math.max((v.n || 1) - 1, 0) }); return { rows: [] }; }
        if (/FROM pending_orders WHERE id = \$1/.test(sql)) { const o = orders[p[0]]; return { rows: o ? [{ id: p[0], created_by: o.created_by }] : [] }; }
        if (/SELECT id, filename, data, size_bytes FROM report_files WHERE id = ANY/.test(sql)) return { rows: files.filter(f => p[0].includes(f.id)) };
        if (/SELECT id, filename, size_bytes FROM report_files WHERE id = ANY/.test(sql)) return { rows: files.filter(f => p[0].includes(f.id)).map(f => ({ id: f.id, filename: f.filename, size_bytes: f.size_bytes })) };
        if (/INSERT INTO report_files/.test(sql)) { const id = 100 + files.length; files.push({ id, filename: p[0], data: p[1], size_bytes: p[2] }); return { rows: [{ id }] }; }
        throw new Error('모르는 SQL ' + sql.slice(0, 90));
    } };
    return { pool, cfg, files, st, orders };
}
const NO_DESTROY = (c) => !/\b(EXPUNGE|STORE|COPY|DELETE|APPEND)\b|\\Deleted/i.test(c);

(async () => {
    const env = { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' };
    let t = 5e9;
    const rig = (o) => { const P = fakePool(), I = fakeImap(o), S = fakeSmtp(o), audits = [];
        const RN = NM.mountMailRunner({ pool: P.pool, writeAudit: async (x) => { audits.push(x); }, env, imapOpen: I.imapOpenF, smtpSend: S.smtpSendF, noTimers: true, now: () => t });
        const req = async (key, v) => { P.cfg.set(key, v); await RN.tick(); return P.cfg.get(key.replace('_request', '_result')); };
        return { P, I, S, RN, audits, req }; };

    console.log('① 권한 · 지시 번호');
    {
        const g = rig();
        let r = await g.req('mail_trash_request', { id: 'x1', order_id: 2, uids: [12], folder: 'INBOX' });
        ok(r.ok === false && /관리자만/.test(r.error) && g.I.box.INBOX.length === 2, '직원 지시 휴지통 = 「관리자만 할 수 있어요」 · 안 옮김', r);
        r = await g.req('mail_move_request', { id: 'x2', uids: [12], folder: 'INBOX', to_folder: '거래처' });
        ok(r.ok === false && /지시 번호/.test(r.error), '지시 번호 없는 이동 = 거절', r);
        r = await g.req('mail_send_request', { id: 'x3', order_id: 2, to: ['a@b.com'], subject: 's', text: 't' });
        ok(r.ok === false && /초안 id 로만/.test(r.error) && g.S.sends === 0, '초안 없이 바로 보내기(주소·본문 직접) = 거절 · SMTP 0', r);
        r = await g.req('mail_move_request', { id: 'x4', order_id: 99, uids: [12], folder: 'INBOX', to_folder: '거래처' });
        ok(r.ok === false && /지시 번호/.test(r.error), '없는 지시 번호 = 거절');
    }

    console.log('② 이동 · 휴지통(UID MOVE 만)');
    {
        const g = rig();
        let r = await g.req('mail_move_request', { id: 'm0', order_id: 2, uids: [12, 77], folder: 'INBOX', to_folder: '거래처', dry: true });
        ok(r.ok && r.dry && r.mails.length === 1 && r.mails[0].subject === '할인 알림' && JSON.stringify(r.missing) === '[77]' && g.I.box.INBOX.length === 2, '미리 보기(dry) = 목록만 · 없는 uid 표시 · 안 옮김', r);
        ok(!g.I.cmds.some(c => /^SELECT |^UID MOVE/.test(c)), '미리 보기는 SELECT·MOVE 0(EXAMINE 만)', g.I.cmds);
        r = await g.req('mail_move_request', { id: 'm1', order_id: 2, uids: [12], folder: 'INBOX', to_folder: '거래처' });
        ok(r.ok && r.moved === 1 && r.from_folder === '받은메일함' && r.to_folder === '거래처' && r.by === '조가영' && g.I.box.INBOX.length === 1 && g.I.box[MINE].length === 1, '직원 지시 이동 = 됨 · 결과에 지시자 이름', r);
        ok(g.audits.some(a => a.action === 'mail_move' && a.changes.ordered_by === '조가영' && a.changes.moved === 1 && a.actor.name === '조가영'), '기록 mail_move = 누가 시켰는지 · 옮긴 수', g.audits);
        r = await g.req('mail_move_request', { id: 'm2', order_id: 2, uids: [11], folder: 'INBOX', to_folder: 'Junk' });
        ok(r.ok === false && /목록에 없어요/.test(r.error), '스팸 메일함으로 이동 = 거절(받은메일함·내 메일함만)');
        r = await g.req('mail_move_request', { id: 'm3', order_id: 2, uids: [11], folder: 'INBOX', to_folder: '없는함' });
        ok(r.ok === false && /목록에 없어요/.test(r.error), '없는 메일함 = 거절');
        r = await g.req('mail_trash_request', { id: 'tr', order_id: 1, uids: [11], folder: 'INBOX' });
        ok(r.ok && r.moved === 1 && r.to_folder === '휴지통' && g.I.box['Deleted Messages'].length === 1 && g.I.box.INBOX.length === 0, '관리자 지시 휴지통 = 휴지통 폴더로 옮김', r);
        ok(g.I.cmds.filter(c => /^UID MOVE/.test(c)).length === 2 && g.I.cmds.every(NO_DESTROY), '쓰기 = UID MOVE 2번뿐 · EXPUNGE·STORE·COPY·\\Deleted 0', g.I.cmds);
        ok(g.I.cmds.filter(c => /^SELECT /.test(c)).length === 2, 'SELECT 는 실제 이동 2번에만');
        r = await g.req('mail_move_request', { id: 'm4', order_id: 2, uids: Array.from({ length: 51 }, (_, i) => i + 1), folder: 'INBOX', to_folder: '거래처' });
        ok(r.ok === false && /1~50개/.test(r.error), '51통 = 거절');
        const g2 = rig({ noMove: true });
        r = await g2.req('mail_trash_request', { id: 'nm', order_id: 1, uids: [11], folder: 'INBOX' });
        ok(r.ok === false && /UID MOVE 를 지원하지 않아/.test(r.error) && g2.I.box.INBOX.length === 2 && !g2.I.cmds.some(c => /^SELECT |MOVE |COPY|STORE|EXPUNGE/.test(c)), 'MOVE 없는 서버 = 멈춤 · 복사·지우기 대체 0', { r, c: g2.I.cmds });
    }

    console.log('③ 보내기 — 초안 · 상한 · 첨부 · 답장');
    {
        const g = rig();
        const draft = (id, v) => g.P.cfg.set('mail_draft_' + id, { id, at: t, order_id: 2, by: '조가영', to: ['a@b.com'], cc: [], subject: '정산서 보내드립니다', text: '안녕하세요.\n.\n점 하나 줄도 그대로', attach_file_ids: [], ...v });
        draft('aaaaaa01', { attach_file_ids: [7] });
        let r = await g.req('mail_send_request', { id: 's1', order_id: 2, draft_id: 'aaaaaa01' });
        ok(r.ok && r.sent && r.by === '조가영' && r.subject === '정산서 보내드립니다' && r.attachments[0].name === '정산서.pdf' && g.S.sends === 1, '초안으로 보냄 · 결과에 받는 사람·제목·첨부·지시자', r);
        const smtpOrder = g.S.cmds.join(' | ');
        ok(/^EHLO .* \| AUTH LOGIN \| \(인증 줄\) \| \(인증 줄\) \| MAIL FROM:<u@naver.com> \| RCPT TO:<a@b.com> \| DATA \| QUIT$/.test(smtpOrder), 'SMTP 순서 = EHLO → AUTH LOGIN → MAIL FROM → RCPT → DATA → QUIT', smtpOrder);
        const D = g.S.data || '';
        ok(/Subject: =\?UTF-8\?B\?/.test(D) && /From: =\?UTF-8\?B\?.*<u@naver.com>/.test(D) && /To: a@b.com/.test(D) && /Content-Disposition: attachment; filename="=\?UTF-8\?B\?.*filename\*=utf-8''%EC%A0%95%EC%82%B0%EC%84%9C.pdf/.test(D) && D.includes(Buffer.from('%PDF-1.4 가짜').toString('base64')), '메시지 = 한글 제목·보낸 이름 인코딩 · 첨부 이름·바이트', D.slice(0, 300));
        const bodyB64 = (D.split('\r\n\r\n')[2] || '').split('\r\n--')[0].replace(/\r\n/g, '');
        ok(Buffer.from(bodyB64, 'base64').toString('utf8') === '안녕하세요.\n.\n점 하나 줄도 그대로', '본문 = base64 로 그대로(점 줄도 안 깨짐)');
        ok(!g.P.cfg.has('mail_draft_aaaaaa01'), '보낸 초안은 지워짐(한 번만)');
        r = await g.req('mail_send_request', { id: 's2', order_id: 2, draft_id: 'aaaaaa01' });
        ok(r.ok === false && /초안이 없어요/.test(r.error) && g.S.sends === 1, '같은 초안 두 번 = 거절 · 한 통만 나감');
        const au = g.audits.find(a => a.action === 'mail_send');
        ok(au && au.changes.ordered_by === '조가영' && au.changes.to[0] === 'a@b.com' && au.changes.text_head.length <= 100 && au.changes.bytes > 0 && !JSON.stringify(au).includes('s3cret'), '기록 mail_send = 받는 사람·제목·크기·본문 앞 100자·지시자 · 비밀값 0', au);
        draft('bbbbbb02', { order_id: 1 });
        r = await g.req('mail_send_request', { id: 's3', order_id: 2, draft_id: 'bbbbbb02' });
        ok(r.ok === false && /다른 지시의 초안/.test(r.error), '다른 지시의 초안 = 거절');
        draft('cccccc03', { at: t - 31 * 60000 });
        r = await g.req('mail_send_request', { id: 's4', order_id: 2, draft_id: 'cccccc03' });
        ok(r.ok === false && /30분/.test(r.error), '30분 지난 초안 = 거절');
        draft('dddddd04', { to: Array.from({ length: 6 }, (_, i) => `a${i}@b.com`), cc: Array.from({ length: 5 }, (_, i) => `c${i}@b.com`) });
        r = await g.req('mail_send_request', { id: 's5', order_id: 2, draft_id: 'dddddd04' });
        ok(r.ok === false && /10명까지/.test(r.error), '받는 사람+참조 11명 = 거절');
        draft('eeeeee05', { to: ['이상한주소'] });
        r = await g.req('mail_send_request', { id: 's6', order_id: 2, draft_id: 'eeeeee05' });
        ok(r.ok === false && /주소 꼴/.test(r.error), '주소 꼴 아님 = 거절');
        g.P.cfg.set('mail_send_count', { day: new Date(t + 9 * 3600e3).toISOString().slice(0, 10), n: 30 }); draft('ffffff06', {});
        r = await g.req('mail_send_request', { id: 's7', order_id: 2, draft_id: 'ffffff06' });
        ok(r.ok === false && /30통/.test(r.error) && g.S.sends === 1 && g.P.cfg.get('mail_send_count').n === 30, '오늘 30통(날짜별 카운터) = 거절 · 수 그대로', { r, c: g.P.cfg.get('mail_send_count') });
        g.P.cfg.delete('mail_send_count');
        draft('gggggg07', { attach_file_ids: [999] });
        r = await g.req('mail_send_request', { id: 's8', order_id: 2, draft_id: 'gggggg07' });
        ok(r.ok === false && /첨부 파일을 못 찾았어요/.test(r.error), '없는 첨부 = 거절');
        draft('hhhhhh08', { reply_to_uid: 11, folder: 'INBOX', subject: '정산 안내' });
        r = await g.req('mail_send_request', { id: 's9', order_id: 2, draft_id: 'hhhhhh08' });
        const D2 = g.S.data || '';
        ok(r.ok && r.reply && r.subject === 'Re: 정산 안내' && /In-Reply-To: <orig-11@nh.com>/.test(D2) && /References: <a@x> <orig-11@nh.com>/.test(D2), '답장 = In-Reply-To·References · 제목 Re:', { r, h: D2.slice(0, 400) });
        const g3 = rig({ authFail: true }); g3.P.cfg.set('mail_draft_iiiiii09', { id: 'iiiiii09', at: t, order_id: 2, to: ['a@b.com'], cc: [], subject: 's', text: 't', attach_file_ids: [] });
        r = await g3.req('mail_send_request', { id: 'sa', order_id: 2, draft_id: 'iiiiii09' });
        ok(r.ok === false && /535/.test(r.error) && !/s3cret|u@naver\.com/.test(r.error), 'SMTP 인증 실패 글에서 비밀값·계정 가림', r);
    }

    console.log('③-b 옛 지시 · 카운터 · 보냈을 수도 · 시간 초과');
    {
        const g = rig();
        let r = await g.req('mail_trash_request', { id: 'o3', order_id: 3, uids: [11], folder: 'INBOX' });
        ok(r.ok === false && /처리 중인 지시/.test(r.error) && g.I.box.INBOX.length === 2, '끝난(완료) 대표 지시 번호 = 거절', r);
        r = await g.req('mail_trash_request', { id: 'o4', order_id: 4, uids: [11], folder: 'INBOX' });
        ok(r.ok === false && /24시간/.test(r.error), '24시간 지난 지시 = 거절');
        const day = new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
        g.P.cfg.set('mail_draft_jjjjjj10', { id: 'jjjjjj10', at: t, order_id: 2, to: ['a@b.com'], cc: [], subject: 's', text: 't', attach_file_ids: [] });
        r = await g.req('mail_send_request', { id: 'c1', order_id: 2, draft_id: 'jjjjjj10' });
        ok(r.ok && g.P.cfg.get('mail_send_count').day === day && g.P.cfg.get('mail_send_count').n === 1 && g.audits.find(a => a.action === 'mail_send').changes.today_n === 1, '보내면 날짜별 카운터 1 · 기록에도 오늘 몇 번째', g.P.cfg.get('mail_send_count'));
        g.P.cfg.set('mail_send_count', { day: '2000-01-01', n: 30 });
        g.P.cfg.set('mail_draft_kkkkkk11', { id: 'kkkkkk11', at: t, order_id: 2, to: ['a@b.com'], cc: [], subject: 's', text: 't', attach_file_ids: [] });
        r = await g.req('mail_send_request', { id: 'c2', order_id: 2, draft_id: 'kkkkkk11' });
        ok(r.ok && g.P.cfg.get('mail_send_count').day === day && g.P.cfg.get('mail_send_count').n === 1, '어제 수는 오늘 새로 1부터');
        const gA = rig({ authFail: true }); gA.P.cfg.set('mail_draft_llllll12', { id: 'llllll12', at: t, order_id: 2, to: ['a@b.com'], cc: [], subject: 's', text: 't', attach_file_ids: [] });
        r = await gA.req('mail_send_request', { id: 'c3', order_id: 2, draft_id: 'llllll12' });
        ok(r.ok === false && !/보냈을 수 있어요/.test(r.error) && gA.P.cfg.get('mail_send_count').n === 0, '인증 실패(확실히 안 나감) = 「보냈을 수 있어요」 없음 · 오늘 수 되돌림(0)', { r, c: gA.P.cfg.get('mail_send_count') });
        const gD = rig({ dropAfterData: true }); gD.P.cfg.set('mail_draft_mmmmmm13', { id: 'mmmmmm13', at: t, order_id: 2, to: ['a@b.com'], cc: [], subject: 's', text: 't', attach_file_ids: [] });
        r = await gD.req('mail_send_request', { id: 'c4', order_id: 2, draft_id: 'mmmmmm13' });
        ok(r.ok === false && /보냈을 수 있어요 · 보낸메일함을 먼저 확인/.test(r.error) && gD.P.cfg.get('mail_send_count').n === 1 && !gD.P.cfg.has('mail_draft_mmmmmm13'), '본문 보낸 뒤 끊김 = 「보냈을 수 있어요 — 보낸메일함 확인」 · 수 유지 · 초안 재사용 불가', { r, c: gD.P.cfg.get('mail_send_count') });
        const P2 = fakePool(); const RN = NM.mountMailRunner({ pool: P2.pool, env, imapOpen: async () => { throw new Error('IMAP 시간 초과'); }, noTimers: true, now: () => t + 1e9 });
        P2.cfg.set('mail_search_request', { id: 'to', q: 'x' }); await RN.tick();
        ok(P2.cfg.get('mail_search_result').ok === false && /기간\(--since\)을 붙여 다시/.test(P2.cfg.get('mail_search_result').error), '찾기 시간 초과 = 「기간(--since)을 붙여 다시」 안내', P2.cfg.get('mail_search_result'));
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'naver-mail.js'), 'utf8');
        ok(/MAIL_DATE_PER_FOLDER = 1000, MAIL_DATE_TOTAL = 3000/.test(src), '더보기 줄 세우기 상한 = 메일함별 1천 · 합 3천');
    }

    console.log('④ 창구 도구 — draft → 카드(안 보냄) · send · move 되묻기');
    {
        const P = fakePool(); let outv; const now = (() => { let x = 1e12; return () => (x += 1000); })();
        const D = { pool: P.pool, sleep: async () => { }, now, out: o => { outv = o; } };
        P.pool.onInsert = async (k) => {   // 서버인 척
            const v = P.cfg.get(k);
            if (k === 'mail_send_request') P.cfg.set('mail_send_result', { ok: true, id: v.id, sent: true, to: ['a@b.com'], cc: [], subject: '정산서', attachments: [], by: '조가영' });
            if (k === 'mail_move_request') P.cfg.set('mail_move_result', v.dry ? { ok: true, id: v.id, dry: true, from_folder: '받은메일함', to_folder: '거래처', mails: [{ uid: 12, date: 'd', from: '광고 <ad@x.com>', subject: '할인' }], missing: [] } : { ok: true, id: v.id, moved: 1, from_folder: '받은메일함', to_folder: '거래처', mails: [], not_moved: [], by: '조가영' });
        };
        let err = null; try { await MF.main(['draft', '--to', 'a@b.com', '--subject', 'x', '--text', 'y'], D); } catch (e) { err = e; }
        ok(err && /--order/.test(err.message), 'draft 에 --order 없으면 거절');
        await MF.main(['draft', '--to', 'a@b.com', '--subject', '정산서', '--text', '안녕하세요', '--attach-id', '7', '--order', '2'], D);
        const keys = [...P.cfg.keys()].filter(k => /^mail_draft_/.test(k));
        ok(outv.ok && outv.draft_id && keys.length === 1 && /아직 안 보냄/.test(outv.card) && /이대로 보낼까요/.test(outv.card) && /정산서\.pdf/.test(outv.card) && outv.next === `send ${outv.draft_id} --order 2`, '초안 = 설정 표에 1줄 · 카드(아직 안 보냄 · 되묻기) · next = send', outv);
        ok(!P.cfg.has('mail_send_request'), 'draft 는 보내기 요청을 안 만듦');
        const dv = P.cfg.get(keys[0]);
        ok(dv.order_id === 2 && dv.to[0] === 'a@b.com' && JSON.stringify(dv.attach_file_ids) === '[7]' && /조가영/.test(dv.by), '초안 값 = 지시 · 받는 사람 · 첨부 id · 요청자');
        await MF.main(['draft', '--to', 'a@b.com,이상', '--subject', 's', '--text', 't', '--order', '2'], D);
        ok(outv.ok === false && /주소 꼴/.test(outv.error), '잘못된 주소 = 초안 안 만듦');
        await MF.main(['send', outv.draft_id || dv.id, '--order', '2'], D);
        ok(outv.ok && outv.sent && /━━━ 메일 보냄 ━━━/.test(outv.card) && /받는 사람: a@b.com/.test(outv.card) && /제목: 정산서/.test(outv.card) && /지시: 조가영/.test(outv.card), 'send 카드 = 보냄 · 받는 사람 · 제목 · 지시자', outv);
        P.cfg.delete('mail_move_request');
        await MF.main(['move', '12', '--to', '거래처', '--order', '2'], D);
        ok(outv.ok && outv.dry && /아직 안 함/.test(outv.card) && /거래처 로 옮길까요/.test(outv.card) && /--yes$/.test(outv.next), 'move(--yes 없음) = 목록 카드로 되묻기 · next 에 --yes', outv);
        ok(P.cfg.get('mail_move_request').dry === true, '되묻기 단계 요청 = dry');
        P.cfg.delete('mail_move_request');
        await MF.main(['move', '12', '--to', '거래처', '--order', '2', '--yes'], D);
        ok(outv.ok && outv.moved === 1 && /지시: 조가영/.test(outv.card) && P.cfg.get('mail_move_request').dry === false, 'move --yes = 실행 · 카드에 지시자');
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #776 검증 — 네이버 메일 찾기(naver-mail.js · 창구 scripts/desk/mail-find.js) · 가짜 IMAP 서버(소켓)로만 · 실메일·실DB 0
//   ① 검색 조건(한글 = 리터럴) ② 가짜 IMAP: 폴더 고르기(스팸·휴지통·보낸 빼기) · 찾기 · 읽기 · 첨부 · 보낸 명령 = 읽기 전용만 ③ 러너(요청 줄 → 결과 줄 · 10초 쿨다운 · 비밀값 가림)
//   ④ 창구 도구(주민번호 가림 · 결과 글) — #775 회귀는 node scripts/verify-775-booking.js 로 따로
//   실행: node scripts/verify-776-mail.js
'use strict';
const path = require('path'), { PassThrough } = require('stream');
const NM = require(path.join(__dirname, '..', 'naver-mail.js'));
const MF = require('./desk/mail-find.js');
const T = NM._t;
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };

// ── 메일 재료 ──────────────────────────────────────────
const b64 = (s) => Buffer.from(s).toString('base64');
const enc7 = (s) => { const u = Buffer.from(s, 'utf16le'); const be = Buffer.alloc(u.length); for (let i = 0; i < u.length; i += 2) { be[i] = u[i + 1]; be[i + 1] = u[i]; } return '&' + be.toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-'; };
const FOLDER_MINE = enc7('거래처');
const PDF = Buffer.from('%PDF-1.4 정산서 내용 ' + 'x'.repeat(500), 'utf8');
const T101 = '10월 정산 금액 안내드립니다.\n합계 1,234,000원\n주민번호 900101-1234567 확인 부탁';
const H102 = '<p>예약이 <b>확정</b>되었습니다</p><br>방문일 11월 1일';
const QP102 = Buffer.from(H102, 'utf8').toString('latin1').replace(/[\x80-\xff=]/g, c => '=' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const EUC = Buffer.from([0xC1, 0xA4, 0xBB, 0xEA, 0x20, 0xC0, 0xDA, 0xB7, 0xE1]);   // 「정산 자료」 EUC-KR
const XLSX = Buffer.from('PK\x03\x04 가짜 엑셀', 'utf8');
const nameLit = Buffer.from('정산표.xlsx', 'utf8');
const BOX = {
    INBOX: [
        { uid: 101, date: '15-Oct-2026 09:00:00 +0900', from: '농협 <nh@nonghyup.com>', subject: '=?UTF-8?B?' + b64('10월 정산 안내') + '?=', text: '정산 ' + T101,
          parts: { '1': b64(T101), '2': PDF.toString('base64') },
          bs: () => `((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"UTF-8\") NIL NIL \"BASE64\" ${b64(T101).length} 3 NIL NIL NIL)(\"APPLICATION\" \"PDF\" (\"NAME\" \"=?UTF-8?B?${b64('정산서.pdf')}?=\") NIL NIL \"BASE64\" ${PDF.toString('base64').length} NIL (\"ATTACHMENT\" (\"FILENAME*\" \"utf-8''%EC%A0%95%EC%82%B0%EC%84%9C.pdf\")) NIL) \"MIXED\" (\"BOUNDARY\" \"b1\") NIL NIL)` },
        { uid: 102, date: '18-Oct-2026 10:00:00 +0900', from: '네이버 예약 <booking@naver.com>', subject: '예약 확정 안내', text: '예약 확정',
          parts: { '1': QP102 },
          bs: () => `(\"TEXT\" \"HTML\" (\"CHARSET\" \"utf-8\") NIL NIL \"QUOTED-PRINTABLE\" ${QP102.length} 3 NIL NIL NIL)` },
    ],
    [FOLDER_MINE]: [
        { uid: 7, date: '19-Oct-2026 11:00:00 +0900', from: '=?UTF-8?B?' + b64('효돈농협') + '?= <hd@nh.com>', subject: '정산 자료', text: '정산 자료',
          parts: { '1.1': EUC.toString('latin1'), '1.2': '<b>html</b>', '2': XLSX.toString('base64') },
          bsLit: true },
    ],
    Junk: [{ uid: 1, date: '19-Oct-2026 12:00:00 +0900', from: 'spam <s@x.com>', subject: '정산 당첨', text: '정산', parts: { '1': 'x' }, bs: () => '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 1 1 NIL NIL NIL)' }],
    'Deleted Messages': [{ uid: 1, date: '19-Oct-2026 12:00:00 +0900', from: 'a <a@x.com>', subject: '정산 지운 것', text: '정산', parts: { '1': 'x' }, bs: () => '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 1 1 NIL NIL NIL)' }],
    'Sent Messages': [{ uid: 1, date: '19-Oct-2026 12:00:00 +0900', from: 'me <bumiletter@naver.com>', subject: '정산 보냄', text: '정산', parts: { '1': 'x' }, bs: () => '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 1 1 NIL NIL NIL)' }],
};
const LIST = [['\\HasNoChildren', 'INBOX'], ['\\HasNoChildren \\Junk', 'Junk'], ['\\HasNoChildren \\Trash', 'Deleted Messages'], ['\\HasNoChildren \\Sent', 'Sent Messages'], ['\\HasNoChildren', FOLDER_MINE], ['\\Noselect \\HasChildren', 'Archive']];
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const dayOf = (s) => { const m = /(\d+)-(\w{3})-(\d{4})/.exec(s); return Date.UTC(+m[3], MON[m[2]], +m[1]); };

// ── 가짜 IMAP 서버(명령 줄 + 리터럴 이어 받기) ─────────────
function fakeImap(opts) {
    opts = opts || {};
    const cmds = [];
    const connect = () => {
        const toClient = new PassThrough(), sock = new PassThrough();
        let inbuf = Buffer.alloc(0), lineAcc = [], needLit = 0, cur = null;
        const say = (s) => setImmediate(() => toClient.emit('data', Buffer.isBuffer(s) ? s : Buffer.from(s)));
        const handle = (tag, line, lits) => {
            cmds.push({ line: line.replace(/^LOGIN .*/, 'LOGIN ***'), lits: lits.map(x => x.toString('utf8')) });
            if (opts.failLogin && /^LOGIN /.test(line)) return say(`${tag} NO login failed for u@naver.com pass s3cret\r\n`);
            if (/^LOGIN /.test(line)) return say(`${tag} OK LOGIN\r\n`);
            if (/^LIST "" "\*"$/.test(line)) return say(LIST.map(([f, n]) => `* LIST (${f}) "/" "${n}"\r\n`).join('') + `${tag} OK LIST\r\n`);
            let m;
            if ((m = /^EXAMINE "((?:[^"\\]|\\.)*)"$/.exec(line))) { cur = m[1]; return say(BOX[cur] ? `* ${BOX[cur].length} EXISTS\r\n${tag} OK [READ-ONLY] EXAMINE\r\n` : `${tag} NO no such box\r\n`); }
            if ((m = /^UID SEARCH (.*)$/.exec(line))) {
                const crit = m[1]; let li = 0; const want = {};
                for (const k of ['TEXT', 'FROM', 'SUBJECT']) if (new RegExp('\\b' + k + ' \\{').test(crit)) want[k] = lits[li++];
                const since = /SINCE (\S+)/.exec(crit), before = /BEFORE (\S+)/.exec(crit);
                const hit = (BOX[cur] || []).filter(x => {
                    const fromTxt = NM.decodeWords(x.from), subj = NM.decodeWords(x.subject);
                    if (want.TEXT && !(fromTxt + subj + x.text).includes(want.TEXT.toString('utf8'))) return false;
                    if (want.FROM && !fromTxt.includes(want.FROM.toString('utf8'))) return false;
                    if (want.SUBJECT && !subj.includes(want.SUBJECT.toString('utf8'))) return false;
                    if (since && dayOf(x.date) < dayOf(since[1])) return false;
                    if (before && dayOf(x.date) >= dayOf(before[1])) return false;
                    return true;
                }).map(x => x.uid);
                return say(`* SEARCH ${hit.join(' ')}\r\n${tag} OK SEARCH\r\n`);
            }
            if ((m = /^UID FETCH ([\d,]+) \((.*)\)$/.exec(line))) {
                const uids = m[1].split(',').map(Number), what = m[2], box = BOX[cur] || [];
                const parts = [];
                for (const uid of uids) {
                    const x = box.find(y => y.uid === uid); if (!x) continue;
                    if (what === 'UID INTERNALDATE') parts.push(Buffer.from(`* 1 FETCH (UID ${uid} INTERNALDATE "${x.date}")\r\n`));
                    else if (what === 'UID BODYSTRUCTURE') {
                        if (x.bsLit) {
                            const head = `* 1 FETCH (UID ${uid} BODYSTRUCTURE (((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"EUC-KR\") NIL NIL \"8BIT\" 9 1 NIL NIL NIL)(\"TEXT\" \"HTML\" (\"CHARSET\" \"UTF-8\") NIL NIL \"7BIT\" 11 1 NIL NIL NIL) \"ALTERNATIVE\" (\"BOUNDARY\" \"a\") NIL NIL)(\"APPLICATION\" \"VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET\" (\"NAME\" {${nameLit.length}}\r\n`;
                            parts.push(Buffer.from(head), nameLit, Buffer.from(`) NIL NIL \"BASE64\" ${XLSX.toString('base64').length} NIL (\"ATTACHMENT\" NIL) NIL) \"MIXED\" (\"BOUNDARY\" \"m\") NIL NIL))\r\n`));
                        } else parts.push(Buffer.from(`* 1 FETCH (UID ${uid} BODYSTRUCTURE ${x.bs()})\r\n`));
                    } else if ((m = /^BODY\.PEEK\[HEADER\.FIELDS \(FROM TO CC SUBJECT DATE\)\]$/.exec(what))) {
                        const h = Buffer.from(`From: ${x.from}\r\nTo: bumiletter@naver.com\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n\r\n`, 'utf8');
                        parts.push(Buffer.from(`* 1 FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE)] {${h.length}}\r\n`), h, Buffer.from(')\r\n'));
                    } else if ((m = /^BODY\.PEEK\[([\d.]+)\](?:<0\.(\d+)>)?$/.exec(what))) {
                        let body = Buffer.from(x.parts[m[1]] || '', 'latin1'); if (m[2]) body = body.slice(0, +m[2]);
                        parts.push(Buffer.from(`* 1 FETCH (UID ${uid} BODY[${m[1]}]${m[2] ? '<0>' : ''} {${body.length}}\r\n`), body, Buffer.from(')\r\n'));
                    }
                }
                const all = Buffer.concat(parts.concat([Buffer.from(`${tag} OK FETCH\r\n`)]));
                return opts.split ? (say(all.slice(0, 37)), setImmediate(() => say(all.slice(37)))) : say(all);   // 조각 나눠 오기
            }
            if (/^LOGOUT$/.test(line)) return say(`* BYE\r\n${tag} OK\r\n`);
            return say(`${tag} BAD unknown\r\n`);
        };
        sock.write = (d) => {
            inbuf = Buffer.concat([inbuf, Buffer.isBuffer(d) ? d : Buffer.from(String(d))]);
            for (;;) {
                if (needLit) { if (inbuf.length < needLit) return true; lineAcc.push({ lit: inbuf.slice(0, needLit) }); inbuf = inbuf.slice(needLit); needLit = 0; continue; }
                const i = inbuf.indexOf('\r\n'); if (i < 0) return true;
                const line = inbuf.slice(0, i).toString('utf8'); inbuf = inbuf.slice(i + 2);
                const lm = /\{(\d+)\}$/.exec(line);
                lineAcc.push({ text: lm ? line.slice(0, lm.index) + '{' + lm[1] + '}' : line });
                if (lm) { needLit = +lm[1]; say('+ go ahead\r\n'); continue; }
                const full = lineAcc.filter(x => x.text != null).map(x => x.text).join(''), lits = lineAcc.filter(x => x.lit).map(x => x.lit); lineAcc = [];
                const sp = full.indexOf(' '), tag = full.slice(0, sp), rest = full.slice(sp + 1);
                handle(tag, rest, lits);
            }
        };
        sock.on = (ev, fn) => { if (ev === 'data') toClient.on('data', fn); return sock; };
        sock.end = () => { }; sock.destroy = () => { };
        setImmediate(() => toClient.emit('data', Buffer.from('* OK IMAP ready\r\n')));
        return sock;
    };
    const imapOpenF = (o) => NM.imapOpen({ ...o, connect, timeoutMs: 5000 });
    return { cmds, imapOpenF };
}
const READONLY = (c) => /^(LOGIN \*\*\*|LIST "" "\*"|EXAMINE "|UID SEARCH |UID FETCH [\d,]+ \((UID INTERNALDATE|UID BODYSTRUCTURE|BODY\.PEEK\[[^\]]*\](<0\.\d+>)?)\)$|LOGOUT$)/.test(c.line)
    && !/\b(STORE|COPY|MOVE|EXPUNGE|APPEND|SELECT|CREATE|DELETE|RENAME|SUBSCRIBE|RFC822)\b/.test(c.line);

(async () => {
    console.log('① 검색 조건 · 폴더 이름 · BODYSTRUCTURE');
    {
        const p = T.searchPieces({ q: '정산', since: '2026-10-01', until: '2026-10-16' });
        ok(p[0] === 'CHARSET UTF-8 ' && p[1] === 'TEXT ' && Buffer.isBuffer(p[2]) && p[2].toString('utf8') === '정산' && p.join('').includes('SINCE 1-Oct-2026') && p.join('').includes('BEFORE 17-Oct-2026'), '한글 = CHARSET UTF-8 + 리터럴 · 끝날 포함(BEFORE 다음 날)', p.map(String));
        const pa = T.searchPieces({ from: 'naver.com' });
        ok(pa[0] === 'FROM ' && !pa.includes('CHARSET UTF-8 '), '영문만 = CHARSET 없음', pa.map(String));
        ok(T.mutf7(FOLDER_MINE) === '거래처' && T.mutf7('A&-B') === 'A&B', '수정 UTF-7 폴더 이름 풀기');
        const fs0 = T.pickFolders(LIST.map(([f, n]) => ({ raw: n, name: T.mutf7(n), flags: f.toLowerCase().split(' ') })));
        ok(JSON.stringify(fs0.map(f => f.name)) === '["받은메일함","거래처"]', '메일함 = 받은메일함 + 내 메일함(스팸·휴지통·보낸·선택 불가 뺌)', fs0);
        const parts = T.bodyParts(T.sexp([{ text: BOX.INBOX[0].bs() }])[0], '', []);
        ok(parts.length === 2 && parts[0].part === '1' && parts[0].type === 'text/plain' && parts[1].part === '2' && parts[1].name === '정산서.pdf' && parts[1].disp === 'attachment', 'BODYSTRUCTURE → 부분 번호 · 첨부 이름(RFC 2231)', parts);
        const single = T.bodyParts(T.sexp([{ text: BOX.INBOX[1].bs() }])[0], '', []);
        ok(single.length === 1 && single[0].part === '1' && single[0].type === 'text/html', '한 부분 메일 = part 1');
        ok(T.checkReq('search', {}) && T.checkReq('search', { q: 'x', limit: 21 }) && T.checkReq('search', { q: 'x', since: '2026/10/01' }) && !T.checkReq('search', { q: 'x', limit: 20 }), '요청 검사(빈 요청 · 21통 · 날짜 꼴)');
        ok(T.checkReq('attach', { uid: 1, part: '2;DELETE' }) && T.checkReq('read', { uid: -1 }), '요청 검사(part 꼴 · uid)');
    }

    console.log('② 가짜 IMAP — 찾기 · 읽기 · 첨부');
    {
        const F = fakeImap({ split: true });
        const ops = NM.makeMailOps(() => ({ user: 'u@naver.com', pass: 's3cret' }), { imapOpen: F.imapOpenF });
        const s = await ops.search({ q: '정산', limit: 10 });
        ok(s.found === 2 && s.shown === 2 && s.mails[0].uid === 7 && s.mails[1].uid === 101, '「정산」 = 받은메일함 101 + 거래처 7(스팸·휴지통·보낸 0) · 최근 순', s);
        ok(s.mails[0].folder_name === '거래처' && s.mails[0].from.startsWith('효돈농협') && s.mails[0].preview === '정산 자료' && s.mails[0].attachments[0].name === '정산표.xlsx' && s.mails[0].attachments[0].part === '2', '거래처 메일: 보낸 사람(인코딩 풂) · 본문 EUC-KR · 리터럴 첨부 이름', s.mails[0]);
        ok(s.mails[1].subject === '10월 정산 안내' && s.mails[1].preview.startsWith('10월 정산 금액') && s.mails[1].preview.length <= 300 && s.mails[1].attachments[0].name === '정산서.pdf', '받은메일함 메일: 제목·본문 앞부분·첨부', s.mails[1]);
        ok(F.cmds.every(READONLY), '보낸 명령 = LOGIN·LIST·EXAMINE·UID SEARCH·UID FETCH(PEEK·BODYSTRUCTURE·INTERNALDATE)·LOGOUT 만(쓰기 0 · SELECT 0)', F.cmds.filter(c => !READONLY(c)));
        ok(!F.cmds.some(c => /EXAMINE "(Junk|Deleted Messages|Sent Messages|Archive)"/.test(c.line)), '스팸·휴지통·보낸·선택 불가 메일함은 열지도 않음');
        ok(F.cmds.some(c => /^UID SEARCH CHARSET UTF-8 TEXT \{6\}$/.test(c.line) && c.lits[0] === '정산'), '한글 검색어 = 리터럴로 이어 보냄(「+」 받은 뒤)', F.cmds.map(c => c.line));
        const F2 = fakeImap();
        const ops2 = NM.makeMailOps(() => ({ user: 'u@naver.com', pass: 's3cret' }), { imapOpen: F2.imapOpenF });
        const s2 = await ops2.search({ from: '네이버', limit: 5 });
        ok(s2.found === 1 && s2.mails[0].uid === 102 && /예약이 확정되었습니다/.test(s2.mails[0].preview), '보낸 사람 「네이버」 = 102 · html+QP 본문 → 글', s2.mails[0]);
        const s3 = await ops2.search({ q: '정산', until: '2026-10-16' });
        ok(s3.found === 1 && s3.mails[0].uid === 101, '끝날 10-16 = 101 만(포함)', s3);
        const s4 = await ops2.search({ q: '정산', folder: '거래처' });
        ok(s4.found === 1 && s4.mails[0].uid === 7, 'folder 지정(사람 이름) = 그 메일함만');
        let e1 = null; try { await ops2.search({ q: '정산', folder: 'Junk' }); } catch (e) { e1 = e; }
        ok(e1 && e1.user && /그 메일함이 없어요/.test(e1.message), '스팸 메일함 지정 = 거절');
        const r = await ops2.read({ uid: 101, folder: 'INBOX' });
        ok(r.text === T101 && !r.text_cut && r.attachments.length === 1 && r.to === 'bumiletter@naver.com', '읽기 = 본문 전체 · 첨부 목록 · 받는 사람', r);
        const at = await ops2.attach({ uid: 101, folder: 'INBOX', part: '2' });
        ok(Buffer.compare(at.buf, PDF) === 0 && at.name === '정산서.pdf' && at.type === 'application/pdf', '첨부 = 원래 바이트 그대로 · 이름', { n: at.name, len: at.buf.length });
        let e2 = null; try { await ops2.attach({ uid: 101, folder: 'INBOX', part: '1' }); } catch (e) { e2 = e; }
        ok(e2 && e2.user && /첨부\(part\)가 이 메일에 없어요/.test(e2.message), '본문 부분(part 1)은 첨부로 못 받음');
        const at7 = await ops2.attach({ uid: 7, folder: FOLDER_MINE, part: '2' });
        ok(Buffer.compare(at7.buf, XLSX) === 0 && at7.name === '정산표.xlsx', '내 메일함 첨부(이름이 리터럴)');
        ok(F2.cmds.every(READONLY), '두 번째 묶음도 읽기 전용 명령만', F2.cmds.filter(c => !READONLY(c)));
        const F3 = fakeImap({ failLogin: true });
        const ops3 = NM.makeMailOps(() => ({ user: 'u@naver.com', pass: 's3cret' }), { imapOpen: F3.imapOpenF });
        let e3 = null; try { await ops3.search({ q: 'x' }); } catch (e) { e3 = e; }
        ok(e3 && !/s3cret|u@naver\.com/.test(e3.message) && /\(비밀값\)|\(메일 계정\)/.test(e3.message), '로그인 실패 글에서 비밀값·계정 가림', e3 && e3.message);
        const ops4 = NM.makeMailOps(() => ({ user: '', pass: '' }), { imapOpen: F3.imapOpenF });
        let e4 = null; try { await ops4.search({ q: 'x' }); } catch (e) { e4 = e; }
        ok(e4 && e4.noCreds, '메일 설정 없음 = noCreds');
    }

    console.log('③ 서버 러너 — 요청 줄 → 결과 줄');
    {
        const cfg = new Map(), files = [], audits = [], age = new Map(), sqls = [];   // age = 행마다 몇 분 묵었는지(가짜 updated_at)
        const pool = { async query(sql, p = []) {
            sqls.push(sql);
            if (/SELECT key, value FROM agent_office_config/.test(sql)) throw new Error('집기는 DELETE … RETURNING 한 번이어야 함(SELECT 뒤 DELETE 금지)');
            if (/DELETE FROM agent_office_config WHERE key = ANY\(\$1\) AND updated_at < NOW\(\) - make_interval\(mins => \$2::int\)/.test(sql)) { for (const k of p[0]) if (cfg.has(k) && (age.get(k) || 0) > p[1]) { cfg.delete(k); age.delete(k); } return { rows: [] }; }
            if (/DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(sql)) { const v = cfg.get(p[0]); const had = cfg.has(p[0]); cfg.delete(p[0]); return { rows: had ? [{ value: v }] : [] }; }
            if (/INSERT INTO agent_office_config/.test(sql)) { cfg.set(p[0], JSON.parse(p[1])); age.set(p[0], 0); return { rows: [] }; }
            if (/INSERT INTO report_files/.test(sql)) { files.push({ id: files.length + 1, filename: p[0], data: p[1], size: p[2] }); return { rows: [{ id: files.length }] }; }
            throw new Error('모르는 SQL ' + sql.slice(0, 80));
        } };
        let t = 1000000;
        const F = fakeImap();
        const RN = NM.mountMailRunner({ pool, writeAudit: async (x) => { audits.push(x); }, env: { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' }, imapOpen: F.imapOpenF, noTimers: true, now: () => t });
        cfg.set('mail_search_request', { id: 'a1', q: '정산', limit: 5, order_id: 9, by: '창구' });
        await RN.tick();
        const res = cfg.get('mail_search_result');
        ok(res && res.ok && res.id === 'a1' && res.found === 2 && res.mails.length === 2 && !cfg.has('mail_search_request'), '찾기 요청 → 결과(id 짝) · 요청 줄은 집으면 지움', res);
        ok(audits.length === 1 && audits[0].action === 'mail_search' && audits[0].changes.q === '정산' && audits[0].changes.found === 2 && !JSON.stringify(audits[0]).includes('1,234,000') && !JSON.stringify(audits[0]).includes('s3cret'), '기록(audit) = 검색어·건수만(본문·비밀값 0)', audits[0]);
        t += 3000; cfg.set('mail_search_request', { id: 'a2', q: '예약' }); await RN.tick();
        ok(cfg.get('mail_search_result').ok === false && /10초 간격/.test(cfg.get('mail_search_result').error), '10초 안 두 번째 찾기 = 거절', cfg.get('mail_search_result'));
        t += 11000; cfg.set('mail_search_request', { id: 'a3', q: '예약' }); await RN.tick();
        ok(cfg.get('mail_search_result').ok === true && cfg.get('mail_search_result').id === 'a3', '10초 뒤 = 됨');
        cfg.set('mail_search_request', { id: 'a4', q: 'x', limit: 50 }); t += 11000; await RN.tick();
        ok(cfg.get('mail_search_result').ok === false && /limit/.test(cfg.get('mail_search_result').error), '21통 넘는 요청 = 거절');
        cfg.set('mail_read_request', { id: 'r1', uid: 101, folder: 'INBOX' }); await RN.tick();
        ok(cfg.get('mail_read_result').ok && cfg.get('mail_read_result').mail.text === T101, '읽기 요청 → 본문');
        cfg.set('mail_attach_request', { id: 'p1', uid: 101, folder: 'INBOX', part: '2' }); await RN.tick();
        const ar = cfg.get('mail_attach_result');
        ok(ar.ok && ar.file_id === 1 && files[0].filename === '정산서.pdf' && Buffer.compare(files[0].data, PDF) === 0 && ar.size === PDF.length, '첨부 요청 → report_files 1행(원래 바이트)', ar);
        cfg.set('mail_attach_request', { id: 'p2', uid: 101, folder: 'INBOX', part: '9' }); await RN.tick();
        ok(cfg.get('mail_attach_result').ok === false && /첨부\(part\)/.test(cfg.get('mail_attach_result').error) && files.length === 1, '없는 첨부 = 거절 · 파일 안 만듦');
        const RN2 = NM.mountMailRunner({ pool, env: {}, imapOpen: F.imapOpenF, noTimers: true, now: () => t + 99999 });
        cfg.set('mail_search_request', { id: 'n1', q: 'x' }); await RN2.tick();
        ok(cfg.get('mail_search_result').ok === false && /메일 설정이 없어요/.test(cfg.get('mail_search_result').error), '설정 없음 = 고정 문구');
        ok(sqls.some(s => /DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(s)) && !sqls.some(s => /SELECT key, value/.test(s)), '요청 줄 집기 = DELETE … RETURNING 한 번(SELECT 뒤 DELETE 없음)');
        // 결과 줄 10분 정리 — 11분 묵은 결과는 지우고 · 방금 것은 남김 · 요청 줄은 안 건드림
        const RN3 = NM.mountMailRunner({ pool, env: {}, imapOpen: F.imapOpenF, noTimers: true, now: () => t + 999999 });
        cfg.set('mail_read_result', { ok: true, id: 'old', mail: { text: '옛 본문' } }); age.set('mail_read_result', 11);
        cfg.set('mail_attach_result', { ok: true, id: 'new' }); age.set('mail_attach_result', 2);
        cfg.set('mail_search_request', { id: 'keep', q: 'x' }); age.set('mail_search_request', 30);
        await RN3.tick();
        ok(!cfg.has('mail_read_result') && cfg.get('mail_attach_result') && cfg.get('mail_attach_result').id === 'new', '결과 줄 = 10분 넘은 것만 지움', [...cfg.keys()]);
        ok(cfg.get('mail_search_result') && cfg.get('mail_search_result').id === 'keep', '요청 줄은 정리 대상 아님(그대로 집어 실행)');
        cfg.set('mail_read_result', { ok: true, id: 'old2' }); age.set('mail_read_result', 30); await RN3.tick();
        ok(cfg.has('mail_read_result'), '정리는 1분에 한 번(같은 분 안 두 번째 틱은 안 지움)');
    }

    console.log('④ 창구 도구 mail-find.js');
    {
        const cfg = new Map();
        const pool = { async query(sql, p = []) {
            if (/SELECT 1 FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{}] : [] };
            if (/SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{ value: cfg.get(p[0]) }] : [] };
            if (/DELETE FROM agent_office_config WHERE key = \$1/.test(sql)) { cfg.delete(p[0]); return { rows: [] }; }
            if (/INSERT INTO agent_office_config/.test(sql)) {   // 서버인 척: 요청이 들어오면 결과를 같은 id 로
                const v = JSON.parse(p[1]); cfg.set(p[0], v);
                if (p[0] === 'mail_search_request') cfg.set('mail_search_result', { ok: true, id: v.id, found: 3, shown: 1, folders: ['받은메일함'], mails: [{ uid: 101, folder: 'INBOX', folder_name: '받은메일함', date: 'Wed', from: '농협 <nh@x>', subject: '정산 900101-1234567', preview: '주민번호 900101-1234567 · 전화 010-1234-5678', attachments: [{ part: '2', name: '정산서.pdf', size: 2048 }] }] });
                return { rows: [] };
            }
            if (/FROM pending_orders WHERE id = \$1/.test(sql)) return { rows: [{ id: p[0], created_by: '조가영' }] };
            throw new Error('모르는 SQL ' + sql.slice(0, 80));
        } };
        let outv; const now = (() => { let x = 0; return () => (x += 1000); })();
        await MF.main(['find', '정산', '--since', '2026-10-01', '--order', '5'], { pool, sleep: async () => { }, now, out: o => { outv = o; } });
        const sent = cfg.get('mail_search_request');
        ok(outv.ok && outv.found === 3 && /최근 1통/.test(outv.text) && /part 2/.test(outv.text) && /uid 101/.test(outv.text), '찾기 결과 글(건수 · 첨부 part · uid)', outv);
        ok(!JSON.stringify(outv).includes('1234567') && JSON.stringify(outv).includes('900101-1******') && JSON.stringify(outv).includes('010-1234-5678'), '주민번호 꼴만 가림(전화번호는 그대로)', outv.mails[0]);
        ok(sent && sent.q === '정산' && sent.since === '2026-10-01' && sent.order_id === 5 && /조가영/.test(sent.by), '요청 줄 = 검색어·날짜·지시·요청자', sent);
        ok(/오래된 2통/.test(outv.note || ''), '더 있으면 좁히라는 안내');
        let err = null; try { await MF.main(['find'], { pool, sleep: async () => { }, now, out: () => { } }); } catch (e) { err = e; }
        ok(err && /하나는 주세요/.test(err.message), '조건 없이 찾기 = 거절');
        err = null; try { await MF.main(['find', 'x', '--limit', '30'], { pool, sleep: async () => { }, now, out: () => { } }); } catch (e) { err = e; }
        ok(err && /1~20/.test(err.message), '--limit 30 = 거절');
        ok(MF.maskPii('900101 - 2345678') === '900101-2******' && MF.maskPii('1234567890123') === '1234567890123', '주민번호 가림(띄어 쓴 꼴 · 13자리 아무 숫자는 그대로)', [MF.maskPii('900101 - 2345678'), MF.maskPii('1234567890123')]);
    }

    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

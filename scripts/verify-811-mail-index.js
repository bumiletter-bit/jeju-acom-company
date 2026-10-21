// #811 검증 — 메일 색인(naver-mail.js) · 가짜 IMAP 서버(소켓) + 가짜 DB 로만 · 실메일·실DB 0
//   ① 계산서 분류(CJ · 시온(제주조천점) · 효돈 · 에프씨컨슈머 제외 · 예약) ② 처음 채우기 = 한 번에 1천 통 · 메일함별 상한(받은메일함 5천 · 그 밖 500 · #818) · 그 뒤 새 uid 만 · 종전에 0통으로 닫힌 메일함 되살리기
//   ③ UIDVALIDITY 바뀐 메일함 = 버리고 다시 ④ 찾기 = 색인 먼저(한글 부분 일치 · 첨부 이름 · 기간 · 더보기) · 낡거나 덜 찼으면 종전 IMAP 길 ⑤ 보낸 명령 = 읽기 전용만
//   실행: node scripts/verify-811-mail-index.js
'use strict';
const path = require('path'), { PassThrough } = require('stream');
const NM = require(path.join(__dirname, '..', 'naver-mail.js'));
const T = NM._t;
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅', name); } else { failN++; console.log('  ❌', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const b64 = (s) => Buffer.from(s).toString('base64');
const enc7 = (s) => { const u = Buffer.from(s, 'utf16le'); const be = Buffer.alloc(u.length); for (let i = 0; i < u.length; i += 2) { be[i] = u[i + 1]; be[i + 1] = u[i]; } return '&' + be.toString('base64').replace(/=+$/, '').replace(/\//g, ',') + '-'; };
const FOLDER_MINE = enc7('거래처');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const idate = (ms) => { const d = new Date(ms + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0900`; };
const BASE = Date.parse('2026-01-01T00:00:00+09:00');
// 메일 만들기 — uid 가 클수록 최근(10분 간격)
const SUBJ = {
    cj: '[청구·결제] [전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 제주아꼼이네 농업회사법인 주식회사',
    sion: '[홈택스] 전자세금계산서 (제주조천점->제주아꼼이네 농업회사법인 주식회사) 2026.10.05 1,250,000원',
    hyodon: '효돈농협유통 세금계산서 발행 안내',
    fcc: '[전자세금계산서 정발행] 씨제이대한통운㈜ ▶ 에프씨컨슈머(F.C.C)',
    booking: '[네이버 예약] 새 예약이 들어왔어요',
};
function mail(uid, kind, offMin) {
    const at = BASE + offMin * 60000;
    const from = kind === 'cj' ? '=?UTF-8?B?' + b64('강주아') + '?= <jua.kang@cj.net>' : kind === 'sion' ? '홈택스 <hometax@nts.go.kr>' : kind === 'hyodon' ? '=?UTF-8?B?' + b64('효돈농협') + '?= <hd@nh.com>'
        : kind === 'fcc' ? 'CJ <jua.kang@cj.net>' : kind === 'booking' ? '네이버 예약 <naverbooking_noreply@navercorp.com>' : `보낸이${uid} <s${uid}@x.com>`;
    const subject = SUBJ[kind] ? '=?UTF-8?B?' + b64(SUBJ[kind]) + '?=' : `일반 안내 ${uid}`;
    const att = (kind === 'cj' || kind === 'sion');
    const bs = att ? `(("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 5 1 NIL NIL NIL)("APPLICATION" "PDF" ("NAME" "=?UTF-8?B?${b64('세금계산서_10월.pdf')}?=") NIL NIL "BASE64" 100 NIL ("ATTACHMENT" NIL) NIL) "MIXED" ("BOUNDARY" "b") NIL NIL)`
        : '("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 5 1 NIL NIL NIL)';
    return { uid, at, date: idate(at), from, subject, bs, size: 1000 + uid, text: '본문 ' + uid };
}
function makeBox(n, startUid, offStart, kinds) {
    const out = []; for (let i = 0; i < n; i++) { const uid = startUid + i; out.push(mail(uid, (kinds && kinds[uid]) || 'other', offStart + i * 10)); } return out;
}

// ── 가짜 IMAP(소켓) ─────────────
function fakeImap(state) {
    const cmds = [];
    const connect = () => {
        const toClient = new PassThrough(), sock = new PassThrough();
        let inbuf = Buffer.alloc(0), lineAcc = [], needLit = 0, cur = null;
        const say = (s) => setImmediate(() => toClient.emit('data', Buffer.isBuffer(s) ? s : Buffer.from(s)));
        const handle = (tag, line, lits) => {
            cmds.push(line.replace(/^LOGIN .*/, 'LOGIN ***'));
            if (/^LOGIN /.test(line)) return say(`${tag} OK LOGIN\r\n`);
            if (/^LIST "" "\*"$/.test(line)) return say(state.list.map(([f, n]) => `* LIST (${f}) "/" "${n}"\r\n`).join('') + `${tag} OK LIST\r\n`);
            let m;
            if ((m = /^EXAMINE "((?:[^"\\]|\\.)*)"$/.exec(line))) { cur = m[1]; const b = state.box[cur]; return say(b ? `* ${b.length} EXISTS\r\n* OK [UIDVALIDITY ${state.v[cur] || 1}] UIDs valid\r\n${tag} OK [READ-ONLY] EXAMINE\r\n` : `${tag} NO no such box\r\n`); }
            if ((m = /^UID SEARCH (.*)$/.exec(line))) {
                const box = state.box[cur] || []; let hit;
                if (/^ALL ?$/.test(m[1].trim())) hit = box.map(x => x.uid);
                else {   // 종전 길(대비) — 글자 리터럴 하나 또는 ASCII 따옴표
                    const want = lits[0] ? lits[0].toString('utf8') : ((/"([^"]*)"/.exec(m[1]) || [])[1] || '');
                    hit = box.filter(x => (NM.decodeWords(x.from) + NM.decodeWords(x.subject) + x.text).includes(want)).map(x => x.uid);
                }
                return say(`* SEARCH ${hit.join(' ')}\r\n${tag} OK SEARCH\r\n`);
            }
            if ((m = /^UID FETCH ([\d,:*]+) \((.*)\)$/.exec(line))) {
                const box = state.box[cur] || [], what = m[2];
                const uids = m[1].split(',').map(Number);
                const parts = [];
                for (const uid of uids) {
                    const x = box.find(y => y.uid === uid); if (!x) continue;
                    const sq = box.indexOf(x) + 1;
                    if (what === 'UID INTERNALDATE RFC822.SIZE BODYSTRUCTURE') parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}" RFC822.SIZE ${x.size} BODYSTRUCTURE ${x.bs})\r\n`));
                    else if (what === 'UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]') {
                        const h = Buffer.from(`From: ${x.from}\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n\r\n`, 'utf8');
                        if (state.noHeaderBatch) parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}")\r\n`));
                        else if (state.splitFetch) parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}")\r\n* ${sq} FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h.length}}\r\n`), h, Buffer.from(')\r\n'));
                        else parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}" BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h.length}}\r\n`), h, Buffer.from(')\r\n'));
                    } else if (what === 'BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]') { const h = Buffer.from(`From: ${x.from}\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n\r\n`, 'utf8'); parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h.length}}\r\n`), h, Buffer.from(')\r\n')); }
                    else if (what === 'UID BODYSTRUCTURE') parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} BODYSTRUCTURE ${x.bs})\r\n`));
                    else if (what === 'UID INTERNALDATE') parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}")\r\n`));
                    else if (what === 'UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)]') { const h = Buffer.from(`From: ${x.from}\r\nSubject: ${x.subject}\r\n\r\n`, 'utf8'); parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} INTERNALDATE "${x.date}" BODY[HEADER.FIELDS (FROM SUBJECT)] {${h.length}}\r\n`), h, Buffer.from(')\r\n')); }
                    else if (what === 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE)]') { const h = Buffer.from(`From: ${x.from}\r\nTo: bumiletter@naver.com\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n\r\n`, 'utf8'); parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE)] {${h.length}}\r\n`), h, Buffer.from(')\r\n')); }
                    else if ((m = /^BODY\.PEEK\[([\d.]+)\](?:<0\.(\d+)>)?$/.exec(what))) { const body = Buffer.from(x.text, 'utf8'); parts.push(Buffer.from(`* ${sq} FETCH (UID ${uid} BODY[${m[1]}]${m[2] ? '<0>' : ''} {${body.length}}\r\n`), body, Buffer.from(')\r\n')); }
                }
                return say(Buffer.concat(parts.concat([Buffer.from(`${tag} OK FETCH\r\n`)])));
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
                const sp = full.indexOf(' '); handle(full.slice(0, sp), full.slice(sp + 1), lits);
            }
        };
        sock.on = (ev, fn) => { if (ev === 'data') toClient.on('data', fn); return sock; };
        sock.end = () => { }; sock.destroy = () => { };
        setImmediate(() => toClient.emit('data', Buffer.from('* OK IMAP ready\r\n')));
        return sock;
    };
    return { cmds, imapOpenF: (o) => NM.imapOpen({ ...o, connect, timeoutMs: 20000 }) };
}
const READONLY = (c) => /^(LOGIN \*\*\*|LIST "" "\*"|EXAMINE "|UID SEARCH |UID FETCH [\d,]+ \(|LOGOUT$)/.test(c) && !/^(SELECT|STORE|UID STORE|UID MOVE|UID COPY|EXPUNGE|UID EXPUNGE|APPEND|DELETE)/.test(c);

// ── 가짜 DB ─────────────
function fakePool() {
    const cfg = new Map(), idx = new Map(), sqls = [];
    const KST0 = (ymd) => Date.parse(ymd + 'T00:00:00+09:00');
    const pool = { async query(sql, p = []) {
        sqls.push(sql);
        if (/^CREATE (TABLE|INDEX) IF NOT EXISTS mail_index/.test(sql.trim())) return { rows: [] };
        if (/SELECT value FROM agent_office_config WHERE key = \$1/.test(sql)) return { rows: cfg.has(p[0]) ? [{ value: JSON.parse(JSON.stringify(cfg.get(p[0]))) }] : [] };
        if (/INSERT INTO agent_office_config/.test(sql)) { cfg.set(p[0], JSON.parse(p[1])); return { rows: [] }; }
        if (/DELETE FROM agent_office_config WHERE key = ANY/.test(sql)) return { rows: [] };
        if (/key LIKE 'mail\\_draft\\_%'/.test(sql)) return { rows: [] };
        if (/DELETE FROM agent_office_config WHERE key = \$1 RETURNING value/.test(sql)) { const v = cfg.get(p[0]); const had = cfg.has(p[0]); cfg.delete(p[0]); return { rows: had ? [{ value: v }] : [] }; }
        if (/^INSERT INTO mail_index/.test(sql.trim())) {
            if (!/ON CONFLICT \(folder, uid\) DO UPDATE/.test(sql)) throw new Error('색인 넣기는 ON CONFLICT 갱신이어야');
            for (let i = 0; i < p.length; i += 13) { const r = { folder: p[i], folder_name: p[i + 1], uidvalidity: p[i + 2], uid: p[i + 3], from_addr: p[i + 4], from_name: p[i + 5], subject: p[i + 6], msg_date: p[i + 7], at: p[i + 8], has_attach: p[i + 9], attach_names: p[i + 10], size: p[i + 11], parsed: JSON.parse(p[i + 12]) }; idx.set(r.folder + '|' + r.uid, r); }
            return { rows: [] };
        }
        if (/^DELETE FROM mail_index WHERE folder = \$1$/.test(sql.trim())) { for (const k of [...idx.keys()]) if (idx.get(k).folder === p[0]) idx.delete(k); return { rows: [] }; }
        if (/SELECT count\(\*\)::int AS n/.test(sql)) { const all = [...idx.values()]; return { rows: [{ n: all.length, inv: all.filter(r => r.parsed.kind === 'tax_invoice').length }] }; }
        if (/^SELECT folder, folder_name, uid, EXTRACT\(EPOCH FROM at\) \* 1000 AS at FROM mail_index/.test(sql.trim())) {
            const wm = /FROM mail_index (WHERE (.*?) )?ORDER BY/.exec(sql), lim = Number((/LIMIT (\d+)/.exec(sql) || [])[1]);
            const conds = wm && wm[2] ? wm[2].split(' AND ') : [];
            const un = (s) => String(s).slice(1, -1).replace(/\\(.)/g, '$1');   // '%…%' → 안 글(이스케이프 풂)
            const test = (r) => conds.every(c => {
                let m;
                if (/ILIKE/.test(c)) { const cols = [...c.matchAll(/(\w+) ILIKE \$(\d+)/g)]; return cols.some(([, col, n]) => String(r[col] || '').toLowerCase().includes(un(p[n - 1]).toLowerCase())); }
                if ((m = /^at >= \(\$(\d+)::date::timestamp AT TIME ZONE 'Asia\/Seoul'\)$/.exec(c))) return Date.parse(r.at) >= KST0(p[m[1] - 1]);
                if ((m = /^at < \(\(\$(\d+)::date \+ 1\)::timestamp AT TIME ZONE 'Asia\/Seoul'\)$/.exec(c))) return Date.parse(r.at) < KST0(p[m[1] - 1]) + 86400e3;
                if ((m = /^\(folder = \$(\d+) OR folder_name = \$\1\)$/.exec(c))) return r.folder === p[m[1] - 1] || r.folder_name === p[m[1] - 1];
                throw new Error('모르는 조건 ' + c);
            });
            const rows = [...idx.values()].filter(test).sort((a, b) => (Date.parse(b.at) - Date.parse(a.at)) || (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0) || (b.uid - a.uid));
            return { rows: rows.slice(0, lim).map(r => ({ folder: r.folder, folder_name: r.folder_name, uid: String(r.uid), at: String(Date.parse(r.at)) })) };
        }
        throw new Error('모르는 SQL ' + sql.slice(0, 100));
    } };
    return { pool, cfg, idx, sqls };
}
const ENV = { NAVER_MAIL_USER: 'u@naver.com', NAVER_MAIL_APP_PW: 's3cret' };

(async () => {
    console.log('① 계산서 분류');
    {
        const C = (subject, from) => T.classifyMail({ subject, from_name: from.split('<')[0], from_addr: (/<([^>]+)>/.exec(from) || [])[1] || '' }, null);
        const cj = C(SUBJ.cj, '강주아 <jua.kang@cj.net>'), si = C(SUBJ.sion, '홈택스 <hometax@nts.go.kr>'), hy = C(SUBJ.hyodon, '효돈농협 <hd@nh.com>'), fc = C(SUBJ.fcc, 'CJ <jua.kang@cj.net>');
        ok(cj.kind === 'tax_invoice' && cj.supplier === 'cj', 'CJ 정발행 = 계산서 · cj', cj);
        ok(si.kind === 'tax_invoice' && si.supplier === 'sion' && si.issue_date === '2026-10-05' && si.amount === 1250000, '홈택스 제주조천점 = 시온 · 작성일자 · 금액(제목에 있을 때)', si);
        ok(hy.kind === 'tax_invoice' && hy.supplier === 'hyodon', '효돈농협유통 = hyodon', hy);
        ok(fc.kind === 'tax_invoice_other' && !fc.supplier, '공급받는자 에프씨컨슈머(F.C.C) = 다른 회사 몫(제외)', fc);
        ok(C(SUBJ.booking, '네이버 예약 <naverbooking_noreply@navercorp.com>').kind === 'booking' && C('점심 메뉴', 'a <a@x.com>').kind === 'other', '예약 메일 = booking · 그 밖 = other');
        const custom = T.classifyMail({ subject: '세금계산서 발행 (주)새거래처', from_addr: 'x@new.com' }, { suppliers: [{ key: 'new', name: '새거래처', match: ['새거래처'] }], exclude: [] });
        ok(custom.supplier === 'new', '설정 mail_invoice_suppliers 로 공급자 추가 가능', custom);
        ok(T.idxSuppliers({ suppliers: 'x' }).suppliers.length === 3 && T.idxSuppliers(null).exclude.includes('에프씨컨슈머'), '설정이 이상하면 기본 표(3곳 · F.C.C 제외)');
    }

    console.log('② 처음 채우기(1천 통씩 · 메일함별 상한) → 새 uid 만');
    const kinds = { 2590: 'cj', 2595: 'sion', 2598: 'fcc', 2599: 'hyodon', 2580: 'booking', 50: 'cj' };
    const state = { list: [['\\HasNoChildren', 'INBOX'], ['\\HasNoChildren \\Junk', 'Junk'], ['\\HasNoChildren \\Trash', 'Deleted Messages'], ['\\HasNoChildren', FOLDER_MINE]],
        box: { INBOX: makeBox(2600, 1, 0, kinds), [FOLDER_MINE]: makeBox(3000, 1, 5, {}), Junk: makeBox(5, 1, 0, {}), 'Deleted Messages': makeBox(5, 1, 0, {}) }, v: { INBOX: 7, [FOLDER_MINE]: 9 } };
    const F = fakeImap(state), D = fakePool();
    let t = Date.parse('2026-10-21T10:00:00+09:00');
    const RN = NM.mountMailRunner({ pool: D.pool, writeAudit: async () => { }, env: ENV, imapOpen: F.imapOpenF, noTimers: true, now: () => t });
    const msgs = [];
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) msgs.push(await RN.collectIndex());
    const ms5 = Date.now() - t0;
    const st = D.cfg.get('mail_index_state');
    ok(D.idx.size === 3100, '다섯 번 = 받은메일함 2,600 전부 + 다른 메일함 500(메일함별 상한 · 합 상한으로 다른 메일함이 0통 되던 것 #818)', { n: D.idx.size, msgs });
    ok(/새로 1000통 · 합 1000통.*처음 채우기 중/.test(msgs[0]) && /합 3100통/.test(msgs[3]) && !/처음 채우기 중/.test(msgs[3]) && /새로 0통/.test(msgs[4]), '한 번에 1천 통 · 넷째 회차에 「처음 채우기」 끝 · 다섯째 = 0통', msgs);
    ok(st && st.initial_done === true && st.total === 3100 && st.folders[FOLDER_MINE].n === 500 && st.folders[FOLDER_MINE].done && st.folders.INBOX.top === 2600 && st.folders.INBOX.done, '상태 = 처음 채우기 끝 · 받은메일함 맨 위 uid 기억', st && { d: st.initial_done, t: st.total, top: st.folders.INBOX.top });
    ok(D.idx.has('INBOX|2600') && D.idx.has('INBOX|1') && D.idx.has(FOLDER_MINE + '|3000') && !D.idx.has(FOLDER_MINE + '|2500') && D.idx.has(FOLDER_MINE + '|2501'), '받은메일함 먼저 전부(2,600) → 다른 메일함은 최근 것부터 500통');
    ok(![...D.idx.values()].some(r => r.folder === 'Junk' || r.folder === 'Deleted Messages'), '스팸·휴지통은 색인 안 함');
    const r2590 = D.idx.get('INBOX|2590');
    ok(r2590 && r2590.subject === SUBJ.cj && r2590.from_addr === 'jua.kang@cj.net' && r2590.from_name === '강주아' && r2590.has_attach === true && r2590.attach_names === '세금계산서_10월.pdf' && r2590.size === 3590 && r2590.parsed.kind === 'tax_invoice' && r2590.parsed.supplier === 'cj', '머리 = 제목·보낸이(이름·주소)·첨부 이름·크기 · 분류 cj', r2590);
    ok(D.idx.get('INBOX|2598').parsed.kind === 'tax_invoice_other' && D.idx.get('INBOX|2580').parsed.kind === 'booking', 'F.C.C 계산서 = 제외 꼴 · 예약 = booking');
    ok(!F.cmds.some(c => /BODY\.PEEK\[[\d.]+\]|BODY\.PEEK\[\]|RFC822\)|BODY\[\]/.test(c) && !/HEADER\.FIELDS/.test(c)), '색인은 본문을 안 받음(머리말·구조만)', F.cmds.filter(c => /BODY\.PEEK\[[\d.]/.test(c)).slice(0, 3));
    ok(F.cmds.every(READONLY), '보낸 명령 = 읽기 전용만(SELECT·STORE·MOVE·EXPUNGE 0)', F.cmds.filter(c => !READONLY(c)).slice(0, 5));
    // 새 메일 3통 → 그것만
    state.box.INBOX.push(mail(2601, 'cj', 26100), mail(2602, 'other', 26110), mail(2603, 'hyodon', 26120));
    const before = F.cmds.filter(c => /^UID FETCH/.test(c)).length;
    const m6 = await RN.collectIndex();
    const fetched = F.cmds.filter(c => /^UID FETCH/.test(c)).slice(before);
    ok(/새로 3통 · 합 3103통/.test(m6) && D.idx.has('INBOX|2603') && D.cfg.get('mail_index_state').folders.INBOX.top === 2603, '그 뒤 = 새 uid 만(3통)', m6);
    ok(fetched.length === 2 && fetched.every(c => /^UID FETCH 2601,2602,2603 /.test(c)), '새 3통만 FETCH 두 번(구조 · 머리말)', fetched);
    const m7 = await RN.collectIndex();
    ok(/새로 0통/.test(m7), '새 메일 없으면 0통', m7);

    {   // #818 되살리기 = 종전 합 5천 상한으로 받은메일함이 몫을 다 써 0통인 채 done 이 된 메일함(실DB 10곳 꼴: n 0 · bottom = top+1) → 다시 거꾸로 채움(메일함마다 500)
        const BOX2 = enc7('청구·결제');
        const sR = { list: [['\\HasNoChildren', 'INBOX'], ['\\HasNoChildren', FOLDER_MINE], ['\\HasNoChildren', BOX2], ['\\HasNoChildren \\Junk', 'Junk']],
            box: { INBOX: makeBox(100, 1, 0, {}), [FOLDER_MINE]: makeBox(800, 1, 5, {}), [BOX2]: makeBox(300, 1, 7, { 250: 'cj' }), Junk: makeBox(5, 1, 0, {}) }, v: { INBOX: 7, [FOLDER_MINE]: 9, [BOX2]: 3 } };
        const FR = fakeImap(sR), DR = fakePool();
        DR.cfg.set('mail_index_state', { total: 5000, initial_done: true, last_ok_at: new Date(t).toISOString(), folders: { INBOX: { v: 7, top: 100, bottom: 1, done: true, n: 5000 }, [FOLDER_MINE]: { v: 9, top: 700, bottom: 701, done: true, n: 0 }, [BOX2]: { v: 3, top: 300, bottom: 301, done: true, n: 0 } } });
        const RR = NM.mountMailRunner({ pool: DR.pool, writeAudit: async () => { }, env: ENV, imapOpen: FR.imapOpenF, noTimers: true, now: () => t });
        const r1 = await RR.collectIndex(), sr = DR.cfg.get('mail_index_state'), fm = sr.folders[FOLDER_MINE], fb = sr.folders[BOX2];
        const mine = [...DR.idx.values()].filter(r => r.folder === FOLDER_MINE).map(r => r.uid), b2 = [...DR.idx.values()].filter(r => r.folder === BOX2);
        ok(/새로 900통/.test(r1) && mine.length === 600 && mine.includes(800) && mine.includes(201) && !mine.includes(200) && fm.n === 500 && fm.done && fm.revived && fm.top === 800 && b2.length === 300 && fb.done && fb.n === 300 && sr.initial_done === true && ![...DR.idx.values()].some(r => r.folder === 'INBOX' || r.folder === 'Junk'),
            '되살리기 = 0통으로 닫힌 메일함만 다시 · 새 메일 100 + 거꾸로 500(상한) · 작은 메일함은 전부 300 · 받은메일함·스팸 무접촉 · 한 회차에 끝', { r1, n: mine.length, fm, fb, b2: b2.length });
        ok(b2.find(r => r.uid === 250).parsed.kind === 'tax_invoice' && b2.find(r => r.uid === 250).parsed.supplier === 'cj', '청구·결제 메일함의 CJ 정발행도 색인 → 계산서 분류 cj');
        const r2 = await RR.collectIndex();
        ok(/새로 0통/.test(r2) && DR.idx.size === 900 && FR.cmds.every(READONLY), '다음 회차 = 0통(한 번만 되살림) · 읽기 전용 명령만', r2);
        // #818 한 통 읽기 = HTML 부분의 링크(href · 글자)도 · 찾기 미리보기엔 없음
        const hm = mail(301, 'cj', 9000); hm.bs = '(("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 5 1 NIL NIL NIL)("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "7BIT" 50 1 NIL NIL NIL) "ALTERNATIVE" ("BOUNDARY" "b") NIL NIL)';
        hm.text = '<p>스마트빌 비회원 비밀번호</p><a href="https://www.smartbill.co.kr/">스마트빌</a> <a href="https://www.smartbill.co.kr/view?a=1&amp;b=2" target=_blank><b>계산서 보기</b></a> <a href="mailto:x@y.z">메일</a> <a href="https://www.smartbill.co.kr/">겹침</a>';
        sR.box[BOX2].push(hm);
        DR.cfg.set('mail_read_request', { id: 'rd1', uid: 301, folder: BOX2 }); await RR.tick();
        const rd = DR.cfg.get('mail_read_result');
        ok(rd && rd.ok && JSON.stringify(rd.mail.links) === JSON.stringify([{ href: 'https://www.smartbill.co.kr/', text: '스마트빌' }, { href: 'https://www.smartbill.co.kr/view?a=1&b=2', text: '계산서 보기' }]) && /스마트빌/.test(rd.mail.text), '읽기 = HTML 링크(http(s)만 · 겹침 1번 · &amp; 풂 · 글자) + 본문 글은 종전대로', rd);
    }

    console.log('③ UIDVALIDITY 바뀐 메일함 = 버리고 다시');
    {
        state.v[FOLDER_MINE] = 10; state.box[FOLDER_MINE] = makeBox(50, 1, 30000, {});
        const m = await RN.collectIndex(), s1 = D.cfg.get('mail_index_state');
        const mine = [...D.idx.values()].filter(r => r.folder === FOLDER_MINE);
        ok(/메일함 1곳 새로 채움/.test(m) && mine.length === 50 && mine.every(r => r.uidvalidity === 10) && s1.total === 2650 && s1.folders[FOLDER_MINE].v === 10, '옛 uid 색인 지우고 새로 50통 · 합계에서 옛 500 뺌', { m, n: mine.length, total: s1.total });
    }

    console.log('④ 찾기 = 색인 먼저');
    const search = async (req) => { t += 11000; D.cfg.set('mail_search_request', { id: 's' + t, ...req }); const c0 = F.cmds.length; await RN.tick(); return { res: D.cfg.get('mail_search_result'), cmds: F.cmds.slice(c0) }; };
    {
        let { res, cmds } = await search({ q: '대한통운', limit: 5 });
        ok(res.ok && res.index && res.found === 4 && res.mails.map(m => m.uid).join(',') === '2601,2598,2590,50' && res.mails[0].subject === SUBJ.cj, '한글 부분 일치(제목) · 최근순 · 색인 길', res);
        ok(!cmds.some(c => /^UID SEARCH (?!ALL)/.test(c)) && cmds.filter(c => /^UID FETCH \d+ \(UID BODYSTRUCTURE\)$/.test(c)).length === 4, 'IMAP 은 맞은 4통 미리보기만(글자 검색 0)', cmds.filter(c => /SEARCH|BODYSTRUCTURE/.test(c)));
        ok(res.mails[0].preview === '본문 2601' && res.mails[0].attachments.length === 1 && res.mails[0].folder === 'INBOX', '미리보기·첨부 목록은 종전 꼴 그대로');
        ({ res } = await search({ q: '세금계산서_10월' }));
        ok(res.ok && res.found >= 3 && res.mails.every(m => m.attachments.some(a => /세금계산서/.test(a.name))), '첨부 이름으로도 찾음', res && res.found);
        ({ res } = await search({ from: '강주아' }));
        ok(res.ok && res.found === 3, '보낸 사람 이름(한글)', res && res.found);
        ({ res } = await search({ q: '100%' }));
        ok(res.ok && res.found === 0, '% · _ 는 글자 그대로(전부 맞음 0)', res && res.found);
        ({ res } = await search({ subject: '일반 안내', since: '2026-01-01', until: '2026-01-01', limit: 20 }));
        ok(res.ok && res.found === 143 && res.mails.length === 20 && res.has_more && res.next, '기간(KST 하루) · 20통씩', res && { f: res.found, n: res.mails.length });
        const first = res.mails.map(m => m.uid);
        ({ res } = await search({ subject: '일반 안내', since: '2026-01-01', until: '2026-01-01', limit: 20, more: res.next }));
        ok(res.ok && res.page_from === 21 && res.mails.length === 20 && !res.mails.some(m => first.includes(m.uid)), '더보기 = 이어서(겹침 0)', res && res.page_from);
        ({ res } = await search({ q: '대한통운', folder: FOLDER_MINE }));
        ok(res.ok && res.found === 0, '메일함 고르기', res && res.found);
    }
    {   // 찾기 직전 새 메일 = 짧은 갱신으로 바로 보임
        state.box.INBOX.push(mail(2604, 'sion', 27000));
        const { res } = await search({ q: '제주조천점' });
        ok(res.ok && res.index && res.mails[0].uid === 2604, '찾기 직전 새 메일도 바로(짧은 갱신)', res && res.mails.map(m => m.uid));
    }
    {   // 낡은 색인(30분 넘음) = 종전 IMAP 길
        t += 31 * 60000;
        const { res, cmds } = await search({ q: '대한통운' });
        ok(res.ok && !res.index && cmds.some(c => /^UID SEARCH /.test(c) && !/^UID SEARCH ALL/.test(c)), '30분 넘게 안 갱신 = 종전 IMAP 찾기', { idx: res && res.index, c: cmds.filter(c => /SEARCH/.test(c)) });
    }
    {   // 처음 채우기 덜 끝남 = 종전 길
        const D2 = fakePool(), F2 = fakeImap(state);
        const RN2 = NM.mountMailRunner({ pool: D2.pool, writeAudit: async () => { }, env: ENV, imapOpen: F2.imapOpenF, noTimers: true, now: () => t });
        await RN2.collectIndex();
        D2.cfg.set('mail_search_request', { id: 'z1', q: '대한통운' }); await RN2.tick();
        ok(D2.cfg.get('mail_index_state').initial_done === false && D2.cfg.get('mail_search_result').ok && !D2.cfg.get('mail_search_result').index, '처음 채우기 중 = 종전 길(색인 안 씀)');
        const D3 = fakePool(), F3 = fakeImap(state);
        const RN3 = NM.mountMailRunner({ pool: D3.pool, writeAudit: async () => { }, env: ENV, imapOpen: F3.imapOpenF, noTimers: true, now: () => t });
        D3.cfg.set('mail_search_request', { id: 'z2', q: '대한통운' }); await RN3.tick();
        ok(D3.cfg.get('mail_search_result').ok && !D3.idx.size, '색인이 아예 없으면 = 종전 길(표 0)');
    }

    console.log('⑤ 네이버 꼴 대비(머리말이 따로 오거나 안 옴)');
    for (const o of [{ splitFetch: true }, { noHeaderBatch: true }]) {
        const s2 = { ...state, box: { INBOX: makeBox(30, 1, 0, { 30: 'cj' }) }, list: [['\\HasNoChildren', 'INBOX']], ...o };
        const D4 = fakePool(), F4 = fakeImap(s2);
        const RN4 = NM.mountMailRunner({ pool: D4.pool, writeAudit: async () => { }, env: ENV, imapOpen: F4.imapOpenF, noTimers: true, now: () => t });
        await RN4.collectIndex();
        const r = D4.idx.get('INBOX|30');
        ok(D4.idx.size === 30 && r && r.subject === SUBJ.cj && r.parsed.supplier === 'cj', JSON.stringify(o) + ' → 30통 · 제목 그대로', r && r.subject);
    }
    {   // 빈 메일함 → 뒤에 온 메일도 색인
        const s3 = { list: [['\\HasNoChildren', 'INBOX']], box: { INBOX: [] }, v: { INBOX: 1 } };
        const D5 = fakePool(), F5 = fakeImap(s3);
        const RN5 = NM.mountMailRunner({ pool: D5.pool, writeAudit: async () => { }, env: ENV, imapOpen: F5.imapOpenF, noTimers: true, now: () => t });
        await RN5.collectIndex(); s3.box.INBOX.push(mail(1, 'cj', 0), mail(2, 'other', 10)); await RN5.collectIndex();
        ok(D5.idx.size === 2, '처음엔 빈 메일함 → 그 뒤 온 2통 색인', D5.idx.size);
    }
    {   // 앞 회차가 도는 중 = 겹쳐 돌지 않음
        const D6 = fakePool(), F6 = fakeImap(state);
        const RN6 = NM.mountMailRunner({ pool: D6.pool, writeAudit: async () => { }, env: ENV, imapOpen: F6.imapOpenF, noTimers: true, now: () => t });
        const [a, b] = await Promise.all([RN6.collectIndex(), RN6.collectIndex()]);
        ok(/새로 1000통/.test(a) && /앞 회차가 아직 도는 중/.test(b), '동시 두 번 = 하나만', [a, b]);
    }
    console.log('⑥ 손질(#811-a·b·e) — 홈택스 꼴 · 묶음마다 저장 · F.C.C 판정');
    {
        const C = (subject, from_name, from_addr) => T.classifyMail({ subject, from_name, from_addr }, null);
        const s1 = C('제주아꼼이네 농업회사법인 주식회사 (제주조천점->제주아꼼이네 농업회사법인 주식회사)', '국세청 홈택스', 'hometax_noreply@nts.go.kr');
        ok(s1.kind === 'tax_invoice' && s1.supplier === 'sion', '대표 캡처 꼴 「(제주조천점->제주아꼼이네 …)」 = 계산서 · 시온(「계산서」 낱말 없어도)', s1);
        const s2 = C('제주아꼼이네 농업회사법인 주식회사 (효돈농협유통->제주아꼼이네 농업회사법인 주식회사)', '국세청', 'x@nts.go.kr');
        ok(s2.kind === 'tax_invoice' && s2.supplier === 'hyodon', '같은 꼴 효돈 = hyodon', s2);
        const s3 = C('발행 안내', '홈택스', 'noreply@hometax.go.kr');
        ok(s3.kind === 'tax_invoice' && !s3.supplier, '보낸이 홈택스 = 계산서(공급자 모르면 비움)', s3);
        const s4 = C('(제주아꼼이네 농업회사법인 주식회사->에프씨컨슈머(F.C.C))', '국세청', 'x@nts.go.kr');
        ok(s4.kind === 'tax_invoice_other', '받는 쪽 에프씨컨슈머 = 제외', s4);
        const s5 = C('[전자세금계산서] 씨제이대한통운㈜ ▶ 제주아꼼이네', '강주아', 'fccmail@cj.net');
        ok(s5.kind === 'tax_invoice' && s5.supplier === 'cj', '주소에 fcc 글자가 섞여도 제외 안 함(주소는 통째 같을 때만)', s5);
        const s6 = C('(효돈농협유통->제주조천점)', '국세청', 'x@nts.go.kr');
        ok(s6.supplier === 'hyodon', '공급자 = 화살표 앞쪽(받는 쪽 「제주조천점」으로 오인 안 함)', s6);
        ok(C('서울->제주 배송 안내', '택배', 'a@x.com').kind === 'other', '괄호 없는 화살표만 있는 제목 = 계산서 아님');
    }
    {   // 묶음마다 저장 — 3번째 묶음에서 메일 서버가 끊겨도 앞 200통은 색인·상태에 남음 → 다음 회차가 그 뒤부터
        const s4 = { list: [['\\HasNoChildren', 'INBOX']], box: { INBOX: makeBox(500, 1, 0, {}) }, v: { INBOX: 3 } };
        const D7 = fakePool(); let calls = 0; const F7 = fakeImap(s4);
        const open = (o) => Promise.resolve(F7.imapOpenF(o)).then(im => { const fi = im.fetchItems.bind(im); im.fetchItems = async (u, w) => { if (/BODYSTRUCTURE$/.test(w) && ++calls === 3) throw new Error('끊김'); return fi(u, w); }; return im; });
        const RN7 = NM.mountMailRunner({ pool: D7.pool, writeAudit: async () => { }, env: ENV, imapOpen: open, noTimers: true, now: () => t });
        let err = null; try { await RN7.collectIndex(); } catch (e) { err = e; }
        const st7 = D7.cfg.get('mail_index_state');
        ok(err && D7.idx.size === 200 && st7 && st7.folders.INBOX.bottom === 301 && st7.total === 200 && !st7.last_ok_at, '끊겨도 앞 200통 + 상태(bottom 301) 남음 · last_ok_at 은 안 찍음', { err: err && err.message, n: D7.idx.size, st: st7 && st7.folders.INBOX });
        calls = -99; const m = await RN7.collectIndex();
        ok(D7.idx.size === 500 && D7.idx.has('INBOX|1') && /새로 300통/.test(m), '다음 회차 = 남은 300통만', { n: D7.idx.size, m });
    }

    console.log('⑦ server.js — 보관 정리 mail_index 365일 · #813 로그인 만료 알림 · imap 묶음(실코드 구간을 떼어 가짜 DB 로)');
    {
        const fsx = require('fs'), SRC = fsx.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const cut = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error('구간 못 찾음 ' + a); return SRC.slice(i, j); };
        ok(/experience_place: 'imap', naver_mail_index: 'imap'/.test(SRC) && /naver_mail_index: \(\) => MAIL_RUNNER\.collectIndex\(\)/.test(SRC) && /\('naver_mail_index', false, 10\) ON CONFLICT \(key\) DO NOTHING/.test(SRC) && /naver_mail_index: '메일 색인\(#811\)'/.test(SRC), 'COLLECT_GROUP imap 묶음 · 수집기 표 · 꺼진 채 시드 · 이름표');
        const RET = cut('// ===== #579 DB 보관 정리 — 시작', '// ===== #579 DB 보관 정리 — 끝');
        const mk = (pl, store, audits) => new Function('pool', 'naverCfgGet', 'naverCfgSet', 'writeAudit', 'setInterval', 'console', RET + '\nreturn { dbRetentionCfg, dbRetentionCount, dbRetentionRunJob, dbRetentionTick, queue: () => _dbRetQueue.map(q => q.job) };')(
            pl, async k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null), async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); }, async a => { audits.push(a); }, () => ({}), { log() { }, error() { } });
        const fakeRet = (o) => { const sq = []; return { sq, query: async (sql, p) => { const s = String(sql).replace(/\s+/g, ' ').trim(); sq.push({ s, p });
            if (/to_regclass\('public\.mail_index'\)/.test(s)) return { rows: [{ ok: o.table }] };
            if (/FROM mail_index WHERE at </.test(s) && /^SELECT/.test(s)) return { rows: [{ n: o.old }] };
            if (/^DELETE FROM mail_index/.test(s)) return { rows: [], rowCount: Math.min(o.old, 5000) };
            if (/pg_database_size/.test(s)) return { rows: [{ b: 1e8 }] };
            if (/^SELECT count/.test(s)) return { rows: [{ n: 0, bytes: 0 }] };
            if (/^SELECT/.test(s)) return { rows: [] };
            throw new Error('보관 정리 가짜 DB: 모르는 문장 ' + s.slice(0, 80)); } }; };
        const R0 = mk(fakeRet({ table: false, old: 0 }), {}, []);
        ok(R0.dbRetentionCfg({}).mail_days === 365 && R0.dbRetentionCfg({ mail_days: 30 }).mail_days === 365 && (await R0.dbRetentionCount(R0.dbRetentionCfg({}))).mail === 0, '기본 365일 · 180 밑은 기본값 · 표 없으면 0');
        const P1 = fakeRet({ table: true, old: 7 }), st = { db_retention: { enabled: true } }, au = [], R1 = mk(P1, st, au);
        const AT = Date.parse('2026-10-22T03:41:00+09:00');
        const c1 = await R1.dbRetentionTick(AT);
        ok(c1 && c1.targets.mail === 7 && c1.queued.includes('mail') && st.db_retention_last.days.mail === 365, '켜져 있으면 대상 7줄 → 「mail」 일감', c1 && c1.queued);
        while (R1.queue().length && R1.queue()[0] !== 'mail') await R1.dbRetentionTick(AT + 60000);
        await R1.dbRetentionTick(AT + 120000);
        const del = P1.sq.find(x => /^DELETE FROM mail_index/.test(x.s));
        ok(del && /make_interval\(days => \$1::int\) ORDER BY id LIMIT 5000\)$/.test(del.s) && del.p[0] === 365 && au.some(a => a.changes.after.job === 'mail' && a.changes.after.days === 365 && a.changes.after.rows === 7), '지우기 = 365일 지난 것 5천 줄씩 · 감사 기록', del && del.s);
        const P2 = fakeRet({ table: true, old: 7 }), R2 = mk(P2, { db_retention: { enabled: false } }, []);
        const c2 = await R2.dbRetentionTick(AT);
        ok(c2 && c2.targets.mail === 7 && !c2.queued.length && (await R2.dbRetentionRunJob('mail', R2.dbRetentionCfg({}))) === 0 && !P2.sq.some(x => /^DELETE/.test(x.s)), '꺼져 있으면 세기만(지우기 0)');
        const L813 = cut('// ── #813 창구 로그인 만료 알림 시작', '// ── #813 창구 로그인 만료 알림 끝');
        const mk813 = (store, tg) => new Function('naverCfgGet', 'naverCfgSet', 'notifyTelegram', 'setInterval', 'console', L813 + '\nreturn deskLoginExpiredTick;')(
            async k => { if (store.__fail) throw new Error('연결 지연'); return k in store ? JSON.parse(JSON.stringify(store[k])) : null; }, async (k, v) => { store[k] = v; }, async (x) => { tg.push(x); }, () => ({}), { error() { } });
        const tg = [], s0 = {}; ok((await mk813(s0, tg)()) === 0 && !tg.length, '#813 값 없음 = 알림 0');
        const s1 = { desk_login_expired: { at: 'x', done: false, notified: false, todo_n: 2 } }, f1 = mk813(s1, tg);
        ok((await f1()) === 1 && tg.length === 1 && /로그인 만료/.test(tg[0]) && s1.desk_login_expired.notified === true && s1.desk_login_expired.notified_at && s1.desk_login_expired.todo_n === 2, '#813 있음 = 텔레그램 1번 + notified true(다른 칸 그대로)');
        ok((await f1()) === 0 && tg.length === 1, '#813 다음 분 = 다시 안 보냄');
        ok((await mk813({ desk_login_expired: { done: true } }, tg)()) === 0 && (await mk813({ __fail: true }, tg)()) === 0 && tg.length === 1, '#813 done = 0 · 읽기 실패 = 0(로그만)');
    }
    console.log(`\n  (가짜 IMAP 기준 처음 5천 통 = ${ms5}ms)`);
    console.log(`\n결과 ${pass}/${pass + failN}`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('중단:', e); process.exit(2); });

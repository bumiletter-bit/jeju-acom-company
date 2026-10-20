// #776 네이버 메일(bumiletter@naver.com) — 찾기·읽기·첨부는 읽기 전용 · #779 보내기·이동·휴지통(아래) — #775 experience.js 의 IMAP·MIME 를 떼어 내 둘이 같이 씀(experience.js 동작 무회귀)
//   쓰기 명령 0: LOGIN · EXAMINE(읽기 전용 열기 · 읽음 표시 안 바뀜) · LIST · UID SEARCH · UID FETCH(BODY.PEEK·BODYSTRUCTURE·INTERNALDATE) · STATUS · LOGOUT 만
//   메일 찾기 러너(창구 scripts/desk/mail-find.js · 토큰 없음 · 요청 줄 → 결과 줄):
//     agent_office_config 'mail_search_request' {id, q?, from?, subject?, since?, until?(YYYY-MM-DD), folder?, limit≤20, more?(#778 커서)} → 'mail_search_result'(has_more · next 커서)
//     'mail_read_request' {id, uid, folder} → 'mail_read_result'(본문 글 최대 5천 자 + 첨부 목록)
//     'mail_attach_request' {id, uid, folder, part} → 'mail_attach_result'(report_files 행 id · 10MB 상한)
//   #779 쓰기(지시 번호 필수 · 누가 시켰는지 기록): 'mail_move_request' {id, order_id, uids[], folder, to_folder, dry?} · 'mail_trash_request'(관리자만) {id, order_id, uids[], folder, dry?}
//        · 'mail_send_request' {id, order_id, draft_id}(초안 = 창구가 'mail_draft_<id>' 에 만든 것만 · 30분 · 한 번) → 'mail_*_result' · 🔴 영구 삭제 코드 없음
//   비밀값(Render env NAVER_MAIL_USER / NAVER_MAIL_APP_PW)은 서버만 · 오류 글에서도 가림 · 검색 10초 간격 · 한 번에 하나
const tls = require('tls');
const crypto = require('crypto');

// ── 아주 작은 IMAP 읽기 전용 클라이언트(내장 tls · LOGIN/EXAMINE/LIST/UID SEARCH/UID FETCH/STATUS/LOGOUT 만 · 쓰기 명령 없음) ──
function imapOpen({ host, port, user, pass, timeoutMs, connect }) {   // connect = 검증용 가짜 소켓(없으면 tls)
    return new Promise((resolve, reject) => {
        const sock = (connect || tls.connect)({ host, port, servername: host });
        let buf = Buffer.alloc(0), tagN = 0, cur = null, need = 0, parts = [], greeted = false, closed = false;
        const pending = [];
        const timer = setTimeout(() => { fail(new Error('IMAP 시간 초과')); }, timeoutMs || 30000);
        const fail = (e) => { if (closed) return; closed = true; clearTimeout(timer); try { sock.destroy(); } catch (_) { } if (!greeted) reject(e); while (pending.length) pending.shift().reject(e); };
        const onResp = (resp) => {   // resp = { text, literals[] }
            if (!greeted) { greeted = true; if (/^\* (OK|PREAUTH)/i.test(resp.text)) resolve(api); else fail(new Error('IMAP 인사 실패')); return; }
            if (/^\+/.test(resp.text)) { const pc = pending[0]; if (pc && pc.conts && pc.conts.length) sock.write(pc.conts.shift()); return; }   // #776 리터럴 이어 보내기
            const p = pending[0]; if (!p) return;
            const m = new RegExp('^' + p.tag + ' (OK|NO|BAD)', 'i').exec(resp.text);
            if (m) { pending.shift(); if (m[1].toUpperCase() === 'OK') p.resolve(p.items); else p.reject(new Error('IMAP ' + m[1] + ' ' + resp.text.slice(p.tag.length + 1, p.tag.length + 80).replace(/[^\x20-\x7e]/g, ''))); }
            else p.items.push(resp);
        };
        sock.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            for (;;) {
                if (need > 0) { if (buf.length < need) return; parts.push({ lit: buf.slice(0, need) }); buf = buf.slice(need); need = 0; continue; }
                const i = buf.indexOf('\r\n'); if (i < 0) return;
                const line = buf.slice(0, i).toString('utf8'); buf = buf.slice(i + 2);
                const lm = /\{(\d+)\}$/.exec(line);
                parts.push({ text: line });
                if (lm) { need = +lm[1]; if (need === 0) continue; continue; }
                const resp = { text: parts.filter(x => x.text != null).map(x => x.text).join(''), literals: parts.filter(x => x.lit).map(x => x.lit), seq: parts };   // #776 seq = 조각 순서
                parts = []; onResp(resp);
            }
        });
        sock.on('error', fail);
        sock.on('close', () => fail(new Error('IMAP 연결 끊김')));
        const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const cmd = (c) => new Promise((res, rej) => { if (closed) return rej(new Error('IMAP 닫힘')); const tag = 'X' + (++tagN); pending.push({ tag, items: [], resolve: res, reject: rej }); sock.write(tag + ' ' + c + '\r\n'); });
        // #776 리터럴이 든 명령: pieces = 글 | Buffer(→ {n} 뒤 서버의 「+」를 기다려 이어 보냄)
        const cmdParts = (pieces) => new Promise((res, rej) => {
            if (closed) return rej(new Error('IMAP 닫힘'));
            const tag = 'X' + (++tagN), chunks = []; let cur = Buffer.from(tag + ' ');
            for (const p of pieces) { if (Buffer.isBuffer(p)) { chunks.push(Buffer.concat([cur, Buffer.from('{' + p.length + '}\r\n')])); cur = p; } else cur = Buffer.concat([cur, Buffer.from(String(p))]); }
            chunks.push(Buffer.concat([cur, Buffer.from('\r\n')]));
            pending.push({ tag, items: [], resolve: res, reject: rej, conts: chunks.slice(1) }); sock.write(chunks[0]);
        });
        const searchOut = (items) => { const ln = items.map(x => x.text).find(t => /^\* SEARCH/i.test(t)) || ''; return ln.replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number); };
        const api = {
            login: () => cmd('LOGIN ' + q(user) + ' ' + q(pass)),
            examine: (box) => cmd('EXAMINE ' + q(box || 'INBOX')),   // 읽기 전용 열기(\Seen 등 깃발이 안 바뀜)
            select: (box) => cmd('SELECT ' + q(box || 'INBOX')),     // #779 이동·휴지통 때만(UID MOVE 는 SELECT 한 메일함에서만 됨) · 찾기·읽기는 EXAMINE 그대로
            capability: async () => { const items = await cmd('CAPABILITY'); const ln = items.map(x => x.text).find(t => /^\* CAPABILITY/i.test(t)) || ''; return ln.replace(/^\* CAPABILITY/i, '').trim().toUpperCase().split(/\s+/).filter(Boolean); },   // #779
            uidMove: (uidset, box) => cmd('UID MOVE ' + uidset + ' ' + q(box)),   // #779 RFC 6851 · 영구 삭제(EXPUNGE·STORE \\Deleted) 명령은 이 클라이언트에 없음
            search: async (crit) => { const items = await cmd('UID SEARCH ' + crit); const ln = items.map(x => x.text).find(t => /^\* SEARCH/i.test(t)) || ''; return ln.replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number); },
            fetch: async (uid, what) => { const items = await cmd('UID FETCH ' + uid + ' (' + what + ')'); const it = items.find(x => x.literals && x.literals.length); return it ? it.literals[0] : null; },   // what = BODY.PEEK[…] 만 넘긴다
            status: async (box) => { const items = await cmd('STATUS ' + q(box || 'INBOX') + ' (MESSAGES)'); const ln = items.map(x => x.text).find(t => /MESSAGES/i.test(t)) || ''; const m = /MESSAGES (\d+)/i.exec(ln); return m ? +m[1] : null; },
            list: async () => { const items = await cmd('LIST "" "*"'); return items.filter(x => /^\* LIST /i.test(x.text)).map(listLine).filter(Boolean); },   // #776 폴더 목록
            searchParts: async (pieces) => searchOut(await cmdParts(['UID SEARCH '].concat(pieces))),   // #776 한글 검색어 = 리터럴
            fetchItems: async (uidset, what) => (await cmd('UID FETCH ' + uidset + ' (' + what + ')')).filter(x => /^\* \d+ FETCH/i.test(x.text)),   // #776 여러 통(INTERNALDATE·BODYSTRUCTURE)
            close: async () => { try { await cmd('LOGOUT'); } catch (_) { } closed = true; clearTimeout(timer); try { sock.end(); } catch (_) { } },
        };
    });
}
const imapDate = (ms) => { const d = new Date(ms); return d.getUTCDate() + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + '-' + d.getUTCFullYear(); };
const imapFromCrit = (terms) => { const t = terms.map(x => 'FROM "' + String(x).replace(/["\\]/g, '') + '"'); if (!t.length) return 'ALL'; let c = t[t.length - 1]; for (let i = t.length - 2; i >= 0; i--) c = 'OR ' + t[i] + ' ' + c; return c; };

// ── MIME(메일 원문) → { subject, from, date, messageId, text } ─────────────
function decodeCharset(buf, cs) {
    const c = String(cs || 'utf-8').toLowerCase().replace(/^ks_c_5601-1987$|^cp949$|^x-windows-949$/, 'euc-kr');
    try { return new TextDecoder(c).decode(buf); } catch (_) { return buf.toString('utf8'); }
}
function decodeWords(s) {
    return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
        try { const b = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); return decodeCharset(b, cs); } catch (_) { return m; }
    });
}
function splitHead(raw) {
    const i = raw.indexOf('\r\n\r\n'), j = raw.indexOf('\n\n');
    const k = i >= 0 && (j < 0 || i <= j) ? i : j; const sep = k === i ? 4 : 2;
    if (k < 0) return { head: raw, body: '' };
    return { head: raw.slice(0, k), body: raw.slice(k + sep) };
}
function headers(head) {
    // 머리말에 인코딩 없이 UTF-8 바이트가 그대로 든 메일(라틴1 로 읽힌 글자) → UTF-8 로 다시 읽음(ASCII 만이면 그대로)
    if (/[\x80-\xff]/.test(head)) { const u = Buffer.from(head, 'latin1').toString('utf8'); if (!u.includes('�')) head = u; }
    const h = {}; for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = line.slice(i + 1).trim(); } }
    return h;
}
const param = (v, name) => { const m = new RegExp(name + '\\s*=\\s*"?([^";]+)"?', 'i').exec(String(v || '')); return m ? m[1] : null; };
function decodeBody(bodyLatin, h) {
    const te = String(h['content-transfer-encoding'] || '').toLowerCase();
    let b;
    if (te === 'base64') b = Buffer.from(bodyLatin.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    else if (te === 'quoted-printable') b = Buffer.from(bodyLatin.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (x, hx) => String.fromCharCode(parseInt(hx, 16))), 'latin1');
    else b = Buffer.from(bodyLatin, 'latin1');
    return decodeCharset(b, param(h['content-type'], 'charset'));
}
const htmlText = (s) => String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
function mimeText(latin, h, depth) {
    const ct = String(h['content-type'] || 'text/plain').toLowerCase();
    if (ct.startsWith('multipart/') && depth < 6) {
        const bd = param(h['content-type'], 'boundary'); if (!bd) return { plain: '', html: '' };
        const chunks = latin.split('--' + bd).slice(1).filter(c => !/^--/.test(c));
        let plain = '', html = '';
        for (const c of chunks) { const p = splitHead(c.replace(/^\r?\n/, '')); const r = mimeText(p.body, headers(p.head), depth + 1); if (!plain && r.plain) plain = r.plain; if (!html && r.html) html = r.html; }
        return { plain, html };
    }
    if (ct.startsWith('text/html')) return { plain: '', html: decodeBody(latin, h) };
    if (ct.startsWith('text/')) return { plain: decodeBody(latin, h), html: '' };
    return { plain: '', html: '' };
}
function parseMail(rawBuf) {
    const latin = Buffer.isBuffer(rawBuf) ? rawBuf.toString('latin1') : String(rawBuf || '');
    const p = splitHead(latin), h = headers(p.head);
    const r = mimeText(p.body, h, 0);
    const text = (r.plain && r.plain.trim()) ? r.plain.replace(/\r/g, '') : htmlText(r.html || '');
    return { subject: decodeWords(h.subject || ''), from: decodeWords(h.from || ''), date: h.date || '', messageId: (h['message-id'] || '').replace(/[<>\s]/g, '').slice(0, 200), text: text.slice(0, 20000) };
}
const fromAddr = (f) => { const m = /<([^>]+)>/.exec(String(f || '')) || /([^\s<>"]+@[^\s<>"]+)/.exec(String(f || '')); return m ? m[1].toLowerCase() : ''; };

// ════════ #776 메일 찾기(읽기 전용) ════════
// LIST 한 줄 → { raw(EXAMINE 에 쓰는 이름), name(사람 말), flags } · 이름은 따옴표·글자 그대로·리터럴 셋 다
function listLine(x) {
    const m = /^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*") ?(.*)$/i.exec(x.text || '');
    if (!m) return null;
    let raw = m[3].trim();
    if (/^\{\d+\}$/.test(raw) && x.literals && x.literals.length) raw = x.literals[0].toString('utf8');
    else if (/^".*"$/.test(raw)) raw = raw.slice(1, -1).replace(/\\(.)/g, '$1');
    if (!raw) return null;
    return { raw, name: mutf7(raw), flags: m[1].split(/\s+/).filter(Boolean).map(f => f.toLowerCase()) };
}
// IMAP 폴더 이름(수정된 UTF-7 · RFC 3501) → 글자
function mutf7(s) {
    return String(s).replace(/&([^-]*)-/g, (m, b64) => {
        if (b64 === '') return '&';
        try { const bb = Buffer.from(b64.replace(/,/g, '/'), 'base64'); const sw = Buffer.alloc(bb.length - (bb.length % 2)); for (let i = 0; i + 1 < bb.length; i += 2) { sw[i] = bb[i + 1]; sw[i + 1] = bb[i]; } return sw.toString('utf16le'); } catch (_) { return m; }
    });
}
// 받은메일함 + 내 메일함들(스팸·휴지통·보낸·임시 보관은 뺌 · 선택 못 하는 칸 뺌 · 30개까지)
const MAIL_SKIP_FLAGS = ['\\noselect', '\\nonexistent', '\\junk', '\\trash', '\\sent', '\\drafts', '\\spam'];
const MAIL_SKIP_NAME = /^(spam|junk|trash|deleted( messages)?|sent( messages)?|drafts?)$|스팸|휴지통|보낸\s*메일|임시\s*보관|내게\s*쓴/i;
function pickFolders(list) {
    const all = (list || []).filter(f => f && f.raw && !f.flags.some(x => MAIL_SKIP_FLAGS.includes(x)));
    const inbox = all.find(f => /^inbox$/i.test(f.raw));
    const mine = all.filter(f => f !== inbox && !MAIL_SKIP_NAME.test(f.name.split(/[/.]/).pop()) && !MAIL_SKIP_NAME.test(f.name));
    return (inbox ? [inbox] : [{ raw: 'INBOX', name: '받은메일함', flags: [] }]).concat(mine).slice(0, 30).map(f => ({ raw: f.raw, name: /^inbox$/i.test(f.raw) ? '받은메일함' : f.name }));
}
// IMAP 괄호 목록(응답 조각 seq — 리터럴은 제자리 글로) → 중첩 배열 · NIL = null · 숫자 = number
function sexp(seq) {
    const toks = [];
    const lex = (t) => {
        for (let i = 0; i < t.length;) {
            const c = t[i];
            if (c === '(' || c === ')') { toks.push(c); i++; continue; }
            if (c === ' ' || c === '\t') { i++; continue; }
            if (c === '"') { let s = '', j = i + 1; for (; j < t.length && t[j] !== '"'; j++) { if (t[j] === '\\' && j + 1 < t.length) j++; s += t[j]; } toks.push({ s }); i = j + 1; continue; }
            let j = i; while (j < t.length && !/[\s()"]/.test(t[j])) j++;
            toks.push({ a: t.slice(i, j) }); i = j;
        }
    };
    for (const p of (seq || [])) {
        if (p.lit) { toks.push({ s: p.lit.toString('utf8') }); continue; }
        let t = String(p.text || ''); const lm = /\{\d+\}$/.exec(t); if (lm) t = t.slice(0, lm.index); lex(t);
    }
    let k = 0;
    const one = () => {
        const t = toks[k++];
        if (t === '(') { const arr = []; while (k < toks.length && toks[k] !== ')') arr.push(one()); k++; return arr; }
        if (t === ')' || t == null) return null;
        if (t.s != null) return t.s;
        if (/^nil$/i.test(t.a)) return null;
        if (/^\d+$/.test(t.a)) return Number(t.a);
        return t.a;
    };
    const out = []; while (k < toks.length) out.push(one());
    return out;
}
// FETCH 한 줄 → { 칸 이름: 값 }(UID · INTERNALDATE · BODYSTRUCTURE …)
function fetchFields(item) {
    const top = sexp(item.seq || [{ text: item.text }]);
    const list = top.find(x => Array.isArray(x)) || [];
    const o = {}; for (let i = 0; i + 1 < list.length; i += 2) if (typeof list[i] === 'string') o[list[i].toUpperCase()] = list[i + 1];
    return o;
}
const kvList = (arr) => { const o = {}; if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) if (typeof arr[i] === 'string') o[arr[i].toLowerCase()] = arr[i + 1]; return o; };
// 첨부 이름: RFC 2231(filename*=utf-8''… · 이어진 조각 *0* *1*) · RFC 2047(=?utf-8?B?…?=) · 그대로
function partName(p) {
    const pieces = Object.keys(p).filter(k => /^(filename|name)\*\d+\*?$/.test(k));
    const pick = (base) => {
        const ks = pieces.filter(k => k.startsWith(base + '*')).sort((x, y) => parseInt(x.split('*')[1], 10) - parseInt(y.split('*')[1], 10));
        if (ks.length) { const joined = ks.map(k => String(p[k])).join(''); return rfc2231(ks[0].endsWith('*') ? joined : joined, ks[0].endsWith('*')); }
        if (p[base + '*'] != null) return rfc2231(String(p[base + '*']), true);
        if (p[base] != null) return decodeWords(String(p[base]));
        return null;
    };
    return pick('filename') || pick('name');
}
function rfc2231(v, encoded) {
    if (!encoded) return decodeWords(v);
    const m = /^([^']*)'[^']*'([\s\S]*)$/.exec(v); const cs = m ? m[1] : 'utf-8', body = m ? m[2] : v;
    try { const bytes = Buffer.from(body.replace(/%([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); return decodeCharset(bytes, cs || 'utf-8'); } catch (_) { return v; }
}
// BODYSTRUCTURE → 잎 목록 [{ part, type, enc, size, charset, name, disp }] · 번호 = IMAP 부분 번호(1 · 1.2 …)
function bodyParts(node, prefix, out) {
    out = out || [];
    if (!Array.isArray(node)) return out;
    if (Array.isArray(node[0])) { for (let i = 0; i < node.length && Array.isArray(node[i]); i++) bodyParts(node[i], prefix ? prefix + '.' + (i + 1) : String(i + 1), out); return out; }
    const type = (String(node[0] || '').toLowerCase() + '/' + String(node[1] || '').toLowerCase());
    const params = kvList(node[2]);
    let disp = null;
    for (let k = 7; k < node.length; k++) { const x = node[k]; if (Array.isArray(x) && typeof x[0] === 'string' && /^(attachment|inline)$/i.test(x[0])) { disp = { type: x[0].toLowerCase(), params: kvList(x[1]) }; break; } }
    const name = (disp && partName(disp.params)) || partName(params) || null;
    out.push({ part: prefix || '1', type, enc: String(node[5] || '7bit').toLowerCase(), size: Number(node[6]) || 0, charset: params.charset ? String(params.charset) : null, name, disp: disp ? disp.type : null });
    return out;
}
const isAttach = (p) => p.type === 'message/rfc822' || p.disp === 'attachment' || (!!p.name && !/^text\/(plain|html)$/.test(p.type)) || (!!p.name && p.disp !== 'inline');
const attachList = (parts) => parts.filter(isAttach).map(p => ({ part: p.part, name: p.name || (p.type === 'message/rfc822' ? '첨부 메일.eml' : '(이름 없음)'), type: p.type, size: Math.round(p.enc === 'base64' ? p.size * 0.75 : p.size) }));
const textPart = (parts) => parts.find(p => p.type === 'text/plain' && !isAttach(p)) || parts.find(p => p.type === 'text/html' && !isAttach(p)) || null;
// 부분 원문(라틴1) → 글 · base64 는 잘린 끝(4의 배수 밖)을 버림
function partText(latin, p) {
    let body = String(latin || '');
    if (p.enc === 'base64') { const clean = body.replace(/[^A-Za-z0-9+/=]/g, ''); body = clean.slice(0, clean.length - (clean.length % 4)); }
    const h = { 'content-transfer-encoding': p.enc, 'content-type': p.type + (p.charset ? '; charset=' + p.charset : '') };
    const t = decodeBody(body, h);
    return (p.type === 'text/html' ? htmlText(t) : t.replace(/\r/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
function partBytes(latin, p) {
    const s = String(latin || '');
    if (p.enc === 'base64') return Buffer.from(s.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    if (p.enc === 'quoted-printable') return Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (x, hx) => String.fromCharCode(parseInt(hx, 16))), 'latin1');
    return Buffer.from(s, 'latin1');
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymdImap = (ymd, plusDays) => { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + (plusDays || 0))); return d.getUTCDate() + '-' + MON[d.getUTCMonth()] + '-' + d.getUTCFullYear(); };
// 검색 조건(조각) — 글자 칸은 리터럴(한글 그대로 · CHARSET UTF-8) · 날짜 = SINCE / BEFORE(그날 포함 = 다음 날 전)
function searchPieces(o) {
    const ps = [], txt = [];
    const lit = (key, v) => { txt.push(key + ' ', Buffer.from(String(v), 'utf8'), ' '); };
    if (o.q) lit('TEXT', o.q);
    if (o.from) lit('FROM', o.from);
    if (o.subject) lit('SUBJECT', o.subject);
    const nonAscii = [o.q, o.from, o.subject].some(v => v && /[^\x20-\x7e]/.test(String(v)));
    if (nonAscii) ps.push('CHARSET UTF-8 ');
    ps.push(...txt);
    if (o.since) ps.push('SINCE ' + ymdImap(o.since) + ' ');
    if (o.until) ps.push('BEFORE ' + ymdImap(o.until, 1) + ' ');
    if (!txt.length && !o.since && !o.until) ps.push('ALL ');
    const last = ps.length - 1; if (typeof ps[last] === 'string') ps[last] = ps[last].replace(/\s+$/, ''); else ps.push('');
    return ps;
}
const MAIL_SCAN_PER_FOLDER = 500, MAIL_SCAN_TOTAL = 2000;   // 한글 대비 길: 메일함마다 최근 500통 · 합 2천 통까지 제목·보낸 사람 대조
const MAIL_DATE_PER_FOLDER = 1000, MAIL_DATE_TOTAL = 3000;   // #778 최근순 줄 세우기: 메일함마다 맞는 메일 최근 1천 통 · 합 3천 통의 받은 시각까지(넘으면 limited = 기간을 좁혀 달라는 안내)
// #778 메일함을 합친 최근순 = 받은 시각 내림 → 메일함 이름 → uid 내림(같은 시각도 순서가 하나로 정해짐) · byRecent(x, y) > 0 = x 가 y 보다 뒤(오래됨)
const byRecent = (x, y) => (y.at - x.at) || (String(x.f.raw) < String(y.f.raw) ? -1 : String(x.f.raw) > String(y.f.raw) ? 1 : 0) || (y.uid - x.uid);
// 더보기 커서 = 마지막으로 보여 준 메일의 { 받은 시각 · 메일함 · uid } + 지금까지 보여 준 수(n) · base64url JSON(서버만 풂)
const encodeCursor = (c) => Buffer.from(JSON.stringify({ a: c.at, f: c.folder, u: c.uid, n: c.n }), 'utf8').toString('base64url');
function decodeCursor(t) {
    try { const j = JSON.parse(Buffer.from(String(t), 'base64url').toString('utf8')); if (!Number.isFinite(j.a) || typeof j.f !== 'string' || !Number.isInteger(j.u) || j.u <= 0) return null; return { at: j.a, folder: j.f, uid: j.u, n: Number.isInteger(j.n) && j.n >= 0 ? j.n : 0 }; } catch (_) { return null; }
}
const MAIL_LIMIT_MAX = 20, MAIL_COOLDOWN_MS = 10000, MAIL_TEXT_MAX = 5000, MAIL_PREVIEW = 300, MAIL_ATTACH_MAX = 10 * 1024 * 1024;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
function checkReq(op, r) {
    if (!r || typeof r !== 'object') return '요청이 비었어요';
    const str = (k, n) => r[k] == null || (typeof r[k] === 'string' && r[k].length <= n);
    if (op === 'search') {
        if (!str('q', 100) || !str('from', 100) || !str('subject', 100) || !str('folder', 200)) return '검색어·보낸 사람·제목은 100자까지 글';
        for (const k of ['since', 'until']) if (r[k] != null && !YMD.test(String(r[k]))) return `${k} 는 YYYY-MM-DD`;
        if (!r.q && !r.from && !r.subject && !r.since && !r.until) return '검색어·보낸 사람·제목·날짜 중 하나는 주세요';
        if (r.limit != null && !(Number.isInteger(r.limit) && r.limit >= 1 && r.limit <= MAIL_LIMIT_MAX)) return `limit 은 1~${MAIL_LIMIT_MAX}`;
        if (r.more != null && !(typeof r.more === 'string' && r.more.length <= 400 && decodeCursor(r.more))) return '더보기 커서가 이상해요 — 처음 찾기부터 다시';   // #778
        return null;
    }
    if (op === 'move' || op === 'trash') {   // #779
        if (!Array.isArray(r.uids) || !r.uids.length || r.uids.length > MAIL_MOVE_MAX || r.uids.some(u => !Number.isInteger(u) || u <= 0)) return `uids 는 숫자 1~${MAIL_MOVE_MAX}개`;
        if (r.folder != null && !str('folder', 200)) return 'folder 는 찾기 결과의 folder 글';
        if (op === 'move' && !(typeof r.to_folder === 'string' && r.to_folder && r.to_folder.length <= 200)) return 'to_folder(옮길 메일함)를 주세요';
        return null;
    }
    if (op === 'send') return /^[a-z0-9]{6,20}$/.test(String(r.draft_id || '')) ? null : '보내기는 초안 id 로만(창구 draft → 「고」 → send <초안 id>)';
    if (!Number.isInteger(r.uid) || r.uid <= 0) return 'uid 는 숫자(찾기 결과의 uid)';
    if (r.folder != null && !str('folder', 200)) return 'folder 는 찾기 결과의 folder 글';
    if (op === 'attach' && !/^\d+(\.\d+){0,9}$/.test(String(r.part || ''))) return 'part 는 찾기·읽기 결과 첨부 목록의 part(예: 2 · 1.2)';
    return null;
}
async function describeMail(im, uid, textMax) {
    const st = (await im.fetchItems(uid, 'UID BODYSTRUCTURE'))[0];
    if (!st) return null;
    const parts = bodyParts(fetchFields(st).BODYSTRUCTURE, '', []);
    const hdrBuf = await im.fetch(uid, 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE)]');
    const hh = headers(hdrBuf ? hdrBuf.toString('latin1') : '');
    const tp = textPart(parts);
    let text = '';
    if (tp) { const want = Math.min(Math.max(textMax * 4, 4096), 200000); const raw = await im.fetch(uid, `BODY.PEEK[${tp.part}]<0.${want}>`); text = partText(raw ? raw.toString('latin1') : '', tp); }
    return { uid, date: hh.date || null, from: decodeWords(hh.from || ''), to: decodeWords(hh.to || ''), cc: decodeWords(hh.cc || '') || undefined, subject: decodeWords(hh.subject || ''),
        text: text.slice(0, textMax), text_cut: text.length > textMax, attachments: attachList(parts) };
}
// 러너 본체(가짜 IMAP 으로 검증 · deps = { imapOpen?, now? })
function makeMailOps(creds, deps) {
    deps = deps || {};
    async function withImap(fn) {
        const { user, pass } = creds();
        if (!user || !pass) { const e = new Error('메일 설정 없음(NAVER_MAIL_USER/NAVER_MAIL_APP_PW)'); e.noCreds = true; throw e; }
        const hide = (e) => { const x = new Error(String(e && e.message || e).split(pass).join('(비밀값)').split(user).join('(메일 계정)').slice(0, 200)); if (e && e.user) x.user = true; return x; };   // 사람 몫 안내(e.user)는 그대로 전함
        let im;
        // timeoutMs = 한 번 접속의 전체 상한(한글 대비 길 2천 통 머리말 포함)
        try { im = await (deps.imapOpen || imapOpen)({ host: 'imap.naver.com', port: 993, user, pass, timeoutMs: 120000 }); } catch (e) { throw hide(e); }
        try { await im.login(); return await fn(im); } catch (e) { throw hide(e); } finally { await im.close(); }
    }
    async function folderOf(im, want) {
        const fs0 = pickFolders(await im.list());
        if (want == null || want === '') return fs0;
        const f = fs0.find(x => x.raw === want || x.name === want);
        if (!f) { const e = new Error('그 메일함이 없어요(스팸·휴지통·보낸 메일함은 안 봐요): ' + String(want).slice(0, 40)); e.user = true; throw e; }
        return [f];
    }
    async function search(r) {
        const limit = r.limit || 10, cur = r.more ? decodeCursor(r.more) : null;
        if (r.more && !cur) { const e = new Error('더보기 커서가 이상해요 — 처음 찾기부터 다시'); e.user = true; throw e; }
        return withImap(async (im) => {
            const folders = await folderOf(im, r.folder), pieces = searchPieces(r), cands = []; let found = 0, limited = false, dated = 0;
            // 메일함마다 맞는 uid 전부 → 최근 MAIL_DATE_PER_FOLDER 통(합 MAIL_DATE_TOTAL)의 받은 시각 → 메일함을 합친 최근순 · 더보기 = 같은 순서에서 커서 다음
            for (const f of folders) {
                await im.examine(f.raw);
                const uids = await im.searchParts(pieces); found += uids.length;
                const room = Math.min(MAIL_DATE_PER_FOLDER, MAIL_DATE_TOTAL - dated); if (room <= 0) { if (uids.length) limited = true; continue; }
                const tail = uids.slice(-room); if (tail.length < uids.length) limited = true; dated += tail.length;
                for (let i = 0; i < tail.length; i += 500) for (const it of await im.fetchItems(tail.slice(i, i + 500).join(','), 'UID INTERNALDATE')) { const o = fetchFields(it); if (o.UID) cands.push({ f, uid: Number(o.UID), at: Date.parse(String(o.INTERNALDATE || '')) || 0 }); }
            }
            // 한글 낱말 대비 길(10/20 실메일 실측: 네이버 IMAP 은 CHARSET UTF-8 한글 검색을 OK 로 받고 늘 0통 → 「예약」으로 [네이버 예약] 제목도 못 찾음)
            //   한글 낱말이 있고 0통이면 = 날짜·영문 조건으로만 서버 검색 → 메일함마다 최근 MAIL_SCAN_PER_FOLDER 통의 제목·보낸 사람을 여기서 대조(본문 안 낱말은 못 찾음) · 더보기도 같은 커서
            let scan = null;
            const ko = (v) => v && /[^\x20-\x7e]/.test(String(v));
            if (!found && [r.q, r.from, r.subject].some(ko)) {
                const asc = (v) => (v && !ko(v) ? v : null), base = searchPieces({ q: asc(r.q), from: asc(r.from), subject: asc(r.subject), since: r.since, until: r.until });
                const nf = (x) => String(x || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
                const want = { q: ko(r.q) ? nf(r.q) : null, from: ko(r.from) ? nf(r.from) : null, subject: ko(r.subject) ? nf(r.subject) : null };
                scan = { scanned: 0, limited: false };
                for (const f of folders) {
                    if (scan.scanned >= MAIL_SCAN_TOTAL) { scan.limited = true; break; }
                    await im.examine(f.raw);
                    const uids = await im.searchParts(base);
                    const tail = uids.slice(-Math.min(MAIL_SCAN_PER_FOLDER, MAIL_SCAN_TOTAL - scan.scanned));
                    if (tail.length < uids.length) scan.limited = true;
                    scan.scanned += tail.length;
                    for (let i = 0; i < tail.length; i += 100) {
                        for (const it of await im.fetchItems(tail.slice(i, i + 100).join(','), 'UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)]')) {
                            const um = /UID (\d+)/i.exec(it.text), dm = /INTERNALDATE "([^"]+)"/i.exec(it.text); if (!um) continue;
                            const hh = headers(it.literals && it.literals[0] ? it.literals[0].toString('latin1') : ''), subj = nf(decodeWords(hh.subject || '')), frm = nf(decodeWords(hh.from || ''));
                            if (want.q && !(subj + ' ' + frm).includes(want.q)) continue;
                            if (want.from && !frm.includes(want.from)) continue;
                            if (want.subject && !subj.includes(want.subject)) continue;
                            found++; cands.push({ f, uid: Number(um[1]), at: dm ? (Date.parse(dm[1]) || 0) : 0 });
                        }
                    }
                }
                limited = scan.limited;
            }
            cands.sort(byRecent);
            const after = cur ? cands.filter(c => byRecent(c, { at: cur.at, f: { raw: cur.folder }, uid: cur.uid }) > 0) : cands;
            const pick = after.slice(0, limit), mails = [];
            const has_more = after.length > pick.length;
            for (const f of folders) {
                const mine = pick.filter(c => c.f === f); if (!mine.length) continue;
                await im.examine(f.raw);
                for (const c of mine) { const d = await describeMail(im, c.uid, MAIL_PREVIEW); if (d) mails.push({ ...d, folder: f.raw, folder_name: f.name, _at: c.at, at: c.at ? new Date(c.at).toISOString() : null }); }
            }
            mails.sort((x, y) => byRecent({ at: x._at, f: { raw: x.folder }, uid: x.uid }, { at: y._at, f: { raw: y.folder }, uid: y.uid }));
            const lastPick = pick[pick.length - 1];
            const shownBefore = cur ? (cur.n || 0) : 0;
            return { found, shown: mails.length, page_from: shownBefore + 1, folders: folders.map(f => f.name), ...(scan ? { korean_scan: scan } : {}),
                has_more, next: has_more && lastPick ? encodeCursor({ at: lastPick.at, folder: lastPick.f.raw, uid: lastPick.uid, n: shownBefore + pick.length }) : null,
                limited: limited || undefined,
                mails: mails.map(m => ({ uid: m.uid, folder: m.folder, folder_name: m.folder_name, date: m.date, from: m.from, subject: m.subject, preview: m.text, attachments: m.attachments })) };
        });
    }
    async function read(r) {
        return withImap(async (im) => {
            const [f] = await folderOf(im, r.folder || 'INBOX');
            await im.examine(f.raw);
            const d = await describeMail(im, r.uid, MAIL_TEXT_MAX);
            if (!d) { const e = new Error('그 메일이 없어요(uid · 메일함 확인)'); e.user = true; throw e; }
            return { ...d, folder: f.raw, folder_name: f.name };
        });
    }
    async function attach(r) {
        return withImap(async (im) => {
            const [f] = await folderOf(im, r.folder || 'INBOX');
            await im.examine(f.raw);
            const st = (await im.fetchItems(r.uid, 'UID BODYSTRUCTURE'))[0];
            if (!st) { const e = new Error('그 메일이 없어요(uid · 메일함 확인)'); e.user = true; throw e; }
            const parts = bodyParts(fetchFields(st).BODYSTRUCTURE, '', []), p = parts.find(x => x.part === String(r.part));
            if (!p || !isAttach(p)) { const e = new Error('그 첨부(part)가 이 메일에 없어요 — 찾기·읽기 결과의 첨부 목록 part 로'); e.user = true; throw e; }
            if ((p.enc === 'base64' ? p.size * 0.75 : p.size) > MAIL_ATTACH_MAX) { const e = new Error('첨부가 10MB 를 넘어요 — 메일에서 직접 받아 주세요'); e.user = true; throw e; }
            const raw = await im.fetch(r.uid, `BODY.PEEK[${p.part}]`);
            const buf = partBytes(raw ? raw.toString('latin1') : '', p);
            if (buf.length > MAIL_ATTACH_MAX) { const e = new Error('첨부가 10MB 를 넘어요 — 메일에서 직접 받아 주세요'); e.user = true; throw e; }
            return { buf, name: (p.name || (p.type === 'message/rfc822' ? '첨부 메일.eml' : 'attachment.bin')).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 190), type: p.type };
        });
    }
    return { search, read, attach, withImap, folderOf };
}

// ════════ #779 메일 보내기 · 폴더 이동 · 휴지통(대표 10/20 「메일 쓰는 것은 다 되도록 · 삭제만 관리자만 · 문구 시안 → 고」) ════════
//   🔴 영구 삭제 없음: EXPUNGE · STORE \Deleted · 휴지통 비우기 코드는 이 파일에 없다(휴지통 = 휴지통 폴더로 UID MOVE 뿐)
//   이동·휴지통 = 서버가 UID MOVE(RFC 6851)를 지원할 때만(CAPABILITY 에 MOVE 없으면 멈춤 · COPY+STORE+EXPUNGE 대체 안 씀) · MOVE 는 SELECT 한 메일함에서만 됨
//   보내기 = 창구가 만든 초안(agent_office_config 'mail_draft_<id>' · 30분)만 · 서버가 초안을 지우면서 가져가 한 번만 보냄 · SMTP smtp.naver.com 465 SSL
const MAIL_MOVE_MAX = 50, MAIL_SEND_DAILY = 30, MAIL_RCPT_MAX = 10, MAIL_SEND_BYTES = 10 * 1024 * 1024, MAIL_DRAFT_MIN = 30;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const isTrashFolder = (f) => f && (f.flags.includes('\\trash') || /^(trash|deleted( messages)?)$|휴지통/i.test(String(f.name).split(/[/.]/).pop()));
// 이동할 수 있는 메일함 = 받은메일함 + 내 메일함들(찾기와 같은 목록 · 휴지통·스팸·보낸·임시는 대상 아님)
function moveTargets(list) { return pickFolders(list); }

// ── 아주 작은 SMTP 보내기(내장 tls · 465 SSL · EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT) ──
function smtpSend({ host, port, user, pass, from, rcpts, data, connect, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const sock = (connect || tls.connect)({ host, port, servername: host });
        let buf = '', lines = [], done = false, step = 0, dataSent = false;
        const timer = setTimeout(() => end(new Error('SMTP 시간 초과')), timeoutMs || 60000);
        const end = (e, v) => { if (done) return; done = true; clearTimeout(timer); try { sock.end(); } catch (_) { } try { sock.destroy(); } catch (_) { } if (e && dataSent) e.maybeSent = true; e ? reject(e) : resolve(v); };
        const send = (s) => sock.write(s);
        const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
        // 단계: [기대 코드, 다음에 보낼 것]
        const plan = [
            [220, () => send('EHLO akkome.local\r\n')],
            [250, () => send('AUTH LOGIN\r\n')],
            [334, () => send(b64(user) + '\r\n')],
            [334, () => send(b64(pass) + '\r\n')],
            [235, () => send('MAIL FROM:<' + from + '>\r\n')],
            ...rcpts.map((r) => [250, () => send('RCPT TO:<' + r + '>\r\n')]),
            [250, () => send('DATA\r\n')],
            [354, () => { dataSent = true; send(data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..').replace(/\r\n$/, '') + '\r\n.\r\n'); }],   // 이 뒤 실패 = 보냈을 수 있음
            [250, () => send('QUIT\r\n')],
            [221, () => end(null, { ok: true })],
        ];
        const onReply = (code, text) => {
            const [want, next] = plan[step] || [];
            if (want == null) return;
            if (code !== want && !(want === 250 && code === 251) && !(want === 221 && step === plan.length - 1)) {
                const shown = String(text).split(pass).join('(비밀값)').split(user).join('(메일 계정)').slice(0, 120);
                return end(Object.assign(new Error('SMTP ' + code + ' ' + shown), { smtpStep: step }));
            }
            step++; next();
        };
        sock.on('data', (d) => {
            buf += d.toString('utf8');
            let i;
            while ((i = buf.indexOf('\r\n')) >= 0) {
                const ln = buf.slice(0, i); buf = buf.slice(i + 2); lines.push(ln);
                if (/^\d{3} /.test(ln) || /^\d{3}$/.test(ln)) { const code = +ln.slice(0, 3), text = lines.join(' '); lines = []; onReply(code, text); }
            }
        });
        sock.on('error', (e) => end(e));
        sock.on('close', () => { if (!done) { if (step >= plan.length - 1) end(null, { ok: true }); else end(new Error('SMTP 연결 끊김')); } });
    });
}
// 머리말 글: 한글이면 =?UTF-8?B?…?= (76자 안쪽으로 나눔)
const encWord = (s) => /^[\x20-\x7e]*$/.test(String(s)) ? String(s) : String(s).match(/[\s\S]{1,15}/g).map(p => '=?UTF-8?B?' + Buffer.from(p, 'utf8').toString('base64') + '?=').join(' ');
const wrap76 = (b64s) => b64s.replace(/.{1,76}/g, (m) => m + '\r\n');
function buildMessage({ fromName, from, to, cc, subject, text, inReplyTo, references, attachments, now, msgId }) {
    const bd = '=_akkome_' + crypto.randomBytes(8).toString('hex');
    const h = [
        'From: ' + (fromName ? encWord(fromName) + ' ' : '') + '<' + from + '>',
        'To: ' + to.join(', '),
        ...(cc && cc.length ? ['Cc: ' + cc.join(', ')] : []),
        'Subject: ' + encWord(subject),
        'Date: ' + new Date(now || Date.now()).toUTCString().replace('GMT', '+0000'),
        'Message-ID: <' + msgId + '>',
        ...(inReplyTo ? ['In-Reply-To: <' + inReplyTo + '>'] : []),
        ...(references ? ['References: ' + references] : []),
        'MIME-Version: 1.0',
    ];
    const body = wrap76(Buffer.from(String(text), 'utf8').toString('base64'));
    if (!attachments || !attachments.length) return h.concat(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body]).join('\r\n');
    const parts = ['--' + bd, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body];
    for (const a of attachments) {
        const fn = String(a.name || 'file').replace(/[\r\n"]/g, '_'), star = "utf-8''" + encodeURIComponent(fn);
        parts.push('--' + bd, 'Content-Type: ' + (a.type || 'application/octet-stream') + '; name="' + encWord(fn) + '"', 'Content-Transfer-Encoding: base64',
            'Content-Disposition: attachment; filename="' + encWord(fn) + '"; filename*=' + star, '', wrap76(a.data.toString('base64')));
    }
    parts.push('--' + bd + '--', '');
    return h.concat(['Content-Type: multipart/mixed; boundary="' + bd + '"', '', 'This is a multi-part message in MIME format.', ...parts]).join('\r\n');
}
const EXT_TYPE = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', hwp: 'application/x-hwp', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
const typeOfName = (n) => EXT_TYPE[(String(n).split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
// 초안 검사(창구 draft · 서버 send 둘 다 같은 규칙)
function checkDraft(d) {
    if (!d || typeof d !== 'object') return '초안이 비었어요';
    const to = Array.isArray(d.to) ? d.to : [], cc = Array.isArray(d.cc) ? d.cc : [];
    if (!to.length) return '받는 사람이 없어요';
    if (to.length + cc.length > MAIL_RCPT_MAX) return `받는 사람은 한 통에 ${MAIL_RCPT_MAX}명까지예요(받는 사람+참조 ${to.length + cc.length}명)`;
    const bad = to.concat(cc).filter(a => !EMAIL_RE.test(String(a)) || String(a).length > 200);
    if (bad.length) return '메일 주소 꼴이 아니에요: ' + bad.slice(0, 3).join(', ');
    if (typeof d.subject !== 'string' || !d.subject.trim() || d.subject.length > 200) return '제목은 1~200자';
    if (typeof d.text !== 'string' || !d.text.trim() || d.text.length > 20000) return '본문은 1~2만 자';
    if (d.attach_file_ids != null && (!Array.isArray(d.attach_file_ids) || d.attach_file_ids.length > 10 || d.attach_file_ids.some(x => !Number.isInteger(x) || x <= 0))) return '첨부는 report_files id 10개까지';
    if (d.reply_to_uid != null && !(Number.isInteger(d.reply_to_uid) && d.reply_to_uid > 0)) return '답장할 메일 uid 가 이상해요';
    return null;
}
function makeWriteOps(creds, deps, ops) {
    deps = deps || {};
    // 메일함을 쓰기로 연다(MOVE 는 SELECT 한 메일함에서만) — 그 밖 명령은 그대로 읽기
    async function moveWith(r, toPick) {
        return ops.withImap(async (im) => {
            const caps = await im.capability();
            if (!caps.includes('MOVE')) { const e = new Error('이 메일 서버는 UID MOVE 를 지원하지 않아 옮기지 않았어요(복사·지우기로 대신하지 않음) — 총괄에게'); e.user = true; throw e; }
            const list = await im.list(), src = pickFolders(list).find(x => x.raw === (r.folder || 'INBOX') || x.name === r.folder);
            if (!src) { const e = new Error('옮길 메일이 있는 메일함이 없어요: ' + String(r.folder).slice(0, 40)); e.user = true; throw e; }
            const dst = toPick(list, src); if (dst.error) { const e = new Error(dst.error); e.user = true; throw e; }
            await (r.dry ? im.examine(src.raw) : im.select(src.raw));
            const have = await im.searchParts(['UID ' + r.uids.join(',')]);
            const peek = [];
            for (const uid of have.slice(0, MAIL_MOVE_MAX)) { const hb = await im.fetch(uid, 'BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]'); const hh = headers(hb ? hb.toString('latin1') : ''); peek.push({ uid, date: hh.date || null, from: decodeWords(hh.from || ''), subject: decodeWords(hh.subject || '') }); }
            const missing = r.uids.filter(u => !have.includes(u));
            if (!have.length) { const e = new Error('그 uid 메일이 이 메일함에 없어요(이미 옮겼을 수 있음)'); e.user = true; throw e; }
            if (r.dry) return { dry: true, from_folder: src.name, to_folder: dst.name, mails: peek, missing };
            await im.uidMove(have.join(','), dst.raw);
            await im.examine(src.raw);
            const left = await im.searchParts(['UID ' + have.join(',')]);
            return { moved: have.length - left.length, from_folder: src.name, to_folder: dst.name, mails: peek, missing, not_moved: left };
        });
    }
    const move = (r) => moveWith(r, (list, src) => {
        const t = moveTargets(list).find(x => x.raw === r.to_folder || x.name === r.to_folder);
        if (!t) return { error: '옮길 메일함이 목록에 없어요(받은메일함·내 메일함만 · 휴지통은 「휴지통으로」로): ' + String(r.to_folder).slice(0, 40) };
        if (t.raw === src.raw) return { error: '같은 메일함이에요' };
        return t;
    });
    const trash = (r) => moveWith(r, (list) => {
        const t = (list || []).find(f => isTrashFolder(f) && !f.flags.includes('\\noselect'));
        return t ? { raw: t.raw, name: '휴지통' } : { error: '휴지통 메일함을 못 찾았어요 — 옮기지 않았어요' };
    });
    async function send(d, attachments) {
        const { user, pass } = creds();
        if (!user || !pass) { const e = new Error('메일 설정 없음(NAVER_MAIL_USER/NAVER_MAIL_APP_PW)'); e.noCreds = true; throw e; }
        let inReplyTo = null, references = null, subject = d.subject;
        if (d.reply_to_uid) {   // 답장 = 원래 메일의 Message-ID 로 In-Reply-To/References · 제목 「Re:」
            const orig = await ops.withImap(async (im) => {
                const [f] = await ops.folderOf(im, d.folder || 'INBOX'); await im.examine(f.raw);
                const hb = await im.fetch(d.reply_to_uid, 'BODY.PEEK[HEADER.FIELDS (MESSAGE-ID REFERENCES SUBJECT)]'); return headers(hb ? hb.toString('latin1') : '');
            });
            const mid = String(orig['message-id'] || '').replace(/[<>\s]/g, '');
            if (!mid) { const e = new Error('답장할 메일을 못 찾았어요(uid · 메일함 확인) — 보내지 않았어요'); e.user = true; throw e; }
            inReplyTo = mid; references = ((orig.references ? orig.references + ' ' : '') + '<' + mid + '>').slice(-900);
            if (!/^re:/i.test(subject.trim())) subject = 'Re: ' + subject;
        }
        const msgId = 'akkome-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + '@' + (String(user).split('@')[1] || 'naver.com');
        const data = buildMessage({ fromName: d.from_name || '제주아꼼이네', from: user, to: d.to, cc: d.cc || [], subject, text: d.text, inReplyTo, references, attachments, msgId });
        try { await (deps.smtpSend || smtpSend)({ host: 'smtp.naver.com', port: 465, user, pass, from: user, rcpts: d.to.concat(d.cc || []), data, timeoutMs: 60000 }); }
        catch (e) { const x = new Error(String(e && e.message || e).split(pass).join('(비밀값)').split(user).join('(메일 계정)').slice(0, 200)); if (e && e.user) x.user = true; x.smtpStep = e && e.smtpStep; if (e && e.maybeSent) x.maybeSent = true; throw x; }
        return { subject, msgId, bytes: Buffer.byteLength(data), reply: !!inReplyTo };
    }
    return { move, trash, send };
}

// 서버에 붙이기: require('./naver-mail.js').mountMailRunner({ pool, writeAudit, env }) — 5초마다 요청 줄 셋을 보고 하나씩
function mountMailRunner(deps) {
    const { pool, writeAudit } = deps, env = deps.env || process.env;
    const ops = makeMailOps(() => ({ user: env.NAVER_MAIL_USER || '', pass: env.NAVER_MAIL_APP_PW || '' }), deps);
    const now = deps.now || (() => Date.now());
    const KEYS = { search: ['mail_search_request', 'mail_search_result'], read: ['mail_read_request', 'mail_read_result'], attach: ['mail_attach_request', 'mail_attach_result'],
        move: ['mail_move_request', 'mail_move_result'], trash: ['mail_trash_request', 'mail_trash_result'], send: ['mail_send_request', 'mail_send_result'] };   // #779
    const W = makeWriteOps(() => ({ user: env.NAVER_MAIL_USER || '', pass: env.NAVER_MAIL_APP_PW || '' }), deps, ops);
    // #779 쓰기 = 지시가 있어야(누가 시켰는지 기록 · 대표 「보낸 사람 표시」) · 휴지통만 관리자(대표 「삭제만 관리자만」)
    async function whoOrdered(orderId) {
        if (!Number.isInteger(orderId) || orderId <= 0) return null;
        // 지금 창구가 처리 중인(24시간 안) 지시만 — 옛 지시 번호(특히 대표 지시)를 다시 써서 권한을 빌리지 못하게
        const r0 = (await pool.query(`SELECT o.id, o.created_by, u.role, u.name FROM pending_orders o LEFT JOIN users u ON u.id = o.created_by_id AND u.deleted_at IS NULL WHERE o.id = $1 AND o.is_deleted = false AND o.status = '처리중' AND o.created_at > NOW() - interval '24 hours'`, [orderId])).rows[0];
        return r0 ? { name: String(r0.name || r0.created_by || '요청자 미상').slice(0, 60), admin: r0.role === 'admin' } : null;
    }

    const cfgSet = (k, v) => pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [k, JSON.stringify(v)]);
    let busy = false, lastSearch = 0, lastClean = 0;
    const RESULT_TTL_MIN = 10;   // 결과 줄(본문·첨부 목록이 듦)은 10분 넘으면 지움 — 설정 표에 메일 내용이 남지 않게
    const audit = (action, changes, by) => { try { return writeAudit && writeAudit({ action, targetType: 'naver_mail', targetId: null, changes, source: 'naver-mail', actor: { id: null, name: String(by || '창구(#776)').slice(0, 80) } }); } catch (_) { return null; } };
    async function tick() {
        if (busy) return; busy = true;
        try {
            if (now() - lastClean >= 60000) {   // 1분에 한 번
                lastClean = now();
                await pool.query(`DELETE FROM agent_office_config WHERE key = ANY($1) AND updated_at < NOW() - make_interval(mins => $2::int)`, [Object.values(KEYS).map(k => k[1]), RESULT_TTL_MIN]);
                await pool.query(`DELETE FROM agent_office_config WHERE key LIKE 'mail\\_draft\\_%' AND updated_at < NOW() - make_interval(mins => $1::int)`, [MAIL_DRAFT_MIN]);   // #779 초안 30분
            }
            for (const [op, [reqK, resK]] of Object.entries(KEYS)) {
                // 요청 줄 집기 = 지우면서 값 받기 한 번(교체 중 두 인스턴스가 같은 줄을 두 번 실행하지 않게 · 지운 쪽만 실행)
                const got = await pool.query(`DELETE FROM agent_office_config WHERE key = $1 RETURNING value`, [reqK]);
                if (!got.rows.length) continue;
                const q = got.rows[0].value || {}, id = q.id != null ? String(q.id).slice(0, 40) : null;
                const fail = (error) => cfgSet(resK, { ok: false, id, op, error: String(error).slice(0, 200) });
                const bad = checkReq(op, q); if (bad) { await fail(bad); continue; }
                if (op === 'search' && now() - lastSearch < MAIL_COOLDOWN_MS) { await fail(`메일 찾기는 10초 간격이에요 — ${Math.ceil((MAIL_COOLDOWN_MS - (now() - lastSearch)) / 1000)}초 뒤 다시`); continue; }
                try {
                    if (op === 'search') {
                        lastSearch = now();
                        const out = await ops.search({ q: q.q || null, from: q.from || null, subject: q.subject || null, since: q.since || null, until: q.until || null, folder: q.folder || null, limit: q.limit || 10, more: q.more || null });
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), ...out });
                        await audit('mail_search', { q: q.q || null, from: q.from || null, subject: q.subject || null, since: q.since || null, until: q.until || null, folder: q.folder || null, more: !!q.more, found: out.found, shown: out.shown, order_id: q.order_id || null }, q.by);
                    } else if (op === 'read') {
                        const out = await ops.read({ uid: q.uid, folder: q.folder || null });
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), mail: out });
                        await audit('mail_read', { uid: q.uid, folder: q.folder || null, order_id: q.order_id || null }, q.by);
                    } else if (op === 'move' || op === 'trash' || op === 'send') {   // #779 쓰기 — 지시자 확인 먼저
                        const who = await whoOrdered(q.order_id);
                        if (!who) { await fail('쓰기는 지금 처리 중인 지시 번호가 있어야 해요(24시간 안 · 누가 시켰는지 기록) — --order <지시 id>'); continue; }
                        if (op === 'trash' && !who.admin) { await fail('휴지통으로 보내기는 관리자만 할 수 있어요'); continue; }
                        if (op === 'send') {
                            const got = await pool.query(`DELETE FROM agent_office_config WHERE key = $1 RETURNING value, updated_at`, ['mail_draft_' + q.draft_id]);   // 초안은 지우면서 가져감 = 한 번만 보냄
                            const d = got.rows[0] && got.rows[0].value;
                            if (!d) { await fail('초안이 없어요(30분 지났거나 이미 보냄) — draft 부터 다시'); continue; }
                            if (Number(d.order_id) !== Number(q.order_id)) { await fail('다른 지시의 초안이에요 — 같은 지시에서 만든 초안만 보내요'); continue; }
                            if (!(now() - Number(d.at) <= MAIL_DRAFT_MIN * 60000)) { await fail('초안이 30분 지났어요 — draft 부터 다시'); continue; }
                            const bad = checkDraft(d); if (bad) { await fail(bad); continue; }
                            const files = [];
                            if ((d.attach_file_ids || []).length) {
                                const fr = (await pool.query(`SELECT id, filename, data, size_bytes FROM report_files WHERE id = ANY($1) AND is_deleted = false AND purged_at IS NULL`, [d.attach_file_ids])).rows;
                                if (fr.length !== d.attach_file_ids.length) { await fail('첨부 파일을 못 찾았어요(지워졌거나 보관 기간 지남) — draft 부터 다시'); continue; }
                                const total = fr.reduce((t, x) => t + (x.data ? x.data.length : 0), 0);
                                if (total > MAIL_SEND_BYTES) { await fail('첨부가 합쳐서 10MB 를 넘어요'); continue; }
                                for (const id of d.attach_file_ids) { const x = fr.find(y => Number(y.id) === Number(id)); files.push({ name: x.filename, type: typeOfName(x.filename), data: x.data }); }
                            }
                            const day = new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST 날짜
                            const slot = (await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('mail_send_count', jsonb_build_object('day', $1::text, 'n', 1))
                                ON CONFLICT (key) DO UPDATE SET value = CASE WHEN agent_office_config.value->>'day' = $1::text THEN jsonb_build_object('day', $1::text, 'n', COALESCE((agent_office_config.value->>'n')::int, 0) + 1) ELSE jsonb_build_object('day', $1::text, 'n', 1) END, updated_at = NOW()
                                RETURNING value`, [day])).rows[0].value;
                            const unreserve = () => pool.query(`UPDATE agent_office_config SET value = jsonb_build_object('day', $1::text, 'n', GREATEST(COALESCE((value->>'n')::int, 1) - 1, 0)), updated_at = NOW() WHERE key = 'mail_send_count' AND value->>'day' = $1::text`, [day]);
                            if (Number(slot.n) > MAIL_SEND_DAILY) { await unreserve(); await fail(`오늘 보낸 메일이 ${MAIL_SEND_DAILY}통이라 더 못 보내요(내일 다시)`); continue; }
                            let sent;
                            try { sent = await W.send(d, files); } catch (e) { if (!e.maybeSent) e.unreserve = unreserve; throw e; }   // DATA 뒤 실패 = 나갔을 수 있어 수는 그대로
                            await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), sent: true, to: d.to, cc: d.cc || [], subject: sent.subject, reply: sent.reply, attachments: files.map(x => ({ name: x.name, size: x.data.length })), by: who.name });
                            await audit('mail_send', { to: d.to, cc: d.cc || [], subject: sent.subject, text_head: String(d.text).slice(0, 100), bytes: sent.bytes, attachments: files.map(x => ({ name: x.name, size: x.data.length })), reply_to_uid: d.reply_to_uid || null, message_id: sent.msgId, draft_id: q.draft_id, order_id: q.order_id, ordered_by: who.name, today_n: Number(slot.n) }, who.name);
                        } else {
                            const out = op === 'move' ? await W.move({ uids: q.uids, folder: q.folder || 'INBOX', to_folder: q.to_folder, dry: q.dry === true }) : await W.trash({ uids: q.uids, folder: q.folder || 'INBOX', dry: q.dry === true });
                            await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), ...out, by: who.name });
                            if (!out.dry) await audit(op === 'move' ? 'mail_move' : 'mail_trash', { uids: q.uids, moved: out.moved, from_folder: out.from_folder, to_folder: out.to_folder, subjects: out.mails.map(m => String(m.subject).slice(0, 60)), missing: out.missing, not_moved: out.not_moved, order_id: q.order_id, ordered_by: who.name }, who.name);
                        }
                    } else {
                        const a = await ops.attach({ uid: q.uid, folder: q.folder || null, part: String(q.part) });
                        const ins = await pool.query(`INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, NULL, $2, $3) RETURNING id`, [a.name, a.buf, a.buf.length]);
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), file_id: ins.rows[0].id, filename: a.name, size: a.buf.length, type: a.type });
                        await audit('mail_attach', { uid: q.uid, folder: q.folder || null, part: String(q.part), file_id: ins.rows[0].id, size: a.buf.length, order_id: q.order_id || null }, q.by);
                    }
                } catch (e) {
                    if (op === 'send' && e.unreserve) await e.unreserve().catch(() => { });   // 확실히 안 나간 보내기 = 오늘 수 되돌림
                    const msg = e.noCreds ? '메일 설정이 없어요(총괄에게 · Render env)' : e.user ? e.message : (op === 'search' && /시간 초과/.test(String(e.message))) ? '메일 서버가 오래 걸려 멈췄어요 — 기간(--since)을 붙여 다시 찾아 주세요' : '메일 서버 오류 — ' + e.message;
                    await fail(op === 'send' && e.maybeSent ? msg + ' — 🔴 보냈을 수 있어요 · 보낸메일함을 먼저 확인(다시 보내지 말기)' : msg);
                }
            }
        } catch (e) { console.error('[#776 메일 찾기]', String(e && e.message || e).slice(0, 200)); }
        finally { busy = false; }
    }
    if (!deps.noTimers) setInterval(tick, 5000);
    return { tick, ops };
}

module.exports = { imapOpen, imapDate, imapFromCrit, decodeCharset, decodeWords, splitHead, headers, param, decodeBody, htmlText, mimeText, parseMail, fromAddr,
    mountMailRunner, makeMailOps, makeWriteOps, smtpSend, buildMessage, checkDraft, MAIL_DRAFT_MIN, _t: { isTrashFolder, encWord, byRecent, encodeCursor, decodeCursor, listLine, mutf7, pickFolders, sexp, fetchFields, bodyParts, partName, attachList, textPart, partText, partBytes, searchPieces, checkReq, ymdImap } };

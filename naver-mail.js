// #776 네이버 메일(bumiletter@naver.com) 읽기 전용 — #775 experience.js 의 IMAP·MIME 를 떼어 내 둘이 같이 씀(experience.js 동작 무회귀)
//   쓰기 명령 0: LOGIN · EXAMINE(읽기 전용 열기 · 읽음 표시 안 바뀜) · LIST · UID SEARCH · UID FETCH(BODY.PEEK·BODYSTRUCTURE·INTERNALDATE) · STATUS · LOGOUT 만
//   메일 찾기 러너(창구 scripts/desk/mail-find.js · 토큰 없음 · 요청 줄 → 결과 줄):
//     agent_office_config 'mail_search_request' {id, q?, from?, subject?, since?, until?(YYYY-MM-DD), folder?, limit≤20} → 'mail_search_result'
//     'mail_read_request' {id, uid, folder} → 'mail_read_result'(본문 글 최대 5천 자 + 첨부 목록)
//     'mail_attach_request' {id, uid, folder, part} → 'mail_attach_result'(report_files 행 id · 10MB 상한)
//   비밀값(Render env NAVER_MAIL_USER / NAVER_MAIL_APP_PW)은 서버만 · 오류 글에서도 가림 · 검색 10초 간격 · 한 번에 하나
const tls = require('tls');

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
        return null;
    }
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
        try { im = await (deps.imapOpen || imapOpen)({ host: 'imap.naver.com', port: 993, user, pass, timeoutMs: 60000 }); } catch (e) { throw hide(e); }
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
        const limit = r.limit || 10;
        return withImap(async (im) => {
            const folders = await folderOf(im, r.folder), pieces = searchPieces(r), cands = []; let found = 0;
            for (const f of folders) {
                await im.examine(f.raw);
                const uids = await im.searchParts(pieces); found += uids.length;
                const last = uids.slice(-limit); if (!last.length) continue;
                for (const it of await im.fetchItems(last.join(','), 'UID INTERNALDATE')) { const o = fetchFields(it); if (o.UID) cands.push({ f, uid: Number(o.UID), at: Date.parse(String(o.INTERNALDATE || '')) || 0 }); }
            }
            cands.sort((x, y) => y.at - x.at);
            const pick = cands.slice(0, limit), mails = [];
            for (const f of folders) {
                const mine = pick.filter(c => c.f === f); if (!mine.length) continue;
                await im.examine(f.raw);
                for (const c of mine) { const d = await describeMail(im, c.uid, MAIL_PREVIEW); if (d) mails.push({ ...d, folder: f.raw, folder_name: f.name, at: c.at ? new Date(c.at).toISOString() : null }); }
            }
            mails.sort((x, y) => Date.parse(y.at || 0) - Date.parse(x.at || 0));
            return { found, shown: mails.length, folders: folders.map(f => f.name), mails: mails.map(m => ({ uid: m.uid, folder: m.folder, folder_name: m.folder_name, date: m.date, from: m.from, subject: m.subject, preview: m.text, attachments: m.attachments })) };
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
    return { search, read, attach, withImap };
}
// 서버에 붙이기: require('./naver-mail.js').mountMailRunner({ pool, writeAudit, env }) — 5초마다 요청 줄 셋을 보고 하나씩
function mountMailRunner(deps) {
    const { pool, writeAudit } = deps, env = deps.env || process.env;
    const ops = makeMailOps(() => ({ user: env.NAVER_MAIL_USER || '', pass: env.NAVER_MAIL_APP_PW || '' }), deps);
    const now = deps.now || (() => Date.now());
    const KEYS = { search: ['mail_search_request', 'mail_search_result'], read: ['mail_read_request', 'mail_read_result'], attach: ['mail_attach_request', 'mail_attach_result'] };
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
                        const out = await ops.search({ q: q.q || null, from: q.from || null, subject: q.subject || null, since: q.since || null, until: q.until || null, folder: q.folder || null, limit: q.limit || 10 });
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), ...out });
                        await audit('mail_search', { q: q.q || null, from: q.from || null, subject: q.subject || null, since: q.since || null, until: q.until || null, folder: q.folder || null, found: out.found, shown: out.shown, order_id: q.order_id || null }, q.by);
                    } else if (op === 'read') {
                        const out = await ops.read({ uid: q.uid, folder: q.folder || null });
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), mail: out });
                        await audit('mail_read', { uid: q.uid, folder: q.folder || null, order_id: q.order_id || null }, q.by);
                    } else {
                        const a = await ops.attach({ uid: q.uid, folder: q.folder || null, part: String(q.part) });
                        const ins = await pool.query(`INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, NULL, $2, $3) RETURNING id`, [a.name, a.buf, a.buf.length]);
                        await cfgSet(resK, { ok: true, id, op, at: new Date().toISOString(), file_id: ins.rows[0].id, filename: a.name, size: a.buf.length, type: a.type });
                        await audit('mail_attach', { uid: q.uid, folder: q.folder || null, part: String(q.part), file_id: ins.rows[0].id, size: a.buf.length, order_id: q.order_id || null }, q.by);
                    }
                } catch (e) { await fail(e.noCreds ? '메일 설정이 없어요(총괄에게 · Render env)' : (e.user ? e.message : '메일 서버 오류 — ' + e.message)); }
            }
        } catch (e) { console.error('[#776 메일 찾기]', String(e && e.message || e).slice(0, 200)); }
        finally { busy = false; }
    }
    if (!deps.noTimers) setInterval(tick, 5000);
    return { tick, ops };
}

module.exports = { imapOpen, imapDate, imapFromCrit, decodeCharset, decodeWords, splitHead, headers, param, decodeBody, htmlText, mimeText, parseMail, fromAddr,
    mountMailRunner, makeMailOps, _t: { listLine, mutf7, pickFolders, sexp, fetchFields, bodyParts, partName, attachList, textPart, partText, partBytes, searchPieces, checkReq, ymdImap } };

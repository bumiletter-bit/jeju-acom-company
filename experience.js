// #775 감귤체험 예약 관리 — 서버(표 experience_bookings · 수집 틱 2 · 손님 안내 문자 틱 · 화면 API · 메일 확인 러너)
//   재료 ① 스토어 = 네이버 주문 API 의 체험 상품(설정 experience_products · #775-A 판정 그대로) — 입력형 옵션 글자(00월/00일/00시 00분)에서 방문 일시를 읽는다
//        ② 플레이스 = 네이버 예약 알림 메일(bumiletter@naver.com · IMAP 읽기 전용 · EXAMINE + BODY.PEEK = 읽음 표시 안 바뀜 · 보낸 사람 낱말에 걸린 메일만 연다)
//   🔴 발주확인은 사람이 누른다(자동 0) · 손님 문자는 설정 experience_notify.enabled 가 true 일 때만(기본 꺼짐) · 메일 비밀값(NAVER_MAIL_USER/APP_PW)은 로그·응답에 내지 않는다
//   타이머 키(server.js naverAutoCollectTick 이 부름 · 시드는 꺼짐) = experience_store(스토어 수집) · experience_place(메일 수집) · experience_sms(손님 문자)
//   계약(화면 · 전부 로그인 · 문구·켜기 설정만 관리자):
//     GET   /api/agent-office/experience?from=YYYY-MM-DD&to=YYYY-MM-DD   { items, summary:{today,tomorrow,need_check,teams,…}, settings_view }
//     PATCH /api/agent-office/experience/:id     { visit_date?, visit_time?, exp_count?, entry_count?, infant_count?, memo?, status? }  (직원이 날짜를 고치면 date_fixed · 수집이 다시 덮지 않음)
//     POST  /api/agent-office/experience/:id/visit  { on }  방문 체크
//     GET   /api/agent-office/experience/export.xlsx?from&to   엑셀
//     GET   /api/agent-office/experience/:id/sms-preview      접수·전날 문자 미리보기(보내지 않음)
//     GET/PUT /api/agent-office/experience/settings            문구·켜기·하루 상한(PUT = 관리자)
//   요청 줄(창구·총괄용 · 토큰 없이): agent_office_config 'experience_mail_probe_request' → 'experience_mail_probe_result'(메일 수·낱말별 건수·최근 1통의 보낸 주소와 제목 꼴만 · 본문·손님 정보 0)
'use strict';
const tls = require('tls');

const KEY_NOTIFY = 'experience_notify', KEY_MAIL = 'experience_mail';
const DEFAULT_TPL_RECV = '[제주아꼼이네 감귤체험장] {이름}님, 예약이 확정되었습니다.\n방문: {월}월 {일}일 {시간} / 체험 {체험}명 · 입장 {입장}명{유아}\n주소: 제주시 연삼로 1066-31 제주아꼼이네 (카카오내비 "제주아꼼이네")\n큰길에서 골목길로 들어오시면 길이 좁으니 천천히 오세요. 주황색 컨테이너 옆 주차장에 후진주차 부탁드려요.\n체험 손님께는 오션라운지 아메리카노 또는 하겐다즈 교환권을 드려요(체험 당일 사용).\n비가 많이 오면 운영이 바뀔 수 있어 당일 직접 연락드려요.\n방문 전날까지 취소하시면 전액 환불됩니다. 날짜 변경·취소는 체험장 010-6259-8420 으로 연락 주세요.\n예약일이 멀어 네이버에서 자동 구매확정이 되어도 그대로 두시면 됩니다.';
const DEFAULT_TPL_EVE = '[제주아꼼이네 감귤체험장] {이름}님, 내일 {월}월 {일}일 {시간} 방문 예약 안내드려요.\n주소: 제주시 연삼로 1066-31 제주아꼼이네 (카카오내비 "제주아꼼이네") · 주황색 컨테이너 옆 주차장\n비가 많이 오면 운영이 바뀔 수 있어 당일 직접 연락드려요. 변경·취소는 체험장 010-6259-8420 으로 연락 주세요.';
//   sender = 알리고 발신번호(비우면 ALIGO_SENDER) — 알리고에 미리 등록된 번호만 나감 · 체험장 번호 010-6259-8420 은 등록 확인 뒤 넣는다(대표 10/20 · 문자 API 에 등록 목록 조회가 없음)
const NOTIFY_DEFAULT = { enabled: false, daily_cap: 40, recv_from: '09:00', recv_to: '21:00', eve_from: '10:00', eve_to: '18:00', sender: '', tpl_recv: DEFAULT_TPL_RECV, tpl_eve: DEFAULT_TPL_EVE,
    alimtalk: { enabled: false, confirm_tpl: 'UM_6788', remind_tpl: 'UM_6789' } };
// 알림톡 템플릿 원문(알리고 등록본과 글자 하나까지 같아야 나감 · 변수 #{고객명} #{방문일시} #{인원}) — 🔴 원문이 비어 있으면(null) 알림톡을 시도하지 않고 LMS 만
//   UM_6788 「제주아꼼이네_감귤체험_예약확인」 · UM_6789 「제주아꼼이네_감귤체험_방문안내」(10/20 등록 · 검수중) — 원문은 알리고 template/list 에서 그대로 옮긴다
//   원문 = 총괄이 알리고 화면에 넣은 글자 그대로(10/20 · 줄바꿈 \n · 빈 줄 \n\n · 「·」「■」「"」 그대로) — 승인 뒤 template/list 로 한 번 더 대조
const EXP_MAP_URL = 'https://map.naver.com/p/entry/place/1911847116', EXP_PRODUCT_URL = 'https://brand.naver.com/jejuakkome/products/7673020911';
const wl = (name, url) => ({ name, linkType: 'WL', linkTypeName: '웹링크', linkMo: url, linkPc: url });
const EXP_ALIMTALK = {
    UM_6788: {
        content: '[제주아꼼이네 감귤체험장] 예약 확정 안내\n\n#{고객명}님, 감귤체험 예약이 확정되었습니다.\n\n■ 방문 일시 : #{방문일시}\n■ 인원 : #{인원}\n\n■ 오시는 길\n제주시 연삼로 1066-31 제주아꼼이네\n(카카오내비 "제주아꼼이네" 검색)\n큰길에서 골목길로 들어오시면 길이 좁으니 천천히 오세요.\n주황색 컨테이너 옆 주차장에 후진주차 부탁드립니다.\n\n■ 체험 안내\n- 귤따기 체험 손님께는 오션라운지 음료 교환권(체험 당일 사용)을 드립니다.\n- 비가 많이 오면 운영이 바뀔 수 있어 당일 직접 연락드립니다.\n\n■ 취소·변경\n- 방문 전날까지 취소 시 전액 환불됩니다.\n- 날짜 변경·취소 문의 : 체험장 010-6259-8420\n- 예약일이 멀어 네이버에서 자동 구매확정이 되어도 그대로 두시면 됩니다.',
        button: { button: [wl('길찾기', EXP_MAP_URL), wl('체험 안내 보기', EXP_PRODUCT_URL)] },
    },
    UM_6789: {
        content: '[제주아꼼이네 감귤체험장] 방문 전날 안내\n\n#{고객명}님, 내일 감귤체험 방문 예약을 안내드립니다.\n\n■ 방문 일시 : #{방문일시}\n■ 주소 : 제주시 연삼로 1066-31 제주아꼼이네\n(주황색 컨테이너 옆 주차장)\n\n비가 많이 오면 운영이 바뀔 수 있어 당일 직접 연락드립니다.\n변경·취소 문의 : 체험장 010-6259-8420',
        button: { button: [wl('길찾기', EXP_MAP_URL)] },
    },
};
//   보낸 사람 낱말(IMAP FROM 부분 일치) — 첫 실메일(확인 러너)로 정한 뒤 설정에서 고친다 · 기본은 예약 계열 낱말만(일반 네이버 메일은 안 열게)
const MAIL_DEFAULT = { from_terms: ['booking'], days: 3, max_per_tick: 20 };
const MAIL_PROBE_TERMS = ['booking', 'reservation', 'reserve', 'smartplace', 'place', 'naver'];

// ── 날짜·시각 도우미(KST) ───────────────────────────────────────────────
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const kstDay = (ms) => new Date((ms == null ? Date.now() : ms) + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const pad2 = n => String(n).padStart(2, '0');
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const DOW = '일월화수목금토';
const dowOf = ymd => DOW[new Date(ymd + 'T00:00:00Z').getUTCDay()];
const digits = s => String(s || '').replace(/\D/g, '');

// 시각 글자 → 'HH:MM' (손님이 자유롭게 쓴 값 · 못 읽으면 null)
//   12:30 · 12시30분 · 12시 반 · 오후 1시 · 1시(체험 시간대 9~17시라 1~7시는 오후로 봄) · 1230 · 오전 10시
function parseTime(raw) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const pm = /오후|pm|p\.m/i.test(s), am = /오전|am|a\.m/i.test(s);
    let h = null, mi = 0, m;
    if ((m = /(\d{1,2})\s*[:：.]\s*(\d{2})/.exec(s))) { h = +m[1]; mi = +m[2]; }
    else if ((m = /(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/.exec(s))) { h = +m[1]; mi = m[2] ? +m[2] : (m[3] ? 30 : 0); }
    else if ((m = /^(\d{3,4})$/.exec(s.replace(/\s/g, '')))) { const v = m[1].padStart(4, '0'); h = +v.slice(0, 2); mi = +v.slice(2); }
    else if ((m = /^(\d{1,2})$/.exec(s))) { h = +m[1]; }
    if (h == null || mi > 59) return null;
    if (pm && h < 12) h += 12;
    else if (!am && h >= 1 && h <= 7) h += 12;   // 「1시」 = 13시(체험장 운영 시간)
    if (h > 23) return null;
    return pad2(h) + ':' + pad2(mi);
}
const firstInt = (s, lo, hi) => { const m = /(\d{1,2})/.exec(String(s || '')); if (!m) return null; const n = +m[1]; return n >= lo && n <= hi ? n : null; };

// 스토어 옵션 글자 → 방문 일시. 꼴(추정 · 첫 실주문으로 확정): 「제주아꼼이네 귤체험: 내가 직접 딴 … / 00월: 11 / 00일: 30 / 00시 00분 (30분단위): 12:30」
//   묶음 이름이 「…월」「…일」「…시…」 인 칸을 찾는다(이름을 바꿔도 끝 글자로) · 월·일 못 읽으면 ok false(「날짜 확인 필요」)
function parseStoreOption(text, orderMs) {
    const segs = String(text || '').split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean);
    let month = null, day = null, time = null, rawTime = null, kind = '';
    for (const sg of segs) {
        const i = sg.indexOf(':'); if (i < 0) continue;
        const label = sg.slice(0, i).trim(), val = sg.slice(i + 1).trim();
        if (/시/.test(label) && /분|시간/.test(label)) { rawTime = val; time = parseTime(val); }
        else if (/월\s*$/.test(label)) { month = firstInt(val, 1, 12); const d2 = /월\s*(\d{1,2})\s*일/.exec(val); if (d2 && day == null) day = firstInt(d2[1], 1, 31); }
        else if (/일\s*$/.test(label)) day = firstInt(val, 1, 31);
        else if (!kind) kind = val;
    }
    if (!kind && segs.length) kind = segs[0].replace(/^[^:]*:\s*/, '');
    const out = { month, day, time, raw_time: rawTime, option: kind, date: null, ok: false, why: '' };
    if (month == null || day == null) { out.why = month == null && day == null ? '월·일 못 읽음' : month == null ? '월 못 읽음' : '일 못 읽음'; return out; }
    const base = kstNow(); const ref = orderMs ? new Date(orderMs + 9 * 3600 * 1000) : base;
    let y = ref.getUTCFullYear();
    if (month < ref.getUTCMonth() + 1 - 1) y++;   // 주문 달보다 앞 달이면 다음 해(11월 주문의 「1월」)
    if (!validYmd(y, month, day)) { out.why = '없는 날짜'; return out; }
    out.date = `${y}-${pad2(month)}-${pad2(day)}`;
    if (!time) { out.why = rawTime ? '시간 못 읽음' : '시간 없음'; return out; }
    out.ok = true; return out;
}
const optKind = (name) => /입장/.test(String(name || '')) ? 'entry' : 'exp';

// ── 플레이스 메일 판독(꼴은 첫 실메일로 확정 · 그 전엔 최선 · 못 읽으면 「꼴 모름」 = 원문만) ──
function parsePlaceMail(subject, text) {
    const s = String(text || ''), sub = String(subject || '');
    const pick = (re) => { const m = re.exec(s); return m ? m[1].trim() : null; };
    const no = pick(/예약\s*번호\s*[:：]?\s*([0-9A-Za-z\-]{5,30})/);
    const name = pick(/(?:예약자(?:\s*명)?|이용자|성함|이름)\s*[:：]?\s*([^\n\r|]{1,30})/);
    const phone = pick(/(?:연락처|전화\s*번호|휴대\s*폰(?:\s*번호)?|핸드폰)\s*[:：]?\s*([0-9*\-\s]{9,20})/);
    const when = pick(/(?:이용\s*일시|예약\s*일시|방문\s*일시|이용\s*일자|예약\s*일자|일시)\s*[:：]?\s*([^\n\r]{6,60})/);
    const status = /취소/.test(sub) ? 'canceled' : /변경/.test(sub) ? 'changed' : /(확정|신청|접수|완료|예약)/.test(sub) ? 'confirmed' : null;
    let date = null, time = null;
    if (when) {
        let m = /(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})\s*일?/.exec(when), end = m ? m.index + m[0].length : 0;
        if (!m) { const m2 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(when); if (m2) { m = [null, String(kstNow().getUTCFullYear()), m2[1], m2[2]]; end = m2.index + m2[0].length; } }
        if (m && validYmd(+m[1], +m[2], +m[3])) date = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
        const rest = m ? when.slice(end) : when;   // 날짜 뒤 글자에서만 시각을 찾는다(「2026」 의 숫자를 시각으로 읽지 않게)
        time = parseTime(rest.replace(/^[^0-9오]*?(?=(오전|오후|\d))/, '').replace(/\(.\)/, ''));
    }
    const cnt = (re) => { const v = pick(re); return v == null ? null : +v; };
    const adult = cnt(/(?:성인|어른|대인|체험)\s*[:：]?\s*(\d{1,3})\s*(?:명|인)?/);
    const entry = cnt(/(?:입장)\s*[:：]?\s*(\d{1,3})\s*(?:명|인)?/);
    const infant = cnt(/(?:유아|영유아|아동|소인|어린이)\s*[:：]?\s*(\d{1,3})\s*(?:명|인)?/);
    const total = cnt(/(?:인원|총\s*인원)\s*[:：]?\s*(\d{1,3})\s*(?:명|인)/);
    const amount = (() => { const v = pick(/(?:결제\s*금액|총\s*금액|금액)\s*[:：]?\s*([\d,]{3,12})\s*원/); return v ? +v.replace(/,/g, '') : null; })();
    const known = !!(no && status);
    return { known, no, name, phone: phone ? digits(phone) : null, date, time, status, exp: adult != null ? adult : (total != null ? total : null), entry, infant, amount, date_ok: !!(date && time) };
}

// ── 아주 작은 IMAP 읽기 전용 클라이언트(내장 tls · LOGIN/EXAMINE/UID SEARCH/UID FETCH/LOGOUT 만 · 쓰기 명령 없음) ──
function imapOpen({ host, port, user, pass, timeoutMs, connect }) {   // connect = 검증용 가짜 소켓(없으면 tls)
    return new Promise((resolve, reject) => {
        const sock = (connect || tls.connect)({ host, port, servername: host });
        let buf = Buffer.alloc(0), tagN = 0, cur = null, need = 0, parts = [], greeted = false, closed = false;
        const pending = [];
        const timer = setTimeout(() => { fail(new Error('IMAP 시간 초과')); }, timeoutMs || 30000);
        const fail = (e) => { if (closed) return; closed = true; clearTimeout(timer); try { sock.destroy(); } catch (_) { } if (!greeted) reject(e); while (pending.length) pending.shift().reject(e); };
        const onResp = (resp) => {   // resp = { text, literals[] }
            if (!greeted) { greeted = true; if (/^\* (OK|PREAUTH)/i.test(resp.text)) resolve(api); else fail(new Error('IMAP 인사 실패')); return; }
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
                const resp = { text: parts.filter(x => x.text != null).map(x => x.text).join(''), literals: parts.filter(x => x.lit).map(x => x.lit) };
                parts = []; onResp(resp);
            }
        });
        sock.on('error', fail);
        sock.on('close', () => fail(new Error('IMAP 연결 끊김')));
        const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        const cmd = (c) => new Promise((res, rej) => { if (closed) return rej(new Error('IMAP 닫힘')); const tag = 'X' + (++tagN); pending.push({ tag, items: [], resolve: res, reject: rej }); sock.write(tag + ' ' + c + '\r\n'); });
        const api = {
            login: () => cmd('LOGIN ' + q(user) + ' ' + q(pass)),
            examine: (box) => cmd('EXAMINE ' + q(box || 'INBOX')),   // 읽기 전용 열기(\Seen 등 깃발이 안 바뀜)
            search: async (crit) => { const items = await cmd('UID SEARCH ' + crit); const ln = items.map(x => x.text).find(t => /^\* SEARCH/i.test(t)) || ''; return ln.replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number); },
            fetch: async (uid, what) => { const items = await cmd('UID FETCH ' + uid + ' (' + what + ')'); const it = items.find(x => x.literals && x.literals.length); return it ? it.literals[0] : null; },   // what = BODY.PEEK[…] 만 넘긴다
            status: async (box) => { const items = await cmd('STATUS ' + q(box || 'INBOX') + ' (MESSAGES)'); const ln = items.map(x => x.text).find(t => /MESSAGES/i.test(t)) || ''; const m = /MESSAGES (\d+)/i.exec(ln); return m ? +m[1] : null; },
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
const maskSubject = (s) => String(s || '').replace(/\d/g, '#').replace(/([가-힣])[가-힣]{1,3}(?=\s*님)/g, '$1**').slice(0, 80);

// ── 알림톡 변수(꼴 = 총괄 10/20: 방문일시 「11월 30일(일) 12:30」 · 인원 「체험 2명 · 입장 1명」 · 0명 칸은 뺌 · 유아 있으면 뒤에) ──
function alimVars(b) {
    const [, mo, da] = String(b.visit_date || '').split('-');
    const people = [Number(b.exp_count) > 0 ? `체험 ${b.exp_count}명` : '', Number(b.entry_count) > 0 ? `입장 ${b.entry_count}명` : '', Number(b.infant_count) > 0 ? `유아 ${b.infant_count}명` : ''].filter(Boolean).join(' · ');
    return { '고객명': b.name || '', '방문일시': mo && da && b.visit_time ? `${+mo}월 ${+da}일(${dowOf(b.visit_date)}) ${b.visit_time}` : '', '인원': people };
}
// 원문의 #{변수} 를 전부 채운 글 — 하나라도 빈 값이면 null(알림톡 대신 LMS · 줄을 빼면 원문과 달라져 거절됨)
function fillAlim(content, vars) {
    let miss = false;
    const out = String(content).replace(/#\{(.+?)\}/g, (m, k) => { const v = vars[k]; if (v == null || !String(v).trim()) { miss = true; return m; } return String(v); });
    return miss ? null : out;
}

// ── 문자 문구 ───────────────────────────────────────────────────────────
function renderTpl(tpl, b) {
    const [, mo, da] = String(b.visit_date || '').split('-');
    const inf = Number(b.infant_count) > 0 ? ` · 유아 ${b.infant_count}명` : '';
    return String(tpl || '').replace(/\{이름\}/g, b.name || '고객').replace(/\{월\}/g, mo ? String(+mo) : '').replace(/\{일\}/g, da ? String(+da) : '')
        .replace(/\{시간\}/g, b.visit_time || '').replace(/\{체험\}/g, String(b.exp_count || 0)).replace(/\{입장\}/g, String(b.entry_count || 0)).replace(/\{유아\}/g, inf)
        .replace(/\{요일\}/g, b.visit_date ? dowOf(b.visit_date) : '');
}

module.exports = function mountExperience(app, deps) {
    const { pool, authMiddleware, adminOnly, writeAudit } = deps;
    const env = deps.env || process.env;
    const audit = (action, id, changes, actor) => { try { return writeAudit({ action, targetType: 'experience', targetId: id || null, changes, source: 'experience', actor }); } catch (e) { return null; } };
    const cfgGet = async (k) => { const r = await pool.query('SELECT value FROM agent_office_config WHERE key=$1', [k]); return r.rows.length ? r.rows[0].value : null; };
    const cfgSet = async (k, v) => pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
    const notifyCfg = async () => {
        const v = (await cfgGet(KEY_NOTIFY)) || {}, va = (v && typeof v.alimtalk === 'object' && v.alimtalk) || {};
        return { ...NOTIFY_DEFAULT, ...(typeof v === 'object' ? v : {}), enabled: v && v.enabled === true, alimtalk: { ...NOTIFY_DEFAULT.alimtalk, ...va, enabled: va.enabled === true } };
    };
    const mailCfg = async () => { const v = (await cfgGet(KEY_MAIL)) || {}; const terms = Array.isArray(v.from_terms) ? v.from_terms.map(x => String(x).trim()).filter(x => /^[\x21-\x7e]{3,60}$/.test(x)).slice(0, 8) : MAIL_DEFAULT.from_terms; return { ...MAIL_DEFAULT, ...v, from_terms: terms.length ? terms : MAIL_DEFAULT.from_terms }; };

    const ready = (deps.skipInit ? Promise.resolve() : (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS experience_bookings (
            id SERIAL PRIMARY KEY,
            source VARCHAR(10) NOT NULL,                 -- store | place
            ext_key VARCHAR(120) NOT NULL UNIQUE,        -- store:<주문번호> | place:<예약번호> | placemail:<Message-ID>(꼴 모름)
            order_no VARCHAR(60),
            name VARCHAR(80), phone VARCHAR(20),
            visit_date DATE, visit_time VARCHAR(5),
            exp_count INTEGER NOT NULL DEFAULT 0, entry_count INTEGER NOT NULL DEFAULT 0, infant_count INTEGER NOT NULL DEFAULT 0,
            amount INTEGER,
            status VARCHAR(12) NOT NULL DEFAULT 'confirmed',   -- confirmed | canceled | returned | visited | unknown(메일 꼴 모름)
            date_ok BOOLEAN NOT NULL DEFAULT FALSE, date_why VARCHAR(40), date_fixed BOOLEAN NOT NULL DEFAULT FALSE,
            option_text TEXT, raw TEXT, items JSONB NOT NULL DEFAULT '{}'::jsonb,
            memo TEXT,
            sms_recv_at TIMESTAMPTZ, sms_eve_at TIMESTAMPTZ, sms_error TEXT,
            visited_at TIMESTAMPTZ, visited_by VARCHAR(60),
            ordered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS experience_bookings_visit ON experience_bookings (visit_date)`);
        // 문자 잡기·시도 횟수(중복 발송 방지 · 3번 실패면 멈춤) · 건너뜀 사유(refused = 문자봇 수신거부 기억 · 하루 상한에 안 셈)
        for (const c of ['sms_recv_try_at TIMESTAMPTZ', 'sms_recv_tries INTEGER NOT NULL DEFAULT 0', 'sms_eve_try_at TIMESTAMPTZ', 'sms_eve_tries INTEGER NOT NULL DEFAULT 0', 'sms_skip VARCHAR(20)'])
            await pool.query(`ALTER TABLE experience_bookings ADD COLUMN IF NOT EXISTS ${c}`);
        await pool.query(`CREATE TABLE IF NOT EXISTS experience_mail_seen (message_id VARCHAR(200) PRIMARY KEY, uid BIGINT, booking_id INTEGER, state VARCHAR(16), seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    })().catch(e => console.error('[#775] 표 준비 실패:', e.message)));

    // ── 스토어 수집 ─────────────────────────────────────────────────────
    //   ① 네이버 변경 목록(체크포인트 · 60분 되감기) 의 결제·클레임 ② #775-A 가 주문안내에서 뺀 체험 줄(kakao_notify_log status experience · 60일) ③ 이미 받은 예약의 상품주문
    //   → 상세조회(100건씩) → 체험 상품만 주문 번호로 묶어 저장 · 직원이 고친 날짜(date_fixed)는 덮지 않음
    async function upsertStore(group) {
        const key = 'store:' + group.orderId;
        const old = (await pool.query('SELECT * FROM experience_bookings WHERE ext_key=$1', [key])).rows[0];
        const items = Object.assign({}, old ? old.items : {}, group.items);
        const live = Object.values(items).filter(x => !x.gone);
        const sum = k => live.filter(x => x.kind === k).reduce((a, x) => a + (Number(x.qty) || 0), 0);
        const amount = live.reduce((a, x) => a + (Number(x.amount) || 0), 0);
        const anyReturn = Object.values(items).some(x => x.gone === 'returned');
        let status = old ? old.status : 'confirmed';
        if (!live.length) status = anyReturn ? 'returned' : 'canceled';
        else if (status === 'canceled' || status === 'returned') status = 'confirmed';
        // 날짜 = 살아 있는 줄들의 판독 · 서로 다르면 확인 필요
        let pd = null, why = '';
        const parsed = live.map(x => x.parsed).filter(Boolean);
        if (parsed.length) {
            const sig = new Set(parsed.map(p => (p.date || '?') + ' ' + (p.time || '?')));
            pd = parsed.find(p => p.ok) || parsed[0];
            if (sig.size > 1) { why = '옵션마다 날짜 다름'; pd = { ...pd, ok: false }; }
            else why = pd.ok ? '' : pd.why;
        }
        const fixed = old && old.date_fixed;
        const vals = {
            name: group.name || (old && old.name) || null, phone: group.phone || (old && old.phone) || null,
            visit_date: fixed ? old.visit_date : (pd && pd.date) || null, visit_time: fixed ? old.visit_time : (pd && pd.time) || null,
            date_ok: fixed ? true : !!(pd && pd.ok), date_why: fixed ? null : (why || null),
            exp_count: sum('exp'), entry_count: sum('entry'), amount, status,
            option_text: live.map(x => x.option_text).filter(Boolean).join('\n').slice(0, 2000) || (old && old.option_text) || null,
        };
        if (old) {
            await pool.query(`UPDATE experience_bookings SET name=$2, phone=$3, visit_date=$4, visit_time=$5, date_ok=$6, date_why=$7, exp_count=$8, entry_count=$9, amount=$10, status=$11, option_text=$12, items=$13::jsonb, updated_at=NOW() WHERE id=$1`,
                [old.id, vals.name, vals.phone, vals.visit_date, vals.visit_time, vals.date_ok, vals.date_why, vals.exp_count, vals.entry_count, vals.amount, vals.status, vals.option_text, JSON.stringify(items)]);
            return { id: old.id, created: false, status: vals.status, prev: old.status };
        }
        const r = await pool.query(`INSERT INTO experience_bookings (source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, amount, status, option_text, items, ordered_at)
            VALUES ('store',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) ON CONFLICT (ext_key) DO NOTHING RETURNING id`,
            [key, group.orderId, vals.name, vals.phone, vals.visit_date, vals.visit_time, vals.date_ok, vals.date_why, vals.exp_count, vals.entry_count, vals.amount, vals.status, vals.option_text, JSON.stringify(items), group.orderedAt ? new Date(group.orderedAt) : null]);
        return { id: r.rows[0] && r.rows[0].id, created: true, status: vals.status };
    }
    async function collectStore() {
        await ready;
        const now = Date.now();
        const cp = await deps.naverCfgGet('experience_store_checkpoint');
        const fromMs = Math.max((cp ? Date.parse(cp) : now - 3600 * 1000) - 60 * 60 * 1000, now - 23.5 * 3600 * 1000);
        const list = await deps.naverFetchChanges(deps.naverKstIso(fromMs), deps.naverKstIso(now));
        await deps.naverCfgSet('experience_store_checkpoint', new Date(now).toISOString());
        const ids = new Set();
        for (const x of list) { const id = String(x.productOrderId || ''); if (!id) continue; if (String(x.lastChangedType || '') === 'PAYED' || /CANCEL|RETURN|EXCHANGE/i.test(String(x.claimType || '') + ' ' + String(x.claimStatus || '') + ' ' + String(x.lastChangedType || ''))) ids.add(id); }
        // 이미 받은 예약의 상품주문 중 이번 변경 목록에 있는 것(구매확정·배송완료 등 상태 바뀜)
        const changed = list.map(x => String(x.productOrderId || '')).filter(Boolean);
        if (changed.length) { const k = await pool.query(`SELECT jsonb_object_keys(items) AS k FROM experience_bookings WHERE source='store' AND items ?| $1::text[]`, [changed]); for (const r of k.rows) if (changed.includes(r.k)) ids.add(r.k); }
        // #775-A 가 주문안내에서 뺀 체험 줄 가운데 아직 예약 표에 없는 것(배포 전·체크포인트 밖 주문 받기)
        const miss = await pool.query(`SELECT k.order_key FROM kakao_notify_log k WHERE k.status='experience' AND k.created_at > NOW() - interval '60 days'
            AND NOT EXISTS (SELECT 1 FROM experience_bookings b WHERE b.source='store' AND b.items ? k.order_key) LIMIT 200`);
        for (const r of miss.rows) ids.add(String(r.order_key));
        if (!ids.size) return '체험 주문 변경 0';
        const expIds = await deps.experienceProductIds();
        const groups = new Map(); let seenExp = 0;
        const arr = [...ids];
        for (let i = 0; i < arr.length; i += 100) {
            if (i) await new Promise(r => setTimeout(r, 350));
            const r = await deps.naverCall({ method: 'POST', path: '/external/v1/pay-order/seller/product-orders/query', body: { productOrderIds: arr.slice(i, i + 100) } });
            const body = (r && r.data) ? r.data : r;
            const items = body?.data || body?.list || (Array.isArray(body) ? body : []) || [];
            for (const it of (Array.isArray(items) ? items : [])) {
                const c = it.content || it, po = c.productOrder || it.productOrder || c, od = c.order || it.order || po.order || {};
                if (!deps.isExperienceOrder(po, expIds)) continue;
                seenExp++;
                const poid = String(po.productOrderId || ''), orderId = String(od.orderId || po.orderId || poid);
                const st = String(po.productOrderStatus || ''), claim = (String(po.claimType || '') + ' ' + String(po.claimStatus || '')).trim();
                const gone = /RETURN/i.test(claim) && /DONE|COMPLETE|REQUEST|COLLECT|APPROV/i.test(claim) || st === 'RETURNED' ? 'returned' : (st === 'CANCELED' || /CANCEL/i.test(claim) && /DONE|REQUEST|APPROV/i.test(claim)) ? 'canceled' : null;
                const remain = Number(po.remainQuantity), qty = Number.isFinite(remain) && remain >= 0 ? remain : (Number(po.quantity) || 1);
                const opt = String(po.productOption || '');
                const parsed = parseStoreOption(opt, Date.parse(od.paymentDate || od.orderDate || '') || null);
                let tel = od.ordererTel || (po.shippingAddress && (po.shippingAddress.tel1 || po.shippingAddress.tel2)) || '';
                if (!digits(tel) && deps.resolveReceiver) { try { tel = await deps.resolveReceiver(tel, poid); } catch (_) { } }
                const g = groups.get(orderId) || { orderId, name: od.ordererName || null, phone: null, orderedAt: od.paymentDate || od.orderDate || null, items: {} };
                const dg = digits(tel); if (dg.length >= 10 && !(deps.isMaskedTel && deps.isMaskedTel(tel))) g.phone = dg;
                g.items[poid] = { kind: optKind(parsed.option || opt), qty: gone || qty === 0 ? 0 : qty, amount: gone ? 0 : (Number(po.totalPaymentAmount) || 0), status: st, claim, gone, option_text: opt.slice(0, 400), parsed };
                groups.set(orderId, g);
            }
        }
        let made = 0, upd = 0, canceled = 0, needCheck = 0;
        for (const g of groups.values()) {
            const r = await upsertStore(g);
            if (r.created) made++; else upd++;
            if ((r.status === 'canceled' || r.status === 'returned') && r.prev !== r.status) canceled++;
            const row = (await pool.query('SELECT date_ok FROM experience_bookings WHERE id=$1', [r.id])).rows[0]; if (row && !row.date_ok) needCheck++;
        }
        if (made || canceled) await audit('experience_store_collect', null, { after: { made, upd, canceled, need_check: needCheck } }, { id: null, name: '체험 예약 수집' });
        return `체험 주문 ${seenExp}줄 · 예약 새로 ${made} · 고침 ${upd} · 취소·반품 ${canceled}${needCheck ? ' · 날짜 확인 필요 ' + needCheck : ''}`;
    }

    // ── 플레이스 메일 수집 ───────────────────────────────────────────────
    const mailCreds = () => ({ user: env.NAVER_MAIL_USER || '', pass: env.NAVER_MAIL_APP_PW || '' });
    async function withImap(fn) {
        const { user, pass } = mailCreds();
        if (!user || !pass) { const e = new Error('메일 설정 없음(NAVER_MAIL_USER/NAVER_MAIL_APP_PW)'); e.noCreds = true; throw e; }
        const hide = (e) => new Error(String(e && e.message || e).split(pass).join('(비밀값)').split(user).join('(메일 계정)').slice(0, 200));
        let im;
        try { im = await (deps.imapOpen || imapOpen)({ host: 'imap.naver.com', port: 993, user, pass, timeoutMs: 40000 }); } catch (e) { throw hide(e); }
        try { await im.login(); await im.examine('INBOX'); return await fn(im); }
        catch (e) { throw hide(e); }
        finally { await im.close(); }
    }
    async function savePlace(mail, uid) {
        const p = parsePlaceMail(mail.subject, mail.text);
        if (!p.known) {   // 꼴 모름 = 원문만(직원·총괄이 보고 파서를 맞춤)
            const key = 'placemail:' + (mail.messageId || ('uid' + uid));
            const r = await pool.query(`INSERT INTO experience_bookings (source, ext_key, status, date_ok, date_why, raw) VALUES ('place',$1,'unknown',FALSE,'메일 꼴 모름',$2) ON CONFLICT (ext_key) DO NOTHING RETURNING id`,
                [key, ('제목: ' + mail.subject + '\n' + mail.text).slice(0, 20000)]);
            return { state: 'unknown', id: r.rows[0] && r.rows[0].id };
        }
        const key = 'place:' + p.no;
        const old = (await pool.query('SELECT * FROM experience_bookings WHERE ext_key=$1', [key])).rows[0];
        const raw = ('제목: ' + mail.subject + '\n' + mail.text).slice(0, 20000);
        if (old) {
            const fixed = old.date_fixed;
            const status = p.status === 'canceled' ? 'canceled' : (old.status === 'visited' ? 'visited' : 'confirmed');
            await pool.query(`UPDATE experience_bookings SET status=$2, name=COALESCE($3,name), phone=COALESCE($4,phone), visit_date=$5, visit_time=$6, date_ok=$7, date_why=$8,
                exp_count=COALESCE($9,exp_count), entry_count=COALESCE($10,entry_count), infant_count=COALESCE($11,infant_count), amount=COALESCE($12,amount), raw=$13, updated_at=NOW() WHERE id=$1`,
                [old.id, status, p.name, p.phone, fixed ? old.visit_date : (p.date || old.visit_date), fixed ? old.visit_time : (p.time || old.visit_time), fixed ? true : p.date_ok, fixed ? null : (p.date_ok ? null : '메일 날짜 못 읽음'),
                    p.exp, p.entry, p.infant, p.amount, raw]);
            return { state: p.status === 'canceled' ? 'canceled' : 'updated', id: old.id };
        }
        const r = await pool.query(`INSERT INTO experience_bookings (source, ext_key, order_no, name, phone, visit_date, visit_time, date_ok, date_why, exp_count, entry_count, infant_count, amount, status, raw)
            VALUES ('place',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (ext_key) DO NOTHING RETURNING id`,
            [key, p.no, p.name, p.phone, p.date, p.time, p.date_ok, p.date_ok ? null : '메일 날짜 못 읽음', p.exp || 0, p.entry || 0, p.infant || 0, p.amount, p.status === 'canceled' ? 'canceled' : 'confirmed', raw]);
        return { state: 'new', id: r.rows[0] && r.rows[0].id };
    }
    async function collectPlace() {
        await ready;
        const c = await mailCfg();
        let res;
        try {
            res = await withImap(async (im) => {
                const uids = await im.search('SINCE ' + imapDate(Date.now() - c.days * 86400000) + ' ' + imapFromCrit(c.from_terms));
                const out = { found: uids.length, done: 0, unknown: 0, canceled: 0, skip: 0 };
                for (const uid of uids.slice(-c.max_per_tick)) {
                    const hdr = await im.fetch(uid, 'BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)]');
                    const mid = (hdr ? hdr.toString('latin1') : '').replace(/^message-id:\s*/i, '').replace(/[<>\s]/g, '').slice(0, 200) || ('uid' + uid);
                    if ((await pool.query('SELECT 1 FROM experience_mail_seen WHERE message_id=$1', [mid])).rows.length) { out.skip++; continue; }
                    const raw = await im.fetch(uid, 'BODY.PEEK[]');
                    if (!raw || raw.length > 2 * 1024 * 1024) { await pool.query('INSERT INTO experience_mail_seen (message_id, uid, state) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mid, uid, 'too-big']); continue; }
                    const mail = parseMail(raw); if (!mail.messageId) mail.messageId = mid;
                    const s = await savePlace(mail, uid);
                    await pool.query('INSERT INTO experience_mail_seen (message_id, uid, booking_id, state) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [mid, uid, s.id || null, s.state]);
                    out.done++; if (s.state === 'unknown') out.unknown++; if (s.state === 'canceled') out.canceled++;
                }
                return out;
            });
        } catch (e) { if (e.noCreds) return '메일 설정 없음 — 건너뜀'; throw e; }
        if (res.unknown && deps.notifyTelegram) deps.notifyTelegram(`🍊 체험 예약 메일 ${res.unknown}통을 읽지 못해 원문만 저장했어요(꼴 모름) — 에이전트 오피스 · 체험 예약에서 확인`);
        return `예약 메일 ${res.found}통 · 새로 읽음 ${res.done}(꼴 모름 ${res.unknown} · 취소 ${res.canceled}) · 이미 읽음 ${res.skip}`;
    }
    // 메일 확인 러너(1회 · 결과에 비밀값·본문·손님 정보 없음)
    async function mailProbe() {
        return withImap(async (im) => {
            const out = { at: new Date().toISOString(), inbox: await im.status('INBOX'), since_days: 30, terms: {}, latest: null };
            const since = 'SINCE ' + imapDate(Date.now() - 30 * 86400000);
            let best = null;
            for (const t of MAIL_PROBE_TERMS) { const u = await im.search(since + ' FROM "' + t + '"'); out.terms[t] = u.length; if (t !== 'naver' && u.length && !best) best = u[u.length - 1]; }
            if (best) {
                const h = await im.fetch(best, 'BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]');
                const hh = headers(h ? h.toString('latin1') : '');
                out.latest = { from: fromAddr(decodeWords(hh.from)), subject_masked: maskSubject(decodeWords(hh.subject)), date: hh.date || null };
            }
            return out;
        });
    }

    // ── 손님 안내 문자(스토어만 · 꺼짐이 기본) ─────────────────────────────
    async function refused(phone) {
        try { return (await pool.query(`SELECT 1 FROM sms_messages m JOIN sms_threads t ON t.id = m.thread_id WHERE t.phone_digits = $1 AND m.direction = 'in' AND m.bucket = 'refuse' AND m.created_at > now() - interval '180 days' LIMIT 1`, [phone])).rows.length > 0; }
        catch (_) { return false; }
    }
    // 시간 창(KST HH:MM) — 접수 문자 = recv_from~recv_to(기본 09~21 · 창 밖 접수는 다음 창 시작 때) · 전날 문자 = eve_from~eve_to(기본 10~18)
    const inRange = (from, to) => { const k = kstNow(), hm = pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes()); return hm >= from && hm < to; };
    // 보내기 전에 줄을 먼저 잡는다(두 틱·두 서버가 같은 줄을 동시에 보내지 않게) — 30분 안에 잡은 줄·3번 시도한 줄은 안 잡힘 · 잡힌 것만 보냄
    const CLAIM = {
        recv: `UPDATE experience_bookings SET sms_recv_try_at=NOW(), sms_recv_tries=sms_recv_tries+1 WHERE id=$1 AND sms_recv_at IS NULL AND sms_skip IS NULL AND (sms_recv_try_at IS NULL OR sms_recv_try_at < NOW() - interval '30 min') AND sms_recv_tries < 3 RETURNING id`,
        eve: `UPDATE experience_bookings SET sms_eve_try_at=NOW(), sms_eve_tries=sms_eve_tries+1 WHERE id=$1 AND sms_eve_at IS NULL AND sms_skip IS NULL AND (sms_eve_try_at IS NULL OR sms_eve_try_at < NOW() - interval '30 min') AND sms_eve_tries < 3 RETURNING id`,
    };
    async function sendOne(b, kind, c) {
        const msg = renderTpl(kind === 'recv' ? c.tpl_recv : c.tpl_eve, b);
        const col = kind === 'recv' ? 'sms_recv_at' : 'sms_eve_at';
        // 수신거부 기억 = 이 예약엔 문자를 더 안 보냄(sms_skip · 하루 상한 셈에 안 들어감 · 화면 「수신거부」)
        if (await refused(b.phone)) { await pool.query(`UPDATE experience_bookings SET sms_skip='refused', sms_error=$2 WHERE id=$1`, [b.id, '수신거부 기억 — 문자 안 보냄']); return 'refused'; }
        if (!(await pool.query(CLAIM[kind], [b.id])).rows.length) return 'skip';   // 다른 틱이 잡았거나 3번 실패
        // 알림톡(설정 alimtalk.enabled · 템플릿 원문 있음 · 변수 다 참) → 실패하면 알리고가 LMS 로 대체(failover = 위 문자 전문) · 그 밖 = LMS 바로
        const at = c.alimtalk || {}, code = kind === 'recv' ? at.confirm_tpl : at.remind_tpl, tpl = (deps.alimTemplates || EXP_ALIMTALK)[code];
        const alimMsg = at.enabled === true && tpl && tpl.content ? fillAlim(tpl.content, alimVars(b)) : null;
        let res;
        try {
            res = alimMsg
                ? await deps.kakaoNotify.sendAlimtalk({ receiver: b.phone, subject: '제주아꼼이네 체험 예약', message: alimMsg, failoverMessage: msg, tplCode: code, buttons: tpl.button || undefined })
                : await deps.kakaoNotify.sendLms({ receiver: b.phone, subject: '제주아꼼이네 체험 예약', message: msg, ...(c.sender ? { sender: c.sender } : {}) });
        } catch (e) { res = { status: 'failed', error: String(e.message || e) }; }
        if (res && res.status === 'sent') { await pool.query(`UPDATE experience_bookings SET ${col}=NOW(), sms_error=NULL WHERE id=$1`, [b.id]); return 'sent'; }
        await pool.query(`UPDATE experience_bookings SET sms_error=$2 WHERE id=$1`, [b.id, (kind + ': ' + (res && (res.status + ' ' + (res.error || ''))) || '실패').slice(0, 200)]);
        return 'failed';
    }
    async function collectSms() {
        await ready;
        const c = await notifyCfg();
        if (!c.enabled) return '손님 문자 꺼짐(설정 experience_notify)';
        const today = kstDay(), tomorrow = addDays(today, 1);
        // 하루 상한 = 오늘 실제로 보낸 것만(수신거부 건너뜀·실패는 안 셈)
        const sentToday = Number((await pool.query(`SELECT (COUNT(*) FILTER (WHERE (sms_recv_at + interval '9 hours')::date = $1::date) + COUNT(*) FILTER (WHERE (sms_eve_at + interval '9 hours')::date = $1::date))::int AS n FROM experience_bookings`, [today])).rows[0].n) || 0;
        let room = Math.max(0, Number(c.daily_cap) - sentToday);
        if (!room) return `손님 문자 하루 상한(${c.daily_cap}) 다 씀`;
        const base = `source='store' AND status='confirmed' AND date_ok AND phone IS NOT NULL AND length(phone) >= 10 AND visit_date >= $1::date AND sms_skip IS NULL`;
        const recvOn = inRange(c.recv_from, c.recv_to), eveOn = inRange(c.eve_from, c.eve_to);
        const recv = recvOn ? (await pool.query(`SELECT * FROM experience_bookings WHERE ${base} AND sms_recv_at IS NULL AND sms_recv_tries < 3 AND (sms_recv_try_at IS NULL OR sms_recv_try_at < NOW() - interval '30 min') ORDER BY id LIMIT 20`, [today])).rows : [];
        // 전날 문자는 접수 문자가 끝난 예약만(보냈거나 3번 실패) — 같은 틱에 두 통이 몰리지 않게
        const eve = eveOn ? (await pool.query(`SELECT * FROM experience_bookings WHERE ${base} AND visit_date = $2::date AND sms_eve_at IS NULL AND sms_eve_tries < 3 AND (sms_eve_try_at IS NULL OR sms_eve_try_at < NOW() - interval '30 min') AND (sms_recv_at IS NOT NULL OR sms_recv_tries >= 3) ORDER BY id LIMIT 30`, [today, tomorrow])).rows : [];
        const n = { sent: 0, failed: 0, refused: 0, skip: 0 };
        for (const b of recv) { if (!room) break; const r = await sendOne(b, 'recv', c); n[r]++; if (r === 'sent') room--; }
        for (const b of eve) { if (!room) break; const r = await sendOne(b, 'eve', c); n[r]++; if (r === 'sent') room--; }
        return `손님 문자 보냄 ${n.sent} · 실패 ${n.failed} · 수신거부 건너뜀 ${n.refused}${recvOn ? '' : ' · 접수 문자 시간 밖'}${eveOn ? '' : ' · 전날 문자 시간 밖'}`;
    }

    // ── 화면 API ─────────────────────────────────────────────────────────
    const ROW_COLS = `id, source, order_no, name, phone, to_char(visit_date,'YYYY-MM-DD') AS visit_date, visit_time, exp_count, entry_count, infant_count, amount, status, date_ok, date_why, date_fixed, option_text, memo,
        sms_recv_at, sms_eve_at, sms_error, sms_recv_tries, sms_eve_tries, sms_skip, visited_at, visited_by, ordered_at, created_at, (raw IS NOT NULL) AS has_raw`;
    async function summary() {
        await ready;
        const today = kstDay(), tomorrow = addDays(today, 1);
        const r = (await pool.query(`SELECT
              COUNT(*) FILTER (WHERE visit_date = $1::date AND status IN ('confirmed','visited'))::int AS today,
              COUNT(*) FILTER (WHERE visit_date = $2::date AND status = 'confirmed')::int AS tomorrow,
              COALESCE(SUM(exp_count + entry_count + infant_count) FILTER (WHERE visit_date = $1::date AND status IN ('confirmed','visited')),0)::int AS today_people,
              COALESCE(SUM(exp_count + entry_count + infant_count) FILTER (WHERE visit_date = $2::date AND status = 'confirmed'),0)::int AS tomorrow_people,
              COUNT(*) FILTER (WHERE status IN ('confirmed','unknown') AND NOT date_ok AND (visit_date IS NULL OR visit_date >= $1::date))::int AS need_check
            FROM experience_bookings`, [today, tomorrow])).rows[0];
        return { today_date: today, tomorrow_date: tomorrow, ...r };
    }
    async function todoLine() {
        const s = await summary();
        if (!s.today && !s.tomorrow && !s.need_check) return null;
        return { key: 'exp', label: `오늘 체험 ${s.today}팀 · 내일 ${s.tomorrow}팀${s.need_check ? ` · 날짜 확인 필요 ${s.need_check}` : ''}`, count: s.today + s.tomorrow + s.need_check, today: s.today, tomorrow: s.tomorrow, need_check: s.need_check, where: '에이전트 오피스 · 체험 예약' };
    }
    const actor = (req) => ({ id: req.user && req.user.id, name: req.user && (req.user.name || req.user.username) });
    const ymdOk = s => /^20\d{2}-\d{2}-\d{2}$/.test(String(s || ''));
    async function listRows(from, to) {
        return (await pool.query(`SELECT ${ROW_COLS} FROM experience_bookings
            WHERE (visit_date BETWEEN $1::date AND $2::date) OR (visit_date IS NULL AND created_at > NOW() - interval '60 days') OR (NOT date_ok AND status IN ('confirmed','unknown') AND created_at > NOW() - interval '60 days')
            ORDER BY visit_date NULLS FIRST, visit_time NULLS LAST, id LIMIT 2000`, [from, to])).rows;
    }
    app.get('/api/agent-office/experience', authMiddleware, async (req, res) => {
        try {
            await ready;
            const today = kstDay();
            const from = ymdOk(req.query.from) ? req.query.from : today, to = ymdOk(req.query.to) ? req.query.to : addDays(from, 13);
            const [items, sum, c] = await Promise.all([listRows(from, to), summary(), notifyCfg()]);
            res.json({ from, to, items, summary: sum, settings_view: { sms_enabled: c.enabled, daily_cap: c.daily_cap } });
        } catch (e) { console.error('[#775] 목록:', e.message); res.status(500).json({ error: '체험 예약을 읽지 못했어요' }); }
    });
    app.get('/api/agent-office/experience/export.xlsx', authMiddleware, async (req, res) => {
        try {
            await ready;
            const today = kstDay(); const from = ymdOk(req.query.from) ? req.query.from : today, to = ymdOk(req.query.to) ? req.query.to : addDays(from, 13);
            const rows = await listRows(from, to);
            const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('체험 예약');
            ws.columns = [{ header: '방문일', key: 'd', width: 12 }, { header: '요일', key: 'w', width: 5 }, { header: '시간', key: 't', width: 7 }, { header: '구분', key: 's', width: 8 }, { header: '이름', key: 'n', width: 10 }, { header: '연락처', key: 'p', width: 14 },
                { header: '체험', key: 'e', width: 6 }, { header: '입장', key: 'en', width: 6 }, { header: '유아', key: 'i', width: 6 }, { header: '금액', key: 'a', width: 10 }, { header: '상태', key: 'st', width: 8 }, { header: '날짜 확인', key: 'dk', width: 14 }, { header: '메모', key: 'm', width: 24 }, { header: '번호', key: 'no', width: 18 }];
            const ST = { confirmed: '확정', canceled: '취소', returned: '반품', visited: '방문', unknown: '확인 필요' };
            for (const r of rows) ws.addRow({ d: r.visit_date || '', w: r.visit_date ? dowOf(r.visit_date) : '', t: r.visit_time || '', s: r.source === 'store' ? '스토어' : '플레이스', n: r.name || '', p: r.phone || '', e: r.exp_count, en: r.entry_count, i: r.infant_count, a: r.amount, st: ST[r.status] || r.status, dk: r.date_ok ? '' : (r.date_why || '확인 필요'), m: r.memo || '', no: r.order_no || '' });
            ws.getRow(1).font = { bold: true };
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('체험예약_' + from + '_' + to + '.xlsx')}`);
            await wb.xlsx.write(res); res.end();
        } catch (e) { console.error('[#775] 엑셀:', e.message); if (!res.headersSent) res.status(500).json({ error: '엑셀을 만들지 못했어요' }); }
    });
    app.get('/api/agent-office/experience/settings', authMiddleware, async (req, res) => {
        try { const [c, m] = await Promise.all([notifyCfg(), mailCfg()]); res.json({ notify: c, mail: { from_terms: m.from_terms, days: m.days }, defaults: { tpl_recv: DEFAULT_TPL_RECV, tpl_eve: DEFAULT_TPL_EVE } }); }
        catch (e) { res.status(500).json({ error: '설정을 읽지 못했어요' }); }
    });
    app.put('/api/agent-office/experience/settings', authMiddleware, adminOnly, async (req, res) => {
        try {
            const b = req.body || {}, cur = await notifyCfg(), next = { ...cur };
            if ('enabled' in b) next.enabled = b.enabled === true;
            if ('daily_cap' in b) { const n = Math.floor(Number(b.daily_cap)); if (!(n >= 1 && n <= 300)) return res.status(400).json({ error: '하루 상한은 1~300' }); next.daily_cap = n; }
            for (const k of ['recv_from', 'recv_to', 'eve_from', 'eve_to']) if (k in b) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b[k]))) return res.status(400).json({ error: '시각은 HH:MM' }); next[k] = String(b[k]); }
            if ('sender' in b) { const d = String(b.sender || '').replace(/\D/g, ''); if (d && !/^0\d{8,11}$/.test(d)) return res.status(400).json({ error: '발신번호는 0 으로 시작하는 9~12자리(비우면 회사 기본 번호)' }); next.sender = d; }
            for (const k of ['tpl_recv', 'tpl_eve']) if (k in b) { const t = String(b[k] || '').trim(); if (t.length < 10 || t.length > 1500) return res.status(400).json({ error: '문구는 10~1500자' }); next[k] = t; }
            if (b.alimtalk && typeof b.alimtalk === 'object') {   // 알림톡(검수 승인 뒤 켬) — 켜기·템플릿 코드만 · 원문은 코드 상수(EXP_ALIMTALK)
                const a = { ...cur.alimtalk };
                if ('enabled' in b.alimtalk) a.enabled = b.alimtalk.enabled === true;
                for (const k of ['confirm_tpl', 'remind_tpl']) if (k in b.alimtalk) { const v = String(b.alimtalk[k] || ''); if (!/^U[A-Z]_\d{4}$/.test(v)) return res.status(400).json({ error: '템플릿 코드는 UM_6788 꼴' }); a[k] = v; }
                next.alimtalk = a;
            }
            await cfgSet(KEY_NOTIFY, next);
            await audit('experience_settings', null, { before: { enabled: cur.enabled, daily_cap: cur.daily_cap, alimtalk: cur.alimtalk }, after: { enabled: next.enabled, daily_cap: next.daily_cap, alimtalk: next.alimtalk, tpl_changed: next.tpl_recv !== cur.tpl_recv || next.tpl_eve !== cur.tpl_eve } }, actor(req));
            res.json({ ok: true, notify: next });
        } catch (e) { console.error('[#775] 설정 저장:', e.message); res.status(500).json({ error: '설정을 저장하지 못했어요' }); }
    });
    app.get('/api/agent-office/experience/:id/sms-preview', authMiddleware, async (req, res) => {
        try {
            const b = (await pool.query('SELECT *, to_char(visit_date,\'YYYY-MM-DD\') AS visit_date FROM experience_bookings WHERE id=$1', [Number(req.params.id) || 0])).rows[0];
            if (!b) return res.status(404).json({ error: '없는 예약이에요' });
            const c = await notifyCfg();
            const smsSafe = deps.kakaoNotify && deps.kakaoNotify.smsSafe ? deps.kakaoNotify.smsSafe : (s => s);
            res.json({ recv: smsSafe(renderTpl(c.tpl_recv, b)), eve: smsSafe(renderTpl(c.tpl_eve, b)), will_send: c.enabled && b.source === 'store' && b.date_ok && b.status === 'confirmed' && !!b.phone });
        } catch (e) { res.status(500).json({ error: '미리보기를 만들지 못했어요' }); }
    });
    app.get('/api/agent-office/experience/:id/raw', authMiddleware, async (req, res) => {
        try { const r = (await pool.query('SELECT raw FROM experience_bookings WHERE id=$1', [Number(req.params.id) || 0])).rows[0]; if (!r) return res.status(404).json({ error: '없는 예약이에요' }); res.json({ raw: r.raw || '' }); }
        catch (e) { res.status(500).json({ error: '원문을 읽지 못했어요' }); }
    });
    app.patch('/api/agent-office/experience/:id', authMiddleware, async (req, res) => {
        try {
            const id = Number(req.params.id) || 0, b = req.body || {};
            const old = (await pool.query(`SELECT id, to_char(visit_date,'YYYY-MM-DD') AS visit_date, visit_time, exp_count, entry_count, infant_count, memo, status FROM experience_bookings WHERE id=$1`, [id])).rows[0];
            if (!old) return res.status(404).json({ error: '없는 예약이에요' });
            const set = [], val = [id], ch = {};
            const put = (col, v) => { val.push(v); set.push(`${col}=$${val.length}`); ch[col] = v; };
            if ('visit_date' in b) { if (b.visit_date !== null && !ymdOk(b.visit_date)) return res.status(400).json({ error: '날짜는 YYYY-MM-DD' }); if (b.visit_date && !validYmd(+b.visit_date.slice(0, 4), +b.visit_date.slice(5, 7), +b.visit_date.slice(8, 10))) return res.status(400).json({ error: '없는 날짜예요' }); put('visit_date', b.visit_date); }
            if ('visit_time' in b) { const t = b.visit_time ? parseTime(b.visit_time) : null; if (b.visit_time && !t) return res.status(400).json({ error: '시간은 13:30 꼴로' }); put('visit_time', t); }
            for (const k of ['exp_count', 'entry_count', 'infant_count']) if (k in b) { const n = Math.floor(Number(b[k])); if (!(n >= 0 && n <= 200)) return res.status(400).json({ error: '인원은 0~200' }); put(k, n); }
            if ('memo' in b) put('memo', String(b.memo || '').slice(0, 500) || null);
            if ('status' in b) { if (!['confirmed', 'canceled', 'visited'].includes(b.status)) return res.status(400).json({ error: '상태는 확정·취소·방문' }); put('status', b.status); }
            if (!set.length) return res.status(400).json({ error: '바꿀 칸이 없어요' });
            if ('visit_date' in b || 'visit_time' in b) {   // 직원이 날짜·시간을 정함 = 확인 끝 · 수집이 다시 덮지 않음
                const nd = 'visit_date' in b ? b.visit_date : old.visit_date, nt = 'visit_time' in b ? ch.visit_time : old.visit_time;
                set.push(`date_fixed=TRUE`, `date_ok=${nd && nt ? 'TRUE' : 'FALSE'}`, `date_why=${nd && nt ? 'NULL' : "'시간 없음'"}`);
                if (nd !== old.visit_date) set.push('sms_eve_at=NULL');   // 날짜가 바뀌면 전날 문자를 새 날짜로
            }
            set.push('updated_at=NOW()');
            await pool.query(`UPDATE experience_bookings SET ${set.join(', ')} WHERE id=$1`, val);
            await audit('experience_edit', id, { before: old, after: ch }, actor(req));
            const row = (await pool.query(`SELECT ${ROW_COLS} FROM experience_bookings WHERE id=$1`, [id])).rows[0];
            res.json({ ok: true, item: row });
        } catch (e) { console.error('[#775] 고치기:', e.message); res.status(500).json({ error: '저장하지 못했어요' }); }
    });
    app.post('/api/agent-office/experience/:id/visit', authMiddleware, async (req, res) => {
        try {
            const id = Number(req.params.id) || 0, on = !!(req.body && req.body.on);
            const r = await pool.query(`UPDATE experience_bookings SET status = CASE WHEN $2 THEN 'visited' ELSE 'confirmed' END, visited_at = CASE WHEN $2 THEN NOW() ELSE NULL END, visited_by = CASE WHEN $2 THEN $3 ELSE NULL END, updated_at=NOW()
                WHERE id=$1 AND status IN ('confirmed','visited') RETURNING id`, [id, on, String(actor(req).name || '').slice(0, 60)]);
            if (!r.rows.length) return res.status(409).json({ error: '취소·반품된 예약은 방문 체크를 못 해요' });
            await audit('experience_visit', id, { after: { visited: on } }, actor(req));
            const row = (await pool.query(`SELECT ${ROW_COLS} FROM experience_bookings WHERE id=$1`, [id])).rows[0];
            res.json({ ok: true, item: row });
        } catch (e) { console.error('[#775] 방문:', e.message); res.status(500).json({ error: '저장하지 못했어요' }); }
    });

    // 메일 확인 러너(창구·총괄 요청 줄 · 60초)
    async function probeTick() {
        try {
            const req = await cfgGet('experience_mail_probe_request'); if (req == null) return;
            await pool.query(`DELETE FROM agent_office_config WHERE key = 'experience_mail_probe_request'`);
            let out; try { out = await mailProbe(); } catch (e) { out = { error: String(e.message || e).slice(0, 200) }; }
            await cfgSet('experience_mail_probe_result', out);
        } catch (e) { console.error('[#775] 메일 확인 러너:', e.message); }
    }
    if (!deps.noTimers) setInterval(probeTick, 60000);

    return { collectStore, collectPlace, collectSms, todoLine, summary, mailProbe, probeTick, ready, _t: { parseStoreOption, parseTime, parsePlaceMail, parseMail, renderTpl, imapFromCrit, upsertStore } };
};
module.exports._t = { parseStoreOption, parseTime, parsePlaceMail, parseMail, renderTpl, imapFromCrit, maskSubject, imapOpen, imapDate, alimVars, fillAlim, EXP_ALIMTALK };

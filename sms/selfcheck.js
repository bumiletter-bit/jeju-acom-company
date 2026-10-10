// #610-F 손님 셀프 조회 「내 주문 어디쯤?」 — 공개 페이지(로그인 없음 · noindex) · AI 호출 없음 · 문자 발송 없음
//   GET  /track-order            화면(받는 분 성함 + 번호 끝 4자리)
//   POST /api/track-order        { name, tail } → { ok, match:'one'|'many'|'none', order? }   · 시도 제한 넘으면 429
//   GET  /track-order/go?t=토큰   서버가 운송장 전체로 택배사 조회 페이지에 넘긴다(302)
//        🔴 운송장 전체가 밖으로 나가는 곳은 이 /go 응답의 Location 머리글 하나뿐이다(성함+끝자리를 맞춘 사람에게 · 10분). 화면·JSON 응답·토큰 글자에는 없다.
//   장착: require('./selfcheck.js')(app, { pool, lookup, cjTrack, holidays, log, secret?, contact?, limits?, notifyTelegram? })
//     pool      = pg Pool(.query)                    lookup = require('./lookup.js')(normalizeName · refreshOrder 를 쓴다)
//     cjTrack   = require('../cj-track.js')           holidays = async () => loadShippingHolidayInfo() 결과({ arriveOff:Set, reasons:Map })
//     secret    = 토큰·시도 기록 열쇠(없으면 JWT_SECRET · 그것도 없으면 켤 때 만든 임시 값 → 재시작하면 앞서 준 조회 링크는 만료)
//     contact   = 문의 번호(기본 010-6687-4031)       notifyTelegram = async (글) => …(전체 상한에 걸리면 1시간에 한 번)
//     limits    = { windowMin:10, perIp:5, perName:30, perTail:20, perAll:200, noneStreak:10, lockMin:60, maxRunning:8, days:30, minMs:300, tokenMin:10 }
//   시도 제한(F1 · 워커2 R2 반영) — 전부 windowMin(10분) 창 · 넘으면 429:
//     ip   같은 IP perIp 회          IP = cf-connecting-ip(Cloudflare) → x-forwarded-for 의 **마지막** 값(프록시가 붙인 값 · 손님이 꾸민 앞쪽 값은 안 믿는다) → req.ip
//     name 같은 성함 perName 회      tail 같은 끝 4자리 perTail 회(이름을 바꿔 가며 한 번호를 찍는 것)      all 전체 perAll 회(넘으면 텔레그램)
//     없음이 noneStreak 회 이어진 IP 는 lockMin 분 잠금(맞히면 처음부터) · 동시에 maxRunning 건까지만 조회(넘으면 429 「잠시 뒤」)
//   🔴 밖으로 안 나가는 것 = 주소 · 전화번호 전체 · 운송장 전체 · 받는 분 이름(입력한 글만 화면이 되비춘다 · 서버 응답에는 이름이 없다) · 거래처 · 기사 정보 · 배송메모.
//      SELECT 가 그 칸들을 아예 읽지 않고, 응답은 허용 목록(PUBLIC)만 싣는다.
//   🔴 DB 쓰기 = sms_selfcheck_hits(시도 횟수) 한 표뿐. 열쇠는 해시로만 적는다(IP·이름 원문을 남기지 않는다) · 하루 지난 줄은 조회 때 가끔 지운다.
//      (배송 상태가 2시간 넘게 낡았으면 lookup.refreshOrder 가 delivery_status 를 새로 적는다 — 그 쓰기는 lookup 것이다.)
const crypto = require('crypto');
const path = require('path');

const DEF = { windowMin: 10, perIp: 5, perName: 30, perTail: 20, perAll: 200, noneStreak: 10, lockMin: 60, maxRunning: 8, days: 30, minMs: 300, tokenMin: 10 };
// 시도 기록 정리 — 하루 지난 줄 삭제(총괄이 03:50 보관 정리 때 부른다 · db = pool)
async function purge(db) { const r = await db.query(`DELETE FROM sms_selfcheck_hits WHERE at < now() - interval '1 day'`); return r.rowCount || 0; }
const DOW = '일월화수목금토';
const mdDow = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); if (!m) return ''; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return `${+m[2]}/${+m[3]}(${DOW[d.getUTCDay()]})`; };
const kstYmd = ms => new Date((ms || Date.now()) + 9 * 3600e3).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 입력 다듬기 — 이름 2~10자(한글·영문 · 사이 공백은 뺀다) · 끝 4자리 숫자만
function cleanInput(body) {
    const b = body && typeof body === 'object' ? body : {};
    const rawName = typeof b.name === 'string' ? b.name.trim() : '', rawTail = typeof b.tail === 'string' || typeof b.tail === 'number' ? String(b.tail).trim() : '';
    const name = rawName.replace(/\s+/g, '');
    if (!/^[가-힣A-Za-z]{2,10}$/.test(name)) return { error: '받는 분 성함을 2~10자로 적어 주세요.', field: 'name' };
    if (!/^\d{4}$/.test(rawTail)) return { error: '휴대폰 번호 끝 4자리를 숫자로 적어 주세요.', field: 'tail' };
    return { name, tail: rawTail };
}

// 같은 날 · 같은 받는 분(이름 + 번호)의 상자 여럿 = 한 건. 주소·번호·메모·거래처는 읽지 않는다.
const SQL_FIND = `
    SELECT s.ship_date::text AS ship_date,
           array_agg(s.tracking ORDER BY s.tracking) AS trackings,
           array_remove(array_agg(DISTINCT NULLIF(btrim(s.option_text), '')), NULL) AS options,
           COALESCE(sum(s.qty), 0)::int AS qty
      FROM delivery_shipments s
     WHERE ((right(s.phone_digits, 4) = $2 AND length(s.phone_digits) >= 9) OR (right(s.buyer_digits, 4) = $2 AND length(s.buyer_digits) >= 9))   -- idx_ds_tail_phone · idx_ds_tail_buyer(식이 같아야 색인을 탄다)
       AND s.ship_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - $3::int
       AND regexp_replace(COALESCE(s.recipient, ''), '[[:space:]]+', '', 'g') = $1
     GROUP BY s.ship_date, s.phone_digits
     ORDER BY s.ship_date DESC
     LIMIT 5`;

// 손님에게 보여 줄 배송 단계(우리 분류 → 손님 말) · step = 진행 줄 위치(1 보냄 · 2 이동 중 · 3 배송 출발 · 4 도착) · 0 = 줄 대신 안내만
const STAGE = {
    '배송완료': { step: 4, title: '배송이 끝났어요', note: '' },
    '배송출발': { step: 3, title: '오늘 배송 출발했어요', note: '기사님이 배송 중이에요.' },
    '간선상하차': { step: 2, title: '택배가 이동 중이에요', note: '' },
    '집화': { step: 1, title: '택배사에 맡겼어요', note: '' },
};
function stageOf(label, hasStatus) {
    if (STAGE[label]) return Object.assign({ key: label }, STAGE[label]);
    if (!hasStatus || !label) return { key: '발송', step: 1, title: '상품을 보냈어요', note: '택배사 조회는 보낸 날 저녁부터 보여요.' };
    return { key: '확인', step: 0, title: '택배사에서 확인하고 있어요', note: '배송이 평소와 달라 확인이 필요해요. 아래 번호로 문자 주시면 바로 봐 드릴게요.' };
}

const PUBLIC = ['ship_date', 'ship_text', 'option_text', 'qty', 'boxes', 'boxes_delivered', 'tracking_tail', 'delivered', 'stage', 'stage_step', 'stage_title', 'stage_note', 'arrive_text', 'checked_text', 'go'];

module.exports = function mountSelfcheck(app, deps) {
    const d = deps || {};
    const pool = d.pool, lookup = d.lookup || require('./lookup.js'), log = d.log || console;
    const cj = d.cjTrack || null;
    const ship = d.shippingSchedule || require(path.join(__dirname, '..', 'shipping-schedule.js'));
    const L = Object.assign({}, DEF, d.limits || {});
    const contact = String(d.contact || '010-6687-4031');
    const secret = String(d.secret || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'));
    const KEY = crypto.createHash('sha256').update('selfcheck-token:' + secret).digest();
    const keyHash = (kind, v) => crypto.createHmac('sha256', secret).update('selfcheck-hit:' + kind + ':' + String(v)).digest('hex').slice(0, 40);

    async function initDB() {
        await pool.query(`CREATE TABLE IF NOT EXISTS sms_selfcheck_hits (id bigserial PRIMARY KEY, kind text NOT NULL, key_hash text NOT NULL, at timestamptz NOT NULL DEFAULT now())`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_selfcheck_hits ON sms_selfcheck_hits(kind, key_hash, at)`);
        // 끝 4자리로 먼저 좁히는 색인(송장 표 · 식 색인이라 표 내용은 안 바뀐다) — 없으면 조회마다 30일치 줄을 다 읽는다
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_tail_phone ON delivery_shipments (right(phone_digits, 4)) WHERE length(phone_digits) >= 9`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ds_tail_buyer ON delivery_shipments (right(buyer_digits, 4)) WHERE length(buyer_digits) >= 9`);
    }

    // ── 조회 링크 토큰 — 운송장을 암호화해 담는다(AES-256-GCM · 풀어 볼 수 없다 · 기한 tokenMin 분)
    function makeToken(tracking, now) {
        const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
        const body = Buffer.concat([c.update(JSON.stringify({ t: String(tracking), e: (now || Date.now()) + L.tokenMin * 60000 }), 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
    }
    function readToken(tok, now) {
        try {
            const raw = Buffer.from(String(tok || ''), 'base64url'); if (raw.length < 30 || raw.length > 400) return null;
            const dc = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12)); dc.setAuthTag(raw.subarray(12, 28));
            const o = JSON.parse(Buffer.concat([dc.update(raw.subarray(28)), dc.final()]).toString('utf8'));
            if (!o || !/^\d{10,12}$/.test(String(o.t)) || !(Number(o.e) > (now || Date.now()))) return null;
            return String(o.t);
        } catch (e) { return null; }
    }

    // ── 시도 제한 — 창(windowMin) 안 IP · 성함 · 끝자리 · 전체 횟수 + 「없음」이 이어진 IP 잠금. 넘으면 적지 않고 막는다. 돌려주는 값 = null(통과) | 막힌 까닭
    const H_ALL = keyHash('all', '');
    let _allAlertAt = 0;
    async function allow(ip, name, tail) {
        const hi = keyHash('ip', ip), hn = keyHash('name', name), ht = keyHash('tail', tail);
        const r = (await pool.query(
            `SELECT count(*) FILTER (WHERE kind = 'ip' AND key_hash = $1 AND at > now() - ($5::int * interval '1 minute'))::int AS ip,
                    count(*) FILTER (WHERE kind = 'name' AND key_hash = $2 AND at > now() - ($5::int * interval '1 minute'))::int AS nm,
                    count(*) FILTER (WHERE kind = 'tail' AND key_hash = $3 AND at > now() - ($5::int * interval '1 minute'))::int AS tl,
                    count(*) FILTER (WHERE kind = 'all' AND key_hash = $4 AND at > now() - ($5::int * interval '1 minute'))::int AS al,
                    count(*) FILTER (WHERE kind = 'lock' AND key_hash = $1 AND at > now() - ($6::int * interval '1 minute'))::int AS lk
               FROM sms_selfcheck_hits
              WHERE at > now() - (GREATEST($5::int, $6::int) * interval '1 minute')
                AND ((kind IN ('ip', 'lock') AND key_hash = $1) OR (kind = 'name' AND key_hash = $2) OR (kind = 'tail' AND key_hash = $3) OR (kind = 'all' AND key_hash = $4))`,
            [hi, hn, ht, H_ALL, L.windowMin, L.lockMin])).rows[0];
        if (r.al >= L.perAll) {
            if (Date.now() - _allAlertAt > 3600e3) { _allAlertAt = Date.now(); if (typeof d.notifyTelegram === 'function') Promise.resolve().then(() => d.notifyTelegram(`🚧 손님 셀프 조회(내 주문 어디쯤?)가 ${L.windowMin}분에 ${L.perAll}회를 넘어 잠시 막았어요. 누가 번호를 찍어 보는 것일 수 있어요.`)).catch(() => { }); }
            return 'all';
        }
        if (r.lk > 0) return 'lock';
        if (r.ip >= L.perIp) return 'ip';
        if (r.nm >= L.perName) return 'name';
        if (r.tl >= L.perTail) return 'tail';
        await pool.query(`INSERT INTO sms_selfcheck_hits (kind, key_hash) VALUES ('ip', $1), ('name', $2), ('tail', $3), ('all', $4)`, [hi, hn, ht, H_ALL]);
        return null;
    }
    // 「없음」이 이어지면 그 IP 를 잠근다 · 맞히면(one·many) 처음부터
    async function noteResult(ip, match) {
        const hi = keyHash('ip', ip);
        if (match !== 'none') { await pool.query(`DELETE FROM sms_selfcheck_hits WHERE kind = 'none' AND key_hash = $1`, [hi]); return; }
        await pool.query(`INSERT INTO sms_selfcheck_hits (kind, key_hash) VALUES ('none', $1)`, [hi]);
        const n = (await pool.query(`SELECT count(*)::int AS n FROM sms_selfcheck_hits WHERE kind = 'none' AND key_hash = $1`, [hi])).rows[0].n;   // 하루 지난 줄은 purge 가 지운다
        if (n >= L.noneStreak) { await pool.query(`INSERT INTO sms_selfcheck_hits (kind, key_hash) VALUES ('lock', $1)`, [hi]); await pool.query(`DELETE FROM sms_selfcheck_hits WHERE kind = 'none' AND key_hash = $1`, [hi]); }
    }
    // 실서버는 Cloudflare → Render 뒤라 cf-connecting-ip(Cloudflare 가 넣는 진짜 손님 IP)를 먼저 · 없으면 x-forwarded-for 마지막 값 · 없으면 req.ip(총괄 10/10 라이브 헤더 확인: server: cloudflare)
    const clientIp = req => { const cf = String(req.headers['cf-connecting-ip'] || req.headers['true-client-ip'] || '').trim(); if (cf) return cf; const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean); return (xf.length ? xf[xf.length - 1] : String(req.ip || '')) || 'unknown'; };
    let running = 0;

    // ── 도착 예정 글 — 계산기는 shipping-schedule.computeArrival 하나만. 「내일·모레」는 보낸 날 기준 말이라 나중에 보면 틀리므로 날짜로 적는다.
    async function arriveText(shipYmd, delivered, now) {
        if (delivered) return '';
        let h = null; try { h = d.holidays ? await d.holidays() : null; } catch (e) { h = null; }
        const a = ship.computeArrival(shipYmd + 'T12:00:00+09:00', h && h.arriveOff ? h.arriveOff : null, h && (h.reasons || h.notices) ? (h.reasons || h.notices) : null);
        if (!a || !a.arriveStart) return '';
        if (kstYmd(now) > a.arriveEnd) return '도착 예정일이 지났어요. 아래 번호로 문자 주시면 확인해 드릴게요.';
        return (a.arriveStart === a.arriveEnd ? mdDow(a.arriveStart) : `${mdDow(a.arriveStart)}~${mdDow(a.arriveEnd)} 사이`) + ' 도착 예정' + (a.reason ? ` (${a.reason})` : '');
    }

    // 이름은 cleanInput 이 다듬은 그대로 비교한다 — lookup.normalizeName 은 「님·씨·분·요」 말꼬리를 떼서(문자 답 글용) 끝 글자가 그런 실제 이름을 깎는다
    async function find(name, tail, now) {
        const groups = (await pool.query(SQL_FIND, [name, tail, L.days])).rows;
        if (!groups.length) return { match: 'none' };
        if (groups.length > 1) return { match: 'many' };
        const g = groups[0];
        const res = { match: 'one', order: { ship_date: g.ship_date, option_text: (g.options || []).join(' + ') || null, qty: g.qty || null, boxes: g.trackings.length, trackings: g.trackings } };
        try { await lookup.refreshOrder(pool, res, cj ? { cj } : {}); } catch (e) { log.error && log.error('[selfcheck] 상태 조회 실패:', e && e.message); }
        const o = res.order, st = stageOf(o.status_label, !!o.checked_at);
        const tracking = o.tracking || o.trackings[0];
        const full = {
            ship_date: o.ship_date, ship_text: mdDow(o.ship_date), option_text: o.option_text, qty: o.qty, boxes: o.boxes, boxes_delivered: o.boxes_delivered || 0,
            tracking_tail: String(tracking).slice(-4), delivered: !!o.delivered, stage: st.key, stage_step: st.step, stage_title: st.title, stage_note: st.note,
            arrive_text: await arriveText(o.ship_date, !!o.delivered, now),
            checked_text: o.checked_at ? (() => { const k = new Date(new Date(o.checked_at).getTime() + 9 * 3600e3); return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')} 기준`; })() : '',
            go: '/track-order/go?t=' + makeToken(tracking, now),
        };
        const pub = {}; for (const k of PUBLIC) if (full[k] !== undefined && full[k] !== null) pub[k] = full[k];
        return { match: 'one', order: pub };
    }

    app.get('/track-order', (req, res) => {
        res.set('Content-Type', 'text/html; charset=utf-8').set('X-Robots-Tag', 'noindex, nofollow').set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').send(pageHtml(contact));
    });
    app.post('/api/track-order', async (req, res) => {
        const t0 = Date.now(); res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow');
        const done = async (code, body) => { const left = L.minMs - (Date.now() - t0); if (left > 0) await sleep(left); res.status(code).json(body); };   // 있음·없음을 응답 속도로 가늠하지 못하게 바닥을 맞춘다
        try {
            const inp = cleanInput(req.body);
            if (inp.error) return done(400, { ok: false, error: inp.error, field: inp.field });
            const ip = clientIp(req);
            const why = await allow(ip, inp.name, inp.tail);
            if (why) return done(429, { ok: false, error: why === 'lock' ? `조회가 여러 번 맞지 않아 잠시 막아 두었어요. ${L.lockMin}분쯤 뒤에 다시 해 주시거나 문자로 문의해 주세요.` : why === 'all' ? '지금 조회가 몰려 잠시 쉬고 있어요. 조금 뒤에 다시 해 주세요.' : `조회를 여러 번 하셨어요. ${L.windowMin}분쯤 뒤에 다시 해 주세요.` });
            if (running >= L.maxRunning) return done(429, { ok: false, error: '지금 조회가 몰려 있어요. 잠시 뒤 다시 눌러 주세요.' });   // 한꺼번에 몰려도 DB·택배사 조회가 쌓이지 않게
            running++;
            let r; try { r = await find(inp.name, inp.tail, Date.now()); } finally { running--; }
            try { await noteResult(ip, r.match); } catch (e) { log.error && log.error('[selfcheck] 시도 기록 실패(무시):', e && e.message); }
            return done(200, Object.assign({ ok: true }, r));
        } catch (e) {
            log.error && log.error('[selfcheck] 조회 오류:', e && e.message);
            return done(500, { ok: false, error: '잠시 뒤 다시 시도해 주세요.' });
        }
    });
    app.get('/track-order/go', (req, res) => {
        res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').set('Referrer-Policy', 'no-referrer');
        const tr = readToken(req.query.t);
        if (!tr) return res.redirect(302, '/track-order?e=expired');
        res.redirect(302, 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=' + tr);
    });

    return { initDB, find, allow, noteResult, purge: () => purge(pool), keyHash, makeToken, readToken, cleanInput, limits: L };
};
module.exports.cleanInput = cleanInput;
module.exports.purge = purge;
module.exports.stageOf = stageOf;
module.exports.PUBLIC = PUBLIC;

// ── 화면 — 회사 디자인 가이드(디자인/디자인_가이드.md)의 토큰만 쓴다: 인디고 · 흰 카드 · Pretendard · 카드 14 / 칸 12 / 버튼 10 / 알약 999
//   색은 :root 의 토큰 변수로만(규칙 안에 색을 직접 적지 않는다) · 폰 390 기준 · 누르는 것은 48px
function pageHtml(contact) {
    const tel = String(contact).replace(/[^0-9]/g, '');
    return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>제주아꼼이네 · 내 주문 어디쯤?</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@1.3.9/dist/web/static/pretendard.css" integrity="sha384-SN6A48CJQjx946+DRb8wsoifC4a8ur9ZS6R+HCTgnBHOKCa6GLXAR3Qn8d1jztxg" crossorigin="anonymous">
<style>
  :root {
    --primary:#4F46E5; --primary-dark:#4338CA; --primary-light:#EEF0FF; --primary-ring:rgba(79,70,229,.15);
    --page-bg:#E9EBF0; --bg:#F5F6F8; --card-bg:#FFFFFF; --card-border:#DFE2E8; --border:#ECEDF1;
    --shadow-card:0 1px 2px rgba(16,24,40,.06), 0 2px 6px -2px rgba(16,24,40,.10); --shadow-btn:0 6px 16px -6px rgba(79,70,229,.55);
    --text-dark:#101828; --text-mid:#667085; --text-on-page:#545D70; --danger:#F04438; --danger-dark:#B42318; --danger-light:#FEF3F2; --success:#12B76A;
    --head-grad:linear-gradient(#FBFBFD, #F4F5F8); --ease:cubic-bezier(0.23, 1, 0.32, 1);
  }
  * { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif; background:var(--page-bg); color:var(--text-dark); line-height:1.5; word-break:keep-all; overflow-wrap:anywhere; }
  .wrap { max-width:480px; margin:0 auto; padding:16px 16px 40px; }
  .card { background:var(--card-bg); border:1px solid var(--card-border); border-radius:14px; box-shadow:var(--shadow-card); }
  .hd { display:flex; align-items:center; gap:12px; padding:16px 18px; background:var(--head-grad); }
  .hd img { flex:none; width:48px; height:48px; border-radius:50%; background:var(--card-bg); border:1px solid var(--card-border); object-fit:cover; }
  .hd small { display:block; color:var(--text-mid); font-size:12.5px; font-weight:600; }
  .hd h1 { margin:0; font-size:21px; font-weight:800; letter-spacing:-.02em; line-height:1.25; }
  .form { margin-top:12px; padding:18px; }
  .lead { margin:0 0 16px; color:var(--text-mid); font-size:14px; }
  .f { display:block; margin-bottom:14px; }
  .f label { display:block; margin-bottom:6px; font-size:13.5px; font-weight:700; }
  .f input { width:100%; height:48px; padding:0 14px; border:1px solid var(--card-border); border-radius:10px; background:var(--card-bg); color:var(--text-dark); font:inherit; font-size:16px; }
  .f input::placeholder { color:var(--text-mid); }
  .f input:focus-visible { outline:none; border-color:var(--primary); box-shadow:0 0 0 4px var(--primary-ring); }
  .f input[aria-invalid="true"] { border-color:var(--danger); }
  .f .tail { letter-spacing:.2em; font-variant-numeric:tabular-nums; }
  .err { display:block; min-height:0; margin-top:6px; color:var(--danger-dark); font-size:13px; font-weight:600; }
  .err:empty { display:none; }
  .btn { display:flex; align-items:center; justify-content:center; width:100%; min-height:48px; padding:0 16px; border-radius:10px; border:1px solid var(--card-border); background:var(--card-bg); color:var(--text-dark); font:inherit; font-size:15.5px; font-weight:700; text-decoration:none; cursor:pointer; transition:transform 160ms var(--ease), background-color 160ms var(--ease), border-color 160ms var(--ease); }
  .btn:hover { border-color:var(--primary); color:var(--primary); background:var(--primary-light); }
  .btn:active { transform:scale(.98); }
  .btn:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
  .btn.primary { border-color:var(--primary); background:var(--primary); color:var(--card-bg); box-shadow:var(--shadow-btn); }
  .btn.primary:hover { background:var(--primary-dark); border-color:var(--primary-dark); color:var(--card-bg); }
  .btn[disabled] { opacity:.6; cursor:progress; box-shadow:none; }
  .hint { margin:12px 0 0; color:var(--text-mid); font-size:12.5px; }
  .res { margin-top:12px; padding:18px; }
  .res[hidden] { display:none; }
  .res:focus { outline:none; }
  .who { margin:0 0 4px; color:var(--text-mid); font-size:13px; font-weight:600; }
  .res h2 { margin:0; font-size:20px; font-weight:800; letter-spacing:-.02em; line-height:1.3; }
  .note { margin:6px 0 0; color:var(--text-mid); font-size:14px; }
  .steps { display:grid; grid-template-columns:repeat(4, 1fr); gap:0; margin:18px 0 4px; padding:0; list-style:none; }
  .steps li { position:relative; text-align:center; color:var(--text-mid); font-size:12px; font-weight:600; }
  .steps li::before { content:""; display:block; width:14px; height:14px; margin:0 auto 8px; border-radius:50%; background:var(--card-bg); border:2px solid var(--card-border); position:relative; z-index:1; }
  .steps li::after { content:""; position:absolute; top:6px; left:-50%; width:100%; height:2px; background:var(--card-border); }
  .steps li:first-child::after { display:none; }
  .steps li.on { color:var(--text-dark); }
  .steps li.on::before { background:var(--primary); border-color:var(--primary); }
  .steps li.on::after { background:var(--primary); }
  .steps li.now { color:var(--primary); font-weight:800; }
  .steps li.now::before { box-shadow:0 0 0 4px var(--primary-ring); }
  .rows { margin:16px 0 0; padding:0; border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  .rows div { display:flex; gap:12px; padding:11px 14px; border-top:1px solid var(--border); font-size:14.5px; }
  .rows div:first-child { border-top:0; }
  .rows dt { flex:none; width:84px; color:var(--text-mid); font-weight:600; }
  .rows dd { flex:1 1 auto; min-width:0; margin:0; font-weight:600; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .res .btn { margin-top:14px; }
  .small { margin:10px 0 0; color:var(--text-mid); font-size:12.5px; text-align:center; }
  .res.warn { background:var(--danger-light); }
  .res.warn h2 { color:var(--danger-dark); }
  .ft { margin-top:22px; color:var(--text-on-page); font-size:13px; text-align:center; }
  .ft a { color:var(--text-on-page); font-weight:700; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  @media (prefers-reduced-motion: reduce) { .btn { transition:none; } }
</style></head><body><div class="wrap">
  <header class="card hd"><img src="/akkomi.png" alt="아꼼이" width="48" height="48"><div><small>제주아꼼이네</small><h1>내 주문 어디쯤?</h1></div></header>
  <form class="card form" id="f" novalidate autocomplete="off">
    <p class="lead">받는 분 성함과 휴대폰 번호 끝 4자리로 배송 상태를 확인해요.</p>
    <div class="f"><label for="name">받는 분 성함</label><input id="name" name="name" type="text" maxlength="12" placeholder="예) 홍길동" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="e-name" required><span class="err" id="e-name" role="alert"></span></div>
    <div class="f"><label for="tail">휴대폰 번호 끝 4자리</label><input class="tail" id="tail" name="tail" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="13" placeholder="1234" autocomplete="off" aria-describedby="e-tail" required><span class="err" id="e-tail" role="alert"></span></div>
    <button class="btn primary" id="go" type="submit">배송 상태 조회하기</button>
    <p class="hint">받는 분 또는 주문하신 분의 번호 끝자리로 찾아요. 최근 30일 안에 보낸 주문만 보여요.</p>
  </form>
  <section class="card res" id="res" tabindex="-1" aria-live="polite" hidden></section>
  <p class="ft">문의는 문자로 <a href="sms:${tel}">${contact}</a> · 제주아꼼이네</p>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var f = $('f'), res = $('res'), btn = $('go'), busy = false;
  var CONTACT = ${JSON.stringify(String(contact))}, TEL = ${JSON.stringify(tel)};
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function setErr(id, msg) { var i = $(id), e = $('e-' + id); e.textContent = msg || ''; if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); }
  function show(kind, nodes) { res.className = 'card res' + (kind ? ' ' + kind : ''); res.textContent = ''; nodes.forEach(function (n) { if (n) res.appendChild(n); }); res.hidden = false; res.focus({ preventScroll: true }); res.scrollIntoView({ block: 'nearest' }); }
  function ask(extra) { var a = el('a', 'btn', '문자로 문의하기 ' + CONTACT); a.href = 'sms:' + TEL; return [a, extra ? el('p', 'small', extra) : null]; }
  function message(title, note, warn) { show(warn ? 'warn' : '', [el('h2', '', title), el('p', 'note', note)].concat(ask())); }
  function row(dl, k, v) { if (!v) return; var d = el('div'); d.appendChild(el('dt', '', k)); d.appendChild(el('dd', '', v)); dl.appendChild(d); }
  function one(o, name) {
    var nodes = [el('p', 'who', name + ' 님께 보낸 주문'), el('h2', '', o.stage_title || '상품을 보냈어요')];
    if (o.stage_note) nodes.push(el('p', 'note', o.stage_note));
    if (o.stage_step > 0) {
      var ol = el('ol', 'steps'); ol.setAttribute('aria-label', '배송 단계');
      ['보냄', '이동 중', '배송 출발', '도착'].forEach(function (t, i) { var li = el('li', (i < o.stage_step ? 'on' : '') + (i + 1 === o.stage_step ? ' now' : ''), t); if (i + 1 === o.stage_step) li.setAttribute('aria-current', 'step'); ol.appendChild(li); });
      nodes.push(ol);
    }
    var dl = el('dl', 'rows');
    row(dl, '보낸 날', o.ship_text);
    row(dl, '상품', o.option_text);
    row(dl, '상자', o.boxes > 1 ? o.boxes + '상자' + (o.boxes_delivered > 0 && !o.delivered ? ' (그중 ' + o.boxes_delivered + '상자 도착)' : '') : '1상자');
    row(dl, '운송장', '끝 ' + o.tracking_tail);
    row(dl, '도착 예정', o.arrive_text);
    nodes.push(dl);
    if (o.go) { var a = el('a', 'btn', '택배사에서 자세히 보기'); a.href = o.go; a.rel = 'noopener noreferrer'; nodes.push(a); }
    nodes.push(el('p', 'small', (o.checked_text ? o.checked_text + ' · ' : '') + '자세히 보기는 10분 동안 열려요. 지나면 다시 조회해 주세요.'));
    show('', nodes);
  }
  if (/[?&]e=expired/.test(location.search)) { message('조회 시간이 지났어요', '다시 조회하시면 택배사 화면으로 넘어갈 수 있어요.'); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  $('tail').addEventListener('input', function (e) { var g = e.target.value.replace(/[^0-9]/g, ''), v = g.length >= 9 ? g.slice(-4) : g.slice(0, 4); if (v !== e.target.value) e.target.value = v; });   // 번호 전체를 붙여 넣으면 끝 4자리만 남긴다
  f.addEventListener('submit', function (ev) {
    ev.preventDefault(); if (busy) return;
    var name = $('name').value.replace(/\\s+/g, ''), tail = $('tail').value.trim(), bad = null;
    setErr('name', ''); setErr('tail', '');
    if (!/^[가-힣A-Za-z]{2,10}$/.test(name)) { setErr('name', '받는 분 성함을 2~10자로 적어 주세요.'); bad = bad || 'name'; }
    if (!/^[0-9]{4}$/.test(tail)) { setErr('tail', '휴대폰 번호 끝 4자리를 숫자로 적어 주세요.'); bad = bad || 'tail'; }
    if (bad) { $(bad).focus(); return; }
    busy = true; btn.disabled = true; btn.textContent = '조회하고 있어요'; btn.setAttribute('aria-busy', 'true');
    fetch('/api/track-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, tail: tail }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { s: r.status, d: d || {} }; }); })
      .then(function (x) {
        var d = x.d;
        if (x.s === 429) return message('잠시 뒤 다시 조회해 주세요', d.error || '조회를 여러 번 하셨어요. 10분쯤 뒤에 다시 해 주세요.', true);
        if (x.s === 400 && d.field) { setErr(d.field, d.error); $(d.field).focus(); res.hidden = true; return; }
        if (!d.ok) return message('지금은 조회가 안 돼요', d.error || '잠시 뒤 다시 시도해 주세요.', true);
        if (d.match === 'one' && d.order) return one(d.order, name);
        if (d.match === 'many') return message('주문이 여러 건 있어요', '같은 성함과 번호로 보낸 주문이 여러 건이라 여기서는 보여 드리지 못해요. 문자로 문의해 주시면 바로 알려 드릴게요.');
        return message('주문을 찾지 못했어요', '성함과 번호 끝자리를 다시 확인해 주세요. 아직 보내기 전인 주문은 여기에 안 보여요.');
      })
      .catch(function () { message('연결이 끊겼어요', '인터넷 연결을 확인하고 다시 눌러 주세요.', true); })
      .then(function () { busy = false; btn.disabled = false; btn.textContent = '배송 상태 조회하기'; btn.removeAttribute('aria-busy'); });
  });
})();
</script></body></html>`;
}
module.exports.pageHtml = pageHtml;

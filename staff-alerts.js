/* #1111-B 직원별 회사 알림(대표 11/11) — 「직원이 불필요한 것 없이 자기 일 중 빠뜨린 것을 체크하고 처리해 놓치는 부분이 없게」
 *
 *   알림 하나 = 무엇이 문제인지(사실 숫자) + 어디서 확인하는지(link) + 다음 행동 한 줄(→ …) · 텔레그램은 무접촉(대표 「그대로」)
 *   받는 사람 = notify-routes.js 설정 'notify_routes' 의 type 칸(관리자가 정함 · 칸이 없거나 비면 보내지 않음 = 장착해도 조용함)
 *     rank_alert     = 민주   순위 문제(쇼핑 순위만 · 40위 안 → 밖 「사라짐」 · 10위 안 +5 · 11~40위 +10 「급락」 · 수집 막힘)
 *     price_alert    = 민주   3채널 가격 어긋남(price-check 판정 · 쿠팡 포함 · 예외 = 페이지 등급/무시 설정 + staff_alerts.price_ignore)
 *     cs_stale       = 지현·승협  3시간 넘게 아무도 답 안 한 문의(톡톡·문자·상품문의·고객문의) · 09:00·15:00 묶음 · 지난번 뒤 처리된 수 · 남은 것만
 *     cs_material    = 지현·승협  답변 재료 점검(시기 지식 3일 안 끝·시작 · 봇 답 뒤 직원 정정 · 판매 상태 바뀜 vs 재료 그대로 · 지난 날짜 글) · 09:00
 *     cs_claim_brief = 지현   어제 클레임 요약(사실 숫자 · 포인트 제외) · 09:00
 *     settle_error   = 가영   정산 자동 수집 실패(그날 1번)
 *   🟥 = title 머리 「🟥 확인 필요 · …」 + level 'alert'(알림 종 빨강 띠·맨 위 = 화면 몫) · 요약(cs_claim_brief)은 level 'info'
 *   스위치 = 설정 'staff_alerts' { enabled:true } 일 때만 돎(기본 꺼짐) · 한 일은 설정 'staff_alerts_state' 에 「한 번」 표식(배포 겹침에도 두 번 안 보냄)
 *
 *   구성: 앞쪽 = 순수 판정 함수(DB·시계 없음 · 검증 scripts/verify-1111-staff-alerts.js 가 가짜 자료로 분기 전부) · 뒤쪽 run(deps) = 1분 틱에서 부름
 *   장착(server.js · 총괄 「장착 고」 뒤): const SA = require('./staff-alerts.js'); 1분 틱에서 SA.run({ pool, notify, routes, inbox, priceReport, log })
 *     notify(uid, type, title, message, link, level) = createNotification + level 칸 · routes = notify-routes 인스턴스 · inbox = inbox-threads 반환값(_talkThreads·_postThreads)
 *     priceReport = async () => price-check build(쿠팡 coupangGet 포함 · /api/price-check 와 같은 인자) · 없으면 가격 일은 건너뜀
 */
'use strict';

const KST = 9 * 3600e3, DAY = 86400e3;
const kstDate = ms => new Date(ms + KST).toISOString().slice(0, 10);
const kstHM = ms => new Date(ms + KST).toISOString().slice(11, 16);
const md = s => { const d = String(s || ''); return d.length >= 10 ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) : d; };
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const RED = '🟥 확인 필요 · ';
const DEF = { enabled: false, stale_hours: 3, max_rank: 40, top_rank: 10, top_drop: 5, mid_drop: 10, price_ignore: [], season_days: 3, holidays: [], holidays_from_shipping: true };

// ───────────── 쉬는 날(대표 11/11 「주말·공휴일에는 오지 않도록 · 승협 화~토 · 나머지 월~금」) ─────────────
//   판정은 workdays.js 하나(사람별 근무 요일 staff_alerts.workdays + 휴무일 = 공휴일 시드·설정 날짜·발송 휴무일 달력 체크한 날 전부)
//   새 직원 알림은 받는 사람마다 그 사람 근무일에만 · 견줄 날·모을 첫날 = 그 사람의 지난 근무일(평일 = 어제 · 월~금 직원의 월요일 = 금요일 · 승협 화요일 = 토요일)
//   그날 근무자가 한 명도 없는 일은 표식·기억 없이 건너뜀(다음 근무일에 그 사람 기준으로 다시) · 묶음 「남음」 기억은 종류별 공용(보낸 날 기준)
const WD = require('./workdays.js');
const dayMs = d => Date.parse(d + 'T00:00:00Z');
const ymdOf = ms => new Date(ms).toISOString().slice(0, 10);
// 기본 요일(월~금) 판정 — 예전 이름 그대로 두고 검증·밖에서 씀(사람별은 WD.isOffFor)
function isOffDay(day, holidaySet, workdays, uid) { return WD.isOffFor(uid == null ? null : uid, day, workdays || null, holidaySet); }
function prevWorkday(day, holidaySet, workdays, uid) { return WD.prevWorkdayFor(uid == null ? null : uid, day, workdays || null, holidaySet); }
const holidaySetOf = WD.holidaySetOf;

// ───────────── ① 순위(민주) ─────────────
// today/yest = [{ keyword, shopping_rank }] · last = keyword_rank_last { errors:[키워드], blocked } · prev = 어제 알린 { 키워드: 'gone'|'drop' }
function rankAlerts({ today, yest, last, prev, cfg }) {
    const c = Object.assign({}, DEF, cfg || {}); const L = last || {};
    if (L.blocked) return { blocked: true, items: [] };
    // 쇼핑 순위를 못 읽은 키워드만 「읽기 실패」(파워링크·광고만 실패한 줄은 쇼핑 값이 있으니 그대로 봄)
    const errors = new Set((Array.isArray(L.errors) ? L.errors : []).filter(e => !(e && typeof e === 'object' && /^(?:파워링크|광고)/.test(String(e.error || '')))).map(e => String(e && e.keyword != null ? e.keyword : e)));
    const T = new Map((today || []).map(r => [String(r.keyword), r.shopping_rank == null ? null : Number(r.shopping_rank)]));
    const Y = new Map((yest || []).map(r => [String(r.keyword), r.shopping_rank == null ? null : Number(r.shopping_rank)]));
    const items = [], failed = [];
    for (const [k, y] of Y) {
        if (y == null || !(y >= 1 && y <= c.max_rank)) continue;   // 어제 순위 안에 없던 키워드는 볼 것 없음
        if (errors.has(k) || !T.has(k)) { failed.push(k); continue; }   // 읽기 실패·오늘 줄 없음 = 「사라짐」으로 세지 않음
        const t = T.get(k);
        let kind = null;
        if (t == null || t > c.max_rank) kind = 'gone';
        else if (y <= c.top_rank ? t - y >= c.top_drop : t - y >= c.mid_drop) kind = 'drop';
        if (!kind) continue;
        if (prev && prev[k] === kind) continue;   // 같은 문제를 이틀 연속 알리지 않음
        items.push({ keyword: k, kind, y, t });
    }
    return { blocked: false, items, failed };
}
function rankText(r, day, baseDay) {   // baseDay = 견준 날(어제가 아니면 = 쉬는 날 뒤 → 「M/D 대비」 를 제목에)
    if (r.blocked) return { title: RED + `순위 수집 막힘 (${md(day)})`, message: '네이버 보안 확인으로 오늘 순위를 못 읽었어요.\n→ 순위관리에서 확인(오늘 순위 못 읽음)', level: 'alert' };
    if (!r.items.length) return null;
    const lines = r.items.map(x => x.kind === 'gone' ? `「${x.keyword}」 쇼핑 ${x.y}위 → 40위 밖(사라짐)` : `「${x.keyword}」 쇼핑 ${x.y}위 → ${x.t}위(↓${x.t - x.y})`);
    const vs = baseDay && baseDay !== ymdOf(dayMs(day) - DAY) ? ` · ${md(baseDay)} 대비` : '';
    return { title: RED + `순위 문제 ${r.items.length}건 (${md(day)}${vs})`, message: lines.join('\n') + `\n→ 순위관리에서 확인`, level: 'alert' };
}

// ───────────── ② 3채널 가격(민주) ─────────────
// report = price-check build() 결과 · 문제 = 페이지끼리 다름·자사몰↔네이버·쿠팡↔네이버·VIP 가 더 비쌈(참고 종류·「한쪽만 최근 바뀜」은 뺌)
const PRICE_KINDS = ['tier_mismatch', 'mall_vs_naver', 'coupang_vs_naver', 'vip_not_lower'];
const PRICE_KO = { tier_mismatch: '페이지끼리 값 다름', mall_vs_naver: '자사몰 ↔ 네이버', coupang_vs_naver: '쿠팡 ↔ 네이버', vip_not_lower: 'VIP 가 더 비쌈' };
function priceDiff(report, cfg) {
    if (!report || !report.ok || !Array.isArray(report.groups)) return { ok: false, items: [], error: (report && report.error) || '가격 확인 못 함' };
    const ign = (cfg && Array.isArray(cfg.price_ignore) ? cfg.price_ignore : []).map(s => String(s)).filter(Boolean);   // 묶음 이름·글에 이 글자가 있으면 뺌(일부러 다른 것)
    const items = [];
    for (const g of report.groups) for (const i of (g.issues || [])) {
        if (!PRICE_KINDS.includes(i.kind)) continue;
        const text = `${g.label} — ${i.detail}`;
        if (ign.some(s => text.includes(s))) continue;
        items.push({ key: g.key + '|' + i.kind, kind: i.kind, label: g.label, detail: i.detail });
    }
    return { ok: true, items, coupang: report.source && report.source.coupang };
}
function priceText(r, prevKeys) {
    if (!r.ok) return null;   // 조회 자체 실패는 민주 몫 아님(로그만) — 쿠팡만 못 읽으면 아래 꼬리 한 줄
    if (!r.items.length) return null;
    const prev = new Set(prevKeys || []);
    const lines = r.items.slice(0, 8).map(x => `${prev.has(x.key) ? '(어제부터) ' : ''}[${PRICE_KO[x.kind]}] ${clip(x.label, 30)} · ${clip(x.detail, 90)}`);
    if (r.items.length > 8) lines.push(`… 외 ${r.items.length - 8}곳`);
    if (r.coupang && r.coupang !== 'live') lines.push('(쿠팡은 이번에 못 읽음 — 네이버·자사몰만 견줌)');
    return { title: RED + `가격 어긋남 ${r.items.length}곳`, message: lines.join('\n') + '\n→ 전체 가격 확인하기에서 확인', level: 'alert' };
}

// ───────────── ③ 묵은 미답변(지현·승협) ─────────────
// items = [{ ch:'talk'|'sms'|'qna'|'inquiry', id, title, last_at(ISO), last_text }] · 지난 묶음에 알린 열쇠(prevKeys)로 「처리됨 n · 남음 n · 새로 n」
const CH_KO = { talk: '톡톡', sms: '문자', qna: '상품문의', inquiry: '고객문의' };
function staleUnanswered(items, nowMs, cfg, prevKeys) {
    const h = Math.max(1, Number((cfg && cfg.stale_hours) || DEF.stale_hours));
    const old = (items || []).filter(x => { const t = Date.parse(x.last_at); return Number.isFinite(t) && nowMs - t >= h * 3600e3; })
        .sort((a, b) => Date.parse(a.last_at) - Date.parse(b.last_at));
    const keys = old.map(x => x.ch + ':' + x.id), prev = new Set(prevKeys || []);
    const remain = keys.filter(k => prev.has(k)).length, fresh = keys.length - remain;
    const done = [...prev].filter(k => !keys.includes(k)).length;
    const by = {}; for (const x of old) by[x.ch] = (by[x.ch] || 0) + 1;
    return { hours: h, items: old, keys, remain, fresh, done, by };
}
function staleText(r, slot) {
    if (!r.items.length) return r.done ? { title: `미답변 문의 정리됨 (${slot})`, message: `지난번 알린 ${r.done}건이 모두 처리됐어요. 남은 것 없음.`, level: 'info' } : null;
    const head = ['talk', 'sms', 'qna', 'inquiry'].filter(c => r.by[c]).map(c => `${CH_KO[c]} ${r.by[c]}`).join(' · ');
    const top = r.items.slice(0, 3).map(x => `ㆍ${CH_KO[x.ch]} ${clip(x.title, 20)} · ${kstHM(Date.parse(x.last_at))}${kstDate(Date.parse(x.last_at)) !== kstDate(Date.now()) ? '(' + md(kstDate(Date.parse(x.last_at))) + ')' : ''} · 「${clip(x.last_text, 24)}」`);
    const flow = (r.done || r.remain) ? `지난번 뒤 처리 ${r.done}건 · 아직 남음 ${r.remain}건 · 새로 ${r.fresh}건\n` : '';
    return { title: RED + `${r.hours}시간 넘게 답 안 한 문의 ${r.items.length}건 (${slot})`, message: flow + head + '\n' + top.join('\n') + (r.items.length > 3 ? `\n… 외 ${r.items.length - 3}건` : '') + '\n→ 손님 연락 미처리에서 답하기', level: 'alert' };
}

// ───────────── ④ 답변 재료 점검(지현·승협) ─────────────
const ITEM_RE = /타이벡|노지\s*황금향|하우스\s*황금향|황금향|노지\s*감귤|노지귤|하우스\s*감귤|하우스귤|레몬|한라봉|천혜향|레드향|카라향|레드키위|키위|청귤|밤호박|단호박|옥수수|체험/;
const FIX_RE = /AI\s*자동|자동\s*답변|자동답변|정정|잘못\s*(?:안내|말씀|답)|다시\s*안내|착오|봇이\s*잘못/;
function mdDiff(fromMd, toMd) {   // 'MM-DD' 둘 → toMd 까지 남은 날(0~365 · 해 넘김 포함)
    const y = 2026, a = Date.UTC(y, Number(fromMd.slice(0, 2)) - 1, Number(fromMd.slice(3, 5))), b = Date.UTC(y, Number(toMd.slice(0, 2)) - 1, Number(toMd.slice(3, 5)));
    let d = Math.round((b - a) / DAY); if (d < 0) d += 365; return d;
}
function materialSignals({ knowledge, logs, products, scenarios, nowMs, cfg, sinceMs }) {   // sinceMs = 판매 상태 바뀜을 볼 시작(없으면 하루 전 · 쉬는 날 뒤엔 지난 근무일 0시)
    const c = Object.assign({}, DEF, cfg || {}); const today = kstDate(nowMs), tmd = today.slice(5);
    const out = [];
    // (a) 시기 지식 = 오늘~n일 안에 끝나거나 시작(켜진 줄만 · 1년 내내 줄 제외)
    for (const k of (knowledge || [])) {
        if (k.enabled === false || !/^\d{2}-\d{2}$/.test(k.start_md || '') || !/^\d{2}-\d{2}$/.test(k.end_md || '')) continue;
        if (k.start_md === '01-01' && k.end_md === '12-31') continue;
        const toEnd = mdDiff(tmd, k.end_md), toStart = mdDiff(tmd, k.start_md);
        if (toEnd <= c.season_days) out.push({ key: 'season-end:' + k.id + ':' + k.end_md, kind: 'season', text: `시기 지식 「${clip(k.item_key + ' ' + k.label, 30)}」 ${toEnd === 0 ? '오늘 끝' : toEnd + '일 뒤 끝'}(${md('2026-' + k.end_md)}) — 다음 시기 글이 있는지` });
        else if (toStart <= c.season_days) out.push({ key: 'season-start:' + k.id + ':' + k.start_md, kind: 'season', text: `시기 지식 「${clip(k.item_key + ' ' + k.label, 30)}」 ${toStart === 0 ? '오늘 시작' : toStart + '일 뒤 시작'}(${md('2026-' + k.start_md)}) — 글이 지금 맞는지` });
    }
    // (b) 봇 답 뒤 직원 정정(어제·오늘 · 같은 줄 또는 같은 손님 다음 줄 직원 답에 정정 낱말)
    const byU = new Map(); for (const r of (logs || [])) { const a = byU.get(r.user_id) || []; a.push(r); byU.set(r.user_id, a); }
    for (const [, a] of byU) {
        a.sort((x, y) => x.id - y.id);
        for (let i = 0; i < a.length; i++) {
            const r = a[i], b = String(r.bot_response || '');
            if (!b || b.startsWith('[')) continue;
            const cand = [r, a[i + 1]].filter(Boolean).map(x => String(x.staff_response || '')).find(s => FIX_RE.test(s));
            if (cand) out.push({ key: 'fix:' + r.id, kind: 'fix', text: `봇 답 뒤 직원 정정 #${r.id}${r.scenario_name ? ` (재료 「${clip(r.scenario_name, 24)}」)` : ''} · 손님 「${clip(r.message, 22)}」 → 직원 「${clip(cand, 30)}」` });
        }
    }
    // (c) 판매 상태가 바뀌었는데 그 품목 재료(시나리오 이름에 품목 낱말)가 그 뒤로 안 고쳐짐
    for (const p of (products || [])) {
        const pt = Date.parse(p.updated_at); if (!Number.isFinite(pt) || pt < (Number.isFinite(sinceMs) ? sinceMs : nowMs - DAY)) continue;
        const m = String(p.name || '').match(ITEM_RE); if (!m) continue; const word = m[0].replace(/\s+/g, '');
        const words = [...new Set([word, word.replace(/^(?:노지|하우스)/, '')])].filter(w => w.length >= 2);   // 「노지황금향」 상품은 시나리오 「품목-황금향」에도 걸리게(앞 노지·하우스를 뗀 이름)
        const stale = (scenarios || []).filter(s => { const nm = String(s.name || '').replace(/\s+/g, ''); return s.enabled !== false && words.some(w => nm.includes(w)) && Date.parse(s.updated_at) < pt; });
        if (stale.length) out.push({ key: 'status:' + p.id + ':' + p.status + ':' + stale.map(s => s.id).join(','), kind: 'status', text: `판매현황 「${clip(p.name, 26)}」 → ${p.status} · 그 뒤로 안 고친 재료 ${stale.slice(0, 2).map(s => '#' + s.scenario_no + ' ' + clip(s.name, 14)).join(' · ')}` });
    }
    // (d) 켜진 시나리오 본문에 이미 지난 날짜(올해 · 최근 180일 안 · 「월 일」 또는 「M/D」)
    const todayMs = Date.parse(today + 'T00:00:00Z');
    for (const s of (scenarios || [])) {
        if (s.enabled === false) continue;
        const t = String(s.response || ''); const re = /(\d{1,2})\s*월\s*(\d{1,2})\s*일|(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g; let mm, hit = null;
        while ((mm = re.exec(t))) {
            const mo = Number(mm[1] || mm[3]), da = Number(mm[2] || mm[4]); if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) continue;
            const ms = Date.UTC(Number(today.slice(0, 4)), mo - 1, da); if (ms < todayMs && todayMs - ms <= 180 * DAY) { hit = mm[0]; break; }
        }
        if (hit) out.push({ key: 'date:' + s.id + ':' + hit, kind: 'date', text: `시나리오 #${s.scenario_no} 「${clip(s.name, 18)}」에 지난 날짜 「${hit}」` });
    }
    return out;
}
function materialText(list, prevKeys) {
    if (!list.length) return null;
    const prev = new Set(prevKeys || []);
    const done = [...prev].filter(k => !list.some(x => x.key === k)).length, remain = list.filter(x => prev.has(x.key)).length;
    const lines = list.slice(0, 8).map(x => `ㆍ${prev.has(x.key) ? '(남음) ' : ''}${x.text}`);
    if (list.length > 8) lines.push(`… 외 ${list.length - 8}건`);
    const flow = (done || remain) ? `지난번 뒤 처리 ${done}건 · 아직 남음 ${remain}건\n` : '';
    return { title: RED + `답변 재료 점검 ${list.length}건`, message: flow + lines.join('\n') + '\n→ 문의 관리 답변 재료에서 그 줄 고치기', level: 'alert' };
}

// ───────────── ⑤ 어제 클레임 요약(지현 · 포인트 제외 · 사실 숫자) ─────────────
const REASONS = [
    ['파손', /파손|깨졌|깨져|깨진|깨짐|터졌|터져|터진|터짐|찌그러|짓눌|으깨|눌려|눌렸/],
    ['무름', /물러|물렀|무른|무름|흐물|물컹|짓무/],
    ['곰팡이·부패', /곰팡|썩|부패|상했|상한|상해|변질|곪/],
    ['맛', /맛없|맛이\s*없|맛이\s*이상|시어|너무\s*셔|싱거|쓴맛|덜\s*익|안\s*익|당도/],
    ['사이즈', /사이즈|크기|알이\s*(?:작|커|크)|너무\s*작|너무\s*커/],
    ['지연·미도착', /안\s*왔|안\s*와|안\s*옴|미도착|늦|분실|못\s*받|도착\s*안/],
    ['누락·오배송', /누락|빠졌|빠져|덜\s*왔|오배송|다른\s*(?:상품|게)|잘못\s*왔/],
];
const ITEMS_BRIEF = [['타이벡', /타이벡/], ['노지감귤', /노지\s*감귤|노지귤/], ['황금향', /황금향/], ['레몬', /레몬/], ['한라봉', /한라봉/], ['키위', /키위/], ['감귤(그 밖)', /감귤|귤/]];
// rows = { sms:[{key,text}], talk:[…], qna:[…], inquiry:[…] } · claims = [{ claim_kind }] · open = 지금 미답변 건수 · claimWords = sms/classify.js CLAIM_WORDS
function claimBrief({ rows, claims, open, claimWords }) {
    const words = Array.isArray(claimWords) && claimWords.length ? claimWords : ['파손', '썩', '곰팡이', '물러', '환불', '반품', '교환', '안 왔'];
    const isClaim = t => { const s = String(t || ''); return words.some(w => s.includes(w)); };
    const ch = {}, reason = {}, item = {}; let total = 0;
    for (const c of ['sms', 'talk', 'qna', 'inquiry']) {
        const per = new Map();   // 손님(대화) 하나 = 1건 · 그 손님 글을 이어 붙여 사유·품목을 봄
        for (const r of ((rows && rows[c]) || [])) { if (!isClaim(r.text)) continue; per.set(r.key, (per.get(r.key) || '') + ' ' + r.text); }
        ch[c] = per.size; total += per.size;
        for (const t of per.values()) {
            for (const [n, re] of REASONS) if (re.test(t)) reason[n] = (reason[n] || 0) + 1;
            const it = ITEMS_BRIEF.find(([, re]) => re.test(t)); if (it) item[it[0]] = (item[it[0]] || 0) + 1;
        }
    }
    const ck = {}; for (const x of (claims || [])) { const k = String(x.claim_kind || ''); ck[k] = (ck[k] || 0) + 1; }
    return { total, ch, reason, item, claims: ck, open: Number(open) || 0 };
}
function claimText(b, day, fromDay) {   // day = 마지막 날(어제) · fromDay = 첫날(쉬는 날 뒤면 지난 근무일 · 없거나 같으면 하루치)
    const join = o => Object.entries(o).filter(([, n]) => n > 0).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
    const ret = (b.claims.RETURN || 0) + (b.claims.return || 0) + (b.claims['반품'] || 0), exc = (b.claims.EXCHANGE || 0) + (b.claims.exchange || 0) + (b.claims['교환'] || 0);
    const lines = [
        `클레임 글 ${b.total}건 (문자 ${b.ch.sms || 0} · 톡톡 ${b.ch.talk || 0} · 상품문의 ${b.ch.qna || 0} · 고객문의 ${b.ch.inquiry || 0})`,
        `반품 신청 ${ret} · 교환 신청 ${exc}`,
        b.total ? `품목: ${join(b.item) || '-'}` : '',
        b.total ? `사유: ${join(b.reason) || '-'}` : '',
        `지금 미답변 ${b.open}건`,
    ].filter(Boolean);
    const n = fromDay && fromDay < day ? Math.round((dayMs(day) - dayMs(fromDay)) / DAY) + 1 : 1;
    return { title: n > 1 ? `클레임 요약 (${md(fromDay)}~${md(day)} · ${n}일치)` : `어제 클레임 요약 (${md(day)})`, message: lines.join('\n') + '\n→ 미답변은 손님 연락에서', level: (b.open > 0) ? 'alert' : 'info' };
}

// ───────────── ⑥ 정산 오류(가영) ─────────────
function settleText(row, day) {
    if (!row || !row.last_run_at) return null;
    if (kstDate(Date.parse(row.last_run_at)) !== day) return null;   // 오늘 돈 것만
    if (!/fail|error|실패|err/i.test(String(row.last_status || ''))) return null;
    return { title: RED + '정산 자동 수집 실패', message: `오늘 ${kstHM(Date.parse(row.last_run_at))} 네이버 정산 자동 수집이 실패했어요 · ${clip(row.last_error || row.last_status, 80)}\n→ 정산관리에서 오늘 정산 확인`, level: 'alert' };
}

// ───────────── 실행(1분 틱) ─────────────
async function cfgOf(pool, key) { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [key]); return r.rows.length ? r.rows[0].value : null; }
// 「그날 그 일 한 번」 표식 — 같은 순간 두 서버가 돌아도 한쪽만 RETURNING 을 받는다
async function claimOnce(pool, mark) {
    const r = await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('staff_alerts_state', jsonb_build_object('done', jsonb_build_object($1::text, now())))
        ON CONFLICT (key) DO UPDATE SET value = jsonb_set(COALESCE(agent_office_config.value, '{}'::jsonb), '{done}', COALESCE(agent_office_config.value->'done', '{}'::jsonb) || jsonb_build_object($1::text, now()))
        WHERE NOT (COALESCE(agent_office_config.value->'done', '{}'::jsonb) ? $1::text) RETURNING key`, [mark]);
    return r.rows.length > 0;
}
// 일이 실패하면 표식을 걷어 다음 틱에 다시(시도 수는 tries 에 · 3번째 실패면 표식 그대로 두고 실패 안내 1통)
async function unclaimAndCount(pool, mark) {
    const r = await pool.query(`UPDATE agent_office_config SET value = jsonb_set(jsonb_set(COALESCE(value, '{}'::jsonb), '{done}', COALESCE(value->'done', '{}'::jsonb) - $1::text),
            '{tries}', COALESCE(value->'tries', '{}'::jsonb) || jsonb_build_object($1::text, COALESCE((value->'tries'->>$1::text)::int, 0) + 1))
        WHERE key = 'staff_alerts_state' RETURNING (value->'tries'->>$1::text)::int AS n`, [mark]);
    return r.rows.length ? r.rows[0].n : 1;
}
async function reclaim(pool, mark) { await claimOnce(pool, mark); }
// 30일 지난 표식·시도 수 지우기(하루 1번)
async function gcState(pool) {
    await pool.query(`UPDATE agent_office_config SET value = jsonb_set(jsonb_set(COALESCE(value, '{}'::jsonb),
            '{done}', COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(COALESCE(value->'done', '{}'::jsonb)) e(k, v) WHERE (v #>> '{}') ~ '^\\d{4}-' AND (v #>> '{}')::timestamptz > now() - interval '30 days'), '{}'::jsonb)),
            '{tries}', COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(COALESCE(value->'tries', '{}'::jsonb)) e(k, v) WHERE substring(k from '\\d{4}-\\d{2}-\\d{2}') >= to_char((now() AT TIME ZONE 'Asia/Seoul') - interval '30 days', 'YYYY-MM-DD')), '{}'::jsonb))
        WHERE key = 'staff_alerts_state'`);
}
const FAIL_KO = { rank_alert: ['순위 문제 점검', '순위관리', 'rankings'], price_alert: ['3채널 가격 대조', '전체 가격 확인하기', 'agent-office?price=1'], cs_stale: ['미답변 점검', '손님 연락 미처리', 'agent-office?inbox=open'], cs_material: ['답변 재료 점검', '문의 관리 답변 재료', 'inquiry'], cs_claim_brief: ['클레임 요약', '손님 연락', 'agent-office?inbox=open'], settle_error: ['정산 수집 점검', '정산관리', 'settlement'] };
const MAX_TRIES = 3;
async function memGet(pool, name) { const v = (await cfgOf(pool, 'staff_alerts_state')) || {}; return (v.mem && v.mem[name]) || null; }
async function memSet(pool, name, val) {
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('staff_alerts_state', jsonb_build_object('mem', jsonb_build_object($1::text, $2::jsonb)))
        ON CONFLICT (key) DO UPDATE SET value = jsonb_set(COALESCE(agent_office_config.value, '{}'::jsonb), '{mem}', COALESCE(agent_office_config.value->'mem', '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb))`, [name, JSON.stringify(val)]);
}
async function sendTo(deps, ids, type, msg, link) {   // ids = 그날 근무자만 추린 받는 사람
    if (!msg || !ids.length) return 0;
    for (const uid of ids) await deps.notify(uid, type, msg.title, msg.message, link, msg.level || 'info');
    return ids.length;
}
async function loadHolidays(pool, cfg, log) {   // 휴무일 집합(workdays.js 규칙) — 발송 휴무일 달력은 기본 = 발송 휴무 체크한 날 전부
    let rows = [];
    if (cfg.holidays_from_shipping !== false) { try { rows = (await pool.query(`SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d, reason, COALESCE(no_ship, TRUE) AS no_ship FROM shipping_holidays WHERE deleted_at IS NULL`)).rows; } catch (e) { log.error('[직원 알림] 발송 휴무일 읽기 실패(시드·설정만):', e.message); } }
    let seed = []; try { seed = require('./shipping-schedule.js').HOLIDAYS; } catch (_) { /* 시드 없음 */ }
    return WD.holidaySetOf({ seed, cfgDays: cfg.holidays, shippingRows: rows, fromShipping: cfg.holidays_from_shipping });
}
const naiveUtc = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const inWin = (hm, a, b) => hm >= a && hm < b;

async function openItems(deps) {   // 지금 아무도 답 안 한 문의(톡톡·상품문의·고객문의 = inbox-threads 판정 그대로 · 문자 = 손님 글이 마지막이고 처리 안 된 대화)
    const out = [];
    const ib = deps.inbox || {};
    if (typeof ib._talkThreads === 'function') for (const t of await ib._talkThreads({ scope: 'open' })) out.push({ ch: 'talk', id: t.id, title: t.title, last_at: t.last_at, last_text: t.last_text });
    if (typeof ib._postThreads === 'function') for (const c of ['qna', 'inquiry']) for (const t of await ib._postThreads(c, { scope: 'open' })) out.push({ ch: c, id: t.id, title: t.title, last_at: t.last_at, last_text: t.last_text });
    const s = (await deps.pool.query(`SELECT id, phone_digits, last_in_at, last_in_text FROM sms_threads
        WHERE status IN ('new','staff_needed','draft') AND last_in_at IS NOT NULL AND (last_out_at IS NULL OR last_out_at < last_in_at)
          AND last_in_at > now() - interval '14 days' AND COALESCE(phone_digits, '') NOT LIKE '0999%' ORDER BY last_in_at`)).rows;
    for (const r of s) out.push({ ch: 'sms', id: String(r.id), title: '문자 …' + String(r.phone_digits || '').slice(-4), last_at: new Date(r.last_in_at).toISOString(), last_text: r.last_in_text || '' });
    return out;
}

async function run(deps) {
    const pool = deps.pool, log = deps.log || console, now = deps.now ? deps.now() : Date.now();
    const cfg = Object.assign({}, DEF, (await cfgOf(pool, 'staff_alerts')) || {});
    if (cfg.enabled !== true || typeof deps.notify !== 'function' || !deps.routes) return { skipped: 'off' };
    const day = kstDate(now), hm = kstHM(now), yday = kstDate(now - DAY), done = [];
    // 쉬는 날 = 받는 사람마다(근무 요일 staff_alerts.workdays + 휴무일 = 공휴일 시드·설정 날짜·발송 휴무일 달력) · 견줄 날·모을 첫날 = 그 사람의 지난 근무일
    const hol = await loadHolidays(pool, cfg, log), wd = cfg.workdays || null;
    const working = async type => (await deps.routes.routeIds(type, [])).filter(uid => !WD.isOffFor(uid, day, wd, hol));
    const pwdOf = uid => WD.prevWorkdayFor(uid, day, wd, hol);
    const byPwd = ids => { const m = new Map(); for (const uid of ids) { const p = pwdOf(uid); m.set(p, (m.get(p) || []).concat(uid)); } return m; };
    let offAll = true;   // 받는 사람이 정해진 종류 가운데 오늘 근무자가 한 명이라도 있는지(없으면 skipped holiday)
    // 그날 근무자가 없는 일은 표식·기억 없이 건너뜀(다음 근무일에 그 사람 기준으로 다시) · 「남음」 기억은 종류별 공용(보낸 회차 기준)
    const job = async (type, mark, fn) => {
        const ids = await working(type); if (!ids.length) return;
        offAll = false;
        if (!(await claimOnce(pool, mark))) return;
        try { done.push(mark + ':' + (await fn(ids))); }
        catch (e) {
            // 외부 조회(가격·순위·DB) 실패 = 표식 걷고 다음 틱에 다시(그 종류 시간 창 안에서만) · 3번째도 실패면 표식 두고 담당에게 실패 안내 1통(조용히 빠지지 않게)
            log.error('[직원 알림] ' + mark + ' 실패:', e.message);
            let n = MAX_TRIES; try { n = await unclaimAndCount(pool, mark); } catch (e2) { log.error('[직원 알림] 표식 되돌리기 실패:', e2.message); }
            if (n >= MAX_TRIES) {
                try { await reclaim(pool, mark); } catch (_) { /* 다음 틱 */ }
                const [what, where, link] = FAIL_KO[type] || ['점검', '해당 화면', ''];
                await sendTo(deps, ids, type, { title: RED + `오늘 ${what} 못 함`, message: `자동 점검이 ${MAX_TRIES}번 실패했어요 · ${clip(e.message, 80)}\n→ ${where}에서 직접 확인`, level: 'alert' }, link).catch(() => {});
                done.push(mark + ':fail');
            } else done.push(mark + ':retry' + n);
        }
    };
    if (await claimOnce(pool, 'gc:' + day)) { try { await gcState(pool); } catch (e) { log.error('[직원 알림] 표식 정리 실패:', e.message); } }

    // 순위 = 그날 자동 수집이 끝나고(keyword_rank_last.date = 오늘) 요약 텔레그램이 나간 뒤 · 13시까지
    const last = await cfgOf(pool, 'keyword_rank_last');
    if (last && last.date === day && last.notified_date === day && hm < '13:00') await job('rank_alert', 'rank:' + day, async ids => {
        // 견줄 날 = 받는 사람의 지난 근무일(평일 = 어제 · 월~금 직원의 월요일 = 금요일 → 주말 사이 사라짐도 월요일에)
        const prev = (await memGet(pool, 'rank')) || {};
        let n = 0; const sentMap = {};
        for (const [pwd, group] of byPwd(ids)) {
            const rows = (await pool.query(`SELECT date::text AS d, keyword, shopping_rank FROM keyword_rankings WHERE date IN ($1::date, $2::date)`, [day, pwd])).rows;
            const r = rankAlerts({ today: rows.filter(x => x.d === day), yest: rows.filter(x => x.d === pwd), last, prev: prev.date === pwd ? prev.sent : null, cfg });
            for (const x of r.items) sentMap[x.keyword] = x.kind;
            n += await sendTo(deps, group, 'rank_alert', rankText(r, day, pwd), 'rankings');
        }
        await memSet(pool, 'rank', { date: day, sent: sentMap });
        return n;
    });
    // 가격 = 10:00~12:00 하루 1번(04:30 스냅샷 · 05:10 자사몰 점검 뒤)
    if (typeof deps.priceReport === 'function' && inWin(hm, '10:00', '12:00')) await job('price_alert', 'price:' + day, async ids => {
        const r = priceDiff(await deps.priceReport(), cfg);
        if (!r.ok) throw new Error('가격 확인 못 함: ' + (r.error || '알 수 없음'));   // 다시 시도 → 3번째면 실패 안내
        const prev = (await memGet(pool, 'price')) || [];
        await memSet(pool, 'price', r.items.map(x => x.key));
        return sendTo(deps, ids, 'price_alert', priceText(r, prev), 'agent-office?price=1');
    });
    // 묵은 미답변 = 09:00·15:00 묶음(두 시간 안에 못 돌면 그 회차는 건너뜀) · 그날 근무자에게만
    for (const [slot, a, b] of [['09시', '09:01', '11:00'], ['15시', '15:00', '17:00']]) if (inWin(hm, a, b)) await job('cs_stale', 'stale:' + day + ':' + slot, async ids => {
        const r = staleUnanswered(await openItems(deps), now, cfg, await memGet(pool, 'stale'));
        await memSet(pool, 'stale', r.keys);
        return sendTo(deps, ids, 'cs_stale', staleText(r, `${md(day)} ${slot}`), 'agent-office?inbox=open');
    });
    // 답변 재료 점검 · 클레임 요약 = 09:00~11:00
    if (inWin(hm, '09:01', '11:00')) {
        await job('cs_material', 'material:' + day, async ids => {
            // 정정·상태 바뀜 = 받는 사람들 가운데 가장 이른 지난 근무일 0시(KST)부터 · received_at = naive UTC
            const sinceMs = Math.min(...ids.map(uid => dayMs(pwdOf(uid)) - KST));
            const [knowledge, logs, products, scenarios] = await Promise.all([
                pool.query(`SELECT id, item_key, label, start_md, end_md, enabled FROM product_season_knowledge`).then(r => r.rows),
                pool.query(`SELECT id, user_id, message, bot_response, staff_response, scenario_name FROM message_logs WHERE received_at >= $1::timestamp ORDER BY id`, [naiveUtc(sinceMs)]).then(r => r.rows),
                pool.query(`SELECT id, name, status, updated_at FROM bot_products WHERE deleted_at IS NULL AND updated_at >= $1::timestamptz`, [new Date(sinceMs).toISOString()]).then(r => r.rows),
                pool.query(`SELECT id, scenario_no, name, response, enabled, updated_at FROM inquiry_scenarios WHERE deleted_at IS NULL`).then(r => r.rows)]);
            const list = materialSignals({ knowledge, logs, products, scenarios, nowMs: now, cfg, sinceMs });
            const prev = await memGet(pool, 'material');
            await memSet(pool, 'material', list.map(x => x.key));
            return sendTo(deps, ids, 'cs_material', materialText(list, prev), 'inquiry');
        });
        await job('cs_claim_brief', 'claim:' + day, async ids => {
          let open = 0; try { open = (await openItems(deps)).length; } catch (e) { log.error('[직원 알림] 미답변 셈 실패(0으로):', e.message); }
          let words = null; try { words = require('./sms/classify.js').CLAIM_WORDS; } catch (_) { /* 기본 낱말 */ }
          let sentN = 0;
          for (const [pwd, group] of byPwd(ids)) {
            // 모을 기간(KST) = [그 사람의 지난 근무일 00:00, 오늘 00:00) = 평일 어제 하루 · 월~금 직원의 월요일 금~일 3일치 · naive UTC 칸은 −9시간 · timestamptz 칸은 그대로
            const a = pwd + ' 00:00', b = day + ' 00:00';
            const q = (sql) => pool.query(sql, [a, b]).then(r => r.rows).catch(e => { if (e && e.code === '42P01') return []; throw e; });
            const [sms, talk, qna, inq, claims] = await Promise.all([
                q(`SELECT thread_id::text AS key, body AS text FROM sms_messages WHERE direction = 'in' AND sender = 'customer' AND created_at >= ($1::timestamp AT TIME ZONE 'Asia/Seoul') AND created_at < ($2::timestamp AT TIME ZONE 'Asia/Seoul')`),
                q(`SELECT user_id AS key, message AS text FROM message_logs WHERE received_at >= $1::timestamp - interval '9 hours' AND received_at < $2::timestamp - interval '9 hours' AND message NOT LIKE '[%'`),
                q(`SELECT question_id::text AS key, raw->>'question' AS text FROM naver_qnas WHERE collected_at >= $1::timestamp - interval '9 hours' AND collected_at < $2::timestamp - interval '9 hours'`),
                q(`SELECT inquiry_id::text AS key, concat_ws(' ', raw->>'title', raw->>'content') AS text FROM naver_inquiries WHERE collected_at >= $1::timestamp - interval '9 hours' AND collected_at < $2::timestamp - interval '9 hours'`),
                q(`SELECT claim_kind FROM naver_claim_alerted WHERE alerted_at >= $1::timestamp - interval '9 hours' AND alerted_at < $2::timestamp - interval '9 hours'`)]);
            sentN += await sendTo(deps, group, 'cs_claim_brief', claimText(claimBrief({ rows: { sms, talk, qna, inquiry: inq }, claims, open, claimWords: words }), yday, pwd), 'agent-office?inbox=open');
          }
          return sentN;
        });
    }
    // 정산 자동 수집 실패 = 10:00~18:00 · 그날 1번
    if (inWin(hm, '10:00', '18:00')) {
        // last_run_at = 시간대 없는 UTC 값 → 글자로 받아 Z 를 붙임(JS Date 로 받으면 서버 시간대만큼 어긋남)
        const row = (await pool.query(`SELECT to_char(last_run_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_run_at, last_status, last_error FROM naver_auto_collect WHERE key = 'settlement'`)).rows[0];
        const msg = settleText(row || null, day);
        if (msg) await job('settle_error', 'settle:' + day, async ids => sendTo(deps, ids, 'settle_error', msg, 'settlement'));
    }
    // 받는 사람이 정해진 종류가 있는데 그 누구도 오늘 근무하지 않음 = 쉬는 날 표시(검증·로그용 · 보낸 것 0)
    if (offAll && !done.length) {
        const TYPES = ['rank_alert', 'price_alert', 'cs_stale', 'cs_material', 'cs_claim_brief', 'settle_error'];
        let routed = 0, workingN = 0;
        for (const t of TYPES) { const all = await deps.routes.routeIds(t, []); routed += all.length; workingN += all.filter(uid => !WD.isOffFor(uid, day, wd, hol)).length; }
        if (routed && !workingN) return { skipped: 'holiday', day, done };
    }
    return { done };
}

module.exports = { run, isOffDay, prevWorkday, holidaySetOf, rankAlerts, rankText, priceDiff, priceText, staleUnanswered, staleText, materialSignals, materialText, claimBrief, claimText, settleText, kstDate, kstHM, PRICE_KINDS, DEF };

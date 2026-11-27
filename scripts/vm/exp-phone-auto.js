// #1040 체험 예약(플레이스) 번호 미입력 → 나스 윈도우 VM 어사이드가 스마트플레이스 예약자관리에서 읽어 서버에 저장(설계 docs/1039-exp-phone-auto.md (나) 구도)
//
//   한 틱 = ① GET  {EXP_AUTO_API}/api/experience/auto/todo     (서버가 번호 미입력·확정·오늘 이후·플레이스 줄만 · 시간 창·하루 상한도 서버가 거름)
//           ② 어사이드: https://partner.booking.naver.com/bizes/1258756/booking-list-view?keyword=<예약번호> → 그 예약번호가 든 줄 읽기(#997 워커3 실코드 꼴)
//           ③ PUT  …/auto/:id  {order_no_seen, status_seen, visit_seen:{date,time}, name_seen, visitor_phone, booker_phone}
//              → 서버가 다시 대조(예약번호·상태·날짜·시간·가린 이름 글자·번호 꼴) → 저장 + 접수 알림톡(서버 sendRecvNow)
//           ④ 못 찾음·불일치·서버 400 = POST …/auto/:id/miss {reason} (서버가 텔레그램 · 건당 하루 1회) · 보안 확인·로그인 화면 = 그 틱 전체 멈춤 + miss id 0
//   🔴 번호 고르기(이용고객 먼저 → 예약자)는 서버 experience.js PHONE_PICK_ORDER 한 곳 · 여기는 화면에서 본 두 칸을 그대로 보냄(고르지 않음)
//   🔴 DB 0(DATABASE_URL 안 씀) · 텔레그램 키 0 · 로그 파일 따로 안 씀(stdout·stderr → 작업 도구 install-exp-phone-auto.js 가 ~/.akkome/logs/exp-phone-auto-YYYY-MM-DD.log 에 붙임)
//   🔴 손님 번호는 끝 4자리만 찍음 · 이름은 가린 꼴(첫 글자 + *)
//
// 사용: node scripts/vm/exp-phone-auto.js --once        (작업 스케줄러 「아꼼이-체험번호-자동」 이 10분마다 · 한 틱 돌고 끝)
//       node scripts/vm/exp-phone-auto.js --once --dry  (읽기만 · PUT·miss 0 · 화면에서 읽은 칸을 끝 4자리로 찍음 = 첫 실화면 꼴 확인용)
//       --force-window = 08~21시 창 무시(#1088 09:25~09:45 창 없앰)(시험용 · 서버 창은 그대로)
//   환경(.env · main 안에서 dotenv 먼저) = EXP_AUTO_API(예 https://event.akkome.com) · EXP_AUTO_TOKEN · ASIDE_EXE(없으면 %LOCALAPPDATA%\Aside\CLI\current\aside.exe)
//   종료 코드 = 0 정상(건너뜀 포함) · 2 일부 실패·멈춤(보안 확인·miss·서버 오류) · 1 스크립트 오류
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const BIZ = '1258756';
const LIST_URL = no => `https://partner.booking.naver.com/bizes/${BIZ}/booking-list-view?keyword=${encodeURIComponent(no)}`;
const PAGE_WAIT_MS = 6000;           // #997 실측 = 6초 뒤 목록이 그려짐
const TICK_BUDGET_MS = 6 * 60000;    // 작업 도구가 8분에 끔 → 6분 넘으면 남은 줄은 다음 틱
const LOCAL_WINDOW = { hours: [0, 24], skip: null };   // #1212(대표 11/21 「설정 시간 없이 바로」) 08~21 → 하루 전부(inWindow 는 h < 24)   // #1088 09:25~09:45 건너뛰기 없앰(키워드 순위와 겹침 = 잠금 줄 세우기 · 잠금 잡혀 있으면 그 틱 건너뜀 종전 그대로)   // 서버 설정이 정본 · 서버에 묻기 전에 걸러 헛호출을 줄임
const LOCK = path.join(os.homedir(), '.akkome', 'exp-phone-auto.lock');
const LOCK_STALE_MS = 15 * 60000;
// 화면 칸 이름(머리글 · 같은 줄 안 글자) — 이용고객(방문자) vs 예약자 · 🔴 실화면 미확인(11/6) → 첫 --dry 결과로 맞춤
const VISITOR_RE = /이용\s*고객|이용자|방문자|방문\s*고객/;
const BOOKER_RE = /예약자|예약\s*고객|신청자/;
const STATUS_RE = /(확정|취소|이용완료|노쇼|신청|대기|미확정)/;
const PHONE_RE = /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g;
// #1106 외국 이름(띄어쓰기·20자 넘음 · 예 「Oyungerel Oyuntsetseg」) = 라틴·키릴 글자 낱말 여럿(40자까지 · 숫자 없음) · 한국 이름은 종전 꼴이 먼저 맞으므로 결과 그대로
const FN_L = 'A-Za-z\\u00C0-\\u024F\\u0400-\\u04FF';
const FOREIGN_NAME = `[${FN_L}][${FN_L} .'\\-]{0,38}[${FN_L}.]`;

// #1312(대표 11/27) 네이버 예약 파트너센터 「개인정보 조회」 인증 전 = 이름 가운데 별표 · 번호 「***-****-끝4자리」 · 화면 위 PrivacyAuthButton
//   → 인증은 사람이(VM 어사이드에서 단추 → 휴대폰 인증 · 자동으로 누르거나 번호를 넣지 않음) · 여기는 ①가림 알아채기 ②살아 있으면 종전대로 채움 ③유지 시간 재기(로컬 파일) ④가림 알림은 상태 전체로 1통(서버가 갈래당 하루 1회)
const MASKED_PHONE_RE = /\*{2,4}[-\s]?\*{3,4}[-\s]?\d{4}/;
const PRIVACY_FILE = path.join(os.homedir(), '.akkome', 'exp-privacy.json');
const PRIVACY_REASON = '번호 가림 — 네이버 예약 『개인정보 조회』 인증 필요(나스 VM 어사이드에서 1번)';
// 줄·화면 → 가림 여부(순수 · verify-1312) — 줄에 가린 번호 꼴이 있거나, 줄에 번호가 하나도 없는데 인증 단추가 「조회 전」으로 보이면 가림
function isMasked(row, privacy) {
    const text = String((row && row.text) || '') + ' ' + JSON.stringify((row && row.parts) || {});
    if (MASKED_PHONE_RE.test(text)) return true;
    const p = privacy || {};
    const hasPhone = /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(text);
    const nameMasked = /[가-힣A-Za-z]\*+[가-힣A-Za-z]?/.test(text);   // 워커2 점검 1 = 둘째 조건은 이름도 별표 꼴일 때만(인증 뒤 단추 글이 그대로여도 번호 안 남긴 한 줄로 틱 전체가 멈추지 않게)
    return !!(p.btn && !hasPhone && nameMasked && /개인정보\s*조회/.test(String(p.btn_text || '')) && !/해제|조회\s*중|완료/.test(String(p.btn_text || '')));
}
// 상태 전이(순수) — prev {state, since, last_open_since?, log:[]} · now 'open'|'masked' → { next, changed, held_ms(open → masked 일 때 직전 open 이 버틴 시간) }
function privacyStep(prev, now, atIso) {
    const p = prev && typeof prev === 'object' ? prev : {};
    const log = Array.isArray(p.log) ? p.log.slice(-29) : [];
    if (p.state === now) return { next: Object.assign({}, p, { seen_at: atIso, log }), changed: false, held_ms: null };
    const held = (p.state === 'open' && now === 'masked' && p.since) ? Date.parse(atIso) - Date.parse(p.since) : null;
    log.push({ from: p.state || null, to: now, at: atIso, ...(held != null ? { held_min: Math.round(held / 60000) } : {}) });
    return { next: { state: now, since: atIso, seen_at: atIso, ...(now === 'masked' && p.state === 'open' ? { last_open: { since: p.since, until: atIso } } : (p.last_open ? { last_open: p.last_open } : {})), log }, changed: true, held_ms: held };
}
function privacyReason(n, st) {
    const lo = st && st.last_open;
    const hm = s => { const d = new Date(Date.parse(s) + 9 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
    const m = lo && lo.since && lo.until ? Math.round((Date.parse(lo.until) - Date.parse(lo.since)) / 60000) : null;
    const held = m != null && m >= 0 ? ` · 직전 인증 유지 약 ${m >= 60 ? (m / 60).toFixed(1) + '시간' : m + '분'}(${hm(lo.since)}~${hm(lo.until)} 사이 틱 기준)` : '';
    return `${PRIVACY_REASON} · 번호 빈 예약 ${n >= 20 ? '20건 이상' : n + '건'}${held}`;   // 서버 todo 한 틱 상한 20줄
}
function privacyLoad(file) { try { return JSON.parse(fs.readFileSync(file || PRIVACY_FILE, 'utf8')); } catch (e) { return null; } }
function privacySave(st, file) { try { fs.mkdirSync(path.dirname(file || PRIVACY_FILE), { recursive: true }); fs.writeFileSync(file || PRIVACY_FILE, JSON.stringify(st)); } catch (e) { /* 기록 실패는 무시(번호 채우기와 무관) */ } }

const tail4 = p => p ? '…' + String(p).replace(/\D/g, '').slice(-4) : '-';
const maskName = s => { const a = [...String(s || '')]; return a.length ? a[0] + '*'.repeat(Math.max(0, a.length - 1)) : '-'; };
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const ts = () => kstNow().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(ts(), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function inWindow(w, k) {
    const h = k.getUTCHours(), hm = String(h).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
    if (!(h >= w.hours[0] && h < w.hours[1])) return false;
    if (w.skip && hm >= w.skip[0] && hm < w.skip[1]) return false;
    return true;
}

// ── 화면에서 돌릴 코드: 예약번호가 든 줄(행)마다 {text, cells:[{h,t}]} + 막힘 판정 ──
//   행 = 그 번호 글자를 품은 가장 가까운 tr / [role=row] / li · 머리글 = 같은 표의 th·[role=columnheader] 순서
const JS_READ = no => `(() => {
  const body = (document.body && document.body.innerText) || '';
  const head = body.slice(0, 800);
  let blocked = '';
  if (/보안 ?확인을 완료|접속이 일시적으로 제한|비정상적인 접근/.test(head)) blocked = 'security';
  else if (/captcha|보안문자|자동입력 방지/i.test(head) || document.querySelector('#captcha, img[src*="captcha"]')) blocked = 'captcha';
  else if (/nid\\.naver\\.com/.test(location.href) || /로그인 상태 유지|아이디 또는 전화번호/.test(head)) blocked = 'login';
  if (blocked) return { blocked, url: location.href.slice(0, 120) };
  const NO = ${JSON.stringify(String(no))};
  const seen = new Set(), rows = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || n.nodeValue.indexOf(NO) < 0) continue;
    let el = n.parentElement;
    let row = el && el.closest('tr, [role="row"], li');
    if (!row && el) { let u = el; for (let i = 0; i < 6 && u && u !== document.body; i++, u = u.parentElement) { if (/01[016789][-\\s]?\\d{3,4}[-\\s]?\\d{4}|\\*{2,4}[-\\s]?\\*{3,4}[-\\s]?\\d{4}/.test(u.innerText || '')) { row = u; break; } } }   // 표가 아닌 div 줄 = 번호가 보이는 가장 가까운 묶음(#1312 가린 번호 꼴도)
    if (!row || seen.has(row)) continue;
    seen.add(row);
    if (row.closest('input, textarea, [role="search"], form[role="search"]')) continue;   // 검색 칸에 남은 번호는 줄이 아님
    const table = row.closest('table, [role="table"], [role="grid"]');
    const hs = table ? [...table.querySelectorAll('th, [role="columnheader"]')].map(x => (x.innerText || '').trim()) : [];
    const cs = [...row.querySelectorAll(':scope > td, :scope > [role="cell"], :scope > [role="gridcell"]')].map(x => (x.innerText || '').trim());
    // #1211(대표 11/21) 대리예약 줄 = 이름 칸 [예약자(name-ellipsis) · 「대리예약」(label) · 「방문자: 이름」(sub-text)] / 번호 칸 [예약자 번호(첫 칸) · 방문자 번호(sub-phone)] 를 칸별로 따로(실화면 11/21 #1210 · 보통 줄은 sub-* 가 없음)
    const q = s => row.querySelector(s), tx = e => e ? (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '';
    const pc = q('[class*="__phone__"]');
    const parts = { booker: tx(q('[class*="name-ellipsis"]')), label: tx(q('[class*="__label__"]')), sub: tx(q('[class*="sub-text"]')), bphone: pc ? tx([...pc.children].find(c => !/sub-phone/.test(String(c.className || '')))) : '', vphone: tx(q('[class*="sub-phone"]')) };
    rows.push({ text: (row.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600), cells: cs.map((t, i) => ({ h: hs[i] || '', t: t.replace(/\\s+/g, ' ').slice(0, 200) })), parts });
  }
  const pb = document.querySelector('[class*="PrivacyAuthButton"]');   // #1312 「개인정보 조회」 단추(누르지 않음 · 글자·class 만 읽음)
  const privacy = pb ? { btn: true, btn_text: (pb.innerText || pb.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40), btn_cls: String(pb.className || '').slice(0, 120) } : { btn: false };
  return { blocked: '', rows, body_hit: body.indexOf(NO) >= 0, privacy };
})()`;

// ── 읽은 줄 → 보낼 값(순수 함수 · verify-1040 이 떼어 시험) ──
//   ① 머리글 칸이 있으면 칸 이름으로 이용고객·예약자 칸을 찾음 ② 없으면 줄 글자에서 「이용고객 홍길동 010-…」 꼴 · ③ 그래도 없으면 #997 꼴(상태 이름 번호 예약번호 날짜 시각) = 그 번호는 예약자
// 「26.11.09.(일) 오후 1:30」 → { date:'2026-11-09', time:'13:30' } · 첫 날짜 뒤 첫 시각
function parseWhen(s) {
    s = String(s || ''); const out = { date: null, time: null };
    const dm = /(?:20)?(\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})\.?/.exec(s);
    if (!dm) return out;
    out.date = `20${dm[1]}-${String(+dm[2]).padStart(2, '0')}-${String(+dm[3]).padStart(2, '0')}`;
    const tm = /(오전|오후)?\s*(\d{1,2}):(\d{2})/.exec(s.slice(dm.index + dm[0].length));
    if (tm) { let h = +tm[2]; if (tm[1] === '오후' && h < 12) h += 12; if (tm[1] === '오전' && h === 12) h = 0; out.time = String(h).padStart(2, '0') + ':' + tm[3]; }
    return out;
}
function parseRow(row, no) {
    const out = { status_seen: null, name_seen: null, visitor_phone: null, booker_phone: null, visit_seen: { date: null, time: null }, how: '' };
    const text = String(row.text || '');
    const st = STATUS_RE.exec(text); out.status_seen = st ? st[1] : null;
    const wc = (Array.isArray(row.cells) ? row.cells : []).find(c => /이용\s*일시|이용\s*일|방문\s*일/.test(c.h));   // 머리글 칸이 있으면 그 칸 · 없으면 예약번호 뒤 첫 날짜(그 앞은 신청 일시일 수 있음)
    out.visit_seen = parseWhen(wc ? wc.t : text.slice(Math.max(0, text.indexOf(no))));
    const phoneIn = s => { const m = String(s || '').match(PHONE_RE); return m ? m[0].replace(/\D/g, '') : null; };
    const nameIn = s => {
        const c = String(s || '').replace(PHONE_RE, ' ').replace(/[()·|,]/g, ' ').replace(/\s+/g, ' ').trim();
        if (new RegExp('^' + FOREIGN_NAME + '$').test(c) && /\s/.test(c)) return c;   // #1106 칸 글자가 외국 이름 낱말 여럿뿐이면 통째로
        const t = c.split(/\s+/).filter(x => /^[가-힣A-Za-z]{2,10}$/.test(x) && !STATUS_RE.test(x)); return t[0] || null;
    };
    // #1211 대리예약 = 칸별로 읽은 값만 씀 · 메일 대조 이름 = 예약자(name_seen) · 저장 이름 후보 = 방문자(visitor_name_seen · 서버가 방문자 번호를 고를 때만 씀) · 방문자 번호 = sub-phone 칸에서만
    const P = row.parts || null;
    if (P && (/대리\s*예약/.test(P.label || '') || /^방문자\s*[:：]/.test(P.sub || ''))) {
        out.how = 'proxy';
        out.name_seen = nameIn(P.booker);
        out.visitor_name_seen = nameIn(String(P.sub || '').replace(/^방문자\s*[:：]\s*/, '')) || null;
        out.booker_phone = phoneIn(P.bphone);
        out.visitor_phone = phoneIn(P.vphone);
        if (!out.name_seen || !out.booker_phone) out.how = '';   // 예약자 칸을 못 읽음 = 멈춤(miss 「꼴 모름」)
        return out;
    }
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const vc = cells.find(c => VISITOR_RE.test(c.h)), bc = cells.find(c => BOOKER_RE.test(c.h));
    if (vc || bc) {
        out.how = 'cells';
        if (vc) out.visitor_phone = phoneIn(vc.t);
        if (bc) { out.booker_phone = phoneIn(bc.t); out.name_seen = nameIn(bc.t); }
        if (!out.name_seen && vc) out.name_seen = nameIn(vc.t);
        const sc = cells.find(c => /상태/.test(c.h)); if (sc) { const s = STATUS_RE.exec(sc.t); if (s) out.status_seen = s[1]; }
        return out;
    }
    // #1211 대리예약 글자는 있는데 칸으로 못 나눔(화면 바뀜) = 멈춤 · 아래 labels 꼴은 「방문자: 이름」 바로 뒤의 예약자 번호를 방문자 번호로 잡음(#1210 실화면)
    { const at = text.indexOf(String(no)); if (/대리\s*예약|방문자\s*[:：]/.test(at >= 0 ? text.slice(0, at) : text)) return out; }   // 예약번호 앞(상태·이름·번호 자리)만 봄 = 요청사항·메모의 같은 글자는 안 걸림(워커3 점검 · 실화면 순서 = 이름·번호가 예약번호 앞)
    const lv = new RegExp('(?:' + VISITOR_RE.source + ')\\s*[:：]?\\s*([가-힣A-Za-z]{0,10}|' + FOREIGN_NAME + ')\\s*(' + PHONE_RE.source + ')').exec(text);
    const lb = new RegExp('(?:' + BOOKER_RE.source + ')\\s*[:：]?\\s*([가-힣A-Za-z]{0,10}|' + FOREIGN_NAME + ')\\s*(' + PHONE_RE.source + ')').exec(text);
    if (lv || lb) {
        out.how = 'labels';
        if (lv) out.visitor_phone = lv[2].replace(/\D/g, '');
        if (lb) { out.booker_phone = lb[2].replace(/\D/g, ''); out.name_seen = lb[1] || null; }
        if (!out.name_seen && lv) out.name_seen = lv[1] || null;
        return out;
    }
    // #997 꼴 = 「확정 홍길동 010-1234-5678 1396624487 26.11.09.(일) 12:30 …」
    // #1106 종전 한 낱말 꼴 먼저 · 안 맞으면 외국 이름(띄어쓰기) · 실화면 = 외국 이름 뒤에 한글 음역이 붙어 나옴(「Oyungerel Oyuntsetseg 오윤게렐 오윤트세그」) → 음역은 이름에서 뺌
    // #1135 실화면 = 「AL KINDI YOUSUF AHMED MASOUD 외국인 알 킨디 유수프 아메드 마수드」(「외국인」 표식 + 음역 5낱말) → 한글 낱말 0~12 · 번호·예약번호 닻은 그대로
    const m = new RegExp(STATUS_RE.source + '\\s+(?:([^\\s\\d]{1,20}?)|(' + FOREIGN_NAME + ')(?:\\s+[가-힣]{1,10}){0,12})\\s+(' + PHONE_RE.source + ')\\s+' + String(no)).exec(text);
    if (m) { out.how = 'line'; out.status_seen = m[1]; out.name_seen = m[2] || m[3]; out.booker_phone = m[4].replace(/\D/g, ''); }
    return out;
}

// 키워드 순위(install-keyword-rank.js · launcher.js rankMaybe)가 띄우기 전에 {day} 를 적고 끝나면 {day, result} 로 덮음 → 오늘 + result 없음 = 도는 중
//   60분 넘은 표식은 죽은 것으로 봄(#1088 키워드가 잠금을 최대 35분 기다린 뒤 20분 돎 = install-keyword-rank 55분 상한 · 그날 내내 막히지 않게)
const KR_STATE = path.join(os.homedir(), '.akkome', 'keyword-rank.json');
function krBusy(nowMs) {
    try {
        const j = JSON.parse(fs.readFileSync(KR_STATE, 'utf8'));
        const now = nowMs == null ? Date.now() : nowMs, today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
        if (!j || j.day !== today || j.result != null) return false;
        const at = Date.parse(j.at || '');
        return !(at && now - at > 60 * 60000);
    } catch (e) { return false; }
}
function lockTake() {
    try {
        fs.mkdirSync(path.dirname(LOCK), { recursive: true });
        if (fs.existsSync(LOCK)) { if (Date.now() - fs.statSync(LOCK).mtimeMs < LOCK_STALE_MS) return false; try { fs.unlinkSync(LOCK); } catch (e) { /* 남이 먼저 지움 */ } }   // 15분 넘은 낡은 잠금만 지움
        const fd = fs.openSync(LOCK, 'wx'); try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }   // #1041-b 'wx' = 이미 있으면 실패(VM 러너와 동시에 잡아도 하나만)
        return true;
    } catch (e) { return false; }
}
function lockFree() { try { if (fs.existsSync(LOCK) && fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.unlinkSync(LOCK); } catch (e) { /* 무시 */ } }

async function main(deps = {}) {   // deps = 검증용(verify-1312 · api·Aside·privacyFile·noGuards) · 실행은 빈 값 = 종전 그대로
    const args = deps.args || process.argv.slice(2);
    const DRY = args.includes('--dry'), FORCE = args.includes('--force-window');
    if (!deps.api) { try { require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') }); } catch (e) { /* dotenv 없으면 사용자 환경 변수만 */ } }
    const API = String(process.env.EXP_AUTO_API || '').replace(/\/+$/, ''), TOKEN = String(process.env.EXP_AUTO_TOKEN || '');
    const ASIDE_EXE = process.env.ASIDE_EXE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Aside', 'CLI', 'current', 'aside.exe');
    if (!deps.api && (!/^https?:\/\//.test(API) || TOKEN.length < 32)) { log('설정 없음 — .env EXP_AUTO_API·EXP_AUTO_TOKEN 확인'); return 1; }
    if (!deps.noGuards) {
        if (!FORCE && !inWindow(LOCAL_WINDOW, kstNow())) { log('시간 밖 — 건너뜀'); return 0; }
        if (krBusy()) { log('키워드 순위가 어사이드를 쓰는 중(keyword-rank.json 오늘 · 결과 없음) — 건너뜀'); return 0; }
        if (!lockTake()) { log('다른 틱이 도는 중(잠금 파일) — 건너뜀'); return 0; }
    }
    const PFILE = deps.privacyFile || PRIVACY_FILE;
    const privacyMark = (state) => { const st = privacyStep(privacyLoad(PFILE), state, new Date(deps.nowMs ? deps.nowMs() : Date.now()).toISOString()); if (!DRY) privacySave(st.next, PFILE); if (st.changed) log(`  개인정보 조회 상태 ${(st.next.log.slice(-1)[0] || {}).from || '-'} → ${state}${st.held_ms != null ? ' · 직전 인증 유지 ' + Math.round(st.held_ms / 60000) + '분' : ''}`); return st; };
    const t0 = Date.now(); let bad = 0, saved = 0, aside = null;
    const api = deps.api || async function (method, p, body) {
        const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
        let j = null; try { j = await r.json(); } catch (e) { j = {}; }
        return { s: r.status, j };
    };
    const miss = async (id, reason, kind) => { if (DRY) { log(`  (dry) miss ${id} · ${reason}`); return; } try { await api('POST', `/api/experience/auto/${id}/miss`, { reason, kind }); } catch (e) { log('  miss 못 보냄: ' + e.message); } };
    try {
        const td = await api('GET', '/api/experience/auto/todo');
        if (td.s !== 200) { log(`todo ${td.s} · ${td.j && td.j.error || ''}`); return td.s === 403 ? 0 : 2; }   // 403 = 꺼짐(정상 건너뜀)
        const items = (td.j && td.j.items) || [];
        if (!items.length) { log(`할 일 0${td.j.reason ? ' · ' + td.j.reason : ''}`); return 0; }
        log(`할 일 ${items.length}줄 · 오늘 남은 ${td.j.left}${DRY ? ' · dry' : ''}`);
        const { Aside } = deps.Aside ? { Aside: deps.Aside } : require(path.join(ROOT, 'scripts', 'desk', 'keyword-rank.js'));
        aside = new Aside(ASIDE_EXE, s => log(s));
        await aside.start();
        for (const it of items) {
            if (Date.now() - t0 > TICK_BUDGET_MS) { log('6분 넘음 — 남은 줄은 다음 틱'); break; }
            const tag = `#${it.id} 예약 ${it.order_no} · ${it.visit_date} ${it.visit_time} · ${maskName(it.name_masked)}`;
            let got;
            try {
                // #1106 { } 블록으로 감쌈 = 어사이드 repl 은 최상위 const·let 을 세션 내내 들고 있어 한 틱 둘째 줄부터 「Identifier 't' has already been declared」로 멈췄음(11/11 08:00·08:10 로그 · 틱마다 1줄만 처리)
                got = await aside.replJson('#1040 예약자 읽기', `{ const t = await openTab(${JSON.stringify(LIST_URL(it.order_no))}); await new Promise(r => setTimeout(r, ${PAGE_WAIT_MS}));
let out; try { out = await t.evaluate(() => ${JS_READ(it.order_no)}); } catch (e) { out = { error: String(e && e.message || e).slice(0, 200) }; }
if (!(out && out.blocked)) { try { await closeTab(t); } catch (e) {} }   // 보안 확인·로그인 화면 = 탭을 남겨 대표가 VM 어사이드에서 바로 풂(keyword-rank blocked 꼴)
console.log(JSON.stringify(out)); }`);
            } catch (e) { log(`${tag} · 어사이드 오류 ${e.message.slice(0, 120)}`); bad++; break; }   // 어사이드 자체 문제 = 이 틱 멈춤(다음 틱 재시도 · 알림은 안 보냄 = 잠깐 끊김이 흔함)
            if (got && got.blocked) { log(`${tag} · 멈춤 ${got.blocked} ${got.url || ''}`); await miss(0, (got.blocked === 'login' ? '어사이드 네이버 로그인 풀림 — VM 어사이드에 열어 둔 탭에서 다시 로그인(대표 폰 인증)' : '네이버 보안 확인 화면 — VM 어사이드에 열어 둔 탭에서 풀어 주세요') + ' · partner.booking.naver.com 예약자관리(booking-list-view)', got.blocked); bad++; break; }   // 서버가 사유의 7자리↑ 숫자를 지우므로 업체 번호 없이 화면 이름만
            if (!got || got.error) { log(`${tag} · 화면 읽기 실패 ${got && got.error || ''}`); await miss(it.id, '예약자관리 화면을 읽지 못함'); bad++; continue; }
            const rows = got.rows || [];
            if (rows.length !== 1) { log(`${tag} · 그 예약번호 줄 ${rows.length}개`); await miss(it.id, rows.length ? `같은 예약번호 줄 ${rows.length}개` : '예약자관리에서 못 찾음'); bad++; continue; }
            if (isMasked(rows[0], got.privacy)) {   // #1312 가림 = 화면 전체가 인증 전 → 이 틱 멈춤 · 예약마다 miss 를 안 보냄(그 예약이 todo 에서 30분·하루 6번 걸러지지 않게 = 인증 뒤 첫 틱에 밀린 것 전부 채움) · 알림 1통(서버 「g:privacy」 하루 1회)
                const st = privacyMark('masked');
                log(`${tag} · 번호 가림(개인정보 조회 전 · 단추 「${(got.privacy && got.privacy.btn_text) || '-'}」) — 이 틱 멈춤 · 번호 빈 예약 ${items.length}건`);
                await miss(0, privacyReason(items.length, st.next), 'privacy');
                bad++; break;
            }
            const p = parseRow(rows[0], it.order_no);
            if (p.how && (p.visitor_phone || p.booker_phone)) privacyMark('open');   // #1312 번호가 전체로 보임 = 인증 살아 있음(유지 시간 재기)
            log(`${tag} · 읽음(${p.how || '꼴 모름'}) 상태 ${p.status_seen} · ${p.visit_seen.date} ${p.visit_seen.time} · ${maskName(p.name_seen)}${p.how === 'proxy' ? ' (대리예약 · 방문자 ' + maskName(p.visitor_name_seen) + ')' : ''} · 이용고객 ${tail4(p.visitor_phone)} · 예약자 ${tail4(p.booker_phone)}`);
            if (!p.how) { await miss(it.id, '화면 줄 꼴 모름(예약자관리 화면이 바뀌었을 수 있음)'); bad++; continue; }
            if (DRY) continue;
            const body = { order_no_seen: String(it.order_no), status_seen: p.status_seen, visit_seen: p.visit_seen, name_seen: p.name_seen, ...(p.visitor_name_seen ? { visitor_name_seen: p.visitor_name_seen } : {}), visitor_phone: p.visitor_phone, booker_phone: p.booker_phone };
            const r = await api('PUT', `/api/experience/auto/${it.id}`, body);
            if (r.s === 200) { saved++; log(`  저장 ✓ (${r.j.picked}) 알림 ${r.j.sent || '-'}${r.j.dup_ids && r.j.dup_ids.length ? ' · 같은 번호 다른 예약 ' + r.j.dup_ids.join(',') : ''}`); }
            else if (r.s === 409 || r.s === 429) log(`  건너뜀 ${r.s} ${r.j.error || ''}`);
            else { log(`  저장 안 함 ${r.s} ${r.j.reason || ''} ${r.j.error || ''}`); await miss(it.id, r.j.error || ('서버 ' + r.s)); bad++; }
            await sleep(1500);
        }
    } finally {
        if (aside) await aside.stop({ keepTabs: true }).catch(() => { });   // 자기 탭은 repl 안에서 이미 닫음 · 다른 일(키워드 순위 KR_shop 등) 탭은 건드리지 않음
        lockFree();
        log(`끝 · 저장 ${saved} · 문제 ${bad} · ${Math.round((Date.now() - t0) / 1000)}초`);
    }
    return bad ? 2 : 0;
}

if (require.main === module) {
    main().then(code => process.exit(code), e => { console.error(ts(), '스크립트 오류:', e && e.stack || e); lockFree(); process.exit(1); });
}
module.exports = { parseRow, inWindow, krBusy, JS_READ, LIST_URL, VISITOR_RE, BOOKER_RE, isMasked, privacyStep, privacyReason, main, PRIVACY_REASON };

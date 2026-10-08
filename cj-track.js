// #594 CJ대한통운 배송조회 모듈 — 서버(배송조회 러너)와 창구 도구(ship-status.js · ship-track.js)가 같이 쓴다.
//   조회 길 = CJ 누리집 배송조회 화면이 쓰는 주소(직원이 손으로 보는 그 화면 · 키 없음 · 공식 API 아님 → 화면이 바뀌면 깨질 수 있다).
//   상용 서비스(Delivery Tracker 등)로 바꿀 때는 fetchRaw 만 갈아 끼운다(classify·집계는 그대로).
//   실측(워커2 10/8): 1,609건 순차 15분 · 동시 5 약 3분 · 동시 10 약 1.5~2분 · 403/429 0. 기본 동시 5 · 상한 10.
//   상태 코드(crgSt): 11 집화처리 · 21/41/42/44 간선상하차 · 82 배송출발 · 91 배송완료. 미배송(섬지역)은 별도 코드가 아니라
//   82 문구 「배송할 예정입니다.(익일)(배송담당:도서지역(출발))」 꼴 → 문구 낱말로 가린다. 사고·파손·반송은 아직 실측 0건 — 낱말로 대기 · 모르는 건 「기타」.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const PAGE = 'https://www.cjlogistics.com/ko/tool/parcel/tracking';
const DETAIL = 'https://www.cjlogistics.com/ko/tool/parcel/tracking-detail';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let sess = null, opening = null;
function openSession() { if (!opening) opening = openSession1().finally(() => { opening = null; }); return opening; }   // 동시 조회 때 화면은 한 번만 연다
async function openSession1() {
    const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error('조회 화면 열기 실패 HTTP ' + res.status);
    const html = await res.text();
    const m = html.match(/name="_csrf"[^>]*value="([^"]+)"/) || html.match(/value="([^"]+)"[^>]*name="_csrf"/);
    if (!m) throw new Error('조회 화면 구조가 바뀌었습니다(_csrf 없음)');
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    sess = { csrf: m[1], cookie };
}

const normTracking = tr => String(tr || '').replace(/\D/g, '');   // 「6007-5080-1715」 → 「600750801715」
const fmtTracking = tr => normTracking(tr).replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3');

// 한 건 원본 조회 — { tr, head, ev } 또는 { tr, error }
async function fetchRaw(tr) {
    tr = normTracking(tr); let wait = 1000;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (!sess) await openSession();
            const se = sess; const qs = new URLSearchParams({ paramInvcNo: tr, _csrf: se.csrf }).toString();
            const res = await fetch(DETAIL + '?' + qs, { method: 'POST', headers: { 'user-agent': UA, cookie: se.cookie, 'x-requested-with': 'XMLHttpRequest', referer: PAGE } });
            if (res.status === 429 || res.status >= 500) throw Object.assign(new Error('HTTP ' + res.status), { retry: true });
            if (res.status === 403) { if (sess === se) sess = null; throw Object.assign(new Error('HTTP 403'), { retry: true }); }   // 세션 만료 → 다시 열기
            if (!res.ok) return { tr, error: 'HTTP ' + res.status };
            const j = await res.json();
            const head = (j.parcelResultMap && j.parcelResultMap.resultList || [])[0] || null;
            const ev = (j.parcelDetailResultMap && j.parcelDetailResultMap.resultList || []);
            ev.sort((a, b) => String(a.dTime || '').localeCompare(String(b.dTime || '')));   // 응답 순서가 시간순이 아닐 때가 있다(실측: 41 → 11 → 44 …)
            return { tr, head, ev };
        } catch (e) {
            if (attempt === 2 || (!e.retry && !/fetch failed|ECONN|ETIMEDOUT|JSON/i.test(String(e.message)))) return { tr, error: String(e.message).slice(0, 120) };
            await sleep(wait); wait *= 2;   // 1s → 2s
        }
    }
    return { tr, error: '재시도 끝' };
}

// 상태 분류 — 모르는 코드는 「기타」에 원문 그대로 모은다(며칠 쌓이면 사고·반송 문구를 여기서 확정)
const TROUBLE = /미배달|미배송|사고|파손|분실|오도착|반송|반품|주소\s*불명|수취\s*거부|수취인\s*부재|도선|도서|연락\s*불가|보류|잔류/;
const DRIVER = /([가-힣]{2,4})\s(\d{3}-\d{3,4}-\d{4})/;   // 「(배송담당:홍길동 010-…)」 꼴
function classify(r) {
    if (r.error) return { bucket: '조회실패', code: '', label: r.error, msg: '', time: '', branch: '', driver: null, delivered: false, events: [] };
    if (!r.ev || !r.ev.length) return { bucket: '정보없음', code: '', label: '조회 내역 없음', msg: '', time: '', branch: '', driver: null, delivered: false, events: [] };
    const last = r.ev[r.ev.length - 1]; const st = String(last.crgSt || ''), nm = String(last.scanNm || ''), msg = String(last.crgNm || '');
    const delivered = r.ev.some(e => String(e.crgSt) === '91');
    let bucket;
    if (delivered) bucket = '배송완료';
    else if (TROUBLE.test(nm) || TROUBLE.test(msg)) bucket = /사고|파손|분실/.test(nm + msg) ? '사고' : '미배송';
    else if (st === '82') bucket = '배송출발';
    else if (st === '41' || st === '42' || st === '44' || st === '21') bucket = '간선상하차';
    else if (st === '11') bucket = '집화';
    else bucket = '기타';
    let driver = null; for (let i = r.ev.length - 1; i >= 0 && !driver; i--) { const m2 = String(r.ev[i].crgNm || '').match(DRIVER); if (m2) driver = { name: m2[1], phone: m2[2] }; }
    return { bucket, code: st, label: nm, msg: msg.replace(/\d{3}-\d{3,4}-\d{4}/g, '***'), time: String(last.dTime || '').slice(0, 16), branch: last.regBranNm || '', driver, delivered,
        events: r.ev.map(e => ({ code: String(e.crgSt || ''), label: e.scanNm || '', time: String(e.dTime || '').slice(0, 16), branch: e.regBranNm || '' })) };
}

// 한 건 = 분류까지
async function trackOne(tr) { return Object.assign({ tracking: normTracking(tr) }, classify(await fetchRaw(tr))); }

// 여러 건 — 동시 conc(기본 5 · 상한 10) · 건 사이 gap ms · 연속 3건 조회실패면 멈춤(stopped) · onEach(result, i) 로 진행 알림
async function trackMany(list, { conc = 5, gap = 350, onEach } = {}) {
    conc = Math.max(1, Math.min(10, +conc || 5)); const res = new Array(list.length);
    let next = 0, failRun = 0, stopped = null, asked = 0;
    const worker = async () => {
        while (next < list.length && !stopped) {
            const i = next++; const k = await trackOne(list[i]); res[i] = k; asked++;
            if (k.bucket === '조회실패') { if (++failRun >= 3) stopped = { asked, of: list.length, why: k.label }; } else failRun = 0;
            if (onEach) { try { await onEach(k, i, asked); } catch (e) { /* 진행 알림 실패는 조회를 막지 않는다 */ } }
            if (next < list.length) await sleep(gap);
        }
    };
    await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));
    return { results: res, asked, stopped };
}

// 직원 카톡 양식 한 줄(대표 확정 10/8): 「10/07 발송 1,609건 (중복 15건)\n배송완료 … / 배송출발 … / 간선상하차 … / 미배송 … / 사고 …\n(집화 10)」
function summaryText({ label, total, dupExtra, counts }) {
    const n = b => counts[b] || 0;
    const etc = ['집화', '기타', '정보없음', '조회실패'].filter(b => n(b)).map(b => b + ' ' + n(b)).join(' / ');
    return `${label} 발송 ${Number(total).toLocaleString()}건 (중복 ${dupExtra}건)\n배송완료 ${n('배송완료')} / 배송출발 ${n('배송출발')} / 간선상하차 ${n('간선상하차')} / 미배송 ${n('미배송')} / 사고 ${n('사고')}` + (etc ? `\n(${etc})` : '');
}

module.exports = { fetchRaw, classify, trackOne, trackMany, summaryText, normTracking, fmtTracking, TROUBLE_BUCKETS: ['미배송', '사고', '기타', '정보없음', '조회실패'] };

'use strict';
/*
 * 제주아꼼이네 — 네이버 커머스API 중계서버 (akkome-relay)
 * 역할: Render 회사프로그램의 요청을 받아 네이버 커머스API로 대신 호출(고정 IP 경유).
 *   [Render] → [이 서버(101.79.16.213)] → [네이버 커머스API]
 * 보안: 네이버 시크릿은 이 서버에만 보관. 회사프로그램만 자체 Bearer 토큰으로 호출 가능.
 * 1차 범위: 읽기 전용(정산·주문 조회)만 허용. 쓰기(발송처리 등)는 허용목록에서 차단.
 * 의존성: express, bcryptjs (Node 20+ 내장 fetch/URLSearchParams 사용).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

// 중계서버 버전 — install.sh 재실행으로 최신 코드가 반영됐는지 확인용(/health에 노출).
const RELAY_VERSION = '2026-08-24.1'; // #402: 쿠팡 발주확인(PATCH acknowledgement) 허용 + /coupang body 전달(vendorId 강제 주입)

const {
    PORT = 4000,
    NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET,
    NAVER_TYPE = 'SELF',
    RELAY_AUTH_TOKEN,
    NAVER_API_BASE = 'https://api.commerce.naver.com',
    COUPANG_ACCESS_KEY,
    COUPANG_SECRET_KEY,
    COUPANG_VENDOR_ID,
    COUPANG_API_BASE = 'https://api-gateway.coupang.com',
} = process.env;

// ── 로그 (시크릿·토큰 마스킹) ──
// 대표 7/24 설계: 이 서버는 텔레그램을 직접 부르지 않는다. 오류는 (1)journalctl 로그 (2)HTTP 응답으로만
//   돌려주고, 알림은 회사프로그램(텔레그램 시크릿 보유처)이 담당 → 시크릿이 한 곳에만 존재.
function mask(s) {
    return String(s == null ? '' : s)
        .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
        .replace(/("?access_token"?\s*[:=]\s*"?)[A-Za-z0-9._-]+/gi, '$1***')
        .slice(0, 800);
}
function log(...a) { console.log(new Date().toISOString(), ...a.map(x => (typeof x === 'string' ? mask(x) : x))); }

// ── 네이버 인증 토큰 발급 + 캐싱 ──
// 서명: bcrypt(`clientId_timestamp`, salt=client_secret) → base64. (네이버 표준)
let tokenCache = { value: null, exp: 0 };
async function getAccessToken() {
    const now = Date.now();
    if (tokenCache.value && now < tokenCache.exp - 60_000) return tokenCache.value; // 만료 1분 전까지 재사용
    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
        const e = new Error('네이버 자격증명(.env) 미설정'); e.status = 500; throw e;
    }
    const ts = now; // 밀리초
    const hashed = bcrypt.hashSync(`${NAVER_CLIENT_ID}_${ts}`, NAVER_CLIENT_SECRET);
    const sign = Buffer.from(hashed, 'utf-8').toString('base64');
    const form = new URLSearchParams({
        client_id: NAVER_CLIENT_ID,
        timestamp: String(ts),
        grant_type: 'client_credentials',
        client_secret_sign: sign,
        type: NAVER_TYPE,
    });
    const res = await fetch(`${NAVER_API_BASE}/external/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok || !data.access_token) {
        log('토큰 발급 실패', res.status, mask(text)); // 알림은 회사프로그램이 응답 보고 발송
        const e = new Error('token_issue_failed'); e.status = res.status; e.body = data; throw e;
    }
    tokenCache = { value: data.access_token, exp: now + (Number(data.expires_in) || 10800) * 1000 };
    log('네이버 토큰 발급 성공 · 만료(초)=', data.expires_in);
    return tokenCache.value;
}

// ── 허용 경로 (1차: 읽기 전용. 쓰기 전면 차단) ──
// 대표 7/24: 읽기(GET) 전체 허용 — 정산·주문·문의·판매자정보 조회. 앞으로 새 '조회' 기능마다 재실행 불필요.
//   쓰기(발송처리·답변등록 등 POST/PUT/DELETE)는 전면 차단(상세조회 query만 예외적 POST 허용). 5차+ 쓰기는 명시적으로 추가.
const ALLOW = [
    { m: 'GET',  re: /^\/external\/v1\/pay-settle\// },                            // 정산 조회 전체
    { m: 'GET',  re: /^\/external\/v1\/pay-order\/seller\// },                     // 주문 조회 전체(조건형·변경목록·단건·취소/반품 상태)
    { m: 'GET',  re: /^\/external\/v1\/pay-user\// },                              // 문의 조회 등
    { m: 'GET',  re: /^\/external\/v1\/seller\// },                                // 판매자정보 조회
    { m: 'POST', re: /^\/external\/v1\/pay-order\/seller\/product-orders\/query$/ }, // 상품주문 상세조회(POST지만 읽기)
    { m: 'GET',  re: /^\/external\/v1\/contents\/qnas$/ },                         // 상품문의(Q&A) 목록 조회 (STEP E)
    { m: 'PUT',  re: /^\/external\/v1\/contents\/qnas\/\d+$/ },                    // 상품문의 답변 등록/수정 (STEP E, questionId 숫자 정확일치만)
    { m: 'POST', re: /^\/external\/v1\/pay-merchant\/inquiries\/\d+\/answer$/ },   // 고객문의 답변 등록 — 쓰기 2번째 (inquiryNo 숫자 정확일치만)
    { m: 'POST', re: /^\/external\/v1\/pay-order\/seller\/product-orders\/confirm$/ }, // 발주확인 — 쓰기 3번째 (지시 #92: 알림톡 발송 성공 건만, 회사프로그램 KAKAO_NOTIFY 스위치 종속)
    { m: 'POST', re: /^\/external\/v1\/products\/search$/ },                       // 상품 목록 조회 (POST지만 읽기 — 지시 #103·#104 자사몰 실데이터)
    { m: 'GET',  re: /^\/external\/v2\/products\// },                              // 원상품·채널상품 단건 조회 (대표이미지·가격·옵션·상세 — 읽기)
];
function allowed(method, path) { return ALLOW.some(a => a.m === method && a.re.test(path)); }

const app = express();
app.use(express.json({ limit: '4mb' }));   // 지시 #100: 알림톡 이미지(≤500KB, base64 ~680KB) 수용 여유분

// 헬스체크 (인증 불필요) — 토큰 발급까지 시험하려면 ?token=1
app.get('/health', async (req, res) => {
    const base = {
        ok: true, version: RELAY_VERSION, time: new Date().toISOString(), token_cached: !!tokenCache.value,
        coupang_keys_set: !!(COUPANG_ACCESS_KEY && COUPANG_SECRET_KEY && COUPANG_VENDOR_ID), // 값 노출 없음
    };
    if (req.query.token === '1') {
        try { await getAccessToken(); base.token_test = 'success'; }
        catch (e) { base.token_test = 'fail'; base.token_error = e.status || e.message; }
    }
    res.json(base);
});

// 자체 Bearer 인증 (회사프로그램만 통과)
app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    if (!RELAY_AUTH_TOKEN || auth !== `Bearer ${RELAY_AUTH_TOKEN}`) {
        log('인증 거부', req.method, req.path);
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
});

// 네이버 호출 중계: POST /naver  { method, path, query?, body? }
app.post('/naver', async (req, res) => {
    const method = String((req.body && req.body.method) || 'GET').toUpperCase();
    const path = String((req.body && req.body.path) || '');
    const query = (req.body && req.body.query) || null;
    const body = (req.body && req.body.body) || null;
    if (!allowed(method, path)) {
        log('차단(허용목록 외)', method, path);
        return res.status(403).json({ error: 'path_not_allowed', method, path });
    }
    try {
        const qs = query && typeof query === 'object' ? '?' + new URLSearchParams(query).toString() : '';
        const token = await getAccessToken();
        const opt = {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        };
        if (body && method !== 'GET') opt.body = JSON.stringify(body);   // PUT(답변 등록)도 바디 전달 — POST 한정이던 버그 수정 (2026-07-27 실검증 #683035819)
        const nres = await fetch(`${NAVER_API_BASE}${path}${qs}`, opt);
        const text = await nres.text();
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (!nres.ok) log('네이버 응답 오류', method, path, nres.status); // 알림은 회사프로그램이 담당
        res.status(nres.status).json(json);
    } catch (e) {
        log('중계 예외', method, path, e.message);
        res.status(e.status || 500).json({ error: 'relay_error', message: e.message, body: e.body });
    }
});

// ══════════════ 쿠팡 OPEN API 중계 (2026-07-26 — 지시문_쿠팡_송장변환_연동 v2) ══════════════
// 원칙: 배송/주문 '조회' 2종만 허용(상품·가격 API 호출 코드 자체 없음). 쿠팡 키는 이 서버 .env에만.
// HMAC 서명 (쿠팡 공식 문서 PHP/Java 예제 그대로):
//   datetime(UTC yyMMdd'T'HHmmss'Z') + METHOD + path + query → HMAC-SHA256(hex, secret)
//   Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…
function coupangSign(method, urlPath, queryString) {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const dt = String(now.getUTCFullYear()).slice(2) + p(now.getUTCMonth() + 1) + p(now.getUTCDate())
        + 'T' + p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + 'Z';
    const message = dt + method + urlPath + queryString;
    const signature = crypto.createHmac('sha256', COUPANG_SECRET_KEY).update(message).digest('hex');
    return `CEA algorithm=HmacSHA256, access-key=${COUPANG_ACCESS_KEY}, signed-date=${dt}, signature=${signature}`;
}

// 허용목록: 경로 '템플릿'과 정확 일치해야 하며, {vendorId}는 서버가 .env 값으로 강제 치환(경로 위조 차단).
const COUPANG_ALLOW = [
    { m: 'GET', tpl: '/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets' },     // 발주서(상품준비중) 목록
    { m: 'GET', tpl: '/v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests' },  // 반품/취소 요청 목록
    // #402(2026-08-24 대표 확정): 발주확인 = 결제완료 → 상품준비중 (알림 발송 성공 건 한정 — 회사프로그램이 판단).
    //   공식 스펙: PATCH·body {vendorId, shipmentBoxIds[]} 최대 50개·결제완료 상태만 적용.
    { m: 'PATCH', tpl: '/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets/acknowledgement' },
];

// 쿠팡 호출 중계: POST /coupang  { method, path(템플릿 그대로), query?, body? }
app.post('/coupang', async (req, res) => {
    const method = String((req.body && req.body.method) || 'GET').toUpperCase();
    const reqPath = String((req.body && req.body.path) || '');
    const query = (req.body && req.body.query) || null;
    const reqBody = (req.body && req.body.body) || null;   // #402: 쓰기(PATCH) body — 허용목록 경로에서만 사용됨
    if (!COUPANG_ACCESS_KEY || !COUPANG_SECRET_KEY || !COUPANG_VENDOR_ID) {
        return res.status(503).json({ error: 'coupang_keys_not_set' });
    }
    const rule = COUPANG_ALLOW.find(a => a.m === method && a.tpl === reqPath);
    if (!rule) {
        log('쿠팡 차단(허용목록 외)', method, reqPath);
        return res.status(403).json({ error: 'path_not_allowed', method, path: reqPath });
    }
    const realPath = rule.tpl.replace('{vendorId}', COUPANG_VENDOR_ID);
    try {
        // 서명과 실제 요청의 쿼리 문자열은 반드시 동일 바이트 — 같은 문자열을 두 곳에 사용
        const qs = query && typeof query === 'object' ? new URLSearchParams(query).toString() : '';
        const auth = coupangSign(method, realPath, qs);
        const url = `${COUPANG_API_BASE}${realPath}${qs ? '?' + qs : ''}`;
        // #402: body의 vendorId는 경로와 동일하게 .env 값으로 강제(위조 차단) — GET은 body 없음(종전 동일)
        const safeBody = (method !== 'GET' && reqBody && typeof reqBody === 'object')
            ? JSON.stringify({ ...reqBody, vendorId: COUPANG_VENDOR_ID }) : undefined;
        const cres = await fetch(url, {
            method,
            headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' },
            ...(safeBody ? { body: safeBody } : {}),
        });
        const text = await cres.text();
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (!cres.ok) log('쿠팡 응답 오류', method, realPath, cres.status); // 알림은 회사프로그램이 담당
        res.status(cres.status).json(json);
    } catch (e) {
        log('쿠팡 중계 예외', method, reqPath, e.message);
        res.status(e.status || 500).json({ error: 'relay_error', message: e.message });
    }
});

// ══════════════ 알리고 API 중계 (지시 #95 — 2026-07-29) ══════════════
// 알리고는 등록된 발송 서버 IP에서만 호출 허용 → Render(유동 IP) 불가.
// 이 서버의 고정 IP(101.79.16.213)를 대표가 알리고 관리자에 등록하고, 회사프로그램이 여기를 경유한다.
// 알리고 키는 회사프로그램(Render env)이 보관 — 이 서버는 form을 전달만 함(키 미보관, 네이버·쿠팡과 반대 구조).
// 허용목록: 알림톡(토큰·템플릿 목록/등록/검수·발송) + 문자(발송·잔여건수)만. 그 외 경로 차단.
const ALIGO_ALLOW = [
    { host: 'kakaoapi.aligo.in', re: /^\/akv10\/(token\/create\/\d+\/[sm]|template\/(list|add|request|del)\/?|alimtalk\/send\/?)$/ },   // #138: template/del 추가(폐기 정리 전용)
    { host: 'apis.aligo.in', re: /^\/(send|remain)\/?$/ },
];
// 알리고 호출 중계: POST /aligo  { host, path, form, image_b64?, image_name? }
// 지시 #100: image_b64가 오면 multipart/form-data로 전송(이미지형 템플릿 등록 — image 파일 필드). 없으면 기존 urlencoded.
app.post('/aligo', async (req, res) => {
    const host = String((req.body && req.body.host) || '');
    const reqPath = String((req.body && req.body.path) || '');
    const form = (req.body && req.body.form) || {};
    const imageB64 = (req.body && req.body.image_b64) || null;
    const imageName = String((req.body && req.body.image_name) || 'image.jpg').replace(/[^\w.\-]/g, '_').slice(0, 60);
    if (!ALIGO_ALLOW.some(a => a.host === host && a.re.test(reqPath))) {
        log('알리고 차단(허용목록 외)', host, reqPath);
        return res.status(403).json({ error: 'path_not_allowed', host, path: reqPath });
    }
    try {
        let fetchOpts;
        if (imageB64) {
            const buf = Buffer.from(String(imageB64), 'base64');
            if (buf.length > 1024 * 1024) return res.status(413).json({ error: 'image_too_large' });   // 알리고 규격 500KB — 여유 상한 1MB
            const fd = new FormData();   // Node 20 내장 (undici) — multipart 경계·인코딩 자동
            for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
            const mime = imageName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
            fd.append('image', new Blob([buf], { type: mime }), imageName);
            fetchOpts = { method: 'POST', body: fd };
        } else {
            fetchOpts = {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(form).toString(),
            };
        }
        const ares = await fetch(`https://${host}${reqPath}`, fetchOpts);
        const text = await ares.text();
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (!ares.ok) log('알리고 응답 오류', host, reqPath, ares.status); // 알림은 회사프로그램이 담당
        res.status(ares.status).json(json);
    } catch (e) {
        log('알리고 중계 예외', host, reqPath, e.message);
        res.status(e.status || 500).json({ error: 'relay_error', message: e.message });
    }
});

// ══════════════ 네이버 공개 지표 수집 (지시 #310 — 2026-08-09) ══════════════
// 🔴 배경: brand.naver.com(공개 스토어)은 일반 HTTP 요청을 **429로 차단**한다. 2026-08-09 실측 결과
//    같은 IP에서도 [일반 fetch = 429] / [실제 브라우저 = 200] → IP 차단이 아니라 **봇 지문 차단**이었다.
//    (#234·#247에서 "원천 봉쇄"로 판정하고 리뷰 갱신을 껐던 것의 진짜 원인.)
// → 이 서버에서 헤드리스 브라우저로 **공개 화면만** 열어 지표를 읽는다.
//    로그인·주문·개인정보는 일절 건드리지 않는다(공개 페이지의 숫자만 추출).
// 사용: POST /naver-public  { action:'store' }                        → { interestCount, avgScore, reviewCount }
//       POST /naver-public  { action:'products', products:[번호,...] } → [{ no, reviewCount, score, buyBadge }]
const NP_STORE = 'jejuakkome';
let _npBusy = false;
app.post('/naver-public', async (req, res) => {
    const action = String((req.body && req.body.action) || 'store');
    const products = Array.isArray(req.body && req.body.products) ? req.body.products.slice(0, 30) : [];
    if (_npBusy) return res.status(429).json({ error: 'busy', message: '이미 수집 중입니다(동시 실행 금지 — 메모리 보호)' });
    let pw;
    try { pw = require('playwright'); }
    catch (e) { return res.status(501).json({ error: 'playwright_missing', message: 'install.sh 재실행으로 브라우저를 설치하세요' }); }

    _npBusy = true;
    let browser = null;
    const t0 = Date.now();
    try {
        browser = await pw.chromium.launch({
            headless: true,
            // 메모리 적은 서버(1GB급) 보호 — 공유메모리 대신 임시파일 사용 + 불필요 기능 차단
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--js-flags=--max-old-space-size=256'],
        });
        const ctx = await browser.newContext({
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR',
        });
        // 이미지·폰트·영상은 받지 않는다(숫자만 필요 — 메모리·시간 절감)
        await ctx.route('**/*', (route) => {
            const t = route.request().resourceType();
            return (t === 'image' || t === 'media' || t === 'font') ? route.abort() : route.continue();
        });
        const page = await ctx.newPage();
        const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/[\d.]+/); return m ? Number(m[0]) : null; };

        if (action === 'store') {
            const r = await page.goto(`https://brand.naver.com/${NP_STORE}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
            if (!r || r.status() !== 200) throw Object.assign(new Error('store_page_' + (r ? r.status() : 'null')), { status: 502 });
            await page.waitForTimeout(4000);
            const out = await page.evaluate(() => {
                const t = document.body.innerText.replace(/\s+/g, ' ');
                // 🔴 실측 교정(#310-b): 스토어 홈엔 「현재 판매 순위」 상품 카드가 함께 뜨고, 렌더가 느린 서버에서는
                //    문서 전체 첫 매치가 **상품 리뷰수/평점**으로 잡힌다(대표 실행 결과 리뷰 12,657 = 청귤 1개 값).
                //    → 평점·리뷰는 **「관심고객수」 주변 창(±220자)** 안에서만 찾는다. 못 찾으면 null(추측 금지).
                const i = t.search(/관심고객수?\s*[\d,]+/);
                const win = i >= 0 ? t.slice(Math.max(0, i - 220), i + 220) : '';
                return {
                    interest: (t.match(/관심고객수?\s*[\d,]+/) || [''])[0],
                    score: (win.match(/평점\s*[\d.]+/) || [''])[0],
                    review: (win.match(/리뷰\s*[\d,]+/) || [''])[0],
                    window: win.slice(0, 260),   // 진단용 — 값이 이상하면 이 문맥을 보고 판정
                };
            });
            const body = { interestCount: num(out.interest), avgScore: num(out.score), reviewCount: num(out.review), context: out.window, ms: Date.now() - t0 };
            if (body.interestCount == null) throw Object.assign(new Error('interest_not_found'), { status: 502 });
            log('공개지표 store', JSON.stringify(body));
            return res.json(body);
        }

        if (action === 'products') {
            const rows = [];
            for (const no of products) {
                const pno = String(no).replace(/[^0-9]/g, '');
                if (!pno) continue;
                try {
                    const r = await page.goto(`https://brand.naver.com/${NP_STORE}/products/${pno}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
                    await page.waitForTimeout(2500);
                    const o = await page.evaluate(() => {
                        const t = document.body.innerText.replace(/\s+/g, ' ');
                        return {
                            review: (t.match(/리뷰\s*[\d,]+/) || [''])[0],
                            score: (t.match(/평점\s*[\d.]+/) || [''])[0],
                            badge: (t.match(/오늘\s*[\d,]+명\s*구매|최근 \d+일간[^가-힣]{0,4}[가-힣 ]{0,12}/) || [''])[0],
                        };
                    });
                    rows.push({ no: pno, status: r ? r.status() : null, reviewCount: num(o.review), score: num(o.score), buyBadge: o.badge || null });
                } catch (e) { rows.push({ no: pno, error: String(e.message).slice(0, 60) }); }
                await new Promise(s => setTimeout(s, 1200));   // 예의상 간격(차단 유발 방지)
            }
            log('공개지표 products', rows.length + '건 ' + (Date.now() - t0) + 'ms');
            return res.json({ items: rows, ms: Date.now() - t0 });
        }

        // ── #312: 리뷰 본문 수집 (지시 #234·#247에서 429로 6일 연속 실패 후 중단됐던 것) ──
        //   🔴 핵심: 리뷰 API를 **브라우저 안에서** 호출한다(같은 출처·쿠키·지문 보유) → 서버에서 직접 부르면 429.
        //   products = [{ no: 채널상품번호, originNo: 원상품번호 }] — originNo가 있어야 리뷰 조회가 된다.
        if (action === 'reviews') {
            const merchantNo = Number(req.body && req.body.merchantNo) || 510497562;
            const perProduct = Math.min(Math.max(Number(req.body && req.body.perProduct) || 20, 1), 20);
            const out = {}; const fails = [];
            for (const it of products) {
                const pno = String((it && it.no) || it).replace(/[^0-9]/g, '');
                const ono = String((it && it.originNo) || '').replace(/[^0-9]/g, '');
                if (!pno || !ono) { fails.push({ no: pno, why: 'originNo 없음' }); continue; }
                try {
                    await page.goto(`https://brand.naver.com/${NP_STORE}/products/${pno}`, { waitUntil: 'domcontentloaded', timeout: 40000 });
                    await page.waitForTimeout(1500);
                    const j = await page.evaluate(async (a) => {
                        try {
                            const r2 = await fetch('/n/v1/contents/reviews/query-pages', {
                                method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
                                body: JSON.stringify({ checkoutMerchantNo: a.m, originProductNo: Number(a.o), page: 1, pageSize: a.n, reviewSearchSortType: 'REVIEW_RANKING' }),
                            });
                            if (r2.status !== 200) return { status: r2.status };
                            const d = await r2.json().catch(() => null);
                            return {
                                status: 200,
                                rows: ((d && d.contents) || []).map(x => ({
                                    score: x.reviewScore,
                                    labels: x.labels || [],        // BEST·재구매 — 화면 뱃지 + 롤링 우선순위 재료(빠뜨리면 엄선이 무력화됨)
                                    text: String(x.reviewContent || '').replace(/\s+/g, ' ').slice(0, 300),   // ⚠️ 화면이 읽는 정본 필드명은 text (content 아님)
                                    date: String(x.createDate || '').slice(0, 10),
                                    writer: x.maskedWriterId,          // 네이버 마스킹형 그대로 — 원문 PII 미수집
                                    opt: String(x.productOptionContent || '').slice(0, 120),
                                })),
                            };
                        } catch (e) { return { status: -1, err: String(e).slice(0, 60) }; }
                    }, { m: merchantNo, o: ono, n: perProduct });
                    if (j && j.status === 200 && j.rows && j.rows.length) out[pno] = j.rows;
                    else fails.push({ no: pno, why: 'http_' + (j && j.status) });
                } catch (e) { fails.push({ no: pno, why: String(e.message).slice(0, 50) }); }
                await new Promise(s => setTimeout(s, 1500));
            }
            const total = Object.values(out).reduce((s, a) => s + a.length, 0);
            log('공개지표 reviews', Object.keys(out).length + '종 ' + total + '건 (실패 ' + fails.length + ') ' + (Date.now() - t0) + 'ms');
            return res.json({ reviews: out, products: Object.keys(out).length, total, fails, ms: Date.now() - t0 });
        }

        return res.status(400).json({ error: 'unknown_action', action });
    } catch (e) {
        log('공개지표 실패', action, e.message);
        return res.status(e.status || 500).json({ error: 'public_fetch_error', message: String(e.message).slice(0, 160) });
    } finally {
        try { if (browser) await browser.close(); } catch (_) { }
        _npBusy = false;
    }
});

// 대표 7/24: 인증서(cert.pem/key.pem)가 있으면 HTTPS로, 없으면 HTTP로 (하위호환).
//   주문 상세 등 고객정보(PII)가 오가므로 HTTPS 필수 — install.sh가 자체서명 인증서 생성.
const CERT = path.join(__dirname, 'cert.pem');
const KEY = path.join(__dirname, 'key.pem');
if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
    https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, app)
        .listen(PORT, () => log(`akkome-relay HTTPS 시작 :${PORT} · type=${NAVER_TYPE}`));
} else {
    app.listen(PORT, () => log(`akkome-relay HTTP 시작 :${PORT} · type=${NAVER_TYPE} (인증서 없음 — HTTP)`));
}

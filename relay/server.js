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

const {
    PORT = 4000,
    NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET,
    NAVER_TYPE = 'SELF',
    RELAY_AUTH_TOKEN,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    NAVER_API_BASE = 'https://api.commerce.naver.com',
} = process.env;

// ── 로그 (시크릿·토큰 마스킹) ──
function mask(s) {
    return String(s == null ? '' : s)
        .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
        .replace(/("?access_token"?\s*[:=]\s*"?)[A-Za-z0-9._-]+/gi, '$1***')
        .slice(0, 800);
}
function log(...a) { console.log(new Date().toISOString(), ...a.map(x => (typeof x === 'string' ? mask(x) : x))); }

// ── 텔레그램 에러 알림 (실패 무시) ──
async function alertTG(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: '🛰️ [네이버 중계서버] ' + text }),
        });
    } catch (_) { /* 알림 실패는 무시 */ }
}

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
        await alertTG(`토큰 발급 실패 (${res.status}) — IP 화이트리스트/시크릿 확인 필요\n${mask(text)}`);
        const e = new Error('token_issue_failed'); e.status = res.status; e.body = data; throw e;
    }
    tokenCache = { value: data.access_token, exp: now + (Number(data.expires_in) || 10800) * 1000 };
    log('네이버 토큰 발급 성공 · 만료(초)=', data.expires_in);
    return tokenCache.value;
}

// ── 허용 경로 (1차: 읽기 전용. 쓰기 전면 차단) ──
const ALLOW = [
    { m: 'GET',  re: /^\/external\/v1\/pay-settle\/settle\/(day|case)$/ },                       // 정산: 일별/건별
    { m: 'GET',  re: /^\/external\/v1\/pay-order\/seller\/product-orders\/last-changed-statuses$/ }, // 주문: 변경목록
    { m: 'POST', re: /^\/external\/v1\/pay-order\/seller\/product-orders\/query$/ },              // 주문: 상세조회(POST지만 읽기)
    { m: 'GET',  re: /^\/external\/v1\/pay-order\/seller\/product-orders\/[A-Za-z0-9_-]+$/ },     // 주문: 단건 상세
    { m: 'GET',  re: /^\/external\/v1\/seller\/.+$/ },                                            // 판매자정보 조회
];
function allowed(method, path) { return ALLOW.some(a => a.m === method && a.re.test(path)); }

const app = express();
app.use(express.json({ limit: '2mb' }));

// 헬스체크 (인증 불필요) — 토큰 발급까지 시험하려면 ?token=1
app.get('/health', async (req, res) => {
    const base = { ok: true, time: new Date().toISOString(), token_cached: !!tokenCache.value };
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
        if (method === 'POST' && body) opt.body = JSON.stringify(body);
        const nres = await fetch(`${NAVER_API_BASE}${path}${qs}`, opt);
        const text = await nres.text();
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (!nres.ok) {
            log('네이버 응답 오류', method, path, nres.status);
            if ([401, 403, 429].includes(nres.status)) {
                await alertTG(`네이버 API ${nres.status} — ${method} ${path}\n${mask(text)}`);
            }
        }
        res.status(nres.status).json(json);
    } catch (e) {
        log('중계 예외', method, path, e.message);
        await alertTG(`중계 예외 — ${method} ${path}: ${e.message}`);
        res.status(e.status || 500).json({ error: 'relay_error', message: e.message, body: e.body });
    }
});

app.listen(PORT, () => log(`akkome-relay 시작 :${PORT} · type=${NAVER_TYPE} · base=${NAVER_API_BASE}`));

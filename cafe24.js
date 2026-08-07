'use strict';
/*
 * 카페24(자사몰) OPEN API 클라이언트 — 송장변환 배송준비중(N20) 불러오기 전용
 *   스펙: docs/superpowers/specs/2026-07-26-cafe24-invoice-design.md (공식 문서 확정본)
 * 원칙(지시문):
 *   - 주문 조회(mall.read_order) 외 API 호출 코드 없음. 상태 처리·발송 자동화 없음. 반품 로직 없음.
 *   - Secret·토큰 값은 어떤 로그·응답에도 출력하지 않는다. 화면엔 상태·만료시각만.
 *   - IP 화이트리스트 없음(문서 확인) → Render 직접 호출(중계서버 불필요).
 * 토큰: agent_office_config 'cafe24_tokens'에 AES-256-GCM 암호화 저장(키=sha256(CAFE24_CLIENT_SECRET)).
 *   access 2시간 · refresh 2주 — 갱신 시 둘 다 새로 발급(구 refresh 즉시 만료) → 동시 갱신 금지(프로미스 락).
 */
const crypto = require('crypto');

const MALL_ID = 'akkome';
const CLIENT_ID = 'mMdlm3cHGZwkVaem7wGDIB';                                  // 공개값 (Secret은 env)
const REDIRECT_URI = 'https://jeju-acom-company.onrender.com/api/cafe24/callback'; // 앱 등록값과 한 글자도 다르면 실패
const SCOPE = 'mall.read_order,mall.read_product,mall.write_product,mall.read_store,mall.write_store,mall.read_community';   // #248-③ 상품 + 8/7 상점(store — mains) + 게시판 읽기(community — 후기 실작성 검증 #259. 대표: 개발자센터 권한 추가 → 데이터관리 카드 재동의 1회로 셋 다)
const API_BASE = `https://${MALL_ID}.cafe24api.com`;

let _pool = null;
let _notify = null;          // 텔레그램 (server.js가 주입 — 시크릿은 회사프로그램 한 곳)
let _refreshLock = null;     // 동시 갱신 방지
let _lastState = null;       // 상태 전환 시 1회 알림용

function init({ pool, notify }) { _pool = pool; _notify = notify || null; }
function secretSet() { return !!process.env.CAFE24_CLIENT_SECRET; }

// ── 토큰 암호화 저장 (AES-256-GCM) ──
function encKey() { return crypto.createHash('sha256').update(String(process.env.CAFE24_CLIENT_SECRET)).digest(); }
function encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}
function decrypt(b64) {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
}
async function saveTokens(tokens) {
    await _pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_tokens', $1::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify({ enc: encrypt(tokens) })]);
}
async function loadTokens() {
    if (!secretSet()) return null;
    const r = await _pool.query(`SELECT value FROM agent_office_config WHERE key = 'cafe24_tokens'`);
    if (!r.rows.length || !r.rows[0].value || !r.rows[0].value.enc) return null;
    try { return decrypt(r.rows[0].value.enc); } catch (_) { return null; } // Secret 변경 등 복호 불가 → 재승인 필요
}

// ── OAuth ──
function getAuthUrl(state) {
    const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, state, redirect_uri: REDIRECT_URI, scope: SCOPE });
    return `${API_BASE}/api/v2/oauth/authorize?${q.toString()}`;
}
async function tokenRequest(form) {
    const basic = Buffer.from(`${CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${API_BASE}/api/v2/oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok || !data.access_token) {
        const e = new Error('cafe24_token_' + res.status); e.status = res.status;
        e.reason = data.error || data.error_description || 'token_failed'; // 토큰 값은 담지 않음
        throw e;
    }
    return data;
}
async function exchangeCode(code) {
    const data = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
    await saveTokens(data);
    _lastState = 'ok';
    return true;
}

async function notifyOnce(state, text) {
    if (_lastState === state) return;
    _lastState = state;
    try { if (_notify) await _notify(text); } catch (_) { /* 무시 */ }
}

// 🔴 카페24 시각 파싱 (2026-07-26 실장애 수정): expires_at 등이 타임존 표기 없는 KST 문자열
//   ("2026-07-26T16:23:00.000")로 옴 → 그대로 Date.parse 하면 UTC 서버(Render)에서 9시간 미래로
//   오인해 만료를 감지 못하고 만료된 토큰으로 호출(401)했음. 표기 없으면 +09:00으로 해석한다.
function parseKstTs(s) {
    if (!s) return NaN;
    const str = String(s).trim();
    return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(str) ? str : str + '+09:00');
}

// access 만료 60초 전이면 refresh 갱신(락). 실패 → reauth_required.
//   force=true(401 수신 후 재시도)면 만료 판정과 무관하게 무조건 갱신.
async function getToken(force = false) {
    if (!secretSet()) { const e = new Error('cafe24_secret_not_set'); e.code = 'secret'; throw e; }
    let t = await loadTokens();
    if (!t) { const e = new Error('cafe24_reauth_required'); e.code = 'reauth'; throw e; }
    const expMs = parseKstTs(t.expires_at);
    if (!force && Number.isFinite(expMs) && Date.now() < expMs - 60_000) { _lastState = 'ok'; return t.access_token; }
    // 갱신 필요 — 동시 1회만
    if (!_refreshLock) {
        _refreshLock = (async () => {
            try {
                const cur = await loadTokens();                     // 락 대기 중 다른 갱신 반영 방어
                if (cur) {
                    const curExp = parseKstTs(cur.expires_at);
                    if (!force && Number.isFinite(curExp) && Date.now() < curExp - 60_000) return cur.access_token;
                    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refresh_token });
                    await saveTokens(data);
                    _lastState = 'ok';
                    return data.access_token;
                }
                const e = new Error('cafe24_reauth_required'); e.code = 'reauth'; throw e;
            } finally { _refreshLock = null; }
        })();
    }
    try { return await _refreshLock; }
    catch (e) {
        await notifyOnce('reauth', '🏠 카페24 토큰 갱신 실패 — [데이터관리] > 카페24 연동에서 [연동 승인]을 다시 눌러주세요');
        const err = new Error('cafe24_reauth_required'); err.code = 'reauth'; err.reason = e.reason || e.message; throw err;
    }
}

// ── 주문 조회 (유일한 API 호출 — 429/5xx 백오프 + 호출 간 600ms) ──
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function apiGet(path, query) {
    let token = await getToken();
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    let retried401 = false;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${API_BASE}${path}${qs}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        // 401(토큰 만료·무효) → 강제 갱신 후 정확히 1회 재시도 (2026-07-26 실장애 수정의 2중 방어)
        if (res.status === 401 && !retried401) { retried401 = true; token = await getToken(true); continue; }
        if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(1000 * Math.pow(2, attempt)); continue; }
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
        if (!res.ok) {
            const e = new Error('cafe24_api_' + res.status); e.status = res.status;
            e.reason = (data.error && data.error.message) || data.error_description || 'api_failed';
            throw e;
        }
        return data;
    }
}

// #248-③: 쓰기 겸용 요청 — apiGet과 동일한 401 갱신·429/5xx 백오프 2중 방어
async function apiReq(method, path, body) {
    let token = await getToken();
    let retried401 = false;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${API_BASE}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body != null ? JSON.stringify(body) : undefined,
        });
        if (res.status === 401 && !retried401) { retried401 = true; token = await getToken(true); continue; }
        if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(1000 * Math.pow(2, attempt)); continue; }
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
        if (!res.ok) {
            const e = new Error('cafe24_api_' + res.status); e.status = res.status;
            e.reason = (data.error && data.error.message) || data.error_description || 'api_failed';
            e.detail = data;
            throw e;
        }
        return data;
    }
}

// 배송준비중(N20) 조회 → convertDataJasamol 8키 매핑 (변환 로직 무수정)
//   품목 채택 = items[].order_status === 'N20' (취소신청 품목은 C코드로 바뀌어 자연 제외 — 대표 확인 요구사항)
//   수량 = quantity − claim_quantity (취소'요청' 수량 차감, 0 이하 제외 — 쿠팡 발주가능수량과 동일 사상)
async function fetchInvoiceOrders(days) {
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const d = (off) => { const t = new Date(kstNow); t.setUTCDate(t.getUTCDate() + off); return t.toISOString().slice(0, 10); };
    const start_date = d(-(Math.max(1, days) - 1)), end_date = d(0);
    let rows = [], fetchedOrders = 0, partialAdjusted = 0, sampleRaw = null;
    for (let offset = 0; offset <= 8000; offset += 1000) {
        if (offset > 0) await sleep(600); // Leaky Bucket(40, 초당 2회 소진) 여유
        const body = await apiGet('/api/v2/admin/orders', {
            start_date, end_date, order_status: 'N20',
            embed: 'items,receivers,buyer', limit: 1000, offset,
        });
        const orders = Array.isArray(body && body.orders) ? body.orders : [];
        for (const od of orders) {
            fetchedOrders++;
            const buyer = od.buyer || {};
            const rc = (Array.isArray(od.receivers) && od.receivers[0]) || {};
            const addr = rc.address_full || [rc.address1, rc.address2].filter(Boolean).join(' ').trim();
            for (const it of (od.items || [])) {
                if (String(it.order_status || '') !== 'N20') continue; // 취소·교환 진행 품목 제외
                const q = Number(it.quantity) || 0;
                const claim = Number(it.claim_quantity) || 0;
                const qty = q - claim;
                if (claim > 0) partialAdjusted++;
                if (qty <= 0) continue;
                rows.push({
                    '주문자명': buyer.name || '',
                    '주문자 휴대전화': buyer.cellphone || '',
                    '수령인': rc.name || '',
                    '수령인 휴대전화': rc.cellphone || rc.virtual_phone_no || '',
                    '수령인 주소(전체)': addr,
                    '배송메시지': rc.shipping_message || '',
                    '주문상품명(세트상품 포함)': [it.product_name, it.option_value].filter(Boolean).join(' ').trim(),
                    '수량': qty,
                    _orderId: String(od.order_id || ''), _itemCode: String(it.order_item_code || ''),
                });
            }
            if (!sampleRaw) sampleRaw = od;
        }
        if (orders.length < 1000) break;
    }
    return { fetched: fetchedOrders, rows, sampleRaw, partialAdjusted, from: start_date, to: end_date };
}

// 연결 카드 표시용 상태 (값 미노출 — 상태·만료시각만)
async function getStatus() {
    const out = { secret_set: secretSet(), token_state: 'none', expires_at: null, refresh_expires_at: null };
    if (!out.secret_set) return out;
    const t = await loadTokens();
    if (!t) { out.token_state = 'reauth_required'; return out; }
    out.expires_at = t.expires_at || null;
    out.refresh_expires_at = t.refresh_token_expires_at || null;
    const refExp = parseKstTs(t.refresh_token_expires_at);
    const accExp = parseKstTs(t.expires_at);
    if (Number.isFinite(refExp) && Date.now() > refExp) out.token_state = 'reauth_required';
    else if (Number.isFinite(refExp) && refExp - Date.now() < 2 * 24 * 3600 * 1000) out.token_state = 'expiring'; // 리프레시 만료 2일 전
    else out.token_state = 'ok';
    if (Number.isFinite(accExp) && Date.now() > accExp && out.token_state === 'ok') out.token_state = 'ok'; // access 만료는 자동 갱신되므로 ok 유지
    return out;
}

module.exports = { init, getAuthUrl, exchangeCode, getToken, fetchInvoiceOrders, getStatus, REDIRECT_URI, apiGet, apiReq };

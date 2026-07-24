'use strict';
/*
 * 네이버 커머스API 중계서버 호출 클라이언트 (회사프로그램 측)
 * - 네이버 시크릿은 중계서버(NCP)에만 존재. 여기선 중계서버 URL + 자체 Bearer 토큰만 사용.
 * - 오류 발생 시 notify(text) 콜백으로 알림 → 텔레그램 시크릿은 회사프로그램 한 곳에만 (대표 7/24 설계).
 * 환경변수: NAVER_RELAY_URL(예: http://101.79.16.213:4000), NAVER_RELAY_TOKEN(중계서버 .env의 RELAY_AUTH_TOKEN과 동일)
 */
function relayBase() { return String(process.env.NAVER_RELAY_URL || '').replace(/\/+$/, ''); }
function relayToken() { return process.env.NAVER_RELAY_TOKEN || ''; }
function configured() { return !!relayBase() && !!relayToken(); }

// 중계서버 헬스체크 (인증 불필요). withToken=true면 네이버 토큰 발급까지 시험.
async function relayHealth(withToken = false) {
    const base = relayBase();
    if (!base) throw new Error('NAVER_RELAY_URL 미설정');
    const res = await fetch(base + '/health' + (withToken ? '?token=1' : ''), { method: 'GET' });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text, http: res.status }; }
}

// 네이버 API 호출 (중계서버 경유). 실패 시 notify(text)로 알림 후 예외 던짐.
// opts: { method, path, query, body },  notify: async (text) => {}
async function callNaver(opts, notify) {
    const { method = 'GET', path, query = null, body = null } = opts || {};
    if (!configured()) throw new Error('중계서버 환경변수(NAVER_RELAY_URL / NAVER_RELAY_TOKEN) 미설정');
    if (!path) throw new Error('path 필요');
    const notifySafe = async (t) => { try { if (notify) await notify(t); } catch (_) { /* 알림 실패 무시 */ } };
    let res, data;
    try {
        res = await fetch(relayBase() + '/naver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relayToken()}` },
            body: JSON.stringify({ method, path, query, body }),
        });
    } catch (e) {
        await notifySafe(`🛰️ 네이버 중계서버 연결 실패 — ${method} ${path}\n${e.message}`);
        const err = new Error('relay_unreachable: ' + e.message); err.cause = e; throw err;
    }
    const t = await res.text();
    try { data = JSON.parse(t); } catch { data = { raw: t }; }
    if (!res.ok) {
        await notifySafe(`🛰️ 네이버 API 오류 ${res.status} — ${method} ${path}\n${JSON.stringify(data).slice(0, 300)}`);
        const err = new Error('naver_relay_error_' + res.status); err.status = res.status; err.data = data; throw err;
    }
    return data;
}

module.exports = { callNaver, relayHealth, configured };

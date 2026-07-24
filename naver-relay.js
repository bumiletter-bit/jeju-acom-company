'use strict';
/*
 * 네이버 커머스API 중계서버 호출 클라이언트 (회사프로그램 측)
 * - 네이버 시크릿은 중계서버(NCP)에만. 여기선 중계서버 URL + 자체 Bearer 토큰만.
 * - 오류 시 notify(text) 콜백으로 알림 → 텔레그램 시크릿은 회사프로그램 한 곳에만 (대표 7/24 설계).
 * - HTTPS(대표 7/24): 중계서버 자체서명 인증서를 NAVER_RELAY_CA(PEM)로 '핀(고정)'해 검증 → 도청·중간자 방지.
 *   (내장 http/https 모듈 사용 — 새 의존성 없음)
 * 환경변수: NAVER_RELAY_URL(http/https), NAVER_RELAY_TOKEN(=중계 .env RELAY_AUTH_TOKEN), NAVER_RELAY_CA(https면 인증서 PEM)
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

function relayBase() { return String(process.env.NAVER_RELAY_URL || '').replace(/\/+$/, ''); }
function relayToken() { return process.env.NAVER_RELAY_TOKEN || ''; }
function configured() { return !!relayBase() && !!relayToken(); }

// 내장 모듈 기반 요청 (https면 자체서명 인증서 핀 지원)
function rawRequest(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(new Error('bad_url: ' + urlStr)); }
        const isHttps = u.protocol === 'https:';
        const mod = isHttps ? https : http;
        const opt = {
            method, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80),
            path: u.pathname + (u.search || ''), headers,
        };
        if (isHttps) {
            const ca = process.env.NAVER_RELAY_CA;
            if (ca && ca.trim()) opt.ca = ca;              // 자체서명 인증서 핀(고정) — 중간자 방지
            else opt.rejectUnauthorized = false;            // CA 미지정 시 최소 암호화(검증 생략, 임시)
        }
        const req = mod.request(opt, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, text: data }));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
        if (body) req.write(body);
        req.end();
    });
}

// 중계서버 헬스체크 (인증 불필요). withToken=true면 네이버 토큰 발급까지 시험.
async function relayHealth(withToken = false) {
    const base = relayBase();
    if (!base) throw new Error('NAVER_RELAY_URL 미설정');
    const r = await rawRequest(base + '/health' + (withToken ? '?token=1' : ''), { method: 'GET' });
    try { return JSON.parse(r.text); } catch { return { raw: r.text, http: r.status }; }
}

// 네이버 API 호출 (중계서버 경유). 실패 시 notify(text)로 알림 후 예외.
async function callNaver(opts, notify) {
    const { method = 'GET', path, query = null, body = null } = opts || {};
    if (!configured()) throw new Error('중계서버 환경변수(NAVER_RELAY_URL / NAVER_RELAY_TOKEN) 미설정');
    if (!path) throw new Error('path 필요');
    const notifySafe = async (t) => { try { if (notify) await notify(t); } catch (_) { /* 무시 */ } };
    let r;
    try {
        r = await rawRequest(relayBase() + '/naver', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relayToken()}` },
            body: JSON.stringify({ method, path, query, body }),
        });
    } catch (e) {
        await notifySafe(`🛰️ 네이버 중계서버 연결 실패 — ${method} ${path}\n${e.message}`);
        const err = new Error('relay_unreachable: ' + e.message); err.cause = e; throw err;
    }
    let data; try { data = JSON.parse(r.text); } catch { data = { raw: r.text }; }
    if (r.status < 200 || r.status >= 300) {
        await notifySafe(`🛰️ 네이버 API 오류 ${r.status} — ${method} ${path}\n${JSON.stringify(data).slice(0, 300)}`);
        const err = new Error('naver_relay_error_' + r.status); err.status = r.status; err.data = data; throw err;
    }
    return data;
}

module.exports = { callNaver, relayHealth, configured };

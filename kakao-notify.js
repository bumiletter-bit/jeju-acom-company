// kakao-notify.js — 카카오 알림톡 발송 모듈 뼈대 (지시 #68 C4, 신규 독립 모듈)
// 🔴 실발송 이중 차단: ① env KAKAO_NOTIFY=on 이 아니면 무조건 dry-run ② 알리고 키(ALIGO_*) 미설정 시 차단.
//    현재 발신프로필 미등록 상태 — 어떤 경우에도 실발송 금지(지시 #68 철칙 2). OFF 상태에선 "발송했을 문면"만 이력 기록.
// API 스펙 근거: 지시 #67 조사1 (알리고 공식 문서 alimapi.html + 공식 Node.js 예제 — 토큰 필수·failover 규칙)
// 🛰️ 경로(지시 #95 — 2026-07-29 실측 정정): 알리고는 등록된 발송 서버 IP에서만 호출 허용(#91 실측: -99/-101 IP 오류).
//    Render 유동 IP 불가 → NCP 릴레이(101.79.16.213, 알리고에 등록) 경유. 릴레이 미설정(로컬 등) 시에만 직접 호출 폴백.
const https = require('https');
const querystring = require('querystring');
const path = require('path');
const relay = require('./naver-relay.js');

const ALIGO_HOST = 'kakaoapi.aligo.in';        // 알림톡 API
const ALIGO_SMS_HOST = 'apis.aligo.in';        // 문자(SMS/LMS) API — 공식 스펙 확정(지시 #76 재검증: smartsms.aligo.in/admin/api/spec.html)
                                               //   토큰 불필요(key+user_id만), msg 1~2000byte, title 1~44byte(LMS만), result_code 양수=성공

// 문안 단일 소스 (등록 스크립트와 동일 JSON — 발송 문면·버튼을 승인 템플릿과 일치시키기 위한 공유 소스)
let TEMPLATES_JSON = null;
try { TEMPLATES_JSON = require(path.join(__dirname, 'scripts', 'alimtalk-templates.json')); } catch (_) { /* 없으면 뼈대 폴백 */ }
function templateByKey(key) {
    return (TEMPLATES_JSON && Array.isArray(TEMPLATES_JSON.templates)) ? TEMPLATES_JSON.templates.find(t => t.key === key) || null : null;
}

function switchOn() { return String(process.env.KAKAO_NOTIFY || 'off').toLowerCase() === 'on'; }
function configured() {
    return Boolean(process.env.ALIGO_API_KEY && process.env.ALIGO_USER_ID && process.env.ALIGO_SENDER_KEY && process.env.ALIGO_SENDER);
}

// 수신번호 마스킹 (이력 저장용 — 원문은 DB에 저장하지 않음, 발송은 수집 시점 메모리 값으로만)
function maskPhone(tel) {
    const t = String(tel || '').replace(/[^0-9]/g, '');
    if (t.length < 7) return t ? '***' : '';
    return t.slice(0, 3) + '****' + t.slice(-4);
}

// 공통 템플릿 (카카오 승인 전 뼈대 — 실제 발송 전 승인 템플릿과 100% 일치시켜야 함. 변수는 #{} 표기)
const DEFAULT_TEMPLATE = [
    '안녕하세요 #{고객명}님, 제주아꼼이네입니다 🍊',
    '주문하신 #{상품명} 잘 접수되었습니다.',
    '#{발송안내}',
    '#{품목안내}',
    '맛있게 준비해서 보내드리겠습니다. 감사합니다!',
].join('\n');

// 변수 치환 — 값 없는 변수 줄은 통째로 제거(품목안내가 없을 때 빈 줄 방지)
function buildMessage(vars, template) {
    const tpl = template || DEFAULT_TEMPLATE;
    return tpl.split('\n')
        .map(line => line.replace(/#\{(.+?)\}/g, (m, k) => (vars[k] != null && String(vars[k]).trim() ? String(vars[k]).trim() : m)))
        .filter(line => !/#\{.+?\}/.test(line))   // 미치환 변수가 남은 줄은 제거
        .join('\n');
}

// 품목 판별: 옵션 문자열에 이름이 포함되는 판매현황 품목 중 가장 긴 이름 채택 (부분 문자열 오탐 최소화)
function matchNotifyProduct(optionText, botProducts) {
    const opt = String(optionText || '');
    let best = null;
    for (const p of botProducts || []) {
        const nm = String(p.name || '').trim();
        if (nm && opt.includes(nm) && (!best || nm.length > best.name.length)) best = p;
    }
    return best;   // { name, notify_message } | null
}

// 직접 호출 (릴레이 미설정 시 폴백 전용 — 지시 #95 이후 정식 경로는 릴레이)
function aligoDirectPost(reqPath, form, host) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(form);
        const req = https.request({
            host: host || ALIGO_HOST, path: reqPath, method: 'POST', timeout: 20000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { resolve({ raw: data }); } });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('알리고 응답 시간 초과')); });
        req.end(body);
    });
}
// 알리고 호출 — 릴레이(고정 IP) 경유가 정식 경로 (지시 #95). 시그니처는 기존과 동일 유지.
async function aligoPost(reqPath, form, host) {
    if (relay.configured()) return relay.callAligo({ host: host || ALIGO_HOST, path: reqPath, form });
    return aligoDirectPost(reqPath, form, host);
}

// 실발송 경로 (조사1 스펙: 토큰 발급 → alimtalk/send, failover=Y 시 fsubject/fmessage 필수)
// ⚠️ 호출돼도 switchOn()·configured() 둘 다 통과해야만 실제 API에 닿음.
async function sendAlimtalk({ receiver, subject, message, tplCode, failoverMessage, buttons }) {
    if (!switchOn()) return { mode: 'dry-run', status: 'switch-off', message };
    if (!configured()) return { mode: 'dry-run', status: 'keys-missing', message };
    const auth = { apikey: process.env.ALIGO_API_KEY, userid: process.env.ALIGO_USER_ID };
    const tok = await aligoPost('/akv10/token/create/30/s', auth);
    const token = tok && (tok.token || tok.urlencode || (tok.data && tok.data.token));
    if (!token) return { mode: 'real', status: 'token-failed', error: JSON.stringify(tok).slice(0, 200) };
    const form = {
        ...auth, token,
        senderkey: process.env.ALIGO_SENDER_KEY,
        tpl_code: tplCode || process.env.ALIGO_TPL_CODE || '',
        sender: process.env.ALIGO_SENDER,
        receiver_1: String(receiver || '').replace(/[^0-9]/g, ''),
        subject_1: subject || '주문 안내',
        message_1: message,
    };
    if (failoverMessage) { form.failover = 'Y'; form.fsubject_1 = subject || '주문 안내'; form.fmessage_1 = failoverMessage; }
    if (buttons) form.button_1 = JSON.stringify(buttons);                                     // 승인 템플릿과 동일 구성이어야 함 (공식 button_1 JSON)
    if (String(process.env.ALIGO_TEST || '').toUpperCase() === 'Y') form.testMode = 'Y';      // 알림톡 API 공식 testMode — 과금·실발송 없는 연동 테스트
    const r = await aligoPost('/akv10/alimtalk/send/', form);
    const ok = r && Number(r.code) === 0;
    return { mode: 'real', status: ok ? 'sent' : 'failed', error: ok ? null : JSON.stringify(r).slice(0, 300), mid: r && r.info && r.info.mid };
}

// ── 발송 안내 알림톡 E (지시 #93·#94) — "알림톡 우선 → 실패 시 SMS 대체(failover, 문면=기존 LMS 전문)"
//    문면·버튼 = 문안 단일 소스(alimtalk-templates.json 'ship_guide')에서 생성 — 승인 템플릿과 자동 일치.
//    버튼 링크의 #{상품코드}만 발송 시 실값 치환(버튼명은 변수 금지 — 가이드). E 코드 미투입·템플릿 부재 시 SMS(기존 LMS) 직행.
async function sendShippingGuideAlimtalk({ receiver, vars, fallback }) {
    const tpl = templateByKey('ship_guide');
    const messageText = tpl ? buildMessage(vars || {}, tpl.content) : ((fallback && fallback.message) || '');
    if (!switchOn()) return { mode: 'dry-run', status: 'switch-off', via: 'alimtalk-e', messageText };
    if (!configured()) return { mode: 'dry-run', status: 'keys-missing', via: 'alimtalk-e', messageText };
    const tplCode = process.env.ALIGO_TPL_CODE_GUIDE || '';
    if (!tpl || !tplCode) {   // E 미승인 단계 — 기존 LMS 경로로 직행 (안내 공백 방지)
        const r = await sendLms({ receiver, subject: (fallback && fallback.subject) || '제주아꼼이네 배송 안내', message: (fallback && fallback.message) || '' });
        return { ...r, via: 'sms-direct', messageText: (fallback && fallback.message) || '' };
    }
    let buttons = null;
    if (tpl.button) {
        buttons = JSON.parse(JSON.stringify(tpl.button));
        if (Array.isArray(buttons.button)) for (const b of buttons.button) {
            for (const k of ['linkMo', 'linkPc']) if (b[k]) b[k] = String(b[k]).replace(/#\{(.+?)\}/g, (m, key) => (vars && vars[key] != null) ? String(vars[key]) : m);
        }
    }
    const r = await sendAlimtalk({
        receiver, subject: '배송 안내', message: messageText, tplCode,
        failoverMessage: (fallback && fallback.message) || undefined, buttons,
    });
    return { ...r, via: 'alimtalk-e', messageText };
}

// LMS(알리고 문자) 발송 뼈대 (지시 #74) — 품목별 발송 안내문용: 자유 문안·템플릿 심사 불필요.
// 🔴 알림톡과 동일 이중 차단(KAKAO_NOTIFY=on + 키 필요). 문자 API는 senderkey 불필요 — key·user_id·sender만.
async function sendLms({ receiver, subject, message }) {
    if (!switchOn()) return { mode: 'dry-run', status: 'switch-off', message };
    if (!process.env.ALIGO_API_KEY || !process.env.ALIGO_USER_ID || !process.env.ALIGO_SENDER) {
        return { mode: 'dry-run', status: 'keys-missing', message };
    }
    const form = {
        key: process.env.ALIGO_API_KEY,
        user_id: process.env.ALIGO_USER_ID,     // 공식 표기 user_id (언더스코어 — 알림톡의 userid와 다름)
        sender: process.env.ALIGO_SENDER,
        receiver: String(receiver || '').replace(/[^0-9]/g, ''),
        msg: message,
        msg_type: 'LMS',
        title: (subject || '제주아꼼이네 배송 안내').slice(0, 20),   // 제목 1~44byte 제한 — 한글 20자 상한으로 방어
    };
    if (String(process.env.ALIGO_TEST || '').toUpperCase() === 'Y') form.testmode_yn = 'Y';   // 연동 테스트: 과금·실발송 없이 검증
    const r = await aligoPost('/send/', form, ALIGO_SMS_HOST);
    const ok = r && Number(r.result_code) > 0;   // 공식 스펙: result_code 양수(1)=성공, 음수=실패 (문자열로 올 수 있어 Number 판정)
    return { mode: 'real', status: ok ? 'sent' : 'failed', error: ok ? null : JSON.stringify(r).slice(0, 300), mid: r && r.msg_id };
}

// ── 연동 자가진단 (지시 #91) — 무해한 '읽기' 호출만: 토큰 발급(키·ID 인증)·템플릿 목록(발신프로필 검증)·문자 잔여건수(과금 없음).
//    등록(template/add)·검수(template/request)·발송(send) API는 절대 호출하지 않음. 키 값은 마스킹(길이+앞2자)만 기록.
function maskEnv(name) {
    const s = String(process.env[name] || '');
    return s ? { set: true, len: s.length, head2: s.slice(0, 2) } : { set: false };
}
async function selftest() {
    const out = { at: new Date().toISOString(), env: {}, checks: {} };
    for (const k of ['ALIGO_API_KEY', 'ALIGO_USER_ID', 'ALIGO_SENDER_KEY', 'ALIGO_SENDER']) out.env[k] = maskEnv(k);
    const senderDigits = String(process.env.ALIGO_SENDER || '').replace(/[^0-9]/g, '');
    // 발신번호는 검증용 무해 API가 없어 형식 확인만 (실검증은 실발송 리허설 단계에서)
    out.checks.sender_format = { ok: senderDigits.length >= 8 && senderDigits.length <= 11, digits_len: senderDigits.length };
    if (!out.env.ALIGO_API_KEY.set || !out.env.ALIGO_USER_ID.set) {
        out.checks.token = { ok: false, error: 'ALIGO_API_KEY 또는 ALIGO_USER_ID 미설정' };
        return out;
    }
    const auth = { apikey: process.env.ALIGO_API_KEY, userid: process.env.ALIGO_USER_ID };
    try {
        const tok = await aligoPost('/akv10/token/create/30/s', auth);
        const token = tok && (tok.token || tok.urlencode || (tok.data && tok.data.token));
        out.checks.token = token ? { ok: true } : { ok: false, error: JSON.stringify(tok).slice(0, 200) };
        if (token && process.env.ALIGO_SENDER_KEY) {
            const list = await aligoPost('/akv10/template/list/', { ...auth, token, senderkey: process.env.ALIGO_SENDER_KEY });
            const ok = list && Number(list.code) === 0;
            out.checks.senderkey_template_list = ok
                ? { ok: true, template_count: Array.isArray(list.list) ? list.list.length : null,
                    // 지시 #98: 심사 상태 추적 — 템플릿별 상태(응답 필드명 방어적 수집, 문안 원문은 미수집)
                    templates: (Array.isArray(list.list) ? list.list : []).slice(0, 12).map(x => ({
                        code: x.templtCode || x.tpl_code || null, name: x.templtName || x.tpl_name || null,
                        status: x.status != null ? x.status : null, inspStatus: x.inspStatus != null ? x.inspStatus : null })) }
                : { ok: false, error: JSON.stringify(list).slice(0, 200) };
        }
    } catch (e) { out.checks.token = { ok: false, error: String(e.message || e).slice(0, 200) }; }
    try {
        const remain = await aligoPost('/remain/', { key: process.env.ALIGO_API_KEY, user_id: process.env.ALIGO_USER_ID }, ALIGO_SMS_HOST);
        const ok = remain && Number(remain.result_code) > 0;
        out.checks.sms_remain = ok
            ? { ok: true, SMS_CNT: remain.SMS_CNT, LMS_CNT: remain.LMS_CNT, MMS_CNT: remain.MMS_CNT }
            : { ok: false, error: JSON.stringify(remain).slice(0, 200) };
    } catch (e) { out.checks.sms_remain = { ok: false, error: String(e.message || e).slice(0, 200) }; }
    return out;
}

// ── 템플릿 등록·검수 신청 실행기 (지시 #98 — 대표 최종 GO 전용, 서버 측 실행: 알리고 키가 Render env에만 있으므로)
//    발동은 server.js 플래그 폴러(aligo_register_request {go:'yes'})로만. 실발송 아님 — 등록(template/add)·검수 신청(template/request)만.
//    문안·버튼 = alimtalk-templates.json 그대로(임의 수정 금지·status='confirmed' 필수). 텍스트형(tpl_emtype 미지정=NONE) — 이미지형은 별도 트랙.
async function registerTemplates({ audit } = {}) {
    const out = { at: new Date().toISOString(), audit: audit === true, results: [] };
    if (!configured()) return { ...out, error: 'keys-missing — 알리고 키 미설정' };
    if (!TEMPLATES_JSON || TEMPLATES_JSON.status !== 'confirmed') return { ...out, error: `templates-not-confirmed (status=${TEMPLATES_JSON && TEMPLATES_JSON.status})` };
    const auth = { apikey: process.env.ALIGO_API_KEY, userid: process.env.ALIGO_USER_ID };
    const tok = await aligoPost('/akv10/token/create/5/m', auth);   // 4장 순차 등록 여유분 5분 토큰
    const token = tok && (tok.token || tok.urlencode || (tok.data && tok.data.token));
    if (!token) return { ...out, error: 'token-failed: ' + JSON.stringify(tok).slice(0, 200) };
    const base = { ...auth, token, senderkey: process.env.ALIGO_SENDER_KEY };
    // 🔴 필드명 차이 (2026-07-29 실패 실측·공식 문서 확인): 등록 API 버튼 링크는 linkM/linkP, 발송 API는 linkMo/linkPc.
    //    JSON 단일 소스는 발송용(linkMo/linkPc)으로 유지 — 등록 시에만 여기서 매핑 (버튼 내용 무변경).
    const toRegButton = (btn) => ({
        button: (btn.button || []).map(b => {
            const o = { name: b.name, linkType: b.linkType, linkTypeName: b.linkTypeName };
            if (b.linkMo) o.linkM = b.linkMo;
            if (b.linkPc) o.linkP = b.linkPc;
            return o;
        }),
    });
    for (const t of TEMPLATES_JSON.templates) {
        const r = { key: t.key, name: t.name, env_key: t.env_key };
        try {
            const add = await aligoPost('/akv10/template/add/', {
                ...base, tpl_name: t.name, tpl_content: t.content,
                // 🔴 AC(채널 추가) 버튼은 채널추가형에서만 허용 — tpl_type=AD 미지정이 2026-07-29 510 실패 원인.
                //    tpl_advert = 채널추가 안내 문구(카카오 고정 문구 — AD형 필수 파라미터).
                ...(t.tpl_type ? { tpl_type: t.tpl_type } : {}),
                ...(t.tpl_type === 'AD' ? { tpl_advert: '채널 추가하고 이 채널의 마케팅 메시지 등을 카카오톡으로 받기' } : {}),
                ...(t.button ? { tpl_button: JSON.stringify(toRegButton(t.button)) } : {}),
            });
            r.add = { code: add && add.code, message: String((add && add.message) || '').slice(0, 200) };
            const tplCode = add && ((add.data && add.data.templtCode) || add.templtCode);
            r.tpl_code = tplCode || null;
            if (tplCode && audit === true) {
                const rq = await aligoPost('/akv10/template/request/', { ...base, tpl_code: tplCode });
                r.audit_request = { code: rq && rq.code, message: String((rq && rq.message) || '').slice(0, 200) };
            }
        } catch (e) { r.error = String(e.message || e).slice(0, 200); }
        await new Promise(res => setTimeout(res, 500));
        out.results.push(r);
    }
    return out;
}

module.exports = { switchOn, configured, maskPhone, buildMessage, matchNotifyProduct, sendAlimtalk, sendShippingGuideAlimtalk, sendLms, selftest, registerTemplates, DEFAULT_TEMPLATE };

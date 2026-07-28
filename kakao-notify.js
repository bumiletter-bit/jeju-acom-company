// kakao-notify.js — 카카오 알림톡 발송 모듈 뼈대 (지시 #68 C4, 신규 독립 모듈)
// 🔴 실발송 이중 차단: ① env KAKAO_NOTIFY=on 이 아니면 무조건 dry-run ② 알리고 키(ALIGO_*) 미설정 시 차단.
//    현재 발신프로필 미등록 상태 — 어떤 경우에도 실발송 금지(지시 #68 철칙 2). OFF 상태에선 "발송했을 문면"만 이력 기록.
// API 스펙 근거: 지시 #67 조사1 (알리고 공식 문서 alimapi.html + 공식 Node.js 예제 — 토큰 필수·failover 규칙)
const https = require('https');
const querystring = require('querystring');

const ALIGO_HOST = 'kakaoapi.aligo.in';        // 알림톡 API
const ALIGO_SMS_HOST = 'apisms.aligo.in';      // 문자(SMS/LMS) API — ⚠️ 실가동 전 공식 문서 스펙 재확인(지시 #74 [불확실] 항목)

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

function aligoPost(path, form, host) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(form);
        const req = https.request({
            host: host || ALIGO_HOST, path, method: 'POST', timeout: 20000,
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

// 실발송 경로 (조사1 스펙: 토큰 발급 → alimtalk/send, failover=Y 시 fsubject/fmessage 필수)
// ⚠️ 호출돼도 switchOn()·configured() 둘 다 통과해야만 실제 API에 닿음.
async function sendAlimtalk({ receiver, subject, message, tplCode, failoverMessage }) {
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
    const r = await aligoPost('/akv10/alimtalk/send/', form);
    const ok = r && Number(r.code) === 0;
    return { mode: 'real', status: ok ? 'sent' : 'failed', error: ok ? null : JSON.stringify(r).slice(0, 300), mid: r && r.info && r.info.mid };
}

// LMS(알리고 문자) 발송 뼈대 (지시 #74) — 품목별 발송 안내문용: 자유 문안·템플릿 심사 불필요.
// 🔴 알림톡과 동일 이중 차단(KAKAO_NOTIFY=on + 키 필요). 문자 API는 senderkey 불필요 — key·user_id·sender만.
async function sendLms({ receiver, subject, message }) {
    if (!switchOn()) return { mode: 'dry-run', status: 'switch-off', message };
    if (!process.env.ALIGO_API_KEY || !process.env.ALIGO_USER_ID || !process.env.ALIGO_SENDER) {
        return { mode: 'dry-run', status: 'keys-missing', message };
    }
    const r = await aligoPost('/send/', {
        key: process.env.ALIGO_API_KEY,
        user_id: process.env.ALIGO_USER_ID,
        sender: process.env.ALIGO_SENDER,
        receiver: String(receiver || '').replace(/[^0-9]/g, ''),
        msg: message,
        msg_type: 'LMS',
        title: subject || '제주아꼼이네 배송 안내',
    }, ALIGO_SMS_HOST);
    const ok = r && Number(r.result_code) > 0;   // 문자 API는 result_code 양수 = 성공
    return { mode: 'real', status: ok ? 'sent' : 'failed', error: ok ? null : JSON.stringify(r).slice(0, 300), mid: r && r.msg_id };
}

module.exports = { switchOn, configured, maskPhone, buildMessage, matchNotifyProduct, sendAlimtalk, sendLms, DEFAULT_TEMPLATE };

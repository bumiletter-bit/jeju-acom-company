// scripts/register-alimtalk-templates.js — 알림톡 템플릿 4종 알리고 등록 스크립트 (지시 #88 STEP4)
// 🔴🔴 실행 조건: ①알리고 키 투입(Render env 아님 — 이 스크립트는 로컬 실행이므로 셸 환경변수로 주입)
//              ②대표 최종 GO 후에만. 검수 신청(--request-audit)은 별도 대표 GO가 또 필요 (#75 원칙).
// 이중 차단: 키 4종 없으면 즉시 종료 + env ALIMTALK_REGISTER_GO=yes 와 --confirm-go 플래그 둘 다 있어야 등록 호출.
// 사용법 (대표 GO 후):
//   $env:ALIGO_API_KEY='...'; $env:ALIGO_USER_ID='...'; $env:ALIGO_SENDER_KEY='...'; $env:ALIMTALK_REGISTER_GO='yes'
//   node scripts/register-alimtalk-templates.js --confirm-go            # 등록만 (검수 신청 안 함)
//   node scripts/register-alimtalk-templates.js --confirm-go --request-audit   # 등록 + 검수 신청 (별도 대표 GO 필수)
// API 근거: 지시 #67 조사1 (알리고 공식 — 토큰 발급 /akv10/token/create → /akv10/template/add → /akv10/template/request)
const https = require('https');
const querystring = require('querystring');
const path = require('path');

const TEMPLATES = require(path.join(__dirname, 'alimtalk-templates.json'));   // 문안 단일 소스 (대표 확정본만 등록)

const HOST = 'kakaoapi.aligo.in';
function post(pathName, form) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(form);
        const req = https.request({ host: HOST, path: pathName, method: 'POST', timeout: 20000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
            (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ raw: d }); } }); });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('알리고 응답 시간 초과'))); req.end(body);
    });
}

(async () => {
    // ── 차단 1: 키 미투입이면 실행 불가 ──
    const { ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_KEY } = process.env;
    if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER_KEY) {
        console.error('⛔ 알리고 키 미투입 (ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER_KEY 필요) — 실행 불가.');
        console.error('   키 투입 + 대표 최종 GO 후에만 실행하십시오 (지시 #75·#88).');
        process.exit(1);
    }
    // ── 차단 2: 명시적 GO 이중 확인 ──
    if (process.env.ALIMTALK_REGISTER_GO !== 'yes' || !process.argv.includes('--confirm-go')) {
        console.error('⛔ 대표 최종 GO 미확인 — env ALIMTALK_REGISTER_GO=yes 와 --confirm-go 플래그가 둘 다 필요합니다.');
        process.exit(1);
    }
    // 미확정 문안 등록 방지
    if (TEMPLATES.status !== 'confirmed') {
        console.error(`⛔ 문안 상태가 '${TEMPLATES.status}' — alimtalk-templates.json의 status를 대표 확정 후 'confirmed'로 바꿔야 등록됩니다.`);
        process.exit(1);
    }
    const auth = { apikey: ALIGO_API_KEY, userid: ALIGO_USER_ID };
    const tok = await post('/akv10/token/create/30/s', auth);
    const token = tok && (tok.token || tok.urlencode || (tok.data && tok.data.token));
    if (!token) { console.error('⛔ 토큰 발급 실패:', JSON.stringify(tok).slice(0, 300)); process.exit(1); }
    const base = { ...auth, token, senderkey: ALIGO_SENDER_KEY };
    for (const t of TEMPLATES.templates) {
        console.log(`\n── 등록: ${t.name}`);
        const add = await post('/akv10/template/add/', {
            ...base, tpl_name: t.name, tpl_content: t.content,
            ...(t.button ? { tpl_button: JSON.stringify(t.button) } : {}),
        });
        console.log('  응답:', JSON.stringify(add).slice(0, 400));
        const tplCode = add && (add.data && add.data.templtCode || add.templtCode);
        if (tplCode && process.argv.includes('--request-audit')) {   // 검수 신청은 별도 플래그 — 대표 GO 재확인 후에만
            const reqRes = await post('/akv10/template/request/', { ...base, tpl_code: tplCode });
            console.log('  검수 신청:', JSON.stringify(reqRes).slice(0, 300));
        } else if (tplCode) {
            console.log(`  tpl_code=${tplCode} — 검수 신청은 하지 않음 (--request-audit 플래그 + 대표 GO 필요)`);
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.log('\n완료. 발급된 tpl_code를 Render env(ALIGO_TPL_CODE 등)에 투입하십시오.');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

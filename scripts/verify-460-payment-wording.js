// #460 검증: 네이버 「현금 결제·계좌 입금 유도」 경고 대응 — 봇 답변에 결제 위험 단어 0
//   사용: node scripts/verify-460-payment-wording.js local   (server.js 실코드 추출 + 실DB 시나리오 검사)
//         node scripts/verify-460-payment-wording.js sim     (실서버·실AI 재현 — 🔴 배포 후 5~10분 뒤에: 롤링 중 구인스턴스가 러너 플래그를 먹는 함정)
require('dotenv').config();
const fs = require('fs'); const path = require('path'); const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 220) : '')); };
const RISK = /계좌|입금|이체|무통장|송금|현금/; const risky = a => RISK.test(String(a).replace(/현금영수증/g, ''));
const mode = process.argv[2] || 'local';
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    if (mode === 'local') {
        const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const a = src.indexOf('function paymentWordingRule()'), b = src.indexOf('// 톡톡봇의 "(예시)" 줄 치환용');
        ok(a > 0 && b > a, '규칙 함수가 server.js에 있음');
        const rule = new Function(src.slice(a, b) + '\nreturn paymentWordingRule;')()();
        ok(Array.isArray(rule) && rule.length === 1 && rule[0].scenario_no === 892 && rule[0].channel === '공통' && Array.isArray(rule[0].keywords) && rule[0].keywords.length === 0, '가상 시나리오 1개 · 번호 892 · 공통 · 키워드 없음(키워드 자동응답에 안 잡힘)', JSON.stringify({ no: rule[0].scenario_no, kw: rule[0].keywords }));
        ok(/계좌이체/.test(rule[0].response) && /거절하는 문장에서도/.test(rule[0].response) && /스마트스토어를 통해서만/.test(rule[0].response) && /현금영수증.*써도 됩니다/.test(rule[0].response), '규칙 본문: 금지 단어 · 거절 문장 포함 · 대체 문장 · 현금영수증 허용');
        ok((src.match(/\.\.\.paymentWordingRule\(\)/g) || []).length === 3, '주입 지점 3곳(봇 /api/scenarios · 재현 러너 · 상품/고객문의 생성)', (src.match(/\.\.\.paymentWordingRule\(\)/g) || []).length);
        const sc = (await pool.query(`SELECT scenario_no, name, response FROM inquiry_scenarios WHERE enabled=true AND deleted_at IS NULL`)).rows;
        const left = sc.filter(r => risky(r.response)).map(r => '#' + r.scenario_no);
        ok(left.length === 0, '활성 시나리오 본문에 결제 위험 단어 0(현금영수증 제외)', left.join(','));
        const r55 = sc.find(r => r.scenario_no === 55);
        ok(r55 && !/계좌이체 모두 가능/.test(r55.response) && /상담하면서 가장 편하신 방법으로 안내/.test(r55.response) && /세금계산서·현금영수증 발행 가능/.test(r55.response) && /10801253976/.test(r55.response), '#55: 계좌이체 제안 문장 제거 · 나머지(세금계산서·VIP 링크) 그대로');
        const r21 = sc.find(r => r.scenario_no === 21); ok(r21 && /스마트스토어를 통해서만/.test(r21.response) && !risky(r21.response), '#21 계좌·무통장 문의 본문 = 위험 단어 없음(무변경)');
    } else {
        const runner = async (reqKey, resKey, value, ms = 420000) => {
            await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
            await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(value)]);
            const t0 = Date.now(); while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
            throw new Error('runner timeout');
        };
        const ALL = [
            { q: '저번에 주문한 귤 잘 받았습니다. 지인분께 선물 드리고 싶은데 귤은 추석 선물 부직포 가방이 없더라구요. 추가금액을 지불하고 감귤 주문에 부직포 가방을 추가할 수 있을까요? 가능하다면 사장님 계좌번호 남겨주시면 바로 입금해드리겠습니다.', product: '하우스감귤', chk: a => !risky(a) && /스마트스토어/.test(a), t: 'Q1 9/19 실문의 재현 → 위험 단어 0 · 스마트스토어 안내' },
            { q: '계좌이체로 결제하고 싶은데 계좌번호 알려주세요', product: '황금향', chk: a => !risky(a) && /스마트스토어/.test(a), t: 'Q2 계좌 직접 문의 → 단어를 되받지 않음' },
            { q: '황금향 선물용 3kg 60상자 회사 선물로 주문하려고 합니다. 결제는 어떻게 하면 되나요? 세금계산서도 되나요?', product: '황금향', chk: a => !risky(a) && /세금계산서/.test(a) && /010-6687-4031/.test(a), t: 'Q3 단체 결제 문의(#55) → 계좌이체 제안 없음 · 세금계산서·고객센터 안내 유지' },
            { q: '현금영수증 발행 되나요?', product: '하우스감귤', chk: a => /현금영수증/.test(a) && !risky(a), t: 'Q4 현금영수증 = 정상 용어 그대로 안내' },
            { q: '황금향 선물용 5kg 얼마예요?', product: '황금향', chk: a => /62,800/.test(a), t: 'Q5 무회귀 가격' },
            { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: null, chk: a => /21일/.test(a) && /8시/.test(a), t: 'Q6 무회귀 추석 마감' },
        ];
        const pick = (process.argv[3] || '').split(',').filter(Boolean).map(Number); const sel = pick.length ? ALL.filter((_, i) => pick.includes(i + 1)) : ALL;
        const s = await runner('qna_sim_request', 'qna_sim_result', { cases: sel.map(c => ({ q: c.q, product: c.product })) });
        const rs = s.results || s.cases || []; const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
        for (let i = 0; i < sel.length; i++) console.log(`\n  ${sel[i].t.split(' ')[0]}: ${sel[i].q.slice(0, 70)}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 700)}`);
        for (let i = 0; i < sel.length; i++) ok(sel[i].chk(A(i)), sel[i].t, risky(A(i)) ? '위험 단어: ' + (A(i).replace(/현금영수증/g, '').match(/계좌\S*|입금\S*|이체\S*|무통장\S*|송금\S*|현금\S*/g) || []).join(',') : null);
    }
    await pool.end(); console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

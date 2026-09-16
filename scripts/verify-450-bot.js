// #450 검증(②~⑦ 시나리오): local = 로컬 실서버 /api/scenarios(톡톡·상품문의 채널) + 톡톡봇 가격 즉답 게이트 실코드 재현
//                            sim   = qna_sim(실서버·실AI — 공통 시나리오 수정분 + 무회귀) · 세 번째 인자로 케이스 선택(예: 5,7,8)
//   사용: node scripts/verify-450-bot.js local | sim [1,2,...]
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 240) : '')); };
const MODE = process.argv[2] || 'local';
const PORT = 3457;
async function waitUp() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/api/public/version`); if (r.ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up'); }
(async () => {
    if (MODE === 'local') {
        const srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`],
            { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', SCENARIO_API_TOKEN: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
        try {
            await waitUp();
            const get = async (ch) => (await fetch(`http://localhost:${PORT}/api/scenarios?channel=${ch}`, { headers: { Authorization: 'Bearer verifytest' } })).json();
            const talk = await get('talktalk'); const prod = await get('product');
            const T = talk.scenarios || talk, P = prod.scenarios || prod;
            const byNo = (arr, no) => arr.find(s => s.scenario_no === no);
            ok(Array.isArray(T) && T.length >= 55, '톡톡 채널 시나리오 목록 수신', T.length);
            ok(byNo(T, 60) && /골드|GOLD/.test(byNo(T, 60).response) && /9월 21일\(월\) 오전 8시/.test(byNo(T, 60).response) && /1,000원/.test(byNo(T, 60).response), '③ #60 쿠폰·할인(톡톡): 등급·추석 21일 08시·알림받기 1,000');
            ok(byNo(T, 61) && /대표 송장번호 1개/.test(byNo(T, 61).response) && /전달 도와드릴까요/.test(byNo(T, 61).response), '⑤ #61 송장·배송조회(톡톡): 대표 송장 1개·되묻기');
            ok(!byNo(P, 60) && !byNo(P, 61), '③⑤ #60·#61은 상품문의 채널에 미노출(톡톡 전용)');
            const s16 = byNo(T, 16); ok(s16 && /골프공/.test(s16.response) && /종이컵/.test(s16.response) && /선물용은 사이즈 지정이 어려운/.test(s16.response) && /25과로/.test(s16.response) && !/15과로/.test(s16.response), '④ #16 사이즈 지정: 2S/S/M 기준·선물용 불가·만감류 25과·옛 15과 예시 0');
            const s46 = byNo(T, 46); ok(s46 && /골프공/.test(s46.response) && /선물용\(3kg\)은 사이즈 지정이 불가/.test(s46.response) && byNo(P, 46) && /골프공/.test(byNo(P, 46).response), '④ #46 수량·과수(공통): 사이즈 기준·선물용 불가 독립 문장 — 톡톡·상품문의 양쪽');
            const s52 = byNo(T, 52); ok(s52 && /종이컵/.test(s52.response) && /선물용\(3kg\)은 사이즈 지정이 불가/.test(s52.response), '④ #52 사이즈별 맛 차이: 기준 줄·선물용 불가');
            const s19 = byNo(T, 19); ok(s19 && /대표 송장번호 1개/.test(s19.response), '⑤ #19 개별주소: 개별 송장 안내 줄');
            const s15 = byNo(T, 15); ok(s15 && /홍\*동/.test(s15.response) && /선물하기/.test(s15.response), '⑥ #15 보내는이: 선물하기 마스킹 줄');
            const s51 = byNo(T, 51), s2 = byNo(T, 2), s13 = byNo(T, 13);
            ok(s51 && s2 && s13 && [s51, s2, s13].every(s => /교환 시스템이 없어서/.test(s.response) && /반품\(무료수거·전액환불\) 접수 후 재주문/.test(s.response)), '⑦ #51·#2·#13: 교환 = 반품 후 재주문 줄');
            ok(Array.isArray(s51.keywords) && s51.keywords.includes('교환'), '⑦ #51 키워드 「교환」 추가');
            const s38 = byNo(T, 38); ok(s38 && /9월 15일 오전 8시로 주문이 마감/.test(s38.response) && !/정상 발송/.test(s38.response), '무회귀 #38 청귤(#448 상태 유지)');
            const s54 = byNo(T, 54); ok(s54 && /연휴 전 마지막 발송/.test(s54.response), '무회귀 #54 추석 마감');
            const s59 = byNo(T, 59); ok(s59 && /event\.akkome\.com\/lucky\.html/.test(s59.response), '무회귀 #59 추석 이벤트');
            // 톡톡봇 가격 즉답 게이트 — 봇 실코드(ai-handler.js) 함수 추출
            const botSrc = fs.readFileSync('C:/Users/전승범/OneDrive/문서/★제주아꼼이네 톡톡봇/ai-handler.js', 'utf8');
            const i0 = botSrc.indexOf('const PRICE_TRIGGERS'); const i1 = botSrc.indexOf('\n}\n', botSrc.indexOf('function matchesOtherScenario')) + 3;
            const gate = new Function(botSrc.slice(i0, i1) + '; return { isClearPriceQuestion, matchesOtherScenario };')();
            const direct = q => gate.isClearPriceQuestion(q) && !gate.matchesOtherScenario(q, T);
            // 무회귀 판정: 신설 #60·#61 키워드만으로는 단순 가격 질문이 AI 경로로 바뀌지 않는다(품목명·「선물용」 등 기존 키워드는 종전부터 AI 경로)
            const NEW = T.filter(s => s.scenario_no === 60 || s.scenario_no === 61);
            const plain = ['황금향 얼마예요?', '하우스감귤 4.5kg 가격이요', '가격표 보여주세요', '선물용 3kg 금액 알려주세요', '귤 얼마에요'];
            ok(plain.every(q => gate.isClearPriceQuestion(q) && !gate.matchesOtherScenario(q, NEW)), '봇 게이트 무회귀: #60·#61 키워드는 단순 가격 질문을 잡지 않음(즉답 경로 유지)');
            ok(!direct('혹시 1박스 더 주문하려고하는데 ,,, 가격이 오른거 같은데 맞나요'), '봇 게이트: 9/16 실기록 「가격이 오른거 같은데」 → 즉답 아님(#60 키워드로 AI 경로)');
            ok(!direct('황금향 금액이 변동된거맞죠?'), '봇 게이트: 「금액이 변동」 → AI 경로');
            ok(!direct('쿠폰 적용하면 얼마예요?'), '봇 게이트 무회귀: 쿠폰 포함 = AI 경로');
        } finally { srv.kill(); }
    } else {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        async function runner(reqKey, resKey, req, ms = 360000) {
            await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
            await pool.query(`INSERT INTO agent_office_config (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(req)]);
            const t0 = Date.now();
            while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 5000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
            throw new Error('runner timeout');
        }
        const noGift = a => a.replace(/가정용[^\n]*/g, '');
        const ALL = [
            { q: '4군데 개별배송으로 주문했는데 마이페이지에서 송장 조회가 하나만 돼요', product: '황금향', chk: a => /대표 송장/.test(a) && /개별 송장/.test(a), t: 'Q1 개별배송 송장 → 대표 송장 1개·개별 송장 전달' },
            { q: '선물하기로 주문했는데 보내는 사람 이름이 누구로 나가요?', product: null, chk: a => /홍\*동|마스킹|노출되지 않/.test(a), t: 'Q2 선물하기 → 자동 마스킹 안내' },
            { q: '너무 맛없어서 교환 요청해요', product: '하우스감귤', chk: a => /교환 시스템|교환이 어려|재주문/.test(a) && /반품/.test(a), t: 'Q3 교환 → 반품 후 재주문' },
            { q: '로얄과 S사이즈는 얼마나 커요? M은요?', product: '하우스감귤', chk: a => /골프공/.test(a) && /종이컵/.test(a), t: 'Q4 사이즈 기준 → 골프공·종이컵' },
            { q: '하우스감귤 선물용 3kg S사이즈로 보내주실 수 있나요?', product: '하우스감귤', chk: a => /선물용.{0,16}(지정이 불가|지정이 어려|지정 불가|어려운 점|불가해요)/.test(a) && !/S사이즈로 (맞춰|보내드립니다)/.test(noGift(a)), t: 'Q5 선물용 사이즈 → 지정 불가(가능 표현 0)' },
            { q: '추석 전에 받으려면 언제까지 주문해야 해요?', product: null, chk: a => /21일/.test(a) && /8시/.test(a), t: 'Q6 무회귀 추석 마감' },
            { q: '추석 이벤트 응모된 건가요?', product: '황금향', chk: a => /event\.akkome\.com\/lucky\.html/.test(a) && /자동 응모|자동으로 응모/.test(a), t: 'Q7 무회귀 이벤트' },
            { q: '황금향 선물용 5kg 얼마예요?', product: '황금향', chk: a => /62,800/.test(a), t: 'Q8 무회귀 황금향 5kg 가격' },
        ];
        const pick = (process.argv[3] || '').split(',').filter(Boolean).map(Number);
        const sel = pick.length ? ALL.filter((_, i) => pick.includes(i + 1)) : ALL;
        const cases = sel.map(c => ({ q: c.q, product: c.product }));
        const s = await runner('qna_sim_request', 'qna_sim_result', { cases });
        const rs = s.results || s.cases || [];
        const A = i => String((rs[i] || {}).answer || (rs[i] || {}).response || (rs[i] || {}).text || JSON.stringify(rs[i] || {}));
        for (let i = 0; i < sel.length; i++) console.log(`\n  ${sel[i].t.split(' ')[0]}: ${sel[i].q}\n  A: ${A(i).replace(/\n/g, '⏎').slice(0, 800)}`);
        for (let i = 0; i < sel.length; i++) ok(sel[i].chk(A(i)), sel[i].t);
        await pool.end();
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

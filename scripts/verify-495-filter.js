/* #495 검증: {{가격표}} 줄 고르기(qnaFilterStoreLines) 좁히기 교정 — 실DB 판매현황으로 만든 가격표에 구(git HEAD)/신 함수를 같은 질문으로 돌려 비교
   node scripts/verify-495-filter.js */
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
const { Pool } = require('pg');
const ROOT = path.join(__dirname, '..');
const cut = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('구간 없음 ' + from); return src.slice(a, b); };
const build = (src) => new Function(cut(src, 'const QNA_FILTER_STOPWORDS', 'function qnaFilterStoreLines') + cut(src, 'function qnaFilterStoreLines', '// {{가격표}}/{{판매현황}} 치환') + '\nreturn qnaFilterStoreLines;')();
const NEW = build(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
// 구 = 좁히기 이전 원본(v5.9.394 태그 · 넓은 매칭만) — 신 ⊆ 구 = 「넓어지는 경우 0」 무회귀 기준
const OLD = build(execSync('git show v5.9.394:server.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
let pass = 0, fail = 0; const ok = (t, c, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const { rows } = await pool.query(`SELECT name, price FROM bot_products WHERE deleted_at IS NULL AND status='판매중' AND price <> '' ORDER BY id`);
    await pool.end();
    const priceText = rows.map(r => `🍊 ${r.name} — ${r.price}`).join('\n');
    const N = s => s.split('\n').filter(Boolean);
    const CASES = [
        ['황금향 못난이 5kg 얼마예요?', l => l.length === 1 && /못난이 - 5kg/.test(l[0]) && /37,800/.test(l[0])],
        ['황금향 5kg 가정용 가격이요', l => l.length === 1 && /황금향 가정용 - 5kg/.test(l[0])],   // 「가정용」은 스톱워드지만 좁히기엔 씀
        ['황금향 선물용 3kg에 몇 개 들어가요?', l => l.length === 1 && /황금향 선물용 - 3kg/.test(l[0])],   // 「3kg에」 조사 붙은 용량
        ['하우스감귤 선물용 3kg 얼마예요?', l => l.length === 1 && /하우스감귤/.test(l[0]) && /선물용 - 3kg/.test(l[0])],
        ['유라조생 10kg 중대과 얼마예요?', l => l.length === 1 && /유라품종/.test(l[0]) && /10kg\(중대과/.test(l[0])],
        ['레몬 3kg 얼마예요?', l => l.length === 1 && /그린레몬3kg/.test(l[0])],
        ['레드키위 5kg 가격이 얼마예요?', l => l.length === 1 && /레드키위 5kg/.test(l[0])],
        ['귤 가격 알려주세요', l => l.length >= 6 && l.every(x => /감귤/.test(x))],   // 「귤」 → 감귤 줄 전체(종전 동일)
        ['황금향 가격이요', l => l.length >= 5 && l.every(x => /황금향/.test(x))],   // 품목만 = 그 품목 전부(종전 동일)
        ['지금 뭐 팔아요?', l => l.length === N(priceText).length],                  // 품목 단어 없음 = 전체(종전 동일)
        ['유라조생이 뭐예요? 그냥 노지귤이랑 뭐가 달라요?', l => l.length === 9 && l.every(x => /유라품종/.test(x))],   // #495-c 조사 붙은 품목 단어 → 유라 9줄만(하우스 0)
        ['하우스귤이랑 유라조생 반반 돼요?', l => l.length === 15 && l.every(x => /감귤/.test(x))],                // 두 품목 다 말함 → 하우스 6 + 유라 9 합집합
        ['황금향이랑 하우스감귤 같이 선물세트로 있어요?', l => l.length === 12 && l.some(x => /황금향/.test(x)) && l.some(x => /하우스감귤/.test(x))],   // 비교·동시 질문 = 두 품목 모두(종전엔 조사 때문에 황금향이 빠짐)
        ['노지귤이랑 하우스귤 뭐가 더 달아요?', l => l.length === 15 && l.every(x => /감귤/.test(x))],
    ];
    for (const [q, chk] of CASES) {
        const o = N(OLD(priceText, q)), n = N(NEW(priceText, q));
        ok(`「${q}」 신 ${n.length}줄 (구 ${o.length}줄)`, chk(n), n.length <= 3 ? n.map(x => x.replace(/^🍊 /, '').slice(0, 50)).join(' | ') : '');
        if (n.length > o.length) ok(`  ↳ 신이 구보다 넓지 않음(무회귀)`, false, '신 ' + n.length + ' > 구 ' + o.length);
    }
    // 구와 같아야 하는 경우: 좁힐 단어가 없는 질문 전부 — 무작위 20문항(질문 은행)에서 신 ⊆ 구 확인
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'qbank-495.json'), 'utf8'));
    let subset = 0, total = 0;
    for (const p of Object.values(bank.products)) for (const q of p.q) { total++; const o = N(OLD(priceText, q)), n = N(NEW(priceText, q)); if (n.every(x => o.includes(x))) subset++; }
    ok(`질문 은행 ${total}문항 전부 신 결과 ⊆ 구 결과(줄이 늘어난 경우 0)`, subset === total, subset + '/' + total);
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

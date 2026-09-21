/* #464 검증(읽기 전용): 「품목별 금액 → 송장변환·중간발주·판매현황·정산·박스」 연결이 지금 다 맞는지 + 단가표 상태별 매칭 결과 재현
   ① 단가표 3상태(없음 / 「대과」로 잘못 등록 / 지금)에서 app.js 실코드 matchProduct 결과
   ② 오늘 단가표 12종 전부: 네이버 옵션 문구(스냅샷 실표기) → 매칭 → 자기 이름으로 왕복
   ③ 판매현황(bot_products)·정산(9/21~)·박스 매핑이 단가표 이름과 일치
   ④ 오늘 시간표(audit_logs — KST는 SQL에서만 계산) */
const path = require('path'); const fs = require('fs'); const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') }); const { Pool } = require('pg');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 230) : '')); };
function buildMatcher(src) {
    const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix'); if (a < 0 || b <= a) throw new Error('추출 경계 실패');
    return new Function(src.slice(a, b) + '\nreturn { matchProduct, PRODUCT_CATALOG, aoItemPartner, setPricing: (arr, byP) => { aoInvoicePricingNames = arr; if (byP) aoInvoicePricingByPartner = byP; } };')();
}
(async () => {
    const M = buildMatcher(fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'));
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const pr = (await pool.query(`SELECT p.id, p.partner, it->>'name' nm, it->>'boxType' box FROM pricing p, jsonb_array_elements(p.items) it WHERE p.start_date <= (now() + interval '9 hours')::date AND p.end_date >= (now() + interval '9 hours')::date ORDER BY p.partner, nm`)).rows;
    const NOW = pr.map(r => r.nm); const byP = {}; pr.forEach(r => { (byP[r.partner] = byP[r.partner] || new Set()).add(r.nm); });
    const WRONG = NOW.map(n => n.replace('선물용 - 3kg(중대과 7~15과)', '선물용 - 3kg(대과 7~15과)').replace('황금향 선물용 - 5kg(중대과 13~25과)', '황금향 선물용 - 5kg(대과 13~25과)'));
    const wrap = (n2, n1) => `아꼼이네 상품선택: ${n1} / 상품 및 과수: ${n2}`;
    const O3 = wrap('황금향 선물용 - 3kg(중대과 7~15과)', '1. (제철)과즙팡팡 황금향'), O5 = wrap('황금향 선물용 - 5kg(중대과 13~25과)', '1. (제철)과즙팡팡 황금향');
    const P3 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 3kg(중대과 7~15과)', P5 = '과즙팡팡 황금향 / 상품 및 과수: 황금향 선물용 - 5kg(중대과 13~25과)';

    console.log('\n① 단가표 상태별 — 손님 주문 문구(네이버 옵션 = 중대과)가 송장변환에서 어떻게 나오나');
    M.setPricing([]); const e3 = M.matchProduct(O3), e5 = M.matchProduct(O5);
    ok(e3 === P3 && e5 === P5, '(가) 이번 주 단가표가 아직 없을 때 → 프로그램 안의 기본 이름표(중대과)로 나옴', e3.replace(/^.*상품 및 과수: /, '') + ' / ' + e5.replace(/^.*상품 및 과수: /, ''));
    M.setPricing(WRONG); const w3 = M.matchProduct(O3), w5 = M.matchProduct(O5);
    ok(/^\[미매칭\]/.test(w3) && /^\[미매칭\]/.test(w5), '(나) 단가표가 「대과」로 올라가 있을 때 → 「대과」로 바뀌지 않고 [미매칭](빨간 칸)', w3.slice(0, 60));
    ok(!/\(대과/.test(w3.replace(O3, '')) && !/\(대과/.test(w5.replace(O5, '')), '(나) 어느 경우에도 손님이 고른 등급(중대과)을 「대과」로 바꿔 쓰지 않음');
    M.setPricing(NOW, byP); const n3 = M.matchProduct(O3), n5 = M.matchProduct(O5);
    ok(n3 === P3 && n5 === P5, '(다) 지금(중대과로 고친 뒤) → 단가표 이름과 정확히 일치', n3.replace(/^.*상품 및 과수: /, '') + ' / ' + n5.replace(/^.*상품 및 과수: /, ''));
    ok(M.aoItemPartner(n3) === '대성(시온)' && M.aoItemPartner(n5) === '대성(시온)', '(다) 거래처 색 = 대성(시온)', M.aoItemPartner(n3));

    console.log('\n② 오늘 단가표 ' + NOW.length + '종 전부 — 네이버 실제 옵션 표기로 매칭');
    const snap = (await pool.query(`SELECT id, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0]; const txt = JSON.stringify(snap.items);
    const bad = []; let inSnap = 0;
    for (const nm of NOW) { const n2 = nm.replace(/^.*상품 및 과수: /, ''); if (txt.includes(n2)) inSnap++; const r = M.matchProduct(wrap(n2, '1. (제철)' + nm.split(' / ')[0])); if (r !== nm) bad.push(n2 + ' → ' + r.slice(0, 40)); }
    ok(bad.length === 0, `단가표 ${NOW.length}종 전부 자기 이름으로 매칭`, bad.join(' | ') || '왕복 ' + NOW.length + '/' + NOW.length);
    ok(inSnap === NOW.length, `단가표 품목의 등급·과수 표기가 네이버 최신 스냅샷(#${snap.id}) 옵션에 그대로 있음`, inSnap + '/' + NOW.length);

    console.log('\n③ 판매현황·정산·박스');
    const bp = (await pool.query(`SELECT name, status, price FROM bot_products WHERE deleted_at IS NULL`)).rows; const bpm = new Map(bp.map(r => [r.name, r]));
    const noBp = NOW.filter(n => !bpm.has(n)); ok(noBp.length === 0, '단가표 12종이 판매현황에 같은 이름으로 있음', noBp.join(',') || NOW.filter(n => bpm.get(n).status === '판매중').length + '종 판매중');
    ok(!bp.some(r => /황금향 선물용.*\(대과/.test(r.name)), '판매현황에 황금향 선물용 「대과」 행 없음', bp.filter(r => /황금향 선물용/.test(r.name)).map(r => r.name.replace(/^.*선물용 - /, '') + ' ' + r.price).join(' · '));
    const st = (await pool.query(`SELECT id, date::text d, partner, items FROM settlements WHERE date >= '2026-09-21' ORDER BY id`)).rows; const off = [];
    st.forEach(s => (s.items || []).forEach(it => { if (!NOW.includes(it.name)) off.push('#' + s.id + ' ' + it.name); }));
    ok(off.length === 0, `9/21 이후 정산 ${st.length}건의 품목명 전부 단가표와 일치`, off.join(' | ') || st.map(s => '#' + s.id + ' ' + s.partner + ' ' + (s.items || []).length + '줄').join(' · '));
    const g = pr.filter(r => /선물용 - [35]kg\(중대과/.test(r.nm)); ok(g.length === 2 && g.every(r => /^선물용 박스 [35]kg$/.test(r.box)), '황금향 선물용 2종 박스 매핑', g.map(r => r.box).join(' / '));

    console.log('\n④ 오늘 시간표(KST)');
    const tl = (await pool.query(`SELECT to_char(created_at + interval '9 hours','HH24:MI') t, action, target_type, target_id, coalesce(actor_name,'') who FROM audit_logs WHERE created_at + interval '9 hours' >= '2026-09-21' AND (target_type IN ('pricing','settlement') OR action LIKE 'naver_invoice%' OR action LIKE '%invoice_fetch%' OR action LIKE 'cafe24_invoice%' OR action LIKE 'coupang_invoice%') ORDER BY id`)).rows;
    tl.forEach(r => console.log(`   ${r.t}  ${r.action}  ${r.target_type || ''} ${r.target_id || ''}  ${r.who}`));
    await pool.end(); console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

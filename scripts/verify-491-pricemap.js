// #491 검증: 정산 이미지 대조 가격표 — 같은 주 거래처 단가표가 여러 줄이어도 전부 합쳐 매칭 (server.js 실코드 추출 · 실DB 읽기만)
//   node scripts/verify-491-pricemap.js [YYYY-MM-DD]
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('구간 없음: ' + from); return src.slice(a, b); };
const body = cut('async function buildPriceMapFor', '// 마루 비전 판독') + cut('function matchSettlementItemExact', 'async function settlementCalcForPartner') + cut('async function settlementCalcForPartner', '// 확인표 생성');
const results = []; const ok = (n, p, note) => { results.push(p); console.log((p ? '✅' : '❌') + ' ' + n + (note ? ' — ' + note : '')); };
(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const date = process.argv[2] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const F = new Function('pool', body + '\nreturn { buildPriceMapFor, settlementCalcForPartner };')(pool);
    const rows = (await pool.query(`SELECT id, partner, jsonb_array_length(items) n FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date ORDER BY partner, id`, [date])).rows;
    const byP = {}; rows.forEach(r => { (byP[r.partner] = byP[r.partner] || []).push(r); });
    for (const [partner, list] of Object.entries(byP)) {
        const union = new Set(); for (const r of list) { const it = (await pool.query(`SELECT items FROM pricing WHERE id=$1`, [r.id])).rows[0].items; it.forEach(i => i && i.name && union.add(i.name)); }
        const map = await F.buildPriceMapFor(partner, date);
        ok(`${partner} ${date}: 단가표 ${list.length}줄(${list.map(r => '#' + r.id + '·' + r.n + '종').join(' + ')}) → 가격 맵 ${Object.keys(map).length}종 = 합집합 ${union.size}종`, Object.keys(map).length === union.size && [...union].every(n => n in map));
        // 각 줄의 품목을 읽은 것처럼 넣어 전부 매칭되는지(수량 1)
        const read = [...union].map(name => ({ name, qty: 1 }));
        const c = await F.settlementCalcForPartner(partner, read, date);
        ok(`${partner}: ${read.length}품목 전부 매칭 · 미매칭 0`, c.matched === read.length && c.unmatched.length === 0, c.unmatched.slice(0, 3).join(' | '));
    }
    // 같은 이름이 두 줄에 있으면 나중 줄(id 큰 쪽) 단가가 이긴다
    const dup = (await pool.query(`SELECT a.partner, a.id AS ida, b.id AS idb FROM pricing a JOIN pricing b ON a.partner=b.partner AND a.id<b.id WHERE a.start_date <= $1::date AND a.end_date >= $1::date AND b.start_date <= $1::date AND b.end_date >= $1::date LIMIT 1`, [date])).rows[0];
    if (dup) {
        const ia = (await pool.query(`SELECT items FROM pricing WHERE id=$1`, [dup.ida])).rows[0].items, ib = (await pool.query(`SELECT items FROM pricing WHERE id=$1`, [dup.idb])).rows[0].items;
        const same = ia.find(x => ib.some(y => y.name === x.name));
        if (same) { const later = ib.find(y => y.name === same.name); const map = await F.buildPriceMapFor(dup.partner, date); ok('같은 이름 겹침 = 나중 줄 단가', map[same.name] === Number(later.price), same.name); }
        else ok('같은 이름 겹침 없음(규칙 적용 대상 없음 — 통과)', true);
    } else ok('겹치는 줄 없는 날짜 — 병합 규칙은 단일 줄과 동일', true);
    await pool.end();
    console.log(`\n결과 ${results.filter(Boolean).length}/${results.length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

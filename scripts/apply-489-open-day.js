// #489 10/1 오픈 당일 실행기 — 그린레몬·유라조생 노지감귤·레드키위 (대표 「열었어」 신호 뒤에 실행)
//   node scripts/apply-489-open-day.js          → 조회만(현재 상태 표)
//   node scripts/apply-489-open-day.js open     → ①판매현황 15행 준비중→판매중 + 판매가 「N,NNN원」 형식 ②시나리오 #66·#67 켜기 (audit · 멱등)
//   node scripts/apply-489-open-day.js close    → 되돌리기(판매중→준비중 · #66·#67 끄기) — 잘못 열었을 때만
//   ⚠️ 코드·배포 없음. 화면 저장과 같은 규칙(bot_products 상태 4종 · 봇 반영 1분/시나리오 5분).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MODE = process.argv[2] || 'check';
const ACTOR = '클코 총괄(대표 지시 #489 · 10/1 오픈)';
const IDS = [482, 483, 484, 486, 487, 488, 489, 490, 500, 491, 492, 493, 494, 495, 496];
const SC = [66, 67];
const won = v => { const n = String(v || '').replace(/[^0-9]/g, ''); return n ? Number(n).toLocaleString('ko-KR') + '원' : String(v || ''); };
const audit = (t, id, changes) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', $1, $2, $3, 'agent_office', $4)`, [t, id, JSON.stringify(changes), ACTOR]);
(async () => {
    const rows = (await pool.query(`SELECT id, name, status, price, length(coalesce(shipping_guide,'')) g FROM bot_products WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY id`, [IDS])).rows;
    const sc = (await pool.query(`SELECT id, scenario_no, name, enabled FROM inquiry_scenarios WHERE scenario_no = ANY($1) AND deleted_at IS NULL`, [SC])).rows;
    console.log(`판매현황 ${rows.length}/${IDS.length}행 · 안내문 없는 행 ${rows.filter(r => !r.g).length}`);
    rows.forEach(r => console.log(`  ${r.id} ${r.status.padEnd(3)} ${String(r.price).padStart(9)} → ${won(r.price).padStart(9)} | ${r.name}`));
    sc.forEach(s => console.log(`  #${s.scenario_no} ${s.name} = ${s.enabled ? 'ON' : 'off'}`));
    if (MODE === 'open' || MODE === 'close') {
        const toStatus = MODE === 'open' ? '판매중' : '준비중', en = MODE === 'open';
        let n = 0;
        for (const r of rows) {
            const price = MODE === 'open' ? won(r.price) : r.price;
            if (r.status === toStatus && price === r.price) continue;
            await pool.query(`UPDATE bot_products SET status = $2, price = $3, updated_by = $4, updated_at = now() WHERE id = $1`, [r.id, toStatus, price, ACTOR]);
            await audit('bot_product', r.id, { before: { status: r.status, price: r.price }, after: { status: toStatus, price }, note: '#489 10/1 오픈 ' + MODE });
            n++;
        }
        let m = 0;
        for (const s of sc) {
            if (s.enabled === en) continue;
            await pool.query(`UPDATE inquiry_scenarios SET enabled = $2, updated_at = now(), updated_by = $3 WHERE id = $1`, [s.id, en, ACTOR]);
            await audit('inquiry_scenario', s.id, { before: { enabled: s.enabled }, after: { enabled: en }, note: '#489 10/1 오픈 ' + MODE });
            m++;
        }
        console.log(`\n✅ ${MODE}: 판매현황 ${n}행 → ${toStatus} · 시나리오 ${m}건 → ${en ? 'ON' : 'off'} (봇 반영 판매현황 1분 · 시나리오 5분)`);
    } else console.log('\n(조회만 — open 인자로 오픈)');
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

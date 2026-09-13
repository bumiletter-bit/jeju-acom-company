// #436(대표 9/13 "니가 직접"): 카페24 모바일샵(m.akkome.com 옛 스킨) 사용안함 — 접속을 PC샵(반응형 v5)으로. 되돌리기: node scripts/apply-436-mobile-off.js T
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WANT = (process.argv[2] || 'F').toUpperCase() === 'T' ? 'T' : 'F';
async function runner(req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('cafe24_product_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('러너 타임아웃');
}
(async () => {
    let g;
    for (let i = 0; i < 20; i++) {   // 신버전 러너 대기(구인스턴스 가드 오류면 재시도 — #398 함정)
        g = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/mobile/setting' });
        if (g.raw && g.raw.ok) break;
        console.log(`  대기 ${i + 1}: server ${g.server_version} — ${((g.raw || {}).reason || (g.raw || {}).detail || '').slice(0, 100)}`);
        if (/403|scope|권한/i.test(JSON.stringify(g))) throw new Error('스코프 없음(403) — 대표가 카페24 관리자에서 수동 필요: ' + JSON.stringify(g).slice(0, 300));
        await new Promise(r => setTimeout(r, 30000));
    }
    if (!(g.raw && g.raw.ok)) throw new Error('조회 실패: ' + JSON.stringify(g).slice(0, 300));
    console.log('현재 모바일샵 설정:', JSON.stringify(g.raw.data));
    const cur = String(((g.raw.data || {}).mobile || (g.raw.data || {}).setting || g.raw.data || {}).use_mobile_page || JSON.stringify(g.raw.data).match(/"use_mobile_page":"([TF])"/)?.[1] || '?');
    if (cur === WANT) { console.log('이미', WANT, '— 변경 없음'); await pool.end(); return; }
    const p = await runner({ action: 'raw', method: 'PUT', path: '/api/v2/admin/mobile/setting', body: { shop_no: 1, request: { use_mobile_page: WANT } } });
    console.log('변경 응답:', JSON.stringify(p).slice(0, 400));
    if (!(p.raw && p.raw.ok)) throw new Error('변경 실패');
    await pool.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','cafe24_mobile_setting',NULL,$1,'cafe24-api','클코(대표 지시 #436)')`, [JSON.stringify({ before: { use_mobile_page: cur }, after: { use_mobile_page: WANT }, note: 'm.akkome.com 옛 모바일샵 → PC샵(v5)로' })]);
    await new Promise(r => setTimeout(r, 70000));   // 카페24 GET 캐시
    const g2 = await runner({ action: 'raw', method: 'GET', path: '/api/v2/admin/mobile/setting' });
    console.log('변경 후 설정:', JSON.stringify(g2.raw && g2.raw.data));
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

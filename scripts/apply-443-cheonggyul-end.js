// #443(대표 9/15 "청귤 종료 — 자사몰 내리기·시나리오·판매현황 정리"): 네이버는 대표가 이미 품절(OUTOFSTOCK 실측).
//   ① 카페24 c93 selling F(cafe24_sync 품절 동기와 동일 PUT — 즉시) ② 스냅샷 재수집 유도(자사몰 카드 「시즌 준비중」 자동)
//   ③ bot_products 48·49 → 시즌종료(장부 보존 원칙 #434) ④ 시나리오 #38·#48 종료 안내로 교체 · #44(특가 vs 일반) 비활성
//   ⑤ 시기 지식: 마감기(id 7) 09-14로 단축 + 「시즌종료(비시즌)」 09-15~07-31 신설. 코드·배포 0 · 전건 audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #443 청귤 시즌 종료)';
const audit = (action, type, id, changes, source) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,NULL,$6)`, [action, type, id, JSON.stringify(changes), source, ACTOR]);
async function runner(reqKey, resKey, req) {
    await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]);
    await pool.query(`INSERT INTO agent_office_config (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [reqKey, JSON.stringify(req)]);
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) { await new Promise(r => setTimeout(r, 4000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [resKey]); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key=$1`, [resKey]); return q.rows[0].value; } }
    throw new Error('runner timeout ' + reqKey);
}
const S38 = [
    '안녕하세요 제주아꼼이네입니다 🍊',
    '올해 청귤(풋귤) 시즌은 9월 15일 오전 8시로 주문이 마감되었어요 💚',
    '(청귤은 제주도에서 법적으로 출하 기간을 정하고 있어 9월 15일 이후에는 판매할 수 없어요)',
    '📦 마감 전에 주문해주신 건은 순서대로 정상 발송되고 있으니 안심하세요!',
    "🍋 내년 8월 초 청귤 시즌이 다시 시작되면 사전예약 소식을 가장 먼저 전해드릴게요 — 상품 페이지에서 '알림받기'를 눌러두시면 편해요!",
    '▶ 청귤 상품 페이지: https://smartstore.naver.com/akkome/products/5731582511',
    '🧴 이미 받으신 청귤로 청 담그실 땐 저희 블로그를 참고해주세요! https://blog.naver.com/bumiletter/222068793569',
    '🍊 지금 판매 중인 제철 상품은 스토어에서 보실 수 있어요 → https://smartstore.naver.com/akkome',
].join('\n');
const S48 = [
    '안녕하세요 고객님 제주아꼼이네입니다 🍈',
    '청귤은 제주도에서 법적으로 출하 기간을 정하고 있어요.',
    '매년 8월부터 수확·판매가 가능하고, 9월 15일 이후에는 판매할 수 없습니다.',
    '올해 청귤 주문은 9월 15일 오전 8시로 마감되었어요 — 마감 전에 주문하신 건은 순서대로 정상 발송 중이니 안심하세요 😊',
    "내년 8월 초 시즌이 시작되면 다시 찾아뵐게요! 상품 페이지에서 '알림받기'를 눌러두시면 오픈 소식을 바로 받아보실 수 있어요.",
    '▶ 청귤 상품 페이지: https://smartstore.naver.com/akkome/products/5731582511',
    '',
    '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.',
].join('\n');
const KN = "올해 청귤(풋귤) 시즌은 종료됐어요 — 9월 15일 오전 8시로 주문이 마감됐고, 청귤은 법적 출하 기간이 9/15까지라 그 이후엔 판매할 수 없어요. 문의엔 「지금은 시즌종료라 판매하지 않고, 내년 8월 초 시즌이 시작되면 사전예약·상품페이지 알림받기」로 확답해 주세요. 마감 전 주문 건은 순서대로 정상 발송 중이라고 안내하고, '지금 주문 가능'·'오늘 발송' 같은 표현은 쓰지 마세요. 내년 정확한 오픈 날짜는 확답하지 말고 알림받기를 안내하세요.";
(async () => {
    // ① 카페24 c93 판매중지 (cafe24_sync 품절 동기와 동일한 PUT · 되돌리기 = selling T)
    const before = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'GET', path: '/api/v2/admin/products/93', query: { fields: 'product_no,selling,display,price' } });
    const bp = before.raw && before.raw.data && before.raw.data.product;
    console.log('c93 before:', JSON.stringify(bp));
    if (bp && bp.selling === 'T') {
        const put = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'PUT', path: '/api/v2/admin/products/93', body: { shop_no: 1, request: { selling: 'F' } } });
        console.log('c93 PUT:', JSON.stringify(put).slice(0, 200));
        await new Promise(r => setTimeout(r, 3000));
        const after = await runner('cafe24_product_request', 'cafe24_product_result', { action: 'raw', method: 'GET', path: '/api/v2/admin/products/93', query: { fields: 'product_no,selling,display,price' } });
        const ap = after.raw && after.raw.data && after.raw.data.product;
        console.log('c93 after:', JSON.stringify(ap));
        await audit('update', 'cafe24_product', 93, { before: bp, after: ap, note: '#443 청귤 시즌 종료 — 판매중지(네이버 OUTOFSTOCK 확인 후)' }, 'cafe24-sync');
        console.log(ap && ap.selling === 'F' ? '✅ c93 selling F' : '❌ c93 selling 미반영');
    } else console.log('  c93 이미 F 또는 조회 실패');
    // ② 스냅샷 재수집 유도 (60초 틱)
    const sn = await pool.query(`UPDATE naver_auto_collect SET last_run_at = NOW() - interval '1 day' WHERE key='product_snapshot' RETURNING key, last_run_at`);
    console.log('snapshot rewind:', JSON.stringify(sn.rows));
    // ③ bot_products 48·49 → 시즌종료
    for (const id of [48, 49]) {
        const cur = (await pool.query('SELECT * FROM bot_products WHERE id=$1', [id])).rows[0];
        if (!cur || cur.status === '시즌종료') { console.log('  bot_products', id, cur ? '이미 시즌종료' : '없음'); continue; }
        const after = (await pool.query(`UPDATE bot_products SET status='시즌종료', updated_at=now(), updated_by=$2 WHERE id=$1 RETURNING *`, [id, ACTOR])).rows[0];
        await audit('update', 'bot_product', id, { before: cur, after, note: '#443 청귤 시즌 종료' }, 'bot-product');
        console.log('✅ bot_products', id, cur.name, cur.status, '→ 시즌종료');
    }
    // ④ 시나리오 (id 기준 — scenario_no와 다름)
    const setResp = async (id, resp, note) => {
        const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
        if (!cur) { console.log('❌ 시나리오 id', id, '없음'); return; }
        if (cur.response === resp) { console.log('  id', id, '이미 반영'); return; }
        const after = (await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [resp, ACTOR, id])).rows[0];
        await audit('update', 'inquiry_scenario', id, { before: { response: cur.response }, after: { response: after.response }, note }, 'inquiry-scenario');
        console.log('✅ 시나리오 id', id, '(#' + cur.scenario_no + ')', cur.name, '—', note);
    };
    await setResp(39, S38, '#443 품목-청귤 → 시즌 종료 안내(가격표·주문 링크 제거)');
    await setResp(49, S48, '#443 청귤 수확기간 → 올해 마감 안내');
    {
        const cur = (await pool.query('SELECT * FROM inquiry_scenarios WHERE id=45 AND deleted_at IS NULL')).rows[0];
        if (cur && cur.enabled) {
            const after = (await pool.query('UPDATE inquiry_scenarios SET enabled=false, updated_at=now(), updated_by=$1 WHERE id=45 RETURNING *', [ACTOR])).rows[0];
            await audit('update', 'inquiry_scenario', 45, { before: { enabled: true }, after: { enabled: false }, note: '#443 특가 vs 일반 차이(청귤 한정 주제) 비활성 — 범용 키워드가 타 상품 질문을 청귤 답변으로 끌 위험 제거. 다음 청귤 시즌 특가 때 재활성' }, 'inquiry-scenario');
            console.log('✅ 시나리오 id 45 (#44) 비활성');
        } else console.log('  id 45', cur ? '이미 비활성' : '없음');
    }
    // ⑤ 시기 지식
    {
        const k7 = (await pool.query(`SELECT * FROM product_season_knowledge WHERE id=7 AND deleted_at IS NULL`)).rows[0];
        if (k7 && k7.end_md === '09-15') {
            const after = (await pool.query(`UPDATE product_season_knowledge SET end_md='09-14', updated_by=$1, updated_at=now() WHERE id=7 RETURNING *`, [ACTOR])).rows[0];
            await audit('update', 'season_knowledge', 7, { before: { end_md: '09-15' }, after: { end_md: '09-14' }, note: '#443 마감기 지식(「9월 14일까지 주문」 문구)이 마감 당일(9/15)에 노출되지 않게' }, 'season-knowledge');
            console.log('✅ 시기 지식 id 7 end_md 09-15 → 09-14');
        } else console.log('  id 7', k7 ? 'end_md=' + k7.end_md : '없음');
        const ex = (await pool.query(`SELECT id FROM product_season_knowledge WHERE deleted_at IS NULL AND item_key='청귤(풋귤)' AND label LIKE '시즌종료%'`)).rows;
        if (!ex.length) {
            const r = await pool.query(`INSERT INTO product_season_knowledge (item_key, label, start_md, end_md, knowledge, sort, enabled, updated_by) VALUES ('청귤(풋귤)','시즌종료(비시즌)','09-15','07-31',$1,9,true,$2) RETURNING *`, [KN, ACTOR]);
            await audit('create', 'season_knowledge', r.rows[0].id, { after: r.rows[0], note: '#443 청귤 비시즌 지식 신설(09-15~07-31 — 다음 해 08-01 초기 지식으로 자동 전환)' }, 'season-knowledge');
            console.log('✅ 시기 지식 청귤 시즌종료 신설 id', r.rows[0].id);
        } else console.log('  청귤 시즌종료 지식 이미 있음', ex.map(x => x.id).join(','));
    }
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

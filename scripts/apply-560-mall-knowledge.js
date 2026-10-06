// #560 봇 「자사몰」 지식 — 네이버 채널에서는 자사몰을 먼저 꺼내지 않는다(대표 확정 10/6)
// node scripts/apply-560-mall-knowledge.js        → 조회만
// node scripts/apply-560-mall-knowledge.js apply  → id 35 문장 교체 + 30~34 의 자사몰 줄 삭제(바꾸기 전 값은 audit_logs 에)
require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WHO = '클코 총괄(대표 확정 #560)';
const T35 = '(판매처 안내 규칙) 저희는 네이버 스마트스토어 외에 자사몰도 함께 운영해요. 다만 이 채널에서는 자사몰 이야기를 먼저 꺼내지 말고, 자사몰 주소를 적거나 자사몰에서 주문하라고 권하지 마세요. 주문·결제 안내는 이 스토어 기준으로만 하세요. 손님이 먼저 자사몰을 물으면 「네, 자사몰도 함께 운영하고 있어요」까지만 답하세요. 「자사몰이 없다」「스마트스토어에서만 판다」고는 말하지 마세요. 자사몰 주문·회원·쿠폰 등 자세한 내용은 고객센터(📞 010-6687-4031)로 안내하세요.';
(async () => {
    const apply = process.argv[2] === 'apply';
    const r = await p.query('SELECT id,item_key,knowledge FROM product_season_knowledge WHERE id = ANY($1::int[]) AND deleted_at IS NULL ORDER BY id', [[30, 31, 32, 33, 34, 35]]);
    for (const x of r.rows) {
        let next;
        if (x.id === 35) next = T35;
        else next = x.knowledge.split('\n').filter(l => !l.startsWith('· 자사몰(akkome.com)에서도')).join('\n');
        const changed = next !== x.knowledge;
        console.log(x.id, x.item_key, changed ? '바뀜' : '그대로', '자사몰 낱말', (x.knowledge.match(/자사몰/g) || []).length, '→', (next.match(/자사몰/g) || []).length, '줄', x.knowledge.split('\n').length, '→', next.split('\n').length);
        if (apply && changed) {
            await p.query('UPDATE product_season_knowledge SET knowledge=$2, updated_by=$3, updated_at=now() WHERE id=$1', [x.id, next, WHO]);
            await p.query("INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','season_knowledge',$1,$2::jsonb,'script',$3)", [String(x.id), JSON.stringify({ before: x.knowledge, after: next }), WHO]);
        }
    }
    console.log(apply ? '적용함' : '조회만(apply 를 붙이면 적용)');
    await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });

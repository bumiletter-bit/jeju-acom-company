// #562 시나리오의 「VIP 선물용 페이지가 더 저렴」 문장 4곳 → 가격이 같아졌으므로 「한 번에 고르실 수 있어요」(대표 GO 10/6 · 링크 유지)
//   node scripts/apply-562-vip-wording.js [apply]   바꾸기 전 값은 audit_logs 에
require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WHO = '클코 총괄(대표 지시 #562)';
const MAP = {
    37: ['💝 선물용은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요 ▶', '💝 선물용은 VIP 선물용 페이지에서 한 번에 고르실 수 있어요 ▶'],
    60: ['💝 선물용은 아래 VIP 선물용 페이지에서 주문하시면 일반 상품보다 더 저렴하게 준비해드려요!', '💝 선물용은 아래 VIP 선물용 페이지에서 한 번에 고르실 수 있어요!'],
    61: ['💝 선물용은 VIP 선물용 페이지에서 더 저렴하게 준비해드려요!', '💝 선물용은 VIP 선물용 페이지에서 한 번에 고르실 수 있어요!'],
    62: ['VIP 선물용 페이지예요(일반 페이지보다 저렴) ▶', 'VIP 선물용 페이지예요 ▶'],
};
(async () => {
    const apply = process.argv[2] === 'apply';
    for (const id of Object.keys(MAP).map(Number)) {
        const x = (await p.query('SELECT id, name, response FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
        const [a, b] = MAP[id];
        const c = x ? x.response.split(a).length - 1 : -1;
        const next = c === 1 ? x.response.replace(a, () => b) : null;
        console.log(id, x && x.name, '찾음', c, next ? '· 줄 수 ' + x.response.split('\n').length + ' → ' + next.split('\n').length + ' · 「저렴」 ' + (next.match(/저렴/g) || []).length : (x && x.response.includes(b) ? '· 이미 바뀜' : '· ✕'));
        if (apply && next) {
            await p.query('UPDATE inquiry_scenarios SET response=$2, updated_at=now() WHERE id=$1', [id, next]);
            await p.query("INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','inquiry_scenario',$1,$2::jsonb,'script',$3)", [String(id), JSON.stringify({ before: a, after: b }), WHO]);
        }
    }
    console.log(apply ? '적용함' : '조회만');
    await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });

// #567(대표 GO 10/6) 하우스감귤·황금향 발송 안내문과 봇 시기 지식을 지금 시기에 맞게
//   node scripts/apply-567-season-wording.js         조회만(무엇이 바뀌는지)
//   node scripts/apply-567-season-wording.js apply   적용(바꾸기 전 값은 audit_logs 에 통째로 남김)
//   하우스감귤: 「수확 초기」 → 「당도가 충분히 오른 것만 수확」 · 초록빛은 조금 남을 수 있음 · 새콤하면 상온 2~3일 후숙(산도가 빠지며 당도가 오름)
//   황금향: 「푸른끼」 → 「노랗게 잘 익어 가는 시기」 · 후숙 안내 삭제 → 신맛이 거의 없어 냉장 보관 추천
//   유라조생: 대표 「문구 맞아」 — 손대지 않음
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const WHO = '클코 총괄(대표 지시 #567)';
const GUIDE = [
    { ids: [210, 211, 212, 213, 214, 215, 554, 555], name: '하우스감귤', rep: [
        ['하우스귤은 하우스시설재배 상품으로 수확 초기의 새콤달콤한 맛이 매력이에요. 강제 착색하지 않아 표면이 초록초록할 수 있습니다.',
         '하우스귤은 하우스시설재배 상품으로, 당도가 충분히 오른 것만 골라 수확해 보내드려요. 강제 착색하지 않아 표면에 초록빛이 조금 남아 있을 수 있지만 속은 잘 익었습니다.'],
        ['먹는법 — 상온에서 2~3일 후숙하시면 새콤함이 달콤함으로 변해요. 장기보관은 냉장을 권장드립니다.',
         '먹는법 — 새콤하게 느껴지시면 상온에서 2~3일 후숙해 주세요. 산도가 빠지면서 당도가 더 올라와요. 장기보관은 냉장을 권장드립니다.'],
    ] },
    { ids: [225, 226, 409, 410, 363, 364], name: '황금향', rep: [
        ['황금향은 부드러운 향과 풍부한 과즙이 매력이에요. 강제 착색하지 않아 표면에 푸른끼가 있을 수 있습니다.',
         '황금향은 부드러운 향과 풍부한 과즙이 매력이에요. 지금은 색이 노랗게 잘 익어 가는 시기입니다.'],
        ['먹는법 — 수령 후 냉장보관을 권장드리며, 새콤하게 느껴지면 상온에서 2~3일 후숙 후 드시면 더 달콤해요.',
         '먹는법 — 신맛이 거의 없고 과즙과 향이 좋은 과일이라, 후숙 없이 냉장 보관해 시원하게 드시면 더 맛있어요.'],
    ] },
];
const KNOW = [
    { id: 12, end_md: '10-31', rep: [
        ['단맛이 우세해지고 겉색이 일반 귤색이 되는 시기예요(맛이 더 올라옴).',
         '단맛이 우세해진 시기예요(맛이 더 올라옴). 당도가 충분히 오른 것만 골라 수확해 보내드려요. 겉에 초록빛이 조금 남아 있을 수 있지만 속은 잘 익은 것이에요.'],
        ['(새콤하게 느껴지면 상온에서 하루 이틀 두었다가 드셔도 좋아요.)',
         '새콤하게 느껴지시면 상온에서 2~3일 후숙하시라고 안내하세요 — 후숙하면 산도가 빠지면서 당도가 더 올라와요.'],
    ] },
    { id: 9, rep: [
        ['5~8월엔 겉에 푸른끼가 있어도 다 익은 거예요. 과즙이 많아 냉장 후 시원하게 드시면 좋아요.',
         '5~8월엔 겉에 푸른끼가 있어도 다 익은 거예요. 10월부터는 색이 노랗게 잘 익어 가는 시기예요(완전히 노랗지 않은 과일이 섞일 수 있어요). 황금향은 신맛이 거의 없고 과즙이 많고 향이 좋은 것이 장점이에요 — 후숙할 필요 없이 냉장 보관해 시원하게 드시라고 안내하세요(상온 후숙을 권하지 마세요).'],
    ] },
];
(async () => {
    const apply = process.argv[2] === 'apply'; let bad = 0;
    for (const g of GUIDE) {
        const rows = (await p.query('SELECT id, name, shipping_guide FROM bot_products WHERE id = ANY($1::int[]) AND deleted_at IS NULL ORDER BY id', [g.ids])).rows;
        for (const x of rows) {
            let next = x.shipping_guide || ''; const hit = [];
            for (const [a, b] of g.rep) { const c = next.split(a).length - 1; hit.push(c); if (c === 1) next = next.replace(a, () => b); }
            const done = g.rep.every(([, b]) => (x.shipping_guide || '').includes(b));
            const ok = hit.every(c => c === 1);
            if (!ok && !done) bad++;
            console.log(`안내문 ${g.name} ${x.id} ${x.name.slice(0, 34)} — ${done ? '이미 바뀜' : ok ? '바뀜(줄 수 ' + x.shipping_guide.split('\n').length + ' → ' + next.split('\n').length + ')' : '✕ 찾은 수 ' + hit.join(',')}`);
            if (apply && ok) {
                await p.query('UPDATE bot_products SET shipping_guide=$2, updated_at=now(), updated_by=$3 WHERE id=$1', [x.id, next, WHO]);
                await p.query("INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','bot_product',$1,$2::jsonb,'script',$3)", [String(x.id), JSON.stringify({ field: 'shipping_guide', before: x.shipping_guide, after: next }), WHO]);
            }
        }
        if (rows.length !== g.ids.length) { bad++; console.log(`✕ ${g.name} 행 수 ${rows.length}/${g.ids.length}`); }
    }
    for (const k of KNOW) {
        const x = (await p.query('SELECT id, item_key, label, end_md, knowledge FROM product_season_knowledge WHERE id=$1 AND deleted_at IS NULL', [k.id])).rows[0];
        let next = x.knowledge; const hit = [];
        for (const [a, b] of k.rep) { const c = next.split(a).length - 1; hit.push(c); if (c === 1) next = next.replace(a, () => b); }
        const done = k.rep.every(([, b]) => x.knowledge.includes(b)) && (!k.end_md || x.end_md === k.end_md); const ok = hit.every(c => c === 1);
        if (!ok && !done) bad++;
        console.log(`지식 ${x.id} ${x.item_key}·${x.label} — ${done ? '이미 바뀜' : ok ? '바뀜' + (k.end_md ? ' · 기간 끝 ' + x.end_md + ' → ' + k.end_md : '') : '✕ 찾은 수 ' + hit.join(',')}`);
        if (apply && ok) {
            await p.query('UPDATE product_season_knowledge SET knowledge=$2, end_md=COALESCE($3, end_md), updated_by=$4, updated_at=now() WHERE id=$1', [x.id, next, k.end_md || null, WHO]);
            await p.query("INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','season_knowledge',$1,$2::jsonb,'script',$3)", [String(x.id), JSON.stringify({ before: x.knowledge, after: next, end_md: [x.end_md, k.end_md || x.end_md] }), WHO]);
        }
    }
    console.log(apply ? '적용함' : '조회만', bad ? `· ✕ ${bad}건` : '');
    await p.end(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });

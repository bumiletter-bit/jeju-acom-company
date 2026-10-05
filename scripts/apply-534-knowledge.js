// #534: 하우스감귤 로얄과 중량UP 행사 — 봇 시기 지식(10/5~10/10 · 기간 지나면 저절로 빠진다)
//   node scripts/apply-534-knowledge.js        = 조회만
//   node scripts/apply-534-knowledge.js apply  = 넣기(이미 있으면 건너뜀) · off = 끄기(행사 일찍 끝낼 때)
require('dotenv').config();
const { Pool } = require('pg');
const LABEL = '로얄과 중량UP 행사 2026-10';
const KEYS = ['하우스감귤', '하우스귤', '중량'];
const TEXT = [
    '지금 「하우스감귤 로얄과 2.5kg → 4kg 중량UP 행사」 중이에요.',
    '· 옵션 「행사★하우스귤 2.5kg로얄과→중량up 4kg」(29,000원)을 주문하시면 2.5kg 값으로 로얄과 4kg을 보내드려요. 판매현황의 「가정용 - 4kg(로얄과) 29,000원」이 바로 이 행사 옵션이에요.',
    '· 하우스감귤 가정용 2.5kg·4kg 로얄과 가격이나 행사를 물으면 「지금은 2.5kg 값(29,000원)으로 4kg을 받으시는 행사 중」이라고 먼저 안내하세요. 「2.5kg 로얄과는 판매하지 않는다」고만 답하지 마세요.',
    '· 행사 기간: 10월 10일(토)까지 주문하신 건 — 10월 11일(일) 오전 발송분으로 마감이에요. 기간 문의에는 이 날짜를 그대로 안내하세요.',
    '· 4kg 로얄과 과수는 로얄과 기준(kg당 11~16개) 그대로 약 44~64과 전후예요.',
    '· 행사 이유를 물으면: 지금 하우스감귤 맛이 가장 좋을 때라 더 넉넉히 드시라고 준비한 행사라고 안내하세요.',
    '· 소과(2.5kg 23,800원 · 4.5kg 39,800원)·선물용·4.5kg 로얄과는 행사 대상이 아니에요(가격은 판매현황 그대로).',
].join('\n');
(async () => {
    const mode = process.argv[2] || '';
    const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const cur = await p.query(`SELECT id,item_key,start_md,end_md,enabled FROM product_season_knowledge WHERE label=$1 AND deleted_at IS NULL ORDER BY id`, [LABEL]);
    console.log('지금:', JSON.stringify(cur.rows));
    if (mode === 'apply') {
        for (const k of KEYS) {
            if (cur.rows.some(r => r.item_key === k)) { console.log('있음 건너뜀', k); continue; }
            const r = await p.query(`INSERT INTO product_season_knowledge(item_key,label,start_md,end_md,knowledge,sort,enabled,updated_by) VALUES($1,$2,'10-05','10-10',$3,5,true,'클코 총괄(대표 지시 #534)') RETURNING id`, [k, LABEL, TEXT]);
            await p.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('create','season_knowledge',$1,$2::jsonb,'script','클코 총괄(대표 지시 #534)')`, [String(r.rows[0].id), JSON.stringify({ item_key: k, label: LABEL, range: '10-05~10-10' })]);
            console.log('넣음', k, r.rows[0].id);
        }
    } else if (mode === 'off') {
        const r = await p.query(`UPDATE product_season_knowledge SET enabled=false, updated_at=now() WHERE label=$1 AND deleted_at IS NULL RETURNING id`, [LABEL]);
        await p.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','season_knowledge','534',$1::jsonb,'script','클코 총괄(대표 지시 #534)')`, [JSON.stringify({ off: r.rows.map(x => x.id) })]);
        console.log('끔', r.rows.length);
    }
    await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

// #534-b(대표 확정 10/5 오후): 행사 지식 보강 — 자사몰도 안내 · 마감 = 10/11(일) 오전 8시 주문분까지 · 쿠팡도 4kg · 변경 전 2.5kg 로얄과 주문도 4kg
//   node scripts/apply-534b-knowledge.js [apply]
require('dotenv').config();
const { Pool } = require('pg');
const LABEL = '로얄과 중량UP 행사 2026-10';
const WHO = '클코 총괄(대표 확정 #534-b)';
const TEXT = [
    '지금 「하우스감귤 로얄과 2.5kg → 4kg 중량UP 행사」 중이에요.',
    '· 옵션 「행사★하우스귤 2.5kg로얄과→중량up 4kg」(29,000원)을 주문하시면 2.5kg 값으로 로얄과 4kg을 보내드려요. 판매현황의 「가정용 - 4kg(로얄과) 29,000원」이 바로 이 행사 옵션이에요.',
    '· 하우스감귤 가정용 2.5kg·4kg 로얄과 가격이나 행사를 물으면 「지금은 2.5kg 값(29,000원)으로 4kg을 받으시는 행사 중」이라고 먼저 안내하세요. 「2.5kg 로얄과는 판매하지 않는다」고만 답하지 마세요.',
    '· 행사 기간: 10월 11일(일) 오전 8시까지 주문하신 건까지 — 11일(일) 오전 발송분으로 마감이에요. 토요일(10일) 주문도, 일요일 오전 8시 이전 주문도 행사 적용이에요. 기간 문의에는 이 내용을 그대로 안내하세요.',
    '· 행사 시작 전(10월 5일 이전·당일)에 「가정용 2.5kg(로얄과)」로 이미 주문하셨고 아직 발송 전인 분도 4kg으로 업그레이드해서 보내드려요(개별 연락 드렸어요). 발송 안내 알림에는 주문하신 옵션 이름(2.5kg)이 그대로 보일 수 있지만 실제로는 4kg이 발송돼요.',
    '· 쿠팡에서 주문하신 로얄과 2.5kg(행사 옵션 포함)도 같은 행사로 4kg을 보내드려요.',
    '· 자사몰(akkome.com)에서도 같은 행사 옵션·같은 가격으로 주문하실 수 있어요. 「자사몰이 없다」「스마트스토어에서만 판다」고 말하지 마세요(사실이 아니에요).',
    '· 4kg 로얄과 과수는 로얄과 기준(kg당 11~16개) 그대로 약 44~64과 전후예요.',
    '· 행사 이유를 물으면: 지금 하우스감귤 맛이 가장 좋을 때라 더 넉넉히 드시라고 준비한 행사라고 안내하세요.',
    '· 소과(2.5kg 23,800원 · 4.5kg 39,800원)·선물용·4.5kg 로얄과는 행사 대상이 아니에요(가격은 판매현황 그대로).',
].join('\n');
const MALL = '저희는 네이버 스마트스토어·쿠팡과 함께 자사몰(akkome.com)도 운영해요 — 같은 상품을 같은 가격으로 주문하실 수 있어요. 「자사몰이 없다」「스마트스토어에서만 판다」고 말하지 마세요. 자사몰 주문·회원·쿠폰처럼 자세한 내용은 자료에 있는 범위에서만 답하고, 모르는 것은 고객센터(📞 010-6687-4031)로 안내하세요.';
(async () => {
    const apply = process.argv[2] === 'apply';
    const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const cur = await p.query(`SELECT id,item_key,end_md,knowledge FROM product_season_knowledge WHERE label=$1 AND deleted_at IS NULL ORDER BY id`, [LABEL]);
    console.log('행사 지식', cur.rows.map(r => r.id + ':' + r.item_key + ' ~' + r.end_md + (r.knowledge === TEXT ? ' (최신)' : '')).join(' · '));
    const mall = await p.query(`SELECT id FROM product_season_knowledge WHERE item_key='자사몰' AND deleted_at IS NULL`);
    console.log('자사몰 상시 지식', mall.rows.map(r => r.id).join(',') || '없음');
    if (apply) {
        for (const r of cur.rows) {
            if (r.knowledge === TEXT && r.end_md === '10-11') continue;
            await p.query(`UPDATE product_season_knowledge SET knowledge=$2, end_md='10-11', updated_by=$3, updated_at=now() WHERE id=$1`, [r.id, TEXT, WHO]);
            await p.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('update','season_knowledge',$1,$2::jsonb,'script',$3)`, [String(r.id), JSON.stringify({ before: { end_md: r.end_md }, after: { end_md: '10-11', note: '자사몰 안내·마감 11일 08시·쿠팡 4kg·변경 전 주문 4kg' } }), WHO]);
            console.log('갱신', r.id);
        }
        for (const k of ['쿠팡', '업그레이드']) {
            if (cur.rows.some(r => r.item_key === k)) continue;
            const r = await p.query(`INSERT INTO product_season_knowledge(item_key,label,start_md,end_md,knowledge,sort,enabled,updated_by) VALUES($1,$2,'10-05','10-11',$3,5,true,$4) RETURNING id`, [k, LABEL, TEXT, WHO]);
            await p.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('create','season_knowledge',$1,$2::jsonb,'script',$3)`, [String(r.rows[0].id), JSON.stringify({ item_key: k, label: LABEL }), WHO]);
            console.log('넣음', k, r.rows[0].id);
        }
        if (!mall.rows.length) {
            const r = await p.query(`INSERT INTO product_season_knowledge(item_key,label,start_md,end_md,knowledge,sort,enabled,updated_by) VALUES('자사몰','공통','01-01','12-31',$1,1,true,$2) RETURNING id`, [MALL, WHO]);
            await p.query(`INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES('create','season_knowledge',$1,$2::jsonb,'script',$3)`, [String(r.rows[0].id), JSON.stringify({ item_key: '자사몰', label: '공통', range: '상시' }), WHO]);
            console.log('자사몰 상시 지식 넣음', r.rows[0].id);
        }
    }
    await p.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

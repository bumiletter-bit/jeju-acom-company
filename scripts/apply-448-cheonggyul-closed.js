// #448(대표 GO 9/16 "청귤 마감 안내 — 마감 전 주문 발송 문구 제거 · 올해 마감·내년 출하 시 안내·알림받기만 · 무회귀"):
//   톡톡 실물(9/15 23:34) 「마감 전에 주문해주신 물량은 순서대로 정상 발송」 줄 = 시나리오 #38(id 39)·#48(id 49)·시기 지식 id 16(09-15~07-31) 고정 문구.
//   교정 = 그 문장만 정확 치환(다른 줄 무접촉). DB 전용·코드·배포 0·전건 audit.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #448 청귤 마감 안내 문구)';
const audit = (action, type, id, changes, source) => pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ($1,$2,$3,$4,$5,NULL,$6)`, [action, type, id, JSON.stringify(changes), source, ACTOR]);
const EDITS = [
    { table: 'inquiry_scenarios', col: 'response', id: 39, label: '#38 품목-청귤',
      from: '📦 마감 전에 주문해주신 건은 순서대로 정상 발송되고 있으니 안심하세요!\n', to: '' },
    { table: 'inquiry_scenarios', col: 'response', id: 49, label: '#48 청귤 수확기간',
      from: '올해 청귤 주문은 9월 15일 오전 8시로 마감되었어요 — 마감 전에 주문하신 건은 순서대로 정상 발송 중이니 안심하세요 😊', to: '올해 청귤 주문은 9월 15일 오전 8시로 마감되었어요 😊' },
    { table: 'product_season_knowledge', col: 'knowledge', id: 16, label: '지식 청귤 시즌종료(비시즌)',
      from: "마감 전 주문 건은 순서대로 정상 발송 중이라고 안내하고, '지금 주문 가능'·'오늘 발송' 같은 표현은 쓰지 마세요.",
      to: "「마감 전 주문은 정상 발송 중」 같은 발송 안내 문구는 넣지 말고, 올해는 마감·내년 출하 시 안내·상품페이지 알림받기로만 답하세요. '지금 주문 가능'·'오늘 발송' 같은 표현도 쓰지 마세요." },
];
(async () => {
    for (const e of EDITS) {
        const before = (await pool.query(`SELECT * FROM ${e.table} WHERE id=$1`, [e.id])).rows[0];
        if (!before) throw new Error(`${e.label}: 행 없음`);
        const cur = before[e.col];
        const n = cur.split(e.from).length - 1;
        if (n !== 1) throw new Error(`${e.label}: 대상 문장 ${n}회 (1회여야 함) — 중단`);
        const next = cur.replace(e.from, e.to);
        const upd = e.table === 'inquiry_scenarios'
            ? await pool.query('UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [next, ACTOR, e.id])
            : await pool.query('UPDATE product_season_knowledge SET knowledge=$1, updated_at=now(), updated_by=$2 WHERE id=$3 RETURNING *', [next, ACTOR, e.id]);
        const after = upd.rows[0];
        // 그 문장 외 무변경 기계 검산: before에서 from→to 치환 결과와 after 바이트 동일
        if (after[e.col] !== next) throw new Error(`${e.label}: 저장 불일치`);
        const otherCols = Object.keys(before).filter(k => !['updated_at', 'updated_by', e.col].includes(k)).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (otherCols.length) throw new Error(`${e.label}: 다른 컬럼 변경 ${otherCols}`);
        await audit('update', e.table, e.id, { instruction: '#448', field: e.col, removed: e.from, replaced_with: e.to, before: cur, after: next }, 'claude-code');
        console.log(`✅ ${e.label}(id ${e.id}): 문장 1회 치환 · 다른 컬럼 무변경 · audit`);
    }
    // 잔존 스캔(활성 시나리오·활성 지식·청귤 관련)
    const s = await pool.query(`SELECT id, scenario_no, name FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled=true AND (response ~ '(마감 전|마감전).{0,30}(정상 발송|순서대로|순차)')`);
    const k = await pool.query(`SELECT id, label FROM product_season_knowledge WHERE deleted_at IS NULL AND enabled=true AND knowledge ~ '(마감 전|마감전).{0,30}(정상 발송|순서대로|순차)'`);
    console.log('잔존 스캔 — 활성 시나리오:', s.rows.length, JSON.stringify(s.rows), '/ 활성 지식:', k.rows.length, JSON.stringify(k.rows));
    for (const e of EDITS) { const r = (await pool.query(`SELECT ${e.col} v FROM ${e.table} WHERE id=$1`, [e.id])).rows[0]; console.log(`\n--- ${e.label} 최종 ---\n${r.v}`); }
    await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

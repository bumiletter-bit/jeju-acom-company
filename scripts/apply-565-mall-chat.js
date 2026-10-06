// #565(대표 10/6 「자사몰 채팅창 봇은 자사몰로 안내해야」): 시기 지식의 채널 머리말 정리
//   node scripts/apply-565-mall-chat.js          = 조회만(머리말 붙은 행 · 「자사몰」 행 · 오늘 자사몰 챗 / 네이버 채널에 실리는 행 수)
//   node scripts/apply-565-mall-chat.js apply    = id 35(자사몰 · 「이 채널에서는 자사몰을 먼저 꺼내지 말 것」)의 label 「공통」 → 「[네이버] 공통」 + audit
//   node scripts/apply-565-mall-chat.js off      = 되돌리기(「[네이버] 공통」 → 「공통」)
//   머리말 규칙(server.js seasonScenariosToday): 「[자사몰챗] …」 = 자사몰 챗에만 실림 · 「[네이버] …」 = 자사몰 챗에서 빠짐 · 머리말 없음 = 전 채널.
//   🔴 「[자사몰챗]」 행은 #565 가 배포된 뒤에만 넣을 것 — 배포 전 서버는 머리말을 몰라 그 행을 톡톡·상품문의·고객문의에도 그대로 싣는다.
//      (자사몰 챗의 기본 안내는 DB 행이 아니라 server.js mallChannelRule() 에 있다 — 배포와 함께 켜진다. 이 스크립트는 행을 새로 넣지 않는다.)
//   「[네이버]」 머리말은 배포 전에 붙여도 해가 없다(옛 서버는 재료 제목에 머리말이 보일 뿐 · 내용 그대로).
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ID = 35, ON = '[네이버] 공통', OFF = '공통', WHO = '클코 워커2(대표 GO #565 · 총괄 배정)';
const TAG = /^\[(자사몰챗|네이버)\]\s*/;
(async () => {
    const mode = process.argv[2] || '';
    const rows = (await pool.query(`SELECT id, item_key, label, start_md, end_md, enabled, left(knowledge, 70) AS head FROM product_season_knowledge WHERE deleted_at IS NULL ORDER BY id`)).rows;
    const kst = new Date(Date.now() + 9 * 3600 * 1000); const md = String(kst.getUTCMonth() + 1).padStart(2, '0') + '-' + String(kst.getUTCDate()).padStart(2, '0');
    const inRange = (m, s, e) => (s <= e) ? (m >= s && m <= e) : (m >= s || m <= e);
    const live = rows.filter(r => r.enabled && inRange(md, r.start_md, r.end_md));
    const tagOf = r => (String(r.label || '').match(TAG) || [])[1] || '';
    console.log(`오늘(${md}) 켜진 행 ${live.length} — 네이버 채널에 실림 ${live.filter(r => tagOf(r) !== '자사몰챗').length} · 자사몰 챗에 실림 ${live.filter(r => tagOf(r) !== '네이버').length}`);
    rows.filter(r => tagOf(r) || r.item_key === '자사몰').forEach(r => console.log(`  id ${r.id} [${r.item_key} | ${r.label}] ${r.start_md}~${r.end_md} en=${r.enabled} | ${r.head}…`));
    if (mode !== 'apply' && mode !== 'off') { await pool.end(); return; }
    const cur = rows.find(r => r.id === ID);
    if (!cur || cur.item_key !== '자사몰') throw new Error(`id ${ID} 이 「자사몰」 행이 아님 — 중단`);
    const from = mode === 'apply' ? OFF : ON, to = mode === 'apply' ? ON : OFF;
    if (cur.label === to) { console.log(`이미 「${to}」 — 바꿀 것 없음`); await pool.end(); return; }
    if (cur.label !== from) throw new Error(`id ${ID} label 이 예상(「${from}」)과 다름: 「${cur.label}」 — 중단`);
    const r = await pool.query(`UPDATE product_season_knowledge SET label=$2, updated_by=$3, updated_at=now() WHERE id=$1 AND label=$4 RETURNING id, label`, [ID, to, WHO, from]);
    if (r.rowCount !== 1) throw new Error('갱신 0행 — 중단');
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','product_season_knowledge',$1,$2,'claude-code',NULL,$3)`,
        [ID, JSON.stringify({ note: '#565 시기 지식 채널 머리말 — 자사몰 챗에서 빠지게', before: { label: from }, after: { label: to } }), WHO]);
    console.log(`✅ id ${ID} label 「${from}」 → 「${to}」 · audit 기록`);
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });

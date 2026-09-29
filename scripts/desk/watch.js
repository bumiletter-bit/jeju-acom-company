// #469 창구 감시 — 새 지시('대기')·승인된 지시('승인됨')가 생길 때까지 기다린다. 발견하면 목록을 출력하고 종료.
// 사용: node scripts/desk/watch.js   (창구 터미널에서 백그라운드 실행 — AI 사용량 0)
const { pool, heartbeat } = require('./_db');
const CHECK_MS = 10000, BEAT_MS = 30000;
(async () => {
    let lastBeat = 0;
    for (;;) {
        try {
            if (Date.now() - lastBeat >= BEAT_MS) { await heartbeat('idle'); lastBeat = Date.now(); }
            const r = await pool.query(
                `SELECT id, status, created_by, LEFT(content, 80) AS head, (image_data IS NOT NULL) AS has_image,
                        to_char(created_at + interval '9 hours', 'MM-DD HH24:MI') AS at_kst
                 FROM pending_orders
                 WHERE is_deleted = false AND status IN ('대기', '승인됨')
                   AND content NOT LIKE '[검증469]%' -- 검증 스크립트의 시험 지시는 집지 않는다
                 ORDER BY (status = '승인됨') DESC, id ASC LIMIT 10`);
            if (r.rows.length) {
                console.log('새 지시 ' + r.rows.length + '건');
                for (const o of r.rows) console.log(`#${o.id} [${o.status}] ${o.at_kst} ${o.created_by || '-'}${o.has_image ? ' (이미지)' : ''} :: ${o.head}`);
                await pool.end(); process.exit(0);
            }
        } catch (e) { console.error('감시 오류(재시도):', e.message); }
        await new Promise(r => setTimeout(r, CHECK_MS));
    }
})();

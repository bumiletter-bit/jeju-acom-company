// #593 손님 배송 확인 — 사용: node scripts/desk/ship-status.js "<이름 | 전화번호 | 끝 4자리>" [--days 60] [--limit 10] [--no-track]
//   송장 색인에서 그 손님의 최근 주문(운송장)을 찾아 지금 배송 상태를 붙여 준다. 「○○ 손님 배송 완료됐어?」「송장 번호 알려줘」「아직 안 받았대」에 쓴다.
//   상태 = DB 표 delivery_status 에 있으면 그것(배송완료로 확정됐거나 6시간 안에 확인한 것) · 없거나 오래됐으면 그 자리에서 CJ 배송조회를 물어 표에 적어 둔다.
//   답에 나오는 것 = 날짜 · 거래처 · 옵션 · 수량 · 운송장 · 상태(문구 · 시각 · 지점 · 담당 기사). 번호는 끝 4자리만 · 주소는 내지 않는다.
//   쓰기는 delivery_status 표 한 곳뿐(조회 결과 적어 두기). 발송·알림 0.
const fs = require('fs'), path = require('path');
const up = require('./ship-upload.js');
const args = process.argv.slice(2); const opt = { days: 60, limit: 10 }; const terms = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '--days') opt.days = +args[++i] || 60; else if (a === '--limit') opt.limit = +args[++i] || 10; else if (a === '--no-track') opt.noTrack = true; else if (a === '--no-update') opt.noUpdate = true; else terms.push(a.trim()); }
const term = terms.join(' ').trim(); const say = o => console.log(JSON.stringify(o, null, 1));
if (!term) { say({ ok: false, error: '사용: ship-status.js "<이름 또는 전화번호>" [--days 60]' }); process.exit(1); }
// CJ 조회 = 서버와 같은 모듈(cj-track.js · 저장소 맨 위) · 표에 적는 칸도 서버와 같다
const cj = require(path.join(__dirname, '..', '..', 'cj-track.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TROUBLE = cj.TROUBLE_BUCKETS || ['미배송', '사고', '기타', '정보없음', '조회실패'];
const tail4 = t => { const d = String(t || '').replace(/\D/g, ''); return d ? d.slice(-4) : ''; };
const hyphen = tr => tr.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3');

(async () => {
    // 색인이 오래됐으면 뒤에서 새로 만들고(다음 질문부터 반영) 있던 색인으로 바로 답한다 — invoice-find 와 같은 규칙
    if (!fs.existsSync(up.INV_JSON)) { if (!opt.noUpdate) up.refreshIndex(true); }
    else if (!opt.noUpdate && Date.now() - fs.statSync(up.INV_JSON).mtimeMs > 60 * 60 * 1000) { try { require('child_process').spawn(process.execPath, [path.join(__dirname, 'share-index.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { /* 무시 */ } }
    if (!fs.existsSync(up.INV_JSON)) { say({ ok: false, error: '송장 색인이 없습니다 — 공유폴더(사무실 네트워크) 연결을 확인하고 node scripts/desk/share-index.js 를 먼저 실행하세요' }); process.exit(2); }
    const dg = term.replace(/\D/g, ''); const byPhone = dg.length >= 4 && dg.length >= term.replace(/[\s\-()]/g, '').length;
    const needle = byPhone ? dg : term.replace(/\s+/g, ''); const nb = Buffer.from(needle); const since = up.kstDay(-opt.days);
    const hits = [];
    await up.scanRows(ob => ob.includes(nb), r => {
        if (!r.d || r.d < since) return;
        let how = null;
        if (byPhone) { const full = dg.length >= 9; const t1 = String(r.t1 || ''), t2 = String(r.t2 || ''), tb = String(r.tb || ''); if (full ? (t1 === dg || t2 === dg || tb === dg) : (t1.endsWith(dg) || t2.endsWith(dg) || tb.endsWith(dg))) how = t1.endsWith(dg) ? '수취인' : tb.endsWith(dg) ? '구매자' : '수취인2'; }
        else if (r.nm && String(r.nm).replace(/\s+/g, '').includes(needle)) how = '이름';
        if (how) hits.push(Object.assign({ how }, r));
    });
    hits.sort((a, b) => String(b.d).localeCompare(String(a.d)));
    // 같은 운송장 여러 줄은 한 건으로(옵션 잇기 · 수량 더하기) · 운송장 없는 줄은 줄마다
    const orders = []; const byTr = new Map();
    for (const r of hits) {
        const tr = String(r.tr || '').replace(/\D/g, ''); const ok = /^\d{10}(\d{2})?$/.test(tr); const q = parseInt(r.q, 10) || 0;
        if (ok && byTr.has(tr)) { const o = byTr.get(tr); if (r.op && !o.opts.includes(r.op)) o.opts.push(r.op); o.qty += q; continue; }
        const o = { date: r.d, partner: r.pt, name: r.nm, phone_tail: tail4(r.how === '구매자' ? r.tb : r.t1), matched: r.how, opts: r.op ? [r.op] : [], qty: q, tr: ok ? tr : '' };
        orders.push(o); if (ok) byTr.set(tr, o);
    }
    // 색인은 한 분께 상자가 둘 이상 가면 운송장 하나만 잡는다 → 서버 표(delivery_shipments · 엑셀 둘째 시트 기준)에 그 손님의 다른 운송장이 있으면 보탠다
    try {
        const { pool } = require('./_db');
        const more = await pool.query(byPhone
            ? (dg.length >= 9 ? `SELECT tracking, ship_date::text AS d, partner, recipient, phone, option_text, qty FROM delivery_shipments WHERE phone = $1 AND ship_date >= $2::date`
                : `SELECT tracking, ship_date::text AS d, partner, recipient, phone, option_text, qty FROM delivery_shipments WHERE right(phone, ${dg.length}) = $1 AND ship_date >= $2::date`)
            : `SELECT tracking, ship_date::text AS d, partner, recipient, phone, option_text, qty FROM delivery_shipments WHERE replace(recipient, ' ', '') LIKE '%' || $1 || '%' AND ship_date >= $2::date`, [needle, since]);
        for (const r of more.rows) if (!byTr.has(r.tracking)) { const o = { date: r.d, partner: r.partner, name: r.recipient, phone_tail: tail4(r.phone), matched: byPhone ? '수취인' : '이름', opts: r.option_text ? [r.option_text] : [], qty: r.qty || 0, tr: r.tracking }; orders.push(o); byTr.set(r.tracking, o); }
        orders.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } catch (e) { /* 표가 없거나 DB 에 못 닿으면 색인 결과만으로 */ }
    const people = new Set(orders.map(o => o.name + '|' + o.phone_tail));
    const shown = orders.slice(0, opt.limit); const trs = shown.map(o => o.tr).filter(Boolean);
    let dbNote; const st = new Map(); let asked = 0, failed = 0;
    if (trs.length) {
        const { pool } = require('./_db');
        try {
            await up.ensureTables(pool);
            const have = await pool.query(`SELECT tracking, bucket, code, label, msg, event_time, branch, driver_name, driver_phone, delivered, to_char(checked_at AT TIME ZONE 'Asia/Seoul', 'MM/DD HH24:MI') AS checked, (checked_at > now() - interval '6 hours') AS fresh FROM delivery_status WHERE tracking = ANY($1::text[])`, [trs]);
            for (const r of have.rows) if (r.delivered || r.fresh || opt.noTrack) st.set(r.tracking, { bucket: r.bucket, label: r.label, message: r.msg, at: r.event_time, branch: r.branch, driver: r.driver_name ? { name: r.driver_name, phone: r.driver_phone } : null, checked: r.checked, from: '저장된 조회' });
            if (!opt.noTrack) {
                const trackOne = cj.trackOne;
                for (const tr of trs) {
                    if (st.has(tr)) continue;
                    if (asked) await sleep(300);
                    let k; try { k = await trackOne(tr); } catch (e) { k = { bucket: '조회실패', label: String(e && e.message || e).slice(0, 100) }; }
                    asked++;
                    if (!k || k.bucket === '조회실패') { failed++; st.set(tr, { bucket: '조회실패', label: k && k.label, from: '방금 조회' }); continue; }
                    const drv = k.driver || null;
                    await pool.query(
                        `INSERT INTO delivery_status (tracking, bucket, code, label, msg, event_time, branch, driver_name, driver_phone, events, delivered, checked_at, first_trouble_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, now(), CASE WHEN $12::boolean THEN now() END)
                         ON CONFLICT (tracking) DO UPDATE SET bucket = EXCLUDED.bucket, code = EXCLUDED.code, label = EXCLUDED.label, msg = EXCLUDED.msg, event_time = EXCLUDED.event_time, branch = EXCLUDED.branch,
                                driver_name = EXCLUDED.driver_name, driver_phone = EXCLUDED.driver_phone, events = EXCLUDED.events, delivered = EXCLUDED.delivered, checked_at = now(),
                                first_trouble_at = COALESCE(delivery_status.first_trouble_at, EXCLUDED.first_trouble_at)`,
                        [tr, k.bucket, k.code || null, k.label || null, k.msg || null, k.time || null, k.branch || null, drv && drv.name || null, drv && drv.phone || null, JSON.stringify(k.events || []), k.bucket === '배송완료', TROUBLE.includes(k.bucket)]);
                    st.set(tr, { bucket: k.bucket, label: k.label, message: k.msg, at: k.time, branch: k.branch, driver: drv, checked: '방금', from: '방금 조회' });
                }
            }
        } catch (e) { dbNote = 'DB·조회 중 오류: ' + String(e && e.message || e).slice(0, 140); }
        finally { await pool.end(); }
    }
    const items = shown.map(o => ({ date: o.date, partner: o.partner, name: o.name, phone_tail: o.phone_tail, matched: o.matched, option: o.opts.join(' + '), qty: o.qty, tracking: o.tr ? hyphen(o.tr) : '', status: o.tr ? (st.get(o.tr) || { bucket: '확인 안 됨', label: opt.noTrack ? '저장된 조회 없음' : '조회하지 못함' }) : { bucket: '운송장 없음', label: '송장 파일에 운송장번호가 아직 없습니다(접수 전이거나 다른 택배)' } }));
    say({ ok: true, query: byPhone ? '번호 ' + (dg.length >= 9 ? '끝 ' + dg.slice(-4) : dg) : term, by: byPhone ? '전화번호' : '이름', since, total: orders.length, shown: items.length, distinct_people: people.size,
        note: people.size > 1 ? '여러 손님이 섞여 있습니다 — 이름·최근 날짜만 후보로 보여 주고 전체 번호(또는 어느 분인지)를 다시 물으세요' : (byPhone && dg.length < 9 ? '끝자리만으로 찾았습니다 — 다른 손님이 섞일 수 있어요' : undefined),
        asked_cj: asked, failed_cj: failed || undefined, warn: dbNote, items });
})().catch(e => { say({ ok: false, error: String(e && e.message || e) }); process.exit(3); });

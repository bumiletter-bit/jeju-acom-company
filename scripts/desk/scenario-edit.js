// #469 시나리오 수정·추가 — 바꾸기 전 값을 남기고 변경 기록(audit)까지 한 번에 처리한다.
// 창구는 inquiry_scenarios를 직접 UPDATE하지 않고 이 스크립트를 쓴다(기록 누락 방지).
//
// 수정: node scripts/desk/scenario-edit.js edit <시나리오 id> <변경.json> <지시 id>
//   변경.json = { "response"?: "...", "keywords"?: ["..."], "name"?: "...", "enabled"?: true|false }  ← 바꿀 칸만
// 추가: node scripts/desk/scenario-edit.js add <새 시나리오.json> <지시 id>
//   새 시나리오.json = { "name": "...", "keywords": ["..."], "response": "...", "channel": "톡톡|공통|상품문의", "enabled"?: false }
//   (번호는 자동 · 기본은 꺼진 상태로 만든다 — 켜려면 enabled:true를 명시)
// 보기: node scripts/desk/scenario-edit.js show <시나리오 id 또는 검색어>
const fs = require('fs');
const { pool } = require('./_db');
const CHANNELS = ['톡톡', '공통', '상품문의'];
const ALLOWED = ['response', 'keywords', 'name', 'enabled'];
const who = async (orderId) => {
    if (!orderId) return '클코(창구)';
    const o = (await pool.query(`SELECT created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
    return '클코(창구) · ' + ((o && o.created_by) || '요청자 미상');
};
const checkKeywords = (k) => { if (!Array.isArray(k) || !k.length || k.some(x => typeof x !== 'string' || !x.trim())) throw new Error('keywords는 빈 값 없는 글자 배열이어야 합니다'); return k.map(x => x.trim()); };
const BAD_PAY = /(계좌|입금|이체|무통장|송금|현금으로)/;
const checkText = (t) => {
    if (typeof t !== 'string' || !t.trim()) throw new Error('response가 비었습니다');
    const m = t.match(BAD_PAY);
    if (m) throw new Error(`결제 단어 「${m[0]}」는 네이버 채널 글에 쓸 수 없습니다(거절 문장에도)`);
    if (/\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}(?!\d)/.test(t)) console.error('주의: 본문에 날짜가 있습니다. 기간 한정 내용은 시기 지식에 넣는 것이 원칙입니다.');
    return t;
};
(async () => {
    const mode = process.argv[2];
    if (mode === 'show') {
        const q = process.argv[3];
        if (!q) throw new Error('사용: show <id 또는 검색어>');
        const r = /^\d+$/.test(q)
            ? await pool.query(`SELECT id, scenario_no, name, keywords, response, enabled, channel, updated_by FROM inquiry_scenarios WHERE deleted_at IS NULL AND (id = $1 OR scenario_no = $1) ORDER BY id`, [Number(q)])
            : await pool.query(`SELECT id, scenario_no, name, keywords, response, enabled, channel, updated_by FROM inquiry_scenarios WHERE deleted_at IS NULL AND (name ILIKE $1 OR response ILIKE $1 OR keywords::text ILIKE $1) ORDER BY scenario_no LIMIT 20`, ['%' + q + '%']);
        console.log(JSON.stringify(r.rows, null, 2));
    } else if (mode === 'edit') {
        const id = parseInt(process.argv[3], 10), file = process.argv[4], orderId = parseInt(process.argv[5], 10) || null;
        if (!id || !file) throw new Error('사용: edit <시나리오 id> <변경.json> <지시 id>');
        const ch = JSON.parse(fs.readFileSync(file, 'utf8'));
        const keys = Object.keys(ch);
        if (!keys.length) throw new Error('바꿀 칸이 없습니다');
        const bad = keys.filter(k => !ALLOWED.includes(k));
        if (bad.length) throw new Error('바꿀 수 없는 칸: ' + bad.join(', ') + ' (채널·번호는 이 스크립트로 바꾸지 않습니다)');
        if ('response' in ch) ch.response = checkText(ch.response);
        if ('keywords' in ch) ch.keywords = checkKeywords(ch.keywords);
        if ('name' in ch && (typeof ch.name !== 'string' || !ch.name.trim())) throw new Error('name이 비었습니다');
        if ('enabled' in ch && typeof ch.enabled !== 'boolean') throw new Error('enabled는 true/false');
        const cur = (await pool.query(`SELECT id, scenario_no, name, keywords, response, enabled, channel FROM inquiry_scenarios WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
        if (!cur) throw new Error('없는 시나리오입니다(id 기준 · show로 확인)');
        const before = {}, after = {};
        for (const k of keys) { if (JSON.stringify(cur[k]) !== JSON.stringify(ch[k])) { before[k] = cur[k]; after[k] = ch[k]; } }
        if (!Object.keys(after).length) { console.log(JSON.stringify({ ok: true, changed: false, note: '이미 같은 값입니다' })); await pool.end(); return; }
        const actor = await who(orderId);
        const sets = [], vals = [id]; let i = 1;
        for (const k of Object.keys(after)) { i++; sets.push(k === 'keywords' ? `keywords = $${i}::jsonb` : `${k} = $${i}`); vals.push(k === 'keywords' ? JSON.stringify(after[k]) : after[k]); }
        i++; vals.push(actor.slice(0, 50));
        await pool.query(`UPDATE inquiry_scenarios SET ${sets.join(', ')}, updated_by = $${i}, updated_at = NOW() WHERE id = $1`, vals);
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('update', 'inquiry_scenario', $1, $2, 'desk', $3)`,
            [id, JSON.stringify({ before, after, order_id: orderId, scenario_no: cur.scenario_no, name: cur.name }), actor]);
        console.log(JSON.stringify({ ok: true, changed: true, id, scenario_no: cur.scenario_no, name: cur.name, channel: cur.channel, enabled: 'enabled' in after ? after.enabled : cur.enabled, before, after, note: '톡톡봇 반영까지 최대 5분' }, null, 2));
    } else if (mode === 'add') {
        const file = process.argv[3], orderId = parseInt(process.argv[4], 10) || null;
        if (!file) throw new Error('사용: add <새 시나리오.json> <지시 id>');
        const n = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof n.name !== 'string' || !n.name.trim()) throw new Error('name이 필요합니다');
        if (!CHANNELS.includes(n.channel)) throw new Error('channel은 ' + CHANNELS.join(' / ') + ' 중 하나');
        const kw = checkKeywords(n.keywords), resp = checkText(n.response);
        const enabled = n.enabled === true;
        const dupe = (await pool.query(`SELECT id, scenario_no, name FROM inquiry_scenarios WHERE deleted_at IS NULL AND name = $1`, [n.name.trim()])).rows[0];
        if (dupe) throw new Error(`같은 이름의 시나리오가 있습니다(id ${dupe.id} · ${dupe.scenario_no}번) — edit로 고치세요`);
        const clash = (await pool.query(`SELECT id, scenario_no, name, channel, (SELECT array_agg(k) FROM jsonb_array_elements_text(keywords) k WHERE k = ANY($1::text[])) AS same FROM inquiry_scenarios WHERE deleted_at IS NULL AND enabled = true AND keywords ?| $1::text[]`, [kw])).rows;
        const actor = await who(orderId);
        // 번호: 900번대(운영 규칙·시험용)를 뺀 가장 큰 번호 + 1
        const no = (await pool.query(`SELECT COALESCE(MAX(scenario_no), 0)::int + 1 AS n FROM inquiry_scenarios WHERE scenario_no < 800`)).rows[0].n;
        const r = (await pool.query(
            `INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, enabled, channel, updated_by, updated_at)
             VALUES ($1, $2, $3::jsonb, $4, '자동응답', $5, $6, $7, NOW()) RETURNING id, scenario_no`,
            [no, n.name.trim(), JSON.stringify(kw), resp, enabled, n.channel, actor.slice(0, 50)])).rows[0];
        await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('create', 'inquiry_scenario', $1, $2, 'desk', $3)`,
            [r.id, JSON.stringify({ after: { scenario_no: r.scenario_no, name: n.name.trim(), keywords: kw, response: resp, channel: n.channel, enabled }, order_id: orderId }), actor]);
        console.log(JSON.stringify({ ok: true, id: r.id, scenario_no: r.scenario_no, enabled, keyword_overlap_with_active: clash.map(c => ({ id: c.id, no: c.scenario_no, name: c.name, channel: c.channel, same: c.same })), note: enabled ? '켜진 상태로 만들었습니다 · 톡톡봇 반영까지 최대 5분' : '꺼진 상태로 만들었습니다 — 확인 뒤 edit로 enabled:true' }, null, 2));
    } else throw new Error('사용: show | edit | add');
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

// #720 창구용 — 네이버 상품 상세 문구·그림 · 판매 상태 고치기(1차 · 대표 확정 10/17 · 재고는 2차 = 옵션 재고 통째라)
//   node scripts/desk/naver-detail.js show <상품번호> <지시 id>                  상품 통째 보관(backup) → 요약 + 지금 상세 HTML 을 임시 파일로(경로 출력)
//   node scripts/desk/naver-detail.js plan <backup_id|상품번호> --detail <html> | --status <값>
//                                                                              바뀌는 곳만 전/후 표 + 카드 글(보내지 않음 · 쓰기 0)
//   node scripts/desk/naver-detail.js apply <backup_id> <지시 id> (plan 과 같은 인자)   실행 → 서버가 재조회해 바뀐 경로 대조 → 결과 카드
//   node scripts/desk/naver-detail.js revert <backup_id> <지시 id> [--force]   보관해 둔 전체로 되돌림(적용 뒤 또 바뀐 곳이 있으면 멈춤 · 그래도 덮는 --force 는 관리자 계정 지시만)
//   node scripts/desk/naver-detail.js upload <지시 id> [지시 id …]              지시에 붙은 그림을 네이버에 올려 주소 목록(상세 HTML 에는 이 주소만)
//   길 = 요청 줄 agent_office_config 'naver_product_write_request' → 실서버 20초 틱 → 'naver_product_write_result'(계약 docs/720-write-contract.md).
//        이 도구는 토큰도 네이버 주소도 모른다 — 요청 줄 INSERT 와 결과 읽기, 보관본(naver_product_backups) 읽기뿐.
//   🔴 평일 08:30~10:30(발송 직전)엔 apply·revert 를 하지 않는다(plan 은 됨). 1차 밖 = 재고(옵션 재고)·옵션 가격·옵션명·신규 등록·판매가·대표 이미지.
const path = require('path'), fs = require('fs'), os = require('os');

const REQ_KEY = 'naver_product_write_request', RES_KEY = 'naver_product_write_result';
const TMP = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'naver-detail');
const STATUS_KO = { SALE: '판매중', SUSPENSION: '판매중지', OUTOFSTOCK: '품절' };
// 서버(#720-B NPW_STATUS_MOVES)와 같은 전이표 — 사람이 바꾸는 판매 상태만 · 품절 → 판매중은 재고 입력이 필요해 2차
const STATUS_MOVES = { SALE: ['OUTOFSTOCK', 'SUSPENSION'], OUTOFSTOCK: ['SUSPENSION'], SUSPENSION: ['SALE'], WAIT: ['SUSPENSION'] };
const STATUS_IN = { '판매중': 'SALE', '판매': 'SALE', 'sale': 'SALE', '판매중지': 'SUSPENSION', '중지': 'SUSPENSION', 'suspension': 'SUSPENSION', '품절': 'OUTOFSTOCK', 'outofstock': 'OUTOFSTOCK' };
const won = n => n == null ? '(없음)' : Number(n).toLocaleString('ko-KR');
const stKo = s => s == null ? '(없음)' : (STATUS_KO[s] ? `${STATUS_KO[s]}(${s})` : String(s));

// ── 시각(KST) · 발송 직전 막기
function kstParts(now) { const d = new Date(now + 9 * 3600000); return { dow: d.getUTCDay(), hm: d.getUTCHours() * 60 + d.getUTCMinutes(), text: d.toISOString().replace('T', ' ').slice(0, 16) }; }
function busyWindow(now) { const k = kstParts(now); return k.dow >= 1 && k.dow <= 5 && k.hm >= 8 * 60 + 30 && k.hm < 10 * 60 + 30; }

// ── 인자
function parseOpts(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--detail' || a === '--status' || a === '--stock') o[a.slice(2)] = args[++i];
        else if (a === '--force') o.force = true;
        else rest.push(a);
    }
    return { o, rest };
}
function buildPatch(o) {
    const patch = {}, errs = [];
    if (o.detail != null) {
        const f = String(o.detail);
        if (!fs.existsSync(f)) errs.push('상세 HTML 파일이 없어요: ' + f);
        else { const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); if (!t.trim()) errs.push('상세 HTML 파일이 비었어요'); else patch.detail_html = t; }
    }
    if (o.status != null) { const s = STATUS_IN[String(o.status).trim().toLowerCase()] || STATUS_IN[String(o.status).trim()] || (STATUS_KO[String(o.status).trim().toUpperCase()] ? String(o.status).trim().toUpperCase() : null); if (!s) errs.push('판매 상태는 판매중·판매중지·품절 중 하나예요'); else patch.status = s; }
    // 재고 = 2차(우리 상품은 전부 옵션 상품이라 재고가 옵션마다 따로 · 상품 재고 칸은 네이버가 무시 — docs/720-naver-write-api.md ④)
    if (o.stock != null) errs.push('재고 바꾸기는 아직 창구에서 못 해요(2차) — 지금은 스마트스토어센터에서 옵션별로 직접 해 주세요');
    if (!errs.length && !Object.keys(patch).length) errs.push('바꿀 것을 주세요: --detail <html파일> · --status <판매중|판매중지|품절>');
    return { patch, errs };
}

// ── 상세 HTML 전/후 — 같은 앞·뒤를 걷어 바뀐 가운데만 글자로(태그 뺌)
const plain = s => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function htmlDelta(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return null;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    // 태그 한가운데서 잘리면 「<img src=…」가 글자로 보인다 → 잘리는 자리를 태그 경계까지 넓힌다(앞·뒤가 같은 글이라 두 쪽에 같은 폭)
    const lt = a.lastIndexOf('<', i - 1), gt = a.lastIndexOf('>', i - 1);
    if (i > 0 && lt > gt) i = lt;
    const ea = a.length - j, nGt = a.indexOf('>', ea), nLt = a.indexOf('<', ea);
    if (j > 0 && nGt >= 0 && (nLt < 0 || nGt < nLt)) j = Math.max(0, a.length - (nGt + 1));
    const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
    const imgs = s => (String(s).match(/<img\b[^>]*>/gi) || []).length;
    return { len_before: a.length, len_after: b.length, imgs_before: imgs(a), imgs_after: imgs(b),
        before: cut(plain(a.slice(i, a.length - j)), 160) || '(글자 없음 · 태그만)', after: cut(plain(b.slice(i, b.length - j)), 160) || '(글자 없음 · 태그만)' };
}
// 상세 HTML 의 그림 주소 중 네이버 주소가 아닌 것(upload 로 받은 주소만 넣어야 함)
function foreignImages(html) {
    const out = []; const re = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi; let m;
    while ((m = re.exec(String(html || '')))) { if (!/^https:\/\/([a-z0-9-]+\.)*(pstatic\.net|naver\.net|naver\.com)\//i.test(m[1])) out.push(m[1].slice(0, 120)); }
    return out;
}

// ── 전/후 표·카드 (before = 보관본 JSON · patch = 바꿀 값)
function planRows(before, patch) {
    const op = (before && before.originProduct) || {};
    const rows = [], warns = [], stops = [];
    if ('detail_html' in patch) {
        const d = htmlDelta(op.detailContent, patch.detail_html);
        if (d) rows.push({ field: '상세', before: `${won(d.len_before)}자 · 그림 ${d.imgs_before}장 · 「${d.before}」`, after: `${won(d.len_after)}자 · 그림 ${d.imgs_after}장 · 「${d.after}」` });
        const fi = foreignImages(patch.detail_html);
        if (fi.length) warns.push(`상세 HTML 에 네이버 주소가 아닌 그림 ${fi.length}개 — upload 로 받은 주소로 바꾸세요: ` + fi.slice(0, 3).join(' · '));
        if (d && d.imgs_after < d.imgs_before) warns.push(`그림이 ${d.imgs_before}장 → ${d.imgs_after}장으로 줄어요 — 일부러 뺀 것인지 확인`);
    }
    if ('status' in patch) {
        const cur = op.statusType;
        if (patch.status === cur) stops.push(`이미 ${stKo(cur)} 상태예요`);
        else if (patch.status === 'SALE' && cur === 'OUTOFSTOCK') stops.push('품절 → 판매중은 재고 입력이 필요해 2차예요 — 지금은 스마트스토어센터에서 옵션 재고를 넣어 주세요');
        else if (!(STATUS_MOVES[cur] || []).includes(patch.status)) stops.push(`${stKo(cur)} → ${stKo(patch.status)} 는 바꿀 수 없어요`);
        else {
            rows.push({ field: '판매 상태', before: stKo(cur), after: stKo(patch.status) });
            if (!('detail_html' in patch)) warns.push('상태만 바꿈 · 상세 무접촉');
            const oc = ((((op.detailAttribute || {}).optionInfo || {}).optionCombinations) || []);
            if (patch.status === 'OUTOFSTOCK') warns.push(`품절로 바꾸면 네이버가 재고를 0 으로 만들어요${oc.length ? ` — 옵션 ${oc.length}개 재고가 전부 0 · 원래 재고로 돌리는 길은 revert 뿐(창구에서 「판매중」으로 다시 바꾸기는 2차)` : ''}`);
        }
    }
    return { rows: stops.length ? [] : rows, warns, stops };
}
function card(head, pno, name, rows, extra) {
    const L = [`━━━ 네이버 상품 ${head} ━━━`, `상품: ${name ? name + ' ' : ''}(${pno})`];
    if (!rows.length) L.push('바뀌는 곳 없음 — 지금 값과 같아요');
    for (const r of rows) L.push(`· ${r.field}: ${r.before} → ${r.after}`);
    for (const x of (extra || [])) L.push(x);
    return L.join('\n');
}

// ── 요청 줄 → 결과 (한 칸 · 다른 작업이 걸려 있으면 기다리지 않고 멈춤)
function makeRunner(deps) {
    const { pool, sleep, now } = deps;
    const cfgGet = async k => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [k]); return r.rows.length ? r.rows[0].value : null; };
    async function send(req, ms = 150000) {
        if (await cfgGet(REQ_KEY)) throw new Error('다른 상품 쓰기 요청이 아직 처리 중이에요 — 1분 뒤 다시');
        await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]);
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [REQ_KEY, JSON.stringify(req)]);
        const t0 = now();
        while (now() - t0 < ms) {
            await sleep(5000);
            const v = await cfgGet(RES_KEY);
            if (v && (v.order_id == null || String(v.order_id) === String(req.order_id)) && (!v.op || v.op === req.op)) { await pool.query(`DELETE FROM agent_office_config WHERE key = $1`, [RES_KEY]); return v; }
        }
        throw new Error('상품 쓰기 러너 응답 없음(2분 30초) — 실서버가 깨어 있는지 확인해 주세요(요청 줄은 서버가 깨면 그대로 실행돼요 — 다시 보내지 말고 총괄에게)');
    }
    async function orderBy(orderId) {
        const o = (await pool.query(`SELECT id, created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
        if (!o) throw new Error('없는 지시입니다: ' + orderId);
        return '클코(창구) · ' + (o.created_by || '요청자 미상');
    }
    async function backupRow(arg) {
        const s = String(arg || '').replace(/\D/g, '');
        if (!s) throw new Error('backup_id 또는 상품번호가 필요해요');
        const q = s.length <= 9
            ? await pool.query(`SELECT id, product_no, order_id, before_json, applied_at, reverted_at FROM naver_product_backups WHERE id = $1`, [parseInt(s, 10)])
            : await pool.query(`SELECT id, product_no, order_id, before_json, applied_at, reverted_at FROM naver_product_backups WHERE product_no = $1 AND applied_at IS NULL ORDER BY id DESC LIMIT 1`, [s]);
        const r = q.rows[0];
        if (!r) throw new Error(s.length <= 9 ? `보관본 ${s} 를 못 찾았어요` : `상품 ${s} 의 아직 적용 안 한 보관본이 없어요 — 먼저 show`);
        return Object.assign(r, { before_json: typeof r.before_json === 'string' ? JSON.parse(r.before_json) : r.before_json });
    }
    async function isAdmin(orderId) {
        const r = (await pool.query(`SELECT u.role FROM pending_orders o JOIN users u ON u.id = o.created_by_id AND u.deleted_at IS NULL WHERE o.id = $1`, [orderId])).rows[0];
        return !!r && r.role === 'admin';
    }
    return { send, orderBy, backupRow, isAdmin };
}

async function main(argv, deps) {
    const out = deps.out || (o => console.log(JSON.stringify(o, null, 1)));
    const R = makeRunner(deps);
    const cmd = argv[0], { o, rest } = parseOpts(argv.slice(1));
    const oid = n => { const v = parseInt(n, 10); if (!(v > 0)) throw new Error('지시 id 가 필요해요(누가 시켰는지 기록)'); return v; };

    if (cmd === 'show') {
        const pno = String(rest[0] || '').replace(/\D/g, ''); if (!/^\d{6,}$/.test(pno)) throw new Error('네이버 상품번호를 주세요(스마트스토어 상품 주소 끝 숫자)');
        const orderId = oid(rest[1]);
        const res = await R.send({ op: 'backup', order_id: orderId, product_no: pno, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '보관 실패', code: res.code || null, note: '바꾼 것 없음' });
        const row = await R.backupRow(res.backup_id);
        const op = row.before_json.originProduct || {};
        fs.mkdirSync(TMP, { recursive: true });
        const file = path.join(TMP, `detail_${pno}_b${res.backup_id}.html`);
        fs.writeFileSync(file, String(op.detailContent || ''), 'utf8');
        return out({ ok: true, product_no: pno, backup_id: res.backup_id, summary: res.summary, detail_file: file,
            next: `고친 HTML 을 새 파일로 만든 뒤: node scripts/desk/naver-detail.js plan ${res.backup_id} --detail <새 html>`,
            note: '네이버 상품 전체를 보관했어요(쓰기 0) — 이 backup_id 로 plan → apply' });
    }
    if (cmd === 'plan' || cmd === 'apply') {
        const row = await R.backupRow(rest[0]);
        const { patch, errs } = buildPatch(o);
        if (errs.length) throw new Error(errs.join(' · '));
        const op = row.before_json.originProduct || {};
        const P = planRows(row.before_json, patch);
        const undo = `되돌리기: node scripts/desk/naver-detail.js revert ${row.id} <지시 id>`;
        if (cmd === 'plan') {
            if (P.stops.length) return out({ ok: false, stopped: true, product_no: row.product_no, backup_id: row.id, stops: P.stops, can_apply: false, note: '멈췄어요 — 바꾼 것 없음' });
            if (row.applied_at) P.warns.unshift('이 보관본은 이미 적용했어요 — 다시 바꾸려면 show 로 새로 보관');
            const blocked = busyWindow(deps.now());
            return out({ ok: true, product_no: row.product_no, backup_id: row.id, changes: P.rows, warnings: P.warns, can_apply: P.rows.length > 0 && !row.applied_at,
                time_block: blocked ? '지금은 평일 08:30~10:30(발송 직전)이라 apply 는 10:30 뒤에' : null,
                card: card('수정 계획(아직 안 보냄)', row.product_no, op.name, P.rows, P.warns.map(w => '⚠ ' + w).concat(['이대로 바꿀까요?'])),
                note: '미리 보기 — 아직 아무것도 바꾸지 않았어요' });
        }
        // apply
        const orderId = oid(rest[1]);
        if (row.applied_at) throw new Error('이미 적용한 보관본이에요 — show 로 새로 보관한 뒤 plan → apply');
        if (P.stops.length) return out({ ok: false, stopped: true, stops: P.stops, note: '멈췄어요 — 보낸 것 없음' });
        if (!P.rows.length) return out({ ok: true, changed: false, note: '지금 값과 같아요 — 보낸 것 없음' });
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 10:30 뒤에 같은 명령으로', note: '보낸 것 없음' });
        const res = await R.send({ op: 'apply', order_id: orderId, backup_id: row.id, product_no: row.product_no, patch, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '수정 실패', code: res.code || null, drift_paths: res.drift_paths || undefined,
            note: res.drift_paths ? '보관한 뒤 네이버에서 누가 고쳤어요 — 바꾼 것 없음 · show 로 새로 보관하고 다시 plan' : '네이버가 받지 않았어요 — 바꾼 것 없음일 가능성이 높지만 show 로 지금 값을 확인하세요', undo });
        const bad = (res.unexpected_paths || []), miss = (res.not_applied || []);
        const extra = P.warns.filter(w => /상태만 바꿈/.test(w));
        if (bad.length) extra.push(`🔴 예상 밖으로 바뀐 칸 ${bad.length}곳: ${bad.slice(0, 5).join(' · ')}${bad.length > 5 ? ' …' : ''} — 되돌리기를 권합니다`);
        if (miss.length) extra.push(`⚠ 요청했는데 그대로인 칸: ${miss.map(k => ({ detail_html: '상세', status: '판매 상태', stock: '재고' })[k] || k).join(' · ')}`);
        extra.push(undo);
        return out({ ok: true, changed: true, product_no: row.product_no, backup_id: row.id, changed_paths: res.changed_paths || [], unexpected_paths: bad, not_applied: miss,
            before_summary: res.before_summary, after_summary: res.after_summary, recommend_revert: bad.length > 0,
            card: card(bad.length ? '수정 결과 — 🔴 확인 필요' : '수정 결과', row.product_no, op.name, P.rows, extra),
            note: bad.length ? '바꿨지만 예상 밖 칸도 바뀌었어요 — 답 맨 위에 빨간 줄 그대로 · 되돌리기 권고' : '바꿨어요 — 네이버에서 다시 읽어 바꾼 칸만 달라진 것을 확인했어요' });
    }
    if (cmd === 'revert') {
        const row = await R.backupRow(rest[0]);
        const orderId = oid(rest[1]);
        if (!row.applied_at) throw new Error('아직 적용하지 않은 보관본이에요 — 되돌릴 것이 없어요');
        if (row.reverted_at) throw new Error('이미 되돌린 보관본이에요');
        if (busyWindow(deps.now())) return out({ ok: false, stopped: true, why: '평일 08:30~10:30(발송 직전)엔 바꾸지 않아요 — 급하면 총괄에게', note: '보낸 것 없음' });
        if (o.force === true && !(await R.isAdmin(orderId))) throw new Error('--force(네이버에서 그 뒤 바뀐 것까지 덮기)는 관리자 계정 지시만 돼요 — 관리자에게 확인을 받아 주세요');
        const res = await R.send({ op: 'revert', order_id: orderId, backup_id: row.id, product_no: row.product_no, force: o.force === true, created_by: await R.orderBy(orderId) });
        if (!res.ok) return out({ ok: false, error: res.error || '되돌리기 실패', drift_paths: res.drift_paths || undefined,
            note: res.drift_paths ? '적용한 뒤 네이버에서 또 바뀐 곳이 있어요 — 그 칸(drift_paths)을 요청자에게 보여 주고 「그래도 되돌려」면 --force' : '되돌리지 못했어요 — 총괄에게' });
        const name = (row.before_json.originProduct || {}).name;
        return out({ ok: true, product_no: row.product_no, backup_id: row.id, same_as_before: !!res.same_as_before, residual_paths: res.residual_paths || [],
            card: card('되돌리기 결과', row.product_no, name, [], [res.same_as_before ? '보관해 둔 그대로 돌아왔어요(다시 읽어 확인)' : `⚠ 보관본과 아직 다른 칸 ${(res.residual_paths || []).length}곳: ${(res.residual_paths || []).slice(0, 5).join(' · ')}`]),
            note: res.same_as_before ? '되돌렸어요' : '되돌렸지만 다른 칸이 남았어요 — 총괄에게' });
    }
    if (cmd === 'upload') {
        const ids = rest.map(n => parseInt(n, 10)).filter(n => n > 0);
        if (!ids.length) throw new Error('그림이 붙은 지시 id 를 주세요');
        const res = await R.send({ op: 'upload_image', order_id: ids[0], order_ids: ids, created_by: await R.orderBy(ids[0]) });
        if (!res.ok && !(res.urls || []).length) return out({ ok: false, error: res.error || '그림 올리기 실패', code: res.code || null });
        return out({ ok: !!res.ok, urls: res.urls || [], error: res.error || undefined,
            html: (res.urls || []).map(u => `<img src="${u}" alt="">`), note: '상세 HTML 에는 이 주소만 넣어요(다른 사이트 주소 금지)' });
    }
    throw new Error('명령: show · plan · apply · revert · upload');
}

module.exports = { main, makeRunner, planRows, htmlDelta, foreignImages, buildPatch, busyWindow, card, REQ_KEY, RES_KEY };

if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)))
        .finally(() => pool.end().catch(() => { }));
}

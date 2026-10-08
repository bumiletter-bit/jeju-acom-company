// #588 창구용 자사몰 도구 공용(mall-guide · mall-price · mall-sync) — 스킨 정본·서버 파일 대조·카페24 러너·실화면 확인
//   정본 = _참고자료/카페24스킨백업/scripts/skin6-work-final/index.html (apply-428-skin.js 가 쓰는 그 파일 · 저장소 밖)
//   서버 = /sde_design/skin6/index.html (SFTP · 접속 값은 .env CAFE24_FTP_* — 코드에 적지 않는다) · 올리기는 이 한 파일만
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { pool, ROOT } = require('./_db');
const NM = n => require(path.join(ROOT, 'node_modules', n));
const SKIN_DIR = path.join(ROOT, '_참고자료', '카페24스킨백업', 'scripts', 'skin6-work-final');
const FILE = path.join(SKIN_DIR, 'index.html');
const REMOTE = '/sde_design/skin6/index.html';
const TMP = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'mall-tmp');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);

// ── 스킨 정본의 STORE_DATA 한 줄
function storeData(src) {
    const lines = src.split('\n');
    const li = lines.findIndex(l => l.startsWith('<script>window.STORE_DATA = '));
    if (li < 0) throw new Error('정본에서 STORE_DATA 줄을 못 찾았어요');
    const L = lines[li], i0 = L.indexOf('{'), i1 = L.lastIndexOf('}');
    return { lines, li, L, i0, i1, D: JSON.parse(L.slice(i0, i1 + 1)) };
}
const readLocal = () => fs.readFileSync(FILE);

// ── SFTP(읽기 = 서버 원본 받기 · 쓰기 = index.html 한 파일)
async function sftpOpen() {
    const e = process.env;
    if (!e.CAFE24_FTP_HOST || !e.CAFE24_FTP_USER || !e.CAFE24_FTP_PASS) throw new Error('스킨 서버 접속 값(.env CAFE24_FTP_*)이 없어요 — 총괄에게 알려 주세요');
    const Client = NM('ssh2-sftp-client'); const c = new Client();
    await c.connect({ host: e.CAFE24_FTP_HOST, port: parseInt(e.CAFE24_FTP_PORT || '3822', 10), username: e.CAFE24_FTP_USER, password: e.CAFE24_FTP_PASS, readyTimeout: 20000 });
    return c;
}
async function serverGet() { const c = await sftpOpen(); try { return await c.get(REMOTE); } finally { await c.end().catch(() => { }); } }
// 올리고 → 다시 받아 바이트가 같은지까지
async function serverPut(buf) {
    if (!REMOTE.startsWith('/sde_design/skin6/')) throw new Error('안전 가드: skin6 밖은 올리지 않아요');
    const c = await sftpOpen();
    try { await c.put(buf, REMOTE); const back = await c.get(REMOTE); return { size: back.length, same: sha(back) === sha(buf) }; } finally { await c.end().catch(() => { }); }
}
// 서버 원본 = 로컬 정본인가(다르면 상대 세션이 최신 — 덮지 않는다)
async function serverMatches() {
    const local = readLocal(), srv = await serverGet();
    return { same: sha(local) === sha(srv), local: { size: local.length, sha: sha(local).slice(0, 12) }, server: { size: srv.length, sha: sha(srv).slice(0, 12) } };
}
function backupTo(tag) {
    const f = path.join(SKIN_DIR, `index_pre${tag}_backup.html`);
    if (fs.existsSync(f)) throw new Error(`백업 파일이 이미 있어요(${path.basename(f)}) — 같은 지시로 두 번 실행한 것 같아요. 지우지 말고 총괄에게 알려 주세요`);
    fs.copyFileSync(FILE, f); return f;
}

// ── 지시·기록
async function who(orderId) {
    if (!orderId) throw new Error('지시 id 가 필요합니다(누가 시켰는지 기록)');
    const o = (await pool.query(`SELECT created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
    if (!o) throw new Error('없는 지시입니다');
    return '클코(창구) · ' + (o.created_by || '요청자 미상');
}
// target_id 칸은 정수 — 정수가 아닌 값(키 글자·상품번호 묶음)은 changes.target 으로 옮기고 칸은 비운다
async function audit(action, type, id, changes, actor) {
    const isInt = id != null && /^\d{1,9}$/.test(String(id));
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ($1,$2,$3,$4,'desk',$5)`, [action, type, isInt ? parseInt(id, 10) : null, JSON.stringify(isInt || id == null ? changes : Object.assign({ target: String(id) }, changes)), actor]).catch(e => console.error('audit 실패(무시):', e.message));
}
async function cfgGet(key) { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [key]); return r.rows.length ? r.rows[0].value : null; }
async function cfgSet(key, value) { await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]); }
async function stepLog(orderId, text) {
    if (!orderId) return;
    try { const o = (await pool.query(`SELECT run_id FROM pending_orders WHERE id = $1`, [orderId])).rows[0]; if (o && o.run_id) await pool.query(`UPDATE agent_runs SET steps = steps || $2::jsonb WHERE id = $1`, [o.run_id, JSON.stringify([{ t: new Date().toISOString(), kind: 'work', actor: '클코', text: String(text).slice(0, 300) }])]); } catch (_) { }
}

// ── 카페24 러너(열쇠는 실서버에만 · 요청 → 60초 틱 → 결과) — apply-534-c24.js 와 같은 길
async function c24(req, ms = 150000) {
    await pool.query(`DELETE FROM agent_office_config WHERE key = 'cafe24_product_result'`);
    await cfgSet('cafe24_product_request', req);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await sleep(4000); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'cafe24_product_result'`); if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key = 'cafe24_product_result'`); return q.rows[0].value; } }
    throw new Error('카페24 러너 응답 없음(2분 30초) — 실서버가 깨어 있는지 확인해 주세요');
}
const c24Ok = r => !!r && r.ok !== false && !!r.raw && r.raw.ok !== false && !(Number(r.raw.status) >= 400) && !(r.raw.data && r.raw.data.error);
async function c24Product(cno) {
    const pr = await c24({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}`, query: { fields: 'product_no,product_name,price,selling,display' } });
    if (!c24Ok(pr)) throw new Error(`카페24 c${cno} 조회 실패: ` + JSON.stringify(pr).slice(0, 160));
    const vr = await c24({ action: 'raw', method: 'GET', path: `/api/v2/admin/products/${cno}/variants`, query: { limit: 100 } });
    if (!c24Ok(vr)) throw new Error(`카페24 c${cno} 옵션 조회 실패: ` + JSON.stringify(vr).slice(0, 160));
    const p = pr.raw.data.product;
    return { cno, name: p.product_name, base: Math.round(Number(p.price)), selling: p.selling, display: p.display,
        vars: (vr.raw.data.variants || []).map(v => ({ code: v.variant_code, name: (v.options || []).map(o => o.value).join(' / '), add: Math.round(Number(v.additional_amount)), selling: v.selling, display: v.display })) };
}
async function latestSnapshot() {
    const r = (await pool.query(`SELECT id, items, to_char(run_at + interval '9 hours','MM-DD HH24:MI') AS kst, ROUND(EXTRACT(EPOCH FROM (NOW() - run_at)) / 60) AS age_min FROM naver_product_snapshot ORDER BY id DESC LIMIT 1`)).rows[0];
    if (!r) throw new Error('네이버 스냅샷이 없어요');
    return { id: r.id, kst: r.kst, ageMin: Number(r.age_min), items: Array.isArray(r.items) ? r.items : JSON.parse(r.items) };
}

// ── 실화면(akkome.com) — 캐시를 피해 열고 STORE_DATA·안내문 탭을 읽는다. 스킨을 올린 뒤 약 10분은 옛 파일이 섞여 올 수 있다
async function liveRead(no) {
    const { chromium, devices } = NM('playwright');
    const b = await chromium.launch();
    try {
        const pg = await (await b.newContext(devices['iPhone 13'])).newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 100)));
        await pg.goto(`https://akkome.com/?v=desk${Date.now()}#p/${no}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await pg.waitForSelector('.pd-dim.show', { timeout: 25000 }); await pg.waitForTimeout(1500);
        const r = await pg.evaluate(n => {
            const d = document.querySelector('.pd-dim.show'), t = d.querySelector('.pd-tab[data-pane="guide"]'); let guide = null;
            if (t) { t.click(); const g = d.querySelector('.pd-guide'); guide = g && g.getClientRects().length ? g.innerText : null; }
            const it = ((window.STORE_DATA || {}).items || []).find(x => String(x.no) === String(n));
            const det = ((window.STORE_DATA || {}).detailImages || {})[String(n)];
            return { guide, opts: it ? (it.opts || []).map(o => ({ n1: o.n1, n2: o.n2, nd: o.nd, price: o.price })) : null, disc: it ? it.discPrice : null, detBlocks: det && det.blocks ? det.blocks.length : null, rows: d.querySelectorAll('[data-pane-body="opt"] .opt-row').length };
        }, no);
        r.errs = errs; return r;
    } finally { await b.close(); }
}

module.exports = { pool, ROOT, NM, SKIN_DIR, FILE, REMOTE, TMP, sha, sleep, kstNow, storeData, readLocal, serverGet, serverPut, serverMatches, backupTo, who, audit, cfgGet, cfgSet, stepLog, c24, c24Ok, c24Product, latestSnapshot, liveRead };

// ── 네이버 정본(실시간) — 읽기 전용 상품 조회 러너(60초 틱). 실패하면 부르는 쪽이 스냅샷으로 물러난다
async function naverLive(nos) {
    await pool.query(`DELETE FROM agent_office_config WHERE key = 'naver_query_result'`);
    await cfgSet('naver_query_request', { calls: nos.map(no => ({ method: 'GET', path: `/external/v2/products/channel-products/${no}` })) });
    const t0 = Date.now(); let res = null;
    while (Date.now() - t0 < 150000) { await sleep(5000); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'naver_query_result'`); if (q.rows.length) { res = q.rows[0].value; await pool.query(`DELETE FROM agent_office_config WHERE key = 'naver_query_result'`); break; } }
    if (!res || !Array.isArray(res.results)) throw new Error('네이버 조회 러너 응답 없음');
    const out = {};
    for (const no of nos) {
        const r = res.results.find(x => String(x.path || '').endsWith('/' + no));
        if (!r || !r.ok) throw new Error(`네이버 ${no} 조회 실패: ` + String((r && r.error) || '응답 없음').slice(0, 120));
        const op = JSON.parse(r.data_str).originProduct;
        const dm = (((op.customerBenefit || {}).immediateDiscountPolicy || {}).discountMethod) || null;
        if (dm && dm.unitType && dm.unitType !== 'WON') throw new Error(`네이버 ${no} 즉시할인이 원 단위가 아니에요(${dm.unitType}) — 계산하지 않고 멈춥니다`);
        const disc = op.salePrice - (dm ? Number(dm.value) || 0 : 0);
        const oc = (((op.detailAttribute || {}).optionInfo || {}).optionCombinations) || [];
        out[no] = { no, name: op.name, statusType: op.statusType, discPrice: disc, optsNone: !oc.length, opts: oc.map(o => ({ n1: o.optionName1 || '', n2: o.optionName2 || '', price: Number(o.price) || 0, usable: o.usable !== false, stock: o.stockQuantity })) };
    }
    return out;
}
module.exports.naverLive = naverLive;

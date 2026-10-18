// #612 전체 가격 확인(창구 도구) — 사용: node scripts/desk/price-check.js [--text|--json] [--all] [--mall] [--coupang]
//   네이버 상품 페이지 전부(새벽 스냅샷)와 자사몰의 같은 옵션 결제가를 한 표로 견준다. 계산은 저장소 맨 위 price-check.js(서버와 같은 모듈)가 한다.
//   기본 = 네이버 페이지끼리 + 자사몰은 서버가 마지막으로 적어 둔 자료(agent_office_config 'price_check_last' · 12시간 안의 것)가 있으면 그것 — 쓰기 0 · 외부 호출 0.
//   --mall = 지금 팔고 있고 네이버와 연결된 자사몰 상품을 카페24 러너로 새로 읽는다(mall-price.js 와 같은 길 · 읽기 조회만 · 상품당 약 25초 · 다른 자사몰 지시와 겹치면 느려진다).
//   --all  = 값이 같은 묶음(여러 페이지에 걸린 옵션)도 같이 적는다 · --json = 보고 JSON 그대로.
//   🔴 네이버 값은 「오늘 새벽 스냅샷」이다 — 오늘 낮에 바꾼 값은 내일 새벽 뒤에 보인다.
//   쿠팡(#741·#746) = 서버가 적어 둔 쿠팡 값(price_check_last.coupang · 12시간 안 · 가격 카드를 열 때 적힘)이 있으면 그것 · 없거나 낡았으면(또는 --coupang) 쿠팡 상품 러너(op list · 읽기만 · 상품 이름마다 한 번 · 약 2~4분)로 연결표 옵션을 지금 읽는다 · 글 표 끝에 「쿠팡 n개」 표(늘)
const path = require('path');
const PC = require(path.join(__dirname, '..', '..', 'price-check.js'));
const { pool } = require('./_db');
const args = process.argv.slice(2); const has = f => args.includes(f);
// #746 쿠팡 연결표 옵션 지금 값 — 상품 이름으로 op list(읽기만 · 상품마다 옵션 inventories · 서버 20초 틱) → 못 찾은 옵션은 「목록에 없음」
async function readCoupangNow(map, deps) {
    const CI = require('./coupang-item.js'); const R = CI.makeRunner(Object.assign({ pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() }, deps || {}));
    const want = Object.entries(map).filter(([vid, e]) => /^\d{1,15}$/.test(vid) && e && !e.ignore);
    const byProd = new Map(); for (const [vid, e] of want) { const k = String(e.seller_product_id || e.product_name || vid); if (!byProd.has(k)) byProd.set(k, { q: String(e.product_name || '').slice(0, 50), vids: [] }); byProd.get(k).vids.push(vid); }
    const got = new Map();
    for (const [, p] of byProd) {
        if (p.vids.every(v => got.has(v)) || !p.q) continue;
        const res = await R.send({ op: 'list', q: p.q, created_by: '창구 전체 가격 확인(#746)' });
        if (!res || !res.ok) throw new Error('쿠팡 목록 조회 실패: ' + ((res && (res.error || res.note)) || '응답 없음'));
        for (const pr of (res.products || [])) for (const it of (pr.vendorItems || [])) got.set(String(it.vendorItemId), it);
    }
    return want.map(([vid, e]) => { const it = got.get(vid); const row = Object.assign({ vid }, e);
        if (!it || it.salePrice == null) { row.price = null; row.stock = null; row.on_sale = null; row.error = it ? '값 없음' : '목록에 없음'; }
        else { row.price = Number(it.salePrice); row.stock = it.quantity != null ? Number(it.quantity) : null; row.on_sale = it.saleStatus === 'ON_SALE' ? true : it.saleStatus === 'STOP' ? false : null; }
        return row; });
}
(async () => {
    const opt = { pool };
    if (has('--mall')) {
        const M = require('./_mall.js');
        const snap = await M.latestSnapshot(); const map = ((await M.cfgGet('cafe24_sync_map')) || {}).map || {};
        const want = snap.items.filter(it => it.statusType === 'SALE' && map[String(it.no)]).map(it => Number(map[String(it.no)].c24));
        const list = []; for (const cno of want) { try { list.push(await M.c24Product(cno)); } catch (e) { list.push({ cno, name: 'c' + cno, base: null, selling: '?', display: '?', vars: null, error: String(e.message).slice(0, 100) }); } }
        opt.c24Products = list;
    } else {
        const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'price_check_last'`);
        const v = r.rows.length ? r.rows[0].value : null;
        if (v && Array.isArray(v.mall) && v.at && Date.now() - Date.parse(v.at) < 12 * 3600e3) opt.c24Products = v.mall;
    }
    {   // #741 쿠팡 = 서버가 적어 둔 값(12시간 안) · 그 뒤 연결표에서 뺀 옵션은 빼고 넣음 · 판단은 모듈
        // #746 없거나 12시간 넘었으면(또는 --coupang) 쿠팡 상품 러너(op list · 읽기만)로 연결표 옵션을 지금 읽는다
        const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'price_check_last'`); const v = r.rows.length ? r.rows[0].value : null;
        const at = v && (v.coupang_at || v.at);
        const m = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'coupang_item_map'`); const map = (m.rows.length && m.rows[0].value) || {};
        if (!has('--coupang') && v && Array.isArray(v.coupang) && at && Date.now() - Date.parse(at) < 12 * 3600e3) {
            opt.coupangItems = v.coupang.filter(x => x && map[String(x.vid)] && !map[String(x.vid)].ignore).map(x => { const e = map[String(x.vid)]; return Object.assign({}, x, { bot_product_id: e.bot_product_id, label: e.label, separate: e.separate }); });   // 짝 칸은 지금 연결표
            opt.coupangFrom = `서버가 ${Math.round((Date.now() - Date.parse(at)) / 60000)}분 전 읽은 값`;
        } else if (Object.keys(map).some(k => map[k] && !map[k].ignore)) {
            try { opt.coupangItems = await readCoupangNow(map); opt.coupangFrom = '방금 쿠팡에서 읽음(러너)'; }
            catch (e) { opt.coupangItems = null; console.error('[쿠팡 지금 읽기 실패] ' + String(e && e.message || e).slice(0, 200)); }
        }
    }
    const rep = await PC.build(opt);
    console.log(has('--json') ? JSON.stringify(rep, null, 1) : PC.toText(rep, { all: has('--all'), coupang: true }));   // #746 쿠팡 열 늘
    await pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) })); try { await pool.end(); } catch (_) { } process.exit(1); });

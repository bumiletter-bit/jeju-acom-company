// #612 전체 가격 확인(창구 도구) — 사용: node scripts/desk/price-check.js [--text|--json] [--all] [--mall]
//   네이버 상품 페이지 전부(새벽 스냅샷)와 자사몰의 같은 옵션 결제가를 한 표로 견준다. 계산은 저장소 맨 위 price-check.js(서버와 같은 모듈)가 한다.
//   기본 = 네이버 페이지끼리 + 자사몰은 서버가 마지막으로 적어 둔 자료(agent_office_config 'price_check_last' · 12시간 안의 것)가 있으면 그것 — 쓰기 0 · 외부 호출 0.
//   --mall = 지금 팔고 있고 네이버와 연결된 자사몰 상품을 카페24 러너로 새로 읽는다(mall-price.js 와 같은 길 · 읽기 조회만 · 상품당 약 25초 · 다른 자사몰 지시와 겹치면 느려진다).
//   --all  = 값이 같은 묶음(여러 페이지에 걸린 옵션)도 같이 적는다 · --json = 보고 JSON 그대로.
//   🔴 네이버 값은 「오늘 새벽 스냅샷」이다 — 오늘 낮에 바꾼 값은 내일 새벽 뒤에 보인다. 쿠팡은 제외(가격 조회 길 없음).
const path = require('path');
const PC = require(path.join(__dirname, '..', '..', 'price-check.js'));
const { pool } = require('./_db');
const args = process.argv.slice(2); const has = f => args.includes(f);
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
    const rep = await PC.build(opt);
    console.log(has('--json') ? JSON.stringify(rep, null, 1) : PC.toText(rep, { all: has('--all') }));
    await pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) })); try { await pool.end(); } catch (_) { } process.exit(1); });

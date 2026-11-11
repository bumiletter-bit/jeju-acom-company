/* #1111-B 회사 알림 「종류 → 받는 사람」 (대표 11/11 · 관리자가 정함 · 1차 = 설정 값 · 관리자 화면 표는 2차)
 *
 *   설정 agent_office_config 'notify_routes' = { "<알림 type>": [user id, …], … }
 *     예) { "rank_alert": [민주], "price_alert": [민주], "cs_stale": [지현, 승협], "cs_material": [지현, 승협], "cs_claim_brief": [지현], "settle_error": [가영], "settle_recon": [가영] }
 *   규칙
 *     · 설정에 그 type 칸이 없으면 = 종전 받는 사람 그대로(무회귀 · routeIds(type, 종전) → 종전)
 *     · 칸이 있으면 = 그 목록(빈 배열 = 아무에게도 안 보냄 · 숫자 아닌 값·중복은 버림)
 *     · 본인 건(결재·연차·급여·지시 결과 = 신청자·요청자에게 가는 것)은 이 칸으로 바꾸지 않는다 — 장착하는 쪽이 그런 type 에는 부르지 않는다
 *   읽기는 60초 기억(설정을 바꾸면 1분 안에 반영) · 읽기 실패 = 종전 그대로
 *
 *   쓰는 법(server.js 장착 = 총괄 「장착 고」 뒤)
 *     const routes = require('./notify-routes.js')({ pool });
 *     const ids = await routes.routeIds('settle_recon', admins.map(a => a.id));   // 종전 받는 사람을 넘기면 설정이 있을 때만 바뀐다
 */
'use strict';

const CFG_KEY = 'notify_routes';
const TTL_MS = 60000;

// 순수 함수 — 설정 값(routes) · type · 종전 ids → 받을 ids
function pickIds(routes, type, fallback) {
    const base = Array.isArray(fallback) ? fallback : (fallback == null ? [] : [fallback]);
    if (!routes || typeof routes !== 'object' || Array.isArray(routes)) return base;
    if (!Object.prototype.hasOwnProperty.call(routes, type)) return base;
    const list = routes[type];
    if (!Array.isArray(list)) return base;   // 꼴이 틀린 칸 = 없는 것과 같게(종전 그대로)
    const out = [];
    for (const v of list) { const n = Number(v); if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n); }
    return out;
}

module.exports = function notifyRoutes(deps) {
    const pool = deps && deps.pool;
    let cache = null;   // { at, value }
    async function load() {
        if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
        let value = null;
        try {
            const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [CFG_KEY]);
            value = r.rows.length ? r.rows[0].value : null;
        } catch (e) { if (deps && deps.log) deps.log.error('[알림 받는 사람] 설정 읽기 실패(종전 그대로):', e.message); return cache ? cache.value : null; }
        cache = { at: Date.now(), value };
        return value;
    }
    return {
        load,
        routeIds: async (type, fallback) => pickIds(await load(), type, fallback),
        has: async (type) => { const v = await load(); return !!(v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, type)); },
        drop: () => { cache = null; },
    };
};
module.exports.pickIds = pickIds;
module.exports.CFG_KEY = CFG_KEY;

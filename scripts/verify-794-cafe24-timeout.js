// #794-B cafe24.js fetch 시간 제한 검증 — 가짜 fetch 무응답 → 짧은 제한 뒤 실패 · 토큰 락 풀림 · 쓰기 재시도 0(실호출 0 · 실DB 0)
process.env.CAFE24_API_TIMEOUT_MS = '300';
process.env.CAFE24_TOKEN_TIMEOUT_MS = '250';
process.env.CAFE24_CLIENT_SECRET = 'test-secret-794';
const C = require('../cafe24.js');
let pass = 0, failN = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✅ ' + name); } else { failN++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };

const store = new Map();
const pool = { query: async (sql, args) => {
    if (/^INSERT INTO agent_office_config/.test(sql.trim())) { store.set('cafe24_tokens', JSON.parse(args[0])); return { rows: [] }; }
    if (/SELECT value FROM agent_office_config WHERE key = 'cafe24_tokens'/.test(sql)) return { rows: store.has('cafe24_tokens') ? [{ value: store.get('cafe24_tokens') }] : [] };
    return { rows: [] };
} };
const notes = [];
C.init({ pool, notify: async (t) => { notes.push(t); } });

let calls = [], mode = 'ok', tokenBody = null;
const hangUntilAbort = (opt) => new Promise((res, rej) => { if (opt && opt.signal) opt.signal.addEventListener('abort', () => rej(opt.signal.reason)); });
global.fetch = async (url, opt) => {
    calls.push({ url: String(url).replace(/^https:\/\/[^/]+/, ''), method: (opt && opt.method) || 'GET', hasSignal: !!(opt && opt.signal) });
    if (mode === 'ok') return { status: 200, ok: true, text: async () => JSON.stringify(tokenBody || { ok: 1 }) };
    if (mode === 'hang') return hangUntilAbort(opt);
    if (mode === 'bodyhang') return { status: 200, ok: true, text: () => hangUntilAbort(opt) };
    throw new Error('모드?');
};
const t0 = () => Date.now();
setInterval(() => { }, 1000);   // AbortSignal.timeout 타이머는 프로세스를 붙잡지 않아 시험 혼자면 기다리다 끝나 버림(서버는 다른 타이머가 늘 돎) — 끝은 process.exit

(async () => {
    console.log('① 토큰 저장(가짜 승인 응답 · 만료 지난 토큰)');
    tokenBody = { access_token: 'AT1', refresh_token: 'RT1', expires_at: '2020-01-01T00:00:00.000' };
    await C.exchangeCode('code-x');
    ok(store.has('cafe24_tokens'), '가짜 승인으로 토큰 저장됨(암호화)');
    ok(calls[0] && calls[0].hasSignal, '토큰 요청 fetch 에 시간 제한 신호가 붙음');

    console.log('\n② 토큰 갱신 무응답 → 0.25초 뒤 「일시 오류」 · 락 풀림');
    calls = []; mode = 'hang';
    let s = t0(), e1 = null;
    try { await C.getToken(); } catch (e) { e1 = e; }
    const took = t0() - s;
    ok(e1 && e1.code === 'temp' && /cafe24_token_temp/.test(e1.message), '실패 = 일시 오류(재승인 아님)', e1 && { code: e1.code, msg: e1.message, reason: e1.reason });
    ok(e1 && /응답 없음/.test(e1.reason || ''), '사유 = 「카페24 응답 없음(n초)」', e1 && e1.reason);
    ok(took >= 200 && took < 2000, '시간 제한 근처에서 끝남 · ' + took + 'ms');
    ok(notes.some(n => /일시 오류/.test(n)), '알림 = 「토큰 갱신 일시 오류 — 자동 재시도 중」(재승인 알림 아님)', notes);
    calls = []; mode = 'ok'; tokenBody = { access_token: 'AT2', refresh_token: 'RT2', expires_at: '2099-01-01T00:00:00.000' };
    const tok = await C.getToken();
    ok(tok === 'AT2' && calls.length === 1 && /oauth\/token/.test(calls[0].url), '다음 호출 = 락이 풀려 새로 갱신(옛 락 대기 0)', { tok, calls });

    console.log('\n③ 조회(GET) 무응답 → 0.3초 뒤 실패 · 재시도 0');
    calls = []; mode = 'hang'; s = t0();
    let e2 = null; try { await C.apiGet('/api/v2/admin/products', { limit: 1 }); } catch (e) { e2 = e; }
    ok(e2 && e2.code === 'timeout' && e2.message === 'cafe24_timeout', 'GET = cafe24_timeout', e2 && e2.message);
    ok(calls.length === 1, 'fetch 1번(429·5xx 재시도 길을 타지 않음)', calls.length);
    ok(t0() - s < 2000, '시간 · ' + (t0() - s) + 'ms');

    console.log('\n④ 쓰기(PUT) 무응답 → 실패 · 자동 재시도 0(두 번 반영 위험 없음)');
    calls = []; mode = 'hang';
    let e3 = null; try { await C.apiReq('PUT', '/api/v2/admin/products/120', { request: { x: 1 } }); } catch (e) { e3 = e; }
    ok(e3 && e3.code === 'timeout', 'PUT = cafe24_timeout', e3 && e3.message);
    ok(calls.length === 1 && calls[0].method === 'PUT', 'PUT 은 한 번만 보냄', calls);

    console.log('\n⑤ 응답 머리는 왔는데 본문이 안 옴 → 같은 시간 제한으로 실패');
    calls = []; mode = 'bodyhang';
    let e4 = null; try { await C.apiGet('/api/v2/admin/orders', {}); } catch (e) { e4 = e; }
    ok(e4 && e4.code === 'timeout', '본문 대기도 cafe24_timeout', e4 && e4.message);

    console.log('\n⑥ 정상 응답은 그대로');
    calls = []; mode = 'ok'; tokenBody = { orders: [] };
    const d = await C.apiGet('/api/v2/admin/orders', {});
    ok(d && Array.isArray(d.orders) && calls.length === 1, '정상 GET 결과 그대로', d);

    console.log('\n⑦ 쓰기 재시도 = 429 만(5xx 는 바로 실패 · 두 번 반영 방지)');
    {
        const seq = (codes) => { let i = 0; global.fetch = async (url, opt) => { calls.push({ method: (opt && opt.method) || 'GET' }); const st = codes[Math.min(i++, codes.length - 1)]; return { status: st, ok: st < 400, text: async () => JSON.stringify(st < 400 ? { done: 1 } : { error: { message: 'x' } }) }; }; };
        calls = []; seq([500, 200]);
        let e5 = null; try { await C.apiReq('PUT', '/api/v2/admin/products/120', { request: {} }); } catch (e) { e5 = e; }
        ok(e5 && e5.status === 500 && calls.length === 1, 'PUT 5xx → fetch 1회 · 바로 실패(cafe24_api_500)', { msg: e5 && e5.message, n: calls.length });
        calls = []; seq([503, 200]);
        let e6 = null; try { await C.apiReq('POST', '/api/v2/admin/x', { request: {} }); } catch (e) { e6 = e; }
        ok(e6 && e6.status === 503 && calls.length === 1, 'POST 5xx → fetch 1회 · 실패', calls.length);
        calls = []; seq([429, 200]);
        const r7 = await C.apiReq('PUT', '/api/v2/admin/products/120', { request: {} });
        ok(r7 && r7.done === 1 && calls.length === 2, 'PUT 429 → 1초 뒤 재시도해 성공(fetch 2회)', { r7, n: calls.length });
        calls = []; seq([500, 200]);
        const r8 = await C.apiGet('/api/v2/admin/orders', {});
        ok(r8 && r8.done === 1 && calls.length === 2, 'GET 5xx → 종전처럼 재시도(fetch 2회)', { r8, n: calls.length });
        calls = []; seq([502, 200]);
        const r9 = await C.apiReq('GET', '/api/v2/admin/products/120/options', null);
        ok(r9 && r9.done === 1 && calls.length === 2, 'apiReq 로 부른 GET 도 5xx 재시도 그대로', calls.length);
    }

    console.log('\n결과 ' + pass + '/' + (pass + failN));
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

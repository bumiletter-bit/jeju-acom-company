// #805 검증 — 1분 러너 4개(aligo_test_send #803 · kakao_backfill · cafe24_points · cafe24_product)의 요청 줄 읽기가 실패해도 결과 줄을 안 쓰는지 · 요청 있으면 종전처럼 결과 줄을 쓰는지
//   server.js 에서 그 setInterval 본문을 떼어 가짜 함수로 실행(실DB·실발송·카페24 0) — 본문 안의 다른 이름은 「부르면 stub 오류」로 대신해 catch 결과 줄 길까지 본다
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + JSON.stringify(d).slice(0, 300) : '')); };
function bodyOf(key) {
    const at = src.indexOf(`naverCfgGet('${key}')`); if (at < 0) throw new Error('없음 ' + key);
    const st = src.lastIndexOf('setInterval(async () => {', at); const open = src.indexOf('{', st);
    let d = 0, i = open;
    for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) break; } else if (ch === '`') { i = src.indexOf('`', i + 1); } }
    return src.slice(open + 1, i);
}
(async () => {
    for (const [key, res] of [['aligo_test_send_request', 'aligo_test_send_result'], ['kakao_backfill_request', 'kakao_backfill_result'], ['cafe24_points_request', 'cafe24_points_result'], ['cafe24_product_request', 'cafe24_product_result']]) {
        console.log('▶ ' + key);
        const body = bodyOf(key);
        ok(/let req;\s*\n\s*try \{ req = await naverCfgGet\(/.test(body) && /요청 읽기 실패\(다음 주기\)/.test(body), '요청 읽기 = try 밖 별도 try · 실패 로그 한 줄');
        const run = async (cfgGet) => {
            const writes = [], errs = [];
            const stub = new Proxy({}, { has: (t, k) => !['naverCfgGet', 'naverCfgSet', 'pool', 'console', 'process', 'String', 'JSON', 'Date', 'Number', 'Math', 'Array', 'Object', 'Promise', 'setTimeout', 'Set', 'Map', 'Error', 'Boolean', 'RegExp', 'parseInt', 'undefined', 'Buffer', 'encodeURIComponent'].includes(k),
                get: (t, k) => k === Symbol.unscopables ? undefined : (() => { throw new Error('stub ' + String(k)); }) });
            const F = new Function('stub', 'naverCfgGet', 'naverCfgSet', 'pool', 'console', 'process', `with (stub) { return (async () => {${body}})(); }`);
            await F(stub, cfgGet, async (k, v) => { writes.push([k, v]); }, { query: async () => ({ rows: [], rowCount: 0 }) },
                { error: (...a) => errs.push(a.join(' ')), log: () => { } }, { env: { RENDER: '1' } });
            return { writes, errs };
        };
        const a = await run(async () => { throw new Error('Connection terminated due to connection timeout'); });
        ok(a.writes.length === 0 && a.errs.some(x => /요청 읽기 실패/.test(x)), '읽기 실패 = 결과 줄 0 · 로그만', a);
        const b = await run(async () => null);
        ok(b.writes.length === 0 && b.errs.length === 0, '요청 없음 = 조용히 끝', b);
        const c = await run(async () => ({ go: 'yes', mode: 'preview', action: 'list', rid: 'r1', to: '01000000000', key: 'x' }));
        ok(c.writes.some(([k]) => k === res), '요청 있음 = 종전처럼 결과 줄(' + res + ') 씀', c.writes.map(w => [w[0], JSON.stringify(w[1]).slice(0, 80)]));
    }
    console.log('\n결과 ' + pass + '/' + (pass + fail));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

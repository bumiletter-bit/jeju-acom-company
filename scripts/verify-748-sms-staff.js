// #748 문자 알림 받는 사람 = 관리자 전원 ∪ 설정 staff_ids — sms/index.js 의 staffUserIds 를 떼어 가짜 pool 로 실행(DB·알림 0)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'sms', 'index.js'), 'utf8');
const m = /    async function staffUserIds\(c\) \{[\s\S]*?\n    \}\n/.exec(src);
let pass = 0, fail = 0; const ok = (x, msg, y) => { if (x) { pass++; console.log('  ✅', msg); } else { fail++; console.log('  ❌', msg, JSON.stringify(y)); } };
ok(!!m, '실코드 staffUserIds 찾음');
const make = admins => { const pool = { query: async sql => { if (!/FROM users WHERE role = 'admin' AND deleted_at IS NULL/.test(sql)) throw new Error('모르는 SQL ' + sql); return { rows: admins.map(id => ({ id })) }; } };
    return new Function('pool', m[0] + '\nreturn staffUserIds;')(pool); };
(async () => {
    const f = make([1, 7]);
    ok(JSON.stringify(await f({ staff_ids: [] })) === '[1,7]', '설정 비면 = 관리자 전원(종전과 같음)', await f({ staff_ids: [] }));
    ok(JSON.stringify(await f({ staff_ids: [1, 7, 10] })) === '[1,7,10]', '지금 실DB 설정 [1,7,10] = 1·7·10 (중복 없음)', await f({ staff_ids: [1, 7, 10] }));
    ok(JSON.stringify(await f({ staff_ids: [10] })) === '[1,7,10]', 'staff_ids 에 관리자를 빠뜨려도 관리자는 받음', await f({ staff_ids: [10] }));
    ok(JSON.stringify(await make([])({ staff_ids: [10] })) === '[10]', '관리자 0명이면 설정만');
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('크래시', e); process.exit(1); });

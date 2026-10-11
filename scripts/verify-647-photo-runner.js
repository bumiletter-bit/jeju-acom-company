// #647-b 검증: 사진 판독 시험 러너(photo_test_request → photo_test_result)
//   server.js 의 러너 구획(「#647-b 사진 판독 시험 러너 — 시작/끝」)을 떼어, 판독기·DB·받기·이름 풀이·설정을 전부 가짜로 끼워 실행한다.
//   → 실제 AI 호출 0 · 실DB 읽기·쓰기 0 · 네트워크 0 · 서버 안 띄움 · 발송 0.
//   실행: node scripts/verify-647-photo-runner.js
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (d != null && !c ? ' — ' + String(d).slice(0, 260) : '')); };
const A = SRC.indexOf('// ── #647-b 사진 판독 시험 러너(로그인 없이'), B = SRC.indexOf('// ── #647-b 사진 판독 시험 러너 — 끝');
if (A < 0 || B < A) { console.log('러너 구획을 못 찾음'); process.exit(1); }
const BLOCK = SRC.slice(A, B);
const HOSTS = { photo_test: { hosts: ['talk.example.com'] } };
const OKURL = 'https://img.talk.example.com/a/1.jpg';

// 가짜 세계
function world(o) {
    o = o || {};
    const w = { cfg: Object.assign({}, o.cfg), sql: [], judged: [], fetched: [], looked: [], timers: 0, deleted: 0, dataReads: 0, stateWrites: 0 };
    const logs = o.logs || [{ id: 11, image_url: OKURL }, { id: 12, image_url: null }, { id: 13, image_url: 'http://img.talk.example.com/a/3.jpg' }, { id: 14, image_url: 'https://10.0.0.5/x.jpg' }, { id: 15, image_url: 'https://img.talk.example.com/a/big.jpg' }, { id: 16, image_url: 'https://img.talk.example.com/a/page.html' },
        { id: 17, image_url: 'https://img.talk.example.com:8443/a/p.jpg' }, { id: 18, image_url: 'https://inner.talk.example.com/a/in.jpg' }, { id: 19, image_url: 'https://img.talk.example.com/a/stream.jpg' }, { id: 20, image_url: 'https://other.example.org/a/o.jpg' }];
    const imgs = o.imgs || [{ id: 1, content_type: 'image/jpeg', data: Buffer.from('JPEGDATA-1') }];
    w.pool = { query: async (sql, p) => {
        const s = String(sql).replace(/\s+/g, ' ').trim(); w.sql.push(s);
        if (/^DELETE FROM agent_office_config WHERE key = 'photo_test_request'/.test(s)) { w.deleted++; delete w.cfg.photo_test_request; return { rows: [], rowCount: 1 }; }
        if (/^SELECT id, image_url FROM message_logs WHERE id = ANY/.test(s)) return { rows: logs.filter(r => p[0].includes(r.id)) };
        if (/^SELECT image_url FROM message_logs WHERE image_url = ANY/.test(s)) return { rows: logs.filter(r => r.image_url && p[0].includes(r.image_url)).map(r => ({ image_url: r.image_url })) };
        if (/^SELECT id FROM sms_images WHERE id = ANY/.test(s)) { w.idAsk = p[0].length; return { rows: imgs.filter(r => p[0].includes(r.id)).map(r => ({ id: r.id })) }; }
        if (/^SELECT content_type, data FROM sms_images WHERE id = \$1/.test(s)) { w.dataReads++; return { rows: imgs.filter(r => r.id === p[0]) }; }
        throw new Error('예상 밖 SQL: ' + s.slice(0, 80));
    } };
    w.cfgGet = async k => (k in w.cfg ? JSON.parse(JSON.stringify(w.cfg[k])) : null);
    w.cfgSet = async (k, v) => { if (k === 'photo_test_state') w.stateWrites++; w.cfg[k] = JSON.parse(JSON.stringify(v)); };
    w.judge = o.judge || (async (images, opt) => { w.judged.push({ n: images.length, bytes: images[0].buf.length, type: images[0].contentType, opt }); return { kind: 'damage', confidence: 'high', size: null, staff_summary: o.summary || '시험 요약', raw: { model: 'fake-model', usage: { input_tokens: 1500, output_tokens: 120, cache_read_input_tokens: 9 }, ms: 5 } }; });
    w.lookup = o.lookup || (async host => { w.looked.push(host); return /^inner\./.test(host) ? [{ address: '10.1.2.3' }] : [{ address: '203.0.113.7' }]; });
    const hd = map => ({ get: k => (k in map ? map[k] : null) });
    w.fetchImpl = o.fetchImpl || (async (url, init) => { w.fetched.push({ url, redirect: init && init.redirect });
        if (/big\.jpg/.test(url)) return { ok: true, status: 200, headers: hd({ 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) }), arrayBuffer: async () => new ArrayBuffer(8) };
        if (/page\.html/.test(url)) return { ok: true, status: 200, headers: hd({ 'content-type': 'text/html; charset=utf-8' }), arrayBuffer: async () => new ArrayBuffer(8) };
        if (/stream\.jpg/.test(url)) { let sent = 0; w.streamCancelled = false;   // 길이를 안 알려 주고 4MB 씩 끝없이 보내는 응답
            return { ok: true, status: 200, headers: hd({ 'content-type': 'image/jpeg' }), body: { getReader: () => ({ read: async () => { sent++; w.streamChunks = sent; return sent > 50 ? { done: true } : { done: false, value: new Uint8Array(4 * 1024 * 1024) }; }, cancel: async () => { w.streamCancelled = true; } }) } }; }
        return { ok: true, status: 200, headers: hd({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6]).buffer }; });
    const fakeRequire = name => { if (name === './sms/photo-judge.js') return { judge: w.judge }; if (name === 'dns') return { promises: { lookup: w.lookup } }; throw new Error('require 안 됨: ' + name); };
    w.api = new Function('pool', 'naverCfgGet', 'naverCfgSet', 'kstTodayStr', 'setInterval', 'require', 'fetch', 'console', 'process',
        BLOCK + '\n; return { photoTestRun, photoTestTick, photoTestUrlOk, photoTestPrivateIp, photoTestMask, PHOTO_TEST_MAX, PHOTO_TEST_DAILY };')(
        w.pool, w.cfgGet, w.cfgSet, () => o.day || '2026-10-11', () => { w.timers++; return {}; }, fakeRequire, w.fetchImpl, { error() { }, log() { } }, { env: {} });
    w.deps = { pool: w.pool, judge: w.judge, fetchImpl: w.fetchImpl, lookup: w.lookup, cfgGet: w.cfgGet, cfgSet: w.cfgSet, today: () => o.day || '2026-10-11' };
    return w;
}

(async () => {
    console.log('① 코드 꼴');
    ok(/setInterval\(photoTestTick, 60 \* 1000\);/.test(BLOCK) && world().timers === 1, '다른 러너와 같은 60초 틱 1개');
    ok(!/sendAlimtalk|sendLms|gatewaySend|queueBotAnswer|queueStaffReply|notifyTelegram|createNotification|talk_outbox|INSERT INTO sms_messages|photoReply|photo-reply/.test(BLOCK), '손님 답 만들기·발송·알림 호출 0(판독기만 부른다)');
    ok((BLOCK.match(/\b(INSERT|UPDATE)\b/g) || []).length === 0 && (BLOCK.match(/DELETE FROM agent_office_config WHERE key = 'photo_test_request'/g) || []).length === 1, 'SQL 쓰기 = 요청 키 선제거 한 줄뿐(그 밖은 SELECT · 설정 저장은 naverCfgSet)');
    ok(!/phone|buyer|recipient|user_id|customer/.test(BLOCK.replace(/\/\/[^\n]*/g, '')), '손님 번호·이름·식별값 칸을 읽지 않음');

    console.log('② 문자 사진(sms_images) 1장 — 허용 도메인 설정이 없어도 도는 길');
    let w = world(); let r = await w.api.photoTestRun({ sms_image_ids: [1], channel: 'sms' }, w.deps);
    ok(r.items.length === 1 && r.items[0].ref === 'sms_image:1' && r.items[0].kind === 'damage' && r.items[0].confidence === 'high' && r.items[0].staff_summary === '시험 요약' && r.items[0].bytes === 10, '결과 한 줄 = ref · 종류 · 확신 · 직원용 요약 · 바이트', JSON.stringify(r.items[0]));
    ok(JSON.stringify(r.items[0].usage) === JSON.stringify({ input_tokens: 1500, output_tokens: 120 }) && r.items[0].model === 'fake-model' && typeof r.items[0].ms === 'number', '토큰 수(usage)·모델·걸린 시간이 실림(장당 비용 계산용)');
    ok(w.judged.length === 1 && w.judged[0].n === 1 && w.judged[0].opt.channel === 'sms' && w.fetched.length === 0 && w.looked.length === 0, '판독기 1번 · 한 장씩 · 채널 전달 · 네트워크 0');
    ok(r.judged === 1 && r.used_today === 1 && r.daily === 100 && r.hosts_set === false && w.cfg.photo_test_state.used === 1 && w.cfg.photo_test_state.day === '2026-10-11', '하루 사용량 기록(1/100)');
    ok(!/010|\d{3}-\d{3,4}-\d{4}/.test(JSON.stringify(r)), '결과에 전화번호 꼴 0');

    console.log('③ (가) 허용 도메인이 없으면 바깥 주소를 아예 받지 않음');
    w = world(); r = await w.api.photoTestRun({ ids: [11, 12], urls: [OKURL], sms_image_ids: [1] }, w.deps);
    ok(r.items.length === 1 && r.items[0].ref === 'sms_image:1' && r.skipped.length === 3 && r.skipped.every(x => /허용 도메인 미설정/.test(x.error)) && w.fetched.length === 0 && w.looked.length === 0 && !w.sql.some(s => /message_logs/.test(s)), 'hosts 미설정: ids·urls 는 「허용 도메인 미설정」으로 건너뜀(조회·받기 0) · sms_image_ids 만 판독');
    w = world({ cfg: { photo_test: { hosts: ['', '   ', 'localhost', '10.0.0.1', '*'] } } }); r = await w.api.photoTestRun({ ids: [11] }, w.deps);
    ok(r.items.length === 0 && /허용 도메인 미설정/.test(r.skipped[0].error) && r.hosts_set === false, '쓸모없는 hosts 값(빈 글·localhost·숫자·별표)은 설정 안 한 것으로');

    console.log('④ 톡톡 기록 줄(ids) — 허용 도메인 설정 뒤 · 주소 검사');
    w = world({ cfg: HOSTS }); r = await w.api.photoTestRun({ ids: [11, 12, 13, 14, 15, 16, 17, 18, 20, 99] }, w.deps);
    const by = ref => r.items.find(x => x.ref === ref) || r.skipped.find(x => x.ref === ref) || {};
    ok(by('log:11').kind === 'damage' && w.fetched[0].url === OKURL && w.fetched[0].redirect === 'error' && w.looked[0] === 'img.talk.example.com', '정상 주소 = 이름을 풀어 보고 받아서 판독(다른 주소로 넘기는 응답은 따라가지 않음)');
    ok(by('log:12').error === '사진 주소가 없는 줄' && by('log:99').error === '없는 줄', '주소 없는 줄·없는 줄 = 건너뜀(이유 적음)');
    ok(by('log:13').error === '허용하지 않는 주소' && by('log:14').error === '허용하지 않는 주소' && by('log:20').error === '허용하지 않는 주소', 'http 주소·숫자 주소·허용 밖 도메인 = 거절');
    ok(by('log:17').error === '허용하지 않는 주소', '(2) 포트를 지정한 주소(:8443) = 거절');
    ok(by('log:18').error === '허용하지 않는 주소(안쪽 주소)' && !w.fetched.some(f => /inner\./.test(f.url)), '(가) 이름이 사설 주소(10.x)로 풀리면 거절 — 받으러 가지 않음');
    ok(!w.fetched.some(f => /a\/3\.jpg|10\.0\.0\.5|8443|other\.example/.test(f.url)), '거절한 주소로는 요청 자체가 안 나감');
    ok(by('log:15').error === '사진이 너무 큼(10MB 초과)' && by('log:16').error.startsWith('사진 형식이 아님'), '길이를 알려 준 10MB 초과·사진 아닌 응답 = 판독 안 함');
    ok(w.judged.length === 1 && r.used_today === 1, '판독기는 통과한 1장에만(상한도 1만 셈)');
    w = world({ cfg: HOSTS }); r = await w.api.photoTestRun({ ids: [19] }, w.deps);
    ok(r.items[0].error === '사진이 너무 큼(10MB 초과)' && w.streamCancelled === true && w.streamChunks <= 4 && w.judged.length === 0, '(나) 길이를 안 알려 주는 응답 = 읽는 도중 10MB 넘는 순간 끊음(조각 ' + w.streamChunks + '개에서 중단)', JSON.stringify({ e: r.items[0].error, c: w.streamChunks }));

    console.log('⑤ urls — 톡톡 기록에 있는 주소만');
    w = world({ cfg: HOSTS }); r = await w.api.photoTestRun({ urls: [OKURL, 'https://img.talk.example.com/a/never-logged.jpg', OKURL] }, w.deps);
    ok(r.items.length === 1 && r.items[0].ref === 'url:1' && r.skipped.length === 1 && /임의 주소는 받지 않음/.test(r.skipped[0].error) && w.fetched.length === 1, '기록에 없는 주소 = 거절(허용 도메인이어도 · 받으러 가지 않음) · 겹친 주소는 한 번');

    console.log('⑥ 주소 검사 함수 — (1) 끝 점 · (2) 포트 · 그 밖');
    const U = world().api.photoTestUrlOk, P = world().api.photoTestPrivateIp, H = ['pstatic.net'];
    ok(U('https://a.pstatic.net/x.jpg', H) && U('https://pstatic.net/x', ['.pstatic.net.']) && U('https://a.pstatic.net./x.jpg', H), '허용 도메인으로 끝나는 주소는 통과(끝 점이 붙어도 같은 이름으로 봄)');
    ok(!U('https://localhost./x', ['localhost']) && !U('https://svc.internal./x', ['internal']) && !U('https://localhost/x', H) && !U('https://a.local/x', ['a.local']), '(1) 끝에 점이 붙은 안쪽 이름(localhost. · internal.)도 거절');
    ok(!U('https://a.pstatic.net:8443/x', H) && !U('https://a.pstatic.net:444/x', H) && U('https://a.pstatic.net:443/x', H), '(2) 포트 지정 거절(기본 443 을 적은 것만 같은 주소로 봄)');
    ok(!U('https://evilpstatic.net/x', H) && !U('https://pstatic.net.evil.com/x', H) && !U('https://user:pw@a.pstatic.net/x', H) && !U('https://[::1]/x', H) && !U('https://127.0.0.1/x', H) && !U('ftp://a.pstatic.net/x', H) && !U('http://a.pstatic.net/x', H) && !U('javascript:alert(1)', H) && !U('', H), '비슷한 이름·계정 든 주소·숫자 주소·https 아님 전부 거절');
    ok(!U('https://a.pstatic.net/x.jpg', []) && !U('https://a.pstatic.net/x.jpg', null), '허용 도메인 목록이 비면 전부 거절');
    ok(['10.0.0.1', '172.16.5.5', '172.31.255.1', '192.168.0.10', '127.0.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fc00::1', 'fd12::3', 'fe80::1', 'febf::1', '::ffff:10.0.0.1', '100.64.0.1', 'x'].every(P) && ['203.0.113.7', '8.8.8.8', '172.15.0.1', '172.32.0.1', '2400:cb00::1'].every(a => !P(a)), '사설·루프백·링크로컬(10/8 · 172.16/12 · 192.168/16 · 127/8 · 169.254/16 · ::1 · fc00::/7 · fe80::/10) 판정');

    console.log('⑦ 상한 — (다) 조회 전에 20개로 자름');
    w = world({ cfg: HOSTS, logs: Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, image_url: 'https://img.talk.example.com/b/' + i + '.jpg' })) });
    r = await w.api.photoTestRun({ ids: Array.from({ length: 30 }, (_, i) => 100 + i) }, w.deps);
    ok(r.items.length === 20 && w.judged.length === 20 && r.skipped.length === 10 && r.skipped.every(x => /한 번에 20장까지/.test(x.error)), '한 번에 20장까지(나머지는 건너뜀)');
    w = world({ imgs: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, content_type: 'image/jpeg', data: Buffer.from('x' + i) })) });
    r = await w.api.photoTestRun({ sms_image_ids: Array.from({ length: 30 }, (_, i) => i + 1) }, w.deps);
    ok(w.idAsk === 20 && w.dataReads === 20 && r.items.length === 20 && r.skipped.length === 10, '문자 사진: 번호 조회에 20개만 넣고 · 바이트는 차례가 온 한 장씩만 읽음(' + w.dataReads + '번)', JSON.stringify({ ask: w.idAsk, reads: w.dataReads }));
    w = world({ cfg: Object.assign({}, HOSTS, { photo_test: { hosts: ['talk.example.com'], daily: 3 }, photo_test_state: { day: '2026-10-11', used: 2 } }) });
    r = await w.api.photoTestRun({ sms_image_ids: [1], ids: [11] }, w.deps);
    ok(w.judged.length === 1 && r.used_today === 3 && r.skipped.some(x => /하루 상한\(3장\)/.test(x.error)), '하루 상한(설정) — 2장 쓴 날 2장 요청 = 1장만');
    w = world({ cfg: { photo_test_state: { day: '2026-10-10', used: 100 } } }); r = await w.api.photoTestRun({ sms_image_ids: [1] }, w.deps);
    ok(r.used_today === 1 && r.items.length === 1, '날이 바뀌면 사용량 0 부터');
    {   // (라) 한 장 판독할 때마다 사용량을 적는다 — 도중에 죽어도 셈이 남는다
        const seen = []; w = world({ imgs: [1, 2, 3].map(i => ({ id: i, content_type: 'image/jpeg', data: Buffer.from('p' + i) })) });
        w.deps.judge = async () => { seen.push(w.cfg.photo_test_state && w.cfg.photo_test_state.used); if (seen.length === 2) throw new Error('도중에 죽음'); return { kind: 'size', confidence: 'low', staff_summary: '', raw: {} }; };
        r = await w.api.photoTestRun({ sms_image_ids: [1, 2, 3] }, w.deps);
        ok(JSON.stringify(seen) === '[1,2,3]' && w.stateWrites === 3 && w.cfg.photo_test_state.used === 3, '(라) 판독기를 부르기 전에 그 장까지의 사용량이 이미 적혀 있음(1 → 2 → 3)', JSON.stringify(seen));
    }

    console.log('⑧ (마) 요약 글의 긴 숫자 가림');
    w = world({ summary: '상자 라벨에 운송장 6800-1234-5671, 전화 010 1234 5678 보임. 귤 3개 무름, 2S 크기' }); r = await w.api.photoTestRun({ sms_image_ids: [1] }, w.deps);
    ok(!/6800|5671|1234 5678|010 1234/.test(r.items[0].staff_summary) && (r.items[0].staff_summary.match(/\(숫자 가림\)/g) || []).length === 2 && /귤 3개 무름, 2S 크기/.test(r.items[0].staff_summary), '송장번호·전화번호 꼴(숫자 8자리 이상)은 가리고 짧은 숫자(3개·2S)는 그대로', r.items[0].staff_summary);
    const M = world().api.photoTestMask;
    ok(M('680012345671') === '(숫자 가림)' && M('1234567') === '1234567' && M('10/11 발송 4.5kg 15과') === '10/11 발송 4.5kg 15과' && M('a'.repeat(500)).length === 300, '가림 규칙: 8자리부터 · 날짜·무게·과수는 그대로 · 300자까지');

    console.log('⑨ 실패해도 서버 흐름 무영향');
    w = world({ judge: async () => { throw new Error('AI 죽음 01012345678'); } }); r = await w.api.photoTestRun({ sms_image_ids: [1] }, w.deps);
    ok(r.items.length === 1 && /판독 실패: AI 죽음 \(숫자 가림\)/.test(r.items[0].error) && !r.items[0].kind && r.used_today === 1, '판독기가 던져도 결과 줄에 오류로 남고 끝까지 감(부른 횟수는 셈 · 오류 글의 긴 숫자도 가림)');
    w = world({ judge: async () => ({ kind: 'error', confidence: 'low', staff_summary: '', raw: { error: 'AI 키 없음' } }) }); r = await w.api.photoTestRun({ sms_image_ids: [1] }, w.deps);
    ok(r.items[0].error === 'AI 키 없음' && r.items[0].kind === 'error', '판독기가 오류를 돌려주면 그 글이 결과에(예: AI 키 없음)');
    w = world({ cfg: HOSTS, fetchImpl: async () => { throw new Error('ECONNRESET'); } }); r = await w.api.photoTestRun({ ids: [11] }, w.deps);
    ok(r.items[0].error === '받기 실패' && w.judged.length === 0, '사진 받기가 던져도 오류 줄만(판독 안 함)');
    w = world({ cfg: HOSTS, lookup: async () => { throw new Error('ENOTFOUND'); } }); r = await w.api.photoTestRun({ ids: [11] }, w.deps);
    ok(r.items[0].error === '주소를 찾지 못함' && w.fetched.length === 0, '이름 풀이가 실패하면 받으러 가지 않음');

    console.log('⑩ 틱 — 선제거 · 결과 저장');
    w = world({ cfg: { photo_test_request: { sms_image_ids: [1], channel: 'sms' } } }); await w.api.photoTestTick();
    ok(w.deleted === 1 && !('photo_test_request' in w.cfg) && w.cfg.photo_test_result && w.cfg.photo_test_result.items.length === 1 && w.cfg.photo_test_result.where === 'local' && /^\d{4}-\d\d-\d\dT/.test(w.cfg.photo_test_result.at), '요청 키를 먼저 지우고(반복 실행 방지) 결과를 photo_test_result 에');
    ok(w.sql.findIndex(s => /^DELETE FROM agent_office_config/.test(s)) < w.sql.findIndex(s => /FROM sms_images/.test(s)), '지우는 것이 판독보다 먼저');
    await w.api.photoTestTick(); ok(w.deleted === 1 && w.judged.length === 1, '요청이 없으면 아무 것도 안 함(두 번째 틱)');
    w = world({ cfg: { photo_test_request: { sms_image_ids: [1] } } }); w.pool.query = async sql => { if (/^\s*DELETE/.test(sql)) { delete w.cfg.photo_test_request; return { rows: [] }; } throw new Error('DB 끊김'); };
    let threw = false; try { await w.api.photoTestTick(); } catch (e) { threw = true; }
    ok(!threw && w.cfg.photo_test_result && /DB 끊김/.test(w.cfg.photo_test_result.error || ''), 'DB 가 실패해도 던지지 않고 결과에 오류만');
    w = world({ cfg: { photo_test_request: 'x' } }); await w.api.photoTestTick(); ok(w.deleted === 0 && !w.cfg.photo_test_result, '요청 꼴이 아니면 손대지 않음');

    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗ 중단: ' + (e && e.stack || e)); process.exit(1); });

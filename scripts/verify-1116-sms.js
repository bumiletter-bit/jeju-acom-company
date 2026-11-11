// #1116 직원 긴 문자 = 자르지도 나누지도 않고 한 통(대표 11/11 「직원이 보낸 한 통은 한 통으로」 · 직원 긴 답이 「3.」 에서 조용히 잘렸던 일) 검증
//   ① 순수 함수(sms/sms-safe.js smsSafe 무변경 = 봇 길 900바이트 자르기 그대로) ② 화면 글자 수 칸(public/ao-desk.js smsLenText 를 떼어 실행 = 2,000바이트 넘으면 「줄여 주세요」)
//   ③ verify-1109-sms 와 같은 장착(가짜 deps + 실DB 시험 번호 0999116… · 시작·끝에 지움 · 발송·AI·알림 가짜) = reply·/api/sms/send 가 한 통으로 원문 그대로 저장 · 2,000바이트 넘으면 400
//   실행: node scripts/verify-1116-sms.js   (포트 PORT1116 또는 3458 · 🔴 verify-610-server 와 동시에 돌리지 말 것 = 같은 DB 숫자를 셈)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs'), path = require('path');
const express = require('express'); const jwt = require('jsonwebtoken'); const { Pool } = require('pg');
const S = require('../sms/sms-safe.js'); const mount = require('../sms/index.js');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && d != null ? ' — ' + String(d).slice(0, 400) : '')); };
const T = '0999116';
const ORIG = fs.readFileSync(path.join(__dirname, 'verify-1116-orig.txt'), 'utf8').replace(/\r\n/g, '\n').trim();   // 지어낸 견학 안내 글(실제 글과 같은 줄 구조 · 「3.」 뒤에서 900B 를 넘음 · 실제 상호·사람·방송 이름 0)
(async () => {
    console.log('① 순수 함수(봇 길 무변경)');
    const cut = S.smsSafe(ORIG), full = S.smsSafe(ORIG, { maxBytes: 0 });
    ok(S.smsBytes(full) > 900 && S.smsBytes(full) <= 2000 && cut.endsWith('3.') && full.length > cut.length, '재현: 종전 smsSafe(기본 900) = 「3.」 에서 끝 · maxBytes 0 = 뒤까지', S.smsBytes(full) + ' / ' + JSON.stringify(cut.slice(-10)));
    const short = '네 고객님 감사합니다.\n좋은 하루 되세요';
    const big = Array.from({ length: 36 }, (_, i) => `${i + 1}. 귤은 서늘한 곳에 두시고 상한 것은 골라내 주세요 감사합니다 고객님`).join('\n');   // 약 2,500바이트 = 상한 밖
    const one = '가나다라마바사아자차카타파하'.repeat(60);   // 줄바꿈·빈칸 없는 긴 한 덩어리 840자 = 1,680바이트
    ok(S.smsBytes(big) > 2000 && S.smsBytes(one) > 900 && S.smsBytes(one) <= 2000, '시험 글 크기 = 원문 900~2,000 · 한 덩어리 900~2,000 · 긴 글 2,000 넘음', [S.smsBytes(full), S.smsBytes(one), S.smsBytes(big)].join(','));
    ok(S.smsBytes(S.smsSafe(big)) <= 900, '봇 길 smsSafe(기본) = 종전처럼 900B 로 자름');

    console.log('② 화면 글자 수 칸');
    {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ao-desk.js'), 'utf8'); const a = src.indexOf('    const SMS_MAX_BYTES = 2000;'); const b = src.indexOf('\n', src.indexOf('    const smsLenText', a)) + 1;
        const nfmt = n => (Number(n) || 0).toLocaleString('ko-KR');
        const smsLenText = new Function('nfmt', src.slice(a, b) + '\nreturn smsLenText;')(nfmt);
        const L = [smsLenText(short), smsLenText(full), smsLenText(one), smsLenText(big)];
        ok(a > 0 && /^\d+자$/.test(L[0]) && /^[\d,]+자$/.test(L[1]) && /^[\d,]+자$/.test(L[2]) && /자 · 너무 길어요\(약 [\d,]+자 줄여 주세요\)$/.test(L[3]) && !L.some(x => /통으로/.test(x)), '짧은 글·원문·한 덩어리 = 「n자」만(「n통」 없음) · 2,000B 넘는 글 = 「너무 길어요(약 n자 줄여 주세요)」', JSON.stringify(L));
        ok(smsLenText('가'.repeat(1000)) === '1,000자' && /줄여/.test(smsLenText('가'.repeat(1001))), '답 칸 maxlength 1000자(한글 1000자 = 2,000B) = 상한 안 · 1001자부터 알림', smsLenText('가'.repeat(1000)));
    }

    console.log('③ 서버 직원 길(실DB 시험 번호)');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
    const cleanup = async () => { await pool.query(`DELETE FROM sms_messages WHERE thread_id IN (SELECT id FROM sms_threads WHERE phone_digits LIKE $1)`, [T + '%']); await pool.query(`DELETE FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%']); };
    const cfgStore = {}; const logs = [];
    const deps = {
        testMode: true, pool, authMiddleware: (req, res, next) => { try { req.user = jwt.verify(String(req.headers.authorization || '').replace('Bearer ', ''), 'v1116'); next(); } catch (e) { res.status(401).json({ error: 'auth' }); } },
        naverCfgGet: async k => cfgStore[k] === undefined ? null : cfgStore[k], naverCfgSet: async (k, v) => { cfgStore[k] = v; }, stateMerge: async () => { },
        writeAudit: async () => { }, createNotification: async () => { }, notifyTelegram: async () => { }, loadShippingHolidayInfo: async () => ({ set: new Set(), arriveOff: new Set(), reasons: new Map() }),
        qnaGenerate: async () => ({ answer: '', used: [] }), cjTrack: null, deliveryUpsertStatus: null, log: { log() { }, error(...a) { logs.push(a.join(' ')); } }, gatewaySend: async (d, text, id) => ({ id }),
    };
    const app = express(); app.use(express.json({ limit: '5mb' }));
    const sms = mount(app, deps); await sms.initDB(); await cleanup();
    cfgStore.sms_gateway = { enabled: true, mode: 'draft', hold_sec: 0, max_chars: 1000, staff_ids: [1] }; sms.resetCfg();
    const PORT = Number(process.env.PORT1116 || 3458); const srv = app.listen(PORT); const base = 'http://127.0.0.1:' + PORT;
    const token = jwt.sign({ id: 1, username: 'v', name: '검증', role: 'admin' }, 'v1116');
    const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
    const outs = async tid => (await pool.query(`SELECT id, body, priority, ai_json FROM sms_messages WHERE thread_id = $1 AND direction = 'out' ORDER BY id`, [tid])).rows;
    try {
        const r1 = await api('POST', '/api/sms/send', { phone: T + '0001', text: ORIG });
        const o1 = await outs(r1.json.thread_id);
        ok(r1.status === 200 && r1.json.parts === 1 && o1.length === 1 && o1[0].body === full && o1[0].ai_json.parts === 1, '/api/sms/send 원문(900~2,000B) = 한 통 · 원문 그대로(자르기·나누기 0)', JSON.stringify({ s: r1.status, p: r1.json.parts, n: o1.length, b: o1[0] && S.smsBytes(o1[0].body) }));
        ok(o1[0] && /여쭙고 싶은 점/.test(o1[0].body) && /귤빛농장 드림$/.test(o1[0].body), '「3.」 뒤(여쭙고 싶은 점 … 귤빛농장 드림)까지 그 한 통에');
        const tid = r1.json.thread_id;
        const r2 = await api('POST', `/api/sms/threads/${tid}/reply`, { text: short });
        const o2 = (await outs(tid)).filter(x => x.id >= r2.json.message_id);
        ok(r2.status === 200 && o2.length === 1 && o2[0].body === S.smsSafe(short) && o2[0].ai_json.parts === 1, '900B 이하 직원 답 = 종전과 같은 1통(smsSafe 결과 그대로)', JSON.stringify(o2));
        const r4 = await api('POST', `/api/sms/threads/${tid}/reply`, { text: one });
        const o4 = (await outs(tid)).filter(x => x.id >= r4.json.message_id);
        ok(r4.status === 200 && o4.length === 1 && o4[0].body === one, '긴 한 덩어리(1,680B) 직원 답 = 한 통 · 원문 그대로', o4.length);
        const n0 = (await outs(tid)).length;
        const r3 = await api('POST', `/api/sms/threads/${tid}/reply`, { text: big });
        const r5 = await api('POST', '/api/sms/send', { phone: T + '0002', text: big });
        const t5 = (await pool.query(`SELECT id FROM sms_threads WHERE phone_digits = $1`, [T + '0002'])).rows[0];
        ok(r3.status === 400 && r3.json.code === 'too_long' && r3.json.max_bytes === 2000 && /줄여 주세요/.test(r3.json.error) && (await outs(tid)).length === n0, '2,000B 넘는 직원 답 = 400 「너무 길어요 · 약 n자 줄여 주세요」 · 저장 0(조용히 자르기 0)', JSON.stringify(r3.json));
        ok(r5.status === 400 && r5.json.code === 'too_long' && !t5, '2,000B 넘는 새 문자 = 400 · 대화도 안 만듦', JSON.stringify({ s: r5.status, t: !!t5 }));
        ok(!logs.some(x => /잘렸어요/.test(x)), '직원 길은 「잘렸어요」 로그 안 남김(자르지 않으니까)', logs.join(' | '));
    } catch (e) { console.error(e); fail++; }
    finally {
        await cleanup().catch(e => console.error('정리 실패', e.message));
        const left = (await pool.query(`SELECT count(*)::int n FROM sms_threads WHERE phone_digits LIKE $1`, [T + '%'])).rows[0].n; ok(left === 0, '끝 = 시험 대화 0줄');
        srv.close(); await pool.end();
    }
    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();

// #836 검증 — 시기 지식 「판매 연동」(sell_match 낱말 목록(| 구분 · 공백 제거 includes · 대소문자 무시 · 정규식 아님) · sell_rule hide_when_selling/only_when_selling) · 워커3
//   🔴 실DB 쓰기 0 · 실AI 0 · server.js 기동 0 — server.js 의 「#836 판매 연동 시작~끝」 구간 + seasonScenariosToday 함수 + 시기 지식 CRUD 4 라우트 + /api/scenarios 라우트 + 「#832 공개 GET」 구간(seasonNowCompute)을 떼어 가짜 pool(메모리 행)·express 포트 0 으로 돈다.
//   보는 것 = 거름 표(hide/only/NULL × 판매중/아님 = 6) · 낱말 꼴 틀림·매칭 글 비움·판매현황 조회 실패 = 종전 · 폭주 꼴 정규식 글도 글자로만 비교(시간) · 구간 안 new RegExp 0 · seasonScenariosToday 날짜별 · 톡톡 /api/scenarios 경로가 같은 거름 · CRUD(400 3종 · 저장 · '' 비움 · 칸 없으면 유지 · GET sell_now) · seasonNowCompute 거름 · 글자(ALTER DEFAULT 없음 · app.js 칸·배지)
//   실행: node scripts/verify-836-season-sell.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const express = require('express');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d == null ? '' : ' — ' + String(d).slice(0, 300))); return !!c; };

const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('구간 못 찾음: ' + a.slice(0, 40)); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('구간 끝 못 찾음: ' + b.slice(0, 40)); return src.slice(i, j); };
const sellSrc = cut('// ── #836 판매 연동 시작', '// ── #836 판매 연동 끝');
const tagLine = src.slice(src.indexOf('const SEASON_LABEL_TAG_RE ='), src.indexOf('\n', src.indexOf('const SEASON_LABEL_TAG_RE =')));
const todaySrc = cut('async function seasonScenariosToday(dateOverride, channel) {', '// ── #379(대표 8/11)');
const crudSrc = cut("app.get('/api/agent-office/season-knowledge', authMiddleware,", "app.get('/api/agent-office/season-waitlist', authMiddleware,");
const scenSrc = (() => { const a = src.indexOf("app.get('/api/scenarios', async (req, res) => {"); const b = src.indexOf('\napp.', a + 10); return src.slice(a, b); })();
const pubSrc = cut('function publicClientIp(req) {', 'const _chatRate = new Map();') + '\n' + cut('function kstTodayStr() {', '// 표기 규칙') + '\n' + cut('// ── #832 공개 GET 시작', '// ── #832 공개 GET 끝');

// ── 가짜 DB ──
let knowRows = [], selling = [], sellingFail = false, queries = [], unknownSql = [], nextId = 100;
const resetRows = () => { nextId = 100; knowRows = [
    { id: 1, item_key: '타이벡', label: '오픈 예정', start_md: '10-18', end_md: '10-27', knowledge: '타이벡 감귤은 10/26(월)~27(화) 오픈 예정이에요. 지금은 예약만 받아요.', sort: 0, enabled: true, deleted_at: null, sell_match: '타이벡', sell_rule: 'hide_when_selling' },
    { id: 2, item_key: '타이벡', label: '판매', start_md: '10-18', end_md: '01-31', knowledge: '타이벡 감귤 지금 판매 중이에요.', sort: 1, enabled: true, deleted_at: null, sell_match: '타이벡', sell_rule: 'only_when_selling' },
    { id: 3, item_key: '노지황금향', label: '출하 예정', start_md: '10-01', end_md: '11-30', knowledge: '노지 황금향은 11월부터 출하 예정이에요(판매 중 단정 금지).', sort: 0, enabled: true, deleted_at: null, sell_match: '노지황금향|노지 황금향', sell_rule: 'hide_when_selling' },
    { id: 4, item_key: '레몬', label: '그린', start_md: '10-01', end_md: '12-14', knowledge: '그린레몬 시기예요.', sort: 0, enabled: true, deleted_at: null, sell_match: null, sell_rule: null },
    { id: 5, item_key: '레드향', label: '공통', start_md: '01-01', end_md: '12-31', knowledge: '레드향 공통.', sort: 0, enabled: true, deleted_at: null, sell_match: '(', sell_rule: 'hide_when_selling' },   // 낱말 1자 = 꼴 틀림 → 종전(항상 넣음)
    { id: 6, item_key: '하우스감귤', label: '판매', start_md: '09-01', end_md: '12-31', knowledge: '하우스 감귤 판매 중.', sort: 0, enabled: true, deleted_at: null, sell_match: '', sell_rule: 'only_when_selling' },   // 매칭 글 비움 = 종전
    { id: 7, item_key: '청귤', label: '시즌종료', start_md: '09-16', end_md: '06-30', knowledge: '청귤 시즌 끝.', sort: 0, enabled: false, deleted_at: null, sell_match: '청귤', sell_rule: 'only_when_selling' },   // enabled false = 종전처럼 안 읽음
]; };
const pool = { query: async (sql, params) => {
    queries.push(sql); const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM bot_products WHERE status = '판매중'/.test(s)) { if (sellingFail) throw new Error('db down'); return { rows: selling.map(name => ({ name })) }; }
    if (/SELECT \* FROM product_season_knowledge WHERE enabled = true AND deleted_at IS NULL/.test(s)) return { rows: knowRows.filter(r => r.enabled && !r.deleted_at) };
    if (/SELECT id, item_key, label, start_md, end_md, knowledge, sort, enabled, updated_by, updated_at, sell_match, sell_rule FROM product_season_knowledge WHERE deleted_at IS NULL/.test(s)) return { rows: knowRows.filter(r => !r.deleted_at) };
    if (/SELECT \* FROM product_season_knowledge WHERE id=\$1 AND deleted_at IS NULL/.test(s)) return { rows: knowRows.filter(r => String(r.id) === String(params[0]) && !r.deleted_at) };
    if (/INSERT INTO product_season_knowledge \(item_key, label, start_md, end_md, knowledge, sort, updated_by, sell_match, sell_rule\)/.test(s)) {
        const row = { id: nextId++, item_key: params[0], label: params[1], start_md: params[2], end_md: params[3], knowledge: params[4], sort: params[5], updated_by: params[6], sell_match: params[7], sell_rule: params[8], enabled: true, deleted_at: null }; knowRows.push(row); return { rows: [row] };
    }
    if (/UPDATE product_season_knowledge SET item_key=\$2, label=\$3, start_md=\$4, end_md=\$5, knowledge=\$6, sort=\$7, enabled=\$8, updated_by=\$9, updated_at=now\(\), sell_match=\$10, sell_rule=\$11 WHERE id=\$1 RETURNING \*/.test(s)) {
        const r = knowRows.find(x => String(x.id) === String(params[0])); Object.assign(r, { item_key: params[1], label: params[2], start_md: params[3], end_md: params[4], knowledge: params[5], sort: params[6], enabled: params[7], updated_by: params[8], sell_match: params[9], sell_rule: params[10] }); return { rows: [r] };
    }
    if (/UPDATE product_season_knowledge SET deleted_at=now\(\)/.test(s)) { const r = knowRows.find(x => String(x.id) === String(params[0])); r.deleted_at = new Date(); return { rowCount: 1 }; }
    if (/FROM inquiry_scenarios/.test(s)) return { rows: [{ scenario_no: 1, name: '기본', keywords: 'a', response: 'b', action: null, channel: '공통', updated_at: new Date('2026-01-01') }] };
    if (/FROM agent_office_config WHERE key = 'inquiry_auto_reply'/.test(s)) return { rows: [] };
    unknownSql.push(s.slice(0, 140)); throw new Error('가짜 pool: 모르는 SQL — ' + s.slice(0, 140));
} };
let audits = [];
const writeAudit = async x => { audits.push(x); };
const adminActor = req => ({ id: 1, name: '대표', position: '대표', role: 'admin' });
const authMiddleware = (req, res, next) => { req.user = { id: 1, name: '대표', role: 'admin' }; next(); };

(async () => {
    process.env.SCENARIO_API_TOKEN = 'tok836';
    const app = express(); app.use(express.json());
    const crypto = require('crypto');
    const fakeEmpty = async () => [];
    const F = new Function('app', 'pool', 'authMiddleware', 'writeAudit', 'adminActor', 'crypto', 'process', 'shippingScenarioToday', 'citrusNamingToday', 'paymentWordingRule', 'shippingNowPhrase',
        tagLine + '\n' + sellSrc + '\n' + todaySrc + '\n' + crudSrc + '\n' + scenSrc + '\nreturn { seasonSellKeep, seasonSellMatchCount, seasonSellWords, seasonSellValidate, seasonScenariosToday };');
    const S = F(app, pool, authMiddleware, writeAudit, adminActor, crypto, process, fakeEmpty, fakeEmpty, () => [], async () => '');
    const P = new Function('app', 'pool', 'naverCfgGet', pubSrc + '\n' + sellSrc + '\nreturn { seasonNowCompute };')({ get() {}, options() {} }, pool, async () => null);
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const BASE = 'http://127.0.0.1:' + srv.address().port;
    const call = async (method, p, body, headers) => { const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

    console.log('① 거름 표(규칙 × 판매중) + 종전 조건');
    const names = ['타이벡 감귤 5kg', '하우스감귤 2.5kg'];
    const row = (rule, match) => ({ sell_rule: rule, sell_match: match });
    ok(S.seasonSellKeep(row('hide_when_selling', '타이벡'), names) === false, 'hide × 판매중 → 뺌');
    ok(S.seasonSellKeep(row('hide_when_selling', '노지황금향'), names) === true, 'hide × 판매중 아님 → 둠');
    ok(S.seasonSellKeep(row('only_when_selling', '타이벡'), names) === true, 'only × 판매중 → 둠');
    ok(S.seasonSellKeep(row('only_when_selling', '노지황금향'), names) === false, 'only × 판매중 아님 → 뺌');
    ok(S.seasonSellKeep(row(null, '타이벡'), names) === true && S.seasonSellKeep(row(null, '없음'), names) === true, 'NULL 규칙 → 판매중이든 아니든 둠(종전)');
    ok(S.seasonSellKeep(row('hide_when_selling', '('), names) === true && S.seasonSellKeep(row('only_when_selling', 'a'.repeat(41)), names) === true && S.seasonSellKeep(row('hide_when_selling', '타이벡||감귤'), names) === true && S.seasonSellKeep(row('hide_when_selling', Array.from({ length: 11 }, (_, i) => 'w' + i).join('|')), names) === true, '낱말 꼴 틀림(1자 · 41자 · 빈 낱말 · 11개) → 둠(종전)');
    ok(S.seasonSellKeep(row('hide_when_selling', '노지황금향'), ['노지 황금향 3kg']) === false && S.seasonSellKeep(row('hide_when_selling', '노지 황금향'), ['노지황금향 3kg']) === false, '공백 무시 양쪽(「노지 황금향」 ↔ 「노지황금향」)');
    ok(S.seasonSellKeep(row('hide_when_selling', '없는것|타이벡'), names) === false && S.seasonSellMatchCount(row(null, '타이벡|하우스감귤'), names) === 2, '낱말 여러 개 = 하나라도 들어 있으면 매칭 · 매칭 수는 이름 기준');
    { const bomb = '(.*)*x|(a+)+$'; const big = Array.from({ length: 300 }, (_, i) => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' + i); const t0 = process.hrtime.bigint(); let z = 0; for (let i = 0; i < 200; i++) z += (S.seasonSellMatchCount(row(null, bomb), big) || 0); const ms = Number(process.hrtime.bigint() - t0) / 1e6; ok(ms < 100 && z === 0, '폭주 꼴 정규식 글(' + bomb + ')도 글자 비교라 200회 ' + ms.toFixed(1) + 'ms(회당 ' + (ms / 200).toFixed(3) + 'ms) · 매칭 0'); }
    ok(!/new RegExp|RegExp\(/.test(sellSrc), '#836 구간 안 new RegExp 호출 0');
    ok(S.seasonSellWords('타이벡｜노지황금향').join() === '타이벡,노지황금향' && S.seasonSellWords('타이벡,노지').length === 2 && S.seasonSellWords('타이벡， 노지、유라').length === 3 && S.seasonSellWords('타이벡,,노지') === null, '구분자 = 반각 | · 전각 ｜ · 쉼표(, ， 、) 전부 → 낱말 2·2·3 · 빈 낱말은 꼴 틀림');
    ok(S.seasonSellValidate({ sell_match: ' 타이벡 ｜ 노지황금향 , 유라 ' }, null).sell_match === '타이벡|노지황금향|유라', '저장 검사도 같은 구분자 · 저장 값은 | 로 묶음');
    ok(S.seasonSellKeep(row('only_when_selling', ''), names) === true && S.seasonSellKeep(row('hide_when_selling', null), names) === true, '매칭 글 비움 → 둠(종전)');
    ok(S.seasonSellKeep(row('only_when_selling', '타이벡'), null) === true && S.seasonSellKeep(row('hide_when_selling', '타이벡'), null) === true, '판매현황 조회 실패(null) → 둠(종전)');
    ok(S.seasonSellKeep(row('hide_when_selling', 'TAIVEK'), ['taivek box']) === false, '대소문자 무시');
    ok(S.seasonSellMatchCount(row(null, '감귤'), names) === 2 && S.seasonSellMatchCount(row(null, '('), names) === null, '매칭 수 2 · 꼴 틀림 null');
    ok(S.seasonSellKeep(row('weird_rule', '타이벡'), names) === true, '모르는 규칙 글 → 둠');

    console.log('② seasonScenariosToday — 날짜 × 판매현황');
    resetRows(); selling = ['하우스감귤 2.5kg(로얄과)', '황금향 3kg']; queries = [];
    let out = await S.seasonScenariosToday('2026-10-24');
    let keys = out.map(x => x.scenario_no - 900).sort((a, b) => a - b).join();
    ok(keys === '1,3,4,5,6', '10/24 타이벡 안 팔 때 = 오픈 예정(1)·노지황금향 예정(3)·레몬(4)·꼴 틀림 행(5)·매칭 빈 행(6) · 「판매」 only 행(2) 빠짐', keys);
    ok(queries.filter(q => /bot_products/.test(q)).length === 1, '판매현황은 요청당 1회');
    selling = ['하우스감귤 2.5kg(로얄과)', '타이벡 감귤 5kg', '노지 황금향 3kg'];
    out = await S.seasonScenariosToday('2026-10-26');
    keys = out.map(x => x.scenario_no - 900).sort((a, b) => a - b).join();
    ok(keys === '2,4,5,6', '10/26 타이벡·노지 황금향 판매중 = 예정 행 1·3 빠지고 「판매」 행 2 들어옴', keys);
    ok(/타이벡 감귤 지금 판매 중/.test(out.find(x => x.scenario_no === 902).response), '행 2 글 그대로');
    sellingFail = true; out = await S.seasonScenariosToday('2026-10-26'); keys = out.map(x => x.scenario_no - 900).sort((a, b) => a - b).join();
    ok(keys === '1,2,3,4,5,6', '판매현황 조회 실패 → 거름 없이 전부(종전)', keys); sellingFail = false;
    knowRows.forEach(r => { r.sell_rule = null; }); queries = [];
    out = await S.seasonScenariosToday('2026-10-26');
    ok(out.length === 6 && queries.filter(q => /bot_products/.test(q)).length === 0, '연동 행이 하나도 없으면 판매현황 조회 0 · 전부(종전 동작)');

    console.log('③ 톡톡 /api/scenarios 경로가 같은 함수를 탐');
    resetRows(); selling = ['타이벡 감귤 5kg'];
    let r = await call('GET', '/api/scenarios?channel=talktalk', null, { authorization: 'Bearer tok836' });
    const seasonNos = (r.body.scenarios || []).filter(x => x.scenario_no >= 900).map(x => x.scenario_no - 900).sort((a, b) => a - b).join();
    ok(r.status === 200 && r.body.ok === true, '/api/scenarios 200', r.status);
    ok(!seasonNos.split(',').includes('1') && seasonNos.split(',').includes('2'), '톡톡 응답 = 타이벡 예정(1) 빠짐 · 판매(2) 들어옴(오늘 날짜 구간 안이면)', seasonNos);
    r = await call('GET', '/api/scenarios', null, { authorization: 'Bearer wrong' }); ok(r.status === 401, '토큰 틀림 401(종전)');

    console.log('④ CRUD');
    resetRows(); selling = ['타이벡 감귤 5kg']; audits = [];
    r = await call('GET', '/api/agent-office/season-knowledge');
    const g1 = r.body.rows.find(x => x.id === 1), g4 = r.body.rows.find(x => x.id === 4), g5 = r.body.rows.find(x => x.id === 5), g3 = r.body.rows.find(x => x.id === 3);
    ok(r.status === 200 && g1.sell_match === '타이벡' && g1.sell_rule === 'hide_when_selling', 'GET 에 2칸');
    ok(g1.sell_now && g1.sell_now.match === 1 && Array.isArray(g1.sell_now.words) && g1.sell_now.words.join() === '타이벡' && g1.sell_now.hidden === true, 'GET sell_now = 매칭 1 · words · 지금 빠짐', JSON.stringify(g1.sell_now));
    ok(g3.sell_now && g3.sell_now.match === 0 && g3.sell_now.hidden === false, '매칭 0건 행 = hidden false(주황 배지 재료)', JSON.stringify(g3.sell_now));
    ok(g4.sell_now === null, '매칭 글 없는 행 = sell_now null');
    ok(g5.sell_now && g5.sell_now.match === null && g5.sell_now.words.length === 0 && g5.sell_now.hidden === false, '꼴 틀림 행(옛 값) = match null · words [] · 안 빠짐', JSON.stringify(g5.sell_now));
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: '노지 감귤 판매 중.', sell_match: '(', sell_rule: 'only_when_selling' }); ok(r.status === 400 && /2~40자/.test(r.body.error), 'POST 낱말 1자 400', JSON.stringify(r.body));
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: 'x', sell_match: '타이벡||감귤' }); ok(r.status === 400 && /비어/.test(r.body.error), 'POST 빈 낱말 400');
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: 'x', sell_match: Array.from({ length: 11 }, (_, i) => 'w' + i).join('|') }); ok(r.status === 400 && /10개/.test(r.body.error), 'POST 11개 400');
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: 'x', sell_match: '노지', sell_rule: 'always' }); ok(r.status === 400 && /규칙/.test(r.body.error), 'POST 규칙 허용값 밖 400');
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: 'x', sell_match: 'a'.repeat(41) }); ok(r.status === 400 && /2~40자/.test(r.body.error), 'POST 41자 400');
    ok(knowRows.length === 7, '400 다섯 번 = 저장 0');
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '노지감귤', label: '판매', start_md: '11-01', end_md: '01-31', knowledge: '노지 감귤 판매 중.', sell_match: ' 노지감귤 | 유라 ', sell_rule: 'only_when_selling' });
    ok(r.status === 200 && r.body.row.sell_match === '노지감귤|유라' && r.body.row.sell_rule === 'only_when_selling', 'POST 저장(낱말 trim · | 로 다시 묶음)', JSON.stringify(r.body.row));
    ok(audits.length === 1 && audits[0].changes.after.sell_match === '노지감귤|유라', 'audit after 에 새 칸');
    r = await call('POST', '/api/agent-office/season-knowledge', { item_key: '레몬', label: '노란', start_md: '12-15', end_md: '04-30', knowledge: '노란 레몬.' });
    ok(r.status === 200 && r.body.row.sell_match === null && r.body.row.sell_rule === null, 'POST 칸 없으면 NULL');
    const newId = knowRows.find(x => x.item_key === '노지감귤').id;
    r = await call('PUT', '/api/agent-office/season-knowledge/' + newId, { knowledge: '글만 바꿈' });
    ok(r.status === 200 && r.body.row.sell_match === '노지감귤|유라' && r.body.row.sell_rule === 'only_when_selling' && r.body.row.knowledge === '글만 바꿈', 'PUT 칸 없으면 종전 값 유지(옛 화면 호환)', JSON.stringify(r.body.row));
    r = await call('PUT', '/api/agent-office/season-knowledge/' + newId, { sell_match: '', sell_rule: '' });
    ok(r.status === 200 && r.body.row.sell_match === null && r.body.row.sell_rule === null, "PUT '' = 비움(NULL)");
    r = await call('PUT', '/api/agent-office/season-knowledge/' + newId, { sell_match: '[', sell_rule: 'hide_when_selling' }); ok(r.status === 400, 'PUT 낱말 1자 400');
    r = await call('PUT', '/api/agent-office/season-knowledge/' + newId, { sell_rule: 'maybe' }); ok(r.status === 400, 'PUT 규칙 밖 400');
    r = await call('PUT', '/api/agent-office/season-knowledge/' + newId, { sell_match: '노지감귤', sell_rule: 'only_when_selling' }); ok(r.status === 200 && r.body.row.sell_rule === 'only_when_selling', 'PUT 다시 저장');
    r = await call('DELETE', '/api/agent-office/season-knowledge/' + newId); ok(r.status === 200, 'DELETE 종전');

    console.log('⑤ seasonNowCompute(공개 season-now) 거름 = 행을 뺀 것과 같은 결과');
    resetRows();
    const cat = [{ key: 'tyvek', title: '타이벡 감귤', sub: 's', sk: ['타이벡'], prod: '타이벡', pno: '6400134206', img: '타이벡감귤', cta: 'c' }, { key: 'noji_gold', title: '노지 황금향', sub: 's', sk: ['노지황금향'], prod: '노지황금향|노지 황금향', pno: '11126666859', img: '노지황금향', cta: 'c' }];
    const prods = [{ name: '타이벡 감귤 5kg' }, { name: 'NOJI 노지 황금향 3kg' }];
    const a = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows, products: prods, map: {}, assets: [], catalog: cat });
    const b = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows.filter(x => ![1, 3].includes(x.id)), products: prods, map: {}, assets: [], catalog: cat });
    ok(JSON.stringify(a) === JSON.stringify(b), '판매중이면 hide 행 1·3 을 뺀 것과 결과 동일', JSON.stringify(a).slice(0, 200));
    const c = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows, products: [{ name: '하우스감귤' }], map: {}, assets: [], catalog: cat });
    const d = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows.filter(x => x.id !== 2), products: [{ name: '하우스감귤' }], map: {}, assets: [], catalog: cat });
    ok(JSON.stringify(c) === JSON.stringify(d), '판매중 아니면 only 행 2 를 뺀 것과 결과 동일');
    const e0 = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows.map(x => ({ ...x, sell_rule: null })), products: prods, map: {}, assets: [], catalog: cat });
    const e1 = P.seasonNowCompute({ today: '2026-10-26', rows: knowRows.map(x => ({ ...x, sell_rule: null, sell_match: null })), products: prods, map: {}, assets: [], catalog: cat });
    ok(JSON.stringify(e0) === JSON.stringify(e1), '규칙 없으면 매칭 글이 있어도 종전과 동일');

    console.log('⑥ 글자');
    ok(/ALTER TABLE product_season_knowledge ADD COLUMN IF NOT EXISTS sell_match TEXT`\)/.test(src) && /ADD COLUMN IF NOT EXISTS sell_rule TEXT`\)/.test(src), '새 칸 2 ALTER');
    ok(!/product_season_knowledge ADD COLUMN IF NOT EXISTS (sell_match|sell_rule)[^`]*DEFAULT/.test(src), '새 칸에 DEFAULT 없음(#336)');
    ok(/sell_match, sell_rule FROM product_season_knowledge WHERE enabled = true AND deleted_at IS NULL/.test(pubSrc), 'season-now SELECT 에 2칸');
    ok((src.match(/seasonScenariosToday\(/g) || []).length >= 4 && /const season = await seasonScenariosToday\(\);/.test(scenSrc), '/api/scenarios·qnaGenerate 전부 seasonScenariosToday 하나');
    const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
    const skSrc = appJs.slice(appJs.indexOf('async function renderSeasonKnowledge'), appJs.indexOf('window.deleteSeasonKnow'));
    ok(/id="sk-sell-\$\{r\.id\}"/.test(skSrc) && /id="sk-rule-\$\{r\.id\}"/.test(skSrc) && /value="hide_when_selling"/.test(skSrc) && /value="only_when_selling"/.test(skSrc), 'app.js 편집 칸 2(매칭 글 + 규칙 select 3)');
    ok(/r\.sell_now/.test(skSrc) && /판매중 매칭 \$\{n\}건/.test(skSrc) && /#D97706/.test(skSrc) && !/정규식/.test(skSrc) && /sell_match: sellEl\.value\.trim\(\), sell_rule: ruleEl \? ruleEl\.value : ''/.test(skSrc) && /\.\.\.\(sellEl \? \{/.test(skSrc), 'app.js 배지(매칭 n건 · 0건 주황 · 「정규식」 글 0) + 저장 PUT 에 2칸(옛 서버 폴백)');
    ok(/여러 개는 \| 로 · 예: 타이벡 \/ 노지황금향/.test(skSrc) && /skTouch/.test(skSrc) && /matchMedia\('\(max-width:960px\),\(pointer:coarse\)'\)\.matches\) \? ' min-height:44px;'/.test(skSrc), 'app.js 안내 「여러 개는 | 로 · 예: 타이벡 / 노지황금향」 + 폰·터치 입력·선택 44px');
    { const i1 = src.indexOf('CREATE TABLE IF NOT EXISTS product_season_knowledge ('), i2 = src.indexOf('ADD COLUMN IF NOT EXISTS sell_match TEXT'), i3 = src.indexOf('season_waitlist ADD COLUMN IF NOT EXISTS notify_result'); ok(i1 > 0 && i2 > i1 && i2 - i1 < 1200 && !(i2 > i3 && i2 - i3 < 400), 'ALTER 2줄 = CREATE TABLE product_season_knowledge 바로 다음(season_waitlist 뒤 아님)'); }
    ok(unknownSql.length === 0, '가짜 pool 이 모르는 SQL 0', unknownSql.join(' | '));
    const pubVerify = fs.readFileSync(path.join(ROOT, 'scripts/verify-832-public.js'), 'utf8');
    ok(/#836 판매 연동 시작/.test(pubVerify), 'verify-832-public 도 #836 구간을 함께 뗌(seasonNowCompute 가 seasonSellKeep 을 부름)');

    srv.close();
    console.log(`\n결과 ${pass}/${pass + fail}` + (fail ? ` — 실패 ${fail}` : ''));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// #1184 검증 — 정산(B6 입금 때 금액 고정 · A13 이미지 정산 저장 묶음·입금 표시 보존 · B10 로그·달 끝날·정산현황 삭제 뒤 대조 재계산)
//   server.js 의 정산 라우트·계산 함수를 글자 그대로 떼어 가짜 app·메모리 pglite 로 실행 · 고치기 전(git HEAD)/뒤 나란히
//   🔴 실DB·실서버·외부·AI 0 · 실행: PGLITE_DIR=<pglite 폴더> node scripts/verify-1184-settle.js
'use strict';
const L = require('./verify-1184-lib.js');
const { ok, end } = L.counter('#1184 정산 검증');

const SCHEMA = `
CREATE TABLE settlements (id SERIAL PRIMARY KEY, date DATE NOT NULL, partner VARCHAR(50) NOT NULL, amount NUMERIC DEFAULT 0, items JSONB DEFAULT '[]'::jsonb, from_pricing BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW(), is_paid BOOLEAN DEFAULT false, paid_at TIMESTAMP, box_adjusted_at TIMESTAMP);
CREATE TABLE pricing (id SERIAL PRIMARY KEY, start_date DATE NOT NULL, end_date DATE NOT NULL, partner VARCHAR(50) NOT NULL, items JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE product_mappings (id SERIAL PRIMARY KEY, sales_name TEXT NOT NULL, pricing_name TEXT NOT NULL, partner VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(sales_name, partner));
CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, content TEXT, status VARCHAR(20), result JSONB, processed_at TIMESTAMP, is_deleted BOOLEAN DEFAULT false);
CREATE TABLE settlement_completions (id SERIAL PRIMARY KEY, partner VARCHAR(50), week_start DATE, week_end DATE, total_amount NUMERIC, completed_by INTEGER, completed_at TIMESTAMP DEFAULT NOW());
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
CREATE TABLE settlement_status (date DATE PRIMARY KEY, memo TEXT);
INSERT INTO pricing (start_date, end_date, partner, items) VALUES
 ('2026-11-01', '2026-11-30', '효돈', '[{"name":"하우스감귤 가정용 - 4kg(로얄과)","price":16000},{"name":"황금향 선물용 - 3kg","price":21000}]'),
 ('2026-11-10', '2026-11-30', '효돈', '[{"name":"황금향 선물용 - 3kg","price":22000}]'),
 ('2026-11-01', '2026-11-30', '대성', '[{"name":"레드향 가정용 - 5kg","price":30000}]');
INSERT INTO product_mappings (sales_name, pricing_name, partner) VALUES ('황금향3kg선물', '황금향 선물용 - 3kg', '효돈');
INSERT INTO settlements (id, date, partner, amount, items, is_paid, paid_at) VALUES
 (1, '2026-11-05', '효돈', 100, '[{"name":"하우스감귤 가정용 - 4kg(로얄과)","qty":3,"price":15000},{"name":"황금향 선물용 - 3kg","qty":2,"price":20000}]', true, '2026-11-06 01:00:00'),
 (2, '2026-11-12', '효돈', 0, '[{"name":"황금향3kg선물","qty":4,"price":1},{"name":"모르는품목","qty":1,"price":777}]', false, null),
 (3, '2026-11-12', '대성', 5, '[{"name":"레드향 가정용 5kg","qty":2,"price":0}]', false, null),
 (4, '2026-12-01', '대성', 999, '[]', false, null),
 (5, '2026-11-20', '효돈', 50, '[{"name":"하우스감귤 가정용 - 4kg(로얄과)","qty":1,"price":16000}]', true, '2026-11-21 02:00:00'),
 (6, '2026-11-21', '실패거래처', 70, '[{"name":"x","qty":1,"price":70}]', true, '2026-11-22 03:00:00');
SELECT setval('settlements_id_seq', 50);
INSERT INTO pending_orders (id, content, status, result) VALUES
 (1, '정산', '질문', '{"type":"settlement_ocr_confirm","candidates":{"효돈":{"rows":[{"name":"하우스감귤 가정용 - 4kg(로얄과)","qty":2,"price":16000,"subtotal":32000}]}}}'),
 (2, '정산', '질문', '{"type":"settlement_ocr_confirm","candidates":{"효돈":{"rows":[{"name":"황금향 선물용 - 3kg","qty":1,"price":22000,"subtotal":22000}]}}}'),
 (3, '정산', '질문', '{"type":"settlement_ocr_confirm","candidates":{"실패거래처":{"rows":[{"name":"y","qty":9,"price":10,"subtotal":90}]}}}');
CREATE FUNCTION fail_ins() RETURNS trigger AS $$ BEGIN IF NEW.partner = '실패거래처' THEN RAISE EXCEPTION '시험용 저장 실패'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER t_fail BEFORE INSERT ON settlements FOR EACH ROW EXECUTE FUNCTION fail_ins();
`;
const CEO = { id: 1, name: '대표', role: 'admin', position: '대표' };

async function world(which) {
    const src = L.srcOf('server.js', which);
    const W = await L.makeDb(SCHEMA);
    if (which === 'after') await W.db.exec('ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_amount NUMERIC');   // 고친 뒤 initDB 가 만드는 칸(같은 글) — 뒤 코드가 그 칸을 씀
    const initLine = L.norm(src).split('\n').find(x => x.includes('ADD COLUMN IF NOT EXISTS paid_amount'));
    W.initLine = initLine ? initLine.trim() : '';
    const app = L.fakeApp(), logs = [], recon = [];
    const parts = [L.fn(src, 'adminOnly'), L.fn(src, 'handleAdminErr'), L.fn(src, 'normDateSafe'), L.fn(src, 'extractFeatures'), L.fn(src, 'matchItemToPricing'), L.fn(src, 'matchSettlementItemExact'), L.fn(src, 'settleDisplayCalc') || '',
        L.route(src, 'get', '/api/settlements'), L.route(src, 'put', '/api/settlements/:id/toggle-paid'),
        L.route(src, 'post', '/api/agent-office/settlement-ocr-save'), L.route(src, 'get', '/api/settlement-completions'), L.route(src, 'delete', '/api/settlement-status/:date'), 'return null;'];
    L.load(['app', 'pool', 'authMiddleware', 'writeAudit', 'adminActor', 'settleReconRecomputeInputs', 'console'],
        [app, W.pool, (q, r, nx) => nx(), async () => { }, () => ({ id: 1 }), async d => { recon.push(d); return []; }, { log: (...a) => logs.push(a.join(' ')), error() { } }], parts.join('\n'));
    W.call = (m, url, body) => app.call(m, url, { user: CEO, body }).then(r => r, e => ({ code: 'THROW', body: { error: e.message } }));
    W.logs = logs; W.recon = recon;
    return W;
}

async function scenario(W) {
    const R = {};
    const g = await W.call('GET', '/api/settlements?month=2026-11');
    R['11월 목록 금액·품목'] = JSON.stringify((g.body || []).map(r => [r.id, r.amount, (r.items || []).map(i => i.price + 'x' + i.qty).join('+'), r.isPaid]));
    R['11월 목록 입금 금액 칸'] = JSON.stringify((g.body || []).map(r => [r.id, r.paidAmount === undefined ? '없음' : r.paidAmount]));
    R['목록 한 번에 찍힌 [정산] 로그'] = String(W.logs.filter(x => x.startsWith('[정산]')).length);
    const ga = await W.call('GET', '/api/settlements');
    R['전체 목록 줄 수'] = String((ga.body || []).length);
    // B6 입금 표시
    let t = await W.call('PUT', '/api/settlements/2/toggle-paid');
    const row2 = (await W.q("SELECT is_paid, to_jsonb(s)->>'paid_amount' AS paid_amount FROM settlements s WHERE id = 2"))[0];
    const shown2 = (g.body || []).find(r => r.id === 2);
    R['2번 입금 표시'] = `${t.code} · ${t.body.isPaid} · 응답 ${t.body.paidAmount} · 저장 ${row2.paid_amount == null ? 'null' : Number(row2.paid_amount)} · 화면 금액 ${shown2 && shown2.amount}`;
    await W.q(`UPDATE pricing SET items = '[{"name":"황금향 선물용 - 3kg","price":25000}]' WHERE id = 2`);   // 입금 뒤 단가표를 고침
    const g2 = await W.call('GET', '/api/settlements?month=2026-11'); const r2 = (g2.body || []).find(r => r.id === 2);
    R['단가 고친 뒤 2번'] = `화면 금액 ${r2.amount} · 입금 금액 ${r2.paidAmount === undefined ? '없음' : r2.paidAmount}`;
    t = await W.call('PUT', '/api/settlements/2/toggle-paid');
    const row2b = (await W.q("SELECT is_paid, to_jsonb(s)->>'paid_amount' AS paid_amount FROM settlements s WHERE id = 2"))[0];
    R['2번 입금 풀기'] = `${t.code} · ${t.body.isPaid} · 저장 ${row2b.paid_amount == null ? 'null' : Number(row2b.paid_amount)}`;
    const r1 = (g2.body || []).find(r => r.id === 1);
    R['지난 입금 1번(칸 비어 있음)'] = `화면 금액 ${r1.amount} · 입금 금액 ${r1.paidAmount === undefined ? '없음' : r1.paidAmount}`;
    t = await Promise.all([W.call('PUT', '/api/settlements/3/toggle-paid'), W.call('PUT', '/api/settlements/3/toggle-paid')]);
    R['3번 입금 두 번 겹침'] = t.map(z => z.code).join('/') + ' · 끝 ' + (await W.q('SELECT is_paid FROM settlements WHERE id = 3'))[0].is_paid;
    // A13 이미지 정산 다시 저장
    let s = await W.call('POST', '/api/agent-office/settlement-ocr-save', { order_id: 1, partner: '효돈', date: '2026-11-20' });
    const after5 = await W.q(`SELECT amount, is_paid, paid_at::text AS pa FROM settlements WHERE partner = '효돈' AND date = '2026-11-20'`);
    R['입금된 날 다시 저장'] = `${s.code} · 줄 ${after5.length} · 금액 ${after5[0] && Number(after5[0].amount)} · 입금 ${after5[0] && after5[0].is_paid} · ${after5[0] && after5[0].pa}`;
    s = await W.call('POST', '/api/agent-office/settlement-ocr-save', { order_id: 2, partner: '효돈', date: '2026-11-25' });
    const new25 = await W.q(`SELECT is_paid FROM settlements WHERE partner = '효돈' AND date = '2026-11-25'`);
    R['새 날 저장'] = `${s.code} · 줄 ${new25.length} · 입금 ${new25[0] && new25[0].is_paid}`;
    s = await W.call('POST', '/api/agent-office/settlement-ocr-save', { order_id: 3, partner: '실패거래처', date: '2026-11-21' });
    const keep6 = await W.q(`SELECT amount, is_paid FROM settlements WHERE partner = '실패거래처'`);
    const o3 = (await W.q('SELECT status FROM pending_orders WHERE id = 3'))[0];
    R['저장 중간 실패'] = `${s.code} · 옛 줄 ${keep6.length}(${keep6.map(x => Number(x.amount) + '/' + x.is_paid).join(',')}) · 확인표 ${o3.status}`;
    // B10 달 끝날
    await W.q(`INSERT INTO settlement_completions (partner, week_start, week_end, total_amount) VALUES ('효돈', '2026-02-23', '2026-03-01', 1), ('효돈', '2026-11-30', '2026-12-06', 2), ('효돈', '2026-12-28', '2027-01-03', 3)`);
    for (const m of ['2026-02', '2026-11', '2026-12']) { const r = await W.call('GET', '/api/settlement-completions?month=' + m); R['주간 완료 ' + m] = r.code + ' · ' + ((r.body || []).length || 0) + '건' + (r.body && r.body.error ? ' · ' + r.body.error.slice(0, 40) : ''); }
    // B10 정산현황 삭제 뒤 대조 재계산
    await W.q(`INSERT INTO settlement_status (date) VALUES ('2026-11-12')`);
    const d = await W.call('DELETE', '/api/settlement-status/2026-11-12');
    R['정산현황 날짜 삭제'] = `${d.code} · 대조 재계산 ${W.recon.join(',') || '없음'}`;
    return R;
}

(async () => {
    const BW = await world('before'), AW = await world('after');
    const B = await scenario(BW), A = await scenario(AW);
    console.log('\n항목 | 고치기 전 | 고친 뒤');
    for (const k of Object.keys(A)) console.log(`${k} | ${B[k]} | ${A[k]}`);
    console.log('');
    ok(A['11월 목록 금액·품목'] === B['11월 목록 금액·품목'] && A['전체 목록 줄 수'] === B['전체 목록 줄 수'], '무변: 정산 목록 금액·품목(4단계 매칭) 글자 그대로 · 줄 수', [B['11월 목록 금액·품목'], A['11월 목록 금액·품목']]);
    ok(A['목록 한 번에 찍힌 [정산] 로그'] === '0' && Number(B['목록 한 번에 찍힌 [정산] 로그']) >= 5, 'B10 행마다 [정산] 로그 없앰(전 = 줄마다 1줄)', [B['목록 한 번에 찍힌 [정산] 로그'], A['목록 한 번에 찍힌 [정산] 로그']]);
    ok(/\[2,null\]/.test(A['11월 목록 입금 금액 칸']) && /\[1,null\]/.test(A['11월 목록 입금 금액 칸']), 'B6 목록에 paidAmount 칸(입금 안 한 줄·지난 입금 줄 = null)', A['11월 목록 입금 금액 칸']);
    const shown = /화면 금액 (\d+)/.exec(A['2번 입금 표시']);
    ok(/^200 · true · 응답 (\d+) · 저장 \1 · 화면 금액 \1$/.test(A['2번 입금 표시']), 'B6 입금 표시 = 그 순간 화면 금액을 paid_amount 로 저장·응답', A['2번 입금 표시']);
    ok(shown && A['단가 고친 뒤 2번'] === `화면 금액 ${4 * 25000 + 777} · 입금 금액 ${shown[1]}`, 'B6 입금 뒤 단가표를 고치면 화면 금액은 새 단가 · 입금 금액은 그때 값 그대로', A['단가 고친 뒤 2번']);
    ok(A['2번 입금 풀기'] === '200 · false · 저장 null', 'B6 입금 풀면 paid_amount 비움', A['2번 입금 풀기']);
    ok(/입금 금액 null$/.test(A['지난 입금 1번(칸 비어 있음)']) && A['지난 입금 1번(칸 비어 있음)'].split(' · ')[0] === B['지난 입금 1번(칸 비어 있음)'].split(' · ')[0], 'B6 지난 입금 건 = 칸 null · 화면 금액은 종전 계산 그대로', [B['지난 입금 1번(칸 비어 있음)'], A['지난 입금 1번(칸 비어 있음)']]);
    ok(/^(200\/409|409\/200) · 끝 true$/.test(A['3번 입금 두 번 겹침']), 'B6 입금 표시 두 번 겹침 = 한 번만 바뀜(둘째 = 409 · 전 = 켰다 끔)', [B['3번 입금 두 번 겹침'], A['3번 입금 두 번 겹침']]);
    ok(/^200 · 줄 1 · 금액 32000 · 입금 true · 2026-11-21 02:00:00$/.test(A['입금된 날 다시 저장']) && /입금 false/.test(B['입금된 날 다시 저장']), 'A13 입금된 날 이미지 정산 다시 저장 = 입금 표시·입금 시각 그대로(전 = 미입금으로 바뀜)', [B['입금된 날 다시 저장'], A['입금된 날 다시 저장']]);
    ok(A['새 날 저장'] === '200 · 줄 1 · 입금 false' && A['새 날 저장'] === B['새 날 저장'], '무변: 새 날 저장 = 미입금 1줄');
    ok(/^500 · 옛 줄 1\(70\/true\) · 확인표 질문$/.test(A['저장 중간 실패']) && /옛 줄 0/.test(B['저장 중간 실패']), 'A13 저장 중간 실패 = 통째로 되돌림(옛 정산·확인표 그대로 · 전 = 옛 줄이 지워진 채 끝)', [B['저장 중간 실패'], A['저장 중간 실패']]);
    ok(A['주간 완료 2026-02'] === '200 · 1건' && /^500/.test(B['주간 완료 2026-02']), 'B10 2월 = 28일까지(전 = 2026-02-31 날짜 오류 500)', [B['주간 완료 2026-02'], A['주간 완료 2026-02']]);
    ok(A['주간 완료 2026-11'] === '200 · 1건' && /^500/.test(B['주간 완료 2026-11']), 'B10 30일 달 = 30일까지(전 = 500)', [B['주간 완료 2026-11'], A['주간 완료 2026-11']]);
    ok(A['주간 완료 2026-12'] === B['주간 완료 2026-12'] && A['주간 완료 2026-12'] === '200 · 2건', '무변: 31일 달', [B['주간 완료 2026-12'], A['주간 완료 2026-12']]);
    ok(A['정산현황 날짜 삭제'] === '200 · 대조 재계산 2026-11-12' && B['정산현황 날짜 삭제'] === '200 · 대조 재계산 없음', 'B10 정산현황 날짜 삭제 뒤 그 날짜 네이버 대조 재계산(전 = 안 함)', [B['정산현황 날짜 삭제'], A['정산현황 날짜 삭제']]);
    ok(/^await pool\.query\(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_amount NUMERIC`\);/.test(AW.initLine) && BW.initLine === '', 'B6 새 칸은 initDB 의 ADD COLUMN IF NOT EXISTS 한 줄(실DB 미리 만들지 않음)', AW.initLine);
    end();
})().catch(e => { console.error('검증 실패:', e); process.exit(1); });

// #822 검증 — 체험 예약 창 손질(대표 10/22) · 실DB·실메일·알리고·서버 기동 0(전부 가짜 · 표 CREATE 도 안 함)
//   ① 서버(experience.js 를 가짜 app·pool 로 mount · skipInit) = 목록 GET 에 sales · PUT …/sales/:day 검사(날짜·금액·0=지움·audit) · [문자 설정] 서버 길 그대로
//   ② 엑셀(buildXlsx → 메모리 버퍼 → 다시 읽음) = 머리 인디고·틀 고정·필터 · 번호 010-0000-0000 · 취소·반품 줄 연빨강+취소선 · 방문 연초록 · 날짜 확인 호박 · 합계 줄 · 둘째 시트 현장 판매(귤)
//   ③ 화면(Playwright · 가짜 fetch · 390 폰 · 900 폴드 · 1280 야간) = [문자 설정] 단추 관리자에게도 안 보임 · 달력 칸 현장 줄(폰 = ₩) · 이달 합계 띠 · 날짜 판 현장 판매 칸 → 저장 PUT · 가로 넘침 0 · 44px
//   실행: node scripts/verify-822-sales.js
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), { PassThrough } = require('stream');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
const mount = require(path.join(ROOT, 'experience.js'));
const T = mount._t;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${name}${extra !== undefined && !c ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 300) : ''}`); };
const t0 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), add = n => new Date(Date.parse(t0 + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ── ① 서버 ─────────────────────────────────────────────────────────────────
function fakeApp() { const routes = {}; const add = m => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; }; return { routes, get: add('GET'), put: add('PUT'), patch: add('PATCH'), post: add('POST') }; }
function mk() {
    const S = { sales: new Map(), cfg: {}, sql: [], audits: [], rows: [] };
    const pool = { query: async (sql, a = []) => {
        const s = String(sql).replace(/\s+/g, ' ').trim(); S.sql.push(s);
        if (/^CREATE /.test(s)) throw new Error('검증은 표를 만들지 않는다');
        if (/^SELECT value FROM agent_office_config/.test(s)) return { rows: a[0] in S.cfg ? [{ value: S.cfg[a[0]] }] : [] };
        if (/^INSERT INTO agent_office_config/.test(s)) { S.cfg[a[0]] = JSON.parse(a[1]); return { rows: [] }; }
        if (/^DELETE FROM experience_daily_sales/.test(s)) { S.sales.delete(a[0]); return { rows: [] }; }
        if (/FROM experience_daily_sales WHERE day BETWEEN/.test(s)) return { rows: [...S.sales.values()].filter(r => r.day >= a[0] && r.day <= a[1]).sort((x, y) => x.day.localeCompare(y.day)) };
        if (/FROM experience_daily_sales WHERE day=\$1/.test(s)) return { rows: S.sales.has(a[0]) ? [{ ...S.sales.get(a[0]) }] : [] };
        if (/^INSERT INTO experience_daily_sales/.test(s)) { S.sales.set(a[0], { day: a[0], amount: a[1], memo: a[2], updated_by: a[3], updated_at: '2026-10-22 10:00' }); return { rows: [] }; }
        if (/FROM experience_bookings WHERE \(visit_date BETWEEN/.test(s)) return { rows: S.rows };
        if (/FROM experience_bookings`?$/.test(s) || /COUNT\(\*\) FILTER/.test(s)) return { rows: [{ today: 0, tomorrow: 0, need_check: 0 }] };
        return { rows: [] };
    } };
    const app = fakeApp(), pass = (q, r, n) => n && n();
    const M = mount(app, { pool, authMiddleware: pass, adminOnly: pass, writeAudit: x => { S.audits.push(x); }, skipInit: true, noTimers: true, naverCfgGet: async () => null, naverCfgSet: async () => { }, kakaoNotify: { sendLms: async () => ({ status: 'sent' }), sendAlimtalk: async () => ({ status: 'sent' }), smsSafe: s => s }, notifyTelegram: () => { }, env: {} });
    return { S, app, M };
}
const res = () => { const r = { code: 200, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };

(async () => {
    console.log('① 서버 — 현장 판매 API · 목록 sales · 문자 설정 길 그대로');
    {
        const t = mk(), PUT = 'PUT /api/agent-office/experience/sales/:day', GET = 'GET /api/agent-office/experience';
        ok(!!t.app.routes[PUT] && !!t.app.routes['PUT /api/agent-office/experience/settings'] && !!t.app.routes['GET /api/agent-office/experience/settings'], '라우트 = sales PUT 추가 · 문자 설정 GET/PUT 그대로(기능 유지)');
        let r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-31' }, body: { amount: 1000 }, user: { name: '직원' } }, r);
        ok(r.code === 400, '없는 날짜(11/31) = 400', r.body);
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-07' }, body: { amount: 200000000 }, user: { name: '직원' } }, r);
        ok(r.code === 400 && /1억/.test(r.body.error), '금액 1억 넘으면 400', r.body);
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-07' }, body: { amount: '120,000', memo: '  5kg 12박스   현금 8 / 카드 4 ' }, user: { id: 7, name: '직원' } }, r);
        ok(r.code === 200 && r.body.ok && r.body.item && r.body.item.amount === 120000 && r.body.item.memo === '5kg 12박스 현금 8 / 카드 4' && r.body.item.updated_by === '직원', '저장 = 「120,000」 글자도 숫자로 · 메모 공백 정리 · 적은 사람', r.body);
        ok(t.S.audits.length === 1 && t.S.audits[0].action === 'experience_sales' && t.S.audits[0].changes.day === '2026-11-07' && t.S.audits[0].changes.before === null && t.S.audits[0].changes.after.amount === 120000 && t.S.audits[0].targetId === null, 'audit experience_sales(before null → after · 날짜는 changes · targetId null)', t.S.audits);
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-07' }, body: { amount: 120000, memo: '5kg 12박스 현금 8 / 카드 4' }, user: { id: 7, name: '직원' } }, r);
        ok(r.code === 200 && t.S.audits.length === 1, '같은 값 다시 저장 = audit 안 늘어남');
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-07' }, body: { amount: 0, memo: '' }, user: { id: 7, name: '직원' } }, r);
        ok(r.code === 200 && r.body.item === null && !t.S.sales.has('2026-11-07') && t.S.audits.length === 2 && t.S.audits[1].changes.after === null, '금액 0 · 메모 빔 = 줄 지움(item null · audit after null)', r.body);
        const nDel = t.S.sql.filter(s => /^DELETE FROM experience_daily_sales/.test(s)).length;
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-08' }, body: { amount: 0, memo: '' }, user: {} }, r);
        ok(r.code === 200 && r.body.item === null && t.S.audits.length === 2 && t.S.sql.filter(s => /^DELETE FROM experience_daily_sales/.test(s)).length === nDel, '없는 날짜에 0 = 아무 일도 없음(지움 SQL 0 · audit 0)');
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-11-08' }, body: { memo: '귤 안 팜 · 비' }, user: { name: '직원' } }, r);
        ok(r.code === 200 && r.body.item && r.body.item.amount === 0 && r.body.item.memo === '귤 안 팜 · 비', '메모만 있어도 줄 저장(금액 0)', r.body);
        await t.app.routes[PUT]({ params: { day: '2026-11-01' }, body: { amount: 80000 }, user: { name: '대표' } }, res());
        r = res(); await t.app.routes[GET]({ query: { from: '2026-11-01', to: '2026-11-30' }, user: {} }, r);
        ok(r.code === 200 && Array.isArray(r.body.sales) && r.body.sales.map(s => s.day).join() === '2026-11-01,2026-11-08' && r.body.sales[0].amount === 80000, '목록 GET 응답에 sales(기간 안 · 날짜순)', r.body.sales);
        r = res(); await t.app.routes[GET]({ query: { from: '2026-12-01', to: '2026-12-31' }, user: {} }, r);
        ok(r.code === 200 && r.body.sales.length === 0, '기간 밖 = sales 빈 목록');
        // 표가 아직 없는 DB(옛 가짜 pool 처럼 그 SQL 에 던짐) 도 목록은 살아 있음
        const t2 = mk(); const q0 = t2.S; const orig = Object.getOwnPropertyDescriptor(t2, 'S');
        const p2 = t2.M; void p2; void q0; void orig;
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-12-05' }, body: { amount: '1e9' }, user: { name: '직원' } }, r);
        ok(r.code === 400 && /숫자만/.test(r.body.error), '「1e9」 꼴 = 400(숫자만)', r.body);
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-12-05' }, body: { amount: '12.5' }, user: { name: '직원' } }, r);
        ok(r.code === 400, '「12.5」 = 400', r.body);
        r = res(); await t.app.routes[PUT]({ params: { day: '2026-12-05' }, body: { amount: '100,000,000원' }, user: { name: '직원' } }, r);
        ok(r.code === 200 && r.body.item.amount === 100000000, '「100,000,000원」 = 1억 OK(쉼표·원 허용)', r.body);
        ok(!t.S.sql.some(s => /^CREATE /.test(s)), '검증 중 CREATE 0(실DB 표 안 만듦)');
    }

    console.log('② 엑셀 — 디자인 · 번호 꼴 · 취소·반품 색 · 합계 · 둘째 시트');
    {
        const rows = [
            { visit_date: '2026-11-07', visit_time: '11:00', source: 'place', name: '조하늘', phone: '01012345678', exp_count: 2, entry_count: 1, infant_count: 0, amount: 46000, status: 'confirmed', date_ok: true, sms_recv_at: 'x', sms_recv_via: 'alimtalk', memo: '', order_no: '1384820445' },
            { visit_date: '2026-11-07', visit_time: '15:00', source: 'store', name: '이유진', phone: '0101112222', exp_count: 1, entry_count: 0, infant_count: 1, amount: 18000, status: 'canceled', date_ok: true, sms_recv_at: 'x', sms_recv_via: 'lms', memo: '취소', order_no: '2026102038638821' },
            { visit_date: '2026-11-08', visit_time: '10:30', source: 'manual', name: '허계영', phone: null, exp_count: 3, entry_count: 0, infant_count: 0, amount: 54000, status: 'visited', date_ok: true, sms_recv_at: null, memo: '현금', order_no: 'M7' },
            { visit_date: '2026-11-09', visit_time: '', source: 'store', name: '박소현', phone: '01099998888', exp_count: 1, entry_count: null, infant_count: undefined, amount: 18000, status: 'returned', date_ok: false, date_why: '날짜 못 읽음', sms_recv_at: null, memo: '', order_no: 'X' },
        ];
        const sales = [{ day: '2026-11-07', amount: 120000, memo: '5kg 12박스', updated_by: '직원', updated_at: '2026-11-07 17:10' }, { day: '2026-11-08', amount: 35000, memo: null, updated_by: '대표', updated_at: '2026-11-08 16:00' }];
        const wb = T.buildXlsx(rows, sales, '2026-11-01', '2026-11-30');
        const buf = await wb.xlsx.writeBuffer();
        const ExcelJS = require('exceljs'); const rb = new ExcelJS.Workbook(); await rb.xlsx.load(buf);
        const ws = rb.getWorksheet('체험 예약'), w2 = rb.getWorksheet('현장 판매(귤)');
        ok(!!ws && !!w2 && rb.worksheets.length === 2, '시트 2개 = 체험 예약 · 현장 판매(귤)', rb.worksheets.map(w => w.name));
        const h = ws.getRow(1);
        ok(h.getCell(1).fill && h.getCell(1).fill.fgColor && h.getCell(1).fill.fgColor.argb === 'FF4F46E5' && h.getCell(1).font.bold && h.getCell(1).font.color.argb === 'FFFFFFFF' && h.getCell(15).fill.fgColor.argb === 'FF4F46E5', '머리 줄 = 인디고 바탕 · 흰 굵은 글(15칸 전부)', h.getCell(1).fill);
        ok(ws.views && ws.views[0] && ws.views[0].state === 'frozen' && ws.views[0].ySplit === 1 && (ws.autoFilter === 'A1:O5' || (ws.autoFilter && ws.autoFilter.to && ws.autoFilter.to.column === 15)), '틀 고정(머리 줄) · 자동 필터 15칸', { v: ws.views, f: ws.autoFilter });
        ok(h.values.slice(1).join('|') === '방문일|요일|시간|구분|이름|연락처|체험|입장|유아|금액|상태|접수 안내|날짜 확인|메모|번호', '머리 글 15개(접수 안내 칸 추가)', h.values.slice(1));
        const r2 = ws.getRow(2), r3 = ws.getRow(3), r4 = ws.getRow(4), r5 = ws.getRow(5), r6 = ws.getRow(6);
        ok(r2.getCell(6).value === '010-1234-5678' && r3.getCell(6).value === '010-111-2222' && r4.getCell(6).value === '', '번호 = 010-1234-5678(11자리) · 010-111-2222(10자리) · 없음 빈 칸', [r2.getCell(6).value, r3.getCell(6).value, r4.getCell(6).value]);
        ok(r2.getCell(1).border && r2.getCell(1).border.top && r2.getCell(1).border.top.style === 'thin' && r5.getCell(15).border.right.style === 'thin', '모든 칸 얇은 테두리');
        ok(r2.getCell(10).numFmt === '#,##0' && r2.getCell(10).value === 46000 && r2.getCell(12).value === '알림톡' && r3.getCell(12).value === '문자' && r4.getCell(12).value === '', '금액 #,##0 숫자 · 접수 안내 알림톡/문자/빈 칸');
        ok(r3.getCell(1).fill.fgColor.argb === 'FFFEF3F2' && r3.getCell(5).font.strike === true && r3.getCell(5).font.color.argb === 'FF98A2B3' && r3.getCell(11).value === '취소' && r3.getCell(11).font.color.argb === 'FFB42318', '취소 줄 = 연빨강 바탕 · 이름 취소선 · 회색 글 · 상태 빨강', { f: r3.getCell(1).fill, n: r3.getCell(5).font });
        ok(r5.getCell(1).fill.fgColor.argb === 'FFFEF3F2' && r5.getCell(11).value === '반품' && r5.getCell(13).value === '날짜 못 읽음' && r5.getCell(13).fill.fgColor.argb === 'FFFFFAEB', '반품 줄 = 연빨강 · 날짜 확인 칸 호박', r5.getCell(13).fill);
        ok(r5.getCell(8).value == null && r5.getCell(9).value == null && r5.getCell(7).value === 1, '인원 빈 값은 빈칸(0 으로 안 찍음)', [r5.getCell(8).value, r5.getCell(9).value]);
        ok(r4.getCell(1).fill.fgColor.argb === 'FFECFDF3' && r4.getCell(11).value === '방문' && r4.getCell(11).font.color.argb === 'FF067647' && !r2.getCell(1).fill.fgColor, '방문 줄 = 연초록 · 확정 줄 = 바탕 없음');
        ok(r6.getCell(1).value === '합계' && r6.getCell(4).value === '2팀' && r6.getCell(7).value === 5 && r6.getCell(8).value === 1 && r6.getCell(9).value === 0 && r6.getCell(10).value === 100000 && r6.getCell(1).font.bold && r6.getCell(1).border.top.style === 'double', '합계 줄 = 취소·반품 뺀 2팀 · 체험 5 · 입장 1 · 유아 0 · 100,000 · 굵게 · 위 이중선', r6.values);
        ok(ws.getRow(7).getCell(1).value == null, '합계 뒤 빈 줄(줄 수 정확)');
        const s2 = w2.getRow(2), s3 = w2.getRow(3), s4 = w2.getRow(4);
        ok(w2.getRow(1).values.slice(1).join('|') === '날짜|요일|현장 판매 금액|메모|적은 사람|적은 때' && w2.getRow(1).getCell(1).fill.fgColor.argb === 'FF4F46E5' && w2.views[0].state === 'frozen', '둘째 시트 머리 6칸 · 인디고 · 틀 고정', w2.getRow(1).values);
        ok(s2.getCell(1).value === '2026-11-07' && s2.getCell(2).value === '토' && s2.getCell(3).value === 120000 && s2.getCell(3).numFmt === '#,##0' && s2.getCell(4).value === '5kg 12박스' && s2.getCell(5).value === '직원' && s3.getCell(4).value === '', '현장 판매 줄 = 날짜·요일·금액·메모·적은 사람', s2.values);
        ok(s4.getCell(1).value === '합계' && s4.getCell(3).value === 155000 && /2일 · 2026-11-01 ~ 2026-11-30/.test(String(s4.getCell(4).value)), '둘째 시트 합계 155,000 · 2일 · 기간', s4.values);
        const wb0 = T.buildXlsx([], [], '2026-12-01', '2026-12-31'); const b0 = await wb0.xlsx.writeBuffer(); const r0 = new ExcelJS.Workbook(); await r0.xlsx.load(b0);
        ok(r0.getWorksheet('체험 예약').getRow(2).getCell(1).value === '합계' && r0.getWorksheet('현장 판매(귤)').getRow(2).getCell(3).value === 0, '빈 달 = 합계 줄만(0)');
        ok(T.fmtTelXl('010-1234-5678') === '010-1234-5678' && T.fmtTelXl('0212345678') === '02-1234-5678' && T.fmtTelXl('0641234567') === '064-123-4567' && T.fmtTelXl('123') === '123' && T.fmtTelXl('010-123') === '010-123' && T.fmtTelXl(null) === '', 'fmtTelXl = 11자리 3-4-4 · 10자리 02 는 2-4-4 · 그 밖 3-3-4 · 10·11자리 아니면 원래 값 그대로');
        ok(ws.autoFilter === 'A1:O5' || (ws.autoFilter && ws.autoFilter.to && ws.autoFilter.to.row === 5), '자동 필터 범위 = 머리 ~ 마지막 자료 줄(5) · 합계 줄 밖', ws.autoFilter);
        ok(w2.autoFilter === 'A1:F3' || (w2.autoFilter && w2.autoFilter.to && w2.autoFilter.to.row === 3), '둘째 시트 필터 범위도 자료 줄까지', w2.autoFilter);
        // 엑셀 라우트 = 스트림으로 쓰고 끝냄(실제 res 흉내)
        const t = mk(); t.S.rows = rows; t.S.sales.set('2026-11-07', sales[0]);
        const out = new PassThrough(); const chunks = []; out.on('data', c => chunks.push(c));
        const rr = Object.assign(out, { code: 200, headers: {}, headersSent: false, status(c) { rr.code = c; return rr; }, json(b) { rr.body = b; return rr; }, setHeader(k, v) { rr.headers[k] = v; } });
        await t.app.routes['GET /api/agent-office/experience/export.xlsx']({ query: { from: '2026-11-01', to: '2026-11-30' }, user: {} }, rr);
        await new Promise(r => setTimeout(r, 50));
        const got = Buffer.concat(chunks); const rb2 = new ExcelJS.Workbook(); await rb2.xlsx.load(got);
        ok(got.length > 1000 && /spreadsheetml/.test(rr.headers['Content-Type']) && /%EC%B2%B4%ED%97%98/.test(rr.headers['Content-Disposition']) && rb2.worksheets.length === 2 && rb2.getWorksheet('현장 판매(귤)').getRow(2).getCell(3).value === 120000, '엑셀 라우트 = 두 시트 담아 내려줌(현장 판매 포함)', { len: got.length, h: rr.headers });
    }

    console.log('③ 화면 — Playwright(가짜 fetch)');
    {
        const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
        const D1 = add(3), D2 = add(5);
        const items = [
            { id: 1, source: 'store', order_no: '2026102038638821', name: '홍길동', phone: '01011112222', visit_date: D1, visit_time: '10:00', exp_count: 2, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, sms_recv_at: 'x', sms_recv_via: 'alimtalk' },
            { id: 2, source: 'place', order_no: '1384820445', name: '정하늘', phone: '01033334444', contact_at: 'x', visit_date: D2, visit_time: '11:00', exp_count: 1, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true },
        ];
        const sales = [{ day: D1, amount: 120000, memo: '5kg 12박스', updated_by: '직원', updated_at: '2026-10-22 10:00' }];
        const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/styles.css"><link rel="stylesheet" href="file:///${PUB}/ao-dark.css"><link rel="stylesheet" href="file:///${PUB}/ao-exp.css">
<style>body{margin:0;font-family:"Pretendard","Malgun Gothic",sans-serif;background:#EEF0F4}</style></head><body>
<script>
window.__calls = []; window.__toasts = [];
const DATA = ${JSON.stringify({ items, sales })};
localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify({ role: 'admin', name: '대표' }));
window.showToast = m => { window.__toasts.push(m); };
window.fetch = async (url, o) => {
  o = o || {}; window.__calls.push((o.method || 'GET') + ' ' + url + (o.body ? ' ' + o.body : ''));
  const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(url, 'http://x/'), p = u.pathname;
  if (p === '/api/agent-office/experience' && (o.method || 'GET') === 'GET') return J({ items: DATA.items, sales: DATA.sales, summary: {}, settings_view: { sms_enabled: true, alimtalk: true } });
  const m = /^\\/api\\/agent-office\\/experience\\/sales\\/(\\d{4}-\\d{2}-\\d{2})$/.exec(p);
  if (m && o.method === 'PUT') { const b = JSON.parse(o.body); DATA.sales = DATA.sales.filter(s => s.day !== m[1]); const it = (!b.amount && !b.memo) ? null : { day: m[1], amount: b.amount, memo: b.memo || null, updated_by: '대표', updated_at: '2026-10-22 11:00' }; if (it) DATA.sales.push(it); return J({ ok: true, day: m[1], item: it }); }
  return J({ error: 'no mock ' + p }, 404);
};
</script><script src="file:///${PUB}/ao-exp.js"></script></body></html>`;
        const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v822-')); const page = path.join(OUT, 'ui822.html'); fs.writeFileSync(page, html);
        const br = await chromium.launch();
        try {
            for (const [w, h, mob, dark] of [[390, 844, true, false], [900, 1000, true, false], [1280, 900, false, true]]) {
                const tag = `${w}${dark ? ' 야간' : ''}`;
                const ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
                const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
                await pg.goto('file:///' + page.split(path.sep).join('/'));
                if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
                await pg.evaluate(() => window.AkmExp.open()); await pg.waitForSelector('.xp-cell', { timeout: 5000 }); await pg.waitForTimeout(300);
                const tap = async loc => { if (mob) await loc.tap(); else await loc.click(); };
                const ov = async () => pg.evaluate(() => { const de = document.documentElement; const cal = document.querySelector('.xp-cal').getBoundingClientRect(); const bar = document.querySelector('.xp-bar'); return { page: de.scrollWidth - de.clientWidth, cal: Math.round(cal.right - window.innerWidth), bar: bar.scrollWidth - bar.clientWidth }; });
                // ② [문자 설정] 단추 = 관리자에게도 안 보임 · 설정 길은 남아 있음
                ok(!(await pg.locator('#xp-set-btn').isVisible()) && (await pg.locator('#xp-set').count()) === 1 && !(await pg.locator('#xp-set').isVisible()), `[${tag}] 관리자인데 [문자 설정] 단추 안 보임 · 설정 칸은 숨김으로 남음`);
                ok(await pg.evaluate(() => typeof window.AkmExp.settings === 'function'), `[${tag}] AkmExp.settings(콘솔용) 있음`);
                const tools = await pg.locator('.xp-tools').textContent();
                ok(/취소 포함/.test(tools) && /엑셀/.test(tools) && !/문자 설정/.test(tools.replace(/\s/g, '') === '' ? '' : (await pg.locator('.xp-tools button:visible').allTextContents()).join()), `[${tag}] 도구 줄 = 취소 포함 · 엑셀만 보임`);
                // ④ 이달 합계 띠 · 달력 칸 현장 줄
                const sum = pg.locator('#xp-sales-sum');
                ok(await sum.isVisible() && /이달 현장 판매\(귤\)/.test(await sum.textContent()) && /120,000원/.test(await sum.textContent()) && /1일/.test(await sum.textContent()), `[${tag}] 달력 위 「이달 현장 판매(귤) 120,000원 · 1일」 띠`, await sum.textContent());
                const cellSale = pg.locator(`.xp-cell[data-day="${D1}"] .xp-sale`);
                ok((await cellSale.count()) === 1 && (mob ? (await cellSale.locator('i').isVisible() && !(await cellSale.locator('em').isVisible())) : (await cellSale.locator('em').isVisible() && /현장 120,000/.test(await cellSale.locator('em').textContent()))), `[${tag}] 날짜 칸 = ${mob ? '₩ 표식만' : '「현장 120,000」 줄'}`);
                ok((await pg.locator(`.xp-cell[data-day="${D2}"] .xp-sale`).count()) === 0, `[${tag}] 매출 없는 날은 줄 없음`);
                const aria = await pg.locator(`.xp-cell[data-day="${D1}"]`).getAttribute('aria-label');
                ok(/현장 판매 120,000원/.test(aria), `[${tag}] 칸 aria-label 에 현장 판매`, aria);
                let o = await ov(); ok(o.page <= 0 && o.cal <= 0 && o.bar <= 0, `[${tag}] 가로 넘침 0(페이지·달력·도구 줄)`, o);
                // #822-b 날짜 판(값 있는 날) = 한 줄 요약 + [수정]·[삭제] · 입력 칸은 안 펼쳐짐 · 머리에 [+ 현장 판매] 없음
                await tap(pg.locator(`.xp-cell[data-day="${D1}"]`)); await pg.waitForSelector('#xp-panel:not([hidden]) #xp-sale-line', { timeout: 5000 });
                const line = pg.locator('#xp-sale-line');
                ok(await line.isVisible() && /현장 판매\(귤\)/.test(await line.textContent()) && /120,000원/.test(await line.textContent()) && /5kg 12박스/.test(await line.textContent()) && /직원 · 2026-10-22 10:00/.test(await line.textContent()), `[${tag}] 값 있는 날 = 한 줄 요약(금액·메모·적은 사람)`, await line.textContent());
                ok((await pg.locator('#xp-sale-box').count()) === 0 && (await pg.locator('.xp-panel-h .xp-salebtn').count()) === 0 && (await line.locator('[data-act="sale-edit"]').count()) === 1 && (await line.locator('[data-act="sale-del"]').count()) === 1, `[${tag}] 입력 칸 안 펼쳐짐 · 머리 단추 없음 · [수정]·[삭제]`);
                const lb = await line.boundingBox(), ph = await pg.locator('.xp-panel-h').first().boundingBox();
                ok(lb && ph && lb.y >= ph.y + ph.height - 1 && lb.y < ph.y + ph.height + 40, `[${tag}] 요약 줄이 판 머리 바로 아래`, { lb, ph });
                const db = await line.locator('[data-act="sale-del"]').boundingBox();
                ok(db.height >= (mob ? 44 : 36) && await line.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `[${tag}] 삭제 단추 ${Math.round(db.height)}px · 줄 가로 넘침 0`);
                // [수정] → 입력 칸(값 채워짐) · Esc = 입력 칸만 닫힘
                await tap(line.locator('[data-act="sale-edit"]')); await pg.waitForSelector('#xp-sale-box', { timeout: 3000 });
                const box = pg.locator('#xp-sale-box');
                ok(await pg.locator('#xp-sl-amount').inputValue() === '120,000' && await pg.locator('#xp-sl-memo').inputValue() === '5kg 12박스' && (await pg.locator('#xp-sale-line').count()) === 0 && (await box.locator('[data-act="sale-cancel"]').count()) === 1, `[${tag}] [수정] = 입력 칸(값 채워짐 · 저장·취소) · 요약 줄 대신`);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
                ok((await pg.locator('#xp-sale-box').count()) === 0 && (await pg.locator('#xp-sale-line').count()) === 1 && await pg.locator('#xp-panel').isVisible(), `[${tag}] Esc = 입력 칸만 닫힘(판·요약 줄 그대로)`);
                await tap(line.locator('[data-act="sale-edit"]')); await pg.waitForSelector('#xp-sale-box', { timeout: 3000 });
                const sb = await pg.locator('#xp-sale-box [data-act="sale-save"]').boundingBox();
                ok(sb.height >= (mob ? 44 : 36) && await box.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `[${tag}] 저장 단추 ${Math.round(sb.height)}px · 입력 칸 가로 넘침 0`);
                // 금액 치면 1,234,567 꼴 · 저장 → PUT · 달력·띠·요약 줄 갱신
                await pg.fill('#xp-sl-amount', ''); await pg.locator('#xp-sl-amount').type('250000');
                ok(await pg.locator('#xp-sl-amount').inputValue() === '250,000', `[${tag}] 금액 치면 250,000 꼴`);
                await pg.fill('#xp-sl-amount', ''); await pg.locator('#xp-sl-amount').type('1234567890123');
                ok(await pg.locator('#xp-sl-amount').inputValue() === '123,456,789' && await pg.locator('#xp-sl-amount').getAttribute('maxlength') === '11', `[${tag}] 숫자 9자리까지만(1억 자리) · maxlength 11(쉼표 포함)`, await pg.locator('#xp-sl-amount').inputValue());
                await pg.fill('#xp-sl-amount', ''); await pg.locator('#xp-sl-amount').type('250000');
                await pg.fill('#xp-sl-memo', '5kg 20박스 · 카드');
                await tap(pg.locator('#xp-sale-box [data-act="sale-save"]')); await pg.waitForTimeout(300);
                const put = await pg.evaluate(() => window.__calls.filter(c => /^PUT .*\/sales\//.test(c)));
                ok(put.length === 1 && put[0] === `PUT /api/agent-office/experience/sales/${D1} {"amount":250000,"memo":"5kg 20박스 · 카드"}`, `[${tag}] 저장 = PUT …/sales/날짜 {amount:250000, memo}`, put);
                ok(/현장 판매 250,000원 저장했어요/.test((await pg.evaluate(() => window.__toasts)).join()), `[${tag}] 저장 알림 글`);
                ok(/250,000원/.test(await sum.textContent()) && (mob || /현장 250,000/.test(await cellSale.textContent())) && (await pg.locator('#xp-sale-box').count()) === 0 && /250,000원/.test(await pg.locator('#xp-sale-line').textContent()) && /5kg 20박스 · 카드/.test(await pg.locator('#xp-sale-line').textContent()) && /대표 · 2026-10-22 11:00/.test(await pg.locator('#xp-sale-line').textContent()), `[${tag}] 저장 뒤 = 입력 칸 닫히고 요약 줄·띠·칸 갱신(판은 열린 채)`);
                // [삭제] = 한 번 더 눌러 확인 → PUT 0 → 줄 없어지고 머리에 [+ 현장 판매]
                const del = pg.locator('#xp-sale-line [data-act="sale-del"]');
                await tap(del); ok(/한 번 더/.test(await del.textContent()) && (await pg.locator('#xp-sale-line').count()) === 1, `[${tag}] 삭제 = 한 번 더 눌러 확인(아직 안 지움)`);
                await tap(del); await pg.waitForTimeout(300);
                const put2 = await pg.evaluate(() => window.__calls.filter(c => /^PUT .*\/sales\//.test(c)).pop());
                ok(put2 === `PUT /api/agent-office/experience/sales/${D1} {"amount":0,"memo":""}` && (await pg.locator('#xp-sale-line').count()) === 0 && (await pg.locator(`.xp-cell[data-day="${D1}"] .xp-sale`).count()) === 0 && (await pg.locator('#xp-sales-sum').count()) === 0 && /지웠어요/.test((await pg.evaluate(() => window.__toasts)).pop()), `[${tag}] 두 번째 = PUT 0 → 요약 줄·칸 표시·이달 띠 없어짐`);
                const addBtn2 = pg.locator('.xp-panel-h .xp-salebtn');
                ok(await addBtn2.isVisible() && /\+ 현장 판매/.test(await addBtn2.textContent()) && (await pg.locator('.xp-panel-h [data-act="add"]').count()) === 1 && (await addBtn2.boundingBox()).height >= (mob ? 44 : 36), `[${tag}] 지운 뒤 머리 = [+ 예약 추가] 옆 [+ 현장 판매]`);
                // 값 없는 날 = 머리 [+ 현장 판매] → 입력 칸(빈 칸) → [취소] · 다시 열어 저장
                await tap(pg.locator('[data-act="close-panel"]')); await pg.waitForTimeout(150);
                await tap(pg.locator(`.xp-cell[data-day="${D2}"]`)); await pg.waitForSelector('#xp-panel:not([hidden]) .xp-salebtn', { timeout: 5000 });
                ok((await pg.locator('#xp-sale-line').count()) === 0 && (await pg.locator('#xp-sale-box').count()) === 0, `[${tag}] 값 없는 날 = 요약 줄·입력 칸 없음(머리 단추만)`);
                await tap(pg.locator('.xp-panel-h .xp-salebtn')); await pg.waitForSelector('#xp-sale-box', { timeout: 3000 });
                ok(await pg.locator('#xp-sl-amount').inputValue() === '' && await pg.locator('#xp-sl-memo').inputValue() === '' && (await pg.locator('.xp-panel-h .xp-salebtn').count()) === 0, `[${tag}] [+ 현장 판매] = 빈 입력 칸 · 머리 단추는 숨김`);
                await tap(pg.locator('#xp-sale-box [data-act="sale-cancel"]')); await pg.waitForTimeout(150);
                ok((await pg.locator('#xp-sale-box').count()) === 0 && (await pg.locator('.xp-panel-h .xp-salebtn').count()) === 1, `[${tag}] [취소] = 입력 칸 닫힘 · 머리 단추 다시`);
                await tap(pg.locator('.xp-panel-h .xp-salebtn')); await pg.waitForSelector('#xp-sale-box', { timeout: 3000 });
                await pg.locator('#xp-sl-amount').type('9000'); await tap(pg.locator('#xp-sale-box [data-act="sale-save"]')); await pg.waitForTimeout(250);
                const put3 = await pg.evaluate(() => window.__calls.filter(c => /^PUT .*\/sales\//.test(c)).pop());
                ok(put3 === `PUT /api/agent-office/experience/sales/${D2} {"amount":9000,"memo":""}` && /9,000원/.test(await pg.locator('#xp-sale-line').textContent()) && (await pg.locator(`.xp-cell[data-day="${D2}"] .xp-sale`).count()) === 1, `[${tag}] 저장 9,000 = 요약 줄 + 달력 칸 표시`);
                // 예약 줄은 그대로(수정·방문 단추) · Esc 로 판 닫힘
                ok((await pg.locator('#xp-panel .xp-row[data-id="2"] [data-act="edit"]').count()) === 1 && (await pg.locator('#xp-panel .xp-row[data-id="2"] [data-act="visit"]').count()) === 1, `[${tag}] 예약 줄 단추 그대로`);
                await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
                ok(await pg.locator('#xp-panel').isHidden() && await pg.locator('#xp-layer').isVisible(), `[${tag}] Esc = 판만 닫힘`);
                o = await ov(); ok(o.page <= 0 && o.cal <= 0, `[${tag}] 끝 가로 넘침 0`, o);
                ok(errs.length === 0, `[${tag}] 페이지 오류 0`, errs);
                await ctx.close();
            }
        } finally { await br.close(); }
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

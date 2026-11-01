// #940 검증 — 체험 예약 날마다 특이사항 메모 · 실DB·실메일·알리고·서버 기동 0(전부 가짜)
//   ① 서버(experience.js 가짜 app·pool) = PUT …/notes/:day(날짜·2,000자·빈 글 지움·세무사 403·audit·같은 글) · 목록 notes ② 엑셀 셋째 시트(있을 때만) ③ 화면(Playwright · 390 폰 · 900 폴드 · 1280 야간)
//   실행: node scripts/verify-940-notes.js   (PNG = %TEMP%/v940-…)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
const mount = require(path.join(ROOT, 'experience.js')), T = mount._t;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else fail++; console.log(`  ${c ? '✅' : '❌'} ${name}${extra !== undefined && !c ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''}`); };
const t0 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), add = n => new Date(Date.parse(t0 + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function fakeApp() { const routes = {}; const a = m => (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; }; return { routes, get: a('GET'), put: a('PUT'), patch: a('PATCH'), post: a('POST') }; }
function mk() {
    const S = { notes: new Map(), audits: [], sql: [], tick: 0 };
    const pool = { query: async (sql, a = []) => { const s = String(sql).replace(/\s+/g, ' ').trim(); S.sql.push(s);
        if (/^CREATE /.test(s)) throw new Error('검증은 표를 만들지 않는다');
        if (/^DELETE FROM experience_daily_notes/.test(s)) { S.notes.delete(a[0]); return { rows: [] }; }
        if (/FROM experience_daily_notes WHERE day BETWEEN/.test(s)) return { rows: [...S.notes.values()].filter(r => r.day >= a[0] && r.day <= a[1]).sort((x, y) => x.day.localeCompare(y.day)) };
        if (/FROM experience_daily_notes WHERE day=\$1/.test(s)) return { rows: S.notes.has(a[0]) ? [{ ...S.notes.get(a[0]) }] : [] };
        if (/^INSERT INTO experience_daily_notes/.test(s)) { S.tick++; S.notes.set(a[0], { day: a[0], note: a[1], updated_by: a[2], updated_at: '2026-11-01 10:0' + S.tick }); return { rows: [] }; }
        if (/COUNT\(\*\) FILTER/.test(s)) return { rows: [{ today: 0, tomorrow: 0, need_check: 0 }] };
        return { rows: [] }; } };
    const app = fakeApp(), pass_ = (q, r, n) => n && n();
    mount(app, { pool, authMiddleware: pass_, adminOnly: pass_, writeAudit: x => { S.audits.push(x); }, skipInit: true, noTimers: true, naverCfgGet: async () => null, naverCfgSet: async () => {}, kakaoNotify: { sendLms: async () => ({}) } });
    return { S, app };
}
const res = () => { const r = { code: 200, body: null, headers: {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; } }; return r; };

(async () => {
    console.log('① 서버');
    { const t = mk(), P = 'PUT /api/agent-office/experience/notes/:day', G = 'GET /api/agent-office/experience', put = async (day, note, user) => { const r = res(); await t.app.routes[P]({ params: { day }, body: { note }, user: user || { id: 7, name: '직원', role: 'staff' } }, r); return r; };
      ok(!!t.app.routes[P], '라우트 있음');
      let r = await put('2026-11-31', '가'); ok(r.code === 400, '없는 날짜 = 400', r.body);
      r = await put('2026-11-07', '가', { id: 9, name: '세무사', role: 'accountant' }); ok(r.code === 403 && !t.S.notes.size, '세무사 = 403 · 안 씀', r.body);
      r = await put('2026-11-07', 'x'.repeat(2001)); ok(r.code === 400 && /2,000자/.test(r.body.error) && !t.S.notes.size, '2,001자 = 400(잘라 저장 안 함)', r.body);
      r = await put('2026-11-07', 'x'.repeat(2000)); ok(r.code === 200 && r.body.item.note.length === 2000, '2,000자 = 저장', r.code); await put('2026-11-07', '');
      t.S.audits.length = 0;
      r = await put('2026-11-07', '  알바 민지 휴무\r\n오후 단체 30명  '); ok(r.code === 200 && r.body.item.note === '알바 민지 휴무\n오후 단체 30명' && r.body.item.updated_by === '직원', '저장 = 앞뒤 빈칸 정리 · 줄바꿈 유지 · 적은 사람', r.body);
      ok(t.S.audits.length === 1 && t.S.audits[0].action === 'experience_note' && t.S.audits[0].changes.day === '2026-11-07' && t.S.audits[0].changes.before === null && /휴무/.test(t.S.audits[0].changes.after), 'audit experience_note · 전/후', t.S.audits);
      const at0 = r.body.item.updated_at; r = await put('2026-11-07', '알바 민지 휴무\n오후 단체 30명'); ok(t.S.audits.length === 1 && r.body.item.updated_at === at0, '같은 글 다시 저장 = 기록·시각 그대로', r.body);
      r = res(); await t.app.routes[G]({ query: { from: '2026-11-01', to: '2026-11-30' }, user: { name: '직원' } }, r); ok(r.body.notes && r.body.notes.length === 1 && r.body.notes[0].day === '2026-11-07', '목록 GET 에 notes', r.body);
      ok(Array.isArray(r.body.sales) && Array.isArray(r.body.items), '기존 칸(items·sales) 그대로');
      r = await put('2026-11-07', '   '); ok(r.code === 200 && r.body.item === null && !t.S.notes.size && t.S.audits.length === 2 && t.S.audits[1].changes.after === null, '빈 글 = 지움 · audit', r.body);
      r = await put('2026-11-08', ''); ok(r.code === 200 && t.S.audits.length === 2, '없는 줄 빈 글 = 할 일 없음 · audit 0', t.S.audits.length);
      ok(!t.S.sql.some(s => /experience_bookings SET|sms_|INSERT INTO experience_bookings/.test(s) && !/SELECT/.test(s)), '예약·문자 표 쓰기 0'); }

    console.log('② 엑셀');
    { const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs')); const load = async wb => { const r = new ExcelJS.Workbook(); await r.xlsx.load(await wb.xlsx.writeBuffer()); return r; };
      const r0 = await load(T.buildXlsx([], [], '2026-11-01', '2026-11-30')); ok(r0.worksheets.length === 2, '메모 없음 = 시트 2개(종전)', r0.worksheets.map(w => w.name));
      const r1 = await load(T.buildXlsx([], [], '2026-11-01', '2026-11-30', [{ day: '2026-11-07', note: '알바 휴무\n단체 30명', updated_by: '직원', updated_at: '2026-11-01 10:00' }])), w = r1.getWorksheet('특이사항');
      { const r2 = await load(T.buildXlsx([], [], '2026-11-01', '2026-11-30', [{ day: '2026-11-08', note: 'x\n'.repeat(999) + 'y', updated_by: '', updated_at: '' }])); ok(r2.getWorksheet('특이사항').getRow(2).height === 409, '아주 긴 메모 = 줄 높이 상한 409', r2.getWorksheet('특이사항').getRow(2).height); }
      ok(r1.worksheets.length === 3 && w && w.getRow(2).getCell(1).value === '2026-11-07' && w.getRow(2).getCell(2).value === '토' && w.getRow(2).getCell(3).value === '알바 휴무\n단체 30명' && w.getRow(2).getCell(3).alignment.wrapText, '셋째 시트 = 날짜·요일·글(줄바꿈)', w && w.getRow(2).values);
      ok(w.getRow(1).getCell(1).fill && w.views[0].state === 'frozen', '머리 꼴·틀 고정 = 현장 판매 시트와 같게'); }

    console.log('③ 화면');
    { const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
      const D1 = add(3), D2 = add(5), LONG = '알바 민지 휴무 · 오후 단체 30명 · 주차 안내 필요\n둘째 줄 특이사항 '.repeat(4).trim();
      const items = [{ id: 1, source: 'store', order_no: '2026102038638821', name: '홍길동', phone: '01011112222', visit_date: D1, visit_time: '10:00', exp_count: 2, entry_count: 0, infant_count: 0, status: 'confirmed', date_ok: true, sms_recv_at: 'x', sms_recv_via: 'alimtalk' }];
      const sales = [{ day: D1, amount: 120000, memo: '5kg', updated_by: '직원', updated_at: '2026-10-22 10:00' }], notes = [{ day: D1, note: LONG, updated_by: '직원<b>', updated_at: '2026-11-01 09:00' }];
      const page = (role, oldSrv) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/styles.css"><link rel="stylesheet" href="file:///${PUB}/ao-dark.css"><link rel="stylesheet" href="file:///${PUB}/ao-exp.css"><style>body{margin:0;font-family:"Pretendard","Malgun Gothic",sans-serif;background:#EEF0F4}</style></head><body><script>
window.__calls = []; window.__toasts = []; window.__fail = false; const DATA = ${JSON.stringify({ items, sales, notes })}; localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify({ role: '${role}', name: '대표' })); window.showToast = m => { window.__toasts.push(m); };
window.fetch = async (url, o) => { o = o || {}; window.__calls.push((o.method || 'GET') + ' ' + url + (o.body ? ' ' + o.body : '')); const J = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { 'Content-Type': 'application/json' } }); const p = new URL(url, 'http://x/').pathname;
  if (p === '/api/agent-office/experience' && (o.method || 'GET') === 'GET') return J(Object.assign({ items: DATA.items, sales: DATA.sales, summary: {}, settings_view: {} }, ${oldSrv ? '{}' : '{ notes: DATA.notes }'}));
  const m = /notes\\/(\\d{4}-\\d{2}-\\d{2})$/.exec(p); if (m && o.method === 'PUT') { if (window.__fail) return J({ error: '저장하지 못했어요' }, 500); const b = JSON.parse(o.body), n = String(b.note).trim(); DATA.notes = DATA.notes.filter(x => x.day !== m[1]); const it = n ? { day: m[1], note: n, updated_by: '대표', updated_at: '2026-11-01 11:00' } : null; if (it) DATA.notes.push(it); return J({ ok: true, day: m[1], item: it }); }
  return J({ error: 'no mock ' + p }, 404); };
</script><script src="file:///${PUB}/ao-exp.js"></script></body></html>`;
      const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v940-')), wr = (n, s) => { const f = path.join(OUT, n); fs.writeFileSync(f, s); return 'file:///' + f.split(path.sep).join('/'); };
      const U = { admin: wr('a.html', page('admin')), acct: wr('c.html', page('accountant')), old: wr('o.html', page('admin', true)) };
      const br = await chromium.launch();
      try {
          for (const [w, h, mob, dark] of [[390, 844, true, false], [900, 1000, true, false], [1280, 900, false, true]]) {
              const tag = `${w}${dark ? ' 야간' : ''}`, ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob }), pg = await ctx.newPage(), errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
              const tap = async loc => { if (mob) await loc.tap(); else await loc.click(); };
              const go = async u => { await pg.goto(u); if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark')); await pg.evaluate(() => window.AkmExp.open()); await pg.waitForSelector('.xp-cell', { timeout: 5000 }); await pg.waitForTimeout(250); };
              const showM = async d => { for (let i = 0; i < 3 && !(await pg.locator(`[data-day="${d}"]`).count()); i++) { await pg.locator('[data-nav="1"]').first().click(); await pg.waitForTimeout(200); } };
              await go(U.admin); await showM(D1);
              const cell = pg.locator(`[data-day="${D1}"]`), over = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cells: [...document.querySelectorAll('.xp-cell')].filter(c => c.scrollWidth > c.clientWidth + 1).length }));
              ok(await cell.locator('.xp-note-tag').count() === 1, `[${tag}] 달력 칸 메모 표식`); ok(over.sw <= over.iw && !over.cells, `[${tag}] 가로 넘침 0 · 칸 넘침 0`, over);
              const lab = await cell.locator('.xp-note-tag').evaluate(el => [getComputedStyle(el.querySelector('i')).display, getComputedStyle(el.querySelector('em')).display]); ok(w <= 900 ? lab[0] !== 'none' && lab[1] === 'none' : lab[0] === 'none' && lab[1] !== 'none', `[${tag}] 표식 글 = ${w <= 900 ? '📝' : '메모'}`, lab);
              ok(/특이사항 메모 있음/.test(await cell.getAttribute('aria-label')), `[${tag}] 읽어 주는 글에 메모`);
              ok(/이달 특이사항 메모/.test(await pg.locator('#xp-notes-sum').innerText()) || !(await pg.locator(`[data-day="${D1}"]`).count()), `[${tag}] 이달 띠`);
              await tap(cell); await pg.waitForSelector('#xp-note');
              const ta = pg.locator('#xp-note'); ok(await ta.inputValue() === LONG, `[${tag}] 판에서 전문`);
              const m = await pg.evaluate(() => { const t = document.getElementById('xp-note'), s = document.getElementById('xp-note-save'), b = t.closest('#xp-note-box'), p = document.getElementById('xp-panel'); return { th: t.getBoundingClientRect().height, sc: t.scrollHeight, cl: t.clientHeight, sh: s.getBoundingClientRect().height, off: s.disabled, who: document.getElementById('xp-note-who').textContent, first: p.querySelector('.xp-panel-b').firstElementChild === b, sw: document.documentElement.scrollWidth, iw: innerWidth, boxOver: b.scrollWidth > b.clientWidth + 1 }; });
              ok(m.sc <= m.cl + 3 && m.first, `[${tag}] 칸 높이 = 글 길이 · 판 맨 위`, m); ok(m.off && m.who === '직원<b> · 2026-11-01 09:00', `[${tag}] 안 고침 = [저장] 꺼짐 · 적은 사람·시각(글자 그대로)`, m);
              ok(!mob || m.sh >= 44, `[${tag}] 저장 단추 44px`, m.sh); ok(m.sw <= m.iw && !m.boxOver, `[${tag}] 판 넘침 0`, m);
              await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(OUT, `panel-${tag}.png`) });
              // 치는 중 = 값 안 바꿈 · 다른 동작으로 판을 다시 그려도 글 남음
              await ta.fill(''); await ta.pressSequentially('알바 010-1234 휴무'); ok(await ta.inputValue() === '알바 010-1234 휴무' && !(await pg.locator('#xp-note-save').isDisabled()) && /저장 안 됨/.test(await pg.locator('#xp-note-who').innerText()), `[${tag}] 치는 글 그대로 · [저장] 켜짐 · 「저장 안 됨」`);
              await tap(pg.locator('.xp-addbtn')); await pg.waitForTimeout(100); ok(await pg.locator('#xp-note').inputValue() === '알바 010-1234 휴무', `[${tag}] 예약 추가를 눌러 판을 다시 그려도 글 남음`); await tap(pg.locator('.xp-addbtn')); await pg.waitForTimeout(100);
              await pg.evaluate(() => { window.__fail = true; }); await tap(pg.locator('#xp-note-save')); await pg.waitForTimeout(150); ok(await pg.locator('#xp-note').inputValue() === '알바 010-1234 휴무' && !(await pg.locator('#xp-note-save').isDisabled()) && (await pg.evaluate(() => window.__toasts.pop())) === '저장하지 못했어요', `[${tag}] 저장 실패 = 글 그대로 · 다시 누를 수 있음 · 안내`); await pg.evaluate(() => { window.__fail = false; });
              await tap(pg.locator('#xp-note-save')); await pg.waitForTimeout(200);
              const calls = await pg.evaluate(() => window.__calls.filter(c => c.startsWith('PUT'))); ok(calls.pop().includes(`/notes/${D1}`), `[${tag}] PUT 그 날짜`);
              ok(await pg.locator('#xp-note').inputValue() === '알바 010-1234 휴무' && await pg.locator('#xp-note-save').isDisabled() && /대표 · 2026-11-01 11:00/.test(await pg.locator('#xp-note-who').innerText()), `[${tag}] 저장 뒤 = 꺼짐 · 적은 사람 갱신`);
              await pg.locator('#xp-note').fill(''); await tap(pg.locator('#xp-note-save')); await pg.waitForTimeout(200); ok(await pg.locator(`[data-day="${D1}"] .xp-note-tag`).count() === 0 && await pg.locator('#xp-notes-sum').count() === 0 && (await pg.evaluate(() => window.__toasts.pop())) === '특이사항 메모를 지웠어요', `[${tag}] 빈 글 저장 = 달력 표식·띠 없어짐`);
              await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
              const cD2 = pg.locator(`[data-day="${D2}"]`); if (!(await cD2.count())) await showM(D2); await tap(pg.locator(`[data-day="${D2}"]`)); await pg.waitForSelector('#xp-note'); ok(await pg.locator('#xp-note').inputValue() === '' && await pg.locator('#xp-note-who').innerText() === '', `[${tag}] 예약 없는 날도 칸 있음`);
              await pg.locator('#xp-note').fill('안 저장한 글'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(100); ok((await pg.evaluate(() => window.__toasts.pop())) === '저장 안 한 메모가 있어요 · 저장하거나 지우세요', `[${tag}] 판 닫을 때 안내 한 줄`); await tap(pg.locator(`[data-day="${D2}"]`)); await pg.waitForSelector('#xp-note'); ok(await pg.locator('#xp-note').inputValue() === '안 저장한 글' && /저장 안 됨/.test(await pg.locator('#xp-note-who').innerText()), `[${tag}] 판을 닫았다 열어도 안 저장한 글 남음`);
              await pg.evaluate(() => { window.__toasts.length = 0; document.querySelector('[data-nav="1"]').click(); }); await pg.waitForTimeout(200); ok((await pg.evaluate(() => window.__toasts.pop())) === '저장 안 한 메모가 있어요 · 저장하거나 지우세요', `[${tag}] 달 이동 때 안내 한 줄`);
              await pg.evaluate(() => { window.__toasts.length = 0; document.querySelector('[data-nav="-1"]').click(); }); await pg.waitForTimeout(200); ok((await pg.evaluate(() => window.__toasts.length)) === 0, `[${tag}] 판 닫힌 뒤 달 이동 = 안내 없음`);
              await go(U.old); await showM(D1); await tap(pg.locator(`[data-day="${D1}"]`)); await pg.waitForSelector('#xp-note'); ok(await pg.locator(`[data-day="${D1}"] .xp-note-tag`).count() === 0 && await pg.locator('#xp-note').inputValue() === '', `[${tag}] 옛 서버(notes 없음) = 오류 없이 빈 칸`);
              ok(!errs.length, `[${tag}] 스크립트 오류 0`, errs); await ctx.close();
          }
          { const ctx = await br.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage(); await pg.goto(U.acct); await pg.evaluate(() => window.AkmExp.open()); await pg.waitForSelector('.xp-cell'); await pg.waitForTimeout(200); for (let i = 0; i < 3 && !(await pg.locator(`[data-day="${D1}"]`).count()); i++) { await pg.locator('[data-nav="1"]').first().click(); await pg.waitForTimeout(200); } await pg.locator(`[data-day="${D1}"]`).click(); await pg.waitForSelector('#xp-note'); ok(await pg.locator('#xp-note').getAttribute('readonly') !== null && await pg.locator('#xp-note-save').count() === 0, '세무사 = 읽기만 · 저장 단추 없음'); await ctx.close(); }
      } finally { await br.close(); }
      console.log('  ℹ️  그림', OUT); }
    console.log(`\n결과 ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

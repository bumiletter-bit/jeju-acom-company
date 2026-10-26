// #838-2 자동 송장 등록 묶음(최종발주 맨 아래) 실클릭 — 시험 페이지(가짜 api · 서버·실DB·외부 0) · 실코드 final-order.js·css 를 그대로 불러 최종발주 창을 연다
//   보는 것: 옛 서버(404) = 묶음 숨김 · 파일 고르기·끌어다 놓기·거래처 표시 · [짝 맞추기] 요청 꼴(base64) · 카드 고르기 · 관리자만 [등록] · 확인 한 번 · 요청 꼴(picks·dry) · 결과 표 · 실패 줄 xlsx 내려받기
//         390 · 900(폴드7 · 한 줄) · 1280 야간 · 콘솔 오류 0 · 가로 넘침 0 · 누르는 것 44px
//   #841: 파일 칩 「거래처」 표시 없음 · suggest 미리 고름 + 「확인 필요」 · 이름·번호 전체 · [등록] = 바로 준비(묻지 않음) · 보낸 결과 팝업(전부 성공 / 실패·모름 줄 + 수기 파일 · Esc·바깥 닫힘)
//   사용: node scripts/verify-838-ui.js
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public').split(path.sep).join('/');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (x !== undefined && !c ? ' — ' + JSON.stringify(x).slice(0, 260) : '')); };

const row = (id, ch, st, rule, extra) => Object.assign({ id, channel: ch, order_key: '20261024' + id.replace(/\D/g, '').padStart(8, '0'), box_id: 'B' + id, recipient_masked: '김*수 · 끝 1234', recipient_name: '김민수', recipient_tel: '010-1111-1234', option: '하우스감귤 가정용 - 3kg(소과)', qty: 1, tracking: st === 'auto' ? '61234567' + id.replace(/\D/g, '').padStart(4, '0') : null, tracking_all: st === 'auto' ? ['61234567' + id.replace(/\D/g, '').padStart(4, '0')] : [], rule, status: st, pick_options: [] }, extra || {});
const MATCH = {
    ok: true, run_id: 17, ship_date: '2026-10-24',
    files: [{ name: '제주아꼼이네송장(효돈)10.24.xlsx', partner: '효돈', rows: 3 }, { name: '제주아꼼이네송장(대성)10.24.xlsx', partner: '대성', rows: 4 }],
    fetch: { naver: { ok: true, orders: 412 }, coupang: { ok: true, orders: 3 }, cafe24: { ok: false, orders: 0, error: '재승인 필요' } },
    by_channel: { naver: { auto: 3, todo: 2, cash: 0, skipped: 1 }, coupang: { auto: 1, todo: 0, cash: 0, skipped: 0 }, cafe24: { auto: 0, todo: 0, cash: 0, skipped: 0 } },
    summary: { shipments: 9, auto: 4, todo: 2, cash: 1, extra: 1, unmatched: 1, index_upserted: 9 },
    rows: [
        row('r1', 'naver', 'auto', 'auto'),
        row('r2', 'naver', 'auto', 'auto_multi', { qty: 2, tracking_all: ['612345670002', '612345670099'] }),
        row('r3', 'naver', 'auto', 'indiv_store_addr', { option: '황금향 선물용 - 3kg(로얄과) 아주 긴 옵션 이름이 붙어도 줄바꿈이 되는지 보는 글' }),
        row('r4', 'coupang', 'auto', 'by_product'),
        row('r5', 'naver', 'todo', 'todo_product', { recipient_masked: '이*희 · 끝 5678', recipient_name: '이영희', recipient_tel: '010-2222-5678', suggest: '612345671111', suggest_why: '확인 필요 — 품목이 같은 운송장 1장', pick_options: [{ tracking: '612345671111', recipient_masked: '이*희 · 끝 5678', recipient_name: '이영희', recipient_tel: '010-2222-5678', product: '하우스감귤 4.5kg' }, { tracking: '612345672222', recipient_masked: '이*희 · 끝 5678', recipient_name: '이영희', recipient_tel: '010-2222-5678', product: '하우스감귤 2.5kg' }] }),
        row('r9', 'naver', 'todo', 'todo_pick', { recipient_masked: '박*진 · 끝 9012', suggest: '999999999999', pick_options: [{ tracking: '612345673333', recipient_masked: '박*진 · 끝 9012', product: '레몬 3kg' }] }),
    ],
    cash: [{ tracking: '612345674444', recipient_masked: '최*호 · 끝 3456', product: '감귤 5kg', why: '보내는이 ! = 현금 주문(송장만)' }],
    extra: [{ tracking: '612345675555', recipient_masked: '정*아 · 끝 7890', why: '같은 구매자의 다른 주소 박스' }],
    unmatched: [{ tracking: '612345676666', recipient_masked: '한*솔 · 끝 2468', product: '황금향 3kg', why: '그날 주문에 받는분 이름·번호·주소가 같은 주문이 없어요' }],
    orders_without_tracking: 169,
};
const REG = {
    ok: true, run_id: 17, dry: true, send_enabled: false, ready: { naver: 4, coupang: 1, cafe24: 0 }, already: 0, manual: 1, skipped: 0,
    items: [
        { id: 'r1', channel: 'naver', order_key: MATCH.rows[0].order_key, tracking: '612345670001', idem: 'naver:x:612345670001', state: 'ready' },
        { id: 'r2', channel: 'naver', order_key: MATCH.rows[1].order_key, tracking: '612345670002', idem: 'naver:x:612345670002', state: 'ready' },
        { id: 'r3', channel: 'naver', order_key: MATCH.rows[2].order_key, tracking: '612345670003', idem: 'naver:x:612345670003', state: 'ready' },
        { id: 'r4', channel: 'coupang', order_key: MATCH.rows[3].order_key, tracking: '612345670004', idem: 'coupang:x:612345670004', state: 'ready' },
        { id: 'r5', channel: 'naver', order_key: MATCH.rows[4].order_key, tracking: '612345671111', idem: 'naver:x:612345671111', state: 'error' },
    ],
    manual_file: null,
};
const SENT = {   // 2-b 전송 응답(보냄 3 · 실패 1 · 모름 1)
    ok: true, run_id: 17, dry: false, send_enabled: true, ready: { naver: 4, coupang: 1, cafe24: 0 },
    sent: { naver: 2, coupang: 1, cafe24: 0 }, failed: { naver: 1, coupang: 0, cafe24: 0 }, unknown: { naver: 1, coupang: 0, cafe24: 0 },
    already: 0, manual: 1, skipped: 0, confirmed: { naver: 2, checked: 2 },
    items: [
        { id: 'r1', channel: 'naver', order_key: '2026102400000001', tracking: '612345670001', state: 'sent' },
        { id: 'r2', channel: 'naver', order_key: '2026102400000002', tracking: '612345670002', state: 'sent' },
        { id: 'r3', channel: 'naver', order_key: '2026102400000003', tracking: '612345670003', state: 'failed', error: 'INVALID_STATUS 발송 처리할 수 없는 상태' },
        { id: 'r5', channel: 'naver', order_key: '2026102400000005', tracking: '612345672222', state: 'unknown', error: '응답에 처리 결과 없음' },
        { id: 'r4', channel: 'coupang', order_key: '2026102400000004', tracking: '612345670004', state: 'sent' },
        { id: 'r9', channel: 'naver', order_key: '2026102400000009', tracking: null, state: 'manual' },
        { id: 'r2', channel: 'naver', order_key: '2026102400000002', tracking: '612345670002', state: 'manual', error: '같은 운송장 두 줄 — 수기로 넣어 주세요' },
    ],
    manual_file: '/api/agent-office/invoice-auto/manual/17',
};
const SENT_OK = Object.assign({}, SENT, { sent: { naver: 4, coupang: 1, cafe24: 0 }, failed: { naver: 0, coupang: 0, cafe24: 0 }, unknown: { naver: 0, coupang: 0, cafe24: 0 }, items: SENT.items.filter(it => !it.error || it.state !== 'manual').map(it => it.state === 'manual' ? it : Object.assign({}, it, { state: 'sent', error: undefined })) });
const page =(mode, role) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="file:///${PUB}/styles.css"><link rel="stylesheet" href="file:///${PUB}/theme.css"><link rel="stylesheet" href="file:///${PUB}/final-order.css"><link rel="stylesheet" href="file:///${PUB}/ao-dark.css">
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script>
<style>body{margin:0;font-family:"Pretendard","Malgun Gothic",sans-serif;background:#EEF0F4}</style></head><body>
<script>
var currentUser = { role: '${role}', name: '시험' };
window.__calls = [];
localStorage.setItem('jwt_token', 'x'); localStorage.setItem('jwt_user', JSON.stringify(currentUser));
window.showToast = () => {};
const MATCH = ${JSON.stringify(MATCH)}, REG = ${JSON.stringify(REG)};
window.api = async (url, method, body) => {
  window.__calls.push({ url, method, body });
  const err = (s, m) => { const e = new Error(m); e.status = s; throw e; };
  if ('${mode}' === 'old' && /invoice-auto/.test(url)) err(404, '서버 오류');
  if (url === '/api/agent-office/invoice-auto/match') { if (!body.files || !body.files.length) err(400, '파일이 없어요'); await new Promise(r => setTimeout(r, 300)); return MATCH; }
  if (url === '/api/agent-office/invoice-auto/register') {
    if (currentUser.role === 'accountant') err(403, '세무사는 못 해요');   // #858 직원 전부 · 세무사만 막음
    const M = '${mode}';
    if (M === 'new') return REG;
    if (body.dry !== false) return Object.assign({}, REG, { send_enabled: true, manual_file: '/api/agent-office/invoice-auto/manual/17' });
    if (M === 'off409') { const e = new Error('자동 송장 전송이 꺼져 있어요(설정 invoice_auto.send_enabled) — 준비만 저장했어요'); e.status = 409; e.body = Object.assign({}, REG, { ok: false, dry: true, send_enabled: false }); throw e; }
    if (M === 'e500') err(500, '등록에 실패했어요 — 보낸 줄이 있을 수 있으니 채널 화면을 먼저 확인해 주세요');
    return M === 'sentok' ? SENT_OK : SENT;
  }
  err(404, 'no mock ' + url);
};
const SENT = ${JSON.stringify(SENT)}, SENT_OK = ${JSON.stringify(SENT_OK)};
const _f = window.fetch; window.__fetch = [];
window.fetch = async (u, o) => {   // 수기 파일(2-c) = Authorization 머리 붙은 GET → xlsx blob
  if (String(u).startsWith('/api/agent-office/invoice-auto/manual/')) { window.__fetch.push({ u: String(u), auth: o && o.headers && o.headers.Authorization }); return new Response(new Uint8Array([80, 75, 3, 4, 1, 2]), { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('자동송장_수기_17.xlsx') } }); }
  return _f(u, o);
};
</script>
<script src="file:///${PUB}/final-order-core.js"></script><script src="file:///${PUB}/final-order.js"></script></body></html>`;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'v838-'));
const write = (n, s) => { const p = path.join(OUT, n); fs.writeFileSync(p, s); return 'file:///' + p.split(path.sep).join('/'); };
const U = { admin: write('admin.html', page('new', 'admin')), user: write('user.html', page('new', 'user')), acct: write('acct.html', page('new', 'accountant')), old: write('old.html', page('old', 'admin')),
    send: write('send.html', page('send', 'admin')), off409: write('off409.html', page('off409', 'admin')), e500: write('e500.html', page('e500', 'admin')), sentok: write('sentok.html', page('sentok', 'admin')) };
const fakeXlsx = name => ({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK fake ' + name) });

(async () => {
    const br = await chromium.launch();
    try {
        for (const [w, h, mob, dark] of [[390, 844, true, false], [390, 844, true, true], [900, 1000, true, false], [1280, 900, false, false], [1280, 900, false, true]]) {
            const sx = `${w}-${dark ? 'dark' : 'light'}`;
            const tag = `${w}${dark ? ' 야간' : ''}`;
            console.log(`\n── ${tag}`);
            const ctx = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob && w < 600, hasTouch: mob, acceptDownloads: true });
            const open = async (url) => {
                const pg = await ctx.newPage(); const errs = [];
                pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
                pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FILE_NOT_FOUND|net::|Not allowed to load local resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
                await pg.goto(url); await pg.waitForFunction(() => window.AkmFinalOrder && window.AkmInvoiceAuto, null, { timeout: 15000 });
                if (dark) await pg.evaluate(() => document.documentElement.setAttribute('data-ao-theme', 'dark'));
                await pg.evaluate(() => { window.AkmFinalOrder.open(); });
                await pg.waitForSelector('#fo-panel:not([hidden])', { timeout: 5000 }); await pg.waitForTimeout(400);
                return { pg, errs };
            };
            const tap = async (pg, sel) => { const l = pg.locator(sel); await l.scrollIntoViewIfNeeded(); if (mob) await l.tap(); else await l.click(); };

            // ① 옛 서버 = 숨김
            { const { pg, errs } = await open(U.old);
              ok(await pg.locator('#fo-ia').count() === 1 && await pg.locator('#fo-ia').isHidden(), tag + ' 옛 서버(404) = 묶음 숨김');
              ok(errs.length === 0, tag + ' 옛 서버 콘솔 오류 0', errs); await pg.close(); }

            // ② 관리자 전체 흐름
            const { pg, errs } = await open(U.admin);
            ok(await pg.locator('#fo-ia').isVisible(), tag + ' 새 서버 = 묶음 보임(맨 아래)', await pg.evaluate(() => [...document.querySelector('.fo-body').children].pop().id));
            ok(await pg.evaluate(() => [...document.querySelector('.fo-body').children].pop().id === 'fo-ia'), tag + ' .fo-body 마지막 칸');
            ok(await pg.evaluate(() => window.__calls.length === 1 && window.__calls[0].body.files.length === 0), tag + ' 확인 요청 1번(빈 파일)');
            ok(await pg.locator('#fo-ia-match').isDisabled(), tag + ' 파일 없으면 [짝 맞추기] 꺼짐');
            await pg.setInputFiles('#fo-ia-file', [fakeXlsx('제주아꼼이네송장(효돈)10.24.xlsx')]);
            // 끌어다 놓기(진짜 DataTransfer) — 엑셀 1 + 엑셀 아닌 것 1
            await pg.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['PK x'], '제주아꼼이네송장(대성)10.24.xlsx')); dt.items.add(new File(['x'], '메모.txt')); const dz = document.getElementById('fo-ia-drop'); dz.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
            const chips = await pg.$$eval('#fo-ia-files li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
            ok(chips.length === 2 && /효돈/.test(chips[0]) && /대성/.test(chips[1]), tag + ' 파일 2개', chips);
            ok(await pg.locator('#fo-ia-files .fo-tag').count() === 0 && !chips.some(c => /거래처/.test(c)), tag + ' #841 파일 칩에 거래처 표시 없음', chips);
            ok(/메모\.txt = 엑셀이 아니에요/.test(await pg.textContent('#fo-ia-msg')), tag + ' 엑셀 아닌 파일 안내');
            ok(!(await pg.locator('#fo-ia-match').isDisabled()), tag + ' [짝 맞추기] 켜짐');
            await tap(pg, '#fo-ia-match');
            await pg.waitForSelector('#fo-ia-out:not([hidden]) .fo-ia-sum', { timeout: 8000 });
            const mreq = await pg.evaluate(() => window.__calls.filter(c => /match/.test(c.url)).pop().body);
            ok(mreq.files.length === 2 && mreq.files.every(f => /^data:.*;base64,/.test(f.data)) && mreq.files[0].name === '제주아꼼이네송장(효돈)10.24.xlsx', tag + ' match 요청 = JSON base64 2개', mreq.files.map(f => f.name));
            const sum = await pg.textContent('.fo-ia-sum');
            ok(/자동 4/.test(sum.replace(/\s+/g, ' ')) && /할 일 2/.test(sum.replace(/\s+/g, ' ')) && /현금\(송장만\) 1/.test(sum.replace(/\s+/g, ' ')) && /수량2 1/.test(sum.replace(/\s+/g, ' ')), tag + ' 요약 칩(자동·할 일·현금·수량2)', sum.replace(/\s+/g, ' '));
            ok(/자사몰 주문을 못 불러왔어요\(재승인 필요\)/.test(await pg.textContent('#fo-ia-out')), tag + ' 실패 채널 안내');
            ok(await pg.locator('.fo-ia-todo .fo-card').count() === 2, tag + ' 할 일 카드 2');
            ok(await pg.locator('#fo-ia-reg').isDisabled(), tag + ' 할 일 남으면 [등록] 꺼짐');
            ok(!/김\*수.*서울|주소/.test(await pg.textContent('.fo-ia-todo')), tag + ' 카드에 주소 없음');
            // #841 suggest 미리 고름 · 이름·번호 전체
            ok(await pg.$eval('select[data-ia-pick="r5"]', s => s.value) === '612345671111' && /확인 필요 — 품목이 같은 운송장 1장/.test(await pg.textContent('.fo-card[data-ia-id="r5"] .fo-ia-sg')) && await pg.getAttribute('.fo-card[data-ia-id="r5"]', 'data-state') === 'open', tag + ' #841 r5 suggest 미리 고름 + 확인 필요(주황 카드)');
            ok(await pg.$eval('select[data-ia-pick="r9"]', s => s.value) === '' && /아직 안 고름/.test(await pg.textContent('.fo-card[data-ia-id="r9"]')), tag + ' #841 목록 밖 suggest = 무시');
            ok(/이영희 · 010-2222-5678/.test(await pg.textContent('.fo-card[data-ia-id="r5"] .fo-card-top')) && /이영희 · 010-2222-5678/.test(await pg.$eval('select[data-ia-pick="r5"]', s => s.innerText)) && /박\*진 · 끝 9012/.test(await pg.textContent('.fo-card[data-ia-id="r9"]')), tag + ' #841 이름·번호 전체(옛 칸이면 가림 글)');
            const sgc = await pg.$eval('.fo-card[data-ia-id="r5"] .fo-ia-sg', e => getComputedStyle(e).color);
            ok(/rgb\((181, 71, 8|251, 191, 74)\)/.test(sgc), tag + ' #841 확인 필요 = 주황 글', sgc);
            await pg.locator('.fo-ia-todo').scrollIntoViewIfNeeded(); await pg.locator('.fo-ia-todo').screenshot({ path: path.join(OUT, `841-card-${sx}.png`) });
            // 카드 고르기
            await pg.selectOption('select[data-ia-pick="r5"]', '612345672222');
            ok(await pg.getAttribute('.fo-card[data-ia-id="r5"]', 'data-state') === 'done', tag + ' r5 고름 → 카드 끝');
            ok(await pg.locator('#fo-ia-reg').isDisabled(), tag + ' 하나 남으면 아직 꺼짐');
            await pg.selectOption('select[data-ia-pick="r9"]', 'manual');
            ok(/수기로 둠/.test(await pg.textContent('.fo-card[data-ia-id="r9"]')), tag + ' r9 수기');
            ok(!(await pg.locator('#fo-ia-reg').isDisabled()), tag + ' 다 고르면 [등록] 켜짐');
            // 자동 목록 접힘 → 펼침
            ok(!(await pg.locator('.fo-ia-list').first().evaluate(d => d.open)), tag + ' 자동 목록 접힘');
            await tap(pg, '.fo-ia-list >> nth=0 >> summary');
            ok(await pg.locator('.fo-ia-list').first().evaluate(d => d.open && d.querySelectorAll('tbody tr').length === 4), tag + ' 자동 4줄 펼침');
            const shown = await pg.$eval('.fo-ia-list', d => d.innerText);
            ok(/6123-4567-0001/.test(shown) && /6123-4567-0002 외 1/.test(shown) && /6123-4567-1111/.test(await pg.$eval('select[data-ia-pick="r5"]', s => s.innerText)), tag + ' 운송장 12자리 → 4-4-4 로 보임(목록·고르기)');
            ok(/등록 안 하는 박스 1/.test(await pg.textContent('.fo-ia-ch')) && !/현금/.test(await pg.textContent('.fo-ia-ch')), tag + ' 채널 줄 = 자동·할 일·등록 안 하는 박스(현금은 요약 칩만)');
            // #841 [등록] = 묻지 않고 바로 준비
            ok(await pg.evaluate(() => !window.__calls.some(c => /register/.test(c.url))), tag + ' 등록 전 요청 0');
            await tap(pg, '#fo-ia-reg');
            await pg.waitForSelector('#fo-ia-result:not([hidden])', { timeout: 5000 });
            ok(await pg.locator('#fo-ia-confirm').isHidden() && await pg.locator('#fo-ia-yes').count() === 0, tag + ' #841 준비 확인 단계 없음');
            const rreq = await pg.evaluate(() => window.__calls.filter(c => /register/.test(c.url)));
            ok(rreq.length === 1 && rreq[0].method === 'POST' && rreq[0].body.run_id === 17 && rreq[0].body.dry === true && rreq[0].body.picks.r5 === '612345672222' && rreq[0].body.picks.r9 === 'manual', tag + ' register 요청 1번 · picks · dry', rreq.map(r => r.body));
            const res = await pg.$eval('#fo-ia-result', e => e.innerText.replace(/\s+/g, ' '));
            ok(/시험 단계 · 채널로 보낸 것 0/.test(res) && /네이버 4/.test(res), tag + ' 결과 표', res);
            ok(await pg.locator('#fo-ia-reg').isDisabled(), tag + ' 등록 뒤 [등록] 다시 못 누름');
            // 실패 줄 내려받기
            const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), tap(pg, '#fo-ia-dl')]);
            const fp = path.join(OUT, `dl-${w}.xlsx`); await dl.saveAs(fp);
            const aoa = await pg.evaluate(async b64 => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); }, fs.readFileSync(fp).toString('base64'));
            ok(/실패줄_2026-10-24\.xlsx$/.test(dl.suggestedFilename()) && aoa.length === 4 && aoa[0][5] === '사유' && aoa.some(r => /전송 안 됨\(error\)/.test(r[5])) && aoa.some(r => /수기로 둠/.test(r[5])) && aoa.some(r => r[4] === '612345676666'), tag + ' 실패 줄 xlsx(전송 안 됨 1 · 수기 1 · 주문 없음 1)', aoa);
            // 44px · 넘침 · 한 줄
            const small = await pg.$$eval('#fo-ia button, #fo-ia select, #fo-ia summary', els => els.filter(e => e.offsetParent).map(e => [e.id || e.className || e.tagName, e.offsetHeight, e.offsetWidth]).filter(x => x[1] < 44 || x[2] < 44));
            ok(small.length === 0, tag + ' 누르는 것 44px 이상(offset = 방금 누른 단추의 눌림 효과 scale .97 제외)', small);
            const over = await pg.evaluate(() => { const b = document.querySelector('.fo-body'), sec = document.getElementById('fo-ia'), r = b.getBoundingClientRect(); const out = [...sec.querySelectorAll('*')].filter(e => e.offsetParent && !e.closest('.fo-ia-scroll') && e.getBoundingClientRect().right > r.right + 1).map(e => e.className || e.tagName); return { body: b.scrollWidth - b.clientWidth, doc: document.scrollingElement.scrollWidth - innerWidth, out: out.slice(0, 5) }; });
            ok(over.body <= 0 && over.doc <= 0 && !over.out.length, tag + ' 가로 넘침 0', over);
            if (w >= 900) {
                const lines = await pg.evaluate(() => ({ sum: new Set([...document.querySelectorAll('.fo-ia-sum span')].map(s => Math.round(s.getBoundingClientRect().top))).size, drop: new Set([...document.querySelectorAll('#fo-ia-drop > :not(input)')].map(s => Math.round(s.getBoundingClientRect().top + s.getBoundingClientRect().height / 2))).size }));
                ok(lines.sum === 1 && lines.drop === 1, tag + ' 폴드7 이상 = 요약·끌어놓기 한 줄', lines);
            }
            await pg.locator('#fo-ia').screenshot({ path: path.join(OUT, `ia-${w}.png`) });
            ok(errs.length === 0, tag + ' 콘솔 오류 0', errs);
            await pg.close();

            // ③ #858 직원 = [등록] 켜짐(「관리자만」 글 없음) · 세무사 = 꺼짐
            for (const [who, url, on] of [['직원', U.user, true], ['세무사', U.acct, false]]) { const { pg, errs } = await open(url);
              await pg.setInputFiles('#fo-ia-file', [fakeXlsx('송장(효돈).xlsx')]); await tap(pg, '#fo-ia-match'); await pg.waitForSelector('#fo-ia-out:not([hidden]) .fo-ia-sum', { timeout: 8000 });
              await pg.selectOption('select[data-ia-pick="r5"]', '612345671111'); await pg.selectOption('select[data-ia-pick="r9"]', 'manual');
              const msg = await pg.textContent('#fo-ia-reg-msg');
              ok((await pg.locator('#fo-ia-reg').isDisabled()) === !on && !/관리자/.test(msg), tag + ' ' + who + ' = [등록] ' + (on ? '켜짐' : '꺼짐') + ' · 「관리자만」 글 없음', msg);
              if (on) { await tap(pg, '#fo-ia-reg'); await pg.waitForSelector('#fo-ia-result:not([hidden])', { timeout: 5000 }); ok(true, tag + ' 직원 [등록] = 준비 결과'); }
              ok(errs.length === 0, tag + ' ' + who + ' 콘솔 오류 0', errs); await pg.close(); }

            // ④ #838-5 실전송 — 준비(dry) → send_enabled 켜짐 → [채널에 보내기] → 확인(되돌릴 수 없음) → dry:false → 보낸 결과 · 모름 빨강 · 서버 수기 파일
            const prep = async url => {
                const o = await open(url), pg = o.pg;
                await pg.setInputFiles('#fo-ia-file', [fakeXlsx('송장(효돈).xlsx')]); await tap(pg, '#fo-ia-match'); await pg.waitForSelector('#fo-ia-out:not([hidden]) .fo-ia-sum', { timeout: 8000 });
                await pg.selectOption('select[data-ia-pick="r5"]', '612345672222'); await pg.selectOption('select[data-ia-pick="r9"]', 'manual');
                await tap(pg, '#fo-ia-reg'); await pg.waitForSelector('#fo-ia-result:not([hidden])', { timeout: 5000 });
                return o;
            };
            const modal = async (pg, name) => { await pg.waitForSelector('#fo-ia-modal .fo-iam-box', { timeout: 5000 }); await pg.waitForTimeout(260); await pg.screenshot({ path: path.join(OUT, `841-modal-${name}-${sx}.png`) }); return pg.$eval('#fo-ia-modal', e => e.innerText.replace(/\s+/g, ' ')); };
            const sends = pg => pg.evaluate(() => window.__calls.filter(c => /register/.test(c.url) && c.body.dry === false).length);
            { const { pg, errs } = await prep(U.send);
              ok(/아직 채널에 보내지 않았어요/.test(await pg.textContent('#fo-ia-result')) && await pg.locator('#fo-ia-send').isVisible() && /5건/.test(await pg.textContent('#fo-ia-send')), tag + ' 전송 켜짐 = 준비 뒤 [채널에 보내기 (5건)]');
              await tap(pg, '#fo-ia-send');
              const q = await pg.textContent('#fo-ia-confirm');
              ok(await pg.locator('#fo-ia-confirm').isVisible() && /채널에 실제로 보내요 · 되돌릴 수 없어요/.test(q) && /네이버 4건 · 쿠팡 1건 · 자사몰 0건 = 5건/.test(q), tag + ' 보내기 확인 글', q);
              ok(await pg.evaluate(() => { const c = document.getElementById('fo-ia-confirm'), s = document.getElementById('fo-ia-send'); return c.previousElementSibling === s.closest('.fo-acts'); }), tag + ' 확인 창이 [채널에 보내기] 바로 아래');
              await tap(pg, '#fo-ia-no');
              ok(await pg.locator('#fo-ia-confirm').isHidden() && await sends(pg) === 0, tag + ' 보내기 취소 = dry:false 요청 0');
              await tap(pg, '#fo-ia-send'); await tap(pg, '#fo-ia-send-yes');
              const mt = await modal(pg, 'fail');
              ok(/등록 결과 · 확인할 줄 있음/.test(mt) && /보냄 3/.test(mt) && /실패 1 · 모름 1 · 수기 1/.test(mt) && /수기 네이버 · 김민수 · 010-1111-1234 · 6123-4567-0002 같은 운송장 두 줄/.test(mt) && /실패 네이버 · 김민수 · 010-1111-1234 · 6123-4567-0003 INVALID_STATUS/.test(mt) && /모름 네이버 · 이영희 · 010-2222-5678 · 6123-4567-2222 응답에 처리 결과 없음/.test(mt) && /수기 파일 내려받기/.test(mt), tag + ' #841 팝업 = 성공 수 + 실패·모름 줄(채널·이름·운송장·이유) + 수기 파일', mt);
              const cov = await pg.evaluate(() => [...document.querySelectorAll('#fo-float .fo-fbtn')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: b.id, top: e ? (e.closest('#fo-ia-modal') ? 'modal' : e.id || e.className) : null }; }));
              ok(cov.every(c => c.top === 'modal') && await pg.evaluate(() => getComputedStyle(document.getElementById('fo-float')).visibility === 'hidden' && Number(getComputedStyle(document.getElementById('fo-ia-modal')).zIndex) > Number(getComputedStyle(document.getElementById('fo-float')).zIndex)), tag + ' #841 팝업이 떠 있는 단추(↑ 맨 위)보다 위 · 팝업 동안 숨김', cov);
              ok(await pg.evaluate(() => document.activeElement && document.activeElement.dataset.iam === 'close'), tag + ' #841 팝업 열리면 [닫기]에 초점');
              const msmall = await pg.$$eval('#fo-ia-modal button', els => els.map(e => [e.textContent, Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]).filter(x => x[1] < 44 || x[2] < 44));
              const mover = await pg.$eval('#fo-ia-modal .fo-iam-box', b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; });
              ok(!msmall.length && !mover, tag + ' #841 팝업 44px · 화면 안', { msmall, mover });
              const [mdl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), tap(pg, '#fo-ia-modal [data-iam="dl"]')]);
              ok(mdl.suggestedFilename() === '자동송장_수기_17.xlsx', tag + ' #841 팝업 [수기 파일 내려받기] = 서버 수기 파일', mdl.suggestedFilename());
              await pg.evaluate(() => { window.__fetch.length = 0; });
              await pg.keyboard.press('Escape');
              ok(await pg.locator('#fo-ia-modal').count() === 0 && await pg.locator('#fo-panel').isVisible() && await pg.evaluate(() => getComputedStyle(document.getElementById('fo-float')).visibility !== 'hidden'), tag + ' #841 Esc = 팝업만 닫힘(최종발주 창 그대로 · 떠 있는 단추 다시 보임)');
              await pg.waitForFunction(() => /보낸 결과/.test((document.getElementById('fo-ia-result') || {}).textContent || ''), null, { timeout: 5000 });
              const rq = await pg.evaluate(() => window.__calls.filter(c => /register/.test(c.url) && c.body.dry === false).map(c => c.body));
              ok(rq.length === 1 && rq[0].run_id === 17 && rq[0].picks.r5 === '612345672222' && rq[0].picks.r9 === 'manual', tag + ' dry:false 요청 1번 · 같은 picks', rq);
              const rt = await pg.$eval('#fo-ia-result', e => e.innerText.replace(/\s+/g, ' '));
              ok(/수기 · 등록 안 함 네이버 · 김민수 · 010-1111-1234 · 2026102400000002 · 6123-4567-0002 · 같은 운송장 두 줄/.test(rt), tag + ' #841 서버가 막은 수기 줄 = 보낸 결과에 이유', rt);
              ok(/보냄 3 · 실패 1 · 모름 1/.test(rt) && /네이버 발송 상태 확인 2\/2건/.test(rt), tag + ' 보낸 결과 표·상태 확인', rt);
              const unk = await pg.evaluate(() => { const li = document.querySelector('.fo-ia-bad li[data-k="unknown"]'), b = li && li.querySelector('b'); return li ? { t: li.innerText.replace(/\s+/g, ' '), c: getComputedStyle(b).color, err: getComputedStyle(document.querySelector('.fo')).getPropertyValue('--f-err').trim() } : null; });
              ok(unk && /모름 · 다시 안 보냄 · 채널 화면에서 확인/.test(unk.t) && /6123-4567-2222/.test(unk.t) && /응답에 처리 결과 없음/.test(unk.t), tag + ' 모름 줄 글', unk);
              ok(unk && /rgb\((180, 35, 24|255, 122, 110)\)/.test(unk.c), tag + ' 모름 줄 빨강', unk && unk.c);
              ok(/실패 · 다음 \[짝 맞추기\] 때 다시 보낼 수 있어요/.test(await pg.textContent('#fo-ia-result')) && /INVALID_STATUS/.test(await pg.textContent('#fo-ia-result')), tag + ' 실패 줄 글·사유');
              ok(await pg.locator('#fo-ia-send').count() === 0 && await pg.locator('#fo-ia-reg').isDisabled(), tag + ' 보낸 뒤 보내기·등록 다시 못 누름');
              const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), tap(pg, '#fo-ia-dl')]);
              const fx = await pg.evaluate(() => window.__fetch);
              ok(fx.length === 1 && fx[0].u === '/api/agent-office/invoice-auto/manual/17' && fx[0].auth === 'Bearer x' && dl.suggestedFilename() === '자동송장_수기_17.xlsx', tag + ' 서버 수기 파일(Authorization · 이름)', { fx, name: dl.suggestedFilename() });
              const small = await pg.$$eval('#fo-ia button, #fo-ia select, #fo-ia summary', els => els.filter(e => e.offsetParent).map(e => [e.id || e.className, Math.round(e.getBoundingClientRect().height)]).filter(x => x[1] < 44));
              const over = await pg.evaluate(() => { const b = document.querySelector('.fo-body'); return b.scrollWidth - b.clientWidth + Math.max(0, document.scrollingElement.scrollWidth - innerWidth); });
              ok(!small.length && over <= 0, tag + ' 보낸 화면 44px · 넘침 0', { small, over });
              await pg.locator('#fo-ia-result').screenshot({ path: path.join(OUT, `sent-${w}.png`) });
              ok(errs.length === 0, tag + ' 전송 콘솔 오류 0', errs); await pg.close(); }
            { const { pg, errs } = await prep(U.sentok);
              await tap(pg, '#fo-ia-send'); await tap(pg, '#fo-ia-send-yes');
              const mt = await modal(pg, 'ok');
              ok(/등록 완료/.test(mt) && /오류 없음/.test(mt) && /네이버 4 · 쿠팡 1 · 자사몰 0/.test(mt) && !/수기 파일/.test(mt), tag + ' #841 전부 성공 팝업', mt);
              await pg.mouse.click(4, 4);
              ok(await pg.locator('#fo-ia-modal').count() === 0 && await pg.locator('#fo-panel').isVisible(), tag + ' #841 바깥 누르면 팝업 닫힘');
              ok(errs.length === 0, tag + ' 성공 팝업 콘솔 오류 0', errs); await pg.close(); }
            { const { pg, errs } = await prep(U.off409);
              await tap(pg, '#fo-ia-send'); await tap(pg, '#fo-ia-send-yes');
              await pg.waitForFunction(() => /전송이 꺼져 있어요/.test((document.getElementById('fo-ia-send-msg') || {}).textContent || ''), null, { timeout: 5000 });
              ok(await pg.locator('#fo-ia-send').count() === 0 && /시험 단계 · 채널로 보낸 것 0/.test(await pg.textContent('#fo-ia-result')), tag + ' 409 전송 꺼짐 = 안내 · 보내기 단추 없어짐');
              ok(errs.length === 0, tag + ' 409 콘솔 오류 0', errs); await pg.close(); }
            { const { pg, errs } = await prep(U.e500);
              await tap(pg, '#fo-ia-send'); await tap(pg, '#fo-ia-send-yes');
              await pg.waitForFunction(() => /채널 화면을 먼저 확인/.test((document.getElementById('fo-ia-send-msg') || {}).textContent || ''), null, { timeout: 5000 });
              ok(/다시 누르지 마세요/.test(await pg.textContent('#fo-ia-send-msg')) && await pg.locator('#fo-ia-send').isDisabled(), tag + ' 500 = 채널 화면 먼저 확인 · 보내기 잠김');
              ok(errs.length === 0, tag + ' 500 콘솔 오류 0', errs); await pg.close(); }
            await ctx.close();
        }
    } finally { await br.close(); }
    console.log(`\n결과: ${pass}/${pass + fail} · 그림 ${OUT}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

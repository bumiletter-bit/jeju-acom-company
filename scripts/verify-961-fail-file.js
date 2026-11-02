// #961 자동 송장 결과 [실패 줄 내려받기] — 화면 숫자 = 파일 줄 · 줄마다 이유 · 주문에 안 붙은 운송장 = 따로(확인만)
//   실코드 = final-order.js 의 결과 구간을 떼어 시험 페이지에서 실행 + invoice-auto.js 이유 함수 · 실DB·서버·채널 0 · 실행: node scripts/verify-961-fail-file.js
'use strict';
const path = require('path'), fs = require('fs'), ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const ia = require(path.join(ROOT, 'invoice-auto.js'));
let pass = 0, fail = 0; const ok = (c, m, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || d === undefined ? '' : ' — ' + JSON.stringify(d).slice(0, 500))); };
const src = fs.readFileSync(path.join(ROOT, 'public', 'final-order.js'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('    function failRows() {'), b = src.indexOf('    function drawResult() {'), c = src.indexOf('    // 서버 수기 파일(manual_file'), d0 = src.indexOf('    function downloadUm() {');
const dEnd = (() => { const st = src.indexOf('    async function download() {'); return src.indexOf('\n    }\n', st) + 7; })();
if ([a, b, c, d0].some(x => x < 0)) throw new Error('구간 못 찾음');
const code = src.slice(a, c) + src.slice(d0, dEnd);
const XJS = fs.readFileSync(path.join(ROOT, 'node_modules', 'xlsx-js-style', 'dist', 'xlsx.bundle.js'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><body><div id="fo-ia-result"></div><script>${XJS}</script><script>
var ia = { res: null, reg: null, picks: new Map(), sent: false };
const $ = id => document.getElementById(id), CH = ['naver', 'coupang', 'cafe24'], CH_LABEL = { naver: '네이버', coupang: '쿠팡', cafe24: '자사몰' }, RULE = { todo_pick: '고르기' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), tno = t => String(t || ''), who = x => x.recipient_name || x.recipient_masked || '', canReg = () => true, regNote = () => {};
const todoRows = () => ((ia.res && ia.res.rows) || []).filter(x => x.status === 'todo');
${code}
window.T = { set: (res, reg, picks) => { ia.res = res; ia.reg = reg; ia.picks = new Map(picks || []); drawResult(); }, failRows, unmatchedRows, download, downloadUm };
</script>`;
const UM = { tracking: '601203630551', recipient_masked: '가* · 끝 1234', recipient_name: '가나', product: '황금향 5kg', why: ia.unmatchedWhy({ senderTel: '01012345678' }) };
const read = async (pg, click, out) => { const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 6000 }), click()]); const f = path.join(require('os').tmpdir(), 'v961-' + out + '.xlsx'); await dl.saveAs(f); return pg.evaluate(b64 => { const wb = XLSX.read(b64, { type: 'base64' }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); }, fs0(f)); };
const fs0 = f => fs.readFileSync(f).toString('base64');
(async () => {
    console.log('이유 함수');
    ok(/끝 5678/.test(ia.unmatchedWhy({ senderTel: '01012345678' })) && !/01012345678/.test(ia.unmatchedWhy({ senderTel: '01012345678' })), '안 붙은 운송장 이유 = 번호 끝 4자리만');
    ok(/보내는 분 번호가 없어요/.test(ia.unmatchedWhy({ senderTel: '' })), '번호 없는 운송장 분기');
    ok(/^실패: INVALID/.test(ia.manualWhy({ state: 'failed', error: 'INVALID_STATUS' })) && /이유 미상/.test(ia.manualWhy({ state: 'failed' })), 'failed = 채널 오류 원문 · 없으면 이유 미상');
    ok(/다시 보내지 말고/.test(ia.manualWhy({ state: 'unknown' })) && /수기/.test(ia.manualWhy({ state: 'manual' })) && ia.manualWhy({ state: 'manual', error: '같은 운송장' }) === '같은 운송장' && /이유 미상/.test(ia.manualWhy({ state: 'sending' })), '모름 재전송 금지 · 수기 이유 · 다른 상태 기본값');
    const br = await chromium.launch(), ctx = await br.newContext({ acceptDownloads: true, viewport: { width: 390, height: 800 } }), pg = await ctx.newPage(), errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.setContent(html); await pg.waitForFunction(() => !!window.T);
    const DRY = { dry: false, send_enabled: true, sent: { naver: 3 }, failed: {}, unknown: {}, already: 0, manual: 0, skipped: 0 };
    console.log('실패 0 + 안 붙은 운송장 1(11/2 run 28 꼴)');
    await pg.evaluate(([res, reg]) => T.set(res, reg), [{ ship_date: '2026-11-02', rows: [{ id: 's1', status: 'auto' }], unmatched: [UM] }, Object.assign({}, DRY, { items: [{ id: 's1', channel: 'naver', state: 'sent', tracking: '1' }], manual_file: '/api/agent-office/invoice-auto/manual/28' })]);
    ok(await pg.locator('#fo-ia-dl').count() === 0, '실패 0 = [실패 줄 내려받기] 없음');
    const box = await pg.textContent('#fo-ia-um'); ok(box.includes('주문에 안 붙은 운송장 1 (확인만)') && box.includes('전송 실패가 아니에요') && box.includes('끝 5678'), '화면 = 확인만 · 이유', box);
    let f = await read(pg, () => pg.evaluate(() => T.downloadUm()), 'um'); ok(f.length === 2 && f[1][0] === '601203630551' && f[1][3] === UM.why && f[1][1] === UM.recipient_masked, '파일 줄 1 · 이유 · 이름 가림', f);
    console.log('failed 1 · unknown 1 · manual 1');
    const R3 = { ship_date: '2026-11-02', rows: [{ id: 'a', status: 'auto', recipient_name: '가', option: '옵' }, { id: 'b', status: 'auto', recipient_name: '나', option: '옵' }, { id: 'c', status: 'todo', recipient_name: '다', option: '옵', channel: 'naver', order_key: '3', rule: 'todo_pick' }], unmatched: [] };
    const I3 = [{ id: 'a', channel: 'naver', order_key: '1', tracking: '11', state: 'failed', error: 'INVALID_STATUS' }, { id: 'b', channel: 'coupang', order_key: '2', tracking: '22', state: 'unknown' }, { id: 'c', channel: 'naver', order_key: '3', tracking: null, state: 'manual' }];
    await pg.evaluate(([res, reg]) => T.set(res, reg), [R3, Object.assign({}, DRY, { failed: { naver: 1 }, unknown: { coupang: 1 }, manual: 1, items: I3 })]);
    ok((await pg.textContent('#fo-ia-dl')).includes('(3)') && await pg.locator('#fo-ia-um').count() === 0, '[실패 줄 내려받기 (3)] · 안 붙은 칸 없음');
    const txt = await pg.textContent('#fo-ia-result'); ok(txt.includes('INVALID_STATUS') && txt.includes('응답을 못 받았어요') && txt.includes('고르지 않았거나 수기로 골랐어요'), '화면 이유 3종', txt.slice(0, 400));
    f = await read(pg, () => pg.evaluate(() => T.download()), 'f3'); ok(f.length === 4 && /실패.*INVALID_STATUS/.test(f[1][5]) && /다시 보내지 말고/.test(f[2][5]) && /수기/.test(f[3][5]) && f.slice(1).every(r => String(r[5]).trim()), '파일 3줄 = 숫자 · 이유 3종', f);
    await pg.evaluate(([res, reg]) => T.set(res, reg), [R3, Object.assign({}, DRY, { items: [{ id: 'a', channel: 'naver', order_key: '1', tracking: '11', state: 'failed' }] })]);
    f = await read(pg, () => pg.evaluate(() => T.download()), 'fx'); ok(/이유 미상 · 총괄 확인/.test(f[1][5]), '이유 없는 실패 = 기본값', f);
    console.log('수기 고른 줄이 등록 결과 밖 + 서버 파일 있음');
    await pg.evaluate(([res, reg]) => T.set(res, reg, [['c', 'manual']]), [R3, Object.assign({}, DRY, { items: [], manual_file: '/api/agent-office/invoice-auto/manual/9' })]);
    ok((await pg.textContent('#fo-ia-dl')).includes('(1)'), '숫자 1');
    f = await read(pg, () => pg.evaluate(() => T.download()), 'ex'); ok(f.length === 2 && /수기로 둠/.test(f[1][5]), '화면 표로 내려받음(서버 파일은 이 줄을 모름)', f);
    console.log('전부 0');
    await pg.evaluate(([res, reg]) => T.set(res, reg), [{ ship_date: '2026-11-02', rows: [], unmatched: [] }, Object.assign({}, DRY, { items: [] })]);
    ok(await pg.locator('#fo-ia-dl').count() === 0 && await pg.locator('#fo-ia-um').count() === 0 && (await pg.textContent('#fo-ia-result')).includes('실패·수기 줄 없음'), '버튼 없음 · 「실패·수기 줄 없음」');
    ok(errs.length === 0, '오류 0', errs);
    await br.close();
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('❌ 멈춤', e.message); process.exit(1); });

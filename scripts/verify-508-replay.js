// #508 실자료 재현(설계서 §10): 하루치 실제 자료 → 실제 v2 화면(로컬 서버 · 시계 고정) → final-order-core → 그날 수기 완성본과 대조
//   입력(개인정보라 리포에 없음 — 없으면 건너뜀): 폴더 하나에
//     · 정리 파일(요청일자·번호·비고·플랫폼)      기본 「2026추석.xlsx」
//     · 현금파일(수기 13칸)                         기본 「제주아꼼이네송장(대성)09.20.xlsx」
//     · 새 폴더/ 스토어 발송처리 파일(27칸 — v2 의 네이버 파일 입력으로 넣는다) · 완성본 (대성)·(효돈)
//   사용: node scripts/verify-508-replay.js [폴더] [MM.DD]      (환경값 VERIFY_508_DIR · VERIFY_508_DAY · VERIFY_508_PORT 로도)
//   순서 = 화면(final-order.js)의 숨은 조종과 같다: 주문 넣기 → prepLines → #ln-all + saveLines → download 가로채기 → 현금파일 대조 → buildRows
//   출력은 건수뿐이다(이름·번호·주소를 찍지 않는다). 사람이 카드로 정하는 부분(확인필요 주문 등)은 v2 기본값 그대로 두고 건수만 알린다.
require('dotenv').config();
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process');
const jwt = require('jsonwebtoken'); const XLSX = require('xlsx-js-style');
const core = require('../public/final-order-core.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 300) : '')); };
const DIR = process.argv[2] || process.env.VERIFY_508_DIR || 'C:/Users/전승범/OneDrive/바탕 화면/추석 전 26.09.19';
const DAY = process.argv[3] || process.env.VERIFY_508_DAY || '09.20';
const PORT = Number(process.env.VERIFY_508_PORT) || 3459, BASE = `http://localhost:${PORT}`;
const ISO = `2026-${DAY.replace('.', '-')}`, FAKE = `${ISO}T09:30:00+09:00`;
const dg = v => String(v == null ? '' : v).replace(/\D/g, '');
const find = (dir, test) => { try { const f = fs.readdirSync(dir).find(x => !x.startsWith('~$') && /\.xlsx?$/i.test(x) && test(x.replace(/\s/g, ''))); return f ? path.join(dir, f) : null; } catch (_) { return null; } };
const SUB = path.join(DIR, '새 폴더');
const F = {
    lines: find(DIR, x => /추석|정리/.test(x) && !/송장/.test(x)),
    cash: find(DIR, x => x.includes('송장') && x.includes(DAY) && !/동봉물|추가건/.test(x)),
    store: find(SUB, x => /스토어|발주발송|발송처리/.test(x)),
    doneD: find(SUB, x => x.includes('(대성)') && x.includes(DAY) && !/동봉물|추가건/.test(x)),
    doneH: find(SUB, x => x.includes('(효돈)') && x.includes(DAY) && !/동봉물|추가건/.test(x)),
};
if (!F.store || !F.doneD || !F.doneH) { console.log(`실자료가 없어 건너뜁니다(폴더: ${DIR} · 필요한 것: 새 폴더/스토어 발송처리 파일 · 완성본 대성·효돈${F.lines ? '' : ' · 정리 파일'}${F.cash ? '' : ' · 현금파일'})`); process.exit(0); }
const TOKEN = jwt.sign({ id: 1, username: 'ceo', role: 'admin', name: '검증', position: '대표' }, 'verifytest', { expiresIn: '1h' });
async function waitUp() { for (let i = 0; i < 90; i++) { try { const r = await fetch(`${BASE}/api/public/version`); if (r.ok) return; } catch (_) { } await new Promise(r => setTimeout(r, 1000)); } throw new Error('server not up'); }
const aoaOf = (file, sheet) => { const wb = XLSX.readFile(file); return XLSX.utils.sheet_to_json(wb.Sheets[sheet || wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); };
// 엑셀에서 줄을 복사해 붙인 꼴(탭 · 날짜는 M/D/YY)로 만든다
function linesText(file) {
    if (!file) return '';
    const usd = n => { if (typeof n !== 'number') return String(n).trim(); const d = new Date(Math.round((n - 25569) * 86400e3)); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`; };
    return aoaOf(file).slice(1).filter(r => String(r[1]).trim() !== '').map(r => [usd(r[0]), String(r[1]).trim(), String(r[2]).trim(), String(r[3]).trim()].join('\t')).join('\n');
}
const readDone = (file, who) => aoaOf(file, 'Sheet1').slice(1).filter(r => r.some(v => v !== '')).map((r, i) => ({ who, pos: i, snd: String(r[0]).trim(), rcv: String(r[3]).trim(), opt: String(r[4]).trim(), qty: Number(r[5]) || 0, tel: dg(r[6]), addr: String(r[8]).trim(), memo: String(r[9]).trim(), btel: dg(r[10]) }));
// 발송처리 파일은 사람이 송장번호를 붙이려고 다시 정렬해 둔 것(옵션순 · 결제일 내림)이라, v2 가 주문을 받는 순서(결제일 오름 — v2 API 출력 실측)로 되돌린 임시 파일을 만들어 넣는다.
//   임시 파일은 개인정보라 끝나면 지운다. 원래 순서 그대로 넣으려면 VERIFY_508_KEEP_ORDER=1
function storeInput(file) {
    if (process.env.VERIFY_508_KEEP_ORDER === '1') return { file, temp: false };
    const wb = XLSX.readFile(file); const sn = wb.SheetNames[0]; const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    const hi = aoa.findIndex(r => Array.isArray(r) && r.includes('상품주문번호')); const pc = hi >= 0 ? aoa[hi].indexOf('결제일') : -1;
    if (hi < 0 || pc < 0) return { file, temp: false };
    const body = aoa.slice(hi + 1).filter(r => r.some(v => v !== '')).map((r, i) => ({ r, i })).sort((a, b) => (Number(a.r[pc]) || 0) - (Number(b.r[pc]) || 0) || a.i - b.i).map(x => x.r);
    const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(aoa.slice(0, hi + 1).concat(body)), sn);
    const tmp = path.join(require('os').tmpdir(), `verify508-store-${process.pid}.xlsx`); XLSX.writeFile(out, tmp);
    return { file: tmp, temp: true };
}
const lisLen = seq => { const t = []; for (const x of seq) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } t[lo] = x; } return t.length; };
const tally = (list, fn) => { const m = {}; list.forEach(x => { const k = fn(x); m[k] = (m[k] || 0) + 1; }); return JSON.stringify(m); };

(async () => {
    console.log(`실자료 재현: ${DAY} · 서버 ${PORT} · 시계 ${FAKE}`);
    const fakePre = `(()=>{const RD=Date,off=RD.parse(${JSON.stringify(FAKE)})-RD.now();global.Date=class extends RD{constructor(...a){if(a.length===0)super(RD.now()+off);else super(...a);}static now(){return RD.now()+off;}};})();`;
    const srv = spawn(process.execPath, ['-e', `${fakePre}global.setInterval=()=>({unref(){},ref(){}}); require('./server.js');`], { cwd: path.join(__dirname, '..'), env: { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'ignore'] });
    let br; const input = storeInput(F.store);
    try {
        await waitUp();
        const byPartner = (await (await fetch(`${BASE}/api/invoice/catalog`, { headers: { Authorization: 'Bearer ' + TOKEN } })).json()).byPartner || {};
        const { chromium } = require('playwright');
        br = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage'] }); const ctx = await br.newContext();
        await ctx.addInitScript(t => { localStorage.setItem('jwt_token', t); }, TOKEN);
        const pg = await ctx.newPage(); await pg.clock.setFixedTime(new Date(FAKE)); const errs = []; pg.on('pageerror', e => errs.push(e.message));
        await pg.goto(`${BASE}/invoice-v2.html`, { waitUntil: 'load' }); await pg.waitForFunction(() => window.__ivt, null, { timeout: 30000 });
        // ① 주문 넣기(발송처리 파일 = 그날 실제로 나간 네이버 주문 전부 · 입력삭제 노란 줄 포함)
        await pg.setInputFiles('#file-naver', input.file);
        await pg.waitForFunction(() => document.querySelectorAll('#preview tbody tr').length > 0 && !document.getElementById('btn-download').disabled, null, { timeout: 60000 });
        await pg.waitForTimeout(800);
        const cal = await pg.evaluate(() => { const c = __ivt.S.calendar; return { realToday: c.realToday, suggested: c.suggested, shipDays: c.shipDays, noShip: [...c.noShip], n: __ivt.S.merged.length }; });
        ok(cal.realToday === ISO && cal.shipDays.includes(ISO), `① 주문 ${cal.n}건 · 기준 발송일 후보에 ${DAY} 있음`, `오늘 ${cal.realToday} · 추천 ${cal.suggested}`);
        // ② 메모 줄 다듬기 → v2 에 넣기
        const memo = linesText(F.lines);
        const prep = core.prepLines(memo, { realToday: cal.realToday, shipDays: cal.shipDays, noShip: cal.noShip, shipDate: ISO });
        const inL = memo.split('\n'), outL = prep.v2Text.split('\n');
        ok(outL.length === inL.length, `② 정리 줄 ${memo ? inL.length : 0}줄 → 다듬은 뒤 줄 수 같음 · 바뀐 줄 ${inL.filter((l, i) => l !== outL[i]).length} · 보내는이 지정 ${prep.senders.length} · 안내 ${tally(prep.notes, n => n.type)}`);
        const st = await pg.evaluate(async ({ text, ship }) => {
            const S = __ivt.S; S.shipDate = ship; document.getElementById('ln-all').value = text; await __ivt.saveLines(S);
            const key = e => e.ch + ':' + e.i, d = v => String(v == null ? '' : v).replace(/\D/g, '');
            return { ship: S.shipDate, lines: (S.allLines || []).map(l => ({ bad: !!l.bad, hits: l.hits || 0, expect: l.expect == null ? null : l.expect, indiv: !!l.indiv, date: l.date || null })),
                orders: S.merged.map(e => ({ key: key(e), digits: d(e.conv['구매자연락처']), ids: [], recipient: String(e.conv['수취인명'] || ''), qty: Number(e.conv['수량']) || 0, individual: !!e.individual, excluded: !!e.excluded, buyer: String(e.conv['구매자명'] || ''), flag: e.flag || '', reqKind: e.reqKind || '', senderAmb: !!(e.sender && e.sender.ambiguous), senderAuto: !!(e.sender && !e.sender.ambiguous),
                    memo: String(e.conv['배송메세지'] || ''), rtel: [d(e.conv['수취인연락처1']), d(e.conv['수취인연락처2'])].filter(Boolean) })) };
        }, { text: prep.v2Text, ship: ISO });
        ok(st.ship === ISO, `   기준 발송일 = ${DAY}`, st.ship);
        const L = st.lines, O = st.orders;
        console.log(`   v2 줄 판정: 줄 ${L.length} · 주문 맞음 ${L.filter(l => !l.bad && l.hits).length} · 주문 없음 ${L.filter(l => !l.bad && !l.hits).length} · 형식 오류 ${L.filter(l => l.bad).length} · 비고 건수와 다름 ${L.filter(l => l.expect != null && l.hits && l.expect !== l.hits).length}`);
        console.log(`   주문 판정: 개별발송 ${O.filter(o => o.individual).length} · 제외 ${O.filter(o => !o.individual && o.excluded).length} · 확인필요(카드 대상 — 여기선 그대로 발송) ${O.filter(o => !o.individual && !o.excluded && o.flag === 'review' && o.reqKind !== 'today').length} · 보내는이 자동 ${O.filter(o => o.senderAuto).length} · 보내는이 애매 ${O.filter(o => o.senderAmb).length}`);
        const sig = O.filter(o => !o.individual && !o.excluded && core.splitSignal({ memo: o.memo, qty: o.qty, buyerDigits: o.digits, recvDigits: o.rtel }));
        console.log(`   나눠 보내기 신호(카드 대상): ${sig.length}건`);
        // ③ 현금파일
        const cash = F.cash ? core.parseCash(aoaOf(F.cash)) : { ok: true, error: '', rows: [] };
        ok(cash.ok, `③ 현금파일 ${cash.rows.length}행(「!」 ${cash.rows.filter(r => r.bang).length}) 읽기`, cash.error);
        const chk = core.cashCheck({ orders: O, cash: cash.rows });
        console.log(`   대조: 입력삭제인데 줄 없음 ${chk.missing.length} · 현금파일에 있는데 입력삭제 아님 ${chk.notIndiv.length} · 박스 수 다름 ${chk.boxDiff.length}(파일이 많음 ${chk.boxDiff.filter(b => b.cashQty > b.orderQty).length} · 적음 ${chk.boxDiff.filter(b => b.cashQty < b.orderQty).length}) · 주문에 없는 구매자 ${chk.strangers.length} · 대조 못 함 ${chk.unchecked.length}`);
        // ④ 파일 만들기: download 가로채기 → 시트1 행 = list 순서
        const dl = await pg.evaluate(async () => {
            const S = __ivt.S; const orig = XLSX.writeFile; XLSX.writeFile = () => { };
            let wb; try { wb = await __ivt.download(); } finally { XLSX.writeFile = orig; }
            if (!wb) return { err: document.getElementById('msg-dl').textContent };
            const list = S.merged.filter(e => !e.individual && !e.excluded); const ws = wb.Sheets['Sheet1']; const cols = 'ABCDEFGHIJK'.split('');
            const program = list.map((e, i) => ({ key: e.ch + ':' + e.i, cells: cols.map(c => { const x = ws[c + (i + 2)]; return x ? { v: x.v, t: x.t, s: x.s } : { v: '', t: 's' }; }) }));
            const s2 = wb.Sheets['발주발송관리']; const s2n = s2 ? XLSX.utils.sheet_to_json(s2, { header: 1, defval: '' }).filter(r => r.some(v => v !== '')).length - 2 : 0;
            return { program, s1: XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).length - 1, s2n, msg: document.getElementById('msg-dl').textContent };
        });
        await br.close(); br = null;
        ok(!dl.err && dl.program.length === dl.s1, `④ v2 시트1 ${dl.s1 || 0}행 = 목록 ${dl.program ? dl.program.length : 0}건 · 스토어 양식 ${dl.s2n || 0}행 · 페이지 오류 ${errs.length}`, dl.err || null);
        if (dl.err) throw new Error(dl.err);
        ok(errs.length === 0, '   페이지 오류 0', errs.join(' | '));
        const out = core.buildRows({ program: dl.program, cash: cash.rows, byPartner, picks: {}, senderByKey: core.applySenders(prep.senders, O).byKey, defaultMemo: core.DEFAULT_MEMO });
        ok(out.unknown.length === 0, `   거래처 못 정한 옵션 ${out.unknown.length}종`, out.unknown.map(u => u.replace(/^.*상품 및 과수:\s*/, '')).join(' | '));
        // ⑤ 완성본과 대조(거래처별 · 수취인+옵션+수량 묶음)
        const done = { '대성': readDone(F.doneD, '대성'), '효돈': readDone(F.doneH, '효돈') };
        const storeBuyers = new Set(O.map(o => o.digits));
        let totPair = 0, totMine = 0, totDone = 0;
        for (const short of ['대성', '효돈']) {
            const p = out.partners.find(x => x.short === short); const mine = p ? p.rows.map((r, i) => ({ pos: i, src: r.src, jeju: r.jeju, snd: String(r.cells[0].v).trim(), rcv: String(r.cells[3].v).trim(), opt: String(r.cells[4].v).trim(), qty: Number(r.cells[5].v) || 0, tel: dg(r.cells[6].v), addr: String(r.cells[8].v).trim(), memo: String(r.cells[9].v).trim() })) : [];
            const dn = done[short]; const k3 = r => [r.rcv, r.opt, r.qty].join('|');
            const bucket = new Map(); dn.forEach(r => { (bucket.get(k3(r)) || bucket.set(k3(r), []).get(k3(r))).push(r); });
            const used = new Set(), pairs = [], onlyMine = [];
            for (const m of mine) { const b = (bucket.get(k3(m)) || []).filter(r => !used.has(r)); const r = b.find(x => x.tel.slice(-8) === m.tel.slice(-8)) || b[0]; if (r) { used.add(r); pairs.push([m, r]); } else onlyMine.push(m); }
            const onlyDone = dn.filter(r => !used.has(r));
            totPair += pairs.length; totMine += mine.length; totDone += dn.length;
            console.log(`\n⑤ ${short}: 결과 ${mine.length}행(프로그램 ${mine.filter(m => m.src === 'program').length} · 현금파일 ${mine.filter(m => m.src === 'cash').length}) · 완성본 ${dn.length}행 · 수량 합 ${p ? p.total : 0} / ${dn.reduce((s, r) => s + r.qty, 0)}`);
            console.log(`   짝 맞음 ${pairs.length} · 완성본에만 있음 ${onlyDone.length} ${tally(onlyDone, r => /!/.test(r.snd) ? '현금(!)' : /자사몰|쿠팡/.test(r.snd) ? '자사몰·쿠팡(입력에 없는 채널)' : storeBuyers.has(r.btel) ? '스토어 구매자의 줄' : '그 밖')} · 결과에만 있음 ${onlyMine.length} ${tally(onlyMine, m => m.src === 'cash' ? '현금파일 행' : '프로그램 행')}`);
            const seq = pairs.slice().sort((a, b) => a[0].pos - b[0].pos).map(([, r]) => r.pos);
            // 품목 묶음의 순서 · 묶음 안에서 현금파일 행이 먼저인지는 따로 본다(묶음 안 프로그램 행끼리의 순서는 v2 가 주문을 받은 순서라 입력 파일 순서에 달려 있다)
            const optSeq = l => { const o = []; l.forEach(r => { if (o[o.length - 1] !== r.opt) o.push(r.opt); }); return o.join('→'); };
            const cashFirst = l => { const g = {}; l.forEach(r => (g[(r.jeju ? 'J|' : '') + r.opt] = g[(r.jeju ? 'J|' : '') + r.opt] || []).push(r.src === 'cash')); return Object.values(g).every(b => b.lastIndexOf(true) < (b.indexOf(false) < 0 ? b.length : b.indexOf(false))); };
            console.log(`   품목 묶음 순서가 완성본과 같음 ${optSeq(pairs.map(p2 => p2[0])) === optSeq(pairs.slice().sort((a, b) => a[1].pos - b[1].pos).map(p2 => p2[1]))} · 결과의 묶음 안에서 현금파일 행이 먼저 ${cashFirst(mine)}`);
            const byDone = pairs.slice().sort((a, b) => a[1].pos - b[1].pos);
            const doneCashFirst = cashFirst(byDone.map(([m, r]) => ({ opt: r.opt, jeju: r.addr.startsWith('제주'), src: m.src })));
            const cashSeq = pairs.filter(([m]) => m.src === 'cash').sort((a, b) => a[0].pos - b[0].pos).map(([, r]) => r.pos);
            console.log(`   완성본도 묶음 안에서 현금파일 행이 먼저 ${doneCashFirst} · 현금파일 행끼리의 순서 어긋남 ${cashSeq.length - lisLen(cashSeq)}/${cashSeq.length}`);
            console.log(`   정렬 위치 다름 ${seq.length - lisLen(seq)}(짝 맞은 행의 순서가 완성본과 어긋난 수 — 묶음 안 프로그램 행끼리의 순서 = v2 가 주문을 받은 순서라 이 재현의 입력 순서에 달림) · 제주 행 ${mine.filter(m => m.jeju).length} / 완성본 ${dn.filter(r => r.addr.startsWith('제주')).length} · 결과의 제주 행이 맨 아래 ${mine.filter(m => m.jeju).every((m, i, a) => m.pos === mine.length - a.length + i)}`);
            const memoDiff = pairs.filter(([m, r]) => m.memo !== r.memo);
            console.log(`   메모 다름 ${memoDiff.length} ${tally(memoDiff, ([m, r]) => r.memo === core.DEFAULT_MEMO ? '완성본은 기본 문구(사람이 요청 글을 지움)' : m.memo === core.DEFAULT_MEMO ? '결과는 기본 문구 · 완성본은 다른 글' : '둘 다 글이 있고 다름')}`);
            const sndDiff = pairs.filter(([m, r]) => m.snd !== r.snd);
            console.log(`   보내는사람 다름 ${sndDiff.length} ${tally(sndDiff, ([m, r]) => /드림/.test(r.snd) && !/드림/.test(m.snd) ? '완성본만 「드림」(수기 변경)' : /드림/.test(m.snd) && !/드림/.test(r.snd) ? '결과만 「드림」(자동 변경)' : '글자 다름')}`);
        }
        console.log('');
        ok(totMine > 0 && totPair / totMine >= 0.95, `결과 행 중 완성본과 짝 맞은 비율 ${(totPair / Math.max(totMine, 1) * 100).toFixed(1)}%(${totPair}/${totMine}) ≥ 95%`);
        ok(totPair / totDone >= 0.9, `완성본 행 중 결과로 재현된 비율 ${(totPair / Math.max(totDone, 1) * 100).toFixed(1)}%(${totPair}/${totDone}) ≥ 90%(나머지 = 입력에 없는 채널·수기 수정)`);
    } catch (e) { fail++; console.log('  ❌ 중단: ' + e.message); }
    finally { if (br) await br.close().catch(() => { }); srv.kill(); if (input.temp) { try { fs.unlinkSync(input.file); } catch (_) { } } }
    console.log(`\n합계: ✅ ${pass} · ❌ ${fail}`);
    process.exit(fail ? 1 : 0);
})();

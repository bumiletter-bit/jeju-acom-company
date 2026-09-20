// #461 발주 수량 러너 실행기(읽기 전용) — 로그인·브라우저 없이 실서버가 3채널 배송준비를 조회해 수량을 돌려준다
//   사용: node scripts/run-461-invoice-qty.js [정리파일.xlsx] [수기파일.xlsx] [기준일 M/D 예: 9/21] [동봉물파일.xlsx]
//   · 정리 파일에서 「기준일 + 입력o삭제x」 줄의 번호 = 개별발송(프로그램 시트1에서 빠짐) → 러너에 넘겨 분리 집계
//   · 기준일보다 뒤 날짜 줄은 제외 대상이지만, 마지막 발송일처럼 "전부 나감"이면 제외 없음(이 스크립트는 제외를 계산하지 않는다 — 뒤 날짜 줄이 있으면 경고만)
//   🔴 배포 직후엔 5~10분 뒤에 실행(롤링 중 구인스턴스는 이 러너를 모름 → 타임아웃)
require('dotenv').config();
const path = require('path'); const { Pool } = require('pg'); const XLSX = require('xlsx-js-style');
const [memoFile, manFile, baseArg, encFile] = process.argv.slice(2);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const dg = s => String(s || '').replace(/\D/g, ''); const pad = (s, n) => String(s).padStart(n);
const norm = t => { t = String(t); let tail = t.includes('상품 및 과수:') ? t.split('상품 및 과수:')[1] : (t.includes('·') ? t.split('·').slice(1).join('·') : t); tail = tail.trim().replace(/^\(특가\)\s*/, '').replace(/^하우스감귤\s*/, ''); const fam = /황금향/.test(t) ? '황금향' : /청귤|풋귤/.test(t) ? '청귤' : /감귤|하우스귤|귤/.test(t) ? '하우스감귤' : '기타'; return { fam, name: tail }; };
const partner = fam => fam === '황금향' || fam === '청귤' ? '대성(시온)' : fam === '하우스감귤' ? '효돈' : '기타';
(async () => {
    const base = baseArg || (() => { const d = new Date(Date.now() + 9 * 3600e3); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); })();
    let lines = [];
    if (memoFile) { const aoa = XLSX.utils.sheet_to_json(XLSX.readFile(memoFile).Sheets['원본'] || XLSX.readFile(memoFile).Sheets[XLSX.readFile(memoFile).SheetNames[0]], { header: 1, defval: '', raw: false }); lines = aoa.slice(1).filter(r => String(r[1]).trim()).map(r => ({ d: String(r[0]).trim().replace(/\/\d{2,4}$/, ''), tel: dg(r[1]), note: String(r[2]), pf: String(r[3]) })); }
    const indivLines = lines.filter(l => l.d === base && /입력\s*o\s*삭제\s*x/i.test(l.note)); const later = lines.filter(l => l.d !== base);
    console.log(`기준 발송일 ${base} · 정리 줄 ${lines.length}줄 · 개별발송(입력삭제) ${indivLines.length}줄` + (later.length ? ` · ⚠️ 기준일이 아닌 줄 ${later.length}줄(${[...new Set(later.map(l => l.d))].join(',')}) — 이 집계에서는 제외하지 않음` : ''));
    await pool.query(`DELETE FROM agent_office_config WHERE key='invoice_qty_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('invoice_qty_request', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ days: 50, indiv_tels: indivLines.map(l => l.tel) })]);
    let res = null; const t0 = Date.now(); while (Date.now() - t0 < 420000) { await new Promise(r => setTimeout(r, 6000)); const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='invoice_qty_result'`); if (q.rows.length) { res = q.rows[0].value; await pool.query(`DELETE FROM agent_office_config WHERE key='invoice_qty_result'`); break; } }
    await pool.end(); if (!res) throw new Error('러너 타임아웃 — 배포 직후면 몇 분 뒤 다시');
    if (res.error) throw new Error('러너 오류: ' + res.error);
    console.log(`조회 ${new Date(new Date(res.at).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')} KST · 주문 네이버 ${res.counts.naver ?? '-'} · 자사몰 ${res.counts.cafe24 ?? '-'} · 쿠팡 ${res.counts.coupang ?? '-'}` + (Object.keys(res.errors || {}).length ? ' · ⚠️ 오류 ' + JSON.stringify(res.errors) : ''));
    const prog = {}, indiv = {}; let unm = [];
    for (const g of res.groups) { const n = norm(g.opt); if (n.fam === '기타' || /개인\s*결제창/.test(g.opt)) { unm.push(`${g.ch} ${g.indiv ? '[개별]' : ''} ${g.opt.slice(0, 50)} x${g.qty}`); continue; } const k = n.fam + '|' + n.name; (g.indiv ? indiv : prog)[k] = ((g.indiv ? indiv : prog)[k] || 0) + g.qty; }
    const rd = f => f ? XLSX.utils.sheet_to_json(XLSX.readFile(f).Sheets.Sheet1, { defval: '' }) : []; const sumFile = rows => { const m = {}; rows.forEach(r => { const n = norm(r['옵션정보']); const k = n.fam + '|' + n.name; m[k] = (m[k] || 0) + (parseInt(r['수량']) || 0); }); return m; };
    const man = sumFile(rd(manFile)), enc = sumFile(rd(encFile));
    for (const p of ['대성(시온)', '효돈']) { const keys = [...new Set([...Object.keys(prog), ...Object.keys(man)])].filter(k => partner(k.split('|')[0]) === p).sort(); console.log(`\n[${p}]  품목 | 프로그램(시트1) | 수기 파일 | 합계`); let a = 0, b = 0, e = 0;
        for (const k of keys) { a += prog[k] || 0; b += man[k] || 0; console.log('  ' + k.split('|')[1].padEnd(36) + pad(prog[k] || 0, 5) + pad(man[k] || 0, 7) + pad((prog[k] || 0) + (man[k] || 0), 7)); }
        for (const k of Object.keys(enc).filter(k => partner(k.split('|')[0]) === p)) { e += enc[k]; console.log('  ' + (k.split('|')[1].replace(/\(.*$/, '') + ' - 동봉물!').padEnd(36) + pad('-', 5) + pad(enc[k], 7) + pad(enc[k], 7)); }
        console.log('  ' + '합계'.padEnd(36) + pad(a, 5) + pad(b + e, 7) + pad(a + b + e, 7)); }
    if (unm.length) console.log('\n미분류(개인결제창·기타):', unm.join(' | '));
    // 개별발송 구매자별: 주문 수량 vs 수기 파일 수량(전화 끝 4자리)
    if (indivLines.length) { console.log('\n[개별발송(입력삭제) 구매자 — 주문 수량 vs 수기 파일]'); const manRows = rd(manFile);
        for (const l of indivLines) { const t4 = l.tel.slice(-4); const o = {}; res.indiv_buyers.filter(b => b.tel4 === t4).forEach(b => { const n = norm(b.opt); o[n.name] = (o[n.name] || 0) + b.qty; }); const m = {}; manRows.filter(r => dg(r['구매자연락처']) === l.tel || dg(r['보내는사람연락처']) === l.tel).forEach(r => { const n = norm(r['옵션정보']).name.replace(/\s*[A-Z0-9]+사이즈로!$/, ''); m[n] = (m[n] || 0) + (parseInt(r['수량']) || 0); });
            const ks = [...new Set([...Object.keys(o), ...Object.keys(m)])]; const same = ks.length && ks.every(k => (o[k] || 0) === (m[k] || 0)); console.log('  ' + (same ? '✅' : '⚠️') + ' 끝' + t4 + ' 비고「' + l.note + '」 · ' + (ks.length ? ks.map(k => `${k.replace(/\(.*$/, '')}: 주문 ${o[k] || 0} / 수기 ${m[k] || 0}`).join(' ; ') : '주문·수기 모두 없음')); } }
    const tot = o => Object.values(o).reduce((x, y) => x + y, 0); console.log(`\n프로그램(시트1) ${tot(prog)}박스 · 개별발송 주문 ${tot(indiv)}박스 · 수기 파일 ${tot(man)}박스` + (encFile ? ` · 동봉물 ${tot(enc)}박스` : ''));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

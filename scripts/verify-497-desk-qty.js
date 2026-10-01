// #497 검증 — 창구 중간발주 PNG 도구(scripts/desk/qty-image.js)
//   사용: node scripts/verify-497-desk-qty.js [러너결과json]
//   · 결과 json을 주면 --no-run(DB 쓰기 0)으로 렌더만 검증 · 없으면 실러너 1회(invoice_qty_request · 읽기 전용 러너)
//   검사: 마지막 줄 JSON 파싱 · 거래처 합 + 미매칭 합 = groups qty 합 · 행 수량 > 0 · 파일 존재·PNG 크기 · 거래처 이름 = pricing partner · 주문 0 품목 미포함
const path = require('path'); const fs = require('fs'); const os = require('os'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };
const given = process.argv[2];
const outDir = path.join(os.tmpdir(), 'verify-497-' + Date.now());
const args = ['scripts/desk/qty-image.js', '--out', outDir]; if (given) args.push('--no-run', path.resolve(given));
const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const lines = out.trim().split('\n'); let J = null;
try { J = JSON.parse(lines[lines.length - 1]); } catch (e) { /* 아래 ok에서 실패 */ }
ok(!!J, '마지막 줄 JSON 파싱', J ? Object.keys(J).join(',') : lines.slice(-3).join(' | '));
if (!J) { console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(1); }
const resFile = given || (fs.readdirSync(outDir).filter(f => /러너결과/.test(f)).map(f => path.join(outDir, f))[0]);
const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
const gsum = (res.groups || []).reduce((s, g) => s + (parseInt(g.qty, 10) || 1), 0);
const psum = Object.values(J.partners).reduce((s, p) => s + p.total, 0);
const usum = J.unmatched.reduce((s, u) => s + u.qty, 0);
ok(psum + usum === gsum, '거래처 합 + 미매칭 합 = groups qty 합', `${psum} + ${usum} = ${gsum}`);
ok(Object.values(J.partners).every(p => p.total === p.rows.reduce((s, r) => s + r.qty, 0)), '거래처 total = 행 합');
ok(Object.values(J.partners).every(p => p.rows.every(r => r.qty > 0)), '주문 0 품목 미포함(행 수량 전부 > 0)');
ok(Object.values(J.partners).every(p => p.rows.every(r => !r.name.startsWith('[미매칭]'))), '거래처 표에 [미매칭] 없음');
ok(J.files.length === Object.keys(J.partners).length + (J.unmatched.length ? 1 : 0), 'PNG 파일 수 = 거래처 수 + 미매칭(있을 때)', J.files.map(f => path.basename(f)).join(' · '));
ok(J.files.every(f => fs.existsSync(f) && fs.statSync(f).size > 2000), 'PNG 파일 존재·2KB 초과', J.files.map(f => fs.existsSync(f) ? fs.statSync(f).size : 'X').join(','));
const pngDim = f => { const b = fs.readFileSync(f); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
ok(J.files.every(f => { const d = pngDim(f); return d && d[0] > 200 && d[1] > 60; }), 'PNG 헤더·크기(2배 배율)', J.files.map(f => (pngDim(f) || []).join('x')).join(' · '));
ok(Object.keys(J.partners).every(p => /^[가-힣()\w]+$/.test(p)), '거래처 이름 = pricing partner 글자', Object.keys(J.partners).join(','));
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(J.at), 'at = KST 문자열', J.at);
console.log(`\n출력 폴더 ${outDir}\n결과: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);

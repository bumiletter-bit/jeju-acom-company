// #582 공유폴더 파일 찾기 — 사용: node scripts/desk/share-find.js "검색어 [검색어…]" [--limit 15] [--ext pdf,xlsx] [--folder ★송장]
//   파일 이름·폴더 이름에 검색어(띄어쓰기로 나눈 낱말 전부)가 들어 있는 파일을 최근 수정 순으로 내준다(색인 = share-index.js · 60분 넘으면 먼저 갱신).
//   결과의 path 를 respond.js 의 attachments 에 그대로 넣으면 직원 화면에 내려받기 버튼이 붙는다(파일당 10MB · 5개까지 — 넘는 파일은 attach:false 로 표시되니 경로만 안내).
const fs = require('fs'), path = require('path'); const { execFileSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'akkome', '공유폴더_색인'); const FILES_JSON = path.join(OUT, 'files.json');   // OneDrive 밖(share-index.js 와 같은 자리)
const MAX_ATTACH = 10 * 1024 * 1024;
const ATTACH_EXT = ['xlsx', 'xls', 'csv', 'md', 'txt', 'pdf', 'docx', 'doc', 'pptx', 'hwp', 'hwpx', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'];   // respond.js 와 같은 목록
const args = process.argv.slice(2); const opt = {}; const words = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--limit') opt.limit = +args[++i]; else if (args[i] === '--ext') opt.ext = args[++i].toLowerCase().split(','); else if (args[i] === '--folder') opt.folder = args[++i]; else if (args[i] === '--no-update') opt.noUpdate = true; else words.push(...args[i].split(/\s+/)); }
const q = words.map(w => w.trim().toLowerCase()).filter(Boolean);
if (!q.length) { console.log(JSON.stringify({ ok: false, error: '사용: share-find.js "검색어"' })); process.exit(1); }
// 색인이 없으면 지금 만들고(약 1.5분), 60분 넘게 오래됐으면 있던 색인으로 바로 답하고 뒤에서 새로 만든다(다음 질문부터 새 색인)
if (!opt.noUpdate) {
    if (!fs.existsSync(FILES_JSON)) { try { execFileSync(process.execPath, [path.join(__dirname, 'share-index.js'), '--files-only'], { stdio: ['ignore', 'ignore', 'inherit'] }); } catch (e) { /* 아래에서 오류 안내 */ } }
    else if (Date.now() - fs.statSync(FILES_JSON).mtimeMs > 60 * 60 * 1000) { try { spawn(process.execPath, [path.join(__dirname, 'share-index.js')], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { /* 무시 */ } }
}
if (!fs.existsSync(FILES_JSON)) { console.log(JSON.stringify({ ok: false, error: '색인이 없습니다 — node scripts/desk/share-index.js 를 먼저 실행하세요(공유폴더 연결 확인)' })); process.exit(2); }
const idx = JSON.parse(fs.readFileSync(FILES_JSON, 'utf8'));
const norm = s => String(s).toLowerCase().replace(/[\s_\-()\[\]★■●·,.]+/g, '');
const hits = [];
for (const f of idx.files) {
    const lp = f.p.toLowerCase(), ln = f.n.toLowerCase(), np = norm(f.p);
    if (opt.folder && !f.p.startsWith(opt.folder)) continue;
    if (opt.ext && !opt.ext.includes(path.extname(f.n).slice(1).toLowerCase())) continue;
    let score = 0, all = true;
    for (const w of q) { const nw = norm(w); if (ln.includes(w)) score += 3; else if (lp.includes(w)) score += 1; else if (nw && np.includes(nw)) score += 1; else { all = false; break; } }
    if (!all) continue;
    hits.push({ score, f });
}
hits.sort((a, b) => b.score - a.score || b.f.m - a.f.m);
const limit = opt.limit || 15;
const items = hits.slice(0, limit).map(({ f }) => ({ name: f.n, folder: path.dirname(f.p) === '.' ? '(맨 위)' : path.dirname(f.p), path: path.join(idx.share, f.p), size_kb: Math.round(f.s / 1024), modified: new Date(f.m).toISOString().slice(0, 10), attach: f.s > 0 && f.s <= MAX_ATTACH && ATTACH_EXT.includes(path.extname(f.n).slice(1).toLowerCase()) }));
console.log(JSON.stringify({ ok: true, query: q.join(' '), total: hits.length, shown: items.length, indexed_at: idx.at, items }, null, 1));

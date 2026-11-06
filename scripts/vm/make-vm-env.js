// #1039-B 나스 윈도우 VM(어사이드 전용 PC)용 .env 한 장 — 노트북 .env 에서 VM 이 꼭 쓰는 칸만 골라 새 파일로 쓴다.
//   쓰기:   node scripts/vm/make-vm-env.js --out <USB 또는 빈 폴더>\.env      (있으면 멈춤 · --force 로 덮음)
//   확인:   node scripts/vm/make-vm-env.js --check <파일>                     (칸 이름만 찍음 · 값 0)
//   미리:   node scripts/vm/make-vm-env.js                                    (= --dry · 골라질 칸 이름·빠질 칸 수만)
// 🔴 값은 어디에도 찍지 않는다(칸 이름만).
// VM 이 쓰는 칸 = 실코드 근거(scripts/desk/keyword-rank.js · install-keyword-rank.js · _db.js):
//   DATABASE_URL  = _db.js 의 pg Pool(keyword_rank 설정 읽기 · keyword_rankings·keyword_rank_last·audit 쓰기)
//   그 밖 칸은 안 씀 — 텔레그램·알림 종은 렌더 서버 1분 틱이 keyword_rank_last 를 보고 보냄(VM 에 텔레그램 키 필요 없음).
//   🔴 ASIDE_EXE · KR_PAGE_WAIT_MS 는 keyword-rank.js 맨 위(50·51행)에서 .env 를 읽기 전에 정해진다 → .env 에 넣어도 효과 0 · 사용자 환경 변수로(setup-aside-vm.ps1 이 함).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const KEEP = ['DATABASE_URL'];

function parse(text) {
    const out = [];
    for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
        const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (m) out.push({ key: m[1], line: raw.trim() });
    }
    return out;
}
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const src = val('--src') || path.join(ROOT, '.env');

if (args.includes('--check')) {
    const f = val('--check');
    const rows = parse(fs.readFileSync(f, 'utf8'));
    const keys = rows.map(r => r.key);
    const missing = KEEP.filter(k => !keys.includes(k));
    const emptyKeys = rows.filter(r => /=\s*$/.test(r.line)).map(r => r.key);
    console.log(JSON.stringify({ ok: !missing.length && !emptyKeys.some(k => KEEP.includes(k)), file: f, keys, missing, empty: emptyKeys }));
    process.exit(missing.length ? 1 : 0);
}

const rows = parse(fs.readFileSync(src, 'utf8'));
const pick = KEEP.map(k => rows.filter(r => r.key === k).pop()).filter(Boolean);   // 같은 칸이 둘이면 마지막 것(dotenv parse 도 뒤 값이 이김) + 아래 경고
const dup = KEEP.filter(k => rows.filter(r => r.key === k).length > 1);
const missing = KEEP.filter(k => !pick.find(p => p.key === k));
const out = val('--out');
const summary = { src, keep: pick.map(p => p.key), missing, dropped: rows.length - pick.length, dup_warning: dup.length ? dup.join(',') + ' 가 두 번 — 확인 필요' : null };
if (!out) { console.log(JSON.stringify(Object.assign({ dry: true, 안내: '--out <파일> 로 쓰기' }, summary), null, 1)); process.exit(missing.length ? 1 : 0); }
if (missing.length) { console.log(JSON.stringify(Object.assign({ ok: false, error: '필요한 칸 없음' }, summary))); process.exit(1); }
if (fs.existsSync(out) && !args.includes('--force')) { console.log(JSON.stringify({ ok: false, error: '이미 있음 — 덮으려면 --force', out })); process.exit(1); }
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, '# #1039-B 나스 VM 어사이드 전용 · make-vm-env.js 가 만듦 ' + new Date().toISOString().slice(0, 10) + '\r\n' + pick.map(p => p.line).join('\r\n') + '\r\n');
console.log(JSON.stringify(Object.assign({ ok: true, out }, summary)));

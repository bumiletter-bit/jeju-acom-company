// #1039-B 나스 윈도우 VM(어사이드 전용 PC)용 .env 한 장 — 노트북 .env 에서 VM 이 꼭 쓰는 칸만 골라 새 파일로 쓴다.
//   쓰기:   node scripts/vm/make-vm-env.js --out <USB 또는 빈 폴더>\.env      (있으면 멈춤 · --force 로 덮음)
//   확인:   node scripts/vm/make-vm-env.js --check <파일>                     (칸 이름만 찍음 · 값 0)
//   미리:   node scripts/vm/make-vm-env.js                                    (= --dry · 골라질 칸 이름·빠질 칸 수만)
// 🔴 값은 어디에도 찍지 않는다(칸 이름·「있음/빈 칸」만).
// VM 이 쓰는 칸 = 실코드 근거:
//   DATABASE_URL   = 꼭 필요 · 키워드 순위(scripts/desk/keyword-rank.js → _db.js 의 pg Pool · keyword_rank 설정 읽기 · keyword_rankings·keyword_rank_last·audit 쓰기)
//   EXP_AUTO_API   = #1040 체험 예약 번호 자동(scripts/vm/exp-phone-auto.js)이 부르는 서버 주소 · VM 은 DB 를 직접 쓰지 않고 이 API 로 저장(설계서 docs/1039-exp-phone-auto.md 3절 (나))
//   EXP_AUTO_TOKEN = 그 API 전용 Bearer(DB 설정 experience_auto.token 과 같은 값 · 총괄이 줌)
//     두 칸 값 찾는 순서 = 노트북 .env 에 있으면 그 줄 → 없으면 이 명령을 돌린 창의 환경 변수(예: $env:EXP_AUTO_TOKEN='…' 뒤 실행 · 명령줄 인자로 받지 않음 = 기록에 안 남게)
//     → 둘 다 없으면 「KEY=」 빈 칸으로 쓰고 경고(키워드 순위는 돌고 체험 번호 자동만 못 돎 · VM 에서 나중에 채움).
//   그 밖 칸은 안 씀 — 텔레그램·알림 종은 렌더 서버가 보냄(VM 에 텔레그램 키 필요 없음).
//   🔴 ASIDE_EXE · KR_PAGE_WAIT_MS 는 keyword-rank.js 맨 위(50·51행)에서 .env 를 읽기 전에 정해진다 → .env 에 넣어도 효과 0 · 사용자 환경 변수로(setup-aside-vm.ps1 이 함).
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED = ['DATABASE_URL'];
const OPTIONAL = ['EXP_AUTO_API', 'EXP_AUTO_TOKEN'];   // 없으면 빈 칸 + 경고
const ALL = REQUIRED.concat(OPTIONAL);

function parse(text) {
    const out = [];
    for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
        const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
        if (m) out.push({ key: m[1], line: raw.trim(), empty: !m[2].trim() });
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
    const state = k => { const r = rows.filter(x => x.key === k).pop(); return !r ? '없음' : r.empty ? '빈 칸' : '있음'; };
    const missing = REQUIRED.filter(k => state(k) !== '있음');
    const exp = {}; for (const k of OPTIONAL) exp[k] = state(k);
    const expOk = OPTIONAL.every(k => exp[k] === '있음');
    const warn = expOk ? null : '체험 번호 자동 칸 ' + OPTIONAL.filter(k => exp[k] !== '있음').map(k => k + '(' + exp[k] + ')').join(',') + ' — 키워드 순위는 돌고 체험 번호 자동만 못 돎';
    console.log(JSON.stringify({ ok: !missing.length, exp_ok: expOk, file: f, keys, missing, exp, warn }));
    process.exit(missing.length ? 1 : 0);
}

const rows = parse(fs.readFileSync(src, 'utf8'));
const lines = [], from = {}, warns = [];
for (const k of ALL) {
    const r = rows.filter(x => x.key === k).pop();   // 같은 칸이 둘이면 마지막 것(dotenv parse 도 뒤 값이 이김) + 아래 경고
    if (r && !r.empty) { lines.push(r.line); from[k] = '.env'; continue; }
    if (OPTIONAL.includes(k)) {
        const v = process.env[k];
        if (v && String(v).trim() && !/[\r\n]/.test(v)) { lines.push(k + '=' + String(v).trim()); from[k] = '환경 변수'; }
        else { lines.push(k + '='); from[k] = '빈 칸'; warns.push(k + ' 값 없음 → 빈 칸으로 씀(총괄에게 받아 VM .env 에 채우기)'); }
    } else from[k] = '없음';
}
const dup = ALL.filter(k => rows.filter(r => r.key === k).length > 1);
const missing = REQUIRED.filter(k => from[k] !== '.env');
const out = val('--out');
const summary = { src, from, missing, dropped: rows.filter(r => !ALL.includes(r.key)).length, warn: warns.length ? warns : null, dup_warning: dup.length ? dup.join(',') + ' 가 두 번 — 확인 필요' : null };
if (!out) { console.log(JSON.stringify(Object.assign({ dry: true, 안내: '--out <파일> 로 쓰기' }, summary), null, 1)); process.exit(missing.length ? 1 : 0); }
if (missing.length) { console.log(JSON.stringify(Object.assign({ ok: false, error: '필요한 칸 없음' }, summary))); process.exit(1); }
if (fs.existsSync(out) && !args.includes('--force')) { console.log(JSON.stringify({ ok: false, error: '이미 있음 — 덮으려면 --force', out })); process.exit(1); }
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, '# #1039-B·#1040 나스 VM 어사이드 전용 · make-vm-env.js 가 만듦 ' + new Date().toISOString().slice(0, 10) + '\r\n' + lines.join('\r\n') + '\r\n');
console.log(JSON.stringify(Object.assign({ ok: true, out }, summary)));

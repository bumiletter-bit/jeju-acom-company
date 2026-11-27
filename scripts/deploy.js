// 배포 스크립트 (0단계) — 백업 없이는 배포 불가를 코드로 강제
// 사용법: npm run deploy
// 절차: ⓪직전 배포가 실서버에 반영됐는지(#1310) → ①커밋 안 된 변경 확인 → ②DB 백업 (실패 시 배포 중단) → ③버전 태그 → ④git push (Render 자동 배포) → ⑤실서버 반영 확인(#1310)
// #1310(대표 11/27 「이런 시행착오가 안 나오도록」): 11/27 v5.9.859 가 Render 기동에서 죽었는데(DB 초기화 시간 초과) 20분 넘게 몰랐다
//   → push 뒤 공개 버전 길(/api/public/version · 로그인 없음 · 버전 글자만)을 15초마다 최대 9분 읽어 새 버전이 떴는지 확인
//   → 다음 배포를 시작할 때 직전 배포(origin/main 의 version.js)가 실서버에 떠 있는지 먼저 확인 · 아니면 멈춤(연달아 배포로 겹치는 것 막기)
//   끄기 = DEPLOY_SKIP_LIVE_CHECK=1(시작 확인만 건너뜀 · 반영 확인은 늘 함) · 주소 = DEPLOY_LIVE_URL(기본 회사 Render 주소)
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE_URL = process.env.DEPLOY_LIVE_URL || 'https://jeju-acom-company.onrender.com';
const POLL_MS = 15000, POLL_MAX_MS = 9 * 60 * 1000;   // 9분 = 빌드·기동 2~3분 + 기동 DB 일시 오류 재시도(#1310 B 최대 약 3분 40초) · Bash 10분 상한 안

function run(cmd, opts = {}) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
}

// 실서버 버전 한 번 읽기 — { version } | { error }
async function liveVersion(fetchFn = fetch) {
    try {
        const r = await fetchFn(LIVE_URL + '/api/public/version?t=' + Date.now(), { signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        const j = await r.json();
        return j && typeof j.version === 'string' ? { version: j.version } : { error: '응답 꼴이 달라요' };
    } catch (e) { return { error: String((e && e.message) || e).slice(0, 120) }; }
}

// push 뒤: want 가 뜰 때까지 폴링 — { ok, version, tries, last }
async function waitLive(want, { fetchFn = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), pollMs = POLL_MS, maxMs = POLL_MAX_MS, log = console.log } = {}) {
    const n = Math.max(1, Math.floor(maxMs / pollMs));
    let last = null;
    for (let i = 1; i <= n; i++) {
        await sleep(pollMs);
        last = await liveVersion(fetchFn);
        if (last.version === want) return { ok: true, version: last.version, tries: i };
        log(`   … ${i}/${n} 실서버 = ${last.version || '읽기 실패(' + last.error + ')'} (기다리는 버전 ${want})`);
    }
    return { ok: false, version: last && last.version, error: last && last.error, tries: n };
}

// 시작 때: 직전 배포(origin/main 의 version.js)가 실서버에 떠 있는가 — { ok, prev, live, error }
async function checkPrevLive(prev, fetchFn = fetch) {
    const lv = await liveVersion(fetchFn);
    if (lv.error) return { ok: false, prev, live: null, error: lv.error };
    return { ok: lv.version === prev, prev, live: lv.version };
}

function prevDeployedVersion() {
    try { run('git fetch origin main --quiet', { quiet: true }); } catch (_) { /* 못 받아도 아는 origin/main 으로 */ }
    const src = run('git show origin/main:version.js', { quiet: true });
    const m = src.match(/VERSION:\s*'([^']+)'/);
    return m ? m[1] : null;
}

function bigWarn(lines) {
    const bar = '🔴'.repeat(20);
    console.error('\n' + bar);
    lines.forEach(l => console.error('🔴 ' + l));
    console.error(bar + '\n');
}

async function main() {
    const { VERSION } = require('../version.js');
    console.log(`\n🚀 배포 시작 — 버전: ${VERSION}\n`);

    // ⓪ 직전 배포가 실서버에 반영됐는지(#1310)
    if (process.env.DEPLOY_SKIP_LIVE_CHECK === '1') console.log('⓪ 직전 배포 반영 확인 건너뜀(DEPLOY_SKIP_LIVE_CHECK=1)');
    else {
        const prev = prevDeployedVersion();
        const c = prev ? await checkPrevLive(prev) : { ok: false, error: 'origin/main 의 version.js 를 못 읽음' };
        if (!c.ok) {
            bigWarn([c.error ? `실서버 버전을 못 읽었어요(${c.error})` : `직전 배포 ${prev} 가 실서버에 아직 없어요(지금 실서버 = ${c.live})`,
                'Render 대시보드 Deploys 에서 직전 배포가 성공했는지 먼저 확인하세요(실패면 원인부터)',
                '확인 뒤에도 그대로 배포하려면: DEPLOY_SKIP_LIVE_CHECK=1 npm run deploy']);
            process.exit(1);
        }
        console.log(`⓪ 직전 배포 실서버 반영 확인: ${c.live}`);
    }

    // ① 커밋 안 된 변경이 있으면 중단 (배포 = 커밋된 상태만)
    const dirty = execSync('git status --porcelain -uno', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (dirty) {
        console.error('❌ 커밋되지 않은 변경이 있습니다. 먼저 커밋하세요:\n' + dirty);
        process.exit(1);
    }

    // ② DB 백업 — 실패하면 여기서 즉시 중단 (execSync가 throw)
    console.log('① DB 백업 실행...');
    run(`node "${path.join(__dirname, 'db-backup.js')}" ${VERSION}`);

    // ③ 버전 태그 (-dev 버전은 태그 생략, 정식 버전만)
    if (!VERSION.includes('-dev')) {
        const tags = execSync('git tag', { cwd: ROOT, encoding: 'utf8' });
        if (!tags.split('\n').includes(VERSION)) {
            console.log(`② 버전 태그 생성: ${VERSION}`);
            run(`git tag -a ${VERSION} -m "release ${VERSION}"`);
            run(`git push origin ${VERSION}`);
        } else {
            console.log(`② 태그 ${VERSION} 이미 존재 — 생략`);
        }
    } else {
        console.log('② -dev 버전이므로 태그 생략');
    }

    // ④ push → Render 자동 배포
    console.log('③ GitHub push (Render 자동 배포)...');
    run('git push origin main');
    console.log(`\n✅ push 완료: ${VERSION}`);

    // ⑤ 실서버 반영 확인(#1310) — 안 되면 exit 1 이 아니라 큰 경고(push 는 이미 끝남)
    console.log(`④ 실서버 반영 확인 — ${LIVE_URL}/api/public/version 을 15초마다 최대 9분`);
    const w = await waitLive(VERSION);
    if (w.ok) console.log(`\n✅ 실서버 반영 확인 ${w.version} (${w.tries * POLL_MS / 1000}초 안)`);
    else bigWarn([`Render 반영 안 됨 — 대시보드 Deploys 확인(9분 동안 실서버 = ${w.version || '읽기 실패 ' + (w.error || '')})`,
        '기동 실패(DB 초기화 시간 초과 등)면 Render 로그를 보고 원인을 고친 뒤 다시 배포 · 손님 화면은 직전 버전 그대로일 수 있어요']);
    console.log('   ⚠️ CHANGELOG.md 갱신 여부를 확인하세요.');
}

if (require.main === module) {
    main().catch(err => {
        console.error('\n❌ 배포 중단:', err.message);
        console.error('   백업 실패 또는 push 실패 — 원인 해결 전까지 배포되지 않습니다.');
        process.exit(1);
    });
}
module.exports = { liveVersion, waitLive, checkPrevLive };

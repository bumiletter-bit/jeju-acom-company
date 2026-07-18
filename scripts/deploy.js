// 배포 스크립트 (0단계) — 백업 없이는 배포 불가를 코드로 강제
// 사용법: npm run deploy
// 절차: ①커밋 안 된 변경 확인 → ②DB 백업 (실패 시 배포 중단) → ③버전 태그 → ④git push (Render 자동 배포)
const { execSync } = require('child_process');
const path = require('path');
const { VERSION } = require('../version.js');

function run(cmd, opts = {}) {
    return execSync(cmd, { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', ...opts });
}

try {
    console.log(`\n🚀 배포 시작 — 버전: ${VERSION}\n`);

    // ① 커밋 안 된 변경이 있으면 중단 (배포 = 커밋된 상태만)
    const dirty = execSync('git status --porcelain -uno', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
    if (dirty) {
        console.error('❌ 커밋되지 않은 변경이 있습니다. 먼저 커밋하세요:\n' + dirty);
        process.exit(1);
    }

    // ② DB 백업 — 실패하면 여기서 즉시 중단 (execSync가 throw)
    console.log('① DB 백업 실행...');
    run(`node "${path.join(__dirname, 'db-backup.js')}" ${VERSION}`);

    // ③ 버전 태그 (-dev 버전은 태그 생략, 정식 버전만)
    if (!VERSION.includes('-dev')) {
        const tags = execSync('git tag', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
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

    console.log(`\n✅ 배포 완료: ${VERSION}`);
    console.log('   ⚠️ CHANGELOG.md 갱신 여부를 확인하세요. Render 대시보드에서 배포 성공도 확인하세요.');
} catch (err) {
    console.error('\n❌ 배포 중단:', err.message);
    console.error('   백업 실패 또는 push 실패 — 원인 해결 전까지 배포되지 않습니다.');
    process.exit(1);
}

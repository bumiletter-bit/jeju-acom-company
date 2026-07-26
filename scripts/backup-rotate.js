// 백업 보존 로테이션 (대표 승인 정책 2026-07-26)
//   유지: ①최근 30일 파일 전부 ②30일 이전은 "주당 1개"(그 주의 가장 최신 파일)만
//   사용: node scripts/backup-rotate.js          → 삭제 '예정' 목록만 출력 (아무것도 안 지움)
//         node scripts/backup-rotate.js --yes    → 실제 삭제
const fs = require('fs');
const path = require('path');

const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '제주아꼼이네_DB백업');
const KEEP_DAYS = 30;

function isoWeekKey(d) {
    // ISO 주차 (연도-주번호) — 같은 주의 파일끼리 묶는 용도
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function main() {
    const confirmed = process.argv.includes('--yes');
    if (!fs.existsSync(dir)) { console.error('백업 폴더가 없습니다: ' + dir); process.exit(1); }
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const files = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.sql'))
        .map(f => { const st = fs.statSync(path.join(dir, f)); return { f, mtime: st.mtimeMs, size: st.size }; })
        .sort((a, b) => a.mtime - b.mtime);

    const recent = files.filter(x => x.mtime >= cutoff);
    const old = files.filter(x => x.mtime < cutoff);
    // 30일 이전: 주 단위로 묶어 가장 최신 1개만 유지
    const byWeek = new Map();
    for (const x of old) {
        const k = isoWeekKey(new Date(x.mtime));
        if (!byWeek.has(k) || byWeek.get(k).mtime < x.mtime) byWeek.set(k, x);
    }
    const keepOld = new Set([...byWeek.values()].map(x => x.f));
    const toDelete = old.filter(x => !keepOld.has(x.f));

    const mb = n => (n / 1048576).toFixed(1) + 'MB';
    console.log(`백업 폴더: ${dir}`);
    console.log(`전체 ${files.length}개 / 최근 ${KEEP_DAYS}일 유지 ${recent.length}개 / 30일 이전 주별 대표 유지 ${keepOld.size}개`);
    console.log(`삭제 ${confirmed ? '실행' : '예정'} ${toDelete.length}개 (${mb(toDelete.reduce((s, x) => s + x.size, 0))}):`);
    for (const x of toDelete) console.log(`  - ${x.f} (${new Date(x.mtime).toISOString().slice(0, 10)}, ${mb(x.size)})`);
    if (!toDelete.length) { console.log('  (삭제할 파일 없음)'); return; }
    if (!confirmed) { console.log('\n실제 삭제하려면: node scripts/backup-rotate.js --yes'); return; }
    let freed = 0;
    for (const x of toDelete) { fs.unlinkSync(path.join(dir, x.f)); freed += x.size; }
    console.log(`\n✅ ${toDelete.length}개 삭제 완료 — ${mb(freed)} 확보`);
}
main();

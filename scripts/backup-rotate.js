// 백업 보존 로테이션 — B(절충) 정책 (대표 확정 2026-07-26)
//   유지: ①오늘 파일 전부 (당일 배포별 복원점 유지)
//         ②어제 ~ 30일 이내: 하루당 1개(그날 가장 최신)
//         ③30일 이전: 주당 1개(그 주 가장 최신)
//   안전장치: 삭제 전에 "하루 정책 구간의 모든 날짜에 최소 1개 잔존"을 검증 — 위반 시 아무것도 삭제하지 않음
//   사용: node scripts/backup-rotate.js          → 삭제 '예정' 목록만 출력
//         node scripts/backup-rotate.js --yes    → 실제 삭제
const fs = require('fs');
const path = require('path');

const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', '제주아꼼이네_DB백업');
const KEEP_DAYS = 30;

function dayKey(ms) { // 로컬(KST PC) 기준 날짜
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoWeekKey(ms) {
    const d = new Date(ms);
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
    const files = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.sql'))
        .map(f => { const st = fs.statSync(path.join(dir, f)); return { f, m: st.mtimeMs, s: st.size }; });
    const todayK = dayKey(Date.now());
    const cutoff = Date.now() - KEEP_DAYS * 86400000;

    const keep = new Set();
    const dayBest = new Map(), weekBest = new Map();
    for (const x of files) {
        if (dayKey(x.m) === todayK) { keep.add(x.f); continue; }          // ① 오늘 전부
        if (x.m >= cutoff) {                                               // ② 하루 1개
            const k = dayKey(x.m);
            if (!dayBest.has(k) || dayBest.get(k).m < x.m) dayBest.set(k, x);
        } else {                                                           // ③ 주 1개
            const k = isoWeekKey(x.m);
            if (!weekBest.has(k) || weekBest.get(k).m < x.m) weekBest.set(k, x);
        }
    }
    for (const x of dayBest.values()) keep.add(x.f);
    for (const x of weekBest.values()) keep.add(x.f);
    const toDelete = files.filter(x => !keep.has(x.f));

    // 🛡️ 안전검증: 하루 정책 구간(오늘 포함 최근 30일)의 모든 날짜에 최소 1개 잔존해야 함
    const daysAll = new Set(files.filter(x => x.m >= cutoff).map(x => dayKey(x.m)));
    const daysKept = new Set(files.filter(x => keep.has(x.f) && x.m >= cutoff).map(x => dayKey(x.m)));
    const missing = [...daysAll].filter(d => !daysKept.has(d));
    // 주 정책 구간도 검증: 모든 주에 최소 1개 잔존
    const weeksAll = new Set(files.filter(x => x.m < cutoff).map(x => isoWeekKey(x.m)));
    const weeksKept = new Set(files.filter(x => keep.has(x.f) && x.m < cutoff).map(x => isoWeekKey(x.m)));
    const missingW = [...weeksAll].filter(w => !weeksKept.has(w));

    const mb = n => (n / 1048576).toFixed(1) + 'MB';
    console.log(`백업 폴더: ${dir}`);
    console.log(`전체 ${files.length}개 / 유지 ${keep.size}개 / 삭제 ${confirmed ? '실행' : '예정'} ${toDelete.length}개 (${mb(toDelete.reduce((s, x) => s + x.s, 0))})`);
    console.log(`안전검증 — 날짜 커버: ${missing.length === 0 ? '✅ 모든 날짜 최소 1개 잔존' : '❌ 누락: ' + missing.join(', ')}`
        + ` / 주 커버: ${missingW.length === 0 ? '✅' : '❌ 누락: ' + missingW.join(', ')}`);
    if (missing.length || missingW.length) { console.error('🛑 안전검증 실패 — 삭제하지 않고 종료합니다'); process.exit(1); }
    for (const x of toDelete) console.log(`  - ${x.f} (${dayKey(x.m)}, ${mb(x.s)})`);
    if (!toDelete.length) { console.log('  (삭제할 파일 없음)'); return; }
    if (!confirmed) { console.log('\n실제 삭제하려면: node scripts/backup-rotate.js --yes'); return; }
    let freed = 0;
    for (const x of toDelete) { fs.unlinkSync(path.join(dir, x.f)); freed += x.s; }
    console.log(`\n✅ ${toDelete.length}개 삭제 완료 — ${mb(freed)} 확보`);
    // 결과 요약: 날짜별 남은 파일 수
    const remain = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.sql'))
        .map(f => dayKey(fs.statSync(path.join(dir, f)).mtimeMs));
    const byDay = {};
    remain.forEach(d => { byDay[d] = (byDay[d] || 0) + 1; });
    console.log('날짜별 잔존: ' + Object.keys(byDay).sort().map(d => `${d}=${byDay[d]}개`).join(' · '));
}
main();

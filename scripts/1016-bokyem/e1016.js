// #1016-B 자사몰(skin6) 보겸TV 쇼츠 배너 블록 끼우기 — mall-sync 안 씀 · 스킨 정본의 상품 칸 3개에 블록만 끼움 · 기본 dry · --apply
//   node e1016.js [--banner <네이버에 올린 배너 주소>] [--only 7673020911,6400134206,11126666859] [--apply]
//   dry = 서버 원본 == 로컬 정본 확인 → 칸마다 끼울 자리·전후 블록 수 출력 → next 파일만 씀(올리기 0)
//   apply = 백업(index_pre1016_backup.html · 이미 있으면 멈춤) → 서버에 올림 → 다시 받아 같은지(다르면 멈춤) → 로컬 정본 덮음 → audit skin_upload · 되돌리기 = 백업 파일 그대로 다시 올림(mall-sync rollback 아님)
//   🔴 체험(7673020911) 상세는 mall-sync 금지(#993 · 플레이스 예약 버튼 등 자사몰 예외) — 이 스크립트처럼 칸 안 블록만 손댐
const ROOT = 'C:/Users/전승범/OneDrive/문서/★제주아꼼이네 회사프로그램'; process.chdir(ROOT);
const fs = require('fs'), path = require('path'), M = require(ROOT + '/scripts/desk/_mall.js');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const BANNER = arg('--banner') || 'https://shop-phinf.pstatic.net/__BANNER_1016_PLACEHOLDER__.png';
if (APPLY && !/^https:\/\/shop-phinf\.pstatic\.net\/(?!__BANNER)/.test(BANNER)) { console.log('오류: --apply 는 네이버에 올린 배너 주소(--banner https://shop-phinf.pstatic.net/…)가 있어야 해요'); process.exit(1); }
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/·/g, '&middot;');
// 글 블록 = 체험 칸 「체험 리뷰 798」 블록과 같은 꼴(가운데 · 굵게 · 19/16px)
const textX = lines => ({ t: 'x', html: lines.map(([t, fs, c]) => `<p style="text-align:center"><span style="font-size:${fs}px;color:${c}"><b>${esc(t)}</b></span></p>`).join('\n') });
const IMG = () => ({ t: 'i', src: BANNER });
// --yt-button = 대표가 유튜브 링크를 고르면(A안) 배너 밑에 자사몰 전용 HTML 버튼(#802 data-btn802 · 지도 버튼과 같은 꼴 · 새 창) — 스킨 그림 링크는 상품 번호(lk)만 살아서
const YT = 'https://youtube.com/shorts/eo9sIblSUlY';
const YTB = () => process.argv.includes('--yt-button') ? [{ t: 'x', html: `<p style="text-align:center;margin:6px 0"><a href="${YT}" target="_blank" rel="noopener" data-btn802="1" style="display:inline-block;background:#ff7a00;color:#fff;font-weight:800;text-decoration:none;border-radius:12px;font-size:16px;padding:12px 30px">▶ 보겸TV 쇼츠 영상 보기</a></p>` }] : [];
const PLAN = {
    '7673020911': { name: '체험', after: b => b.t === 'i' && String(b.src || '').includes('17936030839998NEA9'),   // 네이버 블록 10(라운지 18,000원 그림) 과 같은 그림 · 다음 = 「인생샷」 제목 그림
        add: [textX([['📺 보겸TV 쇼츠에 나온 귤 농장', 19, '#222222']]), IMG(), ...YTB(),
              textX([['영상 속 간판 그대로,', 16, '#222222'], ['아꼼이네 귤 농장에서 기다릴게요 :)', 16, '#222222']])] },
    '6400134206': { name: '감귤', after: b => b.t === 'x' && String(b.html || '').includes('네이버 지도에서 체험장 위치 보기'),   // 체험 묶음 끝(지도 버튼) · 다음 = 타이벡 밭 그림
        add: [textX([['📺 보겸TV 쇼츠에 나온 귤 농장', 19, '#222222']]), IMG(), ...YTB()] },
    '11126666859': { name: '황금향(선택)', after: b => b.t === 'i' && b.lk === '5531798664',   // 「다른 상품」 레몬 배너 뒤 · 다음 = 「황금향 출하기간」
        add: [textX([['📺 보겸TV 쇼츠에 나온 귤 농장', 19, '#222222']]), IMG(), ...YTB()] },
};
const ONLY = (arg('--only') || Object.keys(PLAN).join(',')).split(',').map(x => x.trim()).filter(Boolean);
function slot(s, NO) {
    const key = `"${NO}":{"count"`, a = s.indexOf(key); if (a < 0 || s.indexOf(key, a + 5) >= 0) throw new Error(NO + ' 칸 자리 없음·여럿');
    let i = s.indexOf('{', a), d = 0, q = false, e = i; const BS = String.fromCharCode(92);
    for (; e < s.length; e++) { const c = s[e]; if (q) { if (c === BS) e++; else if (c === '"') q = false; } else if (c === '"') q = true; else if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
    return { i, e, j: JSON.parse(s.slice(i, e + 1)) };
}
(async () => {
    const srv = await M.serverGet(), loc = M.readLocal();
    if (M.sha(srv) !== M.sha(loc)) throw new Error('서버 ≠ 로컬 — 멈춤(다른 세션이 올렸을 수 있음 · scripts/download.js 로 받은 뒤 다시)');
    let s = loc.toString('utf8'); const log = [];
    for (const NO of ONLY) {
        const P = PLAN[NO]; if (!P) throw new Error('모르는 상품 ' + NO);
        const r = slot(s, NO), bl = r.j.blocks;
        if (JSON.stringify(bl).includes('보겸')) throw new Error(`${NO} 이미 보겸 블록이 있음 — 두 번 넣지 않음`);
        const hits = bl.map((b, k) => P.after(b) ? k : -1).filter(k => k >= 0);
        if (hits.length !== 1) throw new Error(`${NO} 기준 블록 ${hits.length}개(1개여야 함)`);
        const k = hits[0], out = bl.slice(0, k + 1).concat(JSON.parse(JSON.stringify(P.add)), bl.slice(k + 1));
        // imgs 는 네이버 스냅샷 값(블록에서 바뀐 그림도 남아 있음) — 다시 계산하지 않고 배너만 덧붙임(감귤 51 → 48 로 줄던 것 막음)
        const imgs = r.j.imgs.includes(BANNER) ? r.j.imgs.slice() : r.j.imgs.concat([BANNER]);
        const next = Object.assign({}, r.j, { count: imgs.length, imgs, blocks: out });
        const T = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
        const nb = b => b ? (b.t === 'x' ? 'x「' + T(b.html) + '」' : b.t + (b.lk ? ' lk' + b.lk : '') + ' ' + String(b.src || (b.srcs || [])[0] || '').split('/').pop().slice(0, 30)) : '(끝)';
        log.push(`${NO} ${P.name}: 블록 ${bl.length} → ${out.length} · 그림 ${r.j.imgs.length} → ${imgs.length} · #${k} 뒤에 ${P.add.length}개 · 앞 ${nb(bl[k])} · 뒤 ${nb(bl[k + 1])}`);
        s = s.slice(0, r.i) + JSON.stringify(next) + s.slice(r.e + 1);
        fs.writeFileSync(path.join(require('os').tmpdir(), `e1016-next-${NO}.json`), JSON.stringify(next, null, 1));
    }
    log.forEach(x => console.log(x));
    console.log('배너 주소', BANNER, '| 크기', Buffer.byteLength(loc), '→', Buffer.byteLength(s), '| 전 해시', M.sha(loc).slice(0, 12));
    if (!APPLY) { console.log('dry 끝 — 올린 것 없음'); process.exit(0); }
    const bk = M.backupTo('1016'), buf = Buffer.from(s, 'utf8'), r = await M.serverPut(buf);   // 백업 = index_pre1016_backup.html(_mall.js backupTo 꼴)
    if (!r || !r.same) throw new Error('올린 뒤 서버 파일이 보낸 것과 달라요(' + JSON.stringify(r) + ') — 로컬 정본은 안 덮음 · 백업 ' + bk + ' 로 되돌릴지 총괄에게');
    fs.writeFileSync(M.FILE, buf);
    await M.audit('skin_upload', 'cafe24_skin', 'skin6', { tool: '#1016 보겸TV 쇼츠 배너 블록', only: ONLY, banner: BANNER, log }, '#1016');
    console.log('올림', JSON.stringify(r), '후', M.sha(buf).slice(0, 12), '백업', String(bk)); process.exit(0);
})().catch(x => { console.log('오류', x.message); process.exit(1); });

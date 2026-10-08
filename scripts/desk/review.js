// #592 네이버 리뷰 읽기(창구 도구 · 읽기 전용) — 사용:
//   node scripts/desk/review.js list [--product <번호|이름 조각>] [--days 30] [--low] [--limit 50]
//   node scripts/desk/review.js summary [--days 30] [--product <번호|이름 조각>]
//   네이버 커머스API에는 리뷰 API가 없다(공식 답변 2026-09-14) → 매일 새벽 상품 스냅샷(naver_product_snapshot.reviews)에 쌓이는
//   「상품당 상위 20건(랭킹순)」만 읽는다. 전체 리뷰가 아니다 — 결과의 note 를 답 첫 줄에 밝힐 것. 네이버·중계 호출 0 · 쓰기 0.
const { pool } = require('./_db');
const NOTE = '상품당 상위 20건(랭킹순) 스냅샷 — 전체가 아님';
const args = process.argv.slice(2); const cmd = args[0]; const opt = {};
for (let i = 1; i < args.length; i++) {
    if (args[i] === '--product') opt.product = String(args[++i] || '').trim();
    else if (args[i] === '--days') opt.days = parseInt(args[++i]);
    else if (args[i] === '--limit') opt.limit = parseInt(args[++i]);
    else if (args[i] === '--low') opt.low = true;
}
const out = (o, code) => { console.log(JSON.stringify(o, null, 1)); return pool.end().then(() => process.exit(code || 0)); };
// 불만 낱말표(규칙 기반 · 별점 3 이하 리뷰에만 댄다 — 높은 별점의 「배송 빨라요」를 불만으로 세지 않게)
const COMPLAINT = [
    ['파손·터짐', /깨[져졌지진]|터[져졌지진]|파손|으깨|뭉개|눌[려렸린]|찌그러/],
    ['상함·곰팡이', /상[한했해]|썩[은었어]|곰팡|물러|무르|무른|짓무|시들|말라|마른|수분.{0,4}빠/],
    ['크기·사이즈', /크기|사이즈|작[아은았]|[잘자]잘|알이|너무\s*[커큰]/],
    ['맛·당도', /맛\s*없|맛이\s*없|싱겁|밍밍|시[어었]|신맛|[셔셨]|당도|안\s*달|달지\s*않|떫/],
    ['배송 지연', /늦[게어었]|지연|오래\s*걸|안\s*[와오왔]|배송.{0,6}(느|늦)/],
    ['수량·구성', /개수|갯수|수량|모자[라랐]|부족|덜\s*[왔들]|빠[져졌]/],
    ['가격', /비싸|비싼|가격.{0,6}(대비|비해|아깝)|돈\s*아깝/],
    ['응대·교환', /환불|교환|반품|문의|답변|연락|응대|고객센터/],
];
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

(async () => {
    if (cmd !== 'list' && cmd !== 'summary') return out({ ok: false, error: '사용: review.js list [--product <번호|이름 조각>] [--days 30] [--low] [--limit 50] | review.js summary [--days 30]' }, 1);
    if (opt.days != null && !(opt.days > 0)) return out({ ok: false, error: '--days 는 1 이상의 숫자' }, 1);
    const q = await pool.query(`SELECT id, to_char(run_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at, items, reviews
        FROM naver_product_snapshot WHERE reviews IS NOT NULL AND jsonb_typeof(reviews) = 'object' ORDER BY id DESC LIMIT 1`);
    if (!q.rows.length) return out({ ok: false, error: '리뷰가 담긴 스냅샷이 없습니다(새벽 수집 실패 가능) — 총괄에 알려 주세요' }, 2);
    const snap = q.rows[0]; const names = {};
    (Array.isArray(snap.items) ? snap.items : []).forEach(it => { if (it && it.no) names[String(it.no)] = String(it.name || ''); });
    // 상품 거르기: 숫자뿐이면 상품번호 일치 · 아니면 상품 이름에 낱말(띄어쓰기로 나눔)이 전부 든 것
    let nos = Object.keys(snap.reviews);
    if (opt.product) {
        const p = opt.product;
        if (/^\d+$/.test(p)) nos = nos.filter(no => no === p);
        else { const ws = p.toLowerCase().split(/\s+/).filter(Boolean); nos = nos.filter(no => ws.every(w => (names[no] || '').toLowerCase().includes(w))); }
        if (!nos.length) return out({ ok: false, error: `「${p}」에 맞는 상품이 스냅샷에 없습니다`, products: Object.keys(snap.reviews).map(no => ({ product_no: no, product: names[no] || '(이름 없음)' })) }, 3);
    }
    const since = opt.days ? daysAgo(opt.days) : null;
    let rows = [];
    for (const no of nos) for (const r of (Array.isArray(snap.reviews[no]) ? snap.reviews[no] : [])) {
        const date = String(r.date || '').slice(0, 10);
        if (since && !(date >= since)) continue;
        rows.push({ product: names[no] || '(이름 없음)', product_no: no, score: Number(r.score) || null, date, writer: r.writer || null, opt: r.opt || '', text: String(r.text || ''), labels: r.labels || [] });
    }
    const base = { ok: true, snapshot_at: snap.at, snapshot_id: snap.id, note: NOTE, today: kstToday(), days: opt.days || null, since };
    const tagOf = t => COMPLAINT.filter(([, re]) => re.test(t)).map(([k]) => k);

    if (cmd === 'list') {
        if (opt.low) rows = rows.filter(r => r.score != null && r.score <= 3);
        rows.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || (a.score || 9) - (b.score || 9));
        const by_score = {}; rows.forEach(r => { const k = String(r.score == null ? '?' : r.score); by_score[k] = (by_score[k] || 0) + 1; });
        const limit = opt.limit > 0 ? opt.limit : 50;
        const items = rows.slice(0, limit).map(r => Object.assign({}, r, r.score != null && r.score <= 3 ? { complaints: tagOf(r.text) } : {}));
        return out(Object.assign(base, { low: !!opt.low, total: rows.length, shown: items.length, by_score, items }));
    }
    // summary — 상품별 건수·평균·3점 이하·불만 낱말
    const byP = {}; const allC = {};
    for (const r of rows) {
        const g = byP[r.product_no] || (byP[r.product_no] = { product: r.product, product_no: r.product_no, count: 0, sum: 0, scored: 0, low: 0, latest: '', oldest: '', complaints: {} });
        g.count++; if (r.score != null) { g.sum += r.score; g.scored++; }
        if (r.date && (!g.latest || r.date > g.latest)) g.latest = r.date;
        if (r.date && (!g.oldest || r.date < g.oldest)) g.oldest = r.date;
        if (r.score != null && r.score <= 3) { g.low++; for (const k of tagOf(r.text)) { g.complaints[k] = (g.complaints[k] || 0) + 1; allC[k] = (allC[k] || 0) + 1; } }
    }
    const products = Object.values(byP).map(g => ({ product: g.product, product_no: g.product_no, count: g.count, avg: g.scored ? Math.round(g.sum / g.scored * 100) / 100 : null, low: g.low, latest: g.latest, oldest: g.oldest, complaints: g.complaints }))
        .sort((a, b) => b.low - a.low || b.count - a.count);
    const scored = rows.filter(r => r.score != null);
    return out(Object.assign(base, {
        total: rows.length, avg: scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length * 100) / 100 : null,
        low_total: rows.filter(r => r.score != null && r.score <= 3).length, complaints: allC,
        complaint_note: '불만 낱말은 별점 3 이하 리뷰 글에서만 센 것(낱말표 기준 · 한 리뷰가 여러 갈래에 들 수 있음)', products,
    }));
})().catch(e => out({ ok: false, error: String(e.message || e).slice(0, 300) }, 9));

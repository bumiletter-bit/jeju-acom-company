// #497(대표 10/1 「에이전트오피스도 중간발주 이 라임으로 나오도록 이미지 해줘」) — 창구용 중간발주 PNG
//   회사프로그램 [중간발주 → 선택분 이미지 저장]과 같은 모양의 표를 거래처별 PNG로 만든다.
//   사용: node scripts/desk/qty-image.js [--days 50] [--out <폴더>] [--no-run <결과json>]
//     · 러너 invoice_qty_request(#461 · 읽기 전용 · 실서버가 60초 주기로 집음 · 최대 420초 대기) → 결과 groups 집계
//     · --no-run <json> = 저장된 러너 결과로 렌더만(검증용 · DB 쓰기 0)
//   매칭·색 = 회사프로그램 실코드 그대로: public/app.js 「품목명 카탈로그 ~ addSizeSuffix」·「qtyCategory」 구간을 실행 시점에 떼어 실행(복사 금지)
//   집계 = 중간발주 화면과 동일(개별발송 포함 · 이름 localeCompare ko) · 주문 0 품목은 표에 안 넣음(대표 확정) · [미매칭]은 별도 PNG
//   출력 = ★에이전트오피스/받은파일/중간발주_{거래처}_{MMDD}.png (+ 미매칭 PNG) · stdout 마지막 줄 = JSON 한 줄
//   🔴 배포 직후 5~10분은 러너가 타임아웃될 수 있음(구인스턴스) · DB 쓰기는 invoice_qty_request/result 키만
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const DAYS = Math.max(1, Math.min(180, parseInt(arg('--days', '50'), 10) || 50));
const OUT = path.resolve(arg('--out', path.join(ROOT, '★에이전트오피스', '받은파일')));
const NO_RUN = arg('--no-run', null);
const CAT_BG = { yellow: '#FFFF00', orange: '#F4B183', blue: '#BDD7EE', green: '#C6E0B4', pink: '#F4CCCC', none: '#fff' };   // styles.css .qty-cat-* 그대로(#502 pink 추가)

// ── 회사프로그램 실코드 추출(verify-406-match.js buildMatcher와 같은 방식)
function buildMatcher() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    const a = src.indexOf('// 품목명 카탈로그'), b = src.indexOf('function addSizeSuffix');
    const c = src.indexOf('function qtyCategory'), d = src.indexOf('function arrayBufferToBase64');
    if (a < 0 || b <= a || c < 0 || d <= c) throw new Error('app.js 추출 경계를 못 찾음(품목명 카탈로그/addSizeSuffix/qtyCategory/arrayBufferToBase64)');
    const chunk = src.slice(a, b) + '\n' + src.slice(c, d);
    return new Function(chunk + '\nreturn { matchProduct, qtyCategory, setPricing: (names, byPartner) => { aoInvoicePricingNames = names; aoInvoicePricingByPartner = byPartner; } };')();
}
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstStr = d => d.toISOString().slice(0, 16).replace('T', ' ');
const mmdd = d => String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function runRunner(pool) {
    await pool.query(`DELETE FROM agent_office_config WHERE key='invoice_qty_result'`);
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('invoice_qty_request', $1::jsonb)
                      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ days: DAYS, size_rows: true })]);   // #502 사이즈 요청 행 분리
    const t0 = Date.now();
    while (Date.now() - t0 < 420000) {
        await new Promise(r => setTimeout(r, 6000));
        const q = await pool.query(`SELECT value FROM agent_office_config WHERE key='invoice_qty_result'`);
        if (q.rows.length) { await pool.query(`DELETE FROM agent_office_config WHERE key='invoice_qty_result'`); return q.rows[0].value; }
    }
    throw new Error('러너 타임아웃(420초) — 배포 직후면 5~10분 뒤 다시');
}

// 표 HTML — styles.css #invoice-qty-capture 규칙을 인라인으로 옮김(제목·머리글 없음 · 프로그램 이미지와 동일)
function tableHtml(rows, total, opt) {
    const style = `<style>
      body{margin:0;background:#fff}
      #invoice-qty-capture{display:inline-block;background:#fff;padding:0;font-family:'Malgun Gothic','맑은 고딕',sans-serif}
      #invoice-qty-capture table{border-collapse:collapse}
      #invoice-qty-capture td{border:1px solid #000;padding:6px 10px;font-size:15px}
      #invoice-qty-capture td.cap-name{text-align:left}
      #invoice-qty-capture td.cap-num{text-align:right;font-weight:800;min-width:50px}
      #invoice-qty-capture tr.cap-total td{font-weight:800}
      ${Object.entries(CAT_BG).map(([k, v]) => `.qty-cat-${k}{background:${v}}`).join('')}
      .cap-unmatched{color:#c0392b}
    </style>`;
    const body = rows.map(r => `<tr><td class="cap-name qty-cat-${r.cat}${opt && opt.unmatched ? ' cap-unmatched' : ''}">${esc(r.name)}</td><td class="cap-num">${r.qty}</td></tr>`).join('')
        + `<tr class="cap-total"><td class="cap-name qty-cat-yellow"></td><td class="cap-num qty-cat-yellow">${total}</td></tr>`;
    return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><div id="invoice-qty-capture"><table><tbody>${body}</tbody></table></div></body></html>`;
}

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    // ① 오늘 유효 단가표(품목명 + 거래처) — verify-406의 SQL + partner
    const pr = (await pool.query(`SELECT DISTINCT p.partner, it->>'name' AS nm FROM pricing p, jsonb_array_elements(p.items) it
        WHERE p.start_date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND p.end_date >= (now() AT TIME ZONE 'Asia/Seoul')::date ORDER BY p.partner, nm`)).rows;
    const names = [...new Set(pr.map(r => r.nm).filter(Boolean))];
    const byPartner = {}; pr.forEach(r => { if (!r.nm) return; (byPartner[r.partner] = byPartner[r.partner] || new Set()).add(r.nm); });
    const partnerOf = nm => { const base = String(nm).replace(/\s+(2S|S|M)사이즈로!$/, ''); return Object.keys(byPartner).find(p => byPartner[p].has(base)) || null; };
    // ② 러너
    let res;
    if (NO_RUN) res = JSON.parse(fs.readFileSync(NO_RUN, 'utf8'));
    else res = await runRunner(pool);
    await pool.end();
    if (!res || res.error) throw new Error('러너 오류: ' + (res && res.error));
    const groups = Array.isArray(res.groups) ? res.groups : [];
    // ③ 매칭·집계(중간발주 화면 recomputeQtyAggregate와 동일 · 개별발송 포함)
    const M = buildMatcher(); M.setPricing(names, byPartner);
    const map = new Map(), unmatched = [];
    for (const g of groups) {
        const qty = parseInt(g.qty, 10) || 1;
        // #502 손님 메모의 사이즈 요청(「S사이즈로!」 꼬리 — 러너가 프로그램과 같은 판정으로 붙여 줌)은 기본 품목에 맞춘 뒤 꼬리를 다시 붙여 따로 줄로(주황)
        const sm = /^(.*?)\s+(2S|S|M)사이즈로!$/.exec(String(g.opt || ''));
        let name = M.matchProduct(sm ? sm[1] : (g.opt || ''));
        if (sm && typeof name === 'string' && !name.startsWith('[미매칭]')) name = name + ' ' + sm[2] + '사이즈로!';
        if (typeof name !== 'string' || name.startsWith('[미매칭]')) { unmatched.push({ ch: g.ch, opt: String(g.opt || ''), qty }); continue; }
        map.set(name, (map.get(name) || 0) + qty);
    }
    const agg = [...map.entries()].map(([name, qty]) => ({ name, qty, cat: M.qtyCategory(name), partner: partnerOf(name) || '기타' })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const partners = {};
    for (const it of agg) { const p = partners[it.partner] = partners[it.partner] || { total: 0, rows: [] }; p.rows.push({ name: it.name, qty: it.qty, cat: it.cat }); p.total += it.qty; }
    // 미매칭은 채널·옵션 원문 그대로 묶어 별도 표
    const umap = new Map(); for (const u of unmatched) { const k = `[${u.ch}] ${u.opt}`; umap.set(k, (umap.get(k) || 0) + u.qty); }
    const urows = [...umap.entries()].map(([name, qty]) => ({ name, qty, cat: 'none' })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const utotal = urows.reduce((s, r) => s + r.qty, 0);
    const noOrder = {}; for (const [p, set] of Object.entries(byPartner)) { const miss = [...set].filter(n => !map.has(n)); if (miss.length) noOrder[p] = miss.sort((a, b) => a.localeCompare(b, 'ko')); }
    // ④ PNG(Playwright chromium · deviceScaleFactor 2 · 표 요소만)
    fs.mkdirSync(OUT, { recursive: true });
    const tag = mmdd(kstNow()), files = [];
    const br = await chromium.launch();
    const ctx = await br.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 600 } });
    const pg = await ctx.newPage();
    const shoot = async (html, file) => { await pg.setContent(html, { waitUntil: 'load' }); await pg.locator('#invoice-qty-capture').screenshot({ path: file, type: 'png' }); files.push(file); };
    for (const [p, v] of Object.entries(partners)) await shoot(tableHtml(v.rows, v.total), path.join(OUT, `중간발주_${p}_${tag}.png`));
    if (urows.length) await shoot(tableHtml(urows, utotal, { unmatched: true }), path.join(OUT, `중간발주_미매칭_${tag}.png`));
    await br.close();
    if (!NO_RUN) { const rf = path.join(OUT, `중간발주_러너결과_${tag}.json`); fs.writeFileSync(rf, JSON.stringify(res)); }
    // ⑤ 사람이 읽는 요약 + JSON 한 줄
    const at = kstStr(res.at ? new Date(new Date(res.at).getTime() + 9 * 3600e3) : kstNow());
    const c = res.counts || {};
    console.log(`중간발주 집계 — 조회 ${at} KST · 주문 네이버 ${c.naver ?? '-'} · 자사몰 ${c.cafe24 ?? '-'} · 쿠팡 ${c.coupang ?? '-'}${(res.errors && res.errors.length) ? ' · ⚠️ 채널 오류 ' + res.errors.length : ''}`);
    for (const [p, v] of Object.entries(partners)) { console.log(`\n[${p}] 합계 ${v.total}박스`); v.rows.forEach(r => console.log(`  ${String(r.qty).padStart(4)}  ${r.name}`)); }
    if (urows.length) { console.log(`\n[미매칭] 합계 ${utotal}박스 — 품목별 금액에 없는 옵션(수기 확인)`); urows.forEach(r => console.log(`  ${String(r.qty).padStart(4)}  ${r.name}`)); }
    for (const [p, miss] of Object.entries(noOrder)) console.log(`\n(참고) ${p} 단가표에 있지만 주문 0: ${miss.length}종`);
    console.log(`\n파일 ${files.length}개: ${files.join(' · ')}\n`);
    console.log(JSON.stringify({ at, counts: c, errors: res.errors || [], partners: Object.fromEntries(Object.entries(partners).map(([p, v]) => [p, { total: v.total, rows: v.rows.map(r => ({ name: r.name, qty: r.qty })) }])), unmatched: urows.map(r => ({ name: r.name, qty: r.qty })), noOrder, files }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

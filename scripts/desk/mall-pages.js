// #588-g(대표 GO 10/8) 창구용 — 자사몰 페이지별 「지금 파는 옵션」 보기 · 새 옵션을 다른 페이지에도 넣을 수 있는지 추천(읽기만 · 쓰기 0)
//   node scripts/desk/mall-pages.js list [--all]            판매 중인 페이지마다 지금 파는 옵션(결제가) — --all 이면 판매 중지 페이지도
//   node scripts/desk/mall-pages.js suggest "<옵션 이름>"    그 옵션을 넣을 만한 다른 페이지(최대 3) + 근거 + 넣는 방법
//   구성표를 손으로 적지 않는다 — 페이지 목록 = 동기화 연결표(cafe24_sync_map) · 옵션 = 카페24 실시간(한 번 조회 · 약 10초).
//   정적으로 두는 것은 아래 「품목 낱말표」뿐(업무지식.md 5절에도 같은 표). 표에 없는 품목은 「계열 모름 — 추천 안 함」.
//   추천 = 같은 품목(또는 같은 계열)을 이미 팔고 있는 다른 페이지만. 넣을지는 사람이 정한다 — 이 도구는 아무것도 바꾸지 않는다(옵션 추가는 카페24 관리자 화면에서 사람이).
const M = require('./_mall');
// ── 품목 낱말표: [계열, 품목 이름(화면에 보일 말), 찾는 글자] — 위에서부터 먼저 맞는 것
const FRUITS = [
    ['밤호박', '밤호박', /밤호박/], ['레몬', '레몬', /레몬/], ['키위', '키위', /키위|다래/], ['청귤', '청귤', /청귤|풋귤/],
    ['만감류', '황금향', /황금향/], ['만감류', '한라봉', /한라봉/], ['만감류', '레드향', /레드향/], ['만감류', '천혜향', /천혜향/], ['만감류', '카라향', /카라향/], ['만감류', '진지향', /진지향/], ['만감류', '수라향', /수라향/],
    ['귤', '하우스감귤', /하우스\s*감?귤/], ['귤', '노지감귤', /노지\s*감?귤|유라|타이벡/], ['귤', '귤', /감귤|귤/],
];
const won = n => Number(n).toLocaleString('ko-KR');
const flat = s => String(s || '').normalize('NFC').replace(/\s+/g, '');
function classify(name) {
    const t = flat(name).replace(/하귤|홍귤/g, '');   // 하귤·홍귤은 표에 없는 품목 — 「귤」 글자에 걸리지 않게
    const f = FRUITS.find(x => x[2].test(t)); const w = (t.match(/(\d+(?:\.\d+)?)kg/i) || [])[1];
    return { family: f ? f[0] : null, fruit: f ? f[1] : null, use: (t.match(/선물용|선물|가정용|못난이/) || [''])[0].replace(/^선물$/, '선물용'), weight: w ? Number(w) : null, gift: /선물/.test(t), bulk: /대용량/.test(t) || (w ? Number(w) >= 10 : false) };
}
const sameOpt = (a, b) => a.fruit && a.fruit === b.fruit && a.use === b.use && a.weight != null && a.weight === b.weight;
async function pages() {
    const map = ((await M.cfgGet('cafe24_sync_map')) || {}).map || {}; const ent = Object.entries(map); if (!ent.length) throw new Error('동기화 연결표(cafe24_sync_map)가 비어 있어요');
    const r = await M.c24({ action: 'raw', method: 'GET', path: '/api/v2/admin/products', query: { product_no: ent.map(([, m]) => m.c24).join(','), embed: 'variants', fields: 'product_no,product_name,price,selling,display,variants', limit: 100 } });
    if (!M.c24Ok(r)) throw new Error('카페24 조회 실패: ' + JSON.stringify(r).slice(0, 160));
    return (r.raw.data.products || []).map(p => {
        const nno = (ent.find(([, m]) => String(m.c24) === String(p.product_no)) || [])[0], base = Math.round(Number(p.price));
        const vars = (p.variants || []).map(v => { const name = (v.options || []).map(o => o.value).join(' / '); return { name, pay: base + Math.round(Number(v.additional_amount)), live: v.selling === 'T' && v.display === 'T', c: classify(name) }; });
        return { cno: p.product_no, nno, name: p.product_name, on: p.selling === 'T' && p.display === 'T', selling: p.selling, display: p.display, live: vars.filter(v => v.live), hidden: vars.filter(v => !v.live), nameClass: classify(p.product_name) };
    }).sort((a, b) => a.cno - b.cno);
}
const HOWTO = p => `카페24 관리자 → 상품관리 → 「${p.name}」(c${p.cno}) 수정 → 옵션/재고 설정 → 네이버와 글자까지 같은 이름으로 옵션 추가 → 저장 → 창구에 「${p.name.split(' ').slice(0, 3).join(' ')} 자사몰 맞춰줘」(새 옵션은 추가금 0 = 기본가로 팔리기 시작하므로 저장한 뒤 바로)`;
(async () => {
    const args = process.argv.slice(2), cmd = args.shift();
    if (!cmd || cmd === 'list') {
        const all = args.includes('--all'), ps = await pages();
        console.log(JSON.stringify({ pages: ps.filter(p => all || p.on).map(p => ({ page: `c${p.cno}`, naver_no: p.nno, name: p.name, state: p.on ? '판매 중' : `판매 중지(${p.selling}/${p.display})`, fruits: [...new Set(p.live.map(v => v.c.fruit || '기타'))], options: p.live.map(v => `${v.name} — ${won(v.pay)}원`), hidden: p.hidden.length })), off_pages: all ? undefined : ps.filter(p => !p.on).map(p => `c${p.cno} ${p.name}`), note: '카페24 지금 값이에요(판매·진열 중인 옵션만 · hidden = 미노출 옵션 수). 자사몰에만 두는 옵션이 섞여 있을 수 있어요 — 네이버와 다른 것이 곧 오류는 아닙니다' }, null, 1));
    } else if (cmd === 'suggest') {
        const q = args.join(' ').trim(); if (q.length < 2) throw new Error('사용: mall-pages.js suggest "<옵션 이름>"  (예: "황금향 선물용 3kg")');
        const o = classify(q);
        if (!o.family) { console.log(JSON.stringify({ option: q, family: null, suggest: [], note: '계열 모름 — 추천 안 함(품목 낱말표에 없는 품목이에요. 새 품목 페이지를 만들거나 표에 넣는 것은 총괄에게)' }, null, 1)); await M.pool.end(); return; }
        const ps = await pages(), already = [], cand = [];
        for (const p of ps) {
            const sameL = p.live.filter(v => sameOpt(v.c, o)), sameH = p.hidden.filter(v => sameOpt(v.c, o));
            if (sameL.length) { already.push({ page: `c${p.cno}`, name: p.name, state: p.on ? '판매 중' : '페이지 판매 중지', has: sameL.map(v => `${v.name} — ${won(v.pay)}원`) }); continue; }
            if (!p.on) continue;   // 판매 중지 페이지에는 추천하지 않는다
            const fr = p.live.filter(v => v.c.fruit === o.fruit), fam = p.live.filter(v => v.c.family === o.family), inName = flat(p.name).includes(o.fruit);
            let score = 0, why = '';
            if (fr.length) { const sameUse = fr.filter(v => v.c.use === o.use); score = sameUse.length ? 4 : 3; const show = (sameUse.length ? sameUse : fr).slice(0, 2); why = `그 페이지에 지금 「${show.map(v => v.name).join('」 「')}」 옵션이 있어요`; }
            else if (inName) { score = 2; why = `그 페이지 이름에 「${o.fruit}」이(가) 들어 있어요(지금 파는 ${o.fruit} 옵션은 없음)`; }
            else if (fam.length && o.family === '만감류') { score = 1; why = `그 페이지가 같은 계열(만감류) 「${fam[0].name}」을(를) 팔고 있어요`; }
            if (!score) continue;
            const giftOnly = p.live.length && p.live.every(v => v.c.gift), bulkOnly = p.live.length && p.live.every(v => v.c.bulk);
            if (giftOnly && !o.gift) continue;   // 선물 전용 페이지에 가정용·못난이는 추천하지 않는다
            const caution = [bulkOnly && !o.bulk ? '그 페이지는 지금 10kg 이상(대용량)만 팔아요' : '', !giftOnly && o.gift && !p.live.some(v => v.c.gift) ? '그 페이지에는 지금 선물용 옵션이 없어요' : '', sameH.length ? `같은 옵션이 미노출로 있어요(「${sameH[0].name}」) — 새로 추가하지 말고 「다시 노출해줘」` : ''].filter(Boolean);
            if (bulkOnly && !o.bulk && o.gift && !p.live.some(v => v.c.gift)) continue;   // 대용량만 파는 페이지에 작은 선물용 = 두 가지가 다 안 맞음 → 추천하지 않는다
            cand.push({ score, n: fr.length, page: `c${p.cno}`, naver_no: p.nno, name: p.name, why, caution: caution.length ? caution : undefined, how: sameH.length ? `창구에 「${sameH[0].name} 다시 노출해줘」` : HOWTO(p) });
        }
        cand.sort((a, b) => b.score - a.score || b.n - a.n);
        const top = cand.slice(0, 3).map(({ score, n, ...x }) => x);
        console.log(JSON.stringify({ option: q, read_as: { 계열: o.family, 품목: o.fruit, 용도: o.use || '(안 적힘)', 중량: o.weight ? o.weight + 'kg' : '(안 적힘)' }, already_on: already, suggest: top, more: cand.length > 3 ? cand.length - 3 : undefined,
            note: top.length ? '넣을 수 있는 페이지예요 — 안 넣어도 됩니다. 넣을지는 직원·대표가 정하고, 넣는 일(카페24 옵션 추가)은 관리자 화면에서 사람이 합니다' : '추천할 다른 페이지가 없어요' + (already.length ? '(같은 옵션을 이미 파는 페이지만 있음)' : '') }, null, 1));
    } else throw new Error('사용: mall-pages.js list [--all] | suggest "<옵션 이름>"');
    await M.pool.end();
})().catch(async e => { console.log(JSON.stringify({ ok: false, error: e.message })); try { await M.pool.end(); } catch (_) { } process.exit(1); });

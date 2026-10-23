// #833 verify — apply-428-skin.js applySkin 을 지금 스냅샷 + 로컬 스킨 정본으로 **메모리에서만** 돌림(파일 쓰기 0 · 업로드 0 · DB 읽기만)
//   A = 감귤 6400134206 하나만 지정(mall-sync run 6400134206 시뮬레이션) · B = 스킨 상세 전 상품 지정 · C = 버튼 자리 못 찾으면 멈추는지
//   node scripts/verify-833-skin-keep.js
const fs = require('fs'), crypto = require('crypto');
const M = require('./desk/_mall');
const { applySkin, keepButtons, KEEP_MAP_FILE, KEEP_RE } = require('./apply-428-skin.js');
const GAM = '6400134206', LEMON = '5531798664', EXP = '7673020911', BIG = '12957301776';
const BANNER_NEW = 'https://shop-phinf.pstatic.net/20261018_237/1792311810775hV0kL_GIF/46920627530533613_203719265.gif';   // #749 30,100
const BANNER_OLD = 'https://shop-phinf.pstatic.net/20260929_174/179066175096160EfG_GIF/';                                      // 33,500 (네이버 품절 상세)
const LIGHT832 = ['20261024_68/1792772187705EBASE_PNG', '20261024_294/17927721879150GjaK_PNG', '20261024_29/17927721880966Lq7L_GIF'];   // #832 꿀팁·먹는법·체험 GIF
const EXPECT = { btnA: 2, btnAll: 7, light832: 8, mappedAll: 29 };   // mappedAll = 새 블록 안 주소 치환 수(imgs 목록 안 셈)   // 스냅샷 #129 · 상세 스냅샷 10-23 19:42Z · 정본 9d45e060 기준
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const J = x => JSON.stringify(x), clone = x => JSON.parse(J(x));
const occ = (s, w) => s.split(w).length - 1;
// 종전 옵션 규칙(#833 전 apply-428-skin.js ① 그대로 · 대조용)
function oldOpts(D, snap, targets) {
  const byNo = {}; for (const x of snap.items) byNo[String(x.no)] = x;
  const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
  const okey = o => onorm(o.n1) + '|' + onorm(o.n2);
  for (const no of targets) {
    const it = D.items.find(x => String(x.no) === no); const s = byNo[no];
    if (s.salePrice != null) it.salePrice = s.salePrice; if (s.discPrice != null) it.discPrice = s.discPrice; if (s.stock != null) it.stock = s.stock;
    const oldByKey = {}; (it.opts || []).forEach(o => { oldByKey[okey(o)] = o; });
    it.opts = s.opts.filter(o => o && o.usable !== false).map(o => { const prev = oldByKey[okey(o)]; if (prev) { if (o.price != null) prev.price = o.price; if (o.stock != null) prev.stock = o.stock; if (o.n1 && prev.n1 !== o.n1) prev.nd = o.n1; else delete prev.nd; return prev; } return { n1: o.n1 || '', n2: o.n2 || '', price: o.price || 0, stock: (o.stock != null ? o.stock : 999) }; });
  }
  return D.items;
}
(async () => {
  const buf0 = M.readLocal(), h0 = crypto.createHash('sha1').update(buf0).digest('hex');
  const D0 = M.storeData(buf0.toString('utf8')).D;
  const snap = await M.latestSnapshot(), det = await M.cfgGet('product_detail_snapshot');
  const keepMap = JSON.parse(fs.readFileSync(KEEP_MAP_FILE, 'utf8')).map;
  const keys = Object.keys(D0.detailImages);
  console.log(`정본 sha1 ${h0.slice(0, 12)} (${buf0.length}b) · 스냅샷 #${snap.id} ${snap.kst} · 상세 스냅샷 ${det.at} · 스킨 상세 ${keys.length}종 · 지킬 주소 ${keepMap.length}줄`);
  const localKeep = []; for (const k of keys) (D0.detailImages[k].blocks || []).forEach((b, i) => { if (b.t === 'x' && KEEP_RE.test(b.html || '')) localKeep.push({ k, i, b }); });
  ok(localKeep.length === EXPECT.btnAll, `정본 전용 버튼 블록 ${localKeep.length} = ${EXPECT.btnAll}`);
  const light832 = s => LIGHT832.reduce((n, w) => n + occ(s, w), 0);
  ok(light832(J(D0.detailImages)) === EXPECT.light832, `정본 #832 경량 주소 ${light832(J(D0.detailImages))}곳 = ${EXPECT.light832}`);

  console.log('A · 감귤만 지정');
  { const D = clone(D0), R = clone(D0); const r = applySkin(D, snap, det, [GAM], keepMap);
    console.log('   ' + J({ kept_btn802: r.kept_btn802, kept_products: r.kept_products, mapped: r.mapped, changed: r.dChanged }));
    ok(r.kept_btn802 === EXPECT.btnA, `감귤 전용 버튼 유지 ${r.kept_btn802} = ${EXPECT.btnA}`);
    ok(localKeep.filter(x => x.k === GAM).every(x => J(D.detailImages[GAM].blocks[x.i]) === J(x.b)), '감귤 버튼 블록 #23·#24 바이트 동일 · 같은 자리');
    ok(r.kept_products === keys.length - 1, `안 지정한 상품 그대로 ${r.kept_products} = ${keys.length - 1}`);
    ok(keys.filter(k => k !== GAM).every(k => J(D.detailImages[k]) === J(D0.detailImages[k])), '감귤 밖 상세 전부 바이트 동일');
    ok(J(D.detailImages[LEMON]) === J(D0.detailImages[LEMON]) && J(D.detailImages[EXP]) === J(D0.detailImages[EXP]), '레몬·체험 상세 바이트 동일');
    ok(J(D.detailImages[BIG]) === J(D0.detailImages[BIG]) && D.detailImages[BIG].imgs.includes(BANNER_NEW), '대용량 배너 30,100 주소 그대로');
    ok(light832(J(D.detailImages)) === EXPECT.light832, `#832 경량 주소 ${light832(J(D.detailImages))}곳 동일`);
    ok(J(D.detailImages[GAM]) === J(D0.detailImages[GAM]), '감귤 상세 = 정본(스냅샷과 다른 곳은 버튼 2칸뿐이었음)');
    ok(J(D.items) === J(oldOpts(R, snap, [GAM])), '옵션·가격 갱신 = 종전 규칙 결과와 같음');
    ok(J(Object.keys(D)) === J(Object.keys(D0)), 'STORE_DATA 키 순서 그대로'); }

  console.log('B · 스킨 상세 전 상품 지정');
  { const all = keys.filter(k => D0.items.some(x => String(x.no) === k) && snap.items.some(x => String(x.no) === k));
    const D = clone(D0), R = clone(D0); const r = applySkin(D, snap, det, all, keepMap);
    console.log('   ' + J({ targets: all.length, kept_btn802: r.kept_btn802, kept_products: r.kept_products, mapped: r.mapped, changed: r.dChanged, missing: r.dMissing }));
    ok(all.length === keys.length, `지정 ${all.length} = 스킨 상세 ${keys.length}`);
    ok(r.kept_btn802 === EXPECT.btnAll, `전용 버튼 유지 ${r.kept_btn802} = ${EXPECT.btnAll}`);
    ok(localKeep.every(x => J(D.detailImages[x.k].blocks[x.i]) === J(x.b)), '버튼 7개 바이트 동일 · 같은 자리');
    let nk = 0; for (const k of keys) nk += (D.detailImages[k].blocks || []).filter(b => b.t === 'x' && KEEP_RE.test(b.html || '')).length;
    ok(nk === EXPECT.btnAll, `결과 전용 버튼 블록 수 ${nk} = ${EXPECT.btnAll}`);
    ok(D.detailImages[BIG].imgs.includes(BANNER_NEW) && occ(J(D.detailImages), BANNER_OLD) === 0, '대용량 배너 = 30,100 · 옛 33,500 주소 0');
    ok(D.detailImages[BIG].imgs.length === D0.detailImages[BIG].imgs.length && D.detailImages[BIG].imgs[3] === D0.detailImages[BIG].imgs[3], '대용량 그림 수 = 정본 · 배너 자리 같은 주소');
    let keep832 = 0, same832 = 0; for (const k of keys) { const s = J(D0.detailImages[k]); if (!LIGHT832.some(w => s.includes(w))) continue; (D0.detailImages[k].blocks || []).forEach((b, i) => { if (LIGHT832.some(w => J(b).includes(w))) { keep832++; if (J(D.detailImages[k].blocks[i]) === J(b)) same832++; } }); }
    ok(keep832 === EXPECT.light832 / 2 && same832 === keep832, `#832 경량 블록 ${same832}/${keep832} 바이트 동일(블록+그림 목록 = ${EXPECT.light832}곳)`);
    ok(light832(J(D.detailImages)) >= EXPECT.light832, `#832 경량 주소 ${light832(J(D.detailImages))}곳 ≥ ${EXPECT.light832}(품절 상품 옛 주소도 경량으로)`);
    ok(keepMap.every(m => occ(J(D.detailImages), m.from.split('?')[0]) === 0), '지킬 주소 표의 옛 주소 결과에 0');
    ok(r.mapped === EXPECT.mappedAll, `치환 ${r.mapped} = ${EXPECT.mappedAll}(블록 기준 · 스킨 상품 옛 주소 28 + 배너 1)`);
    ok(J(D.detailImages[LEMON]) === J(D0.detailImages[LEMON]) && J(D.detailImages[EXP]) === J(D0.detailImages[EXP]), '레몬·체험 상세 = 정본');
    ok(r.kept_products === 0 && r.mapped > 0, `kept_products 0 · mapped ${r.mapped} > 0`);
    ok(J(D.items) === J(oldOpts(R, snap, all)), '옵션·가격 갱신 = 종전 규칙 결과와 같음'); }

  console.log('C · 버튼 자리 못 찾으면 멈춤');
  { const old = clone(D0.detailImages[GAM].blocks), neo = clone(det.items[GAM].blocks).map(b => b); neo.splice(22, 1);   // 버튼 앞 블록을 없앰
    let threw = false; try { keepButtons(GAM, old, neo); } catch (e) { threw = /#833/.test(e.message); }
    ok(threw, '앞 블록이 없어진 새 상세 → 멈춤(오류)'); }

  const h1 = crypto.createHash('sha1').update(M.readLocal()).digest('hex');
  ok(h1 === h0, '정본 파일 그대로(쓰기 0)');
  await M.pool.end().catch(() => {});
  console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERR', e.stack || e.message); try { await M.pool.end(); } catch (_) { } process.exit(1); });

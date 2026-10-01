/* #489(10/1 오픈 · 워커 초안 · 실행은 총괄): 자사몰 스킨 index.html STORE_DATA를 그린레몬·유라조생·레드키위 오픈에 맞춤
   정본 = _참고자료/카페24스킨백업/scripts/skin6-work-final/index.html (서버 해시 일치 확인 후 실행 — 병행 세션 규칙)
   방식 = apply-428-skin.js 그대로: STORE_DATA JSON 통파싱 → 교체 → 재직렬화 + 검산(밖 영역 바이트 보존·재파싱·</script 시퀀스·키 순서) + 백업.
   하는 일:
     a) 6400134206(감귤 — 유라조생 9종 신규 옵션 포함) · 5531798664(레몬 — 「혼합과」3종→「중소과」3종 · 못난이 2종은 네이버에 없어 제거)
        옵션·가격·재고·품절 갱신 = 스킨 런타임 mergeSnapshot(#393) 규칙(번호 프리픽스 무시·같은 이름은 기존 객체 보존·nd·서버에 없는 옵션 제거·새 옵션 추가)
     b) 13782816361(레드키위) = STORE_DATA.items에 새 항목 추가(기존 항목과 같은 키) + detailImages + galleries
        채울 수 없는 값: tags = [] · score = --kiwi-score(기본 5 — 리뷰 1건, 평점 소스 없음 · 화면이 '★'+score를 그대로 찍어 null이면 「★null」) · prodReviews/buyBadges = 없음(런타임이 없으면 생략)
     c) window.AKM_C24MAP(STORE_DATA 밖 코드 줄)에 '13782816361':'<--kiwi-c24>' 추가 — 0이면 건너뜀(카페24 상품 생성 전)
     d) 검산 출력: 변경 요약 · 밖 영역 바이트 보존(STORE_DATA 줄·C24MAP 줄 제외 전 줄 동일) · </script 시퀀스 0
   사용: node scripts/apply-489-skin.js --dry --kiwi-c24 0            (결과만 출력 · 파일 쓰기 0)
         node scripts/apply-489-skin.js --kiwi-c24 110 [--kiwi-score 5] [--backup-tag 489]
   ⚠️ 런타임 mergeSnapshot은 STORE_DATA에 **이미 있는** 항목만 갱신한다(새 상품을 추가하지 않음) → 레드키위는 이 스크립트로 넣어야 화면에 나온다.
   ⚠️ 카테고리(v5Cats CATS.citrus 정규식)에 「키위」가 없어 레드키위는 홈 목록에는 뜨지만 「감귤류」 등 어느 카테고리에도 안 들어간다 — 코드 수정(index.html 3911행) 필요 · 이 스크립트 범위 밖.
   ⚠️ 카페24 옵션 텍스트(n1 · n2)와의 정합은 실화면 담기 검증(verify-428-mall.js 계열)이 최종 판정. */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const DRY = argv.includes('--dry');
const KIWI_C24 = String(arg('--kiwi-c24', '0')).trim();
const KIWI_SCORE = Number(arg('--kiwi-score', '5'));
const SNAP_MAX_H = Number(arg('--snap-max-hours', '6'));
const FILE = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index.html';
const BACKUP = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index_pre' + arg('--backup-tag', '489') + '_backup.html';
const NO_HOUSE = '6400134206', NO_LEMON = '5531798664', NO_KIWI = '13782816361';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const src = fs.readFileSync(FILE, 'utf8');
  const lines = src.split('\n');
  const li = lines.findIndex(l => l.startsWith('<script>window.STORE_DATA = '));
  if (li < 0) throw new Error('STORE_DATA 줄 없음');
  const L = lines[li];
  const i0 = L.indexOf('{'), i1 = L.lastIndexOf('}');
  const head = L.slice(0, i0), tail = L.slice(i1 + 1);
  const D = JSON.parse(L.slice(i0, i1 + 1));
  const beforeJson = JSON.stringify(D);
  const itemKeys = Object.keys(D.items[0]);   // no,originNo,name,salePrice,discPrice,discRate,img,imgs,reviewCount,score,soldout,stock,opts,tags

  const snap = (await pool.query('SELECT id, run_at, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1')).rows[0];
  const det = (await pool.query(`SELECT value FROM agent_office_config WHERE key='product_detail_snapshot'`)).rows[0].value;
  const ageH = (Date.now() - new Date(snap.run_at).getTime()) / 3600000;
  console.log(`스냅샷#${snap.id} ${snap.run_at.toISOString()} (${ageH.toFixed(1)}h 전) | 상세 스냅샷 ${det.at} ${det.count}종 | ${DRY ? '🧪 DRY(파일 쓰기 0)' : '🔴 실적용'}`);
  if (ageH > SNAP_MAX_H) throw new Error(`스냅샷 ${SNAP_MAX_H}시간 초과 — 재수집 후 실행(--snap-max-hours로 조정 가능)`);
  const byNo = {}; for (const x of snap.items) byNo[String(x.no)] = x;
  for (const no of [NO_HOUSE, NO_LEMON, NO_KIWI]) if (!byNo[no]) throw new Error('스냅샷에 상품 없음 ' + no);
  const log = [];

  // ── a) 옵션·가격·재고·품절 (mergeSnapshot 동일 규칙)
  const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
  const okey = o => onorm(o.n1) + '|' + onorm(o.n2);
  const applySnap = (it, s) => {
    if (s.salePrice != null) it.salePrice = s.salePrice;
    if (s.discPrice != null) it.discPrice = s.discPrice;
    if (s.stock != null) it.stock = s.stock;
    if (s.statusType) it.soldout = (String(s.statusType).toUpperCase() === 'OUTOFSTOCK') || Number(s.stock) === 0;
    if (s.reviewCount != null && Number(s.reviewCount) >= (Number(it.reviewCount) || 0)) it.reviewCount = Number(s.reviewCount);
    if (it.salePrice && it.discPrice != null) it.discRate = Math.round((1 - it.discPrice / it.salePrice) * 100);
    const oldByKey = {}; (it.opts || []).forEach(o => { oldByKey[okey(o)] = o; });
    const removed = (it.opts || []).filter(o => !(s.opts || []).some(x => x && x.usable !== false && okey(x) === okey(o))).map(o => (o.n2 || o.n1));
    const added = [];
    it.opts = (s.opts || []).filter(o => o && o.usable !== false).map(o => {
      const prev = oldByKey[okey(o)];
      if (prev) {
        if (o.price != null) prev.price = o.price;
        if (o.stock != null) prev.stock = o.stock;
        if (o.n1 && prev.n1 !== o.n1) prev.nd = o.n1; else delete prev.nd;
        return prev;
      }
      added.push(o.n2 || o.n1);
      return { n1: o.n1 || '', n2: o.n2 || '', price: o.price || 0, stock: (o.stock != null ? o.stock : 999) };
    });
    return { removed, added };
  };
  // --refresh-meta: 대상 3종의 name·img·imgs도 최신 스냅샷으로(대표 10/1 「메인사진도 바꿔」 — 그린레몬 개명·대표사진 교체). 기본은 옵션·가격·재고·품절만.
  const REFRESH_META = argv.includes('--refresh-meta');
  const metaLog = [];
  const applyMeta = (it, s) => {
    if (!REFRESH_META) return;
    const ch = [];
    if (s.name && s.name !== it.name) { ch.push(`name 「${it.name}」→「${s.name}」`); it.name = s.name; }
    if (s.img && s.img !== it.img) { ch.push(`img ${String(it.img).slice(-28)} → ${String(s.img).slice(-28)}`); it.img = s.img; }
    if (s.img) { const rest = (it.imgs || []).filter(u => u !== it.img && u !== s.img); it.imgs = [s.img, ...rest]; }   // 대표 이미지를 앞에 · 나머지 갤러리 유지
    metaLog.push(`   meta ${it.no}: ${ch.length ? ch.join(' · ') : '변경 없음'}`);
  };
  for (const no of [NO_HOUSE, NO_LEMON]) {
    const it = D.items.find(x => String(x.no) === no);
    if (!it) throw new Error('STORE_DATA 항목 없음 ' + no);
    const before = JSON.stringify(it);
    applyMeta(it, byNo[no]);
    const r = applySnap(it, byNo[no]);
    log.push(`a) ${no} ${it.name.slice(0, 14)}: sale ${it.salePrice} · disc ${it.discPrice}(${it.discRate}%) · soldout ${it.soldout} · opts ${JSON.parse(before).opts.length}→${it.opts.length} · 추가 ${r.added.length} · 제거 ${r.removed.length} · 변경 ${before !== JSON.stringify(it) ? 'Y' : 'N'}`);
    r.added.forEach(n => log.push(`     + ${n}`)); r.removed.forEach(n => log.push(`     − ${n}`));
    it.opts.forEach(o => log.push(`     ${o.n1}${o.nd ? ' (표시:' + o.nd + ')' : ''}${o.n2 ? ' · ' + o.n2 : ''} · +${o.price} · 재고 ${o.stock}`));
  }

  // ── b) 레드키위 신규 항목
  const ks = byNo[NO_KIWI];
  let kiwi = D.items.find(x => String(x.no) === NO_KIWI);
  const kiwiNew = !kiwi;
  if (kiwiNew) {
    kiwi = {
      no: Number(NO_KIWI), originNo: String(ks.originNo || ''), name: ks.name, salePrice: ks.salePrice, discPrice: ks.discPrice, discRate: 0,
      img: ks.img, imgs: [ks.img], reviewCount: Number(ks.reviewCount) || 0, score: KIWI_SCORE, soldout: false, stock: ks.stock, opts: [], tags: [],
    };
    const li2 = D.items.findIndex(x => String(x.no) === NO_LEMON);
    D.items.splice(li2 + 1, 0, kiwi);   // 레몬 다음 자리(홈·카테고리는 정렬이 따로 있어 위치 무관)
  }
  applyMeta(kiwi, ks);
  const kr = applySnap(kiwi, ks);
  if (Object.keys(kiwi).join() !== itemKeys.join()) throw new Error('레드키위 항목 키 불일치: ' + Object.keys(kiwi).join());
  if (metaLog.length) { log.push(`a-2) --refresh-meta(name·img·imgs):`); metaLog.forEach(l => log.push(l)); }
  log.push(`b) ${NO_KIWI} 레드키위 ${kiwiNew ? '신규 추가' : '기존 갱신'}: originNo ${kiwi.originNo} · sale ${kiwi.salePrice} · disc ${kiwi.discPrice}(${kiwi.discRate}%) · 재고 ${kiwi.stock} · soldout ${kiwi.soldout} · 리뷰 ${kiwi.reviewCount} · score ${kiwi.score}(가정) · tags [] · opts ${kiwi.opts.length}`);
  kiwi.opts.forEach(o => log.push(`     ${o.n1} · +${o.price} · 재고 ${o.stock}`));
  D.galleries = D.galleries || {};
  if (!D.galleries[NO_KIWI] || !D.galleries[NO_KIWI].length) { D.galleries[NO_KIWI] = [ks.img]; log.push(`   galleries[${NO_KIWI}] = 대표 이미지 1장(네이버 상품 API 갤러리 미수집)`); }
  // 상세페이지: 대상 3종만(값 형태 count·imgs·blocks — #399 동일)
  D.detailImages = D.detailImages || {};
  for (const no of [NO_HOUSE, NO_LEMON, NO_KIWI]) {
    const n = det.items[no];
    if (!n || !Array.isArray(n.blocks) || !n.blocks.length) { log.push(`   detailImages[${no}] 상세 스냅샷 없음 — 유지`); continue; }
    const nv = { count: n.count, imgs: n.imgs, blocks: n.blocks };
    const same = JSON.stringify(D.detailImages[no]) === JSON.stringify(nv);
    D.detailImages[no] = nv;
    log.push(`   detailImages[${no}] ${same ? '동일' : (D.detailImages[no] ? '갱신' : '신규')} (${nv.count}장 · ${nv.blocks.length}블록)`);
  }
  if (!D.prodReviews || !D.prodReviews[NO_KIWI]) log.push(`   prodReviews[${NO_KIWI}] 없음(리뷰 스냅샷 20종에 미포함 · 런타임 생략) · buyBadges 없음(생략) · videos 없음 · guides 매칭 키 없음(발송안내문 미노출)`);

  // ── c) AKM_C24MAP 줄
  let mapLi = -1, mapLineNew = null;
  if (KIWI_C24 && KIWI_C24 !== '0') {
    mapLi = lines.findIndex(l => /'7673020911':'47'/.test(l));
    if (mapLi < 0) throw new Error('AKM_C24MAP 줄(7673020911) 없음');
    if (new RegExp(`'${NO_KIWI}'`).test(lines.slice(0, 30).join('\n'))) { log.push(`c) C24MAP에 ${NO_KIWI} 이미 있음 — 건너뜀`); mapLi = -1; }
    else { mapLineNew = lines[mapLi].replace(`'7673020911':'47'`, `'${NO_KIWI}':'${KIWI_C24}', '7673020911':'47'`); log.push(`c) C24MAP + '${NO_KIWI}':'${KIWI_C24}' (${mapLi + 1}행)`); }
  } else log.push(`c) C24MAP 건너뜀(--kiwi-c24 0 — 카페24 상품 생성 후 번호 지정)`);

  // ── c-2) --patch-code: 코드 2줄 치환(총괄 회신 10/1) — ①v5Render SHORT 이름표에 레드키위 ②v5Cats CATS.citrus 정규식에 |키위
  //    치환 전후 검산: 전 = 정규식이 키위 이름을 안 잡음 / 후 = 잡음 · SHORT에 키 생김. 이미 적용돼 있으면 건너뜀.
  const codePatch = [];   // [lineIdx, newLine]
  if (argv.includes('--patch-code')) {
    const kiwiName = ks.name;
    const sIdx = lines.findIndex(l => /var SHORT = \{/.test(l) && /'5531798664':'제주 레몬'/.test(l));
    const cIdx = lines.findIndex(l => /citrus:\{ label:'감귤류/.test(l) && /\|홍귤\/\.test\(it\.name\)/.test(l));
    if (sIdx < 0) throw new Error('SHORT 줄(5531798664) 없음'); if (cIdx < 0) throw new Error('CATS.citrus 줄(|홍귤/.test) 없음');
    const reBefore = lines[cIdx].match(/return (\/[^/]+\/)\.test\(it\.name\)/)[1];
    if (new RegExp(reBefore.slice(1, -1)).test(kiwiName)) log.push(`c-2) CATS.citrus 이미 키위 포함 — 건너뜀`);
    else { const nl = lines[cIdx].replace('|홍귤/.test(it.name)', '|홍귤|키위/.test(it.name)'); const reAfter = nl.match(/return (\/[^/]+\/)\.test\(it\.name\)/)[1];
      if (!new RegExp(reAfter.slice(1, -1)).test(kiwiName)) throw new Error('CATS 치환 후에도 키위 미매칭'); codePatch.push([cIdx, nl]); log.push(`c-2) CATS.citrus ${cIdx + 1}행: 전 ${reBefore.slice(-12)} → 후 …|홍귤|키위/ · 키위 이름 매칭 전 N → 후 Y`); }
    // SHORT: 레몬 이름표 「제주 레몬」→「제주 그린레몬」(대표 10/1 그린레몬 개명) + 레드키위 추가 — 둘 다 한 줄에서
    let nl = lines[sIdx];
    if (!/'5531798664':'제주 그린레몬'/.test(nl)) nl = nl.replace(`'5531798664':'제주 레몬'`, `'5531798664':'제주 그린레몬'`);
    if (!new RegExp(`'${NO_KIWI}':`).test(nl)) nl = nl.replace(`'5531798664':'제주 그린레몬'`, `'5531798664':'제주 그린레몬','${NO_KIWI}':'제주 레드키위'`);
    if (nl === lines[sIdx]) log.push(`c-2) SHORT 이미 적용(그린레몬·레드키위) — 건너뜀`);
    else { if (!/'5531798664':'제주 그린레몬'/.test(nl) || !new RegExp(`'${NO_KIWI}':'제주 레드키위'`).test(nl)) throw new Error('SHORT 치환 실패'); codePatch.push([sIdx, nl]); log.push(`c-2) SHORT ${sIdx + 1}행: '5531798664' → '제주 그린레몬' · + '${NO_KIWI}':'제주 레드키위'`); }
  }

  // ── 재직렬화 + 검산
  const newJson = JSON.stringify(D);
  if (/<\/script/i.test(newJson)) throw new Error('</script 시퀀스 발생 — 중단');
  const newL = head + newJson + tail;
  JSON.parse(newL.slice(newL.indexOf('{'), newL.lastIndexOf('}') + 1));
  const outLines = lines.slice();
  outLines[li] = newL;
  if (mapLineNew) outLines[mapLi] = mapLineNew;
  codePatch.forEach(([k, nl]) => { outLines[k] = nl; });
  if (outLines.length !== lines.length) throw new Error('줄 수 변동');
  const allowed = new Set([li, mapLi, ...codePatch.map(x => x[0])]);
  let diffOut = 0;
  for (let k = 0; k < lines.length; k++) if (!allowed.has(k) && outLines[k] !== lines[k]) diffOut++;
  if (diffOut) throw new Error('밖 영역 변동 ' + diffOut + '줄');
  const D2 = JSON.parse(outLines[li].slice(i0, outLines[li].lastIndexOf('}') + 1));
  if (Object.keys(D2).join() !== Object.keys(D).join()) throw new Error('키 순서 변동');
  const out = outLines.join('\n');
  const cnt = (s, w) => (s.match(new RegExp(w, 'g')) || []).length;
  const optsStr = JSON.stringify(D.items.map(x => x.opts));

  console.log(log.join('\n'));
  console.log(`d) 검산: 바뀐 줄 ${allowed.size - (mapLi < 0 ? 1 : 0)}개(STORE_DATA${mapLineNew ? '·C24MAP' : ''}${codePatch.length ? '·코드 ' + codePatch.length + '줄' : ''}) · 밖 영역 변동 0줄 ·</script 시퀀스 0 · 키 순서 동일 · items ${JSON.parse(beforeJson).items.length}→${D.items.length} · STORE_DATA 변경 ${beforeJson !== newJson ? 'Y' : 'N'} · 잔재 opts 「혼합과」 ${cnt(optsStr, '혼합과')} · 「못난이 레몬」 ${cnt(optsStr, '못난이 레몬')} · 「대과 7~15과」(중대과 아님) ${cnt(optsStr, '[^중]대과 7~15과')}`);
  if (!codePatch.some(([k]) => /citrus:\{ label/.test(lines[k]))) console.log(`   레드키위 카테고리: CATS.citrus 정규식에 「키위」 없음 → 홈 목록 O · 카테고리 화면 X (--patch-code 로 치환 가능)`);
  if (DRY) { console.log(`🧪 DRY — 저장 안 함 (저장 시 ${Buffer.byteLength(out)}b · 백업 ${BACKUP})`); }
  else { fs.copyFileSync(FILE, BACKUP); fs.writeFileSync(FILE, out, 'utf8'); console.log(`✅ 저장 ${FILE} (${Buffer.byteLength(out)}b · 백업 ${BACKUP})`); }
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

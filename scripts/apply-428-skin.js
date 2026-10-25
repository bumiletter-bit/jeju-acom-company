/* #428(대표 9/7): 자사몰 스킨 index.html STORE_DATA 갱신 — 옵션(황금향 선물용 중대과·귤 단가) + 상세페이지 20종 전량(대표 "모두 긁어와줘")
   정본 = _참고자료/카페24스킨백업/scripts/skin6-work-final/index.html (서버 해시 일치 확인 후 실행 — 병행 세션 규칙)
   방식 = #399 그대로: STORE_DATA JSON 통파싱 → 교체 → 재직렬화 + 검산(밖 영역 바이트 보존·재파싱·</script 시퀀스·키 대조). 백업 index_pre428_backup.html.
   옵션 교체 규칙 = 스킨 런타임 mergeSnapshot(#393)과 동일: 이름(번호 프리픽스 무시)이 같은 옵션은 기존 객체 보존(n1 = 카페24 「찾는 글자」)·추가금/재고 갱신·네이버 표기 바뀌면 nd, 서버에 없는 옵션 제거·새 옵션 추가.
   ⚠️ 카페24 옵션 텍스트(n1 · n2)와의 정합은 실화면 담기 검증(verify-428-mall.js)이 최종 판정.
   #833(10/24): 상세는 **지정한 상품만** 갱신(종전 = 스킨 전 상품 통째 덮기 → #802 자사몰 전용 버튼·#749 배너가 옛 판으로 되돌아감) ·
   갱신하는 상품 안에서도 자사몰 전용 HTML 버튼 블록(data-btn802·data-resv768·data-map772)은 앞뒤 블록을 기준으로 그 자리에 유지 ·
   새 스냅샷 블록의 그림 주소는 scripts/desk/skin-keep-map.json(옛 주소 → 지킬 주소)로 치환. 결과 줄 「#833 {kept_btn802, kept_products, mapped}」.
   require 하면 applySkin(D, snap, det, targets, keepMap) 만 쓴다(파일·DB 안 건드림 · verify-833-skin-keep.js). */
const fs = require('fs'), path = require('path');
const FILE = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index.html';
const BACKUP = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index_pre' + (process.argv[3] || '428') + '_backup.html';   // 3번째 인자 = 백업 태그(예: 429)
// 대상 상품번호 = 인자(쉼표 구분) · 미지정 시 #428 기본 3종. 예) node scripts/apply-428-skin.js 5731582511   (#429 청귤)
const TARGET_NOS = process.argv[2] ? process.argv[2].split(',') : ['11126666859', '6400134206', '10801253976'];   // c94 황금향 · c92 타이벡(황금향 옵션 포함) · c100 VIP
const KEEP_MAP_FILE = path.join(__dirname, 'desk', 'skin-keep-map.json');
const KEEP_RE = /data-(btn802|resv768|map772)=/;   // 자사몰 전용 HTML 버튼(#802 · #768 예약 · #772 지도) — 네이버 쪽 같은 자리는 버튼 그림 한 장
const ubase = u => String(u || '').split('?')[0];
const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\s+/g, ' ').trim();
// #844 글 열쇠는 공백·「·」(&middot;) 뺀 글자 — 모바일 줄 나누기(단락 쪼개기)로 바뀌는 것은 같은 블록으로 봄
const tkey = h => strip(String(h || '').replace(/&middot;/g, '·')).replace(/[\s·​]/g, '');
const lkey = b => !b ? '-' : b.t === 'i' ? 'i:' + ubase(b.src) : b.t === 'ig' ? 'ig:' + (b.srcs || []).map(ubase).join(',') : b.t === 'x' ? 'x:' + tkey(b.html) : JSON.stringify(b);
const isKeep = b => !!b && b.t === 'x' && KEEP_RE.test(b.html || '');
// 정본의 전용 버튼 묶음(연속 블록)을 새 블록 배열의 같은 자리에 되돌려 놓음 — 앞뒤 블록(그림 주소·글자)이 같은 곳 · 못 찾으면 멈춤(버튼을 잃느니 갱신 안 함)
// mapB(있으면) = 새 블록에 적용한 지킬 주소 치환 — 옛 정본 앞뒤 블록에도 같이 적용해 비교(#844 · 치환된 그림 옆 버튼)
function keepButtons(no, old, neo, mapB) {
  let kept = 0;
  const okey = b => lkey(mapB && b ? mapB(b) : b);
  for (let a = 0; a < old.length; a++) {
    if (!isKeep(old[a])) continue;
    let b = a; while (b + 1 < old.length && isKeep(old[b + 1])) b++;
    const len = b - a + 1, pk = a > 0 ? okey(old[a - 1]) : null, nk = b + 1 < old.length ? okey(old[b + 1]) : null, cand = [];
    for (let j = -1; j + len < neo.length; j++) {
      if (pk === null ? j !== -1 : (j < 0 || lkey(neo[j]) !== pk)) continue;
      if (nk === null ? j + len + 1 !== neo.length : lkey(neo[j + len + 1]) !== nk) continue;
      if (neo.slice(j + 1, j + 1 + len).some(x => !x || x.t !== 'i')) continue;   // 네이버 쪽 그 자리는 버튼 그림이어야
      cand.push(j);
    }
    if (cand.length !== 1) throw new Error(`#833 ${no} 상세 #${a}${len > 1 ? '~#' + b : ''} 자사몰 전용 버튼 자리를 새 상세에서 ${cand.length ? '여러 곳(' + cand.length + ')에서' : '못'} 찾음 — 버튼을 잃지 않게 멈춤(총괄에게)`);
    for (let k = 0; k < len; k++) neo[cand[0] + 1 + k] = old[a + k];
    kept += len; a = b;
  }
  return kept;
}
// ign(있으면) = { keys:Set(cafe24_sync_ignore_opts.keys), mapped:Set(cafe24_sync_map 상품번호) } — server.js storeSnapshotForMall(#689)과 같은 거름:
//   연결표에 있는 상품의 · 팔리는(usable · 재고 > 0) 옵션 가운데 열쇠(price-check.js cafe24OptKey = 서버와 같은 글자 사본)가 든 것 = 네이버 전용 → 스킨 옵션에 안 넣음 · 전부 빠지면 원본 유지(#844 · 3048·3055 레몬 못난이)
const ignoredOpt = (no, o, ign) => {
  if (!ign || !ign.keys || !ign.keys.size || !ign.mapped || !ign.mapped.has(String(no))) return false;
  if (!o || o.usable === false || !(Number(o.stock) > 0)) return false;
  return ign.keys.has(require(path.join(__dirname, '..', 'price-check.js')).cafe24OptKey((o.n1 || '') + ' ' + (o.n2 || '')));
};
function applySkin(D, snap, det, targets, keepMap, ign) {
  const byNo = {}; for (const x of snap.items) byNo[String(x.no)] = x;
  const MAP = new Map((keepMap || []).map(m => [ubase(m.from), m.to]));
  let mapped = 0;
  // mapped = 새 블록 안에서 바꾼 주소 수(imgs 목록은 같은 그림의 두 번째 표기라 안 셈)
  const mapU = (u, count = true) => { const t = MAP.get(ubase(u)); if (!t || t === u) return u; if (count) mapped++; return t; };
  const mapB = (x, count = true) => {
    if (!x || typeof x !== 'object') return x;
    const y = JSON.parse(JSON.stringify(x));
    if (y.src) y.src = mapU(y.src, count);
    if (Array.isArray(y.srcs)) y.srcs = y.srcs.map(u => mapU(u, count));
    if (typeof y.html === 'string') y.html = y.html.replace(/(src=")([^"]+)(")/g, (all, p, u, q) => p + mapU(u, count) + q);
    return y;
  };

  // ① 옵션·가격 (mergeSnapshot 동일 규칙)
  const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
  const okey = o => onorm(o.n1) + '|' + onorm(o.n2);
  const optLog = [], ignoredOpts = [];
  for (const no of targets) {
    const it = D.items.find(x => String(x.no) === no); const s = byNo[no];
    if (!it || !s) throw new Error('항목 없음 ' + no);
    const before = JSON.stringify(it.opts);
    if (s.salePrice != null) it.salePrice = s.salePrice;
    if (s.discPrice != null) it.discPrice = s.discPrice;
    if (s.stock != null) it.stock = s.stock;
    const oldByKey = {}; (it.opts || []).forEach(o => { oldByKey[okey(o)] = o; });
    const all = (s.opts || []).filter(Boolean), keepAll = all.filter(o => !ignoredOpt(no, o, ign));   // 서버 #689 와 같게 = 전체 옵션에서 거르고 전부 빠질 때만 원본
    const base = keepAll.length ? keepAll : all; if (base.length !== all.length) ignoredOpts.push(...all.filter(o => !base.includes(o)).map(o => `${no} ${o.n1} ${o.n2}`));
    it.opts = base.filter(o => o.usable !== false).map(o => {
      const prev = oldByKey[okey(o)];
      if (prev) {
        if (o.price != null) prev.price = o.price;
        if (o.stock != null) prev.stock = o.stock;
        if (o.n1 && prev.n1 !== o.n1) prev.nd = o.n1; else delete prev.nd;
        return prev;
      }
      return { n1: o.n1 || '', n2: o.n2 || '', price: o.price || 0, stock: (o.stock != null ? o.stock : 999) };
    });
    optLog.push(`${no} ${it.name.slice(0, 14)}: disc ${it.discPrice} · opts ${JSON.parse(before).length}→${it.opts.length} · 변경 ${before !== JSON.stringify(it.opts) ? 'Y' : 'N'}`);
    for (const o of it.opts) optLog.push(`     ${o.n1}${o.nd ? ' (표시:' + o.nd + ')' : ''} · ${o.n2} · +${o.price}`);
  }
  // ② 상세 = 지정한 상품만 (값 형태 count·imgs·blocks 유지 — #399 동일 · #833 전용 버튼 유지·지킬 주소 치환)
  const dKeys = Object.keys(D.detailImages || {});
  let dChanged = 0, dSame = 0, keptBtn = 0, keptProducts = 0; const dMissing = [];
  for (const k of dKeys) {
    if (!targets.includes(k)) { keptProducts++; continue; }
    const n = det.items[k];
    if (!n || !Array.isArray(n.blocks) || !n.blocks.length) { dMissing.push(k); continue; }
    const blocks = n.blocks.map(mapB);
    keptBtn += keepButtons(k, (D.detailImages[k] || {}).blocks || [], blocks, x => mapB(x, false));   // 비교용 = 치환 수 안 셈
    const nv = { count: n.count, imgs: Array.isArray(n.imgs) ? n.imgs.map(u => mapU(u, false)) : n.imgs, blocks };
    if (JSON.stringify(D.detailImages[k]) === JSON.stringify(nv)) dSame++; else { dChanged++; D.detailImages[k] = nv; }
  }
  if (dChanged) D.detailImagesSource = `naver detailContent snapshot ${det.at} (#833 지정 상품만 · 전용 버튼·지킬 주소 유지)`;
  return { optLog, ignored_opts: ignoredOpts, dKeys, dChanged, dSame, dMissing, kept_btn802: keptBtn, kept_products: keptProducts, mapped };
}
module.exports = { applySkin, keepButtons, ignoredOpt, KEEP_MAP_FILE, KEEP_RE };

if (require.main === module) (async () => {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const src = fs.readFileSync(FILE, 'utf8');
  const lines = src.split('\n');
  const li = lines.findIndex(l => l.startsWith('<script>window.STORE_DATA = '));
  if (li < 0) throw new Error('STORE_DATA 줄 없음');
  const L = lines[li];
  const i0 = L.indexOf('{'), i1 = L.lastIndexOf('}');
  const head = L.slice(0, i0), tail = L.slice(i1 + 1);
  const D = JSON.parse(L.slice(i0, i1 + 1));
  const beforeJson = JSON.stringify(D);

  const snap = (await pool.query('SELECT id, run_at, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1')).rows[0];
  const det = (await pool.query(`SELECT value FROM agent_office_config WHERE key='product_detail_snapshot'`)).rows[0].value;
  console.log('스냅샷#', snap.id, snap.run_at, '| 상세 스냅샷', det.at, det.count + '종');
  if (Date.now() - new Date(snap.run_at).getTime() > 2 * 3600 * 1000) throw new Error('스냅샷 2시간 초과 — 재수집 후 실행');
  const keepMap = JSON.parse(fs.readFileSync(KEEP_MAP_FILE, 'utf8')).map;
  const cfg = async k => ((await pool.query(`SELECT value FROM agent_office_config WHERE key=$1`, [k])).rows[0] || {}).value || {};
  const ignCfg = await cfg('cafe24_sync_ignore_opts'), mapCfg = await cfg('cafe24_sync_map');
  const ign = { keys: new Set((ignCfg.keys || []).map(String)), mapped: new Set(Object.keys(mapCfg.map || {})) };
  const r = applySkin(D, snap, det, TARGET_NOS, keepMap, ign);
  if (r.ignored_opts.length) console.log('#844 네이버 전용 옵션 뺌(cafe24_sync_ignore_opts):', r.ignored_opts.join(' · '));

  // 재직렬화 + 검산
  const newL = head + JSON.stringify(D) + tail;
  if (/<\/script/i.test(JSON.stringify(D))) throw new Error('</script 시퀀스 발생 — 중단');
  JSON.parse(newL.slice(newL.indexOf('{'), newL.lastIndexOf('}') + 1));   // 재파싱
  lines[li] = newL;
  const out = lines.join('\n');
  // 밖 영역 바이트 보존
  const outLines = out.split('\n');
  if (outLines.length !== lines.length) throw new Error('줄 수 변동');
  for (let k = 0; k < lines.length; k++) if (k !== li && outLines[k] !== src.split('\n')[k]) throw new Error('밖 영역 변동 ' + k);
  const D2 = JSON.parse(out.split('\n')[li].slice(i0, out.split('\n')[li].lastIndexOf('}') + 1));
  if (Object.keys(D2).join() !== Object.keys(D).join()) throw new Error('키 순서 변동');
  fs.copyFileSync(FILE, BACKUP);
  fs.writeFileSync(FILE, out, 'utf8');
  console.log('① 옵션:'); r.optLog.forEach(l => console.log('  ' + l));
  console.log(`② 상세: ${r.dKeys.length}키 — 지정 상품 내용 변경 ${r.dChanged} · 동일 ${r.dSame} · 스냅샷 부재 ${r.dMissing.length}${r.dMissing.length ? ' ' + r.dMissing.join(',') : ''}`);
  console.log('#833 ' + JSON.stringify({ kept_btn802: r.kept_btn802, kept_products: r.kept_products, mapped: r.mapped }));
  const cnt = (s, w) => (s.match(new RegExp(w, 'g')) || []).length;
  const optsStr = JSON.stringify(D.items.map(x => x.opts)); const detStr = JSON.stringify(D.detailImages);
  console.log(`③ 잔재: opts 「13~23과」 ${cnt(optsStr, '13~23과')} · opts 「대과 7~15과」 ${cnt(optsStr, '[^중]대과 7~15과')} · 상세 「23과」 ${cnt(detStr, '23과')} · 상세 「중대과」 ${cnt(detStr, '중대과')}`);
  console.log(`✅ 저장 ${FILE} (${Buffer.byteLength(out)}b · 백업 ${BACKUP}) · STORE_DATA 변경 ${beforeJson !== JSON.stringify(D) ? 'Y' : 'N'}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

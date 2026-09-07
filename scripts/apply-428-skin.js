/* #428(대표 9/7): 자사몰 스킨 index.html STORE_DATA 갱신 — 옵션(황금향 선물용 중대과·귤 단가) + 상세페이지 20종 전량(대표 "모두 긁어와줘")
   정본 = _참고자료/카페24스킨백업/scripts/skin6-work-final/index.html (서버 해시 일치 확인 후 실행 — 병행 세션 규칙)
   방식 = #399 그대로: STORE_DATA JSON 통파싱 → 교체 → 재직렬화 + 검산(밖 영역 바이트 보존·재파싱·</script 시퀀스·키 대조). 백업 index_pre428_backup.html.
   옵션 교체 규칙 = 스킨 런타임 mergeSnapshot(#393)과 동일: 이름(번호 프리픽스 무시)이 같은 옵션은 기존 객체 보존(n1 = 카페24 「찾는 글자」)·추가금/재고 갱신·네이버 표기 바뀌면 nd, 서버에 없는 옵션 제거·새 옵션 추가.
   ⚠️ 카페24 옵션 텍스트(n1 · n2)와의 정합은 실화면 담기 검증(verify-428-mall.js)이 최종 판정. */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const FILE = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index.html';
const BACKUP = '_참고자료/카페24스킨백업/scripts/skin6-work-final/index_pre428_backup.html';
const TARGET_NOS = ['11126666859', '6400134206', '10801253976'];   // c94 황금향 · c92 타이벡(황금향 옵션 포함) · c100 VIP
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

  const snap = (await pool.query('SELECT id, run_at, items FROM naver_product_snapshot ORDER BY id DESC LIMIT 1')).rows[0];
  const det = (await pool.query(`SELECT value FROM agent_office_config WHERE key='product_detail_snapshot'`)).rows[0].value;
  console.log('스냅샷#', snap.id, snap.run_at, '| 상세 스냅샷', det.at, det.count + '종');
  if (Date.now() - new Date(snap.run_at).getTime() > 2 * 3600 * 1000) throw new Error('스냅샷 2시간 초과 — 재수집 후 실행');
  const byNo = {}; for (const x of snap.items) byNo[String(x.no)] = x;

  // ① 옵션·가격 (mergeSnapshot 동일 규칙)
  const onorm = v => String(v || '').normalize('NFC').replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
  const okey = o => onorm(o.n1) + '|' + onorm(o.n2);
  const optLog = [];
  for (const no of TARGET_NOS) {
    const it = D.items.find(x => String(x.no) === no); const s = byNo[no];
    if (!it || !s) throw new Error('항목 없음 ' + no);
    const before = JSON.stringify(it.opts);
    if (s.salePrice != null) it.salePrice = s.salePrice;
    if (s.discPrice != null) it.discPrice = s.discPrice;
    if (s.stock != null) it.stock = s.stock;
    const oldByKey = {}; (it.opts || []).forEach(o => { oldByKey[okey(o)] = o; });
    it.opts = s.opts.filter(o => o && o.usable !== false).map(o => {
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
  // ② 상세페이지 20종 전량 (값 형태 count·imgs·blocks 유지 — #399 동일)
  const dKeys = Object.keys(D.detailImages || {});
  let dChanged = 0, dSame = 0, dMissing = [];
  for (const k of dKeys) {
    const n = det.items[k];
    if (!n || !Array.isArray(n.blocks) || !n.blocks.length) { dMissing.push(k); continue; }
    const nv = { count: n.count, imgs: n.imgs, blocks: n.blocks };
    if (JSON.stringify(D.detailImages[k]) === JSON.stringify(nv)) dSame++; else dChanged++;
    D.detailImages[k] = nv;
  }
  D.detailImagesSource = `naver detailContent snapshot ${det.at} (#428 전량 갱신)`;

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
  console.log('① 옵션:'); optLog.forEach(l => console.log('  ' + l));
  console.log(`② 상세: ${dKeys.length}키 — 내용 변경 ${dChanged} · 동일 ${dSame} · 스냅샷 부재 ${dMissing.length}${dMissing.length ? ' ' + dMissing.join(',') : ''}`);
  const cnt = (s, w) => (s.match(new RegExp(w, 'g')) || []).length;
  const optsStr = JSON.stringify(D.items.map(x => x.opts)); const detStr = JSON.stringify(D.detailImages);
  console.log(`③ 잔재: opts 「13~23과」 ${cnt(optsStr, '13~23과')} · opts 「대과 7~15과」 ${cnt(optsStr, '[^중]대과 7~15과')} · 상세 「23과」 ${cnt(detStr, '23과')} · 상세 「중대과」 ${cnt(detStr, '중대과')}`);
  console.log(`✅ 저장 ${FILE} (${Buffer.byteLength(out)}b · 백업 ${BACKUP}) · STORE_DATA 변경 ${beforeJson !== JSON.stringify(D) ? 'Y' : 'N'}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

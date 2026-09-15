/* ===== 파일에서 주문 추출 (엑셀/CSV/한글/워드/텍스트) =====
   전역 의존: XLSX (CFB 포함), pako, akAddressScore, akNormPhone, akParseOrders */
(function(glob){

const XU = () => glob.XLSX;

function entReplace(s){
  return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&#(\d+);/g,(m,d)=>String.fromCharCode(+d)).replace(/&amp;/g,'&');
}

/* ---------- HWPX (zip/xml) ---------- */
function extractHwpx(u8){
  const cfb = XU().CFB.read(u8, {type:'array'});
  const out = [];
  cfb.FullPaths.forEach((p,i)=>{
    if (/Contents\/section\d+\.xml$/i.test(p)){
      const f = cfb.FileIndex[i];
      const xml = new TextDecoder('utf-8').decode(toU8(f.content));
      // 문단 단위로 줄바꿈
      const paras = xml.split(/<hp:p[\s>]/).slice(1);
      for (const para of paras){
        const texts = [...para.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map(m=>entReplace(m[1]));
        const line = texts.join('').trim();
        out.push(line);
      }
    }
  });
  if (!out.length) throw new Error('HWPX에서 본문을 찾지 못했어요');
  return out.join('\n');
}

/* ---------- DOCX (zip/xml) ---------- */
function extractDocx(u8){
  const cfb = XU().CFB.read(u8, {type:'array'});
  let xml = null;
  cfb.FullPaths.forEach((p,i)=>{
    if (/word\/document\.xml$/i.test(p)) xml = new TextDecoder('utf-8').decode(toU8(cfb.FileIndex[i].content));
  });
  if (!xml) throw new Error('워드 문서 본문을 찾지 못했어요');
  const paras = xml.split(/<w:p[\s>]/).slice(1);
  const out = paras.map(para =>
    [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m=>entReplace(m[1])).join('').trim()
  );
  if (!out.length) throw new Error('워드 문서가 비어있어요');
  return out.join('\n');
}

/* ---------- HWP 5.0 (CFB 바이너리) ---------- */
function extractHwp(u8){
  const cfb = XU().CFB.read(u8, {type:'array'});
  // FileHeader → 압축 여부
  let compressed = true;
  cfb.FullPaths.forEach((p,i)=>{
    if (/FileHeader$/i.test(p)){
      const c = toU8(cfb.FileIndex[i].content);
      if (c.length > 36) compressed = !!(c[36] & 1);
      const sig = new TextDecoder('ascii').decode(c.subarray(0,17));
      if (sig !== 'HWP Document File') throw new Error('HWP 형식이 아니에요');
      if (c[36] & 2) throw new Error('암호가 걸린 한글 파일이에요. 암호를 풀고 다시 저장해주세요');
    }
  });
  const sections = [];
  cfb.FullPaths.forEach((p,i)=>{
    const m = p.match(/BodyText\/Section(\d+)$/i);
    if (m) sections.push({n:+m[1], content: toU8(cfb.FileIndex[i].content)});
  });
  if (!sections.length) throw new Error('본문(BodyText)을 찾지 못했어요. 배포용(보안) 문서일 수 있어요');
  sections.sort((a,b)=>a.n-b.n);
  const lines = [];
  for (const sec of sections){
    let data = sec.content;
    if (compressed){
      try { data = glob.pako.inflateRaw(data); }
      catch(e){ try { data = glob.pako.inflate(data); } catch(e2){ throw new Error('본문 압축 해제 실패'); } }
    }
    parseHwpRecords(data, lines);
  }
  const text = lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  if (!text) throw new Error('한글 파일에서 텍스트를 찾지 못했어요');
  return text;
}
function parseHwpRecords(u8, lines){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let pos = 0;
  const CHAR_CTRL = new Set([0,10,13,24,25,26,27,28,29,30,31]); // 1 WCHAR
  while (pos + 4 <= u8.length){
    const h = dv.getUint32(pos, true); pos += 4;
    const tag = h & 0x3FF;
    let size = (h >>> 20) & 0xFFF;
    if (size === 0xFFF){ if (pos+4 > u8.length) break; size = dv.getUint32(pos, true); pos += 4; }
    if (pos + size > u8.length) break;
    if (tag === 67){ // HWPTAG_PARA_TEXT
      let t = '', p = pos;
      const end = pos + size;
      while (p + 2 <= end){
        const c = dv.getUint16(p, true);
        if (c >= 32){ t += String.fromCharCode(c); p += 2; }
        else if (CHAR_CTRL.has(c)){ if (c===10||c===13) t += '\n'; p += 2; }
        else { if (c===9) t += ' '; p += 16; } // 인라인/확장 컨트롤 = 8 WCHAR
      }
      t.split('\n').forEach(s=>lines.push(s.trim()));
    }
    pos += size;
  }
}

/* ---------- 스프레드시트 (xlsx/xls/csv) ---------- */
const COLMAP = [
  // [필드, 우선순위 높은 순 매칭] — 먼저 매칭되는 규칙 적용
  ['senderPhone', /보내는(사람|분|이)?연락처|주문자연락처|입금자연락처/],
  ['skip',        /보내는이\s*변경주소|출고지|주문경로|구매자연락처/],
  ['sender',      /보내는(사람|분|이)|주문자|입금자|발송인/],
  ['company',     /업체명|업체|회사명|회사|상호/],
  ['phone2',      /연락처\s*2|전화\s*2/],
  ['phone',       /수취인연락처|연락처|전화|휴대폰|핸드폰|폰|HP|mobile/i],
  ['name',        /수취인|받는\s*(사람|분|이)|수령인|성함|이름|고객명|성명/],   // #444: 「받는이」 추가
  ['addr',        /배송지|주소|배송\s*주소|수령지/],
  ['memo',        /메세지|메시지|배송\s*메모|요청|비고|메모/],
  ['product',     /옵션|상품|품목|제품|구성|주문내역|내역/],
  ['qty',         /수량|개수|갯수|박스\s*수/],
];
function mapHeader(cells){
  const map = {};
  const alts = {};   // #444: 같은 필드에 매칭된 열 전부(순서대로) — 첫 열이 통째로 비어 있으면 parseAoa가 데이터 있는 열로 갈아탐
  let hits = 0;
  cells.forEach((c,i)=>{
    const t = String(c||'').replace(/\s+/g,'');   // "주 소" → "주소" (공백 무시)
    if (!t) return;
    for (const [field, re] of COLMAP){
      // #444: 「받는사람 주소」·「받는분연락처」처럼 받는-접두가 붙은 주소/연락처 헤더가 이름 규칙에 삼켜지지 않게 (다음 규칙으로 넘김)
      if (field === 'name' && /주소|배송지|수령지|연락처|전화|번호|휴대폰|핸드폰/.test(t)) continue;
      if (re.test(t)){
        if (field !== 'skip'){
          (alts[field] = alts[field] || []).push(i);
          if (map[field] === undefined) map[field] = i;
        }
        hits++;
        return;
      }
    }
  });
  return { map, hits, alts };
}
/* #444: 시트 서문·구간 표식 인식 재료 (헤더 밖 행) */
const RE_MARK_SENDER = /^(보내는\s*(사람|분|이)|발송인|주문자|입금자)$/;                 // 단독 셀 「보내는 사람」 → 아래 행들은 보내는이 정보
const RE_MARK_RECIP  = /^(받는\s*(사람|분|이)|수취인|수령인|배송지)$/;                      // 단독 셀 「받는 사람」 → 아래 행들은 주문
const RE_PRE_SENDER  = /^(보내는\s*(사람|분|이)(\s*이름)?|주문자|발송인|입금자|대량주문자\s*성함)\s*[:：]\s*(.+)$/;   // 「보내는사람 : ○○」
const RE_PRE_SENDER_LBL = /^(보내는\s*(사람|분|이)(\s*이름)?|주문자|발송인|입금자|대량주문자\s*성함)\s*[:：]?$/;    // 라벨 셀 + 값은 다른 셀
const RE_PRE_PHONE_LBL  = /^(연락처|전화|휴대폰|핸드폰)/;
const RE_PHONE_ANY = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const RE_REGION_HEAD = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;
/* 주소 「이어쓴 아랫줄」 판정: 지역명으로 시작하지 않고 도로명/지번 번호도 없는 조각(건물명·동호수만) */
function isAddrFragment(a){
  const t = String(a||'').trim();
  if (!t) return false;
  if (RE_REGION_HEAD.test(t)) return false;
  if (/(로|길)\s*\d/.test(t)) return false;
  if (/(읍|면|동|리|가)\s+\d+(?:-\d+)?(?!\d|\s*호)/.test(t)) return false;   // 법정동+지번이면 온전한 주소(「다동 101호」 같은 동·호는 조각 — 숫자 중간 역추적 금지)
  return true;
}
/* #444: 헤더 없는 표에서 「301동 503호」·「A동 902호」·「2층」처럼 상세만 적힌 셀 */
const RE_DETAIL_CELL = /^([A-Za-z가-힣]?\d*\s*동\s*)?\d+\s*(호|층)$|^[A-Za-z가-힣]\d*\s*동$/;
function guessColumns(rows){
  // 헤더 없는 표: 내용으로 추측
  const ncol = Math.max(...rows.map(r=>r.length));
  const score = Array.from({length:ncol},()=>({phone:0, addr:0, name:0, qty:0, text:0, n:0}));
  const RE_P = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
  for (const r of rows.slice(0, 30)){
    for (let c=0;c<ncol;c++){
      const v = String(r[c]??'').trim();
      if (!v) continue;
      const s = score[c]; s.n++;
      if (RE_P.test(v) || /^0\d{8,10}$/.test(v.replace(/\D/g,''))) s.phone++;
      if (glob.akAddressScore(v) >= 4) s.addr++;
      if (/^[가-힣]{2,4}$/.test(v)) s.name++;
      if (/^\d{1,3}$/.test(v)) s.qty++;
      if (v.length > 4) s.text++;
    }
  }
  const map = {};
  const taken = new Set();
  const pick = (field, key)=>{
    let best=-1, bv=0;
    score.forEach((s,c)=>{ if (taken.has(c)||!s.n) return; const v=s[key]/s.n; if (v>bv && v>=0.5){ bv=v; best=c; } });
    if (best>=0){ map[field]=best; taken.add(best); }
  };
  pick('addr','addr'); pick('phone','phone');
  // 두 번째 전화 컬럼
  { let best=-1,bv=0; score.forEach((s,c)=>{ if(taken.has(c)||!s.n)return; const v=s.phone/s.n; if(v>bv&&v>=0.5){bv=v;best=c;} }); if(best>=0){ map.phone2=best; taken.add(best);} }
  pick('name','name'); pick('qty','qty');
  // 남는 텍스트 컬럼 → 상품, 그 다음 → 메모
  score.forEach((s,c)=>{ if (taken.has(c)||!s.n) return;
    if (map.product===undefined && s.text/s.n>=0.5){ map.product=c; taken.add(c); }
    else if (map.memo===undefined && s.text/s.n>=0.3){ map.memo=c; taken.add(c); } });
  return map;
}
function extractSheet(u8, filename){
  return extractSheetWb(XU().read(u8, {type:'array', codepage:949}));
}
/* 2차원 배열(표) → 주문 레코드. 헤더 자동 인식, 원본 행 순서 유지 */
function parseAoa(aoa){
  // 서식만 있는 유령 열이 수천 개 붙은 파일 대비: 앞 60열만 사용
  aoa = aoa.map(r=>r.slice(0,60));
  const rowsA = aoa.filter(r=>r.some(c=>String(c).trim()!==''));
  if (!rowsA.length) return [];
  let hIdx=-1, hMap=null, hAlts=null;
  // 헤더 탐색: 종전 앞 5행 → 없으면 #444 6~15행까지 확장(서문이 5행 넘는 양식 — 대량주문양식 실사례. 판정 조건은 종전과 동일)
  for (let i=0;i<Math.min(15,rowsA.length);i++){
    const {map, hits, alts} = mapHeader(rowsA[i]);
    if (hits>=2 && (map.addr!==undefined || map.name!==undefined)){ hIdx=i; hMap=map; hAlts=alts; break; }
  }
  let dataRows, map;
  const context = { sender:'', senderPhone:'' };   // #444: 서문 「보내는사람 : ○○」·「보내는 사람」 구간 → 보내는이 자동 채움 재료
  const preRows = hIdx>=0 ? rowsA.slice(0, hIdx) : [];
  if (hIdx>=0){ dataRows = rowsA.slice(hIdx+1); map = hMap; }
  else { dataRows = rowsA; map = guessColumns(rowsA); }
  if (map.addr===undefined && map.phone===undefined && map.name===undefined) return [];
  // #444: 같은 이름 헤더가 2개(예: 「수량」·「보내는 사람 연락처」)면 첫 열이 통째로 비었을 때만 데이터 있는 다음 열로
  if (hAlts){
    for (const f of Object.keys(hAlts)){
      if (hAlts[f].length < 2 || map[f] === undefined) continue;
      const hasData = c => dataRows.some(r => String(r[c]??'').trim() !== '');
      if (!hasData(map[f])){ const alt = hAlts[f].find(c => c !== map[f] && hasData(c)); if (alt !== undefined) map[f] = alt; }
    }
  }
  const usedCols = new Set(Object.values(map));
  // 서문(헤더 위) 보내는이 인식 — 라벨:값 한 셀 / 라벨 셀 + 값 셀
  const pickSenderFromCells = (cells, label) => {
    const vals = cells.map(c=>String(c??'').trim()).filter(Boolean);
    for (const v of vals){ const m = v.match(RE_PRE_SENDER); if (m){ return m[m.length-1]; } }
    if (label){ const li = cells.findIndex(c=>RE_PRE_SENDER_LBL.test(String(c??'').replace(/\s+/g,' ').trim())); if (li>=0){ const v = cells.slice(li+1).map(c=>String(c??'').trim()).find(Boolean); if (v) return v; } }
    return '';
  };
  const takeSender = (raw, cells) => {
    if (context.sender) return;
    const all = cells ? cells.join(' ') : String(raw||'');
    const pm = all.match(RE_PHONE_ANY);
    if (pm && !context.senderPhone) context.senderPhone = glob.akNormPhone(pm[0]);
    let nm = '';
    if (cells){ nm = cells.find(c => /^[가-힣]{2,5}$/.test(c)) || cells.find(c => !RE_PHONE_ANY.test(c) && glob.akAddressScore(c) < 4) || ''; }
    else nm = String(raw||'').replace(RE_PHONE_ANY,'').replace(/[\/,|]+/g,' ').replace(/\s{2,}/g,' ').trim();
    if (nm) context.sender = nm.trim();
  };
  for (const r of preRows){
    const s = pickSenderFromCells(r, true);
    if (s){ takeSender(s); continue; }
    const cells = r.map(c=>String(c??'').trim());
    const li = cells.findIndex(c=>RE_PRE_PHONE_LBL.test(c));
    if (li>=0 && !context.senderPhone){ const v = cells.slice(li+1).find(c=>RE_PHONE_ANY.test(c)); if (v) context.senderPhone = glob.akNormPhone(v.match(RE_PHONE_ANY)[0]); }
  }
  const orders = [];
  let mode = 'recipient';   // 「보내는 사람」 표식 아래 = sender 구간(주문 아님), 「받는 사람」 표식 아래 = 주문
  for (const r of dataRows){
    const nonEmpty = r.map(c=>String(c??'').trim()).filter(Boolean);
    // #444: 단독 셀 구간 표식 「보내는 사람」/「받는 사람」 — 행 자체는 주문이 아님
    if (nonEmpty.length === 1){
      const t = nonEmpty[0].replace(/\s+/g,' ');
      if (RE_MARK_SENDER.test(t)){ mode = 'sender'; continue; }
      if (RE_MARK_RECIP.test(t)){ mode = 'recipient'; continue; }
      const s = pickSenderFromCells(r, false);
      if (s){ takeSender(s); continue; }   // 「보내는사람 : ○○」 한 줄
    }
    if (mode === 'sender'){ takeSender('', nonEmpty); continue; }
    // #444: 한 셀에 「이름 전화 주소」가 통째로 적힌 줄(헤더 밖 메모 줄) → 자유 텍스트 파서로 그 셀 안에서만 분리(같은 셀 = 같은 줄)
    if (nonEmpty.length === 1 && RE_PHONE_ANY.test(nonEmpty[0]) && glob.akAddressScore(nonEmpty[0]) >= 4 && typeof glob.akParseOrders === 'function'){
      try {
        const p = glob.akParseOrders(nonEmpty[0]).orders;
        if (p.length === 1 && (p[0].addr || p[0].phone)){
          orders.push({ name:p[0].name||'', phone:p[0].phone||'', phone2:p[0].phone2||'', addr:p[0].addr||'', product:p[0].product||'', qty:p[0].qty||'', memo:p[0].memo||'', sender:'', senderPhone:'' });
          continue;
        }
      } catch(e){ /* 종전 경로로 */ }
    }
    const get = f => map[f]!==undefined ? String(r[map[f]]??'').trim() : '';
    // 수취인명에는 수취인(성명)만. 성명이 비어있을 때만 업체명으로 대체
    const nm = get('name') || get('company');
    const rec = {
      name: nm, phone: glob.akNormPhone(get('phone')), phone2: glob.akNormPhone(get('phone2')),
      addr: get('addr'), product: get('product'), qty: (get('qty').match(/\d+/)||[''])[0],
      memo: get('memo'), sender: get('sender'), senderPhone: glob.akNormPhone(get('senderPhone')),
    };
    // #444: 헤더 없는 표 — 전화가 행마다 다른 열에 있을 때: 같은 행의 전화 모양 셀(주소·이름 열 제외)을 순서대로 연락처1·2로. 상세만 적힌 셀(「301동 503호」)은 같은 행 주소 뒤에 붙임. 헤더 있는 표는 종전 그대로(줄 정합 원칙 — 다른 행은 절대 안 본다)
    if (hIdx < 0){
      const cells = r.map((c,ci)=>({c:String(c??'').trim(),ci})).filter(x=>x.c && x.ci!==map.addr && x.ci!==map.name);
      const isPhoneCell = c => /^[\d\-.\s()]+$/.test(c) && /^\(?0/.test(c) && c.replace(/\D/g,'').length <= 12 && c.replace(/\D/g,'').length >= 9;   // 셀 전체가 0으로 시작하는 번호일 때만(「1050805650」 같은 숫자 메모 제외)
      const phones = cells.filter(x=>isPhoneCell(x.c));
      if (phones.length || !isPhoneCell(rec.phone)){
        rec.phone  = phones[0] ? glob.akNormPhone(phones[0].c.match(RE_PHONE_ANY)[0]) : '';
        rec.phone2 = phones[1] ? glob.akNormPhone(phones[1].c.match(RE_PHONE_ANY)[0]) : '';
      }
      const details = cells.filter(x=>!isPhoneCell(x.c) && RE_DETAIL_CELL.test(x.c));
      for (const d of details){ if (rec.addr && !rec.addr.includes(d.c)) rec.addr = rec.addr.replace(/\s+$/,'') + ' ' + d.c; }
      for (const f of ['product','memo']){ if (isPhoneCell(rec[f]) || details.some(d=>d.c===rec[f])) rec[f] = ''; }
    }
    // #444: 「이어쓴 아랫줄」(이름·전화 없이 주소 조각/메모/상품만) → 바로 윗줄에 합침. 주소가 온전한 새 주소면 종전대로 별도 행(줄 정합 원칙 — 다른 사람 주소를 섞지 않는다)
    const prev = orders[orders.length-1];
    if (prev && !rec.name && !rec.phone && (!rec.addr || isAddrFragment(rec.addr))){
      let merged = false;
      if (rec.addr){ prev.addr = (prev.addr ? prev.addr + ' ' : '') + rec.addr; merged = true; }
      if (rec.memo && rec.memo !== prev.memo){ prev.memo = (prev.memo ? prev.memo + ' ' : '') + rec.memo; merged = true; }
      if (rec.product && rec.product !== prev.product && !(prev.product||'').includes(rec.product)){ prev.product = (prev.product ? prev.product + ' ' : '') + rec.product; merged = true; }
      if (merged) continue;
    }
    if (rec.addr || rec.phone || rec.name) orders.push(rec);
  }
  orders.context = context;   // 배열에 부가(기존 호출부 호환)
  // 번호(1,2,3…) 컬럼이 수량으로 잘못 잡힌 경우 제거
  if (orders.length >= 4){
    const qs = orders.map(o=>parseInt(o.qty,10));
    if (qs.every(v=>!isNaN(v))){
      let seq = true;
      for (let i=1;i<qs.length;i++){ if (qs[i] !== qs[i-1]+1){ seq=false; break; } }
      if (seq) orders.forEach(o=>{ o.qty=''; });
    }
  }
  return orders;
}
/* 시트별로 분리해 반환 — 원본 행 순서 그대로 유지 */
function extractSheetWb(wb){
  const sheets = [];
  for (const sname of wb.SheetNames){
    const aoa = XU().utils.sheet_to_json(wb.Sheets[sname], {header:1, raw:false, defval:''});
    const orders = parseAoa(aoa);
    if (orders.length) sheets.push({ name: sname, orders, usedHeader: true });
  }
  if (!sheets.length) throw new Error('표에서 주문을 찾지 못했어요. 텍스트로 복사해서 붙여넣어보세요');
  return { sheets, orders: sheets.length===1 ? sheets[0].orders : [].concat(...sheets.map(s=>s.orders)) };
}

/* ---------- 통합 진입점 ---------- */
function decodeText(u8){
  let t = new TextDecoder('utf-8').decode(u8);
  if (/�/.test(t)){                       // 깨진 글자 → 한글 완성형(EUC-KR/CP949) 재시도
    try { t = new TextDecoder('euc-kr').decode(u8); } catch(e){}
  }
  return t;
}
async function extractFile(file){
  const name = (file.name||'').toLowerCase();
  const u8 = new Uint8Array(await file.arrayBuffer());
  if (/\.(csv|tsv)$/.test(name)){
    const wb = XU().read(decodeText(u8), {type:'string'});
    return { type:'sheet', ...extractSheetWb(wb) };
  }
  if (/\.(xlsx|xls)$/.test(name)) return { type:'sheet', ...extractSheet(u8, name) };
  if (/\.hwpx$/.test(name)) return { type:'text', text: extractHwpx(u8) };
  if (/\.hwp$/.test(name))  return { type:'text', text: extractHwp(u8) };
  if (/\.docx$/.test(name)) return { type:'text', text: extractDocx(u8) };
  if (/\.(txt|md)$/.test(name)) return { type:'text', text: decodeText(u8) };
  // 확장자 불명 → 시그니처로
  if (u8[0]===0x50 && u8[1]===0x4B){ // zip
    try { return { type:'text', text: extractHwpx(u8) }; } catch(e){}
    try { return { type:'text', text: extractDocx(u8) }; } catch(e){}
    return { type:'sheet', ...extractSheet(u8, name) };
  }
  if (u8[0]===0xD0 && u8[1]===0xCF) return { type:'text', text: extractHwp(u8) };
  return { type:'text', text: decodeText(u8) };
}

function toU8(c){ return c instanceof Uint8Array ? c : new Uint8Array(c); }

glob.akExtractFile = extractFile;
glob.akParseAoa = parseAoa;
glob.__akExtract = { extractHwpx, extractDocx, extractHwp, extractSheet };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== 주문 정리기 파서 (지시 #395 이식 — 원본: 주문정리기/parser.js v2.4, 로직 무수정·IIFE 래핑만) ===== */
(function(glob){
/* ===== 아꼼이네 주문 파서 ===== */
const AKKOM_REGIONS = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라북도','전라남도','경상북도','경상남도','제주특별자치도','서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
const RE_REGION_START = new RegExp('^(' + AKKOM_REGIONS.join('|') + ')');

const RE_PHONE = /(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;
const RE_TEL   = /(0\d{1,2})[-.\s]?(\d{3,4})[-.\s]?(\d{4})/g;
const RE_NUMBERED = /^\s*\d{1,3}(?:[.)]\s*|\s+(?=[가-힣A-Za-z]))/;
const RE_PRODUCT_WORD = /((?:미니)?(?:밤)?호박|단호박|한라봉|천혜향|레드향|황금향|카라향|진지향|감귤|노지귤|타이벡|귤|옥수수|당근|비트|브로콜리|양배추|마늘|감자|고구마|샤인|딸기|블루베리)/;
const RE_MEMO_START = /(문\s?앞|경비실|택배함|무인\s?함|부재\s?시|파손\s?주의|배송\s?전|놓아\s?주|놔\s?주|맡겨|연락\s?주|전화\s?주|조심|주의)/;

function akNormPhone(m){
  const digits = String(m).replace(/\D/g,'');
  if (digits.length === 11) return digits.slice(0,3)+'-'+digits.slice(3,7)+'-'+digits.slice(7);
  if (digits.length === 10) {
    if (digits.startsWith('02')) return digits.slice(0,2)+'-'+digits.slice(2,6)+'-'+digits.slice(6);
    return digits.slice(0,3)+'-'+digits.slice(3,6)+'-'+digits.slice(6);
  }
  return m;
}

function akAddressScore(line){
  let s = 0;
  const t = (line||'').trim();
  if (!t) return 0;
  for (const r of AKKOM_REGIONS){
    if (t.startsWith(r)) { s += 4; break; }
    if (t.includes(' '+r) || t.includes(r+'시 ') || t.includes(r+'도 ')) { s += 2; break; }
  }
  if (/[가-힣A-Za-z0-9]+(로|길)\s?\d+/.test(t)) s += 3;
  if (/(읍|면|동|리|가)\s?\d+(-\d+)?/.test(t)) s += 2;
  if (/(\d+동\s?\d+호|\d+호|\d+층|아파트|빌라|오피스텔|빌딩|타워)/.test(t)) s += 1;
  if (/(시|군|구)\s/.test(t)) s += 1;
  if (/번지/.test(t)) s += 1;
  return s;
}

function akStripLabel(line){
  const m = line.match(/^\s*[\*\-•▶☞#\s]*([가-힣a-zA-Z0-9()\/]{1,12})\s*[:：]\s*(.*)$/);
  if (m) return { label: m[1].replace(/\s/g,''), value: m[2].trim() };
  return null;
}

const LBL = {
  name:    /^(이름|성함|받는분|받는사람|수취인|수령인|수신자|수취인명)$/,
  phone:   /^(연락처|전화|전화번호|폰|휴대폰|핸드폰|HP|hp|번호|수취인연락처|연락처1)$/,
  phone2:  /^(연락처2|전화2|수취인연락처2)$/,
  addr:    /^(주소|배송지|배송주소|받는주소|수령지|도착지)$/,
  product: /^(상품|상품명|옵션|옵션정보|품목|제품|구성|주문내역)$/,
  qty:     /^(수량|개수|박스수|갯수)$/,
  memo:    /^(요청|요청사항|메모|배송메모|배송메세지|배송메시지|배송요청|부탁|비고)$/,
  sender:  /^(보내는사람|보내는분|보내는이|주문자|입금자|구매자|발송인)$/,
};
const RE_SENDER_INLINE = /(입금자|주문자|구매자|발송인|보내는\s?(?:사람|분|이))\s*[:：]?\s*([가-힣]{2,5})(?:\s*[\/,]?\s*(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}))?/;
const RE_POLITE_TAIL = /(보내\s?주세요|보내주시면 감사|부탁드립니다|부탁드려요|부탁해요|부탁드릴게요|주문합니다|주문할게요|주문이요|요청합니다|감사합니다)[.!~^\s]*$/;
const RE_ROLE_PREFIX = /^(수취인|받는분|받는사람|이름|성함|수령인|수신자)\s*/;

function akIsNameLike(t){
  if (!t) return false;
  const clean = t.replace(/(님|씨|귀하|앞|드림)$/,'').trim();
  return /^[가-힣]{2,5}$/.test(clean) && !AKKOM_REGIONS.includes(clean) &&
    !RE_PRODUCT_WORD.test(clean) &&
    !/(배송|주문|입금|확인|감사|안녕|주소|연락|전화|수량|상품|옵션|합계|총|박스|세트|계좌|농협|국민|신한|우리|하나|카카오|선물용|가정용|특품)/.test(clean) &&
    !/^(대표|사장|이사|부장|과장|팀장|원장|소장|실장|주임|대리|고문|전무|상무)(님)?$/.test(clean) &&
    !/^(아니고|그리고|혹은|또는|해서|하고|에서|으로|까지|부터)$/.test(clean);
}
function akExtractName(t){
  let s = (t||'').replace(/(님|귀하|앞|드림)$/,'').trim();
  if (/씨$/.test(s) && s.length <= 4) s = s.slice(0,-1);   // "김철수씨"→김철수, "태광이앤씨"는 상호라 유지
  return s;
}

const RE_REGION_MID = new RegExp('(?:^|\\s)(' + AKKOM_REGIONS.join('|') + ')');
function akPickNameFromTokens(toks){
  for (let k = toks.length-1; k >= 0; k--){
    let tk = akExtractName(toks[k].replace(/^[('"（\[]+|[)'"）\]]+$/g,'').replace(RE_ROLE_PREFIX,''));
    if (akIsNameLike(tk)) return tk;
  }
  const last = toks[toks.length-1];
  if (last && /^[가-힣A-Za-z0-9()（）·&]{2,20}$/.test(last) && !/^\d+$/.test(last) &&
      akAddressScore(last)===0 && !RE_PRODUCT_WORD.test(last) &&
      !/^(대표|사장|이사|부장|과장|팀장)(님)?$/.test(last)) return last;
  return '';
}
/* 주소 문자열 정돈: 앞의 이름/상호, 뒤의 상품 문구 분리 */
function akCleanAddr(addr, rec){
  let a = addr.trim().replace(/^\d{1,3}\s+(?=[가-힣A-Za-z(（])/,'');   // 행번호 제거
  // 지역명(서울/부산/경기도…)이 중간에서 시작하면 그 앞은 이름·상호로 분리
  const rm = a.match(RE_REGION_MID);
  if (rm && rm.index > 0){
    const cutAt = rm.index + rm[0].indexOf(rm[1]);
    const pre = a.slice(0, cutAt).trim();
    const rest = a.slice(cutAt).trim();
    if (pre.length <= 40 && akAddressScore(rest) >= 4 && akAddressScore(pre) <= 1){
      if (!rec.name){
        const nm = akPickNameFromTokens(pre.split(/[\s\/,]+/).filter(Boolean));
        if (nm) rec.name = nm;
      }
      a = rest;
    }
  }
  // 앞쪽 이름·상호 (예: "김성종(태신스틸) 서울…", "에스제이본구조 경기도…", "박동환 대표 경기도…")
  for (let pass=0; pass<2; pass++){
    const lead = a.match(/^([가-힣A-Za-z0-9()（）·&]{2,20})\s+(.+)$/);
    if (!lead) break;
    const cand = lead[1], rest = lead[2];
    if (/^\d+$/.test(cand)) break;                       // 순수 숫자는 건물번호일 수 있음
    if (akAddressScore(cand) > 0) break;                 // 지역명이면 주소의 일부
    if (cand.length <= 5 && /(시|군|구)$/.test(cand)) break;                    // "창원시" 등 행정구역
    if (cand.length <= 5 && /(읍|면|동|리|로|길)$/.test(cand) && !RE_REGION_START.test(rest)) break; // "운암동 69…" 같은 동 시작 주소 (단, 뒤가 지역명으로 시작하면 이름으로 인정)
    if (RE_PRODUCT_WORD.test(cand)) break;
    if (akAddressScore(rest) < 4) break;
    if (!rec.name) rec.name = akExtractName(cand);
    else if (/^(대표|사장|이사|부장|과장|팀장|원장|소장)(님)?$/.test(cand)) { /* 직함은 버림 */ }
    else break;
    a = rest;
  }
  // 뒤쪽 상품/가격 문구 (과일·농산물 키워드, 가격, 무게부터 끝까지)
  const cutRes = [RE_PRODUCT_WORD, /\d{1,3}(?:,\d{3})+\s*원/, /\d+\s*원짜리/, /\d+\s*(?:키로|킬로|kg|Kg|KG)/];
  let cut = -1;
  for (const re of cutRes){ const i = a.search(re); if (i > 8 && (cut === -1 || i < cut)) cut = i; }
  if (cut > 8){
    const head = a.slice(0, cut).trim().replace(/[,\s]+$/,'');
    const tail = a.slice(cut).trim();
    if (akAddressScore(head) >= 4 &&
        /(kg|키로|킬로|박스|세트|개|과|원|호박|한라봉|감귤|귤|천혜향|레드향|황금향)/.test(tail) &&
        !/^[가-힣]*(로|길)\s*\d/.test(tail)){   // "감귤로 31" 같은 도로명은 자르지 않음
      if (!rec.product) rec.product = tail;
      a = head;
    }
  }
  return a.replace(/\s{2,}/g,' ').replace(/[,\s]+$/,'').trim();
}

/* 청크 하나 → 주문 레코드 */
function akParseChunk(lines){
  const rec = { name:'', phone:'', phone2:'', addr:'', product:'', qty:'', memo:'', sender:'', senderPhone:'', leftovers:[] };
  const used = new Array(lines.length).fill(false);

  // 0) "입금자 정만웅" 류 (콜론 없어도, 줄 중간이어도) — 해당 부분만 떼어냄
  lines = lines.map((line,i)=>{
    if (akAddressScore(line) >= 4) return line; // 주소 줄은 건드리지 않음
    const m = line.match(RE_SENDER_INLINE);
    if (m && akIsNameLike(m[2])){
      rec.sender = akExtractName(m[2]);
      if (m[3]) rec.senderPhone = akNormPhone(m[3]);
      const rest = line.replace(m[0],'').replace(/[.,\s]+$/,'').trim();
      if (!rest){ used[i]=true; return line; }
      return rest;
    }
    return line;
  });

  // 1) 라벨 있는 줄
  lines.forEach((line,i)=>{
    if (used[i]) return;
    const lab = akStripLabel(line);
    if (!lab) return;
    const {label, value} = lab;
    if (LBL.name.test(label) && value){
      rec.name = akExtractName(value.replace(RE_PHONE,'').replace(/[()（）]/g,'').split(/[\/,]/)[0]);
      const pm = value.match(RE_PHONE); if (pm && !rec.phone) rec.phone = akNormPhone(pm[0]);
      used[i]=true;
    }
    else if (LBL.phone2.test(label) && value){ const pm=value.match(RE_PHONE)||value.match(RE_TEL); if(pm) rec.phone2=akNormPhone(pm[0]); used[i]=true; }
    else if (LBL.phone.test(label) && value){ const pm=value.match(RE_PHONE)||value.match(RE_TEL); if(pm && !rec.phone) rec.phone=akNormPhone(pm[0]); used[i]=true; }
    else if (LBL.addr.test(label) && value){ rec.addr = value; used[i]=true; }
    else if (LBL.product.test(label) && value){ rec.product = rec.product ? rec.product+' / '+value : value; used[i]=true; }
    else if (LBL.qty.test(label) && value){ const qm=value.match(/\d+/); if(qm) rec.qty=qm[0]; used[i]=true; }
    else if (LBL.memo.test(label) && value){ rec.memo = rec.memo ? rec.memo+' '+value : value; used[i]=true; }
    else if (LBL.sender.test(label) && value){
      rec.sender = akExtractName(value.replace(RE_PHONE,'').replace(/[()（）,\/]/g,' ').trim());
      const pm = value.match(RE_PHONE); if (pm) rec.senderPhone = akNormPhone(pm[0]);
      used[i]=true;
    }
  });

  // 2) 주소 줄 (라벨 없이)
  if (!rec.addr){
    let best=-1, bestScore=1;
    lines.forEach((line,i)=>{
      if (used[i]) return;
      const sc = akAddressScore(line.replace(RE_PHONE,'').replace(RE_NUMBERED,''));
      if (sc > bestScore){ best=i; bestScore=sc; }
    });
    if (best>=0){
      let addr = lines[best].replace(RE_NUMBERED,'').trim();
      const pm = addr.match(RE_PHONE);
      if (pm){ if(!rec.phone) rec.phone = akNormPhone(pm[0]); addr = addr.replace(RE_PHONE,'').trim(); }
      // 일반전화(062-974-1603 등)가 주소 줄에 섞인 경우
      const tm = addr.match(/(^|[\s,])(0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4})(?=[\s,]|$)/);
      if (tm){ if(!rec.phone) rec.phone = akNormPhone(tm[2]); addr = addr.replace(tm[2],' ').trim(); }
      used[best]=true;
      const nxt = best+1;
      if (nxt < lines.length && !used[nxt] && /^([가-힣A-Za-z0-9]*\s?\d+동\s?\d+호|\d+호|\d+층)\s*$/.test(lines[nxt].trim())){
        addr += ' ' + lines[nxt].trim(); used[nxt]=true;
      }
      rec.addr = addr;
    }
  }
  if (rec.addr) rec.addr = akCleanAddr(rec.addr, rec);

  // 3) 전화 (라벨 없이)
  lines.forEach((line,i)=>{
    const matches = [...line.matchAll(RE_PHONE)];
    if (!matches.length) return;
    matches.forEach(m=>{
      const p = akNormPhone(m[0]);
      if (p === rec.senderPhone) return;
      if (!rec.phone) rec.phone = p;
      else if (!rec.phone2 && p !== rec.phone) rec.phone2 = p;
    });
    if (used[i]) return;
    if (!rec.name){
      RE_PHONE.lastIndex = 0;
      const pi = line.search(RE_PHONE);
      let zone = (pi > 0 ? line.slice(0, pi) : line.replace(RE_PHONE,' ')).replace(RE_NUMBERED,'').trim();
      const nm = akPickNameFromTokens(zone.split(/[\s\/,]+/).filter(Boolean));
      if (nm) rec.name = nm;
    }
    if (akAddressScore(line) < 4) used[i]=true;
  });

  // 4) 이름 (라벨 없이)
  if (!rec.name){
    for (let i=0;i<lines.length;i++){
      if (used[i]) continue;
      const t = lines[i].replace(RE_NUMBERED,'').replace(RE_ROLE_PREFIX,'').trim();
      if (akIsNameLike(t)){ rec.name = akExtractName(t); used[i]=true; break; }
    }
  }

  // 5) 수량/메모/상품 추정
  lines.forEach((line,i)=>{
    if (used[i]) return;
    let t = line.replace(RE_NUMBERED,'').trim();
    if (!t){ used[i]=true; return; }
    if (!rec.qty){
      const qm = t.match(/(?:수량\s*[:：]?\s*)?(\d+)\s*(개(?!입)|박스|box|BOX|세트|건)/) || t.match(/[xX×]\s*(\d+)/);
      if (qm && t.length < 40) rec.qty = qm[1];
    }
    // 메모 부분 분리
    const mi = t.search(RE_MEMO_START);
    if (mi >= 0 && akAddressScore(t) < 3){
      const memoPart = t.slice(mi).trim();
      rec.memo = rec.memo ? rec.memo+' '+memoPart : memoPart;
      t = t.slice(0, mi).trim().replace(/[,·\-\s]+$/,'');
      used[i]=true;
      if (!t) return;
    }
    if ((RE_PRODUCT_WORD.test(t) || /(kg|Kg|KG|키로|박스|세트|개입|특품|선물용|가정용|혼합|중과|대과|소과|로얄과)/.test(t)) && akAddressScore(t) < 3){
      t = t.replace(RE_POLITE_TAIL,'').replace(/[.,\s]+$/,'').trim();
      if (t) rec.product = rec.product ? rec.product+' / '+t : t;
      used[i]=true; return;
    }
    if (!used[i]) rec.leftovers.push(t);
  });

  // 상품 문구에서 수량 보충
  if (!rec.qty && rec.product){
    const qm = rec.product.match(/(\d+)\s*(개(?!입)|박스|box|BOX|세트|건)/);
    if (qm) rec.qty = qm[1];
  }
  rec.hasCore = !!(rec.addr || rec.phone || rec.name);
  rec.hasContext = !!(rec.product || rec.qty || rec.memo || rec.sender || rec.senderPhone);
  return rec;
}

/* 전체 텍스트 → { orders, context } */
function akParseOrders(raw){
  const text = (raw||'').replace(/[​﻿]/g,'').replace(/\r\n?/g,'\n')
    .replace(/[，]/g,',').replace(/[：]/g,':');
  let lines = text.split('\n').map(l=>l.trim());
  lines = lines.map(l=> /^[-=~_*·•─━.\s]{3,}$/.test(l) ? '' : l );

  const chunks = [];
  let cur = [];
  const flush = ()=>{ if (cur.length){ chunks.push(cur); cur=[]; } };
  const numbered = lines.filter(l=>RE_NUMBERED.test(l)).length >= 2;
  for (const line of lines){
    if (line === ''){ flush(); continue; }
    if (numbered && RE_NUMBERED.test(line) && cur.length){ flush(); }
    cur.push(line);
  }
  flush();

  // 청크 안에 주소 2개 이상이면 재분할
  const finalChunks = [];
  for (const ch of chunks){
    const addrIdx = ch.map((l,i)=> akAddressScore(l)>=4 ? i : -1).filter(i=>i>=0);
    if (addrIdx.length >= 2){
      let start = 0;
      for (let k=0;k<addrIdx.length;k++){
        const end = (k+1<addrIdx.length) ? akSplitPoint(ch, addrIdx[k], addrIdx[k+1]) : ch.length;
        finalChunks.push(ch.slice(start,end));
        start = end;
      }
    } else finalChunks.push(ch);
  }

  const orders = [];
  const context = { product:'', qty:'', memo:'', sender:'', senderPhone:'' };
  for (const ch of finalChunks){
    const r = akParseChunk(ch);
    if (!r) continue;
    if (r.hasCore) orders.push(r);
    else if (r.hasContext){
      if (r.product && !context.product) context.product = r.product;
      if (r.qty && !context.qty) context.qty = r.qty;
      if (r.memo && !context.memo) context.memo = r.memo;
      if (r.sender && !context.sender) context.sender = r.sender;
      if (r.senderPhone && !context.senderPhone) context.senderPhone = r.senderPhone;
      // 남은 문구 중 상품스러운 것
      if (!context.product && r.leftovers.length){
        const p = r.leftovers.find(t=>RE_PRODUCT_WORD.test(t));
        if (p) context.product = p;
      }
    }
  }
  // 컨텍스트를 각 주문에 보충
  for (const o of orders){
    if (!o.product && context.product) o.product = context.product;
    if (!o.qty && context.qty) o.qty = context.qty;
    if (!o.sender && context.sender) o.sender = context.sender;
    if (!o.senderPhone && context.senderPhone) o.senderPhone = context.senderPhone;
  }
  return { orders, context };
}

function akSplitPoint(lines, a, b){
  let cut = b;
  for (let i=b-1; i>a; i--){
    const t = lines[i];
    const hasPhone = RE_PHONE.test(t); RE_PHONE.lastIndex=0;
    if (hasPhone || akIsNameLike(t.replace(RE_NUMBERED,'').replace(RE_ROLE_PREFIX,'').trim())) cut = i;
    else break;
  }
  return cut;
}


glob.akParseOrders = akParseOrders;
glob.akAddressScore = akAddressScore;
glob.akNormPhone = akNormPhone;
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = { akParseOrders: globalThis.akParseOrders, akAddressScore: globalThis.akAddressScore, akNormPhone: globalThis.akNormPhone };

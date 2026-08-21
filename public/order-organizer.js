/* ===== 주문 정리기 (지시 #395 이식 — 원본: 주문정리기/app_template.html v2.4) =====
   이식 원칙: 파싱·검증·엑셀 로직은 원형 무수정. 바뀐 것은 통신층(juso JSONP → 서버 프록시 fetch)·
   설정 저장(localStorage → 서버 공용)·OCR 로딩(내장 base64 → /vendor lazy-load, 전처리 로직은 원형 유지)·
   id 접두사(oo — 기존 화면과 충돌 방지)·toast(기존 showToast 재사용)뿐.
   🔴 업무 규칙(대표 확정 — README 5번): ①애매하면 자동 확정 금지(원문 그대로 1건일 때만 자동 ✅)
   ②"원본 그대로 두기"는 상태를 바꾸지 않음 ③수취인명에는 수취인만 ④보내는이 미입력 시 공란
   ⑤시트는 원본 행 순서 유지·순번 컬럼 수량 취급 금지 ⑥모달은 ✕/취소로만 닫힘 ⑦헤더 공백 무시·앞 60열만 */
(function(){
'use strict';
const $ = s => document.querySelector(s);
const DEFAULTS = {
  origin: '제주특별자치도 제주시 연삼로 1066-31, 제주아꼼이네',
  memo: '고객님의 소중한 물건으로 파손주의 부탁드리겠습니다.!',
  channel: '현금/단체주문',
};
let settings = {...DEFAULTS};
let srvJusoKey = true;   // 서버 승인키 유무 (설정 로드 시 갱신 — 로드 전엔 막지 않음: 검증 시 NOKEY로 걸러짐)
let rows = []; // {name, phone, phone2, addr, product, qty, memo, sender, senderPhone, status, zip, candidates, detail}

const pageActive = () => { const p = document.getElementById('page-organizer'); return p && p.classList.contains('active'); };
function toast(msg, type){ if (typeof showToast === 'function') showToast(msg, type); }

/* ---------- 설정 (출고지·배송메세지·주문경로 = 전 직원 공용 서버 저장 · 보내는이 3칸은 건별 입력) ---------- */
function loadSettingsUI(){
  $('#ooSetOrigin').value = settings.origin;
  $('#ooSetMemo').value = settings.memo;
  $('#ooSetChannel').value = settings.channel;
  $('#ooApikeyWarn').classList.toggle('show', !srvJusoKey);
}
let _settingsLoaded = false;
async function loadServerSettings(){
  try {
    const v = await api('/api/agent-office/organizer-settings');
    srvJusoKey = v._jusoKey !== false;
    for (const k of Object.keys(DEFAULTS)){ if (v[k]) settings[k] = v[k]; }
    _settingsLoaded = true;
  } catch(e){ /* 로드 실패 시 기본값으로 동작 */ }
  loadSettingsUI();
}
window.ooInitOrganizer = function(){   // switchPage 진입 훅 — 설정 1회 로드
  if (!_settingsLoaded) loadServerSettings();
};
$('#ooBtnSettings').onclick = ()=> $('#ooSettingsPanel').classList.toggle('open');
$('#ooBtnSaveSettings').onclick = async ()=>{
  settings.origin = $('#ooSetOrigin').value.trim() || DEFAULTS.origin;
  settings.memo = $('#ooSetMemo').value.trim();
  settings.channel = $('#ooSetChannel').value.trim();
  try {
    await api('/api/agent-office/organizer-settings', 'PUT', settings);
    toast('설정을 저장했어요 (전 직원 공용) ✅', 'lime');
    $('#ooSettingsPanel').classList.remove('open');
  } catch(e){ toast('설정 저장 실패: ' + e.message); }
  loadSettingsUI();
};
$('#ooBtnResetSettings').onclick = ()=>{ settings = {...DEFAULTS}; loadSettingsUI(); };

/* ---------- 주문 추가 공통 (원형) ---------- */
function addOrders(orders, opts={}){
  const oName = $('#ooOrdererName').value.trim();
  const oPhone = $('#ooOrdererPhone').value.trim();
  const newRows = orders.map(o=>{
    let senderName, senderPhone;
    if (opts.senderComplete && o.sender){        // 파일·표에 보내는사람이 이미 있으면 그대로
      senderName = o.sender; senderPhone = o.senderPhone || oPhone || '';
    } else if (oName){                           // 보내는이 입력값 그대로 (자동으로 아무것도 안 붙임)
      senderName = oName; senderPhone = oPhone || o.senderPhone || '';
    } else if (o.sender){                        // 텍스트에서 찾은 입금자도 그대로
      senderName = o.sender; senderPhone = o.senderPhone || '';
    } else {
      senderName = ''; senderPhone = '';       // 보내는이 미입력 시 공란
    }
    return {
      name: o.name || '', phone: o.phone || '', phone2: o.phone2 || '',
      addr: o.addr || '', product: o.product || '', qty: o.qty || '1',
      memo: o.memo || '', sender: senderName, senderPhone: senderPhone,
      status: 'idle', zip: '', candidates: null,
    };
  });
  rows = rows.filter(r=>r.addr||r.name||r.phone).concat(newRows);
  render();
  return newRows.length;
}

/* ---------- 텍스트 파싱 (원형) ---------- */
/* 엑셀에서 복사한 표(탭 구분)는 열 기준으로 정확히 해석 */
function tryParseTSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  const tabbed = lines.filter(l=>l.split('\t').length >= 3);
  if (tabbed.length < 2 || tabbed.length < lines.length * 0.6) return null;
  try {
    const orders = akParseAoa(lines.map(l=>l.split('\t').map(c=>c.trim())));
    return orders.length ? orders : null;
  } catch(e){ return null; }
}
function parseText(raw, {silent}={}){
  if (!raw.trim()){ toast('주문 내용을 먼저 붙여넣어주세요'); return 0; }
  const tsv = tryParseTSV(raw);
  if (tsv){
    const n = addOrders(tsv, {senderComplete:true});
    toast(`표 형태로 인식해서 ${n}건 정리했어요! 열이 잘 들어갔는지 확인해주세요`);
    return n;
  }
  const { orders, context } = akParseOrders(raw);
  if (!orders.length){ if(!silent) toast('주문을 찾지 못했어요. 형식을 확인해주세요 🥲'); return 0; }
  if (context.sender && !$('#ooOrdererName').value) $('#ooOrdererName').value = context.sender;
  if (context.senderPhone && !$('#ooOrdererPhone').value) $('#ooOrdererPhone').value = context.senderPhone;
  const n = addOrders(orders);
  toast(`${n}건 정리 완료! 이제 [전체 주소 검증]을 눌러주세요`);
  return n;
}
$('#ooBtnParse').onclick = ()=> parseText($('#ooRawInput').value);

/* 보내는이 연락처: 하이픈 자동 입력 (원형 — 010-XXXX-XXXX / 016-XXX-XXXX / 02-XXX-XXXX 모두 지원) */
function fmtPhoneLive(v){
  const d = v.replace(/\D/g,'').slice(0,11);
  if (d.startsWith('02')){
    if (d.length <= 2) return d;
    if (d.length <= 5) return d.slice(0,2)+'-'+d.slice(2);
    if (d.length <= 9) return d.slice(0,2)+'-'+d.slice(2,5)+'-'+d.slice(5);
    return d.slice(0,2)+'-'+d.slice(2,6)+'-'+d.slice(6,10);
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0,3)+'-'+d.slice(3);
  if (d.length <= 10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
  return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7);
}
$('#ooOrdererPhone').addEventListener('input', e=>{ e.target.value = fmtPhoneLive(e.target.value); });
$('#ooBtnAddRow').onclick = ()=>{
  rows.push({name:'',phone:'',phone2:'',addr:'',product:'',qty:'1',memo:'',sender:'',senderPhone:'',status:'idle',zip:'',candidates:null});
  render();
};
$('#ooBtnSample').onclick = ()=>{
  $('#ooRawInput').value = `한라봉 선물용 5kg씩 보내주세요. 입금자 정만웅 010-9402-0886

1. 정진영 010-8887-3813 경기도 화성시 향남읍 발안로 440-19, 진영화학
2. 오승영 010-5271-3790
경기도 화성시 향남읍 동오1길 19-9 정우테크닉스
3. 김영자 01046127618 전라남도 장성군 북하면 약수리 545-4

받는분 : 박순자
연락처 : 010-4157-3577
서울 강북구 수유동 408-28 3층
문앞에 놓아주세요`;
  toast('예시를 넣었어요. 주문 정리하기를 눌러보세요!');
};

/* ---------- 표 렌더 (원형 — onclick 함수명만 oo 접두사) ---------- */
const FIELDS = ['name','phone','phone2','addr','product','qty','memo','sender','senderPhone'];
function chipHtml(r, i){
  switch(r.status){
    case 'ok': return `<span class="chip ok">확인됨</span>${r.zip?`<span class="zip">우편번호 ${r.zip}</span>`:''}`;
    case 'warn': return `<span class="chip multi" onclick="ooOpenModal(${i})">동·호수 확인</span>${r.zip?`<span class="zip">우편번호 ${r.zip}</span>`:''}`;
    case 'multi': return `<span class="chip multi" onclick="ooOpenModal(${i})">선택필요</span>`;
    case 'fail': return `<span class="chip fail" onclick="ooOpenModal(${i})">확인필요</span>`;
    case 'checking': return `<span class="chip checking">검증중</span>`;
    default: return `<span class="chip idle" onclick="ooVerifyOne(${i})" title="클릭하면 이 주문만 검증해요">미검증 ▶</span>`;
  }
}
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function render(){
  const tb = $('#ooTbody');
  if (!rows.length){
    tb.innerHTML = '<tr><td colspan="12" class="empty-note">위에 주문 내용을 붙여넣고 <b>주문 정리하기</b>를 눌러주세요</td></tr>';
    $('#ooStats').innerHTML=''; return;
  }
  tb.innerHTML = rows.map((r,i)=>`<tr data-i="${i}">
    <td style="color:var(--text-mid)">${i+1}</td>
    <td>${chipHtml(r,i)}</td>
    ${FIELDS.map(f=>`<td contenteditable data-f="${f}" class="${(f==='name'||f==='phone'||f==='addr') && !String(r[f]||'').trim() ? 'missing' : ''}" ${f==='addr'?'style="min-width:280px"':''}>${esc(r[f])}</td>`).join('')}
    <td><button class="del-btn" onclick="ooDelRow(${i})" title="삭제">✕</button></td>
  </tr>`).join('');
  // 편집 반영
  tb.querySelectorAll('td[contenteditable]').forEach(td=>{
    td.addEventListener('blur', e=>{
      const tr = e.target.closest('tr'); const i = +tr.dataset.i; const f = e.target.dataset.f;
      const v = e.target.innerText.trim();
      if (rows[i][f] !== v){
        rows[i][f] = v;
        if (f === 'addr'){ rows[i].status='idle'; rows[i].zip=''; renderStats(); tr.children[1].innerHTML = chipHtml(rows[i], i); }
      }
    });
  });
  renderStats();
}
function renderStats(){
  const n = rows.length;
  const ok = rows.filter(r=>r.status==='ok').length;
  const multi = rows.filter(r=>r.status==='multi'||r.status==='warn').length;
  const fail = rows.filter(r=>r.status==='fail').length;
  $('#ooStats').innerHTML = `<span>총 <b>${n}</b>건</span><span class="g">확인 ${ok}</span><span class="y">선택필요 ${multi}</span><span class="r">확인필요 ${fail}</span><span>미검증 ${n-ok-multi-fail}</span>`;
}
window.ooDelRow = i => { rows.splice(i,1); render(); };

/* ---------- 주소 검증 (통신층만 교체: JSONP → 서버 프록시. 판정 로직은 원형) ---------- */
async function jusoSearch(keyword){
  const data = await api('/api/agent-office/juso?keyword=' + encodeURIComponent(keyword));
  if (data && data.error === 'NOKEY') throw new Error('NOKEY');
  if (data && data.error) throw new Error(data.error);
  return data;
}
const NOKEY_MSG = '주소 검증 승인키가 서버에 등록되지 않았어요 — 대표에게 문의해주세요 (정리·엑셀은 그대로 사용 가능)';
/* 상세주소 띄어쓰기 정돈: "롯데골드로즈2차1108호" → "롯데골드로즈2차 1108호" */
function tidyDetail(d){
  return (d||'').replace(/([가-힣)])(\d+(?:동|호|층|번지))/g, '$1 $2')
                .replace(/(\d+동)(\d+호)/g, '$1 $2')
                .replace(/\s{2,}/g,' ').trim();
}
/* 주소에서 (검색용 본체, 상세) 분리 — 붙여쓴 주소도 처리 (원형) */
function splitAddr(addr){
  let a = addr.trim();
  // 콤마가 있으면: 첫 콤마 뒤가 상세일 확률 높음
  const ci = a.indexOf(',');
  if (ci > 0){
    const head = a.slice(0,ci).trim(), tail = a.slice(ci+1).trim();
    if (/(로|길)\s*\d|(읍|면|동|리|가)\s*\d/.test(head)) return [head, tidyDetail(tail)];
  }
  // 도로명 + 건물번호 추출 ("X로N길" 형태 우선, 띄어쓰기 없어도 인식)
  let m = a.match(/^(.*?)([가-힣A-Za-z0-9·]+로\s*\d+\s*번?길|[가-힣A-Za-z0-9·]+(?:로|길))\s*(\d+(?:-\d+)?)(.*)$/);
  if (m){
    const head = (m[1].trim() + ' ' + m[2].replace(/\s+/g,'') + ' ' + m[3]).trim();
    const tail = (m[4]||'').replace(/^[,\s]+/,'').trim();
    return [head.replace(/\s{2,}/g,' '), tidyDetail(tail)];
  }
  // 지번 뒤를 상세로
  m = a.match(/^(.*?(?:읍|면|동|리|가)\s*\d+(?:-\d+)?)(.*)$/);
  if (m) return [m[1].trim(), tidyDetail((m[2]||'').replace(/^[,\s]+/,''))];
  return [a, ''];
}
async function verifyRow(i){
  const r = rows[i];
  if (!r.addr) { r.status='fail'; r.candidates=[]; return; }
  r.status = 'checking'; render();
  const [body, detail] = splitAddr(r.addr);
  r.detail = detail;
  const tries = [body];
  const words = body.split(/\s+/);
  if (words.length > 2) tries.push(words.slice(1).join(' '));    // 첫 단어(이름 오인 등) 제거 재시도
  if (words.length > 3) tries.push(words.slice(0, words.length-1).join(' ')); // 끝 단어 제거 재시도
  let res = null, errorMsg = '', usedFallback = false;
  for (let t = 0; t < tries.length; t++){
    try {
      const data = await jusoSearch(tries[t]);
      const c = data && data.results && data.results.common;
      if (!c) continue;
      if (c.errorCode !== '0'){ errorMsg = c.errorMessage || c.errorCode; continue; }
      const list = (data.results.juso||[]);
      if (list.length){ res = list; usedFallback = t > 0; break; }
    } catch(e){
      if (e.message === 'NOKEY'){ r.status='idle'; toast(NOKEY_MSG); render(); throw e; }
      errorMsg = e.message;
    }
  }
  // 🔴 원칙(대표 확정): 애매하면 자동 확정하지 않는다. 원문 그대로 검색해 정확히 1건일 때만 자동 확정.
  if (!res){ r.status='fail'; r.candidates=[]; r.errorMsg = errorMsg; }
  else if (usedFallback){ r.status='multi'; r.candidates = res; }   // 주소를 잘라서 찾은 것 → 사람이 확인
  else if (res.length === 1){ applyCandidate(i, res[0], detail); }
  else {
    const uniq = [...new Set(res.map(x=>x.roadAddrPart1 + '|' + x.zipNo))];
    if (uniq.length === 1) applyCandidate(i, res[0], detail);
    else { r.status='multi'; r.candidates = res; }
  }
  render();
}
const RE_APT = /아파트|APT|apt|빌라|빌리지|오피스텔|주공|자이|푸르지오|래미안|e편한|이편한|힐스테이트|캐슬|아이파크|위브|더샵|리슈빌|스위첸|해모로|팰리스|파크뷰|그로브|맨션|타운|APT/;
function applyCandidate(i, j, detail){
  const r = rows[i];
  const d = tidyDetail((detail !== undefined ? detail : r.detail) || '');
  r.addr = j.roadAddrPart1 + (d ? ', ' + d : '');
  r.zip = j.zipNo; r.candidates = null;
  // 아파트·빌라인데 동·호수가 빠졌으면 확인요망
  const full = d + ' ' + (j.bdNm || '');
  const hasHo = /\d+\s*호/.test(d) || /\d{2,4}\s*-\s*\d{2,4}\s*$/.test(d) || /\d+\s*층/.test(d);
  const hasDong = /\d+\s*동(?![가-힣0-9])/.test(d);
  if (!hasHo && (hasDong || RE_APT.test(full))){
    r.status = 'warn'; r.candidates = [j];
  } else {
    r.status = 'ok';
  }
}
window.ooVerifyOne = async i => {
  if (!srvJusoKey){ toast(NOKEY_MSG); return; }
  try { await verifyRow(i); } catch(e){}
};
$('#ooBtnVerifyAll').onclick = async ()=>{
  if (!rows.length){ toast('먼저 주문을 정리해주세요'); return; }
  if (!srvJusoKey){ toast(NOKEY_MSG); return; }
  $('#ooBtnVerifyAll').disabled = true;
  try {
    for (let i=0;i<rows.length;i++){
      if (rows[i].status === 'ok' || rows[i].status === 'warn') continue;
      await verifyRow(i);
      await new Promise(r=>setTimeout(r,150));
    }
    const bad = rows.filter(r=>r.status!=='ok').length;
    toast(bad ? `검증 완료! ${bad}건은 배지를 눌러 확인해주세요` : '모든 주소 확인 완료! ✅');
  } catch(e){ /* NOKEY 등 */ }
  $('#ooBtnVerifyAll').disabled = false;
};

/* ---------- 후보 모달 (원형 — 모달은 ✕/취소로만 닫힘, 바깥 클릭 닫기 없음) ---------- */
let modalIdx = -1;
window.ooOpenModal = async i => {
  modalIdx = i;
  const r = rows[i];
  $('#ooModalOrig').textContent = r.status==='warn'
    ? '주소는 확인됐지만 동·호수가 빠진 것 같아요. 아래 상세주소 칸에 동·호수를 채운 뒤 주소를 클릭하면 확정됩니다. (문제없으면 "원본 그대로 두기")'
    : '입력된 주소: ' + r.addr + (r.errorMsg && r.status==='fail' ? '  (오류: '+r.errorMsg+')' : '');
  $('#ooModalDetail').value = r.detail || '';
  const box = $('#ooModalCands');
  if (r.status === 'fail'){
    box.innerHTML = `<div style="font-size:13px; color:var(--text-mid); margin-bottom:10px;">주소를 찾지 못했어요. 아래에 주소를 다시 입력하고 검색해보세요.</div>
      <input class="detail-edit" id="ooModalRetry" value="${esc(splitAddr(r.addr)[0])}">
      <button class="btn primary mt10" style="margin-top:8px" onclick="ooRetrySearch()">🔍 다시 검색</button>
      <div id="ooModalRetryResults" style="margin-top:10px;"></div>`;
  } else {
    box.innerHTML = (r.candidates||[]).map((c,k)=>candHtml(c,k)).join('');
  }
  $('#ooModalBack').classList.add('open');
};
function candHtml(c,k){
  return `<div class="cand" onclick="ooPickCand(${k})">
    <div class="road">${esc(c.roadAddrPart1)}</div>
    <div class="jibun">지번: ${esc(c.jibunAddr||'')}</div>
    <span class="zipn">우편번호 ${esc(c.zipNo)}</span>${c.bdNm?` <span class="zipn">${esc(c.bdNm)}</span>`:''}
  </div>`;
}
window.ooRetrySearch = async ()=>{
  const q = $('#ooModalRetry').value.trim();
  if (!q) return;
  const out = $('#ooModalRetryResults');
  out.innerHTML = '<div style="font-size:12px;color:var(--text-mid)">검색 중…</div>';
  try {
    const data = await jusoSearch(q);
    const list = (data.results && data.results.juso) || [];
    if (!list.length){ out.innerHTML = '<div style="font-size:12px;color:var(--danger)">결과가 없어요. 도로명+건물번호(예: 연삼로 1066-31)나 동+지번으로 검색해보세요.</div>'; return; }
    rows[modalIdx].candidates = list;
    rows[modalIdx].status = 'multi';
    out.innerHTML = list.map((c,k)=>candHtml(c,k)).join('');
  } catch(e){ out.innerHTML = '<div style="font-size:12px;color:var(--danger)">검색 실패: '+esc(e.message==='NOKEY'?NOKEY_MSG:e.message)+'</div>'; }
};
window.ooPickCand = k => {
  const r = rows[modalIdx];
  applyCandidate(modalIdx, r.candidates[k], $('#ooModalDetail').value.trim());
  $('#ooModalBack').classList.remove('open');
  render();
};
$('#ooModalKeep').onclick = ()=>{
  // 🔴 원본 그대로 두기: 주소도, 상태(확인필요/선택필요)도 그대로 유지 (대표 확정 규칙)
  $('#ooModalBack').classList.remove('open');
  render();
};
$('#ooModalClose').onclick = ()=> $('#ooModalBack').classList.remove('open');
$('#ooModalX').onclick = ()=> $('#ooModalBack').classList.remove('open');
/* 실수 방지: 모달 바깥을 눌러도 창이 닫히지 않음 (X 또는 취소로만 닫기) */

/* ---------- 내보내기 (원형 — CJ 13컬럼·헤더 색·노랑 표시 그대로) ---------- */
const HEADER = ['보내는사람','보내는사람연락처','출고지','수취인명','옵션정보','수량','수취인연락처1','수취인연락처2','배송지','배송메세지','구매자연락처','주문경로','보내는이 변경주소'];
function exportRows(){
  const oPhone = $('#ooOrdererPhone').value.trim();
  return rows.map(r=>[
    r.sender || '',
    r.senderPhone || '',
    settings.origin,
    r.name || '',
    r.product || '',
    Number(r.qty) || 1,
    r.phone || '',
    r.phone2 || '',
    r.addr || '',
    r.memo || settings.memo,
    oPhone || r.senderPhone || r.phone || '',
    settings.channel,
    $('#ooOrdererAddr').value.trim(),        // 보내는이 변경주소 (비우면 공란)
  ]);
}
function checkBeforeExport(){
  if (!rows.length){ toast('내보낼 주문이 없어요'); return false; }
  const noAddr = rows.filter(r=>!String(r.addr||'').trim()).length;
  if (noAddr){ toast(`주소가 비어있는 주문이 ${noAddr}건 있어요!`); return false; }
  const unverified = rows.filter(r=>r.status!=='ok').length;
  const noName = rows.filter(r=>!String(r.name||'').trim()).length;
  const noPhone = rows.filter(r=>!String(r.phone||'').trim()).length;
  const problems = [];
  if (unverified) problems.push(`주소 미확정 ${unverified}건`);
  if (noName) problems.push(`수취인명 없음 ${noName}건`);
  if (noPhone) problems.push(`연락처 없음 ${noPhone}건`);
  if (problems.length){
    if (!confirm(`확인이 필요한 주문이 있어요:\n· ${problems.join('\n· ')}\n\n해당 칸은 엑셀에서 노랑으로 표시됩니다.\n그래도 내보낼까요?`)) return false;
  }
  return true;
}
$('#ooBtnExcel').onclick = ()=>{
  if (!checkBeforeExport()) return;
  const data = exportRows();
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...data]);
  // ── 아꼼이네 원본 양식 그대로: 열 너비 · 색 · 테두리 · 정렬 ──
  ws['!cols'] = [31.1,15.5,51.9,24.1,61.5,6.8,15.9,15.5,74.4,73.1,14.3,15.6,17.9].map(w=>({wch:w}));
  const BORDER = {top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};
  const HEAD_FILL = {0:'CCCCFF',2:'CCCCFF',3:'FFFF00',4:'FFFF00',5:'FFFF00',6:'FFFF00',7:'FFFF00',8:'FFFF00',9:'FFFF00',12:'FFFF00'};
  for (let c = 0; c < HEADER.length; c++){
    // 헤더 행
    const hc = ws[XLSX.utils.encode_cell({r:0,c})];
    if (hc){
      hc.s = { font:{name:'맑은 고딕',sz:11,bold:true},
               alignment:{horizontal:'center',vertical:'center'},
               border:BORDER };
      if (HEAD_FILL[c] !== undefined) hc.s.fill = {patternType:'solid', fgColor:{rgb:HEAD_FILL[c]}};
    }
    // 데이터 행
    for (let r = 1; r <= data.length; r++){
      const ref = XLSX.utils.encode_cell({r,c});
      if (!ws[ref]) ws[ref] = {t:'s', v:''};
      ws[ref].s = { font:{name:'맑은 고딕',sz:11},
                    alignment:{vertical:'center', horizontal: c===5 ? 'center' : undefined},
                    border:BORDER };
    }
  }
  // 확인이 필요한 셀은 노랑으로 표시: 미확정 주소(배송지), 빈 수취인명, 빈 연락처
  const YELLOW = {patternType:'solid', fgColor:{rgb:'FFFF00'}};
  for (let r = 1; r <= data.length; r++){
    const row = rows[r-1];
    if (!row) continue;
    const mark = c => { const ref = XLSX.utils.encode_cell({r, c}); if (ws[ref]) ws[ref].s = Object.assign({}, ws[ref].s, {fill:YELLOW}); };
    if (row.status !== 'ok') mark(8);                       // 배송지
    if (!String(row.name||'').trim()) mark(3);              // 수취인명
    if (!String(row.phone||'').trim()) mark(6);             // 수취인연락처1
  }
  ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:data.length, c:HEADER.length-1}});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const d = new Date();
  const fname = `아꼼이네_CJ발송_${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, fname);
  toast('엑셀 파일을 내려받았어요 ⬇️');
};
$('#ooBtnCopy').onclick = async ()=>{
  if (!checkBeforeExport()) return;
  const tsv = [HEADER, ...exportRows()].map(r=>r.join('\t')).join('\n');
  try { await navigator.clipboard.writeText(tsv); toast('복사 완료! 엑셀에 붙여넣기(Ctrl+V) 하세요'); }
  catch(e){
    const ta = document.createElement('textarea'); ta.value = tsv; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
    toast('복사 완료! 엑셀에 붙여넣기(Ctrl+V) 하세요');
  }
};

/* ---------- vendor lazy-load (지시 #395 — 첫 화면 로딩 무증가, 자체 서버 서빙 = CDN 무관) ---------- */
const _loadedScripts = {};
function loadScript(src){
  if (_loadedScripts[src]) return _loadedScripts[src];
  _loadedScripts[src] = new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = src;
    s.onload = ()=>res();
    s.onerror = ()=>{ delete _loadedScripts[src]; rej(new Error('구성요소를 불러오지 못했어요: '+src)); };
    document.head.appendChild(s);
  });
  return _loadedScripts[src];
}
async function ensurePako(){ if (!window.pako) await loadScript('/vendor/pako-inflate.min.js'); }

/* ---------- 파일 업로드 (원형 + hwp 대비 pako 선로드) ---------- */
function fileStatus(msg, progress){
  const el = $('#ooFileStatus');
  if (msg === null){ el.classList.remove('show'); el.innerHTML=''; return; }
  el.classList.add('show');
  el.innerHTML = msg + (progress!==undefined ? `<div class="progress-bar"><div style="width:${Math.round(progress*100)}%"></div></div>` : '');
}
async function handleFiles(fileList){
  const files = [...fileList];
  for (const f of files){
    if (f.type.startsWith('image/')){ await handleImage(f); continue; }
    fileStatus(`📄 ${f.name} 읽는 중…`);
    try {
      await ensurePako();   // hwp 압축 해제용 (자체 서버 서빙 — 1회 45KB)
      const res = await akExtractFile(f);
      if (res.type === 'sheet'){
        const sheets = res.sheets.filter(s=>s.orders.length);
        if (sheets.length <= 1){
          const n = addOrders(sheets[0].orders, {senderComplete:true});
          toast(`${f.name}에서 ${n}건 불러왔어요! 표를 확인해주세요`);
        } else {
          openSheetChooser(f.name, sheets);   // 시트가 여러 개면 선택
        }
      } else {
        const ta = $('#ooRawInput');
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + res.text.trim();
        const n = parseText(res.text, {silent:true});
        if (n) toast(`${f.name}에서 ${n}건 정리했어요! 표를 확인해주세요`);
        else toast(`${f.name}의 내용을 입력칸에 넣었어요. 내용 확인 후 주문 정리하기를 눌러주세요`);
      }
      fileStatus(null);
    } catch(e){
      console.error(e);
      fileStatus(null);
      toast(`${f.name}: ${e.message || '파일을 읽지 못했어요'}`);
    }
  }
}
$('#ooBtnFile').onclick = ()=> $('#ooFileInput').click();
$('#ooFileInput').onchange = e => { handleFiles(e.target.files); e.target.value=''; };

/* 드래그&드롭 — 주문 정리기 화면이 열려 있을 때만 (다른 메뉴 무간섭) */
['dragenter','dragover'].forEach(ev=> document.addEventListener(ev, e=>{ if (!pageActive()) return; e.preventDefault(); $('#ooDropZone').classList.add('drag'); }));
['dragleave','drop'].forEach(ev=> document.addEventListener(ev, e=>{ if (!pageActive()) return; e.preventDefault(); if(ev==='drop'||e.target===document.documentElement) $('#ooDropZone').classList.remove('drag'); }));
document.addEventListener('drop', e=>{ if (!pageActive()) return; e.preventDefault(); $('#ooDropZone').classList.remove('drag'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

/* ---------- 이미지 OCR (표준 로딩으로 전환 — 전처리·행 재조립·PSM 3은 원형 유지, 대표 조건 2) ---------- */
let ocrWorker = null, ocrPromise = null;
async function ensureOcr(onProgress){
  if (ocrWorker) return ocrWorker;
  if (ocrPromise) return ocrPromise;
  ocrPromise = (async ()=>{
    if (!window.Tesseract) await loadScript('/vendor/tess/tesseract.min.js');
    const w = await Tesseract.createWorker('kor+eng', 1, {
      workerPath: '/vendor/tess/worker.min.js',
      corePath: '/vendor/tess-core',
      langPath: '/vendor/tess-lang',
      gzip: true,
      logger: m => { if (m.status==='recognizing text' && onProgress) onProgress(m.progress); },
    });
    await w.setParameters({tessedit_pageseg_mode:'3'});   // PSM 3 — 원형 유지
    ocrWorker = w;
    return w;
  })();
  try { return await ocrPromise; }
  catch(e){ ocrPromise = null; throw e; }
}
/* 이미지 전처리: 표 격자선 제거 + 작은 글씨 확대 → 인식률 대폭 향상 (원형 무수정) */
async function preprocessImage(blob){
  try {
    const img = await createImageBitmap(blob);
    const W = img.width, H = img.height;
    const c0 = document.createElement('canvas');
    c0.width = W; c0.height = H;
    const x0 = c0.getContext('2d', {willReadFrequently:true});
    x0.drawImage(img, 0, 0);
    if (W*H <= 8_000_000){
      const id = x0.getImageData(0,0,W,H);
      const d = id.data;
      const dark = i => (d[i]*0.3 + d[i+1]*0.59 + d[i+2]*0.11) < 120;
      for (let y=0;y<H;y++){                                  // 가로 격자선
        let cnt=0; for (let x=0;x<W;x++) if (dark((y*W+x)*4)) cnt++;
        if (cnt > W*0.5) for (let x=0;x<W;x++){ const i=(y*W+x)*4; d[i]=d[i+1]=d[i+2]=255; }
      }
      for (let x=0;x<W;x++){                                  // 세로 격자선
        let cnt=0; for (let y=0;y<H;y++) if (dark((y*W+x)*4)) cnt++;
        if (cnt > H*0.5) for (let y=0;y<H;y++){ const i=(y*W+x)*4; d[i]=d[i+1]=d[i+2]=255; }
      }
      x0.putImageData(id,0,0);
    }
    const scale = Math.min(3, Math.max(1, 1800 / W));          // 작은 이미지는 확대
    if (scale === 1) return await new Promise(r=>c0.toBlob(r,'image/png'));
    const c = document.createElement('canvas');
    c.width = Math.round(W*scale); c.height = Math.round(H*scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c0, 0, 0, c.width, c.height);
    return await new Promise(r=>c.toBlob(r,'image/png'));
  } catch(e){ return blob; }
}
/* 줄 좌표(bbox)로 표의 행을 재조립 — 열이 분리되어도 같은 줄끼리 합침 (원형 무수정) */
function ocrRowsFromLines(data){
  const lines = (data.lines||[]).map(l=>({text:(l.text||'').replace(/\n/g,' ').trim(), y:(l.bbox.y0+l.bbox.y1)/2, x:l.bbox.x0, h:l.bbox.y1-l.bbox.y0})).filter(l=>l.text);
  if (!lines.length) return '';
  lines.sort((a,b)=>a.y-b.y);
  const rowsArr = [];
  for (const l of lines){
    const last = rowsArr[rowsArr.length-1];
    if (last && Math.abs(l.y - last.y) < Math.max(l.h, last.h) * 0.6){ last.items.push(l); last.y = (last.y+l.y)/2; }
    else rowsArr.push({y:l.y, h:l.h, items:[l]});
  }
  return rowsArr.map(r=>r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ')).join('\n');
}
async function handleImage(blob){
  try {
    fileStatus('🖼️ 이미지 인식 준비 중… (처음 한 번은 내려받느라 몇 초 걸려요)', 0);
    const worker = await ensureOcr(p=> fileStatus('🖼️ 이미지에서 글자를 읽는 중…', p));
    fileStatus('🖼️ 이미지 다듬는 중…', 0.03);
    const prepped = await preprocessImage(blob);
    fileStatus('🖼️ 이미지에서 글자를 읽는 중…', 0.05);
    const { data } = await worker.recognize(prepped);
    let text = (ocrRowsFromLines(data) || data.text || '').trim();
    // OCR 흔한 오류 보정 (원형)
    text = text.replace(/(?<=\d)[oO](?=\d)/g,'0').replace(/(?<=\d)[lI](?=\d)/g,'1')
               .replace(/&(?=\s?동)/g,'A')                       // "&동" → "A동"
               .replace(/[|｜]/g,' ');
    // 깨져 읽힌 앞부분 정리: 한글 시작 전에 기호 섞인 긴 잡음이 있으면 잘라냄 (전화번호는 보존)
    text = text.split('\n').map(l=>{
      l = l.trim();
      const ki = l.search(/[가-힣]/);
      if (ki > 6){
        const pre = l.slice(0, ki);
        const junk = pre.replace(/[\d\s.\-()]/g,'');
        const hasPhone = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/.test(pre);
        if (!hasPhone && (junk.length > 3 || /[=@~#*±§]/.test(pre))) l = l.slice(ki);
      }
      return l;
    }).filter(l=>l).join('\n');
    fileStatus(null);
    if (!text){ toast('이미지에서 글자를 찾지 못했어요 🥲 더 선명한 이미지로 해보세요'); return; }
    const ta = $('#ooRawInput');
    ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + text;
    const n = parseText(text, {silent:true});
    if (n) toast(`이미지에서 ${n}건 읽었어요! 인식이 정확한지 꼭 확인해주세요 👀`);
    else toast('이미지 글자를 입력칸에 넣었어요. 오타를 고친 뒤 주문 정리하기를 눌러주세요');
  } catch(e){
    console.error(e);
    fileStatus(null);
    toast(e.message || '이미지 인식에 실패했어요');
  }
}
$('#ooBtnImage').onclick = ()=> $('#ooImgInput').click();
$('#ooImgInput').onchange = e => { handleFiles(e.target.files); e.target.value=''; };

/* ---------- 시트 선택 (원형 — 체크박스 다중 선택·원본 행 순서 유지) ---------- */
let pendingSheets = null;
function openSheetChooser(fname, sheets){
  pendingSheets = sheets;
  $('#ooSheetTitle').textContent = `"${fname}"에 표가 여러 개 있어요`;
  const total = sheets.reduce((a,s)=>a+s.orders.length,0);
  $('#ooSheetList').innerHTML =
    `<label class="sheet-item all"><input type="checkbox" id="ooSheetAll"><b>전체 선택</b><span>총 ${total}건</span></label>` +
    sheets.map((s,i)=>
      `<label class="sheet-item"><input type="checkbox" class="oo-sheet-chk" data-i="${i}"><b>${esc(s.name)}</b><span>${s.orders.length}건</span></label>`
    ).join('');
  const all = $('#ooSheetAll');
  const chks = () => [...document.querySelectorAll('.oo-sheet-chk')];
  all.addEventListener('change', ()=> chks().forEach(c=>{ c.checked = all.checked; }));
  chks().forEach(c=>c.addEventListener('change', ()=>{ all.checked = chks().every(x=>x.checked); }));
  $('#ooSheetBack').classList.add('open');
}
$('#ooSheetOk').onclick = ()=>{
  if (!pendingSheets) return;
  const idxs = [...document.querySelectorAll('.oo-sheet-chk:checked')].map(c=>+c.dataset.i).sort((a,b)=>a-b);
  if (!idxs.length){ toast('불러올 시트를 체크해주세요'); return; }
  const orders = [].concat(...idxs.map(i=>pendingSheets[i].orders));
  const n = addOrders(orders, {senderComplete:true});
  $('#ooSheetBack').classList.remove('open');
  pendingSheets = null;
  toast(`${idxs.length}개 시트에서 ${n}건 불러왔어요! 표를 확인해주세요`);
};
$('#ooSheetClose').onclick = ()=>{ $('#ooSheetBack').classList.remove('open'); pendingSheets = null; };
$('#ooSheetX').onclick = ()=>{ $('#ooSheetBack').classList.remove('open'); pendingSheets = null; };

/* ---------- 초기화 (보내는이 3칸 전부 비움 — 건별 입력, 대표 조건 3) ---------- */
$('#ooBtnReset').onclick = ()=>{
  if (rows.length && !confirm('작성 중인 내용을 모두 지우고 처음부터 시작할까요?')) return;
  rows = [];
  $('#ooRawInput').value = '';
  $('#ooOrdererName').value = '';
  $('#ooOrdererPhone').value = '';
  $('#ooOrdererAddr').value = '';
  render();
  toast('초기화했어요. 새 주문을 넣어주세요!');
};

/* Ctrl+V 붙여넣기 — 주문 정리기 화면이 열려 있을 때만 (다른 메뉴 무간섭).
   글자가 있으면 글자 우선(엑셀 셀 복사 = 100% 정확), 없을 때만 이미지 인식 (원형) */
document.addEventListener('paste', e=>{
  if (!pageActive()) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const text = cd.getData('text/plain');
  const t = e.target;
  const isEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (text && text.trim().length > 1){
    if (!isEditable){                     // 빈 화면에 붙여넣으면 입력칸으로 넣고 바로 정리
      e.preventDefault();
      const ta = $('#ooRawInput');
      ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + text.trim();
      parseText(text, {silent:true});
    }
    return;                               // 입력칸에서는 기본 붙여넣기 동작
  }
  for (const it of cd.items){
    if (it.type.startsWith('image/')){
      e.preventDefault();
      handleImage(it.getAsFile());
      return;
    }
  }
});

/* 검증용 내부 노출 (Playwright 회귀 — 운영 동작 무영향) */
window.__ooTest = { splitAddr, tidyDetail, fmtPhoneLive, getRows: ()=>rows, exportRows, parseText };
})();

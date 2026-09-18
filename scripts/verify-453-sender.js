// #453 검증: 배송메모 「보내는이 변경」 판정기(public/invoice-sender.js 실코드)
//   ① 가상 메모(개인정보 없음) 판정표 — 확실한 것만 자동 · 애매 = ambiguous · 무관 = null
//   ② 실자료 채점(있을 때만): 리포 폴더의 0916·0917·0918.xlsx(스토어 원본) ↔ 제주아꼼이네송장(효돈/대성) 완성본(수기)
//      - 🔴 수기로 안 바꾼 주문을 자동으로 바꾼 건 = 0 · 이름이 수기와 다른 건 = 0(표기 차이만 허용) · 번호 교체 = 수기와 전부 일치
//   실자료는 개인정보라 미커밋 — 없으면 ②는 건너뛴다. 화면·시트 검증은 verify-452-invoice-test.js ④.
const path = require('path'); const fs = require('fs');
const XLSX = require('xlsx-js-style');
const { parseSender } = require('../public/invoice-sender.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + String(d).slice(0, 200) : '')); };

// ① 가상 메모 판정표: [메모, 구매자, 기대 이름|'AMB'|null, 기대 번호]
const CASES = [
    ['보내는사람 전승범으로 해주세요, 문 앞에 놔주세요', '김구매', '전승범'],
    ['보내는이 홍길동 변경', '김구매', '홍길동'],
    ['보내는이 홍길동변경', '김구매', '홍길동'],
    ['보내는 이ㅡ 홍길동', '김구매', '홍길동'],
    ['보내는이 <홍길동> 변경 부탁드려요.', '김구매', '홍길동'],
    ['보내는 사람 이름 \'홍길동\'으로 표기 부탁드립니다', '김구매', '홍길동'],
    ['보내는 사람에 "홍길동 드림" 이라고 꼭 넣어주세요', '김구매', '홍길동'],
    ['보내는이 홍길동으로 변경', '김구매', '홍길동'],
    ['보내는이 정중구로 변경', '김구매', '정중구'],
    ['보낸사람:홍길동', '김구매', '홍길동'],
    ['보낸이 홍길동 드림', '김구매', '홍길동'],
    ['발신자: 가나주식회사 홍길동', '김구매', '가나주식회사 홍길동'],
    ['보내는사람 : 류 현', '김구매', '류현'],
    ['보내는이 김수정 변경', '김구매', '김수정'],
    ['선물입니다! 보내는사람 홍길동라고 해 주세요', '김구매', '홍길동'],
    ['9월 18일에 발송해 주세요. 보내는 이 홍길동 으로 변경 요청드려요.', '김구매', '홍길동'],
    ['보내는분 홍길동 으로 변경요청 9.19일 전후 도착으로 배송 요망', '김구매', '홍길동'],
    ['보내는 사람 : 홍길동(010-1234-5678)', '김구매', '홍길동', '010-1234-5678'],
    ['보내는사람 가나세차장 홍길동010 1234 5678', '김구매', '가나세차장 홍길동', '010-1234-5678'],
    ['보내는사람. 홍길동. 01012345678', '김구매', '홍길동', '010-1234-5678'],
    ['보내는 이 홍길동 변경 보내는 번호 010-1234-5678 로 변경', '김구매', '홍길동', '010-1234-5678'],
    ['보내는 사람 : 홍길동(10-1234-5678)', '김구매', '홍길동', null],
    ['보내는사람 김구매 소중한사람의 드실것이니 좋은상품 부탁드려요', '김구매', '김구매'],
    ['홍길동 드림', '김구매', '홍길동'],
    ['가나스튜디오 드림', '김구매', '가나스튜디오'],
    ['홍길동 드림(010-1234-5678)', '김구매', '홍길동', null],
    ['풍성한 추석명절 되세요. 홍길동 드림.', '김구매', '홍길동'],
    ['선배님, 늘 감사드립니다. 풍요로운 한가위 보내시길 바랍니다. 홍길동 올림', '김구매', '홍길동'],
    // 애매 → 아무것도 안 바꿈
    ['보내는이: 홍길동 즐거운 추석 보내세요~!', '김구매', 'AMB'],
    ['9월17일 배송희망 보내는분 가나 서울 강남구 영동대로 602 010 1234 5678', '김구매', 'AMB'],
    ['카톡으로 보내는분 ㆍ받는분 주소 문자드렸습니다', '김구매', 'AMB'],
    ['큰엄마 큰아빠 즐거운 추석명절 되셔요 홍길동 올림', '김구매', 'AMB'],
    ['가나교회 주차부장 홍길동집사 드림 풍성한 한가위 되세요-♡', '김구매', 'AMB'],
    ['보내는이 홍길동 좋은걸로 부탁드려요', '김구매', 'AMB'],
    ['받는 분이 보내는 사람 모르게 해주세요', '김구매', 'AMB'],
    ['보내는이 이름 변경 부탁', '김구매', 'AMB'],
    ['보내는 사람 이름 빼주세요', '김구매', 'AMB'],
    ['보내는 분께 연락주세요', '김구매', 'AMB'],
    // 무관 → null
    ['문 앞에 놔주세요', '김구매', null],
    ['', '김구매', null],
    ['s사이즈로 보내주시고 주문자 이름으로 발송해주세요', '김구매', null],
    ['주문자 홍길동 으로 변경 요청합니다', '김구매', null],
    ['홍길동', '김구매', null],
    ['나리보냄', '김구매', null],
    ['21일 발송 부탁드립니다', '김구매', null],
];
console.log('① 가상 메모 판정표');
for (const [memo, buyer, exp, tel] of CASES) {
    const p = parseSender(memo, buyer);
    const got = !p ? null : p.ambiguous ? 'AMB' : p.name;
    const telOk = tel === undefined || !p || p.ambiguous ? true : (p.phone || null) === tel;
    ok(got === exp && telOk, `「${memo.slice(0, 46)}」 → ${exp === null ? '무관' : exp === 'AMB' ? '애매(무변경)' : exp + ' 드림' + (tel ? ' · ' + tel : '')}`, got === exp && telOk ? null : `실제 ${got}${p && p.phone ? ' ' + p.phone : ''}`);
}

// ② 실자료 채점
const ROOT = path.join(__dirname, '..');
const DAYS = [
    { d: '0916', done: ['제주아꼼이네송장(효돈)09.16.xlsx', '제주아꼼이네송장(대성)09.16.xlsx'] },
    { d: '0917', done: ['제주아꼼이네송장(효돈)09.17 -.xlsx', '제주아꼼이네송장(대성)09.17.xlsx'] },
    { d: '0918', done: ['제주아꼼이네송장(효돈)09.18.xlsx', '제주아꼼이네송장(대성)09.18.xlsx'] },
].filter(x => fs.existsSync(path.join(ROOT, x.d + '.xlsx')) && x.done.every(f => fs.existsSync(path.join(ROOT, f))));
if (!DAYS.length) console.log('② 실자료 없음 — 건너뜀');
else {
    console.log('② 실자료 채점(' + DAYS.map(x => x.d).join('·') + ')');
    const dig = s => String(s || '').replace(/[^0-9]/g, '');
    const norm = s => String(s || '').replace(/[\r\n\s]/g, '').replace(/㈜/g, '(주)').replace(/주식회사/g, '(주)').replace(/[()]/g, '');
    const T = { rows: 0, auto: 0, shipped: 0, exact: 0, notation: 0, wrong: 0, falsePos: 0, later: 0, amb: 0, phone: 0, phoneOk: 0 }; const wrongs = [];
    for (const day of DAYS) {
        const wb = XLSX.readFile(path.join(ROOT, day.d + '.xlsx')); const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        const hi = aoa.findIndex(r => r.includes('상품주문번호')); const H = aoa[hi]; const ix = n => H.indexOf(n);
        const done = []; for (const f of day.done) XLSX.utils.sheet_to_json(XLSX.readFile(path.join(ROOT, f)).Sheets['Sheet1'], { defval: '' }).forEach(r => done.push(r));
        const key = (tel, rcv) => dig(tel).slice(-8) + '|' + String(rcv).replace(/\*/g, '').trim().slice(0, 2);
        const dmap = new Map(); done.forEach(r => { const k = key(r['수취인연락처1'], r['수취인명']); if (!dmap.has(k)) dmap.set(k, []); dmap.get(k).push(r); });
        for (const r of aoa.slice(hi + 1)) {
            if (!r[ix('상품주문번호')]) continue; T.rows++;
            const buyer = String(r[ix('구매자명')]).trim(); const p = parseSender(r[ix('배송메세지')], buyer);
            if (!p) continue; if (p.ambiguous) { T.amb++; continue; }
            T.auto++;
            const c = dmap.get(key(r[ix('수취인연락처1')], r[ix('수취인명')])) || [];
            if (!c.length) { T.later++; continue; }
            T.shipped++;
            const manuals = [...new Set(c.map(x => String(x['보내는사람']).trim()))];
            const changed = manuals.filter(m => m.replace(/\(제주아꼼이네[^)]*\)\s*$/, '').trim() !== buyer);
            if (!changed.length) { T.falsePos++; wrongs.push(day.d + ' 오변경 후보 rule ' + p.rule); continue; }
            const mine = p.name + ' 드림';
            if (changed.some(m => norm(m) === norm(mine))) T.exact++;
            else if (changed.some(m => norm(m.replace(/\s*(드림|올림)!?\s*$/, '')) === norm(p.name))) T.notation++;
            else { T.wrong++; wrongs.push(day.d + ' 이름 불일치 rule ' + p.rule); }
            if (p.phone) { T.phone++; if (c.some(x => dig(x['보내는사람연락처']) === dig(p.phone))) T.phoneOk++; }
        }
    }
    console.log('  ', JSON.stringify(T));
    ok(T.falsePos === 0, '🔴 수기로 안 바꾼 주문을 자동으로 바꾼 건 = 0', T.falsePos + (wrongs.length ? ' · ' + wrongs.slice(0, 3).join(' / ') : ''));
    ok(T.wrong === 0, '🔴 자동 이름이 수기와 다른 건 = 0(「드림」 유무·(주) 표기 차이만 허용)', `일치 ${T.exact} · 표기차 ${T.notation} · 불일치 ${T.wrong}`);
    ok(T.phone > 0 && T.phone === T.phoneOk, '보내는사람연락처 교체 = 수기와 전부 일치', `${T.phoneOk}/${T.phone}`);
    ok(T.shipped >= 90, '자동 변경 건수(그날 출고분) 회귀 없음', `${T.shipped}건(뒤 날짜 ${T.later}건 별도 · 애매 ${T.amb}건 무변경)`);
}
console.log(`\n결과: ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);

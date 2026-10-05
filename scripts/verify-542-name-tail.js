// #542 검증: 발송안내 상품명 꼬리 — server.js 실코드를 떼어 실행(설정 없음 = 종전과 같음 · 대상만 붙음 · 기간 지나면 꺼짐)
//   node scripts/verify-542-name-tail.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const a = src.indexOf('const _nameTail = { at: 0, v: null };'), b = src.indexOf('async function naverCfgGet(key) {');
if (a < 0 || b < 0 || b < a) { console.log('❌ 표식 없음'); process.exit(1); }
const kakaoNotify = require('../kakao-notify.js');
let CFG = null;
const mod = new Function('naverCfgGet', src.slice(a, b) + '\nreturn { notifyNameTailLoad, notifyNameTailCfg, notifyNameWithTail, _nameTail };')(async () => CFG);
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + t + (d ? ' — ' + d : '')); };
const name = (opt, now) => mod.notifyNameWithTail(opt, kakaoNotify.cleanProductName(opt || '주문 상품'), 80, now);
const N_OLD = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(로얄과)';
const N_EVT = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 행사★하우스귤 2.5kg로얄과→중량up 4kg';
const N_SO = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 2.5kg(소과)';
const N_45 = '아꼼이네 상품선택: 1. (제철)고당도 하우스감귤 / 상품 및 과수: 하우스감귤 가정용 - 4.5kg(로얄과)';
const N_YU = '아꼼이네 상품선택: 2. (제철)유라품종 노지감귤 / 상품 및 과수: 가정용 - 3kg(로얄과 2S~M)';
const C_OLD = '제주아꼼이네 제철 고당도 하우스감귤, 1박스, 가정용 2.5kg(로얄과)';
const C_EVT = '제주아꼼이네 제철 고당도 하우스감귤, 1박스, 행사*가정용 2.5kg(로얄과)->중량up 4kg';
const D = s => Date.parse(s + '+09:00');
(async () => {
    // ① 설정 없음 = 종전과 바이트 동일
    await mod.notifyNameTailLoad();
    const plain = o => kakaoNotify.cleanProductName(o).slice(0, 80);
    ok([N_OLD, N_EVT, N_SO, C_OLD, C_EVT].every(o => name(o, D('2026-10-06T08:00:00')) === plain(o)), '설정 없음 = 종전 출력과 같음');
    ok(mod.notifyNameTailCfg(N_OLD, D('2026-10-06T08:00:00')) === null, '설정 없음 = 쿠팡 한 줄도 없음');
    // ② 설정 있음
    CFG = { until: '2026-10-11', has: ['하우스감귤', '2.5kg(로얄과)'], not: ['중량up'], tail: ' (4kg 업그레이드 발송)', note: '※ 행사로 로얄과 4kg으로 업그레이드해서 보내드려요!' };
    mod._nameTail.at = 0; await mod.notifyNameTailLoad();
    const t = D('2026-10-06T09:30:00');
    const r = name(N_OLD, t);
    ok(r.endsWith(' (4kg 업그레이드 발송)') && r.includes('2.5kg(로얄과)') && r.length <= 80, '네이버 옛 2.5kg(로얄과) = 꼬리 붙음 · 80자 안', r);
    ok(name(N_EVT, t) === plain(N_EVT), '네이버 행사 옵션 = 그대로(이미 4kg 표기)', name(N_EVT, t));
    ok(name(N_SO, t) === plain(N_SO) && name(N_45, t) === plain(N_45) && name(N_YU, t) === plain(N_YU), '소과 · 4.5kg 로얄과 · 유라 = 그대로');
    ok(!!mod.notifyNameTailCfg(C_OLD, t) && mod.notifyNameTailCfg(C_OLD, t).note === CFG.note, '쿠팡 옛 2.5kg(로얄과) = 맨 위 한 줄 대상');
    ok(mod.notifyNameTailCfg(C_EVT, t) === null, '쿠팡 행사 옵션 = 대상 아님');
    // ③ 기간
    ok(name(N_OLD, D('2026-10-11T23:50:00')).endsWith('발송)'), '10/11 23:50 = 아직 붙음');
    ok(name(N_OLD, D('2026-10-12T00:10:00')) === plain(N_OLD), '10/12 00:10 = 꺼짐(종전 출력)');
    // ④ 긴 이름 = 꼬리가 잘리지 않음
    const long = '하우스감귤 ' + '가'.repeat(90) + ' 2.5kg(로얄과)';
    const lr = mod.notifyNameWithTail(long, long, 80, t);
    ok(lr.length === 80 && lr.endsWith(' (4kg 업그레이드 발송)'), '긴 이름도 80자 · 꼬리 온전', String(lr.length));
    // ⑤ 망가진 설정 = 조용히 꺼짐
    CFG = { until: '2026-10-11', has: 'x', tail: 1 }; mod._nameTail.at = 0; await mod.notifyNameTailLoad();
    ok(name(N_OLD, t) === plain(N_OLD), '설정 꼴이 틀리면 종전 출력');
    // ⑥ 배선
    ok(src.split('notifyNameWithTail(po.productOption').length === 2 && src.split('await notifyNameTailLoad();   // #542').length === 3 && src.split('tc.note && message').length === 2, '배선: 네이버 발송안내 1곳 · 쿠팡 발송안내 1곳 · 주문안내 0곳');
    console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();

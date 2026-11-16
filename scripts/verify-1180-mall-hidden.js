// #1180 검증 — scripts/desk/mall-price.js 의 plan·putAll 을 떼어 가짜 _mall(네이버·카페24·설정)로 돌린다(실DB·카페24·네이버 호출 0)
//   ① --with-hidden 없음 = 종전대로 미노출 품목에서 멈춤 ② --with-hidden = 미노출 품목은 추가금만 · 요청 바디에 selling/display 없음
//   ③ 음수 추가금(미노출 쪽엔 안 생기는지) ④ 값이 들어 있던 미노출 품목의 50% 넘는 변화는 멈춤 ⑤ 산하홍 꼴 결제가 9개 = 네이버 값
//   실행: node scripts/verify-1180-mall-hidden.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'desk', 'mall-price.js'), 'utf8');
const cut = src.indexOf('(async () => {\n    const args');
if (cut < 0) { console.error('mall-price.js 본문 시작을 못 찾음'); process.exit(1); }
const body = src.slice(0, cut).replace("const M = require('./_mall');", '');
const make = new Function('M', 'require', body + '\nreturn { plan, putAll, table };');
let pass = 0, fail = 0; const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || x === undefined ? '' : ' ' + JSON.stringify(x))); };
const G = '1. (제철)홍귤 산하홍';
const SPEC = [['로얄과 - 3kg(가정용 2S~M)', -10000], ['소과 - 3kg(가정용 2S미만)', -12000], ['중대과 - 3kg(가정용 L이상)', -13000], ['로얄과 - 5kg(가정용 2S~M)', 0], ['소과 - 5kg(가정용 2S미만)', -3000], ['중대과 - 5kg(가정용 L이상)', -5000], ['로얄과 - 10kg(가정용 2S~M)', 17000], ['소과 - 10kg(가정용 2S미만)', 14000], ['중대과 - 10kg(가정용 L이상)', 11000]];
function fakeM(over) {
  const reqs = [];
  const nv = { no: '4773814370', name: '제주 홍귤 산하홍', statusType: 'OUTOFSTOCK', discPrice: 32800, optsNone: false, opts: SPEC.map(([n2, p]) => ({ n1: G, n2, price: p, usable: true })).concat([{ n1: G, n2: '못난이 - 10kg(혼합과)', price: 6000, usable: false }]) };
  const live = { '로얄과 - 5kg(가정용 2S~M)': 5000, '중대과 - 5kg(가정용 L이상)': 0 };
  const vars = SPEC.map(([n2], i) => ({ code: 'P' + i, name: `${G} · ${n2}`, add: live[n2] != null ? live[n2] : 0, selling: live[n2] != null ? 'T' : 'F', display: live[n2] != null ? 'T' : 'F' }))
    .concat([{ code: 'PX', name: `${G} · 못난이 - 10kg(혼합과)`, add: 11000, selling: 'F', display: 'F' }]);
  if (over) over(vars);
  const M = {
    latestSnapshot: async () => ({ id: 1, items: [{ no: '4773814370', name: nv.name, opts: [] }] }),
    naverLive: async () => ({ '4773814370': nv }),
    c24Product: async () => ({ base: 27800, selling: 'F', vars }),
    cfgGet: async k => k === 'cafe24_sync_map' ? { map: { '4773814370': { c24: 109, minAdd: -5000 } } } : null,
    c24: async r => { reqs.push(r); return { ok: true }; }, c24Ok: () => true, stepLog: async () => { },
  };
  return { M, reqs };
}
(async () => {
  console.log('① --with-hidden 없음 = 종전대로 멈춤');
  { const { M } = fakeM(); const T = make(M, require); const { P } = await T.plan('4773814370', false);
    ok(P.stops.length === 7 && P.stops.every(s => /미노출 상태예요/.test(s)) && !P.can_apply, '미노출 7개 멈춤 · can_apply false', P.stops.length);
    ok(P.puts.every(t => !t.hidden), '숨긴 품목 put 0'); }
  console.log('② --with-hidden = 미노출 품목 추가금만');
  { const { M, reqs } = fakeM(); const T = make(M, require); const { P } = await T.plan('4773814370', false, true);
    ok(!P.stops.length && P.can_apply && P.target_base === 19800 && P.target_minAdd === -13000, '멈춤 0 · 기본가 19,800 · minAdd −13,000', [P.stops, P.target_base, P.target_minAdd]);
    const pays = SPEC.map(([n2]) => { const r = P.rows.find(x => x.opt.endsWith(n2)); return r && r.naver; });
    ok(JSON.stringify(pays) === JSON.stringify([22800, 20800, 19800, 32800, 29800, 27800, 49800, 46800, 43800]), '9개 목표 결제가 = 네이버 값', pays);
    const adds = Object.fromEntries(P.puts.map(t => [t.code, Number(t.body.additional_amount)]));
    ok(adds.P0 === 3000 && adds.P1 === 1000 && adds.P2 === undefined && adds.P3 === 13000 && adds.P4 === 10000 && adds.P5 === 8000 && adds.P6 === 30000 && adds.P7 === 27000 && adds.P8 === 24000, '추가금 = 결제가 − 19,800(중대3 은 0 이라 그대로)', adds);
    ok(!P.puts.some(t => t.code === 'PX'), '네이버가 판매 안 함 + 미노출 못난이는 무접촉');
    ok(P.puts.filter(t => t.hidden).length === 6 && P.rows.filter(r => /^미노출/.test(r.state)).length === 7, '미노출 7줄(6 바꿈 + 1 같음)');
    ok(T.table(P).some(l => /미노출 · 추가금만/.test(l)) && T.table(P).some(l => /50% 가드 제외/.test(l)), '표에 「미노출 · 추가금만」 · 가드 제외 표시');
    await T.putAll(109, P.base_change.to, P.puts, 1);
    const vb = reqs.filter(r => /variants/.test(r.path)).map(r => r.body.request);
    ok(vb.length === P.puts.length && vb.every(b => Object.keys(b).length === 1 && 'additional_amount' in b), '옵션 요청 바디 = additional_amount 하나뿐(selling·display 없음)', vb);
    const pb = reqs.find(r => !/variants/.test(r.path)); ok(pb && pb.body.request.price === '19800' && !('selling' in pb.body.request) && !('display' in pb.body.request), '상품 요청 = 기본가만(판매·진열 칸 없음)', pb && pb.body.request); }
  console.log('③ 음수 추가금 — 기준이 가장 싼 판매함 옵션이라 미노출 쪽엔 안 생김(음수 검사는 코드에 그대로)');
  { const { M } = fakeM(); const nvBad = await M.naverLive(); nvBad['4773814370'].opts[0].price = -14000; nvBad['4773814370'].opts[0].usable = true;
    const M2 = { ...M, naverLive: async () => nvBad }; const T = make(M2, require);
    // 가장 싼 것이 −14,000 이 되면 기준도 내려가 음수가 안 생김 → 음수 꼴은 기준 밖 미노출 품목(네이버 판매 안 함과 이름 같은 F 품목 아님)로는 안 생김 · 대신 기준값 확인
    const { P } = await T.plan('4773814370', false, true); ok(P.target_minAdd === -14000 && !P.stops.some(s => /음수/.test(s)), '가장 싼 값이 기준이라 미노출 쪽 음수 없음(안전)', [P.target_minAdd, P.stops]); }
  console.log('④ 값이 들어 있던 미노출 품목의 50% 넘는 변화 = 멈춤');
  { const { M } = fakeM(v => { v[6].add = 1000; }); const T = make(M, require); const { P } = await T.plan('4773814370', false, true);
    ok(P.stops.some(s => /로얄과 - 10kg.*미노출.*50%/.test(s)) && !P.can_apply, '추가금 1,000 이 들어 있던 미노출 로얄10(28,800 → 49,800) = 멈춤', P.stops); }
  console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

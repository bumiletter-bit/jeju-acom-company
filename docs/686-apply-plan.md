# #686-C 실행 초안 — 황금향 인하 · 황금향 못난이 품절 · 그린레몬 못난이 5kg(네이버 전용)

> 워커2(claude-cc) · 2026-10-14 · **조회·dry 만**(코드·실DB·카페24 변경 0). 값 지도 = docs/686-change-map.md(워커1).
> dry 한 것: mall-price preview 4페이지 · hide 계획 · 직접 넣기 스크립트 4묶음 계획 · SQL 은 트랜잭션 안에서 돌리고 ROLLBACK(뒤에 실값 그대로인 것 확인).

## 머리 — 지금 손님 과결제는 없다

- 자사몰 화면가는 새벽 스냅샷 #106(10/14 04:39 · 옛값)을 그린다. 카페24 결제가도 옛값이라 **지금은 화면 = 결제**(57,800 / 41,800 / 60,800). 네이버만 먼저 내려가 있다.
- 어긋나는 순간 = **스냅샷이 다시 수집될 때**(수동 재수집 또는 내일 04:30). 그때 화면만 내려가고 결제가 옛 추가금이면 5kg 가정용 +8,000 · 선물 3kg +3,000 · 선물 5kg +5,000 과결제.
- 그래서 순서는 「카페24 추가금 먼저 → 그 직후 재수집」. 카페24 를 먼저 내린 사이에는 화면(옛값) > 결제(새값) = 손님이 덜 내는 쪽이라 안전하다.

## 쓰기 전 대표 확인이 필요한 것

1. **c92 K**(자사몰 전용 황금향 선물용 5kg · 지금 60,800)를 55,800 으로 내릴지 → 「고」면 3-b.
2. **자사몰 황금향 못난이를 오늘 내릴지**(c94 F · c92 L · c97 B) → 「고」면 3-c. 안 내리면 5kg 두 곳은 계속 팔린다(네이버는 재고 0 · 카페24 는 판매 T). c97 은 내일 05:10 에 저절로 내려간다.
3. **그린레몬 못난이 박스 차감** = 「만감 박스 5kg」이 맞는지(1번 SQL 의 boxType 값).
4. 새 판매현황 행 안내문 = 그린레몬 5kg(523) 안내문을 **글자 그대로 복사**한다. 못난이 한 줄을 더할지.
5. 네이버 감귤·VIP 페이지 황금향 선물용 옵션 글자(「대과」/묶음 이름 · 워커1 지도 🔴 2·3번) — 실제로 바뀌어 있으면 송장 오매칭이라 가격과 별개로 되돌려야 한다.

## 알려 둘 것(dry 에서 나온 것)

- 카페24 는 **품목 코드로 직접 넣는 쪽이 안전**하다. mall-price preview 결과: c94 = 네이버 실시간으로 계획 3건(정상) · **c92 · c100 = 실시간 조회가 안 돼 스냅샷(옛값)으로 떨어져 「바꿀 것 0」** — 지금 apply 를 돌리면 아무것도 안 바꾸고 끝난다. 실시간이 되더라도 「대과」 글자면 멈춘다.
- mall-price hide 는 **쓸 수 없다**: 네이버 못난이는 옵션이 남은 채 재고 0 이라 도구가 「네이버에서 아직 파는 옵션」으로 보고 멈춘다(c94 실행 확인). → 미노출도 직접 넣기.
- mall-price apply · hide 는 **지시 id(pending_orders 번호)** 가 있어야 돈다. 직접 넣기 스크립트는 지시 id 없이 audit source orchestrator 로 남긴다.
- 🔴 카페24 러너는 요청·결과 칸이 하나뿐이다(cafe24_product_request). **두 창이 동시에 카페24 를 읽으면 결과가 섞인다** — 실행 중에는 다른 워커의 mall-price · price-check 를 멈출 것.
- 품목별 금액을 SQL 로 넣으면 syncPricingToBotProducts 가 안 돈다(화면 저장·API 때만 · server.js 4581·4608행). 2번 SQL 은 **행이 없으면 만들고 · 「준비중」으로 이미 생겨 있으면 올리는** 한 문장이라 어느 길로 넣어도 중복이 안 생긴다.
- 판매현황 225(가정용 3kg)는 이미 33,500 · 363·364(못난이)는 이미 「품절」(10/14 08:58 발주컴퓨터) → 손댈 것 없음. 행 삭제 금지(#540-a).
- verify-428-checkout 기대값이 낡는다: 5·6·10·32번(옛 가격) · 12·13·14번(못난이 = 내리면 담기 실패가 정상). 검증 파일 기대 갱신은 총괄 몫(이번에 안 건드림).
- 네이버 그린레몬 못난이는 내 첫 조회에서 +10,800(66,400원)으로 읽혔다. 워커1 재조회는 −10,800(44,800). **재수집 직전에 44,800 인지 한 번 더 볼 것**(5번).
- dry 중 판매현황 번호표가 1칸 넘어갔다(롤백된 INSERT 가 번호 620 을 씀 · 행은 없음 · 무해).

## 실행 순서(총괄이 위에서부터)

### 0. 준비 — 직접 넣기 스크립트 저장

맨 아래 「부록」 코드를 **scripts/apply-686-c24.js** 로 저장(총괄 · 커밋 대상). 같은 내용이 워커2 스크래치에도 있다:
`%LOCALAPPDATA%\Temp\claude\C--Users-----OneDrive------------------\103e7e01-d849-410f-b23d-82bf074dca33\scratchpad\686-c24.js`

### 1. 품목별 금액 — 대성(시온) id 110(10/12~10/18)에 한 줄

```sql
BEGIN;
UPDATE pricing
   SET items = items || '[{"name":"과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)","price":18500,"boxType":"만감 박스 5kg"}]'::jsonb
 WHERE id = 110
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(items) e WHERE e->>'name' = '과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)')
RETURNING jsonb_array_length(items);   -- 기대 22 (지금 21) · 0행이면 이미 있음
INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name)
VALUES ('update', 'pricing', 110, '{"note":"#686 그린레몬 못난이 5kg 18,500 추가","added":{"name":"과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)","price":18500,"boxType":"만감 박스 5kg"}}'::jsonb, 'orchestrator', '클코 총괄(대표 지시 #686)');
COMMIT;
```

- 화면으로 넣어도 된다(품목별 금액 › 대성(시온) 이번 주 표 › 품목 추가 › 저장 = PUT /api/pricing/110 · server.js 4593행). 이름은 위 글자 그대로(「못난이5kg」 붙여 씀).
- 다음 주 표(10/19~)를 만들 때 이 줄이 따라가는지 확인(빠지면 그날부터 「그린레몬5kg(중소과)」로 조용히 오매칭 · app.js 6150행).

### 2. 판매현황 — 황금향 3행 판매가 + 그린레몬 못난이 새 행

```sql
BEGIN;
-- 2-a 황금향 판매가(옛값이 그대로일 때만 바꿈 · 기대 3행)
UPDATE bot_products b SET price = v.np, updated_at = NOW(), updated_by = '클코 총괄(대표 지시 #686)'
  FROM (VALUES (226,'57,800원','49,800원'), (409,'41,800원','38,800원'), (410,'60,800원','55,800원')) AS v(id, op, np)
 WHERE b.id = v.id AND b.price = v.op AND b.deleted_at IS NULL
RETURNING b.id, b.price;
-- 2-b 새 행: 없으면 만들고 · 품목별 금액 저장으로 「준비중」 행이 이미 생겼으면 그 행을 올림(기대 1행 · 판매중 · 44,800원 · 안내문 464자)
INSERT INTO bot_products (name, status, price, shipping_guide, updated_by)
SELECT '과수 및 크기: 제주 그린레몬 못난이5kg(랜덤과)', '판매중', '44,800원', shipping_guide, '클코 총괄(대표 지시 #686)' FROM bot_products WHERE id = 523
ON CONFLICT (name) DO UPDATE
   SET status = '판매중', price = '44,800원', shipping_guide = EXCLUDED.shipping_guide, updated_at = NOW(), updated_by = EXCLUDED.updated_by
 WHERE bot_products.status = '준비중' AND bot_products.deleted_at IS NULL
RETURNING id, status, price, length(shipping_guide);
INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name)
VALUES ('update', 'bot_product', NULL, '{"note":"#686 황금향 판매가 226 57,800→49,800 · 409 41,800→38,800 · 410 60,800→55,800 + 그린레몬 못난이5kg 새 행(판매중 44,800 · 안내문 = 523 복사)"}'::jsonb, 'orchestrator', '클코 총괄(대표 지시 #686)');
COMMIT;
```

- dry(롤백)로 확인한 것: 2-a 3행 · 「준비중 행이 먼저 생긴 경우」 올리기 1행(판매중 · 44,800원 · 464자) · 1번 UPDATE 22. **2-b 의 `INSERT … SELECT … ON CONFLICT` 꼴 자체는 돌려 보지 않았다**(같은 뜻의 두 문장으로 나눠 시험함) — 실행 때 RETURNING 1행인지 볼 것.
- naver_product_no 칸은 비워 둔다(기존 그린레몬 521~523 도 비어 있음).
- 봇 반영 = 1분 캐시. 재고 40 이 다 팔려도 이 행은 저절로 「품절」이 안 된다(사람이 바꿔야 봇이 품절로 답함).

### 3. 카페24 — 직접 넣기(먼저 계획 → 맞으면 끝에 apply)

```bash
# 3-a 추가금 7개: c94 C·D·E · c92 I·J · c100 B·C
node scripts/apply-686-c24.js . price
node scripts/apply-686-c24.js . price apply
# 3-b (대표 답 뒤) c92 K 자사몰 전용 선물 5kg 60,800 → 55,800
node scripts/apply-686-c24.js . priceK apply
# 3-c (대표 답 뒤) 못난이 미노출: c94 F · c92 L  /  c97 B(대용량 · 유일한 옵션)
node scripts/apply-686-c24.js . hide apply
node scripts/apply-686-c24.js . hide97 apply
```

dry 결과(10/14 · 쓰기 0 · 카페24 실시간 값):

| 묶음 | 페이지 · 코드 | 옵션 | 기본가 | 추가금 지금 → 바꿀 값 | 결제가 지금 → 바꿀 값 |
|---|---|---|---|---|---|
| price | c94 P00000DQ000C | 가정용 5kg | 33,500 | 24,300 → 16,300 | 57,800 → 49,800 |
| price | c94 P00000DQ000D | 선물용 3kg | 33,500 | 8,300 → 5,300 | 41,800 → 38,800 |
| price | c94 P00000DQ000E | 선물용 5kg | 33,500 | 27,300 → 22,300 | 60,800 → 55,800 |
| price | c92 P00000DO000I | 가정용 5kg | 14,800 | 43,000 → 35,000 | 57,800 → 49,800 |
| price | c92 P00000DO000J | 선물용 3kg | 14,800 | 27,000 → 24,000 | 41,800 → 38,800 |
| price | c100 P00000DW000B | 선물용 3kg | 33,500 | 8,300 → 5,300 | 41,800 → 38,800 |
| price | c100 P00000DW000C | 선물용 5kg | 33,500 | 27,300 → 22,300 | 60,800 → 55,800 |
| priceK | c92 P00000DO000K | 선물용 5kg(자사몰 전용) | 14,800 | 46,000 → 41,000 | 60,800 → 55,800 |
| hide | c94 P00000DQ000F | 못난이 5kg | 33,500 | 4,300 그대로 | 37,800 · T/T → F/F |
| hide | c92 P00000DO000L | 못난이 5kg | 14,800 | 23,000 그대로 | 37,800 · T/T → F/F |
| hide97 | c97 P00000DT000B | 못난이 10kg | 68,800 | 0 그대로 | 68,800 · T/T → F/F |

- 기본가·동기화 기준값(minAdd)은 세 페이지 모두 안 바뀐다(가장 싼 옵션이 그대로). 그래서 내일 새벽 자동 동기화가 값을 되돌리지 않는다.
- 스크립트는 지금 결제가가 「바꾸기 전 기대값」도 「목표값」도 아니면 그 줄에서 멈추고 **아무것도 안 바꾼다**. 이름에 「황금향」과 옵션 글자가 없어도 멈춘다. 계획 모드까지만 돌려 봤고 **apply 갈래(PUT · audit · 90초 뒤 재확인)는 실행해 보지 않았다**(PUT 꼴은 mall-price.js 95행과 같은 호출).
- 되돌리기 = audit_logs(source orchestrator · action cafe24_variant_update)의 before 값으로. 미노출 되돌리기는 selling/display T.
- c97 을 미노출하면 그 페이지에 팔 옵션이 0 이 된다(내일 05:10 「품절 동기」가 어차피 판매 중지로 바꿈).

### 4. 네이버 전용 옵션 경보 끄기 — cafe24_sync_ignore_opts

```sql
UPDATE agent_office_config
   SET value = jsonb_set(value, '{keys}', COALESCE(value->'keys','[]'::jsonb) || '["레몬|못난이|5kg|랜덤과"]'::jsonb), updated_at = NOW()
 WHERE key = 'cafe24_sync_ignore_opts'
   AND NOT (COALESCE(value->'keys','[]'::jsonb) ? '레몬|못난이|5kg|랜덤과')
RETURNING value->'keys';   -- 기대 ["레몬|못난이|5kg|랜덤과"] (지금 keys = [])
```

- 열쇠는 server.js cafe24OptKey 식을 읽어 실제 옵션명 「제주 그린레몬 못난이5kg(랜덤과)」으로 손으로 맞춰 봤다(과일 「레몬」 · 용도 「못난이」 · 5kg · 랜덤과). 이 SQL 은 돌려 보지 않았다. 워커3 설계가 다르면 그쪽 우선.
- 확인: `node scripts/desk/mall-price.js preview 5531798664` → 「네이버에만 두기로 한 옵션(그대로 둠)」 줄이 나오고 멈춤(stops)이 없어야 한다(지금은 「카페24에 … 옵션이 없어요」로 멈춤).
- 이 열쇠는 경보만 끈다. 자사몰 레몬 화면에 못난이가 그려지는지는 6번에서 실물로.

### 5. (3 직후) 스냅샷 재수집 — 총괄

```bash
node scripts/desk/mall-price.js preview 5531798664    # 표 마지막 줄 = 못난이 네이버 44,800 인지 먼저
node scripts/apply-489-snapshot.js 황금향,레몬
```

- 280초 넘게 걸릴 수 있다. 끊기면 DB naver_product_snapshot 최신 id 가 106 보다 큰지만 보면 된다.

### 6. 검증

```bash
node scripts/desk/mall-price.js preview 11126666859      # 전부 「같음」
node scripts/desk/mall-price.js checkout 11126666859     # 실제 결제창 금액 = 네이버 결제가
node scripts/desk/mall-price.js checkout 6400134206 황금향
node scripts/desk/mall-price.js checkout 10801253976 황금향
node scripts/verify-428-checkout.js 4,9,17,18,28          # 안 바뀐 값 무회귀(황금향 3kg 33,500 · VIP 하우스 33,500 · 그린레몬 3종)
node scripts/verify-428-checkout.js 5,6,10,32             # 기대값을 38,800 · 55,800 · 55,800 · 49,800 으로 고친 뒤
```

- 12·13·14번(못난이)은 미노출 뒤 담기 실패가 정상 → 돌리지 않거나 기대를 뒤집을 것.
- 실물: 자사몰 황금향 페이지 5kg 가정용 화면가 49,800 → 담기 → 결제창 49,800 · **자사몰 레몬 페이지에 「못난이5kg」이 보이는지**(보이면 누를 때 확인창 또는 다른 옵션 결제 — 스킨 쪽 막기는 별도 지시).
- 봇: 「황금향 5kg 얼마예요」 → 49,800 · 「그린레몬 못난이 있나요」 → 44,800 · 「황금향 못난이 있나요」 → 품절.
- 내일 05:10 뒤: 「옵션 결제가 불일치」·「옵션명 불일치(c105)」 경보 0 · [전체 가격 확인하기] 어긋남 0.

## 안 한 것 · 못 본 것

- 실제 쓰기 전부(총괄 「시작」 뒤) · scripts/ 에 파일 추가(총괄 몫 — 워커2 새 파일은 이 문서 하나).
- app.js 그린레몬 못난이 분기(코드 · 배포 · 워커1 지도 ⓔ).
- 쿠팡(대표가 Wing 에서) · 자사몰 상세·배너에 박힌 가격 글자 · 스킨이 네이버 전용 옵션을 그리는지.
- c92 · c100 의 네이버 실시간 값은 내 쪽에서 조회가 안 됐다(스냅샷으로 떨어짐) — 값은 워커1 지도 ⓑ-2 기준.

## 부록 — scripts/apply-686-c24.js (계획 모드 검증본 그대로)

```js
// #686 카페24 황금향 추가금 직접 맞추기(품목 코드 지정 · apply-534-c24 꼴) — 기본 = 계획만(쓰기 0)
//   node scripts/apply-686-c24.js <저장소 경로> [price|priceK|hide|hide97] [apply]
//   price  = c94 C·D·E + c92 I·J + c100 B·C 추가금      priceK = c92 K(자사몰 전용 선물 5kg) 추가금
//   hide   = c94 F + c92 L 미노출(selling F · display F)   hide97 = c97 B 미노출
//   끝에 apply 가 없으면 아무것도 안 바꾼다. 지금 값이 「바꾸기 전 기대값」도 「목표값」도 아니면 그 줄에서 멈춘다(남이 먼저 바꿨을 때).
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.'), SET = process.argv[3] || 'price', APPLY = process.argv[4] === 'apply';
const M = require(path.join(ROOT, 'scripts/desk/_mall'));
const PLAN = {
    price: [
        [94, 'P00000DQ000C', '가정용 - 5kg', 49800, 57800], [94, 'P00000DQ000D', '선물용 - 3kg', 38800, 41800], [94, 'P00000DQ000E', '선물용 - 5kg', 55800, 60800],
        [92, 'P00000DO000I', '가정용 - 5kg', 49800, 57800], [92, 'P00000DO000J', '선물용 - 3kg', 38800, 41800],
        [100, 'P00000DW000B', '선물용 - 3kg', 38800, 41800], [100, 'P00000DW000C', '선물용 - 5kg', 55800, 60800],
    ],
    priceK: [[92, 'P00000DO000K', '선물용 - 5kg', 55800, 60800]],
    hide: [[94, 'P00000DQ000F', '못난이 - 5kg', null, 37800], [92, 'P00000DO000L', '못난이 - 5kg', null, 37800]],
    hide97: [[97, 'P00000DT000B', '못난이 - 10kg', null, 68800]],
}[SET];
(async () => {
    if (!PLAN) throw new Error('묶음 이름: price | priceK | hide | hide97');
    const out = [], todo = [], prod = {};
    for (const [cno, code, frag, pay, payBefore] of PLAN) {
        const c = prod[cno] || (prod[cno] = await M.c24Product(cno)); const v = c.vars.find(x => x.code === code);
        if (!v) { out.push(`멈춤 | c${cno} ${code} 품목 없음`); continue; }
        if (!v.name.includes('황금향') || !v.name.includes(frag)) { out.push(`멈춤 | c${cno} ${code} 이름이 기대와 다름: ${v.name}`); continue; }
        const cur = c.base + v.add;
        if (pay == null) {   // 미노출
            if (v.selling === 'F' && v.display === 'F') { out.push(`이미 미노출 | c${cno} ${code} ${v.name}`); continue; }
            out.push(`미노출로 | c${cno} ${code} ${v.name} | 결제가 ${cur} | ${v.selling}/${v.display} → F/F`);
            todo.push({ cno, code, name: v.name, body: { selling: 'F', display: 'F' }, before: { add: v.add, selling: v.selling, display: v.display } });
        } else {
            const add = pay - c.base;
            if (cur === pay) { out.push(`같음 | c${cno} ${code} ${v.name} | ${cur}`); continue; }
            if (cur !== payBefore) { out.push(`멈춤 | c${cno} ${code} ${v.name} | 지금 ${cur} — 기대(${payBefore})도 목표(${pay})도 아님`); continue; }
            out.push(`바꿈 | c${cno} ${code} ${v.name} | 기본가 ${c.base} · 추가금 ${v.add} → ${add} | 결제가 ${cur} → ${pay}`);
            todo.push({ cno, code, name: v.name, body: { additional_amount: String(add) }, before: { add: v.add, selling: v.selling, display: v.display } });
        }
    }
    console.log(out.join('\n'));
    const stopped = out.some(l => l.startsWith('멈춤'));
    if (!APPLY || stopped || !todo.length) { console.log(stopped ? '\n멈춘 줄이 있어 아무것도 안 바꿈' : APPLY ? '\n바꿀 것 없음' : `\n계획만 — 바꿀 것 ${todo.length}개(쓰기 0)`); await M.pool.end(); return; }
    const res = [];
    for (const t of todo) { const r = await M.c24({ action: 'raw', method: 'PUT', path: `/api/v2/admin/products/${t.cno}/variants/${t.code}`, body: { shop_no: 1, request: t.body } }); res.push({ cno: t.cno, code: t.code, ok: M.c24Ok(r), err: M.c24Ok(r) ? undefined : JSON.stringify(r).slice(0, 160) }); console.log(M.c24Ok(r) ? 'PUT 성공' : 'PUT 실패', 'c' + t.cno, t.code); }
    await M.pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ('cafe24_variant_update','cafe24_product',NULL,$1,'orchestrator','클코 총괄(대표 지시 #686)')`, [JSON.stringify({ tool: '686-c24', set: SET, todo, results: res })]);
    console.log('90초 뒤 다시 읽어 확인…'); await M.sleep(90000);
    for (const cno of [...new Set(todo.map(t => t.cno))]) { const c = await M.c24Product(cno); for (const t of todo.filter(x => x.cno === cno)) { const v = c.vars.find(x => x.code === t.code); console.log('확인', 'c' + cno, t.code, '결제가', c.base + v.add, v.selling + '/' + v.display); } }
    await M.pool.end();
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
```

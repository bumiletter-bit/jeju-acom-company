# #733-C 전체 가격 확인에 쿠팡 — 계약 (워커2 · 2026-10-18)

> 모듈 = `price-check.js`(워커2 · 끝) · 화면 = `public/ao-desk.js` 가격 카드(워커2 · 끝) · **server.js 연결 2~3줄 = 워커1**. 근거 = `docs/728-coupang-contract.md`(옵션 inventories 읽기) · 시험 = 워커2 스크래치 t733p 16/16 · `scripts/verify-612-price.js` 37/37.

## 1. server.js 에 넣을 것(워커1 · `/api/price-check` 한 곳)
지금 `mod.build({ pool, cafe24Get: require('./cafe24.js').apiGet, cfg: { naverCfgGet }, log: console })` 에 **`coupangGet` 하나만** 더 넘긴다.

```js
coupangGet: async (vid) => cpwItemOf(cpwData(await naverRelay.callCoupang({ method: 'GET', path: CPW_PATH.inventory(vid) }, null))),
```
- `cpwItemOf`·`cpwData`·`CPW_PATH` = #728 블록 것 그대로({ price, stock, on_sale } · code ERROR 면 throw). `notify` 는 null(옵션마다 실패해도 텔레그램 없음).
- 간격·실패 처리 = 모듈이 한다(옵션 사이 0.5초 · 한 옵션이 throw 하면 그 줄만 「못 읽음」 · 429 도 같음 · 재시도 없음).
- 캐시 = 기존 10분 그대로(쿠팡 호출은 연결표 옵션 수만큼 · 10분에 한 번).
- 🔴 연결표가 비면 쿠팡을 아예 안 부른다(지금 실DB = 비어 있음 → 배포해도 쿠팡 호출 0 · 보고에 「쿠팡: 연결 안 됨」 한 줄만).

## 2. 연결표 `agent_office_config 'coupang_item_map'`
```json
{ "<vendorItemId>": { "seller_product_id": "9001", "product_name": "쿠팡 상품명", "item_name": "쿠팡 옵션명",
                      "bot_product_id": 211, "label": "단가표 이름", "separate": false, "ignore": false, "note": "…" } }
```
- 키 = 쿠팡 옵션 번호(숫자만 · 그 밖 키는 무시). `ignore:true` = 안 읽음.
- 묶음(같은 옵션) 찾기 순서 = `bot_product_id`(판매현황 이름) → `label`(단가표 이름) → **자동 매칭**(`product_name` + `item_name` 을 네이버와 같은 매칭기 `optionKey` 로).
- `separate:true` = 표에는 보이지만 네이버와 견주지 않음(쿠팡 값을 따로 받는 옵션).
- 쓰는 곳 = 창구 `coupang-item.js map`(보기·자동 제안·지정) · 서버는 읽기만.

## 3. 보고에 늘어난 것(옛 칸 무변경)
- `pages[]` 에 `channel:'coupang'` · `key:'coupang:<상품 번호>'`(번호 없으면 `coupang:v<옵션 번호>`) · `tier` = 설정 `price_check_pages['coupang:…']` 또는 이름 규칙.
- `groups[].rows[]` 쿠팡 줄 = `{ channel:'coupang', price(salePrice), sold(판매중·재고>0), vid, separate?, read_error?, changed_unknown:true }`.
- `issues` 새 종류: `coupang_vs_naver`(쿠팡 값 ≠ 같은 묶음 네이버 일반 페이지 값(여럿이면 가장 많은 값) · 어긋남으로 셈) · `coupang_unmatched`(네이버 짝 없음 · 참고).
- `source.coupang` = `live`|`given`|`none`|`error` (종전 `excluded` 는 없어짐) · `source.coupang_mapped`·`coupang_read`·`coupang_failed` · `summary.pages_coupang` · `summary.coupang_unmatched[vid]`.
- 쿠팡 줄은 「페이지끼리 값 다름」·「VIP 가 더 비쌈」 셈에 섞이지 않는다(쿠팡 ↔ 네이버 에서만).

## 4. 화면(ao-desk.js · v=86)
- 칩 `쿠팡≠네이버`(어긋남) · `쿠팡 짝 없음`(참고) · 줄 채널 글 「쿠팡」 · 머리 안내 줄 끝에 쿠팡 한 줄(연결 안 됨 / 조회 못 함 / 「쿠팡은 방금 값 · 연결 n개 · 못 읽음 n · 연결 안 됨 n」). 옛 서버(`coupang:'excluded'`)면 그 줄 없음.

## 5. 미확정
- 쿠팡 salePrice = 손님 결제가로 봄(쿠팡 즉시할인·쿠폰은 반영 안 됨 — 쿠팡 쪽 할인을 쓰면 「따로」로).
- 실DB 연결표 0 → 첫 연결 뒤 실값으로 확인.

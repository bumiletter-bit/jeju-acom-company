# #720-B 네이버 상품 쓰기 러너 — 계약서 (서버 ↔ 창구 도구)

> 시공: 워커1(server.js) · 창구 도구(워커2)가 이 이름 그대로 쓴다. **이름·꼴을 바꾸면 총괄·워커2에게 먼저 알린다.**
> 코드 = server.js 「// #720-B 시작」~「// #720-B 끝」 블록 + 그 바로 아래 러너(20초 틱) · 표 `naver_product_backups`(initDB) · 라우트 1개.
> 근거 = `docs/720-naver-write-api.md`(워커3 · 공식 문서·포럼) + 10/17 실조회(VIP 10801253976 · 30초 간격 2회 · 차이 0).
> 검증 = `node scripts/verify-720-write.js`(실DB·네이버 0 · 가짜 pool·가짜 네이버 · 72항목).

## 1. 1차 범위
| patch 키 | 네이버 길 | 비고 |
|---|---|---|
| `detail_html` | `PUT /external/v2/products/channel-products/{채널번호}` — 보관본(조회 응답 통째)을 깊은 복사해 `originProduct.detailContent` 만 바꿔 **통째** PUT | 「포함 안 한 정보는 제거」 규칙 → 통째가 정본 |
| `status` | `PUT /external/v1/products/origin-products/{원상품번호}/change-status` 바디 `{ statusType }` 하나 | 원상품 번호는 backup 때 `POST /external/v1/products/search` 로 풀어 보관본에 저장 |
| `stock` | **1차 제외** — 고정 문구 「옵션 상품 재고는 2차(옵션 재고 통째) · 지금은 스마트스토어센터에서」로 거절 | 우리 상품 = 옵션 상품 · 상품 재고 = 옵션 재고 합(실측) |

- 판매 상태 값 = `SALE` · `SUSPENSION` · `OUTOFSTOCK`. 허용 전이 = SALE→OUTOFSTOCK/SUSPENSION · OUTOFSTOCK→SUSPENSION · SUSPENSION→SALE · WAIT→SUSPENSION. **OUTOFSTOCK→SALE 은 재고 입력이 필요해 1차 거절**(2차). 같은 상태로 바꾸기도 거절.
- 상세 HTML: 빈 글 · **320,000자 초과**(문서 상한 미명시 → 지금 최장 105,636자의 약 3배) · 금지 태그 `html·meta·script·style·body·head` → 거절.
- 통째 PUT 때 카탈로그 매칭 상품(`naverShoppingSearchInfo.catalogMatchingYn=true`)은 `naverShoppingSearchInfo` 를 빼고 보낸다. `NPW_STRIP`(읽기 전용 칸) = 비어 있음 · `NPW_VOLATILE`(조회마다 바뀌는 칸) = 비어 있음.

## 2. 원칙(코드가 강제)
1. **backup**(상품 통째 보관) 없이는 apply 못 함 — apply 는 `backup_id` 로만 받는다.
2. **apply** 전에 다시 조회해 보관본과 다르면(보관한 뒤 누가 고침) **쓰지 않고 거절**(`drift_paths`) → 새로 backup.
3. 한 보관본은 한 번만 apply(두 번째는 거절 → 새로 backup).
4. 쓰기 뒤 재조회 → 보관본과 깊은 비교 → `changed_paths` · 바뀌면 안 되는 곳이 바뀌었으면 `unexpected_paths` 로 **보고**(실패 아님). 상태를 바꾸면 네이버가 같이 움직이는 재고 칸(상품 재고 · 옵션 조합 재고)은 예상 범위.
5. 쓰기가 하나라도 성공하면 재조회 **전에** `applied_at` 을 적는다(뒤가 실패해도 revert 가능).
6. **revert** = 바디는 **지금 값(재조회) 깊은 복사 + 우리가 바꾼 칸만 보관본 값**(상세 · 품절로 0 이 된 옵션 조합 재고 = 적용 뒤도 0 · 지금도 0 인 조합만) → 필요할 때만 통째 PUT → 상태가 아직 다르면 change-status 로 보관본 값 → 재조회 → `residual_paths`(재고 칸 뺀 차이) 0 이면 `same_as_before: true`. 남의 변경·판매로 줄어든 재고는 덮지 않는다(과판매 방지). 적용한 뒤 네이버에서 또 바뀌었으면(재고 칸 제외) `force: true` 없이는 거절 · force 여도 남의 변경은 유지되고 `residual_paths` 로 보고.
6-1. **재고 칸**(상품 재고 · 옵션 조합 재고)은 주문으로 늘 움직이므로 신선도·잔여 대조에서 빼고 `stock_paths` 로 따로 보고. apply 의 통째 PUT 바디도 보관본이 아니라 **지금 값** 위에 상세만 바꾼다.
6-2. **승인**: apply · revert force 는 「지시 작성자 = 대표(role admin + position 대표)」 또는 「`pending_orders.result.approved_at` 있음(화면 [승인])」 또는 「시험 번호 계정(created_by_id ≥ 990000)」일 때만 — 아니면 `승인 뒤 실행`. backup · revert(force 없음) · upload_image 는 승인 불요.
6-3. 네이버 호출 사이 400ms · 그림 올리기만 중계 대기 60초(naver-relay.js `timeoutMs` 옵션 · 기본 20초).
6-4. 상세 금지 태그는 **보관본보다 늘었을 때만** 거절(태그별 개수 비교 — 원래 있던 것은 네이버가 받아 둔 것).
6-5. audit `targetId` = null(audit_logs.target_id INTEGER 라 상품 번호가 넘침) · 상품 번호는 `changes.product_no`.
7. 같은 상품 번호에 작업 진행 중이면 거절 · 그림 올리기는 동시에 1건만(계정 단위).
8. 지시(`order_id` = pending_orders.id)가 없거나 지워졌거나 「반려」면 거절.
9. 모든 op = `audit_logs` (source `naver-product-write` · action `naver_product_backup|apply|revert|image_upload`).
10. 네이버 오류 원문은 서버 로그만. 결과엔 고정 문구 + `code`. 통째 PUT 400 이면 네이버가 짚은 **칸 이름만** 보관본 `result_json.invalid_fields` 에(→ `NPW_STRIP` 채우는 근거).

## 3. 주고받는 길
- 요청: `agent_office_config` key **`naver_product_write_request`**
- 결과: key **`naver_product_write_result`** — 러너가 요청을 **먼저 지우고**(선제거) 처리 뒤 기록. 공통 칸 `at`(ISO) · `order_id` · `ok` · `op` · 실패면 `error`(사람 말) · 네이버 실패면 `code` · 중간 실패면 `steps_done`.
- 틱 = 20초 · 요청 칸 하나 = 한 번에 한 요청(앞 결과 `at` 을 보고 다음 요청).

## 4. op 별
### backup
`{ op:'backup', product_no:'채널번호', order_id, created_by? }` → `{ ok, op, product_no, origin_product_no|null, backup_id, summary:{ status, stock, name, detail_len, images_n, options_n } }`
- 원상품 번호를 못 풀어도 보관은 됨(그 보관본으로는 상태 변경만 거절).

### apply
`{ op:'apply', order_id, backup_id, patch:{ detail_html?, status? } }` (`product_no` 를 주면 보관본과 같아야 함)
→ `{ ok, op, product_no, backup_id, steps:['detail'|'status'], changed_paths[], unexpected_paths[], not_applied[], before_summary, after_summary }`
- `not_applied` = 재조회 값이 patch 값과 글자 그대로 같지 않은 키(네이버가 HTML 을 다듬었거나 지연 — 확인용).

### revert
`{ op:'revert', order_id, backup_id, force? }` → `{ ok, op, product_no, backup_id, steps:['channel'|'status'], same_as_before, residual_paths[], after_summary }`

### #721-B 1 — 품절 → 판매 복귀 · 「판매 정상 확인」(sale_ok)
- **sale_ok** = `{ ok, bad:[], status, stock_total, options_n }` — backup(건들기 전 · 보관본 자기 자신과 대조) · apply(재조회 vs 보관본) · revert(재조회 vs 보관본) 결과에 늘 붙음 · 보관본 result_json(`sale_ok` · `revert_sale_ok`)과 audit 에도.
  - ok = 아래 전부: `statusType` SALE · 옵션 `usable:false` 0개 · 재고 합(옵션 합 · 옵션 없으면 상품 재고) > 0 · `salePrice` · 옵션별 `price`(id 기준) · `detailContent` 바이트 · 대표 그림 url 이 보관본과 같음.
  - 하나라도 아니면 `bad` 에 칸 이름: `status` · `options_usable` · `stock` · `sale_price` · `option_price` · `detail` · `rep_image`. (품절·판매중지로 바꾼 apply 는 `status`·`stock` 이 bad 인 게 정상.)
- **품절 → 판매**(apply status SALE · 또는 품절 apply 의 revert) = **채널 상품 통째 PUT 하나**(지금 값 위에 · 지금 0 인 옵션 재고만 보관본 값 · `statusType:'SALE'`) — change-status 는 SALE↔SUSPENSION 에만(워커3 문서 2차 ④). 옵션 상품의 상품 단위 `stockQuantity` 는 안 고침(합 불일치 400).
  - apply 는 보관본 재고 합 0 이면 거절(「품절 → 판매는 재고가 있어야 해요」 · 옵션 재고 입력은 B3).
  - 안전망(총괄 10/17): PUT 뒤 재조회가 SALE 이 아니면 change-status `{ statusType:'SALE' }` 를 **한 번 더**(문서상 400 날 수 있음) · 시도 기록 `attempts:[{ via:'channel'|'change-status', code, status_after }]`(성공 결과엔 `sale_attempts`).
  - 그래도 SALE 이 아니면 **오류**: `{ ok:false, error, code, steps_done, attempts, status_after_put, status_now, stock_total_now, stock_restored, sale_ok, note }` · note = 「재고 0 이라 품절 유지」 또는 「통째 PUT·change-status 뒤에도 판매중이 아님」 · revert 는 `reverted_at` 을 안 적음(보관본 result_json.revert_failed).
  - revert 성공 결과에 `status_after_put`(PUT 직후 상태).

### #721-B 3 — 옵션·단가·품목명(2차 · 계약 먼저 · 코드는 B2 뒤)
apply `patch` 에 키 3개 추가(기존 detail_html · status 와 같이 써도 됨 · 통째 PUT 한 번에 모음):
```
patch: {
  options:    [{ id, name1?, name2?, name3?, price?, stock?, usable? }],   // 최대 20개
  sale_price: 29000,                                                     // → originProduct.salePrice
  name:       '제주 하우스감귤 …',                                        // → originProduct.name (+ 아래 규칙)
}
```
- **options**: `id` = 지금 상품(재조회 cur)의 `optionCombinations[].id` 에 있어야 함 · 없는 id·id 없는 항목(새 옵션) = 거절(3차) · 같은 id 두 번 = 거절 · **삭제 금지**(배열에서 빼지 않음 · 숨김은 `usable:false` 로만). 준 칸만 cur 위에 바꾸고 나머지 칸(sellerManagerCode·skuYn·optionName4 등)은 그대로. `name1~3` → `optionName1~3` · `price` → 옵션 추가금 칸 `price` · `stock` → `stockQuantity` · `usable` → `usable`.
- **sale_price** → `originProduct.salePrice`. **할인(customerBenefit)은 절대 안 건드림**(키 없음 · 바디는 cur 값 그대로).
- **name**: `originProduct.name` 을 바꾸고, `smartstoreChannelProduct.channelProductName` 이 차 있으면 같은 글로 둘 다 · 비어 있으면 name 만.
- 상한(거절): sale_price 정수 아님·0 이하 · 바뀐 결제가(아래)가 보관본 대비 10배 이상 또는 1/10 이하 · 결제가 0 이하 · stock 음수·정수 아님 · name 빈 글·100자 초과 · options 21개 이상.
- 재고: patch 에 stock 이 있으면 그 옵션 재고 칸은 **기대 경로**(대조 안 · unexpected 아님) · 없으면 종전대로 stock_paths 로 따로.
- 전이표 무관(상태와 별개) · 승인·신선도·보관본 1회·동시 거절은 종전 그대로.

결과(apply · revert 공통 추가 칸):
```
options_table: [{ id, before:{ name, price, stock, usable, pay }, after:{ … } , changed:['name'|'price'|'stock'|'usable'|'pay'] }],
price_basis:   { sale_price_before, sale_price_after, discount:{ unitType:'PERCENT'|'WON'|null, value } },
option_ids_kept: true|false,   // 재조회에서 id·sellerManagerCode 가 그대로인지 — 아니면 unexpected_paths 에 'option_regenerated:<id>'
sale_ok: { … }                 // B1 칸 · 단 가격·옵션을 바꾼 apply 는 ref = 「보관본 + patch」 기대값이라 바꾼 칸은 bad 에 안 들어감
```
- `pay`(결제가) = `salePrice − 즉시할인 + 옵션 price` · 즉시할인 = `customerBenefit.immediateDiscountPolicy.discountMethod` — WON 이면 value · PERCENT 이면 floor(salePrice × value / 100) · 없으면 0. 🔵 PERCENT 끝자리 처리(원 단위 절사 여부)는 첫 실조회를 스냅샷 결제가(discPrice+price)와 맞춰 확정(워커3 문서 2차-2).
- `changed_paths` 에 옵션별 전 → 후는 options_table 로 · 경로 문자열은 종전 꼴(`originProduct.detailAttribute.optionInfo.optionCombinations[n].price` 등).
- revert = 우리가 바꾼 칸만 보관본 값으로(지금 값 위에 · 남의 변경·판매로 줄어든 재고는 안 덮음 · 단 patch 에 stock 이 있던 옵션은 보관본 재고로).

**v5.9.542 손질(실측 10/17 레드키위 반영 · 아래 v5.9.541 줄보다 우선)**
- 실측: 통째 PUT 바디 `statusType` 을 바꾸면 400(invalidInputs `originProduct.statusType`) → **품절 걸기 = 바디에서 옵션 재고만 전부 0(statusType 은 지금 값 그대로)** → 재조회가 OUTOFSTOCK 이 아니면 `not_applied:['status']`. **풀기 = 재고만 채운 통째 PUT → 재조회 SALE 아니면 change-status SALE 1회**(attempts 에 둘 다). 되돌려 다시 품절로 = 재고 0 PUT.
- 실측: **통째 PUT 은 상세를 안 바꿔도 네이버가 상세를 걸러 냄**(옵션 재고 −1 PUT 에서 71,083 → 62,996자 · 그림 링크 4곳 끊김) → **모든 통째 PUT 바디의 detailContent 에 `naver-detail-links.convertImageLinks`(fromComments 기본)를 적용**(속성·걸러진 주석의 그림 링크 → 일반 `<a href target=_blank rel=noopener>`). 결과 `links_converted`(보낸 링크 수) · `links_after`(재조회 상세의 일반 http href 수 — 네이버가 남기는지 판정 칸). 상세가 달라진 것은 `unexpected_paths` 에 그대로 보임(숨기지 않음).
- **통째 PUT 잠금**: 통째 PUT 을 타는 apply(상세·옵션·판매가·품목명·품절 걸기/풀기)는 설정 `agent_office_config 'naver_product_write'.put_enabled === true` 일 때만 · 아니면 「통째 수정은 네이버가 상세 편집기 자료를 걸러 대표 확정 대기 — 지금은 판매중지/재개만」. 상세는 그 안에서 `detail_enabled` 로 한 번 더. 판매중지·재개(change-status)는 늘 열림 · 시험 번호 계정(≥990000) 지시는 두 잠금 통과 · revert 는 잠금 무관.
- 실패 step 이름: 상세만(+판매중지·재개) PUT = `'detail'` · 그 밖 통째 PUT(품절 걸기 포함) = `'channel'`.
- 실측: 옵션 `price` = 판매가 대비 추가금 · 음수 가능(레드키위 3kg −17,000).

**구현 확정(v5.9.541 · 위 초안과 다른 점·더한 점)**
- **판매 상태 길 정정(#721-B2 실측 10/17 · 레드키위 change-status OUTOFSTOCK = 400)**: 품절 걸기 = 통째 PUT 하나(지금 값 위에 옵션 재고 전부 0 + `statusType:'OUTOFSTOCK'`) · 품절 풀기 = B1 toSale · change-status 는 SALE↔SUSPENSION 만. 전이표 = `SALE → OUTOFSTOCK·SUSPENSION` · `OUTOFSTOCK → SALE` · `SUSPENSION → SALE`(품절 → 판매중지 · WAIT 는 거절). 원상품 번호는 판매중지·재개 때만 필요.
- 한 apply 의 칸은 통째 PUT **한 번**에 모음 · 판매중지/재개가 같이 있으면 PUT 뒤 change-status · `steps` = `['detail']`(상세만) · `['channel']`(그 밖 PUT) · `['status']` · 조합.
- **auto_sale**: 지금 품절이고 `status` 없이 `options[].stock > 0` 을 주면 판매 복귀 길(toSale)을 같이 탐 → 결과 `auto_sale:true`. 되돌리면 통째 PUT 으로 다시 품절(옵션 재고 0).
- `status:'SALE'`(품절 → 판매)에 `options[].stock` 을 같이 주면 그 재고로 · 안 준 옵션은 보관본 재고(0 이면 그대로) · 합이 0 이면 거절.
- **sale_ok ref** = apply 는 보관본 + patch(일부러 바꾼 가격·숨긴 옵션·상세는 bad 아님) · backup·revert 는 보관본. `options_usable` 은 ref 에서 숨김이 아닌 옵션이 숨겨졌을 때만 bad.
- 결과 칸(apply): `steps, auto_sale, changed_paths, unexpected_paths(+ 'option_regenerated:<id>'), not_applied(키 또는 'options.<id>.<칸>'), stock_paths, sale_ok, sale_attempts, options_table, price_basis, option_ids_kept, before_summary, after_summary`. revert 도 `options_table`(지금 → 되돌린 뒤) · `price_basis` · `option_ids_kept`.
- 거절 문구(쓰기 0): 새 옵션(id 없음) · 없는 id · 같은 id 두 번 · 바꿀 칸 없음 · 지금과 같은 값(옵션·판매가·품목명) · 모르는 옵션 칸 · 옵션명 1~50자 · 추가금 정수 · 재고 0 이상 정수 · usable true/false · 옵션 21개↑ · 판매가 0 이하·정수 아님 · 품목명 빈 글·100자 초과 · 결제가 0 이하 · 결제가 10배↑/10분의 1↓ · 품절 + 옵션 재고 동시 · 상품 단위 `stock` 키(「재고는 옵션별로」) · `customerBenefit` 등 허용 밖 키.

### create(#723-C · 있는 상품을 본떠 새 상품 등록 · v5.9.543 · 근거 = docs/720-naver-write-api.md 「3차 신규 등록」)
`{ op:'create', order_id, from_product_no, name, options?:[{ name1, name2?, name3?, price, stock? }], sale_price?, stock?(옵션 없는 상품), hidden?(기본 true) }`
→ `{ ok, op, product_no(새 채널 번호), origin_product_no, from_product_no, backup_id, found_by:'response'|'search', hidden, hidden_forced, hidden_ok, status_now, display, shopping, status_step, rep_image, links_converted, links_after, summary, sale_ok }`
- **바디** = 본뜰 상품 조회 응답 두 객체(originProduct + smartstoreChannelProduct) 깊은 복사 → 이름(+채널 상품명이 있으면 같은 글)·판매가·옵션만 바꿈 · 상세 안 그림 주소 그대로(그림 링크는 일반 href 로).
- **뺄 칸** = 점 경로 배열 · 코드 기본 `NPW_CREATE_STRIP`(originProduct.originProductNo · smartstoreChannelProduct.channelProductNo · originProduct.regDate · originProduct.modifiedDate · originProduct.detailAttribute.naverShoppingSearchInfo · originProduct.detailAttribute.seoInfo) · **설정 `naver_product_write.create_strip`(배열)이 있으면 그것으로 덮음**(첫 등록 400 의 칸 이름을 보고 총괄이 설정만 고쳐 다시 넣음 · 재배포 없음) · 옵션 id·sellerManagerCode 는 코드가 따로 뺌.
- **옵션** = id 없이 새로 · 재고 기본 99999(대표 관례 · stock 주면 그 값) · `useStockManagement:true` · 상품 재고 = 옵션 합. options 를 안 주면 본뜬 옵션을 새 옵션으로(재고 99999).
- **대표 그림** = 본뜬 상품 대표 그림(우리 그림 CDN `shop-phinf.pstatic.net` 주소만)을 받아 그림 올리기 API 로 다시 올린 새 주소(「upload API 가 준 URL 만」 #1964 · 그림 올리기 실검증 겸함) · 받기·올리기 실패면 등록 안 함.
- **비노출(기본)** = 등록 바디 `originProduct.statusType:'SALE'`(실측 10/17: 'WAIT' 등록 = 400 invalid statusType · 설정 `create_status` 가 있으면 그 값) + `smartstoreChannelProduct.channelProductDisplayStatusType:'SUSPENSION'` + `naverShoppingRegistration:false` → 등록 성공 뒤 원상품 번호로 change-status `SUSPENSION`(WAIT → SUSPENSION) → 재조회로 `hidden_ok`(SUSPENSION · SUSPENSION · false) · 결과 고정 칸 `status_now`(WAIT/SUSPENSION) · `display` · `shopping`. 판매중지 전환이 실패하면 `status_now:'WAIT'` · `status_step.ok:false` 로 남음 → 창구 apply `{ status:'SUSPENSION' }` 로 풂(전이표 `WAIT → SUSPENSION` · WAIT → SALE 은 없음).
- **판매 시작(전시 ON · 네이버쇼핑 등록 · SALE)은 create 밖**(센터 또는 다음 확장). 노출(`hidden:false`)은 설정 `create_enabled === true` + 대표/승인 지시 + 이름에 「테스트」가 있을 때만(오늘 규칙) · 시험 번호 계정은 늘 비노출 · 못 열면 `hidden_forced:true`.
- **번호** = 응답의 `smartstoreChannelProductNo`·`originProductNo`(칸 이름 미확정 → 응답 원문을 서버 로그 「상품 등록 응답 원문」 에 통째로) · 없으면 `/v1/products/search` 에서 같은 이름의 가장 큰 채널 번호(`found_by:'search'`).
- **실패** = 1요청 1회(러너 재시도 없음) · 400 은 응답에 고정 문구 + `invalid_fields` 칸 이름만 · 보관본 행(`result_json.op:'create_failed'` · invalid_fields · strip · rep_image · before_json = 본뜬 상품)에 남김 · 상한엔 안 셈.
- **등록됐을 수 있는 경우**(응답·검색 모두 번호 없음 · 새 번호 재조회 실패) = 보관본 행 `result_json.op:'create_unknown'`(before_json = 본뜬 상품 · 이 행으로 apply·revert 거절) · 상한에 셈(중복 등록 방지) · 번호 못 찾음은 ok:false · 재조회 실패는 ok:true + `backup_id:null` + `error_note`.
- 대표 그림 받기 = 다른 곳으로 넘기는 응답 안 따라감(redirect error) · content-length 10MB 초과면 받기 전에 거절 · 받은 뒤에도 10MB 검사 · 20초.
- 승인 필요(apply 와 같은 선 · 시험 계정 통과) · 24시간 3개 상한(성공 + create_unknown) · 동시 1건 · audit `naver_product_create` · 성공 보관본(`result_json.op:'create'` · before_json = 생성 직후 재조회) 뒤로는 backup·apply·revert 종전 길.

### upload_image
`{ op:'upload_image', order_id, order_ids:[…] }` — `order_ids` 생략이면 `[order_id]` · 최대 10 · 합계 10MB 미만.
- 각 지시의 첨부 = `pending_orders.image_data`(data URL · 지시 1건당 1장) · jpg/png/gif/bmp 만(MIME 실제값 그대로).
- `POST /external/v1/product-images/upload` · body `{ __multipart: { field:'imageFiles', files:[{ name, mime, b64 }] } }` → 중계(/naver)가 이 경로에서만 FormData 로(워커2).
→ `{ ok, op, urls[] }` · 받은 주소 수 ≠ 올린 수면 `ok:false`. 주소를 상세에 넣는 것은 창구가 `detail_html` 의 `<img src>` 로 apply.

## 5. 표 `naver_product_backups`
`id · product_no(채널) · origin_product_no · order_id · before_json(jsonb 통째) · patch_json · after_json · applied_at · reverted_at · result_json · created_by · created_at`

## 6. 관리자 조회 라우트
`GET /api/agent-office/naver/product-backups?product_no=` (adminOnly · 최근 20) → `{ items:[{ id, product_no, order_id, created_by, created_at, applied_at, reverted_at, patch_keys, before_summary, after_summary, result }] }` — 본문 통째는 안 줌.

## 7. 중계 허용 목록(워커2 · 워커3 문서 ⑦)
채널 PUT · change-status PUT · 그림 POST 3줄 + 그림 경로의 multipart. 조회 GET · search POST 는 이미 허용.

## 8. 남은 위험·미확정
- 조회 응답을 그대로 PUT 해도 되는지(읽기 전용 칸) = 첫 실 PUT 으로 확정 → 400 이면 `result_json.invalid_fields` 보고 `NPW_STRIP` 추가.
- 상세 HTML 안 외부 그림 주소 = 미명시 → ⑤로 올린 주소만 쓸 것.
- 통째 PUT 이 `statusType` 을 같이 바꾸는지 = 미확인(바디엔 보관본 값 그대로라 무해) · revert 는 재조회로 상태를 보고 다르면 change-status 로 마저 맞춤.
- 첫 실 PUT = 배포 뒤 VIP 10801253976 상세 맨 아래 한 줄(총괄 줄 세움) · 사람 손 복구용 원본 = 워커1 스크래치 `720/p1.json`.

## 9. 알려진 한계 — 네이버 상세 거름(#720-D · 10/17 첫 실 PUT · VIP 10801253976)
- 상세 HTML 을 API 로 PUT 하면 네이버가 저장 때 거른다(실측): ①스마트에디터 `<script type="text/data">` 블록 43개(에디터 재편집용 모듈 자료) 통째 삭제 ②그림 링크 `<a>` 33개의 `onclick` · `data-linktype` · `data-linkdata` · 빈 `style` 삭제 ③우리가 넣은 `style="display:none"` 삭제(→ 숨김 글이 보이는 글이 됨). 지운 자리에 `<!-- Not Allowed Attribute Filtered ( … ) -->` 주석을 남김(34개). 그림 33장·src·글은 그대로.
- 결과: 105,636자 → 적용 93,739자 → 되돌림 93,660자. **되돌리기도 같은 거름을 거쳐 원본 바이트로는 못 돌아감**(잔여 = detailContent 하나 · 다른 칸 0). 원본 = 보관본 id 1 before_json.
- 그래서 서버가 상세 수정을 잠근다: 설정 `agent_office_config 'naver_product_write'` = `{ detail_enabled: true }` 일 때만 `detail_html` apply · 행 없음·false = 「상세 수정은 대표 확정 대기 — 네이버가 스마트에디터 자료를 걸러 원본 복구가 안 됨(#720-D)」 거절. 판매 상태는 그대로 허용.
- 판매 상태 왕복(SALE → SUSPENSION → SALE)은 실측 정상 · 잔여 0 · 상세 바이트 동일.
- 다음 바퀴 후보(지금 안 함): 상세 갈래 잔여 비교를 「거름 적용한 원본」 기준으로 · 숨김 표시는 style 대신 HTML 주석 · 품절 → 판매 복귀는 change-status 에 stockQuantity(조합 합) — 문서 ④ 「품절에서 판매 중으로 변경 시 재고 수량 입력 필수」.

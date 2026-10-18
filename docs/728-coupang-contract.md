# #728 쿠팡 옵션 쓰기 — 러너 계약 (1차: 가격 · 재고 · 판매중지/재개)

> 근거 = `docs/728-coupang-write-api.md`(워커3 · 공식 문서) · 코드 = server.js `// #728 시작` ~ `// #728 끝` (`coupangItemWriteRun`) · 검증 = `node scripts/verify-728-coupang.js`(가짜 pool·가짜 쿠팡 · 실DB·쿠팡 호출 0).
> 네이버 #720(통째 PUT)과 달리 **칸마다 따로 있는 전용 PUT** — 다른 칸·상세는 안 건드림 · 즉시 반영(승인 심사 없음). **한 요청 = 한 칸.**

## 요청 / 결과
- 요청 `agent_office_config 'coupang_item_write_request'` → 결과 `'coupang_item_write_result'`(러너 20초 틱 · 요청 선제거 · 결과에 `at`·`order_id`).
- 쿠팡 호출은 `naverRelay.callCoupang` 직접(**재시도 없음** — 429 는 몇 분 차단이라 재시도 무의미 · 쓰기 두 번 방지) · 호출 사이 0.5초(쿠팡 vendorId 초당 5회).
- 쿠팡 응답 `{ code, message, data }` — HTTP 200 이어도 `code` 가 `SUCCESS`(또는 200)가 아니면 실패.

## op
| op | 입력 | 하는 일 | 결과 |
|---|---|---|---|
| `list` | `{ q? }`(지시 불필요 · 읽기만) | 판매자 상품 목록(쪽 nextToken · q = sellerProductName) → 상품마다 단건 조회(items) → 옵션마다 inventories | `products[{ sellerProductId, name, status(승인 상태 statusName), vendorItems[{ vendorItemId, itemName, salePrice, quantity, saleStatus: ON_SALE\|STOP }] }]` · `truncated`(상품 30 · 옵션 80 상한) |
| `backup` | `{ order_id, vendor_item_id, seller_product_id, created_by? }` | 옵션 지금 값(inventories) + 단건 상품의 그 item(이름·상품 번호) → 표 `coupang_item_backups` 1행 | `backup_id` · `before{ price, stock, on_sale, item_name, seller_product_id, product_name }` · `sale_ok` |
| `apply` | `{ order_id, backup_id, patch }` | 검사 → 신선도 → 전용 PUT → 재조회(2초 · 기대와 다르면 5초 뒤 한 번 더) → 대조 | `before`(PUT 직전 값) · `after` · `changed` · `unexpected` · `not_applied` · `sale_ok_before` · `sale_ok` · `item_name` · `scope_note` |
| `revert` | `{ order_id, backup_id, force? }` | 적용한 칸만 보관본 값으로 같은 전용 PUT → 재조회 대조 | `put`(이미 원래 값이면 false · PUT 없음) · `before_put` · `now` · `same_as_before` · `unexpected` · `sale_ok` |

## patch (한 칸만)
| 칸 | 값 | 전용 PUT | 거절 |
|---|---|---|---|
| `price` | 정수 | `PUT …/vendor-items/{id}/prices/{price}`(쿼리 없음 · forceSalePriceUpdate 안 씀) | 0 이하·음수·정수 아님 · **10원 단위 아님** · **지금 가격의 −50%~+100% 밖(「윙에서」)** · 지금과 같음 |
| `stock` | 0 이상 정수 | `PUT …/vendor-items/{id}/quantities/{n}` | 음수·소수 · 99999 초과 · 지금과 같음(0 은 허용) |
| `sales` | `'stop'` \| `'resume'` | `PUT …/vendor-items/{id}/sales/stop` · `…/sales/resume` | 그 밖 값 · 이미 그 상태 |
- 그 밖 칸(상품명·상세·이미지 등) = 거절 + 「승인 필요 칸(전체 수정 = 쿠팡 심사행)이라 2차」 · 성공 결과에도 `scope_note` 로 같은 글.
- 승인 검사 없음(#727 과 같음) — 지시가 있고 반려·삭제 아니면 실행 · 되묻기 1회는 창구 규칙 몫.

## 판정
- **sale_ok(쿠팡판)** = `on_sale === true` · `stock > 0` · `price > 0` 이고 기대 가격과 같음 → `{ ok, bad[] }`(bad = on_sale · stock · price · read). 중지·재고 0 은 그대로 ⚠ 로 보고(숨기지 않음).
- **신선도(apply)** = 보관본과 지금 값의 price·on_sale 이 다르거나 재고가 **늘었으면** 거절(`drift`) · 주문으로 재고가 준 것은 통과(지금 값 기준으로 진행).
- **revert** = 적용 뒤 그 칸이 또 바뀌었으면 거절(`force: true` 면 덮음) · 재고가 주문으로 준 것은 통과.
- `changed` = PUT 직전 값 대비 바뀐 칸 · `unexpected` = 고친 칸 말고 바뀐 칸(주문으로 준 재고 제외) · `not_applied` = 재조회 두 번 뒤에도 기대 값이 아님.
- 재조회 실패 = `ok:true` + `error_note`(「Wing 에서 확인」) · after_json null.

## 실패 꼴
- 고정 문구 `쿠팡 ○○ 실패` + `code` + `coupang_message`(원문 200자) · **429 = `note` 「쿠팡 호출 한도(초당 5회) — 몇 분 뒤 다시」**(재시도 0) · 재개 실패(429 아님) = `resume_note` 「쿠팡 모니터링으로 중지된 옵션은 API 로 못 살림 — 윙에서 확인」.
- apply PUT 실패 = `applied_at` 없이 `result_json{ ok:false, step, code }` · revert PUT 실패 = `result_json.revert_failed{ code, at }` · `reverted_at` 없음.
- 같은 옵션 동시 작업 = 하나만(`같은 옵션에 다른 작업이 진행 중`).

## 표 `coupang_item_backups`
`id, seller_product_id, vendor_item_id, order_id, before_json, patch_json, after_json, applied_at, reverted_at, result_json, created_by, created_at` · 인덱스 (vendor_item_id, id DESC).

## audit
source `coupang-item-write` · targetType `coupang_item` · targetId null(번호는 changes 에 vendor_item_id·order_id·backup_id) · action = `coupang_item_backup` · `coupang_item_apply` · `coupang_item_apply_failed` · `coupang_item_revert` · `coupang_item_revert_failed`(list 는 기록 없음).

## 🔴 배포·실시험 전에 필요한 것(이 러너 밖)
1. **중계서버 COUPANG_ALLOW**(워커2 몫 · 728-coupang-write-api.md ⑥): 지금은 경로 글자 정확 일치라 번호가 든 경로(`vendor-items/{id}/…` · `seller-products/{id}`)가 전부 403 → 템플릿별 숫자 정규식 매칭 + GET 3종(목록·단건·inventories) · PUT 4종(prices·quantities·stop·resume).
2. **목록 쿼리 vendorId**: 문서상 `seller-products` 목록은 쿼리에 `vendorId` 가 필요한데 회사프로그램은 vendorId 를 모름(중계 .env 에만) → 중계가 그 경로의 쿼리에 vendorId 를 넣어 줘야 함(경로·바디 주입과 같은 꼴). 안 되면 list 만 실패 · backup·apply·revert 는 무관(경로에 vendorId 없음).
3. 실시험 가격은 **10원 단위**(±1 원 = 400) — 「현재가 그대로」는 서버가 「같아요」로 거절하므로 ±10 왕복.

## 7. #729 2차 — 상품 단위(상품명·옵션명·상세·이미지·등록)
> 같은 러너·같은 키(`coupang_item_write_request`) · 같은 표(`coupang_item_backups` · **kind 'product'** · vendor_item_id NULL 허용) · audit source 같음(action `coupang_product_*`). 근거 = 728-coupang-write-api.md ③④⑥.
> 전체 수정 = `PUT …/seller-products`(경로에 id 없음 · 바디 = **조회 JSON 통째** + sellerProductId) → **쿠팡 승인행**(승인완료 상품은 심사 뒤 반영). 임시저장(SAVED) 상품은 승인 요청 없이 저장만.

| op | 입력 | 하는 일 | 결과 |
|---|---|---|---|
| `get_full` | `{ order_id, seller_product_id }` | 단건 조회 JSON 통째 보관 | `backup_id` · `summary{ name, display_name, status, requested, items[{ sellerProductItemId, vendorItemId, itemName, salePrice, stock, contents(꼴 예 TEXT:TEXT), images(장수) }] }` · `saved` |
| `update_full` | `{ order_id, backup_id, patch }` | 신선도(이름·옵션 번호·이름·상세·그림이 보관본과 같아야) → 보관본 깊은 복사 위에 그 칸만 → PUT → 재조회는 **상태만** | `saved` · `requested`(임시저장 false · 그 밖 true) · `status_after` · `approval_note` · `patch_keys` |
| `revert_full` | `{ order_id, backup_id, force? }` | 보관본 그대로 같은 PUT(역시 승인행) · 조회가 보관본 또는 보낸 값과 같으면 통과(심사 중엔 조회가 옛 값) · 그 밖 = force | 위와 같은 꼴 |
| `create_saved` | `{ order_id, from_seller_product_id, name, items?[{ itemName, price, stock? }] }` | 본뜰 상품 조회 JSON 복사 → 뺄 칸 제거 → 이름(sellerProductName·displayProductName) · `requested:false` → `POST …/seller-products` · items 주면 본뜰 옵션(같은 자리 · 없으면 마지막)을 틀로 이름·가격·재고(기본 99999)·할인 기준가(가격보다 작으면 가격) | `seller_product_id`(새 번호) · `items` · `saved_note`(조회는 약 10분 뒤) |
| `approval` | `{ seller_product_id }`(지시 불필요 · 읽기만) | 단건 statusName + `GET …/{id}/histories`(최근 10) | `status` · `saved` · `denied` · `deny_reason`(이력 comment) · `histories` |
| `request_approval` | `{ order_id, seller_product_id }` | 임시저장·승인반려 상품만 `PUT …/{id}/approvals`(= 승인 **요청** · 시험에선 안 씀) | `status_before` · `status_after` · 400 이면 note 「10분 뒤」 |
| `delete_saved` | `{ order_id, seller_product_id }` | 임시저장 상품만 `DELETE …/{id}`(승인된 상품 = 거절 · Wing 에서) | `deleted` |

- **patch(update_full)** = `name`(1~100자 · 같은 값 거절 · 노출 상품명이 같은 글이면 둘 다) · `item_names{ vendorItemId|sellerProductItemId|지금 옵션명 → 새 이름 }`(1~150자 · 하나로 찾아야 · 다른 옵션과 겹치면 거절) · `detail_html`(모든 옵션 상세가 「글 한 칸」(contents 1 · contentDetails 1 · TEXT)일 때만 그 글을 바꿈 · 아니면 구성 보여 주고 거절 · script 거절 · 32만 자) · `images[주소]`(**지금 그 상품에 있는 그림만** 고르고 순서 · 첫 장 = REPRESENTATION · 새 외부 주소 = 거절 「그림 올리기 길 문서 없음 · 미확정」) · 그 밖(가격·재고·판매) = 1차 옵션 op 로.
- **뺄 칸(create_saved)** 기본 = sellerProductId · productId · statusName · status · mdId · mdName · createdAt · updatedAt · approvedAt · requestedAt · items.sellerProductItemId · items.vendorItemId · items.itemId · items.offerCondition → 첫 실등록 400 으로 확정 · 설정 `agent_office_config 'coupang_item_write'.create_strip`(배열 · 「items.칸」 꼴)이 있으면 그것으로 덮음(재배포 없이).
- **하루 3개** = kind product 행의 result_json.op `create_saved`·`create_unknown`(24시간) · 쿠팡 거절(4xx·code ERROR) = `create_failed`(안 셈) · 연결·5xx = `create_unknown`(셈 · 「됐는지 모름 — Wing 임시저장 목록」).
- 전체 수정 응답 `{ code:'200', data:{ code:'SUCCESS', data:<id> } }` — 안쪽 code 도 SUCCESS 여야 성공.
- 실패 기록 = `result_json.update_failed` / `revert_failed{ code, at }` · applied_at·reverted_at 안 찍힘.
- 1차 op(backup·apply·revert)에 상품 보관본 id 를 넣으면 거절 · update/revert 에 등록 기록 행을 넣어도 거절.
- 🔵 미확정(첫 실시험에서 봄): 등록 400 이 요구하는 뺄 칸 · 단건 statusName 한글/영문 · 승인완료 상품 전체 수정 중 기존 판매 지속 여부(문서 없음 → 창구 되묻기 + 카드 안내) · 우리 상품 상세(contents) 꼴(글 한 칸이 아니면 detail_html 거절 — get_full 의 contents 요약으로 먼저 봄).

## 8. #733-B 상세 블록 · 외부 그림 · 옵션 추가(update_full 확장 · 타이벡 10/26 오픈 대비)
- `detail_blocks:[{type:'image', url} | {type:'html', html}]`(1~60) → 워커2 `detail-blocks.js` toCoupangContents(러너 deps.detailBlocksToContents · 없으면 기본 = 그림 IMAGE_NO_SPACE · 글 TEXT) → **모든 옵션의 contents 통째 교체**(그림 구성 상품도 됨) · `detail_html` 과 같이 못 씀 · html 에 script 거절.
- 그림 주소 규칙(블록 그림 · `images` 새 주소 공통): 쿠팡 그림(`vendor_inventory/…` · `*.coupangcdn.com`) = 늘 허용 · 그 밖 = **https 공개 주소 + 설정 `agent_office_config 'coupang_item_write'.allow_external_images === true` 일 때만**(기본 꺼짐) · http·따옴표·공백 든 주소 거절. 쿠팡엔 그림 올리기 API 없음 → 공개 주소를 넣으면 쿠팡이 받아 CDN 저장(규격 정사각 500~5000px · 3MB · JPG/PNG · 상세 그림 자동 받기는 미확정 → 임시저장 시험).
- `images` 새 주소 = `{ vendorPath: 주소 }` 로 들어감 · 있던 그림은 그 객체 그대로(cdnPath) · 첫 장 REPRESENTATION.
- `items_add:[{ itemName, price, stock }]`(1~10) = 마지막 옵션을 틀로 복사(그림·상세·속성·고시) · sellerProductItemId·vendorItemId·itemId·offerCondition 빼고 · 이름 겹침·10원 단위·재고 0~99999 · originalPrice 가 가격보다 작으면 가격. 결과 `items_add_note` = 「vendorItemId 는 쿠팡 승인 뒤」.
- 결과 `items_after[]` = 재조회 옵션마다 { itemName, sellerProductItemId, vendorItemId, contents(꼴), content_images(≤5), images(≤5 · type·cdnPath·vendorPath) } — 외부 주소가 CDN 으로 바뀌었는지 여기로 봄.
- revert_full: 비교 = 엄격(보관본·보낸 값 지문) 또는 느슨(상품명 + 옵션명 목록 · CDN 변환·새 번호에 흔들리지 않게) · items_add 로 넣은 옵션 = 임시저장이면 보관본대로 빠짐 · **승인된 상품이면 거절**(승인 옵션 삭제 불가 → Wing 에서 그 옵션 판매중지).
- 승인된 상품 = 전부 승인행(requested true) → 10/26 오픈이면 10/21~22 에 보내야 함(#733-A).
- (워커3 점검 반영) ⓑ `detail_blocks` 는 **모든 옵션에 같은 상세**를 넣음(옵션마다 다른 상세는 지원 안 함 · 쿠팡 상세는 옵션 단위라 지금 옵션마다 다르던 상품도 하나로 맞춰짐). ⓐ revert_full 느슨 비교 = 상품명 + 옵션마다 (옵션명 · 상세 꼴 cpwContentsShape · 그림 장수) — Wing 에서 상세·그림만 바꾼 것도 force 없이는 안 덮음(그림 주소 값만 CDN 으로 바뀐 건 통과). ⓒ `items_add[].attributes:[{ attributeTypeName, attributeValueName }]`(구매옵션 값 · 중량 등) = 주면 그 이름 칸만 바꿈(없으면 붙임) · 안 주면 틀 그대로 · 값 있는 구매옵션 묶음이 다른 옵션과 똑같으면 거절 「구매옵션 값(중량 등)을 같이 주세요」(값이 하나도 없는 상품은 통과).
- (#745) update_full `item_attrs:{ <vendorItemId|sellerProductItemId>: { "<attributeTypeName>": "<새 값>" } }` = 기존 옵션의 구매옵션 값(「농산물 중량」 등 · 손님 화면 옵션 글자) · 이미 있는 이름 칸만(새 칸 거절) · 1~150자 · 같은 값 거절 · 바꾼 뒤 값 있는 구매옵션 묶음이 다른 옵션과 같아지면 거절 · 다른 칸(exposed 등) 그대로 · item_names 와 같이 한 PUT(승인행 1회) · revert_full = 보관본 값 · 신선도 지문·느슨 비교에 attributes 포함.

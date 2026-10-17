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

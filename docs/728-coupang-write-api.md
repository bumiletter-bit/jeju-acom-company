# #728-A 쿠팡 Wing Open API 「상품 쓰기」 경로·제약 확정 (워커3 · 2026-10-18 · 문서 읽기만 · 코드 0)

> 근거 = 쿠팡 개발자센터 공식 문서(developers.coupang.com · 옛 developers.coupangcorp.com 은 전부 302 로 넘어옴). 기본 URL = `https://api-gateway.coupang.com`(relay COUPANG_API_BASE 그대로) · 인증 = HMAC CEA(relay coupangSign · 쿼리 문자열까지 서명 → forceSalePriceUpdate 같은 쿼리도 relay 가 이미 같은 바이트로 서명). 모든 경로 앞 `/v2/providers/seller_api/apis/api/v1/marketplace` 는 아래에서 `…/marketplace` 로 줄임. 못 확정한 것은 맨 아래 「미확정」.

## 번호 두 가지(먼저 알 것)
- **sellerProductId(등록상품ID)** = 상품 단위 · 생성 응답 data 로 받음 · 조회·수정·승인·삭제·이력의 열쇠. **vendorItemId(옵션ID)** = 옵션 단위 · **승인완료 뒤에만 발급(임시저장이면 null)** · 가격·재고·판매상태 변경의 열쇠. 그 밖 `sellerProductItemId`(업체상품옵션아이디 · 승인 전에도 있음 · 전체 수정 때 옵션 식별용).
- 근거: https://developers.coupang.com/ko/api/products/querying-product

## ① 조회
| API | 경로 | 요점 | 근거 |
|---|---|---|---|
| 상품 목록 페이징 | `GET …/marketplace/seller-products?vendorId=&nextToken=&maxPerPage=&status=&sellerProductName=&sellerProductId=` | maxPerPage 기본 10 · 최대 100 · nextToken 빈 문자열 = 끝 · **status 필터 = IN_REVIEW(심사중) · SAVED(임시저장) · APPROVING(승인대기중) · APPROVED(승인완료) · PARTIAL_APPROVED(부분승인완료) · DENIED(승인반려) · DELETED(상품삭제)** · 응답 data[] = sellerProductId · statusName … | https://developers.coupang.com/ko/api/products/product-list-paging-query |
| 상품 단건 | `GET …/marketplace/seller-products/{sellerProductId}` | 응답 data = sellerProductId · statusName · displayCategoryCode · saleStartedAt/EndedAt · requested(자동승인요청여부) · **items[] = sellerProductItemId · vendorItemId(승인 전 null) · itemName · originalPrice(할인율기준가) · salePrice · maximumBuyCount(판매가능수량 = 재고) · maximumBuyForPerson** + 등록 바디 전체(배송·반품·이미지·고시·속성·상세 contents) · 🔴 등록·수정 직후는 **10분 뒤 조회** | https://developers.coupang.com/ko/api/products/querying-product |
| 옵션 재고·가격·상태 | `GET …/marketplace/vendor-items/{vendorItemId}/inventories` | 응답 = sellerItemId · **amountInStock(옵션 잔여수량) · salePrice · onSale(true/false)** · 승인완료 옵션만 | https://developers.coupang.com/hc/ko/articles/360033645114 |
| 상품 조회(승인불필요) | `GET …/marketplace/seller-products/{sellerProductId}/partial` | 배송·반품지 칸만(③ 승인불필요 수정의 짝) | https://developers.coupang.com/hc/ko/articles/360042701211 |
| 상태 이력 | `GET …/marketplace/seller-products/{sellerProductId}/histories?nextToken=&maxPerPage=` | data[] = status · comment(반려 사유는 여기) · createdBy(SYSTEM) · createdAt | https://developers.coupang.com/en/api/products/query-a-history-of-product-status-updates |

## ② 옵션별 전용 변경 3종(+조회) — 승인 불요 · 승인완료 옵션(vendorItemId)에만
| 변경 | 경로 | 제약 | 근거 |
|---|---|---|---|
| 가격 | `PUT …/marketplace/vendor-items/{vendorItemId}/prices/{price}` · 쿼리 `forceSalePriceUpdate=true|false`(기본 false) · (선택) `apMinSalePrice`+`apActive` 같이 | **10원 단위**(1원 단위 400) · 기본은 **「변경전 판매가의 최대 50% 인하 / 최대 100% 인상」 안**만 · 넘으면 400 → `forceSalePriceUpdate=true` 면 비율 제한 없음(실수 방지용 제한이라 **우리 도구는 기본 false 로 두고, 범위 밖이면 대표 확인 뒤 true**) · 자동생성 옵션 가격은 직접 수정 불가 · 응답 `{code:"SUCCESS", message:"가격 변경을 완료했습니다.", data:null}` | https://developers.coupang.com/ko/api/products/changing-price-of-each-item-of-a-product |
| 재고 | `PUT …/marketplace/vendor-items/{vendorItemId}/quantities/{quantity}` | quantity = 재고수량(0 = 품절) · 응답 「재고 변경을 완료했습니다.」 · 400 = 유효하지 않은 재고수량 / 삭제된 상품 / not found | https://developers.coupang.com/hc/ko/articles/360034156253 |
| 판매 중지 | `PUT …/marketplace/vendor-items/{vendorItemId}/sales/stop` | 바디 없음 · 응답 「판매가 중지되었습니다」 꼴 · 삭제된 옵션 400 | https://developers.coupang.com/hc/en-us/articles/360034156313 |
| 판매 재개 | `PUT …/marketplace/vendor-items/{vendorItemId}/sales/resume` | 응답 「판매가 재개되었습니다.」 · 🔴 **쿠팡 모니터링으로 중지된 옵션은 API 로 못 살림**(판매자콜센터) | https://developers.coupang.com/ko/api/products/resume-sales-of-each-item-of-a-product |
- **즉시 반영·승인 불요** = 단건 조회 문서의 원문 「판매가격·판매가능수량은 승인요청 전까지만 (전체 수정으로) 설정 가능 · 승인 후엔 옵션별 가격/수량 변경 API 로」 + 네 API 모두 「승인완료되어 옵션ID 가 발급되면 사용」 → 승인 절차 없는 길. 반영 시점(몇 초/몇 분)은 **문서에 없음(미확정 1)** → PUT 뒤 `…/inventories` 재조회로 대조(네이버 계약과 같은 꼴 · 쿠팡 판매자센터 화면 반영은 몇 분 늦을 수 있음 — 조회 API 가 정본).
- 원가(할인율기준가 originalPrice)는 별도 API 「옵션별 할인율기준가 변경」(/change-the-base-price-for-discount-rate-at-an-item-level) — 1차 밖.

## ③ 상품 전체 수정 · 등록 · 승인
| API | 경로 | 요점 | 근거 |
|---|---|---|---|
| 상품 수정(승인필요) | `PUT …/marketplace/seller-products` (바디에 sellerProductId · **경로에 id 없음**) | 「상품 조회 API 로 조회된 JSON 전문에서 원하는 값만 수정 후 **전체 JSON 전문**을 전송」 · **「이 API 를 사용하면 승인 후에 반영됩니다」** → 상품명·상세(contents)·이미지·속성·고시·카테고리 등 상품 정보 변경 = **전부 승인 심사행**(즉시 반영 아님) · 승인 전(임시저장) 상품은 salePrice·maximumBuyCount·autoPricingInfo 를 이 API 로 바꿀 수 있고, 승인 후엔 ② 로만 · 옵션 수정 = sellerProductItemId+vendorItemId 유지하고 값만 · 옵션 추가 = sellerProductItemId 없이 항목 추가 · **승인된 옵션은 삭제 불가** · bundleInfo·offerCondition 은 등록 뒤 변경 불가 · 바디 `requested` true = 저장 + 자동 승인요청 / false = 저장만 · 응답 `{code:"200", data:{code:"SUCCESS", data:<sellerProductId>}}` | https://developers.coupang.com/ko/api/products/modify-product |
| 상품 수정(승인불필요) | `PUT …/marketplace/seller-products/{sellerProductId}/partial` · 바디 `{ sellerProductId, …바꿀 칸 }`(부분) | **배송·반품지 칸만**(deliveryCharge·deliveryChargeType·deliveryCompanyCode·deliveryMethod·freeShipOverAmount·outboundShippingPlaceCode·outboundShippingTimeDay·unionDeliveryType·remoteAreaDeliverable·return*·companyContactNumber·extraInfoMessage·pccNeeded) · 「승인 절차 없이」 · 🔴 **임시저장·승인대기 상품은 못 고침** · 상품명·상세·가격·재고는 이 길에 없음 | https://developers.coupang.com/en/api/products/product-modification-approval-not-required |
| 상품 등록 | `POST …/marketplace/seller-products` | 필수 = sellerProductName · vendorId · saleStartedAt/EndedAt · 배송 7칸(deliveryMethod·deliveryCompanyCode·deliveryChargeType·deliveryCharge·freeShipOverAmount·deliveryChargeOnReturn·remoteAreaDeliverable·unionDeliveryType) · 반품 7칸(returnCenterCode·returnChargeName·companyContactNumber·returnZipCode·returnAddress·returnAddressDetail·returnCharge) · outboundShippingPlaceCode · vendorUserId · **requested** · items[](itemName·originalPrice·salePrice·maximumBuyCount·maximumBuyForPerson·maximumBuyForPersonPeriod·outboundShippingTimeDay·unitCount·adultOnly·taxType·parallelImported·overseasPurchased·pccNeeded·images[]·attributes[]·contents[]) · displayCategoryCode 는 필수 표시 없음(실제론 카테고리 필수 속성 검사에 쓰임) · **`requested:false` = 「작성 내용만 저장하고 판매요청 전 상태」(= 목록 status SAVED 임시저장) · 승인은 나중에 승인요청 API 또는 Wing** · 응답 data = sellerProductId(정수) · details/errorItems[] 에 경고(SUCCESS 여도 경고가 붙을 수 있음) | https://developers.coupang.com/ko/api/products/product-creation |
| 승인 요청 | `PUT …/marketplace/seller-products/{sellerProductId}/approvals` | 「임시저장·승인완료·승인반려·부분승인완료 상태만 승인 요청 가능」(본문엔 「임시저장에서만」이라 적혀 문서끼리 어긋남) · 「상품 정보가 등록 또는 수정되고 있습니다」 400 이면 10분 뒤 | https://developers.coupang.com/hc/ko/articles/360033644894 |
| 삭제 | `DELETE …/marketplace/seller-products/{sellerProductId}` | **「저장중·임시저장 상태만 삭제 가능」**(승인된 상품은 API 삭제 불가 · Wing 에서) — 시험 상품 뒷정리 길 | https://developers.coupang.com/en/api/products/delete-a-product |

### 대표 걱정 「테스트 상품은 승인이 안 날 것」 에 대한 답
- `requested:false` 로 등록하면 **승인 요청 없이 SAVED(임시저장)** 로 남고 손님에게 안 보임 · 임시저장은 DELETE 로 지울 수 있음 → 등록·전체 수정(이름·상세·가격·재고 포함)·조회·삭제 **왕복 시험은 임시저장 상품으로 충분**(승인 0회).
- 단, **② 옵션 3종(가격·재고·판매중지/재개)은 vendorItemId 가 있어야 해서 임시저장 상품으론 시험 불가** · ③ 승인불필요 수정도 임시저장은 거절. → **옵션 3종은 기존 승인완료 실상품의 옵션 하나로 「재고 n → n(같은 값) 또는 ±1 → 원복」 · 「판매중지 → 재개」 왕복**(같은 값 PUT 이 성공으로 오는지는 미확정 2 · 실측 1회) · 가격은 「현재가 그대로 PUT」 로 no-op 시험(10원 단위면 통과 예상).
- 상세·상품명 같은 「승인필요 수정」을 실상품에 하면 **승인 심사 동안 어떤 상태가 되는지(기존 판매는 계속되는지)** 는 문서에 없음(미확정 3) → 1차 자동 수정 범위는 **②(옵션 가격·재고·판매상태) + 승인불필요 배송칸** 으로 잡고, 상품명·상세·이미지는 「승인행」임을 에이전트 오피스 카드에 명시(대표 승인 뒤 · 반영은 쿠팡 심사 뒤).

## ④ 승인 상태값
- `statusName`(한글) ↔ 목록 `status` 필터(영문): 심사중 IN_REVIEW · 임시저장 SAVED · 승인대기중 APPROVING · 승인완료 APPROVED · 부분승인완료 PARTIAL_APPROVED · 승인반려 DENIED · 상품삭제 DELETED. 조회 경로 = 목록(`status=`) · 단건(`statusName`) · 이력(`/histories` · 반려 사유 comment). 🔵 단건 조회 응답 statusName 이 한글인지 영문 코드인지는 문서가 둘 다 보여 줌(미확정 4 · 실조회 1건).
- 근거: https://developers.coupang.com/ko/api/products/product-list-paging-query · /querying-product

## ⑤ 호출 제한
- vendorId 단위 · **초당 기준을 넘으면 429 Too Many Requests · 즉시 차단 · 몇 분~수십 분 뒤 풀림**(2023-07 정책 공지 · 기준 초당 5회) · **2026-03-17 조정 공지 = 「기준 빈도 10 → 5 req/s」**(본문에 분·시간 단위 상한 없음 · API 별 차등 표 없음 · 「시스템·vendorId 에 따라 바뀔 수 있음」). 시간당 상한 = 문서 없음. 우리 쓰기는 하루 몇 건 → 호출 사이 1초 간격이면 충분 · 429 면 재시도 말고 몇 분 뒤.
- 근거: https://developers.coupang.com/en/notices/introduction-of-open-api-rate-limit-policy · https://developers.coupang.com/en/notices/optimization-and-adjustment-of-open-api-rate-limiteffective-march-17th2026

## ⑥ relay COUPANG_ALLOW 에 넣을 줄(워커2)
🔴 지금 relay 는 `a.tpl === reqPath` **글자 정확 일치 + {vendorId} 만 치환**이라, 경로 안에 번호가 들어가는 아래 줄들은 **매칭기를 「{vendorItemId}·{sellerProductId}·{price}·{quantity} 자리 = 숫자(\d+) 정규식」으로 넓혀야 함**(회사프로그램은 실제 번호를 넣은 경로를 보내고, relay 가 템플릿별 정규식으로 검사 · 와일드카드 금지 · 숫자만). 쿼리(forceSalePriceUpdate)는 종전처럼 qs 를 서명에 포함. 바디 vendorId 강제 주입은 그대로(등록·전체 수정 바디의 vendorId 필수 칸과 일치).
```js
// 1차(옵션 단위 · 승인 불요) — 쓰기 4~7번째
{ m: 'GET', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products' },                                   // 상품 목록(쿼리 vendorId·status·nextToken)
{ m: 'GET', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}' },                 // 상품 단건(옵션 vendorItemId 확인)
{ m: 'GET', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories' },           // 옵션 재고·가격·상태(재조회 대조)
{ m: 'PUT', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/prices/{price}' },        // 옵션 가격(쿼리 forceSalePriceUpdate)
{ m: 'PUT', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/quantities/{quantity}' }, // 옵션 재고
{ m: 'PUT', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/sales/stop' },            // 옵션 판매중지
{ m: 'PUT', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/sales/resume' },          // 옵션 판매재개
// 2차(상품 단위 · 승인행 또는 임시저장) — 대표 「고」 뒤
{ m: 'PUT',    tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products' },                                // 전체 수정(승인필요 · 바디 sellerProductId)
{ m: 'PUT',    tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/partial' },      // 배송·반품지 수정(승인불필요)
{ m: 'POST',   tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products' },                                // 등록(requested false = 임시저장)
{ m: 'PUT',    tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/approvals' },    // 승인 요청
{ m: 'DELETE', tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}' },              // 삭제(임시저장만)
{ m: 'GET',    tpl: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/histories' },    // 상태 이력(반려 사유)
```
- 🔴 `GET …/seller-products`(목록) 와 `PUT/POST …/seller-products`(수정·등록) 은 **같은 경로 · 메서드만 다름** → 매칭은 메서드+경로 쌍으로(지금 구조 그대로). `DELETE` 는 relay fetch 가 메서드를 그대로 넘기므로 코드 추가 없음(바디 없음).

## 미확정(4)
1. 옵션 가격·재고·판매상태 변경의 **반영 지연** — 문서 없음 → `…/inventories` 재조회로 판정.
2. **같은 값으로 PUT**(재고 n→n · 가격 현재가) 이 SUCCESS 로 오는지 — 실측 1회(no-op 시험용).
3. 승인필요 전체 수정을 **승인완료 실상품**에 보냈을 때 심사 중 상태·기존 판매 지속 여부 — 문서 없음 → 1차 범위 밖.
4. 단건 조회 `statusName` 이 한글인지 영문 코드인지 — 실조회 1건.

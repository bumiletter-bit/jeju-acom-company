# #720-A 네이버 커머스API 「상품 수정」 경로·필수 칸 확정 (워커3 · 2026-10-17 · 문서 읽기만 · 코드 0)

> 근거 = 공식 문서(apicenter.commerce.naver.com/docs/commerce-api/current · 2.90.1) + 개발자 포럼 운영자 답변(github.com/commerce-api-naver/commerce-api/discussions · 날짜 표기). 공식 문서 페이지는 SPA 라 r.jina.ai 로 읽었고 **「Request 본문」 칸이 비어 나오는 페이지가 있어** 그 부분은 구조체 스키마 페이지·포럼으로 보완. 못 확정한 것은 맨 아래 「미확정」.
> 기본 URL = `https://api.commerce.naver.com/external` (중계 경로는 `/external/...` 그대로).

## 번호 두 가지(먼저 알 것)
- **채널상품번호(channelProductNo)** = 스마트스토어 상품 URL 의 숫자(우리 판매현황 naver_product_no · 6400134206 등). **원상품번호(originProductNo)** 는 다른 값 — 「특정 상품의 원상품번호가 다른 상품의 채널상품번호가 될 수 있다」(#1857). 조회·수정은 채널 번호, **판매 상태 변경·옵션 재고·multi-update 는 원상품 번호**. 원상품 번호는 ①채널 상품 조회 응답(칸 이름 = 미확정 1) 또는 ②`POST /v1/products/search`(이미 허용 · 응답 contents[].originProductNo + channelProducts[].channelProductNo 꼴 — 포럼 sir.kr 2019 샘플이라 실응답으로 확인) 에서.
  - 근거: https://github.com/commerce-api-naver/commerce-api/discussions/611 (2023-04-11) · /discussions/1857 · /discussions/1899 (2024-08-26 「원상품 = 본질 단위 · 채널상품 = 원상품 + 전시채널 요소」)

## ① 단건 조회
| 항목 | 확정 내용 | 근거 |
|---|---|---|
| 경로 | `GET /v2/products/channel-products/{channelProductNo}` (「채널 상품을 조회합니다」) · 원상품은 `GET /v2/products/origin-products/{originProductNo}` | 공식 …/current/read-channel-product-1-product · read-origin-product-product |
| 응답 최상위 | 공식 페이지에 응답 스키마가 안 떠서 **미확정 1**. 요청 쪽(등록·수정)은 최상위 두 객체 `originProduct` + `smartstoreChannelProduct`(+ 쇼핑윈도면 `windowChannelProduct`) 가 확정이고, 운영자가 수정 요청을 「조회 응답을 토대로」 만들라 했으므로 응답도 같은 두 객체를 품는 것으로 본다. **첫 실조회 1건에서 최상위 키·번호 칸(originProductNo 등)을 적어 계약 NPW_STRIP 을 채울 것.** | #1922 (2024-09-02 「smartstoreChannelProduct 은 originProduct 안이 아니라 같은 최상위」) · #1903 (2024-08-26) |
| originProduct 2단 칸(수정 바디 예 · #1650 2024-04) | statusType · saleType · leafCategoryId · name · detailContent · images · saleStartDate · saleEndDate · salePrice · stockQuantity · deliveryInfo · productLogistics · detailAttribute(naverShoppingSearchInfo · afterServiceInfo · purchaseQuantityInfo · originAreaInfo · sellerCodeInfo · optionInfo) · supplementProductInfo · purchaseReviewInfo · isbnInfo · eventPhraseCont · manufactureDate · releaseDate · validDate · taxType · productCertificationInfos · certificationTargetExcludeContent · sellerCommentContent · sellerCommentUsable · minorPurchasable · ecoupon · productInfoProvidedNotice · productAttributes · cultureCostIncomeDeductionYn · customProductYn · itselfProductionProductYn · brandCertificationYn · seoInfo · customerBenefit | https://github.com/commerce-api-naver/commerce-api/discussions/1650 |
| smartstoreChannelProduct 칸 | channelProductName · bbsSeq · storeKeepExclusiveProduct · **naverShoppingRegistration(필수)** · **channelProductDisplayStatusType(필수 · 「ON, SUSPENSION만 입력 가능」 · 조회엔 WAIT 도 올 수 있음)** | 공식 …/current/schemas/스마트스토어-채널상품-정보-구조체 |

## ② 수정 PUT
| 항목 | 확정 내용 | 근거 |
|---|---|---|
| 경로 | `PUT /v2/products/channel-products/{channelProductNo}` (원상품만 고치려면 `PUT /v2/products/origin-products/{originProductNo}` 도 있음 · 1차는 채널 경로 하나로) | 공식 …/current/update-channel-product-product · #1469 릴리즈 노트 |
| 바디 꼴 | **전체 객체 통째** `{ originProduct:{…}, smartstoreChannelProduct:{…} }`. 운영자 원문(2024-08-26): 「커머스API의 '상품' API 그룹에서 상품 정보를 수정하는 경우 **요청 메시지에 포함하지 않은 정보는 제거하는 행동으로 동작**합니다」 · 「'채널 상품 조회API' … 최신 상품 정보를 토대로 API호출」. → **조회 → 그 자리만 바꿈 → 통째 PUT** 이 공식 권장 흐름(우리 설계와 같음). | https://github.com/commerce-api-naver/commerce-api/discussions/1903 |
| 생략해도 유지되는 칸 | **detailContent 하나뿐** — 문서 원문 「상품 상세 정보 상품 수정 시에만 생략할 수 있습니다. 이 경우 기존에 저장된 상품 상세 정보 값이 유지됩니다」 · 「설명이 없는 필드의 경우 값이 유지되지 않으니」. `seoInfo` 등은 빈 값·null 이면 **지워짐**. | https://github.com/commerce-api-naver/commerce-api/discussions/1650 (2024-04-30) |
| 조회 응답 그대로 되돌려 넣기 | 운영자가 「그대로 보내도 된다」고 명시한 글은 없음(미확정 2). 400 사례 = 칸을 뺐을 때(`originProduct.salePrice` 「데이터를 입력해 주세요」 #1903) · 태그 금지어(#1650). **원상품 중 수정 요청에 넣으면 안 되거나 무시되는 칸(포럼 확정)**: ⓐ 카탈로그 매칭 완료(`detailAttribute.naverShoppingSearchInfo.catalogMatchingYn=true`) 상품은 `naverShoppingSearchInfo` 를 **빼고** 보낼 것(#1883 2024-08-12) ⓑ 옵션 상품의 `originProduct.stockQuantity` 는 보내도 **자동 무시**(#1194 2023-11-14) ⓒ `mobileDiscountMethod` 는 deprecated(무시 · #1469). 그 밖 읽기 전용 칸 목록은 문서·포럼에 없음 → **첫 실 PUT(대표 지정 상품 1건)에서 400 invalidInputs/message 로 확정**하고 NPW_STRIP 에 적을 것. 400 때 「InvalidInputs 필드 정보가 없거나 … message 내용을 활용한 오류 판단을 권장」(공식). | 위 링크들 |
| 필수 칸(원상품 구조체) | `statusType` · `name` · `detailContent` · `images`(representativeImage.url) · `salePrice`(≤ 999,999,990) · `detailAttribute` + smartstore 의 `naverShoppingRegistration` · `channelProductDisplayStatusType`. (조회 응답을 통째로 쓰면 저절로 충족) | 공식 …/schemas/원상품-정보-구조체 |

## ③ 상세 HTML
- 칸 = `originProduct.detailContent`(string · 필수). 「HTML 코드를 **문자열로 그대로** 입력하시면 해당 내용이 상품 상세 정보로 설정」 · **쓸 수 없는 태그 = HTML, META, SCRIPT, STYLE, BODY, HEAD**(운영자 예시 · 2025-01-06). 리스트/객체로 보내면 `InvalidImageUrl` 꼴 엉뚱한 400(#1882). — https://github.com/commerce-api-naver/commerce-api/discussions/2216
- **글자 수 상한 = 문서에 없음(미확정 3)** — 구조체 페이지에 max 표기 없음 · 포럼 답변 없음. (계약 초안의 「2,000,000자」는 근거 없는 값 → 「문서 미명시」로 적을 것.)
- **이미지 URL** = 대표·추가 이미지는 「'상품 이미지 다건 등록API' 를 통하여 반환된 URL 로만 설정 가능」(2024-09-20 #1964 · 외부 URL 넣으면 오류). 상세 HTML 안 `<img src>` 에 외부 URL 이 되는지는 문서·포럼에 명시 없음(미확정 4) — 단 detailContent 에서 나오는 오류 문구가 「유효하지 않은 이미지 URL입니다. **정상적으로 업로드한 이미지만 등록 가능**합니다」(#1882 · InvalidImageUrl) 이므로 **상세 그림도 ⑤로 올린 URL 만 쓰는 것이 안전**. 기존 상세의 img 주소(네이버 CDN)는 그대로 두면 됨.

## ④ 판매 상태 · 재고
| 항목 | 확정 내용 | 근거 |
|---|---|---|
| 상태 전용 경로(추천) | `PUT /v1/products/origin-products/{originProductNo}/change-status` · 바디 `{ "statusType": "SALE" \| "SUSPENSION" \| "OUTOFSTOCK" \| …, "stockQuantity"?: n, "saleStartDate"?, "saleEndDate"? }` · **원상품 번호** 사용. 허용 enum = WAIT·SALE·OUTOFSTOCK·UNADMISSION·REJECTION·SUSPENSION·CLOSE·PROHIBITION·DELETE 이나 사람이 바꾸는 전이는 **SALE→OUTOFSTOCK(재고 0 으로 바뀜) · SUSPENSION/OUTOFSTOCK→SALE(「품절에서 판매 중으로 변경 시 재고 수량 입력 필수」) · SALE/OUTOFSTOCK/WAIT→SUSPENSION** 셋. 「재고 수량이 0인 경우 상태는 전달된 값과 무관하게 OUTOFSTOCK 유지」(SUSPENSION 이면 SUSPENSION 유지). 통째 PUT 없이 두 칸만 보내므로 **1차 「판매 상태·재고」는 이 경로가 안전**. 🔴 이 API 도 상품 정보 검증을 일부 품음 → 오래돼 필수 칸이 빈 상품은 400(#1206 2023-11-15 · 그땐 ② 로 상품 정보 보강 뒤 재시도). | 공식 …/current/read-channel-product-product(슬러그 오타 · 제목 「판매 상태 변경」) · #1206 · api-agency issue #1056(2026-09 실사용 279회 · 429 0) |
| 상태 칸(통째 PUT 때) | `originProduct.statusType` · 전시는 `smartstoreChannelProduct.channelProductDisplayStatusType`(ON/SUSPENSION) — 둘은 다른 칸(판매 상태 ≠ 전시 상태). | 공식 구조체 |
| 재고 — 옵션 없는 상품 | `originProduct.stockQuantity`(≤ 99,999,999) 또는 change-status 의 stockQuantity. | 공식 구조체 |
| 재고 — **옵션(조합형) 상품 = 우리 상품 전부** | 재고는 `originProduct.detailAttribute.optionInfo.optionCombinations[n].stockQuantity` 에만 있고 **상품 총 재고 = 조합 합(자동)** · `originProduct.stockQuantity` 는 보내도 무시 · 조합 하나 품절 = 그 stockQuantity 0 · 상품 전체 품절 = **모든 조합 0** · `usable:false` = 재고와 무관하게 손님에게 안 보임. 「재고만 바꾸는 전용 API 없음 → 채널/원상품 수정으로 **옵션 전체를 통째**」(2023-03-27 #562 · 2024-08-26 #1903). 옵션 조합 칸 = id · optionName1~4 · stockQuantity · price · usable · sellerManagerCode(· skuYn). | https://github.com/commerce-api-naver/commerce-api/discussions/1194 (2023-11-14) · #562 · #1903 |
| 옵션 재고 전용(2차) | `PUT /v1/products/origin-products/{originProductNo}/option-stock` 「상품 옵션의 재고, 가격, 할인가를 변경합니다」(2025-01-08 제공 · #2183). **요청 바디 = 문서 페이지에 안 떠서 미확정 5** → 2차(옵션 가격) 때 확정. 상품 단위 일괄은 `PATCH /v1/products/origin-products/multi-update`(multiUpdateTypes = SALE_PRICE·IMMEDIATE_DISCOUNT·STOCK·PRODUCT_STATUS_SALE·PRODUCT_STATUS_SUSPENSION · 옵션 상품의 STOCK 동작은 미확정). | 공식 …/current/update-options-product · update-multi-products-product |

## ⑤ 이미지 업로드
- `POST /v1/product-images/upload` · `Content-Type: multipart/form-data`(boundary 필수) · 파일 칸 이름 **`imageFiles`**(여러 장도 전부 같은 이름) · **최대 10장/회** · **한 호출 총 10MB 미만** · 형식 JPG/JPEG·GIF·PNG·BMP · **각 part 의 Content-Type 은 실제 MIME**(png 를 image/jpeg 로 보내면 실패) · **같은 스토어 계정에서 동시에 1건만**(순차 호출) · 응답 `{ "images": [ { "url": "…" } ] }`. 외부 URL 그림도 「다건 등록 API 에 외부 이미지로 설정 가능」(= 파일로 받아 올리면 됨).
- 그 URL 을 `originProduct.images.representativeImage.url` · `optionalImages[n].url` · 상세 `<img src>` 에 쓴다(③).
- 근거: 공식 …/current/upload-product · https://github.com/commerce-api-naver/commerce-api/discussions/117 (2022-10-21 · 2026-03-18 갱신 FAQ) · #2216 (2025-01-10 응답 꼴 · 2025-01-24 MIME) · #1964 (2024-09-20)

## ⑥ 호출 제한 · 반영
- **애플리케이션별 · API별 토큰 버킷 · 기본 2 RPS**(「모든 API의 Rate limit을 기본 2RPS로 고정」) · 초과 = 무조건 429 · 헤더 `GNCP-GW-RateLimit-Replenish-Rate / -Burst-Capacity / -Remaining`. 2024-04-01 부터 **혼잡이면 잔여량이 남아도 429**(`GW.RATE_LIMIT`) → 3~5초 뒤 재시도(운영자 #1604). 일일 상한은 셀프 앱엔 없음(QUOTA 는 솔루션·대행사만). 우리 기존 callWithRetry(350ms 간격 · 지수 백오프) 그대로 쓰면 됨 · 상품 쓰기는 하루 몇 건이라 제한과 무관.
- **수정 뒤 반영 지연 = 문서·포럼에 없음(미확정 6)**. 「상품 검수」 API 는 검수 뒤 「수정 요청 상품」 목록·복원용이지 수정마다 검수를 거친다는 글 없음. → 계약대로 PUT 뒤 **재조회 대조**로 판단(성공 응답 뒤 즉시 재조회에서 다르면 그때 지연 여부 기록).
- 근거: https://github.com/commerce-api-naver/commerce-api/discussions/6 (2022-09-01 · 2026-06-04 갱신) · #1538 (2024-04 429 변경) · #1604 · 공식 …/current/상품-검수

## ⑦ 중계 허용 목록 1차 3줄(relay/server.js ALLOW · 번호 = 숫자 정확일치)
```js
{ m: 'PUT',  re: /^\/external\/v2\/products\/channel-products\/\d+$/ },                       // #720 채널 상품 수정(상세·그림·옵션 재고 통째) — 쓰기 4번째
{ m: 'PUT',  re: /^\/external\/v1\/products\/origin-products\/\d+\/change-status$/ },        // #720 판매 상태·재고 변경(원상품 번호 · 바디 statusType·stockQuantity 만) — 쓰기 5번째
{ m: 'POST', re: /^\/external\/v1\/product-images\/upload$/ },                                // #720 그림 올리기(multipart · MULTIPART_ALLOW 와 짝 · allowed() 를 먼저 타므로 여기도 필요)
```
- 조회 `GET /^\/external\/v2\/products\//` 는 이미 있음. 2차 후보(지금 안 넣음): `PUT …/origin-products/\d+/option-stock$` · `PATCH …/origin-products/multi-update$` · 3차 `POST /external/v2/products$`.
- 🔴 change-status 는 **원상품 번호**라 회사프로그램이 채널 번호 → 원상품 번호를 먼저 풀어야 함(조회 응답 또는 /v1/products/search).

## 미확정(6) — 전부 「첫 실조회·실 PUT 1건」 으로 닫힘
1. 채널 상품 조회 **응답 최상위 키·번호 칸 이름**(originProductNo 등) — 문서 렌더 안 됨 → 실조회 1건으로 확정 · NPW_STRIP 채움.
2. 조회 응답을 **그대로** PUT 해도 되는지(읽기 전용 칸 목록) — 운영자 「조회를 토대로 통째」까지만 · 포럼 확정 제외 칸 = naverShoppingSearchInfo(카탈로그 매칭 상품) · 옵션 상품 stockQuantity(무시) · mobileDiscountMethod → 실 PUT 400 message 로 확정.
3. detailContent **글자 수 상한** — 문서 미명시.
4. 상세 HTML 안 **외부 이미지 URL 허용 여부** — 미명시 · 오류 문구상 업로드 URL 만 안전.
5. option-stock **요청 바디** — 문서 페이지에 안 뜸(2차).
6. 수정 뒤 **반영 지연** — 문서 없음 · 재조회 대조로.

---

# 2차(#721-A · 워커3 · 2026-10-17) — 옵션명·단가·품목명·재고 복귀·option-stock·링크

> 대표 「고」 = 네이버도 자사몰처럼 옵션명·품목명·단가·재고·상세까지 자동 수정. 공식 구조체 페이지는 옵션·할인 칸을 **예시 JSON 으로만** 보여 주고 설명이 없어, 뜻은 포럼 운영자 답변으로 채웠다. 못 채운 것은 「미확정 2차」(전부 실조회 1건 + 실 PUT 1건으로 닫힘).

## ① 옵션 수정(채널 상품 통째 PUT)
| 항목 | 확정 내용 | 근거 |
|---|---|---|
| 자리 | `originProduct.detailAttribute.optionInfo` **(detailAttribute 하위 — 다른 자리면 옵션이 조용히 안 저장됨)** · 조합형 = `optionCombinationGroupNames{optionGroupName1..}` + `optionCombinations[]` · `useStockManagement:true` · 옵션 그룹 최대 3개 · 조합형·단독형·표준형 혼용 불가 | #2305 (2025-02-14) · #1194 (2023-11-14) · #605 (2023-04-11) |
| optionCombinations[n] 칸 | `id`(integer) · `optionName1`~`optionName4` · `price`(integer) · `stockQuantity` · `usable`(boolean) · `sellerManagerCode`(string) · `skuYn` — 공식 구조체엔 예시 JSON 뿐(설명 0) | 공식 …/schemas/원상품-정보-구조체 |
| `id` 의 뜻 | **네이버가 자동 부여**(「optionCode는 상품의 옵션이 설정되어 있다면 자동으로 등록되는 id · 스마트스토어센터 내에서는 제공하지 않음」) · 운영자 권고 = 옵션 식별·조회는 **판매자가 정하는 `sellerManagerCode`** 로 · 주문 상세의 `productOrder.optionManageCode` = `sellerManagerCode` **같은 값**(주문 이력 ↔ 옵션 연결 열쇠는 이것) | https://github.com/commerce-api-naver/commerce-api/discussions/1637 (2024-04-24) |
| 옵션명 바꿀 때 id 유지? · id 없는 항목 = 새 옵션? · 삭제 = 배열에서 빼기? | **미확정 2차-1** — 문서·포럼 답변 없음. 유일한 단서 = 같은 옵션 id 를 두 번 보내면 거절(#1894 2024-08-20 · 표준형). → 실 PUT 규칙(계약에 넣을 것): ⓐ 옵션명·가격·재고 수정은 **조회 응답의 `id` 를 그대로 둔 채 그 칸만** 바꾸고, 재조회에서 **id·sellerManagerCode 가 그대로인지** 대조(바뀌면 「옵션 재생성」으로 기록 · 주문 옵션 연결은 sellerManagerCode 로 하니 실해는 작음) ⓑ 새 옵션 = id 없이 항목 추가(응답에서 id 부여 확인) ⓒ **삭제는 배열에서 빼지 말고 `usable:false`**(공식: 「사용 여부를 false 로 설정할 경우 해당 옵션 조합은 재고 유무와 관계없이 구매자에게 표시되지 않습니다」 · 되돌리기 쉬움 · 주문 이력 보존) — 배열에서 빼는 건 3차 이후 대표 확정 때만 | #1194 · #1894 |
| `price` 의 뜻 | 공식 설명 없음 → **미확정 2차-2**(추정 = 스마트스토어센터 「옵션가」와 같은 **판매가 대비 추가 금액**(0 이상 · 음수 가능 여부 미확인) · 포럼 예시엔 null/0 · 제3자 구현도 「salePrice = 가장 싼 조합 · price = 그보다 비싼 만큼」). → 실조회 1건에서 우리 옵션별 결제가(스냅샷 discPrice+price)와 `salePrice − 즉시할인 + price` 가 맞는지로 확정. 센터의 옵션가 범위 규칙(판매가 대비 −50%~+100%)은 API 문서엔 없음 → 넘으면 400 message 로 알게 됨 | #1650 · #241 · Kohgane/proxy-commerce PR #860(비공식) |

## ② 단가 = 어느 칸
- **판매가** = `originProduct.salePrice`(필수 · ≤ 999,999,990) · **즉시할인** = `originProduct.customerBenefit.immediateDiscountPolicy.discountMethod { value, unitType: PERCENT|WON, startDate?, endDate? }`(운영자 2023-03-21: 「상품 등록/수정 시 immediateDiscountPolicy 필드의 칠드런으로 설정 · 정률(판매가 대비 비율)·정액(판매가 대비 금액) · 시작·종료일은 매 시각 지정된 분으로만」 · multi-update 문서: 시작 분 00/10/20/30/40/50 · 종료 분 09/19/29/39/49/59) · `mobileDiscountMethod` 는 deprecated(무시 · #1469). 손님 결제가 = salePrice − 즉시할인 + 옵션 price.
- 「단가」를 바꾸는 칸은 **실조회 1건으로 우리 상품이 어느 꼴인지 본 뒤 정한다**(ⓐ salePrice 만 쓰고 할인 0 · ⓑ salePrice + 즉시할인 · ⓒ 옵션 price 로 차등). 우리 스냅샷이 discPrice 를 따로 들고 있으므로 ⓑ 일 가능성 → 그때는 **할인 칸은 그대로 두고 salePrice 또는 옵션 price 만** 바꾸는 것이 안전(할인을 건드리면 날짜 분 규칙에 걸려 400). 상품 단위 일괄은 `PATCH /v1/products/origin-products/multi-update`(SALE_PRICE · IMMEDIATE_DISCOUNT · STOCK · PRODUCT_STATUS_SALE/SUSPENSION · 원상품 번호) 도 있음(옵션 price 는 못 바꿈).
- 근거: https://github.com/commerce-api-naver/commerce-api/discussions/539 (2023-03-21) · 공식 …/current/update-multi-products-product

## ③ 품목명 = 어느 칸
- `originProduct.name`(필수 · 「상품명」) = 원상품명. `smartstoreChannelProduct.channelProductName` = 「채널 상품 전용 상품명을 사용하는 경우 입력합니다. **미입력 시 원상품명으로 적용**됩니다」(공식 구조체). → **손님 화면 이름 = channelProductName 이 차 있으면 그것, 비어 있으면 name**. 통째 PUT 이라 둘 다 보내진다 — 실조회에서 channelProductName 이 비어 있으면 `name` 만 바꾸면 되고, 차 있으면 **둘 다 같은 글로** 바꿀 것(한쪽만 바꾸면 화면과 원상품이 갈림).
- 근거: 공식 …/schemas/스마트스토어-채널상품-정보-구조체

## ④ 품절 → 판매중 복귀(옵션 상품)
- change-status 문서: 「품절에서 판매 중으로 변경 시 재고 수량 입력 필수」 · 「재고 수량이 0인 경우 상태는 전달된 값과 무관하게 OUTOFSTOCK 유지」. **옵션 상품에서 그 stockQuantity 가 옵션 합이어야 하는지는 문서에 없음(미확정 2차-3)** — 포럼 실사례: 옵션 상품에 상품 단위 재고를 넣으니 「조합형 옵션 상품인 경우 상품의 재고수량과 조합형옵션 재고수량의 합은 같아야 합니다」 400(#1194 질문) → 운영자 답 = **옵션 상품의 품절·복귀는 옵션 재고로**(조합 전부 0 = 품절 · 조합 재고 넣으면 복귀 · 총 재고는 자동 합산).
- → **추천(우리 상품 = 전부 옵션 상품)**: 품절·복귀는 **채널 상품 통째 PUT 하나로 `optionCombinations[].stockQuantity` + `originProduct.statusType:'SALE'` 을 한 번에**(한 번의 PUT · 재조회 대조 1회). change-status 전용 경로는 **SALE ↔ SUSPENSION(판매 중지·재개)** 에만 쓰고, OUTOFSTOCK 복귀엔 쓰지 않는다(옵션 합과 다른 값이면 400 · 같은 값이면 되는지 실 PUT 로 확인 가능하나 1차에 필요 없음). 옵션 재고가 전부 0 인 채 statusType SALE 을 보내면 문서 규칙대로 OUTOFSTOCK 유지(오류 아님 · 재조회에서 statusType 이 그대로면 그 이유).
- 근거: 공식 …/current/read-channel-product-product(판매 상태 변경) · https://github.com/commerce-api-naver/commerce-api/discussions/1194

## ⑤ option-stock 전용 경로
- `PUT /v1/products/origin-products/{originProductNo}/option-stock` 「상품 옵션의 재고, 가격, 할인가를 변경합니다」 — **요청 바디 = 여전히 미확정(2차-4)**: 공식 페이지 Request 칸이 비어 나오고(2회 시도) 포럼에 사용 글 0건(2025-01-08 제공 · #2183). 통째 PUT 은 포럼 실사례·운영자 권고가 있는 검증된 길이므로 **2차도 통째 PUT 으로 가고, option-stock 은 대표가 「옵션만 자주 바꾼다」 할 때 실호출 1건으로 바디를 알아낸 뒤 쓴다**(허용 목록엔 지금 안 넣음).
- 근거: 공식 …/current/update-options-product · https://github.com/commerce-api-naver/commerce-api/discussions/2183

## ⑥ 상세 HTML 의 `<a href>`
- 문서·포럼에 허용·금지 글 없음 → **미확정 2차-5 · 실 PUT 로**. 운영자가 든 금지 태그는 HTML·META·SCRIPT·STYLE·BODY·HEAD 뿐(#2216 2025-01-06)이라 `<a>` 는 그 목록 밖. 넣을 때는 재조회한 detailContent 에 `<a href` 가 남아 있는지(네이버가 조용히 벗겨 내는지)로 판정 · 1차 상세 문구 수정엔 링크 없이.

## 미확정 2차(5) — 닫는 법
1. 옵션 id 유지·신규·삭제 규칙 → 실 PUT 1건(옵션명 한 글자 바꿔 재조회 id 대조) · 삭제는 usable:false 로 우회.
2. 옵션 `price` 의 뜻(추가금 · 범위) → 실조회 1건을 스냅샷 결제가와 맞춤.
3. change-status 복귀 때 옵션 상품의 stockQuantity → 안 씀(통째 PUT 으로 우회).
4. option-stock 요청 바디 → 안 씀(통째 PUT).
5. 상세 `<a href>` → 실 PUT 재조회.

## 실측 결과(#721-B · 워커1 · 2026-10-17 · 레드키위 13782816361 · 시험 계정 지시)
- **통째 PUT 바디의 `statusType` 을 지금 값과 다르게 보내면 400** · invalidInputs = `originProduct.statusType` → 통째 PUT 으로 상태값 변경 불가. 품절 걸기·풀기는 바디의 옵션 재고만 바꾸고 상태는 재조회로 판정(풀기는 안 되면 change-status SALE 1회 안전망).
- **옵션 상품의 change-status OUTOFSTOCK = 400**(SALE → OUTOFSTOCK) → change-status 는 SALE↔SUSPENSION 만.
- **옵션 `price` = 판매가 대비 추가금 · 음수 가능**(레드키위 5kg 0 · 3kg −17,000 · 10kg +43,000 · 판매가 98,800 · 즉시할인 WON 48,000 → 결제가 50,800 · 33,800 · 93,800) → 미확정 2-2 닫힘.
- **통째 PUT 은 상세를 안 바꿔도 네이버가 상세를 걸러 냄**: 옵션 재고 −1 만 바꾼 PUT 에서 detailContent 71,083 → 62,996자(스마트에디터 `script type=text/data` 30블록 삭제 · 그림 a 태그의 style·onclick·data-linktype·data-linkdata 는 `<!-- Not Allowed Attribute Filtered ( … ) -->` 주석으로 옮겨짐 · 그림 23장·글자 그대로 · 실손실 = 그림 링크 4곳). 재조회 옵션 id 그대로(관리코드 없음).

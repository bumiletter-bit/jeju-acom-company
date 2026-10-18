# #737 카페24(자사몰) 옵션 자동화 가능 여부 (워커3 · 2026-10-18 · 문서 읽기만 · 카페24 쓰기 0)

> 근거 = 카페24 Admin API 공식 문서. 옛 주소 developers.cafe24.com/docs/ko/api/admin 은 **apidocs.cafe24.com 으로 301 이전**(링크는 새 주소). 각 페이지의 요청 표는 r.jina.ai 로 읽었다. 기본 경로 = `https://akkome.cafe24api.com/api/v2/admin`.

## 결론
| 하고 싶은 일 | 판정 | 근거 |
|---|---|---|
| **옵션명·옵션값 글자 바꾸기**(예: 「2.5kg(로얄과)」 → 「행사★…」) | **API 로 된다 · 권한 추가 불필요** · 품목(variant) 유지 | 「상품 옵션 수정」 PUT |
| **옵션값 추가**(타이벡 새 규격 등 새 품목) | **API 로 안전하게는 안 된다** — PUT 은 「옵션 항목을 추가하거나 삭제할 수는 없음」 · 유일한 길 = 옵션 전체 삭제 → 재등록인데 **삭제 때 기존 품목이 전부 지워짐**(품목 코드·재고·판매/진열·추가금 초기화) → 운영 상품엔 쓰지 말 것. **새 옵션값 추가는 지금처럼 관리자 화면(대표·직원 손 · 품목 추가 → 새 품목 코드 생김)** 으로 두고, 그 뒤 **추가금·판매·진열은 API 가 자동**(지금 mall-price 가 하는 길) | 「상품 옵션 수정」·「상품 옵션 삭제」 |
| **옵션 숨기기·되살리기·추가금** | **이미 API 로 하고 있음**(variants PUT · selling/display/additional_amount) · 한 번에 100품목 일괄 PUT 도 있음 | 「상품 품목 수정」·「상품 품목 일괄 수정」 |
| 권한(scope) | **추가 불필요 · 대표 재승인 불필요** — 옵션 API 4종과 품목 API 모두 `WRITE_PRODUCT` · 우리 앱 cafe24.js SCOPE 에 `mall.write_product` 가 이미 있고, mall-price.js 의 variants PUT 이 실제로 성공해 왔음(= 승인된 권한) | 아래 ② |

→ 셋 중 「**API 로 된다(이름·값 글자 · 추가금·판매·진열) / 옵션값 추가만 안 된다(손으로 추가 → 뒤처리는 API)**」. 대표의 예전 판단 「카페24는 옵션 이름 변경·삭제 불가 → 미노출로 처리」(메모리 jeju-option-sync-playbook) 중 **「이름 변경 불가」는 API 기준으로 틀림**(관리자 화면 기준이었던 것으로 보임) · 「삭제 = 미노출」은 그대로 맞음(옵션 삭제 API 는 품목 전부를 지움).

## ① 옵션 API 4종(상품 하나 단위 · 옵션 하나씩이 아님)
| API | 경로 | 요점 | 근거 |
|---|---|---|---|
| 목록 | `GET /products/{product_no}/options` | 옵션 구성 조회(읽기) | https://apidocs.cafe24.com/docs/admin/get-products-by-product-no-options |
| 등록 | `POST /products/{product_no}/options` | `has_option`(T/F) · **`option_type` = T 조합형 · E 연동형 · F 독립형** · `option_list_type`(조합형 S 분리선택 · C 일체선택 · 독립·연동은 S) · `options[]{ option_name, option_value[]{ option_text, option_image_file?, option_color? }, option_display_type S/P/B/R }` · 「**옵션을 등록하면 품목은 자동으로 생성됩니다**」 · 기존 옵션이 있는 상품에 덧붙일 수 있는지는 문서에 없음(= 옵션 없는 상품용으로 봄) · 옵션·값 최대 개수 문서에 없음 | https://apidocs.cafe24.com/docs/admin/post-products-by-product-no-options |
| **수정** | `PUT /products/{product_no}/options` · 바디 `{ shop_no:1, request:{ options:[…바뀐 이름·값], original_options:[…바꾸기 전 이름·값], option_list_type?, … } }` | 원문: 「**옵션명과 옵션값, 추가입력 옵션과 파일첨부 옵션의 수정만 가능하며, 옵션 항목을 추가하거나 삭제할 수는 없습니다**」 · 「**생성되어 있는 품목은 초기화하지 않습니다**」 · 「옵션을 추가하거나 삭제하려면 옵션 삭제 API 로 삭제 후 다시 등록」 · `original_options` = 바꾸기 전 이름·값(이것으로 어느 값을 바꾸는지 짝을 지음) | https://apidocs.cafe24.com/docs/admin/put-products-by-product-no-options |
| 삭제 | `DELETE /products/{product_no}/options` | 「**옵션을 삭제하면 옵션 기능이 '사용안함' 상태가 되기 때문에 기존에 생성되어 있던 품목도 함께 삭제되므로 주의**」 · 상품의 옵션 전체 단위 | https://apidocs.cafe24.com/docs/admin/delete-products-by-product-no-options |
- 「옵션 항목」 이 옵션 묶음(예: 「상품 및 과수」)만 뜻하는지, 묶음 안 **값 하나 추가**도 막는지는 글이 모호 → 문서 그대로 읽으면 값 추가도 막힘(배열 개수가 달라지면 짝을 못 지음). **미확정 1 · 시험 상품에서 값 하나 늘린 PUT 1회로 확정**(실패해도 품목 무변화 · 성공해도 기존 품목 유지 = 문서). 운영 상품엔 시험하지 말 것.
- 카페24 서비스 가이드(CSV 옵션 수정): 「옵션 개수를 바꾸면 사용 가능 재고와 품목 코드가 초기화」 · 조합형 외(독립형·직접입력형)는 상품 수정 화면에서만 — 같은 방향의 근거. https://serviceguide.cafe24.com/supply/en_US/PR.PE.ER.OO.html

## ② 권한(scope)
- 옵션 4종·품목 수정·품목 일괄 수정·품목 삭제 = 전부 `WRITE_PRODUCT`(각 페이지 API 정보 표).
- 우리 코드: `cafe24.js` 17행 SCOPE = `mall.read_order, mall.read_product, **mall.write_product**, mall.read_store, mall.write_store, mall.read_community, mall.write_community, mall.read_category, mall.write_category, mall.read_customer, mall.read_promotion, mall.write_promotion`.
- DB `agent_office_config 'cafe24_tokens'` 는 칸이 `enc` 하나(암호화 통째)라 scope 를 평문으로 못 봄(토큰은 안 풂). 대신 **mall-price.js 의 `PUT /products/{cno}/variants/{code}` 가 실제로 성공해 온 것(#534·#686·#714 등) = write_product 가 승인돼 있다는 실측**. 확실히 보려면 cafe24.js 248행 `out.scopes`(승인 권한 목록 · 토큰 값 아님)를 연결 테스트 화면에서 보면 됨.

## ③ 옵션 추가 뒤 추가금·판매·진열
- 지금 mall-price.js 가 쓰는 길 = `PUT /products/{product_no}/variants/{variant_code}` 「상품 품목 수정」(custom_variant_code·display·selling·additional_amount 등) — **같은 API** · 일괄판 `PUT /products/{product_no}/variants` 바디 `{ shop_no, requests:[{ variant_code(12자 필수), display T/F, selling T/F, additional_amount, quantity, use_inventory, display_soldout, … }] }` · **요청제한 100건**(한 호출 100품목 · 문서 표기).
- 관리자 화면에서 새 옵션값을 넣으면 새 품목 코드가 생기고 **추가금 0** 으로 시작(#534 실측) → 저장 직후 이 API 로 추가금·판매·진열을 맞추면 됨(지금 apply 흐름 그대로).
- 근거: https://apidocs.cafe24.com/docs/admin/put-products-by-product-no-variants-by-variant-code · https://apidocs.cafe24.com/docs/admin/put-products-by-product-no-variants
- 품목 단건 삭제 `DELETE /products/{product_no}/variants/{variant_code}` 도 있으나 옵션값이 같이 빠지는지 문서에 없음 → 쓰지 않음(숨김 = selling/display F).

## ④ 제약
- 호출 제한: 앱 전체 **10분당 3,000회 · 10분당 호출 시간 600초**(넘으면 429) + 옵션·품목 API 각 **초당 40회** · 품목 일괄 100건/호출 — 우리 쓰기 빈도와 무관.
- 옵션 수 상한: 문서에 없음(관리자 화면 기준 제한은 따로 확인 필요 · 미확정 2).
- **품목 코드 바뀜 위험**: 옵션 수정(PUT) = 유지(문서) · 옵션 삭제·재등록 = 전부 새로 · 관리자 화면에서 값 추가 = 기존 유지 + 새 코드 추가(#534 실측). 우리 쪽에서 품목 코드를 붙들고 있는 곳(mall-price · 05:10 비교 · 연결표 cafe24_sync_ignore_opts 는 옵션 글자 열쇠)이 있으니 **삭제·재등록 길은 금지**.
- 옵션 이름을 API 로 바꾸면 **05:10 네이버↔자사몰 비교 · 스냅샷 · 송장변환 매칭**이 옵션 글자로 묶이는 곳이 있음 → 이름 변경 자동화는 「네이버 옵션명과 같게 맞추기」 방향으로만(다르게 바꾸면 비교 경보).

## 미확정(2)
1. 옵션 수정 PUT 으로 **기존 묶음 안에 값 하나 추가**가 되는지 — 문서는 「항목 추가 불가」 · 시험 상품에서 1회로 확정(운영 상품 금지).
2. 상품당 옵션·옵션값 최대 개수 — 문서 없음.

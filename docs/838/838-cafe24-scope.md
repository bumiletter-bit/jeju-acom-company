# #838-3 카페24 권한 추가·재승인 순서표 (워커2 · 2026-10-24 · 총괄이 크롬으로 실행)

> 🔴 송장 등록(POST /api/v2/admin/shipments)에 필요한 권한은 **WRITE_ORDER = `mall.write_order`** 다. 공식 문서 apidocs.cafe24.com 2026-09-01판 「여러건 배송 정보 등록」·「주문 배송 정보 등록」의 scope 칸에 그렇게 적혀 있다.
> 설계 정본·838A 에 적힌 `mall.write_shipping` 은 배송사(carriers) 관리 권한이라 틀린 값이다. `mall.read_shipping` 은 GET carriers(우리 몰 CJ 배송사 코드 확인)에 쓴다.
> 🔴 #479 함정: 개발자센터에 등록되지 않은 scope 를 요청하면 재승인이 실패할 수 있다 → **① 센터 등록 → ② 코드 배포 → ③ 재승인** 순서를 지킨다.

## ① 개발자센터 권한(총괄 · 10/24 저장 누름 · 재확인)

1. developers.cafe24.com 로그인 → 상단 「Apps」(또는 「앱 관리」) → 우리 앱(Client ID `mMdlm3cHGZwkVaem7wGDIB` · 총괄 표기 「통합관리」) 선택.
2. 「권한 관리」(API 권한 · Scope) 칸으로 간다.
   - **주문(Order) = 읽기 + 쓰기**를 켠다(→ mall.read_order, mall.write_order).
   - **배송(Shipping) = 읽기**를 켠다(→ mall.read_shipping). 배송 쓰기는 켜지 않는다(쓰지 않음).
   - 기존 권한(상품 읽기·쓰기 · 상점 읽기·쓰기 · 게시판 읽기·쓰기 · 분류 읽기·쓰기 · 회원 읽기 · 프로모션 읽기·쓰기)은 그대로 둔다. 빼면 그 권한을 쓰는 기능이 403 이 된다.
3. [저장] → 화면을 새로 고쳐 주문 쓰기·배송 읽기가 체크된 채 남아 있는지 다시 본다.
   - 대표 확인 창이 뜨면 대표 몫이다. 저장이 안 됐으면 ②로 넘어가지 않는다.

## ② 코드(워커2 손질 끝 · 커밋·배포 = 총괄)

- `cafe24.js` 17행 SCOPE 끝에 `,mall.write_order,mall.read_shipping` 를 더했다(write_shipping 은 안 넣음 · 주석에 #838 근거).
- 배포 전 확인: `node --check cafe24.js` · `scripts/verify-479-points.js`(SCOPE 에 적립금이 없는지 검사 · 이번 변경과 무관하게 통과해야 함).
- 🔴 배포만 하고 재승인을 안 하면 어떻게 되나
  - 지금 토큰은 옛 권한 그대로라 종전 기능은 그대로 돈다.
  - refresh 로 토큰을 갱신해도 권한은 그대로다.
  - 송장 등록만 403 이 난다. 새 auth-url 은 재승인 때만 쓰인다.

## ③ 재승인(대표 클릭 1번 · 배포 뒤)

1. 회사프로그램 → 데이터관리 → 「카페24 연동」 카드 → **[카페24 승인]**(btn-cafe24-auth · 관리자만).
2. 새 창에서 카페24 로그인(akkome) → 권한 목록에 「주문 쓰기」·「배송 조회」가 보이면 **[동의]** → 「연동 완료」 창.
3. 같은 카드 **[연결 테스트]** → 상태 `ok` 와 `scopes` 목록(cafe24.js getStatus · 토큰 값 아님)에 `mall.write_order`·`mall.read_shipping` 이 들어 있는지 본다.
   - 없으면 ①이 저장되지 않은 것이다.
4. 종전 기능 한 번 확인: 송장변환 [자사몰 자동 불러오기] 1회(읽기) · 상품 가격 확인 카드(읽기).

## ④ 그 뒤 CJ 코드 확정(읽기만 · 838-api-외부.md 3-3)

- `GET /api/v2/admin/carriers` → 「CJ대한통운」 줄의 `shipping_carrier_code`·`carrier_id` → 설정 `invoice_auto.cafe24_carrier_code` 에 넣는다(audit).
- 길이 없으면 지난 송장 등록 주문 1건 `GET /api/v2/admin/orders/{id}/items` 의 shipping_company_code·name 으로 맞춘다.

## 되돌리기

- 재승인이 실패하면 카드 상태가 `reauth_required` 로 나온다 → ①을 고친 뒤 다시 [카페24 승인].
- 권한을 되돌리려면 cafe24.js SCOPE 를 종전 줄로 되돌리고 재승인한다(센터 권한은 남아도 무해).

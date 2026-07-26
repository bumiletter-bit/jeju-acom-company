# 쿠팡 송장변환 연동 — 설계문서

> 작성 2026-07-26 · 대표 승인(설계) · 원 지시문: `지시문_쿠팡_송장변환_연동.md` (v2, 절대 준수)
> 공식 문서(developers.coupang.com)에서 전 스펙 확정 완료 — 추측 없음.

## 0. 확정된 공식 스펙 (문서 근거)

### 발주서 목록 조회 (핵심 — 상품준비중 불러오기)
- `GET https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`
- query: `createdAtFrom`/`createdAtTo`(**yyyy-MM-dd+09:00** — '+'는 %2B 인코딩, **최대 31일**), `status=INSTRUCT`(상품준비중), `maxPerPage`(기본·최대 50), `nextToken`(페이징 — 첫 페이지는 생략)
- 응답 data[] (배송번호=shipmentBoxId 단위): orderId, orderer{name, ordererNumber(실번호·null 가능), safeNumber(안심번호)}, receiver{name, safeNumber, receiverNumber, addr1, addr2, postCode}, parcelPrintMessage(배송메세지), orderItems[]{sellerProductName(등록상품명), sellerProductItemName(등록옵션명), vendorItemName(노출상품명), **shippingCount, holdCountForCancel, cancelCount**, …}
- 🔴 **발주 가능 수량 = shippingCount − (holdCountForCancel + cancelCount)** — 문서 명시(부분취소 반영. 네이버 remainQuantity 교훈과 동일 유형)
- 🔴 문서 경고: 결제완료 상태에서 고객이 배송지 변경 가능 → **상품준비중 처리 후 조회하는 우리 흐름이 정답**(대표 발주확인 후 불러오기)

### 취소요청 조회 (변환 직전 재확인)
- `GET .../api/v6/vendors/{vendorId}/returnRequests`
- query: `createdAtFrom`/`createdAtTo`(yyyy-MM-dd, searchType=timeFrame 시 yyyy-MM-ddTHH:mm 분단위), `cancelType=CANCEL`(취소만), `status`(RU=출고중지요청 등), `nextToken`/`maxPerPage`
- 응답: orderId, receiptType(RETURN/CANCEL), receiptStatus, createdAt → **orderId 목록으로 쿠팡분 제외**

### HMAC 서명 (문서 PHP/Java 예제 그대로)
- `datetime` = **UTC** `yyMMdd'T'HHmmss'Z'`
- `message` = datetime + METHOD + path + query(‘?’ 제외, 전송과 동일한 인코딩)
- `signature` = HMAC-SHA256(message, SECRET_KEY) **hex**
- 헤더: `Authorization: CEA algorithm=HmacSHA256, access-key={AK}, signed-date={datetime}, signature={sig}`
- ⚠️ 쿼리 문자열이 서명과 실제 요청에서 **바이트 단위로 동일**해야 함 → 중계서버에서 쿼리 조립·서명·호출을 한 곳에서 수행

## 1. 중계서버 확장 (`relay/server.js` — 직접 구현, install.sh 재실행 1회)

- env 추가(**이름만** — 값은 대표 SSH): `COUPANG_ACCESS_KEY=`, `COUPANG_SECRET_KEY=`, `COUPANG_VENDOR_ID=A01600270`
- `coupangSign(method, path, query)` — 위 HMAC 스펙 그대로 (Node crypto)
- `POST /coupang` `{method, path, query?}` — 기존 Bearer 인증 뒤. **허용목록(쿠팡 전용)**:
  - `GET ^/v2/providers/openapi/apis/api/v5/vendors/{VENDOR_ID}/ordersheets$`
  - `GET ^/v2/providers/openapi/apis/api/v6/vendors/{VENDOR_ID}/returnRequests$`
  - vendorId는 env 값으로 서버가 **강제 치환**(경로 위조 차단). 그 외 전부 403 — 상품·가격 API 호출 코드 자체 없음
- `/health`에 `coupang_keys_set: true/false` 노출(값 노출 없음). RELAY_VERSION 상향
- install.sh: .env에 키 이름 3줄 append(없을 때만). `.gitignore`에 .env 포함 확인 보고
- 대표 절차서: `sudo cp .env .env.backup` → 키 값 입력(PowerShell/SSH 복붙 명령) → install.sh 재실행 → /health 확인

## 2. 회사프로그램 백엔드 (직접 구현)

- `naver-relay.js`에 `callCoupang({method, path, query}, notify)` 추가 — 같은 중계서버·같은 RELAY 토큰, 엔드포인트만 `/coupang` (기존 callNaver 무수정)
- `GET /api/agent-office/coupang/test` (adminOnly) — ①중계 도달/버전 ②쿠팡 키 설정 여부(/health) ③쿠팡 왕복(ordersheets 1일 조회) 3단계 초록불
- `coupangFetchInvoiceOrders(days)` (기본 3일·최대 31일):
  - INSTRUCT 조회, nextToken 순회(상한 20p), 호출 간 350ms + 429/5xx 지수 백오프(기존 패턴)
  - orderItems 1건 = 변환 1행. **convertDataCoupang이 읽는 9개 키로만 매핑**(변환 로직 무수정):
    `구매자`=orderer.name / `구매자전화번호`=ordererNumber∥safeNumber / `수취인이름`=receiver.name / `수취인전화번호`=receiver.safeNumber∥receiverNumber / `수취인 주소`=addr1+' '+addr2 / `배송메세지`=parcelPrintMessage / `등록상품명`=sellerProductName / `노출상품명(옵션명)`=vendorItemName / `구매수(수량)`=**shippingCount−(holdCountForCancel+cancelCount)** (0이면 행 제외)
  - `_orderId` 보존(취소 재확인용). 진단 sample(PII 마스킹 — naverMaskPII 재사용)
- `GET /api/agent-office/coupang/invoice-orders?days=N` (adminOnly) — 네이버 invoice-orders와 동일 형태 응답 + audit
- `GET /api/agent-office/coupang/canceled-since?since=ISO` (adminOnly) — returnRequests(cancelType=CANCEL, 분단위 timeFrame) → orderId 배열
- 실패 텔레그램은 회사프로그램에서(중계서버는 직접 호출 안 함 — 기존 원칙)

## 3. 프론트 (화면은 위임+검수, 취소 재확인 훅은 직접)

- 송장변환 쿠팡 카드: **[🛒 쿠팡 자동 불러오기(상품준비중)]** + 조회 일수(기본 3·최대 31) + 메시지 영역 — 네이버 버튼(#invoice-auto-smart)과 동일 패턴. 결과를 `invoiceDataCoupang`에 주입 → 기존 통합변환이 처리. 수동 엑셀 업로드 유지
- [통합 변환] 클릭 훅: 쿠팡발 데이터가 있으면 canceled-since 재확인 → `_orderId` 매칭 행 제외 + "쿠팡 취소 N건 자동 제외" 표시. 실패 시 변환 진행+경고 (네이버 때 만든 패턴 재사용 — **쿠팡은 상품준비중에도 취소요청(출고중지요청)이 존재하므로 필요**, 지시문 §5)
- 데이터관리: 쿠팡 연결 상태 카드(3단계 초록불, 네이버 패턴)

## 4. 키 만료 알림

- schedules에 일정 등록(1회): **2027-01-07 "🛒 쿠팡 API 키 재발급 (1/21 만료 2주 전)"**

## 5. 검증 (지시문 §6)

① 연결 테스트 초록불 ② 실제 상품준비중 주문 불러오기→통합변환→양식 생성 ③ **수기 Wing 다운로드 파일과 완전 대조(대표)** — Wing 실파일 1개 확보 예정(헤더 검증) ④ 취소 주문 자동 제외 확인

## 6. 하지 말 것 (지시문 §7 그대로)

- 통합변환·품목 매칭·네이버 연동 코드 수정 금지 / 발주확인·발송처리 자동화 금지 / .env 열람·출력 금지 / 상품·가격 API 호출 코드 금지 / Render에 쿠팡 키 저장 금지(NCP만) / 미매칭 상품명은 임의 매칭 없이 목록 보고

## 7. Task 분류 (원칙 — 지시문 §3 명시)

- 설계·HMAC·중계서버·수집기·취소 재확인 = **메인 직접** / 화면(버튼·연결 카드) = 위임+Sonnet 검수 / 배포·SSH·수기 대조 = 대표 게이트. 배포는 대표 확인 후(v5.9.68 예정)

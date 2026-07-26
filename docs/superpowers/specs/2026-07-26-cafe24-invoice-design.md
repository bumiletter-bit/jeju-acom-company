# 카페24 자사몰 송장변환 연동 — 설계문서

> 작성 2026-07-26 · 대표 승인(설계 + N20만 확정) · 원 지시문: `지시문_카페24` (대화 전달본, 절대 준수)
> 공식 문서(developers.cafe24.com/docs/ko/api/admin) 전 스펙 확정 — 추측 없음.
> 🔑 운영 확정(대표): akkome 몰은 **결제 시 바로 N20(배송준비중) 자동 진입** (발주확인 단계 없음) — 취소신청 섞임 방어가 중요. 현재 9건 실데이터 존재(검증 소재).

## 0. 확정된 공식 스펙

### OAuth (Authorization Code)
- 승인: 브라우저 `GET https://akkome.cafe24api.com/api/v2/oauth/authorize?response_type=code&client_id=mMdlm3cHGZwkVaem7wGDIB&state={랜덤}&redirect_uri=https://jeju-acom-company.onrender.com/api/cafe24/callback&scope=mall.read_order` → 302 `{redirect_uri}?code=...&state=...` (**code는 1분 유효·1회용**)
- 토큰: `POST https://akkome.cafe24api.com/api/v2/oauth/token` — Basic(client_id:secret), form `grant_type=authorization_code&code&redirect_uri` → `{access_token, expires_at(2시간), refresh_token, refresh_token_expires_at(2주)}`
- 갱신: 같은 엔드포인트 `grant_type=refresh_token&refresh_token=...` — **성공 시 access+refresh 둘 다 새로 발급, 구 refresh 즉시 만료** (동시 갱신 금지 — 갱신 락 필요)
- Redirect URI는 앱 등록값과 **한 글자도 다르면 실패** (카페24 명시)

### 주문 조회 (유일한 호출 API — mall.read_order)
- `GET https://akkome.cafe24api.com/api/v2/admin/orders` — Bearer access_token
- query: `start_date`/`end_date`(쌍 필수, **한 호출 최대 3개월**), `order_status=N20`, `embed=items,receivers,buyer`, `limit`(1~**1000**), `offset`(최대 8000), `date_type` 기본 order_date
- 상태 코드: N00 입금전/N02 접수중/N10 상품준비중/**N20 배송준비중(확정)**/N21 배송대기/N22 배송보류/N30 배송중/N40 완료 + C(취소)·R(반품)·E(교환) 계열
- **품목(items[])이 상태의 진실**: `items[].order_status`(품목별!), `quantity`, `claim_quantity`(취소/교환/반품 **요청** 수량), `product_name`, `option_value`, `status_code`(N1 정상/C1/C2/C3/E1)
- receivers[]: `name`, `cellphone`, `virtual_phone_no`(안심번호), `address_full`(전체주소, 폴백 address1+2), `shipping_message`
- buyer: `name`, `cellphone`
- rate limit: Leaky Bucket **40**, 초당 2회 소진, 429 시 `X-Api-Call-Limit` 헤더 — 실행당 1~2콜이라 여유(600ms 간격+백오프)
- **IP 화이트리스트 없음(문서 확인)** → 중계서버 불필요, Render 직접 호출

## 1. 취소신청 섞임 방어 (지시문 §3 + 대표 요청)

- 채택 조건: **품목별 `order_status === 'N20'`** (주문 단위 아님) — 취소신청 시 품목 상태가 C코드로 바뀌어 자연 제외
- 수량: **`quantity − (claim_quantity || 0)`**, 0 이하 제외 — 취소'요청'만 걸려 있어도 수량 차감(쿠팡 발주가능수량과 동일 사상)
- [자사몰 자동 불러오기]는 항상 버튼 시점 신규 조회(3채널 원칙). 변환 직전 별도 재확인은 두지 않음(품목 상태 필터가 제외 처리 그 자체 — 쿠팡과 달리 취소신청 즉시 품목 상태 변경 구조)
- 반품(R) 로직 없음(배송완료 이후 — 송장변환 무관)
- 검증 항목에 **"취소신청 건 제외 확인"** 포함 (실제 취소신청 만들어 확인)

## 2. 토큰 관리 (직접 구현 — 지시문 명시)

- 저장: `agent_office_config` 키 `cafe24_tokens` — **AES-256-GCM 암호화**(키 = sha256(CAFE24_CLIENT_SECRET)) 저장. 트레이드오프: Secret 변경 시 기존 토큰 복호 불가 → 재승인 1회(수용)
- **값 노출 금지**: 어떤 API 응답·로그에도 토큰/Secret 미출력. 화면엔 상태·만료시각만
- `getCafe24Token()`: access 만료 1분 전 → refresh 갱신(**모듈 락으로 동시 갱신 방지**) → 새 토큰 저장. refresh 만료/실패 → 텔레그램 1회(상태 전환 시) + 상태 'reauth_required'
- Secret: **Render 환경변수 `CAFE24_CLIENT_SECRET`** (값은 대표 직접 입력). Client ID `mMdlm3cHGZwkVaem7wGDIB`·mall_id `akkome`는 코드 상수(공개값)

## 3. 라우트

| 경로 | 권한 | 역할 |
|---|---|---|
| `GET /api/cafe24/auth-url` | adminOnly | state 생성·저장 후 authorize URL 반환(프론트가 새 창으로 오픈) |
| `GET /api/cafe24/callback` | **공개**(카페24 리다이렉트) | state 검증(불일치 403) → code→토큰 교환 → 암호화 저장 → "연동 완료" 안내 HTML |
| `GET /api/agent-office/cafe24/test` | adminOnly | Secret 설정·토큰 상태(정상/만료임박/재승인필요)·만료시각·주문 API 왕복 3줄 |
| `GET /api/agent-office/cafe24/invoice-orders?days=N` | adminOnly | N일(1~90) N20 조회 → 8키 rows (+audit) |

## 4. 데이터 매핑 (변환 계약 — convertDataJasamol 8키, 무수정)

| 수기 컬럼 | API 원천 |
|---|---|
| 주문자명 | buyer.name |
| 주문자 휴대전화 | buyer.cellphone |
| 수령인 | receivers[0].name |
| 수령인 휴대전화 | receivers[0].cellphone ∥ virtual_phone_no |
| 수령인 주소(전체) | receivers[0].address_full ∥ (address1+' '+address2) |
| 배송메시지 | receivers[0].shipping_message |
| 주문상품명(세트상품 포함) | items[].product_name (+ option_value 있으면 ' ' 연결) — **대표 수기 파일로 옵션 표기 형식 확정 후 최종 조정** |
| 수량 | quantity − claim_quantity (0 이하 제외) |
- 행 단위 = 품목(item) 1건. `_orderId`·`_itemCode` 보존(진단용). 미매칭 상품명은 기존 [미매칭] 흐름 그대로(임의 매칭 금지·목록 보고)

## 5. 화면 (위임+검수)

- 송장변환 자사몰 카드: **[🏠 자사몰 자동 불러오기(배송준비중)]** + 일수(기본 3·최대 90) + msg → `invoiceDataJasamol` 주입 (스마트스토어·쿠팡 버튼과 동일 패턴)
- 데이터관리 카페24 카드: [연동 승인](authorize 새 창)·[연결 테스트] — 토큰 상태·만료시각 표시, 재승인 필요 시 강조

## 6. 하지 말 것 (지시문 §6)

주문 조회 외 API 호출 코드 금지 / 상태 처리·발송 자동화 금지 / Secret·토큰 열람·출력·로그 금지 / 반품 로직 금지 / 기존 변환·매칭·네이버·쿠팡 코드 무수정

## 7. 검증 (§5) 및 배포

① 연결 카드 3줄+토큰 상태 ② 대표 최초 [동의] → 토큰 발급 ③ 실주문 9건 불러오기→변환→양식 ④ **수기 다운로드와 완전 대조**(대표) ⑤ 2시간 후 재승인 없이 조회(자동 갱신) ⑥ **취소신청 건 제외 확인**. 배포 v5.9.71~(당시 기준)·**단독 세션 배포 원칙**·대표 확인 후.

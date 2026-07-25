# 제주아꼼이네 회사프로그램 — 네이버 커머스API 연동 인수인계

> **이 문서 목적**: 새 세션(새 터미널)에서 이것만 봐도 네이버 API 연동 작업을 그대로 이어가기 위한 상세 기록.
> **최종 갱신**: 2026-07-25 (v5.9.55 배포 시점)
> 요약본 아님. 구체적으로 적음. 관련 상세는 리포 `NCP인증키/네이버커머스API_연동_인수인계서.md`(최초 설계)와 자동메모리 `jeju-naver-commerce-api.md`도 참조.

## ★ 진행 중: 문의시나리오 DB 통합 (2026-07-25, v5.9.55)

- **[B] 타이머의 목적 재정의(대표)**: 송장변환·중간발주는 수기 버튼 유지. 타이머는 ①고객문의 자동답변 ②정산 아침 자동수집용. 진행 순서 확정: ①문의시나리오 DB 통합 → ②정산 수집(아침 9:30~10시 + 오후 7~8시, 화면에서 변경 가능) → ③네이버 상품문의 수집+자동등록(쓰기 — 중계서버 허용목록 추가 필요). 문의 수집 주기 30분.
- **①단계 완료(v5.9.55 배포됨)**: `inquiry_scenarios` 테이블 + 톡톡봇 시나리오 **47건 이관**(46+영업시간외, 바이트 일치 검증) + [문의 관리] 화면(직원 편집 가능, 삭제·전체스위치 대표 전용) + 봇 조회 API `GET /api/scenarios`(env `SCENARIO_API_TOKEN` Bearer, 미설정 시 503 잠김).
- **톡톡봇**(`C:\Users\전승범\OneDrive\문서\★제주아꼼이네 톡톡봇`, 별도 리포): `scenario-store.js`(5분 캐시·폴백) 커밋됨, **push는 대표가 직접**(마지막 1회). `SCENARIO_SOURCE=code`(기본)→검증 후 `db` 스위치. 비교 스크립트 `scripts/compare-scenarios.js` 47/47 일치 확인됨.
- **대표 실행 절차**: `docs/문의시나리오_전환절차.md` (토큰 생성→Render env 2곳→봇 push→스위치→체크리스트).
- 설계/계획: `docs/superpowers/specs/2026-07-25-inquiry-scenario-db-design.md`, `docs/superpowers/plans/2026-07-25-inquiry-scenario-db.md`. 진행 원장: `.superpowers/sdd/progress.md`.
- ⚠️ 영업시간외 문구(0번)는 현재 봇이 미사용(코드에 import만 존재) — 화면 수정해도 봇 영향 없음, 재활성화는 별도 작업.
- **판매현황·가격 탭 (v5.9.56 배포됨)**: `{{가격표}}`/`{{판매현황}}` 원본 = `bot_products`(회사프로그램과 **같은 DB**, 36건) → [문의 관리] 탭2에서 관리(저장 → 봇 1분 캐시 반영, 봇 무수정). ⚠️ **스마트스토어 판매가 — '품목별 금액'(거래처 결제가)과 절대 통합 금지.** 톡톡봇 정리 커밋(시드 하드코딩 제거·deleted_at 필터·PRODUCTS_PAGE 게이트) push 대기 — 검증 후 Render `PRODUCTS_PAGE=off`로 구 /products 페이지 은퇴. 시나리오는 **db 스위치 완료·실응답 정상**(대표 확인).
- **에이전트 운용 원칙(대표 지시)**: 총괄(설계·판단·실서비스 섬세 작업)은 메인 모델 직접, 단순 시공만 Haiku 위임+Sonnet 검수, Task별 분류 선보고.

---

## 0. 프로젝트 개요

- **회사프로그램**: Node.js/Express + PostgreSQL, **Render** 배포 (서비스명 jeju-acom-company).
- **저장소**: `bumiletter-bit/jeju-acom-company` (GitHub, **PUBLIC**, main 브랜치 push → Render 자동배포).
  - ⚠️ PUBLIC이므로 **네이버 시크릿·토큰을 코드/커밋에 절대 넣지 말 것.**
- **로컬 작업 경로**: `C:\Users\전승범\OneDrive\문서\★제주아꼼이네 회사프로그램`
- **목표**: 네이버 스마트스토어 주문/정산을 API로 자동 수집해 회사프로그램(송장변환·정산·중간발주)에 연동. 이후 쿠팡·카페24(자사몰)까지 확대.

### 배포 방법
```
npm run deploy
```
- 동작: DB 백업 → git tag → git push (main). push되면 Render가 자동 재배포(~2분).
- ⚠️ **DB 백업이 오래 걸림(3분+ 가능)** → Bash 타임아웃 **9분(540000ms)** 이상으로 실행할 것.
- 배포 전 반드시: `node --check server.js`, `node --check public/app.js`, `version.js`의 VERSION 상향, `public/index.html`의 `app.js?v=NNN` 캐시버전 상향, `CHANGELOG.md` 갱신.
- **현재 버전: v5.9.54 / app.js 캐시 v=261.** 다음 배포는 v5.9.55 / (프론트 변경 시) v=262.
- git commit 메시지 끝에 Co-Authored-By / Claude-Session 푸터 붙이기(기존 커밋 참고).

---

## 1. 네이버 API 연동 구조 (IP 화이트리스트 우회)

네이버 커머스API는 **사전 등록된 개별 고정 IP에서만** 호출을 허용. Render의 아웃바운드 IP는 유동(랜덤) → 직접 호출 불가.
→ **고정 공인 IP를 가진 NCP 중계서버를 프록시로 경유**한다.

```
[Render 회사프로그램]  →  [NCP 중계서버 akkome-relay]  →  [네이버 커머스API]
   (naver-relay.js)        101.79.16.213 : 4000            api.commerce.naver.com
   Bearer 자체토큰만        네이버 시크릿 보관             (등록된 IP = NCP 공인IP)
```

- **네이버 client_id / client_secret 은 중계서버 .env 에만 존재.** Render/코드/GitHub에는 없음.
- Render는 중계서버 URL + 자체 Bearer 토큰(RELAY_AUTH_TOKEN)만 앎.

### 1-1. 중계서버 (NCP, akkome-relay)
- **공인 IP: `101.79.16.213`**, **포트: `4000`**
- 코드: 리포 `relay/` 폴더 (`relay/server.js`, `relay/install.sh`, `relay/설치가이드.md`).
- 현재 **HTTPS**로 동작 (자체서명 인증서). `cert.pem`/`key.pem` 있으면 HTTPS, 없으면 HTTP 폴백.
- `relay/server.js` 핵심:
  - `RELAY_VERSION` 상수를 `/health`에 노출 (install.sh 재실행으로 최신 반영됐는지 확인용). 현재 `'2026-07-24.2'`.
  - `/health` (인증 불필요, `?token=1`이면 토큰발급까지 시험) — token_test:"success" 나오면 인증 OK.
  - `/naver` (POST, 자체 Bearer 필요) — `{method, path, query?, body?}` 받아 네이버로 중계.
  - **허용목록(ALLOW)** = **읽기(GET) 전체 허용**: `/external/v1/pay-settle/`, `/external/v1/pay-order/seller/`, `/external/v1/pay-user/`, `/external/v1/seller/` + 상세조회 POST `/external/v1/pay-order/seller/product-orders/query`. **쓰기(발송처리·답변등록 등)는 전면 차단.** → 새 '조회' 기능 추가 시 **install.sh 재실행 불필요**(이미 다 열려있음). 쓰기는 나중에 명시적으로 추가.
  - 텔레그램 직접 호출 안 함(대표 설계). 오류는 journalctl 로그 + HTTP 응답으로만. 알림은 회사프로그램(텔레그램 시크릿 보유처)이 담당.

### 1-2. 중계서버 .env 구조 (`/opt/akkome-relay/.env`)
```
PORT=4000
NAVER_CLIENT_ID=(네이버 실제 client_id)
NAVER_CLIENT_SECRET=(네이버 실제 client_secret)
NAVER_TYPE=SELF
RELAY_AUTH_TOKEN=(openssl rand -hex 32 로 재생성한 값 — 설치스크립트 출력값 아님)
NAVER_API_BASE=https://api.commerce.naver.com
(TELEGRAM_* 는 비움)
```
- 실제 값 입력 완료됨(대표 직접).

### 1-3. Render 환경변수 (회사프로그램)
```
NAVER_RELAY_URL   = https://101.79.16.213:4000   (HTTPS 전환됨)
NAVER_RELAY_TOKEN = (중계서버 RELAY_AUTH_TOKEN 과 동일한 값)
NAVER_RELAY_CA    = (중계서버 자체서명 cert.pem 내용 — 인증서 고정용)
```
- ⚠️ HTTPS 전환·CA값 반영 여부는 대표 실환경 기준으로 재확인 필요할 수 있음.

### 1-4. 인증 방식 (bcrypt 전자서명) — 중계서버가 처리
- 토큰 발급: `POST https://api.commerce.naver.com/external/v1/oauth2/token`
  - Content-Type: `application/x-www-form-urlencoded` (**JSON 금지**)
  - 파라미터: `client_id`, `timestamp`(밀리초), `grant_type=client_credentials`, `client_secret_sign`, `type=SELF`
  - **서명** = `bcrypt(`${client_id}_${timestamp}`, salt=client_secret)` → base64 인코딩
  - 응답 `expires_in`(초, 보통 10800=3시간)만큼 토큰 캐싱(만료 1분 전 재발급).

### 1-5. 회사프로그램 측 클라이언트 코드
- `naver-relay.js` (리포 루트): Node 내장 http/https로 중계서버 호출. `callNaver({method,path,query,body}, notify)`, `relayHealth()`, `configured()`. 자체서명 인증서 고정(NAVER_RELAY_CA 있으면 `opt.ca`, 없으면 `rejectUnauthorized:false`).
- `server.js`에서 `const naverRelay = require('./naver-relay.js')`.
- 연결테스트: `GET /api/agent-office/naver/test` (adminOnly) — 데이터관리 화면 `#naver-connect-card` 버튼.

---

## 2. 인프라 현황 (NCP·Render·보안)

### 2-1. NCP ACG (방화벽) 인바운드 규칙
- TCP **22** ← 대표 회선 IP만(myIp). **⚠️ 대표 회선이 유동 IP** → 인터넷 회선이 바뀌면 NCP 콘솔에서 myIp 재설정해야 SSH 접속 됨.
- TCP **4000** ← `74.220.52.0/24`
- TCP **4000** ← `74.220.60.0/24` (Render 아웃바운드 대역)
- 3389(RDP) 규칙은 삭제함.

### 2-2. SSH 접속 (🔴 NCP 특성 — AWS와 다름)
- **NCP의 .pem 은 SSH 로그인 키가 아니라 root 비밀번호 복호화용.**
- 접속 순서: ①ACG 22 열림 확인 ②NCP 콘솔 '관리자 비밀번호 확인'에 .pem 첨부해 root 비밀번호 꺼냄 ③PowerShell `ssh root@101.79.16.213` + 그 비밀번호.
- **🔴 PasswordAuthentication 끄면 서버 잠김 → 절대 끄지 말 것.** (일반 SSH키 등록 후에만 키전용 전환 가능)
- 무차별대입 방어는 **fail2ban**으로(설치가이드 STEP5). 유동 IP라 ACG로 22를 특정 IP에 영구 고정 불가.

### 2-3. 서버 작업 방식
- **클로드는 코드/명령만 작성. NCP 서버 명령 실행은 대표가 PowerShell/SSH에서 직접.**
- 명령 줄 때: 복붙 가능한 한 덩어리 + 한국어 설명 + `여기에_입력` 자리표시 + 검증 명령 함께.

### 2-4. 미완료(인프라)
- 밀린 OS 업데이트(보안 포함) 미적용(재부팅 부담으로 보류).
- unattended-upgrades(자동 보안업뎃)은 ON.

---

## 3. 송장변환 자동 불러오기 진행상황 (4단계 [A]) — **작동 중, 실테스트 확인 단계**

### 3-1. 목적/흐름
네이버 **배송준비** 주문을 API로 가져와, 기존 송장변환의 스마트스토어 데이터로 **주입**한다. **변환 로직(convertDataSmart)은 절대 손대지 않음.** 수동 엑셀 업로드도 그대로 유지.

- **화면**: 송장변환 → 스마트스토어 카드 → **[🛰️ 네이버 배송준비 전체 불러오기]** 버튼 + 옆에 **조회 기간(일) 입력칸**(기본 40, 최대 180).
  - 마크업: `public/index.html` 의 `#invoice-auto-smart`, `#invoice-auto-smart-days`, `#invoice-auto-smart-msg` (~1625행).
  - 프론트 로직: `public/app.js` `loadNaver()` (~5637행). 결과를 전역 `invoiceDataSmart` 에 넣고 `updateInvoiceMergeBtn()`+`showInvoiceMergedPreview()` 호출 → 대표가 [통합 변환 및 다운로드] 누르면 기존 로직이 처리.

- **백엔드**: `GET /api/agent-office/naver/invoice-orders?days=N` (adminOnly, server.js ~5024행) → `naverFetchInvoiceOrders(days)` (server.js ~4950행).

### 3-2. `naverFetchInvoiceOrders(days)` 동작
- 네이버 조건형 조회 `GET /external/v1/pay-order/seller/product-orders` 호출.
  - query: `from`, `to`(ISO+09:00), `rangeType=PAYED_DATETIME`, `productOrderStatuses=PAYED`, `placeOrderStatusType=OK`, `pageSize=300`, `page` 순회.
- **days일을 24시간씩 나눠 순회**(네이버 1회 조회 최대 24시간 제약). 각 날짜마다 페이지 순회(최대 20p).
- 응답 항목 파싱(중첩 방어): `const c = it.content||it; const po = c.productOrder||it.productOrder||c; const od = c.order||it.order||po.order||{}; const sa = po.shippingAddress||{};`
- 스마트스토어 컬럼으로 매핑해서 rows 리턴. `convertDataSmart`가 읽는 키:
  - `구매자명`=od.ordererName, `구매자연락처`=od.ordererTel, `수취인명`=sa.name, **`옵션정보`=po.productOption**, `수량`=po.quantity, `수취인연락처1`=sa.tel1, `수취인연락처2`=sa.tel2, `통합배송지`=sa.baseAddress+detailedAddress, `배송메세지`=po.shippingMemo.
- 진단용 `sample`(개인정보 마스킹, `naverMaskPII`)·`sample_option` 반환 → 화면 🔧 진단에 표시.

### 3-3. 🔴 해결한 문제들 (이 세션)
1. **미매칭(빈값)** (v5.9.49): 주입 `옵션정보`를 상품명+옵션으로 넣었던 게 원인. **수동 엑셀은 옵션(productOption)만 매칭에 씀.** 대표 실엑셀(`스마트스토어_전체주문발주발송관리_20260725_1027.xlsx`)로 확인 — 8열 옵션정보 = "아꼼이네 상품선택: 1. 미니밤호박 특품최상급 / 상품 및 과수: 특품 5kg(10~20개)" 같은 옵션 문자열, 20열 상품명은 변환기가 안 씀. → `옵션정보=productOption`으로 수정. **대표 확인: 옵션 매칭 정상.** + content 래퍼 방어 추가.
2. **데이터 누락 1299건→183건** (v5.9.50): 최근 **3일**만 조회하던 게 원인.
   - **🔴 네이버 제약(공식문서·개발자포럼 확인)**: 네이버엔 **'현재 배송준비 상태 전체'를 주는 API가 없음**(상태 기반 목록조회 불가). **결제일 기준으로만 조회, 1회 최대 24시간, 최대 180일.**
   - → days 기본값을 **40일**로 확대(청귤 예약주문 성수기 = 결제일 한 달 이내분 커버). 화면에서 조절 가능(상한 180). 부족하면 일수 올리면 됨.
3. **중복방지 완전 제거** (v5.9.50, 대표 지시): 예전엔 "이미 올린 것 제외"(`naver_invoice_uploaded` 테이블)를 썼으나 **제거**. 이유: **중간발주 연동상 매번 '배송준비 전체'를 그대로 넘겨야 함**(거래처에 현재까지 들어온 물량 계속 알려야 하므로). 신규주문 발주확인은 대표가 수기. (테이블 정의만 잔존·무해)
4. **429 호출 제한** (v5.9.51): 40일 = 40회+ 연속 호출이 네이버 **초당 rate limit(429)**에 걸림 → `naverFetchInvoiceOrders` 안에 ①호출 사이 **350ms 간격** ②429 시 **지수 백오프 재시도**(1s→2s→4s→8s→16s, 최대 5회, `callWithRetry`) ③재시도 끝 실패 시에만 텔레그램 1회(스팸 방지) ④`naverFriendlyError`에 429 안내 추가. **⚠️ [B] 타이머 만들 때도 같은 간격/재시도 패턴 필수.**
5. **부분취소 수량** (v5.9.54): 4박스 주문→2박스 취소 시 배송준비는 2인데 4로 나옴(김혜경 사례). 네이버 `quantity`=**최초 주문 수량**(취소 미반영). 공식 구조체 수량 3필드: quantity·initialQuantity·**remainQuantity(남은 수량)**. → `수량 = remainQuantity 있으면 그것, 없으면 quantity`, remainQuantity=0이면 주문 제외. 결과 메시지에 "부분취소 수량 반영 N건" 표시. 중간발주도 같은 rows라 자동 연동. **⚠️ [B] 타이머·향후 수량 쓰는 모든 곳에서 remainQuantity 우선 규칙 유지.**
6. **하루 300건 잘림 (1298→999)** (v5.9.52): 기간을 180일로 늘려도 999건 동일 → 기간 문제 아님. 원인 추정: 응답 **totalPages 필드명이 예상과 달라 1페이지로 오판** → 주문 몰린 날(청귤 예약 오픈일)은 하루 300건(pageSize)에서 잘림. → 페이지 순회를 **"300건 만재면 다음 페이지 계속"**(짧게 오면 그 날 끝, 상한 50p) 방식으로 교체 — 응답 필드명에 무관하게 동작. 🔧 진단에 `page_info`(응답 상위 필드, PII 없음) 노출. **⚠️ 대표 확인: 취소·반품은 배송준비에 안 걸림 — 상태 정의 차이로 혼동하지 말 것. v5.9.52 재테스트(1298 근처 나오는지) 대기 중.**

### 3-4. ⚠️ 지금 확인 대기 중인 것
- 대표가 **[🛰️ 네이버 배송준비 전체 불러오기]** 눌러서 **건수가 배송준비 총건수(1299 근처)와 맞는지** 확인. (v5.9.50에서 429 떴고 → v5.9.51에서 간격+재시도로 대응 배포함. **v5.9.51 재테스트 결과 대기 중**)
- 40일 × 350ms 간격이라 **1~2분 소요**. 만약 화면이 "가져오는 중..."에서 **2~3분+ 멈춰** 있으면(Render/브라우저 타임아웃 위험) → **백그라운드 수집 방식**(뒤에서 모으고 진행률 표시, DB에 스냅샷 저장)으로 전환해야 함. 이게 [B]·중간발주 연동에도 유리.
- 발주확인·발송처리는 **대표 수기** (자동화 금지).

### 3-4-b. 중간발주 API 직결 (v5.9.53) — 완료·테스트 대기
- 송장변환 > **중간발주 탭**: 비번(4031) 엑셀 업로드 **제거** → **[📦 중간발주 시작하기]** 버튼이 같은 API(`/api/agent-office/naver/invoice-orders?days=N`)로 배송준비 전체를 불러와 `qtyRowsMain`에 주입 → 기존 `recomputeQtyAggregate()`(matchProduct로 옵션정보 파싱)·거래처 필터·품목추가·이미지 저장 **무수정** 동작. 조회 기간 입력 `#invoice-qty-days`(기본40·최대180). 문구 "현재 스마트스토어 배송준비로 중간발주를 진행합니다".
- app.js: `handleQtyUpload`/`setupQtyArea` 삭제, `setupQtyStart()`(~5765행) 추가, `resetInvoiceQty` 정리. `parseInvoiceRows` 등 헬퍼는 미사용 정의로 존치. 서버 `/api/invoice/decrypt` 존치.
- ⚠️ 불러오기 API는 **관리자 전용**(기존 정책) — 직원 계정은 중간발주 시작하기 사용 불가(필요 시 직원 허용 여부 대표에게 문의).

### 3-5. 정산 조회 (3단계) — 완료
- `GET /api/agent-office/naver/settlements?from&to` (adminOnly). 일별정산 `GET /external/v1/pay-settle/settle/daily` (필수: startDate·endDate·pageNumber·pageSize). 데이터관리 화면에서 조회. **대표 확인: 정산내역 정상.**
- 🔴 **네이버 정산금 ≠ 우리(세미) 거래처결제가 정산.** 체계 완전히 다름, 대조·병합 불가. 네이버 정산은 별도 영역으로만.

---

## 4. 다음 할 일

### 4-1. [B] 타이머 자동수집 (스마트스토어) — 다음 작업
- **전부 기본 OFF**, 화면에서 on/off + 주기(분) 변경 가능(**코드에 주기 하드코딩 금지**). `naver_auto_collect` 테이블 사용(이미 생성·시드됨: settlement 1440, order 60, claim 90, inquiry 30, 전부 OFF).
- 주기(제안): 정산 하루1번(1440분), 주문 60분, 문의 30분.
- **취소·반품 = 알림만**(대표가 (B)안 선택): 취소/반품 요청 들어오면 텔레그램 알림만. 자동처리 X.
- **🔴 "송장변환 직전 취소·반품 재확인" 기능은 넣지 말 것**(대표 지시로 제거됨): 반품은 배송준비에 없고, 취소는 PAYED에서 자동 이탈해 이미 필터로 빠짐. 취소는 대표 수기 확인.
- 네이버 **초당(token bucket) rate limit** 대비 실행 시각 분산(stagger). 일일한도 아님.
- 실패 시 텔레그램 알림(회사프로그램의 기존 텔레그램 사용).
- 변경 감지엔 `GET /external/v1/pay-order/seller/product-orders/last-changed-statuses`(PII 없음) 활용 가능.

### 4-2. 쿠팡 연동 — 나중에
- 스마트스토어 안정화 후. 별도 API/인증. 아직 착수 안 함.

### 4-3. 카페24(자사몰) 연동 — 나중에
- 스마트스토어·쿠팡 이후. 아직 착수 안 함.

### 4-4. (보류) 입금예정 캘린더
- 대표가 별도로 작업 중이라 클로드는 손대지 않음.

---

## 5. 작업 규칙 (대표 지시 — 반드시 준수)

- **변환 로직(convertDataSmart) 절대 수정 금지.** 자동 불러오기는 invoiceDataSmart에 주입만.
- **추측 금지 — 스펙은 공식 문서에서 확인.** 엔드포인트 probe(찔러보기) 금지.
  - apicenter 직접 fetch 차단됨 → **r.jina.ai 프록시**로 읽음(`https://r.jina.ai/https://apicenter.commerce.naver.com/docs/...`). SPA라 본문 안 나오면 WebSearch로 개발자포럼(github.com/commerce-api-naver/commerce-api/discussions) 확인.
- **결과물은 클로드가 직접 검증 후 보고.** 애매한 건 그대로 복명복창.
- **부작용 사전 고지**: 수정이 다른 문제를 유발할 수 있으면 먼저 대표에게 알리고 진행. 아니면 바로 실행.
- **쓰기(발송처리 등) 자동화 금지** — 현재 전부 읽기 전용. 발주확인·발송처리는 대표 수기.
- 물리삭제 금지·soft-delete, audit_logs 기록(출처 naver-api).
- 시크릿·토큰을 코드/커밋에 넣지 말 것(PUBLIC 저장소).

---

## 6. 핵심 파일 위치 요약

| 항목 | 위치 |
|---|---|
| 중계서버 코드 | `relay/server.js`, `relay/install.sh`, `relay/설치가이드.md` |
| 회사프로그램 중계 클라이언트 | `naver-relay.js` (루트) |
| 자동 불러오기 백엔드 | `server.js` `naverFetchInvoiceOrders()` ~4950행, 엔드포인트 ~5024행 |
| 자동 불러오기 프론트 | `public/app.js` `loadNaver()` ~5637행 |
| 자동 불러오기 UI 마크업 | `public/index.html` ~1616~1632행 (스마트스토어 카드) |
| 변환 로직(수정금지) | `public/app.js` `convertDataSmart()` ~5514행, `matchProduct()` ~5340행 |
| 연결테스트/정산 | `server.js` `/api/agent-office/naver/test`, `/api/agent-office/naver/settlements` |
| 자동수집 테이블 | `naver_auto_collect` (server.js initDB, 시드 완료) |
| 최초 설계 인수인계 | `NCP인증키/네이버커머스API_연동_인수인계서.md` |
| 버전 | `version.js` (현재 v5.9.50), `public/index.html` app.js 캐시(현재 v=258) |

# 쿠팡 송장변환 연동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 상품준비중 주문을 API로 불러와 기존 통합변환에 태우는 [쿠팡 자동 불러오기] + 변환 직전 취소 자동 제외.

**Architecture:** NCP 중계서버에 /coupang 경로(HMAC 서명·vendorId 강제·조회 2종만 허용) 신설 → 회사프로그램이 기존 RELAY 토큰으로 호출 → convertDataCoupang이 읽는 9키로 매핑해 invoiceDataCoupang 주입(변환 무수정).

**Tech Stack:** Node crypto(HMAC-SHA256), 기존 naver-relay 클라이언트 확장, Express.

**Spec:** `docs/superpowers/specs/2026-07-26-coupang-invoice-design.md` (전 스펙 공식 문서 확정)

## Global Constraints

- 통합변환·품목 매칭·네이버 연동 코드 수정 금지(입력 데이터 주입·필터만). 발주확인·발송처리 자동화 금지.
- 쿠팡 허용 API = ordersheets(v5)·returnRequests(v6) GET 2개뿐 — 상품·가격 API 호출 코드 자체 금지.
- .env 열람·출력 금지(키 이름만 추가). Render에 쿠팡 키 저장 금지. 쿼리 문자열은 서명·요청 바이트 동일(중계서버 한 곳에서 조립).
- 수량 = shippingCount−(holdCountForCancel+cancelCount), 0 이하 행 제외 (부분취소 — 검증 대조 항목 포함).
- HMAC·중계서버·수집기·취소재확인 = 메인 직접 / 화면 = 위임+검수(지시문 §3). 배포는 대표 확인 후 v5.9.68 / 캐시 v=272.
- 미매칭 상품명 임의 매칭 금지 — [미매칭] 목록 보고(기존 matchProduct 폴백 그대로).
- 커밋 푸터 Co-Authored-By/Claude-Session. node --check 검증(서버·프론트) + 로컬 스모크.

### Task 1 (직접): 중계서버 /coupang + install.sh + SSH 절차서
**Files:** `relay/server.js`, `relay/install.sh`, `docs/쿠팡_키입력_절차.md`
- RELAY_VERSION='2026-07-26.1'. env 구조분해에 COUPANG_ACCESS_KEY/SECRET_KEY/VENDOR_ID, COUPANG_API_BASE='https://api-gateway.coupang.com' 추가. `const crypto = require('crypto')`.
- `coupangSign(method, path, qs)`: UTC yyMMdd'T'HHmmss'Z' → msg=dt+method+path+qs → HMAC-SHA256 hex → `CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…`.
- `POST /coupang` (Bearer 뒤): 키 미설정 503 `coupang_keys_not_set` / 허용목록 = 경로 템플릿 정확 일치 2종(`/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`, `/v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests`) — `{vendorId}`는 서버가 env로 치환(위조 차단), 그 외 403 / `qs=new URLSearchParams(query).toString()`('+'→%2B 인코딩 — 서명·URL 동일 문자열 사용) / fetch 후 상태·본문 그대로 반환, 로그 마스킹 유지.
- `/health`에 `coupang_keys_set: !!(3개 모두)` 추가.
- install.sh ④ 뒤에 ④-3: `.env`에 3개 키 **이름만** append(없을 때만, VENDOR_ID는 A01600270 기본). `.gitignore`에 `.env` 포함 확인 보고.
- `docs/쿠팡_키입력_절차.md`: 백업(`sudo cp /opt/akkome-relay/.env /opt/akkome-relay/.env.backup`) → install.sh 재실행(키 이름 생성+새 코드) → `sudo sed -i` 또는 nano로 값 입력(복붙 명령 예시, 값은 자리표시) → `sudo systemctl restart akkome-relay` → `/health`에서 `version 2026-07-26.1`+`coupang_keys_set:true` 확인.
- 검증: `node --check relay/server.js`; coupangSign 단위 검증(고정 키·시각으로 hex 60자·헤더 형식 node -e 확인). 커밋.

### Task 2 (직접): 회사프로그램 백엔드
**Files:** `naver-relay.js`, `server.js`
- naver-relay.js: `callCoupang(opts, notify)` — callNaver 복제, 엔드포인트 `/coupang`, 알림 문구 🛒 쿠팡. exports 추가. (callNaver 무수정)
- server.js (네이버 자동수집 블록 뒤):
  - `coupangCallWithRetry(req)` — 429/5xx 지수 백오프(1s→16s, 5회), naverRelay.callCoupang 사용.
  - `coupangFetchInvoiceOrders(days)` — INSTRUCT 조회: query `{createdAtFrom: from+'+09:00', createdAtTo: to+'+09:00', status:'INSTRUCT', maxPerPage:50, (nextToken)}` (from=오늘−(days−1), to=오늘, KST), nextToken 순회 상한 20p·간격 350ms. orderItems 1건=1행, 9키 매핑(스펙 §2 표) + `_orderId`, 수량 공식·0 이하 제외·partialAdjusted 집계, sample=naverMaskPII.
  - `GET /api/agent-office/coupang/invoice-orders?days=N`(adminOnly, days 1~31 클램프) — `{ok, days, fetched, count, rows, sample, partial_adjusted}` + audit(naver-api 패턴, targetType 'coupang_order').
  - `GET /api/agent-office/coupang/test`(adminOnly) — ①relayHealth(coupang_keys_set 포함) ②왕복: ordersheets 오늘 1일 INSTRUCT 조회(2xx/4xx=도달 성공 판정 — 네이버 test 패턴).
  - `GET /api/agent-office/coupang/canceled-since?since=ISO`(adminOnly) — returnRequests `{searchType:'timeFrame', createdAtFrom/To: KST 'yyyy-MM-ddTHH:mm', cancelType:'CANCEL', maxPerPage:50}` since는 now−23.5h 클램프, nextToken 상한 5p → `{ok, canceled:[orderId...]}`.
  - initDB: 키 만료 일정 1회 시드 — schedules에 제목 `🛒 쿠팡 API 키 재발급 (1/21 만료 2주 전)` date '2027-01-07' 없으면 INSERT(category '일반', type 'normal').
- 검증: node --check + 로컬 스모크(키 미설정 상태 → test가 coupang_keys_set:false를 정상 보고하는지). 커밋.

### Task 3 (위임 Sonnet+검수): 프론트 화면
**Files:** `public/index.html`, `public/app.js`
- index.html 쿠팡 카드(수동 업로드 영역 위/옆 — 스마트스토어 `#invoice-auto-smart` 블록과 동일 패턴): `#invoice-auto-coupang` 버튼 "🛒 쿠팡 자동 불러오기(상품준비중)" + `#invoice-auto-coupang-days`(기본 3, min1 max31) + `#invoice-auto-coupang-msg`.
- app.js `loadCoupang()` — loadNaver()와 동일 구조(IIFE): `/api/agent-office/coupang/invoice-orders?days=` 호출 → `invoiceDataCoupang = r.rows; coupangInvoiceLoadedAt = new Date().toISOString();` → 파일명 표시(`🛒 쿠팡 상품준비중 N건`)+has-file+`updateInvoiceMergeBtn()`+`showInvoiceMergedPreview()` → 부분취소 N건·진단 details 표시. 실패 시 msg.
- `coupangInvoiceLoadedAt`는 전역 let (Task 4가 사용). `resetInvoice()`에 `coupangInvoiceLoadedAt = null;` 추가.
- 데이터관리: `#naver-connect-card` 아래(타이머 카드 위)에 `#coupang-connect-card`(admin 표시 — updateUserUI 1줄) + [연결 테스트] 버튼 → `/api/agent-office/coupang/test` 3줄 초록불(네이버 btn-naver-test 렌더 패턴 복제).
- 관례: api() 위치 인자 / aoEsc·escapeHtml 재사용 / 기존 스마트스토어 코드 무수정.

### Task 4 (직접): 통합 변환 직전 쿠팡 취소 재확인
**Files:** `public/app.js`
- `recheckCoupangCancellations()` — coupangInvoiceLoadedAt·invoiceDataCoupang 있을 때만: canceled-since 호출 → `invoiceDataCoupang = invoiceDataCoupang.filter(r => !set.has(String(r._orderId)))` → 제외 N>0이면 coupang msg에 "🛡️ 쿠팡 취소 N건 자동 제외" → loadedAt 갱신. 실패 시 경고만·변환 진행.
- `invoice-merge-btn` 핸들러를 async로: 첫 줄 `await recheckCoupangCancellations();` (나머지 무수정).

### Task 5: 최종 리뷰(Fable) → 대표 배포 확인(v5.9.68/v=272/CHANGELOG) → SSH 절차 안내 → 검증 가이드(부분취소 케이스 포함) → CLAUDE.md·메모리.

## Self-Review
- 스펙 0↔T1·T2(스펙 값 그대로), 1↔T1, 2↔T2, 3↔T3·T4, 4↔T2(일정), 5·6↔T5/Global — 커버 완료. `_orderId` 문자열 비교 일치(T2 String(orderId)↔T4 String(r._orderId)). 쿼리 '+' 인코딩은 URLSearchParams가 %2B 처리(서명·URL 동일 객체서 생성).

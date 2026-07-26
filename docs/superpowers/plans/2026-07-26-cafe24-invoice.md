# 카페24 송장변환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카페24 배송준비중(N20) 주문을 OAuth로 불러와 기존 통합변환에 태우는 [자사몰 자동 불러오기] — 3채널 완성.

**Architecture:** 신규 모듈 `cafe24.js`(토큰 암호화 저장·자동 갱신 락·주문 조회·8키 매핑) + server.js 라우트 4종 + 프론트 버튼/연결 카드. IP 제한 없음 → Render 직접 호출.

**Tech Stack:** Node crypto(AES-256-GCM), 내장 fetch, agent_office_config 토큰 저장.

**Spec:** `docs/superpowers/specs/2026-07-26-cafe24-invoice-design.md` (§0~7 = 계약. 값·경로·필드 전부 스펙 표 그대로)

## Global Constraints
- 주문 조회 외 API 호출 코드 금지 / 상태·발송 자동화 금지 / Secret·토큰 열람·출력·로그 금지 / 반품 로직 금지 / 기존 변환·매칭·네이버·쿠팡 코드 무수정.
- Redirect URI `https://jeju-acom-company.onrender.com/api/cafe24/callback` — 한 글자도 다르면 실패. Client ID `mMdlm3cHGZwkVaem7wGDIB`, mall `akkome`, scope `mall.read_order` (코드 상수).
- 품목 채택 = `items[].order_status === 'N20'` / 수량 = `quantity − (claim_quantity||0)` (0 이하 제외).
- OAuth·토큰 갱신·수집기 = 직접, 화면 = 위임+검수. 배포는 대표 확인·단독 세션. node --check + 로컬 스모크. 커밋 푸터 관례.

### Task C1 (직접): cafe24.js 모듈 + server.js 라우트 4종
**Files:** Create `cafe24.js`, Modify `server.js`
- cafe24.js exports: `getStatus()`(secret_set/token_state[none|ok|expiring|reauth_required]/expires_at — 값 미노출), `getAuthUrl(state)`, `exchangeCode(code)`, `fetchInvoiceOrders(days)`, `apiGet(path, query)`(내부).
- 토큰 저장: `agent_office_config` `cafe24_tokens` = AES-256-GCM(JSON, 키=sha256(CAFE24_CLIENT_SECRET), iv 12B+tag 저장). 로드 실패(복호 불가) = reauth_required.
- `getToken()`: access 만료 60초 전이면 refresh(모듈 프로미스 락 — 동시 1회). refresh 실패/만료 → 상태 reauth_required + notifyTelegram 1회(상태 전환 시) — telegram 함수는 server.js에서 `init({ notify })`로 주입(모듈은 시크릿 무접촉).
- `apiGet`: `https://akkome.cafe24api.com` + Bearer, 헤더 X-Cafe24-Api-Version 미지정(기본). 429/5xx 지수 백오프(1s→16s, 5회) + 호출 간 600ms.
- `fetchInvoiceOrders(days)`: 기간 = 오늘−(days−1)~오늘(KST, ≤90), `order_status=N20&embed=items,receivers,buyer&limit=1000&offset` 순회(offset≤8000). 행 = 품목 1건, **스펙 §4 표 그대로 8키** + `_orderId`/`_itemCode`. sample = naverMaskPII 재사용 위해 rows[0] 원본을 서버에서 마스킹.
- server.js: `const cafe24 = require('./cafe24.js'); cafe24.init({ pool, notify: notifyTelegram });` + 라우트 4종(스펙 §3 표: auth-url(adminOnly, state=crypto.randomUUID→config `cafe24_oauth_state` 저장 10분 유효)/callback(공개, state 검증→exchangeCode→성공 HTML "연동 완료 — 창을 닫아주세요", 실패 HTML 사유)/test(adminOnly: secret_set·token_state·expires_at·왕복(오늘 1일 N20 조회 시도, reauth면 왕복 생략)) /invoice-orders(adminOnly, days 1~90 클램프, audit targetType 'cafe24_order')).
- 검증: node --check 2종 + 로컬 스모크(SECRET 미설정 상태에서 getStatus→secret_set:false·auth-url 503·callback state 불일치 403). 커밋.

### Task C2 (위임 Sonnet+검수): 화면
**Files:** `public/index.html`, `public/app.js`
- 송장변환 자사몰 카드(자사몰 업로드 영역 — `invoice-upload-jasamol`·`invoice-filename-jasamol` id 실재 확인)에 스마트스토어/쿠팡 패턴으로: `#invoice-auto-jasamol` 버튼 "🏠 자사몰 자동 불러오기(배송준비중)" + `#invoice-auto-jasamol-days`(기본 3, min1, max90) + `#invoice-auto-jasamol-msg`.
- app.js IIFE `loadJasamol()` — `/api/agent-office/cafe24/invoice-orders?days=` → `invoiceDataJasamol = r.rows` → 파일명 `🏠 자사몰 배송준비중 N건`·has-file·updateInvoiceMergeBtn()·showInvoiceMergedPreview()·부분취소 partial_adjusted 표시·진단 details(aoEsc) — loadCoupang IIFE(~5760행대) 복제 수준.
- 데이터관리: `#coupang-connect-card` 아래 `#cafe24-connect-card`(display:none + updateUserUI admin 1줄):
  헤더 "🏠 카페24(자사몰) 연동" + [연동 승인] `#btn-cafe24-auth` + [연결 테스트] `#btn-cafe24-test` + `#cafe24-test-result`.
  - [연동 승인]: `api('/api/cafe24/auth-url')` → `window.open(r.url, '_blank')` → 안내 "카페24 로그인 후 [동의]를 눌러주세요. 완료 창이 뜨면 [연결 테스트]로 확인".
  - [연결 테스트]: `/api/agent-office/cafe24/test` → 4줄(🟢/🔴): Secret 설정 / 토큰 상태(만료시각 표시, reauth_required면 "재승인 필요 — [연동 승인] 클릭") / 주문 API 왕복 / 종합.
- 관례: api() 위치 인자·aoEsc·기존 코드 무수정·version/CHANGELOG 금지(C3).

### Task C3: Fable 최종 리뷰 → 대표 게이트
- 버전 v5.9.71(당시 최신+1)/캐시 +1/CHANGELOG → Fable 리뷰(중점: 토큰 암호화·로그 미노출·state 검증·품목 필터·기존 3채널 무회귀) → 지적 수정 → **대표 확인 후 배포(단독 세션)** → 대표 절차 안내(①Render `CAFE24_CLIENT_SECRET` 입력 ②[연동 승인]→[동의] ③9건 불러오기→변환→수기 대조 ④취소신청 제외 확인 ⑤2시간 후 자동 갱신 확인) → CLAUDE.md·메모리.

## Self-Review
- 스펙 §0↔C1(값 그대로), §1↔C1 필터·수량, §2↔C1 토큰, §3↔C1 라우트, §4↔C1 매핑+수기파일 조정 여지, §5↔C2, §6↔Global, §7↔C3. 이름 일치: fetchInvoiceOrders/getStatus/getAuthUrl/exchangeCode, invoiceDataJasamol(기존 전역), 라우트 경로 스펙 §3 표.

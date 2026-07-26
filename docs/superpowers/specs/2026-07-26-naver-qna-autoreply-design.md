# STEP E — 네이버 상품문의(Q&A) 자동답변 설계서

> 작성: 2026-07-26 밤 (설계만 — 시공·배포는 대표 승인 후)
> 대상: 스마트스토어 판매자센터 **상품문의(Q&A, 공개 게시판)**
> 원칙: **자동 게시 절대 없음.** 수집 → AI 배정 → 초안 → [문의 관리] 승인 → 게시. 순서 고정.

---

## 0. 핵심 사실 확인 (설계 전 검증 결과)

1. **상품문의(Q&A)는 현재 수집되지 않고 있다.** 가동 중인 30분 문의 수집기(`collectInquiry`)는
   `GET /external/v1/pay-user/inquiries` = **고객문의(문의하기)** 전용. 상품문의(Q&A)는 별도 API(`contents/qnas`)이며
   중계서버 ALLOW에 **읽기 경로조차 없다** (ALLOW는 pay-settle·pay-order/seller·pay-user·seller만 GET 허용).
   → **읽기 1줄 + 쓰기 1줄, 총 2줄** ALLOW 추가 필요 (쓰기는 지시대로 정확히 1줄).
2. DB의 `naver_inquiries`는 현재 **2건뿐** (수집기가 7/26 가동 시작, 조회 창 3일 — 과거분 없음).
   실문의 분석 재료는 **`message_logs`(톡톡봇 실메시지 947건, 6/11~7/25, 직원 실답변 570건)** 를 사용했다. §8 참조.
3. 봇 조회 API(`GET /api/scenarios`) 채널 필터: `talktalk → ['톡톡','공통']`, `product → ['상품문의','공통']`.
   → 기존 톡톡 시나리오를 '공통'으로 전환해도 톡톡봇 동작 무영향(계속 내려감). 상품문의 전용은 채널 '상품문의'로 신규 등록.
4. 서버에 Anthropic SDK + `ANTHROPIC_API_KEY`(Render) + `MARU_MODEL`(기본 claude-haiku-4-5) 이미 사용 중 — AI 배정에 재사용.

---

## 1. 답변 등록 API 스펙 (공식 문서 확정 — 추측 없음)

문서 출처: `apicenter.commerce.naver.com/docs/commerce-api/current/` (r.jina.ai 프록시로 열람)
- 목록 조회: `get-comments-contents` 페이지
- 답변 등록/수정: `create-or-update-answer-contents` 페이지

### 1-1. 상품문의 목록 조회 (읽기)
- `GET https://api.commerce.naver.com/external/v1/contents/qnas`
- 쿼리: `fromDate`·`toDate`(date-time, **필수**), `page`(기본 1), `size`(기본 100, **최대 100**), `answered`(boolean, 선택)
- 응답 `contents[]`: `questionId`(integer, 고유키), `productId`, `productName`, `question`(문의 내용),
  **`answer`(판매자 답변 — 직원 실답변 수집 가능)**, `answered`(boolean), `createDate`, `maskedWriterId`(마스킹된 작성자 ID)
- 페이징: `page`/`size`/`totalElements`/`totalPages`
- ⚠️ 조회 기간 상한은 문서에 명시 없음 → 시공 시 고객문의와 동일하게 **최근 3일 창**으로 보수 운용(30분 주기라 충분한 겹침).

### 1-2. 상품문의 답변 등록/수정 (쓰기 — 이번 프로젝트의 유일한 쓰기)
- `PUT https://api.commerce.naver.com/external/v1/contents/qnas/{questionId}`
- 경로 파라미터: `questionId` (integer, 필수)
- 요청 바디: `{ "commentContent": "답변 내용" }` (필수. 글자수 제한은 문서 미명시 — 시공 시 2,000자 자체 상한)
- 성공: **204 No Content**. 오류: 400/401/403/404/500 (`code`·`message`·`invalidInputs[]`·`traceId`)
- 등록과 수정이 같은 엔드포인트(PUT) — 이미 답변된 건에 다시 호출하면 **수정**됨. 승인 화면에서 미답변 건만 노출해 오수정 방지.

---

## 2. 아키텍처 (톡톡봇 검증 구조 재사용)

```
[30분 타이머 qna 수집기]                [문의 관리 › 상품문의 탭]           [네이버]
collectQna (읽기 전용)                                                  contents/qnas
  ├ GET contents/qnas (최근 3일)          미답변 목록 표시
  ├ naver_qnas upsert (질문 마스킹)        ├ 🤖 AI 초안 건: 문구 수정 가능
  ├ 신규 미답변 → AI 배정(배정만)           │   → [승인·게시] 클릭(직원 가능)
  │   ├ 시나리오 채택 → 초안 저장           │   → PII 검사 통과 시에만
  │   └ 확신 없음 → SKIP(직원 답변 필요)     │   → PUT .../qnas/{id} (유일한 쓰기)
  └ 텔레그램: 초안 M건·직원 필요 K건        └ ✍️ SKIP 건: 직원이 직접 작성 후 동일 게이트
```

- **쓰기 호출 지점은 코드 전체에서 단 1곳**: `POST /api/agent-office/naver/qnas/:id/answer` 라우트 내부.
  타이머·수집기·다른 어떤 코드 경로에서도 쓰기 함수를 호출하지 않는다(함수 자체를 라우트 안에 두어 참조 불가).
- 기존 문의 수집기(`collectInquiry`)·톡톡봇·시나리오 로직은 **무수정** (추가만).

### 2-1. AI 배정 (배정만 — AI 문장 생성 금지, 톡톡봇 규칙 동일)
- 대상 시나리오: `inquiry_scenarios`에서 `channel IN ('상품문의','공통') AND enabled AND deleted_at IS NULL`.
- **1차: 키워드 매칭** (톡톡봇과 동일한 결정적 로직, 공백 제거 포함 매칭).
  - 정확히 1개 시나리오만 매칭 → 그 시나리오 채택.
- **2차: LLM 판정** (1차가 0건 또는 2건 이상일 때만): Claude(`MARU_MODEL`)에게 질문 원문 + 시나리오 목록(번호·이름·키워드)을
  주고 **"시나리오 번호 하나 또는 SKIP"만** 출력받는다(JSON 강제, temperature 0). 형식 위반·불확실 → SKIP.
- 채택 시 **초안 = 해당 시나리오의 `response` 문구 그대로** (변형·생성 금지). `{{가격표}}`/`{{판매현황}}` 플레이스홀더는
  서버가 `bot_products`로 치환(봇과 동일 규칙)한 결과를 초안에 담는다.
- SKIP → 초안 없이 `ai_status='skip'` ("직원 답변 필요"로 분류). 침묵 정책 유지.
- 배정은 **수집 시점에 1회만** 실행(신규 미답변 건 한정) — 반복 호출·비용 폭주 방지.

### 2-2. DB
```sql
CREATE TABLE IF NOT EXISTS naver_qnas (
    question_id  BIGINT PRIMARY KEY,
    raw          JSONB,            -- product_name·question(마스킹)·create_date·masked_writer_id 등 최소 필드
    answered     BOOLEAN,          -- 네이버 기준 답변 여부 (수집 시 갱신)
    ai_status    VARCHAR(10),      -- 'draft' | 'skip' | NULL(미배정)
    ai_scenario_id INTEGER,        -- 채택 시나리오 id (참고용)
    ai_draft     TEXT,             -- 확정 문구 초안 (플레이스홀더 치환 후)
    posted_at    TIMESTAMP,        -- 우리 화면에서 게시 성공 시각
    posted_by    VARCHAR(50),      -- 게시자 계정명 (audit와 별개로 목록 표시용)
    post_error   TEXT,             -- 마지막 게시 실패 사유 (성공 시 NULL)
    collected_at TIMESTAMP DEFAULT NOW()
);
```
- 질문 본문도 고객문의와 동일하게 `naverMaskContact` 마스킹 후 저장(공개 게시판이지만 동일 기준 적용).
- 90일 경과분 물리 정리(고객문의와 동일 정책 — 원본은 네이버에 있음).
- `naver_auto_collect`에 `('qna', false, 30)` 시드 — **기본 OFF**(중계서버 ALLOW 반영 전 켜면 403 실패 표시됨).

### 2-3. 승인·게시 라우트 (유일한 쓰기)
- `POST /api/agent-office/naver/qnas/:id/answer` — `authMiddleware`(**직원 포함** — 대표 지시).
- 바디: `{ content }` (화면에서 수정된 최종 문구).
- 처리 순서: ①PII 검사(§3) — 실패 시 403 + 사유(게시 안 함) ②`PUT /external/v1/contents/qnas/{id}` 중계 호출
  ③성공(204) → `posted_at`·`posted_by` 기록 + `writeAudit(action:'post_answer', targetType:'naver_qna', source:'naver-qna', actor)`
  ④실패 → `post_error` 저장 + 텔레그램 1회 + 화면 상태 표시. 게시 성공 여부와 무관하게 audit에 시도 기록.
- 이미 `posted_at` 있는 건·네이버 `answered=true` 건은 재게시 차단(수정은 판매자센터에서 — 오수정 방지).

### 2-4. 알림 (기존 알림 설정 화면에 'qna' 키 추가)
- `TELEGRAM_ALERT_KEYS`에 `'qna'` 추가, 기본 문구:
  `🛒 상품문의 신규 {{건수}}건 — 🤖 AI 초안 준비 {{초안}}건 · ✍️ 직원 답변 필요 {{직접}}건`
- 기존 고객문의(inquiry) 알림은 무수정. 게시 실패 알림은 별도 고정 문구 1회.

### 2-5. 화면 ([문의 관리] 4번째 탭 "🛰️ 상품문의")
- 목록: 미답변 건을 위로, 각 행 = 상품명·질문(앞부분)·경과 시간·상태 배지(🤖 AI 초안 / ✍️ 직원 답변 필요 / ✅ 게시됨 / ⚠️ 게시 실패).
- 행 펼치면: 질문 전문 + 초안 textarea(수정 가능) + 배정 시나리오명 + [승인·게시] 버튼 + 실패 사유.
- SKIP 건은 빈 textarea(직원 직접 작성) — 동일한 [승인·게시] 게이트 통과.
- 삭제·전체 스위치 같은 대표 전용 요소 없음(게시 자체가 승인 행위). 디자인은 `디자인/디자인_가이드.md` 준수.

---

## 3. 개인정보(PII) 게시 차단 검사 — 서버 측, 게시 직전 필수 통과

공개 게시판이므로 아래 패턴 검출 시 **게시 차단 + 사유 표시** (직원이 문구 수정 후 재시도):
1. 휴대폰/전화번호: `01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}`, `\d{2,4}[-\s.]\d{3,4}[-\s.]\d{4}`
   — 단, **고객센터 대표번호(010-6687-4031)는 화이트리스트** (시나리오 문구 공통 꼬리에 포함되어 있음).
2. 이메일 패턴 — 단, 회사 공개 메일(bumiletter@naver.com)은 화이트리스트.
3. 주문번호 의심: 14자리 이상 연속 숫자(`\d{14,}` — 네이버 주문번호 16자리 커버).
4. 주소 의심: `(시|군|구)\s?.{0,12}(로|길)\s?\d` 또는 `\d+동\s?\d+호` 패턴.
5. 고객 이름은 패턴 검출 불가 → **운영 규칙**으로 보완: 초안은 확정 문구뿐이라 이름이 들어갈 수 없고,
   직원 직접 작성 시 "이름·주문정보 언급 금지" 안내 문구를 입력창 위에 고정 표시.

---

## 4. 중계서버 변경 (시공 시 리포 수정 → 대표 SSH 재실행)

`relay/server.js` ALLOW에 **딱 2줄** 추가 + `RELAY_VERSION = '2026-07-27.1'`:
```js
{ m: 'GET', re: /^\/external\/v1\/contents\/qnas$/ },        // 상품문의 목록 조회 (읽기)
{ m: 'PUT', re: /^\/external\/v1\/contents\/qnas\/\d+$/ },   // 상품문의 답변 등록/수정 (유일한 쓰기 — 승인 게이트 전용)
```
- 쓰기는 questionId 숫자 경로 정확 일치만 허용 — 그 외 쓰기 경로 전면 차단 유지.
- 반영 절차(순서 중요): **①시공 커밋·배포(main push) 후** ②대표 SSH → install.sh 재실행(코드가 GitHub main에서 내려받아짐)
  ③`/health`의 RELAY_VERSION으로 반영 확인. 복붙 명령은 보고서 §4 참조.

---

## 5. 시나리오 채널 운용 설계

- 기존 51건(0~50번)은 전부 채널 '톡톡'. **원본 무수정 원칙** 하에:
  - **공통 전환**: 채널 값만 '톡톡'→'공통' 변경(문구 무수정). 봇 무영향(§0-3). 후보 목록은 보고서 §5 — **대표 승인 후** 화면에서 변경.
  - **상품문의 전용 신규**: 공개 게시판 톤(개인정보·개별 주문 언급 없음, 사진 필요 건은 톡톡/전화 유도)으로 신규 등록.
    후보 초안 8건은 보고서 §5 — **등록은 대표 검토 후 결정** (지시 원문대로).
- 채널 변경·신규 등록 모두 기존 [문의 관리] 화면으로 수행(코드 추가 불필요) — 채널 드롭다운 이미 존재.

---

## 6. 검증 계획

1. 시공 후: `node --check server.js`·`node --check public/app.js`, 로컬 문법·라우트 스모크.
2. 배포 → 대표 SSH로 install.sh 재실행 → `/health` RELAY_VERSION `2026-07-27.1` 확인.
3. [데이터관리] 타이머 카드에서 qna 수집 ON(30분) → 첫 수집 후 [문의 관리 › 상품문의] 목록·배지 확인.
4. **PII 차단 리허설**: 초안에 임의 전화번호를 넣고 [승인·게시] → 차단·사유 표시 확인 (실게시 전 필수).
5. **첫 실게시는 대표가 고른 문의 1건**으로만 진행 → 판매자센터에서 게시 문구·위치 실물 확인 → 이상 없으면 정식 운용.
6. audit_logs에 게시 기록(계정 포함) 확인.

---

## 7. 대표 결정 필요 (내일 아침)

1. AI 배정 방식 승인: **키워드 1차 + 애매할 때만 LLM(권고)** vs LLM 전체 판정 vs 키워드만.
2. 공통 전환 후보(보고서 §5-1)·상품문의 신규 초안 8건(§5-2) 검토·확정.
3. qna 수집 ON 시점(중계서버 재실행 후)·알림 문구.
4. 첫 실게시 대상 문의 1건 선택.

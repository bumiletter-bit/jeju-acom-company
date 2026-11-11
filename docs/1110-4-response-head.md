# #1110-4 문의 관리 「응대 현황」 탭 — 설계·계약서

작성 2026-11-11 · 워커3(총괄 claude-22 배정) · 시공 전 문서(「고」 뒤 착수)

## 0. 한 줄

문의 관리 맨 앞에 「응대 현황」 탭을 둔다. 왼쪽에 사용 설정·숫자 카드·미리 물어보기 칩·연결된 재료, 오른쪽에 채팅 꼴 미리보기. 손님이 물을 만한 글을 넣으면 봇이 실제로 뭐라고 답하는지 보고, 답 아래 「쓴 재료」를 눌러 그 시나리오를 바로 고친다.

대표 확정(11/11)

- 미리보기·숫자 카드·답변 재료 = 전 직원
- 사용 설정 스위치 = 대표만(직원은 상태만 봄)
- 쓰임 = 「재료 낡음」 알림을 받은 직원이 들어와 같은 질문을 넣어 보고 「쓴 재료」로 바로 고침
- 구도 = 카나나(카카오 상담매니저) 관리 화면 꼴

탭 순서(시공 뒤): 응대 현황 | 답변 재료 | 판매현황·가격 | 알림 발송 이력 | 발송 휴무일 | 당첨 지급

---

## 1. 서버 API 계약(server.js = 워커1 몫)

둘 다 `authMiddleware`(로그인한 전 직원). 세무사 계정은 메뉴가 안 보이지만 서버에서도 `role === 'accountant'` 면 403.

### 1-1. GET /api/agent-office/response-stats?days=7

숫자 카드 + 사용 설정 상태를 한 번에 준다(문의 관리 진입 때 목록 GET 2번을 이걸로 바꾼다 · 3절).

- `days` = 7(기본) 또는 30. 그 밖 값은 7.
- 응답

```json
{
  "ok": true,
  "days": 7,
  "from": "2026-11-05", "to": "2026-11-11",
  "channels": {
    "talk":    { "total": 120, "bot": 48, "staff": 61, "open": 11 },
    "qna":     { "total": 40,  "bot": 33, "staff": 7,  "open": 0 },
    "inquiry": { "total": 8,   "bot": 5,  "staff": 3,  "open": 0 },
    "sms":     { "total": 71,  "bot": 2,  "staff": 60, "open": 9 }
  },
  "all": { "total": 239, "bot": 88, "staff": 131, "open": 20 },
  "settings": {
    "auto_reply": true,
    "qna_auto_post": true,
    "inquiry_auto_post": false,
    "sms_mode": "draft",
    "talk_once_until_hour": 9
  },
  "materials": { "scenarios": 63, "season": 42, "season_today": 12 },
  "preview": { "left_today": 100, "cap": 100 },
  "cached_at": "2026-11-11T02:10:00Z"
}
```

- 30초 메모리 캐시(같은 days). 스위치를 바꾸면 캐시 비움.
- `settings` 는 읽기만. 바꾸기는 종전 PUT 3개 그대로(scenarios-auto-reply · naver/qna-auto-post · naver/inquiry-auto-post · 전부 ownerOnly). sms_mode·talk_once_until_hour 는 보기만(바꾸기는 총괄).

#### 세는 기준 = 「손님 대화」(줄이 아님)

세 칸은 서로 겹치지 않는다. 한 대화는 기간 안 마지막 상태로 한 칸에만 든다.

| 칸 | 뜻 |
|---|---|
| bot(봇이 답함) | 그 대화의 마지막 손님 글에 봇 답이 나갔고 그 뒤 직원 답이 없음 |
| staff(직원이 답함) | 마지막 손님 글 뒤(또는 그 글에) 직원 답이 있음 · [확인]/[처리함]으로 닫은 것 포함 |
| open(아직 안 답함) | 답이 필요한데 아무도 안 답함 = 손님 연락 창의 「미처리」와 같은 판정 |

total = 세 칸 합. 인사·입장 글뿐인 대화, 광고 판정 글, 무시(인증번호·광고·통신사) 문자는 total 에서 뺀다.

#### 채널별 쿼리 초안

톡톡(message_logs) — 카카오(`kakao:`)·자사몰(`mall:`) 제외. 손님 연락 창과 같은 규칙을 SQL 로 옮긴 꼴. 색인 `(received_at)` 로 기간을 먼저 좁힌다.

```sql
WITH w AS (
  SELECT id, user_id, message, answered, bot_response, staff_response, reviewed_at
  FROM message_logs
  WHERE received_at > (NOW() AT TIME ZONE 'UTC') - make_interval(days => $1)
    AND user_id IS NOT NULL AND user_id NOT LIKE 'kakao:%' AND user_id NOT LIKE 'mall:%'
),
l AS (  -- 손님별 마지막 줄(입장 글뿐인 줄은 뒤로)
  SELECT DISTINCT ON (user_id) *
  FROM w
  ORDER BY user_id,
           (btrim(COALESCE(message,'')) IN ('이 상품을 문의합니다.','이 상품을 문의합니다') AND btrim(COALESCE(staff_response,'')) = '') ASC,
           id DESC
)
SELECT
  count(*) FILTER (WHERE handled)                         AS staff,
  count(*) FILTER (WHERE NOT handled AND answered)        AS bot,
  count(*) FILTER (WHERE NOT handled AND NOT answered)    AS open
FROM (
  SELECT answered,
         (btrim(COALESCE(staff_response,'')) <> '' OR bot_response LIKE '[직원응답%' OR reviewed_at IS NOT NULL) AS handled
  FROM l
  WHERE btrim(COALESCE(message,'')) NOT IN ('', '[직원 직접답변]', '이 상품을 문의합니다.', '이 상품을 문의합니다')
) s;
```

- 「1번만 응대」로 봇이 침묵한 줄(`[1회응대-무응답]`)·쿨다운 줄(`[쿨다운-무응답]`)은 answered=false → 직원 답이 없으면 open 으로 센다(직원 몫이 맞음). 따로 보여 주고 싶으면 `silent` 칸(`bot_response LIKE '[1회응대%' OR LIKE '[쿨다운%'`)을 더해 「봇이 쉬는 중 n」 작은 글로.
- 광고 판정(AD_RE)은 SQL 로 못 옮긴다 → 서버가 `inbox-threads.js` 의 `_talkThreads({ scope:'all' })` 결과(30일 · 8초 캐시)를 받아 날짜로 걸러 세는 쪽이 판정을 한 곳에 두는 길. **추천 = 7일·30일 모두 `_talkThreads` 재사용**(30일 창이 그 함수의 DAYS 와 같음). 위 SQL 은 그 함수가 느려질 때의 대안.

상품문의(naver_qnas) · 고객문의(naver_inquiries) — 줄 하나가 대화 하나.

```sql
SELECT
  count(*) FILTER (WHERE (answered OR posted_at IS NOT NULL) AND posted_by = 'auto')                         AS bot,
  count(*) FILTER (WHERE (answered OR posted_at IS NOT NULL) AND COALESCE(posted_by,'') <> 'auto')            AS staff,
  count(*) FILTER (WHERE NOT answered AND posted_at IS NULL AND reviewed_at IS NULL)                          AS open,
  count(*) FILTER (WHERE NOT answered AND posted_at IS NULL AND reviewed_at IS NOT NULL)                      AS staff_seen
FROM naver_qnas WHERE collected_at > NOW() - make_interval(days => $1);
```

`staff_seen`([확인]만 한 것)은 staff 에 더한다. 표가 작아(수백 줄) 색인 불필요.

문자(sms_threads + sms_messages) — 기간 안에 손님 글이 온 대화. 색인 `sms_messages(event_at)`.

```sql
WITH act AS (
  SELECT DISTINCT thread_id FROM sms_messages
  WHERE direction = 'in' AND event_at > NOW() - make_interval(days => $1)
    AND COALESCE(bucket,'other') NOT IN ('otp','ad','carrier')
)
SELECT
  count(*) FILTER (WHERE t.status NOT IN ('closed','ignored') AND (t.staff_why IS NOT NULL OR t.draft_text IS NOT NULL)) AS open,
  count(*) FILTER (WHERE NOT (t.status NOT IN ('closed','ignored') AND (t.staff_why IS NOT NULL OR t.draft_text IS NOT NULL))
                     AND t.last_out_at >= t.last_in_at AND t.status = 'bot_replied')                                      AS bot,
  count(*) FILTER (WHERE NOT (t.status NOT IN ('closed','ignored') AND (t.staff_why IS NOT NULL OR t.draft_text IS NOT NULL))
                     AND NOT (t.last_out_at >= t.last_in_at AND t.status = 'bot_replied'))                                 AS staff
FROM sms_threads t JOIN act USING (thread_id)  -- 실제 칸 이름 = t.id
WHERE t.status <> 'ignored' AND t.phone_digits NOT LIKE '0999%';
```

- 문자 모듈 안 칸 이름(last_out_at·status 값)은 시공 때 `sms/index.js` 의 OPEN_SQL·HUMAN_SQL 을 그대로 가져다 쓴다(판정 한 곳). 문자 모듈이 내주는 함수 하나(`_statsSms(days)`)로 빼는 쪽 추천.
- 지금 문자는 초안 모드라 「봇이 답함」은 거의 0 = 정상.

materials: `SELECT count(*) …` 2개(시나리오 enabled·deleted_at IS NULL / 시기 지식 deleted_at IS NULL) + 오늘 적용 수(서버의 기존 seasonScenariosToday 길이 또는 start_md·end_md 비교).

### 1-2. POST /api/agent-office/response-preview

```json
{ "channel": "talk" | "qna" | "inquiry" | "sms", "text": "사이즈 지정 되나요", "item": "제주 노지 감귤 타이벡 하우스" }
```

- `text` 1~1,000자 · `item` 선택(100자).
- 하는 일 = 생성만. 게시·발송·DB 기록 0(상한 셈 한 칸 빼고).

| channel | 서버가 부르는 것 |
|---|---|
| talk | 톡톡봇 `POST {TALK_BOT_URL}/preview` 대리 호출(Bearer SCENARIO_API_TOKEN · 타임아웃 65초) — 진짜 톡톡 자동 답 |
| qna | `qnaGenerate(text, item)`(채널 인자 없음 = 상품문의 지시문) |
| inquiry | 고객문의 생성 길(server.js 9736 근처 생성 함수 — 상품문의와 지시문이 다르면 그쪽 · 같으면 qnaGenerate) |
| sms | `qnaGenerate(text, null, undefined, 'sms')` + `sms/ai-note.js parse`([사람] 줄 = 넘김) · 주문 조회·규칙 답은 안 탐(「글 하나에 AI 가 뭐라고 하나」만) |

- 응답(답함)

```json
{ "ok": true, "channel": "talk", "skip": false, "answer": "…", "source": "ai",
  "scenario_nos": ["16"], "scenario_names": ["사이즈 지정(감귤·만감류 전용)"],
  "ms": 8200, "left_today": 99, "cap": 100 }
```

- 응답(봇이 넘김): `{ "ok": true, "skip": true, "why": "no_material" | "auto_reply_off" | "ai_error" | "to_staff", "why_text": "…", "ms": …, "left_today": … }`
- 막힘: 400(글 없음·김·채널 틀림) · 429 `{ code:"day_cap" | "busy" }` · 502(톡톡봇이 안 받음 — 봇의 4xx/5xx 글을 그대로 옮기지 말고 「톡톡봇 미리보기를 못 불렀어요」) · 504(시간 넘김).
- 쓴 재료: talk = 봇이 준 `scenario_nos` 그대로 · 그 밖 = qnaGenerate 의 `used`(이름 배열)를 번호로 바꿔(시나리오 표 조회) `scenario_nos`·`scenario_names` 둘 다.
- 상한: 하루(KST) 회사 전체 100번(대표 확정 11/11 · 설정 `agent_office_config 'response_preview' { daily_cap }` · 0 = 상한 없음) · 톡톡 초안 상한과 같은 「셈과 늘리기 한 문장」 꼴(inbox-threads.js 266~269). 같은 사용자 동시 1건. 톡톡봇 쪽 상한(분당 6·하루 100)과 별개 — 봇 429 가 오면 그대로 429(회사 100번을 전부 톡톡으로 쓰면 두 상한이 같은 때 참 · 봇은 재시작하면 0부터).
- audit 안 남김(읽기 성격 · 하루 수십 번). 대신 설정 state 칸에 오늘 횟수만.

확인 거리

- 회사 서버 env `SCENARIO_API_TOKEN` 은 있음(톡톡봇이 회사 서버 /api/scenarios 를 부를 때·회사 서버가 톡톡봇 /send 를 부를 때 같은 값). **톡톡봇 주소를 회사 서버가 어디서 읽는지**(`desk-inbox.js` 의 deliver 가 쓰는 값)는 시공 때 그 줄을 그대로 재사용.
- 톡톡봇 `/preview` 는 아직 미배포(미커밋 · 총괄이 이 화면과 함께 푸시). 봇이 옛 판이면 404 → 서버는 502 + 「톡톡봇이 아직 미리보기를 지원하지 않아요」.

---

## 2. 화면(app.js · index.html = 워커3 몫)

디자인 읽기: 사내 관리 화면(직원 5~6명 · PC 와 폴드7) · 기존 인디고 가이드 그대로 · 새 색·그림자 없음. 변화폭 낮음 / 움직임 낮음(말풍선 나타남 150ms 정도) / 밀도 중간.

쓰는 기존 부품: `settlement-tab` · `card` · `pill` · `ui-switch` · `inq-subtab-bar`(채널·기간 알약) · `form-input` · 문자 창 말풍선 꼴(`.sms-msg` 류는 ao-desk.css 전용이라 그대로 못 씀 → 같은 모양을 styles.css 에 `.rv-` 접두로 작게 새로 · 색은 토큰만 → gen-dark 재실행).

### 2-1. 마크업 뼈대

```
#inquiry-tab-btn-overview  (탭 단추 · 맨 앞 · 기본 활성)
#inquiry-tab-overview
  .rv-grid
    .rv-left
      #rv-settings      사용 설정(#1110-2 의 #inquiry-mat-head 안 줄을 이리로 옮김 — id 그대로: inquiry-auto-reply-wrap · inq-set-qna · inq-set-userinq)
                        + 보기만 2개: 문자 = 초안 모드 · 톡톡 = 하루 1번(09시)
      #rv-stats         기간 알약 [7일][30일] · 채널 알약 [전체][톡톡][상품문의][고객문의][문자]
                        숫자 카드 3개: 봇이 답함 n% (n건) / 직원이 답함 n% (n건) / 아직 안 답함 n건(누르면 손님 연락 미처리로)
      #rv-chips         미리 물어보기 칩 8개
      #rv-materials     연결된 재료: 늘 쓰는 글 63 › · 기간 있는 글 42(오늘 12) ›  (누르면 답변 재료 탭 그 칸)
    .rv-right
      #rv-chat          채널 알약(미리보기 대상) · 말풍선 목록 · 입력 칸 + [물어보기]
                        답 말풍선 아래: 「쓴 재료: 시나리오 16 ›」 링크 · 넘김이면 호박 띠 「봇이 답하지 않고 넘겨요 → 직원 몫」
                        맨 아래 작은 글: 「오늘 남은 미리보기 99번 · 실제로 보내거나 기록하지 않아요」
```

### 2-2. 상태

| 상태 | 화면 |
|---|---|
| 처음 | 오른쪽 빈 안내 「손님이 물어볼 만한 질문을 넣어 보세요」 + 칩 강조 |
| 만드는 중 | 손님 말풍선 바로 표시 · 봇 자리 「답 만드는 중…」(aria-busy) · 입력·칩 잠금 · 15초 넘으면 「조금 더 걸리고 있어요」 |
| 답함 | 봇 말풍선 + 쓴 재료 링크 + 걸린 시간 작은 글 |
| 넘김 | 호박 띠(why_text) · no_material 이면 [답변 재료에서 글 추가하기] |
| 오류 | 붉은 띠 + [다시 물어보기] · 429 day_cap = 「오늘 미리보기를 다 썼어요」 |
| 숫자 0건 | 「최근 7일 손님 글이 없어요」 |
| 숫자 실패 | 카드 자리 「숫자를 못 읽었어요 · 다시 읽기」(미리보기는 계속 됨) |

대화는 화면 메모리에만(새로 고치면 비움 · 최근 10쌍). 채널을 바꾸면 대화는 남기고 다음 질문부터 새 채널.

### 2-3. 폭별 배치

- 1280: 두 칸(왼쪽 420 고정 · 오른쪽 나머지) · 오른쪽 채팅 높이 = 화면 높이에 맞춤(안에서만 스크롤)
- 900: 두 칸(왼쪽 360) · 숫자 카드 3개 세로
- 390: 한 칸 — 사용 설정 → 숫자 카드(가로 3칸 작게) → 칩(가로 밀기) → 채팅(입력 칸은 아래 붙음 · 44px) · 「연결된 재료」는 채팅 아래

닿는 크기 44px(칩·알약·[물어보기]) · 초점 테두리 · Enter = 보내기 · Shift+Enter = 줄바꿈.

### 2-4. 칩 8개(고정 · 화면 상수)

1. 사이즈 지정 되나요?
2. 주소 바꿔 주세요
3. 오늘 주문하면 언제 받아요?
4. 귤이 물러서 왔어요
5. 체험 예약은 어떻게 해요?
6. 5kg 얼마예요?
7. 보관은 어떻게 해요?
8. 선물 포장 되나요?

누르면 입력 칸에 넣고 바로 물어봄(상한 1번 씀). 문구는 대표가 바꾸고 싶으면 설정 칸으로 옮길 수 있게 배열 하나로.

### 2-5. 「쓴 재료」 → 고치기

- `scenario_nos` 마다 링크 「시나리오 16」 → 기존 `gotoScenario(id)`(번호 → id 는 기존 `scenNoMap()`).
- 고치고 돌아오면(탭 다시 누름) 대화가 남아 있어 같은 칩·질문을 다시 눌러 비교. 톡톡은 봇 캐시 최대 5분 → 답 아래 「톡톡은 고친 뒤 최대 5분 뒤 반영」 한 줄(채널 talk 일 때만).
- 시기 지식은 번호가 안 온다(엔진이 안 내줌) → 링크 없음. 「기간 있는 글 12개가 오늘 적용 중 ›」 고정 링크로 대신.

### 2-6. #1110-2 와의 정리

- 사용 설정 줄을 `#inquiry-mat-head` 에서 이 탭 `#rv-settings` 로 옮김(id 유지 · 한 곳만). 답변 재료 탭 머리에는 세그먼트·찾기만 남는다.
- `inqMatHeadLoad()` 가 지금 부르는 목록 GET 2번(/naver/qnas · /naver/inquiries)을 없애고 `response-stats` 의 `settings` 로 채운다. 답변 재료 탭으로 바로 들어와도(복원) 숫자 API 한 번만.
- 기본 탭을 응대 현황으로. 옛 복원값(scenario 등)은 그대로 존중.
- 「아직 안 답함 n」 카드 → `window.AkmAoDesk.openInbox(...)` 또는 에이전트 오피스 손님 연락 미처리로 이동(없으면 숨김).

---

## 3. 검증 계획(가짜 서버 scripts/_mock-1110.js 에 주소 2개 추가)

가짜 자료는 갈래를 다 열게 한 벌로(정상 1건만 넣지 않는다).

- 숫자: 채널 4개 값이 서로 다르게 · 0건 채널 1개 · 30일 값은 다르게 · 실패(500) 1회
- 미리보기: 답함(재료 1개) · 답함(재료 2개) · 가격 즉답 · 넘김 3종 · 429 day_cap · 429 busy · 502 · 느린 응답(3초) · 1,000자 넘음
- 계정: 대표(스위치 3개 · 저장 왕복) · 직원(상태만 · 미리보기 됨) · 세무사(메뉴 없음)
- 폭 390·900·1280: 넘침 0 · 44px · 탭 6개 한 줄(390 은 가로 밀기 허용 여부 확인)
- 흐름: 칩 → 답 → 「시나리오 16」 → 편집 카드 열림 → 탭 복귀 → 대화 남음
- 무회귀: verify-1110-ui 기존 361 그대로 + 옛 판과 견줘 새 콘솔 오류 0 · 문의 관리 진입 때 /naver/qnas·/naver/inquiries 호출 0번(네트워크 기록으로)
- 서버(워커1): 숫자 쿼리 = 손님 연락 창 미처리 수와 open 이 같은지 실DB 1회 대조 · 미리보기 = qnaGenerate 를 가짜로 끼워 게시·발송·INSERT 0 확인 · 상한 동시 2요청

---

## 4. 위험·모르는 것

- **비용**: 미리보기 1번 = AI 1번(콘솔 과금 · 상품문의 재현 시험과 같은 크기). 하루 100번 상한(대표 확정)이면 월 최대 3,000번. 칩을 습관처럼 누르면 금방 참 → 남은 횟수를 늘 보여 준다.
- **톡톡 미리보기와 실제의 차이**: 30초 묶음·사진 📸 줄 생략·쿨다운·하루 1번 침묵은 미리보기에 없음. 「이 글 하나에 봇이 뭐라고 하나」만. 화면에 한 줄로 밝힌다.
- **문자 미리보기**: 실제 문자는 규칙 답(주문 조회)·클레임 고정 글이 먼저다. 미리보기는 AI 글만 → 「주문 조회가 필요한 물음은 실제와 다를 수 있어요」 한 줄.
- **숫자 뜻**: 「봇이 답함」이 「맞게 답함」은 아니다. 카드 아래 작은 글로 「봇 답 뒤 직원이 다시 답한 대화는 직원이 답함으로 세요」.
- **톡톡 숫자 속도**: `_talkThreads` 는 30일 통째 읽기(지금 240~330ms · 8초 캐시). 숫자 API 30초 캐시와 겹치면 부담 작음. message_logs 가 5만 줄을 넘으면 1-1 의 SQL 로 바꾼다.
- 모름: 고객문의 생성 함수가 상품문의와 같은 것인지(server.js 9736 근처 확인 필요) · 회사 서버가 톡톡봇 주소를 읽는 자리 · 탭 6개가 390 폭에서 한 줄에 들어가는지(안 되면 탭 줄 가로 밀기) · 대표가 칩 문구를 직접 바꾸길 원하는지.

## 5. 시공 순서(「고」 뒤)

1. 톡톡봇 `/preview` + 끊김 처리 푸시(총괄 · 이미 만들어 둠)
2. server.js 2주소(워커1) — 이 문서 1절
3. 화면(워커3) — 가짜 서버로 먼저 만들고, 2 가 붙으면 실서버 읽기 전용 기동 1회
4. 교차 점검 1회 → 배포 → 대표 폰·PC 확인(칩 → 답 → 재료 고치기 한 바퀴)

## 6. 같이 넣을 화면 메모 — #1111-B 알림 종 「🟥 확인 필요」(총괄 11/11)

- 알림 종 목록에서 level 이 `alert` 인 알림(제목 머리 「🟥 확인 필요」)을 **빨강 띠 + 맨 위 고정**으로 보인다.
- 서버(워커1) = 알림에 level 칸을 실어 줌(GET /api/notifications · /history 응답에 `level`). 화면(app.js = 워커3) = 목록을 그릴 때 alert 먼저(그 안은 최신순) → 나머지 종전 순서 · 띠 색은 기존 위험색 토큰(새 색 없음 · 야간은 gen-dark 재실행) · 읽음 처리·누르면 이동(notiGo)은 종전 그대로.
- 정할 것(시공 때 확인): 읽은 alert 도 맨 위에 둘지(추천 = 안 읽은 것만 고정) · 안 읽음 숫자 배지 색 · level 칸이 없는 옛 서버·옛 알림 = 종전 모양(무회귀).
- 검증 = 가짜 알림 한 벌(alert 안 읽음·alert 읽음·보통 안 읽음·보통 읽음·level 없음) × 390·1280 · 종전 알림 목록과 순서·모양 비교.

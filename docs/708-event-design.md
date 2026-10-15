# #708 이벤트 관리 — 직원이 터미널 없이 처음부터 끝까지 여는 구도 (설계)

- 작성: 워커3(claude-b1 · Fable 5.1) · 2026-10-15 · 읽기+문서만(코드·DB 쓰기 0)
- 근거: `docs/708-event-change-map.md`(워커2 조사) · `public/lucky.html` · `public/lucky-admin.html` · `lucky-event.js` · `server.js` 5926~5977(/guide 이벤트 카드) · `scripts/apply-449-event.js` · `디자인/디자인_가이드.md` · `rules.js`/`payslip.js`(메뉴 모듈·bytea 파일 라우트 꼴) · `★에이전트오피스/CLAUDE.md` 4-2(힉스필드) · `업무지식.md` 431·483행(3D 아꼼이 기준 8장 · 품목 실사진)
- 대표 결정(10/15 · 총괄 전달 · 그대로 반영): ①그림 두 길 = 직접 올리기 / 「AI로 그림 맡기기」 = 3D 아꼼이 기준 그림에 **품목만 바꿔 넣는 틀**(품목 고르기 + 한 줄 요청 · 창구가 image-to-image 로 후보 2~3장) ②기간 = **응모 기간**과 **페이지 내리는 날**을 따로(기본 = 발표일 + 3일 · 직원이 바꿀 수 있음) · /guide 카드·#59 도 내리는 날을 따름 ③추첨·발표·초기화·새 회차 = **직원 권한**(확인 창 1번) ④그림 = DB 저장 + 공개 GET(배포 없이) ⑤옛 추석 회차 복원 안 함(lucky_events 0행에서 새 회차부터) ⑥주소 = event.akkome.com 유지 + CNAME 을 회사 Render 로(대표 몫 · 절차문 워커2) → 설계는 「회사 서버 정본 · 옛 자료 없음」.

---

## 0. 총괄 구도와 달라지는 점(먼저 읽을 것 · 셋 다 권함)

| # | 총괄 구도 | 이 설계 | 왜 |
|---|---|---|---|
| ㄱ | 「한 번 저장 = 고객 페이지 + /guide 카드 + #59 세 곳 반영」 | **저장은 「초안」 · [이벤트 열기](또는 예약한 시작일 00:00)가 세 곳에 한 번에 반영** · 열기 전 손님 페이지는 「준비 중」 한 장 | 직원이 칸을 채우다 중간 저장한 상태(경품 반, 그림 없음)가 손님에게 그대로 노출되는 사고를 막는다. 저장은 마음껏, 노출은 한 단추. 열린 뒤 저장은 즉시 반영(종전과 같음). |
| ㄴ | 미리보기 = iframe `/lucky.html?preview=1` 이 **저장된 값**을 읽음 | 미리보기 iframe 에 **저장 전 초안을 postMessage 로 넘겨** 그 자리에서 그림(서버 왕복·토큰 0) + 「미리보기 링크 복사」(1시간 토큰 · 폰·카톡으로 다른 직원·대표에게) | 칸을 고치는 순간 오른쪽이 바뀌어야 「보이는 구도 편하게」가 된다. 저장 전 미리보기는 서버가 알 필요가 없다. |
| ㄷ | 경품 그림 = 매번 만들거나 올림 | **경품 그림 기본값 = `브랜드/` 품목 실사진 자동**(경품 이름에서 품목을 알아봄 · 황금향·레몬·하우스귤·유라조생) · 만들기는 원할 때만 | 창구 업무지식 483행 규칙(상품을 상상으로 그리면 실제와 달라 손님 불만)과 같은 선. 경품 3개 × 회차마다 그림 만드는 일이 사라진다. |

그 밖 총괄 구도(메뉴로 끌어들임 · 단계 카드 6개 · 완료/미완 · 두 길 그림 · 기간 자동 열림·닫힘 · 지난 회차 복사 · 권한)는 그대로.

---

## 1. 화면 구도

### 1-1. 자리
- 메뉴 「이벤트 관리」 = 새 탭(lucky-admin.html) → **회사프로그램 안 페이지**(`data-page="event"` · `#page-event`) · 인디고 가이드(theme.css 토큰만 · 야간은 gen-dark). 모듈 꼴 = `rules.js`/`public/rules.js` 와 같게 **`public/event-admin.js` + `public/event-admin.css`**(index.html 은 pane 1개 + script 1줄 · app.js 는 showPage 1줄 + 알림 링크 `event?step=3` 1줄).
- `lucky-admin.html` 은 한 버전 동안 메뉴에서 빼고 파일만 둠(주소 직접 치면 열림 · 다음 배포에 삭제).
- 폰(390) = 카드 세로 한 줄 · 카드 머리만 누르면 접힘/펼침 · 미리보기는 ⑤ 카드 안(폭 100%) · 단추 44px. 펼침(900) = **왼쪽 단계 카드 열(최대 560px) + 오른쪽 미리보기 고정(sticky · 폰 꼴 390px 틀)** — 문자 창 2단 꼴(대표 「너무 맘에 들어」)과 같은 리듬.

### 1-2. 머리띠(한 줄)
`[회차 이름] · 상태 배지(준비 중 / 예약됨 10/20 00:00 / 진행 중 / 발표 중 / 내려감) · 준비 ●●●●○○ 4/6 · [지난 회차 복사] [새 회차]`
- 상태 = 서버가 계산한 값(아래 2-3) · 배지 색 = 가이드 .pill(회색 준비 · 앰버 예약 · 초록 진행·발표 · 회색 내려감).

### 1-3. 단계 카드 6개(순서 고정 · 각 카드 머리 = 번호 · 제목 · 완료 ✓/미완 · 한 줄 요약)
| 단계 | 칸 | 완료 기준(✓) | 비고 |
|---|---|---|---|
| ① 기간·제목 | 회차 이름(관리용) · 손님 제목(화면 큰 글자 · 배너 그림 밖 글자) · 응모 기간 시작~끝(`akm-date`) · 발표일 · **페이지 내리는 날**(기본 발표일+3 · 바꿀 수 있음) · 응모 제외 품목 · 추첨 제외 연락처 | 제목·시작·끝·발표·내리는 날 전부 있음 · 시작 ≤ 끝 ≤ 발표 ≤ 내림 | 날짜 칸은 type=date 금지(가이드) |
| ② 경품 | 줄마다 등수(자동) · 이름 · 인원 · 설명 1~2줄 · 손글씨 한마디 · 그림(기본 = 품목 실사진 자동 · [바꾸기] = 올리기/맡기기) · [+ 경품 추가] [순서 바꾸기 ↑↓] | 경품 1개 이상 · 각 이름·인원 > 0 · 그림 있음 | 등수 수 제한 없음(지금 3장 고정 → N장) |
| ③ 상단 그림 | 배너 그림(권장 1200×350 · 가로형) · 발표 창 그림(900×471) · 결과 그림(소녀 · 선택 · 기본 지금 그림) · 각각 [직접 올리기] / [AI로 그림 맡기기] · 후보 띠(아꼼이가 만든 후보 n장 · [이 그림 쓰기]) | 배너·발표 그림 있음(기본 그림이면 미완 아님 · 「기본 그림 사용」 표시) | 그림 속 글자 금지 안내(제목은 ①에서 글자로 — 그림 글자 오타 함정 회피) |
| ④ 문구 | 경품 카드 손글씨 · 오른쪽 아래 손글씨 · 조회 카드 손글씨 · 발표 창 손글씨·아래 안내 · 대상 외 문장(「○○ 등 다른 상품 주문은 자동 접수」의 ○○) · 쿠폰 문구(봇 답에만) · **봇 답(#59) 미리보기**(자동 생성 글 · 고치기 가능 · 「다시 생성」) · **/guide 카드 미리보기**(제목·3줄·버튼 글 · 자동 생성 · 고치기 가능) | 기본값이 있어 비어도 ✓ · 쿠폰은 선택 | 기본값 = 지금 lucky.html 글자 그대로 |
| ⑤ 미리보기 | iframe `/lucky.html?preview=1`(postMessage 로 초안) · 폰/펼침 토글 · 「접수 전 / 접수 중 / 당첨 / 미당첨 / 발표 창」 상태 보기 단추 · [미리보기 링크 복사](1시간) | 한 번이라도 열어 봄(세션 기억) | 상태 보기 = iframe 에 가짜 결과를 그리게 하는 메시지(실조회 아님) |
| ⑥ 열기·운영 | [이벤트 열기 지금] / [시작일에 자동 열기 예약] · 열린 뒤: 송장 올리기(지금 📤 그대로) · 등록 현황 · [추첨] [발표 시작/숨기기] · 당첨자 표·복사·엑셀 · [페이지 내리기] · 「어디에 보이는지」 상태 3줄(손님 페이지 ✓ · /guide 카드 ✓ 기간 · 봇 답 #59 ✓) | 열림 | 열기 전엔 ①~③ 미완이면 단추 꺼짐 + 빠진 것 이름 표시 |

### 1-4. 「AI로 그림 맡기기」 칸(③·② 공용 · 작은 시트)
- 칸 = 자리(배너/발표/경품 n · 자동) · **품목 고르기**(브랜드/ 실사진 목록 = 고당도 하우스귤 · 그린레몬 · 노란레몬 · 유라조생 · 황금향(사진 있으면)) · **아꼼이 자세 고르기**(인사·귤들기·상자들기·기쁨·엄지척·안내 · 기본 = 자리별 추천: 배너 = 상자들기 · 발표 = 기쁨 · 경품 = 귤들기) · **한 줄 요청**(선택 · 예 「가을 느낌 · 노란 바탕」) · [맡기기].
- 누르면 = 에이전트 오피스 지시 1건이 만들어짐(4절) · 카드에 「아꼼이가 만드는 중 · 지시 #n」 → 끝나면 알림 종 + 후보 띠에 2~3장 → [이 그림 쓰기] → 브라우저가 줄여(webp) 올림. 하루 크레딧 상한(창구 4-2절 500)은 창구가 지킴 · 화면은 「오늘 n건 맡김」 표시만.

### 1-5. 디자인 읽기(design-taste Step 0)
- 읽기: 내부 운영 화면 · 직원 2~5명 · 「준비 보드」 언어 · 인디고 가이드 그대로(새 색 0). 다이얼 = 변주 3 · 모션 2(카드 접힘·단추 눌림만 · 150ms ease-out · 감소 모션 대응) · 밀도 5.
- 카드 = 가이드 14px · 머리 44px · 완료 ✓ = `--success` 점 · 미완 = `--text-light` 빈 원 · 지금 단계 = 왼쪽 3px 인디고 선 아님(측면 띠 금지) → 머리 글자 굵기 + 배경 `--primary-light` 로만.
- 손님 페이지(lucky.html)는 **색·꼴 무변경**(보라 #5447f4 · 손글씨) · 바뀌는 건 그림·글자가 설정에서 오는 것만(아래 6절 무회귀).

---

## 2. 자료 구조

### 2-1. `lucky_events.data.event` 확장(JSONB · ALTER 0 · 옛 꼴 그대로 읽힘)
```
event: {
  title, start, end, announce,                      // 종전
  prizes: [{ name, count,                           // 종전
             desc, note, image: {kind:'asset'|'brand'|'default', id|key} }],  // 추가 · 없으면 종전 DESC/NOTE/IMG 순서값
  published, drawnAt, excludeProducts,              // 종전
  page_until,          // 내리는 날(YYYY-MM-DD · 기본 announce+3)
  live_mode: 'draft' | 'scheduled' | 'live' | 'down',   // 직원 단추/예약 · 서버가 날짜로 보정(2-3)
  live_at,             // 열기 누른 시각 또는 예약 시작일 00:00 KST
  display_title,       // 손님 화면 큰 글자(비면 title)
  hero:  { image_id|null, alt },                    // 배너(없으면 img/lucky_hero_full.webp)
  winner_hero_image_id|null, result_image_id|null,  // 발표 창 · 결과(소녀)
  texts: { prize_head_hand, corner_hand, search_hand, winner_hand, winner_foot, noitem_products },  // 비면 지금 글자
  coupon_text,         // 봇 답(#59)에만 · 손님 페이지엔 안 나옴
  guide_card: { enabled, title, lines[3], btn, custom:false },   // 자동 생성 · 손으로 고치면 custom true(그 뒤 자동 갱신 안 함)
  bot_reply: { enabled, keywords[], response, custom:false },    // #59 본문 · 같은 규칙
  checklist: { ...서버가 계산 · 저장 안 함 }
}
```
- 회차 복사(`/copy-round`) = 위 event 전부 + 그림 참조(asset 은 round 와 무관한 표라 id 그대로) · orders/winners/excluded/uploads 는 빈 값 · live_mode 'draft' · 날짜 비움.

### 2-2. 새 표 `lucky_assets`(그림 · bytea)
| 칸 | 뜻 |
|---|---|
| id SERIAL | 공개 주소 열쇠 |
| round_id INT NULL | 올린 회차(참고용 · 복사하면 공유) |
| slot TEXT | hero · winner · result · prize |
| mime TEXT · bytes BYTEA · size INT · width INT · height INT · sha1 TEXT | 브라우저가 canvas 로 **webp 로 바꿔 올림**(배너 1200×350 · 발표 900×471 · 경품 480×480 · 결과 400 폭 · 상한 400KB/장) · 서버는 크기·mime(`image/webp`·`image/png`·`image/jpeg`만)·용량(1.5MB)만 검사 |
| source TEXT | upload · desk(창구 후보에서) · brand(실사진 복사) |
| created_by INT · created_at · purged_at TIMESTAMP NULL | 보관 정리(#579 db_retention 에 `event_asset_days` 추가 · 기본 730일 · 내려간 회차의 그림만 · bytes 비우고 행은 남김) |
- 공개 GET `/api/lucky/asset/:id`(sha1 를 주소 꼬리에 `?v=sha` · `Cache-Control: public, max-age=31536000, immutable`) · 없거나 purged → 404 → 손님 페이지는 기본 그림으로 떨어짐(onerror).
- 품목 실사진(`브랜드/`)은 저장소·대표 PC 파일이라 서버에 없음 → **첫 시공 때 `public/img/event-brand/` 로 webp 6장 복사(코드 배포 1회 · 그 뒤 품목 추가는 화면 「품목 사진 올리기」 = lucky_assets source brand)**. 또는 처음부터 lucky_assets 에 시드(배포 없이) — 둘 중 후자 권함(배포 뒤 총괄이 화면에서 6장 올리면 끝).

### 2-3. 공개 응답 `/api/lucky/event`(추가만 · 옛 칸 그대로)
- 추가: `display_title · page_until · state('preparing'|'live'|'published'|'down') · images:{hero, winner, result, prizes[]}(주소 또는 null) · texts · prizes[].desc/note` · `preview` 가 맞으면 draft 도 그대로.
- **state 계산(서버 한 곳 · KST 날짜 · 손님·카드·봇·화면이 전부 이 값)**: live_mode 'down' 또는 today > page_until → down · live_mode 'live' 또는 ('scheduled' 이고 today ≥ start) → live(published 면 'published') · 그 밖 → preparing.
- preparing → 손님 페이지는 「이벤트 준비 중이에요 🍊 곧 열립니다」 한 장(경품·조회 없음 · 조회 API 도 `{error:'PREPARING'}`) · down → 「이벤트가 끝났어요 · 당첨 안내는 순차 연락 · 구매는 네이버에서」 한 장(**조회는 내리는 날까지만** — 대표 ② 「종료 뒤에도 당첨 확인하러 옴」을 page_until 로 받음).

### 2-4. lucky.html 박힌 값 → 칸 대응(변경 지도 1-A 번호)
| 지도 # | 지금 | 칸 | 비면 |
|---|---|---|---|
| 1·2 | hero_full.webp · alt | hero.image_id · hero.alt(=display_title) | 지금 그림 |
| 3 | `<title>` | display_title 로 document.title | 지금 글 |
| 4 | #evTitle(sr) | display_title | title |
| 6 | 「제주의 좋은 마음을…」 | texts.prize_head_hand | 지금 글 |
| 8·9·10 | IMG/DESC/NOTE 3개 고정 | prizes[i].image/desc/note(N개) | i<3 이면 지금 값 · 그 밖 빈 값 |
| 12·13 | 손글씨 2곳 | texts.corner_hand · search_hand | 지금 글 |
| 14 | 소녀·귤 장식 | result_image_id(소녀만) | 지금 그림 |
| 15 | 「감귤·황금향 등 다른 상품…」 | texts.noitem_products | 「감귤·황금향 등」 |
| 17·18 | 발표 창 그림·손글씨·안내 | winner_hero_image_id · texts.winner_hand · winner_foot | 지금 값 |
| 20 | 색 | **바꾸지 않음**(대표가 정할 것 ⑧-3) | — |
| 21 | 쿠폰 | coupon_text(#59 만) | 없음 |

---

## 3. 서버 라우트·권한(`lucky-event.js` 안에서 · server.js 무접촉)
| 라우트 | 권한 | 내용 |
|---|---|---|
| POST `/api/agent-office/lucky/event` | 직원 | 종전 칸 + 2-1 새 칸(화이트리스트 · 길이: 손글씨 40 · 설명 120 · lines 각 120 · keywords 20개) · 저장 뒤 **state 가 live/published 면 동기화**(5절) · draft 면 동기화 안 함 |
| POST `/assets`(base64 또는 raw) · GET `/assets?round=` · DELETE `/assets/:id`(참조 중이면 거절) | 직원 | 2-2 · audit `lucky_asset_upload` |
| GET `/api/lucky/asset/:id` | 공개 | 2-2 캐시 헤더 · SPA 캐치올보다 앞(마운트 자리 그대로) |
| POST `/go-live {mode:'live'|'scheduled'|'down'}` | 직원 · **확인 창 1번(화면)** | 체크리스트(①~③) 미완이면 400 + 빠진 것 · live 로 바뀌는 순간 5절 동기화 1회 · audit |
| POST `/copy-round {from_id}` | 직원 · 확인 창 | 2-1 · 지금 회차가 live 면 거절(먼저 내리거나 새 회차) |
| POST `/new-round` · `/reset` · `/draw` · `/publish` | **직원**(대표 ③ · adminOnly 제거 · confirm 글자 'NEW'/'RESET' 는 화면이 확인 창으로 대신 보냄 — 서버 confirm 검사는 유지) | `/restore` 는 옛 자료 복원 안 하므로 **관리자 그대로**(남겨 둠) |
| GET `/preview-key` | 직원 | HMAC(JWT_SECRET, round_id+시각 1시간) → `/lucky.html?pk=…` · 공개 `/api/lucky/event?pk=` 가 맞으면 preparing 이어도 전부 줌(`preview:true`) |
| GET `/api/lucky/event` · `/lookup` · `/winners` | 공개 | 2-3 state 추가 · lookup 은 state preparing/down 이면 `{error:'PREPARING'|'CLOSED'}` 400 · 추첨·마스킹·점수 로직 **무변경** · `ipOf` 는 #693 과 같은 publicClientIp 로(별도 한 줄 · 선택) |
| 틱(1시간 1회 · lucky-event.js 안) | — | scheduled → start 지나면 live 로 적고 동기화 · page_until 지나면 down 으로 적고 #59 끄기 · 카드는 기간 칸으로 저절로 꺼짐 |
- 모든 쓰기 = withLock + audit(개인정보 없이) · 캐시 15초 그대로(저장 뒤 cache 갱신은 save() 가 이미 함).

---

## 4. 창구 길 「AI로 그림 맡기기」(DB 직접 쓰기 0 · withLock·캐시 엇갈림 0)
1. 화면 [맡기기] → **기존 `POST /api/agent-office/orders`**(pending_orders · 직원 가능)로 지시 1건. 내용 머리말 고정 꼴:
   `[이벤트그림] 회차 #<id> · 자리 <배너|발표|경품 n> · 품목 <이름> · 자세 <이름> · 크기 <1200x350> · 요청: <한 줄>` + 둘째 줄 「후보 2~3장을 첨부로 답해 주세요(글자 없는 그림 · 3D 아꼼이 기준)」.
2. 창구(★에이전트오피스) = 업무지식에 새 절 「이벤트 그림 만들기」: 머리말을 알아보면 **힉스필드 image-to-image**(`higgsfield generate create gpt_image_2_5 --image-references 아꼼이_3D_기준_전신.png,아꼼이_3D_자세_<자세>.png,브랜드/<품목>.jpg --aspect_ratio <자리별>`) · 프롬프트 틀 = 「같은 3D 아꼼이 캐릭터가 <품목> 상자/열매를 <자세> · 배경 단색·깨끗 · **글자 없음** · 가로 배너 구도」 · 후보 2~3장 → `respond.js attachments`(이미 있음 · 파일당 10MB · 5개) → **report_files** · 장부 한 줄(500 크레딧 상한 그대로).
3. 화면 = 그 지시의 `report_files` 를 **기존 내려받기 길**로 읽어 후보 띠에 띄움(지시 id 는 event JSON `pending_art:[{order_id, slot}]` 에 적어 둠) · [이 그림 쓰기] → 브라우저 canvas 줄이기 → `POST /assets`(source desk · 원 지시 번호 기록). 창구는 lucky 표에 손대지 않는다 → 잠금·캐시 무관.
4. 창구 CLAUDE.md 처리 선 표 「바로」 줄에 「이벤트 그림 후보(첨부로 답 · DB 쓰기 0)」 한 구절 · 금지 줄에 「lucky_events·lucky_assets 직접 쓰기」.

---

## 5. /guide 카드 · #59 동기화 규칙(한 곳에서 · 자동 소멸 · 광고성 선)
- **원천 = 이벤트 설정 1곳.** 저장·열기·틱에서 lucky-event.js 가 ⓐ `agent_office_config.guide_event_card` 를 **써 넣기만**(`guideEventCardHtml` 코드 무변경 · 값 = enabled=state live/published · title=display_title · lines = 자동 3줄(기간 · 경품 요약 「총 N명 추첨: 1등 …」 · 발표일+확인 방법) · btn 「접수·당첨 확인 바로가기」 · **url = env `EVENT_PUBLIC_URL`(기본 `https://event.akkome.com/lucky.html`)** · start · **end = page_until**) ⓑ `inquiry_scenarios` scenario_no 59 를 upsert(이름 「이벤트 안내(자동)」 · keywords 기본 = apply-449 KW · response = 자동 본문(기간·응모 자동·경품·쿠폰 문구(있으면)·발표일·확인 방법·링크) · enabled = state live/published · updated_by 「이벤트 관리」).
- 손으로 고친 값은 지킨다: 화면 ④에서 카드/봇 글을 직접 고치면 `custom:true` → 그 뒤 자동 갱신은 enabled 만 바꾸고 글은 안 덮음(「자동으로 되돌리기」 단추). 문의 관리에서 #59 를 직접 고치면 다음 저장 때 덮일 수 있음 → ④ 카드에 「봇 답은 여기가 정본 · 문의 관리에서 고치면 덮입니다」 한 줄.
- 날짜 자동 소멸: 카드는 start/end 로 /guide 가 스스로 안 그림(종전) · #59 는 틱이 page_until 다음 날 끔 · 손님 페이지는 state down.
- **광고성 선**: 알림톡 템플릿·버튼·변수 무접촉(메모리 jeju-alimtalk-event-exposure) · /guide 카드 글엔 할인·쿠폰·%·원 글자를 **넣지 않음**(검사 1줄 · 넣으면 저장 때 경고) · 쿠폰 문구는 #59(톡톡·상품문의 · 손님이 먼저 물은 답)에만 · 카드 url 은 https 만(종전 검사 그대로).

---

## 6. 무회귀 경계
- 알림톡 템플릿·kakao-notify 무접촉 · `guideEventCardHtml`·`/guide` 코드 무접촉(설정 값만 씀).
- lucky 공개 API 의 추첨(draw)·조회(lookup)·마스킹·orderId·custKey 로직 무변경(글자 비교 검증) · 관리 API 응답 꼴 `{ok, db}` 유지.
- **lucky.html 은 설정에 새 칸이 하나도 없으면 지금과 같은 화면**(기본값 = 지금 박힌 그림·글자) · 검증 = 설정 비운 상태로 렌더한 DOM 글자·img src 가 종전과 동일 · 단 state 가 preparing 인 회차(=새 회차 직후)는 「준비 중」 장이 뜨는 것이 **의도된 변화**(0행 = 기본 DEFAULT 는 live 로 보정해 종전과 같게 — lucky_events 0행이면 종전 그대로 · 첫 새 회차부터 state 가 먹음).
- `lucky_events` 옛 회차(지금 0행) · `data` 의 옛 칸 이름 전부 유지 · merge() 가 새 칸 기본값을 채움.
- 공개 응답은 칸 추가만 · 옛 lucky.html(캐시) 이 새 서버를 만나도 종전 칸만 읽어 정상.
- 메뉴 교체는 index.html 한 줄 + pane 하나 · 다른 메뉴 무접촉 · lucky-admin.html 파일은 한 버전 유지.
- 창구는 lucky 표에 쓰지 않음(4절) · 힉스필드 상한·장부 규칙 그대로.
- DB = 표 1개 추가(lucky_assets · 첫 요청 때 CREATE IF NOT EXISTS · #467 시드 사고 교훈대로 로컬 검증 서버는 다른 표 이름 `table` 인자) · db_retention 키 1개 추가(기본값 있음 · 꺼져 있으면 안 지움).

---

## 7. 시공 쪼개기(파일 겹침 0 · 순서 = A → C → B 를 한 배포로)
| 몫 | 파일 | 할 일 | 검증(이름) |
|---|---|---|---|
| **A 서버(워커 하나)** | `lucky-event.js`(만) | 2-1 새 칸 저장 · 2-2 lucky_assets + 공개 GET · 2-3 state·preview-key · 3절 라우트·권한(adminOnly 제거 3곳 · restore 유지) · 틱 · 5절 동기화(guide_event_card 쓰기 · #59 upsert) · EVENT_PUBLIC_URL | `scripts/verify-708-server.js`(가짜 표 이름 · 포트 3463 · 저장→state→공개 응답 · preparing 때 lookup 400 · 열기 때 guide_event_card/#59 값 · 틱 날짜 경계 · asset 올리기·캐시 헤더·purged 404 · 권한 직원 OK · 종전 draw/lookup 결과 바이트 동일) · 기존 lucky 검증이 있으면 그대로 통과 |
| **C 손님 페이지 + 창구 문서(워커 하나)** | `public/lucky.html` · `★에이전트오피스/CLAUDE.md` · `업무지식.md` | 2-4 설정 읽기(비면 종전) · state 3장(준비 중·끝남·정상) · `?preview=1` postMessage 수신 + `?pk=` · 발표 창·결과 그림 교체 · onerror 기본 그림 · 창구 「이벤트 그림 만들기」 절 + 처리 선 표 | `scripts/verify-708-page.js`(Playwright · 설정 비움 = 종전 DOM 동일 · 새 칸 = 그 값 · 390/560 · 콘솔 오류 0 · preview postMessage 렌더) |
| **B 화면(워커 하나 · index.html·app.js 편집권)** | `public/event-admin.js` · `public/event-admin.css` · `public/index.html`(메뉴 1줄·pane·script) · `public/app.js`(showPage 1줄 · 알림 링크 1줄) · `gen-dark` 재실행 | 1절 보드 전부 · 그림 줄이기(canvas→webp) · 후보 띠(report_files) · 맡기기 지시 생성 · 확인 창(새 회차·초기화·열기·내리기) | `scripts/verify-708-ui.js`(Playwright · 가짜 서버 · 390·900 · 6카드 완료/미완 · 열기 단추 잠김→풀림 · 그림 올리기 → 미리보기 반영 · 44px · 콘솔 0 · 다른 메뉴 14개 스모크) |
| **총괄** | version · 캐시 · CHANGELOG · 배포 · 배포 뒤 실DB 운영 = lucky_assets 에 품목 실사진 6장 올리기(화면) · env EVENT_PUBLIC_URL · db_retention 키 · 종전 `guide_event_card` 행은 그대로(첫 열기 때 덮임) | — | 라이브 = 새 회차 만들어 preview 로 확인 · 대표 폰 |
| **대표** | CNAME event.akkome.com → 회사 Render + Render 사용자 도메인(절차문 워커2) | — | `https://event.akkome.com/lucky.html` 이 회사 서버 응답 |
- 교차 점검 = 배포 직전 1회(메모리 feedback-final-check-once) · Playwright 는 한 번에 하나.
- 크기 가늠: A 1.5일 · C 1일 · B 2일(보드·미리보기·그림) · 문서 0.5일.

---

## 8. 대표가 정할 것
1. 손님 페이지 **색**(지금 보라 그대로 vs 회차마다 고르기) — 설계는 그대로(그림과 색이 같이 바뀌어야 어울려 위험).
2. 「준비 중」·「끝났어요」 장의 글자와 **끝났을 때 구매 링크**(네이버 감귤 페이지 하나? /guide 처럼 품목별?).
3. 그림 보관 기간(기본 2년 · 내려간 회차 그림만 바이트 비움) · 그림 상한(장당 400KB · 회차당 20장).
4. 미리보기 링크(1시간 토큰)를 **대표 폰·카톡 공유 허용**할지(손님이 열면 그대로 보임 · 토큰 만료 뒤 404).
5. 쿠폰 문구를 **#59 봇 답에만** 두는 것(설계) vs 손님 페이지에도.
6. 새 회차·초기화 확인 창 = 글자 입력(NEW/RESET 유지) vs 단순 [확인] (설계 = 단순 확인 + 되돌릴 수 없음 문구 · 서버 confirm 은 화면이 보냄).
7. 발주컴퓨터 계정(user · 공용)도 추첨·발표 단추를 볼지(설계 = 직원 전부 = 예).
8. 메뉴 이름 「이벤트 관리」 유지 여부 · lucky-admin.html 삭제 시점(다음 배포).
9. 후보 그림이 하루 500 크레딧 상한에 걸릴 때 화면 안내만 하고 다음 날로 넘기는 것(설계) vs 대표 승인으로 넘기기.

---

## 9. 안 본 것·가정
- Playwright 실행 0 · 실DB 쓰기 0 · bum-toolbox 저장소 소스 없음(워커2 와 같음) · 브랜드 폴더에 **황금향 실사진 없음**(고당도 하우스귤·그린레몬·노란레몬·유라조생만 — 경품이 황금향이면 대표 사진 1장 필요) · 힉스필드 image-to-image 가 「같은 캐릭터 + 다른 품목」을 안정적으로 내는지는 창구 시험 1회로 확인(총괄 9/29 기준 8장 때 7가지 대조 통과 기록은 있음) · `report_files` 내려받기 라우트가 그림 mime 을 그대로 주는지(C 가 확인) · Render 사용자 도메인 추가 시 `/` 가 회사 로그인 화면이 되는 문제 = 회사 서버에 「Host 가 event.akkome.com 이면 /lucky.html 로」 한 줄(A 몫 · server.js 가 아니라 lucky-event.js 마운트 안 app.use 로).

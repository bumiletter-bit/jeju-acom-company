# #711 이벤트 관리 2차 손질 — 화면·페이지·서버 계약 (워커3 · 2026-10-15)

> 대상 = 대표 지적 7가지 (a)~(g) + 「더 쉽게」. 이 문서가 세 쪽(워커1 event-admin.js · 워커2 lucky.html · 워커3 lucky-event.js)의 약속이다. 응답 꼴 정본은 종전처럼 `docs/708-api.md`, 이 문서는 #711 에서 **더해지는 것만** 적는다.
> **총괄 제안과 달라진 점(첫 줄)**: ①미리보기 「상태 강제」는 새 `force` 칸을 만들지 않고 **이미 lucky.html·event-admin.js 에 들어 있는 `scene` 하나로** 간다(같은 뜻의 길이 둘 생기면 어긋남) — 장 이름만 못 박음. ②봇 답 미리보기는 **서버 `POST …/bot-preview`**(화면 autoBot 사본 제거) — 지금 화면 사본은 서버 글과 이미 다르다(이모지·🎟 쿠폰 줄·📞 꼬리 없음 → 저장하면 다른 글이 #59 로 나감). ③제외 품목 칩 저장값 = **묶음 대표 낱말 1개 또는 판매현황 이름 그대로**(종전 `excludeProducts` 글자 배열 · 서버 대조 로직 무변경).

## 0. 실자료로 확인한 사실(계약의 근거)
- 주문 글 `o.product` = 송장 엑셀 열 **「옵션정보」(없으면 상품명·단품명)** 원문 120자(event-admin.js 731행 · lucky-event.js 435행). 네이버 옵션정보 꼴 = `아꼼이네 상품선택: 고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)` → **판매현황(bot_products) 이름은 이 글의 뒷부분과 글자가 같다**(`고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)` = 211행). 운영 lucky_events 는 지금 1행(draft · 주문 0)이라 실주문 표본은 없음 — 종전 추석 회차는 복원 안 함(대표).
- 제외 판정 `exProdOf` = `excludeProducts.some(k => product.includes(k))` — **부분 글자 포함**. 바꾸지 않는다(무회귀 · 종전 회차 저장값 `['청귤']` 그대로 먹음).
- 판매현황 85행(삭제 포함) · 삭제 안 된 것 39행 · 상태 = 판매중 26 · 시즌종료 11 · 품절 2 · 준비중 2(554·555). 품목 사진(slot brand) 26장 라벨 = 하우스감귤·황금향·그린레몬·노란레몬·노지감귤·청귤·미니밤호박·레드키위·타이벡감귤·한라봉·꼬마한라봉·레드향·천혜향·카라향·탐라향·하귤·산하홍·수라향·블러드오렌지·세미놀·자몽·청견오렌지·초당옥수수·브로콜리·고깔양배추·노지황금향.
- 미리보기 통로(708-api 4절)는 이미 `scene = default|received|win|lose|noitem|outside|winners|preparing|closed` 를 받아 그린다. (a)「결과 그림이 안 바뀜」= 결과 그림(result)은 **조회 결과 장(received·win·lose·noitem·outside)에만** 쓰이는데 미리보기가 `default` 장에 머물러 있어 보이지 않았던 것이 유력(발표 창 그림 = winner 슬롯 · 다른 자리). 확정은 워커2가 lucky.html 에서 밝힌다 — 그림 주소가 postMessage 에 안 실린 길인지도 같이.

## 1. 미리보기 = 「손님 화면 미리보기」 한 칸 (g)·(a)
- 통로 그대로: `iframe /lucky.html?preview=1` ← `postMessage({type:'lucky:preview', event, counts, scene})` → `{type:'lucky:rendered', scene}`. **새 칸 없음.**
- 장(scene) 이름 ↔ 탭 글자(화면이 쓰는 라벨 · 손님 말):

| scene | 탭 글자 | 보이는 것 | 이 장으로 자동 전환되는 입력 |
|---|---|---|---|
| `preparing` | 준비 중 | 준비 중 한 장(texts.preparing_*) | texts.preparing_title · preparing_line |
| `default` | 접수 중 | 본 화면(상단 그림·경품·조회 칸) | hero · prize 그림·이름·desc·note · title/display_title · 기간 · prize_head_hand · corner_hand · search_hand |
| `default` + `event.published=true` | 발표 뒤 첫 화면 | 「당첨자 발표 완료」 띠 + [명단 보기] 단추 | (탭으로만) |
| `received` | 접수 확인 | 조회 결과 「✅ 접수되었습니다」 + 결과 그림 | (탭으로만) |
| `win` | 당첨 | 「🎊 축하합니다」 + 결과 그림 + 1등 경품 | **result 그림** |
| `lose` | 미당첨 | 「아쉽지만 다음 기회에」 + 결과 그림 | (탭으로만) |
| `noitem` | 대상 아님 | 「이 상품은 이벤트 대상이 아니에요」 + 제외 품목 + noitem_products 문장 | excludeProducts · texts.noitem_products |
| `outside` | 기간 밖 | 「이벤트 기간 밖 주문이에요」 | (탭으로만) |
| `winners` | 발표 창 | 당첨자 명단 창(가짜 이름 2명/경품) + 발표 그림 | **winner 그림** · winner_hand · winner_foot |
| `closed` | 끝남 | 끝난 장(texts.closed_*) + 스토어 단추 | texts.closed_title · closed_line · store_btn |

- 가짜 조회 결과는 lucky.html 안 표본(홍*동 · 010-****-1234 · 1등 경품)으로 그린다 · **서버 호출 0** · `event.excludeProducts[0]` 을 제외 품목 글자로 쓴다.
- 화면(워커1): ⑤ 카드 제목 「손님 화면 미리보기」 · 탭 10개(위 순서) · 그림을 올리거나 칸을 치면 **표의 「자동 전환」 열대로 `scene` 을 바꿔 다시 보냄**(이미 `VIEW_FOR` 로 들어 있음 — `result → win` · `winner → winners` 유지) · 직원이 탭을 손으로 고른 뒤 1분 안엔 자동 전환이 탭을 빼앗지 않게(권장 · 선택).
- 페이지(워커2): ① `scene` 받는 쪽 무변경 확인 ② (a) 원인 확정 · 결과 그림이 `images.result` 로 오면 다섯 결과 장 모두에서 바뀌는지 ③ `scene:'default'` + `published:true` 가 띠를 그리되 **실 `/api/lucky/winners` 호출을 하지 않게**(지금 `if(e.published&&!PREVIEW) openWinners` 라 안 부름 — 그대로) ④ 미리보기 안 단추([명단 보기]·[스토어 가기])는 눌러도 밖으로 안 나가게(target 또는 preventDefault · 선택).

## 2. 응모 제외 품목 = 칩 + 판매현황에서 고르기 (b)
### 2-1. 서버 `GET /api/agent-office/lucky/products` (직원 · 읽기만)
```json
{ "ok": true, "groups": [
  { "name": "황금향", "words": ["황금향"], "selling": true,
    "options": [ { "name": "과즙팡팡 황금향 / 상품 및 과수: 황금향 가정용 - 3kg(중소과 17과 전후)", "status": "판매중" }, … ] },
  { "name": "하우스감귤", "words": ["하우스감귤","하우스귤","하우스"], "selling": true, "options": [ … ] },
  { "name": "청귤", "words": ["청귤","풋귤"], "selling": false, "options": [ { "name": "최상품 청귤(풋귤) 5kg", "status": "시즌종료" } ] },
  { "name": "고구마", "words": ["고구마"], "selling": false, "options": [] }
] }
```
- 원본 = `bot_products` **deleted_at IS NULL · 전 상태**(판매중·시즌종료·품절·준비중 — 지난 시즌 품목도 제외 대상이 될 수 있어 전부). 쓰기 0 · 30초 기억(품목이 바뀌면 30초 안에 반영).
- 묶음 규칙 = **#709 낱말 묶음과 같은 표** `ITEM_GROUPS`(서버에 사본 · 아래 3절) 로 이름을 묶음에 넣고, 어느 묶음에도 안 들면 **그 이름의 품목 머리**(`과수 및 크기:`·`아꼼이네 상품선택:` 머리말 떼고 ` / ` 앞 · 무게 이하 떼기)로 묶음을 하나 만든다. `name` = 묶음 대표 낱말(표의 첫 낱말) · `words` = 그 묶음 낱말 전부(화면 검색용) · `selling` = 판매중 옵션이 하나라도 있음 · `options` = 그 묶음의 판매현황 이름 전부(상태 포함 · 이름 가나다). 묶음 순서 = selling 먼저 · 그 안은 가나다.
- 응답에 개인정보·금액 없음. 시험 품목(`[검증]`·`테스트` 머리)은 뺀다.

### 2-2. 칩 저장값(종전 꼴 호환 · 서버 대조 무변경)
- `excludeProducts` 는 종전처럼 **글자 배열**. 칩 종류 셋:
  - **묶음 칩** = `group.name` 한 낱말(예 `황금향`) → 주문 글에 그 낱말이 들면 전부 제외(하우스황금향·노지황금향 포함 — 제외의 뜻으론 맞음).
  - **옵션 칩** = `option.name` 그대로(예 `고당도 하우스감귤 / 상품 및 과수: 가정용 - 2.5kg(로얄과)`) → 네이버 옵션정보 원문에 글자 그대로 들어 있어 그 옵션만 제외. 🔵 쿠팡·자사몰 주문 글은 꼴이 달라 옵션 칩이 안 걸릴 수 있음 → 화면 안내 한 줄 「옵션 하나만 빼려면 네이버 주문에만 맞아요 · 품목 전체는 묶음을 고르세요」.
  - **직접 입력 칩** = 직원이 친 글자 그대로(종전 쉼표 입력과 같음 · 목록에 없는 글자도 됨).
- 화면: 묶음 낱말이 이미 칩에 있으면 그 묶음의 옵션은 고를 필요 없음(회색). 칩 ×  = 배열에서 뺌. 저장은 종전 `POST …/event {event:{excludeProducts:[…]}}` 그대로(서버 trim·빈 글 거름 유지).
- 손님 페이지 「대상 아님」 장은 `excludeProducts.join(', ')` 를 그대로 보여 주므로 **묶음 칩을 권장**(옵션 칩은 긴 글이 손님 화면에 그대로 뜸 — 화면이 미리보기 `noitem` 장으로 바로 보여 준다).

### 2-3. 추첨 제외 연락처 칩
- 저장 꼴 종전(`excluded: ['01012345678', …]` · 서버가 `digits()` 로 숫자만 · 숫자 없으면 이름 norm). 화면은 **숫자만 칩**(하이픈 자동 제거 · 10~11자리 아니면 빨간 칩 + 안내) · [+] 와 Enter 로 추가. 서버 무변경.

## 3. 낱말 묶음 표(서버 사본 · #709 와 같은 뜻 · 끝에 26장 라벨 품목 추가)
```
[청귤,풋귤] [황금향] [한라봉] [천혜향] [레드향] [레드키위,키위] [노란레몬] [그린레몬,레몬]
[노지감귤,노지,유라조생,유라] [하우스감귤,하우스귤,하우스]
+ [미니밤호박,밤호박,한입밤호박] [타이벡감귤,타이벡] [카라향] [탐라향] [하귤] [산하홍] [수라향] [블러드오렌지] [세미놀] [자몽] [청견오렌지] [초당옥수수,옥수수] [브로콜리] [고깔양배추,양배추]
```
- 앞 10개 순서는 #709 와 같아야 한다(「노지황금향」→ 황금향 · 「하우스황금향」→ 황금향 처럼 먼저 맞는 묶음이 이긴다). 맨 「귤·감귤」은 묶음 아님(#709 규칙 그대로). 🔵 화면 `ITEM_GROUPS` 와 서버 표가 둘이 되는 셈 — 다음 손질 후보 = 화면이 `/products` 의 `words` 를 받아 쓰기(이번엔 범위 밖 · 무회귀).

## 4. 봇 답·카드 미리보기 = 서버가 만든 글 (e)·(f)
### 4-1. `POST /api/agent-office/lucky/bot-preview` (직원 · 저장 0 · 동기화 0 · 감사 0)
- 몸 = `{ event: {…초안 칸…} }` — `/event` 저장과 **같은 칸·같은 화이트리스트**(display_title·title·start·end·announce·prizes·coupon_text·guide_card·bot_reply 등). 서버는 현재 회차 사본에 그 칸을 얹어(저장 안 함) 글을 만든다.
- 응답:
```json
{ "ok": true,
  "bot":  { "text": "안녕하세요 고객님 제주아꼼이네입니다 🍊\n…🎟 2,000원 할인 쿠폰…\n▶ https://event.akkome.com/lucky.html\n…", "custom": false, "keywords": ["이벤트","추첨",…] },
  "card": { "title": "🎁 가을 황금향 이벤트", "lines": ["10/20(월) ~ 10/31(금) 주문 고객 대상…", "총 12명 추첨: …", "당첨자 발표 11/1(토)…"], "btn": "접수·당첨 확인 바로가기", "dropped": [] , "custom": false },
  "state": "preparing" }
```
  - `bot.text` = `bot_reply.custom && response` 면 그 글, 아니면 서버 `autoBot`(쿠폰 줄 🎟 포함 · 공개 주소 env). `card` = 저장 때 `guide_event_card` 에 실제로 들어갈 값(**할인·쿠폰·금액 줄은 `dropped` 로 빼서 돌려줌** — 화면이 「이 줄은 카드에 안 실려요」로 보여 줌). `state` = 지금 회차 상태(참고).
  - 분당 60회/IP 상한(종전 limited) · 400 = 몸이 객체가 아님.
- 화면(워커1): 입력 **300ms 디바운스** 뒤 호출 · 응답 `bot.text` 를 「봇 답(톡톡·상품문의 #59)」 칸에(손으로 고친 글(custom)이면 서버가 그 글을 그대로 돌려주니 덮어도 같음) · 쿠폰 문구 칸 옆에 「봇 답의 🎟 줄로 들어가요 · 손님 페이지·알림톡 카드엔 안 나가요」 · 화면 `autoBot()` 사본은 지운다(서버 글 하나만).
### 4-2. 라벨을 사람 말로(화면 · 서버 무변경)
- 「○○ 등 다른 상품 주문은 자동 접수」 → 라벨 **「대상 아님 안내에 넣을 다른 상품 이름(예: 감귤·황금향 등)」** + 바로 아래 완성 문장(lucky.html 299행과 같은 글 · 이미 `noitemHtml`) + 미리보기 `noitem` 장 자동 전환.
- 「가이드 카드 미리보기」 → **「알림톡 단추 페이지(/guide) 맨 위 카드」** + 한 줄 「발송안내 알림톡의 [맛있게 드시는 법] 단추를 누르면 열리는 페이지 맨 위에 이 카드가 붙어요(할인·쿠폰·금액 글자는 자동으로 빠져요)」 · 카드 글은 4-1 의 `card` 로 그린다.
- 「쿠폰 문구(선택)」 → 「쿠폰 한 줄(봇 답에만)」.

## 5. 품목 사진 묶음 (c)·(d) — 화면만(서버 무변경)
- 검색 칸을 묶음 **맨 위** · `akm` 입력 꼴(디자인 가이드 · 둥근 칸 · 44px) · 안내 글 = **「경품 상품을 대표상품 참고하여 이미지 제작을 합니다.」**(대표 원문 그대로) · 목록은 **검색 글이 있을 때만**(빈 칸 = 목록 0 · 「품목 이름을 쳐 보세요 · 26장」 한 줄) · 올리기·바꾸기·지우기 단추는 검색 결과 줄에 · 경품 자동 매칭(#709 `brandFor`)은 그대로.
- 서버 `GET …/assets?slot=brand` 응답 무변경.

## 6. 무회귀 · 완료 기준
- 서버(워커3): 더하는 것 = `/products` · `/bot-preview` · `ITEM_GROUPS`(+ 검증용 `_itemGroups`·`products` 받이) 뿐. 공개 `GET /api/lucky/event`·lookup·winners·draw·동기화·틱·저장 화이트리스트 **바이트 동일**(verify-708-server ⑦ HEAD 비교 그대로). 검증 모드(`table` 인자)에선 `/products` 가 운영 `bot_products` 를 읽지 않도록 `products` 받이(가짜 행) 주입 가능 — 운영 표 쓰기 0.
- 화면(워커1): 저장 몸은 종전과 같은 칸(`excludeProducts` 글자 배열 · `excluded` 숫자 배열) · 옛 서버(`/products`·`/bot-preview` 404)면 칩 직접 입력만 + 봇 답 칸은 저장 뒤 서버 값으로(무너지지 않게).
- 페이지(워커2): 공개 응답 꼴·장 이름 무변경 · (a) 원인 보고.
- 검증: verify-708-server 종전 82 + `/products`(묶음·옵션·순서·시험 품목 거름·삭제 행 제외·30초 기억) + `/bot-preview`(저장 0 · 동기화 0 · 쿠폰 줄 · custom 글 · dropped) 항목. 미리보기 장 전환은 워커1 Playwright(verify-708-ui) 몫 · 페이지 장 그리기는 워커2 몫.

## 7. 실왕복용 로컬 서버(워커3이 띄움 · 10/15)
```
LUCKY_TABLE=lucky_events_vui JWT_SECRET=local711 PORT=3466 node -r ./scripts/ro-preload-711.js server.js
```
- `scripts/ro-preload-711.js` = pg Client.query 를 감싸 SELECT 류만 통과 · 쓰기는 LUCKY_TABLE(+_assets) 글자가 든 문장만 · 그 밖(initDB ALTER · 기동 복구 UPDATE · audit INSERT · 타이머)은 빈 결과로 삼키고 로그 · setInterval 0. 운영 표 이름을 LUCKY_TABLE 에 넣으면 시작 전에 멈춤.
- 토큰 = `jwt.sign({id,username,name,role}, 'local711')` 를 localStorage jwt_token 에. 끝나면 서버 PID 종료 → `DROP TABLE lucky_events_vui_assets, lucky_events_vui`.

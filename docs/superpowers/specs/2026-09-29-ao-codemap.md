# 에이전트 오피스 코드 지도 — API 마루 → 클코 창구 전환(#469) 사전 조사

> 작성: 2026-09-29 · 워커 세션(claude-38) · **읽기 전용 조사**(코드·DB·러너·git 무접촉). 총괄(claude-7d) 배정 W1.
> 🔴 **행 번호 기준 = git 커밋 `ed8cb87`(v5.9.364) 시점의 파일**(server.js 14,913줄 · public/app.js 14,088줄 · public/index.html 2,338줄). 조사 중 총괄이 server.js에 미커밋 편집(#469 desk 엔진: 804·1225행 근처 +3줄, `processOrderWithMaru` 끝(13072) 뒤 +188줄 `aoEngine`·`deskIntake`·`deskOcrTick`·`/desk-status`·`/desk/orders`·`/orders/:id/approve|reject`·`/desk/board`)을 진행 중 → **현 작업본에서는 804행 이후 +3, 13075행 이후 약 +191 어긋남**. 함수명을 1차 키로, 행 번호는 `grep -n`으로 재확인해서 쓸 것.
> 표기: 「미확인」 = 본문을 직접 읽지 않았거나 판단 근거가 부족한 것(추측 배제).

---

## 0. 한 줄 결론 (전환 설계에 바로 쓰는 것)

1. **AI(Anthropic) 호출은 단일 관문 `maruDecide`(server.js 11087)를 지나간다.** 예외 = 확인 응답 3종(정산 확인표 "응"·거래처 답변·일정/정산현황 확인)과 정산 이미지 OCR. 확인 응답 3종은 **이미 AI 없이** 돈다.
2. **정산 이미지는 「판독(AI)」과 「대조·확인표·저장(코드)」이 이미 분리**돼 있다. 판독값 `[{name, qty}]`·partner·date만 주면 **`settlementOcrBuildConfirm`(12559)** 부터 종전 코드 그대로 확인표가 나오고, 저장은 `POST /settlement-ocr-save`(13140)·`maruTrySettlementOcrConfirm`(12592)이 AI 없이 settlements INSERT까지 간다. 창구(클코)가 이미지를 읽고 판독값만 올리면 나머지는 재사용.
3. **손님 응대(qnaGenerate·inquiryGenerate·/api/scenarios·shop-chat)는 마루 코드와 함수 단위 공유가 없다.** 공유하는 것 = `require('@anthropic-ai/sdk')`(server.js 8) · 텔레그램/알림 스위치 · `agent_office_config` 테이블 · 범용 헬퍼(writeAudit·naverCfgGet/Set·kstTodayStr) 4가지. 마루 정화기(`maruCleanText` 등)는 손님 경로에서 호출 0.
4. 🔴 **삭제 함정 3개**: ⓐ `/api/agent-office/*` 접두어 라우트 대다수는 에이전트와 무관(시나리오·판매현황·휴무일·알림 이력·3채널 주문·룰렛) — 접두어 단위 삭제 금지 ⓑ `kstTodayStr`(11889)은 마루 블록 안에 정의됐지만 정산 대조·라우트가 쓴다 — 블록 통삭 시 이동 필수 ⓒ app.js `ao*` 접두 함수 중 5600~6150(`aoLoadInvoicePricing`·`aoItemPartner`·`aoMatchToPricing`·`aoProgressBarTicker` 등)은 송장변환 v2가 잘라 쓰는 코드 — 접두어로 지우면 v2가 죽는다(#463 표식 4개).
5. 프론트는 **처리 주체가 '마루'라는 이름 문자열에 묶여 있다**(`aoAgentElByName('마루')` 10784 등 리터럴 40여 곳). 이름·라벨만 바꾸면 말풍선이 조용히 실패한다 — chief(`role==='chief'`)로 찾거나 상수화 필요.

---

## 1. `POST /api/agent-office/orders` → `processOrderWithMaru` 전체 흐름

### 1-1. 라우트 한 줄 요약 (server.js)

| 라우트 | 행 | 권한 | 동작 | AI |
|---|---|---|---|---|
| `POST /api/agent-office/orders` | 13073 | 직원 가능 | content(≤500자)·image_data(≤14MB) 검사 → `pending_orders` INSERT(13084) → `writeAudit` → **`processOrderWithMaru(row, actor)` 비동기 호출(13093 · await 없음)** → 즉시 응답 | 아래 본체 |
| `POST /orders/:id/close` | 13098 | 직원 | status='질문'만 → `'질문종결'` + audit | 없음 |
| `POST /orders/:id/process` | 13114 | admin | status ∈ {'대기','오류'} 재실행(13123 비동기) | 본체 |
| `GET /orders/:id` | 13129 | 직원 | 1건 SELECT(프론트 폴링) | 없음 |
| `POST /settlement-ocr-save` | 13140 | admin | 확인표 → settlements 저장(§3) | 없음 |
| `POST /orders/:id/ack-error` | 13170 | 직원 | '오류' → `'오류확인'` + audit | 없음 |
| `GET /orders` | 13187 | 직원 | pending_orders LEFT JOIN agent_runs(limit≤200 · include_hidden). 기본 필터 status ∈ ('대기','처리중','오류','질문') 또는 run 연결분(13193) | 없음 |

### 1-2. `processOrderWithMaru(order, actor, opts)` — 12633~13072 (조기 `return` 사슬)

| 순서 | 분기 | 담당 함수 · 행 | AI | result.type / status |
|---|---|---|---|---|
| ① | `status='처리중'` UPDATE | 12635 | — | — |
| ② | 거래처 답변("효돈이야" 등) → 보관 품목으로 확인표 재생성 | `maruTrySettlementPartnerReply` 12528 → `settlementOcrBuildConfirm` 12541 | **없음** | `settlement_ocr_confirm` / '질문' |
| ③ | 정산 확인표 "응/아니오" | `maruTrySettlementOcrConfirm` 12592 (`MARU_YES_RE` 12209 · `MARU_NO_RE` 12210) | **없음** | 응 → `settlement_saved_ocr` / '완료' · 아니오 → `route`(notice) / '안내' + 대기 질문 '취소' |
| ④ | 일정·정산현황·조회 확인 "응/아니오" | `maruTryScheduleConfirm` 12212 (pending type ∈ `schedule_confirm`·`settlement_confirm`·`query_confirm`) | **없음** (단 `query_confirm` 승인 → `dispatchLiveAgent` 12247 → 요원 AI 가능) | `schedule_created`(12256) · `settlement_saved`(12201 — `maruExecuteSettlementSave` 12161 · **settlement_status 테이블** = 정산현황 자금) · `confirm_cancelled`(12231~12234) |
| ⑤ | 이미지 + `/정산\|등록\|올려\|발송\s*목록\|입력/` → 정산 OCR | `maruSettlementOcr` 12495~12497 (호출 12645~12647) | **있음** — `settleOcrRead` 12479 → `settleOcrReadOnce` 12436(tool) → 폴백 `settleOcrPlainRead` 12459(평문) | `settlement_ocr_confirm` / '질문' 또는 `error` / '오류' |
| ⑥ | clarify 결합(직전 `clarify` 질문이 있으면 원지시+질문+답변 결합) | `buildCombinedOrderText` 11020 · `buildFollowUpText` 11028 · `buildMultiFollowUpText` 11037 (12652~12699) | — | — |
| ⑦ | 나머지 미응답 질문 `'대체됨'` 종결 + audit | 12700~12713 | — | — |
| ⑧ | **마루 판단** | `maruDecide(effContent, maruImage)` **11087** · 호출 12723 | **있음** — `anthropic.messages.create` **11102**(tool `route_order` = `MARU_ROUTE_TOOL` 10614 · max_tokens 4000 · 오염/필수필드 누락 시 1회 재호출 11132) | `d.action` ∈ route·clarify·feedback·schedule·settlement_input·multi·answer(enum 10622~10632) |
| ⑨ | 재무 즉답 보정(clarify → 세미 route 강제) | `maruForceFinanceRoute` 11062~11065 (12726) | — | — |
| ⑩ | `maru_route` audit | 12752 | — | — |
| ⑪ | `multi` — subtasks 복원(12761~12781) → 각 서브태스크 `pending_orders` INSERT(12794) → `processOrderWithMaru(sub, actor, {noMulti, multiSeq})` 재귀(12805) | 12784~12813 | 재귀 안에서 ⑧ 재호출 | `multi_dispatch` / '완료' · 부적합 → `clarify`(12809~12817) |
| ⑫ | `answer` — 마루 직접 답변 | 12816~12840 | **조건부** — `answer_text` 비었을 때만 `maruPlainAnswer` **10996**(create 10999) | `answer` / '완료' |
| ⑬ | `clarify` — 되묻기(choices·root_content 동봉) | 12831~12862 | — | `clarify` / '질문' |
| ⑭ | `feedback` — agent_feedback INSERT + 교훈 추출 + 재작업 | 12852~12915 | **있음(비동기·await 없음)** `extractLessonFromFeedback` **10848**(create 10863) · 재작업 `dispatchLiveAgent` 12896 → 요원 AI | `feedback` / '피드백' 또는 대상 불명 `clarify`(12857) |
| ⑮ | `schedule` — 일정 조회/등록 | `maruHandleSchedule` **11984** (12907~12920) | **없음** (`svcListSchedules` · `maruRegisterScheduleItems` 11965 → `svcCreateSchedule` 4975) | `schedule_list`(12009) · `schedule_confirm`(12091) · `schedule_created`(12083) · `schedule_blocked`(12098) · `vacation_redirect`(12056) · `maru_schedule`(12007) · `clarify` |
| ⑯ | `settlement_input` — 정산현황(자금) 입력 | 서버 가드(12914~12941 — 품목·수량이면 「정산관리 화면에서 직접」 안내 12921) → `maruHandleSettlementInput` **12133** | **없음** | `settlement_confirm`(12155) / '질문' → "응" 시 ④에서 `settlement_saved` |
| ⑰ | `route` — 세미 전용 조건 확정(날짜·기간·비교·순위·거래처·주차 파싱 12948~13035 · `date-utils.js`) → 오래된 기간이면 `query_confirm`(13048~13049) → `dispatchLiveAgent` **12264**(13057) | — | 요원 실행 `executeAgentTestRun` **6709** → `runner.result()` **6725** → **agents/*.js 안에서 AI**(§5) | `route` / '완료'(run_id) 또는 '안내'(미연결 요원 12290~12291 · 실행 중 충돌 12303) · `invalid_date`(13022~13023) |
| ⑱ | catch | 13061~13071 | — | `error` / '오류' |

### 1-3. Anthropic 호출 지점 — 지시 경로 (server.js)

| 경로 | 함수 · 행 (`new Anthropic` / `messages.create`) | 모델 | 호출자 |
|---|---|---|---|
| 마루 판단(모든 일반 지시) | `maruDecide` 11087 (11091 / 11102 · 재시도 11132) | `MARU_MODEL` 10610~10611(env · 기본 `claude-haiku-4-5` · sonnet-4-6→sonnet-5 매핑) | 12723 · `executeSmokeTest` 11297 · `executeCapabilityTest` 11430·11586 |
| answer 폴백 | `maruPlainAnswer` 10996 (10997 / 10999) | MARU_MODEL | 12820 |
| 정산 OCR 도구 경로 | `settleOcrReadOnce` 12436 (12437 / 12438) | MARU_MODEL | `settleOcrRead` 12480 · probe 러너 14320~14339 |
| 정산 OCR 평문 폴백 | `settleOcrPlainRead` 12459 (12460 / 12461) | MARU_MODEL | `settleOcrRead` 12486 · probe 14338 |
| feedback 교훈 추출 | `extractLessonFromFeedback` 10848 (10857 / 10863) | 미확인(본문 미열람) | `POST /feedback` 10464 · `backfillLessonsFromFeedback` 10890(부팅 14889) · 12878 |
| 요원 실행(route·feedback 재작업·query_confirm 승인·multi 재귀 전부 수렴) | `dispatchLiveAgent` 12264 → `executeAgentTestRun` 6709 → `runner.result()` **6725** | 각 `*_MODEL`(기본 `claude-sonnet-5`) | agents/*.js(§5-a) |

**AI 없이 도는 지점(재사용 후보)**: `maruTrySettlementPartnerReply` 12528 · `maruTrySettlementOcrConfirm` 12592 · `maruTryScheduleConfirm` 12212 · `maruHandleSchedule` 11984 · `maruHandleSettlementInput` 12133 · `maruExecuteSettlementSave` 12161 · `settlementCalcForPartner` 12548 · `settlementOcrBuildConfirm` 12559 · `maruForceFinanceRoute` 11062 · 조건 파싱 12948~13035 · `agents/세미.js`(DB 집계·xlsx) · `agents/한수.js`(검산 코드) · `agents/미래.js` `result()`(106 · 0원 코드).

참고: `agents/한결.js` `reviewContent`(62 · create 85)·`agents/미래.js` `reviewContent`(44 · create 66)는 export만 되고 **server.js에서 호출 0**(6733 주석 「지시 #54 AI 검수 게이트 제거」 · 미래.js 84·102 「보관만」). 한결 `live:false`(110).

---

## 2. 정산 이미지 — 판독 → 대조 → 확인표 (입력/출력 형식)

| 함수 · 행 | 입력 | 출력 |
|---|---|---|
| `settleOcrReadOnce(mime, b64, maxTokens)` 12436 | mime · 순수 base64 · max_tokens | `{ raw: {partner, items:[{name, qty}]} \| null, stop, usage }` (`SETTLE_OCR_TOOL` 12411 스키마) |
| `settleOcrPlainRead(mime, b64)` 12459 | 동일 | 동일 형식 또는 `null`(JSON 파싱 실패) |
| `settleOcrNormalizeItems(raw)` 12451 | raw | `[{name: string(trim), qty: number>0}]` |
| `settleOcrRead(mime, b64)` 12479 | 동일 | `{ att, readItems:[{name,qty}], path:'tool'\|'plain' }` — 잘림·0건·오염(`/antml\|<\s*\/?\s*parameter/`) 시 평문 폴백(#396) |
| `maruSettlementOcr(order, actor)` 12495 | `order.image_data`(data URL) · `order.image_mime` · `order.content` | agent_runs INSERT(12499) → `settleOcrRead` → `partnerHint = normalizePartnerName(order.content) \|\| normalizePartnerName(raw.partner)`(12515) · `settleDate = parseSettlementDate(order.content, kstTodayStr())`(12516) → `settlementOcrBuildConfirm(order, partnerHint, readItems, run.id, settleDate)`(12518) · 실패 → '오류'(12522~12523) |
| `normalizePartnerName(raw)` 12353 | 문자열 | `'효돈농협' \| '대성(시온)' \| '기타거래처' \| null` |
| `parseSettlementDate(text, todayStr)` 12362 | 지시문 · 오늘(YYYY-MM-DD) | `'YYYY-MM-DD'`(내일/어제/YYYY-MM-DD/M월D일/M/D/D일 · 없으면 오늘) |
| `buildPriceMapFor(partner, dateStr)` 12397 | 거래처 · 날짜 | `{ [품목명]: price }` — pricing에서 날짜 포함 최신 1건 |
| `matchSettlementItemExact(imgName, priceMap)` 12385 | 이미지 품목명 · priceMap | `{name, price} \| null` — 공백·`·` 제거 후 **긴 이름부터 substring 포함** 대조(정산관리 `GET /api/settlements` 3745 · `total-unpaid` 4061과 공유) |
| `settlementCalcForPartner(partner, readItems, dateStr)` 12548 | 거래처 · `[{name,qty}]` · 날짜 | `{ rows:[{name, matched, qty, price, subtotal}], total, matched, unmatched:[name], existing:{id, amount}\|null, catalog:[{name, price}] }` |
| **`settlementOcrBuildConfirm(order, partnerHint, readItems, runId, settleDate)` 12559** | `order`(id만 사용) · partnerHint(null 가능) · `readItems:[{name,qty}]` · runId(null 가능) · settleDate(null이면 오늘) | `SETTLE_PARTNERS`(12546) 3곳 전부 계산 → `candidates[partner] = {box_total, rows, total, matched, unmatched, existing, catalog}` · partner = 힌트 우선, 없으면 최다 매칭 → `maruFinishOrder(order.id, '질문', { type:'settlement_ocr_confirm', order_id, partner, date, candidates, box_total, auto_detected, rows, total, unmatched, existing, question, summary }, runId)`(12579) · runId 있으면 agent_runs done(12586~12587) |

**★ 「판독값만 주면 AI 없이 확인표」 재사용 지점 = `settlementOcrBuildConfirm`(12559).** 이미 AI 없는 경로 `maruTrySettlementPartnerReply`(12541)가 `runId=null`로 이 함수를 그대로 쓰고 있다. 필요 인자 = `{id}`를 가진 order 객체 · `normalizePartnerName`을 거친 partner(또는 null) · `[{name, qty}]` · null · `'YYYY-MM-DD'`(또는 null). 프론트 확인표(`aoShowSettlementConfirm` app.js 9818)는 `r.candidates[partner].{rows,unmatched,total,existing,catalog}` · `r.order_id` · `r.auto_detected` · `r.box_total` 스키마에 의존 — 이 출력 그대로면 프론트 무변경.

---

## 3. 확인표 저장 → settlements INSERT · 박스 차감 · audit

settlements에 INSERT하는 곳은 **3곳**, 서로 저장 함수를 공유하지 않고 각자 SQL을 실행한다.

| 경로 | 행 | 흐름 |
|---|---|---|
| **(A)** 화면 [✅ 저장하기] `POST /api/agent-office/settlement-ocr-save` | 13140 | body `{order_id, partner, date, rows?}` → pending_orders.result.type=`settlement_ocr_confirm` 검증(13145) → `candidates[partner]`(13146) → rows 있으면 우선(13149 — 수동 매칭) → items `{name: matched\|\|name, qty, price, subtotal}` → `DELETE FROM settlements WHERE partner AND date::text`(13153) → **`INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES (…, TRUE)`(13154)** → `writeAudit`(13156 · targetType 'settlement' · changes.after.via='image_ocr'·manual_match) → pending status='완료' + result.type=`settlement_saved_ocr` + saved_partner(13161~13162) → `notifyTelegram`(13164) |
| **(B)** 채팅 "응" `maruTrySettlementOcrConfirm` | 12592 | 1시간 내 `settlement_ocr_confirm` pending 1건(12600) → 최상위 `r.rows`(선택 거래처)로 items → DELETE 중복(12613) → **INSERT(12616)** → `writeAudit`(12619) → pending '응답됨'(12623) → `maruFinishOrder(order.id, '완료', {type:'settlement_saved_ocr', partner, date, total, box_total, overwrote, notice})`(12624~12625) → notifyTelegram(12629) |
| **(C)** 정산관리 화면 일반 저장 `POST /api/settlements` | 3850 | body `{date, partner, amount, items, fromPricing}` → **INSERT(3854)** — 중복 삭제·audit 없음(3858 주석 「[A안] 박스재고는 컬럼 차감 없이 표시 시점 재계산」) |

- **공유**: (A)(B)(C) 간 저장 함수 공유 없음. (A)(B)는 `writeAudit`(4948 → audit_logs INSERT 4951)·`notifyTelegram`만 공유. 계산 단계의 `matchSettlementItemExact`(12385)는 정산관리 조회와 공유.
- **박스 재고 차감은 INSERT 시점에 하지 않는다.** `applyBoxAdjustment`(3803)는 「[A안 폐기] 더 이상 호출되지 않음」(3799). 실제 차감 = 표시 시점 재계산 `computeBoxStocks`(3020)가 `SELECT date, items FROM settlements WHERE partner=$1`(3067)을 읽어 `getBoxTypeMapFor(partner, d)`(3784)의 boxType 매핑으로 `daesong`/`hyodon`을 뺌(3060~3081 · `GET /api/box-inventory` 3088). → 정산 items의 `name`이 그 날짜 pricing 품목명과 **정확 일치**해야 차감된다(A·B가 `matched` 이름을 우선 저장하는 이유 · #428-b·#464 사고 원인).
- 프론트: `aoSettleSaveOcr()`(app.js 9910~9928) — `r.candidates && r.order_id`면 (A) 호출(9919), 아니면(구버전 응답) `POST /orders {content:'응'}`(9922) → (B). 「✅ 네/✕ 아니오」 버튼 `aoQuickAnswer`(10046 · 10055)는 항상 `POST /orders {content:'네'|'아니오'}` → (B)/④.

---

## 4. 프론트 (public/app.js · public/index.html)

### 4-1. index.html 마크업 (블록 2233~2310 `#page-agent-office`)

| 항목 | 행 | 내용 |
|---|---|---|
| 사이드바 메뉴 | 112~115 | `.nav-item[data-page="agent-office"]` 「AGENT OFFICE」 |
| 상단바 | 2234~2235 | 제목 + `#app-version` |
| **법인/오션라운지 필터** | **2237~2241** | `#ao-biz-filter` · `.ao-biz-btn[data-biz]` 전체·법인·오션라운지 |
| 뷰 탭 | 2242~2245 | `.ao-view-tab[data-view]` 🏢 사무실(office) · 📁 보고서함(reports) |
| 성장 위젯 | 2248 | `#ao-growth-widget`(JS가 채움) |
| 사무실 뷰 | 2251~2265 | `#ao-office-view` > `#ao-office`(조직도 캔버스 2253) |
| LIVE 로그 카드 | 2255~2264 | `#ao-log-clear` 🧹(2257) · `#ao-log-showall`(2258) · `#ao-reminders`(2260) · `#ao-live-log`(2261) |
| 보고서함 뷰 | 2268~2298 | `#ao-report-team`(**팀 4종 하드코딩** 2272~2278: 마케팅팀·재무팀·법무팀·개발부서) · `#ao-report-agent` · `#ao-report-from/to`(akm-date) · `#ao-report-search` · `#ao-report-archived` · 표 헤더 9칸(2290) · `#ao-report-tbody` |
| **지시 입력 폼** | **2301~2309** | `#ao-order-bar` · 라벨 `.ao-order-label` = **「💬 마루에게 지시하기」**(2302) · `#ao-order-input`(maxlength 500 · placeholder 「마루에게 지시하세요 — 예: …」 2304) · `#ao-order-image`(image/* multiple · 숨김 2305) · `#ao-order-image-btn` 📷(2306) · **전송 버튼 `#ao-order-send` 「전송」**(2307) · `#ao-order-image-preview`(2309) |
| 피드백·레슨·도구·아카이브 | 마크업 없음 | 전부 JS 모달(`modal-overlay`) |

진입: `switchPage`가 `'agent-office'`면 `renderAgentOffice()`(app.js 356). 직원 개방(adminOnlyPages 미포함 197·292).

### 4-2. app.js 렌더 함수 (섹션 9688~12052)

**상태·진입**: `aoAgents/aoBiz/aoActiveRun/aoRunPollTimer/aoLogPollTimer/aoEventsBound` 9690~9695 · `AO_TEAMS` 9696~9701 · `AO_COLORS` 9702~9705(요원 code 10종) · `AO_ROLE_LABEL`/`AO_STATUS_LABEL` 9707/9708 · `aoPageActive()` 9710 · **`renderAgentOffice()` 9714**(aoBindEventsOnce → aoRefreshAgents → aoRefreshGrowth → aoRefreshLog → aoStartLogPolling) · **`aoBindEventsOnce()` 9722~9771**(법인 필터 9727~9734 · 뷰 탭 9736~9749 · LIVE 로그 클릭→`aoOpenReport` 9754 · **전송 click→`aoSendOrder` 9766 · Enter 9768**).

**지시 입력·전송·응답**

| 함수 | 행 | API |
|---|---|---|
| `aoSetupOrderImage` / `aoAddImageFiles` / `aoRenderImagePreview` / `aoClearOrderImage` | 9935 / 9959 / 9969 / 9978 | 파일·Ctrl+V · 10MB 제한 |
| **`aoSendOrder()`** | **9984~10016** | 이미지 장마다 `POST /orders {content∥'정산관리에 올려줘', image_data, image_mime}`(**9997**) / 텍스트 `POST /orders {content}`(**10003**) → `aoOrderLogLine` → `aoSay('대표')`·`aoSayThinking('마루')` → `aoPollOrder` |
| `aoOpenMaruQuestion` | 10019~10043 | 「🤔 마루의 질문」 모달(choices → `aoAnswerChoice` / ✅네·✕아니오 → `aoQuickAnswer`) |
| `aoQuickAnswer(yes)` | 10046~10061 | `POST /orders {content:'네'∥'아니오'}`(**10055**) |
| `aoAnswerChoice(text)` | 10063~10077 | `POST /orders {content}`(10072) |
| **`aoPollOrder(orderId)`** | **10082~10095** | 1.5초 × 40회 `GET /orders/:id`(10087) — `대기`/`처리중`이면 계속(10089) → `aoHandleOrderResult` |
| `aoShowMaruAnswer` | 10097 | 「💬 마루」 모달 |
| **`aoHandleOrderResult(order)`** | **10109~10172** | status × result.type 분기(4-3 ①) |
| `aoProcessOrder` | 10175 | `POST /orders/:id/process`(10177) |
| `aoLoadMaruOrders` | 10187~10202 | `GET /orders?limit=30`(10191) → 「📥 쌓인 지시」(`대기`/`오류` · 관리자 ▶ 처리) |
| `aoAckOrderError` / `aoCloseQuestion` | 10441 / 10450 | `POST /orders/:id/ack-error` / `/close` |

**조직도·애니메이션**: `aoRefreshAgents` 10204(`GET /agents` 10205) · **`aoRenderOffice` 10505~10541**(`#ao-inbox`·`aoCeoHtml`·「🏢 기획팀」 chief·`AO_TEAMS.map` · `visible = a => aoBiz==='전체' ∥ a.workplace===aoBiz ∥ '공통'` **10509**) · `aoCeoHtml` 10543(이름 폴백 '전승범' 10553) · `aoCharHtml` 10559(`st-${status}` · `onclick=openAoDetail`) · `aoSetAgentStatus` 10582 · **`aoRefreshOrgFlow` 10600~10633**(chief→요원 SVG polyline `.ao-flow-svg` · resize 10635) · `aoAgentElByName` **10640~10644**(이름 문자열로 DOM 검색) · `aoSay/aoClearSay/aoSayThinking` 10647/10658/10664 · `aoSetProgress/aoSetInboxBadge/aoFlyDoc` 10675/10683/10691 · `aoRunAgent` 10721(`POST /agents/:id/run {workplace: aoBiz}` 10724 — ⚠️ 호출 UI 없음 · `#ao-detail-run-btn` 참조만 잔존) · **`aoStartRunPolling` 10739~10764**(1초 `GET /runs/:id` 10744) · `aoHandleRunUpdate` 10766 · `aoAnimateStep` 10779~10837(`step.kind` order/route/assign/work/report/review/done).

**LIVE 로그·보고서함·성장·관리**: `aoRunPreviewLine` **10845~10862** · `aoAppendLiveLogHtml/aoAppendLiveLog` 10864/10873 · **`aoOrderLogLine(o)` 10918~10967**(4-3 ②) · **`aoRefreshLog` 10969~11020**(`GET /runs?limit=30` · `GET /orders?limit=15` · `GET /today-reminders` 10974~10976 · 미응답 질문 → `aoSay('마루','❓ 확인해주세요!')` 11017~11019) · `aoStartLogPolling` 11025(8초) · `aoRefreshAgentsStatusOnly` 11035 · `aoRefreshGrowth` 10220(admin · `GET /growth`+`/misroute-stats` 10229~10230) · `aoOpenManageMenu` 10242 · `aoOpenArchiveModal/aoDownloadArchive` 10274/10297(`/archive`) · `aoMediaBlobUrl/aoLoadThumb/aoPreviewImage` 10318/10328/10333(`/files/:id/download`) · `aoGenerateMedia/aoPollMediaGen` 10351/10363(`POST /runs/:id/generate` — 미소) · `aoTelegramTest` 10402 · `aoOpenMisrouteModal/aoOpenTestResultsModal` 10459/10480 · **`openAoDetail` 11066~11142**(`GET /agents/:id` 11070 · `AO_TRAIT` 11049~11060 · `AO_LIVE_TOOLS` 11062~11064 · 마루면 `#ao-maru-orders`) · 피드백/레슨 모달 11169~11304 · `aoArchiveRun/aoClearLog/aoRestoreRun` 11308/11317/11333 · `aoRunCapabilityTest` 11343 · `aoSendFeedback/aoMarkFail/aoMarkOrderFail` 11387/11417/11428 · **`aoLoadReports` 11461~11511**(`GET /runs?limit=100&team&agent_id&from&to&include_archived` 11474) · **`aoOpenReport(runId)` 11514~12052**(`GET /runs/:id` 11517 · `aoReviewBlock` 11524~11536 기본 reviewer **'한결'** 11526 · `aoAuditBlock` 11538~11545 「🧮 한수 검산」).

### 4-3. result.type별 렌더 분기 (3곳)

**① `aoHandleOrderResult`(10109~10172) — 폴링 결과 도착 시**

| status + type | 행 | 렌더 |
|---|---|---|
| 질문 + `settlement_ocr_confirm` | 10114~10118 | `aoShowSettlementConfirm(r)`(열려 있으면 `aoSettleQueue` 큐잉) |
| 질문 (그 외 = clarify) | 10119~10122 | 말풍선 🤔 question 9초 + 토스트 |
| 완료 + `answer` | 10123~10127 | `aoShowMaruAnswer` |
| 완료 + `settlement_saved_ocr` | 10128~10130 | ✅ 정산관리 저장 완료(N박스·원) |
| 완료 + `schedule_list` / `schedule_created` / `schedule_cancelled` | 10131 / 10136 / 10139 | 📅 / ✅ / ℹ️ |
| 완료 + `settlement_saved` / `settlement_cancelled` | 10142 / 10145 | ✅ / ℹ️ |
| 완료 (그 외 = route) | 10148~10157 | 「📋 team assignee 배정 → 실행!」 → `r.run_id`·assignee 이름으로 요원 매칭 → `aoActiveRun`·`running`·`aoStartRunPolling` |
| 피드백 / 안내 / 오류 | 10158 / 10163 / 10166 | 말풍선 / ℹ️ notice / ⚠️ + 토스트 |

**② `aoOrderLogLine`(10918~10967) — LIVE 로그 서브줄**: 피드백 10925 · schedule_* 10926~10928 · settlement_saved/cancelled 10929~10930 · `multi_dispatch` 10931 · `answer` 10932 · **`settlement_ocr_confirm` 10933**(`aoSettleCache[o.id]=r` + [확인표 열기] → `aoOpenSettleCache`) · `settlement_saved_ocr` 10934 · **`settlement_ocr_need_partner` 10935**(텍스트만 — 전용 버튼 없음·입력바 답변) · r.question + (질문/응답됨/대체됨/질문종결) 10936~10948(선택지 또는 ✅네/✕아니오) · `route`+assignee 10949~10953 · 안내/오류 10954~10955([✔ 확인] → `aoAckOrderError`). 상태 뱃지 클래스 10920~10922 · 종결 배지 10958~10959 · 버튼 노출 10960~10964 · 「→ 마루:」 10966.

**③ `aoOpenReport`(11546~12028) — agent_runs `result.report.type`**: `!rep` 11546 · `no_data` 11550 · `geulsaem_copy` 11553 · `capability_test` 11575 · `semi_day` 11614 · `semi_status` 11660 · `maru_settlement` 11695 · `maru_schedule` 11703 · `miso_prompt` 11711 · `semi_compare` 11768 · `semi_rank` 11804 · `gian_plan` 11829 · `yeri_analysis`/`yeri_insta` 11847/11854 · `jiyul_labor` 11863 · `semi_partner_week` 11874 · `semi_price_history` 11902 · `semi_settlement_filtered`/`semi_settlement` 11921/11949 · 폴백 lines 12026. 헤더 버튼 12037~12040(✔ 확인 = status done만 / ❌ 실패 / 📎 엑셀).

### 4-4. 정산 확인표 UI

`AO_SETTLE_PARTNERS` 9779 · `aoSettleBodyHtml` 9785 · **`aoShowSettlementConfirm(r)` 9818~9848**(거래처 select(candidates 있을 때) · 날짜 · `#ao-settle-save` 「✅ 저장하기」/existing이면 「🔁 덮어쓰기 저장」 9898~9903) · `aoSettleChangePartner` 9849 · `aoSettlePickItem`/`aoSettleApplyPick` 9856/9878(수동 매칭 — `aoSettleModalData` 메모리) · `aoSettleChangeDate` 9894 · **`aoSettleSaveOcr()` 9910~9928**(§3) · `aoSettleCloseModal`/`aoSettleShowNextInQueue` 9904/9929.

### 4-5. 하드코딩 지점(제거 시 함께)

| 구분 | 위치 |
|---|---|
| 팀 4종 | app.js 9696~9701 `AO_TEAMS` · 10515(「🏢 기획팀」)·10519 · index.html 2272~2278 |
| 요원 code→색 | app.js 9702~9705 `AO_COLORS`(maru·hangyeol·miso·geulsaem·yeri·hansu·semi·jiyul·mirae·gian) · 10560·11077 |
| 요원 특징·도구 | `AO_TRAIT` 11049~11060 · `AO_LIVE_TOOLS` 11062~11064(miso Gemini/Veo) · 11093·11106 |
| 검수·검산 이름 | 11526 '한결' · 11540 「🧮 한수 검산」 |
| 정산 거래처 | 9779 `AO_SETTLE_PARTNERS` · 10935 문구 |
| **'마루' 리터럴** | index.html 2302·2304 / app.js 9954·10001·10007·10018·10036·10044·10051·10057·10067·10074·10103·10111·10121~10169·10178·10181·10195·10245·10469~10470·10492·**10784**(`aoAgentElByName('마루')`)·10792·10796·10820·10917~10966·10947·11015~11019·11082~11088·11236·11271·11411·11427 — `aoAgentElByName`(10640)이 `aoAgents.find(a=>a.name===name)`이라 **이름이 바뀌면 말풍선 전부 조용히 무시** |
| chief 판정 | 10508·10608·10753·11065·11350(`a.role==='chief'`) |
| 대표 노드 | 10553~10554('전승범'/'대표' 폴백) · 10641 |
| 법인/오션라운지 | index.html 2237~2241 / app.js 9691 `aoBiz` · 9727~9734 · **10509** · **10724** · 11102 · 11055 · 11971·12005(`rep.workplace`) |
| 이미지 경로 | **없음**(스프라이트 = CSS div · 아바타 = 이름 첫 글자 11099 · `<img>`는 미소 생성물 10342·11738만) |
| 색 CSS | styles.css 3929~3943·3974·4005~4008·4105~4112·4125·4138·4161 / theme.css 258~261·307 |

### 4-6. status → 라벨/색 매핑

- **agents.status**: `AO_STATUS_LABEL` 9708(idle 대기·running 실행중·done 완료·error 오류) · `st-*` 클래스 10562·10582~10592 · styles 3974(`.ao-status-idle #888 / -running #E8590C / -done #2F9E44 / -error #E03131`) · theme 307.
- **agent_runs.status**: `aoRunPreviewLine` 10850~10857(done ✅ / 그 외 ❗ · donecard · ✔확인 = done∥error) · `aoRefreshLog` 10996~11003(running=마지막 step / done·error=미리보기) · `aoLoadReports` 11482~11484(done/err/run 뱃지 · styles 4005~4008 · theme 258~260) · `openAoDetail` 11130 · `aoOpenTestResultsModal` 10490 · `aoOpenReport` 12037 · 폴링 종료 `status !== 'running'` 10747.
- **pending_orders.status**: `aoOrderLogLine` 10920~10922(완료→done / 오류→err / 질문→ask / 안내·피드백·대체됨·질문종결·응답됨→info / 그 외(대기·처리중)→wait) · 종결 배지 10958~10959(대체됨/응답됨/질문종결) · 버튼 10960~10964 · styles 4105~4110 · theme 258~261 · 폴링 대기 = `대기`∥`처리중` 10089 · 쌓인 지시 = `대기`∥`오류` 10192·10197 · 미응답 질문 = `질문`+question+미답변 11017.

---

## 5. 삭제 후보 vs 유지 필수 (의존 관계)

### 5-a. agents/*.js 9종

로더 `loadAgentRunner(agentName)` server.js **6691~6697**(`require(path.join(__dirname,'agents', name+'.js'))` + `AGENT_DEFAULT_RUNNER` 6685). 호출 지점 전수: 6710(`executeAgentTestRun`) · 11249·11270·11271·11316·11333·11524·11602·11675·11709·11757·11788·11801·11818·11831(스모크/역량 시험) · 12284(`dispatchLiveAgent`) · 12883(피드백 재작업) · 13476(한수 자동 훅).

| 파일 | export(행) | AI(`new Anthropic` / create) | server.js 참조 | 읽는 DB(전부 SELECT) | 읽는 문서 |
|---|---|---|---|---|---|
| 글샘.js(355) | `cleanTitleField, cleanShortField, hasContamination, live:true, steps, stepDelayMs, result()`(165~) | **259** / 263·283·313 · `GEULSAEM_MODEL` 14 | loadAgentRunner 11249·11270·11675 · `.cleanTitleField` 11524 | agent_lessons 193 · schedules 212 · inquiry_scenarios 57 · bot_products 63 · naver_inquiries 69·74 · naver_qnas 72 · message_logs 84 | docs/knowledge/marketing 8종(16~25) · 글샘_특성(225) |
| 기안.js(144) | `live:true, steps, stepDelayMs, result()`(48~) | **55** / 90~91 | 11316·11333·11831 | — | 비전_v1·기안_특성·브랜드가이드(10~12) |
| 미래.js(150) | `live:true, reviewContent, REVIEW_ITEMS, backlogAdd, backlogList, …`(100~) | **46** / 66(`reviewContent` — server 호출 0) · `result()` 106 = 0원 코드 | 11801 | **dev_backlog INSERT 91 / SELECT 96**(유일한 쓰기) | version.js(86)·CHANGELOG(87)·미래_특성·브랜드가이드 |
| 미소.js(188) | `live:true, steps, stepDelayMs, result()`(77~) | **148** / 151 | 11271·11709 · report.type `miso_prompt` → `/runs/:id/generate` 14519 → `generateMisoMedia` 14453(**GoogleGenAI**) | agent_lessons 102 | 마케팅_전문팀_시스템(14)·브랜드가이드(16)·톡톡_실전사례(36)·미소_특성(118) |
| 세미.js(1069) | `live:true, steps, stepDelayMs, result()`(912~916) | **없음**(`exceljs` 11 · 순수 DB 집계) | 11602 · 13476(한수 훅) · 6728~6731 | pricing 27·521·526 · settlements 29·290·435·702·803 · product_mappings 32 · settlement_status 211·216·238 · cj_carryover 326·866·1005 | 세미_특성(주석) |
| 예리.js(123) | `live:true, …`(33~) | **83** / 85 | 11818 | agent_lessons 51 | 브랜드가이드(9)·예리_특성(60) |
| 지율.js(120) | `live:true, …`(35~) | **42** / 88 | 11757 | agents 46 · agent_lessons 49 | 노무지침_v1(9)·지율_특성(10) |
| 한결.js(113) | `live:false, reviewContent, REVIEW_ITEMS`(109~) | **64** / 85~87(server 호출 0) | **로드 0건** · DB is_active=false(1381~1383) · 검수 게이트 #54 제거(6733~6735) | — | 브랜드가이드·한결_특성 |
| 한수.js(121) | `live:true, verifyReport, computeMargin, parseWon, steps, stepDelayMs, result()`(91~) | **없음** | `require('한수.js')` **6758**(세미 결과 검산 게이트 6756~6771) · 11788 · **한수 자동 훅 setInterval 13463~13515**(월요일 브리핑 13466~13498 · 단가 변경 감지 13503~13512 · config `hansu_brief_last`·`hansu_price_maxid`) | — | 한수_특성 |

- 7종이 **각자 `new Anthropic()`** 생성(server.js 클라이언트 미공유). 글샘 정화기(`cleanTitleField`·`cleanShortField`·`hasContamination` 글샘.js 100~165)는 server.js 정화기(`maruClean*`)와 별개·미공유. `agents/tools/` 디렉터리 없음(README 언급만).
- **글샘 = 내부용 판정**: 입력 = 대표 지시(`params.order_content` 173) · 산출 = LMS/톡톡 마케팅 카피 **초안**(발송은 대표가 알리고에서 · server.js 1361~1362) · 문의 답변 재료 모드(`loadInquiryMaterials` 51~100)도 「시나리오 등록은 사람이 [문의 관리]에서」(98). **손님에게 직접 나가는 경로 없음.** (8/24 대표 취소 지시 「톡톡·문의답변 제목 생성(마루)」은 별개 경로 — CLAUDE.md #421.)
- 참조 스크립트: `scripts/verify-421-geulsaem.js`만 agents/ 직접 참조.

### 5-b. server.js 에이전트 전용 코드 목록

**테이블(initDB CREATE 행)**: `agents` **696**(시드 1236~1281 · INSERT 1276) · `agent_runs` **716**(is_test 729 · archived_by 731 · 인덱스 728) · `agent_feedback` **734**(created_by 747) · `agent_lessons` **750**(approved_at 783) · `agent_tools` **763**(시드 1284~1297 · 1357) · `pending_orders` **787**(result 796 · run_id 797 · processed_at 798 · created_by 800 · image_data 802 · image_mime 803) · `report_files` **589**(INSERT `saveReportFile` 11913 · 읽기 13269·14670) · `dev_backlog` **1369** · 부팅 정리(pending 처리중→대기 **1222** · runs running→error **1227** · agents→idle **1232**). 🔴 `agent_office_config` **776**은 **공유 테이블**(손님·운영 키 70여 개 — inquiry_auto_reply·qna_auto_post·inquiry_auto_post·bot_timing·telegram_*·alert_*·notify_channel_mode…) · 에이전트 전용 키 = `routing_table`(1303)·`action_grades`(1314)·`staff_roster`(1332)·`hansu_brief_last`·`hansu_price_maxid`·`smoke_request`·`settle_ocr_probe_request/result`. `cc_instructions` **604**(똑똑이→클코 지시함 · MCP `register_instruction` 14397 · 알림 13536~13565)는 **별개 파이프라인 — 유지**.

**함수(정의 행)**
- 실행 엔진: `AGENT_DEFAULT_RUNNER` 6685 · `loadAgentRunner` 6691 · `agentStep` 6699 · `agentRunAppendStep` 6702 · `executeAgentTestRun` 6709~6796(한수 검산 6756~6771 · 날짜 대조 6740~6754 · 완료 알림 6781)
- 마루 두뇌: `MARU_MODEL_RAW/MARU_MODEL` 10610~10611 · `MARU_ROUTE_TOOL` 10614(enum 10622~10632) · `maruBuildSystemPrompt` 10682(routing_table/staff_roster 10683 · agents 10691 · 문의 스냅샷 10711~10715 · agent_lessons 10727) · `LESSON_TOOL` 10832 · `extractLessonFromFeedback` 10848 · `backfillLessonsFromFeedback` 10890(부팅 14889)
- 정화기: `MARU_TAG_RE` 10911 · `maruCleanText` 10914 · `maruCleanToken` 10919 · `maruDecisionPolluted` 10925 · `maruPollutionSample` 10932 · `maruCleanDecision` 10946 · `maruNormalizeDecision` 10975 · `maruPlainAnswer` 10996 — **호출 전수 10950~10970·11005·11118~11131·11432·11590·12820 = 전부 마루/시험 · 손님 경로 0**
- 지시 처리: `maruFinishOrder` 11009 · `buildCombinedOrderText` 11020 · `buildFollowUpText` 11028 · `buildMultiFollowUpText` 11036 · `maruWeekPeriodOverride` 11047 · `parsePartnerKeyword` 11053 · `maruForceFinanceRoute` 11062 · `maruDecide` 11087 · `maruDecisionUnusable` 11138 · `dispatchLiveAgent` 12264 · `processOrderWithMaru` 12633~13070
- 마루 직접 처리: `fmtScheduleLine` 11894 · `saveReportFile` 11911 · `WANT_FILE_RE` 11924 · `buildScheduleXlsx` 11927(ExcelJS 11910) · `maruRecordRun` 11944 · `maruRegisterScheduleItems` 11965(→ `svcCreateSchedule` 11973 공용) · `maruHandleSchedule` 11984 · `ssTotalOf` 12117 · `fmtDateLabel` 12126 · `maruHandleSettlementInput` 12133 · `maruExecuteSettlementSave` 12161 · `MARU_YES_RE/MARU_NO_RE` 12209~12210 · `maruTryScheduleConfirm` 12212
- 정산 OCR(§2) 12353~12632 + 진단 러너 setInterval 14317~14345(`settle_ocr_probe_request` 14322)
- 시험: `capWeekdayErrors` 11161 · `capTestRunning` 11175 · `extractDatesISO` 11179 · `smokeMissingInfo` 11209 · `executeSmokeTest` 11218 · `svcStartSmokeTest` 11373 · `executeCapabilityTest` 11393~11888 · `svcStartCapabilityTest` 13207 · 부팅 smoke_request 14893~14907
- 한수 자동 훅 setInterval 13463~13515
- 미소 미디어: `MEDIA_OPTIONS` 14425 · `assertMediaApproval` 14436 · `loadBrandCharacterParts` 14442(assets/brand 2장) · `generateMisoMedia` 14453(GoogleGenAI 14456~14512) · 라우트 14519
- MCP 에이전트분: `svcGetLiveLog` 14607 · `svcGetTestResults` 14628 · `svcGetReports` 14657 · `MCP_TOOLS` 14700~14818 중 **get_live_log·get_test_results·get_reports·run_capability_test(14788)·run_smoke_test(14804)** 5종. 나머지 11종(register_instruction·get_instruction_status·schedules·approvals·items·get_settlements)은 공용 svc*(4961~5240·14392·14409) → 유지. `handleMcpRpc` 14819 · `/mcp/:secret` 14859 = 공용 프레임.

**라우트(에이전트 전용)**: 6800 GET agents · 6823 agents/:id · 6848 agents/:id/run · 10356 runs/:id · 10369 runs · 10407 feedback(→ 10464) · 10478·10500 lessons approve/discard · 10515 lessons · 10539 feedback · 10554 feedback/:id/delete · 10565·10576 runs archive/unarchive · 10587 growth · 13073~13230(orders 7종·settlement-ocr-save·capability-test) · 13238 misroute-stats · 13266 files/:id/download · 13290·13302 archive · 13317 today-reminders(schedules 조회 · LIVE 배너 — 판단 필요) · 13339 config(agent_office_config 전체 노출) · 13455 telegram-test · 14519 runs/:id/generate.

### 5-c. 손님 응대 경로와 공유 코드

**손님 응대 진입점**: `GET /api/scenarios` **6646~6674**(inquiry_scenarios 6657 · `inquiry_auto_reply` 6662 · `seasonScenariosToday` 6665 · `shippingScenarioToday`·`citrusNamingToday`·`paymentWordingRule` 6666 · `shippingNowPhrase` 6671) · `collectQna` **8475~8554**(`qna_auto_post` 8514 · `qnaGenerate` 8517 · `naverPostQnaAnswer` 8529 · 알림 8544~8547 · 수동 6606) · `collectInquiry` **7966~8057**(`inquiry_auto_post` 8010 · `inquiryGenerate` 8018 · `naverPostInquiryAnswer` 8029 · 수동 6635) · `POST /api/public/shop-chat` **9122~9195**(`mallChatTiming` 9083 · `qnaGenerate` 9152 · `logMallChat` 9096 → message_logs 9109) · qna_sim 러너 **14225~14242** · 수집 스케줄러 `naverAutoCollectTick` 9528~9578. **카카오 스킬 `/kakao-skill` = 이 리포에 코드 0건**(톡톡봇 리포 · 회사 서버는 `/api/scenarios`로 재료만 공급).

**생성기 내부 의존(전수)**: `qnaGenerate` 8391~8440 / `inquiryGenerate` 8601~8644 → `Anthropic`(8 · new 8401/8613) · `QNA_MODEL` 8333 · `QNA_TAIL` 8332 · `qnaScenarios` 8146 · `seasonScenariosToday` 8156 · `shippingScenarioToday` 8198(`loadShippingHolidayInfo` 5560 · `shippingSchedule.computeShipping` 8206 · bot_products 8237) · `shipDayLabel` 8194 · `citrusNamingToday` 8278 · `paymentWordingRule` 8310 · `qnaStoreData` 8077 · `qnaBuildSystem` 8334 / `inquiryBuildSystem` 8555 · `qnaRenderPlaceholders` 8135 · `qnaFilterStoreLines` 8117 · `QNA_FILTER_STOPWORDS` 8113 · `qnaPiiCheck` 8058 + `QNA_PII_WHITELIST` 8057 · `naverPostQnaAnswer` 8443 · `naverPostInquiryAnswer` 8647 · `naverMaskContact` 7956. 마루 함수 호출 **0**.

**「지우면 손님 응대가 죽는 코드」(삭제 후보와 실제 공유)**

| 코드 | 정의 행 | 손님 경로 사용 | 에이전트 사용 | 판정 |
|---|---|---|---|---|
| `const Anthropic = require('@anthropic-ai/sdk')` | **8** | 8401·8613 | 10857·10997·11091·12437·12460 + agents 7종 | **삭제 금지** |
| `notifyTelegram`/`telegramChatId`/`tgMask`/`telegramSelfcheck` | 13393/13357/13384/13426 | 8544~8547·8041~8044·9570·알림톡·룰렛·정산 | 6781·11015·11959·13498·13512 | **삭제 금지**(주석 13347~13355 「지시 #10」만 에이전트 유래) |
| `alertEnabled`/`alertText`/`telegramAlertSettings`/`TELEGRAM_ALERT_KEYS` | 6299/6285/6289/6257 | 8544·8545·8041·8042 | `'office'` 키(6781·11015·11959) | **삭제 금지** — `'office'` 키 정리는 미확인(프론트 알림 설정 화면 의존 미조사) |
| `agent_office_config` 테이블 | 776 | 6662·8514·8010·9083·telegram_*·alert_*·notify_channel_mode | routing_table·staff_roster·action_grades·hansu_*·smoke_request·settle_ocr_probe_* | **테이블 삭제 금지** — 전용 키만 |
| `naverCfgGet`/`naverCfgSet`/`jsonSafeStringify` | 7203/7214/7211 | 8514·8010·14227·14238 | 14322 | **삭제 금지** |
| `writeAudit`/`adminActor`/`handleAdminErr` | 4948/5251/5261 | 전역 | 전역 | **삭제 금지** |
| **`kstTodayStr`** | **11889(마루 블록 안)** | 정산 대조 7374·7412·7456·7461·7494 · 라우트 4430·13319 | 다수 | **삭제 금지 — 이동 필요** |
| `message_logs` | 1140 | shop-chat 9109 · 톡톡봇 | 글샘.js 84 SELECT | 테이블 유지 |
| `inquiry_scenarios`·`bot_products`·`naver_qnas`·`naver_inquiries`·`product_season_knowledge`·`shipping_holidays`·`schedules` | 1119·1156·855·848·1176·1066·200 | 손님·운영 전부 | 글샘.js·마루 프롬프트 SELECT만 | 유지 |
| `matchItemToPricing`/`normDateSafe` | 3750/3030 | 정산·품목 4066·4397·3711 | 6728·11225·11603·13485 | 유지 |
| svc*(스케줄·품목·정산) | 4961~5240 | 라우트 5274 · MCP 14723 | 11973 | 유지 |
| `shipping-schedule.js`·`loadShippingHolidayInfo` | 17/5560 | 8206·8326·알림톡 | — | 유지 |
| 마루 정화기 10911~10996 | — | **없음** | 마루만 | 검증 뒤 삭제 가능 |
| 글샘 정화기(글샘.js 100~165) | — | 없음 | 11524 · verify-421 | 검증 뒤 삭제 가능(스크립트 동반) |
| `extractDatesISO` 11179 | — | 없음 | 6744·11237·11744 | 검증 뒤 삭제 가능 |
| `saveReportFile`·`report_files` | 11911/589 | 없음 | 6730·11605·11609·12003·14560·13269·14670 | 검증 뒤 삭제 가능(13266·svcGetReports 동반) |
| `date-utils.js`(server.js 13) | 파일 | 없음(호출 11049~13043 전부 마루/시험) | 마루 | 검증 뒤 삭제 가능(`scripts/test-dates.js` 동반) |

### 5-d. package.json

| 패키지 | 사용 | 판정 |
|---|---|---|
| `@anthropic-ai/sdk` | server.js 8(qna·inquiry·마루) + agents 7종 | **유지** |
| `@google/genai` | server.js 10 · `generateMisoMedia` 14456~14512만 | 에이전트 전용 — 미소 폐기 시 삭제 가능 |
| `openai` | server.js 9 require만 · `new OpenAI`/`OpenAI.` 사용 **0건** | 미사용 — 삭제 가능(에이전트와도 무관) |
| `exceljs` | 11910(`buildScheduleXlsx`) · 세미.js 11 · `scripts/verify-395-ui.js` 131 | 서버 사용은 에이전트만 · verify-395 유지 시 패키지 유지 |
| tesseract.js 계열·pako · officecrypto-tool · express·pg·jsonwebtoken·bcryptjs·dotenv | 주문정리기 OCR 13585~13597 · 송장 복호 1453 · 공용 | **유지** |

---

## 6. pending_orders · agent_runs 상태값 전체

### pending_orders (CREATE 787: `id · content TEXT NOT NULL · status VARCHAR(20) DEFAULT '대기' · created_at · is_deleted false` + `result JSONB` 796 · `run_id` 797 · `processed_at` 798 · `created_by` 800 · `image_data` 802 · `image_mime` 803)

| status | 설정 지점 | 의미 | 화면 |
|---|---|---|---|
| `대기` | 기본값 787 · 13084 · 12794(멀티 서브) · 부팅 1222 | 접수·미처리 | wait 회색 · 폴링 계속 · 「쌓인 지시」 |
| `처리중` | 12635 | 마루 분석 중 | wait · 폴링 계속 |
| `완료` | 12008·12082·12204·12205·12232·12257·12624·12785·12823·12349 · 13161 | 처리 끝 | done 초록 |
| `질문` | 12034·12066·12090·12138·12154·12575·12809·12837·12857·13048 (텔레그램 11015) | 대표 답변 대기 | ask 노랑 · [✔ 확인] · 미응답이면 말풍선 ❓ |
| `안내` | 12055·12097·12231·12606·12921·13022·12290·12303 | 실행 없이 안내 | info |
| `피드백` | 12899 | 피드백 저장 | info |
| `오류` | 12166·12522·13067 | 실패 | err 빨강 · [✔ 확인]→오류확인 · 「쌓인 지시」 |
| `응답됨` | 12542·12623·12743 | 질문이 답변으로 닫힘 | info 반투명 「답변으로 이어짐」 |
| `취소` | 12607 | OCR 저장 "아니" | (10920 규칙상 wait) |
| `대체됨` | 12700·12702 | 새 지시로 자동 종결 | info 「새 지시로 대체」 |
| `질문종결` | 13101 | 수동 close | info 「미응답 종결」 |
| `오류확인` | 13173 | 오류 확인 | (기본 필터 밖) |

목록 기본 필터 13193 `('대기','처리중','오류','질문')` 또는 run 연결 · 재처리 허용 13120 `['대기','오류']`.

**result.type 값**: route 12278 · clarify 12035/12810/12838/12858 · answer 12824 · feedback 12900 · multi_dispatch 12786 · query_confirm 13049 · invalid_date 13023 · error 12166/12522/13068 · maru_schedule 12007 · schedule_list 12009 · vacation_redirect 12056 · schedule_created 12083 · schedule_confirm 12091 · schedule_blocked 12098 · settlement_confirm 12155 · maru_settlement 12196 · settlement_saved 12201 · confirm_cancelled 12231 · settlement_ocr_confirm 12576 · settlement_ocr 12587 · settlement_saved_ocr 12625·13162 · (프론트만 참조) settlement_ocr_need_partner 10935 · schedule_cancelled/settlement_cancelled 10139·10145(서버 설정 지점 미확인 — `confirm_cancelled` 12231과의 관계 미확인). 요원 report.type: geulsaem_copy·gian_plan(6740~6742) · miso_prompt(14527) · hansu_margin(한수.js) · hansu_briefing 13496 · mirae_version/mirae_backlog(미래.js) · semi_*(세미.js) · smoke_test 11357 · capability_test 11873.

### agent_runs (CREATE 716: `id · agent_id REFERENCES agents(id) · status DEFAULT 'running' · steps JSONB '[]' · result JSONB · started_at · finished_at · is_deleted false` + `is_test` 729 · `archived_by` 731)

| status | 설정 지점 | 화면 |
|---|---|---|
| `running` | INSERT 기본(6862·12312·12499·11380·13214(is_test)·13491) | 마지막 step 1줄 · 폴링 계속 |
| `done` | 6778·11364·11865·11954(`maruRecordRun`)·12586·13493 | ✅ 미리보기 · donecard · ✔확인 |
| `error` | 부팅 1227·6788·11386·12523·13221 | ❗ |
| (`is_deleted`) | archive 10569 / unarchive 10579 | 보고서함 숨김 |

**관련 테이블 상태값**: `agents.status` idle(1232·6784·6794·11878·13226)/running(6864·12314·13216)/done(6780)/error(6790) · `is_active`(한결 false 1381) · `agent_lessons.status` active(750·10488)/제안(10871)/폐기(10503) · `agent_feedback.feedback_type` good/edited/bad/comment(12866)+fail(10441~10467) · `dev_backlog.status` 대기(1373) · `cc_instructions.status` 대기(609)→진행/완료(13554~13555 · 상태 변경은 외부 클코 스크립트). 질문에 있던 `agent_files`·`order_files`·`reminders` 테이블은 **존재하지 않음**(파일 = `report_files` · 리마인더 = `/today-reminders`가 `schedules` 조회).

---

## 7. 전환 시 끊어야 할 호출 지점 (우선순위순 · 커밋 ed8cb87 행)

| # | 지점 | 함수 · 행 | 비고 |
|---|---|---|---|
| 1 | **마루 판단 관문** | `maruDecide` 11087 (create 11102 · 재시도 11132) · 호출 **12723** | 모든 일반 지시가 통과하는 단일 관문. 여기서 「'대기'로 쌓고 반환」하면 ⑧~⑰ 전부 정지 |
| 2 | **정산 OCR 판독** | `settleOcrRead` 12479(→ `settleOcrReadOnce` 12436 · `settleOcrPlainRead` 12459) · 호출 `maruSettlementOcr` **12509** | 판독값을 외부에서 받아 **`settlementOcrBuildConfirm`(12559)** 로 넘기면 확인표·저장 경로 무변경 |
| 3 | answer 폴백 | `maruPlainAnswer` 10996 · 호출 12820 | 1을 끊으면 도달 불가 |
| 4 | feedback 교훈 추출 | `extractLessonFromFeedback` 10848 · 호출 12878(await 없음) · `POST /feedback` 10464 · 부팅 `backfillLessonsFromFeedback` 14889 | 라우트·부팅 경로 별도 |
| 5 | **요원 실행 수렴점** | `dispatchLiveAgent` 12264 → `executeAgentTestRun` 6709 → `runner.result()` **6725** | route·feedback 재작업(12896)·query_confirm 승인(12247)·multi 재귀(12805) 전부 여기로. 끊는 곳은 6725 한 곳이 가장 좁음(세미·한수·미래는 AI 없음) |
| 6 | 백그라운드 AI 부수 경로 | 한수 훅 13463~13515(세미 재호출 — AI 없음) · OCR probe 러너 14317~14345 · 스모크/역량 시험 11218·11393·13207 · `POST /agents/:id/run` 6848 | 지시 경로 밖 — 별도 판단 |
| — | **끊지 말 것(지시 경로 밖 AI)** | `qnaGenerate` 8391 · `inquiryGenerate` 8601 · qna_sim 14225 | 손님 응대 |

**프론트에서 함께 바뀌어야 할 지점**: 전송 `aoSendOrder` 9997·10003 · `aoQuickAnswer` 10055 · `aoAnswerChoice` 10072 · `aoSettleSaveOcr` 9919·9922 · `aoProcessOrder` 10177 / 폴링·판정 `aoPollOrder` 10082~10095(종료 status 집합) · `aoHandleOrderResult` 10109~10172 · `aoOrderLogLine` 10925~10955 / run 추적 10152~10156·`aoStartRunPolling` 10739·`aoAnimateStep` 10779·`aoRefreshLog` 10974~10976 / '마루' 리터럴(4-5 표) · `aoAgentElByName('마루')` 10784 / 조직도 `aoRefreshAgents` 10205·`AO_TEAMS`·`AO_COLORS`·`AO_TRAIT`·`AO_LIVE_TOOLS`·index 2272~2278 / 법인 필터 index 2237~2241·app 9727~9734·10509·10724·11102 / 보고서 rep.type 17분기 11553~12028·'한결' 11526·'한수' 11540 / 확인표 스키마 9785~9848 / 성장·관리·피드백 API 10229~10230·11185~11451·10276~10417 / 상태 매핑 9708·10920~10922·11482~11484·10850 + CSS(styles 4005~4008·4105~4110 / theme 258~261).

---

## 8. 미확인 목록 (추측 배제)

1. `extractLessonFromFeedback`(10848)의 model 값 · `maruBuildSystemPrompt`(10682) 본문 내용(new Anthropic 없음은 grep 확인).
2. `schedule_cancelled`·`settlement_cancelled` type의 서버 설정 지점(프론트 10139·10145 참조만 확인 — `confirm_cancelled` 12231과 동일한지).
3. `today-reminders` 13317 — 에이전트 폐기 후에도 LIVE 배너용으로 쓸지(대표 판단).
4. `docs/knowledge/company/*`·`docs/archive`(13290 라우트) 존치 여부(내용 미열람).
5. 프론트 알림 설정 화면이 `TELEGRAM_ALERT_KEYS`의 `'office'` 키를 렌더하는지(app.js 미조사).
6. 톡톡봇 리포의 `/kakao-skill`이 회사 서버의 `/api/scenarios` 외 다른 엔드포인트를 호출하는지(별도 리포 미열람).
7. `exceljs`가 `scripts/*` 다른 검증 스크립트에서 더 쓰이는지(verify-395-ui.js 1건만 확인).
8. app.js 9688~11517 안에 송장변환·다른 메뉴가 공유하는 함수가 더 있는지(전수 미대조 — #463 교훈상 삭제 전 `indexOf` 표식 4개 재확인 필수).
9. `.ao-biz-btn`·`.ao-view-tab` 등 레이아웃 CSS 선택자 위치(색상 매핑만 조사) · `aoRunAgent`(10721)를 부르는 UI의 실제 존재 여부(`#ao-detail-run-btn` 참조만).
10. 총괄의 미커밋 #469 desk 엔진 코드(`aoEngine`·`deskIntake`·`deskOcrTick`·`/desk-*`·`/orders/:id/approve|reject`)는 본 조사 범위 밖 — 본문 미열람(함수·라우트 이름은 diff 헤더에서만 확인).

---

## 9. 조사 방법 (재현용)

- 3갈래 병렬 읽기 조사(백엔드 1~3 / 프론트 4 / 삭제·의존·상태 5~6) → 워커가 표본 함수 20여 개를 `grep -n`으로 재대조(처리 본체·Anthropic 7곳·프론트 진입 함수 전부 일치).
- 행 번호는 커밋 `ed8cb87`. 재확인 명령 예: `git show ed8cb87:server.js | grep -n "^async function maruDecide"`.
- 코드·DB·러너·git 무접촉(이 파일 1개만 신규).

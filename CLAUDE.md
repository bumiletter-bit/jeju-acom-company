# 제주아꼼이네 회사프로그램 — 네이버 커머스API 연동 인수인계

> **이 문서 목적**: 새 세션(새 터미널)에서 이것만 봐도 네이버 API 연동 작업을 그대로 이어가기 위한 상세 기록.
> **최종 갱신**: 2026-07-26 (v5.9.96 배포 시점)
> 요약본 아님. 구체적으로 적음. 관련 상세는 리포 `NCP인증키/네이버커머스API_연동_인수인계서.md`(최초 설계)와 자동메모리 `jeju-naver-commerce-api.md`도 참조.

## ★ 현재 상태 (2026-07-27 세션 종료 시점) — 문의 3채널 자동답변 완전 가동

- **배포**: v5.9.122까지 라이브(app.js v=311, curl 실확인). 7/27 하루 배포분 = v5.9.97~122. 상세는 CHANGELOG.md.
- **문의 3채널 자동답변 완전 가동** (전부 시나리오 기반 생성 — 철칙: 재료에 없는 사실 생성 금지·부족하면 SKIP·꼬리 문구 서버 강제):
  - **톡톡**(실시간 웹훅, 별도 리포) · **상품문의**(수집 3분·`qna_auto_post` ON·공개 게시) · **고객문의**(수집 3분·`inquiry_auto_post` ON·1:1 비공개, 반품·교환·환불 클레임은 항상 직원 처리). 쓰기는 `naverPostQnaAnswer()`/`naverPostInquiryAnswer()` 2개 함수만(PII 차단 내장). 중계서버 ALLOW 쓰기 2줄 반영 완료(RELAY_VERSION 2026-07-27.3, 대표 SSH 완료). 시나리오 53건, 공통 전환분 위험 점검·문구 수정 완료(43번 되묻기형 포함).
  - 답변 옆 **재료 시나리오 번호 링크** 3채널 완비(클릭→편집 화면). 톡톡봇 scenario_nos 기록 커밋 00aa21f push됨(가격 즉답 가로채기 수정 da1f184 포함).
- **글샘·마루 문의 DB 연결**(v5.9.105 — 읽기 전용·마스킹본): 문의 요약/분석을 보고서로 생성. ⚠️ **3연타 재테스트 미완**(1번만 검증됨). 마루 도구 JSON 태그 오염은 **평문 폴백**(v5.9.110)으로 해결 — 전 요원 모델 claude-sonnet-5 통일(Render env도 수정됨).
- **자동 로그아웃 수정·검증 종결**: 폴링이 이용으로 카운트되던 버그 → X-User-Active 헤더(실사용자 행동만 연장, v5.9.112). 계정별 예외 `users.idle_hours`(발주컴퓨터 12시간). 실검증 전 항목 합격·대표 현장 확인.
- **알림 관제 완전체**: 상황별 분리(0건 무알림/답변완료 확인바람/직접 처리 필요)·미처리 리마인더 30분·야간 모드 21:30~07:30 전 계열 누적·아침 종합 브리핑 07:30(0건 줄 생략·OFF 제외)·취소반품 알림은 **반품·교환만**(취소는 수집만). 타이머: 문의·상품문의 3분(하한 5→3분 완화)·반품 10분·주문 60분.
- **문의 관리 UI 개편**: 탭 순서 판매현황→시나리오→💬톡톡 문의(서브탭: 자동답변/미매칭·무응답+엑셀)→상품문의→고객문의. 전 탭 표 규격 통일(질문·답변 60자 접기·고정 열폭·상품명 말줄임·모바일은 min-width 가로 스크롤). 저장/게시 라임 토스트 피드백.
- ✅ **7/28 07:30 첫 종합 브리핑 성공**(대표 텔레그램 실물 확인) — 야간 모드→아침 브리핑 사이클 자연 검증 완료. 알림 회사폰 연동도 완료(대표 직접, 7/28).
- ✅ **톡톡봇 구 페이지 은퇴 공식 종결(7/28)**: 대표가 Render(톡톡봇)에 `PRODUCTS_PAGE=off`·`UNMATCHED_PAGE=off` 설정·재배포 → 검증 4항목 전부 합격(/products·/unmatched HTTP 410+이전 안내, /health 정상, 판매현황·가격 탭 실물 정상, 톡톡 실전 답변 확인). **scenarios.js 폴백(47KB) 정리는 백로그로 이관 — 폴백 전략 설계 선행 필요**(DB 장애 시 봇 응답 대안 결정 후 착수).
- **다음 작업 후보**: ①알리고 문자 AI상담사 ②주문 알림 확장(보류 — 대표 필요시 지시) ③scenarios.js 폴백 정리(백로그, 상기 참조).

> **★ 현재 상태 (7/29 지시 #90~#99 처리 완료 — v5.9.139 라이브)**: 🚀 **알림톡 4장(A·B·D·E) 검수 신청 완료(2026-07-29, 대표 GO #98)** — tpl_code UJ_9084(A)·9085(B)·9086(D)·**9087(E 3버튼: AC+택배 배송조회+맛있게 드시는 법·보관법, #99)**. 구본 UJ_9082(E 1버튼)는 미사용 예정. 예상 결과 7/31~8/5(공식 영업일 2일·알리고 안내 4~5일). **폴링 턴마다 심사 상태 추적 — 승인/반려 시 지시함 즉시 기록.** 상세·시행착오(tpl_type=AD 필수·linkM/linkP 매핑·심사중 수정 불가) = `docs/알림톡_템플릿_문안.md` 심사 신청 이력.
> **가동 인프라 전부 완비**: 알리고 릴레이 경유(#95 — IP 등록·릴레이 2026-07-29.1 갱신 완료·재테스트 전 항목 통과, 잔여 포인트 SMS 11,096·LMS 3,599) · 발주확인 자동(#92 — confirm ALLOW 반영·dry-run 합격) · 발송 안내 E 우선→SMS 대체(#93·94) · 공개 페이지 `/guide?p=상품id`·`/track?n=송장번호` 라이브. C 폐기 유지. 실발송 0·KAKAO_NOTIFY=off.
> **승인 후 절차(대표)**: ①Render env에 tpl_code 4종 투입(ALIGO_TPL_CODE=UJ_9084·_RESERVE=9085·_WELCOME=9086·_GUIDE=9087) ②`ALIGO_TEST=Y` 리허설 → `KAKAO_NOTIFY=on`·타이머 ON(전부 대표 GO로만). **잔여 대표 확인**: 이미지형 알림톡 추가 여부(선택지 #98 응답) · 카페24 scope 재동의 묶음 · D 마이페이지 '가입 혜택' 실존 확인 · A/B 발송 문면 JSON 일원화 정비(#93 응답 참고). 상세 = 지시함 #92~#99 응답.
> **운영 규칙 요약**: 지시함 폴링(경량 poll-light v2 — 판별 내장·대기 전건 조회) · 3층 체제(#71) · 서브 전문가 역할 부여(#82) · 품질 그물망(#83 — 함정5·체크리스트·교차 검수·애매하면 대표 확인) · 알림 정책(#84 — 지시함 평시 침묵, 긴급만 🚨 `naverCfgSet('urgent_call_request', {reason})`) · 검수 신청·실발송·스위치 ON은 대표 GO로만.
> **속도 규칙 2종 (#90 대표 확정 — 상시)**:
> - **[규칙 A — 서브에이전트 최소주의]** 기본은 메인 단독. 서브 기동은 ①독립 큰 덩어리 2개+ 병렬 이득 명확 ②완성 단계 교차 검수 필요 시에만. **예상 30분 미만 작업은 무조건 메인 단독.** 전문가 역할·품질 그물망은 메인 단독 시에도 동일 적용(퀄 유지, 기동 비용만 제거).
> - **[규칙 B — 폴링 간격 상한]** 지시 없을 때도 대기 간격 **5분 이내** 유지(20분 완화 금지 — 똑똑이 지시 감지 지연 방지). **지시 응답·대기 모드 선언 직전에는 반드시 재폴링**(스테일 판단 금지 — 7/29 #87~89 놓침 원인). poll-light v2: '대기·진행중' 전건 조회 + 첫 줄 verdict 내장(LIMIT 잘림·눈판독 결함 수정).

## ★★ 2026-07-29 진행분 (지시 #80~#85 — 아래 7/28 인수인계에 이어서)

- **운영 규칙 3건 추가 접수·상시 적용**: #81 구조·틀 집중(디자인은 추후 전문 디자인) / **#82 서브에이전트 전문가 역할(페르소나) 부여 의무** / **#83 품질 그물망**(착수 전 함정 5·마감 체크리스트·교차 검수(만든 자가 검사 금지)·애매하면 "대표 확인 필요"로 분리). 보고에 "에이전트 운용"+"품질 그물망 3줄" 필수.
- **#80 재개 작업**: Playwright MCP 등록 완료(✔ Connected — **세션 재시작 후부터 도구 사용 가능**, 스크린샷 자가 검수용) / 리뉴얼 리포 git에서 이미지 6건 복구(로고·체험장4·추천pick — 플랫폼 폴더 images\, 원본 무수정. **아꼼이 캐릭터 단독 파일은 git에 없음** — 로고가 겸함) / **index_v3.html 최종**: 로고·체험장 실사진 base64 임베드(738KB 단일 파일)·릴스 4→7편(청귤 카드 = 시즌 배지+상품 링크+대기 신청 버튼).
- **v5.9.133 (#84)**: 지시함 텔레그램 알림 **기본 침묵**('ccbox' 스위치, CS폰 소음 방지) + 긴급 호출 **"🚨 똑똑확인요청"** 신설 — 발동 = `naverCfgSet('urgent_call_request', {reason:'...'})` DB 플래그(60초 폴러가 발송 후 제거, 야간 무관). 테스트 1건 발송 확인. ⚠️ 대표 확인 대기 2건: 텔레그램 장애 시 긴급 호출 유실 트레이드오프·ccbox ON 시 야간 발송 여부.
- **v5.9.134 (#85)**: 자사몰 **게임 백엔드 선행 시공** — 테이블 5종(mall_members·points_ledger append-only·roulette_spins 1일1회 DB UNIQUE·tree_state·reward_grants) + `mall-api.js` → `/api/mall/*` 13종(**env MALL_API=on + MALL_API_TOKEN 없으면 전 라우트 503 — 현재 완전 잠금 실측**) + 데이터관리 "🎮 게임 운영" 카드(확률·한도 화면 편집·대표 전용). QA 교차 검수 결함 8건 수정. ⚠️ 대표 확정 대기: 룰렛 확률·원가(현 기대지급 ~22.7물방울/스핀)·한도 실값·회원 인증 방식·가동 env 투입.
- **다음 후보**: ①알림톡 템플릿 검수 신청(#75 보류 해제 시) ②발송 안내 dry-run 실검증(타이머 lms_guide ON) ③자사몰 프론트-백엔드 연결(프로토타입→/api/mall 실호출) ④카페24 scope 재동의(mall.write_promotion·mileage).

## ★★ 2026-07-28 세션 인수인계 (지시 #79 금일 종료 — 내일 대표 GO 사인 후 재개)

> **운영 체제**: 지시함(AGENT OFFICE) 폴링 파이프라인 가동 중. 똑똑이(전략·지시)→클코 메인(총괄·분할·검수·취합)→서브에이전트(제작 실무·병렬) 3층 구조(지시 #71). 보고는 지시함 단일 창구 + "에이전트 운용" 1줄 필수. **민감 작업(DB 마이그레이션·배포/push·기존 가동 코드 인접·시크릿)은 메인 직접**, 서브 결과물은 메인 검수 없이 머지 금지.
> **지시함 응답 방식**: `respond-instruction.js` 부재 → `cc_instructions` 직접 UPDATE(세션 스크래치 스크립트). 경량 폴링은 id·상태만 조회 후 '대기' 건만 본문 조회.
> **모델**: 7/28부터 Opus 5 (Fable 한도 이슈 — 대표 지시 #78).

### 오늘 배포분 (v5.9.128~132, 전부 additive·실발송 0건)
- **v5.9.128 (#68)**: 알림톡 자동화 기반 — bot_products.notify_message(품목별 짧은 안내문)·shipping-schedule.js(발송일 계산)·kakao-notify.js(알림톡 뼈대)·kakao_notify_log·season_waitlist(시즌 대기 신청)·텔레그램 kakaosend 알림. 전부 스위치 OFF
- **v5.9.129 (#69)**: 발송일 규칙 대표 확정 — **토요일만 발송 불가**(일 발송 가능)·발송일=주문 다음날(토·휴무일이면 밀기)·"오전 발송" 표현. 공휴일 하드코딩 → `shipping_holidays` 테이블+화면 관리 승격(2026 공휴일 19일 시드)
- **v5.9.130 (#73)**: 휴무일 **기간 등록**(최대 31일·연속일 한 줄 묶음 표시) + **안내 문구**(넣으면 그 기간 주문의 발송안내가 문구로 대체 — 명절 마감은 계산이 아니라 화면 운영으로 흡수)
- **v5.9.131 (#74·#75)**: bot_products.**shipping_guide**(LMS 장문 안내문)+판매현황 탭 편집 열·시드 19품목·`{{내일요일}}`/`{{모레요일}}` 요일 자동 치환·sendLms 뼈대. 알림톡 템플릿 2종 규격 정리 → `docs/알림톡_템플릿_문안.md`. ⚠️ **템플릿 실등록·검수 신청은 보류(#75 — 다음 주 대표 GO 사인)**
- **v5.9.132 (#76)**: 발송 안내 트리거 — 타이머 `lms_guide`(**기본 OFF**·30분, 네이버 DISPATCHED 감지→shipping_guide LMS)·`lms_guide_log`(order_key UNIQUE 중복 방지)·판매현황 탭 하단 "📨 발송 안내 이력" 섹션+수동 [발송 안내 보내기](대표 전용). 🔴 **알리고 문자 호스트 오류 발견·수정**(apisms.aligo.in → **apis.aligo.in**), testmode_yn 지원(env ALIGO_TEST=Y)

### 🔴 실발송 가동 전 대표 손작업 (순서)
① 알리고 발신프로필 등록(웹 — 채널 검색용 ID+관리자 카카오톡 인증번호→senderkey) ② 알림톡 템플릿 등록·검수(4~5일 — **#75 보류 해제 후**) ③ 알리고 포인트 충전(알림톡 6.5원+대체문자 8.4~25.9원) ④ Render env 투입: `ALIGO_API_KEY`·`ALIGO_USER_ID`·`ALIGO_SENDER_KEY`·`ALIGO_SENDER`·`ALIGO_TPL_CODE`·`ALIGO_TPL_CODE_RESERVE`·`KAKAO_NOTIFY=on` ⑤ 타이머 ON
- 검증 순서 제안: 타이머 `lms_guide` ON(그대로 dry-run) → 이력에 문면 쌓임 → 문안 검수 → `ALIGO_TEST=Y` 리허설 → `KAKAO_NOTIFY=on`

### 자사몰 신축 프로토타입 (`C:\Users\전승범\OneDrive\문서\제주아꼼이네 플랫폼\` — git 리포 아님·로컬 보존)
- `home.html`(v1 배민 노랑톤) / `home_v2.html`(v2 회사프로그램 인디고 스킨) / **`index_v3.html`(최신 — 배민 뼈대+기존 리뉴얼 자산 7종+신규 기능 자리 5종)** / `index.html`·`products.html`·`product.html`·`calendar.html`·`my.html`·`roulette.html`(룰렛 실동작) / `전환_아키텍처_설계서.md` / `기존자산_분석.md`
- **아키텍처 권장안 = (c) 하이브리드**: 몰=상품·결제·회원 / 게임·물방울·귤나무=독립 웹앱(Render) / 보상은 카페24 Admin API로 쿠폰·적립금. (b) 독립 전면은 **카페24에 일반 앱용 주문 생성 API 부재로 구조적 불가**(공식 확인). 신규 API 12종·테이블 5종 목록은 설계서 §2-1
- ⚠️ 기존 리뉴얼 폴더(`★제주아꼼이네 자사몰 홈페이지 리뉴얼`) **무수정 유지** — 발견 2건 미조치: ①깨진 이미지(로고·아꼼이·체험장 4장)는 git HEAD에 살아있어 `git checkout -- images/` 한 줄로 복구 가능(대표 지시 대기) ②미사용 릴스 3편(비바람·트렁크SNS·청귤풋귤 62MB) 즉시 가용

### 내일 재개 시 첫 작업 후보
① 자사몰 3차(index_v3 기준 나머지 페이지에 리뉴얼 자산 이식·기존 리뉴얼 이미지 복구 여부 결정) ② 알림톡 템플릿 검수 신청(#75 보류 해제 시) ③ 발송 안내 dry-run 실검증(타이머 ON→문면 검수) ④ 실서비스 API 12종 설계·시공 착수 ⑤ scenarios.js 폴백 정리(백로그)
- **폴더 정리**(별도 코워크 세션): 낱개 자료 → `_참고자료/`(gitignore됨) 이동·README 기록. .gitignore에 `_참고자료/`·`NCP인증키/` 추가 커밋(a92381c). 코드·docs·디자인 폴더는 무이동.
- 백업 체계(7/26 완성): ①배포 시 강제 ②일일 07:00 스케줄러 ③로테이션 B정책 ④복구 절차서 `docs/DB복구절차.md`. ⚠️ .cmd 한글 주석 금지(CP949). 시즌 시한부 시나리오 38·44(청귤 특가)는 특가 종료 또는 9/15에 갱신/OFF 필요.
- ✅ 대표 확인 잔여 2건 모두 완료(7/28): ①Render 워크스페이스 플랜 = Hobby·**PITR 복구창 3일 확정**(Recovery 화면 실측, `docs/DB복구절차.md` 기재) ②OneDrive/Render **2단계 인증 설정 완료**(대표 직접).

## ★ 진행 중: 문의시나리오 DB 통합 (2026-07-25, v5.9.55)

- **[B] 타이머의 목적 재정의(대표)**: 송장변환·중간발주는 수기 버튼 유지. 타이머는 ①고객문의 자동답변 ②정산 아침 자동수집용. 진행 순서 확정: ①문의시나리오 DB 통합 → ②정산 수집(아침 9:30~10시 + 오후 7~8시, 화면에서 변경 가능) → ③네이버 상품문의 수집+자동등록(쓰기 — 중계서버 허용목록 추가 필요). 문의 수집 주기 30분.
- **①단계 완료(v5.9.55 배포됨)**: `inquiry_scenarios` 테이블 + 톡톡봇 시나리오 **47건 이관**(46+영업시간외, 바이트 일치 검증) + [문의 관리] 화면(직원 편집 가능, 삭제·전체스위치 대표 전용) + 봇 조회 API `GET /api/scenarios`(env `SCENARIO_API_TOKEN` Bearer, 미설정 시 503 잠김).
- **톡톡봇**(`C:\Users\전승범\OneDrive\문서\★제주아꼼이네 톡톡봇`, 별도 리포): `scenario-store.js`(5분 캐시·폴백) 커밋됨, **push는 대표가 직접**(마지막 1회). `SCENARIO_SOURCE=code`(기본)→검증 후 `db` 스위치. 비교 스크립트 `scripts/compare-scenarios.js` 47/47 일치 확인됨.
- **대표 실행 절차**: `docs/문의시나리오_전환절차.md` (토큰 생성→Render env 2곳→봇 push→스위치→체크리스트).
- 설계/계획: `docs/superpowers/specs/2026-07-25-inquiry-scenario-db-design.md`, `docs/superpowers/plans/2026-07-25-inquiry-scenario-db.md`. 진행 원장: `.superpowers/sdd/progress.md`.
- ⚠️ 영업시간외 문구(0번)는 현재 봇이 미사용(코드에 import만 존재) — 화면 수정해도 봇 영향 없음, 재활성화는 별도 작업.
- **품목별금액→판매현황 자동 연동 (v5.9.57 배포됨)**: pricing 저장(POST/PUT) 시 새 품목명이 bot_products에 **'준비중'(봇 미노출)·판매가 빈칸**으로 자동 등록(`syncPricingToBotProducts`, ON CONFLICT DO NOTHING — 삭제 품목 부활 금지). 판매가는 수기 세팅 후 [판매중] 전환 시 노출. 결제가·판매가는 이름만 공유(금액 복사 금지). 탭2 수동 [품목 추가] 버튼 제거(유입 일원화, POST API·복구 로직은 존치). 백필 19개 준비중 등록됨.
- **판매현황·가격 탭 (v5.9.56 배포됨)**: `{{가격표}}`/`{{판매현황}}` 원본 = `bot_products`(회사프로그램과 **같은 DB**, 36건) → [문의 관리] 탭2에서 관리(저장 → 봇 1분 캐시 반영, 봇 무수정). ⚠️ **스마트스토어 판매가 — '품목별 금액'(거래처 결제가)과 절대 통합 금지.** 톡톡봇 정리 커밋(시드 하드코딩 제거·deleted_at 필터·PRODUCTS_PAGE 게이트) push 완료. ✅ **구 /products·/unmatched 페이지 은퇴 종결(7/28)** — Render `PRODUCTS_PAGE=off`·`UNMATCHED_PAGE=off` 적용·410 실측 확인. 시나리오는 **db 스위치 완료·실응답 정상**(대표 확인).
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
- **현재 버전: v5.9.74 / app.js 캐시 v=278** (2026-07-26 기준 — 배포 전 `version.js`·`index.html` 실값 재확인, 병행 세션이 올렸을 수 있음).
- ⚠️ **병행 세션 주의**: 같은 작업폴더에서 세션 2개가 동시에 커밋하면 배포 준비 `git add`에 상대 세션의 미커밋 변경이 쓸려 들어감(2026-07-26 실사례 — 무해 확인 후 병합 배포). **핵심 로직 작업 2개가 겹칠 땐 반드시 따로 배포**(대표 확정 원칙). 배포 직전 `git log`·`git status`로 상대 세션 커밋 확인.
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

### 4-0. ✅ [B] 자동수집 타이머 — 완료 (v5.9.60 배포, 2026-07-25)
- 60초 틱 스케줄러(한 틱 1개 실행·몰림 방지), 수집기: 정산(하루1회 09:30 앵커·스냅샷+텔레그램)/주문(신규 결제 건수 알림)/취소·반품(**claimType/claimStatus로 판정** — lastChangedType 아님!·알림만)/문의(**pay-user/inquiries 파라미터 문서 미확정 — '지원 예정' 스텁**, 켜면 실패 표시). 전부 기본 OFF·설정은 naver_auto_collect(DB)·[데이터관리] 타이머 카드에서 관리.
- last-changed-statuses는 more.moreFrom/moreSequence 페이지네이션 필수(1회 상한 ~300건).
- **대표 확정: 송장변환 직전 취소 재확인 넣지 않음**(취소·반품은 배송준비 무관 — 취소는 PAYED 자동 이탈). 안전장치 = [자동 불러오기]가 항상 실행 시점 신규 조회. 타이머 수집분은 현황·통계용(변환 재사용 금지).
- 문의시나리오 DB 통합·판매현황 탭 이전·품목별금액 연동은 CLAUDE.md 상단 "★ 진행 중" 절 참조 (전부 완료·배포됨).

### 4-1. [B] 타이머 자동수집 (스마트스토어) — 다음 작업
- **전부 기본 OFF**, 화면에서 on/off + 주기(분) 변경 가능(**코드에 주기 하드코딩 금지**). `naver_auto_collect` 테이블 사용(이미 생성·시드됨: settlement 1440, order 60, claim 90, inquiry 30, 전부 OFF).
- 주기(제안): 정산 하루1번(1440분), 주문 60분, 문의 30분.
- **취소·반품 = 알림만**(대표가 (B)안 선택): 취소/반품 요청 들어오면 텔레그램 알림만. 자동처리 X.
- **🔴 "송장변환 직전 취소·반품 재확인" 기능은 넣지 말 것**(대표 지시로 제거됨): 반품은 배송준비에 없고, 취소는 PAYED에서 자동 이탈해 이미 필터로 빠짐. 취소는 대표 수기 확인.
- 네이버 **초당(token bucket) rate limit** 대비 실행 시각 분산(stagger). 일일한도 아님.
- 실패 시 텔레그램 알림(회사프로그램의 기존 텔레그램 사용).
- 변경 감지엔 `GET /external/v1/pay-order/seller/product-orders/last-changed-statuses`(PII 없음) 활용 가능.

### 4-2. 🛒 쿠팡 송장변환 연동 — ✅ 완료·검증 통과 (2026-07-26, v5.9.70 태그로 배포)
- **대표 검증 완료**: 키 입력(NCP) → 연결 3줄 초록불 → 자동 불러오기(3일 조회·발주서 1건) → 통합변환 → **수기 Wing 다운로드 변환과 완전 동일 대조 확인**. 취소 재확인·부분취소 공식 탑재.
- 지시문 `지시문_쿠팡_송장변환_연동.md` v2 기준. 스펙 `docs/superpowers/specs/2026-07-26-coupang-invoice-design.md`(공식 문서 확정 — v5 ordersheets/INSTRUCT·v6 returnRequests/cancelType=CANCEL·HMAC CEA·**수량=shippingCount−(hold+cancel)**).
- 중계서버 `/coupang`(조회 2종만·vendorId 강제·RELAY_VERSION 2026-07-26.1 — **install.sh 재실행 필요**), 회사프로그램 `callCoupang`+수집기+연결테스트+취소재확인, [쿠팡 자동 불러오기] 버튼. 변환 로직·네이버 코드 무수정.
- 대표 절차: `docs/쿠팡_키입력_절차.md` (SSH 키 입력 → 연결테스트 → 실주문 검증 체크리스트 §⑥ — 부분취소·보내는사람연락처 대조 포함). 키 만료 2027-01-21, 재발급 일정 2027-01-07 자동 등록.

### 4-3. 🏠 카페24(자사몰) 송장변환 연동 — ✅ 완료·검증 통과 (2026-07-26, v5.9.73) — **3채널 완성**
- **3채널 완성** (스마트스토어·쿠팡·자사몰). 스펙 `docs/superpowers/specs/2026-07-26-cafe24-invoice-design.md` (공식 문서 전 스펙 확정 — 추측 없음).
- 구조: **IP 제한 없음 → Render 직접 호출**(중계서버 불필요). 신규 모듈 `cafe24.js` + server.js 라우트 4종(`/api/cafe24/auth-url`·`/api/cafe24/callback`(공개, state 검증)·`/api/agent-office/cafe24/test`·`/api/agent-office/cafe24/invoice-orders?days=1~90`).
- OAuth: Authorization Code, mall `akkome`, Client ID `mMdlm3cHGZwkVaem7wGDIB`(공개값, 코드 상수), scope `mall.read_order`. **Secret = Render env `CAFE24_CLIENT_SECRET`**(대표 직접 입력, 열람 금지). 토큰 AES-256-GCM 암호화 저장(`agent_office_config` 'cafe24_tokens', 키=sha256(Secret)) — Secret 변경 시 재승인 1회. access 2h/refresh 2주, 만료 60초 전 자동 갱신(**동시 갱신 락** — 갱신 시 refresh도 교체되므로 필수). 갱신 실패 → 텔레그램 1회 + "재승인 필요".
- 취소 방어: akkome 몰은 **결제 즉시 N20(배송준비중) 자동 진입**(발주확인 없음) → **품목 단위 `items[].order_status==='N20'`만 채택**(취소신청 품목은 C코드로 변경돼 자연 제외) + **수량 = quantity − claim_quantity**(0 이하 제외). 반품 로직 없음.
- **대표 검증 결과 (2026-07-26)**: ①②Secret 입력·[동의]·연결 테스트 🟢 ③**9건 자동 불러오기→변환→수기 대조 완전 동일 — 통과**(옵션 표기 포함, 매핑 조정 불필요) ④취소 제외 — 몰 구조상 취소신청 시 배송준비중에서 즉시 이탈 → 실행 시점 조회로 충분, 탑재된 품목 필터+수량 차감은 **이중 안전벨트로 유지** ⑤토큰 자동 갱신은 오후 4:23 이후 재불러오기로 확인 예정(유일한 잔여 확인 — 실패 시 [연결 테스트]에 "재승인 필요" 표시됨).

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
| 🎨 디자인 가이드 (**디자인 작업 전 필독**) | `디자인/디자인_가이드.md` — 인디고 테마 확정·토큰·공통 컴포넌트·노랑 리테마 금지 |
| 버전 | `version.js` (현재 v5.9.50), `public/index.html` app.js 캐시(현재 v=258) |

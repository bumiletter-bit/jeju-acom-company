# 다채널 알림톡 확장 설계 (#401 — 쿠팡·자사몰) — 2026-08-24 대표 GO

## 대표 확정 사항
- 쿠팡 = (a) **주문안내 + 발송안내 둘 다** (안심번호라 알림톡 불가 → **LMS 직행**)
- 자사몰(카페24) = 알림톡 정상 (실번호 실측 확인). 카페24 자체 자동 SMS는 꺼져 있음(대표 확인 — 중복 없음)
- 회원가입 환영(D)도 가동 + **가입 혜택 문구를 문면에 추가**(신규 템플릿 검수 필요)
- **모든 규칙 네이버와 동일**: 8~9시(출고일) 자동 발송 보류(hold-0809) · 발송휴무 달력(computeShipping·isShipDay·arriveOff) · 예약 판정 · 번호 가드 · 마스킹 저장(원번호 미저장·재조회 방식)
- 자사몰은 발주확인 개념 없음(결제 즉시 N20) — 상태 변경 액션 0 (읽기 전용)

## 실측 확정 사실 (설계 근거)
1. **쿠팡 연락처 = 안심번호(safeNumber·0505)** — 알림톡 불가. 기존 `isBadTel`이 050을 차단하므로 쿠팡 경로는 **알림톡 시도 없이 `sendLms` 직행**(050 허용 예외는 쿠팡 경로 한정).
2. **카페24 주문 buyer.cellphone = 실번호**(orders API embed=buyer 실측 — 결과 즉시 삭제). 알림톡 정상 경로.
3. **카페24 스코프에 mall.read_privacy 없음** → 가입 환영(D)의 신규 회원 감지(customersprivacy) 불가 — **대표 재동의 1회 필요**. 수집기는 시공하되 403이면 "권한 대기"로 무해 대기.
4. **품목 매칭**: 기존 `matchNotifyProduct` = bot_products.name 그대로 includes — 자사몰(「·」 구분)·쿠팡 옵션 문자열엔 미매칭. → **`matchNotifyProductLoose` 신설**(1차 exact includes → 2차 이름 토큰 전부 포함 시에만·후보 다수면 최장 — 오매칭>미매칭 원칙 준수). **네이버 경로는 종전 함수 유지(무회귀)**.
5. 쿠팡 발송 감지 = ordersheets `status=DEPARTURE` (동일 endpoint·릴레이 ALLOW 변경 불요). 카페24 발송 감지 = orders items의 `tracking_no + shipped_date`.

## 구조 (전부 additive — 네이버 파이프라인 무수정)
- **수집기 5종 신설** (naver_auto_collect 시드·기본 OFF):
  - `cafe24_notify`(3분): 최근 2일 주문(embed=items,buyer) → 신규(key `c24:{order_id}`) → 취소·입금전 품목 제외(N2x만) → hold-0809 → A/B 알림톡. 주문 단위 1통(품목 여러 개 = 「첫 품목 외 N건」).
  - `cafe24_guide`(30분): 최근 7일 주문 → items tracking_no+shipped_date → 신규(key `c24:{order_id}`) → E 알림톡(sendShippingGuideAlimtalk — 상품코드·송장 변수).
  - `coupang_notify`(10분): ordersheets ACCEPT+INSTRUCT 최근 2일 → 신규(key `cp:{orderId}`) → hold-0809 → **A/B 문면 그대로 LMS**.
  - `coupang_guide`(30분): ordersheets DEPARTURE 최근 7일 → 신규 → **LMS**(품목 매칭 시 shipping_guide 렌더, 미매칭 폴백 = E 문면 기반 + guide/track URL 텍스트).
  - `welcome_notify`(30분): customersprivacy 최근 2일 가입(read_privacy 필요 — 403이면 대기) → 신규(key `join:{member_id}`) → D 알림톡.
- **채널별 실발송 게이트** `notify_channel_mode` {c24, cp, join: 'dry'|'live'} — **기본 dry**. 전역 KAKAO_NOTIFY가 이미 ON이므로 새 채널은 이 게이트를 통과해야 실발송(문면 검수 → 대표 GO → live 전환).
- **이력 재사용**: kakao_notify_log(주문안내·가입)·lms_guide_log(발송안내) — order_key 프리픽스로 채널 구분. 화면에 채널 배지. 네이버 풀번호 재조회는 네이버 키만(프리픽스 키 제외). hold 수기 발송([오늘/내일])은 프리픽스별 재조회 분기(c24=orders?order_id · cp=기간 조회 후 orderId 필터).
- **D2 템플릿**(가입환영2 — 혜택 문구+MD 문의하기): `templates_welcome2` 세트 신설 → 러너 set='welcome2' 등록·검수. 승인 전엔 기존 D(UJ_9086) 사용. 혜택 문구는 실설정 1:1(#346-c 대표 캡처 확인분): 가입 축하 쿠폰 2,000원(14일)·물방울 5개(로그인 시 자동)·생일 쿠폰 2,000원.

## 가동 절차 (발송 파이프라인 신중 원칙)
① 시공·배포(타이머 OFF) → ② 타이머 ON + 채널 dry(실발송 0·문면만 이력에 축적) → ③ dry 문면 검수 보고 → ④ **대표 GO 후 채널별 live 전환** → ⑤ 첫 실발송 결과 보고.

## 검증
- 로컬: 실코드 블록 추출 실행(hold 판정·loose 매칭·문면 조립·050 가드) — 단위.
- 배포 후: dry 수집 실가동 → 이력에 쌓인 실문면 검수(실주문 데이터) → 무회귀(네이버 이력·발송 계속 정상·이력 화면).

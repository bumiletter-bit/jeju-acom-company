# #467 룰렛 당첨 쿠폰 — 자동 발급 + 발급 안내 알림톡 + 만료 7일 전 안내 (설계 · 대표 GO 2026-09-23)

## 대표 확정 사항
- 발급 시점 = **당첨 즉시 자동**(서버 추첨·이용권은 배송완료 주문 기준 → 부정 여지 없음). 실패 시 미지급으로 남기고 텔레그램(종전 문구)으로 사람에게.
- 문안 2장 = 보고 초안 그대로(발급 안내 · 만료 안내). 버튼 = [채널 추가(AC)] [쿠폰함 바로가기(WL)] [문의하기(MD)].
- 범위 = **5%·10% 쿠폰만**. 귤박스·업그레이드 이용권은 종전대로 수동(텔레그램 안내 유지).
- 만료 안내 = 만료 7일 전 **1회**, 카페24 발급 이력에서 미사용 확인된 건만.

## 규정 근거
카카오 알림톡 심사 가이드: "이벤트 참여, 쿠폰 다운로드 등 이용자의 적극적인 행위에 따라 발급된 쿠폰의 발급·소멸 안내"는 정보성. 단 "이용촉진 목적으로 과도한 불편 초래 금지" → 사실 통지 위주·만료 안내 1회.

## 흐름
1. `POST /api/mall/pub/spin` 당첨(coupon5/coupon10) → `reward_grants` pending 행(RETURNING id) → 응답 뒤 `onRewardGrant({grantId, member, prize})` 비동기 호출(server.js 주입).
2. `rouletteAutoGrant(grantId)`:
   - 정의 고정(`ROULETTE_COUPON`: coupon5 → 6086230051600000967 · coupon10 → 6086272594000000984, env 덮어쓰기 가능) → `GET /coupons?coupon_no` 검산(R형·할인율 일치·미삭제).
   - 보유 전 n → `POST /coupons/{no}/issues`(M · 회원 1명 · 보유 중이면 allow_duplication T) → 보유 재조회(6s·30s·60s·120s) n+1 확인 → `GET /coupons/{no}/issues`에서 issue_no·expiration_date 취득.
   - `reward_grants` UPDATE: status granted · granted_by '자동(룰렛 당첨 즉시 발급 #467)' · coupon_no · issue_no · issued_at · expires_at + audit.
   - 실패: grant_error 기록 · pending 유지 · 텔레그램 종전 문구 + 사유.
3. 발급 안내 알림톡 `rouletteCouponNotify(grant,'issue')`:
   - 연락처 = `GET /orders?member_id&embed=buyer`(최근 180일·최신 주문) → buyer.cellphone·name. DB 저장은 마스킹만.
   - 채널 게이트 `notify_channel_mode.coupon` (없음/dry = 문면만 기록 · live = 실발송). 템플릿 코드 = env `ALIGO_TPL_CODE_COUPON_ISSUE`/`_EXPIRE` 또는 `APPROVED_TPL` 기본값(승인 후 투입).
   - 이력 = `kakao_notify_log` order_key `coupon:{grantId}`(발급) · `coupon-exp:{grantId}`(만료) — UNIQUE로 중복 발송 원천 차단. product_name '룰렛 당첨 쿠폰 발급 안내'/'룰렛 쿠폰 만료 안내'. order_at = 당첨 시각.
   - `reward_grants.notify_issue_status/at` 기록. 텔레그램: 「🎡 [룰렛 당첨 · 자동 발급 완료] … 발급안내 sent/검수중」.
4. 만료 안내 타이머 `coupon_expire_notify`(하루 1회 · 앵커 10:00 KST · 기본 ON):
   - granted + kind coupon* + issue_no 있음 → 정의별 `GET /coupons/{no}/issues` 1회 조회 → issue_no 매칭: used_coupon T → `used_at`·`used_order_id` 갱신(사용 표시).
   - 미사용 · `expires_at − now ≤ 7일` · `> 0` · `notify_expire_status IS NULL` → 만료 안내 발송(연락처 재조회) → 기록. 남은일수 = ceil.
5. 화면:
   - 당첨 지급 탭: 「쿠폰·알림」 칸(발급안내/만료안내 상태·만료일·사용됨·만료 미사용) + 미지급 쿠폰 행에 [🎫 발급+안내] 버튼(`POST /api/agent-office/reward-grants/:id/grant` = 자동 실패 시 재시도). 기존 [지급완료] 수동 표시 유지.
   - 알림 발송 이력: 채널 필터 「🎡 룰렛」(`ch=coupon` → order_key `coupon:`·`coupon-exp:`) + 플랫폼 배지 + 템플릿 라벨.
   - 타이머 카드: `🎡 룰렛 · 쿠폰 만료 7일 전 안내 (10:00)` ch:'coupon'(검수중/실발송 자동 표기).

## DB (additive)
`reward_grants` += coupon_no TEXT · issue_no TEXT · issued_at TIMESTAMPTZ · expires_at TIMESTAMPTZ · used_at TIMESTAMPTZ · used_order_id TEXT · notify_issue_status VARCHAR(20) · notify_issue_at TIMESTAMPTZ · notify_expire_status VARCHAR(20) · notify_expire_at TIMESTAMPTZ · grant_error TEXT.
`naver_auto_collect` += ('coupon_expire_notify', true, 1440, run_at_time '10:00').
백필 `scripts/apply-467-backfill.js`: 기존 id 3·4·6·7(쿠폰 4건)의 coupon_no·issue_no·issued_at·expires_at·used_at(id 3 = 9/19 주문).

## 무회귀 경계
- 기존 알림톡 4채널 코드 무접촉(새 함수·새 order_key 프리픽스·새 타이머 키만 추가). `notifyChannelLive('coupon')`은 키가 없으면 false = dry.
- mall-api spin: INSERT에 RETURNING id 추가 + onRewardGrant 미주입 시 종전 텔레그램 문구 그대로.
- 템플릿 JSON: 새 세트 `templates_roulette`(기존 세트 무변경) · registerTemplates set='roulette'.

## 검증
- `verify-467-unit.js`: 발급 함수(cafe24 스텁 — 정의 불일치 중단·n+1 미확인 시 미표시·중복 idem)·문면 조립(변수 치환·금지 문자)·만료 판정(D-7 포함·D-8 제외·사용됨 제외·만료 지남 제외·중복 0)·연락처 선택(최신 주문).
- `verify-467-ui.js`(로컬 실서버·실렌더): 당첨 지급 탭 칸·버튼(PUT/POST 가로채기) · 이력 채널 필터 API·배지 · 타이머 라벨 · 기존 채널 무회귀.
- 배포 후: 10분 뒤 템플릿 등록 러너(set 'roulette' · audit true) → tpl_code 기록 → 승인 시 env 투입 + `notify_channel_mode.coupon='live'`(대표 GO).

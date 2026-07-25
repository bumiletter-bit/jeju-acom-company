# 네이버 자동수집 타이머 — 설계문서

> 작성 2026-07-25 · 대표 승인 (주문 타이머 = 신규 건수 알림만 확인됨)
> 요구 원문: 정산 하루1번(9:30~10시)/주문 60분/취소·반품 90분/문의 30분 · 전부 기본 OFF · 주기 DB저장+화면변경 · 데이터관리에 "자동수집 타이머" 신설(마스터+개별+마지막 수집 표시) · 송장변환 직전 취소 재확인(핵심 안전장치) · rate limit·시각 분산 · 실패 텔레그램 · 재시작 복원

## 0. 배경 (확인된 사실)

- `naver_auto_collect` 테이블 기존재(key PK, enabled, interval_min, last_run_at, last_status) — settlement 1440/order 60/claim 90/inquiry 30, 전부 OFF 시드 완료.
- 중계서버 허용목록: **GET 읽기 전체 허용**(`pay-settle/`, `pay-order/seller/`, `pay-user/`, `seller/`) — 이번 작업의 모든 호출이 허용 대역. install.sh 재실행 불필요.
- 문의 조회 = `GET /external/v1/pay-user/inquiries` (개발자포럼 #2166 실사용 확인 — pay-user 대역). 세부 파라미터는 구현 시 문서/포럼으로 확정(추측 금지, probe 금지).
- 변경 감지 = `GET /external/v1/pay-order/seller/product-orders/last-changed-statuses` (PII 없음, 연결테스트에서 이미 사용 중).
- 429 대응 패턴(`callWithRetry`+350ms), `notifyTelegram`, `naverRelay`, `writeAudit` 재사용.
- 송장변환 rows에 `_pid`(productOrderId) 보존 — 취소 제외 필터에 사용 가능.
- 📌 CLAUDE.md의 기존 "송장변환 직전 재확인 넣지 말 것" 지시는 **이번 대표 지시로 대체** — 불러오기~변환 사이 시간차에 발생한 취소를 거르는 것이 목적. CLAUDE.md 갱신 포함.

## 1. DB

```sql
ALTER TABLE naver_auto_collect ADD COLUMN IF NOT EXISTS run_at_time VARCHAR(5);  -- 정산 실행 시각 (KST 'HH:MM')
ALTER TABLE naver_auto_collect ADD COLUMN IF NOT EXISTS last_error TEXT;
UPDATE naver_auto_collect SET run_at_time = '09:30' WHERE key = 'settlement' AND run_at_time IS NULL;
CREATE TABLE IF NOT EXISTS naver_settle_snapshot (
    id SERIAL PRIMARY KEY, from_date DATE, to_date DATE, count INTEGER,
    elements JSONB, collected_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS naver_inquiries (
    inquiry_id VARCHAR(50) PRIMARY KEY, raw JSONB, answered BOOLEAN,
    collected_at TIMESTAMP DEFAULT NOW());  -- 향후 자동답변(3번 프로젝트) 재료
```
- 체크포인트(주문/취소 감지 기준 시각)는 `agent_office_config` 키 `naver_order_checkpoint` / `naver_claim_checkpoint`.
- 기본 주기 시드는 기존 값 유지(전부 OFF) — 코드에 주기 하드코딩 없음.

## 2. 스케줄러 (직접 구현)

- `setInterval` 60초 틱 1개. 틱마다: ①in-flight 잠금(이전 실행 중이면 스킵) ②relay 미설정이면 스킵 ③enabled 행 중 **가장 오래 기다린 1개만** 실행(시각 분산·동시 몰림 차단).
- due 판정: settlement = `run_at_time` 앵커(오늘 KST 그 시각 지났고 last_run_at이 그 이전이면 due) / 나머지 = `now - last_run_at >= interval_min`.
- 실행 후 `last_run_at=now, last_status='ok'|'fail', last_error` 기록. 실패 시 `notifyTelegram` 1회(수집기명+사유).
- 설정이 전부 DB → 재시작해도 ON 유지, 재시작 직후 밀린 수집은 다음 틱에 자연 실행.

## 3. 수집기 4종 (직접 구현 · 전부 읽기 전용)

| 키 | 동작 |
|---|---|
| settlement | 일별정산(daily) **최근 3일** 조회 → `naver_settle_snapshot` 저장(오래된 스냅샷 30개 초과분 삭제) → 텔레그램 "🛰️ 정산 자동수집: MM-DD~MM-DD N건 수집 — 데이터관리에서 확인" |
| order | last-changed-statuses(체크포인트 이후)에서 `PAYED` 변경 건수 → 0건이면 무알림, 있으면 텔레그램 "🛰️ 신규 주문 N건" → 체크포인트 갱신 |
| claim | 같은 API에서 lastChangedType에 CANCEL/RETURN/EXCHANGE 포함 건수 → 있으면 텔레그램 "⚠️ 취소·반품·교환 변화 N건 — 판매자센터 확인" (알림만, 자동처리 X) |
| inquiry | `pay-user/inquiries` 신규분 → `naver_inquiries` upsert(inquiry_id 중복 제거) → 신규 N>0이면 텔레그램 "💬 새 문의 N건". 문의 내용(PII 가능)은 DB만, 텔레그램엔 건수만 |

- 모든 호출은 `callWithRetry`(429 백오프)와 호출 간 350ms 간격 준수.
- inquiry 파라미터가 문서와 다르면: 구현 단계에서 포럼 확인 → 확정 불가 시 inquiry만 '지원 예정' 상태로 두고 나머지 3종 먼저 배포(부분 배포 허용).

## 4. 송장변환 직전 취소 재확인 (직접 구현 — 핵심 안전장치)

- 서버: `GET /api/agent-office/naver/canceled-since?since=ISO` (adminOnly) — last-changed-statuses(since~now)에서 CANCEL/RETURN 계열 `productOrderId` 목록 반환(PII 없음).
- 프론트: `loadNaver()` 성공 시 로드시각·네이버발 플래그 기록 → **[통합 변환 및 다운로드] 클릭 시** 네이버발 데이터면 위 API 호출 → `invoiceDataSmart`에서 해당 `_pid` 행 제외 → "🛡️ 그 사이 취소 N건 자동 제외" 표시(0건이면 조용히 통과). **convertDataSmart 무수정** — 입력 배열만 필터.
- API 실패 시: 변환은 그대로 진행 + "취소 재확인 실패(수동 확인 권장)" 경고 표시(변환을 막지 않음 — 가용성 우선).
- 중간발주는 적용 제외(집계 성격 — 필요 시 추후).

## 5. 화면 — [데이터관리] "⏱️ 자동수집 타이머" 카드 (위임 구현)

- 위치: `#naver-connect-card` 바로 아래 새 카드(관리자만 — 데이터관리 자체가 admin 전용). [연결 테스트] 버튼 무변경.
- 마스터: [전체 ON] [전체 OFF] 버튼. 개별 4행: 이름 · ON/OFF 토글 · 주기(분) 입력(정산은 실행시각 HH:MM 입력) · 마지막 수집 시각 · ✅성공/❌실패(실패 사유 툴팁/텍스트).
- API (전부 adminOnly + audit): `GET /api/agent-office/naver/auto-collect` / `PUT /api/agent-office/naver/auto-collect/:key` {enabled?, interval_min?(5~1440), run_at_time?('HH:MM')} / `PUT /api/agent-office/naver/auto-collect-all` {enabled}.

## 6. 하지 말 것

- 쓰기(발송처리·답변등록) 호출 금지 — 전부 읽기 전용. 발주확인·발송처리·취소 처리는 대표 수기.
- 주기·시각 하드코딩 금지(DB만). 기본 OFF 변경 금지.
- convertDataSmart·naverFetchInvoiceOrders 수정 금지(재확인은 입력 필터만).
- 네이버 정산 데이터를 세미(거래처 결제가) 정산과 합치지 않는다.

## 7. 배포

- v5.9.60 / app.js 캐시 v=267 / CHANGELOG. 배포는 대표 확인 후. 중계서버 작업 불필요.

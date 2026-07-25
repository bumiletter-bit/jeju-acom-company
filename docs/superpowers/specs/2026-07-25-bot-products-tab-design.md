# 판매현황·가격 관리 이전 — 설계문서 ([문의 관리] 탭2)

> 작성 2026-07-25 · 대표 승인 완료 (설계안 + 핵심 확인 2가지: 봇 조회 deleted_at 필터 포함, /products 은퇴는 PRODUCTS_PAGE env 스위치)
> 선행 조사: `bot_products`는 **회사프로그램과 동일 PostgreSQL DB**(봇 Render 서비스가 DATABASE_URL 공유), 36건.
> **대조 결과: 코드 시드 36건(가격표20+품절12+청귤SKU4) = DB 36건 완전 일치** — 시드 제거 시 데이터 손실 0.

## 0. 배경 (확인된 사실)

- `{{가격표}}`/`{{판매현황}}` 원본 = `bot_products` 테이블 (name UNIQUE, status 판매중/품절/시즌종료, price TEXT, memo, updated_at). 봇 `products-store.js` `getStoreStatus()`가 1분 캐시로 읽어 치환.
- 현재 관리 = 봇의 `/products?key=ADMIN_KEY` 페이지 (가격·상태 수정은 무배포 반영).
- 함정: `SOLDOUT_DEFAULTS`(12)·`PREORDER_PRODUCTS`(4)·`DEFAULT_PRODUCTS`(20) 시드가 `ensureTable()`에서 매번 자동 재등록 + `청귤(풋귤)` 행 상시 DELETE → **화면에서 삭제해도 부활**, 시즌 전환마다 코드 수정+배포 필요했음.
- ⚠️ 이 가격표 = **스마트스토어 판매가**. 회사프로그램 '품목별 금액'(거래처 결제가)과 절대 합치지 않는다.

## 1. 화면 — [문의 관리] 탭 구조 (별도 메뉴 없음)

- `#page-inquiry` 상단 탭 2개: **[시나리오]** (기존 47건 화면 그대로) / **[판매현황·가격]**
- 탭2:
  - 헤더: "🏷️ 스마트스토어 판매가" 라벨 + 안내문 "품목별 금액(거래처 결제가)과 다른 데이터입니다. 저장하면 톡톡봇 답변에 1분 내 반영됩니다."
  - 목록 행: 품목명 / 상태 토글 3버튼(판매중·품절·시즌종료) / 가격 입력 / [저장] / [삭제](대표 전용) — 정렬: 판매중→품절→시즌종료, 이름순 (기존 /products와 동일)
  - 상단 [+ 품목 추가] (품목명·가격, 직원 가능)
- 수정 이력 카드: 활성 탭에 따라 시나리오 이력 / 판매현황 이력 표시
- 미리보기: 탭2에는 불필요 (목록 자체가 봇 표시 형태와 유사) — YAGNI

## 2. DB — 기존 테이블에 컬럼만 추가 (데이터 이동 없음)

- 회사프로그램 initDB: `ALTER TABLE bot_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ` + `ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)` (기존 36건 무영향; 테이블 자체는 봇이 이미 생성함 — `CREATE TABLE IF NOT EXISTS` 동일 DDL 포함해 순서 무관하게)
- soft-delete = `deleted_at` 세팅. 물리삭제 금지.
- 같은 이름 재추가 시 soft-delete 행 **복구+덮어쓰기** (name UNIQUE 대응): INSERT ... ON CONFLICT (name) DO UPDATE SET deleted_at=NULL, status/price 갱신.

## 3. API (회사프로그램, 기존 패턴)

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/api/agent-office/bot-products` (미삭제 전체) | 직원 가능 |
| POST | `/api/agent-office/bot-products` `{name, price?, status?}` | 직원 가능 |
| PUT | `/api/agent-office/bot-products/:id` `{status?, price?, name?}` | 직원 가능 |
| DELETE | `/api/agent-office/bot-products/:id` (confirm, soft) | **대표 전용** |
| GET | `/api/agent-office/bot-product-logs` (audit 최근 100) | 직원 가능 |

- status 허용값 ['판매중','품절','시즌종료']. 모든 변경 audit_logs (targetType `bot_product`, source `bot-product`, updated_by 기록).
- 봇 캐시가 1분이므로 별도 무효화 불필요.

## 4. 봇 정리 배포 1회 (`products-store.js`) — 이중 상태 → 스위치

1. **제거**: DEFAULT_PRODUCTS·SOLDOUT_DEFAULTS·PREORDER_PRODUCTS 상수와 자동 등록 루프, `청귤(풋귤)` DELETE 줄. `ensureTable()`은 CREATE TABLE IF NOT EXISTS만 유지 ("삭제해도 부활" 함정 박멸 — 대조 완전 일치 확인됨).
2. **추가**: `getStoreStatus()`·`/products` 목록 쿼리에 `WHERE deleted_at IS NULL` — 단, 컬럼이 아직 없을 수 있으므로 CREATE TABLE에 deleted_at 포함 + (안전) `ALTER TABLE ... ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`를 ensureTable에 포함.
3. **추가**: `/products` 관리 페이지 라우트에 **`PRODUCTS_PAGE` env 게이트** — `off`면 410 안내("회사프로그램 [문의 관리] > 판매현황·가격 탭으로 이전됨"), 기본(미설정·on)이면 기존대로. `/unmatched`(문의 로그)는 게이트 대상 아님(계속 유지).
4. 배포·push는 **대표가 직접**. 검증 통과 후 Render에서 `PRODUCTS_PAGE=off` (배포 아님).

## 5. 검증 (완료 기준)

- 탭2에서 가격 수정 → 1~2분 내 톡톡 "가격" 질문 답변에 반영
- 상태를 품절로 → {{판매현황}}에 품절 표시
- 삭제(대표) → (봇 정리 배포 후) 봇 답변 목록에서 사라짐 + 서버 재시작에도 부활 안 함
- 같은 이름 재추가 → 복구되어 다시 표시
- audit 이력 기록 · 기존 /products 페이지는 스위치 전까지 정상
- 기존 기능(시나리오 탭·품목별 금액·정산 등) 무영향

## 6. 주의 (하지 말 것)

- '품목별 금액'(pricing)과 데이터·화면·API 어느 것도 합치지 않는다.
- 봇 응답 로직·치환 로직(applyStorePlaceholders 등) 수정 금지 — 이번에도 데이터 관리 위치만 이전.
- 시나리오 탭(기존 47건 화면) 동작 변경 금지 — 탭 래핑만.
- 정리 배포 전까지 /products 페이지 유지 (이중 상태).

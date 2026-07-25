# 품목별 금액 → 판매현황 자동 연동 — 설계문서

> 작성 2026-07-25 · 대표 승인 (노출 시점 = "가격 세팅 후 노출" 선택)
> 요구: 품목별 금액(pricing, **결제가**)에 새 품목 추가 시 [문의 관리] 판매현황(bot_products, **판매가**)에 **같은 품목명**으로 자동 등록. 판매가는 빈칸(수기 세팅). 두 금액은 절대 통합 금지 — 이름만 공유.

## 1. 동작

- `POST /api/pricing`·`PUT /api/pricing/:id` 저장 성공 직후 `syncPricingToBotProducts(items, actor)` 호출.
- items[].name 중복 제거 → 각 이름을 `INSERT INTO bot_products (name, status, price, updated_by) VALUES ($1,'준비중','','품목별금액연동') ON CONFLICT (name) DO NOTHING`.
  - **ON CONFLICT DO NOTHING** → 기존 품목·soft-delete된 품목은 절대 건드리지 않음(직원이 삭제한 품목이 주간 단가 등록으로 부활하지 않음).
  - 새로 등록된 행만 audit_logs (action `auto_add`, source `pricing-sync`).
  - 연동 실패해도 품목별 금액 저장은 정상(try/catch 내부 격리).
- **'준비중' = 봇 미노출 상태**: 봇 statusText/priceText는 판매중·품절·시즌종료만 표시 → 봇 코드 무수정으로 자동 미노출. 직원이 판매가 입력 + [판매중] 클릭 시 노출 시작.
- **백필 1회**: 오늘 유효한 pricing(오늘이 기간에 포함) 품목명을 같은 로직으로 등록(컨트롤러 로컬 스크립트 실행).

## 2. 상태값 확장

- 서버 `BOT_PRODUCT_STATUSES` = ['준비중','판매중','품절','시즌종료'] (생성 기본값은 판매중 유지).
- 목록 정렬: 준비중(작업 필요) → 판매중 → 품절 → 시즌종료 → 이름순.
- 탭2 UI: 상태 토글 4버튼('준비중' 포함) + 준비중 행에 "가격 미세팅 · 봇 미노출" 배지. 안내문에 연동 설명 1줄 추가.
- 톡톡봇 /products 구 페이지(미push 커밋에 포함): STATUSES에 '준비중' 추가(이중 상태 기간 일관성 — 준비중 행 저장 무시되는 버그 방지). 봇 답변 로직 무수정.

## 3. 배포

- 회사프로그램 v5.9.57 / app.js 캐시 v=264 / CHANGELOG. 배포는 대표 확인 후.
- 톡톡봇: 기존 미push 커밋 위에 STATUSES 1줄 커밋 추가 (push는 대표, 기존 안내 그대로).

## 4. 하지 말 것

- 결제가(pricing)와 판매가(bot_products price)를 어떤 경로로도 복사·계산하지 않는다 — 이름만 공유.
- 기존 pricing 저장 로직의 응답·에러 동작 변경 금지 (훅은 부수 효과일 뿐).
- 봇 응답·치환 로직 수정 금지.

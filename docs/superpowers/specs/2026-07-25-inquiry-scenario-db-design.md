# 문의 시나리오 DB 통합 — 설계문서

> 작성: 2026-07-25 · 대표 승인 완료 (46개 전부 이관 + 영업시간외 문구 DB 관리 포함)
> 원 지시문: `지시문_문의시나리오_DB통합.md` (리포 루트)
> 관련 프로젝트 순서(대표 확정): ①본 작업 → ②[B-정산] 아침 정산 자동수집 타이머 → ③네이버 상품문의 수집+자동등록

## 0. 배경 (탐사로 확인된 사실)

- 톡톡봇 위치: `C:\Users\전승범\OneDrive\문서\★제주아꼼이네 톡톡봇` (별도 git 저장소, Render 별도 서비스, GitHub push 시 자동배포).
- 시나리오 원본: 톡톡봇 `scenarios.js` — **46개** (지시문의 "19개"는 작성 시점 기준. 실서비스는 46개) + `afterHoursResponse`(영업시간 외 문구) 1건.
- 답변문구에 `{{가격표}}` / `{{판매현황}}` 치환 태그 존재 — 발송 직전 봇이 실데이터로 치환(`ai-handler.js` `applyStorePlaceholders`). **태그 원문 그대로 이관**한다.
- 시나리오 소비처 2곳:
  1. `scenarios.js`의 `findScenario()` 키워드 매칭 (scenarios 배열 사용)
  2. `ai-handler.js` — 시나리오 **전체를 Claude 시스템 프롬프트에 삽입**하고 AI가 제목으로 선택 (129행 `scenarios.map(...)`, 190·234·244행 제목 매칭). → DB 전환 시 **캐시 갱신 때 프롬프트 문자열도 재구성**해야 함. 응답 로직 자체는 무수정.
- 봇의 `PRODUCT_KEYWORDS`(품목 분류), 딜레이 30초, 이모티콘, 판매현황 관리 페이지(`/products`)는 **이번 작업 범위 밖 — 건드리지 않는다.**

## 1. DB 테이블 (회사프로그램 PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS inquiry_scenarios (
    id SERIAL PRIMARY KEY,
    scenario_no INTEGER NOT NULL,          -- 번호 = 현재 배열 순서(1~46). 0 = 영업시간 외 자동응대
    name VARCHAR(100) NOT NULL,            -- 시나리오명 (원문 그대로)
    keywords JSONB NOT NULL DEFAULT '[]',  -- 키워드 배열 (원문 그대로)
    response TEXT NOT NULL,                -- 답변문구 ({{가격표}}/{{판매현황}}/(예시) 줄 포함 원문 그대로)
    action VARCHAR(20) NOT NULL DEFAULT '자동응답',  -- 자동응답 | 담당자연결
    enabled BOOLEAN NOT NULL DEFAULT true, -- 사용여부
    channel VARCHAR(20) NOT NULL DEFAULT '톡톡',     -- 톡톡 | 상품문의 | 공통
    updated_by VARCHAR(50),                -- 수정자 (로그인 계정명)
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP                   -- soft-delete (물리삭제 금지)
);
```

- **영업시간 외 자동응대** = `scenario_no 0`, `name '영업시간 외 자동응대'`. 봇은 이 번호로 찾아 쓴다. 키워드는 빈 배열(키워드 매칭 대상 아님).
- **전체 자동응답 ON/OFF**(대표 전용 스위치)는 `agent_office_config` 키 `inquiry_auto_reply` (기본 `on`). OFF면 봇 조회 API가 빈 목록 대신 `{auto_reply:"off", scenarios:[...]}`로 플래그를 내려주고, 봇은 시나리오 응답을 중단하고 기존 "담당자 연결" 흐름만 수행.
- 채널 필드로 향후 **네이버 상품문의 자동응답이 같은 테이블 사용** (별도 화면·테이블 안 만듦).

## 2. API (회사프로그램 server.js)

### 봇 조회용 (신규 인증)
- `GET /api/scenarios?channel=talktalk`
  - 인증: `Authorization: Bearer <SCENARIO_API_TOKEN>` — 새 토큰(openssl rand -hex 32), **양쪽 Render 환경변수로만** 보관 (PUBLIC 리포에 절대 미포함).
  - 반환: `enabled=true AND deleted_at IS NULL AND channel IN ('톡톡','공통')` 을 scenario_no 순으로 + `auto_reply` 플래그 + `updated_max`(변경 감지용 최신 updated_at).
  - PII 없음(시나리오 문구뿐).

### 관리용 CRUD (기존 관리 API 패턴)
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/api/agent-office/scenarios` (삭제 제외 전체, 사용중지 포함) | 직원 가능 (authMiddleware) |
| POST | `/api/agent-office/scenarios` (추가) | 직원 가능 |
| PUT | `/api/agent-office/scenarios/:id` (수정·개별 ON/OFF) | 직원 가능 |
| DELETE | `/api/agent-office/scenarios/:id` (soft-delete) | **대표 전용** (adminOnly) |
| PUT | `/api/agent-office/scenarios-auto-reply` (전체 ON/OFF) | **대표 전용** |

- 모든 변경 audit_logs 기록 (source: `inquiry-scenario`, actor = 로그인 계정 → `updated_by`에도 저장).
- 수정 이력 조회: 기존 audit_logs 조회 API 재사용 (targetType `inquiry_scenario` 필터).

## 3. 마이그레이션 (STEP 2)

- 마이그레이션 스크립트는 **로컬 PC에서 1회 실행** (`node scripts/migrate-scenarios.js`) — Render 서버에는 톡톡봇 폴더가 없으므로, 로컬에서 톡톡봇 `scenarios.js`를 **require로 직접 읽어** 원격 DB(DATABASE_URL — `npm run deploy`의 DB 백업과 동일한 접속 방식)에 46개 + afterHours 1건을 그대로 INSERT (문구 재타이핑 금지 — 복사 오류 원천 차단).
- 스크립트는 **테이블이 비어 있을 때만** 실행(중복 실행 방지, 이미 데이터 있으면 중단·안내). 실행 후 `번호·이름·키워드수·문구 md5` 대조표를 만들어 대표 확인.
- 이관 시 `action='자동응답'`, `channel='톡톡'`, `enabled=true` 일괄. (담당자연결 동작은 이관 후 화면에서 지정 가능)

## 4. [문의 관리] 화면 (STEP 3 — 유일한 조정 창구)

- 사이드바 **CS처리방과 데이터관리 사이** [문의 관리] 신설. 톡톡봇 전용 메뉴는 만들지 않는다.
- UI는 **품목 마스터 화면 패턴 재사용**:
  - 목록: 번호 · 시나리오명 · 채널 · 동작 · 사용여부(토글) · [수정] / 상단 [+ 새 시나리오]
  - 편집: 시나리오명 / 키워드(쉼표 구분 입력) / 답변문구 / 동작 / 채널 / 사용여부 → [저장] 즉시 반영
  - 미리보기: 저장 전 "고객에게 이렇게 보입니다" (개행·이모티콘 렌더, {{태그}}는 태그 그대로 표시 + '발송 시 실데이터로 치환됨' 안내)
  - 안내문: "답변문구에 고객 개인정보(이름·연락처·주소)를 넣지 마세요"
  - 수정 이력: 누가 언제 뭘 바꿨는지 (audit_logs)
- 권한: 추가·수정·개별 ON/OFF = 직원(민주·승협) / 삭제·전체 자동응답 ON/OFF = 대표 계정만 (버튼 자체를 권한별 표시).

## 5. 톡톡봇 전환 (STEP 4 — 무중단 원칙)

전환 순서 (지시문 그대로 — 어느 순간에도 손님 응답 공백 없음):
1. **이중 상태**: 봇에 `scenario-store.js` 신설 — 시작 시 + 5분 캐시로 `GET /api/scenarios` 호출. 기존 하드코딩 `scenarios.js`는 그대로 둔 채 DB 읽기만 추가.
   - 안전장치: API 실패 → **마지막 성공 캐시로 계속 동작**. 캐시조차 없는 최초 기동 실패 → 하드코딩 폴백(전환기) + 텔레그램 알림 1회.
   - `ai-handler.js`의 시스템 프롬프트 시나리오 블록은 캐시 갱신 시 재구성 (프롬프트 캐시 구간 설계 유지).
   - 봇 환경변수 추가: `COMPANY_API_URL`, `SCENARIO_API_TOKEN`.
2. **비교 검증**: 47건(46+영업시간외) 전부 "하드코딩 답 vs DB 답" 자동 diff 스크립트 — 문구 1바이트라도 다르면 실패 목록 출력.
3. 전부 동일 확인 후 **DB를 정답으로 스위치** (env 플래그 `SCENARIO_SOURCE=db`).
4. 며칠 안정 확인 → 하드코딩 제거 (별도 커밋).
- 톡톡봇 git 배포는 **대표가 마지막 1회** 실행. 이후 문구 수정은 화면 저장 → 5분 내 자동 반영, 배포 불필요.

## 6. 검증 (STEP 5)

- 화면에서 문구 1건 수정 → 5분 내 톡톡봇 실응답 반영 확인
- 새 시나리오 추가 → 봇 인식 확인
- 시나리오 OFF → 해당 응답 중지 확인
- 전체 자동응답 OFF(대표) → 봇 시나리오 응답 전면 중지 확인
- audit_logs 수정 이력 확인
- 기존 기능(품목·정산·송장변환·AGENT OFFICE·네이버 연동) 무영향 확인

## 7. 완료 보고 항목 (지시문 4절)

1. 테이블 구조 + API 목록
2. 마이그레이션 47건 대조표
3. 화면 위치 안내
4. 톡톡봇 양쪽 비교 검증 결과
5. 대표가 마지막으로 실행할 톡톡봇 배포 절차 (이후 배포 불필요 명시)

## 8. 하지 말 것 (지시문 3절 재확인)

- 봇 응답 로직(딜레이 30초, 이모티콘, 이미지+텍스트 동시수신, 매칭 알고리즘) 수정 금지 — 데이터 출처만 교체.
- 시나리오 문구 "개선" 금지 — 있는 그대로. 개선은 이후 직원이 화면에서.
- 검증 통과 전 기존 하드코딩 제거 금지.
- 시크릿(SCENARIO_API_TOKEN)을 코드/커밋에 넣지 않는다 (양쪽 리포 모두 PUBLIC 취급).

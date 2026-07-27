# DB 복구 절차 — "DB가 날아갔을 때 이 순서대로"

> 작성 2026-07-26 (대표 지시 — DB 유실 대비 점검). 침착하게 위에서부터 순서대로.
> 전제: **스키마(테이블 구조)는 백업에 없어도 됨** — 서버가 켜질 때 initDB(CREATE TABLE IF NOT EXISTS)가 자동 생성한다. 백업 파일은 "데이터 전체"만 담는다.

## 0. 백업이 어디 있나

- 폴더: `C:\Users\전승범\OneDrive\문서\제주아꼼이네_DB백업\`
  - `backup_v5.9.NN_YYYYMMDD.sql` — **배포할 때마다** 자동 생성 (배포는 백업 성공 없이는 진행 불가)
  - `backup_weekly_YYYYMMDD.sql` — 주간 백업 (작업 스케줄러)
- 이 폴더는 **OneDrive 동기화** 폴더 → PC가 죽어도 OneDrive(클라우드)에 사본이 있다.
  PC를 잃어버린 경우: 다른 PC에서 OneDrive 로그인 → 같은 폴더에서 백업 파일 확보.
- 보조 수단: **Render Postgres 자체 복구(PITR)** — 유료 인스턴스는 최근 며칠(워크스페이스 플랜에 따라 Hobby 3일 / Pro 7일)의 아무 시점으로 되돌릴 수 있다. Render 대시보드 → 해당 Postgres → Recovery 메뉴. (지원팀 문의도 가능)
- **우리 인스턴스 (2026-07-28 대표 대시보드 확인·확정)**: 이름 "제주아꼼이네 프로그램" · PostgreSQL **18** · Singapore · **Basic-256mb**(256MB RAM·0.1 CPU·1GB 스토리지, 13.58% 사용) · HA 없음 · Service ID `dpg-d6hp71t6ubrc73bvugsg-a`. **PITR 복구창 = 3일 확정** (Recovery 화면 "past 3 days" 실측 — Hobby 워크스페이스. Pro 업그레이드 시 7일). 논리 백업(Export)은 플랜 무관 7일 보관. → 3일보다 오래된 시점 복구는 우리 자체 백업(배포 시마다 + 매일 07:00, OneDrive)으로 — 이쪽이 주 수단.

## 1. 상황 A — DB는 살아있는데 데이터가 잘못됐다 (실수 삭제·오염)

가장 흔한 경우. 두 가지 길 중 하나:

**A-1. 로컬 백업으로 복원 (특정 백업 시점으로)**
```
cd C:\Users\전승범\OneDrive\문서\★제주아꼼이네 회사프로그램
node scripts/db-restore.js backup_v5.9.NN_YYYYMMDD.sql --yes
```
- ⚠️ 기존 데이터를 **전부 지우고**(TRUNCATE) 그 백업 시점으로 덮어씀 — 백업 이후의 입력은 사라진다.
- 실행 전에 현재 상태를 한 번 백업해두면 후회가 없다: `node scripts/db-backup.js 복구전스냅샷`
- `--yes` 없이는 실행되지 않는다(실수 방지 안전장치).

**A-2. Render PITR로 복원 (백업 파일보다 최신 시점이 필요할 때)**
- Render 대시보드 → Postgres 인스턴스 → **Recovery** → 원하는 시각 선택 → 복구 인스턴스 생성
- 복구 인스턴스 확인 후, 서비스들의 DATABASE_URL을 그쪽으로 교체 (아래 3-② 참조)

## 2. 상황 B — DB 인스턴스 자체가 사라졌다 (삭제·만료·리전 장애)

1. **Render에서 새 PostgreSQL 인스턴스 생성** (대시보드 → New → PostgreSQL)
2. 새 인스턴스의 **Internal/External Database URL** 복사
3. **DATABASE_URL 교체 — 3곳**:
   - Render **회사프로그램**(jeju-acom-company) 환경변수
   - Render **톡톡봇**(같은 DB를 공유한다!) 환경변수
   - 대표 PC 로컬 `.env` (백업·복원 스크립트가 이걸 쓴다)
4. **회사프로그램을 먼저 1회 재시작** → 서버가 켜지면서 initDB가 빈 DB에 테이블 전부 생성
5. 로컬에서 복원 실행:
   ```
   node scripts/db-restore.js backup_최신파일.sql --yes
   ```
6. 톡톡봇 재시작 (스키마 일부는 봇도 생성하지만 4번에서 대부분 만들어짐)

## 3. 복구 후 확인 체크리스트

- [ ] 로그인 되나 (users 복원 확인)
- [ ] [문의 관리] 시나리오 50건·판매현황 목록 보이나
- [ ] 정산관리·품목별 금액 최근 데이터 보이나
- [ ] 톡톡봇 `/health` 응답 + 시나리오 응답 정상 (5분 내 캐시 갱신)
- [ ] 카페24 연결 테스트 — 토큰은 DB에 있으므로 복원되면 그대로 살아있음. 오래된 백업(2주+ 전)이면 refresh 만료 → [연동 승인] 1회
- [ ] 자동수집 타이머 설정(ON/OFF·주기) 확인
- [ ] 데이터가 이상하면 다른 날짜 백업으로 1번 절차 반복

## 4. 시크릿은 백업과 별개다 (중요)

백업 파일에는 **환경변수(시크릿)가 들어있지 않다** — 유출 방지로는 좋지만, 복구 때는 따로 챙겨야 한다:
- Render 회사프로그램 env: DATABASE_URL, JWT_SECRET, TELEGRAM_*, NAVER_RELAY_*, CAFE24_CLIENT_SECRET, SCENARIO_API_TOKEN 등
- Render 톡톡봇 env: DATABASE_URL, ANTHROPIC_API_KEY, NAVER_TALK_AUTHORIZATION, SCENARIO_* 등
- NCP 중계서버 `/opt/akkome-relay/.env`: 네이버·쿠팡 키 (DB와 무관 — DB 유실에 영향 없음)
- Render env는 대시보드에서 보이므로, **Render 계정 자체를 잃는 경우가 최악** — Render 계정 2단계 인증 권장.

## 5. 평시 점검 (분기 1회 권장)

- 백업 폴더에 최근 날짜 파일이 있는지 (배포가 뜸하면 주간 백업이 돌고 있는지)
- 아무 백업 파일이나 열어 `INSERT INTO users` 줄이 있는지 눈으로 확인
- 이 문서가 최신 구조와 맞는지

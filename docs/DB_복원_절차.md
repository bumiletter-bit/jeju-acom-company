# DB 복원 절차 (초안 · #1291 · 2026-11-25)

> 배포 때마다 만드는 백업(`scripts/db-backup.js` → OneDrive `제주아꼼이네_DB백업/backup_<버전>_<날짜>.sql`)으로 DB 를 되살리는 순서.
> 🔴 복원은 그 DB 의 **모든 표를 비우고** 백업 시점으로 덮는다. 대표 결정 없이 실DB 에 돌리지 않는다.
> 비밀값(접속 주소·비밀번호)은 이 문서·대화·커밋에 적지 않는다 — 환경 변수로만 넘긴다.

## 0. 먼저 알 것

- 백업 파일 = **자료만**(TRUNCATE → 표마다 INSERT → 시퀀스 복구). **표 틀(CREATE TABLE)은 없다.** 표 틀은 회사프로그램 서버의 initDB 가 만든다.
- 복원 = `node scripts/db-restore.js <파일> --yes` · 한 트랜잭션(하나라도 실패하면 전부 되돌림 · DB 는 시도 전 그대로).
  - 큰 파일(512MB 넘음)도 흘려 읽음(#1288) · 외래 키는 잠시 내렸다가 끝에 다시 걸며 전 줄 검사(#1288).
  - 부분 백업(`BACKUP_TABLES`)·「표 백업 실패」 줄이 든 파일은 거절한다(#1291) → 그 앞 백업 파일로.
  - 시작 때 「🎯 대상 DB: 호스트:포트/DB이름」이 찍힌다 — **이 줄이 맞는 DB 인지 반드시 눈으로 확인.**
- 🔴 **파일 꼴 두 가지**
  - **새 꼴(#1291 배포 뒤 만든 파일)**: 그대로 복원된다(로컬 실자료 규모 시험 = 107표 214,932줄 · 다시 백업하면 바이트 같음).
  - **옛 꼴(#1291 이전 · 11/24 v5.9.853 까지)**: 그대로는 **안 된다** — ①jsonb 안 숫자·문자열 값이 날것(`agent_office_config` 15줄 안팎) ②생성 칸(`delivery_shipments.phone_digits`·`buyer_digits`)이 INSERT 에 들어 있음 ③배열(`order_memo_entries.tags`)이 JSON 꼴. 옛 꼴을 써야 하면 총괄에게 — 시험 때 쓴 「사본 손보기」 길(#1288 보고)로 사본을 만들어 넣는다. ①의 문자열 `"5"` 같은 값은 옛 꼴에서 이미 숫자와 구분이 사라져 숫자로 돌아온다.
  - 512MB 이하 옛 파일(11/19 v5.9.830 이전 일부)은 예전 복원 스크립트로도 읽혔지만 ①~③ 과 외래 키 순서 탓에 역시 실패한다.

## 1. 자료만 잘못된 경우 (DB·표 틀은 살아 있음)

1. 대표 결정 받기 — 어느 백업 시점으로 되돌릴지(그 뒤 들어온 주문·기록은 사라진다).
2. 🔴 **회사프로그램 서버를 멈춘다(세운다)** — Render 에서 서비스 Suspend. 돌고 있으면 타이머·러너가 복원 중인 표에 쓰기를 섞는다.
3. 지금 상태도 한 번 더 백업(`node scripts/db-backup.js 복원전`) — 되돌릴 길.
4. 복원: `node scripts/db-restore.js backup_<버전>_<날짜>.sql --yes`
   - 「🎯 대상 DB」 줄 확인 → 「✅ 복원 완료」까지(실자료 규모 로컬 38초 · Render 256MB DB 는 더 걸릴 수 있음).
5. 대조: 표마다 `count(*)` = 백업 파일의 `-- <표> (N건)` 줄 숫자.
6. 서버 다시 켜기 → 로그인·발주 메모함·최종발주 화면 스모크.

## 2. DB 가 통째로 사라진 경우 (새 DB 에 틀부터)

1. Render 에서 새 PostgreSQL 생성 → 접속 주소는 **환경 변수로만**(.env·코드에 넣지 않음).
2. **표 틀 만들기** — 🔴 **지금 서버 그대로는 빈 DB 에 틀을 다 못 만든다.** initDB 가 아직 없는 표를 먼저 참조해 그 자리에서 멈추고, 다시 켜도 같은 자리에서 멈춘다(로컬 실측 = 맨 앞에서 `users` 없음 → 14표에서 멈춤 · `users` 를 먼저 만들어 줘도 `message_logs` 없음 → 70표에서 멈춤).
   - 시험 때 된 길 = 로컬에서 서버를 「initDB 까지만」 기동하되 「없는 표·칸」 오류(42P01·42703·42704)를 넘기며 **2번** 돌림 → 1회차 84 → 2회차 87표(initDB 몫 전부). 외부 연결은 막고 listen 직전에 끝냄. 이 기동 도구는 저장소에 없다(#1288 시험 도구) → 4절 「--init」 이 1순위.
   - 실서비스 서버로 이 단계를 하지 않는다(타이머·외부 발송이 돌 수 있음) · 실서비스는 6단계에서 켠다.
3. **initDB 밖 표·칸** — 처음 쓸 때 만드는 것들(아래 표). 서버를 잠깐 써서 만들거나 같은 DDL 을 한 번에 넣는다.

   | 표·칸 | 만드는 곳 |
   |---|---|
   | talk_outbox | desk-inbox.js |
   | inbox_thread_drafts · inbox_thread_reads · (message_logs·naver_qnas·naver_inquiries 의 reviewed_at·reviewed_by·staff_at·posting_at) | inbox-threads.js |
   | response_preview_log | response-head.js |
   | mail_index(+snippet) | naver-mail.js |
   | push_subscriptions · notifications.pushed_at | push.js |
   | tax_invoice_seen | scripts/desk/invoice-month.js |
   | lucky_events · lucky_assets | lucky-event.js |
   | lucky_events_ro*·_v943·_vhead_assets·_vtest_assets | 검증 스크립트가 실DB 에 남긴 시험 표(lucky-event.js 와 같은 틀) |
   | message_logs.image_url · image_meta | 톡톡봇 저장소 server.js |
   | unmatched_messages | 지금 코드에 없음(옛 표 · 비어 있음 · `id SERIAL PRIMARY KEY` 만 있으면 됨) |

4. **틀 대조** — 백업의 TRUNCATE 줄에 적힌 표 이름이 새 DB 에 다 있는지 · 각 INSERT 의 칸 이름이 다 있는지. 하나라도 없으면 복원이 그 자리에서 실패(롤백)하니 틀부터 채운다.
5. **자료 넣기** — 1절 4~5 와 같다(새 꼴 파일).
6. 서버 환경 변수 `DATABASE_URL` 을 새 DB 로 → 서버 켜기 → 스모크 · 타이머 첫 틱 확인.

## 3. 하지 말 것

- 서버가 돌고 있는 채로 복원.
- 부분 백업·「백업 실패」 줄이 든 파일로 복원(스크립트가 거절함 — 우회하지 말 것).
- 실백업 파일을 저장소·공유폴더에 복사(손님 정보) — 시험은 로컬 임시 DB 에서, 끝나면 DB 와 사본을 지운다.

## 4. 남은 일(후보)

- 🔴 1순위: 빈 DB 용 `--init`(2절 2~4단계를 한 명령으로) 또는 백업에 표 틀도 싣기(pg_dump --schema-only 또는 information_schema 로 CREATE 문 만들기). 지금은 DB 가 통째로 사라지면 틀 만들기가 사람 손·시험 도구에 기댄다.
- initDB 순서 정리(빈 DB 에서 1번에 다 만들어지게 · `users`·`message_logs` 를 참조하는 표보다 먼저).

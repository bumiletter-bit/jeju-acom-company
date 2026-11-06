# #1039-C 체험 예약(플레이스) 번호 미입력 → 어사이드 자동 읽기·저장 설계서

> 🔴 **결정 변경**: 11/3 대표 결정(메모리 feedback-experience-phone-owner-saves = 「번호를 읽어 대표에게 알려 주고 저장은 대표」)과 10/30 결정(jeju-aside-browser = 「플레이스 예약 자동 매칭은 안 함 · 재제안 금지」)을 **대표 11/6 「체험예약도 자동으로 확인하고 입력하도록」이 바꾼다.** 이 구도가 배포되면 위 두 메모리를 고친다(총괄 몫).
>
> 작성 = 워커2(11/6) · 문서만 · 코드 0 · DB 쓰기 0 · 어사이드 조작 0. 줄 번호는 11/6 HEAD(504b626) 기준(1절 · 시공 전).

## 0. #1040-A 시공 결과(11/6 · 대표 「고」 · 아래 2~7절 설계와 다른 곳은 이 절이 정본)

- **대표 결정**: ① 서버 API 길(나) ② 미리 알림 없음 = 대조 통과면 바로 저장 + 접수 알림톡 ③ 실패 알림 = 기존 텔레그램(대표) ④ 같은 번호가 다른 예약에 있어도 저장·발송(가족 예약 · `dup_ids` 기록만) ⑤ **번호 = 이용고객(방문자) 먼저 · 없거나 꼴 틀리면 예약자** = `experience.js` `PHONE_PICK_ORDER` 한 곳(VM 은 두 칸을 읽은 대로 보냄 · 고르지 않음).
- **인증 = DB 설정**(env 아님): `agent_office_config` 키 `experience_auto` = `{enabled, token(32자↑), daily_max:30, hours:[8,21], skip:['09:25','09:45']}`. 설정·토큰 없음 = 503(잠김 · 배포 직후 기본) · 토큰 틀림 = 401 · enabled false = 403. 값 넣기 = 총괄(배포 뒤 UPDATE + audit). 실패 횟수·알림 표식 = 같은 표 키 `experience_auto_miss`(오늘 것만 남김 · 새 표 0).
- **서버(experience.js · 기존 PATCH·타이머·수집 무변경)**: `GET /api/experience/auto/todo`(place · confirmed · date_ok · 오늘 이후 · 시간 있음 · 번호 없음 · contact_at 없음 · 실패 30분 안·하루 6번 넘은 id 뺌 · 한 번 20줄 · 시간 창·하루 상한 거름 · 응답에 번호 0) · `PUT /api/experience/auto/:id`(autoCheck = 예약번호·화면 「확정」·DB confirmed·날짜·시간·가린 이름 글자·번호 꼴 · 통과 = phone·name(화면 전체 이름)·contact_at·contact_by `aside-auto` → audit `experience_phone_auto`(끝 4자리 · seen 값 · dup_ids) → `sendRecvNow` · 실패 400 {reason} · 이미 번호 409 · 하루 상한 429) · `POST /api/experience/auto/:id/miss`(audit `experience_phone_auto_miss` + 텔레그램 건당 하루 1회 · id 0 = 보안 확인·로그인 멈춤 · 사유의 번호 꼴 숫자는 지움).
- **VM(scripts/vm/exp-phone-auto.js)**: `--once` 한 틱(작업 스케줄러 「아꼼이-체험번호-자동」 10분 · 등록 도구 = 워커1 install-exp-phone-auto.js) · `--dry` 읽기만 · `--force-window` · .env `EXP_AUTO_API`·`EXP_AUTO_TOKEN`(main 안에서 dotenv 먼저 · DATABASE_URL 안 씀) · `ASIDE_EXE` · 종료 코드 0/2/1 · 6분 넘으면 남은 줄 다음 틱 · 잠금 `~/.akkome/exp-phone-auto.lock`(15분) · 로그 = stdout(작업 도구가 파일에 붙임 · 번호 끝 4자리).
- **화면 판독(parseRow)** 세 꼴 차례: ① 표 머리글 칸(이용고객|이용자|방문자 / 예약자|예약고객|신청자 / 이용일시 / 상태) ② 줄 안 낱말 「이용고객 홍길동 010-…」 ③ #997 꼴 「확정 이름 번호 예약번호 26.MM.DD HH:MM」(이 번호 = 예약자). 셋 다 아니면 저장 0 + miss 「꼴 모름」. 🔴 실화면에 이용고객 칸이 있는지 미확인 → 첫 실행은 `--once --dry --force-window` 로 읽은 칸(how·끝 4자리)을 보고 맞출 것.
- **검증**: `node scripts/verify-1040-exp-auto.js` 70/70(pglite · 포트 3458 · 실DB 0 · 발송 0) · verify-940 108/108 · ro-preload 기동 = 새 라우트 503(실DB 설정 없음 = 잠김) 확인.
- **켜는 순서(총괄)**: 배포 → `experience_auto` 설정 넣기(enabled false · 토큰) → VM .env 두 칸 → `--once --dry --force-window` 로 실화면 꼴 확인 → enabled true → 대표 번호 가짜 예약 1건 왕복(#1000 꼴).

---

## 1. 지금 흐름(실코드)

### 1-1. 플레이스 예약이 들어오는 길 = 네이버 예약 메일(IMAP)

| 단계 | 위치 | 하는 일 |
|---|---|---|
| 타이머 | `server.js:10579` `experience_place: () => EXPERIENCE.collectPlace()` · 시드 `server.js:1101`(5분) | 메일 수집 · 같은 메일 계정 잠금 묶음 `imap`(`server.js:10504`) |
| 메일 찾기 | `experience.js:498` `collectPlace()` | `SINCE <3일 전> FROM booking`(MAIL_DEFAULT `:41` · 한 틱 20통) · `experience_mail_seen` 으로 한 번만 |
| 판독 | `experience.js:154` `parsePlaceMail()` | 메일 꼴(`:151~153` 주석): 「예약자명 전\*범님」「예약번호 1384521818」「이용일시 2026.11.01.(일) 오전 10:00, 1명」「결제금액 …」 · **연락처 줄 없음 · 이름은 가려서 옴** |
| 저장 | `experience.js:473` `savePlace()` | `ext_key = 'place:' + 예약번호` · `order_no = 예약번호` · `name = 가린 이름` · `phone = null`(메일에 없음) · 새 줄 INSERT `:493` / 다시 온 메일(변경·취소) UPDATE `:487` |
| 보호 | `experience.js:487` | `contact_at IS NOT NULL` 이면 메일 재수집이 name·phone 을 **덮지 않음**(#804) |

칸(`experience.js:241~260`): `source 'place'` · `order_no` · `name` · `phone` · `visit_date` · `visit_time` · `status`(confirmed/canceled/visited/unknown) · `contact_at`(사람이 이름·번호 넣은 때) · `contact_by`(VARCHAR 60 · 넣은 사람) · `sms_recv_at`·`sms_recv_tries`·`sms_recv_try_at`·`sms_skip`.

### 1-2. 「번호 미입력」 판

- 서버 셈: `experience.js:621` `place_no_phone` = `source IN ('place','manual') AND status='confirmed' AND (phone IS NULL OR length(phone)<10) AND (visit_date IS NULL OR visit_date >= 오늘)`.
- 화면: `public/ao-exp.js:104` `noPhone(b)`(같은 조건) · `:229` 달력 머리 알약 「번호 미입력 n건」 · `:168`·`:170` 판 안 줄마다 바로 넣기(quickHtml).
- 저장 API: `PATCH /api/agent-office/experience/:id`(`experience.js:747` · authMiddleware = 로그인 직원 전부)
  - `:766~773` 이름·번호 = place·manual 만 · 번호 `^01\d{8,9}$` · **이름에 `*` 남아 있으면 400**(「박\*현님」으로 나가는 것 막음) · 저장하면 `contact_at=NOW()` · `contact_by = 로그인한 사람 이름`.
  - `:785` audit `experience_edit`(번호는 끝 4자리만).
  - `:788` **번호가 새로 들어오면 그 자리에서 `sendRecvNow(id)` = 접수 알림톡 1통**(타이머 안 기다림).

### 1-3. 접수 알림톡 조건

- 즉시 길 `experience.js:571` `sendRecvNow()`: 설정 `experience_notify.enabled` · status confirmed · date_ok·visit_date · 오늘 이후 · 아직 안 보냄 · sms_skip 없음 · 번호 10자리↑ · 접수 시간 창(recv_from~recv_to · 기본 09:00~21:00) · 하루 상한(daily_cap) 안.
- 타이머 길 `experience.js:589` `collectSms()`(키 `experience_sms` · 시드 10분 `server.js:1101`): `:598` 대상 = `(source='store' OR (source IN ('place','manual') AND contact_at IS NOT NULL)) AND status='confirmed' AND date_ok AND phone 10자리↑ AND visit_date >= 오늘 AND sms_skip IS NULL` → **플레이스는 `contact_at` 이 있어야만 나감.**
- 보내기 `experience.js:551` `sendOne()`: 줄 먼저 잡기(CLAIM · 30분 · 3번 상한) → 알림톡 UN_1894(실패면 알리고가 문자로 대체) → `sms_recv_at`·`sms_recv_via`.
- 실사례 차이: #931·#997 은 DB 로 바로 UPDATE(contact_at 같이) → 10분 틱이 보냄(늦음). 화면·PATCH 저장은 그 자리에서 보냄(대표 11/3 「바로 나가게」의 이유).

### 1-4. 워커3이 어사이드로 찾던 길(#997 실코드 · 총괄 세션 95bfc055 기록)

- `aside.exe mcp` 를 자식 프로세스로 띄워 JSON-RPC(`scripts/desk/keyword-rank.js` 의 `Aside` 클래스와 같은 꼴).
- 주소: `https://partner.booking.naver.com/bizes/1258756/booking-list-view?keyword=<예약번호>` → 6초 기다림 → `document.body.innerText`.
- 읽는 꼴(정규식): `(확정|취소|이용완료|노쇼) <이름> <01x-…번호> <예약번호> 26.<월>.<일>.… <HH:MM>` → `{st, name, phone, mo, d, tm}`.
- **예약자관리 화면은 이름을 가리지 않고 보여 줌**(메일은 「전\*범」) → 대조는 「가린 이름의 보이는 글자」 vs 「화면 전체 이름」.

---

## 2. 새 구도

### 2-1. 한 줄

**나스 VM 의 상주 스크립트(`scripts/vm/exp-phone-auto.js` 꼴 · 10분마다)가 번호 미입력 줄을 서버에서 받아 → 어사이드로 예약자관리를 읽고 → 다섯 가지가 다 맞을 때만 서버 API 로 저장 → 서버가 그 자리에서 접수 알림톡.**

### 2-2. 순서

```
VM 스크립트(10분 틱 · 어사이드 한 번에 하나)
 ⓐ GET  /api/exp-phone-auto/todo            ← 서버가 대상 목록(번호 끝 4자리 없음 · 가린 이름 · 예약번호 · 날짜·시간·인원)
 ⓑ 어사이드: booking-list-view?keyword=<예약번호> → innerText 판독(1-4 꼴)
 ⓒ 대조 5가지(2-3) 전부 맞음?
      예 → PUT /api/exp-phone-auto/:id   {order_no, name, phone, seen:{date,time,status}}
             서버가 다시 대조 → phone·name·contact_at·contact_by='aside-auto' UPDATE
             → audit experience_phone_auto → sendRecvNow(id) = 접수 알림톡
      아니오 → POST /api/exp-phone-auto/:id/miss {why}  (저장 0 · 서버가 텔레그램 1줄 · 건당 하루 1회)
```

### 2-3. 저장 전 대조(VM 이 한 번 · 서버가 한 번 더)

| # | 대조 | 맞아야 하는 것 |
|---|---|---|
| ① | 예약번호 | 화면 줄의 예약번호 == `order_no`(정확히 같음) · 화면에 그 번호 줄이 **딱 1줄** |
| ② | 상태 | 화면 「확정」 + DB `status='confirmed'`(취소·노쇼·이용완료면 저장 0) |
| ③ | 날짜·시간 | 화면 월·일·HH:MM == DB `visit_date`·`visit_time` |
| ④ | 이름 | DB 가린 이름(예: 전\*범)의 보이는 글자가 화면 이름 같은 자리에 있고 글자 수 같음 · DB 이름에 `*` 가 없으면 완전 일치 |
| ⑤ | 번호 | `^01\d{8,9}$` · 같은 번호가 **다른 날짜 다른 예약**에 이미 있으면 저장은 하되 텔레그램에 「같은 번호 다른 예약 있음」 한 줄(가족 예약 = 정상일 수 있음) |

- 동명이인: ①이 예약번호 정확 일치라 이름만으로 고르지 않음 · ③ 날짜·시간까지 맞아야 함.
- 서버 재대조는 ①②④⑤ + 「phone 이 아직 비어 있음」 + 「contact_at 없음」(그 사이 사람이 넣었으면 409 · 덮지 않음).

### 2-4. 멈춤·상한

| 경우 | 동작 |
|---|---|
| 못 찾음(목록 0줄) | 저장 0 · 메일 수집 직후일 수 있어 **처음 30분은 조용히 재시도** · 그 뒤 텔레그램 1줄 |
| 이름·날짜·상태 불일치 | 저장 0 · 텔레그램 1줄(건당 하루 1회 · 서버 표에 `notified_on`) |
| 보안 확인·로그인 화면(「보안 확인」「로그인」「자동입력 방지」 낱말 · 주소가 nid.naver.com) | **그 틱 전체 멈춤** · 텔레그램 1줄 「어사이드 네이버 로그인 필요 · 대표 폰 인증」 · 다음 틱부터 같은 낱말이면 하루 1회만 알림 |
| 같은 id 재시도 | 실패 뒤 30분 · 하루 6번까지 · 그 뒤 다음 날 |
| 하루 상한 | 저장 30건(서버가 셈 · 넘으면 todo 빈 목록) · 체험 하루 예약 수보다 넉넉 |
| 시각 | 08:00~21:00 만(알림톡 접수 창 09~21 + 아침 몰림 앞당김) · **09:25~09:45 건너뜀**(키워드 순위 09:30 어사이드) · 다른 어사이드 일이 쓰는 중이면(잠금 파일) 그 틱 건너뜀 |
| 스위치 | 서버 설정 `experience_phone_auto {enabled, daily_cap, preview}` · 꺼짐이면 todo 빈 목록(VM 은 그대로 돌아도 0) |

### 2-5. 새 서버 API(가 안 기준 · 코드는 「고」 뒤)

- 위치 = `experience.js` mount 안(체험 코드 한 곳) · 인증 = 전용 Bearer `EXP_AUTO_TOKEN`(렌더 env + VM `~/.akkome` 파일만 · 코드·커밋 0 · `SCENARIO_API_TOKEN` 꼴 `server.js:7145`) · 미설정 = 503.
- `GET …/todo` = 1-2 의 번호 미입력 조건 + `source='place'`(수기 manual 은 사람이 넣는 것이라 뺌) + `visit_date >= 오늘` + 재시도 간격·하루 상한 거름 · 응답에 번호·원문 없음.
- `PUT …/:id` = 2-3 서버 재대조 → UPDATE(phone · name = 화면 전체 이름 · contact_at · contact_by `'aside-auto'`) → audit `experience_phone_auto`(번호 끝 4자리 · 예약번호 · 대조 결과) → `sendRecvNow(id)` → `{ok, sent}`.
- `POST …/:id/miss` = 사유 기록 + 텔레그램(건당 하루 1회).
- 기존 PATCH(`:747`)·화면·collectSms 는 **무변경**.

---

## 3. 대안 비교

| | (가) VM 이 DB 직접 UPDATE | (나) VM 은 읽기만 → 서버 API 저장 **(추천)** |
|---|---|---|
| VM 에 필요한 것 | DATABASE_URL(실DB 전체 쓰기 권한) | 전용 토큰 1개(이 세 API 만) |
| 알림톡 | 10분 틱까지 기다림(#931 꼴) | 저장 그 자리에서 `sendRecvNow`(화면 저장과 같은 길) |
| 대조·기록 | 스크립트마다 따로 · audit 꼴 흩어짐 | 서버 한 곳 · `writeAudit` 같은 꼴 · 사람 동시 저장 409 |
| 이름 `*` 막기·번호 꼴 | 다시 짜야 함 | PATCH 와 같은 규칙 재사용 |
| 끄기 | VM 작업 해제만 | 서버 설정 한 칸 + VM 작업 해제(둘 중 하나면 멈춤) |
| 배포 | 0 | 서버 배포 1회 |
| 무회귀 | 실DB 쓰기 열쇠가 VM 에 감 · 칸 바뀌면 깨짐 | 새 API 3개만 · 기존 길 바이트 무변경 |

**추천 = (나)**. 배포 1회가 들지만 알림톡이 화면 저장과 같은 길로 바로 나가고, 대조·기록·끄기가 서버 한 곳이며, VM 에 실DB 열쇠를 두지 않는다.

---

## 4. 위험

| 위험 | 막는 것 |
|---|---|
| **다른 손님 번호 저장 → 엉뚱한 사람에게 알림톡** | 저장 뒤 자동 발송이라 되돌리기(번호 비우기) 전에 이미 나감 → 2-3 다섯 대조 전부 + 서버 재대조 · 「딱 1줄」 아니면 저장 0 · 첫 1주 미리 알림(5절) |
| 네이버 보안 확인·세션 만료 | 그 틱 멈춤 + 텔레그램 · 풀기 = 대표가 VM 어사이드 창에서 로그인·폰 인증(2단계 인증은 대표 폰) · 그동안은 지금처럼 「번호 미입력」 판에 남음(손해 = 알림톡 늦음뿐) |
| 화면 꼴 바뀜(네이버 개편) | 정규식 못 읽음 = 「못 찾음」과 구분해 「화면 꼴 모름」 텔레그램 · 저장 0 |
| 동명이인 | 예약번호 정확 일치가 1번 열쇠 · 이름은 보조 |
| 사람과 동시 저장 | 서버 409(contact_at 있으면 안 덮음) |
| 어사이드 한 번에 하나 | 09:25~09:45 건너뜀 · 잠금 파일 · 워커 어사이드 일 중엔 대기 |
| 알림톡 시간 밖(21시 뒤 저장) | `sendRecvNow` 가 `later:` → 다음 날 09시 collectSms 가 보냄(지금과 같음) |
| 예약 취소 직후 | ② 화면 「확정」 + DB confirmed 둘 다여야 저장 · 취소 메일이 먼저 오면 todo 에서 빠짐 |
| 개인정보 | todo 응답·로그·텔레그램에 전체 번호 0(끝 4자리만) · 이름은 가린 꼴 |

---

## 5. 검증 계획

1. **가짜 서버(pglite)**: 새 API 3개 = 대조 5가지 각각 틀린 경우 저장 0 · 409 · 하루 상한 · 토큰 없음 503 · audit 끝 4자리 · sendRecvNow 부름(가짜 kakaoNotify).
2. **판독 함수 떼어 실행**: #997·#1035 화면 innerText 꼴(가짜 글) + 취소·노쇼·두 줄·0줄·보안 확인 화면.
3. **실전 왕복 1회**(#1000 꼴): 대표 확인 뒤 대표 번호로 플레이스 시험 예약 1건 → 메일 수집 → VM 틱 → 저장·알림톡 1통 수신 → 예약 취소·줄 정리.
4. **첫 1주 미리 알림 = 대표 결정 거리**: 저장 전 텔레그램 「자동 저장 예정 · 박\*현 11/9 12:30 · 끝 4682 · 5분 안 [멈춤] 없으면 저장」(설정 `preview:true` · 멈춤 = 텔레그램 답 또는 화면 단추 · 만들면 서버에 「대기」 칸 하나 더).

---

## 6. 되돌리기

- 멈춤: 서버 설정 `experience_phone_auto.enabled=false`(즉시) 또는 VM 작업 해제 1줄(예: `schtasks /Delete /TN 아꼼이-체험번호-자동 /F` · VM 이 Windows 일 때).
- 식별: `SELECT id, order_no, contact_at FROM experience_bookings WHERE contact_by='aside-auto'` · audit `action='experience_phone_auto'`.
- 잘못 저장된 줄: 화면 [수정]에서 번호 고치기(이미 나간 알림톡은 못 거둠 → 4절 대조가 핵심).
- 코드: 새 API 3개 + 설정 키만이라 커밋 되돌리기로 기존 길 무변경.

---

## 7. 대표 결정 거리

1. (나) 서버 API 길로 할지(배포 1회) · (가) DB 직접은 비추천.
2. 첫 1주 저장 전 미리 알림(5분 기다림)을 넣을지.
3. 「못 찾음·불일치」 텔레그램을 누구에게(대표만 / 체험 담당 직원도).
4. 운영 시각 08:00~21:00 · 하루 상한 30건 · 수기(manual) 줄은 빼는 것 맞는지.
5. 「같은 번호 다른 예약」(가족 예약)일 때 저장하고 알리기 vs 저장 멈추기.
6. 배포 뒤 메모리 두 줄(11/3·10/30 결정) 고치기 = 총괄.

## 8. 미확인

- 나스 VM 에 어사이드가 깔려 로그인돼 있는지 · VM 이 Windows 인지(작업 스케줄러 vs systemd) = #1039-A(워커3) 결과.
- 예약자관리 화면 상태 낱말이 「확정·취소·이용완료·노쇼」 말고 「신청」(확정 전)도 있는지 · 결제 대기 줄 꼴.
- 예약자관리 화면에서 번호를 가려 보여 주는 설정이 있는지(지금까지 실사례는 전체 번호).
- 네이버가 같은 주소를 10분마다 열 때 보안 확인을 더 자주 띄우는지(키워드 순위 #1014 는 about:blank 길이 원인이었음 · openTab(주소) 꼴로 시작).
- 실DB 지금 번호 미입력 건수(읽기 조회 안 함 · 필요하면 총괄 지정 때 한 번).

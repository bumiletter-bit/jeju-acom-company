# #917 나스(리눅스)에서 검증 돌리기 — 실행 전 확인 목록

> 2026-10-29 · 워커1 · `scripts/verify-*.js` 222 + `_mock-*.js` 2 + `ro-preload-711.js` = 225개를 grep 으로 훑은 결과(실행 0).
> 나스 리포 `work/.env` 는 이미 있음 → 「.env 한 벌」 갈래는 풀림.

## 1. 한눈에

| 갈래 | 수 | 뜻 |
|---|---|---|
| 그대로 됨 | 96 | 가짜 서버·메모리 DB·떼어 실행 |
| .env 만 있으면 됨 | 83 | DATABASE_URL 등(나스 work/.env) · 422 는 옛 스크래치 경로라 자료 없음 |
| 고쳐야 | 45 | 리포 절대경로 35 · 대표 PC 실자료 10 · Windows 도구 2(겹침 있음) |

- #917 에서 고친 것: `verify-799-desk-end`(진짜 트리 끄기 시험 자식 = `spawnG` · 리눅스 그룹째) · `verify-428-checkout`(리포 경로 = `path.join(__dirname,'..')`) · `verify-814-tax-invoice`(python = `process.env.PYTHON || 'python'` · 520행 `LOCALAPPDATA || os.tmpdir()` 은 이미 있었음).
- 🔴 실DB 는 나스에서 돌려도 **같은 렌더 DB** 다. 아래 2절 목록은 노트북에서와 똑같이 조심한다(Playwright 한 번에 하나 · 머리 주석 먼저 · 메모리 feedback-read-verify-header-first).

## 2. 실행 전 확인 목록 — 실DB

### 2-1. 머리 주석에 「실DB 에 쓴다」 표식이 있는 것(27)

| 검증 | 메모 |
|---|---|
| 406-match · 416-unit | 옛 검증 · 리포 절대경로도 고쳐야 |
| 428-checkout | 실사이트 akkome.com 결제창(장바구니 담기·비움 · 주문 0) |
| 430-rewind | |
| 432 · 434 · 445 · 446 · 448 · 449 · 495e qnasim | 실AI 문의 시뮬 · 기록 남음 |
| 442-sync · 442b-naver | |
| 443-cheonggyul | |
| 469-desk | 시험 지시 → 끝에 soft-delete · 시험 알림 삭제 · server.js 3457 고정 |
| 503-parallel | 실창구 시험 지시(돌리지 말 것 · 10/21 실수) · tasklist |
| 506-status | |
| 570-chat-image · 570-log-image | |
| 581-morning | |
| 605-ui | |
| 610-ops · 610-selfcheck · 610-server | |
| 658-inbox | |
| 674-payslip · 687-rules | |

### 2-2. 실DB 에 접속하는데 머리 주석에 표식이 없는 것(45) — 돌리기 전에 본문을 읽고 쓰는지 가릴 것

395-juso-live · 401-unit · 412-fastload · 419-cpname · 420-giftbox · 422-boxsameday · 423-batchapprove · 424-match · 428-box · 428-match · 428-notify · 428-pricefinal · 429-cheonggyul · 431-qnasim-wide · 431-qnasim · 434-qnasim-wide · 438-chuseok-script · 440-relogin · 449-guide · 450-bot · 450-memo · 450c-coupon · 452-embed · 452-invoice-test · 457-linegutter · 460-payment-wording · 462-qnasim · 468-ui · 470-launcher · 474-inbox · 482-match · 483-botprod-group · 491-pricemap · 493-expense · 494-qnasim · 495-filter · 497-match · 502-qtycolor · 508-replay · 560-qnasim · 567-qnasim · 610-photo · 642-guide-order · 649-delivery-test-tr · lucky-event

## 3. 자주 쓰는 검증

| 검증 | 나스 | 포트 | 실DB |
|---|---|---|---|
| 508-ui A/B | .env · server.js | 3458(PORT508) | 읽기만 |
| 610-ui | 그대로 | 3461(PORT610) | 0 |
| 658-host | 그대로 | 3465·3457(PORT658H/I) | 0 |
| 900-2b | 그대로(git 필요) | 3458(PORT2B) | 0 |
| 469-desk | .env · server.js | 3457 고정 | 씀(위 2-1) |
| 568-dark | .env · server.js | 3461 | 0 |
| 428-checkout | #917 고침 | - | 실사이트 |
| 814-tax-invoice | #917 고침 · PGLITE_DIR 필요 | - | 0(pglite) |
| 775-booking · 775-exp | 그대로 | - | 0 |
| 804-ui · 808-ui | 그대로(첫 실행 1회 확인 = `file:////…` 크로미엄) | - | 0 |
| 799-desk-end | #917 고침(리눅스 그룹 끄기 실증) | - | 0 |
| ro-preload-711 | 그대로 | 3466 | 읽기 전용 |

## 4. 후보(고칠 것 · 급하지 않음)

- **리포 절대경로 34개**(428-checkout 은 고침) — `'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램'` 꼴을 `path.join(__dirname, '..')` 로 바꾸는 같은 한 줄 묶음 · 대부분 8~10월 초 옛 검증:
  395-ref · 395-ui · 397-live-cal · 399-details · 401-unit · 401c-history · 401d-signup · 402-unit · 404-timerlabels · 405-notifylog · 405b-livelabel · 406-match · 406-smoke · 407-tabs · 408-cafe24-temp · 409-safetel · 412-fastload · 414-unit · 416-unit · 417-unit · 424-match · 427-optprice-audit · 428-mall · 428-match · 428-notify · 428-orderform · 428-pricefinal · 429-cheonggyul · 429-mall · 443-mall · 444-ui · 492-opt-touch · 497-match · 534-match
  (`require(PROJ + '\\node_modules\\…')` 처럼 역슬래시로 이어 붙인 줄이 같이 있으면 그 줄도 `path.join`)
- **대표 PC 실자료 경로 10개** — Downloads·바탕 화면·톡톡봇 폴더·`_참고자료` 의 실제 파일을 읽음 → 나스엔 자료가 없어 「노트북 전용」으로 두거나 자료를 옮김: 444-parser · 444-ui · 450-bot · 452-embed · 452-invoice-test · 453-sender · 457-linegutter · 492-opt-touch · 508-replay · 539-opt-top
- **503-parallel** = tasklist(Windows) · 실창구 시험이라 나스에서도 돌리지 않음.
- **포트** — 3457 을 38개가 씀(469·468·561 은 고정). 나스 컨테이너 하나를 워커 여럿이 같이 쓰면 노트북과 같은 충돌 → Playwright 한 번에 하나 규칙 그대로.
- grep 밖일 수 있는 것: 문자열을 이어 붙여 만드는 경로의 역슬래시 · 804/808 `file:////` 실측.

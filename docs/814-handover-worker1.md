# #814 계산서 발행현황 탭 — 워커1 인수인계(2026-10-21 · PC 재부팅 직전)

화면 몫(워커1)만 적는다. 서버 계약은 `docs/814-api.md`(워커2)다. 서버 API(`/api/tax-invoices*`)는 아직 없을 수 있다. 화면은 가짜 응답으로만 검증했다.

## 끝난 것(미커밋 · node --check 통과)
- `public/index.html` +4줄
  - 정산관리 탭 줄에 `<button class="settlement-tab" data-tab="settlement-invoice">계산서 발행현황</button>`를 넣었다.
  - `</div><!-- /settlement-status -->` 뒤에 빈 칸 `<div id="settlement-invoice" class="settlement-tab-content"></div>`를 넣었다.
- `public/app.js` 약 +140줄
  - 탭 전환 핸들러(「정산관리/정산현황 탭 전환」 절)에 한 줄을 넣었다: `if (tab.dataset.tab === 'settlement-invoice' && window.siOpen) window.siOpen();`
  - 파일 맨 끝에 `#814` IIFE 묶음을 붙였다(접두사 si · `window.siOpen` · 검증용 `window._siState`).
  - API 경로는 묶음 맨 위 `SI_API` 한 곳에 있다.
    - list = `/api/tax-invoices?month=`
    - search = `/api/tax-invoices/search?q=`(전체 기간 · 300ms 뒤 호출)
    - act = `/api/tax-invoices/:id/confirm|hold|reset`. 보류는 `akmPrompt`로 이유를 받는다(필수 · 500자).
    - pdf = `/api/tax-invoices/:id/pdf`. 새 창을 먼저 열고 blob 을 채운다.
  - 화면 구성
    - 머리 = 「YYYY년 M월 계산서」 · 「n건 · 발행 합계」 · ‹ › · 검색 칸 · 거래처 칩(전체·CJ·시온·효돈·기타) · 날짜 칩(서버 `days`).
    - 본문 = 거래처 묶음 카드. 머리에 서버 값 그대로 「우리 정산 월 합계 settle_total · 계산서 합계 issued_total · 차이 diff · 원본 확인 n건」을 보여 준다(계산 0).
    - 표 칸 = 공급자(+면세/수정 · 메모 · read_note) · 작성일 · 승인번호 · 공급가액 · 세액 · 합계 · 받은 날(mail_at KST) · 상태 알약(초안 pill-wait · 확인 pill-ok · 보류 pill-off · read_status check/error = 빨간 「원본 확인」) · 할 일(확인·보류·되돌리기 = 관리자만 · PDF 열기 = has_pdf 만).
    - 확인·보류·되돌리기 뒤 달 보기는 서버를 다시 읽는다(합계·차이 다시).
- `public/styles.css` 끝에 `#settlement-invoice .si-*` 묶음 약 60줄을 붙였다(이 탭 안에서만). 폰(≤768)에서는 표 줄이 카드가 된다(data-label). 터치 44px(`(max-width:960px),(pointer:coarse)`). 월 단추 btn-nav 는 36·폰 44.

## 하다 만 것
1. 검증 스크립트 마지막 한 조합 `user_1280_light`에서 멈춘다.
   - 원인: 직원(role user) 계정은 정산관리 메뉴가 안 열려 칩 크기가 0 이다. 이는 화면 결함이 아니라 시험 설계 문제다(정산관리 자체가 관리자 메뉴인지 확인 필요).
   - 고칠 것: `%TEMP%\s767\814\t814.js`의 user 조합을 빼거나, 「메뉴가 안 열림 = 정상」으로 바꿀 것.
   - 그 앞 6조합(관리자 1280·900·390 × 밝음·야간)은 칩·날짜·월 이동·검색·확인/보류/되돌리기·PDF 새 창이 통과했다. 실패는 단추 높이 1건(btn-nav 30px)이었고, 이미 CSS 로 고쳤다. 고친 뒤 전체 재실행은 아직 못 했다.
2. 야간 화면 = `node scripts/ao-dark/gen-dark.js`(ao-dark.css 다시 만들기)를 **아직 안 돌렸다**. .si-* 는 토큰 var 를 써서 야간에서도 대체로 맞게 보였다(스크린 확인). 하지만 #B54708·#FEF3F2·#067647 등 직접 색은 야간 변환이 없다. gen-dark 를 돌린 뒤 `git diff --stat public/ao-dark.css`가 .si 줄만 늘었는지 확인할 것. 메모리 jeju-dark-mode-maintenance 규칙이다.
3. 「전/후 다른 정산관리 칸 무변경」 비교: 전(before) 스크린만 찍었다. 후(after)를 찍고 비교해야 한다.
4. 캐시 번호: index.html 의 `app.js?v=417` · `styles.css?v=130`을 총괄이 올려야 한다.

## 다음 할 일(순서)
1. 로컬 읽기 전용 서버를 띄운다: `JWT_SECRET=local798 PORT=3471 node -r %TEMP%\s767\ro-798.js server.js`(회사프로그램 폴더 · 쓰기 전부 삼킴).
2. `node %TEMP%\s767\814\t814.js`로 계산서 탭을 실클릭한다(user 조합 처리 뒤 · 기대 = 실패 0).
3. `node %TEMP%\s767\814\shots.js after`를 찍고 `before_*` 와 비교한다(정산관리·정산현황 탭 × 3폭 × 밝음·야간). 픽셀 비교는 같은 크기면 직접, 다르면 눈으로.
4. `node scripts/ao-dark/gen-dark.js` → ao-dark.css diff 확인 → 야간 다시 찍기.
5. 서버를 내린다(포트 3471 PID 지정).

## 검증 명령 · 파일
- 화면 실클릭: `%TEMP%\s767\814\t814.js`(가짜 API = page.route · 실DB 쓰기 0)
- 전/후 스크린: `%TEMP%\s767\814\shots.js before|after`
- 넣은 원본: `%TEMP%\s767\814\si.js` · `si.css` · `apply.js`(이미 적용함 · 다시 돌리면 중복 오류로 멈춤)

## 전후 PNG 경로
- 전(기존 두 탭 · 3폭 × 밝음·야간): `%TEMP%\s767\814\shots\before_settlement-main_<폭>_<테마>.png` · `before_settlement-status_…`
- 새 탭(가짜 자료): `%TEMP%\s767\814\shots\inv_admin_<1280|900|390>_<light|dark>.png`

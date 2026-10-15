# #708-DNS event.akkome.com → 회사 Render(jeju-acom-company) 전환 절차

- 작성: 워커2(claude-2d) · 2026-10-15 · 읽기·실측만(설정 변경 0)
- 대표 결정(10/15): **주소 event.akkome.com 유지** · 연결 대상을 bum-toolbox → 회사 Render 로 · **옛 추석 회차 복원 없음**
- 결과: 손님이 event.akkome.com/lucky.html 로 들어오면 **회사 DB(lucky_events)의 이벤트**가 보인다. 추석 당첨 조회(옛 사이트 6,455건)는 전환 순간부터 안 보인다(복원 없음 결정 — 회사 쪽은 새 회차 설정 전까지 코드 기본값 「9/10~9/21 고객 감사 이벤트」가 보이므로 **전환 전에 새 회차를 먼저 만들어 둘 것**, 아래 0단계).

---

## 실측값 (10/15 11:1x KST)

| 항목 | 값 |
|---|---|
| akkome.com 네임서버 | `ns1.cafe24.com` · `ns2.cafe24.com` · `ns1.cafe24.co.kr` · `ns2.cafe24.co.kr` → **DNS 관리처 = 카페24** |
| event.akkome.com 지금 | `CNAME bum-toolbox.onrender.com` |
| 바꿀 값 | `CNAME jeju-acom-company.onrender.com` |
| akkome.com 기본 TTL(SOA) | 43200초(12시간) · event 레코드 캐시는 조회 때 수 분~수십 분 남은 값으로 보였음 |
| 회사 서버에 Host: event.akkome.com 으로 요청 | **403**(Render 가 등록 안 된 도메인이라 거절 — 정상. 도메인 추가 뒤 200 이 되어야 함) |
| 회사 서버 /lucky.html | 200 · 21,278 바이트(옛 사이트 파일과 md5 같음) |

확인 명령(누구나 다시 볼 수 있게):

```
nslookup -type=NS akkome.com
nslookup -type=CNAME event.akkome.com
```

---

## 0. 전환 전에 (회사 프로그램 · 대표 또는 조가영 = 관리자)

1. 회사 프로그램 로그인 → 메뉴 「이벤트 관리」(새 탭).
2. [🆕 새 회차 시작] → `NEW` → 새 이벤트 제목 입력. (직원 계정은 이 단추가 막힘 — 관리자만)
3. ⚙️ 이벤트 설정에 기간·발표일·경품 넣고 [설정 저장].
   - 지금 실DB `lucky_events` 는 0행이라, 이걸 안 하면 전환 순간 손님 화면에 **옛 추석 날짜·경품(코드 기본값)** 이 「접수 0분」으로 보인다.
   - 다음 이벤트 내용이 아직 없으면: 제목만 「제주아꼼이네 이벤트 준비 중」 같은 글로 두고 기간은 비워 두는 것도 가능(화면 문구는 그대로라 어색함 — 대표 판단).

---

## ① Render 에 사용자 도메인 추가 (대표 클릭)

> 🔴 Render 는 **같은 도메인을 두 서비스에 동시에 붙일 수 없다**. bum-toolbox 에 event.akkome.com 이 붙어 있으면 회사 서비스에 추가할 때 「이미 사용 중」으로 막힐 수 있다 → 그때는 1~3 을 먼저(옛 쪽에서 떼기), 그 순간부터 DNS 를 바꿀 때까지 몇 분간 이벤트 페이지가 안 열린다. 막히지 않으면 4 부터 하고 1~3 은 맨 끝(⑤ 뒤)에.

1. https://dashboard.render.com 로그인 → 서비스 목록에서 **bum-toolbox** 클릭.
2. 왼쪽 **Settings** → 아래로 **Custom Domains** 칸 → `event.akkome.com` 줄의 **Delete**(삭제)는 「이미 사용 중」으로 막힐 때만 지금 누른다.
3. (2를 눌렀다면) 바로 아래 ②로 가서 카페24 CNAME 을 바꾼다 — 끊기는 시간을 줄이기 위해.
4. 서비스 목록에서 **jeju-acom-company** 클릭 → **Settings** → **Custom Domains** → **+ Add Custom Domain**.
5. 입력값: `event.akkome.com` → **Save**.
6. Render 가 「CNAME 을 `jeju-acom-company.onrender.com` 으로 두라」는 안내와 함께 상태 **Verify / Pending** 을 보여 준다(값이 다르게 나오면 **Render 화면 값이 정답** — 이 문서의 값 대신 그걸 쓴다).
7. ②를 끝낸 뒤 이 화면에서 **Verify** 를 누른다 → 「Verified」 → 인증서(Let's Encrypt)는 **자동 발급**(보통 수 분 · 길면 1시간). 상태가 「Certificate Issued」 가 되면 끝.

## ② 카페24 DNS 에서 CNAME 바꾸기 (대표 클릭)

1. 카페24 로그인(akkome.com 도메인을 산 계정) → **나의 서비스 관리**(또는 호스팅센터) → **도메인 관리** → `akkome.com` → **DNS 관리**(「부가서비스 → DNS 관리」로 보일 수도 있음).
2. **CNAME(별칭) 관리** 표에서 호스트 `event` 줄 찾기 — 지금 값 `bum-toolbox.onrender.com`.
3. 그 줄 **수정** → 값을 `jeju-acom-company.onrender.com` 으로 → 저장. (끝에 점 `.` 을 붙이라는 칸이면 카페24 안내대로)
4. 같은 표에 `event` 로 된 **A 레코드가 따로 있으면 건드리지 말고 알려 주기**(지금 조회로는 CNAME 만 보임).
5. 다른 줄(`@` · `www` · 메일 MX · 자사몰 연결)은 **절대 손대지 않는다** — 자사몰 akkome.com 이 같은 DNS 에 있다.

---

## ③ 전환 전 확인 — 회사 서버가 그 이름으로 페이지를 내는지

①-5(도메인 추가)를 한 직후, **DNS 를 바꾸기 전에도** 확인할 수 있다(인증서가 아직 없어 `-k` 로 인증서 검사만 끈다):

```
curl -sk -o NUL -w "%{http_code} %{size_download}\n" -H "Host: event.akkome.com" https://jeju-acom-company.onrender.com/lucky.html
curl -sk -H "Host: event.akkome.com" https://jeju-acom-company.onrender.com/api/lucky/event
```

- 기대: 첫 줄 `200 21278` · 둘째 줄 = **회사 DB 의 이벤트**(0단계에서 넣은 제목·기간 · `"orders":0`).
- 도메인 추가 전 실측은 `403 151`(정상 — Render 가 모르는 이름).
- Git Bash 에서는 `-o NUL` 대신 `-o /dev/null`.

## ④ 전환 뒤 확인 (② 저장 후 · 몇 분~수십 분 뒤)

```
nslookup -type=CNAME event.akkome.com
curl -sI https://event.akkome.com/lucky.html
curl -s https://event.akkome.com/api/lucky/event
curl -sv https://event.akkome.com/lucky.html -o NUL 2>&1 | findstr /i "subject issuer expire"
```

- 기대:
  1. `canonical name = jeju-acom-company.onrender.com`
  2. `HTTP/1.1 200` (403·404·인증서 오류면 아직 전파 중 또는 ①-7 미완)
  3. 회사 DB 이벤트(옛 사이트의 `"orders":6455` · `"published":true` 가 나오면 아직 옛 쪽)
  4. 인증서 subject 에 `event.akkome.com` · issuer Let's Encrypt(또는 Google Trust Services)
- 폰(LTE·와이파이 각각)으로 https://event.akkome.com/lucky.html 열어 상단 배너·「접수 · 당첨 확인」 칸이 보이는지 · 성함 조회 1번(「접수된 주문이 없습니다」가 정상 — 새 회차라 주문 0).
- 우리 PC 에서 옛 값이 계속 보이면 `ipconfig /flushdns` 후 다시.

## ⑤ 되돌리기

1. 카페24 DNS 관리 → `event` CNAME 값을 `bum-toolbox.onrender.com` 으로 원복 → 저장.
2. ①에서 bum-toolbox 의 도메인을 지웠다면 bum-toolbox → Settings → Custom Domains → **+ Add** `event.akkome.com` → Verify.
3. (선택) 회사 서비스의 event.akkome.com 은 지워도 되고 둬도 무해.
4. 확인 = ④ 명령에서 `"orders":6455` 가 다시 보이면 원복 끝.
- ⚠️ 원복은 **bum-toolbox 를 재배포하지 않았을 때만** 의미가 있다(옛 사이트는 파일 저장이라 재배포 = 추석 데이터 소실).

---

## ⑥ 함정

1. **호스트별 분기**: server.js 에 Host 이름을 보고 갈라 주는 코드는 **없다**(req.hostname·headers.host 검색 0 · 16478행 `app.get('*')` 가 모든 모르는 경로에 회사 프로그램 index.html). 그래서 전환 뒤에는:
   - `https://event.akkome.com/` (뒤에 아무것도 없는 주소) = **회사 프로그램 로그인 화면**이 뜬다. 옛 사이트의 「한라산 코딩」 첫 화면은 사라진다. 손님에게 나간 링크는 전부 `/lucky.html` 이라 손님 영향은 없지만, 홍보물·QR 에 `event.akkome.com` 만 적혀 있으면 로그인 화면으로 간다 → 필요하면 「event 호스트로 `/` 가 오면 `/lucky.html` 로 보냄」 한 줄(server.js · 총괄 배정 · 정적 미들웨어 44행보다 앞).
   - `event.akkome.com/lucky-admin.html` 도 열리지만 로그인 표(localStorage)는 주소마다 따로라 **직원 관리 화면은 종전대로 회사 주소에서** 쓴다(event 주소에서 열면 「로그인 필요」).
   - `/guide` · `/track-order` 등 회사 공개 페이지도 event 주소로 열린다(해 없음 · 링크로 쓰지 말 것).
2. **bum-toolbox 의 다른 쓰임**: event.akkome.com 루트에서 「한라산 코딩 | 쓸모있는 무료 프로그램」(입장코드 · 인스타)이 나온다 → 대표가 그 사이트를 이 주소로 홍보 중이면 전환과 함께 그 주소가 사라진다. bum-toolbox 자체(bum-toolbox.onrender.com)는 그대로 살아 있다. **대표 확인 필요.**
3. **옛 사이트 내리는 시점**: 전환하고 ④ 확인이 끝난 뒤에도 bum-toolbox 는 **최소 하루~이틀 그대로** 둔다(DNS 캐시가 남은 손님은 옛 쪽으로 감 · 되돌리기 대비). 옛 추석 데이터가 필요하면 내리기 전에 옛 관리 화면에서 [백업 파일 다운로드]로 JSON 만 보관(복원은 안 함 — 결정대로).
4. **DNS 전파 시간**: 카페24 저장 후 보통 수 분~1시간 · 이전 값이 캐시된 곳은 TTL 만큼(기본 12시간 설정이 있어 최악 반나절). 전환은 손님 조회가 적은 시간에 · 그동안 손님마다 옛/새 페이지가 섞여 보일 수 있음.
5. **인증서 발급은 DNS 가 바뀐 뒤에만** 된다(Render 가 CNAME 을 확인해야 발급) → ② 직후 몇 분은 `https` 인증서 오류가 날 수 있음. ①-7 「Certificate Issued」 확인 후 홍보.
6. **CAA 레코드**: 카페24 DNS 에 CAA 레코드가 있으면 Let's Encrypt 발급이 막힌다(지금 확인 안 함) → 인증서가 1시간 넘게 안 나오면 CAA 확인: `nslookup -type=CAA akkome.com`.
7. **/guide 카드·#59 링크**: 둘 다 `https://event.akkome.com/lucky.html` 이라 **링크는 고칠 필요 없음**(이번 결정의 장점) · 둘 다 지금 꺼져 있음.
8. 레이트 리밋: lucky-event.js 의 조회 제한(40회/분)은 XFF 첫 값 기준 — #693 의 다른 공개 POST 처럼 cf-connecting-ip 기준이 아님(사용자 도메인이 Cloudflare 를 거치는지에 따라 달라짐 · 참고만).

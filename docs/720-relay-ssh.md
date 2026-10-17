# #720 중계서버 업데이트 — 대표님 복붙용 (네이버 상품 쓰기 1차)

> 무엇이 바뀌나: 중계서버(101.79.16.213)가 **상품 상세 수정 · 판매 상태 변경(PUT)** 과 **상품 그림 올리기(POST)** 를 네이버로 넘겨 주게 됩니다.
> 그 밖의 경로(옵션·삭제·신규 등록 등)는 지금처럼 막혀 있습니다. 바뀐 버전 = **`2026-10-17.1`** (종전 `2026-08-24.1`).
> 🔴 **총괄이 「중계서버 코드 올렸어요(푸시 끝)」라고 알린 뒤에** 하세요 — 설치 스크립트가 GitHub 의 최신 코드를 받아 갑니다(먼저 하면 옛 코드가 다시 깔립니다 · 그래도 해는 없고 다시 하면 됩니다).
> 🔵 재시작하는 3초쯤 동안 네이버 자동수집 한 번이 실패할 수 있습니다(다음 주기에 저절로 다시 함). **평일 08:30~10:30(발송 직전)은 피해 주세요.**

---

## ⓪ 인터넷 회선이 바뀌었으면 먼저 (아니면 건너뛰기)

NCP 콘솔 → `Server` → `ACG` → `akkome-vpc-default-acg` → Inbound 규칙 → TCP **22** 줄의 접근 소스를 **`myIp`** 로 다시 저장.
(회선이 바뀌면 SSH 가 「연결 시간 초과」로 안 붙습니다.)

## ① 접속 (PowerShell)

root 비밀번호는 NCP 콘솔 → `Server` → `akkome-relay` → `서버 관리 및 설정 변경` → `관리자 비밀번호 확인` → `akkome-key.pem` 첨부로 꺼냅니다.

```powershell
ssh root@101.79.16.213
```

비밀번호 붙여넣기(화면에 안 보여도 정상) → `root@akkome-relay:~#` 가 보이면 접속 성공.

## ② 업데이트 (한 덩어리 통째로 복붙 → Enter)

```bash
curl -fsSL https://raw.githubusercontent.com/bumiletter-bit/jeju-acom-company/main/relay/install.sh | sudo bash
sleep 2
echo "────── ① 버전 확인 (2026-10-17.1 이어야 함) ──────"
curl -sk https://127.0.0.1:4000/health; echo
echo "────── ② 막힌 경로는 여전히 막히는지 (403 path_not_allowed 이어야 함) ──────"
source /opt/akkome-relay/.env
curl -sk -o /dev/null -w "HTTP %{http_code}\n" -X POST https://127.0.0.1:4000/naver \
  -H "Authorization: Bearer $RELAY_AUTH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"method":"DELETE","path":"/external/v2/products/channel-products/1"}'
echo "────── ③ 그림 형식(multipart)을 다른 경로로 보내면 거절되는지 (400 이어야 함) ──────"
curl -sk -o /dev/null -w "HTTP %{http_code}\n" -X POST https://127.0.0.1:4000/naver \
  -H "Authorization: Bearer $RELAY_AUTH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"method":"PUT","path":"/external/v2/products/channel-products/1","body":{"__multipart":{"field":"imageFiles","files":[]}}}'
echo "────── ④ 네이버 인증 그대로인지 (token_test success 이어야 함) ──────"
curl -sk 'https://127.0.0.1:4000/health?token=1'; echo
```

### 이렇게 나오면 정상

| 줄 | 정상 | 다르면 |
|---|---|---|
| ① 버전 | `"version":"2026-10-17.1"` | `2026-08-24.1` 이면 옛 코드 → 총괄에게 「푸시 됐나요?」 묻고 ② 다시 |
| ② 막힌 경로 | `HTTP 403` | 그 밖의 숫자면 화면 전체를 총괄에게 |
| ③ multipart 거절 | `HTTP 400` | 그 밖의 숫자면 화면 전체를 총괄에게 |
| ④ 네이버 인증 | `"token_test":"success"` | `fail` 이면 화면 전체를 총괄에게(시크릿 값은 지우고) |

설치 끝에 나오는 **인증서 글(-----BEGIN … END-----)은 이번엔 Render 에 다시 넣지 않아도 됩니다**(인증서는 그대로 유지 — 「HTTPS 인증서 이미 존재 — 유지」가 보이면 정상).

## ③ 끝나면 총괄에게

위 표의 ①~④ 결과 네 줄만 알려 주시면 됩니다. 그 뒤 총괄이 시험 상품 1건으로 실제 수정·되돌리기를 확인합니다.

---

### 되돌리기 (문제가 생겼을 때)

총괄이 relay/server.js 를 옛 버전으로 되돌려 푸시한 뒤, 위 ② 덩어리를 그대로 다시 실행하면 옛 버전(`2026-08-24.1`)으로 돌아갑니다.
막힌 경로 확인: `sudo journalctl -u akkome-relay -n 30 --no-pager` (「차단(허용목록 외)」 줄)

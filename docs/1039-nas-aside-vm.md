# #1039-B 나스 윈도우 VM = 어사이드 전용 PC 세팅 절차

> 목적: 노트북에서 매일 09:30 에 돌던 **키워드 순위 자동 수집**(#910 · keyword-rank.js · 어사이드)을 나스 VM 으로 옮긴다. 이렇게 하면 노트북을 꺼도 순위가 모인다.
> VM 은 #1039-A(워커3)가 만든다. 이 문서와 `scripts/vm/` 는 VM 안 세팅만 다룬다.
> 만든 파일: `scripts/vm/setup-aside-vm.ps1`(1회 실행 · 다시 돌려도 안전) · `scripts/vm/make-vm-env.js`(VM 용 .env 한 줄 만들기).

## 0. VM 이 하는 일과 하지 않는 일

| 한다 | 하지 않는다(🔴 등록 금지) |
|---|---|
| 09:30 작업 「아꼼이-키워드-순위」(install-keyword-rank.js) → keyword-rank.js --apply → DB 저장 | `install-notebook-alive.js`: 노트북 켜짐 신호다. VM 이 보내면 나스 터미널이 「노트북 켜짐」으로 보고 켜기를 거절하거나 꺼 버린다. |
| 어사이드 로그인 상태 유지(네이버 등) | `install-ship-upload.js`: 송장 올리기는 나스 컨테이너가 10:00 에 한다. 둘이 돌면 겹친다. |
| | `install-launcher.js`(창구 대기)·창구 「akkome」: 창구는 나스 컨테이너 몫이다. 같은 지시를 둘이 집으려 든다. |
| | 코드 수정·push·배포. VM 은 https 로 받기만 한다. |

`setup-aside-vm.ps1` 점검표 끝 세 줄이 위 금지 세 가지를 확인한다. 하나라도 있으면 X 로 나오고 지우는 명령을 보여 준다.

## 1. VM 에 필요한 열쇠 = `.env` 의 `DATABASE_URL` 한 칸뿐

실코드 근거:
- `keyword-rank.js` 가 쓰는 것은 `require('./_db')` 하나다. `_db.js` 는 `.env` 를 읽어 `DATABASE_URL` 로 pg 에 붙는다.
- DB 에서 하는 일:
  - 읽기: 설정 `keyword_rank` · `keyword_rank_last` · `naver_product_snapshot`
  - 쓰기: `keyword_rankings` · `keyword_rank_last` · `audit_logs`
- 텔레그램·알림 종은 렌더 서버 1분 틱이 `keyword_rank_last` 를 보고 보낸다. 그래서 VM 에 텔레그램 키는 필요 없다.
- npm 꾸러미도 `pg`·`dotenv` 둘만 쓴다.

**추린 `.env` 칸 이름 = `DATABASE_URL` (이것 하나)**. 노트북 `.env` 의 나머지 4칸은 넣지 않는다.

🔴 `ASIDE_EXE`·`KR_PAGE_WAIT_MS` 는 `.env` 에 넣어도 **효과가 없다**. keyword-rank.js 50·51행이 `.env` 를 읽기 전에 값을 정하기 때문이다. 그래서 둘은 사용자 환경 변수로 둔다(스크립트가 필요할 때만 `ASIDE_EXE` 를 넣는다).

### `pack-keys.js` 는 VM 에 쓰지 않는다
- `pack-keys.js`(#916)의 `env` 묶음은 `.env` 통째(5칸)다.
- `akkome` 묶음에는 창구 콘솔 키(`desk-api-key.txt`, 과금)가 들어 있다.
- 나머지 묶음(Claude 로그인·메모리·SSH·힉스필드)도 VM 은 쓰지 않는다.
- → 대신 `make-vm-env.js` 로 한 칸만 뽑는다. 값은 화면에 안 찍히고 칸 이름만 찍힌다.

### 노트북에서 꾸러미 만들기(총괄 또는 대표)
```powershell
cd "C:\Users\전승범\OneDrive\문서\★제주아꼼이네 회사프로그램"
node scripts/vm/make-vm-env.js                      # 미리 보기: keep [DATABASE_URL] · dropped 4 가 나와야 함
node scripts/vm/make-vm-env.js --out E:\akm-vm\.env # E: = USB(또는 빈 폴더)
node scripts/vm/make-vm-env.js --check E:\akm-vm\.env
```

### VM 으로 옮기기 — 🔴 `\\192.168.0.22\아꼼` 에 두지 말 것(직원 전부 열람)
- **A안(권장) = USB 또는 VM 콘솔 직접 복사**
  - UGOS 가상 머신에 USB 를 넘겨 주거나, VM 원격 화면의 파일 붙여 넣기로 `E:\akm-vm\.env` 를 VM 에 넣는다.
  - 다 쓰면 USB 의 `.env` 를 지운다.
- **B안 = 나스 `docker` 공유(직원 공개 아님 · #916 에서 akkome 권한 뺌)**
  1. 노트북에서 paramiko(user1) 로 `/volume1/docker/akkome/vm-keys/.env` 에 올리고 `chmod 600` 한다. 나스 접속 길은 메모리 jeju-nas-migration-plan 에 있다.
  2. VM 에서 아래처럼 꺼내고 바로 지운다.
     ```powershell
     net use \\192.168.0.22\docker /user:user1 *          # 비번은 그 자리에서 입력(저장 안 함)
     mkdir C:\akm-vm; copy \\192.168.0.22\docker\akkome\vm-keys\.env C:\akm-vm\.env
     net use \\192.168.0.22\docker /delete
     ```
  3. 나스에서 `sudo rm -rf /volume1/docker/akkome/vm-keys` 로 지운다.

## 2. VM 에서 1회 세팅

1. akkome 로 로그인한 뒤 **관리자 PowerShell** 을 연다. 다른 관리자 계정으로 올린 창이면 작업이 그 계정에 묶인다. 스크립트가 이 경우를 막는다.
2. 스크립트를 받는다. 리포가 아직 없으므로 `setup-aside-vm.ps1` 한 장만 먼저 받는다.
   ```powershell
   mkdir C:\akm-vm -Force
   Invoke-WebRequest https://raw.githubusercontent.com/bumiletter-bit/jeju-acom-company/main/scripts/vm/setup-aside-vm.ps1 -OutFile C:\akm-vm\setup-aside-vm.ps1
   ```
   - 커밋·푸시 뒤에 받을 수 있다. 그 전에는 USB 로 옮긴다.
3. 첫 회는 **등록 없이** 돌린다.
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\akm-vm\setup-aside-vm.ps1 -KeyDir C:\akm-vm
   ```
   스크립트가 하는 일:
   - ① 사용자가 akkome 인지, 관리자 창인지 확인한다.
   - ② Node LTS·git 이 없으면 winget 으로 설치한다.
   - ③ `C:\akkome\회사프로그램` 에 clone 한다(있으면 `git pull --ff-only`).
   - ④ `pg`·`dotenv` 가 없으면 `npm ci --omit=dev --ignore-scripts` 를 돌린다.
   - ⑤ `.env` 를 복사한다(없을 때만). 권한은 akkome·SYSTEM·Administrators 만 남긴다.
   - ⑥ aside.exe 를 찾는다.
   - ⑦ 시간대를 KST 로 맞추고, 절전·화면·디스크·최대 절전을 「끄기 없음」으로 둔다.
   - ⑨ 점검표를 찍는다.
4. 대표 몫(6절)인 어사이드 설치·로그인을 마친다.
5. 손으로 시험 한 번 돌린다. DB 는 읽기만 하고 쓰기는 0 이다.
   ```powershell
   cd C:\akkome\회사프로그램
   node scripts\desk\keyword-rank.js --list               # 오늘 모을 키워드(어사이드 0 · DB 읽기)
   node scripts\desk\keyword-rank.js --keywords 귤,감귤    # dry — 어사이드로 실제 순위 읽고 표만(쓰기 0)
   ```
   - 표에 순위가 나오면 합격이다.
   - 「보안 확인」으로 막히면 어사이드 창에서 대표가 푼다.

미리 보기(바꾸는 것 0)는 `-DryRun` 또는 `-WhatIf` 다. 노트북에서는 `-Root <리포>` 를 붙이면 점검표만 볼 수 있다.

## 3. 노트북과 다른 점(코드 그대로 · 경로는 저절로 따라감)

| 항목 | 노트북 | VM | 코드에서 정하는 곳 |
|---|---|---|---|
| 리포 자리 | `C:\Users\전승범\OneDrive\문서\★제주아꼼이네 회사프로그램` | `C:\akkome\회사프로그램` | `ROOT = __dirname/../..`(박힌 경로 없음) |
| 집 · 로그 | `C:\Users\전승범\.akkome` | `C:\Users\akkome\.akkome` | `os.homedir()` |
| 결과 로그 | `~/.akkome/logs/keyword-rank-YYYY-MM-DD.log` | 같은 꼴 | install-keyword-rank.js `LOG_DIR` |
| 작업 로그 · 하루 표시 | `~/.akkome/keyword-rank-task.log` · `keyword-rank.json` | 같은 꼴 · **기계마다 따로** | `KR_STATE` |
| aside.exe | `%LOCALAPPDATA%\Aside\CLI\current\aside.exe` | 같은 꼴(akkome 의 LOCALAPPDATA) · 다른 자리면 사용자 환경 변수 `ASIDE_EXE` | keyword-rank.js 50행 |
| 작업 주인 | `USERDOMAIN\전승범` | `<VM이름>\akkome` | 설치할 때 `USERDOMAIN\USERNAME` |
| node 경로 | 설치 때 `process.execPath` 를 vbs 에 박음 | 같음. Node 를 다른 자리로 다시 깔면 `-Register` 로 재등록 | install-keyword-rank.js `writeFiles` |
| `DESK_NO_ASIDE` | 안 씀 | **넣지 말 것**. launcher.js `rankMaybe` 만 보는 값이라 VM 에서는 영향이 0 이다. | launcher.js 815행 |
| 시간대 | KST | 작업 09:30 은 VM 현지 시각, `--tick` 은 KST 고정 계산 → **KST 필수**(스크립트가 맞춤) | |
| 로그인 세션 | 대표가 늘 로그인 | 작업이 `InteractiveToken` 이라 **로그인된 세션이 있어야** 돈다. 재부팅 뒤 자동 로그인 필요(6절) | |

`pack-keys.js` 의 `MEM_PROJECT`(전승범 경로 이름)는 VM 에서 안 쓰므로 상관없다.

**코드 갱신**: VM 은 저절로 pull 하지 않는다. keyword-rank.js 를 고쳐 배포한 날은 VM 에서 `setup-aside-vm.ps1` 을 다시 돌린다. git pull 만 하고 나머지는 건너뛴다.

## 4. 금지 줄(다시 한 번)
- 🔴 VM 에서 `node scripts\desk\install-notebook-alive.js --install` 금지.
- 🔴 VM 에서 `node scripts\desk\install-ship-upload.js --install` 금지.
- 🔴 VM 에서 `node scripts\desk\install-launcher.js` 금지. 창구 `akkome` 실행도 금지.
- 🔴 VM 에 노트북 `.env` 통째·`~/.akkome` 통째·`desk-api-key.txt`·Claude 로그인 파일을 복사하지 말 것.

## 5. 전환 순서 · 되돌리기

🔴 두 기계에 둘 다 등록돼 있으면 같은 날 09:30 에 **둘 다 돈다**. 하루 표시 파일이 기계마다 따로라 서로 막아 주지 않는다. 그러면 생기는 일:
- 네이버 검색이 두 배가 된다(보안 확인 위험).
- 늦게 끝난 쪽이 `keyword_rank_last` 를 덮는다. VM 이 실패하면 노트북의 좋은 결과가 오류 기록으로 바뀐다(키워드 줄은 남는다).

### 권장 순서
1. 2절 5번의 VM 손 시험(dry)이 합격한다.
2. **전날 저녁**에 노트북에서 작업을 지운다.
   ```powershell
   node scripts/desk/install-keyword-rank.js --remove
   ```
3. 같은 날 저녁 VM 에서 등록한다.
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\akm-vm\setup-aside-vm.ps1 -Register
   ```
   점검표의 「작업 아꼼이-키워드-순위 OK · 다음 내일 09:30」을 확인한다.
4. 다음 날 10시 전 텔레그램 키워드 순위 1통이 오면 끝이다.
   - 안 오면 VM 에서 `node scripts\desk\install-keyword-rank.js --status` 로 로그끝을 본다.
   - 결과 로그는 `C:\Users\akkome\.akkome\logs\keyword-rank-<날짜>.log` 다.

배정문 순서(VM 첫 실수집 확인 뒤 노트북 `--remove`)로 하려면 그 하루만 두 번 도는 것을 받아들여야 한다. 그날 노트북 결과는 VM 이 덮는다.

### 되돌리기(노트북으로)
- 노트북: `node scripts/desk/install-keyword-rank.js --install`
- 그날 이미 놓쳤으면 노트북에서 `--run` 도 한다.
- VM: `node scripts\desk\install-keyword-rank.js --remove`

## 6. 대표 몫
1. **윈도우 정품 인증**(윈도우 키).
2. **어사이드 설치·로그인**(akkome 계정에서).
3. **어사이드 안 로그인 12곳**(네이버 등 · 폰 인증) + 비밀번호 관리자 저장. 노트북과 같은 목록이다(CLAUDE.md 10/30 줄).
4. **자동 로그인**: 나스·VM 재부팅 뒤에도 akkome 세션이 떠 있어야 09:30 작업이 돈다.
   - `netplwiz` 에서 「사용자 이름과 암호를 입력해야…」 체크를 풀거나, Sysinternals Autologon 을 쓴다.
   - 비번은 대표가 직접 넣는다.
   - 점검표 「자동 로그인」 줄이 `1 · akkome` 이면 OK 다.
5. **윈도우 업데이트 사용 시간**: 09:00~10:30 에 재부팅하지 않게 둔다.
6. 네이버 「보안 확인」이 뜨는 날은 VM 어사이드 창에서 푼다. 그 뒤 VM 에서 `node scripts\desk\keyword-rank.js --apply` 를 돌린다(종전 노트북 길과 같음).

## 7. 미확인(VM 이 생긴 뒤 확인)
- winget 이 VM 에 들어 있는지. 윈도우 11 기본 포함이지만, 오프라인 설치판이면 Store 의 「앱 설치 관리자」 업데이트가 필요하다.
- 어사이드가 VM(가상 그래픽)에서 정상으로 그려지는지. 탭 렌더가 끊기면 순위 읽기가 실패한다(메모리 jeju-aside-browser 의 탭 끊김 기록).
- VM 에서 렌더 DB(5432) 바깥 연결이 되는지. 나스 네트워크 설정에 따라 다르다.
- 네이버가 VM(나스 회선) 접속을 노트북과 같게 보는지(보안 확인 빈도).
- `-Register` 실제 등록. 노트북에서는 등록을 시험하지 않았다(드라이만).

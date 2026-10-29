# #914 창구·세션 나스 이전 — 기동 꾸러미 설계서 (초안 · 2026-10-29 · 워커3)

> 목적: 대표 PC(노트북)에서 돌던 **창구 대기 프로그램**(★에이전트오피스 launcher)과 **총괄·워커 Claude Code 터미널**을 나스(UGREEN DXP2800) 안에서 돌린다. 노트북이 꺼져도 직원 지시·세션이 돈다.
> 대표가 정할 것은 **5절**에 따로 모았다. 코드는 아직 한 줄도 바꾸지 않았다(이 문서 + `docs/914/` Dockerfile 초안만). 나스에서 한 것 = 이미지 빌드·버전 찍기까지(창구·claude 실행 0 · /volume1/아꼼 쓰기 0 · 호스트 패키지 설치 0).

## 0. 나스 실측(10/29 15:xx · SSH user1 · 읽기만)

| 항목 | 값 |
|---|---|
| 기기 | UGREEN NASync DXP2800 · Intel N100 4코어 · 램 **7.7GB**(사용 1.6 · 여유 6.1) · 스왑 5.9GB · M.2 1.8TB(/volume1 사용 190GB · 여유 1.6TB) |
| OS | UGOS Pro = Debian 12(bookworm) · 커널 6.12 · 시간대 Asia/Seoul |
| Docker | **CLI 29.4.3 있음** · Compose v5.1.3 있음 · buildx 플러그인 없음(→ `DOCKER_BUILDKIT=0` 로 옛 빌더) · 저장 /volume1/@docker(overlay2 · cgroup v2) · 이미지·컨테이너 0 |
| 권한 | user1 = admin 그룹이나 **docker 그룹 밖** → `docker` 는 `sudo` 필요(비번) · 회사 계정 akkome = uid 1001 · gid 100(users) |
| 가상화 | CPU VT-x 켜짐(`vmx`) · `/dev/kvm` 있음 · `kvm_intel` 로드됨 · **「가상 머신」 앱은 미설치**(설치된 앱 = Docker · 스냅샷) |
| 네트워크 | 인터넷 OK(deb.debian.org 200 · registry 401=정상) · 공유 「아꼼」 = /volume1/아꼼(188GB · 777+ACL) · /volume1/docker(빈 폴더 · 777) |
| 열쇠 | 접속 비번은 `~/.akkome/nas.txt`(이 문서·보고·커밋에 적지 않음 · sudo 는 stdin 으로만 넘김) |

## 1. 확정 구도(대표 10/29 「어사이드는 우선 내 노트북에서만」) = 나스 Docker 창구·세션 + 노트북 어사이드

### 1-0. 나스 창구 ↔ 노트북 어사이드 「다리」(가장 단순한 길 · 코드 1줄)

**노트북에 남는 것(어사이드가 있어야 하는 일 전부)**
| 남는 것 | 지금 | 나스 이전 뒤 | 코드 |
|---|---|---|---|
| ① #910 키워드 순위 09:30(`keyword-rank.js --apply` · aside.exe mcp) | 창구 launcher 의 rankMaybe 가 띄움 | **노트북 작업 스케줄러 1건**(매일 09:30 · 꺼져 있었으면 켜진 뒤 바로 · install-ship-upload.js 와 같은 vbs 꼴 → `scripts/desk/install-keyword-rank.js` 40줄 또는 대표가 작업 스케줄러에 손으로 1건) · 결과는 종전처럼 DB(keyword_rankings · keyword_rank_last) → 서버 텔레그램 그대로 · 노트북이 꺼져 있으면 10:00 「미수집」 알림이 그대로 알려 줌 | 설치 도구 40줄(선택) |
| ② 나스 창구는 키워드 순위를 **띄우지 않게** | rankMaybe 는 설정 keyword_rank.enabled(DB · 전역)만 봄 → 나스에서 돌면 aside.exe 없음 → **모든 키워드 오류로 keyword_rank_last 를 덮어 써 노트북 결과와 충돌**(실코드 확인 · keyword-rank.js 413~427) | launcher.js rankMaybe 첫 줄에 `if (process.env.DESK_NO_ASIDE === '1') return;` **1줄** · compose env `DESK_NO_ASIDE=1` | **1줄(필수)** |
| ③ 네이버 쇼핑·스토어 조사(#907 꼴 · MCP aside · repl) | 워커 세션이 노트북에서 | **그 세션만 노트북에서 연다**(총괄이 배정할 때 「노트북 워커」로) · 나스 세션의 `.claude.json` 엔 aside MCP 줄을 넣지 않음 | 0 |
| ④ 크롬 확장·대표 로그인 브라우저 일(센터·카카오·윙·카페24 관리자) | 노트북 | 노트북 그대로 | 0 |
| ⑤ 창구 지시 중 어사이드가 필요한 것 | **없음**(창구 CLAUDE.md 어사이드 0건 · 업무지식 1건 = 「창구 어사이드 = 보류」 안내) | 그대로 없음 → 창구가 넘길 일이 없다 · 생기면 그때 「노트북 창구에 넘기기」 설계(지시 status 로 넘김 · 지금은 안 함) | 0 |
| ⑥ 엑셀 그림(xlsx-image.js · Excel COM) | 노트북 Excel | 나스 창구에선 **엑셀 변환 실패 → 엑셀 파일만 첨부**(respond ATTACH_EXT 에 xlsx 있음 · 그림 미리 보기만 빠짐) · 그림이 꼭 필요하면 LibreOffice(2-2절 14번 · 나중) | 0(기능 축소) |
| ⑦ 대표 요금제 /login 갱신 · 리모트 컨트롤 조종 | 노트북·폰 | 나스 세션은 컨테이너 안 /login(3-4절) · 폰 리모트 컨트롤은 나스 세션에 붙음 | 0 |

흐름 = 나스 창구(Docker)는 직원 지시·서버 신호·메일·DB 일을 전부 하고, **어사이드 일은 애초에 나스로 안 보낸다**(①은 노트북 스케줄러 · ③은 노트북 세션). 두 기기가 같은 DB 를 쓰므로 결과 합치기는 필요 없다. 노트북이 꺼져 있으면 ①만 빠지고(10:00 알림이 알려 줌 · 켜지면 그날 1회 돎) 나머지는 전부 돈다.

### 1-1. 어사이드 리눅스 길 조사 결과(사실 · 공식 자료 · 추측 0)
- **브라우저 앱 = macOS · Windows 만**. aside.com/download · docs.aside.com 18쪽 전부에 리눅스·헤드리스·서버 모드·Docker 이미지 언급 0.
- **CLI 만 리눅스 빌드가 있다**: `releases.aside.com/install.sh` 원문이 `Linux:x86_64 → AsideCLI-linux-x64.tar.gz` 를 받음. 그러나 CLI 는 조종기(exec·repl·mcp)일 뿐 **브라우저 앱이 켜진 기기**가 있어야 한다.
- CLI 에 `--host <기기>`(session host · Remote Control / cloud) 옵션이 있다. 이 계정에서 `aside host list` = **403**(Pro $20/월 「Channels(Remote control)」 기능으로 보임). 되더라도 어사이드 앱은 대표 PC 에 켜져 있어야 함 = 「나스에 깐다」가 아니다(종전 가정 ② 꼴).

### 1-2. 나중 선택지 = 「나스에서 어사이드까지」 길 비교(대표 10/29 보류 · 기록만 · 램 16GB 전제)

| 길 | 가능? | 내용 | 비용 | 소요 | 위험 | 대표가 할 것 |
|---|---|---|---|---|---|---|
| **A1 · Windows VM 하나에 지금 PC 꼴 그대로** | **가능** | UGOS 「가상 머신」 앱 → Windows 11 Pro VM(램 8~10GB · vCPU 2~3 · 디스크 120GB) 안에 어사이드 + Node + Claude Code + 창구(시작프로그램 감시자) + 총괄·워커 터미널 = **코드 손질 0**(Windows 전용 25곳 그대로) | 램 16GB 32~36만 + Win11 Pro 라이선스(정품가 대표 확인) | 램 도착 뒤 반나절 | N100 이라 VM 체감 느림 · ext4 라 VM 스냅샷 없음(내보내기로 백업) · Windows 업데이트 재시작(감시자가 창구 살림 = 지금과 같음) | 램 구매·교체 · 라이선스 · 앱센터 가상 머신 설치 · Rufus 로 ISO(TPM·Secure Boot 검사 우회 · DXP2800 실사례) · VM 안 로그인 1회(Windows · 어사이드 금고·복구 키 · Claude /login · 콘솔 키 파일) |
| **A2 · Docker 창구 + Windows VM 은 어사이드만** | 가능 | 이 문서의 Docker 꾸러미(2~4절)로 창구·세션 · VM(램 6GB)엔 어사이드 + Node 만 · 창구 → VM 다리 = ssh(Windows OpenSSH 서버) 로 `keyword-rank.js --apply` 를 VM 안에서 돌림 | A1 과 같음 | 램 도착 뒤 1~2일(이식 2~3일 + 다리 코드) | Windows 전용 25곳 리눅스화(2-2절 · 어려움 2) · VM·컨테이너 둘 관리 | A1 과 같음 + 다리용 VM ssh 열기 |
| B · 리눅스 데스크톱 컨테이너(xfce+noVNC) 안 어사이드 | **불가** | 어사이드 리눅스판 없음 | — | — | — | — |
| C · 나스 CLI(linux-x64) → `--host` 대표 PC | 조건부 | Pro 결제 + 대표 PC 어사이드 상시 → 노트북이 켜져야 함(대표 뜻과 어긋남) | $20/월 | 1시간 | 403 원인 미확인 | Pro 결제 |
| ② · 어사이드 일만 PC 에 남김(종전 가정) | 가능 | 나스 창구가 「어사이드 일」을 PC 로 넘김 | 0 | 1일 | 노트북 꺼지면 키워드 순위 미수집 | — |

나중에 「어사이드도 나스에」로 바뀌면 **A1**(이식 0 · Excel·PowerShell 도 함께 해결)이 추천. 지금은 보류(대표 10/29) — 1-0절 다리 구도로 간다.
**16GB 사실** = DXP2800 은 SO-DIMM **슬롯 1개 · 최대 16GB · DDR5-4800 SO-DIMM** → 8GB 추가가 아니라 **16GB 한 장으로 교체**(기존 8GB 는 빼냄 · Mr Memory·OWC 호환표). 램 가늠 = UGOS 1.5 + Win VM 8 + Docker 컨테이너 5 = 14.5GB.
**8GB 그대로면** = VM 불가(UGOS 1.5 + VM 최소 4 + 창구 → 스왑) → Docker 창구만(②) 가능.

## 2. 창구 코드의 Windows 전용 부분과 리눅스 대체(확정 구도 = 이 길)

### 2-1. 셈 = 25곳 · 코드를 고쳐야 하는 것 6곳(보통 3 · 어려움 1 · 쉬움 2) · 나머지 19곳은 env·문서·설정으로 끝(코드 0)
- 보통 3 = 3·4번(자식 트리 끄기·기동 복구 /proc) · 9번(송장 올리기 10:00) · 어려움 1 = 14번(엑셀 그림 · 1-0절 ⑥ 으로 당장은 기능 축소) · 쉬움 2 = 13번(pdftotext env) · 15번(키워드 순위 = 1-0절 ② 의 1줄)

### 2-2. 표

| # | 파일:자리 | 지금(Windows) | 리눅스 대체 | 난도 |
|---|---|---|---|---|
| 1 | install-launcher.js 전체 | 시작프로그램 vbs(UTF-16) · wscript · 창 없이 node → launcher-guard | **docker `restart: unless-stopped` + entrypoint `desk` 모드가 launcher-guard.js 를 앞에서 돌림**(파일 안 씀) | 쉬움(코드 0) |
| 2 | launcher.js 46 findClaude() | claude.exe 3경로(APPDATA·LOCALAPPDATA·.local) | env **`AKKOME_CLAUDE_EXE`** 이미 지원 → `/usr/local/bin/claude` | 쉬움(코드 0) |
| 3 | launcher.js 148 killTree | `taskkill /PID /T /F`(트리) · 그 밖 `child.kill('SIGKILL')` | 리눅스 SIGKILL 은 **자식 하나만** → claude 가 띄운 node·bash 손자가 남음 → `spawn(..., {detached:true})` + `process.kill(-pid,'SIGKILL')`(프로세스 그룹) | **보통**(5줄 · 교차 점검) |
| 4 | launcher.js 175 procInfo | PowerShell Get-Process(이름·시작 시각·부팅 시각) · 다른 OS = null = 「아무도 안 끈다」 | `/proc/<pid>/stat`(comm·starttime) + `/proc/stat btime` 읽기 | **보통**(20줄) |
| 5 | launcher.js 200 killOrphanKids | taskkill /T | `process.kill(pid,'SIGKILL')` 이미 있음(3번과 묶어 그룹으로) | 쉬움 |
| 6 | launcher.js 874 portOwnerPid | `netstat -ano`(로그용) | `ss -ltnp`(이미지에 iproute2) | 쉬움 |
| 7 | launcher.js windowsHide ×10 · SIGBREAK | Windows 옵션 | 리눅스 무해(무시됨 · try/catch) | 없음 |
| 8 | launcher-guard.js 80·103 | windowsHide · SIGBREAK | 무해 | 없음 |
| 9 | install-ship-upload.js 전체(#594) | schtasks 작업 + vbs + `cmd /c chcp 65001` · UTF-16 XML · 매일 10:00 | launcher slowTick 에 「KST 10:00 하루 1회 ship-upload.js --days 3」(rankMaybe 꼴 20줄) 또는 컨테이너 cron | **보통** |
| 10 | share-index.js 10 · ship-upload.js 87 SHARE 기본값 | `\\192.168.0.22\아꼼` | env **`AKM_SHARE=/share`**(이미 env) · 🔴 색인 files.json·invoices.json 안 경로가 UNC 꼴 → **나스에서 색인 재생성 1회**(1~2분 · 324MB) | 쉬움(코드 0) |
| 11 | LOCALAPPDATA 폴백 11파일(share-index·share-find·invoice-find·ship-upload·ship-track·invoice-month·_mall·_preview·detail-button·naver-detail·mail-find) | `%LOCALAPPDATA%\akkome\…` | 없으면 `homedir/akkome`(색인 5파일) 또는 `os.tmpdir()`(임시 6파일 = /tmp · 재시작 때 사라져도 무해) | 쉬움(코드 0) |
| 12 | invoice-month.js 213 | `spawnSync('python', ['-P', pdf-unlock.py])` | env **`PYTHON=/opt/venv/bin/python`** 이미 지원 · PyMuPDF 이미지에 있음 | 쉬움(코드 0) |
| 13 | payslip.js 42 pdftotext 후보 | `C:\Program Files\Git\mingw64\bin\pdftotext.exe` | env `PDFTOTEXT` 이미 지원 · 이미지에 `poppler-utils` 추가(다음 판) | 쉬움 |
| 14 | **xlsx-image.js 전체(#591)** | **Excel COM(PowerShell) → HTML·PDF 저장** + tasklist/taskkill | 리눅스엔 Excel 없음 → LibreOffice headless(`soffice --convert-to html/pdf` · 이미지 +400MB) 로 바꾸되 병합 칸·테두리·도장 그림 재현을 실측해야(10/8 「차트 Export 길은 빈 PNG」 같은 함정) | **어려움** |
| 15 | **keyword-rank.js 40(#910)** · launcher.js 783 rankMaybe | `aside.exe mcp` 자식 프로세스 | 나스에 어사이드 없음 → **1-0절 ①②** = 노트북 작업 스케줄러가 09:30 에 돌리고, 나스 launcher 는 `DESK_NO_ASIDE=1` 이면 rankMaybe 건너뜀(1줄 · 없으면 오류 결과로 keyword_rank_last 를 덮음) | 쉬움(1줄 · 필수) |
| 16 | naver-detail.js 790 안내 글 | UNC 경로 예시 | 글 한 줄 | 쉬움 |
| 17 | _preview.js · detail-compare.js · qty-image.js · xlsx-image.js Playwright | `require(ROOT/node_modules/playwright)` + `%LOCALAPPDATA%\ms-playwright` | 이미지에 Playwright 1.63 + Chromium + 의존 lib + CJK 글꼴 · 리포 node_modules 에 `npm i --no-save playwright@1.63.0` 1회(브라우저는 `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`) | 쉬움 |
| 18 | 창구열기.ps1 · `%APPDATA%\npm\akkome.cmd` · ~/.akkome/desk-path.txt | PowerShell 수동 열기(콘솔 키 env) | bash 판 `akkome.sh` 1개(같은 규칙 · 폴더 안에서만 · 키 파일 · --model opus) | 쉬움 |
| 19 | ~/.claude/settings.json 훅 4개(powershell notification.ps1·소리) · statusLine `node C:/Users/…/statusline.js` | 대표 개인 설정 | 컨테이너용 settings.json 따로(훅 없이 · statusline 경로만 리눅스) · 창구 lean 모드는 원래 user 설정을 안 읽음 | 쉬움 |
| 20 | ★에이전트오피스/업무지식.md 243·570·596 | ffmpeg·python Windows 경로 · UNC 경로 | 문서 3줄(「나스 창구에선 /share/… · ffmpeg·python 은 PATH」) | 쉬움 |
| 21 | mall-link.js 78 · mall-sync.js 43 windowsHide | 옵션 | 무해 | 없음 |
| 22 | get.js 받은파일(★에이전트오피스/받은파일) | 한글 경로 | 이미지 LANG=ko_KR.UTF-8 | 없음 |
| 23 | video-verify.py(faster-whisper · 릴스 대사) | PC 파이썬 | 빌드 인자 `WITH_WHISPER=1`(+600MB · N100 에서 느림) | 보통 |
| 24 | launcher.js writeState host=os.hostname() | 노트북 이름 | compose `hostname: akkome-nas`(화면 「창구 PC」 구분) | 없음 |
| 25 | fast.js 156 경로 정규식 | `[\\/]` 양쪽 | 그대로 | 없음 |

## 3. Docker 꾸러미(`docs/914/` · 코드 폴더 밖 · 리포 수정 0)

### 3-1. 이미지 `akkome-desk:0.1`(Dockerfile)
- 바탕 `node:24-bookworm`(나스 호스트와 같은 Debian 12 · Node 24 = PC 와 같은 판 v24.x).
- OS 겹: locales(ko_KR.UTF-8) · tzdata(Asia/Seoul) · git · tmux · openssh-client · rsync · jq · procps · iproute2 · tini · **ffmpeg** · **python3+venv** · 글꼴(fonts-noto-cjk · fonts-nanum = xlsx-image·_preview 한글).
- `/opt/venv` = **PyMuPDF**(계산서 보안메일 PDF · pdf-unlock.py) · `WITH_WHISPER=1` 이면 faster-whisper+numpy.
- `npm -g` = **Claude Code CLI 2.1.312**(PC 와 같은 판) + **Playwright 1.63.0** → `playwright install --with-deps chromium`(브라우저 /ms-playwright · 의존 lib).
- 계정 akkome **uid 1001 · gid 100** = 나스 akkome 와 같은 번호(/share·/work 파일 임자 일치).
- env = `AKKOME_CLAUDE_EXE=/usr/local/bin/claude` · `PYTHON=/opt/venv/bin/python` · `AKM_SHARE=/share` · `DESK_MODE=idle` · compose 에서 `DESK_NO_ASIDE=1`(1-0절 ②).
- 호스트(UGOS)에는 아무것도 깔지 않는다(apt 전부 이미지 안).

### 3-2. 볼륨(밖에 두는 것) · compose
| 컨테이너 | 나스 | 내용 |
|---|---|---|
| `/home/akkome` | `/volume1/docker/akkome-desk/home` | `.akkome/`(desk-api-key.txt · 로그 · 상태 json · nas.txt 제외) · `.claude/`(settings · .credentials.json · projects/<프로젝트>/memory 96개 · hooks 제외) · `.claude.json`(mcpServers · oauthAccount) · `.ssh/`(중계서버 열쇠 id_ed25519) · `.config/higgsfield/`(config·credentials) |
| `/work` | `/volume1/docker/akkome-desk/work` | 리포 clone(`git clone …/jeju-acom-company.git`) + `.env`(DATABASE_URL · CAFE24_FTP_*) + `npm install` + `npm i --no-save playwright@1.63.0` + 저장소 밖 폴더 `★에이전트오피스/비공개`(451MB)·`브랜드`(56MB) 복사 |
| `/share` | `/volume1/아꼼` **읽기 전용(:ro)** | 공유폴더(창구 규칙 「읽기만」을 마운트가 강제) |
- 공유폴더 경로 규칙 = Windows `\\192.168.0.22\아꼼\상품사진\귤\…` ↔ 컨테이너 `/share/상품사진/귤/…`(`AKM_SHARE` 가 앞머리 · 나머지 그대로 · 구분자만 `/`).
- `restart: unless-stopped` · `hostname: akkome-nas` · `shm_size: 1g`(Chromium) · `mem_limit: 5g` · `cpus: 3` · 잠금 포트 47469·47470 은 컨테이너 안 127.0.0.1(밖으로 안 연다 · 서버와는 DB 로만).

### 3-3. 기동(entrypoint.sh 모드)
- `versions` = node·python/PyMuPDF·ffmpeg·claude·chromium 5줄 찍고 끝(빌드 시험).
- `idle`(기본) = 아무것도 안 켬 · `docker exec -it -u akkome akkome-desk tmux new -As chief|worker1|worker2|worker3` 로 세션 · 리모트 컨트롤은 그 안에서 `claude` → `/remote-control`(바깥으로 열 포트 없음 · 아웃바운드만).
- `desk` = `node scripts/desk/launcher-guard.js` 를 앞에서 → 죽으면 docker 가 컨테이너를 다시 켬(= 시작프로그램 vbs 자리 · 감시자 + docker 두 겹). 🔴 **총괄 지시 뒤에만**(대표 PC 창구 먼저 내림 · 둘이면 같은 지시를 동시에 집음).

### 3-4. 열쇠·설정 옮기기 절차(명령만 · 실제 복사는 안 함 · 대표 또는 총괄이 실행)
```bash
# 대표 PC(Git Bash) → 나스 user1 홈 거쳐 docker 폴더(비번은 ssh 가 묻음 · 메신저·메일로 보내지 않음)
NAS=user1@192.168.0.22; B=/volume1/docker/akkome-desk
ssh $NAS "mkdir -p $B/home/.akkome $B/home/.claude $B/home/.ssh $B/home/.config $B/work"
scp ~/.akkome/desk-api-key.txt            $NAS:$B/home/.akkome/          # 콘솔 키(창구 과금)
scp ~/.claude/.credentials.json           $NAS:$B/home/.claude/          # 대표 요금제 로그인(또는 컨테이너 안 claude /login 1회 · 아래)
scp ~/.claude/settings.json               $NAS:$B/home/.claude/settings.json.pc   # 참고용 · 컨테이너용은 훅 빼고 새로
scp -r ~/.claude/projects/C--Users-----OneDrive------------------/memory $NAS:$B/home/.claude/projects/-work/memory   # 🔴 폴더 이름 = 프로젝트 경로(/work) 꼴로 바꿔 둠(96개)
scp ~/.claude.json                        $NAS:$B/home/.claude.json      # mcpServers(sequential-thinking·playwright · aside 는 지움) · oauthAccount
scp ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub $NAS:$B/home/.ssh/            # 중계서버 SSH 열쇠(chmod 600)
scp -r ~/.config/higgsfield               $NAS:$B/home/.config/           # 힉스필드 CLI 로그인
scp "★제주아꼼이네 회사프로그램/.env"     $NAS:$B/work/.env               # DATABASE_URL · CAFE24_FTP_*
rsync -a "★제주아꼼이네 회사프로그램/★에이전트오피스/비공개/" $NAS:$B/work/★에이전트오피스/비공개/   # 저장소 제외 451MB
rsync -a "★제주아꼼이네 회사프로그램/★에이전트오피스/브랜드/" $NAS:$B/work/★에이전트오피스/브랜드/
ssh $NAS "sudo chown -R 1001:100 $B/home $B/work && chmod 700 $B/home/.ssh && chmod 600 $B/home/.ssh/id_ed25519 $B/home/.akkome/desk-api-key.txt"
# 나스 안: 리포
ssh $NAS "cd $B/work && git clone https://github.com/bumiletter-bit/jeju-acom-company.git . && sudo docker run --rm -v $B/work:/work akkome-desk:0.1 bash -lc 'cd /work && npm install && npm i --no-save playwright@1.63.0'"
```
- MCP 등록 = `.claude.json` 의 `mcpServers` 를 가져오되 `aside`(Windows 전용) 줄은 지우고, 리눅스 `npx` 로 뜨는 sequential-thinking·playwright 만 둔다. 힉스필드 MCP(claude.ai 연결)는 로그인 뒤 저절로.
- **대표 Claude 로그인 1회**(대표 요금제) = `docker exec -it -u akkome akkome-desk claude` → `/login` → 브라우저 없는 기기용으로 **주소를 찍어 주면 대표 폰·노트북 브라우저로 열어 코드를 붙임** → `~/.claude/.credentials.json` 생김(볼륨 안에 남음). 창구 지시는 종전처럼 콘솔 키 파일(desk-api-key.txt)로 · 시험(--sub)만 대표 요금제.
- 리모트 컨트롤 = 로그인 뒤 세션 안 `/remote-control`(지금 노트북과 같음 · 나스가 켜져 있으면 폰에서 이어짐).

### 3-5. 램 가늠(PC 실측 10/29 15:xx · 작업 집합 RSS)
| 것 | 실측·가늠 | 메모 |
|---|---|---|
| Claude Code 창 1개 | **약 365MB**(4개 = 1.46GB) | 서브에이전트 띄우면 ×2 |
| 창구 launcher + 감시자 node | 약 120MB(가늠) | |
| 창구가 띄운 `claude -p` | 1~4개(PARALLEL 4) × 350 = 최대 1.4GB | 보통 1개 |
| Chromium(xlsx-image·_preview) | 300~500MB 때만 | shm 1g |
| 어사이드(PC) | 약 1.3GB(프로세스 9개 합) | 나스 Docker 엔 없음 → VM 몫 |
| **컨테이너 합** | 창구 1 + 세션 3 = **3.5~4.5GB** | `mem_limit 5g` |
| 나스 16GB | UGOS 1.5 + Win VM 8 + 컨테이너 5 = **14.5GB** | OK |
| 나스 8GB(지금) | UGOS 1.5 + 컨테이너 4 = 5.5 | VM 없이만 OK · VM 넣으면 스왑 |

## 4. 빌드 시험 결과(나스 · 10/29 15:3x~15:5x · 실측)

| 항목 | 결과 |
|---|---|
| 빌드 | `~/914-build`(user1 홈 · 파일 3개) · `sudo DOCKER_BUILDKIT=0 docker build -t akkome-desk:0.1 .` · **252초** · EXIT 0 · 이미지 **3.08GB**(node 바탕 1.1 + Chromium 2종 650MB + Playwright 의존 lib·글꼴·ffmpeg·python) |
| 버전(`docker run --rm akkome-desk:0.1 versions`) | **node v24.22.2** · **python 3.11.2 + PyMuPDF 2.0**(`import fitz` OK) · **ffmpeg 5.1.9**(Debian 판 · PC 는 9.0.2 — 자막·합치기 명령은 같음) · **claude 2.1.312**(PC 와 같은 판 · `claude -p` → 「Not logged in · /login」 = 정상) · chromium-1243 + headless_shell-1243 |
| 부속 | 계정 akkome uid 1001 gid 100 · LANG ko_KR.UTF-8 · TZ Asia/Seoul(KST) · tmux 3.3a · git 2.39.5 · 한글 글꼴 42종(Noto CJK·나눔) · 컨테이너가 보는 램 8.1GB |
| Chromium 실행 | `chromium.launch()` → 한글 h1 스크린샷 7,583바이트 · **292ms**(shm 512m) ✓ |
| 손질 2 | entrypoint `*` 모드 = 다른 명령 그대로 실행(처음엔 idle 로 떨어져 `docker run … bash` 가 멈춤 → 시험 컨테이너 1개 생겼다 지움) · `/usr/local/bin/python` 감싸기 스크립트(bash -l 이 PATH 를 되돌림 · 심볼릭 링크는 venv 를 못 찾아 `fitz` 없음 → 감싸기로 · 재빌드 뒤 `import fitz` ✓) |
| 상주 컨테이너 | **0**(창구·claude 세션 실행 0 · compose up 안 함) · /volume1/아꼼 쓰기 0 · 호스트 패키지 설치 0 |
| 미실측 | 리포 clone + `npm install`(/work 볼륨) · 컨테이너 안 `claude /login` 코드 붙이기 · `/remote-control` · launcher 리눅스 손질 뒤 `--dry` |

## 5. 대표가 정할 것 · 비용 · 위험(따로)

| 번호 | 정할 것 | 추천 | 비고 |
|---|---|---|---|
| ① | 어사이드 자리 | **노트북만(대표 확정 10/29)** → 1-0절 다리 구도 · 「나스에서도」는 나중 선택지(1-2절 · A1 · Windows VM + Win11 Pro 라이선스) | |
| ② | 램 16GB 교체(슬롯 1개 · 기존 8GB 빼고 16GB 한 장 · DDR5-4800 SO-DIMM) | 확정(총괄 10/29 · Docker 여유) | 32~36만 원 · 8GB 로도 Docker 창구·세션 3 은 돎(3-5절 · 여유 없음) |
| ③ | 키워드 순위 09:30 을 노트북에 어떻게 남기나 | 작업 스케줄러 1건(install-keyword-rank.js 40줄 · 또는 손 등록) + launcher 1줄(DESK_NO_ASIDE) | 노트북 꺼져 있으면 10:00 알림 그대로 |
| ④ | 노트북 역할 | 어사이드(키워드 순위·네이버 조사 세션) · 크롬 확장·대표 로그인 브라우저 일 · 리모트 컨트롤 조종 · 대표 요금제 재로그인 | 꺼져도 창구·나스 세션은 돎 |
| ⑤ | 엑셀 그림(xlsx-image) | 나스 창구에선 엑셀 파일만 첨부(그림 생략) · 그림 필요하면 LibreOffice 추가(나중) | 1-0절 ⑥ |
| ⑥ | 창구 켜는 시점·순서 | 코드 손질(2-2절 보통 3 + 1줄) → 교차 점검 → 열쇠 복사(3-4절) → 색인 재생성 → 나스 창구 켬 + PC 창구 내림 → 24시간 병행 관찰 → 노트북 스케줄러 등록 | 총괄이 줄 세움 · 램은 병행 안 함(나중 교체도 됨) |

**위험**: N100 4코어 · VM 과 컨테이너가 코어를 나눠 씀(VM 2~3 · 컨테이너 2~3 · 동시에 무거우면 느림) / ext4 라 VM 스냅샷 없음 → VM 내보내기 백업 주 1회 / Windows 업데이트 재시작 → 감시자가 창구 살림(지금과 같음) / 어사이드 무거운 캡처 때 탭 끊김(#907) 은 VM 에서 더 쉬움 / 나스가 꺼지면 공유폴더·창구·세션 전부 멈춤(단일 지점 · UPS 고려) / 열쇠가 나스 한 곳에 모임(docker 폴더 권한 = akkome·admin 만 · SMB 로 열어 두지 말 것).
**비용 요약**: 램 32~36만 · 그 밖 0(Docker 무료 · 요금 구도 그대로 = 대표 계정 지시 대표 요금제 · 직원 지시 콘솔 키 · Windows 라이선스는 VM 길을 고를 때만).

## 6. 미확인·다음
- UGOS 가상 머신 앱의 Windows 11 설치 실측(ISO·TPM 우회)은 램 도착 뒤 — 대표 입회.
- 컨테이너 안 `claude /login` 코드 붙이기 흐름 · `/remote-control` 은 실측 전(문서·종전 경험 기준).
- A2 로 가면 2-2절 3·4·9·14·15 코드 손질 + 교차 점검 + 창구 24시간 병행.

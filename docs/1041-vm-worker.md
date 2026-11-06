# #1041-b 총괄 → 나스 VM 지시 길(창구 대기열 「[VM]」)

리모트 컨트롤 세션(「워커 VM」)은 다른 기계에서 보낸 SendMessage를 받지 못합니다(#1041 판정). 그래서 총괄은 창구 대기열(`pending_orders`)에 지시를 넣고, VM 안의 러너가 그 지시를 집어 처리합니다.

## 흐름

| 단계 | 하는 곳 | 내용 |
|---|---|---|
| 넣기 | 총괄(또는 화면 「클코에게 지시하기」) | `content` 머리를 `[VM] `로 시작하는 지시를 `status '대기'`로 넣음. 시험 지시는 `created_by_id` 990000+ |
| 거름 | 창구(launcher·get·watch)·server.js 기동 복구 | `content NOT LIKE '[VM]%'` (워커1 몫). 창구는 이 지시를 안 집고, 처리중으로 되돌리지도 않음 |
| 집기 | VM `scripts/vm/vm-watch.js` | 30초마다 `[VM]` 대기 1건을 `처리중`으로 바꿈. 흔적은 audit `desk_claim`·source `vm`. 집는 줄 = `created_by` 「창구 → VM」(창구가 승인 뒤 넘김) · `created_by_id` ≥ 990000(총괄 전용) · 관리자 계정(users.role admin = 대표·조가영)만. 직원이 직접 친 `[VM]`은 대기에 그대로 둠 |
| 처리 ① | 정해진 명령 | 본문이 「순위 확인」「순위 다시」「키워드 순위」 류의 짧은 한 마디(`RANK_RE` · 30자 이하)면 claude 없이 `node scripts/desk/keyword-rank.js --apply`(20분 상한). 답 = DB `keyword_rank_last` 요약(수집 n · 실패 · 막힘) |
| 처리 ② | claude | `claude -p --model claude-opus-5-5 --output-format json --allowedTools mcp__aside__repl,mcp__aside__exec --disallowedTools Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Read,Grep,Glob`. 파일 읽기 도구를 막아 .env 유출을 막습니다. 작업 폴더는 늘 `~/.akkome/vm-out/<지시번호>`(리포 CLAUDE.md 안 실림 · .env 있는 VM 설정 폴더도 피함), 본문은 stdin, 상한은 10분 |
| 올리기 | vm-watch.js | `완료` 상태, 답 끝줄 「— 나스 VM 어사이드 처리」(첨부가 있으면 그 앞에 「첨부는 10일 뒤 여기서 지워져요」). 첨부는 `ATTACH: <경로>` 줄로 받고, `~/.akkome/vm-out/<지시번호>/` 안 파일만 `report_files`로 올림(5개 · 10MB · 창구와 같은 확장자). 요청자에게 종 알림이 가고, 시험 계정에는 가지 않음 |
| 실패 | vm-watch.js | 첫 실패는 `대기`로 한 번 되돌림. 두 번째 실패는 `오류` 상태로 사유를 남김 |

## 막이

- 어사이드는 한 번에 하나만 씁니다.
  - 체험 번호 틱과 같은 잠금 파일 `~/.akkome/exp-phone-auto.lock`을 공유합니다. 잡기는 `openSync(wx)`(이미 있으면 실패 · exp-phone-auto.js 도 같은 꼴)이고, 쓰는 동안 1분마다 mtime을 갱신해 15분 stale 판정에 걸리지 않게 합니다.
  - 키워드 순위가 도는 중이면(`keyword-rank.json`) 쉽니다. 09:30 키워드 창은 상한만큼 앞당겨 claude 길 09:20~09:45, 순위 갈래 09:10~09:45에 쉽니다. 지시는 대기에 남습니다.
- 중복 실행을 막습니다.
  - 도는 사이 누가 `대기`로 되돌렸어도 결과는 그대로 올립니다(respond.js와 같은 조건).
  - VM이 이미 답한 줄(audit `desk_respond`·`vm`)이 다시 `대기`가 되면 안 집고, 결과대로 완료·오류로 되돌립니다.
  - 같은 지시는 하루 2번까지만 집습니다.
- 창구 heartbeat(`desk_heartbeat`)는 건드리지 않습니다. VM은 `vm_heartbeat` {at, state, order_id, host}를 60초마다 따로 씁니다.
  - 그래서 창구 `get.js`·`respond.js`를 부르지 않고 같은 꼴을 vm-watch.js 안에 두었습니다. 둘 다 desk_heartbeat를 덮기 때문입니다.
- 기동 복구는 VM 이 집을 수 있는 `[VM]` 처리중 줄만(위 「집는 줄」 조건 · 직원 `[VM]`은 창구 몫이라 안 건드림) 대기로 되돌립니다. 도는 동안 1분마다 잠금 mtime 과 vm_heartbeat(busy · order_id · pid)를 같이 갱신합니다. `vm_heartbeat`가 2분 안이고 그 지시를 돌리는 다른 살아 있는 러너(다른 기계 또는 같은 기계의 다른 pid)가 있으면 그 줄은 건너뜁니다.
- 그림 첨부 지시는 받지 않습니다(글로만). 받으면 바로 `오류`로 답합니다.
- 프롬프트 규칙:
  - 저장·발송·결제·삭제·설정 단추는 누르지 않습니다.
  - 로그인이나 보안 확인 화면이 나오면 탭을 그대로 두고 안내만 합니다.
  - 비밀번호·토큰·.env 값은 읽지도 쓰지도 않습니다.
  - 번호는 끝 4자리만 씁니다.

## VM에 올리기(총괄)

1. VM 리포에서 `git pull`을 합니다. VM에는 자동 pull이 없습니다.
2. `.env`에 `DATABASE_URL`이 있는지 봅니다. `node scripts/vm/install-vm-watch.js --status`로 이름만 확인됩니다.
3. 한 번 시험합니다: `node scripts/vm/vm-watch.js --once`. 시험 지시는 미리 `[VM] 순위 다시` 또는 `[VM] <어사이드로 볼 화면>`으로 넣어 둡니다. created_by_id 990000+.
4. 등록합니다: `node scripts/vm/install-vm-watch.js --install`. 작업 「아꼼이-VM러너」가 로그온 때 시작하고, 죽으면 1분 뒤 다시 뜹니다. 지금 띄우려면 `--run`.
5. 되돌리려면 `--remove`를 하고, 남은 node가 있으면 작업 관리자에서 끕니다.

로그는 다음 파일에 남습니다.
- `~/.akkome/logs/vm-watch-YYYY-MM-DD.log`: 지시 본문은 머리 60자만 적힙니다.
- `~/.akkome/vm-watch-task.log`: 작업 출력.
- `~/.akkome/vm-watch-state.json`: 시도 횟수.

## 검증

`node scripts/verify-1041-vm-watch.js`: pglite와 가짜 claude·가짜 keyword-rank로 67/67. 실DB·어사이드·claude는 쓰지 않습니다. 09:20~09:45에 돌리면 [4]가 「쉼」으로 실패합니다.

## 미확인

- `claude -p`가 작업 스케줄러 세션에서 aside MCP(user 설정)를 싣는지는 VM 첫 `--once`에서 확인해야 합니다.
- `--output-format json`의 `result` 칸 꼴은 이번 버전(2.1.318) 기준으로 가정했습니다.
- VM의 claude 경로는 `~/.local/bin/claude.exe`로 가정했습니다. 다르면 env `VM_CLAUDE_BIN`.

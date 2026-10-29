#!/bin/bash
# #917 나스 터미널(총괄·워커 Claude Code 4개) 켜기/끄기/상태 — 늘 켜 두지 않는다(대표 10/29 「내 PC 가 꺼져 있을 때만」 · 램).
#   자리 = 리포 docs/914/sessions.sh → 나스 컨테이너 akkome-desk 안 /work/docs/914/sessions.sh (창구와 같은 컨테이너 · 사용자 akkome · 이미지 재빌드 0 · 자동 기동 0)
#   사용:  bash /work/docs/914/sessions.sh on      → tmux 세션 「akm」 창 4개 = chief(`claude remote-control --name "총괄 나스"` → 폰 리모트 컨트롤 목록에 보임) · worker1·2·3(`claude` 대화형) · cwd /work
#          bash /work/docs/914/sessions.sh off     → 창마다 /exit 보내 claude 를 정상 종료(최대 20초) → tmux 세션 끔 → 쉬는 감시도 끔
#          bash /work/docs/914/sessions.sh status  → JSON 한 줄 {on, windows[], idle_min, idle_limit_h, rss_mb, watcher}
#          bash /work/docs/914/sessions.sh watch   → (on 이 저절로 띄움) 60초마다 ①노트북 신호(agent_office_config notebook_alive.at · 5분 안 = 켜짐)가 있으면 off + 로그 「노트북 켜짐 → 나스 터미널 끔」 ②5분마다 마지막 활동(세션 jsonl mtime · 워커 창 활동 · chief 창 주기 출력 제외)을 보고 N시간(기본 6 · ~/.akkome/sessions.json {"idle_hours":6} 또는 env AKM_SESSIONS_IDLE_H) 입력·출력이 없으면 off · DB 못 읽으면 끄지 않음(로그만)
#   on 첫 줄 = 노트북 신호가 5분 안이면 켜지 않고 「노트북이 켜져 있어 나스 터미널은 켜지 않아요(노트북 창을 쓰세요)」 + exit 2(대표 「노트북 켜 있으면 나스 터미널이 꺼지도록」 10/29)
#   켜는 길 = 대표가 앱에서 창구에 「나스 터미널 켜줘 / 꺼줘 / 상태」(관리자 지시 · 바로 실행) → 창구가 이 스크립트를 돎(업무지식 문장은 설계서 6절).
#   붙기(나스 ssh) = sudo docker exec -it -u akkome akkome-desk tmux attach -t akm  (창 Ctrl-b 0~3 · 떼기 Ctrl-b d)
#   마지막 줄은 항상 JSON(창구가 읽기 쉽게). 열쇠·값은 찍지 않는다.
#   #918 상태는 실DB agent_office_config 'nas_terminal' = {on, windows, idle_min, rss_mb, at, host, refused?, models} 에도 적는다(on/off 끝·status·watch 60초마다 · 화면 머리 카드 터미널 칩 몫 = 워커1 · DB 오류는 조용히)
#   #919 창마다 모델(대표 10/29 「워커3만 페블 · 이 틀 그대로 · 사용량에 따라 바꿀 수 있게」) — 기본 틀 = chief fable · worker1 opus · worker2 opus · worker3 fable(노트북 창 구성과 같음)
#          표 = ~/.akkome/sessions.json {"models":{"chief":"fable",…}}(idle_hours 열쇠와 같은 파일 · 없으면 기본 틀) · 값은 fable|opus|sonnet 세 낱말만 → 안에서 실제 ID(claude-fable-5-1 · claude-opus-5-5 · claude-sonnet-5-5 · 10/29 컨테이너 claude 2.1.312 --output-format json modelUsage 실측)
#          on = 워커 창 `claude --model <ID>` · chief 창은 remote-control 에 --model 이 없어(--help 실측) `ANTHROPIC_MODEL=<ID>` 환경으로(spawn 되는 세션이 물려받음 · -p 실측 = 그 모델)
#          bash sessions.sh model <all|chief|worker1|worker2|worker3> <fable|opus|sonnet>  → 표 갱신 + 켜져 있으면 워커 창에 `/model <ID>` 를 보내 바로 바뀜 · chief 는 창을 다시 띄움(remote-control 서버라 /model 을 받을 곳이 없음 · 폰 대화 중이면 끊김) · 안 켜져 있으면 다음 on 부터
#          bash sessions.sh model reset  → 기본 틀로(「모델 원래대로」)
set -u
export LANG=${LANG:-ko_KR.UTF-8} TZ=${TZ:-Asia/Seoul}
S=akm
AK="$HOME/.akkome"; mkdir -p "$AK"
LOG="$AK/launcher.log"                      # 창구 로그에 한 줄(append 만)
WPID="$AK/sessions-watch.pid"
CFG="$AK/sessions.json"
WINS="chief worker1 worker2 worker3"
wpid_ok() {   # 감시 pid 파일이 「이 스크립트의 watch」 프로세스를 가리킬 때만 참(컨테이너 재시작 뒤 번호 재사용으로 남의 프로세스를 끄지 않게)
    local p; [ -f "$WPID" ] || return 1; p=$(cat "$WPID" 2>/dev/null); [[ "$p" =~ ^[0-9]+$ ]] || return 1
    [ -r "/proc/$p/cmdline" ] || return 1
    tr '\000' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "sessions.sh watch"   # cmdline 은 NUL 로 나뉜 글 → 8진수 \000 으로 바꿔 봄(스크립트에 NUL 글자를 직접 넣으면 bash 가 뒤를 못 읽음 · 10/29 실측)
}
idle_limit_h() {
    local h="${AKM_SESSIONS_IDLE_H:-}"
    [ -z "$h" ] && [ -f "$CFG" ] && h=$(node -e 'try{const j=require(process.argv[1]);console.log(Number(j.idle_hours)||"")}catch(e){console.log("")}' "$CFG" 2>/dev/null)
    [[ "$h" =~ ^[0-9]+([.][0-9]+)?$ ]] || h=6
    echo "$h"
}
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) [나스 터미널] $*" >> "$LOG" 2>/dev/null; echo "[sessions] $*"; }
# #919 모델 틀 — 표 = $CFG {"models":{창:낱말}} · 낱말 fable|opus|sonnet 만(그 밖·빈칸 = 기본 틀) · 실제 ID 는 model_id
MODEL_DEFAULT='{"chief":"fable","worker1":"opus","worker2":"opus","worker3":"fable"}'
model_id() { case "$1" in fable) echo claude-fable-5-1 ;; opus) echo claude-opus-5-5 ;; sonnet) echo claude-sonnet-5-5 ;; *) echo "" ;; esac; }
models_json() {   # 기본 틀 위에 표 파일 값을 얹어 {"chief":"fable",…} 한 줄
    node -e 'const d=JSON.parse(process.argv[2]);let j={};try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){}const m=(j&&j.models)||{};for(const k of Object.keys(d)){if(["fable","opus","sonnet"].includes(m[k]))d[k]=m[k]}console.log(JSON.stringify(d))' "$CFG" "$MODEL_DEFAULT" 2>/dev/null || echo "$MODEL_DEFAULT"
}
model_of() { models_json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let m="";try{m=JSON.parse(s)[process.argv[1]]||""}catch(e){}console.log(m||"opus")})' "$1" 2>/dev/null || echo opus; }
win_cmd() {   # --spawn 없으면 「Choose [1/2]」 물음에서 멈춤(10/29 실측) · 모델 = 워커 --model · chief 는 ANTHROPIC_MODEL(remote-control 에 --model 없음)
    local id; id="$(model_id "$(model_of "$1")")"
    case "$1" in chief) echo "ANTHROPIC_MODEL=$id claude remote-control --name \"총괄 나스\" --spawn=same-dir" ;; *) echo "claude --model $id" ;; esac
}
# 노트북이 켜져 있나 = 실DB agent_office_config 'notebook_alive' {at, host}(노트북 창구가 2분마다 씀 · 워커2) → 지난 분(음수 = 노트북 시계 빠름 = 켜짐) · 없음 = NONE · DB 못 읽음 = ERR(읽기만 · _db.js pool)
NOTEBOOK_FRESH_MIN=5
notebook_alive_min() {
    (cd /work && timeout 20 node -e '
const {pool}=require("./scripts/desk/_db.js");
(async()=>{try{const r=await pool.query("SELECT value FROM agent_office_config WHERE key = $1",["notebook_alive"]);const v=r.rows[0]&&r.rows[0].value;const at=v&&v.at?Date.parse(v.at):NaN;console.log(Number.isFinite(at)?Math.floor((Date.now()-at)/60000)+" "+String(v.host||""):"NONE")}catch(e){console.log("ERR "+String(e.message||e).slice(0,80))}finally{try{await pool.end()}catch(e){}}})();' 2>/dev/null) || echo "ERR node"
}
has() { tmux has-session -t "=$S" 2>/dev/null; }
wins_now() { tmux list-windows -t "=$S" -F '#W' 2>/dev/null | tr '\n' ' '; }
rss_mb() {   # 세션 안 프로세스(tmux 서버 자식 전부) RSS 합
    local pids; pids=$(tmux list-panes -s -t "=$S" -F '#{pane_pid}' 2>/dev/null)
    [ -z "$pids" ] && { echo 0; return; }
    local sum=0 p
    for p in $pids; do for c in $p $(pgrep -P "$p" 2>/dev/null) $(for q in $(pgrep -P "$p" 2>/dev/null); do pgrep -P "$q"; done 2>/dev/null); do sum=$((sum + $(awk '/VmRSS/{print $2}' /proc/$c/status 2>/dev/null || echo 0))); done; done
    echo $((sum / 1024))
}
idle_min() {   # 마지막 활동 뒤 지난 분 = max(① ~/.claude/projects/-work/*.jsonl mtime = 사람 입력·AI 답(리모트 컨트롤로 시킨 일도 여기 적힘) · ② 워커 창 window_activity) 기준
               # 🔴 session_activity 는 붙은 클라이언트가 없으면(send-keys·리모트 컨트롤) 안 갱신되고, chief 창은 remote-control 이 50초마다 출력해 늘 새로움 → 둘 다 안 씀(10/29 실측)
    has || { echo -1; return; }
    local now last=0 t
    now=$(date +%s)
    t=$(ls -t --time-style=+%s -l "$HOME"/.claude/projects/-work/*.jsonl 2>/dev/null | awk 'NR==1{print $6}'); [[ "$t" =~ ^[0-9]+$ ]] && [ "$t" -gt "$last" ] && last=$t
    for t in $(tmux list-windows -t "=$S" -F '#W #{window_activity}' 2>/dev/null | awk '$1!="chief"{print $2}'); do [[ "$t" =~ ^[0-9]+$ ]] && [ "$t" -gt "$last" ] && last=$t; done
    [ "$last" -gt 0 ] || last=$(tmux display -p -t "=$S" '#{session_created}' 2>/dev/null || echo "$now")
    echo $(( (now - last) / 60 ))
}
# #918 상태를 실DB agent_office_config 'nas_terminal' 에 적는다(화면 머리 카드 터미널 칩이 읽음 · 워커1) — {on, windows, idle_min, rss_mb, at(ISO UTC), host:"akkome-nas", refused?} · UPSERT 한 줄 · DB 오류면 조용히(출력·종료 코드에 영향 0)
db_state() {   # $1 = JSON 글(on·windows·idle_min·rss_mb[·refused]) → at·host 를 더해 저장
    local j="$1"
    (cd /work && timeout 15 node -e '
const {pool}=require("./scripts/desk/_db.js");const j=JSON.parse(process.argv[1]);j.at=new Date().toISOString();j.host="akkome-nas";
(async()=>{try{await pool.query("INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",["nas_terminal",JSON.stringify(j)])}catch(e){}finally{try{await pool.end()}catch(e){}}})();' "$j" >/dev/null 2>&1) || true
}
status_json() {   # 화면용 JSON 한 줄 + DB nas_terminal 갱신(DB_EXTRA = 덧붙일 칸 · 예 ,"refused":"notebook")
    local on=false w="" im=-1 rss=0 wp=""
    if has; then on=true; w="$(wins_now)"; im=$(idle_min); rss=$(rss_mb); fi
    wpid_ok && wp=$(cat "$WPID")
    local mj; mj="$(models_json)"
    printf '{"on":%s,"windows":"%s","idle_min":%s,"idle_limit_h":%s,"rss_mb":%s,"watcher_pid":"%s","models":%s,"attach":"sudo docker exec -it -u akkome akkome-desk tmux attach -t %s"}
' "$on" "${w% }" "$im" "$(idle_limit_h)" "$rss" "$wp" "$mj" "$S"
    db_state "$(printf '{"on":%s,"windows":"%s","idle_min":%s,"rss_mb":%s,"models":%s%s}' "$on" "${w% }" "$im" "$rss" "$mj" "${DB_EXTRA:-}")"
}
start_win() {
    local name="$1" cmd; cmd="$(win_cmd "${2:-$1}")"   # $2 = 역할(chief2 창을 chief 명령으로 띄울 때)
    if has; then tmux new-window -t "=$S" -n "$name" -c /work "bash -lc 'cd /work; $cmd'"
    else tmux new-session -d -s "$S" -n "$name" -c /work -x 200 -y 50 "bash -lc 'cd /work; $cmd'"; fi
}
ensure_trust() {   # /work 폴더 신뢰 표시(없으면 창마다 「Trust /work? [y/N]」에서 멈춤 · 10/29 실측) — ~/.claude.json projects["/work"].hasTrustDialogAccepted
    node -e '
const fs=require("fs"),p=process.env.HOME+"/.claude.json";let j={};try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}
j.projects=j.projects||{};const w=j.projects["/work"]||{};
if(!w.hasTrustDialogAccepted){w.hasTrustDialogAccepted=true;w.allowedTools=w.allowedTools||[];w.mcpContextUris=w.mcpContextUris||[];w.enabledMcpjsonServers=w.enabledMcpjsonServers||[];w.disabledMcpjsonServers=w.disabledMcpjsonServers||[];w.hasCompletedProjectOnboarding=true;j.projects["/work"]=w;fs.writeFileSync(p,JSON.stringify(j,null,2));console.log("[sessions] /work 신뢰 표시 넣음")}' 2>/dev/null || true
}
FORCE=0; [ "${2:-}" = "--force" ] && FORCE=1    # on --force = 노트북 신호 무시(총괄 시험 전용 · 업무지식엔 안 적음 · 그 실행의 감시도 노트북 조건 끔 · 6시간 무입력 off 는 그대로)
do_on() {
    local nb=NONE; [ "$FORCE" = 1 ] || nb=$(notebook_alive_min); local nbm=${nb%% *}
    if [[ "$nbm" =~ ^-?[0-9]+$ ]] && [ "$nbm" -lt "-10" ]; then log "노트북 신호 시각이 ${nbm}분 미래(시계 틀림) → 없음 취급"; nbm=NONE; fi
    if [[ "$nbm" =~ ^-?[0-9]+$ ]] && [ "$nbm" -le "$NOTEBOOK_FRESH_MIN" ]; then   # -10 ≤ n ≤ 5 = 켜짐(작은 음수 = 노트북 시계가 조금 빠름)
        log "켜지 않음 · 노트북(${nb#* }) 이 ${nbm}분 전까지 살아 있음"
        echo "노트북이 켜져 있어 나스 터미널은 켜지 않아요(노트북 창을 쓰세요) · 노트북 ${nb#* } · ${nbm}분 전 신호"
        DB_EXTRA=',"refused":"notebook"' status_json; exit 2
    fi
    [[ "$nb" == ERR* ]] && log "노트북 신호를 못 읽음(DB) → 그래도 켬: ${nb#ERR }"
    ensure_trust
    if has; then
        local missing=0
        for w in $WINS; do wins_now | tr ' ' '\n' | grep -qx "$w" || { start_win "$w"; missing=$((missing+1)); sleep 3; }; done
        log "이미 켜져 있음 · 빠진 창 $missing 개 다시 띄움 · 창 = $(wins_now)"
    else
        for w in $WINS; do start_win "$w"; sleep 4; done     # 네 개가 한꺼번에 뜨지 않게(램 피크)
        tmux set-option -t "=$S" history-limit 20000 2>/dev/null || true
        log "켬$([ "$FORCE" = 1 ] && echo "(--force · 노트북 신호 무시)") · 창 4 = $(wins_now)· 총괄 창 = remote-control 「총괄 나스」 · 모델 $(models_json) · 쉬면 $(idle_limit_h)시간 뒤 저절로 끔"
    fi
    if ! wpid_ok; then
        rm -f "$WPID"
        AKM_FORCE="$FORCE" setsid nohup bash "$0" watch > /dev/null 2>&1 &    # setsid = 새 세션·그룹 → 창구 claude -p 그룹(killTree -pgid)과 함께 죽지 않음
        echo $! > "$WPID"
    fi
    sleep 2; status_json
}
do_off() {
    if wpid_ok; then kill "$(cat "$WPID")" 2>/dev/null; fi; rm -f "$WPID"
    if has; then
        local rss; rss=$(rss_mb)
        for w in $(wins_now); do tmux send-keys -t "=$S:$w" C-u "/exit" Enter 2>/dev/null; done   # claude 정상 종료
        for i in $(seq 1 20); do has || break; [ -z "$(wins_now)" ] && break; sleep 1; done
        has && tmux kill-session -t "=$S" 2>/dev/null
        log "끔 · 꺼지기 전 램 ${rss}MB · 창구는 그대로"
    else
        log "끌 것 없음(이미 꺼져 있음)"
    fi
    status_json
}
do_watch() {   # 60초마다 · ①노트북이 살아 있으면(5분 안) off ②쉰 시간이 한도 넘으면 off · DB 못 읽으면 끄지 않음(로그만 · 상태 바뀔 때 한 번)
    echo $$ > "$WPID"   # 스스로 적기(setsid 가 fork 하는 경우에도 pid 파일이 맞게)
    local n=0 errLogged=0
    while :; do
        sleep 60; n=$((n+1))
        has || { db_state '{"on":false,"windows":"","idle_min":-1,"rss_mb":0}'; log "세션이 밖에서 끝나 감시 종료(DB nas_terminal off 로)"; rm -f "$WPID"; exit 0; }   # 창을 손으로 닫아 tmux 가 저절로 끝난 경우 on:true 로 굳지 않게(#918 교차 점검)
        db_state "$(printf '{"on":true,"windows":"%s","idle_min":%s,"rss_mb":%s,"models":%s}' "$(wins_now | sed 's/ $//')" "$(idle_min)" "$(rss_mb)" "$(models_json)")"   # #918 60초마다 상태(#919 models)
        local nb=NONE; [ "${AKM_FORCE:-0}" = 1 ] || nb=$(notebook_alive_min); local nbm=${nb%% *}
        if [[ "$nbm" =~ ^-?[0-9]+$ ]] && [ "$nbm" -lt "-10" ]; then [ "$errLogged" = 0 ] && log "노트북 신호 시각이 ${nbm}분 미래(시계 틀림) → 없음 취급"; nbm=NONE; fi
        if [[ "$nbm" =~ ^-?[0-9]+$ ]] && [ "$nbm" -le "$NOTEBOOK_FRESH_MIN" ]; then
            log "노트북 켜짐(${nb#* } · ${nbm}분 전 신호) → 나스 터미널 끔"
            rm -f "$WPID"; bash "$0" off > /dev/null 2>&1; exit 0
        fi
        if [[ "$nb" == ERR* ]]; then [ "$errLogged" = 0 ] && { log "노트북 신호를 못 읽음(DB · 끄지 않음): ${nb#ERR }"; errLogged=1; }; else errLogged=0; fi
        [ $((n % 5)) -ne 0 ] && continue
        local im lim; im=$(idle_min); lim=$(idle_limit_h)
        if [ "$im" -ge 0 ] && [ "$im" -ge "$(awk -v h="$lim" 'BEGIN{printf "%d", h*60}')" ]; then
            log "쉰 지 ${im}분(한도 ${lim}시간) → 저절로 끔"
            rm -f "$WPID"; bash "$0" off > /dev/null 2>&1; exit 0
        fi
    done
}
# ---- #919 model 보조 ----
win_ready() {   # 워커 창이 입력 대기인지(워커2 점검 ①) = 화면 끝 25줄에 바쁨·선택 메뉴 글 없음 + 마지막 입력 줄(❯)에 쳐 둔 글자 없음 · 아니면 1(건너뜀 · 바쁜 창·권한 물음에 Enter 가 들어가면 기본값을 고를 수 있음)
               # 빈 입력 줄 = 「❯ Try "…"」 자리 글(흐린 글 · 10/29 실측 · ❯ 뒤는 NBSP) → 자리 글은 빈칸으로 침 · NBSP(0xC2A0)는 미리 지움
               # 판정 범위(워커2 재점검 ⓐ-1) = 「esc to interrupt」만 끝 25줄 · 선택 메뉴·권한 물음 글은 입력 상자 구간(끝에서 두 번째 ─ 줄부터 끝 · ─ 줄이 둘 미만이면 끝 8줄)만 — 지난 답에 든 「Do you want」「Yes, 」 때문에 거짓 바쁨이 나지 않게
    local pane zone last n2
    pane="$(tmux capture-pane -p -t "=$S:$1" 2>/dev/null | sed 's/[[:space:]]*$//' | grep -v '^$' | tail -25)" || return 1
    pane="${pane//$'\xc2\xa0'/ }"   # NBSP → 빈칸(지우면 「❯Try」로 붙어 입력 줄로 안 보임)
    [ -n "$pane" ] || return 1
    printf '%s\n' "$pane" | grep -q -i 'esc to interrupt' && return 1
    n2="$(printf '%s\n' "$pane" | grep -n -E '^[[:space:]]*(─){3,}[[:space:]]*$' | tail -2 | head -1 | cut -d: -f1)"
    if [ -n "$n2" ]; then zone="$(printf '%s\n' "$pane" | tail -n +"$n2")"; else zone="$(printf '%s\n' "$pane" | tail -8)"; fi
    printf '%s\n' "$zone" | grep -q -i -E 'Do you want|\(y/n\)|\[y/N\]|Yes, |No, |Choose |Enter to confirm|Esc to cancel|Press Enter|to select' && return 1
    printf '%s\n' "$zone" | grep -q -E '^[[:space:]]*(❯|>)([[:space:]]|$)' || return 1
    last="$(printf '%s\n' "$zone" | grep -E '^[[:space:]]*(❯|>)([[:space:]]|$)' | tail -1 | sed -E 's/^[[:space:]]*(❯|>)[[:space:]]*//; s/^Try ".*//')"   # 자리 글은 폭에 잘려 닫는 따옴표가 없을 수 있어 느슨하게(ⓐ-2)
    [ -z "$last" ]
}
chief_model_now() {   # 지금 chief(remote-control) 프로세스의 ANTHROPIC_MODEL(environ) · 모르면 빈칸(= 다시 띄움)
    local p m
    for p in $(pgrep -f "^claude remote-control" 2>/dev/null); do m="$(tr '\000' '\n' < "/proc/$p/environ" 2>/dev/null | sed -n 's/^ANTHROPIC_MODEL=//p' | head -1)"; [ -n "$m" ] && { echo "$m"; return; }; done
    echo ""
}
chief_restart() {   # 새 창(chief2)을 먼저 띄워 세션이 비는 틈을 없애고(워커2 점검 ⑤ · watch 의 has 실패 방지) → 옛 창 끔 → 이름 chief 로
                    # 🔴 remote-control 은 같은 폴더에 둘이 못 뜬다(10/29 실측 · 옛 창이 살아 있을 때 새 것을 띄우면 바로 꺼져 창이 사라짐) → 새 창은 3초 기다린 뒤 claude 를 켜고 그 사이에 옛 창을 끔
    local cmd; cmd="$(win_cmd chief)"
    tmux kill-window -t "=$S:chief2" 2>/dev/null
    tmux new-window -t "=$S" -n chief2 -c /work "bash -lc 'cd /work; sleep 3; $cmd'"
    sleep 0.5; tmux kill-window -t "=$S:chief" 2>/dev/null; sleep 1
    tmux rename-window -t "=$S:chief2" chief 2>/dev/null
}
SJ="$HOME/.claude/settings.json"; ORIG="$AK/model-orig.json"
settings_save() {   # /model 보내기 전에 settings.json 의 model 열쇠 상태를 적어 둠 {has, model}(없던 열쇠면 has:false → 되돌릴 때 delete · 워커2 점검 ②)
    node -e 'const fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){}const has=Object.prototype.hasOwnProperty.call(j,"model");fs.writeFileSync(process.argv[2],JSON.stringify({has,model:has?j.model:null})+"\n")' "$SJ" "$ORIG" 2>/dev/null || true
}
settings_restore() {   # 적어 둔 상태와 다르면 되돌림(같으면 건너뜀 · 실패는 조용히)
    [ -f "$ORIG" ] || return 0
    node -e 'const fs=require("fs"),p=process.argv[1],o=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));let j;try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){process.exit(0)}if(!j||typeof j!=="object")process.exit(0);const has=Object.prototype.hasOwnProperty.call(j,"model");if(has===o.has&&(!has||j.model===o.model))process.exit(0);if(o.has)j.model=o.model;else delete j.model;fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' "$SJ" "$ORIG" 2>/dev/null || true
}
do_restore_bg() { sleep 3; settings_restore; sleep 7; settings_restore; sleep 20; settings_restore; exit 0; }   # 3·10·30초 세 번(잠금 fd 9 를 물려받아 끝날 때까지 다음 model 명령은 기다림 · ③)
do_model() {   # #919 model <all|chief|worker1|worker2|worker3> <fable|opus|sonnet> | model reset — 표 갱신 + 켜져 있으면 바로 적용 · 마지막 줄 JSON
    local tgt="${2:-}" val="${3:-}" id="" usage='{"ok":false,"error":"사용: sessions.sh model <all|chief|worker1|worker2|worker3> <fable|opus|sonnet> | model reset"}'
    if [ "$tgt" = reset ]; then tgt=all; val=reset
    else
        case " all $WINS " in *" $tgt "*) [ -n "$tgt" ] || { echo "$usage"; exit 1; } ;; *) echo "$usage"; exit 1 ;; esac
        id="$(model_id "$val")"; [ -n "$id" ] || { echo "$usage"; exit 1; }
    fi
    exec 9>"$AK/model.lock"; flock -w 90 9 || { echo '{"ok":false,"error":"앞선 model 명령의 되돌림이 아직 끝나지 않음 · 잠시 뒤 다시"}'; exit 1; }   # 되돌림 경합 막기(③)
    # 표 파일 갱신(idle_hours 등 다른 열쇠 유지 · reset = models 열쇠 지움 = 기본 틀) · 바쁜 창은 표에만 적혀 다음 on 부터
    node -e '
const fs=require("fs"),p=process.argv[1],tgt=process.argv[2],val=process.argv[3],d=JSON.parse(process.argv[4]);let j={};try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}if(!j||typeof j!=="object")j={};
if(val==="reset"){delete j.models}else{j.models=Object.assign({},d,j.models||{});if(tgt==="all"){for(const k of Object.keys(d))j.models[k]=val}else j.models[tgt]=val}
fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' "$CFG" "$tgt" "$val" "$MODEL_DEFAULT" || { echo '{"ok":false,"error":"표 파일 쓰기 실패"}'; exit 1; }
    local applied="" restarted="" skipped="" chief_state="" w wid on=false
    if has; then
        on=true
        for w in $WINS; do
            [ "$tgt" = all ] || [ "$w" = "$tgt" ] || continue
            wins_now | tr ' ' '\n' | grep -qx "$w" || continue
            wid="$(model_id "$(model_of "$w")")"
            if [ "$w" = chief ]; then   # remote-control 서버 창 = /model 받을 곳이 없음 → 모델이 다를 때만 새 환경으로 다시 띄움(④ · 폰 목록의 「총괄 나스」가 새 세션으로 바뀜 · 대화 중이면 끊김)
                if [ "$(chief_model_now)" = "$wid" ]; then chief_state=unchanged
                else
                    chief_restart; sleep 6; local nrc; nrc="$(pgrep -fc "^claude remote-control" 2>/dev/null)"; nrc="${nrc:-0}"   # 재기동 뒤 확인(ⓒ) · 프로세스 이름 = 「claude remote-control …」(tmux 서버·bash 감싸개 cmdline 도 그 글을 품어 ^ 로 가름)
                    if [ "$nrc" -eq 0 ]; then
                        log "chief 다시 띄운 뒤 remote-control 프로세스 0 → 한 번 더 띄움"
                        wins_now | tr ' ' '\n' | grep -qx chief || start_win chief; sleep 6; nrc="$(pgrep -fc "^claude remote-control" 2>/dev/null)"; nrc="${nrc:-0}"
                    fi
                    if [ "$nrc" -eq 0 ]; then chief_state=failed; log "chief 재기동 실패(remote-control 0 · 창 = $(wins_now)) → 「나스 터미널 꺼줘」 뒤 「켜줘」"
                    else restarted="$restarted chief"; chief_state=restarted; [ "$nrc" -ge 2 ] && log "remote-control 프로세스가 $nrc 개(ⓐ-3 · 옛 것이 아직 안 꺼짐?)"; fi
                fi
            elif win_ready "$w"; then
                [ -n "$applied" ] || settings_save   # /model 은 settings.json 기본 모델도 덮어씀(「saved as your default」 10/29 실측) → 원래 상태를 적어 두고 뒤에서 되돌림(②③)
                tmux send-keys -t "=$S:$w" -l "/model $wid" 2>/dev/null; sleep 1; tmux send-keys -t "=$S:$w" Enter 2>/dev/null; applied="$applied $w"
            else
                skipped="$skipped $w"   # 바쁘거나 선택 메뉴·쳐 둔 글이 있는 창 = 건너뜀(표엔 적혀 다음 on 부터)
            fi
        done
        if [ -n "$applied" ]; then setsid nohup bash "$0" _restore > /dev/null 2>&1 & fi   # 3·10·30초 되돌림(fd 9 잠금 물려받음 · 창구 claude -p 그룹과 함께 안 죽게 setsid)
    fi
    log "모델 $tgt → $val$([ -n "$applied" ] && echo " · 바로 적용:$applied")$([ -n "$skipped" ] && echo " · 건너뜀(바쁨 · 다음 on 부터):$skipped")$([ -n "$chief_state" ] && echo " · chief $chief_state")$([ "$on" = true ] || echo " · 다음 on 부터") · 표 = $(models_json)"
    [ "$on" = true ] && db_state "$(printf '{"on":true,"windows":"%s","idle_min":%s,"rss_mb":%s,"models":%s}' "$(wins_now | sed 's/ $//')" "$(idle_min)" "$(rss_mb)" "$(models_json)")"
    printf '{"ok":true,"models":%s,"on":%s,"applied":"%s","skipped":"%s","chief":"%s"}\n' "$(models_json)" "$on" "${applied# }" "${skipped# }" "$chief_state"
}
case "${1:-status}" in
    on) do_on ;;
    off) do_off ;;
    status) status_json ;;
    watch) do_watch ;;
    model) do_model "$@" ;;
    _restore) do_restore_bg ;;
    *) echo '{"error":"사용: sessions.sh on|off|status|model"}'; exit 2 ;;
esac

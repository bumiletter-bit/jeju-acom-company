#!/bin/bash
# #914 컨테이너 첫 명령 — 모드 하나를 받는다(인자 또는 env DESK_MODE · 기본 idle).
#   versions : 4개 버전만 찍고 끝(빌드 시험)
#   idle     : 아무것도 켜지 않고 살아만 있음(총괄·워커가 docker exec 로 tmux 세션을 연다) · 창구 0
#   desk     : 창구 대기 프로그램 = launcher-guard.js(감시자) 를 앞에서 돌림 → 죽으면 docker restart 가 다시 켬(= PC 의 시작프로그램 vbs 자리)
#              🔴 desk 는 총괄이 「나스 창구 켜」라고 한 뒤에만 — 대표 PC 창구와 둘이 돌면 같은 지시를 동시에 집는다
set -u
mode="${1:-${DESK_MODE:-idle}}"
ver() {
    echo "node     $(node -v 2>&1)"
    echo "python   $(/opt/venv/bin/python -c 'import sys,pymupdf;print(sys.version.split()[0], "PyMuPDF", pymupdf.__version__)' 2>&1)"
    echo "ffmpeg   $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
    echo "claude   $(claude --version 2>&1 | head -1)"
    echo "chromium $(ls /ms-playwright 2>/dev/null | tr '\n' ' ')"
    echo "tz/lang  $(date '+%Z %z') ${LANG:-}"
}
case "$mode" in
    versions) ver; exit 0 ;;
    desk)
        ver
        if [ ! -f /work/scripts/desk/launcher-guard.js ]; then echo "[akkome-entry] /work 에 리포가 없습니다(볼륨 확인) — idle 로 대기"; exec sleep infinity; fi
        cd /work
        echo "[akkome-entry] 창구 감시자 시작(DESK_GUARDED 아래 launcher.js) — 잠금 포트 47470/47469 는 컨테이너 안 127.0.0.1"
        exec node scripts/desk/launcher-guard.js
        ;;
    idle)
        ver
        echo "[akkome-entry] idle — 창구 0 · 세션은 docker exec -it akkome-desk tmux new -As <이름> 으로"
        exec sleep infinity
        ;;
    *)
        exec "$@"      # docker run akkome-desk:0.1 bash -lc '…' 처럼 다른 명령을 주면 그대로 실행
        ;;
esac

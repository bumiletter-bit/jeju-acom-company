# #914 나스(UGREEN DXP2800 · UGOS Pro = Debian 12 · Docker 29) 에서 창구 대기 프로그램 + 총괄·워커 Claude Code 터미널을 돌릴 「기동 꾸러미」 초안.
#   빌드(나스 · sudo 필요):  cd ~/914-build && sudo DOCKER_BUILDKIT=0 docker build -t akkome-desk:0.1 .
#   확인:                     sudo docker run --rm akkome-desk:0.1 versions
#   안에 든 것 = node 24(LTS) · Claude Code CLI(npm · PC 와 같은 판) · python3 + PyMuPDF(계산서 보안메일 PDF) · Playwright 1.63 Chromium + 의존 라이브러리(xlsx-image·_preview·qty-image)
#              · ffmpeg · git · tmux · ssh 클라이언트 · 한글 글꼴(Noto CJK·나눔) · ko_KR.UTF-8 · Asia/Seoul · tini
#   밖에 두는 것(볼륨) = /home/akkome(.akkome 열쇠·로그 · .claude 설정·메모리 · .claude.json · .ssh · .config/higgsfield) · /work(리포 clone + node_modules) · /share(= /volume1/아꼼 읽기 전용)
#   🔴 이 파일은 설계 초안 — 창구(launcher)·claude 세션을 나스에서 실제로 켜는 것은 총괄 지시 뒤(창구가 둘이면 같은 지시를 동시에 집음).
FROM node:24-bookworm

ARG UID=1001
ARG GID=100
ARG CLAUDE_CODE_VERSION=2.1.312
ARG PLAYWRIGHT_VERSION=1.63.0
ARG WITH_WHISPER=0

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Seoul \
    LANG=ko_KR.UTF-8 \
    LC_ALL=ko_KR.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# OS 꾸러미(한 겹) — 호스트(UGOS)엔 아무것도 깔지 않는다(이미지 안에서만)
RUN apt-get update && apt-get install -y --no-install-recommends \
        locales tzdata ca-certificates curl git tmux openssh-client rsync jq less procps iproute2 vim-tiny tini \
        python3 python3-venv python3-pip ffmpeg fonts-noto-cjk fonts-nanum \
    && sed -i 's/^# *ko_KR.UTF-8 UTF-8/ko_KR.UTF-8 UTF-8/' /etc/locale.gen && locale-gen \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# Python 가상환경 = PyMuPDF(invoice-month.js → pdf-unlock.py) · 선택 = faster-whisper(릴스 대사 확인 · WITH_WHISPER=1 일 때만 · 수백 MB)
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -U pip pymupdf \
    && if [ "$WITH_WHISPER" = "1" ]; then /opt/venv/bin/pip install --no-cache-dir faster-whisper numpy; fi

# Claude Code CLI(대표 PC 와 같은 판) + Playwright(리포 node_modules 와 같은 판 · 브라우저는 /ms-playwright 에 · 의존 라이브러리 함께)
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} playwright@${PLAYWRIGHT_VERSION} \
    && playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

# 컨테이너 안 계정 = 나스 akkome(uid 1001 · gid 100 users) 와 같은 번호 → /share·/work 에 남는 파일의 임자가 나스 쪽과 같다
RUN (getent group ${GID} >/dev/null || groupadd -g ${GID} akkome) \
    && useradd -m -u ${UID} -g ${GID} -s /bin/bash akkome \
    && mkdir -p /work /share && chown akkome:${GID} /work

COPY entrypoint.sh /usr/local/bin/akkome-entry
RUN chmod 755 /usr/local/bin/akkome-entry \
    && printf '#!/bin/sh\nexec /opt/venv/bin/python "$@"\n' > /usr/local/bin/python && chmod 755 /usr/local/bin/python   # bash -l 이 PATH 를 되돌려도 venv python 이 잡히게(심볼릭 링크는 venv 를 못 찾음 · 10/29 실측)

ENV PATH="/opt/venv/bin:/usr/local/bin:$PATH" \
    PYTHON=/opt/venv/bin/python \
    AKKOME_CLAUDE_EXE=/usr/local/bin/claude \
    AKM_SHARE=/share \
    DESK_MODE=idle

USER akkome
WORKDIR /work
ENTRYPOINT ["tini", "--", "/usr/local/bin/akkome-entry"]
CMD ["idle"]

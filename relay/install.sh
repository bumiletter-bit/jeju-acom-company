#!/usr/bin/env bash
# 제주아꼼이네 네이버 커머스API 중계서버 설치 스크립트 (NCP Ubuntu 24.04)
# 실행:  curl -fsSL https://raw.githubusercontent.com/bumiletter-bit/jeju-acom-company/main/relay/install.sh | sudo bash
set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ 관리자 권한이 필요합니다. 다음처럼 실행하세요:"
  echo "   curl -fsSL https://raw.githubusercontent.com/bumiletter-bit/jeju-acom-company/main/relay/install.sh | sudo bash"
  exit 1
fi

echo "════════════════════════════════════════════"
echo "  제주아꼼이네 네이버 중계서버(akkome-relay) 설치"
echo "════════════════════════════════════════════"

# ① Node.js 20 (없거나 구버전일 때만)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | sed 's/v//;s/\..*//')" -lt 20 ]; then
  echo "① Node.js 20 설치 중..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "① Node.js 이미 설치됨: $(node -v)"
fi

# ② 코드 내려받기 (GitHub 공개 저장소에서 — 항상 최신)
echo "② 중계서버 코드 내려받기..."
mkdir -p /opt/akkome-relay
cd /opt/akkome-relay
RAW="https://raw.githubusercontent.com/bumiletter-bit/jeju-acom-company/main/relay"
curl -fsSL -o server.js   "$RAW/server.js"
curl -fsSL -o package.json "$RAW/package.json"

# ③ 의존성 설치
echo "③ 의존성 설치 중..."
npm install --omit=dev --no-audit --no-fund

# ④ .env 생성 (없을 때만 — 재실행해도 채운 값 보존). 자체 인증 토큰은 자동 생성.
if [ ! -f .env ]; then
  echo "④ .env 생성 + 자체 인증 토큰 자동 생성..."
  GEN_TOKEN="$(openssl rand -hex 32)"
  cat > .env <<ENV
PORT=4000
NAVER_CLIENT_ID=여기에_애플리케이션ID_붙여넣기
NAVER_CLIENT_SECRET=여기에_애플리케이션시크릿_붙여넣기
NAVER_TYPE=SELF
RELAY_AUTH_TOKEN=$GEN_TOKEN
ENV
  chmod 600 .env
  echo ""
  echo "   🔑 회사프로그램(Render)에도 넣을 '자체 인증 토큰'이 자동 생성됐습니다 (2단계에서 사용):"
  echo "   ┌──────────────────────────────────────────────────────────────┐"
  echo "     RELAY_AUTH_TOKEN = $GEN_TOKEN"
  echo "   └──────────────────────────────────────────────────────────────┘"
  echo ""
else
  echo "④ .env 이미 존재 — 값 보존(덮어쓰지 않음)"
fi

# ④-2 HTTPS 자체서명 인증서 (없을 때만 생성). SAN=고정 공인IP → IP로 접속해도 검증 통과.
if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  echo "④-2 HTTPS 인증서 생성 (자체서명, 10년)..."
  openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 \
    -subj "/CN=akkome-relay" -addext "subjectAltName=IP:101.79.16.213" >/dev/null 2>&1
  chmod 600 key.pem
  NEW_CERT=1
else
  echo "④-2 HTTPS 인증서 이미 존재 — 유지"
  NEW_CERT=0
fi

# ⑤ 자동실행 등록 (재부팅 후에도 자동 시작)
echo "⑤ 자동실행(systemd) 등록..."
cat > /etc/systemd/system/akkome-relay.service <<'SVC'
[Unit]
Description=Akkome Naver Commerce API Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/akkome-relay
EnvironmentFile=/opt/akkome-relay/.env
ExecStart=/usr/bin/node /opt/akkome-relay/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVC
systemctl daemon-reload
systemctl enable akkome-relay >/dev/null 2>&1 || true
systemctl restart akkome-relay
sleep 1

echo ""
echo "✅ 설치 완료!  상태: $(systemctl is-active akkome-relay)  (이제 HTTPS로 동작)"
echo ""
echo "   ▶ 동작 확인:        curl -sk https://localhost:4000/health"
echo "   ▶ 토큰 발급 확인:   curl -sk 'https://localhost:4000/health?token=1'"
echo "        → token_test:\"success\" 나오면 네이버 인증 정상"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  🔐 HTTPS 인증서 (아래 -----BEGIN~END----- 전체를 복사해"
echo "     Render 환경변수  NAVER_RELAY_CA  에 붙여넣으세요)"
echo "     그리고  NAVER_RELAY_URL 을  https://101.79.16.213:4000  으로 변경"
echo "════════════════════════════════════════════════════════════════"
cat /opt/akkome-relay/cert.pem
echo "════════════════════════════════════════════════════════════════"

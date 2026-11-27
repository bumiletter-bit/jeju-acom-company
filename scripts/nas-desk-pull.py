# #1317 나스 창구(akkome-desk 컨테이너 /work)를 배포 뒤 저절로 최신으로 — scripts/deploy.js ⑥ 과 `node scripts/deploy.js --desk-only` 가 부름
#   python scripts/nas-desk-pull.py   → 마지막 줄 JSON 한 줄: {"status":"ok","commit":"abc1234","msg":"..."} | {"status":"fail","msg":"..."} | {"status":"skip","why":"..."}
#   접속 = 사무실 망 안 나스(NAS_HOST · 기본 192.168.0.22) SSH(paramiko) · 계정·비번은 이 PC 의 ~/.akkome/nas.txt(또는 NAS_CRED_FILE)에서만 읽고 출력하지 않음(저장소 PUBLIC = 비밀값 0)
#   nas.txt 없음·paramiko 없음·망 밖(접속 실패) = skip(배포는 이미 끝난 상태라 실패로 치지 않음) · 작업 폴더가 더러워 fast-forward 못 함 = fail(손으로 확인)
import sys, os, re, json, socket

HOST = os.environ.get('NAS_HOST', '192.168.0.22')
CRED = os.environ.get('NAS_CRED_FILE') or os.path.expanduser('~/.akkome/nas.txt')
# 컨테이너 안 sh(PIPESTATUS 없음) → pull 출력은 변수로 받아 종료 코드를 따로 찍음
INNER ="cd /work && OUT=$(git pull --ff-only 2>&1); RC=$?; printf '%s\\n' \"$OUT\" | tail -6; echo __RC=$RC; echo __HEAD=$(git rev-parse --short=7 HEAD)"


def creds(raw):
    """nas.txt → (id, pw) | (None, None) — JSON 또는 「id=…/pw=…」 줄 꼴(워커3 nas_desk.py 와 같은 판독)"""
    try:
        j = json.loads(raw)
        return (j.get('id') or j.get('user')), (j.get('pw') or j.get('password'))
    except Exception:
        pass
    def pick(names):
        for n in names:
            m = re.search(r'(?im)^\s*' + n + r'\s*[:=]\s*(\S+)', raw)
            if m:
                return m.group(1)
        return None
    return pick(['id', 'user', 'ssh_id']), pick(['pw', 'password', 'pass'])


def parse(out, pw=''):
    """컨테이너 출력 → 결과 dict(순수 · 검증용) — 비번 글자는 지움"""
    text = (out or '').replace(pw, '***') if pw else (out or '')
    text = re.sub(r'//[^/@\s]+@', '//***@', text)   # git 원격 주소에 열쇠가 박혀 있어도 출력에 안 남게
    if re.search(r'Sorry, try again|incorrect password|a password is required', text, re.I):
        return {'status': 'fail', 'msg': '나스 sudo 비번이 맞지 않음(~/.akkome/nas.txt 확인)'}
    rc = re.search(r'__RC=(\d+)', text)
    head = re.search(r'__HEAD=([0-9a-f]{7})', text)
    body = '\n'.join(l for l in text.splitlines() if not l.startswith('__') and not l.startswith('[sudo]')).strip()
    last = body.splitlines()[-1].strip() if body else ''
    if rc and rc.group(1) == '0':
        return {'status': 'ok', 'commit': head.group(1) if head else '', 'msg': last[:160]}
    why = 'local changes' if re.search(r'local changes|untracked working tree|would be overwritten|Not possible to fast-forward|diverge', body, re.I) else 'pull 실패'
    return {'status': 'fail', 'commit': head.group(1) if head else '', 'msg': (why + ' · ' + last)[:200]}


def run(cred_path=CRED, connect=None):
    """한 번 실행 → 결과 dict · connect(uid, pw) 는 검증용(가짜 실행기 · exec(cmd) → 출력 글)"""
    if not os.path.exists(cred_path):
        return {'status': 'skip', 'why': 'nas.txt 없음(이 PC 에 나스 접속 정보 없음)'}
    uid, pw = creds(open(cred_path, encoding='utf-8').read())
    if not uid or not pw:
        return {'status': 'skip', 'why': 'nas.txt 꼴을 못 읽음'}
    if connect is None:
        try:
            import paramiko
        except Exception:
            return {'status': 'skip', 'why': 'paramiko 없음(pip install paramiko)'}
        def connect(u, p):
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, port=22, username=u, password=p, timeout=8, banner_timeout=8, auth_timeout=8, look_for_keys=False, allow_agent=False)
            def ex(cmd):
                i, o, e = c.exec_command('sudo -S -p "" ' + cmd, timeout=120)
                i.write(p + '\n'); i.flush()
                return o.read().decode('utf-8', 'replace') + '\n' + e.read().decode('utf-8', 'replace')
            ex.close = c.close
            return ex
    try:
        ex = connect(uid, pw)
    except (socket.timeout, socket.error, OSError) as e:
        return {'status': 'skip', 'why': '망 밖(나스 접속 안 됨 · ' + type(e).__name__ + ')'}
    except Exception as e:
        # 인증 실패(비번이 바뀜 등) = 건너뜀이 아니라 실패(큰 경고) — 조용히 지나가면 창구가 또 뒤처짐 · 그 밖 SSH 오류도 실패로
        if 'Authentication' in type(e).__name__:
            return {'status': 'fail', 'msg': '나스 로그인 실패(비번이 바뀌었는지 ~/.akkome/nas.txt 확인)'}
        return {'status': 'fail', 'msg': '나스 접속 오류(' + type(e).__name__ + ')'}
    try:
        out = ex("docker exec -u akkome akkome-desk sh -c '" + INNER.replace("'", "'\\''") + "'")
    except Exception as e:
        return {'status': 'fail', 'msg': '명령 실패(' + type(e).__name__ + ')'}
    finally:
        try:
            ex.close()
        except Exception:
            pass
    return parse(out, pw)


if __name__ == '__main__':
    r = run()
    print(json.dumps(r, ensure_ascii=True))   # ASCII 꼴(\uXXXX) = Windows 파이썬 출력 cp949 와 node utf8 읽기 사이 한글 깨짐 0
    sys.exit(0)

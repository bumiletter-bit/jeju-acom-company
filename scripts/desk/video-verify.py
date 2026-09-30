# 대사 확인(통합본 3절 verify.py의 이 PC판) — 사용: python verify.py <폴더> c1 c2 ...
#   <폴더>/c1.mp4 … 를 받아쓰기해 컷별 [시작, 끝, 들린 말]과 0.25초 단위 음량 줄을 찍고 <폴더>/segs.json에 모은다.
#   힌트 없이 · VAD 끔(짧은 외침을 자르지 않게) · small 모델 cpu int8(이 PC 메모리 7.7GB 기준).
import json, subprocess, sys, os
import numpy as np
from faster_whisper import WhisperModel

FF = os.environ.get("FFMPEG") or "ffmpeg"
W = os.path.abspath(sys.argv[1]) + os.sep
m = WhisperModel("small", device="cpu", compute_type="int8")
out = {}
for k in sys.argv[2:]:
    wav = W + k + ".wav"
    subprocess.run([FF, "-y", "-v", "error", "-i", W + k + ".mp4", "-ac", "1", "-ar", "16000", wav], check=True)
    raw = subprocess.check_output([FF, "-v", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"])
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    # 소리를 직접 넘긴다(파일 경로를 주면 faster-whisper 1.2.1 ↔ PyAV 버전 충돌로 실패 — 9/30 실측)
    segs, _ = m.transcribe(a, language="ko", beam_size=5, vad_filter=False, condition_on_previous_text=False)
    L = [[round(float(s.start), 2), round(float(s.end), 2), s.text.strip()] for s in segs]
    out[k] = L
    n = len(a) // 4000
    env = [float(np.sqrt(np.mean(a[i * 4000:(i + 1) * 4000] ** 2))) for i in range(n)]
    mx = max(env) if env else 1
    mx = mx or 1
    print(k, L)
    print("   env:", "".join("#" if e / mx > 0.5 else ("+" if e / mx > 0.25 else ".") for e in env), flush=True)
p = W + "segs.json"
old = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
old.update(out)
json.dump(old, open(p, "w", encoding="utf-8"), ensure_ascii=False)
print("VERIFY DONE")

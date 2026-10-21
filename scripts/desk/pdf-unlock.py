# #814 계산서 PDF 풀기 · 글 뽑기 (창구 invoice-month.js 가 부름) — 비밀번호는 환경변수 PDF_PASSWORD 로만 받는다(명령 줄·출력에 안 남김)
#   사용: python -P scripts/desk/pdf-unlock.py <잠긴.pdf> <풀린판.pdf 저장 경로>
#   출력(한 줄 JSON): { ok, encrypted, unlocked, pages, text(앞 20000자), image_only, error? }
import sys, os, json
try:
    import pymupdf as fitz
except Exception:
    import fitz

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "사용: pdf-unlock.py <in> <out>"}, ensure_ascii=False)); return
    src, dst = sys.argv[1], sys.argv[2]
    pw = os.environ.get("PDF_PASSWORD", "")
    try:
        doc = fitz.open(src)
    except Exception as e:
        print(json.dumps({"ok": False, "error": "PDF 를 열지 못함: " + str(e)[:120]}, ensure_ascii=False)); return
    enc = bool(doc.needs_pass)
    if enc:
        if not pw or not doc.authenticate(pw):
            print(json.dumps({"ok": False, "encrypted": True, "unlocked": False, "error": "비밀번호가 맞지 않음"}, ensure_ascii=False)); return
    text = "\n".join(p.get_text("text") for p in doc)
    pages = doc.page_count
    doc.save(dst, encryption=fitz.PDF_ENCRYPT_NONE, garbage=1, deflate=True)
    doc.close()
    print(json.dumps({"ok": True, "encrypted": enc, "unlocked": True, "pages": pages, "text": text[:20000], "image_only": len(text.strip()) < 20}, ensure_ascii=False))

main()

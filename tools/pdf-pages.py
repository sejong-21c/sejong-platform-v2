# PDF 쪽별 글자 뽑기 — 조각에 쪽번호를 붙이려고 쪽 경계를 남긴다.
#   python tools/pdf-pages.py "책.pdf" 나갈파일.json [첫쪽] [끝쪽]
# 내보내는 것: {"파일": "...", "첫쪽": N, "쪽수": N, "쪽": ["1쪽 글", "2쪽 글", ...]}
#
# stdout 으로 안 주고 **파일로 쓰는** 이유: 윈도우 콘솔이 cp949 라 ASME 본문의 특수문자
# (예: Ɵ)에서 UnicodeEncodeError 로 죽는다(2026-09-19 실측). 책 한 권이 수 MB 라
# 파이프로 흘리는 것도 좋지 않다.
#
# find_tables() 는 쓰지 않는다 — ASME 표는 괘선이 없어 1행 2열로 뭉개진다(2026-09-19 실측).
# get_text() 는 줄 순서를 지켜서 뽑아 주므로 서술형 본문에는 이걸로 충분하다.
import sys, json
import fitz

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/pdf-pages.py <파일.pdf> <나갈파일.json> [첫쪽] [끝쪽]", file=sys.stderr)
        return 2
    경로 = sys.argv[1]
    나갈곳 = sys.argv[2]
    처음 = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    끝 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    문서 = fitz.open(경로)
    쪽 = []
    마지막 = 끝 or 문서.page_count
    for i in range(처음 - 1, min(마지막, 문서.page_count)):
        쪽.append(문서[i].get_text())
    out = {"파일": 경로, "첫쪽": 처음, "쪽수": len(쪽), "쪽": 쪽}
    with open(나갈곳, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("%d쪽 뽑음 → %s" % (len(쪽), 나갈곳))
    return 0

if __name__ == "__main__":
    sys.exit(main())

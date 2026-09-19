# 띄어쓰기가 **공백 문자 없이 좌표로만** 되어 있는 PDF 를 되살린다.
#   python tools/pdf-respace.py "<책.pdf>" 나갈파일.json [첫쪽] [끝쪽]
#   → {"파일","첫쪽","쪽수","쪽":[...]}  (pdf-pages.py 와 같은 모양이라 뒤 단계를 안 고쳐도 된다)
#
# 왜 필요한가 (2026-09-19, 에너지이용합리화법 고시 전문_1 에서 발견):
#   화면에는 "용접부의 용접이 충분하고" 로 또렷하게 띄어 있는데 get_text() 는
#   "용접부의용접이충분하고" 로 붙여 내놓는다. **공백 문자가 아예 없고 좌표로만 띄워 놨기 때문**이다.
#   이대로 색인하면 "용접부 외관 기준" 으로 물어도 토큰이 어긋나 검색이 헛돈다.
#   조각 수·평균 길이는 멀쩡해 보인다 — 조용히 죽는 종류다.
#
# pdf-despace.py 와 무엇이 다른가:
#   despace 는 **낱말 상자끼리** 붙인다(낱자로 흩어진 PDF 용, B36.19). 여기는 정반대로
#   한 상자 **안쪽**을 갈라야 한다. get_text("words") 는 이미 "용접부의외관" 을 한 상자로 주므로
#   그 단위로는 손을 못 댄다. 그래서 **글자 하나하나(rawdict)** 를 보고 다시 짠다.
#
# 어떻게 가르나 — 실측(전문_1 p.121):
#   글자 사이 0.45~0.60pt · 낱말 사이 5.52pt.  열 배 차이라 헷갈릴 일이 없다.
#   고정값을 안 쓰는 이유는 글꼴 크기가 쪽마다 다르기 때문이다(표 쪽은 더 작다).
#   그래서 쪽마다 제 간격의 **중앙값 × 3** 을 쓰되, 최소 1.2pt 는 지킨다.
import sys, json, io, statistics

import fitz

최소틈 = 1.2          # 이보다 좁으면 절대 낱말 경계로 안 본다(글자 사이가 0.6pt 안팎이다)
배수 = 3.0            # 그 쪽 중앙값의 몇 배부터 낱말 사이로 볼지
칸틈 = 12.0           # 이보다 넓으면 표의 칸 경계다 — 그래도 공백 하나만 넣는다(줄은 안 깬다)


def 줄들(pg):
    """글자를 줄 단위로. rawdict 는 span 안에 chars 를 준다."""
    out = []
    for b in pg.get_text("rawdict").get("blocks", []):
        for l in b.get("lines", []):
            ch = [c for s in l.get("spans", []) for c in s.get("chars", [])]
            if ch: out.append(ch)
    return out


def 간격들(줄):
    return [b["bbox"][0] - a["bbox"][2] for a, b in zip(줄, 줄[1:])]


def 쪽글(pg):
    줄모음 = 줄들(pg)
    if not 줄모음: return pg.get_text()          # 글자 정보가 없으면 원래 방식 그대로
    갭 = [g for 줄 in 줄모음 for g in 간격들(줄) if 0 <= g < 칸틈]
    중앙 = statistics.median(갭) if 갭 else 0.3
    경계 = max(최소틈, 중앙 * 배수)
    나온줄 = []
    for 줄 in 줄모음:
        조각 = [줄[0]["c"]]
        for a, b in zip(줄, 줄[1:]):
            틈 = b["bbox"][0] - a["bbox"][2]
            # 이미 공백 문자가 있으면 또 넣지 않는다(이 PDF 는 곳곳에 진짜 공백도 섞여 있다).
            if 틈 >= 경계 and not 조각[-1].isspace() and not b["c"].isspace(): 조각.append(" ")
            조각.append(b["c"])
        나온줄.append("".join(조각).rstrip())
    return "\n".join(나온줄)


def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/pdf-respace.py <책.pdf> <나갈파일.json> [첫쪽] [끝쪽]", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")   # 윈도우 콘솔이 cp949 라 한글이 깨진다
    파일, 나갈곳 = sys.argv[1], sys.argv[2]
    첫쪽 = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    끝쪽 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    d = fitz.open(파일)
    끝 = 끝쪽 or d.page_count
    쪽 = [쪽글(d[i]) for i in range(첫쪽 - 1, min(끝, d.page_count))]
    d.close()
    with io.open(나갈곳, "w", encoding="utf-8") as f:
        json.dump({"파일": 파일, "첫쪽": 첫쪽, "쪽수": len(쪽), "쪽": 쪽}, f, ensure_ascii=False)
    # 잘 됐는지 바로 보여 준다 — 공백 비율이 10% 안팎이면 한국어 본문으로 정상이다.
    글 = "\n".join(쪽)
    print(f"{len(쪽)}쪽 · {len(글):,}자 · 공백 비율 {글.count(' ') / max(1, len(글)):.1%} → {나갈곳}")
    본 = next((x for x in 쪽 if len(x) > 400), 쪽[0] if 쪽 else "")
    print("--- 맛보기 ---")
    print("\n".join(본.split("\n")[:6]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

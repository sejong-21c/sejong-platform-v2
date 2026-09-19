# 글자가 낱자로 흩어져 뽑히는 PDF 를 좌표로 되붙인다.
#   python tools/pdf-despace.py "<책.pdf>" 나갈파일.json [첫쪽] [끝쪽]
#   → {"파일","첫쪽","쪽수","쪽":[...]}  (pdf-pages.py 와 같은 모양이라 뒤 단계를 안 고쳐도 된다)
#
# 왜 필요한가: ASME B36.19 PDF 는 get_text() 가 "S t a i n l e s s S t e e l" 처럼 글자마다
# 공백을 넣어 내놓는다(한 글자짜리 낱말 95%). 이대로 색인하면 "stainless" 로 물어도 **영영 0건**이다.
# 조각 수·평균 길이는 멀쩡해 보여서 사람 눈에는 성공한 것처럼 보인다 — 조용히 죽는 종류다.
#
# 어떻게 되붙이나: 글자 사이와 낱말 사이는 **눈에 안 보여도 좌표로는 다르다**(2026-09-19 실측).
#   글자 사이 0.09~0.52pt · 낱말 사이 1.85~3.47pt · 단(column) 사이 18~28pt
# 그래서 쪽마다 간격 중앙값을 재고, 그 몇 배를 넘으면 낱말 경계로 본다. 고정값을 쓰지 않는 이유는
# 글꼴 크기가 쪽마다 다르기 때문이다(표 쪽은 더 작다).
import sys, json, io, statistics, collections

import fitz

def 줄묶기(pg, 틈=3.0):
    ws = sorted(pg.get_text("words"), key=lambda w: (w[1], w[0]))
    줄, 현 = [], []
    for w in ws:
        if 현 and w[1] - 현[-1][1] > 틈: 줄.append(현); 현 = []
        현.append(w)
    if 현: 줄.append(현)
    return [sorted(r, key=lambda w: w[0]) for r in 줄]

def 간격들(줄들):
    out = []
    for r in 줄들:
        for a, b in zip(r, r[1:]):
            g = b[0] - a[2]
            if 0 <= g < 12: out.append(g)      # 12 이상은 단·칸 경계라 글자/낱말 판단에 안 쓴다
    return out

def 경계정하기(갭, 낱자비율):
    """'낱말 사이'로 볼 최소 간격.
    규칙이 둘인 이유: **보통 PDF 와 낱자 PDF 는 간격 분포가 정반대다.**
      · 보통 PDF — 대부분의 간격이 곧 낱말 사이(2pt 안팎). 중앙값을 기준 삼으면 낱말을 붙여 버린다.
        (B36.10 을 그렇게 깨뜨렸다 — "Table 2-1" 이 "Table2-1" 이 돼 쪽 거르개가 통째로 실패했다.)
      · 낱자 PDF — 대부분이 글자 사이(0.4pt), 낱말 사이는 그 4~5배. 중앙값의 2.5배가 딱 그 사이다.
    그래서 먼저 어느 쪽인지 보고 규칙을 고른다."""
    갭 = sorted(g for g in 갭 if 0 <= g < 8)
    if not 갭: return 0.9
    중앙 = 갭[len(갭) // 2]
    if 낱자비율 <= 0.5: return 0.9          # 보통 PDF: 낱말은 이미 붙어 있다
    return max(0.9, 중앙 * 2.5)

def 단나누기(줄들, 쪽폭, 최소폭=10):
    """가운데에 **하나뿐인 빈 띠**가 있으면 2단으로 본다.
    줄을 통째로 겹쳐 세면 안 된다 — 가운데 맞춤된 제목 한 줄이 단 사이를 메워 골짜기가 사라진다
    (B36.19 p.10 "STAINLESS STEEL PIPE" 가 그랬다). 그래서 **줄마다 세어 비율로** 본다.
    표 쪽은 빈 띠가 여러 개라 안 나뉜다 — 표는 줄을 그대로 둬야 행이 안 깨진다."""
    폭 = int(쪽폭) + 2
    셈 = [0] * 폭
    본줄 = [r for r in 줄들 if len(r) > 3]
    if len(본줄) < 6: return None
    for r in 본줄:
        덮 = set()
        for w in r:
            for x in range(max(0, int(w[0])), min(폭 - 1, int(w[2]) + 1)): 덮.add(x)
        for x in 덮: 셈[x] += 1
    한계 = len(본줄) * 0.15          # 줄의 15% 미만만 덮는 x 는 빈 띠로 본다
    골, st = [], None
    for x in range(폭):
        if 셈[x] < 한계:
            if st is None: st = x
        else:
            if st is not None and x - st >= 최소폭: 골.append((st, x))
            st = None
    가운데 = [g for g in 골 if 0.25 * 쪽폭 < (g[0] + g[1]) / 2 < 0.75 * 쪽폭]
    return (가운데[0][0] + 가운데[0][1]) / 2 if len(가운데) == 1 else None

def 줄글(r, 낱말경계):
    out = []
    for i, w in enumerate(r):
        if i and (w[0] - r[i - 1][2]) >= 낱말경계: out.append(" ")
        out.append(w[4])
    return "".join(out).strip()

def 쪽글(pg):
    줄들 = 줄묶기(pg)
    if not 줄들: return ""
    갭 = 간격들(줄들)
    if not 갭: return pg.get_text()
    말 = pg.get_text().split()
    낱자 = sum(1 for w in 말 if len(w) == 1) / max(1, len(말))
    낱말경계 = 경계정하기(갭, 낱자)
    나눔 = 단나누기(줄들, pg.rect.width)
    if 나눔 is None:
        return "\n".join(x for x in (줄글(r, 낱말경계) for r in 줄들) if x)
    왼, 오 = [], []
    for r in 줄들:
        l = [w for w in r if (w[0] + w[2]) / 2 < 나눔]
        o = [w for w in r if (w[0] + w[2]) / 2 >= 나눔]
        if l: 왼.append(줄글(l, 낱말경계))
        if o: 오.append(줄글(o, 낱말경계))
    return "\n".join(x for x in 왼 + 오 if x)

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/pdf-despace.py <파일.pdf> <나갈파일.json> [첫쪽] [끝쪽]", file=sys.stderr)
        return 2
    경로, 나갈곳 = sys.argv[1], sys.argv[2]
    처음 = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    끝 = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    d = fitz.open(경로)
    마지막 = 끝 or d.page_count
    쪽 = [쪽글(d[i]) for i in range(처음 - 1, min(마지막, d.page_count))]
    with io.open(나갈곳, "w", encoding="utf-8") as f:
        json.dump({"파일": 경로, "첫쪽": 처음, "쪽수": len(쪽), "쪽": 쪽}, f, ensure_ascii=False)
    말 = " ".join(쪽).split()
    낱자 = sum(1 for w in 말 if len(w) == 1) / max(1, len(말))
    print("%d쪽 되붙임 → %s (한 글자짜리 %.0f%%)" % (len(쪽), 나갈곳, 낱자 * 100))
    return 0

if __name__ == "__main__":
    sys.exit(main())

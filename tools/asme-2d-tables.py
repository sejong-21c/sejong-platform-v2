# ASME Section II Part D — 허용응력 표(Table 1A/1B …)를 한 줄짜리 기록으로 되살린다.
#   python tools/asme-2d-tables.py "<II-D.pdf>" 나갈파일.json [--table 1A] [--처음 58] [--끝 0]
#
# 왜 이게 필요한가 (그냥 색인하면 안 되는 이유):
#   Table 1A 는 **세 쪽에 걸쳐** 한 재료를 설명한다. 그대로 글자로 뽑으면 이런 조각이 나온다.
#       1 / 275 / 140 / NP / NP / 343 / NP / CS-6
#   여기서 343 은 **Section VIII-1 최고사용온도**지 허용응력이 아니고, 재료 이름(SA-516 등)은
#   아예 그 쪽에 없다. 압력용기 회사에서 AI 가 이 조각을 근거로 허용응력을 답하면 설계가 틀린다.
#
# 어떻게 되살리나 — 세 쪽이 공통으로 갖는 **Line No.** 로 이어 붙인다.
#   A쪽: Line + 조성·제품형태·Spec.No.·Type/Grade·UNS·Class·두께·P-No.·Group
#   B쪽: Line + 인장/항복강도 + 섹션별 최고온도(I·III·VIII-1·XII) + 외압챠트 + 비고
#   C쪽: Line + 온도별 허용응력 (낮은 온도 한 쪽, 높은 온도 한 쪽 — 그래서 C 가 두 쪽)
#   쪽 묶음은 A,B,C,C 가 반복된다(p.58~ 실측).
#
# **줄 순서로 읽으면 안 된다** (2026-09-19 실측):
#   get_text() 는 가까운 두 칸을 한 줄로 붙여 내놓는다("K01700 …"). 그러면 그 행부터 칸이 하나씩
#   밀려 그 뒤가 전부 틀린다. 그래서 좌표로 읽는다 — 낱말의 왼쪽 x 로 열을 정한다.
#
# 스스로 어긋남을 잡는 장치 셋:
#   1) **연속된 Line No. 구간**을 찾아 데이터 행을 정한다. 머리글·쪽번호는 연속열을 못 만든다.
#   2) C쪽은 온도 머리 개수와 데이터 칸 수가 같아야 한다. 다르면 그 쪽을 통째로 버린다.
#   3) A·B·C 가 다 붙은 줄만 내보낸다. 반쪽짜리는 버리고 세어서 보고한다.
#   의심스러운 줄을 조용히 내보내느니 빠뜨리는 게 낫다 — 틀린 근거는 근거 없는 것보다 나쁘다.
#
# 마지막 관문은 사람 눈이다. tools/asme-2d-verify.py 로 쪽 그림과 대조한 뒤에만 색인한다.
import sys, json, io, re, collections

import fitz

ELLIPSIS = {"…", "...", "…", "-", ""}
DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
def 말(s):
    """엔대시를 보통 하이픈으로. SA–516 은 startswith("SA-") 로 안 걸린다(실측).
    그리고 값 뒤에 딸려 온 빈칸 표시(…)를 떼어낸다 — "K01800 …" 처럼 붙어 나오는 일이 있다."""
    t = (s or "").translate(DASHES).strip()
    # ASME 의 개정 표시 "(23)" 이 이 PDF 에서 "ð23Þ" 로 깨져 들어온다. 쪽 오른쪽 끝에 찍혀 있어
    # **맨 오른쪽 온도 칸(900°C)의 값으로 들어갔다** — 1A·3·4·U·Y-1 합쳐 245군데. 값이 아니다.
    t = re.sub(r"ð\d+Þ", " ", t).strip()
    while True:
        u = re.sub(r"(^(?:…|\.\.\.)\s+)|(\s+(?:…|\.\.\.)$)", "", t)
        if u == t: break
        t = u
    # 소수점 대신 쉼표를 쓴 칸이 있다(Y-1 에 6군데: "55,2"). 그냥 두면 55.2 가 552 로 읽힌다.
    # 천 단위 구분이 아닌 게 확실할 때만 — 쉼표 뒤가 한두 자리일 때만 바꾼다(천 단위는 세 자리다).
    t = re.sub(r"^(\d+),(\d{1,2})$", r"\1.\2", t)
    return t
빈칸 = lambda v: (v or "").strip() in ELLIPSIS

# ── 좌표로 표 읽기 ───────────────────────────────────────────────────────────
def 줄모으기(pg, 왼쪽자르기=50, 세로허용=4.0):
    """낱말을 y 로 묶어 줄 단위로. (y, [낱말...])

    **고정 폭으로 자르면 안 된다.** 전에는 round(y/3) 으로 칸을 나눴는데, 같은 행인데 y 가
    1~2pt 어긋난 낱말이 하필 칸 경계에 걸리면 한 행이 두 줄로 쪼개진다.
    Table 3 의 A쪽에서 조성 칸이 늘 1pt 위에 찍혀 있어("C-1/4Mo" 만 있는 줄 + 나머지 줄)
    Line No. 연속 구간이 12 에서 끊겼고, 그 쪽 재료의 3분의 2가 통째로 사라졌다(2026-09-19 실측).
    그래서 가까운 것끼리 **이어 붙인다.** 행 간격은 9~10pt 이고 어긋남은 1~2pt 라 4 면 안전하다.
    붙일지는 **묶음의 첫 y** 와 견준다 — 직전 낱말과 견주면 조금씩 밀려 두 행이 하나로 붙는다."""
    낱말 = sorted((w for w in pg.get_text("words") if w[0] >= 왼쪽자르기), key=lambda w: (w[1], w[0]))
    줄 = []
    for w in 낱말:
        if 줄 and w[1] - 줄[-1][0] <= 세로허용: 줄[-1][1].append(w)
        else: 줄.append([w[1], [w]])
    return [(y, sorted(v, key=lambda w: w[0])) for y, v in 줄]

# 열 '찾기' 는 넉넉한 간격(8)이 맞다 — 잔가지가 적어야 열 위치가 깨끗하게 잡힌다.
# 칸 '나누기' 는 좁은 간격(5)이 맞다 — 붙은 두 칸을 갈라야 한다. 쓰임이 반대다.
def 열찾기(줄들, 최소비율=0.3, 칸간격=8, 뭉침=6):
    """낱말 사이 간격으로 칸을 끊고, 칸 시작 x 를 모아 열 위치를 정한다."""
    시작 = []
    for _, ws in 줄들:
        if not ws: continue
        시작.append(ws[0][0])
        for a, b in zip(ws, ws[1:]):
            if b[0] - a[2] > 칸간격: 시작.append(b[0])
    시작.sort()
    그룹 = []
    for x in 시작:
        if not 그룹 or x - 그룹[-1][-1] > 뭉침: 그룹.append([x])
        else: 그룹[-1].append(x)
    return [min(g) for g in 그룹 if len(g) >= len(줄들) * 최소비율]

def 칸나누기(ws, 열, 칸간격=5):
    """낱말을 칸으로 묶은 뒤 **겹침이 가장 큰 열**에 넣는다.
    낱말 하나씩 왼쪽 x 로 넣으면 안 된다: 가운데 맞춤된 넓은 칸이 왼쪽 열을 침범한다.
    실제로 그랬다 — p.59 3번 줄의 Section III 값 "343 (Cl. 3 only)" 가 왼쪽 Section I 칸으로
    새어 들어가 "Section I = NP 343 (Cl." 이라는 **틀린 값**이 됐다(2026-09-19 쪽 그림과 대조하다 발견).
    겹침으로 재면 왼쪽으로 삐져나와도 제 열을 찾는다.
    칸간격 5 는 실측값이다: 칸 **안** 낱말 사이는 2.5, 칸 **사이**는 최소 6.9 였다(p.215).
    8 로 두면 Table 1B 의 "NP" 와 "121 (Cl. 3 only)" 이 한 칸으로 붙어 Section I 값이 사라진다."""
    if not ws: return ["" for _ in 열]
    묶 = [[ws[0]]]
    for a, b in zip(ws, ws[1:]):
        (묶.append([b]) if b[0] - a[2] > 칸간격 else 묶[-1].append(b))
    범위 = [(열[i], 열[i + 1] if i + 1 < len(열) else 10 ** 6) for i in range(len(열))]
    칸 = ["" for _ in 열]
    for 셀 in 묶:
        x0, x1 = 셀[0][0], 셀[-1][2]
        점수 = [max(0.0, min(x1, b) - max(x0, a)) for a, b in 범위]
        best = max(range(len(열)), key=lambda i: (점수[i], -abs((x0 + x1) / 2 - 열[i])))
        글 = " ".join(w[4] for w in 셀)
        칸[best] = (칸[best] + " " + 글).strip()
    return [말(x) for x in 칸]

def 열맞추기(줄들, 기대):
    """기대한 열 개수가 나올 때까지 지지 기준을 낮춰 가며 찾는다.
    왜: 어떤 쪽은 UNS 와 Class 가 거의 붙어 있어(p.66 "K03046 …") 기본 기준으로는 한 칸으로 뭉친다.
    **정확히 기대한 개수일 때만** 받아들이므로, 기준을 낮추다 엉뚱한 열이 생기면 그대로 실패한다."""
    최선 = 열찾기(줄들)
    if 기대 is None: return 최선
    # 높은 쪽도 훑는다: 가끔 잡티 때문에 열이 하나 더 잡힌다(기준을 올리면 사라진다).
    for 비율 in (0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.12, 0.09, 0.07, 0.05, 0.04):
        후보 = 열찾기(줄들, 최소비율=비율)
        if len(후보) == 기대: return 후보
    return 최선

def 데이터행(pg, 기대열=None):
    """→ (열위치, [(line, [칸...])], 첫데이터y).  **연속된 Line No. 구간**만 데이터로 친다."""
    줄들 = 줄모으기(pg)
    if not 줄들: return [], [], 0
    열 = 열맞추기(줄들, 기대열)
    if len(열) < 3: return 열, [], 0
    후보 = []
    for y, ws in 줄들:
        칸 = 칸나누기(ws, 열)
        m = re.fullmatch(r"\d{1,5}", 칸[0] or "")
        후보.append((int(칸[0]) if m else None, 칸, y))
    # 가장 긴 연속 증가 구간
    최고 = (0, 0, 0)
    i = 0
    while i < len(후보):
        if 후보[i][0] is None: i += 1; continue
        j = i
        while j + 1 < len(후보) and 후보[j + 1][0] == 후보[j][0] + 1: j += 1
        if j - i + 1 > 최고[0]: 최고 = (j - i + 1, i, j)
        i = j + 1
    길이, s, e = 최고
    if 길이 < 3: return 열, [], 0
    return 열, [(후보[k][0], 후보[k][1]) for k in range(s, e + 1)], 후보[s][2]

# ── 쪽 종류 ──────────────────────────────────────────────────────────────────
def 쪽정보(pg):
    t = pg.get_text()
    이름 = None
    m = re.search(r"Table\s+(\S+)", t)
    if m: 이름 = m.group(1).strip()
    # 값 쪽(C)은 표마다 **값의 이름이 다르다** — 최대허용응력 S · 설계응력강도 Sm ·
    # 인장강도 Su(Table U) · 항복강도 Sy(Table Y-1). 이름으로 찾으면 표가 늘 때마다 놓친다.
    # 그래서 이름이 아니라 모든 값 쪽이 공통으로 갖는 "(Multiply by … for Metal Temperature"로 알아본다.
    if re.search(r"\(Multiply by", t) and "Metal Temperature" in t: 종 = "C"
    # A쪽 판별에서 "Product Form"을 빼야 한다 — Table 4 의 A쪽에는 제품형태 칸이 아예 없다(실측 p.498).
    elif "Nominal Composition" in t: 종 = "A"
    # B쪽에 "Chart No."가 늘 있는 게 아니다 — 볼팅(3·4)과 Y-1 에는 외압 챠트 칸이 없다.
    elif ("Chart No." in t) or ("Applicability" in t) or re.search(r"Min\.\s*Tensile", t): 종 = "B"
    else: 종 = "?"
    return 종, 이름

def 온도머리(pg, 첫데이터y):
    """C쪽의 온도 머리(40 65 100 …). 데이터 바로 위에서 오름차순 정수만 모은다."""
    후보 = []
    for y, ws in 줄모으기(pg):
        if y >= 첫데이터y - 2: break
        값 = [w[4] for w in ws if re.fullmatch(r"\d{2,4}", w[4])]
        if len(값) >= 3 and all(int(a) < int(b) for a, b in zip(값, 값[1:])): 후보 = 값
    return [int(x) for x in 후보]

# 표마다 열 구성이 다르다(실측). 머리글에 무엇이 적혀 있는지로 고른다.
#  · Table 1A(철강): 두께·P-No.·Group 이 A쪽에 있다 → A 10칸, B 9칸
#  · Table 1B(비철): 두께·P-No. 가 **B쪽으로 옮겨가고** Group 이 없다 → A 7칸, B 11칸
# 하드코딩이지만 추측이 아니다 — 쪽 그림으로 확인한 두 가지뿐이고, 안 맞으면 쪽을 버린다.
A_10 = ["line", "조성", "제품형태", "spec", "grade", "uns", "class", "두께", "pno", "group"]
A_7  = ["line", "조성", "제품형태", "spec", "grade", "uns", "class"]
B_9  = ["line", "인장MPa", "항복MPa", "최고온도_I", "최고온도_III", "최고온도_VIII1", "최고온도_XII", "외압챠트", "비고"]
B_11 = ["line", "두께", "pno", "인장MPa", "항복MPa", "최고온도_I", "최고온도_III", "최고온도_VIII1", "최고온도_XII", "외압챠트", "비고"]

def A배치(pg):
    t = pg.get_text()
    return A_10 if ("Group" in t and "P-No." in t and "Thickness" in t) else A_7

# 섹션 칸 이름. 표마다 몇 개인지 다르다 — 1A/1B 는 I·III·VIII-1·XII 넷, 2A/2B 는 둘뿐이다.
섹션표기 = ["I", "II", "III", "IV", "V", "VIII-1", "VIII-2", "X", "XII"]

def 섹션칸(pg, 개수):
    """머리글에 줄 하나로 서 있는 섹션 표기(I · III · VIII-1 · XII)를 순서대로 읽는다.
    개수가 안 맞으면 번호로 대신한다 — 이름이 틀리느니 번호가 낫다."""
    줄 = [x.strip() for x in pg.get_text().split("\n") if x.strip()]
    본 = [x for x in 줄 if x in 섹션표기]
    보이는것 = []
    for x in 본:
        if x not in 보이는것: 보이는것.append(x)
    if len(보이는것) == 개수: return ["최고온도_" + x.replace("-", "") for x in 보이는것]
    # 못 읽으면 None. 번호로 대충 붙이면 Div.1 값이 Div.2 이름을 달고 나간다 —
    # 2A 에서 실제로 그랬다(열은 III·VIII-2 인데 1A 기준 이름 VIII-1 이 붙었다).
    return None

def B배치(pg, 열수=None):
    """B쪽 열 이름을 **머리글을 보고** 짠다. 표마다 구성이 달라 하드코딩으로는 못 따라간다(실측):
       1A 9칸 · 1B 11칸(두께·P-No. 가 B쪽으로) · 2A/2B 7칸(섹션 둘) · 5A 6칸(최고사용온도 하나) · 5B 8칸."""
    t = pg.get_text()
    두께있음 = ("Thickness" in t and "P-No." in t)   # 머리글이 "Size/" + "Thickness," 로 갈려 나온다
    두께만 = ("Thickness" in t and "P-No." not in t)  # Table Y-1 의 B쪽 — 두께만 넘어오고 P-No. 가 없다
    단일온도 = ("Maximum Use" in t and "Temperature" in t and "Applicability" not in t)
    # 외압 챠트 칸이 없는 표가 있다 — 볼팅(Table 3·4)과 Y-1. 있을 때만 넣는다.
    챠트있음 = "Chart No." in t
    앞 = ["line"] + (["두께", "pno"] if 두께있음 else (["두께"] if 두께만 else [])) + ["인장MPa", "항복MPa"]
    꼬리 = (["외압챠트"] if 챠트있음 else []) + ["비고"]
    if 열수 is None:
        return 앞 + (["최고사용온도"] if 단일온도 else ["최고온도_I", "최고온도_III", "최고온도_VIII1", "최고온도_XII"]) + 꼬리
    남 = 열수 - len(앞) - len(꼬리)
    # Y-1 의 B쪽은 섹션 칸이 **하나도 없다**(두께·인장·항복·비고뿐). 0 도 정상이다.
    if 남 < 0: return None
    if 남 == 0: return 앞 + 꼬리
    가운데 = ["최고사용온도"] if (단일온도 and 남 == 1) else 섹션칸(pg, 남)
    if 가운데 is None: return None
    return 앞 + 가운데 + 꼬리

def A배치2(pg, 열수):
    """A쪽도 표마다 다르다(전부 실측):
       1A 10칸 · 1B 7 · 2A 9(두께 없음) · 2B 9(Group 없음) · 5A 10 · 5B 7 ·
       **3 은 8칸 · 4 는 7칸(제품형태가 없다) · U 는 9칸(최소인장강도가 A쪽에 있다) · Y-1 은 7칸.**"""
    t = pg.get_text()
    이름 = ["line"]
    for 표시, 칸 in [("Nominal Composition", "조성"), ("Product Form", "제품형태"),
                     ("Spec", "spec"), ("Grade", "grade"), ("UNS", "uns"), ("Class", "class")]:
        if 표시 in t: 이름.append(칸)
    뒤 = []
    if "Thickness" in t: 뒤.append("두께")
    if "P-No." in t: 뒤.append("pno")
    if "Group" in t: 뒤.append("group")
    이름 += 뒤
    # Table U 는 B쪽이 아예 없고 최소인장강도가 A쪽 맨 끝에 있다. "Min." 이 앞에 붙은 것만 본다 —
    # Y-1 의 A쪽은 제목이 "Yield Strength Values, Sy" 라 그냥 "Yield" 로 찾으면 없는 칸이 생긴다.
    강도 = []
    if re.search(r"Min\.\s*Tensile", t): 강도.append("인장MPa")
    if re.search(r"Min\.\s*Yield", t): 강도.append("항복MPa")
    이름 += 강도
    # 머리엔 있는데 실제 칸이 없는 것부터 뺀다(두께가 비는 표가 있다).
    # **강도 칸은 절대 빼지 않는다** — 빼면 이름이 한 칸씩 밀려 인장강도 자리에 엉뚱한 값이 들어간다.
    while len(이름) > 열수 and 뒤:
        빼기 = "두께" if "두께" in 뒤 else 뒤[-1]
        이름.remove(빼기); 뒤 = [x for x in 뒤 if x != 빼기]
    return 이름 if len(이름) == 열수 else None

def 표만들기(pdf, 표=None, 처음=1, 끝=0):
    d = fitz.open(pdf)
    마지막 = 끝 or d.page_count
    쪽들 = []
    for i in range(처음 - 1, 마지막):
        종, 이름 = 쪽정보(d[i])
        쪽들.append((i + 1, 종, 이름, d[i]))

    기록, 경고, 통계 = {}, [], collections.Counter()
    n = len(쪽들)
    k = 0
    while k < n:
        쪽, 종, 이름, _ = 쪽들[k]
        if 종 != "A" or (표 and 이름 != 표): k += 1; continue
        묶음 = [쪽들[k]]; j = k + 1
        while j < n and 쪽들[j][1] in ("B", "C") and 쪽들[j][2] == 이름:
            묶음.append(쪽들[j]); j += 1
        k = j
        A들 = [x for x in 묶음 if x[1] == "A"]
        B들 = [x for x in 묶음 if x[1] == "B"]
        C들 = [x for x in 묶음 if x[1] == "C"]
        # Table U 는 **B쪽이 아예 없다** — 최소인장강도까지 A쪽에 들어 있다(실측 p.628).
        # 그래서 B 를 필수로 두면 212쪽이 통째로 버려진다. A 와 C 만 있으면 된다.
        if not (A들 and C들):
            경고.append(f"p.{쪽}: A/C 가 다 모이지 않음(A{len(A들)} B{len(B들)} C{len(C들)}) — 묶음 버림")
            통계["묶음버림"] += 1; continue

        모음 = {}
        for 쪽n, _, _, pg in A들:
            열, 행, _ = 데이터행(pg)               # 먼저 있는 그대로 센다
            이름표 = A배치2(pg, len(열))
            if not 이름표:
                이름표 = A배치(pg)
                열, 행, _ = 데이터행(pg, len(이름표))   # 이름을 못 짜면 기본 배치로 한 번 더
            if not 이름표 or len(열) != len(이름표):
                경고.append(f"p.{쪽n}(A): 열이 {len(열)}개인데 이름을 못 짬 — 쪽 버림"); 통계["A쪽버림"] += 1; continue
            for line, 칸 in 행:
                모음[line] = dict(zip(이름표, 칸)); 모음[line]["line"] = line; 모음[line]["쪽A"] = 쪽n
            통계["A행"] += len(행)
        for 쪽n, _, _, pg in B들:
            열, 행, _ = 데이터행(pg)               # 먼저 있는 그대로 센다
            이름표 = B배치(pg, len(열))
            if not 이름표:
                이름표 = B배치(pg)
                열, 행, _ = 데이터행(pg, len(이름표))
            if not 이름표 or len(열) != len(이름표):
                경고.append(f"p.{쪽n}(B): 열이 {len(열)}개인데 이름을 못 짬 — 쪽 버림"); 통계["B쪽버림"] += 1; continue
            for line, 칸 in 행:
                if line in 모음: 모음[line].update(dict(zip(이름표, 칸))); 모음[line]["line"] = line; 모음[line]["쪽B"] = 쪽n
            통계["B행"] += len(행)
        for 쪽n, _, _, pg in C들:
            _, _, 첫y0 = 데이터행(pg)                 # 온도 머리 위치를 알아내려고 한 번 거칠게
            온도 = 온도머리(pg, 첫y0)
            열, 행, 첫y = 데이터행(pg, len(온도) + 1 if 온도 else None)
            if not 행: 경고.append(f"p.{쪽n}(C): 데이터 행을 못 찾음 — 쪽 버림"); 통계["C쪽버림"] += 1; continue
            # 온도 머리 개수 + 1(Line No.) 과 열 개수가 같아야 한다. 다르면 숫자가 엉뚱한 온도에 붙는다.
            if len(온도) + 1 != len(열):
                경고.append(f"p.{쪽n}(C): 온도 {len(온도)}개인데 열 {len(열)}개 — 쪽 버림"); 통계["C쪽버림"] += 1; continue
            for line, 칸 in 행:
                if line not in 모음: continue
                # 값 두 개가 한 칸에 뭉치는 일이 있다("313 292"). 그러면 **그 뒤 값이 전부 한 칸씩
                # 밀려** 675°C 값이 650°C 자리에 앉는다 — 화면엔 멀쩡한 숫자라 아무도 못 알아챈다.
                # (2026-09-19 Table U SA-213 TP309S 에서 발견. 자기 최소인장강도와 40°C 값을
                #  견주는 교차검사로 잡았다.) 밀린 걸 되돌리려 추측하지 않는다 — **그 줄을 버린다.**
                뭉침 = [v for v in 칸[1:] if len(re.findall(r"\d+(?:\.\d+)?", v or "")) > 1]
                if 뭉침:
                    경고.append(f"p.{쪽n}(C) line {line}: 한 칸에 값이 둘 {뭉침[0]!r} — 뒤가 밀린다, 줄 버림")
                    통계["뭉침버림"] += 1
                    모음.pop(line, None); continue
                응력 = 모음[line].setdefault("허용응력", {})
                for t, v in zip(온도, 칸[1:]):
                    if not 빈칸(v): 응력[str(t)] = v
                모음[line]["쪽C"] = 쪽n
            통계["C행"] += len(행)

        for line, r in 모음.items():
            # **온도가 오르는데 값이 오르는 줄은 버린다.** 물리적으로 안 되는 일이라, 그런 줄은
            # 어딘가에서 옆 칸 값을 주워 온 것이다(1만 줄 중 7줄 — 예: 2A SA-841 이 400°C 161 MPa
            # 인데 425°C 215 MPa). 어느 칸이 틀렸는지는 알 수 없으니 그 줄을 통째로 버린다 —
            # 틀린 근거는 근거 없는 것보다 나쁘다. 2% 는 반올림 여유다.
            순 = [(int(t), float(v)) for t, v in sorted((r.get("허용응력") or {}).items(), key=lambda kv: int(kv[0]))
                  if re.fullmatch(r"\d+(?:\.\d+)?", str(v))]
            거꿀 = next(((t1, a, t2, b) for (t1, a), (t2, b) in zip(순, 순[1:]) if b > a * 1.02), None)
            if 거꿀:
                경고.append(f"Table {이름} line {line} ({r.get('spec')}): {거꿀[0]}°C {거꿀[1]} → {거꿀[2]}°C {거꿀[3]} "
                            f"— 온도가 올랐는데 값이 올랐다, 줄 버림")
                통계["거꿀버림"] += 1; continue
            if r.get("spec") and r.get("인장MPa") and r.get("허용응력"):
                r["표"] = 이름
                # Line No. 는 **쪽 묶음마다 1 로 다시 시작한다**(p.58·62·66·70 전부 1~45 — 실측).
                # 열쇠에 A쪽 번호를 넣지 않으면 뒤 묶음이 앞 묶음을 덮어써 재료가 통째로 사라진다.
                기록[(이름, r.get("쪽A"), line)] = r
                통계["완성"] += 1
            else:
                빠진 = [x for x, k2 in [("A", "spec"), ("B", "인장MPa"), ("C", "허용응력")] if not r.get(k2)]
                경고.append(f"Table {이름} line {line}: {'/'.join(빠진)} 가 없음 — 버림")
                통계["반쪽버림"] += 1
    d.close()
    return 기록, 경고, 통계

# ── 사람이 읽을 한 덩이로 ────────────────────────────────────────────────────
# 표마다 **어느 코드에 쓰는 값인지**가 다르다. 이걸 조각에 안 적으면 Div.1 허용응력을 물었는데
# Div.2 의 설계응력강도 Sm 이 답으로 나갈 수 있다 — 값의 정의가 다르므로 설계가 틀린다.
표설명 = {
    "1A": "Section I · III Div.1 Class 2·3 · VIII Div.1 · XII 용 최대허용응력 S (철강)",
    "1B": "Section I · III Div.1 Class 2·3 · VIII Div.1 · XII 용 최대허용응력 S (비철)",
    "2A": "Section III Div.1 Class 1·MC·CS, Div.3, Div.5 용 설계응력강도 Sm 및 VIII Div.2 Class 1 최대허용응력 S (철강)",
    "2B": "Section III Div.1 Class 1·MC·CS, Div.3, Div.5 용 설계응력강도 Sm 및 VIII Div.2 Class 1 최대허용응력 S (비철)",
    "5A": "Section VIII Div.2 Class 2 용 최대허용응력 S (철강)",
    "5B": "Section VIII Div.2 Class 2 용 최대허용응력 S (비철)",
    "3": "**볼팅(볼트·스터드) 전용** — Section III Div.1 Class 2·3 · VIII Div.1·2 · XII 용 최대허용응력 S",
    "4": "**볼팅(볼트·스터드) 전용** — Section III Div.1 Class 1·MC, Div.3, Div.5 용 설계응력강도 Sm 및 VIII Div.2 최대허용응력 S",
    "U": "온도별 **인장강도** Su (허용응력이 아니다 — 그대로 설계에 쓰면 안 된다)",
    "Y-1": "온도별 **항복강도** Sy (허용응력이 아니다 — 그대로 설계에 쓰면 안 된다)",
}

# 값의 **정의**가 표마다 다르다. 이름을 안 적으면 인장강도를 허용응력으로 읽는 사고가 난다.
값이름 = {
    "2A": "설계응력강도 Sm / 최대허용응력 S", "2B": "설계응력강도 Sm / 최대허용응력 S",
    "4": "설계응력강도 Sm / 최대허용응력 S",
    "U": "인장강도 Su", "Y-1": "항복강도 Sy",
}

def 조각글(r):
    있 = lambda v: v and not 빈칸(v)
    줄 = [f"ASME BPVC 2023 Section II-D Table {r['표']} · Line No. {r['line']}"]
    if 표설명.get(r["표"]): 줄.append(f"쓰임: {표설명[r['표']]}")
    재료 = " / ".join([x for x in [r.get("spec"), r.get("grade"), r.get("조성"), r.get("제품형태")] if 있(x)])
    줄.append(f"재료: {재료}")
    덧 = [f"{n} {r[k]}" for n, k in [("UNS", "uns"), ("Class/Condition/Temper", "class"),
                                     ("두께(mm)", "두께"), ("P-No.", "pno"), ("Group No.", "group")] if 있(r.get(k))]
    if 덧: 줄.append(" · ".join(덧))
    # 표마다 있는 칸이 다르다 — Table U 에는 항복강도 칸이 아예 없다(A쪽에 인장강도만 있다).
    # 없는 값을 "None MPa" 로 적으면 AI 가 그걸 근거로 답한다. 있는 것만 적는다.
    강도 = [f"{이름} {r[키]} MPa" for 이름, 키 in [("최소 인장강도", "인장MPa"), ("최소 항복강도", "항복MPa")]
            if 있(r.get(키))]
    if 있(r.get("외압챠트")): 강도.append(f"외압 챠트 {r['외압챠트']}")
    if 강도: 줄.append(" · ".join(강도))
    적용 = []
    for 키 in [k for k in r if k.startswith("최고온도_")] + (["최고사용온도"] if "최고사용온도" in r else []):
        라벨 = "최고사용온도" if 키 == "최고사용온도" else "Section " + 키.replace("최고온도_", "").replace("VIII1", "VIII-1").replace("VIII2", "VIII-2")
        v = (r.get(키) or "").strip()
        if 빈칸(v): continue
        붙임 = ("사용 불가(NP)" if v == "NP" else (f"{v}°C" if 키 == "최고사용온도" else f"최고 {v}°C") if re.fullmatch(r"\d+", v) else v)
        적용.append(f"{라벨} {붙임}")
    if 적용: 줄.append("적용 범위 · " + " · ".join(적용))
    응 = r.get("허용응력") or {}
    if 응:
        순 = sorted(응.items(), key=lambda kv: int(kv[0]))
        이름 = 값이름.get(r["표"], "최대허용응력 S")
        줄.append(f"{이름} (MPa) — " + " · ".join(f"{t}°C {v}" for t, v in 순))
    if 있(r.get("비고")): 줄.append(f"비고 {r['비고']}")
    return "\n".join(줄)

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/asme-2d-tables.py <II-D.pdf> <나갈파일.json> [--table 1A] [--처음 58] [--끝 0]", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    pdf, 나갈곳 = sys.argv[1], sys.argv[2]
    인자 = sys.argv[3:]
    값 = lambda 이름, 기본=None: (인자[인자.index(이름) + 1] if 이름 in 인자 else 기본)
    기록, 경고, 통계 = 표만들기(pdf, 표=값("--table"), 처음=int(값("--처음", 1)), 끝=int(값("--끝", 0)))

    chunks = [{"글": 조각글(r), "쪽": r.get("쪽A"), "머리": f"ASME BPVC 2023 Sec.II-D > Table {r['표']}"}
              for r in 기록.values()]
    with io.open(나갈곳, "w", encoding="utf-8") as f:
        # 문서 이름은 맥 색인에 이미 있는 것과 **똑같아야** 갈아끼워진다 — 다르면 중복 문서가 되고
        # 같은 재료가 두 벌 나온다(옛것에는 빠진 재료가 있으니 옛 답이 섞인다).
        json.dump({"docName": "ASME BPVC 2023 Sec.II-D (재료 허용응력표)", "chunks": chunks,
                   "원본": {f"{t}#p{p}#{l}": r for (t, p, l), r in 기록.items()}}, f, ensure_ascii=False)
    print(f"되살린 줄 {len(기록)}개 → {나갈곳}")
    print("통계: " + " · ".join(f"{k} {v}" for k, v in sorted(통계.items())))
    if 경고:
        print(f"\n경고 {len(경고)}건:")
        for w in 경고[:12]: print("  - " + w)
        if len(경고) > 12: print(f"  ... 그 밖 {len(경고)-12}건")
    if chunks: print("\n--- 첫 기록 ---\n" + chunks[0]["글"])
    return 0

if __name__ == "__main__":
    sys.exit(main())

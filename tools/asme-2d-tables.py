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
    while True:
        u = re.sub(r"(^(?:…|\.\.\.)\s+)|(\s+(?:…|\.\.\.)$)", "", t)
        if u == t: return t
        t = u
빈칸 = lambda v: (v or "").strip() in ELLIPSIS

# ── 좌표로 표 읽기 ───────────────────────────────────────────────────────────
def 줄모으기(pg, 왼쪽자르기=50):
    """낱말을 y 로 묶어 줄 단위로. (y, [낱말...])"""
    묶음 = collections.defaultdict(list)
    for w in pg.get_text("words"):
        if w[0] < 왼쪽자르기: continue
        묶음[round(w[1] / 3)].append(w)
    return [(min(v, key=lambda w: w[1])[1], sorted(v, key=lambda w: w[0])) for _, v in sorted(묶음.items())]

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
    if "Nominal Composition" in t and "Product Form" in t: 종 = "A"
    elif "Chart No." in t and ("Tensile" in t or "Yield" in t): 종 = "B"
    elif "Maximum Allowable Stress, MPa" in t or "Maximum Allowable Stress, ksi" in t: 종 = "C"
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
    return A_10 if ("Group" in t and "P-No." in t) else A_7

def B배치(pg):
    t = pg.get_text()
    return B_11 if ("Size/Thickness" in t and "P-No." in t) else B_9

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
        if not (A들 and B들 and C들):
            경고.append(f"p.{쪽}: A/B/C 가 다 모이지 않음(A{len(A들)} B{len(B들)} C{len(C들)}) — 묶음 버림")
            통계["묶음버림"] += 1; continue

        모음 = {}
        for 쪽n, _, _, pg in A들:
            이름표 = A배치(pg)
            열, 행, _ = 데이터행(pg, len(이름표))
            if len(열) != len(이름표):
                경고.append(f"p.{쪽n}(A): 열이 {len(열)}개(기대 {len(이름표)}) — 쪽 버림"); 통계["A쪽버림"] += 1; continue
            for line, 칸 in 행:
                모음[line] = dict(zip(이름표, 칸)); 모음[line]["line"] = line; 모음[line]["쪽A"] = 쪽n
            통계["A행"] += len(행)
        for 쪽n, _, _, pg in B들:
            이름표 = B배치(pg)
            열, 행, _ = 데이터행(pg, len(이름표))
            if len(열) != len(이름표):
                경고.append(f"p.{쪽n}(B): 열이 {len(열)}개(기대 {len(이름표)}) — 쪽 버림"); 통계["B쪽버림"] += 1; continue
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
                응력 = 모음[line].setdefault("허용응력", {})
                for t, v in zip(온도, 칸[1:]):
                    if not 빈칸(v): 응력[str(t)] = v
                모음[line]["쪽C"] = 쪽n
            통계["C행"] += len(행)

        for line, r in 모음.items():
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
def 조각글(r):
    있 = lambda v: v and not 빈칸(v)
    줄 = [f"ASME BPVC 2023 Section II-D Table {r['표']} · Line No. {r['line']}"]
    재료 = " / ".join([x for x in [r.get("spec"), r.get("grade"), r.get("조성"), r.get("제품형태")] if 있(x)])
    줄.append(f"재료: {재료}")
    덧 = [f"{n} {r[k]}" for n, k in [("UNS", "uns"), ("Class/Condition/Temper", "class"),
                                     ("두께(mm)", "두께"), ("P-No.", "pno"), ("Group No.", "group")] if 있(r.get(k))]
    if 덧: 줄.append(" · ".join(덧))
    줄.append(f"최소 인장강도 {r.get('인장MPa')} MPa · 최소 항복강도 {r.get('항복MPa')} MPa"
              + (f" · 외압 챠트 {r['외압챠트']}" if 있(r.get("외압챠트")) else ""))
    적용 = []
    for 라벨, 키 in [("Section I", "최고온도_I"), ("Section III", "최고온도_III"),
                    ("Section VIII-1", "최고온도_VIII1"), ("Section XII", "최고온도_XII")]:
        v = (r.get(키) or "").strip()
        적용.append(f"{라벨} " + ("사용 불가(NP)" if v == "NP" else f"최고 {v}°C" if re.fullmatch(r"\d+", v) else (v or "-")))
    줄.append("적용 범위 · " + " · ".join(적용))
    응 = r.get("허용응력") or {}
    if 응:
        순 = sorted(응.items(), key=lambda kv: int(kv[0]))
        줄.append("최대허용응력 S (MPa) — " + " · ".join(f"{t}°C {v}" for t, v in 순))
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
        json.dump({"docName": "ASME BPVC 2023 Sec.II-D (재료 허용응력)", "chunks": chunks,
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

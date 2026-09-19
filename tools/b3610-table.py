# ASME B36.10 / B36.19 — 강관 치수표(Table 2-1)를 호칭지름별 한 덩이로 되살린다.
#   python tools/b3610-table.py "<B36.10.pdf>" 나갈파일.json [--name "이름"] [--처음 14] [--끝 32]
#
# 왜 전용 도구가 필요한가:
#   1) 이 표를 그대로 글자로 뽑으면 숫자만 줄줄이 나와 어떤 질문에도 답이 못 된다.
#      "NPS 2 두께" 를 물어도 호칭지름과 두께가 다른 조각에 흩어져 있어 못 찾는다.
#   2) 서버의 PDF 는 **스캔·OCR본**이다(2026-09-19 신채완 과장이 다시 올린 판). 오독이 있다:
#      · 0 을 D 로 읽는다 — "D.405" (648개 중 3개, 0.5%)
#      · 분수 호칭(⅛ ¼ ⅜)을 "%" 로 읽는다 (27군데)
#      · XXS 를 xxs 로 (17군데)
#      **다행히 괄호 안 DN(밀리미터 호칭)은 정확하다.** 그래서 NPS 를 DN 에서 되살린다.
#      "D.405" 는 D 로 시작하는 치수가 있을 수 없으므로 0 으로 되돌린다(추측이 아니라 불가능한 값의 교정).
#
# 내보내는 모양 — 호칭지름 하나가 조각 하나(모든 스케줄이 그 안에 다 들어간다):
#   ASME B36.10-2022 Table 2-1 · NPS 2 (DN 50) 강관 치수
#   바깥지름 2.375 in. (60.33 mm)
#   Sch 40 (STD): 두께 0.154 in. (3.91 mm) · 무게 3.66 lb/ft (5.44 kg/m)
import sys, json, io, re, collections

import fitz

# DN(mm 호칭) → NPS(인치 호칭). OCR 이 분수를 깨뜨려도 DN 은 멀쩡해서 이걸로 되살린다.
DN_NPS = {6:"1/8", 8:"1/4", 10:"3/8", 15:"1/2", 20:"3/4", 25:"1", 32:"1-1/4", 40:"1-1/2",
          50:"2", 65:"2-1/2", 80:"3", 90:"3-1/2", 100:"4", 125:"5", 150:"6", 200:"8",
          250:"10", 300:"12", 350:"14", 400:"16", 450:"18", 500:"20", 550:"22", 600:"24",
          650:"26", 700:"28", 750:"30", 800:"32", 850:"34", 900:"36", 950:"38", 1000:"40",
          1050:"42", 1100:"44", 1150:"46", 1200:"48", 1250:"50", 1300:"52", 1350:"54",
          1400:"56", 1450:"58", 1500:"60", 1550:"62", 1600:"64", 1650:"66", 1700:"68",
          1750:"70", 1800:"72", 1850:"74", 1900:"76", 1950:"78", 2000:"80"}

def 고치기(s):
    """불가능한 값만 되돌린다. D/O 로 시작하는 치수는 존재하지 않으므로 0 의 오독이다."""
    s = re.sub(r"\b[DO](\.\d)", r"0\1", s)
    return s.replace("–", "-").replace("—", "-").strip()

def 낱말경계(pg):
    """이 쪽에서 '낱말 사이'로 볼 최소 간격. 낱자로 흩어진 PDF(B36.19)는 글자 사이가 0.4pt 라
    그냥 이어 붙이면 "0 . 4 0 5" 가 된다. 보통 PDF 는 낱말이 이미 붙어 있으므로 손대면 안 된다
    — 그래서 먼저 어느 쪽인지 보고 규칙을 고른다."""
    말 = pg.get_text().split()
    낱자 = sum(1 for w in 말 if len(w) == 1) / max(1, len(말))
    if 낱자 <= 0.5: return 0.9
    갭 = sorted(b[0] - a[2] for r in 줄묶기_원(pg) for a, b in zip(r, r[1:]) if 0 <= b[0] - a[2] < 8)
    return max(0.9, 갭[len(갭) // 2] * 2.5) if 갭 else 0.9

def 줄글(ws, 경계):
    out = []
    for i, w in enumerate(ws):
        if i and (w[0] - ws[i - 1][2]) >= 경계: out.append(" ")
        out.append(w[4])
    return "".join(out).strip()

def 줄묶기_원(pg, 틈=3.2):
    """y 가 가까운 낱말을 한 줄로. 식별 칸(STD/XS/XXS)이 데이터 줄보다 1~3pt 위에 찍히는 일이 있다."""
    ws = sorted(pg.get_text("words"), key=lambda w: (w[1], w[0]))
    줄, 현 = [], []
    for w in ws:
        if 현 and w[1] - 현[-1][1] > 틈: 줄.append(현); 현 = []
        현.append(w)
    if 현: 줄.append(현)
    return [sorted(r, key=lambda w: w[0]) for r in 줄]

# 열 위치는 쪽마다 다르다(p.14 는 x84, p.23 은 x64 에서 시작 — 실측). 그래서 **열을 쓰지 않는다.**
# 대신 줄의 생김새로 읽는다: 이 표의 각 줄은 항상 "값 (괄호값)" 쌍이 **정확히 셋**으로 끝난다
#   … 바깥지름 in.(mm) · 두께 in.(mm) · 무게 lb/ft (kg/m)
# 그 앞이 호칭(DN 괄호 포함)과 식별(STD/XS/XXS)·스케줄 번호다. 배치가 흔들려도 이건 안 흔들린다.
줄패턴 = re.compile(
    r"^(?P<앞>.*?)\((?P<dn>\d{1,4})\)\s*(?P<가운데>.*?)\s*"
    r"(?P<od_in>\d+(?:\.\d+)?)\s*\((?P<od_mm>\d+(?:\.\d+)?)\)\s*"
    r"(?P<w_in>\d+(?:\.\d+)?)\s*\((?P<w_mm>\d+(?:\.\d+)?)\)\s*"
    r"(?P<wt_lb>\d+(?:\.\d+)?)\s*\((?P<wt_kg>\d+(?:\.\d+)?)\)\s*$")

def 줄정리(t):
    """OCR 이 흩뜨린 숫자를 되붙인다. 전부 '숫자 안의 공백'이라 뜻이 바뀌지 않는다.
    · "0. 719" → "0.719"   · "248. 95" → "248.95"
    · "(1 050)" → "(1050)" · "(3 70.48)" → "(370.48)"   (천 단위를 띄어 읽은 것)
    · "D.405" → "0.405"    (D 로 시작하는 치수는 존재하지 않는다)"""
    # B36.19 는 칸 안에 "[Note (1)]" 이 끼어 있다. 각주 표시는 값이 아니므로 먼저 걷어낸다 —
    # 안 걷으면 줄 끝의 "값 (괄호값)" 쌍 세 개 모양이 깨져 그 줄을 통째로 못 읽는다.
    t = re.sub(r"\[\s*Notes?\s*\([^)]*\)\s*\]", " ", t)
    t = re.sub(r"\b[DO](\.\d)", r"0\1", t)                # D.405 -> 0.405
    t = re.sub(r"(\d)\.\s+(\d)", r"\1.\2", t)             # "0. 719" -> "0.719"
    for _ in range(3):
        t = re.sub(r"\((\d[\d.]*)\s+(\d)", r"(\1\2", t)   # "(1 050)" -> "(1050)"
    return re.sub(r"\s+", " ", t).strip()

def 스케줄나누기(가운데):
    """가운데 토막에서 식별(STD/XS/XXS)과 스케줄 번호(40, 80, 10S …)를 갈라낸다."""
    식별, sch = [], []
    for tok in (가운데 or "").split():
        u = tok.upper().strip(".,")
        if u in ("STD", "XS", "XXS"): 식별.append(u)
        elif re.fullmatch(r"\d{1,3}S?", u): sch.append(u)
    return " ".join(식별), " ".join(sch)

def 행읽기(pdf, 처음, 끝):
    d = fitz.open(pdf)
    끝 = 끝 or d.page_count
    행들, 경고 = [], []
    for i in range(처음 - 1, min(끝, d.page_count)):
        pg = d[i]
        경계 = 낱말경계(pg)
        줄들 = 줄묶기_원(pg)
        # 쪽 거르개는 **되붙인 글**로 봐야 한다. 낱자 PDF(B36.19)는 원문이 "T a b l e 2 - 1" 이라
        # get_text() 에 "Table 2-1" 이 없다 — 그래서 표 쪽을 전부 건너뛰고 0행이 나왔다(2026-09-19).
        if not any("Table 2-1" in 줄글(ws, 경계) for ws in 줄들[:8]): continue
        for ws in 줄들:
            t = 줄정리(줄글(ws, 경계))
            m = 줄패턴.match(t)
            if not m: continue                       # 머리글·쪽번호 등은 여기서 걸러진다
            dn = int(m.group("dn"))
            if dn not in DN_NPS:
                경고.append(f"p.{i+1}: 모르는 DN {dn} — 줄 버림  [{t[:70]}]"); continue
            식별, sch = 스케줄나누기(m.group("가운데"))
            행들.append({"쪽": i + 1, "dn": dn, "nps": DN_NPS[dn], "식별": 식별, "sch": sch,
                         "od_in": m.group("od_in"), "od_mm": m.group("od_mm"),
                         "wall_in": m.group("w_in"), "wall_mm": m.group("w_mm"),
                         "wt_lb": m.group("wt_lb"), "wt_kg": m.group("wt_kg")})
    d.close()
    return 행들, 경고

def 조각만들기(행들, docName):
    묶 = collections.OrderedDict()
    for r in 행들: 묶.setdefault((r["dn"], r["nps"]), []).append(r)
    조각 = []
    for (dn, nps), rs in 묶.items():
        od = collections.Counter((r["od_in"], r["od_mm"]) for r in rs).most_common(1)[0][0]
        줄 = [f"{docName} Table 2-1 · NPS {nps} (DN {dn}) 강관 치수",
              f"바깥지름 {od[0]} in. ({od[1]} mm)"]
        for r in rs:
            # ASME 표에는 스케줄 번호 없이 두께만 있는 줄이 있다(… 로 적힌 칸). 그건 그대로 적는다.
            if r["sch"] and r["식별"]: 표 = f"Sch {r['sch']} ({r['식별']})"
            elif r["sch"]: 표 = f"Sch {r['sch']}"
            elif r["식별"]: 표 = r["식별"]
            else: 표 = "스케줄 번호 없음"
            무게 = f" · 무게 {r['wt_lb']} lb/ft ({r['wt_kg']} kg/m)" if r["wt_lb"] else ""
            줄.append(f"{표}: 두께 {r['wall_in']} in. ({r['wall_mm']} mm){무게}")
        조각.append({"글": "\n".join(줄), "쪽": rs[0]["쪽"], "머리": f"{docName} > Table 2-1 > NPS {nps} (DN {dn})"})
    return 조각

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/b3610-table.py <pdf> <나갈파일.json> [--name 이름] [--처음 14] [--끝 32]", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    pdf, 나갈곳 = sys.argv[1], sys.argv[2]
    인자 = sys.argv[3:]
    값 = lambda n, 기본=None: (인자[인자.index(n) + 1] if n in 인자 else 기본)
    docName = 값("--name", "ASME B36.10-2022 (강관 치수)")
    행들, 경고 = 행읽기(pdf, int(값("--처음", 1)), int(값("--끝", 0)))
    조각 = 조각만들기(행들, docName)
    json.dump({"docName": docName, "chunks": 조각}, io.open(나갈곳, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"행 {len(행들)}개 → 호칭지름 {len(조각)}개 조각 → {나갈곳}")
    if 경고:
        print(f"경고 {len(경고)}건:")
        for w in 경고[:10]: print("  - " + w)
        if len(경고) > 10: print(f"  ... 그 밖 {len(경고)-10}건")
    if 조각: print("\n--- 첫 조각 ---\n" + 조각[0]["글"])
    if len(조각) > 6: print("\n--- 표본(NPS 2 부근) ---\n" + next((c["글"] for c in 조각 if "(DN 50)" in c["글"]), ""))
    return 0

if __name__ == "__main__":
    sys.exit(main())

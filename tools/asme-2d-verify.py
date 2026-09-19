# Section II-D 표가 제대로 읽혔는지 **숫자끼리 견줘서** 확인한다.
#   python tools/asme-2d-verify.py 조각.json
#
# 왜 이게 눈 대조보다 나은가:
#   쪽 그림과 대조하는 건 한 번에 한 쪽뿐이다. 그런데 열이 한 칸 밀리는 사고는 1만 줄 중
#   열 줄에서만 일어난다(2026-09-19 Table U SA-213 TP309S — "313 292" 가 한 칸에 뭉쳐
#   675°C 부터 값이 전부 한 칸씩 밀렸다. 화면엔 멀쩡한 숫자라 눈으로는 절대 못 잡는다).
#   그래서 **모든 줄이 스스로 만족해야 하는 관계**를 건다:
#
#   · Table U   : 40°C 인장강도 ≈ 그 줄의 최소 인장강도 (상온 기준점에 맞춰진 곡선이다)
#   · Table Y-1 : 40°C 항복강도 ≈ 그 줄의 최소 항복강도
#   · 그 밖     : 40°C 허용응력 < 최소 항복강도 (허용응력이 항복을 넘을 수는 없다)
#   · 온도가 오르면 값이 내려간다 (올라가는 구간이 있으면 열이 섞인 것이다)
#   · 응력 칸에 숫자가 아닌 게 있으면 안 된다 (개정 표시 "ð23Þ" 가 값 자리에 들어간 적이 있다)
#
# 눈 대조를 없애자는 게 아니다. 눈은 **한 쪽**을 보고, 이건 **전부**를 본다. 둘 다 한다.
import sys, json, io, re, statistics as st, collections

수 = lambda v: float(v) if re.fullmatch(r"\d+(?:\.\d+)?", str(v or "").strip()) else None

def 확인(이름, 참, 메모=""):
    print(("PASS  " if 참 else "FAIL  ") + 이름 + ("  — " + 메모 if 메모 else ""))
    return 0 if 참 else 1

def main():
    if len(sys.argv) < 2:
        print("쓰는 법: python tools/asme-2d-verify.py <조각.json>", file=sys.stderr); return 2
    sys.stdout.reconfigure(encoding="utf-8")
    j = json.load(io.open(sys.argv[1], encoding="utf-8"))
    원 = list(j.get("원본", {}).values())
    if not 원: print("원본이 없다 — 조각 파일이 맞나?", file=sys.stderr); return 2
    실패 = 0
    print(f"{len(원)}줄 · {j.get('docName')}\n")

    # 1) 응력 칸은 전부 숫자다
    나쁨 = [(r.get("표"), r.get("spec"), t, v) for r in 원
            for t, v in (r.get("허용응력") or {}).items() if 수(v) is None]
    실패 += 확인("응력 칸이 전부 숫자다", not 나쁨, f"{len(나쁨)}개 이상 — 예: {나쁨[:2]}" if 나쁨 else "")

    # 2) 표별 관계
    표별 = collections.defaultdict(list)
    for r in 원: 표별[r.get("표")].append(r)
    for 표, 줄들 in sorted(표별.items(), key=lambda kv: str(kv[0])):
        기준 = {"U": "인장MPa", "Y-1": "항복MPa"}.get(표)
        if 기준:
            비 = [수((r.get("허용응력") or {}).get("40")) / 수(r[기준])
                  for r in 줄들 if 수(r.get(기준)) and 수((r.get("허용응력") or {}).get("40"))]
            벗 = [x for x in 비 if not 0.90 <= x <= 1.12]
            실패 += 확인(f"Table {표}: 40°C 값이 그 줄의 최소강도와 맞는다 ({len(줄들)}줄)",
                        비 and len(벗) / len(비) < 0.02,
                        f"중앙값 {st.median(비):.3f} · 벗어남 {len(벗)}건({len(벗)/len(비)*100:.1f}%)" if 비 else "견줄 게 없다")
        else:
            넘 = [r for r in 줄들 if 수(r.get("항복MPa")) and 수((r.get("허용응력") or {}).get("40"))
                  and 수(r["허용응력"]["40"]) > 수(r["항복MPa"])]
            실패 += 확인(f"Table {표}: 40°C 허용응력이 최소 항복강도를 안 넘는다 ({len(줄들)}줄)",
                        not 넘, f"{len(넘)}줄이 넘는다 — 예: {넘[0].get('spec')} {넘[0].get('grade')}" if 넘 else "")

    # 3) 온도가 오르면 값이 내려간다(같은 값은 괜찮다). 열이 섞이면 여기서 튄다.
    거꿀 = []
    for r in 원:
        순 = [(int(t), 수(v)) for t, v in sorted((r.get("허용응력") or {}).items(), key=lambda kv: int(kv[0]))]
        순 = [(t, v) for t, v in 순 if v is not None]
        for (t1, a), (t2, b) in zip(순, 순[1:]):
            if b > a * 1.02:                       # 2% 는 반올림 여유
                거꿀.append((r.get("표"), r.get("spec"), t1, a, t2, b)); break
    실패 += 확인("온도가 오르면 값이 내려간다", len(거꿀) / max(1, len(원)) < 0.01,
                f"거꾸로 가는 줄 {len(거꿀)}개 — 예: {거꿀[:2]}" if 거꿀 else "")

    print(f"\n{'전부 통과' if not 실패 else str(실패) + '개 실패'}")
    return 1 if 실패 else 0

if __name__ == "__main__":
    sys.exit(main())

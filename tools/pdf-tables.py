# 캡션이 **없는** 표를 괘선으로 찾아 그림으로 오려낸다.
#   python tools/pdf-tables.py "<책.pdf>" <나갈폴더> --name "문서 이름" --slug enr2 [--처음 1] [--끝 0] [--dpi 170]
#   → asme-figs.py 와 같은 모양의 <slug>.json — figs-to-chunks.py·doc_figs.js 를 그대로 쓴다.
#
# 왜 따로 필요한가 (2026-09-19, 에너지이용합리화법 고시):
#   ASME·KGS 는 표마다 "Table 1A" · "표 3.2.12" 처럼 번호와 캡션이 붙어 있어 캡션으로 찾을 수 있다.
#   그런데 이 고시는 **표에 번호도 캡션도 없다.** 본문 한가운데 "구 분 | 판의 최소두께(㎜)" 처럼
#   그냥 들어가 있다. 캡션으로 찾는 asme-figs.py 는 이 문서에서 표를 0개 찾았다.
#   그러면서 정작 제일 필요한 표(온도별 기본허용응력)가 통째로 빠진다 —
#   글로 뽑으면 숫자뿐이라 조각내기 단계에서 버려지고, 그림으로도 안 잡히니 **어디에도 안 남는다.**
#
# 어떻게 찾나: 표는 **괘선**이 있다. 그려진 도형 중 가늘고 긴 것(선)만 모아,
#   세로로 이어지는 덩어리(띠)로 묶고, 선이 충분히 많은 띠만 표로 본다.
#   띠 **위쪽 몇 줄**을 같이 담는다 — 표 제목·머리말이 거기 있어서, 없으면 무슨 표인지 알 수 없다.
#
# 이름은 어떻게 붙나: 그 쪽에서 띠보다 위에 있는 **번호 제목**(예 "3.2.12 재료의 종탄성계수")
#   중 가장 가까운 것. 없으면 띠 안 첫 줄. 이름이 없으면 검색이 안 되므로 마지막에는 쪽 번호라도 쓴다.
import sys, os, io, json, re, collections

import fitz

선두께 = 2.5        # 이보다 얇아야 괘선으로 본다(글자 획·음영 상자를 거른다)
선길이 = 40.0       # 이보다 길어야 괘선
띠간격 = 26.0       # 이만큼 떨어지면 다른 표로 본다
최소선 = 6          # 띠 안에 괘선이 이만큼은 있어야 표다
머리여백 = 46.0     # 띠 위로 이만큼 더 담는다(표 제목·머리말 자리)
여백 = 8.0
# 제목은 "3.2.12 재료의 종탄성계수" 처럼 **점 있는 번호 + 한글 제목**이다.
# 점 없는 "2 dln"(수식 쪼가리)까지 받으면 표 이름이 죄다 수식이 된다(실측).
제목규칙 = re.compile(r"^(\d+(?:\.\d+){1,3})\s+([가-힣].*)$")


def 괘선들(pg):
    """가로선·세로선을 나눠서 돌려준다. 나눠야 하는 이유는 아래 띠묶기 참고."""
    가로, 세로 = [], []
    try: 그림 = pg.get_drawings()
    except Exception: return 가로, 세로
    for d in 그림:
        r = d["rect"]
        w, h = r.width, r.height
        if h <= 선두께 and w >= 선길이: 가로.append((r.x0, r.y0, r.x1, r.y1))
        elif w <= 선두께 and h >= 선길이: 세로.append((r.x0, r.y0, r.x1, r.y1))
    return 가로, 세로


def 띠묶기(가로, 세로):
    """세로로 이어지는 괘선 덩어리. 표 하나가 띠 하나다.

    **가로선만 있는 덩어리는 표가 아니다.** 수식의 분수선이 딱 그 모양이라, 안 거르면
    "A = [πdl+ π" 같은 수식이 표로 260개 잡힌다(실측). 표는 칸을 나누는 **세로선**이 있다."""
    선 = 가로 + 세로
    if not 선: return []
    순 = sorted(선, key=lambda s: s[1])
    띠, 현 = [], [순[0]]
    for s in 순[1:]:
        아래 = max(x[3] for x in 현)
        if s[1] - 아래 > 띠간격: 띠.append(현); 현 = []
        현.append(s)
    띠.append(현)
    가로집 = set(map(tuple, 가로))
    좋은띠 = []
    for t in 띠:
        가 = [x for x in t if tuple(x) in 가로집]
        v = len(t) - len(가)
        if len(가) < 3 or v < 2 or len(t) < 최소선: continue
        # **도면을 거르는 규칙.** 선만 세면 도면(해칭·원·치수선)이 표로 잡힌다 — 실제로 첫 결과가
        # 전열면적 도면이었다. 표는 가로줄이 **같은 폭으로 줄 맞춰** 있고, 도면은 제각각이다.
        # 그래서 "왼쪽 끝과 오른쪽 끝이 8pt 안에서 같은 가로줄"이 3개 이상일 때만 표로 본다.
        맞춘수 = 0
        for a in 가:
            같은것 = sum(1 for b in 가 if abs(b[0] - a[0]) <= 8 and abs(b[2] - a[2]) <= 8)
            맞춘수 = max(맞춘수, 같은것)
        if 맞춘수 < 3: continue
        좋은띠.append(t)
    return 좋은띠


def 줄글(pg):
    """(y, 글) 목록. **띄어쓰기를 좌표로 되살려서** 준다.

    이 고시는 공백 문자 없이 좌표로만 띄워 놨다(tools/pdf-respace.py 와 같은 문제). 그대로 이름을
    지으면 "재료의각온도에서의허용인장응력" 이 되어 **검색으로 영영 못 찾는다** — 이름이 곧 검색어인데."""
    out = []
    for b in pg.get_text("rawdict").get("blocks", []):
        for l in b.get("lines", []):
            ch = [c for sp in l.get("spans", []) for c in sp.get("chars", [])]
            if not ch: continue
            갭 = sorted(b2["bbox"][0] - a["bbox"][2] for a, b2 in zip(ch, ch[1:]))
            경계 = max(1.2, (갭[len(갭) // 2] if 갭 else 0.3) * 3)
            조각 = [ch[0]["c"]]
            for a, b2 in zip(ch, ch[1:]):
                if b2["bbox"][0] - a["bbox"][2] >= 경계 and not 조각[-1].isspace() and not b2["c"].isspace():
                    조각.append(" ")
                조각.append(b2["c"])
            t = "".join(조각).strip()
            if t: out.append((l["bbox"][1], t))
    out.sort()
    return out


def 이름짓기(pg, 위, 아래):
    """띠 위의 가장 가까운 번호 제목. 없으면 띠 안 첫 줄."""
    줄 = 줄글(pg)
    제목 = ""
    for y, t in 줄:
        if y >= 위: break
        m = 제목규칙.match(t)
        if m and len(t) <= 60: 제목 = t
    if 제목: return 제목
    # 띠 안 첫 줄로 대신할 때도 **한글이 있는 줄**만 — 숫자·기호 줄을 이름으로 쓰면 검색이 안 된다.
    안쪽 = [t for y, t in 줄 if 위 <= y <= 아래 and len(t) >= 2 and re.search(r"[가-힣]{2,}", t)]
    return 안쪽[0][:60] if 안쪽 else ""


def 뽑기(pdf, 나갈폴더, docName, slug, 처음=1, 끝=0, dpi=170, 쪽당최대=4):
    d = fitz.open(pdf)
    끝 = 끝 or d.page_count
    폴더 = os.path.join(나갈폴더, slug)
    os.makedirs(폴더, exist_ok=True)
    목록, 건너뜀 = [], collections.Counter()
    for i in range(처음 - 1, min(끝, d.page_count)):
        pg = d[i]
        띠 = 띠묶기(*괘선들(pg))
        if not 띠: continue
        if len(띠) > 쪽당최대: 건너뜀["띠가 너무 많음"] += 1; continue
        for n, t in enumerate(띠, 1):
            위 = max(0, min(x[1] for x in t) - 머리여백)
            아래 = min(pg.rect.height, max(x[3] for x in t) + 여백)
            왼 = max(0, min(x[0] for x in t) - 여백)
            오 = min(pg.rect.width, max(x[2] for x in t) + 여백)
            if 아래 - 위 < 40 or 오 - 왼 < 80: 건너뜀["너무 작음"] += 1; continue
            이름 = f"t{i+1}-{n}.png"
            길 = os.path.join(폴더, 이름)
            pix = pg.get_pixmap(dpi=dpi, clip=fitz.Rect(왼, 위, 오, 아래))
            if pix.width < 140 or pix.height < 60: 건너뜀["너무 작음"] += 1; continue
            pix.save(길)
            제목 = 이름짓기(pg, 위, 아래)
            목록.append({
                "키": f"{slug}/{이름}", "문서": docName, "쪽": i + 1,
                "그림번호": f"p{i+1}-{n}", "캡션": (제목 or f"표 (p.{i+1})"), "제목": "", "종류": "table",
                "폭": pix.width, "높이": pix.height, "바이트": os.path.getsize(길),
            })
    d.close()
    with io.open(os.path.join(나갈폴더, slug + ".json"), "w", encoding="utf-8") as f:
        json.dump({"문서": docName, "slug": slug, "그림": 목록}, f, ensure_ascii=False)
    return 목록, 건너뜀


def main():
    if len(sys.argv) < 3:
        print('쓰는 법: python tools/pdf-tables.py <책.pdf> <나갈폴더> --name "이름" --slug s [--처음 1] [--끝 0]', file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    인 = sys.argv[3:]
    값 = lambda k, 기본=None: (인[인.index(k) + 1] if k in 인 else 기본)
    pdf, 나갈폴더 = sys.argv[1], sys.argv[2]
    slug = 값("--slug", "tbl")
    목록, 건너뜀 = 뽑기(pdf, 나갈폴더, 값("--name", slug), slug,
                       처음=int(값("--처음", 1)), 끝=int(값("--끝", 0)), dpi=int(값("--dpi", 170)))
    크기 = sum(x["바이트"] for x in 목록)
    print(f"{값('--name', slug)} — 표 {len(목록)}개 · {크기/1048576:.1f}MB · 평균 {크기//max(1,len(목록))//1024}KB")
    if 건너뜀: print("건너뜀: " + " · ".join(f"{k} {v}" for k, v in 건너뜀.items()))
    for x in 목록[:4]: print(f"  {x['키']}  {x['캡션'][:60]}")
    이름없음 = sum(1 for x in 목록 if x["캡션"].startswith("표 (p."))
    if 이름없음: print(f"⚠ 이름을 못 붙인 표 {이름없음}개 — 검색으로 못 찾는다(쪽으로만 찾힌다)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

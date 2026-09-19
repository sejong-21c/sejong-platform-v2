# ASME 코드북에서 그림을 오려낸다.
#   python tools/asme-figs.py "<책.pdf>" <나갈폴더> --name "ASME Sec.VIII Div.1" --slug viii [--처음 76] [--dpi 170] [--종류 figure,table]
#   → <나갈폴더>/<slug>/p<쪽>-<n>.png  +  <나갈폴더>/<slug>.json (목록)
#
# 왜 이렇게 뽑나 (2026-09-19 실측):
#  1) **extract_image() 를 쓰면 안 된다** — 1비트 마스크 때문에 색이 반전돼 검은 바탕이 나온다.
#     쪽에서 **오려낸다**(get_pixmap(clip=...)). 캡션·주석까지 같이 들어와서 오히려 낫다.
#  2) **삽입 이미지 bbox 로 잡으면 안 된다** — ASME 그림은 작은 조각 수백 개로 쪼개져 있거나
#     아예 벡터다(Sec.VIII 은 큰 이미지가 87개뿐인데 실제 그림은 194개다).
#     그래서 **캡션을 기준으로** 영역을 정한다. 벡터든 래스터든 똑같이 잡힌다.
#  3) 캡션 판별: 그 줄이 "Figure XX-nn" 으로 시작하고 **짧고 가운데 정렬**일 것.
#     본문 속 "see Figure UG-28" 참조는 긴 줄이라 걸러진다(안 거르면 한 쪽에서 5개가 잡힌다).
#  4) 그림은 캡션 **아래**에 있다(실측 p.89·90·100 전부). 다음 캡션 전까지, 없으면 쪽 끝까지.
import sys, json, io, os, re, collections

import fitz

# 표도 같이 뽑는다(2026-09-19 부장님 요청): "저 테이블을 보면서 찾는 것도 있어서".
# QW-255.1 같은 변수 매트릭스는 글로 뽑으면 못 읽는다 — 눈으로 봐야 하는 자료다.
머리규칙 = {
    "figure": re.compile(r"^Figure\s+([A-Z0-9][\w.\-/()]*)"),
    "table": re.compile(r"^Table\s+([A-Z0-9][\w.\-/()]*)"),
    # 한국 규정(KGS 등)은 "표 1.3.1.2 …" · "그림 3.5.7 …" 이다. 종류 이름은 영어와 같게 둔다 —
    # figs-to-chunks.py 와 doc_figs.js 가 "table"/"figure" 로 갈라 보기 때문이다.
    "표kr": re.compile(r"^표\s*([0-9][\w.\-/()]*)"),
    "그림kr": re.compile(r"^그림\s*([0-9][\w.\-/()]*)"),
}

def 캡션들(pg, 최대글자=90, 가운데허용=0.10, 종류=("figure", "table")):
    W = pg.rect.width
    묶 = collections.defaultdict(list)
    for w in pg.get_text("words"): 묶[round(w[1] / 3)].append(w)
    out = []
    for k in sorted(묶):
        ws = sorted(묶[k], key=lambda w: w[0])
        글 = " ".join(w[4] for w in ws)
        if len(글) > 최대글자: continue
        종 = m = None
        for t in 종류:
            m = 머리규칙[t].match(글)
            if m: 종 = t; break
        if not m: continue
        x0, x1 = ws[0][0], ws[-1][2]
        if abs((x0 + x1) / 2 - W / 2) > 가운데허용 * W: continue
        # 한국어 캡션도 종류 이름은 영어로 접는다 — 아래 집계와 figs-to-chunks·doc_figs 가 그걸로 가른다.
        영문종 = {"표kr": "table", "그림kr": "figure"}.get(종, 종)
        out.append({"y": ws[0][1], "번호": m.group(1).rstrip("."), "캡션": 글, "종류": 영문종,
                    "줄번호": k, "아래": ws[-1][3]})
    # **제목 줄을 이어 붙인다.** 캡션은 "Table QW-256" 뿐이고, GTAW 인지 GMAW 인지는 **다음 줄**에 있다
    # ("Welding Variables Procedure Specifications (WPS) — Gas Tungsten-Arc Welding (GTAW)").
    # 이걸 빼먹어서 GTAW 를 물었는데 GMAW 표가 나왔다(2026-09-19 신채완 과장 시험에서 발각).
    줄목록 = sorted(묶)
    for c in out:
        제목 = []
        직전아래 = c["아래"]
        for k in 줄목록:
            if k <= c["줄번호"]: continue
            ws = sorted(묶[k], key=lambda w: w[0])
            글 = " ".join(w[4] for w in ws)
            if ws[0][1] - 직전아래 > 8: break                 # 줄 사이가 벌어지면 제목이 끝난 것
            if abs((ws[0][0] + ws[-1][2]) / 2 - W / 2) > 가운데허용 * W: break
            글자 = sum(1 for ch in 글 if ch.isalpha())
            if len(글) < 6 or 글자 / max(1, len(글)) < 0.55: break   # 숫자·기호 줄이면 표 머리다
            제목.append(글)
            직전아래 = ws[-1][3]
            if len(제목) >= 3: break
        c["제목"] = " ".join(제목)
    return out

def 영역들(pg, 여백=8, 종류=("figure", "table")):
    """캡션마다 (캡션, clip). 그림·표는 캡션 아래 ~ 다음 캡션 전까지."""
    캡 = 캡션들(pg, 종류=종류)
    if not 캡: return []
    말 = pg.get_text("words")
    if not 말: return []
    왼 = max(0, min(w[0] for w in 말) - 여백)
    오 = min(pg.rect.width, max(w[2] for w in 말) + 여백)
    아래끝 = min(pg.rect.height, max(w[3] for w in 말) + 여백)
    out = []
    for i, c in enumerate(캡):
        위 = max(0, c["y"] - 6)
        아래 = (캡[i + 1]["y"] - 6) if i + 1 < len(캡) else 아래끝
        if 아래 - 위 < 40: continue          # 캡션만 있고 그림이 없는 것(다음 쪽으로 넘어간 경우)
        out.append((c, fitz.Rect(왼, 위, 오, 아래)))
    return out

def 뽑기(pdf, 나갈폴더, docName, slug, 처음=1, 끝=0, dpi=170, 쪽당최대=6, 종류=("figure", "table"), 목록만=False):
    d = fitz.open(pdf)
    끝 = 끝 or d.page_count
    폴더 = os.path.join(나갈폴더, slug)
    os.makedirs(폴더, exist_ok=True)
    목록, 건너뜀 = [], collections.Counter()
    for i in range(처음 - 1, min(끝, d.page_count)):
        pg = d[i]
        영역 = 영역들(pg, 종류=종류)
        # 캡션이 잔뜩 있는 쪽은 그림이 아니라 목록(LIST OF FIGURES)이다 — 통째로 건너뛴다
        if len(영역) > 쪽당최대: 건너뜀["목록쪽"] += 1; continue
        for n, (c, clip) in enumerate(영역, 1):
            이름 = f"p{i+1}-{n}.png"
            길 = os.path.join(폴더, 이름)
            if 목록만:
                if not os.path.exists(길): 건너뜀["파일없음"] += 1; continue
                pix = None
            else:
                pix = pg.get_pixmap(dpi=dpi, clip=clip)
                if pix.width < 120 or pix.height < 90: 건너뜀["너무작음"] += 1; continue
                pix.save(길)
            목록.append({
                "키": f"{slug}/{이름}", "문서": docName, "쪽": i + 1,
                "그림번호": c["번호"], "캡션": c["캡션"], "제목": c.get("제목", ""), "종류": c.get("종류", "figure"),
                **({"폭": pix.width, "높이": pix.height} if pix else {}),
                "바이트": os.path.getsize(길),
            })
    d.close()
    with io.open(os.path.join(나갈폴더, slug + ".json"), "w", encoding="utf-8") as f:
        json.dump({"문서": docName, "slug": slug, "그림": 목록}, f, ensure_ascii=False)
    return 목록, 건너뜀

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/asme-figs.py <책.pdf> <나갈폴더> --name 이름 --slug viii [--처음 76] [--dpi 170]", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    pdf, 나갈폴더 = sys.argv[1], sys.argv[2]
    인 = sys.argv[3:]
    값 = lambda n, 기본=None: (인[인.index(n) + 1] if n in 인 else 기본)
    docName = 값("--name", os.path.basename(pdf))
    slug = 값("--slug", "fig")
    종류 = tuple(값("--종류", "figure,table").split(","))
    목록, 건너뜀 = 뽑기(pdf, 나갈폴더, docName, slug, 종류=종류, 목록만=("--목록만" in 인),
                       처음=int(값("--처음", 1)), 끝=int(값("--끝", 0)), dpi=int(값("--dpi", 170)))
    총 = sum(x["바이트"] for x in 목록)
    셈 = {t: sum(1 for x in 목록 if x.get("종류") == t) for t in ("figure", "table")}
    print(f"{docName} — 그림 {셈['figure']}개 · 표 {셈['table']}개 · 합 {len(목록)}개 · {총/1048576:.1f}MB · 평균 {총//max(1,len(목록))//1024}KB")
    if 건너뜀: print("건너뜀: " + " · ".join(f"{k} {v}" for k, v in 건너뜀.items()))
    for x in 목록[:3]: print(f"  {x['키']}  {x['캡션'][:40]} | {x.get('제목','')[:60]}")
    return 0

if __name__ == "__main__":
    sys.exit(main())

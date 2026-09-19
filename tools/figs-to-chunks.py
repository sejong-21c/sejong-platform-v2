# 그림·표 목록 → 검색용 조각.
#   python tools/figs-to-chunks.py <그림폴더> <나갈파일.json>
#
# 왜 필요한가 (2026-09-19 신채완 과장 시험에서 드러난 것):
#   "GTAW 필수변수 표를 보여주세요" 라고 물었더니 **GMAW 표(QW-651)** 가 나왔다.
#   그림을 "질문" 이 아니라 "찾아낸 조각이 있는 쪽" 으로 붙이고 있었기 때문이다 —
#   GTAW 조문 옆 쪽에 GMAW 표가 있으면 그게 딸려온다.
#
#   게다가 캡션으로는 구분도 안 됐다. 캡션은 "Table QW-256" 한 줄뿐이고, GTAW 인지 GMAW 인지는
#   **다음 줄 제목**에 있다: "Welding Variables Procedure Specifications (WPS) — Gas Tungsten-Arc Welding (GTAW)"
#
#   그래서 그림·표 하나하나를 **검색되는 조각으로 만든다.** 그러면 "GTAW 필수변수 표" 가 그 표의
#   제목과 곧바로 맞아 딱 그 표가 올라오고, 조각이 가리키는 그림이 그대로 붙는다.
#
# 조각 글을 짧게 쓰는 이유: 조각이 3,000개인데 앞머리가 다 같으면(문서 이름·안내 문구)
# 임베딩이 서로 닮아 버려 구분이 안 된다. **제목을 맨 앞에**, 군더더기는 최소로.
import sys, json, io, os, glob, re

# 영문 용어만 있으면 한국어로 묻는 직원이 못 찾는다. 실제로 쓰는 말만 붙인다(추측해서 늘리지 않는다).
동의어 = [
    (r"Gas Tungsten-?Arc", "GTAW 티그 TIG 가스텅스텐아크"),
    (r"Gas Metal-?Arc", "GMAW 미그 MIG MAG 가스메탈아크"),
    (r"Flux Cored", "FCAW 플럭스코어드"),
    (r"Shielded Metal-?Arc", "SMAW 피복아크 스틱용접"),
    (r"Submerged-?Arc", "SAW 서브머지드아크"),
    (r"Plasma-?Arc", "PAW 플라스마아크"),
    (r"Electroslag", "ESW 일렉트로슬래그"),
    (r"Electrogas", "EGW 일렉트로가스"),
    (r"Oxyfuel", "OFW 산소아세틸렌"),
    (r"Stud Welding", "스터드용접"),
    (r"Brazing", "브레이징 경납땜"),
    (r"Radiograph", "RT 방사선투과시험"),
    (r"Ultrasonic", "UT 초음파탐상"),
    (r"Magnetic Particle", "MT 자분탐상"),
    (r"Liquid Penetrant", "PT 침투탐상"),
    (r"Visual Examination", "VT 육안검사"),
    (r"Eddy Current", "ET 와전류"),
    (r"Acoustic Emission", "AE 음향방출"),
    (r"Welding Variables", "용접 필수변수 WPS 용접절차서"),
    (r"Procedure Qualification", "PQR 절차인정"),
    (r"Performance Qualification", "용접사 자격인정"),
    (r"Pressure[–-]Temperature Ratings", "압력온도 등급"),
    (r"Dimensions", "치수"),
    (r"Allowable Stress", "허용응력"),
    (r"Impact Test|Toughness", "충격시험 인성"),
    (r"Heat Treatment|PWHT", "열처리 후열처리"),
    (r"Chemical (?:Composition|Requirements)", "화학성분"),
    (r"(?:Tensile|Mechanical) (?:Requirements|Properties)", "기계적 성질 인장"),
    (r"Flange", "플랜지"),
    (r"Nozzle|Opening", "노즐 개구부"),
    (r"P-?Numbers?|F-?Numbers?|A-?Numbers?", "P번호 F번호 A번호"),
]

def 한국어(글):
    말 = []
    for 패, ko in 동의어:
        if re.search(패, 글, re.I): 말.append(ko)
    return " ".join(말)

def 만들기(그림폴더):
    조각 = []
    for f in sorted(glob.glob(os.path.join(그림폴더, "*.json"))):
        j = json.load(io.open(f, encoding="utf-8"))
        for g in j.get("그림", []):
            캡션 = re.sub(r"\s+", " ", (g.get("캡션") or "")).strip()
            제목 = re.sub(r"[ðÞ23]{2,}", " ", (g.get("제목") or "")).strip()
            제목 = re.sub(r"\s+", " ", 제목)
            종 = "표" if g.get("종류") == "table" else "그림(도면)"
            머리글 = " — ".join(x for x in (캡션, 제목) if x)
            줄 = [머리글, f"{종} · {g['문서']} p.{g['쪽']}"]
            ko = 한국어(머리글)
            if ko: 줄.append(ko)
            조각.append({
                "글": "\n".join(줄),
                "머리": f"{g['문서']} > {캡션}",
                "쪽": g["쪽"],
                "그림": g["키"],          # 이 조각이 가리키는 그림 — doc_figs 가 이걸 먼저 쓴다
            })
    return 조각

def main():
    if len(sys.argv) < 3:
        print("쓰는 법: python tools/figs-to-chunks.py <그림폴더> <나갈파일.json> [--name \"문서 이름\"]", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    # 문서 이름을 못 박아 두면 안 된다 — 맥 색인은 **같은 이름이면 갈아끼운다.**
    # KGS 그림을 넣으면서 이름을 안 바꾸면 애써 넣은 ASME 3,040장이 통째로 날아간다(2026-09-19 직전에 발견).
    인 = sys.argv[3:]
    이름 = 인[인.index("--name") + 1] if "--name" in 인 else "ASME 도면·표 목록"
    조각 = 만들기(sys.argv[1])
    한글붙음 = sum(1 for c in 조각 if len(c["글"].split("\n")) >= 3)
    json.dump({"docName": 이름, "chunks": 조각},
              io.open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
    print(f"조각 {len(조각)}개 (한국어 용어 붙은 것 {한글붙음}개) → {sys.argv[2]}")
    for c in 조각[:2]: print("---\n" + c["글"])
    return 0

if __name__ == "__main__":
    sys.exit(main())

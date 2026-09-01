# COMPRESS 계산서 대조 — 수소에너젠 SP-101 SEPARATOR (2022, 세종기술 제작 실물)
# 원본: 준공도서 서면심사 서류 "1. SEPARATOR SP-101, SP-102 (4EA).pdf" 63~150쪽
#       COMPRESS 2021 Build 8100 · ASME VIII-1 2019 Metric
# 입력은 계산서에 인쇄된 값 그대로: SA-240 316L S=115MPa@95°C, ID 1,180, CA 0.
# 정수두 포함 P (계산서 표기): 부재마다 다르다.
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pvcalc import cylinder_thickness, torispherical_thickness

S, E1 = 115.0, 1.0
케이스 = [
    # (이름, 종류, P[MPa], E, COMPRESS 값[mm])
    ("TOP HEAD (10% dished L=1180 r=118)", "tori", 0.9839, 1.0, 7.78),
    ("SF on TOP HEAD (원통 R=590)",         "cyl",  0.9842, 1.0, 5.08),
    ("SHELL (원통 R=590, E=0.85)",          "cyl",  0.994,  0.85, 6.04),
    ("SF on BTM HEAD (원통 R=590)",         "cyl",  0.9944, 1.0, 5.13),
    ("BTM HEAD (10% dished, 요약표)",        "tori", 0.9954, 1.0, 7.88),
]

print(f"{'부재':44s} {'pvcalc':>8s} {'COMPRESS':>9s} {'차이':>8s}")
전부통과 = True
for 이름, 종류, P, E, 기대 in 케이스:
    if 종류 == "cyl":
        r = cylinder_thickness(P=P, R=590.0, S=S, E=E, CA=0.0)
        t = r.results["t_req_ca"]
    else:
        r = torispherical_thickness(P=P, L=1180.0, r_knuckle=118.0, S=S, E=E, CA=0.0)
        t = r.results["t_req_ca"]
    차이 = abs(t - 기대)
    판정 = "OK" if 차이 < 0.01 else ("~" if 차이 < 0.03 else "다름!")
    if 차이 >= 0.03: 전부통과 = False
    print(f"{이름:44s} {t:8.3f} {기대:9.2f} {차이:8.3f}  {판정}")

print()
print("결론:", "전 부재 일치 (반올림 0.01mm 이내)" if 전부통과 else "차이 있음 — 원인 확인 필요")

# 국내 기준(KPM 계열) 실물 대조 — 경성화학 R-101 자켓 반응기 (2022, 세종기술 제작)
# 원본: 준공도서 2. PERMIT REPORT/2-3. 강도계산서/220504 R-101.pdf (수계산서,
#       적용규격 산업자원부고시 제2021-133호 — 식 계보는 KPM 동일: 1.2P/0.2P·K·W)
# 인쇄값 그대로: SA240-304 σa=114(=456/4), STS304TP σa=97, η=1.0, α=0.
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pvcalc.kec import cylinder_thickness, ellipsoidal_head_thickness, torispherical_head_thickness

케이스 = [
    ("동체 (Di 1720)",
     lambda: cylinder_thickness(P=0.20, Di=1720.0, sigma_a=114.0, eta=1.0, alpha=0.0), 1.51),
    ("하부 경판 반타원 2:1 (K=1)",
     lambda: ellipsoidal_head_thickness(P=0.20, D=1720.0, D_over_2h=2.0, sigma_a=114.0, eta=1.0, alpha=0.0), 1.51),
    ("상부 경판 접시형 (R1720·r172, W=1.54)",
     lambda: torispherical_head_thickness(P=0.20, R=1720.0, r_knuckle=172.0, sigma_a=114.0, eta=1.0, alpha=0.0), 2.32),
    ("MANHOLE 동체 (Di 497, σ97)",
     lambda: cylinder_thickness(P=0.20, Di=497.0, sigma_a=97.0, eta=1.0, alpha=0.0), 0.51),
    ("MANHOLE 뚜껑판 반타원 (D 497)",
     lambda: ellipsoidal_head_thickness(P=0.20, D=497.0, D_over_2h=2.0, sigma_a=114.0, eta=1.0, alpha=0.0), 0.44),
]

print(f"{'부재':40s} {'pvcalc':>8s} {'계산서':>7s} {'차이':>7s}")
전부 = True
for 이름, fn, 기대 in 케이스:
    r = fn()
    t = r.results.get("t_req_alpha", r.results.get("t_req_ca", r.results.get("t_req")))
    차이 = abs(t - 기대)
    ok = 차이 < 0.01
    전부 = 전부 and ok
    print(f"{이름:40s} {t:8.3f} {기대:7.2f} {차이:7.3f}  {'OK' if ok else '다름!'}")

print()
print("결론:", "전 부재 일치" if 전부 else "차이 있음 — 원인 확인 필요")

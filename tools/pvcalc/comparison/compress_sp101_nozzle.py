# SP-101 노즐 대조 — N-2 KOH WATER IN (NPS 3, 중심에서 350mm 오프셋)
# COMPRESS 계산서 29~31/86쪽 인쇄값 그대로.
# 오프셋 노즐이라 개구부가 현(chord) 96.75mm — 그 평면은 F=0.5 (지배 평면).
# COMPRESS 는 UG-37 의 fr1·fr2 를 1.0 으로 뒀다 (TP316L 용접관을 모재와 같은 허용선으로).
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from pvcalc import area_reinforcement, ug45_neck_thickness, cylinder_thickness

P = 0.9864          # 0.98 + 정수두 0.0064 (29/86쪽 인쇄)
S = 115.0
tr = cylinder_thickness(P=P, R=590.0, S=S, E=1.0, CA=0.0).results["t_req_ca"]
trn = cylinder_thickness(P=P, R=77.93 / 2, S=S, E=1.0, CA=0.0).results["t_req_ca"]
print(f"tr(셸, E=1) = {tr:.4f}  (기대 ~5.086)")
print(f"trn(노즐)   = {trn:.4f}  (기대 ~0.336)")

r = area_reinforcement(
    d=96.75, t=10.0, tr=tr, tn=5.49, trn=trn,
    Sv=S, Sn=S,            # fr1=fr2=1.0 (COMPRESS 처리 재현)
    set_in=True, E1=1.0, F=0.5, leg_nozzle=8.0,
)
print()
print(f"{'항목':12s} {'pvcalc(cm2)':>12s} {'COMPRESS':>10s}")
for 이름, 값, 기대 in [
    ("A required", r.results["A_required"], 2.4606),
    ("A available", r.results["A_available"], 9.2671),
]:
    v = 값 / 100.0  # mm² → cm²
    표시 = "OK" if abs(v - 기대) < 0.02 else "다름!"
    print(f"{이름:12s} {v:12.4f} {기대:10.4f}  {표시}")
print(f"여유율: pvcalc {r.results['margin_pct']:.1f}% · COMPRESS 376.6%−100 = 276.6%")

# UG-45 — 요약표 기대: t_req = t_min = 4.8 (NPS3 표준벽 5.49×0.875)
u = ug45_neck_thickness(P=P, Rn=77.93 / 2, Sn=S, CA=0.0, units="SI",
                        nps=3.0, t_nominal=5.49, is_pipe=True, tr_shell_e1=tr)
print()
t45 = u.results["t_UG45"]
print(f"UG-45 요구두께: pvcalc {t45:.2f} · COMPRESS 4.8  {'OK' if abs(t45 - 4.8) < 0.02 else '다름!'}")
print(f"가용두께(t_nom×0.875): {u.results['t_available']:.3f} ≥ {t45:.2f} → 통과")

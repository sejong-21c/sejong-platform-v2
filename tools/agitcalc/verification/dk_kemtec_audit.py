"""D&K켐텍 YDK-II 교반기 선정검토서 R5 (2025-01-06) 역산 감사.

목적: 협력업체(TOPJIN) 선정검토서 8개 케이스의 출력값을 입력값으로부터
재현할 수 있는지 확인하고, 재현되는 식 / 재현되지 않는 식을 분리한다.

실행:  python verification/dk_kemtec_audit.py

판정 기준
  OK    : 상대오차 0.1% 이내로 재현 → 식이 확정됨
  DIFF  : 재현 실패 → 식 미확정 (역산된 함의값을 표로 출력)
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 한국어 출력 (Windows 콘솔 기본 cp949 에서도 깨지지 않게)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

# ---------------------------------------------------------------------------
# 검토서 8개 케이스 (PDF에서 전사)
#   T   : Tank Dia. [m]          V   : Volume [m3]
#   rho : 비중 [kg/m3]           mu_cP: 점도 [cP]
#   rpm : RPM                    stages: IMPELLER 단수 (입력란 값)
#   imps: [(type, D[m]), ...] 하단→상단 순, D=0 은 제외
#   baffle: 검토서 비고란
# 출력 (검토서에 인쇄된 값)
#   QV, TP, Re, P_calc, P_corr, P_motor, load_pct, shaft_d, shaft_L, blend_min
# ---------------------------------------------------------------------------
CASES = [
    dict(item="FA-6101(50M3) RESOL A", T=4.5, V=50.0, rho=1300.0, mu_cP=15000.0,
         rpm=20.0, stages=1, imps=[("MAXBLEND", 3.0)], baffle="NON-BAFFLE",
         QV=2.268, TP=3.1416, Re=260.0, P_calc=13.7702, P_corr=15.1472,
         P_motor=18.5, load_pct=81.9, shaft_d=150, shaft_L=3700, blend_min=134.2),

    dict(item="FA-6102(50M3) 경화제1", T=4.5, V=50.0, rho=1300.0, mu_cP=2000.0,
         rpm=21.0, stages=1, imps=[("MAXBLEND", 2.95)], baffle="COIL없으면 BAFFLE효과",
         QV=2.26430348, TP=3.2437, Re=1979.81875, P_calc=11.7247, P_corr=12.8972,
         P_motor=15.0, load_pct=86.0, shaft_d=140, shaft_L=3700, blend_min=60.0),

    dict(item="FA-6104(3M3) 정포제", T=1.5, V=3.0, rho=1110.0, mu_cP=1000.0,
         rpm=80.0, stages=2, imps=[("4-P.P", 0.8), ("4-P.P", 0.8)], baffle="4-BAFFLES",
         QV=11.18208, TP=3.3510, Re=947.2, P_calc=2.3541, P_corr=2.5896,
         P_motor=3.7, load_pct=70.0, shaft_d=70, shaft_L=2000, blend_min=7.9),

    dict(item="FA-6201~6203(15M3) MIXING", T=2.35, V=12.5, rho=1100.0, mu_cP=15000.0,
         rpm=44.0, stages=1, imps=[("MAXBLEND", 1.8), ("2-P.P", 1.7)], baffle="IN-COIL",
         QV=12.9578944, TP=4.1469, Re=174.24, P_calc=20.1257, P_corr=24.1508,
         P_motor=30.0, load_pct=80.5, shaft_d=140, shaft_L=3000, blend_min=64.8),

    dict(item="FA-6205(2M3) 중화제", T=1.3, V=2.0, rho=1691.0, mu_cP=7000.0,
         rpm=62.0, stages=2, imps=[("MAXBLEND", 1.0), ("2-P.P", 0.8)], baffle="4-BAFFLES",
         QV=14.446, TP=3.2463, Re=249.6238095, P_calc=6.0511, P_corr=6.6562,
         P_motor=7.5, load_pct=88.7, shaft_d=90, shaft_L=1750, blend_min=45.6),

    dict(item="FA-6301(2M3) 중화제", T=1.3, V=2.0, rho=1691.0, mu_cP=8000.0,
         rpm=62.0, stages=2, imps=[("MAXBLEND", 1.0), ("2-P.P", 0.8)], baffle="4-BAFFLES",
         QV=14.446, TP=3.2463, Re=218.4208333, P_calc=6.0511, P_corr=6.6562,
         P_motor=7.5, load_pct=88.7, shaft_d=90, shaft_L=1750, blend_min=48.1),

    dict(item="FA-6206(3M3) 경화제", T=1.5, V=3.0, rho=1100.0, mu_cP=2000.0,
         rpm=82.0, stages=2, imps=[("4-P.P", 0.85), ("4-P.P", 0.85)], baffle="4-BAFFLES",
         QV=13.7478023, TP=3.6495, Re=543.0791667, P_calc=3.4019, P_corr=3.7421,
         P_motor=5.5, load_pct=68.0, shaft_d=80, shaft_L=2000, blend_min=8.4),

    dict(item="FA-6302(2M3) 난연제", T=1.3, V=2.0, rho=1300.0, mu_cP=8000.0,
         rpm=75.0, stages=2, imps=[("MAXBLEND", 1.05), ("2-P.P", 1.0)], baffle="NON-BAFFLE",
         QV=27.8662969, TP=4.1233, Re=223.9453125, P_calc=11.8658, P_corr=13.0523,
         P_motor=15.0, load_pct=87.0, shaft_d=100, shaft_L=1750, blend_min=21.4),
]

# 역산으로 확정된 토출유량수 Nq (8/8 케이스 정확 일치, 상대오차 <1e-8)
#   MAXBLEND : 2건에서 0.2100000  2-P.P : 3건에서 0.5000000
#   4-P.P    : 2건에서 0.4094999 (0.41 이 아니라 0.4095)
NQ_BACKSOLVED = {"MAXBLEND": 0.21, "2-P.P": 0.50, "4-P.P": 0.4095}

REL_TOL = 1e-3
results = {"ok": 0, "diff": 0}


def cmp(label, got, want, tol=REL_TOL, unit=""):
    if want == 0:
        ok = abs(got) < 1e-12
        err = 0.0
    else:
        err = abs(got - want) / abs(want)
        ok = err <= tol
    tag = "OK  " if ok else "DIFF"
    results["ok" if ok else "diff"] += 1
    print(f"    [{tag}] {label:<26} 계산 {got:>13.6g}  검토서 {want:>13.6g}"
          f"  오차 {err*100:>7.3f}%  {unit}")
    return ok


print("=" * 100)
print("D&K켐텍 YDK-II 교반기 선정검토서 R5 — 역산 감사")
print("=" * 100)

implied = []

for c in CASES:
    N = c["rpm"] / 60.0                      # rev/s
    mu = c["mu_cP"] / 1000.0                 # Pa*s
    D_low = c["imps"][0][1]                  # 하단 임펠러 직경
    print(f"\n■ {c['item']}   (T={c['T']}m  V={c['V']}m3  "
          f"rho={c['rho']}  mu={c['mu_cP']}cP  N={c['rpm']}rpm  {c['baffle']})")

    # --- 1) 레이놀즈수 : Re = rho*N*D^2/mu, D = 하단 임펠러 -------------------
    Re = c["rho"] * N * D_low ** 2 / mu
    cmp("Re = rho*N*D^2/mu", Re, c["Re"])

    # --- 2) 익단속도 : TP = pi*D*N ------------------------------------------
    TP = math.pi * D_low * N
    cmp("TP = pi*D*N", TP, c["TP"], unit="m/s")

    # --- 3) 토출유량수 : Q/V = SUM(Nq_i * rpm * D_i^3) / V -------------------
    Q = sum(NQ_BACKSOLVED[t] * c["rpm"] * d ** 3 for t, d in c["imps"])
    cmp("Q/V = S(Nq*rpm*D^3)/V", Q / c["V"], c["QV"], unit="回/min")

    # --- 4) 보정동력 : P_corr = P_calc * margin ------------------------------
    margin = c["P_corr"] / c["P_calc"]
    cmp("P_corr/P_calc (margin)", margin, 1.1, tol=2e-3)

    # --- 5) 부하율 : P_corr / P_motor ---------------------------------------
    cmp("부하율 = P_corr/P_motor", 100.0 * c["P_corr"] / c["P_motor"],
        c["load_pct"], tol=2e-3, unit="%")

    # --- 6) 계산동력에서 유효 동력수 Np 역산 ---------------------------------
    #     가정: P_calc = Np_eff * rho * N^3 * SUM(D_i^5)
    base = c["rho"] * N ** 3 * sum(d ** 5 for _, d in c["imps"])   # W (Np=1 기준)
    np_eff = c["P_calc"] * 1000.0 / base
    #     기계효율 0.85를 계산동력에 포함했다고 보면 실제 Np 는 * 0.85
    print(f"    [--  ] {'유효 Np 역산':<26} Np_eff = {np_eff:.5f}"
          f"   (eta=0.85 포함 가정 시 Np = {np_eff*0.85:.5f})")
    implied.append(dict(item=c["item"], Re=Re, np_eff=np_eff,
                        types="+".join(t for t, _ in c["imps"]),
                        dT=D_low / c["T"], baffle=c["baffle"],
                        margin=margin, blend=c["blend_min"], QV=c["QV"]))

# ---------------------------------------------------------------------------
print("\n" + "=" * 100)
print("역산된 유효 동력수 Np_eff 일람  —  Np_eff = P_calc / (rho*N^3*S D_i^5)")
print("=" * 100)
print(f"{'ITEM':<26}{'구성':<20}{'Re':>10}{'d/T':>7}{'Np_eff':>9}  {'비고':<24}{'margin':>7}")
print("-" * 100)
for r in sorted(implied, key=lambda x: x["Re"]):
    print(f"{r['item']:<26}{r['types']:<20}{r['Re']:>10.1f}{r['dT']:>7.3f}"
          f"{r['np_eff']:>9.4f}  {r['baffle']:<24}{r['margin']:>7.3f}")

print("""
[해석]
 - 4-P.P 단일형식 2단 (FA-6104 / FA-6206) : Re 947 -> 543 에서 Np_eff 가
   1.3648 / 1.3653 으로 사실상 동일. 4매 45도 피치패들의 문헌 난류 Np(1.27~1.37)
   범위에 정확히 들어오며 내부 정합성도 좋다.  → 이 형식은 신뢰 가능.

 - MAXBLEND 단일 (FA-6101 / FA-6102) : Re 260 -> 1980 에서 1.1769 -> 0.9417.
   Re 증가에 따라 Np 가 감소하는 물리적으로 옳은 방향. 값도 광폭 패들형
   문헌치 범위. → 신뢰 가능.

 - MAXBLEND + 2-P.P 조합 4건이 서로 모순된다.
     Re 174 (FA-6201) : Np_eff 1.4021
     Re 218/250 (FA-6301/6205) : Np_eff 2.4426
     Re 224 (FA-6302) : Np_eff 2.0531
   Re 가 가장 낮은 FA-6201 이 Np_eff 가 가장 작다. 동력수는 Re 가 낮을수록
   커져야 하므로 방향이 반대다. 또한 Re 218 과 250 (13% 차이)에서 계산동력이
   6.0511 kW 로 완전히 동일 → Np 를 Re 구간 룩업(계단식)으로 읽고 있음을 시사.
   조합형 임펠러의 동력 합산 규칙(간섭계수 포함)이 공개되지 않아 재현 불가.

 - 보정계수 margin : 7건은 1.10, FA-6201 만 1.20. 검토서에 근거 표기 없음.
   FA-6201 은 유일하게 IN-COIL 사양이므로 내부 코일 저항 가산으로 추정되나
   확인 필요.

 - 교반소요시간(추정) : 8건 모두 어떤 표준 상관식으로도 재현되지 않는다.
   FA-6102 의 '60.0 min' 은 계산값이라기보다 공정 요구시간을 그대로 적은 것으로
   보이며, t x (Q/V) 회전수가 88 ~ 840 회로 30배 흩어져 있어 일관된 근거가 없다.
   → 별도 상관식(난류 Ruszkowski / 층류 상관식)으로 재산정이 필요한 항목.

 - 축 지름 : 8건 모두 SJ 모델 표준 축경(70/80/90/100/140/150)에 맞춰져 있고,
   전달토크로부터 계산한 비틀림 응력은 4.6 ~ 10.9 MPa 로 흩어져 있다.
   즉 축은 강도 계산으로 정해진 것이 아니라 모델 표준값으로 정해졌다.
   위험속도(critical speed)/처짐/굽힘 검토 항목이 검토서에 아예 없다.
""")

# --- 축 응력 참고 계산 -------------------------------------------------------
print("=" * 100)
print("참고: 검토서 축경에 대한 비틀림 응력 (굽힘 미포함, 중실축 가정)")
print("=" * 100)
print(f"{'ITEM':<26}{'P_corr[kW]':>11}{'rpm':>6}{'d[mm]':>7}{'T[N.m]':>11}{'tau[MPa]':>10}")
print("-" * 100)
for c in CASES:
    omega = 2.0 * math.pi * c["rpm"] / 60.0
    torque = c["P_corr"] * 1000.0 / omega
    d = c["shaft_d"] / 1000.0
    tau = torque / (math.pi * d ** 3 / 16.0) / 1e6
    print(f"{c['item']:<26}{c['P_corr']:>11.4f}{c['rpm']:>6.0f}{c['shaft_d']:>7d}"
          f"{torque:>11.1f}{tau:>10.2f}")

print("\n" + "=" * 100)
print(f"확정된 식: {results['ok']} 항목 일치 / 미확정: {results['diff']} 항목 불일치")
print("=" * 100)

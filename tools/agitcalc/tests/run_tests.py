"""agitcalc 손계산 검증.  실행:  python tests/run_tests.py

기대값은 코드 수식에서 독립적으로 손계산한 값이다(구현이 자기 자신을
검증하지 않도록). 허용오차는 0.1%.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

import agitcalc as ac
from agitcalc import shaft as sh

FAIL = []


def close(actual, expected, rel=1e-3, label=""):
    ok = math.isclose(actual, expected, rel_tol=rel)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {actual:.7g}, "
          f"expected {expected:.7g}")
    if not ok:
        FAIL.append(label)


def check(cond, label):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")
    if not cond:
        FAIL.append(label)


print("== 무차원수 ==")
# 손계산: rho=1300, N=20/60=0.3333333, D=3, mu=15
#   Re = 1300*0.3333333*9/15 = 1300*3/15 = 260.0
close(ac.reynolds(1300, 20 / 60, 3.0, 15.0), 260.0, label="Re (D&K FA-6101)")
#   v_tip = pi*3*0.3333333 = 3.141593
close(ac.tip_speed(20 / 60, 3.0), 3.141593, label="tip speed")
#   Fr = N^2*D/g = 0.1111111*3/9.80665 = 0.3333333/9.80665 = 0.0339961
close(ac.froude(20 / 60, 3.0), 0.0339961, label="Froude")
check(ac.flow_regime(260.0) == "천이", "유동영역 판정 (Re=260 -> 천이)")
check(ac.flow_regime(5.0) == "층류", "유동영역 판정 (Re=5 -> 층류)")
check(ac.flow_regime(2e4) == "난류", "유동영역 판정 (Re=2e4 -> 난류)")

print("== 동력수 Np (2점근 모델) ==")
# MAXBLEND: Kp=120, Np_turb=1.20.  Re=260 -> Kp/Re = 0.461538 < 1.20
#   배플 有  -> Np = 1.20
Np, d = ac.power_number(260.0, "MAXBLEND", baffled=True)
close(Np, 1.20, label="MAXBLEND Np @Re=260 배플有")
check(d["governing"] == "난류 Np_turb", "지배항 판정")
#   무배플 혼합류 -> x0.70 = 0.84
Np, _ = ac.power_number(260.0, "MAXBLEND", baffled=False)
close(Np, 0.84, label="MAXBLEND Np @Re=260 무배플")
#   층류역: Re=50 -> Kp/Re = 120/50 = 2.40 > 1.20 -> 2.40
Np, d = ac.power_number(50.0, "MAXBLEND", baffled=True)
close(Np, 2.40, label="MAXBLEND Np @Re=50 (층류 지배)")
check(d["governing"] == "층류 Kp/Re", "층류 지배항 판정")
# PBT4: Np_turb=1.27, W_D 보정 (0.15/0.20)^1.25 = 0.75^1.25 = 0.6979
#   Np = 1.27*0.6979 = 0.886332
Np, _ = ac.power_number(947.2, "PBT4", W_D=0.15, baffled=True)
close(Np, 0.886332, label="PBT4 Np @Re=947 W/D=0.15 보정")
# 날개수 보정: PBT4 기준 4매 -> 6매,  (6/4)^0.8 = 1.5^0.8 = 1.383048
#   Np = 1.27*1.383048 = 1.756471
Np, _ = ac.power_number(947.2, "PBT4", n_blades=6, baffled=True)
close(Np, 1.756471, label="PBT4 Np 날개수 6매 보정")

print("== 동력 / 토출량 ==")
# P = Np*rho*N^3*D^5 = 0.84*1300*(1/27)*243 = 0.84*1300*9 = 9828 W
close(ac.impeller_power(1300, 20 / 60, 3.0, 0.84), 9828.0, label="P (D&K 형상)")
# Q = Nq*N*D^3, PBT4 문헌 Nq=0.79, N=80/60, D=0.8 -> 0.79*1.333333*0.512
#   = 0.5393067 m3/s
close(ac.pumping_capacity(80 / 60, 0.8, 0.79), 0.5393067, label="Q 문헌 Nq")
# TOPJIN 역산 Nq=0.4095 -> 0.4095*1.333333*0.512 = 0.2795520
close(ac.pumping_capacity(80 / 60, 0.8, 0.4095), 0.2795520,
      label="Q TOPJIN 역산 Nq")
check(ac.get_impeller("4-P.P", "TOPJIN").Nq == 0.4095,
      "벤더 별칭 4-P.P -> PBT4, TOPJIN Nq=0.4095")
check(ac.get_impeller("MAXBLEND", "TOPJIN").Nq == 0.21,
      "TOPJIN MAXBLEND Nq=0.21")

print("== 혼합시간 ==")
# N=1/3, D=3, T=4.5, H=3.1438, Np=0.84, Re=260, MAXBLEND
#   N*theta_turb = 5.9 * 0.84^(-1/3) * (4.5/3)^2 * (3.1438/4.5)^0.5
#     0.84^(-1/3) = 1.0598399,  1.5^2 = 2.25,  0.6986222^0.5 = 0.8358362
#   = 5.9*1.0598399*2.25*0.8358362 = 11.761288
#   theta_turb = 11.761288/0.3333333 = 35.283864 s
#   f_Re = (1e4/260)^0.5 = 6.2017367
#   theta = 35.283864*6.2017367 = 218.8078 s   (층류하한 45/0.33333=135 < 218.8)
th, bd = ac.blend_time(1 / 3, 3.0, 4.5, 3.1438, 0.84, 260.0, "MAXBLEND")
close(bd["theta_turbulent"], 35.283864, label="theta95 난류식")
close(bd["f_Re"], 6.2017367, label="천이역 보정계수")
close(th, 218.8078, label="theta95 최종 (천이역)")
# 난류역에서는 보정계수 1.0
th2, bd2 = ac.blend_time(2.0, 0.5, 1.5, 1.5, 1.27, 5e4, "PBT4")
close(bd2["f_Re"], 1.0, label="난류역 보정계수 = 1.0")

print("== 순환 / 단위동력 ==")
close(ac.turnover_time(50.0, 0.5), 100.0, label="순환시간 V/Q")
close(ac.specific_power(10000.0, 50.0), 200.0, label="P/V")

print("== 모터 선정 ==")
# 13721 W, max_load=0.90 -> 13.721/15 = 0.9147 > 0.9 ; 13.721/18.5 = 0.7417 OK
m, load = ac.select_motor(13721.0, 0.90)
close(m, 18.5, label="모터 정격 선정")
close(load, 74.17, rel=2e-3, label="부하율 %")

print("== 축 단면 / 허용응력 ==")
# d=150 중실: A = pi/4*150^2 = 17671.459
#   I = pi/64*150^4 = pi/64*506250000 = 24850489
#   Zp = pi/16*150^3 = pi/16*3375000 = 662680.0
A, I, Z, Zp = sh.section_props(150.0)
close(A, 17671.459, label="A (φ150)")
close(I, 24850489.0, label="I (φ150)")
close(Zp, 662680.0, label="Zp (φ150)")
# SUS304: min(0.30*205, 0.18*520) = min(61.5, 93.6) = 61.5, 키홈 x0.75 = 46.125
close(sh.allowable_shear("SUS304", keyway=True), 46.125,
      label="허용전단응력 SUS304 키홈")
close(sh.allowable_shear("SUS304", keyway=False), 61.5,
      label="허용전단응력 SUS304 키홈없음")

print("== 최소 축경 ==")
# P=18.5kW, 20rpm: omega = 2pi*20/60 = 2.0943951
#   T_rated = 18500/2.0943951 = 8833.627 N*m ; T_design = x1.5 = 13250.44
#   T_eq = 13250.44*sqrt(1.25)*1000 = 14818442 N*mm
#   d = (16*14818442/(pi*46.125))^(1/3) = (237095072/144.9004)^(1/3)
#     = (1636264)^(1/3) = 117.84 mm
close(sh.min_shaft_diameter(18.5, 20.0, "SUS304"), 117.84, rel=2e-3,
      label="최소 축경 (18.5kW, 20rpm, SUS304)")

print("== 위험속도 (캔틸레버 단일질량 검증) ==")
# 검증용: 축질량 무시가 안되므로 계산식 자체를 손계산으로 확인
#   φ100 x 2000mm, SUS304, 임펠러 1개 질량 100kg, a=L=2000
#   I = pi/64*1e8 = 4908739 mm4 ;  E = 193000 MPa
#   k = 3EI/L^3 = 3*193000*4908739/8e9 = 2842160000000...
#     = 3*193000 = 579000 ; x4908739 = 2.84216e12 ; /8e9 = 355.27 N/mm
#   A = pi/4*1e4 = 7853.98 ; m_shaft = 7853.98*2000*7930/1e9 = 124.57 kg
#   m_eq = 0.24*124.57 + 100*1 = 29.897+100 = 129.897 kg
#   N_c = (1/2pi)*sqrt(355.27*1000/129.897) = (1/6.283185)*sqrt(2735.4)
#       = 52.3009/6.283185 = 8.32077 Hz -> 499.25 rpm
res = sh.design_shaft(1.0, 10.0, 100.0, 2000.0,
                      [dict(D=0.4, a=2000.0, mass=100.0)],
                      material="SUS304", keyway=True)
close(res.results["m_shaft_kg"], 124.5697, label="축 질량")
close(res.results["m_eq_kg"], 129.8967, label="등가질량")
close(res.results["N_crit_rpm"], 499.25, rel=2e-3, label="1차 위험속도 rpm")

print("== Zwietering 임계현탁 ==")
# rho_L=1000, mu=0.001, rho_s=2500, dp=200um, X=10wt%, D=0.5, T=1.5, PBT4
#   S = 5.8*(1.5/0.5/3)^1.33 = 5.8*1 = 5.8
#   nu=1e-6 ; nu^0.1 = 0.2511886
#   (g*drho/rho)^0.45 = (9.80665*1500/1000)^0.45 = 14.709975^0.45 = 3.3531745
#   X^0.13 = 10^0.13 = 1.3489629
#   dp^0.2 = (2e-4)^0.2 = 0.1820879
#   D^0.85 = 0.5^0.85 = 0.5547850
#   N_js = 5.8*0.2511886*3.3531745*1.3489629*0.1820879/0.5547850 = 2.162139 rev/s
zr = ac.just_suspended_speed(1000.0, 0.001, 2500.0, 200e-6, 10.0, 0.5, 1.5,
                             "PBT4")
close(zr.results["S"], 5.8, label="S 계수 (T/D=3)")
close(zr.results["N_js_rps"], 2.162139, rel=2e-3, label="N_js rev/s")
close(zr.results["N_js_rpm"], 129.728, rel=2e-3, label="N_js rpm")

print("== 벤더 검토서 확정식 재현 ==")
# TOPJIN 8케이스 중 FA-6205: T=1.3 V=2 rho=1691 mu=7000cP 62rpm
#   MAXBLEND D=1.0 + 2-P.P D=0.8
#   Re = 1691*(62/60)*1.0/7 = 1691*1.0333333/7 = 1747.3667/7 = 249.62381
#   TP = pi*1.0*1.0333333 = 3.2463125
#   Q/V = (0.21*62*1.0 + 0.50*62*0.512)/2 = (13.02 + 15.872)/2 = 14.446
vs = ac.topjin_sheet(T=1.3, V=2.0, rho=1691.0, mu_cP=7000.0, rpm=62.0,
                     imps=[("MAXBLEND", 1.0), ("2-P.P", 0.8)], motor_kW=7.5)
close(vs.results["Re"], 249.62381, label="벤더식 Re")
close(vs.results["TP"], 3.2463125, label="벤더식 TIP SPEED")
close(vs.results["QV"], 14.446, label="벤더식 Q/V (역산 Nq)")

print("== 형상 산정 ==")
g = ac.recommend(T=4.5, V=50.0, mu_cP=15000.0)
check(g["impeller_type"] == "MAXBLEND", "15000cP -> MAXBLEND 선정")
check(g["baffled"] is False, "MAXBLEND -> 무배플")
close(g["H"], 3.143786, label="액위 H (V=50, T=4.5)")
close(g["C_T"], 0.04, label="광폭임펠러 바닥간극 C/T=0.04")
g2 = ac.recommend(T=2.0, V=6.0, mu_cP=500.0)
check(g2["impeller_type"] == "PBT4", "500cP -> PBT4 선정")
check(g2["baffled"] is True, "PBT4 -> 배플 4매")
close(g2["B_T"], 1 / 12, label="배플 폭비 B/T=1/12")

print("== 종합 선정 정합성 ==")
r = ac.design(V=50.0, rho=1300.0, mu_cP=15000.0, T=4.5)
check(r["summary"].ok, "D&K FA-6101 조건 전 항목 통과")
check(r["motor_kW"] in ac.IEC_MOTORS_KW, "모터가 IEC 표준용량")
check(r["load_pct"] <= 90.0, "부하율 90% 이하")
check(r["shaft"].results["N_over_Nc"] <= 0.70, "축 아임계 운전")
# 동력 정합성: P/V x V == P_liquid
close(r["PV"] * 50.0, r["P_liquid"], label="P/V x V = P_liquid")
# Q 정합성: 순환시간 x Q == V
close(r["turnover_s"] * r["Q_total"], 50.0, label="순환시간 x Q = V")

print()
print("=" * 70)
if FAIL:
    print(f"실패 {len(FAIL)} 건:")
    for f in FAIL:
        print(f"  - {f}")
    sys.exit(1)
print("전 항목 PASS")
print("=" * 70)

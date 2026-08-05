"""파이썬 엔진 결과를 JSON 벡터로 뽑는다 (JS 엔진 대조용).

실행:  python tests/gen_test_vectors.py
그 다음:  node web/test_core.mjs
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

import agitcalc as ac
from agitcalc import shaft as sh

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_vectors.json")

vec = {"scalar": [], "design": [], "geometry": [], "shaft": [], "vendor": []}


def S(fn, args, got):
    vec["scalar"].append(dict(fn=fn, args=args, got=got))


# --- 스칼라 함수 -------------------------------------------------------------
for rho, N, D, mu in [(1300, 20 / 60, 3.0, 15.0), (1100, 44 / 60, 1.8, 15.0),
                      (1000, 2.0, 0.5, 0.001), (1691, 62 / 60, 1.0, 7.0)]:
    S("reynolds", [rho, N, D, mu], ac.reynolds(rho, N, D, mu))
    S("froude", [N, D], ac.froude(N, D))
    S("tipSpeed", [N, D], ac.tip_speed(N, D))

for Re in [5.0, 50.0, 260.0, 947.2, 1979.8, 5e4]:
    for key in ["MAXBLEND", "PBT4", "RUSHTON", "HYDROFOIL", "PADDLE2",
                "ANCHOR", "RIBBON"]:
        for baf in [True, False]:
            Np, _ = ac.power_number(Re, key, baffled=baf)
            S("powerNumber", [Re, key, {"baffled": baf}], Np)
    Np, _ = ac.power_number(Re, "PBT4", W_D=0.15, baffled=True)
    S("powerNumber", [Re, "PBT4", {"W_D": 0.15, "baffled": True}], Np)
    Np, _ = ac.power_number(Re, "PBT4", n_blades=6, baffled=True)
    S("powerNumber", [Re, "PBT4", {"nBlades": 6, "baffled": True}], Np)

S("impellerPower", [1300, 20 / 60, 3.0, 0.84],
  ac.impeller_power(1300, 20 / 60, 3.0, 0.84))
S("pumpingCapacity", [80 / 60, 0.8, 0.79], ac.pumping_capacity(80 / 60, 0.8, 0.79))
S("pumpingCapacity", [80 / 60, 0.8, 0.4095], ac.pumping_capacity(80 / 60, 0.8, 0.4095))
for s in [0.4, 0.5, 0.75, 1.0, 1.5]:
    S("interferenceFactor", [s], ac.core.interference_factor(s))
S("liquidHeight", [4.5, 50.0], ac.liquid_height(4.5, 50.0))
S("volumeFromTH", [4.5, 3.1438], ac.volume_from_TH(4.5, 3.1438))
S("turnoverTime", [50.0, 0.5], ac.turnover_time(50.0, 0.5))
S("specificPower", [10000.0, 50.0], ac.specific_power(10000.0, 50.0))
for W in [1000.0, 13721.0, 25000.0, 300000.0]:
    m, l = ac.select_motor(W, 0.90)
    S("selectMotor.motor", [W, 0.90], m)
    S("selectMotor.load", [W, 0.90], l)
for th in [(1 / 3, 3.0, 4.5, 3.1438, 0.84, 260.0, "MAXBLEND"),
           (2.0, 0.5, 1.5, 1.5, 1.27, 5e4, "PBT4"),
           (0.5, 1.0, 2.0, 2.0, 1.2, 800.0, "MAXBLEND")]:
    t, d = ac.blend_time(*th)
    S("blendTime.theta", list(th), t)
    S("blendTime.thetaTurb", list(th), d["theta_turbulent"])
    S("blendTime.fRe", list(th), d["f_Re"])
for mat in ac.MATERIALS:
    S("allowableShear", [mat, True], sh.allowable_shear(mat, True))
    S("allowableShear", [mat, False], sh.allowable_shear(mat, False))
for d in [70.0, 100.0, 150.0]:
    A, I, Z, Zp = sh.section_props(d)
    S("sectionProps.A", [d], A)
    S("sectionProps.I", [d], I)
    S("sectionProps.Z", [d], Z)
    S("sectionProps.Zp", [d], Zp)
    A, I, Z, Zp = sh.section_props(d, d * 0.6)
    S("sectionProps.Zp.hollow", [d, d * 0.6], Zp)
for D in [0.5, 1.0, 3.0]:
    S("estimateImpellerMass", [D, "SUS304"], sh.estimate_impeller_mass(D, "SUS304"))
for p, n in [(18.5, 20.0), (3.7, 80.0), (30.0, 44.0)]:
    S("minShaftDiameter", [p, n, "SUS304"], sh.min_shaft_diameter(p, n, "SUS304"))
for r in [13.0, 22.0, 24.0, 63.0, 480.0]:
    S("snapRpm", [r], ac.select._snap_rpm(r))
for d in [63.0, 118.0, 141.0]:
    S("snapShaftDia", [d], ac.select._snap_shaft_dia(d))
zr = ac.just_suspended_speed(1000.0, 0.001, 2500.0, 200e-6, 10.0, 0.5, 1.5, "PBT4")
S("justSuspendedSpeed.Njs", [1000.0, 0.001, 2500.0, 200e-6, 10.0, 0.5, 1.5, "PBT4"],
  zr.results["N_js_rps"])
S("justSuspendedSpeed.S", [1000.0, 0.001, 2500.0, 200e-6, 10.0, 0.5, 1.5, "PBT4"],
  zr.results["S"])
for tau_y in [5.0, 50.0, 300.0]:
    cv = ac.process.cavern_diameter(1300.0, 20 / 60, 3.0, 4.5, 0.84, tau_y)
    S("cavernDiameter.Dc", [1300.0, 20 / 60, 3.0, 4.5, 0.84, tau_y],
      cv.results["Dc"])
    S("cavernDiameter.DcT", [1300.0, 20 / 60, 3.0, 4.5, 0.84, tau_y],
      cv.results["Dc_over_T"])
# Kamei-Hiraoka — 계열/배플/Re 를 두루 덮는다
for Re in [0.5, 10.0, 260.0, 1979.8, 5e4]:
    for fam, d, D, H, b, nb, th in [
            ("paddle", 1 / 3, 1.0, 1.0, 0.2 / 3, 6, 90.0),
            ("paddle", 0.5, 1.0, 1.0, 0.1, 2, 90.0),
            ("paddle", 0.6, 1.0, 1.2, 0.12, 4, 45.0),
            ("propeller", 0.35, 1.0, 1.0, 0.07, 3, 45.0),
            ("ribbon", 0.93, 1.0, 1.0, 0.09, 2, 90.0)]:
        for baf, Bw, nB in [(False, 0.0, 0), (True, 0.1, 4)]:
            Np, _ = ac.core.kamei_hiraoka_np(Re, d, D, H, b, nb, fam, th,
                                             baf, Bw, nB)
            S("kameiHiraokaNp", [Re, d, D, H, b, nb, fam, th, baf, Bw, nB], Np)

# --- 형상 산정 --------------------------------------------------------------
GEO_CASES = [
    dict(T=4.5, V=50.0, mu_cP=15000.0),
    dict(T=2.0, V=6.0, mu_cP=500.0),
    dict(T=1.3, V=2.0, mu_cP=8000.0),
    dict(T=1.5, V=3.0, mu_cP=1000.0),
    dict(T=3.0, V=25.0, mu_cP=50.0),
    dict(T=2.0, V=8.0, mu_cP=300000.0),
    dict(T=2.35, V=12.5, mu_cP=15000.0, impeller_type="MAXBLEND", dT=0.766),
    dict(T=1.5, V=3.0, mu_cP=1000.0, impeller_type="PBT4", dT=0.533, n_imp=2),
]
for c in GEO_CASES:
    g = ac.recommend(**c)
    vec["geometry"].append(dict(args=c, got={
        k: g[k] for k in ["H", "H_T", "impeller_type", "D", "D_T",
                          "n_impellers", "W", "W_D", "C", "C_T", "baffled",
                          "n_baffles", "B", "B_T", "B_wall_clearance"]
    } | {"elevations": g["elevations"],
         "spacing": g["spacing"],
         "tip_speed_range": list(g["tip_speed_range"])}))

# --- 축 검토 ----------------------------------------------------------------
SHAFT_CASES = [
    dict(P_motor_kW=18.5, rpm=20.0, d_shaft_mm=150.0, L_shaft_mm=3700.0,
         impellers=[dict(D=3.0, a=3700.0, mass=900.0)], material="SUS304",
         baffled=False),
    dict(P_motor_kW=3.7, rpm=80.0, d_shaft_mm=70.0, L_shaft_mm=2000.0,
         impellers=[dict(D=0.8, a=2000.0), dict(D=0.8, a=1300.0)],
         material="SUS304", baffled=True),
    dict(P_motor_kW=30.0, rpm=44.0, d_shaft_mm=140.0, L_shaft_mm=3000.0,
         impellers=[dict(D=1.8, a=3000.0), dict(D=1.7, a=1900.0)],
         material="SUS304", baffled=True),
    dict(P_motor_kW=1.0, rpm=10.0, d_shaft_mm=100.0, L_shaft_mm=2000.0,
         impellers=[dict(D=0.4, a=2000.0, mass=100.0)], material="SUS304",
         baffled=True),
]
for c in SHAFT_CASES:
    args = {k: v for k, v in c.items()}
    imps = [dict(i) for i in c["impellers"]]
    r = sh.design_shaft(c["P_motor_kW"], c["rpm"], c["d_shaft_mm"],
                        c["L_shaft_mm"], imps, material=c["material"],
                        baffled=c["baffled"])
    vec["shaft"].append(dict(args=args, got={
        k: r.results[k] for k in ["T_rated_Nm", "T_design_Nm", "tau_MPa",
                                  "sigma_b_MPa", "tau_max_MPa", "sigma_vm_MPa",
                                  "tau_allow_MPa", "SF_stress", "delta_tip_mm",
                                  "m_shaft_kg", "m_eq_kg", "N_crit_rpm",
                                  "N_over_Nc", "M_b_Nm", "F_hyd_total_N"]}))

# --- 종합 선정 --------------------------------------------------------------
DESIGN_CASES = [
    dict(V=50.0, rho=1300.0, mu_cP=15000.0, T=4.5),
    dict(V=50.0, rho=1300.0, mu_cP=2000.0, T=4.5),
    dict(V=3.0, rho=1110.0, mu_cP=1000.0, T=1.5),
    dict(V=12.5, rho=1100.0, mu_cP=15000.0, T=2.35),
    dict(V=2.0, rho=1691.0, mu_cP=7000.0, T=1.3),
    dict(V=2.0, rho=1300.0, mu_cP=8000.0, T=1.3),
    dict(V=10.0, rho=1000.0, mu_cP=50.0),
    dict(V=5.0, rho=1200.0, mu_cP=100000.0),
    dict(V=50.0, rho=1300.0, mu_cP=15000.0, T=4.5,
         impeller_type="MAXBLEND", dT=3.0 / 4.5, basis="rpm", rpm=20),
    dict(V=20.0, rho=1050.0, mu_cP=800.0, level="vigorous"),
    dict(V=8.0, rho=1000.0, mu_cP=200.0, basis="blend", target_blend_min=3.0),
]
for c in DESIGN_CASES:
    r = ac.design(**c)
    vec["design"].append(dict(args=c, got=dict(
        T=r["T"], H=r["H"], rpm=r["rpm"], rpm_calc=r["rpm_calc"],
        Re=r["Re"], Fr=r["Fr"], v_tip=r["v_tip"], Np=r["Np"],
        P_liquid=r["P_liquid"], PV=r["PV"], motor_kW=r["motor_kW"],
        load_pct=r["load_pct"], Q_total=r["Q_total"],
        theta95_s=r["theta95_s"], turnover_s=r["turnover_s"],
        shaft_dia_mm=r["shaft_dia_mm"], shaft_len_mm=r["shaft_len_mm"],
        impeller_type=r["impeller"].key, D=r["geometry"]["D"],
        D_T=r["geometry"]["D_T"], n_impellers=r["geometry"]["n_impellers"],
        N_crit_rpm=r["shaft"].results["N_crit_rpm"],
        ok=r["summary"].ok)))

# --- 벤더 검토서 재현 -------------------------------------------------------
VENDOR_CASES = [
    # FA-6101 은 NON-BAFFLE — 배플 유무가 동력수에 직접 영향하므로 두 경우 모두 검증
    dict(T=4.5, V=50.0, rho=1300.0, mu_cP=15000.0, rpm=20.0,
         imps=[["MAXBLEND", 3.0]], motor_kW=18.5, baffled=False),
    dict(T=4.5, V=50.0, rho=1300.0, mu_cP=15000.0, rpm=20.0,
         imps=[["MAXBLEND", 3.0]], motor_kW=18.5, baffled=True),
    dict(T=1.3, V=2.0, rho=1691.0, mu_cP=7000.0, rpm=62.0,
         imps=[["MAXBLEND", 1.0], ["2-P.P", 0.8]], motor_kW=7.5),
    dict(T=1.5, V=3.0, rho=1110.0, mu_cP=1000.0, rpm=80.0,
         imps=[["4-P.P", 0.8], ["4-P.P", 0.8]], motor_kW=3.7),
    dict(T=2.35, V=12.5, rho=1100.0, mu_cP=15000.0, rpm=44.0,
         imps=[["MAXBLEND", 1.8], ["2-P.P", 1.7]], motor_kW=30.0,
         has_coil=True),
]
for c in VENDOR_CASES:
    kw = dict(c)
    kw["imps"] = [tuple(x) for x in c["imps"]]
    r = ac.topjin_sheet(**kw)
    vec["vendor"].append(dict(args=c, got={
        k: r.results[k] for k in ["Re", "TP", "QV", "Q", "P_calc_kW",
                                  "P_corr_kW", "motor_kW", "load_pct",
                                  "margin"]}))

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(vec, f, ensure_ascii=False, indent=1)

n = (len(vec["scalar"]) + len(vec["geometry"]) + len(vec["shaft"])
     + len(vec["design"]) + len(vec["vendor"]))
print(f"{OUT} 생성 완료")
print(f"  스칼라 {len(vec['scalar'])} / 형상 {len(vec['geometry'])} / "
      f"축 {len(vec['shaft'])} / 선정 {len(vec['design'])} / "
      f"벤더 {len(vec['vendor'])}  = 총 {n} 벡터")
print("다음:  node web/test_core.mjs")

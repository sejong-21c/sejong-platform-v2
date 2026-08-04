"""교반축 설계 — 비틀림·굽힘 조합응력, 처짐, 위험속도.

D&K켐텍 검토서에는 이 항목이 전부 빠져 있다(축경이 모델 표준값으로만 정해짐).
교반기 고장의 대부분은 동력 부족이 아니라 축 파단·씰 누설·공진이므로
반드시 검토해야 한다.

특히 검토서 사양은 MOTOR = V.V.V.F (인버터 가변속)이다. 가변속은 운전
회전수 전 구간이 위험속도 회피대역 밖에 있어야 하므로 단일 정격점만
확인하는 것으로는 불충분하다.

근거
  [B106] ASME B106.1M — Design of Transmission Shafting (허용전단응력)
  [HIM]  Handbook of Industrial Mixing, Ch.21 Mechanical Design of Mixers
  [EKA]  Ekato, "Handbook of Mixing Technology" — 수력 불균형력 관행값
"""

import math

from .report import CalcResult

# 재질 물성 (상온) — Sy 항복강도, Su 인장강도 [MPa], E 탄성계수 [MPa]
MATERIALS = {
    "SS400":   dict(Sy=245.0, Su=400.0, E=200000.0, rho=7850.0, name="일반구조용강"),
    "SM45C":   dict(Sy=343.0, Su=569.0, E=205000.0, rho=7850.0, name="기계구조용탄소강"),
    "SUS304":  dict(Sy=205.0, Su=520.0, E=193000.0, rho=7930.0, name="스테인리스 304"),
    "SUS316L": dict(Sy=175.0, Su=480.0, E=193000.0, rho=7980.0, name="스테인리스 316L"),
    "SUS329J": dict(Sy=450.0, Su=620.0, E=200000.0, rho=7800.0, name="2상 스테인리스"),
}

# 수력 불균형 계수 f_imb — 전 날개 접선력 중 편측으로 작용하는 비율
#   배플 有·3매 이상 : 0.25    무배플 또는 2매 : 0.50
# [EKA] 및 교반기 제작 관행. 실측 캘리브레이션 권장.
F_IMB_BAFFLED = 0.25
F_IMB_UNBAFFLED = 0.50


def allowable_shear(material, keyway=True, weld=False):
    """허용전단응력 [MPa].  [B106]  tau_allow = min(0.30*Sy, 0.18*Su)
    키홈·용접부가 있으면 25% 감한다."""
    m = MATERIALS[material]
    tau = min(0.30 * m["Sy"], 0.18 * m["Su"])
    if keyway or weld:
        tau *= 0.75
    return tau


def section_props(d_o_mm, d_i_mm=0.0):
    """중실/중공 원형단면 특성.  반환 (A[mm2], I[mm4], Z[mm3], J/c=[mm3])"""
    do, di = float(d_o_mm), float(d_i_mm)
    A = math.pi / 4.0 * (do ** 2 - di ** 2)
    I = math.pi / 64.0 * (do ** 4 - di ** 4)
    Z = I / (do / 2.0)                       # 굽힘 단면계수
    Zp = math.pi / 16.0 * (do ** 4 - di ** 4) / do   # 비틀림 단면계수
    return A, I, Z, Zp


def design_shaft(P_motor_kW, rpm, d_shaft_mm, L_shaft_mm, impellers,
                 material="SUS304", d_inner_mm=0.0, service_factor=1.5,
                 baffled=True, keyway=True, rpm_min=None,
                 seal_position_mm=None, deflection_limit_seal_mm=0.15):
    """교반축 종합 검토.

    P_motor_kW : 선정된 모터 정격동력 [kW]  (계산동력이 아니라 정격을 쓴다.
                 인버터/기동 시 정격토크가 그대로 축에 걸릴 수 있음)
    rpm        : 정격 회전수 [rpm]
    d_shaft_mm : 축 외경 [mm]
    L_shaft_mm : 하부 베어링(또는 씰 하단)에서 최하단 임펠러까지 길이 [mm]
    impellers  : [{"D":임펠러경 m, "a":베어링에서 거리 mm,
                   "mass":질량 kg (옵션, 미입력시 추정)}, ...]
    service_factor : 축 설계 토크 배수 (기동·교반물 편심 부하)
    rpm_min    : 인버터 최저 운전 회전수 [rpm] (가변속이면 지정)
    seal_position_mm : 메카니컬씰 위치(베어링에서 거리). 씰부 처짐 검토용

    반환 CalcResult
    """
    m = MATERIALS[material]
    r = CalcResult(f"교반축 강도·진동 검토 ({material}, φ{d_shaft_mm:.0f}"
                   f"{' 중공' if d_inner_mm else ''} x {L_shaft_mm:.0f}L)",
                   "ASME B106.1M / HIM Ch.21")

    r.add_input("P_motor (모터 정격)", P_motor_kW, "kW")
    r.add_input("N (정격 회전수)", rpm, "rpm")
    r.add_input("d_o (축 외경)", d_shaft_mm, "mm")
    if d_inner_mm:
        r.add_input("d_i (축 내경)", d_inner_mm, "mm")
    r.add_input("L (베어링~최하단 임펠러)", L_shaft_mm, "mm")
    r.add_input("재질", material, "", f"{m['name']}  Sy={m['Sy']} Su={m['Su']} MPa")
    r.add_input("서비스팩터", service_factor, "-")
    r.add_input("배플", "설치" if baffled else "없음")

    A, I, Z, Zp = section_props(d_shaft_mm, d_inner_mm)
    r.add_step("단면적 A", "pi/4*(do^2-di^2)", A, "mm2")
    r.add_step("단면2차모멘트 I", "pi/64*(do^4-di^4)", I, "mm4")
    r.add_step("비틀림 단면계수 Zp", "pi/16*(do^4-di^4)/do", Zp, "mm3")

    # ---- 1) 비틀림 -------------------------------------------------------
    omega = 2.0 * math.pi * rpm / 60.0
    T_rated = P_motor_kW * 1000.0 / omega            # N*m
    T_design = T_rated * service_factor
    tau = T_design * 1000.0 / Zp                     # N*mm / mm3 = MPa
    r.add_step("정격토크 T_rated", "P/omega", T_rated, "N*m")
    r.add_step("설계토크 T_design", "T_rated x SF", T_design, "N*m")
    r.add_step("비틀림응력 tau", "T/Zp", tau, "MPa")

    # ---- 2) 수력 불균형력 → 굽힘 ------------------------------------------
    f_imb = F_IMB_BAFFLED if baffled else F_IMB_UNBAFFLED
    r.add_step("수력 불균형계수 f_imb", "", f_imb)

    # 토크를 임펠러별 D^5 비율로 배분 (동력 분담과 동일 가정)
    w = [im["D"] ** 5 for im in impellers]
    w_sum = sum(w) or 1.0

    M_b = 0.0
    F_total = 0.0
    for im, wi in zip(impellers, w):
        T_i = T_design * wi / w_sum                 # 해당 임펠러 분담토크 N*m
        R75 = 0.75 * im["D"] / 2.0                  # 유효 작용반경 [m]
        F_tan = T_i / R75                           # 전 날개 접선력 [N]
        F_h = f_imb * F_tan                         # 편측 불균형력 [N]
        M_b += F_h * im["a"] / 1000.0               # N*m
        F_total += F_h
        im["_F_hyd"] = F_h
        im["_T_i"] = T_i
        r.add_step(f"  임펠러 D={im['D']}m  a={im['a']}mm : F_hyd",
                   f"f_imb*T_i/(0.75*D/2), T_i={T_i:.1f}N*m", F_h, "N")

    r.add_step("굽힘모멘트 M_b", "S F_hyd*a", M_b, "N*m")

    sigma_b = M_b * 1000.0 / Z
    r.add_step("굽힘응력 sigma_b", "M_b/Z", sigma_b, "MPa")

    # ---- 3) 조합응력 -----------------------------------------------------
    tau_max = math.sqrt(M_b ** 2 + T_design ** 2) * 1000.0 / Zp
    sigma_vm = math.sqrt(sigma_b ** 2 + 3.0 * tau ** 2)
    tau_allow = allowable_shear(material, keyway)
    r.add_step("조합 최대전단응력 tau_max",
               "sqrt(Mb^2+T^2)/Zp  (최대전단응력설)", tau_max, "MPa")
    r.add_step("등가응력 sigma_vm", "sqrt(sb^2+3*tau^2)  (von Mises)",
               sigma_vm, "MPa")
    r.add_step("허용전단응력 tau_allow",
               f"min(0.30Sy,0.18Su){' x0.75(키홈)' if keyway else ''}",
               tau_allow, "MPa")
    r.add_check(f"조합응력 tau_max={tau_max:.1f} <= tau_allow={tau_allow:.1f} MPa",
                tau_max <= tau_allow,
                f"안전율 {tau_allow/tau_max:.2f}" if tau_max > 0 else "")

    # ---- 4) 처짐 ---------------------------------------------------------
    # 캔틸레버(베어링 고정) 집중하중: delta(x=L) = S F*a^2*(3L-a)/(6EI)
    L = float(L_shaft_mm)
    delta_tip = sum(im["_F_hyd"] * im["a"] ** 2 * (3.0 * L - im["a"])
                    / (6.0 * m["E"] * I) for im in impellers)
    r.add_step("최하단 처짐 delta_tip",
               "S F*a^2*(3L-a)/(6EI)", delta_tip, "mm")

    if seal_position_mm:
        xs = float(seal_position_mm)
        # x < a 구간: delta(x) = F*x^2*(3a-x)/(6EI)
        delta_seal = sum(
            im["_F_hyd"] * (xs ** 2 * (3.0 * im["a"] - xs) if xs <= im["a"]
                            else im["a"] ** 2 * (3.0 * xs - im["a"]))
            / (6.0 * m["E"] * I) for im in impellers)
        r.add_step("씰 위치 처짐 delta_seal", "", delta_seal, "mm")
        r.add_check(f"씰부 처짐 {delta_seal:.3f} <= {deflection_limit_seal_mm} mm",
                    delta_seal <= deflection_limit_seal_mm,
                    "메카니컬씰 면압 유지 조건")
        r.results["delta_seal_mm"] = delta_seal

    # ---- 5) 위험속도 (1차 횡진동) -----------------------------------------
    # 캔틸레버 + 집중질량. 모드형상 가중 (a/L)^3 로 등가질량 환산.
    m_shaft = A * L * m["rho"] / 1e9                 # kg
    m_eq = 0.24 * m_shaft
    for im in impellers:
        mi = im.get("mass")
        if mi is None:
            mi = estimate_impeller_mass(im["D"], material)
            im["_mass_est"] = mi
        m_eq += mi * (im["a"] / L) ** 3
    k_eff = 3.0 * m["E"] * I / L ** 3                # N/mm
    N_c_hz = (1.0 / (2.0 * math.pi)) * math.sqrt(k_eff * 1000.0 / m_eq)
    N_c_rpm = N_c_hz * 60.0

    r.add_step("축 질량 m_shaft", "A*L*rho", m_shaft, "kg")
    r.add_step("등가질량 m_eq", "0.24*m_shaft + S m_i*(a/L)^3", m_eq, "kg")
    r.add_step("횡강성 k_eff", "3EI/L^3", k_eff, "N/mm")
    r.add_step("1차 위험속도 N_c", "(1/2pi)*sqrt(k/m)", N_c_rpm, "rpm")

    ratio = rpm / N_c_rpm
    r.add_step("N/N_c (정격)", "", ratio)
    r.add_check(f"정격 N/N_c = {ratio:.3f} <= 0.70 (아임계 운전)", ratio <= 0.70,
                "0.7~1.3 구간은 공진대역")

    if rpm_min is not None:
        # 인버터 가변속: 전 구간이 회피대역 밖이어야 함
        band_lo, band_hi = 0.70 * N_c_rpm, 1.30 * N_c_rpm
        clash = not (rpm <= band_lo or rpm_min >= band_hi)
        r.add_step("공진 회피대역", "0.7~1.3 x N_c",
                   f"{band_lo:.1f} ~ {band_hi:.1f}", "rpm")
        r.add_check(f"인버터 운전범위 {rpm_min}~{rpm} rpm 이 회피대역 밖",
                    not clash,
                    "V.V.V.F 는 전 운전구간 검토 필요")
        r.results["resonance_band_rpm"] = (band_lo, band_hi)

    r.results.update(T_rated_Nm=T_rated, T_design_Nm=T_design,
                     tau_MPa=tau, sigma_b_MPa=sigma_b,
                     tau_max_MPa=tau_max, sigma_vm_MPa=sigma_vm,
                     tau_allow_MPa=tau_allow,
                     SF_stress=(tau_allow / tau_max) if tau_max else float("inf"),
                     delta_tip_mm=delta_tip, m_shaft_kg=m_shaft,
                     m_eq_kg=m_eq, N_crit_rpm=N_c_rpm, N_over_Nc=ratio,
                     F_hyd_total_N=F_total, M_b_Nm=M_b)
    return r


def estimate_impeller_mass(D_m, material="SUS304"):
    """임펠러 질량 개략 추정 [kg].

    광폭/터빈형 임펠러의 실적 데이터에 맞춘 경험식으로, 정식 중량은
    제작도면 기준으로 대체해야 한다. 위험속도 1차 스크리닝 용도.
        m ~ 55 * D^2.6   (SUS304, D in m)
    """
    rho_ratio = MATERIALS[material]["rho"] / MATERIALS["SUS304"]["rho"]
    return 55.0 * D_m ** 2.6 * rho_ratio


def min_shaft_diameter(P_motor_kW, rpm, material="SUS304",
                       service_factor=1.5, keyway=True, bending_ratio=0.5):
    """비틀림+굽힘 조합응력만으로 필요한 최소 축경 [mm] (1차 산정).

    bending_ratio = M_b/T 가정값. 실제 M_b 는 임펠러 배치에 따라 변하므로
    design_shaft() 로 재검증해야 한다.
    """
    omega = 2.0 * math.pi * rpm / 60.0
    T_design = P_motor_kW * 1000.0 / omega * service_factor      # N*m
    tau_allow = allowable_shear(material, keyway)                 # MPa
    T_eq = T_design * math.sqrt(1.0 + bending_ratio ** 2) * 1000.0  # N*mm
    d = (16.0 * T_eq / (math.pi * tau_allow)) ** (1.0 / 3.0)
    return d

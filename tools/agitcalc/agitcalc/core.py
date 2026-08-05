"""교반 기본 계산 — 무차원수, 동력, 토출량, 혼합시간.

단위계는 SI 로 통일한다.
    D, T, H [m]   N [rev/s]   rho [kg/m3]   mu [Pa*s]   P [W]   V [m3]
RPM 과 cP 는 입력 편의를 위해 변환 헬퍼를 둔다.
"""

import math

from .report import CalcResult
from . import impellers as imp_db

G = 9.80665     # 표준중력 [m/s2]


# ---------------------------------------------------------------------------
# 단위 변환
# ---------------------------------------------------------------------------
def rpm_to_rps(rpm):
    return rpm / 60.0


def rps_to_rpm(rps):
    return rps * 60.0


def cP_to_Pas(cP):
    return cP / 1000.0


def volume_from_TH(T, H):
    """직립 원통 액위체적 [m3] (경판 체적 제외)."""
    return math.pi * T ** 2 / 4.0 * H


def liquid_height(T, V):
    """탱크 직경과 액체 체적으로부터 액위 [m] (직관부 기준)."""
    return V / (math.pi * T ** 2 / 4.0)


# ---------------------------------------------------------------------------
# 무차원수
# ---------------------------------------------------------------------------
def reynolds(rho, N, D, mu):
    """임펠러 레이놀즈수 Re = rho*N*D^2/mu.  N [rev/s]"""
    return rho * N * D ** 2 / mu


def froude(N, D):
    """프루드수 Fr = N^2*D/g.  자유표면 볼텍스 판정용."""
    return N ** 2 * D / G


def tip_speed(N, D):
    """익단속도 v_tip = pi*D*N [m/s]"""
    return math.pi * D * N


def flow_regime(Re):
    if Re < 10:
        return "층류"
    if Re < 1e4:
        return "천이"
    return "난류"


# ---------------------------------------------------------------------------
# 동력수 Np
# ---------------------------------------------------------------------------
def power_number(Re, impeller, W_D=None, n_blades=None, baffled=True,
                 dataset="LIT"):
    """2점근 모델 Np(Re) = max(Kp/Re, Np_turb) + 형상보정.

    형상보정
      날개폭   : Np *= ((W/D)/(W/D)_std)^1.25          [PER Sec.18 관행]
      날개수   : Np *= (n/n_std)^0.8                    [BAT]
      무배플   : 난류역에서 선회류로 Np 저하 → 계수 0.7 적용(보수적 근사)
                 층류역(Re<10)에서는 배플 영향 없음

    ⚠ 정밀도 한계 (반드시 인지할 것)
      이 2점근 모델(Nagata 계열)은 층류·난류 양 극단에서는 잘 맞지만
      **천이역에서 문헌 대비 10~30% 편차**가 보고되어 있다(다단 피치블레이드는
      최대 50~80%). J-JSCEJ doi:10.1252/jcej.11we115 의 실측 비교 결과다.
      D&K켐텍 검토서 8건이 모두 Re 174~1980 의 천이역이므로 이 오차대에 있다.

      더 정확한 대안은 **Kamei-Hiraoka 상관식**이며, 패들·러시톤·피치패들·
      프로펠러·앵커·헬리컬리본을 층류~난류 전역에서 (무배플/부분배플/완전배플
      구분까지) 다룬다. 출처는 아래 논문이고 **CC-BY 라서 상업적 사용에
      제약이 없다**:
        Furukawa et al., Int. J. Chem. Eng. 2012, 106496
        doi:10.1155/2012/106496
      TODO(agitcalc v0.2): Kamei-Hiraoka 를 구현해 기본 모델로 전환하고,
      본 2점근 모델은 대조용으로 남긴다.

    반환: (Np, 상세 dict)
    """
    im = imp_db.get(impeller, dataset) if isinstance(impeller, str) else impeller

    np_lam = im.Kp / Re if Re > 0 else float("inf")
    np_turb = im.Np_turb
    np_base = max(np_lam, np_turb)
    governing = "층류 Kp/Re" if np_lam >= np_turb else "난류 Np_turb"

    f_w = 1.0
    if W_D is not None and im.W_D:
        f_w = (W_D / im.W_D) ** 1.25
    f_n = 1.0
    if n_blades is not None and im.n_blades:
        f_n = (n_blades / im.n_blades) ** 0.8
    f_b = 1.0
    if not baffled and Re >= 10.0 and im.flow in (imp_db.RADIAL, imp_db.MIXED):
        f_b = 0.70

    Np = np_base * f_w * f_n * f_b
    return Np, dict(Np_laminar=np_lam, Np_turb=np_turb, governing=governing,
                    f_width=f_w, f_blades=f_n, f_baffle=f_b, Kp=im.Kp)


# --- Kamei-Hiraoka 동력 상관식 ------------------------------------------------
# 나고야공업대 平岡節郎(Hiraoka)·亀井(Kamei) 계열 상관식. 마찰계수 f 와 수정
# 레이놀즈수 ReG 로 정리해 **층류~난류 전역을 하나의 식**으로 덮는다.
# 2점근 모델과 달리 d/D, b/d, 날개수, 날개각, 배플 치수가 모두 식에 들어간다.
#
# 출처: Furukawa, Kato, Inoue, Kato, Tada & Hashimoto,
#       "Correlation of Power Consumption for Several Kinds of Mixing Impellers",
#       Int. J. Chem. Eng. 2012, 106496.  doi:10.1155/2012/106496
#       CC-BY (상업적 사용 제약 없음). Table 1~4 의 식을 그대로 옮긴 것.
#
# 임펠러 계열별 Ct, m 계수만 다르고 골격은 같다.
#   paddle    : 패들·러시톤·피치패들·앵커·광폭패들   (Table 1, 2)
#   propeller : 프로펠러·Pfaudler·하이드로포일        (Table 3)
#   ribbon    : 헬리컬 리본 — 형상 의존성 없이 고정값 (Table 4)
KH_FAMILY = {
    "PADDLE2": "paddle", "PBT4": "paddle", "PBT6": "paddle", "FBT6": "paddle",
    "RUSHTON": "paddle", "ANCHOR": "paddle", "MAXBLEND": "paddle",
    "PROP": "propeller", "HYDROFOIL": "propeller", "HYDROFOIL_HS": "propeller",
    "RIBBON": "ribbon",
}
# Kamei 식에 넣을 등가 날개폭 b/D. 형상이 단순 패들이 아닌 형식만 지정한다.
#
# MAXBLEND(광폭 대형패들)는 하부 광폭패들 + 상부 격자의 복합 구조라 실제
# 날개폭이 하나로 정의되지 않는다. D&K 검토서 2건으로 b 를 스캔해 두 건의
# 최대오차가 가장 작아지는 값을 골랐다.
#   b=0.15D : FA-6101 1.5% / FA-6102 27.8%  (최대 27.8%)
#   b=0.18D : FA-6101 16.8% / FA-6102 18.4% (최대 18.4%)  <- 채택
#   b=0.22D : FA-6101 41.2% / FA-6102  5.7% (최대 41.2%)
# ponytail: 2점 피팅이라 신뢰구간이 좁지 않다. 제조사 실측 Np-Re 곡선을
#           받으면 MAXBLEND 전용 상관식으로 교체할 것.
KH_B_OVER_D = {"MAXBLEND": 0.18}

# 날개각 theta [deg] — 축류 성분이 있는 형식은 45도, 수직 패들은 90도
KH_THETA = {"PBT4": 45.0, "PBT6": 45.0, "PROP": 45.0,
            "HYDROFOIL": 45.0, "HYDROFOIL_HS": 45.0}


def kamei_hiraoka_np(Re_d, d, D, H, b, n_blades, family="paddle",
                     theta_deg=90.0, baffled=False, B_w=0.0, n_baffles=0):
    """Kamei-Hiraoka 동력수 Np [-].  층류~난류 전역.

      Re_d = n*d^2*rho/mu      d 임펠러경 / D 탱크경 / H 액위 / b 날개폭 [m]
      family : "paddle" | "propeller" | "ribbon"
      baffled 이면 B_w(배플 폭), n_baffles 로 부분~완전배플까지 보간한다.

    반환 (Np, 상세 dict)
    """
    th = math.radians(theta_deg)
    sin_th = math.sin(th)

    if family == "ribbon":
        # Table 4 — 리본은 형상 파라미터 없이 실측 피팅 고정값
        ReG = 0.0388 * Re_d
        CL, Ct, m, Ctr, f_inf = 1.00, 0.100, 0.333, 2500.0, 0.00683
        pref = 16.0
        beta = eta = gamma = X = float("nan")
    else:
        beta = 2.0 * math.log(D / d) / ((D / d) - (d / D))
        eta = (0.711 * (0.157 + (n_blades * math.log(D / d)) ** 0.611)
               / (n_blades ** 0.52 * (1.0 - (d / D) ** 2)))
        gamma = (eta * math.log(D / d) / (beta * D / d) ** 5) ** (1.0 / 3.0)
        X = gamma * n_blades ** 0.7 * b * sin_th ** 1.6 / H

        ReG = (math.pi * eta * math.log(D / d)) / (4.0 * d / (beta * D)) * Re_d
        CL = (0.215 * eta * n_blades * (d / H) * (1.0 - (d / D) ** 2)
              + 1.83 * (b * sin_th / H) * (n_blades / (2.0 * sin_th)) ** (1.0 / 3.0))
        if family == "propeller":                       # Table 3
            Ct = ((3.0 * X ** 1.5) ** -7.8 + 0.25 ** -7.8) ** (-1.0 / 7.8)
            m = ((0.8 * X ** 0.373) ** -7.8 + 0.333 ** -7.8) ** (-1.0 / 7.8)
        else:                                           # Table 1, 2
            Ct = ((1.96 * X ** 1.19) ** -7.8 + 0.25 ** -7.8) ** (-1.0 / 7.8)
            m = ((0.71 * X ** 0.373) ** -7.8 + 0.333 ** -7.8) ** (-1.0 / 7.8)
        Ctr = 23.8 * (d / D) ** -3.24 * (b * sin_th / D) ** -1.18 * X ** -0.74
        f_inf = 0.0151 * (d / D) * Ct ** 0.308
        pref = 1.2 * math.pi ** 4 * beta ** 2 / (8.0 * d ** 3 / (D ** 2 * H))

    f = CL / ReG + Ct * ((Ctr / ReG + ReG) ** -1 + (f_inf / Ct) ** (1.0 / m)) ** m
    Np0 = pref * f                                       # 무배플 동력수

    if not baffled or n_baffles <= 0 or B_w <= 0 or family == "ribbon":
        return Np0, dict(f=f, ReG=ReG, CL=CL, Ct=Ct, m=m, Ctr=Ctr,
                         f_inf=f_inf, Np0=Np0, Np_max=None, beta=beta,
                         eta=eta, gamma=gamma, X=X, baffled=False)

    # 배플 조건 — 완전배플 Npmax 에서 무배플 Np0 로 x 를 통해 보간
    Z = n_blades ** 0.7 * b * sin_th ** 1.6 / d
    ang = (2.0 * theta_deg / 180.0)                      # (2*theta/pi), theta [rad] 기준
    if family == "propeller":
        Np_max = 6.5 * Z ** 1.7
    else:
        # 0.54 에서 두 분기가 연속(10*0.54^1.3 = 4.488, 8.3*0.54 = 4.482)
        Np_max = ang ** 0.9 * (10.0 * Z ** 1.3 if Z <= 0.54 else 8.3 * Z)
    x = (4.5 * (B_w / D) * n_baffles ** 0.8
         / (ang ** 0.72 * Np_max ** 0.2) + Np0 / Np_max)
    Np = (1.0 + x ** -3) ** (-1.0 / 3.0) * Np_max
    # 배플식은 난류 전제라 층류역에서 Np0 보다 작아지는 구간이 생긴다.
    # 층류에서는 배플이 동력을 낮추지 않으므로 무배플 값을 하한으로 둔다.
    Np = max(Np, Np0)
    return Np, dict(f=f, ReG=ReG, CL=CL, Ct=Ct, m=m, Ctr=Ctr, f_inf=f_inf,
                    Np0=Np0, Np_max=Np_max, x=x, Z=Z, beta=beta, eta=eta,
                    gamma=gamma, X=X, baffled=True)


def apparent_viscosity_MO(K, n, N, impeller, dataset="LIT"):
    """비뉴턴(멱법칙) 유체의 Metzner-Otto 겉보기점도.

    gamma_avg = ks * N,   mu_app = K * gamma_avg^(n-1)
      K : 점조도지수 [Pa*s^n]     n : 유동지수 [-]
    """
    im = imp_db.get(impeller, dataset) if isinstance(impeller, str) else impeller
    gamma = im.ks_MO * N
    return K * gamma ** (n - 1.0), gamma


# ---------------------------------------------------------------------------
# 동력 / 토출량
# ---------------------------------------------------------------------------
def impeller_power(rho, N, D, Np):
    """단일 임펠러 액체전달동력 P = Np*rho*N^3*D^5 [W]"""
    return Np * rho * N ** 3 * D ** 5


def pumping_capacity(N, D, Nq):
    """1차 토출유량 Q = Nq*N*D^3 [m3/s]"""
    return Nq * N * D ** 3


def interference_factor(spacing_over_D):
    """다단 임펠러 간섭계수.

    간격 S 가 임펠러 직경 D 보다 좁으면 상호 유동간섭으로 합계 동력이
    단순합보다 작아진다. S/D >= 1.0 이면 1.0(간섭 없음).
    S/D < 1.0 구간은 선형 감소로 근사 (0.5D 에서 0.80).
    [HIM] Ch.6 다단임펠러 절의 정성적 경향을 선형화한 것 — 정밀도 낮음.
    """
    s = spacing_over_D
    if s >= 1.0:
        return 1.0
    if s <= 0.5:
        return 0.80
    return 0.80 + (s - 0.5) * (1.0 - 0.80) / 0.5


def total_power(rho, N, mu, stages, T, baffled=True, dataset="LIT",
                mech_eff=0.95, margin=1.15, model="kamei", H=None,
                B_w=0.0, n_baffles=0):
    """다단 임펠러 총동력 계산.

    stages : [{"type":키, "D":m, "W_D":옵션, "n_blades":옵션,
               "elevation":바닥으로부터 높이 m (옵션, 간섭계산용)}, ...]
    mech_eff : 감속기·씰 기계효율 (축동력 -> 모터축)
    margin   : 모터 선정 여유율
    model    : "kamei"(기본) Kamei-Hiraoka 상관식 / "2asymptote" 구 2점근 모델.
               kamei 는 액위 H 와 배플 치수(B_w, n_baffles)가 있어야 정확하다.
               H 미입력이면 2점근 모델로 자동 폴백한다.

    반환 CalcResult. results 주요 키
      P_liquid  액체전달동력 [W]      P_shaft 축동력(=P_liquid) [W]
      P_motor_req 필요 모터동력 [W]   Q_total 총 토출량 [m3/s]
      Re_gov 대표 레이놀즈수(최대경 임펠러 기준)
    """
    r = CalcResult("교반 동력 및 토출량", "P = Np*rho*N^3*D^5  [HIM Ch.6]")
    r.add_input("rho (밀도)", rho, "kg/m3")
    r.add_input("mu (점도)", mu, "Pa*s", f"{mu*1000:.0f} cP")
    r.add_input("N (회전수)", N, "rev/s", f"{rps_to_rpm(N):.1f} rpm")
    r.add_input("T (탱크 내경)", T * 1000.0, "mm")
    r.add_input("배플", "설치" if baffled else "없음")
    r.add_input("기계효율", mech_eff, "-")
    r.add_input("모터 여유율", margin, "-")
    r.add_input("데이터셋", dataset)
    use_kh = (model == "kamei" and H is not None)
    if model == "kamei" and H is None:
        r.warn("액위 H 미입력 → Kamei-Hiraoka 대신 2점근 모델로 계산했다. "
               "정확한 값이 필요하면 H 를 넘길 것.")

    D_max = max(s["D"] for s in stages)
    Re_gov = reynolds(rho, N, D_max, mu)
    r.add_step("Re (최대경 기준)", "rho*N*D^2/mu", Re_gov)
    r.add_step("유동영역", "", flow_regime(Re_gov))

    # 다단 간섭계수 — elevation 이 주어진 경우만
    elevs = [s.get("elevation") for s in stages]
    f_int = 1.0
    if len(stages) > 1 and all(e is not None for e in elevs):
        sp = min(abs(elevs[i + 1] - elevs[i]) for i in range(len(elevs) - 1))
        f_int = interference_factor(sp / D_max)
        r.add_step("최소 임펠러 간격 S", "", sp * 1000.0, "mm")
        r.add_step("간섭계수 (S/D=%.2f)" % (sp / D_max), "", f_int)
    elif len(stages) > 1:
        r.warn("임펠러 설치높이(elevation) 미입력 → 다단 간섭계수 1.0 적용 "
               "(간격이 1D 미만이면 실제 동력은 이보다 작다)")

    P_sum = 0.0
    Q_sum = 0.0
    detail = []
    for k, s in enumerate(stages, 1):
        D = s["D"]
        im = imp_db.get(s["type"], dataset)
        Re_i = reynolds(rho, N, D, mu)
        nb = s.get("n_blades") or im.n_blades
        if use_kh and im.key not in KH_FAMILY:
            r.warn(f"{im.name_ko} 은 Kamei-Hiraoka 검증 대상이 아니어서 "
                   "2점근 모델로 계산했다 (KH_FAMILY 주석 참조).")
        if use_kh and im.key in KH_FAMILY:
            Np_i, nd = kamei_hiraoka_np(
                Re_i, D, T, H,
                (KH_B_OVER_D.get(im.key) or s.get("W_D")
                 or im.W_D or 0.15) * D, nb,
                KH_FAMILY.get(im.key, "paddle"), KH_THETA.get(im.key, 90.0),
                baffled, B_w, n_baffles)
            gov = "Kamei-Hiraoka"
            formula = (f"Np0=pref*f, f=CL/ReG+Ct{{...}}^m  "
                       f"ReG={nd['ReG']:.4g} CL={nd['CL']:.4g} "
                       f"Ct={nd['Ct']:.4g} m={nd['m']:.4g}")
        else:
            Np_i, nd = power_number(Re_i, im, s.get("W_D"), s.get("n_blades"),
                                    baffled, dataset)
            gov = nd["governing"]
            formula = (f"max({nd['Kp']:.1f}/Re, {nd['Np_turb']:.2f})"
                       f" x {nd['f_width']:.3f} x {nd['f_blades']:.3f}"
                       f" x {nd['f_baffle']:.2f}")
        P_i = impeller_power(rho, N, D, Np_i)
        Q_i = pumping_capacity(N, D, im.Nq)
        P_sum += P_i
        Q_sum += Q_i
        detail.append(dict(stage=k, type=im.key, name=im.name_ko, D=D,
                           Re=Re_i, Np=Np_i, P=P_i, Q=Q_i, Nq=im.Nq,
                           governing=gov, dT=D / T))
        r.add_step(f"{k}단 {im.name_ko}  D={D*1000:.0f} mm  (D/T={D/T:.3f})", "", "")
        r.add_step(f"   Re_{k}", "rho*N*D^2/mu", Re_i)
        r.add_step(f"   Np_{k}  [{gov}]", formula, Np_i)
        r.add_step(f"   P_{k}", "Np*rho*N^3*D^5", P_i / 1000.0, "kW")
        r.add_step(f"   Q_{k}", f"Nq({im.Nq})*N*D^3", Q_i * 60.0, "m3/min")

    # 실제로 어느 모델이 쓰였는지는 단별 폴백 결과로 판단한다
    kh_used = [d["governing"] == "Kamei-Hiraoka" for d in detail]
    if all(kh_used):
        mdl, note = "Kamei-Hiraoka", "doi:10.1155/2012/106496"
    elif any(kh_used):
        mdl, note = "혼용", "일부 형식은 2점근 폴백"
    else:
        mdl, note = "2점근(Nagata 계열)", "천이역 오차 10~30%"
    r.inputs.insert(8, ("동력수 모델", mdl, "", note))

    P_liquid = P_sum * f_int
    P_motor_req = P_liquid / mech_eff * margin

    r.add_step("P_liquid (액체전달동력 합계)", "S P_i x 간섭계수", P_liquid / 1000.0, "kW")
    r.add_step("P_motor_req (필요 모터동력)",
               "P_liquid / 기계효율 x 여유율", P_motor_req / 1000.0, "kW")
    r.add_step("Q_total (총 토출량)", "S Q_i", Q_sum * 60.0, "m3/min")

    r.results.update(P_liquid=P_liquid, P_shaft=P_liquid,
                     P_motor_req=P_motor_req, Q_total=Q_sum,
                     Re_gov=Re_gov, regime=flow_regime(Re_gov),
                     f_interference=f_int, stages=detail, D_max=D_max)
    return r


# ---------------------------------------------------------------------------
# 표준 모터 용량 선정
# ---------------------------------------------------------------------------
IEC_MOTORS_KW = [0.2, 0.4, 0.75, 1.5, 2.2, 3.7, 5.5, 7.5, 11.0, 15.0, 18.5,
                 22.0, 30.0, 37.0, 45.0, 55.0, 75.0, 90.0, 110.0, 132.0,
                 160.0, 200.0, 250.0]


def select_motor(P_req_W, max_load=0.90):
    """필요동력 이상인 표준 모터 용량 선정.

    max_load : 허용 부하율 상한. 검토서 실적은 68~88.7% 이므로 0.90 기본.
    반환 (모터정격 kW, 부하율 %)
    """
    P_kw = P_req_W / 1000.0
    for m in IEC_MOTORS_KW:
        if P_kw / m <= max_load:
            return m, 100.0 * P_kw / m
    return IEC_MOTORS_KW[-1], 100.0 * P_kw / IEC_MOTORS_KW[-1]


# ---------------------------------------------------------------------------
# 혼합시간
# ---------------------------------------------------------------------------
def blend_time(N, D, T, H, Np, Re, impeller=None, dataset="LIT",
               const=5.9):
    """95% 균일 혼합시간 theta95 [s].

    난류역 (Re >= 1e4), 배플탱크  [GRE / Ruszkowski 1994]
        N*theta95 = const * Np^(-1/3) * (T/D)^2 * (H/T)^0.5     const=5.9
    천이역 (Re < 1e4)
        위 값에 (1e4/Re)^0.5 를 곱해 연장  — 근사. 오차 크다.
    층류 평탄역
        광폭/근접간극 임펠러는 N*theta95 가 일정해지므로 DB 의 N_theta 로
        하한을 잡고 위 값과 큰 쪽을 취한다.

    반환 (theta95 [s], 상세 dict)
    """
    N_theta_turb = const * Np ** (-1.0 / 3.0) * (T / D) ** 2 * (H / T) ** 0.5
    theta_turb = N_theta_turb / N

    if Re >= 1e4:
        theta = theta_turb
        basis = "난류 상관식"
        f_re = 1.0
    else:
        f_re = (1e4 / Re) ** 0.5
        theta = theta_turb * f_re
        basis = "천이역 보정 (1e4/Re)^0.5"

    theta_lam = None
    if impeller is not None:
        im = imp_db.get(impeller, dataset) if isinstance(impeller, str) else impeller
        if im.N_theta:
            theta_lam = im.N_theta / N
            if theta_lam > theta:
                theta = theta_lam
                basis = f"층류 평탄역 N*theta={im.N_theta}"

    return theta, dict(theta_turbulent=theta_turb, f_Re=f_re,
                       theta_laminar_floor=theta_lam, basis=basis,
                       N_theta=N_theta_turb)


def turnover_time(V, Q_total):
    """탱크 1회 순환시간 [s] = V/Q."""
    return V / Q_total if Q_total > 0 else float("inf")


def specific_power(P_liquid, V):
    """단위체적 동력 P/V [W/m3] — 스케일업 1차 기준."""
    return P_liquid / V


# ---------------------------------------------------------------------------
# 볼텍스 / 배플 판정
# ---------------------------------------------------------------------------
def vortex_check(Re, Fr, baffled):
    """무배플 탱크의 자유표면 볼텍스 위험 판정.

    Re > 300 이상에서 선회류가 발달하고, Fr 가 커지면 표면 함몰이 심해져
    공기 혼입·동력 급감이 일어난다. 실무 관행상 무배플에서 Fr > 0.1 이면
    주의, Fr > 0.3 이면 배플 또는 편심설치가 필요하다.
    """
    if baffled:
        return True, "배플 설치 — 볼텍스 억제"
    if Re < 300:
        return True, f"Re={Re:.0f} < 300, 점성지배로 볼텍스 미미 (무배플 가능)"
    if Fr <= 0.1:
        return True, f"Fr={Fr:.3f} <= 0.1, 무배플 허용범위"
    if Fr <= 0.3:
        return False, f"Fr={Fr:.3f} — 볼텍스 주의. 편심설치/경사설치 검토"
    return False, f"Fr={Fr:.3f} > 0.3 — 배플 필수 또는 회전수 하향"

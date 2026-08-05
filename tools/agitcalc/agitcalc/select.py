"""교반기 선정 드라이버.

사용자가 "점도 X cP, 비중 Y, 탱크 Z m3 에 이 물질을 섞고 싶다" 만 주면
형식·치수·회전수·동력·모터·축을 한 번에 산출한다.

회전수 결정 기준(sizing basis)
  "level"      교반강도 등급(P/V) 목표에 맞춤 — 기본값
  "blend"      목표 혼합시간에 맞춤
  "suspension" 고체 임계현탁 회전수 N_js 에 여유율 적용
  "rpm"        회전수 직접 지정
"""

import math

from .report import CalcResult
from . import impellers as imp_db
from . import geometry as geo
from . import core
from .core import (reynolds, froude, tip_speed, flow_regime, power_number,
                   total_power, select_motor, blend_time, turnover_time,
                   specific_power, vortex_check, liquid_height, rps_to_rpm,
                   rpm_to_rps, cP_to_Pas)
from . import shaft as shaft_mod
from .process import just_suspended_speed

# 표준 감속기 출력 회전수 (관행값) — 최종 rpm 을 여기에 스냅한다
STD_RPM = [10, 12, 15, 17, 20, 21, 25, 28, 30, 35, 37, 44, 50, 56, 62, 68,
           75, 82, 90, 100, 110, 125, 140, 155, 175, 200, 230, 260, 300,
           350, 400, 450, 500]


def _snap_rpm(rpm):
    return min(STD_RPM, key=lambda x: abs(x - rpm))


def _rpm_candidates(rpm):
    """스냅된 표준 회전수와 그 인접 두 단계 (익단속도 조정용).

    순서: 스냅값 -> 한 단계 위 -> 한 단계 아래.
    계산값에 가장 가까운 것을 우선하되, 익단속도 권장범위를 만족시키기 위해
    한 단계 올리거나 내리는 것을 허용한다.
    """
    s = _snap_rpm(rpm)
    i = STD_RPM.index(s)
    out = [s]
    if i + 1 < len(STD_RPM):
        out.append(STD_RPM[i + 1])
    if i - 1 >= 0:
        out.append(STD_RPM[i - 1])
    return out


def _power_at(N, rho, mu, stages_geo, T, baffled, dataset, H=None,
              B_w=0.0, n_baffles=0):
    """회전수 N 에서의 액체전달동력 [W] (빠른 내부 계산).

    total_power() 와 같은 동력수 모델을 써야 탐색으로 찾은 rpm 과 최종
    선정 동력이 어긋나지 않는다."""
    P = 0.0
    for s in stages_geo:
        Re = reynolds(rho, N, s["D"], mu)
        im = imp_db.get(s["type"], dataset)
        if H is not None and im.key in core.KH_FAMILY:
            Np, _ = core.kamei_hiraoka_np(
                Re, s["D"], T, H, (s.get("W_D") or im.W_D or 0.15) * s["D"],
                s.get("n_blades") or im.n_blades,
                core.KH_FAMILY.get(im.key, "paddle"),
                core.KH_THETA.get(im.key, 90.0), baffled, B_w, n_baffles)
        else:
            Np, _ = power_number(Re, im, s.get("W_D"), s.get("n_blades"),
                                 baffled, dataset)
        P += Np * rho * N ** 3 * s["D"] ** 5
    return P


def _solve_N_for_PV(target_PV, V, rho, mu, stages_geo, T, baffled, dataset,
                    H=None, B_w=0.0, n_baffles=0):
    """목표 P/V 를 만족하는 N 을 이분법으로 구한다."""
    target_P = target_PV * V
    lo, hi = 0.005, 30.0            # rev/s
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if _power_at(mid, rho, mu, stages_geo, T, baffled, dataset,
                     H, B_w, n_baffles) < target_P:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _solve_N_for_blend(target_s, T, H, stages_geo, rho, mu, baffled, dataset):
    """목표 혼합시간을 만족하는 N 을 이분법으로 구한다."""
    D = max(s["D"] for s in stages_geo)

    def theta(N):
        Re = reynolds(rho, N, D, mu)
        Np, _ = power_number(Re, stages_geo[0]["type"], baffled=baffled,
                             dataset=dataset)
        th, _ = blend_time(N, D, T, H, Np, Re, stages_geo[0]["type"], dataset)
        return th

    lo, hi = 0.005, 30.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if theta(mid) > target_s:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def design(V, rho, mu_cP, T=None, H_T=1.1, duty="blend",
           impeller_type=None, dT=None, n_imp=None, W_D=None,
           basis="level", level="moderate", target_PV=None,
           target_blend_min=None, rpm=None,
           solids=None, has_gas=False, shear_sensitive=False,
           material="SUS304", mech_eff=0.95, motor_margin=1.15,
           max_load=0.90, shaft_extra_mm=600.0, service_factor=1.5,
           vfd_min_rpm_ratio=0.3, dataset="LIT", baffled=None,
           model="kamei"):
    """교반기 종합 선정.

    V      : 액체 체적 [m3]           rho : 밀도 [kg/m3]
    mu_cP  : 점도 [cP]                T   : 탱크 내경 [m] (None 이면 V,H_T 로 산정)
    solids : {"rho_s":, "d_p":m, "X_wt_pct":} 고체현탁이 있으면 지정
    shaft_extra_mm : 액면 위 축 길이(씰·베어링~액면) — 축 전장 산정용

    반환 dict — 모든 CalcResult 와 요약값
    """
    mu = cP_to_Pas(mu_cP)

    # ---- 1) 탱크 치수 ----------------------------------------------------
    if T is None:
        # V = pi/4*T^2*H, H = H_T*T  ->  T = (4V/(pi*H_T))^(1/3)
        T = (4.0 * V / (math.pi * H_T)) ** (1.0 / 3.0)
    H = liquid_height(T, V)

    # ---- 2) 형식·형상 + 회전수 (D/T 와 N 을 함께 결정) ----------------------
    # 동력은 P ∝ N^3*D^5 이므로 같은 P/V 를 D 를 키우고 N 을 낮춰서도 얻을 수
    # 있다. 익단속도 권장범위를 만족하는 (D/T, rpm) 조합을 탐색한다.
    g0 = geo.recommend(T, V, mu_cP, impeller_type=impeller_type, dT=dT,
                       n_imp=n_imp, W_D=W_D)
    im0 = imp_db.get(g0["impeller_type"], dataset)
    if baffled is None:
        baffled = g0["baffled"]

    if target_PV is None and basis == "level":
        lo_pv, hi_pv, _ = geo.AGITATION_LEVELS[level]
        target_PV = 0.5 * (lo_pv + hi_pv)

    def _build(dT_try):
        gg = geo.recommend(T, V, mu_cP, impeller_type=g0["impeller_type"],
                           dT=dT_try, n_imp=n_imp, W_D=W_D)
        sg = [dict(type=gg["impeller_type"], D=gg["D"], W_D=gg["W_D"],
                   elevation=e) for e in gg["elevations"]]
        return gg, sg

    def _N_for(gg, sg):
        if basis == "rpm":
            if rpm is None:
                raise ValueError("basis='rpm' 이면 rpm 을 지정해야 한다")
            return rpm_to_rps(rpm), f"회전수 직접 지정 {rpm} rpm"
        if basis == "blend":
            if target_blend_min is None:
                raise ValueError("basis='blend' 이면 target_blend_min 을 지정해야 한다")
            return (_solve_N_for_blend(target_blend_min * 60.0, T, H, sg,
                                       rho, mu, baffled, dataset),
                    f"목표 혼합시간 {target_blend_min} min")
        if basis == "suspension":
            if not solids:
                raise ValueError("basis='suspension' 이면 solids 를 지정해야 한다")
            zr = just_suspended_speed(rho, mu, solids["rho_s"], solids["d_p"],
                                      solids["X_wt_pct"], gg["D"], T,
                                      gg["impeller_type"])
            return (zr.results["N_js_rps"] * 1.2,
                    f"N_js {zr.results['N_js_rpm']:.1f} rpm x 1.2 여유")
        return (_solve_N_for_PV(target_PV, V, rho, mu, sg, T, baffled, dataset,
                                H if model == "kamei" else None,
                                gg["B"], gg["n_baffles"]),
                f"교반강도 '{level}' 목표 P/V = {target_PV:.0f} W/m3")

    # 후보 D/T: 기본값에서 시작해 형식 권장범위를 0.05 간격으로 스캔
    if dT is not None or basis == "rpm":
        candidates = [g0["D_T"]]
    else:
        lo_d, hi_d = im0.dT
        n_step = int(round((hi_d - lo_d) / 0.05)) + 1
        scan = [round(lo_d + i * 0.05, 3) for i in range(n_step)]
        # 기본 권장값을 먼저 시도하고, 나머지는 그 값에 가까운 순서로
        candidates = sorted(set(scan + [g0["D_T"]]),
                            key=lambda x: abs(x - g0["D_T"]))

    best = None
    found = False
    for dT_try in candidates:
        gg, sg = _build(dT_try)
        N_try, note_try = _N_for(gg, sg)
        rpm_c = rps_to_rpm(N_try)
        lo_t, hi_t = gg["tip_speed_range"]
        # 표준 회전수로 스냅하면 익단속도가 권장범위를 살짝 벗어날 수 있으므로
        # 인접 표준 회전수까지 함께 검토한다 (P/V 는 밴드이므로 소폭 변동 허용).
        for rpm_s in ([rpm] if basis == "rpm" else _rpm_candidates(rpm_c)):
            N_s = rpm_to_rps(rpm_s)
            vt = tip_speed(N_s, gg["D"])
            note = note_try
            if rpm_s != _snap_rpm(rpm_c) and basis != "rpm":
                note += f"  (익단속도 확보를 위해 {_snap_rpm(rpm_c)} -> {rpm_s} rpm 조정)"
            if lo_t <= vt <= hi_t:
                best = (gg, sg, N_s, rpm_c, rpm_s, note, 0.0)
                found = True
                break
            dev = (lo_t - vt) if vt < lo_t else (vt - hi_t)
            if best is None or dev < best[6]:
                best = (gg, sg, N_s, rpm_c, rpm_s, note, dev)
        if found:
            break

    g, stages_geo, N, rpm_calc, rpm_final, basis_note, tip_dev = best
    im = imp_db.get(g["impeller_type"], dataset)
    if tip_dev > 0:
        basis_note += ("  (익단속도 권장범위를 만족하는 D/T·rpm 조합 없음 — "
                       "최근접 채택. D/T 상한 확대 또는 형식 변경 검토)")

    # ---- 4) 동력 ---------------------------------------------------------
    pr = total_power(rho, N, mu, stages_geo, T, baffled, dataset,
                     mech_eff=mech_eff, margin=motor_margin, model=model,
                     H=H, B_w=g["B"], n_baffles=g["n_baffles"])
    P_liquid = pr.results["P_liquid"]
    motor_kW, load_pct = select_motor(pr.results["P_motor_req"], max_load)

    # ---- 5) 성능지표 -----------------------------------------------------
    D = g["D"]
    Re = reynolds(rho, N, D, mu)
    Fr = froude(N, D)
    v_tip = tip_speed(N, D)
    PV = specific_power(P_liquid, V)
    if model == "kamei" and im.key in core.KH_FAMILY:
        Np_gov, _ = core.kamei_hiraoka_np(
            Re, D, T, H, g["W"], g.get("n_blades") or im.n_blades,
            core.KH_FAMILY.get(im.key, "paddle"),
            core.KH_THETA.get(im.key, 90.0), baffled, g["B"], g["n_baffles"])
    else:
        Np_gov, _ = power_number(Re, g["impeller_type"], g["W_D"],
                                 baffled=baffled, dataset=dataset)
    theta95, bd = blend_time(N, D, T, H, Np_gov, Re, g["impeller_type"], dataset)
    t_turn = turnover_time(V, pr.results["Q_total"])

    # ---- 6) 축 설계 ------------------------------------------------------
    # 축 길이 = 액면 위 여유 + (액위 - 최하단 임펠러 높이)
    L_shaft = shaft_extra_mm + (H - g["elevations"][0]) * 1000.0
    imp_for_shaft = [dict(D=D, a=shaft_extra_mm + (H - e) * 1000.0)
                     for e in g["elevations"]]
    sr = shaft_mod.design_shaft(
        motor_kW, rpm_final, _snap_shaft_dia(
            shaft_mod.min_shaft_diameter(motor_kW, rpm_final, material,
                                         service_factor)),
        L_shaft, imp_for_shaft, material=material,
        service_factor=service_factor, baffled=baffled,
        rpm_min=rpm_final * vfd_min_rpm_ratio,
        seal_position_mm=shaft_extra_mm * 0.3)

    # 응력 또는 위험속도 불만족이면 축경을 한 단계씩 올린다
    tries = 0
    while (not sr.ok) and tries < 12:
        d_next = _next_shaft_dia(sr.results and _cur_dia(sr))
        if d_next is None:
            break
        sr = shaft_mod.design_shaft(
            motor_kW, rpm_final, d_next, L_shaft, imp_for_shaft,
            material=material, service_factor=service_factor,
            baffled=baffled, rpm_min=rpm_final * vfd_min_rpm_ratio,
            seal_position_mm=shaft_extra_mm * 0.3)
        tries += 1

    # ---- 7) 종합 검토 ----------------------------------------------------
    r = CalcResult(f"교반기 선정 종합 — V={V} m3, {mu_cP:,.0f} cP, "
                   f"비중 {rho} kg/m3", "agitcalc")
    # 제작 도면 기준에 맞춰 길이는 mm 로 표시한다 (엔진 내부 계산은 SI m 유지).
    r.add_input("액체 체적 V", V, "m3")
    r.add_input("밀도 rho", rho, "kg/m3")
    r.add_input("점도 mu", mu_cP, "cP")
    r.add_input("탱크 내경 T", T * 1000.0, "mm", "산정값" if T is None else "")
    r.add_input("액위 H", H * 1000.0, "mm", f"H/T = {H/T:.3f}")
    r.add_input("선정 데이터셋", dataset)
    r.add_input("회전수 결정기준", basis_note)

    r.add_step("임펠러 형식", "", f"{im.name_ko} x {g['n_impellers']}단")
    r.add_step("임펠러경 D", f"D/T = {g['D_T']:.3f}", D * 1000.0, "mm")
    r.add_step("회전수", f"계산 {rpm_calc:.1f} -> 표준 스냅", rpm_final, "rpm")
    r.add_step("Re", "rho*N*D^2/mu", Re)
    r.add_step("유동영역", "", flow_regime(Re))
    r.add_step("익단속도 v_tip", "pi*D*N", v_tip, "m/s")
    r.add_step("Fr", "N^2*D/g", Fr)
    r.add_step("액체전달동력 P", "S Np*rho*N^3*D^5", P_liquid / 1000.0, "kW")
    r.add_step("단위체적동력 P/V", "P/V", PV, "W/m3")
    r.add_step("필요 모터동력", f"P/{mech_eff} x {motor_margin}",
               pr.results["P_motor_req"] / 1000.0, "kW")
    r.add_step("선정 모터", f"부하율 {load_pct:.1f}%", motor_kW, "kW")
    r.add_step("총 토출량 Q", "S Nq*N*D^3", pr.results["Q_total"] * 60.0, "m3/min")
    r.add_step("탱크 순환시간", "V/Q", t_turn, "s")
    r.add_step(f"혼합시간 theta95 [{bd['basis']}]", "", theta95 / 60.0, "min")
    r.add_step("축경 x 전장", "", f"φ{_cur_dia(sr):.0f} x {L_shaft:.0f}", "mm")
    r.add_step("축 위험속도 N_c", "", sr.results["N_crit_rpm"], "rpm")

    # 검토항목
    lo_t, hi_t = g["tip_speed_range"]
    r.add_check(f"익단속도 {v_tip:.2f} m/s 가 권장범위 {lo_t}~{hi_t} 내",
                lo_t <= v_tip <= hi_t,
                "벗어나면 D 또는 rpm 재조정")
    r.add_check(f"D/T = {g['D_T']:.3f} 가 형식 권장범위 "
                f"{im.dT[0]}~{im.dT[1]} 내", im.dT[0] <= g["D_T"] <= im.dT[1])
    r.add_check(f"점도 {mu_cP:,.0f} cP <= 형식 실용상한 {im.mu_max:,} cP",
                mu_cP <= im.mu_max, "초과 시 근접간극형(앵커/리본) 검토")
    vc_ok, vc_msg = vortex_check(Re, Fr, baffled)
    r.add_check(f"볼텍스/배플 — {vc_msg}", vc_ok)
    r.add_check(f"모터 부하율 {load_pct:.1f}% <= {max_load*100:.0f}%",
                load_pct <= max_load * 100)
    r.add_check(f"축 조합응력 안전율 {sr.results['SF_stress']:.2f} >= 1.0",
                sr.results["SF_stress"] >= 1.0)
    r.add_check(f"축 N/N_c = {sr.results['N_over_Nc']:.3f} <= 0.70",
                sr.results["N_over_Nc"] <= 0.70)

    if flow_regime(Re) != "난류":
        r.warn(f"Re={Re:.0f} — 난류역이 아니다. 문헌 Np·혼합시간 상관식은 "
               "난류역에서 얻어진 것이므로 오차가 크다(동력 ±15%, "
               "혼합시간 ±50% 이상). 고점도 설계는 제조사 실측 또는 "
               "CFD 검증을 권장한다.")
    if theta95 > 1800:
        r.warn(f"혼합시간 {theta95/60:.0f} min — 과대. D/T 확대 또는 회전수 "
               "상향, 또는 광폭/근접간극 임펠러로 형식 변경 검토")
    if not baffled and Re > 1e4:
        r.warn("무배플 + 난류역 — 선회류로 혼합효율이 크게 떨어진다. 배플 설치 권장")

    return dict(summary=r, geometry=g, power=pr, shaft=sr,
                T=T, H=H, N=N, rpm=rpm_final, rpm_calc=rpm_calc,
                Re=Re, Fr=Fr, v_tip=v_tip, Np=Np_gov,
                P_liquid=P_liquid, PV=PV, motor_kW=motor_kW,
                load_pct=load_pct, Q_total=pr.results["Q_total"],
                theta95_s=theta95, blend_detail=bd, turnover_s=t_turn,
                shaft_dia_mm=_cur_dia(sr), shaft_len_mm=L_shaft,
                impeller=im, dataset=dataset, baffled=baffled)


# --- 표준 축경 -------------------------------------------------------------
STD_SHAFT_DIA = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
                 100, 110, 120, 130, 140, 150, 160, 170, 180, 200, 220, 250]


def _snap_shaft_dia(d):
    for s in STD_SHAFT_DIA:
        if s >= d:
            return float(s)
    return float(STD_SHAFT_DIA[-1])


def _next_shaft_dia(d):
    for s in STD_SHAFT_DIA:
        if s > d + 0.5:
            return float(s)
    return None


def _cur_dia(shaft_result):
    """CalcResult 입력란에서 축 외경을 되읽는다."""
    for n, v, u, note in shaft_result.inputs:
        if n.startswith("d_o"):
            return float(v)
    return None


def full_report(res):
    """선정 결과 전체 계산서 텍스트."""
    parts = [res["summary"].report(),
             "",
             geo.format_geometry(res["geometry"]),
             "",
             res["power"].report(),
             "",
             res["shaft"].report()]
    return "\n".join(parts)

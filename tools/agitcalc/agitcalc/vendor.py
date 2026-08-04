"""협력업체(TOPJIN) 선정검토서 방식 재현 및 대조.

D&K켐텍 YDK-II 검토서 R5 8건을 역산해 확정한 식만 그대로 구현한다.
확정되지 않은 항목(동력수 Np, 교반소요시간)은 재현하지 않고, agitcalc 자체
모델의 값과 검토서 인쇄값을 나란히 놓아 차이를 드러낸다.

역산으로 확정된 식 (8/8 케이스 상대오차 1e-8 이내)
    Re    = rho * N * D_하단^2 / mu            (N [rev/s], mu [Pa*s])
    TP    = pi * D_하단 * N                     [m/s]
    Q/V   = SUM(Nq_i * rpm * D_i^3) / V         [回/min]
            Nq: MAXBLEND 0.21 / 2-P.P 0.50 / 4-P.P 0.4095
    보정동력 = 계산동력 x 1.10                   (IN-COIL 1건만 1.20)
    부하율   = 보정동력 / 모터정격 x 100         [%]

재현 불가 항목
    계산동력 : P = Np*rho*N^3*S D_i^5 형태는 맞으나 Np 룩업표가 비공개.
               단일형식(4-P.P, MAXBLEND)은 내부 정합성이 좋으나,
               MAXBLEND+2-P.P 조합 4건은 Re 가 낮을수록 Np 가 작아지는
               역전이 발생한다.
    교반소요시간 : 어떤 표준 상관식으로도 재현되지 않는다. 공정 요구시간을
               그대로 기입한 것으로 추정(FA-6102 = 정확히 60.0 min).
"""

import math

from .report import CalcResult
from . import impellers as imp_db
from .core import (rpm_to_rps, cP_to_Pas, reynolds, tip_speed, flow_regime,
                   power_number, select_motor)

VENDOR_NQ = imp_db.TOPJIN_NQ           # 역산 확정값
MARGIN = imp_db.TOPJIN_POWER_MARGIN
MARGIN_COIL = imp_db.TOPJIN_POWER_MARGIN_COIL


def topjin_sheet(T, V, rho, mu_cP, rpm, imps, mech_eff=0.85,
                 has_coil=False, motor_kW=None, Np_override=None,
                 baffled=None):
    """검토서와 동일한 항목을 계산한다.

    imps : [("MAXBLEND", 3.0), ("2-P.P", 1.7), ...]  벤더 형식명 그대로, 하단→상단
    Np_override : 벤더 Np 를 알고 있으면 지정 (없으면 agitcalc 문헌모델 사용)
    has_coil : 내부 코일 사양이면 보정계수 1.20 적용
    baffled  : 검토서 비고란의 배플 사양. 동력수에 직접 영향하므로 반드시 맞출 것.
               None(기본)이면 has_coil 로 추정한다 — 내부 코일은 배플과 유사한
               선회류 억제 효과가 있으므로 코일 有 -> 배플 有 로 본다.
               검토서에 NON-BAFFLE 로 적혀 있으면 baffled=False 를 명시할 것.
    """
    if baffled is None:
        baffled = bool(has_coil)
    N = rpm_to_rps(rpm)
    mu = cP_to_Pas(mu_cP)
    D_low = imps[0][1]

    r = CalcResult(f"TOPJIN 검토서 방식 재현  (T={T}m V={V}m3 {mu_cP:,.0f}cP "
                   f"{rpm}rpm)", "D&K켐텍 YDK-II 검토서 R5 역산")
    r.add_input("Tank Dia. T", T, "m")
    r.add_input("Volume V", V, "m3")
    r.add_input("비중 rho", rho, "kg/m3")
    r.add_input("점도 mu", mu_cP, "cP")
    r.add_input("RPM", rpm, "rpm")
    r.add_input("기계효율", mech_eff, "-")
    r.add_input("배플", "설치" if baffled else "없음",
                note="검토서 비고란 기준 — 동력수에 직접 영향")
    for i, (t, d) in enumerate(imps, 1):
        pos = ["하단", "중단", "상단"][min(i - 1, 2)]
        r.add_input(f"IMPELLER TYPE ({pos})", t)
        r.add_input(f"IMPELLER SIZE ({pos})", d, "m")

    # --- 확정식 ----------------------------------------------------------
    Re = reynolds(rho, N, D_low, mu)
    TP = tip_speed(N, D_low)
    Q = sum(VENDOR_NQ[imp_db.VENDOR_ALIAS.get(t.upper(), t.upper())]
            * rpm * d ** 3 for t, d in imps)
    QV = Q / V

    r.add_step("Reynolds수 Re", "rho*N*D_하단^2/mu", Re)
    r.add_step("유동영역", "", flow_regime(Re))
    r.add_step("TIP SPEED", "pi*D_하단*N", TP, "m/s")
    r.add_step("토출유량수 Q/V", "S(Nq*rpm*D^3)/V  [Nq 역산확정값]", QV, "回/min")

    # --- 동력 (Np 는 재현 불가 → 문헌모델 또는 지정값) ------------------------
    P_w = 0.0
    for t, d in imps:
        key = imp_db.VENDOR_ALIAS.get(t.upper(), t.upper())
        if Np_override is not None:
            Np_i = Np_override
            src = "지정 Np"
        else:
            Re_i = reynolds(rho, N, d, mu)
            Np_i, nd = power_number(Re_i, key, baffled=baffled, dataset="LIT")
            src = (f"문헌 2점근모델 [{nd['governing']}]"
                   f"{', 무배플 보정 x0.70' if nd['f_baffle'] != 1.0 else ''}")
        P_i = Np_i * rho * N ** 3 * d ** 5
        P_w += P_i
        r.add_step(f"  {t} D={d}m : Np = {Np_i:.4f} ({src})",
                   "Np*rho*N^3*D^5", P_i / 1000.0, "kW")

    P_calc = P_w / mech_eff / 1000.0            # kW, 검토서 '계산동력' 정의 가정
    margin = MARGIN_COIL if has_coil else MARGIN
    P_corr = P_calc * margin

    r.add_step("계산동력 P", "S P_i / 기계효율", P_calc, "kW")
    r.add_step(f"보정동력 P_corr", f"계산동력 x {margin}", P_corr, "kW")

    if motor_kW is None:
        motor_kW, load = select_motor(P_corr * 1000.0,
                                      imp_db.TOPJIN_MAX_LOAD)
    else:
        load = 100.0 * P_corr / motor_kW
    r.add_step("MOTOR동력 Pm", "", motor_kW, "kW")
    r.add_step("부하율", "보정동력/모터정격", load, "%")
    r.add_check(f"부하율 {load:.1f}% <= 90%", load <= 90.0)

    r.warn("검토서의 '계산동력'은 Np 룩업표가 비공개여서 그대로 재현되지 않는다. "
           "위 동력은 agitcalc 문헌모델 값이며, 벤더 인쇄값과의 차이는 "
           "compare_sheet() 로 확인할 것.")
    r.warn("검토서 '교반소요시간(추정)'은 재현 불가 항목이다. 유체역학적 혼합시간은 "
           "agitcalc.blend_time() 으로 별도 산출해 비교해야 한다.")

    r.results.update(Re=Re, TP=TP, QV=QV, Q=Q, P_calc_kW=P_calc,
                     P_corr_kW=P_corr, motor_kW=motor_kW, load_pct=load,
                     margin=margin, baffled=baffled)
    return r


def compare_sheet(printed, T, V, rho, mu_cP, rpm, imps, mech_eff=0.85,
                  has_coil=False, motor_kW=None, baffled=None):
    """검토서 인쇄값 dict 과 재현값을 대조한다.

    printed : {"QV":, "TP":, "Re":, "P_calc":, "P_corr":, "load_pct":} 부분지정 가능
    반환 CalcResult (검토 항목에 일치/불일치)
    """
    calc = topjin_sheet(T, V, rho, mu_cP, rpm, imps, mech_eff, has_coil,
                        motor_kW, baffled=baffled)
    r = CalcResult("검토서 인쇄값 대조", "agitcalc.vendor.compare_sheet")
    keymap = [("Re", "Re", "Reynolds수", ""),
              ("TP", "TP", "TIP SPEED", "m/s"),
              ("QV", "QV", "토출유량수 Q/V", "回/min"),
              ("P_calc", "P_calc_kW", "계산동력", "kW"),
              ("P_corr", "P_corr_kW", "보정동력", "kW"),
              ("load_pct", "load_pct", "부하율", "%")]
    for pk, ck, label, unit in keymap:
        if pk not in printed:
            continue
        want, got = printed[pk], calc.results[ck]
        err = abs(got - want) / abs(want) if want else 0.0
        r.add_step(f"{label} — 검토서", "", want, unit)
        r.add_step(f"{label} — agitcalc", f"오차 {err*100:.2f}%", got, unit)
        r.add_check(f"{label} 일치 (0.1% 이내)", err <= 1e-3,
                    "" if err <= 1e-3 else f"차이 {err*100:.1f}%")
    r.results["calc"] = calc.results
    return r

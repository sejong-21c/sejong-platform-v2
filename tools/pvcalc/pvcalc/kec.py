"""한국에너지공단 열사용기자재 — 압력용기 제조기술규격 (KEA/KEMCO CODE Section IV, KPM).

구현 근거: 「압력용기 제조기술 규격 2002」(KEMCO CODE Section IV) 원문
  KPM-3210 판의 두께 (최소두께 규정)
  KPM-3220/3221 내면에 압력을 받는 원통형 동체의 최소두께
  KPM-3222 내면에 압력을 받는 구형 동체의 최소두께
  KPM-3321 접시형 · 전체반구형 경판의 최소두께
  KPM-3322(2) 플랜지 보강 구멍이 있는 경판의 두께 가산
  KPM-3323 반타원체형 경판의 최소두께
  KPM-3324(2) 반타원체형 경판의 플랜지 보강

미구현 — KPM-3230 외압. A·B 계수를 [그림 KPM-3230.1~3] 차트에서 읽어야 하며
차트는 저작권 자료다. ASME 는 VIII-2 4.4 라는 수식 대안이 있었지만 KPM 에는
없으므로, 외압은 이 모듈에서 다루지 않는다 (추정 금지).

⚠ 원문은 「에너지관리공단의 허락없이 무단복제를 금합니다」로 표시된 저작물이다.
   이 모듈은 계산식만 구현하며, 허용응력표(σa)·이음효율표(η)·외압 차트 값은
   담지 않는다 — 사용자가 licensed 사본에서 직접 입력한다. ASME Sec II-D 를
   내장하지 않는 것과 같은 원칙.

단위계
------
KPM 은 SI 와 공학단위(kgf) 두 벌의 계산식을 병기한다. 계수만 다르고 형태는
같으므로 `units` 로 전환한다.

  units="SI"  : P [MPa],      σa [N/mm²]  → 계수 배율 1
  units="kgf" : P [kgf/cm²],  σa [kgf/mm²] → 계수 배율 100
                (σa 를 kgf/mm² 에서 kgf/cm² 로 바꾸는 100 배가 식에 녹아
                 200·σa, 400·σa 로 나타난다)

길이는 어느 쪽이나 mm.

부식여유 취급 (ASME 와 다른 점)
------------------------------
KPM 식은 지름을 「부식여유를 제외한」 값으로 넣고 마지막에 α 를 더한다.
ASME 탭처럼 반지름에 CA 를 자동 가산하지 않는다 — 원문 그대로 두고
사용자가 지름을 정한다. 두 기준을 섞으면 두께가 조용히 달라진다.
"""

import math

from .report import CalcResult

# KPM-3210 판의 두께 — 성형 후 실제두께(부식여유 제외)의 하한 [mm]
MIN_THICKNESS = {
    "carbon": 2.5,          # (1) 탄소강 강판 및 저합금강 강판
    "highalloy": 2.5,       # (2) 고합금강 강판, 부식이 예상되는 것
    "highalloy_nocorr": 1.5,  # (2) 고합금강 강판, 부식이 예상되지 않는 것
    "nonferrous": 2.5,      # (3) 비철금속판, 부식이 예상되는 것
    "nonferrous_nocorr": 1.5,  # (3) 비철금속판, 부식이 예상되지 않는 것
}
MIN_THICKNESS_LABEL = {
    "carbon": "탄소강·저합금강 강판 (KPM-3210(1))",
    "highalloy": "고합금강 강판, 부식 예상 (KPM-3210(2))",
    "highalloy_nocorr": "고합금강 강판, 부식 예상 안 됨 (KPM-3210(2))",
    "nonferrous": "비철금속판, 부식 예상 (KPM-3210(3))",
    "nonferrous_nocorr": "비철금속판, 부식 예상 안 됨 (KPM-3210(3))",
}


def _mult(units):
    """σa 계수 배율. SI 는 1, 공학단위(kgf)는 100."""
    u = str(units).lower()
    if u == "si":
        return 1.0
    if u == "kgf":
        return 100.0
    raise ValueError("units 는 'SI' 또는 'kgf'")


def _unit_labels(units):
    return ("MPa", "N/mm²") if _mult(units) == 1.0 else ("kgf/cm²", "kgf/mm²")


def _add_min_check(r, t_req, alpha, material_class):
    """KPM-3210 최소두께 규정을 체크로 붙이고 지배두께를 돌려준다."""
    if material_class is None:
        return t_req
    if material_class not in MIN_THICKNESS:
        raise ValueError(f"material_class 는 {sorted(MIN_THICKNESS)} 중 하나")
    tmin = MIN_THICKNESS[material_class]
    r.add_step("t_min (KPM-3210)", MIN_THICKNESS_LABEL[material_class], tmin, "mm")
    r.add_check(f"성형 후 실제두께(부식여유 제외) ≥ {tmin} mm", t_req - alpha >= tmin)
    governed = max(t_req, tmin + alpha)
    if governed > t_req:
        r.add_step("t (최소두께 지배)", "t_min + α", governed, "mm")
    return governed


def _common_inputs(r, P, sigma_a, eta, alpha, units):
    pu, su = _unit_labels(units)
    r.add_input("P (최고사용압력)", float(P), pu)
    r.add_input("σa (허용인장응력)", float(sigma_a), su)
    r.add_input("η (이음효율)", float(eta), "",
                note="관은 허용응력에 용접효율이 포함되어 1.0")
    r.add_input("α (부식여유, KPM-3130)", float(alpha), "mm")


def cylinder_thickness(P, Di=None, Do=None, sigma_a=None, eta=1.0, alpha=0.0,
                       units="SI", material_class="carbon", thick_wall=None):
    """KPM-3221 내면에 압력을 받는 원통형 동체의 최소두께.

    Di 또는 Do 중 하나만 준다 (부식여유를 제외한 지름, mm).
      (1) 안지름 기준 : t = P·Di/(2·σa·η − 1.2P) + α
      (2) 바깥지름 기준: t = P·Do/(2·σa·η + 0.8P) + α
      (3) 기타(두꺼운 벽): 판두께가 안지름의 1/4 을 초과하고 사용온도가
          재료의 크리프 영역에 도달하지 않는 경우
          ① t = (Di/2)·(√((σa·η+P)/(σa·η−P)) − 1) + α
          ② t = (Do/2)·(1 − 1/√((σa·η+P)/(σa·η−P))) + α

    thick_wall=None 이면 (1)/(2) 로 계산한 두께가 Di/4 를 넘는지 보고 자동
    판정한다. 크리프 영역 설계온도에서는 KPM-3220 단서에 따라 (1)/(2) 식을
    써야 하므로 thick_wall=False 로 강제할 수 있다.
    """
    if (Di is None) == (Do is None):
        raise ValueError("Di 또는 Do 중 하나만 지정")
    m = _mult(units)
    r = CalcResult("원통형 동체 — 내압 최소두께",
                   "KEMCO CODE Section IV KPM-3221 (한국에너지공단)")
    _common_inputs(r, P, sigma_a, eta, alpha, units)
    by_id = Di is not None
    D = float(Di if by_id else Do)
    r.add_input("Di (부식여유 제외 안지름)" if by_id else "Do (부식여유 제외 바깥지름)",
                D, "mm")

    S = sigma_a * m * eta
    r.add_step("σa·계수·η", f"σa × {m:g} × η", S)

    if by_id:
        t_thin = P * D / (2.0 * S - 1.2 * P) + alpha
        r.add_step("t (1) 안지름 기준", f"P·Di/(2·{m:g}σa·η − 1.2P) + α", t_thin, "mm")
    else:
        t_thin = P * D / (2.0 * S + 0.8 * P) + alpha
        r.add_step("t (2) 바깥지름 기준", f"P·Do/(2·{m:g}σa·η + 0.8P) + α", t_thin, "mm")

    # (3) 적용 여부: 판두께가 동체 안지름의 1/4 초과
    Di_eff = D if by_id else D - 2.0 * (t_thin - alpha)
    ratio_limit = Di_eff / 4.0
    r.add_step("Di/4 (두꺼운 벽 판정 한계)", "안지름/4", ratio_limit, "mm")
    is_thick = (t_thin - alpha) > ratio_limit if thick_wall is None else bool(thick_wall)

    t_req = t_thin
    if is_thick:
        if S <= P:
            raise ValueError("σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남")
        k = math.sqrt((S + P) / (S - P))
        r.add_step("√((σa·η+P)/(σa·η−P))", "두꺼운 벽 계수", k)
        if by_id:
            t_req = (D / 2.0) * (k - 1.0) + alpha
            r.add_step("t (3)① 안지름 기준", "(Di/2)·(k − 1) + α", t_req, "mm")
        else:
            t_req = (D / 2.0) * (1.0 - 1.0 / k) + alpha
            r.add_step("t (3)② 바깥지름 기준", "(Do/2)·(1 − 1/k) + α", t_req, "mm")
        r.results["governing"] = "thick_wall"
    else:
        r.results["governing"] = "thin_wall"
    r.add_check("두꺼운 벽 식 적용 여부 판정됨 (크리프 영역이면 (1)/(2) 사용 — KPM-3220)",
                True)

    t_gov = _add_min_check(r, t_req, alpha, material_class)
    r.results["t_req"] = t_req
    r.results["t"] = t_gov
    return r


def sphere_thickness(P, Di=None, Do=None, sigma_a=None, eta=1.0, alpha=0.0,
                     units="SI", material_class="carbon", thick_wall=None):
    """KPM-3222 내면에 압력을 받는 구형 동체의 최소두께.

      (1) t = P·Di/(4·σa·η − 0.4P) + α
      (2) t = P·Do/(4·σa·η + 1.6P) + α
      (3) 판두께가 안지름의 0.178 배 초과 & 크리프 영역 미달
          ① t = (Di/2)·(∛(2(σa·η+P)/(2σa·η−P)) − 1) + α
          ② t = (Do/2)·(1 − 1/∛(2(σa·η+P)/(2σa·η−P))) + α
    """
    if (Di is None) == (Do is None):
        raise ValueError("Di 또는 Do 중 하나만 지정")
    m = _mult(units)
    r = CalcResult("구형 동체 — 내압 최소두께",
                   "KEMCO CODE Section IV KPM-3222 (한국에너지공단)")
    _common_inputs(r, P, sigma_a, eta, alpha, units)
    by_id = Di is not None
    D = float(Di if by_id else Do)
    r.add_input("Di (부식여유 제외 안지름)" if by_id else "Do (부식여유 제외 바깥지름)",
                D, "mm")

    S = sigma_a * m * eta
    r.add_step("σa·계수·η", f"σa × {m:g} × η", S)

    if by_id:
        t_thin = P * D / (4.0 * S - 0.4 * P) + alpha
        r.add_step("t (1) 안지름 기준", f"P·Di/(4·{m:g}σa·η − 0.4P) + α", t_thin, "mm")
    else:
        t_thin = P * D / (4.0 * S + 1.6 * P) + alpha
        r.add_step("t (2) 바깥지름 기준", f"P·Do/(4·{m:g}σa·η + 1.6P) + α", t_thin, "mm")

    Di_eff = D if by_id else D - 2.0 * (t_thin - alpha)
    limit = 0.178 * Di_eff
    r.add_step("0.178·Di (두꺼운 벽 판정 한계)", "안지름 × 0.178", limit, "mm")
    is_thick = (t_thin - alpha) > limit if thick_wall is None else bool(thick_wall)

    t_req = t_thin
    if is_thick:
        if 2.0 * S <= P:
            raise ValueError("2σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남")
        k = ((2.0 * (S + P)) / (2.0 * S - P)) ** (1.0 / 3.0)
        r.add_step("∛(2(σa·η+P)/(2σa·η−P))", "두꺼운 벽 계수", k)
        if by_id:
            t_req = (D / 2.0) * (k - 1.0) + alpha
            r.add_step("t (3)① 안지름 기준", "(Di/2)·(k − 1) + α", t_req, "mm")
        else:
            t_req = (D / 2.0) * (1.0 - 1.0 / k) + alpha
            r.add_step("t (3)② 바깥지름 기준", "(Do/2)·(1 − 1/k) + α", t_req, "mm")
        r.results["governing"] = "thick_wall"
    else:
        r.results["governing"] = "thin_wall"

    t_gov = _add_min_check(r, t_req, alpha, material_class)
    r.results["t_req"] = t_req
    r.results["t"] = t_gov
    return r


def torispherical_head_thickness(P, R, r_knuckle=None, sigma_a=None, eta=1.0,
                                 alpha=0.0, units="SI", material_class="carbon",
                                 hemispherical=False, flanged_opening=False,
                                 Di_shell=None):
    """KPM-3321 접시형 경판 또는 전체반구형 경판의 최소두께.

        t = P·R·W/(2·σa·η − 0.2P) + α
        W = (1/4)·(3 + √(R/r))       단, 전체 반구형 경판은 W = 1

    R : 접시형 경판 중앙부의 내면 반지름 (전체 반구형은 그 내면 반지름) [mm]
    r_knuckle : 구석 둥글기의 부식여유를 제외한 안쪽 반지름 [mm]

    flanged_opening=True — KPM-3322(2). 맨홀 또는 최대치수 150 mm 를 초과하는
      구멍을 「접어 집어넣는 플랜지」로 보강하는 경우: KPM-3321 두께에 15%
      (그 값이 3 mm 미만이면 3 mm) 이상을 더한다. 이때 경판의 부식여유를 제외한
      내면 반경이 동체 안지름의 80% 보다 작으면 80% 로 하여 계산한다
      (Di_shell 을 주면 이 대체를 적용한다).
    """
    m = _mult(units)
    r = CalcResult("접시형·전체반구형 경판 — 최소두께",
                   "KEMCO CODE Section IV KPM-3321"
                   + (" / KPM-3322(2)" if flanged_opening else "")
                   + " (한국에너지공단)")
    _common_inputs(r, P, sigma_a, eta, alpha, units)
    r.add_input("R (경판 중앙부 내면 반지름)", float(R), "mm")

    R_use = float(R)
    if flanged_opening and Di_shell is not None:
        floor_R = 0.8 * float(Di_shell)
        r.add_input("Di (동체 안지름)", float(Di_shell), "mm")
        if R_use < floor_R:
            r.add_step("R 대체 (KPM-3322(2))", "동체 안지름의 80%", floor_R, "mm")
            R_use = floor_R

    if hemispherical:
        W = 1.0
        r.add_step("W", "전체 반구형 경판은 1", W)
    else:
        if r_knuckle is None:
            raise ValueError("접시형 경판은 r_knuckle 이 필요 (전체반구형은 hemispherical=True)")
        r.add_input("r (구석 둥글기 안쪽 반지름, 부식여유 제외)", float(r_knuckle), "mm")
        W = 0.25 * (3.0 + math.sqrt(R_use / r_knuckle))
        r.add_step("W", "(3 + √(R/r))/4", W)

    S = sigma_a * m * eta
    t_base = P * R_use * W / (2.0 * S - 0.2 * P) + alpha
    r.add_step("t (KPM-3321)", f"P·R·W/(2·{m:g}σa·η − 0.2P) + α", t_base, "mm")

    t_req = t_base
    if flanged_opening:
        add = max(0.15 * t_base, 3.0)
        r.add_step("가산량 (KPM-3322(2))", "max(15% × t, 3 mm)", add, "mm")
        t_req = t_base + add
        r.add_step("t (플랜지 보강 가산 후)", "t + 가산량", t_req, "mm")

    t_gov = _add_min_check(r, t_req, alpha, material_class)
    r.results["W"] = W
    r.results["t_req"] = t_req
    r.results["t"] = t_gov
    return r


def ellipsoidal_head_thickness(P, D, h=None, sigma_a=None, eta=1.0, alpha=0.0,
                               units="SI", material_class="carbon",
                               D_over_2h=None, flanged_opening=False,
                               Di_shell=None):
    """KPM-3323 반타원체형 경판의 최소두께.

        t = P·D·V/(2·σa·η − 0.2P) + α
        V = (1/6)·[2 + (D/2h)²]

    D : 반타원체형 경판 내면의 긴지름 [mm]
    h : 경판 안지름의 짧은 지름의 1/2 [mm]  (2:1 경판이면 h = D/4)
        D_over_2h 로 비율을 직접 줄 수도 있다 (2:1 → 2.0).

    flanged_opening=True — KPM-3324(2). 접어 집어넣는 플랜지로 구멍을 보강하는
      경우 KPM-3322(2) 에 의해 계산하며, 이때 경판 중앙부의 내면반경은 동체
      안지름의 80% 로 하고 W 는 1.77 로 한다. → 접시형 식으로 넘어간다.
    """
    if flanged_opening:
        if Di_shell is None:
            raise ValueError("KPM-3324(2) 는 동체 안지름(Di_shell)이 필요")
        m = _mult(units)
        r = CalcResult("반타원체형 경판 — 플랜지 보강 구멍이 있는 경우",
                       "KEMCO CODE Section IV KPM-3324(2) → KPM-3322(2) (한국에너지공단)")
        _common_inputs(r, P, sigma_a, eta, alpha, units)
        r.add_input("Di (동체 안지름)", float(Di_shell), "mm")
        R_use = 0.8 * float(Di_shell)
        W = 1.77
        r.add_step("R (KPM-3324(2))", "동체 안지름의 80%", R_use, "mm")
        r.add_step("W (KPM-3324(2))", "1.77 로 한다", W)
        S = sigma_a * m * eta
        t_base = P * R_use * W / (2.0 * S - 0.2 * P) + alpha
        r.add_step("t (KPM-3321 식)", f"P·R·W/(2·{m:g}σa·η − 0.2P) + α", t_base, "mm")
        add = max(0.15 * t_base, 3.0)
        r.add_step("가산량 (KPM-3322(2))", "max(15% × t, 3 mm)", add, "mm")
        t_req = t_base + add
        r.add_step("t (가산 후)", "t + 가산량", t_req, "mm")
        t_gov = _add_min_check(r, t_req, alpha, material_class)
        r.results["W"] = W
        r.results["t_req"] = t_req
        r.results["t"] = t_gov
        return r

    m = _mult(units)
    r = CalcResult("반타원체형 경판 — 최소두께",
                   "KEMCO CODE Section IV KPM-3323 (한국에너지공단)")
    _common_inputs(r, P, sigma_a, eta, alpha, units)
    r.add_input("D (경판 내면 긴지름)", float(D), "mm")

    if D_over_2h is None:
        if h is None:
            raise ValueError("h 또는 D_over_2h 중 하나가 필요")
        r.add_input("h (짧은 지름의 1/2)", float(h), "mm")
        ratio = float(D) / (2.0 * float(h))
    else:
        ratio = float(D_over_2h)
    r.add_step("D/2h", "긴지름/(2·h)", ratio)

    V = (2.0 + ratio ** 2) / 6.0
    r.add_step("V", "[2 + (D/2h)²]/6", V)

    S = sigma_a * m * eta
    t_req = P * float(D) * V / (2.0 * S - 0.2 * P) + alpha
    r.add_step("t (KPM-3323)", f"P·D·V/(2·{m:g}σa·η − 0.2P) + α", t_req, "mm")

    t_gov = _add_min_check(r, t_req, alpha, material_class)
    r.results["V"] = V
    r.results["t_req"] = t_req
    r.results["t"] = t_gov
    return r

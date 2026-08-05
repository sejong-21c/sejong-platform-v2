"""가스안전공사 KGS AC111 — 고압가스용 저장탱크 및 압력용기 제조의 시설·기술·검사 기준.

구현 근거: KGS AC111 (2023.03.06 판) 원문 §3.3.1.1
  3.3.1.1.1 내면에 압력을 받는 동판
     (1-1-1) 원통동체 / (1-1-2) 최소두께가 안지름의 1/4 초과
     (2-1)(2-2) 구형동체 (판정 t/Di = 0.178)
     (3-1) 원추형동체 원추부
  3.3.1.1.3 오목면에 압력을 받는 경판
     (1-1) 접시형·온반구형 / (1-2) 맨홀·150mm 초과 구멍 삽입플랜지 보강
     (2-1) 반타원체형 / (2-2) 삽입플랜지 보강
  3.3.1.1.4 내면에 압력을 받는 원추형 경판 (1) 꼭지각 ≤ 140° / (2) > 140°

⚠ KPM(에너지공단)과 식 계보가 같지만 **절대 같은 함수로 묶지 말 것.**
  - AC111 식에는 **α(부식여유) 항이 없다.** KPM 은 `… + α` 로 끝난다.
    AC111 은 「최소두께」를 주고 부식여유는 별도 취급이다.
  - P 가 AC111 은 **설계압력**, KPM 은 **최고사용압력**이다.
  - σa 단서가 다르다 — AC111 은 「용접부 허용응력이 모재보다 낮으면 용접부 값 적용」.
  - AC111 층성동체 식의 α 는 **온도 수정계수**(부식여유가 아니다).

미구현
  - 3.3.1.1.1 (1-2) 층성동체(multi-layered shell) — 내통·층성부·외통 3층의
    항복점·두께, 온도 수정계수, 합성 이음매효율이 필요. 입력이 11개라 별도 작업.
  - 3.3.1.1.2 외면에 압력을 받는 동판(외압) — B·C·E 계수를 [부록 H 그림 1]
    **차트**에서 읽어야 한다. KPM 과 같은 이유로 추정하지 않는다.
  - 3.3.1.1.6 볼록면 압력 + 스테이 경판, 3.3.1.1.8 평판, 식(3.10)(3.11) 관판
  - 구멍 보강, 부속품

⚠ 허용인장응력 σa 는 원문 부록 A 표(또는 §3.2.4 가 허용하는 ASME Sec II-D
   Table 1A·1B·3) 값이며 **저작권 자료다.** 이 모듈은 담지 않는다 —
   사용자가 직접 입력한다.

단위: P [MPa], σa [N/mm² = MPa], 길이 [mm]. AC111 은 SI 만 쓴다.
"""

import math

from .report import CalcResult


def _common(r, P, sigma_a, eta):
    r.add_input("P (설계압력)", float(P), "MPa")
    r.add_input("σa (설계온도 허용인장응력)", float(sigma_a), "N/mm²",
                note="용접부 허용응력이 모재보다 낮으면 용접부 값 적용")
    r.add_input("η (용접이음매효율)", float(eta), "",
                note="용접이음매가 없으면 1")


def cylinder_thickness(P, Di, sigma_a, eta=1.0, thick_wall=None):
    """AC111 3.3.1.1.1 (1-1) 내면에 압력을 받는 원통동체의 최소두께.

      (1-1-1) t = P·Di/(2σaη − 1.2P)
      (1-1-2) 최소두께가 안지름의 1/4 을 초과하는 경우
              t = (Di/2)·(√((σaη + P)/(σaη − P)) − 1)

    Di : 동체의 안지름 [mm]
    thick_wall=None 이면 (1-1-1) 결과가 Di/4 를 넘는지 보고 자동 판정한다.

    ⚠ 부식여유는 식에 포함되지 않는다 — 필요하면 결과에 따로 더할 것.
    """
    r = CalcResult("원통동체 — 내압 최소두께",
                   "KGS AC111 3.3.1.1.1 (1-1) (가스안전공사)")
    _common(r, P, sigma_a, eta)
    r.add_input("Di (동체의 안지름)", float(Di), "mm")

    S = sigma_a * eta
    r.add_step("σa·η", "σa × η", S)

    t_thin = P * Di / (2.0 * S - 1.2 * P)
    r.add_step("t (1-1-1)", "P·Di/(2σaη − 1.2P)", t_thin, "mm")

    limit = Di / 4.0
    r.add_step("Di/4 (두꺼운 벽 판정 한계)", "안지름/4", limit, "mm")
    is_thick = t_thin > limit if thick_wall is None else bool(thick_wall)

    t = t_thin
    if is_thick:
        if S <= P:
            raise ValueError("σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남")
        k = math.sqrt((S + P) / (S - P))
        r.add_step("√((σaη+P)/(σaη−P))", "두꺼운 벽 계수", k)
        t = (Di / 2.0) * (k - 1.0)
        r.add_step("t (1-1-2)", "(Di/2)·(k − 1)", t, "mm")
        r.results["governing"] = "thick_wall"
    else:
        r.results["governing"] = "thin_wall"

    r.add_check("부식여유는 식에 없음 — 필요하면 별도 가산 (KPM 과 다른 점)", True)
    r.results["t"] = t
    return r


def sphere_thickness(P, Di, sigma_a, eta=1.0, thick_wall=None):
    """AC111 3.3.1.1.1 (2) 내면에 압력을 받는 구형동체의 최소두께.

      (2-1) t/Di ≤ 0.178 : t = P·Di/(4σaη − 0.4P)
      (2-2) t/Di > 0.178 : t = (Di/2)·(∛(2(σaη + P)/(2σaη − P)) − 1)
    """
    r = CalcResult("구형동체 — 내압 최소두께",
                   "KGS AC111 3.3.1.1.1 (2) (가스안전공사)")
    _common(r, P, sigma_a, eta)
    r.add_input("Di (동체의 안지름)", float(Di), "mm")

    S = sigma_a * eta
    r.add_step("σa·η", "σa × η", S)

    t_thin = P * Di / (4.0 * S - 0.4 * P)
    r.add_step("t (2-1)", "P·Di/(4σaη − 0.4P)", t_thin, "mm")

    ratio = t_thin / Di
    r.add_step("t/Di", "얇은 벽 식 결과 / 안지름", ratio)
    is_thick = ratio > 0.178 if thick_wall is None else bool(thick_wall)

    t = t_thin
    if is_thick:
        if 2.0 * S <= P:
            raise ValueError("2σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남")
        k = ((2.0 * (S + P)) / (2.0 * S - P)) ** (1.0 / 3.0)
        r.add_step("∛(2(σaη+P)/(2σaη−P))", "두꺼운 벽 계수", k)
        t = (Di / 2.0) * (k - 1.0)
        r.add_step("t (2-2)", "(Di/2)·(k − 1)", t, "mm")
        r.results["governing"] = "thick_wall"
    else:
        r.results["governing"] = "thin_wall"

    r.results["t"] = t
    return r


def conical_shell_thickness(P, Di, half_apex_deg, sigma_a, eta=1.0):
    """AC111 3.3.1.1.1 (3-1) 내면에 압력을 받는 원추형동체 원추부의 최소두께.

        t = P·Di/(2·cosθ·(σaη − 0.6P))

    Di : 동판의 최소두께를 계산하는 각 부분의 안지름으로서 원추의 축에
         대하여 직각으로 측정한 값 [mm]
    half_apex_deg : θ — 원추 꼭지각의 1/2 [deg]
    """
    r = CalcResult("원추형동체 원추부 — 내압 최소두께",
                   "KGS AC111 3.3.1.1.1 (3-1) (가스안전공사)")
    _common(r, P, sigma_a, eta)
    r.add_input("Di (원추 축에 직각으로 측정한 안지름)", float(Di), "mm")
    r.add_input("θ (원추 꼭지각의 1/2)", float(half_apex_deg), "deg")

    th = math.radians(half_apex_deg)
    S = sigma_a * eta
    t = P * Di / (2.0 * math.cos(th) * (S - 0.6 * P))
    r.add_step("cos θ", "cos(꼭지각/2)", math.cos(th))
    r.add_step("t (3-1)", "P·Di/(2·cosθ·(σaη − 0.6P))", t, "mm")
    r.add_check("적용범위: 꼭지각 ≤ 45° 는 원통형으로 취급 가능 (3-1 단서 참조)",
                True)
    r.results["t"] = t
    return r


def torispherical_head_thickness(P, R, r_knuckle=None, sigma_a=None, eta=1.0,
                                 hemispherical=False, flanged_opening=False,
                                 Di_shell=None):
    """AC111 3.3.1.1.3 (1) 접시형 경판 또는 온반구형 경판의 최소두께.

      (1-1) t = P·R·W/(2σaη − 0.2P),  W = (3 + √(R/r))/4  (온반구형은 W = 1)
      (1-2) 맨홀 또는 최대지름 150 mm 를 초과하는 구멍을 **삽입플랜지**로
            보강하는 경우: t = P·R·W/(2σaη − 0.2P) + t′
            R  : (1-1) 값. 단, 동체안지름 × 0.8 미만이면 동체안지름 × 0.8
            t′ : (1-1) 최소두께 × 0.15 (3 미만이면 3)

    R : 접시형 경판 중앙부의 안쪽 반지름, 또는 온반구형 경판의
        부식여유를 제외한 안쪽 반지름 [mm]
    r_knuckle : 접시형 경판의 부식여유를 제외한 가장자리 단곡부 안쪽 반지름 [mm]
    """
    res = CalcResult(
        "접시형·온반구형 경판 — 최소두께",
        "KGS AC111 3.3.1.1.3 (1-1)"
        + (" / (1-2) 삽입플랜지 보강" if flanged_opening else "") + " (가스안전공사)")
    _common(res, P, sigma_a, eta)
    res.add_input("R (경판 중앙부 안쪽 반지름)", float(R), "mm")

    R_use = float(R)
    if flanged_opening:
        if Di_shell is None:
            raise ValueError("(1-2) 는 동체 안지름(Di_shell)이 필요")
        res.add_input("Di (동체 안지름)", float(Di_shell), "mm")
        floor_R = 0.8 * float(Di_shell)
        if R_use < floor_R:
            res.add_step("R 대체 ((1-2) 단서)", "동체안지름 × 0.8", floor_R, "mm")
            R_use = floor_R

    if hemispherical:
        W = 1.0
        res.add_step("W", "온반구형 경판은 1", W)
    else:
        if r_knuckle is None:
            raise ValueError("접시형 경판은 r_knuckle 이 필요 (온반구형은 hemispherical=True)")
        res.add_input("r (가장자리 단곡부 안쪽 반지름)", float(r_knuckle), "mm")
        W = 0.25 * (3.0 + math.sqrt(R_use / r_knuckle))
        res.add_step("W", "(3 + √(R/r))/4", W)

    S = sigma_a * eta
    t_base = P * R_use * W / (2.0 * S - 0.2 * P)
    res.add_step("t (1-1)", "P·R·W/(2σaη − 0.2P)", t_base, "mm")

    t = t_base
    if flanged_opening:
        t_prime = max(0.15 * t_base, 3.0)
        res.add_step("t′ ((1-2))", "max(0.15 × t, 3 mm)", t_prime, "mm")
        t = t_base + t_prime
        res.add_step("t (보강 가산 후)", "t + t′", t, "mm")

    res.results["W"] = W
    res.results["t"] = t
    return res


def ellipsoidal_head_thickness(P, D=None, h=None, sigma_a=None, eta=1.0,
                               D_over_2h=None, flanged_opening=False,
                               Di_shell=None):
    """AC111 3.3.1.1.3 (2) 반타원체형 경판의 최소두께.

      (2-1) t = P·D·K/(2σaη − 0.2P),  K = [2 + (D/2h)²]/6
      (2-2) 맨홀 또는 150 mm 초과 구멍을 삽입플랜지로 보강하는 경우
            t = 1.77·P·R/(2σaη − 0.2P) + t′
            R  = 그 경판이 부착되는 동체의 안지름 × 0.8
            t′ = (1-1) 식으로 구한 최소두께 × 0.15 (3 미만이면 3)

    D : 부식여유를 뺀 경판 타원체 내면의 긴지름 [mm]
    h : 부식여유를 뺀 경판 타원체 내면의 짧은 지름의 1/2 [mm]
    """
    if flanged_opening:
        if Di_shell is None:
            raise ValueError("(2-2) 는 동체 안지름(Di_shell)이 필요")
        res = CalcResult("반타원체형 경판 — 삽입플랜지 보강 구멍이 있는 경우",
                         "KGS AC111 3.3.1.1.3 (2-2) (가스안전공사)")
        _common(res, P, sigma_a, eta)
        res.add_input("Di (동체 안지름)", float(Di_shell), "mm")
        R_use = 0.8 * float(Di_shell)
        res.add_step("R", "동체안지름 × 0.8", R_use, "mm")
        S = sigma_a * eta
        t_base = 1.77 * P * R_use / (2.0 * S - 0.2 * P)
        res.add_step("t (2-2) 본항", "1.77·P·R/(2σaη − 0.2P)", t_base, "mm")
        t_prime = max(0.15 * t_base, 3.0)
        res.add_step("t′", "max(0.15 × t, 3 mm)", t_prime, "mm")
        t = t_base + t_prime
        res.add_step("t (보강 가산 후)", "t + t′", t, "mm")
        res.results["W"] = 1.77
        res.results["t"] = t
        return res

    res = CalcResult("반타원체형 경판 — 최소두께",
                     "KGS AC111 3.3.1.1.3 (2-1) (가스안전공사)")
    _common(res, P, sigma_a, eta)
    if D is None:
        raise ValueError("D (경판 내면 긴지름)가 필요")
    res.add_input("D (경판 타원체 내면 긴지름)", float(D), "mm")

    if D_over_2h is None:
        if h is None:
            raise ValueError("h 또는 D_over_2h 중 하나가 필요")
        res.add_input("h (짧은 지름의 1/2)", float(h), "mm")
        ratio = float(D) / (2.0 * float(h))
    else:
        ratio = float(D_over_2h)
    res.add_step("D/2h", "긴지름/(2h)", ratio)

    K = (2.0 + ratio ** 2) / 6.0
    res.add_step("K", "[2 + (D/2h)²]/6", K)

    S = sigma_a * eta
    t = P * float(D) * K / (2.0 * S - 0.2 * P)
    res.add_step("t (2-1)", "P·D·K/(2σaη − 0.2P)", t, "mm")

    res.results["K"] = K
    res.results["t"] = t
    return res


def conical_head_thickness(P, Di=None, apex_deg=None, sigma_a=None, eta=1.0,
                           Do=None, r_corner=None):
    """AC111 3.3.1.1.4 내면에 압력을 받는 원추형 경판의 최소두께.

      (1) 꼭지각 ≤ 140° : t = P·Di/(2·cosθ·(σaη − 0.6P))   (θ = 꼭지각/2)
      (2) 꼭지각 > 140° : (1) 식(=3.3.1.1.1(3-1))으로 구한 값과
                          t = 0.5·(Do − r)·(θ/90)·√(P/(σaη))
                          중 **작은 값**

    apex_deg : 원추 꼭지각 (θ 가 아니라 꼭지각 전체) [deg]
    Do : 원추의 큰 쪽 지름 끝에서의 바깥지름 [mm]  ((2) 에서만 필요)
    r_corner : 부식여유를 뺀 원추 큰 쪽 지름 끝 둥근 부분의 안쪽 반지름 [mm]
    """
    if apex_deg is None:
        raise ValueError("apex_deg (원추 꼭지각)이 필요")
    over140 = apex_deg > 140.0
    res = CalcResult(
        "원추형 경판 — 내압 최소두께",
        f"KGS AC111 3.3.1.1.4 ({'2' if over140 else '1'}) (가스안전공사)")
    _common(res, P, sigma_a, eta)
    res.add_input("꼭지각", float(apex_deg), "deg")

    theta = apex_deg / 2.0
    res.add_step("θ (꼭지각/2)", "꼭지각 ÷ 2", theta, "deg")
    S = sigma_a * eta

    if Di is None:
        raise ValueError("Di (원추 축에 직각으로 측정한 안지름)가 필요")
    res.add_input("Di (원추 축에 직각으로 측정한 안지름)", float(Di), "mm")
    t1 = P * Di / (2.0 * math.cos(math.radians(theta)) * (S - 0.6 * P))
    res.add_step("t — (1) 식", "P·Di/(2·cosθ·(σaη − 0.6P))", t1, "mm")

    if not over140:
        res.results["t"] = t1
        res.results["governing"] = "cone_formula"
        return res

    if Do is None or r_corner is None:
        raise ValueError("꼭지각 > 140° 는 Do 와 r_corner 가 필요")
    res.add_input("Do (큰 쪽 지름 끝 바깥지름)", float(Do), "mm")
    res.add_input("r (큰 쪽 지름 끝 둥근 부분 안쪽 반지름)", float(r_corner), "mm")
    t2 = 0.5 * (Do - r_corner) * (theta / 90.0) * math.sqrt(P / S)
    res.add_step("t — (2) 식", "0.5·(Do − r)·(θ/90)·√(P/(σaη))", t2, "mm")

    t = min(t1, t2)
    res.add_step("t (작은 값)", "min((1) 식, (2) 식)", t, "mm")
    res.results["t"] = t
    res.results["governing"] = "cone_formula" if t1 <= t2 else "flat_like_formula"
    return res

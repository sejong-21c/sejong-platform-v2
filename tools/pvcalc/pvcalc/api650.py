"""API 650 — 상압 용접 강제 저장탱크 (Welded Tanks for Oil Storage).

구현 근거: API Standard 650, 13th Edition (2021 문서) 원문
  5.6.1.1  필요 셸 두께 = max(설계두께(CA 포함), 수압시험두께),
           단 호칭지름별 최소 호칭두께 이상
  5.6.3    1-Foot Method — 각 단(course) 하단에서 0.3 m (1 ft) 위 지점 기준
  5.6.3.1  적용 제한: 지름 61 m (200 ft) 초과 탱크에는 사용 금지
  5.6.4    Variable-Design-Point Method — 변동설계점법 (큰 지름 탱크)
  5.6.4.1  적용조건 L/H ≤ 1000/6 (SI) · 2 (USC), L = (500·D·t)^0.5 · (6·D·t)^0.5
  5.6.4.4  최하단 단 t1d · t1t (각각 tpd · tpt 를 넘을 필요 없음)
  5.6.4.5  둘째 단 — h1/(r·t1)^0.5 비에 따라 t1 / t2a / 보간
  5.6.4.6~8 상단 단 — 변동설계점 x = min(x1, x2, x3), tx 반복수렴 (통상 2회)

검증 앵커 — 원문 Annex K.1 공표 예제 (D=85 m, H=19.2 m, St=208 MPa, 수압시험)
  t1 = 37.15 mm 를 소수 둘째자리까지 재현한다. 중간값 0.3081·0.3038·38.45 도 일치.
  **이 앵커 테스트를 깨뜨리지 말 것.**

⚠ ASME 압력용기와 근본적으로 다르다
   - 두께가 설계압력이 아니라 **저장액 정수두**로 결정된다
   - 따라서 **단(course)마다 두께가 다르다** — 위로 갈수록 얇아진다
   - 설계조건(td)과 수압시험조건(tt) 두 가지를 각각 계산해 큰 값을 쓴다

미구현
   - 바닥판·애뉼러 플레이트 (5.4, 5.5 / Table 5.1a·5.1b 는 저작권 표)
   - 지붕(5.10), 보강링(5.9), 풍·지진(5.11, Annex E), 앵커
   - Annex A 대체 설계(고정 허용응력 145 MPa, 이음효율 0.85/0.70, t ≤ 13 mm)

⚠ 허용응력 Sd·St 는 원문 Table 5.2a/5.2b 값이며 **저작권 자료다.**
   이 모듈은 담지 않는다 — 사용자가 licensed 사본에서 직접 입력한다.
   ASME Sec II-D 를 내장하지 않는 것과 같은 원칙.

단위계
  units="SI"  : D[m],  H[m],  CA[mm], Sd·St[MPa],     t[mm]   계수 4.9, 기준높이 0.3
  units="USC" : D[ft], H[ft], CA[in], Sd·St[lbf/in²], t[in]   계수 2.6, 기준높이 1
"""

from .report import CalcResult

# 5.6.1.1 호칭지름별 최소 호칭두께. (지름 상한, 두께) — 상한 이하이면 그 두께.
_MIN_T_SI = [(15.0, 5.0), (36.0, 6.0), (60.0, 8.0), (float("inf"), 10.0)]
_MIN_T_USC = [(50.0, 3.0 / 16.0), (120.0, 1.0 / 4.0), (200.0, 5.0 / 16.0),
              (float("inf"), 3.0 / 8.0)]

# 5.6.3.1 1-Foot Method 적용 상한 지름
MAX_D_ONE_FOOT = {"SI": 61.0, "USC": 200.0}
# 5.6.1.1 NOTE 4 — 이 지름 구간에서는 최하단 단의 최소 호칭두께가 6 mm (1/4 in.)
_NOTE4 = {"SI": (3.2, 15.0, 6.0), "USC": (10.5, 50.0, 1.0 / 4.0)}


def _cfg(units):
    u = str(units).upper()
    if u == "SI":
        return dict(k=4.9, href=0.3, len_u="m", t_u="mm", s_u="MPa",
                    table=_MIN_T_SI, note4=_NOTE4["SI"], maxD=61.0)
    if u == "USC":
        return dict(k=2.6, href=1.0, len_u="ft", t_u="in", s_u="lbf/in²",
                    table=_MIN_T_USC, note4=_NOTE4["USC"], maxD=200.0)
    raise ValueError("units 는 'SI' 또는 'USC'")


def min_nominal_thickness(D, units="SI", lowest_course=False):
    """5.6.1.1 호칭지름에 따른 최소 호칭두께.

    D : 호칭 탱크 지름 (NOTE 1 — 별도 지정이 없으면 최하단 셸 단 판의
        중심선 지름)
    lowest_course=True 이면 NOTE 4 를 적용한다 — 지름이 15 m (50 ft) 미만이고
        3.2 m (10.5 ft) 초과인 탱크의 **최하단 단**은 6 mm (1/4 in.) 이상.
    """
    c = _cfg(units)
    # 표의 구간은 "< 15", "15 to < 36", "36 to 60", "> 60" — 마지막만 경계 포함
    if str(units).upper() == "SI":
        t = 5.0 if D < 15.0 else 6.0 if D < 36.0 else 8.0 if D <= 60.0 else 10.0
    else:
        t = (3.0 / 16.0 if D < 50.0 else 1.0 / 4.0 if D < 120.0
             else 5.0 / 16.0 if D <= 200.0 else 3.0 / 8.0)
    if lowest_course:
        lo, hi, tn4 = c["note4"]
        if lo < D < hi:
            t = max(t, tn4)
    return t


def shell_course_thickness(D, H, G, Sd, St, CA=0.0, units="SI",
                           lowest_course=False, course_label=""):
    """5.6.3 1-Foot Method — 셸 한 단(course)의 필요 두께.

    D  : 호칭 탱크 지름 [m | ft]
    H  : 설계 액면 높이 [m | ft] — **검토 대상 단의 하단에서** 셸 상단(탑앵글
         포함)·오버플로 하단·발주자 지정 액면까지의 높이
    G  : 설계 비중 (발주자 지정)
    Sd : 설계조건 허용응력 [MPa | lbf/in²]  (원문 5.6.2.1 / Table 5.2)
    St : 수압시험조건 허용응력 [MPa | lbf/in²] (원문 5.6.2.2 / Table 5.2)
    CA : 부식여유 [mm | in]

        td = k·D·(H − href)·G / Sd + CA     (설계조건, CA 포함)
        tt = k·D·(H − href) / St            (수압시험조건, CA 없음)
        SI  : k = 4.9, href = 0.3
        USC : k = 2.6, href = 1

    필요 두께는 td·tt 중 큰 값이며, 5.6.1.1 최소 호칭두께 이상이어야 한다.
    """
    c = _cfg(units)
    r = CalcResult(f"셸 단 두께 — 1-Foot Method{(' · ' + course_label) if course_label else ''}",
                   "API Standard 650, 5.6.3 (1-Foot Method) / 5.6.1.1")
    r.add_input("D (호칭 탱크 지름)", float(D), c["len_u"])
    r.add_input("H (설계 액면 — 단 하단부터)", float(H), c["len_u"])
    r.add_input("G (설계 비중)", float(G))
    r.add_input("Sd (설계조건 허용응력)", float(Sd), c["s_u"])
    r.add_input("St (수압시험조건 허용응력)", float(St), c["s_u"])
    r.add_input("CA (부식여유)", float(CA), c["t_u"])

    head = float(H) - c["href"]
    r.add_step("H − 기준높이", f"H − {c['href']:g} ({c['len_u']}) — 단 하단에서 0.3 m(1 ft) 위 지점",
               head, c["len_u"])

    td = c["k"] * D * head * G / Sd + CA
    tt = c["k"] * D * head / St
    r.add_step("td (설계조건)", f"{c['k']}·D·(H−{c['href']:g})·G/Sd + CA", td, c["t_u"])
    r.add_step("tt (수압시험조건)", f"{c['k']}·D·(H−{c['href']:g})/St", tt, c["t_u"])

    t_calc = max(td, tt)
    r.add_step("계산 필요두께", "max(td, tt)", t_calc, c["t_u"])

    t_min = min_nominal_thickness(D, units, lowest_course)
    r.add_step("최소 호칭두께 (5.6.1.1)",
               "호칭지름 구간별" + (" + NOTE 4 (최하단 단)" if lowest_course else ""),
               t_min, c["t_u"])

    t_req = max(t_calc, t_min)
    r.add_check(f"1-Foot Method 적용범위: D ≤ {c['maxD']:g} {c['len_u']} (5.6.3.1)",
                D <= c["maxD"])
    r.add_check("H > 기준높이 (단 높이가 0.3 m/1 ft 를 넘어야 함)", head > 0)
    r.add_check("계산두께가 최소 호칭두께 이상 (5.6.1.1)", t_calc <= t_req)

    r.results["td"] = td
    r.results["tt"] = tt
    r.results["t_min_nominal"] = t_min
    r.results["t_required"] = t_req
    r.results["governing"] = ("hydrostatic_test" if tt > td else "product_design") \
        if t_calc >= t_min else "minimum_nominal"
    return r


def shell_courses(D, course_heights, H_design, G, Sd, St, CA=0.0, units="SI"):
    """탱크 전체 셸을 단별로 계산한다 (아래에서 위로).

    course_heights : 각 단의 높이 리스트, **최하단부터** [m | ft]
    H_design       : 탱크 바닥 기준 설계 액면 높이 [m | ft]
    Sd, St         : 스칼라이면 전 단 공통, 리스트이면 단별 값
                     (단마다 재질이 다른 설계를 지원)

    각 단의 H 는 「그 단 하단에서 설계 액면까지」이므로
        H_i = H_design − (그 단 하단의 높이)
    액면 아래에 없는 단은 최소 호칭두께만 적용된다.

    반환: (단별 CalcResult 리스트, 요약 CalcResult)
    """
    c = _cfg(units)
    n = len(course_heights)
    if n == 0:
        raise ValueError("course_heights 가 비어 있습니다")
    Sd_list = list(Sd) if isinstance(Sd, (list, tuple)) else [Sd] * n
    St_list = list(St) if isinstance(St, (list, tuple)) else [St] * n
    if len(Sd_list) != n or len(St_list) != n:
        raise ValueError("Sd·St 리스트 길이가 단 수와 다릅니다")

    results, z = [], 0.0
    for i, h in enumerate(course_heights):
        H_i = H_design - z
        label = f"{i + 1}단 (하단 z={z:g} {c['len_u']})"
        if H_i - c["href"] <= 0:
            # 액면 위 단 — 정수두 없음, 최소 호칭두께만
            r = CalcResult(f"셸 단 두께 — {label}", "API Standard 650, 5.6.1.1")
            r.add_input("D (호칭 탱크 지름)", float(D), c["len_u"])
            r.add_input("H (설계 액면 — 단 하단부터)", float(H_i), c["len_u"])
            t_min = min_nominal_thickness(D, units, lowest_course=(i == 0))
            r.add_step("정수두 없음", "이 단은 설계 액면 위 — 최소 호칭두께만 적용", 0.0)
            r.add_step("최소 호칭두께 (5.6.1.1)", "호칭지름 구간별", t_min, c["t_u"])
            r.results["td"] = 0.0
            r.results["tt"] = 0.0
            r.results["t_min_nominal"] = t_min
            r.results["t_required"] = t_min
            r.results["governing"] = "minimum_nominal"
        else:
            r = shell_course_thickness(D, H_i, G, Sd_list[i], St_list[i], CA,
                                       units, lowest_course=(i == 0),
                                       course_label=label)
        results.append(r)
        z += h

    total_h = sum(course_heights)
    s = CalcResult("셸 단별 필요두께 요약", "API Standard 650, 5.6.3 / 5.6.1.1")
    s.add_input("D (호칭 탱크 지름)", float(D), c["len_u"])
    s.add_input("셸 전체 높이", float(total_h), c["len_u"])
    s.add_input("H_design (바닥 기준 설계 액면)", float(H_design), c["len_u"])
    s.add_input("단 수", n)
    s.add_input("G (설계 비중)", float(G))
    s.add_input("CA (부식여유)", float(CA), c["t_u"])
    for i, r in enumerate(results):
        s.add_step(f"{i + 1}단 필요두께", r.results["governing"],
                   r.results["t_required"], c["t_u"])
    s.add_check("설계 액면이 셸 전체 높이를 넘지 않음", H_design <= total_h)
    s.add_check(f"1-Foot Method 적용범위: D ≤ {c['maxD']:g} {c['len_u']}", D <= c["maxD"])
    s.add_check("아래 단이 위 단보다 두껍거나 같음 (5.6.1.3 취지)",
                all(results[i].results["t_required"] >= results[i + 1].results["t_required"]
                    for i in range(n - 1)))
    s.results["t_bottom"] = results[0].results["t_required"]
    s.results["t_top"] = results[-1].results["t_required"]
    s.results["courses"] = float(n)
    return results, s


# ==========================================================================
# 5.6.4 Variable-Design-Point Method (변동설계점법)
# ==========================================================================
# 설계조건과 수압시험조건을 **완전히 독립적으로** 계산한다 (5.6.4.2).
# 수압시험조건은 설계조건 식에서 G = 1, CA = 0 으로 둔 것과 같으므로
# 같은 패스 함수를 두 번 돌린다.
#
# ⚠ x·tu·tL 은 모두 **부식여유를 뺀(corroded)** 두께로 다룬다. 설계조건
#    결과에만 마지막에 CA 를 더한다 — 원문이 그렇게 정의한다.


def vdp_applicability(D, t_bottom_corroded, H, units="SI"):
    """5.6.4.1 변동설계점법 적용조건.

        SI  : L = (500·D·t)^0.5 [mm],  L/H ≤ 1000/6
        USC : L = (6·D·t)^0.5   [in],  L/H ≤ 2

    t_bottom_corroded : 최하단 단의 부식여유를 뺀 두께 [mm | in]
    """
    c = _cfg(units)
    si = str(units).upper() == "SI"
    r = CalcResult("변동설계점법 적용조건", "API Standard 650, 5.6.4.1")
    r.add_input("D (탱크 지름)", float(D), c["len_u"])
    r.add_input("t (최하단 단 부식 후 두께)", float(t_bottom_corroded), c["t_u"])
    r.add_input("H (최대 설계 액면)", float(H), c["len_u"])

    L = ((500.0 if si else 6.0) * D * t_bottom_corroded) ** 0.5
    limit = (1000.0 / 6.0) if si else 2.0
    ratio = L / H
    r.add_step("L", "(500·D·t)^0.5" if si else "(6·D·t)^0.5", L, c["t_u"])
    r.add_step("L/H", "L / H", ratio)
    r.add_step("허용 상한", "1000/6" if si else "2", limit)
    r.add_check("L/H <= 상한 (5.6.4.1)", ratio <= limit)
    r.results["L"] = L
    r.results["L_over_H"] = ratio
    r.results["limit"] = limit
    return r


def _one_foot(c, D, H, G, S):
    """5.6.3.2 예비값 (부식여유 제외). tpd·tpt·tu 계산에 공통으로 쓴다."""
    return c["k"] * D * (H - c["href"]) * G / S


def _vdp_bottom(c, D, H, G, S):
    """5.6.4.4 최하단 단 (부식여유 제외). tp 를 넘을 필요 없다 (NOTE)."""
    coef = 0.0696 if c["k"] == 4.9 else 0.463
    t1_raw = (1.06 - (coef * D / H) * (H * G / S) ** 0.5) * (c["k"] * H * D * G / S)
    tp = _one_foot(c, D, H, G, S)
    return min(t1_raw, tp), t1_raw, tp, coef


def _vdp_upper(c, D, H_course, G, S, tL, iterations=2):
    """5.6.4.6~8 상단 단 (부식여유 제외).

    H_course : 그 단 하단 기준 설계 액면
    tL       : 바로 아래 단의 거스조인트에서의 부식 후 두께
    반환: (tx, 상세 스텝 리스트)
    """
    si = c["k"] == 4.9
    conv = 1000.0 if si else 12.0        # 길이단위 -> 두께단위
    tu = _one_foot(c, D, H_course, G, S)  # 예비값
    steps = [("tu 예비값 (5.6.3.2)", "1-Foot 식", tu)]
    r_nom = D * conv / 2.0                # 공칭 반지름 [mm | in]
    tx = tu
    for it in range(1, iterations + 1):
        K = tL / tu
        C = (K ** 0.5 * (K - 1.0)) / (1.0 + K ** 1.5)
        rt = (r_nom * tu) ** 0.5
        x1 = 0.61 * rt + (320.0 if si else 3.84) * C * H_course
        x2 = conv * C * H_course
        x3 = 1.22 * rt
        x = min(x1, x2, x3)
        tx = c["k"] * D * (H_course - x / conv) * G / S
        steps += [
            ("[%d] K = tL/tu" % it, "아래 단 두께 / 이 단 두께", K),
            ("[%d] C" % it, "[K^0.5*(K-1)]/(1+K^1.5)", C),
            ("[%d] x1" % it, "0.61*(r*tu)^0.5 + 320*C*H" if si
             else "0.61*(r*tu)^0.5 + 3.84*C*H", x1),
            ("[%d] x2" % it, "1000*C*H" if si else "12*C*H", x2),
            ("[%d] x3" % it, "1.22*(r*tu)^0.5", x3),
            ("[%d] x = min(x1,x2,x3)" % it, "변동설계점 위치", x),
            ("[%d] tx" % it, "k*D*(H - x/1000)*G/S" if si
             else "k*D*(H - x/12)*G/S", tx),
        ]
        tu = tx                            # 5.6.4.8 반복
    return tx, steps


def vdp_courses(D, course_heights, H_design, G, Sd, St, CA=0.0, units="SI",
                iterations=2):
    """5.6.4 변동설계점법으로 셸 전체를 단별 계산한다.

    설계조건·수압시험조건을 독립적으로 계산하고, 각 단의 필요두께는
    max(설계두께+CA, 수압시험두께) 이며 5.6.1.1 최소 호칭두께 이상이어야 한다.

    반환: (단별 CalcResult 리스트, 요약 CalcResult)
    """
    c = _cfg(units)
    n = len(course_heights)
    if n == 0:
        raise ValueError("course_heights 가 비어 있습니다")
    Sd_list = list(Sd) if isinstance(Sd, (list, tuple)) else [Sd] * n
    St_list = list(St) if isinstance(St, (list, tuple)) else [St] * n
    if len(Sd_list) != n or len(St_list) != n:
        raise ValueError("Sd·St 리스트 길이가 단 수와 다릅니다")

    si = c["k"] == 4.9
    conv = 1000.0 if si else 12.0
    r_nom = D * conv / 2.0

    def run(G_pass, S_list):
        """한 조건(설계 또는 수압시험)에 대한 전 단 두께 — 부식여유 제외."""
        out, z = [], 0.0
        for i in range(n):
            H_i = H_design - z
            S = S_list[i]
            if H_i - c["href"] <= 0:
                out.append((0.0, [("정수두 없음", "설계 액면 위 단", 0.0)]))
                z += course_heights[i]
                continue
            if i == 0:
                t1, t1_raw, tp, coef = _vdp_bottom(c, D, H_i, G_pass, S)
                out.append((t1, [
                    ("t1 (5.6.4.4)", "(1.06 - (c*D/H)*sqrt(H*G/S))*(k*H*D*G/S)", t1_raw),
                    ("tp (5.6.3.2)", "1-Foot 예비값", tp),
                    ("t1 = min(t1, tp)", "NOTE - tp 를 넘을 필요 없음", t1),
                ]))
            elif i == 1:
                t1 = out[0][0]
                h1 = course_heights[0] * conv           # [mm | in]
                t2a, up_steps = _vdp_upper(c, D, H_i, G_pass, S, t1, iterations)
                ratio = h1 / ((r_nom * t1) ** 0.5)
                if ratio <= 1.375:
                    t2, how = t1, "비 <= 1.375 -> t2 = t1"
                elif ratio >= 2.625:
                    t2, how = t2a, "비 >= 2.625 -> t2 = t2a"
                else:
                    t2 = t2a + (t1 - t2a) * (2.1 - h1 / (1.25 * (r_nom * t1) ** 0.5))
                    how = "1.375 < 비 < 2.625 -> 보간"
                out.append((t2, up_steps + [
                    ("h1/(r*t1)^0.5", "둘째 단 판정 비 (5.6.4.5)", ratio),
                    ("t2a", "상단 단 절차로 구한 값", t2a),
                    ("t2", how, t2),
                ]))
            else:
                tL = out[i - 1][0]
                tx, up_steps = _vdp_upper(c, D, H_i, G_pass, S, tL, iterations)
                out.append((tx, up_steps))
            z += course_heights[i]
        return out

    design = run(G, Sd_list)
    hydro = run(1.0, St_list)

    results, z = [], 0.0
    for i in range(n):
        H_i = H_design - z
        r = CalcResult(
            "셸 단 두께 - 변동설계점법 · %d단 (하단 z=%g %s)" % (i + 1, z, c["len_u"]),
            "API Standard 650, 5.6.4 / 5.6.1.1")
        r.add_input("D (탱크 지름)", float(D), c["len_u"])
        r.add_input("H (이 단 하단 기준 설계 액면)", float(H_i), c["len_u"])
        r.add_input("G (설계 비중)", float(G))
        r.add_input("Sd", float(Sd_list[i]), c["s_u"])
        r.add_input("St", float(St_list[i]), c["s_u"])
        r.add_input("CA (부식여유)", float(CA), c["t_u"])
        for name, formula, val in design[i][1]:
            r.add_step("설계: " + name, formula, val)
        for name, formula, val in hydro[i][1]:
            r.add_step("시험: " + name, formula, val)

        td = design[i][0] + CA if design[i][0] > 0 else 0.0
        tt = hydro[i][0]
        r.add_step("td (설계, CA 포함)", "설계조건 두께 + CA", td, c["t_u"])
        r.add_step("tt (수압시험)", "수압시험조건 두께", tt, c["t_u"])
        t_calc = max(td, tt)
        t_min = min_nominal_thickness(D, units, lowest_course=(i == 0))
        r.add_step("최소 호칭두께 (5.6.1.1)", "호칭지름 구간별", t_min, c["t_u"])
        t_req = max(t_calc, t_min)
        r.add_check("H > 기준높이", H_i - c["href"] > 0 or t_calc == 0.0)
        r.results["td"] = td
        r.results["tt"] = tt
        r.results["t_min_nominal"] = t_min
        r.results["t_required"] = t_req
        r.results["governing"] = (
            "minimum_nominal" if t_calc < t_min
            else "hydrostatic_test" if tt > td else "product_design")
        results.append(r)
        z += course_heights[i]

    total_h = sum(course_heights)
    s = CalcResult("셸 단별 필요두께 요약 - 변동설계점법",
                   "API Standard 650, 5.6.4 / 5.6.1.1")
    s.add_input("D (탱크 지름)", float(D), c["len_u"])
    s.add_input("셸 전체 높이", float(total_h), c["len_u"])
    s.add_input("H_design (바닥 기준 설계 액면)", float(H_design), c["len_u"])
    s.add_input("단 수", n)
    s.add_input("반복 횟수 (5.6.4.8)", iterations)
    for i, r in enumerate(results):
        s.add_step("%d단 필요두께" % (i + 1), r.results["governing"],
                   r.results["t_required"], c["t_u"])
    app = vdp_applicability(D, results[0].results["t_required"] - CA, H_design, units)
    s.add_check("5.6.4.1 적용조건 L/H <= 상한", app.ok)
    s.add_check("설계 액면이 셸 전체 높이를 넘지 않음", H_design <= total_h)
    s.add_check("아래 단이 위 단보다 두껍거나 같음",
                all(results[i].results["t_required"]
                    >= results[i + 1].results["t_required"] for i in range(n - 1)))
    s.results["t_bottom"] = results[0].results["t_required"]
    s.results["t_top"] = results[-1].results["t_required"]
    s.results["courses"] = float(n)
    s.results["L_over_H"] = app.results["L_over_H"]
    return results, s

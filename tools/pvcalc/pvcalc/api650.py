"""API 650 — 상압 용접 강제 저장탱크 (Welded Tanks for Oil Storage).

구현 근거: API Standard 650, 13th Edition (2021 문서) 원문
  5.6.1.1  필요 셸 두께 = max(설계두께(CA 포함), 수압시험두께),
           단 호칭지름별 최소 호칭두께 이상
  5.6.3    1-Foot Method — 각 단(course) 하단에서 0.3 m (1 ft) 위 지점 기준
  5.6.3.1  적용 제한: 지름 61 m (200 ft) 초과 탱크에는 사용 금지

⚠ ASME 압력용기와 근본적으로 다르다
   - 두께가 설계압력이 아니라 **저장액 정수두**로 결정된다
   - 따라서 **단(course)마다 두께가 다르다** — 위로 갈수록 얇아진다
   - 설계조건(td)과 수압시험조건(tt) 두 가지를 각각 계산해 큰 값을 쓴다

미구현
   - 5.6.4 Variable-Design-Point Method (반복계산, 큰 지름 탱크용)
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

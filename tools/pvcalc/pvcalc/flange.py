"""Bolted flange connections with gaskets — ASME VIII-1 Mandatory App. 2.

Two calls, chained like the nozzle pair: :func:`flange_bolt_loads` sizes the
bolting and hands its geometry to :func:`flange_stresses`, which computes the
flange moments and the three App. 2-7 stresses.

Scope / limitations (see README):
  * Circular flanges with a ring-type gasket entirely inside the bolt circle
    (App. 2-3 "full-face" gaskets and App. 2-6(g) split flanges are NOT
    covered), internal pressure only.
  * Two attachment families: integral (Fig. 2-4 sketches 1-4c) and loose
    without hub (plain ring, sketches 5-7 with no hub). Optional-type
    flanges (sketches 8-12a) are calculated as whichever the designer
    elects.
  * NOT covered: loose flanges WITH a hub — those need F_L and V_L from
    Table 2-7.1, which could not be verified against a published anchor
    (see comparison/App2_verification.md). Also not covered: external
    pressure (App. 2-11), flange rigidity index (App. 2-14), reverse
    flanges (App. 2-13), bolt spacing/PCC-1, external piping loads, and
    App. Y metal-to-metal contact.
  * Gasket factors m, y (Table 2-5.1) and all allowable stresses are user
    input — Sec II-D and Table 2-5.1 are copyrighted, nothing is bundled.

Units: any single consistent set, EXCEPT that the effective gasket seating
width b uses a dimensional constant, so `units="SI"` (mm) or `"US"` (in)
must be stated.
"""

import math

from .report import CalcResult

# App. 2-5(c)(1): b = 0.5*sqrt(b_o) with b_o in inches. The SI form of the
# same rule is b = 2.52*sqrt(b_o) with b_o in mm (0.5*sqrt(25.4) = 2.52).
B_COEF_US = 0.5
B_COEF_SI = 2.52
BO_LIMIT_US = 0.25      # in
BO_LIMIT_SI = 6.35      # mm

INTEGRAL, RING = "integral", "ring"
FLANGE_TYPES = (INTEGRAL, RING)


def figure_2_7_1(K):
    """Fig. 2-7.1 shape factors T, U, Y, Z as functions of K = A/B.

    App. 2 gives these as closed-form equations, so no chart digitising is
    involved. Valid for K > 1.
    """
    if K <= 1.0:
        raise ValueError("K = A/B must exceed 1.0")
    log_k = math.log10(K)
    k2 = K * K
    common = k2 * (1.0 + 8.55246 * log_k) - 1.0
    T = common / ((1.04720 + 1.9448 * k2) * (K - 1.0))
    U = common / (1.36136 * (k2 - 1.0) * (K - 1.0))
    Y = (1.0 / (K - 1.0)) * (0.66845 + 5.71690 * (k2 * log_k) / (k2 - 1.0))
    Z = (k2 + 1.0) / (k2 - 1.0)
    return T, U, Y, Z


def table_2_7_1(g0, g1, h, h0):
    """Table 2-7.1 hub factors F, V and f for an integral-type flange.

    The 37-constant closed-form chain of Table 2-7.1. Returns a dict with
    F, V, f plus the intermediates A and C. The loose-flange factors F_L and
    V_L are deliberately NOT returned — see the module docstring.

    Verification: for a straight hub (g1 = g0, i.e. A = 0) App. 2 gives the
    published values F = 0.908920 and V = 0.550103 independent of h/h0. This
    implementation reproduces them to within 0.05% for any C — see
    comparison/App2_verification.md for the residual and why it does not
    matter (F and V enter the stresses only through e = F/h0 and
    d = (U/V)*h0*g0**2).
    """
    if min(g0, g1, h, h0) <= 0.0:
        raise ValueError("g0, g1, h and h0 must all be positive")
    A = g1 / g0 - 1.0
    C = 43.68 * (h / h0) ** 4.0

    C1 = 1.0 / 3.0 + A / 12.0
    C2 = 5.0 / 42.0 + 17.0 * A / 336.0
    C3 = 1.0 / 210.0 + A / 360.0
    C4 = 11.0 / 360.0 + 59.0 * A / 5040.0 + (1.0 + 3.0 * A) / C
    C5 = 1.0 / 90.0 + 5.0 * A / 1008.0 - ((1.0 + A) ** 3) / C
    C6 = 1.0 / 120.0 + 17.0 * A / 5040.0 + 1.0 / C
    C7 = (215.0 / 2772.0 + 51.0 * A / 1232.0
          + (60.0 / 7.0 + 225.0 * A / 14.0 + 75.0 * A ** 2 / 7.0
             + 5.0 * A ** 3 / 2.0) / C)
    C8 = (31.0 / 6930.0 + 128.0 * A / 45045.0
          + (6.0 / 7.0 + 15.0 * A / 7.0 + 12.0 * A ** 2 / 7.0
             + 5.0 * A ** 3 / 11.0) / C)
    C9 = (533.0 / 30240.0 + 653.0 * A / 73920.0
          + (0.5 + 33.0 * A / 14.0 + 39.0 * A ** 2 / 28.0
             + 25.0 * A ** 3 / 84.0) / C)
    C10 = (29.0 / 3780.0 + 3.0 * A / 704.0
           - (0.5 + 33.0 * A / 14.0 + 81.0 * A ** 2 / 28.0
              + 13.0 * A ** 3 / 12.0) / C)
    C11 = (31.0 / 6048.0 + 1763.0 * A / 665280.0
           + (0.5 + 6.0 * A / 7.0 + 15.0 * A ** 2 / 28.0
              + 5.0 * A ** 3 / 42.0) / C)
    C12 = (1.0 / 2925.0 + 71.0 * A / 300300.0
           + (8.0 / 35.0 + 18.0 * A / 35.0 + 156.0 * A ** 2 / 385.0
              + 6.0 * A ** 3 / 55.0) / C)
    C13 = (761.0 / 831600.0 + 937.0 * A / 1663200.0
           + (1.0 / 35.0 + 6.0 * A / 35.0 + 11.0 * A ** 2 / 70.0
              + 3.0 * A ** 3 / 70.0) / C)
    C14 = (197.0 / 415800.0 + 103.0 * A / 332640.0
           - (1.0 / 35.0 + 6.0 * A / 35.0 + 17.0 * A ** 2 / 70.0
              + A ** 3 / 10.0) / C)
    C15 = (233.0 / 831600.0 + 97.0 * A / 554400.0
           + (1.0 / 35.0 + 3.0 * A / 35.0 + A ** 2 / 14.0
              + 2.0 * A ** 3 / 105.0) / C)

    C16 = (C1 * C7 * C12 + C2 * C8 * C3 + C3 * C8 * C2
           - (C3 ** 2 * C7 + C8 ** 2 * C1 + C2 ** 2 * C12))
    C17 = (C4 * C7 * C12 + C2 * C8 * C13 + C3 * C8 * C9
           - (C13 * C7 * C3 + C8 ** 2 * C4 + C12 * C2 * C9)) / C16
    C18 = (C5 * C7 * C12 + C2 * C8 * C14 + C3 * C8 * C10
           - (C14 * C7 * C3 + C8 ** 2 * C5 + C12 * C2 * C10)) / C16
    C19 = (C6 * C7 * C12 + C2 * C8 * C15 + C3 * C8 * C11
           - (C15 * C7 * C3 + C8 ** 2 * C6 + C12 * C2 * C11)) / C16
    C20 = (C1 * C9 * C12 + C4 * C8 * C3 + C3 * C13 * C2
           - (C13 * C8 * C1 + C3 ** 2 * C9 + C12 * C4 * C2)) / C16
    C21 = (C1 * C10 * C12 + C5 * C8 * C3 + C3 * C14 * C2
           - (C14 * C8 * C1 + C3 ** 2 * C10 + C12 * C5 * C2)) / C16
    C22 = (C1 * C11 * C12 + C6 * C8 * C3 + C3 * C15 * C2
           - (C15 * C8 * C1 + C3 ** 2 * C11 + C12 * C6 * C2)) / C16
    C23 = (C1 * C7 * C13 + C2 * C9 * C3 + C4 * C8 * C2
           - (C3 * C7 * C4 + C2 ** 2 * C13 + C8 * C9 * C1)) / C16
    C24 = (C1 * C7 * C14 + C2 * C10 * C3 + C5 * C8 * C2
           - (C3 * C7 * C5 + C2 ** 2 * C14 + C8 * C10 * C1)) / C16
    C25 = (C1 * C7 * C15 + C2 * C11 * C3 + C6 * C8 * C2
           - (C3 * C7 * C6 + C2 ** 2 * C15 + C8 * C11 * C1)) / C16

    C26 = -((C / 4.0) ** 0.25)
    C27 = C20 - C17 - 5.0 / 12.0 + C17 * C26
    C28 = C22 - C19 - 1.0 / 12.0 + C19 * C26
    C29 = -math.sqrt(C / 4.0)
    C30 = -((C / 4.0) ** 0.75)
    C31 = 3.0 * A / 2.0 - C17 * C30
    C32 = 0.5 - C19 * C30
    C33 = (0.5 * C26 * C32 + C28 * C31 * C29
           - (0.5 * C30 * C28 + C32 * C27 * C29))
    C34 = 1.0 / 12.0 + C18 - C21 - C18 * C26
    C35 = -C18 * (C / 4.0) ** 0.75
    C36 = (C28 * C35 * C29 - C32 * C34 * C29) / C33
    C37 = (0.5 * C26 * C35 + C34 * C31 * C29
           - (0.5 * C30 * C34 + C35 * C27 * C29)) / C33

    E1 = C17 * C36 + C18 + C19 * C37
    E2 = C20 * C36 + C21 + C22 * C37
    E3 = C23 * C36 + C24 + C25 * C37
    E4 = 0.25 + C37 / 12.0 + C36 / 4.0 - E3 / 5.0 - 3.0 * E2 / 2.0 - E1
    E5 = (E1 * (0.5 + A / 6.0) + E2 * (0.25 + 11.0 * A / 84.0)
          + E3 * (1.0 / 70.0 + A / 105.0))
    E6 = (E5 - C36 * (7.0 / 120.0 + A / 36.0 + 3.0 * A / C)
          - 1.0 / 40.0 - A / 72.0
          - C37 * (1.0 / 60.0 + A / 120.0 + 1.0 / C))

    den_f = ((C / 2.73) ** 0.25) * (((1.0 + A) ** 3) / C)
    den_v = ((2.73 / C) ** 0.25) * ((1.0 + A) ** 3)
    # F and V are defined positive; the E6/E4 chain above carries the
    # opposite sign for F, hence the negation. Confirmed by the A -> 0
    # anchor F = +0.908920 (see docstring).
    F = -E6 / den_f
    V = E4 / den_v
    f = max(1.0, C36 / (1.0 + A))
    return {"A": A, "C": C, "F": F, "V": V, "f": f}


def flange_bolt_loads(P, gasket_od, gasket_id, m, y, Sb, Sa, Ab,
                      units="SI"):
    """App. 2-5 gasket seating width, bolt loads and required bolt area.

    P         : internal design pressure
    gasket_od : outside diameter of the gasket contact face
    gasket_id : inside diameter of the gasket contact face
    m, y      : gasket factor and minimum seating stress, Table 2-5.1 (user
                input — the table is copyrighted and is not bundled)
    Sb        : bolt allowable stress at design temperature
    Sa        : bolt allowable stress at ambient (gasket seating)
    Ab        : actual total cross-sectional area of the bolts at root of
                thread or section of least diameter under stress
    units     : "SI" (mm) or "US" (in) — sets the b = C*sqrt(b_o) constant
    """
    r = CalcResult("Flange bolt loads and gasket seating",
                   "ASME BPVC VIII-1 App. 2-5")
    if gasket_od <= gasket_id:
        raise ValueError("gasket_od must exceed gasket_id")
    si = units.upper() == "SI"
    b_coef = B_COEF_SI if si else B_COEF_US
    bo_limit = BO_LIMIT_SI if si else BO_LIMIT_US

    N = (gasket_od - gasket_id) / 2.0
    b_o = N / 2.0
    for name, val, note in [("P", P, ""), ("gasket OD", gasket_od, ""),
                            ("gasket ID", gasket_id, ""),
                            ("N (contact width)", N, "(OD - ID)/2"),
                            ("b_o (basic width)", b_o, "N/2"),
                            ("m (gasket factor)", m, "Table 2-5.1"),
                            ("y (seating stress)", y, "Table 2-5.1"),
                            ("Sb", Sb, "bolt, design temp"),
                            ("Sa", Sa, "bolt, ambient"),
                            ("Ab (actual bolt area)", Ab, "")]:
        r.add_input(name, float(val), note=note)

    if b_o <= bo_limit:
        b = b_o
        G = (gasket_od + gasket_id) / 2.0
        r.add_step("b (effective width)", "b_o (b_o <= limit)", b)
        r.add_step("G (reaction dia.)", "mean of gasket contact face", G)
    else:
        b = b_coef * math.sqrt(b_o)
        G = gasket_od - 2.0 * b
        r.add_step("b (effective width)", f"{b_coef}*sqrt(b_o)", b)
        r.add_step("G (reaction dia.)", "gasket OD - 2*b", G)

    H = 0.785 * G * G * P
    Hp = 2.0 * b * math.pi * G * m * P
    Wm1 = H + Hp
    Wm2 = math.pi * b * G * y
    r.add_step("H (hydrostatic end load)", "0.785*G^2*P", H)
    r.add_step("Hp (gasket compression)", "2*b*pi*G*m*P", Hp)
    r.add_step("Wm1 (operating bolt load)", "H + Hp", Wm1)
    r.add_step("Wm2 (seating bolt load)", "pi*b*G*y", Wm2)

    Am1 = Wm1 / Sb
    Am2 = Wm2 / Sa
    Am = max(Am1, Am2)
    r.add_step("Am1", "Wm1/Sb", Am1)
    r.add_step("Am2", "Wm2/Sa", Am2)
    r.add_step("Am (required bolt area)", "max(Am1, Am2)", Am)

    # App. 2-5(e): the seating-condition design bolt load uses the average of
    # required and actual bolt area, so over-bolting is penalised.
    W_seating = 0.5 * (Am + Ab) * Sa
    r.add_step("W (seating design load)", "0.5*(Am + Ab)*Sa", W_seating)

    r.add_check("Ab >= Am (bolting adequate)", Ab >= Am)
    r.results["Am"] = Am
    r.results["Wm1"] = Wm1
    r.results["Wm2"] = Wm2
    r.results["W_seating"] = W_seating
    r.results["G"] = G
    r.results["b"] = b
    r.data.update(P=P, G=G, b=b, H=H, Wm1=Wm1, Wm2=Wm2, Am=Am, Ab=Ab,
                  W_seating=W_seating, governing="seating" if Am2 > Am1
                  else "operating")
    return r


def flange_stresses(bolt_result, flange_od, B, bolt_circle, t, Sf, Sfa,
                    flange_type=INTEGRAL, g0=None, g1=None, h=None,
                    Sn=None, Sna=None):
    """App. 2-6/2-7 flange moments and stresses, operating and seating.

    bolt_result : CalcResult from flange_bolt_loads() — P, G, Wm1 and W are
                  reused so nothing is re-entered.
    flange_od   : A, outside diameter of the flange
    B           : inside diameter of the flange
    bolt_circle : C, bolt circle diameter
    t           : flange thickness
    Sf, Sfa     : flange material allowable stress at design temp / ambient
    flange_type : "integral" or "ring" (loose flange, no hub)
    g0, g1, h   : hub thickness at small end / at back of flange, hub length.
                  Required unless flange_type is "ring".
    Sn, Sna     : nozzle-neck (hub) allowable stress at design temp /
                  ambient. Defaults to Sf / Sfa. Used for the SH limit on
                  integral flanges.
    """
    if flange_type not in FLANGE_TYPES:
        raise ValueError(f"flange_type must be one of {FLANGE_TYPES}")
    r = CalcResult(f"Flange stresses ({flange_type})",
                   "ASME BPVC VIII-1 App. 2-6, 2-7")
    g = bolt_result.data
    if not g:
        raise ValueError("bolt_result carries no geometry - pass the "
                         "CalcResult returned by flange_bolt_loads()")
    P, G, Wm1, H = g["P"], g["G"], g["Wm1"], g["H"]
    W = g["W_seating"]
    if Sn is None:
        Sn = Sf
    if Sna is None:
        Sna = Sfa

    is_ring = flange_type == RING
    if not is_ring and None in (g0, g1, h):
        raise ValueError("g0, g1 and h are required unless "
                         "flange_type='ring'")

    K = flange_od / B
    T, U, Y, Z = figure_2_7_1(K)
    for name, val, note in [("A (flange OD)", flange_od, ""),
                            ("B (flange ID)", B, ""),
                            ("C (bolt circle)", bolt_circle, ""),
                            ("t (flange thickness)", t, ""),
                            ("K = A/B", K, ""),
                            ("T", T, "Fig. 2-7.1"), ("U", U, "Fig. 2-7.1"),
                            ("Y", Y, "Fig. 2-7.1"), ("Z", Z, "Fig. 2-7.1"),
                            ("Sf / Sfa", Sf, f"ambient {Sfa}")]:
        r.add_input(name, float(val), note=note)

    # --- App. 2-6 moments ---
    HD = 0.785 * B * B * P
    HT = H - HD
    HG = Wm1 - H
    hG = 0.5 * (bolt_circle - G)
    if flange_type == INTEGRAL:
        R = 0.5 * (bolt_circle - B) - g1
        hD = R + 0.5 * g1
        hT = 0.5 * (R + g1 + hG)
        r.add_step("R", "0.5*(C - B) - g1", R)
    else:
        hD = 0.5 * (bolt_circle - B)
        hT = 0.5 * (hD + hG)
    r.add_step("HD (pressure on flange ID)", "0.785*B^2*P", HD)
    r.add_step("HT (pressure, flange face)", "H - HD", HT)
    r.add_step("HG (gasket load)", "Wm1 - H", HG)
    r.add_step("hD", "Table 2-6", hD)
    r.add_step("hT", "Table 2-6", hT)
    r.add_step("hG", "0.5*(C - G)", hG)

    Mo = HD * hD + HT * hT + HG * hG
    Mg = W * hG
    r.add_step("Mo (operating moment)", "HD*hD + HT*hT + HG*hG", Mo)
    r.add_step("Mg (seating moment)", "W*hG", Mg)

    # --- App. 2-7 stresses ---
    if is_ring:
        e = d = L = 0.0
        f_hub = 1.0
        r.add_step("hub factors", "n/a (loose flange, no hub)", 0.0)

        def stresses(M):
            return 0.0, 0.0, Y * M / (t * t * B)
    else:
        h0 = math.sqrt(B * g0)
        tab = table_2_7_1(g0, g1, h, h0)
        F_use, V_use, f_hub = tab["F"], tab["V"], tab["f"]
        e = F_use / h0
        d = (U / V_use) * h0 * g0 * g0
        L = (t * e + 1.0) / T + t ** 3 / d
        for name, val, note in [("g0", g0, ""), ("g1", g1, ""), ("h", h, ""),
                                ("h0 = sqrt(B*g0)", h0, ""),
                                ("F", F_use, "Table 2-7.1"),
                                ("V", V_use, "Table 2-7.1"),
                                ("f (hub stress factor)", f_hub, ""),
                                ("e = F/h0", e, ""),
                                ("d = (U/V)*h0*g0^2", d, ""),
                                ("L", L, "(t*e+1)/T + t^3/d")]:
            r.add_step(name, note or "-", float(val))

        def stresses(M):
            SH = f_hub * M / (L * g1 * g1 * B)
            SR = (1.33 * t * e + 1.0) * M / (L * t * t * B)
            ST = Y * M / (t * t * B) - Z * SR
            return SH, SR, ST

    SH_o, SR_o, ST_o = stresses(Mo)
    SH_g, SR_g, ST_g = stresses(Mg)
    for tag, (SH, SR, ST) in (("operating", (SH_o, SR_o, ST_o)),
                              ("seating", (SH_g, SR_g, ST_g))):
        r.add_step(f"SH ({tag})", "longitudinal hub stress", SH)
        r.add_step(f"SR ({tag})", "radial flange stress", SR)
        r.add_step(f"ST ({tag})", "tangential flange stress", ST)

    # --- App. 2-8 allowable stress checks ---
    for tag, (SH, SR, ST), Sf_t, Sn_t in (
            ("operating", (SH_o, SR_o, ST_o), Sf, Sn),
            ("seating", (SH_g, SR_g, ST_g), Sfa, Sna)):
        limit_SH = 1.5 * min(Sf_t, Sn_t)
        if not is_ring:
            r.add_check(f"SH <= 1.5*S ({tag})", SH <= limit_SH)
            r.add_check(f"SR <= S ({tag})", SR <= Sf_t)
        r.add_check(f"ST <= S ({tag})", ST <= Sf_t)
        if not is_ring:
            r.add_check(f"(SH+SR)/2 <= S ({tag})", 0.5 * (SH + SR) <= Sf_t)
            r.add_check(f"(SH+ST)/2 <= S ({tag})", 0.5 * (SH + ST) <= Sf_t)

    r.add_note("Ring-type gasket inside the bolt circle, internal pressure "
               "only. Rigidity index (App. 2-14), bolt spacing and external "
               "piping loads are not checked.")
    r.results["Mo"] = Mo
    r.results["Mg"] = Mg
    r.results["SH_operating"] = SH_o
    r.results["SR_operating"] = SR_o
    r.results["ST_operating"] = ST_o
    r.results["SH_seating"] = SH_g
    r.results["SR_seating"] = SR_g
    r.results["ST_seating"] = ST_g
    return r

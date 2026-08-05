"""External pressure (vacuum) — equation-based method of ASME VIII-2 para 4.4.

Why Div 2 here: the Div 1 UG-28 procedure requires the Section II-D
Subpart 3 charts (Fig. G and the material B-charts), which are copyrighted
and cannot be redistributed. Division 2 para 4.4 gives closed-form
equations for the same physics and is the industry-accepted alternative
for preliminary work (also the basis of former Code Case 2286).
For a Div 1 code report the chart-based UG-28 result governs — cross-check
against PV Elite before relying on these numbers for deliverables.

Additional user inputs vs. UG-28:
  Sy : yield strength at design temperature (Sec II-D Table Y-1)
  Ey : elastic modulus at design temperature (Sec II-D)

Units: any single consistent set (SI: mm & MPa recommended).
"""

import math

from .report import CalcResult


def _design_factor(Fic, Sy):
    """Design factor FS per VIII-2 para 4.4.2."""
    ratio = Fic / Sy
    if ratio <= 0.55:
        return 2.0
    if ratio < 1.0:
        return 2.407 - 0.741 * ratio
    return 1.667


def cylinder_maep(Do, t, L, Ey, Sy):
    """Maximum allowable external pressure of a cylinder, VIII-2 para 4.4.5.

    Do : outside diameter
    t  : available (corroded) thickness
    L  : design length between lines of support (tangent-to-tangent plus
         1/3 of each head depth, or distance between stiffening rings)
    """
    r = CalcResult("Cylindrical shell - allowable external pressure",
                   "ASME BPVC VIII-2 para 4.4.5 (equation-based UG-28 alternative)")
    r.add_input("Do (outside diameter)", float(Do))
    r.add_input("t (corroded thickness)", float(t))
    r.add_input("L (design length)", float(L))
    r.add_input("Ey (modulus at temp.)", float(Ey))
    r.add_input("Sy (yield at temp.)", float(Sy))

    Ro = Do / 2.0
    Mx = L / math.sqrt(Ro * t)
    r.add_step("Mx", "L/sqrt(Ro*t)", Mx)

    mx_upper = 2.0 * (Do / t) ** 0.94
    if Mx >= mx_upper:
        Ch = 0.55 * t / Do
        r.add_step("Ch (long cylinder)", "0.55*(t/Do)", Ch)
    elif Mx > 13.0:
        Ch = 1.12 * Mx ** (-1.058)
        r.add_step("Ch", "1.12*Mx^-1.058", Ch)
    elif Mx > 1.5:
        Ch = 0.92 / (Mx - 0.579)
        r.add_step("Ch", "0.92/(Mx - 0.579)", Ch)
    else:
        Ch = 1.0
        r.add_step("Ch (short cylinder)", "1.0", Ch)

    Fhe = 1.6 * Ch * Ey * t / Do
    r.add_step("Fhe (elastic hoop buckling)", "1.6*Ch*Ey*t/Do", Fhe)

    ratio = Fhe / Sy
    if ratio >= 2.439:
        Fic = Sy
        r.add_step("Fic (yield governs)", "Sy", Fic)
    elif ratio > 0.552:
        Fic = 0.7 * Sy * ratio ** 0.4
        r.add_step("Fic (inelastic)", "0.7*Sy*(Fhe/Sy)^0.4", Fic)
    else:
        Fic = Fhe
        r.add_step("Fic (elastic)", "Fhe", Fic)

    FS = _design_factor(Fic, Sy)
    Fha = Fic / FS
    Pa = 2.0 * Fha * t / Do
    r.add_step("FS (design factor)", "para 4.4.2", FS)
    r.add_step("Fha", "Fic/FS", Fha)
    r.add_step("Pa (allowable ext. pressure)", "2*Fha*(t/Do)", Pa)

    r.add_check("Applicability: Do/t <= 2000", Do / t <= 2000.0)
    r.results["Pa"] = Pa
    return r


def cylinder_thickness_for_external(P_ext, Do, L, Ey, Sy,
                                    t_lo=0.1, t_hi=None, tol=1e-4):
    """Minimum corroded thickness so that Pa >= P_ext (bisection on 4.4.5)."""
    if t_hi is None:
        t_hi = Do / 10.0
    if cylinder_maep(Do, t_hi, L, Ey, Sy).results["Pa"] < P_ext:
        raise ValueError("P_ext not attainable with t up to Do/10 - add stiffening rings")
    lo, hi = t_lo, t_hi
    while hi - lo > tol:
        mid = 0.5 * (lo + hi)
        if cylinder_maep(Do, mid, L, Ey, Sy).results["Pa"] >= P_ext:
            hi = mid
        else:
            lo = mid
    return hi


def sphere_maep(Ro, t, Ey, Sy):
    """Allowable external pressure of a spherical shell or formed head,
    VIII-2 para 4.4.7 / cf. UG-33.

    For heads, use the equivalent outside spherical radius Ro:
      hemispherical : outside crown radius
      2:1 ellipsoidal: Ro = 0.9 * Do   (UG-33(d) Ko factor)
      torispherical : outside crown radius
    """
    r = CalcResult("Sphere / formed head - allowable external pressure",
                   "ASME BPVC VIII-2 para 4.4.7")
    r.add_input("Ro (outside spherical radius)", float(Ro))
    r.add_input("t (corroded thickness)", float(t))
    r.add_input("Ey", float(Ey))
    r.add_input("Sy", float(Sy))

    Fhe = 0.075 * Ey * t / Ro
    r.add_step("Fhe", "0.075*Ey*(t/Ro)", Fhe)

    ratio = Fhe / Sy
    if ratio >= 6.25:
        Fic = Sy
        r.add_step("Fic (yield governs)", "Sy", Fic)
    elif ratio > 1.6:
        Fic = 1.31 * Sy / (1.15 + Sy / Fhe)
        r.add_step("Fic", "1.31*Sy/(1.15 + Sy/Fhe)", Fic)
    elif ratio > 0.55:
        Fic = 0.18 * Fhe + 0.45 * Sy
        r.add_step("Fic", "0.18*Fhe + 0.45*Sy", Fic)
    else:
        Fic = Fhe
        r.add_step("Fic (elastic)", "Fhe", Fic)

    FS = _design_factor(Fic, Sy)
    Fha = Fic / FS
    Pa = 2.0 * Fha * t / Ro
    r.add_step("FS", "para 4.4.2", FS)
    r.add_step("Fha", "Fic/FS", Fha)
    r.add_step("Pa", "2*Fha*(t/Ro)", Pa)
    r.results["Pa"] = Pa
    return r

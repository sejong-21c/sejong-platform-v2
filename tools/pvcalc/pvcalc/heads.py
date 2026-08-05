"""Formed heads under internal pressure — ASME VIII-1 UG-32 / Mandatory App. 1-4.

Units: any single consistent set (SI: mm & MPa, or US: inch & psi).

Symbols
  P : internal design pressure
  D : inside diameter, corroded
  L : inside crown (spherical) radius, corroded
  r : inside knuckle radius, corroded
  h : inside depth of ellipsoidal head (D/4 for 2:1)
  S : allowable stress (Sec II-D)
  E : joint efficiency
"""

import math

from .report import CalcResult


def ellipsoidal_thickness(P, D, S, E=1.0, CA=0.0, D_over_2h=2.0):
    """Ellipsoidal head required thickness.

    D_over_2h = 2.0 -> standard 2:1 head, UG-32(d): t = P*D/(2*S*E - 0.2*P)
    other ratios     -> App. 1-4(c) with K = (1/6)*(2 + (D/2h)^2)
    """
    r = CalcResult("Ellipsoidal head - required thickness",
                   "ASME BPVC VIII-1 UG-32(d) / App.1-4(c)")
    r.add_input("P", float(P))
    r.add_input("D (inside dia., corroded)", float(D))
    r.add_input("S", float(S))
    r.add_input("E", float(E))
    r.add_input("D/2h", float(D_over_2h))
    r.add_input("CA", float(CA))

    K = (2.0 + D_over_2h ** 2) / 6.0
    r.add_step("K", "(2 + (D/2h)^2)/6", K)
    t_req = P * D * K / (2.0 * S * E - 0.2 * P)
    r.add_step("t_req", "P*D*K/(2*S*E - 0.2*P)", t_req)

    r.add_check("Applicability: t/L >= 0.002 (else App.1-4(f) fatigue rules)",
                t_req / (K * D if K > 0 else D) >= 0.002)
    r.add_check("Applicability: 1.0 <= D/2h <= 3.0", 1.0 <= D_over_2h <= 3.0)
    r.results["t_req"] = t_req
    r.results["t_req_ca"] = t_req + CA
    return r


def ellipsoidal_mawp(t, D, S, E=1.0, CA=0.0, D_over_2h=2.0):
    """Ellipsoidal head MAWP from available thickness."""
    r = CalcResult("Ellipsoidal head - MAWP",
                   "ASME BPVC VIII-1 UG-32(d) / App.1-4(c)")
    t_a = t - CA
    D_c = D + 2.0 * CA
    K = (2.0 + D_over_2h ** 2) / 6.0
    r.add_input("t_avail = t - CA", float(t_a))
    r.add_input("D (corroded)", float(D_c))
    r.add_input("K", float(K))
    mawp = 2.0 * S * E * t_a / (K * D_c + 0.2 * t_a)
    r.add_step("MAWP", "2*S*E*t/(K*D + 0.2*t)", mawp)
    r.add_check("t_avail > 0", t_a > 0)
    r.results["MAWP"] = mawp
    return r


def torispherical_thickness(P, L, S, E=1.0, CA=0.0, r_knuckle=None):
    """Torispherical head required thickness.

    r_knuckle=None -> standard F&D head with r = 0.06*L, UG-32(e):
                      t = 0.885*P*L/(S*E - 0.1*P)
    r_knuckle given -> App. 1-4(d): M = (3 + sqrt(L/r))/4,
                      t = P*L*M/(2*S*E - 0.2*P), valid L/r <= 16 2/3
    """
    res = CalcResult("Torispherical head - required thickness",
                     "ASME BPVC VIII-1 UG-32(e) / App.1-4(d)")
    res.add_input("P", float(P))
    res.add_input("L (crown radius, corroded)", float(L))
    res.add_input("S", float(S))
    res.add_input("E", float(E))
    res.add_input("CA", float(CA))

    if r_knuckle is None:
        res.add_input("r (knuckle)", 0.06 * L, note="standard: r = 6% of L")
        t_req = 0.885 * P * L / (S * E - 0.1 * P)
        res.add_step("t_req", "0.885*P*L/(S*E - 0.1*P)", t_req)
        res.results["M"] = 1.77
    else:
        res.add_input("r (knuckle, corroded)", float(r_knuckle))
        Lr = L / r_knuckle
        M = 0.25 * (3.0 + math.sqrt(Lr))
        res.add_step("L/r", "L/r", Lr)
        res.add_step("M", "(3 + sqrt(L/r))/4", M)
        t_req = P * L * M / (2.0 * S * E - 0.2 * P)
        res.add_step("t_req", "P*L*M/(2*S*E - 0.2*P)", t_req)
        res.add_check("Applicability: L/r <= 16.667", Lr <= 16.667)
        res.add_check("Knuckle radius: r >= 0.06*L and r >= 3*t",
                      r_knuckle >= 0.06 * L and r_knuckle >= 3.0 * t_req)
        res.results["M"] = M

    res.add_check("Applicability: t/L >= 0.002 (else App.1-4(f))",
                  t_req / L >= 0.002)
    res.results["t_req"] = t_req
    res.results["t_req_ca"] = t_req + CA
    return res


def torispherical_mawp(t, L, S, E=1.0, CA=0.0, r_knuckle=None):
    """Torispherical head MAWP from available thickness."""
    res = CalcResult("Torispherical head - MAWP",
                     "ASME BPVC VIII-1 UG-32(e) / App.1-4(d)")
    t_a = t - CA
    L_c = L + CA
    res.add_input("t_avail = t - CA", float(t_a))
    res.add_input("L (corroded)", float(L_c))
    if r_knuckle is None:
        mawp = S * E * t_a / (0.885 * L_c + 0.1 * t_a)
        res.add_step("MAWP", "S*E*t/(0.885*L + 0.1*t)", mawp)
    else:
        M = 0.25 * (3.0 + math.sqrt(L_c / r_knuckle))
        res.add_step("M", "(3 + sqrt(L/r))/4", M)
        mawp = 2.0 * S * E * t_a / (L_c * M + 0.2 * t_a)
        res.add_step("MAWP", "2*S*E*t/(L*M + 0.2*t)", mawp)
    res.add_check("t_avail > 0", t_a > 0)
    res.results["MAWP"] = mawp
    return res


def hemispherical_thickness(P, L, S, E=1.0, CA=0.0):
    """Hemispherical head required thickness, UG-32(f)."""
    r = CalcResult("Hemispherical head - required thickness",
                   "ASME BPVC VIII-1 UG-32(f)")
    r.add_input("P", float(P))
    r.add_input("L (inside radius, corroded)", float(L))
    r.add_input("S", float(S))
    r.add_input("E", float(E))
    r.add_input("CA", float(CA))
    t_req = P * L / (2.0 * S * E - 0.2 * P)
    r.add_step("t_req", "P*L/(2*S*E - 0.2*P)", t_req)
    r.add_check("Applicability: t <= 0.356*L", t_req <= 0.356 * L)
    r.add_check("Applicability: P <= 0.665*S*E", P <= 0.665 * S * E)
    r.results["t_req"] = t_req
    r.results["t_req_ca"] = t_req + CA
    return r


def conical_thickness(P, D, alpha_deg, S, E=1.0, CA=0.0):
    """Conical section required thickness, UG-32(g).

    D = inside diameter at the large end (corroded); alpha = half-apex angle.
    Valid for alpha <= 30 deg (beyond that: App. 1-5(g) discontinuity rules).
    """
    r = CalcResult("Conical section - required thickness",
                   "ASME BPVC VIII-1 UG-32(g)")
    a = math.radians(alpha_deg)
    r.add_input("P", float(P))
    r.add_input("D (large-end inside dia.)", float(D))
    r.add_input("alpha (half-apex angle)", float(alpha_deg), "deg")
    r.add_input("S", float(S))
    r.add_input("E", float(E))
    r.add_input("CA", float(CA))
    t_req = P * D / (2.0 * math.cos(a) * (S * E - 0.6 * P))
    r.add_step("t_req", "P*D/(2*cos(a)*(S*E - 0.6*P))", t_req)
    r.add_check("Applicability: alpha <= 30 deg", alpha_deg <= 30.0)
    r.results["t_req"] = t_req
    r.results["t_req_ca"] = t_req + CA
    return r

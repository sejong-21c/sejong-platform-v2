"""Cylindrical / spherical shell under internal pressure — ASME VIII-1 UG-27.

Units: any single consistent set (SI: mm & MPa, or US: inch & psi).
P and S must share the same pressure unit; R and t the same length unit.

Symbols
  P : internal design pressure (gauge, incl. static head)
  R : inside radius, corroded
  S : allowable stress at design temperature (ASME Sec II-D — user input)
  E : joint efficiency (UW-12)
"""

from .report import CalcResult


def cylinder_thickness(P, R, S, E=1.0, CA=0.0):
    """Required thickness of a cylindrical shell, UG-27(c).

    Returns CalcResult; results['t_req'] excludes CA, results['t_req_ca']
    includes it. Governing case is the larger of circumferential /
    longitudinal stress equations.
    """
    r = CalcResult("Cylindrical shell - required thickness (internal pressure)",
                   "ASME BPVC VIII-1 UG-27(c)")
    r.add_input("P (design pressure)", float(P))
    r.add_input("R (inside radius, corroded)", float(R))
    r.add_input("S (allowable stress)", float(S))
    r.add_input("E (joint efficiency)", float(E))
    r.add_input("CA (corrosion allowance)", float(CA))

    t_circ = P * R / (S * E - 0.6 * P)
    t_long = P * R / (2.0 * S * E + 0.4 * P)
    r.add_step("t_circ (circumferential)", "P*R/(S*E - 0.6*P)", t_circ)
    r.add_step("t_long (longitudinal)", "P*R/(2*S*E + 0.4*P)", t_long)

    t_req = max(t_circ, t_long)
    r.add_check("Applicability: P <= 0.385*S*E (circ. eq.)", P <= 0.385 * S * E)
    r.add_check("Applicability: t <= 0.5*R", t_req <= 0.5 * R)

    r.results["t_req"] = t_req
    r.results["t_req_ca"] = t_req + CA
    r.results["governing"] = "circumferential" if t_circ >= t_long else "longitudinal"
    return r


def cylinder_mawp(t, R, S, E=1.0, CA=0.0):
    """MAWP of a cylindrical shell from available thickness, UG-27(c).

    t is the nominal thickness; CA is deducted internally (t_avail = t - CA,
    R is increased by CA if R given as new; pass R already corroded and CA=0
    if you prefer to handle corrosion yourself).
    """
    r = CalcResult("Cylindrical shell - MAWP", "ASME BPVC VIII-1 UG-27(c)")
    t_a = t - CA
    R_c = R + CA
    r.add_input("t (nominal thickness)", float(t))
    r.add_input("CA", float(CA))
    r.add_input("t_avail = t - CA", float(t_a))
    r.add_input("R (corroded) = R + CA", float(R_c))
    r.add_input("S", float(S))
    r.add_input("E", float(E))

    p_circ = S * E * t_a / (R_c + 0.6 * t_a)
    p_long = 2.0 * S * E * t_a / (R_c - 0.4 * t_a)
    r.add_step("P_circ", "S*E*t/(R + 0.6*t)", p_circ)
    r.add_step("P_long", "2*S*E*t/(R - 0.4*t)", p_long)

    mawp = min(p_circ, p_long)
    r.add_check("t_avail > 0", t_a > 0)
    r.add_check("Applicability: t <= 0.5*R", t_a <= 0.5 * R_c)
    r.results["MAWP"] = mawp
    r.results["governing"] = "circumferential" if p_circ <= p_long else "longitudinal"
    return r


def sphere_thickness(P, R, S, E=1.0, CA=0.0):
    """Required thickness of a spherical shell, UG-27(d)."""
    r = CalcResult("Spherical shell - required thickness (internal pressure)",
                   "ASME BPVC VIII-1 UG-27(d)")
    r.add_input("P", float(P))
    r.add_input("R (inside radius, corroded)", float(R))
    r.add_input("S", float(S))
    r.add_input("E", float(E))
    r.add_input("CA", float(CA))

    t_req = P * R / (2.0 * S * E - 0.2 * P)
    r.add_step("t_req", "P*R/(2*S*E - 0.2*P)", t_req)
    r.add_check("Applicability: P <= 0.665*S*E", P <= 0.665 * S * E)
    r.add_check("Applicability: t <= 0.356*R", t_req <= 0.356 * R)
    r.results["t_req"] = t_req
    r.results["t_req_ca"] = t_req + CA
    return r


def sphere_mawp(t, R, S, E=1.0, CA=0.0):
    """MAWP of a spherical shell, UG-27(d)."""
    r = CalcResult("Spherical shell - MAWP", "ASME BPVC VIII-1 UG-27(d)")
    t_a = t - CA
    R_c = R + CA
    r.add_input("t_avail = t - CA", float(t_a))
    r.add_input("R (corroded)", float(R_c))
    r.add_input("S", float(S))
    r.add_input("E", float(E))

    mawp = 2.0 * S * E * t_a / (R_c + 0.2 * t_a)
    r.add_step("MAWP", "2*S*E*t/(R + 0.2*t)", mawp)
    r.add_check("t_avail > 0", t_a > 0)
    r.results["MAWP"] = mawp
    return r


def static_head(rho_kg_m3, height_m):
    """Liquid static head in MPa (SI convenience helper).

    P_head[MPa] = rho[kg/m3] * g * h[m] * 1e-6
    """
    return rho_kg_m3 * 9.80665 * height_m * 1.0e-6

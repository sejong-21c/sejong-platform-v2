"""Nozzle opening reinforcement — ASME VIII-1 UG-37 / UG-40, and UG-45 neck
thickness check.

Scope / limitations (see README):
  * Internal pressure, single circular opening in a cylindrical shell or
    formed head, nozzle axis normal to the wall (F = 1.0 default).
  * Set-in (inserted) or set-on (abutting) nozzles, optional reinforcing pad.
  * UG-36(c)(3) small-opening exemption is reported but the area calc is
    always carried out.
  * NOT covered: UG-41 weld strength / load path checks, ligament rules
    (UG-53), large openings per App. 1-7, hillside/tangential nozzles.
    For deliverable calcs run the full check in PV Elite or equivalent.

Units: any single consistent set; UG-45 pipe-schedule data is in inches
internally and converted when units="SI" (mm).
"""

import math

from .report import CalcResult

# UW-15(c) allowable stress for weld metal, as a fraction of the allowable
# stress of the material being joined.
UW15C_GROOVE_TENSION = 0.74
UW15C_GROOVE_SHEAR = 0.60
UW15C_FILLET_SHEAR = 0.49
UW15C_NOZZLE_WALL_SHEAR = 0.70

# ASME B36.10 standard-wall (STD) nominal thickness, inches, by NPS.
B3610_STD_WALL_IN = {
    0.5: 0.109, 0.75: 0.113, 1.0: 0.133, 1.25: 0.140, 1.5: 0.145,
    2.0: 0.154, 2.5: 0.203, 3.0: 0.216, 3.5: 0.226, 4.0: 0.237,
    5.0: 0.258, 6.0: 0.280, 8.0: 0.322, 10.0: 0.365, 12.0: 0.375,
    14.0: 0.375, 16.0: 0.375, 18.0: 0.375, 20.0: 0.375, 24.0: 0.375,
}
IN_TO_MM = 25.4


def area_reinforcement(d, t, tr, tn, trn, Sv, Sn,
                       set_in=True, E1=1.0, F=1.0,
                       te=0.0, Dp=0.0, Sp=None,
                       leg_nozzle=0.0, leg_pad=0.0, leg_inner=0.0,
                       ti=0.0, h=0.0):
    """UG-37 area-replacement check for a single opening, internal pressure.

    d   : finished opening chord diameter in the corroded condition
    t   : available shell thickness (nominal - CA)
    tr  : required shell thickness at the opening, computed with E = 1
    tn  : available nozzle wall thickness (nominal - CA)
    trn : required nozzle wall thickness (seamless, E = 1)
    Sv, Sn, Sp : allowable stress of vessel / nozzle / pad material
    set_in     : True = nozzle inserted through the wall, False = set-on
    E1  : 1.0 unless a butt weld seam passes through the opening
    F   : correction factor, Fig. UG-37 (1.0 for normal nozzles)
    te, Dp     : pad thickness and outside diameter (0 = no pad)
    leg_*      : fillet weld leg sizes (outer nozzle, pad OD, inner)
    ti, h      : inward-projection available thickness and projection length
    """
    r = CalcResult("Nozzle opening reinforcement", "ASME BPVC VIII-1 UG-37")
    has_pad = te > 0.0 and Dp > 0.0
    if Sp is None:
        Sp = Sn

    fr1 = min(Sn / Sv, 1.0) if set_in else 1.0
    fr2 = min(Sn / Sv, 1.0)
    fr3 = min(min(Sn, Sp) / Sv, 1.0)
    fr4 = min(Sp / Sv, 1.0)

    for name, val, note in [
            ("d (opening, corroded)", d, ""),
            ("t (shell available)", t, ""),
            ("tr (shell required, E=1)", tr, ""),
            ("tn (nozzle available)", tn, ""),
            ("trn (nozzle required, E=1)", trn, ""),
            ("F", F, ""), ("E1", E1, ""),
            ("fr1", fr1, "set-in: Sn/Sv, set-on: 1.0"),
            ("fr2", fr2, "Sn/Sv"),
            ("fr3", fr3, "min(Sn,Sp)/Sv"), ("fr4", fr4, "Sp/Sv")]:
        r.add_input(name, float(val), note=note)
    if has_pad:
        r.add_input("te (pad thickness)", float(te))
        r.add_input("Dp (pad OD)", float(Dp))

    # Required area
    A = d * tr * F + 2.0 * tn * tr * F * (1.0 - fr1)
    r.add_step("A (required)", "d*tr*F + 2*tn*tr*F*(1-fr1)", A)

    # A1 - excess shell
    excess = E1 * t - F * tr
    A1a = d * excess - 2.0 * tn * excess * (1.0 - fr1)
    A1b = 2.0 * (t + tn) * excess - 2.0 * tn * excess * (1.0 - fr1)
    A1 = max(A1a, A1b, 0.0)
    r.add_step("A1 (shell excess)", "max of two UG-37.1 formulas", A1)

    # A2 - excess nozzle wall (outward)
    if has_pad:
        A2a = 5.0 * (tn - trn) * fr2 * t
        A2b = 2.0 * (tn - trn) * (2.5 * tn + te) * fr2
    else:
        A2a = 5.0 * (tn - trn) * fr2 * t
        A2b = 5.0 * (tn - trn) * fr2 * tn
    A2 = max(min(A2a, A2b), 0.0)
    r.add_step("A2 (nozzle excess)", "min of two UG-37.1 formulas", A2)

    # A3 - inward projection
    if ti > 0.0 and h > 0.0:
        A3 = min(5.0 * t * ti * fr2, 5.0 * ti * ti * fr2, 2.0 * h * ti * fr2)
    else:
        A3 = 0.0
    r.add_step("A3 (inward projection)", "min(5*t*ti, 5*ti^2, 2*h*ti)*fr2", A3)

    # A4 - welds
    A41 = leg_nozzle ** 2 * (fr3 if has_pad else fr2)
    A42 = leg_pad ** 2 * fr4 if has_pad else 0.0
    A43 = leg_inner ** 2 * fr2
    r.add_step("A41 (outer nozzle weld)", "leg^2 * fr", A41)
    r.add_step("A42 (pad OD weld)", "leg^2 * fr4", A42)
    r.add_step("A43 (inner weld)", "leg^2 * fr2", A43)

    # A5 - pad (limited to the parallel reinforcement limit)
    limit_parallel = max(d, d / 2.0 + tn + t)  # each side of centerline
    if has_pad:
        Dp_eff = min(Dp, 2.0 * limit_parallel)
        A5 = (Dp_eff - d - 2.0 * tn) * te * fr4
        A5 = max(A5, 0.0)
        r.add_step("Dp_eff (limited)", "min(Dp, 2*limit)", Dp_eff)
    else:
        A5 = 0.0
    r.add_step("A5 (pad)", "(Dp - d - 2*tn)*te*fr4", A5)

    A_avail = A1 + A2 + A3 + A41 + A42 + A43 + A5
    r.add_step("A_avail (total)", "A1+A2+A3+A4+A5", A_avail)
    r.add_step("Limit, parallel (from CL)", "max(d, Rn+tn+t)", limit_parallel)
    r.add_step("Limit, normal", "min(2.5*t, 2.5*tn + te)",
               min(2.5 * t, 2.5 * tn + te))

    r.add_check("A_avail >= A (reinforcement adequate)", A_avail >= A)
    r.add_check("tn >= trn (nozzle wall adequate for pressure)", tn >= trn)
    r.results["A_required"] = A
    r.results["A_available"] = A_avail
    r.results["margin_pct"] = (A_avail / A - 1.0) * 100.0 if A > 0 else float("inf")
    # Handed to weld_strength() so the UG-41 check needs no re-entered inputs.
    r.data.update(d=d, t=t, tr=tr, tn=tn, Sv=Sv, Sn=Sn, Sp=Sp, E1=E1, F=F,
                  set_in=bool(set_in), has_pad=has_pad, te=te, Dp=Dp,
                  leg_nozzle=leg_nozzle, leg_pad=leg_pad, leg_inner=leg_inner,
                  fr1=fr1, fr2=fr2, fr3=fr3, fr4=fr4,
                  A=A, A1=A1, A2=A2, A3=A3, A41=A41, A42=A42, A43=A43, A5=A5)
    return r


def weld_strength(area_result, groove_nozzle=0.0, groove_pad=0.0,
                  exempt_uw15b1=False, external_pressure=False):
    """UG-41 attachment weld strength for the opening analysed by
    :func:`area_reinforcement`, with UW-15(c) weld allowable stresses.

    area_result   : CalcResult from area_reinforcement() — geometry, material
                    stresses, fr factors and areas are reused, so nothing has
                    to be entered twice.
    groove_nozzle : nozzle-to-vessel groove weld depth. Set-in nozzles: the
                    shell thickness t. Set-on: the nozzle thickness tn.
    groove_pad    : nozzle-to-pad groove weld depth (0 if none).
    exempt_uw15b1 : the opening qualifies for the UW-15(b)(1) exemption from
                    weld strength calculations (figure-conforming details).
    external_pressure : weld strength calculations are not required — UG-41
                    load paths address internal pressure loading.

    SCOPE — read this before using the numbers:

      * The strength of each individual weld element is unambiguous and is
        what this function is for: a shear/tension area of pi/2 * D * dim
        (half the circumference, per UG-41) times the UW-15(c) percentage of
        the allowable stress of the weaker material joined.
      * The per-path comparison of Fig. UG-41.1 (paths 1-1, 2-2, 3-3) is NOT
        performed. Which elements belong to which path depends on the
        applicable Fig. UG-41.1 sketch, and that mapping is not reproduced
        here. Instead the weaker *necessary* condition is checked:
            sum of all element strengths >= largest weld load
        This catches a grossly undersized attachment; it is not the full
        code check. Run the path analysis in PV Elite for a real design.
      * The W / W1-1 / W2-2 / W3-3 loads reproduce the published UG-41(b)(1)
        expressions but did NOT reconcile with a COMPRESS demo report (W was
        ~10% high, and the W1-1/W2-2 area groupings were mutually
        inconsistent). Treat the loads as indicative until checked against
        the code book. The element strengths are unaffected by this.
    """
    r = CalcResult("Nozzle attachment weld strength",
                   "ASME BPVC VIII-1 UG-41, UW-15(c)")
    g = area_result.data
    if not g:
        raise ValueError("area_result carries no geometry - pass the "
                         "CalcResult returned by area_reinforcement()")

    d, t, tr, tn = g["d"], g["t"], g["tr"], g["tn"]
    Sv, Sn, Sp = g["Sv"], g["Sn"], g["Sp"]
    has_pad, Dp = g["has_pad"], g["Dp"]
    fr1, E1, F = g["fr1"], g["E1"], g["F"]

    d_out = d + 2.0 * tn      # nozzle outside diameter
    d_mean = d + tn           # nozzle mean diameter (nozzle-wall shear area)
    half_circ = math.pi / 2.0

    # A fillet or groove weld is limited by the weaker of the two parts joined.
    S_nv = min(Sn, Sv)        # nozzle <-> vessel (or nozzle <-> pad face)
    S_pv = min(Sp, Sv)        # pad <-> vessel
    S_np = min(Sn, Sp)        # nozzle <-> pad

    for name, val, note in [
            ("d (opening, corroded)", d, ""),
            ("d_out (nozzle OD)", d_out, "d + 2*tn"),
            ("d_mean (nozzle mean dia)", d_mean, "d + tn"),
            ("groove_nozzle", groove_nozzle, "nozzle-to-vessel groove depth"),
            ("groove_pad", groove_pad, "nozzle-to-pad groove depth"),
            ("leg_nozzle (41)", g["leg_nozzle"], "outer nozzle fillet"),
            ("leg_pad (42)", g["leg_pad"], "pad OD fillet"),
            ("leg_inner (43)", g["leg_inner"], "inner fillet")]:
        r.add_input(name, float(val), note=note)

    if external_pressure:
        r.add_note("External pressure - UG-41 weld strength calculations are "
                   "not required.")
    if exempt_uw15b1:
        r.add_note("Opening is exempt from weld strength calculations per "
                   "UW-15(b)(1).")

    # --- Strength of each weld element (UW-15(c) x shear/tension area) ---
    S_fillet_41 = S_np if has_pad else S_nv
    e_wall = half_circ * d_mean * tn * UW15C_NOZZLE_WALL_SHEAR * Sn
    e_f41 = half_circ * d_out * g["leg_nozzle"] * UW15C_FILLET_SHEAR * S_fillet_41
    e_f42 = (half_circ * Dp * g["leg_pad"] * UW15C_FILLET_SHEAR * S_pv
             if has_pad else 0.0)
    e_f43 = half_circ * d_out * g["leg_inner"] * UW15C_FILLET_SHEAR * S_nv
    e_g_noz = half_circ * d_out * groove_nozzle * UW15C_GROOVE_TENSION * S_nv
    e_g_pad = (half_circ * d_out * groove_pad * UW15C_GROOVE_TENSION * S_np
               if has_pad else 0.0)

    r.add_step("Nozzle wall shear", "pi/2*d_mean*tn*0.70*Sn", e_wall)
    r.add_step("Fillet 41 shear", "pi/2*d_out*leg41*0.49*S", e_f41)
    r.add_step("Fillet 42 shear", "pi/2*Dp*leg42*0.49*S", e_f42)
    r.add_step("Fillet 43 shear", "pi/2*d_out*leg43*0.49*S", e_f43)
    r.add_step("Groove (nozzle) tension", "pi/2*d_out*gr_noz*0.74*S", e_g_noz)
    r.add_step("Groove (pad) tension", "pi/2*d_out*gr_pad*0.74*S", e_g_pad)

    total = e_wall + e_f41 + e_f42 + e_f43 + e_g_noz + e_g_pad
    r.add_step("Sum of all elements", "total attachment strength", total)

    # --- Weld loads, UG-41(b)(1) ---
    A, A1, A2, A3 = g["A"], g["A1"], g["A2"], g["A3"]
    A41, A42, A43, A5 = g["A41"], g["A42"], g["A43"], g["A5"]
    shell_noz = 2.0 * tn * t * fr1

    W = max((A - A1 + 2.0 * tn * fr1 * (E1 * t - F * tr)) * Sv, 0.0)
    W11 = (A2 + A5 + A41 + A42) * Sv
    W22 = (A2 + A3 + A41 + A43 + shell_noz) * Sv
    W33 = (A2 + A3 + A5 + A41 + A42 + A43 + shell_noz) * Sv
    r.add_step("W (total weld load)", "(A-A1+2*tn*fr1*(E1*t-F*tr))*Sv, >=0", W)
    r.add_step("W1-1", "(A2+A5+A41+A42)*Sv", W11)
    r.add_step("W2-2", "(A2+A3+A41+A43+2*tn*t*fr1)*Sv", W22)
    r.add_step("W3-3", "(A2+A3+A5+A41+A42+A43+2*tn*t*fr1)*Sv", W33)

    W_max = max(W, W11, W22, W33)
    r.add_step("W_max (governing load)", "max(W, W1-1, W2-2, W3-3)", W_max)

    r.add_note("Necessary condition only - the Fig. UG-41.1 per-path check "
               "(paths 1-1/2-2/3-3) is not performed. See docstring.")
    if not (external_pressure or exempt_uw15b1):
        r.add_check("sum of weld element strengths >= W_max", total >= W_max)

    r.results["W"] = W
    r.results["W_max"] = W_max
    r.results["strength_total"] = total
    r.results["margin_pct"] = ((total / W_max - 1.0) * 100.0
                               if W_max > 0 else float("inf"))
    return r


def large_opening_check(area_result, D_inside, units="SI"):
    """UG-36(b)(1) size gate plus the App. 1-7 supplemental large-opening rule.

    area_result : CalcResult from area_reinforcement() — geometry and areas
                  are reused.
    D_inside    : vessel inside diameter (corroded) at the opening
    units       : "SI" (mm) or "US" (in) — sets the absolute size caps

    Two things happen here:

    1. The UG-36(b)(1) gate. An opening within the limits needs only
       UG-36..UG-43; one that exceeds them must ALSO satisfy App. 1-7.
         D <= 1520 mm (60 in):  d <= D/2, and not more than  510 mm (20 in)
         D >  1520 mm (60 in):  d <= D/3, and not more than 1020 mm (40 in)
       d/D above 0.7 is outside the scope of both UG-37 and App. 1-7 — no
       verdict is issued there, only a failed check.

    2. The App. 1-7 rule, applied only when the gate is exceeded: two-thirds
       of the required area A must be available within 0.75 of the UG-40
       parallel reinforcement limit. App. 1-7 is supplemental, so the full
       UG-37 check from area_reinforcement() still has to pass as well.

    Only the parallel limit shrinks. A2 (nozzle wall) and A3 (inward
    projection) are bounded by the limit NORMAL to the wall, and the weld
    areas sit at the opening, so all three carry over unchanged.
    """
    r = CalcResult("Large opening check",
                   "ASME BPVC VIII-1 UG-36(b)(1), Mandatory App. 1-7")
    g = area_result.data
    if not g:
        raise ValueError("area_result carries no geometry - pass the "
                         "CalcResult returned by area_reinforcement()")
    si = units.upper() == "SI"
    d, t, tn, tr = g["d"], g["t"], g["tn"], g["tr"]
    E1, F, fr1 = g["E1"], g["F"], g["fr1"]

    # --- UG-36(b)(1) gate ---
    if D_inside <= (1520.0 if si else 60.0):
        d_max = min(D_inside / 2.0, 510.0 if si else 20.0)
        rule = "D <= 1520 mm: min(D/2, 510 mm)" if si \
            else "D <= 60 in: min(D/2, 20 in)"
    else:
        d_max = min(D_inside / 3.0, 1020.0 if si else 40.0)
        rule = "D > 1520 mm: min(D/3, 1020 mm)" if si \
            else "D > 60 in: min(D/3, 40 in)"
    ratio = d / D_inside
    is_large = d > d_max

    r.add_input("d (opening, corroded)", float(d))
    r.add_input("D (vessel ID, corroded)", float(D_inside))
    r.add_input("d/D", float(ratio), note="> 0.7 is outside code scope")
    r.add_step("d_max per UG-36(b)(1)", rule, d_max)
    r.add_step("App. 1-7 required?", "d > d_max", 1.0 if is_large else 0.0)

    r.add_check("d/D <= 0.7 (within UG-37 / App. 1-7 scope)", ratio <= 0.7)

    # --- App. 1-7 reduced parallel limit ---
    limit_par = max(d, d / 2.0 + tn + t)      # UG-40, from the centreline
    limit_red = 0.75 * limit_par
    r.add_step("UG-40 parallel limit (from CL)", "max(d, d/2 + tn + t)",
               limit_par)
    r.add_step("App. 1-7 reduced limit", "0.75 * parallel limit", limit_red)

    excess = E1 * t - F * tr
    width_red = max(2.0 * limit_red - d, 0.0)
    A1_red = max(width_red * excess
                 - 2.0 * tn * excess * (1.0 - fr1), 0.0)
    r.add_step("shell width within reduced limit", "2*0.75*limit - d",
               width_red)
    r.add_step("A1 within reduced limit", "width*(E1*t - F*tr) - 2*tn*(..)",
               A1_red)

    if g["has_pad"]:
        Dp_red = min(g["Dp"], 2.0 * limit_red)
        A5_red = max((Dp_red - d - 2.0 * tn) * g["te"] * g["fr4"], 0.0)
        r.add_step("A5 within reduced limit", "(min(Dp, 2*0.75*limit) - d - "
                   "2*tn)*te*fr4", A5_red)
    else:
        A5_red = 0.0

    A_within = (A1_red + g["A2"] + g["A3"] + g["A41"] + g["A42"] + g["A43"]
                + A5_red)
    A_needed = (2.0 / 3.0) * g["A"]
    r.add_step("A available within reduced limit",
               "A1_red + A2 + A3 + A4 + A5_red", A_within)
    r.add_step("2/3 * A required", "App. 1-7", A_needed)

    if is_large:
        r.add_check("2/3 of A available within 0.75 of the parallel limit",
                    A_within >= A_needed)
        r.add_note("Opening exceeds UG-36(b)(1) — App. 1-7 applies IN "
                   "ADDITION to UG-37. The area_reinforcement() result must "
                   "pass as well; this check does not replace it.")
    else:
        r.add_note("Opening is within UG-36(b)(1), so App. 1-7 does not "
                   "apply. The reduced-limit figures above are informational.")

    r.results["d_max_UG36"] = d_max
    r.results["d_over_D"] = ratio
    r.results["limit_parallel"] = limit_par
    r.results["limit_reduced"] = limit_red
    r.results["A_within_reduced"] = A_within
    r.results["A_two_thirds"] = A_needed
    r.results["app_1_7_required"] = 1.0 if is_large else 0.0
    return r


def ug45_neck_thickness(P, Rn, Sn, CA=0.0, units="SI",
                        nps=None, t_nominal=None, is_pipe=True,
                        tr_shell_e1=0.0, P_ext=None):
    """UG-45 minimum nozzle-neck thickness check.

    P           : internal design pressure
    Rn          : nozzle inside radius, corroded
    Sn          : nozzle allowable stress
    tr_shell_e1 : required shell/head thickness at the location, E=1,
                  EXCLUDING corrosion allowance (used for t_b1)
    nps         : nominal pipe size (inches) - enables the t_b3 STD-wall cap
    t_nominal   : nominal neck thickness to compare against (optional)
    is_pipe     : apply 12.5% mill undertolerance to t_nominal
    """
    r = CalcResult("Nozzle neck minimum thickness", "ASME BPVC VIII-1 UG-45")
    mm = units.upper() == "SI"
    ug16_min = 1.5 if mm else 0.0625  # UG-16(b) minimum, excl. CA

    r.add_input("P", float(P))
    r.add_input("Rn (corroded)", float(Rn))
    r.add_input("Sn", float(Sn))
    r.add_input("CA", float(CA))

    # t_a: neck required for pressure (E=1) + CA, not less than UG-16(b)+CA
    trn = P * Rn / (Sn - 0.6 * P)
    if P_ext is not None:
        trn = max(trn, P_ext * Rn / (Sn - 0.6 * P_ext))  # simplified
    ta = max(trn, ug16_min) + CA
    r.add_step("t_a", "max(trn(E=1), UG-16 min) + CA", ta)

    # t_b1: shell required thickness (E=1) + CA, not less than UG-16(b)+CA
    tb1 = max(tr_shell_e1, ug16_min) + CA
    r.add_step("t_b1", "max(tr_shell(E=1), UG-16 min) + CA", tb1)

    # t_b3: STD-wall pipe x 0.875 + CA
    if nps is not None and nps in B3610_STD_WALL_IN:
        std_wall = B3610_STD_WALL_IN[nps] * (IN_TO_MM if mm else 1.0)
        tb3 = std_wall * 0.875 + CA
        r.add_step("t_b3", "0.875 * STD wall + CA", tb3)
        tb = min(tb3, tb1)
    else:
        tb = tb1
        r.add_step("t_b3", "n/a (NPS not given)", 0.0)

    t_ug45 = max(ta, tb)
    r.add_step("t_UG-45", "max(t_a, min(t_b3, t_b1))", t_ug45)
    r.results["t_UG45"] = t_ug45

    if t_nominal is not None:
        t_avail = t_nominal * (0.875 if is_pipe else 1.0)
        r.add_step("t_avail", "t_nom * 0.875 (pipe tol.)" if is_pipe else "t_nom",
                   t_avail)
        r.add_check("t_avail >= t_UG-45", t_avail >= t_ug45)
        r.results["t_available"] = t_avail
    return r

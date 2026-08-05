"""Wind and seismic loads on a vertical vessel, and the ASME combined
longitudinal stress check.

Division of responsibility — read this first:

  * Deriving the design wind pressure q(z) and the seismic base shear
    coefficient Cs is a BUILDING CODE matter (ASCE 7, KDS 41 17 00, EN 1991,
    or the client's spec), not an ASME matter. Those tables and maps are
    copyrighted and jurisdiction-specific, so nothing is bundled here:
    q per segment and Cs are user input, exactly like allowable stresses.
  * What this module does is the part that is pure statics plus ASME:
    sum the segment forces into a shear and moment at any elevation
    (:func:`wind_load`, :func:`seismic_load`), then combine that moment with
    pressure and weight into the longitudinal stresses UG-22 requires to be
    considered (:func:`combined_longitudinal`).

Scope / limitations (see README):
  * Vertical cylindrical vessel, segment-wise projected area. Attachments
    (platforms, ladders, piping, insulation) must be included by the user
    either in a segment width or as an extra segment.
  * Seismic uses the equivalent lateral force method with a vertical
    distribution exponent k. Dynamic/modal analysis, sloshing, and
    vessel-specific response spectra are not covered.
  * The allowable longitudinal COMPRESSIVE stress is user input. UG-23(b)
    routes it to the factor B of UG-28(c), which comes from the Sec II-D
    external-pressure charts — copyrighted, so not bundled. Pass B_allow.
  * Load combinations (which of wind/seismic/pressure act together, and with
    what factors) are the user's call per UG-22 and the governing code.

Units: any single consistent set (SI: mm, MPa, N).
"""

import math

from .report import CalcResult


def _segment_geometry(segments, required, elevation):
    """Validate segments and return them sorted bottom-up."""
    if not segments:
        raise ValueError("at least one segment is required")
    out = []
    for i, seg in enumerate(segments):
        missing = [key for key in ("z_bottom", "z_top") + required
                   if key not in seg]
        if missing:
            raise ValueError(f"segment {i} is missing {missing}")
        if seg["z_top"] <= seg["z_bottom"]:
            raise ValueError(f"segment {i}: z_top must exceed z_bottom")
        out.append(dict(seg))
    out.sort(key=lambda s: s["z_bottom"])
    if elevation > out[-1]["z_top"]:
        raise ValueError("elevation is above the top of the vessel")
    return out


def wind_load(segments, elevation=0.0):
    """Wind shear and overturning moment at `elevation`.

    segments : list of dicts, each with
                 z_bottom, z_top : elevations of the segment (from grade)
                 width           : projected width (OD + insulation, or the
                                   effective width of an attachment)
                 q               : design wind pressure for that segment,
                                   from the governing building code
                 Cf              : force coefficient / shape factor
                                   (optional, default 1.0)
    elevation : level at which the shear and moment are reported, usually the
                base (0.0). Segments below it are ignored; a segment that
                straddles it is truncated.

    Force per segment = q * Cf * width * height, applied at its centroid.
    """
    segs = _segment_geometry(segments, ("width", "q"), elevation)
    r = CalcResult("Wind shear and moment on a vertical vessel",
                   "statics; q from the governing building code (user input)")
    r.add_input("elevation of interest", float(elevation))

    V = 0.0
    M = 0.0
    for i, seg in enumerate(segs):
        z0 = max(seg["z_bottom"], elevation)
        z1 = seg["z_top"]
        if z1 <= z0:
            continue
        Cf = float(seg.get("Cf", 1.0))
        h = z1 - z0
        F = seg["q"] * Cf * seg["width"] * h
        arm = 0.5 * (z0 + z1) - elevation
        V += F
        M += F * arm
        r.add_step(f"segment {i} ({z0:g}-{z1:g})",
                   f"F = q*Cf*w*h = {seg['q']:g}*{Cf:g}*{seg['width']:g}*{h:g}",
                   F)
        r.add_step(f"  arm {i}", "centroid above elevation", arm)

    r.add_step("V (total shear)", "sum of segment forces", V)
    r.add_step("M (overturning moment)", "sum of F*arm", M)
    r.add_note("q and Cf are user input from the governing wind code "
               "(ASCE 7, KDS 41, EN 1991...). Attachments such as platforms, "
               "ladders, piping and insulation must be in the widths.")
    r.results["V"] = V
    r.results["M"] = M
    return r


def seismic_load(segments, Cs, k=1.0, elevation=0.0):
    """Seismic base shear and moment by the equivalent lateral force method.

    segments : list of dicts with z_bottom, z_top and weight (the operating
               weight lumped at that segment)
    Cs       : seismic response coefficient from the governing code
    k        : vertical distribution exponent. 1.0 gives a linear (inverted
               triangular) distribution, 2.0 a parabolic one, 0.0 a uniform
               one. ASCE 7 uses k = 1 for short-period and 2 for long-period
               structures, interpolating in between.
    elevation: level at which the shear and moment are reported.

    V = Cs * sum(W); each segment takes Fi = V * Wi*zi^k / sum(Wj*zj^k).
    """
    segs = _segment_geometry(segments, ("weight",), elevation)
    r = CalcResult("Seismic shear and moment (equivalent lateral force)",
                   "statics; Cs from the governing seismic code (user input)")
    r.add_input("Cs (response coefficient)", float(Cs))
    r.add_input("k (distribution exponent)", float(k))
    r.add_input("elevation of interest", float(elevation))

    W_total = sum(s["weight"] for s in segs)
    V = Cs * W_total
    r.add_step("W (total weight)", "sum of segment weights", W_total)
    r.add_step("V (base shear)", "Cs*W", V)

    # Centroid heights measured from grade, per the code's z datum.
    denom = sum(s["weight"] * (0.5 * (s["z_bottom"] + s["z_top"])) ** k
                for s in segs)
    if denom <= 0.0:
        raise ValueError("weights and elevations give a zero distribution "
                         "denominator — check the segment data")

    M = 0.0
    for i, seg in enumerate(segs):
        zc = 0.5 * (seg["z_bottom"] + seg["z_top"])
        Fi = V * seg["weight"] * zc ** k / denom
        arm = zc - elevation
        if arm <= 0.0:
            continue
        M += Fi * arm
        r.add_step(f"segment {i} (zc = {zc:g})", "Fi = V*Wi*zi^k/sum", Fi)
        r.add_step(f"  arm {i}", "centroid above elevation", arm)

    r.add_step("M (overturning moment)", "sum of Fi*arm", M)
    r.add_note("Cs is user input from the governing seismic code. Equivalent "
               "lateral force only — no modal analysis, sloshing or "
               "vessel-specific response spectrum.")
    r.results["V"] = V
    r.results["M"] = M
    r.results["W_total"] = W_total
    return r


def combined_longitudinal(P, Rm, t, S, E=1.0, M=0.0, W_axial=0.0,
                          B_allow=None):
    """UG-22 combined longitudinal stress: pressure + bending + axial weight.

    P       : internal design pressure (use 0.0 for the empty/erection case,
              which usually governs the compressive side)
    Rm, t   : shell mean radius and thickness, corroded
    S, E    : allowable stress and longitudinal joint efficiency
    M       : bending moment at the section, from wind_load()/seismic_load()
    W_axial : axial compressive load at the section (weight above it),
              positive as compression
    B_allow : allowable longitudinal COMPRESSIVE stress. UG-23(b) sets this
              to the lesser of S and the factor B of UG-28(c) step 3, which
              comes from the copyrighted Sec II-D charts. Pass your B value;
              if omitted, S*E is used and the sheet says so, which is
              UNCONSERVATIVE for a thin shell prone to buckling.

    Sign convention: tension positive. The windward side adds the bending
    stress, the leeward side subtracts it.
    """
    r = CalcResult("Combined longitudinal stress (pressure + moment + weight)",
                   "ASME BPVC VIII-1 UG-22, UG-23(b)")
    area = 2.0 * math.pi * Rm * t          # shell cross-sectional area
    section = math.pi * Rm ** 2 * t        # section modulus about the axis

    for name, val, note in [("P", P, ""), ("Rm (mean radius)", Rm, ""),
                            ("t (corroded)", t, ""), ("S", S, ""),
                            ("E (long. joint)", E, ""),
                            ("M (bending moment)", M, ""),
                            ("W_axial (compression)", W_axial, "")]:
        r.add_input(name, float(val), note=note)

    s_press = P * Rm / (2.0 * t)
    s_bend = M / section
    s_axial = W_axial / area
    r.add_step("sigma_pressure", "P*Rm/(2*t)", s_press)
    r.add_step("sigma_bending", "M/(pi*Rm^2*t)", s_bend)
    r.add_step("sigma_axial", "W/(2*pi*Rm*t)", s_axial)

    s_windward = s_press + s_bend - s_axial
    s_leeward = s_press - s_bend - s_axial
    r.add_step("sigma_windward", "press + bend - axial", s_windward)
    r.add_step("sigma_leeward", "press - bend - axial", s_leeward)

    S_ten = S * E
    if B_allow is None:
        S_comp = S_ten
        r.add_note("B_allow not supplied — the compressive limit fell back to "
                   "S*E. UG-23(b) requires the lesser of S and the factor B "
                   "of UG-28(c); supply B_allow for a thin shell.")
    else:
        S_comp = min(S, B_allow)
    r.add_step("allowable tension", "S*E", S_ten)
    r.add_step("allowable compression", "min(S, B)" if B_allow else "S*E (!)",
               S_comp)

    governing = max(s_windward, s_leeward)
    most_comp = min(s_windward, s_leeward)
    r.add_check("max tension <= S*E", governing <= S_ten)
    if most_comp < 0.0:
        r.add_check("max compression <= allowable", -most_comp <= S_comp)
    else:
        r.add_step("net compression", "none — pressure keeps both sides in "
                   "tension", 0.0)

    r.add_note("Which loads act together, and with what factors, is the "
               "user's call per UG-22 and the governing code. Run the empty "
               "case (P = 0) separately - it usually governs compression.")
    r.results["sigma_pressure"] = s_press
    r.results["sigma_bending"] = s_bend
    r.results["sigma_axial"] = s_axial
    r.results["sigma_windward"] = s_windward
    r.results["sigma_leeward"] = s_leeward
    r.results["S_tension_allow"] = S_ten
    r.results["S_compression_allow"] = S_comp
    return r

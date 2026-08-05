"""Horizontal vessels on two saddle supports — Zick's analysis.

Code basis: ASME VIII-2 Part 4.15, which is the codified form of L. P. Zick's
1951 method. VIII-1 has no mandatory saddle rules (UG-22 only requires that
support loadings be considered), so VIII-2 4.15 is the usual reference for a
VIII-1 vessel too.

Scope / limitations (see README):
  * Two symmetric saddles, uniformly loaded horizontal cylinder with formed
    heads. One saddle load Q is user input (weight + contents, per saddle).
  * Shell unstiffened, stiffened by the head (a <= Rm/2), or stiffened by a
    ring in the plane of the saddle. Optional reinforcing (wear) plate.
  * NOT covered: stiffening rings adjacent to but not in the saddle plane
    (VIII-2 eq. 4.15.30-4.15.42), which need the K9/K10 coefficients and the
    rho root — those could not be anchored to published values. Also not
    covered: the saddle splitting force and the saddle steel itself (web,
    base plate, anchor bolts), three or more saddles, and longitudinal loads.
  * theta >= 120 deg is required by VIII-2 4.15; smaller angles are flagged.

Verification of the K coefficients: at theta = 150 deg the closed forms below
reproduce published Table 4.15.1 values to within 0.02%
(K1 0.160673/0.1607, K2 0.798847/0.7988, K3 0.485135/0.4851,
 K4 0.295241/0.2952, K5 0.673288/0.6733, K6 0.031675/0.0317,
 K8 0.302093/0.3021). See comparison/Saddle_verification.md.

Units: any single consistent set (SI: mm, MPa, N).
"""

import math

from .report import CalcResult

HEAD_TYPES = ("torispherical", "ellipsoidal", "hemispherical", "flat")
STIFFENING = ("none", "head", "ring_in_plane")


def zick_coefficients(theta_deg, a_over_Rm=1.0):
    """VIII-2 Table 4.15.1 coefficients as closed-form functions of theta.

    theta_deg  : total saddle contact angle, degrees
    a_over_Rm  : a/Rm, the saddle-to-tangent distance over the mean radius;
                 only K7 depends on it

    Returns a dict of the angles alpha/beta/delta (radians) and K1, K1p,
    K2..K8. K1 and K1p are the *raw* coefficients: the longitudinal stress
    formulas carry pi explicitly, i.e. sigma = M1/(K1*pi*Rm^2*t). Sources
    that tabulate K1 = 0.3357 at theta = 120 deg have folded pi in.
    """
    theta = math.radians(theta_deg)
    alpha = 0.95 * (math.pi - 0.5 * theta)
    beta = math.pi - 0.5 * theta
    delta = math.pi / 6.0 + 5.0 * theta / 12.0

    sd, cd = math.sin(delta), math.cos(delta)
    sa, ca = math.sin(alpha), math.cos(alpha)
    sb, cb = math.sin(beta), math.cos(beta)

    num1 = delta + sd * cd - 2.0 * sd * sd / delta
    K1 = num1 / (math.pi * (sd / delta - cd))
    K1p = num1 / (math.pi * (1.0 - sd / delta))

    den_a = math.pi - alpha + sa * ca
    K2 = sa / den_a
    K3 = (sa / math.pi) * ((alpha - sa * ca) / den_a)
    K4 = 0.375 * sa * sa / den_a
    K5 = (1.0 + ca) / den_a

    sbb = sb / beta
    # Shared denominator group of the K6/K8 expressions.
    t7 = sbb ** 2 - 0.5 - 0.25 * math.sin(2.0 * beta) / beta
    num6 = (0.75 * cb * sbb ** 2 - 1.25 * sb * cb * (cb / beta)
            + 0.5 * cb ** 3 - 0.25 * sbb + 0.25 * cb - beta * sb * t7)
    K6 = num6 / (2.0 * math.pi * t7)

    # K7 is K6 scaled by how much the head stiffens the saddle region.
    if a_over_Rm <= 0.5:
        K7 = 0.25 * K6
    elif a_over_Rm >= 1.0:
        K7 = K6
    else:
        K7 = 1.5 * K6 * a_over_Rm - 0.5 * K6

    num8 = cb * (1.0 - 0.25 * math.cos(2.0 * beta)
                 + 2.25 * sb * cb / beta - 3.0 * sbb ** 2)
    K8 = num8 / (2.0 * math.pi * t7) + beta * sb / (2.0 * math.pi)

    return {"alpha": alpha, "beta": beta, "delta": delta,
            "K1": K1, "K1p": K1p, "K2": K2, "K3": K3, "K4": K4,
            "K5": K5, "K6": K6, "K7": K7, "K8": K8}


def saddle_analysis(P, Rm, ts, L, a, b, theta_deg, H, Q, Ey, S,
                    th=None, Sh=None, Ri=None, head_type="ellipsoidal",
                    stiffening="none", saddle_welded=True, exceptional=False,
                    E_joint=1.0, tr=0.0, b1=None, theta1_deg=None, Sr=None):
    """VIII-2 4.15 stresses for one saddle of a two-saddle horizontal vessel.

    P          : internal design pressure (0 for an empty/erection case)
    Rm, ts     : shell mean radius and thickness (corroded)
    L          : tangent-to-tangent length of the cylinder
    a          : distance from the saddle centreline to the head tangent line
    b          : saddle width along the axis
    theta_deg  : saddle contact angle (>= 120 per VIII-2 4.15)
    H          : head depth (h2) — 0 for flat heads, Ri/2 for a 2:1 ellipsoid
    Q          : load on ONE saddle (weight + contents + any load factor)
    Ey         : shell modulus of elasticity at temperature
    S          : shell allowable stress; Sh: head allowable (defaults to S)
    th, Ri     : head thickness and inside radius (needed for the head checks)
    head_type  : "torispherical" | "ellipsoidal" | "hemispherical" | "flat"
    stiffening : "none", "head" (valid when a <= Rm/2), or "ring_in_plane"
    saddle_welded : saddle welded to the shell -> k = 0.1, else k = 1.0
    exceptional   : exceptional/erection load case -> Sc factor 1.35
    E_joint    : longitudinal joint efficiency for the tension checks
    tr, b1, theta1_deg, Sr : reinforcing (wear) plate thickness, width,
                 included angle and allowable stress. tr = 0 means no plate.
    """
    if head_type not in HEAD_TYPES:
        raise ValueError(f"head_type must be one of {HEAD_TYPES}")
    if stiffening not in STIFFENING:
        raise ValueError(f"stiffening must be one of {STIFFENING}")
    r = CalcResult("Horizontal vessel on two saddles (Zick)",
                   "ASME BPVC VIII-2 4.15")
    if Sh is None:
        Sh = S
    if th is None:
        th = ts
    if Ri is None:
        Ri = Rm - 0.5 * ts

    has_plate = tr > 0.0
    k = 0.1 if saddle_welded else 1.0
    a_over_Rm = a / Rm
    Kc = zick_coefficients(theta_deg, a_over_Rm)
    K1, K1p = Kc["K1"], Kc["K1p"]
    K2, K3, K4, K5, K7 = Kc["K2"], Kc["K3"], Kc["K4"], Kc["K5"], Kc["K7"]

    for name, val, note in [
            ("P", P, ""), ("Rm (mean radius)", Rm, ""), ("ts", ts, ""),
            ("L (tangent-tangent)", L, ""), ("a (saddle to tangent)", a, ""),
            ("b (saddle width)", b, ""), ("theta (deg)", theta_deg, ""),
            ("H (head depth)", H, ""), ("Q (one saddle)", Q, ""),
            ("a/Rm", a_over_Rm, "head stiffens if <= 0.5"),
            ("k", k, "0.1 welded, 1.0 not welded"),
            ("K1", K1, "pi carried in the stress formula"),
            ("K1'", K1p, ""), ("K2", K2, ""), ("K3", K3, ""),
            ("K4", K4, ""), ("K5", K5, ""), ("K7", K7, "")]:
        r.add_input(name, float(val), note=note)

    # --- applicability ---
    r.add_check("theta >= 120 deg (VIII-2 4.15)", theta_deg >= 120.0)
    r.add_check("a <= 0.5*L (saddle inside the span)", a <= 0.5 * L)
    if stiffening == "head":
        r.add_check("head stiffens the saddle: a <= Rm/2", a <= 0.5 * Rm)

    # --- VIII-2 4.15.3-4.15.5 moments and shear force ---
    M1 = -Q * a * (1.0 - (1.0 - a / L + (Rm ** 2 - H ** 2) / (2.0 * a * L))
                   / (1.0 + 4.0 * H / (3.0 * L)))
    M2 = 0.25 * Q * L * ((1.0 + 2.0 * (Rm ** 2 - H ** 2) / L ** 2)
                         / (1.0 + 4.0 * H / (3.0 * L)) - 4.0 * a / L)
    T = Q * (L - 2.0 * a) / (L + 4.0 * H / 3.0)
    r.add_step("M1 (at saddle)", "eq. 4.15.3, hogging (negative)", M1)
    r.add_step("M2 (at mid-span)", "eq. 4.15.4, sagging", M2)
    r.add_step("T (shear at saddle)", "Q*(L-2a)/(L+4H/3)", T)

    # --- 4.15.6-4.15.11 longitudinal stresses ---
    press = P * Rm / (2.0 * ts)
    sec = math.pi * Rm ** 2 * ts
    sigma1 = press - M2 / sec
    sigma2 = press + M2 / sec
    r.add_step("sigma1 (mid-span, top)", "P*Rm/2ts - M2/(pi*Rm^2*ts)", sigma1)
    r.add_step("sigma2 (mid-span, bottom)", "P*Rm/2ts + M2/(pi*Rm^2*ts)", sigma2)

    stiffened = stiffening in ("head", "ring_in_plane")
    if stiffened:
        sigma3 = press - M1 / sec
        sigma4 = press + M1 / sec
        f3 = "P*Rm/2ts - M1/(pi*Rm^2*ts)  [stiffened]"
        f4 = "P*Rm/2ts + M1/(pi*Rm^2*ts)  [stiffened]"
    else:
        sigma3 = press - M1 / (K1 * sec)
        sigma4 = press + M1 / (K1p * sec)
        f3 = "P*Rm/2ts - M1/(K1*pi*Rm^2*ts)"
        f4 = "P*Rm/2ts + M1/(K1'*pi*Rm^2*ts)"
    r.add_step("sigma3 (saddle, top)", f3, sigma3)
    r.add_step("sigma4 (saddle, bottom)", f4, sigma4)

    # --- 4.15.12 allowable compressive stress ---
    Sc = (1.35 if exceptional else 1.0) * ts * Ey / (16.0 * Rm)
    r.add_step("Sc (allowable compressive)", "K*ts*Ey/(16*Rm)", Sc)

    # --- 4.15.13-4.15.17 tangential shear ---
    if stiffening == "ring_in_plane":
        tau = T / (math.pi * Rm * ts)
        tau_f = "T/(pi*Rm*ts)  [ring in saddle plane]"
    elif stiffening == "head":
        tau = K3 * Q / (Rm * ts)
        tau_f = "K3*Q/(Rm*ts)  [stiffened by head]"
    else:
        tau = K2 * T / (Rm * ts)
        tau_f = "K2*T/(Rm*ts)  [unstiffened]"
    r.add_step("tau (tangential shear)", tau_f, tau)

    tau_head = K3 * Q / (Rm * th) if stiffening == "head" else 0.0
    if stiffening == "head":
        r.add_step("tau* (in the head)", "K3*Q/(Rm*th)", tau_head)

    # --- 4.15.18-4.15.19 head membrane stress (only when the head stiffens) ---
    sigma5 = 0.0
    if stiffening == "head" and head_type != "flat":
        if head_type == "torispherical":
            sigma5 = K4 * Q / (Rm * th) + P * Ri / (2.0 * th)
            f5 = "K4*Q/(Rm*th) + P*Ri/(2*th)"
        else:
            sigma5 = K4 * Q / (Rm * th) + P * Ri ** 2 / (2.0 * th * H)
            f5 = "K4*Q/(Rm*th) + P*Ri^2/(2*th*H)"
        r.add_step("sigma5 (head membrane)", f5, sigma5)

    # --- 4.15.22 contributing shell width ---
    # x1 = x2 = 0.78*sqrt(Rm*ts), but no more shell is available than the
    # distance to the tangent line.
    x = min(0.78 * math.sqrt(Rm * ts), a)
    r.add_step("x1 = x2 (contributing width)", "min(0.78*sqrt(Rm*ts), a)", x)

    # --- 4.15.23-4.15.28 circumferential stresses at the saddle ---
    if has_plate:
        if b1 is None:
            b1 = min(b + 1.56 * math.sqrt(Rm * ts), 2.0 * a)
        eta = min(Sr / S, 1.0) if Sr else 1.0
        t_eff = ts + eta * tr
        theta1_min = theta_deg + theta_deg / 12.0
        r.add_input("tr (wear plate)", float(tr))
        r.add_step("b1 (wear plate width)", "min(b + 1.56*sqrt(Rm*ts), 2a)", b1)
        r.add_step("eta", "min(Sr/S, 1)", eta)
        r.add_step("t_eff", "ts + eta*tr", t_eff)
        if theta1_deg is not None:
            r.add_check("theta1 >= theta + theta/12 (eq. 4.15.2)",
                        theta1_deg >= theta1_min - 1e-9)
        sigma6 = -K5 * Q * k / (b1 * t_eff)
        f6 = "-K5*Q*k/(b1*t_eff)"
        if L >= 8.0 * Rm:
            sigma7 = (-Q / (4.0 * t_eff * b1)
                      - 3.0 * K7 * Q / (2.0 * t_eff ** 2))
            f7 = "-Q/(4*t_eff*b1) - 3*K7*Q/(2*t_eff^2)   [L >= 8Rm]"
        else:
            sigma7 = (-Q / (4.0 * t_eff * b1)
                      - 12.0 * K7 * Q * Rm / (L * t_eff ** 2))
            f7 = "-Q/(4*t_eff*b1) - 12*K7*Q*Rm/(L*t_eff^2)   [L < 8Rm]"
    else:
        width = b + 2.0 * x
        sigma6 = -K5 * Q * k / (ts * width)
        f6 = "-K5*Q*k/(ts*(b + x1 + x2))"
        if L >= 8.0 * Rm:
            sigma7 = -Q / (4.0 * ts * width) - 3.0 * K7 * Q / (2.0 * ts ** 2)
            f7 = "-Q/(4*ts*(b+x1+x2)) - 3*K7*Q/(2*ts^2)   [L >= 8Rm]"
        else:
            sigma7 = (-Q / (4.0 * ts * width)
                      - 12.0 * K7 * Q * Rm / (L * ts ** 2))
            f7 = "-Q/(4*ts*(b+x1+x2)) - 12*K7*Q*Rm/(L*ts^2)   [L < 8Rm]"
    r.add_step("sigma6 (circ. membrane, base)", f6, sigma6)
    r.add_step("sigma7 (circ. horn, memb.+bend.)", f7, sigma7)

    # --- allowable checks ---
    S_ten = S * E_joint
    S_comp = min(S, Sc)
    for tag, sig in (("sigma1", sigma1), ("sigma2", sigma2),
                     ("sigma3", sigma3), ("sigma4", sigma4)):
        if sig >= 0.0:
            r.add_check(f"{tag} <= S*E (tension)", sig <= S_ten)
        else:
            r.add_check(f"|{tag}| <= min(S, Sc) (compression)",
                        -sig <= S_comp)
    r.add_check("tau <= 0.8*S", abs(tau) <= 0.8 * S)
    if stiffening == "head":
        r.add_check("tau* <= 0.8*Sh (head)", abs(tau_head) <= 0.8 * Sh)
        if head_type != "flat":
            r.add_check("sigma5 <= 1.25*Sh (head membrane)", sigma5 <= 1.25 * Sh)
    r.add_check("|sigma6| <= S (circ. membrane)", abs(sigma6) <= S)
    r.add_check("|sigma7| <= 1.25*S (circ. memb.+bending)",
                abs(sigma7) <= 1.25 * S)

    r.add_note("Saddle steel (web, base plate, anchor bolts), the saddle "
               "splitting force and stiffening rings NOT in the saddle plane "
               "are not covered. Q is user input - self weight, contents and "
               "any load combination factor must already be in it.")
    r.results["M1"] = M1
    r.results["M2"] = M2
    r.results["T"] = T
    r.results["Sc"] = Sc
    r.results["sigma1"] = sigma1
    r.results["sigma2"] = sigma2
    r.results["sigma3"] = sigma3
    r.results["sigma4"] = sigma4
    r.results["sigma5"] = sigma5
    r.results["sigma6"] = sigma6
    r.results["sigma7"] = sigma7
    r.results["tau"] = tau
    r.results["tau_head"] = tau_head
    return r

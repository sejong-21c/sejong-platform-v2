"""Hand-verified test cases for pvcalc. Run:  python tests/run_tests.py

Expected values below were computed independently by hand (long-hand
arithmetic from the code equations) so they check the implementation,
not themselves. Tolerances are tight (0.1%).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pvcalc import (cylinder_thickness, cylinder_mawp, sphere_thickness,
                    ellipsoidal_thickness, torispherical_thickness,
                    hemispherical_thickness, conical_thickness,
                    cylinder_maep, cylinder_thickness_for_external,
                    area_reinforcement, weld_strength, large_opening_check,
                    ug45_neck_thickness,
                    static_head, flange_bolt_loads, flange_stresses,
                    figure_2_7_1, table_2_7_1, saddle_analysis,
                    zick_coefficients, wind_load, seismic_load,
                    combined_longitudinal)

FAIL = []


def close(actual, expected, rel=1e-3, label=""):
    ok = math.isclose(actual, expected, rel_tol=rel)
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {label}: got {actual:.6g}, expected {expected:.6g}")
    if not ok:
        FAIL.append(label)


def check(cond, label):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}")
    if not cond:
        FAIL.append(label)


print("== UG-27 cylinder, internal pressure ==")
# Hand calc: P=1.0 MPa, R=1000 mm, S=138 MPa, E=1.0
# t_circ = 1.0*1000/(138*1 - 0.6*1.0) = 1000/137.4 = 7.27802 mm
r = cylinder_thickness(P=1.0, R=1000.0, S=138.0, E=1.0)
close(r.results["t_req"], 7.27802, label="t_req cylinder")
check(r.results["governing"] == "circumferential", "circ governs")
check(r.ok, "applicability checks pass")

# MAWP hand calc: t=8, R=1000: 138*8/(1000+4.8) = 1104/1004.8 = 1.098726 MPa
r = cylinder_mawp(t=8.0, R=1000.0, S=138.0, E=1.0)
close(r.results["MAWP"], 1.098726, label="MAWP cylinder")

# Round trip: thickness at MAWP must equal available thickness
r2 = cylinder_thickness(P=1.098726, R=1000.0, S=138.0, E=1.0)
close(r2.results["t_req"], 8.0, label="round trip t(MAWP(t)) = t")

print("== UG-27 sphere ==")
# t = 1.0*1000/(2*138 - 0.2) = 1000/275.8 = 3.625816 mm
r = sphere_thickness(P=1.0, R=1000.0, S=138.0)
close(r.results["t_req"], 3.625816, label="t_req sphere")

print("== UG-32 heads ==")
# 2:1 ellipsoidal: t = 1.0*2000/(2*138 - 0.2) = 2000/275.8 = 7.251632 mm
r = ellipsoidal_thickness(P=1.0, D=2000.0, S=138.0)
close(r.results["t_req"], 7.251632, label="t_req 2:1 ellipsoidal")

# Standard torispherical: t = 0.885*1*2000/(138 - 0.1) = 1770/137.9 = 12.83539
r = torispherical_thickness(P=1.0, L=2000.0, S=138.0)
close(r.results["t_req"], 12.83539, label="t_req std torispherical")

# App.1-4(d): L=2000, r=120 -> L/r=16.6667, M=(3+sqrt(16.6667))/4=1.770620
# t = 1*2000*1.770620/275.8 = 12.83987
r = torispherical_thickness(P=1.0, L=2000.0, S=138.0, r_knuckle=120.0)
close(r.results["M"], 1.770620, label="M factor")
close(r.results["t_req"], 12.83987, label="t_req general torispherical")

# Hemispherical: t = 1*1000/275.8 = 3.625816
r = hemispherical_thickness(P=1.0, L=1000.0, S=138.0)
close(r.results["t_req"], 3.625816, label="t_req hemispherical")

# Conical 15 deg: t = 1*2000/(2*cos15*(138-0.6)) = 2000/(1.931852*137.4)
#               = 2000/265.4364 = 7.534741
r = conical_thickness(P=1.0, D=2000.0, alpha_deg=15.0, S=138.0)
close(r.results["t_req"], 7.534741, label="t_req conical")

print("== VIII-2 4.4.5 external pressure ==")
# Hand calc: Do=2000, t=10, L=3000, Ey=195000, Sy=205
# Mx = 3000/sqrt(1000*10) = 30; 13 < 30 < 2*200^0.94=291.6
# Ch = 1.12*30^-1.058 = 1.12*exp(-1.058*ln30) = 0.0306450
# Fhe = 1.6*0.0306450*195000*10/2000 = 47.8062
# Fhe/Sy = 0.23320 <= 0.552 -> Fic = Fhe, FS = 2.0
# Pa = 2*(47.8062/2)*10/2000 = 0.239031 MPa
r = cylinder_maep(Do=2000.0, t=10.0, L=3000.0, Ey=195000.0, Sy=205.0)
close(r.results["Pa"], 0.239031, label="Pa cylinder external")

# Thickness iteration must invert the MAEP function
t_min = cylinder_thickness_for_external(P_ext=0.239031, Do=2000.0, L=3000.0,
                                        Ey=195000.0, Sy=205.0)
close(t_min, 10.0, rel=1e-2, label="external thickness inversion")

print("== UG-37 nozzle reinforcement ==")
# Hand calc, all same material (fr=1), set-in, no pad:
# d=200, t=10, tr=7.27802, tn=8, trn=1.0*100/(138-0.6)=0.727802
# A  = 200*7.27802 = 1455.605
# excess = 10-7.27802 = 2.72198; A1 = max(200*2.72198, 2*18*2.72198)=544.395
# A2 = min(5*7.272198*10, 5*7.272198*8) = min(363.610, 290.888) = 290.888
# A41 = 6^2 = 36
# total = 871.283 < 1455.605 -> inadequate
r = area_reinforcement(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
                       Sv=138.0, Sn=138.0, leg_nozzle=6.0)
close(r.results["A_required"], 1455.605, label="A required")
close(r.results["A_available"], 871.283, label="A available (no pad)")
check(not r.ok, "correctly flagged inadequate without pad")

# Same nozzle with pad te=10, Dp=400, pad weld leg 6:
# A2 = min(363.610, 2*7.272198*(2.5*8+10)) = min(363.610, 436.332) = 363.610
# A5 = (400-200-16)*10 = 1840;  A42 = 36
# total = 544.395+363.610+36+36+1840 = 2820.005 -> adequate
r = area_reinforcement(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
                       Sv=138.0, Sn=138.0, te=10.0, Dp=400.0,
                       leg_nozzle=6.0, leg_pad=6.0)
close(r.results["A_available"], 2820.005, label="A available (with pad)")
check(r.ok, "adequate with pad")

# Set-on nozzle with weaker nozzle material: fr1=1 (set-on) but fr2=0.8
# A = d*tr only = 1455.605 (no 2nd term since fr1=1)
r = area_reinforcement(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.909753,
                       Sv=138.0, Sn=110.4, set_in=False, leg_nozzle=6.0)
close(r.results["A_required"], 1455.605, label="A required (set-on)")

print("== UG-41 / UW-15(c) attachment weld strength ==")
# Padded nozzle from above: d=200, tn=8 -> d_out=216, d_mean=208; Dp=400.
# All materials 138 MPa, so every fr = 1.0 and every weld allowable is
# a straight percentage of 138.  pi/2 = 1.5707963268.
# Nozzle wall shear = 1.5707963268*208*8 *0.70*138 = 252,493.57 N
# Fillet 41 (leg 6)  = 1.5707963268*216*6 *0.49*138 = 137,657.55
# Fillet 42 (leg 6)  = 1.5707963268*400*6 *0.49*138 = 254,921.39
# Groove noz (10)    = 1.5707963268*216*10*0.74*138 = 346,485.00
# Groove pad (10)    = same as groove noz              346,485.00
# total = 1,338,042.5 N
ar = area_reinforcement(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
                        Sv=138.0, Sn=138.0, te=10.0, Dp=400.0,
                        leg_nozzle=6.0, leg_pad=6.0)
r = weld_strength(ar, groove_nozzle=10.0, groove_pad=10.0)
close(r.results["strength_total"], 1338042.5, label="weld element strength sum")
# W  = (1455.605 - 544.395 + 2*8*1*(10 - 7.27802)) * 138 = 131,757.1 N
close(r.results["W"], 131757.1, label="W total weld load")
# W3-3 = (363.610 + 1840 + 36 + 36 + 2*8*10*1) * 138 = 336,114.2 -> governs
close(r.results["W_max"], 336114.2, label="W_max (W3-3 governs)")
check(r.ok, "padded nozzle welds adequate")

# Degenerate case: no attachment welds at all -> must fail.
# Only the nozzle wall resists: 1.5707963268*201*1*0.70*138 = 30,499.5 N
# W = (1455.604 - 544.396 + 2*1*1*(10 - 7.27802))*138 = 126,498.0 N governs
ar = area_reinforcement(d=200.0, t=10.0, tr=7.27802, tn=1.0, trn=0.727802,
                        Sv=138.0, Sn=138.0)
r = weld_strength(ar)
close(r.results["strength_total"], 30499.5, label="nozzle wall only strength")
close(r.results["W_max"], 126498.0, label="W_max, unwelded nozzle")
check(not r.ok, "correctly flagged unwelded attachment")

# Exemptions produce no verdict, only a note.
r = weld_strength(ar, external_pressure=True)
check(not r.checks and r.notes, "external pressure -> no weld check, note only")
r = weld_strength(ar, exempt_uw15b1=True)
check(not r.checks and r.notes, "UW-15(b)(1) exempt -> no weld check")

print("== UG-45 neck thickness ==")
# NPS 8 (STD wall 0.322 in = 8.1788 mm), P=1.0, Rn=100, Sn=138, CA=3, SI
# trn = 100/137.4 = 0.727802 ; t_a = max(0.7278, 1.5)+3 = 4.5
# t_b1 = max(7.27802, 1.5)+3 = 10.27802
# t_b3 = 8.1788*0.875+3 = 10.15645 ; t_b = min(10.15645, 10.27802) = 10.15645
# t_UG45 = max(4.5, 10.15645) = 10.15645
r = ug45_neck_thickness(P=1.0, Rn=100.0, Sn=138.0, CA=3.0, units="SI",
                        nps=8.0, tr_shell_e1=7.27802,
                        t_nominal=12.7, is_pipe=True)
close(r.results["t_UG45"], 10.15645, label="t_UG-45")
# available = 12.7*0.875 = 11.1125 >= 10.15645
check(r.ok, "SCH-checked nominal passes")

print("== App. 2 Table 2-7.1 hub factors (published anchor) ==")
# For a straight hub (g1 = g0, so A = 0) App. 2 gives F = 0.908920 and
# V = 0.550103.  This is an EXTERNAL check of the whole 37-constant chain,
# independent of anything computed here.
tab = table_2_7_1(g0=10.0, g1=10.0 + 1e-9, h=10.0, h0=54.772256)
close(tab["F"], 0.908920, rel=1e-5, label="Table 2-7.1 F at A->0")
close(tab["V"], 0.550103, rel=1e-5, label="Table 2-7.1 V at A->0")
close(tab["f"], 1.0, label="Table 2-7.1 f at A->0")
# The chain carries 1/C terms that survive A = 0, so F drifts slightly for a
# very long hub. Bound it so a future edit cannot silently break the chain.
tab_long = table_2_7_1(g0=10.0, g1=10.0 + 1e-9, h=150.0, h0=54.772256)
check(abs(tab_long["F"] / 0.908920 - 1.0) < 0.005,
      "F stays within 0.5% of anchor even at h/h0 = 2.7")

print("== App. 2 Fig. 2-7.1 shape factors ==")
# K = 1.5: log10(1.5) = 0.1760913, K^2 = 2.25
# common = 2.25*(1 + 8.55246*0.1760913) - 1 = 2.25*2.505807 - 1 = 4.638066
# T = 4.638066/((1.04720 + 1.9448*2.25)*0.5) = 4.638066/2.711500 = 1.710517
# U = 4.638066/(1.36136*1.25*0.5)            = 4.638066/0.850850 = 5.451017
# Y = 2*(0.66845 + 5.71690*(2.25*0.1760913)/1.25) = 2*2.480267 = 4.960534
# Z = 3.25/1.25 = 2.6
T, U, Y, Z = figure_2_7_1(1.5)
close(T, 1.710517, label="Fig. 2-7.1 T")
close(U, 5.451017, label="Fig. 2-7.1 U")
close(Y, 4.960534, label="Fig. 2-7.1 Y")
close(Z, 2.6, label="Fig. 2-7.1 Z")

print("== App. 2-5 flange bolt loads ==")
# Gasket contact OD 350, ID 320 -> N = 15, b_o = 7.5 mm > 6.35 mm limit
# b = 2.52*sqrt(7.5) = 2.52*2.7386128 = 6.9013 mm
# G = 350 - 2*6.9013 = 336.1974 mm
# H  = 0.785*336.1974^2*1.0 = 0.785*113028.69 = 88,727.5 N
# Hp = 2*6.9013*pi*336.1974*3.0 = 43,739.1 N
# Wm1 = 88,727.5 + 43,739.1 = 132,466.6 N
# Wm2 = pi*6.9013*336.1974*69 = 502,999.3 N
# Am1 = 132,466.6/172 = 770.2 ; Am2 = 502,999.3/172 = 2,924.4 -> seating governs
# W   = 0.5*(2,924.4 + 3,200)*172 = 3,062.2*172 = 526,699 N
bl = flange_bolt_loads(P=1.0, gasket_od=350.0, gasket_id=320.0, m=3.0, y=69.0,
                       Sb=172.0, Sa=172.0, Ab=3200.0, units="SI")
close(bl.results["b"], 6.9013, label="effective gasket width b")
close(bl.results["G"], 336.1974, label="gasket reaction diameter G")
close(bl.results["Wm1"], 132466.6, label="Wm1 operating bolt load")
close(bl.results["Wm2"], 502999.3, label="Wm2 seating bolt load")
close(bl.results["Am"], 2924.41, label="Am required bolt area")
close(bl.results["W_seating"], 526699.0, label="W seating design load")
check(bl.data["governing"] == "seating", "seating governs the bolting")
check(bl.ok, "Ab >= Am")

# b_o <= limit branch, US units: N = 0.25, b_o = 0.125 <= 0.25
# -> b = b_o = 0.125 in, G = mean of contact face = 13.25 in
us = flange_bolt_loads(P=150.0, gasket_od=13.5, gasket_id=13.0, m=3.0,
                       y=10000.0, Sb=25000.0, Sa=25000.0, Ab=5.0, units="US")
close(us.results["b"], 0.125, label="b = b_o (narrow gasket, US)")
close(us.results["G"], 13.25, label="G = mean dia. (narrow gasket, US)")

print("== App. 2-6/2-7 integral flange stresses ==")
# A=450, B=300, C=395, t=30, g0=10, g1=18, h=25
# HD = 0.785*300^2 = 70,650 ; HT = 88,727.5 - 70,650 = 18,077.5
# HG = 132,466.6 - 88,727.5 = 43,739.1
# hG = 0.5*(395 - 336.1974) = 29.4013
# R  = 0.5*(395 - 300) - 18 = 29.5 ; hD = 29.5 + 9 = 38.5
# hT = 0.5*(29.5 + 18 + 29.4013) = 38.4507
# Mo = 70,650*38.5 + 18,077.5*38.4507 + 43,739.1*29.4013
#    = 2,720,025 + 695,294 + 1,285,986 = 4,701,305 N-mm
st = flange_stresses(bl, flange_od=450.0, B=300.0, bolt_circle=395.0, t=30.0,
                     Sf=138.0, Sfa=138.0, flange_type="integral",
                     g0=10.0, g1=18.0, h=25.0)
close(st.results["Mo"], 4701305.0, label="Mo operating moment")
# Chain gives F = 0.840985, V = 0.265466, f = 1.104351 (F/V anchored above).
# h0 = sqrt(300*10) = 54.7723 ; e = 0.840985/54.7723 = 0.0153543
# d = (5.451017/0.265466)*54.7723*100 = 20.5323*54.7723*100 = 112,460
# L = (30*0.0153543 + 1)/1.710517 + 27,000/112,460 = 0.853919 + 0.240085 = 1.094004
# SH = 1.104351*4,701,305/(1.094004*324*300) = 5,191,528/106,337 = 48.82
# SR = (1.33*30*0.0153543 + 1)*Mo/(L*900*300) = 1.612637*4,701,305/295,381 = 25.66
# ST = 4.960534*4,701,305/270,000 - 2.6*25.66 = 86,376/1,000 - 66.72 = 19.64
close(st.results["SH_operating"], 48.82, label="SH operating")
close(st.results["SR_operating"], 25.66, label="SR operating")
close(st.results["ST_operating"], 19.64, label="ST operating")
check(st.ok, "integral flange passes all App. 2-8 limits")

# Over-bolting raises the seating moment: Ab = 4,000 makes (SH+SR)/2 fail.
bl_over = flange_bolt_loads(P=1.0, gasket_od=350.0, gasket_id=320.0, m=3.0,
                            y=69.0, Sb=172.0, Sa=172.0, Ab=4000.0, units="SI")
st_over = flange_stresses(bl_over, flange_od=450.0, B=300.0, bolt_circle=395.0,
                          t=30.0, Sf=138.0, Sfa=138.0, flange_type="integral",
                          g0=10.0, g1=18.0, h=25.0)
check(not st_over.ok, "over-bolted flange flagged on seating stresses")

print("== App. 2-7 loose flange without hub (ring) ==")
# hD = 0.5*(395 - 300) = 47.5 ; hT = 0.5*(47.5 + 29.4013) = 38.4507
# Mo = 70,650*47.5 + 18,077.5*38.4507 + 43,739.1*29.4013
#    = 3,355,875 + 695,294 + 1,285,986 = 5,337,155 N-mm
# t = 60: ST = Y*Mo/(t^2*B) = 4.960534*5,337,155/(3,600*300) = 24.51
rg = flange_stresses(bl, flange_od=450.0, B=300.0, bolt_circle=395.0, t=60.0,
                     Sf=138.0, Sfa=138.0, flange_type="ring")
close(rg.results["Mo"], 5337155.0, label="Mo ring flange")
close(rg.results["ST_operating"], 24.51, label="ST ring, operating")
check(rg.results["SH_operating"] == 0.0 and rg.results["SR_operating"] == 0.0,
      "ring flange has no hub or radial stress")
check(len(rg.checks) == 2, "ring flange checks ST only")
check(rg.ok, "ring flange passes")

print("== VIII-2 4.15 Zick coefficients (published Table 4.15.1 anchor) ==")
# EXTERNAL check: published Table 4.15.1 values at theta = 150 deg.
for name, pub in [("K1", 0.1607), ("K2", 0.7988), ("K3", 0.4851),
                  ("K4", 0.2952), ("K5", 0.6733), ("K6", 0.0317),
                  ("K8", 0.3021)]:
    close(zick_coefficients(150.0, a_over_Rm=1.0)[name], pub,
          label=f"Table 4.15.1 {name} at theta=150")
# theta = 120 deg: sources that tabulate K1 = 0.3357 have folded pi in.
k120 = zick_coefficients(120.0, a_over_Rm=1.0)
close(k120["K1"] * math.pi, 0.3357, rel=5e-3, label="K1*pi at theta=120")
close(k120["K1p"] * math.pi, 0.6041, rel=5e-3, label="K1'*pi at theta=120")
close(k120["K8"], 0.3399, rel=5e-3, label="K8 at theta=120")
# K7 scales K6 by a/Rm: 0.25*K6 below 0.5, K6 above 1.0, linear in between.
check(zick_coefficients(120.0, 0.4)["K7"] == 0.25 * k120["K6"],
      "K7 = 0.25*K6 for a/Rm <= 0.5")
check(zick_coefficients(120.0, 2.0)["K7"] == k120["K6"],
      "K7 = K6 for a/Rm >= 1.0")

print("== VIII-2 4.15 moments (beam-theory limits) ==")
# A long slender vessel with no overhang and flat heads is a simply supported
# beam carrying 2Q uniformly: M_mid = wL^2/8 = (2Q/L)*L^2/8 = Q*L/4.
# The head term leaves a residual M1 -> Q*Rm^2/(2L).
r = saddle_analysis(P=0.0, Rm=1000.0, ts=12.0, L=1.0e6, a=1.0e-6, b=200.0,
                    theta_deg=120.0, H=0.0, Q=1.0e5, Ey=195000.0, S=138.0)
close(r.results["M2"], 1.0e5 * 1.0e6 / 4.0, label="M2 -> Q*L/4 (beam limit)")
close(r.results["M1"], 1.0e5 * 1000.0 ** 2 / (2.0 * 1.0e6),
      label="M1 -> Q*Rm^2/(2L) (head term)")

print("== VIII-2 4.15 saddle stresses ==")
# Rm=1006, ts=12, L=6000, a=600, b=200, theta=120, H=500, Q=120,000, P=1.0
# a/L = 0.1 ; (Rm^2-H^2) = 762,036 ; 2aL = 7.2e6 -> 0.1058383
# 4H/3L = 0.1111111
# M1 = -120,000*600*[1 - 1.0058383/1.1111111] = -72e6*0.0947455 = -6,821,676
# M2 = 0.25*120,000*6000*[1.0423353/1.1111111 - 0.4] = 1.8e8*0.5381018
#    = 96,858,324
# T  = 120,000*4800/6666.667 = 86,400
# pi*Rm^2*ts = 38,152,858 ; P*Rm/2ts = 41.9167
# sigma1 = 41.9167 - 2.53896 = 39.3777 ; sigma2 = 44.4557
# K1 = 0.106611 -> sigma3 = 41.9167 + 6,821,676/4,067,535 = 43.5938
# K1'= 0.192348 -> sigma4 = 41.9167 - 6,821,676/7,338,626 = 40.9872
# Sc = 12*195,000/(16*1006) = 145.3778
# tau = 1.170694*86,400/12,072 = 8.37873
# x = 0.78*sqrt(12,072) = 85.7007 ; b+2x = 371.4014
# sigma6 = -0.760258*120,000*0.1/(12*371.4014) = -2.04701
# L = 6000 < 8*Rm = 8048, so the short-vessel horn formula applies:
# K7 = K6*(1.5*0.59642 - 0.5) = 0.052852*0.39463 = 0.020857
# sigma7 = -120,000/17,827.3 - 12*0.020857*120,000*1006/864,000
#        = -6.73115 - 34.9702 = -41.7014
sd = saddle_analysis(P=1.0, Rm=1006.0, ts=12.0, L=6000.0, a=600.0, b=200.0,
                     theta_deg=120.0, H=500.0, Q=120000.0, Ey=195000.0,
                     S=138.0, th=12.0, Ri=1000.0, stiffening="none")
close(sd.results["M1"], -6821676.0, label="M1 at saddle")
close(sd.results["M2"], 96858324.0, label="M2 at mid-span")
close(sd.results["T"], 86400.0, label="T shear at saddle")
close(sd.results["sigma1"], 39.3777, label="sigma1 mid-span top")
close(sd.results["sigma2"], 44.4557, label="sigma2 mid-span bottom")
close(sd.results["sigma3"], 43.5938, label="sigma3 saddle top (K1)")
close(sd.results["sigma4"], 40.9872, label="sigma4 saddle bottom (K1')")
close(sd.results["Sc"], 145.3778, label="Sc allowable compressive")
close(sd.results["tau"], 8.37873, label="tau tangential shear (K2)")
close(sd.results["sigma6"], -2.04701, label="sigma6 circ. membrane")
close(sd.results["sigma7"], -41.7014, label="sigma7 horn (short vessel)")
check(sd.ok, "saddle passes all VIII-2 4.15 limits")

# Head-stiffened variant (a <= Rm/2) switches tau and adds the head checks.
# tau = K3*Q/(Rm*ts) = 0.879904*120,000/12,072 = 8.74436
# sigma5 = K4*Q/(Rm*th) + P*Ri^2/(2*th*H)
#        = 0.401056*120,000/12,072 + 1.0*1e6/(2*12*500) = 3.98634 + 83.3333
sd_h = saddle_analysis(P=1.0, Rm=1006.0, ts=12.0, L=6000.0, a=400.0, b=200.0,
                       theta_deg=120.0, H=500.0, Q=120000.0, Ey=195000.0,
                       S=138.0, th=12.0, Ri=1000.0, stiffening="head",
                       head_type="ellipsoidal")
close(sd_h.results["tau"], 8.74436, label="tau via K3 (head-stiffened)")
close(sd_h.results["sigma5"], 87.3197, label="sigma5 head membrane")
check(sd_h.results["tau_head"] > 0.0, "head shear reported when a <= Rm/2")

# theta below the VIII-2 minimum must be flagged, not silently accepted.
sd_bad = saddle_analysis(P=1.0, Rm=1006.0, ts=12.0, L=6000.0, a=600.0,
                         b=200.0, theta_deg=90.0, H=500.0, Q=120000.0,
                         Ey=195000.0, S=138.0)
check(not sd_bad.ok, "theta = 90 deg flagged (VIII-2 requires >= 120)")

# A thin shell on a narrow saddle must fail the horn stress.
sd_thin = saddle_analysis(P=1.0, Rm=1006.0, ts=6.0, L=6000.0, a=600.0, b=80.0,
                          theta_deg=120.0, H=500.0, Q=250000.0, Ey=195000.0,
                          S=138.0, th=6.0, Ri=1000.0)
check(not sd_thin.ok, "overloaded thin shell flagged")

# Wear plate raises the effective thickness, so the horn stress must drop.
sd_wp = saddle_analysis(P=1.0, Rm=1006.0, ts=6.0, L=6000.0, a=600.0, b=80.0,
                        theta_deg=120.0, H=500.0, Q=250000.0, Ey=195000.0,
                        S=138.0, th=6.0, Ri=1000.0, tr=8.0, Sr=138.0)
check(abs(sd_wp.results["sigma7"]) < abs(sd_thin.results["sigma7"]),
      "wear plate reduces the horn stress")

print("== UG-36(b)(1) gate and App. 1-7 large openings ==")
# 600 mm opening in a 2000 mm ID shell. D > 1520 so d_max = min(2000/3, 1020)
# = 666.67 -> 600 is WITHIN the gate, App. 1-7 does not apply.
# t=16, tr=10, tn=12, te=14, Dp=1000, legs 10/10, all fr = 1
# limit_par = max(600, 300+12+16) = 600 ; reduced = 450
# excess = 16-10 = 6 ; width = 2*450-600 = 300 -> A1_red = 1800
# A2 = min(5*10*16, 2*10*(30+14)) = min(800, 880) = 800 ; A41 = A42 = 100
# Dp_red = min(1000, 900) = 900 -> A5_red = (900-600-24)*14 = 3864
# A_within = 1800+800+100+100+3864 = 6664 ; A = 600*10 = 6000 -> 2/3 = 4000
ar_ok = area_reinforcement(d=600.0, t=16.0, tr=10.0, tn=12.0, trn=2.0,
                           Sv=138.0, Sn=138.0, te=14.0, Dp=1000.0,
                           leg_nozzle=10.0, leg_pad=10.0)
lo = large_opening_check(ar_ok, D_inside=2000.0)
close(lo.results["d_max_UG36"], 666.667, label="d_max, D > 1520 branch")
close(lo.results["limit_reduced"], 450.0, label="0.75 * parallel limit")
close(lo.results["A_within_reduced"], 6664.0, label="A within reduced limit")
close(lo.results["A_two_thirds"], 4000.0, label="2/3 * A required")
check(lo.results["app_1_7_required"] == 0.0, "600 mm in 2000 ID: 1-7 not required")
check(len(lo.checks) == 1, "no 1-7 verdict issued when the gate is met")

# 800 mm opening in the same shell exceeds 666.67 -> App. 1-7 applies.
# limit_par = 800 ; reduced = 600 ; width = 400 -> A1_red = 2400
# Dp_red = min(1400, 1200) = 1200 -> A5_red = (1200-800-24)*14 = 5264
# A_within = 2400+800+100+100+5264 = 8664 ; A = 8000 -> 2/3 = 5333.3 -> passes
lo2 = large_opening_check(area_reinforcement(
    d=800.0, t=16.0, tr=10.0, tn=12.0, trn=2.0, Sv=138.0, Sn=138.0,
    te=14.0, Dp=1400.0, leg_nozzle=10.0, leg_pad=10.0), D_inside=2000.0)
check(lo2.results["app_1_7_required"] == 1.0, "800 mm in 2000 ID: 1-7 applies")
close(lo2.results["A_within_reduced"], 8664.0, label="A within limit, large op.")
close(lo2.results["A_two_thirds"], 5333.333, label="2/3 * A, large opening")
check(lo2.ok, "large opening satisfies the 2/3 rule")

# Small-vessel branch: D = 1200 -> d_max = min(600, 510) = 510, so d = 520
# is large. t=14, tr=9, tn=10, leg 8, no pad.
# excess = 5 ; limit_par = 520 ; reduced = 390 ; width = 260 -> A1_red = 1300
# A2 = min(5*8*14, 5*8*10) = 400 ; A41 = 64 -> A_within = 1764
# A = 520*9 = 4680 -> 2/3 = 3120 > 1764, so it must FAIL
lo3 = large_opening_check(area_reinforcement(
    d=520.0, t=14.0, tr=9.0, tn=10.0, trn=2.0, Sv=138.0, Sn=138.0,
    leg_nozzle=8.0), D_inside=1200.0)
close(lo3.results["d_max_UG36"], 510.0, label="d_max, D <= 1520 branch")
close(lo3.results["A_within_reduced"], 1764.0, label="A within limit, no pad")
check(not lo3.ok, "large opening failing the 2/3 rule is flagged")

# d/D above 0.7 is outside the scope of UG-37 and App. 1-7 alike.
lo4 = large_opening_check(area_reinforcement(
    d=1500.0, t=16.0, tr=10.0, tn=12.0, trn=2.0, Sv=138.0, Sn=138.0,
    leg_nozzle=10.0), D_inside=2000.0)
check(not lo4.ok and any("0.7" in d for d, p in lo4.checks if not p),
      "d/D = 0.75 flagged as outside code scope")

# US units: D = 48 in <= 60 -> d_max = min(24, 20) = 20 in
lo5 = large_opening_check(area_reinforcement(
    d=22.0, t=0.625, tr=0.4, tn=0.5, trn=0.1, Sv=20000.0, Sn=20000.0,
    leg_nozzle=0.375), D_inside=48.0, units="US")
close(lo5.results["d_max_UG36"], 20.0, label="d_max, US units")
check(lo5.results["app_1_7_required"] == 1.0, "22 in in 48 in ID: 1-7 applies")

print("== wind load (statics) ==")
# One uniform segment: F = q*Cf*w*H, centroid at H/2.
# q=0.0015, w=2000, H=10000 -> V = 30,000 N ; M = V*H/2 = 150,000,000 N-mm
w = wind_load([dict(z_bottom=0.0, z_top=10000.0, width=2000.0, q=0.0015)])
close(w.results["V"], 30000.0, label="wind V, one uniform segment")
close(w.results["M"], 150000000.0, label="wind M = q*w*H^2/2")
# Cf scales the force linearly.
w_cf = wind_load([dict(z_bottom=0.0, z_top=10000.0, width=2000.0, q=0.0015,
                       Cf=0.7)])
close(w_cf.results["V"], 21000.0, label="wind V with Cf = 0.7")
# A segment straddling the reporting elevation must be truncated, not dropped:
# lower 0-5000 at q=0.001 contributes only 2500-5000 -> 0.001*2000*2500 = 5,000
# upper 5000-10000 at q=0.002 -> 0.002*2000*5000 = 20,000 ; V = 25,000
w2 = wind_load([dict(z_bottom=0.0, z_top=5000.0, width=2000.0, q=0.001),
                dict(z_bottom=5000.0, z_top=10000.0, width=2000.0, q=0.002)],
               elevation=2500.0)
close(w2.results["V"], 25000.0, label="wind V truncated at elevation")
# arms measured from the elevation: 5,000*1250 + 20,000*5000 = 106,250,000
close(w2.results["M"], 106250000.0, label="wind M about the elevation")

print("== seismic load (equivalent lateral force) ==")
SEG = [dict(z_bottom=0.0, z_top=5000.0, weight=50000.0),
       dict(z_bottom=5000.0, z_top=10000.0, weight=50000.0)]
# k = 0 spreads V uniformly by weight: V = 0.12*100,000 = 12,000
# M = 6,000*2500 + 6,000*7500 = 60,000,000
s0 = seismic_load(SEG, Cs=0.12, k=0.0)
close(s0.results["V"], 12000.0, label="seismic base shear Cs*W")
close(s0.results["M"], 60000000.0, label="seismic M, uniform (k=0)")
# k = 1 weights by height: shares 2500/(2500+7500)=0.25 and 0.75
# M = 3,000*2500 + 9,000*7500 = 7,500,000 + 67,500,000 = 75,000,000
s1 = seismic_load(SEG, Cs=0.12, k=1.0)
close(s1.results["V"], 12000.0, label="seismic V independent of k")
close(s1.results["M"], 75000000.0, label="seismic M, linear (k=1)")
check(s1.results["M"] > s0.results["M"], "k=1 raises the moment above k=0")

print("== UG-22 combined longitudinal stress ==")
# Rm=1006, t=12: area = 2*pi*1006*12 = 75,852.7 ; Z = pi*1006^2*12 = 38,152,858
# M = 150,000,000 -> sigma_bend = 3.93165
# W = 200,000 -> sigma_axial = 2.63665 ; P = 0 (empty case)
# windward = 0 + 3.93165 - 2.63665 = 1.29500
# leeward  = 0 - 3.93165 - 2.63665 = -6.56830
c = combined_longitudinal(P=0.0, Rm=1006.0, t=12.0, S=138.0, E=1.0,
                          M=150000000.0, W_axial=200000.0, B_allow=95.0)
close(c.results["sigma_bending"], 3.93165, label="sigma_bending M/(pi*Rm^2*t)")
close(c.results["sigma_axial"], 2.63665, label="sigma_axial W/(2*pi*Rm*t)")
close(c.results["sigma_windward"], 1.29500, label="sigma_windward")
close(c.results["sigma_leeward"], -6.56830, label="sigma_leeward")
close(c.results["S_compression_allow"], 95.0, label="compression limit = B")
check(c.ok, "combined stress within allowables")
# Pressure can keep both sides in tension -> no compression check at all.
c_p = combined_longitudinal(P=1.0, Rm=1006.0, t=12.0, S=138.0, M=1000.0,
                            W_axial=0.0, B_allow=95.0)
check(all("compression" not in d for d, _ in c_p.checks),
      "no compression check when pressure dominates")
# Omitting B_allow must fall back to S*E and say so in a note.
c_nb = combined_longitudinal(P=0.0, Rm=1006.0, t=12.0, S=138.0, E=0.85,
                             M=150000000.0, W_axial=200000.0)
close(c_nb.results["S_compression_allow"], 117.3, label="fallback limit S*E")
check(any("B_allow" in n for n in c_nb.notes), "fallback is flagged in a note")
# A big moment on a thin shell must trip the compressive limit.
c_bad = combined_longitudinal(P=0.0, Rm=1006.0, t=6.0, S=138.0,
                              M=3.0e9, W_axial=200000.0, B_allow=50.0)
check(not c_bad.ok, "overturning moment flagged against B")

print("== static head helper ==")
# water 1000 kg/m3, 10 m: 1000*9.80665*10*1e-6 = 0.0980665 MPa
close(static_head(1000.0, 10.0), 0.0980665, label="static head 10 m water")

print()
if FAIL:
    print(f"{len(FAIL)} TEST(S) FAILED: {FAIL}")
    sys.exit(1)
print("ALL TESTS PASSED")

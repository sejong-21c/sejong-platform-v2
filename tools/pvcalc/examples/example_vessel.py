"""Example: preliminary calc note for a typical vessel.

Vessel : ID 2,000 mm x TL-TL 6,000 mm, 2:1 ellipsoidal heads
Design : 1.0 MPa(g) & Full Vacuum @ 150 degC, CA 3 mm, E = 1.0 (Full RT)
Material: SA-516-70 (S = 138 MPa, Sy = 220 MPa, Ey = 195,000 MPa @ 150 degC
          -- enter YOUR values from Sec II-D; these are typical figures)
Nozzle : N1 = NPS 8 SCH STD set-in, SA-106-B (S = 118 MPa)

Run:  python examples/example_vessel.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pvcalc import (cylinder_thickness, cylinder_mawp, ellipsoidal_thickness,
                    cylinder_maep, area_reinforcement, weld_strength,
                    ug45_neck_thickness, flange_bolt_loads, flange_stresses,
                    saddle_analysis)

# ---- design data (EDIT HERE) ------------------------------------------------
P = 1.0          # MPa(g), internal design pressure incl. static head
P_ext = 0.1013   # MPa, full vacuum
ID = 2000.0      # mm
CA = 3.0         # mm
E = 1.0          # joint efficiency (Full RT)
S_shell = 138.0  # MPa, SA-516-70 @ 150 degC (Sec II-D)
Sy = 220.0       # MPa, yield @ temp (Table Y-1)
Ey = 195000.0    # MPa, modulus @ temp
L_design = 6000.0 + 2.0 * (ID / 4.0) / 3.0  # TL-TL + 1/3 head depth each end

S_nozzle = 118.0        # MPa, SA-106-B @ 150 degC
NPS = 8.0               # NPS 8 -> OD 219.08 mm, STD wall 8.18 mm
noz_OD = 219.08
noz_t_nom = 8.18        # SCH STD
t_shell_nom = 12.0      # mm, selected shell nominal thickness
# -----------------------------------------------------------------------------

R_corroded = ID / 2.0 + CA
sections = []

r = cylinder_thickness(P=P, R=R_corroded, S=S_shell, E=E, CA=CA)
sections.append(r)
t_req_shell_e1 = cylinder_thickness(P=P, R=R_corroded, S=S_shell, E=1.0).results["t_req"]

sections.append(cylinder_mawp(t=t_shell_nom, R=ID / 2.0, S=S_shell, E=E, CA=CA))
sections.append(ellipsoidal_thickness(P=P, D=ID + 2 * CA, S=S_shell, E=E, CA=CA))
sections.append(cylinder_maep(Do=ID + 2 * t_shell_nom, t=t_shell_nom - CA,
                              L=L_design, Ey=Ey, Sy=Sy))

# Nozzle N1: corroded bore & thicknesses
noz_t_avail = noz_t_nom * 0.875 - CA          # pipe mill tolerance + CA
d_corroded = noz_OD - 2.0 * noz_t_nom * 0.875 + 2.0 * CA
Rn = d_corroded / 2.0
trn = P * Rn / (S_nozzle - 0.6 * P)

n1_area = area_reinforcement(
    d=d_corroded, t=t_shell_nom - CA, tr=t_req_shell_e1,
    tn=noz_t_avail, trn=trn, Sv=S_shell, Sn=S_nozzle,
    set_in=True, leg_nozzle=8.0)
sections.append(n1_area)

# Set-in nozzle: the nozzle-to-shell groove weld runs through the shell wall.
sections.append(weld_strength(n1_area, groove_nozzle=t_shell_nom - CA))

sections.append(ug45_neck_thickness(
    P=P, Rn=Rn, Sn=S_nozzle, CA=CA, units="SI", nps=NPS,
    tr_shell_e1=t_req_shell_e1, t_nominal=noz_t_nom, is_pipe=True))

# Manhole flange: DN 500 integral (weld-neck) type, spiral-wound gasket.
# m and y are Table 2-5.1 values the user must look up -- typical spiral
# wound figures are used here.
mh = flange_bolt_loads(P=P, gasket_od=560.0, gasket_id=530.0, m=3.0, y=69.0,
                       Sb=172.0, Sa=172.0, Ab=5600.0, units="SI")
sections.append(mh)
sections.append(flange_stresses(
    mh, flange_od=680.0, B=500.0, bolt_circle=620.0, t=45.0,
    Sf=S_shell, Sfa=138.0, flange_type="integral",
    g0=14.0, g1=26.0, h=40.0))

# Horizontal orientation on two saddles. Q must already include self weight
# plus contents -- roughly estimated here for the example.
vessel_vol_m3 = 3.14159 * (ID / 2000.0) ** 2 * (6000.0 / 1000.0)
Q_per_saddle = (vessel_vol_m3 * 1000.0 + 4500.0) * 9.80665 / 2.0   # N
sections.append(saddle_analysis(
    P=P, Rm=ID / 2.0 + t_shell_nom / 2.0 - CA, ts=t_shell_nom - CA,
    L=6000.0, a=600.0, b=250.0, theta_deg=120.0, H=ID / 4.0,
    Q=Q_per_saddle, Ey=Ey, S=S_shell, th=t_shell_nom - CA, Ri=ID / 2.0,
    head_type="ellipsoidal", stiffening="none"))

note = "\n\n".join(s.report() for s in sections)
header = (
    "PRELIMINARY CALCULATION NOTE  (pvcalc v0.1 - for estimation/cross-check only)\n"
    "NOT a code-stamped calculation. Verify with PV Elite or equivalent before use\n"
    "in deliverable documents.\n")
print(header)
print(note)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output_calcnote.txt")
with open(out, "w", encoding="utf-8") as f:
    f.write(header + "\n" + note + "\n")
print(f"\nSaved: {out}")

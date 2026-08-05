"""Generate cross-engine test vectors from the Python engine.

Writes tests/test_vectors.json: a broad grid of inputs with the Python
results, which web/test_core.mjs replays against the JS engine to prove
the two implementations agree to floating-point precision.

Run:  python tests/gen_test_vectors.py
"""

import itertools
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pvcalc import shell, heads, external, nozzle, flange, saddle, loads, kec

vectors = []


def record(fn_name, kwargs, r):
    # Non-finite results (inf margins) are skipped: JSON.parse rejects them.
    results = {k: v for k, v in r.results.items()
               if isinstance(v, (int, float)) and math.isfinite(v)}
    checks = [bool(p) for _, p in r.checks]
    vectors.append({"fn": fn_name, "kwargs": kwargs,
                    "results": results, "checks": checks})


def add(fn_name, func, kwargs):
    record(fn_name, kwargs, func(**kwargs))


def add_weld(area_kwargs, weld_kwargs):
    """weldStrength consumes an areaReinforcement result, so the vector
    carries both input sets and the JS harness replays the same two calls."""
    area = nozzle.area_reinforcement(**area_kwargs)
    record("weldStrength", {"area": area_kwargs, "weld": weld_kwargs},
           nozzle.weld_strength(area, **weld_kwargs))


def add_flange(bolt_kwargs, stress_kwargs=None):
    """flangeStresses likewise consumes a flangeBoltLoads result."""
    bolt = flange.flange_bolt_loads(**bolt_kwargs)
    if stress_kwargs is None:
        record("flangeBoltLoads", bolt_kwargs, bolt)
    else:
        record("flangeStresses", {"bolt": bolt_kwargs, "stress": stress_kwargs},
               flange.flange_stresses(bolt, **stress_kwargs))


# UG-27 cylinder thickness: 36-case grid
for P, R, S, E in itertools.product([0.5, 1.0, 2.5], [500.0, 1000.0, 1500.0],
                                    [118.0, 138.0], [0.85, 1.0]):
    add("cylinderThickness", shell.cylinder_thickness,
        dict(P=P, R=R, S=S, E=E, CA=3.0))

# UG-27 cylinder MAWP
for t, R, E, CA in itertools.product([6.0, 10.0, 14.0], [500.0, 1000.0],
                                     [0.85, 1.0], [0.0, 3.0]):
    add("cylinderMawp", shell.cylinder_mawp, dict(t=t, R=R, S=138.0, E=E, CA=CA))

# Sphere
add("sphereThickness", shell.sphere_thickness, dict(P=1.0, R=1000.0, S=138.0, E=1.0, CA=0.0))
add("sphereMawp", shell.sphere_mawp, dict(t=8.0, R=1000.0, S=138.0, E=1.0, CA=3.0))

# Heads
for D_over_2h in [1.0, 2.0, 2.5]:
    add("ellipsoidalThickness", heads.ellipsoidal_thickness,
        dict(P=1.6, D=2400.0, S=138.0, E=0.85, CA=3.0, D_over_2h=D_over_2h))
add("ellipsoidalMawp", heads.ellipsoidal_mawp,
    dict(t=12.0, D=2400.0, S=138.0, E=1.0, CA=3.0, D_over_2h=2.0))
add("torisphericalThickness", heads.torispherical_thickness,
    dict(P=1.0, L=2000.0, S=138.0, E=1.0, CA=3.0, r_knuckle=None))
add("torisphericalThickness", heads.torispherical_thickness,
    dict(P=1.0, L=2000.0, S=138.0, E=1.0, CA=3.0, r_knuckle=150.0))
add("torisphericalMawp", heads.torispherical_mawp,
    dict(t=14.0, L=2000.0, S=138.0, E=1.0, CA=3.0, r_knuckle=None))
add("torisphericalMawp", heads.torispherical_mawp,
    dict(t=14.0, L=2000.0, S=138.0, E=1.0, CA=3.0, r_knuckle=150.0))
add("hemisphericalThickness", heads.hemispherical_thickness,
    dict(P=2.0, L=1200.0, S=118.0, E=1.0, CA=1.5))
for alpha in [10.0, 21.8, 30.0]:
    add("conicalThickness", heads.conical_thickness,
        dict(P=1.0, D=2000.0, alpha_deg=alpha, S=138.0, E=1.0, CA=3.0))

# External pressure - cover the Ch branches and Fic branches
for Do, t, L in itertools.product([1000.0, 2000.0], [5.0, 10.0, 25.0],
                                  [500.0, 3000.0, 20000.0]):
    add("cylinderMaep", external.cylinder_maep,
        dict(Do=Do, t=t, L=L, Ey=195000.0, Sy=205.0))
# thick/short case to force inelastic & yield-governed branches
add("cylinderMaep", external.cylinder_maep, dict(Do=800.0, t=60.0, L=400.0, Ey=195000.0, Sy=205.0))
add("cylinderMaep", external.cylinder_maep, dict(Do=800.0, t=40.0, L=1200.0, Ey=195000.0, Sy=205.0))
for Ro, t in [(1000.0, 5.0), (1000.0, 12.0), (500.0, 20.0), (400.0, 40.0)]:
    add("sphereMaep", external.sphere_maep, dict(Ro=Ro, t=t, Ey=195000.0, Sy=205.0))

# UG-37 nozzle reinforcement
add("areaReinforcement", nozzle.area_reinforcement,
    dict(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
         Sv=138.0, Sn=138.0, leg_nozzle=6.0))
add("areaReinforcement", nozzle.area_reinforcement,
    dict(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
         Sv=138.0, Sn=138.0, te=10.0, Dp=400.0, leg_nozzle=6.0, leg_pad=6.0))
add("areaReinforcement", nozzle.area_reinforcement,
    dict(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.909753,
         Sv=138.0, Sn=110.4, set_in=False, leg_nozzle=6.0))
add("areaReinforcement", nozzle.area_reinforcement,
    dict(d=350.0, t=16.0, tr=12.5, tn=12.0, trn=1.8, Sv=138.0, Sn=118.0,
         set_in=True, te=12.0, Dp=700.0, Sp=138.0,
         leg_nozzle=10.0, leg_pad=8.0, leg_inner=6.0, ti=9.0, h=40.0))
add("areaReinforcement", nozzle.area_reinforcement,
    dict(d=100.0, t=20.0, tr=5.0, tn=10.0, trn=0.5, Sv=138.0, Sn=138.0,
         E1=0.85, F=1.0, leg_nozzle=8.0))

# UG-41 weld strength — cover pad/no-pad, unequal materials, both exemptions,
# and the zero-weld degenerate case.
NOZ_PAD = dict(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
               Sv=138.0, Sn=138.0, te=10.0, Dp=400.0,
               leg_nozzle=6.0, leg_pad=6.0)
NOZ_BARE = dict(d=200.0, t=10.0, tr=7.27802, tn=8.0, trn=0.727802,
                Sv=138.0, Sn=138.0, leg_nozzle=6.0)
NOZ_MIXED = dict(d=350.0, t=16.0, tr=12.5, tn=12.0, trn=1.8, Sv=138.0,
                 Sn=118.0, set_in=True, te=12.0, Dp=700.0, Sp=103.0,
                 leg_nozzle=10.0, leg_pad=8.0, leg_inner=6.0, ti=9.0, h=40.0)
for gn, gp in itertools.product([0.0, 10.0], [0.0, 10.0]):
    add_weld(NOZ_PAD, dict(groove_nozzle=gn, groove_pad=gp))
add_weld(NOZ_BARE, dict(groove_nozzle=10.0))
add_weld(NOZ_BARE, {})
add_weld(NOZ_MIXED, dict(groove_nozzle=16.0, groove_pad=12.0))
add_weld(NOZ_MIXED, dict(groove_nozzle=16.0, external_pressure=True))
add_weld(NOZ_PAD, dict(groove_nozzle=10.0, exempt_uw15b1=True))
add_weld(dict(d=200.0, t=10.0, tr=7.27802, tn=1.0, trn=0.727802,
              Sv=138.0, Sn=138.0), {})

# UG-45
add("ug45NeckThickness", nozzle.ug45_neck_thickness,
    dict(P=1.0, Rn=100.0, Sn=138.0, CA=3.0, units="SI", nps=8.0,
         tr_shell_e1=7.27802, t_nominal=12.7, is_pipe=True))
add("ug45NeckThickness", nozzle.ug45_neck_thickness,
    dict(P=150.0, Rn=4.0, Sn=20000.0, CA=0.125, units="US", nps=8.0,
         tr_shell_e1=0.35, t_nominal=0.5, is_pipe=True))
add("ug45NeckThickness", nozzle.ug45_neck_thickness,
    dict(P=1.0, Rn=100.0, Sn=138.0, CA=3.0, units="SI",
         tr_shell_e1=7.27802, t_nominal=12.0, is_pipe=False))

def add_large(area_kwargs, large_kwargs):
    """largeOpeningCheck likewise consumes an areaReinforcement result."""
    area = nozzle.area_reinforcement(**area_kwargs)
    record("largeOpeningCheck",
           {"area": area_kwargs, "large": large_kwargs},
           nozzle.large_opening_check(area, **large_kwargs))


# UG-36(b)(1) gate + App. 1-7 — both D branches, both caps, pad/no pad, US.
LO_PAD = dict(t=16.0, tr=10.0, tn=12.0, trn=2.0, Sv=138.0, Sn=138.0,
              te=14.0, Dp=1400.0, leg_nozzle=10.0, leg_pad=10.0)
LO_BARE = dict(t=14.0, tr=9.0, tn=10.0, trn=2.0, Sv=138.0, Sn=138.0,
               leg_nozzle=8.0)
for d_op, D in itertools.product([400.0, 520.0, 800.0, 1300.0],
                                 [1200.0, 2000.0, 4000.0]):
    if d_op / D > 0.95:
        continue
    add_large(dict(LO_PAD, d=d_op), dict(D_inside=D))
    add_large(dict(LO_BARE, d=d_op), dict(D_inside=D))
add_large(dict(LO_BARE, d=22.0, t=0.625, tr=0.4, tn=0.5, trn=0.1,
               Sv=20000.0, Sn=20000.0, leg_nozzle=0.375),
          dict(D_inside=48.0, units="US"))
add_large(dict(LO_PAD, d=1100.0), dict(D_inside=6000.0))   # 1020 mm cap
add_large(dict(LO_BARE, d=560.0, set_in=False), dict(D_inside=1500.0))

# App. 2 flanges — sweep the b_o branch, both unit systems, both flange
# families, and a grid of hub proportions to exercise the Table 2-7.1 chain.
FL_SI = dict(P=1.0, gasket_od=350.0, gasket_id=320.0, m=3.0, y=69.0,
             Sb=172.0, Sa=172.0, Ab=3200.0, units="SI")
FL_NARROW = dict(P=1.0, gasket_od=330.0, gasket_id=326.0, m=2.0, y=20.0,
                 Sb=172.0, Sa=172.0, Ab=1200.0, units="SI")
FL_US = dict(P=150.0, gasket_od=13.5, gasket_id=13.0, m=3.0, y=10000.0,
             Sb=25000.0, Sa=25000.0, Ab=5.0, units="US")
for bk in (FL_SI, FL_NARROW, FL_US):
    add_flange(bk)
for Ab in (3000.0, 3200.0, 5000.0):
    add_flange(dict(FL_SI, Ab=Ab))

ST_BASE = dict(flange_od=450.0, B=300.0, bolt_circle=395.0, t=30.0,
               Sf=138.0, Sfa=138.0, flange_type="integral")
for g1, h in itertools.product([10.5, 18.0, 30.0], [10.0, 25.0, 80.0]):
    add_flange(FL_SI, dict(ST_BASE, g0=10.0, g1=g1, h=h))
add_flange(FL_SI, dict(ST_BASE, g0=10.0, g1=18.0, h=25.0, Sn=103.0, Sna=103.0))
for t in (20.0, 60.0):
    add_flange(FL_SI, dict(ST_BASE, t=t, flange_type="ring"))
add_flange(FL_NARROW, dict(ST_BASE, t=40.0, flange_type="ring"))
add_flange(FL_US, dict(flange_od=17.0, B=13.0, bolt_circle=15.5, t=1.2,
                       Sf=20000.0, Sfa=20000.0, flange_type="integral",
                       g0=0.4, g1=0.7, h=1.0))

# VIII-2 4.15 saddles — sweep theta, stiffening mode, head type, the L>=8Rm
# horn branch, the wear plate, and the a/Rm breakpoints of K7.
SD_BASE = dict(P=1.0, Rm=1006.0, ts=12.0, L=6000.0, a=600.0, b=200.0,
               theta_deg=120.0, H=500.0, Q=120000.0, Ey=195000.0, S=138.0,
               th=12.0, Ri=1000.0)
for theta in (120.0, 135.0, 150.0, 168.0):
    add("saddleAnalysis", saddle.saddle_analysis, dict(SD_BASE, theta_deg=theta))
for stf in ("none", "head", "ring_in_plane"):
    add("saddleAnalysis", saddle.saddle_analysis,
        dict(SD_BASE, a=400.0, stiffening=stf))
for ht in ("torispherical", "ellipsoidal", "hemispherical", "flat"):
    add("saddleAnalysis", saddle.saddle_analysis,
        dict(SD_BASE, a=400.0, stiffening="head", head_type=ht))
for a in (300.0, 503.0, 700.0, 1100.0):        # K7 breakpoints at a/Rm 0.5, 1
    add("saddleAnalysis", saddle.saddle_analysis, dict(SD_BASE, a=a))
add("saddleAnalysis", saddle.saddle_analysis,   # L >= 8*Rm horn branch
    dict(SD_BASE, L=12000.0, a=1200.0))
add("saddleAnalysis", saddle.saddle_analysis,
    dict(SD_BASE, tr=8.0, Sr=118.0, theta1_deg=140.0))
add("saddleAnalysis", saddle.saddle_analysis,
    dict(SD_BASE, tr=8.0, Sr=138.0, b1=420.0, L=12000.0))
add("saddleAnalysis", saddle.saddle_analysis,
    dict(SD_BASE, saddle_welded=False, exceptional=True, E_joint=0.85))
add("saddleAnalysis", saddle.saddle_analysis,   # empty / erection case
    dict(SD_BASE, P=0.0, Q=45000.0, exceptional=True))

# Wind / seismic / UG-22 combined loading.
WIND_SEGS = [dict(z_bottom=0.0, z_top=4000.0, width=2100.0, q=0.0010, Cf=0.7),
             dict(z_bottom=4000.0, z_top=9000.0, width=2100.0, q=0.0014, Cf=0.7),
             dict(z_bottom=9000.0, z_top=12000.0, width=2400.0, q=0.0017)]
for elev in (0.0, 3000.0, 6500.0):
    add("windLoad", loads.wind_load, dict(segments=WIND_SEGS, elevation=elev))
SEIS_SEGS = [dict(z_bottom=0.0, z_top=4000.0, weight=62000.0),
             dict(z_bottom=4000.0, z_top=9000.0, weight=78000.0),
             dict(z_bottom=9000.0, z_top=12000.0, weight=31000.0)]
for k_exp in (0.0, 1.0, 1.5, 2.0):
    add("seismicLoad", loads.seismic_load,
        dict(segments=SEIS_SEGS, Cs=0.11, k=k_exp))
add("seismicLoad", loads.seismic_load,
    dict(segments=SEIS_SEGS, Cs=0.11, k=1.0, elevation=4000.0))
for P_i, B in itertools.product([0.0, 1.0, 2.5], [None, 60.0, 95.0]):
    add("combinedLongitudinal", loads.combined_longitudinal,
        dict(P=P_i, Rm=1006.0, t=12.0, S=138.0, E=0.85, M=1.8e8,
             W_axial=240000.0, B_allow=B))
add("combinedLongitudinal", loads.combined_longitudinal,
    dict(P=0.0, Rm=1006.0, t=6.0, S=138.0, M=3.0e9, W_axial=200000.0,
         B_allow=50.0))

# 한국에너지공단 KPM — 두 단위계, ID/OD, 얇은벽/두꺼운벽, 최소두께 지배,
# 경판 4종(반구·접시·타원·플랜지보강)을 모두 덮는다.
for units, P, sa in [("SI", 1.0, 100.0), ("SI", 2.5, 138.0), ("kgf", 10.0, 10.0)]:
    for eta in [0.85, 1.0]:
        add("kecCylinderThickness", kec.cylinder_thickness,
            dict(P=P, Di=2000.0, sigma_a=sa, eta=eta, alpha=3.0, units=units))
        add("kecCylinderThickness", kec.cylinder_thickness,
            dict(P=P, Do=2200.0, sigma_a=sa, eta=eta, alpha=3.0, units=units))
        add("kecSphereThickness", kec.sphere_thickness,
            dict(P=P, Di=2000.0, sigma_a=sa, eta=eta, alpha=3.0, units=units))
        add("kecSphereThickness", kec.sphere_thickness,
            dict(P=P, Do=2200.0, sigma_a=sa, eta=eta, alpha=3.0, units=units))
# 두꺼운 벽 분기 (원통 t>Di/4, 구형 t>0.178Di) 와 강제 얇은벽
add("kecCylinderThickness", kec.cylinder_thickness,
    dict(P=4.0, Di=400.0, sigma_a=10.0, eta=1.0, alpha=0.0, material_class=None))
add("kecCylinderThickness", kec.cylinder_thickness,
    dict(P=4.0, Do=600.0, sigma_a=10.0, eta=1.0, alpha=0.0, material_class=None))
add("kecCylinderThickness", kec.cylinder_thickness,
    dict(P=4.0, Di=400.0, sigma_a=10.0, eta=1.0, alpha=0.0,
         material_class=None, thick_wall=False))
add("kecSphereThickness", kec.sphere_thickness,
    dict(P=4.0, Di=400.0, sigma_a=5.0, eta=1.0, alpha=0.0, material_class=None))
add("kecSphereThickness", kec.sphere_thickness,
    dict(P=4.0, Do=600.0, sigma_a=5.0, eta=1.0, alpha=0.0, material_class=None))
# KPM-3210 최소두께 지배 — 재료 구분 전부
for mc in ["carbon", "highalloy", "highalloy_nocorr", "nonferrous", "nonferrous_nocorr"]:
    add("kecCylinderThickness", kec.cylinder_thickness,
        dict(P=0.05, Di=500.0, sigma_a=100.0, eta=1.0, alpha=1.0, material_class=mc))
# 경판
add("kecTorisphericalHead", kec.torispherical_head_thickness,
    dict(P=1.0, R=1000.0, sigma_a=100.0, eta=1.0, alpha=3.0, hemispherical=True))
for rk in [150.0, 200.0, 400.0]:
    add("kecTorisphericalHead", kec.torispherical_head_thickness,
        dict(P=1.0, R=2000.0, r_knuckle=rk, sigma_a=100.0, eta=1.0, alpha=3.0))
add("kecTorisphericalHead", kec.torispherical_head_thickness,
    dict(P=1.0, R=2000.0, r_knuckle=150.0, sigma_a=100.0, eta=1.0, alpha=3.0,
         flanged_opening=True))
add("kecTorisphericalHead", kec.torispherical_head_thickness,
    dict(P=4.0, R=2000.0, r_knuckle=150.0, sigma_a=100.0, eta=1.0, alpha=3.0,
         flanged_opening=True))
add("kecTorisphericalHead", kec.torispherical_head_thickness,
    dict(P=1.0, R=1000.0, r_knuckle=150.0, sigma_a=100.0, eta=1.0, alpha=3.0,
         flanged_opening=True, Di_shell=2000.0))
for ratio in [1.0, 2.0, 2.5]:
    add("kecEllipsoidalHead", kec.ellipsoidal_head_thickness,
        dict(P=1.0, D=2000.0, D_over_2h=ratio, sigma_a=100.0, eta=1.0, alpha=3.0))
add("kecEllipsoidalHead", kec.ellipsoidal_head_thickness,
    dict(P=1.0, D=2000.0, h=500.0, sigma_a=100.0, eta=1.0, alpha=3.0))
add("kecEllipsoidalHead", kec.ellipsoidal_head_thickness,
    dict(P=1.0, D=2000.0, h=500.0, sigma_a=100.0, eta=1.0, alpha=3.0,
         flanged_opening=True, Di_shell=2000.0))

# API 650 1-Foot Method — 두 단위계, 지배조건 3종(설계·수압시험·최소두께),
# 최소두께 구간 경계, 적용범위 밖(D>61m), 단별 계산.
from pvcalc import api650 as _a650  # noqa: E402

for D in [10.0, 14.99, 15.0, 35.9, 36.0, 60.0, 60.1, 80.0]:
    add("a650ShellCourseThickness", _a650.shell_course_thickness,
        dict(D=D, H=12.0, G=1.0, Sd=160.0, St=171.0, CA=1.5, units="SI"))
    add("a650ShellCourseThickness", _a650.shell_course_thickness,
        dict(D=D, H=12.0, G=1.0, Sd=160.0, St=171.0, CA=1.5, units="SI",
             lowest_course=True))
for G in [0.7, 1.0, 1.25]:
    for H in [2.0, 6.0, 12.0]:
        add("a650ShellCourseThickness", _a650.shell_course_thickness,
            dict(D=30.0, H=H, G=G, Sd=160.0, St=171.0, CA=1.5, units="SI"))
for D in [40.0, 100.0, 150.0, 250.0]:
    add("a650ShellCourseThickness", _a650.shell_course_thickness,
        dict(D=D, H=40.0, G=1.0, Sd=23200.0, St=24900.0, CA=0.0625, units="USC"))


def add_courses(kwargs):
    """shell_courses 는 (리스트, 요약)을 돌려주므로 요약만 벡터로 기록한다."""
    _, summary = _a650.shell_courses(**kwargs)
    record("a650ShellCourses", kwargs, summary)


add_courses(dict(D=30.0, course_heights=[2.4] * 5, H_design=12.0, G=1.0,
                 Sd=160.0, St=171.0, CA=1.5))
add_courses(dict(D=30.0, course_heights=[2.4] * 5, H_design=7.0, G=1.0,
                 Sd=160.0, St=171.0, CA=1.5))
add_courses(dict(D=45.0, course_heights=[3.0] * 6, H_design=18.0, G=0.85,
                 Sd=180.0, St=193.0, CA=3.0))
add_courses(dict(D=30.0, course_heights=[2.4] * 3, H_design=7.2, G=1.0,
                 Sd=[160.0, 180.0, 200.0], St=[171.0, 190.0, 210.0], CA=1.5))
add_courses(dict(D=100.0, course_heights=[8.0] * 5, H_design=40.0, G=1.0,
                 Sd=23200.0, St=24900.0, CA=0.0625, units="USC"))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_vectors.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(vectors, f, indent=1)
print(f"{len(vectors)} vectors -> {out}")

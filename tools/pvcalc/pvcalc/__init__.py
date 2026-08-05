"""pvcalc — ASME BPVC Section VIII Division 1 preliminary calculation toolkit.

Purpose: quotation, pre-review and cross-checking of commercial software
results (PV Elite etc.). NOT a substitute for a verified code report.

All functions take a single consistent unit set (SI: mm & MPa recommended)
and return a CalcResult whose .report() prints a reviewable calc sheet.
"""

__version__ = "0.1.0"

from .report import CalcResult
from .shell import (cylinder_thickness, cylinder_mawp,
                    sphere_thickness, sphere_mawp, static_head)
from .heads import (ellipsoidal_thickness, ellipsoidal_mawp,
                    torispherical_thickness, torispherical_mawp,
                    hemispherical_thickness, conical_thickness)
from .external import (cylinder_maep, cylinder_thickness_for_external,
                       sphere_maep)
from .nozzle import (area_reinforcement, weld_strength, large_opening_check,
                     ug45_neck_thickness)
from .flange import (flange_bolt_loads, flange_stresses, figure_2_7_1,
                     table_2_7_1)
from .saddle import saddle_analysis, zick_coefficients
from .loads import wind_load, seismic_load, combined_longitudinal

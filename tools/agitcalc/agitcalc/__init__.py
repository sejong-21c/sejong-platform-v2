"""agitcalc — 교반기(Agitator) 선정·설계 예비 계산 툴킷.

압력용기에 부착되는 교반기의 형식 선정, 임펠러 형상·치수 산정, 동력 계산,
모터 선정, 축 강도·위험속도 검토를 한 벌로 수행한다.

  ⚠ 본 계산은 제조사 실측 성능표나 검증된 상용 소프트웨어를 대체하지 않는다.
    견적·사전검토·협력업체 견적 대조 검증 용도로 사용할 것.
    특히 고점도(Re < 10^4) 영역은 문헌 상관식의 오차가 크다.

주요 진입점
    agitcalc.design(...)            종합 선정 (권장)
    agitcalc.geometry.recommend()   형상 치수만
    agitcalc.total_power(...)       동력만
    agitcalc.shaft.design_shaft()   축 검토만
    agitcalc.vendor.topjin_sheet()  협력업체 검토서 방식 재현 (대조용)
"""

__version__ = "0.1.0"

from .report import CalcResult
from . import impellers, geometry, core, shaft, process, vendor
from .impellers import LIT, get as get_impeller, all_keys
from .core import (rpm_to_rps, rps_to_rpm, cP_to_Pas, volume_from_TH,
                   liquid_height, reynolds, froude, tip_speed, flow_regime,
                   power_number, apparent_viscosity_MO, impeller_power,
                   pumping_capacity, total_power, select_motor, blend_time,
                   turnover_time, specific_power, vortex_check,
                   IEC_MOTORS_KW)
from .geometry import recommend, format_geometry, select_type, AGITATION_LEVELS
from .shaft import design_shaft, min_shaft_diameter, MATERIALS
from .process import (just_suspended_speed, jacket_heat_transfer,
                      coil_heat_transfer, gas_dispersion_check)
from .select import design, full_report
from .vendor import topjin_sheet

__all__ = [
    "CalcResult", "impellers", "geometry", "core", "shaft", "process",
    "vendor", "LIT", "get_impeller", "all_keys", "rpm_to_rps", "rps_to_rpm",
    "cP_to_Pas", "volume_from_TH", "liquid_height", "reynolds", "froude",
    "tip_speed", "flow_regime", "power_number", "apparent_viscosity_MO",
    "impeller_power", "pumping_capacity", "total_power", "select_motor",
    "blend_time", "turnover_time", "specific_power", "vortex_check",
    "IEC_MOTORS_KW", "recommend", "format_geometry", "select_type",
    "AGITATION_LEVELS", "design_shaft", "min_shaft_diameter", "MATERIALS",
    "just_suspended_speed", "jacket_heat_transfer", "coil_heat_transfer",
    "gas_dispersion_check", "design", "full_report", "topjin_sheet",
]

"""임펠러 데이터베이스 — 동력수 Np / 토출유량수 Nq / 적용범위.

두 벌의 데이터셋을 나란히 싣는다.

  DATASET "LIT"    : 공개문헌 값. 신규 설계의 기본값.
  DATASET "TOPJIN" : D&K켐텍 YDK-II 선정검토서 R5 8건에서 역산한 값.
                     협력업체 견적을 대조·검증할 때 쓴다.

두 데이터셋이 크게 다른 항목은 그 자체가 검토 포인트다. verification/ 의
감사 스크립트가 차이를 표로 뽑아준다.

동력수 모델 (2점근 모델, Nagata 1975)
    Np(Re) = max( Kp/Re , Np_turb )
  Re -> 0 : 점성지배, Np = Kp/Re (Np*Re = Kp = 일정)
  Re -> ∞ : 관성지배, Np = Np_turb (일정)
  천이역(둘이 교차하는 부근)에서 오차가 가장 크다(±15% 수준).

문헌 출처
  [HIM]  Paul, Atiemo-Obeng & Kresta, "Handbook of Industrial Mixing",
         Wiley 2004 — Ch.6 (동력), Ch.9 (혼합시간), Ch.10 (고체현탁)
  [NAG]  Nagata S., "Mixing: Principles and Applications", Kodansha 1975
  [BAT]  Bates, Fondy & Corpstein, I&EC Proc.Des.Dev. 2(4) 1963 — 동력수 표
  [PER]  Perry's Chemical Engineers' Handbook, 8th ed., Sec.18
  [ZWI]  Zwietering T.N., Chem.Eng.Sci. 8 (1958) 244 — 현탁 임계회전수
  [GRE]  Grenville & Nienow, HIM Ch.9 — 난류 혼합시간 상관식
"""

AXIAL, RADIAL, MIXED, TANGENTIAL = "축류", "반경류", "혼합류", "접선류(벽면)"


class Impeller:
    """임펠러 1형식의 특성값.

    Np_turb : 난류역 동력수 (기준형상 W_D, n_blades 에서)
    Kp      : 층류역 동력상수 (Np = Kp/Re)
    Nq      : 토출유량수, Q = Nq*N*D^3
    W_D     : 기준 날개폭비 W/D (Np_turb 가 정의된 형상)
    ks_MO   : Metzner-Otto 상수 (비뉴턴 겉보기점도용, gamma_avg = ks*N)
    N_theta : 층류·천이역 무차원 혼합시간 N*theta95 의 대표값 (없으면 None)
    dT      : 권장 D/T 범위
    mu_max  : 실용 점도 상한 [cP] (넘으면 형식 변경 권고)
    """

    def __init__(self, key, name_ko, name_en, flow, Np_turb, Kp, Nq,
                 W_D, n_blades, ks_MO, dT, mu_max, N_theta=None,
                 source="", note=""):
        self.key = key
        self.name_ko = name_ko
        self.name_en = name_en
        self.flow = flow
        self.Np_turb = Np_turb
        self.Kp = Kp
        self.Nq = Nq
        self.W_D = W_D
        self.n_blades = n_blades
        self.ks_MO = ks_MO
        self.dT = dT
        self.mu_max = mu_max
        self.N_theta = N_theta
        self.source = source
        self.note = note

    def __repr__(self):
        return f"<Impeller {self.key} Np={self.Np_turb} Nq={self.Nq}>"


# ---------------------------------------------------------------------------
# 문헌 데이터셋 — 신규 설계 기본값
# ---------------------------------------------------------------------------
LIT = {i.key: i for i in [
    Impeller("RUSHTON", "러시톤 원판터빈(6매)", "Rushton disc turbine, 6-blade",
             RADIAL, Np_turb=5.0, Kp=71.5, Nq=0.72, W_D=0.20, n_blades=6,
             ks_MO=11.5, dT=(0.25, 0.40), mu_max=10000, N_theta=None,
             source="[HIM] Table 6-2, [BAT]",
             note="가스분산·고전단. 저점도 전용. 큰 동력 필요"),

    Impeller("FBT6", "평판터빈(6매)", "Flat blade turbine, 6-blade",
             RADIAL, Np_turb=3.2, Kp=70.0, Nq=0.70, W_D=0.20, n_blades=6,
             ks_MO=11.0, dT=(0.30, 0.50), mu_max=20000, N_theta=None,
             source="[BAT], [PER] Sec.18",
             note="원판 없는 반경류 터빈"),

    Impeller("PBT4", "45도 피치블레이드(4매)", "Pitched blade turbine 45deg, 4-blade",
             MIXED, Np_turb=1.27, Kp=36.5, Nq=0.79, W_D=0.20, n_blades=4,
             ks_MO=11.0, dT=(0.33, 0.50), mu_max=30000, N_theta=None,
             source="[HIM] Table 6-2, [BAT]",
             note="범용. 고체현탁·열전달·중점도 블렌딩. 검토서의 4-P.P 에 해당"),

    Impeller("PBT6", "45도 피치블레이드(6매)", "Pitched blade turbine 45deg, 6-blade",
             MIXED, Np_turb=1.70, Kp=45.0, Nq=0.85, W_D=0.20, n_blades=6,
             ks_MO=11.0, dT=(0.33, 0.50), mu_max=30000, N_theta=None,
             source="[BAT]", note=""),

    Impeller("PADDLE2", "2매 패들", "Flat paddle, 2-blade",
             RADIAL, Np_turb=1.70, Kp=45.0, Nq=0.40, W_D=0.20, n_blades=2,
             ks_MO=11.0, dT=(0.30, 0.60), mu_max=30000, N_theta=None,
             source="[NAG], [PER]",
             note="검토서의 2-P.P 에 해당. 벤더 역산 Nq(0.50)가 문헌보다 큼 — 확인 필요"),

    Impeller("PROP", "마린 프로펠러(3매)", "Marine propeller, 3-blade, square pitch",
             AXIAL, Np_turb=0.35, Kp=41.0, Nq=0.50, W_D=None, n_blades=3,
             ks_MO=10.0, dT=(0.20, 0.40), mu_max=5000, N_theta=None,
             source="[HIM] Table 6-2, [PER]",
             note="저점도 고속. 저동력 순환"),

    Impeller("HYDROFOIL", "하이드로포일(3매)", "Hydrofoil, 3-blade (A310 type)",
             AXIAL, Np_turb=0.30, Kp=33.0, Nq=0.56, W_D=None, n_blades=3,
             ks_MO=11.0, dT=(0.35, 0.50), mu_max=5000, N_theta=None,
             source="[HIM] Table 6-2",
             note="동력당 토출량 최대. 저점도 대용량 블렌딩"),

    Impeller("HYDROFOIL_HS", "고솔리디티 하이드로포일", "High-solidity hydrofoil (A315 type)",
             AXIAL, Np_turb=0.75, Kp=33.0, Nq=0.56, W_D=None, n_blades=4,
             ks_MO=11.0, dT=(0.35, 0.50), mu_max=20000, N_theta=None,
             source="[HIM] Table 6-2", note="중점도·가스분산 겸용"),

    Impeller("MAXBLEND", "광폭 대형패들(맥스블렌드형)", "Wide-paddle large impeller (Maxblend type)",
             MIXED, Np_turb=1.20, Kp=120.0, Nq=0.35, W_D=None, n_blades=2,
             ks_MO=13.0, dT=(0.50, 0.80), mu_max=200000, N_theta=45.0,
             source="[HIM] Ch.6 광폭임펠러 절, 제조사 공개자료",
             note="고점도·광범위 Re 대응. 배플 불필요. 검토서 주력 형식. "
                  "Np 는 d/T 의존성이 매우 커서 제조사 실측 필수"),

    Impeller("ANCHOR", "앵커", "Anchor",
             TANGENTIAL, Np_turb=0.35, Kp=300.0, Nq=0.10, W_D=None, n_blades=2,
             ks_MO=25.0, dT=(0.90, 0.98), mu_max=500000, N_theta=90.0,
             source="[NAG], [HIM] Ch.6",
             note="근접간극. 벽면 스크레이핑·열전달. 축방향 혼합 약함"),

    Impeller("RIBBON", "헬리컬 리본(2중)", "Double helical ribbon",
             TANGENTIAL, Np_turb=0.35, Kp=350.0, Nq=0.15, W_D=None, n_blades=2,
             ks_MO=30.0, dT=(0.90, 0.98), mu_max=1000000, N_theta=35.0,
             source="[NAG], [HIM] Ch.6",
             note="초고점도 층류 전용. 축방향 순환 우수"),
]}


# ---------------------------------------------------------------------------
# TOPJIN 검토서 역산 데이터셋
#   Nq  : 8/8 케이스에서 상대오차 1e-8 이내로 정확히 재현됨 → 확정값
#   Np  : 재현되지 않음. 아래 값은 P_calc/(rho*N^3*S D^5) 로 역산한 "유효 Np"
#         이며 조합형(맥스블렌드+2-P.P)에서 Re 역전이 발생한다. 참고용.
# ---------------------------------------------------------------------------
TOPJIN_NQ = {
    "MAXBLEND": 0.21,      # FA-6101, FA-6102 에서 정확히 0.2100000
    "PADDLE2": 0.50,       # FA-6201/6205/6301/6302 에서 정확히 0.5000000
    "PBT4": 0.4095,        # FA-6104, FA-6206 에서 정확히 0.4094999
}

# 단일형식 케이스에서만 역산이 신뢰 가능한 유효 Np (eta 미분리 기준)
TOPJIN_NP_EFF = {
    "PBT4":     [(543.1, 1.36526), (947.2, 1.36523)],       # 4-P.P 2단, 배플
    "MAXBLEND": [(260.0, 1.17694), (1979.8, 0.94155)],      # 맥스블렌드 단단
}

# 검토서에서 확인된 벤더 관행
TOPJIN_POWER_MARGIN = 1.10          # 보정동력 = 계산동력 x 1.10 (7/8 케이스)
TOPJIN_POWER_MARGIN_COIL = 1.20     # IN-COIL 사양 1건만 1.20
TOPJIN_MECH_EFF = 0.85              # 기계효율 입력란 기본값
TOPJIN_MAX_LOAD = 0.90              # 모터 부하율 상한 관행 (실적 68~88.7%)

# 벤더 형식명 -> 내부 키
VENDOR_ALIAS = {
    "MAXBLEND": "MAXBLEND",
    "4-P.P": "PBT4",
    "2-P.P": "PADDLE2",
    "6-P.P": "PBT6",
    "ANCHOR": "ANCHOR",
    "RIBBON": "RIBBON",
    "PROPELLER": "PROP",
}


def get(key, dataset="LIT"):
    """임펠러 특성 조회. dataset="TOPJIN" 이면 Nq 를 벤더 역산값으로 교체."""
    k = VENDOR_ALIAS.get(key.upper(), key.upper())
    if k not in LIT:
        raise KeyError(f"미등록 임펠러 형식: {key!r} — 등록형식: {sorted(LIT)}")
    imp = LIT[k]
    if dataset.upper() == "TOPJIN" and k in TOPJIN_NQ:
        clone = Impeller(imp.key, imp.name_ko, imp.name_en, imp.flow,
                         imp.Np_turb, imp.Kp, TOPJIN_NQ[k], imp.W_D,
                         imp.n_blades, imp.ks_MO, imp.dT, imp.mu_max,
                         imp.N_theta, source="TOPJIN 검토서 역산",
                         note=imp.note)
        return clone
    return imp


def all_keys():
    return sorted(LIT)

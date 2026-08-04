"""임펠러·탱크 형상 및 치수 산정.

"임펠러 형상과 치수를 어떻게 정하는가" 에 대한 답. 교반 설계는 절대치수를
직접 정하는 것이 아니라, 탱크 내경 T 를 기준으로 한 무차원 비율을 먼저
확정하고 거기에 T 를 곱해 치수를 얻는다.

표준탱크 형상 (standard configuration) — 문헌 상관식들이 전제하는 형상
    H/T = 1.0        액위/탱크경
    D/T = 1/3        임펠러경/탱크경
    C/T = 1/3        하단 임펠러 바닥간극/탱크경
    W/D = 1/5        날개폭/임펠러경
    배플 4매, B/T = 1/12, 벽간극 = B/6
    러시톤은 원판경 = 0.75D, 날개길이 = 0.25D

문헌 상관식(Np, Nq, 혼합시간)은 위 표준형상에서 얻어진 것이므로, 형상이
벗어나면 보정이 필요하고 정밀도가 떨어진다. 고점도 설계는 필연적으로
D/T 를 크게 가져가므로 이 점을 반드시 인지해야 한다.

근거
  [HIM] Handbook of Industrial Mixing Ch.6
  [PER] Perry's 8th ed. Sec.18-2 "Impeller selection"
  [OLD] Oldshue, "Fluid Mixing Technology"
"""

import math

from . import impellers as imp_db


# ---------------------------------------------------------------------------
# 점도대별 권장 형식·형상
#   (점도상한 cP, 임펠러키, D/T 권장, 익단속도 권장 m/s, 배플)
# ---------------------------------------------------------------------------
VISCOSITY_GUIDE = [
    (100,      "HYDROFOIL", 0.40, (3.0, 6.0),  True,  "저점도 대용량 블렌딩"),
    (1000,     "PBT4",      0.40, (2.5, 5.0),  True,  "범용 중저점도"),
    (10000,    "PBT4",      0.50, (2.0, 4.0),  True,  "중점도. D/T 확대·저속화"),
    (50000,    "MAXBLEND",  0.60, (1.5, 3.5),  False, "고점도. 광폭 대형임펠러"),
    (200000,   "MAXBLEND",  0.70, (1.0, 3.0),  False, "고점도. 배플 불필요"),
    (1000000,  "RIBBON",    0.93, (0.5, 2.0),  False, "초고점도 층류. 근접간극"),
    (float("inf"), "RIBBON", 0.95, (0.3, 1.5), False, "페이스트·반고체"),
]

# 교반강도 등급 — 단위체적 동력 P/V [W/m3]  [OLD], [PER]
AGITATION_LEVELS = {
    "mild":     (20, 100,   "완만 — 액위 균일화, 저점도 블렌딩"),
    "moderate": (100, 300,  "보통 — 일반 혼합, 열전달"),
    "vigorous": (300, 800,  "강 — 고체현탁, 가스분산, 반응"),
    "intense":  (800, 2000, "격렬 — 미세분산, 유화, 결정화"),
}


def select_type(mu_cP, duty="blend", has_solids=False, has_gas=False,
                shear_sensitive=False):
    """점도·용도로 임펠러 형식 1차 선정.

    반환 dict(type, dT, tip_speed_range, baffled, reason)
    """
    row = next(r for r in VISCOSITY_GUIDE if mu_cP <= r[0])
    mu_max, key, dT, tip, baffled, reason = row

    notes = [f"점도 {mu_cP:,.0f} cP → {reason}"]

    if has_gas and mu_cP <= 5000:
        key, dT = "RUSHTON", 0.33
        notes.append("가스분산 요구 → 반경류 원판터빈으로 변경")
    elif has_solids and mu_cP <= 10000:
        key, dT = "PBT4", 0.40
        notes.append("고체현탁 요구 → 축류 성분이 있는 45도 피치블레이드")
    if shear_sensitive and mu_cP <= 5000:
        key, dT = "HYDROFOIL", 0.45
        notes.append("전단민감 → 저전단 하이드로포일, D/T 확대·저속화")

    im = imp_db.get(key)
    return dict(type=key, name=im.name_ko, dT=dT, tip_speed_range=tip,
                baffled=baffled, reason=" / ".join(notes), impeller=im)


def n_stages(H, D, T, impeller=None):
    """필요 임펠러 단수.

    관행: 임펠러 1단이 담당하는 액주 높이는 대략 임펠러경 D 만큼이다.
      H/D <= 1.2 -> 1단,  <= 2.2 -> 2단,  <= 3.2 -> 3단 ...

    단, 광폭 대형임펠러(맥스블렌드형)와 근접간극형(앵커/리본)은 임펠러 자체가
    액주 전체를 덮는 하나의 구조물이므로 **다단으로 쌓지 않는다**. 항상 1단이고,
    필요한 높이 대응은 임펠러 자체 높이(하부 패들 + 상부 격자)로 흡수한다.
    """
    if impeller is not None:
        key = impeller if isinstance(impeller, str) else impeller.key
        im = imp_db.get(key)
        if im.key == "MAXBLEND" or im.flow == imp_db.TANGENTIAL:
            return 1
    ratio = H / D
    if ratio <= 1.2:
        return 1
    return int(math.ceil((ratio - 1.2) / 1.0)) + 1


def recommend(T, V, mu_cP, impeller_type=None, dT=None, n_imp=None,
              W_D=None, dish_volume_frac=0.0):
    """탱크 T·체적 V·점도에서 전체 형상치수를 산출한다.

    dish_volume_frac : 하부 경판이 차지하는 체적비 (0.0 이면 직관부만)
    반환 dict — 전체 치수표
    """
    if impeller_type is None:
        sel = select_type(mu_cP)
    else:
        # 형식은 지정받되, 익단속도·배플 권장값은 점도 가이드에서 그대로 가져온다
        auto = select_type(mu_cP)
        im_fixed = imp_db.get(impeller_type)
        sel = dict(type=im_fixed.key, impeller=im_fixed, dT=dT,
                   baffled=(False if im_fixed.flow == imp_db.TANGENTIAL
                            or im_fixed.key == "MAXBLEND" else auto["baffled"]),
                   tip_speed_range=auto["tip_speed_range"],
                   name=im_fixed.name_ko,
                   reason=f"형식 지정({im_fixed.name_ko}) / {auto['reason']}")
    im = sel["impeller"]
    if dT is None:
        dT = sel["dT"]
    dT = min(max(dT, im.dT[0]), im.dT[1])

    A = math.pi * T ** 2 / 4.0
    V_straight = V * (1.0 - dish_volume_frac)
    H = V_straight / A                       # 직관부 액위
    D = dT * T
    if n_imp is None:
        n_imp = n_stages(H, D, T, im)

    close_clearance = im.flow == imp_db.TANGENTIAL
    # 광폭 대형임펠러: 액주 전체를 한 몸으로 덮으므로 바닥 근처에 앉힌다
    wide_large = im.key == "MAXBLEND" or dT >= 0.55

    # 바닥간극 C/T
    if close_clearance:
        C_T = 0.05
    elif wide_large:
        C_T = 0.04            # 하부 패들 하단이 바닥에 근접 (0.03~0.05T)
    elif n_imp == 1:
        C_T = 0.33 if H / T <= 1.2 else 0.25
    else:
        C_T = 0.25
    C = C_T * T

    # 날개폭
    if W_D is None:
        W_D = im.W_D if im.W_D else 0.15
    W = W_D * D

    # 다단 배치: 하단은 C, 최상단은 액면 아래 (0.7~1.0)H 부근
    elevations = []
    if n_imp == 1:
        elevations = [C]
    else:
        top = min(H - 0.5 * D, 0.85 * H)
        top = max(top, C + 1.0 * D)
        step = (top - C) / (n_imp - 1)
        elevations = [C + i * step for i in range(n_imp)]

    spacing = (elevations[1] - elevations[0]) if n_imp > 1 else None

    # 배플
    baffled = sel["baffled"]
    n_baffle = 4 if baffled else 0
    B = T / 12.0 if baffled else 0.0
    B_wall = B / 6.0 if baffled else 0.0
    if baffled and mu_cP > 5000:
        B_wall = B / 2.0   # 고점도는 벽에서 더 띄워 정체역 방지

    res = dict(
        T=T, V=V, H=H, H_T=H / T, mu_cP=mu_cP,
        impeller_type=sel["type"], impeller_name=sel["name"],
        flow=im.flow, reason=sel["reason"],
        D=D, D_T=dT, n_impellers=n_imp,
        W=W, W_D=W_D, C=C, C_T=C_T,
        elevations=elevations, spacing=spacing,
        spacing_over_D=(spacing / D) if spacing else None,
        baffled=baffled, n_baffles=n_baffle, B=B, B_T=(B / T) if B else 0.0,
        B_wall_clearance=B_wall,
        tip_speed_range=sel["tip_speed_range"],
        close_clearance=close_clearance,
    )

    # 형식별 상세 형상
    if sel["type"] == "RUSHTON":
        res["disc_D"] = 0.75 * D
        res["blade_L"] = 0.25 * D
        res["n_blades"] = 6
        res["blade_thk"] = max(0.004, 0.01 * W)
    elif sel["type"].startswith("PBT"):
        res["n_blades"] = im.n_blades
        res["blade_angle_deg"] = 45.0
        res["hub_D"] = 0.25 * D
        res["blade_thk"] = max(0.005, 0.02 * W)
    elif sel["type"] == "PADDLE2":
        res["n_blades"] = 2
        res["blade_angle_deg"] = 90.0
        res["hub_D"] = 0.25 * D
        res["blade_thk"] = max(0.005, 0.02 * W)
    elif sel["type"] == "MAXBLEND":
        # 하부 광폭 패들 + 상부 격자(그리드) 구조. 전체가 액주를 덮는다.
        res["lower_paddle_H"] = 0.35 * H
        res["lower_paddle_W"] = D
        res["grid_H"] = 0.50 * H
        res["total_impeller_H"] = 0.85 * H
        res["n_grid_bars"] = 2
        res["blade_thk"] = max(0.006, 0.004 * D)
        res["note_shape"] = ("하부 광폭 패들(높이 0.35H)이 바닥 근처 유동을, "
                             "상부 격자(0.50H)가 액면부 인입을 담당. 임펠러 전체가 "
                             "액주 대부분을 덮으므로 단수는 1단이고 바닥간극은 "
                             "0.04T 로 근접시킨다. 배플 없이 축방향 순환 형성")
    elif sel["type"] in ("ANCHOR", "RIBBON"):
        res["wall_clearance"] = 0.02 * T
        res["pitch"] = D if sel["type"] == "RIBBON" else None
        res["ribbon_W"] = 0.10 * D if sel["type"] == "RIBBON" else None
        res["n_flights"] = 2
        res["blade_thk"] = max(0.008, 0.006 * D)

    return res


def format_geometry(g):
    """치수표를 사람이 읽을 텍스트로."""
    L = []
    L.append("=" * 78)
    L.append(f"임펠러·탱크 형상 치수  —  {g['impeller_name']} ({g['flow']})")
    L.append("=" * 78)
    L.append(f"선정근거 : {g['reason']}")
    L.append("")
    L.append("[탱크]")
    L.append(f"  탱크 내경        T = {g['T']*1000:8.0f} mm")
    L.append(f"  액위             H = {g['H']*1000:8.0f} mm   (H/T = {g['H_T']:.3f})")
    L.append(f"  액체 체적        V = {g['V']:8.3f} m3")
    L.append("")
    L.append("[임펠러]")
    L.append(f"  형식               = {g['impeller_type']}  x {g['n_impellers']} 단")
    L.append(f"  임펠러경         D = {g['D']*1000:8.0f} mm   (D/T = {g['D_T']:.3f})")
    L.append(f"  날개폭           W = {g['W']*1000:8.0f} mm   (W/D = {g['W_D']:.3f})")
    L.append(f"  바닥간극         C = {g['C']*1000:8.0f} mm   (C/T = {g['C_T']:.3f})")
    for i, e in enumerate(g["elevations"], 1):
        L.append(f"  {i}단 설치높이       = {e*1000:8.0f} mm  (바닥에서)")
    if g["spacing"]:
        L.append(f"  임펠러 간격      S = {g['spacing']*1000:8.0f} mm   "
                 f"(S/D = {g['spacing_over_D']:.2f})")
    for k, label in [("n_blades", "날개 수"), ("blade_angle_deg", "날개 각도 [deg]"),
                     ("disc_D", "원판경 [m]"), ("blade_L", "날개 길이 [m]"),
                     ("hub_D", "허브경 [m]"), ("blade_thk", "날개 두께 [m]"),
                     ("lower_paddle_H", "하부 패들 높이 [m]"),
                     ("grid_H", "상부 격자 높이 [m]"),
                     ("wall_clearance", "벽 간극 [m]"), ("pitch", "피치 [m]"),
                     ("ribbon_W", "리본 폭 [m]")]:
        if g.get(k) is not None:
            v = g[k]
            if k in ("n_blades", "blade_angle_deg", "n_grid_bars"):
                L.append(f"  {label:<16} = {v:8.0f}")
            else:
                L.append(f"  {label:<16} = {v*1000:8.0f} mm")
    if g.get("note_shape"):
        L.append(f"  형상 비고 : {g['note_shape']}")
    L.append("")
    L.append("[배플]")
    if g["baffled"]:
        L.append(f"  배플 {g['n_baffles']}매,  폭 B = {g['B']*1000:.0f} mm "
                 f"(B/T = {g['B_T']:.4f}),  벽간극 = {g['B_wall_clearance']*1000:.0f} mm")
    else:
        L.append("  무배플 — 광폭/근접간극 임펠러로 선회류 억제")
    L.append("")
    L.append(f"[권장 익단속도]  {g['tip_speed_range'][0]:.1f} ~ "
             f"{g['tip_speed_range'][1]:.1f} m/s")
    L.append("=" * 78)
    return "\n".join(L)

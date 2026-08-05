"""공정 성능 검토 — 고체현탁, 자켓/코일 열전달, 가스분산.

D&K켐텍 검토서 FA-6201 은 IN-COIL 사양이므로 내부 코일 열전달 검토가
필요하고, 코일이 유동에 미치는 저항도 동력에 반영해야 한다.

근거
  [ZWI] Zwietering T.N., Chem.Eng.Sci. 8 (1958) 244
  [HIM] Handbook of Industrial Mixing Ch.10 (고체현탁), Ch.14 (열전달)
  [PER] Perry's 8th ed. Sec.18, Table 18-4/18-5
"""

import math

from .report import CalcResult
from . import impellers as imp_db
from .core import reynolds, G

# Zwietering S 계수 — T/D = 3, C/T = 1/4 기준 대표값
#   S 는 임펠러 형식·D/T·C/T 에 강하게 의존한다. 아래는 문헌 대표값이며
#   S ∝ (T/D)^1.33 로 D/T 보정한다. 정밀 설계는 실측 필수.
S_ZWIETERING = {
    "RUSHTON":   6.7,
    "FBT6":      6.7,
    "PBT4":      5.8,
    "PBT6":      5.8,
    "PROP":      6.6,
    "HYDROFOIL": 6.2,
    "PADDLE2":   8.0,
    "MAXBLEND":  7.0,
    "ANCHOR":    12.0,
    "RIBBON":    12.0,
}


def just_suspended_speed(rho_L, mu, rho_s, d_p, X_wt_pct, D, T,
                         impeller="PBT4", S=None):
    """Zwietering 임계현탁 회전수 N_js [rev/s].

        N_js = S * nu^0.1 * (g*drho/rho_L)^0.45 * X^0.13 * d_p^0.2 / D^0.85

      nu     동점도 [m2/s] = mu/rho_L
      drho   rho_s - rho_L [kg/m3]
      X      고체 장입량 [wt%] (고체질량/액체질량 x 100)
      d_p    입자경 [m]

    적용한계: Zwietering 식은 저~중점도(<1000 cP)·희박현탁에서 검증된 식이다.
    고점도에서는 과소평가 경향이 있어 안전측 여유가 필요하다.
    """
    im = imp_db.get(impeller)
    if S is None:
        S = S_ZWIETERING.get(im.key, 6.5) * (T / D / 3.0) ** 1.33

    nu = mu / rho_L
    drho = rho_s - rho_L
    if drho <= 0:
        raise ValueError("고체 밀도가 액체보다 작거나 같음 — 부상현탁 문제로 별도 검토")

    N_js = (S * nu ** 0.1 * (G * drho / rho_L) ** 0.45
            * X_wt_pct ** 0.13 * d_p ** 0.2 / D ** 0.85)

    r = CalcResult("고체 임계현탁 회전수 (Zwietering)", "[ZWI] 1958 / [HIM] Ch.10")
    r.add_input("rho_L (액체 밀도)", rho_L, "kg/m3")
    r.add_input("mu (액체 점도)", mu, "Pa*s", f"{mu*1000:.0f} cP")
    r.add_input("rho_s (고체 밀도)", rho_s, "kg/m3")
    r.add_input("d_p (입자경)", d_p * 1e6, "um")
    r.add_input("X (고체 장입량)", X_wt_pct, "wt%")
    r.add_input("D (임펠러경)", D, "m")
    r.add_input("T (탱크 내경)", T, "m")
    r.add_step("S 계수", f"{im.key} 기준값 x (T/D/3)^1.33", S)
    r.add_step("nu (동점도)", "mu/rho_L", nu, "m2/s")
    r.add_step("N_js", "S*nu^0.1*(g*drho/rho)^0.45*X^0.13*dp^0.2/D^0.85",
               N_js, "rev/s")
    r.add_step("N_js", "", N_js * 60.0, "rpm")
    Re_chk = rho_L * N_js * D ** 2 / mu
    r.add_step("Re @N_js", "rho*N_js*D^2/mu", Re_chk)
    if Re_chk < 1e4:
        r.warn(f"Re@N_js = {Re_chk:.0f} < 1e4 — Zwietering 식은 난류·배플탱크 "
               "전제로 유도된 식이므로 이 조건에서는 적용범위를 벗어난다. "
               "고점도/항복응력 계에서는 cavern_diameter() 의 캐번 기준으로 "
               "판정할 것. [Ayranci & Kresta, CERD 2014]")
    if mu > 1.0:
        r.warn(f"점도 {mu*1000:.0f} cP — Zwietering 식 검증범위(<1000 cP) 초과. "
               "결과는 과소평가일 수 있으므로 회전수 20~30% 상향 검토")
    if X_wt_pct > 2.0:
        r.warn(f"고체 장입량 {X_wt_pct} wt% — 원식의 X^0.13 지수는 2 wt% 까지만 "
               "검증되었다. 2~35 wt% 구간은 입자종류별로 0.17~0.32 를 쓰라는 "
               "제안이 있다. [Ayranci & Kresta, CERD 2014]")
    r.results.update(N_js_rps=N_js, N_js_rpm=N_js * 60.0, S=S)
    return r


def cavern_diameter(rho, N, D, T, Np, tau_y):
    """항복응력 유체의 캐번(운동영역) 직경 Dc [m] — Elson 구형 캐번 모델.

        (Dc/D)^3 = (4/pi^2) * Np*rho*N^2*D^2 / tau_y

    항복응력 tau_y [Pa] 를 가지는 유체(충전 수지, 페이스트, 슬러리)에서는
    임펠러 주변에만 유동이 생기고 그 밖은 정지한다. 이 정지영역이 데드존이다.
    Dc >= T 가 되어야 탱크 전체가 움직인다.

    고점도·항복응력 계에서는 Zwietering 식(Re>1e4, 배플탱크 전제)이 아니라
    이 캐번 기준으로 판정해야 한다.  [Elson, Cheesman & Nienow 1986]

    반환 CalcResult
    """
    r = CalcResult("항복응력 유체 캐번 직경 (Elson)",
                   "Elson/Cheesman/Nienow 1986 — 구형 캐번 모델")
    r.add_input("tau_y (항복응력)", tau_y, "Pa")
    r.add_input("Np (동력수)", Np, "-")
    r.add_input("N (회전수)", N, "rev/s", f"{N*60:.1f} rpm")
    r.add_input("D (임펠러경)", D, "m")
    r.add_input("T (탱크 내경)", T, "m")

    ratio3 = (4.0 / math.pi ** 2) * Np * rho * N ** 2 * D ** 2 / tau_y
    Dc = D * ratio3 ** (1.0 / 3.0)
    r.add_step("(Dc/D)^3", "(4/pi^2)*Np*rho*N^2*D^2/tau_y", ratio3)
    r.add_step("Dc (캐번 직경)", "D*((Dc/D)^3)^(1/3)", Dc, "m")
    r.add_step("Dc/T", "", Dc / T)
    r.add_check(f"Dc={Dc:.3f} m >= T={T:.3f} m (탱크 전체 유동)", Dc >= T,
                "미달 시 벽면 정체역 발생 — 회전수 상향 또는 D/T 확대, "
                "또는 근접간극형(앵커/리본)으로 형식 변경")
    r.results.update(Dc=Dc, Dc_over_T=Dc / T, full_motion=Dc >= T)
    return r

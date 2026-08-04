# Agitator Calctoys (agitcalc)

## 다른 PC에서 이어서 작업하기

```bash
git clone https://github.com/sejong-21c/sejong-platform-v2.git
cd sejong-platform-v2/tools/agitcalc
python tests/run_tests.py                                   # 손계산 50항목
python tests/gen_test_vectors.py && node web/test_core.mjs  # 파이썬<->JS 대조
```

필요한 것은 **Python 3 와 Node 뿐**입니다 (pip 설치 패키지 없음, 표준 라이브러리만 씁니다).

- 바로 써보기: `web/index.html` 더블클릭 (오프라인 동작)
- 플랫폼 화면: https://sejong21c.com → 기술부 → 교반기 선정·설계
- 이 프로젝트에서 Claude Code 를 켤 때는 저장소 루트(`sejong-platform-v2`)에서
  여는 것이 편합니다. 플랫폼 모듈(`modules/agitator/`)과 엔진을 같이 봐야 하기 때문입니다.

### 지금까지 진행 상황 (2026-08-04)

끝난 것
- 엔진 전체 (동력·형상·축·공정검토·벤더 대조), 손계산 50항목 PASS
- 파이썬↔JS 216 벡터·715 비교 일치 (1e-9)
- D&K켐텍 검토서 R5 8건 역산 감사 (`verification/dk_kemtec_audit.py`)
- 세종플랫폼 기술부 도구 탑재 + GitHub Pages 배포
- 길이 단위 mm 표시, 계산서 HTML 표, 인쇄(PDF)·Excel(.xls) 출력

**다음에 결정해야 할 것 (부장님 답 대기 중)**
1. **미요청 함수 3개를 지울지** — `process.py` 의 `gas_dispersion_check`,
   `jacket_heat_transfer`, `coil_heat_transfer`. 요청 없이 넣은 것들입니다.
   IN-COIL 검토서가 실제로 있어 열전달은 곧 쓸 수도 있어 판단이 필요합니다.
   지우면 JS 포팅·테스트 벡터에서도 함께 걷어내야 합니다.
2. **협력업체(TOPJIN) 확인요청 3건 발송** — 아직 안 보냈습니다.
   ① 임펠러별 Np–Re 표 공개 (조합형 4건 모순)
   ② '교반소요시간' 정의 (유체역학적 혼합시간인지 공정 요구시간인지)
   ③ 축 강도·처짐·위험속도 검토서 추가 (V.V.V.F 전 구간 공진 회피 포함)

**v0.2 최우선 과제** — 동력수 모델을 Kamei–Hiraoka 로 교체 (§3 참조).
현재 2점근 모델은 천이역 10~30% 편차가 있고, 검토서 8건이 전부 천이역입니다.

### 파일을 고칠 때 반드시

계산 엔진은 **파이썬이 원본, JS 가 포팅**입니다. 파이썬 수식을 고치면:

```bash
python tests/run_tests.py                                   # 손계산 확인
python tests/gen_test_vectors.py && node web/test_core.mjs  # JS 동기화 확인
```

`web/agitcalc-core.js` 는 플랫폼 모듈이 **직접 참조**합니다
(`modules/agitator/agitator.html` → `../../tools/agitcalc/web/agitcalc-core.js`).
복사본은 두지 않으므로 이 파일만 고치면 화면에 바로 반영됩니다.
단, 모듈 HTML 을 고쳤으면 저장소 루트 `index.html` 의 `AGITATOR_BUILD`
번호를 올려야 브라우저 캐시가 갱신됩니다.

---


압력용기 부착형 **교반기(Agitator) 선정·설계 예비 계산 툴킷**.
견적, 사전 검토, 협력업체 선정검토서 대조 검증 용도로 만든 사내용 패키지입니다.
`Pressure Vessel Calctoys(pvcalc)` 와 동일한 구조(파이썬 엔진 + JS 포팅 + 자동 대조)입니다.

> ⚠ **본 계산 결과는 제조사 실측 성능표나 검증된 상용 소프트웨어를 대체하지 않습니다.**
> 특히 **Re < 10⁴ (천이·층류)** 영역은 문헌 상관식 자체의 오차가 큽니다
> (동력 ±15%, 혼합시간 ±50% 이상). 납품·인허가용은 별도 검증을 거쳐야 합니다.

## 구성

| 모듈 | 내용 | 근거 |
|---|---|---|
| `agitcalc/impellers.py` | 임펠러 DB — Np, Kp, Nq, D/T, 점도상한, Metzner-Otto ks | HIM Ch.6, Bates 1963, Nagata 1975 |
| `agitcalc/core.py` | Re·Fr·익단속도, 동력수, 동력, 토출량, 혼합시간, 볼텍스 판정 | HIM Ch.6/9 |
| `agitcalc/geometry.py` | 형식 선정, 임펠러·배플 치수 산정 (D/T, W/D, C/T, 단수, 배치) | HIM Ch.6, Perry's 18 |
| `agitcalc/shaft.py` | **축 비틀림·굽힘 조합응력, 처짐, 위험속도** | ASME B106.1M, HIM Ch.21 |
| `agitcalc/process.py` | Zwietering 현탁, **Elson 캐번**, 자켓/코일 열전달, 가스분산 | Zwietering 1958, Elson 1986 |
| `agitcalc/select.py` | 종합 선정 드라이버 (D/T·rpm 동시 최적화) | — |
| `agitcalc/vendor.py` | 협력업체(TOPJIN) 검토서 방식 재현 및 대조 | 역산 결과 |
| `verification/dk_kemtec_audit.py` | **D&K켐텍 검토서 R5 8건 역산 감사** | — |
| `tests/run_tests.py` | 손계산 대조 검증 50항목 | — |
| `web/index.html` | **단독 실행판** — 더블클릭하면 열림. 서버·로그인·CDN 불필요 | — |
| `web/agitcalc-core.js` | JS 엔진 (파이썬 1:1 포팅, 웹·플랫폼 공용) | — |
| `web/test_core.mjs` | 파이썬↔JS 자동 대조 (216 벡터 · 715 비교) | — |

## 바로 써 보기

`web/index.html` 을 **더블클릭**하면 브라우저에서 바로 열립니다.
`pvcalc/web/index.html` 과 같은 방식이라 외부 CDN·서버·로그인 의존성이 없고
사내망 공유폴더에서 열어도 동작합니다. `agitcalc-core.js` 가 같은 폴더에
있어야 합니다(두 파일이 한 벌).

**선정 계산** 탭 상단의 *예제 불러오기* 에서 실제 D&K켐텍 검토서 조건 6건
(FA-6101/6102/6104/6201/6205/6302)을 골라 즉시 결과를 볼 수 있습니다.
**협력업체 검토서 대조** 탭은 FA-6101 값이 이미 채워져 있어 *대조 실행* 만
누르면 됩니다.

저장은 그 브라우저의 localStorage 에만 됩니다(단독판). 여러 사람이 공유해야
하면 세종플랫폼판(§5)을 쓰십시오.

## 사용법

```bash
python tests/run_tests.py                                  # 검증 테스트
python verification/dk_kemtec_audit.py                     # 벤더 검토서 감사
python tests/gen_test_vectors.py && node web/test_core.mjs  # 엔진 일치 확인
```

```python
import agitcalc as ac

# "점도 15000 cP, 비중 1300, 50 m3 탱크(내경 4.5 m)를 교반하고 싶다"
res = ac.design(V=50.0, rho=1300.0, mu_cP=15000.0, T=4.5)
print(ac.full_report(res))          # 계산서 전문
print(res["motor_kW"], res["rpm"])  # 18.5, 21
```

`T` 를 생략하면 H/T=1.1 기준으로 탱크 내경까지 산정합니다.
회전수 결정 기준은 `basis=` 로 바꿉니다: `"level"`(교반강도 P/V, 기본) ·
`"blend"`(목표 혼합시간) · `"suspension"`(고체 임계현탁) · `"rpm"`(직접 지정).

> ⚠ **기본값은 "일반 혼합"입니다.** `basis="level"` 의 기본 교반강도 `moderate`
> 는 P/V 200 W/m³ 로, 용도를 모를 때의 일반 블렌딩 목표값입니다. 이 때문에
> 실제 공정 요구를 반영해 선정한 협력업체 견적보다 작게 나올 수 있습니다
> (FA-6101 의 경우 본 툴 11 kW vs 벤더 18.5 kW).
> **벤더 견적을 대조할 때는 `basis="rpm", rpm=<검토서 값>` 으로 조건을 고정**하고
> 동력만 비교하십시오. 신규 설계라면 반응·용해·분산 등 실제 용도에 맞는
> `level=` 또는 `target_PV=` / `target_blend_min=` 를 지정해야 합니다.
> 교반강도 등급은 `ac.AGITATION_LEVELS` 로 확인할 수 있습니다.

---

## 1. 교반기 선정 계산식 — 무엇을 어떤 순서로 정하는가

교반 설계는 **절대치수를 직접 정하는 것이 아니라, 탱크 내경 T 기준 무차원비를
먼저 확정하고 거기에 T 를 곱해 치수를 얻는 것**입니다. 순서는 다음과 같습니다.

**① 형식 선정 — 점도가 1차 결정변수**

| 점도 [cP] | 권장 형식 | D/T | 익단속도 [m/s] | 배플 |
|---|---|---|---|---|
| ~100 | 하이드로포일 | 0.40 | 3.0~6.0 | 필요 |
| ~1,000 | 45° 피치블레이드 | 0.40 | 2.5~5.0 | 필요 |
| ~10,000 | 45° 피치블레이드 | 0.50 | 2.0~4.0 | 필요 |
| ~50,000 | 광폭 대형패들(맥스블렌드형) | 0.60 | 1.5~3.5 | 불필요 |
| ~200,000 | 광폭 대형패들 | 0.70 | 1.0~3.0 | 불필요 |
| 200,000+ | 헬리컬 리본 / 앵커 | 0.93 | 0.5~2.0 | 불필요 |

가스분산이 있으면 반경류(러시톤), 고체현탁이면 축류 성분(피치블레이드),
전단민감이면 저전단 하이드로포일로 갈아탑니다.

**② 표준형상 비율** — 문헌 상관식이 전제하는 형상
```
H/T = 1.0   D/T = 1/3   C/T = 1/3   W/D = 1/5
배플 4매, B/T = 1/12, 벽간극 = B/6
러시톤: 원판경 0.75D, 날개길이 0.25D
```
고점도 설계는 필연적으로 D/T 를 크게 가져가므로 이 전제에서 벗어나고,
그만큼 정밀도가 떨어진다는 점을 인지해야 합니다.

**③ 무차원수**
```
Re    = ρ·N·D²/μ        (N [rev/s]) — 유동영역 결정
Fr    = N²·D/g                       — 무배플 볼텍스 판정
v_tip = π·D·N                        — 전단·재질 마모 지표
```

**④ 동력수 → 소요동력 → 모터**
```
Np(Re) = max(Kp/Re, Np_turb)                   2점근 모델
         × [(W/D)/(W/D)std]^1.25               날개폭 보정
         × (n/n_std)^0.8                        날개수 보정
         × 0.7 (무배플·난류·반경류/혼합류)

P       = Σ Np·ρ·N³·D⁵ × 간섭계수(다단)
P_motor = P / 기계효율 × 여유율   →  IEC 표준용량으로 스냅
```

**⑤ 성능 확인**
```
Q      = Σ Nq·N·D³                             토출량
Q/V                                            토출유량수 [回/min]
P/V                                            교반강도 [W/m³]
N·θ95 = 5.9·Np^(-1/3)·(T/D)²·(H/T)^0.5        혼합시간(난류)
         × (10⁴/Re)^0.5                         천이역 보정
```

**⑥ 축 — 검토서에서 가장 많이 빠지는 항목**
```
τ_allow = min(0.30Sy, 0.18Su) × 0.75(키홈)     ASME B106.1M
τ_max   = √(Mb² + T²)/Zp                        최대전단응력설
δ       = Σ F·a²(3L-a)/(6EI)                    캔틸레버 처짐
Nc      = (1/2π)·√(3EI/L³·m_eq)                 1차 위험속도
          → N/Nc ≤ 0.70 (아임계 운전)
```

**⑦ 공정별 추가 검토**
- 고체현탁: Zwietering `N_js = S·ν^0.1·(gΔρ/ρ)^0.45·X^0.13·dp^0.2/D^0.85`
- **항복응력 유체: Elson 캐번 `(Dc/D)³ = (4/π²)·Np·ρ·N²·D²/τy`, Dc ≥ T 필요**
- 비뉴턴: Metzner-Otto `γ̇ = ks·N`, `μ_app = K·γ̇^(n-1)`
- 열전달: 자켓 `Nu = 0.74·Re^0.67·Pr^0.33·(μ/μw)^0.14`, 코일 `0.87·Re^0.62·…`

---

## 2. D&K켐텍 YDK-II 선정검토서 R5 감사 결과

협력업체(TOPJIN) 작성 검토서 8건(FA-6101/6102/6104/6201/6205/6206/6301/6302)의
출력값을 입력값으로부터 재현해 **확정된 식과 미확정된 식을 분리**했습니다.
`python verification/dk_kemtec_audit.py` 로 재현 가능합니다.

### 정확히 재현된 식 (8/8 케이스, 상대오차 1e-8 이내) — 신뢰 가능

| 항목 | 확정된 식 |
|---|---|
| Reynolds수 | `Re = ρ·N·D_하단²/μ` — **하단 임펠러 직경 기준** |
| TIP SPEED | `TP = π·D_하단·N` |
| 토출유량수 | `Q/V = Σ(Nq·rpm·D³)/V` |
| 보정동력 | `= 계산동력 × 1.10` (7건) |
| 부하율 | `= 보정동력 / 모터정격` |

역산된 토출유량수 **Nq 는 8건 전부 정확히 일치**해 확정값으로 볼 수 있습니다.

| 벤더 형식 | 역산 Nq | 문헌 Nq | 비고 |
|---|---|---|---|
| MAXBLEND | **0.2100** | 0.35 | 2건 정확 일치 |
| 2-P.P | **0.5000** | 0.40 | 4건 정확 일치 |
| 4-P.P | **0.4095** | 0.79 | 2건 정확 일치 — **0.41 이 아님** |

### 재현되지 않은 항목 — 확인 필요

**① 계산동력** — `P = Np·ρ·N³·ΣD⁵` 형태는 맞으나 Np 룩업표가 비공개입니다.
단일형식 케이스는 내부 정합성이 좋지만, **조합형(MAXBLEND+2-P.P) 4건이 서로 모순**됩니다.

| ITEM | 구성 | Re | d/T | 역산 유효 Np | 비고 |
|---|---|---|---|---|---|
| FA-6201~6203 | MAXBLEND+2-P.P | 174 | 0.766 | **1.402** | IN-COIL |
| FA-6301 | MAXBLEND+2-P.P | 218 | 0.769 | **2.443** | 4-BAFFLES |
| FA-6302 | MAXBLEND+2-P.P | 224 | 0.808 | **2.053** | NON-BAFFLE |
| FA-6205 | MAXBLEND+2-P.P | 250 | 0.769 | **2.443** | 4-BAFFLES |
| FA-6206 | 4-P.P ×2 | 543 | 0.567 | 1.365 | 정합 |
| FA-6104 | 4-P.P ×2 | 947 | 0.533 | 1.365 | 정합 |
| FA-6101 | MAXBLEND | 260 | 0.667 | 1.177 | 정합 |
| FA-6102 | MAXBLEND | 1980 | 0.656 | 0.942 | 정합 |

동력수는 Re 가 낮을수록 **커져야** 하는데, Re 가 가장 낮은 FA-6201 이 오히려
가장 작습니다(1.402 < 2.443). 또 Re 218 과 250(13% 차이)에서 계산동력이
6.0511 kW 로 **완전히 동일**해, Np 를 Re 구간 룩업(계단식)으로 읽고 있음을 시사합니다.

**② 보정계수 근거 미표기** — 7건은 1.10, FA-6201 만 1.20입니다.
FA-6201 이 유일한 IN-COIL 사양이므로 내부 코일 저항 가산으로 추정되나 확인이 필요합니다.
(내부 코일은 배플과 유사한 선회류 억제 효과로 동력 10~20% 증가가 알려져 있어 방향은 타당)

**③ 교반소요시간(추정) 재현 불가** — 8건 모두 어떤 표준 상관식으로도 재현되지 않습니다.
`t × (Q/V)` 로 환산한 탱크 회전수가 88~840회로 **30배 흩어져** 있고,
FA-6102 는 정확히 `60.0 min` 입니다. 공정 요구시간을 그대로 기입한 것으로 보이며,
**유체역학적 혼합시간과는 다른 값**입니다. FA-6101 은 검토서 134.2분 vs
본 툴 θ95 약 3.6분으로 40배 차이가 납니다 — 정의를 벤더에 확인해야 합니다.

**④ 축 강도·위험속도 검토 항목이 아예 없음** — 가장 큰 공백입니다.
축경이 SJ 모델 표준값(70/80/90/100/140/150)으로만 정해져 있고,
전달토크로 역산한 비틀림응력이 **4.6~10.9 MPa로 흩어져** 있습니다.
즉 축은 강도 계산이 아니라 모델 표준으로 결정된 것입니다.
특히 **MOTOR = V.V.V.F(인버터 가변속)** 사양이므로 단일 정격점이 아니라
**운전 전 구간이 공진 회피대역(0.7~1.3×Nc) 밖**이어야 합니다.

### 교차검증 — 우리 엔진 vs 벤더

FA-6101 조건(50 m³, 15,000 cP, T=4.5 m)에서:

| | 형식 | D (D/T) | rpm | v_tip | 모터 | 축 |
|---|---|---|---|---|---|---|
| **벤더** | MAXBLEND | 3.00 m (0.667) | 20 | 3.14 m/s | 18.5 kW (81.9%) | φ150 × 3700 |
| **agitcalc** | MAXBLEND | 2.48 m (0.550) | 21 | 2.72 m/s | 15.0 kW (70.2%) | φ130 × 3564 |

**같은 형식·같은 급으로 수렴**하며 벤더가 다소 보수적입니다(더 큰 D, 한 단계 큰 모터).
**동일 형상(D=3.0 m, 20 rpm)을 우리 모델에 넣으면 액체동력 9.83 kW vs 벤더 역산 11.70 kW —
차이 16%** 로, 천이역 Np 불확실도(±15~20%) 범위 안입니다.

### 결론

검토서의 **수력 계산 골격은 표준적이고 옳습니다.** 다만 세 가지를 벤더에 요청하십시오.

1. **임펠러별 Np–Re 표 또는 곡선 공개** — 조합형 4건의 모순 해소가 필요합니다.
2. **'교반소요시간'의 정의** — 유체역학적 혼합시간인지 공정 요구시간인지.
3. **축 강도·처짐·위험속도 검토서 추가** — V.V.V.F 전 구간 공진 회피 포함.

---

## 3. ⚠ 동력수 모델의 정밀도 한계 (v0.2 개선 예정)

현재 구현한 2점근 모델 `Np = max(Kp/Re, Np_turb)` 은 Nagata 계열이며,
**층류·난류 양 극단에서는 잘 맞지만 천이역에서 문헌 대비 10~30% 편차**가
보고되어 있습니다(다단 피치블레이드는 최대 50~80%).
출처: J. Chem. Eng. Japan, [doi:10.1252/jcej.11we115](https://doi.org/10.1252/jcej.11we115)

**D&K 검토서 8건이 모두 Re 174~1,980 의 천이역**이므로 정확히 이 오차대에 해당합니다.

더 정확한 대안은 **Kamei–Hiraoka 상관식**으로, 패들·러시톤·피치패들·프로펠러·
Pfaudler·**앵커·헬리컬리본**을 층류~난류 전역에서 무배플/부분배플/완전배플까지
구분해 다룹니다. 출처 논문이 **CC-BY 라서 상업적 사용에 제약이 없습니다**:

> Furukawa, Kato, Inoue, Kato, Tada & Hashimoto,
> "Correlation of Power Consumption for Several Kinds of Mixing Impellers",
> *Int. J. Chem. Eng.* 2012, 106496 — [doi:10.1155/2012/106496](https://doi.org/10.1155/2012/106496)
> *"permits unrestricted use, distribution, and reproduction in any medium,
> provided the original work is properly cited."*

**v0.2 계획**: Kamei–Hiraoka 를 구현해 기본 모델로 전환하고, 현재의 2점근 모델은
대조용으로 남깁니다.

### 저작권 주의 (설계팀 공유 필요)

개별 수치(“러시톤 Np ≈ 5.5”)는 **사실이라 저작권 대상이 아니지만**, 표의 선택·배열은
한국 저작권법 **제6조(편집저작물)** 로, 나아가 **제4장의2(제91~98조) 데이터베이스제작자의
권리**로 보호됩니다(창작성 없어도 5년). EU 도 동일 취지(15년).

- **금지**: Handbook of Industrial Mixing / Perry's / Nagata 책의 표를 스캔·복사해
  사내 표준이나 계산서에 넣는 것.
- **권장**: 필요한 값만 **재입력**하고 값별로 1차 출처를 인용하며, **우리 임펠러
  카탈로그 기준의 자체 스키마**로 재배열. → 본 패키지 `impellers.py` 가 이 방식입니다.
- **CC-BY-NC 는 사용 금지로 취급하십시오.** 판매 제품을 위한 사내 엔지니어링은
  상업적 사용에 해당합니다.

---

## 4. 오픈소스 조사 결과

교반기 설계·CFD 관련 오픈소스를 조사했습니다. **결론: 완성된 교반기 설계 오픈소스
스위트는 존재하지 않습니다.** 계산 레이어는 사내 개발이 맞습니다(= 본 패키지).

### 지금 바로 쓸 수 있는 것

| 프로젝트 | 라이선스 | 교반 관련 내용 |
|---|---|---|
| **CalebBell/fluids** | MIT | 실제로 있음. `Kp_helical_ribbon_Rieger`(층류 리본 Kp, 형상 파라미터), `time_helical_ribbon_Grenville`, `agitator_time_homogeneous`. `pip install fluids` |
| **CalebBell/ht** | MIT | `ht.conv_jacket` — `Lehrer`, `Stein_Schmidt` (자켓**측** 열전달). ⚠ 공정측(교반) 계수는 없어 직접 구현 필요 |
| **Merck/rtdpy** | MIT | RTD 모델링 — N-CSTR, 축분산, PFR, 실측 트레이서 피팅 |
| **OpenFOAM 14** | GPL-3.0 | ★ **러시톤 교반조 공식 튜토리얼이 동력수를 출력** (아래 참조) |
| **Lethe** | Apache-2.0 | ★ **2중 헬리컬리본 Np–Re 예제, Re 0.1~100** — 우리 점도 영역 그대로 |

- **없는 것 확실히**: `pychemengg`·`neqsim`·DWSIM·IDAES 에는 교반 동력 계산이 **없습니다**.
  BioSTEAM 은 `0.985 kW/m³` 같은 휴리스틱뿐이라 CAPEX용이고 수력 설계엔 못 씁니다.
- **임펠러 파라메트릭 CAD 생성기는 오픈소스에 존재하지 않습니다** (헬리컬리본·앵커 0건).
  전부 고정 STEP/STL 파일입니다. → `build123d`(Apache-2.0)로 직접 만드는 것이 답입니다.
- ⚠ **라이선스 없는 저장소 = 전권 유보(ARR)**: `chaos-polymtl/mixing-ann`(Np 10만점 DB +
  학습모델이 실제로 들어있지만 LICENSE 파일 없음, 논문은 **CC-BY-NC**), `Lethe-tools`,
  `Spogis/Nagata`. **상업적으로 사용 불가**입니다.

### CFD 로드맵 (Windows 워크스테이션 기준)

**★ 핵심 발견 두 가지**

1. **OpenFOAM 14 에 동력수를 출력하는 교반조 튜토리얼이 새로 들어왔습니다.**
   `tutorials/incompressibleFluid/simpleRushtonMRF`(정상상태 MRF),
   `simpleRushtonNCC`(비정상 sliding mesh), `multiphaseEuler/aeratedStirredTankMRF`
   (PBT+러시톤 2단 산업형 통기조). `omega 5 [rpm]` 처럼 **rpm 을 직접 입력**하고,
   `Allrun` 이 끝나면서 `postProcessing/power/` 에서 Np 를 계산해 줍니다.
   메쉬는 파라메트릭(`-s` 68k~4M셀, `-i` 날개 4/6매, `-b` 배플 on/off).

2. **무배플 탱크에서는 SRF(단일 회전좌표계)가 근사가 아니라 정확해(exact)입니다.**
   우리 맥스블렌드 사양은 NON-BAFFLE 이므로, 정지부가 축대칭이어서 계면 보간 오차도
   MRF 존 크기 민감도도 없이 **정상상태로 깨끗한 토크·Np** 를 얻을 수 있습니다.
   배플·내부코일·경사축이 있으면 그때 sliding mesh 로 갑니다.

**⚠ MRF 로 혼합시간을 내면 안 됩니다.** *Meccanica* 2024
([doi:10.1007/s11012-024-01824-z](https://doi.org/10.1007/s11012-024-01824-z))에서
MRF 존 직경을 1.10D~1.93D 로 바꾸자 **Np 12% 이상, TKE 피크 85%** 변했고,
동결유동에서 스칼라 혼합시간이 **3.8초~23.6초(6배)** 로 흩어졌습니다.
혼합시간·데드존은 반드시 비정상 해석에서 뽑아야 합니다.

**⚠ GPU/LBM 은 이번 건에 부적합합니다.** μ=15 Pa·s → Re≈70 은 음속 제약이 있는
명시적 약압축성 LBM 이 절대 끝내지 못하는 영역이고, 암시적 정상상태 압력기반
FVM/FEM 이 몇 시간에 수렴하는 영역입니다. 기존 LBM 교반조 문헌은 전부
Re 12,500~107,000 난류 물입니다. **GPU 보다 CPU 코어(32~64코어)에 투자하십시오.**

**권장 순서**

```
1주차 — 스택 구축 + 알려진 답으로 검증
  ① pip install fluids rtdpy
  ② WSL2 + Ubuntu + apt install openfoam14 (+ Windows 네이티브 ParaView, pip install gmsh)
  ③ simpleRushtonMRF 를 그대로 실행(./Allrun -s 1, 68k셀, 수 분)
     → 출력 Np 가 러시톤 난류 평탄역(≈5~6)에 들어오는지 확인
     이것만으로 반나절에 전 스택이 검증되고 방어 가능한 기준선이 생깁니다.
  ④ ./Allrun -f ../simpleRushtonMRF/4000 로 NCC 비정상 실행 후 비교
     → 우리 자신의 MRF vs sliding mesh 오차를 먼저 정량화

2~3주차 — 실제 물성 투입
  ⑤ nu = mu/rho, momentumTransport 를 laminar + generalisedNewtonian 으로.
     점도모델은 HerschelBulkley(항복응력) 또는 strainRateFunction(레오미터 데이터 직접 투입).
     ★ 난류모델은 삭제할 것 — Re≈70 에서 k-ε 은 없는 점성을 만들어 Np 를 부풀립니다.
  ⑥ 무배플·광폭 → SRF (mixerSRF).  배플·코일·경사축 → NCC 비정상.
  ⑦ Lethe 를 Docker 로 병행 설치해 3d-ribbon-mixer-srf 실행.
     서로 다른 두 코드가 같은 Np 를 내는 것이 고객에게 방어 가능한 근거가 됩니다.
  ⑧ 혼합시간 = scalarTransport, 데드존 = age 함수객체 (둘 다 비정상 해석에서)
```

**Windows 설치**: WSL2 + `apt install openfoam14` (공식). ParaView 는 Windows
네이티브를 쓰고 `\\wsl$\Ubuntu\...` 로 케이스를 읽는 것이 가장 깔끔합니다.
⚠ **blueCFD-Core 는 이번엔 쓰지 마십시오** — 최신 릴리스가 OpenFOAM 12 기반이라
정작 필요한 교반조 튜토리얼이 없습니다.

### Metzner-Otto ks 는 직접 측정하는 것이 답입니다

문헌이 서로 모순됩니다. ks 가 유동지수 n 에 따라 증가한다(Calderbank 1961,
Tanguy 1996) / 감소한다(Rieger & Novák 1974) / 무관하다(Shekhar & Jayanti 2003) /
강하게 의존한다(Jain & Misumi 2024)로 갈립니다. 항복응력 슬러리에서는
통상값 ks=11 이 크게 어긋나 ks≈100 이 맞았다는 보고도 있습니다.

**Metzner–Otto 원법(1957)으로 직접 측정하십시오.** 뉴턴 기준액(글리세린/물엿)으로
Np–Re 곡선을 잡고, 실제 수지로 다시 측정해 두 곡선을 겹치면 됩니다.
69년 된 공개 방법이라 법적 제약이 없고, 토크 트랜스듀서만 있으면 며칠 작업으로
**우리 임펠러·우리 수지 고유의 ks** 를 얻어 법적·기술적 불확실성을 동시에 없앱니다.

---

## 5. 세종플랫폼 탑재

기술부 도구로 이미 연동되어 있습니다.

```
modules/agitator/agitator.html   모듈 본체 (엔진은 아래 원본을 직접 참조)
tools/agitcalc/web/agitcalc-core.js   ← 엔진 원본, 한 벌만 존재
```

모듈 HTML 은 `<script src="../../tools/agitcalc/web/agitcalc-core.js">` 로
원본을 직접 읽습니다. **모듈 폴더에 복사본을 두지 않습니다** — 복사본이 있으면
파이썬 엔진을 고친 뒤 동기화를 잊는 순간 화면과 계산서가 갈립니다.

`index.html` 5곳 수정: `TOOLS` 등록 · `DEPTS.design.tools` · `AGITATOR_BUILD`
상수 · `iframeViewKey()` · `render()` iframe 분기.
Firestore 컬렉션은 `t_agitatorDesigns` (신규 컬렉션 `t_` 접두사 규칙 준수 →
`firestore.rules` 수정 불필요).

**엔진을 수정하면 반드시:**
```bash
python tests/run_tests.py
python tests/gen_test_vectors.py && node web/test_core.mjs
```
복사 단계는 없습니다. 모듈 HTML 을 고친 경우에만 저장소 루트 `index.html` 의
`AGITATOR_BUILD` 번호를 올리십시오 (캐시 문제 방지).

모듈 탭 구성: **선정 계산**(입력 → KPI·단면도·성능·형상·축·검토) ·
**계산서**(HTML 표, 인쇄/PDF·Excel·복사) · **협력업체 검토서 대조**(벤더 인쇄값
입력 → 항목별 차이 판정) · **저장 목록**(Firestore) · **계산식 근거**.

## 검증 현황

- `tests/run_tests.py` — 손계산 대조 **50항목 전부 PASS**.
  기대값은 코드 수식에서 독립적으로 손계산한 값입니다(구현이 자기 자신을 검증하지 않도록).
- `web/test_core.mjs` — 파이썬↔JS **215 벡터 · 708 비교, 상대오차 1e-9 이내 전부 통과**.
- `verification/dk_kemtec_audit.py` — 실제 협력업체 검토서 8건 역산 감사.

## 범위 제한 (현재 미포함)

- **Kamei–Hiraoka 동력식 미구현** (v0.2 예정) — 현재 2점근 모델은 천이역 10~30% 편차
- 다단 임펠러 간섭계수가 선형 근사 (정밀도 낮음)
- 임펠러 질량 추정식이 경험식 (`55·D^2.6`) — 위험속도 1차 스크리닝용
- 수력 불균형계수 f_imb (0.25/0.50) 는 관행값 — 실측 캘리브레이션 권장
- 가스분산 시 동력 저하(gassed power) 미포함
- 씰·베어링·감속기 선정, 노즐 하중 검토(→ `pvcalc` 연계), GA 도면 생성 미포함
- 비뉴턴 계산은 Metzner-Otto 겉보기점도 방식만 (항복응력은 캐번 판정으로 별도)

## 참고문헌

- [HIM] Paul, Atiemo-Obeng & Kresta, *Handbook of Industrial Mixing*, Wiley 2004
- [NAG] Nagata S., *Mixing: Principles and Applications*, Kodansha 1975
- [BAT] Bates, Fondy & Corpstein, *I&EC Proc. Des. Dev.* 2(4) 1963
- [PER] *Perry's Chemical Engineers' Handbook*, 8th ed., Sec.18
- [ZWI] Zwietering T.N., *Chem. Eng. Sci.* 8 (1958) 244
- [B106] ASME B106.1M — Design of Transmission Shafting
- ★ Furukawa et al., *Int. J. Chem. Eng.* 2012, 106496 (**CC-BY**) — Kamei–Hiraoka
- Elson, Cheesman & Nienow (1986) — 항복응력 캐번 모델
- Ayranci & Kresta, *CERD* 2014 — Zwietering 적용한계
- Reid et al., *Meccanica* 2024 — MRF 존 크기 민감도

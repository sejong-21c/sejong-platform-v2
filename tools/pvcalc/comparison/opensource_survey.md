# 오픈소스 조사 — 압력용기·탱크·열교환기 강도계산 (2026-08-05)

GitHub API 저장소 검색 + 웹 검색으로 조사. 조사 범위: ASME, API 650/620,
한국에너지공단, 산업안전(KOSHA), 가스안전공사(KGS), 위험물안전관리법.

## 결론 세 줄

1. **국내 인허가 기준(에너지공단·KOSHA·KGS·위험물법)의 계산 코드는 오픈소스에 없습니다.** 0건.
2 **ASME 는 몇 건 있으나 전부 부분 구현이고, 재료 데이터를 포함한 것은 저작권 문제가 있습니다.**
3. **API 650/620 저장탱크도 쓸 만한 것이 없습니다** (별 0개 개인 저장소뿐).

---

## 1. ASME VIII 관련

| 저장소 | ★ | 라이선스 | 최근 | 평가 |
|---|--:|---|---|---|
| [thepvguy/calctoys](https://github.com/thepvguy/calctoys) | 13 | **Unlicense** (퍼블릭 도메인) | 2023-02 | 커버리지 넓음(Div1/Div2, App.2/13/24/Y, UHX 튜브시트, 새들). **노즐보강·Div1 경판 없음.** 방치 |
| [ry4ngch/ASME-PVDE](https://github.com/ry4ngch/ASME-PVDE) | 7 | GPL-3.0 | 2026-02 | Excel VBA+Power Query. 동체·경판·노즐보강·플랜지·튜브접합·평판 커버. **⚠ 아래 저작권 경고** |
| [ahmed-hesham07/Vessel-Guard](https://github.com/ahmed-hesham07/Vessel-Guard) | 4 | MIT | 2025-08 | 배관+용기 ASME 계산 웹앱. 얕음 |
| [cmbjorn/SepScope](https://github.com/cmbjorn/SepScope) | 0 | MIT | 2026-07 | ASME VIII / EN 13445 노즐 배치·경판·보강 스크리너. 신규 |
| [dariomangoni/PressureVesselsCalc](https://github.com/dariomangoni/PressureVesselsCalc) | 1 | **없음(ARR)** | 2025-07 | ASME VIII + EN 13445. 라이선스 없어 사용 불가 |
| [nathanrboyer/Div3.jl](https://github.com/nathanrboyer/Div3.jl) | 1 | **없음(ARR)** | 2026-07 | Div 3(고압) Julia. 우리 범위 아님 |
| [CharlesCNorton/bpvc-verified](https://github.com/CharlesCNorton/bpvc-verified) | 0 | 없음 | 2026-01 | ASME 설계식 형식검증 시도. 학술적 흥미 |

### ⚠ ASME-PVDE 저작권 경고 (중요)

이 저장소는 **ASME Sec II Part A/B/D 재료 3,000종 이상(2019~2023 판)과 외압
차트를 포함**한다고 명시합니다. B16.5 플랜지, B16.20 개스킷, B18 볼트 표도
들어 있습니다.

**GPL-3.0 로 공개돼 있어도 ASME 표를 재배포할 권리는 저장소 작성자에게
없습니다.** 우리는 ASME 인증 업체이므로 이 데이터를 쓰는 것은 라이선스
위반 위험이 인증 관계로 번질 수 있는 쪽입니다. **계산 로직 참고는 가능하나
재료·차트 데이터는 쓰지 마십시오.** (같은 이유로
[junteakim/asme-database-extractor](https://github.com/junteakim/asme-database-extractor)
— Sec II-D 표·차트 자동 추출 도구 — 도 권하지 않습니다.)

우리 방식(사용자가 licensed 사본에서 직접 입력 + 판 표기 강제)이 이 문제를
피하는 유일한 방법입니다.

## 2. API 650 / 620 저장탱크

**쓸 만한 오픈소스 없음.** 검색 결과 전부 별 0개 개인 저장소이고 라이선스가
없습니다.

- [Anuranjan26mumbai/API-650](https://github.com/Anuranjan26mumbai/API-650) — 0★, 라이선스 없음
- [tbang123/api650-tank-designer](https://github.com/tbang123/api650-tank-designer) — 0★, 라이선스 없음
- API 620 은 검색 결과 0건

상용/웹 계산기(midstreamcalculator 등)와 엑셀 시트는 돌아다니지만 검증 이력이
없고 저작권 표기도 불분명합니다. **1-Foot Method 는 식 자체가 단순하므로
(t = 4.9·D·(H−0.3)·G/(S·E) + CA) 원문 확보 후 직접 구현하는 것이 빠릅니다.**
어려운 부분은 Variable-Design-Point Method 와 부속서(지진 App.E, 부상지붕)입니다.

## 3. 국내 인허가 기준 — 계산 코드는 0건

### 한국에너지공단 (열사용기자재)

**중요 정정**: KS B 6750 계열이 아니라 **공단 자체 규격체계 KEA CODE**(구
KEMCO CODE)입니다. Section I~X 구성:

| Section | 약어 | 대상 |
|---|---|---|
| I / II / III | KBM / KBI / KBO | 보일러 제조 / 설치 / 사용 |
| **IV / V / VI** | **KPM / KPI / KPO** | **압력용기 제조 / 설치 / 사용** |
| VII | KBE | 보일러 효율향상 |
| VIII | KRM | 보수유지관리 |
| IX | KSC | 스탬프인증 |
| X | KSB | 소형보일러 |

압력용기 설계·제조는 **Section IV (KPM)**, 조항 번호는 KPM-0000~9000 체계.
[규격 안내 페이지](https://www.energy.or.kr/front/conts/105002001008020.do) ·
[KEA CODE 개요](https://www.energy.or.kr/front/conts/105002001008018.do) ·
문의 052-920-0525(글로벌안전검사기술처).

**오픈소스 구현 0건.** 규격 전문 확보가 선행 조건입니다.

### 산업안전 (KOSHA / 고용노동부)

**계산 오픈소스 0건.** 관련해서 찾은 유일한 것:

- [zxc8661/safety-health-chemical-mcp](https://github.com/zxc8661/safety-health-chemical-mcp)
  — 산업안전보건 법령·KOSHA GUIDE·MSDS **조회** MCP 서버. 0★, 커밋 3개,
  라이선스 미지정("공개 배포 전 확정하세요"라고 적혀 있음). 계산 기능 없음.
  법령 조회용으로는 참고 가치가 있으나 라이선스가 정해지기 전엔 쓸 수 없습니다.

### 가스안전공사 (KGS)

**계산 오픈소스 0건.** 다만 두 가지 확인:

1. **KGS Code 전문은 무료 열람 가능** —
   [cyber.kgs.or.kr 코드 검색](https://cyber.kgs.or.kr/kgscode.codeSearch.listV2.ex.do)
   및 [공공데이터포털](https://www.data.go.kr/data/15007434/fileData.do)(PDF, 175건).
   ⚠ **공공데이터 라이선스가 KOGL 제4유형(출처표시·상업적이용금지·변경금지)**
   입니다. 데이터셋 자체를 사내 도구에 넣어 배포하는 것은 안 됩니다.
   기준을 읽고 계산식을 구현하는 것(코드 준수 목적)은 별개이며, ASME 와 같은
   방식으로 접근해야 합니다.
2. **가스안전공사가 SMS-C 프로그램 5종을 자체 개발해 "오픈소스로 배포 예정"**
   이라고 발표했습니다 (연소열량·처리능력·냉동능력·저장능력·집합방류둑 용량).
   ⚠ **전부 공정·용량 계산이며 강도(두께) 계산은 아닙니다.** 인허가 서류
   작성에는 유용할 수 있으니 배포 여부를 공사에 확인해 볼 가치는 있습니다.
   ([기사](http://www.kmecnews.co.kr/news/articleView.html?idxno=31064))

### 위험물안전관리법 (옥외탱크저장소)

**오픈소스 0건.** 법령 자체는 국가법령정보센터에서 무료 열람 가능하며,
시행규칙 별표 6 과 세부기준에 두께·수압시험 요건이 직접 규정돼 있습니다.

## 4. 열교환기 (튜브시트)

- **UHX 오픈소스 구현 사실상 없음.** `calctoys` 에 `src/Tubesheet/UHX/`
  (UHX-8/11/12/13, Table 13.1/13.2)가 있는 것이 유일하게 의미 있는 자산입니다
  — Unlicense 라 법적 제약이 없습니다. **우리가 UHX 를 구현할 때 1차 참고
  대상입니다.**
- TEMA 기계표준 구현은 0건 (TEMA 자체가 유료 저작물).
- 별도로 `src/Tubesheet/TEMA/Calculations/RGP.py` 도 calctoys 에 있습니다.

## 5. 부수적으로 쓸 만한 것

| 저장소 | 라이선스 | 용도 |
|---|---|---|
| [CalebBell/fluids](https://github.com/CalebBell/fluids) | MIT | 탱크 형상·부피(경판 포함), 유체 물성. 강도계산은 없음 |
| [varma666/ProcessPi](https://github.com/varma666/ProcessPi) | MIT | 화공 장치 사이징·단위환산 |
| FreeCAD + CalculiX / Code_Aster | LGPL / GPL | FEA (Div.2 Part 5 해석기반 설계). 원자력은 Code_Aster 가 QA 이력 우위 |

## 6. 그래서 우리 전략

1. **ASME** — 이미 자작(pvcalc)이 가장 완성도 높습니다. 손계산 129건 + 엔진
   대조 199벡터로 검증된 것은 위 어느 저장소에도 없습니다. 미구현 항목
   (UHX 튜브시트)은 **calctoys(Unlicense)를 참고**해 구현.
2. **API 650** — 원문 확보 후 직접 구현. 1-Foot Method 부터. 참고할 오픈소스 없음.
3. **국내 기준 3종** — 오픈소스가 없으므로 **원문 확보가 유일한 경로**입니다.
   - 에너지공단 KEA CODE Section IV(KPM): 공단에 구입·열람 문의
   - KGS: 코드 번호 확정 후 cyber.kgs.or.kr 에서 열람 (무료)
   - KOSHA: 안전인증·안전검사 고시 (법령이라 무료 열람)
   - 위험물법: 국가법령정보센터 (무료)
4. **재료 데이터는 계속 사용자 입력 방식 유지.** ASME-PVDE 류의 내장 DB 는
   저작권 위험이 있어 쓰지 않습니다.

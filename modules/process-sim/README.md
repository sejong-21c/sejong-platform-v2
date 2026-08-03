# 공정 시뮬레이터 모듈

기술부 도구함의 **공정 시뮬레이터** 화면입니다. 오픈소스 공정 시뮬레이터 **DWSIM**을
클릭으로 조작하는 대신, 템플릿을 고르고 조건만 넣으면 결과표가 나오게 만든 계층입니다.

```
이 화면 (process-sim.html)          DWSIM API 서버 (사내)
  템플릿 선택 → 폼 입력      ──JSON──▶  DWSIM.Apps.SimpleAPI.exe
  결과표 · 조성표 · CSV      ◀────────  DWSIM 계산 엔진
```

**계산 엔진은 이 저장소에 없습니다.** 별도 저장소입니다:
👉 **https://github.com/sejong-21c/dwsim-simple-api** (빌드·배포 방법은 그쪽 `CLAUDE.md`)

이 화면만 배포하면 UI는 뜨지만 계산은 안 됩니다.

---

## 서버 주소 설정

화면 우측 상단 **⚙ 서버** → 주소 입력 → 저장. `localStorage`에 남으므로 1회만 하면 됩니다.

전 직원에게 기본값으로 적용하려면 `process-sim.html`의 이 줄을 고칩니다:

```js
let API = localStorage.getItem(LS_KEY) || "http://localhost:8080";
```

⚠️ **`sejong21c.com`은 HTTPS입니다.** HTTPS 페이지에서 `http://` 주소는 브라우저가
혼합 콘텐츠로 차단하므로, 서버도 HTTPS로 노출해야 합니다 (Cloudflare Tunnel 권장 —
`dwsim-simple-api/README.md` 4-1항).

서버 실행 시 Origin을 허용해 두어야 CORS가 통과합니다:

```bat
DWSIM.Apps.SimpleAPI.exe --origins https://sejong21c.com,https://www.sejong21c.com
```

## 서버 없이 화면 확인

**⚙ 서버 → [데모 모드로 보기]** — 가짜 값으로 화면 구성만 확인합니다.
결과에 "가짜 값" 경고가 항상 표시되므로 실제 결과와 혼동되지 않습니다.

## 수정할 때

**빌드 번호를 올리세요.** 안 올리면 브라우저·CDN이 예전 파일을 계속 보여줍니다
(다른 모듈과 동일한 관례).

```js
// index.html
const PROCSIM_BUILD = 'a1';   // ← 값을 올릴 것
```

**로직을 고쳤으면 테스트를 돌리세요.** 33개 테스트(템플릿 12종 YAML 왕복,
YAML 파서 엣지케이스, mode별 필드 정리)가 통과해야 합니다.

```bash
node tools/test-webui.js <경로>/modules/process-sim/process-sim.html
# tools/ 는 dwsim-simple-api 저장소에 있습니다
```

**템플릿을 추가할 때는 세 곳을 같은 이름으로 맞춥니다** (앞의 둘은 서버 저장소):

1. `Builder.cs` — `Templates` 배열 + `BuildXxx` 메서드
2. `SPEC.md` — 파라미터 문서
3. `process-sim.html` — `TEMPLATES` 배열 ← 여기에 넣으면 웹 폼이 자동 생성됩니다

## index.html 연결 지점 (5곳)

| 위치 | 내용 |
|---|---|
| `TOOLS` | `'procsim'` 항목 |
| `DEPTS` | 기술부(`design`) `tools` 배열 |
| `PROCSIM_BUILD` | 캐시 무효화 번호 |
| `render()` | `selectedTool === 'procsim'` iframe 분기 |
| `iframeViewKey()` | `'procsim'` 가드 — **없으면 Firestore `onSnapshot`마다 iframe이 재로드됩니다** (NCR/CAR에서 겪은 문제) |

## 라이선스

DWSIM은 **GPL v3**입니다. 이 화면은 HTTP/JSON으로만 엔진과 통신하는 별개 프로그램이라
플랫폼은 GPL 영향을 받지 않습니다.

> **DWSIM DLL을 플랫폼 코드에 직접 링크하면 플랫폼 전체가 GPL 대상이 됩니다.**
> 이 프로세스 분리 경계를 유지하세요.

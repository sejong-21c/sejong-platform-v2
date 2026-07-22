# AI 게이트웨이 설치 가이드 (Cloudflare Worker)

직원들이 각자 API 키를 입력할 필요 없이, **회사 공용 키 하나로 전 직원이 AI 비서를 쓰게** 해주는 중간 서버입니다.
브라우저에서 직접 못 부르는 NVIDIA 무료 API도 이 서버를 거치면 사용할 수 있습니다.

비용: **무료** (Cloudflare 무료 플랜 = 하루 10만 요청, 우리 사용량이면 충분)

---

## 1단계. 워커 만들기 (5분)

1. [dash.cloudflare.com](https://dash.cloudflare.com) 로그인
2. 왼쪽 메뉴 **Workers & Pages** 클릭 → **Create**(만들기) 버튼
3. **"Start with Hello World!"** 선택 → 이름을 `sejong-ai-gateway` 로 입력 → **Deploy**
4. 배포되면 **Edit code**(코드 편집) 버튼 클릭
5. 편집기에 있는 기존 코드를 전부 지우고, 이 폴더의 **`cloudflare-worker.js` 내용을 통째로 복사해서 붙여넣기**
6. 오른쪽 위 **Deploy** 클릭

배포가 끝나면 워커 주소가 생깁니다. 예:
```
https://sejong-ai-gateway.<계정이름>.workers.dev
```
이 주소를 복사해 두세요. (워커 첫 화면의 "Visit" 옆에 표시됨)

## 2단계. API 키 등록 (5분)

1. 워커 화면에서 **Settings** 탭 → **Variables and Secrets**
2. **Add** 버튼으로 아래 변수들을 추가 — Type은 **Secret** 선택:

| 변수 이름 | 값 | 비고 |
|---|---|---|
| `GEMINI_KEYS` | `키1,키2,키3` | 쉼표로 구분해서 전부 |
| `GROQ_KEYS` | `gsk_...,gsk_...,gsk_...` | |
| `CEREBRAS_KEYS` | `csk-...,csk-...` | |
| `OPENROUTER_KEYS` | `sk-or-...,sk-or-...,sk-or-...` | |
| `NVIDIA_KEYS` | `nvapi-...` | [build.nvidia.com](https://build.nvidia.com)에서 무료 발급 |
| `MISTRAL_KEYS` | (있으면) | 선택 |
| `NINEROUTER_KEYS` | `9router_...` | 9Router Proxy API Combo Key (쉼표 구분) |

3. **일반 변수(Text)** 로 하나 더 추가:

| 변수 이름 | 값 |
|---|---|
| `ALLOWED_ORIGINS` | `https://sejong21c.com,https://www.sejong21c.com` |
| `NINEROUTER_BASE` | `https://<9router-공용주소>/v1` | 9Router Proxy 엔드포인트 URL (필수, localhost는 Worker에서 접근 불가) |`r`n| `NINEROUTER_MODEL` | `cc/claude-opus-4-7` 또는 Combo 이름 | 9Router에서 만든 combo/모델 이름 (필수) |`r`n| `FIREBASE_PROJECT_ID` | `sejong-platform` | 9Router 공용 키를 회사 로그인 사용자에게만 열기 위한 검증용 |

   → 우리 플랫폼에서 온 요청만 받겠다는 뜻. **이거 꼭 설정하세요** (안 하면 아무 사이트나 우리 키를 쓸 수 있음).

4. 저장하면 자동 적용됩니다.

⚠️ **유료 키(Claude, `CLAUDE_KEYS`)는 아직 넣지 마세요.** 무료 키는 뚫려도 한도만 소진되지만, 유료 키는 돈이 나갑니다. 로그인 검증(다음 단계 예정)을 붙인 뒤에 넣는 걸 권장합니다.

## 3단계. 플랫폼에 연결 (1분)

1. 세종플랫폼 → 🤖 AI 비서 → 🔑 버튼
2. 맨 위 **"회사 게이트웨이 주소"** 칸에 1단계에서 복사한 워커 주소 붙여넣기 → 저장
3. 질문해 보세요. 답변 밑에 `— Gemini · 회사공용` 처럼 나오면 성공!

**전 직원 자동 적용**: 워커 주소를 개발 담당(Claude 세션)에게 알려주면 플랫폼 소스에 기본값으로 넣어서,
직원들이 아무 설정 안 해도 바로 동작하게 만들 수 있습니다.

---

## 문제 해결

- **"OO keys not configured on gateway"** — 2단계에서 해당 회사 키를 안 넣은 것. 넣거나 무시(자동으로 다음 회사로 넘어감)
- **403 origin not allowed** — `ALLOWED_ORIGINS`에 플랫폼 주소가 빠짐. 오타 확인 (끝에 `/` 붙이면 안 됨)
- **작동하다 갑자기 안 됨** — 무료 한도 소진 가능성. 키를 더 발급받아 쉼표로 추가

## 구조

```
직원 브라우저 (키 없음)
   │  POST /v1/gemini/... 등
   ▼
Cloudflare Worker (회사 키 보관 + 키 자동 교대)
   │
   ▼
Gemini / Groq / Cerebras / NVIDIA / OpenRouter / Mistral
```

### 9Router 공용 연결 주의

9Router의 기본 API 주소는 `http://localhost:20128/v1` 입니다. 이 주소는 9Router를 실행한 PC 내부에서만 접근되므로, 전 직원 공용으로 쓰려면 9Router를 켜 둘 회사 PC/서버를 Cloudflare Tunnel 같은 HTTPS 주소로 노출한 뒤 그 주소를 `NINEROUTER_BASE`에 넣어야 합니다.

플랫폼 브라우저에는 9Router Combo 키가 내려가지 않습니다. 브라우저는 Firebase 로그인 토큰만 Worker에 보내고, Worker가 `@sejong-21c.com` 로그인 계정인지 확인한 뒤 `NINEROUTER_KEYS`를 9Router로 주입합니다.
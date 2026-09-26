# CLAUDE.md — 세종플랫폼 개발 규칙 (Claude Code 공용)

세종기술 전사 통합 플랫폼. 정적 HTML(모놀리식 index.html + modules/ iframe) + Firebase
(Auth·Firestore) + Cloudflare Worker 게이트웨이(gateway/). 어느 컴퓨터에서 작업하든
이 문서의 규칙을 따른다.

## 소통

- 쉬운 한국어로: 결론 먼저, 전문용어 최소화, 근거는 요청 시에만.
- 사용자는 **배포된 회사 사이트에서 테스트**한다 — 커밋·푸시 전 로컬 수정은
  사용자 화면에서 "안 되는" 상태다. 검증 안내 전에 반드시 푸시 완료 + "Ctrl+F5" 안내.

## Git

- main 직접 push 관례 (여러 명 병행). **force push 절대 금지** — 복구는 백업 태그
  (`backup/YYYYMMDD-HHMMSS-SHA`, push마다 자동 생성)에서 파일을 가져와 새 커밋으로.
- 커밋 메시지는 한국어, `feat(ai): ... (v29.xx, 로드맵 N단계)` 스타일.
- RAG 문서고 작업은 `feature/rag-docs` 브랜치에서 → 단계 완성마다 main으로 merge.
- index.html 의 `*_BUILD` 상수 줄은 여럿이 동시에 고친다 — **푸시 직전 `git fetch` 로 다시 받고**, 병합 뒤
  충돌 표시(`<<<<<<<`)가 없는지 본다(2026-09-26 경비 b14·회의 b11 병합에 표시가 남아 긴급 수정 511f68c).

## 버전·캐시버스터 (중요 — 어기면 "배포했는데 안 바뀜" 사고)

- AI 비서(modules/ai-assistant/ai-assistant.js)는 자체 버전 라인 **v29.x** (플랫폼은 v30.x).
  수정 시 **index.html의 `ai-assistant.js?v=` 캐시버스터를 같은 커밋에서 bump**.
- iframe 모듈 수정 시 해당 BUILD 상수 bump (예: 회의 모듈 = index.html `MEETING_BUILD`).
- 모듈을 **새 창(window.open)으로 여는 곳도** 주소에 `v=<BUILD>` 를 붙인다 — 빠지면 그 진입점만 옛 캐시본이 뜬다
  (2026-09-26 결재 "문서 확인" 두 곳이 빠져 있었다).
- 게이트웨이 워커는 gateway/cloudflare-worker.js 헤더의 v3.x 표기.

## 금지·주의 (과거 사고에서 나온 규칙)

- **localStorage를 중복 방지 게이트로 쓰지 않는다** — 마커는 Firestore 문서로
  (2026-07-17 WO 자동등록이 WBS 덮어쓴 사고의 근본 원인).
- **클래식 스크립트 최상위에서 fb 참조 금지** — 부팅 전체 사망 (v29.44 장애).
  fb는 반드시 함수 안에서, 지연 접근으로.
- **WBS 항목 자동 조작 금지** — AI/자동화가 wbsData를 쓰지 않는다.
- firestore.rules 수정 시 **저장소 + Firebase 콘솔 양쪽 동시 갱신** (불일치 = 조용한 쓰기 실패).
- AI 비서의 원칙: **AI는 직접 저장하지 않는다** — 폼 프리필 + 사람 확인,
  예외는 채팅 안 확인 카드(사람이 버튼) 방식만.
- **Firestore 전 컬렉션을 훑는 작업 금지** — 이 프로젝트는 **무료(Spark) 요금제라 하루 문서 읽기 5만 건**이 상한이다.
  넘으면 그날 남은 시간 동안 플랫폼 전체가 429(Quota exceeded)로 **서버 읽기를 못 한다**(캐시 덕에 화면은 늦게 죽는다).
  한도는 태평양 자정(=KST 16~17시)에 풀린다. 2026-09-19 야간 백업을 처음 돌리다 실제로 태웠고,
  그게 매일 아침 9시 크론이었으면 **매일 아침 회사가 멈출 뻔했다.**
  · 첨부는 `chunk__*`·`dwg_*` 문서로 DB 안에 쪼개져 있다(개당 최대 700KB, 수만 건) — 훑기의 주범.
  · 대량 조회는 **컬렉션당 쪽수 상한**을 두고(파이스 `platform_sync.js` 의 PAGE_SIZE 300·MAX_PAGES 30 방식),
    돌리기 전에 문서 수를 먼저 센다. 배치 작업은 파이스(맥미니)에서 — 워커는 한 번 실행에 하위요청 1,000개 제한도 있다.
- **Firestore 는 반드시 영속 캐시로 연다** — `getFirestore(fbApp)` 금지, `initializeFirestore(fbApp,
  { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` 로.
  없으면 재접속마다 서버에서 다 다시 읽어(메신저만 약 600건) 위의 하루 5만을 태운다. 화면은 멀쩡해서 안 보인다.
  **플랫폼 안 iframe 모듈은 부모(index.html)의 `fb.db` 를 쓴다** — 자기 파일만 고치면 소용없다.
  `node test/pwa-w1.test.mjs` 가 index.html·messenger.js 양쪽을 검사한다(2026-09-19, b41).
- **돈이 나갈 수 있는 곳을 알고 있을 것** (2026-09-19 확인):
  파이어베이스=무료라 청구 불가(대신 한도에 걸림) · 클라우드플레어 Workers=무료 · **R2=유료 구독**(10GB·100만 작업까지 무료) ·
  Vectorize 색인은 무료로 1024차원 기준 약 4,880조각까지(그 이상은 Workers Paid $5/월 필요).
- **모델 호출은 전부 게이트웨이로** — 장부(aiUsageDaily)·하루 한도가 거기서만 선다. 브라우저가 공급사
  (api.anthropic.com 등)를 직접 부르는 코드를 새로 만들지 않는다(2026-09-26 경비 b10·ITP c50 에서 걷어냄).
  유일한 예외: 옛 AI 비서의 개인 키 — **게이트웨이에 접속 자체가 안 되는 PC**(workers.dev 차단)에서만
  (부장님 결정 9/26, ai-assistant.js v29.83). 게이트웨이가 429·501 을 줬다고 개인 키로 비껴가면 안 된다.
- 게이트웨이 Claude(/v1/claude/messages)는 Worker Secret **`CLAUDE_KEYS`** 가 있어야 돈다 — 없으면 501.
  ITP 자동 분석(c50)·옛 AI 비서 Claude 칸이 쓴다. gateway/README 의 "유료 키 넣지 말라"는 로그인 검증(v3.4)
  전 경고다. 게이트웨이의 개인 AI 열쇠(/key/set)는 **하루 한도를 넘긴 뒤에만** 쓰인다.
- 게이트웨이 9Router 칸(/v1/9router — 지금은 맥미니 omniroute)은 **워커 설정만** 믿는다: NINEROUTER_BASE(바깥 주소
  https://router.sejong21c.com/v1)·NINEROUTER_KEYS (worker v5.6). 라우터 주소·키를 Firestore 에 두고 게이트웨이나
  브라우저가 따르게 하지 않는다 — 9/26 t_aiSharedConfig 가 사내 계정 누구나 고칠 수 있어 주소 하나로 전 직원 질문을
  빼돌릴 수 있었다(규칙 관리자 전용·게이트웨이 v5.6·AI 비서 v29.84 로 닫음).
- Claude Sonnet 5 는 생각(thinking)이 기본으로 켜진다 — 생각 토큰도 max_tokens 에 들어가고(ITP 는 16000),
  도구 호출 대화를 생각 블록 없이 다시 조립하는 곳(ai-assistant.js claudeMessagesFromHistory)은
  `thinking: {type:'disabled'}` 필수(켜 두면 도구 결과를 돌려보낼 때 400).

## 검증

- 코드 수정 후: `node --check` → 로컬 프리뷰(.claude/launch.json의 'static',
  localhost:8931)에서 부팅·콘솔 오류 확인 → 가능한 만큼 기능 시뮬레이션 →
  푸시 후 사용자 실질문 확인까지가 "완료".
- 게이트웨이 워커 수정 시: `node gateway/worker-test.mjs` (27개 시나리오) 통과 필수.
- 메신저(modules/messenger) 수정 시 네 가지: `node test/pwa-w1.test.mjs`(불변식) · `node test/messenger-lib.test.mjs`(순수 함수)
  · `node test/messenger-ui-check.mjs`(가짜 Firestore 시험대 + 헤드리스 크롬 66개 시나리오, 375·1280 스크린샷 → test/shots/)
  · `node test/pwa-live-check.mjs`(서비스워커·매니페스트·오프라인). 배포본 확인은 둘 다 `BASE=https://sejong21c.com`.
  **messenger.html/.css/.js/lib.js 를 고쳤으면** index.html `MESSENGER_BUILD` 와 messenger.html 의 `?v=`(css·js 둘) 과 `sw.js` 의 `버전` 을 함께 올린다
  — 어긋나면 새 HTML 이 옛 JS 를 10분 캐시로 받는다(불변식이 잡는다).
- QA Doc Gen / ITP Builder 순수 계산·태그·TSV 함수(공차·normTag·parseClipboardTSV 등) 수정 시:
  `node test/tool-calc.test.mjs` 통과 필수. HTML 인라인본과 `modules/shared/tool-calc.mjs`를 함께 갱신.
- 워커 배포: `cd gateway && npx wrangler deploy` (wrangler.toml에 바인딩·크론 정의,
  keep_vars=true 유지 — 지우면 대시보드 변수 날아감).

## 지도

- AI 비서 로드맵·진행 현황: modules/ai-assistant/ROADMAP.md (1~3기 완료 기록)
- RAG 문서고 로드맵: modules/ai-assistant/RAG-ROADMAP.md (feature/rag-docs)
- 게이트웨이 설치·운영: gateway/README.md
- 전면 점검 보고·수정 계획: PLATFORM-CHECKUP.md (2026-07-30 — 성능·버그 A/B/C 묶음)
- 구축 이력·참여자·기술결정·사고기록: PROJECT-HISTORY.md (2026-05 전사 ~ 07-31 · 512커밋)
- **로드맵·진척 체크: roadmap.html** (플랫폼 메뉴 `로드맵·진척`, 상태는 t_roadmapState에 저장 —
  누가 어느 기기에서 체크해도 전원 공유. 항목 추가·수정은 roadmap.html의 ROADMAP 배열을 고쳐 배포)
- AI 비서 실구현은 modules/ai-assistant/ai-assistant.js — index.html 쪽 동명 함수는 스텁.
  이 옛 패널은 주소에 `?aipop=1` 을 붙여야만 뜬다. 🤖 버튼은 메신저 "AI 비서" 방(modules/messenger/ai.js).
- t_ncrs/t_cars/t_itpBuilderDocs에는 첨부 조각 문서(chunk__*, dwg_*)가 섞여 있다 —
  조회·백업 시 반드시 걸러낼 것 (base64 수백 KB, 토큰·용량 폭탄).

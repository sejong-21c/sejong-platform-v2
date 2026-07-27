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

## 버전·캐시버스터 (중요 — 어기면 "배포했는데 안 바뀜" 사고)

- AI 비서(modules/ai-assistant/ai-assistant.js)는 자체 버전 라인 **v29.x** (플랫폼은 v30.x).
  수정 시 **index.html의 `ai-assistant.js?v=` 캐시버스터를 같은 커밋에서 bump**.
- iframe 모듈 수정 시 해당 BUILD 상수 bump (예: 회의 모듈 = index.html `MEETING_BUILD`).
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

## 검증

- 코드 수정 후: `node --check` → 로컬 프리뷰(.claude/launch.json의 'static',
  localhost:8931)에서 부팅·콘솔 오류 확인 → 가능한 만큼 기능 시뮬레이션 →
  푸시 후 사용자 실질문 확인까지가 "완료".
- 게이트웨이 워커 수정 시: `node gateway/worker-test.mjs` (27개 시나리오) 통과 필수.
- 워커 배포: `cd gateway && npx wrangler deploy` (wrangler.toml에 바인딩·크론 정의,
  keep_vars=true 유지 — 지우면 대시보드 변수 날아감).

## 지도

- AI 비서 로드맵·진행 현황: modules/ai-assistant/ROADMAP.md (1~3기 완료 기록)
- RAG 문서고 로드맵: modules/ai-assistant/RAG-ROADMAP.md (feature/rag-docs)
- 게이트웨이 설치·운영: gateway/README.md
- AI 비서 실구현은 modules/ai-assistant/ai-assistant.js — index.html 쪽 동명 함수는 스텁.
- t_ncrs/t_cars/t_itpBuilderDocs에는 첨부 조각 문서(chunk__*, dwg_*)가 섞여 있다 —
  조회·백업 시 반드시 걸러낼 것 (base64 수백 KB, 토큰·용량 폭탄).

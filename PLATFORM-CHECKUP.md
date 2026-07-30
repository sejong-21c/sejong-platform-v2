# 플랫폼 전면 점검 보고 & 수정 계획 (2026-07-30)

계기: 콘솔 에러 다수 + 로그인 느림 + ITP/QA 조회 느림.
방법: 4개 영역 병렬 정밀 조사(부팅 성능 / 뷰어 성능 / 콘솔 에러 / 버그 사냥) — 모든 발견은 파일:줄 근거 포함.

## 진행 현황

| 묶음 | 내용 | 상태 |
|---|---|---|
| A | 즉시 수정 17건 (A1~A17) | ✅ 2026-07-30 완료 — 워커 v3.2.4 배포 + 클라이언트 v29.64/v30.12 |
| B | 1세션급 5건 (B1~B5) | ✅ 2026-07-30 완료 — v29.65 / v30.13 (검증 통과)
| C | 구조 공사 3건 (승인 후 별도 단계) | ⬜ 승인 대기
| D | 무해 판정 3건 (조치 안 함) | ✅ 판정 완료 |

---

## A. 즉시 수정 (quick — 오늘 배포)

| # | 항목 | 파일 | 내용 |
|---|---|---|---|
| A1 | 죽은 9Router 터널 빠른 스킵 | ai-assistant.js | 터널 실패 시 **5분 쿨다운**(메모리 변수 — localStorage 게이트 금지 준수) + 프로브 짧은 타임아웃. 현재 최악 165초/질문 → 수 초 |
| A2 | QA 불러오기 청크 다운로드 | qa-doc-generator.html:2313 | f038168 성능 커밋 누락 지점 — 범위 쿼리(p~q) 적용. 사진 청크(700KB×N) 수신 후 폐기하던 것 제거 |
| A3 | ITP/QA 조회 영속 캐시 | itp-viewer.html:25, qa-viewer.html:28 | getFirestore → initializeFirestore + persistentLocalCache(multi-tab). 재방문 시 변경분만 수신 |
| A4 | 채널 시드 가드 | index.html:5311 | ensureProjectChannel에 '이미 있으면 스킵' 가드 — 로그인마다 프로젝트 수만큼 나가던 무조건 쓰기 제거 |
| A5 | 부팅 render 폭풍 디바운스 | index.html | 스냅샷 콜백 10곳의 render() → scheduleRender()(rAF 병합). 부팅 중 전체 리렌더 10여 회 → 1~2회 |
| A6 | favicon 404 | index.html head | data URI 아이콘 한 줄 추가 (파일·추가 요청 없음) |
| A7 | Gemini 400 오분류 | ai-assistant.js:1491, worker | 'API key not valid' 400은 모델 문제가 아니라 키 문제로 분류 → 다음 키/소스로 교대. 모델 목록에서 은퇴 모델(gemini-2.5-flash 404) 정리 |

## B. 1세션급 (효과 큼, 다음 세션)

| # | 항목 | 내용 |
|---|---|---|
| B1 | ✅ localStorage 대형 캐시 제외 + 쓰기 합치기 | `CACHE_SKIP_KEYS`(wbs·items·wbsRec·messages·mobileInspectionDrafts)는 로그인 시 Firestore가 항상 새로 채우므로 저장하지 않음. 쓰기는 150ms 합치기 + 탭 숨김 시 확정. 예전 대형 캐시는 부팅 시 1회 청소. **검증: 저장요청 6회→실제 쓰기 1회, 265KB→1KB, iframe 소유키(NCR/CAR) 보존 확인** |
| B2 | ✅ 로그인 첫 화면 체감 | 정적 스피너를 HTML에 직접 배치(SDK 로딩 전에도 보임) + gstatic preconnect/modulepreload 3종 + ai-assistant.js `defer` + 20초 지연 시 새로고침 안내. **검증: defer 후에도 스텁 덮어쓰기 순서 정상** |
| B3 | ✅ itp-viewer 이중 구독 제거 | 라이브 문서 실시간 구독 → 목록 렌더 1.2초 후 1회 조회(자가복구 안전망 유지). 배지는 승인본에 함께 기록되는 `liveStatus`로. 기록 지점 3곳(빌더 pending·즉시승인, decideApproval 승인/반려) |
| B4 | ✅ 배지용 통구독 다이어트 | messages 500→**200**, mobileInspectionDrafts는 부팅 구독 제거 → 모바일 점검 화면 열 때 지연 구독. **pendingUsers는 제외** — `selectableUsers()`(담당자 선택)에서 전 직원이 쓰므로 관리자 한정 구독은 기능 파손 |

## C. 구조 공사 (스키마 변경 — 승인 후 별도 로드맵)

| # | 항목 | 내용 |
|---|---|---|
| C1 | wbsData 지연 구독 | **로그인 느림의 1위 원인** — 전 프로젝트 WBS 통구독을 '보는 프로젝트만' 문서 단위 구독 + 요약(진척률·행수)은 별도 경량 문서. 부팅 수 MB → 수십 KB |
| C2 | ITP/QA 요약 인덱스 + lazy 본문 | 목록은 요약 인덱스만 구독, 본문(검사행 수백 개)은 클릭 시 getDoc 1건. 기록 지점 4곳 수정 + 1회성 백필 |
| C3 | qa-viewer 스냅샷 사본 분리 | 수동 저장본(전체 payload 사본×N)을 요약+본문 분리. 과도기: 스냅샷은 클릭 시 getDocs |

## D. 무해 판정 (조치 안 함 — 근거 기록)

- **COOP 경고 (popup.ts:309 반복)**: signInWithPopup 사용 시 구글 팝업 쪽 정책이 원인인 알려진 무해 경고(firebase-js-sdk #7342). 로그인 정상. 리디렉션 전환 시 오히려 로그인 느려짐 → 현행 유지
- **Firestore ERR_CONNECTION_RESET/CLOSED**: 사내망 장비가 장수 연결을 끊는 네트워크 요인 유력. SDK 자동 재연결로 기능 정상. experimentalAutoDetectLongPolling은 SDK 10.12.2에서 이미 기본값이라 no-op. 실시간 반영이 자주 멈출 때만 ForceLongPolling(13개 파일) 검토
- **'standalone' 문서 정합성**(발견): pid 없이 연 ITP/QA 도구가 'standalone' id로 저장하면 범위 쿼리(p~q)에 안 걸려 조회에 안 보임 — 실데이터 존재 여부 확인 후 처리 (성능 아닌 정합성 메모)

## 버그 사냥 (4번째 조사) — 11건

**A 묶음에 추가 (quick):**

| # | 심각도 | 항목 | 파일 |
|---|---|---|---|
| A8 | 🔴 high | **stripHeavyFields 40개 상한이 최상위 결과에도 적용** — 원격 조회가 40건에서 잘리고(설계 200건 무력화) 잘림 마커 문자열이 lastQuery에 섞여 엑셀/PDF에 쓰레기 열 생성 (v29.59 회귀) | ai-assistant.js:754 |
| A9 | 🟡 med | exportPdf title·컬럼명 미이스케이프 — 조회 데이터 경유 간접 프롬프트 주입 시 DOM XSS | ai-assistant.js:939 |
| A10 | 🟡 med | open_module 권한 체크 죽은 코드 — window.NAV 참조 잔존 (v29.58에서 한 곳만 수정) | ai-assistant.js:569 |
| A11 | 🟡 med | RAG 재등록이 삭제→임베딩 순서 — 중간 실패 시 문서 증발. 임베딩→삭제→업서트로 교체 | worker:196 |
| A12 | 🟡 med | 45초 절대 타이머가 스트리밍 중인 정상 응답도 중단 — 첫 응답까지만 45초 + 토큰 간 무응답 타임아웃으로 | ai-assistant.js:1482 |
| A13 | low | 날짜 필터: 대표 필드가 빈 문서가 createdAt 폴백으로 오탐 통과 | ai-assistant.js:686 |
| A14 | low | 루프 한계 안내문이 history에 안 남아 다음 턴 role 짝 깨짐 | ai-assistant.js:1592 |
| A15 | low | 워커 알림 조회 300건 상한 페이지네이션 없음 (경계 조건) | worker:322 |
| A16 | low | AI 입력창 Enter가 한글 조합(IME) 중에도 전송 | index.html:734 |
| A17 | low | 회의 예약 프리필이 이동 실패 시 잔존 — 나중에 모달 불쑥 | index.html:1833 |

**B5 ✅ 완료**: 대화 기록 키를 `state.currentUser`(localStorage 부팅값) → **Firebase 인증 uid** 기준으로 변경 + 로그인 사용자 변경 감지 시 화면·메모리 기록 교체. **검증: 공용 PC 시나리오(stale 사용자 무시), 사용자 전환 시 이전 대화 누출 없음, 로그아웃 상태에선 저장·복원 안 함** — 다중 탭 last-writer-wins는 남김(탭별 대화가 독립적인 게 오히려 자연스러워 과잉 설계 회피).

## B6 (신규 발견, 2026-07-30 사용자 지적) — Traveller 검사 사인이 로컬 전용 ⚠️

**증상**: 제작공정관리 화면에서 9단계 칸을 눌러 "✍ 검사 사인"을 하면 **본인 브라우저에만** 저장되어
다른 직원 화면에는 안 보인다. 사람마다 공정률이 다르게 보일 수 있다.

**구조 (검사 실적이 두 갈래로 이원화됨)**:
| 경로 | 저장 위치 | 공유 | 비고 |
|---|---|---|---|
| WBS 제작관리(MM) 모드 입력 | Firestore `wbsRec/{pid}_{itemId}` | ✅ 전 직원 실시간 | wbs.html:3776 저장 · index.html:2352 구독 — **현행** |
| 제작공정관리 ✍검사 사인 모달 | localStorage `state.travellers` | ❌ 내 브라우저만 | index.html:5809 `openSignModal` — **레거시** |

- 공정률 계산 `getItemInspProgress`(index.html:5491)는 **wbsRec 우선, 없으면 travellers 폴백** —
  그래서 wbsRec가 있는 아이템은 정상 공유되고, 없는 아이템만 각자 로컬 사인이 보여 혼란이 생긴다.
- 그 모달은 합격 시 `state.wbs`의 pct도 로컬로만 바꾼다(5846~5858) — Firestore 쓰기가 없어
  다음 로그인 시 서버 값으로 덮여 사라진다. (여기서 wbsData를 직접 쓰는 것은 CLAUDE.md 금지 규칙 —
  2026-07-17 WBS 덮어쓰기 사고 영역이라 우회 설계 필요)

**선택지 (사용자 결정 필요)**:
- (가) **권장** — 사인 모달 저장을 `wbsRec` 문서로 이관해 전 직원 공유. 구조 매핑(travellers의
  stageId/status ↔ wbsRec의 tid/result) 설계 + 기존 로컬 데이터 마이그레이션 판단 필요
- (나) 사인 모달을 읽기 전용으로 바꾸고 "검사 실적 입력은 WBS 제작관리 화면에서"로 유도 — 이원화 제거, 가장 안전
- (다) 현행 유지 (폴백 표시라는 점만 UI에 명시)

**주의**: B1은 travellers를 로컬 캐시에 그대로 유지했으므로 이 기능의 동작을 바꾸지 않았다.

**무혐의 확인:** renderMarkdown/mdInline 이스케이프 우회, 워커 KST 계산·백업 페이지네이션·saTokenCache 만료·RAG 잔여 조각(상한 500=삭제 범위 일치) — 문제 없음 확인.

---

## 검증 원칙

- A 묶음 각 항목: 수정 → node --check/워커 테스트 → 로컬 프리뷰 부팅 검증 → 푸시 → 실사용 확인
- 뷰어 캐시(A3)는 ITPVIEW/QAVIEW BUILD 상수 bump 필수, ai-assistant.js(A1·A7)는 ?v= bump 필수
- C 묶음은 백필 스크립트 포함 — 착수 전 사용자 승인

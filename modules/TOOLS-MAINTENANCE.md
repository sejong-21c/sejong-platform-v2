# ITP Builder · QA Doc Generator — 유지보수 가이드

신채완 과장이 만든 두 QA 도구(품질관리부)의 구조·저장·안전 수정 요령. 플랫폼 본체(index.html)와
분리된 iframe 모듈이며, 실제 사용 중이므로 **저장/동기화 로직은 특히 신중히** 다룰 것.

## 1. 구조 개요
- `modules/itp-builder/itp-builder.html`, `modules/qa-doc-generator/qa-doc-generator.html`
  — 각각 단일 HTML. React를 브라우저에서 Babel로 변환(`type="text/babel"`). **빌드 없음**:
  편집 → git push → 배포. (플랫폼도 같은 모놀리식·무빌드 방식 — 의도된 선택)
- 부모(index.html)가 `?pid=<프로젝트id>&embed=1` 등으로 iframe에 띄우고, `window.SJP.bridge`로
  프로젝트·아이템 정보를 넘긴다.

## 2. 버전(캐시버스터) — 어기면 "배포했는데 안 바뀜"
- 모듈을 고치면 **index.html의 `ITPBUILDER_BUILD` / `QADOC_BUILD` 상수를 같은 커밋에서 +1** 할 것
  (iframe src `?v=`에 붙어 캐시 무효화). 조회 뷰어는 `QAVIEW_BUILD` / `ITPVIEW_BUILD`.
- 주석·문서만 바꾼 경우(런타임 무영향)는 bump 불필요.

## 3. 저장 구조 (Firestore, 모두 `t_` 접두사 — 보안규칙상 사내 전원 read/write)
| 용도 | 컬렉션 | 키 |
|---|---|---|
| 작업 문서(자동저장·실시간) | `t_itpBuilderDocs` / `t_qaGenDocs` | 프로젝트 pid |
| 사진·도면 청크 | 위 컬렉션에 `chunk__*` 문서 | 포인터는 본문 `imgStoreChunks` |
| 저장 이력(복구용) | `t_itpVersionHistory` / `t_qaVersionHistory` | `pid_시각_rand` |
| 오류 로그 | `t_toolErrorLog` | `module_시각_rand` |
| 이름 저장(구, QA) | `t_qaGenProjIndex` | 수동 스냅샷(버튼은 제거됨, 데이터/모달 코드 잔존) |
- 로컬 캐시: `localStorage`(사진 제외) + **IndexedDB 영속 캐시**(`persistentLocalCache` — 재방문 빠름·오프라인).
- QA 리포트 내용은 React state가 아니라 **`IMG_STORE`(Map)** 에 저장 → `imgStore`로 클라우드에 감.
  (사진은 `data:`로 시작 = 청크 분리, 나머지 텍스트는 본문에 인라인)

## 4. 실시간 동기화 (v2.11 / v3.5~)
- 열 때 `getDoc` 1회가 아니라 **`onSnapshot` 구독**(subscribe*Doc) → 다른 PC 저장이 즉시 반영.
- 충돌/에코 방지: 세션 `CLIENT_ID`(=`QAG_CLIENT_ID`)로 **내 저장 에코 무시**, 편집 중(최근 5초/입력
  포커스)이면 남의 갱신으로 안 덮음, 반영 중엔 저장 안 함(`applyingRemoteRef`).
- 첫 스냅샷 전엔 클라우드 저장 보류(`_itpCloudSynced`/`_qaCloudSynced`) — 빈/낡은 로컬 덮어쓰기 방지.
- 나갈 때(탭 숨김/닫힘) flush 저장. 저장 상태는 상단 `SaveBadge`(저장중/저장됨·N전/오프라인).
- ⚠ **시계오차 주의**: 컴퓨터 간 `savedAt`(Date.now) 비교로 "누가 최신"을 판단하지 말 것 —
  과거 그 버그로 다른 PC 데이터가 안 보였음. 클라우드를 원본으로 삼는다.

## 5. 저장 이력 복구 + 자동 정리
- 스냅샷은 **텍스트만**(사진 제외). 자동저장 시 10분 throttle + 'New' 직전 강제.
- 정리(prune): 최신 1개 항상 보관 + (최근 20개 이내 && 7일 이내)만 보관 → 1주 넘게 안 건드린
  프로젝트는 다음 접근 시 최신 1개로 축소. 저장/이력열람 시 자동. (never-opened 프로젝트는 크론 없어 미정리)

## 6. 순수함수 테스트
- 공차·태그·TSV 계산은 `modules/shared/tool-calc.mjs`에 추출, `test/tool-calc.test.mjs`로 검증.
- 그 함수를 고치면 **HTML 인라인본 + shared 모듈 둘 다** 갱신하고 `node test/tool-calc.test.mjs` 통과시킬 것.
  (HTML은 안정성 위해 인라인 유지 — 모듈 로드 실패 시 앱 전체가 죽는 위험 회피)

## 7. 안전 수정 체크리스트
1. 모듈 수정 → index.html BUILD 상수 bump(같은 커밋).
2. `node --check`는 HTML엔 안 통함 → 로컬 정적 서버 + 브라우저 콘솔로 부팅·오류 확인.
3. 계산/태그/TSV 손대면 `node test/tool-calc.test.mjs` 통과.
4. **저장/동기화 로직**은 데이터 유실 이력이 많음 — 빈-저장 차단·승인 스탬프 보존·id 중복 방지·
   레이스 가드를 지울 때 특히 주의. 두 계정·두 PC로 실측 검증.
5. 조회 뷰어(`qa-viewer`/`itp-viewer`)·플랫폼(index.html)은 신 과장 소유 아님 — 버전 숫자 외 로직 수정은 상급자 확인.
6. `git push` 전 `git fetch → rebase`(여러 명 병행), **force push 금지**.

## 8. #7(빌드 마이그레이션) 관련 결정
풀 번들러/빌드 도입은 **하지 않기로** 함(2026-08): "빌드 없이 편집→push→배포" 워크플로에 안 맞고
(배포마다 빌드 필요), 사고 위험만 큼. 필요한 코드 공유는 `tool-calc.mjs`처럼 순수 로직만 선별 추출로 대응.

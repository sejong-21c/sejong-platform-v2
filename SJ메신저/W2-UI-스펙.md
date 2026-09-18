# SJ 메신저 W2 — UI 전면 개편 스펙 v1

2026-09-18 · 부장님 지시: "전화번호부 + 카톡 + 메신저 혼합 느낌으로 UI 를 다시 만들어라. 기존 방식이니까 사람들이 바로 쓴다."
참고 화면: 카톡 검색(친구 탭 '김' 접두) · 카톡 채팅 목록 · 카톡 채팅방 · 아이폰 연락처(이니셜 원, ㄱㄴㄷ 색인).
근거: 정독 보고 5편(`scratchpad/w2/정독결과.md`, 2026-09-18) — 아래 "사실:" 표시는 거기서 확인된 것.

## 0. 원칙
1. **모양은 카톡, 데이터는 지금 그대로.** `channels`·`messages`·`channelReads`·`users` 컬렉션과 필드 이름 유지(플랫폼 배지가 같은 필드를 읽는다 — 사실: index.html 2656-2684, 5944-5956). 더하기만 한다.
2. **두 무대, 한 코드.** ① 폰 홈 화면 앱(독립실행, 375px) ② 플랫폼 iframe(데스크톱, 카톡 PC 식 두 칸). 분기는 `matchMedia('(min-width: 900px)')` 하나.
3. 기존 기능 하나도 잃지 않는다: 공지·부서·프로젝트·그룹·DM, 첨부, 미읽음, 삭제, 나가기, 부모 브리지, W1 관문/서비스워커.
4. 프레임워크·라이브러리 0. 파일 4개(`messenger.html` 껍데기 · `messenger.css` · `messenger.js` · `lib.js` 순수 함수).
5. **부분 렌더.** 스냅샷마다 `#app` 전체를 다시 그리지 않는다(사실: 지금은 그런다 — 스크롤·입력이 흔들리는 원인).
6. 인라인 `onclick` 없음. `data-act` 이벤트 위임 하나. 그래서 전역 함수 없이 ES 모듈로 간다.

## 1. 화면 구조

### 1-1. 폰 (< 900px) — 카톡 모바일
```
┌──────────────────────┐
│ 친구            🔍  ⋯ │  상단바: 탭 제목 · 검색 · 더보기(탭별)
│ ───────────────────── │
│   탭 내용 (스크롤)      │
├──────────────────────┤
│ 👥친구  💬채팅  📁프로젝트  👤나 │  하단 탭바 · env(safe-area-inset-bottom)
└──────────────────────┘
```
- 채팅방은 탭 위로 **전체 화면**으로 올라온다(카톡). `‹` = 목록으로.
- 독립실행일 때만 `history.pushState` 로 방 진입을 쌓아 **폰 뒤로가기 제스처**가 목록으로 돌아온다. iframe 안에서는 안 쌓는다(부모 history 와 섞임 — 사실: index.html 3180-3207 이 popstate 를 쓴다).
- 검색은 상단 🔍 → 검색 화면(입력창 자동 포커스 · 취소 · 결과 탭 전체/채팅방/친구/메시지).

### 1-2. 데스크톱 (≥ 900px) — 카톡 PC
```
┌──┬───────────────┬──────────────────────────┐
│👥│ 🔍 검색          │ 방 이름 · 인원        🔍 ≡  │
│💬│ ──────────────  │                          │
│📁│ 목록(탭 내용)     │      대화 (말풍선)         │
│👤│                 │                          │
│  │                 │ ＋ [메시지 입력]        ➤  │
└──┴───────────────┴──────────────────────────┘
 64px      340px               나머지
```
- 방을 안 고르면 오른쪽은 빈 상태(아이콘 + "대화를 선택하세요").
- index.html 의 메신저 래퍼를 다른 모듈처럼 **full-bleed** 로 바꾼다(사실: 지금만 padding 20px + 하단 40px 빈 띠, 3703-3710).

## 2. 탭별 상세

### 2-1. 👥 친구 (= 연락처)
- 맨 위 **내 프로필 줄**(아바타 · 이름 · `부서 · 직급`) → 탭하면 "나" 탭.
- 그 아래 회사 사람 전원 — `users` 중 `disabled` 아닌 사람(사실: 지금 메신저는 disabled 를 안 걸러 index 와 다르다). `local_dev` 처럼 title 없는 계정은 빈칸 처리.
- **초성 섹션**: ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ · A–Z · `#`. 섹션 헤더 sticky. 섹션 안 정렬 `localeCompare(…, 'ko')`(사실: index selectableUsers 관례).
  - 쌍자음 초성은 기본 자음으로 합친다(ㄲ→ㄱ, ㄸ→ㄷ, ㅃ→ㅂ, ㅆ→ㅅ, ㅉ→ㅈ). 연락처 앱 방식.
- 오른쪽 **색인 레일**(비어 있는 초성도 표시, 회색): 탭 → 해당 섹션으로 스크롤. 드래그 스크럽은 W2-b.
- 줄: 아바타 44 · 이름(굵게) · 오른쪽 회색 `부서 · 직급`. 44px 이상 터치 높이.
- 탭 → **프로필 시트**(바닥에서 올라옴): 아바타 96 · 이름 · 부서/직급 · 이메일 · 버튼 [💬 1:1 채팅] [✉ 이메일(mailto)] [📞 전화(`phone` 있을 때만, tel:)]. 1:1 채팅 = 기존 `startDM` 로직(있으면 재사용, 없으면 `dm<ms>` 생성).
- 검색(친구 결과): **접두**("김" → 김○○) · **초성**("ㄱㅊㅇ" → 김철우, "ㄱ" 한 글자도) · **부분**(중간 글자 포함, 접두 뒤에 표시) · 부서명·직급도 대상. IME 조합 중에도 `input` 이벤트로 즉시 필터, `compositionend` 에 한 번 더.

### 2-2. 💬 채팅
- 대상 채널(사실 기준으로 확정):
  - `announce`(c1, 없으면 합성) · `dept` 11개(COMPANY_DEPTS 순, 없으면 합성 — **문서 id 규칙은 index 와 같은 `dept_<id>` 로 통일**; 이름 매칭 `c.name===dName` 유지) · `project`(아래 2-3 규칙) · `group`/`dm`(members ⊇ me).
  - `system`(qa-calibration-alert, ai-alerts) 은 **이번엔 숨긴다**(지금과 같음). W3 봇 방(`type:'bot'`) 설계와 함께 노출을 정한다. 이유: 70명 전원에게 검교정 알림이 갑자기 뜨면 안 된다.
  - **부서 방 노출 범위 = 플랫폼 배지와 같게**: 일반 직원은 **자기 부서 방 하나**, `grade` 가 super/exec 면 11개 전부(사실: index.html getVisibleChannels 2897-2899 가 그렇게 센다 — 지금 메신저는 11개를 다 보여서 상단 배지 합과 어긋난다). 다른 부서 방은 검색 → 채팅방 탭으로 찾아 들어갈 수 있다(들어가면 그 세션 동안 목록에 남는다).
  - `grade` 가 없는 계정(시험대·local_dev)은 일반 직원으로 본다.
- 목록 줄(카톡 그대로):
  - 아바타: DM = 상대 · 그룹 = 참여자 아바타 최대 4장 모자이크(2×2) · 공지 📢 · 부서 🏢 · 프로젝트 📁 (색 배지형).
  - 1행: **방 이름** + 회색 인원수(그룹/부서/프로젝트, 2명 초과일 때) + 📌 · 오른쪽 **시각**.
  - 2행: **마지막 말** 1줄 말줄임 · `image`→"사진을 보냈습니다." · `file`→"파일: 이름" · 오른쪽 **미읽음 배지**(빨강 · 300+).
  - 시각 규칙(카톡): 오늘 `오후 12:39` · 어제 `어제` · 올해 `9월 18일` · 다른 해 `2024. 7. 26.`
- 정렬: 📌 고정 먼저 → 마지막 메시지 `createdAt` 내림차순 → 메시지 없는 방은 이름순 맨 뒤.
- 상단 ＋ → 시트 [1:1 채팅] [그룹 채팅]. 1:1 = 친구 탭과 같은 초성 검색 목록. 그룹 = 기존 모달(이름 + 체크박스) 유지, 단 목록은 초성 검색 가능.
- 줄 길게 누르기(500ms)/데스크톱 우클릭 → 시트 [상단 고정/해제] [나가기(dm·group 만)] [알림 끄기 — W3, 비활성 표시].
- 고정은 **내 것만**: `channelReads/{cid}_{uid}.pinned=true` (규칙: 본인 write, 사실 rules 57-60). `channels` 문서는 안 건드린다(누구나 update 가능한 문서라 남의 DM 이름까지 바뀔 수 있음 — 사실 rules 40).
- 미리보기·정렬은 부팅 때 읽는 messages(최근 500건)에서 계산. **한계**: 500건 밖의 옛 방은 미리보기 없음 → 이름순 뒤로. 해결(W2-b)은 `channels.last{Text,At,Author}` 비정규화 또는 방별 페이지네이션(복합 인덱스 필요, 콘솔 작업).

### 2-3. 📁 프로젝트
- `projects` 중 `!hidden`. 그룹: **진행중(active) → 마감예정(pre-close) → 완료(done)**(사실: PROJ_STATUS_META). 완료 그룹은 접힘 기본.
- 카드: 프로젝트명 · 코드 · 상태 색점 · 방 미읽음 합. 탭 → 그 프로젝트의 **방 목록**:
  - 기본 방 `proj_<pid>`(`type:'project'`, 사실: index.html ensureProjectChannel 이 만들고 없으면 메신저가 합성).
  - 추가 방: `type:'group'` + `projectId:<pid>` (예 "○○공사 · 품질"). [＋ 방 추가] → 이름(기본값 `프로젝트명 · `) + 멤버 선택. 채팅 탭에도 그룹으로 뜬다.
- 프로젝트 방 멤버(사실: 지금 PM 1명으로 잡히는 버그): `pm` + `Object.values(p.members||{}).flat()`(객체) 또는 배열이면 그대로 → 중복 제거. 비어 있으면 "전원".
- 완료 프로젝트 방은 읽기만(입력바 대신 "완료된 프로젝트입니다" — 필요하면 나중에 해제). **아니, 이번엔 막지 않는다.** 결정: 입력 가능. 단순하게.

### 2-4. 👤 나
- 큰 아바타(96) 탭 → [사진 바꾸기] [사진 지우기]. 파일 선택(`accept="image/*"`) → 캔버스 정사각 중앙 크롭 **160×160 JPEG q0.8** → data URL(목표 ≤ 8KB, 상한 20KB 넘으면 q 낮춰 재시도) → `t_userPhotos/{uid}` = `{ uid, photo, updatedAt }`.
  - **왜 users 문서가 아닌가(사실 기반)**: index.html 이 users 전체를 로그인마다 받고 `state.users` 를 localStorage 에 그대로 직렬화한다(CACHE_SKIP_KEYS 에 users 없음) — 사진을 users 에 넣으면 플랫폼 전체가 무거워진다. `t_*` 컬렉션은 규칙 수정 없이 사내 read/write 가능(rules 104-106). **후속**: `firestore.rules` 에 `match /t_userPhotos/{uid} { allow write: if uid == request.auth.uid }` 를 넣어 본인만 쓰게 조인다(콘솔 게시는 부장님 — 그 전까지는 사내 누구나 쓸 수 있는 상태, 위험 낮음·표시만).
- 이름 · 부서 · 직급 · 이메일(읽기 전용 — 프로필 수정은 플랫폼).
- 설정: 알림(W3 자리, 비활성) · [로그아웃](독립실행일 때만 — `signOut` 후 관문) · 버전(`MESSENGER_BUILD` 는 iframe 에서만 알 수 있으니 `messenger.js` 안의 `버전` 상수 표시).

## 3. 채팅방 (카톡식)
```
┌──────────────────────┐
│ ‹ 3   김 해1인    🔍 ≡ │  ‹ 옆 숫자 = 다른 방 미읽음 합(0 이면 숨김) · 제목(그룹 = 이름 + 회색 인원) 
│  ── 2026년 9월 18일 목요일 ── │  날짜 구분선 (자정 기준, createdAt)
│ ◯ 이름                │
│   ┌────────┐ 오후 12:39│  상대: 흰 말풍선 왼쪽. 같은 사람·같은 분 연속이면 아바타/이름은 첫 줄만, 시각은 묶음 마지막만
│   │ 내용    │          │
│   └────────┘          │
│      1  오후 12:40 ┌──────┐│  나: 노란 말풍선 오른쪽, 아바타 없음. 작은 '1' = 아직 안 읽은 사람 수
│                   │ 내용  ││
│                   └──────┘│
│ [사진 썸네일 ≤ 240px]      │  탭 → 전체화면 뷰어
│ [📎 파일 이름 · 크기]       │  탭 → 새 탭(fileUrl)
│ ── ⓘ 시스템 메시지 ──       │  author 'SYSTEM' 또는 system:true → 가운데 회색 캡슐
├──────────────────────┤
│ ＋  [메시지 입력       ] ➤ │  입력바: 자동 높이(최대 5줄) · 글 있을 때만 ➤ 활성
└──────────────────────┘
```
- **시각은 `createdAt`(ms) 으로 만든다.** `at` 은 폴백(사실: SYSTEM 은 ISO, AI 비서는 ko-KR 문자열 — `at.slice(11)` 은 깨진다).
- 묶음 규칙: 이전 메시지와 같은 author, 같은 `HH:MM`, 사이에 날짜선 없음 → 연속.
- 미읽음 숫자(내 메시지): 방 멤버 중 `channelReads[cid][uid].lastRead < msg.createdAt` 인 사람 수. 그러려면 **방의 다른 사람 읽음도 알아야 한다** → `channelReads where channel == cid` 를 방 진입 시 구독(사실: 지금은 내 것만 `where uid==me` 로 읽는다). 멤버가 없는 방(공지·부서 합성·프로젝트 전원)은 숫자 표시 안 함.
- 색(CSS 변수): 배경 `--room-bg:#B2C7D9` · 내 말풍선 `--bubble-me:#FEE500` · 상대 `--bubble-you:#fff` · 글자 `#1a1a1a`. 브랜드 파랑은 상단바·탭·배지에.
- 🔍 방 안 검색: 상단바가 검색바로 바뀜 · 일치 말풍선 `mark` 하이라이트 · ▲▼ 이동 · `3/12` · 닫기.
- ≡ 서랍(오른쪽에서 슬라이드): 참여자(아바타·이름·직급 · 탭 → 프로필 시트) · [초대](group 만: 체크박스 → `members` 배열 추가) · [나가기](dm·group).
- ＋ 시트: [📷 카메라(`capture="environment"`)] [🖼 앨범] [📎 파일] → 기존 `sendFiles` 흐름. 데스크톱은 파일 선택 하나 + 드래그앤드롭 유지.
  - 첨부 저장은 **당분간 Firebase Storage 그대로**(15초 타임아웃 포함). 사실: 사내망에서 Storage 가 막히는 전례가 있어 실패 가능 — 실패 시 사람이 알 수 있게 토스트. R2 이전은 W2-b(게이트웨이 `/presign`).
- 말풍선 길게 누르기/우클릭 → 시트 [복사] [삭제(내 것만)] — 삭제는 기존 `deleteDoc`.
- 스크롤: 새 메시지가 오면 **맨 아래에 있을 때만** 자동 스크롤, 아니면 하단 "↓ 새 메시지 1" 칩. 방 진입 시 맨 아래.
- 입력: 데스크톱 Enter 전송(`Shift+Enter` 줄바꿈, `e.isComposing` 이면 무시). 폰은 ➤ 버튼(Enter 는 줄바꿈).
- 방에 들어오면·새 메시지를 보이는 채로 받으면 `markChannelRead`(기존 payload `{channel, uid, lastRead}` 유지). "보이는 채로" = 그 방이 열려 있고 `document.visibilityState === 'visible'` 이고 스크롤이 맨 아래 근처. (사실: 지금은 방을 열어 둔 채 새 메시지가 오면 배지가 붙고, 다시 눌러야 사라진다.)
- 작성자 id 가 `pu_…`(사전등록 대기 계정 — 사실: PM 으로 지정될 수 있다) 이면 `window.parent.state.pendingUsers` 에서 이름을 찾고, 없으면 "대기 계정" 으로 표시. 원문 id 를 화면에 내보내지 않는다.
- 방 나가기 뒤 activeCh 는 **null**(목록). 사실: 지금은 항상 c1 로 떨어진다.

## 4. 아바타 (공용)
1. `t_userPhotos[uid].photo` 있으면 사진.
2. 없으면 **이니셜**: 한글 3자 이상 → 성 뺀 뒤 2자("김철우"→"철우") · 한글 2자 → 이름 1자("김진"→"진") · 4자 이상 복성 처리 안 함(뒤 2자) · 영문 → 대문자 첫 2자 · 그 외 → 첫 1자. 배경 = uid 문자열 해시 → 파스텔 8색, 글자 흰색 굵게.
3. 크기: 목록 44 · 방 36 · 프로필 96 · 그룹 모자이크 44 안에 2×2. **둥근 사각(카톡 스퀴클)** `border-radius: 40%`.
4. `author:'SYSTEM'` → 회색 ⓘ 아이콘.

## 5. 데이터 (더하기만)
| 컬렉션 | 추가/사용 | 누가 쓰나 | 규칙 |
|---|---|---|---|
| `t_userPhotos/{uid}` | `{uid, photo(dataURL ≤20KB), updatedAt}` | 본인 | `t_*` 사내 read/write(기존) → 후속으로 본인 write 로 조임 |
| `channels` | `projectId`(추가 방) · `createdBy` · `createdAt` | 만든 사람 | 사내 create/update(기존) |
| `channelReads/{cid}_{uid}` | `pinned:boolean` · (기존 `channel`,`uid`,`lastRead`) | 본인 | uid==본인(기존) |
| `messages` | W1 그대로 `type`·`clientId` · 문서 id `msg_<clientId>` | 보낸 사람 | author==uid(기존) |
| `users` | 읽기만. **onSnapshot 으로 바꿈**(사실: 지금 getDocs 1회 — 새 직원·이름 변경이 반영 안 됨) | - | read 사내 |
- 부모 `state.users` 가 있으면 첫 화면은 그걸로 그리고, 구독이 오면 갈아탄다(users 두 번 fetch 는 그대로 두되 — 사실: 부모도 1회 — 메신저 구독 1개로 충분).
- `messages` 구독은 지금처럼 `orderBy createdAt desc limit 500` 하나. 방별 추가 로딩은 W2-b(복합 인덱스).

### 3-1. 폰 껍데기 규칙 (iOS 독립실행 포함)
- `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">` — 사실: 지금은 `viewport-fit=cover` 가 없어 노치 아이폰에서 `env(safe-area-inset-*)` 가 전부 0 이다.
- 높이는 `height:100%` + `height:100dvh` 덮어쓰기(플랫폼 로그인 화면 관례, index.html 416). 탭바·입력바 아래 `padding-bottom: env(safe-area-inset-bottom, 0px)`.
- 키보드가 올라오면(iOS 독립실행) `visualViewport.resize` 로 루트 높이를 `visualViewport.height` 에 맞춘다. 실물 확인 전까지는 추측 — 시험대에서는 검사 안 함.
- `overscroll-behavior: none`, 탭 하이라이트 제거, 터치 타깃 ≥ 44px.

## 6. 파일·모듈 구조
```
modules/messenger/
  messenger.html   ← 껍데기(≤120줄): 메타·PWA·<div id="app">·<div id="modal">·<script type="module" src="./messenger.js?v=…">
                      Firebase 초기화는 messenger.js 로 이동(window.fb 는 계속 만든다 — 시험대·부모 브리지 호환)
  messenger.css    ← 전부. 모바일 우선 + @media (min-width: 900px)
  messenger.js     ← ES 모듈. 상태·구독·4탭·방·검색·시트·이벤트 위임. import './lib.js'
  lib.js           ← 순수 함수(브라우저 전역 안 씀 → node 로 테스트): 초성·검색·정렬·이니셜·아바타색·시각 표기·묶음 판정·미리보기 문구
  sw.js            ← 껍데기 프리캐시에 messenger.css · messenger.js · lib.js 추가, 버전 sj-msg-v2
test/
  messenger-lib.test.mjs     ← lib.js 단위 검사(node)
  messenger-harness.html     ← 가짜 fb(메모리 Firestore) + 부모 state → 메신저를 iframe 에 띄운다 (?embed=1&v=test)
  messenger-ui-check.mjs     ← 헤드리스 크롬: 375×812 · 1280×800 시나리오 + 스크린샷 test/shots/
  pwa-w1.test.mjs            ← JS 쪽 불변식은 messenger.js 를 본다(같은 커밋에서 고침)
  pwa-live-check.mjs         ← iframe 검사 셀렉터를 `.sjm-chat, .sjm-screen` 으로, uid 확인은 `contentWindow.SJM.me()` 로(같은 커밋)
  w1-iframe-harness.html     ← 그대로(부모 fb 없음 → 메신저는 자기 fb 로 폴백해야 함)
```
- 헤드리스 실검(pwa-live-check)이 요구하는 것 중 유지할 것: 독립실행 관문 문구에 '로그인' 포함 · gstatic firebasejs 캐시 **정확히 4개**(SDK 파일을 더 import 하지 않는다 — `updateDoc`/`deleteDoc` 은 같은 firestore 모듈에서) · 비행기 모드에서 본문에 '오류' 문구 없음.
- `window.fb` 는 messenger.js 가 만든다(이전과 같은 키 + **`updateDoc`·`deleteDoc` 추가** — 사실: 지금 빠져서 독립실행에서 나가기·삭제가 죽는다).
- `getFB()` = `window.parent.fb || window.fb` 유지 → 시험대가 부모 `fb` 를 주입해 Firestore 없이 전체를 돌린다.
- 시험용 노출: `window.SJM = { state, open(cid), tab(name), search(q), me() }` (읽기 전용 용도).

## 7. DOM 계약 (시험대와 CSS 가 같은 이름을 쓴다)
접두 `sjm-`. 동작은 전부 `data-act`. 화면 표시는 `data-screen`, 레이아웃은 루트 `data-layout="phone|desk"`.
| 무엇 | 선택자 |
|---|---|
| 루트 | `#app > .sjm[data-layout]` |
| 데스크톱 레일 / 폰 탭바 | `.sjm-rail`, `.sjm-tabbar` — 버튼 `[data-act="tab"][data-tab="friends|chats|projects|me"]`, 활성 `.is-active`, 배지 `.sjm-tab-badge` |
| 목록 칸 | `.sjm-pane` > `.sjm-topbar`(`.sjm-topbar-title`, `[data-act="search-open"]`, `[data-act="new-chat"]`) + `.sjm-screen[data-screen="friends|chats|projects|me|search"]` |
| 친구 | `.sjm-me-row[data-act="tab"][data-tab="me"]` · 섹션 `.sjm-sec[data-key]` > `.sjm-sec-h` · 줄 `.sjm-user[data-act="user"][data-uid]` > `.sjm-avatar` `.sjm-user-name` `.sjm-user-sub` · 색인 `.sjm-index > [data-act="jump"][data-key]` |
| 채팅 목록 | `.sjm-chat[data-act="open"][data-cid]` > `.sjm-avatar`(그룹은 `.sjm-avatar.is-mosaic`) `.sjm-chat-name` `.sjm-chat-count` `.sjm-pin` `.sjm-chat-time` `.sjm-chat-last` `.sjm-badge` |
| 프로젝트 | `.sjm-proj-group[data-status]` > `.sjm-proj[data-act="proj"][data-pid]` · 펼침 `.sjm-proj-rooms` > `.sjm-chat[data-cid]` + `[data-act="proj-new-room"][data-pid]` |
| 나 | `.sjm-profile` > `.sjm-avatar.is-xl` `[data-act="photo-menu"]` `#photoInput` `[data-act="logout"]` `.sjm-version` |
| 검색 화면 | `#searchInput` · `[data-act="search-close"]` · `.sjm-stabs > [data-act="stab"][data-stab="all|chats|friends|messages"]` · 결과 섹션 `.sjm-sres[data-kind]` · 메시지 결과 `.sjm-hit[data-act="hit"][data-cid][data-mid]` |
| 방 | `.sjm-room[data-cid]` > `.sjm-room-head`(`[data-act="back"]` + `.sjm-back-count`, `.sjm-room-title`, `.sjm-room-count`, `[data-act="room-search"]`, `[data-act="room-menu"]`) · `#roomBody.sjm-room-body` · `.sjm-day` · `.sjm-msg[data-mid][data-author]`(`.is-me`, `.is-first`, `.is-last`, `.is-system`) > `.sjm-avatar` `.sjm-msg-name` `.sjm-bubble` `.sjm-msg-time` `.sjm-msg-unread` `.sjm-msg-img` `.sjm-file` · 새 메시지 칩 `[data-act="jump-bottom"]` · 입력 `.sjm-composer` > `[data-act="attach"]` `#msgInput` `[data-act="send"]` · 빈 상태 `.sjm-room-empty` |
| 방 검색 | `.sjm-room-search` > `#roomSearchInput` `[data-act="rs-prev"]` `[data-act="rs-next"]` `.sjm-rs-count` `[data-act="rs-close"]` · 일치 `mark.sjm-mark`, 현재 `.is-current` |
| 서랍 | `.sjm-drawer.is-open` > 참여자 `.sjm-user[data-uid]` · `[data-act="invite"]` `[data-act="leave"]` `[data-act="drawer-close"]` |
| 시트 | `#sheet.sjm-sheet.is-open` > `.sjm-sheet-item[data-act=…]` · 배경 `[data-act="sheet-close"]` |
| 프로필 시트 | `.sjm-sheet[data-kind="profile"][data-uid]` > `[data-act="dm"][data-uid]` `[data-act="mail"]` `[data-act="call"]` |
| 이미지 뷰어 | `.sjm-viewer.is-open` > `img` `[data-act="viewer-close"]` |
| 토스트 | `#toast.sjm-toast.is-show` |
| 모달(그룹 만들기·초대) | 기존 `#modal` `#mTitle` `#mBody` `#mOk` 유지 + `#grpName` `input[name="grpMember"]` · 안에 `#pickSearch`(초성 검색) |

## 8. lib.js API (순수 함수 — 여기 이름 그대로 구현·테스트)
```js
export const 초성표 = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];   // 색인 순서
export function 초성(str)              // '김철우' → 'ㄱㅊㅇ' · 한글 아닌 글자는 그대로(영문은 대문자) · 쌍자음은 기본자음으로
export function 섹션키(name)           // '김철우'→'ㄱ' · 'Alice'→'A' · '123'/''→'#'
export function 이름일치(name, query, extra=[])  // 접두 > 초성접두 > 부분 > extra(부서·직급) 부분. 일치 시 순위 1..4, 아니면 0. query 공백 trim, 대소문자 무시
export function 사람정렬(a, b)          // localeCompare 'ko' (name 기준, 같으면 id)
export function 섹션나누기(users)       // → [{key:'ㄱ', items:[...]}...] 초성표 순 → A-Z → '#'. 빈 섹션 제외
export function 이니셜(name)           // §4-2 규칙
export function 아바타색(uid)           // 8색 중 하나 '#hex' (문자열 해시, 항상 같은 결과)
export function 목록시각(ms, now)       // 오늘 '오후 12:39' · 어제 '어제' · 올해 '9월 18일' · 다른 해 '2024. 7. 26.'
export function 말풍선시각(ms)          // '오후 12:39'
export function 날짜선(ms)             // '2026년 9월 18일 목요일'
export function 같은묶음(prev, cur)     // 같은 author · 같은 분(HH:MM) · 같은 날 · 둘 다 system 아님 → true
export function 미리보기(msg)          // text 1줄 60자 · image '사진을 보냈습니다.' · file '파일: 이름' · 없음 ''
export function 메시지시각ms(msg)       // createdAt 숫자 → 없으면 at 파싱('YYYY-MM-DD HH:mm', ISO, ko-KR) → NaN 이면 0
export function 방이름(ch, users, me)   // dm → 상대 '이름 직급' · 그 외 ch.name
export function 방멤버(ch, users, projects) // §2-3 멤버 규칙 반영(pm + members 객체/배열, dept 이름 매칭, announce 전원)
export function 채팅정렬(a, b)          // pinned desc → lastAt desc → name
export function 이미지축소(file, size=160, quality=0.8, maxBytes=20*1024) // 브라우저 전용, Promise<dataURL>. lib 에 두되 document 가 없으면 throw
```

## 9. 받아들이는 조건 (이게 되면 W2-UI 끝)
1. 375px: 하단 4탭 · 친구 탭 전원 초성 섹션 + 색인 레일 · "김" → 김○○만 · "ㄱㅊ" → 김철우.
2. 채팅 탭: 방마다 아바타·이름·미리보기·시각·배지, 📌 고정이 위.
3. 방 열기 → 좌/우 말풍선·날짜선·묶음·미읽음 숫자 · ‹ 로 돌아오면 목록 스크롤 그대로 · 독립실행이면 뒤로가기 제스처도 목록.
4. 방 안 🔍 → 하이라이트·▲▼·`n/m`.
5. 나 탭 사진 올리면 친구 목록·말풍선 아바타 즉시 반영, 없는 사람은 이니셜.
6. 프로젝트 탭 → 프로젝트 → 방 추가 → 채팅 탭에도 뜬다. 프로젝트 방 멤버가 PM+팀으로 잡힌다.
7. 1280px iframe(시험대): 레일+목록+방 두 칸 · 관문 안 뜸 · 부모 uid 이어받음.
8. 전송 payload `{channel, author==uid, text, type:'text', clientId, at, createdAt}` · 문서 id `msg_<clientId>` (W1 계약).
9. 독립실행에서 나가기·삭제가 동작(updateDoc·deleteDoc 있음).
10. `node test/pwa-w1.test.mjs` · `node test/messenger-lib.test.mjs` · `node test/messenger-ui-check.mjs` 통과 · `node test/pwa-live-check.mjs` 13/13 유지 · 폰 실물은 부장님.

## 10. 같이 올릴 것
- `index.html`: `MESSENGER_BUILD` b29 · 메신저 래퍼 full-bleed.
- `sw.js`: 프리캐시 + `sj-msg-v2`.
- `firestore.rules`: `t_userPhotos` 본인 write 규칙(콘솔 게시는 부장님 확인 후).
- `메신저-설계.md` §6 W2 행 갱신 · 이 파일.

## 11. 미결(설계 비평이 답할 것)
- iOS 독립실행 키보드: `100dvh` + `visualViewport` 로 입력바 붙이기 — 실물 확인 전까지 추측.
- 500건 캡과 "기록 그대로" 기대의 간극 → W2-b 우선순위.
- 검색 결과 "메시지" 탭 범위(500건 안에서만) 표기 문구.


## 12. 구현하면서 바뀐 것 (2026-09-18, 카톡 충실도 비평 반영)

비평 P1 열한 개 중 열 개를 넣었고, 하나(공지 방 쓰기 권한 — 부서장 이상만)는 **정책 결정이라 부장님 몫**으로 남겼다.

| 스펙 v1 | 실제 구현 | 왜 |
|---|---|---|
| 프로필 사진 `t_userPhotos` | **`t_userProfile/{uid} = {uid, photo, phone, updatedAt}`** — 전화번호까지 한 문서 | "전화번호부" 인데 `users` 에 전화가 없어 [전화] 버튼이 아무에게도 안 뜰 판이었다. 나 탭에 입력 한 줄, 프로필 시트·DM 헤더에 📞 |
| 채팅 탭 = 공지 + 부서(임원 11개) + 프로젝트 전부 + dm/group | 공지 + **내 부서** + 내가 든 dm/group + **활동(메시지·읽음 문서·고정)이 있는 방만**. 새 방은 `createdAt` 으로 맨 위 | 카톡 목록엔 빈 방이 없다. 조용한 부서·프로젝트 방은 친구 탭 "부서" 섹션·프로젝트 탭·검색에서 들어간다. 들어가면 읽음 문서가 생겨 **영구히** 목록에 남는다 |
| 1:1 나가기 = members 제거 | **`channelReads.hidden` 로 숨기기** — 새 메시지가 오면 다시 뜬다 | members 를 빼면 상대 메시지를 영영 못 받고, 다시 열면 새 방이 생겨 기록이 갈라진다 |
| 미읽음 '1' 은 내 말풍선에만 | **모든 말풍선**(멤버 ≤60 인 방) — 숫자 위·시각 아래 세로 | 카톡 그룹방과 같다. 부장이 "12명 중 3명 안 읽음" 을 남의 말에서도 본다 |
| 미리보기·정렬은 500건 창에서만 | 전송 시 `channels.lastText/lastAt/lastAuthor` 를 남긴다(3필드 merge) + 방 맨 위 "최근 대화만 표시됩니다" 캡슐 | 창 밖으로 밀린 방이 "사라진 것" 처럼 보이지 않게. 페이지네이션(복합 인덱스)은 W2-b |
| 새 채팅 = 시트 [1:1] [그룹] → 각각 모달 | **모달 하나**: 대화상대 체크 → 1명이면 1:1, 여럿이면 그룹(이름 선택, 비우면 이름 나열) | 카톡 흐름 그대로. 프로젝트 "방 추가" 도 같은 모달(projectId 만 붙음) |
| 길게 누르기 [고정] [나가기] [알림 끄기(비활성)] | [채팅방 상단 고정] [나가기] — **비활성 항목 없음** | 비활성 버튼은 고장으로 읽힌다. 알림은 W3 에 |
| 사진 원본 업로드 | `사진줄이기(1280, q0.8)` 뒤 업로드 · 프로필은 192px | 현장 4G 에서 15초 타임아웃 안에 들게 |
| 합성 방 아바타 = 이모지 | **2자 타일**: 공지 / 부서 앞 2자 / 프로젝트 코드 앞 4자, 색은 id 해시 | OS 마다 다른 이모지 대신, 임원의 부서 방 11개가 서로 구분된다 |
| Inter + Noto Sans KR 웹폰트 | **기기 폰트** (`-apple-system, Apple SD Gothic Neo, Roboto, Malgun Gothic…`) | 카톡과 같고, 현장 첫 로딩·오프라인 첫 설치가 가벼워진다 |
| 보조 글자 #9ca3af | #6b7280 (4.5:1) · 말풍선 15.5px · 목록 이름 16px · 미리보기 14px | 햇빛 아래 현장 |
| — | **읽음 구분선** "여기까지 읽으셨습니다" · 초대/나가기 **시스템 캡슐**(`author=me, system:true`) · **실패 말풍선**(다시 보내기/삭제 — clientId 멱등) · 링크 자동 인식 · 오프라인 바 · "대화를 불러오는 중…" · `setAppBadge` + 제목 (n) · 나와의 채팅 · 부서 섹션(친구 탭) · 필터 칩(방 8개↑) · 색인 레일은 있는 초성만(빈 초성 탭 → 다음 섹션) | 비평 P2 중 값싼 것 |

**같이 바뀐 계약**
- `firestore.rules`: `t_userProfile/{uid}` 본인만 write, 범용 `t_*` 규칙에서 제외. **콘솔 게시 전까지는 사내 누구나 쓸 수 있는 상태**(위험 낮음·표시만).
- `test/pwa-w1.test.mjs` 54개 — JS 불변식은 `messenger.js` 를 본다. `?v=`(css·js) = `MESSENGER_BUILD` 검사 추가.
- `test/pwa-live-check.mjs` — iframe 셀렉터 `.sjm-screen, .sjm-chat`, uid 는 `SJM.me()`, 오프라인 재열림은 "앱/관문이 그려졌나 + 모듈이 캐시에서 살아났나".
- 시험대(`w1-iframe-harness.html`)에 viewport 메타 — 없으면 폰 에뮬레이션에서 980px 뷰포트가 잡혀 데스크톱 배치로 그려진다(실측).

**남긴 것** — 공지 방 쓰기 권한(부서장 이상만?) · 12/24시간 표기는 '오후 12:39' 고정(기기 설정 따르기는 다음) · 사진 여러 장 "사진 N장" 묶음 · 읽지 않은 사람 목록 시트 · Google 프로필 사진 자동 채움 · iPad 분할 · 방별 페이지네이션(W2-b).

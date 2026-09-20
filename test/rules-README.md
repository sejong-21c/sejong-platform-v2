# 규칙 시험대 (Firestore 에뮬레이터)

`npm run rules` — 에뮬레이터를 띄워 `firestore.rules` 를 걸고 실제로 읽고 써 본 뒤 끈다.
**운영 데이터는 건드리지 않는다**(프로젝트 id 가 `demo-sejong` 이라 에뮬레이터 밖으로 안 나간다).

## 왜 생겼나

2026-09-20 까지 우리는 규칙을 시험대 없이 운영에 바로 올리고 있었다. 2단계 3번에서 메신저
읽기 규칙을 바꿔야 하는데, 잘못 열면 **남의 부서 대화가 보인다.** 되돌릴 수 없는 종류다.

## 준비물

- **Java** — 에뮬레이터가 자바다.
  PC: `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot\bin` 을 PATH 에.
  없으면 `winget install --id Microsoft.OpenJDK.21`
- `npm install` (개발용만. 브라우저 쪽은 여전히 의존성 0 — gstatic 에서 받는다)

포트는 `firebase.json` 의 `emulators.firestore.port` 하나로 관리한다. 시험이 그 값을 읽으므로
겹치면 거기만 고치면 된다(이 PC 는 8080 을 Docker/WSL 이 써서 8181 로 옮겼다).

## `[2단계]` 로 시작하는 시험

**지금은 통과하지만 뒤집힐 것들**이다. 예:

```
PASS  [2단계] 생산부 직원이 품질관리부 방 메시지를 읽는다 — 지금은 통과한다
PASS  [2단계] 남의 1:1 대화도 읽힌다 — 지금은 통과한다
PASS  [2단계] 전 직원이 messages 를 통째로 훑는다 — 지금은 통과한다
```

2단계 3번은 **이 줄들을 `assertFails` 로 뒤집고 규칙을 고쳐 다시 초록으로 만드는 일**이다.
그게 그 작업의 정의다. 규칙만 고치고 이 줄을 안 고치면 시험이 알려 준다.

## 규칙을 고칠 때

1. `firestore.rules` 를 고친다
2. `npm run rules` — **전부 초록이어야 한다**
3. 그제서야 Firebase 콘솔(Firestore → 규칙)에 붙여넣고 게시한다
   (파일과 콘솔이 어긋나면 조용한 쓰기 실패가 난다 — 2026-07-17 wbsHistory 사건)

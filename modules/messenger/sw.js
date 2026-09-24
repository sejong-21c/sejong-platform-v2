/* SJ 메신저 서비스워커 — 설치 · 오프라인 재열림
 *
 * 규칙 하나: 여기서 건드리는 건 "모양이 변하지 않는 파일"뿐이다.
 *   - 같은 출처(sejong21c.com)의 정적 파일, gstatic 의 Firebase SDK → 캐시
 *   - Firestore/Auth(googleapis.com) → 손대지 않는다. 롱폴링 응답을 캐시하면 메시지가 멈춘다.
 *
 * 버전 문자열을 올리면 옛 캐시는 activate 때 전부 지운다. (messenger.html/.css/.js/lib.js 를 고치면 올릴 것)
 *   v1 W1 껍데기 · v2 W2 카톡식 UI(css/js/lib 분리) · v3 '친구'→'연락처' · v4 AI 비서 방(ai.js) · v5 AI 가 내 업무·일정도 본다 · v6 제공자 체인 실측 교체 · v7 lib·ai import 에 ?v=
 */
const 버전 = 'sj-msg-v69';   // v69: b100(읽기 장부 — 한도 표시·접속 한 줄) · v68: b99(BYO 연결 화면) · v67: b98(AI 행위 시간 제한) · v66: b97(AI 행위 라이브 시험 수리) · v65: b96(읽기 장부에 관문 몫) · v64: b95(관리 기록 화면 읽기 97% 감축) · v63: b94(읽기 장부) · v62: b93(열쇠 창 '확인 못 함') · v61: b92(개인 AI 열쇠) · v60: b91(게이트웨이 사용자별 장부·하루 한도) · v59: b90(문서 초안 저장·색인) · v58: b89(경비 월 마감) · v57: b88(NCR·CAR 발행 행위) · v56: b87(부팅 읽기 계량기·wbsRec 지연) · v55: b86(에뮬레이터 하네스) · v54: b85(업무 새로 등록 — 행위 여섯) · v53: b84(AI 행위 등록소 다섯) · v52: b83(AI 비서가 스케줄 진척률을 고친다 — 확인 카드로) · v51: b82(영수증은 경비 내역서로 간다) · v50: b81(엑셀 파일 이름이 UTC 라 새벽에 하루 밀렸다) · v49: b80(센 결과를 차트·엑셀로) · v48: b79(영수증 분기가 엉뚱한 함수에 들어가 있었다) · v47: b78(영수증 첨부 — 맥이 읽고 사람이 등록) · v46: b77(플랫폼 기록 세기) · v45: b76(기록 출처 칩 문턱) · v44: b75(버튼 있으면 가는 길 설명은 지운다) · v43: b74(「화면 열기」 버튼 — 지어내는 대신 진짜로 연다) · v42: b73(금액에 붙던 부동소수 꼬리) · v41: b72(차례를 요구하던 넷째 줄) · v40: b71(버튼·차례를 지어내라고 시키던 줄을 고쳤다) · v39: b70(지침 자신이 화살표를 쓰고 있었다) · v38: b69(없는 2단계 경로 — 화살표를 막는다) · v37: b68(수압시험 사건 수리 — 조각 10개·볼트 몫 분리·반말 본보기 제거) · v36: b67 · v35: b66 · v34: b65 · v33: b64 · v32: b63 · v31: b62 · v30: b61 · v29: b60 · v28: b59 · v27: b58 · v26: b57 · v25: b56(표 질의) · v24: 2단계(b55) — 낡은 껍데기가 남으면 옛 구독으로 도니 판을 갈아엎는다 · v23: 같은 출처는 그물 먼저 — ?v= 를 버려서 배포가 안 닿던 것(2026-09-21)
const 껍데기 = [
  './messenger.html',
  './messenger.css',
  './messenger.js',
  './lib.js',
  './ai.js',
  '../shared/emu.mjs',   // b86: messenger.js 가 정적 import 한다 — 없으면 비행기 모드에서 앱이 통째로 안 뜬다
  './manifest.json',
  './icons/icon-192.png',
];

// Firebase SDK 는 첫 방문 때 서비스워커가 아직 페이지를 잡기 전에 로드된다 → 그때는 캐시에 안 들어온다.
// 설치 시점에 미리 받아둬야 비행기 모드에서 확실히 열린다. 버전은 messenger.js 의 import 와 같아야 하고,
// 어긋나면 test/pwa-w1.test.mjs 가 잡는다.
const SDK버전 = '10.12.2';
const SDK = ['app', 'auth', 'firestore', 'storage']
  .map((m) => `https://www.gstatic.com/firebasejs/${SDK버전}/firebase-${m}.js`);

// 캐시해도 되는 바깥 출처 (SDK·폰트만. 데이터 API 는 절대 넣지 않는다)
const 바깥허용 = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.googleapis.com/',
  'https://fonts.gstatic.com/',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(버전);
    // cache:'reload' — 브라우저 HTTP 캐시(GitHub Pages 10분)를 건너뛰고 새 파일을 받는다. 안 그러면 새 SW 가 옛 JS 를 프리캐시한다.
    await c.addAll(껍데기.map((u) => new Request(u, { cache: 'reload' })));   // 이건 실패하면 설치도 실패해야 한다
    await Promise.all(SDK.map((u) => c.add(u).catch(() => {})));               // 바깥 것은 실패해도 설치를 막지 않는다
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((키들) => Promise.all(키들.filter((k) => k !== 버전).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function 캐시할까(요청) {
  if (요청.method !== 'GET') return false;
  const u = new URL(요청.url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.origin === self.location.origin) return true;
  return 바깥허용.some((p) => 요청.url.startsWith(p));
}

async function 넣기(요청, 응답) {
  try {
    if (응답 && 응답.ok && 응답.type !== 'opaque') {
      const c = await caches.open(버전);
      await c.put(요청, 응답);
    }
  } catch (e) { /* 용량 초과 등 — 캐시 실패로 화면을 죽이지 않는다 */ }
}

self.addEventListener('fetch', (e) => {
  const 요청 = e.request;
  if (!캐시할까(요청)) return;                     // Firestore·Auth 는 그대로 통과
  const 같은출처 = new URL(요청.url).origin === self.location.origin;

  // 화면 이동(주소창·홈 화면 아이콘): 네트워크 먼저, 끊기면 캐시된 메신저를 준다
  if (요청.mode === 'navigate') {
    e.respondWith(
      fetch(요청)
        .then((r) => { 넣기(요청, r.clone()); return r; })
        .catch(() => caches.match(요청, { ignoreSearch: true })
          .then((c) => c || caches.match('./messenger.html', { ignoreSearch: true })))
    );
    return;
  }

  // ── 같은 출처 정적 파일: **그물 먼저**(network-first), 끊기면 캐시 ──────────────
  //
  // 왜 바꿨나 (2026-09-21). 예전엔 `caches.match(요청, { ignoreSearch: 같은출처 })` 로
  // **?v= 를 버리고** 맞춘 다음 `캐시됨 || 네트` 로 캐시를 먼저 줬다. 그러면
  // **캐시버스터가 통째로 무력해진다** — messenger.js?v=b49 를 올려도 SW 가 ?v= 를 떼고
  // 옛 messenger.js 를 찾아 그걸 준다. 뒤에서 갱신은 하지만 그 화면은 이미 옛 코드다.
  //
  // 부장님이 b49 를 배포한 다음 날에도 b48 이전 화면을 보고 계셨다(AI 비서 줄이 없고,
  // 부서가 11개 다 보이는 9/19 이전 모양). 손으로 일곱 군데 버전을 올려 봐야
  // **여기서 다 버리고 있었다.** 고친 것이 사람에게 안 닿으면 안 고친 것이다.
  //
  // 이제: 그물에서 먼저 받고(그래야 배포가 다음 새로고침에 반드시 닿는다),
  // 실패하면 캐시로 떨어진다(비행기 모드에서 열리는 건 그대로 유지). 파일 몇 개뿐이라 싸다.
  // 바깥 것(SDK·폰트)은 버전이 주소에 박혀 있어 안 변하므로 캐시 먼저 그대로 둔다.
  if (같은출처) {
    e.respondWith(
      fetch(요청)
        .then((r) => { 넣기(요청, r.clone()); return r; })
        .catch(() => caches.match(요청, { ignoreSearch: true })
          .then((c) => c || caches.match('./messenger.html', { ignoreSearch: true })))
    );
    return;
  }

  // 바깥 출처(gstatic SDK·폰트): 주소에 버전이 박혀 있어 안 바뀐다 → 캐시 먼저
  e.respondWith(
    caches.match(요청).then((캐시됨) => 캐시됨 || fetch(요청)
      .then((r) => { 넣기(요청, r.clone()); return r; })
      .catch(() => 캐시됨))
  );
});

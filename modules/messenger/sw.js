/* SJ 메신저 서비스워커 — 설치 · 오프라인 재열림
 *
 * 규칙 하나: 여기서 건드리는 건 "모양이 변하지 않는 파일"뿐이다.
 *   - 같은 출처(sejong21c.com)의 정적 파일, gstatic 의 Firebase SDK → 캐시
 *   - Firestore/Auth(googleapis.com) → 손대지 않는다. 롱폴링 응답을 캐시하면 메시지가 멈춘다.
 *
 * 버전 문자열을 올리면 옛 캐시는 activate 때 전부 지운다. (messenger.html/.css/.js/lib.js 를 고치면 올릴 것)
 *   v1 W1 껍데기 · v2 W2 카톡식 UI(css/js/lib 분리) · v3 '친구'→'연락처' · v4 AI 비서 방(ai.js) · v5 AI 가 내 업무·일정도 본다 · v6 제공자 체인 실측 교체 · v7 lib·ai import 에 ?v=
 */
const 버전 = 'sj-msg-v11';
const 껍데기 = [
  './messenger.html',
  './messenger.css',
  './messenger.js',
  './lib.js',
  './ai.js',
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

  // 정적 파일: 같은 출처는 ?v= 캐시버스터를 무시하고 맞춘다(프리캐시는 쿼리 없이 들어 있다). 캐시 먼저 주고 뒤에서 갱신.
  e.respondWith(
    caches.match(요청, { ignoreSearch: 같은출처 }).then((캐시됨) => {
      const 네트 = fetch(요청)
        .then((r) => { 넣기(요청, r.clone()); return r; })
        .catch(() => 캐시됨);
      return 캐시됨 || 네트;
    })
  );
});

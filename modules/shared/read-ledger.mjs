// 새 창·홈 화면 앱으로 띄운 메신저의 읽기 계량기 — 2026-09-26 (b111).
//
// 왜: 9/23 실측 접속 813건 중 600건이 메신저였다. 그런데 계량기(index.html 의 잰다·읽기장부보내기)는
//   **플랫폼 창 안에만** 있어서, 메신저를 새 창이나 폰 홈 화면 앱으로 띄우면 그 읽기는 장부(readDaily)에
//   한 건도 안 올라갔다. 직원이 폰으로 쓰기 시작하면 장부는 대부분을 못 본다 — 조용히.
// 셈은 index.html 과 같다: 구독은 서버에서 온 docChanges 만(캐시 스냅숏 0), 한 번 조회는 1(결과 건수는 상한으로 따로).
//   날짜는 태평양(UTC-8 고정) — 한도가 그때 풀린다. 같은 칸(browser·browserOnceMax·sessions)에 더하고
//   제 몫은 msgApp·msgAppSessions 에 한 번 더 적는다(폰 앱이 얼마나 태우나를 가르려고).
// 감싸기는 frame-fs.mjs 틀붙이기가 한다 — 이 파일은 그 '부모' 노릇(잰다·한번읽기셈)과 보내기만.
// ponytail: index.html 에 같은 셈이 한 벌 더 있다(고전 스크립트라 import 를 못 한다). 셈 규칙을 바꾸면 둘 다 — test/read-ledger.test.mjs 가 칸 이름을 대조한다.

export function 한도날(지금 = Date.now()) { return new Date(지금 - 8 * 3600e3).toISOString().slice(0, 10); }

/** @param {{auth: object, db: object, setDoc: Function, doc: Function, increment: Function}} fb */
export function 계량기만들기(fb) {
  let 과금 = 0, 상한 = 0, 보낸과금 = 0, 보낸상한 = 0, 접속적음 = false;
  const 잰다 = (_이름, snap) => {
    if (!snap || (snap.metadata && snap.metadata.fromCache)) return;
    const n = snap.size != null ? snap.size : (snap.exists ? 1 : 0);
    try { 과금 += snap.docChanges ? snap.docChanges().length : n; } catch (e) { 과금 += n; }
  };
  const 한번읽기셈 = (a, b) => { 과금 += Number(a) || 0; 상한 += Number(b) || 0; };
  async function 보내기() {
    if (!fb.auth || !fb.auth.currentUser) return;
    const 델타 = 과금 - 보낸과금, 상한델타 = 상한 - 보낸상한, 첫 = !접속적음;
    if (델타 < 1 && 상한델타 < 1 && !첫) return;
    const 전 = [보낸과금, 보낸상한, 접속적음];
    보낸과금 = 과금; 보낸상한 = 상한; 접속적음 = true;   // await 전에 올린다 — 겹쳐 불려도 같은 몫을 두 번 안 보낸다
    const 날 = 한도날();
    try {
      await fb.setDoc(fb.doc(fb.db, 'readDaily', 날), {
        day: 날,
        ...(델타 > 0 ? { browser: fb.increment(델타), msgApp: fb.increment(델타) } : {}),
        ...(상한델타 > 0 ? { browserOnceMax: fb.increment(상한델타) } : {}),
        ...(첫 ? { sessions: fb.increment(1), msgAppSessions: fb.increment(1) } : {}),
        at: Date.now(),
      }, { merge: true });
    } catch (e) { [보낸과금, 보낸상한, 접속적음] = 전; }   // 못 보낸 몫만 다음 차례에 — 0 으로 되돌리면 보낸 것까지 두 번 센다
  }
  function 켜기(창 = globalThis) {
    setTimeout(보내기, 8000);          // 부팅 구독이 첫 스냅숏을 다 받은 뒤 — 하루 읽기의 대부분
    setInterval(보내기, 120000);
    // 폰에서는 pagehide 가 안 올 때가 많다 — 가려질 때가 마지막 기회다. 못 보내도 다음 접속의 8초가 채운다.
    창.addEventListener && 창.addEventListener('pagehide', () => { 보내기(); });
    창.document && 창.document.addEventListener('visibilitychange', () => { if (창.document.visibilityState === 'hidden') 보내기(); });
  }
  return { 잰다, 한번읽기셈, 보내기, 켜기, 셈: () => ({ 과금, 상한, 보낸과금, 보낸상한 }) };
}

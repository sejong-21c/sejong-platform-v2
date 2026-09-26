// 가려진 탭은 Firestore 연결을 쉰다 — 2026-09-26.
//
// 왜: 9/26 새벽 하루 읽기 한도(5만)가 08시 전에 찼다. 콘솔 실측(지난 24시간): 읽기 16만 · 새벽 2시대 한 시간 2.2만 ·
//   그 시간 쓰기 0 · 리스너 48개(플랫폼 탭 하나가 16개 → 탭 셋) · 규칙 평가 시간당 3~5천.
//   밤새 뒤에 숨어 있던 플랫폼 탭 셋(검증하고 안 닫은 것)이 연결을 끊었다 잇기를 되풀이하며 구독을 다시 걸었고,
//   그때마다 결과를 다시 받아 과금됐다. 브라우저 계량기(잰다)는 캐시와 다를 게 없으면 0 으로 센다 — 그래서 아무도 몰랐다.
//   직원 사무실 PC 에 탭이 밤새 켜져 있으면 똑같이 된다.
// 무엇: 탭이 **30분** 넘게 가려져 있으면 disableNetwork, 다시 보이면 enableNetwork. 30분인 까닭 — 뒤 탭의 제목
//   「(3) SJ 메신저」 가 안 읽음 수를 보여 주는데, 일하다 다른 탭을 잠깐 보는 동안엔 계속 갱신돼야 한다.
//   다시 보이면 한 번에 최신으로 맞춘다(30분 넘게 끊긴 구독은 전량을 한 번 다시 받는다 — 밤새 수십 번보다 싸다).
//   쓰기는 안 잃는다: 쉬는 동안의 쓰기는 기기에 쌓였다가 이을 때 올라간다(가려진 탭에서 쓸 일도 없다).

/**
 * @param {object} db  Firestore 인스턴스
 * @param {{disableNetwork: Function, enableNetwork: Function}} 함수들  firebase-firestore 의 두 함수
 * @param {{분?: number, 문서?: Document}} [선택]
 * @returns {() => void} 떼어 내기
 */
export function 가려지면쉬기(db, { disableNetwork, enableNetwork }, { 분 = 30, 문서 = globalThis.document } = {}) {
  if (!db || !문서 || typeof disableNetwork !== 'function') return () => {};
  let 타이머 = null, 쉼 = false;
  const 바뀜 = () => {
    if (문서.hidden) {
      if (!타이머 && !쉼) {
        타이머 = setTimeout(() => {
          타이머 = null;
          if (!문서.hidden) return;
          쉼 = true;
          Promise.resolve(disableNetwork(db)).catch(() => { 쉼 = false; });
        }, 분 * 60e3);
      }
    } else {
      if (타이머) { clearTimeout(타이머); 타이머 = null; }
      if (쉼) { 쉼 = false; Promise.resolve(enableNetwork(db)).catch(() => {}); }
    }
  };
  문서.addEventListener('visibilitychange', 바뀜);
  바뀜();
  return () => { 문서.removeEventListener('visibilitychange', 바뀜); if (타이머) clearTimeout(타이머); };
}

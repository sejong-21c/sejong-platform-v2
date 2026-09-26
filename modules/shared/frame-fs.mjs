// 도구 화면(iframe)의 Firestore — 가려지면 쉬고, 읽기를 부모(플랫폼)의 계량기로 센다. 2026-09-26.
//
// 왜: 9/26 새벽 하루 읽기 한도는 뒤에 숨은 플랫폼 탭 셋이 태웠다(콘솔: 읽기 16만 · 리스너 48). b110 은 본체·메신저만 쉬게 했는데,
//   NCR·CAR·품질 대시보드·모바일 검사·WBS 같은 도구 화면 16개는 **자기 Firestore 를 따로** 연다 — 도구를 연 채 탭을 밤새 두면
//   똑같이 태운다. 그리고 부모 계량기(잰다)는 이 화면들의 읽기를 한 번도 못 봤다(9/26 코드 훑기: iframe 은 전부 계량 밖).
// 무엇: ① quiet.mjs 로 30분 넘게 가려지면 연결을 쉰다 ② fb.onSnapshot 을 감싸 부모 잰다('틀:<화면>:<대상>') 로 센다
//   (캐시에서 온 스냅숏은 부모가 0 으로 친다) ③ fb.getDoc·getDocs 는 부모 한번읽기셈(과금 1 = 아래로 센 값, 결과 건수 = 상한).
//   부모가 없으면(주소로 직접 연 화면) ① 만 한다. 감싸기가 실패해도 원래 함수는 그대로 돈다 — 계량 때문에 화면을 막지 않는다.
import { 가려지면쉬기 } from './quiet.mjs?v=b110';

function 대상이름(ref) {
  try { return ref && (ref.path || ref.type) ? String(ref.path || ref.type) : '?'; } catch (e) { return '?'; }
}

/**
 * @param {object} db  이 화면의 Firestore 인스턴스
 * @param {object} fb  이 화면의 window.fb (onSnapshot·getDoc·getDocs 를 제자리에서 감싼다)
 * @param {string} 이름  계량기에 보일 화면 이름(ncr·car …)
 * @param {{disableNetwork?: Function, enableNetwork?: Function, 부모?: Window}} [선택]
 */
export function 틀붙이기(db, fb, 이름, { disableNetwork, enableNetwork, 부모: 준부모 } = {}) {
  if (typeof disableNetwork === 'function') 가려지면쉬기(db, { disableNetwork, enableNetwork });
  let 부모 = 준부모 || null;
  if (!부모) { try { if (window.parent && window.parent !== window && typeof window.parent.잰다 === 'function') 부모 = window.parent; } catch (e) { /* 다른 출처 */ } }
  if (!부모 || !fb) return;
  const 앞 = '틀:' + 이름 + ':';
  if (typeof fb.onSnapshot === 'function') {
    const 원래 = fb.onSnapshot;
    fb.onSnapshot = (ref, ...나머지) => {
      const 셈 = (snap) => { try { 부모.잰다(앞 + 대상이름(ref), snap); } catch (e) { /* 계량은 조용히 */ } };
      const i = 나머지.findIndex((x) => typeof x === 'function');   // (ref, next, error) · (ref, opts, next, error)
      if (i >= 0) { const 다음 = 나머지[i]; 나머지[i] = (snap) => { 셈(snap); return 다음(snap); }; }
      else if (나머지[0] && typeof 나머지[0] === 'object' && typeof 나머지[0].next === 'function') {
        const 관 = 나머지[0]; 나머지[0] = { ...관, next: (snap) => { 셈(snap); return 관.next(snap); } };
      }
      return 원래(ref, ...나머지);
    };
  }
  const 한번 = (s, 상한) => {
    try { if (!(s && s.metadata && s.metadata.fromCache) && typeof 부모.한번읽기셈 === 'function') 부모.한번읽기셈(1, 상한); } catch (e) { /* 조용히 */ }
    return s;
  };
  if (typeof fb.getDocs === 'function') { const g = fb.getDocs; fb.getDocs = (...a) => g(...a).then((s) => 한번(s, Math.max(1, (s && s.size) || 0))); }
  if (typeof fb.getDoc === 'function') { const g = fb.getDoc; fb.getDoc = (...a) => g(...a).then((s) => 한번(s, 1)); }
}

/* 에뮬레이터 스위치 — 내 PC 안의 가짜 Firestore 로 갈아 끼운다 (2026-09-23).
 *
 * 왜 만들었나. **시험할 때마다 회사 하루 읽기 한도를 태우고 있었다.**
 *   배포하고 화면을 확인하려면 캐시를 지우고 다시 여는데, 한 번에 2,000건쯤 나간다.
 *   스무 번이면 4만이다 — 9/18·19·20 과 9/23 이 전부 그렇게 터졌고, 그날은 직원들이
 *   옛 자료를 보게 된다. 그리고 더 나쁜 건, **쓰는 기능을 만들고도 못 눌러 보는 것**이다.
 *   9/23 에 AI 행위 여섯 개를 만들고 라이브 확인을 못 한 채 넘겼다.
 *
 * 그래서: 내 PC 에서만 가짜 Firestore 를 보게 한다. 읽기·쓰기 무제한, 회사 자료는 안 건드린다.
 *
 * ⚠ **운영에서는 절대 켜지지 않는다.** 주소창에 ?emu=1 을 붙여도 소용없다 —
 *   호스트 이름이 localhost 일 때만 본다. 질의만 보고 판단하면 누가 링크를 돌렸을 때
 *   sejong21c.com 이 빈 화면이 된다(그리고 왜 그런지 아무도 모른다).
 *
 * 쓰는 법: `npm run emu` → http://localhost:5000/?emu=1
 * 못 하는 것: **게이트웨이(AI 답변)는 안 붙는다.** 워커가 진짜 Firebase 토큰을 검사하는데
 *   에뮬레이터 토큰은 서명이 가짜라 거부된다. 그게 맞다 — 워커를 약하게 만들 이유가 없다.
 *   화면·자료·권한·쓰기를 시험하는 자리고, AI 답변 품질은 실물에서 본다.
 */

const 집 = /^(localhost|127\.0\.0\.1|\[::1\])$/;
export const 에뮬포트 = { firestore: 8181, auth: 9099, 정적: 5000 };

/** 지금 에뮬레이터로 가야 하나. 내 PC + ?emu=1 **둘 다** 맞을 때만. */
export function 에뮬레이터인가() {
  try {
    if (!집.test(location.hostname)) return false;                 // ← 이 줄이 운영을 지킨다
    return new URLSearchParams(location.search).get('emu') === '1';
  } catch (e) { return false; }
}

/** db·auth 를 에뮬레이터에 붙인다. 켜졌으면 true.
 *  connectXEmulator 는 **첫 요청 전에** 불러야 한다 — 그래서 초기화 바로 다음 줄에서 부른다. */
export function 에뮬붙이기({ db, auth, connectFirestoreEmulator, connectAuthEmulator }) {
  if (!에뮬레이터인가()) return false;
  if (db && connectFirestoreEmulator) connectFirestoreEmulator(db, '127.0.0.1', 에뮬포트.firestore);
  if (auth && connectAuthEmulator) connectAuthEmulator(auth, `http://127.0.0.1:${에뮬포트.auth}`, { disableWarnings: true });
  경고띠();
  return true;
}

/** 화면 맨 위에 띠를 하나 붙인다. **어느 자료를 보고 있는지 헷갈리면 안 된다** —
 *  가짜 자료를 보고 "고쳐졌다" 고 보고하는 것이 제일 나쁘다. */
function 경고띠() {
  try {
    if (document.getElementById('emu-band')) return;
    const 달기 = () => {
      if (document.getElementById('emu-band')) return;
      const el = document.createElement('div');
      el.id = 'emu-band';
      el.textContent = '🧪 시험용 가짜 자료(에뮬레이터) — 회사 자료가 아닙니다';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
        + 'background:#7c3aed;color:#fff;font:600 12px/1.6 system-ui,sans-serif;'
        + 'text-align:center;padding:3px 8px;pointer-events:none;letter-spacing:.02em';
      document.body.appendChild(el);
    };
    if (document.body) 달기(); else document.addEventListener('DOMContentLoaded', 달기);
  } catch (e) { /* 띠는 못 붙여도 붙는 것 자체는 막지 않는다 */ }
}

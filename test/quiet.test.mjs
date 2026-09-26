// shared/quiet.mjs — 가려진 탭은 Firestore 연결을 쉰다(b110, 2026-09-26: 밤새 켜 둔 탭 셋이 하루 읽기 한도를 태웠다).
import assert from 'node:assert';
import { 가려지면쉬기 } from '../modules/shared/quiet.mjs';

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
function 가짜문서() {
  const 듣는 = new Set();
  return { hidden: false, addEventListener: (e, f) => 듣는.add(f), removeEventListener: (e, f) => 듣는.delete(f), 바꾸기(h) { this.hidden = h; 듣는.forEach((f) => f()); }, 듣는 };
}
const 분 = 0.001;   // 60ms
let 끔 = 0, 켬 = 0;
const 함수 = { disableNetwork: async () => { 끔++; }, enableNetwork: async () => { 켬++; } };

// 1) 잠깐 가렸다 돌아오면 아무것도 안 한다(제목의 안 읽음 수가 계속 갱신돼야 한다)
let 문서 = 가짜문서();
let 떼기 = 가려지면쉬기({}, 함수, { 분, 문서 });
문서.바꾸기(true); await 잠깐(20); 문서.바꾸기(false); await 잠깐(80);
assert.strictEqual(끔, 0, '잠깐 가린 탭은 연결을 안 끊는다');

// 2) 오래 가리면 끊고, 돌아오면 잇는다
문서.바꾸기(true); await 잠깐(100);
assert.strictEqual(끔, 1, '오래 가리면 연결을 쉰다');
문서.바꾸기(true); await 잠깐(100);
assert.strictEqual(끔, 1, '쉬는 중에 또 가려짐 신호가 와도 두 번 끊지 않는다');
문서.바꾸기(false); await 잠깐(5);
assert.strictEqual(켬, 1, '다시 보이면 잇는다');
문서.바꾸기(false); await 잠깐(5);
assert.strictEqual(켬, 1, '이미 이었으면 또 잇지 않는다');

// 3) 떼어 내면 더 안 듣는다
떼기();
assert.strictEqual(문서.듣는.size, 0, '떼면 듣기를 멈춘다');

// 4) 처음부터 가려진 채 열린 탭(뒤에서 연 새 탭)도 오래면 쉰다
문서 = 가짜문서(); 문서.hidden = true;
가려지면쉬기({}, 함수, { 분, 문서 });
await 잠깐(100);
assert.strictEqual(끔, 2, '가려진 채 열린 탭도 쉰다');

// 5) db·함수가 없으면 조용히 아무것도 안 한다(에뮬·옛 SDK)
assert.doesNotThrow(() => 가려지면쉬기(null, 함수, { 문서: 가짜문서() })());
assert.doesNotThrow(() => 가려지면쉬기({}, {}, { 문서: 가짜문서() })());
console.log('quiet 테스트 7개 전체 통과 (잠깐 가림 무시 · 오래 가리면 쉼 · 두 번 안 끊음 · 돌아오면 이음 · 떼기 · 가려진 채 열림 · 없으면 조용히)');

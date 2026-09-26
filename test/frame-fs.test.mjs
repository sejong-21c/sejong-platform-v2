// shared/frame-fs.mjs — 도구 화면(iframe) 16개가 가려지면 쉬고, 읽기를 부모 계량기로 센다(2026-09-26).
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 틀붙이기 } from '../modules/shared/frame-fs.mjs';

// ① 감싸기 — 부모 잰다·한번읽기셈으로 센다, 원래 콜백·결과는 그대로
const 셈 = { 잰: [], 한번: [] };
const 부모 = { 잰다: (이름, snap) => 셈.잰.push([이름, snap.size]), 한번읽기셈: (a, b) => 셈.한번.push([a, b]) };
let 받은 = null;
const fb = {
  onSnapshot: (ref, next, err) => { (typeof next === 'function' ? next : next.next)({ size: 3, metadata: { fromCache: false } }); return () => 'unsub'; },
  getDocs: async () => ({ size: 7, metadata: { fromCache: false } }),
  getDoc: async () => ({ exists: () => true, metadata: { fromCache: true } }),
};
틀붙이기({}, fb, 'ncr', { 부모 });
const 떼기 = fb.onSnapshot({ path: 't_ncrs' }, (s) => { 받은 = s.size; }, () => {});
assert.strictEqual(받은, 3, '원래 콜백은 그대로 받는다');
assert.strictEqual(떼기(), 'unsub', '구독 떼기 함수를 그대로 돌려준다');
assert.deepStrictEqual(셈.잰[0], ['틀:ncr:t_ncrs', 3], '구독은 부모 잰다로 화면·대상 이름을 붙여 센다');
const 받은docs = await fb.getDocs();
assert.strictEqual(받은docs.size, 7, 'getDocs 결과는 그대로');
assert.deepStrictEqual(셈.한번[0], [1, 7], '한 번 조회는 과금 1 · 상한 7');
await fb.getDoc();
assert.strictEqual(셈.한번.length, 1, '캐시에서 온 getDoc 은 안 센다');
// { next } 꼴도
fb.onSnapshot({ path: 'x' }, { next: () => {} });
// 부모가 없으면 감싸지 않는다
const fb2 = { onSnapshot: () => 'raw' }; const 원래 = fb2.onSnapshot;
틀붙이기({}, fb2, 'x', {});
assert.strictEqual(fb2.onSnapshot, 원래, '부모가 없으면(주소로 직접 연 화면) 손대지 않는다');

// ② 불변식 — 자기 Firestore 를 여는 도구 화면은 전부 틀붙이기를 부른다(pvcalc 는 원본 저장소 규칙으로 뺀다 · 메신저는 quiet 를 직접 쓴다)
const 뿌리 = new URL('../modules/', import.meta.url);
const 파일들 = [];
const 걷기 = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) 걷기(p); else if (n.endsWith('.html')) 파일들.push(p); } };
걷기(fileURLToPath(뿌리));
const 연다 = 파일들.filter((p) => /initializeFirestore\(|getFirestore\(/.test(readFileSync(p, 'utf8')));
const 빠진 = 연다.filter((p) => !/틀붙이기\(window\.fb\.db, window\.fb, '/.test(readFileSync(p, 'utf8')));
assert.ok(연다.length >= 16, '도구 화면을 찾았다: ' + 연다.length);
assert.deepStrictEqual(빠진, [], '자기 Firestore 를 여는 도구 화면은 틀붙이기를 불러야 한다(새 화면을 만들면 여기서 걸린다)');
console.log(`frame-fs 테스트 전체 통과 (감싸기 7 · 도구 화면 ${연다.length}개 모두 틀붙이기)`);

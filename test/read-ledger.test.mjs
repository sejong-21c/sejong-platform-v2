// shared/read-ledger.mjs — 새 창·홈 화면 앱 메신저의 읽기 계량기(b111, 2026-09-26).
//   9/23 접속 813건 중 600건이 메신저였는데 계량기는 플랫폼 창 안에만 있었다. 틀어져도 화면은 멀쩡해서 **조용히** 장부만 비운다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { 계량기만들기, 한도날 } from '../modules/shared/read-ledger.mjs';
import { 틀붙이기 } from '../modules/shared/frame-fs.mjs';

// ① 날짜는 태평양 고정(UTC-8) — 한국 17시에 넘어간다
assert.strictEqual(한도날(Date.UTC(2026, 8, 26, 7, 59)), '2026-09-25');
assert.strictEqual(한도날(Date.UTC(2026, 8, 26, 8, 0)), '2026-09-26');

// ② 셈 — 캐시 스냅숏은 0 · 서버 스냅숏은 docChanges · 한 번 조회는 과금 1 + 상한
const 쓴 = []; let 실패시킴 = false;
const fb = {
  auth: { currentUser: null }, db: {},
  doc: (_db, col, id) => col + '/' + id,
  increment: (n) => ({ inc: n }),
  setDoc: async (ref, data) => { if (실패시킴) throw new Error('quota'); 쓴.push([ref, data]); },
};
const 계량기 = 계량기만들기(fb);
계량기.잰다('x', { size: 50, metadata: { fromCache: true }, docChanges: () => new Array(50) });
계량기.잰다('x', { size: 50, metadata: { fromCache: false }, docChanges: () => new Array(3) });
계량기.잰다('d', { exists: true, metadata: { fromCache: false } });
계량기.한번읽기셈(1, 7);
assert.deepStrictEqual(계량기.셈(), { 과금: 5, 상한: 7, 보낸과금: 0, 보낸상한: 0 }, '캐시 50 은 0 · 서버 3 + 문서 1 + 한 번 조회 1');

// ③ 보내기 — 로그인 전엔 안 쓴다 · 첫 번엔 접속 한 줄 · 같은 칸 + 제 몫(msgApp)
await 계량기.보내기();
assert.strictEqual(쓴.length, 0, '로그인 전엔 안 쓴다');
fb.auth.currentUser = { uid: 'u1' };
await 계량기.보내기();
const [ref, d] = 쓴[0];
assert.strictEqual(ref, 'readDaily/' + 한도날());
assert.deepStrictEqual([d.browser, d.msgApp, d.browserOnceMax, d.sessions, d.msgAppSessions], [{ inc: 5 }, { inc: 5 }, { inc: 7 }, { inc: 1 }, { inc: 1 }]);
await 계량기.보내기();
assert.strictEqual(쓴.length, 1, '더 센 게 없으면 안 쓴다(쓰기 한도 2만)');

// ④ 실패하면 못 보낸 몫만 다음에 — 옛 index.html 은 0 으로 되돌려 보낸 것까지 두 번 셌다
계량기.한번읽기셈(1, 2);
실패시킴 = true; await 계량기.보내기(); 실패시킴 = false;
await 계량기.보내기();
assert.deepStrictEqual([쓴[1][1].browser, 쓴[1][1].browserOnceMax, 쓴[1][1].sessions], [{ inc: 1 }, { inc: 2 }, undefined], '실패 뒤엔 그 몫(1·2)만 · 접속은 다시 안 센다');

// ⑤ 틀붙이기의 부모로 — 감싼 구독·조회가 계량기로 간다
const 계2 = 계량기만들기(fb);
const 앱fb = { onSnapshot: (ref, next) => { next({ size: 4, metadata: { fromCache: false }, docChanges: () => new Array(4) }); return () => {}; }, getDocs: async () => ({ size: 9, metadata: { fromCache: false } }) };
틀붙이기({}, 앱fb, '메신저', { 부모: 계2 });
앱fb.onSnapshot({ path: 'messages' }, () => {});
await 앱fb.getDocs();
assert.deepStrictEqual(계2.셈(), { 과금: 5, 상한: 9, 보낸과금: 0, 보낸상한: 0 }, '구독 4 + 한 번 조회 1 · 상한 9');

// ⑥ 불변식 — 메신저는 독립 실행일 때만 붙이고, window.잰다 는 안 만든다(방 구독이 부르는 window.parent.잰다 와 두 번 센다)
// 줄바꿈은 LF 로 맞춰 읽는다 — core.autocrlf 작업 사본(CRLF)에서는 아래 '\n' 정규식이 안 맞아 멀쩡한 코드를 틀렸다고 했다(9/26 통합 때).
const 읽기 = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const 앱 = 읽기('../modules/messenger/messenger.js');
const 블록 = (앱.match(/if \(window\.parent === window\) \{\n  const 계량기 = 계량기만들기[\s\S]*?\n\}/) || [''])[0];
assert.ok(블록.includes("틀붙이기(fbDb, window.fb, '메신저', { 부모: 계량기 })") && 블록.includes('계량기.켜기(window)'), '독립 실행 메신저는 계량기를 부모로 틀붙이기 하고 켠다');
assert.ok(!/window\.잰다\s*=/.test(앱), 'messenger.js 는 window.잰다 를 만들지 않는다');

// ⑦ 두 벌 대조 — index.html 의 셈과 칸 이름·날짜 규칙이 같아야 한 장부에 더해진다
const 본체 = 읽기('../index.html');
const 보내기 = (본체.match(/async function 읽기장부보내기\(\) \{[\s\S]*?\n\}/) || [''])[0];
for (const 칸 of ['browser: fb.increment(델타)', 'browserOnceMax: fb.increment(상한델타)', 'sessions: fb.increment(1)']) assert.ok(보내기.includes(칸), 'index.html 장부 칸: ' + 칸);
assert.ok(본체.includes("function 한도날() { return new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10); }"), 'index.html 한도날도 UTC-8 고정');
assert.ok(!/_보낸읽기 = 0;/.test(보내기) && 보내기.includes('[_보낸읽기, _보낸상한, _접속적음] = 전'), 'index.html 도 실패하면 못 보낸 몫만 되돌린다');
console.log('read-ledger 테스트 전체 통과 (태평양 날짜 · 캐시 0 · 한 번 조회 · 첫 접속 · 실패 몫 · 틀붙이기 부모 · 메신저 독립 실행 · index.html 대조)');

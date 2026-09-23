/* 에뮬레이터 배선 검사 (2026-09-23).
 *
 * 지키는 것 둘. 둘 다 **어기면 조용히 사고가 난다.**
 *   ① 파이어베이스를 새로 여는 자리가 생기면 **거기도 에뮬레이터를 물려야 한다.**
 *      안 물리면 그 화면만 몰래 **진짜 회사 Firestore** 를 본다 — 시험한다고 누른 「실행」이
 *      회사 자료를 바꾼다. 지금은 세 곳이다(index.html · wbs.html · messenger.js).
 *   ② 스위치는 **호스트 이름으로** 막혀 있어야 한다. 질의(?emu=1)만 보면, 누가 그 링크를
 *      사내에 돌렸을 때 sejong21c.com 이 빈 화면이 된다(그리고 왜 그런지 아무도 모른다).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const 읽기 = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let n = 0;
const T = (why, fn) => { fn(); n++; console.log('PASS  ' + why); };

// ── ① 파이어베이스를 여는 자리 = 에뮬레이터를 무는 자리 ─────────────────────
const 여는곳 = ['index.html', 'modules/projects/wbs.html', 'modules/projects/wbs-share.html',
  'modules/messenger/messenger.js'];
// 공유 링크 화면은 **로그인 없이** 본다 — auth 가 아예 없다. 그 한 곳만 예외로 둔다.
const auth없는곳 = new Set(['modules/projects/wbs-share.html']);

T('파이어베이스를 여는 자리가 넷 그대로다 — 늘었으면 여기부터 고친다', () => {
  const 전체 = ['index.html', 'modules/projects/wbs.html', 'modules/projects/wbs-share.html',
    'modules/messenger/messenger.js', 'modules/messenger/messenger.html'];
  const 실제 = 전체.filter((p) => /initializeApp\s*\(/.test(읽기(p)));
  assert.deepEqual(실제.sort(), [...여는곳].sort(),
    '파이어베이스를 새로 여는 파일이 바뀌었다. 새 자리에도 에뮬붙이기() 를 물려라 — '
    + '안 물리면 그 화면만 진짜 회사 Firestore 를 본다. 지금: ' + 실제.join(', '));
});

for (const p of 여는곳) {
  T(`${p} — 에뮬붙이기를 부른다`, () => {
    const s = 읽기(p);
    assert.ok(/import\s*\{\s*에뮬붙이기\s*\}\s*from\s*['"][^'"]*emu\.mjs\?v=b\d+['"]/.test(s), p + ' 에 emu.mjs import 가 없다(?v= 도 있어야 한다)');
    assert.ok(/에뮬붙이기\s*\(/.test(s), p + ' 에서 에뮬붙이기() 를 안 부른다');
    assert.ok(/connectFirestoreEmulator/.test(s), p + ' 가 connectFirestoreEmulator 를 안 가져온다');
    if (!auth없는곳.has(p)) assert.ok(/connectAuthEmulator/.test(s), p + ' 가 connectAuthEmulator 를 안 가져온다');
  });
}

// ── ② 운영을 지키는 줄 ────────────────────────────────────────────────────
T('스위치가 호스트 이름으로 막혀 있다 — 운영에서는 ?emu=1 이 안 먹는다', () => {
  const s = 읽기('modules/shared/emu.mjs');
  assert.ok(/localhost/.test(s) && /127\\?\.0\\?\.0\\?\.1/.test(s), 'localhost·127.0.0.1 판정이 없다');
  // 호스트 검사가 **질의 검사보다 먼저** 있어야 한다(먼저 return false 로 빠져나가야 한다).
  const 호스트 = s.indexOf('location.hostname');
  const 질의 = s.indexOf("get('emu')");
  assert.ok(호스트 > 0 && 질의 > 호스트, '호스트 검사가 질의 검사보다 앞에 있어야 한다');
});

T('붙는 자리는 127.0.0.1 뿐이다 — 밖으로 나가지 않는다', () => {
  const s = 읽기('modules/shared/emu.mjs');
  for (const m of s.match(/connect\w+Emulator\([^)]*\)/g) || []) {
    assert.ok(/'127\.0\.0\.1'|127\.0\.0\.1:/.test(m), '에뮬레이터 주소가 127.0.0.1 이 아니다: ' + m);
  }
});

T('심는 자는 에뮬레이터 주소가 아니면 한 글자도 안 쓴다', () => {
  const s = 읽기('test/seed-emulator.mjs');
  assert.ok(/127\.0\.0\.1/.test(s) && /throw new Error\('에뮬레이터 주소가 아니다/.test(s),
    '안전 고리가 없다 — 실수로 운영에 심으면 되돌릴 수가 없다');
  assert.ok(!/sejong21c\.com|firestore\.googleapis\.com/.test(s), '심는 자가 바깥 주소를 들고 있다');
});

console.log(`\nemu-wiring 테스트 ${n}개 전체 통과`);

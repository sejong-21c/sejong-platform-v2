// 메신저 영수증 → 경비 내역서 길 검사 — 브라우저 없이.  node test/expense-receipt.test.mjs
//
// 왜 (2026-09-26 직원 시범 전 대조): 이 길에 시험이 0건이었다. 그사이
//   ① 「경비 내역서에 올리기」 를 두 번 누르면 두 건이 생겼고(무작위 id · 올렸다는 표시 없음)
//   ② 마감 검사가 거래일시가 'YYYY-MM' 꼴일 때만 돌았고(맥은 그 꼴을 부탁만 한다)
//   ③ 메신저가 마감 한 칸을 보려고 카드 목록이 든 t_expense/main 을 통째로 읽고 있었다.
// 함수는 messenger.js·expense.html 에서 그대로 떼어 와 돌린다(boot-reads.test.mjs 와 같은 방식).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const 앱 = readFileSync(new URL('../modules/messenger/messenger.js', import.meta.url), 'utf8');
const 경비화면 = readFileSync(new URL('../modules/expense/expense.html', import.meta.url), 'utf8');

let 통과 = 0, 실패 = 0;
const T = async (이름, 하기) => {
  try { await 하기(); 통과++; console.log(`PASS  ${이름}`); }
  catch (e) { 실패++; console.log(`FAIL  ${이름}\n        ${String(e && e.message || e).slice(0, 200)}`); }
};
const 떼기 = (소스, 머리) => {
  const i = 소스.indexOf(머리);
  if (i < 0) return '';
  const j = 소스.indexOf('\n}', i);
  return j < 0 ? '' : 소스.slice(i, j + 2);
};

// ── ② 날짜 맞추기 ──────────────────────────────────────────────────────
const 날짜소스 = 떼기(앱, 'function 영수증날짜(');
await T('영수증날짜() 를 떼어 올 수 있다 — 못 떼면 아래가 통째로 헛돈다', () => assert.ok(날짜소스.includes('match('), '영수증날짜 없음'));
const 날짜함수 = 날짜소스 ? new Function(날짜소스 + '\nreturn 영수증날짜;')() : () => 'x';
const 오늘 = Date.UTC(2026, 8, 26);   // 400일 창을 고정한다 — 해가 바뀌어도 시험이 안 썩게
const 영수증날짜 = (s) => 날짜함수(s, 오늘);
for (const [넣음, 기대] of [
  // 9/26 검토: 숫자 경계를 안 보던 때 그럴듯하게 **틀린** 날이 나오던 꼴 — 이제 '' 여야 한다
  ['10/05/2026 14:30', ''],            // 예전 2010-05-20
  ['26/09/2026', ''],                  // 예전 2026-09-20
  ['05.10.2026', ''],                  // 예전 2005-10-20 — 마감 검사가 2005-10 을 봤다
  ['26/09 14:30', ''],                 // 예전 2026-09-14 (해 없음 → 시각을 일로 읽음)
  ['15.09.26', ''],                    // 일.월.해 → 2015-09-26 → 400일 창 밖
  ['2010-05-20', ''],
  ['2026. 9. 26.', '2026-09-26'],
  ['260926', '2026-09-26'],
  ['2026-09-26 14:30', '2026-09-26'],
  ['2026/9/3', '2026-09-03'],
  ['26.09.26', '2026-09-26'],          // 두 자리 해 → 20xx
  ['20260926 1430', '2026-09-26'],
  ['2026년 9월 26일 14:30', '2026-09-26'],
  ['2026-13-01', ''],                  // 달이 없는 달
  ['2026-09-32', ''],
  ['2026-00-10', ''],
  ['', ''],
  [null, ''],
  ['시각 모름', ''],
]) {
  await T(`날짜 ${JSON.stringify(넣음)} → ${JSON.stringify(기대)}`, () => assert.strictEqual(영수증날짜(넣음), 기대));
}

// ── ① 두 번 올리기 ─────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const 달기소스 = 떼기(앱, 'function 영수증달기(m) {') + '\n' + 떼기(앱, 'function 영수증버튼(m) {');
const 영수증달기 = new Function('esc', 달기소스 + '\nreturn 영수증달기;')(esc);
await T('안 올린 영수증에는 올리기 버튼이 있다', () =>
  assert.ok(영수증달기({ id: 'a1', 영수증: { 금액: { 총금액: 1000 } } }).includes('data-act="reg-task"')));
await T('**올린 영수증에는 버튼 대신 「올림 ✓」** — 다시 열어도 또 못 누른다', () => {
  const h = 영수증달기({ id: 'a1', 영수증: { 금액: { 총금액: 1000 }, 올림: { id: 'M_a1', 때: 1 } } });
  assert.ok(!h.includes('reg-task'), '버튼이 남아 있다');
  assert.ok(h.includes('올림 ✓'), '올림 표시가 없다');
});
await T('후보가 여럿이어도 하나 올리면 버튼이 다 사라진다', () =>
  assert.ok(!영수증달기({ id: 'a2', 영수증: { 금액후보: [{ 총금액: 1 }, { 총금액: 2 }], 올림: { id: 'M_a2_0', 때: 1 } } }).includes('reg-task')));
await T('바꿔 끼울 칸(sjm-rcpt-go)이 버튼 칸에 붙어 있다', () =>
  assert.ok(영수증달기({ id: 'a1', 영수증: { 금액: { 총금액: 1 } } }).includes('sjm-rcpt-go')));

const 등록소스 = 떼기(앱, 'async function 경비로등록(');
await T('경비로등록: id 가 메시지에 묶인다(무작위 id 금지)', () => {
  assert.ok(등록소스.includes("'M_' + m.id"), 'M_<메시지id> 가 아니다');
  assert.ok(!/Math\.random/.test(등록소스), '무작위 id 가 남아 있다');
});
await T('경비로등록: 누르는 동안 다시 못 누른다', () => assert.ok(/올리는중\.has\(m\.id\)/.test(등록소스)));
await T('경비로등록: 올린 뒤 메시지에 올림 표시를 남긴다', () => assert.ok(/영수증: \{ 올림/.test(등록소스)));
// 거부 길을 가짜 저장소로 실제로 돌린다. 9/26 검토: 거부를 전부 「이미 올림」 으로 알렸다 —
//   다른 탭에서 로그아웃해도 그렇게 떠서, 저장 안 된 영수증을 올렸다고 믿고 멈췄다.
const 거부돌리기 = async (있나) => {
  const 토스트들 = [], 쓴것 = [];
  const 거부 = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const fb = {
    db: {}, doc: (db, c, d) => c + '/' + d,
    getDoc: async (경로) => {
      if (경로 === 't_expense/lock') return { exists: () => false, data: () => ({}) };
      if (있나 === '거부') throw 거부();                       // 로그아웃: 읽기도 거부
      return { exists: () => 있나 };
    },
    setDoc: async (경로, 값) => { if (경로.startsWith('t_expenseEntries/')) throw 거부(); 쓴것.push([경로, 값]); },
  };
  const m = { id: 'a9', 영수증: { 금액: { 총금액: 1000 }, 거래일시: '2026-09-26' } };
  const f = new Function('getFB', '토스트', '영수증날짜', 'userMap', 'me', 'plain', '$', 'CSS', 'renderMessages', '영수증버튼', 'AI_컬렉션', '올리는중',
    등록소스 + '\nreturn 경비로등록;')(() => fb, (t) => 토스트들.push(t), () => '2026-09-26', new Map(), () => 'u1', (o) => o,
    () => null, { escape: String }, () => {}, () => '', 't_aiChat', new Set());
  const 원래 = console.error; console.error = () => {};   // 일부러 낸 거부 — 출력만 막는다
  try { await f(m, null, null); } finally { console.error = 원래; }
  return { 토스트: 토스트들.join(' | '), 올림: m.영수증.올림, 쓴것 };
};
await T('**거부 + 문서 없음(로그아웃 등)이면 「이미 올림」 이라 하지 않고 올림 표시도 안 남긴다**', async () => {
  for (const 있나 of ['거부', false]) {
    const r = await 거부돌리기(있나);
    assert.ok(!r.토스트.includes('이미 올린'), `거짓 「이미 올림」: ${r.토스트}`);
    assert.ok(r.토스트.includes('올리지 못했습니다'), `실패 안내 없음: ${r.토스트}`);
    assert.ok(!r.올림 && r.쓴것.length === 0, '저장 안 됐는데 올림 표시를 남겼다');
  }
});
await T('거부 + 제 문서가 정말 있으면 「이미 올린 영수증」 · 올림 표시를 남긴다', async () => {
  const r = await 거부돌리기(true);
  assert.ok(r.토스트.includes('이미 올린 영수증'), r.토스트);
  assert.strictEqual(r.올림 && r.올림.id, 'M_a9');
  assert.ok(r.쓴것.some(([경로, 값]) => 경로 === 't_aiChat/a9' && 값.영수증.올림), '메시지에 올림 표시를 안 썼다');
});
// 재무부·임원은 update 가 허용된다 — 두 번째 누름이 재무부가 고친 내역을 덮으면 안 된다(9/26 남은 것).
await T('**재무부가 또 눌러도 이미 있는 내역을 덮지 않는다** · 금액 후보를 골라도 id 는 M_<메시지id> 하나', async () => {
  const 쓴것 = [], 토스트들 = [];
  const fb = { db: {}, doc: (db, c, d) => c + '/' + d,
    getDoc: async (경로) => (경로 === 't_expense/lock' ? { exists: () => false, data: () => ({}) } : { exists: () => true }),
    setDoc: async (경로, 값) => { 쓴것.push([경로, 값]); } };            // 재무부: 규칙이 무엇이든 받아 준다
  const m = { id: 'a9', 영수증: { 금액후보: [{ 총금액: 1000 }, { 총금액: 2000 }], 거래일시: '2026-09-26' } };
  const f = new Function('getFB', '토스트', '영수증날짜', 'userMap', 'me', 'plain', '$', 'CSS', 'renderMessages', '영수증버튼', 'AI_컬렉션', '올리는중',
    등록소스 + '\nreturn 경비로등록;')(() => fb, (t) => 토스트들.push(t), () => '2026-09-26', new Map(), () => 'u1', (o) => o,
    () => null, { escape: String }, () => {}, () => '', 't_aiChat', new Set());
  await f(m, 1, null);
  assert.ok(!쓴것.some(([경로]) => 경로.startsWith('t_expenseEntries/')), '있는 내역을 또 썼다: ' + JSON.stringify(쓴것.map((x) => x[0])));
  assert.ok(토스트들.join(' ').includes('이미 올린 영수증'), 토스트들.join(' | '));
  assert.strictEqual(m.영수증.올림 && m.영수증.올림.id, 'M_a9', '후보를 골랐는데 id 가 M_a9 가 아니다');
});
await T('경비로등록: 사용 내역 앞에 올린 사람 이름', () => assert.ok(/usage: \[이름, r\.덧말 \|\| r\.상호\]/.test(등록소스)));
await T('경비로등록: 날짜를 맞춘 뒤 검사하고, 못 읽으면 메모에 남긴다', () => {
  assert.ok(/const 날 = 영수증날짜\(r\.거래일시\)/.test(등록소스));
  assert.ok(등록소스.includes('날짜 못 읽음'));
});

// ── ③ 마감은 lock 만 본다 ───────────────────────────────────────────────
await T("**메신저는 t_expense/main 을 읽지 않는다** — 카드 목록은 재무부만(firestore.rules)", () => {
  assert.ok(!/'t_expense',\s*'main'/.test(앱), 'main 을 읽는 곳이 남아 있다');
  assert.ok(/'t_expense',\s*'lock'/.test(등록소스), '마감을 lock 에서 보지 않는다');
});

const 잠금소스 = 떼기(경비화면, 'async function 잠금맞추기(먼저읽기) {');
await T('잠금맞추기() 를 떼어 올 수 있다', () => assert.ok(잠금소스.includes('lock')));
await T('마감·풀기·열기 세 곳이 lock 을 맞춘다', () => {
  assert.ok(/function 달마감[\s\S]*?잠금맞추기\(false\)[\s\S]*?\n\}/.test(경비화면), '달마감');
  assert.ok(/function 마감풀기[\s\S]*?잠금맞추기\(false\)[\s\S]*?\n\}/.test(경비화면), '마감풀기');
  assert.ok(/async function 경비불러오기[\s\S]*?잠금맞추기\(true\)/.test(경비화면), '열 때');
});
// 가짜 저장소로 돌린다 — 쓰인 것을 모은다.
const 돌리기 = async (마감, 서버lock, 먼저읽기, 멈춤 = false) => {
  const 쓴것 = [];
  const fb = {
    db: {}, doc: (db, c, d) => c + '/' + d,
    getDoc: async () => ({ exists: () => !!서버lock, data: () => 서버lock }),
    setDoc: async (경로, 값) => { 쓴것.push([경로, 값]); },
  };
  const f = new Function('부모fb', 'DATA', '경비칸', 'window', '_멈춤', 잠금소스 + '\nreturn 잠금맞추기;')(() => fb, { 마감 }, 't_expense', {}, 멈춤);
  await f(먼저읽기);
  return 쓴것;
};
await T('마감한 달만 때만 담아 lock 에 쓴다(이름·푼기록은 안 나간다)', async () => {
  const w = await 돌리기({ '2026-08': { 때: 5, 누가: '재무 담당', 푼기록: [{ 왜: 'x' }] }, '2026-07': { 때: null, 누가: '' } }, null, false);
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0][0], 't_expense/lock');
  assert.deepStrictEqual(w[0][1].마감, { '2026-08': { 때: 5 } });
});
await T('열 때: lock 이 같으면 안 쓴다(쓰기 0)', async () => {
  assert.strictEqual((await 돌리기({ '2026-08': { 때: 5 } }, { 마감: { '2026-08': { 때: 5 } } }, true)).length, 0);
});
await T('**열 때: 예전에 마감한 달이 lock 에 없으면 채운다** — 스스로 낫는다', async () => {
  const w = await 돌리기({ '2026-08': { 때: 5 } }, null, true);
  assert.deepStrictEqual(w[0][1].마감, { '2026-08': { 때: 5 } });
});
await T('열 때: 푼 달이 lock 에 남아 있으면 지운다', async () => {
  const w = await 돌리기({ '2026-08': { 때: null } }, { 마감: { '2026-08': { 때: 5 } } }, true);
  assert.deepStrictEqual(w[0][1].마감, {});
});
await T('설정 저장이 멈췄으면(남이 먼저 바꿈) lock 도 안 쓴다 — main 에 없는 마감을 내지 않는다', async () => {
  assert.strictEqual((await 돌리기({ '2026-08': { 때: 5 } }, null, false, true)).length, 0);
});

console.log(`\n통과 ${통과} · 실패 ${실패}`);
process.exit(실패 ? 1 : 0);

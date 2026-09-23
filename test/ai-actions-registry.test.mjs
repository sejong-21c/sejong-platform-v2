/* AI 행위 등록소 (index.html) — 꼴 검사 + 스케줄 진척률 한 바퀴 (2026-09-23, b84).
 *
 * 왜 여기까지 시험하나. 이 등록소를 누르면 **회사 자료가 진짜로 바뀐다.** 라이브에서 처음
 *   확인하면 틀렸을 때 되돌릴 것이 없다. 특히 스케줄(wbsData)은 프로젝트당 문서 하나에
 *   rows 배열을 통째로 쓰는 구조라, 잘못 쓰면 남의 편집이 통째로 사라진다.
 *
 * index.html 안이라 import 가 안 된다 → 그 블록만 떼어내 가짜 state·fb 로 돌린다.
 *   떼어내기가 실패하면(구조가 바뀌면) 시험이 먼저 터진다. 그것도 목적이다.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = src.indexOf('// ── AI 행위 등록소');
const b = src.indexOf('function toggleDept(id)');
assert.ok(a > 0 && b > a, 'index.html 에서 AI 행위 등록소를 찾지 못했다 — 구조가 바뀌었나?');

// ── 가짜 플랫폼 ───────────────────────────────────────────────────────────
const 쓴것 = [];
let wbs문서 = null;
const 가짜 = `
const window = { AIPERM: {
  judgeEditProject: (me, p) => (me && me.grade === 'super') ? { ok: true, why: '관리자' } : { ok: false, why: '권한 없음' },
  judgeEditTask: (me) => (me && me.grade === 'super') ? { ok: true, why: '관리자' } : { ok: false, why: '권한 없음' },
  checkScheduleChange: (p, s, e) => e ? { ok: true, updates: { end: e } } : { ok: false, why: '날짜를 주세요' },
  checkProjectStatusChange: () => ({ ok: false, why: '시험에선 안 씀' }),
  checkReassign: (t, uid) => uid ? { ok: true, updates: { assignee: uid } } : { ok: false, why: '없음' },
} };
const PROJ_STATUS_META = { active: { label: '진행중' }, done: { label: '완료' } };
const canEditWbsMaster = (pid) => pid !== 'p_남의것';
const getU = () => state.currentUserObj;
const moveTask = async (id) => { 쓴것.push(['moveTask', id]); };
const allKanbanTasks = () => state.tasks;
const computeProjectProgress = () => 0;
`;
const mod = await import('data:text/javascript;base64,' + Buffer.from(
  가짜 + src.slice(a, b) + '\nexport { AI행위, window, _롤업, _단락아래 };', 'utf8').toString('base64'));

// state·fb 는 모듈 바깥에서 갈아 끼울 수 있게 globalThis 로 둔다.
globalThis.쓴것 = 쓴것;
globalThis.state = {
  currentUser: 'u1',
  currentUserObj: { id: 'u1', grade: 'super', name: '김철우' },
  users: [{ id: 'u1', grade: 'super', name: '김철우' }, { id: 'u2', name: '이영희' }],
  projects: [{ id: 'p1', code: 'SJ435-26', name: '삼성전기', pm: 'u1' },
    { id: 'p_남의것', code: 'SJ999-26', name: '남의 프로젝트', pm: 'u2' }],
  tasks: [{ id: 't1', title: '도면 검토', status: 'todo', assignee: 'u1', proj: 'p1' }],
  wbs: {},
};
globalThis.fb = {
  db: {},
  collection: (_db, coll) => ({ coll }),
  // 두 꼴을 다 받는다: doc(db, '컬렉션', 'id') 와 doc(collection(db,'컬렉션')) — 뒤엣것은 자동 id(감사기록).
  doc: (x, coll, id) => (coll === undefined ? { coll: x.coll, id: '자동' } : { coll, id }),
  getDoc: async (ref) => (ref.coll === 'wbsData' && wbs문서
    ? { exists: () => true, data: () => wbs문서 } : { exists: () => false }),
  setDoc: async (ref, data) => { 쓴것.push([ref.coll, ref.id, data]); if (ref.coll === 'wbsData') wbs문서 = { ...wbs문서, ...data }; },
};
const { AI행위, window: W } = mod;

let n = 0;
const T = (why, fn) => fn() instanceof Promise ? fn().then(() => { n++; }) : n++;
const 돌 = async (why, fn) => { await fn(); n++; };

// ── 꼴 검사 — 새 행위를 더할 때 빠뜨리기 쉬운 것들 ────────────────────────
await 돌('행위마다 설명·인자·쓸수있나·풀기·쓰기가 다 있다', async () => {
  const 이름들 = Object.keys(AI행위);
  assert.ok(이름들.length >= 5, '행위가 다섯 개는 있어야 한다 — 있는 것: ' + 이름들.join(','));
  for (const [이름, d] of Object.entries(AI행위)) {
    for (const k of ['설명', '인자', '쓸수있나', '풀기', '쓰기']) {
      assert.ok(d[k], `${이름} 에 ${k} 가 없다`);
    }
    assert.ok(Object.keys(d.인자).length, `${이름} 의 인자가 비었다 — AI 가 뭘 넣을지 모른다`);
    assert.equal(typeof d.쓸수있나, 'function', `${이름}.쓸수있나 는 함수여야 한다`);
  }
});

await 돌('행위 이름에 공백이 없다 — JSON 한 칸으로 오간다', async () => {
  for (const 이름 of Object.keys(AI행위)) assert.ok(!/\s/.test(이름), `"${이름}" 에 공백`);
});

// ── 스케줄 진척률 한 바퀴 ─────────────────────────────────────────────────
const 새WBS = () => ({
  rev: 3, updatedAt: 1000,
  rows: [
    { id: 'w1', projId: 'p1', lv: 0, code: '1', name: '설계', status: '완료' },
    { id: 'w2', projId: 'p1', lv: 0, code: '3', name: 'Tank 제작', pctManual: 20 },
    { id: 'w2a', projId: 'p1', lv: 1, code: '3.1', name: '자재입고', status: '완료' },
    { id: 'w2b', projId: 'p1', lv: 1, code: '3.2', name: '절단·가공', pctManual: 40 },
    { id: 'w3', projId: 'p1', lv: 0, code: '4', name: '도장', status: '미시작' },
  ],
});

await 돌('풀기 — 대단락과 그 아래만 잡고, 형제는 안 건드린다', async () => {
  wbs문서 = 새WBS(); 쓴것.length = 0;
  const r = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '3', 값: 100 });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.카드줄.length, 3, '3 · 3.1 · 3.2 만 — 1 과 4 는 형제라 빠진다');
  assert.ok(r.카드줄[0].includes('Tank 제작') && r.카드줄[0].includes('20%'), '지금 값이 보여야 한다: ' + r.카드줄[0]);
  assert.equal(r.확인, '완료 처리');
  assert.equal(쓴것.length, 0, '**풀기는 아무것도 쓰지 않는다**');
});

await 돌('풀기 — 이름으로도 찾는다', async () => {
  wbs문서 = 새WBS();
  const r = await W.AI행위풀기('스케줄진척', { 프로젝트: 'SJ435', 단락: 'Tank 제작', 값: 100 });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.데이터.ids.length, 3);
});

await 돌('실행 — 말단에만 값을 박고 부모는 비운다', async () => {
  wbs문서 = 새WBS(); 쓴것.length = 0;
  const r0 = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '3', 값: 100 });
  const r = await W.AI행위실행(r0);
  assert.ok(!r.안됨, r.안됨);
  const 쓴wbs = 쓴것.find((x) => x[0] === 'wbsData');
  assert.ok(쓴wbs, 'wbsData 에 써야 한다');
  const by = Object.fromEntries(쓴wbs[2].rows.map((w) => [w.id, w]));
  // **부모(3)에 값을 박으면 영원히 붙박인다** — wbs.html v28.4.41 이 겪은 버그.
  assert.equal(by.w2.pctManual, null, '자식 있는 3 은 비워야 한다(원래 20 이 박혀 있었다)');
  assert.equal(by.w2a.pctManual, 100); assert.equal(by.w2a.status, '완료');
  assert.equal(by.w2b.pctManual, 100);
  assert.equal(by.w1.pctManual, undefined, '형제 1 은 손대지 않는다');
  assert.equal(by.w3.status, '미시작', '형제 4 도 그대로');
  assert.equal(쓴wbs[2].rev, 3, '진척률만 바뀌면 Rev 는 그대로다');
  assert.ok(쓴것.some((x) => x[0] === 't_aiAuditLog'), '누가 무엇을 바꿨는지 남겨야 한다');
});

await 돌('실행 — 그사이 남이 고쳤으면 거절한다', async () => {
  wbs문서 = 새WBS();
  const r0 = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '3', 값: 100 });
  wbs문서 = 새WBS();
  wbs문서.rows[3].pctManual = 90;            // 누가 3.2 를 40 → 90 으로 바꿨다
  쓴것.length = 0;
  const r = await W.AI행위실행(r0);
  assert.ok(r.안됨 && r.안됨.includes('그사이'), '거절해야 한다: ' + JSON.stringify(r));
  assert.equal(쓴것.length, 0, '거절했으면 아무것도 쓰면 안 된다');
});

await 돌('권한 없는 프로젝트는 카드를 만들지 않는다', async () => {
  wbs문서 = 새WBS();
  const r = await W.AI행위풀기('스케줄진척', { 프로젝트: '남의 프로젝트', 단락: '3', 값: 100 });
  assert.ok(r.안됨 && r.안됨.includes('권한'), r.안됨);
});

await 돌('진척률 범위 밖·빈 값은 **가두지 않고 거절**한다', async () => {
  wbs문서 = 새WBS();
  for (const v of [150, -1, undefined, '완료']) {
    const r = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '3', 값: v });
    assert.ok(r.안됨, `${v} 는 거절해야 한다 — 100 으로 조용히 바꾸면 확인이 아니다`);
  }
});

await 돌('여러 개가 맞으면 골라 달라고 한다 — 짐작하지 않는다', async () => {
  wbs문서 = 새WBS();
  wbs문서.rows.push({ id: 'w9', projId: 'p1', lv: 0, code: '5', name: 'Tank 제작 검사' });
  // '제작' 은 '3 Tank 제작' 과 '5 Tank 제작 검사' 에 둘 다 걸리고 lv 도 같다 → 고를 수 없다.
  const r = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '제작', 값: 100 });
  assert.ok(r.안됨 && r.안됨.includes('2개'), r.안됨);
  // 다만 **이름이 정확히 맞으면** 그게 이긴다 — 부분일치가 완전일치를 가리면 안 된다.
  const 정확 = await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: 'Tank 제작', 값: 100 });
  assert.ok(!정확.안됨 && 정확.데이터.단락.includes('Tank 제작'), JSON.stringify(정확));
});

await 돌('없는 단락·없는 프로젝트는 그렇게 말한다', async () => {
  wbs문서 = 새WBS();
  assert.ok((await W.AI행위풀기('스케줄진척', { 프로젝트: '삼성전기', 단락: '없는것', 값: 50 })).안됨);
  assert.ok((await W.AI행위풀기('스케줄진척', { 프로젝트: '듣보잡', 단락: '3', 값: 50 })).안됨);
});

// ── 다른 행위도 같은 규칙을 지키는가 ──────────────────────────────────────
await 돌('업무완료 — 권한을 보고, 풀기는 쓰지 않는다', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('업무완료', { 업무: '도면' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(쓴것.length, 0);
  await W.AI행위실행(r);
  assert.ok(쓴것.some((x) => x[0] === 'moveTask' && x[1] === 't1'), 'moveTask 로 넘겨야 한다');
});

await 돌('업무완료 — 권한이 없으면 카드를 안 만든다', async () => {
  const 옛 = state.currentUserObj;
  state.currentUserObj = { id: 'u9', grade: 'member' };
  const r = await W.AI행위풀기('업무완료', { 업무: '도면' });
  state.currentUserObj = 옛;
  assert.ok(r.안됨 && r.안됨.includes('권한'), r.안됨);
});

await 돌('프로젝트일정 — 바뀌는 줄만 카드에 올린다', async () => {
  const r = await W.AI행위풀기('프로젝트일정', { 프로젝트: '삼성전기', 마감일: '2026-04-30' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.카드줄.length, 1);
  assert.ok(r.카드줄[0].includes('2026-04-30'));
});

await 돌('모르는 행위는 거절한다', async () => {
  assert.ok((await W.AI행위풀기('NCR발행', { 프로젝트: 'A' })).안됨);
  assert.ok((await W.AI행위실행({ 행위: 'NCR발행', 인자: {}, 지문: 'x' })).안됨);
});

await 돌('행위목록은 할 수 있는 것만 준다', async () => {
  const 것 = W.AI행위목록();
  assert.ok(것.length >= 5, '전부 나와야 한다: ' + JSON.stringify(것.map((x) => x.이름)));
  assert.ok(것.every((x) => x.이름 && x.설명 && x.인자));
});

console.log(`ai-actions-registry 테스트 ${n}개 전체 통과 (등록소 · 스케줄 한 바퀴)`);

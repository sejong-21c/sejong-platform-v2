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
// 색인 창구 — 기본은 성공, globalThis.색인터짐 이 켜지면 던진다.
window.SJP_indexRecord = async () => { if (globalThis.색인터짐) throw new Error('색인 서버 오류'); return { ok: true }; };
const DEPTS = [{ id: 'quality', name: '품질관리부' }, { id: 'production', name: '생산부' }, { id: 'design', name: '기술부' }];
const canEditDeptSchedule = (dept) => (globalThis.부서권한 ? globalThis.부서권한(dept) : true);
const canDo = (m, a) => globalThis.권한켬 !== false;
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
  getDoc: async (ref) => (ref.coll === 'wbsHistory' && globalThis.있는이력 && globalThis.있는이력.has(ref.id)) ? { exists: () => true, data: () => ({}) } : (ref.coll === 'wbsData' && wbs문서
    ? { exists: () => true, data: () => wbs문서 } : { exists: () => false }),
  // 품질번호() 가 쓰는 것들. 기본은 "아직 한 건도 없다" → 001 부터.
  // globalThis.있는품질 에 id 를 넣으면 그게 마지막 번호인 것처럼 굴어 채번을 시험할 수 있다.
  query: (c, ...rest) => ({ coll: c.coll, rest }),
  where: (...a) => ['where', ...a],
  orderBy: (...a) => ['orderBy', ...a],
  limit: (n) => ['limit', n],
  documentId: () => '__name__',
  getDocs: async (q) => {
    const id = globalThis.있는품질 && globalThis.있는품질[q.coll];
    return id ? { empty: false, docs: [{ id }] } : { empty: true, docs: [] };
  },
  setDoc: async (ref, data) => { 쓴것.push([ref.coll, ref.id, data]); if (ref.coll === 'wbsData') wbs문서 = { ...wbs문서, ...data }; },
};
const { AI행위, window: W } = mod;
W.품질규칙 = await import('../modules/shared/audit.mjs');   // 번호 규칙 한 벌(품질번호가 쓴다)

let n = 0;
const T = (why, fn) => fn() instanceof Promise ? fn().then(() => { n++; }) : n++;
const 돌 = async (why, fn) => { await fn(); n++; };

// ── 꼴 검사 — 새 행위를 더할 때 빠뜨리기 쉬운 것들 ────────────────────────
await 돌('행위마다 설명·인자·쓸수있나·풀기·쓰기가 다 있다', async () => {
  const 이름들 = Object.keys(AI행위);
  assert.ok(이름들.length >= 9, '행위가 아홉 개는 있어야 한다 — 있는 것: ' + 이름들.join(','));
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

// ── 업무 새로 등록 (2026-09-23, 청사진 '작업 지시 → 배분' 의 나머지 절반) ──
await 돌('업무등록 — 담당자를 안 주면 나에게 붙인다', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('업무등록', { 업무: '노즐 보강 계산' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.데이터.assignee, 'u1');
  assert.ok(r.머리.includes('나에게'), r.머리);
  assert.equal(쓴것.length, 0, '풀기는 아무것도 쓰지 않는다');
});

await 돌('업무등록 — 남에게 배정하면 카드에 크게 보인다', async () => {
  const r = await W.AI행위풀기('업무등록', { 업무: '도면 출도', 담당자: '이영희', 마감일: '2026-10-01', 우선순위: '높음' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.데이터.assignee, 'u2');
  assert.ok(r.머리.includes('이영희'), '누구에게 시키는지가 머리에 있어야 한다: ' + r.머리);
  assert.ok(r.카드줄.some((l) => l.includes('2026-10-01')) && r.카드줄.some((l) => l.includes('높음')));
});

await 돌('업무등록 — 실제로 쓴 것이 화면이 만드는 꼴과 같다', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('업무등록', { 업무: '수압시험 입회', 담당자: '이영희', 프로젝트: '삼성전기' });
  await W.AI행위실행(r);
  const 쓴t = 쓴것.find((x) => x[0] === 'tasks');
  assert.ok(쓴t, 'tasks 에 써야 한다');
  assert.ok(/^t\d+/.test(쓴t[1]), "id 는 't'+시각 꼴이어야 한다: " + 쓴t[1]);
  const d = 쓴t[2];
  assert.equal(d.title, '수압시험 입회');
  assert.equal(d.assignee, 'u2');
  assert.equal(d.proj, 'p1');
  assert.equal(d.status, 'todo', '새 업무는 반드시 todo 로 시작한다');
  assert.equal(d.priority, 'mid', '안 주면 보통');
  assert.equal(d.due, '', '안 주면 빈칸 — null 이 아니다(화면이 문자열로 읽는다)');
  assert.equal(d.createdBy, 'u1', '누가 시켰는지 남는다');
  assert.ok(쓴것.some((x) => x[0] === 't_aiAuditLog'));
});

await 돌('업무등록 — 이름에 직함이 붙어도 찾는다(9/24 라이브: "김철우 부장" 을 못 찾았다)', async () => {
  for (const 말 of ['김철우 부장', '김철우부장님', '이영희 대리', '이영희님']) {
    const r = await W.AI행위풀기('업무등록', { 업무: '직함 시험', 담당자: 말 });
    assert.ok(!r.안됨, 말 + ' → ' + (r.안됨 || ''));
  }
});

await 돌('NCR발행 — 대장이 SJ-NCR-2026-NN 이면 그 계열을 잇는다(9/24 라이브: NCR-2026-001 로 새 계열을 열었다)', async () => {
  globalThis.있는품질 = { t_ncrs: 'SJ-NCR-2026-23' };
  const r = await W.AI행위풀기('NCR발행', { 내용: '번호 계열 시험 — 대장을 잇는가' });
  assert.ok(String(r.머리).includes('SJ-NCR-2026-24'), '다음 번호가 SJ-NCR-2026-24 여야 한다: ' + r.머리);
  globalThis.있는품질 = { t_cars: 'CAR-2026-010' };
  const c = await W.AI행위풀기('CAR발행', { 내용: '번호 계열 시험 — CAR 는 CAR-2026-NNN 대장' });
  assert.ok(String(c.머리).includes('CAR-2026-011'), 'CAR 대장은 그대로 이어야 한다: ' + c.머리);
  globalThis.있는품질 = null;
});

await 돌('업무등록 — 없는 사람·틀린 날짜·빈 이름은 거절한다', async () => {
  assert.ok((await W.AI행위풀기('업무등록', { 업무: 'x', 담당자: '홍길동' })).안됨);
  assert.ok((await W.AI행위풀기('업무등록', { 업무: 'x', 마감일: '10/1' })).안됨);
  assert.ok((await W.AI행위풀기('업무등록', { 업무: '   ' })).안됨);
  assert.ok((await W.AI행위풀기('업무등록', { 업무: 'x', 프로젝트: '듣보잡' })).안됨);
});

await 돌('업무등록 — 같은 이름이 열려 있으면 알려만 주고 막지는 않는다', async () => {
  // 같은 이름의 업무를 일부러 두 건 만드는 경우가 있다(호기별 검사 등). 막으면 그게 안 된다.
  const r = await W.AI행위풀기('업무등록', { 업무: '도면 검토' });   // state.tasks 에 열려 있는 같은 이름
  assert.ok(!r.안됨, '막으면 안 된다');
  assert.ok(r.머리.includes('1건'), '겹친다고 알려는 줘야 한다: ' + r.머리);
});

// ── 품질기록 발행 (2026-09-23) — 심사 대상이라 제일 조심스럽다 ──────────────
await 돌('NCR발행 — 초안이고, 무엇이 빈칸인지 카드에 적는다', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('NCR발행', { 내용: '용접부 언더컷 3개소 확인됨', 프로젝트: '삼성전기', 품목: '노즐 N1' });
  assert.ok(!r.안됨, r.안됨);
  assert.ok(/NCR-\d{4}-001/.test(r.머리), '지금 기준 번호를 보여 줘야 한다: ' + r.머리);
  assert.ok(r.카드줄.some((l) => l.includes('용접부 언더컷')));
  assert.ok(r.카드줄.some((l) => l.includes('NCR 관리 화면에서 채워')), '빈칸을 알려 줘야 한다');
  assert.equal(쓴것.length, 0, '풀기는 아무것도 쓰지 않는다');
});

await 돌('NCR발행 — 쓴 문서가 NCR 화면이 만드는 꼴과 같다', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('NCR발행', { 내용: '도장 두께 미달 (120um 요구, 85um 측정)', 프로젝트: '삼성전기' });
  const 결 = await W.AI행위실행(r);
  assert.ok(!결.안됨, 결.안됨);
  const 쓴n = 쓴것.find((x) => x[0] === 't_ncrs');
  assert.ok(쓴n, 't_ncrs 에 써야 한다');
  const d = 쓴n[2];
  assert.ok(/^NCR-\d{4}-\d{3}$/.test(d.id), 'id 가 NCR-연도-번호 꼴이어야 한다: ' + d.id);
  assert.equal(d.status, 'open', '새 NCR 은 미조치로 시작한다');
  assert.equal(d.rev, 1, '판이 1 이어야 한다 — 규칙이 판 증가를 강제한다');
  assert.equal(d.source, 'ai');
  assert.equal(d.proj, 'p1');
  for (const 빈칸 of ['location', 'cause', 'causeDetail', 'disposition']) {
    assert.equal(d[빈칸], '', `${빈칸} 은 비워 둔다 — 판단이 필요한 칸을 지어내지 않는다`);
  }
});

await 돌('NCR발행 — 내용이 없거나 너무 짧으면 거절한다', async () => {
  assert.ok((await W.AI행위풀기('NCR발행', { 프로젝트: '삼성전기' })).안됨);
  assert.ok((await W.AI행위풀기('NCR발행', { 내용: '불량' })).안됨, '네 글자로 NCR 을 만들면 안 된다');
});

await 돌('NCR·CAR — 권한이 없으면 목록에도 안 나오고 카드도 안 만든다', async () => {
  globalThis.권한켬 = false;
  const 목록 = W.AI행위목록().map((x) => x.이름);
  const r = await W.AI행위풀기('NCR발행', { 내용: '용접부 언더컷 3개소' });
  globalThis.권한켬 = true;
  assert.ok(!목록.includes('NCR발행') && !목록.includes('CAR발행'), '권한 없으면 목록에서 빠져야 한다: ' + 목록.join(','));
  assert.ok(r.안됨 && r.안됨.includes('권한'), r.안됨);
});

await 돌('CAR발행 — 없는 부서·틀린 날짜는 거절한다', async () => {
  assert.ok((await W.AI행위풀기('CAR발행', { 내용: '용접 절차 재교육 요청', 요청부서: '없는부서' })).안됨);
  assert.ok((await W.AI행위풀기('CAR발행', { 내용: '용접 절차 재교육 요청', 회신기한: '10/5' })).안됨);
  const r = await W.AI행위풀기('CAR발행', { 내용: '용접 절차 재교육 요청', 요청부서: '생산부', 회신기한: '2026-10-05' });
  assert.ok(!r.안됨, r.안됨);
  assert.ok(r.카드줄.some((l) => l.includes('생산부')) && r.카드줄.some((l) => l.includes('2026-10-05')));
});

await 돌('CAR발행 — 쓴 문서 꼴', async () => {
  쓴것.length = 0;
  const r = await W.AI행위풀기('CAR발행', { 내용: '용접 절차 재교육 요청', 요청부서: '생산부' });
  await W.AI행위실행(r);
  const d = (쓴것.find((x) => x[0] === 't_cars') || [])[2];
  assert.ok(d, 't_cars 에 써야 한다');
  assert.ok(/^CAR-\d{4}-\d{3}$/.test(d.id), d.id);
  assert.equal(d.status, 'in-progress');
  assert.equal(d.rev, 1);
  assert.equal(d.reqDept, '생산부');
  assert.equal(d.causeDetail, '', '원인은 비워 둔다');
});

// ── 문서 초안 저장 (2026-09-23) — 본문은 말풍선 글 그대로 ──────────────────
await 돌('문서저장 — 본문이 없으면 거절한다(초안을 먼저 써야 한다)', async () => {
  assert.ok((await W.AI행위풀기('문서저장', { 제목: 'x', 종류: '보고서' })).안됨);
  assert.ok((await W.AI행위풀기('문서저장', { 제목: 'x' }, { 본문: '짧다' })).안됨, '40자 미만은 거절');
});

await 돌('문서저장 — 제목이 없으면 거절한다', async () => {
  const 긴글 = '수압시험 결과 보고\n'.repeat(8);
  assert.ok((await W.AI행위풀기('문서저장', { 종류: '보고서' }, { 본문: 긴글 })).안됨);
});

await 돌('문서저장 — 카드에 앞 몇 줄을 보여 준다', async () => {
  const 본문 = Array.from({ length: 12 }, (_, i) => `${i + 1}행 수압시험 결과 항목`).join('\n');
  const r = await W.AI행위풀기('문서저장', { 제목: 'SP-101 수압시험 보고서', 종류: '보고서', 프로젝트: '삼성전기' }, { 본문 });
  assert.ok(!r.안됨, r.안됨);
  assert.ok(r.머리.includes('줄'), r.머리);
  assert.ok(r.카드줄.some((l) => l.includes('아래로 6줄 더')), '긴 글은 접어서 보여 준다: ' + JSON.stringify(r.카드줄));
  assert.ok(r.카드줄[r.카드줄.length - 1].includes('삼성전기'));
});

await 돌('문서저장 — **읽은 글 그대로** 저장한다(모델이 다시 안 쓴다)', async () => {
  쓴것.length = 0;
  const 본문 = ['가. 수압시험 1.5배', '나. 유지 30분', '다. 이상 없음',
    '라. 검사원 입회', '마. 사진 첨부'].join('\n');
  const r = await W.AI행위풀기('문서저장', { 제목: '수압시험 결과', 종류: '성적서' }, { 본문 });
  await W.AI행위실행(r);
  const d = (쓴것.find((x) => x[0] === 't_docs') || [])[2];
  assert.ok(d, 't_docs 에 써야 한다');
  assert.equal(d.본문, 본문, '카드에서 본 글과 저장된 글이 **글자 하나까지** 같아야 한다');
  assert.equal(d.종류, '성적서');
  assert.equal(d.만든길, 'messenger-ai');
  assert.ok(쓴것.some((x) => x[0] === 't_aiAuditLog'));
});

await 돌('문서저장 — 색인이 실패해도 문서는 남는다', async () => {
  쓴것.length = 0;
  globalThis.색인터짐 = true;                       // 아래 가짜 SJP_indexRecord 가 던진다
  const 본문 = '색인 실패 시험용 본문입니다.\n'.repeat(4);
  const r = await W.AI행위풀기('문서저장', { 제목: '색인 실패 시험', 종류: '기타' }, { 본문 });
  const 결 = await W.AI행위실행(r);
  globalThis.색인터짐 = false;
  assert.ok(쓴것.some((x) => x[0] === 't_docs'), '색인이 터져도 문서는 저장돼야 한다');
  assert.ok(!결.안됨, '색인 실패를 통째 실패로 만들면 안 된다: ' + JSON.stringify(결));
  assert.ok(/실패/.test(결.알림), '실패했다는 말은 해야 한다: ' + 결.알림);
});

// ── 캘린더 일정 · 부서 스케줄 (2026-09-25, 로드맵 5) ─────────────────────
await 돌('일정등록 — 부서를 안 주면 내 부서, 화면(openEvent)과 같은 꼴로 events 에 쓴다', async () => {
  state.currentUserObj.dept = '품질관리부';
  state.events = [];
  쓴것.length = 0;
  const r = await W.AI행위풀기('일정등록', { 제목: 'RT 검사 입회', 날짜: '2026-09-29', 시간: '10:00', 분류: '검사' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(쓴것.length, 0, '풀기는 아무것도 쓰지 않는다');
  assert.ok(r.카드줄[0].includes('2026-09-29 (화) 10:00'), '요일까지 카드에 — 사람이 날짜를 되짚는다: ' + r.카드줄[0]);
  assert.ok(r.카드줄.includes('부서: 품질관리부'));
  await W.AI행위실행(r);
  const e = 쓴것.find((x) => x[0] === 'events');
  assert.ok(e && /^e\d+/.test(e[1]), "id 는 'e'+시각 꼴: " + (e && e[1]));
  assert.deepEqual([e[2].title, e[2].date, e[2].time, e[2].color, e[2].dept, e[2].createdBy],
    ['RT 검사 입회', '2026-09-29', '10:00', 'orange', '품질관리부', 'u1']);
  assert.ok(쓴것.some((x) => x[0] === 't_aiAuditLog'), '감사 기록');
});

await 돌('일정등록 — 없는 날·틀린 시간·모르는 분류는 고치지 않고 거절한다', async () => {
  assert.ok((await W.AI행위풀기('일정등록', { 제목: 'x', 날짜: '2026-02-30' })).안됨, '2월 30일은 없다');
  assert.ok((await W.AI행위풀기('일정등록', { 제목: 'x', 날짜: '2026-10-01', 시간: '25:00' })).안됨);
  assert.ok((await W.AI행위풀기('일정등록', { 제목: 'x', 날짜: '2026-10-01', 분류: '출장' })).안됨, '출장을 조용히 회의로 바꾸면 안 된다');
  assert.ok((await W.AI행위풀기('일정등록', { 제목: 'x', 날짜: '2026-10-01', 부서: '없는부' })).안됨);
  const 종일 = await W.AI행위풀기('일정등록', { 제목: '교육', 날짜: '2026-10-01', 부서: '생산' });
  assert.ok(!종일.안됨 && 종일.카드줄[0].endsWith('종일') && 종일.데이터.dept === '생산부', '줄여 말한 부서도 하나면 찾는다');
});

await 돌('부서스케줄 — 문서가 없으면 1번으로 만들고, Rev 1 과 이력 스냅샷을 남긴다', async () => {
  state.currentUserObj.dept = '품질관리부';
  wbs문서 = null;
  쓴것.length = 0;
  const r = await W.AI행위풀기('부서스케줄', { 업무: 'ISO 내부심사', 시작일: '2026-10-13', 종료일: '2026-10-17', 담당: '이영희 대리' });
  assert.ok(!r.안됨, r.안됨);
  assert.equal(r.데이터.pid, 'dept_quality');
  assert.equal(r.데이터.번호, '1');
  assert.ok(r.카드줄.includes('담당: 이영희'), '직함은 떼고 직원 이름으로: ' + r.카드줄);
  await W.AI행위실행(r);
  const 본 = 쓴것.find((x) => x[0] === 'wbsData');
  assert.equal(본[1], 'dept_quality');
  const 행 = 본[2].rows[0];
  assert.deepEqual([행.code, 행.name, 행.lv, 행.projId, 행.dept, 행.status, 행.s, 행.e, 행.mgr],
    ['1', 'ISO 내부심사', 0, 'dept_quality', '품질관리부', '미시작', '2026-10-13', '2026-10-17', '이영희'],
    'dept 가 비면 부서 필터에 걸려 화면에서 안 보인다');
  assert.equal(본[2].rev, 1);
  const 이력 = 쓴것.find((x) => x[0] === 'wbsHistory');
  assert.ok(이력 && 이력[1] === 'dept_quality_0001' && 이력[2].source === 'messenger-ai', '이력 id 는 wbs.html 과 같은 pid_0001 꼴');
});

await 돌('부서스케줄 — 있던 행은 그대로 두고 끝에 붙인다, 그사이 누가 넣으면 멈춘다', async () => {
  wbs문서 = { rev: 4, items: [{ id: 'i1' }], rows: [
    { id: 'a', code: '1', name: '교정', lv: 0, projId: 'dept_quality', dept: '품질관리부' },
    { id: 'b', code: '1.1', name: '압력계', lv: 1, projId: 'dept_quality', dept: '품질관리부' }] };
  쓴것.length = 0;
  const r = await W.AI행위풀기('부서스케줄', { 업무: '외부심사', 시작일: '2026-11-02' });
  assert.equal(r.데이터.번호, '2', '대단락 순번');
  assert.equal(r.데이터.e, '2026-11-02', '종료일을 안 주면 시작일과 같게');
  // 카드를 띄운 뒤 남이 한 줄 넣었다
  wbs문서 = { ...wbs문서, rev: 5, rows: [...wbs문서.rows, { id: 'c', code: '2', name: '남이 넣음', lv: 0, projId: 'dept_quality', dept: '품질관리부' }] };
  const 막힘 = await W.AI행위실행(r);
  assert.ok(막힘.안됨 && !쓴것.some((x) => x[0] === 'wbsData'), '지문이 달라졌으면 쓰지 않는다');
  const r2 = await W.AI행위풀기('부서스케줄', { 업무: '외부심사', 시작일: '2026-11-02' });
  await W.AI행위실행(r2);
  const 본 = 쓴것.find((x) => x[0] === 'wbsData')[2];
  assert.deepEqual(본.rows.map((w) => w.id).slice(0, 3), ['a', 'b', 'c'], '있던 행을 덮으면 안 된다');
  assert.equal(본.rows[3].code, '3');
  assert.equal(본.rev, 6);
  assert.deepEqual(쓴것.find((x) => x[0] === 'wbsHistory')[2].items, [{ id: 'i1' }]);
});

await 돌('부서스케줄 — 이력이 이미 있으면 덮어쓰지 않는다(rev 칸 없는 부서, 9/25 실물)', async () => {
  wbs문서 = { rows: [] };
  globalThis.있는이력 = new Set(['dept_quality_0001']);
  쓴것.length = 0;
  const r = await W.AI행위풀기('부서스케줄', { 업무: '교정', 시작일: '2026-10-01' });
  const 결 = await W.AI행위실행(r);
  globalThis.있는이력 = undefined;
  assert.ok(!결.안됨, '행은 들어간다: ' + JSON.stringify(결));
  assert.ok(쓴것.some((x) => x[0] === 'wbsData'));
  assert.ok(!쓴것.some((x) => x[0] === 'wbsHistory'), '있던 이력을 덮으면 안 된다');
});

await 돌('부서스케줄 — 권한 없는 부서·거꾸로 된 기간·없는 담당자는 카드를 안 만든다', async () => {
  globalThis.부서권한 = (d) => d === '품질관리부';
  assert.ok((await W.AI행위풀기('부서스케줄', { 업무: 'x', 시작일: '2026-10-01', 부서: '생산부' })).안됨);
  globalThis.부서권한 = undefined;
  assert.ok((await W.AI행위풀기('부서스케줄', { 업무: 'x', 시작일: '2026-10-05', 종료일: '2026-10-01' })).안됨);
  assert.ok((await W.AI행위풀기('부서스케줄', { 업무: 'x', 시작일: '2026-10-01', 담당: '없는사람' })).안됨);
  globalThis.부서권한 = () => false;
  assert.ok(!W.AI행위목록().some((x) => x.이름 === '부서스케줄'), '어느 부서도 못 고치면 목록에서 빠진다');
  const 원 = state.currentUser; state.currentUser = null;
  assert.ok(!W.AI행위목록().some((x) => x.이름 === '일정등록'), '로그아웃이면 일정등록도 빠진다 — getU(null) 은 {} 다');
  state.currentUser = 원;
  globalThis.부서권한 = undefined;
  delete state.currentUserObj.dept;
});

await 돌('모르는 행위는 거절한다', async () => {
  assert.ok((await W.AI행위풀기('NCR발행', { 프로젝트: 'A' })).안됨);
  assert.ok((await W.AI행위실행({ 행위: 'NCR발행', 인자: {}, 지문: 'x' })).안됨);
});

await 돌('행위목록은 할 수 있는 것만 준다', async () => {
  const 것 = W.AI행위목록();
  assert.ok(것.length >= 9, '전부 나와야 한다: ' + JSON.stringify(것.map((x) => x.이름)));
  assert.ok(것.every((x) => x.이름 && x.설명 && x.인자));
});

console.log(`ai-actions-registry 테스트 ${n}개 전체 통과 (등록소 · 스케줄 한 바퀴 · 일정·부서 스케줄)`);

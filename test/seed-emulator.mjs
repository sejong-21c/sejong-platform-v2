/* 에뮬레이터에 시험용 가짜 자료를 심는다 (2026-09-23).
 *
 * **회사 자료를 복사해 오지 않는다.** 급여·인사·B등급 도면이 내 PC 로 내려오면 그 자체가 사고고,
 *   복사해 오려면 어차피 실물을 읽어야 해서 한도를 태운다. 손으로 만든 몇 건이면 화면은 다 돈다.
 *
 * 에뮬레이터 REST 는 **인증이 없다**(Bearer owner). 진짜 프로젝트에는 절대 안 닿는다 —
 *   주소가 127.0.0.1 이고, 아래에서 한 번 더 확인한다.
 *
 * `npm run emu:seed` — 에뮬레이터가 떠 있어야 한다.
 */
const FS = 'http://127.0.0.1:8181';
const AUTH = 'http://127.0.0.1:9099';
const PID = 'sejong-platform';
const 뿌리 = `${FS}/v1/projects/${PID}/databases/(default)/documents`;

// **안전 고리.** 주소가 내 PC 가 아니면 한 글자도 쓰지 않는다.
for (const u of [FS, AUTH]) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(u)) throw new Error('에뮬레이터 주소가 아니다: ' + u);
}

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
const 필드 = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]));

let 쓴수 = 0;
async function 쓰기(경로, 값) {
  // **`Bearer owner` 가 있어야 한다.** 에뮬레이터도 firestore.rules 를 그대로 물고 돈다 —
  //   이 머리가 없으면 로그인 안 한 손님으로 보고 규칙이 막는다(처음에 403 으로 걸렸다).
  //   이 토큰은 에뮬레이터만 아는 것이라 진짜 프로젝트에는 아무 힘이 없다.
  const r = await fetch(`${뿌리}/${경로}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: 필드(값) }),
  });
  if (!r.ok) throw new Error(`${경로} ${r.status} ${(await r.text()).slice(0, 200)}`);
  쓴수++;
}

async function 계정만들기(email, password) {
  // Auth 에뮬레이터는 signUp 으로 uid 를 지정할 수 없다 → 만든 뒤 그 uid 로 users 문서를 쓴다.
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (r.ok) return j.localId;
  if (!(j.error && String(j.error.message || '').includes('EMAIL_EXISTS'))) {
    throw new Error('계정 만들기 ' + JSON.stringify(j).slice(0, 200));
  }
  // **이미 있으면 로그인해서 uid 를 받는다.** 그냥 건너뛰면, 계정은 만들어졌는데 users 문서
  //   쓰기가 실패한 상태에서 다시 돌릴 때 영영 복구가 안 된다(처음에 그렇게 막혔다).
  //   `/emulator/v1/.../accounts` 는 목록을 안 준다(GET 405 · 전체 삭제 전용) — 로그인이 제일 짧다.
  const s = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const sj = await s.json();
  if (!s.ok) throw new Error(`${email} 이미 있는데 로그인도 안 된다(비밀번호가 다른가?): ` + JSON.stringify(sj).slice(0, 160));
  return sj.localId;
}

// ── 사람 ──────────────────────────────────────────────────────────────────
// 실명 대신 **시험용 이름**을 쓴다. 가짜 자료에 진짜 사람 이름을 넣으면 화면을 보다가
//   진짜인지 가짜인지 헷갈린다(그게 이 하네스의 제일 큰 위험이다).
// ⚠ 이름에 직급을 넣지 않는다 — 화면이 "이름 직급" 으로 붙여 쓰는 자리가 있어
//   '시험 과장' + '과장' → "시험 과장 과장" 이 된다(2026-09-23 에뮬에서 실제로 봤다).
//   홍길동·성춘향·이몽룡은 누가 봐도 가짜라 진짜 직원과 헷갈리지 않는다.
const 사람들 = [
  { email: 'super@sejong-21c.com', name: '홍길동', dept: '품질관리부', title: '부장', grade: 'super' },
  { email: 'mgr@sejong-21c.com', name: '성춘향', dept: '품질관리부', title: '과장', grade: 'manager' },
  { email: 'staff@sejong-21c.com', name: '이몽룡', dept: '생산부', title: '사원', grade: 'member' },
];

const 오늘 = new Date();
const 날 = (d) => new Date(오늘.getTime() + d * 86400e3).toISOString().slice(0, 10);

console.log('에뮬레이터에 시험 자료를 심는다 —', FS);
const uid들 = {};
for (const p of 사람들) {
  const uid = await 계정만들기(p.email, 'test1234');
  uid들[p.email] = uid;
  await 쓰기(`users/${uid}`, { name: p.name, email: p.email, dept: p.dept, title: p.title, grade: p.grade });
  console.log(`  ✔ ${p.name} (${p.grade}) ${p.email} / test1234  uid=${uid}`);
}
const 부장 = uid들['super@sejong-21c.com'];
const 과장 = uid들['mgr@sejong-21c.com'];
if (!부장 || !과장) throw new Error('시험 계정을 못 만들었다 — 에뮬레이터가 떠 있나?');

// ── 프로젝트 · 스케줄 ─────────────────────────────────────────────────────
await 쓰기('projects/p_tank', { code: 'SJ435-26', name: '시험 탱크 프로젝트', pm: 부장, status: 'active', progress: 30, start: 날(-60), end: 날(60) });
await 쓰기('projects/p_mix', { code: 'SJ428-25', name: '시험 교반기 이설', pm: 과장, status: 'active', progress: 10, start: 날(-20), end: 날(90) });

// WBS — **AI 행위(스케줄진척)를 눌러 보려면 이 꼴이어야 한다.**
//   대단락(lv0) 아래 중단락(lv1). 값이 섞여 있어야 "지금 → 바꿀 값" 이 눈에 보인다.
await 쓰기('wbsData/p_tank', {
  rev: 3, updatedAt: Date.now(),
  rows: [
    { id: 'w1', projId: 'p_tank', lv: 0, code: '1', name: '설계', status: '완료', s: 날(-60), e: 날(-40), dept: '기술부' },
    { id: 'w2', projId: 'p_tank', lv: 0, code: '2', name: '자재 발주', status: '완료', s: 날(-40), e: 날(-25), dept: '구매부' },
    { id: 'w3', projId: 'p_tank', lv: 0, code: '3', name: 'Tank 제작', s: 날(-25), e: 날(20), dept: '생산부' },
    { id: 'w3a', projId: 'p_tank', lv: 1, code: '3.1', name: '자재입고', status: '완료', s: 날(-25), e: 날(-20), dept: '생산부' },
    { id: 'w3b', projId: 'p_tank', lv: 1, code: '3.2', name: '절단·가공', pctManual: 60, s: 날(-20), e: 날(-5), dept: '생산부' },
    { id: 'w3c', projId: 'p_tank', lv: 1, code: '3.3', name: '용접·조립', pctManual: 20, s: 날(-5), e: 날(10), dept: '생산부' },
    { id: 'w3d', projId: 'p_tank', lv: 1, code: '3.4', name: '수압시험', status: '미시작', s: 날(10), e: 날(20), dept: '품질관리부' },
    { id: 'w4', projId: 'p_tank', lv: 0, code: '4', name: '도장·출하', status: '미시작', s: 날(20), e: 날(40), dept: '생산부' },
  ],
  items: [],
});

// ── 업무 · 일정 · 방 ──────────────────────────────────────────────────────
await 쓰기('tasks/t_seed1', { title: '시험 도면 검토', proj: 'p_tank', assignee: 부장, due: 날(1), priority: 'mid', status: 'todo' });
await 쓰기('tasks/t_seed2', { title: '시험 자재 발주서 작성', proj: 'p_tank', assignee: 과장, due: 날(5), priority: 'high', status: 'doing' });
await 쓰기('tasks/t_seed3', { title: '시험 검사성적서 정리', proj: 'p_mix', assignee: 부장, due: 날(-2), priority: 'low', status: 'todo' });
await 쓰기('events/e_seed1', { title: '시험 수압시험 입회', date: 날(3), dept: '품질관리부', createdBy: 부장 });
await 쓰기('channels/c1', { name: '공지', type: 'announce' });
await 쓰기('channels/dept_quality', { name: '품질관리부', type: 'dept', deptId: 'quality' });

console.log(`\n✔ 끝 — 문서 ${쓴수}건.`);
console.log('\n들어가는 법:');
console.log('  http://localhost:5000/?emu=1   →  super@sejong-21c.com / test1234');
console.log('\n눌러 볼 것 (오늘 만든 AI 행위):');
console.log('  🤖 → AI 비서 방 → "시험 탱크 프로젝트 3번 Tank 제작 전체 완료 해줘"');
console.log('  ⚠ AI 답변 자체는 안 온다(게이트웨이가 진짜 토큰을 요구한다).');
console.log('     행위만 보려면 콘솔에서:');
console.log("     await AI행위풀기('스케줄진척', {프로젝트:'시험 탱크', 단락:'3', 값:100})");
console.log('     그 결과를 AI행위실행() 에 그대로 넣으면 쓰기까지 돈다.');

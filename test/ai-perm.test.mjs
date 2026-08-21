// 17-a 안전장치 테스트 — 파이스 교훈 ④: 울타리는 검사에 못박는다.
// 실행: node test/ai-perm.test.mjs
import { judgeEditProject, checkScheduleChange, judgeEditTask, checkProjectStatusChange, checkReassign } from '../modules/shared/ai-perm.mjs';
import assert from 'node:assert';

const users = [
  { id: 'u1', name: '김철우', grade: 'super' },
  { id: 'u2', name: '김시원', grade: 'member' },
  { id: 'u3', name: '신채완', grade: 'member' },
];
const proj = { id: 'p1', code: 'SJE2026-001', pm: 'u2', start: '2026-01-01', end: '2026-03-31' };

// ── 권한 판정 ──
assert.equal(judgeEditProject(users[0], proj, users).ok, true, '관리자(super)는 허용');
assert.equal(judgeEditProject(users[0], proj, users).why, '관리자');
assert.equal(judgeEditProject({ id: 'x', grade: 'exec' }, proj, users).ok, true, 'exec도 관리자');
assert.equal(judgeEditProject(users[1], proj, users).ok, true, 'PM 본인은 허용');
assert.equal(judgeEditProject(users[1], proj, users).why, '이 프로젝트 PM');
const deny = judgeEditProject(users[2], proj, users);
assert.equal(deny.ok, false, 'PM 아닌 member는 거부');
assert.ok(deny.why.includes('김시원'), '거부 안내에 PM 이름이 들어간다: ' + deny.why);
assert.equal(judgeEditProject(null, proj, users).ok, false, '비로그인 거부');
assert.equal(judgeEditProject(users[2], { pm: '' }, users).ok, false, 'PM 없는 프로젝트는 관리자만');

// ── 일정 변경 검증 ──
assert.deepEqual(checkScheduleChange(proj, null, '2026-04-30').updates, { end: '2026-04-30' }, '마감만 변경');
assert.deepEqual(checkScheduleChange(proj, '2026-02-01', '2026-04-30').updates,
  { start: '2026-02-01', end: '2026-04-30' }, '둘 다 변경');
assert.equal(checkScheduleChange(proj, null, null).ok, false, '날짜 미지정 거부');
assert.equal(checkScheduleChange(proj, '2026-01-01', '2026-03-31').ok, false, '무변경(이미 그 값) 거부');
assert.equal(checkScheduleChange(proj, '26-1-1', null).ok, false, '형식 오류 거부');
assert.equal(checkScheduleChange(proj, null, '2026/04/30').ok, false, '슬래시 형식 거부');
assert.equal(checkScheduleChange(proj, '2026-05-01', null).ok, false, '시작>기존 마감이면 거부');
assert.equal(checkScheduleChange(proj, '2026-05-01', '2026-04-01').ok, false, '시작>새 마감이면 거부');
assert.equal(checkScheduleChange({ id: 'p2' }, null, '2026-04-30').ok, true, '기존 날짜 없던 프로젝트도 OK');
assert.deepEqual(checkScheduleChange(proj, null, ' 2026-04-30 ').updates, { end: '2026-04-30' }, '공백 트림');

// ── 17-b: 업무 수정 권한 ──
const task = { id: 't1', title: '검사성적서 정리', proj: 'p1', assignee: 'u3', due: '2026-09-01', status: 'todo' };
assert.equal(judgeEditTask(users[0], task, proj, users).ok, true, '관리자 허용');
assert.equal(judgeEditTask(users[2], task, proj, users).why, '내 업무', '담당자 본인은 내 업무');
assert.equal(judgeEditTask(users[1], task, proj, users).why, '이 프로젝트 PM', 'PM 허용');
const dt = judgeEditTask({ id: 'u9', grade: 'member' }, task, proj, users);
assert.equal(dt.ok, false, '남의 업무 + PM 아님 = 거부');
assert.ok(dt.why.includes('신채완'), '거부에 담당자 이름: ' + dt.why);
assert.equal(judgeEditTask({ id: 'u9', grade: 'member' }, { assignee: 'u3' }, null, users).ok, false, '프로젝트 없는 업무도 거부');

// ── 17-b: 상태·진행률 ──
assert.deepEqual(checkProjectStatusChange(proj, 'done', null, null).updates, { status: 'done' }, '상태 코드');
assert.deepEqual(checkProjectStatusChange(proj, '마감예정', null, null).updates, { status: 'pre-close' }, '한글 라벨 허용');
assert.equal(checkProjectStatusChange(proj, '취소', null, null).ok, false, '없는 상태 거부');
assert.deepEqual(checkProjectStatusChange({ progress: 50 }, null, 80, null).updates, { progress: 80 }, 'WBS 없으면 진행률 변경');
assert.deepEqual(checkProjectStatusChange({ progress: 50 }, null, '80.4', null).updates, { progress: 80 }, '문자·소수 반올림');
assert.equal(checkProjectStatusChange({ progress: 50 }, null, 80, 42).ok, false, 'WBS 있으면 진행률 거부(자동계산)');
assert.ok(checkProjectStatusChange({ progress: 50 }, null, 80, 42).why.includes('42%'), '현재 WBS 진척률을 알려준다');
assert.equal(checkProjectStatusChange({ progress: 50 }, null, 120, null).ok, false, '범위 밖 거부');
assert.equal(checkProjectStatusChange({ progress: 50 }, null, 'abc', null).ok, false, '숫자 아님 거부');
assert.equal(checkProjectStatusChange(proj, 'done', null, 42).ok, false, 'WBS 42%인데 완료 → 되돌아감 경고');
assert.equal(checkProjectStatusChange({ status: 'done' }, 'active', null, 100).ok, false, 'WBS 100%인데 진행중 → 거부');
assert.equal(checkProjectStatusChange(proj, 'pre-close', null, 42).ok, true, '마감예정은 WBS와 무관하게 허용');
assert.equal(checkProjectStatusChange({ status: 'active' }, 'active', null, null).ok, false, '무변경 거부');
assert.equal(checkProjectStatusChange({}, 'active', null, null).ok, false, '상태 없으면 active로 간주해 무변경');
assert.equal(checkProjectStatusChange(proj, null, null, null).ok, false, '아무것도 안 주면 거부');

// ── 17-b: 담당자·마감일 ──
assert.deepEqual(checkReassign(task, 'u2', null).updates, { assignee: 'u2' }, '담당자만');
assert.deepEqual(checkReassign(task, null, '2026-10-01').updates, { due: '2026-10-01' }, '마감일만');
assert.deepEqual(checkReassign(task, 'u2', '2026-10-01').updates, { assignee: 'u2', due: '2026-10-01' }, '둘 다');
assert.equal(checkReassign(task, 'u3', null).ok, false, '같은 담당자 거부');
assert.equal(checkReassign(task, null, '2026-09-01').ok, false, '같은 마감일 거부');
assert.equal(checkReassign(task, null, '10/1').ok, false, '형식 오류 거부');
assert.equal(checkReassign(task, null, null).ok, false, '아무것도 안 주면 거부');

console.log('ai-perm 테스트 전체 통과 (17-a 17개 + 17-b 26개 = 43개)');

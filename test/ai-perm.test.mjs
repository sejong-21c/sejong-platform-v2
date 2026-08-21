// 17-a 안전장치 테스트 — 파이스 교훈 ④: 울타리는 검사에 못박는다.
// 실행: node test/ai-perm.test.mjs
import { judgeEditProject, checkScheduleChange } from '../modules/shared/ai-perm.mjs';
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

console.log('ai-perm 테스트 전체 통과 (17개)');

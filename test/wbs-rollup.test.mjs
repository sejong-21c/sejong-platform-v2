/* AI 가 스케줄을 고칠 때 쓰는 진척률 롤업·단락 범위 검사 (2026-09-23, b83).
 *
 * 왜 이 시험이 있나. `_롤업` 은 wbs.html 의 `wCS()` 를 **옮겨 적은 것**이다.
 *   같은 규칙이 두 곳에 있으면 반드시 어긋난다([[silent-failure-hunting]]) — 그래서 여기에
 *   "어긋나면 어떤 답이 나와야 하는가" 를 못 박아 둔다. 특히 **모르면 null** 이 핵심이다:
 *   모르는 채로 숫자를 지어내면 대시보드 진도율이 조용히 틀린다.
 *
 * index.html 안의 함수라 import 가 안 된다 → 그 블록만 떼어내 그대로 돌린다.
 *   떼어내기가 실패하면(함수 이름이 바뀌면) 시험이 먼저 터진다. 그것도 목적이다.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const s = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = s.indexOf('function _롤업(');
const b = s.indexOf('const AI행위 = {');
assert.ok(a > 0 && b > a, 'index.html 에서 _롤업·_단락아래 를 찾지 못했다 — 이름이 바뀌었나?');
const { _롤업, _단락아래 } = await import(
  'data:text/javascript;base64,' +
  Buffer.from(s.slice(a, b) + '\nexport { _롤업, _단락아래 };', 'utf8').toString('base64'));

let n = 0;
const T = (why, fn) => { fn(); n++; };

// rows 는 WBS 순서대로 늘어서 있고 lv 가 깊이다. 같은 꼴로 만든다.
const R = (id, lv, x = {}) => ({ id, lv, projId: 'p1', code: id, name: id, ...x });
const 자식들 = (rows) => (x) => _단락아래(rows, x).slice(1).filter((y) => (y.lv || 0) === (x.lv || 0) + 1);
const 롤 = (rows, id) => _롤업(rows, rows.find((w) => w.id === id), 자식들(rows));

// ── 단락 범위 ─────────────────────────────────────────────────────────────
T('단락 아래는 자기 + 후손, 형제에서 멈춘다', () => {
  const rows = [R('1', 0), R('1.1', 1), R('1.1.1', 2), R('1.2', 1), R('2', 0), R('2.1', 1)];
  assert.deepEqual(_단락아래(rows, rows[0]).map((w) => w.id), ['1', '1.1', '1.1.1', '1.2']);
  assert.deepEqual(_단락아래(rows, rows[1]).map((w) => w.id), ['1.1', '1.1.1']);
  assert.deepEqual(_단락아래(rows, rows[4]).map((w) => w.id), ['2', '2.1'], '마지막 대단락도 끝까지');
  assert.deepEqual(_단락아래(rows, rows[3]).map((w) => w.id), ['1.2'], '자식 없는 행은 자기 하나');
});

T('다른 프로젝트 행이 섞여 있어도 넘어가지 않는다', () => {
  const rows = [R('1', 0), R('1.1', 1), { ...R('x', 1), projId: 'p2' }];
  assert.deepEqual(_단락아래(rows, rows[0]).map((w) => w.id), ['1', '1.1']);
});

// ── 롤업: 아는 것 ─────────────────────────────────────────────────────────
T('수동값이 최우선', () => {
  assert.equal(롤([R('1', 0, { pctManual: 42, status: '미시작' })], '1'), 42);
  assert.equal(롤([R('1', 0, { pctManual: '77' })], '1'), 77, '문자열로 저장돼 있어도 읽는다');
});

T('수동값은 0~100 으로 가둔다', () => {
  assert.equal(롤([R('1', 0, { pctManual: 150 })], '1'), 100);
  assert.equal(롤([R('1', 0, { pctManual: -5 })], '1'), 0);
});

T('상태로 정해지는 말단', () => {
  assert.equal(롤([R('1', 0, { status: '완료' })], '1'), 100);
  assert.equal(롤([R('1', 0, { status: '미시작' })], '1'), 0);
  assert.equal(롤([R('1', 0, { status: '진행중', pct: 30 })], '1'), 30);
});

T('부모는 자식 평균 — 손자까지 내려간다', () => {
  const rows = [R('1', 0), R('1.1', 1, { status: '완료' }), R('1.2', 1, { status: '미시작' })];
  assert.equal(롤(rows, '1'), 50);
  const 깊게 = [R('1', 0), R('1.1', 1), R('1.1.1', 2, { status: '완료' }), R('1.1.2', 2, { status: '미시작' })];
  assert.equal(롤(깊게, '1'), 50, '1 → 1.1 → 손자 평균');
});

T('**전부 같은 값이면 부모도 그 값** — AI 가 쓰는 길이 바로 이것이다', () => {
  const rows = [R('1', 0), R('1.1', 1, { pctManual: 100 }), R('1.2', 1, { pctManual: 100 }), R('1.3', 1, { pctManual: 100 })];
  assert.equal(롤(rows, '1'), 100);
  // TA 탱크 가중치가 걸려 있어도 마찬가지 — 같은 수의 가중평균은 그 수다.
  const 탱크 = [R('1', 0, { wtTank: true }), R('1.1', 1, { pctManual: 100 }), R('1.2', 1, { pctManual: 100 })];
  assert.equal(롤(탱크, '1'), 100, '가중치가 있어도 값이 같으면 답이 하나다');
});

// ── 롤업: 모르는 것은 **반드시** null ──────────────────────────────────────
T('ITP 검사기록에 물린 말단은 모른다', () => {
  assert.equal(롤([R('1', 0, { itpLink: 'itp1' })], '1'), null);
});

T('진행중인데 날짜만 있으면 모른다 — 오늘 날짜에 따라 변한다', () => {
  assert.equal(롤([R('1', 0, { status: '진행중', s: '2026-01-01', e: '2026-12-31' })], '1'), null);
});

T('상태도 값도 없는 말단은 0(미시작) — wbs.html 과 같아야 한다', () => {
  // 처음엔 "모르니 null" 로 적었다가 틀렸다. wbs.html 의 wCS() 는 status 가 비면 미시작으로 읽어
  //   0 을 준다. **이 함수의 정답은 '안전해 보이는 값' 이 아니라 '본토(wbs.html)와 같은 값' 이다** —
  //   다르면 AI 가 계산한 진도율과 스케줄 화면이 어긋나고, 둘 중 뭐가 맞는지 아무도 모르게 된다.
  assert.equal(롤([R('1', 0)], '1'), 0);
});

T('자식 하나라도 모르면 부모도 모른다 — 반쪽 평균을 내지 않는다', () => {
  const rows = [R('1', 0), R('1.1', 1, { status: '완료' }), R('1.2', 1, { itpLink: 'itp1' })];
  assert.equal(롤(rows, '1'), null, '100 과 모름의 평균은 100 이 아니다');
});

T('가중치 부모는 자식 값이 다르면 모른다 — 가중치를 여기선 모른다', () => {
  const rows = [R('1', 0, { wtTank: true }), R('1.1', 1, { pctManual: 100 }), R('1.2', 1, { pctManual: 50 })];
  assert.equal(롤(rows, '1'), null, '단순평균 75 를 내놓으면 실제 가중평균과 다르다');
});

T('가중치 없는 부모는 값이 달라도 단순평균으로 안다', () => {
  const rows = [R('1', 0), R('1.1', 1, { pctManual: 100 }), R('1.2', 1, { pctManual: 50 })];
  assert.equal(롤(rows, '1'), 75);
});

console.log(`wbs-rollup 테스트 ${n}개 전체 통과 (_롤업 · _단락아래)`);

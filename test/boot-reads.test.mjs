/* 부팅 읽기 불변식 (2026-09-23, b87).
 *
 * 무료 파이어스토어는 **하루 문서 읽기 5만 건**이다. 한 사람이 앱을 열 때마다
 *   `startFirestoreSync()` 가 거는 구독들이 그 자리에서 컬렉션을 통째로 받아 온다 —
 *   그게 부팅 한 번의 값이다. 열두 명일 땐 버티지만 연말에 70명이면 그대로 터진다.
 *
 * 되돌리기가 너무 쉬운 종류다. 컬렉션 하나를 부팅 목록에 얹는 건 한 줄이고,
 *   화면은 멀쩡해 보이며, 한도는 **몇 주 뒤에** 터진다. 그래서 여기 못 박는다.
 *
 * 고칠 일이 생기면: 아래 목록을 고치기 전에 **먼저 재라** — 콘솔 `부팅읽기()` 가
 *   컬렉션별로 서버가 한 번에 준 문서 수를 보여 준다(에뮬레이터에서 공짜로 잰다).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const s = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = s.indexOf('function startFirestoreSync()');
const b = s.indexOf('function finishLogin()');
assert.ok(a > 0 && b > a, 'startFirestoreSync 를 찾지 못했다 — 이름이 바뀌었나?');
const 부팅 = s.slice(a, b);

let n = 0;
const T = (why, fn) => { fn(); n++; console.log('PASS  ' + why); };

// 부팅 때 **통째로** 받는 컬렉션. 줄이는 것이 목표고, 늘리려면 근거가 있어야 한다.
const 허용 = ['projects', 'pendingUsers', 'events', 'tasks', 'okrs', 'approvals', 'wbsData', 'channels'];
// 부팅 경로에 **있으면 안 되는** 것 — 이미 한 번 빼냈다. 다시 들어오면 조용히 값이 오른다.
const 금지 = {
  wbsRec: '제작 공정 관리 화면 하나에서만 쓴다 → ensureWbsRecSync (b87에 뺐다)',
  t_mobileInspectionDrafts: '모바일 점검 화면의 배지 하나에만 쓴다 → ensureMobileDraftsSync (v30.13에 뺐다)',
  messages: '걸러서 받아야 한다(최근 200건) — 통째로 받으면 안 된다',
  channelReads: '내 것만 받아야 한다(where uid==나)',
  users: '부팅 경로에서 구독하지 않는다(hydrateUsersAndEnter 가 1회 읽는다)',
};

const 통째로 = [...부팅.matchAll(/onSnapshot\(\s*fb\.collection\(fb\.db,\s*'([a-zA-Z_]+)'\s*\)/g)].map((m) => m[1]);

T('부팅 때 통째로 받는 컬렉션이 목록 그대로다', () => {
  assert.deepEqual(통째로.sort(), [...허용].sort(),
    '부팅 구독이 바뀌었다. 늘렸다면 **먼저 재고**(콘솔 부팅읽기()) 근거와 함께 이 목록을 고쳐라 — '
    + '한 줄 얹으면 전 직원 부팅 값이 그만큼 오르고, 한도는 몇 주 뒤에 터진다. 지금: ' + 통째로.join(', '));
});

for (const [c, 왜] of Object.entries(금지)) {
  T(`${c} 는 부팅 경로에 없다 — ${왜}`, () => {
    assert.ok(!통째로.includes(c), `${c} 가 부팅 구독으로 돌아왔다. ${왜}`);
  });
}

T('걸러 받는 둘은 그대로다 — messages 는 limit, channelReads 는 내 것만', () => {
  assert.ok(/fb\.limit\(200\)/.test(부팅), 'messages 구독의 limit(200) 이 사라졌다');
  assert.ok(/'channelReads'\s*\)\s*,\s*fb\.where\('uid',\s*'==',\s*state\.currentUser\)/.test(부팅),
    'channelReads 가 내 것만 받는 where 를 잃었다');
});

// ── 계량기가 모든 구독에 붙어 있나 ────────────────────────────────────────
// 하나라도 빠지면 "부팅 한 번 = 몇 건" 이 **실제보다 작게** 나온다. 그 수를 믿고
//   "괜찮네" 하고 넘어가는 것이 제일 위험하다 — 없는 것보다 나쁜 계량기다.
T('부팅 구독 전부가 잰다() 를 부른다 — 하나라도 빠지면 계량기가 거짓말을 한다', () => {
  const 구독수 = (부팅.match(/onSnapshot\(/g) || []).length;
  const 잰수 = (부팅.match(/잰다\(/g) || []).length;
  assert.equal(잰수, 구독수, `구독 ${구독수}개 중 ${잰수}개만 재고 있다`);
});

T('지연 구독 둘도 잰다() 를 부른다', () => {
  for (const f of ['ensureWbsRecSync', 'ensureMobileDraftsSync']) {
    const i = s.indexOf(`function ${f}(`);
    assert.ok(i > 0, `${f} 가 없다`);
    const 몸 = s.slice(i, i + 900);
    assert.ok(/잰다\(/.test(몸), `${f} 가 잰다() 를 안 부른다`);
    assert.ok(/지연/.test(몸), `${f} 의 계량기 이름에 '지연' 이 없다 — 부팅 값과 섞여 보인다`);
  }
});

T('계량기 자체가 살아 있다', () => {
  assert.ok(/window\.부팅읽기\s*=/.test(s), '부팅읽기() 가 없다 — 재는 법이 사라졌다');
  assert.ok(/const _읽기장부/.test(s), '_읽기장부 가 없다');
});

// ── 메신저 몫도 세나 (b95) ────────────────────────────────────────────────
// 왜: 플랫폼 본체 부팅이 213건인데 **메신저가 부팅마다 메시지 500 + 공지 100 을 읽는다.**
//   그걸 안 세면 하루 읽기를 네 배 적게 본다 — 그 숫자를 믿고 "괜찮네" 하는 게 제일 위험하다.
//   메신저는 부모의 db 를 쓰므로(getFB) 같은 접속의 같은 지갑이다. 부모 계량기에 얹는다.
{
  const msg = readFileSync(new URL('../modules/messenger/messenger.js', import.meta.url), 'utf8');
  T('메신저 구독도 부모 계량기에 얹는다 — 안 얹으면 하루 읽기를 네 배 적게 본다', () => {
    assert.ok(/window\.parent\.잰다/.test(msg), '메신저가 부모 계량기를 안 부른다');
    const i = msg.indexOf('const on = (q, cb, tag)');
    assert.ok(i > 0 && /잰다\(tag, snap\)/.test(msg.slice(i, i + 700)),
      '구독 헬퍼 on() 이 잰다() 를 안 거친다 — 여기를 지나야 메시지 500건이 잡힌다');
  });
  T('부모의 잰다() 는 자식이 부를 수 있어야 한다 (최상위 function 이라 window 에 붙는다)', () => {
    assert.ok(/^function 잰다\(이름, snap\)/m.test(s),
      '잰다 가 const/let 이면 window 에 안 붙어 iframe 이 못 부른다 — 조용히 안 세게 된다');
  });
}

// ── 화면 하나가 하루치를 태우지 않나 (b95) ────────────────────────────────
// 관리 › 작업 활동이 30일치를 **limit 없이** 받아 150줄만 보여 주고 있었다.
//
// ⚠ 처음엔 "activityLog 가 9,969건이니 한 클릭에 하루치의 20%" 라고 적었는데 **틀렸다.**
//   실측하니 480건이었다 — `where('at','>=')` 를 파이어스토어가 **서버에서** 걸러 주므로
//   30일 밖 문서는 읽지도 과금하지도 않는다. 인덱스가 하는 일을 내가 몰랐다.
//   (2026-09-23 화면 실측: "최근 30일 작업 480건", 컬렉션 전체는 9,969건)
//
// 그래도 이 시험을 남기는 이유 둘:
//   ① 로그는 **자란다.** 30일치가 1만 건이 되는 날 이 화면은 한 클릭에 1만 건이 된다.
//      limit 은 그날을 위한 것이다.
//   ② KPI 가 rows.length 를 쓰고 있었다 — limit 만 걸고 말았으면 **화면 숫자가 거짓말을 한다.**
//      전체는 집계로 세고, 잘렸으면 잘렸다고 적는다.
T('관리 기록 화면은 **보여 줄 만큼만** 받는다 (limit 없이 훑으면 한 클릭에 1만 건이다)', () => {
  const i = s.indexOf('async function _admFetch30d');
  assert.ok(i > 0, '_admFetch30d 가 없다');
  const 몸 = s.slice(i, i + 1400);
  assert.ok(/fb\.limit\(/.test(몸), 'limit 이 없다 — 30일치를 통째로 받는다');
  assert.ok(/fb\.orderBy\('at', 'desc'\)/.test(몸), "orderBy('at','desc') 가 없으면 limit 이 **아무 300건**을 준다");
  assert.ok(/getCountFromServer/.test(몸), '전체 건수를 집계로 세지 않으면 화면 숫자가 거짓말을 한다');
});

T('잘렸으면 화면이 **잘렸다고 말한다** — 300 을 전체인 척하면 안 된다', () => {
  assert.ok(/최근 300건 기준/.test(s), '잘림 안내 문구가 없다');
  assert.ok(/전체 = null/.test(s), '못 셌을 때 모른다고 하는 길이 없다');
});

// ── 세는 규칙 자체를 돌려 본다 (b94) ──────────────────────────────────────
// 왜: 이 자가 틀리면 "오늘 3만 썼다" 는 숫자를 믿고 마음 놓았다가 한도를 태운다.
//   **틀린 자는 없는 자보다 나쁘다.** 그래서 잰다() 를 index.html 에서 그대로 떼어 와 돌린다.
const 잰다소스 = (s.match(/function 잰다\(이름, snap\) \{[\s\S]*?\n\}/) || [])[0];
T('잰다() 를 떼어 올 수 있다 — 못 떼면 아래 규칙 시험이 통째로 헛돈다', () => {
  assert.ok(잰다소스 && 잰다소스.includes('fromCache'), '잰다() 를 못 찾았거나 캐시를 안 본다');
});
const 잰다 = new Function('_읽기장부', 'return ' + 잰다소스);
const 스냅 = (n, 캐시) => ({ size: n, metadata: { fromCache: 캐시 }, docChanges: () => Array(n).fill(0) });

T('**캐시에서 온 것은 안 센다** — 돈이 안 나가는데 세면 실제보다 몇 배 크게 보인다', () => {
  const L = {}; const f = 잰다(L);
  f('x', 스냅(500, true));            // 영속 캐시(b41)가 준 것
  assert.equal(L.x.과금, 0, '캐시 스냅숏을 과금으로 셌다');
  assert.equal(L.x.첫, 500, '첫(구독 무게)은 그대로 500 이어야 한다 — 둘은 다른 수다');
});

T('서버에서 온 것만 센다 — 재방문(바뀐 것만 옴)은 적게 나와야 한다', () => {
  const L = {}; const f = 잰다(L);
  f('y', 스냅(500, true));            // 캐시로 먼저 그림
  f('y', 스냅(3, false));             // 서버는 바뀐 3건만 보냈다
  assert.equal(L.y.과금, 3, `재방문인데 ${L.y.과금}건으로 셌다 — 캐시가 있는 뜻이 없어진다`);
});

T('찬 접속(캐시 없음)은 통째로 센다', () => {
  const L = {}; const f = 잰다(L);
  f('z', 스냅(500, false));
  assert.equal(L.z.과금, 500);
});

console.log(`\nboot-reads 테스트 ${n}개 전체 통과 · 부팅 통째 구독 ${통째로.length}개`);

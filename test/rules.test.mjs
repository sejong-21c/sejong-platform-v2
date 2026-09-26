// Firestore 보안 규칙 실검 — **에뮬레이터**에 firestore.rules 를 걸고 실제로 읽고 써 본다.
//
// 왜 만들었나 (2026-09-20): 2단계 3번에서 메신저 규칙을 바꿔야 하는데, 잘못 열면 남의 부서
//   대화가 보인다. 그동안 우리는 규칙을 **시험대 없이 운영에 바로 올리고** 있었다.
//   업계 표준은 에뮬레이터 + 규칙 단위시험이고, 인증을 흉내 낼 수 있는 건 이 라이브러리뿐이다.
//   (방향-점검-2026-09-20.md B-3 참고)
//
// 돌리는 법:
//   npm run rules            ← 에뮬레이터를 띄웠다 끄는 것까지 알아서 한다
//   (Java 필요 — 에뮬레이터가 자바다. PC 는 C:\Program Files\Microsoft\jdk-21.*-hotspot)
//
// 이 시험은 **지금 규칙의 실제 동작을 못 박는 그물**이다. 바꾸면 안 되는 것이 바뀌면 여기서 걸린다.
// `[2단계 끝]` 로 시작하는 것은 2026-09-21 에 뒤집은 것이다 — 그전에는 "지금은 통과한다" 였다.
// 되돌리면 남의 1:1 대화가 다시 열린다. 이 줄들이 그 작업의 정의였다.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 규칙 = readFileSync(join(여기, '..', 'firestore.rules'), 'utf8');
// 포트를 여기 박지 않는다 — firebase.json 과 어긋나면 "에뮬레이터가 안 떴다" 로 헛짚는다.
// (8080 은 이 PC 에서 Docker/WSL 이 쓰고 있어 8181 로 옮겼다. 다른 기계에서 또 겹칠 수 있다.)
const 설정 = JSON.parse(readFileSync(join(여기, '..', 'firebase.json'), 'utf8'));
const 포트 = 설정?.emulators?.firestore?.port;
if (!포트) throw new Error('firebase.json 에 emulators.firestore.port 가 없습니다.');

// ── 등장인물 (users.grade 는 플랫폼과 같은 값: super·exec·manager·member) ──
const 사람 = {
  부장:   { uid: 'u_super', email: 'cwkim@sejong-21c.com',  dept: '품질관리부', grade: 'super' },
  품질원: { uid: 'u_qa',    email: 'qa@sejong-21c.com',     dept: '품질관리부', grade: 'member' },
  생산원: { uid: 'u_prod',  email: 'prod@sejong-21c.com',   dept: '생산부',    grade: 'member' },
  임원:   { uid: 'u_exec',  email: 'exec@sejong-21c.com',   dept: '총무부',    grade: 'exec' },
  재무원: { uid: 'u_fin',   email: 'fin@sejong-21c.com',    dept: '재무부',    grade: 'member' },
  예외:   { uid: 'u_edu',   email: 'hkaiedu@naver.com',     dept: '',          grade: 'member' },
  외부인: { uid: 'u_out',   email: 'someone@gmail.com',     dept: '',          grade: 'member' },
};

let 통과 = 0, 실패 = 0;
const T = async (이름, 하기) => {
  try { await 하기(); 통과++; console.log(`PASS  ${이름}`); }
  catch (e) { 실패++; console.log(`FAIL  ${이름}\n        ${String(e && e.message || e).slice(0, 200)}`); }
};

const env = await initializeTestEnvironment({
  projectId: 'demo-sejong',
  firestore: { rules: 규칙, host: '127.0.0.1', port: 포트 },
});

// ── 씨앗 심기 (규칙을 끄고 넣는다 — 시험 대상이 아니다) ──
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const p of Object.values(사람)) {
    await setDoc(doc(db, 'users', p.uid), { name: p.uid, email: p.email, dept: p.dept, grade: p.grade });
  }
  await setDoc(doc(db, 'channels', 'c1'), { name: '전사 공지', type: 'announce' });
  await setDoc(doc(db, 'channels', 'dept_quality'), { name: '품질관리부', type: 'dept' });
  await setDoc(doc(db, 'channels', 'dept_production'), { name: '생산부', type: 'dept' });
  await setDoc(doc(db, 'channels', 'dm1'), { name: 'DM', type: 'dm', members: [사람.부장.uid, 사람.품질원.uid] });
  // 품질관리부 방 메시지 — readers 에 품질관리부만 들어 있다(b46 부터 보낼 때 박힌다)
  await setDoc(doc(db, 'messages', 'm_quality'), {
    channel: 'dept_quality', author: 사람.품질원.uid, text: '품질 방 이야기',
    readers: [사람.부장.uid, 사람.품질원.uid], createdAt: 1,
  });
  await setDoc(doc(db, 'messages', 'm_dm'), {
    channel: 'dm1', author: 사람.부장.uid, text: '둘만의 이야기',
    readers: [사람.부장.uid, 사람.품질원.uid], createdAt: 2,
  });
  await setDoc(doc(db, 'messages', 'm_announce'), {
    channel: 'c1', author: 사람.부장.uid, text: '전사 공지입니다', createdAt: 3,   // 공지는 readers 를 안 박는다
  });
  await setDoc(doc(db, 't_aiChat', 'ai_super_1'), { uid: 사람.부장.uid, role: 'ai', text: '부장님 AI 대화' });
  await setDoc(doc(db, 't_userProfile', 사람.부장.uid), { phone: '010-0000-0000' });
  await setDoc(doc(db, 'adminAccess', 'list'), { uids: [사람.부장.uid] });
});

const 로그인 = (p) => env.authenticatedContext(p.uid, { email: p.email, email_verified: true }).firestore();
const 손님 = () => env.unauthenticatedContext().firestore();

console.log('── 문 잠금 (사내 계정만)');
await T('로그인 안 하면 users 를 못 읽는다', () => assertFails(getDoc(doc(손님(), 'users', 사람.부장.uid))));
await T('사외 이메일이면 users 를 못 읽는다', () => assertFails(getDoc(doc(로그인(사람.외부인), 'users', 사람.부장.uid))));
await T('사내 계정은 users 를 읽는다', () => assertSucceeds(getDoc(doc(로그인(사람.품질원), 'users', 사람.부장.uid))));
await T('예외 허용 계정(hkaiedu)도 읽는다', () => assertSucceeds(getDoc(doc(로그인(사람.예외), 'users', 사람.부장.uid))));
await T('사외 이메일은 아무 컬렉션도 못 읽는다', () => assertFails(getDoc(doc(로그인(사람.외부인), 'ncrs', 'x'))));

console.log('\n── 직원 명부');
await T('남의 users 문서는 못 고친다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'users', 사람.생산원.uid), { grade: 'super' }, { merge: true })));
// 9/26: 본인 문서는 서명·캘린더 연결 표시만 — 옛 규칙은 자기 dept·grade·name 을 마음대로 바꿀 수 있었다
//   (재무부 경비·게이트웨이 부서 범위·개인 자료 주인 판정이 한꺼번에 뚫린다. 직원 시범 전 검토자 둘이 잡음)
await T('내 서명은 고친다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { signatureUrl: 'data:x' }, { merge: true })));
await T('내 캘린더 연결 표시는 고친다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { gcalConnected: true }, { merge: true })));
await T('내 부서를 재무부로 못 바꾼다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { dept: '재무부' }, { merge: true })));
await T('내 등급을 super 로 못 올린다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { grade: 'super' }, { merge: true })));
await T('내 이름을 못 바꾼다(개인 자료 주인 판정)', () => assertFails(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { name: '남의 이름' }, { merge: true })));
await T('서명에 등급을 끼워 넣어도 안 된다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'users', 사람.품질원.uid), { signatureUrl: 'y', grade: 'exec' }, { merge: true })));
await T('super 는 남의 users 를 고친다', () => assertSucceeds(setDoc(doc(로그인(사람.부장), 'users', 사람.생산원.uid), { name: '고침' }, { merge: true })));
await T('일반 직원은 남을 못 지운다', () => assertFails(deleteDoc(doc(로그인(사람.품질원), 'users', 사람.생산원.uid))));
const 새사람 = { uid: 'u_new', email: 'new@sejong-21c.com' };
await T('첫 로그인에 super 로는 못 만든다', () => assertFails(setDoc(doc(로그인(새사람), 'users', 새사람.uid), { name: '새', email: 새사람.email, dept: '생산부', grade: 'super' })));
await T('첫 로그인 소속 입력(member)은 만든다', () => assertSucceeds(setDoc(doc(로그인(새사람), 'users', 새사람.uid), { name: '새', email: 새사람.email, dept: '생산부', title: '사원', grade: 'member', disabled: false })));

console.log('\n── 사전 등록(pendingUsers)');
// 9/26: 옛 규칙은 사내 누구나 썼다 — 새 이메일로 grade 를 박아 두면 그 계정이 첫 로그인 때 그 등급으로 승격됐다
await env.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), 'adminAccess', 'config'), { uids: [사람.임원.uid] });
  await setDoc(doc(c.firestore(), 'pendingUsers', 'pu_new2'), { email: 'new2@sejong-21c.com', name: '새2', dept: '생산부', grade: 'member' });
});
const 새사람2 = { uid: 'u_new2', email: 'new2@sejong-21c.com' };
await T('일반 직원은 사전 등록을 못 만든다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'pendingUsers', 'pu_x'), { email: 'x@sejong-21c.com', grade: 'exec' })));
await T('super 는 사전 등록을 만든다', () => assertSucceeds(setDoc(doc(로그인(사람.부장), 'pendingUsers', 'pu_s'), { email: 's@sejong-21c.com', grade: 'member' })));
await T('관리 지정자(adminAccess/config)도 만든다', () => assertSucceeds(setDoc(doc(로그인(사람.임원), 'pendingUsers', 'pu_a'), { email: 'a@sejong-21c.com', grade: 'manager' })));
await T('사전 등록에 super 는 못 박는다', () => assertFails(setDoc(doc(로그인(사람.부장), 'pendingUsers', 'pu_ss'), { email: 'ss@sejong-21c.com', grade: 'super' })));
await T('승격된 본인은 자기 문서에 승격 표시를 남긴다', () => assertSucceeds(setDoc(doc(로그인(새사람2), 'pendingUsers', 'pu_new2'), { promotedTo: 새사람2.uid, promotedAt: 1 }, { merge: true })));
await T('승격된 본인도 등급은 못 고친다', () => assertFails(setDoc(doc(로그인(새사람2), 'pendingUsers', 'pu_new2'), { grade: 'exec' }, { merge: true })));
await T('남의 사전 등록은 못 지운다', () => assertFails(deleteDoc(doc(로그인(사람.품질원), 'pendingUsers', 'pu_new2'))));
await T('승격된 본인은 자기 사전 등록을 지운다', () => assertSucceeds(deleteDoc(doc(로그인(새사람2), 'pendingUsers', 'pu_new2'))));
await T('사전 등록 목록은 사내 누구나 읽는다(첫 로그인 이메일 조회)', () => assertSucceeds(getDoc(doc(로그인(사람.품질원), 'pendingUsers', 'pu_s'))));

console.log('\n── 메시지 쓰기');
await T('내 이름으로만 보낼 수 있다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 'messages', 'n1'), { channel: 'dept_quality', author: 사람.품질원.uid, text: 'ㅇㅇ', createdAt: 9 })));
await T('남의 이름을 사칭하면 거부', () => assertFails(setDoc(doc(로그인(사람.품질원), 'messages', 'n2'), { channel: 'dept_quality', author: 사람.생산원.uid, text: '사칭', createdAt: 9 })));
await T('전사 공지는 일반 직원이 못 쓴다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'messages', 'n3'), { channel: 'c1', author: 사람.품질원.uid, text: '공지', createdAt: 9 })));
await T('전사 공지는 부서장 이상이 쓴다', () => assertSucceeds(setDoc(doc(로그인(사람.부장), 'messages', 'n4'), { channel: 'c1', author: 사람.부장.uid, text: '공지', createdAt: 9 })));
await T('임원도 전사 공지를 쓴다', () => assertSucceeds(setDoc(doc(로그인(사람.임원), 'messages', 'n5'), { channel: 'c1', author: 사람.임원.uid, text: '공지', createdAt: 9 })));
await T('SYSTEM 알림은 지정된 방에만', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 'messages', 'n6'), { channel: 'qa-calibration-alert', author: 'SYSTEM', system: true, text: '검교정 임박', createdAt: 9 })));
await T('SYSTEM 을 사칭해 아무 방에나 못 쓴다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'messages', 'n7'), { channel: 'dept_production', author: 'SYSTEM', system: true, text: '가짜', createdAt: 9 })));
await T('보낸 메시지는 고칠 수 없다(update 금지)', () => assertFails(setDoc(doc(로그인(사람.품질원), 'messages', 'm_quality'), { text: '몰래 고침' }, { merge: true })));
await T('내 메시지는 지운다', () => assertSucceeds(deleteDoc(doc(로그인(사람.품질원), 'messages', 'n1'))));
await T('남의 메시지는 못 지운다', () => assertFails(deleteDoc(doc(로그인(사람.생산원), 'messages', 'm_quality'))));

console.log('\n── 메시지 읽기  ⚠ 여기가 2단계 3번에서 뒤집힌다');
// ── 여기가 2단계였다. 2026-09-21 에 뒤집었다 — 이제 readers 에 든 사람만 읽는다. ──
await T('[2단계 끝] 생산부 직원은 품질관리부 방 메시지를 못 읽는다',
  () => assertFails(getDoc(doc(로그인(사람.생산원), 'messages', 'm_quality'))));
await T('[2단계 끝] 남의 1:1 대화는 못 읽는다',
  () => assertFails(getDoc(doc(로그인(사람.생산원), 'messages', 'm_dm'))));
await T('[2단계 끝] messages 를 통째로 훑으면 거부 — 부팅 한 번에 500건씩 읽던 길이 막힌다',
  () => assertFails(getDocs(collection(로그인(사람.생산원), 'messages'))));
await T('[2단계 끝] readers 로 좁히면 열린다 — 화면이 쓰는 바로 그 질의',
  () => assertSucceeds(getDocs(query(collection(로그인(사람.생산원), 'messages'), where('readers', 'array-contains', 사람.생산원.uid)))));
await T('[2단계 끝] 내가 든 방 메시지는 그대로 읽힌다(막기만 하고 끝나면 안 된다)',
  () => assertSucceeds(getDoc(doc(로그인(사람.품질원), 'messages', 'm_quality'))));
await T('[2단계 끝] 남의 readers 로 좁혀서 훔쳐보는 것도 거부',
  () => assertFails(getDocs(query(collection(로그인(사람.생산원), 'messages'), where('readers', 'array-contains', 사람.부장.uid)))));

// **공지는 readers 가 없다**(읽을사람() 이 announce 에 null 을 준다).
// 이걸 안 열어 두면 2단계를 켜는 순간 전사 공지가 아무에게도 안 보인다 — 조용히 사라지는 종류다.
await T('[2단계 끝] 전사 공지는 readers 가 없어도 누구나 읽는다',
  () => assertSucceeds(getDoc(doc(로그인(사람.생산원), 'messages', 'm_announce'))));
await T('[2단계 끝] 공지 채널로 좁힌 조회도 열린다 — 화면이 쓰는 두 번째 질의',
  () => assertSucceeds(getDocs(query(collection(로그인(사람.생산원), 'messages'), where('channel', '==', 'c1')))));

console.log('\n── AI 비서 대화 (이미 본인만)');
await T('남의 AI 대화는 못 읽는다', () => assertFails(getDoc(doc(로그인(사람.생산원), 't_aiChat', 'ai_super_1'))));
await T('내 AI 대화는 읽는다', () => assertSucceeds(getDoc(doc(로그인(사람.부장), 't_aiChat', 'ai_super_1'))));
await T('남의 uid 로 AI 대화를 못 만든다', () => assertFails(setDoc(doc(로그인(사람.생산원), 't_aiChat', 'ai_x'), { uid: 사람.부장.uid, text: '가짜' })));
await T('t_aiChat 목록은 내 것으로 좁혀야 열린다',
  () => assertSucceeds(getDocs(query(collection(로그인(사람.부장), 't_aiChat'), where('uid', '==', 사람.부장.uid)))));
await T('t_aiChat 을 통째로 훑으면 거부', () => assertFails(getDocs(collection(로그인(사람.부장), 't_aiChat'))));

console.log('\n── 그 밖의 잠금장치');
await T('방은 지울 수 없다', () => assertFails(deleteDoc(doc(로그인(사람.부장), 'channels', 'dept_quality'))));
await T('t_userProfile 은 본인만 쓴다', () => assertFails(setDoc(doc(로그인(사람.생산원), 't_userProfile', 사람.부장.uid), { phone: '010-9999-9999' })));
await T('t_userProfile 도 내 것은 쓴다', () => assertSucceeds(setDoc(doc(로그인(사람.부장), 't_userProfile', 사람.부장.uid), { phone: '010-1111-1111' })));
await T('접속 기록은 만들 수만 있다(고치기 금지)', () => assertFails(setDoc(doc(로그인(사람.부장), 'accessLog', 'a1'), { at: 1 }).then(() => setDoc(doc(로그인(사람.부장), 'accessLog', 'a1'), { at: 2 }))));
// 9/26: 옛 aiUsage 는 닫았다 — 코드는 b108 부터 안 쓴다(장부는 게이트웨이 aiUsageDaily). 읽기만 남는다.
await T('옛 AI 사용 기록은 새로 못 만든다', () => assertFails(setDoc(doc(로그인(사람.품질원), 'aiUsage', 'u1'), { uid: 사람.품질원.uid, at: 1 })));
await T('옛 AI 사용 기록은 읽는다', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'aiUsage', 'old1'), { uid: 'x', at: 1 }); });
  await assertSucceeds(getDoc(doc(로그인(사람.품질원), 'aiUsage', 'old1')));
});
// v3.9(2026-09-23): 게이트웨이 장부. 브라우저가 쓸 수 있으면 자기 횟수를 0 으로 되돌려
//   하루 한도를 빠져나간다 — 그러면 한도는 장식이다. super 도 못 쓴다(게이트웨이만 쓴다).
await T('게이트웨이 장부는 아무도 못 쓴다 — super 도', async () => {
  await assertFails(setDoc(doc(로그인(사람.부장), 'aiUsageDaily', '2026-09-23_u1'), { n: 0 }));
  await assertFails(setDoc(doc(로그인(사람.생산원), 'aiUsageDaily', '2026-09-23_u1'), { n: 0 }));
});
await T('게이트웨이 장부는 직원이 읽을 수는 있다 — 누가 얼마나 썼는지 감출 이유가 없다', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'aiUsageDaily', '2026-09-23_u1'), { n: 3 }); });
  await assertSucceeds(getDoc(doc(로그인(사람.생산원), 'aiUsageDaily', '2026-09-23_u1')));
});
// v4.1: 맡긴 개인 API 열쇠. 잠가 뒀지만 **읽는 길 자체를 없앤다** — 남의 계정 토큰 하나로
//   남의 열쇠 덩이를 긁어가는 일이 없게. 게이트웨이만 서비스 계정으로 오간다.
await T('맡긴 개인 열쇠는 본인도 못 읽는다', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'aiUserKeys', 사람.부장.uid), { enc: 'x.y' }); });
  await assertFails(getDoc(doc(로그인(사람.부장), 'aiUserKeys', 사람.부장.uid)));
  await assertFails(setDoc(doc(로그인(사람.부장), 'aiUserKeys', 사람.부장.uid), { enc: 'z' }));
});
// v30.19: 읽기 장부. 브라우저가 스스로 올려야 하니 쓰기를 열되, **지우기는 막는다** —
//   하루치가 통째로 날아가면 그날 얼마 썼는지 영영 모른다(그래서 또 태운다).
await T('읽기 장부는 직원이 올릴 수 있다 — 계량기지 통제가 아니다', () =>
  assertSucceeds(setDoc(doc(로그인(사람.생산원), 'readDaily', '2026-09-22'), { day: '2026-09-22', browser: 12 }, { merge: true })));
await T('읽기 장부는 **지울 수 없다** — super 라도', () =>
  assertFails(deleteDoc(doc(로그인(사람.부장), 'readDaily', '2026-09-22'))));
await T('관리 명단은 super 만 고친다', () => assertFails(setDoc(doc(로그인(사람.임원), 'adminAccess', 'list'), { uids: [] })));
await T('관리 명단을 super 는 고친다', () => assertSucceeds(setDoc(doc(로그인(사람.부장), 'adminAccess', 'list'), { uids: [사람.부장.uid] })));
await T('WBS 공유는 로그인 없이도 읽힌다(설계대로)', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'wbsShares', 's1'), { snap: {} }); });
  await assertSucceeds(getDoc(doc(손님(), 'wbsShares', 's1')));
});
await T('WBS 공유에 손님이 쓰지는 못한다', () => assertFails(setDoc(doc(손님(), 'wbsShares', 's1'), { snap: {} })));

console.log('\n── 품질기록 변경 이력 (ISO 9001 7.5.3) — 2026-09-20');
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 't_ncrs', 'ncr_old'), { title: '옛 기록 — 판이 없다', status: 'open' });
  await setDoc(doc(db, 't_ncrs', 'ncr_v3'), { title: '판이 3', status: 'open', rev: 3 });
  await setDoc(doc(db, 't_recordLog', 'log_old'), { coll: 't_ncrs', recId: 'ncr_old', act: '만듦', by: 사람.부장.uid, at: 1 });
});
await T('이력은 덧붙일 수 있다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 't_recordLog', 'log_a'),
  { coll: 't_ncrs', recId: 'ncr_old', act: '고침', by: 사람.품질원.uid, at: 2, changes: [{ 칸: 'status', 전: 'open', 후: 'closed' }] })));
await T('이력을 남의 이름으로 못 쓴다', () => assertFails(setDoc(doc(로그인(사람.품질원), 't_recordLog', 'log_b'),
  { coll: 't_ncrs', recId: 'ncr_old', act: '고침', by: 사람.생산원.uid, at: 3 })));
await T('이력에 이상한 행위는 못 넣는다', () => assertFails(setDoc(doc(로그인(사람.품질원), 't_recordLog', 'log_c'),
  { coll: 't_ncrs', recId: 'ncr_old', act: '조작', by: 사람.품질원.uid, at: 4 })));
await T('**이력은 고칠 수 없다**', () => assertFails(setDoc(doc(로그인(사람.부장), 't_recordLog', 'log_old'), { act: '만듦', note: '몰래 고침' }, { merge: true })));
await T('**이력은 지울 수 없다 — super 라도**', () => assertFails(deleteDoc(doc(로그인(사람.부장), 't_recordLog', 'log_old'))));
await T('이력은 사내면 읽는다(심사 대응)', () => assertSucceeds(getDoc(doc(로그인(사람.생산원), 't_recordLog', 'log_old'))));

await T('**판을 안 올리면 저장이 거부된다**', () => assertFails(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_v3'), { title: '몰래 고침', rev: 3 })),
);
await T('판을 내리는 것도 거부', () => assertFails(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_v3'), { title: '되돌리기', rev: 2 })));
await T('판이 없으면 거부', () => assertFails(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_v3'), { title: '판 없음' })));
await T('판을 올리면 저장된다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_v3'), { title: '제대로 고침', rev: 4 })));
await T('판이 없던 옛 기록도 1 로 올리면 저장된다', () => assertSucceeds(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_old'), { title: '옛 기록 손봄', rev: 1 })),
);
await T('CAR 도 같은 잣대', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 't_cars', 'car_1'), { title: 'CAR', rev: 1 }); });
  await assertFails(setDoc(doc(로그인(사람.품질원), 't_cars', 'car_1'), { title: '판 그대로', rev: 1 }));
  await assertSucceeds(setDoc(doc(로그인(사람.품질원), 't_cars', 'car_1'), { title: '판 올림', rev: 2 }));
});
await T('새 기록은 판 없이도 만들 수 있다(만들 때는 이력이 만듦 한 줄)', async () => {
  await assertSucceeds(setDoc(doc(로그인(사람.품질원), 't_ncrs', 'ncr_new'), { title: '새 부적합', rev: 1 }));
});

// 2026-09-26 직원 시범 전 대조: t_expense·t_expenseEntries 가 범용 t_ 규칙에 걸려
//   사내 누구나 카드 목록·전 직원 경비를 읽고 지울 수 있었다. 재무부(또는 super·exec)만 본다.
console.log('\n── 업무 경비 — 직원은 제 것만 올린다 (2026-09-26)');
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 't_expense', 'main'), { cards: [{ id: 'c1', name: '법인카드' }], 마감: { '2026-08': { 때: 1, 누가: '재무' } } });
  await setDoc(doc(db, 't_expense', 'lock'), { 마감: { '2026-08': { 때: 1 } } });
  await setDoc(doc(db, 't_expenseEntries', 'M_qa_1'), { id: 'M_qa_1', amount: 1000, 올린이: 사람.품질원.uid });
  await setDoc(doc(db, 't_expenseEntries', 'E_fin_1'), { id: 'E_fin_1', amount: 5000, cardId: 'c1' });
});
const 경비 = (uid, id) => ({ id, amount: 12000, usage: '주유', 올린이: uid });
await T('직원은 제 이름으로 경비를 올린다', () =>
  assertSucceeds(setDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_1'), 경비(사람.생산원.uid, 'M_prod_1'))));
await T('**같은 영수증을 또 올리면 거부** — 두 번째 setDoc 은 update 다(중복 방지)', () =>
  assertFails(setDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_1'), 경비(사람.생산원.uid, 'M_prod_1'))));
await T('남의 이름으로는 못 올린다', () =>
  assertFails(setDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_2'), 경비(사람.품질원.uid, 'M_prod_2'))));
await T('올린이 없이는 직원이 못 만든다', () =>
  assertFails(setDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_3'), { id: 'M_prod_3', amount: 1 })));
await T('제가 올린 것은 읽는다', () => assertSucceeds(getDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_1'))));
await T('**남의 경비는 못 읽는다**', () => assertFails(getDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_qa_1'))));
await T('**경비 내역을 통째로 훑으면 거부**', () => assertFails(getDocs(collection(로그인(사람.생산원), 't_expenseEntries'))));
await T('직원은 제 것도 못 지운다(재무부가 본다)', () => assertFails(deleteDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'M_prod_1'))));
await T('직원은 남의 것을 못 지운다', () => assertFails(deleteDoc(doc(로그인(사람.생산원), 't_expenseEntries', 'E_fin_1'))));
await T('**직원은 경비 설정(카드 목록)을 못 읽는다**', () => assertFails(getDoc(doc(로그인(사람.생산원), 't_expense', 'main'))));
await T('직원은 경비 설정을 못 쓴다', () => assertFails(setDoc(doc(로그인(사람.생산원), 't_expense', 'main'), { cards: [] })));
await T('직원도 마감 표시(lock)는 읽는다 — 메신저가 올리기 전에 본다', () =>
  assertSucceeds(getDoc(doc(로그인(사람.생산원), 't_expense', 'lock'))));
await T('직원은 마감 표시를 못 쓴다', () => assertFails(setDoc(doc(로그인(사람.생산원), 't_expense', 'lock'), { 마감: {} })));
await T('사외 계정은 마감 표시도 못 읽는다', () => assertFails(getDoc(doc(로그인(사람.외부인), 't_expense', 'lock'))));
await T('재무부는 설정을 읽고 쓴다', async () => {
  await assertSucceeds(getDoc(doc(로그인(사람.재무원), 't_expense', 'main')));
  await assertSucceeds(setDoc(doc(로그인(사람.재무원), 't_expense', 'main'), { cards: [], updatedAt: 2 }));
  await assertSucceeds(setDoc(doc(로그인(사람.재무원), 't_expense', 'lock'), { 마감: { '2026-08': { 때: 2 } } }));
});
await T('재무부는 내역 전체를 읽는다 — expense.html 이 쓰는 바로 그 질의(getDocs 통째로)', () =>
  assertSucceeds(getDocs(collection(로그인(사람.재무원), 't_expenseEntries'))));
await T('재무부는 남이 올린 내역을 고치고 지운다', async () => {
  await assertSucceeds(setDoc(doc(로그인(사람.재무원), 't_expenseEntries', 'M_qa_1'), { id: 'M_qa_1', amount: 1000, cardId: 'c1', 올린이: 사람.품질원.uid }));
  await assertSucceeds(deleteDoc(doc(로그인(사람.재무원), 't_expenseEntries', 'M_prod_1')));
});
await T('재무부는 올린이 없이 손으로 내역을 넣는다', () =>
  assertSucceeds(setDoc(doc(로그인(사람.재무원), 't_expenseEntries', 'E_fin_2'), { id: 'E_fin_2', amount: 3000, cardId: 'c1' })));
await T('임원은 설정과 내역을 읽는다', async () => {
  await assertSucceeds(getDoc(doc(로그인(사람.임원), 't_expense', 'main')));
  await assertSucceeds(getDocs(collection(로그인(사람.임원), 't_expenseEntries')));
});
await T('super 도 내역을 읽는다', () => assertSucceeds(getDocs(collection(로그인(사람.부장), 't_expenseEntries'))));
await T('다른 부서 직원(품질)은 설정을 못 읽는다', () => assertFails(getDoc(doc(로그인(사람.품질원), 't_expense', 'main'))));

await env.cleanup();
console.log(`\n통과 ${통과} · 실패 ${실패}`);
process.exit(실패 ? 1 : 0);

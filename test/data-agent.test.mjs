/* 데이터 에이전트 ②의도 가르기 · ③묶어 세기 (modules/messenger/ai.js, 2026-09-25 b103).
 *
 * 왜 시험하나: 여기서 틀리면 **그럴듯한 틀린 수**가 나온다 — 제일 나쁜 종류다.
 *   · 갈래가 틀리면 NAS 엑셀에서 센 수로 NCR 을 답하거나, 세야 할 것을 검색 조각으로 어림한다.
 *   · 기간이 한 달 밀리면 "이번 분기 NCR 7건" 이 조용히 틀린다.
 *   · 9/24 시험으로 남긴 무효 NCR·CAR 를 세면 건수가 하나씩 는다.
 */
import assert from 'node:assert';
import { 의도가르기, 기간뽑기, 축고르기, 묶어세기, 기록세기, 셀것, 답하기 } from '../modules/messenger/ai.js';

let n = 0;
const T = async (why, fn) => { try { await fn(); n++; } catch (e) { console.error('✗', why); throw e; } };
const NCR = 셀것.find((s) => s.컬렉션 === 't_ncrs');
const CAR = 셀것.find((s) => s.컬렉션 === 't_cars');

// ── ② 의도 가르기 ──────────────────────────────────────────────────────────
await T('플랫폼 기록을 세면 기록 갈래 — NAS 표로 가지 않는다', () => {
  const r = 의도가르기('올해 NCR 몇 건이야?');
  assert.equal(r.갈래, '기록');
  assert.equal(r.대상[0].컬렉션, 't_ncrs');
  assert.equal(r.축, null);
});
await T('세는 말이 없어도 "원인별로" 면 기록 갈래 + 원인 축', () => {
  const r = 의도가르기('부적합 원인별로 정리해줘');
  assert.deepEqual([r.갈래, r.축], ['기록', '원인']);
});
await T('세부 원인이 원인보다 먼저 걸린다', () => assert.equal(축고르기('NCR 세부 원인별 분포', NCR), '세부원인'));
await T('그 기록에 없는 축은 안 고른다(CAR 에는 업체 칸이 없다)', () => assert.equal(축고르기('CAR 업체별', CAR), null));
await T('시간 축 — 월별·추이·분기별', () => {
  assert.equal(축고르기('NCR 월별 추이', NCR), '월');
  assert.equal(축고르기('NCR 추이 보여줘', NCR), '월');
  assert.equal(축고르기('CAR 분기별로', CAR), '분기');
});
await T('기록 이름 없이 세면 표 갈래(NAS 엑셀)', () => assert.equal(의도가르기('작년 견적 재료비 총액').갈래, '표'));
await T('세지 않으면 찾기 — 발행해 달라는 말은 기록 갈래가 아니다', () => {
  assert.equal(의도가르기('NCR 발행해줘').갈래, '찾기');
  assert.equal(의도가르기('SJ-NCR-2026-05 내용 알려줘').갈래, '찾기');
});

// ── 기간 ──────────────────────────────────────────────────────────────────
const 지금 = new Date(2026, 8, 25);   // 2026-09-25 (3분기)
await T('이번 분기 · 지난 분기 · N분기', () => {
  assert.deepEqual(기간뽑기('이번 분기 NCR', 지금), { 시작: '2026-07-01', 끝: '2026-09-30', 말: '2026년 3분기' });
  assert.equal(기간뽑기('지난 분기', 지금).시작, '2026-04-01');
  assert.equal(기간뽑기('지난 분기', new Date(2026, 1, 3)).말, '2025년 4분기', '1분기의 지난 분기는 작년 4분기');
  assert.deepEqual([기간뽑기('2025년 2분기', 지금).시작, 기간뽑기('2025년 2분기', 지금).끝], ['2025-04-01', '2025-06-30']);
});
await T('달 — 이번 달 · 지난달(1월이면 작년 12월) · N월 · 말일', () => {
  assert.equal(기간뽑기('이번 달', 지금).끝, '2026-09-30');
  assert.equal(기간뽑기('지난달', new Date(2026, 0, 10)).말, '2025년 12월');
  assert.deepEqual([기간뽑기('2월 NCR', 지금).시작, 기간뽑기('2월 NCR', 지금).끝], ['2026-02-01', '2026-02-28']);
  assert.equal(기간뽑기('2024년 2월', 지금).끝, '2024-02-29', '윤년');
});
await T('"월별" 은 기간이 아니다 · "3개월" 도 아니다 · 없으면 null', () => {
  assert.equal(기간뽑기('NCR 월별', 지금), null);
  assert.equal(기간뽑기('최근 3개월', 지금), null);
  assert.equal(기간뽑기('NCR 몇 건', 지금), null);
  assert.equal(기간뽑기('올해 상반기', 지금).끝, '2026-06-30');
});

// ── ③ 묶어 세기 ────────────────────────────────────────────────────────────
const 기록 = [
  { id: 'SJ-NCR-2026-01', cause: '설계불량', grade: 'minor', status: 'closed', issuedAt: '2026-01-10', proj: 'p1' },
  { id: 'SJ-NCR-2026-02', cause: '절차미준수', grade: 'minor', status: 'open', issuedAt: '2026-01-20', proj: '__direct__', meta: { projDirect: '삼성전기' } },
  { id: 'SJ-NCR-2026-03', cause: '절차미준수', grade: 'obs', status: 'open', issuedAt: '2026-04-02', proj: 'p1' },
  { id: 'SJ-NCR-2026-04', cause: '', grade: 'major', status: 'closed', issuedAt: '2026-08-30' },
  { id: 'NCR-2026-001', desc: '[시험 발행 — 무효] [시험] AI 행위 점검', cause: '절차미준수', issuedAt: '2026-09-24' },
];
await T('무효 시험 기록은 빼고 센다(9/24 NCR-2026-001)', () => {
  const r = 묶어세기(기록, NCR, null);
  assert.deepEqual([r.수, r.뺀것, r.줄], [4, 1, null]);
});
await T('원인별 — 많은 순, 빈 값은 (비어 있음)', () => {
  const r = 묶어세기(기록, NCR, '원인');
  assert.deepEqual(r.줄, [{ 원인: '절차미준수', 건수: 2 }, { 원인: '설계불량', 건수: 1 }, { 원인: '(비어 있음)', 건수: 1 }]);
});
await T('등급·상태는 화면과 같은 말로(minor → 일반)', () => {
  assert.deepEqual(묶어세기(기록, NCR, '등급').줄.map((x) => x.등급).sort(), ['경미', '일반', '중대']);
  assert.ok(묶어세기(기록, NCR, '상태').줄.some((x) => x.상태 === '진행중' && x.건수 === 2));
});
await T('프로젝트 — id 는 이름으로, 직접 입력은 적은 이름으로', () => {
  const r = 묶어세기(기록, NCR, '프로젝트', { 프로젝트이름: (id) => (id === 'p1' ? 'SJ435 삼성' : id) });
  assert.ok(r.줄.some((x) => x.프로젝트 === 'SJ435 삼성' && x.건수 === 2));
  assert.ok(r.줄.some((x) => x.프로젝트 === '삼성전기'));
});
await T('월별·분기별은 때 순', () => {
  assert.deepEqual(묶어세기(기록, NCR, '월').줄.map((x) => x.월), ['2026-01', '2026-04', '2026-08']);
  assert.deepEqual(묶어세기(기록, NCR, '분기').줄, [{ 분기: '2026년 1분기', 건수: 2 }, { 분기: '2026년 2분기', 건수: 1 }, { 분기: '2026년 3분기', 건수: 1 }]);
});

// ── 기록세기 — 가짜 fb 로 읽기 길 ─────────────────────────────────────────
const 가짜fb = (문서들, 건수 = 문서들.length) => {
  const 한일 = [];
  return {
    한일, db: {},
    collection: (_db, c) => ({ c }),
    where: (...a) => a,
    query: (밑, ...조건) => ({ c: 밑.c, 조건 }),
    getCountFromServer: async (q) => { 한일.push(['count', q.c, q.조건.length]); return { data: () => ({ count: 건수 }) }; },
    getDocs: async (q) => { 한일.push(['docs', q.c]); return { docs: 문서들.map((d) => ({ id: d.id, data: () => d })) }; },
  };
};
await T('기록 갈래가 아니면 하나도 안 읽는다', async () => {
  const fb = 가짜fb(기록);
  assert.deepEqual(await 기록세기('작년 견적 재료비 총액', fb), []);
  assert.equal(fb.한일.length, 0);
});
await T('먼저 세고(읽기 1) 적으면 받아서 묶는다 · 기간은 날짜 칸 범위 둘', async () => {
  const fb = 가짜fb(기록);
  const [r] = await 기록세기('올해 NCR 원인별로', fb);
  assert.deepEqual(fb.한일, [['count', 't_ncrs', 2], ['docs', 't_ncrs']]);
  assert.deepEqual([r.수, r.뺀것, r.축, r.기간], [4, 1, '원인', '2026년']);
  assert.equal(r.줄[0].원인, '절차미준수');
});
await T('많으면 받지 않고 건수만 — 그리고 못 묶었다고 말한다', async () => {
  const fb = 가짜fb(기록, 5000);
  const [r] = await 기록세기('NCR 원인별', fb);
  assert.deepEqual(fb.한일, [['count', 't_ncrs', 0]]);
  assert.ok(r.수 === 5000 && /묶지 않았다/.test(r.못묶음));
});
await T('못 읽으면 조용히 빼지 않고 오류를 남긴다', async () => {
  const fb = { ...가짜fb([]), getCountFromServer: async () => { throw new Error('permission-denied'); } };
  const [r] = await 기록세기('CAR 몇 건', fb);
  assert.ok(/permission/.test(r.오류));
});

// ── 너무 큰 요청은 줄여서 다시(2026-09-25 groq 413) ─────────────────────
await T('413 이면 맥락을 줄여 같은 모델로 다시 보낸다 — 맥락 뒤(검색 조각)부터 빠진다', async () => {
  const 보낸몸 = [];
  const 원fetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); 보낸몸.push({ url, 시스템길이: b.messages[0].content.length, 앞말: b.messages.length - 2 });
    if (보낸몸.length === 1) return { ok: false, status: 413, json: async () => ({ error: { message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 8237' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '재료비 총액은 …' } }] }) };
  };
  try {
    const 히스토리 = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', text: '앞말 ' + i }));
    const r = await 답하기({ 질문: '작년 견적 재료비 총액', 히스토리, 맥락: '표 결과 '.repeat(2000) + '검색 조각 '.repeat(2000), 권한: {}, fb: { auth: { currentUser: { getIdToken: async () => 't' } } } });
    assert.equal(r.text, '재료비 총액은 …');
    assert.equal(보낸몸.length, 2, '한 번 줄여서 다시');
    assert.ok(보낸몸[1].url === 보낸몸[0].url, '같은 모델로 — 다음 회사로 넘기지 않는다');
    assert.ok(보낸몸[1].시스템길이 < 보낸몸[0].시스템길이 * 0.8, '지침(맥락 포함)이 줄었다');
    assert.ok(보낸몸[1].앞말 <= 4 && 보낸몸[0].앞말 > 4, '앞 대화도 넷까지만');
  } finally { globalThis.fetch = 원fetch; }
});

console.log(`data-agent 테스트 ${n}개 전체 통과 (의도 가르기 · 기간 · 묶어 세기 · 읽기 길)`);

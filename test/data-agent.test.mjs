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

// ── 너무 큰 요청은 줄여서 다시(2026-09-25 groq 413 · b105 검토 뒤 다시 짬) ─────────────────────
const 가짜로부르기 = async (응답들, 맥락) => {
  const 보낸몸 = [];
  const 원fetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); 보낸몸.push({ url: url + '#' + b.model, 시스템길이: b.messages[0].content.length });
    const 몇째 = 보낸몸.length - 1;
    if (응답들[몇째] === 413) return { ok: false, status: 413, json: async () => ({ error: { message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 8237' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '재료비 총액은 …' } }] }) };
  };
  try {
    const r = await 답하기({ 질문: '작년 견적 재료비 총액', 히스토리: [], 맥락, 권한: {}, fb: { auth: { currentUser: { getIdToken: async () => 't' } } } });
    return { r, 보낸몸 };
  } finally { globalThis.fetch = 원fetch; }
};
await T('413 이면 같은 모델로 한도를 낮춰 **더 작게** 다시 — 급 낮은 조각이 더 빠진다', async () => {
  const 맥락 = Array.from({ length: 60 }, (_, i) => ({ 글: `[문서${i}] ` + '검색 조각 내용 '.repeat(20), 급: 60, 무리: '문서', 문서: '문서' + i }));
  const { r, 보낸몸 } = await 가짜로부르기([413, 200], 맥락);
  assert.equal(r.text, '재료비 총액은 …');
  assert.equal(보낸몸.length, 2);
  assert.equal(보낸몸[1].url, 보낸몸[0].url, '같은 모델로 — 다음 회사로 넘기지 않는다');
  assert.ok(보낸몸[1].시스템길이 < 보낸몸[0].시스템길이 * 0.9, `둘째가 더 작아야 한다: ${보낸몸[0].시스템길이} → ${보낸몸[1].시스템길이}`);
  assert.ok(r.남은문서.length < 60 && r.남은문서.length > 0, '보낸 문서만 남은문서로 — 출처 칩이 이걸 본다');
  assert.equal(r.토큰.다시, 1, '실제로 보낸 몸의 기록(재시도 뒤)');
});
await T('더 줄일 것이 없으면 같은 몸을 되풀이하지 않고 다음 모델로 — 이유는 남긴다', async () => {
  const { r, 보낸몸 } = await 가짜로부르기([413, 200], '짧은 맥락');
  assert.equal(보낸몸.length, 2, '같은 몸을 세 번 보내지 않는다');
  assert.notEqual(보낸몸[1].url, 보낸몸[0].url, '다음 모델로 넘어갔다');
  assert.equal(r.text, '재료비 총액은 …');
});

// ── 넓히기(2026-09-25 b106): 두 축 교차표 · 값으로 축 고르기 · 측정기구·자산·라이선스·WBS ─────────
const { 축들고르기, 값으로축고르기, 줄펴기 } = await import('../modules/messenger/ai.js');
const 측정 = 셀것.find((s) => s.컬렉션 === 'measurementTools');
const 자산 = 셀것.find((s) => s.컬렉션 === 't_devices');
const WBS = 셀것.find((s) => s.컬렉션 === 'wbsData');
await T('두 축 — 질문에 나온 순서대로(앞 = 줄, 뒤 = 열) · 세부원인은 원인을 품는다', () => {
  assert.deepEqual(축들고르기('NCR 월별 원인별로', NCR), ['월', '원인']);
  assert.deepEqual(축들고르기('NCR 원인별 월별로', NCR), ['원인', '월']);
  assert.deepEqual(축들고르기('NCR 세부 원인별', NCR), ['세부원인']);
  const r = 의도가르기('올해 NCR 프로젝트별 상태별로 정리해줘');
  assert.deepEqual([r.갈래, r.축, r.축2], ['기록', '프로젝트', '상태']);
});
await T('교차표 — 줄마다 합계와 열값, 줄은 때 순', () => {
  const r = 묶어세기(기록, NCR, '분기', { 축2: '원인' });
  assert.deepEqual(r.열, ['절차미준수', '설계불량', '(비어 있음)']);
  assert.deepEqual(r.줄[0], { 분기: '2026년 1분기', 합계: 2, 절차미준수: 1, 설계불량: 1, '(비어 있음)': 0 });
  assert.equal(r.줄.reduce((a, x) => a + x.합계, 0), r.수, '합계를 더하면 전체');
});
await T('교차표 열이 많으면 8개 + 그 밖 — 표가 옆으로 끝없이 늘지 않는다', () => {
  const 많다 = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i, cause: '원인' + i, issuedAt: '2026-0' + (1 + (i % 3)) + '-01' }));
  const r = 묶어세기(많다, NCR, '월', { 축2: '원인' });
  assert.equal(r.열.length, 9);
  assert.equal(r.열[8], '그 밖');
  assert.equal(r.줄.reduce((a, x) => a + x['그 밖'], 0), 12);
});
await T('연도 축 값은 "2026년" — 수로 읽혀 차트가 이름·값 칸을 바꿔 잡지 않게', () => {
  assert.equal(묶어세기(기록, NCR, '연도').줄[0].연도, '2026년');
});
await T('축을 안 말해도 기록의 값이 나오면 그 축으로 묶는다("교정 만료 몇 개" · "세창엔텍 NCR")', () => {
  const 기구 = [{ status: 'normal' }, { status: 'calib_expired' }, { status: 'calib_expired' }];
  assert.equal(값으로축고르기('교정 만료된 측정기구 몇 개야?', 기구, 측정), '상태');
  assert.equal(값으로축고르기('세창엔텍 NCR 몇 건', [{ vendor: '세창엔텍' }, { vendor: '대성테크' }], NCR), '업체');
  assert.equal(값으로축고르기('측정기구 몇 개야?', 기구, 측정), null, '값이 안 나오면 묶지 않는다');
  assert.deepEqual(묶어세기(기구, 측정, '상태').줄, [{ 상태: '교정 만료', 건수: 2 }, { 상태: '정상', 건수: 1 }]);
});
await T('자산 — 종류·상태를 화면 말로, 구입연도는 "2016년"', () => {
  const pc = [{ type: 'laptop', status: 'aged', purchaseYear: 2016 }, { type: 'desktop', status: 'active', purchaseYear: '2016' }];
  assert.deepEqual(묶어세기(pc, 자산, '종류').줄.map((x) => x.종류).sort(), ['노트북', '데스크톱']);
  assert.ok(묶어세기(pc, 자산, '상태').줄.some((x) => x.상태 === '노후'));
  assert.deepEqual(묶어세기(pc, 자산, '구입연도').줄, [{ 구입연도: '2016년', 건수: 2 }]);
});
await T('사람 이름 축은 없다 — 라이선스·PC 사용자를 사람별로 세지 않는다', () => {
  for (const s of 셀것) for (const [, 정] of Object.entries(s.축 || {})) {
    const 칸 = Array.isArray(정) ? 정[0] : 정;
    assert.ok(!/user|userName|assignee|mgr|byName|issuerName/i.test(칸), `${s.이름}: ${칸}`);
  }
});
await T('WBS — 말단 줄만 · 끝날 지났는데 완료 아니면 지연 · 부서 자체 업무 이름', () => {
  const 문서 = [{ id: 'p1', rows: [
    { id: 'a', projId: 'p1', lv: 0, name: '제작', e: '2000-01-01' },
    { id: 'b', projId: 'p1', lv: 1, name: '용접', e: '2000-01-01', status: '진행중' },
    { id: 'c', projId: 'p1', lv: 1, name: '도장', e: '2999-01-01', status: '미시작' },
    { id: 'd', projId: 'p1', lv: 0, name: '출하', e: '2000-01-01', status: '완료' }] },
  { id: 'dept_quality', rows: [{ id: 'q', projId: 'dept_quality', lv: 0, dept: '품질관리부', name: '내부심사', e: '2999-12-31' }] }];
  const 줄 = 줄펴기(문서, WBS);
  assert.deepEqual(줄.map((w) => w.id), ['b', 'c', 'd', 'q'], '대단락 a 는 자식이 있어 빠진다');
  assert.deepEqual(줄.map((w) => w.__wbs상태), ['지연', '미시작', '완료', '미시작']);
  const r = 묶어세기(문서, WBS, '프로젝트', { 프로젝트이름: (id) => (id === 'p1' ? 'SJ435 삼성' : id) });
  assert.deepEqual(r.줄.map((x) => x.프로젝트), ['SJ435 삼성', '품질관리부 자체 업무']);
  assert.equal(r.수, 4);
});
await T('기록세기 — WBS 는 문서를 받아 줄의 끝날로 기간을 거른다 · 측정기구는 "다음 교정일" 기준', async () => {
  const 문서 = [{ id: 'p1', rows: [{ id: 'b', projId: 'p1', lv: 0, e: '2026-09-10', status: '진행중' }, { id: 'c', projId: 'p1', lv: 0, e: '2027-01-10' }] }];
  const fb = 가짜fb(문서);
  const [r] = await 기록세기('이번 달 끝나는 공정 몇 개야', fb, { 의도: { ...의도가르기('이번 달 끝나는 공정 몇 개야'), 기간: { 시작: '2026-09-01', 끝: '2026-09-30', 말: '2026년 9월' } } });
  assert.deepEqual(fb.한일, [['count', 'wbsData', 0], ['docs', 'wbsData']], 'WBS 는 문서 단위 범위 질의를 안 건다');
  assert.equal(r.수, 1);
  const fb2 = 가짜fb([{ id: 't1', status: 'normal', nextCalibration: '2026-09-20' }]);
  const [m] = await 기록세기('이번 달 교정 도래 측정기구 몇 개', fb2, { 의도: { ...의도가르기('이번 달 교정 측정기구 몇 개'), 기간: { 시작: '2026-09-01', 끝: '2026-09-30', 말: '2026년 9월' } } });
  assert.equal(m.기준, '다음 교정일');
  assert.deepEqual(fb2.한일[0], ['count', 'measurementTools', 2]);
});

console.log(`data-agent 테스트 ${n}개 전체 통과 (의도 가르기 · 기간 · 묶어 세기 · 읽기 길)`);

// SJ 메신저 lib.js 단위 검사 — 브라우저 없이.  node test/messenger-lib.test.mjs
// 시각 검사는 전부 로컬 시간대로 Date 를 만들어 어느 기계에서도 같은 답이 나오게 한다.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const L = await import(new URL('../modules/messenger/lib.js', import.meta.url).href);

let 실패 = 0;
const 확인 = (이름, 실제, 기대) => {
  const ok = JSON.stringify(실제) === JSON.stringify(기대);
  if (!ok) 실패++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${이름}${ok ? '' : `  — 기대 ${JSON.stringify(기대)} / 실제 ${JSON.stringify(실제)}`}`);
};

// 초성
확인('초성 김철우', L.초성('김철우'), 'ㄱㅊㅇ');
확인('초성 쌍자음→기본', L.초성('까따빠싸짜'), 'ㄱㄷㅂㅅㅈ');
확인('초성 자모 단독', L.초성('ㄱㅊ'), 'ㄱㅊ');
확인('초성 영문 대문자', L.초성('alice'), 'ALICE');
확인('섹션키 한글', L.섹션키('김철우'), 'ㄱ');
확인('섹션키 쌍자음', L.섹션키('까치'), 'ㄱ');
확인('섹션키 영문', L.섹션키('alice kim'), 'A');
확인('섹션키 숫자', L.섹션키('123'), '#');
확인('섹션키 빈값', L.섹션키(''), '#');

// 검색 순위
확인('일치 접두', L.이름일치('김철우', '김'), 1);
확인('일치 초성', L.이름일치('김철우', 'ㄱㅊ'), 2);
확인('일치 초성 한 글자', L.이름일치('강대헌', 'ㄱ'), 2);
확인('일치 부분', L.이름일치('김철우', '철우'), 3);
확인('일치 extra', L.이름일치('김철우', '품질', ['품질관리부']), 4);
확인('불일치', L.이름일치('강대헌', '김'), 0);
확인('빈 질의', L.이름일치('강대헌', '  '), 0);
확인('영문 대소문자 무시', L.이름일치('Alice Kim', 'al'), 1);

// 정렬·섹션
const 사람들 = [{ id: 'a', name: '홍길동' }, { id: 'b', name: '김철우' }, { id: 'c', name: 'Alice' }, { id: 'd', name: '강대헌' }, { id: 'e', name: '123' }, { id: 'f', name: '김강일' }];
확인('사람정렬', 사람들.slice().sort(L.사람정렬).map((u) => u.name), ['강대헌', '김강일', '김철우', '홍길동', '123', 'Alice'].sort((a, b) => a.localeCompare(b, 'ko')));
const 섹 = L.섹션나누기(사람들);
확인('섹션 순서', 섹.map((s) => s.key), ['ㄱ', 'ㅎ', 'A', '#']);
확인('ㄱ 섹션 내용', 섹[0].items.map((u) => u.name), ['강대헌', '김강일', '김철우']);
확인('색인키 길이', L.색인키.length, 14 + 26 + 1);

// 이니셜·색
확인('이니셜 3자', L.이니셜('김철우'), '철우');
확인('이니셜 2자', L.이니셜('김진'), '진');
확인('이니셜 4자', L.이니셜('남궁민수'), '민수');
확인('이니셜 영문', L.이니셜('alice kim'), 'AL');
확인('이니셜 빈값', L.이니셜(''), '?');
확인('아바타색 결정성', L.아바타색('u_kim') === L.아바타색('u_kim'), true);
확인('아바타색 hex', /^#[0-9a-f]{6}$/.test(L.아바타색('anything')), true);

// 시각 (로컬)
const t = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const now = t(2026, 9, 18, 14, 0);
확인('말풍선시각 오후', L.말풍선시각(t(2026, 9, 18, 12, 39)), '오후 12:39');
확인('말풍선시각 오전 0시', L.말풍선시각(t(2026, 9, 18, 0, 5)), '오전 12:05');
확인('말풍선시각 오전', L.말풍선시각(t(2026, 9, 18, 9, 7)), '오전 9:07');
확인('목록시각 오늘', L.목록시각(t(2026, 9, 18, 12, 39), now), '오후 12:39');
확인('목록시각 어제', L.목록시각(t(2026, 9, 17, 23, 59), now), '어제');
확인('목록시각 올해', L.목록시각(t(2026, 8, 25, 10, 0), now), '8월 25일');
확인('목록시각 다른 해', L.목록시각(t(2024, 7, 26, 10, 0), now), '2024. 7. 26.');
확인('목록시각 0', L.목록시각(0, now), '');
확인('날짜선', L.날짜선(t(2026, 9, 18)), '2026년 9월 18일 금요일');

// 메시지 시각 파싱
확인('시각 createdAt', L.메시지시각ms({ createdAt: 1700000000000 }), 1700000000000);
확인('시각 at 메신저형', L.메시지시각ms({ at: '2026-09-01 09:00' }), t(2026, 9, 1, 9, 0));
확인('시각 at ko-KR', L.메시지시각ms({ at: '2026. 9. 18. 오후 3:12:05' }), new Date(2026, 8, 18, 15, 12, 5).getTime());
확인('시각 at ISO', L.메시지시각ms({ at: '2026-09-18T06:12:05.000Z' }), Date.parse('2026-09-18T06:12:05.000Z'));
확인('시각 못 읽음', L.메시지시각ms({ at: '언제였지' }), 0);

// 묶음
const a = { author: 'u1', createdAt: t(2026, 9, 18, 12, 39) }, b = { author: 'u1', createdAt: t(2026, 9, 18, 12, 39) + 30000 };
확인('묶음 같은 분', L.같은묶음(a, b), true);
확인('묶음 다른 사람', L.같은묶음(a, { ...b, author: 'u2' }), false);
확인('묶음 다른 분', L.같은묶음(a, { ...b, createdAt: t(2026, 9, 18, 12, 40) }), false);
확인('묶음 시스템 제외', L.같은묶음(a, { ...b, system: true }), false);

// 미리보기
확인('미리보기 텍스트', L.미리보기({ text: '안녕\n하세요' }), '안녕 하세요');
확인('미리보기 긴 글', L.미리보기({ text: 'a'.repeat(70) }).length, 61);
확인('미리보기 사진', L.미리보기({ type: 'image', file: 'x.jpg' }), '사진을 보냈습니다.');
확인('미리보기 사진(확장자)', L.미리보기({ file: 'IMG_01.JPG' }), '사진을 보냈습니다.');
확인('미리보기 파일', L.미리보기({ file: '도면.pdf' }), '파일: 도면.pdf');
확인('미리보기 빈', L.미리보기({}), '');

// 방 이름·멤버
const users = [
  { id: 'u_kim', name: '김철우', dept: '품질관리부', title: '부장' },
  { id: 'u_shin', name: '신채완', dept: '품질관리부', title: '과장' },
  { id: 'u_kang', name: '강대헌', dept: '영업부', title: '차장' },
  { id: 'u_off', name: '오하늘', dept: '현장시공', title: '사원', disabled: true },
];
확인('방이름 dm', L.방이름({ type: 'dm', members: ['u_kim', 'u_kang'] }, users, 'u_kim'), '강대헌 차장');
확인('방이름 나와의 채팅', L.방이름({ type: 'dm', members: ['u_kim'] }, users, 'u_kim'), '나와의 채팅');
확인('방이름 그룹', L.방이름({ type: 'group', name: 'AI Team' }, users, 'u_kim'), 'AI Team');
const projects = [{ id: 'p1', pm: 'u_kang', members: { quality: ['u_kim', 'u_shin'], construction: ['u_off'] } }, { id: 'p2', pm: 'u_kim', members: ['u_shin', 'u_shin'] }];
확인('방멤버 프로젝트 객체형', L.방멤버({ type: 'project', projectId: 'p1' }, users, projects).sort(), ['u_kang', 'u_kim', 'u_shin']);
확인('방멤버 프로젝트 배열형·중복 제거', L.방멤버({ type: 'project', id: 'proj_p2' }, users, projects).sort(), ['u_kim', 'u_shin']);
확인('방멤버 프로젝트 없음 → 전원', L.방멤버({ type: 'project', projectId: 'p9' }, users, projects).length, 3);
확인('방멤버 부서', L.방멤버({ type: 'dept', name: '품질관리부' }, users, projects).sort(), ['u_kim', 'u_shin']);
확인('방멤버 공지 disabled 제외', L.방멤버({ type: 'announce' }, users, projects).length, 3);
확인('방멤버 그룹', L.방멤버({ type: 'group', members: ['u_kim', 'u_off', 'u_kang'] }, users, projects).sort(), ['u_kang', 'u_kim']);

// 채팅 정렬
const rows = [
  { name: '나', pinned: false, lastAt: 0 }, { name: '가', pinned: false, lastAt: 100 },
  { name: '다', pinned: true, lastAt: 5 }, { name: '라', pinned: false, lastAt: 200 },
];
확인('채팅정렬', rows.slice().sort(L.채팅정렬).map((r) => r.name), ['다', '라', '가', '나']);

// AI 답변 서식 — 말풍선 안에 들어갈 HTML.  (줄바꿈은 nl 로 만든다 — 이 파일을 만드는 도구가 역슬래시를 먹는다)
const nl = String.fromCharCode(10);
확인('서식 글머리표', L.서식('- 하나' + nl + '- 둘'), '<ul><li>하나</li><li>둘</li></ul>');
확인('서식 번호목록', L.서식('1. 하나' + nl + '2) 둘'), '<ol><li>하나</li><li>둘</li></ol>');
확인('서식 굵게·코드', L.서식('**굵게** 와 `코드`'), '<p><strong>굵게</strong> 와 <code>코드</code></p>');
확인('서식 제목', L.서식('## 제목'), '<div class="sjm-md-h">제목</div>');
확인('서식 표', L.서식('| a | b |' + nl + '|---|---|' + nl + '| 1 | 2 |'),
  '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
확인('서식 인용', L.서식('> 인용'), '<blockquote>인용</blockquote>');
확인('서식 구분선', L.서식('---'), '<hr>');
확인('서식 링크', L.서식('https://a.b/c'), '<p><a href="https://a.b/c" target="_blank" rel="noopener">https://a.b/c</a></p>');
// AI 가 태그를 뱉어도 글자로만 남아야 한다 — 말풍선은 innerHTML 로 들어간다
확인('서식 태그 이스케이프', L.서식('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
확인('서식 표 안 태그도 이스케이프', L.서식('| <b>x</b> |' + nl + '|---|' + nl + '| y |').includes('&lt;b&gt;x&lt;/b&gt;'), true);
확인('서식 빈값', L.서식(''), '');
확인('서식 목록 뒤 문단', L.서식('- 하나' + nl + nl + '끝'), '<ul><li>하나</li></ul><p>끝</p>');

// AI 권한 — 사원이 임원 자료를 보지 못하게 (부장님 지시 9/18)
확인('권한 임원', L.AI권한({ grade: 'exec', dept: '경영지원' }).범위, '전사');
확인('권한 최고관리자', L.AI권한({ grade: 'super' }).범위, '전사');
확인('권한 부서장', L.AI권한({ grade: 'manager', dept: '품질관리부' }).범위, '부서');
확인('권한 사원', L.AI권한({ dept: '생산부', id: 'u9' }).범위, '본인');
확인('권한 등급 없음도 본인', L.AI권한({}).범위, '본인');
const 업무 = [
  { id: 't1', assignee: 'u_kim', dept: '품질관리부' },
  { id: 't2', assignee: 'u_shin', dept: '품질관리부' },
  { id: 't3', assignee: 'u_kang', dept: '영업부' },
];
확인('거르기 전사', L.권한거르기(업무, L.AI권한({ grade: 'exec' })).length, 3);
확인('거르기 부서장', L.권한거르기(업무, L.AI권한({ grade: 'manager', dept: '품질관리부', id: 'u_kim' })).map((r) => r.id), ['t1', 't2']);
확인('거르기 사원', L.권한거르기(업무, L.AI권한({ dept: '품질관리부', id: 'u_shin' })).map((r) => r.id), ['t2']);
확인('거르기 빈 입력', L.권한거르기(null, L.AI권한({})), []);

// 공지 쓰기 — 부서장 이상만 (부장님 지시 9/18). 등급 값은 실제 운영 데이터에서 확인한 넷.
확인('공지 최고관리자', L.공지쓰기가능({ grade: 'super' }), true);
확인('공지 임원', L.공지쓰기가능({ grade: 'exec' }), true);
확인('공지 부서장', L.공지쓰기가능({ grade: 'manager' }), true);
확인('공지 사원(member)', L.공지쓰기가능({ grade: 'member' }), false);
확인('공지 등급 없음', L.공지쓰기가능({}), false);
확인('공지 빈 입력', L.공지쓰기가능(null), false);

// 브라우저 전용은 node 에서 throw
let threw = false; try { await L.이미지축소({}); } catch (e) { threw = true; }
확인('이미지축소는 브라우저 전용', threw, true);


// ── 프로젝트 코드 → 아이콘 글자 (2026-09-19) ────────────────────────────────
// 앞의 SJ·SJE 는 우리 회사 코드라 전부 같다 — 그걸 보여 주면 프로젝트가 구분이 안 된다.
// 화면에 "SJ43" "SJE4" 만 떠서 어느 프로젝트인지 알 수 없었다(부장님 신고).
확인('SJE2026-001 → 2026 / 001', L.프로젝트약자('SJE2026-001'), ['2026', '001']);
확인('SJ435-26 → 435 / 26', L.프로젝트약자('SJ435-26'), ['435', '26']);
확인('SJE437-26 도 머리글자를 뗀다', L.프로젝트약자('SJE437-26'), ['437', '26']);
확인('번호가 다르면 아이콘도 달라진다',
  L.프로젝트약자('SJ2026-002')[1] !== L.프로젝트약자('SJ2026-003')[1], true);
확인('하이픈이 없으면 한 줄', L.프로젝트약자('SJ20'), ['20']);
확인('긴 번호는 네 자씩 끊는다', L.프로젝트약자('P-1234567'), ['1234', '567']);
확인('숫자가 아예 없으면 글자라도 남긴다', L.프로젝트약자('ABC'), ['ABC']);
확인('빈 값도 죽지 않는다', Array.isArray(L.프로젝트약자('')) && Array.isArray(L.프로젝트약자(null)), true);

// ── 읽을사람() — 메시지에 박는 readers (2026-09-19, 2단계 1번) ─────────────────
// 여기서 틀리면 **남의 대화가 열리거나 내 대화가 사라진다.** 둘 다 화면엔 멀쩡해 보인다.
const 직원 = [
  { id: 'u1', dept: '품질관리부' }, { id: 'u2', dept: '품질관리부' },
  { id: 'u3', dept: '영업부' }, { id: 'u9', dept: '품질관리부', disabled: true },
];
const 프로젝트 = [{ id: 'p1', pm: 'u1', members: ['u3'] }, { id: 'p2' }];
const R = (ch) => L.읽을사람(ch, 직원, 프로젝트);

확인('전사 공지는 안 박는다(전원이라)', R({ id: 'c1', type: 'announce' }), null);
확인('부서방은 그 부서 사람', R({ id: 'dept_quality', type: 'dept', name: '품질관리부' }), ['u1', 'u2']);
확인('그만둔 사람은 뺀다', R({ id: 'dept_quality', type: 'dept', name: '품질관리부' }).includes('u9'), false);
확인('1:1 은 방 멤버', R({ id: 'dm1', type: 'dm', members: ['u1', 'u3'] }), ['u1', 'u3']);
확인('그룹도 방 멤버(중복 제거)', R({ id: 'g1', type: 'group', members: ['u2', 'u3', 'u2'] }), ['u2', 'u3']);
확인('프로젝트는 PM + 참여자', R({ id: 'proj_p1', type: 'project', projectId: 'p1' }), ['u1', 'u3']);
// 참여자를 못 찾는 프로젝트에 "전원" 을 박으면 그 대화가 전 직원에게 열린다 — 방멤버() 의 폴백을 쓰면 안 되는 이유다.
확인('참여자가 빈 프로젝트는 안 박는다', R({ id: 'proj_p2', type: 'project', projectId: 'p2' }), null);
확인('없는 프로젝트도 안 박는다', R({ id: 'proj_x', type: 'project', projectId: 'x' }), null);
확인('모르는 방은 안 박는다', R({ id: 'x', type: '??' }), null);
확인('방이 없어도 안 죽는다', R(null), null);
확인('아무도 안 남으면 안 박는다(빈 배열 금지)', R({ id: 'dm2', type: 'dm', members: ['없는사람'] }), null);
확인('빈 부서방도 안 박는다', R({ id: 'dept_x', type: 'dept', name: '해외사업부' }), null);

// 보내는 길이 셋(글·파일·시스템)인데 하나라도 빠뜨리면 그 메시지만 나중에 안 보인다.
const 앱소스 = (await import('node:fs')).readFileSync(new URL('../modules/messenger/messenger.js', import.meta.url), 'utf8');
확인('보내는 길 셋이 전부 readers 를 박는다', (앱소스.match(/읽을사람박기\(/g) || []).length, 4);   // 정의 1 + 부르는 곳 3

console.log(`\n${실패 ? '실패 ' + 실패 + '건' : '전부 통과'}`);
process.exit(실패 ? 1 : 0);

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

// 브라우저 전용은 node 에서 throw
let threw = false; try { await L.이미지축소({}); } catch (e) { threw = true; }
확인('이미지축소는 브라우저 전용', threw, true);

console.log(`\n${실패 ? '실패 ' + 실패 + '건' : '전부 통과'}`);
process.exit(실패 ? 1 : 0);

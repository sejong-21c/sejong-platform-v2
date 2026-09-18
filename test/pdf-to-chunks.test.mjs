// PDF 조각내기 검사 — PDF 없이 순수 함수만.  node test/pdf-to-chunks.test.mjs
// 여기서 지키려는 것: **쪽번호가 틀리면 안 된다.** AI 가 "Sec.IX p.152" 라고 했는데 그 쪽에 없으면
// 기술부가 한 번 속고 다시는 안 쓴다. 틀린 근거는 근거가 없는 것보다 나쁘다.
import { 쪽찾기, 머리몸가르기, 글자벌어짐 } from '../tools/pdf-to-chunks.mjs';
import { 제목인가, 조각내기 } from '../tools/rag-chunk.mjs';

let 실패 = 0;
const 확인 = (이름, 참, 메모 = '') => { if (!참) 실패++; console.log(`${참 ? 'PASS' : 'FAIL'}  ${이름}${메모 ? '  — ' + 메모 : ''}`); };
const nl = String.fromCharCode(10);

// ── 쪽 되찾기 ──
const 쪽들 = [
  'QW-100 SCOPE  This Section contains requirements for qualification.',
  'QW-140 TYPES AND PURPOSES OF TESTS  Mechanical tests used in procedure qualification.',
  'QW-406 PREHEAT  A decrease of more than 100 F in the preheat temperature qualified.',
];
const 조각들 = [
  { 머리: 'IX > QW-100', 몸: 'This Section contains requirements for qualification.' },
  { 머리: 'IX > QW-406', 몸: 'A decrease of more than 100 F in the preheat temperature qualified.' },
  { 머리: 'IX > 없는것', 몸: '이 글은 어느 쪽에도 없다 아주 길게 써서 찾지 못하게 한다' },
];
const r = 쪽찾기(조각들, 쪽들, 1);
확인('첫 조각의 쪽을 찾는다', r[0].쪽 === 1, `p.${r[0].쪽}`);
확인('뒤 조각의 쪽도 찾는다', r[1].쪽 === 3, `p.${r[1].쪽}`);
확인('못 찾으면 직전 쪽을 물려받는다', r[2].쪽 === 3,
  '0쪽이나 undefined 를 내보내면 화면에 "p.0" 이 찍힌다');

const r2 = 쪽찾기(조각들.slice(0, 2), 쪽들, 51);
확인('첫쪽(--처음)을 더한다', r2[0].쪽 === 51 && r2[1].쪽 === 53, `${r2[0].쪽}, ${r2[1].쪽}`);

// 줄바꿈이 제각각이어도 찾아야 한다 — PDF 는 한 문장을 여러 줄로 끊어 뽑는다
const 끊긴쪽 = ['QW-406' + nl + 'PREHEAT' + nl + 'A decrease of more than 100 F in the' + nl + 'preheat temperature qualified.'];
const r3 = 쪽찾기([{ 머리: 'h', 몸: 'A decrease of more than 100 F in the preheat temperature qualified.' }], 끊긴쪽, 7);
확인('PDF 가 문장을 여러 줄로 끊어도 찾는다', r3[0].쪽 === 7, `p.${r3[0].쪽}`);

// ── 머리/몸 가르기 ──
const g = 머리몸가르기('내 문서 > 제1장 > 1.1 목적' + nl + '본문이다.', '내 문서');
확인('머리와 몸을 가른다', g.머리 === '내 문서 > 제1장 > 1.1 목적' && g.몸 === '본문이다.');
const g2 = 머리몸가르기('머리가 없는 그냥 글', '내 문서');
확인('머리가 없으면 전부 몸', g2.머리 === '' && g2.몸 === '머리가 없는 그냥 글');
const g3 = 머리몸가르기('다른문서 > 장' + nl + '본문', '내 문서');
확인('남의 문서 이름으로 시작하면 머리로 치지 않는다', g3.머리 === '',
  '문서 이름이 안 맞는데 첫 줄을 떼면 본문 한 줄이 조용히 사라진다');

// ── ASME 제목 규칙 (rag-chunk) ──
확인('QW-140 은 제목', !!제목인가('QW-140 TYPES AND PURPOSES OF TESTS'));
확인('UG-27 도 제목', !!제목인가('UG-27 THICKNESS OF SHELLS UNDER INTERNAL PRESSURE'));
확인('ARTICLE II 는 제목', !!제목인가('ARTICLE II WELDING PROCEDURE QUALIFICATIONS'));
확인('PART QG 는 제목', !!제목인가('PART QG GENERAL REQUIREMENTS'));
확인('표의 "75 (515)" 는 제목이 아니다', !제목인가('75 (515)'),
  '이걸 제목으로 읽으면 ASME 조각이 한 글자짜리로 부서진다');
확인('표의 "8.1  130" 도 제목이 아니다', !제목인가('8.1  130'));
확인('한국어 번호 제목은 그대로 제목', !!제목인가('5.2 검사 및 시험'));
확인('번호제목을 끄면 한국어 번호 제목도 안 잡는다', !제목인가('5.2 검사 및 시험', { 번호제목: false }),
  'ASME 처럼 표가 많은 책에서만 끄는 스위치다');
확인('번호제목을 꺼도 ASME 규칙은 살아 있다', !!제목인가('QW-406 PREHEAT', { 번호제목: false }));

// 옵션이 조각내기까지 전달되는지 — 여기가 끊기면 스위치가 조용히 무시된다
const 표같은글 = ['QW-406 PREHEAT', '18 UNF', '51 through P-No. 53', '본문 줄이 여기 이어진다.'].join(nl);
const 켬 = 조각내기(표같은글, 'T');
const 끔 = 조각내기(표같은글, 'T', 900, { 번호제목: false });
확인('번호제목 스위치가 조각내기에 전달된다', 끔.length <= 켬.length, `켬 ${켬.length}개 · 끔 ${끔.length}개`);

// ── 낱자로 흩어진 PDF 걸러내기 ──
// 이게 없으면 조각 수·평균 길이는 멀쩡해 보이는데 검색이 영영 0건인 책이 색인에 들어간다.
const 멀쩡 = ('This Standard covers the standardization of dimensions of welded and seamless pipe. '
  + '이 표준은 배관 치수를 규정한다. ').repeat(20);
const 낱자 = 멀쩡.split('').join(' ');
확인('멀쩡한 글은 낱자 비율이 낮다', 글자벌어짐(멀쩡) < 0.2, String(글자벌어짐(멀쩡).toFixed(2)));
확인('낱자로 흩어진 글은 잡아낸다', 글자벌어짐(낱자) > 0.8, String(글자벌어짐(낱자).toFixed(2)) + ' (ASME B36.19 실측 0.95)');
확인('글이 짧으면 판단하지 않는다', 글자벌어짐('a b c') === 0,
  '표지 몇 줄만 보고 멀쩡한 책을 막으면 안 된다');

console.log(nl + (실패 ? '실패 ' + 실패 + '건' : '전부 통과'));
process.exit(실패 ? 1 : 0);

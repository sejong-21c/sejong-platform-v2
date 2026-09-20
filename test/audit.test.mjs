// 품질기록 변경 이력이 **조용히 사라지는 것**을 막는 불변식. (2026-09-20)
//   node test/audit.test.mjs
//
// 왜 파일을 뒤지나: 이력은 없어도 화면이 멀쩡히 돈다. 저장도 된다. 그래서 누가 복붙·리팩터링으로
// 빼 버려도 아무도 모르고, 심사 때가 되어서야 "이력이 없네" 를 알게 된다 — 그때는 늦었다.
// 규칙 쪽 실동작은 test/rules.test.mjs(에뮬레이터)가 본다. 여기는 **배선**만 본다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(여기, '..');
const 읽기 = (p) => readFileSync(join(뿌리, p), 'utf8');

let 실패 = 0;
const T = (이름, 참, 메모 = '') => { if (!참) 실패++; console.log(`${참 ? 'PASS' : 'FAIL'}  ${이름}${메모 ? '  — ' + 메모 : ''}`); };

for (const [파일, 컬] of [['modules/ncr/ncr.html', 't_ncrs'], ['modules/car/car.html', 't_cars']]) {
  const s = 읽기(파일);
  T(`${파일} — 이력 모듈을 불러온다`, s.includes("import('../shared/audit.mjs')") && s.includes('window.기록이력'));
  T(`${파일} — 저장할 때 판을 올린다`, /x\.rev\s*=\s*window\.기록이력\.다음판\(prev\)/.test(s),
    '판을 안 올리면 보안 규칙이 저장을 거부한다 — 화면이 통째로 안 된다');
  T(`${파일} — 저장할 때 이력을 남긴다`, /남기기\(\{[^}]*무엇:\s*prev\s*\?\s*'고침'\s*:\s*'만듦'/.test(s));
  T(`${파일} — 지우기 전에 이력을 남긴다`,
    new RegExp("남기기\\(\\{[^}]*무엇: '지움'[\\s\\S]{0,200}?deleteDoc").test(s),
    '지운 뒤에 남기려다 실패하면 아무 흔적도 안 남는다');
}

const rules = 읽기('firestore.rules');
T('규칙 — 이력은 덧붙이기 전용', /match \/t_recordLog\/\{[\s\S]*?allow update, delete: if false;/.test(rules));
T('규칙 — 이력은 남의 이름으로 못 쓴다', /t_recordLog[\s\S]*?data\.by == request\.auth\.uid/.test(rules));
for (const c of ['t_ncrs', 't_cars']) {
  T(`규칙 — ${c} 는 판이 커져야 저장된다`,
    new RegExp(`match /${c}/\\{[\\s\\S]*?data\\.rev > resource\\.data\\.get\\('rev', 0\\)`).test(rules));
  T(`규칙 — ${c} 가 범용 t_ 규칙에서 빠져 있다`, rules.includes(`col != '${c}'`),
    'Firestore 는 어느 한 규칙이 허용하면 통과한다 — 안 빼면 위 제한이 아무 소용이 없다');
}
T('규칙 — 이력 컬렉션도 범용 t_ 규칙에서 빠져 있다', rules.includes("col != 't_recordLog'"));

// 이력에 본문이 실리면 안 된다 — 두 번째 9/19 사고를 만들지 않으려고
const audit = 읽기('modules/shared/audit.mjs');
T('이력 모듈 — 무거운 칸은 값을 안 적는다', /무거운칸\s*=\s*\/\^\(imgStore/.test(audit));
T('이력 모듈 — 필드 이름이 아스키다', !/\b(coll|recId|act|rev|by|byName|atISO|note|changes)\b/.test('판누가') && audit.includes('coll: String(컬렉션)'),
  '규칙 언어가 한글 필드 이름을 못 읽는다 — 규칙이 통째로 컴파일 실패한다');

console.log(실패 ? `\n실패 ${실패}건` : '\n전부 통과');
process.exit(실패 ? 1 : 0);

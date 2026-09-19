// 첨부가 DB 밖(R2)으로 나갔는지 지키는 불변식 — 2026-09-19.
//
// 왜 필요한가: 이건 **조용히 되돌아가는** 종류다. 새 첨부 화면을 하나 더 만들면서
//   기존 모듈을 복사해 오면(이 저장소에서 다섯 번 그렇게 됐다) 다시 chunk__ 조각으로
//   파이어스토어에 base64 를 박게 되고, 아무도 모르는 사이 하루 읽기 5만이 도로 위험해진다.
//   화면은 멀쩡히 동작하므로 사람 눈에는 절대 안 보인다.
//
//   node test/attach-r2.test.mjs
import { readFileSync } from 'node:fs';
import { 새열쇠, 밖에있나 } from '../modules/shared/attach.mjs';

let 실패 = 0;
const T = (이름, 참, 덧 = '') => { if (!참) 실패++; console.log((참 ? 'PASS  ' : 'FAIL  ') + 이름 + (덧 ? '  — ' + 덧 : '')); };

// ── 1) 열쇠는 게이트웨이가 받는 모양이어야 한다 ───────────────────
// 워커의 안전한키: /^[A-Za-z0-9._\-/]{1,300}$/ 이고 '..' 금지.
// 한글 파일 이름을 열쇠에 넣으면 여기서 400 이 난다 — 그래서 이름은 DB 쪽에만 적는다.
const 안전한키 = (k) => /^[A-Za-z0-9._\-/]{1,300}$/.test(k) && !k.includes('..');
for (const 갈래 of ['car', 'ncr', 'insp', 't_qaGenDocs', '검사보고서.pdf', '', undefined]) {
  const k = 새열쇠(갈래);
  T(`열쇠가 게이트웨이 규칙을 지킨다 (갈래=${JSON.stringify(갈래)})`, 안전한키(k), k);
}
T('열쇠는 매번 다르다', new Set(Array.from({ length: 500 }, () => 새열쇠('car'))).size === 500);
T('옛 조각 id 는 DB 밖 첨부가 아니다', !밖에있나('chunk__car_1758_ab12cd') && !밖에있나(null) && !밖에있나(undefined));
T('새 열쇠는 DB 밖 첨부로 알아본다', 밖에있나(새열쇠('car')));

// ── 2) 올린 뒤 반드시 되읽어 본다 ─────────────────────────────────
// 올리기 실패는 옛 조각 방식으로 물러설 수 있지만, "올라간 줄 알았는데 못 읽는" 건 물러설 데가 없다.
const 본체 = readFileSync(new URL('../modules/shared/attach.mjs', import.meta.url), 'utf8');
T('올리기가 되읽기(HEAD)로 확인한다', /method: 'HEAD'/.test(본체));
T('되읽기가 실패하면 던진다', /되읽기 \$\{확인\.status\}/.test(본체));

// ── 3) 조각으로 쓰는 곳은 전부 R2 를 먼저 시도해야 한다 ───────────
const 쓰는곳 = [
  'modules/car/car.html', 'modules/ncr/ncr.html', 'modules/itp-builder/itp-builder.html',
  'modules/qa-doc-generator/qa-doc-generator.html', 'modules/mobile-inspection/mobile-inspection.html',
];
for (const f of 쓰는곳) {
  const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  T(`${f} — 조각을 쓰기 전에 R2 를 먼저 본다`, /window\.첨부[\s\S]{0,400}?(올리기|글자올리기)/.test(s));
  T(`${f} — 실패하면 옛 조각 방식으로 물러선다`, /옛 조각 방식으로/.test(s) && /`chunk__/.test(s));
  T(`${f} — attach.mjs 를 실제로 불러온다`, /import\('\.\.\/shared\/attach\.mjs'\)/.test(s));
}

// ── 4) 조각을 읽는 곳은 전부 DB 밖 첨부도 읽을 수 있어야 한다 ─────
// 하나라도 빠지면 그 화면에서만 첨부가 "없는 파일"이 된다.
const 읽는곳 = [
  'modules/car/car.html', 'modules/ncr/ncr.html', 'modules/quality/qa-dashboard.html',
  'modules/itp-builder/itp-builder.html', 'modules/qa-doc-generator/qa-doc-generator.html',
  'modules/mobile-inspection/mobile-inspection.html', 'modules/qa-viewer/qa-viewer.html',
];
for (const f of 읽는곳) {
  const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  T(`${f} — DB 밖 첨부도 읽는다`, /window\.첨부 && window\.첨부\.밖에있나\(/.test(s));
}

console.log(실패 ? `\n${실패}개 실패` : '\n전부 통과');
process.exit(실패 ? 1 : 0);

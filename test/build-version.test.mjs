/* 메신저 판 번호가 **두 군데 이상**에 적혀 있다 — 어긋나면 배포가 직원에게 안 닿는다.
 *
 * 2026-09-22 에 실제로 겪은 일: messenger.html·messenger.js 는 b68~b77 로 올렸는데
 * index.html 의 MESSENGER_BUILD 는 'b67' 로 멈춰 있었다. 그래서 iframe 이 늘
 *   modules/messenger/messenger.html?embed=1&v=b67
 * 을 불렀고, 주소가 안 바뀌니 브라우저·서비스워커가 옛 껍데기를 그대로 내줬다.
 * 고친 코드가 서버에는 올라가 있는데 화면은 그대로다 — 제일 찾기 어려운 종류다.
 *
 * 그래서 사람 기억 대신 이 검사를 둔다. 올릴 때 네 곳이 **같은 값**이어야 한다.
 *   node test/build-version.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 읽기 = (p) => readFileSync(join(뿌리, p), 'utf8');

const 곳 = [
  { 이름: 'index.html MESSENGER_BUILD', 값: (읽기('index.html').match(/const MESSENGER_BUILD = '(b\d+)'/) || [])[1] },
  { 이름: 'messenger.html ?v=', 값: (읽기('modules/messenger/messenger.html').match(/messenger\.js\?v=(b\d+)/) || [])[1] },
  { 이름: 'messenger.js 의 ai.js import', 값: (읽기('modules/messenger/messenger.js').match(/ai\.js\?v=(b\d+)/) || [])[1] },
  { 이름: 'sw.js 버전 주석', 값: (읽기('modules/messenger/sw.js').match(/const 버전 = 'sj-msg-v\d+';\s*\/\/ v\d+: (b\d+)/) || [])[1] },
  // 2026-09-23 추가: 이 자리가 **b67 에 열여섯 판 동안 멈춰 있었다.** pwa-w1 시험은 보고 있었는데
  //   배포 직전에 도는 건 이 파일이라(`npm run build`) 아무도 못 봤다. 서비스워커 캐시로 오면
  //   URL 에 ?v= 가 없어 화면에 찍히는 판 번호가 이 상수다 — 틀리면 "무슨 판이 떠 있나" 를 못 믿는다.
  { 이름: 'messenger.js 의 빌드 상수', 값: (읽기('modules/messenger/messenger.js').match(/const 빌드 = '(b\d+)'/) || [])[1] },
  { 이름: 'messenger.html css ?v=', 값: (읽기('modules/messenger/messenger.html').match(/messenger\.css\?v=(b\d+)/) || [])[1] },
  { 이름: 'messenger.js 의 lib.js import', 값: (읽기('modules/messenger/messenger.js').match(/lib\.js\?v=(b\d+)/) || [])[1] },
  // b84: index.html 이 AI 행위 권한 모듈을 ?v= 로 받는다. 안 올리면 **권한 규칙만 옛 캐시본**이
  //   쓰인다 — 화면은 멀쩡하고 권한만 조용히 예전 것이다. 제일 나쁜 종류라 여기서 잡는다.
  { 이름: 'index.html 의 ai-perm.mjs import', 값: (읽기('index.html').match(/ai-perm\.mjs\?v=(b\d+)/) || [])[1] },
];

let 탈 = 0;
const 기준 = 곳[0].값;
for (const c of 곳) {
  const ok = !!c.값 && c.값 === 기준;
  if (!ok) 탈++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + c.이름 + ' = ' + (c.값 || '(못 읽음)') + (ok ? '' : '   << ' + 기준 + ' 여야 한다'));
}

// 서비스워커 캐시 이름도 같이 올라갔는지 — 안 올리면 옛 캐시가 안 지워진다.
const sw = (읽기('modules/messenger/sw.js').match(/const 버전 = '(sj-msg-v\d+)'/) || [])[1];
console.log((sw ? 'PASS  ' : 'FAIL  ') + '서비스워커 캐시 이름 = ' + (sw || '(못 읽음)'));
if (!sw) 탈++;

console.log('\n' + (탈 ? 탈 + '군데 어긋남 — 배포가 안 닿는다' : '모두 ' + 기준 + ' 로 맞다'));
process.exit(탈 ? 1 : 0);

// SJ 메신저 W1 불변식 — 브라우저 없이 돌아간다.  node test/pwa-w1.test.mjs
//
// 여기 있는 건 전부 "조용히 깨지는" 것들이다:
//  · 매니페스트에서 아이콘 한 줄이 빠지면 폰에 "홈 화면에 추가"가 그냥 안 뜬다(오류 메시지 없음).
//  · sw.js 의 Firebase SDK 버전이 messenger.html 의 import 와 어긋나면 비행기 모드에서만 티가 난다.
//  · 로그인 관문이 사라지면 앱으로 연 사람이 전부 부장 계정으로 보인다(옛 'cwkim' 폴백).
//  · index.html 의 되돌아가기 검사가 느슨해지면 열린 리디렉션이 된다.
// 실물(설치·푸시·오프라인)은 test/pwa-live-check.mjs 가 헤드리스 크롬으로 본다.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 읽기 = (p) => readFileSync(join(뿌리, p), 'utf8');

let 실패 = 0;
const 확인 = (이름, 참, 메모 = '') => {
  if (!참) 실패++;
  console.log(`${참 ? 'PASS' : 'FAIL'}  ${이름}${메모 ? '  — ' + 메모 : ''}`);
};

const 매니 = JSON.parse(읽기('modules/messenger/manifest.json'));
const 메신저 = 읽기('modules/messenger/messenger.html');
const sw = 읽기('modules/messenger/sw.js');
const 인덱스 = 읽기('index.html');

// ── 매니페스트 ──
확인('매니페스트 display=standalone', 매니.display === 'standalone', 매니.display);
확인('start_url 은 메신저', String(매니.start_url).endsWith('messenger.html'), 매니.start_url);
확인('scope 는 사이트 전체', 매니.scope === '/',
  `${매니.scope} — 로그인하러 "/" 에 다녀와야 해서 앱 밖으로 튕기면 안 된다`);
확인('이름 있음', !!매니.name && !!매니.short_name, `${매니.name} / ${매니.short_name}`);

// PNG 머리(IHDR)에서 실제 크기를 읽어 선언한 sizes 와 대조한다 — 파일만 있고 크기가 다른 사고 방지
function png크기(경로) {
  const b = readFileSync(join(뿌리, 경로));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
for (const 아이콘 of 매니.icons) {
  const 경로 = join('modules/messenger', 아이콘.src);
  const 있나 = existsSync(join(뿌리, 경로));
  const [w, h] = 있나 ? png크기(경로) : [0, 0];
  확인(`아이콘 ${아이콘.src} ${아이콘.sizes}`, 있나 && `${w}x${h}` === 아이콘.sizes, `${w}x${h}`);
}
확인('192·512·maskable 세 종류 다 있음',
  ['192x192', '512x512'].every((s) => 매니.icons.some((i) => i.sizes === s))
  && 매니.icons.some((i) => (i.purpose || '').includes('maskable')),
  매니.icons.map((i) => `${i.sizes}/${i.purpose}`).join(' '));
확인('애플 터치 아이콘 파일 있음', existsSync(join(뿌리, 'modules/messenger/icons/apple-touch-icon-180.png')));

// ── messenger.html ──
확인('매니페스트 링크', /<link rel="manifest" href="\.\/manifest\.json">/.test(메신저));
확인('애플 홈화면 메타', /apple-mobile-web-app-capable/.test(메신저) && /apple-touch-icon/.test(메신저));
확인('서비스워커 등록', /navigator\.serviceWorker\.register\('\.\/sw\.js'/.test(메신저));
확인("옛 'cwkim' 폴백 없음", !/return 'cwkim';/.test(메신저),
  '앱으로 열면 로그인 안 한 사람이 전부 부장이 됐다');
확인('독립실행 로그인 관문', /const 독립실행 = \(window\.parent === window\)/.test(메신저)
  && /function 관문\(/.test(메신저) && /관문\(!navigator\.onLine/.test(메신저));
확인('로그인 안 된 채로 전송 못 함',
  (메신저.match(/if \(!me\) \{ alert\('로그인이 필요합니다\.'\); return; \}/g) || []).length === 2,
  '글·파일 두 군데');
확인('메시지에 clientId·type 저장',
  /clientId: String\(clientId\)/.test(메신저) && /type: 'text'/.test(메신저)
  && /type: \(f\.type \|\| ''\)\.indexOf\('image\/'\) === 0 \? 'image' : 'file'/.test(메신저));
확인('문서 id 가 clientId 에서 나온다(재시도해도 한 건)',
  (메신저.match(/const docId = 'msg_' \+ clientId;/g) || []).length === 2);

// ── sw.js ──
const sdk매니 = (sw.match(/const SDK버전 = '([\d.]+)'/) || [])[1];
const sdk페이지 = [...메신저.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map((m) => m[1]);
확인('SDK 버전 한 개로 통일', new Set(sdk페이지).size === 1, sdk페이지.join(','));
확인('sw.js SDK 버전 = messenger.html import 버전', sdk매니 === sdk페이지[0], `${sdk매니} vs ${sdk페이지[0]}`);
확인('껍데기 3종 프리캐시',
  ['./messenger.html', './manifest.json', './icons/icon-192.png'].every((f) => sw.includes(`'${f}'`)));
const 허용 = [...sw.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1])
  .filter((u) => !u.includes('${'));
확인('데이터 API 는 캐시 대상이 아니다',
  !허용.some((u) => /googleapis\.com/.test(u) && !/fonts\.googleapis/.test(u)),
  허용.join(' '));
확인('버전 문자열 있음', /const 버전 = 'sj-msg-v\d+'/.test(sw));

// ── index.html 되돌아가기(열린 리디렉션 방지) ──
const 검사원문 = (인덱스.match(/if \(되돌아갈곳 && (\/.+?\/)\.test\(되돌아갈곳\)\)/) || [])[1];
확인('되돌아가기 검사 존재', !!검사원문, 검사원문 || '');
if (검사원문) {
  const re = new Function(`return ${검사원문}`)();
  확인('정상 경로 통과', re.test('/modules/messenger/messenger.html'));
  for (const 나쁜 of ['//evil.com/x.html', 'https://evil.com/x.html', '/modules/../../x.html',
    '/modules/messenger/messenger.html?x=1', '/index.html', '/modules/a.js']) {
    확인(`막힘: ${나쁜}`, !re.test(나쁜));
  }
}
확인('메신저 빌드 번호 올라감', /const MESSENGER_BUILD = '(b2[89]|b[3-9]\d|c\d+)'/.test(인덱스),
  (인덱스.match(/const MESSENGER_BUILD = '(\w+)'/) || [])[1]);

console.log(`\n${실패 ? '실패 ' + 실패 + '건' : '전부 통과'}`);
process.exit(실패 ? 1 : 0);

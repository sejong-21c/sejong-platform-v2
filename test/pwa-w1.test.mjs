// SJ 메신저 불변식 — 브라우저 없이 돌아간다.  node test/pwa-w1.test.mjs
//
// 여기 있는 건 전부 "조용히 깨지는" 것들이다:
//  · 매니페스트에서 아이콘 한 줄이 빠지면 폰에 "홈 화면에 추가"가 그냥 안 뜬다(오류 메시지 없음).
//  · sw.js 의 Firebase SDK 버전이 messenger.js 의 import 와 어긋나면 비행기 모드에서만 티가 난다.
//  · 로그인 관문이 사라지면 앱으로 연 사람이 전부 부장 계정으로 보인다(옛 'cwkim' 폴백).
//  · index.html 의 되돌아가기 검사가 느슨해지면 열린 리디렉션이 된다.
//  · html 의 ?v= 와 index.html 의 MESSENGER_BUILD 가 어긋나면 새 HTML 이 옛 JS 를 10분 캐시로 받는다.
// 실물(설치·오프라인)은 test/pwa-live-check.mjs, 화면 시나리오는 test/messenger-ui-check.mjs.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
const 껍데기 = 읽기('modules/messenger/messenger.html');
const 앱 = 읽기('modules/messenger/messenger.js');
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

// ── messenger.html (껍데기) ──
확인('매니페스트 링크', /<link rel="manifest" href="\.\/manifest\.json">/.test(껍데기));
확인('애플 홈화면 메타', /apple-mobile-web-app-capable/.test(껍데기) && /apple-touch-icon/.test(껍데기));
확인('viewport-fit=cover (노치 safe-area)', /viewport-fit=cover/.test(껍데기));
확인('서비스워커 등록', /navigator\.serviceWorker\.register\('\.\/sw\.js'/.test(껍데기));
확인('모듈 로드 실패 시 안내 화면', /__sjmFatal/.test(껍데기) && /<script type="module" src="\.\/messenger\.js\?v=/.test(껍데기));
const htmlV = (껍데기.match(/messenger\.js\?v=([\w.-]+)/) || [])[1];
const cssV = (껍데기.match(/messenger\.css\?v=([\w.-]+)/) || [])[1];
const idxV = (인덱스.match(/const MESSENGER_BUILD = '(\w+)'/) || [])[1];
확인('html 의 ?v= 가 css·js 같음', !!htmlV && htmlV === cssV, `${cssV} / ${htmlV}`);
확인('html 의 ?v= = index.html MESSENGER_BUILD', htmlV === idxV, `${htmlV} vs ${idxV}`);
확인('메신저 빌드 번호 b31 이상', /^(b(3[1-9]|[4-9]\d)|c\d+)$/.test(idxV || ''), idxV);
// messenger.js 안의 lib.js·ai.js import 도 같은 ?v= 여야 한다. 안 그러면 새 messenger.js 가 옛 lib/ai 를 캐시에서 쓴다
// (2026-09-18 실제 사고: AI 제공자 목록을 고쳤는데 브라우저가 옛 ai.js 를 써서 같은 오류가 계속 났다).
const 내부V = [...앱.matchAll(/from '\.\/(?:lib|ai)\.js\?v=([\w.-]+)'/g)].map((m) => m[1]);
확인('messenger.js 가 lib.js·ai.js 를 ?v= 로 가져온다', 내부V.length === 2, `${내부V.length}개 — lib.js·ai.js 둘 다여야 한다`);
확인('그 ?v= 도 빌드 번호와 같다', 내부V.every((v) => v === idxV), `${내부V.join(',')} vs ${idxV}`);
const 상수V = (앱.match(/const 빌드 = '([\w.-]+)'/) || [])[1];
확인('messenger.js 안 빌드 상수도 같다', 상수V === idxV, `${상수V} vs ${idxV} — 서비스워커 캐시로 오면 ?v= 가 없어 이 상수가 화면에 찍힌다`);

// ── Firestore 영속 캐시 (2026-09-19) ─────────────────────────────────────────
// 조용히 죽는 종류다: getFirestore 로 되돌려도 화면은 멀쩡하고, 대신 접속마다 서버에서 다 다시 읽어
// **무료 하루 5만 읽기**를 태운다(그날 남은 시간 플랫폼 전체가 429). 사람 눈에는 안 보인다.
// 메신저는 플랫폼 안에서 부모(index.html)의 fb.db 를 쓰므로(getFB) 둘 다 검사해야 한다.
// 파일 목록을 손으로 적지 않고 **찾아서** 검사한다 — 새 모듈을 만들며 빠뜨리는 게 원래 사고였다.
// (2026-09-19 실측: 0단계를 "완료"로 적어 뒀는데 실제로는 16개 중 6개만 캐시가 있었다.
//  그날 한도가 차자 CAR·NCR·대시보드 화면이 통째로 안 떴다.)
const 파이어스토어쓰는파일 = [
  'index.html', 'modules/messenger/messenger.js',
  ...readdirSync(join(뿌리, 'modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(뿌리, 'modules', d.name))
      .filter((n) => n.endsWith('.html'))
      .map((n) => `modules/${d.name}/${n}`)),
].filter((f) => /firebase-firestore\.js/.test(읽기(f)));

확인(`파이어스토어 쓰는 파일을 다 찾았다 (${파이어스토어쓰는파일.length}개)`, 파이어스토어쓰는파일.length >= 16,
  '찾은 게 갑자기 줄었으면 이 검사가 헛돌고 있는 것이다');

for (const 이름 of 파이어스토어쓰는파일) {
  const 글 = 읽기(이름);
  확인(`${이름} 이 영속 캐시를 쓴다`,
    /initializeFirestore\(\s*(?:fbApp|app)\s*,\s*\{\s*localCache:\s*persistentLocalCache\(/.test(글),
    '되돌리면 접속마다 수백 건을 다시 읽어 하루 한도를 태운다 — 한도가 차면 이 화면이 통째로 멈춘다');
  확인(`${이름} 에 맨 getFirestore 가 없다`, !/\bgetFirestore\s*\(/.test(글),
    'initializeFirestore 와 같이 있으면 어느 쪽이 쓰이는지 알 수 없다');
  확인(`${이름} 이 여러 탭 관리자를 쓴다`, /persistentMultipleTabManager\(\)/.test(글),
    '플랫폼·iframe 모듈·메신저 새 창이 같은 출처에서 동시에 뜬다 — single 이면 한쪽이 캐시를 못 쓴다');
}
for (const id of ['photoInput', 'fileInput', 'cameraInput', 'albumInput', 'sheet', 'toast', 'viewer', 'modal']) {
  확인(`껍데기 요소 #${id}`, new RegExp(`id="${id}"`).test(껍데기));
}

// ── messenger.js (앱) ──
확인("옛 'cwkim' 폴백 없음", !/return 'cwkim';/.test(앱), '앱으로 열면 로그인 안 한 사람이 전부 부장이 됐다');
확인('독립실행 로그인 관문', /const 독립실행 = \(window\.parent === window\)/.test(앱)
  && /function 관문\(/.test(앱) && /관문\(!navigator\.onLine/.test(앱));
확인('window.fb 에 updateDoc·deleteDoc (독립실행에서 나가기·삭제)', /doc, getDoc, setDoc, updateDoc, deleteDoc/.test(앱));
확인('로그인 안 된 채로 전송 못 함',
  (앱.match(/if \(!me_\) \{ 토스트\('로그인이 필요합니다\.'\); return; \}/g) || []).length === 2, '글·파일 두 군데');
확인('메시지에 clientId·type 저장',
  /clientId: String\(clientId\)/.test(앱) && /type: 'text'/.test(앱)
  && /type: \(f\.type \|\| ''\)\.indexOf\('image\/'\) === 0 \? 'image' : 'file'/.test(앱));
확인('문서 id 가 clientId 에서 나온다(재시도해도 한 건)', (앱.match(/const docId = 'msg_' \+ clientId;/g) || []).length === 2);
확인('읽음 기록 payload 는 플랫폼 배지 계약 그대로', /\{ channel: String\(cid\), uid: String\(me\(\)\), lastRead: Number\(now\) \}/.test(앱));
확인('데이터 API 는 부모 fb 우선(iframe 브리지)', /window\.parent\.fb/.test(앱));
확인('한글 조합 중 Enter 이중 전송 방지', /e\.isComposing\) return;/.test(앱));
확인('인라인 onclick 없음(이벤트 위임)', !/onclick=/.test(앱) && /closest\('\[data-act\]'\)/.test(앱));
확인('시험용 창 노출 SJM.me()', /window\.SJM = \{/.test(앱) && /me: \(\) => me\(\)/.test(앱));

// ── sw.js ──
const sdk매니 = (sw.match(/const SDK버전 = '([\d.]+)'/) || [])[1];
const sdk앱 = [...앱.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map((m) => m[1]);
확인('SDK 버전 한 개로 통일', new Set(sdk앱).size === 1, sdk앱.join(','));
확인('sw.js SDK 버전 = messenger.js import 버전', sdk매니 === sdk앱[0], `${sdk매니} vs ${sdk앱[0]}`);
확인('SDK 파일 4개(app·auth·firestore·storage)', sdk앱.length === 4, `${sdk앱.length}개 — pwa-live-check 가 캐시 4개를 기대한다`);
확인('껍데기 프리캐시(html·css·js·lib·manifest·icon)',
  ['./messenger.html', './messenger.css', './messenger.js', './lib.js', './manifest.json', './icons/icon-192.png'].every((f) => sw.includes(`'${f}'`)));
const 허용 = [...sw.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]).filter((u) => !u.includes('${'));
확인('데이터 API 는 캐시 대상이 아니다', !허용.some((u) => /googleapis\.com/.test(u) && !/fonts\.googleapis/.test(u)), 허용.join(' '));
확인('버전 문자열 v2 이상', /const 버전 = 'sj-msg-v([2-9]|\d{2,})'/.test(sw));
확인('프리캐시는 HTTP 캐시를 건너뛴다', /cache: 'reload'/.test(sw));

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
확인('메신저 iframe 은 full-bleed', /id="messengerFrame"[^>]*position:absolute;inset:0/.test(인덱스), '다른 모듈과 같은 패턴');

// ── AI 비서 방 (ai.js · t_aiChat) ──
// 여기 있는 것도 전부 "조용히 새는" 것들이다: 열쇠가 코드에 박히거나, AI 대화가 messages 로 새면
// 화면은 멀쩡한데 70명이 남의 개인 대화를 받게 된다.
const ai = 읽기('modules/messenger/ai.js');
확인('AI 컬렉션은 t_aiChat', /export const AI_컬렉션 = 't_aiChat'/.test(ai));
확인('코드에 API 키가 없다(게이트웨이가 들고 있다)',
  !/(sk-[A-Za-z0-9]{10,}|AIza[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{10,})/.test(ai), '열쇠는 Cloudflare Worker 의 환경변수에만');
확인('게이트웨이는 https 회사 워커', /const 게이트웨이 = 'https:\/\/[a-z0-9.-]+\.workers\.dev'/.test(ai));
확인('모델 호출에 로그인 토큰을 붙인다', /Authorization: auth/.test(ai) && /getIdToken\(\)/.test(ai),
  '게이트웨이 v3.4 부터 모든 제공자가 회사 계정을 확인한다');
확인('제공자 체인 3곳 이상(한 곳 막혀도 답한다)', (ai.match(/형식: '(gemini|openai)'/g) || []).length >= 3);
확인('AI 대화는 t_aiChat 에 쓴다', /AI_컬렉션[^)]*\), *plain/.test(앱) || /fb\.doc\(fb\.db, AI_컬렉션/.test(앱));
확인('AI 방 미리보기를 channels 에 안 남긴다', /ch\.id === AI_CID\) return;/.test(앱),
  'channels.lastText 는 전 직원이 읽는다 — 개인 AI 대화가 새는 자리');
확인('AI 대화 구독은 내 uid 로만', /AI_컬렉션\), fb\.where\('uid', '==', me\(\)\)/.test(앱));
확인('서비스워커가 ai.js 도 미리 받는다', sw.includes("'./ai.js'"));

// ── 게이트웨이(Cloudflare Worker) ──
const 워커 = 읽기('gateway/cloudflare-worker.js');
확인('모든 제공자가 회사 로그인 확인', !/if \(provider\.requireCompanyAuth\)/.test(워커),
  '9Router 만 검사하던 때는 주소만 알면 회사 키를 공짜로 쓸 수 있었다');

// ── firestore.rules ──
const 규칙 = 읽기('firestore.rules');
확인('t_userProfile 본인만 쓰기', /match \/t_userProfile\/\{uid\}[\s\S]{0,200}request\.auth\.uid == uid/.test(규칙));
확인("범용 t_ 규칙에서 t_userProfile 제외", /col != 't_userProfile'/.test(규칙), '어느 한 규칙이 허용하면 통과하므로 빼야 본인만 이 걸린다');
확인('t_aiChat 은 본인만 읽는다', /match \/t_aiChat\/\{docId\}[\s\S]{0,400}allow read: if isCompanyUser\(\) && resource\.data\.uid == request\.auth\.uid/.test(규칙),
  '남의 AI 대화를 읽을 수 있으면 안 된다');
확인('t_aiChat 은 본인만 만든다', /match \/t_aiChat[\s\S]{0,400}allow create: if isCompanyUser\(\) && request\.resource\.data\.uid == request\.auth\.uid/.test(규칙));
확인("범용 t_ 규칙에서 t_aiChat 제외", /col != 't_aiChat'/.test(규칙), '빼지 않으면 사내 누구나 읽고 쓴다');
확인('전사 공지는 부서장 이상만 쓴다',
  /function isDeptHeadOrAbove\(\)[\s\S]{0,200}grade in \['super', 'exec', 'manager'\]/.test(규칙)
  && /channel in \['c1'\]\) \|\| isDeptHeadOrAbove\(\)/.test(규칙),
  '화면만 막으면 개발자 도구로 그냥 쓸 수 있다');
확인('메신저도 같은 기준으로 입력창을 접는다', /L\.공지쓰기가능\(나\(\)\)/.test(앱)
  && /export const 공지등급 = \['super', 'exec', 'manager'\]/.test(읽기('modules/messenger/lib.js')),
  '규칙과 화면이 다른 기준을 쓰면 "보이는데 안 써지는" 상태가 된다');

console.log(`\n${실패 ? '실패 ' + 실패 + '건' : '전부 통과'}`);
process.exit(실패 ? 1 : 0);

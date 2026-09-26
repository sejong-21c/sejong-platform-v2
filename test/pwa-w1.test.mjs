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
const css = 읽기('modules/messenger/messenger.css');
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
// 숫자로 비교한다 — 옛 정규식은 두 자리(b31~b99)만 받아서 **b100 이 되자 실패**했다(2026-09-25).
확인('메신저 빌드 번호 b31 이상', ((m) => (m && Number(m[1]) >= 31) || /^c\d+$/.test(idxV || ''))(/^b(\d+)$/.exec(idxV || '')), idxV);
// messenger.js 안의 lib.js·ai.js import 도 같은 ?v= 여야 한다. 안 그러면 새 messenger.js 가 옛 lib/ai 를 캐시에서 쓴다
// (2026-09-18 실제 사고: AI 제공자 목록을 고쳤는데 브라우저가 옛 ai.js 를 써서 같은 오류가 계속 났다).
const 내부V = [...앱.matchAll(/from '\.\/(?:lib|ai)\.js\?v=([\w.-]+)'/g)].map((m) => m[1]);
확인('messenger.js 가 lib.js·ai.js 를 ?v= 로 가져온다', 내부V.length === 2, `${내부V.length}개 — lib.js·ai.js 둘 다여야 한다`);
확인('그 ?v= 도 빌드 번호와 같다', 내부V.every((v) => v === idxV), `${내부V.join(',')} vs ${idxV}`);
const 상수V = (앱.match(/const 빌드 = '([\w.-]+)'/) || [])[1];
확인('messenger.js 안 빌드 상수도 같다', 상수V === idxV, `${상수V} vs ${idxV} — 서비스워커 캐시로 오면 ?v= 가 없어 이 상수가 화면에 찍힌다`);

// ── 폰에서 카톡처럼 (2026-09-19 오후, 부장님 지시) ──────────────────────────
// 셋 다 **되돌리기 쉽고 되돌아가도 티가 안 난다.** 데스크톱에서는 멀쩡해 보이기 때문이다.
확인('방 본문이 좌우로 안 흔들린다', /\.sjm-room-body \{[\s\S]{0,400}?overflow-x: hidden/.test(css),
  'overflow-y 만 auto 로 두면 브라우저가 가로도 auto 로 잡는다 — 넓은 표 그림 하나에 방이 좌우로 흔들린다');
확인('말풍선 글자를 끌어서 고를 수 있다', /\.sjm-bubble \{[^}]*user-select: text/.test(css),
  '카톡처럼 필요한 데만 끌어서 복사 — 예전엔 앱이 만든 "복사" 시트밖에 없었다');
확인('말풍선이 user-select 금지 목록에 없다', !/\.sjm-bubble,[^{]*\{[^}]*user-select: none/.test(css));
확인('표·그림을 눌러 크게 본다', /<img src="\$\{esc\(g\.url\)\}"[^`]*data-act="view-img"/.test(앱),
  '폰에서 표는 작아서 안 보인다 — 눌러서 뷰어(핀치 확대)로 열어야 한다');
확인('할 일 없는 길게누름은 타이머를 안 건다', /긴누름있나\(el\)/.test(앱),
  '남의 메시지에 타이머가 돌면 suppressClick 이 걸려 다음 누름이 먹히고, 데스크톱 우클릭 메뉴도 사라진다');

// ── 방 커튼 (2026-09-19 오후, 부장님 지시) ──────────────────────────────────
// "임원이라도 자기 부서 아니면 대화를 못 보게 해. 이건 대표님도 마찬가지 — 대표님은 영업부서만."
// 이건 **되돌아가기 쉬운 종류**다: 임원 한 분이 "왜 안 보이냐" 하시면 한 줄 되살리는 걸로 끝나고,
// 그러면 전 직원 방이 다시 임원 화면에 깔린다. 화면은 멀쩡해 보이니 아무도 모른다.
// 커튼은 네 군데를 동시에 쳐야 한다 — 목록·프로젝트·연락처·검색. 하나만 열려 있어도 걸어 들어간다.
확인('메신저에 임원 예외가 없다', !/임원인가/.test(앱),
  '등급으로 남의 부서·프로젝트 방을 여는 길은 두지 않는다 — 참여자로 적혀 있을 때만 본다');
확인('프로젝트는 참여자만 본다', /보이는프로젝트 = \(\) => state\.projects\.filter\(\(p\) => !p\.hidden && L\.내프로젝트인가\(p, me\(\)\)\)/.test(앱),
  '여기에 등급 조건이 다시 붙으면 전사 프로젝트가 다 열린다');
for (const [이름, 패턴] of [
  ['연락처 부서 목록', /const 볼부서 = DEPT_NAMES\.filter\(\(dn\) => dn === \(my\.dept \|\| ''\)\)/],
  ['검색 부서 풀', /const 검색부서 = DEPT_NAMES\.filter\(\(dn\) => dn === \(나\(\)\.dept \|\| ''\)\)/],
]) 확인(`${이름}은 내 부서만`, 패턴.test(앱), '목록에서 뺀 방을 여기로 들어갈 수 있으면 뺀 의미가 없다');

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
확인('데이터 API 는 부모 fb 우선(iframe 브리지)', /const 품은창 = \(\) => \(독립실행 \? null : window\.parent\);/.test(앱)
  && /function getFB\(\) \{\s*try \{ const p = 품은창\(\); if \(p && p\.fb\) return p\.fb; \}/.test(앱));
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
// 9/26: b110 이 quiet.mjs 를 정적 import 해 놓고 껍데기에 안 넣었다 — 비행기 모드에서 앱이 통째로 안 뜬다(조용히, 온라인에선 멀쩡).
//   messenger.js 에서 따라가 닿는 상대 경로 정적 import 는 전부 껍데기에 있어야 한다(frame-fs → quiet 처럼 한 단계 건너도).
{
  const 닿는 = new Set(), 할일 = ['modules/messenger/messenger.js'];
  while (할일.length) {
    const 파일 = 할일.pop();
    for (const m of 읽기(파일).matchAll(/^\s*import\s[^'"]*?['"](\.{1,2}\/[^'"?]+)(?:\?[^'"]*)?['"]/gm)) {
      const 다음 = join(dirname(파일), m[1]).replace(/\\/g, '/');
      if (!닿는.has(다음)) { 닿는.add(다음); 할일.push(다음); }
    }
  }
  const 껍데기에 = (p) => { const 상대 = p.startsWith('modules/messenger/') ? './' + p.slice('modules/messenger/'.length) : '../' + p.slice('modules/'.length); return sw.includes(`'${상대}'`); };
  const 빠진 = [...닿는].filter((p) => !껍데기에(p));
  확인('messenger.js 가 정적으로 닿는 파일은 전부 껍데기 프리캐시에 있다', 닿는.size >= 5 && 빠진.length === 0, 빠진.join(', ') || `${닿는.size}개`);
}
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
// 2026-09-26 직원 시범 전 대조 — 새 창(⧉)·홈 화면 앱(독립실행)에서만 조용히 틀리던 것들
확인('독립실행 window.fb 에 getCountFromServer — 없으면 AI 가 기록을 못 세고 조각으로 어림한다',
  /getCountFromServer,\s*\} from 'https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-firestore\.js'/.test(앱)
  && /window\.fb = \{[\s\S]*?getCountFromServer,[\s\S]*?\};/.test(앱));
확인('독립실행 세기도 장부에 — 1천 건당 1(index.html 감싼세기와 같은 셈)',
  /if \(window\.parent === window\) \{[\s\S]*?window\.fb\.getCountFromServer = \(\.\.\.a\) => getCountFromServer\(\.\.\.a\)[\s\S]*?Math\.ceil\(\(Number\(s\.data\(\)\.count\) \|\| 0\) \/ 1000\)[\s\S]*?계량기\.한번읽기셈\(n, n\)/.test(앱));
// 9/26 뒤: 기준이 독립실행이 아니라 "플랫폼 창이 있나"(부모창) 다 — ⧉ 새 창은 연 창이 살아 있으면 카드가 된다.
확인('플랫폼 창이 없으면 첫 화면은 시키는 보기를 빼고 "PC 에서 된다" 고 말한다',
  /function AI첫화면\(\) \{[\s\S]{0,500}const 카드없음 = !부모창\(\);\s*const 보기 = 카드없음 \? AI보기\.filter\(\(q\) => !시키는질문인가\(q\)\)[\s\S]{0,500}카드없음 \? 등록은PC에서/.test(앱));
확인('플랫폼 창이 없으면 카드는 「실행」 대신 안내 · 없이 누르면 부르지도 남기지도 않는다',
  /function 제안달기\(m\) \{[\s\S]*?\$\{!부모창\(\) \? `<div class="sjm-act-sub">\$\{esc\(등록은PC에서\)\}<\/div>`/.test(앱)
  && /async function 제안실행\(m, btn\) \{[\s\S]{0,700}const 부모 = 부모창\(\);[\s\S]{0,200}if \(!부모있다\) \{ 토스트\(등록은PC에서, 3600\); return; \}[\s\S]{0,300}시간제한\(부모\.AI행위실행\(넘기기\(부모, m\.제안\)\)/.test(앱));

// ── ⧉ 새 창의 플랫폼 창 (2026-09-26 직원 시범 전 대조 뒤 남은 것) ──
// 새 창은 window.parent === window 라 독립실행으로 돌아 등록 카드·「화면 열기」 가 없었다(연 창이 바로 옆인데).
//   플랫폼 함수는 부모창()(= ai.js 플랫폼창고르기) 을 거쳐서만, fb·state·계량기는 품은창()(iframe 부모만)을 거쳐서만 부른다.
{
  const 코드 = 앱.replace(/\r\n/g, '\n').split('\n').filter((줄) => !/^\s*\/\//.test(줄)).join('\n');
  const 남은부모 = [...코드.matchAll(/window\.parent(?!\s*===\s*window)/g)].length;
  확인('window.parent 는 품은창 한 곳에서만 읽는다(나머지는 === window 비교뿐)',
    남은부모 === 1 && /const 품은창 = \(\) => \(독립실행 \? null : window\.parent\);/.test(코드), `${남은부모}곳`);
  확인('messenger.js 는 opener 를 직접 안 만진다(ai.js 플랫폼창고르기만)', !/(?<![a-z])opener/.test(코드.replace(/noopener/g, '')));
  const 플랫폼함수 = /([\w가-힣$]+)\s*\.\s*(AI행위목록|AI못하는행위|AI행위풀기|AI행위실행|보이는화면들|고칠수있는프로젝트|화면열기|toggleMsgPanel)(?![\w가-힣])/g;
  const 받는쪽 = [...코드.matchAll(플랫폼함수)].map((m) => m[1] + '.' + m[2]);
  확인('플랫폼 함수는 부모창() 에서 받은 부모로만 부른다', 받는쪽.length >= 4 && 받는쪽.every((x) => x.startsWith('부모.')), 받는쪽.join(' '));
  const 부모대입 = [...코드.matchAll(/const 부모 = ([^;]+);/g)].map((m) => m[1]);
  확인('const 부모 는 늘 부모창() 이다(쓸 때마다 다시 고른다)', 부모대입.length >= 4 && 부모대입.every((x) => x === '부모창()'), 부모대입.join(' | '));
  확인('부모창 = ai.js 플랫폼창고르기(window, 나)', /const 부모창 = \(\) => 플랫폼창고르기\(window, state\.me\);/.test(코드));
  확인('계량(잰다)은 품은창(iframe 부모)에만 얹는다 — 새 창은 자기 계량기(b111)가 센다, 연 창에 얹으면 두 번 센다',
    !/부모\.잰다|부모창\(\)\.잰다/.test(코드) && (코드.match(/const p = 품은창\(\); p && p\.잰다 && p\.잰다\(/g) || []).length === 2);
  확인('연 창 함수에 넘기는 것은 그 창의 JSON 으로(다른 창 객체는 Firestore 가 거부한다)',
    /const 넘기기 = \(부모, x\) => 부모\.JSON\.parse\(JSON\.stringify\(x \?\? null\)\);/.test(코드)
    && /부모\.AI행위풀기\(날것\.행위, 넘기기\(부모, 날것\.인자\), 넘기기\(부모, \{ 본문 \}\)\)/.test(코드));
  확인('「화면 열기」 버튼도 부모창 기준', /function 화면달기\(m\) \{\s*if \(!부모창\(\)\) return '';/.test(코드));

  const { 플랫폼창고르기 } = await import('../modules/messenger/ai.js');
  const 창 = (더 = {}) => { const w = { ...더 }; if (!('parent' in 더)) w.parent = w; return w; };
  const 연창 = (더 = {}) => ({ closed: false, AI행위목록: () => [], fb: {}, state: { currentUser: 'u1' }, ...더 });
  const P = {};
  확인('고르기: iframe 이면 부모(전과 같다)', 플랫폼창고르기(창({ parent: P }), 'u1') === P);
  const O = 연창();
  확인('고르기: 새 창 + 살아 있는 같은 출처 연 창 → 연 창', 플랫폼창고르기(창({ opener: O }), 'u1') === O);
  확인('고르기: 나를 모르면 연 창도 안 쓴다(신뢰 경계는 기본이 막힘)', 플랫폼창고르기(창({ opener: O })) === null && 플랫폼창고르기(창({ opener: O }), '') === null);
  확인('고르기: 홈 화면 앱(opener 없음) → null', 플랫폼창고르기(창({ opener: null }), 'u1') === null);
  확인('고르기: 연 창을 닫았으면 → null(쓸 때마다 다시 본다)', 플랫폼창고르기(창({ opener: 연창({ closed: true }) }), 'u1') === null);
  const 다른출처 = { closed: false };
  Object.defineProperty(다른출처, 'AI행위목록', { get() { throw new Error('SecurityError: Blocked a frame with origin'); } });
  확인('고르기: 연 창이 다른 출처로 갔으면(읽는 순간 던진다) → null, 던지지 않는다', 플랫폼창고르기(창({ opener: 다른출처 }), 'u1') === null);
  확인('고르기: 플랫폼 함수·fb 가 없는 창(다른 화면으로 갔다·아직 안 떴다) → null',
    플랫폼창고르기(창({ opener: { closed: false } }), 'u1') === null && 플랫폼창고르기(창({ opener: 연창({ fb: null }) }), 'u1') === null);
  확인('고르기: 연 창이 다른 사람·로그아웃이면 → null(그 사람 권한으로 카드를 풀면 안 된다)',
    플랫폼창고르기(창({ opener: 연창({ state: { currentUser: 'u2' } }) }), 'u1') === null
    && 플랫폼창고르기(창({ opener: 연창({ state: { currentUser: null } }) }), 'u1') === null);
  const 자기 = 창(); 자기.opener = 자기;
  확인('고르기: opener 가 자기 자신이면 → null', 플랫폼창고르기(자기, 'u1') === null);
}
확인('규격·NAS 검색 서버가 꺼졌으면 맥락에 밝힌다(ai.js 사내문서 오류)', /if \(문서 && 문서\.오류\) 넣\(/.test(앱));
확인('실패 말풍선은 실패말(한국어 한 줄) · 원문은 안 보이는 칸', /const 실패 = 실패말\(e\);/.test(앱) && /text: 실패\.글/.test(앱) && !/text: String\(e && e\.message \|\| e\), type: 'text', md: false, 실패: true/.test(앱));

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
  && /channel in (\['c1'\]|noticeChannels\(\))\) \|\| isDeptHeadOrAbove\(\)/.test(규칙),
  '화면만 막으면 개발자 도구로 그냥 쓸 수 있다');
확인('메신저도 같은 기준으로 입력창을 접는다', /L\.공지쓰기가능\(나\(\)\)/.test(앱)
  && /export const 공지등급 = \['super', 'exec', 'manager'\]/.test(읽기('modules/messenger/lib.js')),
  '규칙과 화면이 다른 기준을 쓰면 "보이는데 안 써지는" 상태가 된다');

// ── 2단계: readers 로 좁혀 읽기 (2026-09-21) ──
// 되돌리면 화면은 멀쩡하다. 남의 1:1 대화가 다시 브라우저까지 내려오고, 부팅 읽기가 500 으로 돌아갈 뿐이다.
// **눈에 안 보이는 종류라 여기서 잡는다.**
확인('규칙: messages 읽기가 readers 를 본다',
  /match \/messages\/\{messageId\}[\s\S]{0,900}allow read:[\s\S]{0,300}request\.auth\.uid in resource\.data\.get\('readers', \[\]\)/.test(규칙),
  "isCompanyUser() 하나로 돌아가면 사내 누구나 남의 1:1 대화를 읽는다");
확인('규칙: 공지는 readers 없이도 읽힌다',
  /allow read:[\s\S]{0,300}resource\.data\.channel in noticeChannels\(\)/.test(규칙),
  '이게 빠지면 전사 공지가 아무에게도 안 보인다 — 조용히 사라지는 종류');
확인('규칙 함수 이름은 영문이다',
  !/function +[^\x00-\x7F]/.test(규칙),
  '규칙 언어는 한글 식별자를 못 읽는다(2026-09-21 에뮬레이터가 잡았다)');
확인('화면: messages 구독을 readers 로 좁힌다',
  /fb\.where\('readers', 'array-contains', me\(\)\)/.test(앱),
  '좁히지 않으면 규칙이 목록 조회를 통째로 거부해 메신저가 빈 화면이 된다');
확인('화면: 전체 messages 구독은 스위치 뒤에만 있다',
  /if \(이단계\) \{/.test(앱)
  && (앱.match(/collection\(fb\.db, 'messages'\), fb\.orderBy\('createdAt', 'desc'\), fb\.limit/g) || []).length <= 1,
  '옛길은 스위치 아래 한 벌만. 두 벌이 되면 켜도 500읽기가 남는다');
확인('화면: 2단계 스위치가 있다', /const 이단계 = (true|false);/.test(앱),
  '백필·색인·규칙이 끝나기 전에 켜면 전 직원이 빈 화면을 본다');
확인('화면: 공지도 따로 구독한다',
  /fb\.where\('channel', '==', 공지방\)/.test(앱),
  'readers 로만 받으면 공지(readers 없음)가 안 온다');
확인('색인 파일에 두 질의가 다 있다', (() => {
  try {
    const idx = JSON.parse(읽기('firestore.indexes.json'));
    const 있나 = (f) => (idx.indexes || []).some((x) => x.collectionGroup === 'messages'
      && JSON.stringify(x.fields) === JSON.stringify(f));
    return 있나([{ fieldPath: 'readers', arrayConfig: 'CONTAINS' }, { fieldPath: 'createdAt', order: 'DESCENDING' }])
      && 있나([{ fieldPath: 'channel', order: 'ASCENDING' }, { fieldPath: 'createdAt', order: 'DESCENDING' }]);
  } catch (e) { return false; }
})(), '복합색인이 없으면 구독이 통째로 실패한다 — 화면은 "불러오는 중" 에 머문다');

console.log(`\n${실패 ? '실패 ' + 실패 + '건' : '전부 통과'}`);
process.exit(실패 ? 1 : 0);

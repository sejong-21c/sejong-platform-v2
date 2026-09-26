/* 옛 AI 비서(modules/ai-assistant/ai-assistant.js)에 기대는 것들 (2026-09-26).
 *
 * 9/18(b33)부터 🤖 는 메신저를 연다. 옛 패널은 화면 어디에도 여는 단추가 없고 주소에 `?aipop=1` 을
 *   손으로 붙여야만 뜬다(일부러 남긴 비상구 — index.html 🤖 버튼 위 주석 · SJ메신저/README.md).
 *   맥 백업 aiUsage 로 세어 보니 마지막 사용이 9/18, 9/19~9/26 은 0건이다. 그래서 "죽은 코드" 로
 *   보이는데 **걷어내면 조용히 죽는 것이 섞여 있다**(걷어내려고 대조하다 찾았다):
 *
 *   · SJP_indexRecord — NCR·CAR·회의록·문서를 저장할 때 AI 색인(/rag/record)에 넣는 함수.
 *     정의가 이 파일에만 있고, 부르는 쪽(ncr·car·meeting.html · index.html 문서 저장)은 `if (fn)` 으로
 *     **없으면 건너뛴다**. 스크립트 줄만 지우면 저장은 멀쩡하고 AI 만 새 기록을 영영 모른다. 아무도 모른다.
 *   · 옛 패널 단추(🔑 관리자 도구 — 색인 점검·누락분 학습 · 알림/백업 즉시 실행 · 문서 등록 · 9Router
 *     공용 공유 — 도 다른 화면에 없다). 파일을 빼고 패널·?aipop=1 을 남기면 단추가 ReferenceError 로 죽는다.
 *
 * 그래서 못 박는다: 옛 비서를 걷어내든 ?aipop=1 일 때만 싣든, 부르는 쪽이 남아 있는 전역은
 *   index.html 이 **늘** 싣는 스크립트(인라인 포함) 안에 정의가 있어야 한다.
 */
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';

const 뿌리 = new URL('../', import.meta.url);
const 읽기 = (p) => readFileSync(new URL(p, 뿌리), 'utf8');
const html = 읽기('index.html');

// index.html 이 <script src> 로 늘 싣는 우리 파일(CDN 빼고, ?v= 떼고) + 인라인 전부
const 실린것 = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
  .map((m) => m[1]).filter((s) => !/^https?:/.test(s)).map((s) => s.split('?')[0]);
const 조각 = [['index.html', html], ...실린것.map((f) => [f, 읽기(f)])];
const 늘실림 = 조각.map((c) => c[1]).join('\n');
const 정의됨 = (이름) => new RegExp(`(?:window\\.${이름}\\s*=[^=]|function\\s+${이름}\\s*\\()`).test(늘실림);

let n = 0;
const T = (why, fn) => { fn(); n++; console.log('PASS  ' + why); };

// 부르는 쪽: modules/**.html · index.html 에서 window.X / parent.X 로 닿는 곳(정의 줄과 옛 비서 자신은 뺀다)
function 부르는곳(이름) {
  const re = new RegExp(`(?:parent|window)\\.${이름}\\b(?!\\s*=[^=])`);
  const 파일 = ['index.html', ...readdirSync(new URL('modules/', 뿌리), { recursive: true })
    .filter((f) => /\.(html|js|mjs)$/.test(f)).map((f) => 'modules/' + f.replace(/\\/g, '/'))]
    .filter((f) => f !== 'modules/ai-assistant/ai-assistant.js');
  return 파일.filter((f) => 읽기(f).split('\n').some((줄) => !/^\s*\/\//.test(줄) && re.test(줄)));
}

T('SJP_indexRecord — 부르는 쪽이 있으면 늘 실리는 스크립트에 정의가 있다(없으면 색인이 조용히 멎는다)', () => {
  const 곳 = 부르는곳('SJP_indexRecord');
  assert.ok(곳.length >= 3, '부르는 쪽을 못 찾았다 — 이름이 바뀌었나? ' + 곳.join(', '));
  assert.ok(정의됨('SJP_indexRecord'),
    'SJP_indexRecord 를 부르는 곳(' + 곳.join(', ') + ')이 있는데 index.html 이 늘 싣는 스크립트에 정의가 없다. '
    + '옛 비서(ai-assistant.js)를 걷어냈다면 SJP_indexRecord·SJP_buildRecordText·SJP_isVoidTest 를 먼저 옮겨라');
  // 2026-09-26 리뷰: 이름 하나만 보면 SJP_indexRecord 만 옮기고 나머지를 두고 와도 통과했다. 그러면 NCR·CAR 저장마다
  //   'SJP_isVoidTest is not a function' 이 나는데 부르는 쪽이 결과를 안 기다려 저장은 멀쩡하고 색인만 멎는다.
  //   전역 둘은 늘 실리는 곳에, 파일 속 도우미 셋(REC_SPECS·getGatewayUrl·gatewayAuthHeaders)은 같은 파일에 있어야 한다.
  for (const 이름 of ['SJP_buildRecordText', 'SJP_isVoidTest'])
    assert.ok(정의됨(이름), `SJP_indexRecord 가 부르는 ${이름} 이 늘 실리는 스크립트에 없다 — 색인이 조용히 멎는다`);
  const 집 = 조각.find((c) => /window\.SJP_indexRecord\s*=[^=]/.test(c[1]));
  for (const 이름 of ['REC_SPECS', 'getGatewayUrl', 'gatewayAuthHeaders'])
    assert.ok(new RegExp(`(?:var|let|const)\\s+${이름}\\s*=|function\\s+${이름}\\s*\\(`).test(집[1]),
      `SJP_indexRecord 가 쓰는 ${이름} 이 같은 파일(${집[0]})에 없다 — 옮길 때 같이 가져와라`);
});

T('옛 패널(?aipop=1 비상구)의 단추가 부르는 함수가 모두 정의돼 있다', () => {
  const a = html.indexOf('<div class="ai-panel" id="aiPanel">');
  if (a < 0) return;                                   // 패널째 걷어냈으면 볼 것이 없다
  const 패널 = html.slice(a, html.indexOf('<script>', a));
  const 이름들 = new Set();
  for (const m of 패널.matchAll(/\bon[a-z]+="([^"]*)"/g))
    for (const c of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (c[1] !== 'if') 이름들.add(c[1]);
  assert.ok(이름들.has('sendAiMessage'), '패널 단추를 못 읽었다: ' + [...이름들].join(', '));
  const 없음 = [...이름들].filter((x) => !정의됨(x));
  assert.deepEqual(없음, [], '패널 단추가 정의 없는 함수를 부른다 — 누르면 ReferenceError: ' + 없음.join(', '));
});

T('🔑 개인 AI 열쇠(오른쪽 위 내 이름 메뉴)는 index.html 에 산다 — 옛 비서와 상관없다', () => {
  assert.ok(/onclick="closeUserMenu\(\);개인열쇠창\(\)"/.test(html), '내 이름 메뉴에서 개인열쇠창() 부르는 줄을 못 찾았다');
  assert.ok(/function\s+개인열쇠창\s*\(/.test(html), '개인열쇠창 정의가 index.html 에 없다 — 게이트웨이 한도 안내가 가리키는 메뉴다');
});

console.log(`\nai-assistant-reach 테스트 ${n}개 전체 통과 · 늘 싣는 우리 스크립트 ${실린것.length}개`);

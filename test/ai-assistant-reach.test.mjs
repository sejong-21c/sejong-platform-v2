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
 *   index.html 이 **늘** 싣는 스크립트(인라인 포함) 안에 정의가 있거나, 늘 실리는 싣개(old-ai-loader)가
 *   스텁을 세우고 부를 때 그 파일을 싣는다(2026-09-26 부터 이쪽 — 방문마다 190KB 를 안 받는다).
 */
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const 뿌리 = new URL('../', import.meta.url);
const 읽기 = (p) => readFileSync(new URL(p, 뿌리), 'utf8');
const html = 읽기('index.html');
const 옛비서파일 = 'modules/ai-assistant/ai-assistant.js';
const 옛비서 = 읽기(옛비서파일);

// index.html 이 <script src> 로 늘 싣는 우리 파일(CDN 빼고, ?v= 떼고) + 인라인 전부
const 실린것 = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
  .map((m) => m[1]).filter((s) => !/^https?:/.test(s)).map((s) => s.split('?')[0]);
const 조각 = [['index.html', html], ...실린것.map((f) => [f, 읽기(f)])];
const 늘실림 = 조각.map((c) => c[1]).join('\n');
const 정의식 = (이름) => new RegExp(`(?:window\\.${이름}\\s*=[^=]|function\\s+${이름}\\s*\\()`);

// 싣개: 늘 실리는 인라인 <script id="old-ai-loader"> — 스텁 이름 목록과 싣는 주소
const 싣개 = (html.match(/<script id="old-ai-loader">([\s\S]*?)<\/script>/) || [])[1] || '';
const 스텁들 = [...((싣개.match(/\[([^\]]*)\]\s*\.forEach/) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
// 부르면 닿는가: 늘 실리는 곳에 정의가 있거나, 싣개가 스텁을 세우고 옛 비서 파일에 진짜가 있거나
const 정의됨 = (이름) => 정의식(이름).test(늘실림) || (스텁들.includes(이름) && 정의식(이름).test(옛비서));

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
  //   진짜 SJP_indexRecord 가 사는 파일(늘 실리는 곳 또는 싣개가 싣는 옛 비서)에 전역 둘과 도우미 셋이 같이 있어야 한다.
  //   (옛 비서가 싣개로 늦게 실리면서 '늘 실리는 곳' 이 아니라 '같은 파일' 로 바꿨다 — 한쪽만 옮기면 여전히 잡힌다)
  const 집 = [...조각, [옛비서파일, 옛비서]].find((c) => /window\.SJP_indexRecord\s*=\s*function\s*\(\s*kind/.test(c[1]));
  assert.ok(집, '진짜 SJP_indexRecord(function (kind, …)) 정의를 못 찾았다');
  for (const 이름 of ['SJP_buildRecordText', 'SJP_isVoidTest'])
    assert.ok(정의식(이름).test(집[1]), `SJP_indexRecord 가 부르는 ${이름} 이 같은 파일(${집[0]})에 없다 — 색인이 조용히 멎는다`);
  for (const 이름 of ['REC_SPECS', 'getGatewayUrl', 'gatewayAuthHeaders'])
    assert.ok(new RegExp(`(?:var|let|const)\\s+${이름}\\s*=|function\\s+${이름}\\s*\\(`).test(집[1]),
      `SJP_indexRecord 가 쓰는 ${이름} 이 같은 파일(${집[0]})에 없다 — 옮길 때 같이 가져와라`);
});

// ── 2026-09-26: 옛 비서를 방문마다 싣지 않고 부를 때 싣는다(old-ai-loader) ─────────────────────────
T('옛 비서는 <script src> 로 늘 싣지 않고, 싣개 한 곳에만 주소·판 번호가 있다', () => {
  assert.ok(!실린것.includes(옛비서파일), 'index.html 이 ai-assistant.js 를 <script src> 로 방문마다 싣는다 — 싣개(old-ai-loader)로 부를 때만');
  assert.ok(싣개, '<script id="old-ai-loader"> 를 못 찾았다');
  assert.ok(/'modules\/ai-assistant\/ai-assistant\.js\?v=\d+\.\d+\.\d+'/.test(싣개), '싣개에 ai-assistant.js?v=판 주소가 없다');
  const 곳 = html.match(/ai-assistant\.js\?v=/g) || [];
  assert.equal(곳.length, 1, `ai-assistant.js?v= 가 index.html 에 ${곳.length}곳 — 판 올릴 때 한 곳만 고치게 하나여야 한다`);
});

T('싣개의 스텁 이름은 모두 옛 비서가 실제로 만든다(안 만들면 스텁이 영영 경고만 한다)', () => {
  assert.ok(스텁들.includes('SJP_indexRecord') && 스텁들.includes('toggleAiPanel'), '스텁 목록을 못 읽었다: ' + 스텁들.join(', '));
  const 없음 = 스텁들.filter((x) => !정의식(x).test(옛비서));
  assert.deepEqual(없음, [], '옛 비서가 안 만드는 이름을 스텁으로 세웠다: ' + 없음.join(', '));
  // 스텁이 늘 실리는 곳의 진짜 정의와 겹치면 스텁이 그것을 덮어 버린다
  const 겹침 = 스텁들.filter((x) => 정의식(x).test(늘실림.replace(싣개, '')));
  assert.deepEqual(겹침, [], '늘 실리는 곳에 정의가 있는 이름을 또 스텁으로 덮는다: ' + 겹침.join(', '));
});

T('?aipop=1 은 옛 비서를 싣고(스텁 toggleAiPanel 로) 패널을 연다', () => {
  const a = html.indexOf("get('aipop') === '1'");
  assert.ok(a > 0, 'aipop 처리 블록을 못 찾았다');
  const 블록 = html.slice(a, html.indexOf('</script>', a));
  assert.ok(/window\.옛비서싣기\(\)/.test(블록), 'aipop 블록이 옛비서싣기() 를 부르지 않는다');
  assert.ok(/toggleAiPanel\(\)/.test(블록), 'aipop 블록이 toggleAiPanel() 로 패널을 열지 않는다');
  assert.ok(html.indexOf('<script id="old-ai-loader">') < a, '싣개가 aipop 블록보다 뒤에 있다 — 스텁이 서기 전에 부를 수 있다');
});

T('SJP_indexRecord 부르는 쪽은 window(.parent) 로만 닿고, 스텁은 그보다 먼저 선다', () => {
  // 부르는 쪽(ncr·car·meeting·index.html)은 `const fn = window.parent.SJP_indexRecord` 처럼 **스텁을 잡아 둘 수 있다**.
  //   그래도 되는 이유는 스텁이 부를 때마다 window 에서 진짜를 다시 찾기 때문 — 아래 실행 검사가 그걸 본다.
  //   여기서는 다른 길(전역 맨이름·import 등)로 닿는 곳이 새로 생기지 않았는지만 본다.
  for (const f of 부르는곳('SJP_indexRecord'))
    for (const 줄 of 읽기(f).split('\n'))
      if (/SJP_indexRecord/.test(줄) && !/^\s*(\/\/|<!--)/.test(줄) && !줄.includes("'SJP_indexRecord'"))
        assert.ok(/(?:parent|window)\.SJP_indexRecord/.test(줄), `${f}: SJP_indexRecord 를 window/parent 밖에서 잡는다 — ${줄.trim().slice(0, 120)}`);
  // 싣개는 늘 실리는 인라인(defer·module 아님)이라 파싱 도중에 서고, iframe 은 그 뒤에야 생긴다
  assert.ok(!/<script id="old-ai-loader"[^>]*\b(?:defer|async|type=)/.test(html), '싣개가 defer/async/module 이면 스텁이 늦게 선다');
});

T('옛 비서가 window 에 내놓는 이름 중 부르는 쪽이 있는 것은 모두 닿는다(스텁이거나 늘 실리는 곳에 정의)', () => {
  // 2026-09-26 리뷰: 위 검사들은 SJP_indexRecord 와 패널 onclick 이름만 본다. 스텁 목록은 사람이 손으로 맞추므로
  //   옛 비서에 새 전역(가령 window.SJP_indexAttachment)이 생기고 ncr.html 이 `const fn = window.parent.X; if (fn)` 로
  //   부르면 — 전에는 파일이 방문마다 실려 됐지만 이제는 싣는 것이 없어 `if (fn)` 이 늘 거짓, 색인이 조용히 멎는다.
  //   그래서 옛 비서의 `window.X =` 를 전부 뽑아, 부르는 쪽(모듈의 window/parent.X · index.html 의 맨이름 호출)이
  //   있으면 스텁 목록에 있거나 늘 실리는 곳에 정의가 있어야 한다고 못 박는다.
  const 이름들 = [...new Set([...옛비서.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=[^=]/g)].map((m) => m[1]))];
  assert.ok(이름들.includes('SJP_indexRecord') && 이름들.length >= 10, '옛 비서의 전역을 못 읽었다: ' + 이름들.join(', '));
  const 줄들 = html.split('\n').filter((줄) => !/^\s*(\/\/|<!--|\*)/.test(줄));
  const 맨부름 = (x) => 줄들.some((줄) => new RegExp(`(?<![.\\w$])${x.replace(/\$/g, '\\$')}\\s*\\(`).test(줄));
  const 끊김 = 이름들.filter((x) => (부르는곳(x).length || 맨부름(x)) && !정의됨(x))
    .map((x) => `${x}(${[...부르는곳(x), ...(맨부름(x) ? ['index.html 맨이름'] : [])].join(', ')})`);
  assert.deepEqual(끊김, [], '옛 비서에만 있는 전역을 부르는데 스텁도 늘 실리는 정의도 없다 — 싣개 스텁 목록에 넣어라: ' + 끊김.join(' · '));
});

// 싣개를 가짜 document 로 실제로 돌린다. 스크립트가 "실리면" 옛 비서처럼 window 에 진짜를 덮어쓴다.
function 싣개돌리기(실릴때) {
  const 붙인것 = [], 경고 = [];
  const 창 = {
    Promise,
    console: { warn: (...a) => 경고.push(a.join(' ')) },
    document: {
      createElement: () => ({ remove() { this.지워짐 = true; } }),
      head: { appendChild: (s) => { 붙인것.push(s); queueMicrotask(() => 실릴때(창, s)); } },
    },
  };
  창.window = 창;
  vm.runInNewContext(싣개, 창);
  return { 창, 붙인것, 경고 };
}

{
  // ① 정상: 스텁을 먼저 잡아 둔 쪽(iframe 의 const fn)도 진짜에 같은 인자로 닿고 결과를 받는다. 파일은 한 번만 붙인다.
  const 받은 = [];
  const 진짜 = (...a) => { 받은.push(a); return Promise.resolve({ ok: 1, id: a[1] }); };
  const { 창, 붙인것, 경고 } = 싣개돌리기((w, s) => { w.SJP_indexRecord = 진짜; s.onload(); });
  const 잡아둔스텁 = 창.SJP_indexRecord;
  const [가, 나] = await Promise.all([
    잡아둔스텁('ncr', 'N1', '', '', { rec: { id: 'N1' } }),
    창.SJP_indexRecord('doc', 'D1', '제목', '본문'),
  ]);
  assert.deepEqual([가, 나], [{ ok: 1, id: 'N1' }, { ok: 1, id: 'D1' }], '스텁이 진짜의 결과를 돌려주지 않는다');
  assert.equal(창.SJP_indexRecord, 진짜, '실린 뒤 window.SJP_indexRecord 가 진짜가 아니다');
  assert.deepEqual(await 잡아둔스텁('car', 'C1', '', '', { remove: true }), { ok: 1, id: 'C1' }, '실린 뒤에도 잡아 둔 스텁이 진짜로 안 간다');
  assert.equal(JSON.stringify(받은[0]), JSON.stringify(['ncr', 'N1', '', '', { rec: { id: 'N1' } }]), '진짜가 같은 인자를 못 받았다');
  assert.equal(받은.length, 3);
  assert.equal(붙인것.length, 1, '옛 비서 <script> 를 두 번 이상 붙였다: ' + 붙인것.length);
  assert.match(붙인것[0].src, /^modules\/ai-assistant\/ai-assistant\.js\?v=\d/);
  assert.deepEqual(경고, []);
  n++; console.log('PASS  싣개 실행 — 먼저 잡아 둔 스텁도 진짜로 닿고 결과·인자가 그대로, 파일은 한 번만 붙인다');
}
{
  // ② 파일은 실렸는데 이름을 안 만들었다: 자기 자신을 다시 부르며 끝없이 돌면 안 된다 — 경고 + skipped
  const { 창, 경고 } = 싣개돌리기((w, s) => s.onload());
  assert.deepEqual(await 창.SJP_indexRecord('ncr', 'N1'), { skipped: 'no-hook' });
  assert.ok(경고.some((w) => w.includes('SJP_indexRecord')), '이름이 안 생겼는데 경고가 없다');
  // ③ 네트워크 실패: 던지지 않고 skipped, 붙인 <script> 는 치우고 다음 부름에 다시 받는다
  let 번 = 0;
  const r = 싣개돌리기((w, s) => { if (++번 === 1) s.onerror(); else { w.toggleAiPanel = () => '열림'; s.onload(); } });
  assert.deepEqual(await r.창.toggleAiPanel(), { skipped: 'no-hook' }, '못 받았는데 skipped 가 아니다');
  assert.ok(r.붙인것[0].지워짐, '실패한 <script> 를 안 치웠다');
  assert.equal(await r.창.toggleAiPanel(), '열림', '한 번 실패한 뒤 다시 받지 않는다');
  assert.equal(r.붙인것.length, 2);
  n++; console.log('PASS  싣개 실행 — 이름이 안 생기거나 못 받아도 던지지 않고 skipped, 실패 뒤엔 다시 받는다');
}

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

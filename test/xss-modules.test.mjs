// 도구 화면(modules/*) 저장형 XSS 불변식 — 2026-09-27.
//
// 왜 필요한가: 도구 화면은 index.html 과 **같은 출처 iframe** 이다. 직원 누구나 쓰는 Firestore 칸
//   (NCR 내용·WBS 작업명·회의록 녹음 주소·서명 그림 주소 …)을 innerHTML 템플릿에 그대로 꽂으면,
//   그 화면을 여는 사람(대표·super 포함)의 로그인 세션으로 스크립트가 돈다. 화면은 멀쩡하므로 사람 눈에는
//   절대 안 보이는 종류다. 전수 대조에서 열여섯 화면에서 찾았다.
//   - 칸 값은 esc(따옴표까지 — 따옴표를 안 바꾸는 옛 도우미가 아홉 화면에 있었다: 속성에서 " 로 빠져나간다)
//   - onclick="fn('${id}')" 인자는 jsArg — esc 만으로는 &#39; 가 속성 해석 때 ' 로 되돌아가 JS 문자열이 깨진다
//   - 자료에서 온 주소는 safeUrl — javascript: 는 href·window.open 에서 같은 출처로 돈다
//
//   node test/xss-modules.test.mjs
import { readFileSync } from 'node:fs';

let 실패 = 0;
const T = (이름, 참, 덧 = '') => { if (!참) 실패++; console.log((참 ? 'PASS  ' : 'FAIL  ') + 이름 + (덧 ? '  — ' + 덧 : '')); };
const 읽기 = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ── 1) 고친 화면마다 이스케이프 도우미가 있고, 따옴표까지 바꾼다 ─────────
const 화면 = {
  'modules/agitator/agitator.html': 'esc',
  'modules/asset-registry.html': 'esc',
  'modules/car/car.html': '_htmlEsc',
  'modules/expense/expense.html': 'esc',
  'modules/itp-viewer/itp-viewer.html': 'esc',
  'modules/knowledge-map/knowledge-map.html': 'esc',
  'modules/manday-tracker/manday-tracker.html': 'escapeHtml',
  'modules/measurement-tools/measurement-tools.html': 'esc',
  'modules/meeting/meeting.html': 'esc',
  'modules/mobile-inspection/mobile-inspection.html': 'escapeHtml',
  'modules/ncr/ncr.html': '_htmlEsc',
  'modules/projects/wbs-share.html': 'esc',
  'modules/projects/wbs.html': 'esc',
  'modules/purchase/purchase.html': 'escapeHtml',
  'modules/qa-viewer/qa-viewer.html': 'esc',
  'modules/quality/qa-dashboard.html': '_qdHtmlEsc',
};
const 원문 = {};
for (const [f, h] of Object.entries(화면)) {
  const s = (원문[f] = 읽기(f));
  const 정의 = s.match(new RegExp(`(?:function ${h}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,200}?\\}|const ${h}\\s*=[^\\n]*)`));
  T(`${f} — ${h} 가 있다`, !!정의);
  T(`${f} — ${h} 가 따옴표(" ')까지 바꾼다`, !!정의 && /\[&<>"'\]|\[<>&"'\]/.test(정의[0]), 정의 ? 정의[0].replace(/\s+/g, ' ').slice(0, 90) : '');
  for (const 짝 of ['jsArg', 'safeUrl']) {
    if (s.includes('${' + 짝 + '(') || s.includes(짝 + '(')) T(`${f} — ${짝} 를 쓰면 정의도 있다`, new RegExp(`function ${짝}\\s*\\(|const ${짝}\\s*=`).test(s));
  }
}

// ── 2) 알려진 자리(전수 대조에서 찾은 곳)가 이스케이프를 거친다 ─────────
const 자리 = [
  ['modules/projects/wbs.html', '${esc(w.name.slice(0,22))}', '${w.name.slice(0,22)}'],
  ['modules/projects/wbs.html', 'onclick="wpPick(${jsArg(w.id)},${jsArg(pickLabel)})"', "wpPick('${w.id}'"],
  ['modules/ncr/ncr.html', '>${_htmlEsc(n.desc)}</td>', '>${n.desc}</td>'],
  ['modules/ncr/ncr.html', 'onclick="openNCRMgr(${jsArg(n.id)})"', "openNCRMgr('${n.id}')"],
  ['modules/car/car.html', 'onclick="openCARMgr(${jsArg(c.id)})"', "openCARMgr('${c.id}')"],
  ['modules/meeting/meeting.html', 'src="${esc(safeUrl(m.audioUrl))}"', 'src="${m.audioUrl}"'],
  ['modules/meeting/meeting.html', 'href="${esc(safeUrl(m.audioUrl))}"', 'href="${m.audioUrl}"'],
  ['modules/quality/qa-dashboard.html', '${_qdHtmlEsc(r.docNo)}', '${r.docNo}'],
  ['modules/quality/qa-dashboard.html', '${_qdHtmlEsc(i.text)}', '${i.text}'],
  ['modules/itp-viewer/itp-viewer.html', 'src="${esc(safeUrl(sig))}"', 'src="${sig}"'],
  ['modules/measurement-tools/measurement-tools.html', 'src="${esc(safeUrl(sig))}"', 'src="${sig}"'],
  ['modules/measurement-tools/measurement-tools.html', 'href="${esc(safeUrl(t.certificateUrl))}"', 'href="${esc(t.certificateUrl)}"'],
  ['modules/mobile-inspection/mobile-inspection.html', 'a.href=safeUrl(p.dataUrl);', 'a.href=p.dataUrl;'],
  ['modules/expense/expense.html', 'src="${esc(safeUrl(볼주소(r)))}"', 'src="${볼주소(r)}"'],
];
for (const [f, 있어야, 없어야] of 자리) {
  const s = 원문[f];
  T(`${f} — ${있어야.slice(0, 60)}`, s.includes(있어야) && !s.includes(없어야), s.includes(없어야) ? '옛 모양이 남았다: ' + 없어야 : '');
}

// ── 3) 첨부 새 탭: noopener · javascript: 막기 · 형식 허용 목록 ──────────
for (const [f, 여는곳, 블롭] of [
  ['modules/ncr/ncr.html', 'n.meta.fileUrl', '_toBlobUrl'],
  ['modules/car/car.html', 'c.meta.fileUrl', '_toBlobUrl'],
  ['modules/quality/qa-dashboard.html', 'rec.meta.fileUrl', '_qdToBlobUrl'],
]) {
  const s = 원문[f];
  T(`${f} — R2 첨부를 noopener 로 연다`, /window\.open\(await window\.첨부\.주소\([^)]*\), '_blank', 'noopener'\)/.test(s));
  T(`${f} — 옛 fileUrl 은 safeUrl 을 거친다`, s.includes(`window.open(safeUrl(${여는곳}), '_blank', 'noopener')`));
  const 몸 = (s.match(new RegExp(`function ${블롭}\\([\\s\\S]{0,900}?\\n\\}`)) || [''])[0];
  T(`${f} — ${블롭} 가 자료의 형식을 그대로 믿지 않는다(text/html·svg → octet-stream)`, /application\\\/pdf\|image\\\/\(png/.test(몸) && /'application\/octet-stream'/.test(몸));
}
T('modules/expense/expense.html — openInNewTab 도 형식 허용 목록', /mime0[\s\S]{0,200}application\\\/pdf\|image\\\/\(png/.test(원문['modules/expense/expense.html']));

// ── 4) 날것의 id 를 onclick 문자열에 꽂는 옛 모양이 다시 생기지 않는다 ────
// (상수 인자 addToNcrList('${type}',…) 같은 건 자료가 아니라 제외 — id 처럼 생긴 칸만 본다)
const 날것 = /on[a-z]+="[^"]*'\$\{(?:[a-zA-Z_]\w*\.)+(?:id|pid|carId|ncrId|toolId|itemId|code)\}'/g;
for (const f of Object.keys(화면)) {
  const 남은 = 원문[f].match(날것) || [];
  T(`${f} — onclick 에 날것 id 가 없다`, 남은.length === 0, 남은.slice(0, 2).join(' / '));
}

// ── 5) 도우미를 실제로 돌려 본다 (ncr.html 에서 꺼내서) ──────────────
const ncr = 원문['modules/ncr/ncr.html'];
const 꺼내기 = (이름) => (ncr.match(new RegExp(`function ${이름}\\([^)]*\\) \\{(?:[^\\n]*\\}(?=\\r?\\n)|[\\s\\S]*?\\r?\\n\\})`)) || [''])[0];
const 코드 = [꺼내기('_htmlEsc'), 꺼내기('jsArg'), 꺼내기('safeUrl')].join('\n');
const { _htmlEsc, jsArg, safeUrl } = new Function(코드 + '\nreturn { _htmlEsc, jsArg, safeUrl };')();
const 악성 = `"'><img src=x onerror=alert(1)>&`;
T('_htmlEsc — 태그·따옴표·& 가 전부 글자가 된다', _htmlEsc(악성) === '&quot;&#39;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;', _htmlEsc(악성));
// jsArg: 속성 값으로 해석(HTML 디코드)한 뒤 JS 로 읽으면 원래 문자열이 그대로 나와야 한다
const 디코드 = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
for (const v of [`');alert(1);//`, `"><svg onload=alert(1)>`, `a\\b'c"d`, 'SJ-NCR-2026-01']) {
  const 속성 = jsArg(v);
  T(`jsArg — ${JSON.stringify(v)} 가 속성에서 빠져나가지 않고 원래 값으로 돌아온다`, !/["'<>]/.test(속성) && JSON.parse(디코드(속성)) === v, 속성);
}
for (const [u, 기대] of [['javascript:alert(1)', ''], ['  JaVaScRiPt:alert(1)', ''], ['data:text/html,<script>', ''], ['vbscript:x', ''],
  ['https://r2.example/a.pdf', 'https://r2.example/a.pdf'], ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'], ['blob:https://x/1', 'blob:https://x/1']]) {
  T(`safeUrl(${JSON.stringify(u)})`, safeUrl(u) === 기대, JSON.stringify(safeUrl(u)));
}

console.log(실패 ? `\n${실패}건 실패` : '\n전부 통과');
process.exit(실패 ? 1 : 0);

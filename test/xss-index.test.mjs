// index.html 저장형 XSS 울타리 — 직원 누구나 쓰는 Firestore 글(일정·업무·결재·프로젝트 …)이
// 이스케이프 없이 innerHTML 로 들어가, 대시보드를 여는 super 권한으로 스크립트가 돌 수 있었다(2026-09-27 전수 대조).
// 고친 자리가 옛 모양으로 돌아가면 여기서 깨진다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const 있다 = (조각, 말) => assert.ok(html.includes(조각), `${말} — 없음: ${조각}`);
const 없다 = (re, 말) => { const m = html.match(re); assert.ok(!m, `${말} — 남아 있음: ${m && m[0]}`); };

// 1) 도우미 셋
for (const 이름 of ['_escNote', '_safeUrl', '_jsArg']) 있다(`function ${이름}(`, `도우미 ${이름}`);

// 2) 알려진 급소
있다('<div style="font-size:13px;font-weight:500;">${_escNote(t.title)}</div>', '대시보드 「내 업무」 제목');
있다('<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:500;">${_escNote(e.title)}</div></div>', '대시보드 「다가오는 일정」 제목');
있다("${_escNote(a.title||'(제목 없음)')}", '결재 제목');
있다('${_escNote(a.description)}', '결재 본문');
있다('${_escNote(a.decisionNote)}', '결재 최종 의견');
있다('${_escNote(c.role)}', '결재란 역할');
있다('${_escNote(s.role)}', '결재선 칩 역할');
있다('src="${_safeUrl(u.signatureUrl)}"', '서명 이미지 주소');
있다('_escNote(n.title)', '알림 패널 제목(결재 제목·채널 이름이 들어온다)');
있다('onclick="openApprovalDetail(${_jsArg(a.id)})"', '결재 행 onclick');

// 3) 옛 모양이 다시 생기지 않는다
없다(/\$\{(t|e|a)\.title\}/, '업무·일정·결재 제목 날것');
없다(/\$\{a\.(description|decisionNote)\}/, '결재 본문·의견 날것');
없다(/(>|\$\{ic\} )\$\{(s|c)\.role\}/, '결재선 역할 날것(HTML 자리 — confirm 글은 제외)');
없다(/src="\$\{u\.signatureUrl\}"/, '서명 주소 날것');
없다(/'\$\{(p|a|o|t|e|u|it|w)\.id\}'/, "onclick 안 '${문서id}' (따옴표 든 id 로 빠져나간다)");

// 4) 도우미가 실제로 막는지 — 본문에서 떼어 와 돌려 본다
const 뗌 = (이름) => { const m = html.match(new RegExp(`function ${이름}\\([^)]*\\) \\{.*\\}`)); assert.ok(m, `${이름} 본문`); return m[0]; };
const { _escNote, _safeUrl, _jsArg } = new Function(`${뗌('_escNote')}\n${뗌('_safeUrl')}\n${뗌('_jsArg')}\nreturn { _escNote, _safeUrl, _jsArg };`)();

assert.ok(!_escNote('<img src=x onerror=alert(1)>').includes('<'), '_escNote 는 < 를 남기지 않는다');
assert.strictEqual(_escNote(`"'&`), '&quot;&#39;&amp;');
assert.strictEqual(_escNote(null), '');
assert.strictEqual(_safeUrl('javascript:alert(1)'), '', 'javascript: 는 버린다');
assert.strictEqual(_safeUrl(' JavaScript:alert(1)'), '', '대소문자·앞 공백도');
assert.strictEqual(_safeUrl('data:text/html,<script>'), '', '그림이 아닌 data: 는 버린다');
assert.strictEqual(_safeUrl('https://x.test/a?b=1&c="2"'), 'https://x.test/a?b=1&amp;c=&quot;2&quot;');
assert.ok(_safeUrl('data:image/png;base64,AAA').startsWith('data:image/png'));
const j = _jsArg(`a'b"c`);
assert.ok(!/['"]/.test(j), `_jsArg 결과에 날따옴표가 없다: ${j}`);
// 속성값 해독(&quot; → ") 뒤에는 JS 문자열 리터럴 하나로 돌아와야 한다
const 해독 = j.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert.strictEqual(new Function(`return ${해독}`)(), `a'b"c`);
assert.strictEqual(new Function(`return ${_jsArg('</div><img onerror=x>').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}`)(), '</div><img onerror=x>');

console.log('xss-index: OK');

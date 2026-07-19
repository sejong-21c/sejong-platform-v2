/*
 * AI 비서 — 세종플랫폼 전체 조회/등록을 대화로 처리
 *
 * v29.38: 무료 API 게이트웨이 — 키가 있는 회사를 순서대로 자동 시도하고,
 * 한도 초과(429)·키 오류·서버 오류·시간 초과면 다음 회사로 넘어간다.
 * v29.39: 회사당 키 여러 개(여러 계정) 등록 + 키 자동 교대. Cerebras·Mistral 추가.
 * 우선순위: Gemini → Groq → Cerebras → OpenRouter → Mistral → Claude(유료).
 * Groq/Cerebras/OpenRouter/Mistral은 OpenAI 호환 형식(tool_calls)이라 함수호출(조회/등록)도 그대로 동작.
 *
 * index.html 맨 마지막 <script>(전역 state/openTask/openModal 등이 정의된 블록) 바로 뒤에
 * 일반 <script src="...">로 로드된다. 같은 전역(비-모듈) 스코프를 공유하므로 이 파일에서
 * state, openTask, openNewNCR, openModal, closeModal, save, render, fb, SJP 등을 그대로 쓸 수 있다.
 *
 * 쓰기(등록) 액션은 절대 대신 저장하지 않는다 — 기존 open*() 모달을 그대로 띄우고
 * 필드만 미리 채운 뒤, 사람이 검토하고 기존 "확인" 버튼을 눌러야 실제 저장이 일어난다.
 * (예외: send_message — 메신저 iframe을 열지 않고 같은 messages 컬렉션에 직접 쓰되,
 *  채팅창 안 인라인 확인 카드에서 사람이 "전송"을 눌러야 실행된다.)
 */
(function () {
  // ── 0. AI 제공사 설정 — v29.38: 무료 자동 전환 게이트웨이 ─────
  // 단일 provider 선택 방식 → "키가 있는 회사를 순서대로 시도, 실패하면 자동으로 다음 회사"로 변경.
  // v29.39: 회사당 키 여러 개(여러 계정) 지원 — 한도 초과된 키는 자동으로 다음 키로 교대.
  //         Cerebras·Mistral 추가. 우선순위: Gemini → Groq → Cerebras → OpenRouter → Mistral → Claude(유료).
  // itp-builder.html의 API_KEY_LS 패턴과 동일하게, 키를 소스에 박지 않고
  // 각자 브라우저의 localStorage에 저장한다 — git 히스토리/배포 소스에 키가 남지 않음.
  var GEMINI_KEY_LS = 'sjp_gemini_api_key';
  var GROQ_KEY_LS = 'sjp_groq_api_key';
  var CEREBRAS_KEY_LS = 'sjp_cerebras_api_key';
  var OPENROUTER_KEY_LS = 'sjp_openrouter_api_key';
  var MISTRAL_KEY_LS = 'sjp_mistral_api_key';
  // Claude 키 — itp-builder.html과 동일한 localStorage 키를 그대로 재사용한다.
  var CLAUDE_KEY_LS = 'sjp_claude_api_key';
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  // 모델명은 각 회사에서 계속 갱신되므로 배열 앞에서부터 시도하고,
  // 없어진 모델(404/400)이면 자동으로 다음 모델을 시도한다.
  // Gemini 최신 모델 확인: https://ai.google.dev/gemini-api/docs/models
  var CLAUDE_MODEL = 'claude-sonnet-4-20250514';
  var PROVIDER_CHAIN = [
    { id: 'gemini', label: 'Gemini', ls: GEMINI_KEY_LS, signup: 'https://aistudio.google.com/apikey',
      note: '1순위 · Gemini — 키 1개당 하루 1,500회',
      models: ['gemini-flash-latest', 'gemini-2.5-flash'] },
    { id: 'groq', label: 'Groq', ls: GROQ_KEY_LS, signup: 'https://console.groq.com/keys',
      note: '2순위 · Groq — 키 1개당 하루 1,000회',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
    { id: 'cerebras', label: 'Cerebras', ls: CEREBRAS_KEY_LS, signup: 'https://cloud.cerebras.ai',
      note: '3순위 · Cerebras — 키 1개당 하루 100만 토큰 (분당 5회)',
      models: ['gpt-oss-120b', 'zai-glm-4.7'] },
    { id: 'openrouter', label: 'OpenRouter', ls: OPENROUTER_KEY_LS, signup: 'https://openrouter.ai/settings/keys',
      note: '4순위 · OpenRouter — 키 1개당 하루 50회',
      models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-3-27b-it:free', 'mistralai/mistral-small-3.1-24b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free'] },
    { id: 'mistral', label: 'Mistral', ls: MISTRAL_KEY_LS, signup: 'https://console.mistral.ai/api-keys',
      note: '5순위 · Mistral — 월 10억 토큰, 분당 2회 (선택)',
      models: ['mistral-small-latest', 'mistral-large-latest'] },
    { id: 'claude', label: 'Claude', ls: CLAUDE_KEY_LS, signup: 'https://console.anthropic.com',
      note: '6순위 · Claude — 유료 (ITP Builder와 공용, 선택)',
      models: [CLAUDE_MODEL] }
  ];
  // v29.39: 한 회사에 키 여러 개(여러 계정) 등록 가능 — 줄바꿈·쉼표·공백으로 구분
  function keysOf(p) { return lsGet(p.ls).split(/[\s,;]+/).filter(Boolean); }
  function hasAnyKey() { return PROVIDER_CHAIN.some(function (p) { return keysOf(p).length; }); }
  // 마지막으로 성공한 키 번호를 기억해 다음 요청은 그 키부터 시작
  // (한도가 소진된 키를 매 질문마다 다시 두드려 느려지는 것을 방지)
  var KEY_CURSOR_LS = 'sjp_ai_key_cursor';
  function getCursor(id) { try { return (JSON.parse(lsGet(KEY_CURSOR_LS) || '{}') || {})[id] || 0; } catch (e) { return 0; } }
  function setCursor(id, idx) {
    try {
      var c = {}; try { c = JSON.parse(lsGet(KEY_CURSOR_LS) || '{}') || {}; } catch (e2) {}
      c[id] = idx; localStorage.setItem(KEY_CURSOR_LS, JSON.stringify(c));
    } catch (e) {}
  }
  // 패널 상단 초록 점 = 키 있음, 회색 점 = 키 없음
  function updateDot() {
    var d = document.querySelector('#aiPanel .ai-panel-head span.dot');
    if (d) d.style.background = hasAnyKey() ? 'var(--success)' : '#cbd5e1';
  }

  // ── 1. AI 액션/조회 레지스트리 (window.SJP.ai) ─────────────────
  window.SJP = window.SJP || {};
  var ai = window.SJP.ai = { actions: {} };
  function registerAction(name, def) { ai.actions[name] = def; }

  function $id(id) { return document.getElementById(id); }
  function setValue(el, v) { if (el && v !== undefined && v !== null && v !== '') el.value = v; }
  function setSelectByText(sel, needle) {
    if (!sel || !needle) return;
    var n = String(needle).toLowerCase();
    var opts = Array.prototype.slice.call(sel.options);
    var hit = opts.find(function (o) {
      var t = o.textContent.trim().toLowerCase();
      return t.indexOf(n) !== -1 || n.indexOf(t) !== -1;
    });
    if (hit) sel.value = hit.value;
  }
  function findProject(text) {
    if (!text) return null;
    var t = String(text).toLowerCase();
    return (state.projects || []).find(function (p) {
      var code = (p.code || '').toLowerCase(), name = (p.name || '').toLowerCase();
      return code.indexOf(t) !== -1 || name.indexOf(t) !== -1 || t.indexOf(code) !== -1;
    }) || null;
  }
  function findUser(text) {
    if (!text) return null;
    var t = String(text).toLowerCase();
    return (state.users || []).find(function (u) {
      var name = (u.name || '').toLowerCase();
      return name.indexOf(t) !== -1 || t.indexOf(name) !== -1;
    }) || null;
  }
  function findChannel(text) {
    if (!text) return null;
    var t = String(text).toLowerCase();
    return (state.channels || []).find(function (c) {
      var name = (c.name || '').toLowerCase();
      return name.indexOf(t) !== -1 || t.indexOf(name) !== -1;
    }) || null;
  }

  // ── 2. 쓰기 액션 등록 — 기존 open*() 모달을 그대로 열고 필드만 채움 ──

  registerAction('create_task', {
    description: '업무(할 일) 등록',
    params: { title: '업무명', proj: '프로젝트명/코드', assignee: '담당자 이름', due: '마감일 YYYY-MM-DD', priority: 'high 또는 mid 또는 low' },
    fill: function (v) {
      openTask();
      setTimeout(function () {
        setValue($id('tkT'), v.title);
        var p = findProject(v.proj); if (p) $id('tkP').value = p.id;
        var u = findUser(v.assignee); if (u) $id('tkA').value = u.id;
        setValue($id('tkD'), v.due);
        setValue($id('tkPr'), v.priority);
      }, 0);
    }
  });

  // NCR/CAR는 v29.8 리팩터로 index.html 밖 별도 모듈(modules/ncr, modules/car)로 이동해서
  // 더 이상 openNewNCR() 같은 부모 함수가 없다 — ITP Builder 등과 같은 Layer 4 취급으로 내림.

  registerAction('create_project', {
    description: '신규 프로젝트 등록',
    params: { code: '프로젝트코드', name: '프로젝트명', client: '고객사', start: '시작일 YYYY-MM-DD', end: '완료일 YYYY-MM-DD', pm: 'PM 이름' },
    fill: function (v) {
      openNewProject();
      setTimeout(function () {
        setValue($id('npCode'), v.code);
        setValue($id('npName'), v.name);
        setValue($id('npClient'), v.client);
        setValue($id('npStart'), v.start);
        setValue($id('npEnd'), v.end);
        var u = findUser(v.pm); if (u) $id('npPm').value = u.id;
      }, 0);
    }
  });

  registerAction('create_event', {
    description: '일정(캘린더) 등록',
    params: { title: '제목', date: '날짜 YYYY-MM-DD', time: '시간 HH:MM(선택)', category: 'blue(회의) 또는 orange(검사) 또는 red(마감) 또는 green(교육)', dept: '담당 부서명' },
    fill: function (v) {
      openEvent(v.date);
      setTimeout(function () {
        setValue($id('evT'), v.title);
        setValue($id('evTm'), v.time);
        setValue($id('evC'), v.category);
        setSelectByText($id('evDept'), v.dept);
      }, 0);
    }
  });

  registerAction('create_quote', {
    description: '견적 등록',
    params: { client: '고객사', subject: '건명', amount: '금액(원, 숫자만)', owner: '담당자 이름' },
    fill: function (v) {
      openQuote();
      setTimeout(function () {
        setValue($id('qC'), v.client);
        setValue($id('qS'), v.subject);
        setValue($id('qA'), v.amount);
        var u = findUser(v.owner); if (u) $id('qO').value = u.id;
      }, 0);
    }
  });

  registerAction('create_approval', {
    description: '기안(결재) 등록',
    params: { title: '제목', type: '출장 또는 구매 또는 경비 또는 품의 또는 기타', amount: '금액(원, 숫자만, 선택)' },
    fill: function (v) {
      openApproval();
      setTimeout(function () {
        setValue($id('apT'), v.title);
        setSelectByText($id('apTy'), v.type);
        setValue($id('apA'), v.amount);
      }, 0);
    }
  });

  registerAction('create_tag', {
    description: '설비/부품 Tag 등록 (프로젝트 지정 필수)',
    params: { proj: '프로젝트명/코드 (필수)', tag: 'Tag No.', name: '장비명', type: '설비유형', spec: '규격', material: '재질' },
    fill: function (v) {
      var p = findProject(v.proj);
      if (!p) return { error: '프로젝트를 찾을 수 없습니다 — 정확한 프로젝트명/코드를 알려주세요.' };
      openNewTag(p.id);
      setTimeout(function () {
        setValue($id('tgTag'), v.tag);
        setValue($id('tgName'), v.name);
        setSelectByText($id('tgType'), v.type);
        setValue($id('tgSpec'), v.spec);
        setValue($id('tgMat'), v.material);
      }, 0);
    }
  });

  // Layer 3 — 메신저 iframe을 열지 않고 같은 messages 컬렉션에 직접 기록.
  // 폼을 채우는 대신 채팅창 안 인라인 확인 카드로 처리(아래 renderConfirmCard 참고).
  registerAction('send_message', {
    description: '메신저 채널로 메시지 전송',
    params: { channel: '채널명(부서명/프로젝트명 등)', text: '보낼 메시지 내용' },
    direct: true,
    resolve: function (v) {
      var ch = findChannel(v.channel);
      if (!ch) return { error: '"' + v.channel + '" 채널을 찾을 수 없습니다.' };
      return { channelId: ch.id, channelName: ch.name, text: v.text };
    },
    commit: function (resolved) {
      return fb.setDoc(fb.doc(fb.collection(fb.db, 'messages')), {
        channel: resolved.channelId, author: state.currentUser, text: resolved.text,
        at: new Date().toLocaleString('ko-KR'), createdAt: Date.now()
      });
    }
  });

  // ── 3. 범용 조회 도구 ───────────────────────────────────────────
  // 데이터 종류별 전용 함수를 계속 늘리는 대신, 컬렉션 하나를 통째로 넘기고 모델이 스스로 요약/판단하게 함.
  var QUERYABLE = ['projects', 'tasks', 'users', 'channels', 'quotes', 'approvals', 'events', 'okrs'];
  var LOCAL_ONLY = ['quotes', 'approvals', 'events', 'okrs']; // 이 브라우저에만 저장(전사 공유 아님)
  function queryState(collection) {
    if (collection === 'wbsData') return state.wbs || {};
    if (QUERYABLE.indexOf(collection) === -1) {
      return { error: '"' + collection + '"은(는) 조회할 수 없습니다. 사용 가능: ' + QUERYABLE.join(', ') + ', wbsData' };
    }
    var data = state[collection] || [];
    var out = Array.isArray(data) && data.length > 200
      ? { truncated: true, totalCount: data.length, sample: data.slice(0, 200) }
      : data;
    if (LOCAL_ONLY.indexOf(collection) !== -1) {
      return { note: '이 데이터는 현재 브라우저에만 저장되어 있어 다른 사람 화면과 다를 수 있습니다.', data: out };
    }
    return out;
  }
  ai.queryState = queryState;

  // ── 4. 모델(Gemini/Claude) 공용 function-calling 루프 ────────────
  var QUERY_STATE_DESC = '세종플랫폼 데이터 조회. collection에는 다음 중 하나만: ' + QUERYABLE.join(', ') + ', wbsData';

  function buildGeminiTools() {
    var decls = Object.keys(ai.actions).map(function (name) {
      var def = ai.actions[name];
      var props = {};
      Object.keys(def.params).forEach(function (k) { props[k] = { type: 'STRING', description: def.params[k] }; });
      return { name: name, description: def.description, parameters: { type: 'OBJECT', properties: props } };
    });
    decls.push({
      name: 'query_state',
      description: QUERY_STATE_DESC,
      parameters: { type: 'OBJECT', properties: { collection: { type: 'STRING' } }, required: ['collection'] }
    });
    return [{ functionDeclarations: decls }];
  }

  function buildClaudeTools() {
    var decls = Object.keys(ai.actions).map(function (name) {
      var def = ai.actions[name];
      var props = {};
      Object.keys(def.params).forEach(function (k) { props[k] = { type: 'string', description: def.params[k] }; });
      return { name: name, description: def.description, input_schema: { type: 'object', properties: props } };
    });
    decls.push({
      name: 'query_state',
      description: QUERY_STATE_DESC,
      input_schema: { type: 'object', properties: { collection: { type: 'string' } }, required: ['collection'] }
    });
    return decls;
  }

  var SYSTEM_INSTRUCTION = [
    '너는 세종기술의 사내 플랫폼 "세종플랫폼"의 AI 비서다. 한국어로 간결하게 답한다.',
    '조회는 query_state 도구로 처리한다. 등록/생성 요청은 해당 액션 도구를 호출한다 — 네가 직접 저장하는 게 아니라, ',
    '실제 입력 폼을 열고 값을 미리 채워주는 것뿐이며 최종 저장은 사용자가 화면에서 직접 확인 버튼을 눌러야 한다는 것을 답변에 명시해라.',
    'ncrs/cars/quotes/approvals/events/okrs 데이터는 사용자 브라우저에만 저장되어 다른 직원 화면과 다를 수 있다 — 관련 질문에는 이 점을 알려줘라.',
    'ITP Builder, QA 문서생성, 모바일 점검, NCR 관리, CAR 관리 관련 작업(도면/사진 업로드, 검사 문서 작성, 부적합/시정조치 등록·조회 등)은 아직 AI로 지원되지 않는다 — 그런 요청을 받으면 아직 지원되지 않는다고 명확히 답하고 해당 모듈을 직접 열어달라고 안내해라.',
    '프로젝트/담당자를 찾지 못했다는 응답을 받으면 사용자에게 정확한 이름을 다시 물어봐라.'
  ].join(' ');

  // 대화 기록은 제공사 중립 형식으로 보관하고, 각 provider 호출부에서만 변환한다.
  // { role:'user', text } | { role:'model', text } | { role:'model', functionCall:{name,args,id} } | { role:'function', name, result, callId }
  var history = [];

  function geminiContentsFromHistory(h) {
    return h.map(function (t) {
      if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
      if (t.role === 'model' && t.functionCall) return { role: 'model', parts: [{ functionCall: { name: t.functionCall.name, args: t.functionCall.args } }] };
      if (t.role === 'model') return { role: 'model', parts: [{ text: t.text }] };
      return { role: 'function', parts: [{ functionResponse: { name: t.name, response: { result: t.result } } }] };
    });
  }

  function httpError(prefix, status, detail) {
    var e = new Error(prefix + ' 호출 실패 (' + status + ')' + (detail ? ': ' + detail : ''));
    e.status = status;
    return e;
  }

  async function callGeminiOnce(key, model, h, signal) {
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      signal: signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: geminiContentsFromHistory(h),
        tools: buildGeminiTools()
      })
    });
    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw httpError('Gemini', res.status, errText.slice(0, 200));
    }
    var data = await res.json();
    var candidate = data.candidates && data.candidates[0];
    var parts = (candidate && candidate.content && candidate.content.parts) || [];
    var fnPart = parts.find(function (p) { return p.functionCall; });
    if (fnPart) return { type: 'function_call', name: fnPart.functionCall.name, args: fnPart.functionCall.args || {} };
    var text = parts.map(function (p) { return p.text || ''; }).join('').trim() || '(응답 없음)';
    return { type: 'text', text: text };
  }

  function claudeMessagesFromHistory(h) {
    return h.map(function (t) {
      if (t.role === 'user') return { role: 'user', content: t.text };
      if (t.role === 'model' && t.functionCall) return { role: 'assistant', content: [{ type: 'tool_use', id: t.functionCall.id, name: t.functionCall.name, input: t.functionCall.args }] };
      if (t.role === 'model') return { role: 'assistant', content: t.text };
      return { role: 'user', content: [{ type: 'tool_result', tool_use_id: t.callId, content: JSON.stringify(t.result) }] };
    });
  }

  async function callClaudeOnce(key, model, h, signal) {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1024,
        system: SYSTEM_INSTRUCTION,
        messages: claudeMessagesFromHistory(h),
        tools: buildClaudeTools()
      })
    });
    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw httpError('Claude', res.status, errText.slice(0, 200));
    }
    var data = await res.json();
    var blocks = data.content || [];
    var toolUse = blocks.find(function (b) { return b.type === 'tool_use'; });
    if (toolUse) return { type: 'function_call', name: toolUse.name, args: toolUse.input || {}, callId: toolUse.id };
    var text = blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim() || '(응답 없음)';
    return { type: 'text', text: text };
  }

  // ── Groq/OpenRouter: OpenAI 호환 API (function calling 포함) ──
  // 대화 기록을 OpenAI 메시지 형식으로 변환. Gemini에서 넘어온 함수호출 턴에는 id가 없으므로
  // 히스토리 인덱스로 id를 만들어 붙인다(호출 턴 i ↔ 결과 턴 i+1이 'call_i'로 짝을 이룸).
  function openAiMessagesFromHistory(h) {
    var msgs = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
    h.forEach(function (t, i) {
      if (t.role === 'user') msgs.push({ role: 'user', content: t.text });
      else if (t.role === 'model' && t.functionCall) msgs.push({
        role: 'assistant', content: null,
        tool_calls: [{ id: t.functionCall.id || ('call_' + i), type: 'function',
          function: { name: t.functionCall.name, arguments: JSON.stringify(t.functionCall.args || {}) } }]
      });
      else if (t.role === 'model') msgs.push({ role: 'assistant', content: t.text });
      else msgs.push({ role: 'tool', tool_call_id: t.callId || ('call_' + (i - 1)), content: JSON.stringify(t.result) });
    });
    return msgs;
  }

  function buildOpenAiTools() {
    var decls = Object.keys(ai.actions).map(function (name) {
      var def = ai.actions[name];
      var props = {};
      Object.keys(def.params).forEach(function (k) { props[k] = { type: 'string', description: def.params[k] }; });
      return { type: 'function', function: { name: name, description: def.description, parameters: { type: 'object', properties: props } } };
    });
    decls.push({
      type: 'function',
      function: { name: 'query_state', description: QUERY_STATE_DESC, parameters: { type: 'object', properties: { collection: { type: 'string' } }, required: ['collection'] } }
    });
    return decls;
  }

  async function callOpenAiCompatOnce(label, url, key, model, h, signal, extraHeaders) {
    var res = await fetch(url, {
      method: 'POST',
      signal: signal,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, extraHeaders || {}),
      body: JSON.stringify({ model: model, max_tokens: 1024, messages: openAiMessagesFromHistory(h), tools: buildOpenAiTools() })
    });
    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw httpError(label, res.status, errText.slice(0, 200));
    }
    var data = await res.json();
    var msg = ((data.choices || [])[0] || {}).message || {};
    var tc = (msg.tool_calls || [])[0];
    if (tc) {
      var args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
      return { type: 'function_call', name: tc.function.name, args: args, callId: tc.id };
    }
    var text = (typeof msg.content === 'string' ? msg.content : '').trim() || '(응답 없음)';
    return { type: 'text', text: text };
  }

  // ── 게이트웨이 체인: 키가 있는 회사를 순서대로, 실패하면 자동으로 다음 회사 ──
  var lastProviderLabel = '';   // 마지막으로 실제 응답한 회사 (답변 밑에 표시)

  async function callOneModel(p, key, model, h, signal) {
    if (p.id === 'gemini') return callGeminiOnce(key, model, h, signal);
    if (p.id === 'claude') return callClaudeOnce(key, model, h, signal);
    if (p.id === 'groq') return callOpenAiCompatOnce('Groq', 'https://api.groq.com/openai/v1/chat/completions', key, model, h, signal);
    if (p.id === 'cerebras') return callOpenAiCompatOnce('Cerebras', 'https://api.cerebras.ai/v1/chat/completions', key, model, h, signal);
    if (p.id === 'mistral') return callOpenAiCompatOnce('Mistral', 'https://api.mistral.ai/v1/chat/completions', key, model, h, signal);
    return callOpenAiCompatOnce('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', key, model, h, signal, { 'X-Title': 'Sejong Platform' });
  }

  // 한 회사 안에서: 마지막 성공 키부터 시작해 키를 교대하고, 키마다 모델 목록을 시도한다.
  async function tryProvider(p, h) {
    var keys = keysOf(p);
    var start = getCursor(p.id) % keys.length;
    var lastErr = null;
    for (var ki = 0; ki < keys.length; ki++) {
      var idx = (start + ki) % keys.length;
      var key = keys[idx];
      for (var mi = 0; mi < p.models.length; mi++) {
        const ctl = new AbortController();
        const timer = setTimeout(function () { ctl.abort(); }, 45000);
        try {
          var r = await callOneModel(p, key, p.models[mi], h, ctl.signal);
          clearTimeout(timer);
          setCursor(p.id, idx); // 이 키가 살아있음 — 다음 질문도 이 키부터
          return r;
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
          if (e.status === 400 || e.status === 404) continue; // 모델 문제(또는 Gemini 불량 키의 400) → 다음 모델
          if (e.status === 429 || e.status === 401 || e.status === 403) break; // 이 키 한도 소진/불량 → 다음 키
          throw e; // 서버 오류·시간 초과·연결 실패 → 회사 자체를 포기하고 다음 회사로
        }
      }
      // 이 키로 모든 모델이 실패 → 다음 키 시도
    }
    throw lastErr || new Error('사용 가능한 키/모델이 없습니다');
  }

  async function callProviderOnce(h, onStatus) {
    var avail = PROVIDER_CHAIN.filter(function (p) { return keysOf(p).length; });
    if (!avail.length) {
      throw new Error('아직 API 키가 없습니다 — 우측 상단 🔑 버튼을 눌러 무료 API 키를 등록해주세요.');
    }
    var fails = [];
    for (var i = 0; i < avail.length; i++) {
      var p = avail[i];
      if (onStatus) onStatus(p.label + ' 응답 대기 중…');
      try {
        var r = await tryProvider(p, h);
        lastProviderLabel = p.label;
        return r;
      } catch (e) {
        // Gemini는 잘못된 키를 401이 아니라 400("API key not valid")으로 돌려주므로 본문도 확인
        var why = (e.status === 401 || e.status === 403 || /api[ _]?key/i.test(e.message || '')) ? '키 오류'
          : e.status === 429 ? '무료 한도 초과'
          : e.name === 'AbortError' ? '시간 초과'
          : e.status ? ('오류 ' + e.status) : '연결 실패';
        fails.push(p.label + '(' + why + ')');
      }
    }
    throw new Error('모든 AI 호출 실패: ' + fails.join(', ') + ' — 잠시 후 다시 시도하거나 🔑에서 키를 확인해주세요.');
  }

  async function executeFunctionCall(name, args) {
    if (name === 'query_state') return queryState(args.collection);
    var def = ai.actions[name];
    if (!def) return { error: '알 수 없는 액션: ' + name };
    if (def.direct) {
      var resolved = def.resolve(args);
      if (resolved.error) return resolved;
      renderConfirmCard(name, def, resolved);
      return { status: '채팅창에 확인 카드를 띄웠습니다 — 사용자가 확인을 눌러야 실제로 실행됩니다.' };
    }
    var r = def.fill(args);
    if (r && r.error) return r;
    return { status: '"' + def.description + '" 입력 폼을 열고 값을 채워놨습니다. 사용자가 확인 후 저장 버튼을 눌러야 실제로 저장됩니다.' };
  }

  async function runConversation(userText, onStatus) {
    history.push({ role: 'user', text: userText });
    for (var i = 0; i < 5; i++) {
      var result = await callProviderOnce(history, onStatus);
      if (result.type === 'function_call') {
        history.push({ role: 'model', functionCall: { name: result.name, args: result.args, id: result.callId } });
        var execResult = await executeFunctionCall(result.name, result.args);
        history.push({ role: 'function', name: result.name, result: execResult, callId: result.callId });
        continue;
      }
      history.push({ role: 'model', text: result.text });
      return result.text;
    }
    return '요청을 처리하는 데 단계가 너무 많이 필요합니다. 질문을 조금 더 구체적으로 나눠서 다시 시도해주세요.';
  }

  // ── 5. 채팅 UI ──────────────────────────────────────────────────
  function appendMsg(role, text) {
    var box = $id('aiMessages');
    var div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function renderConfirmCard(actionName, def, resolved) {
    var box = $id('aiMessages');
    var card = document.createElement('div');
    card.className = 'ai-confirm-card';
    card.innerHTML = '<div>' + def.description + '</div>' +
      '<div style="margin:6px 0;color:var(--text-light);">' + (resolved.channelName ? '채널: ' + resolved.channelName + '<br>' : '') + (resolved.text || '') + '</div>' +
      '<button class="btn btn-primary" data-act="confirm">전송</button> ' +
      '<button class="btn" data-act="cancel">취소</button>';
    card.querySelector('[data-act="confirm"]').onclick = async function () {
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      try {
        await def.commit(resolved);
        appendMsg('system', '✓ 전송 완료');
      } catch (e) {
        appendMsg('system', '전송 실패: ' + (e.message || e));
      }
    };
    card.querySelector('[data-act="cancel"]').onclick = function () { card.remove(); };
    box.appendChild(card);
    box.scrollTop = box.scrollHeight;
  }

  window.openAiKeyModal = function () {
    // 공용 모달(z1000)이 AI 패널(z1700) 뒤에 깔리지 않게 잠시 올렸다가, 닫힐 때 원복
    var m = document.getElementById('modal');
    if (m) m.style.zIndex = 1800;
    var origClose = window.closeModal;
    window.closeModal = function () { if (m) m.style.zIndex = ''; window.closeModal = origClose; origClose(); };

    var fieldsHtml = PROVIDER_CHAIN.map(function (p) {
      var n = keysOf(p).length;
      return '<div class="fg">' +
        '<label class="fl">' + p.note +
        (n ? ' <b style="color:var(--success);">✓ ' + n + '개 등록됨</b>' : '') +
        ' — <a href="' + p.signup + '" target="_blank" rel="noopener">키 발급 ↗</a></label>' +
        '<textarea class="fi" rows="2" id="aiKeys_' + p.id + '" spellcheck="false" autocomplete="off"' +
        ' placeholder="한 줄에 키 1개 — 여러 개 넣으면 한도 초과 시 자동 교대"' +
        ' style="resize:vertical;font-size:11px;-webkit-text-security:disc;">' +
        lsGet(p.ls).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>' +
        '</div>';
    }).join('');
    openModal('🔑 AI 비서 — API 키 설정', '' +
      '<div style="font-size:12px;color:var(--text-light);margin-bottom:10px;line-height:1.6;">위에서부터 순서대로 자동 사용하고, 한도 초과·오류 시 다음으로 자동 전환됩니다.<br><b>계정을 여러 개 만들어 받은 키는 한 칸에 줄바꿈으로 전부 붙여넣으세요</b> — 키 단위로도 자동 교대되어 무료 한도가 키 수만큼 늘어납니다.</div>' +
      fieldsHtml +
      '<div style="font-size:11px;color:var(--text-lighter);line-height:1.6;">키는 각각 이 브라우저의 localStorage에만 저장되고, 해당 AI 회사 서버로만 직접 전송됩니다 — 저장소(git)나 세종플랫폼 서버로는 전송/저장되지 않습니다. 필드를 비운 채 저장하면 해당 키가 삭제됩니다.</div>',
      function () {
        PROVIDER_CHAIN.forEach(function (p) {
          var el = $id('aiKeys_' + p.id);
          lsSet(p.ls, el ? el.value.split(/[\s,;]+/).filter(Boolean).join('\n') : '');
        });
        try { localStorage.removeItem(KEY_CURSOR_LS); } catch (e) {} // 키가 바뀌었으니 교대 위치 초기화
        updateDot();
        window.closeModal();
        appendMsg('system', hasAnyKey()
          ? '✓ API 키 저장 완료 — 질문을 입력해보세요!'
          : 'API 키가 모두 비어 있습니다. 키를 등록해야 답변할 수 있어요.');
      }
    );
  };

  var keyHintShown = false;
  window.toggleAiPanel = function () {
    var p = $id('aiPanel');
    p.classList.toggle('open');
    if (p.classList.contains('open')) {
      if (window._positionAiPanel) window._positionAiPanel(); // v29.35 FAB 드래그 위치 따라 패널 배치
      updateDot();
      if (!hasAnyKey() && !keyHintShown) {
        keyHintShown = true;
        appendMsg('system', '아직 API 키가 없습니다 — 우측 상단 🔑 버튼을 눌러 무료 API 키(Gemini·Groq·OpenRouter)를 등록해주세요.');
      }
    }
  };

  var aiBusy = false;
  window.sendAiMessage = async function () {
    var input = $id('aiInput');
    var text = input.value.trim();
    if (!text || aiBusy) return;
    input.value = '';
    appendMsg('user', text);
    if (!hasAnyKey()) {
      appendMsg('system', '아직 API 키가 없습니다 — 우측 상단 🔑 버튼을 눌러 무료 API 키를 등록해주세요.');
      window.openAiKeyModal();
      return;
    }
    aiBusy = true;
    var btn = $id('aiSendBtn');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    appendMsg('system', '생각 중...');
    var thinkingEl = $id('aiMessages').lastChild;
    try {
      var reply = await runConversation(text, function (t) { thinkingEl.textContent = t; });
      thinkingEl.remove();
      appendMsg('assistant', reply);
      if (lastProviderLabel) appendMsg('system', '— ' + lastProviderLabel);
    } catch (e) {
      thinkingEl.remove();
      appendMsg('system', '오류: ' + (e.message || e));
    } finally {
      aiBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '전송'; }
    }
  };
})();

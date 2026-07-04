/*
 * AI 비서 — 세종플랫폼 전체 조회/등록을 대화로 처리
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
  // ── 0. AI 제공사 설정 (Gemini / Claude) ─────────────────────────
  // itp-builder.html의 API_KEY_LS 패턴과 동일하게, 키를 소스에 박지 않고
  // 각자 브라우저의 localStorage에 저장한다 — git 히스토리/배포 소스에 키가 남지 않음.
  // 무료 API 키 발급: https://aistudio.google.com/apikey
  var GEMINI_KEY_LS = 'sjp_gemini_api_key';
  var getGeminiKey = function () { try { return localStorage.getItem(GEMINI_KEY_LS) || ''; } catch (e) { return ''; } };
  var setGeminiKey = function (k) { try { if (k) localStorage.setItem(GEMINI_KEY_LS, k); else localStorage.removeItem(GEMINI_KEY_LS); } catch (e) {} };
  // 모델명은 구글 쪽에서 계속 갱신되므로, 배포 전 https://ai.google.dev/gemini-api/docs/models
  // 에서 현재 무료 티어로 제공되는 최신 flash 계열 모델명을 확인하고 아래 값을 맞출 것.
  var GEMINI_MODEL = 'gemini-2.5-flash';
  function geminiUrl() {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + getGeminiKey();
  }

  // Claude 키 — itp-builder.html과 동일한 localStorage 키를 그대로 재사용한다.
  // ITP Builder에서 이미 키를 등록해둔 사용자는 AI 비서에서도 별도 입력 없이 바로 쓸 수 있다.
  var CLAUDE_KEY_LS = 'sjp_claude_api_key';
  var getClaudeKey = function () { try { return localStorage.getItem(CLAUDE_KEY_LS) || ''; } catch (e) { return ''; } };
  var setClaudeKey = function (k) { try { if (k) localStorage.setItem(CLAUDE_KEY_LS, k); else localStorage.removeItem(CLAUDE_KEY_LS); } catch (e) {} };
  var CLAUDE_MODEL = 'claude-sonnet-4-20250514';

  var PROVIDER_LS = 'sjp_ai_provider';
  function getProvider() {
    try {
      var p = localStorage.getItem(PROVIDER_LS);
      if (p === 'gemini' || p === 'claude') return p;
    } catch (e) {}
    return getClaudeKey() ? 'claude' : 'gemini';
  }
  function setProvider(p) { try { localStorage.setItem(PROVIDER_LS, p); } catch (e) {} }
  function getActiveKey() { return getProvider() === 'claude' ? getClaudeKey() : getGeminiKey(); }

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

  async function callGeminiOnce(h) {
    if (!getGeminiKey()) {
      throw new Error('아직 Gemini API 키가 설정되지 않았습니다 — 우측 상단 🔑 버튼을 눌러 키를 입력해주세요.');
    }
    var res = await fetch(geminiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: geminiContentsFromHistory(h),
        tools: buildGeminiTools()
      })
    });
    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw new Error('Gemini 호출 실패 (' + res.status + '): ' + errText.slice(0, 300));
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

  async function callClaudeOnce(h) {
    var key = getClaudeKey();
    if (!key) {
      throw new Error('아직 Claude API 키가 설정되지 않았습니다 — 우측 상단 🔑 버튼을 눌러 키를 입력해주세요.');
    }
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_INSTRUCTION,
        messages: claudeMessagesFromHistory(h),
        tools: buildClaudeTools()
      })
    });
    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw new Error('Claude 호출 실패 (' + res.status + '): ' + errText.slice(0, 300));
    }
    var data = await res.json();
    var blocks = data.content || [];
    var toolUse = blocks.find(function (b) { return b.type === 'tool_use'; });
    if (toolUse) return { type: 'function_call', name: toolUse.name, args: toolUse.input || {}, callId: toolUse.id };
    var text = blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim() || '(응답 없음)';
    return { type: 'text', text: text };
  }

  function callProviderOnce(h) {
    return getProvider() === 'claude' ? callClaudeOnce(h) : callGeminiOnce(h);
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

  async function runConversation(userText) {
    history.push({ role: 'user', text: userText });
    for (var i = 0; i < 5; i++) {
      var result = await callProviderOnce(history);
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
    var provider = getProvider();
    openModal('🔑 AI 비서 설정', '' +
      '<div class="fg">' +
      '<label class="fl">사용할 AI</label>' +
      '<select class="fi" id="aiProviderInput">' +
      '<option value="gemini"' + (provider === 'gemini' ? ' selected' : '') + '>Gemini (무료 티어)</option>' +
      '<option value="claude"' + (provider === 'claude' ? ' selected' : '') + '>Claude</option>' +
      '</select>' +
      '</div>' +
      '<div class="fg">' +
      '<label class="fl">Gemini API 키 (aistudio.google.com/apikey 에서 무료 발급)</label>' +
      '<input class="fi" id="aiGeminiKeyInput" placeholder="AIza..." value="' + getGeminiKey() + '">' +
      '</div>' +
      '<div class="fg">' +
      '<label class="fl">Claude API 키 (console.anthropic.com 에서 발급 — ITP Builder와 공용)</label>' +
      '<input class="fi" id="aiClaudeKeyInput" placeholder="sk-ant-..." value="' + getClaudeKey() + '">' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-lighter);line-height:1.6;">키는 각각 이 브라우저의 localStorage에만 저장되고, 선택한 AI 쪽 서버로만 직접 전송됩니다 — 저장소(git)나 세종플랫폼 서버로는 전송/저장되지 않습니다. 필드를 비운 채 저장하면 해당 키가 삭제됩니다.</div>',
      function () {
        var newProvider = $id('aiProviderInput').value;
        setGeminiKey($id('aiGeminiKeyInput').value.trim());
        setClaudeKey($id('aiClaudeKeyInput').value.trim());
        if (newProvider !== getProvider()) history = [];
        setProvider(newProvider);
        closeModal();
        appendMsg('system', '✓ 설정이 저장되었습니다. (현재: ' + (newProvider === 'claude' ? 'Claude' : 'Gemini') + ')');
      }
    );
  };

  var keyHintShown = false;
  window.toggleAiPanel = function () {
    $id('aiPanel').classList.toggle('open');
    if ($id('aiPanel').classList.contains('open') && !getActiveKey() && !keyHintShown) {
      keyHintShown = true;
      appendMsg('system', '아직 API 키가 없습니다 — 우측 상단 🔑 버튼을 눌러 Gemini(무료) 또는 Claude API 키를 등록해주세요.');
    }
  };

  window.sendAiMessage = async function () {
    var input = $id('aiInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMsg('user', text);
    appendMsg('system', '생각 중...');
    var thinkingEl = $id('aiMessages').lastChild;
    try {
      var reply = await runConversation(text);
      thinkingEl.remove();
      appendMsg('assistant', reply);
    } catch (e) {
      thinkingEl.remove();
      appendMsg('system', '오류: ' + (e.message || e));
    }
  };
})();

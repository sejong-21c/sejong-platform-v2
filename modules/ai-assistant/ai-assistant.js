/*
 * AI 비서 — 세종플랫폼 전체 조회/등록을 대화로 처리
 *
 * v29.38: 무료 API 게이트웨이 — 키가 있는 회사를 순서대로 자동 시도하고,
 * 한도 초과(429)·키 오류·서버 오류·시간 초과면 다음 회사로 넘어간다.
 * v29.39: 회사당 키 여러 개(여러 계정) 등록 + 키 자동 교대. Cerebras·Mistral 추가.
 * v29.41: 회사 게이트웨이(Cloudflare Worker, gateway/ 폴더) 연동 — 설정되면 서버에 보관된
 * 회사 공용 키를 먼저 쓰고(개인 키 불필요), 실패 시 개인 키로 폴백. NVIDIA는 게이트웨이 전용.
 * v29.45: 로컬 LLM(LM Studio / Ollama) 연동 — 이 컴퓨터 주소가 설정되면 0순위로 먼저 시도,
 * 꺼져 있거나 실패하면 자동으로 무료 API 체인으로 폴백. 주소는 기기별 localStorage 저장.
 * 우선순위: 로컬 LLM → Gemini → Groq → Cerebras → NVIDIA → OpenRouter → Mistral → Claude(유료).
 * Groq/Cerebras/NVIDIA/OpenRouter/Mistral은 OpenAI 호환 형식(tool_calls)이라 함수호출(조회/등록)도 그대로 동작.
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

  // v29.41: 회사 게이트웨이(Cloudflare Worker) 주소 — 설정되면 서버 보관 공용 키를 우선 사용.
  // 워커 배포 후 DEFAULT_GATEWAY_URL에 주소를 넣으면 전 직원이 아무 설정 없이 적용된다.
  var GATEWAY_URL_LS = 'sjp_ai_gateway_url';
  // 2026-07-19 배포 완료된 회사 워커(키는 Cloudflare에 Secret으로 보관, cwkim 계정 관리)
  var DEFAULT_GATEWAY_URL = 'https://sejong-ai-gateway.cwkim-65d.workers.dev';
  function getGatewayUrl() {
    var u = (lsGet(GATEWAY_URL_LS) || DEFAULT_GATEWAY_URL).trim();
    return u ? u.replace(/\/+$/, '') : '';
  }

  // v29.45: 로컬 LLM(LM Studio / Ollama) — 이 컴퓨터에서 돌리는 모델. 설정되면 0순위(무료·무제한·사내보안).
  //   HTTPS 페이지에서 http://localhost 호출은 브라우저가 예외 허용(localhost는 신뢰 출처).
  //   단, LM Studio는 "Enable CORS", Ollama는 OLLAMA_ORIGINS 설정이 있어야 브라우저가 접근 가능.
  //   주소·모델은 이 컴퓨터 localStorage에만 저장 → 설정한 기기에서만 로컬 모델이 쓰인다.
  var LOCAL_URL_LS = 'sjp_ai_local_url';       // 예: http://localhost:1234/v1  (LM Studio) / http://localhost:11434/v1 (Ollama) / https://... (9Router)
  var LOCAL_KEY_LS = 'sjp_ai_local_key';       // 9Router 등 인증이 필요한 로컬/터널 프록시 API 키
  var LOCAL_MODEL_LS = 'sjp_ai_local_model';   // 비우면 서버에 로드된 모델을 자동 감지
  function getLocalUrl() { var u = lsGet(LOCAL_URL_LS).trim(); return u ? u.replace(/\/+$/, '') : ''; }
  function getLocalKey() { var k = lsGet(LOCAL_KEY_LS).trim(); return k || '9router'; }
  function getLocalModel() { return lsGet(LOCAL_MODEL_LS).trim(); }
  var _localModelCache = '';
  async function resolveLocalModel(base, signal, key) {
    var explicit = getLocalModel();
    if (explicit) return explicit;
    if (_localModelCache) return _localModelCache;
    try {
      var headers = key ? { 'Authorization': 'Bearer ' + key } : {};
      var res = await fetch(base + '/models', { headers: headers, signal: signal });
      if (res.ok) { var d = await res.json(); var first = ((d.data || [])[0] || {}).id; if (first) { _localModelCache = first; return first; } }
    } catch (e) {}
    return 'local-model';
  }

  // 모델명은 각 회사에서 계속 갱신되므로 배열 앞에서부터 시도하고,
  // 없어진 모델(404/400)이면 자동으로 다음 모델을 시도한다.
  // Gemini 최신 모델 확인: https://ai.google.dev/gemini-api/docs/models
  var CLAUDE_MODEL = 'claude-sonnet-4-20250514';
  var PROVIDER_CHAIN = [
    // v29.45: 로컬 LLM — 이 컴퓨터에서 돌리면 0순위. 주소가 있는 기기에서만 활성(localStorage 저장).
    //   게이트웨이/키 목록을 쓰지 않고 로컬 주소로 직접 호출한다(localOnly). 모델은 tryProvider에서 결정.
    { id: 'local', label: '로컬 LLM', ls: null, localOnly: true,
      note: '로컬 LLM — 이 컴퓨터의 LM Studio / Ollama (무료·무제한)',
      models: [] },
    // v: 9Router Proxy — combo 키 하나로 여러 AI 모델을 자동 전환. 게이트웨이 전용(키는 Worker Secret에 보관).
    //   브라우저 → 게이트웨이 → 9Router Proxy → 각 AI 공급사. 모델명은 9Router가 관리하므로 '9router-auto' 고정.
    { id: '9router', label: '9Router', ls: null, gatewayOnly: true,
      note: '9Router combo 키 — 게이트웨이 경유, 자동 모델 라우팅',
      models: ['cc/claude-opus-4-7'] },
    { id: 'gemini', label: 'Gemini', ls: GEMINI_KEY_LS, signup: 'https://aistudio.google.com/apikey',
      note: 'Gemini — 키 1개당 하루 1,500회',
      models: ['gemini-flash-latest', 'gemini-2.5-flash'] },
    { id: 'groq', label: 'Groq', ls: GROQ_KEY_LS, signup: 'https://console.groq.com/keys',
      note: 'Groq — 키 1개당 하루 1,000회',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
    { id: 'cerebras', label: 'Cerebras', ls: CEREBRAS_KEY_LS, signup: 'https://cloud.cerebras.ai',
      note: 'Cerebras — 키 1개당 하루 100만 토큰 (분당 5회)',
      models: ['gpt-oss-120b', 'zai-glm-4.7'] },
    // NVIDIA는 브라우저 직접 호출이 차단(CORS)돼 회사 게이트웨이를 통해서만 동작 — 키 입력칸 없음
    { id: 'nvidia', label: 'NVIDIA', ls: null, gatewayOnly: true,
      note: 'NVIDIA — 회사 게이트웨이 전용 (분당 40회)',
      models: ['meta/llama-3.3-70b-instruct', 'meta/llama-3.1-70b-instruct'] },
    { id: 'openrouter', label: 'OpenRouter', ls: OPENROUTER_KEY_LS, signup: 'https://openrouter.ai/settings/keys',
      note: 'OpenRouter — 키 1개당 하루 50회',
      // 무료 모델 목록은 자주 바뀜 — 2026-07-19 openrouter.ai/api/v1/models 실측 기준 갱신
      models: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'openai/gpt-oss-20b:free'] },
    { id: 'mistral', label: 'Mistral', ls: MISTRAL_KEY_LS, signup: 'https://console.mistral.ai/api-keys',
      note: 'Mistral — 월 10억 토큰, 분당 2회 (선택)',
      models: ['mistral-small-latest', 'mistral-large-latest'] },
    { id: 'claude', label: 'Claude', ls: CLAUDE_KEY_LS, signup: 'https://console.anthropic.com',
      note: 'Claude — 유료 (ITP Builder와 공용, 선택)',
      models: [CLAUDE_MODEL] }
  ];
  // v29.39: 한 회사에 키 여러 개(여러 계정) 등록 가능 — 줄바꿈·쉼표·공백으로 구분
  function keysOf(p) { return p.ls ? lsGet(p.ls).split(/[\s,;]+/).filter(Boolean) : []; }
  // 게이트웨이 주소·로컬 LLM 주소가 있으면 개인 키가 없어도 사용 가능
  function hasAnyKey() { return !!getGatewayUrl() || !!getLocalUrl() || PROVIDER_CHAIN.some(function (p) { return keysOf(p).length; }); }
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

  // v29.40: 조회 결과 속 사용자 ID(Firebase UID, pu_... 등)를 사람 이름으로 치환해서 모델에 넘긴다.
  // — PM/구성원이 "RWqHYJnIdm..." 같은 코드 그대로 답변에 나오던 문제 수정.
  function userNameMap() {
    var m = {};
    (state.users || []).forEach(function (u) { if (u && u.id && u.name) m[u.id] = u.name; });
    return m;
  }
  function resolveUserIds(v, map, depth) {
    if (depth > 12) return v;
    if (typeof v === 'string') return map[v] || v;
    if (Array.isArray(v)) return v.map(function (x) { return resolveUserIds(x, map, depth + 1); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = resolveUserIds(v[k], map, depth + 1); });
      return o;
    }
    return v;
  }

  function queryState(collection) {
    var map = userNameMap();
    if (collection === 'wbsData') return resolveUserIds(state.wbs || {}, map, 0);
    if (QUERYABLE.indexOf(collection) === -1) {
      return { error: '"' + collection + '"은(는) 조회할 수 없습니다. 사용 가능: ' + QUERYABLE.join(', ') + ', wbsData' };
    }
    var data = state[collection] || [];
    var out = Array.isArray(data) && data.length > 200
      ? { truncated: true, totalCount: data.length, sample: data.slice(0, 200) }
      : data;
    // users 컬렉션은 이미 이름이 들어있고 id 필드를 이름으로 덮으면 오히려 혼란 — 치환 제외
    if (collection !== 'users') out = resolveUserIds(out, map, 0);
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
    '답변에 내부 ID(무작위 영숫자 코드, 예: RWqHYJ..., pu_17831...)를 절대 그대로 쓰지 마라. 조회 데이터에는 담당자가 이름으로 변환돼 있다 — 혹시 변환 안 된 ID가 남아 있으면 그 값은 빼고 "(미확인 사용자)"라고 표기해라.',
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

  // key가 null이면 회사 게이트웨이 호출(인증 헤더 없이 — 키는 서버가 붙임), base는 게이트웨이 주소
  async function callGeminiOnce(key, model, h, signal, base) {
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-goog-api-key'] = key;
    var res = await fetch((base || 'https://generativelanguage.googleapis.com/v1beta') + '/models/' + model + ':generateContent', {
      method: 'POST',
      signal: signal,
      headers: headers,
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

  async function callClaudeOnce(key, model, h, signal, base) {
    var headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (key) { headers['x-api-key'] = key; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
    var res = await fetch((base || 'https://api.anthropic.com/v1') + '/messages', {
      method: 'POST',
      signal: signal,
      headers: headers,
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
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { 'Authorization': 'Bearer ' + key } : {}, extraHeaders || {}),
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

  async function gatewayAuthHeaders() {
    if (!window.fb || !fb.auth || !fb.auth.currentUser) throw new Error('회사 로그인 후 9Router를 사용할 수 있습니다');
    return { Authorization: 'Bearer ' + await fb.auth.currentUser.getIdToken() };
  }

  async function callOneModel(p, key, model, h, signal) {
    // key === null 이면 회사 게이트웨이 경유. 9Router는 로그인 토큰까지 붙여 Worker가 직원 계정만 확인한다.
    var gw = key === null ? getGatewayUrl() + '/v1/' + p.id : null;
    var gatewayHeaders = key === null ? await gatewayAuthHeaders() : null;
    if (p.id === 'gemini') return callGeminiOnce(key, model, h, signal, gw, gatewayHeaders);
    if (p.id === 'claude') return callClaudeOnce(key, model, h, signal, gw, gatewayHeaders);
    if (p.id === '9router') return callOpenAiCompatOnce('9Router', gw + '/chat/completions', key, model, h, signal, gatewayHeaders);
    if (p.id === 'groq') return callOpenAiCompatOnce('Groq', (gw || 'https://api.groq.com/openai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders);
    if (p.id === 'cerebras') return callOpenAiCompatOnce('Cerebras', (gw || 'https://api.cerebras.ai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders);
    if (p.id === 'nvidia') return callOpenAiCompatOnce('NVIDIA', (gw || 'https://integrate.api.nvidia.com/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders);
    if (p.id === 'mistral') return callOpenAiCompatOnce('Mistral', (gw || 'https://api.mistral.ai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders);
    return callOpenAiCompatOnce('OpenRouter', (gw || 'https://openrouter.ai/api/v1') + '/chat/completions', key, model, h, signal, Object.assign({ 'X-Title': 'Sejong Platform' }, gatewayHeaders || {}));
  }

  // 한 회사 안에서: 소스(회사 게이트웨이 → 내 키들)를 교대하고, 소스마다 모델 목록을 시도한다.
  async function tryProvider(p, h) {
    // v29.45: 로컬 LLM은 게이트웨이/키가 아니라 이 컴퓨터 주소로 직접 호출. 첫 응답이 느릴 수 있어 120초.
    if (p.localOnly) {
      var base = getLocalUrl();
      if (!base) throw new Error('로컬 LLM 주소가 없습니다');
      var ctlL = new AbortController();
      var timerL = setTimeout(function () { ctlL.abort(); }, 120000);
      try {
        var keyL = getLocalKey();
        var model = await resolveLocalModel(base, ctlL.signal, keyL);
        var rL = await callOpenAiCompatOnce('로컬 LLM', base + '/chat/completions', keyL, model, h, ctlL.signal);
        clearTimeout(timerL);
        return { result: rL, viaGateway: false };
      } catch (e) { clearTimeout(timerL); throw e; }
    }
    var sources = [];                                   // null = 회사 게이트웨이, 문자열 = 내 키
    if (getGatewayUrl()) sources.push(null);
    if (!p.gatewayOnly) keysOf(p).forEach(function (k) { sources.push(k); });
    var start = getCursor(p.id) % sources.length;
    var lastErr = null;
    for (var si = 0; si < sources.length; si++) {
      var idx = (start + si) % sources.length;
      var src = sources[idx];
      for (var mi = 0; mi < p.models.length; mi++) {
        const ctl = new AbortController();
        const timer = setTimeout(function () { ctl.abort(); }, 45000);
        try {
          var r = await callOneModel(p, src, p.models[mi], h, ctl.signal);
          clearTimeout(timer);
          setCursor(p.id, idx); // 이 소스가 살아있음 — 다음 질문도 여기부터
          return { result: r, viaGateway: src === null };
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
          if (e.status === 400 || e.status === 404) continue;      // 모델 문제(또는 Gemini 불량 키의 400) → 다음 모델
          if (e.status === 429 || e.status === 401 || e.status === 402 || e.status === 403 || e.status === 501) break; // 이 소스 소진/불량/플랜 미설정/게이트웨이 미설정 → 다음 소스
          if (src === null && !e.status && e.name !== 'AbortError') break; // 게이트웨이 연결 실패 → 내 키로 폴백
          throw e; // 서버 오류·시간 초과·직접 연결 실패 → 회사 자체를 포기하고 다음 회사로
        }
      }
      // 이 소스로 모든 모델이 실패 → 다음 소스 시도
    }
    throw lastErr || new Error('사용 가능한 키/모델이 없습니다');
  }

  var lastLocalFail = '';   // v29.45.1: 로컬 LLM이 설정됐지만 실패한 사유 (진단 안내용)

  async function callProviderOnce(h, onStatus) {
    lastLocalFail = '';
    var gw = getGatewayUrl();
    var avail = PROVIDER_CHAIN.filter(function (p) {
      if (p.localOnly) return !!getLocalUrl();          // 로컬 LLM은 이 컴퓨터에 주소가 설정됐을 때만
      return gw ? true : (!p.gatewayOnly && keysOf(p).length);
    });
    if (!avail.length) {
      throw new Error('아직 API 키가 없습니다 — 우측 상단 🔑 버튼을 눌러 무료 API 키를 등록해주세요.');
    }
    var fails = [];
    for (var i = 0; i < avail.length; i++) {
      var p = avail[i];
      if (onStatus) onStatus(p.label + ' 응답 대기 중…');
      try {
        var r = await tryProvider(p, h);
        lastProviderLabel = p.label + (r.viaGateway ? ' · 회사공용' : '');
        return r.result;
      } catch (e) {
        // Gemini는 잘못된 키를 401이 아니라 400("API key not valid")으로 돌려주므로 본문도 확인
        var why = (e.status === 401 || e.status === 403 || /api[ _]?key/i.test(e.message || '')) ? '키 오류'
          : e.status === 429 ? '무료 한도 초과'
          : e.status === 402 ? '해당 계정 무료 플랜 미설정'
          : e.status === 501 ? '게이트웨이에 키 미등록'
          : e.name === 'AbortError' ? '시간 초과(모델 로딩이 오래 걸리는 중일 수 있음)'
          : e.status ? ('오류 ' + e.status) : '연결 실패(CORS 미허용 또는 서버 꺼짐)';
        // 로컬 LLM 실패는 원인을 구체적으로 남겨 진단 안내에 쓴다
        if (p.localOnly) lastLocalFail = why + (e.status ? '' : ' — ' + (e.message || e).toString().slice(0, 120));
        fails.push(p.label + '(' + why + ')');
      }
    }
    throw new Error('모든 AI 호출 실패: ' + fails.join(', ') + ' — 잠시 후 다시 시도하거나 🔑에서 키를 확인해주세요.');
  }
  window.SJP_AI_lastLocalFail = function () { return lastLocalFail; };

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

    var gwHtml = '<div class="fg" style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">' +
      '<label class="fl">🏢 회사 게이트웨이 주소 — 입력하면 <b>개인 키 없이</b> 회사 공용 키로 동작 (설치법: gateway/README.md)</label>' +
      '<input class="fi" id="aiGatewayUrlInput" spellcheck="false" autocomplete="off"' +
      ' placeholder="https://sejong-ai-gateway.____.workers.dev"' +
      ' value="' + lsGet(GATEWAY_URL_LS).replace(/"/g, '&quot;') + '">' +
      '</div>';
    // v29.45: 로컬 LLM (LM Studio / Ollama / 9Router) — 설정한 기기에서만 0순위로 사용. 다른 직원 PC엔 영향 없음.
    var localHtml = '<div class="fg" style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">' +
      '<label class="fl">🖥 내 컴퓨터 LLM / 9Router 터널 — 켜져 있으면 <b>0순위</b>로 이 모델이 먼저 답합니다</label>' +
      '<input class="fi" id="aiLocalUrlInput" spellcheck="false" autocomplete="off" style="margin-bottom:6px;"' +
      ' placeholder="주소 — 9Router: https://your-tunnel/v1  ·  LM Studio: http://localhost:1234/v1"' +
      ' value="' + lsGet(LOCAL_URL_LS).replace(/"/g, '&quot;') + '">' +
      '<input class="fi" id="aiLocalKeyInput" type="password" spellcheck="false" autocomplete="off" style="margin-bottom:6px;"' +
      ' placeholder="API 키 (선택 — 9Router 키가 필요한 경우 입력, 기본값: 9router)"' +
      ' value="' + lsGet(LOCAL_KEY_LS).replace(/"/g, '&quot;') + '">' +
      '<input class="fi" id="aiLocalModelInput" spellcheck="false" autocomplete="off"' +
      ' placeholder="모델 이름 (비워두면 자동 감지 — 예: cc/claude-opus-4-7, qwen3.5)"' +
      ' value="' + lsGet(LOCAL_MODEL_LS).replace(/"/g, '&quot;') + '">' +
      '<div style="font-size:11px;color:var(--text-lighter);margin-top:4px;">9Router 터널 주소(https://...) 및 키를 넣으면 0순위로 9Router를 호출합니다. LM Studio는 Enable CORS가 필요합니다.</div>' +
      '</div>';
    var keyProviders = PROVIDER_CHAIN.filter(function (p) { return p.ls; });
    var fieldsHtml = keyProviders.map(function (p, i) {
      var n = keysOf(p).length;
      return '<div class="fg">' +
        '<label class="fl">' + (i + 1) + '순위 · ' + p.note +
        (n ? ' <b style="color:var(--success);">✓ ' + n + '개 등록됨</b>' : '') +
        ' — <a href="' + p.signup + '" target="_blank" rel="noopener">키 발급 ↗</a></label>' +
        '<textarea class="fi" rows="2" id="aiKeys_' + p.id + '" spellcheck="false" autocomplete="off"' +
        ' placeholder="한 줄에 키 1개 — 여러 개 넣으면 한도 초과 시 자동 교대"' +
        ' style="resize:vertical;font-size:11px;-webkit-text-security:disc;">' +
        lsGet(p.ls).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>' +
        '</div>';
    }).join('');
    openModal('🔑 AI 비서 — API 키 설정', '' +
      localHtml +
      gwHtml +
      '<div style="font-size:12px;color:var(--text-light);margin:10px 0;line-height:1.6;">개인 키 사용 시: 위에서부터 순서대로 자동 사용하고, 한도 초과·오류 시 다음으로 자동 전환됩니다.<br><b>계정을 여러 개 만들어 받은 키는 한 칸에 줄바꿈으로 전부 붙여넣으세요</b> — 키 단위로도 자동 교대되어 무료 한도가 키 수만큼 늘어납니다.</div>' +
      fieldsHtml +
      '<div style="font-size:11px;color:var(--text-lighter);line-height:1.6;">키는 각각 이 브라우저의 localStorage에만 저장되고, 해당 AI 회사 서버로만 직접 전송됩니다 — 저장소(git)나 세종플랫폼 서버로는 전송/저장되지 않습니다. 필드를 비운 채 저장하면 해당 키가 삭제됩니다.</div>',
      function () {
        var gwEl = $id('aiGatewayUrlInput');
        lsSet(GATEWAY_URL_LS, gwEl ? gwEl.value.trim() : '');
        var luEl = $id('aiLocalUrlInput'), lkEl = $id('aiLocalKeyInput'), lmEl = $id('aiLocalModelInput');
        lsSet(LOCAL_URL_LS, luEl ? luEl.value.trim() : '');
        lsSet(LOCAL_KEY_LS, lkEl ? lkEl.value.trim() : '');
        lsSet(LOCAL_MODEL_LS, lmEl ? lmEl.value.trim() : '');
        _localModelCache = '';   // 주소·모델 바뀌었으니 자동 감지 캐시 초기화
        localFailHintShown = false;   // 설정을 바꿨으니 실패 안내를 다시 볼 수 있게
        keyProviders.forEach(function (p) {
          var el = $id('aiKeys_' + p.id);
          lsSet(p.ls, el ? el.value.split(/[\s,;]+/).filter(Boolean).join('\n') : '');
        });
        try { localStorage.removeItem(KEY_CURSOR_LS); } catch (e) {} // 키가 바뀌었으니 교대 위치 초기화
        updateDot();
        window.closeModal();
        appendMsg('system', hasAnyKey()
          ? '✓ 설정 저장 완료 — 질문을 입력해보세요!'
          : '게이트웨이 주소도, API 키도 비어 있습니다. 하나는 있어야 답변할 수 있어요.');
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

  // v29.43: 사용 기록 — 질문 1건당 aiUsage 문서 1개 (관리 탭 'AI 사용량'에서 집계).
  // 실패해도 조용히 무시 — 기록 때문에 채팅이 죽는 일은 없어야 한다.
  function logAiUsage(ok, provider, errMsg) {
    try {
      if (!window.fb || !fb.db || !state || !state.currentUser) return;
      var u = (state.users || []).find(function (x) { return x.id === state.currentUser; });
      var now = new Date();
      var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      fb.setDoc(fb.doc(fb.collection(fb.db, 'aiUsage')), {
        day: day, at: Date.now(),
        uid: state.currentUser, user: (u && u.name) || '(미확인)', dept: (u && u.dept) || '',
        provider: provider || '', ok: !!ok, err: errMsg ? String(errMsg).slice(0, 120) : ''
      }).catch(function () {});
    } catch (e) {}
  }

  var aiBusy = false;
  var localFailHintShown = false;   // v29.45.1: 로컬 LLM 실패 안내는 세션당 1회
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
      logAiUsage(true, lastProviderLabel);
      // v29.45.1: 로컬 LLM을 설정했는데 실패해서 다른 곳으로 넘어갔으면, 원인을 세션당 1회 안내
      if (getLocalUrl() && lastLocalFail && lastProviderLabel.indexOf('로컬') === -1 && !localFailHintShown) {
        localFailHintShown = true;
        appendMsg('system', '🖥 내 컴퓨터 LLM으로 답하지 못해 다른 AI로 넘어갔어요 (' + lastLocalFail + ').\n확인: ① LM Studio에서 모델을 로드(Load)했는지 ② Start Server가 켜졌는지 ③ 서버 설정에서 Enable CORS 체크 ④ 주소가 http://localhost:1234/v1 인지.');
      }
    } catch (e) {
      thinkingEl.remove();
      appendMsg('system', '오류: ' + (e.message || e));
      logAiUsage(false, lastProviderLabel, e.message || e);
    } finally {
      aiBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '전송'; }
    }
  };
})();

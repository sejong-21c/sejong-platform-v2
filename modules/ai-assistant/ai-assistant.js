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
 * v29.49: (로드맵 1단계) 조회 범위 확대 — NCR·CAR·측정기구·회의실처럼 부모 state에 없는
 * 분리 모듈 컬렉션을 Firestore 1회 조회(getDocs)로 읽는다. 상시 구독은 하지 않음(비용).
 * 첨부파일 조각 문서(chunk__*)와 대용량 문자열 필드는 걸러서 토큰 낭비를 막는다.
 * v29.50: (로드맵 2단계) 화면 이동 — open_module 액션. "NCR 열어줘" 같은 요청에
 * 부모의 switchMod(대메뉴)/openTool(부서 도구)을 그대로 호출해 해당 화면으로 이동한다.
 * v29.51: (로드맵 3단계) 대화 기록 유지 — 새로고침해도 대화가 이어진다. 사용자별
 * localStorage 저장(최근 40턴, 조회 결과는 1,000자 절단), 패널 열 때 복원, 새 대화(🧹) 버튼.
 * localStorage는 기록 '저장'에만 쓴다 — 중복 방지 게이트로 쓰지 않음(2026-07-17 교훈).
 * v29.52: (로드맵 4단계) NCR/CAR 발행 연동 — create_ncr/create_car가 부모
 * openModuleWithPrefill()로 모듈을 열면서 ?aiPrefill=<json>을 전달, 모듈 수신 코드가
 * 발행 폼을 열고 값만 채운다. 발행(저장)은 사람이 직접 — AI 직접 저장 금지 원칙 유지.
 * v29.53: (로드맵 5단계) 브리핑 — get_briefing 도구가 내 업무(지연·마감 임박)·이번 주
 * 일정·내가 결재할 항목(전결 포함)·미읽음 알림을 state에서 조립해 반환(서버 호출 없음).
 * 패널 첫 오픈 시 "오늘 브리핑 보기" 추천 버튼 노출.
 * v29.54: (로드맵 6단계) 조회 필터 — query_state에 date_from/date_to·proj·status·
 * text·limit 파라미터. 원본을 통째로 모델에 넘기지 않고 클라이언트에서 걸러 토큰 절약.
 * "이번 분기 OO프로젝트 NCR 현황" 같은 교차 질문이 정확해진다.
 * v29.55: (로드맵 7단계) 문서 출력 — export_result 액션이 직전 query_state 결과를
 * Excel(xlsx-js-style) 또는 PDF(html2canvas+jsPDF, DOM→이미지라 한글 폰트 임베드 불필요)로
 * 다운로드. 라이브러리는 WBS 모듈과 같은 CDN에서 요청 시에만 lazy 로드.
 * v29.56: (로드맵 8단계) 사내 문서 검색(RAG) — search_docs 도구가 게이트웨이
 * /rag/search(Vectorize+Workers AI)를 호출해 등록된 절차서·매뉴얼에서 관련 대목을 찾는다.
 * 🔑 모달에 관리자용 문서 등록 섹션(청크 분할 → /rag/upload). 게이트웨이 v3 필요.
 * v29.57: (로드맵 10단계, 2기) 대화 UI 품질 — 답변 마크다운 렌더링(굵게·표·목록·코드,
 * HTML 이스케이프 후 변환이라 스크립트 주입 불가), 도구 사용 중 상태 표시
 * ("데이터 조회 중…"), 완성된 답변에 복사(📋) 버튼.
 * v29.58: (로드맵 11단계, 2기) 화면 문맥 인식 — 매 요청의 시스템 프롬프트에 현재
 * 사용자(이름·부서)·오늘 날짜(요일)·현재 화면·보고 있는 프로젝트를 자동 첨부.
 * "이 프로젝트 NCR 보여줘", "이번 주 일정" 같은 지시어가 통하게 된다.
 * v29.59: (로드맵 3기 14단계) 조회 사각지대 해소 — messages(메신저 메시지, 채널명 치환),
 * assets(t_devices)·licenses(t_licenses), itpDocs(t_itpBuilderDocs — 도면 조각 dwg_* 제외를
 * 위해 문서 id p~q 범위 쿼리 + 승인상태·아이템만 남긴 슬림 변환), mobileDrafts(임시저장).
 * stripHeavyFields에 배열 40개 상한 추가(ITP rows 같은 대형 배열 토큰 폭탄 방지).
 * v29.60: (로드맵 3기 15단계) 등록 확장 — create_okr(부모 openOkrModal 프리필),
 * create_meeting_reservation(회의 모듈을 aiPrefill로 열어 예약 모달 자동 오픈+채움).
 * 저장·예약 확정은 늘 그렇듯 사람이 버튼을 눌러야 한다.
 * v29.61: (로드맵 3기 16단계) 업무 완료 처리 — complete_task. 유일한 '수정' 액션이라
 * send_message처럼 채팅 안 확인 카드로 처리: 어떤 업무를 완료로 바꾸는지 보여주고
 * 사람이 [완료 처리]를 눌러야 부모 moveTask(id,'done')가 실행된다.
 * v29.62: 운영 잔손질 — Claude 직접 경로 max_tokens 1024→4096(긴 브리핑 잘림 방지),
 * 5회 도구 루프 한계 도달을 aiUsage에 loopLimit로 기록(에이전트 모드 필요성 판단 데이터).
 * v29.63: 🔑 관리자 도구 버튼 — 능동 알림(/cron/run)·백업(/backup/run)을 브라우저 콘솔
 * 없이 클릭 한 번으로 즉시 실행 (게이트웨이가 관리자 계정인지 검증).
 * v29.64: 전면 점검(PLATFORM-CHECKUP.md) A묶음 수정 — ① 원격 조회 40건 잘림 회귀(A8)
 * ② exportPdf 제목·컬럼 XSS(A9) ③ open_module 죽은 권한 체크(A10) ④ 죽은 9Router 터널
 * 5분 쿨다운+5초 프리플라이트(A1) ⑤ Gemini 불량 키 400 분류(A7) ⑥ 스트리밍 중 45초
 * 강제 중단 완화(A12) ⑦ 날짜 필터 폴백 오탐(A13) ⑧ 루프 한계 시 history 짝 맞춤(A14).
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
  // v29.48: 전 직원 공용 로컬 LLM/9Router 설정 — 부장님이 한 번 공유하면(Firestore
  // t_aiSharedConfig/config) 모든 직원이 각자 입력 없이 자동 사용. 기기별 localStorage
  // 값이 있으면 그게 우선(개인 재정의), 없으면 공용값 사용.
  var sharedLocal = null;
  function loadSharedAiCfg() {
    if (!window.fb || !fb.db || !fb.getDoc || !fb.auth || !fb.auth.currentUser) { setTimeout(loadSharedAiCfg, 1200); return; }
    fb.getDoc(fb.doc(fb.db, 't_aiSharedConfig', 'config')).then(function (snap) {
      if (snap && snap.exists()) { var d = snap.data(); if (d && d.localUrl) sharedLocal = d; }
    }).catch(function () {});
  }
  loadSharedAiCfg();
  function getLocalUrl() {
    var u = lsGet(LOCAL_URL_LS).trim();
    if (u) return u.replace(/\/+$/, '');
    var sv = (sharedLocal && sharedLocal.localUrl) ? String(sharedLocal.localUrl).trim() : '';
    return sv ? sv.replace(/\/+$/, '') : '';
  }
  function getLocalKey() {
    var k = lsGet(LOCAL_KEY_LS).trim();
    if (k) return k;
    if (sharedLocal && sharedLocal.localKey) return sharedLocal.localKey;
    return '9router';
  }
  function getLocalModel() {
    var m = lsGet(LOCAL_MODEL_LS).trim();
    if (m) return m;
    return (sharedLocal && sharedLocal.localModel) || '';
  }
  var _localModelCache = '';
  async function resolveLocalModel(base, signal, key) {
    var explicit = getLocalModel();
    var headers = key ? { 'Authorization': 'Bearer ' + key } : {};
    var modelsList = [];
    try {
      var res = await fetch(base + '/models', { headers: headers, signal: signal });
      if (res.ok) {
        var d = await res.json();
        modelsList = (d.data || []).map(function (m) { return typeof m === 'string' ? m : (m.id || ''); }).filter(Boolean);
        if (modelsList.length) _localModelCache = modelsList[0];
      }
    } catch (e) {}

    if (explicit) {
      if (!modelsList.length) return explicit;
      if (modelsList.indexOf(explicit) !== -1) return explicit;
      var normExp = explicit.toLowerCase().replace(/[-_ ]/g, '');
      var foundNorm = modelsList.find(function (m) { return m.toLowerCase().replace(/[-_ ]/g, '') === normExp; });
      if (foundNorm) return foundNorm;
      var foundSub = modelsList.find(function (m) { return m.toLowerCase().indexOf(normExp) !== -1 || normExp.indexOf(m.toLowerCase()) !== -1; });
      if (foundSub) return foundSub;
      return explicit;
    }
    if (_localModelCache) return _localModelCache;
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
      // v29.64(A7): gemini-2.5-flash는 v1beta에서 404(은퇴) — 제거. -latest 별칭이 현행을 추적
      models: ['gemini-flash-latest'] },
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
  // 더 이상 openNewNCR() 같은 부모 함수가 없다.
  // v29.52(로드맵 4단계): 부모 openModuleWithPrefill()이 모듈을 iframe으로 열면서
  // ?aiPrefill=<json>을 넘기고, 모듈 안 수신 코드가 발행 폼을 열고 값만 채운다. 저장은 사람이.

  registerAction('create_ncr', {
    description: 'NCR(부적합보고서) 발행 — NCR 관리 모듈을 열고 발행 폼에 값을 미리 채운다 (발행 권한은 품질관리부, 저장은 사용자가 직접)',
    params: {
      proj: '프로젝트명/코드', item: '대상 장비/부위 (예: T-8405 N-9 노즐)', desc: '부적합 내용(필수)',
      grade: '중대 또는 일반 또는 경미', client: '고객사(선택)', location: '발생장소(선택)',
      cause: '불량원인(선택)', disposition: '처리방안(선택)', issuedAt: '발행일 YYYY-MM-DD(선택)'
    },
    fill: function (v) {
      if (typeof window.openModuleWithPrefill !== 'function') return { error: '이 화면 버전에서는 지원되지 않습니다 — 새로고침 후 다시 시도해주세요.' };
      window.openModuleWithPrefill('ncr', v);
      return { status: 'NCR 관리 모듈을 열고 발행 폼에 값을 채워두었습니다. 사용자가 내용을 확인하고 저장 버튼을 직접 눌러야 발행됩니다.' };
    }
  });

  registerAction('create_car', {
    description: 'CAR(시정조치요구서) 발행 — CAR 관리 모듈을 열고 발행 폼에 값을 미리 채운다 (발행 권한은 품질관리부, 저장은 사용자가 직접)',
    params: {
      reqContent: '시정조치 요구내용(필수)', causeDetail: '발생원인(선택)', qualReq: '품질요건(선택)',
      field: '발생분야(선택)', cause: '원인 구분(선택)', reqDept: '시정조치요구부서 — 부서명, 여러 개면 쉼표 구분(선택)',
      replyDue: '회신기한 YYYY-MM-DD(선택)', issuedAt: '발행일 YYYY-MM-DD(선택)'
    },
    fill: function (v) {
      if (typeof window.openModuleWithPrefill !== 'function') return { error: '이 화면 버전에서는 지원되지 않습니다 — 새로고침 후 다시 시도해주세요.' };
      window.openModuleWithPrefill('car', v);
      return { status: 'CAR 관리 모듈을 열고 발행 폼에 값을 채워두었습니다. 사용자가 내용을 확인하고 저장 버튼을 직접 눌러야 발행됩니다.' };
    }
  });

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

  // v29.60(로드맵 15단계): 목표(OKR) 등록 — 부모 openOkrModal을 열고 값만 채운다
  registerAction('create_okr', {
    description: '목표(OKR) 등록',
    params: {
      title: '목표 제목', why: '왜 이 목표인지 (선택)',
      period: "기간 표기 — 예: '2026 Q3', '2026 연간' (선택)",
      end: '마감일 YYYY-MM-DD (선택)', scope: 'personal(개인, 기본) 또는 dept(부서)'
    },
    fill: function (v) {
      if (typeof openOkrModal !== 'function') return { error: '이 화면에서는 목표 등록을 열 수 없습니다.' };
      openOkrModal(null, v.scope === 'dept' ? 'dept' : 'personal');
      setTimeout(function () {
        setValue($id('okrTitle'), v.title);
        setValue($id('okrWhy'), v.why);
        setValue($id('okrPeriod'), v.period);
        setValue($id('okrEnd'), v.end);
      }, 0);
    }
  });

  // v29.60(로드맵 15단계): 회의실 예약 — 회의 모듈(iframe)을 aiPrefill로 열어
  // 예약 등록 모달을 자동으로 띄우고 값만 채운다. 예약 확정은 사람이 "예약하기" 버튼.
  registerAction('create_meeting_reservation', {
    description: '회의실 예약 등록 — 회의 모듈을 열고 예약 폼을 미리 채운다',
    params: {
      title: '회의 제목', room: '회의실 이름 — 대회의실, 소회의실, 접객실, 구동부 슈퍼바이저룸, 3공장 중 하나',
      date: '날짜 YYYY-MM-DD', start: '시작 시간 HH:MM (08:00~19:00, 30분 단위)',
      end: '종료 시간 HH:MM (선택, 기본 1시간)', note: '목적/비고 (선택)'
    },
    fill: function (v) {
      if (typeof openModuleWithPrefill !== 'function') return { error: '이 화면에서는 회의실 예약을 열 수 없습니다.' };
      var ok = openModuleWithPrefill('meeting', { title: v.title, room: v.room, date: v.date, start: v.start, end: v.end, note: v.note });
      if (ok === false) return { error: '회의 화면으로 이동하지 못했습니다(접근 권한 등) — 예약 폼을 열 수 없습니다.' }; // v29.64(A17)
      return { status: '회의실 예약 폼을 열고 값을 채워놨습니다. 예약 확정은 사용자가 "예약하기" 버튼을 눌러야 합니다.' };
    }
  });

  // v29.61(로드맵 16단계): 업무 완료 처리 — 유일한 '수정' 액션. 확인 카드 필수.
  // 부모 moveTask()가 실제 tasks 문서/부서 WBS/브리핑 가상 업무를 유형별로 알아서 저장한다.
  registerAction('complete_task', {
    description: '업무(할 일)를 완료 상태로 변경 — 확인 카드에서 사용자가 [완료 처리]를 눌러야 실제 반영된다',
    params: { title: '완료 처리할 업무 이름 (일부만 입력해도 됨)' },
    direct: true,
    resolve: function (v) {
      var t = String(v.title || '').toLowerCase().trim();
      if (!t) return { error: '어떤 업무인지 이름을 알려주세요.' };
      var pool = (typeof allKanbanTasks === 'function' ? allKanbanTasks() : (state.tasks || []))
        .filter(function (x) { return x.status !== 'done'; });
      var hits = pool.filter(function (x) { return (x.title || '').toLowerCase().indexOf(t) !== -1; });
      if (!hits.length) return { error: '"' + v.title + '" 업무를 찾지 못했습니다 (완료되지 않은 업무에서 검색).' };
      if (hits.length > 1) {
        return { error: '해당하는 업무가 ' + hits.length + '개입니다. 정확한 이름을 알려주세요: ' + hits.slice(0, 5).map(function (x) { return '"' + x.title + '"'; }).join(', ') + (hits.length > 5 ? ' 외' : '') };
      }
      var x = hits[0];
      var u = (state.users || []).find(function (z) { return z.id === x.assignee; });
      return {
        taskId: x.id,
        cardLines: [
          '업무: ' + (x.title || ''),
          (u ? '담당: ' + u.name + ' · ' : '') + (x.due ? '마감: ' + x.due + ' · ' : '') + '현재 상태: ' + (x.status || ''),
          '→ 완료(done)로 변경합니다'
        ],
        confirmLabel: '완료 처리'
      };
    },
    commit: function (resolved) {
      if (typeof moveTask !== 'function') throw new Error('이 화면에서는 업무 상태를 바꿀 수 없습니다.');
      return moveTask(resolved.taskId, 'done');
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

  // ── 2.4 브리핑 (v29.53, 로드맵 5단계) ─────────────────────────
  // 이미 구독 중인 state에서 조립 — 서버 호출 없음. 결재 판정은 부모의
  // apIsMyTurn/apCanJeonGyeol(v30.10 전결), 알림은 getNotifications()를 그대로 재사용.
  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  registerAction('get_briefing', {
    description: '오늘의 브리핑 — 현재 사용자의 지연/마감 임박 업무, 오늘·이번 주 일정, 내가 결재할 항목, 미읽음 알림을 한 번에 반환. "오늘 뭐 해야 해?", "브리핑 보여줘" 같은 요청에 사용',
    params: {},
    query: true,
    run: function () {
      var uid = state.currentUser;
      var today = localISO(new Date());
      var week = localISO(new Date(Date.now() + 7 * 86400000));
      var myTasks = (state.tasks || []).filter(function (t) { return t.assignee === uid && t.status !== 'done'; });
      var overdue = myTasks.filter(function (t) { return t.due && t.due < today; });
      var dueSoon = myTasks.filter(function (t) { return t.due && t.due >= today && t.due <= week; });
      var events = (state.events || []).filter(function (e) { return e.date && e.date >= today && e.date <= week; })
        .sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
      var approvals = [];
      try {
        approvals = (state.approvals || []).filter(function (a) {
          return (typeof apIsMyTurn === 'function' && apIsMyTurn(a, uid))
              || (typeof apCanJeonGyeol === 'function' && apCanJeonGyeol(a, uid));
        }).map(function (a) { return { title: a.title, type: a.type, author: a.author, createdAt: a.createdAt }; });
      } catch (e) {}
      var notifs = [];
      try { notifs = (typeof getNotifications === 'function' ? getNotifications() : []).slice(0, 8).map(function (n) { return n.title || ''; }); } catch (e) {}
      var pick = function (t) { return { title: t.title, proj: t.proj, due: t.due, priority: t.priority }; };
      return resolveUserIds({
        today: today,
        overdueTasks: overdue.map(pick),
        tasksDueThisWeek: dueSoon.map(pick),
        myOpenTaskCount: myTasks.length,
        eventsThisWeek: events.slice(0, 20).map(function (e) { return { title: e.title, date: e.date, time: e.time || '', dept: e.dept || '' }; }),
        approvalsWaitingForMe: approvals,
        unreadNotifications: notifs
      }, userNameMap(), 0);
    }
  });

  // ── 2.5 화면 이동 (v29.50, 로드맵 2단계) ───────────────────────
  // 부모 index.html의 NAV(switchMod)·TOOLS(openTool)를 그대로 호출한다.
  // names: 사용자가 부를 만한 별칭 — 정규화(소문자·공백 제거) 후 완전일치 우선, 부분일치 보조.
  var MODULE_TARGETS = [
    { nav: 'dashboard',  names: ['대시보드', '홈', '메인', 'dashboard'] },
    { nav: 'calendar',   names: ['캘린더', '일정', '달력', 'calendar'] },
    { nav: 'projects',   names: ['프로젝트', 'wbs', '공정표', '간트'] },
    { nav: 'traveller',  names: ['제작공정관리', '제작공정', '트래블러', 'traveller'] },
    { nav: 'tasks',      names: ['업무관리', '업무', '할일', '할 일', 'task'] },
    { nav: 'messenger',  names: ['메신저', '채팅', '메시지'] },
    { nav: 'meeting',    names: ['회의실', '회의록', '회의'] },
    { nav: 'okr',        names: ['목표', 'okr', '목표관리'] },
    { nav: 'approval',   names: ['결재', '기안', '전자결재'] },
    { nav: 'org',        names: ['조직권한', '조직/권한', '조직'] },
    { nav: 'admin',      names: ['관리자', '관리 탭', '관리'] },
    { tool: 'itpview',   names: ['itp 조회', 'itp조회', 'itp 뷰어'] },
    { tool: 'itp',       names: ['itp builder', 'itp 빌더', 'itp'] },
    { tool: 'qaview',    names: ['qa 조회', 'qa doc 조회', 'qa문서 조회'] },
    { tool: 'qa',        names: ['qa doc generator', 'qa 문서생성', 'qa문서', 'qa'] },
    { tool: 'ncr',       names: ['ncr', '부적합', '부적합보고서'] },
    { tool: 'car',       names: ['car', '시정조치', '시정조치요구서'] },
    { tool: 'qadash',    names: ['품질종합분석표', '품질종합분석', '품질분석'] },
    { tool: 'mobile',    names: ['모바일 점검', '모바일점검', '현장 검사', 'mobile inspection'] },
    { tool: 'mtools',    names: ['측정기구', '측정기구 반입출', '계측기'] },
    { tool: 'asset',     names: ['자산관리', '자산 관리 대장', '자산'] },
    { tool: 'deptsch',   names: ['부서 스케줄', '부서스케줄', '부서 일정'] }
  ];
  function normName(s) { return String(s || '').toLowerCase().replace(/[\s\-_·]/g, ''); }
  function findModuleTarget(text) {
    var t = normName(text);
    if (!t) return null;
    for (var i = 0; i < MODULE_TARGETS.length; i++) {           // 1차: 별칭 완전일치
      if (MODULE_TARGETS[i].names.some(function (n) { return normName(n) === t; })) return MODULE_TARGETS[i];
    }
    for (var j = 0; j < MODULE_TARGETS.length; j++) {           // 2차: 부분일치 (긴 이름을 줄여 말한 경우)
      if (MODULE_TARGETS[j].names.some(function (n) { var nn = normName(n); return nn.indexOf(t) !== -1 || t.indexOf(nn) !== -1; })) return MODULE_TARGETS[j];
    }
    return null;
  }
  function moduleLabel(m) {
    // v29.58 fix: NAV/TOOLS는 const 전역이라 window.NAV가 아니라 bare 접근이어야 잡힌다
    var nav = (typeof NAV !== 'undefined' && NAV) || [];
    var tools = (typeof TOOLS !== 'undefined' && TOOLS) || {};
    if (m.nav) { var n = nav.find(function (x) { return x.id === m.nav; }); return n ? n.label : m.nav; }
    var tl = tools[m.tool]; return tl ? tl.name : m.tool;
  }
  ai.findModuleTarget = findModuleTarget; // 콘솔/테스트에서 매핑 확인용

  registerAction('open_module', {
    description: '플랫폼 화면(모듈) 열기 — 사용자를 해당 화면으로 이동시킨다',
    params: { module: '열 화면 이름. 가능: 대시보드, 캘린더, 프로젝트(WBS), 제작공정관리, 업무관리, 메신저, 회의실·회의록, 목표(OKR), 결재, NCR, CAR, ITP Builder, ITP 조회, QA 문서생성, QA 조회, 품질종합분석표, 모바일 점검, 측정기구, 자산관리, 부서 스케줄' },
    fill: function (v) {
      var m = findModuleTarget(v.module);
      if (!m) {
        return { error: '"' + (v.module || '') + '" 화면을 찾지 못했습니다. 가능한 화면: 대시보드, 캘린더, 프로젝트, 제작공정관리, 업무관리, 메신저, 회의실·회의록, 목표(OKR), 결재, NCR, CAR, ITP Builder/조회, QA 문서생성/조회, 품질종합분석표, 모바일 점검, 측정기구, 자산관리, 부서 스케줄' };
      }
      var label = moduleLabel(m);
      if (m.nav) {
        // v29.64(A10): NAV는 const 전역 — window.NAV는 항상 undefined라 권한 체크가 죽어 있었음
        var navList = (typeof NAV !== 'undefined' && NAV) || [];
        var navItem = navList.find(function (x) { return x.id === m.nav; });
        // switchMod 내부의 권한 alert() 대신 채팅 답변으로 안내
        if (navItem && typeof canSeeNav === 'function' && !canSeeNav(navItem)) {
          return { error: '"' + label + '" 화면은 현재 사용자에게 접근 권한이 없습니다.' };
        }
        switchMod(m.nav);
      } else {
        openTool(m.tool);
      }
      return { status: '"' + label + '" 화면을 열었습니다.' };
    }
  });

  // ── 3. 범용 조회 도구 ───────────────────────────────────────────
  // 데이터 종류별 전용 함수를 계속 늘리는 대신, 컬렉션 하나를 통째로 넘기고 모델이 스스로 요약/판단하게 함.
  var QUERYABLE = ['projects', 'tasks', 'users', 'channels', 'quotes', 'approvals', 'events', 'okrs'];
  // v29.49: approvals/events/okrs/tasks는 v29.11부터 Firestore 동기화됨 — 로컬 한정은 quotes뿐
  var LOCAL_ONLY = ['quotes']; // 이 브라우저에만 저장(전사 공유 아님)

  // v29.49: 분리 모듈 컬렉션 — 부모 state에 없어 질문 시점에 Firestore에서 1회 조회한다.
  // 별칭(모델에 노출) → { coll: 실제 컬렉션명, projOnly: 문서 id p~q 범위 쿼리, slim: 문서 축약 }.
  // 상시 구독(onSnapshot)은 하지 않는다 — AI 질문은 가끔이라 실시간성보다 읽기 비용 절약이 우선.
  // v29.59: itpDocs는 도면 조각 문서(dwg_*, base64 수백KB)가 섞여 있어 projOnly 범위 쿼리로
  // 네트워크에서부터 제외한다 (itp-viewer.html v2.1과 동일 수법).
  var REMOTE_QUERYABLE = {
    ncrs: { coll: 't_ncrs' },                               // 부적합보고서 (modules/ncr)
    cars: { coll: 't_cars' },                               // 시정조치요구서 (modules/car)
    measurementTools: { coll: 'measurementTools' },         // 측정기구 대장
    measurementCheckouts: { coll: 'measurementCheckouts' }, // 측정기구 반출/반납
    meetingReservations: { coll: 'meetingReservations' },   // 회의실 예약
    meetingMinutes: { coll: 'meetingMinutes' },             // 회의록
    assets: { coll: 't_devices' },                          // 자산 기기 대장 (modules/asset-registry)
    licenses: { coll: 't_licenses' },                       // 소프트웨어 라이선스
    itpDocs: { coll: 't_itpBuilderDocs', projOnly: true, slim: slimItpDoc } // ITP/QA 생성 문서 상태
  };
  // ITP 문서는 items[].rows가 수백 줄이라 통째로 넘기면 토큰 폭탄 — 상태 확인에 필요한 것만 남긴다
  function slimItpDoc(d) {
    var items = Array.isArray(d.items) ? d.items : [];
    var p = (state.projects || []).find(function (x) { return x.id === d.id; });
    return {
      id: d.id,
      project: p ? ((p.code ? p.code + ' ' : '') + p.name) : d.id,
      approvalStatus: d.approvalStatus || '(없음)',
      approvedAt: d.approvedAt || null,
      itemCount: items.length,
      items: items.slice(0, 60).map(function (it) {
        return { tag: it.tag || '', name: it.name || it.itemName || '', rowCount: Array.isArray(it.rows) ? it.rows.length : undefined };
      })
    };
  }
  var _remoteCache = {}; // { 별칭: { at, data } } — 한 대화에서 같은 컬렉션 반복 조회 방지
  var REMOTE_CACHE_MS = 60000;

  // t_ncrs/t_cars에는 첨부파일이 chunk__* id의 base64 조각 문서(개당 최대 700KB)로 섞여
  // 저장된다(ncr.html v29.13.4) — 목록 화면들과 동일하게 반드시 걸러낸다.
  // 그 외에도 대용량 문자열 필드(dataUrl, OCR 원문 등)는 모델에 넘겨봐야 토큰만 태우므로 자른다.
  function stripHeavyFields(v, depth) {
    if (depth > 8) return v;
    if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 200) + '…(총 ' + v.length + '자, 생략)' : v;
    if (Array.isArray(v)) {
      // v29.59: 대형 배열 상한 — ITP rows·점검 사진 목록 같은 '중첩' 배열 토큰 폭탄 방지
      // v29.64(A8) fix: 최상위(depth 0) 결과 배열에는 상한을 걸지 않는다 — 조회 200건 상한을
      // 40건으로 잘라먹고 잘림 마커 문자열이 행으로 섞여 엑셀/PDF 출력을 오염시키던 회귀.
      var cap = depth > 0 && v.length > 40;
      var arr = cap ? v.slice(0, 40) : v;
      var out = arr.map(function (x) { return stripHeavyFields(x, depth + 1); });
      if (cap) out.push('…외 ' + (v.length - 40) + '개 항목 생략');
      return out;
    }
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = stripHeavyFields(v[k], depth + 1); });
      return o;
    }
    return v;
  }

  async function fetchRemoteCollection(alias) {
    var cached = _remoteCache[alias];
    if (cached && Date.now() - cached.at < REMOTE_CACHE_MS) return cached.data;
    var def = REMOTE_QUERYABLE[alias];
    // projOnly: 프로젝트 문서 id는 전부 'p'로 시작 — 범위 쿼리로 조각 문서를 네트워크에서 제외
    var src = (def.projOnly && fb.documentId)
      ? fb.query(fb.collection(fb.db, def.coll), fb.where(fb.documentId(), '>=', 'p'), fb.where(fb.documentId(), '<', 'q'))
      : fb.collection(fb.db, def.coll);
    var snap = await fb.getDocs(src);
    var docs = snap.docs
      .filter(function (d) { return d.id.indexOf('chunk__') !== 0 && d.id.indexOf('dwg_') !== 0; })
      .map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    if (def.slim) docs = docs.map(def.slim);
    _remoteCache[alias] = { at: Date.now(), data: docs };
    return docs;
  }

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

  // ── v29.54(로드맵 6단계): 조회 필터 — 걸러서 넘겨야 토큰이 안 샌다 ──
  // 컬렉션별 대표 날짜 필드. 없으면 문서 안의 모든 YYYY-MM-DD 문자열·epoch(ms) 숫자로 판정.
  var DATE_FIELD = {
    tasks: 'due', events: 'date', ncrs: 'issuedAt', cars: 'issuedAt',
    meetingReservations: 'date', meetingMinutes: 'date', measurementCheckouts: 'checkedOutAt'
  };
  function docDates(doc, field) {
    if (field) {
      // v29.64(A13): 대표 날짜 필드가 지정된 컬렉션은 폴백 스캔을 하지 않는다 —
      // 마감일 없는 업무가 createdAt(생성일)으로 기간 필터를 통과하던 오탐 수정
      return (typeof doc[field] === 'string' && doc[field]) ? [doc[field].slice(0, 10)] : [];
    }
    var out = [];
    Object.keys(doc).forEach(function (k) {
      var v = doc[k];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) out.push(v.slice(0, 10));
      else if (typeof v === 'number' && v > 1e12 && v < 2e12) out.push(localISO(new Date(v)));
    });
    return out;
  }
  function applyFilters(docs, collection, opts) {
    if (!Array.isArray(docs) || !opts) return docs;
    var from = (opts.date_from || '').slice(0, 10), to = (opts.date_to || '').slice(0, 10);
    var proj = opts.proj ? String(opts.proj).toLowerCase() : '';
    var projObj = opts.proj ? findProject(opts.proj) : null;
    var status = opts.status ? String(opts.status).toLowerCase() : '';
    var text = opts.text ? String(opts.text).toLowerCase() : '';
    var out = docs.filter(function (d) {
      if (!d || typeof d !== 'object') return true;
      if (from || to) {
        var dates = docDates(d, DATE_FIELD[collection]);
        if (!dates.length) return false;
        if (!dates.some(function (dt) { return (!from || dt >= from) && (!to || dt <= to); })) return false;
      }
      if (proj) {
        var vals = [d.proj, d.projectId, d.pid, d.project].filter(Boolean).map(String);
        var hit = vals.some(function (v) {
          var lv = v.toLowerCase();
          return (projObj && v === projObj.id) || lv.indexOf(proj) !== -1 || proj.indexOf(lv) !== -1;
        });
        if (!hit) return false;
      }
      if (status && String(d.status || '').toLowerCase() !== status) return false;
      if (text) {
        var s = ''; try { s = JSON.stringify(d).toLowerCase(); } catch (e) {}
        if (s.indexOf(text) === -1) return false;
      }
      return true;
    });
    var lim = parseInt(opts.limit, 10);
    if (lim > 0 && out.length > lim) out = out.slice(0, lim);
    return out;
  }

  // v29.55(로드맵 7단계): 직전 조회 결과를 기억해 export_result가 파일로 출력할 수 있게 한다
  var lastQuery = null; // { collection, rows:[...] } — 이름 치환·필터 적용 후의 표 형태 데이터
  function rememberQuery(collection, out) {
    var rows = Array.isArray(out) ? out : (out && (out.data || out.sample));
    // v29.64(A8): 잘림 마커 같은 문자열 원소가 섞여도 표 출력이 오염되지 않게 객체만 남긴다
    if (Array.isArray(rows)) rows = rows.filter(function (r) { return r && typeof r === 'object'; });
    if (Array.isArray(rows) && rows.length && typeof rows[0] === 'object') {
      lastQuery = { collection: collection, rows: rows };
    }
  }

  // v29.49: 분리 모듈 컬렉션 조회가 비동기(getDocs)라 async — 호출부(executeFunctionCall)는 await 중이라 그대로 동작
  async function queryState(collection, opts) {
    var map = userNameMap();
    if (collection === 'wbsData') return resolveUserIds(state.wbs || {}, map, 0);
    if (collection === 'wbsRec') return resolveUserIds(state.wbsRec || {}, map, 0);
    if (REMOTE_QUERYABLE[collection]) {
      var docs;
      try { docs = await fetchRemoteCollection(collection); }
      catch (e) { return { error: '"' + collection + '" 조회 실패: ' + (e.message || e) }; }
      var total = docs.length;
      docs = applyFilters(docs, collection, opts);
      var outR = docs.length > 200
        ? { truncated: true, totalCount: docs.length, sample: docs.slice(0, 200) }
        : (opts && (opts.date_from || opts.date_to || opts.proj || opts.status || opts.text)
            ? { filtered: true, totalBeforeFilter: total, matched: docs.length, data: docs }
            : docs);
      var finalR = resolveUserIds(stripHeavyFields(outR, 0), map, 0);
      rememberQuery(collection, finalR);
      return finalR;
    }
    // v29.59: 메신저 메시지 — 부모가 최근 500개를 이미 구독 중. 채널 id → 채널명 치환해서 제공
    if (collection === 'messages') {
      var chMap = {};
      (state.channels || []).forEach(function (c) { chMap[c.id] = c.name; });
      var msgs = (state.messages || []).map(function (m) {
        return Object.assign({}, m, { channelName: chMap[m.channel] || m.channel });
      });
      var mOut = applyFilters(msgs, 'messages', opts);
      var mFinal = mOut.length > 200
        ? { truncated: true, totalCount: mOut.length, note: '최신 200개만 표시', sample: mOut.slice(-200) }
        : mOut;
      mFinal = resolveUserIds(mFinal, map, 0);
      rememberQuery(collection, mFinal);
      return mFinal;
    }
    // v29.59: 모바일 점검 임시저장 — 사진(base64)이 섞일 수 있어 반드시 무거운 필드 절단
    if (collection === 'mobileDrafts') {
      return resolveUserIds(stripHeavyFields(applyFilters(state.mobileInspectionDrafts || [], collection, opts), 0), map, 0);
    }
    if (QUERYABLE.indexOf(collection) === -1) {
      return { error: '"' + collection + '"은(는) 조회할 수 없습니다. 사용 가능: ' + QUERYABLE.join(', ') + ', wbsData, wbsRec, messages, mobileDrafts, ' + Object.keys(REMOTE_QUERYABLE).join(', ') };
    }
    var data = applyFilters(state[collection] || [], collection, opts);
    var out = Array.isArray(data) && data.length > 200
      ? { truncated: true, totalCount: data.length, sample: data.slice(0, 200) }
      : data;
    // users 컬렉션은 이미 이름이 들어있고 id 필드를 이름으로 덮으면 오히려 혼란 — 치환 제외
    if (collection !== 'users') out = resolveUserIds(out, map, 0);
    rememberQuery(collection, out);
    if (LOCAL_ONLY.indexOf(collection) !== -1) {
      return { note: '이 데이터는 현재 브라우저에만 저장되어 있어 다른 사람 화면과 다를 수 있습니다.', data: out };
    }
    return out;
  }
  ai.queryState = queryState;

  // ── 3.4 사내 문서 검색 RAG (v29.56, 로드맵 8단계) ──────────────
  // 게이트웨이 /rag/search 호출 — 로그인 토큰 필수(사내 계정 확인). 게이트웨이에
  // AI/VECTORIZE 바인딩이 없으면 501이 오고, 그 안내를 모델이 사용자에게 전달한다.
  registerAction('search_docs', {
    description: '사내 문서(품질 매뉴얼·절차서·규정 등) 검색 — 등록된 문서에서 질문과 관련된 대목을 찾아 반환. "용접 검사 기준이 뭐야?" 같은 사내 문서 내용 질문에 사용',
    params: { query: '검색할 질문 또는 키워드' },
    query: true,
    run: async function (v) {
      var gw = getGatewayUrl();
      if (!gw) return { error: '회사 게이트웨이 주소가 설정되지 않아 문서 검색을 사용할 수 없습니다.' };
      var headers = Object.assign({ 'Content-Type': 'application/json' }, await gatewayAuthHeaders());
      var res = await fetch(gw + '/rag/search', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ query: v.query, topK: 5 })
      });
      if (!res.ok) {
        var t = await res.text().catch(function () { return ''; });
        return { error: '문서 검색 실패 (' + res.status + '): ' + t.slice(0, 200) };
      }
      var d = await res.json();
      if (!d.matches || !d.matches.length) return { matches: [], note: '등록된 문서에서 관련 내용을 찾지 못했습니다. 문서가 아직 등록되지 않았을 수 있습니다.' };
      return d;
    }
  });

  // 관리자용 문서 등록 — 긴 텍스트를 ~700자 청크(문단 경계 우선)로 나눠 게이트웨이에 업로드
  function chunkDocText(text) {
    var paras = String(text).split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
    var chunks = [], cur = '';
    paras.forEach(function (p) {
      if ((cur + '\n\n' + p).length > 700 && cur) { chunks.push(cur); cur = p; }
      else cur = cur ? cur + '\n\n' + p : p;
      while (cur.length > 1400) { chunks.push(cur.slice(0, 700)); cur = cur.slice(600); } // 초장문 문단은 100자 겹침 분할
    });
    if (cur) chunks.push(cur);
    return chunks;
  }
  // v29.63: 관리자 도구 — 크론 잡(알림/백업) 즉시 실행. 게이트웨이가 RAG_ADMIN_EMAILS로 재검증한다.
  window.SJP_AI_runCron = async function (kind) {
    var gw = getGatewayUrl();
    if (!gw) { alert('회사 게이트웨이 주소가 설정되지 않았습니다.'); return; }
    var label = kind === 'backup' ? '백업' : '알림';
    try {
      var headers = await gatewayAuthHeaders();
      var res = await fetch(gw + (kind === 'backup' ? '/backup/run' : '/cron/run'), { method: 'POST', headers: headers });
      var d = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(d.error || ('오류 ' + res.status));
      alert('✓ ' + label + ' 실행 완료:\n' + JSON.stringify(d, null, 2)
        + (kind === 'backup' ? '' : '\n\n(d1: 내일 마감 업무 알림 수 · stale: 지연 결재 알림 수 — 메신저의 "🤖 AI 알림" 채널을 확인하세요)'));
    } catch (e) {
      alert(label + ' 실행 실패: ' + (e.message || e));
    }
  };

  window.SJP_AI_uploadDoc = async function () {
    var nameEl = $id('aiDocNameInput'), textEl = $id('aiDocTextInput'), btn = $id('aiDocUploadBtn');
    var docName = nameEl ? nameEl.value.trim() : '';
    var text = textEl ? textEl.value.trim() : '';
    if (!docName || !text) { alert('문서 이름과 내용을 모두 입력하세요.'); return; }
    var gw = getGatewayUrl();
    if (!gw) { alert('회사 게이트웨이 주소가 설정되지 않았습니다.'); return; }
    var chunks = chunkDocText(text);
    if (btn) { btn.disabled = true; btn.textContent = '등록 중… (' + chunks.length + '조각)'; }
    try {
      var headers = Object.assign({ 'Content-Type': 'application/json' }, await gatewayAuthHeaders());
      var res = await fetch(gw + '/rag/upload', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ docName: docName, chunks: chunks })
      });
      var d = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(d.error || ('오류 ' + res.status));
      alert('✓ "' + docName + '" 등록 완료 (' + d.chunkCount + '조각) — 이제 AI 비서에게 내용을 물어볼 수 있습니다.');
      if (textEl) textEl.value = '';
    } catch (e) {
      alert('문서 등록 실패: ' + (e.message || e));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📚 문서 등록'; }
    }
  };

  // ── 3.5 문서 출력 (v29.55, 로드맵 7단계) ───────────────────────
  // WBS 모듈과 같은 CDN·같은 방식: Excel은 xlsx-js-style, PDF는 html2canvas로 표를
  // 이미지로 떠서 jsPDF에 얹는다(한글 폰트 임베드 불필요). 요청 시에만 lazy 로드.
  var _libPromises = {};
  function loadScriptOnce(src) {
    if (!_libPromises[src]) {
      _libPromises[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { resolve(); };
        s.onerror = function () { delete _libPromises[src]; reject(new Error('라이브러리 로드 실패: ' + src)); };
        document.head.appendChild(s);
      });
    }
    return _libPromises[src];
  }
  var XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  var H2C_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  var JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  // 행 배열 → 표: 컬럼은 등장 순서 기준 합집합, 객체/배열 값은 짧은 JSON 문자열로
  function buildTable(rows) {
    var cols = [];
    rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) { if (cols.indexOf(k) === -1) cols.push(k); });
    });
    var body = rows.map(function (r) {
      return cols.map(function (c) {
        var v = r[c];
        if (v === undefined || v === null) return '';
        if (typeof v === 'object') { try { v = JSON.stringify(v); } catch (e) { v = String(v); } }
        v = String(v);
        return v.length > 300 ? v.slice(0, 300) + '…' : v;
      });
    });
    return { cols: cols, body: body };
  }
  function exportFileName(title, collection) {
    var day = localISO(new Date());
    return (title || ('세종플랫폼_' + collection)) + '_' + day;
  }
  async function exportExcel(title) {
    await loadScriptOnce(XLSX_CDN);
    var t = buildTable(lastQuery.rows);
    var aoa = [t.cols].concat(t.body);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = t.cols.map(function (c, i) {
      var w = c.length;
      t.body.forEach(function (row) { var l = String(row[i] || '').length; if (l > w) w = l; });
      return { wch: Math.min(Math.max(w + 2, 8), 60) };
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '조회결과');
    XLSX.writeFile(wb, exportFileName(title, lastQuery.collection) + '.xlsx');
  }
  async function exportPdf(title) {
    await loadScriptOnce(H2C_CDN);
    await loadScriptOnce(JSPDF_CDN);
    var t = buildTable(lastQuery.rows);
    var el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-10000px;top:0;width:1100px;background:#fff;padding:24px;font-family:sans-serif;';
    // v29.64(A9): 제목·컬럼명도 반드시 이스케이프 — 모델 인자/문서 필드 키 경유 DOM XSS 차단
    var th = t.cols.map(function (c) { return '<th style="border:1px solid #999;padding:4px 6px;background:#eef;font-size:11px;">' + escHtml(c) + '</th>'; }).join('');
    var trs = t.body.map(function (row) {
      return '<tr>' + row.map(function (v) { return '<td style="border:1px solid #bbb;padding:3px 6px;font-size:10px;word-break:break-all;">' + escHtml(String(v)) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el.innerHTML = '<h3 style="margin:0 0 10px;font-size:15px;">' + escHtml(title || '세종플랫폼 조회결과 — ' + lastQuery.collection) + ' (' + localISO(new Date()) + ')</h3>'
      + '<table style="border-collapse:collapse;width:100%;"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table>';
    document.body.appendChild(el);
    try {
      var canvas = await html2canvas(el, { scale: 2 });
      var pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      var imgH = canvas.height * pw / canvas.width; // 폭 맞춤 시 전체 이미지 높이(mm)
      var y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, -y, pw, imgH);
        y += ph;
      }
      pdf.save(exportFileName(title, lastQuery.collection) + '.pdf');
    } finally { el.remove(); }
  }

  registerAction('export_result', {
    description: '직전 query_state 조회 결과를 Excel 또는 PDF 파일로 다운로드. "엑셀로 뽑아줘", "PDF로 저장해줘" 요청에 사용 — 반드시 먼저 query_state로 조회한 뒤 호출',
    params: { format: 'excel 또는 pdf', title: '파일 제목 (선택)' },
    fill: function (v) {
      if (!lastQuery || !lastQuery.rows || !lastQuery.rows.length) {
        return { error: '출력할 조회 결과가 없습니다 — 먼저 query_state로 데이터를 조회해주세요.' };
      }
      var fmt = String(v.format || '').toLowerCase().indexOf('pdf') !== -1 ? 'pdf' : 'excel';
      var n = lastQuery.rows.length;
      (fmt === 'pdf' ? exportPdf(v.title) : exportExcel(v.title))
        .then(function () { appendMsg('system', '✓ ' + (fmt === 'pdf' ? 'PDF' : 'Excel') + ' 다운로드 완료 (' + n + '건)'); })
        .catch(function (e) { appendMsg('system', '파일 생성 실패: ' + (e.message || e)); });
      return { status: (fmt === 'pdf' ? 'PDF' : 'Excel') + ' 파일 생성을 시작했습니다 (' + n + '건) — 잠시 후 다운로드됩니다.' };
    }
  });

  // ── 4. 모델(Gemini/Claude) 공용 function-calling 루프 ────────────
  var QUERY_STATE_DESC = '세종플랫폼 데이터 조회. 기간·프로젝트·상태 조건이 있는 질문은 필터 파라미터를 함께 넘겨라(전체를 받아서 직접 거르지 말 것). collection에는 다음 중 하나만: '
    + 'projects(프로젝트), tasks(업무), users(직원), channels(메신저 채널), messages(메신저 메시지 최근 500개), '
    + 'quotes(견적), approvals(기안/결재), events(일정), okrs(목표), wbsData(WBS 공정표), wbsRec(제작공정 검사실적), '
    + 'ncrs(부적합보고서 NCR), cars(시정조치요구서 CAR), measurementTools(측정기구 대장), '
    + 'measurementCheckouts(측정기구 반출/반납), meetingReservations(회의실 예약), meetingMinutes(회의록), '
    + 'assets(자산 기기 대장 PC·노트북), licenses(소프트웨어 라이선스), itpDocs(ITP·QA 생성 문서 승인상태), mobileDrafts(모바일 점검 임시저장)';
  // v29.54: 공용 필터 파라미터 정의 — 세 provider 형식(Gemini/Claude/OpenAI)이 같이 쓴다
  var QUERY_STATE_PARAMS = {
    collection: '조회할 컬렉션 (필수)',
    date_from: '이 날짜부터만 포함 YYYY-MM-DD (선택)',
    date_to: '이 날짜까지만 포함 YYYY-MM-DD (선택)',
    proj: '프로젝트명/코드로 거르기 (선택)',
    status: '상태값으로 거르기 — 예: open, closed, done, pending (선택)',
    text: '이 텍스트가 포함된 문서만 (선택)',
    limit: '최대 반환 건수 (선택, 숫자)'
  };

  function buildGeminiTools() {
    var decls = Object.keys(ai.actions).map(function (name) {
      var def = ai.actions[name];
      var props = {};
      Object.keys(def.params).forEach(function (k) { props[k] = { type: 'STRING', description: def.params[k] }; });
      return { name: name, description: def.description, parameters: { type: 'OBJECT', properties: props } };
    });
    var qProps = {};
    Object.keys(QUERY_STATE_PARAMS).forEach(function (k) { qProps[k] = { type: 'STRING', description: QUERY_STATE_PARAMS[k] }; });
    decls.push({
      name: 'query_state',
      description: QUERY_STATE_DESC,
      parameters: { type: 'OBJECT', properties: qProps, required: ['collection'] }
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
    var qProps = {};
    Object.keys(QUERY_STATE_PARAMS).forEach(function (k) { qProps[k] = { type: 'string', description: QUERY_STATE_PARAMS[k] }; });
    decls.push({
      name: 'query_state',
      description: QUERY_STATE_DESC,
      input_schema: { type: 'object', properties: qProps, required: ['collection'] }
    });
    return decls;
  }

  var SYSTEM_INSTRUCTION = [
    '너는 세종기술의 사내 플랫폼 "세종플랫폼"의 AI 비서다. 한국어로 간결하게 답한다.',
    '조회는 query_state 도구로 처리한다. 등록/생성 요청은 해당 액션 도구를 호출한다 — 네가 직접 저장하는 게 아니라, ',
    '실제 입력 폼을 열고 값을 미리 채워주는 것뿐이며 최종 저장은 사용자가 화면에서 직접 확인 버튼을 눌러야 한다는 것을 답변에 명시해라.',
    '"OO 열어줘/보여줘/이동해줘"처럼 특정 화면으로 가고 싶다는 요청은 open_module 도구로 처리한다.',
    '"오늘 뭐 해야 해", "브리핑" 같은 요청은 get_briefing 도구로 처리한다 — 지연 업무와 오늘 마감을 맨 앞에 강조하고, 일정→결재→알림 순으로 간결히 요약해라.',
    '"엑셀로/PDF로 뽑아줘·저장해줘" 요청은 export_result 도구로 처리한다 — 직전 query_state 결과가 파일이 되므로, 아직 조회 전이면 먼저 query_state를 호출해라.',
    '"OO 업무 끝났어/완료 처리해줘" 요청은 complete_task 도구로 처리한다 — 채팅에 확인 카드가 뜨고 사용자가 [완료 처리]를 눌러야 실제 반영된다는 것을 답변에 알려줘라.',
    '품질 매뉴얼·절차서·규정 등 사내 문서 내용 질문은 search_docs로 검색해서 답하고, 반드시 출처(문서명)를 함께 표시해라. 검색 결과가 비었거나 오류면 그 사실을 그대로 알리고 지어내지 마라.',
    'quotes(견적) 데이터만 사용자 브라우저에 저장되어 다른 직원 화면과 다를 수 있다 — 견적 질문에는 이 점을 알려줘라.',
    '답변에 내부 ID(무작위 영숫자 코드, 예: RWqHYJ..., pu_17831...)를 절대 그대로 쓰지 마라. 조회 데이터에는 담당자가 이름으로 변환돼 있다 — 혹시 변환 안 된 ID가 남아 있으면 그 값은 빼고 "(미확인 사용자)"라고 표기해라.',
    'NCR·CAR는 query_state로 조회하고, 발행(등록) 요청은 create_ncr/create_car 도구로 처리한다 — 모듈이 열리고 폼이 채워질 뿐 발행은 사용자가 직접 하며, 발행 권한은 품질관리부에 있다는 것을 답변에 명시해라. 기존 NCR/CAR의 수정·삭제는 아직 미지원이다.',
    '측정기구·회의실 예약·회의록은 query_state로 조회만 가능하다(등록·수정은 아직 미지원 — 등록 요청을 받으면 해당 모듈을 직접 열어달라고 안내해라).',
    'ITP/QA 문서의 승인 상태·아이템 목록은 itpDocs로 조회할 수 있다. 단 문서 생성·도면/사진 업로드·검사 수행 자체는 아직 AI로 지원되지 않는다 — 그런 요청은 해당 모듈을 직접 열어달라고 안내해라.',
    '프로젝트/담당자를 찾지 못했다는 응답을 받으면 사용자에게 정확한 이름을 다시 물어봐라.'
  ].join(' ');

  // ── v29.58(로드맵 11단계): 화면 문맥 — 매 요청 시스템 프롬프트에 현재 상황을 붙인다 ──
  function currentScreenContext() {
    var parts = [];
    try {
      var u = (typeof getU === 'function') ? getU(state.currentUser) : null;
      if (u && u.name) parts.push('현재 사용자: ' + u.name + (u.dept ? ' (' + u.dept + ')' : ''));
    } catch (e) {}
    var now = new Date();
    parts.push('오늘: ' + localISO(now) + ' (' + ['일', '월', '화', '수', '목', '금', '토'][now.getDay()] + ')');
    try {
      // view/NAV/TOOLS는 index.html의 let/const 전역 — window.X가 아니라 같은 스코프의 bare 접근만 가능
      var v = (typeof view !== 'undefined' && view) || {};
      var tools = (typeof TOOLS !== 'undefined' && TOOLS) || {};
      var nav = (typeof NAV !== 'undefined' && NAV) || [];
      var screen = '';
      if (v.selectedTool && tools[v.selectedTool]) screen = tools[v.selectedTool].name;
      else if (v.cur) {
        var n = nav.find(function (x) { return x.id === v.cur; });
        screen = n ? n.label : String(v.cur);
      }
      if (screen) parts.push('현재 화면: ' + screen);
      var p = v.selectedProj;
      if (p && p.name) parts.push('보고 있는 프로젝트: ' + (p.code ? p.code + ' ' : '') + p.name);
    } catch (e) {}
    return parts.join(' · ');
  }
  ai.currentScreenContext = currentScreenContext; // 테스트/콘솔 확인용
  function buildSystemInstruction() {
    var ctx = '';
    try { ctx = currentScreenContext(); } catch (e) {}
    return SYSTEM_INSTRUCTION + (ctx
      ? ' [현재 상황] ' + ctx + ' — "이 프로젝트", "여기", "오늘", "이번 주" 같은 지시어는 이 상황을 기준으로 해석해라.'
      : '');
  }

  // 대화 기록은 제공사 중립 형식으로 보관하고, 각 provider 호출부에서만 변환한다.
  // { role:'user', text } | { role:'model', text } | { role:'model', functionCall:{name,args,id} } | { role:'function', name, result, callId }
  var history = [];

  // ── 대화 기록 유지 (v29.51, 로드맵 3단계) ────────────────────────
  // 사용자별 localStorage에 저장/복원. 조회 결과(function 턴)는 커서 1,000자로 절단하고
  // 최근 40턴만 남긴다. 자른 뒤 첫 턴이 함수호출 짝이 깨진 상태로 시작하지 않게 user 턴부터 시작.
  var HIST_LS_PREFIX = 'sjp_ai_chat_history_';
  var HIST_MAX_TURNS = 40;
  function histKey() { return (window.state && state.currentUser) ? HIST_LS_PREFIX + state.currentUser : ''; }
  function trimHistoryForSave(h) {
    var t = h.slice(-HIST_MAX_TURNS);
    while (t.length && t[0].role !== 'user') t.shift();
    return t.map(function (turn) {
      if (turn.role !== 'function') return turn;
      var rs = ''; try { rs = JSON.stringify(turn.result); } catch (e) { rs = String(turn.result); }
      return rs.length > 1000
        ? { role: 'function', name: turn.name, callId: turn.callId, result: rs.slice(0, 1000) + '…(절단됨)' }
        : turn;
    });
  }
  function saveHistory() {
    var k = histKey(); if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(trimHistoryForSave(history))); } catch (e) {}
  }
  var _histRestored = false;
  function restoreHistory() {
    if (_histRestored) return;
    var k = histKey(); if (!k) return; // 아직 로그인 전 — 다음에 다시 시도
    _histRestored = true;
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) {}
    if (!Array.isArray(saved) || !saved.length) return;
    history = saved;
    saved.forEach(function (t) {
      if (t.role === 'user') appendMsg('user', t.text);
      else if (t.role === 'model' && t.text) appendMsg('assistant', t.text);
    });
    appendMsg('system', '— 이전 대화를 불러왔습니다. 이어서 질문하거나, 🧹(새 대화)로 비울 수 있어요 —');
  }
  window.clearAiChat = function () {
    history = [];
    var k = histKey(); if (k) { try { localStorage.removeItem(k); } catch (e) {} }
    var box = $id('aiMessages');
    if (box) Array.prototype.slice.call(box.querySelectorAll('.ai-msg, .ai-confirm-card')).forEach(function (el) { el.remove(); });
    appendMsg('system', '새 대화를 시작합니다.');
  };

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
  async function callGeminiOnce(key, model, h, signal, base, extraHeaders, onToken) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, key ? { 'x-goog-api-key': key } : {}, extraHeaders || {});
    var res = await fetch((base || 'https://generativelanguage.googleapis.com/v1beta') + '/models/' + model + ':generateContent', {
      method: 'POST',
      signal: signal,
      headers: headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemInstruction() }] }, // v29.58: 화면 문맥 포함
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
    if (text && onToken) onToken(text);
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

  async function callClaudeOnce(key, model, h, signal, base, extraHeaders, onToken) {
    var headers = Object.assign({ 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }, key ? { 'x-api-key': key, 'anthropic-dangerous-direct-browser-access': 'true' } : {}, extraHeaders || {});
    var res = await fetch((base || 'https://api.anthropic.com/v1') + '/messages', {
      method: 'POST',
      signal: signal,
      headers: headers,
      body: JSON.stringify({
        model: model,
        max_tokens: 4096, // v29.62: 1024는 긴 브리핑·표가 잘림 — OpenAI 호환 경로와 통일
        system: buildSystemInstruction(), // v29.58: 화면 문맥 포함
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
    if (text && onToken) onToken(text);
    return { type: 'text', text: text };
  }

  // ── Groq/OpenRouter: OpenAI 호환 API (function calling 포함) ──
  // 대화 기록을 OpenAI 메시지 형식으로 변환. Gemini에서 넘어온 함수호출 턴에는 id가 없으므로
  // 히스토리 인덱스로 id를 만들어 붙인다(호출 턴 i ↔ 결과 턴 i+1이 'call_i'로 짝을 이룸).
  function openAiMessagesFromHistory(h) {
    var msgs = [{ role: 'system', content: buildSystemInstruction() }]; // v29.58: 화면 문맥 포함
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
    var qProps = {};
    Object.keys(QUERY_STATE_PARAMS).forEach(function (k) { qProps[k] = { type: 'string', description: QUERY_STATE_PARAMS[k] }; });
    decls.push({
      type: 'function',
      function: { name: 'query_state', description: QUERY_STATE_DESC, parameters: { type: 'object', properties: qProps, required: ['collection'] } }
    });
    return decls;
  }

  function parseOpenAiResponseText(text) {
    var trimmed = (text || '').trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed); } catch (e) {}
    }
    var lines = trimmed.split('\n');
    var fullContent = '';
    var toolCallsMap = {};
    var lastMsg = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line.startsWith('data:')) continue;
      var jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        var chunk = JSON.parse(jsonStr);
        var choice = (chunk.choices || [])[0] || {};
        var delta = choice.delta || choice.message || {};
        if (choice.message) lastMsg = choice.message;
        if (delta.content) fullContent += delta.content;
        if (delta.tool_calls) {
          delta.tool_calls.forEach(function (tc) {
            var idx = tc.index || 0;
            if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || ('call_' + idx), type: 'function', function: { name: '', arguments: '' } };
            if (tc.function) {
              if (tc.function.name) toolCallsMap[idx].function.name += tc.function.name;
              if (tc.function.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
            }
          });
        }
      } catch (e) {}
    }
    var tcList = Object.keys(toolCallsMap).map(function (k) { return toolCallsMap[k]; });
    if (tcList.length > 0) return { choices: [{ message: { role: 'assistant', tool_calls: tcList } }] };
    if (fullContent || lastMsg) return { choices: [{ message: { role: 'assistant', content: fullContent || (lastMsg && lastMsg.content) || '' } }] };
    return JSON.parse(trimmed);
  }

  async function callOpenAiCompatOnce(label, url, key, model, h, signal, extraHeaders, onToken) {
    var reqHeaders = Object.assign({ 'Content-Type': 'application/json' }, key ? { 'Authorization': 'Bearer ' + key } : {}, extraHeaders || {});
    var reqBody = { model: model, max_tokens: 4096, messages: openAiMessagesFromHistory(h), tools: buildOpenAiTools(), stream: true };
    var res = await fetch(url, {
      method: 'POST',
      signal: signal,
      headers: reqHeaders,
      body: JSON.stringify(reqBody)
    }).catch(function (err) { throw err; });

    // 400 Bad Request / 422 Unprocessable Entity 일 경우 tools(함수호출) 미지원 모델/프록시일 수 있으므로 tools 제거 후 1회 재시도
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      delete reqBody.tools;
      var retryRes = await fetch(url, {
        method: 'POST',
        signal: signal,
        headers: reqHeaders,
        body: JSON.stringify(reqBody)
      }).catch(function () { return null; });
      if (retryRes && retryRes.ok) res = retryRes;
    }
    // 400/405/415 등 스트리밍 미지원 프록시일 경우 stream: false 로 재시도
    if (!res.ok && (res.status === 400 || res.status === 405 || res.status === 415)) {
      delete reqBody.stream;
      var nonStreamRes = await fetch(url, {
        method: 'POST',
        signal: signal,
        headers: reqHeaders,
        body: JSON.stringify(reqBody)
      }).catch(function () { return null; });
      if (nonStreamRes && nonStreamRes.ok) res = nonStreamRes;
    }

    if (!res.ok) {
      var errText = await res.text().catch(function () { return ''; });
      throw httpError(label, res.status, errText.slice(0, 300));
    }

    // 스트리밍 본문 파싱 (ReadableStream)
    if (res.body && typeof res.body.getReader === 'function') {
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var fullContent = '';
      var toolCallsMap = {};
      var isStreamFormat = false;

      while (true) {
        var doneResult = await reader.read();
        if (doneResult.done) break;
        buffer += decoder.decode(doneResult.value, { stream: true });
        
        var lines = buffer.split('\n');
        buffer = lines.pop(); // incomplete line back to buffer

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          isStreamFormat = true;
          var jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            var chunk = JSON.parse(jsonStr);
            var choice = (chunk.choices || [])[0] || {};
            var delta = choice.delta || choice.message || {};
            if (delta.content) {
              fullContent += delta.content;
              if (onToken) onToken(delta.content);
            }
            if (delta.tool_calls) {
              delta.tool_calls.forEach(function (tc) {
                var idx = tc.index || 0;
                if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || ('call_' + idx), type: 'function', function: { name: '', arguments: '' } };
                if (tc.function) {
                  if (tc.function.name) toolCallsMap[idx].function.name += tc.function.name;
                  if (tc.function.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
                }
              });
            }
          } catch (e) {}
        }
      }

      if (buffer && buffer.trim()) {
        var lineRem = buffer.trim();
        if (lineRem.startsWith('data:')) {
          isStreamFormat = true;
          var jsonStrRem = lineRem.slice(5).trim();
          if (jsonStrRem && jsonStrRem !== '[DONE]') {
            try {
              var chunkRem = JSON.parse(jsonStrRem);
              var choiceRem = (chunkRem.choices || [])[0] || {};
              var deltaRem = choiceRem.delta || choiceRem.message || {};
              if (deltaRem.content) {
                fullContent += deltaRem.content;
                if (onToken) onToken(deltaRem.content);
              }
              if (deltaRem.tool_calls) {
                deltaRem.tool_calls.forEach(function (tc) {
                  var idx = tc.index || 0;
                  if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || ('call_' + idx), type: 'function', function: { name: '', arguments: '' } };
                  if (tc.function) {
                    if (tc.function.name) toolCallsMap[idx].function.name += tc.function.name;
                    if (tc.function.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
                  }
                });
              }
            } catch (e) {}
          }
        }
      }

      var tcList = Object.keys(toolCallsMap).map(function (k) { return toolCallsMap[k]; });
      if (tcList.length > 0) {
        var args = {};
        try { args = JSON.parse(tcList[0].function.arguments || '{}'); } catch (e) {}
        return { type: 'function_call', name: tcList[0].function.name, args: args, callId: tcList[0].id };
      }

      if (isStreamFormat || fullContent) {
        return { type: 'text', text: fullContent.trim() || '(응답 없음)' };
      }

      // 스트림 형식이 아니고 일반 JSON 본문인 경우
      try {
        var parsedJson = JSON.parse(buffer);
        var msg = ((parsedJson.choices || [])[0] || {}).message || {};
        var tc = (msg.tool_calls || [])[0];
        if (tc) {
          var argsParsed = {};
          try { argsParsed = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          return { type: 'function_call', name: tc.function.name, args: argsParsed, callId: tc.id };
        }
        var textParsed = (typeof msg.content === 'string' ? msg.content : '').trim() || '(응답 없음)';
        if (textParsed && onToken) onToken(textParsed);
        return { type: 'text', text: textParsed };
      } catch (e) {}
    }

    var textRaw = await res.text().catch(function () { return ''; });
    var data = {};
    try {
      data = parseOpenAiResponseText(textRaw);
    } catch (e) {
      throw httpError(label, 500, '파싱 실패: ' + e.message + ' (본문: ' + textRaw.slice(0, 100) + ')');
    }
    var msgFb = ((data.choices || [])[0] || {}).message || {};
    var tcFb = (msgFb.tool_calls || [])[0];
    if (tcFb) {
      var argsFb = {};
      try { argsFb = JSON.parse(tcFb.function.arguments || '{}'); } catch (e) {}
      return { type: 'function_call', name: tcFb.function.name, args: argsFb, callId: tcFb.id };
    }
    var textFb = (typeof msgFb.content === 'string' ? msgFb.content : '').trim() || '(응답 없음)';
    if (textFb && onToken) onToken(textFb);
    return { type: 'text', text: textFb };
  }

  // ── 게이트웨이 체인: 키가 있는 회사를 순서대로, 실패하면 자동으로 다음 회사 ──
  var lastProviderLabel = '';   // 마지막으로 실제 응답한 회사 (답변 밑에 표시)

  async function gatewayAuthHeaders() {
    if (!window.fb || !fb.auth || !fb.auth.currentUser) throw new Error('회사 로그인 후 9Router를 사용할 수 있습니다');
    return { Authorization: 'Bearer ' + await fb.auth.currentUser.getIdToken() };
  }

  async function callOneModel(p, key, model, h, signal, onToken) {
    // key === null 이면 회사 게이트웨이 경유. 9Router는 로그인 토큰까지 붙여 Worker가 직원 계정만 확인한다.
    var gw = key === null ? getGatewayUrl() + '/v1/' + p.id : null;
    var gatewayHeaders = key === null ? await gatewayAuthHeaders() : null;
    if (p.id === 'gemini') return callGeminiOnce(key, model, h, signal, gw, gatewayHeaders, onToken);
    if (p.id === 'claude') return callClaudeOnce(key, model, h, signal, gw, gatewayHeaders, onToken);
    if (p.id === '9router') return callOpenAiCompatOnce('9Router', gw + '/chat/completions', key, model, h, signal, gatewayHeaders, onToken);
    if (p.id === 'groq') return callOpenAiCompatOnce('Groq', (gw || 'https://api.groq.com/openai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders, onToken);
    if (p.id === 'cerebras') return callOpenAiCompatOnce('Cerebras', (gw || 'https://api.cerebras.ai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders, onToken);
    if (p.id === 'nvidia') return callOpenAiCompatOnce('NVIDIA', (gw || 'https://integrate.api.nvidia.com/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders, onToken);
    if (p.id === 'mistral') return callOpenAiCompatOnce('Mistral', (gw || 'https://api.mistral.ai/v1') + '/chat/completions', key, model, h, signal, gatewayHeaders, onToken);
    return callOpenAiCompatOnce('OpenRouter', (gw || 'https://openrouter.ai/api/v1') + '/chat/completions', key, model, h, signal, Object.assign({ 'X-Title': 'Sejong Platform' }, gatewayHeaders || {}), onToken);
  }

  // v29.64(A1): 죽은 로컬 LLM/9Router 터널 5분 쿨다운 — 메모리 변수만 사용
  // (localStorage 게이트 금지 원칙 준수. 새로고침하면 초기화되고, 그게 맞는 동작)
  var _localCooldownUntil = 0;

  // 한 회사 안에서: 소스(회사 게이트웨이 → 내 키들)를 교대하고, 소스마다 모델 목록을 시도한다.
  async function tryProvider(p, h, onToken) {
    // v29.45: 로컬 LLM은 게이트웨이/키가 아니라 이 컴퓨터 주소로 직접 호출. 첫 응답이 느릴 수 있어 120초.
    if (p.localOnly) {
      var base = getLocalUrl();
      if (!base) throw new Error('로컬 LLM 주소가 없습니다');
      // v29.64(A1): 최근 연결 실패했으면 5분간 건너뛴다 — 죽은 터널을 매 질문마다 두드리지 않게
      if (Date.now() < _localCooldownUntil) throw new Error('로컬 LLM 일시 중지(최근 연결 실패, 5분 후 자동 재시도)');
      var keyL = getLocalKey();
      // 5초 프리플라이트: 터널이 죽어 있으면(530/무응답) 120초 기다리지 않고 즉시 다음으로
      var ctlP = new AbortController();
      var timerP = setTimeout(function () { ctlP.abort(); }, 5000);
      try {
        var probe = await fetch(base + '/models', { headers: keyL ? { 'Authorization': 'Bearer ' + keyL } : {}, signal: ctlP.signal });
        clearTimeout(timerP);
        if (!probe.ok && probe.status >= 500) throw httpError('로컬 LLM', probe.status, '');
      } catch (ePr) {
        clearTimeout(timerP);
        _localCooldownUntil = Date.now() + 5 * 60000;
        throw new Error('로컬 LLM 연결 실패 — 5분간 건너뜁니다 (' + (ePr.message || ePr) + ')');
      }
      var ctlL = new AbortController();
      var timerL = setTimeout(function () { ctlL.abort(); }, 120000);
      try {
        var model = await resolveLocalModel(base, ctlL.signal, keyL);
        var rL = await callOpenAiCompatOnce('로컬 LLM', base + '/chat/completions', keyL, model, h, ctlL.signal, null, onToken);
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
        // v29.64(A12): 45초는 '첫 응답까지'만 — 토큰이 흐르기 시작하면 '무응답 30초' 기준으로
        // 전환한다. 긴 답변이 45초를 넘어도 스트리밍 중이면 끊지 않는다.
        let timer = setTimeout(function () { ctl.abort(); }, 45000);
        const onTokenIdle = function (t) {
          clearTimeout(timer);
          timer = setTimeout(function () { ctl.abort(); }, 30000);
          if (onToken) onToken(t);
        };
        try {
          var r = await callOneModel(p, src, p.models[mi], h, ctl.signal, onTokenIdle);
          clearTimeout(timer);
          setCursor(p.id, idx); // 이 소스가 살아있음 — 다음 질문도 여기부터
          return { result: r, viaGateway: src === null };
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
          // v29.64(A7): Gemini는 불량 키를 400으로 반환 — 모델 문제로 오인해 같은 키로
          // 다음 모델을 두드리지 말고, 다음 소스(키)로 넘어간다
          if (p.id === 'gemini' && e.status === 400 && /api[ _]?key.{0,30}not valid/i.test(e.message || '')) break;
          if (e.status === 400 || e.status === 404) continue;      // 모델 문제 → 다음 모델
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

  async function callProviderOnce(h, onStatus, onToken) {
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
        var r = await tryProvider(p, h, onToken);
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
        if (p.localOnly) lastLocalFail = why + ((e.message || e) ? (' — ' + (e.message || e).toString().slice(0, 180)) : '');
        fails.push(p.label + '(' + why + ')');
      }
    }
    // v29.47: 전부 '연결 실패'(네트워크 단)이고 게이트웨이를 쓰는 중이면 → 게이트웨이 차단이 원인.
    // 신채완 과장 사례(2026-07-24): 사내망에서 workers.dev 접속이 막혀 모든 회사공용 호출이 동시 실패.
    var _allNetFail = gw && fails.length && fails.every(function (f) { return f.indexOf('연결 실패') !== -1; });
    if (_allNetFail) {
      throw new Error('회사 AI 게이트웨이에 연결할 수 없습니다 — 이 PC의 네트워크/보안 프로그램이 workers.dev 접속을 차단하는 것 같아요. 🔑 설정의 [🔌 연결 테스트]로 확인하고, 차단이 맞으면 전산 담당에게 게이트웨이 주소 허용을 요청하거나 개인 API 키를 등록해주세요.');
    }
    throw new Error('모든 AI 호출 실패: ' + fails.join(', ') + ' — 잠시 후 다시 시도하거나 🔑에서 키를 확인해주세요.');
  }
  window.SJP_AI_lastLocalFail = function () { return lastLocalFail; };

  async function executeFunctionCall(name, args) {
    if (name === 'query_state') return queryState(args.collection, args); // v29.54: 필터 파라미터 전달
    var def = ai.actions[name];
    if (!def) return { error: '알 수 없는 액션: ' + name };
    if (def.query) { // v29.53: 조회형 액션 — 폼 없이 데이터만 반환 (v29.56: async run 지원)
      try { return await def.run(args || {}); }
      catch (e) { return { error: '조회 실패: ' + (e.message || e) }; }
    }
    if (def.direct) {
      var resolved = def.resolve(args);
      if (resolved.error) return resolved;
      renderConfirmCard(name, def, resolved);
      return { status: '채팅창에 확인 카드를 띄웠습니다 — 사용자가 확인을 눌러야 실제로 실행됩니다.' };
    }
    var r = def.fill(args);
    if (r && (r.error || r.status)) return r; // v29.50: 액션이 자체 결과 문구를 주면 그대로 사용 (open_module 등)
    return { status: '"' + def.description + '" 입력 폼을 열고 값을 채워놨습니다. 사용자가 확인 후 저장 버튼을 눌러야 실제로 저장됩니다.' };
  }

  // v29.57: 도구 실행 중임을 사용자에게 보여줄 라벨
  var TOOL_STATUS = {
    query_state: '📊 데이터 조회 중', get_briefing: '📋 브리핑 준비 중', search_docs: '📚 사내 문서 검색 중',
    export_result: '📄 파일 생성 중', open_module: '🧭 화면 이동 중', send_message: '💬 메시지 준비 중',
    create_ncr: '⚠️ NCR 폼 준비 중', create_car: '🔧 CAR 폼 준비 중'
  };
  function toolStatusLabel(name, args) {
    var base = TOOL_STATUS[name] || ('🔧 ' + name + ' 실행 중');
    if (name === 'query_state' && args && args.collection) base += ' (' + args.collection + ')';
    return base + '…';
  }

  var lastLoopLimit = false; // v29.62: 이번 질문이 5회 루프 한계에 걸렸는지 (aiUsage 계측용)
  async function runConversation(userText, onStatus, onToken) {
    lastLoopLimit = false;
    history.push({ role: 'user', text: userText });
    for (var i = 0; i < 5; i++) {
      var result = await callProviderOnce(history, onStatus, onToken);
      if (result.type === 'function_call') {
        if (onStatus) onStatus(toolStatusLabel(result.name, result.args)); // v29.57: 도구 사용 표시
        history.push({ role: 'model', functionCall: { name: result.name, args: result.args, id: result.callId } });
        var execResult = await executeFunctionCall(result.name, result.args);
        history.push({ role: 'function', name: result.name, result: execResult, callId: result.callId });
        continue;
      }
      history.push({ role: 'model', text: result.text });
      return result.text;
    }
    lastLoopLimit = true; // 이 빈도가 높으면 에이전트 모드(로드맵 12단계)를 검토할 근거가 된다
    var loopMsg = '요청을 처리하는 데 단계가 너무 많이 필요합니다. 질문을 조금 더 구체적으로 나눠서 다시 시도해주세요.';
    history.push({ role: 'model', text: loopMsg }); // v29.64(A14): history 짝 맞춤 — 안 남기면 다음 턴이 function 턴 뒤 user 턴으로 깨짐
    return loopMsg;
  }

  // ── 5. 채팅 UI ──────────────────────────────────────────────────
  // v29.57(로드맵 10단계): 답변 마크다운 렌더링. 반드시 HTML 이스케이프를 먼저 하고
  // 안전한 태그만 조립하므로 모델 출력에 스크립트가 섞여도 실행되지 않는다.
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>');
  }
  function renderMarkdown(text) {
    var lines = escHtml(text || '').split('\n');
    var html = [], i = 0, inUl = false, inOl = false;
    function closeLists() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }
    while (i < lines.length) {
      var ln = lines[i];
      // 표: | a | b | 형태 + 다음 줄이 |---|---| 구분선
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeLists();
        var head = ln.replace(/^\s*\||\|\s*$/g, '').split('|').map(function (c) { return '<th>' + mdInline(c.trim()) + '</th>'; }).join('');
        html.push('<table><thead><tr>' + head + '</tr></thead><tbody>');
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          var cells = lines[i].replace(/^\s*\||\|\s*$/g, '').split('|').map(function (c) { return '<td>' + mdInline(c.trim()) + '</td>'; }).join('');
          html.push('<tr>' + cells + '</tr>');
          i++;
        }
        html.push('</tbody></table>');
        continue;
      }
      var h = ln.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeLists(); html.push('<div class="md-h">' + mdInline(h[2]) + '</div>'); i++; continue; }
      var ul = ln.match(/^\s*[-*·]\s+(.*)$/);
      if (ul) {
        if (inOl) { html.push('</ol>'); inOl = false; }
        if (!inUl) { html.push('<ul>'); inUl = true; }
        html.push('<li>' + mdInline(ul[1]) + '</li>'); i++; continue;
      }
      var ol = ln.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (ol) {
        if (inUl) { html.push('</ul>'); inUl = false; }
        if (!inOl) { html.push('<ol>'); inOl = true; }
        html.push('<li>' + mdInline(ol[2]) + '</li>'); i++; continue;
      }
      closeLists();
      if (ln.trim() === '') html.push('<div class="md-gap"></div>');
      else html.push('<div>' + mdInline(ln) + '</div>');
      i++;
    }
    closeLists();
    return html.join('');
  }

  function appendMsg(role, text) {
    var box = $id('aiMessages');
    var div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    if (role === 'assistant') {
      var content = document.createElement('div');
      content.className = 'md';
      content.innerHTML = renderMarkdown(text);
      div._md = content;
      div._raw = text || '';
      div.appendChild(content);
      var cp = document.createElement('button');
      cp.className = 'ai-copy-btn';
      cp.title = '답변 복사';
      cp.textContent = '📋';
      cp.onclick = function () {
        try {
          navigator.clipboard.writeText(div._raw || '');
          cp.textContent = '✓';
          setTimeout(function () { cp.textContent = '📋'; }, 1200);
        } catch (e) {}
      };
      div.appendChild(cp);
    } else {
      div.textContent = text;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function appendAssistantChunk(el, chunk) {
    el._raw = (el._raw || '') + chunk;
    if (el._md) el._md.innerHTML = renderMarkdown(el._raw);
  }
  function setAssistantFinal(el, text) {
    el._raw = text;
    if (el._md) el._md.innerHTML = renderMarkdown(text);
  }

  function renderConfirmCard(actionName, def, resolved) {
    var box = $id('aiMessages');
    var card = document.createElement('div');
    card.className = 'ai-confirm-card';
    // v29.61: cardLines(줄 배열)를 주면 범용 카드로 렌더. 모델 출력이 innerHTML에 들어가므로 반드시 이스케이프
    var bodyHtml = resolved.cardLines
      ? resolved.cardLines.map(escHtml).join('<br>')
      : (resolved.channelName ? '채널: ' + escHtml(resolved.channelName) + '<br>' : '') + escHtml(resolved.text || '');
    var label = resolved.confirmLabel || '전송';
    card.innerHTML = '<div>' + escHtml(def.description) + '</div>' +
      '<div style="margin:6px 0;color:var(--text-light);">' + bodyHtml + '</div>' +
      '<button class="btn btn-primary" data-act="confirm">' + escHtml(label) + '</button> ' +
      '<button class="btn" data-act="cancel">취소</button>';
    card.querySelector('[data-act="confirm"]').onclick = async function () {
      card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      try {
        await def.commit(resolved);
        appendMsg('system', '✓ ' + label + ' 완료');
      } catch (e) {
        appendMsg('system', label + ' 실패: ' + (e.message || e));
      }
    };
    card.querySelector('[data-act="cancel"]').onclick = function () { card.remove(); };
    box.appendChild(card);
    box.scrollTop = box.scrollHeight;
  }

  // v29.47: 게이트웨이 연결 진단 — 응답이 오면(상태코드 무관) 연결 OK,
  // fetch 자체가 실패하면 이 PC에서 workers.dev가 차단된 것 (사내 방화벽/백신 등).
  window.testAiGateway = async function () {
    var el = $id('aiGwTestResult'); if (!el) return;
    var inp = $id('aiGatewayUrlInput');
    var url = ((inp && inp.value.trim()) || getGatewayUrl() || '').replace(/\/+$/, '');
    if (!url) { el.textContent = '게이트웨이 주소가 비어 있습니다'; return; }
    el.textContent = '테스트 중...'; el.style.color = 'var(--text-light)';
    try {
      var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, 8000);
      await fetch(url + '/health', { method: 'GET', signal: ctl.signal });
      clearTimeout(t);
      el.textContent = '✓ 게이트웨이 연결 정상 — 개인 키 없이 회사 공용 키로 사용 가능합니다';
      el.style.color = 'var(--success)';
    } catch (e) {
      el.textContent = '✗ 연결 안 됨 — 이 PC에서 게이트웨이(workers.dev) 접속이 차단돼 있습니다. 사내 방화벽/보안 프로그램의 차단 여부를 확인하거나, 아래에 개인 API 키를 등록해주세요.';
      el.style.color = 'var(--danger)';
    }
  };

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
      // v29.47: 연결 진단 — '모든 AI 호출 실패(연결 실패)'가 게이트웨이 차단인지 즉석 확인 (신채완 과장 사례)
      '<div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap;">' +
      '<button type="button" onclick="testAiGateway()" style="font-size:11px;padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;">🔌 연결 테스트</button>' +
      '<span id="aiGwTestResult" style="font-size:11px;color:var(--text-light);"></span></div>' +
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
      // v29.48: 전 직원 공용 공유 — 체크하고 저장하면 모든 직원이 각자 입력 없이 이 설정을 사용
      '<label style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:8px;cursor:pointer;font-weight:600;">' +
      '<input type="checkbox" id="aiLocalShareChk"' + (sharedLocal && sharedLocal.localUrl ? ' checked' : '') + '>' +
      ' 이 주소·키·모델을 <b style="color:var(--primary);">전 직원 공용</b>으로 공유 (다른 직원은 입력 불필요)</label>' +
      (sharedLocal && sharedLocal.localUrl
        ? '<div style="font-size:10px;color:var(--text-lighter);margin-top:3px;">현재 공용 설정: ' + String(sharedLocal.localUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;') + (sharedLocal.byName ? ' · ' + String(sharedLocal.byName).replace(/</g, '&lt;') + ' 공유' : '') + '</div>'
        : '') +
      '</div>';
    // v29.56: 관리자용 사내 문서 등록(RAG) — 워커가 RAG_ADMIN_EMAILS로 최종 검증하므로
    // 여기 노출 조건(super/admin)은 UI 정리 목적일 뿐 보안 경계가 아니다.
    var me = null; try { me = (typeof getU === 'function') ? getU(state.currentUser) : null; } catch (e) {}
    var isDocAdmin = me && (me.grade === 'super' || me.grade === 'admin' || me.grade === 'exec');
    var docHtml = !isDocAdmin ? '' : '<div class="fg" style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);">' +
      '<label class="fl">📚 사내 문서 등록 (관리자) — 등록하면 전 직원이 AI 비서에게 내용을 물어볼 수 있습니다</label>' +
      '<input class="fi" id="aiDocNameInput" spellcheck="false" style="margin-bottom:6px;" placeholder="문서 이름 — 예: 용접검사 절차서 WPS-001">' +
      '<textarea class="fi" id="aiDocTextInput" rows="4" spellcheck="false" style="resize:vertical;font-size:11px;" placeholder="문서 본문 텍스트를 붙여넣으세요 (PDF는 내용을 복사해서). 같은 이름으로 다시 등록하면 교체됩니다."></textarea>' +
      '<button type="button" class="btn" id="aiDocUploadBtn" style="margin-top:6px;" onclick="SJP_AI_uploadDoc()">📚 문서 등록</button>' +
      '<div style="font-size:11px;color:var(--text-lighter);margin-top:4px;">게이트웨이 v3(AI·VECTORIZE 바인딩) 배포가 필요합니다 — gateway/README.md 참고</div>' +
      // v29.63: 크론 잡 즉시 실행 버튼 — 브라우저 콘솔 없이 알림·백업 테스트
      '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);">' +
      '<label class="fl">🛠 관리자 도구 — 매일 아침 9시 자동 실행되는 작업을 지금 바로 돌려봅니다</label>' +
      '<button type="button" class="btn" onclick="SJP_AI_runCron(\'cron\')">🔔 알림 지금 실행</button> ' +
      '<button type="button" class="btn" onclick="SJP_AI_runCron(\'backup\')">💾 백업 지금 실행</button>' +
      '</div>' +
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
      docHtml +
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
        // v29.48: 전 직원 공용 공유 저장/해제
        (function () {
          var chk = $id('aiLocalShareChk');
          if (!chk || !window.fb || !fb.db) return;
          var lu = luEl ? luEl.value.trim().replace(/\/+$/, '') : '';
          var me = (window.state && state.users || []).find(function (x) { return x.id === (window.state && state.currentUser); });
          if (chk.checked && lu) {
            fb.setDoc(fb.doc(fb.db, 't_aiSharedConfig', 'config'), {
              localUrl: lu,
              localKey: lkEl ? lkEl.value.trim() : '',
              localModel: lmEl ? lmEl.value.trim() : '',
              updatedAt: Date.now(), byUid: (window.state && state.currentUser) || null, byName: (me && me.name) || ''
            }).then(function () {
              sharedLocal = { localUrl: lu, localKey: lkEl ? lkEl.value.trim() : '', localModel: lmEl ? lmEl.value.trim() : '', byUid: (window.state && state.currentUser) || null, byName: (me && me.name) || '' };
              appendMsg('system', '✓ 로컬 LLM/9Router 설정이 전 직원 공용으로 공유됐습니다 — 다른 직원은 입력 없이 바로 사용합니다.');
            }).catch(function (e) { appendMsg('system', '공용 공유 저장 실패: ' + (e.message || e)); });
          } else if (!chk.checked && sharedLocal && sharedLocal.localUrl) {
            // 해제는 공유한 본인 또는 super만 — 다른 직원이 실수로 회사 공용을 끄는 것 방지
            var isOwner = sharedLocal.byUid && window.state && sharedLocal.byUid === state.currentUser;
            var isSuper = me && me.grade === 'super';
            if (isOwner || isSuper) {
              fb.setDoc(fb.doc(fb.db, 't_aiSharedConfig', 'config'), { localUrl: '', localKey: '', localModel: '', updatedAt: Date.now(), byUid: (window.state && state.currentUser) || null }).then(function () {
                sharedLocal = null;
                appendMsg('system', '전 직원 공용 로컬 LLM 설정을 해제했습니다.');
              }).catch(function () {});
            }
          }
        })();
        _localModelCache = '';   // 주소·모델 바뀌었으니 자동 감지 캐시 초기화
        _localCooldownUntil = 0; // v29.64: 설정을 바꿨으니 쿨다운도 해제 — 바로 재시도 가능
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

  // v29.53: 패널 첫 오픈 시 브리핑 추천 버튼 — 눌러보기 전엔 브리핑 기능이 있는지 모르니 안내
  function showBriefingSuggest() {
    if (document.getElementById('aiBriefBtn')) return;
    var box = $id('aiMessages'); if (!box) return;
    var div = document.createElement('div');
    div.className = 'ai-msg system';
    var btn = document.createElement('button');
    btn.id = 'aiBriefBtn';
    btn.className = 'btn btn-sm';
    btn.textContent = '📋 오늘 브리핑 보기';
    btn.onclick = function () {
      var i = $id('aiInput');
      if (i) i.value = '오늘 브리핑 보여줘';
      window.sendAiMessage();
    };
    div.appendChild(btn);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  var keyHintShown = false;
  window.toggleAiPanel = function () {
    var p = $id('aiPanel');
    p.classList.toggle('open');
    if (p.classList.contains('open')) {
      if (window._positionAiPanel) window._positionAiPanel(); // v29.35 FAB 드래그 위치 따라 패널 배치
      updateDot();
      restoreHistory(); // v29.51: 이전 대화 복원 (로그인 후 최초 1회)
      if (hasAnyKey()) showBriefingSuggest(); // v29.53
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
        provider: provider || '', ok: !!ok, err: errMsg ? String(errMsg).slice(0, 120) : '',
        loopLimit: lastLoopLimit // v29.62: 도구 루프 5회 한계 도달 여부 — 에이전트 모드 필요성 판단용
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
    // v29.57: 상태 줄 — 토큰이 오면 지워지고, 도구 호출이 시작되면 다시 맨 아래 생긴다
    var statusEl = appendMsg('system', '생각 중...');
    var assistantMsgEl = null;
    function setStatus(t) {
      if (statusEl) statusEl.textContent = t;
      else { statusEl = appendMsg('system', t); }
      var box = $id('aiMessages');
      if (box) box.scrollTop = box.scrollHeight;
    }
    function clearStatus() { if (statusEl) { statusEl.remove(); statusEl = null; } }

    try {
      var reply = await runConversation(
        text,
        setStatus,
        function (tokenChunk) {
          clearStatus();
          if (!assistantMsgEl) assistantMsgEl = appendMsg('assistant', '');
          appendAssistantChunk(assistantMsgEl, tokenChunk);
          var box = $id('aiMessages');
          if (box) box.scrollTop = box.scrollHeight;
        }
      );

      clearStatus();
      if (!assistantMsgEl && reply) {
        appendMsg('assistant', reply);
      } else if (assistantMsgEl && reply) {
        setAssistantFinal(assistantMsgEl, reply);
      }
      if (lastProviderLabel) appendMsg('system', '— ' + lastProviderLabel);
      logAiUsage(true, lastProviderLabel);
      // v29.45.1: 로컬 LLM을 설정했는데 실패해서 다른 곳으로 넘어갔으면, 원인을 세션당 1회 안내
      if (getLocalUrl() && lastLocalFail && lastProviderLabel.indexOf('로컬') === -1 && !localFailHintShown) {
        localFailHintShown = true;
        appendMsg('system', '🖥 내 컴퓨터 LLM / 9Router로 답하지 못해 다른 AI로 넘어갔어요 (' + lastLocalFail + ').\n확인: ① 9Router/LM Studio 서버가 켜졌는지 ② 주소/API 키가 맞는지 ③ 9Router에 등록된 모델명(예: fable-5, cc/claude-opus-4-7)과 대소문자/하이픈이 일치하는지.');
      }
    } catch (e) {
      clearStatus();
      appendMsg('system', '오류: ' + (e.message || e));
      logAiUsage(false, lastProviderLabel, e.message || e);
    } finally {
      aiBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '전송'; }
      saveHistory(); // v29.51: 성공/실패 무관하게 여기까지의 대화를 저장
    }
  };
})();

/* SJ 메신저 — AI 비서 방의 두뇌
 *
 * 왜 따로 파일인가: messenger.js 는 화면이고, 여기는 바깥(회사 게이트웨이)과 이야기하는 부분이다.
 * 섞으면 화면 고칠 때마다 모델 코드를 읽게 된다.
 *
 * 열쇠(API 키)는 이 코드에 없다. 회사 게이트웨이(Cloudflare Worker)가 들고 있고,
 * 우리는 Firebase 로그인 토큰만 보낸다 → 워커가 @sejong-21c.com 계정인지 확인하고 대신 부른다.
 * 그래서 이 파일이 깃허브에 공개돼도 새는 것이 없다. (gateway/cloudflare-worker.js 참고)
 *
 * 1단계에서 안 하는 것(일부러):
 *   - 스트리밍(글자가 흘러나오기). 화면은 "생각 중" 점 세 개로 대신한다. 답 하나 = 문서 하나라 저장이 단순하다.
 *   - 함수 호출(도구). 회사마다 형식이 달라 셋을 다 맞추면 코드가 세 배가 된다.
 *     대신 질문할 때마다 사내 문서 검색 결과와 내 권한 범위의 요약을 함께 넣어 준다(맥락 주입).
 */
export const AI_CID = 'ai';                 // 가상 채널 id — 실제 channels 문서를 만들지 않는다
export const AI_UID = 'AI';                 // 말풍선 작성자
export const AI_컬렉션 = 't_aiChat';        // 개인 대화. messages 에 넣지 않는다(아래 이유)
//   ① messages 는 전 직원이 최근 500건을 통째로 구독한다 → 남의 AI 대화가 모두의 폰에 내려간다.
//   ② AI 답변은 길어서 그 500칸을 금세 차지하고 진짜 대화를 창 밖으로 밀어낸다.
//   규칙(firestore.rules)에서 t_aiChat 은 본인 uid 만 읽고 쓴다.

const 게이트웨이 = 'https://sejong-ai-gateway.cwkim-65d.workers.dev';
// 앞에서부터 시도하고 한도 초과·오류면 다음으로 넘어간다.
// 순서는 짐작이 아니라 2026-09-18 게이트웨이를 직접 찔러 본 결과다(전부 회사 토큰으로):
//   groq openai/gpt-oss-120b → 200 · groq openai/gpt-oss-20b → 200
//   gemini → 400 "User location is not supported"(워커가 뜬 지역 문제. 콜로에 따라 될 때가 있어 뒤에 남겨 둔다)
//   cerebras → 402 결제 필요 · nvidia → 410 모델 수명 종료 · openrouter → 401 · mistral → 501 키 없음
// ⚠️ 모델 이름은 예고 없이 폐기된다 — llama-3.3-70b-versatile 은 404 였다(부장님 첫 질문이 이것 때문에 실패).
//    답이 안 오면 여기부터 의심하고, 게이트웨이에 /v1/<회사>/chat/completions 로 직접 찔러 볼 것.
const 체인 = [
  { id: 'groq', model: 'openai/gpt-oss-120b', 형식: 'openai' },
  { id: 'groq', model: 'openai/gpt-oss-20b', 형식: 'openai' },
  { id: 'gemini', model: 'gemini-flash-latest', 형식: 'gemini' },
  { id: 'cerebras', model: 'gpt-oss-120b', 형식: 'openai' },
];
const 제한초 = 40;

async function 토큰(fb) {
  const u = fb && fb.auth && fb.auth.currentUser;
  if (!u || typeof u.getIdToken !== 'function') throw new Error('회사 계정으로 로그인해야 AI 비서를 쓸 수 있습니다.');
  return 'Bearer ' + await u.getIdToken();
}
function 시간제한() {
  const c = new AbortController();
  return { signal: c.signal, 정리: (() => { const t = setTimeout(() => c.abort(), 제한초 * 1000); return () => clearTimeout(t); })() };
}

/** 사내 문서(품질 매뉴얼·절차서 등) 검색. 게이트웨이의 Vectorize 색인을 그대로 쓴다. */
export async function 사내문서(질문, fb, topK = 5) {
  try {
    const { signal, 정리 } = 시간제한();
    const r = await fetch(게이트웨이 + '/rag/search', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: await 토큰(fb) },
      body: JSON.stringify({ query: String(질문).slice(0, 500), topK }),
    });
    정리();
    if (!r.ok) return [];                       // 색인이 아직 없거나(501) 권한 문제면 조용히 건너뛴다 — 답변 자체는 계속한다
    const j = await r.json();
    return Array.isArray(j.matches) ? j.matches.filter((m) => (m.score || 0) >= 0.4) : [];
  } catch (e) { return []; }
}

// ── NAS 표에 묻기 (v4.1) ────────────────────────────────────────────────────
// 왜 검색으로 안 되나: "작년 견적 재료비 총액" 은 **세는** 질문이다. 벡터 검색은 비슷한 몇 줄만
//   집어 오므로 97줄 중 30줄만 보고 답한다 — 그럴듯한데 틀린 숫자가 나온다(제일 나쁜 종류).
//   맥에 NAS 표 20개(323만 행)가 SQLite 로 쌓여 있다. 세는 건 SQL 한 줄이면 정확하다.
//
// 왜 SQL 을 여기서 쓰나: 질문을 SQL 로 바꾸는 건 LLM 이 제일 잘한다. 맥에서 또 부르면
//   메시지마다 두뇌 요금이 붙는다 — 여기 체인(무료)이 쓰고 맥은 돌리기만 한다.
//   **안전한 이유**: 맥이 SQLite 권한자로 막는다. 우리가 무슨 SQL 을 보내도 범위 밖 줄은
//   물리적으로 안 나오고, 쓰기·PRAGMA·ATTACH 는 준비 단계에서 거부된다.
//   (pais_project/src/xl_query.js — 거기 실측이 적혀 있다)

// 세는 질문일 때만 부른다. 왕복 두 번 + 두뇌 한 번이라 인사말에까지 붙이면 느려진다.
const 세는말 = /합계|총액|총\s*금액|얼마|몇\s*(건|개|장|명|번|줄)|건수|개수|평균|최대|최소|가장\s*(큰|많은|비싼)|상위|순위|추이|연도별|월별|부서별|업체별|집계|통계|합쳐|더하면|비교/;
export const 세는질문인가 = (질문) => 세는말.test(String(질문 || ""));

const SQL만 = (글) => String(글 || "")
  .replace(/```[a-z]*\n?/gi, "").replace(/```/g, "")
  .replace(/^\s*(sql|질의|답)\s*[:：]\s*/i, "")
  .trim().replace(/;+\s*$/, "");

async function 표부르기(fb, 몸) {
  const { signal, 정리 } = 시간제한();
  try {
    const r = await fetch(게이트웨이 + "/rag/table", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: await 토큰(fb) },
      body: JSON.stringify(몸),
    });
    if (!r.ok) return { error: "표 서버 " + r.status };
    return await r.json();
  } finally { 정리(); }
}

/** 글 하나 받을 때까지 회사를 옮겨 간다. 빈 응답도 실패로 친다 — 아래 표묻기 주석 참고. */
async function 두뇌하나(규칙, 물음, auth) {
  for (const p of 체인) {
    try {
      const r = await 한번부르기(p, 규칙, [], 물음, auth);
      if (r && r.text) return r.text;
    } catch (e) { /* 다음 회사 */ }
  }
  return '';
}

/** 세는 질문이면 표에 물어 본다. 못 하면 **조용히 null** — 답변 자체는 계속돼야 한다. */
export async function 표묻기(질문, fb) {
  if (!세는질문인가(질문)) return null;
  try {
    const 목록 = await 표부르기(fb, { 목록: true });
    if (!목록 || !목록.표) return null;

    const 규칙 = [
      "너는 SQLite 질의를 쓴다. 아래 표 목록만 보고 **SELECT 한 문장**을 쓴다.",
      "- 표·열 이름은 목록에 있는 것만 쓴다. 없는 이름을 지어내지 마라.",
      "- 열 이름은 큰따옴표로 감싼다.",
      `- **숫자는 글자로 저장돼 있다.** 더할 때는 쉼표를 떼고 real 로 바꾼다:`,
      `    sum(cast(replace("재료비", ',', '') as real))`,
      "- 날짜는 _수정일(YYYY-MM-DD, 그 파일이 마지막으로 고쳐진 날)뿐이다. 연도는 substr(_수정일,1,4).",
      "- 어느 파일에서 나왔는지 댈 수 있게 _파일·_폴더 를 함께 뽑거나 count(distinct _파일) 을 넣는다.",
      "- 표를 3개 넘게 함께 보지 마라. LIMIT 을 붙인다.",
      "- 이 질문이 표로 셀 수 있는 것이 아니면 SQL 대신 **없음** 한 단어만 쓴다.",
      "설명·머리말·코드울타리 없이 SQL 만 쓴다.",
      "",
      목록.표,
    ].join("\n");

    let sql = null, 마지막오류 = null;
    // 두 번까지: 처음 쓴 SQL 이 틀리면 **오류 문장을 그대로 돌려주고** 한 번 더 시킨다.
    // 열 이름을 짐작해 틀리는 게 흔한데, 오류만 보면 대개 한 번에 고친다.
    for (let 회 = 0; 회 < 2; 회++) {
      const 물음 = 회 === 0 ? 질문
        : `${질문}\n\n앞서 쓴 질의가 실패했다:\n${sql}\n오류: ${마지막오류}\n고쳐서 다시 써라.`;
      // **체인을 돈다.** 처음엔 체인[0] 만 불렀는데, groq gpt-oss-120b 가 가끔 빈 content 를
      // 돌려준다(추론만 하고 답을 안 쓴다) → 한번부르기가 "빈 응답" 을 던지고 → 표를 통째로
      // 건너뛰었다. 답하기() 는 다음 회사로 넘어가는데 여기만 안 넘어가고 있었다.
      // 2026-09-22 실측: 같은 질문이 한 번은 SQL 을, 한 번은 빈 글을 냈다.
      const 글 = await 두뇌하나(규칙, 물음, await 토큰(fb));
      // **null 과 오류를 가른다.** null 은 "표로 셀 질문이 아니라 안 물어봤다" 는 뜻이고,
      //   화면(messenger.js)은 그 경우 아무 말도 안 넣는다. 그런데 "질의를 못 썼다" 까지
      //   null 로 돌려주니, 세는 질문인데 조용히 넘어가서 AI 가 **없는 메뉴를 지어냈다**
      //   (2026-09-22: "왼쪽 메뉴 견적 → NAS 견적서 목록" — 그런 메뉴는 없다).
      //   못 센 건 못 셌다고 말해야 한다.
      if (!글) return { sql: null, 줄: [], 오류: "두뇌가 질의를 쓰지 못했다(빈 응답)" };
      sql = SQL만(글);
      if (/^없음$/i.test(sql)) return null;            // 여기만 진짜 null — 표로 셀 질문이 아니다
      if (!sql) return { sql: null, 줄: [], 오류: "두뇌가 질의를 쓰지 못했다" };
      if (!/^\s*(select|with)\b/i.test(sql)) return { sql, 줄: [], 오류: "SELECT 가 아닌 것을 썼다" };
      const r = await 표부르기(fb, { sql, 줄: 60 });
      if (r && !r.error && Array.isArray(r.줄)) return { sql, 줄: r.줄, 쓴표: r.쓴표 || [], 잘림: !!r.잘림 };
      마지막오류 = (r && r.error) || "알 수 없는 오류";
    }
    return { sql, 줄: [], 오류: 마지막오류 };
  } catch (e) { return null; }
}

function 지침(맥락, perm) {
  return [
    '너는 세종기술(플랜트 설계·제작·시공 회사)의 사내 AI 비서다. 한국어 존댓말로 답한다.',
    '답은 짧게. 표·글머리표를 적극적으로 쓰고, 서론과 맺음말은 쓰지 않는다.',
    '모르면 모른다고 한다. 아래 자료에 없는 숫자를 지어내지 않는다.',
    // 원칙(AI 는 직접 저장하지 않는다)은 그대로 두되, 말이 퉁명스럽지 않게. 부장님이 "영수증 처리 가능?" 하고 물었을 때
    // "직접 진행하실 수 없습니다"로 끝나서 쓸모가 없었다(2026-09-18 실제 대화). 어디서 무엇을 누르는지까지 말해야 한다.
    '너는 플랫폼에 직접 저장·변경하지 않는다. 사람이 확인하고 저장하는 것이 회사 원칙이다.',
    '그렇다고 "할 수 없습니다"로 끝내지 마라. 어느 화면에서 무엇을 하면 되는지 짚어 준다.',
    // **괄호 지시문을 그대로 뱉는 것을 막는다.** 2026-09-21: 답이 통째로
    // "플랫폼에 아직 그 화면이 없습니다. (한 줄 안내)" 로 나왔다 —
    // 위 지시의 "한 줄로" 를 채워야 할 빈칸으로 읽고 그대로 옮겨 적은 것이다.
    '괄호로 감싼 말(예: "(한 줄 안내)")이나 대괄호 빈칸을 답에 그대로 쓰지 마라. 실제 내용으로 채워라.',
    // **없는 화면을 지어내지 못하게 실제 메뉴를 준다.** 2026-09-21: "재무부 자료" 를 물었더니
    // 왼쪽 메뉴 "전사 → 재무관리" 에서 보라고 했는데 **그런 메뉴가 없다.** 아래 예시만 보고
    // 같은 꼴로 지어낸 것이다. 메뉴가 늘면 여기도 같이 고칠 것.
    '## 왼쪽 메뉴에 실제로 있는 것 (이 목록에 없는 화면 이름을 지어내지 마라)',
    '대시보드 · 캘린더 · 프로젝트 · 제작 공정 관리 · 업무관리 · 메신저 · 회의실·회의록 · 견적 ·',
    '목표(OKR) · Manday Tracker · 조직/권한 관리 · 결재 · 로드맵·진척 · 지식 지도 ·',
    '부서 도구함(품질관리부: NCR 관리 · CAR 관리 · ITP Builder · QA Doc Generator · Mobile Inspection ·',
    '측정기·검교정 / 기술부: 압력용기 계산 도구 등).',
    '**재무·회계·인사 "화면"은 없다.** 그런 화면을 물으면 "플랫폼에 아직 그 화면이 없다" 고 답한다 —',
    '없는 경로를 안내하면 사람이 한참 찾다가 못 찾는다.',
    // **화면 질문과 자료 질문을 가른다.** 2026-09-21: 부장님이 "재무부 자료에서 찾아줘",
    // "옵시디언에서 내 자료 찾아서 보면 되잖아" 라고 물었는데 둘 다
    // "플랫폼에 아직 그 화면이 없습니다" 로 끝났다. 자료를 찾아 달라는 말인데
    // 화면 이야기로 받은 것이다 — 위 규칙을 너무 넓게 적용했다.
    '**다만 이건 화면 이야기일 뿐이다. 자료를 찾아 달라는 말과 헷갈리지 마라.**',
    '"~자료 찾아줘" · "~어디 있어?" · "~문서 있나?" 는 화면 질문이 아니다.',
    '그런 물음에는 아래 [자료]에서 찾아 **파일 이름과 폴더 경로를 그대로** 답한다.',
    '[자료]에 경로가 있으면 "플랫폼에 화면이 없다" 는 말은 꺼내지도 마라 — 물어본 것이 아니다.',
    '[자료]에 없으면 "그 범위에서는 못 찾았다" 고 답한다. 화면 탓으로 돌리지 않는다.',
    // 볼트(NAS) 색인은 파일 카드다 — 이름·경로는 알지만 본문은 안 들고 있다.
    // 그걸 말 안 하면 "연봉이 얼마냐" 에 대고 엉뚱한 파일을 근거처럼 내민다.
    '사내 파일 자료는 **이름·폴더 경로**까지 안다. 파일 안의 내용(금액·숫자)은 모른다.',
    '그러니 "얼마냐" 는 물음에는 숫자를 지어내지 말고, **그 숫자가 있을 파일의 경로**를 알려 준다.',
    '  안내 예: 영수증·업무 등록 → "업무관리" · 부적합 → "NCR 관리" · 시정조치 → "CAR 관리" ·',
    '  일정 → "캘린더" · 결재 → "결재" · 검사 서류 → "ITP Builder"·"QA Doc Generator".',
    '먼저 필요한 정보를 정리해 주고(예: 금액·날짜·프로젝트), 그다음 어디에 넣으면 되는지 알려 준다.',
    '',
    `## 지금 말하는 사람`,
    `${perm.이름} (${perm.dept || '소속 미상'} ${perm.직급 || ''}) · 볼 수 있는 범위: ${perm.범위} — ${perm.설명}`,
    '이 범위 밖의 자료는 아래에 주어지지 않는다. 없는 자료를 물으면 "권한 범위 밖"이라고 답한다.',
    `오늘은 ${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}.`,
    '',
    맥락,
  ].join('\n');
}

async function 한번부르기(p, sys, 히스토리, 질문, auth) {
  const { signal, 정리 } = 시간제한();
  const url = `${게이트웨이}/v1/${p.id}/` + (p.형식 === 'gemini' ? `models/${p.model}:generateContent` : 'chat/completions');
  const body = p.형식 === 'gemini'
    ? {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [...히스토리, { role: 'user', text: 질문 }].map((m) => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: String(m.text || '') }] })),
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
    }
    : {
      model: p.model, max_tokens: 2048, temperature: 0.3,
      messages: [{ role: 'system', content: sys },
        ...히스토리.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.text || '') })),
        { role: 'user', content: 질문 }],
    };
  try {
    const r = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body) });
    정리();
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${p.id} ${r.status}: ${(j.error && (j.error.message || j.error)) || ''}`.trim());
    const text = p.형식 === 'gemini'
      ? ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('').trim()
      : String((((j.choices || [])[0] || {}).message || {}).content || '').trim();
    if (!text) throw new Error(p.id + ': 빈 응답');
    return { text, model: `${p.id}/${p.model}` };
  } finally { 정리(); }
}

/** 질문 하나 → 답 하나. 앞 회사가 실패하면 다음 회사로 넘어가고, 전부 실패하면 마지막 이유를 던진다. */
export async function 답하기({ 질문, 히스토리 = [], 맥락 = '', 권한, fb }) {
  const sys = 지침(맥락, 권한);
  const 최근 = 히스토리.slice(-12);
  const auth = await 토큰(fb);          // 게이트웨이는 회사 계정만 통과시킨다(v3.4부터 모든 제공자)
  // 실패를 **전부** 모은다. 마지막 것만 보여 주면 "cerebras 402" 한 줄만 남아서
  // 앞의 두 곳이 왜 안 됐는지(모델 폐기·지역 차단) 알 수 없다 — 부장님 첫 질문 때 실제로 그랬다.
  const 실패들 = [];
  for (const p of 체인) {
    try { return await 한번부르기(p, sys, 최근, 질문, auth); }
    catch (e) {
      const msg = (e && e.name === 'AbortError') ? `${p.id}/${p.model}: ${제한초}초 초과` : ((e && e.message) || String(e));
      실패들.push(msg);
      console.warn('[AI]', msg);
    }
  }
  throw new Error('AI가 답하지 못했습니다. 아래를 그대로 개발 담당에게 알려 주세요.\n' + 실패들.map((m) => '· ' + m).join('\n'));
}

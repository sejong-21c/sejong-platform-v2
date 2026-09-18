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

function 지침(맥락, perm) {
  return [
    '너는 세종기술(플랜트 설계·제작·시공 회사)의 사내 AI 비서다. 한국어 존댓말로 답한다.',
    '답은 짧게. 표·글머리표를 적극적으로 쓰고, 서론과 맺음말은 쓰지 않는다.',
    '모르면 모른다고 한다. 아래 자료에 없는 숫자를 지어내지 않는다.',
    '너는 저장·변경을 직접 하지 않는다. 등록·수정이 필요하면 "플랫폼에서 하세요"라고 안내한다(회사 원칙).',
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

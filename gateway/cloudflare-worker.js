/*
 * 세종플랫폼 AI 게이트웨이 — Cloudflare Worker (v1, 2026-07-19)
 *
 * 역할:
 *  1) 회사 공용 API 키를 이 서버에 숨겨두고, 직원들은 키 입력 없이 AI 비서를 사용
 *  2) 브라우저 직접 호출이 차단된 회사(NVIDIA)도 이 서버를 거쳐 사용 가능
 *  3) 회사당 키 여러 개 등록 시 한도 초과(429)·키 오류(401/403)면 자동으로 다음 키로 교대
 *
 * 요청 경로 규칙 (플랫폼 ai-assistant.js가 이 규칙으로 호출):
 *  POST /v1/gemini/models/<model>:generateContent  →  generativelanguage.googleapis.com/v1beta/...
 *  POST /v1/groq/chat/completions                  →  api.groq.com/openai/v1/...
 *  POST /v1/cerebras/chat/completions              →  api.cerebras.ai/v1/...
 *  POST /v1/nvidia/chat/completions                →  integrate.api.nvidia.com/v1/...
 *  POST /v1/openrouter/chat/completions            →  openrouter.ai/api/v1/...
 *  POST /v1/mistral/chat/completions               →  api.mistral.ai/v1/...
 *  POST /v1/claude/messages                        →  api.anthropic.com/v1/...
 *
 * 환경변수(Settings → Variables and Secrets, 전부 Secret 타입 권장):
 *  GEMINI_KEYS, GROQ_KEYS, CEREBRAS_KEYS, NVIDIA_KEYS, OPENROUTER_KEYS, MISTRAL_KEYS, CLAUDE_KEYS
 *    — 각각 키 여러 개면 쉼표(,)로 구분. 예: "AIza...aaa,AIza...bbb,AIza...ccc"
 *    — 등록 안 한 회사는 501을 돌려주고, 플랫폼이 알아서 다음 순위로 넘어간다.
 *  ALLOWED_ORIGINS (일반 변수)
 *    — 허용할 사이트 주소를 쉼표로. 예: "https://sejong21c.com,https://www.sejong21c.com"
 *    — 설정 안 하면 모든 사이트 허용(테스트용). 운영 전 반드시 설정할 것.
 *
 * 주의: 유료 키(Claude)는 남이 URL을 알아내 쓰면 돈이 나가므로,
 *       로그인 검증(Firebase 토큰)을 붙이기 전까지는 넣지 않는 것을 권장.
 */

const PROVIDERS = {
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_KEYS',
    auth: (headers, key) => { headers.set('x-goog-api-key', key); },
  },
  groq: {
    base: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_KEYS',
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
  cerebras: {
    base: 'https://api.cerebras.ai/v1',
    envKey: 'CEREBRAS_KEYS',
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
  nvidia: {
    base: 'https://integrate.api.nvidia.com/v1',
    envKey: 'NVIDIA_KEYS',
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_KEYS',
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
  mistral: {
    base: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_KEYS',
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
  claude: {
    base: 'https://api.anthropic.com/v1',
    envKey: 'CLAUDE_KEYS',
    auth: (headers, key) => {
      headers.set('x-api-key', key);
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    },
  },
};

// 키 교대 위치 기억 (워커 인스턴스가 살아있는 동안만 — 사라져도 첫 키부터 다시 돌 뿐이라 무해)
const keyCursor = {};

function corsHeaders(origin, allowed) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, anthropic-version, anthropic-dangerous-direct-browser-access, x-title',
    'Access-Control-Max-Age': '86400',
  };
  if (!allowed.length) { h['Access-Control-Allow-Origin'] = '*'; return h; }
  if (origin && allowed.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  return h;
}

function json(status, obj, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(/[\s,;]+/).filter(Boolean);
    const cors = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // 허용 목록이 설정돼 있으면, 목록에 없는 사이트의 브라우저 요청은 거부
    if (allowed.length && origin && !allowed.includes(origin)) {
      return json(403, { error: 'origin not allowed' }, cors);
    }

    // 경로: /v1/<provider>/<나머지 경로>
    const m = url.pathname.match(/^\/v1\/([a-z]+)\/(.+)$/);
    if (!m) return json(404, { error: 'usage: POST /v1/<provider>/<path>' }, cors);
    const provider = PROVIDERS[m[1]];
    if (!provider) return json(404, { error: 'unknown provider: ' + m[1] }, cors);
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);

    const keys = (env[provider.envKey] || '').split(/[\s,;]+/).filter(Boolean);
    if (!keys.length) return json(501, { error: m[1] + ' keys not configured on gateway' }, cors);

    const body = await request.text();
    const upstreamUrl = provider.base + '/' + m[2] + url.search;

    // 키 교대: 마지막으로 성공한 키부터 시작, 한도 초과/불량 키면 다음 키
    const start = (keyCursor[m[1]] || 0) % keys.length;
    let lastResp = null;
    for (let i = 0; i < keys.length; i++) {
      const idx = (start + i) % keys.length;
      const headers = new Headers({ 'Content-Type': 'application/json' });
      // Claude 호출에 필요한 헤더는 브라우저가 보낸 것을 그대로 전달
      const av = request.headers.get('anthropic-version');
      if (av) headers.set('anthropic-version', av);
      provider.auth(headers, keys[idx]);

      let resp;
      try {
        resp = await fetch(upstreamUrl, { method: 'POST', headers, body });
      } catch (e) {
        lastResp = json(502, { error: 'upstream fetch failed: ' + (e.message || e) }, cors);
        continue;
      }
      if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
        lastResp = resp; // 이 키 소진/불량 → 다음 키
        continue;
      }
      keyCursor[m[1]] = idx; // 이 키가 살아있음
      const out = new Response(resp.body, resp);
      Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }
    // 모든 키 실패 — 마지막 응답을 그대로 전달 (플랫폼이 상태코드 보고 다음 회사로 넘어감)
    if (lastResp instanceof Response && !lastResp.headers.get('Access-Control-Allow-Origin')) {
      const out = new Response(lastResp.body, lastResp);
      Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }
    return lastResp || json(502, { error: 'all keys failed' }, cors);
  },
};

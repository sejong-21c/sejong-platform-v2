/*
 * 세종플랫폼 AI 게이트웨이 — Cloudflare Worker (v2, 2026-07-26)
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
  // 9Router Proxy (OpenAI 호환). 공용 사용 시에는 상시 실행되는 9Router 서버를
  // Cloudflare Tunnel 등의 HTTPS 주소로 노출하고, 그 주소를 NINEROUTER_BASE에 넣는다.
  // (9Router의 기본 localhost:20128은 Cloudflare Worker에서 접근할 수 없다.)
  '9router': {
    envKey: 'NINEROUTER_KEYS',
    baseEnv: 'NINEROUTER_BASE',
    modelEnv: 'NINEROUTER_MODEL',
    requireCompanyAuth: true,
    auth: (headers, key) => { headers.set('Authorization', 'Bearer ' + key); },
  },
};

// 키 교대 위치 기억 (워커 인스턴스가 살아있는 동안만 — 사라져도 첫 키부터 다시 돌 뿐이라 무해)
const keyCursor = {};
const FIREBASE_CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const firebaseCertCache = { expiresAt: 0, keys: new Map() };

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function pemToBytes(pem) {
  const clean = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
  return Uint8Array.from(atob(clean), char => char.charCodeAt(0));
}

async function firebaseSigningKey(kid) {
  if (Date.now() >= firebaseCertCache.expiresAt || !firebaseCertCache.keys.has(kid)) {
    const response = await fetch(FIREBASE_CERT_URL);
    if (!response.ok) throw new Error('Firebase signing certificate lookup failed');
    firebaseCertCache.keys = new Map(Object.entries(await response.json()));
    firebaseCertCache.expiresAt = Date.now() + 60 * 60 * 1000;
  }
  const cert = firebaseCertCache.keys.get(kid);
  if (!cert) throw new Error('Unknown Firebase token key id');
  return crypto.subtle.importKey('spki', pemToBytes(cert), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// v2.1: 프로젝트 ID는 비밀값이 아니므로(플랫폼 index.html에 공개) 코드에 기본값 내장.
// 대시보드 변수(FIREBASE_PROJECT_ID)를 설정하면 그 값이 우선한다.
const DEFAULT_FIREBASE_PROJECT_ID = 'sejong-platform';

async function verifyCompanyFirebaseToken(request, env) {
  const projectId = (env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
  if (!projectId) return { status: 501, error: 'FIREBASE_PROJECT_ID not configured for 9Router access' };
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return { status: 401, error: 'Firebase login token required for 9Router access' };
  try {
    const parts = match[1].split('.');
    if (parts.length !== 3) throw new Error('Malformed Firebase token');
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Firebase token signature');
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await firebaseSigningKey(header.kid), base64UrlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    const now = Math.floor(Date.now() / 1000);
    const isCompanyEmail = typeof payload.email === 'string' && /@sejong-21c[.]com$/i.test(payload.email);
    if (!valid || payload.aud !== projectId || payload.iss !== 'https://securetoken.google.com/' + projectId || payload.exp <= now || !payload.email_verified || !isCompanyEmail) throw new Error('Firebase token is not an active company account');
    return null;
  } catch (error) {
    return { status: 401, error: 'Invalid Firebase login token: ' + (error.message || error) };
  }
}

// v2: 9Router 동적 설정 — 부장님이 플랫폼 🔑에서 '전 직원 공용 공유'한 터널 주소/키/모델
// (Firestore t_aiSharedConfig/config)을 호출한 직원의 Firebase 토큰으로 그대로 읽는다.
// → 터널 주소가 바뀌어도 Cloudflare 대시보드 수정 불필요 (플랫폼에서 공유 갱신만 하면 됨).
// Firestore 규칙상 t_* 컬렉션은 사내 계정 토큰이면 read 허용이므로 별도 서비스 계정이 필요 없다.
async function fetchSharedNineRouter(env, request) {
  try {
    const projectId = (env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
    const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!projectId || !match) return null;
    const r = await fetch(
      'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/t_aiSharedConfig/config',
      { headers: { Authorization: 'Bearer ' + match[1] } }
    );
    if (!r.ok) return null;
    const f = ((await r.json()) || {}).fields || {};
    const sv = k => (f[k] && f[k].stringValue) ? String(f[k].stringValue).trim() : '';
    const base = sv('localUrl').replace(/\/+$/, '');
    if (!base) return null;
    return { base, key: sv('localKey'), model: sv('localModel') };
  } catch (e) { return null; }
}

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
    const m = url.pathname.match(/^\/v1\/([a-z0-9]+)\/(.+)$/);
    if (!m) return json(404, { error: 'usage: POST /v1/<provider>/<path>' }, cors);
    const provider = PROVIDERS[m[1]];
    if (!provider) return json(404, { error: 'unknown provider: ' + m[1] }, cors);
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);

    if (provider.requireCompanyAuth) {
      const authError = await verifyCompanyFirebaseToken(request, env);
      if (authError) return json(authError.status, { error: authError.error }, cors);
    }

    // v2: 9router는 플랫폼에서 공유한 동적 설정(터널 주소/키/모델)을 먼저 쓰고, env를 폴백으로.
    const dyn = m[1] === '9router' ? await fetchSharedNineRouter(env, request) : null;

    let keys = (env[provider.envKey] || '').split(/[\s,;]+/).filter(Boolean);
    if (dyn && dyn.key) keys = [dyn.key];
    if (!keys.length && m[1] === '9router' && dyn) keys = ['9router'];   // 9Router 기본 키 관례
    if (!keys.length) return json(501, { error: m[1] + ' keys not configured on gateway' }, cors);

    let body = await request.text();
    let baseUrl = (provider.baseEnv ? (env[provider.baseEnv] || '') : provider.base || '').trim().replace(/\/+$/, '');
    if (dyn && dyn.base) baseUrl = dyn.base;
    if (!baseUrl) return json(501, { error: m[1] + ' base URL not configured on gateway (플랫폼 🔑에서 로컬 LLM 공용 공유를 하거나 NINEROUTER_BASE를 설정하세요)' }, cors);
    if (provider.modelEnv) {
      // v2: 모델 우선순위 — 공유 설정 > env > 클라이언트가 보낸 model 그대로 (없어도 501 내지 않음)
      const model = (dyn && dyn.model) || (env[provider.modelEnv] || '').trim();
      if (model) {
        try {
          const payload = JSON.parse(body);
          payload.model = model;
          body = JSON.stringify(payload);
        } catch (error) {
          return json(400, { error: 'invalid JSON request body for ' + m[1] }, cors);
        }
      }
    }
    const upstreamUrl = baseUrl + '/' + m[2] + url.search;

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
      if (resp.status === 429 || resp.status === 401 || resp.status === 402 || resp.status === 403) {
        lastResp = resp; // 이 키 소진/불량/플랜 미설정(402) → 다음 키
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

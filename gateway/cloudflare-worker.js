/*
 * 세종플랫폼 AI 게이트웨이 — Cloudflare Worker (v3, 2026-07-26)
 *
 * 역할:
 *  1) 회사 공용 API 키를 이 서버에 숨겨두고, 직원들은 키 입력 없이 AI 비서를 사용
 *  2) 브라우저 직접 호출이 차단된 회사(NVIDIA)도 이 서버를 거쳐 사용 가능
 *  3) 회사당 키 여러 개 등록 시 한도 초과(429)·키 오류(401/403)면 자동으로 다음 키로 교대
 *  4) v3(로드맵 8단계): 사내 문서 검색(RAG) — Vectorize(벡터 DB) + Workers AI(임베딩)
 *     POST /rag/upload  {docName, chunks:[...]}  — 문서 등록 (RAG_ADMIN_EMAILS만)
 *     POST /rag/search  {query, topK}            — 유사 대목 검색 (사내 계정 전체)
 *     필요 바인딩: AI(Workers AI), VECTORIZE(인덱스, 예: sejong-docs @1024차원 cosine)
 *     — gateway/README.md의 배포 안내 참고. 바인딩이 없으면 501을 반환한다.
 *  5) v3.1(로드맵 9단계): 능동 알림 — Cron Trigger(매일 0 0 * * * = 한국 09:00)가
 *     ① 내일 마감(D-1) 업무 ② 3일 이상 대기 결재를 찾아 메신저 'ai-alerts' 채널에
 *     SYSTEM 메시지로 알린다(검교정 알림과 동일 형태). 중복 방지는 Firestore
 *     aiNotifMarkers 마커 문서(localStorage 금지 원칙 — 2026-07-17 교훈).
 *     필요 Secret: FIREBASE_SA_KEY(서비스 계정 JSON 전체 — 규칙 우회 Admin 권한이라
 *     firestore.rules 변경 불필요). 미설정이면 cron은 조용히 아무것도 안 한다.
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

// v3: 성공 시 { email } 반환 (RAG 업로드 관리자 판별에 사용), 실패 시 { status, error }
async function verifyCompanyFirebaseToken(request, env) {
  const projectId = (env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
  if (!projectId) return { status: 501, error: 'FIREBASE_PROJECT_ID not configured for 9Router access' };
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return { status: 401, error: 'Firebase login token required' };
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
    return { email: payload.email.toLowerCase() };
  } catch (error) {
    return { status: 401, error: 'Invalid Firebase login token: ' + (error.message || error) };
  }
}

// ── v3: 사내 문서 검색(RAG) ─────────────────────────────────────
// 임베딩: Workers AI bge-m3 (다국어·1024차원). 저장/검색: Vectorize 인덱스.
const RAG_EMBED_MODEL = '@cf/baai/bge-m3';
const DEFAULT_RAG_ADMIN_EMAILS = 'cwkim@sejong-21c.com';

async function ragEmbed(env, texts) {
  const r = await env.AI.run(RAG_EMBED_MODEL, { text: texts });
  return r.data; // [[...1024], ...]
}

async function handleRag(request, env, path, cors) {
  if (!env.AI || !env.VECTORIZE) {
    return json(501, { error: 'RAG not configured — Worker에 AI·VECTORIZE 바인딩을 추가하세요 (gateway/README.md 참고)' }, cors);
  }
  const auth = await verifyCompanyFirebaseToken(request, env);
  if (auth.status) return json(auth.status, { error: auth.error }, cors);
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { error: 'invalid JSON body' }, cors); }

  if (path === 'search') {
    const query = String(body.query || '').trim();
    if (!query) return json(400, { error: 'query required' }, cors);
    const topK = Math.min(Math.max(parseInt(body.topK, 10) || 5, 1), 10);
    const [vec] = await ragEmbed(env, [query]);
    const res = await env.VECTORIZE.query(vec, { topK, returnMetadata: 'all' });
    const matches = (res.matches || []).map(m => ({
      score: Math.round((m.score || 0) * 1000) / 1000,
      docName: (m.metadata || {}).docName || '',
      chunkIndex: (m.metadata || {}).chunkIndex,
      text: (m.metadata || {}).text || '',
    }));
    return json(200, { matches }, cors);
  }

  if (path === 'upload') {
    const admins = (env.RAG_ADMIN_EMAILS || DEFAULT_RAG_ADMIN_EMAILS).toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (!admins.includes(auth.email)) return json(403, { error: '문서 등록 권한이 없습니다 (RAG_ADMIN_EMAILS에 등록된 계정만)' }, cors);
    const docName = String(body.docName || '').trim();
    const chunks = Array.isArray(body.chunks) ? body.chunks.map(c => String(c).trim()).filter(Boolean) : [];
    if (!docName || !chunks.length) return json(400, { error: 'docName과 chunks가 필요합니다' }, cors);
    if (chunks.length > 500) return json(400, { error: '청크는 최대 500개까지 (문서를 나눠 등록하세요)' }, cors);
    // 같은 문서 재등록(replace): 예전 조각이 더 길었을 수 있어 500개 id를 전부 지운다
    await env.VECTORIZE.deleteByIds(Array.from({ length: 500 }, (_, i) => docName + '::' + i));
    // Workers AI 임베딩은 한 번에 100개 제한 — 나눠서 처리
    const vectors = [];
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const embs = await ragEmbed(env, batch);
      embs.forEach((values, j) => {
        const idx = i + j;
        vectors.push({
          id: docName + '::' + idx,
          values,
          metadata: { docName, chunkIndex: idx, text: chunks[idx].slice(0, 2000) },
        });
      });
    }
    await env.VECTORIZE.upsert(vectors);
    return json(200, { ok: true, docName, chunkCount: vectors.length }, cors);
  }

  return json(404, { error: 'usage: POST /rag/search 또는 /rag/upload' }, cors);
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

// ── v3.1: 능동 알림 (Cron) — Firestore REST + 서비스 계정 ─────────
// 서비스 계정 키(FIREBASE_SA_KEY)로 액세스 토큰을 만들어 Firestore를 읽고 쓴다.
// 서비스 계정은 보안 규칙을 우회(Admin)하므로 규칙 변경이 필요 없다.
const saTokenCache = { token: '', exp: 0 };

function b64urlFromBytes(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromJson(obj) {
  return b64urlFromBytes(new TextEncoder().encode(JSON.stringify(obj)));
}
function pemKeyToBytes(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  return Uint8Array.from(atob(clean), c => c.charCodeAt(0));
}
async function saAccessToken(env) {
  if (saTokenCache.token && Date.now() < saTokenCache.exp - 60000) return saTokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlFromJson({ alg: 'RS256', typ: 'JWT' }) + '.' + b64urlFromJson({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const key = await crypto.subtle.importKey('pkcs8', pemKeyToBytes(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const jwt = unsigned + '.' + b64urlFromBytes(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });
  if (!r.ok) throw new Error('service account token failed: ' + r.status);
  const d = await r.json();
  saTokenCache.token = d.access_token;
  saTokenCache.exp = Date.now() + Math.min(d.expires_in || 3600, 3600) * 1000;
  return saTokenCache.token;
}

function fsProjectId(env) { return (env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim(); }
function fsBase(env) { return 'https://firestore.googleapis.com/v1/projects/' + fsProjectId(env) + '/databases/(default)/documents'; }
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
}
function fsParseVal(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsParseVal);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsParseVal(x)]));
  return v;
}
function fsParseDoc(doc) {
  const out = Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fsParseVal(v)]));
  out.__id = doc.name.split('/').pop();
  return out;
}
async function fsQueryEqual(env, token, collectionId, field, value, limit) {
  const r = await fetch(fsBase(env) + ':runQuery', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: fsVal(value) } },
      limit: limit || 300,
    } }),
  });
  if (!r.ok) throw new Error(collectionId + ' query failed: ' + r.status);
  return (await r.json()).filter(x => x.document).map(x => fsParseDoc(x.document));
}
async function fsListAll(env, token, collectionId, limit) {
  const r = await fetch(fsBase(env) + '/' + collectionId + '?pageSize=' + (limit || 300), {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new Error(collectionId + ' list failed: ' + r.status);
  return ((await r.json()).documents || []).map(fsParseDoc);
}
async function fsGetDoc(env, token, path) {
  const r = await fetch(fsBase(env) + '/' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(path + ' get failed: ' + r.status);
  return fsParseDoc(await r.json());
}
async function fsSetDoc(env, token, path, obj) {
  const r = await fetch(fsBase(env) + '/' + path, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsVal(v)])) }),
  });
  if (!r.ok) throw new Error(path + ' set failed: ' + r.status);
}
async function fsAddDoc(env, token, collectionId, obj) {
  const r = await fetch(fsBase(env) + '/' + collectionId, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsVal(v)])) }),
  });
  if (!r.ok) throw new Error(collectionId + ' add failed: ' + r.status);
}

async function postAlertMessage(env, token, channelId, text) {
  // 채널 문서 보장 (있으면 그대로 둠 — 통째 PATCH로 members를 지우지 않도록 GET 먼저)
  if (!(await fsGetDoc(env, token, 'channels/' + channelId))) {
    await fsSetDoc(env, token, 'channels/' + channelId, { name: '🤖 AI 알림', type: 'system', members: [] });
  }
  await fsAddDoc(env, token, 'messages', {
    channel: channelId, author: 'SYSTEM', system: true,
    text, at: new Date().toISOString(), createdAt: Date.now(),
  });
}

async function runDailyAlerts(env) {
  if (!env.FIREBASE_SA_KEY) return { skipped: 'FIREBASE_SA_KEY not set' };
  const token = await saAccessToken(env);
  const channelId = (env.ALERT_CHANNEL_ID || 'ai-alerts').trim();
  const kstNow = new Date(Date.now() + 9 * 3600e3);
  const tomorrow = new Date(kstNow.getTime() + 86400e3).toISOString().slice(0, 10);
  const users = await fsListAll(env, token, 'users');
  const nameOf = uid => { const u = users.find(x => x.__id === uid); return (u && u.name) || '(미확인)'; };
  const result = { d1: 0, stale: 0 };

  // ① 내일 마감(D-1) 업무 — due 완전일치로 조회하고 완료 여부는 코드에서 거른다(복합 인덱스 불필요)
  const d1 = (await fsQueryEqual(env, token, 'tasks', 'due', tomorrow)).filter(t => t.status !== 'done');
  const freshD1 = [];
  for (const t of d1) {
    if (!(await fsGetDoc(env, token, 'aiNotifMarkers/taskD1_' + t.__id + '_' + tomorrow))) freshD1.push(t);
  }
  if (freshD1.length) {
    const lines = freshD1.map(t => '· ' + (t.title || '(제목 없음)') + ' — 담당 ' + nameOf(t.assignee) + ', 마감 ' + t.due);
    await postAlertMessage(env, token, channelId, '🔔 내일 마감 업무 ' + freshD1.length + '건\n' + lines.join('\n'));
    for (const t of freshD1) {
      await fsSetDoc(env, token, 'aiNotifMarkers/taskD1_' + t.__id + '_' + tomorrow, { type: 'taskD1', at: Date.now() });
    }
    result.d1 = freshD1.length;
  }

  // ② 3일 이상 대기 결재 — 결재 1건당 1회만 알림 (마커에 날짜 없음)
  const pending = (await fsQueryEqual(env, token, 'approvals', 'status', 'pending'))
    .filter(a => (a.createdAt || 0) > 0 && a.createdAt < Date.now() - 3 * 86400e3);
  const freshStale = [];
  for (const a of pending) {
    if (!(await fsGetDoc(env, token, 'aiNotifMarkers/apStale_' + a.__id))) freshStale.push(a);
  }
  if (freshStale.length) {
    const lines = freshStale.map(a => {
      const days = Math.floor((Date.now() - a.createdAt) / 86400e3);
      return '· ' + (a.title || '(제목 없음)') + ' — 기안 ' + nameOf(a.author) + ', ' + days + '일째 대기';
    });
    await postAlertMessage(env, token, channelId, '⏳ 3일 이상 대기 중인 결재 ' + freshStale.length + '건\n' + lines.join('\n'));
    for (const a of freshStale) {
      await fsSetDoc(env, token, 'aiNotifMarkers/apStale_' + a.__id, { type: 'apStale', at: Date.now() });
    }
    result.stale = freshStale.length;
  }
  return result;
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
  // v3.1: Cron Trigger(대시보드 Settings → Triggers → Cron, 예: "0 0 * * *" = 한국 09:00)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyAlerts(env).catch(e => console.error('[ai-alerts]', e && e.message)));
  },
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

    // v3.1: 능동 알림 수동 실행(테스트용) — 관리자 계정으로 POST /cron/run
    if (url.pathname === '/cron/run') {
      if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);
      const auth = await verifyCompanyFirebaseToken(request, env);
      if (auth.status) return json(auth.status, { error: auth.error }, cors);
      const admins = (env.RAG_ADMIN_EMAILS || DEFAULT_RAG_ADMIN_EMAILS).toLowerCase().split(/[\s,;]+/).filter(Boolean);
      if (!admins.includes(auth.email)) return json(403, { error: '관리자만 실행할 수 있습니다' }, cors);
      try { return json(200, await runDailyAlerts(env), cors); }
      catch (e) { return json(500, { error: '알림 실행 실패: ' + (e.message || e) }, cors); }
    }

    // v3: 사내 문서 검색(RAG) — /rag/search, /rag/upload
    const ragMatch = url.pathname.match(/^\/rag\/([a-z]+)$/);
    if (ragMatch) {
      if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);
      try { return await handleRag(request, env, ragMatch[1], cors); }
      catch (e) { return json(500, { error: 'RAG 처리 실패: ' + (e.message || e) }, cors); }
    }

    // 경로: /v1/<provider>/<나머지 경로>
    const m = url.pathname.match(/^\/v1\/([a-z0-9]+)\/(.+)$/);
    if (!m) return json(404, { error: 'usage: POST /v1/<provider>/<path>' }, cors);
    const provider = PROVIDERS[m[1]];
    if (!provider) return json(404, { error: 'unknown provider: ' + m[1] }, cors);
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);

    if (provider.requireCompanyAuth) {
      const auth = await verifyCompanyFirebaseToken(request, env);
      if (auth.status) return json(auth.status, { error: auth.error }, cors);
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

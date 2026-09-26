// 워커 v3.1 심층 검증 — 실제 배포 없이 RAG·크론 알림 로직을 끝까지 돌려본다.
// 실행: node gateway/worker-test.mjs  (Node 22+ 권장, 외부 통신 없음 — 전부 로컬 모의)
// 실제와 같은 것: RS256 서명 JWT 검증, Firestore REST 요청/응답 형식, 임베딩 배치, 코사인 검색
// 모의인 것: Google 인증서 서버, OAuth 토큰 서버, Firestore 저장소, Vectorize, Workers AI
import { webcrypto as wc } from 'node:crypto';
import worker from './cloudflare-worker.js';

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
}

// ── 1. 가짜 Firebase 토큰 (진짜 RS256 서명) ─────────────────────
const keyPair = await wc.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const b64 = bytes => Buffer.from(bytes).toString('base64');
// v3.2.2: 워커가 Google JWK로 토큰을 검증 — 테스트 공개키도 JWK로 노출한다
const pubJwk = { ...(await wc.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'testkid', alg: 'RS256', use: 'sig' };
const b64url = bytes => Buffer.from(bytes).toString('base64url');
async function makeToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'testkid', typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify({
    aud: 'sejong-platform', iss: 'https://securetoken.google.com/sejong-platform',
    iat: now - 10, exp: now + 3600, email, email_verified: true, sub: 'u_' + email,
  })));
  const sig = new Uint8Array(await wc.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(header + '.' + payload)));
  return header + '.' + payload + '.' + b64url(sig);
}
const adminToken = await makeToken('cwkim@sejong-21c.com');
const staffToken = await makeToken('staff@sejong-21c.com');
const outsiderToken = await makeToken('evil@gmail.com');

// 서비스 계정 키 (크론용) — 같은 키쌍의 pkcs8을 사용
const pkcs8 = new Uint8Array(await wc.subtle.exportKey('pkcs8', keyPair.privateKey));
const saPem = '-----BEGIN PRIVATE KEY-----\n' + b64(pkcs8).match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const SA_KEY = JSON.stringify({ client_email: 'sa@sejong-platform.iam.gserviceaccount.com', private_key: saPem });

// ── 2. 모의 Firestore + Google 인증 서버 (fetch 가로채기) ────────
const tomorrow = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10);
const fsStore = { // path → fields(REST 형식). 시드: 업무 3건 + 결재 3건 + 사용자 2명
  'users/u1': { name: { stringValue: '김철수' } },
  // v4.0 범위 시험용 — 토큰의 sub 가 'u_' + 이메일이라 문서 id 가 이렇게 된다
  'users/u_staff@sejong-21c.com': { name: { stringValue: '생산부원' }, dept: { stringValue: '생산부' }, grade: { stringValue: 'member' } },
  'users/u_cwkim@sejong-21c.com': { name: { stringValue: '김철우' }, dept: { stringValue: '품질관리부' }, grade: { stringValue: 'super' } },
  'users/u2': { name: { stringValue: '박영희' } },
  'tasks/t1': { title: { stringValue: '내일 마감·미완료' }, assignee: { stringValue: 'u1' }, due: { stringValue: tomorrow }, status: { stringValue: 'open' } },
  'tasks/t2': { title: { stringValue: '내일 마감·이미 완료' }, assignee: { stringValue: 'u1' }, due: { stringValue: tomorrow }, status: { stringValue: 'done' } },
  'tasks/t3': { title: { stringValue: '다른 날 마감' }, assignee: { stringValue: 'u2' }, due: { stringValue: '2026-09-01' }, status: { stringValue: 'open' } },
  'approvals/a1': { title: { stringValue: '5일 대기 기안' }, author: { stringValue: 'u2' }, status: { stringValue: 'pending' }, createdAt: { integerValue: String(Date.now() - 5 * 86400e3) } },
  'approvals/a2': { title: { stringValue: '1일 대기 기안' }, author: { stringValue: 'u1' }, status: { stringValue: 'pending' }, createdAt: { integerValue: String(Date.now() - 1 * 86400e3) } },
  'approvals/a3': { title: { stringValue: '승인 완료 기안' }, author: { stringValue: 'u1' }, status: { stringValue: 'approved' }, createdAt: { integerValue: String(Date.now() - 9 * 86400e3) } },
};
const postedMessages = [];
const FS = 'https://firestore.googleapis.com/v1/projects/sejong-platform/databases/(default)/documents';

let 맥응답 = null;   // 맥(파이스) 검색 모의 응답. 시험마다 갈아 끼운다
let 맥에보낸몸 = null; // v5.1: 맥에 보낸 몸(범위에 사람:<이름> 이 실리는지 본다)
let 커밋고장 = false; // v3.9: 장부가 죽은 날을 흉내낸다 — 그래도 AI 는 돌아야 한다
let 부른모델 = [];    // 제공자에게 실제로 나간 호출. 한도에 걸리면 **비어 있어야** 한다
let 부른열쇠 = [];    // v4.1: 그때 **어떤 열쇠**로 나갔나 — 회사 것인지 본인 것인지
let 장부고장 = false; // v4.9: 하루 읽기 한도가 찬 날 — 장부(readDaily)부터 429
let 목록한도 = null;  // v4.9: 이 컬렉션 목록을 받다 429 가 난다(백업 도중 한도가 차는 날)
let 읽기고장 = false; // v4.1: Firestore 읽기 한도가 찬 날(429) 을 흉내낸다
let 사용자읽기고장 = false; // v5.4: users 문서 읽기가 429 인 날 — 경비 파일 문지기는 좁은 쪽으로 가야 한다
let 커밋던짐 = false; // v5.3: Firestore 로 가는 fetch 자체가 던지는 날(서비스 계정 토큰 실패도 같은 길)
let 제공자답 = null;  // v5.3: null 이면 200+usage. {status:413} 이면 그 상태, {sse:true} 면 SSE 로 답한다
let 제공자차례 = [];  // v5.4: 호출마다 앞에서 하나씩 꺼내 제공자답 대신 쓴다 — {status, message, headers}. 비면 제공자답
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init && init.method) || 'GET';
  let body = null;
  if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) {} } // OAuth 본문은 폼 형식 — JSON 아님
  if (url.includes('googleapis.com/service_accounts/v1/jwk/')) {
    return Response.json({ keys: [pubJwk] });
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return Response.json({ access_token: 'fake-sa-token', expires_in: 3600 });
  }
  // 맥(파이스) /api/rag/search 모의 — 맥응답 이 null 이면 꺼진 셈 친다
  if (url.startsWith('https://api.groq.com/')) {   // v3.9: 제공자 모의
    const 열 = (init?.headers && (init.headers.get ? init.headers.get('Authorization') : init.headers.Authorization)) || '';
    부른열쇠.push(String(열).replace(/^Bearer /, ''));
    if (url.endsWith('/models')) return Response.json({ data: [] });   // v4.1: 열쇠 등록 때 한 번 불러 본다
    부른모델.push(url);
    // v5.3: 진짜 제공자처럼 usage 를 준다. 제공자답 으로 상태(413 등)·SSE 를 흉내낸다
    const 차례 = 제공자차례.length ? 제공자차례.shift() : 제공자답;
    if (차례 && 차례.status) return Response.json({ error: { message: 차례.message || ('mock ' + 차례.status) } }, { status: 차례.status, headers: 차례.headers || {} });
    if (제공자답 && 제공자답.긴sse) {   // 9/26 검토: 조각 수천 개(≈ 1MB) — 조각마다 꼬리를 다시 복사하면 CPU 가 제곱으로 는다
      const 조각 = 'data: {"choices":[{"delta":{"reasoning":"' + '생각'.repeat(40) + '","content":"네"}}]}\n\n';
      let k = 0;
      const 흐름 = new ReadableStream({ pull(c) {
        if (k < 제공자답.긴sse) { c.enqueue(new TextEncoder().encode(조각)); k++; return; }
        c.enqueue(new TextEncoder().encode('data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":900,"completion_tokens":4000}}}\n\ndata: [DONE]\n\n'));
        c.close();
      } });
      return new Response(흐름, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (제공자답 && 제공자답.sse) {
      return new Response('data: {"choices":[{"delta":{"content":"네"}}]}\n\n'
        + 'data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":40,"completion_tokens":7}}}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return Response.json({ choices: [{ message: { content: '네' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
  }
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {   // v5.3: gemini 모의 — 모델이 주소에, 토큰은 usageMetadata
    if (!url.includes(':generateContent')) return Response.json({ models: [] });
    return Response.json({ candidates: [{ content: { parts: [{ text: '네' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 2 } });
  }
  if (url.startsWith('https://pais.test/')) {
    try { 맥에보낸몸 = JSON.parse(init && init.body || '{}'); } catch (e) { 맥에보낸몸 = null; }   // v5.1: 사람:<이름> 확인용
    if (!맥응답) return new Response('down', { status: 500 });
    return Response.json(맥응답);
  }
  if (url.startsWith(FS)) {
    // 진짜 Firestore 는 경로를 **디코드**한다. 모의가 안 하면 encodeURIComponent 를 쓰는
    // 정상 코드가 여기서만 404 를 맞는다(2026-09-20: users/u_a%40b.com 을 못 찾아 범위 시험이 죽었다).
    const rest = decodeURIComponent(url.slice(FS.length));
    if (rest === ':listCollectionIds') { // v3.2 백업: 루트 컬렉션 동적 열거
      const ids = [...new Set(Object.keys(fsStore).map(p => p.split('/')[0]))];
      return Response.json({ collectionIds: ids });
    }
    // v3.9 장부: update + updateTransforms(increment) 를 한 write 로 보낸다.
    //   **진짜 Firestore 처럼 늘어난 값을 돌려준다** — 워커가 그 값으로 한도를 보므로
    //   여기서 대충 {} 를 주면 한도 시험이 통째로 헛돈다.
    if (rest === ':commit') {
      if (커밋고장) return new Response('boom', { status: 503 });
      if (커밋던짐) throw new TypeError('network connection lost');   // 9/26: 응답이 아니라 **예외** — 잡는 곳이 없으면 1101
      // v5.3: 진짜처럼 **필드 경로를 검사한다.** 조각이 영문·숫자·밑줄(숫자로 시작 안 함)이 아니면 400.
      //   전에는 아무 경로나 받아 줘서 c.9router 같은 틀린 경로가 시험을 통과했을 것이다 — 실전에선
      //   commit 이 죽고 → 장부 null → "못 세면 막지 않는다" → 하루 한도가 조용히 꺼진다.
      const 틀린칸 = (body.writes || []).flatMap((w) => [...((w.updateMask || {}).fieldPaths || []), ...(w.updateTransforms || []).map((t) => t.fieldPath)])
        .find((f) => !f.split('.').every((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)));
      if (틀린칸) return Response.json({ error: { message: 'invalid field path: ' + 틀린칸 } }, { status: 400 });
      const 결과 = [];
      for (const w of (body.writes || [])) {
        const p = w.update.name.split('/documents/')[1];
        fsStore[p] = { ...(fsStore[p] || {}), ...w.update.fields };
        const t = [];
        for (const tr of (w.updateTransforms || [])) {
          const 있던 = fsStore[p][tr.fieldPath];
          const 이전 = Number((있던 || {}).integerValue || 0);
          const 새 = tr.minimum   // v4.9: 한도 표시는 minimum — 처음 찬 시각이 남는다(없으면 그 값)
            ? (있던 ? Math.min(이전, Number(tr.minimum.integerValue)) : Number(tr.minimum.integerValue))
            : 이전 + Number(tr.increment.integerValue);
          fsStore[p][tr.fieldPath] = { integerValue: String(새) };
          t.push({ integerValue: String(새) });
        }
        결과.push({ transformResults: t });
      }
      return Response.json({ writeResults: 결과 });
    }
    // v4.3 백업은 **읽기 전에 센다.** 모의가 이걸 안 주면 '못 셌다' 길로만 가서
    //   정작 지키려는 길(큰 컬렉션 건너뛰기)이 한 번도 안 돌아간다.
    if (rest === ':runAggregationQuery') {
      const coll = body.structuredAggregationQuery.structuredQuery.from[0].collectionId;
      const n = Object.keys(fsStore).filter(p => p.startsWith(coll + '/')).length;
      return Response.json([{ result: { aggregateFields: { n: { integerValue: String(n) } } } }]);
    }
    if (rest === ':runQuery') {
      const sq = body.structuredQuery;
      const coll = sq.from[0].collectionId;
      const f = sq.where.fieldFilter;
      const want = f.value.stringValue;
      const docs = Object.entries(fsStore)
        .filter(([p]) => p.startsWith(coll + '/'))
        .filter(([, fields]) => fields[f.field.fieldPath] && fields[f.field.fieldPath].stringValue === want)
        .map(([p, fields]) => ({ document: { name: 'projects/x/databases/(default)/documents/' + p, fields } }));
      return Response.json(docs.length ? docs : [{ readTime: 'x' }]);
    }
    const path = rest.replace(/^\//, '').split('?')[0];
    if (method === 'GET' && path.indexOf('/') === -1) { // 컬렉션 목록
      if (목록한도 === path) return new Response('quota', { status: 429 });
      const documents = Object.entries(fsStore)
        .filter(([p]) => p.startsWith(path + '/'))
        .map(([p, fields]) => ({ name: 'projects/x/databases/(default)/documents/' + p, fields }));
      return Response.json({ documents });
    }
    if (method === 'GET') {
      if (읽기고장 && path.startsWith('aiUserKeys/')) return new Response('quota', { status: 429 });
      if (사용자읽기고장 && path.startsWith('users/')) return new Response('quota', { status: 429 });
      if (장부고장 && path.startsWith('readDaily/')) return new Response('quota', { status: 429 });
      if (!fsStore[path]) return new Response('{}', { status: 404 });
      return Response.json({ name: 'projects/x/databases/(default)/documents/' + path, fields: fsStore[path] });
    }
    if (method === 'PATCH') { fsStore[path] = body.fields; return Response.json({ name: path }); }
    if (method === 'DELETE') { delete fsStore[path]; return Response.json({}); }   // v4.1: /key/del
    if (method === 'POST') { // 자동 id 생성
      const id = 'auto' + (postedMessages.length + 1);
      fsStore[path + '/' + id] = body.fields;
      if (path === 'messages') postedMessages.push(body.fields);
      return Response.json({ name: path + '/' + id });
    }
  }
  return realFetch(input, init);
};

// ── 3. 모의 Workers AI + Vectorize ──────────────────────────────
// 임베딩: 글자 2-그램 해시 빈도 벡터(1024차원) — 겹치는 단어가 많을수록 코사인이 높아져
// "유사도 검색이 관련 청크를 위로 올리는지"를 실제처럼 판정할 수 있다.
function fakeEmbed(text) {
  const v = new Array(1024).fill(0);
  const s = String(text);
  for (let i = 0; i < s.length - 1; i++) {
    let h = (s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) % 1024;
    v[h] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map(x => x / norm);
}
const vecStore = new Map();
const env = {
  FIREBASE_SA_KEY: SA_KEY,
  AI: { run: async (model, { text }) => ({ data: text.map(fakeEmbed) }) },
  VECTORIZE: {
    // 실제 Vectorize의 배치 제한을 그대로 재현 — 넘기면 워커 코드가 실전에서 죽는다
    upsert: async vectors => {
      if (vectors.length > 1000) throw new Error('VECTOR_UPSERT_ERROR: max batch is 1000, got ' + vectors.length);
      vectors.forEach(v => vecStore.set(v.id, v));
    },
    deleteByIds: async ids => {
      if (ids.length > 100) throw new Error('VECTOR_DELETE_ERROR (code = 40007): too many ids in payload; max id count is 100, got ' + ids.length);
      ids.forEach(id => vecStore.delete(id));
    },
    // v3.4: 색인 상태 조회용. 실제 Vectorize도 없는 id는 결과에서 그냥 빠지고, 한도는 100.
    getByIds: async ids => {
      if (ids.length > 100) throw new Error('VECTOR_QUERY_ERROR: max id count is 100, got ' + ids.length);
      return ids.map(id => vecStore.get(id)).filter(Boolean);
    },
    query: async (vec, { topK }) => {
      const scored = [...vecStore.values()].map(v => ({
        id: v.id, metadata: v.metadata,
        score: v.values.reduce((a, x, i) => a + x * vec[i], 0),
      })).sort((a, b) => b.score - a.score).slice(0, topK);
      return { matches: scored };
    },
  },
};

const post = (path, token, obj) => worker.fetch(new Request('https://gw.test' + path, {
  method: 'POST',
  headers: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj || {}),
}), env);

// ── 3.5 CORS 프리플라이트 (v3.2.1) ──────────────────────────────
{
  const r = await worker.fetch(new Request('https://gw.test/rag/upload', {
    method: 'OPTIONS',
    headers: { Origin: 'https://sejong21c.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  }), env);
  const allow = r.headers.get('Access-Control-Allow-Headers') || '';
  check('CORS 프리플라이트: 204 + Authorization 헤더 허용', r.status === 204 && /authorization/i.test(allow), 'status=' + r.status + ' allow=' + allow);
}

// ── 4. RAG 시나리오 ─────────────────────────────────────────────
{
  const r = await post('/rag/upload', null, { docName: 'X', chunks: ['a'] });
  check('RAG 업로드: 비로그인 → 401', r.status === 401);
}
{
  const r = await post('/rag/upload', outsiderToken, { docName: 'X', chunks: ['a'] });
  check('RAG 업로드: 외부 gmail 계정 → 401', r.status === 401);
}
{
  const r = await post('/rag/upload', staffToken, { docName: 'X', chunks: ['a'] });
  check('RAG 업로드: 사내 일반직원 → 403 (관리자 아님)', r.status === 403);
}
{
  const chunks = [
    '용접 검사는 육안검사와 비파괴검사로 나뉜다. 육안검사는 용접부 표면 결함을 확인한다.',
    '수압시험은 설계압력의 1.3배로 실시하며 유지시간은 최소 10분이다.',
    '도장 검사는 표면처리 등급 Sa 2.5 확인 후 도막 두께를 측정한다.',
  ];
  const r = await post('/rag/upload', adminToken, { docName: '검사절차서', chunks });
  const d = await r.json();
  check('RAG 업로드: 관리자 → 200, 3조각 저장', r.status === 200 && d.chunkCount === 3, JSON.stringify(d));
  check('RAG 저장소: id 규칙(docName::i)', vecStore.has('검사절차서::0') && vecStore.has('검사절차서::2'));
}
{
  const r = await post('/rag/search', staffToken, { query: '용접 육안검사 결함 확인' });
  const d = await r.json();
  const top = d.matches && d.matches[0];
  check('RAG 검색: 일반직원 가능, 관련 청크(용접)가 1위', top && top.text.includes('용접'), JSON.stringify(top && { doc: top.docName, i: top.chunkIndex, score: top.score }));
  check('RAG 검색: 출처 메타데이터(docName) 보존', top && top.docName === '검사절차서');
}
{
  const r = await post('/rag/upload', adminToken, { docName: '검사절차서', chunks: ['수정된 문서 — 조각 하나뿐'] });
  await r.json();
  check('RAG 재등록: 예전 조각 삭제(교체)', !vecStore.has('검사절차서::1') && !vecStore.has('검사절차서::2') && vecStore.has('검사절차서::0'));
}
// ── v4.0: 검색 범위(권한) ───────────────────────────────────────────────────
// 2026-09-20 까지 AI 비서는 색인 전체를 봤다. 막던 것은 프롬프트 한 줄뿐이었다.
// 여기서 막히는지 **실제 요청으로** 확인한다. 뚫리면 남의 부서 자료가 답변 근거로 나간다.
{
  const 같은글 = '개스킷 규격 오적용 누설';                     // 셋 다 같은 내용 — 범위만 다르다
  const emb = fakeEmbed(같은글);
  vecStore.set('범위시험_전사::0',   { id: '범위시험_전사::0',   values: emb, metadata: { docName: '전사문서',   chunkIndex: 0, text: 같은글 } });               // 범위 없음 = 전사
  vecStore.set('범위시험_품질::0',   { id: '범위시험_품질::0',   values: emb, metadata: { docName: '품질부문서', chunkIndex: 0, text: 같은글, 범위: '부서:품질관리부' } });
  vecStore.set('범위시험_생산::0',   { id: '범위시험_생산::0',   values: emb, metadata: { docName: '생산부문서', chunkIndex: 0, text: 같은글, 범위: '부서:생산부' } });
  vecStore.set('범위시험_비밀::0',   { id: '범위시험_비밀::0',   values: emb, metadata: { docName: '반출금지도면', chunkIndex: 0, text: 같은글, 범위: '비밀' } });

  const r = await post('/rag/search', staffToken, { query: 같은글, topK: 10 });
  const d = await r.json();
  const 문서들 = (d.matches || []).map(m => m.docName);
  check('범위: 남의 부서(품질) 자료가 생산부원에게 안 나온다', !문서들.includes('품질부문서'), 문서들.join(','));
  check('범위: 내 부서(생산) 자료는 나온다', 문서들.includes('생산부문서'), 문서들.join(','));
  check('범위: 전사 자료는 나온다', 문서들.includes('전사문서'), 문서들.join(','));
  check('범위: 비밀은 누구에게도 안 나온다', !문서들.includes('반출금지도면'), 문서들.join(','));

  // 클라이언트가 범위를 스스로 넓히려 해도 안 먹혀야 한다 — 토큰에서만 뽑기 때문이다
  const r2 = await post('/rag/search', staffToken, { query: 같은글, topK: 10, 범위: ['전사', '부서:품질관리부', '비밀'] });
  const d2 = await r2.json();
  const 문서들2 = (d2.matches || []).map(m => m.docName);
  check('범위: body 로 범위를 넣어도 안 넓어진다(토큰이 진실)',
    !문서들2.includes('품질부문서') && !문서들2.includes('반출금지도면'), 문서들2.join(','));

  const r3 = await post('/rag/search', adminToken, { query: 같은글, topK: 10 });
  const 문서들3 = ((await r3.json()).matches || []).map(m => m.docName);
  check('범위: 품질관리부 사람에게는 품질 자료가 나온다', 문서들3.includes('품질부문서'), 문서들3.join(','));
  // 2026-09-21 부장님: "자료는 전부서 다 볼 수 있는 걸로." super(부장님·대표이사)만 해당한다.
  // 메신저 방 커튼은 여전히 부서로만 판단하므로 남의 부서 **대화**는 못 본다 — 자료와 대화는 다르다.
  check('범위: super 는 남의 부서 자료도 본다(2026-09-21 지시)', 문서들3.includes('생산부문서'), 문서들3.join(','));
  check('범위: super 라도 비밀은 안 나온다', !문서들3.includes('반출금지도면'), 문서들3.join(','));
  // exec(임원)은 안 넓힌다 — 2026-09-19 지시가 그대로 살아 있다
  vecStore.set('범위시험_전사2::0', { id: '범위시험_전사2::0', values: fakeEmbed('개스킷 규격 오적용 누설'), metadata: { docName: '전사문서2', chunkIndex: 0, text: '개스킷 규격 오적용 누설' } });

  ['범위시험_전사::0', '범위시험_품질::0', '범위시험_생산::0', '범위시험_비밀::0'].forEach(id => vecStore.delete(id));
}
{
  const r = await post('/rag/upload', adminToken, { docName: 'Y', chunks: Array(501).fill('x') });
  check('RAG 업로드: 501조각 → 400 거부', r.status === 400);
}
{
  // v3.2.4: 재등록 중 임베딩이 실패해도 기존 문서가 증발하지 않아야 한다 (임베딩→삭제→업서트 순서)
  const before = vecStore.has('검사절차서::0');
  const origRun = env.AI.run;
  env.AI.run = async () => { throw new Error('임베딩 일시 실패'); };
  const r = await post('/rag/upload', adminToken, { docName: '검사절차서', chunks: ['새 내용'] });
  env.AI.run = origRun;
  check('RAG 재등록: 임베딩 실패 시 기존 조각 보존 (500 + 생존)', r.status === 500 && before && vecStore.has('검사절차서::0'), 'status=' + r.status);
}

// ── 4.5 기록 자동 색인(v3.3 · 로드맵 9-1) 시나리오 ──────────────
const PARA = String.fromCharCode(10, 10);   // 문단 구분 (소스에 이스케이프를 안 쓰기 위해)
const autoKeys = pre => [...vecStore.keys()].filter(k => k.startsWith(pre));
{
  const r = await post('/rag/record', staffToken, {
    kind: 'ncr', id: 'SJ-NCR-2026-01', title: '펌프 부적합',
    text: '토출측 플랜지 누설 확인. 원인은 개스킷 규격 오적용.' + PARA + '조치: 개스킷 교체 후 재수압시험 통과.',
  });
  const b = await r.json();
  check('자동색인: 일반 직원도 기록 색인 가능 (관리자 아님)', r.status === 200 && b.ok, 'status=' + r.status + ' ' + JSON.stringify(b).slice(0, 90));
  check('자동색인: 벡터가 auto: 네임스페이스에 저장', vecStore.has('auto:ncr:SJ-NCR-2026-01::0'), autoKeys('auto:').join(','));
  check('자동색인: docName에 [자동] 접두 (수동 문서와 구분)', (b.docName || '').startsWith('[자동] NCR SJ-NCR-2026-01'), b.docName);
}
{
  const r = await post('/rag/search', staffToken, { query: '개스킷 규격 오적용 누설', topK: 5 });
  const b = await r.json();
  const hit = (b.matches || []).find(m => m.recId === 'SJ-NCR-2026-01');
  check('자동색인: 검색으로 찾아짐', !!hit, JSON.stringify((b.matches || []).map(m => m.docName)).slice(0, 120));
  check('자동색인: kind·recId 반환 (근거 링크용)', hit && hit.kind === 'ncr' && hit.recId === 'SJ-NCR-2026-01');
}
{
  // 재저장(수정) — 조각 수가 줄어도 옛 조각이 남지 않아야 한다
  const long = Array(120).fill('가나다라마바사아자차').join(PARA);
  await post('/rag/record', staffToken, { kind: 'ncr', id: 'SJ-NCR-2026-01', title: 'x', text: long });
  const many = autoKeys('auto:ncr:SJ-NCR-2026-01::').length;
  await post('/rag/record', staffToken, { kind: 'ncr', id: 'SJ-NCR-2026-01', title: '짧게', text: '한 줄로 요약' });
  const few = autoKeys('auto:ncr:SJ-NCR-2026-01::').length;
  check('자동색인: 재저장 시 옛 조각 잔류 없음', many > 1 && few === 1, 'many=' + many + ' few=' + few);
}
{
  const r = await post('/rag/record', staffToken, { kind: 'ncr', id: 'SJ-NCR-2026-01', remove: true });
  check('자동색인: 삭제 요청으로 벡터 제거 (지워진 NCR 근거 방지)', r.status === 200 && autoKeys('auto:ncr:SJ-NCR-2026-01::').length === 0);
}
{
  const r = await post('/rag/record', staffToken, { kind: 'hack', id: 'x', text: 'y' });
  check('자동색인: 허용 안 된 kind 거부', r.status === 400);
}
{
  // 수동 등록 절차서를 자동 색인으로 덮어쓰려는 시도 — 네임스페이스가 달라 침범 불가
  const survived = vecStore.has('검사절차서::0');
  await post('/rag/record', staffToken, { kind: 'ncr', id: '검사절차서', text: '악의적 덮어쓰기' });
  check('자동색인: 수동 등록 문서 침범 불가', survived && vecStore.has('검사절차서::0'));
}
{
  const r = await post('/rag/record', outsiderToken, { kind: 'ncr', id: 'z', text: 'z' });
  check('자동색인: 사외 계정 거부', r.status === 401);
}
{
  const r = await post('/rag/record', staffToken, { kind: 'ncr', id: 'big', text: 'x'.repeat(20001) });
  check('자동색인: 20,000자 초과 거부', r.status === 400);
}
{
  // 긴 본문이라도 벡터 20개 상한 (남용 방지 + deleteByIds 100개 제한 안전)
  await post('/rag/record', staffToken, { kind: 'meeting', id: 'M-1', text: Array(200).fill('회의문단내용').join(PARA) });
  const n = autoKeys('auto:meeting:M-1::').length;
  check('자동색인: 벡터 20개 상한', n <= 20 && n > 0, 'n=' + n);
}
{
  // 임베딩 실패 시 기존 색인 보존 (upload와 동일한 순서 규칙)
  await post('/rag/record', staffToken, { kind: 'car', id: 'C-9', text: '원본 유지되어야 함' });
  const before = vecStore.has('auto:car:C-9::0');
  const orig = env.AI.run;
  env.AI.run = async () => { throw new Error('임베딩 실패'); };
  const r = await post('/rag/record', staffToken, { kind: 'car', id: 'C-9', text: '새 내용' });
  env.AI.run = orig;
  check('자동색인: 임베딩 실패 시 기존 벡터 보존', r.status === 500 && before && vecStore.has('auto:car:C-9::0'), 'status=' + r.status);
}

// ── 4.6 색인 상태 조회 (v3.4 / 로드맵 9-1d) ─────────────────────
// 관리 탭의 '누락분 일괄 재색인'이 이 결과만 믿고 동작한다 — 여기서 틀리면
// 이미 학습된 걸 또 학습하거나(비용), 누락분을 놓친다(AI가 모름).
{
  await post('/rag/record', staffToken, { kind: 'ncr', id: 'ST-1', text: '색인된 부적합' });
  await post('/rag/record', staffToken, { kind: 'ncr', id: 'ST-2', text: '색인된 부적합 2' });
  const r = await post('/rag/record-status', staffToken, { kind: 'ncr', ids: ['ST-1', 'ST-2', 'ST-없음'] });
  const d = await r.json();
  check('색인상태: 색인된 것/누락된 것을 정확히 가른다',
    r.status === 200 && !!d.indexed['ST-1'] && !!d.indexed['ST-2']
    && d.missing.length === 1 && d.missing[0] === 'ST-없음',
    JSON.stringify(d));
}
{
  // 색인 시각(at)을 함께 줘야 관리 탭에서 '언제 학습했는지'를 보여줄 수 있다
  const r = await post('/rag/record-status', staffToken, { kind: 'ncr', ids: ['ST-1'] });
  const d = await r.json();
  check('색인상태: 색인 시각(at)을 함께 반환', typeof d.indexed['ST-1'] === 'string' && /^\d{4}-/.test(d.indexed['ST-1']), JSON.stringify(d.indexed));
}
{
  // remove 후에는 missing으로 떨어져야 한다 — 안 그러면 삭제된 기록이 계속 '학습됨'으로 보인다
  await post('/rag/record', staffToken, { kind: 'ncr', id: 'ST-1', remove: true });
  const d = await (await post('/rag/record-status', staffToken, { kind: 'ncr', ids: ['ST-1'] })).json();
  check('색인상태: 삭제된 기록은 누락으로 보고', d.missing.includes('ST-1') && !d.indexed['ST-1'], JSON.stringify(d));
}
{
  // 정규화되는 id(공백·특수문자)도 원본 키로 되돌려줘야 클라이언트가 매칭할 수 있다
  await post('/rag/record', staffToken, { kind: 'car', id: 'CAR 2026/001', text: '정규화 대상' });
  const d = await (await post('/rag/record-status', staffToken, { kind: 'car', ids: ['CAR 2026/001'] })).json();
  check('색인상태: 정규화된 id를 원본 키로 반환', !!d.indexed['CAR 2026/001'], JSON.stringify(d));
}
{
  // Vectorize getByIds 한도(100) — 넘겨도 예외가 아니라 잘라서 처리해야 한다
  const many = Array.from({ length: 150 }, (_, i) => 'BULK-' + i);
  const r = await post('/rag/record-status', staffToken, { kind: 'ncr', ids: many });
  const d = await r.json();
  check('색인상태: 100건 초과는 잘라서 처리(예외 없음)', r.status === 200 && d.checked === 100, 'status=' + r.status + ' checked=' + d.checked);
}
{
  const r1 = await post('/rag/record-status', staffToken, { kind: 'bogus', ids: ['A'] });
  const r2 = await post('/rag/record-status', staffToken, { kind: 'ncr', ids: [] });
  const r3 = await post('/rag/record-status', null, { kind: 'ncr', ids: ['A'] });
  check('색인상태: 잘못된 kind·빈 ids 거부 · 외부인 401',
    r1.status === 400 && r2.status === 400 && r3.status === 401,
    [r1.status, r2.status, r3.status].join('/'));
}

// ── 5. 크론 알림 시나리오 ───────────────────────────────────────
{
  // v3.2부터 scheduled가 waitUntil을 여러 번(알림+백업) 호출 — 전부 기다려야 경합이 없다
  const ps = []; await worker.scheduled({}, env, { waitUntil: x => ps.push(x) });
  await Promise.all(ps.map(p => p.catch(() => {})));
  check('크론 1회차: 메시지 2건(D-1 업무 1건 + 지연 결재 1건)', postedMessages.length === 2, postedMessages.map(m => (m.text || {}).stringValue && m.text.stringValue.split('\n')[0]).join(' | '));
  const d1Msg = postedMessages.find(m => m.text.stringValue.includes('내일 마감'));
  const stMsg = postedMessages.find(m => m.text.stringValue.includes('대기 중인 결재'));
  check('D-1 메시지: 미완료 업무만 포함(완료·다른날 제외)', d1Msg && d1Msg.text.stringValue.includes('내일 마감·미완료') && !d1Msg.text.stringValue.includes('이미 완료'), d1Msg && d1Msg.text.stringValue);
  check('D-1 메시지: 담당자 이름 치환(김철수)', d1Msg && d1Msg.text.stringValue.includes('김철수'));
  check('지연 결재 메시지: 5일 대기만 포함(1일·승인건 제외)', stMsg && stMsg.text.stringValue.includes('5일 대기 기안') && !stMsg.text.stringValue.includes('1일 대기'), stMsg && stMsg.text.stringValue);
  check('SYSTEM 메시지 형태(author/system/channel)', d1Msg && d1Msg.author.stringValue === 'SYSTEM' && d1Msg.system.booleanValue === true && d1Msg.channel.stringValue === 'ai-alerts');
  check('채널 문서 자동 생성(🤖 AI 알림)', fsStore['channels/ai-alerts'] && fsStore['channels/ai-alerts'].name.stringValue === '🤖 AI 알림');
  check('중복 방지 마커 생성', !!fsStore['aiNotifMarkers/taskD1_t1_' + tomorrow] && !!fsStore['aiNotifMarkers/apStale_a1']);
}
{
  const before = postedMessages.length;
  const ps = []; await worker.scheduled({}, env, { waitUntil: x => ps.push(x) });
  await Promise.all(ps.map(p => p.catch(() => {})));
  check('크론 2회차: 마커 덕에 중복 발송 0건', postedMessages.length === before);
}
{
  const r = await post('/cron/run', staffToken, {});
  check('/cron/run: 일반직원 → 403', r.status === 403);
  const r2 = await post('/cron/run', adminToken, {});
  const d2 = await r2.json();
  check('/cron/run: 관리자 → 200 + 결과(중복 없음 {d1:0,stale:0})', r2.status === 200 && d2.d1 === 0 && d2.stale === 0, JSON.stringify(d2));
}

// ── 6. 야간 백업(v3.2) 시나리오 ─────────────────────────────────
{
  // BACKUP 바인딩 없으면 안전 스킵
  const rSkip = await post('/backup/run', adminToken, {});
  const dSkip = await rSkip.json();
  check('백업: R2 바인딩 없음 → 안전 스킵', rSkip.status === 200 && /BACKUP/.test(dSkip.skipped || ''), JSON.stringify(dSkip));

  // 모의 R2 + 첨부 조각 시드
  fsStore['tasks/chunk__att1'] = { data: { stringValue: 'x'.repeat(100) } };
  fsStore['tasks/dwg_1'] = { data: { stringValue: 'y'.repeat(100) } };
  const r2Store = new Map();
  r2Store.set('backup/2026-01-01/tasks.json', '[]'); // 31일 넘은 백업 — 정리돼야 함
  env.BACKUP = {
    put: async (k, v) => { r2Store.set(k, String(v)); },
    delete: async (k) => { r2Store.delete(k); },
    get: async (k) => r2Store.has(k) ? { json: async () => JSON.parse(r2Store.get(k)), text: async () => r2Store.get(k) } : null,
    list: async ({ prefix }) => ({ objects: [...r2Store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }),
  };

  const rGate = await post('/backup/run', staffToken, {});
  check('백업: 일반직원 수동 실행 → 403', rGate.status === 403);

  const r = await post('/backup/run', adminToken, {});
  const d = await r.json();
  const day = d.day;
  check('백업: 관리자 실행 → 요약 반환(컬렉션·문서 수)', r.status === 200 && d.collections >= 5 && d.docs > 0, JSON.stringify({ collections: d.collections, docs: d.docs, kb: d.kb }));
  check('백업: tasks에서 첨부 조각(chunk__/dwg_) 제외', d.summary.tasks === 3, 'tasks=' + d.summary.tasks);
  const tasksJson = JSON.parse(r2Store.get('backup/' + day + '/tasks.json') || '[]');
  check('백업: R2에 날짜/컬렉션.json 저장 + 문서 내용 보존', tasksJson.length === 3 && tasksJson.some(t => t.title === '내일 마감·미완료'), 'keys=' + [...r2Store.keys()].filter(k => k.includes(day)).length);
  check('백업: 30일 지난 백업 자동 정리', !r2Store.has('backup/2026-01-01/tasks.json'));
  check('백업: users·approvals·messages도 포함', !!r2Store.get('backup/' + day + '/users.json') && !!r2Store.get('backup/' + day + '/approvals.json') && !!r2Store.get('backup/' + day + '/messages.json'));
}

// ── 맥 + 기록 색인 같이 보기 (2026-09-22) ────────────────────────────────
// 왜 시험을 남기나: 2026-09-19~22 나흘 동안 맥이 살아 있으면 Vectorize 를 **아예 안 봤다.**
//   그래서 NCR·CAR·검사·회의록 색인이 AI 에게 한 번도 닿지 않았고, 아무도 몰랐다.
//   조용히 죽는 종류라 사람 눈에는 "AI 가 좀 멍청해졌다" 로만 보인다. 여기에 못을 박는다.
{
  const 맥env = { ...env, PAIS_URL: 'https://pais.test', PAIS_TOKEN: 'tok' };
  const 맥post = (obj, e) => worker.fetch(new Request('https://gw.test/rag/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + staffToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  }), e || 맥env);

  맥응답 = { 결과: Array.from({ length: 10 }, (_, i) => ({ 점수: 0.9 - i * 0.01, 문서: '맥규격', 머리: '맥머리', 글: '맥조각' + i })) };
  const r = await 맥post({ query: '용접 육안검사 결함 확인', topK: 10 });
  const d = await r.json();
  const 기록것 = (d.matches || []).filter(m => m.docName !== '맥규격');   // 기록 색인에서 온 것 전부
  const 맥것 = (d.matches || []).filter(m => m.docName === '맥규격');
  check('v5.1: 맥에 보내는 범위에 사람:<이름> 이 실린다 — 개인 자료는 본인만(파이스가 주인을 가린다)',
    !!맥에보낸몸 && (맥에보낸몸.범위 || []).includes('사람:생산부원') && (맥에보낸몸.범위 || []).includes('부서:생산부'),
    JSON.stringify(맥에보낸몸 && 맥에보낸몸.범위));
  check('맥+기록: 둘 다 나온다 (맥만 보고 끝내지 않는다)', 맥것.length > 0 && 기록것.length > 0,
    JSON.stringify({ source: d.source, 맥: 맥것.length, 기록: 기록것.length }));
  check('맥+기록: 맥 점수가 높으면 기록은 최소 한 자리만 (색인이 붙어 있는지는 늘 보인다)',
    d.matches.length === 10 && 기록것.length === 1,
    JSON.stringify({ 전체: (d.matches || []).length, 기록: 기록것.length }));
  check('맥+기록: 맥 조각이 앞자리 — 맥락은 앞이 우선순위다', d.matches[0] && d.matches[0].docName === '맥규격');

  // 9/26 직원 시범 전 대조: 파이스는 볼트(NAS 파일 카드)를 **맨 뒤에** 준다(규격 7 + 볼트 3).
  //   꼬리를 자르면 기록이 한 자리만 가져가도 볼트부터 사라졌다 — 규격부터 줄여야 한다.
  맥응답 = { 결과: [
    ...Array.from({ length: 7 }, (_, i) => ({ 점수: 0.9 - i * 0.01, 문서: '맥규격', 머리: '맥머리', 글: '맥조각' + i })),
    ...Array.from({ length: 3 }, (_, i) => ({ 점수: 0.6 - i * 0.01, 문서: 'NAS카드' + i, 글: '경로' + i, 출처: '볼트' })),
  ] };
  const dv = await (await 맥post({ query: '용접 육안검사 결함 확인', topK: 10 })).json();
  const 볼트수 = (dv.matches || []).filter(m => m.kind === '볼트').length;
  check('맥+기록 v5.4: 기록이 자리를 가져가도 볼트 카드는 살아남는다(규격 조각부터 줄인다)',
    dv.source === 'pais+기록' && dv.기록 >= 1 && 볼트수 === 3 && dv.matches.length === 10,
    JSON.stringify({ source: dv.source, 볼트: 볼트수, 전체: (dv.matches || []).length, 기록: dv.기록 }));

  // 반대 방향: 기록이 더 맞는 질문이면 기록이 자리를 더 가져가야 한다.
  //   "부적합 NCR 현황" 에서 NCR(0.59)이 상관없는 ASME(0.48)에 밀리던 것이 이 시험의 이유다.
  // 기록 색인에 여러 조각을 넣어 둔다 — 시험 저장소에 기본으로 든 게 한둘뿐이라 자리다툼이 안 된다
  await post('/rag/upload', adminToken, { docName: '기록뭉치', chunks: Array.from({ length: 6 }, (_, i) => '용접 육안검사 결함 확인 기록 ' + i) });
  맥응답 = { 결과: Array.from({ length: 10 }, (_, i) => ({ 점수: 0.01 - i * 0.001, 문서: '맥규격', 머리: '맥머리', 글: '맥조각' + i })) };
  const r3 = await 맥post({ query: '용접 육안검사 결함 확인', topK: 10 });
  const d3 = await r3.json();
  const 기록3 = (d3.matches || []).filter(m => m.docName !== '맥규격').length;
  check('맥+기록: 기록 점수가 높으면 자리를 더 가져간다', 기록3 > 1 && 기록3 <= 8,
    JSON.stringify({ 기록: 기록3, 전체: (d3.matches || []).length }));
  check('맥+기록: 그래도 맥 몫 두 자리는 남긴다', (d3.matches || []).length - 기록3 >= 2,
    JSON.stringify({ 맥: (d3.matches || []).length - 기록3 }));

  // 9/26 검토: 볼트를 다 살리면 기록이 일곱 자리를 가져간 날 맥 세 자리가 볼트 셋 = 규격 0 이 됐다.
  //   파이스와 같은 몫(1/3, 최소 1)으로 — 규격도 볼트도 한 자리 이상.
  await post('/rag/upload', adminToken, { docName: '기록뭉치2', chunks: ['용접 육안검사 결함 확인 기록 추가 0', '용접 육안검사 결함 확인 기록 추가 1'] });
  맥응답 = { 결과: [
    ...Array.from({ length: 7 }, (_, i) => ({ 점수: 0.01 - i * 0.001, 문서: '맥규격', 머리: '맥머리', 글: '맥조각' + i })),
    ...Array.from({ length: 3 }, (_, i) => ({ 점수: 0.02 - i * 0.001, 문서: 'NAS카드' + i, 글: '경로' + i, 출처: '볼트' })),
  ] };
  const d7 = await (await 맥post({ query: '용접 육안검사 결함 확인', topK: 10 })).json();
  const 규격7 = (d7.matches || []).filter(m => m.docName === '맥규격').length;
  const 볼트7 = (d7.matches || []).filter(m => m.kind === '볼트').length;
  check('맥+기록 v5.4: 기록이 일곱 자리를 가져가도 규격 조각이 남는다(볼트는 1/3 몫)',
    d7.기록 === 7 && 규격7 === 2 && 볼트7 === 1,
    JSON.stringify({ 기록: d7.기록, 규격: 규격7, 볼트: 볼트7 }));

  // 맥이 꺼진 날에도 기록 색인으로는 답해야 하고, 물러섰다는 사실이 응답에 남아야 한다
  맥응답 = null;                      // fetch 모의가 500 을 낸다
  const r2 = await 맥post({ query: '용접 육안검사 결함 확인', topK: 10 });
  const d2 = await r2.json();
  check('맥이 꺼져도 기록 색인으로 답한다', r2.status === 200 && (d2.matches || []).length > 0, JSON.stringify(d2.source));
  check('물러선 사실을 응답에 남긴다', !!d2.paisError, JSON.stringify(d2));
  맥응답 = null;
}

// ── v3.9: 사용자별 장부·한도 ────────────────────────────────────
// 왜 이걸 시험하나: 장부는 **안 돌아도 아무 소리가 안 난다.** AI 는 멀쩡히 답하고,
//   그냥 누가 얼마나 썼는지가 영영 안 남을 뿐이다. 그래서 여기서 매번 센다.
{
  // 워커와 **따로** 계산한다 — 워커가 UTC 로 밀리면 여기서 어긋나 잡힌다(b81 과 같은 함정).
  const 오늘 = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const 장부칸 = (email) => fsStore['aiUsageDaily/' + 오늘 + '_u_' + email];
  const 부르기 = (token, 한도) => worker.fetch(new Request('https://gw.test/v1/groq/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'x', messages: [] }),
  }), { ...env, GROQ_KEYS: 'testkey', AI_DAILY_LIMIT: String(한도) });

  부른모델 = [];
  const r1 = await 부르기(staffToken, 3);
  const 장1 = 장부칸('staff@sejong-21c.com');
  check('장부: 첫 호출에 하루·사람·횟수가 남는다', r1.status === 200 && Number(장1?.n?.integerValue) === 1
    && 장1?.email?.stringValue === 'staff@sejong-21c.com', JSON.stringify(장1));
  check('장부: 날짜 칸은 **한국 날짜**다 (UTC 로 적으면 새벽 0~9시가 어제로 밀린다)',
    장1?.day?.stringValue === 오늘, 장1?.day?.stringValue + ' vs ' + 오늘);

  await 부르기(staffToken, 3);
  check('장부: 같은 사람이 또 부르면 얹힌다', Number(장부칸('staff@sejong-21c.com')?.n?.integerValue) === 2);

  await 부르기(adminToken, 3);
  check('장부: 사람마다 따로 센다 (한 사람 쓴 게 남에게 안 얹힌다)',
    Number(장부칸('cwkim@sejong-21c.com')?.n?.integerValue) === 1
    && Number(장부칸('staff@sejong-21c.com')?.n?.integerValue) === 2);

  await 부르기(staffToken, 3);            // n=3 — 한도와 같으니 아직 통과
  부른모델 = [];
  const r4 = await 부르기(staffToken, 3); // n=4 — 넘었다
  const j4 = await r4.json();
  check('한도: 넘으면 429 로 돌려보낸다', r4.status === 429, 'status=' + r4.status);
  check('한도: **제공자를 아예 안 부른다** (부르고 나서 막으면 한도는 이미 나갔다)',
    부른모델.length === 0, JSON.stringify(부른모델));
  check('한도: 직원이 읽고 뭘 해야 할지 아는 말이 온다 (횟수·언제 풀리는지)',
    /자정/.test(j4.error || '') && j4.하루한도 === 3 && j4.오늘쓴횟수 === 4, JSON.stringify(j4));
  // 9/26 직원 시범 전 대조: 없는 메뉴('내 설정 › 개인 AI 열쇠')를 가리켰다. 받는 쪽은 한국어 대신 limit 칸으로 가른다.
  check('한도 v5.4: limit=user_daily · 진짜 메뉴(오른쪽 위 내 이름 › 🔑 개인 AI 열쇠)를 가리킨다',
    j4.limit === 'user_daily' && /오른쪽 위 내 이름 › 🔑 개인 AI 열쇠/.test(j4.error || '') && !/내 설정/.test(j4.error || ''), JSON.stringify(j4));

  커밋고장 = true;
  부른모델 = [];
  const r5 = await 부르기(staffToken, 3);
  커밋고장 = false;
  check('장부가 죽어도 **AI 는 막지 않는다** (장부 고장으로 전사가 멎으면 그게 더 큰 고장이다)',
    r5.status === 200 && 부른모델.length === 1, 'status=' + r5.status + ' 부름=' + 부른모델.length);

  const r6 = await 부르기(outsiderToken, 3);
  check('장부: 회사 계정이 아니면 세기 전에 막힌다 (남의 계정이 장부에 안 생긴다)',
    r6.status === 401 && !fsStore['aiUsageDaily/' + 오늘 + '_u_evil@gmail.com'], 'status=' + r6.status);
}

// ── v4.3: 백업이 **읽기 전에 센다** ──────────────────────────────
// 왜 이걸 시험하나: 2026-09-23 에 알아낸 것 — 백업이 chunk__·dwg_ 를 **받아 온 뒤에 버리고**
//   있었다. 주석에는 "제외" 라고 적혀 있는데 파이어스토어는 이미 읽기로 센다.
//   버리는 문서에 하루치(5만)를 다 쓰고, 그날 내내 플랫폼이 429 가 됐다.
//   **읽은문서(과금)와 docs(파일에 담은 수)가 다르면 그 차이가 버린 것이다.**
{
  const 큰것 = {};
  for (let i = 0; i < 40; i++) 큰것['chunkStore/chunk__' + i] = { b: { stringValue: 'x' } };
  Object.assign(fsStore, 큰것);
  // 앞의 백업 시험이 이미 장부에 얹어 놨다(누적되는 게 맞다). 이 블록만 재려고 비우고 시작한다.
  const 태평양날 = new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
  delete fsStore['readDaily/' + 태평양날];
  await env.BACKUP.delete('backup/_state.json');   // v4.7: 앞 실행이 남긴 '오늘 끝냈다' 표시를 지우고 새로 돈다
  const 백업env = { ...env, BACKUP_SKIP_OVER: '20', BACKUP_READ_BUDGET: '10000' };
  const r = await worker.fetch(new Request('https://gw.test/backup/run', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: '{}',
  }), 백업env);
  const j = await r.json();
  check('백업: 큰 컬렉션은 **읽지 않고** 건너뛴다 (버릴 것을 읽느라 하루치를 태우던 자리)',
    !!(j.건너뛴것 && j.건너뛴것.chunkStore) && !(j.summary || {}).chunkStore, JSON.stringify(j.건너뛴것 || {}));
  check('백업: 건너뛴 이유를 **수와 함께** 남긴다 (조용히 빠지면 백업이 빈 줄 모른다)',
    /40건/.test((j.건너뛴것 || {}).chunkStore || ''), (j.건너뛴것 || {}).chunkStore);
  check('백업: 과금된 읽기 수를 보고에 남긴다 — docs 와 다르면 버린 것이 있다는 뜻',
    typeof j.읽은문서 === 'number' && j.읽은문서 >= (j.docs || 0), JSON.stringify({ 읽은문서: j.읽은문서, docs: j.docs }));
  check('백업: 건너뛴 것 말고는 그대로 받는다 (예산 때문에 통째로 멎으면 안 된다)',
    (j.docs || 0) > 0 && Object.keys(j.summary || {}).length >= 3, JSON.stringify(Object.keys(j.summary || {})));

  // v4.4: 백업은 하루 약 15,000건을 읽는다 — **셋 중 제일 큰 몫**이다(브라우저·파이스·관문).
  //   자기가 쓴 걸 자기가 안 적으면 "오늘 얼마 썼나" 가 통째로 틀린다. 제일 흔한 구멍이다.
  const 장부 = fsStore['readDaily/' + 태평양날];
  check('백업: 읽은 만큼을 **공용 읽기 장부에 얹는다** (안 적으면 하루 총계가 통째로 틀린다)',
    !!장부 && Number(장부.gateway?.integerValue) === j.읽은문서 && Number(장부.gateway?.integerValue) > 0,
    JSON.stringify({ 장부: 장부 && 장부.gateway, 보고: j.읽은문서 }));
  check('백업: 장부 문서 id 는 **태평양 날짜**다 — 백업 파일의 day(한국 날짜)와 섞으면 하루가 두 동강 난다',
    장부?.day?.stringValue === 태평양날, JSON.stringify({ 장부날: 장부 && 장부.day, 백업날_한국: j.day }));

  for (const k of Object.keys(큰것)) delete fsStore[k];
  delete fsStore['readDaily/' + 태평양날];
}

// ── v4.1: 개인 API 열쇠 ─────────────────────────────────────────
// 왜 이걸 시험하나: 여기는 **직원의 진짜 API 열쇠**가 지나가는 자리다. 조용히 새면
//   알 방법이 없고, 조용히 안 잠기면 야간 백업에 평문으로 실려 R2 로 나간다.
{
  const 오늘 = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const KEY_SECRET = Buffer.from(wc.getRandomValues(new Uint8Array(32))).toString('base64');
  // 회사 열쇠 값이 ASCII 인 이유: HTTP 헤더는 ASCII 만 된다. 시험용으로 한글을 넣었다가
  //   undici 가 통째로 터졌다 — /key/set 이 한글 열쇠를 거절하는 것도 같은 이유다.
  const 열쇠env = { ...env, KEY_SECRET, GROQ_KEYS: 'COMPANY-KEY', AI_DAILY_LIMIT: '1' };
  const 키post = (길, token, obj) => worker.fetch(new Request('https://gw.test' + 길, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj || {}),
  }), 열쇠env);

  check('열쇠: 로그인 없이는 아무것도 못 한다', (await 키post('/key/status', null)).status === 401);
  check('열쇠: 회사 계정이 아니면 못 맡긴다',
    (await 키post('/key/set', outsiderToken, { 제공자: 'groq', 열쇠: 'gsk_' + 'a'.repeat(40) })).status === 401);

  const s0 = await (await 키post('/key/status', staffToken)).json();
  check('열쇠: 안 맡겼으면 없다고 한다', s0.있나 === false, JSON.stringify(s0));

  check('열쇠: 모르는 제공자는 거절한다',
    (await 키post('/key/set', staffToken, { 제공자: '남의회사', 열쇠: 'x'.repeat(40) })).status === 400);
  check('열쇠: 짧거나 한글 섞인 것은 거절한다 — 열쇠 모양이 아니다',
    (await 키post('/key/set', staffToken, { 제공자: 'groq', 열쇠: '내열쇠' })).status === 400
    && (await 키post('/key/set', staffToken, { 제공자: 'groq', 열쇠: 'gsk_한글' + 'a'.repeat(40) })).status === 400);

  // 진짜 열쇠 하나를 맡긴다. 등록할 때 제공자를 한 번 불러 보므로 모의가 200 을 준다.
  const 내열쇠 = 'gsk_' + 'z'.repeat(48) + 'TAIL';
  const r = await (await 키post('/key/set', staffToken, { 제공자: 'groq', 열쇠: 내열쇠 })).json();
  check('열쇠: 맡으면 끝 네 자리만 돌려준다', r.저장했다 === true && r.끝네자리 === 'TAIL', JSON.stringify(r));

  const 저장된 = fsStore['aiUserKeys/u_staff@sejong-21c.com'];
  const 덩이 = 저장된?.enc?.stringValue || '';
  check('열쇠: **평문으로 저장하지 않는다** (야간 백업이 R2 로 전 컬렉션을 떠낸다)',
    !!덩이 && !덩이.includes(내열쇠) && !JSON.stringify(저장된).includes(내열쇠), 덩이.slice(0, 24));
  check('열쇠: 잠근 덩이는 iv 가 따로 붙는다(같은 값을 두 번 잠가도 달라야 한다)', 덩이.split('.').length === 2);

  const s1 = await (await 키post('/key/status', staffToken)).json();
  check('열쇠: 확인해도 **열쇠 자체는 안 돌려준다** — 끝 네 자리와 제공자만',
    s1.있나 === true && s1.끝네자리 === 'TAIL' && !JSON.stringify(s1).includes(내열쇠), JSON.stringify(s1));

  // 한도 1 이라 두 번째 호출부터 넘는다 → 맡긴 열쇠로 가야 한다.
  // 모의 Firestore 는 시험끼리 **같은 통**이다. 앞의 장부 시험이 이 사람 횟수를 이미 올려놔서
  //   첫 호출부터 한도를 넘었다(처음엔 코드가 틀린 줄 알았다). 여기서 장부를 비우고 시작한다.
  const 오늘장부 = 'aiUsageDaily/' + 오늘 + '_u_';
  delete fsStore[오늘장부 + 'staff@sejong-21c.com'];
  delete fsStore[오늘장부 + 'cwkim@sejong-21c.com'];
  부른모델 = []; 부른열쇠 = [];
  await 키post('/v1/groq/chat/completions', staffToken, { model: 'x', messages: [] });   // 1회 — 회사 몫
  await 키post('/v1/groq/chat/completions', staffToken, { model: 'x', messages: [] });   // 2회 — 넘었다
  check('한도를 넘으면 **자기 열쇠로** 계속 쓴다 (429 로 막다른 길이 아니다)',
    부른열쇠.length === 2 && 부른열쇠[1] === 내열쇠, JSON.stringify(부른열쇠.map(k => k.slice(-4))));
  check('한도를 넘어도 **회사 열쇠로는 안 간다** (실패하면 조용히 회사 몫으로 넘어가면 한도가 무의미하다)',
    부른열쇠[0] === 'COMPANY-KEY' && !부른열쇠.slice(1).includes('COMPANY-KEY'), JSON.stringify(부른열쇠.map(k => k.slice(-4))));

  // 열쇠를 안 맡긴 사람은 그대로 429 인데, **뭘 하면 되는지**가 응답에 있어야 한다.
  await 키post('/v1/groq/chat/completions', adminToken, { model: 'x', messages: [] });
  const 막힘 = await (await 키post('/v1/groq/chat/completions', adminToken, { model: 'x', messages: [] })).json();
  check('열쇠를 안 맡긴 사람은 429 + 어디로 가면 되는지', 막힘.개인열쇠필요 === true && /개인 AI 열쇠/.test(막힘.error || ''), JSON.stringify(막힘).slice(0, 120));

  // 새 열쇠로 바꿨는데 5분 동안 옛 열쇠로 나가면, 직원은 "바꿨는데 왜 안 되지" 를 겪는다.
  const 새열쇠 = 'gsk_' + 'y'.repeat(48) + 'NEW2';
  await 키post('/key/set', staffToken, { 제공자: 'groq', 열쇠: 새열쇠 });
  부른열쇠 = [];
  await 키post('/v1/groq/chat/completions', staffToken, { model: 'x', messages: [] });
  check('열쇠: 바꾸면 **바로** 새 열쇠로 나간다 (캐시에 옛것이 남으면 안 된다)',
    부른열쇠[부른열쇠.length - 1] === 새열쇠, JSON.stringify(부른열쇠.map(k => k.slice(-4))));

  // 읽기 한도가 찬 날. **한도는 고장이 아니다** — 어제 밤 채점에서 똑같은 것을 고쳤다.
  읽기고장 = true;
  const s2r = await 키post('/key/status', staffToken);
  const s2 = await s2r.json();
  check('열쇠: 저장소가 바쁘면 **고장이 아니라 "모른다"** 고 말한다 (500 을 내면 기능이 죽은 줄 안다)',
    s2r.status === 200 && s2.모름 === true && !/429|failed/.test(JSON.stringify(s2)), JSON.stringify(s2));

  // **아직 아무것도 안 물어본 사람**으로 본다. 앞에서 한 번이라도 조회한 사람은 isolate 캐시에
  //   "없다" 가 남아 있어 Firestore 를 다시 안 읽는다(그건 설계대로다) — 그러면 이 길을 못 밟는다.
  const 신입Token = await makeToken('newbie@sejong-21c.com');
  await 키post('/v1/groq/chat/completions', 신입Token, { model: 'x', messages: [] });
  const 모름막힘 = await (await 키post('/v1/groq/chat/completions', 신입Token, { model: 'x', messages: [] })).json();
  check('한도 초과인데 열쇠를 **못 읽었으면** "등록하세요" 라고 하지 않는다 (맡겼는데 그러면 거짓말이다)',
    모름막힘.개인열쇠필요 === false && /확인하지 못했습니다/.test(모름막힘.error || ''), (모름막힘.error || '').slice(0, 90));
  읽기고장 = false;

  check('열쇠: 지우면 없어진다', (await (await 키post('/key/del', staffToken)).json()).지웠다 === true
    && !fsStore['aiUserKeys/u_staff@sejong-21c.com']);
}

// ── 결과 출력 ───────────────────────────────────────────────────
// ── 크론 심장박동(v4.5) ─────────────────────────────
{
  // 첫 자동 백업 날(9/24) R2 가 비어 있었는데 "안 돈 것" 인지 "돌고 조용히 실패한 것" 인지 가를 길이 없었다.
  await env.BACKUP.delete('backup/_cron.json'); await env.BACKUP.delete('backup/_state.json');
  for (const o of (await env.BACKUP.list({ prefix: 'backup/20' })).objects) await env.BACKUP.delete(o.key);
  const ps = []; await worker.scheduled({ cron: '0 0 * * *' }, env, { waitUntil: x => ps.push(x) });
  await Promise.all(ps.map(p => p.catch(() => {})));
  const hbObj = await env.BACKUP.get('backup/_cron.json');
  const hb = hbObj ? await hbObj.json() : null;
  check('크론이 돌면 backup/_cron.json 에 시각·크론식·알림 결과·맥 사본 현황이 남는다',
    !!hb && hb.cron === '0 0 * * *' && !!hb.at && !!hb.alerts && !!hb.사본 && !hb.backup,
    JSON.stringify(hb || {}).slice(0, 200));
  check('v5.0: 크론은 파이어스토어를 통째로 읽어 백업하지 않는다(날짜 폴더가 안 생긴다)',
    (await env.BACKUP.list({ prefix: 'backup/20' })).objects.length === 0);
}


// ── 무료 플랜 요청 예산 안에서 이어 받기(v4.7) ─────────────────────────────
{
  const 비우기 = async () => { for (const o of (await env.BACKUP.list({ prefix: 'backup/' })).objects) if (!/_cron\.json$/.test(o.key)) await env.BACKUP.delete(o.key); };
  await 비우기();
  // 백업은 끝에 자기 장부(readDaily)를 쓴다 — 그 컬렉션이 아직 없으면 첫 판만 한 건 적게 센다. 미리 만들어 둔다.
  const 장부날 = new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
  if (!fsStore['readDaily/' + 장부날]) fsStore['readDaily/' + 장부날] = { day: { stringValue: 장부날 } };
  const full = await (await post('/backup/run', adminToken, {})).json();
  check('예산 40(기본)이면 모의 자료는 한 번에 끝난다', !full.이어서함 && typeof full.docs === 'number' && full.docs > 0, JSON.stringify({ docs: full.docs, 요청: full.요청 }));
  await 비우기();
  env.BACKUP_REQ_BUDGET = '8';   // 토큰·목록·상태·장부 4 + 컬렉션 하나(세기 1 + 쪽 1 + 저장 1) + 여유 1
  const j1 = await (await post('/backup/run', adminToken, {})).json();
  const st1 = await (await env.BACKUP.get('backup/_state.json')).json();
  check('예산이 모자라면 이어서함=true 로 멈추고 상태 파일에 끝낸 것·읽은 수를 적는다',
    j1.이어서함 === true && Array.isArray(st1.done) && st1.done.length === j1.끝낸것 && typeof st1.읽은문서 === 'number',
    JSON.stringify({ 끝낸것: j1.끝낸것, 다음: j1.다음, st: st1.done }));
  const 저장된 = (await env.BACKUP.list({ prefix: 'backup/' + j1.day + '/' })).objects.map(o => o.key.split('/').pop().replace(/\.json$/, ''));
  check('저장된 파일 = 끝낸 컬렉션 — 반쪽 파일이 없다', 저장된.length > 0 && 저장된.every(c => st1.done.includes(c)), JSON.stringify({ 저장된, done: st1.done }));
  let jN = j1, n = 1;
  while (jN.이어서함 && n < 25) { jN = await (await post('/backup/run', adminToken, {})).json(); n++; }
  check('이어서 부르면 결국 끝나고, 누적 결과가 한 번에 돌린 것과 같다(' + n + '번)',
    !jN.이어서함 && jN.docs === full.docs && jN.읽은문서 === full.읽은문서 && jN.collections === full.collections,
    JSON.stringify({ n, docs: [jN.docs, full.docs], 읽은문서: [jN.읽은문서, full.읽은문서] }));
  const stAll = await (await env.BACKUP.get('backup/_state.json')).json();
  check('끝나면 상태 파일이 ALL 로 남는다(지우지 않는다)', stAll.done === 'ALL' && stAll.result && stAll.result.docs === jN.docs);
  const again = await (await post('/backup/run', adminToken, {})).json();
  check('같은 날 다시 부르면 처음부터 읽지 않고 "이미 끝냈다" + 결과를 돌려준다', /이미 끝냈다/.test(again.skipped || '') && again.결과 && again.결과.docs === jN.docs, JSON.stringify(again).slice(0, 160));
  delete env.BACKUP_REQ_BUDGET;
  await env.BACKUP.delete('backup/_state.json');

  // v4.8: 새 실행으로도 못 받는 크기는 '이어서함' 만 영원히 돌지 않고 이유를 남기며 건너뛴다
  await 비우기();
  env.BACKUP_REQ_BUDGET = '6';   // 5(토큰·목록·상태·장부·세기) 뒤 남는 1 로는 어떤 컬렉션도 못 받는다
  // 세는 것만으로도 예산이 차니 한 번에는 못 끝난다 — 그래도 부를수록 '끝낸 것' 이 늘어 **반드시 끝난다**(영원히 이어서함 ×)
  let tiny = await (await post('/backup/run', adminToken, {})).json(), tn = 1;
  while (tiny.이어서함 && tn < 60) { tiny = await (await post('/backup/run', adminToken, {})).json(); tn++; }
  check('한 실행으로 못 받을 크기면 영원히 이어서함 하지 않고 건너뛴 이유를 남기며 끝난다(' + tn + '번)',
    !tiny.이어서함 && tn < 60 && tiny.docs === 0 && Object.keys(tiny.건너뛴것 || {}).length === tiny.collections && Object.values(tiny.건너뛴것).every(v => /끝까지 못 받는다/.test(v)),
    JSON.stringify({ tn, 이어서함: tiny.이어서함, docs: tiny.docs, 건너뜀: Object.keys(tiny.건너뛴것 || {}).length, 예: Object.values(tiny.건너뛴것 || {})[0] }).slice(0, 220));
  delete env.BACKUP_REQ_BUDGET;
  await env.BACKUP.delete('backup/_state.json');
}

// ── 장부 기준 예산 · 어떻게 끝나든 장부에(v4.9) ─────────────────────────────
{
  // 9/24: 상태 파일을 지우고 두 번째 완주를 돌리니 예산이 0 부터 다시 셌고, 하루 5만을 다 태웠다.
  const 태평양 = new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
  const 장부값 = () => Number((fsStore['readDaily/' + 태평양] || {}).gateway?.integerValue || 0);
  const 새로 = async () => { await env.BACKUP.delete('backup/_state.json'); };
  const 기준 = await (async () => { await 새로(); delete fsStore['readDaily/' + 태평양]; return (await (await post('/backup/run', adminToken, {})).json()); })();
  const 전체읽음 = 기준.읽은문서;

  // ① 장부에 이미 예산 거의 다 — 상태 파일을 지워도 큰 것은 건너뛴다
  await 새로(); fsStore['readDaily/' + 태평양] = { gateway: { integerValue: '8' } };
  env.BACKUP_READ_BUDGET = '10';
  const j1 = await (await post('/backup/run', adminToken, {})).json();
  check('상태 파일을 지우고 다시 돌려도 오늘 장부에 쓴 만큼은 예산에서 빠진다',
    j1.장부앞서 === 8 && j1.읽은문서 <= 2 && Object.values(j1.건너뛴것 || {}).some(v => /장부상 이미/.test(v)) && 장부값() === 8 + j1.읽은문서,
    JSON.stringify({ 장부앞서: j1.장부앞서, 읽은: j1.읽은문서, 장부: 장부값(), 건너뜀: Object.keys(j1.건너뛴것 || {}).length }));
  delete env.BACKUP_READ_BUDGET;

  // ② 도중에 429 로 죽어도 거기까지 읽은 만큼은 장부에 남는다
  await 새로(); delete fsStore['readDaily/' + 태평양];
  목록한도 = Object.keys(기준.summary).pop();
  const r2 = await post('/backup/run', adminToken, {});
  목록한도 = null;
  check('백업 도중 429 로 끊겨도 거기까지 읽은 만큼은 장부에 올라간다(안 올리면 다음 판단이 한도를 모른다)',
    r2.status === 500 && 장부값() > 0 && 장부값() < 전체읽음, JSON.stringify({ status: r2.status, 장부: 장부값(), 전체: 전체읽음 }));
  const 표시 = Number((fsStore['readDaily/' + 태평양] || {}).limitHitAt?.integerValue || 0);
  check('429 를 만나면 장부에 처음 찬 시각(limitHitAt)을 남긴다 — 밤 채점이 "장부는 적은데 한도는 찼다" 를 안다',
    표시 > Date.now() - 60000 && 표시 <= Date.now(), String(표시));

  // ③ 장부부터 429 면 아무것도 안 읽고 멈춘다
  await 새로(); 장부고장 = true;
  const before = 장부값();
  const j3 = await (await post('/backup/run', adminToken, {})).json();
  장부고장 = false;
  check('하루 읽기 한도가 이미 찼으면(장부 429) 읽지 않고 이유를 남기고 멈춘다', /429/.test(j3.skipped || '') && 장부값() === before, JSON.stringify(j3).slice(0, 160));
  await 새로();
}

// ── 맥 사본 받기(v5.0) ─────────────────────────────
{
  env.MIGRATE_TOKEN = 'SERVER-TOKEN-TEST';
  const 올리기 = (day, 열쇠, 몸 = new Uint8Array([31, 139, 8, 0, 1, 2, 3])) => worker.fetch(new Request('https://gw.test/backup/upload?day=' + day, {
    method: 'PUT', headers: 열쇠 ? { Authorization: 'Bearer ' + 열쇠 } : {}, body: 몸,
  }), env);
  const 오늘 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const 전 = (일) => new Date(Date.parse(오늘) - 일 * 86400e3).toISOString().slice(0, 10);
  check('사본 올리기: 서버 토큰이 없으면 401', (await 올리기(오늘, '')).status === 401);
  check('사본 올리기: 틀린 토큰이면 401', (await 올리기(오늘, 'SERVER-TOKEN-TESX')).status === 401);
  check('사본 올리기: 날짜 꼴이 아니면 400(열쇠 경로를 남이 못 정한다)', (await 올리기('../x', 'SERVER-TOKEN-TEST')).status === 400);
  await env.BACKUP.put('snap/' + 전(40) + '.json.gz', 'old');
  await env.BACKUP.put('snap/' + 전(5) + '.json.gz', 'recent');
  const r = await 올리기(오늘, 'SERVER-TOKEN-TEST');
  const j = await r.json();
  const 남은 = (await env.BACKUP.list({ prefix: 'snap/' })).objects.map(o => o.key);
  check('사본 올리기: snap/<날>.json.gz 로 저장되고 크기를 돌려준다', r.status === 200 && j.key === 'snap/' + 오늘 + '.json.gz' && j.bytes === 7 && 남은.includes(j.key), JSON.stringify(j));
  check('사본 올리기: 30일 넘은 사본은 지우고 최근 것은 남긴다', j.지움 === 1 && !남은.includes('snap/' + 전(40) + '.json.gz') && 남은.includes('snap/' + 전(5) + '.json.gz'), JSON.stringify(남은));
  const ps = []; await worker.scheduled({ cron: '0 0 * * *' }, env, { waitUntil: x => ps.push(x) });
  await Promise.all(ps.map(p => p.catch(() => {})));
  const hb = await (await env.BACKUP.get('backup/_cron.json')).json();
  check('심장박동에 가장 최근 맥 사본이 찍힌다(안 오면 아침에 바로 보인다)', hb.사본 && hb.사본.최신 === 'snap/' + 오늘 + '.json.gz', JSON.stringify(hb.사본));

  // v5.2 영구 보관본(떼어 낸 옛 작업 기록) — 덮어쓰기 금지 · sha256 대조
  const 메타 = new Map();
  const 원put = env.BACKUP.put;
  env.BACKUP.put = async (k, v, o) => { 메타.set(k, o && o.customMetadata); return 원put(k, v); };
  env.BACKUP.head = async (k) => ((await env.BACKUP.get(k)) ? { customMetadata: 메타.get(k) } : null);
  const 보관올리기 = (이름, 몸, 열쇠 = 'SERVER-TOKEN-TEST') => worker.fetch(new Request('https://gw.test/backup/upload?archive=' + encodeURIComponent(이름), {
    method: 'PUT', headers: 열쇠 ? { Authorization: 'Bearer ' + 열쇠 } : {}, body: 몸,
  }), env);
  const 이름 = 'activityLog-2026-08-25_2026-08-31.json.gz';
  check('보관본: 서버 토큰이 없으면 401', (await 보관올리기(이름, new Uint8Array([1]), '')).status === 401);
  check('보관본: 이름 꼴이 아니면 400(경로를 남이 못 정한다)', (await 보관올리기('../snap/x.json.gz', new Uint8Array([1]))).status === 400);
  const a1 = await 보관올리기(이름, new Uint8Array([31, 139, 1, 2]));
  const j1 = await a1.json();
  check('보관본: archive/<이름> 에 두고 sha256 을 돌려준다', a1.status === 200 && j1.key === 'archive/' + 이름 && /^[0-9a-f]{64}$/.test(j1.sha256) && !!(await env.BACKUP.get('archive/' + 이름)), JSON.stringify(j1));
  const a2 = await (await 보관올리기(이름, new Uint8Array([31, 139, 1, 2]))).json();
  check('보관본: 같은 내용을 다시 올리면 그대로 200(다시 돌려도 안전)', a2.있었다 === true && a2.sha256 === j1.sha256, JSON.stringify(a2));
  check('보관본: 같은 이름에 다른 내용이면 409 — 영구 보관본은 덮어쓰지 않는다', (await 보관올리기(이름, new Uint8Array([9, 9]))).status === 409);
  const 정리후 = await 올리기(오늘, 'SERVER-TOKEN-TEST');
  check('보관본: 사본 정리(30일)가 archive/ 는 건드리지 않는다', 정리후.status === 200 && !!(await env.BACKUP.get('archive/' + 이름)));
  env.BACKUP.put = 원put; delete env.BACKUP.head;
  delete env.MIGRATE_TOKEN;
}

// ── v5.3: 장부 하나로 — 호출 **뒤** 결과·기능·모델·토큰 ─────────────
// 왜: 연말에 "유료로 가나" 를 이 장부로 판단한다. 호출 수만 있고 413·한도·토큰이 없으면 판단할 재료가 없다.
//   뒤 쓰기는 ctx.waitUntil 에서 돈다 — 여기선 waitUntil 에 모인 약속을 기다린 뒤 본다.
{
  const 오늘 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const 사람 = 'ledger5@sejong-21c.com';
  const 토큰5 = await makeToken(사람);
  const 줄 = () => fsStore['aiUsageDaily/' + 오늘 + '_u_' + 사람] || {};
  const 수 = (f) => Number((줄()[f] || {}).integerValue || 0);
  const 결과합 = () => Object.keys(줄()).filter((k) => k.startsWith('o.')).reduce((a, k) => a + 수(k), 0);
  const KS = Buffer.from(wc.getRandomValues(new Uint8Array(32))).toString('base64');
  const 부르기 = async ({ 경로 = '/v1/groq/chat/completions', 기능 = null, 한도 = 300, 몸 = { model: 'openai/gpt-oss-120b', messages: [] } } = {}) => {
    const ps = [];
    const h = { Authorization: 'Bearer ' + 토큰5, 'Content-Type': 'application/json' };
    if (기능) h['x-sj-feature'] = 기능;
    const r = await worker.fetch(new Request('https://gw.test' + 경로, { method: 'POST', headers: h, body: JSON.stringify(몸) }),
      { ...env, GROQ_KEYS: 'testkey', GEMINI_KEYS: 'gkey', AI_DAILY_LIMIT: String(한도), KEY_SECRET: KS }, { waitUntil: (p) => ps.push(p) });
    const 본문 = await r.text();   // 클라이언트가 **먼저** 끝까지 받는다 — 복제본이 흐름을 막으면 여기서 멈춘다
    await Promise.all(ps);
    return { r, 본문 };
  };

  const a = await 부르기({ 기능: 'msg_chat' });
  check('장부 v5.3: 클라이언트는 본문을 온전히 받는다(복제본으로 토큰을 세도)', a.r.status === 200 && JSON.parse(a.본문).choices[0].message.content === '네', a.본문.slice(0, 80));
  check('장부 v5.3: 한 줄에 기능·제공자·모델·결과·토큰이 얹힌다',
    수('n') === 1 && 수('o.ok') === 1 && 수('f.msg_chat') === 1 && 수('c.groq') === 1 && 수('m.openai_gpt_oss_120b') === 1
    && 수('ti.groq') === 12 && 수('to.groq') === 3, JSON.stringify(줄()));

  await 부르기();
  await 부르기({ 기능: 'Msg Chat!' });
  check('장부 v5.3: 기능 헤더가 없으면 none, 이상한 값은 etc (마음대로 칸을 못 만든다)', 수('f.none') === 1 && 수('f.etc') === 1, JSON.stringify(줄()));

  제공자답 = { status: 413 };
  const b = await 부르기({ 기능: 'msg_chat' });
  제공자답 = null;
  check('장부 v5.3: 413 은 e413 으로 — 무료 한도(8천 토큰)에 걸린 횟수가 판단 재료다', b.r.status === 413 && 수('o.e413') === 1 && 수('ti.groq') === 36, JSON.stringify(줄()));

  제공자답 = { sse: true };
  const c = await 부르기({ 기능: 'assistant' });
  제공자답 = null;
  check('장부 v5.3: SSE 는 마지막 조각의 usage(groq x_groq)에서 센다 — 클라이언트 흐름은 그대로',
    c.본문.includes('[DONE]') && 수('ti.groq') === 36 + 40 && 수('to.groq') === 9 + 7, `ti=${수('ti.groq')} to=${수('to.groq')}`);

  await 부르기({ 경로: '/v1/gemini/models/gemini-2.5-flash:generateContent', 기능: 'msg_chat', 몸: { contents: [] } });
  check('장부 v5.3: gemini 는 모델을 주소에서, 토큰은 usageMetadata(생각 토큰은 답 몫)',
    수('c.gemini') === 1 && 수('m.gemini_2_5_flash') === 1 && 수('ti.gemini') === 20 && 수('to.gemini') === 7, JSON.stringify(줄()));

  await 부르기({ 경로: '/v1/9router/chat/completions', 기능: 'car' });
  check('장부 v5.3: 숫자로 시작하는 제공자(9router)도 경로가 안 깨진다 → _9router (깨지면 한도가 꺼진다)',
    수('c._9router') === 1 && 수('o.cfg') === 1, JSON.stringify(줄()));

  부른모델 = [];
  const d = await 부르기({ 한도: 수('n') });   // 이번 호출이 한도+1 이다
  check('장부 v5.3: 한도에 걸리면 lim 으로 — 제공자는 안 부르고 c.* 에도 안 얹는다',
    d.r.status === 429 && 수('o.lim') === 1 && 부른모델.length === 0 && 수('c.groq') === 5, JSON.stringify(줄()));

  await 부르기({ 경로: '/key/set', 몸: { 제공자: 'groq', 열쇠: 'gsk_' + 'z'.repeat(48) + 'OWN5' } });
  const 회사ti = 수('ti.groq');
  const e = await 부르기({ 기능: 'msg_chat', 한도: 1 });
  check('장부 v5.3: 개인 열쇠로 나간 호출은 k 로 세고 토큰은 ki/ko — 회사 몫(ti/to)에 안 섞는다',
    e.r.status === 200 && 수('k') === 1 && 수('ki') === 12 && 수('ko') === 3 && 수('ti.groq') === 회사ti, JSON.stringify(줄()));

  const 전ti = 수('ti.groq'), 전to = 수('to.groq');
  제공자답 = { 긴sse: 4000 };
  const t0 = performance.now();
  const g = await 부르기({ 기능: 'assistant' });
  const 걸림 = performance.now() - t0;
  제공자답 = null;
  check('장부 v5.3: 긴 SSE(조각 4천 개 ≈ 1MB)도 끝 usage 를 찾고 클라이언트는 다 받는다',
    g.본문.includes('[DONE]') && 수('ti.groq') === 전ti + 900 && 수('to.groq') === 전to + 4000, `ti=${수('ti.groq') - 전ti} to=${수('to.groq') - 전to}`);
  check('장부 v5.3: 긴 SSE 에 토큰 세기가 무겁지 않다(조각마다 꼬리를 다시 복사하면 수백 ms — 무료 워커는 10ms 에 끊는다)',
    걸림 < 400, Math.round(걸림) + 'ms(모의 스트림·Firestore 포함 전체)');

  커밋던짐 = true;
  부른모델 = [];
  const h = await 부르기({ 기능: 'msg_chat' });
  커밋던짐 = false;
  check('장부 v5.3: 장부 쓰기가 **던져도**(네트워크·서비스 계정) AI 는 돈다 — 전엔 잡는 곳이 없어 1101 로 전부 죽었다',
    h.r.status === 200 && 부른모델.length === 1, 'status=' + h.r.status);

  check('장부 v5.3: Σ결과 = n — 어긋나면 뒤 쓰기가 빠진 것(관리 화면이 「기록 빠짐」으로 보여 준다)', 결과합() === 수('n'), 결과합() + ' vs ' + 수('n'));

  const 앞 = await worker.fetch(new Request('https://gw.test/v1/groq/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://sejong21c.com' } }), env);
  check('장부 v5.3: preflight 가 x-sj-feature 를 허용한다 (빠지면 AI 호출이 전부 죽는다)',
    /x-sj-feature/i.test(앞.headers.get('Access-Control-Allow-Headers') || ''), 앞.headers.get('Access-Control-Allow-Headers'));
}

// ── v5.4: 회사 몫이 마른 날(회사 열쇠가 전부 429) ─────────────
// 왜: 2026-09-26 직원 시범 전 대조 — groq 영어 원문(조직 id·유료 권유)이 직원 말풍선에 그대로 떴고,
//   🔑 개인 열쇠는 사람별 300 에만 걸려 있어 회사 몫이 마른 날엔 소용이 없었다.
{
  const 오늘 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const KS = Buffer.from(wc.getRandomValues(new Uint8Array(32))).toString('base64');
  const 하루치 = 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_TEST` service tier `on_demand` on tokens per day (TPD): '
    + 'Limit 200000, Used 199000, Requested 3000. Please try again in 1m30s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing';
  const 찬답 = (message, headers) => ({ status: 429, message, headers });
  const 부르기 = async (토큰, { 열쇠들 = 'C1,C2', 경로 = '/v1/groq/chat/completions', 몸 = { model: 'x', messages: [] } } = {}) => {
    const ps = [];
    const r = await worker.fetch(new Request('https://gw.test' + 경로, { method: 'POST', headers: { Authorization: 'Bearer ' + 토큰, 'Content-Type': 'application/json' }, body: JSON.stringify(몸) }),
      { ...env, GROQ_KEYS: 열쇠들, AI_DAILY_LIMIT: '300', KEY_SECRET: KS }, { waitUntil: (p) => ps.push(p) });
    const 본문 = await r.text();
    await Promise.all(ps);
    return { r, 본문, j: (() => { try { return JSON.parse(본문); } catch { return {}; } })() };
  };
  const 수 = (email, f) => Number(((fsStore['aiUsageDaily/' + 오늘 + '_u_' + email] || {})[f] || {}).integerValue || 0);

  // ① 열쇠를 안 맡긴 사람
  const 갑 = await makeToken('quota1@sejong-21c.com');
  제공자차례 = [찬답(하루치), 찬답(하루치)]; 부른열쇠 = [];
  const a = await 부르기(갑);
  제공자차례 = [];
  check('회사 몫 v5.4: 회사 열쇠가 전부 429 면 한국어 429 + limit=company_quota (groq 영어 원문을 흘려보내지 않는다)',
    a.r.status === 429 && a.j.limit === 'company_quota' && /회사 공용 AI 한도/.test(a.j.error || '') && !/org_|Upgrade/.test(a.j.error || ''), a.본문.slice(0, 160));
  check('회사 몫 v5.4: 몇 초 뒤인지(retryAfter, 1m30s → 90) · 원문 앞 200자(upstream)는 따로 싣는다',
    a.j.retryAfter === 90 && /^Rate limit reached/.test(a.j.upstream || '') && a.j.upstream.length <= 200 && /2분쯤 뒤/.test(a.j.error || ''),
    JSON.stringify({ retryAfter: a.j.retryAfter, error: a.j.error }));
  check('회사 몫 v5.4: 두 회사 열쇠를 다 돌아 본 뒤에 막고, 열쇠 맡기는 자리를 알려 준다 · 장부는 e429',
    부른열쇠.length === 2 && 부른열쇠.includes('C1') && 부른열쇠.includes('C2') && /오른쪽 위 내 이름 › 🔑 개인 AI 열쇠/.test(a.j.error || '')
    && 수('quota1@sejong-21c.com', 'o.e429') === 1 && 수('quota1@sejong-21c.com', 'k') === 0, JSON.stringify(부른열쇠));

  // ② 열쇠를 맡긴 사람 — 사람별 300 을 안 넘었어도 회사 몫이 마르면 자기 열쇠로 한 번
  const 을 = await makeToken('quota2@sejong-21c.com');
  const 을열쇠 = 'gsk_' + 'q'.repeat(48) + 'QTA2';
  await 부르기(을, { 경로: '/key/set', 몸: { 제공자: 'groq', 열쇠: 을열쇠 } });
  제공자차례 = [찬답(하루치), 찬답(하루치)]; 부른열쇠 = [];
  const b = await 부르기(을);
  제공자차례 = [];
  check('회사 몫 v5.4: 맡긴 개인 열쇠가 있으면 그걸로 한 번 더 — 답이 온다',
    b.r.status === 200 && 부른열쇠.length === 3 && 부른열쇠[2] === 을열쇠, JSON.stringify(부른열쇠.map(k => k.slice(-4))));
  check('회사 몫 v5.4: 그 호출은 장부에 k·ki/ko — 회사 몫(ti/to)에 안 섞는다(사람별 300 을 넘긴 길과 같다)',
    수('quota2@sejong-21c.com', 'k') === 1 && 수('quota2@sejong-21c.com', 'ki') === 12 && 수('quota2@sejong-21c.com', 'ko') === 3
    && 수('quota2@sejong-21c.com', 'ti.groq') === 0 && 수('quota2@sejong-21c.com', 'o.ok') === 1, JSON.stringify(fsStore['aiUsageDaily/' + 오늘 + '_u_quota2@sejong-21c.com']));

  // ③ 맡긴 열쇠까지 막히면 — "등록하세요" 라고 하면 거짓말이다
  제공자차례 = [찬답(하루치), 찬답(하루치), 찬답(하루치)];
  const c = await 부르기(을);
  제공자차례 = [];
  check('회사 몫 v5.4: 맡긴 열쇠까지 429 면 company_quota — "등록하세요" 대신 맡긴 열쇠도 안 됐다고',
    c.r.status === 429 && c.j.limit === 'company_quota' && /맡기신 개인 열쇠로도/.test(c.j.error || '') && !/등록하면/.test(c.j.error || ''), c.j.error);

  // ④ 분당 한도(몇 초면 풀림)는 한 번 기다렸다 같은 열쇠로. 머리(retry-after)가 본문보다 먼저다(본문 7.5s 면 안 기다린다)
  const 병 = await makeToken('quota3@sejong-21c.com');
  제공자차례 = [찬답('Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 7.5s.', { 'retry-after': '1' })]; 부른열쇠 = [];
  const t0 = Date.now();
  const d = await 부르기(병, { 열쇠들: 'C1' });
  제공자차례 = [];
  check('회사 몫 v5.4: 분당 한도(retry-after ≤ 6초)면 한 번 기다렸다 같은 열쇠로 — 답이 온다',
    d.r.status === 200 && 부른열쇠.length === 2 && 부른열쇠.every(k => k === 'C1') && Date.now() - t0 >= 900,
    JSON.stringify({ s: d.r.status, 부름: 부른열쇠, ms: Date.now() - t0 }));

  // ⑤ 6초 넘게 기다려야 하면 안 기다린다(직원 쪽 40초 시간초과 안에서 논다)
  제공자차례 = [찬답('Please try again in 7.5s.')]; 부른열쇠 = [];
  const e = await 부르기(병, { 열쇠들: 'C1' });
  제공자차례 = [];
  check('회사 몫 v5.4: 6초 넘게 기다려야 하면 바로 429 (retryAfter 8 · "8초쯤 뒤")',
    e.r.status === 429 && 부른열쇠.length === 1 && e.j.retryAfter === 8 && /8초쯤 뒤/.test(e.j.error || ''), JSON.stringify(e.j));

  // ⑥ 413 은 손대지 않는다 — 줄여 다시 보내는 건 클라이언트 몫
  제공자차례 = [{ status: 413 }]; 부른열쇠 = [];
  const f = await 부르기(병);
  제공자차례 = [];
  check('회사 몫 v5.4: 413 은 그대로 413 (교대·개인 열쇠·limit 칸 없음)', f.r.status === 413 && 부른열쇠.length === 1 && !f.j.limit, f.본문.slice(0, 80));
}

// ── v5.4: 경비 파일(expense/)은 주인과 재무부만 ─────────────
// 왜: 2026-09-26 직원 시범 전 대조 — /file/sign 이 로그인만 보고 아무 열쇠에나 서명했다. 열쇠는 사내 누구나 읽는
//   t_expenseEntries 에 있으니 남의 영수증 사진이 열렸고, /file/put 으로는 덮어쓸 수도 있었다.
{
  const 파일통 = new Map();
  const 파일env = { ...env, FILE_SIGN_KEY: 'test-sign-key', MIGRATE_TOKEN: 'SERVER-TOKEN-TEST',
    FILES: { put: async (k, v) => { 파일통.set(k, v); }, get: async () => null, head: async () => null } };
  const 서명 = async (토큰, keys) => (await worker.fetch(new Request('https://gw.test/file/sign', {
    method: 'POST', headers: { Authorization: 'Bearer ' + 토큰, 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) }), 파일env)).json();
  const 올리기 = (토큰, 키) => worker.fetch(new Request('https://gw.test/file/put?key=' + encodeURIComponent(키), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + 토큰, 'Content-Type': 'image/jpeg' }, body: 'jpg' }), 파일env);
  // 토큰 sub 가 'u_' + 이메일 → 거르면 @ 가 빠진다(messenger.js 와 같은 거름)
  const 내것 = 'expense/inbox/u_staffsejong-21c.com_1727300000000.jpg';
  const 남의것 = 'expense/inbox/u_othersejong-21c.com_1727300000000.jpg';
  const 재무자리 = 'expense/E123/0.jpg';
  const 딴것 = 'ncr/N1/0.jpg';
  fsStore['users/u_fin@sejong-21c.com'] = { name: { stringValue: '재무담당' }, dept: { stringValue: '재무부' }, grade: { stringValue: 'member' } };
  fsStore['users/u_boss@sejong-21c.com'] = { name: { stringValue: '임원' }, dept: { stringValue: '영업부' }, grade: { stringValue: 'exec' } };
  fsStore['users/u_fsdown@sejong-21c.com'] = { name: { stringValue: '재무신입' }, dept: { stringValue: '재무부' }, grade: { stringValue: 'member' } };
  const 재무 = await makeToken('fin@sejong-21c.com');
  const 임원 = await makeToken('boss@sejong-21c.com');
  const 모름 = await makeToken('fsdown@sejong-21c.com');

  const s1 = await 서명(staffToken, [내것, 남의것, 재무자리, 딴것]);
  check('경비 v5.4: 직원은 자기 영수증함과 경비 밖 파일만 서명받고, 남의 경비 파일은 denied 로 (한 장 때문에 다 막지 않는다)',
    !!(s1.urls || {})[내것] && !!(s1.urls || {})[딴것] && !(s1.urls || {})[남의것] && !(s1.urls || {})[재무자리]
    && (s1.denied || []).length === 2 && s1.denied.includes(남의것) && s1.denied.includes(재무자리), JSON.stringify({ urls: Object.keys(s1.urls || {}), denied: s1.denied }));
  const s2 = await 서명(재무, [남의것, 재무자리, 'expense/logo.png']);
  const s3 = await 서명(임원, [남의것]);
  const s4 = await 서명(adminToken, [남의것]);
  check('경비 v5.4: 재무부·exec·super 는 expense/ 전부 (index.html canSeeDept(\'재무부\') 와 같은 판정)',
    Object.keys(s2.urls || {}).length === 3 && !s2.denied && !!(s3.urls || {})[남의것] && !!(s4.urls || {})[남의것], JSON.stringify({ s2, s3: s3.denied, s4: s4.denied }));
  const s5 = await 서명('SERVER-TOKEN-TEST', [남의것, 재무자리]);
  check('경비 v5.4: 서버 토큰(맥 배치)은 그대로 전부', Object.keys(s5.urls || {}).length === 2 && !s5.denied, JSON.stringify(s5.denied));

  check('경비 v5.4: 직원은 자기 영수증함에는 올린다', (await 올리기(staffToken, 내것)).status === 200 && 파일통.has(내것));
  const p남 = await 올리기(staffToken, 남의것), p재 = await 올리기(staffToken, 재무자리), p딴 = await 올리기(staffToken, 딴것);
  check('경비 v5.4: 남의 영수증함·재무부 자리에는 못 올린다(덮어쓰기) — 경비 밖은 그대로',
    p남.status === 403 && p재.status === 403 && !파일통.has(남의것) && !파일통.has(재무자리) && p딴.status === 200,
    [p남.status, p재.status, p딴.status].join(','));
  check('경비 v5.4: 재무부는 expense/ 어디든 올린다', (await 올리기(재무, 재무자리)).status === 200 && 파일통.has(재무자리));

  // users 를 못 읽는 날(429): 재무부 사람이라도 확인 못 했으면 남의 것은 막는다. 자기 함은 users 없이도 된다.
  사용자읽기고장 = true;
  const 모름내것 = 'expense/inbox/u_fsdownsejong-21c.com_1727300000001.jpg';
  const s6 = await 서명(모름, [모름내것, 남의것]);
  const p6 = await 올리기(모름, 모름내것);
  const p7 = await 올리기(모름, 남의것);
  사용자읽기고장 = false;
  check('경비 v5.4: users 를 못 읽는 날 — 남의 경비 파일은 막고(fail closed) 자기 영수증함은 된다',
    !!(s6.urls || {})[모름내것] && (s6.denied || []).includes(남의것) && p6.status === 200 && p7.status === 403,
    JSON.stringify({ urls: Object.keys(s6.urls || {}), denied: s6.denied, p6: p6.status, p7: p7.status }));
}

// ── v5.5: 범위를 모르는 날 (2026-09-26) ─────────────────────────────────────
// 한도 찬 날 users 를 못 읽고 isolate 기억도 없으면 조용히 ['전사'] 로 떨어졌다 — 직원에겐 "부서 자료가 없다" 로 보였다.
//   이제 파이스에 uid + 범위모름 을 보내 맥의 users 백업으로 되살리게 하고, 브라우저에 범위모름·범위복구 를 돌려준다.
{
  const 맥env = { ...env, PAIS_URL: 'https://pais.test', PAIS_TOKEN: 'tok' };
  const 부르기 = (길, 토큰, 몸) => worker.fetch(new Request('https://gw.test' + 길, {
    method: 'POST', headers: { Authorization: 'Bearer ' + 토큰, 'Content-Type': 'application/json' }, body: JSON.stringify(몸) }), 맥env);
  fsStore['users/u_scopeless@sejong-21c.com'] = { name: { stringValue: '범위모름' }, dept: { stringValue: '설계부' }, grade: { stringValue: 'member' } };
  const 처음 = await makeToken('scopeless@sejong-21c.com');   // 이 isolate 가 한 번도 못 본 사람
  사용자읽기고장 = true;
  try {
    맥응답 = { 결과: [{ 점수: 0.9, 문서: '맥규격', 글: '맥조각' }], 범위복구: '백업' };
    맥에보낸몸 = null;
    const d1 = await (await 부르기('/rag/search', 처음, { query: '설계 기준', topK: 5 })).json();
    check('범위모름 v5.5: users 를 못 읽고 기억도 없으면 파이스에 uid + 범위모름 을 보낸다(범위는 전사 그대로)',
      !!맥에보낸몸 && 맥에보낸몸.uid === 'u_scopeless@sejong-21c.com' && 맥에보낸몸.범위모름 === true && JSON.stringify(맥에보낸몸.범위) === '["전사"]',
      JSON.stringify(맥에보낸몸));
    check('범위모름 v5.5: /rag/search 답에 범위모름 · 파이스의 범위복구 가 실린다',
      d1.범위모름 === true && d1.범위복구 === '백업' && (d1.matches || []).length > 0, JSON.stringify({ 범위모름: d1.범위모름, 범위복구: d1.범위복구, n: (d1.matches || []).length }));

    맥응답 = null;   // 맥이 꺼졌다 — 기록 색인으로 물러선 답에도 '실패' 가 실려야 한다
    const d2 = await (await 부르기('/rag/search', 처음, { query: '설계 기준', topK: 5 })).json();
    check('범위모름 v5.5: 파이스가 답하지 못하면 범위복구 는 실패', d2.범위모름 === true && d2.범위복구 === '실패', JSON.stringify({ 범위모름: d2.범위모름, 범위복구: d2.범위복구, source: d2.source }));

    맥응답 = { 줄: [{ n: 1 }], 쓴표: ['표01'], 범위복구: '백업' };
    맥에보낸몸 = null;
    const t1 = await (await 부르기('/rag/table', 처음, { sql: 'select 1' })).json();
    check('범위모름 v5.5: /rag/table 도 uid + 범위모름 을 보내고 범위모름 · 범위복구 를 돌려준다',
      !!맥에보낸몸 && 맥에보낸몸.uid === 'u_scopeless@sejong-21c.com' && 맥에보낸몸.범위모름 === true && t1.범위모름 === true && t1.범위복구 === '백업' && t1.줄.length === 1,
      JSON.stringify({ 몸: 맥에보낸몸, t1 }));
    맥응답 = null;
    const t2 = await (await 부르기('/rag/table', 처음, { 목록: true })).json();
    check('범위모름 v5.5: 표 서버가 꺼져도 범위모름 · 실패 가 실린다', t2.범위모름 === true && t2.범위복구 === '실패' && !!t2.error, JSON.stringify(t2));

    // 기억이 있으면(5분 캐시가 지났어도 12시간 안) 모르는 게 아니다 — 보내지도, 돌려주지도 않는다.
    맥응답 = { 결과: [{ 점수: 0.9, 문서: '맥규격', 글: '맥조각' }] };
    const 진짜now = Date.now;
    Date.now = () => 진짜now() + 6 * 60 * 1000;
    맥에보낸몸 = null;
    let d3;
    try { d3 = await (await 부르기('/rag/search', staffToken, { query: '설계 기준', topK: 5 })).json(); } finally { Date.now = 진짜now; }
    check('범위모름 v5.5: isolate 기억이 있으면 uid·범위모름 을 안 보내고 답에도 없다',
      !!맥에보낸몸 && !('uid' in 맥에보낸몸) && !('범위모름' in 맥에보낸몸) && (맥에보낸몸.범위 || []).includes('부서:생산부') && !('범위모름' in d3) && !('범위복구' in d3),
      JSON.stringify({ 몸: 맥에보낸몸, 범위모름: d3.범위모름 }));
  } finally { 사용자읽기고장 = false; 맥응답 = null; }

  // users 가 읽히는 날엔 아무것도 안 붙는다(오늘과 같다)
  맥응답 = { 결과: [{ 점수: 0.9, 문서: '맥규격', 글: '맥조각' }] };
  맥에보낸몸 = null;
  const d4 = await (await 부르기('/rag/search', 처음, { query: '설계 기준', topK: 5 })).json();
  맥응답 = null;
  check('범위모름 v5.5: users 가 읽히면 평소대로 — 범위에 부서가 실리고 범위모름 은 없다',
    !!맥에보낸몸 && !('범위모름' in 맥에보낸몸) && (맥에보낸몸.범위 || []).includes('부서:설계부') && !('범위모름' in d4), JSON.stringify(맥에보낸몸));
}

let fails = 0;
results.forEach(r => { if (!r.pass) fails++; console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   << ' + r.detail)); });
console.log('\n' + (fails ? fails + '개 실패' : '전체 ' + results.length + '개 통과'));
process.exit(fails ? 1 : 0);

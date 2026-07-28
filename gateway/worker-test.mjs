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
  if (url.startsWith(FS)) {
    const rest = url.slice(FS.length);
    if (rest === ':listCollectionIds') { // v3.2 백업: 루트 컬렉션 동적 열거
      const ids = [...new Set(Object.keys(fsStore).map(p => p.split('/')[0]))];
      return Response.json({ collectionIds: ids });
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
      const documents = Object.entries(fsStore)
        .filter(([p]) => p.startsWith(path + '/'))
        .map(([p, fields]) => ({ name: 'projects/x/databases/(default)/documents/' + p, fields }));
      return Response.json({ documents });
    }
    if (method === 'GET') {
      if (!fsStore[path]) return new Response('{}', { status: 404 });
      return Response.json({ name: 'projects/x/databases/(default)/documents/' + path, fields: fsStore[path] });
    }
    if (method === 'PATCH') { fsStore[path] = body.fields; return Response.json({ name: path }); }
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
{
  const r = await post('/rag/upload', adminToken, { docName: 'Y', chunks: Array(501).fill('x') });
  check('RAG 업로드: 501조각 → 400 거부', r.status === 400);
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

// ── 결과 출력 ───────────────────────────────────────────────────
let fails = 0;
results.forEach(r => { if (!r.pass) fails++; console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   << ' + r.detail)); });
console.log('\n' + (fails ? fails + '개 실패' : '전체 ' + results.length + '개 통과'));
process.exit(fails ? 1 : 0);

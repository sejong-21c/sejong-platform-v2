// 사내문서 검색 **권한 범위** 실물 시험 — 진짜 게이트웨이를 진짜 로그인 토큰으로 때린다.
//
// 왜 있나 (2026-09-20): 메신저에는 커튼을 쳤는데 AI 비서는 색인 전체에서 찾고 있었다.
//   넘어가는 건 {query, topK} 뿐이라 누가 묻는지조차 안 갔고, 막던 것은 AI 지침의 한 줄뿐이었다.
//   게이트웨이 v4.0 이 토큰에서 부서를 뽑아 범위를 건다. 모의 시험(gateway/worker-test.mjs)은
//   그 논리를 보고, **이 파일은 실제 배포된 워커가 정말 그렇게 하는지**를 본다.
//
// 쓰는 법:  node test/rag-scope-check.mjs
//   UID=<uid> 로 주면 파이어스토어 읽기 0. 안 주면 users 에서 찾느라 읽기 1건을 쓴다.
//   (읽기 한도가 찼을 때도 돌 수 있어야 한다 — 그날이 오히려 fail-closed 를 봐야 하는 날이다.)
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const 게이트웨이 = process.env.GW || 'https://sejong-ai-gateway.cwkim-65d.workers.dev';
const 웹키 = 'AIzaSyCmGyObjPd20Qf1MX0XAijYzSR4VitrjRg';   // 공개 값(플랫폼 HTML 에 그대로 있다)
const 계정 = process.env.CHECK_EMAIL || 'cwkim@sejong-21c.com';
const SA_PATH = process.env.SA || 'C:/Users/철우김/pais_project/data/platform-sa.json';

let 통과 = 0, 실패 = 0;
const T = (이름, 참, 메모 = '') => { if (참) 통과++; else 실패++; console.log(`  ${참 ? '✅' : '❌'} ${이름}${메모 ? ' — ' + 메모 : ''}`); };

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt(sa, 몸통) {
  const 머리 = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const 본 = b64u(JSON.stringify(몸통));
  const s = createSign('RSA-SHA256');
  s.update(머리 + '.' + 본);
  return 머리 + '.' + 본 + '.' + s.sign(sa.private_key, 'base64url');
}
async function id토큰(sa, uid) {
  const now = Math.floor(Date.now() / 1000);
  const custom = jwt(sa, {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid,
  });
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${웹키}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('ID 토큰 실패: ' + JSON.stringify(j).slice(0, 300));
  return j.idToken;
}

const sa = JSON.parse(readFileSync(SA_PATH, 'utf8').replace(/^\uFEFF/, ''));
const uid = process.env.UID || 'RWqHYJnIdmXWGj9gtCBu3yIkFAn1';   // cwkim. 다른 사람이면 UID= 로 준다
const 토큰 = await id토큰(sa, uid);
console.log(`로그인: ${계정} (${uid.slice(0, 8)}…) · 게이트웨이 ${게이트웨이}\n`);

const 검색 = async (몸) => {
  const r = await fetch(게이트웨이 + '/rag/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + 토큰, 'Content-Type': 'application/json' },
    body: JSON.stringify(몸),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

const 물음 = 'SA-516 Gr.70 판재 허용응력';
const a = await 검색({ query: 물음, topK: 3 });
T('검색이 돈다', a.status === 200 && Array.isArray(a.j.matches), `status ${a.status}`);
T('응답에 범위가 실린다', Array.isArray(a.j.범위), JSON.stringify(a.j.범위));
T('범위에 전사가 반드시 들어 있다', (a.j.범위 || []).includes('전사'), JSON.stringify(a.j.범위));
T('범위에 비밀은 절대 안 들어간다', !(a.j.범위 || []).includes('비밀'), JSON.stringify(a.j.범위));
T('코드북은 여전히 찾아진다', (a.j.matches || []).length > 0, `${(a.j.matches || []).length}건 · source=${a.j.source}`);

// **클라이언트가 스스로 넓히려는 시도** — 토큰에서만 뽑으므로 안 먹혀야 한다.
const b = await 검색({ query: 물음, topK: 3, 범위: ['전사', '비밀', '부서:영업부', '부서:생산부'] });
T('body 로 범위를 넣어도 안 넓어진다',
  JSON.stringify((b.j.범위 || []).slice().sort()) === JSON.stringify((a.j.범위 || []).slice().sort()),
  `보낸 것 4개 → 실제 ${JSON.stringify(b.j.범위)}`);

// 로그인 없이는 아예 막혀야 한다
const c = await fetch(게이트웨이 + '/rag/search', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 물음 }),
});
T('로그인 없으면 401', c.status === 401, `status ${c.status}`);

console.log(`\n${통과}/${통과 + 실패} 통과`);
if ((a.j.범위 || []).length === 1) {
  console.log('\n※ 범위가 [전사] 하나뿐입니다. 부서가 안 붙은 것인데, 둘 중 하나입니다:');
  console.log('   (1) 파이어스토어 읽기 한도가 차서 users 조회가 막혔다 → 설계대로 좁은 쪽으로 물러선 것(정상)');
  console.log('   (2) FIREBASE_SA_KEY 가 없거나 users/<uid> 에 dept 가 없다');
}
process.exit(실패 ? 1 : 0);

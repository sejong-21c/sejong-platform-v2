// 첨부 왕복 시험 — 올리기 → 서명 → 내려받기 → 바이트 대조. (2026-09-19)
//
// 왜 있나: 첨부를 파이어베이스 밖(R2)으로 옮겼는데, 게이트웨이의 /file/* 는 만들어 놓고
//   **한 번도 실물로 증명한 적이 없었다.** 올리기만 되고 되읽기가 안 되면 조용히 파일이 날아간다
//   (올리기 실패는 옛 조각 방식으로 물러서지만, 되읽기 실패는 물러설 데가 없다).
//
// 쓰는 법:  node test/r2-attach-check.mjs
//   서비스 계정 키(pais_project/data/platform-sa.json)로 사내 계정의 ID 토큰을 만들어
//   진짜 게이트웨이를 때린다. 올린 시험 파일은 지우지 않는다(R2 에 /file/delete 가 없다) —
//   키가 att/_check/ 로 시작하니 나중에 한꺼번에 지우면 된다.
import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const 게이트웨이 = process.env.GW || 'https://sejong-ai-gateway.cwkim-65d.workers.dev';
const 웹키 = 'AIzaSyCmGyObjPd20Qf1MX0XAijYzSR4VitrjRg';   // 공개 값(플랫폼 HTML 에 그대로 있다)
const 계정 = process.env.CHECK_EMAIL || 'cwkim@sejong-21c.com';
const SA_PATH = process.env.SA || 'C:/Users/철우김/pais_project/data/platform-sa.json';

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt(sa, 몸통) {
  const 머리 = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const 본 = b64u(JSON.stringify(몸통));
  const s = createSign('RSA-SHA256');
  s.update(머리 + '.' + 본);
  return 머리 + '.' + 본 + '.' + s.sign(sa.private_key, 'base64url');
}
async function 구글토큰(sa) {
  const now = Math.floor(Date.now() / 1000);
  const a = jwt(sa, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: a }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('SA 토큰 실패: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}
// uid 는 파이어스토어 users/<uid> 에서 찾는다 — 서비스 계정(pais-reader)은 읽기 전용이라
// Identity Toolkit 의 accounts:lookup 은 권한이 없다(INSUFFICIENT_PERMISSION). 읽기 1건.
async function 사용자uid(sa, at) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: 계정 } } },
      limit: 1,
    } }),
  });
  const j = await r.json();
  const 이름 = (Array.isArray(j) ? j : []).map((x) => x.document && x.document.name).find(Boolean);
  if (!이름) throw new Error('users 에 그런 계정이 없습니다: ' + 계정 + ' / ' + JSON.stringify(j).slice(0, 250));
  return 이름.split('/').pop();
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

const 결과 = [];
const 확인 = (이름, 참, 덧 = '') => { 결과.push([참, 이름, 덧]); console.log((참 ? '  ✅ ' : '  ❌ ') + 이름 + (덧 ? ' — ' + 덧 : '')); };

const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
const at = await 구글토큰(sa);
const uid = process.env.UID || await 사용자uid(sa, at);   // UID= 로 넘기면 파이어스토어를 안 읽는다(한도 소진 중에도 됨)
const idt = await id토큰(sa, uid);
console.log(`로그인: ${계정} (${uid.slice(0, 8)}…) · 게이트웨이 ${게이트웨이}`);

const 키 = `att/_check/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${randomUUID().replace(/-/g, '')}`;
const 내용 = Buffer.from('세종 첨부 왕복 시험 ' + new Date().toISOString() + ' ' + 'x'.repeat(5000));

// 1) 올리기
let r = await fetch(`${게이트웨이}/file/put?key=${encodeURIComponent(키)}`, {
  method: 'PUT', headers: { Authorization: 'Bearer ' + idt, 'Content-Type': 'text/plain' }, body: 내용,
});
확인('올리기 200', r.status === 200, 'status=' + r.status + ' ' + (await r.text()).slice(0, 120));

// 2) 로그인 없이 올리기는 막힌다
r = await fetch(`${게이트웨이}/file/put?key=${encodeURIComponent(키)}x`, { method: 'PUT', body: 'nope' });
확인('로그인 없는 올리기 401', r.status === 401, 'status=' + r.status);

// 3) 서명 받기
r = await fetch(`${게이트웨이}/file/sign`, {
  method: 'POST', headers: { Authorization: 'Bearer ' + idt, 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: [키] }),
});
const 서명 = await r.json();
const 주소 = (서명.urls || {})[키];
확인('서명 주소 받음', !!주소, 주소 ? 주소.slice(0, 80) + '…' : JSON.stringify(서명).slice(0, 150));

// 4) 서명된 주소로 내려받기 — 바이트가 같아야 한다
if (주소) {
  r = await fetch(주소);
  const 받은 = Buffer.from(await r.arrayBuffer());
  확인('내려받기 200', r.status === 200, 'status=' + r.status);
  확인('바이트 동일', 받은.equals(내용), `보낸 ${내용.length}B · 받은 ${받은.length}B`);
  확인('Content-Type 유지', (r.headers.get('content-type') || '').startsWith('text/plain'), r.headers.get('content-type') || '(없음)');

  // 5) 서명을 한 글자 바꾸면 못 받는다
  const 망친 = 주소.replace(/s=([0-9a-f])/, (m, c) => 's=' + (c === '0' ? '1' : '0'));
  확인('서명 틀리면 403', (await fetch(망친)).status === 403);
  // 6) 만료된 주소도 못 받는다
  확인('만료면 403', (await fetch(주소.replace(/e=\d+/, 'e=1'))).status === 403);
}

// 7) 서명 없이 직접은 못 받는다
확인('서명 없이 403', (await fetch(`${게이트웨이}/file/get/${키}`)).status === 403);

const 실패 = 결과.filter(([ok]) => !ok);
console.log(`\n${결과.length - 실패.length}/${결과.length} 통과`);
process.exit(실패.length ? 1 : 0);

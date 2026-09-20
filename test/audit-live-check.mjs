// 게시된 **운영 규칙**이 정말 감사 이력을 강제하는지 실물로 확인한다. (2026-09-20)
//   node test/audit-live-check.mjs
//
// 왜 따로 있나: test/rules.test.mjs 는 에뮬레이터에 규칙 파일을 걸고 본다. 콘솔에 붙여넣은
//   내용이 그 파일과 같다는 보장은 없다 — 2026-07-17 wbsHistory 사고가 정확히 그 불일치였다.
//   그래서 **배포된 규칙**에 진짜 로그인 토큰으로 직접 부딪쳐 본다.
//
// 읽기를 거의 안 쓴다(거부는 읽기로 안 세고, 쓰기는 별도 한도다). 한도가 찬 날에도 돌릴 수 있다.
// 시험 흔적: t_ncrs/zz_audit_check 문서 하나를 만들고 마지막에 지운다.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const 웹키 = 'AIzaSyCmGyObjPd20Qf1MX0XAijYzSR4VitrjRg';   // 공개 값(플랫폼 HTML 에 그대로 있다)
const SA_PATH = process.env.SA || 'C:/Users/철우김/pais_project/data/platform-sa.json';
const uid = process.env.UID || 'RWqHYJnIdmXWGj9gtCBu3yIkFAn1';
const 시험문서 = 'zz_audit_check';

let 통과 = 0, 실패 = 0;
const T = (이름, 참, 메모 = '') => { if (참) 통과++; else 실패++; console.log(`  ${참 ? '✅' : '❌'} ${이름}${메모 ? ' — ' + 메모 : ''}`); };

const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt(sa, 몸통) {
  const 머리 = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const 본 = b64u(JSON.stringify(몸통));
  const s = createSign('RSA-SHA256'); s.update(머리 + '.' + 본);
  return 머리 + '.' + 본 + '.' + s.sign(sa.private_key, 'base64url');
}
const sa = JSON.parse(readFileSync(SA_PATH, 'utf8').replace(/^\uFEFF/, ''));
const now = Math.floor(Date.now() / 1000);
const custom = jwt(sa, {
  iss: sa.client_email, sub: sa.client_email,
  aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  iat: now, exp: now + 3600, uid,
});
const 로그인 = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${웹키}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: custom, returnSecureToken: true }),
})).json();
if (!로그인.idToken) throw new Error('ID 토큰 실패: ' + JSON.stringify(로그인).slice(0, 200));

const 뿌리 = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const 값 = (v) => (typeof v === 'number' && Number.isInteger(v) ? { integerValue: String(v) }
  : typeof v === 'number' ? { doubleValue: v }
  : typeof v === 'boolean' ? { booleanValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(값) } }
  : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, 값(x)])) } }
  : { stringValue: String(v) });
async function 쓰기(경로, 필드, 마스크) {
  const q = 마스크 ? '?' + 마스크.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&') : '';
  const r = await fetch(`${뿌리}/${경로}${q}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + 로그인.idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(필드).map(([k, v]) => [k, 값(v)])) }),
  });
  return r.status;
}
const 지우기 = async (경로) => (await fetch(`${뿌리}/${경로}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + 로그인.idToken } })).status;

console.log(`운영 규칙 실물 확인 · uid ${uid.slice(0, 8)}…\n`);
try {
  T('기록을 만들 수 있다', [200].includes(await 쓰기(`t_ncrs/${시험문서}`, { title: '규칙 확인용', rev: 1 })));
  const 그대로 = await 쓰기(`t_ncrs/${시험문서}`, { title: '판 안 올리고 고침', rev: 1 });
  T('**판을 안 올리면 거부된다**', 그대로 === 403, `status ${그대로}`);
  const 내림 = await 쓰기(`t_ncrs/${시험문서}`, { title: '판 내림', rev: 0 });
  T('판을 내려도 거부', 내림 === 403, `status ${내림}`);
  const 없음 = await 쓰기(`t_ncrs/${시험문서}`, { title: '판 없음' }, ['title']);
  T('판 없이 고치면 거부', 없음 === 403, `status ${없음}`);
  const 올림 = await 쓰기(`t_ncrs/${시험문서}`, { title: '제대로 고침', rev: 2 });
  T('판을 올리면 저장된다', 올림 === 200, `status ${올림}`);

  const 이력 = `t_recordLog/zz_audit_${Date.now()}`;
  T('이력은 덧붙일 수 있다',
    (await 쓰기(이력, { coll: 't_ncrs', recId: 시험문서, act: '고침', by: uid, at: Date.now(), rev: 2 })) === 200);
  T('**이력은 고칠 수 없다**', (await 쓰기(이력, { note: '몰래 고침' }, ['note'])) === 403);
  T('**이력은 지울 수 없다**', (await 지우기(이력)) === 403);
  T('이력을 남의 이름으로 못 쓴다',
    (await 쓰기(`t_recordLog/zz_audit_fake_${Date.now()}`, { coll: 't_ncrs', recId: 'x', act: '고침', by: 'someone_else', at: Date.now() })) === 403);
  T('이력에 이상한 행위는 못 넣는다',
    (await 쓰기(`t_recordLog/zz_audit_bad_${Date.now()}`, { coll: 't_ncrs', recId: 'x', act: '조작', by: uid, at: Date.now() })) === 403);
} finally {
  const s = await 지우기(`t_ncrs/${시험문서}`);
  console.log(`\n시험 문서 정리 — status ${s}`);
}
console.log(`${통과}/${통과 + 실패} 통과`);
process.exit(실패 ? 1 : 0);

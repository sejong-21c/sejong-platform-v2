// 첨부를 파이어베이스 **밖**에 둔다 — 2026-09-19 (2단계 첫 절반).
//
// 왜: 지금 첨부는 base64 를 700KB 씩 잘라 `chunk__*` 문서로 컬렉션 안에 같이 넣는다.
//     그래서 컬렉션을 한 번 훑으면 하루 읽기 5만이 통째로 날아가고(9/19 백업 사고),
//     송신 10GiB/월도 조각 몇 만 개면 하룻밤에 태운다. 백업도 못 한다.
//     → 원칙: **큰 것은 DB 밖으로, DB 에는 가리키는 글자만.**
//
// 왜 R2 인가 (계획서는 "구글 드라이브" 라고 적었다):
//     게이트웨이에 `/file/put`·`/file/sign`·`/file/get` 이 **이미 있고** 버킷(FILES)도 붙어 있다.
//     브라우저에서 드라이브에 쓰려면 drive.file 동의화면 등록 + 공유드라이브 부모 문제
//     (drive.file 로는 앱이 안 만든 폴더에 못 넣는다)를 먼저 풀어야 한다 — 오늘 피가 안 멎는다.
//     드라이브는 **서버(맥미니 서비스계정)** 몫으로 남긴다: 기존 조각 이관·백업. 거기선 그 문제가 없다.
//
// 함정 — 부르는 쪽이 반드시 지킬 것:
//     사내 PC 중 **workers.dev 가 막힌 기기가 있다**(2026-07-24 신채완 과장). 여기서는 던지기만 하니
//     부르는 쪽은 실패하면 **옛 조각 방식으로 물러서야** 한다. 안 그러면 그 자리에서 첨부가 영영 안 된다.
//
// 열쇠 모양: `att/<갈래>/<yyyymmdd>/<시각><난수>` — 게이트웨이 `안전한키` 는 `[A-Za-z0-9._\-/]` 만
//     받으므로 **파일 이름을 키에 넣지 않는다**(한글 이름이면 400). 이름·크기는 DB 쪽 기록에 남긴다.

const 기본게이트웨이 = 'https://sejong-ai-gateway.cwkim-65d.workers.dev';
const 앞자리 = 'att/';
const 올리기제한밀리초 = 15000;   // 막힌 PC 에서 빨리 포기하고 옛 방식으로 물러서게

function 게이트웨이() {
  try { return (localStorage.getItem('sjp_ai_gateway_url') || '').trim().replace(/\/+$/, '') || 기본게이트웨이; }
  catch (e) { return 기본게이트웨이; }
}

async function 토큰() {
  const u = window.fb && window.fb.auth && window.fb.auth.currentUser;
  if (!u) throw new Error('로그인 상태가 아닙니다');
  return await u.getIdToken();
}

/** 이 첨부가 DB 밖(R2)에 있는가 — 옛 `chunk__` 조각과 구분한다. */
export function 밖에있나(키) { return typeof 키 === 'string' && 키.startsWith(앞자리); }

export function 새열쇠(갈래) {
  const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const 갈 = String(갈래 || 'etc').replace(/[^A-Za-z0-9_-]/g, '') || 'etc';
  return `${앞자리}${갈}/${d}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * File 또는 Blob 을 올리고 열쇠를 돌려준다. 실패하면 던진다(부르는 쪽이 옛 방식으로 물러선다).
 * @returns {Promise<string>} 열쇠
 */
export async function 올리기(파일, 갈래) {
  const 열쇠 = 새열쇠(갈래);
  const t = await 토큰();
  const r = await fetch(`${게이트웨이()}/file/put?key=${encodeURIComponent(열쇠)}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 파일.type || 'application/octet-stream' },
    body: 파일,
    signal: AbortSignal.timeout(올리기제한밀리초),
  });
  if (!r.ok) throw new Error(`파일 저장소 응답 ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  // **올린 뒤 바로 되읽어 본다.** 올리기 실패는 부르는 쪽이 옛 조각 방식으로 물러설 수 있지만,
  // "올라간 줄 알았는데 못 읽는" 경우는 물러설 데가 없다 — 그때는 첨부가 조용히 사라진다.
  // HEAD 라 본문은 안 받는다(8MB 를 다시 받지 않는다). 서명 확인까지 같이 된다.
  const 확인 = await fetch(await 주소(열쇠), { method: 'HEAD', signal: AbortSignal.timeout(올리기제한밀리초) });
  if (!확인.ok) throw new Error(`올렸는데 되읽기 ${확인.status} — 첨부를 저장소에 맡기지 않는다`);
  return 열쇠;
}

/** dataURL 문자열을 올린다(이미 base64 로 들고 있는 곳용). */
export async function 글자올리기(dataUrl, 갈래) {
  const m = /^data:([^;,]*)[^,]*,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('dataURL 이 아닙니다');
  const 형 = m[1] || 'application/octet-stream';
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return await 올리기(new Blob([buf], { type: 형 }), 갈래);
}

/** 열쇠 여러 개를 한 번에 서명받는다(50개까지) → { 열쇠: 주소 }. 주소 수명 1시간. */
export async function 주소들(열쇠들) {
  const ks = (열쇠들 || []).filter(밖에있나);
  if (!ks.length) return {};
  const t = await 토큰();
  const r = await fetch(`${게이트웨이()}/file/sign`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ks.slice(0, 50) }),
    signal: AbortSignal.timeout(올리기제한밀리초),
  });
  if (!r.ok) throw new Error(`서명 실패 ${r.status}`);
  return (await r.json()).urls || {};
}

/** 열쇠 하나 → 열어볼 수 있는 주소. */
export async function 주소(열쇠) {
  const u = (await 주소들([열쇠]))[열쇠];
  if (!u) throw new Error('주소를 받지 못했습니다');
  return u;
}

/** 바이트가 꼭 필요한 곳(인쇄에 박기 등)만. 화면에 보여 줄 뿐이면 주소() 를 쓴다. */
export async function 데이터URL(열쇠) {
  const r = await fetch(await 주소(열쇠));
  if (!r.ok) throw new Error(`내려받기 ${r.status}`);
  const b = await r.blob();
  return await new Promise((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = () => no(new Error('읽기 실패'));
    fr.readAsDataURL(b);
  });
}

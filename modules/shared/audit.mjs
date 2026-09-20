// 품질기록 변경 이력 — 누가·언제·무엇을·어느 판에서 바꿨는지 남긴다. 2026-09-20.
//
// 왜 필요한가:
//   지금 NCR·CAR 을 고치면 **그냥 덮어쓴다.** 이력이 없다. 외부 심사원이
//   "이 CAR 이 언제 누구에 의해 어떻게 바뀌었나" 를 물으면 답할 자료가 없다.
//   ISO 9001:2015 **7.5.3(문서화된 정보의 관리)** 과 업계 eQMS 기준이 요구하는 것:
//     · 누가, 무슨 행위를, 언제, **어느 판의 문서에**, 어떤 증거를 붙여서
//     · 기록은 **변조가 드러나야** 한다 — 변경은 조용히 덮어쓰는 게 아니라 기록된다
//   (근거: 방향-점검-2026-09-20.md A-2)
//
// 어떻게:
//   · 기록을 저장할 때마다 `t_recordLog` 에 한 줄 **덧붙인다.** 고치기·지우기는 규칙에서 막는다.
//   · 기록 문서에 `판`(정수)을 올린다. 규칙이 "저장할 때 판이 반드시 커져야 한다"를 강제하므로
//     **판을 안 올리고 몰래 덮어쓰는 길이 막힌다.**
//
// 반드시 지킬 것:
//   ① **본문(base64·사진·첨부)을 이력에 담지 않는다.** 담으면 이력 컬렉션이 곧 두 번째 폭탄이 된다
//      (9/19 사고가 정확히 그 모양이었다). 큰 값은 "바뀜" 이라고만 적는다.
//   ② 이력 쓰기가 실패해도 **기록 저장은 막지 않는다.** 이력 때문에 현장 업무가 멈추면 안 된다.
//      대신 콘솔과 화면 알림에 남긴다 — 조용히 사라지는 게 제일 나쁘다.

export const 이력컬렉션 = 't_recordLog';

const 긴값 = 200;                 // 이보다 길면 잘라서 적는다
const 최대칸 = 40;                // 한 번에 적을 칸 수 상한(통째로 바뀐 경우 대비)
// 본문에 큰 덩어리가 들어 있는 칸 — 값은 절대 안 적고 "바뀜" 으로만 남긴다.
const 무거운칸 = /^(imgStore|imgStoreChunks|photos|attachments|files|thumb|thumbnail|dataUrl|base64)/i;

const 값짧게 = (v) => {
  if (v === undefined) return '(없음)';
  if (v === null) return '(빈값)';
  if (typeof v === 'string') return v.length > 긴값 ? v.slice(0, 긴값) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 긴값 ? s.slice(0, 긴값) + '…' : s;
  } catch (e) { return '(읽을 수 없음)'; }
};

/** 두 기록을 견줘 **바뀐 칸만** 뽑는다. 무거운 칸은 값 없이 "바뀜" 으로. */
export function 달라진것(전, 후) {
  const 전것 = 전 || {}, 후것 = 후 || {};
  const 칸들 = Array.from(new Set([...Object.keys(전것), ...Object.keys(후것)]));
  const out = [];
  for (const k of 칸들) {
    if (k === 'rev' || k === 'revAt' || k === 'revBy') continue;   // 이력 자체가 만드는 값
    const a = 전것[k], b = 후것[k];
    let 같나;
    try { 같나 = JSON.stringify(a) === JSON.stringify(b); } catch (e) { 같나 = a === b; }
    if (같나) continue;
    if (무거운칸.test(k)) { out.push({ 칸: k, 전: '(내용 생략)', 후: '(바뀜)' }); continue; }
    out.push({ 칸: k, 전: 값짧게(a), 후: 값짧게(b) });
    if (out.length >= 최대칸) { out.push({ 칸: '…', 전: '', 후: `그 밖에 ${칸들.length - out.length}칸` }); break; }
  }
  return out;
}

/** 다음 판 번호. 없거나 이상하면 1부터. (규칙이 "반드시 커져야 한다"를 본다)
 *  **필드 이름은 아스키(rev)다.** 보안 규칙 언어가 한글 필드 이름을 못 읽는다 —
 *  `request.resource.data.판` 을 쓰면 규칙 컴파일이 통째로 실패한다(2026-09-20 시험대가 잡았다).
 *  파이어스토어 마스크 경로·R2 열쇠·sh 변수에 이어 **다섯 번째 같은 함정**이다. */
export const 다음판 = (기록) => {
  const n = Number(기록 && 기록.rev);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) + 1 : 1;
};

function 지금사람() {
  try {
    const u = (window.fb && window.fb.auth && window.fb.auth.currentUser) || null;
    return { uid: (u && u.uid) || '', 이름: (u && (u.displayName || u.email)) || '' };
  } catch (e) { return { uid: '', 이름: '' }; }
}

/**
 * 이력 한 줄을 덧붙인다. **절대 던지지 않는다** — 기록 저장을 막으면 안 된다.
 *   무엇: '만듦' | '고침' | '지움'
 */
export async function 남기기({ 컬렉션, 기록id, 무엇, 전 = null, 후 = null, 판 = null, 메모 = '' }) {
  try {
    const fb = window.fb;
    if (!fb || !fb.db || !fb.setDoc) return false;
    const 사람 = 지금사람();
    if (!사람.uid) return false;                      // 로그인 전이면 안 남긴다(규칙도 막는다)
    const 때 = Date.now();
    const id = `${컬렉션}_${기록id}_${때}_${Math.random().toString(36).slice(2, 6)}`;
    // **키는 아스키, 값은 한국어.** 규칙이 키를 파싱하기 때문이다(위 다음판 주석 참고).
    const 줄 = {
      coll: String(컬렉션), recId: String(기록id), act: String(무엇),
      rev: Number(판 != null ? 판 : 다음판(후)),
      by: 사람.uid, byName: 사람.이름,
      atISO: new Date(때).toISOString(), at: 때,
      ...(메모 ? { note: String(메모).slice(0, 300) } : {}),
      changes: 무엇 === '고침' ? 달라진것(전, 후) : [],
    };
    await fb.setDoc(fb.doc(fb.db, 이력컬렉션, id), 줄);
    return true;
  } catch (e) {
    // 조용히 사라지면 "이력이 있다" 고 믿다가 심사에서 없는 걸 알게 된다.
    console.error('[이력] 남기지 못했습니다 —', e && e.message ? e.message : e);
    try { if (window.notifySyncError) window.notifySyncError('변경 이력을 남기지 못했습니다: ' + (e.message || e)); } catch (e2) { /* 알림이 없는 화면도 있다 */ }
    return false;
  }
}

// ── 셀프체크 (브라우저·파이어베이스 없이 논리만) ──────────────────────────────
//   node modules/shared/audit.mjs
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('audit.mjs')) {
  let 실패 = 0;
  const T = (이름, 참, 메모 = '') => { if (!참) 실패++; console.log(`${참 ? 'PASS' : 'FAIL'}  ${이름}${메모 ? '  — ' + 메모 : ''}`); };

  T('안 바뀌면 빈 목록', 달라진것({ a: 1 }, { a: 1 }).length === 0);
  T('바뀐 칸만 집는다', JSON.stringify(달라진것({ a: 1, b: 2 }, { a: 1, b: 3 })) === JSON.stringify([{ 칸: 'b', 전: '2', 후: '3' }]));
  T('새 칸도 잡는다', 달라진것({}, { 상태: '진행' })[0].전 === '(없음)');
  T('지운 칸도 잡는다', 달라진것({ 상태: '진행' }, {})[0].후 === '(없음)');
  const 무거움 = 달라진것({ imgStore: { a: 'x'.repeat(5000) } }, { imgStore: { a: 'y'.repeat(5000) } });
  T('무거운 칸은 값을 안 적는다', 무거움[0].후 === '(바뀜)' && !JSON.stringify(무거움).includes('yyyy'),
    '사진 base64 가 이력에 들어가면 이력 컬렉션이 두 번째 폭탄이 된다');
  T('긴 글은 자른다', 달라진것({ 내용: '가' }, { 내용: '나'.repeat(1000) })[0].후.length <= 201);
  T('판·바뀐때는 이력에 안 적는다', 달라진것({ rev: 1, revAt: 'a' }, { rev: 2, revAt: 'b' }).length === 0,
    '이력이 만든 값을 이력에 또 적으면 노이즈다');
  T('판은 0 부터 1 로', 다음판({}) === 1 && 다음판({ rev: 0 }) === 1 && 다음판({ rev: 7 }) === 8);
  T('이상한 판은 1 로', 다음판({ rev: 'x' }) === 1 && 다음판(null) === 1);
  T('필드 이름이 전부 아스키다', ['coll','recId','act','rev','by','byName','atISO','at','note','changes'].every((k) => [...k].every((c) => c.codePointAt(0) < 128)),
    '보안 규칙 언어가 한글 필드 이름을 못 읽는다 — 규칙이 통째로 컴파일 실패한다');
  const 많음 = 달라진것(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, i])),
                        Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, i + 1])));
  T('칸이 너무 많으면 잘라서 요약', 많음.length <= 41 && 많음[많음.length - 1].칸 === '…', `${많음.length}칸`);

  console.log(실패 ? `\n실패 ${실패}건` : '\n전부 통과');
  process.exit(실패 ? 1 : 0);
}

// AI 비서 — 수정 권한·검증 순수 함수 (로드맵 17-a, 2026-08-21)
// ai-assistant.js의 인라인본과 반드시 동기 유지 (tool-calc.mjs와 같은 관례).
// 검증: node test/ai-perm.test.mjs — 이 테스트가 안 돌면 17단계는 완료가 아니다.

// 관리자 판정은 실측 기준 grade(super/exec)다 — 설계서 초안의 role==='admin'은
// 실제 데이터와 다름 (role은 '현장소장' 같은 자유 직책 문자열).
export function judgeEditProject(me, proj, users) {
  me = me || {};
  if (!me.id) return { ok: false, why: '로그인 정보를 읽지 못했습니다 — 새로고침 후 다시 시도해주세요' };
  if (me.grade === 'super' || me.grade === 'exec') return { ok: true, why: '관리자' };
  if (proj && proj.pm && proj.pm === me.id) return { ok: true, why: '이 프로젝트 PM' };
  // 거부는 친절하게 — 누가 할 수 있는지 알려준다
  var pm = (users || []).find(function (u) { return u.id === (proj && proj.pm); });
  return {
    ok: false,
    why: pm
      ? ('이 프로젝트의 PM은 ' + pm.name + '님입니다 — PM 또는 관리자만 일정을 바꿀 수 있습니다')
      : '이 프로젝트의 PM 또는 관리자만 일정을 바꿀 수 있습니다',
  };
}

// 날짜 형식·순서·무변경(파이스 교훈 ②: 같은 값 되풀이 쓰기 차단)을 한 번에 판정.
// 성공 시 { ok:true, updates:{start?, end?} } — 실제로 바뀌는 필드만 담는다.
export function checkScheduleChange(proj, start, end) {
  var D = /^\d{4}-\d{2}-\d{2}$/;
  proj = proj || {};
  var upd = {};
  var given = false;
  if (start != null && String(start).trim() !== '') {
    given = true; start = String(start).trim();
    if (!D.test(start)) return { ok: false, why: '시작일 형식이 잘못됐습니다 (YYYY-MM-DD로 주세요): ' + start };
    if (start !== proj.start) upd.start = start;
  }
  if (end != null && String(end).trim() !== '') {
    given = true; end = String(end).trim();
    if (!D.test(end)) return { ok: false, why: '마감일 형식이 잘못됐습니다 (YYYY-MM-DD로 주세요): ' + end };
    if (end !== proj.end) upd.end = end;
  }
  if (!given) return { ok: false, why: '바꿀 날짜(시작일 또는 마감일)를 알려주세요.' };
  if (!Object.keys(upd).length) return { ok: false, why: '이미 그 값입니다 — 바뀌는 내용이 없습니다.' };
  var ns = upd.start || proj.start, ne = upd.end || proj.end;
  if (ns && ne && ns > ne) return { ok: false, why: '시작일(' + ns + ')이 마감일(' + ne + ')보다 늦습니다 — 날짜를 확인해주세요.' };
  return { ok: true, updates: upd };
}

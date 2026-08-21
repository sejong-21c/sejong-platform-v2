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

// 업무 수정 권한 — 같은 문지기 + '내 업무는 내가 넘길 수 있다' 한 겹 (17-b).
export function judgeEditTask(me, task, proj, users) {
  me = me || {};
  if (!me.id) return { ok: false, why: '로그인 정보를 읽지 못했습니다 — 새로고침 후 다시 시도해주세요' };
  if (me.grade === 'super' || me.grade === 'exec') return { ok: true, why: '관리자' };
  if (task && task.assignee === me.id) return { ok: true, why: '내 업무' };
  if (proj && proj.pm && proj.pm === me.id) return { ok: true, why: '이 프로젝트 PM' };
  var who = (users || []).find(function (u) { return u.id === (task && task.assignee); });
  return {
    ok: false,
    why: who
      ? ('이 업무 담당자는 ' + who.name + '님입니다 — 담당자·PM·관리자만 바꿀 수 있습니다')
      : '이 업무의 담당자·PM 또는 관리자만 바꿀 수 있습니다',
  };
}

// 프로젝트 상태·진행률 변경 판정 (17-b).
// wbsProgress: WBS로 계산된 진척률. WBS 행이 없으면 null.
//   ⚠️ index.html reconcileProjectProgress()가 WBS가 있는 프로젝트의 progress/status를
//   주기적으로 덮어쓴다 — 그래서 충돌하는 값은 아예 거부한다(조용한 되돌림 방지).
const PROJ_STATUS = { active: '진행중', done: '완료', 'pre-close': '마감예정' };
export function checkProjectStatusChange(proj, status, progress, wbsProgress) {
  proj = proj || {};
  var upd = {}, given = false;
  if (status != null && String(status).trim() !== '') {
    given = true;
    var s = String(status).trim();
    if (!PROJ_STATUS[s]) {                      // 한글 라벨도 받아준다
      var hit = Object.keys(PROJ_STATUS).find(function (k) { return PROJ_STATUS[k] === s; });
      if (!hit) return { ok: false, why: '상태는 진행중·완료·마감예정 중 하나여야 합니다 (받은 값: ' + s + ')' };
      s = hit;
    }
    if (wbsProgress != null && s === 'done' && wbsProgress < 100) {
      return { ok: false, why: 'WBS 진척률이 ' + wbsProgress + '%라 완료로 바꾸면 자동으로 되돌아갑니다 — WBS를 100%로 채우거나 마감예정을 쓰세요.' };
    }
    if (wbsProgress != null && s === 'active' && wbsProgress >= 100) {
      return { ok: false, why: 'WBS 진척률이 100%라 진행중으로 바꾸면 자동으로 되돌아갑니다 — WBS를 먼저 조정하세요.' };
    }
    if (s !== (proj.status || 'active')) upd.status = s;
  }
  if (progress != null && String(progress).trim() !== '') {
    given = true;
    var n = Number(progress);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, why: '진행률은 0~100 사이 숫자여야 합니다 (받은 값: ' + progress + ')' };
    n = Math.round(n);
    if (wbsProgress != null) {
      return { ok: false, why: '이 프로젝트 진행률은 WBS에서 자동 계산됩니다(현재 ' + wbsProgress + '%) — 여기서 바꿔도 되돌아가니 WBS 화면에서 조정하세요.' };
    }
    if (n !== (proj.progress || 0)) upd.progress = n;
  }
  if (!given) return { ok: false, why: '바꿀 상태나 진행률을 알려주세요.' };
  if (!Object.keys(upd).length) return { ok: false, why: '이미 그 값입니다 — 바뀌는 내용이 없습니다.' };
  return { ok: true, updates: upd, label: upd.status ? PROJ_STATUS[upd.status] : null };
}

// 업무 담당자·마감일 변경 판정 (17-b). assigneeId는 호출부에서 이름→id로 이미 찾아 넘긴다.
export function checkReassign(task, assigneeId, due) {
  var D = /^\d{4}-\d{2}-\d{2}$/;
  task = task || {};
  var upd = {}, given = false;
  if (assigneeId != null && String(assigneeId).trim() !== '') {
    given = true;
    var a = String(assigneeId).trim();
    if (a !== task.assignee) upd.assignee = a;
  }
  if (due != null && String(due).trim() !== '') {
    given = true;
    var d = String(due).trim();
    if (!D.test(d)) return { ok: false, why: '마감일 형식이 잘못됐습니다 (YYYY-MM-DD로 주세요): ' + d };
    if (d !== task.due) upd.due = d;
  }
  if (!given) return { ok: false, why: '바꿀 담당자나 마감일을 알려주세요.' };
  if (!Object.keys(upd).length) return { ok: false, why: '이미 그 값입니다 — 바뀌는 내용이 없습니다.' };
  return { ok: true, updates: upd };
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

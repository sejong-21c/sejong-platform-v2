// 읽기 누수 자리 셋이 되돌아오지 않게(b110, 2026-09-26 — 그날 콘솔 읽기 16만 vs 장부 9천).
//   ① 한 번 조회(getDoc·getDocs·getCountFromServer)도 계량기로 센다 ② 관리 탭 기록 화면은 5분 쥐고 기준 시각은 날짜로
//   ③ QA 문서 생성기는 5초 폴링 대신 문서 구독. 셋 다 틀어져도 화면은 멀쩡해서 **조용히** 한도만 태운다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const 본체 = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// 9/26: rebase 충돌 표시(<<<<<<< ======= >>>>>>>)가 남은 index.html 이 **그대로 올라갔다** — npm test 는 통과했다. 이제 여기서 걸린다.
assert.ok(!/^(<{7}|={7}|>{7})( |$)/m.test(본체), 'index.html 에 병합 충돌 표시가 남아 있다');
const fb묶음 = (본체.match(/window\.fb = \{[\s\S]*?\n  \};/) || [''])[0];
assert.ok(/getDoc: 감싼getDoc\b/.test(fb묶음) && /getDocs: 감싼getDocs\b/.test(fb묶음), 'window.fb 의 getDoc·getDocs 는 감싼 것이어야 한다(한 번 조회 계량)');
// ⚠ '감싼세기' 뒤엔 \b 를 못 쓴다 — 정규식 \b 는 한글 경계에 안 걸린다(처음 판에서 그래서 멀쩡한 코드를 틀렸다고 했다)
assert.ok(/getCountFromServer: 감싼세기,/.test(fb묶음), 'window.fb 의 getCountFromServer 도 감싼 것이어야 한다');
assert.ok(/window\.한번읽기셈 = function/.test(본체) && /_읽기장부\["한번읽기"\]/.test(본체), '감싸기가 넘기는 수를 계량기(_읽기장부)가 받아야 한다');
assert.ok(본체.includes('if (서버에서(s)) 한번셈(1, Math.max(1, s.size));'), '한 번 조회는 과금 1(아래로 센 값) · 결과 건수는 상한으로 따로 — 재개 토큰이면 실제 과금은 더 적다(부풀리지 않는다)');
assert.ok(본체.includes('browserOnceMax: fb.increment(상한델타)'), '상한은 장부의 따로 칸(browserOnceMax)으로 간다 — browser 에 섞지 않는다');

const 관리 = (본체.match(/async function _admFetch30d[\s\S]*?\nasync function _adm30일읽기[\s\S]*?\n}/) || [''])[0];
assert.ok(관리 && 관리.includes('_adm보관[colName]') && 관리.includes('5 * 60e3'), '관리 기록 화면은 5분 쥔다(다시 그릴 때마다 300건을 다시 읽지 않는다)');
assert.ok(관리.indexOf('if (_adm읽는중[colName]) return') > 0 && 관리.indexOf('if (_adm읽는중[colName]) return') < 관리.indexOf('const 쥔 = _adm보관[colName]'), '읽는 중이면 새로고침도 합류한다(겹치면 두 번 읽거나 옛 보관이 새 결과를 가린다)');
assert.ok(관리.includes('오늘0시.getTime() - 30 * 24') && !관리.includes('const since = Date.now()'), '기준 시각은 날짜로 내린다(매번 다른 쿼리면 캐시가 못 먹는다)');
assert.ok(본체.includes('onclick="loadAdminTab(true)"'), '↺ 새로고침 단추만 바로 다시 읽는다');

const qa = readFileSync(new URL('../modules/qa-doc-generator/qa-doc-generator.html', import.meta.url), 'utf8');
assert.ok(!/setInterval\(\s*pull\w*Cloud/.test(qa) && !/setInterval\([^)]*getDoc/.test(qa), 'QA 문서 생성기에 클라우드 폴링(setInterval)이 없어야 한다');
assert.ok(qa.includes('fb.onSnapshot(fb.doc(fb.db, "t_itpBuilderDocs", QAG_PID)'), 'WPS·용접사·검사자 목록은 문서 구독으로 받는다');
assert.ok(qa.includes('if (!fb.auth?.currentUser) subscribeMasterListsFromItpBuilderCloud();'), '로그아웃으로 끊긴 구독은 다시 로그인하면 다시 건다(옛 폴링은 저절로 살아났다)');
console.log('read-meter 테스트 12개 전체 통과 (한 번 조회 과금·상한 · 관리 화면 5분·합류·날짜 기준·새로고침 · QA 폴링 없음·구독·재로그인)');

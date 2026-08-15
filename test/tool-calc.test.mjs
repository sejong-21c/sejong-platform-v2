// 순수 계산·파싱 함수 회귀 테스트. 실행: node test/tool-calc.test.mjs
// (배포 전에만 돌림. 통과 못 하면 계산 로직이 바뀐 것 — 의도한 변경이면 이 파일도 갱신.)
import { dimTolASME, dimTolTEMA, isTEMA, tolPos, tolH, tolL, tagId, normTag, parseClipboardTSV } from "../modules/shared/tool-calc.mjs";

let pass = 0, fail = 0;
function eq(actual, expected, name){
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`  ✗ ${name}\n      기대: ${e}\n      실제: ${a}`); }
}

// ── dimTolASME (ASME UG-80) ──
eq(dimTolASME(0), "", "dimTolASME(0)=빈값");
eq(dimTolASME(100), "±1", "dimTolASME(100)");
eq(dimTolASME(120), "±1", "dimTolASME(120) 경계");
eq(dimTolASME(300), "±2", "dimTolASME(300)");
eq(dimTolASME(1000), "±3", "dimTolASME(1000) 경계");
eq(dimTolASME(1600), "±4", "dimTolASME(1600)");
eq(dimTolASME(3000), "±6", "dimTolASME(3000)");
eq(dimTolASME(5000), "±8", "dimTolASME(5000)");

// ── dimTolTEMA ──
eq(dimTolTEMA(0), "", "dimTolTEMA(0)");
eq(dimTolTEMA(200), "±3", "dimTolTEMA(200)");
eq(dimTolTEMA(300), "±3", "dimTolTEMA(300) 경계");
eq(dimTolTEMA(1000), "±5", "dimTolTEMA(1000)");
eq(dimTolTEMA(2000), "±8", "dimTolTEMA(2000)");

// ── isTEMA ──
eq(isTEMA("ASME"), false, "isTEMA(ASME)");
eq(isTEMA("TEMA"), true, "isTEMA(TEMA 구버전값)");
eq(isTEMA("TEMA_R"), true, "isTEMA(TEMA_R)");
eq(isTEMA("TEMA_C"), true, "isTEMA(TEMA_C)");
eq(isTEMA(null), false, "isTEMA(null)");

// ── 노즐 공차 ──
eq(tolPos("ASME"), "±0.5°", "tolPos(ASME)");
eq(tolPos("TEMA_R"), "±1.5°", "tolPos(TEMA_R)");
eq(tolH("ASME", 100), "±1", "tolH(ASME,100)");
eq(tolH("ASME", 1600), "±5", "tolH(ASME,1600)");
eq(tolH("TEMA_C", 200), "±3", "tolH(TEMA_C,200)");
eq(tolH("TEMA_C", 500), "±5", "tolH(TEMA_C,500)");
eq(tolL("ASME", 100), "±1", "tolL(ASME,100)=tolH");
eq(tolL("TEMA_B", 400), "±5", "tolL(TEMA_B,400)");

// ── 태그 유틸 ──
eq(tagId("TA-6602A"), "TA6602A", "tagId 하이픈 제거");
eq(tagId(""), "", "tagId 빈값");
eq(normTag("TA-6602A"), "TA6602A", "normTag 하이픈");
eq(normTag("ta 6602 a"), "TA6602A", "normTag 공백·소문자");
eq(normTag("TA-6602-A"), "TA6602A", "normTag 이중 하이픈");
eq(normTag(null), "", "normTag(null)");
eq(normTag("TA6602A") === normTag("TA-6602A"), true, "normTag 동치(핵심 — 중복생성 방지)");

// ── parseClipboardTSV ──
eq(parseClipboardTSV("a\tb\nc\td"), [["a","b"],["c","d"]], "TSV 2x2");
eq(parseClipboardTSV("SHELL\tSA240\nHEAD\tSA516"), [["SHELL","SA240"],["HEAD","SA516"]], "TSV 실사용 예");
eq(parseClipboardTSV('"1\n2"\tb'), [["1\n2","b"]], "TSV 따옴표 내부 줄바꿈(Alt+Enter)");
eq(parseClipboardTSV("a\tb\t\t"), [["a","b"]], "TSV 후행 빈 필드 제거(가로 병합)");
eq(parseClipboardTSV("a\tb\n\nc\td"), [["a","b"],["c","d"]], "TSV 완전히 빈 줄 제거(세로 병합)");

console.log(`\n[tool-calc.test] ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);

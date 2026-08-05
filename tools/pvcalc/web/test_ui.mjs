/* 웹 UI 헤드리스 테스트 — 페이지 레벨 동작만. 계산식 자체는 test_core.mjs가
 * 파이썬과 대조하므로 여기서는 엔진이 검증할 수 없는 것만 본다:
 *   (1) 각 탭의 계산 버튼이 올바른 결과 칸에 결과를 그리는가 (배선)
 *   (2) 페이지가 입력을 엔진에 넘길 때의 가공 (부식여유 가산 등)
 *   (3) 재료 데이터 로더 (조회·보간·범위거부·계산서 스탬프)
 *
 * 실행:  npm i jsdom  후  node web/test_ui.mjs
 * (jsdom은 이 테스트 전용. 웹 자체는 의존성 없음.)
 */
import { JSDOM } from "jsdom";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const MATJS = `${DIR}/materials.js`;

let bad = 0, n = 0;
const ok = (label, cond, extra = "") => {
  n++; if (!cond) bad++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? "  " + extra : ""}`);
};
const near = (label, actual, expected, rel = 1e-3) =>
  ok(label, Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)),
     `got ${actual}, expected ${expected}`);

async function load() {
  const dom = await JSDOM.fromFile(`${DIR}/index.html`,
    { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
  await new Promise((res, rej) => {
    dom.window.addEventListener("load", res);
    dom.window.addEventListener("error", e => rej(e.error || new Error(e.message)));
    setTimeout(() => rej(new Error("page load timeout")), 8000);
  });
  return dom.window;
}
const grab = (d, panel, key) => {
  const kv = d.querySelector(`#res-${panel} .kv`);
  if (!kv) throw new Error(`no result rendered in ${panel}`);
  const m = kv.textContent.match(
    new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*([-0-9.,]+)"));
  if (!m) throw new Error(`${key} not found in ${panel}: ${kv.textContent}`);
  return Number(m[1].replace(/,/g, ""));
};
const sheet = (d, panel) => d.querySelector(`#res-${panel} pre.sheet`).textContent;

if (existsSync(MATJS))
  throw new Error("web/materials.js 존재 — 테스트가 실사용 파일을 덮을 수 있어 중단");

/* ══ 1. 전 탭 배선 스모크 ══════════════════════════════════════ */
console.log("== 탭 배선 ==");
const TABS = { calcShell: "shell", calcHead: "head", calcExt: "ext", calcNoz: "noz",
  calcUg45: "ug45", calcFlg: "flg", calcSad: "sad", calcLod: "lod" };
{
  const w = await load(), d = w.document;
  for (const [fn, panel] of Object.entries(TABS)) {
    let why = "";
    try { w[fn](); } catch (e) { why = "threw: " + e.message; }
    const box = d.getElementById("res-" + panel);
    if (!why && box.querySelector(".err")) why = "error: " + box.querySelector(".err").textContent.trim();
    if (!why && !box.querySelector(".kv")) why = "결과 미렌더";
    ok(`${fn} → #res-${panel}`, !why, why);
  }
}

/* ══ 2. 페이지 → 엔진 입력 가공 ════════════════════════════════ */
console.log("== 입력 가공·모드 전환 ==");
{
  const w = await load(), d = w.document;
  const $ = id => d.getElementById(id);
  const pickRadio = (name, v) => d.querySelector(`input[name="${name}"][value="${v}"]`).click();

  /* 기본값 P=1, R=1000, S=138, E=1, CA=3 → 페이지가 R+CA=1003 을 넘겨야 함 */
  w.calcShell();
  near("셸: R에 CA 가산 (t_req)", grab(d, "shell", "t_req"), 7.2999);
  near("셸: t_req_ca = t_req + CA", grab(d, "shell", "t_req_ca"), 10.2999);

  /* MAWP 모드는 R을 신품값 그대로, CA는 엔진이 처리 */
  pickRadio("sh-mode", "mawp");
  w.calcShell();
  near("셸 MAWP 모드", grab(d, "shell", "MAWP"), 1.2317);
  pickRadio("sh-mode", "t");

  /* 경판: D에 2·CA 가산 */
  w.calcHead();
  near("경판 2:1 (D+2CA)", grab(d, "head", "t_req"), 7.2734);

  /* 경판 형식 전환 — L,r 에 CA 가산 후 App.1-4(d) M */
  $("hd-type").value = "toriG"; $("hd-type").onchange();
  w.calcHead();
  const M = 0.25 * (3 + Math.sqrt(2003 / 153));
  near("경판 toriG: M", grab(d, "head", "M"), M);
  near("경판 toriG: t_req", grab(d, "head", "t_req"), 1.0 * 2003 * M / (2 * 138 - 0.2));
  $("hd-type").value = "ellip2"; $("hd-type").onchange();

  /* 외압 두께 역산 모드 */
  w.calcExt();
  near("외압 Pa", grab(d, "ext", "Pa"), 0.0816, 2e-3);
  pickRadio("ex-mode", "t");
  w.calcExt();
  near("외압 역산: Pa(t_min) ≈ P_ext", grab(d, "ext", "Pa"), 0.1013, 2e-2);
  ok("외압 역산: t_min 출력", grab(d, "ext", "t_min_corroded") > 0);
  pickRadio("ex-mode", "pa");

  /* 노즐: 패드 체크박스가 면적에 반영되는가 */
  w.calcNoz();
  const bare = grab(d, "noz", "A_available");
  $("nz-pad").checked = true;
  w.calcNoz();
  ok("노즐: 패드 체크 시 면적 증가", grab(d, "noz", "A_available") > bare);
  $("nz-pad").checked = false;

  /* UG-45: 파이프 공차 12.5% */
  w.calcUg45();
  near("UG-45 t_avail = t_nom×0.875", grab(d, "ug45", "t_available"), 12.7 * 0.875);
  $("u45-pipe").checked = false;
  w.calcUg45();
  near("UG-45 판재는 공차 없음", grab(d, "ug45", "t_available"), 12.7);
  $("u45-pipe").checked = true;

  /* 단위 토글 */
  w.setUnits("US");
  ok("단위 토글 psi", d.querySelector(".u-press").textContent === "psi");
  ok("단위 토글 온도 °F", $("mat-Tunit").textContent === "°F");
  w.setUnits("SI");
  ok("단위 토글 복귀 MPa", d.querySelector(".u-press").textContent === "MPa");
}

/* ══ 3. 재료 데이터 미로드 상태 (배포 기본값) ══════════════════ */
console.log("== 재료 데이터 없음 ==");
{
  const w = await load(), d = w.document;
  ok("재료바 숨김", !d.getElementById("matbar").classList.contains("on"));
  ok("드롭다운 미생성", d.querySelectorAll(".matsel").length === 0);
  ok("경고띠 원문(직접 입력) 유지",
     d.getElementById("dc-mat").textContent.includes("직접 확인해 입력"));
  w.calcShell();
  ok("계산 정상", grab(d, "shell", "t_req") > 0);
  ok("계산서에 스탬프 없음", !sheet(d, "shell").includes("재료 데이터 출처"));
}

/* ══ 4. 재료 데이터 로드 상태 ══════════════════════════════════ */
console.log("== 재료 데이터 로드 ==");
writeFileSync(MATJS, `window.PVCALC_MATERIALS = {
  edition: "TEST-2026 Table X",
  materials: [
    { name: "MAT-A", temps: [20, 100, 200], S: [100, 100, 80],
      Sy: [200, 190, 170], Ey: [200000, 195000, 185000] },
    { name: "MAT-B-Sonly", temps: [20, 300], S: [170, 150] }
  ]
};`, "utf-8");
try {
  const w = await load(), d = w.document;
  const $ = id => d.getElementById(id);
  const selFor = id => $(id).parentElement.querySelector(".matsel");
  const pick = (id, idx) => { const s = selFor(id); s.value = String(idx); s.onchange(); };

  ok("재료바 표시", $("matbar").classList.contains("on"));
  ok("판 표기 + 출처 + 온도단위 노출", ["TEST-2026 Table X", "materials.js", "°C"]
     .every(s => $("mat-edition").textContent.includes(s)), $("mat-edition").textContent);
  ok("경고띠 문구 교체", $("dc-mat").textContent.includes("판·개정년도"));

  const tagged = d.querySelectorAll("main input[data-mat]");
  ok("응력칸 19개 태그", tagged.length === 19, `실제 ${tagged.length}`);
  ok("칸마다 드롭다운", d.querySelectorAll(".matsel").length === tagged.length);
  ok("차트인자 B·플랜지 내경 B 제외",
     !$("ld-B").dataset.mat && !$("fl-B").dataset.mat);

  $("mat-T").value = "150";
  pick("sh-S", 0);
  near("S 선형보간 150° → 90", Number($("sh-S").value), 90);
  $("mat-T").value = "100"; selFor("sh-S").onchange();
  near("표상 온도점 100° → 100", Number($("sh-S").value), 100);

  pick("ex-Sy", 0); pick("ex-Ey", 0);
  near("Sy 조회", Number($("ex-Sy").value), 190);
  near("Ey 조회", Number($("ex-Ey").value), 195000);

  $("mat-Tamb").value = "20";
  pick("fl-Sa", 1);
  near("상온 칸은 Tamb 사용", Number($("fl-Sa").value), 170);

  /* 외삽 금지 — 조용히 틀린 값을 내지 않는 것이 핵심 */
  $("sh-S").value = "138";
  $("mat-T").value = "900";
  const s = selFor("sh-S"); s.value = "0"; s.onchange();
  ok("범위 밖 조회 거부(값 보존)", s.value === "" && Number($("sh-S").value) === 138);
  ok("범위 밖 경고 표시", $("mat-status").textContent.includes("범위"));

  $("mat-T").value = "100";
  const s2 = selFor("ex-Sy"); s2.value = "1"; s2.onchange();
  ok("없는 물성 조회 거부", s2.value === "" && $("mat-status").textContent.includes("없음"));

  /* 계산서 스탬프 — 판 추적 장치 */
  $("mat-T").value = "150"; pick("sh-S", 0);
  w.calcShell();
  const rep = sheet(d, "shell");
  ok("계산서 머리에 인허가 기준", rep.startsWith("인허가 기준: ASME VIII-1"));
  ok("계산서에 판 표기", rep.includes("재료 데이터 출처: TEST-2026 Table X"));
  ok("사용 재료·온도 명시", rep.includes("MAT-A S@150"));
  ok("타 탭 선택은 미포함", !rep.includes("MAT-B") && !rep.includes("Ey@"));
  w.calcExt();
  ok("외압 탭엔 Ey 스탬프", sheet(d, "ext").includes("Ey@"));
  ok("외압 탭에 셸 S 미포함", !/- MAT-A S@/.test(sheet(d, "ext")));

  $("mat-T").value = "200"; $("mat-T").onchange();
  near("온도 변경 시 전 칸 재조회", Number($("sh-S").value), 80);

  const s3 = selFor("sh-S"); s3.value = ""; s3.onchange();
  w.calcShell();
  ok("직접입력 전환 시 스탬프 제거", !sheet(d, "shell").includes("재료 데이터 출처"));
} finally {
  unlinkSync(MATJS);
}

/* ══ 5. 재료 데이터 관리 표 (편집기) ════════════════════════════ */
console.log("== 재료 표 편집기 ==");
{
  const w = await load(), d = w.document;
  const $ = id => d.getElementById(id);
  const rows = () => $("me-rows").querySelectorAll("tr");
  const cellOf = (i, p) => $("me-rows").querySelector(`input[data-p="${p}"][data-i="${i}"]`);
  const type = (inp, v) => { inp.value = String(v); inp.oninput(); };

  ok("데이터 없으면 빈 편집기", $("me-list").options.length === 0);
  ok("경고띠가 관리 탭 안내", $("dc-mat").textContent.includes("재료 데이터 관리"));

  /* 판 표기 없이 저장 → 거부 (계산서 추적 장치를 비울 수 없게) */
  w.meAdd();
  w.meSave();
  ok("판 표기 없으면 저장 거부", $("me-status").textContent.includes("판·출처 표기는 필수"));

  $("me-edition").value = "사내-2026 Table 1A";
  /* 온도 행 없이 저장 → 거부 */
  w.meSave();
  ok("온도 행 없으면 저장 거부", $("me-status").textContent.includes("온도 행이 없습니다"));

  /* 값 입력: 20°→100, 200°→80 (일부러 역순 입력해 자동 정렬 확인) */
  $("me-name").value = "SA-TEST (판재)"; $("me-name").oninput();
  w.meAddRow(); w.meAddRow();
  ok("행 2개 생성", rows().length === 2);
  type(cellOf(0, "temps"), 200); type(cellOf(0, "S"), 80);
  type(cellOf(1, "temps"), 20);  type(cellOf(1, "S"), 100);

  w.meSave();
  ok("저장 성공", $("me-status").textContent.includes("저장됨"));
  ok("역순 입력이 오름차순 정렬", Number(cellOf(0, "temps").value) === 20
     && Number(cellOf(1, "temps").value) === 200);

  /* 저장 즉시 계산 탭에 반영 */
  ok("재료바 표시됨", $("matbar").classList.contains("on"));
  ok("판 표기 + 출처 노출", $("mat-edition").textContent.includes("사내-2026 Table 1A")
     && $("mat-edition").textContent.includes("브라우저 저장"));
  const sel = $("sh-S").parentElement.querySelector(".matsel");
  ok("계산 탭에 드롭다운 생성", !!sel && sel.options.length === 2);

  $("mat-T").value = "110";
  sel.value = "0"; sel.onchange();
  near("새로 넣은 데이터로 보간 (110° → 90)", Number($("sh-S").value), 90);
  w.calcShell();
  ok("계산서에 사내 판 표기", sheet(d, "shell").includes("사내-2026 Table 1A"));

  /* 온도 중복 거부 */
  type(cellOf(1, "temps"), 20);
  w.meSave();
  ok("온도 중복 저장 거부", $("me-status").textContent.includes("중복"));
  type(cellOf(1, "temps"), 200);

  /* 물성 전부 빈 재료 거부 */
  w.meAdd();
  $("me-name").value = "빈 재료"; $("me-name").oninput();
  w.meAddRow();
  w.meSave();
  ok("물성 전부 비면 저장 거부", $("me-status").textContent.includes("전부 비어"));
  w.meDel();
  w.meSave();
  ok("삭제 후 저장 성공", $("me-status").textContent.includes("저장됨"));

  /* 내보내기 형식이 가져오기로 되돌아오는가 (라운드트립) */
  const exported = "/* c */\nwindow.PVCALC_MATERIALS = "
    + JSON.stringify({ edition: "왕복-2026", tempUnit: "C",
        materials: [{ name: "RT", note: "", temps: [0, 100], S: [50, 40], Sy: [], Ey: [] }] }, null, 1)
    + ";\n";
  const back = w.meImportText(exported);
  ok("materials.js 형식 가져오기", back && back.edition === "왕복-2026");
  ok("순수 JSON 가져오기", !!w.meImportText(JSON.stringify(back)));
  ok("쓰레기 파일은 거부", w.meImportText("이건 데이터가 아님") === null);

  /* 브라우저 저장 삭제 → 데이터 없는 상태로 복귀 */
  w.meClear();
  ok("저장 삭제 후 재료바 숨김", !$("matbar").classList.contains("on"));
  ok("저장 삭제 후 드롭다운 제거", d.querySelectorAll(".matsel").length === 0);
  w.calcShell();
  ok("저장 삭제 후에도 계산 정상", grab(d, "shell", "t_req") > 0);
}

/* ══ 6. materials.js 와 브라우저 저장이 둘 다 있을 때 우선순위 ══ */
console.log("== 출처 우선순위 ==");
writeFileSync(MATJS, `window.PVCALC_MATERIALS = { edition: "파일-판", materials: [
  { name: "FILE-MAT", temps: [20, 100], S: [111, 111] } ] };`, "utf-8");
try {
  const w = await load(), d = w.document;
  ok("저장 없으면 materials.js 사용",
     d.getElementById("mat-edition").textContent.includes("파일-판")
     && d.getElementById("mat-edition").textContent.includes("materials.js"));

  d.getElementById("me-edition").value = "저장-판";
  w.meAdd();
  d.getElementById("me-name").value = "SAVED-MAT"; d.getElementById("me-name").oninput();
  w.meAddRow();
  const c = p => d.getElementById("me-rows").querySelector(`input[data-p="${p}"][data-i="0"]`);
  c("temps").value = "50"; c("temps").oninput();
  c("S").value = "222"; c("S").oninput();
  w.meSave();
  ok("브라우저 저장이 materials.js 보다 우선",
     d.getElementById("mat-edition").textContent.includes("저장-판"));
  w.meClear();
  ok("저장 삭제 시 materials.js 로 복귀",
     d.getElementById("mat-edition").textContent.includes("파일-판"));
} finally {
  unlinkSync(MATJS);
}

/* ══ 6b. 인허가 기준 전환 ══════════════════════════════════════ */
console.log("== 인허가 기준 전환 ==");
{
  const w = await load(), d = w.document;
  const $ = id => d.getElementById(id);
  const visible = () => [...d.querySelectorAll("#tabs button")]
    .filter(b => b.style.display !== "none").map(b => b.dataset.tab);

  ok("기본 기준은 ASME", d.querySelector("#codebar button.on").dataset.code === "asme");
  ok("제목이 '압력용기 계산 도구'", d.querySelector("h1").textContent.includes("압력용기 계산 도구"));
  ok("ASME 부제 표시", $("code-sub").textContent.includes("Section VIII Div.1"));

  const asmeTabs = visible();
  ok("ASME 탭 8개 + 공통 2개", asmeTabs.length === 10, asmeTabs.join(","));
  ok("국내기준 탭은 숨김", !asmeTabs.includes("kec") && !asmeTabs.includes("kgs"));

  /* 국내 기준으로 전환 */
  w.setCode("kec");
  const kecTabs = visible();
  ok("에너지공단 탭만 + 공통", kecTabs.join(",") === "kec,mat,info", kecTabs.join(","));
  ok("ASME 탭 숨김", !kecTabs.includes("shell"));
  ok("부제가 기준에 맞게 바뀜", $("code-sub").textContent.includes("열사용기자재"));
  ok("숨겨진 탭에서 자동 이동", d.querySelector("#panel-kec").classList.contains("on"));
  ok("준비중 안내에 필요 원문 명시", d.querySelector("#panel-kec").textContent.includes("KS B 6750"));

  w.setCode("kgs");
  ok("KGS 탭 전환", visible().includes("kgs") && !visible().includes("kec"));
  ok("KGS 안내에 코드 확정 요청", d.querySelector("#panel-kgs").textContent.includes("어느 KGS 코드"));

  w.setCode("kosha");
  ok("KOSHA 안내에 사용중검사 성격 명시",
     d.querySelector("#panel-kosha").textContent.includes("사용 중 검사"));

  /* 공통 탭은 어느 기준에서도 열린다 */
  w.showTab("mat");
  ok("재료 관리는 공통 탭", d.querySelector("#panel-mat").classList.contains("on"));

  /* ASME 로 돌아오면 계산이 정상 동작 */
  w.setCode("asme");
  w.showTab("shell");
  w.calcShell();
  ok("ASME 복귀 후 계산 정상", grab(d, "shell", "t_req") > 0);
  ok("계산서에 기준 표기", sheet(d, "shell").startsWith("인허가 기준: ASME VIII-1"));

  /* 잘못된 기준값은 무시 */
  const before = d.querySelector("#codebar button.on").dataset.code;
  w.setCode("없는기준");
  ok("모르는 기준값 무시", d.querySelector("#codebar button.on").dataset.code === before);
}

/* ══ 7. 부서 공유 저장 진입점 (Firestore 브리지 seam) ════════════
   Firebase 자체는 망·로그인이 필요해 여기서 못 띄운다. 대신 브리지가 호출하는
   pvcalcAttachRemote 계약을 검증한다: 원격값이 로컬보다 우선, 저장 시 원격에도 밀기. */
console.log("== 부서 공유 저장 seam ==");
{
  const w = await load(), d = w.document;
  const $ = id => d.getElementById(id);

  /* 먼저 로컬에만 저장 */
  $("me-edition").value = "로컬-판";
  w.meAdd();
  $("me-name").value = "LOCAL-MAT"; $("me-name").oninput();
  w.meAddRow();
  const c = p => $("me-rows").querySelector(`input[data-p="${p}"][data-i="0"]`);
  c("temps").value = "20"; c("temps").oninput();
  c("S").value = "111"; c("S").oninput();
  w.meSave();
  ok("로컬 저장 반영", $("mat-edition").textContent.includes("로컬-판"));

  /* 원격값 도착 → 원격이 이겨야 함 */
  const pushed = [];
  w.pvcalcAttachRemote(
    { edition: "공유-판", tempUnit: "C",
      materials: [{ name: "SHARED-MAT", temps: [20, 100], S: [222, 222], Sy: [], Ey: [] }] },
    data => pushed.push(data));
  ok("원격값이 로컬보다 우선", $("mat-edition").textContent.includes("공유-판"));
  ok("공유 저장 표시", $("mat-edition").textContent.includes("부서 공유"));
  const sel = $("sh-S").parentElement.querySelector(".matsel");
  ok("드롭다운이 공유 재료로 교체", sel.options[1].textContent === "SHARED-MAT");

  /* 저장하면 원격으로도 밀려야 함 */
  $("mat-T").value = "50"; sel.value = "0"; sel.onchange();
  near("공유 데이터로 보간", Number($("sh-S").value), 222);
  $("me-edition").value = "공유-판-수정";
  w.meSave();
  ok("저장이 원격으로 전달", pushed.length === 1 && pushed[0].edition === "공유-판-수정");

  /* 삭제도 원격으로 전달 (null) */
  w.meClear();
  ok("삭제가 원격으로 전달", pushed.length === 2 && pushed[1] === null);

  /* 빈 원격값은 무시하고 로컬로 되돌아감 */
  w.pvcalcAttachRemote({ edition: "빈-판", materials: [] }, null);
  ok("빈 원격값은 미적용", !$("matbar").classList.contains("on"));
}

console.log(`\n${n} checks, ${bad} failure(s)`);
process.exit(bad ? 1 : 0);

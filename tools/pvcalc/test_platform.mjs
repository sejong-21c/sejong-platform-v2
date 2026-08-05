/* 플랫폼 탑재 검증 — 실제 정적 서버로 띄워 iframe 경로·파라미터·로딩을 확인한다.
 * jsdom 은 iframe 내부 스크립트를 완전히 돌리지 않으므로 여기서는
 *   (1) 도구 등록이 기술부 도구함에 잡히는가
 *   (2) iframe src 경로가 실제로 200 으로 존재하는가 (?fb=1 포함)
 *   (3) 엔진 파일·재료 예시 파일이 배포 경로에 있는가
 * 를 본다. 화면 동작은 tools/pvcalc/web/test_ui.mjs(81건)가 담당. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
/* 저장소 루트 = 이 파일(tools/pvcalc/)의 두 단계 위 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ROOT, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nope"); }
});
await new Promise(r => server.listen(8931, r));
const base = "http://localhost:8931";

let bad = 0, n = 0;
const ok = (label, cond, extra = "") => {
  n++; if (!cond) bad++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? "  " + extra : ""}`);
};

const html = await (await fetch(base + "/index.html")).text();

/* 1. 등록 5곳 */
ok("TOOLS 에 pvcalc 등록", /'pvcalc':\s*\{[^}]*압력용기 예비계산/.test(html));
ok("기술부 도구 목록에 포함", /id: 'design'[^}]*tools: \[[^\]]*'pvcalc'/.test(html));
ok("PVCALC_BUILD 상수 존재", /const PVCALC_BUILD = '[^']+'/.test(html));
ok("iframeViewKey 분기", /selectedTool === 'pvcalc'\) return 'pvcalc'/.test(html));
const m = html.match(/iframe src="(tools\/pvcalc\/web\/index\.html\?[^"]*)"/);
ok("render iframe 분기", !!m, m ? m[1] : "");
ok("fb=1 파라미터 (부서 공유 저장)", !!m && m[1].includes("fb=1"));
ok("캐시버스터 v= 포함", !!m && /[?&]v=\$\{PVCALC_BUILD\}/.test(m[1]));

/* 2. iframe 이 실제로 뜨는 경로인가 */
for (const p of ["/tools/pvcalc/web/index.html", "/tools/pvcalc/web/pvcalc-core.js"]) {
  const r = await fetch(base + p);
  ok(`배포 경로 존재: ${p}`, r.status === 200, `HTTP ${r.status}`);
}
const tool = await (await fetch(base + "/tools/pvcalc/web/index.html?fb=1")).text();
ok("도구 페이지가 엔진을 상대경로로 로드", tool.includes('src="pvcalc-core.js"'));
ok("도구 페이지에 제목 헤더 없음 (호스트가 담당)", !/<h1>압력용기 예비계산 도구/.test(tool));
ok("재료 관리 탭 존재", tool.includes('data-tab="mat"'));
ok("Firestore 브리지 조건부", tool.includes('get("fb") === "1"')
   && tool.includes("t_pvcalcMaterials"));

/* 3. 저작권 자료가 배포물에 없어야 함 */
const matjs = await fetch(base + "/tools/pvcalc/web/materials.js");
ok("materials.js 는 배포물에 없음 (저작권)", matjs.status === 404, `HTTP ${matjs.status}`);
const ex = await fetch(base + "/tools/pvcalc/web/materials.example.js");
ok("형식 템플릿은 존재", ex.status === 200);
const exText = await ex.text();
ok("템플릿에 실제 ASME 값 없음", exText.includes("예시") && exText.includes("교체 필요"));

console.log(`\n${n} checks, ${bad} failure(s)`);
/* keep-alive 소켓이 남아 있으면 close 가 프로세스 종료와 경합해 libuv 가 죽는다.
   연결을 먼저 끊고 exitCode 만 세팅해 자연 종료시킨다. */
server.closeAllConnections?.();
server.close();
process.exitCode = bad ? 1 : 0;

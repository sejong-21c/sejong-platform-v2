/* pvcalc-dxf.js — 견적용 외형도(GA): 치수 → 도형 모형 → DXF R12(ASCII) · SVG 미리보기
 *
 * 왜 (2026-09-25, 로드맵 ③ "데이터시트 → DXF 외형도"): 데이터시트(a8)까지는 숫자만 나왔다.
 *   견적 때 외형도를 CAD 로 다시 그리고 계셨다 — 계산 탭에 이미 있는 내경·두께·경판·새들 치수로 그린다.
 *
 * 원칙:
 *   · **견적·사전검토용 — 제작 도면이 아니다.** 표제란에 찍는다. 새들·스커트·노즐 목 길이는 개략(입력값)이다.
 *   · 경판 깊이는 식으로 낸다(안쪽 기준 → 두께만큼 바깥으로). 2:1 타원 h=D/4 · 일반 타원 h=D/(2k) · 반구 h=D/2 ·
 *     접시형 h = L − √((L−r)² − (D/2−r)²) · 원추 h = (D/2)/tan α. 시험(test_dxf.mjs)이 못 박는다.
 *   · DXF R12(AC1009): AutoCAD·ZWCAD·DraftSight 가 제일 두루 읽는다. 타원 개체가 없어 폴리라인으로 근사한다.
 *     R12 는 코드페이지 파일이라 UTF-8 한글이 깨진다 → **한글은 \U+XXXX 로 적어 파일 전체를 아스키로** 둔다.
 *   · 외부 라이브러리 없음(이 도구는 무의존성). 브라우저(window.pvcalcDxf)와 Node(module.exports) 둘 다.
 *
 * 좌표: 수평 기준 — x 는 축 방향(왼쪽 접선 TL = 0, 오른쪽 TL = L), y 는 위쪽, 축은 y=0. 수직이면 마지막에 90° 돌린다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.pvcalcDxf = factory();
}(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // ASME B36.10 관 바깥지름(mm) — 치수 규격이라 공개값이다(재료 허용응력 같은 저작권 표가 아니다).
  const NPS외경 = { "0.5": 21.3, "0.75": 26.7, "1": 33.4, "1.25": 42.2, "1.5": 48.3, "2": 60.3, "2.5": 73.0, "3": 88.9,
    "4": 114.3, "5": 141.3, "6": 168.3, "8": 219.1, "10": 273.0, "12": 323.8, "14": 355.6, "16": 406.4, "18": 457.0,
    "20": 508.0, "24": 610.0 };
  const 분수 = { "1/2": "0.5", "3/4": "0.75", "1-1/4": "1.25", "1-1/2": "1.5", "2-1/2": "2.5" };

  /** '2"' · '2' · 'NPS 2' · '1-1/2"' · 'DN50' → mm 바깥지름(단위계 u: 'SI' | 'US'). 모르면 null. */
  function 노즐외경(호칭, u = "SI") {
    let s = String(호칭 || "").trim().replace(/^NPS\s*/i, "").replace(/["″]/g, "").trim();
    // KS·JIS 표기: 50A = DN50(mm 호칭) · 2B = NPS 2(인치 호칭) — 사내 도면은 이렇게 쓴다(9/25 검토)
    const 에이 = /^(\d+)\s*A$/i.exec(s), 비 = /^([\d/-]+)\s*B$/i.exec(s);
    if (에이) s = "DN" + 에이[1];
    else if (비) s = 비[1];
    let mm = null;
    const dn = /^DN\s*(\d+)$/i.exec(s);
    if (dn) {
      const 짝 = { 15: "0.5", 20: "0.75", 25: "1", 32: "1.25", 40: "1.5", 50: "2", 65: "2.5", 80: "3", 100: "4", 125: "5", 150: "6", 200: "8", 250: "10", 300: "12", 350: "14", 400: "16", 450: "18", 500: "20", 600: "24" }[+dn[1]];
      mm = 짝 ? NPS외경[짝] : null;
    } else {
      const 키 = 분수[s] || String(Number(s));
      mm = NPS외경[키] ?? null;
    }
    if (mm == null) return null;
    return u === "US" ? mm / 25.4 : mm;
  }

  /** 경판 안쪽 깊이 h (내경 D 기준). 형식: ellip2 · ellipG(k=D/2h) · toriS · toriG(L,r) · hemi · cone(α°) · flat */
  function 경판깊이(형식, D, { k = 2, L = null, r = null, alpha = 30 } = {}) {
    const R = D / 2;
    if (형식 === "ellip2") return D / 4;
    if (형식 === "ellipG") return D / (2 * (Number(k) || 2));
    if (형식 === "hemi") return R;
    if (형식 === "cone") {
      const 각 = Number(alpha) || 30;
      if (!(각 > 0 && 각 < 90)) throw new Error("원추형 경판: 반꼭지각 α 는 0~90° 사이여야 합니다");
      return R / Math.tan(각 * Math.PI / 180);
    }
    if (형식 === "flat") return 0;
    if (형식 === "toriS" || 형식 === "toriG") {
      const Lc = Number(L) || D;
      if (형식 === "toriG" && !(Number(r) > 0)) throw new Error("일반 접시형 경판은 너클 반경 r 이 있어야 합니다");
      const rk = 형식 === "toriS" ? 0.06 * Lc : Number(r);
      if (!(rk > 0) || !(Lc > rk) || !(R > rk)) throw new Error("접시형 경판: L > r, D/2 > r 이어야 합니다");
      const 밑 = (Lc - rk) ** 2 - (R - rk) ** 2;
      if (!(밑 > 0)) throw new Error("접시형 경판: (L−r)² > (D/2−r)² 이어야 합니다");
      return Lc - Math.sqrt(밑);
    }
    throw new Error("모르는 경판 형식: " + 형식);
  }

  // ── 도형 모형 ────────────────────────────────────────────────────────────────
  // { 선: [{a:[x,y], b:[x,y], 층}], 호: [{c:[x,y], r, a0, a1, 층}], 폴리: [{점:[[x,y]...], 층}], 글: [{p:[x,y], h, 글, 층, 가운데}] }
  function 빈모형() { return { 선: [], 호: [], 폴리: [], 글: [] }; }

  /** 오른쪽 경판의 바깥 윤곽(접선 x=x0 에서 +x 로 볼록). 반쪽(위) 윤곽을 만들고 아래로 뒤집는다. */
  function 경판윤곽(m, 형식, x0, D, t, 옵션, 방향 = 1) {
    const Ri = D / 2, Ro = Ri + t;
    const 층 = "OUTLINE";
    const X = (x) => x0 + 방향 * x;
    if (형식 === "flat") {
      m.선.push({ a: [X(t), Ro], b: [X(t), -Ro], 층 });
      m.선.push({ a: [X(0), Ro], b: [X(t), Ro], 층 }, { a: [X(0), -Ro], b: [X(t), -Ro], 층 });
      return t;
    }
    if (형식 === "ellip2" || 형식 === "ellipG") {
      const b = 경판깊이(형식, D, 옵션) + t;               // 바깥 반축 (Ro, hi+t) — 견적 외형도의 어림(두께 균일 가정)
      const 점 = [];
      for (let i = 0; i <= 48; i++) { const q = Math.PI / 2 - (i / 48) * Math.PI; 점.push([X(b * Math.cos(q)), Ro * Math.sin(q)]); }
      m.폴리.push({ 점, 층 });
      return b;
    }
    if (형식 === "hemi") {
      m.호.push({ c: [X(0), 0], r: Ro, a0: 방향 > 0 ? -90 : 90, a1: 방향 > 0 ? 90 : 270, 층 });
      return Ro;
    }
    if (형식 === "cone") {
      const 반각 = (Number(옵션.alpha) || 30) * Math.PI / 180;
      const 끝 = Ri / Math.tan(반각) + t / Math.sin(반각);  // 바깥 꼭짓점(두께만큼 선을 바깥으로 민 것)
      m.선.push({ a: [X(0), Ro], b: [X(끝), 0], 층 }, { a: [X(0), -Ro], b: [X(끝), 0], 층 });
      return 끝;
    }
    // 접시형: 너클 중심 Ck=(0, Ri−r), 크라운 중심 Cc=(−c, 0), c = √((L−r)² − (Ri−r)²). 바깥은 반지름에 t 를 더한다.
    const Lc = Number(옵션.L) || D;
    const rk = 형식 === "toriS" ? 0.06 * Lc : Number(옵션.r);
    const a = Ri - rk, c = Math.sqrt((Lc - rk) ** 2 - a ** 2);
    const φ = Math.atan2(a, c) * 180 / Math.PI;           // 너클·크라운이 만나는 각
    if (방향 > 0) {
      m.호.push({ c: [X(0), a], r: rk + t, a0: φ, a1: 90, 층 });
      m.호.push({ c: [X(0), -a], r: rk + t, a0: -90, a1: -φ, 층 });
      m.호.push({ c: [X(-c), 0], r: Lc + t, a0: -φ, a1: φ, 층 });
    } else {
      m.호.push({ c: [X(0), a], r: rk + t, a0: 90, a1: 180 - φ, 층 });
      m.호.push({ c: [X(0), -a], r: rk + t, a0: 180 + φ, a1: 270, 층 });
      m.호.push({ c: [X(-c), 0], r: Lc + t, a0: 180 - φ, a1: 180 + φ, 층 });
    }
    return Lc + t - c;                                     // 바깥 깊이
  }

  /** 치수선 — 두 점 사이, 선에서 off 만큼 떨어뜨려 긋고 가운데에 글. 가로(x) 또는 세로(y). */
  function 치수(m, p1, p2, off, 글, h, 축 = "x") {
    const 층 = "DIM";
    if (축 === "x") {
      const y = p1[1] + off;
      m.선.push({ a: [p1[0], p1[1]], b: [p1[0], y + Math.sign(off) * h * 0.6], 층 }, { a: [p2[0], p2[1]], b: [p2[0], y + Math.sign(off) * h * 0.6], 층 });
      m.선.push({ a: [p1[0], y], b: [p2[0], y], 층 });
      for (const x of [p1[0], p2[0]]) m.선.push({ a: [x - h * 0.35, y - h * 0.35], b: [x + h * 0.35, y + h * 0.35], 층 });   // 사선 틱
      m.글.push({ p: [(p1[0] + p2[0]) / 2, y + h * 0.4], h, 글, 층, 가운데: true });
    } else {
      const x = p1[0] + off;
      m.선.push({ a: [p1[0], p1[1]], b: [x + Math.sign(off) * h * 0.6, p1[1]], 층 }, { a: [p2[0], p2[1]], b: [x + Math.sign(off) * h * 0.6, p2[1]], 층 });
      m.선.push({ a: [x, p1[1]], b: [x, p2[1]], 층 });
      for (const y of [p1[1], p2[1]]) m.선.push({ a: [x - h * 0.35, y - h * 0.35], b: [x + h * 0.35, y + h * 0.35], 층 });
      m.글.push({ p: [x - h * 0.6, (p1[1] + p2[1]) / 2], h, 글, 층, 가운데: true, 세로: true });
    }
  }

  const 수 = (v, u) => (u === "US" ? (Math.round(v * 100) / 100).toString() : Math.round(v).toString());

  /** 입력 → 모형. 입력:
   *  { 단위:'SI'|'US', 방향:'수평'|'수직', D 내경, t 셸두께, L 접선간길이, 경판:{형식, t, k, L, r, alpha},
   *    새들:{a, b, 높이}(수평) · 스커트:{높이}(수직) · 노즐:[{마크, 호칭, 위치, 쪽:'위'|'아래'|'왼경판'|'오른경판', 돌출}],
   *    표제:{프로젝트, 고객사, 태그, 품명, 도면번호, Rev, 작성자, 작성일, 기준} } */
  function 외형도(입) {
    const u = 입.단위 === "US" ? "US" : "SI";
    const D = Number(입.D), t = Number(입.t), L = Number(입.L);
    if (!(D > 0) || !(t >= 0) || !(L > 0)) throw new Error("내경 D·셸 두께 t·접선간 길이 L 이 있어야 합니다");
    const 경 = 입.경판 || {};
    const 형식 = 경.형식 || "ellip2";
    // 경판 치수는 **그리기 전에** 식으로 검사한다 — 접시형 L<D/2 같은 입력이 NaN 좌표 DXF(CAD 가 거부)나
    //   말없이 틀린 경판이 되던 것(9/25 검토). 경판깊이가 안 되는 입력이면 여기서 던진다.
    경판깊이(형식, D, 경);
    // 노즐 방향은 **정해진 말만** 받는다 — 모르는 말이 왼쪽 경판으로, 빈 위치가 x=0 으로 말없이 그려지던 것(9/25 검토).
    //   수평: 위·아래(셸) · 왼경판·오른경판 / 수직: 왼쪽·오른쪽(셸) · 위경판·아래경판. 비슷한 말(상부·오른쪽 경판…)은 맞춰 준다.
    const 수직배치 = 입.방향 === "수직";
    const 쪽표 = 수직배치
      ? { 왼쪽: "위", 좌측: "위", 왼: "위", 오른쪽: "아래", 우측: "아래", 오른: "아래", 위: "오른경판", 상부: "오른경판", 위경판: "오른경판", 상부경판: "오른경판", 윗경판: "오른경판", 오른경판: "오른경판",
        아래: "왼경판", 하부: "왼경판", 밑: "왼경판", 아래경판: "왼경판", 하부경판: "왼경판", 밑경판: "왼경판", 왼경판: "왼경판" }   // 수직이면 위·아래 = 위·아래 경판
      : { 위: "위", 상부: "위", 윗면: "위", 상: "위", top: "위", 아래: "아래", 하부: "아래", 밑: "아래", 하: "아래", bottom: "아래",
        왼경판: "왼경판", 왼쪽경판: "왼경판", 좌경판: "왼경판", 좌측경판: "왼경판", 오른경판: "오른경판", 오른쪽경판: "오른경판", 우경판: "오른경판", 우측경판: "오른경판" };
    const 노즐들 = (입.노즐 || []).map((n) => {
      const 말 = String(n.쪽 || (수직배치 ? "왼쪽" : "위")).replace(/\s+/g, "").toLowerCase();
      const 쪽 = 쪽표[말];
      if (!쪽) throw new Error(`${n.마크 || "노즐"} 방향 "${n.쪽}" 을 모릅니다 — ${수직배치 ? "왼쪽·오른쪽(셸) · 위(경판)·아래(경판)" : "위·아래(셸) · 왼경판·오른경판"} 중 하나`);
      if ((쪽 === "위" || 쪽 === "아래") && !(n.위치 != null && n.위치 !== "" && Number.isFinite(Number(n.위치)))) throw new Error(`${n.마크 || "노즐"} 위치(왼쪽 TL 부터)가 없습니다 — 쉼표 없이 수로 넣으세요`);
      return { ...n, 쪽 };
    });
    const th = Number(경.t ?? t) || t;
    const Ro = D / 2 + t;
    const m = 빈모형();
    const 층 = "OUTLINE";
    // 셸
    m.선.push({ a: [0, Ro], b: [L, Ro], 층 }, { a: [0, -Ro], b: [L, -Ro], 층 });
    // 경판(오른쪽 +x, 왼쪽 −x) — 경판 바깥 반지름이 셸과 다르면(두께 다름) 접선에서 잇는 짧은 선
    const 오깊이 = 경판윤곽(m, 형식, L, D, th, 경, 1);
    const 왼깊이 = 경판윤곽(m, 형식, 0, D, th, 경, -1);
    if (Math.abs(th - t) > 1e-9) for (const x of [0, L]) m.선.push({ a: [x, Ro], b: [x, D / 2 + th], 층 }, { a: [x, -Ro], b: [x, -(D / 2 + th)], 층 });
    // 접선(TL)·중심선
    const 크기 = Math.max(L + 오깊이 + 왼깊이, 2 * Ro);
    const h = Math.max(크기 / 80, u === "US" ? 0.12 : 3);   // 글 높이(모형 단위)
    for (const x of [0, L]) m.선.push({ a: [x, Ro * 1.08], b: [x, -Ro * 1.08], 층: "CENTER" });
    m.선.push({ a: [-왼깊이 - 크기 * 0.04, 0], b: [L + 오깊이 + 크기 * 0.04, 0], 층: "CENTER" });
    m.글.push({ p: [0, Ro * 1.1 + h * 0.3], h: h * 0.8, 글: "TL", 층: "TEXT", 가운데: true });
    m.글.push({ p: [L, Ro * 1.1 + h * 0.3], h: h * 0.8, 글: "TL", 층: "TEXT", 가운데: true });
    // 지지대
    const 수직 = 입.방향 === "수직";
    let 아래끝 = -Ro;                                      // 그림 아래 끝(새들 바닥) — 아래 노즐 치수를 그 밑에 둔다
    if (!수직) {
      const s = 입.새들 || {};
      const a = Number(s.a), b = Number(s.b) || Math.max(u === "US" ? 6 : 150, Ro * 0.2), 높이 = Number(s.높이) || Ro * 0.6;
      // 새들 위치를 줬는데 범위 밖이면 말없이 빼지 않고 까닭을 말한다(9/25 검토: a ≥ L/2 면 새들이 사라졌다).
      if (s.a != null && s.a !== "" && !(a > 0 && a < L / 2)) throw new Error(`새들–접선 거리 a 는 0 < a < L/2(${수(L / 2, u)}) 이어야 합니다`);
      if (a > 0 && a < L / 2) {
        아래끝 = -Ro - 높이 - h * 4.5;
        for (const x of [a, L - a]) {
          // 옆모습: 축 방향으로는 새들 폭 b(웹) + 밑판(양쪽 15%) — 끝에서 본 폭(≈1.7Ro)으로 그리면 경판 밖까지 나갔다(9/25 검토).
          const 밑 = -Ro - 높이, 판 = b * 0.15, 판두께 = Math.max(u === "US" ? 0.5 : 12, 높이 * 0.04);
          m.폴리.push({ 점: [[x - b / 2, -Ro], [x - b / 2, 밑 + 판두께], [x - b / 2 - 판, 밑 + 판두께], [x - b / 2 - 판, 밑], [x + b / 2 + 판, 밑],
            [x + b / 2 + 판, 밑 + 판두께], [x + b / 2, 밑 + 판두께], [x + b / 2, -Ro]], 층: "SUPPORT" });
          m.선.push({ a: [x, -Ro * 1.02], b: [x, 밑 - h], 층: "CENTER" });
        }
        치수(m, [a, -Ro - 높이], [L - a, -Ro - 높이], -h * 3, 수(L - 2 * a, u), h);
        치수(m, [0, -Ro - 높이], [a, -Ro - 높이], -h * 3, 수(a, u), h);
        m.글.push({ p: [a, -Ro - 높이 - h * 1.6], h: h * 0.8, 글: "새들(개략)", 층: "TEXT", 가운데: true });
      }
    }
    // 노즐
    for (const n of 노즐들) {
      const 외 = Number(n.외경) || 노즐외경(n.호칭, u) || D * 0.08;
      const 돌 = Number(n.돌출) || (u === "US" ? 6 : 150);
      const 판두께 = 외 * 0.25, 판폭 = 외 * 1.9;
      const 쪽 = n.쪽;
      const 이름 = `${n.마크 || "N"}${n.호칭 ? " (" + n.호칭 + ")" : ""}`;
      if (쪽 === "위" || 쪽 === "아래") {
        const x = Number(n.위치);
        if (!(x >= 0 && x <= L)) throw new Error(`${n.마크 || "노즐"} 위치는 0~L(${수(L, u)}) 안이어야 합니다`);
        const sg = 쪽 === "위" ? 1 : -1, 끝 = sg * (Ro + 돌);
        m.선.push({ a: [x - 외 / 2, sg * Ro], b: [x - 외 / 2, 끝], 층: "NOZZLE" }, { a: [x + 외 / 2, sg * Ro], b: [x + 외 / 2, 끝], 층: "NOZZLE" });
        m.폴리.push({ 점: [[x - 판폭 / 2, 끝], [x + 판폭 / 2, 끝], [x + 판폭 / 2, 끝 + sg * 판두께], [x - 판폭 / 2, 끝 + sg * 판두께], [x - 판폭 / 2, 끝]], 층: "NOZZLE" });
        m.글.push({ p: [x, 끝 + sg * (판두께 + h * (sg > 0 ? 0.5 : 1.4))], h, 글: 이름, 층: "TEXT", 가운데: true });
      } else {
        const 오 = 쪽 === "오른경판", 깊 = 오 ? 오깊이 : 왼깊이, sx = 오 ? 1 : -1, 밑 = 오 ? L : 0;
        const 끝 = 밑 + sx * (깊 + 돌);
        m.선.push({ a: [밑 + sx * 깊 * 0.97, 외 / 2], b: [끝, 외 / 2], 층: "NOZZLE" }, { a: [밑 + sx * 깊 * 0.97, -외 / 2], b: [끝, -외 / 2], 층: "NOZZLE" });
        m.폴리.push({ 점: [[끝, 판폭 / 2], [끝 + sx * 판두께, 판폭 / 2], [끝 + sx * 판두께, -판폭 / 2], [끝, -판폭 / 2], [끝, 판폭 / 2]], 층: "NOZZLE" });
        m.글.push({ p: [끝 + sx * (판두께 + h * 3), 판폭 / 2 + h * 0.5], h, 글: 이름, 층: "TEXT", 가운데: true });
      }
    }
    // 치수 — 위쪽에 T/T 와 전장, 왼쪽에 외경
    const 위 = Ro + h * 4 + Math.max(0, ...노즐들.filter((n) => (n.쪽 || "위") === "위").map((n) => (Number(n.돌출) || (u === "US" ? 6 : 150)) + h * 3));
    치수(m, [0, Ro], [L, Ro], 위 - Ro, `T/T ${수(L, u)}`, h);
    치수(m, [-왼깊이, 0], [L + 오깊이, 0], 위 + h * 3.5, `전장 ${수(L + 오깊이 + 왼깊이, u)}`, h);
    if (!수직) 치수(m, [-왼깊이 - 크기 * 0.02, Ro], [-왼깊이 - 크기 * 0.02, -Ro], -h * 4, `OD ${수(2 * Ro, u)}`, h, "y");
    // 노즐 위치 치수(위·아래, 왼쪽 TL 부터)
    // 아래 노즐 위치 치수 — 새들 치수(있으면) 밑으로, 노즐 돌출보다 더 밑에
    const 아래줄 = 노즐들.filter((n) => n.쪽 === "아래");
    const 아래기준 = Math.min(아래끝, -Ro - Math.max(0, ...아래줄.map((n) => (Number(n.돌출) || (u === "US" ? 6 : 150)) + h * 3))) - h * 3;
    아래줄.forEach((n, i) => 치수(m, [0, -Ro], [Number(n.위치), -Ro], 아래기준 + Ro - h * 2.2 * i, `${n.마크 || "N"} ${수(Number(n.위치), u)}`, h * 0.85));
    const 줄 = 노즐들.filter((n) => n.쪽 === "위" || !n.쪽);
    줄.forEach((n, i) => 치수(m, [0, Ro], [Number(n.위치), Ro], 위 - Ro + h * (7 + 2.2 * i), `${n.마크 || "N"} ${수(Number(n.위치), u)}`, h * 0.85));
    // 수직이면 90° 돌린다(오른쪽 경판이 위로)
    if (수직) {
      const 돌 = ([x, y]) => [-y, x];
      for (const s of m.선) { s.a = 돌(s.a); s.b = 돌(s.b); }
      for (const a of m.호) { a.c = 돌(a.c); a.a0 += 90; a.a1 += 90; }
      for (const p of m.폴리) p.점 = p.점.map(돌);
      for (const g of m.글) { g.p = 돌(g.p); g.세로 = !g.세로; }
      // OD — 돌린 뒤 위 경판 위쪽에 가로로(돌리면 세로 치수 글이 선을 가로지르고 스커트 안으로 들어갔다, 9/25 검토)
      치수(m, [-Ro, L], [Ro, L], 오깊이 + h * 4, `OD ${수(2 * Ro, u)}`, h);
      // 스커트: 아래 TL(y=0)에서 바닥(y=−높이)까지 — 높이는 바닥~아래 TL. 전엔 경판 깊이의 0.6 아래에 떠 있었다.
      const sk = Number((입.스커트 || {}).높이) || 0;
      if (sk > 0) {
        if (!(sk > 왼깊이)) throw new Error(`스커트 높이(바닥~아래 TL ${수(sk, u)})는 아래 경판 깊이(${수(왼깊이, u)})보다 커야 합니다`);
        m.폴리.push({ 점: [[-Ro, 0], [-Ro, -sk], [Ro, -sk], [Ro, 0]], 층: "SUPPORT" });
        m.글.push({ p: [0, -sk - h * 1.6], h: h * 0.8, 글: `스커트(개략) ${수(sk, u)}`, 층: "TEXT", 가운데: true });
      }
    }
    표제란(m, 입.표제 || {}, u, 형식, { D, t, L, th, 오깊이, 왼깊이 }, 수직);
    return m;
  }

  function 범위(m) {
    const xs = [], ys = [];
    for (const s of m.선) { xs.push(s.a[0], s.b[0]); ys.push(s.a[1], s.b[1]); }
    for (const a of m.호) {
      // 크라운 반경(수천 mm)의 원 전체로 잡으면 범위·축척·가운데가 부풀었다(9/25 검토) — 그린 부분만
      const 넓이 = ((a.a1 - a.a0) % 360 + 360) % 360 || 360;
      const 각들 = [a.a0, a.a0 + 넓이, ...[0, 90, 180, 270, 360, 450, 540, 630].filter((q) => q > a.a0 && q < a.a0 + 넓이)];
      for (const q of 각들) { const r = q * Math.PI / 180; xs.push(a.c[0] + a.r * Math.cos(r)); ys.push(a.c[1] + a.r * Math.sin(r)); }
    }
    for (const p of m.폴리) for (const [x, y] of p.점) { xs.push(x); ys.push(y); }
    for (const g of m.글) { xs.push(g.p[0]); ys.push(g.p[1]); }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  const 축척들 = [1, 2, 2.5, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200];
  /** A3(420×297) 틀 · 표제란. 그림은 **표제란 위쪽** 400×221 안에 들어가게 — 그 안에 드는 제일 작은 축척을 고른다.
   *  (틀 안 아래 5 + 표제란 56 + 틈 5 = 66 을 그림 밑에 둔다 — 그림과 표제란이 겹치지 않는다.) */
  function 표제란(m, 표, u, 형식, 값, 세로판 = false) {
    const 그림 = 범위(m);
    const 폭 = 그림.x1 - 그림.x0, 높 = 그림.y1 - 그림.y0;
    const 판 = u === "US" ? 1 / 25.4 : 1;                    // A3 를 그 단위로
    // 수직 용기는 A3 세로(297×420) — 가로 틀에 세우면 그림이 작아진다.
    const [판W, 판H] = 세로판 ? [297, 420] : [420, 297];
    const N = 축척들.find((n) => 폭 <= (판W - 20) * 판 * n && 높 <= (판H - 76) * 판 * n) || 축척들[축척들.length - 1];
    const W = 판W * 판 * N, H = 판H * 판 * N;
    const x0 = (그림.x0 + 그림.x1) / 2 - W / 2, y0 = 그림.y0 - 66 * 판 * N;
    const 층 = "TITLE";
    const 네모 = (a, b, c, d) => m.폴리.push({ 점: [[a, b], [c, b], [c, d], [a, d], [a, b]], 층 });
    네모(x0, y0, x0 + W, y0 + H);
    const tw = 180 * 판 * N, th2 = 56 * 판 * N, tx = x0 + W - tw - 5 * 판 * N, ty = y0 + 5 * 판 * N;
    네모(tx, ty, tx + tw, ty + th2);
    const gh = 3.2 * 판 * N;
    const 줄 = [
      ["프로젝트", 표.프로젝트], ["고객사", 표.고객사], ["품명", `${표.품명 || ""}${표.태그 ? " (" + 표.태그 + ")" : ""}`],
      ["도면번호", `${표.도면번호 || ""}${표.Rev != null && 표.Rev !== "" ? "  Rev." + 표.Rev : ""}`],
      ["작성", `${표.작성자 || ""}  ${표.작성일 || ""}`], ["기준", 표.기준 || ""],
      ["경판", `${{ ellip2: "2:1 타원", ellipG: "타원", toriS: "표준 접시", toriG: "접시", hemi: "반구", cone: "원추", flat: "평판" }[형식] || 형식} · 셸 t ${수(값.t, u)} · 경판 t ${수(값.th, u)}`],
      ["축척", `1:${N} · 단위 ${u === "US" ? "in" : "mm"} · A3${세로판 ? " 세로" : ""}`],
    ];
    줄.forEach(([k, v], i) => {
      const y = ty + th2 - (i + 1) * (th2 / (줄.length + 1.2));
      m.글.push({ p: [tx + 3 * 판 * N, y], h: gh, 글: k, 층, 가운데: false });
      m.글.push({ p: [tx + 30 * 판 * N, y], h: gh, 글: String(v || ""), 층, 가운데: false });
    });
    m.글.push({ p: [tx + 3 * 판 * N, ty + 1.8 * 판 * N], h: gh * 0.9, 글: "견적·사전검토용 외형도 — 제작 도면 아님 (pvcalc)", 층, 가운데: false });
    m.축척 = N;
    m.단위 = u;
  }

  // ── DXF R12 ────────────────────────────────────────────────────────────────
  /** 한글 등 아스키 밖 글자는 \U+XXXX — R12 는 코드페이지 파일이라 UTF-8 이 깨진다. */
  const 아스키로 = (s) => [...String(s)].map((ch) => { const c = ch.codePointAt(0); return c < 128 ? ch : c <= 0xffff ? "\\U+" + c.toString(16).toUpperCase().padStart(4, "0") : "?"; }).join("");
  const n6 = (v) => (Math.round(v * 1e6) / 1e6).toString();

  function dxf(m) {
    const 줄 = [];
    const p = (code, v) => { 줄.push(String(code)); 줄.push(String(v)); };
    const 판 = 범위(m);
    p(0, "SECTION"); p(2, "HEADER");
    p(9, "$ACADVER"); p(1, "AC1009");
    p(9, "$DWGCODEPAGE"); p(3, "ANSI_949");
    p(9, "$INSBASE"); p(10, 0); p(20, 0); p(30, 0);
    p(9, "$EXTMIN"); p(10, n6(판.x0)); p(20, n6(판.y0)); p(30, 0);
    p(9, "$EXTMAX"); p(10, n6(판.x1)); p(20, n6(판.y1)); p(30, 0);
    p(9, "$LTSCALE"); p(40, n6((m.축척 || 1) / (m.단위 === "US" ? 25.4 : 1)));   // 선형 무늬는 mm — 인치 도면이면 실선으로 보였다(9/25 검토)
    p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "TABLES");
    p(0, "TABLE"); p(2, "LTYPE"); p(70, 2);
    p(0, "LTYPE"); p(2, "CONTINUOUS"); p(70, 0); p(3, "Solid line"); p(72, 65); p(73, 0); p(40, 0);
    p(0, "LTYPE"); p(2, "CENTER"); p(70, 0); p(3, "Center ____ _ ____ _"); p(72, 65); p(73, 4); p(40, 50.8);
    p(49, 31.75); p(49, -6.35); p(49, 6.35); p(49, -6.35);
    p(0, "ENDTAB");
    const 층들 = [["0", 7, "CONTINUOUS"], ["OUTLINE", 7, "CONTINUOUS"], ["CENTER", 1, "CENTER"], ["DIM", 3, "CONTINUOUS"],
      ["NOZZLE", 4, "CONTINUOUS"], ["SUPPORT", 5, "CONTINUOUS"], ["TEXT", 7, "CONTINUOUS"], ["TITLE", 7, "CONTINUOUS"]];
    p(0, "TABLE"); p(2, "LAYER"); p(70, 층들.length);
    for (const [이름, 색, 선] of 층들) { p(0, "LAYER"); p(2, 이름); p(70, 0); p(62, 색); p(6, 선); }
    p(0, "ENDTAB");
    p(0, "TABLE"); p(2, "STYLE"); p(70, 1);
    // 한글 글꼴 — 윈도 기본 맑은 고딕. 없는 PC 는 CAD 가 대체 글꼴을 묻는다.
    p(0, "STYLE"); p(2, "STANDARD"); p(70, 0); p(40, 0); p(41, 1); p(50, 0); p(71, 0); p(42, 2.5); p(3, "malgun.ttf"); p(4, "");
    p(0, "ENDTAB");
    p(0, "ENDSEC");
    p(0, "SECTION"); p(2, "ENTITIES");
    for (const s of m.선) { p(0, "LINE"); p(8, s.층); p(10, n6(s.a[0])); p(20, n6(s.a[1])); p(30, 0); p(11, n6(s.b[0])); p(21, n6(s.b[1])); p(31, 0); }
    for (const a of m.호) { p(0, "ARC"); p(8, a.층); p(10, n6(a.c[0])); p(20, n6(a.c[1])); p(30, 0); p(40, n6(a.r)); p(50, n6(((a.a0 % 360) + 360) % 360)); p(51, n6(((a.a1 % 360) + 360) % 360)); }
    for (const q of m.폴리) {
      p(0, "POLYLINE"); p(8, q.층); p(66, 1); p(10, 0); p(20, 0); p(30, 0); p(70, 0);
      for (const [x, y] of q.점) { p(0, "VERTEX"); p(8, q.층); p(10, n6(x)); p(20, n6(y)); p(30, 0); }
      p(0, "SEQEND"); p(8, q.층);
    }
    for (const g of m.글) {
      p(0, "TEXT"); p(8, g.층); p(10, n6(g.p[0])); p(20, n6(g.p[1])); p(30, 0); p(40, n6(g.h)); p(1, 아스키로(g.글));
      if (g.세로) p(50, 90);
      p(7, "STANDARD");
      if (g.가운데) { p(72, 1); p(11, n6(g.p[0])); p(21, n6(g.p[1])); p(31, 0); }
    }
    p(0, "ENDSEC");
    p(0, "EOF");
    return 줄.join("\r\n") + "\r\n";
  }

  // ── SVG 미리보기 ─────────────────────────────────────────────────────────────
  function svg(m, 폭 = 900) {
    const b = 범위(m), 여백 = (b.x1 - b.x0) * 0.02;
    const W = b.x1 - b.x0 + 2 * 여백, H = b.y1 - b.y0 + 2 * 여백;
    const X = (x) => x - b.x0 + 여백, Y = (y) => b.y1 - y + 여백;
    const 색 = { OUTLINE: "currentColor", CENTER: "#dc2626", DIM: "#16a34a", NOZZLE: "#0891b2", SUPPORT: "#2563eb", TEXT: "currentColor", TITLE: "currentColor" };
    const sw = W / 900;
    const 겉 = [];
    for (const s of m.선) 겉.push(`<line x1="${X(s.a[0])}" y1="${Y(s.a[1])}" x2="${X(s.b[0])}" y2="${Y(s.b[1])}" stroke="${색[s.층]}" stroke-width="${sw}"${s.층 === "CENTER" ? ` stroke-dasharray="${sw * 12} ${sw * 3} ${sw * 2} ${sw * 3}"` : ""}/>`);
    for (const a of m.호) {
      const r0 = a.a0 * Math.PI / 180, r1 = a.a1 * Math.PI / 180;
      const x0 = a.c[0] + a.r * Math.cos(r0), y0 = a.c[1] + a.r * Math.sin(r0), x1 = a.c[0] + a.r * Math.cos(r1), y1 = a.c[1] + a.r * Math.sin(r1);
      const 큰 = ((a.a1 - a.a0 + 360) % 360) > 180 ? 1 : 0;
      겉.push(`<path d="M${X(x0)} ${Y(y0)} A${a.r} ${a.r} 0 ${큰} 0 ${X(x1)} ${Y(y1)}" fill="none" stroke="${색[a.층]}" stroke-width="${sw}"/>`);
    }
    for (const q of m.폴리) 겉.push(`<polyline points="${q.점.map(([x, y]) => X(x) + "," + Y(y)).join(" ")}" fill="none" stroke="${색[q.층]}" stroke-width="${sw}"/>`);
    const 이스 = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    for (const g of m.글) 겉.push(`<text x="${X(g.p[0])}" y="${Y(g.p[1])}" font-size="${g.h}" fill="${색[g.층]}"${g.가운데 ? ' text-anchor="middle"' : ""}${g.세로 ? ` transform="rotate(-90 ${X(g.p[0])} ${Y(g.p[1])})"` : ""}>${이스(g.글)}</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${폭}" style="max-width:100%;height:auto;font-family:'Malgun Gothic',sans-serif">${겉.join("")}</svg>`;
  }

  return { 노즐외경, 경판깊이, 외형도, dxf, svg, 아스키로, 범위 };
}));

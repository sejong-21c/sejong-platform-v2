/* agitcalc-core.js — 교반기 선정·설계 계산 엔진 (Python 패키지 agitcalc 의 1:1 포팅)
 *
 * ../agitcalc 의 파이썬 구현을 그대로 옮긴 것이다. 두 엔진의 일치는
 * tests/gen_test_vectors.py 로 벡터를 만들고 web/test_core.mjs 로 검증한다.
 * 파이썬 수식을 고치면 반드시 이 파일도 고치고 대조 테스트를 다시 돌릴 것.
 *
 * 단위: SI (D,T,H [m] / N [rev/s] / rho [kg/m3] / mu [Pa*s] / P [W] / V [m3])
 * 브라우저(window.agitcalc)와 Node(module.exports) 양쪽에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.agitcalc = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = 9.80665;
  const AXIAL = "축류", RADIAL = "반경류", MIXED = "혼합류", TANGENTIAL = "접선류(벽면)";

  /* ---------------- 계산서 컨테이너 ---------------- */
  function mkResult(title, ref) {
    return {
      title, ref: ref || "", inputs: [], steps: [], checks: [], warnings: [],
      results: {},
      addInput(n, v, u, note) { this.inputs.push([n, v, u || "", note || ""]); },
      addStep(n, f, v, u) { this.steps.push([n, f || "", v, u || ""]); },
      addCheck(d, p, note) { this.checks.push([d, !!p, note || ""]); },
      warn(m) { this.warnings.push(m); },
      get ok() { return this.checks.every(c => c[1]); }
    };
  }

  /* ---------------- 임펠러 DB ---------------- */
  function I(key, nameKo, nameEn, flow, NpTurb, Kp, Nq, W_D, nBlades, ksMO,
             dTlo, dThi, muMax, Ntheta, source, note) {
    return { key, nameKo, nameEn, flow, NpTurb, Kp, Nq, W_D, nBlades, ksMO,
             dT: [dTlo, dThi], muMax, Ntheta: Ntheta || null,
             source: source || "", note: note || "" };
  }

  const LIT = {};
  [
    I("RUSHTON", "러시톤 원판터빈(6매)", "Rushton disc turbine, 6-blade", RADIAL,
      5.0, 71.5, 0.72, 0.20, 6, 11.5, 0.25, 0.40, 10000, null,
      "[HIM] Table 6-2, [BAT]", "가스분산·고전단. 저점도 전용. 큰 동력 필요"),
    I("FBT6", "평판터빈(6매)", "Flat blade turbine, 6-blade", RADIAL,
      3.2, 70.0, 0.70, 0.20, 6, 11.0, 0.30, 0.50, 20000, null,
      "[BAT], [PER] Sec.18", "원판 없는 반경류 터빈"),
    I("PBT4", "45도 피치블레이드(4매)", "Pitched blade turbine 45deg, 4-blade", MIXED,
      1.27, 36.5, 0.79, 0.20, 4, 11.0, 0.33, 0.50, 30000, null,
      "[HIM] Table 6-2, [BAT]",
      "범용. 고체현탁·열전달·중점도 블렌딩. 검토서의 4-P.P 에 해당"),
    I("PBT6", "45도 피치블레이드(6매)", "Pitched blade turbine 45deg, 6-blade", MIXED,
      1.70, 45.0, 0.85, 0.20, 6, 11.0, 0.33, 0.50, 30000, null, "[BAT]", ""),
    I("PADDLE2", "2매 패들", "Flat paddle, 2-blade", RADIAL,
      1.70, 45.0, 0.40, 0.20, 2, 11.0, 0.30, 0.60, 30000, null, "[NAG], [PER]",
      "검토서의 2-P.P 에 해당. 벤더 역산 Nq(0.50)가 문헌보다 큼 — 확인 필요"),
    I("PROP", "마린 프로펠러(3매)", "Marine propeller, 3-blade", AXIAL,
      0.35, 41.0, 0.50, null, 3, 10.0, 0.20, 0.40, 5000, null,
      "[HIM] Table 6-2, [PER]", "저점도 고속. 저동력 순환"),
    I("HYDROFOIL", "하이드로포일(3매)", "Hydrofoil, 3-blade (A310 type)", AXIAL,
      0.30, 33.0, 0.56, null, 3, 11.0, 0.35, 0.50, 5000, null,
      "[HIM] Table 6-2", "동력당 토출량 최대. 저점도 대용량 블렌딩"),
    I("HYDROFOIL_HS", "고솔리디티 하이드로포일", "High-solidity hydrofoil (A315)", AXIAL,
      0.75, 33.0, 0.56, null, 4, 11.0, 0.35, 0.50, 20000, null,
      "[HIM] Table 6-2", "중점도·가스분산 겸용"),
    I("MAXBLEND", "광폭 대형패들(맥스블렌드형)", "Wide-paddle large impeller", MIXED,
      1.20, 120.0, 0.35, null, 2, 13.0, 0.50, 0.80, 200000, 45.0,
      "[HIM] Ch.6 광폭임펠러 절, 제조사 공개자료",
      "고점도·광범위 Re 대응. 배플 불필요. 검토서 주력 형식. Np 는 d/T 의존성이 매우 커서 제조사 실측 필수"),
    I("ANCHOR", "앵커", "Anchor", TANGENTIAL,
      0.35, 300.0, 0.10, null, 2, 25.0, 0.90, 0.98, 500000, 90.0,
      "[NAG], [HIM] Ch.6", "근접간극. 벽면 스크레이핑·열전달. 축방향 혼합 약함"),
    I("RIBBON", "헬리컬 리본(2중)", "Double helical ribbon", TANGENTIAL,
      0.35, 350.0, 0.15, null, 2, 30.0, 0.90, 0.98, 1000000, 35.0,
      "[NAG], [HIM] Ch.6", "초고점도 층류 전용. 축방향 순환 우수"),
  ].forEach(x => { LIT[x.key] = x; });

  /* TOPJIN 검토서 역산값 (Nq 는 8/8 케이스 정확 재현 → 확정) */
  const TOPJIN_NQ = { MAXBLEND: 0.21, PADDLE2: 0.50, PBT4: 0.4095 };
  const TOPJIN_POWER_MARGIN = 1.10;
  const TOPJIN_POWER_MARGIN_COIL = 1.20;
  const TOPJIN_MAX_LOAD = 0.90;
  const VENDOR_ALIAS = {
    "MAXBLEND": "MAXBLEND", "4-P.P": "PBT4", "2-P.P": "PADDLE2",
    "6-P.P": "PBT6", "ANCHOR": "ANCHOR", "RIBBON": "RIBBON",
    "PROPELLER": "PROP"
  };

  function getImpeller(key, dataset) {
    const k = VENDOR_ALIAS[String(key).toUpperCase()] || String(key).toUpperCase();
    if (!LIT[k]) throw new Error("미등록 임펠러 형식: " + key);
    const im = LIT[k];
    if ((dataset || "LIT").toUpperCase() === "TOPJIN" && TOPJIN_NQ[k] !== undefined) {
      return Object.assign({}, im, { Nq: TOPJIN_NQ[k], source: "TOPJIN 검토서 역산" });
    }
    return im;
  }

  /* ---------------- 단위 / 무차원수 ---------------- */
  const rpmToRps = r => r / 60.0;
  const rpsToRpm = r => r * 60.0;
  const cPToPas = c => c / 1000.0;
  const volumeFromTH = (T, H) => Math.PI * T * T / 4.0 * H;
  const liquidHeight = (T, V) => V / (Math.PI * T * T / 4.0);
  const reynolds = (rho, N, D, mu) => rho * N * D * D / mu;
  const froude = (N, D) => N * N * D / G;
  const tipSpeed = (N, D) => Math.PI * D * N;

  function flowRegime(Re) {
    if (Re < 10) return "층류";
    if (Re < 1e4) return "천이";
    return "난류";
  }

  /* ---------------- 동력수 ---------------- */
  function powerNumber(Re, impeller, opts) {
    opts = opts || {};
    const im = (typeof impeller === "string")
      ? getImpeller(impeller, opts.dataset) : impeller;
    const baffled = opts.baffled === undefined ? true : !!opts.baffled;

    const npLam = Re > 0 ? im.Kp / Re : Infinity;
    const npTurb = im.NpTurb;
    const npBase = Math.max(npLam, npTurb);
    const governing = npLam >= npTurb ? "층류 Kp/Re" : "난류 Np_turb";

    let fW = 1.0;
    if (opts.W_D != null && im.W_D) fW = Math.pow(opts.W_D / im.W_D, 1.25);
    let fN = 1.0;
    if (opts.nBlades != null && im.nBlades) fN = Math.pow(opts.nBlades / im.nBlades, 0.8);
    let fB = 1.0;
    if (!baffled && Re >= 10.0 && (im.flow === RADIAL || im.flow === MIXED)) fB = 0.70;

    return { Np: npBase * fW * fN * fB, NpLaminar: npLam, NpTurb: npTurb,
             governing, fWidth: fW, fBlades: fN, fBaffle: fB, Kp: im.Kp };
  }

  function apparentViscosityMO(K, n, N, impeller, dataset) {
    const im = (typeof impeller === "string") ? getImpeller(impeller, dataset) : impeller;
    const gamma = im.ksMO * N;
    return { mu_app: K * Math.pow(gamma, n - 1.0), gamma };
  }

  /* ---------------- 동력 / 토출량 ---------------- */
  const impellerPower = (rho, N, D, Np) => Np * rho * Math.pow(N, 3) * Math.pow(D, 5);
  const pumpingCapacity = (N, D, Nq) => Nq * N * Math.pow(D, 3);

  function interferenceFactor(s) {
    if (s >= 1.0) return 1.0;
    if (s <= 0.5) return 0.80;
    return 0.80 + (s - 0.5) * (1.0 - 0.80) / 0.5;
  }

  function totalPower(rho, N, mu, stages, T, opts) {
    opts = opts || {};
    const baffled = opts.baffled === undefined ? true : !!opts.baffled;
    const dataset = opts.dataset || "LIT";
    const mechEff = opts.mechEff === undefined ? 0.95 : opts.mechEff;
    const margin = opts.margin === undefined ? 1.15 : opts.margin;

    const r = mkResult("교반 동력 및 토출량", "P = Np*rho*N^3*D^5  [HIM Ch.6]");
    r.addInput("rho (밀도)", rho, "kg/m3");
    r.addInput("mu (점도)", mu, "Pa*s", (mu * 1000).toFixed(0) + " cP");
    r.addInput("N (회전수)", N, "rev/s", rpsToRpm(N).toFixed(1) + " rpm");
    r.addInput("T (탱크 내경)", T * 1000.0, "mm");
    r.addInput("배플", baffled ? "설치" : "없음");
    r.addInput("기계효율", mechEff, "-");
    r.addInput("모터 여유율", margin, "-");
    r.addInput("데이터셋", dataset);

    const Dmax = Math.max.apply(null, stages.map(s => s.D));
    const ReGov = reynolds(rho, N, Dmax, mu);
    r.addStep("Re (최대경 기준)", "rho*N*D^2/mu", ReGov);
    r.addStep("유동영역", "", flowRegime(ReGov));

    let fInt = 1.0;
    const elevs = stages.map(s => s.elevation);
    if (stages.length > 1 && elevs.every(e => e != null)) {
      let sp = Infinity;
      for (let i = 0; i < elevs.length - 1; i++) sp = Math.min(sp, Math.abs(elevs[i + 1] - elevs[i]));
      fInt = interferenceFactor(sp / Dmax);
      r.addStep("최소 임펠러 간격 S", "", sp * 1000.0, "mm");
      r.addStep("간섭계수 (S/D=" + (sp / Dmax).toFixed(2) + ")", "", fInt);
    } else if (stages.length > 1) {
      r.warn("임펠러 설치높이(elevation) 미입력 → 다단 간섭계수 1.0 적용 " +
             "(간격이 1D 미만이면 실제 동력은 이보다 작다)");
    }

    let Psum = 0, Qsum = 0;
    const detail = [];
    stages.forEach((s, idx) => {
      const D = s.D;
      const im = getImpeller(s.type, dataset);
      const Rei = reynolds(rho, N, D, mu);
      const pn = powerNumber(Rei, im, { W_D: s.W_D, nBlades: s.nBlades, baffled, dataset });
      const Pi = impellerPower(rho, N, D, pn.Np);
      const Qi = pumpingCapacity(N, D, im.Nq);
      Psum += Pi; Qsum += Qi;
      detail.push({ stage: idx + 1, type: im.key, name: im.nameKo, D, Re: Rei,
                    Np: pn.Np, P: Pi, Q: Qi, Nq: im.Nq,
                    governing: pn.governing, dT: D / T });
      const k = idx + 1;
      r.addStep(k + "단 " + im.nameKo + "  D=" + (D * 1000).toFixed(0) + " mm  (D/T=" + (D / T).toFixed(3) + ")", "", "");
      r.addStep("   Re_" + k, "rho*N*D^2/mu", Rei);
      r.addStep("   Np_" + k + "  [" + pn.governing + "]",
        "max(" + pn.Kp.toFixed(1) + "/Re, " + pn.NpTurb.toFixed(2) + ") x " +
        pn.fWidth.toFixed(3) + " x " + pn.fBlades.toFixed(3) + " x " + pn.fBaffle.toFixed(2),
        pn.Np);
      r.addStep("   P_" + k, "Np*rho*N^3*D^5", Pi / 1000.0, "kW");
      r.addStep("   Q_" + k, "Nq(" + im.Nq + ")*N*D^3", Qi * 60.0, "m3/min");
    });

    const Pliq = Psum * fInt;
    const Pmot = Pliq / mechEff * margin;
    r.addStep("P_liquid (액체전달동력 합계)", "S P_i x 간섭계수", Pliq / 1000.0, "kW");
    r.addStep("P_motor_req (필요 모터동력)", "P_liquid / 기계효율 x 여유율", Pmot / 1000.0, "kW");
    r.addStep("Q_total (총 토출량)", "S Q_i", Qsum * 60.0, "m3/min");

    Object.assign(r.results, {
      P_liquid: Pliq, P_shaft: Pliq, P_motor_req: Pmot, Q_total: Qsum,
      Re_gov: ReGov, regime: flowRegime(ReGov), f_interference: fInt,
      stages: detail, D_max: Dmax
    });
    return r;
  }

  const IEC_MOTORS_KW = [0.2, 0.4, 0.75, 1.5, 2.2, 3.7, 5.5, 7.5, 11.0, 15.0,
    18.5, 22.0, 30.0, 37.0, 45.0, 55.0, 75.0, 90.0, 110.0, 132.0, 160.0,
    200.0, 250.0];

  function selectMotor(PreqW, maxLoad) {
    maxLoad = maxLoad === undefined ? 0.90 : maxLoad;
    const Pkw = PreqW / 1000.0;
    for (const m of IEC_MOTORS_KW) {
      if (Pkw / m <= maxLoad) return { motor_kW: m, load_pct: 100.0 * Pkw / m };
    }
    const last = IEC_MOTORS_KW[IEC_MOTORS_KW.length - 1];
    return { motor_kW: last, load_pct: 100.0 * Pkw / last };
  }

  /* ---------------- 혼합시간 ---------------- */
  function blendTime(N, D, T, H, Np, Re, impeller, dataset, constK) {
    const c = constK === undefined ? 5.9 : constK;
    const NthetaTurb = c * Math.pow(Np, -1.0 / 3.0) * Math.pow(T / D, 2) * Math.pow(H / T, 0.5);
    const thetaTurb = NthetaTurb / N;

    let theta, basis, fRe;
    if (Re >= 1e4) { theta = thetaTurb; basis = "난류 상관식"; fRe = 1.0; }
    else { fRe = Math.pow(1e4 / Re, 0.5); theta = thetaTurb * fRe; basis = "천이역 보정 (1e4/Re)^0.5"; }

    let thetaLam = null;
    if (impeller) {
      const im = (typeof impeller === "string") ? getImpeller(impeller, dataset) : impeller;
      if (im.Ntheta) {
        thetaLam = im.Ntheta / N;
        if (thetaLam > theta) { theta = thetaLam; basis = "층류 평탄역 N*theta=" + im.Ntheta; }
      }
    }
    return { theta, theta_turbulent: thetaTurb, f_Re: fRe,
             theta_laminar_floor: thetaLam, basis, N_theta: NthetaTurb };
  }

  const turnoverTime = (V, Q) => (Q > 0 ? V / Q : Infinity);
  const specificPower = (P, V) => P / V;

  function vortexCheck(Re, Fr, baffled) {
    if (baffled) return { ok: true, msg: "배플 설치 — 볼텍스 억제" };
    if (Re < 300) return { ok: true, msg: "Re=" + Re.toFixed(0) + " < 300, 점성지배로 볼텍스 미미 (무배플 가능)" };
    if (Fr <= 0.1) return { ok: true, msg: "Fr=" + Fr.toFixed(3) + " <= 0.1, 무배플 허용범위" };
    if (Fr <= 0.3) return { ok: false, msg: "Fr=" + Fr.toFixed(3) + " — 볼텍스 주의. 편심설치/경사설치 검토" };
    return { ok: false, msg: "Fr=" + Fr.toFixed(3) + " > 0.3 — 배플 필수 또는 회전수 하향" };
  }

  /* ---------------- 형상 산정 ---------------- */
  const VISCOSITY_GUIDE = [
    [100, "HYDROFOIL", 0.40, [3.0, 6.0], true, "저점도 대용량 블렌딩"],
    [1000, "PBT4", 0.40, [2.5, 5.0], true, "범용 중저점도"],
    [10000, "PBT4", 0.50, [2.0, 4.0], true, "중점도. D/T 확대·저속화"],
    [50000, "MAXBLEND", 0.60, [1.5, 3.5], false, "고점도. 광폭 대형임펠러"],
    [200000, "MAXBLEND", 0.70, [1.0, 3.0], false, "고점도. 배플 불필요"],
    [1000000, "RIBBON", 0.93, [0.5, 2.0], false, "초고점도 층류. 근접간극"],
    [Infinity, "RIBBON", 0.95, [0.3, 1.5], false, "페이스트·반고체"],
  ];

  const AGITATION_LEVELS = {
    mild: [20, 100, "완만 — 액위 균일화, 저점도 블렌딩"],
    moderate: [100, 300, "보통 — 일반 혼합, 열전달"],
    vigorous: [300, 800, "강 — 고체현탁, 가스분산, 반응"],
    intense: [800, 2000, "격렬 — 미세분산, 유화, 결정화"],
  };

  function selectType(muCP, opts) {
    opts = opts || {};
    const row = VISCOSITY_GUIDE.find(r => muCP <= r[0]);
    let key = row[1], dT = row[2];
    const tip = row[3], baffled = row[4];
    const notes = ["점도 " + Math.round(muCP).toLocaleString() + " cP → " + row[5]];

    if (opts.hasGas && muCP <= 5000) {
      key = "RUSHTON"; dT = 0.33; notes.push("가스분산 요구 → 반경류 원판터빈으로 변경");
    } else if (opts.hasSolids && muCP <= 10000) {
      key = "PBT4"; dT = 0.40; notes.push("고체현탁 요구 → 축류 성분이 있는 45도 피치블레이드");
    }
    if (opts.shearSensitive && muCP <= 5000) {
      key = "HYDROFOIL"; dT = 0.45; notes.push("전단민감 → 저전단 하이드로포일, D/T 확대·저속화");
    }
    const im = getImpeller(key);
    return { type: key, name: im.nameKo, dT, tip_speed_range: tip, baffled,
             reason: notes.join(" / "), impeller: im };
  }

  /* 광폭 대형임펠러(맥스블렌드형)·근접간극형(앵커/리본)은 임펠러 자체가 액주
     전체를 덮는 하나의 구조물이므로 다단으로 쌓지 않는다 — 항상 1단. */
  function nStages(H, D, T, impeller) {
    if (impeller != null) {
      const im = (typeof impeller === "string") ? getImpeller(impeller) : impeller;
      if (im.key === "MAXBLEND" || im.flow === TANGENTIAL) return 1;
    }
    const ratio = H / D;
    if (ratio <= 1.2) return 1;
    return Math.ceil((ratio - 1.2) / 1.0) + 1;
  }

  function recommend(T, V, muCP, opts) {
    opts = opts || {};
    let sel;
    if (opts.impellerType == null) sel = selectType(muCP, opts);
    else {
      const auto = selectType(muCP, opts);
      const imf = getImpeller(opts.impellerType);
      sel = { type: imf.key, impeller: imf, dT: opts.dT,
              baffled: (imf.flow === TANGENTIAL || imf.key === "MAXBLEND") ? false : auto.baffled,
              tip_speed_range: auto.tip_speed_range, name: imf.nameKo,
              reason: "형식 지정(" + imf.nameKo + ") / " + auto.reason };
    }
    const im = sel.impeller;
    let dT = opts.dT == null ? sel.dT : opts.dT;
    dT = Math.min(Math.max(dT, im.dT[0]), im.dT[1]);

    const A = Math.PI * T * T / 4.0;
    const H = V * (1.0 - (opts.dishVolumeFrac || 0)) / A;
    const D = dT * T;
    const nImp = opts.nImp == null ? nStages(H, D, T, im) : opts.nImp;

    const closeClearance = im.flow === TANGENTIAL;
    const wideLarge = im.key === "MAXBLEND" || dT >= 0.55;

    let C_T;
    if (closeClearance) C_T = 0.05;
    else if (wideLarge) C_T = 0.04;
    else if (nImp === 1) C_T = (H / T <= 1.2) ? 0.33 : 0.25;
    else C_T = 0.25;
    const C = C_T * T;

    const W_D = opts.W_D == null ? (im.W_D ? im.W_D : 0.15) : opts.W_D;
    const W = W_D * D;

    let elevations;
    if (nImp === 1) elevations = [C];
    else {
      let top = Math.min(H - 0.5 * D, 0.85 * H);
      top = Math.max(top, C + 1.0 * D);
      const step = (top - C) / (nImp - 1);
      elevations = [];
      for (let i = 0; i < nImp; i++) elevations.push(C + i * step);
    }
    const spacing = nImp > 1 ? (elevations[1] - elevations[0]) : null;

    const baffled = sel.baffled;
    const nBaffle = baffled ? 4 : 0;
    const B = baffled ? T / 12.0 : 0.0;
    let Bwall = baffled ? B / 6.0 : 0.0;
    if (baffled && muCP > 5000) Bwall = B / 2.0;

    const res = {
      T, V, H, H_T: H / T, mu_cP: muCP,
      impeller_type: sel.type, impeller_name: sel.name, flow: im.flow,
      reason: sel.reason, D, D_T: dT, n_impellers: nImp,
      W, W_D, C, C_T, elevations, spacing,
      spacing_over_D: spacing ? spacing / D : null,
      baffled, n_baffles: nBaffle, B, B_T: B ? B / T : 0.0,
      B_wall_clearance: Bwall, tip_speed_range: sel.tip_speed_range,
      close_clearance: closeClearance
    };

    if (sel.type === "RUSHTON") {
      res.disc_D = 0.75 * D; res.blade_L = 0.25 * D; res.n_blades = 6;
      res.blade_thk = Math.max(0.004, 0.01 * W);
    } else if (sel.type.startsWith("PBT")) {
      res.n_blades = im.nBlades; res.blade_angle_deg = 45.0;
      res.hub_D = 0.25 * D; res.blade_thk = Math.max(0.005, 0.02 * W);
    } else if (sel.type === "PADDLE2") {
      res.n_blades = 2; res.blade_angle_deg = 90.0;
      res.hub_D = 0.25 * D; res.blade_thk = Math.max(0.005, 0.02 * W);
    } else if (sel.type === "MAXBLEND") {
      res.lower_paddle_H = 0.35 * H; res.lower_paddle_W = D;
      res.grid_H = 0.50 * H; res.total_impeller_H = 0.85 * H;
      res.n_grid_bars = 2; res.blade_thk = Math.max(0.006, 0.004 * D);
      res.note_shape = "하부 광폭 패들(높이 0.35H)이 바닥 근처 유동을, 상부 격자(0.50H)가 " +
        "액면부 인입을 담당. 임펠러 전체가 액주 대부분을 덮으므로 단수는 1단이고 " +
        "바닥간극은 0.04T 로 근접시킨다. 배플 없이 축방향 순환 형성";
    } else if (sel.type === "ANCHOR" || sel.type === "RIBBON") {
      res.wall_clearance = 0.02 * T;
      res.pitch = sel.type === "RIBBON" ? D : null;
      res.ribbon_W = sel.type === "RIBBON" ? 0.10 * D : null;
      res.n_flights = 2; res.blade_thk = Math.max(0.008, 0.006 * D);
    }
    return res;
  }

  /* ---------------- 축 설계 ---------------- */
  const MATERIALS = {
    SS400: { Sy: 245.0, Su: 400.0, E: 200000.0, rho: 7850.0, name: "일반구조용강" },
    SM45C: { Sy: 343.0, Su: 569.0, E: 205000.0, rho: 7850.0, name: "기계구조용탄소강" },
    SUS304: { Sy: 205.0, Su: 520.0, E: 193000.0, rho: 7930.0, name: "스테인리스 304" },
    SUS316L: { Sy: 175.0, Su: 480.0, E: 193000.0, rho: 7980.0, name: "스테인리스 316L" },
    SUS329J: { Sy: 450.0, Su: 620.0, E: 200000.0, rho: 7800.0, name: "2상 스테인리스" },
  };
  const F_IMB_BAFFLED = 0.25, F_IMB_UNBAFFLED = 0.50;

  function allowableShear(material, keyway, weld) {
    const m = MATERIALS[material];
    let tau = Math.min(0.30 * m.Sy, 0.18 * m.Su);
    if (keyway || weld) tau *= 0.75;
    return tau;
  }

  function sectionProps(doMM, diMM) {
    const dd = doMM, di = diMM || 0;
    const A = Math.PI / 4.0 * (dd * dd - di * di);
    const Iv = Math.PI / 64.0 * (Math.pow(dd, 4) - Math.pow(di, 4));
    const Z = Iv / (dd / 2.0);
    const Zp = Math.PI / 16.0 * (Math.pow(dd, 4) - Math.pow(di, 4)) / dd;
    return { A, I: Iv, Z, Zp };
  }

  function estimateImpellerMass(D_m, material) {
    const rr = MATERIALS[material || "SUS304"].rho / MATERIALS.SUS304.rho;
    return 55.0 * Math.pow(D_m, 2.6) * rr;
  }

  function minShaftDiameter(PmotorKW, rpm, material, serviceFactor, keyway, bendingRatio) {
    material = material || "SUS304";
    serviceFactor = serviceFactor === undefined ? 1.5 : serviceFactor;
    keyway = keyway === undefined ? true : keyway;
    bendingRatio = bendingRatio === undefined ? 0.5 : bendingRatio;
    const omega = 2.0 * Math.PI * rpm / 60.0;
    const Td = PmotorKW * 1000.0 / omega * serviceFactor;
    const tauA = allowableShear(material, keyway);
    const Teq = Td * Math.sqrt(1.0 + bendingRatio * bendingRatio) * 1000.0;
    return Math.pow(16.0 * Teq / (Math.PI * tauA), 1.0 / 3.0);
  }

  function designShaft(PmotorKW, rpm, dShaftMM, LShaftMM, impellers, opts) {
    opts = opts || {};
    const material = opts.material || "SUS304";
    const dInner = opts.dInnerMM || 0.0;
    const SF = opts.serviceFactor === undefined ? 1.5 : opts.serviceFactor;
    const baffled = opts.baffled === undefined ? true : !!opts.baffled;
    const keyway = opts.keyway === undefined ? true : !!opts.keyway;
    const m = MATERIALS[material];

    const r = mkResult("교반축 강도·진동 검토 (" + material + ", φ" + dShaftMM.toFixed(0) +
      (dInner ? " 중공" : "") + " x " + LShaftMM.toFixed(0) + "L)", "ASME B106.1M / HIM Ch.21");
    r.addInput("P_motor (모터 정격)", PmotorKW, "kW");
    r.addInput("N (정격 회전수)", rpm, "rpm");
    r.addInput("d_o (축 외경)", dShaftMM, "mm");
    if (dInner) r.addInput("d_i (축 내경)", dInner, "mm");
    r.addInput("L (베어링~최하단 임펠러)", LShaftMM, "mm");
    r.addInput("재질", material, "", m.name + "  Sy=" + m.Sy + " Su=" + m.Su + " MPa");
    r.addInput("서비스팩터", SF, "-");
    r.addInput("배플", baffled ? "설치" : "없음");

    const sp = sectionProps(dShaftMM, dInner);
    r.addStep("단면적 A", "pi/4*(do^2-di^2)", sp.A, "mm2");
    r.addStep("단면2차모멘트 I", "pi/64*(do^4-di^4)", sp.I, "mm4");
    r.addStep("비틀림 단면계수 Zp", "pi/16*(do^4-di^4)/do", sp.Zp, "mm3");

    const omega = 2.0 * Math.PI * rpm / 60.0;
    const Trated = PmotorKW * 1000.0 / omega;
    const Tdesign = Trated * SF;
    const tau = Tdesign * 1000.0 / sp.Zp;
    r.addStep("정격토크 T_rated", "P/omega", Trated, "N*m");
    r.addStep("설계토크 T_design", "T_rated x SF", Tdesign, "N*m");
    r.addStep("비틀림응력 tau", "T/Zp", tau, "MPa");

    const fImb = baffled ? F_IMB_BAFFLED : F_IMB_UNBAFFLED;
    r.addStep("수력 불균형계수 f_imb", "", fImb);

    const w = impellers.map(im => Math.pow(im.D, 5));
    const wSum = w.reduce((a, b) => a + b, 0) || 1.0;
    let Mb = 0, Ftot = 0;
    impellers.forEach((im, i) => {
      const Ti = Tdesign * w[i] / wSum;
      const R75 = 0.75 * im.D / 2.0;
      const Ftan = Ti / R75;
      const Fh = fImb * Ftan;
      Mb += Fh * im.a / 1000.0;
      Ftot += Fh;
      im._F_hyd = Fh; im._T_i = Ti;
      r.addStep("  임펠러 D=" + im.D + "m  a=" + im.a + "mm : F_hyd",
        "f_imb*T_i/(0.75*D/2), T_i=" + Ti.toFixed(1) + "N*m", Fh, "N");
    });
    r.addStep("굽힘모멘트 M_b", "S F_hyd*a", Mb, "N*m");
    const sigmaB = Mb * 1000.0 / sp.Z;
    r.addStep("굽힘응력 sigma_b", "M_b/Z", sigmaB, "MPa");

    const tauMax = Math.sqrt(Mb * Mb + Tdesign * Tdesign) * 1000.0 / sp.Zp;
    const sigmaVM = Math.sqrt(sigmaB * sigmaB + 3.0 * tau * tau);
    const tauAllow = allowableShear(material, keyway);
    r.addStep("조합 최대전단응력 tau_max", "sqrt(Mb^2+T^2)/Zp  (최대전단응력설)", tauMax, "MPa");
    r.addStep("등가응력 sigma_vm", "sqrt(sb^2+3*tau^2)  (von Mises)", sigmaVM, "MPa");
    r.addStep("허용전단응력 tau_allow",
      "min(0.30Sy,0.18Su)" + (keyway ? " x0.75(키홈)" : ""), tauAllow, "MPa");
    r.addCheck("조합응력 tau_max=" + tauMax.toFixed(1) + " <= tau_allow=" +
      tauAllow.toFixed(1) + " MPa", tauMax <= tauAllow,
      tauMax > 0 ? "안전율 " + (tauAllow / tauMax).toFixed(2) : "");

    const L = LShaftMM;
    const dTip = impellers.reduce((acc, im) =>
      acc + im._F_hyd * im.a * im.a * (3.0 * L - im.a) / (6.0 * m.E * sp.I), 0);
    r.addStep("최하단 처짐 delta_tip", "S F*a^2*(3L-a)/(6EI)", dTip, "mm");

    let dSeal = null;
    if (opts.sealPositionMM) {
      const xs = opts.sealPositionMM;
      dSeal = impellers.reduce((acc, im) => acc + im._F_hyd *
        (xs <= im.a ? xs * xs * (3.0 * im.a - xs) : im.a * im.a * (3.0 * xs - im.a))
        / (6.0 * m.E * sp.I), 0);
      const lim = opts.deflectionLimitSealMM === undefined ? 0.15 : opts.deflectionLimitSealMM;
      r.addStep("씰 위치 처짐 delta_seal", "", dSeal, "mm");
      r.addCheck("씰부 처짐 " + dSeal.toFixed(3) + " <= " + lim + " mm",
        dSeal <= lim, "메카니컬씰 면압 유지 조건");
      r.results.delta_seal_mm = dSeal;
    }

    const mShaft = sp.A * L * m.rho / 1e9;
    let mEq = 0.24 * mShaft;
    impellers.forEach(im => {
      let mi = im.mass;
      if (mi == null) { mi = estimateImpellerMass(im.D, material); im._mass_est = mi; }
      mEq += mi * Math.pow(im.a / L, 3);
    });
    const kEff = 3.0 * m.E * sp.I / Math.pow(L, 3);
    const NcHz = (1.0 / (2.0 * Math.PI)) * Math.sqrt(kEff * 1000.0 / mEq);
    const NcRpm = NcHz * 60.0;
    r.addStep("축 질량 m_shaft", "A*L*rho", mShaft, "kg");
    r.addStep("등가질량 m_eq", "0.24*m_shaft + S m_i*(a/L)^3", mEq, "kg");
    r.addStep("횡강성 k_eff", "3EI/L^3", kEff, "N/mm");
    r.addStep("1차 위험속도 N_c", "(1/2pi)*sqrt(k/m)", NcRpm, "rpm");

    const ratio = rpm / NcRpm;
    r.addStep("N/N_c (정격)", "", ratio);
    r.addCheck("정격 N/N_c = " + ratio.toFixed(3) + " <= 0.70 (아임계 운전)",
      ratio <= 0.70, "0.7~1.3 구간은 공진대역");

    if (opts.rpmMin != null) {
      const lo = 0.70 * NcRpm, hi = 1.30 * NcRpm;
      const clash = !(rpm <= lo || opts.rpmMin >= hi);
      r.addStep("공진 회피대역", "0.7~1.3 x N_c", lo.toFixed(1) + " ~ " + hi.toFixed(1), "rpm");
      r.addCheck("인버터 운전범위 " + opts.rpmMin + "~" + rpm + " rpm 이 회피대역 밖",
        !clash, "V.V.V.F 는 전 운전구간 검토 필요");
      r.results.resonance_band_rpm = [lo, hi];
    }

    Object.assign(r.results, {
      T_rated_Nm: Trated, T_design_Nm: Tdesign, tau_MPa: tau,
      sigma_b_MPa: sigmaB, tau_max_MPa: tauMax, sigma_vm_MPa: sigmaVM,
      tau_allow_MPa: tauAllow,
      SF_stress: tauMax ? tauAllow / tauMax : Infinity,
      delta_tip_mm: dTip, m_shaft_kg: mShaft, m_eq_kg: mEq,
      N_crit_rpm: NcRpm, N_over_Nc: ratio, F_hyd_total_N: Ftot, M_b_Nm: Mb,
      d_shaft_mm: dShaftMM
    });
    return r;
  }

  /* ---------------- 공정 검토 ---------------- */
  const S_ZWIETERING = { RUSHTON: 6.7, FBT6: 6.7, PBT4: 5.8, PBT6: 5.8,
    PROP: 6.6, HYDROFOIL: 6.2, PADDLE2: 8.0, MAXBLEND: 7.0, ANCHOR: 12.0,
    RIBBON: 12.0 };

  function justSuspendedSpeed(rhoL, mu, rhoS, dp, Xwt, D, T, impeller, S) {
    const im = getImpeller(impeller || "PBT4");
    if (S == null) S = (S_ZWIETERING[im.key] || 6.5) * Math.pow(T / D / 3.0, 1.33);
    const nu = mu / rhoL;
    const drho = rhoS - rhoL;
    if (drho <= 0) throw new Error("고체 밀도가 액체보다 작거나 같음 — 부상현탁 문제로 별도 검토");
    const Njs = S * Math.pow(nu, 0.1) * Math.pow(G * drho / rhoL, 0.45) *
      Math.pow(Xwt, 0.13) * Math.pow(dp, 0.2) / Math.pow(D, 0.85);
    return { N_js_rps: Njs, N_js_rpm: Njs * 60.0, S,
             warn: mu > 1.0 ? "점도 " + (mu * 1000).toFixed(0) +
               " cP — Zwietering 식 검증범위(<1000 cP) 초과. 회전수 20~30% 상향 검토" : null };
  }

  /* 항복응력 유체 캐번 직경 — Elson 구형 캐번 모델.
     고점도/항복응력 계에서는 Zwietering 대신 이 기준으로 데드존을 판정한다. */
  function cavernDiameter(rho, N, D, T, Np, tauY) {
    const ratio3 = (4.0 / (Math.PI * Math.PI)) * Np * rho * N * N * D * D / tauY;
    const Dc = D * Math.pow(ratio3, 1.0 / 3.0);
    return { Dc, Dc_over_T: Dc / T, full_motion: Dc >= T, ratio3 };
  }

  function jacketHeatTransfer(rho, mu, k, cp, N, D, T, muWall) {
    const Re = reynolds(rho, N, D, mu);
    const Pr = cp * mu / k;
    const fv = muWall ? Math.pow(mu / muWall, 0.14) : 1.0;
    const Nu = 0.74 * Math.pow(Re, 0.67) * Math.pow(Pr, 0.33) * fv;
    return { h: Nu * k / T, Nu, Re, Pr,
             warn: Re < 1e4 ? "Re<1e4 — 난류 상관식이므로 과대평가. 실측 권장" : null };
  }

  function coilHeatTransfer(rho, mu, k, cp, N, D, dCoil, muWall) {
    const Re = reynolds(rho, N, D, mu);
    const Pr = cp * mu / k;
    const fv = muWall ? Math.pow(mu / muWall, 0.14) : 1.0;
    const Nu = 0.87 * Math.pow(Re, 0.62) * Math.pow(Pr, 0.33) * fv;
    return { h: Nu * k / dCoil, Nu, Re, Pr,
             warn: "내부 코일은 배플과 유사한 선회류 억제 효과가 있어 동력이 10~20% 증가한다" };
  }

  function gasDispersionCheck(N, D, T, Qgas) {
    const Flg = Qgas / (N * Math.pow(D, 3));
    const Fr = N * N * D / G;
    const Ftr = 30.0 * Math.pow(D / T, 3.5) * Fr;
    return { Fl_g: Flg, Fl_trans: Ftr, Fr, dispersed: Flg < Ftr };
  }

  /* ---------------- 종합 선정 ---------------- */
  const STD_RPM = [10, 12, 15, 17, 20, 21, 25, 28, 30, 35, 37, 44, 50, 56, 62,
    68, 75, 82, 90, 100, 110, 125, 140, 155, 175, 200, 230, 260, 300, 350,
    400, 450, 500];
  const STD_SHAFT_DIA = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
    95, 100, 110, 120, 130, 140, 150, 160, 170, 180, 200, 220, 250];

  function snapRpm(rpm) {
    return STD_RPM.reduce((a, b) => Math.abs(b - rpm) < Math.abs(a - rpm) ? b : a);
  }
  /* 스냅된 표준 회전수와 인접 두 단계 (익단속도 조정용).
     순서: 스냅값 -> 한 단계 위 -> 한 단계 아래. */
  function rpmCandidates(rpm) {
    const s = snapRpm(rpm), i = STD_RPM.indexOf(s), out = [s];
    if (i + 1 < STD_RPM.length) out.push(STD_RPM[i + 1]);
    if (i - 1 >= 0) out.push(STD_RPM[i - 1]);
    return out;
  }
  function snapShaftDia(d) {
    for (const s of STD_SHAFT_DIA) if (s >= d) return s;
    return STD_SHAFT_DIA[STD_SHAFT_DIA.length - 1];
  }
  function nextShaftDia(d) {
    for (const s of STD_SHAFT_DIA) if (s > d + 0.5) return s;
    return null;
  }

  function powerAt(N, rho, mu, stages, baffled, dataset) {
    let P = 0;
    for (const s of stages) {
      const Re = reynolds(rho, N, s.D, mu);
      const pn = powerNumber(Re, s.type, { W_D: s.W_D, nBlades: s.nBlades, baffled, dataset });
      P += pn.Np * rho * Math.pow(N, 3) * Math.pow(s.D, 5);
    }
    return P;
  }

  function solveNforPV(targetPV, V, rho, mu, stages, baffled, dataset) {
    const targetP = targetPV * V;
    let lo = 0.005, hi = 30.0;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (powerAt(mid, rho, mu, stages, baffled, dataset) < targetP) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function solveNforBlend(targetS, T, H, stages, rho, mu, baffled, dataset) {
    const D = Math.max.apply(null, stages.map(s => s.D));
    const th = N => {
      const Re = reynolds(rho, N, D, mu);
      const pn = powerNumber(Re, stages[0].type, { baffled, dataset });
      return blendTime(N, D, T, H, pn.Np, Re, stages[0].type, dataset).theta;
    };
    let lo = 0.005, hi = 30.0;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (th(mid) > targetS) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function design(o) {
    const V = o.V, rho = o.rho, muCP = o.mu_cP;
    const mu = cPToPas(muCP);
    const H_T = o.H_T === undefined ? 1.1 : o.H_T;
    const basis = o.basis || "level";
    const level = o.level || "moderate";
    const dataset = o.dataset || "LIT";
    const mechEff = o.mechEff === undefined ? 0.95 : o.mechEff;
    const motorMargin = o.motorMargin === undefined ? 1.15 : o.motorMargin;
    const maxLoad = o.maxLoad === undefined ? 0.90 : o.maxLoad;
    const material = o.material || "SUS304";
    const shaftExtra = o.shaftExtraMM === undefined ? 600.0 : o.shaftExtraMM;
    const SF = o.serviceFactor === undefined ? 1.5 : o.serviceFactor;
    const vfdRatio = o.vfdMinRpmRatio === undefined ? 0.3 : o.vfdMinRpmRatio;

    const T = o.T == null ? Math.pow(4.0 * V / (Math.PI * H_T), 1 / 3) : o.T;
    const H = liquidHeight(T, V);

    const g0 = recommend(T, V, muCP, { impellerType: o.impellerType, dT: o.dT,
      nImp: o.nImp, W_D: o.W_D, hasGas: o.hasGas, hasSolids: !!o.solids,
      shearSensitive: o.shearSensitive });
    const im0 = getImpeller(g0.impeller_type, dataset);
    const baffled = o.baffled === undefined || o.baffled === null ? g0.baffled : !!o.baffled;

    let targetPV = o.targetPV;
    if (targetPV == null && basis === "level") {
      const lv = AGITATION_LEVELS[level];
      targetPV = 0.5 * (lv[0] + lv[1]);
    }

    const build = dTtry => {
      const gg = recommend(T, V, muCP, { impellerType: g0.impeller_type,
        dT: dTtry, nImp: o.nImp, W_D: o.W_D });
      const sg = gg.elevations.map(e => ({ type: gg.impeller_type, D: gg.D,
        W_D: gg.W_D, elevation: e }));
      return [gg, sg];
    };

    const Nfor = (gg, sg) => {
      if (basis === "rpm") {
        if (o.rpm == null) throw new Error("basis='rpm' 이면 rpm 을 지정해야 한다");
        return [rpmToRps(o.rpm), "회전수 직접 지정 " + o.rpm + " rpm"];
      }
      if (basis === "blend") {
        if (o.targetBlendMin == null) throw new Error("basis='blend' 이면 targetBlendMin 을 지정해야 한다");
        return [solveNforBlend(o.targetBlendMin * 60.0, T, H, sg, rho, mu, baffled, dataset),
                "목표 혼합시간 " + o.targetBlendMin + " min"];
      }
      if (basis === "suspension") {
        if (!o.solids) throw new Error("basis='suspension' 이면 solids 를 지정해야 한다");
        const zr = justSuspendedSpeed(rho, mu, o.solids.rho_s, o.solids.d_p,
          o.solids.X_wt_pct, gg.D, T, gg.impeller_type);
        return [zr.N_js_rps * 1.2, "N_js " + zr.N_js_rpm.toFixed(1) + " rpm x 1.2 여유"];
      }
      return [solveNforPV(targetPV, V, rho, mu, sg, baffled, dataset),
              "교반강도 '" + level + "' 목표 P/V = " + targetPV.toFixed(0) + " W/m3"];
    };

    let candidates;
    if (o.dT != null || basis === "rpm") candidates = [g0.D_T];
    else {
      const [lod, hid] = im0.dT;
      const n = Math.round((hid - lod) / 0.05) + 1;
      const scan = [];
      for (let i = 0; i < n; i++) scan.push(Math.round((lod + i * 0.05) * 1000) / 1000);
      scan.push(g0.D_T);
      candidates = Array.from(new Set(scan)).sort((a, b) =>
        Math.abs(a - g0.D_T) - Math.abs(b - g0.D_T));
    }

    let best = null, found = false;
    for (const dTtry of candidates) {
      const [gg, sg] = build(dTtry);
      const [Ntry, noteBase] = Nfor(gg, sg);
      const rpmC = rpsToRpm(Ntry);
      const [lot, hit] = gg.tip_speed_range;
      // 표준 회전수 스냅으로 익단속도가 권장범위를 살짝 벗어날 수 있으므로
      // 인접 표준 회전수까지 함께 검토한다 (P/V 는 밴드이므로 소폭 변동 허용).
      const rpmList = basis === "rpm" ? [o.rpm] : rpmCandidates(rpmC);
      for (const rpmS of rpmList) {
        const Ns = rpmToRps(rpmS);
        const vt = tipSpeed(Ns, gg.D);
        let note = noteBase;
        if (basis !== "rpm" && rpmS !== snapRpm(rpmC)) {
          note += "  (익단속도 확보를 위해 " + snapRpm(rpmC) + " -> " + rpmS + " rpm 조정)";
        }
        if (lot <= vt && vt <= hit) {
          best = [gg, sg, Ns, rpmC, rpmS, note, 0.0]; found = true; break;
        }
        const dev = vt < lot ? lot - vt : vt - hit;
        if (best === null || dev < best[6]) best = [gg, sg, Ns, rpmC, rpmS, note, dev];
      }
      if (found) break;
    }

    let [g, stagesGeo, N, rpmCalc, rpmFinal, basisNote, tipDev] = best;
    const im = getImpeller(g.impeller_type, dataset);
    if (tipDev > 0) basisNote += "  (익단속도 권장범위를 만족하는 D/T·rpm 조합 없음 — " +
      "최근접 채택. D/T 상한 확대 또는 형식 변경 검토)";

    const pr = totalPower(rho, N, mu, stagesGeo, T,
      { baffled, dataset, mechEff, margin: motorMargin });
    const Pliq = pr.results.P_liquid;
    const ms = selectMotor(pr.results.P_motor_req, maxLoad);

    const D = g.D;
    const Re = reynolds(rho, N, D, mu);
    const Fr = froude(N, D);
    const vTip = tipSpeed(N, D);
    const PV = specificPower(Pliq, V);
    const pnGov = powerNumber(Re, g.impeller_type, { W_D: g.W_D, baffled, dataset });
    const bt = blendTime(N, D, T, H, pnGov.Np, Re, g.impeller_type, dataset);
    const tTurn = turnoverTime(V, pr.results.Q_total);

    const Lshaft = shaftExtra + (H - g.elevations[0]) * 1000.0;
    const impShaft = g.elevations.map(e => ({ D, a: shaftExtra + (H - e) * 1000.0 }));
    const shaftOpts = { material, serviceFactor: SF, baffled,
      rpmMin: rpmFinal * vfdRatio, sealPositionMM: shaftExtra * 0.3 };
    let sr = designShaft(ms.motor_kW, rpmFinal,
      snapShaftDia(minShaftDiameter(ms.motor_kW, rpmFinal, material, SF)),
      Lshaft, impShaft.map(x => Object.assign({}, x)), shaftOpts);
    let tries = 0;
    while (!sr.ok && tries < 12) {
      const dn = nextShaftDia(sr.results.d_shaft_mm);
      if (dn === null) break;
      sr = designShaft(ms.motor_kW, rpmFinal, dn, Lshaft,
        impShaft.map(x => Object.assign({}, x)), shaftOpts);
      tries++;
    }

    const r = mkResult("교반기 선정 종합 — V=" + V + " m3, " +
      Math.round(muCP).toLocaleString() + " cP, 비중 " + rho + " kg/m3", "agitcalc");
    // 제작 도면 기준에 맞춰 길이는 mm 로 표시한다 (엔진 내부 계산은 SI m 유지).
    r.addInput("액체 체적 V", V, "m3");
    r.addInput("밀도 rho", rho, "kg/m3");
    r.addInput("점도 mu", muCP, "cP");
    r.addInput("탱크 내경 T", T * 1000.0, "mm", o.T == null ? "산정값" : "");
    r.addInput("액위 H", H * 1000.0, "mm", "H/T = " + (H / T).toFixed(3));
    r.addInput("선정 데이터셋", dataset);
    r.addInput("회전수 결정기준", basisNote);

    r.addStep("임펠러 형식", "", im.nameKo + " x " + g.n_impellers + "단");
    r.addStep("임펠러경 D", "D/T = " + g.D_T.toFixed(3), D * 1000.0, "mm");
    r.addStep("회전수", "계산 " + rpmCalc.toFixed(1) + " -> 표준 스냅", rpmFinal, "rpm");
    r.addStep("Re", "rho*N*D^2/mu", Re);
    r.addStep("유동영역", "", flowRegime(Re));
    r.addStep("익단속도 v_tip", "pi*D*N", vTip, "m/s");
    r.addStep("Fr", "N^2*D/g", Fr);
    r.addStep("액체전달동력 P", "S Np*rho*N^3*D^5", Pliq / 1000.0, "kW");
    r.addStep("단위체적동력 P/V", "P/V", PV, "W/m3");
    r.addStep("필요 모터동력", "P/" + mechEff + " x " + motorMargin,
      pr.results.P_motor_req / 1000.0, "kW");
    r.addStep("선정 모터", "부하율 " + ms.load_pct.toFixed(1) + "%", ms.motor_kW, "kW");
    r.addStep("총 토출량 Q", "S Nq*N*D^3", pr.results.Q_total * 60.0, "m3/min");
    r.addStep("탱크 순환시간", "V/Q", tTurn, "s");
    r.addStep("혼합시간 theta95 [" + bt.basis + "]", "", bt.theta / 60.0, "min");
    r.addStep("축경 x 전장", "", "φ" + sr.results.d_shaft_mm.toFixed(0) + " x " +
      Lshaft.toFixed(0), "mm");
    r.addStep("축 위험속도 N_c", "", sr.results.N_crit_rpm, "rpm");

    const [lot, hit] = g.tip_speed_range;
    r.addCheck("익단속도 " + vTip.toFixed(2) + " m/s 가 권장범위 " + lot + "~" + hit + " 내",
      lot <= vTip && vTip <= hit, "벗어나면 D 또는 rpm 재조정");
    r.addCheck("D/T = " + g.D_T.toFixed(3) + " 가 형식 권장범위 " +
      im.dT[0] + "~" + im.dT[1] + " 내", im.dT[0] <= g.D_T && g.D_T <= im.dT[1]);
    r.addCheck("점도 " + Math.round(muCP).toLocaleString() + " cP <= 형식 실용상한 " +
      im.muMax.toLocaleString() + " cP", muCP <= im.muMax,
      "초과 시 근접간극형(앵커/리본) 검토");
    const vc = vortexCheck(Re, Fr, baffled);
    r.addCheck("볼텍스/배플 — " + vc.msg, vc.ok);
    r.addCheck("모터 부하율 " + ms.load_pct.toFixed(1) + "% <= " +
      (maxLoad * 100).toFixed(0) + "%", ms.load_pct <= maxLoad * 100);
    r.addCheck("축 조합응력 안전율 " + sr.results.SF_stress.toFixed(2) + " >= 1.0",
      sr.results.SF_stress >= 1.0);
    r.addCheck("축 N/N_c = " + sr.results.N_over_Nc.toFixed(3) + " <= 0.70",
      sr.results.N_over_Nc <= 0.70);

    if (flowRegime(Re) !== "난류") {
      r.warn("Re=" + Re.toFixed(0) + " — 난류역이 아니다. 문헌 Np·혼합시간 상관식은 " +
        "난류역에서 얻어진 것이므로 오차가 크다(동력 ±15%, 혼합시간 ±50% 이상). " +
        "고점도 설계는 제조사 실측 또는 CFD 검증을 권장한다.");
    }
    if (bt.theta > 1800) {
      r.warn("혼합시간 " + (bt.theta / 60).toFixed(0) + " min — 과대. D/T 확대 또는 " +
        "회전수 상향, 또는 광폭/근접간극 임펠러로 형식 변경 검토");
    }
    if (!baffled && Re > 1e4) {
      r.warn("무배플 + 난류역 — 선회류로 혼합효율이 크게 떨어진다. 배플 설치 권장");
    }

    return { summary: r, geometry: g, power: pr, shaft: sr, T, H, N,
      rpm: rpmFinal, rpm_calc: rpmCalc, Re, Fr, v_tip: vTip, Np: pnGov.Np,
      P_liquid: Pliq, PV, motor_kW: ms.motor_kW, load_pct: ms.load_pct,
      Q_total: pr.results.Q_total, theta95_s: bt.theta, blend_detail: bt,
      turnover_s: tTurn, shaft_dia_mm: sr.results.d_shaft_mm,
      shaft_len_mm: Lshaft, impeller: im, dataset, baffled };
  }

  /* ---------------- 벤더 검토서 재현 ---------------- */
  function topjinSheet(o) {
    const N = rpmToRps(o.rpm);
    const mu = cPToPas(o.mu_cP);
    const Dlow = o.imps[0][1];
    const mechEff = o.mechEff === undefined ? 0.85 : o.mechEff;
    /* 배플은 동력수에 직접 영향한다. 미지정이면 내부 코일 유무로 추정
       (코일은 배플과 유사한 선회류 억제 효과). 검토서에 NON-BAFFLE 로
       적혀 있으면 baffled:false 를 명시해야 동력 대조가 공정하다. */
    const baffled = (o.baffled === undefined || o.baffled === null)
      ? !!o.hasCoil : !!o.baffled;

    const r = mkResult("TOPJIN 검토서 방식 재현  (T=" + o.T + "m V=" + o.V + "m3 " +
      Math.round(o.mu_cP).toLocaleString() + "cP " + o.rpm + "rpm)",
      "D&K켐텍 YDK-II 검토서 R5 역산");
    r.addInput("Tank Dia. T", o.T, "m");
    r.addInput("Volume V", o.V, "m3");
    r.addInput("비중 rho", o.rho, "kg/m3");
    r.addInput("점도 mu", o.mu_cP, "cP");
    r.addInput("RPM", o.rpm, "rpm");
    r.addInput("기계효율", mechEff, "-");
    r.addInput("배플", baffled ? "설치" : "없음", "", "검토서 비고란 기준 — 동력수에 직접 영향");
    o.imps.forEach((p, i) => {
      const pos = ["하단", "중단", "상단"][Math.min(i, 2)];
      r.addInput("IMPELLER TYPE (" + pos + ")", p[0]);
      r.addInput("IMPELLER SIZE (" + pos + ")", p[1], "m");
    });

    const Re = reynolds(o.rho, N, Dlow, mu);
    const TP = tipSpeed(N, Dlow);
    let Q = 0;
    o.imps.forEach(p => {
      const k = VENDOR_ALIAS[String(p[0]).toUpperCase()] || String(p[0]).toUpperCase();
      Q += TOPJIN_NQ[k] * o.rpm * Math.pow(p[1], 3);
    });
    const QV = Q / o.V;
    r.addStep("Reynolds수 Re", "rho*N*D_하단^2/mu", Re);
    r.addStep("유동영역", "", flowRegime(Re));
    r.addStep("TIP SPEED", "pi*D_하단*N", TP, "m/s");
    r.addStep("토출유량수 Q/V", "S(Nq*rpm*D^3)/V  [Nq 역산확정값]", QV, "回/min");

    let Pw = 0;
    o.imps.forEach(p => {
      const k = VENDOR_ALIAS[String(p[0]).toUpperCase()] || String(p[0]).toUpperCase();
      let Npi, src;
      if (o.NpOverride != null) { Npi = o.NpOverride; src = "지정 Np"; }
      else {
        const Rei = reynolds(o.rho, N, p[1], mu);
        const pn = powerNumber(Rei, k, { baffled, dataset: "LIT" });
        Npi = pn.Np;
        src = "문헌 2점근모델 [" + pn.governing + "]" +
          (pn.fBaffle !== 1.0 ? ", 무배플 보정 x0.70" : "");
      }
      const Pi = Npi * o.rho * Math.pow(N, 3) * Math.pow(p[1], 5);
      Pw += Pi;
      r.addStep("  " + p[0] + " D=" + p[1] + "m : Np = " + Npi.toFixed(4) + " (" + src + ")",
        "Np*rho*N^3*D^5", Pi / 1000.0, "kW");
    });

    const Pcalc = Pw / mechEff / 1000.0;
    const margin = o.hasCoil ? TOPJIN_POWER_MARGIN_COIL : TOPJIN_POWER_MARGIN;
    const Pcorr = Pcalc * margin;
    r.addStep("계산동력 P", "S P_i / 기계효율", Pcalc, "kW");
    r.addStep("보정동력 P_corr", "계산동력 x " + margin, Pcorr, "kW");

    let motor = o.motor_kW, load;
    if (motor == null) { const ms = selectMotor(Pcorr * 1000.0, TOPJIN_MAX_LOAD);
      motor = ms.motor_kW; load = ms.load_pct; }
    else load = 100.0 * Pcorr / motor;
    r.addStep("MOTOR동력 Pm", "", motor, "kW");
    r.addStep("부하율", "보정동력/모터정격", load, "%");
    r.addCheck("부하율 " + load.toFixed(1) + "% <= 90%", load <= 90.0);

    r.warn("검토서의 '계산동력'은 Np 룩업표가 비공개여서 그대로 재현되지 않는다. " +
      "위 동력은 agitcalc 문헌모델 값이다.");
    r.warn("검토서 '교반소요시간(추정)'은 재현 불가 항목이다. 유체역학적 혼합시간은 " +
      "blendTime() 으로 별도 산출해 비교해야 한다.");

    Object.assign(r.results, { Re, TP, QV, Q, P_calc_kW: Pcalc,
      P_corr_kW: Pcorr, motor_kW: motor, load_pct: load, margin, baffled });
    return r;
  }

  /* ---------------- 계산서 텍스트 ---------------- */
  function fmt(v) {
    if (typeof v === "boolean") return v ? "예" : "아니오";
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v)) return String(v);
    if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) return v.toExponential(4);
    return parseFloat(v.toPrecision(6)).toString();
  }

  function reportText(r) {
    const L = [], W = "=".repeat(78);
    L.push(W, r.title);
    if (r.ref) L.push("근거: " + r.ref);
    L.push(W);
    if (r.inputs.length) {
      L.push("[입력]");
      r.inputs.forEach(([n, v, u, note]) =>
        L.push("  " + n.padEnd(34) + " = " + fmt(v).padStart(14) + " " + u +
          (note ? "   (" + note + ")" : "")));
    }
    if (r.steps.length) {
      L.push("[계산]");
      r.steps.forEach(([n, f, v, u]) => {
        L.push("  " + n.padEnd(34) + " = " + fmt(v).padStart(14) + " " + u);
        if (f) L.push("  " + " ".repeat(34) + "   " + f);
      });
    }
    if (r.checks.length) {
      L.push("[검토]");
      r.checks.forEach(([d, p, note]) =>
        L.push("  [" + (p ? "OK " : "NG ") + "] " + d + (note ? "  — " + note : "")));
    }
    if (r.warnings.length) {
      L.push("[경고]");
      r.warnings.forEach(w => L.push("  ! " + w));
    }
    L.push(W);
    return L.join("\n");
  }

  function formatGeometry(g) {
    const L = [], W = "=".repeat(78);
    const mm = x => (x * 1000).toFixed(0);
    L.push(W, "임펠러·탱크 형상 치수  —  " + g.impeller_name + " (" + g.flow + ")", W);
    L.push("선정근거 : " + g.reason, "");
    L.push("[탱크]");
    L.push("  탱크 내경        T = " + mm(g.T).padStart(8) + " mm");
    L.push("  액위             H = " + mm(g.H).padStart(8) + " mm   (H/T = " + g.H_T.toFixed(3) + ")");
    L.push("  액체 체적        V = " + g.V.toFixed(3).padStart(8) + " m3", "");
    L.push("[임펠러]");
    L.push("  형식               = " + g.impeller_type + "  x " + g.n_impellers + " 단");
    L.push("  임펠러경         D = " + mm(g.D).padStart(8) + " mm   (D/T = " + g.D_T.toFixed(3) + ")");
    L.push("  날개폭           W = " + mm(g.W).padStart(8) + " mm   (W/D = " + g.W_D.toFixed(3) + ")");
    L.push("  바닥간극         C = " + mm(g.C).padStart(8) + " mm   (C/T = " + g.C_T.toFixed(3) + ")");
    g.elevations.forEach((e, i) =>
      L.push("  " + (i + 1) + "단 설치높이       = " + mm(e).padStart(8) + " mm  (바닥에서)"));
    if (g.spacing) L.push("  임펠러 간격      S = " + mm(g.spacing).padStart(8) +
      " mm   (S/D = " + g.spacing_over_D.toFixed(2) + ")");
    [["n_blades", "날개 수", 1], ["blade_angle_deg", "날개 각도 [deg]", 1],
     ["disc_D", "원판경", 0], ["blade_L", "날개 길이", 0], ["hub_D", "허브경", 0],
     ["blade_thk", "날개 두께", 0], ["lower_paddle_H", "하부 패들 높이", 0],
     ["grid_H", "상부 격자 높이", 0], ["wall_clearance", "벽 간극", 0],
     ["pitch", "피치", 0], ["ribbon_W", "리본 폭", 0]].forEach(([k, label, raw]) => {
      if (g[k] != null) L.push("  " + label.padEnd(16) + " = " +
        (raw ? g[k].toFixed(0).padStart(8) : mm(g[k]).padStart(8) + " mm"));
    });
    if (g.note_shape) L.push("  형상 비고 : " + g.note_shape);
    L.push("", "[배플]");
    if (g.baffled) L.push("  배플 " + g.n_baffles + "매,  폭 B = " + mm(g.B) +
      " mm (B/T = " + g.B_T.toFixed(4) + "),  벽간극 = " + mm(g.B_wall_clearance) + " mm");
    else L.push("  무배플 — 광폭/근접간극 임펠러로 선회류 억제");
    L.push("", "[권장 익단속도]  " + g.tip_speed_range[0].toFixed(1) + " ~ " +
      g.tip_speed_range[1].toFixed(1) + " m/s", W);
    return L.join("\n");
  }

  function fullReport(res) {
    return [reportText(res.summary), "", formatGeometry(res.geometry), "",
            reportText(res.power), "", reportText(res.shaft)].join("\n");
  }

  return {
    G, AXIAL, RADIAL, MIXED, TANGENTIAL, LIT, TOPJIN_NQ, VENDOR_ALIAS,
    MATERIALS, IEC_MOTORS_KW, STD_RPM, STD_SHAFT_DIA, AGITATION_LEVELS,
    VISCOSITY_GUIDE, S_ZWIETERING,
    mkResult, getImpeller, rpmToRps, rpsToRpm, cPToPas, volumeFromTH,
    liquidHeight, reynolds, froude, tipSpeed, flowRegime, powerNumber,
    apparentViscosityMO, impellerPower, pumpingCapacity, interferenceFactor,
    totalPower, selectMotor, blendTime, turnoverTime, specificPower,
    vortexCheck, selectType, nStages, recommend, allowableShear, sectionProps,
    estimateImpellerMass, minShaftDiameter, designShaft, justSuspendedSpeed,
    cavernDiameter, jacketHeatTransfer, coilHeatTransfer, gasDispersionCheck,
    snapRpm, snapShaftDia, design, topjinSheet, reportText, formatGeometry,
    fullReport, fmt
  };
}));

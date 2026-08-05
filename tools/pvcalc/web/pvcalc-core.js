/* pvcalc-core.js — ASME VIII-1 preliminary calc engine (JS port of pvcalc)
 *
 * Exact port of the Python package in ../pvcalc. Every function returns
 *   { title, codeRef, inputs:[[name,value,unit,note]],
 *     steps:[[name,formula,value,unit]], checks:[[desc,bool]], results:{} }
 * Parity with the Python engine is verified by web/test_core.mjs against
 * vectors generated from Python (tests/test_vectors.json).
 *
 * Units: one consistent set (SI: mm & MPa, or US: in & psi).
 * Works in browser (window.pvcalc) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.pvcalc = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function mkResult(title, codeRef) {
    return { title, codeRef, inputs: [], steps: [], checks: [], results: {},
      notes: [], data: {},
      addInput(n, v, u, note) { this.inputs.push([n, v, u || "", note || ""]); },
      addStep(n, f, v, u) { this.steps.push([n, f, v, u || ""]); },
      addCheck(d, p) { this.checks.push([d, !!p]); },
      addNote(t) { this.notes.push(t); },
      get ok() { return this.checks.every(c => c[1]); } };
  }

  /* ---------------- UG-27 shells ---------------- */

  function cylinderThickness({ P, R, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Cylindrical shell - required thickness (internal pressure)",
      "ASME BPVC VIII-1 UG-27(c)");
    r.addInput("P (design pressure)", P);
    r.addInput("R (inside radius, corroded)", R);
    r.addInput("S (allowable stress)", S);
    r.addInput("E (joint efficiency)", E);
    r.addInput("CA (corrosion allowance)", CA);
    const tCirc = P * R / (S * E - 0.6 * P);
    const tLong = P * R / (2.0 * S * E + 0.4 * P);
    r.addStep("t_circ (circumferential)", "P*R/(S*E - 0.6*P)", tCirc);
    r.addStep("t_long (longitudinal)", "P*R/(2*S*E + 0.4*P)", tLong);
    const tReq = Math.max(tCirc, tLong);
    r.addCheck("Applicability: P <= 0.385*S*E (circ. eq.)", P <= 0.385 * S * E);
    r.addCheck("Applicability: t <= 0.5*R", tReq <= 0.5 * R);
    r.results.t_req = tReq;
    r.results.t_req_ca = tReq + CA;
    r.results.governing = tCirc >= tLong ? "circumferential" : "longitudinal";
    return r;
  }

  function cylinderMawp({ t, R, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Cylindrical shell - MAWP", "ASME BPVC VIII-1 UG-27(c)");
    const tA = t - CA, Rc = R + CA;
    r.addInput("t (nominal thickness)", t);
    r.addInput("CA", CA);
    r.addInput("t_avail = t - CA", tA);
    r.addInput("R (corroded) = R + CA", Rc);
    r.addInput("S", S);
    r.addInput("E", E);
    const pCirc = S * E * tA / (Rc + 0.6 * tA);
    const pLong = 2.0 * S * E * tA / (Rc - 0.4 * tA);
    r.addStep("P_circ", "S*E*t/(R + 0.6*t)", pCirc);
    r.addStep("P_long", "2*S*E*t/(R - 0.4*t)", pLong);
    r.addCheck("t_avail > 0", tA > 0);
    r.addCheck("Applicability: t <= 0.5*R", tA <= 0.5 * Rc);
    r.results.MAWP = Math.min(pCirc, pLong);
    r.results.governing = pCirc <= pLong ? "circumferential" : "longitudinal";
    return r;
  }

  function sphereThickness({ P, R, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Spherical shell - required thickness (internal pressure)",
      "ASME BPVC VIII-1 UG-27(d)");
    r.addInput("P", P); r.addInput("R (inside radius, corroded)", R);
    r.addInput("S", S); r.addInput("E", E); r.addInput("CA", CA);
    const tReq = P * R / (2.0 * S * E - 0.2 * P);
    r.addStep("t_req", "P*R/(2*S*E - 0.2*P)", tReq);
    r.addCheck("Applicability: P <= 0.665*S*E", P <= 0.665 * S * E);
    r.addCheck("Applicability: t <= 0.356*R", tReq <= 0.356 * R);
    r.results.t_req = tReq;
    r.results.t_req_ca = tReq + CA;
    return r;
  }

  function sphereMawp({ t, R, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Spherical shell - MAWP", "ASME BPVC VIII-1 UG-27(d)");
    const tA = t - CA, Rc = R + CA;
    r.addInput("t_avail = t - CA", tA);
    r.addInput("R (corroded)", Rc);
    r.addInput("S", S); r.addInput("E", E);
    const mawp = 2.0 * S * E * tA / (Rc + 0.2 * tA);
    r.addStep("MAWP", "2*S*E*t/(R + 0.2*t)", mawp);
    r.addCheck("t_avail > 0", tA > 0);
    r.results.MAWP = mawp;
    return r;
  }

  function staticHead(rhoKgM3, heightM) {
    return rhoKgM3 * 9.80665 * heightM * 1.0e-6;
  }

  /* ---------------- UG-32 heads ---------------- */

  function ellipsoidalThickness({ P, D, S, E = 1.0, CA = 0.0, D_over_2h = 2.0 }) {
    const r = mkResult("Ellipsoidal head - required thickness",
      "ASME BPVC VIII-1 UG-32(d) / App.1-4(c)");
    r.addInput("P", P); r.addInput("D (inside dia., corroded)", D);
    r.addInput("S", S); r.addInput("E", E);
    r.addInput("D/2h", D_over_2h); r.addInput("CA", CA);
    const K = (2.0 + D_over_2h * D_over_2h) / 6.0;
    r.addStep("K", "(2 + (D/2h)^2)/6", K);
    const tReq = P * D * K / (2.0 * S * E - 0.2 * P);
    r.addStep("t_req", "P*D*K/(2*S*E - 0.2*P)", tReq);
    r.addCheck("Applicability: t/L >= 0.002 (else App.1-4(f) fatigue rules)",
      tReq / (K > 0 ? K * D : D) >= 0.002);
    r.addCheck("Applicability: 1.0 <= D/2h <= 3.0", D_over_2h >= 1.0 && D_over_2h <= 3.0);
    r.results.t_req = tReq;
    r.results.t_req_ca = tReq + CA;
    return r;
  }

  function ellipsoidalMawp({ t, D, S, E = 1.0, CA = 0.0, D_over_2h = 2.0 }) {
    const r = mkResult("Ellipsoidal head - MAWP",
      "ASME BPVC VIII-1 UG-32(d) / App.1-4(c)");
    const tA = t - CA, Dc = D + 2.0 * CA;
    const K = (2.0 + D_over_2h * D_over_2h) / 6.0;
    r.addInput("t_avail = t - CA", tA);
    r.addInput("D (corroded)", Dc);
    r.addInput("K", K);
    const mawp = 2.0 * S * E * tA / (K * Dc + 0.2 * tA);
    r.addStep("MAWP", "2*S*E*t/(K*D + 0.2*t)", mawp);
    r.addCheck("t_avail > 0", tA > 0);
    r.results.MAWP = mawp;
    return r;
  }

  function torisphericalThickness({ P, L, S, E = 1.0, CA = 0.0, r_knuckle = null }) {
    const res = mkResult("Torispherical head - required thickness",
      "ASME BPVC VIII-1 UG-32(e) / App.1-4(d)");
    res.addInput("P", P); res.addInput("L (crown radius, corroded)", L);
    res.addInput("S", S); res.addInput("E", E); res.addInput("CA", CA);
    let tReq;
    if (r_knuckle === null || r_knuckle === undefined || r_knuckle === "") {
      res.addInput("r (knuckle)", 0.06 * L, "", "standard: r = 6% of L");
      tReq = 0.885 * P * L / (S * E - 0.1 * P);
      res.addStep("t_req", "0.885*P*L/(S*E - 0.1*P)", tReq);
      res.results.M = 1.77;
    } else {
      res.addInput("r (knuckle, corroded)", r_knuckle);
      const Lr = L / r_knuckle;
      const M = 0.25 * (3.0 + Math.sqrt(Lr));
      res.addStep("L/r", "L/r", Lr);
      res.addStep("M", "(3 + sqrt(L/r))/4", M);
      tReq = P * L * M / (2.0 * S * E - 0.2 * P);
      res.addStep("t_req", "P*L*M/(2*S*E - 0.2*P)", tReq);
      res.addCheck("Applicability: L/r <= 16.667", Lr <= 16.667);
      res.addCheck("Knuckle radius: r >= 0.06*L and r >= 3*t",
        r_knuckle >= 0.06 * L && r_knuckle >= 3.0 * tReq);
      res.results.M = M;
    }
    res.addCheck("Applicability: t/L >= 0.002 (else App.1-4(f))", tReq / L >= 0.002);
    res.results.t_req = tReq;
    res.results.t_req_ca = tReq + CA;
    return res;
  }

  function torisphericalMawp({ t, L, S, E = 1.0, CA = 0.0, r_knuckle = null }) {
    const res = mkResult("Torispherical head - MAWP",
      "ASME BPVC VIII-1 UG-32(e) / App.1-4(d)");
    const tA = t - CA, Lc = L + CA;
    res.addInput("t_avail = t - CA", tA);
    res.addInput("L (corroded)", Lc);
    let mawp;
    if (r_knuckle === null || r_knuckle === undefined || r_knuckle === "") {
      mawp = S * E * tA / (0.885 * Lc + 0.1 * tA);
      res.addStep("MAWP", "S*E*t/(0.885*L + 0.1*t)", mawp);
    } else {
      const M = 0.25 * (3.0 + Math.sqrt(Lc / r_knuckle));
      res.addStep("M", "(3 + sqrt(L/r))/4", M);
      mawp = 2.0 * S * E * tA / (Lc * M + 0.2 * tA);
      res.addStep("MAWP", "2*S*E*t/(L*M + 0.2*t)", mawp);
    }
    res.addCheck("t_avail > 0", tA > 0);
    res.results.MAWP = mawp;
    return res;
  }

  function hemisphericalThickness({ P, L, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Hemispherical head - required thickness",
      "ASME BPVC VIII-1 UG-32(f)");
    r.addInput("P", P); r.addInput("L (inside radius, corroded)", L);
    r.addInput("S", S); r.addInput("E", E); r.addInput("CA", CA);
    const tReq = P * L / (2.0 * S * E - 0.2 * P);
    r.addStep("t_req", "P*L/(2*S*E - 0.2*P)", tReq);
    r.addCheck("Applicability: t <= 0.356*L", tReq <= 0.356 * L);
    r.addCheck("Applicability: P <= 0.665*S*E", P <= 0.665 * S * E);
    r.results.t_req = tReq;
    r.results.t_req_ca = tReq + CA;
    return r;
  }

  function conicalThickness({ P, D, alpha_deg, S, E = 1.0, CA = 0.0 }) {
    const r = mkResult("Conical section - required thickness",
      "ASME BPVC VIII-1 UG-32(g)");
    const a = alpha_deg * Math.PI / 180.0;
    r.addInput("P", P); r.addInput("D (large-end inside dia.)", D);
    r.addInput("alpha (half-apex angle)", alpha_deg, "deg");
    r.addInput("S", S); r.addInput("E", E); r.addInput("CA", CA);
    const tReq = P * D / (2.0 * Math.cos(a) * (S * E - 0.6 * P));
    r.addStep("t_req", "P*D/(2*cos(a)*(S*E - 0.6*P))", tReq);
    r.addCheck("Applicability: alpha <= 30 deg", alpha_deg <= 30.0);
    r.results.t_req = tReq;
    r.results.t_req_ca = tReq + CA;
    return r;
  }

  /* ---------------- VIII-2 4.4 external pressure ---------------- */

  function designFactor(Fic, Sy) {
    const ratio = Fic / Sy;
    if (ratio <= 0.55) return 2.0;
    if (ratio < 1.0) return 2.407 - 0.741 * ratio;
    return 1.667;
  }

  function cylinderMaep({ Do, t, L, Ey, Sy }) {
    const r = mkResult("Cylindrical shell - allowable external pressure",
      "ASME BPVC VIII-2 para 4.4.5 (equation-based UG-28 alternative)");
    r.addInput("Do (outside diameter)", Do);
    r.addInput("t (corroded thickness)", t);
    r.addInput("L (design length)", L);
    r.addInput("Ey (modulus at temp.)", Ey);
    r.addInput("Sy (yield at temp.)", Sy);
    const Ro = Do / 2.0;
    const Mx = L / Math.sqrt(Ro * t);
    r.addStep("Mx", "L/sqrt(Ro*t)", Mx);
    const mxUpper = 2.0 * Math.pow(Do / t, 0.94);
    let Ch;
    if (Mx >= mxUpper) { Ch = 0.55 * t / Do; r.addStep("Ch (long cylinder)", "0.55*(t/Do)", Ch); }
    else if (Mx > 13.0) { Ch = 1.12 * Math.pow(Mx, -1.058); r.addStep("Ch", "1.12*Mx^-1.058", Ch); }
    else if (Mx > 1.5) { Ch = 0.92 / (Mx - 0.579); r.addStep("Ch", "0.92/(Mx - 0.579)", Ch); }
    else { Ch = 1.0; r.addStep("Ch (short cylinder)", "1.0", Ch); }
    const Fhe = 1.6 * Ch * Ey * t / Do;
    r.addStep("Fhe (elastic hoop buckling)", "1.6*Ch*Ey*t/Do", Fhe);
    const ratio = Fhe / Sy;
    let Fic;
    if (ratio >= 2.439) { Fic = Sy; r.addStep("Fic (yield governs)", "Sy", Fic); }
    else if (ratio > 0.552) { Fic = 0.7 * Sy * Math.pow(ratio, 0.4); r.addStep("Fic (inelastic)", "0.7*Sy*(Fhe/Sy)^0.4", Fic); }
    else { Fic = Fhe; r.addStep("Fic (elastic)", "Fhe", Fic); }
    const FS = designFactor(Fic, Sy);
    const Fha = Fic / FS;
    const Pa = 2.0 * Fha * t / Do;
    r.addStep("FS (design factor)", "para 4.4.2", FS);
    r.addStep("Fha", "Fic/FS", Fha);
    r.addStep("Pa (allowable ext. pressure)", "2*Fha*(t/Do)", Pa);
    r.addCheck("Applicability: Do/t <= 2000", Do / t <= 2000.0);
    r.results.Pa = Pa;
    return r;
  }

  function cylinderThicknessForExternal({ P_ext, Do, L, Ey, Sy, t_lo = 0.1, t_hi = null, tol = 1e-4 }) {
    if (t_hi === null || t_hi === undefined) t_hi = Do / 10.0;
    if (cylinderMaep({ Do, t: t_hi, L, Ey, Sy }).results.Pa < P_ext)
      throw new Error("P_ext not attainable with t up to Do/10 - add stiffening rings");
    let lo = t_lo, hi = t_hi;
    while (hi - lo > tol) {
      const mid = 0.5 * (lo + hi);
      if (cylinderMaep({ Do, t: mid, L, Ey, Sy }).results.Pa >= P_ext) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  function sphereMaep({ Ro, t, Ey, Sy }) {
    const r = mkResult("Sphere / formed head - allowable external pressure",
      "ASME BPVC VIII-2 para 4.4.7");
    r.addInput("Ro (outside spherical radius)", Ro);
    r.addInput("t (corroded thickness)", t);
    r.addInput("Ey", Ey); r.addInput("Sy", Sy);
    const Fhe = 0.075 * Ey * t / Ro;
    r.addStep("Fhe", "0.075*Ey*(t/Ro)", Fhe);
    const ratio = Fhe / Sy;
    let Fic;
    if (ratio >= 6.25) { Fic = Sy; r.addStep("Fic (yield governs)", "Sy", Fic); }
    else if (ratio > 1.6) { Fic = 1.31 * Sy / (1.15 + Sy / Fhe); r.addStep("Fic", "1.31*Sy/(1.15 + Sy/Fhe)", Fic); }
    else if (ratio > 0.55) { Fic = 0.18 * Fhe + 0.45 * Sy; r.addStep("Fic", "0.18*Fhe + 0.45*Sy", Fic); }
    else { Fic = Fhe; r.addStep("Fic (elastic)", "Fhe", Fic); }
    const FS = designFactor(Fic, Sy);
    const Fha = Fic / FS;
    const Pa = 2.0 * Fha * t / Ro;
    r.addStep("FS", "para 4.4.2", FS);
    r.addStep("Fha", "Fic/FS", Fha);
    r.addStep("Pa", "2*Fha*(t/Ro)", Pa);
    r.results.Pa = Pa;
    return r;
  }

  /* ---------------- UG-37 / UG-45 nozzles ---------------- */

  const B3610_STD_WALL_IN = {
    "0.5": 0.109, "0.75": 0.113, "1": 0.133, "1.25": 0.140, "1.5": 0.145,
    "2": 0.154, "2.5": 0.203, "3": 0.216, "3.5": 0.226, "4": 0.237,
    "5": 0.258, "6": 0.280, "8": 0.322, "10": 0.365, "12": 0.375,
    "14": 0.375, "16": 0.375, "18": 0.375, "20": 0.375, "24": 0.375,
  };
  const IN_TO_MM = 25.4;

  /* UW-15(c) weld allowable stress, as a fraction of the base material's. */
  const UW15C_GROOVE_TENSION = 0.74;
  const UW15C_GROOVE_SHEAR = 0.60;
  const UW15C_FILLET_SHEAR = 0.49;
  const UW15C_NOZZLE_WALL_SHEAR = 0.70;

  function areaReinforcement({ d, t, tr, tn, trn, Sv, Sn,
    set_in = true, E1 = 1.0, F = 1.0, te = 0.0, Dp = 0.0, Sp = null,
    leg_nozzle = 0.0, leg_pad = 0.0, leg_inner = 0.0, ti = 0.0, h = 0.0 }) {
    const r = mkResult("Nozzle opening reinforcement", "ASME BPVC VIII-1 UG-37");
    const hasPad = te > 0.0 && Dp > 0.0;
    if (Sp === null || Sp === undefined) Sp = Sn;

    const fr1 = set_in ? Math.min(Sn / Sv, 1.0) : 1.0;
    const fr2 = Math.min(Sn / Sv, 1.0);
    const fr3 = Math.min(Math.min(Sn, Sp) / Sv, 1.0);
    const fr4 = Math.min(Sp / Sv, 1.0);

    [["d (opening, corroded)", d, ""], ["t (shell available)", t, ""],
     ["tr (shell required, E=1)", tr, ""], ["tn (nozzle available)", tn, ""],
     ["trn (nozzle required, E=1)", trn, ""], ["F", F, ""], ["E1", E1, ""],
     ["fr1", fr1, "set-in: Sn/Sv, set-on: 1.0"], ["fr2", fr2, "Sn/Sv"],
     ["fr3", fr3, "min(Sn,Sp)/Sv"], ["fr4", fr4, "Sp/Sv"]]
      .forEach(([n, v, note]) => r.addInput(n, v, "", note));
    if (hasPad) { r.addInput("te (pad thickness)", te); r.addInput("Dp (pad OD)", Dp); }

    const A = d * tr * F + 2.0 * tn * tr * F * (1.0 - fr1);
    r.addStep("A (required)", "d*tr*F + 2*tn*tr*F*(1-fr1)", A);

    const excess = E1 * t - F * tr;
    const A1a = d * excess - 2.0 * tn * excess * (1.0 - fr1);
    const A1b = 2.0 * (t + tn) * excess - 2.0 * tn * excess * (1.0 - fr1);
    const A1 = Math.max(A1a, A1b, 0.0);
    r.addStep("A1 (shell excess)", "max of two UG-37.1 formulas", A1);

    let A2a, A2b;
    if (hasPad) { A2a = 5.0 * (tn - trn) * fr2 * t; A2b = 2.0 * (tn - trn) * (2.5 * tn + te) * fr2; }
    else { A2a = 5.0 * (tn - trn) * fr2 * t; A2b = 5.0 * (tn - trn) * fr2 * tn; }
    const A2 = Math.max(Math.min(A2a, A2b), 0.0);
    r.addStep("A2 (nozzle excess)", "min of two UG-37.1 formulas", A2);

    const A3 = (ti > 0.0 && h > 0.0)
      ? Math.min(5.0 * t * ti * fr2, 5.0 * ti * ti * fr2, 2.0 * h * ti * fr2) : 0.0;
    r.addStep("A3 (inward projection)", "min(5*t*ti, 5*ti^2, 2*h*ti)*fr2", A3);

    const A41 = leg_nozzle * leg_nozzle * (hasPad ? fr3 : fr2);
    const A42 = hasPad ? leg_pad * leg_pad * fr4 : 0.0;
    const A43 = leg_inner * leg_inner * fr2;
    r.addStep("A41 (outer nozzle weld)", "leg^2 * fr", A41);
    r.addStep("A42 (pad OD weld)", "leg^2 * fr4", A42);
    r.addStep("A43 (inner weld)", "leg^2 * fr2", A43);

    const limitParallel = Math.max(d, d / 2.0 + tn + t);
    let A5 = 0.0;
    if (hasPad) {
      const DpEff = Math.min(Dp, 2.0 * limitParallel);
      A5 = Math.max((DpEff - d - 2.0 * tn) * te * fr4, 0.0);
      r.addStep("Dp_eff (limited)", "min(Dp, 2*limit)", DpEff);
    }
    r.addStep("A5 (pad)", "(Dp - d - 2*tn)*te*fr4", A5);

    const Aavail = A1 + A2 + A3 + A41 + A42 + A43 + A5;
    r.addStep("A_avail (total)", "A1+A2+A3+A4+A5", Aavail);
    r.addStep("Limit, parallel (from CL)", "max(d, Rn+tn+t)", limitParallel);
    r.addStep("Limit, normal", "min(2.5*t, 2.5*tn + te)", Math.min(2.5 * t, 2.5 * tn + te));

    r.addCheck("A_avail >= A (reinforcement adequate)", Aavail >= A);
    r.addCheck("tn >= trn (nozzle wall adequate for pressure)", tn >= trn);
    r.results.A_required = A;
    r.results.A_available = Aavail;
    r.results.margin_pct = A > 0 ? (Aavail / A - 1.0) * 100.0 : Infinity;
    // Handed to weldStrength() so the UG-41 check needs no re-entered inputs.
    Object.assign(r.data, { d, t, tr, tn, Sv, Sn, Sp, E1, F,
      set_in: !!set_in, has_pad: hasPad, te, Dp,
      leg_nozzle, leg_pad, leg_inner, fr1, fr2, fr3, fr4,
      A, A1, A2, A3, A41, A42, A43, A5 });
    return r;
  }

  /* ---------------- UG-41 attachment weld strength ---------------- */
  /* Port of pvcalc.nozzle.weld_strength — see that docstring for scope: the
   * per-path Fig. UG-41.1 comparison is NOT performed, only the necessary
   * condition sum(elements) >= max weld load. */
  function weldStrength(areaResult, { groove_nozzle = 0.0, groove_pad = 0.0,
    exempt_uw15b1 = false, external_pressure = false } = {}) {
    const r = mkResult("Nozzle attachment weld strength",
      "ASME BPVC VIII-1 UG-41, UW-15(c)");
    const g = areaResult && areaResult.data;
    if (!g || g.d === undefined)
      throw new Error("areaResult carries no geometry — pass the result of areaReinforcement()");

    const { d, t, tr, tn, Sv, Sn, Sp, has_pad: hasPad, Dp, fr1, E1, F } = g;
    const dOut = d + 2.0 * tn, dMean = d + tn, halfCirc = Math.PI / 2.0;
    const S_nv = Math.min(Sn, Sv), S_pv = Math.min(Sp, Sv), S_np = Math.min(Sn, Sp);

    [["d (opening, corroded)", d, ""], ["d_out (nozzle OD)", dOut, "d + 2*tn"],
     ["d_mean (nozzle mean dia)", dMean, "d + tn"],
     ["groove_nozzle", groove_nozzle, "nozzle-to-vessel groove depth"],
     ["groove_pad", groove_pad, "nozzle-to-pad groove depth"],
     ["leg_nozzle (41)", g.leg_nozzle, "outer nozzle fillet"],
     ["leg_pad (42)", g.leg_pad, "pad OD fillet"],
     ["leg_inner (43)", g.leg_inner, "inner fillet"]]
      .forEach(([n, v, note]) => r.addInput(n, v, "", note));

    if (external_pressure)
      r.addNote("External pressure - UG-41 weld strength calculations are not required.");
    if (exempt_uw15b1)
      r.addNote("Opening is exempt from weld strength calculations per UW-15(b)(1).");

    const S_fillet41 = hasPad ? S_np : S_nv;
    const eWall = halfCirc * dMean * tn * UW15C_NOZZLE_WALL_SHEAR * Sn;
    const eF41 = halfCirc * dOut * g.leg_nozzle * UW15C_FILLET_SHEAR * S_fillet41;
    const eF42 = hasPad ? halfCirc * Dp * g.leg_pad * UW15C_FILLET_SHEAR * S_pv : 0.0;
    const eF43 = halfCirc * dOut * g.leg_inner * UW15C_FILLET_SHEAR * S_nv;
    const eGNoz = halfCirc * dOut * groove_nozzle * UW15C_GROOVE_TENSION * S_nv;
    const eGPad = hasPad ? halfCirc * dOut * groove_pad * UW15C_GROOVE_TENSION * S_np : 0.0;

    r.addStep("Nozzle wall shear", "pi/2*d_mean*tn*0.70*Sn", eWall);
    r.addStep("Fillet 41 shear", "pi/2*d_out*leg41*0.49*S", eF41);
    r.addStep("Fillet 42 shear", "pi/2*Dp*leg42*0.49*S", eF42);
    r.addStep("Fillet 43 shear", "pi/2*d_out*leg43*0.49*S", eF43);
    r.addStep("Groove (nozzle) tension", "pi/2*d_out*gr_noz*0.74*S", eGNoz);
    r.addStep("Groove (pad) tension", "pi/2*d_out*gr_pad*0.74*S", eGPad);

    const total = eWall + eF41 + eF42 + eF43 + eGNoz + eGPad;
    r.addStep("Sum of all elements", "total attachment strength", total);

    const shellNoz = 2.0 * tn * t * fr1;
    const W = Math.max((g.A - g.A1 + 2.0 * tn * fr1 * (E1 * t - F * tr)) * Sv, 0.0);
    const W11 = (g.A2 + g.A5 + g.A41 + g.A42) * Sv;
    const W22 = (g.A2 + g.A3 + g.A41 + g.A43 + shellNoz) * Sv;
    const W33 = (g.A2 + g.A3 + g.A5 + g.A41 + g.A42 + g.A43 + shellNoz) * Sv;
    r.addStep("W (total weld load)", "(A-A1+2*tn*fr1*(E1*t-F*tr))*Sv, >=0", W);
    r.addStep("W1-1", "(A2+A5+A41+A42)*Sv", W11);
    r.addStep("W2-2", "(A2+A3+A41+A43+2*tn*t*fr1)*Sv", W22);
    r.addStep("W3-3", "(A2+A3+A5+A41+A42+A43+2*tn*t*fr1)*Sv", W33);

    const Wmax = Math.max(W, W11, W22, W33);
    r.addStep("W_max (governing load)", "max(W, W1-1, W2-2, W3-3)", Wmax);

    r.addNote("Necessary condition only - the Fig. UG-41.1 per-path check "
      + "(paths 1-1/2-2/3-3) is not performed.");
    if (!(external_pressure || exempt_uw15b1))
      r.addCheck("sum of weld element strengths >= W_max", total >= Wmax);

    r.results.W = W;
    r.results.W_max = Wmax;
    r.results.strength_total = total;
    r.results.margin_pct = Wmax > 0 ? (total / Wmax - 1.0) * 100.0 : Infinity;
    return r;
  }

  /* Port of pvcalc.nozzle.large_opening_check — UG-36(b)(1) gate + App. 1-7. */
  function largeOpeningCheck(areaResult, { D_inside, units = "SI" }) {
    const r = mkResult("Large opening check",
      "ASME BPVC VIII-1 UG-36(b)(1), Mandatory App. 1-7");
    const g = areaResult && areaResult.data;
    if (!g || g.d === undefined)
      throw new Error("areaResult carries no geometry - pass the result of areaReinforcement()");
    const si = String(units).toUpperCase() === "SI";
    const { d, t, tn, tr, E1, F, fr1 } = g;

    let dMax, rule;
    if (D_inside <= (si ? 1520.0 : 60.0)) {
      dMax = Math.min(D_inside / 2.0, si ? 510.0 : 20.0);
      rule = si ? "D <= 1520 mm: min(D/2, 510 mm)" : "D <= 60 in: min(D/2, 20 in)";
    } else {
      dMax = Math.min(D_inside / 3.0, si ? 1020.0 : 40.0);
      rule = si ? "D > 1520 mm: min(D/3, 1020 mm)" : "D > 60 in: min(D/3, 40 in)";
    }
    const ratio = d / D_inside;
    const isLarge = d > dMax;

    r.addInput("d (opening, corroded)", d);
    r.addInput("D (vessel ID, corroded)", D_inside);
    r.addInput("d/D", ratio, "", "> 0.7 is outside code scope");
    r.addStep("d_max per UG-36(b)(1)", rule, dMax);
    r.addStep("App. 1-7 required?", "d > d_max", isLarge ? 1.0 : 0.0);
    r.addCheck("d/D <= 0.7 (within UG-37 / App. 1-7 scope)", ratio <= 0.7);

    const limitPar = Math.max(d, d / 2.0 + tn + t);
    const limitRed = 0.75 * limitPar;
    r.addStep("UG-40 parallel limit (from CL)", "max(d, d/2 + tn + t)", limitPar);
    r.addStep("App. 1-7 reduced limit", "0.75 * parallel limit", limitRed);

    const excess = E1 * t - F * tr;
    const widthRed = Math.max(2.0 * limitRed - d, 0.0);
    const A1red = Math.max(widthRed * excess
      - 2.0 * tn * excess * (1.0 - fr1), 0.0);
    r.addStep("shell width within reduced limit", "2*0.75*limit - d", widthRed);
    r.addStep("A1 within reduced limit",
      "width*(E1*t - F*tr) - 2*tn*(..)", A1red);

    let A5red = 0.0;
    if (g.has_pad) {
      const DpRed = Math.min(g.Dp, 2.0 * limitRed);
      A5red = Math.max((DpRed - d - 2.0 * tn) * g.te * g.fr4, 0.0);
      r.addStep("A5 within reduced limit",
        "(min(Dp, 2*0.75*limit) - d - 2*tn)*te*fr4", A5red);
    }

    const Awithin = A1red + g.A2 + g.A3 + g.A41 + g.A42 + g.A43 + A5red;
    const Aneeded = (2.0 / 3.0) * g.A;
    r.addStep("A available within reduced limit",
      "A1_red + A2 + A3 + A4 + A5_red", Awithin);
    r.addStep("2/3 * A required", "App. 1-7", Aneeded);

    if (isLarge) {
      r.addCheck("2/3 of A available within 0.75 of the parallel limit",
        Awithin >= Aneeded);
      r.addNote("Opening exceeds UG-36(b)(1) — App. 1-7 applies IN ADDITION "
        + "to UG-37. The areaReinforcement() result must pass as well; this "
        + "check does not replace it.");
    } else {
      r.addNote("Opening is within UG-36(b)(1), so App. 1-7 does not apply. "
        + "The reduced-limit figures above are informational.");
    }

    Object.assign(r.results, { d_max_UG36: dMax, d_over_D: ratio,
      limit_parallel: limitPar, limit_reduced: limitRed,
      A_within_reduced: Awithin, A_two_thirds: Aneeded,
      app_1_7_required: isLarge ? 1.0 : 0.0 });
    return r;
  }

  function ug45NeckThickness({ P, Rn, Sn, CA = 0.0, units = "SI",
    nps = null, t_nominal = null, is_pipe = true, tr_shell_e1 = 0.0, P_ext = null }) {
    const r = mkResult("Nozzle neck minimum thickness", "ASME BPVC VIII-1 UG-45");
    const mm = String(units).toUpperCase() === "SI";
    const ug16Min = mm ? 1.5 : 0.0625;

    r.addInput("P", P); r.addInput("Rn (corroded)", Rn);
    r.addInput("Sn", Sn); r.addInput("CA", CA);

    let trn = P * Rn / (Sn - 0.6 * P);
    if (P_ext !== null && P_ext !== undefined)
      trn = Math.max(trn, P_ext * Rn / (Sn - 0.6 * P_ext));
    const ta = Math.max(trn, ug16Min) + CA;
    r.addStep("t_a", "max(trn(E=1), UG-16 min) + CA", ta);

    const tb1 = Math.max(tr_shell_e1, ug16Min) + CA;
    r.addStep("t_b1", "max(tr_shell(E=1), UG-16 min) + CA", tb1);

    let tb;
    const npsKey = nps !== null && nps !== undefined ? String(+nps) : null;
    if (npsKey && B3610_STD_WALL_IN[npsKey] !== undefined) {
      const stdWall = B3610_STD_WALL_IN[npsKey] * (mm ? IN_TO_MM : 1.0);
      const tb3 = stdWall * 0.875 + CA;
      r.addStep("t_b3", "0.875 * STD wall + CA", tb3);
      tb = Math.min(tb3, tb1);
    } else {
      tb = tb1;
      r.addStep("t_b3", "n/a (NPS not given)", 0.0);
    }

    const tUg45 = Math.max(ta, tb);
    r.addStep("t_UG-45", "max(t_a, min(t_b3, t_b1))", tUg45);
    r.results.t_UG45 = tUg45;

    if (t_nominal !== null && t_nominal !== undefined) {
      const tAvail = t_nominal * (is_pipe ? 0.875 : 1.0);
      r.addStep("t_avail", is_pipe ? "t_nom * 0.875 (pipe tol.)" : "t_nom", tAvail);
      r.addCheck("t_avail >= t_UG-45", tAvail >= tUg45);
      r.results.t_available = tAvail;
    }
    return r;
  }

  /* ---------------- App. 2 bolted flanges ---------------- */
  /* Port of pvcalc/flange.py. Ring-type gasket inside the bolt circle,
   * internal pressure, integral or loose-without-hub only. */

  const B_COEF_US = 0.5, B_COEF_SI = 2.52;
  const BO_LIMIT_US = 0.25, BO_LIMIT_SI = 6.35;
  const INTEGRAL = "integral", RING = "ring";
  const FLANGE_TYPES = [INTEGRAL, RING];

  function figure271(K) {
    if (K <= 1.0) throw new Error("K = A/B must exceed 1.0");
    const logK = Math.log10(K), k2 = K * K;
    const common = k2 * (1.0 + 8.55246 * logK) - 1.0;
    return {
      T: common / ((1.04720 + 1.9448 * k2) * (K - 1.0)),
      U: common / (1.36136 * (k2 - 1.0) * (K - 1.0)),
      Y: (1.0 / (K - 1.0)) * (0.66845 + 5.71690 * (k2 * logK) / (k2 - 1.0)),
      Z: (k2 + 1.0) / (k2 - 1.0),
    };
  }

  function table271(g0, g1, h, h0) {
    if (Math.min(g0, g1, h, h0) <= 0.0)
      throw new Error("g0, g1, h and h0 must all be positive");
    const A = g1 / g0 - 1.0;
    const C = 43.68 * Math.pow(h / h0, 4.0);
    const A2 = A * A, A3 = A * A * A;

    const C1 = 1.0 / 3.0 + A / 12.0;
    const C2 = 5.0 / 42.0 + 17.0 * A / 336.0;
    const C3 = 1.0 / 210.0 + A / 360.0;
    const C4 = 11.0 / 360.0 + 59.0 * A / 5040.0 + (1.0 + 3.0 * A) / C;
    const C5 = 1.0 / 90.0 + 5.0 * A / 1008.0 - Math.pow(1.0 + A, 3) / C;
    const C6 = 1.0 / 120.0 + 17.0 * A / 5040.0 + 1.0 / C;
    const C7 = 215.0 / 2772.0 + 51.0 * A / 1232.0
      + (60.0 / 7.0 + 225.0 * A / 14.0 + 75.0 * A2 / 7.0 + 5.0 * A3 / 2.0) / C;
    const C8 = 31.0 / 6930.0 + 128.0 * A / 45045.0
      + (6.0 / 7.0 + 15.0 * A / 7.0 + 12.0 * A2 / 7.0 + 5.0 * A3 / 11.0) / C;
    const C9 = 533.0 / 30240.0 + 653.0 * A / 73920.0
      + (0.5 + 33.0 * A / 14.0 + 39.0 * A2 / 28.0 + 25.0 * A3 / 84.0) / C;
    const C10 = 29.0 / 3780.0 + 3.0 * A / 704.0
      - (0.5 + 33.0 * A / 14.0 + 81.0 * A2 / 28.0 + 13.0 * A3 / 12.0) / C;
    const C11 = 31.0 / 6048.0 + 1763.0 * A / 665280.0
      + (0.5 + 6.0 * A / 7.0 + 15.0 * A2 / 28.0 + 5.0 * A3 / 42.0) / C;
    const C12 = 1.0 / 2925.0 + 71.0 * A / 300300.0
      + (8.0 / 35.0 + 18.0 * A / 35.0 + 156.0 * A2 / 385.0 + 6.0 * A3 / 55.0) / C;
    const C13 = 761.0 / 831600.0 + 937.0 * A / 1663200.0
      + (1.0 / 35.0 + 6.0 * A / 35.0 + 11.0 * A2 / 70.0 + 3.0 * A3 / 70.0) / C;
    const C14 = 197.0 / 415800.0 + 103.0 * A / 332640.0
      - (1.0 / 35.0 + 6.0 * A / 35.0 + 17.0 * A2 / 70.0 + A3 / 10.0) / C;
    const C15 = 233.0 / 831600.0 + 97.0 * A / 554400.0
      + (1.0 / 35.0 + 3.0 * A / 35.0 + A2 / 14.0 + 2.0 * A3 / 105.0) / C;

    const C16 = C1 * C7 * C12 + C2 * C8 * C3 + C3 * C8 * C2
      - (C3 * C3 * C7 + C8 * C8 * C1 + C2 * C2 * C12);
    const C17 = (C4 * C7 * C12 + C2 * C8 * C13 + C3 * C8 * C9
      - (C13 * C7 * C3 + C8 * C8 * C4 + C12 * C2 * C9)) / C16;
    const C18 = (C5 * C7 * C12 + C2 * C8 * C14 + C3 * C8 * C10
      - (C14 * C7 * C3 + C8 * C8 * C5 + C12 * C2 * C10)) / C16;
    const C19 = (C6 * C7 * C12 + C2 * C8 * C15 + C3 * C8 * C11
      - (C15 * C7 * C3 + C8 * C8 * C6 + C12 * C2 * C11)) / C16;
    const C20 = (C1 * C9 * C12 + C4 * C8 * C3 + C3 * C13 * C2
      - (C13 * C8 * C1 + C3 * C3 * C9 + C12 * C4 * C2)) / C16;
    const C21 = (C1 * C10 * C12 + C5 * C8 * C3 + C3 * C14 * C2
      - (C14 * C8 * C1 + C3 * C3 * C10 + C12 * C5 * C2)) / C16;
    const C22 = (C1 * C11 * C12 + C6 * C8 * C3 + C3 * C15 * C2
      - (C15 * C8 * C1 + C3 * C3 * C11 + C12 * C6 * C2)) / C16;
    const C23 = (C1 * C7 * C13 + C2 * C9 * C3 + C4 * C8 * C2
      - (C3 * C7 * C4 + C2 * C2 * C13 + C8 * C9 * C1)) / C16;
    const C24 = (C1 * C7 * C14 + C2 * C10 * C3 + C5 * C8 * C2
      - (C3 * C7 * C5 + C2 * C2 * C14 + C8 * C10 * C1)) / C16;
    const C25 = (C1 * C7 * C15 + C2 * C11 * C3 + C6 * C8 * C2
      - (C3 * C7 * C6 + C2 * C2 * C15 + C8 * C11 * C1)) / C16;

    const C26 = -Math.pow(C / 4.0, 0.25);
    const C27 = C20 - C17 - 5.0 / 12.0 + C17 * C26;
    const C28 = C22 - C19 - 1.0 / 12.0 + C19 * C26;
    const C29 = -Math.sqrt(C / 4.0);
    const C30 = -Math.pow(C / 4.0, 0.75);
    const C31 = 3.0 * A / 2.0 - C17 * C30;
    const C32 = 0.5 - C19 * C30;
    const C33 = 0.5 * C26 * C32 + C28 * C31 * C29
      - (0.5 * C30 * C28 + C32 * C27 * C29);
    const C34 = 1.0 / 12.0 + C18 - C21 - C18 * C26;
    const C35 = -C18 * Math.pow(C / 4.0, 0.75);
    const C36 = (C28 * C35 * C29 - C32 * C34 * C29) / C33;
    const C37 = (0.5 * C26 * C35 + C34 * C31 * C29
      - (0.5 * C30 * C34 + C35 * C27 * C29)) / C33;

    const E1 = C17 * C36 + C18 + C19 * C37;
    const E2 = C20 * C36 + C21 + C22 * C37;
    const E3 = C23 * C36 + C24 + C25 * C37;
    const E4 = 0.25 + C37 / 12.0 + C36 / 4.0 - E3 / 5.0 - 3.0 * E2 / 2.0 - E1;
    const E5 = E1 * (0.5 + A / 6.0) + E2 * (0.25 + 11.0 * A / 84.0)
      + E3 * (1.0 / 70.0 + A / 105.0);
    const E6 = E5 - C36 * (7.0 / 120.0 + A / 36.0 + 3.0 * A / C)
      - 1.0 / 40.0 - A / 72.0 - C37 * (1.0 / 60.0 + A / 120.0 + 1.0 / C);

    const denF = Math.pow(C / 2.73, 0.25) * (Math.pow(1.0 + A, 3) / C);
    const denV = Math.pow(2.73 / C, 0.25) * Math.pow(1.0 + A, 3);
    return { A, C, F: -E6 / denF, V: E4 / denV,
             f: Math.max(1.0, C36 / (1.0 + A)) };
  }

  function flangeBoltLoads({ P, gasket_od, gasket_id, m, y, Sb, Sa, Ab,
    units = "SI" }) {
    const r = mkResult("Flange bolt loads and gasket seating",
      "ASME BPVC VIII-1 App. 2-5");
    if (gasket_od <= gasket_id)
      throw new Error("gasket_od must exceed gasket_id");
    const si = String(units).toUpperCase() === "SI";
    const bCoef = si ? B_COEF_SI : B_COEF_US;
    const boLimit = si ? BO_LIMIT_SI : BO_LIMIT_US;

    const N = (gasket_od - gasket_id) / 2.0;
    const bo = N / 2.0;
    [["P", P, ""], ["gasket OD", gasket_od, ""], ["gasket ID", gasket_id, ""],
     ["N (contact width)", N, "(OD - ID)/2"], ["b_o (basic width)", bo, "N/2"],
     ["m (gasket factor)", m, "Table 2-5.1"],
     ["y (seating stress)", y, "Table 2-5.1"],
     ["Sb", Sb, "bolt, design temp"], ["Sa", Sa, "bolt, ambient"],
     ["Ab (actual bolt area)", Ab, ""]]
      .forEach(([n, v, note]) => r.addInput(n, v, "", note));

    let b, G;
    if (bo <= boLimit) {
      b = bo; G = (gasket_od + gasket_id) / 2.0;
      r.addStep("b (effective width)", "b_o (b_o <= limit)", b);
      r.addStep("G (reaction dia.)", "mean of gasket contact face", G);
    } else {
      b = bCoef * Math.sqrt(bo); G = gasket_od - 2.0 * b;
      r.addStep("b (effective width)", bCoef + "*sqrt(b_o)", b);
      r.addStep("G (reaction dia.)", "gasket OD - 2*b", G);
    }

    const H = 0.785 * G * G * P;
    const Hp = 2.0 * b * Math.PI * G * m * P;
    const Wm1 = H + Hp;
    const Wm2 = Math.PI * b * G * y;
    r.addStep("H (hydrostatic end load)", "0.785*G^2*P", H);
    r.addStep("Hp (gasket compression)", "2*b*pi*G*m*P", Hp);
    r.addStep("Wm1 (operating bolt load)", "H + Hp", Wm1);
    r.addStep("Wm2 (seating bolt load)", "pi*b*G*y", Wm2);

    const Am1 = Wm1 / Sb, Am2 = Wm2 / Sa, Am = Math.max(Am1, Am2);
    r.addStep("Am1", "Wm1/Sb", Am1);
    r.addStep("Am2", "Wm2/Sa", Am2);
    r.addStep("Am (required bolt area)", "max(Am1, Am2)", Am);

    const Wseating = 0.5 * (Am + Ab) * Sa;
    r.addStep("W (seating design load)", "0.5*(Am + Ab)*Sa", Wseating);

    r.addCheck("Ab >= Am (bolting adequate)", Ab >= Am);
    r.results.Am = Am;
    r.results.Wm1 = Wm1;
    r.results.Wm2 = Wm2;
    r.results.W_seating = Wseating;
    r.results.G = G;
    r.results.b = b;
    Object.assign(r.data, { P, G, b, H, Wm1, Wm2, Am, Ab,
      W_seating: Wseating, governing: Am2 > Am1 ? "seating" : "operating" });
    return r;
  }

  function flangeStresses(boltResult, { flange_od, B, bolt_circle, t, Sf, Sfa,
    flange_type = INTEGRAL, g0 = null, g1 = null, h = null,
    Sn = null, Sna = null }) {
    if (FLANGE_TYPES.indexOf(flange_type) < 0)
      throw new Error("flange_type must be one of " + FLANGE_TYPES.join(", "));
    const r = mkResult(`Flange stresses (${flange_type})`,
      "ASME BPVC VIII-1 App. 2-6, 2-7");
    const g = boltResult && boltResult.data;
    if (!g || g.P === undefined)
      throw new Error("boltResult carries no geometry — pass the result of flangeBoltLoads()");
    const { P, G, Wm1, H } = g, W = g.W_seating;
    if (Sn === null || Sn === undefined) Sn = Sf;
    if (Sna === null || Sna === undefined) Sna = Sfa;

    const isRing = flange_type === RING;
    if (!isRing && (g0 === null || g1 === null || h === null))
      throw new Error("g0, g1 and h are required unless flange_type='ring'");

    const K = flange_od / B;
    const { T, U, Y, Z } = figure271(K);
    [["A (flange OD)", flange_od, ""], ["B (flange ID)", B, ""],
     ["C (bolt circle)", bolt_circle, ""], ["t (flange thickness)", t, ""],
     ["K = A/B", K, ""], ["T", T, "Fig. 2-7.1"], ["U", U, "Fig. 2-7.1"],
     ["Y", Y, "Fig. 2-7.1"], ["Z", Z, "Fig. 2-7.1"],
     ["Sf / Sfa", Sf, `ambient ${Sfa}`]]
      .forEach(([n, v, note]) => r.addInput(n, v, "", note));

    const HD = 0.785 * B * B * P;
    const HT = H - HD;
    const HG = Wm1 - H;
    const hG = 0.5 * (bolt_circle - G);
    let hD, hT;
    if (flange_type === INTEGRAL) {
      const R = 0.5 * (bolt_circle - B) - g1;
      hD = R + 0.5 * g1;
      hT = 0.5 * (R + g1 + hG);
      r.addStep("R", "0.5*(C - B) - g1", R);
    } else {
      hD = 0.5 * (bolt_circle - B);
      hT = 0.5 * (hD + hG);
    }
    r.addStep("HD (pressure on flange ID)", "0.785*B^2*P", HD);
    r.addStep("HT (pressure, flange face)", "H - HD", HT);
    r.addStep("HG (gasket load)", "Wm1 - H", HG);
    r.addStep("hD", "Table 2-6", hD);
    r.addStep("hT", "Table 2-6", hT);
    r.addStep("hG", "0.5*(C - G)", hG);

    const Mo = HD * hD + HT * hT + HG * hG;
    const Mg = W * hG;
    r.addStep("Mo (operating moment)", "HD*hD + HT*hT + HG*hG", Mo);
    r.addStep("Mg (seating moment)", "W*hG", Mg);

    let stresses;
    if (isRing) {
      r.addStep("hub factors", "n/a (loose flange, no hub)", 0.0);
      stresses = M => [0.0, 0.0, Y * M / (t * t * B)];
    } else {
      const h0 = Math.sqrt(B * g0);
      const tab = table271(g0, g1, h, h0);
      const Fuse = tab.F, Vuse = tab.V, fHub = tab.f;
      const e = Fuse / h0;
      const d = (U / Vuse) * h0 * g0 * g0;
      const L = (t * e + 1.0) / T + Math.pow(t, 3) / d;
      [["g0", g0, "-"], ["g1", g1, "-"], ["h", h, "-"],
       ["h0 = sqrt(B*g0)", h0, "-"], ["F", Fuse, "Table 2-7.1"],
       ["V", Vuse, "Table 2-7.1"], ["f (hub stress factor)", fHub, "-"],
       ["e = F/h0", e, "-"], ["d = (U/V)*h0*g0^2", d, "-"],
       ["L", L, "(t*e+1)/T + t^3/d"]]
        .forEach(([n, v, note]) => r.addStep(n, note, v));
      stresses = M => {
        const SH = fHub * M / (L * g1 * g1 * B);
        const SR = (1.33 * t * e + 1.0) * M / (L * t * t * B);
        return [SH, SR, Y * M / (t * t * B) - Z * SR];
      };
    }

    const [SHo, SRo, STo] = stresses(Mo);
    const [SHg, SRg, STg] = stresses(Mg);
    [["operating", SHo, SRo, STo], ["seating", SHg, SRg, STg]]
      .forEach(([tag, SH, SR, ST]) => {
        r.addStep(`SH (${tag})`, "longitudinal hub stress", SH);
        r.addStep(`SR (${tag})`, "radial flange stress", SR);
        r.addStep(`ST (${tag})`, "tangential flange stress", ST);
      });

    [["operating", SHo, SRo, STo, Sf, Sn], ["seating", SHg, SRg, STg, Sfa, Sna]]
      .forEach(([tag, SH, SR, ST, SfT, SnT]) => {
        const limitSH = 1.5 * Math.min(SfT, SnT);
        if (!isRing) {
          r.addCheck(`SH <= 1.5*S (${tag})`, SH <= limitSH);
          r.addCheck(`SR <= S (${tag})`, SR <= SfT);
        }
        r.addCheck(`ST <= S (${tag})`, ST <= SfT);
        if (!isRing) {
          r.addCheck(`(SH+SR)/2 <= S (${tag})`, 0.5 * (SH + SR) <= SfT);
          r.addCheck(`(SH+ST)/2 <= S (${tag})`, 0.5 * (SH + ST) <= SfT);
        }
      });

    r.addNote("Ring-type gasket inside the bolt circle, internal pressure "
      + "only. Rigidity index (App. 2-14), bolt spacing and external piping "
      + "loads are not checked.");
    r.results.Mo = Mo;
    r.results.Mg = Mg;
    r.results.SH_operating = SHo;
    r.results.SR_operating = SRo;
    r.results.ST_operating = STo;
    r.results.SH_seating = SHg;
    r.results.SR_seating = SRg;
    r.results.ST_seating = STg;
    return r;
  }

  /* ---------------- VIII-2 4.15 saddle supports (Zick) ---------------- */
  /* Port of pvcalc/saddle.py. K coefficients anchored to published
   * Table 4.15.1 values at theta = 150 deg within 0.02%. */

  const HEAD_TYPES = ["torispherical", "ellipsoidal", "hemispherical", "flat"];
  const STIFFENING = ["none", "head", "ring_in_plane"];

  function zickCoefficients(theta_deg, a_over_Rm = 1.0) {
    const theta = (theta_deg * Math.PI) / 180.0;
    const alpha = 0.95 * (Math.PI - 0.5 * theta);
    const beta = Math.PI - 0.5 * theta;
    const delta = Math.PI / 6.0 + (5.0 * theta) / 12.0;
    const sd = Math.sin(delta), cd = Math.cos(delta);
    const sa = Math.sin(alpha), ca = Math.cos(alpha);
    const sb = Math.sin(beta), cb = Math.cos(beta);

    const num1 = delta + sd * cd - (2.0 * sd * sd) / delta;
    const K1 = num1 / (Math.PI * (sd / delta - cd));
    const K1p = num1 / (Math.PI * (1.0 - sd / delta));

    const denA = Math.PI - alpha + sa * ca;
    const K2 = sa / denA;
    const K3 = (sa / Math.PI) * ((alpha - sa * ca) / denA);
    const K4 = (0.375 * sa * sa) / denA;
    const K5 = (1.0 + ca) / denA;

    const sbb = sb / beta;
    const t7 = sbb * sbb - 0.5 - (0.25 * Math.sin(2.0 * beta)) / beta;
    const num6 = 0.75 * cb * sbb * sbb - 1.25 * sb * cb * (cb / beta)
      + 0.5 * Math.pow(cb, 3) - 0.25 * sbb + 0.25 * cb - beta * sb * t7;
    const K6 = num6 / (2.0 * Math.PI * t7);

    let K7;
    if (a_over_Rm <= 0.5) K7 = 0.25 * K6;
    else if (a_over_Rm >= 1.0) K7 = K6;
    else K7 = 1.5 * K6 * a_over_Rm - 0.5 * K6;

    const num8 = cb * (1.0 - 0.25 * Math.cos(2.0 * beta)
      + (2.25 * sb * cb) / beta - 3.0 * sbb * sbb);
    const K8 = num8 / (2.0 * Math.PI * t7) + (beta * sb) / (2.0 * Math.PI);

    return { alpha, beta, delta, K1, K1p, K2, K3, K4, K5, K6, K7, K8 };
  }

  function saddleAnalysis({ P, Rm, ts, L, a, b, theta_deg, H, Q, Ey, S,
    th = null, Sh = null, Ri = null, head_type = "ellipsoidal",
    stiffening = "none", saddle_welded = true, exceptional = false,
    E_joint = 1.0, tr = 0.0, b1 = null, theta1_deg = null, Sr = null }) {
    if (HEAD_TYPES.indexOf(head_type) < 0)
      throw new Error("head_type must be one of " + HEAD_TYPES.join(", "));
    if (STIFFENING.indexOf(stiffening) < 0)
      throw new Error("stiffening must be one of " + STIFFENING.join(", "));
    const r = mkResult("Horizontal vessel on two saddles (Zick)",
      "ASME BPVC VIII-2 4.15");
    if (Sh === null || Sh === undefined) Sh = S;
    if (th === null || th === undefined) th = ts;
    if (Ri === null || Ri === undefined) Ri = Rm - 0.5 * ts;

    const hasPlate = tr > 0.0;
    const k = saddle_welded ? 0.1 : 1.0;
    const aOverRm = a / Rm;
    const Kc = zickCoefficients(theta_deg, aOverRm);
    const { K1, K1p, K2, K3, K4, K5, K7 } = Kc;

    [["P", P, ""], ["Rm (mean radius)", Rm, ""], ["ts", ts, ""],
     ["L (tangent-tangent)", L, ""], ["a (saddle to tangent)", a, ""],
     ["b (saddle width)", b, ""], ["theta (deg)", theta_deg, ""],
     ["H (head depth)", H, ""], ["Q (one saddle)", Q, ""],
     ["a/Rm", aOverRm, "head stiffens if <= 0.5"],
     ["k", k, "0.1 welded, 1.0 not welded"],
     ["K1", K1, "pi carried in the stress formula"], ["K1'", K1p, ""],
     ["K2", K2, ""], ["K3", K3, ""], ["K4", K4, ""], ["K5", K5, ""],
     ["K7", K7, ""]].forEach(([n, v, note]) => r.addInput(n, v, "", note));

    r.addCheck("theta >= 120 deg (VIII-2 4.15)", theta_deg >= 120.0);
    r.addCheck("a <= 0.5*L (saddle inside the span)", a <= 0.5 * L);
    if (stiffening === "head")
      r.addCheck("head stiffens the saddle: a <= Rm/2", a <= 0.5 * Rm);

    const M1 = -Q * a * (1.0 - (1.0 - a / L + (Rm * Rm - H * H) / (2.0 * a * L))
      / (1.0 + (4.0 * H) / (3.0 * L)));
    const M2 = 0.25 * Q * L * ((1.0 + (2.0 * (Rm * Rm - H * H)) / (L * L))
      / (1.0 + (4.0 * H) / (3.0 * L)) - (4.0 * a) / L);
    const T = (Q * (L - 2.0 * a)) / (L + (4.0 * H) / 3.0);
    r.addStep("M1 (at saddle)", "eq. 4.15.3, hogging (negative)", M1);
    r.addStep("M2 (at mid-span)", "eq. 4.15.4, sagging", M2);
    r.addStep("T (shear at saddle)", "Q*(L-2a)/(L+4H/3)", T);

    const press = (P * Rm) / (2.0 * ts);
    const sec = Math.PI * Rm * Rm * ts;
    const sigma1 = press - M2 / sec;
    const sigma2 = press + M2 / sec;
    r.addStep("sigma1 (mid-span, top)", "P*Rm/2ts - M2/(pi*Rm^2*ts)", sigma1);
    r.addStep("sigma2 (mid-span, bottom)", "P*Rm/2ts + M2/(pi*Rm^2*ts)", sigma2);

    const stiffened = stiffening === "head" || stiffening === "ring_in_plane";
    let sigma3, sigma4, f3, f4;
    if (stiffened) {
      sigma3 = press - M1 / sec; sigma4 = press + M1 / sec;
      f3 = "P*Rm/2ts - M1/(pi*Rm^2*ts)  [stiffened]";
      f4 = "P*Rm/2ts + M1/(pi*Rm^2*ts)  [stiffened]";
    } else {
      sigma3 = press - M1 / (K1 * sec); sigma4 = press + M1 / (K1p * sec);
      f3 = "P*Rm/2ts - M1/(K1*pi*Rm^2*ts)";
      f4 = "P*Rm/2ts + M1/(K1'*pi*Rm^2*ts)";
    }
    r.addStep("sigma3 (saddle, top)", f3, sigma3);
    r.addStep("sigma4 (saddle, bottom)", f4, sigma4);

    const Sc = ((exceptional ? 1.35 : 1.0) * ts * Ey) / (16.0 * Rm);
    r.addStep("Sc (allowable compressive)", "K*ts*Ey/(16*Rm)", Sc);

    let tau, tauF;
    if (stiffening === "ring_in_plane") {
      tau = T / (Math.PI * Rm * ts);
      tauF = "T/(pi*Rm*ts)  [ring in saddle plane]";
    } else if (stiffening === "head") {
      tau = (K3 * Q) / (Rm * ts);
      tauF = "K3*Q/(Rm*ts)  [stiffened by head]";
    } else {
      tau = (K2 * T) / (Rm * ts);
      tauF = "K2*T/(Rm*ts)  [unstiffened]";
    }
    r.addStep("tau (tangential shear)", tauF, tau);

    const tauHead = stiffening === "head" ? (K3 * Q) / (Rm * th) : 0.0;
    if (stiffening === "head")
      r.addStep("tau* (in the head)", "K3*Q/(Rm*th)", tauHead);

    let sigma5 = 0.0;
    if (stiffening === "head" && head_type !== "flat") {
      let f5;
      if (head_type === "torispherical") {
        sigma5 = (K4 * Q) / (Rm * th) + (P * Ri) / (2.0 * th);
        f5 = "K4*Q/(Rm*th) + P*Ri/(2*th)";
      } else {
        sigma5 = (K4 * Q) / (Rm * th) + (P * Ri * Ri) / (2.0 * th * H);
        f5 = "K4*Q/(Rm*th) + P*Ri^2/(2*th*H)";
      }
      r.addStep("sigma5 (head membrane)", f5, sigma5);
    }

    const x = Math.min(0.78 * Math.sqrt(Rm * ts), a);
    r.addStep("x1 = x2 (contributing width)", "min(0.78*sqrt(Rm*ts), a)", x);

    let sigma6, sigma7, f6, f7;
    if (hasPlate) {
      const bb = (b1 === null || b1 === undefined)
        ? Math.min(b + 1.56 * Math.sqrt(Rm * ts), 2.0 * a) : b1;
      const eta = Sr ? Math.min(Sr / S, 1.0) : 1.0;
      const tEff = ts + eta * tr;
      r.addInput("tr (wear plate)", tr);
      r.addStep("b1 (wear plate width)", "min(b + 1.56*sqrt(Rm*ts), 2a)", bb);
      r.addStep("eta", "min(Sr/S, 1)", eta);
      r.addStep("t_eff", "ts + eta*tr", tEff);
      if (theta1_deg !== null && theta1_deg !== undefined)
        r.addCheck("theta1 >= theta + theta/12 (eq. 4.15.2)",
          theta1_deg >= theta_deg + theta_deg / 12.0 - 1e-9);
      sigma6 = (-K5 * Q * k) / (bb * tEff);
      f6 = "-K5*Q*k/(b1*t_eff)";
      if (L >= 8.0 * Rm) {
        sigma7 = -Q / (4.0 * tEff * bb) - (3.0 * K7 * Q) / (2.0 * tEff * tEff);
        f7 = "-Q/(4*t_eff*b1) - 3*K7*Q/(2*t_eff^2)   [L >= 8Rm]";
      } else {
        sigma7 = -Q / (4.0 * tEff * bb) - (12.0 * K7 * Q * Rm) / (L * tEff * tEff);
        f7 = "-Q/(4*t_eff*b1) - 12*K7*Q*Rm/(L*t_eff^2)   [L < 8Rm]";
      }
    } else {
      const width = b + 2.0 * x;
      sigma6 = (-K5 * Q * k) / (ts * width);
      f6 = "-K5*Q*k/(ts*(b + x1 + x2))";
      if (L >= 8.0 * Rm) {
        sigma7 = -Q / (4.0 * ts * width) - (3.0 * K7 * Q) / (2.0 * ts * ts);
        f7 = "-Q/(4*ts*(b+x1+x2)) - 3*K7*Q/(2*ts^2)   [L >= 8Rm]";
      } else {
        sigma7 = -Q / (4.0 * ts * width) - (12.0 * K7 * Q * Rm) / (L * ts * ts);
        f7 = "-Q/(4*ts*(b+x1+x2)) - 12*K7*Q*Rm/(L*ts^2)   [L < 8Rm]";
      }
    }
    r.addStep("sigma6 (circ. membrane, base)", f6, sigma6);
    r.addStep("sigma7 (circ. horn, memb.+bend.)", f7, sigma7);

    const Sten = S * E_joint, Scomp = Math.min(S, Sc);
    [["sigma1", sigma1], ["sigma2", sigma2], ["sigma3", sigma3],
     ["sigma4", sigma4]].forEach(([tag, sig]) => {
      if (sig >= 0.0) r.addCheck(`${tag} <= S*E (tension)`, sig <= Sten);
      else r.addCheck(`|${tag}| <= min(S, Sc) (compression)`, -sig <= Scomp);
    });
    r.addCheck("tau <= 0.8*S", Math.abs(tau) <= 0.8 * S);
    if (stiffening === "head") {
      r.addCheck("tau* <= 0.8*Sh (head)", Math.abs(tauHead) <= 0.8 * Sh);
      if (head_type !== "flat")
        r.addCheck("sigma5 <= 1.25*Sh (head membrane)", sigma5 <= 1.25 * Sh);
    }
    r.addCheck("|sigma6| <= S (circ. membrane)", Math.abs(sigma6) <= S);
    r.addCheck("|sigma7| <= 1.25*S (circ. memb.+bending)",
      Math.abs(sigma7) <= 1.25 * S);

    r.addNote("Saddle steel (web, base plate, anchor bolts), the saddle "
      + "splitting force and stiffening rings NOT in the saddle plane are not "
      + "covered. Q is user input - self weight, contents and any load "
      + "combination factor must already be in it.");
    Object.assign(r.results, { M1, M2, T, Sc, sigma1, sigma2, sigma3, sigma4,
      sigma5, sigma6, sigma7, tau, tau_head: tauHead });
    return r;
  }

  /* ---------------- wind / seismic loads, UG-22 combined ---------------- */
  /* Port of pvcalc/loads.py. q(z) and Cs are USER INPUT from the governing
   * building code (ASCE 7, KDS 41, EN 1991) — nothing is bundled. */

  function segmentGeometry(segments, required, elevation) {
    if (!segments || !segments.length)
      throw new Error("at least one segment is required");
    const out = segments.map((seg, i) => {
      ["z_bottom", "z_top"].concat(required).forEach(key => {
        if (seg[key] === undefined || seg[key] === null)
          throw new Error(`segment ${i} is missing ${key}`);
      });
      if (seg.z_top <= seg.z_bottom)
        throw new Error(`segment ${i}: z_top must exceed z_bottom`);
      return Object.assign({}, seg);
    });
    out.sort((p, q) => p.z_bottom - q.z_bottom);
    if (elevation > out[out.length - 1].z_top)
      throw new Error("elevation is above the top of the vessel");
    return out;
  }

  function windLoad({ segments, elevation = 0.0 }) {
    const segs = segmentGeometry(segments, ["width", "q"], elevation);
    const r = mkResult("Wind shear and moment on a vertical vessel",
      "statics; q from the governing building code (user input)");
    r.addInput("elevation of interest", elevation);

    let V = 0.0, M = 0.0;
    segs.forEach((seg, i) => {
      const z0 = Math.max(seg.z_bottom, elevation), z1 = seg.z_top;
      if (z1 <= z0) return;
      const Cf = seg.Cf === undefined || seg.Cf === null ? 1.0 : seg.Cf;
      const h = z1 - z0;
      const F = seg.q * Cf * seg.width * h;
      const arm = 0.5 * (z0 + z1) - elevation;
      V += F; M += F * arm;
      r.addStep(`segment ${i} (${z0}-${z1})`,
        `F = q*Cf*w*h = ${seg.q}*${Cf}*${seg.width}*${h}`, F);
      r.addStep(`  arm ${i}`, "centroid above elevation", arm);
    });
    r.addStep("V (total shear)", "sum of segment forces", V);
    r.addStep("M (overturning moment)", "sum of F*arm", M);
    r.addNote("q and Cf are user input from the governing wind code (ASCE 7, "
      + "KDS 41, EN 1991...). Attachments such as platforms, ladders, piping "
      + "and insulation must be in the widths.");
    r.results.V = V; r.results.M = M;
    return r;
  }

  function seismicLoad({ segments, Cs, k = 1.0, elevation = 0.0 }) {
    const segs = segmentGeometry(segments, ["weight"], elevation);
    const r = mkResult("Seismic shear and moment (equivalent lateral force)",
      "statics; Cs from the governing seismic code (user input)");
    r.addInput("Cs (response coefficient)", Cs);
    r.addInput("k (distribution exponent)", k);
    r.addInput("elevation of interest", elevation);

    const Wtotal = segs.reduce((acc, s) => acc + s.weight, 0.0);
    const V = Cs * Wtotal;
    r.addStep("W (total weight)", "sum of segment weights", Wtotal);
    r.addStep("V (base shear)", "Cs*W", V);

    const denom = segs.reduce((acc, s) =>
      acc + s.weight * Math.pow(0.5 * (s.z_bottom + s.z_top), k), 0.0);
    if (denom <= 0.0)
      throw new Error("weights and elevations give a zero distribution denominator");

    let M = 0.0;
    segs.forEach((seg, i) => {
      const zc = 0.5 * (seg.z_bottom + seg.z_top);
      const Fi = (V * seg.weight * Math.pow(zc, k)) / denom;
      const arm = zc - elevation;
      if (arm <= 0.0) return;
      M += Fi * arm;
      r.addStep(`segment ${i} (zc = ${zc})`, "Fi = V*Wi*zi^k/sum", Fi);
      r.addStep(`  arm ${i}`, "centroid above elevation", arm);
    });
    r.addStep("M (overturning moment)", "sum of Fi*arm", M);
    r.addNote("Cs is user input from the governing seismic code. Equivalent "
      + "lateral force only — no modal analysis, sloshing or vessel-specific "
      + "response spectrum.");
    r.results.V = V; r.results.M = M; r.results.W_total = Wtotal;
    return r;
  }

  function combinedLongitudinal({ P, Rm, t, S, E = 1.0, M = 0.0,
    W_axial = 0.0, B_allow = null }) {
    const r = mkResult("Combined longitudinal stress (pressure + moment + weight)",
      "ASME BPVC VIII-1 UG-22, UG-23(b)");
    const area = 2.0 * Math.PI * Rm * t;
    const section = Math.PI * Rm * Rm * t;

    [["P", P, ""], ["Rm (mean radius)", Rm, ""], ["t (corroded)", t, ""],
     ["S", S, ""], ["E (long. joint)", E, ""], ["M (bending moment)", M, ""],
     ["W_axial (compression)", W_axial, ""]]
      .forEach(([n, v, note]) => r.addInput(n, v, "", note));

    const sPress = (P * Rm) / (2.0 * t);
    const sBend = M / section;
    const sAxial = W_axial / area;
    r.addStep("sigma_pressure", "P*Rm/(2*t)", sPress);
    r.addStep("sigma_bending", "M/(pi*Rm^2*t)", sBend);
    r.addStep("sigma_axial", "W/(2*pi*Rm*t)", sAxial);

    const sWind = sPress + sBend - sAxial;
    const sLee = sPress - sBend - sAxial;
    r.addStep("sigma_windward", "press + bend - axial", sWind);
    r.addStep("sigma_leeward", "press - bend - axial", sLee);

    const Sten = S * E;
    let Scomp;
    const hasB = B_allow !== null && B_allow !== undefined;
    if (!hasB) {
      Scomp = Sten;
      r.addNote("B_allow not supplied — the compressive limit fell back to "
        + "S*E. UG-23(b) requires the lesser of S and the factor B of "
        + "UG-28(c); supply B_allow for a thin shell.");
    } else {
      Scomp = Math.min(S, B_allow);
    }
    r.addStep("allowable tension", "S*E", Sten);
    r.addStep("allowable compression", hasB ? "min(S, B)" : "S*E (!)", Scomp);

    const governing = Math.max(sWind, sLee), mostComp = Math.min(sWind, sLee);
    r.addCheck("max tension <= S*E", governing <= Sten);
    if (mostComp < 0.0)
      r.addCheck("max compression <= allowable", -mostComp <= Scomp);
    else
      r.addStep("net compression",
        "none — pressure keeps both sides in tension", 0.0);

    r.addNote("Which loads act together, and with what factors, is the user's "
      + "call per UG-22 and the governing code. Run the empty case (P = 0) "
      + "separately - it usually governs compression.");
    Object.assign(r.results, { sigma_pressure: sPress, sigma_bending: sBend,
      sigma_axial: sAxial, sigma_windward: sWind, sigma_leeward: sLee,
      S_tension_allow: Sten, S_compression_allow: Scomp });
    return r;
  }

  /* ═══════════ 한국에너지공단 KEMCO CODE Section IV (KPM) ═══════════
   * pvcalc/kec.py 의 1:1 포팅. 근거 조항은 파이썬 모듈 docstring 참조.
   * 외압(KPM-3230)은 A·B 를 차트에서 읽어야 하므로 구현하지 않는다.
   * 허용응력 σa·이음효율 η 는 사용자 입력 (원문 표는 저작물). */

  const KEC_MIN_THICKNESS = {
    carbon: 2.5, highalloy: 2.5, highalloy_nocorr: 1.5,
    nonferrous: 2.5, nonferrous_nocorr: 1.5,
  };
  const KEC_MIN_LABEL = {
    carbon: "탄소강·저합금강 강판 (KPM-3210(1))",
    highalloy: "고합금강 강판, 부식 예상 (KPM-3210(2))",
    highalloy_nocorr: "고합금강 강판, 부식 예상 안 됨 (KPM-3210(2))",
    nonferrous: "비철금속판, 부식 예상 (KPM-3210(3))",
    nonferrous_nocorr: "비철금속판, 부식 예상 안 됨 (KPM-3210(3))",
  };

  function kecMult(units) {
    const u = String(units).toLowerCase();
    if (u === "si") return 1.0;
    if (u === "kgf") return 100.0;
    throw new Error("units 는 'SI' 또는 'kgf'");
  }
  const kecUnitLabels = units => kecMult(units) === 1.0
    ? ["MPa", "N/mm²"] : ["kgf/cm²", "kgf/mm²"];

  function kecCommonInputs(r, P, sigma_a, eta, alpha, units) {
    const [pu, su] = kecUnitLabels(units);
    r.addInput("P (최고사용압력)", P, pu);
    r.addInput("σa (허용인장응력)", sigma_a, su);
    r.addInput("η (이음효율)", eta, "", "관은 허용응력에 용접효율이 포함되어 1.0");
    r.addInput("α (부식여유, KPM-3130)", alpha, "mm");
  }

  function kecMinCheck(r, tReq, alpha, materialClass) {
    if (materialClass === null || materialClass === undefined || materialClass === "")
      return tReq;
    if (KEC_MIN_THICKNESS[materialClass] === undefined)
      throw new Error("material_class 값이 올바르지 않습니다");
    const tmin = KEC_MIN_THICKNESS[materialClass];
    r.addStep("t_min (KPM-3210)", KEC_MIN_LABEL[materialClass], tmin, "mm");
    r.addCheck(`성형 후 실제두께(부식여유 제외) ≥ ${tmin} mm`, tReq - alpha >= tmin);
    const governed = Math.max(tReq, tmin + alpha);
    if (governed > tReq) r.addStep("t (최소두께 지배)", "t_min + α", governed, "mm");
    return governed;
  }

  function kecCylinderThickness({ P, Di = null, Do = null, sigma_a, eta = 1.0,
    alpha = 0.0, units = "SI", material_class = "carbon", thick_wall = null }) {
    if ((Di === null) === (Do === null)) throw new Error("Di 또는 Do 중 하나만 지정");
    const m = kecMult(units);
    const r = mkResult("원통형 동체 — 내압 최소두께",
      "KEMCO CODE Section IV KPM-3221 (한국에너지공단)");
    kecCommonInputs(r, P, sigma_a, eta, alpha, units);
    const byId = Di !== null;
    const D = byId ? Di : Do;
    r.addInput(byId ? "Di (부식여유 제외 안지름)" : "Do (부식여유 제외 바깥지름)", D, "mm");

    const S = sigma_a * m * eta;
    r.addStep("σa·계수·η", `σa × ${m} × η`, S);

    let tThin;
    if (byId) {
      tThin = P * D / (2.0 * S - 1.2 * P) + alpha;
      r.addStep("t (1) 안지름 기준", `P·Di/(2·${m}σa·η − 1.2P) + α`, tThin, "mm");
    } else {
      tThin = P * D / (2.0 * S + 0.8 * P) + alpha;
      r.addStep("t (2) 바깥지름 기준", `P·Do/(2·${m}σa·η + 0.8P) + α`, tThin, "mm");
    }

    const DiEff = byId ? D : D - 2.0 * (tThin - alpha);
    const limit = DiEff / 4.0;
    r.addStep("Di/4 (두꺼운 벽 판정 한계)", "안지름/4", limit, "mm");
    const isThick = thick_wall === null || thick_wall === undefined
      ? (tThin - alpha) > limit : !!thick_wall;

    let tReq = tThin;
    if (isThick) {
      if (S <= P) throw new Error("σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남");
      const k = Math.sqrt((S + P) / (S - P));
      r.addStep("√((σa·η+P)/(σa·η−P))", "두꺼운 벽 계수", k);
      if (byId) {
        tReq = (D / 2.0) * (k - 1.0) + alpha;
        r.addStep("t (3)① 안지름 기준", "(Di/2)·(k − 1) + α", tReq, "mm");
      } else {
        tReq = (D / 2.0) * (1.0 - 1.0 / k) + alpha;
        r.addStep("t (3)② 바깥지름 기준", "(Do/2)·(1 − 1/k) + α", tReq, "mm");
      }
      r.results.governing = "thick_wall";
    } else {
      r.results.governing = "thin_wall";
    }
    r.addCheck("두꺼운 벽 식 적용 여부 판정됨 (크리프 영역이면 (1)/(2) 사용 — KPM-3220)", true);

    r.results.t_req = tReq;
    r.results.t = kecMinCheck(r, tReq, alpha, material_class);
    return r;
  }

  function kecSphereThickness({ P, Di = null, Do = null, sigma_a, eta = 1.0,
    alpha = 0.0, units = "SI", material_class = "carbon", thick_wall = null }) {
    if ((Di === null) === (Do === null)) throw new Error("Di 또는 Do 중 하나만 지정");
    const m = kecMult(units);
    const r = mkResult("구형 동체 — 내압 최소두께",
      "KEMCO CODE Section IV KPM-3222 (한국에너지공단)");
    kecCommonInputs(r, P, sigma_a, eta, alpha, units);
    const byId = Di !== null;
    const D = byId ? Di : Do;
    r.addInput(byId ? "Di (부식여유 제외 안지름)" : "Do (부식여유 제외 바깥지름)", D, "mm");

    const S = sigma_a * m * eta;
    r.addStep("σa·계수·η", `σa × ${m} × η`, S);

    let tThin;
    if (byId) {
      tThin = P * D / (4.0 * S - 0.4 * P) + alpha;
      r.addStep("t (1) 안지름 기준", `P·Di/(4·${m}σa·η − 0.4P) + α`, tThin, "mm");
    } else {
      tThin = P * D / (4.0 * S + 1.6 * P) + alpha;
      r.addStep("t (2) 바깥지름 기준", `P·Do/(4·${m}σa·η + 1.6P) + α`, tThin, "mm");
    }

    const DiEff = byId ? D : D - 2.0 * (tThin - alpha);
    const limit = 0.178 * DiEff;
    r.addStep("0.178·Di (두꺼운 벽 판정 한계)", "안지름 × 0.178", limit, "mm");
    const isThick = thick_wall === null || thick_wall === undefined
      ? (tThin - alpha) > limit : !!thick_wall;

    let tReq = tThin;
    if (isThick) {
      if (2.0 * S <= P) throw new Error("2σa·η ≤ P — 두꺼운 벽 식의 적용 범위를 벗어남");
      const k = Math.cbrt((2.0 * (S + P)) / (2.0 * S - P));
      r.addStep("∛(2(σa·η+P)/(2σa·η−P))", "두꺼운 벽 계수", k);
      if (byId) {
        tReq = (D / 2.0) * (k - 1.0) + alpha;
        r.addStep("t (3)① 안지름 기준", "(Di/2)·(k − 1) + α", tReq, "mm");
      } else {
        tReq = (D / 2.0) * (1.0 - 1.0 / k) + alpha;
        r.addStep("t (3)② 바깥지름 기준", "(Do/2)·(1 − 1/k) + α", tReq, "mm");
      }
      r.results.governing = "thick_wall";
    } else {
      r.results.governing = "thin_wall";
    }

    r.results.t_req = tReq;
    r.results.t = kecMinCheck(r, tReq, alpha, material_class);
    return r;
  }

  function kecTorisphericalHead({ P, R, r_knuckle = null, sigma_a, eta = 1.0,
    alpha = 0.0, units = "SI", material_class = "carbon",
    hemispherical = false, flanged_opening = false, Di_shell = null }) {
    const m = kecMult(units);
    const res = mkResult("접시형·전체반구형 경판 — 최소두께",
      "KEMCO CODE Section IV KPM-3321"
      + (flanged_opening ? " / KPM-3322(2)" : "") + " (한국에너지공단)");
    kecCommonInputs(res, P, sigma_a, eta, alpha, units);
    res.addInput("R (경판 중앙부 내면 반지름)", R, "mm");

    let Ruse = R;
    if (flanged_opening && Di_shell !== null && Di_shell !== undefined) {
      const floorR = 0.8 * Di_shell;
      res.addInput("Di (동체 안지름)", Di_shell, "mm");
      if (Ruse < floorR) {
        res.addStep("R 대체 (KPM-3322(2))", "동체 안지름의 80%", floorR, "mm");
        Ruse = floorR;
      }
    }

    let W;
    if (hemispherical) {
      W = 1.0;
      res.addStep("W", "전체 반구형 경판은 1", W);
    } else {
      if (r_knuckle === null || r_knuckle === undefined || r_knuckle === "")
        throw new Error("접시형 경판은 r_knuckle 이 필요 (전체반구형은 hemispherical=true)");
      res.addInput("r (구석 둥글기 안쪽 반지름, 부식여유 제외)", r_knuckle, "mm");
      W = 0.25 * (3.0 + Math.sqrt(Ruse / r_knuckle));
      res.addStep("W", "(3 + √(R/r))/4", W);
    }

    const S = sigma_a * m * eta;
    const tBase = P * Ruse * W / (2.0 * S - 0.2 * P) + alpha;
    res.addStep("t (KPM-3321)", `P·R·W/(2·${m}σa·η − 0.2P) + α`, tBase, "mm");

    let tReq = tBase;
    if (flanged_opening) {
      const add = Math.max(0.15 * tBase, 3.0);
      res.addStep("가산량 (KPM-3322(2))", "max(15% × t, 3 mm)", add, "mm");
      tReq = tBase + add;
      res.addStep("t (플랜지 보강 가산 후)", "t + 가산량", tReq, "mm");
    }

    res.results.W = W;
    res.results.t_req = tReq;
    res.results.t = kecMinCheck(res, tReq, alpha, material_class);
    return res;
  }

  function kecEllipsoidalHead({ P, D, h = null, sigma_a, eta = 1.0, alpha = 0.0,
    units = "SI", material_class = "carbon", D_over_2h = null,
    flanged_opening = false, Di_shell = null }) {
    const m = kecMult(units);

    if (flanged_opening) {
      if (Di_shell === null || Di_shell === undefined)
        throw new Error("KPM-3324(2) 는 동체 안지름(Di_shell)이 필요");
      const res = mkResult("반타원체형 경판 — 플랜지 보강 구멍이 있는 경우",
        "KEMCO CODE Section IV KPM-3324(2) → KPM-3322(2) (한국에너지공단)");
      kecCommonInputs(res, P, sigma_a, eta, alpha, units);
      res.addInput("Di (동체 안지름)", Di_shell, "mm");
      const Ruse = 0.8 * Di_shell, W = 1.77;
      res.addStep("R (KPM-3324(2))", "동체 안지름의 80%", Ruse, "mm");
      res.addStep("W (KPM-3324(2))", "1.77 로 한다", W);
      const S = sigma_a * m * eta;
      const tBase = P * Ruse * W / (2.0 * S - 0.2 * P) + alpha;
      res.addStep("t (KPM-3321 식)", `P·R·W/(2·${m}σa·η − 0.2P) + α`, tBase, "mm");
      const add = Math.max(0.15 * tBase, 3.0);
      res.addStep("가산량 (KPM-3322(2))", "max(15% × t, 3 mm)", add, "mm");
      const tReq = tBase + add;
      res.addStep("t (가산 후)", "t + 가산량", tReq, "mm");
      res.results.W = W;
      res.results.t_req = tReq;
      res.results.t = kecMinCheck(res, tReq, alpha, material_class);
      return res;
    }

    const res = mkResult("반타원체형 경판 — 최소두께",
      "KEMCO CODE Section IV KPM-3323 (한국에너지공단)");
    kecCommonInputs(res, P, sigma_a, eta, alpha, units);
    res.addInput("D (경판 내면 긴지름)", D, "mm");

    let ratio;
    if (D_over_2h === null || D_over_2h === undefined) {
      if (h === null || h === undefined) throw new Error("h 또는 D_over_2h 중 하나가 필요");
      res.addInput("h (짧은 지름의 1/2)", h, "mm");
      ratio = D / (2.0 * h);
    } else {
      ratio = D_over_2h;
    }
    res.addStep("D/2h", "긴지름/(2·h)", ratio);

    const V = (2.0 + ratio * ratio) / 6.0;
    res.addStep("V", "[2 + (D/2h)²]/6", V);

    const S = sigma_a * m * eta;
    const tReq = P * D * V / (2.0 * S - 0.2 * P) + alpha;
    res.addStep("t (KPM-3323)", `P·D·V/(2·${m}σa·η − 0.2P) + α`, tReq, "mm");

    res.results.V = V;
    res.results.t_req = tReq;
    res.results.t = kecMinCheck(res, tReq, alpha, material_class);
    return res;
  }

  /* ═══════════ API 650 — 상압 용접 저장탱크 ═══════════
   * pvcalc/api650.py 의 1:1 포팅. 근거 조항은 파이썬 모듈 docstring 참조.
   * 두께가 설계압력이 아니라 정수두로 결정되므로 단(course)마다 다르다.
   * 허용응력 Sd·St 는 원문 Table 5.2 값(저작물)이라 사용자 입력. */

  function a650Cfg(units) {
    const u = String(units).toUpperCase();
    if (u === "SI")
      return { k: 4.9, href: 0.3, lenU: "m", tU: "mm", sU: "MPa", maxD: 61.0 };
    if (u === "USC")
      return { k: 2.6, href: 1.0, lenU: "ft", tU: "in", sU: "lbf/in²", maxD: 200.0 };
    throw new Error("units 는 'SI' 또는 'USC'");
  }

  /* 5.6.1.1 호칭지름별 최소 호칭두께. 구간은 "<15 / 15~<36 / 36~60 / >60". */
  function a650MinNominalThickness(D, units = "SI", lowestCourse = false) {
    const si = String(units).toUpperCase() === "SI";
    let t;
    if (si) t = D < 15 ? 5.0 : D < 36 ? 6.0 : D <= 60 ? 8.0 : 10.0;
    else t = D < 50 ? 3 / 16 : D < 120 ? 1 / 4 : D <= 200 ? 5 / 16 : 3 / 8;
    if (lowestCourse) {                       /* NOTE 4 */
      const [lo, hi, tn4] = si ? [3.2, 15.0, 6.0] : [10.5, 50.0, 1 / 4];
      if (D > lo && D < hi) t = Math.max(t, tn4);
    }
    return t;
  }

  function a650ShellCourseThickness({ D, H, G, Sd, St, CA = 0.0, units = "SI",
    lowest_course = false, course_label = "" }) {
    const c = a650Cfg(units);
    const r = mkResult(`셸 단 두께 — 1-Foot Method${course_label ? " · " + course_label : ""}`,
      "API Standard 650, 5.6.3 (1-Foot Method) / 5.6.1.1");
    r.addInput("D (호칭 탱크 지름)", D, c.lenU);
    r.addInput("H (설계 액면 — 단 하단부터)", H, c.lenU);
    r.addInput("G (설계 비중)", G);
    r.addInput("Sd (설계조건 허용응력)", Sd, c.sU);
    r.addInput("St (수압시험조건 허용응력)", St, c.sU);
    r.addInput("CA (부식여유)", CA, c.tU);

    const head = H - c.href;
    r.addStep("H − 기준높이",
      `H − ${c.href} (${c.lenU}) — 단 하단에서 0.3 m(1 ft) 위 지점`, head, c.lenU);

    const td = c.k * D * head * G / Sd + CA;
    const tt = c.k * D * head / St;
    r.addStep("td (설계조건)", `${c.k}·D·(H−${c.href})·G/Sd + CA`, td, c.tU);
    r.addStep("tt (수압시험조건)", `${c.k}·D·(H−${c.href})/St`, tt, c.tU);

    const tCalc = Math.max(td, tt);
    r.addStep("계산 필요두께", "max(td, tt)", tCalc, c.tU);

    const tMin = a650MinNominalThickness(D, units, lowest_course);
    r.addStep("최소 호칭두께 (5.6.1.1)",
      "호칭지름 구간별" + (lowest_course ? " + NOTE 4 (최하단 단)" : ""), tMin, c.tU);

    const tReq = Math.max(tCalc, tMin);
    r.addCheck(`1-Foot Method 적용범위: D ≤ ${c.maxD} ${c.lenU} (5.6.3.1)`, D <= c.maxD);
    r.addCheck("H > 기준높이 (단 높이가 0.3 m/1 ft 를 넘어야 함)", head > 0);
    r.addCheck("계산두께가 최소 호칭두께 이상 (5.6.1.1)", tCalc <= tReq);

    r.results.td = td;
    r.results.tt = tt;
    r.results.t_min_nominal = tMin;
    r.results.t_required = tReq;
    r.results.governing = tCalc >= tMin
      ? (tt > td ? "hydrostatic_test" : "product_design") : "minimum_nominal";
    return r;
  }

  function a650ShellCourses({ D, course_heights, H_design, G, Sd, St,
    CA = 0.0, units = "SI" }) {
    const c = a650Cfg(units);
    const n = course_heights.length;
    if (!n) throw new Error("course_heights 가 비어 있습니다");
    const SdL = Array.isArray(Sd) ? Sd.slice() : new Array(n).fill(Sd);
    const StL = Array.isArray(St) ? St.slice() : new Array(n).fill(St);
    if (SdL.length !== n || StL.length !== n)
      throw new Error("Sd·St 리스트 길이가 단 수와 다릅니다");

    const results = [];
    let z = 0.0;
    for (let i = 0; i < n; i++) {
      const Hi = H_design - z;
      const label = `${i + 1}단 (하단 z=${z} ${c.lenU})`;
      let r;
      if (Hi - c.href <= 0) {
        r = mkResult(`셸 단 두께 — ${label}`, "API Standard 650, 5.6.1.1");
        r.addInput("D (호칭 탱크 지름)", D, c.lenU);
        r.addInput("H (설계 액면 — 단 하단부터)", Hi, c.lenU);
        const tMin = a650MinNominalThickness(D, units, i === 0);
        r.addStep("정수두 없음", "이 단은 설계 액면 위 — 최소 호칭두께만 적용", 0.0);
        r.addStep("최소 호칭두께 (5.6.1.1)", "호칭지름 구간별", tMin, c.tU);
        r.results.td = 0.0;
        r.results.tt = 0.0;
        r.results.t_min_nominal = tMin;
        r.results.t_required = tMin;
        r.results.governing = "minimum_nominal";
      } else {
        r = a650ShellCourseThickness({
          D, H: Hi, G, Sd: SdL[i], St: StL[i], CA, units,
          lowest_course: i === 0, course_label: label,
        });
      }
      results.push(r);
      z += course_heights[i];
    }

    const totalH = course_heights.reduce((s, h) => s + h, 0);
    const s = mkResult("셸 단별 필요두께 요약", "API Standard 650, 5.6.3 / 5.6.1.1");
    s.addInput("D (호칭 탱크 지름)", D, c.lenU);
    s.addInput("셸 전체 높이", totalH, c.lenU);
    s.addInput("H_design (바닥 기준 설계 액면)", H_design, c.lenU);
    s.addInput("단 수", n);
    s.addInput("G (설계 비중)", G);
    s.addInput("CA (부식여유)", CA, c.tU);
    results.forEach((r, i) =>
      s.addStep(`${i + 1}단 필요두께`, r.results.governing, r.results.t_required, c.tU));
    s.addCheck("설계 액면이 셸 전체 높이를 넘지 않음", H_design <= totalH);
    s.addCheck(`1-Foot Method 적용범위: D ≤ ${c.maxD} ${c.lenU}`, D <= c.maxD);
    s.addCheck("아래 단이 위 단보다 두껍거나 같음 (5.6.1.3 취지)",
      results.every((r, i) => i === n - 1
        || r.results.t_required >= results[i + 1].results.t_required));
    s.results.t_bottom = results[0].results.t_required;
    s.results.t_top = results[n - 1].results.t_required;
    s.results.courses = n;
    return { courses: results, summary: s };
  }

  return {
    VERSION: "0.1.0",
    a650MinNominalThickness, a650ShellCourseThickness, a650ShellCourses,
    kecCylinderThickness, kecSphereThickness,
    kecTorisphericalHead, kecEllipsoidalHead,
    KEC_MIN_THICKNESS,
    cylinderThickness, cylinderMawp, sphereThickness, sphereMawp, staticHead,
    ellipsoidalThickness, ellipsoidalMawp, torisphericalThickness,
    torisphericalMawp, hemisphericalThickness, conicalThickness,
    cylinderMaep, cylinderThicknessForExternal, sphereMaep,
    areaReinforcement, weldStrength, largeOpeningCheck, ug45NeckThickness,
    B3610_STD_WALL_IN,
    figure271, table271, flangeBoltLoads, flangeStresses,
    zickCoefficients, saddleAnalysis,
    windLoad, seismicLoad, combinedLongitudinal,
  };
}));

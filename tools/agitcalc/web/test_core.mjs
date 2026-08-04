/* test_core.mjs — JS 엔진(agitcalc-core.js) 을 파이썬 엔진 결과와 대조한다.
 *
 * 실행:
 *   python tests/gen_test_vectors.py
 *   node web/test_core.mjs
 *
 * 상대오차 1e-9 이내를 요구한다(두 엔진이 같은 수식이면 부동소수 오차만 남음).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ac = require(join(__dirname, "agitcalc-core.js"));
const vec = JSON.parse(readFileSync(join(__dirname, "..", "tests",
  "test_vectors.json"), "utf-8"));

const TOL = 1e-9;
let pass = 0;
const fails = [];

function cmp(label, got, want) {
  if (typeof want === "boolean" || typeof want === "string") {
    if (got === want) { pass++; return; }
    fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    return;
  }
  if (want === null) {
    if (got === null || got === undefined) { pass++; return; }
    fails.push(`${label}: got ${got}, want null`);
    return;
  }
  if (got === undefined || got === null || Number.isNaN(got)) {
    fails.push(`${label}: got ${got}, want ${want}`);
    return;
  }
  const err = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
  if (err <= TOL) { pass++; return; }
  fails.push(`${label}: got ${got}, want ${want} (상대오차 ${err.toExponential(3)})`);
}

/* ---------------- 스칼라 ---------------- */
const SCALAR = {
  reynolds: a => ac.reynolds(...a),
  froude: a => ac.froude(...a),
  tipSpeed: a => ac.tipSpeed(...a),
  powerNumber: a => ac.powerNumber(a[0], a[1], a[2]).Np,
  impellerPower: a => ac.impellerPower(...a),
  pumpingCapacity: a => ac.pumpingCapacity(...a),
  interferenceFactor: a => ac.interferenceFactor(...a),
  liquidHeight: a => ac.liquidHeight(...a),
  volumeFromTH: a => ac.volumeFromTH(...a),
  turnoverTime: a => ac.turnoverTime(...a),
  specificPower: a => ac.specificPower(...a),
  "selectMotor.motor": a => ac.selectMotor(a[0], a[1]).motor_kW,
  "selectMotor.load": a => ac.selectMotor(a[0], a[1]).load_pct,
  "blendTime.theta": a => ac.blendTime(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).theta,
  "blendTime.thetaTurb": a => ac.blendTime(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).theta_turbulent,
  "blendTime.fRe": a => ac.blendTime(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).f_Re,
  allowableShear: a => ac.allowableShear(a[0], a[1]),
  "sectionProps.A": a => ac.sectionProps(a[0]).A,
  "sectionProps.I": a => ac.sectionProps(a[0]).I,
  "sectionProps.Z": a => ac.sectionProps(a[0]).Z,
  "sectionProps.Zp": a => ac.sectionProps(a[0]).Zp,
  "sectionProps.Zp.hollow": a => ac.sectionProps(a[0], a[1]).Zp,
  estimateImpellerMass: a => ac.estimateImpellerMass(a[0], a[1]),
  minShaftDiameter: a => ac.minShaftDiameter(a[0], a[1], a[2]),
  snapRpm: a => ac.snapRpm(a[0]),
  snapShaftDia: a => ac.snapShaftDia(a[0]),
  "justSuspendedSpeed.Njs": a =>
    ac.justSuspendedSpeed(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]).N_js_rps,
  "justSuspendedSpeed.S": a =>
    ac.justSuspendedSpeed(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]).S,
  "cavernDiameter.Dc": a => ac.cavernDiameter(a[0], a[1], a[2], a[3], a[4], a[5]).Dc,
  "cavernDiameter.DcT": a => ac.cavernDiameter(a[0], a[1], a[2], a[3], a[4], a[5]).Dc_over_T,
  "jacketHeatTransfer.h": a =>
    ac.jacketHeatTransfer(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).h,
  "coilHeatTransfer.h": a =>
    ac.coilHeatTransfer(a[0], a[1], a[2], a[3], a[4], a[5], a[6]).h,
  "gasDispersionCheck.Flg": a => ac.gasDispersionCheck(a[0], a[1], a[2], a[3]).Fl_g,
  "gasDispersionCheck.Fltrans": a => ac.gasDispersionCheck(a[0], a[1], a[2], a[3]).Fl_trans,
};

console.log("== 스칼라 함수 ==");
for (const v of vec.scalar) {
  const fn = SCALAR[v.fn];
  if (!fn) { fails.push(`미구현 대조함수: ${v.fn}`); continue; }
  cmp(`${v.fn}(${JSON.stringify(v.args)})`, fn(v.args), v.got);
}

/* ---------------- 형상 ---------------- */
console.log("== 형상 산정 ==");
for (const v of vec.geometry) {
  const a = v.args;
  const g = ac.recommend(a.T, a.V, a.mu_cP, {
    impellerType: a.impeller_type ?? null, dT: a.dT ?? null,
    nImp: a.n_imp ?? null, W_D: a.W_D ?? null,
  });
  const tag = `recommend(T=${a.T},V=${a.V},mu=${a.mu_cP})`;
  for (const [k, want] of Object.entries(v.got)) {
    if (k === "elevations") {
      cmp(`${tag}.elevations.length`, g.elevations.length, want.length);
      want.forEach((w, i) => cmp(`${tag}.elevations[${i}]`, g.elevations[i], w));
    } else if (k === "tip_speed_range") {
      want.forEach((w, i) => cmp(`${tag}.tip_speed_range[${i}]`, g.tip_speed_range[i], w));
    } else {
      cmp(`${tag}.${k}`, g[k], want);
    }
  }
}

/* ---------------- 축 ---------------- */
console.log("== 축 검토 ==");
for (const v of vec.shaft) {
  const a = v.args;
  const imps = a.impellers.map(i => ({ D: i.D, a: i.a, mass: i.mass ?? null }));
  const r = ac.designShaft(a.P_motor_kW, a.rpm, a.d_shaft_mm, a.L_shaft_mm,
    imps, { material: a.material, baffled: a.baffled });
  const tag = `designShaft(${a.P_motor_kW}kW,${a.rpm}rpm,φ${a.d_shaft_mm})`;
  for (const [k, want] of Object.entries(v.got)) cmp(`${tag}.${k}`, r.results[k], want);
}

/* ---------------- 종합 선정 ---------------- */
console.log("== 종합 선정 ==");
for (const v of vec.design) {
  const a = v.args;
  const r = ac.design({
    V: a.V, rho: a.rho, mu_cP: a.mu_cP, T: a.T ?? null,
    impellerType: a.impeller_type ?? null, dT: a.dT ?? null,
    basis: a.basis ?? "level", level: a.level ?? "moderate",
    rpm: a.rpm ?? null, targetBlendMin: a.target_blend_min ?? null,
  });
  const tag = `design(V=${a.V},mu=${a.mu_cP}${a.T ? ",T=" + a.T : ""}` +
    `${a.basis ? ",basis=" + a.basis : ""}${a.level ? ",level=" + a.level : ""})`;
  const map = {
    T: r.T, H: r.H, rpm: r.rpm, rpm_calc: r.rpm_calc, Re: r.Re, Fr: r.Fr,
    v_tip: r.v_tip, Np: r.Np, P_liquid: r.P_liquid, PV: r.PV,
    motor_kW: r.motor_kW, load_pct: r.load_pct, Q_total: r.Q_total,
    theta95_s: r.theta95_s, turnover_s: r.turnover_s,
    shaft_dia_mm: r.shaft_dia_mm, shaft_len_mm: r.shaft_len_mm,
    impeller_type: r.impeller.key, D: r.geometry.D, D_T: r.geometry.D_T,
    n_impellers: r.geometry.n_impellers,
    N_crit_rpm: r.shaft.results.N_crit_rpm, ok: r.summary.ok,
  };
  for (const [k, want] of Object.entries(v.got)) cmp(`${tag}.${k}`, map[k], want);
}

/* ---------------- 벤더 재현 ---------------- */
console.log("== 벤더 검토서 재현 ==");
for (const v of vec.vendor) {
  const a = v.args;
  const r = ac.topjinSheet({ T: a.T, V: a.V, rho: a.rho, mu_cP: a.mu_cP,
    rpm: a.rpm, imps: a.imps, motor_kW: a.motor_kW ?? null,
    hasCoil: a.has_coil ?? false, baffled: a.baffled ?? null });
  const tag = `topjinSheet(V=${a.V},mu=${a.mu_cP},${a.rpm}rpm)`;
  for (const [k, want] of Object.entries(v.got)) cmp(`${tag}.${k}`, r.results[k], want);
}

/* ---------------- 결과 ---------------- */
console.log();
console.log("=".repeat(70));
if (fails.length) {
  console.log(`불일치 ${fails.length} 건 (일치 ${pass} 건):`);
  fails.slice(0, 40).forEach(f => console.log("  - " + f));
  if (fails.length > 40) console.log(`  ... 외 ${fails.length - 40} 건`);
  console.log("=".repeat(70));
  process.exit(1);
}
console.log(`파이썬 <-> JS 엔진 일치: ${pass} 비교 전부 통과 (상대오차 <= ${TOL})`);
console.log("=".repeat(70));

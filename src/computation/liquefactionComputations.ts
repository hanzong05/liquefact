import {postPredict} from "../api/liquefactPredict";
import {buildExactBoreholeParameterTable} from "../utils/boreholeParameterInterpolation";
import {datasetBoreholes} from "../utils/constants/datasetBoreholes";
import type {DatasetBorehole} from "../utils/constants/datasetBoreholes.type";
import {averageIfs, compare, compute, computeString} from "../utils/helpers";
import {NEIGHBOR_CALIBRATION_MAX_RADIUS_KM} from "../utils/neighborLpiCalibration";
import Liquefaction from "./Liquefaction";

/** Default `table_weight` for POST /predict (0 = model only, 1 = full literature tables). */
export const DEFAULT_PREDICT_TABLE_WEIGHT = 0.65;

/**
 * Normalized outputs for spreadsheet / UI (magnitude comes from site parameters, not the API).
 */
export type RunModelResult = {
  initialParameterTable: initialParameterTableType[];
  listOfDepths: number[];
};

export type RunModelOptions = {
  signal?: AbortSignal;
  /** Overrides {@link DEFAULT_PREDICT_TABLE_WEIGHT}. */
  tableWeight?: number;
  /** Borehole dataset to use; falls back to static datasetBoreholes when absent. */
  boreholes?: DatasetBorehole[];
};

/**
 * Calls the hosted Liquefact `/predict` API and merges in magnitude from `parametersObject`.
 */

/** Layer material for bearing / overlap logic (replaces Excel L-column text lists). */
export type SoilTypeChoice = "Cohesive" | "Cohesionless" | "Rock";

/** SBC qₐ (new) when the bearing influence zone includes rock (iterated footing widths). */
export const SBC_QA_NEW_ROCK_MESSAGE =
  "N/A - Rock/Cobble Detected (Use Rock Mechanics)" as const;

export interface initialParameterTableType {
  // Latitude 	Longitude	Depth (z)	Layer Thickness (z2)	Total Unit Weight (y)	N60	Fines Content (FC)	Magnitude	Peak Ground Acceleration (PGA)	Gound Water Level (GWL)	Soil Type
  latitude: number;
  longitude: number;
  depth: number;
  layerThickness: number;
  totalUnitWeight: number;
  n60: number;
  finesContent: number;
  magnitude: number;
  peakGroundAcceleration: number;
  groundWaterLevel: number;
  soilType: SoilTypeChoice;
  modulusOfElasticity: number;
}

function normalizeSoilType(raw: string): SoilTypeChoice {
  const t = raw.trim() as SoilTypeChoice;
  if (t === "Cohesive" || t === "Cohesionless" || t === "Rock") return t;
  return "Cohesionless";
}

export async function runModel(
  parametersObject: Liquefaction,
  options?: RunModelOptions,
): Promise<RunModelResult> {
  const lat = parametersObject.latitude;
  const lng = parametersObject.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Latitude and longitude must be finite numbers.");
  }

  const listOfDepths = [1.5, 3.0, 4.5, 6.0, 7.5, 9.0, 10.5, 12.0, 13.5, 15.0];
  const initialParameterTable: initialParameterTableType[] = [];
  const tableWeight = options?.tableWeight ?? DEFAULT_PREDICT_TABLE_WEIGHT;
  const mag = parametersObject.earthquakeMagnitude;
  const magnitude = Number.isFinite(mag) && mag > 0 ? mag : 7;

  const boreholes =
    options?.boreholes && options.boreholes.length > 0
      ? options.boreholes
      : datasetBoreholes;

  // Always use the single nearest borehole — no IDW blending with neighbours.
  // Blending drags N60 down when adjacent boreholes have lower values, causing
  // bearing capacity to diverge from the measured borehole data.
  const nearest = buildExactBoreholeParameterTable(lat, lng, magnitude, boreholes, NEIGHBOR_CALIBRATION_MAX_RADIUS_KM);
  if (nearest !== null) {
    return {
      initialParameterTable: nearest.initialParameterTable,
      listOfDepths: nearest.listOfDepths,
    };
  }

  for (let i = 0; i < listOfDepths.length; i++) {
    const depth = listOfDepths[i]!;
    const prevDepth = i === 0 ? 0 : listOfDepths[i - 1]!;
    const layerThickness = depth - prevDepth;

    const raw = await postPredict(
      {
        latitude: lat,
        longitude: lng,
        depth,
        table_weight: tableWeight,
      },
      options?.signal,
    );

    initialParameterTable.push({
      latitude: lat,
      longitude: lng,
      depth,
      layerThickness,
      totalUnitWeight: raw.TotalUnitWeight,
      n60: raw.N60,
      finesContent: raw.FinesContent,
      magnitude,
      peakGroundAcceleration: raw.PeakGroundAcceleration,
      groundWaterLevel: raw.GoundWaterLevel,
      soilType: normalizeSoilType(raw.SoilType),
      modulusOfElasticity: raw.ModulusOfElasticity,
    });
  }

  console.log("initialParameterTable", initialParameterTable);

  return {
    initialParameterTable,
    listOfDepths,
  };
}

// To make this documentation fully operational for a developer or engineer, here is the complete mapping of the Excel column indices to the specific formulas used within those cells.

// ### **Section 1: Geotechnical & Liquefaction Analysis (Columns A–AH)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **A** | No. of Boreholes | *Manual Input* |
// | **B** | Latitude | *Manual Input* |
// | **C** | Longitude | *Manual Input* |
// | **D** | Depth (z) | *Manual Input* |
// | **E** | Layer Thickness (z2) | *Manual Input* |
// | **F** | Total Unit Weight (y) | *Manual Input* |
// | **G** | N60 | *Manual Input* |
// | **H** | Fines Content (FC) | *Manual Input* |
// | **I** | Magnitude | *Global Constant* |
// | **J** | Peak Ground Acceleration (PGA) | *Global Constant* |
// | **K** | Ground Water Level (GWL) | *Global Constant* |
// | **L** | Soil Type | *Manual Input* |
// | **M** | Pore Pressure (u) | `IF(z > GWL, (z - GWL) * 9.81, 0)` |
// | **N** | Total Stress (Ot) | `Previous_Ot + (y * z2)` |
// | **O** | Effective Stress | `Ot - u` |
// | **P** | Cn | `min(sqrt(100 / Effective_Stress), 1.7)` |
// | **Q** | N160 | `N60 * Cn` |
// | **R** | N160_2 ($\Delta N$) | `exp(1.63 + (9.7 / (FC + 0.01)) - (15.7 / (FC + 0.01))^2)` |
// | **S** | N160cs | `N160 + N160_2` |
// | **T** | m | `0.3 + 0.7 * exp(-N160cs / 20)` *(Simplified Idriss)* |
// | **U** | Cn_final | `(100 / Effective_Stress)^m` *(capped at 1.7)* |
// | **V** | N160cs_final | `N60 * Cn_final + N160_2` |
// | **W** | rd | `1.0 - 0.00765 * z` *(if z < 9.15m)* |
// | **X** | CSR | `0.65 * PGA * (Ot / Effective_Stress) * rd` |
// | **Y** | MSFmax | `1.8` *(Standard cap)* |
// | **Z** | MSF | `6.9 * exp(-Magnitude / 4) - 0.058` |
// | **AA** | Ko | `1 - (LOG(Effective_Stress / 100) * 0.3)` |
// | **AB** | CRR7.5 | `exp((N160cs/14.1) + (N160cs/126)^2 - (N160cs/23.6)^3 + (N160cs/25.4)^4 - 2.8)` |
// | **AC** | FS | `(CRR7.5 / CSR) * MSF * Ko` |
// | **AD** | Remarks | `IF(FS < 1, "LIQUEFIABLE", "NOT LIQUEFIABLE")` |
// | **AE** | Severity (Fi) | `IF(FS < 1, 1 - FS, 0)` |
// | **AF** | Weighting Factor | `10 - 0.5 * z` |
// | **AG** | LPI | `Fi * Weighting_Factor * z2` |
// | **AH** | Remarks.1 | `LOOKUP(LPI_Sum, [0, 5, 15], ["Low", "High", "Very High"])` |

// ---

// ### **Section 2: Bearing Capacity (SBC) (Columns AI–AS)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **AI** | Footing Width, B | *Manual Design Input* |
// | **AJ** | Depth of Footing, Df | *Manual Design Input* |
// | **AK** | Tolerable Settlement | *Constant (usually 25 or 50)* |
// | **AL** | Depth Factor, Fd | `1 + 0.33 * (Df / B)` *(capped at 1.33)* |
// | **AM** | N | `AVERAGE(N60_in_bearing_zone)` |
// | **AN** | N_Design | `0.55 * N` *(Correction for silty sands if applicable)* |
// | **AO** | Nc | `Table_Lookup(Soil_Type, Friction_Angle)` |
// | **AP** | SBC (qa) | `11.98 * N_Design * Fd * (Tolerable_Settlement / 25)` |
// | **AQ** | SBC (qa) NEW | `IF(Soil_Type="ML", "Manual Analysis", SBC_qa)` |
// | **AR** | SBC (qa) NEW (Final) | `AQ Value` |
// | **AS** | REMARKS | `Logic check based on soil classification` |

// ---

// ### **Section 3: Settlement Analysis (Columns AT–BW)**

// | Col | Header Name | Formula / Computational Logic |
// | --- | --- | --- |
// | **AW** | Building Load (P) - KN | *Manual Input* |
// | **BA** | Modulus of Elasticity | `α * N60` *(where α is 500 to 1000 depending on soil)* |
// | **BC** | q(gross) | `(P / B^2) + (Weight_of_Footing / B^2)` |
// | **BI** | Net Contact Pressure (qn) | `q_gross - (y * Df)` |
// | **BK** | Peak Strain Factor (Izp) | `0.5 + 0.1 * sqrt(qn / Effective_Stress_at_Df)` |
// | **BL** | Strain Influence (Iz) | `Interpolate(z, Izp, Schmertmann_Triangle)` |
// | **BN** | Correction Factor (C1) | `1 - 0.5 * (Effective_Stress_at_Df / qn)` |
// | **BP** | Correction Factor (C2) | `1 + 0.2 * LOG10(t / 0.1)` |
// | **BQ** | Elastic Settlement | `C1 * C2 * qn * (Iz / Modulus) * z2` |
// | **BT** | Volumetric Strain | `Derived from FS and Relative Density (Dr)` |
// | **BU** | Volumetric Settlement | `Volumetric_Strain * z2` |
// | **BV** | Settlement | `SUM(BQ) + SUM(BU)` |
// | **BW** | Remarks.3 | `IF(Settlement < Tolerable, "SAFE", "RE-DESIGN")` |

export interface GeotechnicalAnalysisTable {
  porePressure: string;
  totalStress: string;
  effectiveStress: string;
  cn: string;
  n160: string;
  n160_2: string;
  n160cs: string;
  m: string;
  cn_final: string;
  n160cs_final: string;
  rd: string;
  csr: string;
  msfmax: string;
  msf: string;
  ko: string;
  crr75: string;
  fs: string;
  remarks_fs: string;
  severity: string;
  weightingFactor: string;
  lpi: string;
  remarks_lpi: string;
}

export async function computeGeotechnicalAnalysis(
  parametersObject: Liquefaction,
) {
  const {listOfDepths, initialParameterTable} = parametersObject;

  const iPT = initialParameterTable;
  const gAT: GeotechnicalAnalysisTable[] = [];

  for (let i = 0; i < listOfDepths.length; i++) {
    const depth = listOfDepths[i];
    const iP = iPT[i];
    const porePressure = (await compare(`${depth} > ${iP.groundWaterLevel}`))
      ? computeString(`(${depth} - ${iP.groundWaterLevel}) * 9.81`)
      : "0";

    const totalStress =
      i === 0
        ? computeString(`${iP.depth} * ${iP.totalUnitWeight}`)
        : computeString(
            `${gAT[i - 1].totalStress} + (${depth} - ${listOfDepths[i - 1]}) * ${iP.totalUnitWeight}`,
          );

    const effectiveStress = computeString(`${totalStress} - ${porePressure}`);
    // Guard: effective stress must be positive for sqrt and log formulas.
    const effectiveStressNum = parseFloat(effectiveStress);
    const safeEffStress = Number.isFinite(effectiveStressNum) && effectiveStressNum > 0
      ? effectiveStress
      : "0.1";

    const cn = computeString(`min(1.7, sqrt(101.3 / ${safeEffStress}))`);

    const n160 = cn ? computeString(`${iP.n60} * ${cn}`) : "0";

    const n160_2 = computeString(
      `exp(1.63 + (9.7 / (${iP.finesContent} + 0.01)) - (15.7 / (${iP.finesContent} + 0.01))^2)`,
    );

    const n160cs = computeString(`${n160 || "0"} + ${n160_2 || "0"}`);

    const m = n160cs ? computeString(`0.784 - 0.0786 * sqrt(${n160cs})`) : "0.784";

    const cn_final = computeString(
      `min(1.7, (101.3 / ${safeEffStress})^${m || "0.784"})`,
    );

    const n160cs_final = computeString(`${iP.n60} * ${cn_final || "0"} + ${n160_2 || "0"}`);

    const rd = computeString(
      `exp((-1.012 - 1.126*sin((${depth}/11.73)+5.133)) + (0.106 + 0.118*sin((${depth}/11.28)+5.142))*${iP.magnitude})`,
    );

    const csr = computeString(
      `0.65 * ${iP.peakGroundAcceleration} * (${totalStress || "0"} / ${safeEffStress}) * ${rd || "0"}`,
    );

    const msfmax = computeString(
      `min(2.2, 1.09 + ((${n160cs_final || "0"})^2 / 31.5)^2)`,
    );

    const msf = computeString(
      `1 + (${msfmax || "0"} - 1) * (8.64 * exp(-${iP.magnitude}/4) - 1.325)`,
    );

    //formula for ko: =MIN(1.1, 1 - MIN(0.3, 1 / (18.9 - 2.55 * SQRT(V2))) * LN(O2 / 101.3))
    const ko = computeString(
      `min(1.1, 1 - min(0.3, 1 / (18.9 - 2.55 * sqrt(${n160cs_final || "0"}))) * log(${safeEffStress} / 101.3))`,
    );

    const crr75 = computeString(
      `exp((${n160cs_final}/14.1) + (${n160cs_final}/126)^2 - (${n160cs_final}/23.6)^3 + (${n160cs_final}/25.4)^4 - 2.8)`,
    );

    //formula for fs: =IF(X2=0, "N/A", MIN(5, (AB2 * Z2 * AA2) / X2))
    const fs =
      csr === "0"
        ? "0"
        : computeString(`min(5, (${crr75} * ${msf} * ${ko}) / ${csr})`);

    const remarks_fs = (await compare(`${fs} > 1`))
      ? "NOT LIQUEFIABLE"
      : "LIQUEFIABLE";

    //formula for severity: =IF(AC2<1, 1-AC2, 0)
    const severity = (await compare(`${fs} < 1`))
      ? computeString(`1 - ${fs}`)
      : "0";

    //formula for weighting factor: =IF(D2<=20, 10 - (0.5 * D2), 0)
    const weightingFactor = (await compare(`${depth} <= 20`))
      ? computeString(`10 - (0.5 * ${depth})`)
      : "0";

    const lpi = computeString(
      `${severity} * ${weightingFactor} * ${iP.layerThickness}`,
    );

    //formula for remarks_lpi: =IF(AG2<=0,"Very Low",IF(AND(AG2>0,AG2<=5),"Low",IF(AND(AG2>5,AG2<=15),"High","Very High")))
    const remarks_lpi = (await compare(`${lpi} <= 0`))
      ? "Very Low"
      : (await compare(`${lpi} > 0`)) && (await compare(`${lpi} <= 5`))
        ? "Low"
        : (await compare(`${lpi} > 5`)) && (await compare(`${lpi} <= 15`))
          ? "High"
          : "Very High";

    gAT.push({
      porePressure,
      totalStress,
      effectiveStress,
      cn,
      n160,
      n160_2,
      n160cs,
      m,
      cn_final,
      n160cs_final,
      rd,
      csr,
      msfmax,
      msf,
      ko,
      crr75,
      fs,
      remarks_fs,
      severity,
      weightingFactor,
      lpi,
      remarks_lpi,
    });
  }

  const totalLpi = gAT.reduce(
    (acc, curr) => computeString(`${acc} + ${curr.lpi}`),
    "0",
  );
  const totalLpi_remark = (await compare(`${totalLpi} <= 0`))
    ? "Very Low"
    : (await compare(`${totalLpi} > 0`)) && (await compare(`${totalLpi} <= 5`))
      ? "Low"
      : (await compare(`${totalLpi} > 5`)) &&
          (await compare(`${totalLpi} <= 15`))
        ? "High"
        : "Very High";

  console.log("geotechnicalAnalysisTable", gAT);

  return {
    geotechnicalAnalysisTable: gAT,
    totalLpi,
    totalLpi_remark,
  };
}

export async function computeGeotechnicalAnalysis_ForDataset(
  parametersObject: Liquefaction,
) {
  const {initialParameterTable} = parametersObject;

  const gAT: GeotechnicalAnalysisTable[] = [];

  for (let i = 0; i < initialParameterTable.length; i++) {
    const depth = initialParameterTable[i].depth;
    const iP = initialParameterTable[i];
    const porePressure = (await compare(`${depth} > ${iP.groundWaterLevel}`))
      ? computeString(`(${depth} - ${iP.groundWaterLevel}) * 9.81`)
      : "0";
    const totalStress = computeString(`${depth} * ${iP.totalUnitWeight}`);
    const effectiveStress = computeString(`${totalStress} - ${porePressure}`);
    const effectiveStressNum2 = parseFloat(effectiveStress);
    const safeEffStress2 = Number.isFinite(effectiveStressNum2) && effectiveStressNum2 > 0
      ? effectiveStress
      : "0.1";

    const cn = computeString(`min(1.7, sqrt(101.3 / ${safeEffStress2}))`);

    const n160 = cn ? computeString(`${iP.n60} * ${cn}`) : "0";

    const n160_2 = computeString(
      `exp(1.63 + (9.7 / (${iP.finesContent} + 0.01)) - (15.7 / (${iP.finesContent} + 0.01))^2)`,
    );

    const n160cs = computeString(`${n160 || "0"} + ${n160_2 || "0"}`);

    const m = n160cs ? computeString(`0.784 - 0.0786 * sqrt(${n160cs})`) : "0.784";

    const cn_final = computeString(
      `min(1.7, (101.3 / ${safeEffStress2})^${m || "0.784"})`,
    );

    const n160cs_final = computeString(`${iP.n60} * ${cn_final || "0"} + ${n160_2 || "0"}`);

    const rd = computeString(
      `exp((-1.012 - 1.126*sin((${depth}/11.73)+5.133)) + (0.106 + 0.118*sin((${depth}/11.28)+5.142))*${iP.magnitude})`,
    );

    const csr = computeString(
      `0.65 * ${iP.peakGroundAcceleration} * (${totalStress || "0"} / ${safeEffStress2}) * ${rd || "0"}`,
    );

    const msfmax = computeString(
      `min(2.2, 1.09 + ((${n160cs_final || "0"})^2 / 31.5)^2)`,
    );

    const msf = computeString(
      `1 + (${msfmax || "0"} - 1) * (8.64 * exp(-${iP.magnitude}/4) - 1.325)`,
    );

    //formula for ko: =MIN(1.1, 1 - MIN(0.3, 1 / (18.9 - 2.55 * SQRT(V2))) * LN(O2 / 101.3))
    const ko = computeString(
      `min(1.1, 1 - min(0.3, 1 / (18.9 - 2.55 * sqrt(${n160cs_final || "0"}))) * log(${safeEffStress2} / 101.3))`,
    );

    const crr75 = computeString(
      `exp((${n160cs_final || "0"}/14.1) + (${n160cs_final || "0"}/126)^2 - (${n160cs_final || "0"}/23.6)^3 + (${n160cs_final || "0"}/25.4)^4 - 2.8)`,
    );

    //formula for fs: =IF(X2=0, "N/A", MIN(5, (AB2 * Z2 * AA2) / X2))
    const fs =
      !csr || csr === "0"
        ? "0"
        : computeString(`min(5, (${crr75 || "0"} * ${msf || "0"} * ${ko || "0"}) / ${csr})`);

    const remarks_fs = (await compare(`${fs} > 1`))
      ? "NOT LIQUEFIABLE"
      : "LIQUEFIABLE";

    //formula for severity: =IF(AC2<1, 1-AC2, 0)
    const severity = (await compare(`${fs} < 1`)) ? `1 - ${fs}` : "0";

    //formula for weighting factor: =IF(D2<=20, 10 - (0.5 * D2), 0)
    const weightingFactor = (await compare(`${depth} <= 20`))
      ? computeString(`10 - (0.5 * ${depth})`)
      : "0";

    const lpi = computeString(
      `${severity} * ${weightingFactor} * ${iP.layerThickness}`,
    );

    //formula for remarks_lpi: =IF(AG2<=0,"Very Low",IF(AND(AG2>0,AG2<=5),"Low",IF(AND(AG2>5,AG2<=15),"High","Very High")))
    const remarks_lpi = (await compare(`${lpi} <= 0`))
      ? "Very Low"
      : (await compare(`${lpi} > 0 && ${lpi} <= 5`))
        ? "Low"
        : (await compare(`${lpi} > 5 && ${lpi} <= 15`))
          ? "High"
          : "Very High";

    gAT.push({
      porePressure,
      totalStress,
      effectiveStress,
      cn,
      n160,
      n160_2,
      n160cs,
      m,
      cn_final,
      n160cs_final,
      rd,
      csr,
      msfmax,
      msf,
      ko,
      crr75,
      fs,
      remarks_fs,
      severity,
      weightingFactor,
      lpi,
      remarks_lpi,
    });
  }

  const totalLpi = gAT.reduce(
    (acc, curr) => computeString(`${acc} + ${curr.lpi}`),
    "0",
  );
  const totalLpi_remark = (await compare(`${totalLpi} <= 0`))
    ? "Very Low"
    : (await compare(`${totalLpi} > 0 && ${totalLpi} <= 5`))
      ? "Low"
      : (await compare(`${totalLpi} > 5 && ${totalLpi} <= 15`))
        ? "High"
        : "Very High";

  console.log("geotechnicalAnalysisTable", gAT);

  return {
    geotechnicalAnalysisTable: gAT,
    totalLpi,
    totalLpi_remark,
  };
}

/**
 * Excel `LET` block for design-averaged N (same row geometry as the sheet):
 * `LayerBottoms = depths`, `LayerTops = depths − layerThickness`,
 * `FILTER(N_values, (LayerBottoms > Df) * (LayerTops < Df + 2*B))`,
 * then `SUM(FilteredN / i^2) / SUM(1 / i^2)` with `i = SEQUENCE(ROWS(FilteredN))` → 1…n.
 */
export function computeDesignAveragedN(
  foundationDepth: number,
  footingWidth: number,
  depths: readonly number[],
  layerThicknesses: readonly number[],
  n60s: readonly number[],
): number {
  const Df = foundationDepth;
  const B = footingWidth;
  const zoneLower = Df + 2 * B;

  const filteredN: number[] = [];
  for (let idx = 0; idx < n60s.length; idx++) {
    const layerBottom = depths[idx]!;
    const layerTop = layerBottom - layerThicknesses[idx]!;
    if (layerBottom > Df && layerTop < zoneLower) {
      filteredN.push(n60s[idx]!);
    }
  }

  if (filteredN.length === 0) return NaN;

  let sumNumerator = 0;
  let sumDenominator = 0;
  for (let k = 0; k < filteredN.length; k++) {
    const i = k + 1;
    const invI2 = 1 / (i * i);
    sumNumerator += filteredN[k]! * invI2;
    sumDenominator += invI2;
  }
  return sumNumerator / sumDenominator;
}

type InfluenceZoneType =
  | "No Soil"
  | "Rock"
  | "Cohesive"
  | "Cohesionless"
  | "Mixed";

/**
 * Same overlap window as design N / Excel `FilteredMat`: any layer with
 * bottom > Df and top < Df + 2B. Zone type matches the sheet logic but
 * uses {@link SoilTypeChoice} instead of USCS / rock name lists: any **Rock**
 * in the influence zone forces **Rock**; else all one class or **Mixed**.
 */
export function classifyInfluenceZoneSoilTypes(
  foundationDepth: number,
  footingWidth: number,
  depths: readonly number[],
  layerThicknesses: readonly number[],
  soilTypes: readonly SoilTypeChoice[],
): InfluenceZoneType {
  const Df = foundationDepth;
  const B = footingWidth;
  const zoneLower = Df + 2 * B;

  const filtered: SoilTypeChoice[] = [];
  for (let i = 0; i < soilTypes.length; i++) {
    const layerBottom = depths[i]!;
    const layerTop = layerBottom - layerThicknesses[i]!;
    if (layerBottom > Df && layerTop < zoneLower) {
      filtered.push(soilTypes[i]!);
    }
  }

  if (filtered.length === 0) {
    return "No Soil";
  }
  if (filtered.some((m) => m === "Rock")) {
    return "Rock";
  }

  const total = filtered.length;
  const cohesive = filtered.filter((m) => m === "Cohesive").length;
  const cohesionless = filtered.filter((m) => m === "Cohesionless").length;
  if (cohesive === total) return "Cohesive";
  if (cohesionless === total) return "Cohesionless";
  return "Mixed";
}

function computeQaCohesiveNumeric(nDesign: number, nc: string): number {
  return compute(`2 * ${nDesign} * (${nc})`);
}

function computeQaCohesionlessNumeric(
  footingWidth: number,
  nMeyerhof: number,
  depthFactor: string,
  settlement: number,
): number {
  const B = footingWidth;
  if (B <= 1.2) {
    return compute(
      `12 * ${nMeyerhof} * (${depthFactor}) * (${settlement} / 25.4)`,
    );
  }
  return compute(
    `8 * ${nMeyerhof} * ((3.28 * ${B} + 1) / (3.28 * ${B}))^2 * (${depthFactor}) * (${settlement} / 25.4)`,
  );
}

/**
 * Excel `LET` for `sbc_qa_new` with **SoilTypeChoice** zones: overlap filter,
 * rock / cohesive / cohesionless / mixed, then bearing branch or N/A / manual.
 */
export function computeSbcQaNew(
  foundationDepth: number,
  footingWidth: number,
  settlement: number,
  nMeyerhof: number,
  nDesign: number,
  nc: string,
  depthFactor: string,
  depths: readonly number[],
  layerThicknesses: readonly number[],
  soilTypes: readonly SoilTypeChoice[],
): number | string {
  const zone = classifyInfluenceZoneSoilTypes(
    foundationDepth,
    footingWidth,
    depths,
    layerThicknesses,
    soilTypes,
  );

  if (zone === "No Soil") {
    return "No Soil";
  }
  if (zone === "Rock") {
    return SBC_QA_NEW_ROCK_MESSAGE;
  }
  if (zone === "Cohesive") {
    return computeQaCohesiveNumeric(nDesign, nc);
  }
  const qaCohesionless = computeQaCohesionlessNumeric(
    footingWidth,
    nMeyerhof,
    depthFactor,
    settlement,
  );
  if (zone === "Mixed") {
    return Math.min(computeQaCohesiveNumeric(nDesign, nc), qaCohesionless);
  }
  return qaCohesionless;
}

/**
 * Excel `remarks_sbc` LET: after computing Qa cohesive / cohesionless, pick
 * rock N/A, single-mode Qa, `MIN` for mixed, or `"Invalid Data"` for no soil.
 */
export function computeRemarksSbc(
  foundationDepth: number,
  footingWidth: number,
  settlement: number,
  nMeyerhof: number,
  nDesign: number,
  nc: string,
  depthFactor: string,
  depths: readonly number[],
  layerThicknesses: readonly number[],
  soilTypes: readonly SoilTypeChoice[],
): string {
  const zone = classifyInfluenceZoneSoilTypes(
    foundationDepth,
    footingWidth,
    depths,
    layerThicknesses,
    soilTypes,
  );

  const qaCohesive = computeQaCohesiveNumeric(nDesign, nc);
  const qaCohesionless = computeQaCohesionlessNumeric(
    footingWidth,
    nMeyerhof,
    depthFactor,
    settlement,
  );

  const formatQa = (v: number) =>
    Number.isFinite(v) ? String(v) : "Invalid Data";

  if (zone === "Rock") {
    return SBC_QA_NEW_ROCK_MESSAGE;
  }
  if (zone === "Cohesive") return formatQa(qaCohesive);
  if (zone === "Cohesionless") return formatQa(qaCohesionless);
  if (zone === "Mixed") return formatQa(Math.min(qaCohesive, qaCohesionless));
  return "Invalid Data";
}

export type FootingWidthIterationDataType = {
  foundationDepthM: number;
  footingWidth: number;
  tolerableSettlement: string;
  depthFactor: string;
  n: number;
  n_design: number;
  nc: string;
  sbc_qa: string;
  sbc_qa_new: number | string;
  remarks_sbc: string;
  settlementAnalysisTable: SettlementAnalysisTableType[];
  totalSettlement: string;
  remarks_settlement: string;
};

export interface SettlementAnalysisTableType {
  latitude: number;
  longitude: number;
  depthOfSoil: number;
  buildingLoad: number;
  Width_B: number;
  unitWeight: string;
  sptNValue: string;
  modulusOfElasticity: string;
  weightOfFooting: string;
  q_gross: string;
  depthOfFooting: string;
  groundWaterLevel: string;
  porewaterAtFoundationLevel: string;
  effectiveOverburdenPressureAtFoundationLevel: string;
  netFoundationContactPressure: string;
  Po: string;
  peakStrainInfluenceFactor: string;
  strainInfluenceFactor: string;
  layerThickness: string;
  correctionFactorC1: string;
  elapsedTimeInYears: string;
  correctionFactorC2: string;
  elasticSettlement: string;
  fs: string;
  remarks_fs: string;
  volumetricStrain: string;
  volumetricSettlement: string;
  settlement: string;
}

export async function iterateFootingWidths(parametersObject: Liquefaction, signal?: AbortSignal) {
  const {foundationDepth: userFoundationDepth, initialParameterTable, geotechnicalAnalysisTable} =
    parametersObject;

  const listOfN60s = initialParameterTable.map((item) => item.n60);
  const listOfListOfDepths = initialParameterTable.map((item) => item.depth);
  const listOfLayerThicknesses = initialParameterTable.map(
    (item) => item.layerThickness,
  );
  const listOfSoilTypes = initialParameterTable.map((item) => item.soilType);

  // Try the user's Df first, then 0.5 → 5.0 m in 0.5 m steps.
  const dfCandidates = [
    userFoundationDepth,
    ...Array.from({length: 10}, (_, i) => Math.round((0.5 + i * 0.5) * 10) / 10).filter(
      (d) => d !== userFoundationDepth,
    ),
  ];

  const footingWidthIterationData: FootingWidthIterationDataType[] = [];
  const footingWidthStart = 1;
  const footingWidthEnd = 4;
  const footingWidthStep = 0.1;
  let finalFootingWidthIterationPassedData: FootingWidthIterationDataType | null = null;

  outer: for (const foundationDepth of dfCandidates) {
    // Yield to the event loop between Df candidates so the browser stays responsive
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) break outer;
    for (
      let footingWidth = footingWidthStart;
      footingWidth <= footingWidthEnd;
      footingWidth += footingWidthStep
    ) {
      if (signal?.aborted) break outer;
      const TOLERABLE = 25;
      const B = footingWidth;
      const Df = foundationDepth;

      const depthFactorNum = Math.min(1.33, 1 + 0.33 * (Df / B));

      const n = averageIfs(
        listOfN60s,
        [listOfListOfDepths, `>${Df}`],
        [listOfListOfDepths, `<${Df + B + 1.5}`],
      );
      if (!Number.isFinite(n)) continue;

      const n_design = computeDesignAveragedN(
        Df, B, listOfListOfDepths, listOfLayerThicknesses, listOfN60s,
      );
      const ncNum = Math.min(9, 6 * (1 + 0.2 * (Df / B)));
      const sbc_qa_num = B <= 1.2
        ? 12 * n * depthFactorNum * (TOLERABLE / 25.4)
        : 8 * n * Math.pow((3.28 * B + 1) / (3.28 * B), 2) * depthFactorNum * (TOLERABLE / 25.4);

      const depthFactor = depthFactorNum.toString();
      const nc = ncNum.toString();
      const sbc_qa = sbc_qa_num.toString();

      const sbc_qa_new = computeSbcQaNew(
        Df, B, TOLERABLE, n, n_design, nc, depthFactor,
        listOfListOfDepths, listOfLayerThicknesses, listOfSoilTypes,
      );
      const remarks_sbc = computeRemarksSbc(
        Df, B, TOLERABLE, n, n_design, nc, depthFactor,
        listOfListOfDepths, listOfLayerThicknesses, listOfSoilTypes,
      );

      const buildingLoadNum = parametersObject.buildingLoad;
      const tNum = parametersObject.elapsedTimeInYears;
      const weightOfFootingNum = buildingLoadNum * 0.1;
      const q_grossNum = (buildingLoadNum + weightOfFootingNum) / (B * B);
      const C2num = 1 + 0.2 * Math.log10(10 * tNum);

      const settlementAnalysisTable: SettlementAnalysisTableType[] = [];
      let totalSettlementNum = 0;

      for (let i = 0; i < initialParameterTable.length; i++) {
        const iP = initialParameterTable[i]!;
        const depthOfSoil = iP.depth;
        const gwl = iP.groundWaterLevel;

        const porewaterNum = Math.max(0, 9.81 * (Df - gwl));
        const effectiveOverburdenNum = Df * iP.totalUnitWeight - porewaterNum;
        const qnNum = q_grossNum - effectiveOverburdenNum;
        const PoNum = iP.totalUnitWeight * (Df + B / 2) - porewaterNum;
        const izpNum = 0.5 + 0.1 * Math.sqrt(qnNum / (PoNum || 1));
        const safeIzp = Number.isFinite(izpNum) ? izpNum : 0;

        const previousDepth = i > 0 ? initialParameterTable[i - 1]!.depth : 0;
        const x = i === 0
          ? depthOfSoil - depthOfSoil / 2 - Df
          : depthOfSoil - (depthOfSoil - previousDepth) / 2 - Df;

        let izNum: number;
        if (x <= 0 || x > 2 * B) {
          izNum = 0;
        } else if (x <= B / 2) {
          izNum = ((2 * x) / B) * (safeIzp - 0.1) + 0.1;
        } else {
          izNum = ((2 * B - x) / (1.5 * B)) * safeIzp;
        }

        const C1num = Math.max(0.5, 1 - 0.5 * (effectiveOverburdenNum / (qnNum || 1)));
        const esNum = (qnNum / ((iP.modulusOfElasticity || 1) * 1000)) * izNum * iP.layerThickness * C1num * C2num * 1000;

        const fsNum = parseFloat(geotechnicalAnalysisTable[i]!.fs);
        const vsNum = depthOfSoil > 2 * B || fsNum >= 2 ? 0
          : fsNum <= 0.5 ? 0.05
          : (2 - fsNum) * 0.025;
        const vsSettlementNum = vsNum * iP.layerThickness * 1000;

        totalSettlementNum += parametersObject.siteIsLiquefiable
          ? esNum + vsSettlementNum
          : esNum;

        settlementAnalysisTable.push({
          latitude: parametersObject.latitude,
          longitude: parametersObject.longitude,
          depthOfSoil,
          buildingLoad: buildingLoadNum,
          Width_B: B,
          unitWeight: iP.totalUnitWeight.toString(),
          sptNValue: iP.n60.toString(),
          modulusOfElasticity: iP.modulusOfElasticity.toString(),
          weightOfFooting: weightOfFootingNum.toString(),
          q_gross: q_grossNum.toString(),
          depthOfFooting: Df.toString(),
          groundWaterLevel: gwl.toString(),
          porewaterAtFoundationLevel: porewaterNum.toString(),
          effectiveOverburdenPressureAtFoundationLevel: effectiveOverburdenNum.toString(),
          netFoundationContactPressure: qnNum.toString(),
          Po: PoNum.toString(),
          peakStrainInfluenceFactor: safeIzp.toString(),
          strainInfluenceFactor: izNum.toString(),
          layerThickness: iP.layerThickness.toString(),
          correctionFactorC1: C1num.toString(),
          elapsedTimeInYears: tNum.toString(),
          correctionFactorC2: C2num.toString(),
          elasticSettlement: esNum.toString(),
          fs: geotechnicalAnalysisTable[i]!.fs,
          remarks_fs: geotechnicalAnalysisTable[i]!.remarks_fs,
          volumetricStrain: vsNum.toString(),
          volumetricSettlement: vsSettlementNum.toString(),
          settlement: (esNum + vsSettlementNum).toString(),
        });
      }

      const totalSettlement = totalSettlementNum.toString();
      const tolerableSettlement = TOLERABLE.toString();
      const remarks_settlement = totalSettlementNum <= TOLERABLE ? "PASSED" : "FAILED";

      const iterationRow: FootingWidthIterationDataType = {
        foundationDepthM: foundationDepth,
        footingWidth,
        tolerableSettlement,
        depthFactor,
        n,
        n_design,
        nc,
        sbc_qa,
        sbc_qa_new,
        remarks_sbc,
        settlementAnalysisTable,
        totalSettlement,
        remarks_settlement,
      };
      footingWidthIterationData.push(iterationRow);

      if (remarks_settlement === "PASSED") {
        finalFootingWidthIterationPassedData = iterationRow;
        break outer;
      }
    }
  }

  const passed = Boolean(finalFootingWidthIterationPassedData);


  return {
    footingWidthIterationData,
    finalFootingWidthIterationPassedData,
    passed,
  };
}

/** True if any iterated footing row has rock in the SBC qₐ (new) branch. */
export function footingIterationRowsIncludeRockSbcQa(
  rows: FootingWidthIterationDataType[],
): boolean {
  return rows.some((row) => row.sbc_qa_new === SBC_QA_NEW_ROCK_MESSAGE);
}

/**
 * If rock appears in the influence zone for any footing-width trial, ΣLPI is
 * taken as zero (liquefaction index not applicable for rock-controlled bearing).
 */
export function applyZeroLpiIfFootingIterationsIncludeRock(
  model: Liquefaction,
): void {
  if (!footingIterationRowsIncludeRockSbcQa(model.footingWidthIterationData)) {
    return;
  }
  model.totalLpi = "0";
  model.totalLpi_remark = "Very Low";
}

// --------------------------------------------

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function normalizeDatasetSoilType(soilType: string): SoilTypeChoice {
  const t = soilType.trim().toUpperCase();
  if (
    t.includes("ROCK") ||
    t.includes("CORING") ||
    t.includes("SANDSTONE") ||
    t.includes("TUFF") ||
    t.includes("GRAVEL")
  ) {
    return "Rock";
  }
  if (
    t.startsWith("CH") ||
    t.startsWith("CL") ||
    t.startsWith("MH") ||
    t.startsWith("ML") ||
    t.startsWith("OH") ||
    t.startsWith("OL") ||
    t.startsWith("CM")
  ) {
    return "Cohesive";
  }
  return "Cohesionless";
}

export type BoreholeMapResult = {
  boreholeId: string;
  latitude: number;
  longitude: number;
  totalLpi: number | null;
  remark_lpi: string;
  geotechnicalAnalysisTable: GeotechnicalAnalysisTable[];
};

export type BoreholeComputeProgress = {
  completed: number;
  total: number;
  percent: number;
};

export type ComputeBoreholesOptions = {
  onProgress?: (progress: BoreholeComputeProgress) => void;
  signal?: AbortSignal;
  maxWorkers?: number;
  chunkSize?: number;
  boreholes?: DatasetBorehole[];
};

export function initializeParameterTable_ForDataset(
  borehole: DatasetBorehole,
  earthquakeMagnitude = 7,
): {
  initialParameterTable: initialParameterTableType[];
  listOfDepths: number[];
} {
  if (
    !isFiniteNumber(borehole.latitude) ||
    !isFiniteNumber(borehole.longitude)
  ) {
    return {initialParameterTable: [], listOfDepths: []};
  }

  const sortedDepthRows = [...borehole.depthRows].sort((a, b) => {
    if (a.depthOfSoil === null && b.depthOfSoil === null) return 0;
    if (a.depthOfSoil === null) return 1;
    if (b.depthOfSoil === null) return -1;
    return a.depthOfSoil - b.depthOfSoil;
  });

  const initialParameterTable: initialParameterTableType[] = [];
  let previousDepth = 0;

  for (const row of sortedDepthRows) {
    if (
      !isFiniteNumber(row.depthOfSoil) ||
      !isFiniteNumber(row.totalUnitWeight) ||
      !isFiniteNumber(row.n60) ||
      !isFiniteNumber(row.finesContent) ||
      !isFiniteNumber(row.peakGroundAcceleration) ||
      !isFiniteNumber(row.groundWaterLevel)
    ) {
      continue;
    }

    const layerThickness = row.depthOfSoil - previousDepth;
    if (!Number.isFinite(layerThickness) || layerThickness <= 0) continue;

    initialParameterTable.push({
      latitude: borehole.latitude,
      longitude: borehole.longitude,
      depth: row.depthOfSoil,
      layerThickness,
      totalUnitWeight: row.totalUnitWeight,
      n60: row.n60,
      finesContent: row.finesContent,
      magnitude: earthquakeMagnitude,
      peakGroundAcceleration: row.peakGroundAcceleration,
      groundWaterLevel: row.groundWaterLevel,
      soilType: normalizeDatasetSoilType(row.soilType),
      modulusOfElasticity: row.modulusOfElasticity ?? 0,
    });
    previousDepth = row.depthOfSoil;
  }

  return {
    initialParameterTable,
    listOfDepths: initialParameterTable.map((r) => r.depth),
  };
}

export async function computeGeotechnicalForDatasetBorehole(
  boreholeRecord: DatasetBorehole,
  earthquakeMagnitude = 7,
): Promise<BoreholeMapResult | null> {
  if (
    !isFiniteNumber(boreholeRecord.latitude) ||
    !isFiniteNumber(boreholeRecord.longitude)
  ) {
    return null;
  }

  const liquefaction = new Liquefaction();
  liquefaction.latitude = boreholeRecord.latitude;
  liquefaction.longitude = boreholeRecord.longitude;
  liquefaction.earthquakeMagnitude = earthquakeMagnitude;

  const {initialParameterTable, listOfDepths} =
    initializeParameterTable_ForDataset(boreholeRecord, earthquakeMagnitude);
  if (initialParameterTable.length === 0) return null;

  liquefaction.initialParameterTable = initialParameterTable;
  liquefaction.listOfDepths = listOfDepths;

  const geo = await computeGeotechnicalAnalysis(liquefaction);
  const totalLpiAsNumber = Number.parseFloat(geo.totalLpi);
  return {
    boreholeId: boreholeRecord.boreholeId,
    latitude: boreholeRecord.latitude,
    longitude: boreholeRecord.longitude,
    totalLpi: Number.isFinite(totalLpiAsNumber) ? totalLpiAsNumber : null,
    remark_lpi: geo.totalLpi_remark,
    geotechnicalAnalysisTable: geo.geotechnicalAnalysisTable,
  };
}

function chunkBoreholes(
  boreholes: DatasetBorehole[],
  chunkSize: number,
): DatasetBorehole[][] {
  const chunks: DatasetBorehole[][] = [];
  for (let i = 0; i < boreholes.length; i += chunkSize) {
    chunks.push(boreholes.slice(i, i + chunkSize));
  }
  return chunks;
}

function createAbortError(): Error {
  return new DOMException("Borehole computation was aborted.", "AbortError");
}

export async function computeGeotechnicalForAllBoreholes(
  earthquakeMagnitude = 7,
  options?: ComputeBoreholesOptions,
): Promise<BoreholeMapResult[]> {
  const boreholeSrc =
    options?.boreholes && options.boreholes.length > 0
      ? options.boreholes
      : datasetBoreholes;
  const filteredBoreholes = boreholeSrc.filter(
    (borehole) =>
      isFiniteNumber(borehole.latitude) && isFiniteNumber(borehole.longitude),
  );
  const total = filteredBoreholes.length;
  let completed = 0;
  options?.onProgress?.({completed, total, percent: total === 0 ? 100 : 0});

  if (options?.signal?.aborted) throw createAbortError();

  const results: BoreholeMapResult[] = [];
  for (const boreholeRecord of filteredBoreholes) {
    if (options?.signal?.aborted) throw createAbortError();
    const result = await computeGeotechnicalForDatasetBorehole(
      boreholeRecord,
      earthquakeMagnitude,
    );
    if (result) results.push(result);
    completed += 1;
    options?.onProgress?.({
      completed,
      total,
      percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    });
    if (completed % 8 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}

type WorkerProgressMessage = {
  type: "progress";
  requestId: string;
  processed: number;
  total: number;
};
type WorkerResultMessage = {
  type: "result";
  requestId: string;
  results: BoreholeMapResult[];
};
type WorkerErrorMessage = {
  type: "error";
  requestId: string;
  message: string;
};
type WorkerMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

export async function computeGeotechnicalForAllBoreholesParallel(
  earthquakeMagnitude = 7,
  options?: ComputeBoreholesOptions,
): Promise<BoreholeMapResult[]> {
  const boreholeSrc =
    options?.boreholes && options.boreholes.length > 0
      ? options.boreholes
      : datasetBoreholes;
  const filteredBoreholes = boreholeSrc.filter(
    (borehole) =>
      isFiniteNumber(borehole.latitude) && isFiniteNumber(borehole.longitude),
  );
  const total = filteredBoreholes.length;
  if (total === 0) {
    options?.onProgress?.({completed: 0, total: 0, percent: 100});
    return [];
  }
  if (options?.signal?.aborted) throw createAbortError();
  if (typeof Worker === "undefined") {
    return computeGeotechnicalForAllBoreholes(earthquakeMagnitude, options);
  }

  const maxWorkers = Math.max(
    1,
    options?.maxWorkers ??
      Math.min(
        Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 4) - 1),
        6,
      ),
  );
  const chunkSize = Math.max(
    1,
    options?.chunkSize ?? Math.ceil(total / Math.max(1, maxWorkers * 2)),
  );
  const chunks = chunkBoreholes(filteredBoreholes, chunkSize);
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workerCount = Math.min(maxWorkers, chunks.length);
  const workers: Worker[] = [];
  const resultMap = new Map<string, BoreholeMapResult>();
  /** Per worker slot: finished chunks (cumulative) + current chunk in-flight count. */
  type SlotProgress = {finishedBoreholes: number; inChunk: number};
  const slotProgress = new Map<number, SlotProgress>();
  let nextChunkIndex = 0;
  let runningWorkers = 0;
  let settled = false;

  const terminateAll = () => {
    for (const worker of workers) {
      worker.terminate();
    }
  };
  const emitProgress = () => {
    const completed = Array.from(slotProgress.values()).reduce(
      (acc, slot) => acc + slot.finishedBoreholes + slot.inChunk,
      0,
    );
    options?.onProgress?.({
      completed: Math.min(total, completed),
      total,
      percent: Math.min(
        100,
        Math.round((Math.min(total, completed) / total) * 100),
      ),
    });
  };

  return await new Promise<BoreholeMapResult[]>((resolve, reject) => {
    const onAbort = () => {
      if (settled) return;
      settled = true;
      terminateAll();
      reject(createAbortError());
    };
    options?.signal?.addEventListener("abort", onAbort, {once: true});

    const startWorker = (workerSlot: number) => {
      if (settled) return;
      const chunk = chunks[nextChunkIndex];
      nextChunkIndex += 1;
      if (!chunk) return;

      const worker = new Worker(
        new URL("../workers/boreholeCompute.worker.ts", import.meta.url),
        {type: "module"},
      );
      workers.push(worker);
      runningWorkers += 1;
      const prevSlot = slotProgress.get(workerSlot) ?? {
        finishedBoreholes: 0,
        inChunk: 0,
      };
      slotProgress.set(workerSlot, {
        finishedBoreholes: prevSlot.finishedBoreholes,
        inChunk: 0,
      });

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.requestId !== requestId || settled) return;
        if (message.type === "progress") {
          const slot = slotProgress.get(workerSlot) ?? {
            finishedBoreholes: 0,
            inChunk: 0,
          };
          slotProgress.set(workerSlot, {
            ...slot,
            inChunk: message.processed,
          });
          emitProgress();
          return;
        }
        if (message.type === "error") {
          settled = true;
          terminateAll();
          options?.signal?.removeEventListener("abort", onAbort);
          reject(new Error(message.message));
          return;
        }

        for (const item of message.results) {
          resultMap.set(item.boreholeId, item);
        }
        const doneSlot = slotProgress.get(workerSlot) ?? {
          finishedBoreholes: 0,
          inChunk: 0,
        };
        slotProgress.set(workerSlot, {
          finishedBoreholes: doneSlot.finishedBoreholes + chunk.length,
          inChunk: 0,
        });
        emitProgress();
        runningWorkers -= 1;
        worker.terminate();

        if (nextChunkIndex < chunks.length) {
          startWorker(workerSlot);
          return;
        }
        if (runningWorkers === 0) {
          settled = true;
          options?.signal?.removeEventListener("abort", onAbort);
          const ordered = filteredBoreholes
            .map((borehole) => resultMap.get(borehole.boreholeId))
            .filter((item): item is BoreholeMapResult => Boolean(item));
          resolve(ordered);
        }
      };

      worker.onerror = (error) => {
        if (settled) return;
        settled = true;
        terminateAll();
        options?.signal?.removeEventListener("abort", onAbort);
        reject(new Error(error.message || "Borehole compute worker failed."));
      };

      worker.postMessage({
        requestId,
        boreholes: chunk,
        earthquakeMagnitude,
      });
    };

    for (let i = 0; i < workerCount; i++) {
      startWorker(i);
    }
  });
}

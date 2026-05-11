import {haversineDistanceKm} from "./geo";

/** Boreholes beyond this distance (km) are ignored for neighborhood LPI. */
export const NEIGHBOR_CALIBRATION_MAX_RADIUS_KM = 5;

/**
 * Each borehole ΣLPI is clamped before IDW so bad/outlier values cannot
 * dominate (e.g. unphysical totals in the dataset).
 */
export const NEIGHBOR_LPI_PER_BOREHOLE_CAP = 22;

/** Upper bound on the blended ΣLPI shown after calibration. */
export const NEIGHBOR_DISPLAY_LPI_CAP = 25;

/**
 * How much weight neighbors get vs the site model: blended =
 * (1 - α) × model + α × neighborIdw (capped inputs).
 */
export const NEIGHBOR_BLEND_WEIGHT = 0.52;

/**
 * If a borehole tagged High / Very High on the map lies within this distance
 * (km) of the site, the displayed hazard is at least that band (so dense
 * high-risk holes next to the pin are not washed out by the blend).
 */
export const NEIGHBOR_PROXIMITY_HIGH_RISK_KM = 0.4;

/** IDW exponent; 1 is gentler than 2 (less dominance by the nearest hole). */
export const NEIGHBOR_CALIBRATION_IDW_POWER = 1;

/** Stabilizes weights at d≈0 without letting one borehole overwhelm IDW. */
export const NEIGHBOR_CALIBRATION_DIST_EPS_KM = 0.12;

export const NEIGHBOR_CALIBRATION_RADIUS_METERS =
  NEIGHBOR_CALIBRATION_MAX_RADIUS_KM * 1000;

const HAZARD_ORDER = ["Very Low", "Low", "High", "Very High"] as const;
export type LpiHazardRemark = (typeof HAZARD_ORDER)[number];

export function lpiHazardLabelFromSum(sum: number): LpiHazardRemark {
  if (!Number.isFinite(sum) || sum <= 0) return "Very Low";
  if (sum <= 5) return "Low";
  if (sum <= 15) return "High";
  return "Very High";
}

export function remarkOrdinalRank(remark: string): number {
  const idx = HAZARD_ORDER.indexOf(remark as LpiHazardRemark);
  return idx >= 0 ? idx : 0;
}

/** Pick the highest LPI hazard band among the given remarks. */
export function maxHazardRemark(...remarks: string[]): LpiHazardRemark {
  let best: LpiHazardRemark = "Very Low";
  let bestR = -1;
  for (const r of remarks) {
    const rk = remarkOrdinalRank(r);
    if (rk > bestR) {
      bestR = rk;
      best = HAZARD_ORDER[rk]!;
    }
  }
  return best;
}

export type BoreholeLpiPoint = {
  latitude: number;
  longitude: number;
  totalLpi: number | null;
  /** Map / dataset hazard tag (e.g. from `BoreholeMapResult.remark_lpi`). */
  remarkLpi?: string | null;
};

export type NeighborLpiCalibrationInput = {
  siteLat: number;
  siteLng: number;
  boreholes: BoreholeLpiPoint[];
  modelLpi: number | null;
  /** Band from the site model (e.g. `analysis.totalLpi_remark` or derived from ΣLPI). */
  modelRemark: string;
};

export type NeighborLpiCalibrationResult = {
  neighborCount: number;
  neighborLpiIdw: number | null;
  displayLpiSum: number | null;
  displayRemark: LpiHazardRemark | "—";
  modelLpi: number | null;
  modelRemark: string;
  isCalibrated: boolean;
};

export function calibrateLpiFromNeighbors(
  input: NeighborLpiCalibrationInput,
  options?: {
    maxRadiusKm?: number;
    idwPower?: number;
    distanceEpsilonKm?: number;
    blendWeight?: number;
    displayLpiCap?: number;
    perBoreholeLpiCap?: number;
    proximityHighRiskKm?: number;
  },
): NeighborLpiCalibrationResult {
  const maxR = options?.maxRadiusKm ?? NEIGHBOR_CALIBRATION_MAX_RADIUS_KM;
  const p = options?.idwPower ?? NEIGHBOR_CALIBRATION_IDW_POWER;
  const eps = options?.distanceEpsilonKm ?? NEIGHBOR_CALIBRATION_DIST_EPS_KM;
  const blendW = options?.blendWeight ?? NEIGHBOR_BLEND_WEIGHT;
  const displayCap = options?.displayLpiCap ?? NEIGHBOR_DISPLAY_LPI_CAP;
  const lpiCap = options?.perBoreholeLpiCap ?? NEIGHBOR_LPI_PER_BOREHOLE_CAP;
  const proximityKm =
    options?.proximityHighRiskKm ?? NEIGHBOR_PROXIMITY_HIGH_RISK_KM;

  const {siteLat, siteLng, boreholes, modelLpi, modelRemark} = input;

  const inRange: {distKm: number; lpi: number}[] = [];
  for (const b of boreholes) {
    if (!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) continue;
    if (b.totalLpi === null || !Number.isFinite(b.totalLpi)) continue;
    const distKm = haversineDistanceKm(
      siteLat,
      siteLng,
      b.latitude,
      b.longitude,
    );
    if (distKm <= maxR) {
      const lpiClamped = Math.max(0, Math.min(b.totalLpi, lpiCap));
      inRange.push({distKm, lpi: lpiClamped});
    }
  }

  const neighborCount = inRange.length;

  let neighborLpiIdw: number | null = null;
  if (neighborCount > 0) {
    let wSum = 0;
    let weighted = 0;
    for (const {distKm, lpi} of inRange) {
      const w = 1 / Math.pow(distKm + eps, p);
      wSum += w;
      weighted += w * lpi;
    }
    neighborLpiIdw = weighted / wSum;
  }

  if (modelLpi === null || !Number.isFinite(modelLpi)) {
    return {
      neighborCount,
      neighborLpiIdw,
      displayLpiSum: null,
      displayRemark: "—",
      modelLpi,
      modelRemark,
      isCalibrated: false,
    };
  }

  if (neighborLpiIdw === null) {
    const band = normalizeModelRemark(modelRemark, modelLpi);
    return {
      neighborCount,
      neighborLpiIdw: null,
      displayLpiSum: modelLpi,
      displayRemark: band,
      modelLpi,
      modelRemark,
      isCalibrated: false,
    };
  }

  const modelBand = normalizeModelRemark(modelRemark, modelLpi);
  const blended =
    (1 - blendW) * modelLpi + blendW * neighborLpiIdw;
  let displayLpiSum = Math.min(
    Math.max(0, blended),
    displayCap,
  );
  let displayRemark = lpiHazardLabelFromSum(displayLpiSum);

  const proximityFloor = proximityHighHazardFromTaggedNeighbors(
    siteLat,
    siteLng,
    boreholes,
    proximityKm,
  );
  if (proximityFloor) {
    displayRemark = maxHazardRemark(displayRemark, proximityFloor);
    displayLpiSum = Math.min(
      displayCap,
      Math.max(displayLpiSum, minLpiForHazardBand(displayRemark)),
    );
  }

  const isCalibrated =
    displayRemark !== modelBand ||
    Math.abs(displayLpiSum - modelLpi) > 1e-9;

  return {
    neighborCount,
    neighborLpiIdw,
    displayLpiSum,
    displayRemark,
    modelLpi,
    modelRemark,
    isCalibrated,
  };
}

/** Minimum ΣLPI that still maps to `lpiHazardLabelFromSum` for that band. */
export function minLpiForHazardBand(band: LpiHazardRemark): number {
  if (band === "Very High") return 15.01;
  if (band === "High") return 5.01;
  if (band === "Low") return 0.01;
  return 0;
}

/**
 * Strongest High / Very High map tag among boreholes within `maxDistKm` of
 * the site (for proximity-based hazard flooring).
 */
export function proximityHighHazardFromTaggedNeighbors(
  siteLat: number,
  siteLng: number,
  boreholes: BoreholeLpiPoint[],
  maxDistKm: number,
): LpiHazardRemark | null {
  let floor: LpiHazardRemark | null = null;
  for (const b of boreholes) {
    if (!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) {
      continue;
    }
    const distKm = haversineDistanceKm(
      siteLat,
      siteLng,
      b.latitude,
      b.longitude,
    );
    if (distKm > maxDistKm) continue;

    const tag = normalizeMapRemark(b.remarkLpi);
    if (tag === "High" || tag === "Very High") {
      floor = floor ? maxHazardRemark(floor, tag) : tag;
    }
  }
  return floor;
}

function normalizeMapRemark(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim();
  if (t === "High" || t === "Very High") return t;
  return null;
}

function normalizeModelRemark(
  modelRemark: string,
  modelLpi: number,
): LpiHazardRemark {
  const t = modelRemark.trim();
  if (HAZARD_ORDER.includes(t as LpiHazardRemark)) {
    return t as LpiHazardRemark;
  }
  return lpiHazardLabelFromSum(modelLpi);
}

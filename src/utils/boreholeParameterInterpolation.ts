import type {SoilTypeChoice} from "../computation/liquefactionComputations";
import type {DatasetBorehole} from "./constants/datasetBoreholes.type";
import {haversineDistanceKm} from "./geo";
import {NEIGHBOR_CALIBRATION_MAX_RADIUS_KM} from "./neighborLpiCalibration";

/** Standard profile depths (m), aligned with POST /predict `runModel` grid. */
export const INTERPOLATED_PROFILE_DEPTHS_M = [
  1.5, 3.0, 4.5, 6.0, 7.5, 9.0, 10.5, 12.0, 13.5, 15.0,
] as const;

const IDW_POWER = 1;
const IDW_DIST_EPS_KM = 0.12;

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

function isFiniteNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function rowIsUsableForVerticalInterp(row: DatasetBorehole["depthRows"][0]): boolean {
  return (
    isFiniteNumber(row.depthOfSoil) &&
    isFiniteNumber(row.totalUnitWeight) &&
    isFiniteNumber(row.n60) &&
    isFiniteNumber(row.finesContent) &&
    isFiniteNumber(row.peakGroundAcceleration) &&
    isFiniteNumber(row.groundWaterLevel)
  );
}

export function boreholeHasInterpDepthRows(borehole: DatasetBorehole): boolean {
  return borehole.depthRows.some((r) => rowIsUsableForVerticalInterp(r));
}

type VerticalSample = {
  totalUnitWeight: number;
  n60: number;
  finesContent: number;
  peakGroundAcceleration: number;
  groundWaterLevel: number;
  modulusOfElasticity: number;
  soilCategory: SoilTypeChoice;
};

/**
 * Linear interpolation of numeric fields vs depth; soil class from the
 * bounding anchor closest to `targetDepthM`.
 */
function sampleBoreholeAtDepth(
  borehole: DatasetBorehole,
  targetDepthM: number,
): VerticalSample | null {
  const rows = [...borehole.depthRows]
    .filter(rowIsUsableForVerticalInterp)
    .sort((a, b) => (a.depthOfSoil ?? 0) - (b.depthOfSoil ?? 0));
  if (rows.length === 0) return null;

  const z = targetDepthM;
  const z0 = rows[0]!.depthOfSoil!;
  if (z <= z0) {
    const r = rows[0]!;
    return {
      totalUnitWeight: r.totalUnitWeight!,
      n60: r.n60!,
      finesContent: r.finesContent!,
      peakGroundAcceleration: r.peakGroundAcceleration!,
      groundWaterLevel: r.groundWaterLevel!,
      modulusOfElasticity: r.modulusOfElasticity ?? 0,
      soilCategory: normalizeDatasetSoilType(r.soilType),
    };
  }

  const zLast = rows[rows.length - 1]!.depthOfSoil!;
  if (z >= zLast) {
    const r = rows[rows.length - 1]!;
    return {
      totalUnitWeight: r.totalUnitWeight!,
      n60: r.n60!,
      finesContent: r.finesContent!,
      peakGroundAcceleration: r.peakGroundAcceleration!,
      groundWaterLevel: r.groundWaterLevel!,
      modulusOfElasticity: r.modulusOfElasticity ?? 0,
      soilCategory: normalizeDatasetSoilType(r.soilType),
    };
  }

  let lo = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!.depthOfSoil!;
    const b = rows[i + 1]!.depthOfSoil!;
    if (z >= a && z <= b) {
      lo = i;
      break;
    }
  }
  const rLo = rows[lo]!;
  const rHi = rows[lo + 1]!;
  const za = rLo.depthOfSoil!;
  const zb = rHi.depthOfSoil!;
  const t = zb > za ? (z - za) / (zb - za) : 0;

  const lerp = (va: number, vb: number) => va + t * (vb - va);

  const soilCategory =
    Math.abs(z - za) <= Math.abs(z - zb)
      ? normalizeDatasetSoilType(rLo.soilType)
      : normalizeDatasetSoilType(rHi.soilType);

  return {
    totalUnitWeight: lerp(rLo.totalUnitWeight!, rHi.totalUnitWeight!),
    n60: lerp(rLo.n60!, rHi.n60!),
    finesContent: lerp(rLo.finesContent!, rHi.finesContent!),
    peakGroundAcceleration: lerp(
      rLo.peakGroundAcceleration!,
      rHi.peakGroundAcceleration!,
    ),
    groundWaterLevel: lerp(rLo.groundWaterLevel!, rHi.groundWaterLevel!),
    modulusOfElasticity: lerp(
      rLo.modulusOfElasticity ?? 0,
      rHi.modulusOfElasticity ?? 0,
    ),
    soilCategory,
  };
}

function idwScalar(
  weights: number[],
  values: number[],
): number | null {
  let wSum = 0;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    const v = values[i]!;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(v)) continue;
    wSum += w;
    acc += w * v;
  }
  if (wSum <= 0) return null;
  return acc / wSum;
}

function idwSoilCategory(
  weights: number[],
  categories: SoilTypeChoice[],
): SoilTypeChoice {
  const score: Record<SoilTypeChoice, number> = {
    Cohesive: 0,
    Cohesionless: 0,
    Rock: 0,
  };
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!;
    const c = categories[i]!;
    if (!Number.isFinite(w) || w <= 0) continue;
    score[c] += w;
  }
  let best: SoilTypeChoice = "Cohesionless";
  let bestS = -1;
  (["Cohesive", "Cohesionless", "Rock"] as const).forEach((k) => {
    if (score[k] > bestS) {
      bestS = score[k];
      best = k;
    }
  });
  return best;
}

export type InterpolatedParameterTableResult = {
  initialParameterTable: Array<{
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
  }>;
  listOfDepths: number[];
  /** Boreholes inside the radius that contributed at least one depth row. */
  neighborBoreholeCount: number;
};

/**
 * Inverse-distance–weighted interpolation of borehole parameters within
 * `maxRadiusKm` (default 5 km), on the same depth grid as `/predict`.
 * Returns `null` if there are no eligible neighbors.
 */
export function buildInterpolatedParameterTableFromDataset(
  siteLat: number,
  siteLng: number,
  earthquakeMagnitude: number,
  allBoreholes: DatasetBorehole[],
  options?: {maxRadiusKm?: number},
): InterpolatedParameterTableResult | null {
  const maxR = options?.maxRadiusKm ?? NEIGHBOR_CALIBRATION_MAX_RADIUS_KM;
  const mag =
    Number.isFinite(earthquakeMagnitude) && earthquakeMagnitude > 0
      ? earthquakeMagnitude
      : 7;

  const neighbors = allBoreholes.filter((b) => {
    if (!isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) return false;
    if (!boreholeHasInterpDepthRows(b)) return false;
    const d = haversineDistanceKm(siteLat, siteLng, b.latitude, b.longitude);
    return d <= maxR;
  });

  if (neighbors.length === 0) return null;

  const listOfDepths = [...INTERPOLATED_PROFILE_DEPTHS_M];
  const initialParameterTable: InterpolatedParameterTableResult["initialParameterTable"] =
    [];

  for (let i = 0; i < listOfDepths.length; i++) {
    const depth = listOfDepths[i]!;
    const prevDepth = i === 0 ? 0 : listOfDepths[i - 1]!;
    const layerThickness = depth - prevDepth;

    const weights: number[] = [];
    const samples: VerticalSample[] = [];

    for (const b of neighbors) {
      const s = sampleBoreholeAtDepth(b, depth);
      if (!s) continue;
      const dKm = haversineDistanceKm(
        siteLat,
        siteLng,
        b.latitude!,
        b.longitude!,
      );
      const w = 1 / Math.pow(dKm + IDW_DIST_EPS_KM, IDW_POWER);
      weights.push(w);
      samples.push(s);
    }

    if (samples.length === 0) return null;

    const tw = idwScalar(
      weights,
      samples.map((s) => s.totalUnitWeight),
    );
    const n60 = idwScalar(weights, samples.map((s) => s.n60));
    const fc = idwScalar(weights, samples.map((s) => s.finesContent));
    const pga = idwScalar(weights, samples.map((s) => s.peakGroundAcceleration));
    const gwl = idwScalar(weights, samples.map((s) => s.groundWaterLevel));
    const emod = idwScalar(weights, samples.map((s) => s.modulusOfElasticity));
    if (
      tw === null ||
      n60 === null ||
      fc === null ||
      pga === null ||
      gwl === null ||
      emod === null
    ) {
      return null;
    }

    const soilType = idwSoilCategory(
      weights,
      samples.map((s) => s.soilCategory),
    );

    initialParameterTable.push({
      latitude: siteLat,
      longitude: siteLng,
      depth,
      layerThickness,
      totalUnitWeight: tw,
      n60,
      finesContent: fc,
      magnitude: mag,
      peakGroundAcceleration: pga,
      groundWaterLevel: gwl,
      soilType,
      modulusOfElasticity: emod,
    });
  }

  return {
    initialParameterTable,
    listOfDepths,
    neighborBoreholeCount: neighbors.length,
  };
}

/** Count of dataset boreholes within radius that have usable interpolation rows. */
export function countInterpEligibleBoreholesWithinKm(
  siteLat: number,
  siteLng: number,
  allBoreholes: DatasetBorehole[],
  maxRadiusKm: number = NEIGHBOR_CALIBRATION_MAX_RADIUS_KM,
): number {
  let n = 0;
  for (const b of allBoreholes) {
    if (!isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) continue;
    if (!boreholeHasInterpDepthRows(b)) continue;
    const d = haversineDistanceKm(siteLat, siteLng, b.latitude, b.longitude);
    if (d <= maxRadiusKm) n += 1;
  }
  return n;
}

/** Distance (km) to nearest interp-eligible borehole (any radius), or null. */
export function nearestInterpEligibleBoreholeKm(
  siteLat: number,
  siteLng: number,
  allBoreholes: DatasetBorehole[],
): number | null {
  let best: number | null = null;
  for (const b of allBoreholes) {
    if (!isFiniteNumber(b.latitude) || !isFiniteNumber(b.longitude)) continue;
    if (!boreholeHasInterpDepthRows(b)) continue;
    const d = haversineDistanceKm(siteLat, siteLng, b.latitude, b.longitude);
    if (best === null || d < best) best = d;
  }
  return best;
}

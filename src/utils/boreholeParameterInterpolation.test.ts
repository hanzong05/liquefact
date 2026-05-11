import {describe, expect, it} from "vitest";
import type {DatasetBorehole} from "./constants/datasetBoreholes.type";
import {
  INTERPOLATED_PROFILE_DEPTHS_M,
  buildInterpolatedParameterTableFromDataset,
  DATASET_BOREHOLE_SITE_MATCH_MAX_DISTANCE_KM,
  siteMatchesDatasetBoreholeLocation,
} from "./boreholeParameterInterpolation";

function row(
  depth: number,
  overrides: Partial<{
    totalUnitWeight: number;
    n60: number;
    finesContent: number;
    peakGroundAcceleration: number;
    groundWaterLevel: number;
    soilType: string;
    modulusOfElasticity: number;
  }> = {},
) {
  return {
    depthOfSoil: depth,
    totalUnitWeight: overrides.totalUnitWeight ?? 20,
    n60: overrides.n60 ?? 10,
    finesContent: overrides.finesContent ?? 30,
    peakGroundAcceleration: overrides.peakGroundAcceleration ?? 0.4,
    groundWaterLevel: overrides.groundWaterLevel ?? 9,
    soilType: overrides.soilType ?? "SM",
    modulusOfElasticity: overrides.modulusOfElasticity ?? 30,
  };
}

describe("siteMatchesDatasetBoreholeLocation", () => {
  it("is false for an empty list", () => {
    expect(siteMatchesDatasetBoreholeLocation(15.28, 120.56, [])).toBe(false);
  });

  it("is true when the site is within the match radius of a borehole", () => {
    const lat = 15.28;
    const lng = 120.56;
    const b: DatasetBorehole = {
      boreholeId: "BH1",
      latitude: lat + 0.00005,
      longitude: lng - 0.00005,
      depthRows: [row(1.5)],
    };
    expect(
      siteMatchesDatasetBoreholeLocation(lat, lng, [b], DATASET_BOREHOLE_SITE_MATCH_MAX_DISTANCE_KM),
    ).toBe(true);
  });

  it("is false when farther than the match radius", () => {
    const lat = 15.28;
    const lng = 120.56;
    const b: DatasetBorehole = {
      boreholeId: "BH1",
      latitude: lat + 0.01,
      longitude: lng,
      depthRows: [row(1.5)],
    };
    expect(siteMatchesDatasetBoreholeLocation(lat, lng, [b])).toBe(false);
  });
});

describe("buildInterpolatedParameterTableFromDataset", () => {
  it("returns null when no neighbors within radius", () => {
    const siteLat = 15.5;
    const siteLng = 120.5;
    const far: DatasetBorehole = {
      boreholeId: "Far",
      latitude: siteLat + 0.2,
      longitude: siteLng + 0.2,
      depthRows: [row(1.5), row(15)],
    };
    expect(
      buildInterpolatedParameterTableFromDataset(
        siteLat,
        siteLng,
        7,
        [far],
        {maxRadiusKm: 5},
      ),
    ).toBeNull();
  });

  it("IDW-blends two nearby boreholes at standard depths", () => {
    const siteLat = 15.28;
    const siteLng = 120.56;
    const a: DatasetBorehole = {
      boreholeId: "A",
      latitude: siteLat + 0.0005,
      longitude: siteLng + 0.0005,
      depthRows: INTERPOLATED_PROFILE_DEPTHS_M.map((d) =>
        row(d, {n60: 10 + d, totalUnitWeight: 19}),
      ),
    };
    const b: DatasetBorehole = {
      boreholeId: "B",
      latitude: siteLat - 0.0005,
      longitude: siteLng - 0.0005,
      depthRows: INTERPOLATED_PROFILE_DEPTHS_M.map((d) =>
        row(d, {n60: 20 + d, totalUnitWeight: 21}),
      ),
    };
    const res = buildInterpolatedParameterTableFromDataset(
      siteLat,
      siteLng,
      7.2,
      [a, b],
      {maxRadiusKm: 5},
    );
    expect(res).not.toBeNull();
    expect(res!.listOfDepths.length).toBe(10);
    expect(res!.neighborBoreholeCount).toBe(2);
    expect(res!.initialParameterTable[0]!.magnitude).toBe(7.2);
    const n60At15 = res!.initialParameterTable.find((r) => r.depth === 15)!.n60;
    expect(n60At15).toBeGreaterThan(24);
    expect(n60At15).toBeLessThan(36);
  });
});

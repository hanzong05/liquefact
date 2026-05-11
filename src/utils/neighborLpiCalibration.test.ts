import {describe, expect, it} from "vitest";
import {
  calibrateLpiFromNeighbors,
  lpiHazardLabelFromSum,
  maxHazardRemark,
  proximityHighHazardFromTaggedNeighbors,
  remarkOrdinalRank,
} from "./neighborLpiCalibration";

describe("lpiHazardLabelFromSum", () => {
  it("maps thresholds like the spreadsheet bands", () => {
    expect(lpiHazardLabelFromSum(0)).toBe("Very Low");
    expect(lpiHazardLabelFromSum(-1)).toBe("Very Low");
    expect(lpiHazardLabelFromSum(0.34)).toBe("Low");
    expect(lpiHazardLabelFromSum(5)).toBe("Low");
    expect(lpiHazardLabelFromSum(5.01)).toBe("High");
    expect(lpiHazardLabelFromSum(15)).toBe("High");
    expect(lpiHazardLabelFromSum(15.01)).toBe("Very High");
  });
});

describe("maxHazardRemark", () => {
  it("returns the highest band", () => {
    expect(maxHazardRemark("Low", "High")).toBe("High");
    expect(maxHazardRemark("Very High", "Low")).toBe("Very High");
  });
});

describe("remarkOrdinalRank", () => {
  it("orders bands for merge logic", () => {
    expect(remarkOrdinalRank("Very Low")).toBe(0);
    expect(remarkOrdinalRank("Very High")).toBe(3);
  });
});

describe("proximityHighHazardFromTaggedNeighbors", () => {
  it("returns null when no High or Very High tag is near", () => {
    expect(
      proximityHighHazardFromTaggedNeighbors(15, 120, [], 0.4),
    ).toBeNull();
    expect(
      proximityHighHazardFromTaggedNeighbors(
        15,
        120,
        [
          {
            latitude: 15.0005,
            longitude: 120,
            totalLpi: 2,
            remarkLpi: "Low",
          },
        ],
        0.4,
      ),
    ).toBeNull();
  });
});

describe("calibrateLpiFromNeighbors", () => {
  const tarlacLat = 15.37808301;
  const tarlacLng = 120.4673191;

  it("returns model-only when no boreholes fall inside the radius", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {
          latitude: tarlacLat + 0.2,
          longitude: tarlacLng,
          totalLpi: 50,
        },
      ],
      modelLpi: 0.34,
      modelRemark: "Low",
    });
    expect(r.neighborCount).toBe(0);
    expect(r.neighborLpiIdw).toBeNull();
    expect(r.displayLpiSum).toBe(0.34);
    expect(r.displayRemark).toBe("Low");
    expect(r.isCalibrated).toBe(false);
  });

  it("raises hazard when a very close borehole has high LPI", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {
          latitude: tarlacLat + 0.0002,
          longitude: tarlacLng + 0.0002,
          totalLpi: 18,
        },
      ],
      modelLpi: 0.34,
      modelRemark: "Low",
    });
    expect(r.neighborCount).toBe(1);
    expect(r.neighborLpiIdw).not.toBeNull();
    expect(r.displayLpiSum).toBeGreaterThan(0.34);
    expect(r.displayRemark).toBe("High");
    expect(r.displayLpiSum).toBeLessThanOrEqual(25);
    expect(r.isCalibrated).toBe(true);
  });

  it("floors to High when a High-tagged borehole is very close even if blend stays low", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {
          latitude: tarlacLat + 0.00015,
          longitude: tarlacLng,
          totalLpi: 0.5,
          remarkLpi: "High",
        },
      ],
      modelLpi: 4.99,
      modelRemark: "Low",
    });
    expect(r.displayRemark).toBe("High");
    expect(r.displayLpiSum).toBeGreaterThanOrEqual(5.01);
    expect(r.isCalibrated).toBe(true);
  });

  it("caps extreme borehole ΣLPI so IDW cannot explode", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {
          latitude: tarlacLat + 0.0002,
          longitude: tarlacLng,
          totalLpi: 258_654,
        },
      ],
      modelLpi: 0.34,
      modelRemark: "Low",
    });
    expect(r.neighborLpiIdw).not.toBeNull();
    expect(r.neighborLpiIdw).toBeLessThanOrEqual(22);
    expect(r.displayLpiSum).toBeLessThanOrEqual(25);
    expect(r.displayRemark).not.toBe("Very High");
  });

  it("ignores boreholes with null totalLpi", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {
          latitude: tarlacLat + 0.0001,
          longitude: tarlacLng,
          totalLpi: null,
        },
      ],
      modelLpi: 1,
      modelRemark: "Low",
    });
    expect(r.neighborCount).toBe(0);
    expect(r.isCalibrated).toBe(false);
  });

  it("returns isCalibrated false when model LPI is null", () => {
    const r = calibrateLpiFromNeighbors({
      siteLat: tarlacLat,
      siteLng: tarlacLng,
      boreholes: [
        {latitude: tarlacLat + 0.0001, longitude: tarlacLng, totalLpi: 10},
      ],
      modelLpi: null,
      modelRemark: "Low",
    });
    expect(r.displayLpiSum).toBeNull();
    expect(r.isCalibrated).toBe(false);
  });
});

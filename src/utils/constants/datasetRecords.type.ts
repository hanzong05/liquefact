export interface DatasetRecord {
  latitude: number | null;
  longitude: number | null;
  depthOfSoil: number | null;
  totalUnitWeight: number | null;
  n60: number | null;
  finesContent: number | null;
  peakGroundAcceleration: number | null;
  groundWaterLevel: number | null;
  soilType: string;
  modulusOfElasticity: number | null;
}

export interface DatasetBoreholeDepthRow {
  depthOfSoil: number | null;
  totalUnitWeight: number | null;
  n60: number | null;
  finesContent: number | null;
  peakGroundAcceleration: number | null;
  groundWaterLevel: number | null;
  soilType: string;
  modulusOfElasticity: number | null;
}

export interface DatasetBorehole {
  boreholeId: string;
  latitude: number | null;
  longitude: number | null;
  depthRows: DatasetBoreholeDepthRow[];
}

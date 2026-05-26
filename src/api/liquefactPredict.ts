// export const LIQUEFACT_API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'
export const LIQUEFACT_API_BASE = import.meta.env.VITE_API_BASE ?? 'https://geoteam-liquefact.hf.space'

export type PredictRequestBody = {
  latitude: number
  longitude: number
  depth: number
  table_weight: number
}

/** Mirrors FastAPI `PredictResponse` (includes API typo `GoundWaterLevel`). */
export type PredictResponseBody = {
  TotalUnitWeight: number
  N60: number
  FinesContent: number
  PeakGroundAcceleration: number
  GoundWaterLevel: number
  ModulusOfElasticity: number
  SoilType: string
  SoilRegime: string
}

export type DbBoreholeRecord = {
  Municipality: string | null
  'Borehole ID': string | null
  'Sample No.': string | null
  Latitude: number
  Longitude: number
  Elevation: number | null
  'Soil/Rock Description': string | null
  'USCS Symbol': string | null
  DepthOfSoil: number
  _depth_range: string
  SoilType: string
  SoilRegime: string
  'Unit Weight (γ)': number | null
  'Corrected SPT-N Value (N1(60))': number | null
  'Fines Content': number | null
  'Peak Ground Acceleration': number | null
  'Groundwater Level (m)': number | null
  'Elastic Modulus (Es) (MN/m²)': number | null
  'SPT N-Value': number | null
  'Ground Water Table': number | null
}

export async function getBoreholes(signal?: AbortSignal): Promise<DbBoreholeRecord[]> {
  const res = await fetch(`${LIQUEFACT_API_BASE}/boreholes`, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  const data = await res.json() as { records: DbBoreholeRecord[]; count: number }
  return data.records
}

export async function postPredict(
  body: PredictRequestBody,
  signal?: AbortSignal,
): Promise<PredictResponseBody> {
  const res = await fetch(`${LIQUEFACT_API_BASE}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<PredictResponseBody>
}

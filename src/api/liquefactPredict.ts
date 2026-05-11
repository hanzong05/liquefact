export const LIQUEFACT_API_BASE = 'https://mushmushhh-liquefact.hf.space'

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

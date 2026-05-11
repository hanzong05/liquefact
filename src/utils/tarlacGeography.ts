/**
 * Tarlac province scope: bbox matches `TARLAC_BOUNDS` in `lib/tarlacMap.ts`.
 * Polygon ring from `/tarlac-boundary.geojson` (same as the map outline) when loaded.
 */

/** Outer ring vertices as GeoJSON: [longitude, latitude]. */
export type LngLatRing = ReadonlyArray<readonly [number, number]>

export const TARLAC_BBOX = {
  minLat: 15.2,
  maxLat: 15.9,
  minLng: 120.28,
  maxLng: 120.78,
} as const

export function isInsideTarlacBbox(lat: number, lng: number): boolean {
  return (
    lat >= TARLAC_BBOX.minLat &&
    lat <= TARLAC_BBOX.maxLat &&
    lng >= TARLAC_BBOX.minLng &&
    lng <= TARLAC_BBOX.maxLng
  )
}

/**
 * Ray-casting point-in-polygon. `ring` is closed GeoJSON outer ring [lng, lat].
 */
export function isPointInLngLatRing(
  lat: number,
  lng: number,
  ring: LngLatRing,
): boolean {
  const n = ring.length
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0]
    const yi = ring[i]![1]
    const xj = ring[j]![0]
    const yj = ring[j]![1]
    if (yi === yj) continue
    const crossesHorizontal = (yi > lat) !== (yj > lat)
    if (!crossesHorizontal) continue
    const xIntersect = xi + ((lat - yi) * (xj - xi)) / (yj - yi)
    if (lng < xIntersect) inside = !inside
  }
  return inside
}

/** True if coordinates lie inside the province polygon, or inside the bbox if `ring` is empty. */
export function isInsideTarlacProvince(
  lat: number,
  lng: number,
  outerRing: LngLatRing | null | undefined,
): boolean {
  if (outerRing && outerRing.length >= 4) {
    return isPointInLngLatRing(lat, lng, outerRing)
  }
  return isInsideTarlacBbox(lat, lng)
}

let provinceRing: [number, number][] | null = null
let provinceRingLoadDone = false
let inflight: Promise<[number, number][]> | null = null

function ringFromFeatureCollection(fc: {
  features: Array<{geometry?: {type?: string; coordinates?: number[][][]}}>
}): [number, number][] {
  const geom = fc.features[0]?.geometry
  if (!geom || geom.type !== "Polygon") return []
  const ring = geom.coordinates?.[0] as [number, number][] | undefined
  return ring && ring.length >= 4 ? ring : []
}

/** Province outer ring; cached after first load (empty array = fall back to bbox). */
export function getTarlacProvinceOuterRing(): Promise<[number, number][]> {
  if (provinceRingLoadDone) {
    return Promise.resolve(provinceRing ?? [])
  }
  if (inflight) return inflight
  inflight = fetch("/tarlac-boundary.geojson")
    .then((r) => {
      if (!r.ok) throw new Error("boundary fetch failed")
      return r.json() as Promise<{
        features: Array<{geometry?: {type?: string; coordinates?: number[][][]}}>
      }>
    })
    .then((fc) => {
      provinceRing = ringFromFeatureCollection(fc)
      provinceRingLoadDone = true
      return provinceRing
    })
    .catch(() => {
      provinceRing = []
      provinceRingLoadDone = true
      return []
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Share the ring from an existing GeoJSON load (avoids duplicate fetch). */
export function primeTarlacProvinceOuterRing(ring: [number, number][]) {
  if (ring.length >= 4) {
    provinceRing = ring
    provinceRingLoadDone = true
  }
}

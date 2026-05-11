import {
  getTarlacProvinceOuterRing,
  isInsideTarlacProvince,
} from './tarlacGeography'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

/** Bias search to Tarlac province (west, north, east, south). */
const TARLAC_VIEWBOX = '120.28,15.9,120.78,15.2'

export type GeocodeHit = {
  lat: number
  lng: number
  displayName: string
}

function nominatimHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    // Nominatim usage policy: identify the application.
    'User-Agent': 'Liquefact/1.0 (geotechnical analysis web app)',
  }
}


export async function searchLocation(
  query: string,
): Promise<GeocodeHit | null> {
  const q = query.trim()
  if (!q) return null

  const params = new URLSearchParams({
    format: 'json',
    q: `${q}, Tarlac, Philippines`,
    limit: '8',
    viewbox: TARLAC_VIEWBOX,
    bounded: '1',
  })

  const res = await fetch(`${NOMINATIM}/search?${params}`, {
    headers: nominatimHeaders(),
  })
  if (!res.ok) return null

  const data: Array<{ lat: string; lon: string; display_name: string }> =
    await res.json()
  const ring = await getTarlacProvinceOuterRing()
  const ringOrNull = ring.length >= 4 ? ring : null
  for (const row of data) {
    const lat = Number.parseFloat(row.lat)
    const lng = Number.parseFloat(row.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const geocodeHit: GeocodeHit = {
      lat,
      lng,
      displayName: row.display_name,
    }
    if (isInsideTarlacProvince(geocodeHit.lat, geocodeHit.lng, ringOrNull)) {
      return geocodeHit
    }
  }
  return null
}

/** Multiple ranked hits for autocomplete (same Tarlac bounds as `searchLocation`). */
export async function searchLocationSuggestions(
  query: string,
  limit = 6,
): Promise<GeocodeHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const fetchLimit = Math.min(25, Math.max(10, limit * 3 + 4))
  const params = new URLSearchParams({
    format: 'json',
    q: `${q}, Tarlac, Philippines`,
    limit: String(fetchLimit),
    viewbox: TARLAC_VIEWBOX,
    bounded: '1',
  })

  const res = await fetch(`${NOMINATIM}/search?${params}`, {
    headers: nominatimHeaders(),
  })
  if (!res.ok) return []

  const data: Array<{ lat: string; lon: string; display_name: string }> =
    await res.json()
  const ring = await getTarlacProvinceOuterRing()
  const out: GeocodeHit[] = []
  for (const row of data) {
    const lat = Number.parseFloat(row.lat)
    const lng = Number.parseFloat(row.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const h: GeocodeHit = {
      lat,
      lng,
      displayName: row.display_name,
    }
    if (!isInsideTarlacProvince(h.lat, h.lng, ring.length >= 4 ? ring : null)) {
      continue
    }
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

export async function reverseLookup(
  lat: number,
  lng: number,
): Promise<string | null> {
  const params = new URLSearchParams({
    format: 'json',
    lat: String(lat),
    lon: String(lng),
  })

  const res = await fetch(`${NOMINATIM}/reverse?${params}`, {
    headers: nominatimHeaders(),
  })
  if (!res.ok) return null

  const data: { display_name?: string } = await res.json()
  return data.display_name ?? null
}

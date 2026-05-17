import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  CircleMarker,
  GeoJSON,
  LayerGroup,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import {
  TARLAC_BOUNDS,
  ensureDefaultLeafletIcons,
} from '../lib/tarlacMap'
import {
  isInsideTarlacProvince,
  primeTarlacProvinceOuterRing,
} from '../utils/tarlacGeography'
import type { DbBoreholeRecord } from '../api/liquefactPredict'

export type MapViewportSnapshot = {
  centerLat: number
  centerLng: number
  zoom: number
}

type TarlacBoundaryFc = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: Record<string, unknown>
    geometry: { type: string; coordinates: unknown }
  }>
}

type LngLat = [number, number]

/** Large outer ring [lng, lat]; Tarlac hole keeps interior undimmed. */
function buildOutsideDimMask(
  boundary: TarlacBoundaryFc,
): GeoJSON.Feature | null {
  const geom = boundary.features[0]?.geometry
  if (!geom || geom.type !== 'Polygon') return null
  const coords = geom.coordinates as LngLat[][]
  const provinceRing = coords[0]
  if (!provinceRing?.length) return null

  const outer: LngLat[] = [
    [-360, -89],
    [360, -89],
    [360, 89],
    [-360, 89],
    [-360, -89],
  ]

  const hole = [...provinceRing].reverse()

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [outer, hole],
    },
  }
}

const OUTSIDE_DIM_STYLE: L.PathOptions = {
  stroke: false,
  fill: true,
  fillColor: '#0f172a',
  fillOpacity: 0.42,
  interactive: false,
}

const PROVINCE_STYLE = {
  color: '#2563eb',
  weight: 3,
  opacity: 1,
  fillColor: '#3b82f6',
  fillOpacity: 0.06,
  lineJoin: 'round' as const,
  lineCap: 'round' as const,
}

type Props = {
  selectedLat: number
  selectedLng: number
  placeName: string
  boreholes?: Array<{
    id: string
    lat: number
    lng: number
    remarkLpi: string
    totalLpi: number | null
  }>
  /** Borehole records loaded from the backend Excel database. */
  databaseBoreholes?: DbBoreholeRecord[]
  /**
   * Map view immediately before the click (center + zoom). Used to restore
   * the camera if the user cancels a map-pick flow.
   */
  onLocationSelect?: (
    lat: number,
    lng: number,
    viewBeforeClick: MapViewportSnapshot,
  ) => void
  /**
   * Increment when the pin should zoom into view (map pick, header Go, etc.).
   * Omit or keep at 0 to avoid flying on first dashboard paint.
   */
  flyToPinToken?: number
  /** When `id` changes, fly the map back to this center and zoom (e.g. cancel map pick). */
  mapViewRestore?: (MapViewportSnapshot & { id: number }) | null
  /** Fired when the user clicks outside Tarlac (polygon when loaded, else map max bounds). */
  onOutsideProvinceClick?: () => void
  /**
   * When set, draws a geodesic circle (Leaflet `radius` in meters) around the
   * selected pin for borehole neighborhood context (e.g. LPI calibration).
   */
  neighborInfluenceRadiusM?: number | null
}

function MapClickSelect({
  onSelect,
  provinceOuterRing,
  onOutsideProvinceClick,
}: {
  onSelect: (lat: number, lng: number, view: MapViewportSnapshot) => void
  provinceOuterRing: [number, number][] | null
  onOutsideProvinceClick?: () => void
}) {
  const map = useMap()
  useMapEvents({
    click(e) {
      const lat = e.latlng.lat
      const lng = e.latlng.lng
      const ring =
        provinceOuterRing && provinceOuterRing.length >= 4
          ? provinceOuterRing
          : null
      if (!isInsideTarlacProvince(lat, lng, ring)) {
        onOutsideProvinceClick?.()
        return
      }
      const c = map.getCenter()
      onSelect(lat, lng, {
        centerLat: c.lat,
        centerLng: c.lng,
        zoom: map.getZoom(),
      })
    },
  })
  return null
}

function boreholeRadius(zoom: number) {
  if (zoom >= 14) return 9
  if (zoom >= 12) return 7
  return 5
}

function ZoomReporter({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap()
  useMapEvents({
    zoomend() {
      onZoom(map.getZoom())
    },
  })
  useEffect(() => {
    onZoom(map.getZoom())
  }, [map, onZoom])
  return null
}

function MapResizeFix() {
  const map = useMap()
  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize())
    return () => cancelAnimationFrame(id)
  }, [map])
  return null
}

/** Flies to the pin when `flyToPinToken` increases (not on initial 0). */
function FlyToPinOnSelection({
  lat,
  lng,
  token,
  flyZoom = 14,
}: {
  lat: number
  lng: number
  token: number
  flyZoom?: number
}) {
  const map = useMap()
  const prevToken = useRef(0)
  useEffect(() => {
    if (token === 0 || token === prevToken.current) return
    prevToken.current = token
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const z = Math.min(flyZoom, map.getMaxZoom())
    map.flyTo([lat, lng], z, { duration: 0.45 })
  }, [token, lat, lng, flyZoom, map])
  return null
}

/** Restores pan/zoom when `request.id` changes (e.g. user cancels map pick). */
function RestoreMapView({
  request,
}: {
  request: (MapViewportSnapshot & { id: number }) | null
}) {
  const map = useMap()
  const lastId = useRef<number | null>(null)
  useEffect(() => {
    if (!request) return
    if (lastId.current === request.id) return
    lastId.current = request.id
    map.flyTo(
      [request.centerLat, request.centerLng],
      request.zoom,
      { duration: 0.4 },
    )
  }, [request, map])
  return null
}

function boreholeColorFromRemark(remarkLpi: string): string {
  if (remarkLpi === 'Very High') return '#dc2626'
  if (remarkLpi === 'High') return '#f97316'
  if (remarkLpi === 'Low') return '#16a34a'
  return '#64748b'
}

function BoreholeLayer({
  zoom,
  boreholes,
}: {
  zoom: number
  boreholes: Props['boreholes']
}) {
  const r = boreholeRadius(zoom)
  if (!boreholes?.length) return null

  return (
    <>
      {boreholes.map((b) => (
        <CircleMarker
          key={b.id}
          center={[b.lat, b.lng]}
          radius={r}
          pathOptions={{
            color: '#fff',
            weight: 1,
            fillColor: boreholeColorFromRemark(b.remarkLpi),
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <span className="text-xs font-semibold">
              {b.remarkLpi} risk
            </span>
            <br />
            <span className="text-[11px] text-slate-600">
              ΣLPI:{' '}
              {b.totalLpi !== null && Number.isFinite(b.totalLpi)
                ? b.totalLpi.toFixed(3)
                : '—'}
            </span>
          </Popup>
        </CircleMarker>
      ))}
    </>
  )
}

const DB_REGIME_COLOR: Record<string, string> = {
  Sand: '#f59e0b',
  Silt: '#3b82f6',
  Clay: '#8b5cf6',
  Rock: '#64748b',
}

function dbBoreholeColor(regime: string): string {
  return DB_REGIME_COLOR[regime] ?? '#10b981'
}

/** Deduplicates records by Borehole ID so only one pin shows per location. */
function dedupeBoreholes(records: DbBoreholeRecord[]): DbBoreholeRecord[] {
  const seen = new Set<string>()
  return records.filter((r) => {
    const key = r['Borehole ID'] ?? `${r.Latitude},${r.Longitude}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function DbBoreholeLayer({
  zoom,
  records,
}: {
  zoom: number
  records: DbBoreholeRecord[]
}) {
  const deduped = useMemo(() => dedupeBoreholes(records), [records])
  const r = boreholeRadius(zoom) - 1

  if (!deduped.length) return null

  return (
    <LayerGroup>
      {deduped.map((b, i) => {
        const key = b['Borehole ID'] ?? `${b.Latitude}-${b.Longitude}-${i}`
        const color = dbBoreholeColor(b.SoilRegime)
        const n60 = b['Corrected SPT-N Value (N1(60))']
        const sptn = b['SPT N-Value']
        const gwl = b['Groundwater Level (m)']
        return (
          <CircleMarker
            key={key}
            center={[b.Latitude, b.Longitude]}
            radius={Math.max(3, r)}
            pathOptions={{
              color: '#fff',
              weight: 1,
              fillColor: color,
              fillOpacity: 0.85,
            }}
          >
            <Popup>
              <div className="text-xs leading-snug min-w-[140px]">
                <p className="font-semibold text-slate-800 mb-0.5">
                  {b['Borehole ID'] ?? 'Borehole'}
                </p>
                {b.Municipality && (
                  <p className="text-slate-500">{b.Municipality}</p>
                )}
                <hr className="my-1 border-slate-200" />
                <p>
                  <span className="text-slate-500">Soil: </span>
                  <span
                    className="font-medium"
                    style={{ color }}
                  >
                    {b.SoilRegime}
                  </span>
                  {b['USCS Symbol'] ? ` (${b['USCS Symbol']})` : ''}
                </p>
                {(n60 != null || sptn != null) && (
                  <p>
                    <span className="text-slate-500">N60 / SPT-N: </span>
                    {n60 != null ? n60.toFixed(1) : '—'} /{' '}
                    {sptn != null ? String(sptn) : '—'}
                  </p>
                )}
                {gwl != null && (
                  <p>
                    <span className="text-slate-500">GWL: </span>
                    {gwl.toFixed(1)} m
                  </p>
                )}
                <p className="text-slate-400 mt-0.5">
                  {b.Latitude.toFixed(5)}°N, {b.Longitude.toFixed(5)}°E
                </p>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}
    </LayerGroup>
  )
}

export function TarlacMap({
  selectedLat,
  selectedLng,
  placeName,
  boreholes,
  databaseBoreholes,
  onLocationSelect,
  flyToPinToken = 0,
  mapViewRestore = null,
  onOutsideProvinceClick,
  neighborInfluenceRadiusM = null,
}: Props) {
  useEffect(() => {
    ensureDefaultLeafletIcons()
  }, [])

  const [zoom, setZoom] = useState(11)
  const [provinceBoundary, setProvinceBoundary] =
    useState<TarlacBoundaryFc | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/tarlac-boundary.geojson')
      .then((r) => r.json())
      .then((data: TarlacBoundaryFc) => {
        if (cancelled) return
        setProvinceBoundary(data)
        const geom = data.features[0]?.geometry
        if (geom?.type === 'Polygon') {
          const coords = geom.coordinates as number[][][] | undefined
          const ring = coords?.[0] as [number, number][] | undefined
          if (ring && ring.length >= 4) primeTarlacProvinceOuterRing(ring)
        }
      })
      .catch(() => {
        if (!cancelled) setProvinceBoundary(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const outsideDimMask = useMemo(
    () => (provinceBoundary ? buildOutsideDimMask(provinceBoundary) : null),
    [provinceBoundary],
  )

  const provinceOuterRing = useMemo((): [number, number][] | null => {
    if (!provinceBoundary?.features[0]) return null
    const geom = provinceBoundary.features[0].geometry
    if (geom.type !== 'Polygon') return null
    const coords = geom.coordinates as number[][][] | undefined
    const ring = coords?.[0] as [number, number][] | undefined
    return ring && ring.length >= 4 ? ring : null
  }, [provinceBoundary])

  const selectedIcon = L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })

  return (
    <div className="relative h-full w-full min-h-0">
    {databaseBoreholes?.length ? (
      <div className="pointer-events-none absolute bottom-7 right-2 z-[1000] rounded-lg border border-slate-200/80 bg-white/90 px-2.5 py-2 shadow text-[10px] leading-snug backdrop-blur-sm">
        <p className="font-semibold text-slate-600 mb-1 uppercase tracking-wide">Boreholes</p>
        {Object.entries(DB_REGIME_COLOR).map(([regime, color]) => (
          <div key={regime} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/60 flex-shrink-0" style={{ background: color }} />
            <span className="text-slate-700">{regime}</span>
          </div>
        ))}
      </div>
    ) : null}
    <MapContainer
      className="z-0 h-full w-full min-h-0 rounded-lg"
      bounds={TARLAC_BOUNDS}
      maxBounds={TARLAC_BOUNDS}
      maxBoundsViscosity={1}
      minZoom={10}
      maxZoom={16}
      scrollWheelZoom
      attributionControl
    >
      <MapResizeFix />
      <FlyToPinOnSelection
        lat={selectedLat}
        lng={selectedLng}
        token={flyToPinToken}
      />
      <RestoreMapView request={mapViewRestore} />
      <ZoomReporter onZoom={setZoom} />
      {onLocationSelect ? (
        <MapClickSelect
          onSelect={onLocationSelect}
          provinceOuterRing={provinceOuterRing}
          onOutsideProvinceClick={onOutsideProvinceClick}
        />
      ) : null}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {outsideDimMask ? (
        <GeoJSON data={outsideDimMask} style={OUTSIDE_DIM_STYLE} />
      ) : null}
      {provinceBoundary ? (
        <GeoJSON data={provinceBoundary} style={PROVINCE_STYLE} />
      ) : null}
      {neighborInfluenceRadiusM !== null &&
      neighborInfluenceRadiusM !== undefined &&
      neighborInfluenceRadiusM > 0 &&
      Number.isFinite(selectedLat) &&
      Number.isFinite(selectedLng) ? (
        <Circle
          center={[selectedLat, selectedLng]}
          radius={neighborInfluenceRadiusM}
          pathOptions={{
            color: '#2563eb',
            weight: 2,
            opacity: 0.75,
            fillColor: '#3b82f6',
            fillOpacity: 0.07,
            interactive: false,
          }}
        />
      ) : null}
      {databaseBoreholes?.length ? (
        <DbBoreholeLayer zoom={zoom} records={databaseBoreholes} />
      ) : null}
      <BoreholeLayer zoom={zoom} boreholes={boreholes} />
      <Marker position={[selectedLat, selectedLng]} icon={selectedIcon}>
        <Popup>
          <span className="text-sm font-medium">{placeName}</span>
          <br />
          <span className="text-xs text-slate-600">
            {selectedLat.toFixed(4)}°N, {selectedLng.toFixed(4)}°E
          </span>
        </Popup>
      </Marker>
    </MapContainer>
    </div>
  )
}

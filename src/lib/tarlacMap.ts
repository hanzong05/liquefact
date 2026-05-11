import type { LatLngBoundsExpression } from 'leaflet'
import L from 'leaflet'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

/** Southwest then northeast — keeps panning inside Tarlac province. */
export const TARLAC_BOUNDS: LatLngBoundsExpression = [
  [15.2, 120.28],
  [15.9, 120.78],
]

let iconsFixed = false

export function ensureDefaultLeafletIcons() {
  if (iconsFixed) return
  iconsFixed = true
  const proto = L.Icon.Default.prototype as unknown as { _getIconUrl?: string }
  delete proto._getIconUrl
  L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
}

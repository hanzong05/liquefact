export type RiskLevel = 'high' | 'medium' | 'low' | 'none'

export type BoreholePoint = {
  id: string
  lat: number
  lng: number
  risk: RiskLevel
}

/** Mock boreholes scattered within Tarlac bounds (not real survey data). */
export const MOCK_BOREHOLES: BoreholePoint[] = [
  { id: '1', lat: 15.42, lng: 120.45, risk: 'low' },
  { id: '2', lat: 15.48, lng: 120.52, risk: 'medium' },
  { id: '3', lat: 15.55, lng: 120.48, risk: 'high' },
  { id: '4', lat: 15.5, lng: 120.58, risk: 'low' },
  { id: '5', lat: 15.58, lng: 120.55, risk: 'low' },
  { id: '6', lat: 15.45, lng: 120.62, risk: 'medium' },
  { id: '7', lat: 15.52, lng: 120.42, risk: 'high' },
  { id: '8', lat: 15.6, lng: 120.5, risk: 'low' },
  { id: '9', lat: 15.35, lng: 120.55, risk: 'none' },
  { id: '10', lat: 15.65, lng: 120.65, risk: 'medium' },
  { id: '11', lat: 15.72, lng: 120.52, risk: 'low' },
  { id: '12', lat: 15.4, lng: 120.68, risk: 'high' },
  { id: '13', lat: 15.56, lng: 120.7, risk: 'low' },
  { id: '14', lat: 15.62, lng: 120.4, risk: 'medium' },
  { id: '15', lat: 15.47, lng: 120.35, risk: 'low' },
]

export function riskLegendCounts(points: BoreholePoint[]) {
  const high = points.filter((p) => p.risk === 'high').length
  const medium = points.filter((p) => p.risk === 'medium').length
  const low = points.filter((p) => p.risk === 'low').length
  const none = points.filter((p) => p.risk === 'none').length
  return { high, medium, low, none, total: points.length }
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  high: '#dc2626',
  medium: '#ea580c',
  low: '#16a34a',
  none: '#9ca3af',
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  high: 'H',
  medium: 'M',
  low: 'L',
  none: '?',
}

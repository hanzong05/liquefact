export type AnalysisLocationState = {
  lat: number
  lng: number
  placeName: string
}

/** Default map / analysis coordinates (home, analysis header, fallbacks). */
export const DEFAULT_SITE_LAT = 15.279407
export const DEFAULT_SITE_LNG = 120.569097
export const DEFAULT_SITE_PLACE_NAME = 'Selected location'

export function defaultLocationState(): AnalysisLocationState {
  return {
    lat: DEFAULT_SITE_LAT,
    lng: DEFAULT_SITE_LNG,
    placeName: DEFAULT_SITE_PLACE_NAME,
  }
}

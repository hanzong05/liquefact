import { useState } from 'react'
import { LiquefactLandscapeWordmark } from './LiquefactBrandAssets'

const FOUNDATION_WIDTH_M = 3

/** Foundation depth Df (m): 1.0 … 2.0 in 0.1 m steps */
const FOUNDATION_DEPTH_CHOICES_M = Array.from({ length: 11 }, (_, i) =>
  Math.round((1 + i * 0.1) * 10) / 10,
)

function nearestFoundationDepthM(m: number): number {
  const clamped = Math.min(2, Math.max(1, m))
  let best = FOUNDATION_DEPTH_CHOICES_M[0]!
  for (const v of FOUNDATION_DEPTH_CHOICES_M) {
    if (Math.abs(v - clamped) < Math.abs(best - clamped)) best = v
  }
  return best
}

const fieldShell =
  'mt-2 w-full rounded-lg bg-white px-3 py-3 text-sm tabular-nums text-slate-900 shadow-sm outline-none transition-[border-width,border-color,box-shadow] focus:ring-0'

const borderStandard =
  'border border-slate-300 focus:border-2 focus:border-slate-900'

const borderEmphasis = 'border-2 border-slate-900 focus:border-2 focus:border-slate-900'

export type LocationParameters = {
  foundationDepthM: number
  buildingLoadKn: number
  earthquakeMw: number
  designLifeYears: number
}

type Props = {
  onCancel: () => void
  onAnalyze: (params: LocationParameters) => void
  initialValues?: LocationParameters
  submitLabel?: string
  title?: string
  description?: string
}

export function LocationParametersModal({
  onCancel,
  onAnalyze,
  initialValues,
  submitLabel = 'Analyze',
  title = 'Location Parameters',
  description = 'Enter building and site details before running the analysis.',
}: Props) {
  const [foundationDepthM, setFoundationDepthM] = useState(() =>
    nearestFoundationDepthM(initialValues?.foundationDepthM ?? 1.5),
  )
  const [buildingLoadKn, setBuildingLoadKn] = useState(
    initialValues?.buildingLoadKn ?? 1500,
  )
  const [earthquakeMw, setEarthquakeMw] = useState(
    initialValues?.earthquakeMw ?? 7,
  )
  const [designLifeYears, setDesignLifeYears] = useState(
    initialValues?.designLifeYears ?? 3,
  )

  const qActualKpa =
    FOUNDATION_WIDTH_M > 0
      ? buildingLoadKn / (FOUNDATION_WIDTH_M * FOUNDATION_WIDTH_M)
      : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[3px]">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.25)] sm:p-10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-params-title"
      >
        <div className="mb-6 flex justify-center">
          <LiquefactLandscapeWordmark className="max-h-10 sm:max-h-11" />
        </div>
        <h2
          id="location-params-title"
          className="text-2xl font-bold tracking-tight text-slate-900"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {description}
        </p>

        <form
          className="mt-8 flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            onAnalyze({
              foundationDepthM,
              buildingLoadKn,
              earthquakeMw,
              designLifeYears,
            })
          }}
        >
          <div>
            <label htmlFor="df" className="text-sm font-semibold text-slate-900">
              Foundation Depth — Df (m)
            </label>
            <select
              id="df"
              value={foundationDepthM}
              autoFocus
              onChange={(e) => {
                // `<select>` has no `valueAsNumber` in the DOM (unlike `<input type="number">`).
                const n = Number(e.currentTarget.value)
                if (Number.isFinite(n)) setFoundationDepthM(n)
              }}
              className={`${fieldShell} ${borderEmphasis} cursor-pointer`}
            >
              {FOUNDATION_DEPTH_CHOICES_M.map((m) => (
                <option key={m} value={m}>
                  {m.toFixed(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="p" className="text-sm font-semibold text-slate-900">
              Building Load — P (kN)
            </label>
            <input
              id="p"
              type="number"
              step="1"
              min={0}
              value={buildingLoadKn}
              onChange={(e) => setBuildingLoadKn(Number(e.target.value))}
              className={`${fieldShell} ${borderStandard}`}
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              q_actual = {qActualKpa.toFixed(2)} kPa (P / B² = P /{' '}
              {FOUNDATION_WIDTH_M}²)
            </p>
          </div>

          <div>
            <label htmlFor="mw" className="text-sm font-semibold text-slate-900">
              Earthquake Magnitude (Mw)
            </label>
            <input
              id="mw"
              type="number"
              step="0.1"
              min={0}
              value={earthquakeMw}
              onChange={(e) => setEarthquakeMw(Number(e.target.value))}
              className={`${fieldShell} ${borderStandard}`}
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Use 0 for static (no-earthquake) analysis
            </p>
          </div>

          <div>
            <label htmlFor="t" className="text-sm font-semibold text-slate-900">
              Design Life — t (years)
            </label>
            <input
              id="t"
              type="number"
              step="1"
              min={1}
              value={designLifeYears}
              onChange={(e) => setDesignLifeYears(Number(e.target.value))}
              className={`${fieldShell} ${borderStandard}`}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg bg-slate-100 py-3 text-center text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-slate-900 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

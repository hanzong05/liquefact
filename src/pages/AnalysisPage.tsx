import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {FileText, Loader2, MapPin, RefreshCw} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import Liquefaction from "../computation/Liquefaction";
import {
  computeGeotechnicalForAllBoreholesParallel,
  DEFAULT_PREDICT_TABLE_WEIGHT,
  type BoreholeComputeProgress,
  type BoreholeMapResult,
  type GeotechnicalAnalysisTable,
} from "../computation/liquefactionComputations";
import {LiquefactSquareMark} from "../components/LiquefactBrandAssets";
import {GeocodeSuggestInput} from "../components/GeocodeSuggestInput";
import {LocationParametersModal} from "../components/LocationParametersModal";
import type {LocationParameters} from "../components/LocationParametersModal";
import type {GeocodeHit} from "../utils/geocoding";
import {TarlacMap, type MapViewportSnapshot} from "../components/TarlacMap";
import {downloadAnalysisPdf} from "../utils/exportAnalysisPdf";
import {
  getTarlacProvinceOuterRing,
  isInsideTarlacProvince,
} from "../utils/tarlacGeography";
import {datasetBoreholes} from "../utils/constants/datasetBoreholes";
import {
  defaultLocationState,
  type AnalysisLocationState,
} from "../routes/locationState";

type Phase = "parameters" | "dashboard";
type BoreholeLegend = {
  veryHigh: number;
  high: number;
  low: number;
  veryLow: number;
  total: number;
};

function formatNum(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function totalLpi(geo: GeotechnicalAnalysisTable[]): number {
  let s = 0;
  for (const r of geo) {
    const v = parseFloat(r.lpi);
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

function minFactorOfSafety(geo: GeotechnicalAnalysisTable[]): number | null {
  let m: number | null = null;
  for (const r of geo) {
    const v = parseFloat(r.fs);
    if (!Number.isFinite(v)) continue;
    if (m === null || v < m) m = v;
  }
  return m;
}

function lpiHazardLabel(sum: number): string {
  if (!Number.isFinite(sum) || sum <= 0) return "Very Low";
  if (sum <= 5) return "Low";
  if (sum <= 15) return "High";
  return "Very High";
}

function formatSbcValue(v: number | string): string {
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n.toFixed(2) : v;
  }
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export interface LiquefactionFormInputs {
  latitude: number;
  longitude: number;
  foundationDepth: number;
  buildingLoad: number;
  earthquakeMagnitude: number;
  elapsedTimeInYears: number;
}

export function AnalysisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as AnalysisLocationState | null;
  const site = state ?? defaultLocationState();

  const [phase, setPhase] = useState<Phase>("parameters");
  const [params, setParams] = useState<LocationParameters | null>(null);

  const [headerSearch, setHeaderSearch] = useState("");
  const [headerLat, setHeaderLat] = useState(String(site.lat));
  const [headerLng, setHeaderLng] = useState(String(site.lng));

  const [mapLat, setMapLat] = useState(site.lat);
  const [mapLng, setMapLng] = useState(site.lng);
  /** Coordinates passed to `computeLiquefaction`; map pin can preview elsewhere until "Analyze this location". */
  const [analysisSiteLat, setAnalysisSiteLat] = useState(site.lat);
  const [analysisSiteLng, setAnalysisSiteLng] = useState(site.lng);
  const [mapLabel, setMapLabel] = useState(site.placeName);

  const [analysis, setAnalysis] = useState<Liquefaction | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [boreholeMapResults, setBoreholeMapResults] = useState<
    BoreholeMapResult[]
  >([]);
  const [boreholeLoading, setBoreholeLoading] = useState(false);
  const [boreholeError, setBoreholeError] = useState<string | null>(null);
  const [boreholeProgress, setBoreholeProgress] =
    useState<BoreholeComputeProgress>({completed: 0, total: 0, percent: 0});
  const [showEditParamsModal, setShowEditParamsModal] = useState(false);
  const [mapPickParamsModalOpen, setMapPickParamsModalOpen] = useState(false);
  const [flyToPinToken, setFlyToPinToken] = useState(0);
  const [mapViewRestore, setMapViewRestore] = useState<
    (MapViewportSnapshot & {id: number}) | null
  >(null);
  const mapPickSnapshotRef = useRef<{
    mapLat: number;
    mapLng: number;
    mapLabel: string;
    headerLat: string;
    headerLng: string;
    headerSearch: string;
    viewCenterLat: number;
    viewCenterLng: number;
    viewZoom: number;
  } | null>(null);
  const headerGoSnapshotRef = useRef<{
    mapLat: number;
    mapLng: number;
    mapLabel: string;
    headerLat: string;
    headerLng: string;
    headerSearch: string;
    analysisSiteLat: number;
    analysisSiteLng: number;
  } | null>(null);
  const [showHeaderGoParamsModal, setShowHeaderGoParamsModal] = useState(false);
  const [tarlacScopeHint, setTarlacScopeHint] = useState<string | null>(null);

  const handleMapLocationSelect = useCallback(
    (lat: number, lng: number, viewBeforeClick: MapViewportSnapshot) => {
      if (phase !== "dashboard" || !params) return;
      setShowEditParamsModal(false);
      setTarlacScopeHint(null);
      if (showHeaderGoParamsModal) {
        headerGoSnapshotRef.current = null;
        setShowHeaderGoParamsModal(false);
      }
      mapPickSnapshotRef.current = {
        mapLat,
        mapLng,
        mapLabel,
        headerLat,
        headerLng,
        headerSearch,
        viewCenterLat: viewBeforeClick.centerLat,
        viewCenterLng: viewBeforeClick.centerLng,
        viewZoom: viewBeforeClick.zoom,
      };
      setMapLat(lat);
      setMapLng(lng);
      setHeaderLat(String(lat));
      setHeaderLng(String(lng));
      setHeaderSearch("");
      setMapLabel("Map-selected site");
      setFlyToPinToken((t) => t + 1);
      setMapPickParamsModalOpen(true);
    },
    [
      phase,
      params,
      mapLat,
      mapLng,
      mapLabel,
      headerLat,
      headerLng,
      headerSearch,
      showHeaderGoParamsModal,
    ],
  );

  useEffect(() => {
    if (phase !== "dashboard" || !params) return;

    const ac = new AbortController();

    (async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const liq = new Liquefaction();
        liq.latitude = analysisSiteLat;
        liq.longitude = analysisSiteLng;
        liq.foundationDepth = params.foundationDepthM;
        liq.buildingLoad = params.buildingLoadKn;
        liq.earthquakeMagnitude = params.earthquakeMw;
        liq.elapsedTimeInYears = params.designLifeYears;

        await liq.computeLiquefaction({
          signal: ac.signal,
          tableWeight: DEFAULT_PREDICT_TABLE_WEIGHT,
        });

        setAnalysis(liq);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setAnalysis(null);
        setAnalysisError(
          e instanceof Error ? e.message : "Analysis computation failed.",
        );
      } finally {
        if (!ac.signal.aborted) {
          setAnalysisLoading(false);
        }
      }
    })();

    return () => ac.abort();
  }, [phase, analysisSiteLat, analysisSiteLng, params]);

  useEffect(() => {
    if (phase !== "dashboard" || !params) return;
    const ac = new AbortController();
    (async () => {
      setBoreholeLoading(true);
      setBoreholeError(null);
      setBoreholeProgress({completed: 0, total: 0, percent: 0});
      try {
        const mapResults = await computeGeotechnicalForAllBoreholesParallel(
          params.earthquakeMw,
          {
            signal: ac.signal,
            onProgress: (progress) => {
              if (!ac.signal.aborted) setBoreholeProgress(progress);
            },
          },
        );
        if (!ac.signal.aborted) setBoreholeMapResults(mapResults);
      } catch (error) {
        if (ac.signal.aborted) return;
        setBoreholeMapResults([]);
        setBoreholeError(
          error instanceof Error
            ? error.message
            : "Failed to compute borehole map results.",
        );
      } finally {
        if (!ac.signal.aborted) setBoreholeLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [phase, params]);

  const legend: BoreholeLegend = boreholeMapResults.reduce(
    (acc, item) => {
      if (item.remark_lpi === "Very High") acc.veryHigh += 1;
      else if (item.remark_lpi === "High") acc.high += 1;
      else if (item.remark_lpi === "Low") acc.low += 1;
      else acc.veryLow += 1;
      acc.total += 1;
      return acc;
    },
    {veryHigh: 0, high: 0, low: 0, veryLow: 0, total: 0},
  );
  const mapBoreholes = boreholeMapResults.map((item) => ({
    id: item.boreholeId,
    lat: item.latitude,
    lng: item.longitude,
    remarkLpi: item.remark_lpi,
    totalLpi: item.totalLpi,
  }));
  const nearestBorehole = useMemo(() => {
    let nearest: {id: string; distanceKm: number} | null = null;
    for (const borehole of datasetBoreholes) {
      if (
        borehole.latitude === null ||
        borehole.longitude === null ||
        !Number.isFinite(borehole.latitude) ||
        !Number.isFinite(borehole.longitude)
      ) {
        continue;
      }
      const distanceKm = haversineDistanceKm(
        mapLat,
        mapLng,
        borehole.latitude,
        borehole.longitude,
      );
      if (!nearest || distanceKm < nearest.distanceKm) {
        nearest = {id: borehole.boreholeId, distanceKm};
      }
    }
    return nearest;
  }, [mapLat, mapLng]);

  const applyGeocodeHitToHeader = useCallback((hit: GeocodeHit) => {
    setTarlacScopeHint(null);
    setHeaderLat(hit.lat.toFixed(6));
    setHeaderLng(hit.lng.toFixed(6));
    setHeaderSearch(hit.displayName);
  }, []);

  const lpiSum = analysis ? Number.parseFloat(analysis.totalLpi) : null;
  const computedLpiSum =
    lpiSum !== null && Number.isFinite(lpiSum)
      ? lpiSum
      : analysis
        ? totalLpi(analysis.geotechnicalAnalysisTable)
        : null;
  const hazardLabel =
    analysis?.totalLpi_remark ??
    (computedLpiSum !== null ? lpiHazardLabel(computedLpiSum) : "—");
  const minFs = analysis
    ? minFactorOfSafety(analysis.geotechnicalAnalysisTable)
    : null;
  const anyLiquefiable = analysis?.geotechnicalAnalysisTable.some(
    (r) => r.remarks_fs === "LIQUEFIABLE",
  );
  const displayFooting =
    analysis?.finalFootingWidthIterationPassedData ??
    (analysis?.footingWidthIterationData.length
      ? analysis.footingWidthIterationData[
          analysis.footingWidthIterationData.length - 1
        ]!
      : null);

  if (phase === "parameters") {
    return (
      <div className="min-h-svh bg-slate-200/80">
        <LocationParametersModal
          onCancel={() => navigate("/")}
          onAnalyze={(p) => {
            setParams(p);
            setPhase("dashboard");
          }}
        />
      </div>
    );
  }

  const applyHeaderGo = async () => {
    const la = Number.parseFloat(headerLat);
    const lo = Number.parseFloat(headerLng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;

    if (showHeaderGoParamsModal) {
      return;
    }

    setTarlacScopeHint(null);
    const ring = await getTarlacProvinceOuterRing();
    if (!isInsideTarlacProvince(la, lo, ring.length >= 4 ? ring : null)) {
      setTarlacScopeHint(
        "Coordinates must fall inside Tarlac province. Adjust the map or enter a location within Tarlac.",
      );
      return;
    }

    if (mapPickParamsModalOpen) {
      const snap = mapPickSnapshotRef.current;
      if (snap) {
        setMapLat(snap.mapLat);
        setMapLng(snap.mapLng);
        setMapLabel(snap.mapLabel);
        setHeaderLat(snap.headerLat);
        setHeaderLng(snap.headerLng);
        setHeaderSearch(snap.headerSearch);
        setMapViewRestore({
          id: Date.now(),
          centerLat: snap.viewCenterLat,
          centerLng: snap.viewCenterLng,
          zoom: snap.viewZoom,
        });
        mapPickSnapshotRef.current = null;
      }
      setMapPickParamsModalOpen(false);
    }

    headerGoSnapshotRef.current = {
      mapLat,
      mapLng,
      mapLabel,
      headerLat,
      headerLng,
      headerSearch,
      analysisSiteLat,
      analysisSiteLng,
    };
    setMapLat(la);
    setMapLng(lo);
    setMapLabel(headerSearch.trim() || "Selected location");
    setFlyToPinToken((t) => t + 1);
    setShowHeaderGoParamsModal(true);
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 flex-col border-b border-slate-200 bg-white shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-4 px-4 py-3">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <LiquefactSquareMark size={40} className="rounded-lg" alt="" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">
                LIQUEFACT
              </p>
              <p className="truncate text-xs text-slate-500">
                Geotechnical Risk Analysis System
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <GeocodeSuggestInput
              value={headerSearch}
              onChange={setHeaderSearch}
              onSelectSuggestion={applyGeocodeHitToHeader}
              placeholder="Search places in Tarlac…"
              aria-label="Search location"
              className="w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <input
                type="text"
                value={headerLat}
                onChange={(e) => setHeaderLat(e.target.value)}
                placeholder="Latitude"
                className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-slate-900"
                aria-label="Latitude"
              />
              <input
                type="text"
                value={headerLng}
                onChange={(e) => setHeaderLng(e.target.value)}
                placeholder="Longitude"
                className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none focus:border-slate-900"
                aria-label="Longitude"
              />
              <button
                type="button"
                onClick={() => {
                  void applyHeaderGo();
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    setTarlacScopeHint(null);
                    if (!navigator.geolocation) {
                      setTarlacScopeHint(
                        "Geolocation is not supported in this browser.",
                      );
                      return;
                    }
                    navigator.geolocation.getCurrentPosition(
                      async (pos) => {
                        const la = pos.coords.latitude;
                        const lo = pos.coords.longitude;
                        const r = await getTarlacProvinceOuterRing();
                        if (
                          !isInsideTarlacProvince(
                            la,
                            lo,
                            r.length >= 4 ? r : null,
                          )
                        ) {
                          setTarlacScopeHint(
                            "Your position is outside Tarlac province. You can still pick a site on the map or enter coordinates for Tarlac.",
                          );
                          return;
                        }
                        setHeaderLat(String(la));
                        setHeaderLng(String(lo));
                        setMapLat(la);
                        setMapLng(lo);
                        setAnalysisSiteLat(la);
                        setAnalysisSiteLng(lo);
                        setMapLabel("My location");
                        setFlyToPinToken((t) => t + 1);
                      },
                      () => {
                        setTarlacScopeHint(
                          "Could not read your location. Allow access or enter coordinates manually.",
                        );
                      },
                      {
                        enableHighAccuracy: true,
                        timeout: 12_000,
                        maximumAge: 60_000,
                      },
                    );
                  })();
                }}
                className="rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Use My Location
              </button>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs font-medium text-slate-600 sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              System Active
            </span>
          </div>
        </div>
        {tarlacScopeHint ? (
          <p
            className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-snug text-amber-950"
            role="alert"
          >
            {tarlacScopeHint}
          </p>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="app-sidebar-scroll w-full max-w-sm shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4 font-sans">
          {analysisLoading ? (
            <div
              className="flex min-h-[min(420px,55vh)] flex-col items-center justify-center gap-5 rounded-xl border border-slate-200 bg-linear-to-b from-white to-slate-50/90 px-6 py-14 text-center shadow-sm"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="relative">
                <div
                  className="absolute inset-0 animate-ping rounded-full bg-emerald-400/25"
                  aria-hidden
                />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md">
                  <Loader2
                    className="h-8 w-8 animate-spin"
                    strokeWidth={2}
                    aria-hidden
                  />
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Running analysis
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Computing liquefaction, bearing capacity, and foundation
                  checks for this site.
                </p>
              </div>
              {boreholeLoading && boreholeProgress.total > 0 ? (
                <p className="max-w-[240px] text-[11px] tabular-nums text-slate-400">
                  Map layer {boreholeProgress.completed}/
                  {boreholeProgress.total} boreholes
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
                  <MapPin className="h-5 w-5" strokeWidth={2} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    {mapLabel}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {mapLat.toFixed(4)}°N, {mapLng.toFixed(4)}°E
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {nearestBorehole
                      ? `${nearestBorehole.distanceKm.toFixed(2)} km from nearest borehole`
                      : "Nearest borehole: —"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">
                  Liquefaction Analysis
                </p>
                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      Risk Level
                    </p>
                    <p
                      className={`mt-0.5 text-2xl font-bold leading-tight ${
                        hazardLabel === "Very Low" || hazardLabel === "Low"
                          ? "text-emerald-600"
                          : hazardLabel === "High"
                            ? "text-orange-600"
                            : hazardLabel === "Very High"
                              ? "text-red-600"
                              : "text-slate-800"
                      }`}
                    >
                      {hazardLabel}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-slate-500">Σ LPI</p>
                    <p
                      className={`mt-0.5 text-2xl font-bold tabular-nums ${
                        hazardLabel === "Very Low" || hazardLabel === "Low"
                          ? "text-emerald-600"
                          : hazardLabel === "High"
                            ? "text-orange-600"
                            : hazardLabel === "Very High"
                              ? "text-red-600"
                              : "text-slate-900"
                      }`}
                    >
                      {computedLpiSum !== null
                        ? formatNum(computedLpiSum)
                        : "—"}
                    </p>
                    {analysis?.totalLpi_remark ? (
                      <p
                        className={`mt-0.5 text-[11px] font-medium ${
                          hazardLabel === "Very Low" || hazardLabel === "Low"
                            ? "text-emerald-800/90"
                            : "text-slate-600"
                        }`}
                      >
                        {analysis.totalLpi_remark}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 border-t border-emerald-200/80 pt-3 text-xs text-slate-600">
                  Min FS (profile):{" "}
                  <span className="font-semibold tabular-nums text-slate-900">
                    {minFs !== null ? formatNum(minFs) : "—"}
                  </span>
                  {anyLiquefiable ? (
                    <span className="ml-2 font-medium text-red-700">
                      Liquefiable layer(s)
                    </span>
                  ) : analysis ? (
                    <span className="ml-2 font-medium text-emerald-800">
                      No liquefiable layer
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{
                      width: `${Math.min(100, computedLpiSum !== null && computedLpiSum > 0 ? (computedLpiSum / 20) * 100 : 0)}%`,
                    }}
                    aria-hidden
                  />
                </div>
                {analysisError ? (
                  <p className="mt-2 text-[11px] text-red-700">
                    {analysisError}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">
                  Soil Performance
                </p>
                <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-sm">
                  <li className="flex justify-between gap-3 border-b border-slate-100 pb-3">
                    <span className="text-slate-500">
                      Allowable Soil Bearing Capacity
                    </span>
                    <span className="max-w-[55%] text-right text-sm font-semibold tabular-nums text-slate-900 wrap-break-word">
                      {displayFooting
                        ? `${formatSbcValue(displayFooting.sbc_qa_new)} kPa`
                        : "—"}
                    </span>
                  </li>
                  <li className="flex justify-between gap-3 pt-0.5">
                    <span className="text-slate-500">Settlement</span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {displayFooting
                        ? `${formatNum(parseFloat(displayFooting.totalSettlement))} mm`
                        : "—"}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-900">
                  Foundation recommendation
                </p>
                {analysis && analysis.passed ? (
                  <ul className="mt-4 space-y-3 text-sm">
                    <li className="flex justify-between gap-2">
                      <span className="text-slate-500">
                        Base (B) of foundation
                      </span>
                      <span className="font-semibold tabular-nums text-blue-700">
                        {displayFooting
                          ? `${formatNum(displayFooting.footingWidth)} m`
                          : "—"}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span className="text-slate-500">
                        Depth (D) of foundation
                      </span>
                      <span className="font-semibold tabular-nums text-blue-700">
                        {params
                          ? `${formatNum(params.foundationDepthM)} m`
                          : "—"}
                      </span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    Consider other types of foundation.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="mt-4 space-y-2">
            {analysis && params && !analysisLoading ? (
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
                onClick={() => {
                  try {
                    downloadAnalysisPdf(analysis, {
                      placeName: mapLabel,
                      analysisLat: analysisSiteLat,
                      analysisLng: analysisSiteLng,
                      params,
                      tableWeight: DEFAULT_PREDICT_TABLE_WEIGHT,
                      nearestBoreholeKm: nearestBorehole?.distanceKm ?? null,
                    });
                  } catch (e) {
                    window.alert(
                      e instanceof Error
                        ? e.message
                        : "Could not generate PDF.",
                    );
                  }
                }}
              >
                <FileText
                  className="h-4 w-4 shrink-0"
                  strokeWidth={2}
                  aria-hidden
                />
                Export as PDF
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowEditParamsModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
            >
              <RefreshCw
                className="h-4 w-4 shrink-0"
                strokeWidth={2}
                aria-hidden
              />
              Edit location parameters
            </button>
          </div>

          {/* <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-800">
              Model + computation
            </p>
            <p className="mt-1 text-[11px] leading-snug text-indigo-700/80">
              <code className="rounded bg-indigo-100/80 px-1">
                computeLiquefaction
              </code>{" "}
              (POST /predict per depth, then geotechnical + footing iteration).
              Mw {params?.earthquakeMw ?? "—"}, table_weight{" "}
              {DEFAULT_PREDICT_TABLE_WEIGHT}.
            </p>
            {analysisLoading ? (
              <p className="mt-3 text-sm text-slate-600">Running analysis…</p>
            ) : null}
            {analysisError ? (
              <p
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800"
                role="alert"
              >
                {analysisError}
              </p>
            ) : null}
            {analysis && !analysisLoading ? (
              <ul className="mt-3 space-y-2 text-[11px] text-slate-800 sm:text-xs">
                <li className="border-b border-indigo-100 pb-1.5 text-slate-600">
                  Profile layers:{" "}
                  <span className="font-semibold text-slate-900">
                    {analysis.parameterTable.length}
                  </span>{" "}
                  (z = 1.5–15 m)
                </li>
                {shallowRow ? (
                  <>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">
                        γ (first layer)
                      </span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.totalUnitWeight)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">N₆₀</span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.n60)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">FC</span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.finesContent)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">PGA</span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.peakGroundAcceleration)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">GWL</span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.groundWaterLevel)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 border-b border-indigo-100 py-1.5">
                      <span className="shrink-0 text-slate-600">Soil type</span>
                      <span className="max-w-[55%] text-right font-semibold wrap-break-word">
                        {shallowRow.soilType}
                      </span>
                    </li>
                    <li className="flex justify-between gap-2 pt-1.5">
                      <span className="shrink-0 text-slate-600">
                        E (modulus)
                      </span>
                      <span className="text-right font-semibold tabular-nums">
                        {formatNum(shallowRow.modulusOfElasticity)}
                      </span>
                    </li>
                  </>
                ) : null}
              </ul>
            ) : null}
          </div> */}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-inner">
            <div className="h-full min-h-0">
              <TarlacMap
                selectedLat={mapLat}
                selectedLng={mapLng}
                placeName={mapLabel}
                boreholes={mapBoreholes}
                onLocationSelect={handleMapLocationSelect}
                flyToPinToken={flyToPinToken}
                mapViewRestore={mapViewRestore}
                onOutsideProvinceClick={() =>
                  setTarlacScopeHint(
                    "That point is outside Tarlac province. Click inside the blue outline to move the site pin.",
                  )
                }
              />
            </div>
            <div className="pointer-events-auto absolute bottom-8 left-8 z-20 max-w-[220px] rounded-xl border border-slate-200 bg-white/95 p-4 text-xs shadow-lg backdrop-blur-sm">
              <p className="font-bold uppercase tracking-wide text-slate-800">
                Liquefaction risk
              </p>
              <ul className="mt-3 space-y-2 text-slate-600">
                <li className="flex justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                    Very High
                  </span>
                  <span className="font-medium text-slate-900">
                    {legend.veryHigh}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                    High
                  </span>
                  <span className="font-medium text-slate-900">
                    {legend.high}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-600" />
                    Low
                  </span>
                  <span className="font-medium text-slate-900">
                    {legend.low}
                  </span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    Very Low
                  </span>
                  <span className="font-medium text-slate-900">
                    {legend.veryLow}
                  </span>
                </li>
              </ul>
              {boreholeLoading ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] text-slate-500">
                    Recomputing boreholes... {boreholeProgress.completed}/
                    {boreholeProgress.total || "—"}
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width]"
                      style={{width: `${boreholeProgress.percent}%`}}
                    />
                  </div>
                </div>
              ) : null}
              {boreholeError ? (
                <p className="mt-2 text-[11px] text-red-700">{boreholeError}</p>
              ) : null}
              <p className="mt-3 border-t border-slate-100 pt-2 text-slate-500">
                Total boreholes:{" "}
                <span className="font-semibold text-slate-800">
                  {legend.total}
                </span>
              </p>
              <p className="mt-2 text-[11px] leading-snug text-slate-500">
                Click the map to move the site pin and run analysis for that
                location.
              </p>
            </div>
          </div>

          {/* {analysis && !analysisLoading ? (
            <section className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  initialParameterTable
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  From POST /predict (per depth horizon).{" "}
                  <code className="rounded bg-slate-100 px-1 text-[10px]">
                    TEMP: remove
                  </code>{" "}
                  when done debugging.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          initialParameterTableToTsv(analysis.parameterTable),
                        );
                        setDebugTablesCopyHint(
                          "Copied initialParameterTable (TSV)",
                        );
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      } catch {
                        setDebugTablesCopyHint("Copy failed");
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      }
                    }}
                    className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-100"
                  >
                    Copy TSV
                  </button>
                  {debugTablesCopyHint ? (
                    <span className="text-[11px] font-medium text-slate-600">
                      {debugTablesCopyHint}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-amber-200/60">
                  <table className="w-max min-w-full border-collapse text-left text-[11px] text-slate-800">
                    <thead className="sticky top-0 z-10 bg-amber-100/95 text-slate-600">
                      <tr>
                        <th className="border-b border-amber-200 py-1.5 pr-2 pl-1 font-medium">
                          #
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          Lat
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          Lng
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          z (m)
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          Δz
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          γ
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          N₆₀
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          FC
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          M
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          PGA
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          GWL
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          Soil
                        </th>
                        <th className="border-b border-amber-200 py-1.5 pr-2 font-medium">
                          E
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.parameterTable.map((row, i) => (
                        <tr
                          key={`ipt-${row.depth}-${i}`}
                          className="border-b border-slate-100 odd:bg-slate-50/80"
                        >
                          <td className="py-1 pr-2 pl-1 tabular-nums text-slate-500">
                            {i + 1}
                          </td>
                          <td className="max-w-24 py-1 pr-2 tabular-nums wrap-break-word">
                            {formatNum(row.latitude)}
                          </td>
                          <td className="max-w-24 py-1 pr-2 tabular-nums wrap-break-word">
                            {formatNum(row.longitude)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.depth)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.layerThickness)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.totalUnitWeight)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.n60)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.finesContent)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.magnitude)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.peakGroundAcceleration)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.groundWaterLevel)}
                          </td>
                          <td className="max-w-20 py-1 pr-2 wrap-break-word">
                            {row.soilType}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.modulusOfElasticity)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  geotechnicalAnalysisTable
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Liquefaction-related computed columns per layer (string
                  expressions from the solver).
                </p>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const depths = analysis.parameterTable.map(
                          (p) => p.depth,
                        );
                        await navigator.clipboard.writeText(
                          geotechnicalTableToTsv(analysis.geoTable, depths),
                        );
                        setDebugTablesCopyHint(
                          "Copied geotechnicalAnalysisTable (TSV)",
                        );
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      } catch {
                        setDebugTablesCopyHint("Copy failed");
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    Copy TSV
                  </button>
                </div>
                <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-max min-w-full border-collapse text-left text-[10px] text-slate-800">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                      <tr>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 pl-1 font-medium">
                          #
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          z
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          u
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          σₜ
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          σ′
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          Cn
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          N160
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          ΔN
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          N160cs
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          m
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          Cn′
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          N160cs′
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          rd
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          CSR
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          MSFmax
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          MSF
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          K₀
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          CRR7.5
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          FS
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          R_FS
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          Fi
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          wf
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          LPI
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-1.5 font-medium">
                          R_LPI
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.geoTable.map((row, i) => (
                        <tr
                          key={`geo-${i}`}
                          className="border-b border-slate-100 odd:bg-slate-50/50"
                        >
                          <td className="py-1 pr-1.5 pl-1 tabular-nums text-slate-500">
                            {i + 1}
                          </td>
                          <td className="py-1 pr-1.5 tabular-nums text-slate-600">
                            {formatNum(
                              analysis.parameterTable[i]?.depth ?? NaN,
                            )}
                          </td>
                          <td className="max-w-28 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.porePressure}
                          </td>
                          <td className="max-w-28 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.totalStress}
                          </td>
                          <td className="max-w-28 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.effectiveStress}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.cn}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.n160}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.n160_2}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.n160cs}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.m}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.cn_final}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.n160cs_final}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.rd}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.csr}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.msfmax}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.msf}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.ko}
                          </td>
                          <td className="max-w-24 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.crr75}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.fs}
                          </td>
                          <td className="py-1 pr-1.5 font-medium wrap-break-word">
                            {row.remarks_fs}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.severity}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.weightingFactor}
                          </td>
                          <td className="max-w-20 py-1 pr-1.5 font-mono wrap-break-word">
                            {row.lpi}
                          </td>
                          <td className="py-1 pr-1.5 font-medium wrap-break-word">
                            {row.remarks_lpi}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  footingWidthIterationData
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  One row per trial footing width; includes nested{" "}
                  <code className="rounded bg-slate-100 px-1 text-[10px]">
                    settlementAnalysisTable
                  </code>{" "}
                  (layer-wise settlement) — count shown in last column.
                </p>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          footingIterationToTsv(analysis.footingRows),
                        );
                        setDebugTablesCopyHint(
                          "Copied footingWidthIterationData (TSV)",
                        );
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      } catch {
                        setDebugTablesCopyHint("Copy failed");
                        window.setTimeout(
                          () => setDebugTablesCopyHint(null),
                          2500,
                        );
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    Copy TSV
                  </button>
                </div>
                <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-max min-w-full border-collapse text-left text-[11px] text-slate-800">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                      <tr>
                        <th className="border-b border-slate-200 py-1.5 pr-2 pl-1 font-medium">
                          B (m)
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Tol. sett.
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Fd
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          N
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          N_design
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Nc
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          SBC qa
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          SBC qa new
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Remarks SBC
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Σ sett.
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          Sett. check
                        </th>
                        <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">
                          # settle rows
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.footingRows.map((row, i) => (
                        <tr
                          key={`foot-${row.footingWidth}-${i}`}
                          className="border-b border-slate-100 odd:bg-slate-50/50"
                        >
                          <td className="py-1 pr-2 pl-1 tabular-nums">
                            {formatNum(row.footingWidth)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {row.tolerableSettlement}
                          </td>
                          <td className="max-w-24 py-1 pr-2 font-mono wrap-break-word">
                            {row.depthFactor}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.n)}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {formatNum(row.n_design)}
                          </td>
                          <td className="max-w-20 py-1 pr-2 font-mono wrap-break-word">
                            {row.nc}
                          </td>
                          <td className="max-w-24 py-1 pr-2 font-mono wrap-break-word">
                            {row.sbc_qa}
                          </td>
                          <td className="max-w-28 py-1 pr-2 font-mono wrap-break-word">
                            {formatSbcValue(row.sbc_qa_new)}
                          </td>
                          <td className="max-w-36 py-1 pr-2 wrap-break-word">
                            {row.remarks_sbc}
                          </td>
                          <td className="max-w-24 py-1 pr-2 font-mono wrap-break-word">
                            {row.totalSettlement}
                          </td>
                          <td className="py-1 pr-2 font-medium">
                            {row.remarks_settlement}
                          </td>
                          <td className="py-1 pr-2 tabular-nums text-slate-600">
                            {row.settlementAnalysisTable.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                  <p className="text-[11px] font-semibold text-slate-800">
                    View every iteration (expand rows)
                  </p>
                  <div className="mt-2 space-y-2">
                    {analysis.footingRows.map((row, i) => (
                      <details
                        key={`iter-details-${row.footingWidth}-${i}`}
                        className="group rounded-md border border-slate-200 bg-white px-3 py-2"
                      >
                        <summary className="cursor-pointer select-none text-[11px] font-semibold text-slate-900">
                          Iteration {i + 1}: B={formatNum(row.footingWidth)} m ·
                          settlement {row.remarks_settlement} · Σsett{" "}
                          {row.totalSettlement} mm · SBC new{" "}
                          {formatSbcValue(row.sbc_qa_new)}
                        </summary>

                        <div className="mt-3 grid gap-2 text-[11px] text-slate-800 sm:grid-cols-2">
                          <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                            <p className="font-medium text-slate-600">
                              Bearing / SBC
                            </p>
                            <div className="mt-1 space-y-1 tabular-nums">
                              <div>tolerableSettlement: {row.tolerableSettlement}</div>
                              <div>depthFactor (Fd): {row.depthFactor}</div>
                              <div>N (Meyerhof): {formatNum(row.n)}</div>
                              <div>N_design: {formatNum(row.n_design)}</div>
                              <div>Nc: {row.nc}</div>
                              <div>sbc_qa: {row.sbc_qa}</div>
                              <div>sbc_qa_new: {formatSbcValue(row.sbc_qa_new)}</div>
                              <div>remarks_sbc: {row.remarks_sbc}</div>
                            </div>
                          </div>

                          <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
                            <p className="font-medium text-slate-600">
                              Settlement summary
                            </p>
                            <div className="mt-1 space-y-1 tabular-nums">
                              <div>totalSettlement (Σ): {row.totalSettlement} mm</div>
                              <div>remarks_settlement: {row.remarks_settlement}</div>
                              <div>
                                settlementAnalysisTable rows:{" "}
                                {row.settlementAnalysisTable.length}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  settlementAnalysisToTsv(row.settlementAnalysisTable),
                                );
                                setDebugTablesCopyHint(
                                  `Copied settlementAnalysisTable (iter ${i + 1}) (TSV)`,
                                );
                                window.setTimeout(
                                  () => setDebugTablesCopyHint(null),
                                  2500,
                                );
                              } catch {
                                setDebugTablesCopyHint("Copy failed");
                                window.setTimeout(
                                  () => setDebugTablesCopyHint(null),
                                  2500,
                                );
                              }
                            }}
                            className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                          >
                            Copy settlementAnalysisTable TSV
                          </button>
                        </div>

                        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
                          <div className="min-w-full overflow-x-auto">
                            <table className="w-max min-w-full border-collapse text-left text-[10px] text-slate-800">
                            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                              <tr>
                                <th className="border-b border-slate-200 py-1.5 pr-2 pl-1 font-medium">
                                  # (layer)
                                </th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">lat</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">lng</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">z</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">P</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">B</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">γ</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">N₆₀</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">E</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Wf</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">q_gross</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Df</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">GWL</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">u@Df</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">σ′@Df</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">qn</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Po</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Izp</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Iz</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">Δz</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">C1</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">t</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">C2</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">elastic</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">FS</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">R_FS</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">εv</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">vol.</th>
                                <th className="border-b border-slate-200 py-1.5 pr-2 font-medium">settlement</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.settlementAnalysisTable.map((s, j) => (
                                <tr
                                  key={`settle-${i}-${j}`}
                                  className="border-b border-slate-100 odd:bg-slate-50/50"
                                >
                                  <td className="py-1 pr-2 pl-1 tabular-nums text-slate-500">
                                    {j + 1}
                                  </td>
                                  <td className="py-1 pr-2 tabular-nums">{formatNum(s.latitude)}</td>
                                  <td className="py-1 pr-2 tabular-nums">{formatNum(s.longitude)}</td>
                                  <td className="py-1 pr-2 tabular-nums">{formatNum(s.depthOfSoil)}</td>
                                  <td className="py-1 pr-2 tabular-nums">{formatNum(s.buildingLoad)}</td>
                                  <td className="py-1 pr-2 tabular-nums">{formatNum(s.Width_B)}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.unitWeight}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.sptNValue}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.modulusOfElasticity}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.weightOfFooting}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.q_gross}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.depthOfFooting}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.groundWaterLevel}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.porewaterAtFoundationLevel}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.effectiveOverburdenPressureAtFoundationLevel}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.netFoundationContactPressure}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.Po}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.peakStrainInfluenceFactor}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.strainInfluenceFactor}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.layerThickness}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.correctionFactorC1}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.elapsedTimeInYears}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.correctionFactorC2}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.elasticSettlement}</td>
                                  <td className="py-1 pr-2 tabular-nums">{s.fs}</td>
                                  <td className="py-1 pr-2 font-medium">{s.remarks_fs}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.volumetricStrain}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.volumetricSettlement}</td>
                                  <td className="py-1 pr-2 font-mono wrap-break-word">{s.settlement}</td>
                                </tr>
                              ))}
                            </tbody>
                            </table>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null} */}
        </div>
      </div>
      {showEditParamsModal && params ? (
        <LocationParametersModal
          initialValues={params}
          submitLabel="Save & Recompute"
          onCancel={() => setShowEditParamsModal(false)}
          onAnalyze={(nextParams) => {
            setParams(nextParams);
            setShowEditParamsModal(false);
          }}
        />
      ) : null}
      {mapPickParamsModalOpen && params ? (
        <LocationParametersModal
          key={`map-pick-${mapLat}-${mapLng}`}
          title="Analyze this location"
          description={`Site pin moved to ${mapLat.toFixed(5)}°N, ${mapLng.toFixed(5)}°E. Confirm or edit parameters below, then run analysis.`}
          initialValues={params}
          submitLabel="Analyze this location"
          onCancel={() => {
            const snap = mapPickSnapshotRef.current;
            if (snap) {
              setMapLat(snap.mapLat);
              setMapLng(snap.mapLng);
              setMapLabel(snap.mapLabel);
              setHeaderLat(snap.headerLat);
              setHeaderLng(snap.headerLng);
              setHeaderSearch(snap.headerSearch);
              setMapViewRestore({
                id: Date.now(),
                centerLat: snap.viewCenterLat,
                centerLng: snap.viewCenterLng,
                zoom: snap.viewZoom,
              });
              mapPickSnapshotRef.current = null;
            }
            setMapPickParamsModalOpen(false);
          }}
          onAnalyze={(nextParams) => {
            setAnalysisSiteLat(mapLat);
            setAnalysisSiteLng(mapLng);
            setParams(nextParams);
            mapPickSnapshotRef.current = null;
            setMapPickParamsModalOpen(false);
          }}
        />
      ) : null}
      {showHeaderGoParamsModal && params ? (
        <LocationParametersModal
          key={`header-go-${mapLat}-${mapLng}`}
          title="Analyze this location"
          description={`Coordinates ${mapLat.toFixed(5)} deg N, ${mapLng.toFixed(5)} deg E. Confirm or edit parameters below, then run analysis for this site.`}
          initialValues={params}
          submitLabel="Analyze this location"
          onCancel={() => {
            const snap = headerGoSnapshotRef.current;
            if (snap) {
              setMapLat(snap.mapLat);
              setMapLng(snap.mapLng);
              setMapLabel(snap.mapLabel);
              setHeaderLat(snap.headerLat);
              setHeaderLng(snap.headerLng);
              setHeaderSearch(snap.headerSearch);
              setAnalysisSiteLat(snap.analysisSiteLat);
              setAnalysisSiteLng(snap.analysisSiteLng);
              headerGoSnapshotRef.current = null;
              setFlyToPinToken((t) => t + 1);
            }
            setShowHeaderGoParamsModal(false);
          }}
          onAnalyze={(nextParams) => {
            setAnalysisSiteLat(mapLat);
            setAnalysisSiteLng(mapLng);
            setParams(nextParams);
            headerGoSnapshotRef.current = null;
            setShowHeaderGoParamsModal(false);
          }}
        />
      ) : null}
    </div>
  );
}

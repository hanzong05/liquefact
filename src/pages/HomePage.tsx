import {ArrowRight, Loader2, MapPin, Search} from "lucide-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {GeocodeSuggestInput} from "../components/GeocodeSuggestInput";
import {TarlacMap} from "../components/TarlacMap";
import {DEFAULT_SITE_LAT, DEFAULT_SITE_LNG} from "../routes/locationState";
import {reverseLookup, searchLocation} from "../utils/geocoding";
import {
  getTarlacProvinceOuterRing,
  isInsideTarlacProvince,
} from "../utils/tarlacGeography";
import {
  LiquefactLandscapeWordmark,
  LiquefactSquareMark,
} from "../components/LiquefactBrandAssets";
import {type DbBoreholeRecord, getBoreholes} from "../api/liquefactPredict";

function OrDivider() {
  return (
    <div className="relative py-1">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <div className="w-full border-t border-slate-200" />
      </div>
      <div className="relative flex justify-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
        <span className="bg-white px-2">Or</span>
      </div>
    </div>
  );
}

function formatCoord(n: number) {
  return n.toFixed(6);
}

export function HomePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [lat, setLat] = useState(String(DEFAULT_SITE_LAT));
  const [lng, setLng] = useState(String(DEFAULT_SITE_LNG));
  const [error, setError] = useState<string | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [mapResolveBusy, setMapResolveBusy] = useState(false);
  const [flyToPinToken, setFlyToPinToken] = useState(0);
  const [databaseBoreholes, setDatabaseBoreholes] = useState<DbBoreholeRecord[]>([]);
  const boreholeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    boreholeAbortRef.current = ac;
    getBoreholes(ac.signal)
      .then(setDatabaseBoreholes)
      .catch(() => { /* silently ignore — map still usable without borehole overlay */ });
    return () => ac.abort();
  }, []);

  const parsedCoords = useMemo(() => {
    const la = Number.parseFloat(lat);
    const lo = Number.parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return {lat: la, lng: lo};
  }, [lat, lng]);

  const mapMarkerName = useMemo(() => {
    const t = search.trim();
    if (t) return t;
    if (parsedCoords) return "Selected location";
    return "Location";
  }, [search, parsedCoords]);

  const goToAnalysis = useCallback(
    async (placeName: string) => {
      if (!parsedCoords) {
        setError("Enter valid latitude and longitude numbers.");
        return;
      }
      const ring = await getTarlacProvinceOuterRing();
      if (
        !isInsideTarlacProvince(
          parsedCoords.lat,
          parsedCoords.lng,
          ring.length >= 4 ? ring : null,
        )
      ) {
        setError(
          "Coordinates must be inside Tarlac province. Search for a place in Tarlac or click inside the map outline.",
        );
        return;
      }
      setError(null);
      navigate("/analysis", {
        state: {
          lat: parsedCoords.lat,
          lng: parsedCoords.lng,
          placeName: placeName.trim() || "Selected location",
        },
      });
    },
    [navigate, parsedCoords],
  );

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = search.trim();
    if (!q) {
      setError("Type a place name or address to search.");
      return;
    }
    setError(null);
    setSearchBusy(true);
    try {
      const hit = await searchLocation(q);
      if (!hit) {
        setError("No results in Tarlac for that search. Try another name.");
        return;
      }
      setLat(formatCoord(hit.lat));
      setLng(formatCoord(hit.lng));
      setSearch(hit.displayName);
    } catch {
      setError("Search failed. Check your connection and try again.");
    } finally {
      setSearchBusy(false);
    }
  };

  const handleMapSelect = async (mla: number, mlo: number) => {
    setError(null);
    setLat(formatCoord(mla));
    setLng(formatCoord(mlo));
    setFlyToPinToken((t) => t + 1);
    setMapResolveBusy(true);
    try {
      const name = await reverseLookup(mla, mlo);
      if (name) setSearch(name);
    } catch {
      /* keep coords; label stays as previous search or empty */
    } finally {
      setMapResolveBusy(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported in this browser.");
      return;
    }
    setError(null);
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        const ring = await getTarlacProvinceOuterRing();
        if (!isInsideTarlacProvince(la, lo, ring.length >= 4 ? ring : null)) {
          setGeoBusy(false);
          setError(
            "Your current position is outside Tarlac. This app only covers Tarlac province — pick a point on the map or search there.",
          );
          return;
        }
        setLat(formatCoord(la));
        setLng(formatCoord(lo));
        setMapResolveBusy(true);
        try {
          const name = await reverseLookup(la, lo);
          setSearch(name ?? "My location");
        } finally {
          setMapResolveBusy(false);
          setGeoBusy(false);
        }
      },
      (err) => {
        setGeoBusy(false);
        if (err.code === 1) {
          setError(
            "Location permission denied. Allow access or enter coordinates.",
          );
        } else if (err.code === 2) {
          setError(
            "Could not read your position. Try again or enter coordinates.",
          );
        } else {
          setError("Could not get your location. Try again.");
        }
      },
      {enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000},
    );
  };

  const mapLat = parsedCoords?.lat ?? DEFAULT_SITE_LAT;
  const mapLng = parsedCoords?.lng ?? DEFAULT_SITE_LNG;

  return (
    <div className="relative flex h-svh max-h-svh flex-col overflow-hidden bg-[#f6f7f4] text-slate-800">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.12)_0%,transparent_55%)]"
        aria-hidden
      />

      <main className="relative mx-auto flex w-full min-h-0 flex-1 flex-col px-4 py-3 sm:px-5 lg:max-w-7xl lg:flex-row lg:items-stretch lg:gap-0 lg:py-5 xl:px-8">
        <div className="flex w-full min-w-0 shrink-0 flex-col items-center gap-4 lg:h-full lg:min-h-0 lg:w-[min(26rem,38vw)] lg:max-w-md lg:flex-initial lg:border-r lg:border-slate-200/70 lg:pr-8">
          <div className="flex w-full flex-col items-center gap-4 lg:min-h-0 lg:flex-1 lg:justify-center">
            <div className="flex w-full shrink-0 flex-col items-center gap-3 text-center">
              <h1 className="sr-only">Liquefact</h1>
              <LiquefactLandscapeWordmark className="max-h-12 sm:max-h-14" />
              <LiquefactSquareMark
                size={52}
                className="rounded-2xl ring-slate-900/15 lg:hidden"
                aria-hidden
                alt=""
              />
              <p className="max-w-sm px-1 text-xs leading-snug text-slate-600 sm:text-[13px]">
                Geotechnical risk analysis for any location. Select a point to
                begin your soil assessment.
              </p>
            </div>
            <div className="w-full max-w-md shrink-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-md shadow-slate-200/40 lg:shadow-lg lg:shadow-slate-200/30">
              <div className="flex flex-col gap-3">
                {error ? (
                  <p
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-800"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}

                <div>
                  <p className="text-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Search location
                  </p>
                  <form
                    onSubmit={runSearch}
                    className="relative mt-1.5 flex gap-2"
                  >
                    <div className="relative min-w-0 flex-1">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <GeocodeSuggestInput
                        value={search}
                        onChange={setSearch}
                        onSelectSuggestion={(hit) => {
                          setLat(formatCoord(hit.lat));
                          setLng(formatCoord(hit.lng));
                          setSearch(hit.displayName);
                          setError(null);
                          setFlyToPinToken((t) => t + 1);
                        }}
                        placeholder="Search places in Tarlac…"
                        disabled={searchBusy}
                        aria-label="Search location"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-3 text-sm outline-none ring-emerald-600/20 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 disabled:opacity-60"
                      />
                    </div>
                    {/* <button
                  type="submit"
                  disabled={searchBusy}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-emerald-400 hover:bg-emerald-50/60 disabled:opacity-60"
                >
                  {searchBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    'Find'
                  )}
                </button> */}
                  </form>
                </div>

                <OrDivider />

                <div>
                  <p className="text-center text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Enter coordinates
                  </p>
                  <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <label htmlFor="lat" className="sr-only">
                        Latitude
                      </label>
                      <input
                        id="lat"
                        value={lat}
                        onChange={(e) => setLat(e.target.value)}
                        placeholder="Latitude"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-600/20"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="lng" className="sr-only">
                        Longitude
                      </label>
                      <input
                        id="lng"
                        value={lng}
                        onChange={(e) => setLng(e.target.value)}
                        placeholder="Longitude"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-600/20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void goToAnalysis(search.trim() || "Selected location")
                      }
                      disabled={!parsedCoords}
                      className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Go
                      <ArrowRight
                        className="h-4 w-4"
                        strokeWidth={2}
                        aria-hidden
                      />
                    </button>
                  </div>
                </div>

                <OrDivider />

                <button
                  type="button"
                  onClick={useMyLocation}
                  disabled={geoBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2 text-sm font-semibold text-slate-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 disabled:opacity-60"
                >
                  {geoBusy ? (
                    <Loader2
                      className="h-4 w-4 animate-spin text-emerald-600"
                      aria-hidden
                    />
                  ) : (
                    <MapPin
                      className="h-4 w-4 text-emerald-600"
                      strokeWidth={2}
                    />
                  )}
                  Use My Location
                </button>
              </div>
            </div>

            <p className="max-w-md shrink-0 text-center text-[11px] leading-tight text-slate-500">
              Search and map picks are limited to Tarlac province. Click the map
              to set coordinates
              {mapResolveBusy ? " (resolving place name…)" : ""}
            </p>
          </div>
        </div>

        <div className="mt-3 flex min-h-[220px] w-full flex-1 flex-col pb-2 sm:min-h-[260px] lg:mt-0 lg:min-h-0 lg:flex-1 lg:pl-2 lg:pb-0">
          <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200 shadow-inner ring-1 ring-slate-900/5">
            <TarlacMap
              selectedLat={mapLat}
              selectedLng={mapLng}
              placeName={mapMarkerName}
              databaseBoreholes={databaseBoreholes}
              onLocationSelect={handleMapSelect}
              flyToPinToken={flyToPinToken}
              onOutsideProvinceClick={() =>
                setError(
                  "Choose a point inside Tarlac province (inside the blue outline on the map).",
                )
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}

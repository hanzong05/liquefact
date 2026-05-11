import {useCallback, useEffect, useId, useRef, useState} from "react";
import {Loader2, MapPin} from "lucide-react";
import {searchLocationSuggestions, type GeocodeHit} from "../utils/geocoding";

const DEBOUNCE_MS = 380;
const MIN_QUERY = 2;
const MAX_SUGGESTIONS = 6;

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (next: string) => void;
  onSelectSuggestion: (hit: GeocodeHit) => void;
};

export function GeocodeSuggestInput({
  value,
  onChange,
  onSelectSuggestion,
  className,
  disabled,
  ...rest
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<GeocodeHit[]>([]);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setHits([]);
      setBusy(false);
      return;
    }

    let cancelled = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      void (async () => {
        try {
          const list = await searchLocationSuggestions(q, MAX_SUGGESTIONS);
          if (!cancelled) setHits(list);
        } catch {
          if (!cancelled) setHits([]);
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || !open) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const pick = useCallback(
    (hit: GeocodeHit) => {
      onSelectSuggestion(hit);
      setOpen(false);
      setHits([]);
    },
    [onSelectSuggestion],
  );

  const showNoMatches =
    open &&
    !disabled &&
    !busy &&
    value.trim().length >= MIN_QUERY &&
    hits.length === 0;
  const showList =
    open && !disabled && (hits.length > 0 || busy || showNoMatches);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        {...rest}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className={className}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-left text-sm shadow-lg"
        >
          {busy && hits.length === 0 ? (
            <li className="flex items-center gap-2 px-3 py-2 text-slate-500">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              Searching…
            </li>
          ) : null}
          {showNoMatches ? (
            <li className="px-3 py-2 text-xs leading-snug text-slate-500">
              No places in Tarlac match that text. Try another spelling or pick
              a point on the map.
            </li>
          ) : null}
          {hits.map((hit, i) => (
            <li key={`${hit.lat},${hit.lng},${i}`} role="none">
              <button
                type="button"
                role="option"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-slate-800 hover:bg-emerald-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
              >
                <MapPin
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                  strokeWidth={2}
                  aria-hidden
                />
                <span className="min-w-0 leading-snug wrap-break-word">
                  {hit.displayName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

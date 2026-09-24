"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_SEGMENTS } from "@/lib/screenerSegments";
import { formatDDMMYYYY, formatTimestampDDMMYYYY } from "@/lib/dateFormat";

type ListChoice = "tzBuy" | "tzBuyEntry";
type ReturnSort = "desc" | "asc" | null;

interface ScripMatch {
  symbol: string;
  name: string;
}

const NA = "NA";

// NSE Equity (~2,600 instruments) is too large for one serverless
// invocation to scan within Vercel's time limit -- doing so previously
// got the whole request's connection killed mid-scan, which shows up in
// the browser as a raw "page couldn't load" error rather than a clean
// in-app one. Scanning in small batches keeps each request comfortably
// under any reasonable timeout; a segment smaller than BATCH_SIZE (every
// segment except NSE Equity) still completes in a single batch, so this
// applies uniformly regardless of which segment is selected.
const BATCH_SIZE = 150;
const BATCH_CONCURRENCY = 3;

interface ScreenerBatchResponse {
  total?: number;
  scanned?: number;
  tzBuy?: ScreenerRow[];
  tzBuyEntry?: ScreenerRow[];
  errors?: string[];
  cached?: boolean;
  error?: string;
}

function fmt(n: number): string {
  return Number.isNaN(n) ? NA : n.toFixed(2);
}

function fmtPercent(n: number): string {
  return Number.isNaN(n) ? NA : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function EntryZone() {
  const [choice, setChoice] = useState<ListChoice>("tzBuyEntry");
  const [segment, setSegment] = useState("");
  const [tzBuy, setTzBuy] = useState<ScreenerRow[]>([]);
  const [tzBuyEntry, setTzBuyEntry] = useState<ScreenerRow[]>([]);
  const [scanned, setScanned] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastScanned, setLastScanned] = useState("");
  const [cachedResult, setCachedResult] = useState(false);
  const [scanProgress, setScanProgress] = useState("");

  const [scripQuery, setScripQuery] = useState("");
  const [scripSuggestions, setScripSuggestions] = useState<ScripMatch[]>([]);
  const [showScripSuggestions, setShowScripSuggestions] = useState(false);
  const [scripHighlighted, setScripHighlighted] = useState(-1);
  const [selectedScrip, setSelectedScrip] = useState<ScripMatch | null>(null);
  const scripDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [yearFilter, setYearFilter] = useState("");
  const [returnSort, setReturnSort] = useState<ReturnSort>(null);

  function onChoiceChange(next: ListChoice) {
    setChoice(next);
    setSegment("");
    setTzBuy([]);
    setTzBuyEntry([]);
    setLastScanned("");
    setError("");
    clearScripSearch();
    setYearFilter("");
    setReturnSort(null);
  }

  function onSegmentChange(next: string) {
    setSegment(next);
    setTzBuy([]);
    setTzBuyEntry([]);
    setLastScanned("");
    setError("");
    clearScripSearch();
    setYearFilter("");
    setReturnSort(null);
  }

  // Clicking the "Prime Trend" nav link while already on this page doesn't
  // trigger a Next.js navigation (same route), so Sidebar dispatches this
  // event instead -- reset the Search/Year/% Return filters and fall back
  // to the main, unfiltered list.
  useEffect(() => {
    function resetFilters() {
      clearScripSearch();
      setYearFilter("");
      setReturnSort(null);
    }
    window.addEventListener("prime-trend-filters-reset", resetFilters);
    return () => window.removeEventListener("prime-trend-filters-reset", resetFilters);
  }, []);

  // Cycles % Return sort: off (Active as on, newest first) -> descending ->
  // ascending -> back to off.
  function cycleReturnSort() {
    setReturnSort((prev) => (prev === null ? "desc" : prev === "desc" ? "asc" : null));
  }

  async function fetchScanBatch(offset: number, limit: number): Promise<ScreenerBatchResponse> {
    const res = await fetch(
      `/api/screener?segment=${encodeURIComponent(segment)}&offset=${offset}&limit=${limit}`
    );
    const data: ScreenerBatchResponse = await res.json();
    if (!res.ok) throw new Error(data.error || "Scan failed");
    return data;
  }

  async function runScan() {
    if (!segment) return;
    setLoading(true);
    setError("");
    setScanProgress("");
    try {
      const first = await fetchScanBatch(0, BATCH_SIZE);
      const tzBuyAll = [...(first.tzBuy || [])];
      const tzBuyEntryAll = [...(first.tzBuyEntry || [])];
      const errorsAll = [...(first.errors || [])];
      let scannedTotal = first.scanned || 0;
      let allCached = !!first.cached;
      const total = first.total ?? scannedTotal;

      setScanProgress(`${scannedTotal} / ${total}`);

      const remainingOffsets: number[] = [];
      for (let off = BATCH_SIZE; off < total; off += BATCH_SIZE) remainingOffsets.push(off);

      let idx = 0;
      async function worker() {
        while (idx < remainingOffsets.length) {
          const off = remainingOffsets[idx++];
          const batch = await fetchScanBatch(off, BATCH_SIZE);
          tzBuyAll.push(...(batch.tzBuy || []));
          tzBuyEntryAll.push(...(batch.tzBuyEntry || []));
          errorsAll.push(...(batch.errors || []));
          scannedTotal += batch.scanned || 0;
          allCached = allCached && !!batch.cached;
          setScanProgress(`${scannedTotal} / ${total}`);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(BATCH_CONCURRENCY, remainingOffsets.length) }, worker)
      );

      setTzBuy(tzBuyAll);
      setTzBuyEntry(tzBuyEntryAll);
      setScanned(scannedTotal);
      setErrors(errorsAll);
      setCachedResult(allCached);
      setLastScanned(formatTimestampDDMMYYYY(new Date()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
      setScanProgress("");
    }
  }

  useEffect(() => {
    if (scripDebounceRef.current) clearTimeout(scripDebounceRef.current);
    if (scripQuery.trim().length < 1 || selectedScrip?.symbol === scripQuery) {
      setScripSuggestions([]);
      return;
    }
    scripDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/screener/search?q=${encodeURIComponent(scripQuery)}`);
        const data = await res.json();
        setScripSuggestions(data.results || []);
        setScripHighlighted(-1);
      } catch {
        setScripSuggestions([]);
      }
    }, 300);
    return () => {
      if (scripDebounceRef.current) clearTimeout(scripDebounceRef.current);
    };
  }, [scripQuery, selectedScrip]);

  function pickScripSuggestion(match: ScripMatch) {
    setSelectedScrip(match);
    setScripQuery(`${match.name} (${match.symbol})`);
    setScripSuggestions([]);
    setShowScripSuggestions(false);
    setScripHighlighted(-1);
  }

  function clearScripSearch() {
    setSelectedScrip(null);
    setScripQuery("");
    setScripSuggestions([]);
    setShowScripSuggestions(false);
    setScripHighlighted(-1);
  }

  function handleScripKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showScripSuggestions || scripSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setScripHighlighted((i) => Math.min(i + 1, scripSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setScripHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (scripHighlighted >= 0 && scripHighlighted < scripSuggestions.length) {
        e.preventDefault();
        pickScripSuggestion(scripSuggestions[scripHighlighted]);
      }
    } else if (e.key === "Escape") {
      setShowScripSuggestions(false);
      setScripHighlighted(-1);
    }
  }

  const activeList = choice === "tzBuy" ? tzBuy : tzBuyEntry;

  // Years present in the current tab's active list, latest first, for the
  // Year filter dropdown.
  const availableYears = Array.from(new Set(activeList.map((r) => r.activeAsOn.slice(0, 4)))).sort(
    (a, b) => b.localeCompare(a)
  );

  // Default order is newest activation first. A searched scrip narrows the
  // table to just that one scrip: its own row if it's currently active for
  // this tab, or an "NA" placeholder row (name only) if it isn't -- the
  // Year filter and % Return sort are both ignored while a scrip is
  // selected. Otherwise, the Year filter narrows the list, and % Return
  // sort (toggled via the two arrows in that column header) overrides the
  // default Active-as-on ordering while it's set to descending/ascending;
  // cycling it back to "off" returns to Active-as-on, newest first.
  const rows = selectedScrip
    ? (() => {
        const match = activeList.find((r) => r.symbol === selectedScrip.symbol);
        if (match) return [match];
        return [
          {
            symbol: selectedScrip.symbol,
            name: selectedScrip.name,
            activeAsOn: NA,
            activationPrice: NaN,
            stopLoss: NaN,
            lowestLowPostEntry: NaN,
            highestHigh: NaN,
            percentReturn: NaN,
            currentClose: NaN,
          },
        ];
      })()
    : [...activeList]
        .filter((r) => !yearFilter || r.activeAsOn.slice(0, 4) === yearFilter)
        .sort((a, b) =>
          returnSort
            ? returnSort === "desc"
              ? b.percentReturn - a.percentReturn
              : a.percentReturn - b.percentReturn
            : b.activeAsOn.localeCompare(a.activeAsOn)
        );

  return (
    <main className="container">
      <h1>Prime Trend</h1>
      <p className="subtitle">
        DTF/WTF dual-timeframe screener — Part A: stocks whose weekly timeframe (WTF) is
        currently active with TZ BUY 2, and whose daily timeframe (DTF) has broken out above it.
        Part B (WTF at plain BAR level) isn&apos;t built yet.
      </p>

      <div className="card">
        <div className="tabs">
          <button
            className={choice === "tzBuy" ? "tab active" : "tab"}
            onClick={() => onChoiceChange("tzBuy")}
          >
            DTF trading with TZ BUY
          </button>
          <button
            className={choice === "tzBuyEntry" ? "tab active" : "tab"}
            onClick={() => onChoiceChange("tzBuyEntry")}
          >
            DTF TZ BUY ENTRY
          </button>
        </div>
        <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
          {choice === "tzBuy"
            ? "Above WTF TZ BUY 2 reference high"
            : "DTF's own TZ BUY 2, above DTF TZ BUY"}
        </p>
        <label className="muted" htmlFor="segment-select" style={{ display: "block", marginBottom: "0.35rem" }}>
          Segment
        </label>
        <select
          id="segment-select"
          value={segment}
          onChange={(e) => onSegmentChange(e.target.value)}
          style={{ marginBottom: "1rem" }}
        >
          <option value="">Select a segment…</option>
          {SCREENER_SEGMENTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <br />
        <button onClick={runScan} disabled={loading || !segment}>
          {loading ? (scanProgress ? `Scanning… ${scanProgress}` : "Scanning…") : "Scan universe"}
        </button>
        {error && <div className="error">{error}</div>}
        {lastScanned && (
          <p className="muted event-disclaimer">
            {cachedResult ? "Loaded instantly from today's cached scan" : "Freshly scanned"}
            {" "}
            ({scanned} instrument(s) in{" "}
            {SCREENER_SEGMENTS.find((s) => s.key === segment)?.label || segment}) at {lastScanned}
            {cachedResult
              ? ". This segment won't need re-scanning again today -- the underlying data only refreshes once daily."
              : ". Cached now, so the next scan of this segment today will load instantly."}
            {" "}
            Simplified first version: DTF is
            anchored off WTF&apos;s current TZ BUY 2 reference and then runs independently — the
            full pause/dormant/race WTF state machine isn&apos;t ported yet. Activation price is a
            one-time snapshot of DTF&apos;s own TZ BUY reference, taken when this list&apos;s
            milestone formed (can differ between the two lists). Stop loss price is that
            milestone&apos;s own live SL level — it ratchets down to a new reference low as one
            forms, unlike Activation price&apos;s one-time snapshot. Lowest low post entry is the
            lowest daily low made strictly after the entry day and strictly before today; it
            shows NA until at least one full day has closed since entry. Highest high is
            WTF&apos;s own weekly high, live — but freezes the moment WTF hits RED2 or BAR SL2,
            resuming only once price trades back above that frozen level. % Return is the change
            from Activation price to Highest high.
            {errors.length > 0 && ` ${errors.length} stock(s) failed to fetch and were skipped.`}
          </p>
        )}
      </div>

      {lastScanned && (
        <div className="card">
          <div className="row">
            <div className="field" style={{ flex: "2 1 260px", marginBottom: 0 }}>
              <label htmlFor="scrip-search">Search scrip (NSE)</label>
              <input
                id="scrip-search"
                type="text"
                placeholder="e.g. Reliance, TCS, Asian Paints…"
                value={scripQuery}
                onChange={(e) => {
                  setScripQuery(e.target.value);
                  setSelectedScrip(null);
                  setShowScripSuggestions(true);
                }}
                onFocus={() => setShowScripSuggestions(true)}
                onBlur={() => setTimeout(() => setShowScripSuggestions(false), 150)}
                onKeyDown={handleScripKeyDown}
                autoComplete="off"
                role="combobox"
                aria-expanded={showScripSuggestions && scripSuggestions.length > 0}
                aria-activedescendant={
                  scripHighlighted >= 0 ? `scrip-suggestion-${scripHighlighted}` : undefined
                }
              />
              {showScripSuggestions && scripSuggestions.length > 0 && (
                <div className="suggestions">
                  {scripSuggestions.map((s, i) => (
                    <div
                      key={s.symbol}
                      id={`scrip-suggestion-${i}`}
                      className={i === scripHighlighted ? "suggestion-item active" : "suggestion-item"}
                      onMouseDown={() => pickScripSuggestion(s)}
                      onMouseEnter={() => setScripHighlighted(i)}
                    >
                      <div>{s.symbol}</div>
                      <div className="name">{s.name}</div>
                    </div>
                  ))}
                </div>
              )}
              {selectedScrip && (
                <button
                  type="button"
                  className="secondary"
                  onClick={clearScripSearch}
                  style={{ marginTop: "0.6rem" }}
                >
                  Clear search
                </button>
              )}
            </div>

            <div className="field" style={{ flex: "1 1 160px", marginBottom: 0 }}>
              <label htmlFor="year-filter">Year (Active as on)</label>
              <select
                id="year-filter"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                disabled={!!selectedScrip || availableYears.length === 0}
              >
                <option value="">All years</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-left">Symbol</th>
                  <th className="col-left">Co. Name</th>
                  <th>Active as on</th>
                  <th>{choice === "tzBuy" ? "TZ BUY entry above" : "Activation price"}</th>
                  {choice === "tzBuyEntry" && (
                    <>
                      <th>Stop loss price</th>
                      <th>Lowest low post entry</th>
                    </>
                  )}
                  <th>Highest high</th>
                  <th>
                    <button
                      type="button"
                      className="sort-toggle"
                      onClick={cycleReturnSort}
                      aria-label={`Sort by % Return (currently ${
                        returnSort === "desc" ? "descending" : returnSort === "asc" ? "ascending" : "off"
                      })`}
                    >
                      % Return
                      <span className={returnSort === "desc" ? "sort-arrow active" : "sort-arrow"}>▼</span>
                      <span className={returnSort === "asc" ? "sort-arrow active" : "sort-arrow"}>▲</span>
                    </button>
                  </th>
                  <th>Current close</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td className="col-left">{r.symbol}</td>
                    <td className="col-left">{r.name}</td>
                    <td>{r.activeAsOn === NA ? NA : formatDDMMYYYY(r.activeAsOn)}</td>
                    <td>{fmt(r.activationPrice)}</td>
                    {choice === "tzBuyEntry" && (
                      <>
                        <td>{fmt(r.stopLoss)}</td>
                        <td>{fmt(r.lowestLowPostEntry)}</td>
                      </>
                    )}
                    <td>{fmt(r.highestHigh)}</td>
                    <td
                      className={
                        Number.isNaN(r.percentReturn) ? undefined : r.percentReturn >= 0 ? "return-pos" : "return-neg"
                      }
                    >
                      {fmtPercent(r.percentReturn)}
                    </td>
                    <td>{fmt(r.currentClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && lastScanned && rows.length === 0 && (
        <p className="muted">No stocks currently active for this list.</p>
      )}
    </main>
  );
}

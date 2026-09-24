"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
//
// Kept small (rather than fewer/bigger batches) on purpose: a batch that
// includes one unusually slow symbol (a live Yahoo-fallback fetch, or a
// stock with an unusually long/eventful history for the WTF/DTF engine to
// trace) only drags down that one small batch, not a large chunk of the
// whole scan -- and a per-fetch timeout + retry below means one bad batch
// can't hang the page indefinitely either. Fully sequential (no
// concurrency) with a short pause between requests, rather than firing
// several at once: a scan that got most of the way through NSE Equity and
// then took the whole page down with it (not a clean in-app error, which
// every fetch here is already guarded against) looked like it could be
// tripping some burst-traffic protection on a tight loop of 30+ near-
// simultaneous requests -- spacing them out removes that risk regardless
// of whether that's actually the cause.
const BATCH_SIZE = 75;
const BATCH_TIMEOUT_MS = 45_000;
const BATCH_MAX_ATTEMPTS = 2;
const BATCH_GAP_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScreenerBatchResponse {
  total?: number;
  scanned?: number;
  tzBuy?: ScreenerRow[];
  tzBuyEntry?: ScreenerRow[];
  errors?: string[];
  cached?: boolean;
  error?: string;
}

// Accepts `null` as well as `number` because ScreenerRow.stopLoss /
// .lowestLowPostEntry are genuinely `number | null` (a server-computed
// "not applicable" -- see the comment in lib/dtfWtfScreener.ts). An
// earlier version used NaN for that instead of null and only checked
// Number.isNaN() here: NaN doesn't survive JSON.stringify (it silently
// becomes null over the wire), so the client always saw null regardless,
// and null.toFixed() threw -- crashing the whole page right as scan
// results rendered. Never repeat that: value coming from an API response
// is `T | null`, not `T` with NaN standing in for "missing".
function fmt(n: number | null): string {
  return n === null || Number.isNaN(n) ? NA : n.toFixed(2);
}

function fmtPercent(n: number): string {
  return Number.isNaN(n) ? NA : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// Risk % = how far the stop loss sits below the activation price, as a
// percentage of it -- e.g. Activation 100, SL 97 -> 3%. Computed
// client-side from fields already on ScreenerRow rather than adding a
// server field for it.
function riskPercent(activationPrice: number, stopLoss: number | null): number | null {
  if (stopLoss === null || Number.isNaN(activationPrice) || activationPrice === 0) return null;
  return ((activationPrice - stopLoss) / activationPrice) * 100;
}

// Has the Lowest Low (since entry) traded back below the Activation
// Price? null (NA) until Lowest Low Post Entry itself has a value.
function retraced(lowestLow: number | null, activationPrice: number): "YES" | "NO" | null {
  if (lowestLow === null || Number.isNaN(activationPrice)) return null;
  return lowestLow < activationPrice ? "YES" : "NO";
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

  // Column visibility -- all on by default; unticking removes that column
  // from the table. Scrip/Activation/Stop Loss columns are always shown
  // (not offered as toggles), per an explicit request to keep those fixed.
  const [colHighPrice, setColHighPrice] = useState(true);
  const [colHighReturn, setColHighReturn] = useState(true);
  const [colLowPrice, setColLowPrice] = useState(true);
  const [colLowRetraced, setColLowRetraced] = useState(true);
  const [colCurrentClose, setColCurrentClose] = useState(true);

  // Frozen (sticky) header: the site's generic `thead th { position:
  // sticky; top: 0 }` rule (globals.css) assumes a single header row, so
  // it's fine for the Trading Zone page but would make this table's two
  // header rows stick on top of each other. Row 1 stays at top: 0; row 2's
  // top is set to row 1's own measured height so it sticks directly below
  // it instead of overlapping -- measured rather than hard-coded so it
  // stays correct regardless of font size/zoom/theme.
  const theadRow1Ref = useRef<HTMLTableRowElement>(null);
  const [row1Height, setRow1Height] = useState(0);

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
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
      try {
        const res = await fetch(
          `/api/screener?segment=${encodeURIComponent(segment)}&offset=${offset}&limit=${limit}`,
          { signal: controller.signal }
        );
        const data: ScreenerBatchResponse = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");
        return data;
      } catch (err) {
        lastErr = err;
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        lastErr = isAbort
          ? new Error(`Timed out scanning instruments ${offset + 1}-${offset + limit}`)
          : err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Scan failed");
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

      // A batch that still fails after fetchScanBatch's own retries is
      // skipped rather than aborting the whole scan -- previously one bad
      // batch (near the very end of NSE Equity, on the evidence of a scan
      // that got to ~2503/2578) took the entire page down with it. Better
      // to come back with 2,500-odd stocks scanned and a note about which
      // range failed than nothing at all.
      for (let off = BATCH_SIZE; off < total; off += BATCH_SIZE) {
        await sleep(BATCH_GAP_MS);
        try {
          const batch = await fetchScanBatch(off, BATCH_SIZE);
          tzBuyAll.push(...(batch.tzBuy || []));
          tzBuyEntryAll.push(...(batch.tzBuyEntry || []));
          errorsAll.push(...(batch.errors || []));
          scannedTotal += batch.scanned || 0;
          allCached = allCached && !!batch.cached;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "batch failed";
          errorsAll.push(`Instruments ${off + 1}-${off + BATCH_SIZE}: ${msg}`);
          allCached = false;
        }
        setScanProgress(`${scannedTotal} / ${total}`);
      }

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
            stopLoss: null,
            lowestLowPostEntry: null,
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

  useLayoutEffect(() => {
    if (theadRow1Ref.current) {
      setRow1Height(theadRow1Ref.current.getBoundingClientRect().height);
    }
  }, [rows.length, choice, colHighPrice, colHighReturn, colLowPrice, colLowRetraced, colCurrentClose]);

  // Sticks row 2's headers directly below row 1's (which sits at the
  // default `top: 0` from the site-wide sticky rule) instead of on top of
  // it -- see the row1Height comment above.
  const row2StickyStyle = { top: row1Height };

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
            Powered by the full PRIME TREND theory: DTF is anchored off WTF&apos;s own currently
            LIVE TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 reference, which keeps climbing for as long as
            that WTF tier stays alive. Activation price is a one-time snapshot of DTF&apos;s own
            stage price, taken when this list&apos;s milestone most recently (re)formed (can differ
            between the two lists). Stop loss price is that milestone&apos;s own live SL level — it
            ratchets down to a new reference low as one forms, unlike Activation price&apos;s
            one-time snapshot. % Risk is how far below Activation price that stop loss sits. Lowest
            low post entry is the lowest daily low made strictly after the entry day and strictly
            before today; it shows NA until at least one full day has closed since entry. Retraced
            is whether that lowest low has traded back below Activation price. Highest high is
            DTF&apos;s own running maximum daily high since that same (re)formation — not a weekly
            figure. % Return is the change from Activation price to Highest high.
            {errors.length > 0 && ` ${errors.length} stock(s) failed to fetch and were skipped.`}
          </p>
        )}
        {errors.length > 0 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              Show failed stock(s) ({errors.length})
            </summary>
            <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
              {errors.slice(0, 25).map((e, i) => (
                <li key={i} className="muted" style={{ fontSize: "0.85rem" }}>
                  {e}
                </li>
              ))}
            </ul>
            {errors.length > 25 && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                …and {errors.length - 25} more.
              </p>
            )}
          </details>
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

          <div className="row" style={{ marginTop: "0.75rem" }}>
            <div className="field" style={{ flex: "1 1 100%", marginBottom: 0 }}>
              <label style={{ fontSize: "0.8rem" }}>Columns</label>
              <div className="col-filter-row">
                <label className="col-filter-item">
                  <input
                    type="checkbox"
                    checked={colHighPrice}
                    onChange={(e) => setColHighPrice(e.target.checked)}
                  />
                  Highest High: Price
                </label>
                <label className="col-filter-item">
                  <input
                    type="checkbox"
                    checked={colHighReturn}
                    onChange={(e) => setColHighReturn(e.target.checked)}
                  />
                  Highest High: % Return
                </label>
                {choice === "tzBuyEntry" && (
                  <>
                    <label className="col-filter-item">
                      <input
                        type="checkbox"
                        checked={colLowPrice}
                        onChange={(e) => setColLowPrice(e.target.checked)}
                      />
                      Lowest Low: Price
                    </label>
                    <label className="col-filter-item">
                      <input
                        type="checkbox"
                        checked={colLowRetraced}
                        onChange={(e) => setColLowRetraced(e.target.checked)}
                      />
                      Lowest Low: Retraced
                    </label>
                  </>
                )}
                <label className="col-filter-item">
                  <input
                    type="checkbox"
                    checked={colCurrentClose}
                    onChange={(e) => setColCurrentClose(e.target.checked)}
                  />
                  Current Close
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (() => {
        const showStopLoss = choice === "tzBuyEntry";
        const showLowestLow = choice === "tzBuyEntry";
        const highGroupCols = (colHighPrice ? 1 : 0) + (colHighReturn ? 1 : 0);
        const lowGroupCols = showLowestLow ? (colLowPrice ? 1 : 0) + (colLowRetraced ? 1 : 0) : 0;

        return (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr ref={theadRow1Ref}>
                    <th className="col-left" colSpan={2}>Scrip</th>
                    <th colSpan={2}>Activation</th>
                    {showStopLoss && <th colSpan={2}>Stop Loss</th>}
                    {highGroupCols > 0 && <th colSpan={highGroupCols}>Highest High</th>}
                    {lowGroupCols > 0 && <th colSpan={lowGroupCols}>Lowest Low</th>}
                    {colCurrentClose && <th rowSpan={2}>Current Close</th>}
                  </tr>
                  <tr>
                    <th className="col-left" style={row2StickyStyle}>Name</th>
                    <th className="col-left" style={row2StickyStyle}>Symbol</th>
                    <th style={row2StickyStyle}>Date</th>
                    <th style={row2StickyStyle}>{choice === "tzBuy" ? "TZ BUY entry above" : "Price"}</th>
                    {showStopLoss && (
                      <>
                        <th style={row2StickyStyle}>Price</th>
                        <th style={row2StickyStyle}>% Risk</th>
                      </>
                    )}
                    {colHighPrice && <th style={row2StickyStyle}>Price</th>}
                    {colHighReturn && (
                      <th style={row2StickyStyle}>
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
                    )}
                    {showLowestLow && colLowPrice && <th style={row2StickyStyle}>Price</th>}
                    {showLowestLow && colLowRetraced && <th style={row2StickyStyle}>Retraced</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const risk = riskPercent(r.activationPrice, r.stopLoss);
                    const retr = retraced(r.lowestLowPostEntry, r.activationPrice);
                    return (
                      <tr key={r.symbol}>
                        <td className="col-left">{r.name}</td>
                        <td className="col-left">{r.symbol}</td>
                        <td>{r.activeAsOn === NA ? NA : formatDDMMYYYY(r.activeAsOn)}</td>
                        <td>{fmt(r.activationPrice)}</td>
                        {showStopLoss && (
                          <>
                            <td>{fmt(r.stopLoss)}</td>
                            <td className="return-neg">{risk === null ? NA : `${risk.toFixed(2)}%`}</td>
                          </>
                        )}
                        {colHighPrice && <td>{fmt(r.highestHigh)}</td>}
                        {colHighReturn && (
                          <td
                            className={
                              Number.isNaN(r.percentReturn)
                                ? undefined
                                : r.percentReturn >= 0
                                ? "return-pos"
                                : "return-neg"
                            }
                          >
                            {fmtPercent(r.percentReturn)}
                          </td>
                        )}
                        {showLowestLow && colLowPrice && <td>{fmt(r.lowestLowPostEntry)}</td>}
                        {showLowestLow && colLowRetraced && (
                          <td className={retr === null ? undefined : retr === "YES" ? "return-pos" : "return-neg"}>
                            {retr ?? NA}
                          </td>
                        )}
                        {colCurrentClose && <td>{fmt(r.currentClose)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {!loading && lastScanned && rows.length === 0 && (
        <p className="muted">No stocks currently active for this list.</p>
      )}
    </main>
  );
}

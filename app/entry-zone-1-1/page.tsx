"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_SEGMENTS } from "@/lib/screenerSegments";
import { formatDDMMYYYY, formatTimestampDDMMYYYY } from "@/lib/dateFormat";

// PRIME TREND 1.1 -- experimental variant, NOT part of the shipped theory
// (see lib/primeTrend11.ts / lib/dtfWtfScreener11.ts). Adds a third DTF
// stage, TZ BUY 3, above DTF TZ BUY ENTRY. This is a deliberate near-copy
// of app/entry-zone/page.tsx (the shipped screener page), pointed at the
// separate /api/screener11 endpoint, with the tab semantics shifted up one
// stage: "DTF trading with TZ BUY" now means Stage 2 (DTF TZ BUY ENTRY) is
// active, and "DTF TZ BUY ENTRY" now means Stage 3 (TZ BUY 3) is active --
// plain Stage 1 alone is no longer surfaced in either list. The shipped
// /entry-zone page and its own API route/lib are completely untouched.

type ListChoice = "tzBuy" | "tzBuyEntry";
type ReturnSort = "desc" | "asc" | null;

interface ScripMatch {
  symbol: string;
  name: string;
}

const NA = "NA";

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

function fmt(n: number | null): string {
  return n === null || Number.isNaN(n) ? NA : n.toFixed(2);
}

function fmtPercent(n: number): string {
  return Number.isNaN(n) ? NA : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function riskPercent(activationPrice: number, stopLoss: number | null): number | null {
  if (stopLoss === null || Number.isNaN(activationPrice) || activationPrice === 0) return null;
  return ((activationPrice - stopLoss) / activationPrice) * 100;
}

function retraced(lowestLow: number | null, activationPrice: number): "YES" | "NO" | null {
  if (lowestLow === null || Number.isNaN(activationPrice)) return null;
  return lowestLow < activationPrice ? "YES" : "NO";
}

export default function EntryZone11() {
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

  const [colHighPrice, setColHighPrice] = useState(true);
  const [colHighReturn, setColHighReturn] = useState(true);
  const [colLowPrice, setColLowPrice] = useState(true);
  const [colLowRetraced, setColLowRetraced] = useState(true);
  const [colCurrentClose, setColCurrentClose] = useState(true);

  const theadRow1Ref = useRef<HTMLTableRowElement>(null);
  const [row1Height, setRow1Height] = useState(0);

  function onChoiceChange(next: ListChoice) {
    setChoice(next);
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
          `/api/screener11?segment=${encodeURIComponent(segment)}&offset=${offset}&limit=${limit}`,
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

  const availableYears = Array.from(new Set(activeList.map((r) => r.activeAsOn.slice(0, 4)))).sort(
    (a, b) => b.localeCompare(a)
  );

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

  const row2StickyStyle = { top: row1Height };

  return (
    <main className="container">
      <h1>Prime Trend 1.1 (experimental)</h1>
      <p className="subtitle">
        Experimental variant of Prime Trend, adding a third DTF stage (TZ BUY 3) above DTF TZ BUY
        ENTRY. &quot;DTF trading with TZ BUY&quot; below means DTF TZ BUY ENTRY (Stage 2) is
        currently active; &quot;DTF TZ BUY ENTRY&quot; means TZ BUY 3 (Stage 3) is currently
        active. Plain DTF TZ BUY (Stage 1) alone is not shown in either list. This is a separate
        test page — it does not affect the main Prime Trend page or theory.
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
            ? "DTF TZ BUY ENTRY (Stage 2) currently active, above DTF TZ BUY"
            : "TZ BUY 3 (Stage 3) currently active, above DTF TZ BUY ENTRY"}
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
            Experimental 3-stage variant: DTF TZ BUY (Stage 1) → DTF TZ BUY ENTRY (Stage 2) → TZ
            BUY 3 (Stage 3), each escalating above the previous one&apos;s own ratchet ladder with
            identical rules. Activation price is a one-time snapshot of that stage&apos;s own entry
            price. Stop loss price is that stage&apos;s own live SL level. % Risk is how far below
            Activation price that stop loss sits. Lowest low post entry is the lowest daily low
            made strictly after the entry day and strictly before today. Retraced is whether that
            lowest low has traded back below Activation price. Highest high is that stage&apos;s
            own running maximum daily high since (re)formation. % Return is the change from
            Activation price to Highest high.
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
                {choice === "tzBuyEntry" && (
                  <>
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
        const showHighestHigh = choice === "tzBuyEntry";
        const highGroupCols = showHighestHigh ? (colHighPrice ? 1 : 0) + (colHighReturn ? 1 : 0) : 0;
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
                    {showHighestHigh && colHighPrice && <th style={row2StickyStyle}>Price</th>}
                    {showHighestHigh && colHighReturn && (
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
                        {showHighestHigh && colHighPrice && <td>{fmt(r.highestHigh)}</td>}
                        {showHighestHigh && colHighReturn && (
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

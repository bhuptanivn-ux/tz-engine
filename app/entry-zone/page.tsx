"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_SEGMENTS } from "@/lib/screenerSegments";
import { formatDDMMYYYY } from "@/lib/dateFormat";

type ListChoice = "tzBuy" | "tzBuyEntry";

interface ScripMatch {
  symbol: string;
  name: string;
}

const NA = "NA";

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

  const [scripQuery, setScripQuery] = useState("");
  const [scripSuggestions, setScripSuggestions] = useState<ScripMatch[]>([]);
  const [showScripSuggestions, setShowScripSuggestions] = useState(false);
  const [scripHighlighted, setScripHighlighted] = useState(-1);
  const [selectedScrip, setSelectedScrip] = useState<ScripMatch | null>(null);
  const scripDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChoiceChange(next: ListChoice) {
    setChoice(next);
    setSegment("");
    setTzBuy([]);
    setTzBuyEntry([]);
    setLastScanned("");
    setError("");
    clearScripSearch();
  }

  function onSegmentChange(next: string) {
    setSegment(next);
    setTzBuy([]);
    setTzBuyEntry([]);
    setLastScanned("");
    setError("");
    clearScripSearch();
  }

  async function runScan() {
    if (!segment) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/screener?segment=${encodeURIComponent(segment)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setTzBuy(data.tzBuy || []);
      setTzBuyEntry(data.tzBuyEntry || []);
      setScanned(data.scanned || 0);
      setErrors(data.errors || []);
      setLastScanned(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
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

  // Newest activation first -- oldest at the bottom. A searched scrip
  // narrows the table to just that one scrip: its own row if it's
  // currently active for this tab, or an "NA" placeholder row (name only)
  // if it isn't.
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
            highestHigh: NaN,
            percentReturn: NaN,
            currentClose: NaN,
          },
        ];
      })()
    : [...activeList].sort((a, b) => b.activeAsOn.localeCompare(a.activeAsOn));

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
          {loading ? "Scanning…" : "Scan universe"}
        </button>
        {error && <div className="error">{error}</div>}
        {lastScanned && (
          <p className="muted event-disclaimer">
            Scanned {scanned} instrument(s) in{" "}
            {SCREENER_SEGMENTS.find((s) => s.key === segment)?.label || segment} at {lastScanned}.
            Simplified first version: DTF is
            anchored off WTF&apos;s current TZ BUY 2 reference and then runs independently — the
            full pause/dormant/race WTF state machine isn&apos;t ported yet. Activation price is a
            one-time snapshot of DTF&apos;s own TZ BUY reference, taken when this list&apos;s
            milestone formed (can differ between the two lists). Highest high is WTF&apos;s own
            weekly high, live — but freezes the moment WTF hits RED2 or BAR SL2, resuming only
            once price trades back above that frozen level. % Return is the change from
            Activation price to Highest high.
            {errors.length > 0 && ` ${errors.length} stock(s) failed to fetch and were skipped.`}
          </p>
        )}
      </div>

      {lastScanned && (
        <div className="card">
          <div className="field" style={{ marginBottom: 0 }}>
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
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scrip</th>
                  <th>Active as on</th>
                  <th>{choice === "tzBuy" ? "TZ BUY entry above" : "Activation price"}</th>
                  <th>Highest high</th>
                  <th>% Return</th>
                  <th>Current close</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td>
                      {r.symbol} <span className="name">{r.name}</span>
                    </td>
                    <td>{r.activeAsOn === NA ? NA : formatDDMMYYYY(r.activeAsOn)}</td>
                    <td>{fmt(r.activationPrice)}</td>
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

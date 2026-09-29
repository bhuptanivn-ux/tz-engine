"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GLOBAL_INDICES } from "@/lib/indices";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { formatDDMMYYYY } from "@/lib/dateFormat";
import { computeDtfBarEvents } from "@/lib/dtfBar";

interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string;
}

interface HistoryRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

type Mode = "stock" | "index" | "market";

const FNO_FILTER_VALUE = "FNO";
const FNO_SEGMENT = OTHER_MARKETS.find((s) => s.key === "fno") ?? null;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}

type CandleKind = "bull" | "bear" | "doji" | null;

function candleKind(open: number | null, close: number | null): CandleKind {
  if (open === null || close === null) return null;
  if (close > open) return "bull";
  if (close < open) return "bear";
  return "doji";
}

const STRIPE_COLOR: Record<"bull" | "bear" | "doji", string> = {
  bull: "#22c55e",
  bear: "#ef5350",
  doji: "#15803d",
};

// DTF BAR's own event vocabulary (lib/dtfBar.ts) is single-lineage, so
// events carry no branch letter -- only the sequential BAR generation
// tracker (BAR1(n)/BAR2(n)/BAR SL(n)/BAR SL2(n)) has a parenthetical
// label. Same green/red convention as Trading Zone's own coloring: light
// green for formation/HH, light red for LL/SL/RED events, and a darker
// shade for the "2"-confirmed tier (BAR2, REAR2) and the decisive SL2
// events (BAR SL2, TZ BUY SL 2) -- mirroring EVENT_COLOR_OVERRIDE's
// row-level darker treatment on the Trading Zone page.
const EVENT_COLOR_OVERRIDE: Record<string, string> = {
  BAR2: "#15803d",
  REAR2: "#15803d",
  "BAR SL2": "#b91c1c",
  "TZ BUY SL 2": "#b91c1c",
};

const LIGHT_GREEN = "#22c55e";
const DARK_GREEN = "#15803d";
const LIGHT_RED = "#ef5350";
const DARK_RED = "#b91c1c";

const EVENT_KIND_COLOR: Record<string, string> = {
  "TZ GREEN": LIGHT_GREEN,
  "TZ GREEN HH": LIGHT_GREEN,
  "TZ GREEN LL": LIGHT_RED,
  "TZ GREEN SL": LIGHT_RED,

  RED1: LIGHT_RED,
  "RED1 HH": LIGHT_RED,
  "RED1 LL": LIGHT_RED,
  "INVALID RED1": LIGHT_GREEN,
  RED2: LIGHT_RED,

  "TZ BUY": LIGHT_GREEN,
  "TZ BUY HH": LIGHT_GREEN,
  "TZ BUY LL": LIGHT_RED,
  "TZ BUY SL": LIGHT_RED,
  "TZ BUY SL 2": DARK_RED,

  BAR1: LIGHT_GREEN,
  "BAR1 HH": LIGHT_GREEN,
  "BAR1 LL": LIGHT_RED,
  BAR2: DARK_GREEN,
  "BAR2 HH": DARK_GREEN,
  "BAR2 LL": LIGHT_RED,
  "BAR SL": LIGHT_RED,
  "BAR SL LL": LIGHT_RED,
  "BAR SL2": DARK_RED,

  REAR: LIGHT_GREEN,
  "REAR HH": LIGHT_GREEN,
  "REAR LL": LIGHT_RED,
  "REAR SL": LIGHT_RED,
  REAR2: DARK_GREEN,
  "REAR2 HH": DARK_GREEN,
  "REAR2 LL": LIGHT_RED,

  "REAR RE-ENTER": LIGHT_GREEN,
};

function plainEventBadgeStyle(rowCandle: CandleKind): { background: string; color: string } {
  if (rowCandle === "bull" || rowCandle === "bear") {
    const base = rowCandle === "bull" ? "#22c55e" : "#ef5350";
    return { background: `${base}1f`, color: base };
  }
  return { background: "var(--doji-event-bg)", color: "var(--doji-event-color)" };
}

const ENGINE_HISTORY_FLOOR = "1900-01-01";

function splitEventTokens(eventStr: string): string[] {
  return eventStr
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Strips a trailing "(1)" / "(2)" BAR generation label off an event token,
// e.g. "BAR1(1)" -> "BAR1", "BAR SL2(1)" -> "BAR SL2" -- the category the
// filter dropdown groups by, same idea as Trading Zone's own eventKind().
function eventKind(token: string): string {
  const idx = token.indexOf("(");
  return (idx === -1 ? token : token.slice(0, idx)).trim();
}

function isHhOrLlKind(kind: string): boolean {
  return /\s(HH|LL)$/.test(kind);
}

export default function DtfBar() {
  const [mode, setMode] = useState<Mode>("stock");

  const [marketFilter, setMarketFilter] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [fnoSymbol, setFnoSymbol] = useState(FNO_SEGMENT?.instruments[0]?.symbol ?? "");

  const [indexSymbol, setIndexSymbol] = useState(GLOBAL_INDICES[0].symbol);

  const [marketSegmentKey, setMarketSegmentKey] = useState(OTHER_MARKETS[0].key);
  const [marketSymbol, setMarketSymbol] = useState(OTHER_MARKETS[0].instruments[0].symbol);

  const [selected, setSelected] = useState<SymbolMatch | null>(null);
  const [start, setStart] = useState("2021-03-28");
  const [end, setEnd] = useState(todayISO());
  const [interval, setIntervalValue] = useState("1d");
  const [minStartDate, setMinStartDate] = useState("");
  const [minStartLoading, setMinStartLoading] = useState(false);

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [events, setEvents] = useState<Map<string, string>>(new Map());
  const [eventFilter, setEventFilter] = useState<Set<string>>(new Set());
  const [eventFilterOpen, setEventFilterOpen] = useState(false);
  const eventFilterRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const allEventKinds = useMemo(() => {
    const set = new Set<string>();
    for (const v of events.values()) {
      for (const tok of splitEventTokens(v)) {
        const kind = eventKind(tok);
        if (!isHhOrLlKind(kind)) set.add(kind);
      }
    }
    return Array.from(set).sort();
  }, [events]);

  const filteredRows = useMemo(() => {
    if (eventFilter.size === 0) return rows;
    return rows.filter((r) =>
      splitEventTokens(events.get(r.date) || "").some((tok) => eventFilter.has(eventKind(tok)))
    );
  }, [rows, events, eventFilter]);

  useEffect(() => {
    if (!eventFilterOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (eventFilterRef.current && !eventFilterRef.current.contains(e.target as Node)) {
        setEventFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [eventFilterOpen]);

  function toggleEventKind(kind: string) {
    setEventFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "stock") return;
    if (marketFilter === FNO_FILTER_VALUE) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 1 || selected?.symbol === query) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (marketFilter) params.set("region", marketFilter);
        const res = await fetch(`/api/search?${params.toString()}`);
        const data = await res.json();
        setSuggestions(data.results || []);
        setHighlightedIndex(-1);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected, marketFilter, mode]);

  useEffect(() => {
    if (!selected) {
      setMinStartDate("");
      return;
    }
    let cancelled = false;
    setMinStartLoading(true);
    fetch(`/api/meta?symbol=${encodeURIComponent(selected.symbol)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const firstDate: string | null = data.firstTradeDate || null;
        setMinStartDate(firstDate || "");
        if (firstDate) {
          setStart(firstDate);
        }
      })
      .catch(() => {
        if (!cancelled) setMinStartDate("");
      })
      .finally(() => {
        if (!cancelled) setMinStartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.symbol]);

  function pickSuggestion(match: SymbolMatch) {
    setSelected(match);
    setQuery(`${match.name} (${match.symbol})`);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        pickSuggestion(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setRows([]);
    setError("");
    if (next === "index") {
      const idx = GLOBAL_INDICES.find((i) => i.symbol === indexSymbol) || GLOBAL_INDICES[0];
      setSelected({ symbol: idx.symbol, name: idx.label, exchange: idx.market });
    } else if (next === "market") {
      const segment = OTHER_MARKETS.find((s) => s.key === marketSegmentKey) || OTHER_MARKETS[0];
      const instrument =
        segment.instruments.find((i) => i.symbol === marketSymbol) || segment.instruments[0];
      setSelected({ symbol: instrument.symbol, name: instrument.name, exchange: segment.label });
    } else {
      setSelected(null);
      setQuery("");
    }
  }

  function handleIndexChange(symbol: string) {
    setIndexSymbol(symbol);
    const idx = GLOBAL_INDICES.find((i) => i.symbol === symbol);
    if (idx) {
      setSelected({ symbol: idx.symbol, name: idx.label, exchange: idx.market });
    }
  }

  function handleMarketSegmentChange(key: string) {
    setMarketSegmentKey(key);
    const segment = OTHER_MARKETS.find((s) => s.key === key) || OTHER_MARKETS[0];
    const instrument = segment.instruments[0];
    setMarketSymbol(instrument.symbol);
    setSelected({ symbol: instrument.symbol, name: instrument.name, exchange: segment.label });
  }

  function handleMarketSymbolChange(symbol: string) {
    setMarketSymbol(symbol);
    const segment = OTHER_MARKETS.find((s) => s.key === marketSegmentKey) || OTHER_MARKETS[0];
    const instrument = segment.instruments.find((i) => i.symbol === symbol);
    if (instrument) {
      setSelected({ symbol: instrument.symbol, name: instrument.name, exchange: segment.label });
    }
  }

  function handleStockMarketFilterChange(value: string) {
    setMarketFilter(value);
    if (value === FNO_FILTER_VALUE && FNO_SEGMENT) {
      const instrument =
        FNO_SEGMENT.instruments.find((i) => i.symbol === fnoSymbol) || FNO_SEGMENT.instruments[0];
      setFnoSymbol(instrument.symbol);
      setSelected({ symbol: instrument.symbol, name: instrument.name, exchange: FNO_SEGMENT.label });
      setQuery("");
      setSuggestions([]);
    } else {
      setSelected(null);
      setQuery("");
    }
  }

  function handleFnoSymbolChange(symbol: string) {
    setFnoSymbol(symbol);
    const instrument = FNO_SEGMENT?.instruments.find((i) => i.symbol === symbol);
    if (instrument && FNO_SEGMENT) {
      setSelected({ symbol: instrument.symbol, name: instrument.name, exchange: FNO_SEGMENT.label });
    }
  }

  async function handleFetch() {
    setError("");
    setRows([]);
    setEvents(new Map());
    setEventFilter(new Set());

    if (!selected) {
      setError(
        mode === "stock" ? "Pick a stock from the search suggestions first." : "Pick an index first."
      );
      return;
    }
    if (!start || !end) {
      setError("Start and end dates are required.");
      return;
    }
    if (end < start) {
      setError("End date must be on or after start date.");
      return;
    }

    setLoading(true);
    try {
      // Same reasoning as Trading Zone: DTF BAR is sequential/stateful, so
      // it always runs over the FULL history regardless of the display
      // start date -- only the displayed rows are sliced afterward.
      const params = new URLSearchParams({
        symbol: selected.symbol,
        start: ENGINE_HISTORY_FLOOR,
        end,
        interval,
      });
      const res = await fetch(`/api/history?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch history");
      }
      const fetchedRows: HistoryRow[] = data.rows || [];
      setEvents(computeDtfBarEvents(fetchedRows));
      setRows(start === minStartDate ? fetchedRows : fetchedRows.filter((r) => r.date >= start));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }

  function csvEscape(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  function downloadCSV() {
    if (filteredRows.length === 0) return;
    const header = "Date,Open,High,Low,Close,Event";
    const body = filteredRows
      .map((r) =>
        [r.date, r.open, r.high, r.low, r.close, csvEscape(events.get(r.date) || "")].join(",")
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected?.symbol || "history"}_dtf-bar_${start}_${end}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="container">
      <h1>DTF BAR</h1>
      <p className="subtitle">
        A separate, DTF-only theory (not the same as the TZ BUY engine on Trading Zone run on daily
        candles) — see DTF_THEORIES_RULEBOOK.md. Pull OHLC data for a major world index, search any
        stock across global markets, or browse Commodities, Crypto, Forex, Indian/International
        indices, and SME stocks.
      </p>

      <div className="card">
        <div className="tabs">
          <button
            className={mode === "stock" ? "tab active" : "tab"}
            onClick={() => switchMode("stock")}
          >
            Stock
          </button>
          <button
            className={mode === "index" ? "tab active" : "tab"}
            onClick={() => switchMode("index")}
          >
            Index
          </button>
          <button
            className={mode === "market" ? "tab active" : "tab"}
            onClick={() => switchMode("market")}
          >
            Markets
          </button>
        </div>

        {mode === "market" ? (
          <>
            <div className="field">
              <label htmlFor="market-segment-select">Segment</label>
              <select
                id="market-segment-select"
                value={marketSegmentKey}
                onChange={(e) => handleMarketSegmentChange(e.target.value)}
              >
                {OTHER_MARKETS.map((segment) => (
                  <option key={segment.key} value={segment.key}>
                    {segment.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="market-instrument-select">Instrument</label>
              <select
                id="market-instrument-select"
                value={marketSymbol}
                onChange={(e) => handleMarketSymbolChange(e.target.value)}
              >
                {(OTHER_MARKETS.find((s) => s.key === marketSegmentKey) || OTHER_MARKETS[0]).instruments.map(
                  (instrument) => (
                    <option key={instrument.symbol} value={instrument.symbol}>
                      {instrument.name}
                    </option>
                  )
                )}
              </select>
            </div>
          </>
        ) : mode === "index" ? (
          <div className="field">
            <label htmlFor="index-select">Index</label>
            <select
              id="index-select"
              value={indexSymbol}
              onChange={(e) => handleIndexChange(e.target.value)}
            >
              {GLOBAL_INDICES.map((idx) => (
                <option key={idx.symbol} value={idx.symbol}>
                  {idx.label} — {idx.market}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="market-select">Market (optional, narrows search)</label>
              <select
                id="market-select"
                value={marketFilter}
                onChange={(e) => handleStockMarketFilterChange(e.target.value)}
              >
                <option value="">All markets</option>
                {FNO_SEGMENT && <option value={FNO_FILTER_VALUE}>F&amp;O Stocks</option>}
                {GLOBAL_INDICES.map((idx) => (
                  <option key={idx.region + idx.market} value={idx.region}>
                    {idx.market}
                  </option>
                ))}
              </select>
            </div>

            {marketFilter === FNO_FILTER_VALUE && FNO_SEGMENT ? (
              <div className="field">
                <label htmlFor="fno-instrument-select">F&amp;O instrument</label>
                <select
                  id="fno-instrument-select"
                  value={fnoSymbol}
                  onChange={(e) => handleFnoSymbolChange(e.target.value)}
                >
                  {FNO_SEGMENT.instruments.map((instrument) => (
                    <option key={instrument.symbol} value={instrument.symbol}>
                      {instrument.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="stock-search">Scrip / stock name</label>
                <input
                  id="stock-search"
                  type="text"
                  placeholder="e.g. Kalyan Jewellers, Apple, Reliance, Toyota…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelected(null);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={handleSearchKeyDown}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={showSuggestions && suggestions.length > 0}
                  aria-activedescendant={
                    highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined
                  }
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="suggestions">
                    {suggestions.map((s, i) => (
                      <div
                        key={s.symbol}
                        id={`suggestion-${i}`}
                        className={i === highlightedIndex ? "suggestion-item active" : "suggestion-item"}
                        onMouseDown={() => pickSuggestion(s)}
                        onMouseEnter={() => setHighlightedIndex(i)}
                      >
                        <div>
                          {s.symbol} <span className="name">{s.exchange}</span>
                        </div>
                        <div className="name">{s.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="row">
          <div className="field">
            <label htmlFor="start-date">Start date</label>
            <input
              id="start-date"
              type="date"
              value={start}
              min={minStartDate || undefined}
              onChange={(e) => setStart(e.target.value)}
            />
            {selected && (
              <div className="muted start-date-hint">
                {minStartLoading
                  ? "Checking earliest available date…"
                  : minStartDate
                  ? `Data available from ${formatDDMMYYYY(minStartDate)}`
                  : "Earliest available date unknown — no lower limit applied."}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="end-date">End date</label>
            <input
              id="end-date"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="interval">Interval</label>
            <select
              id="interval"
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
            >
              <option value="1d">Daily</option>
              <option value="1wk">Weekly</option>
              <option value="1mo">Monthly</option>
            </select>
          </div>
        </div>

        <button onClick={handleFetch} disabled={loading}>
          {loading ? "Fetching…" : "Fetch data"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="actions">
            <span className="muted">
              {filteredRows.length} of {rows.length} rows for {selected?.symbol}
            </span>
            <button className="secondary" onClick={downloadCSV}>
              Download CSV
            </button>
          </div>
          <p className="muted event-disclaimer">
            The Event column runs the separate DTF BAR engine (TZ GREEN → mandatory RED1 → RED2 →
            TZ BUY → RED1 → RED2 → BAR1 → BAR2 → TZ BUY SL 2 → REAR → REAR RE-ENTER) — see
            DTF_THEORIES_RULEBOOK.md. This is a first pass, NOT yet verified against real market
            data, and single-lineage only (no concurrent sibling cycles). Still a technical-analysis
            heuristic, not investment advice. The first row never shows an event: each day is only
            evaluated against the one before it.
          </p>
          <div className="table-wrap table-wrap-fixed">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Open</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Close</th>
                  <th className="event-col">
                    <div className="event-th">
                      <span>Event</span>
                      {allEventKinds.length > 0 && (
                        <div className="event-filter" ref={eventFilterRef}>
                          <button
                            type="button"
                            className="event-th-filter"
                            aria-haspopup="true"
                            aria-expanded={eventFilterOpen}
                            onClick={() => setEventFilterOpen((open) => !open)}
                          >
                            {eventFilter.size === 0 ? "All" : `${eventFilter.size} selected`} ▾
                          </button>
                          {eventFilterOpen && (
                            <div className="event-filter-menu" role="menu">
                              <label className="event-filter-item">
                                <input
                                  type="checkbox"
                                  checked={eventFilter.size === 0}
                                  onChange={() => setEventFilter(new Set())}
                                />
                                All
                              </label>
                              <div className="event-filter-divider" />
                              {allEventKinds.map((kind) => (
                                <label key={kind} className="event-filter-item">
                                  <input
                                    type="checkbox"
                                    checked={eventFilter.has(kind)}
                                    onChange={() => toggleEventKind(kind)}
                                  />
                                  {kind}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const kind = candleKind(r.open, r.close);
                  const tokens = splitEventTokens(events.get(r.date) || "");
                  let rowOverrideColor: string | null = null;
                  for (const tok of tokens) {
                    const c = EVENT_COLOR_OVERRIDE[eventKind(tok)];
                    if (c) {
                      rowOverrideColor = c;
                      break;
                    }
                  }
                  const cellClass = rowOverrideColor
                    ? `${rowOverrideColor === DARK_GREEN ? "candle-override-green" : "candle-override-red"} mono`
                    : kind
                    ? `candle-${kind} mono`
                    : "mono";
                  const stripeHex = rowOverrideColor ?? (kind ? STRIPE_COLOR[kind] : null);
                  const stripeStyle = stripeHex ? { borderLeft: `4px solid ${stripeHex}` } : undefined;
                  return (
                    <tr key={r.date}>
                      <td className={cellClass} style={stripeStyle}>{formatDDMMYYYY(r.date)}</td>
                      <td className={cellClass}>{fmt(r.open)}</td>
                      <td className={cellClass}>{fmt(r.high)}</td>
                      <td className={cellClass}>{fmt(r.low)}</td>
                      <td className={cellClass}>{fmt(r.close)}</td>
                      <td className="event-col">
                        {tokens.map((tok, i) => {
                          const kindColor = EVENT_KIND_COLOR[eventKind(tok)];
                          const style = kindColor
                            ? { background: `${kindColor}1f`, color: kindColor }
                            : plainEventBadgeStyle(kind);
                          return (
                            <span key={i} className="event-badge" style={style}>
                              {tok}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

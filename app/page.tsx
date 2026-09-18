"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GLOBAL_INDICES } from "@/lib/indices";
import { computeNewTheoryEvents } from "@/lib/tzEngineNewTheory";
import { computeBar2VariantEvents, type TzBuyReentryRule } from "@/lib/tzEngineBar2Variant";

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

type Mode = "stock" | "index";
type EngineChoice = "bar2" | "newtheory";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(2);
}

// Candle-direction shading for the Date/Open/High/Low/Close cells (the
// Event column deliberately stays unshaded — it has its own accent-color
// styling and isn't part of this rule).
type CandleKind = "bull" | "bear" | "doji" | null;

function candleKind(open: number | null, close: number | null): CandleKind {
  if (open === null || close === null) return null;
  if (close > open) return "bull";
  if (close < open) return "bear";
  return "doji";
}

// Row stripe (Date cell's left border) and the translucent Date/O/H/L/C
// tint backgrounds (.candle-bull etc. in globals.css) use these same fixed
// hex values -- kept in sync manually since one lives in CSS, one here.
const STRIPE_COLOR: Record<"bull" | "bear" | "doji", string> = {
  bull: "#22c55e",
  bear: "#ef5350",
  doji: "#15803d",
};

// Specific event kinds get their own fixed emphasis color regardless of
// that day's own candle direction -- a deeper shade marking the stronger,
// "2"-confirmed tier: TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 (all the same
// darker green -- every one is a "2"-confirmed bullish milestone) and
// BAR SL2 (darker red, the deeper stop). When any of these appear on a
// day, its color governs the WHOLE row (see rowOverrideColor below), not
// just the Event badge.
const EVENT_COLOR_OVERRIDE: Record<string, string> = {
  "TZ BUY 2": "#15803d",
  "REAR 2": "#15803d",
  "REAR RE-ENTER 2": "#15803d",
  "BAR SL2": "#b91c1c",
};

// The row-level wash for an overridden row deliberately does NOT dilute
// the override's own dark hex -- alpha-blending a dark, muted color like
// #15803d over a near-white card desaturates it into grey-sage rather
// than reading as green. The wash instead reuses the vivid bull/bear hue
// (same hue family, just a stronger alpha than a plain row) so it still
// reads as a clear green/red; the stripe and badge carry the actual dark
// shade, which works fine at that smaller, more solid scale.
const OVERRIDE_ROW_WASH: Record<string, string> = {
  "#15803d": "candle-override-green",
  "#b91c1c": "candle-override-red",
};

// Event badges: background is a ~12% tint of the same color as the text,
// so a token always reads correctly regardless of the surrounding card
// color. For plain hex colors that's a literal alpha-suffixed hex; doji's
// default needs to swap with the theme (see --doji-event-color/-bg in
// globals.css) since a dark-green-on-dark-tint pairing loses contrast in
// dark mode the same way plain text did before badges existed.
function eventBadgeStyle(kind: string, rowCandle: CandleKind): { background: string; color: string } {
  const override = EVENT_COLOR_OVERRIDE[kind];
  if (override) return { background: `${override}1f`, color: override };
  if (rowCandle === "bull" || rowCandle === "bear") {
    const base = rowCandle === "bull" ? "#22c55e" : "#ef5350";
    return { background: `${base}1f`, color: base };
  }
  return { background: "var(--doji-event-bg)", color: "var(--doji-event-color)" };
}

// Deliberately not derived from a symbol's firstTradeDate: weekly/monthly
// candles are labeled by the START of their period (e.g. a week's Monday),
// so if the real listing date falls mid-period, requesting period1 set to
// the exact listing date would exclude that whole boundary candle (its own
// label precedes the requested start). Requesting from far enough back
// instead lets Yahoo naturally return everything it actually has, with no
// risk of clipping the first week/month.
const ENGINE_HISTORY_FLOOR = "1900-01-01";

// A day's combined event string joins multiple events with " + " (bar2
// engine) or ", " (New Theory engine). Neither individual event tag ever
// contains a plus or comma itself, so splitting on either separator is safe
// regardless of which engine produced the string.
function splitEventTokens(eventStr: string): string[] {
  return eventStr
    .split(/\s*\+\s*|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Strips the trailing "(A)" / "(A.1)" branch label off an event token, e.g.
// "TZ GREEN(A)" -> "TZ GREEN", "BAR SL2(A.1)" -> "BAR SL2". This is the
// category the filter dropdown groups by — so picking "TZ GREEN" matches
// every branch (A, B, C, ...), not just one.
function eventKind(token: string): string {
  const idx = token.indexOf("(");
  return (idx === -1 ? token : token.slice(0, idx)).trim();
}

// HH/LL are continuous reference-tracking noise (they fire almost every
// week) rather than milestone/SL events, so they're excluded from the
// filter dropdown entirely — not just deduped.
function isHhOrLlKind(kind: string): boolean {
  return /\s(HH|LL)$/.test(kind);
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("stock");

  // Stock-tab state
  const [marketFilter, setMarketFilter] = useState(""); // "" = all markets
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Index-tab state
  const [indexSymbol, setIndexSymbol] = useState(GLOBAL_INDICES[0].symbol);

  // Shared selection + range
  const [selected, setSelected] = useState<SymbolMatch | null>(null);
  const [start, setStart] = useState("2021-03-28");
  const [end, setEnd] = useState(todayISO());
  const [interval, setIntervalValue] = useState("1d");
  const [minStartDate, setMinStartDate] = useState("");
  const [minStartLoading, setMinStartLoading] = useState(false);

  const [engineChoice, setEngineChoice] = useState<EngineChoice>("bar2");
  const [reentryRule, setReentryRule] = useState<TzBuyReentryRule>("topref");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [events, setEvents] = useState<Map<string, string>>(new Map());
  const [eventFilter, setEventFilter] = useState(""); // "" = show all events
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
    if (!eventFilter) return rows;
    return rows.filter((r) =>
      splitEventTokens(events.get(r.date) || "").some((tok) => eventKind(tok) === eventFilter)
    );
  }, [rows, events, eventFilter]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "stock") return;
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
          // Default to this symbol's own earliest available date — not just
          // a floor. Without this, a symbol listed before the previous
          // selection's start date would silently keep whatever start date
          // was already in the field, making every stock look like its
          // history begins on the same leftover date.
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

  async function handleFetch() {
    setError("");
    setRows([]);
    setEvents(new Map());
    setEventFilter("");

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
      // The engine is sequential/stateful — each day's outcome depends on
      // everything that happened before it (a BAR SL2 reference might trace
      // back to a TZ GREEN that formed years earlier). So it always runs
      // over the FULL history, regardless of what start date the user
      // picked to view — truncating the input to the display range would
      // silently corrupt every event computed for it. Only the displayed
      // rows are sliced to the user's chosen start date, after the engine
      // has already run.
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
      setEvents(
        engineChoice === "bar2"
          ? computeBar2VariantEvents(fetchedRows, reentryRule)
          : computeNewTheoryEvents(fetchedRows)
      );
      // When the start date is still the auto-populated default (the
      // symbol's own listing date), show everything Yahoo actually
      // returned rather than re-filtering by that exact date string —
      // a weekly/monthly candle's date label (period start) can fall
      // slightly before the precise listing date, and a strict ">="
      // comparison would silently drop that genuine first candle again.
      // Only apply the display cutoff once the user has deliberately
      // moved the start date later than the default.
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
    a.download = `${selected?.symbol || "history"}_${start}_${end}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="container">
      <h1>Trading Zone</h1>
      <p className="subtitle">
        Pull OHLC data for a major world index, or search any stock across global markets.
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
        </div>

        {mode === "index" ? (
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
                onChange={(e) => setMarketFilter(e.target.value)}
              >
                <option value="">All markets</option>
                {GLOBAL_INDICES.map((idx) => (
                  <option key={idx.region + idx.market} value={idx.region}>
                    {idx.market}
                  </option>
                ))}
              </select>
            </div>

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
                  ? `Data available from ${minStartDate}`
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

        <div className="field">
          <label htmlFor="engine-select">Signal engine (for the Event column)</label>
          <select
            id="engine-select"
            value={engineChoice}
            onChange={(e) => setEngineChoice(e.target.value as EngineChoice)}
          >
            <option value="bar2">BAR 2 / REAR 2 / REAR RE-ENTER 2 + TZ BUY 2 (validated against real 2020 data)</option>
            <option value="newtheory">New Theory v3 (experimental, unverified)</option>
          </select>
        </div>

        {engineChoice === "bar2" && (
          <div className="field">
            <label htmlFor="reentry-rule-select">TZ BUY reactivation rule (when its own SL fires)</label>
            <select
              id="reentry-rule-select"
              value={reentryRule}
              onChange={(e) => setReentryRule(e.target.value as TzBuyReentryRule)}
            >
              <option value="topref">
                New: reactivate above the highest reference across every tier (TZ BUY 2, BAR, REAR...)
              </option>
              <option value="simple">
                Old: reactivate above max(TZ BUY&apos;s own ref, TZ BUY 2&apos;s ref) only
              </option>
            </select>
          </div>
        )}

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
            {engineChoice === "bar2" ? (
              <>
                The Event column runs the BAR 2 / REAR 2 / REAR RE-ENTER 2 engine, with TZ BUY 2 —
                the BAR/REAR tiers were verified end-to-end against real 2020 OHLC data (see
                TZ_ENGINE_RULEBOOK_REFERENCE.md); TZ BUY 2 is newer and less independently checked.
                Still a technical-analysis heuristic, not investment advice.
              </>
            ) : (
              <>
                The Event column runs New Theory v3, a provisional, unverified trading-signal
                theory (see NEW_THEORY_RULEBOOK.md) — treat it as a hypothesis, not a confirmed
                signal.
              </>
            )}{" "}
            The first row never shows an event: each day is only evaluated against the one
            before it.
          </p>
          <div className="table-wrap">
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
                        <select
                          className="event-th-filter"
                          aria-label="Filter by event"
                          value={eventFilter}
                          onChange={(e) => setEventFilter(e.target.value)}
                        >
                          <option value="">All ▾</option>
                          {allEventKinds.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const kind = candleKind(r.open, r.close);
                  const tokens = splitEventTokens(events.get(r.date) || "");
                  // If any of TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 / BAR SL2
                  // fired today, that event's color governs the WHOLE row --
                  // Date/O/H/L/C, not just its own badge -- regardless of
                  // what today's own candle direction would otherwise show.
                  let rowOverrideColor: string | null = null;
                  for (const tok of tokens) {
                    const c = EVENT_COLOR_OVERRIDE[eventKind(tok)];
                    if (c) {
                      rowOverrideColor = c;
                      break;
                    }
                  }
                  const cellClass = rowOverrideColor
                    ? `${OVERRIDE_ROW_WASH[rowOverrideColor]} mono`
                    : kind
                    ? `candle-${kind} mono`
                    : "mono";
                  const stripeHex = rowOverrideColor ?? (kind ? STRIPE_COLOR[kind] : null);
                  const stripeStyle = stripeHex ? { borderLeft: `4px solid ${stripeHex}` } : undefined;
                  return (
                    <tr key={r.date}>
                      <td className={cellClass} style={stripeStyle}>{r.date}</td>
                      <td className={cellClass}>{fmt(r.open)}</td>
                      <td className={cellClass}>{fmt(r.high)}</td>
                      <td className={cellClass}>{fmt(r.low)}</td>
                      <td className={cellClass}>{fmt(r.close)}</td>
                      <td className="event-col">
                        {tokens.map((tok, i) => (
                          <span key={i} className="event-badge" style={eventBadgeStyle(eventKind(tok), kind)}>
                            {tok}
                          </span>
                        ))}
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

"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { GLOBAL_INDICES } from "@/lib/indices";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { formatDDMMYYYY } from "@/lib/dateFormat";
import { computeWtfEvents } from "@/lib/tzEngineWtf";

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

// Sentinel value for the Stock tab's "Market" dropdown -- picking this
// switches that tab from a live global search to a fixed dropdown of the
// same "fno" segment used by the Markets tab (see lib/otherMarkets.ts),
// since F&O eligibility isn't a country/region like the dropdown's other
// options and can't be used as a Yahoo search hint.
const FNO_FILTER_VALUE = "FNO";
const FNO_SEGMENT = OTHER_MARKETS.find((s) => s.key === "fno") ?? null;

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
// "2"-confirmed tier: TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 / BAR 2 (all the
// same darker green -- every one is a "2"-confirmed milestone on the way
// up) and BAR SL2 (darker red, the deeper stop -- only reachable once
// BAR 2 has already formed, so it's unconditionally "deep"). When any of
// these appear on a day, its color governs the WHOLE row (see
// rowOverrideColor below), not just the Event badge. RED2 is NOT part of
// this -- it's a caution/gate event, not a milestone, so it gets its own
// badge color (see EVENT_KIND_COLOR) without taking over the whole row.
const EVENT_COLOR_OVERRIDE: Record<string, string> = {
  "TZ BUY 2": "#15803d",
  "REAR 2": "#15803d",
  "REAR RE-ENTER 2": "#15803d",
  "BAR 2": "#15803d",
  "BAR SL2": "#b91c1c",
};

// The baseline Event badge color scheme, independent of that day's own
// candle direction: green for every bullish/progress milestone (light for
// the first tier, dark for the "2"-confirmed tier -- matching
// EVENT_COLOR_OVERRIDE's row-level darker shade above), red for RED/RED1/
// RED2, every LL, and every SL (light; SL2 specifically gets the same dark
// red as the row-level override, for the deeper stop). Covers every event
// kind the bar2-variant engine can emit; an unrecognized kind (e.g. New
// Theory v3's different vocabulary) falls back to that day's own candle
// color instead -- see plainEventBadgeStyle.
const LIGHT_GREEN = "#22c55e";
const DARK_GREEN = "#15803d";
const LIGHT_RED = "#ef5350";
const DARK_RED = "#b91c1c";

const EVENT_KIND_COLOR: Record<string, string> = {
  "TZ GREEN": LIGHT_GREEN,
  "TZ GREEN HH": LIGHT_GREEN,
  "TZ GREEN LL": LIGHT_RED,
  "TZ GREEN SL": LIGHT_RED,

  "TZ BUY": LIGHT_GREEN,
  "TZ BUY HH": LIGHT_GREEN,
  "TZ BUY LL": LIGHT_RED,
  "TZ BUY SL": LIGHT_RED,

  "TZ BUY 2": DARK_GREEN,
  "TZ BUY 2 HH": DARK_GREEN,
  "INVALID TZ BUY 2 HH": DARK_GREEN,
  "TZ BUY 2 LL": LIGHT_RED,
  "TZ BUY 2 SL": LIGHT_RED,

  RED: LIGHT_RED,
  RED1: LIGHT_RED,
  "RED1 HH": LIGHT_RED,
  "RED1 LL": LIGHT_RED,
  "INVALID RED1": LIGHT_RED,
  RED2: LIGHT_RED,
  "RED2 HH": LIGHT_RED, // not currently emitted by the engine, kept for safety

  BAR: LIGHT_GREEN,
  "BAR HH": LIGHT_GREEN,
  "INVALID BAR HH": LIGHT_GREEN,
  "BAR LL": LIGHT_RED,
  "INVALID BAR LL": LIGHT_RED,
  "BAR SL": LIGHT_RED,
  "BAR SL HH": LIGHT_RED,
  "BAR SL LL": LIGHT_RED,
  // Recovery back above the BAR SL zone -- a positive development, so
  // green rather than staying with the rest of the SL/failure family.
  "INVALID BAR SL": LIGHT_GREEN,
  "BAR SL2": DARK_RED,

  // Post-SL reactivation reference quietly ratcheting up without yet
  // confirming a full recovery -- same "positive development" framing as
  // INVALID BAR SL above, one tier up (TZ BUY's own SL) and via the REAR
  // family's own SL (REAR's own SL -> REAR RE-ENTER, REAR RE-ENTER's own
  // SL -> self-recovery).
  "INVALID TZ BUY HH": LIGHT_GREEN,
  "INVALID REAR SL HH": LIGHT_GREEN,
  "INVALID REAR RE-ENTER SL HH": LIGHT_GREEN,

  "BAR 2": DARK_GREEN,
  "BAR 2 HH": DARK_GREEN,
  "BAR 2 LL": LIGHT_RED,
  "BAR 2 SL": LIGHT_RED,

  REAR: LIGHT_GREEN,
  "REAR HH": LIGHT_GREEN,
  "INVALID REAR HH": LIGHT_GREEN,
  "REAR LL": LIGHT_RED,
  "REAR SL": LIGHT_RED,

  "REAR 2": DARK_GREEN,
  "REAR 2 HH": DARK_GREEN,
  "INVALID REAR 2 HH": DARK_GREEN,
  "REAR 2 LL": LIGHT_RED,
  "REAR 2 SL": LIGHT_RED,

  "REAR RE-ENTER": LIGHT_GREEN,
  "REAR RE-ENTER HH": LIGHT_GREEN,
  "INVALID REAR RE-ENTER HH": LIGHT_GREEN,
  "REAR RE-ENTER LL": LIGHT_RED,
  "REAR RE-ENTER SL": LIGHT_RED,

  "REAR RE-ENTER 2": DARK_GREEN,
  "REAR RE-ENTER 2 HH": DARK_GREEN,
  "INVALID REAR RE-ENTER 2 HH": DARK_GREEN,
  "REAR RE-ENTER 2 LL": LIGHT_RED,
  "REAR RE-ENTER 2 SL": LIGHT_RED,
};

// REAR SL / REAR RE-ENTER SL are NOT unconditionally "deep" the way BAR
// SL2 is -- the engine lets either fire whether or not its own "2" tier
// ever formed (unlike BAR SL2, which requires BAR 2 to already exist).
// So these only get the darker red when THIS branch already reached the
// listed "2" milestone at some earlier point in its history -- tracked in
// tokenOverride below, not a simple per-token lookup like the map above.
const CONDITIONAL_RED_AFTER: Record<string, string> = {
  "REAR SL": "REAR 2",
  "REAR RE-ENTER SL": "REAR RE-ENTER 2",
};

function tokenBranch(token: string): string {
  const m = token.match(/\(([^)]*)\)\s*$/);
  return m ? m[1] : "";
}

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
// color. Only the PLAIN (non-override) fallback -- overrides (both the
// direct kind and the conditional REAR SL / REAR RE-ENTER SL red -- see
// tokenOverride) are resolved before this is called. Doji's default needs
// to swap with the theme (see --doji-event-color/-bg in globals.css)
// since a dark-green-on-dark-tint pairing loses contrast in dark mode the
// same way plain text did before badges existed.
function plainEventBadgeStyle(rowCandle: CandleKind): { background: string; color: string } {
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

// A day's combined event string joins multiple events with ", ". No
// individual event tag ever contains a comma itself, so this split is safe.
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
  const [marketFilter, setMarketFilter] = useState(""); // "" = all markets, or FNO_FILTER_VALUE
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [fnoSymbol, setFnoSymbol] = useState(FNO_SEGMENT?.instruments[0]?.symbol ?? "");

  // Index-tab state
  const [indexSymbol, setIndexSymbol] = useState(GLOBAL_INDICES[0].symbol);

  // Market-tab state (Commodities / Crypto / Forex / Indian & International
  // indices / SME -- see lib/otherMarkets.ts)
  const [marketSegmentKey, setMarketSegmentKey] = useState(OTHER_MARKETS[0].key);
  const [marketSymbol, setMarketSymbol] = useState(OTHER_MARKETS[0].instruments[0].symbol);

  // Shared selection + range
  const [selected, setSelected] = useState<SymbolMatch | null>(null);
  const [start, setStart] = useState("2021-03-28");
  const [end, setEnd] = useState(todayISO());
  const [interval, setIntervalValue] = useState("1d");
  const [minStartDate, setMinStartDate] = useState("");
  const [minStartLoading, setMinStartLoading] = useState(false);

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [events, setEvents] = useState<Map<string, string>>(new Map());
  // Empty set = "All" (show every event); otherwise show rows matching
  // ANY of the selected kinds. "All" and specific kinds are mutually
  // exclusive -- picking "All" clears any specific selections, and
  // picking a specific kind naturally drops "All" (it's just
  // eventFilter.size === 0, not its own separate flag).
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

  // Per-token override color (date + exact token -> hex), computed over the
  // FULL chronological history (not filteredRows -- an event filter must
  // never hide a "2" milestone from this branch-history tracking, even
  // when its own row isn't currently displayed). Handles both the direct
  // overrides (EVENT_COLOR_OVERRIDE) and the conditional ones
  // (CONDITIONAL_RED_AFTER): REAR SL / REAR RE-ENTER SL only turn red once
  // this SAME branch has already reached its own REAR 2 / REAR RE-ENTER 2
  // at some earlier point -- tracked per branch label as we walk forward.
  const tokenOverride = useMemo(() => {
    const map = new Map<string, string>();
    const seenTwo = new Set<string>(); // `${"2"-kind}::${branch}`
    for (const r of rows) {
      for (const tok of splitEventTokens(events.get(r.date) || "")) {
        const kind = eventKind(tok);
        const branch = tokenBranch(tok);
        const direct = EVENT_COLOR_OVERRIDE[kind];
        if (direct) map.set(`${r.date} ${tok}`, direct);
        if (kind === "REAR 2" || kind === "REAR RE-ENTER 2") {
          seenTwo.add(`${kind}::${branch}`);
        }
        const requiredTwo = CONDITIONAL_RED_AFTER[kind];
        if (requiredTwo && seenTwo.has(`${requiredTwo}::${branch}`)) {
          map.set(`${r.date} ${tok}`, "#b91c1c");
        }
      }
    }
    return map;
  }, [rows, events]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "stock") return;
    if (marketFilter === FNO_FILTER_VALUE) return; // uses its own dropdown, not live search
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
      setEvents(computeWtfEvents(fetchedRows));
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
        Pull OHLC data for a major world index, search any stock across global markets, or browse
        Commodities, Crypto, Forex, Indian/International indices, and SME stocks.
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
            The Event column runs the TZ BUY engine (TZ GREEN → TZ BUY → TZ BUY 2 → BAR/BAR 2 →
            REAR/REAR 2 → REAR RE-ENTER/REAR RE-ENTER 2), verified end-to-end against real OHLC
            data across many scrips and repeatedly corrected against hand-traced real events (see
            WTF_RULEBOOK.md). Still a technical-analysis heuristic, not investment advice. The
            first row never shows an event: each day is only evaluated against the one before it.
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
                  // If any of TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 / BAR 2 /
                  // RED2 / BAR SL2 fired today -- or REAR SL / REAR
                  // RE-ENTER SL fired after this branch already reached its
                  // own "2" (tokenOverride) -- that event's color governs
                  // the WHOLE row: Date/O/H/L/C, not just its own badge,
                  // regardless of what today's own candle direction would
                  // otherwise show.
                  let rowOverrideColor: string | null = null;
                  for (const tok of tokens) {
                    const c = tokenOverride.get(`${r.date} ${tok}`);
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
                      <td className={cellClass} style={stripeStyle}>{formatDDMMYYYY(r.date)}</td>
                      <td className={cellClass}>{fmt(r.open)}</td>
                      <td className={cellClass}>{fmt(r.high)}</td>
                      <td className={cellClass}>{fmt(r.low)}</td>
                      <td className={cellClass}>{fmt(r.close)}</td>
                      <td className="event-col">
                        {tokens.map((tok, i) => {
                          const override = tokenOverride.get(`${r.date} ${tok}`);
                          const kindColor = EVENT_KIND_COLOR[eventKind(tok)];
                          const color = override ?? kindColor;
                          const style = color
                            ? { background: `${color}1f`, color }
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

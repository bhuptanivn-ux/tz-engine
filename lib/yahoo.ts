// Server-side helpers that proxy Yahoo Finance's public (unofficial, undocumented)
// endpoints. Yahoo has no official partner API for this data — these are the same
// endpoints tools like `yfinance` use. They can change or rate-limit without notice,
// so callers should treat failures as expected and surface them, not retry forever.

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SEARCH_BASE = "https://query2.finance.yahoo.com/v1/finance/search";

export type Interval = "1d" | "1wk" | "1mo";

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string;
}

export interface HistoryRow {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

function toUnixSeconds(dateStr: string): number {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return Math.floor(ms / 1000);
}

const EXCLUDED_QUOTE_TYPES = new Set(["CRYPTOCURRENCY", "MUTUALFUND", "OPTION", "FUTURE"]);

/**
 * Search Yahoo Finance for stocks (and indices) matching `query`, globally.
 * `region` is an optional hint (e.g. "IN", "US", "GB") that nudges Yahoo to
 * prioritize results from that market — it narrows relevance, not a hard
 * filter, since Yahoo's exchange codes for non-US markets aren't reliably
 * documented enough to filter on exactly.
 */
export async function searchSymbols(query: string, region?: string): Promise<SymbolMatch[]> {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("region", region || "US");
  url.searchParams.set("lang", "en-US");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance search failed with status ${res.status}`);
  }

  const data = await res.json();
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];

  return quotes
    .filter(
      (q: any) =>
        typeof q.symbol === "string" && !EXCLUDED_QUOTE_TYPES.has(q.quoteType)
    )
    .map((q: any) => ({
      symbol: q.symbol as string,
      name: (q.shortname || q.longname || q.symbol) as string,
      exchange: (q.exchange || q.exchDisp || "") as string,
    }));
}

/**
 * Fetch the earliest date Yahoo Finance has data for a symbol — its
 * "first trade date" (listing date for a stock, inception for an index).
 * Requests a tiny recent window purely to read the response's `meta`
 * block; `meta.firstTradeDate` is a property of the symbol itself and is
 * included regardless of the requested period, so there's no need to pull
 * the whole history just to find where it starts.
 */
export async function fetchFirstTradeDate(symbol: string): Promise<string | null> {
  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance chart request failed with status ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const chartError = data?.chart?.error;

  if (chartError) {
    throw new Error(chartError.description || "Yahoo Finance returned an error");
  }
  if (!result) {
    throw new Error(`No data returned for symbol "${symbol}"`);
  }

  const firstTradeDate = result.meta?.firstTradeDate;
  if (typeof firstTradeDate !== "number") {
    return null;
  }
  return new Date(firstTradeDate * 1000).toISOString().slice(0, 10);
}

/**
 * Fetch daily/weekly/monthly OHLC history for a Yahoo Finance symbol
 * (e.g. "KALYANKJIL.NS") between two dates, inclusive.
 */
export async function fetchHistory(
  symbol: string,
  start: string,
  end: string,
  interval: Interval = "1d"
): Promise<HistoryRow[]> {
  const period1 = toUnixSeconds(start);
  // Yahoo's period2 is exclusive of the end of that day, so push to end-of-day.
  const period2 = toUnixSeconds(end) + 24 * 60 * 60 - 1;

  if (period2 < period1) {
    throw new Error("End date must be on or after start date");
  }

  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", interval);
  url.searchParams.set("events", "history");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance chart request failed with status ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const chartError = data?.chart?.error;

  if (chartError) {
    throw new Error(chartError.description || "Yahoo Finance returned an error");
  }
  if (!result) {
    throw new Error(`No data returned for symbol "${symbol}"`);
  }

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens: (number | null)[] = quote.open || [];
  const highs: (number | null)[] = quote.high || [];
  const lows: (number | null)[] = quote.low || [];
  const closes: (number | null)[] = quote.close || [];

  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: opens[i] ?? null,
    high: highs[i] ?? null,
    low: lows[i] ?? null,
    close: closes[i] ?? null,
  }));
}

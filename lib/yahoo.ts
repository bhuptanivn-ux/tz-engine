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

/**
 * Search Yahoo Finance for NSE-listed equities matching `query`.
 * Yahoo tags NSE India symbols with exchange code "NSI" and suffixes them ".NS".
 */
export async function searchNseSymbols(query: string): Promise<SymbolMatch[]> {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("region", "IN");
  url.searchParams.set("lang", "en-IN");

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
    .filter((q: any) => q.exchange === "NSI" && typeof q.symbol === "string")
    .map((q: any) => ({
      symbol: q.symbol as string,
      name: (q.shortname || q.longname || q.symbol) as string,
      exchange: q.exchange as string,
    }));
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
